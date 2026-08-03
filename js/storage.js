/**
 * SomtumStore v2 — IndexedDB per-transaction store + safe legacy migration.
 *
 * Goals:
 *  - Do NOT require loading one giant JSON blob for normal use
 *  - Stop dual-writing full appData into localStorage (Quota bottleneck)
 *  - Track dirty/deleted tx ids for incremental cloud sync
 *  - Never drop existing localStorage / v1 IDB data without migrating first
 */
(function (global) {
  'use strict';

  const DB_NAME = 'somtum-idb-v2';
  const DB_VERSION = 1;
  const STORE_META = 'meta';
  const STORE_TX = 'tx';
  const STORE_KV = 'kv';

  const META_KEY = 'settings';
  const FLAG_MIGRATED = '__migrated_v2';
  const FLAG_DIRTY = '__dirty_tx_ids';
  const FLAG_DELETED = '__deleted_tx_ids';
  const FLAG_META_DIRTY = '__meta_dirty';

  const SMALL_LS_KEYS = new Set([
    'somtumHasUnsyncedData',
    'somtumLastSyncedTimestamp',
    'somtumDataOwnerUid',
    'somtumDarkMode',
    'somtumLastBackupRemind',
    'somtumLastGoalNotified',
    'somtumAutoBackupUid',
    'somtumAutoBackupTime'
  ]);

  const LS_APPDATA_MAX_CHARS = 400000;

  const memoryKv = Object.create(null);
  let db = null;
  let ready = false;
  let writeQueue = Promise.resolve();
  let lsWriteFailures = 0;
  let txCountCache = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_META)) {
          database.createObjectStore(STORE_META);
        }
        if (!database.objectStoreNames.contains(STORE_TX)) {
          const txStore = database.createObjectStore(STORE_TX, { keyPath: 'id' });
          txStore.createIndex('date', 'date', { unique: false });
          txStore.createIndex('type', 'type', { unique: false });
        }
        if (!database.objectStoreNames.contains(STORE_KV)) {
          database.createObjectStore(STORE_KV);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IDB open failed'));
    });
  }

  function idbOp(storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error('DB not open'));
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let req;
      try {
        req = fn(store);
      } catch (e) {
        reject(e);
        return;
      }
      if (req && typeof req === 'object' && 'onsuccess' in req) {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } else {
        tx.oncomplete = () => resolve(req);
        tx.onerror = () => reject(tx.error);
      }
    });
  }

  function kvGet(key) {
    return idbOp(STORE_KV, 'readonly', (s) => s.get(key)).catch(() => undefined);
  }
  function kvSet(key, value) {
    return idbOp(STORE_KV, 'readwrite', (s) => s.put(value, key));
  }
  function kvDel(key) {
    return idbOp(STORE_KV, 'readwrite', (s) => s.delete(key));
  }

  function safeLSGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeLSSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      lsWriteFailures++;
      console.warn('[SomtumStore] LS write failed', key, e && e.name);
      return false;
    }
  }
  function safeLSRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function enqueue(fn) {
    writeQueue = writeQueue.then(fn).catch((e) => {
      console.error('[SomtumStore] write queue error', e);
    });
    return writeQueue;
  }

  function parseDirtyList(raw) {
    if (!raw) return [];
    try {
      const a = JSON.parse(raw);
      return Array.isArray(a) ? a.map(String) : [];
    } catch (e) {
      return [];
    }
  }

  function scoreAppDataRaw(raw) {
    if (!raw || typeof raw !== 'string') return -1;
    try {
      const d = JSON.parse(raw);
      const n = Array.isArray(d.transactions) ? d.transactions.length : 0;
      let amountSum = 0;
      (d.transactions || []).forEach((t) => { amountSum += Number(t.amount) || 0; });
      return n * 1e9 + raw.length + Math.min(Math.abs(amountSum), 1e8);
    } catch (e) {
      return -1;
    }
  }

  function openLegacyV1() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('somtum-idb-v1', 1);
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const ldb = req.result;
          if (!ldb.objectStoreNames.contains('kv')) {
            ldb.close();
            resolve(null);
            return;
          }
          try {
            const tx = ldb.transaction('kv', 'readonly');
            const r = tx.objectStore('kv').get('somtumAppData');
            r.onsuccess = () => {
              const val = r.result;
              ldb.close();
              resolve(val != null ? String(val) : null);
            };
            r.onerror = () => { ldb.close(); resolve(null); };
          } catch (e) {
            try { ldb.close(); } catch (e2) { /* */ }
            resolve(null);
          }
        };
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function countTx() {
    if (!db) return 0;
    return idbOp(STORE_TX, 'readonly', (s) => s.count());
  }

  async function putTxRecord(tx) {
    if (!tx || !tx.id) return;
    const clean = JSON.parse(JSON.stringify(tx));
    await idbOp(STORE_TX, 'readwrite', (s) => s.put(clean));
    txCountCache = null;
  }

  async function deleteTxRecord(id) {
    await idbOp(STORE_TX, 'readwrite', (s) => s.delete(String(id)));
    txCountCache = null;
  }

  async function getMeta() {
    const data = await idbOp(STORE_META, 'readonly', (s) => s.get(META_KEY));
    return data || null;
  }

  async function setMeta(meta) {
    const payload = JSON.parse(JSON.stringify(meta || {}));
    payload.updatedAt = new Date().toISOString();
    await idbOp(STORE_META, 'readwrite', (s) => s.put(payload, META_KEY));
  }

  async function importLegacyObject(data) {
    if (!data || typeof data !== 'object') return { tx: 0, meta: false };
    const meta = {
      categories: data.categories,
      materials: data.materials || [],
      equipments: data.equipments || [],
      customGoal: data.customGoal != null ? data.customGoal : null
    };
    await setMeta(meta);

    const list = Array.isArray(data.transactions) ? data.transactions : [];
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t && t.id) {
        await putTxRecord(t);
        n++;
      }
    }
    return { tx: n, meta: true };
  }

  async function migrateFromLegacy() {
    const migrated = await kvGet(FLAG_MIGRATED);
    const existingCount = await countTx();

    const candidates = [];
    const lsBlob = safeLSGet('somtumAppData');
    if (lsBlob) candidates.push({ src: 'localStorage', raw: lsBlob, score: scoreAppDataRaw(lsBlob) });
    const v1Blob = await openLegacyV1();
    if (v1Blob) candidates.push({ src: 'idb-v1', raw: v1Blob, score: scoreAppDataRaw(v1Blob) });
    const kvBlob = memoryKv['somtumAppData'] || (await kvGet('somtumAppData'));
    if (kvBlob) candidates.push({ src: 'kv', raw: String(kvBlob), score: scoreAppDataRaw(String(kvBlob)) });

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    if (existingCount > 0 && migrated) {
      console.info('[SomtumStore] v2 ready, tx count=', existingCount);
      return;
    }

    if (best && best.score >= 0) {
      try {
        const parsed = JSON.parse(best.raw);
        const result = await importLegacyObject(parsed);
        console.info('[SomtumStore] migrated from', best.src, 'tx=', result.tx, 'existingBefore=', existingCount);
      } catch (e) {
        console.error('[SomtumStore] migrate parse/import failed', e);
      }
    }

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('somtum') === 0 && k !== 'somtumAppData' && k !== 'somtumAutoBackup') {
          const v = safeLSGet(k);
          if (v != null) {
            memoryKv[k] = v;
            await kvSet(k, v);
          }
        }
      }
    } catch (e) { /* ignore */ }

    await kvSet(FLAG_MIGRATED, new Date().toISOString());
    memoryKv[FLAG_MIGRATED] = await kvGet(FLAG_MIGRATED);
    txCountCache = await countTx();
    console.info('[SomtumStore] migration complete. tx=', txCountCache);
  }

  async function getDirtyIds() {
    const raw = memoryKv[FLAG_DIRTY] != null ? memoryKv[FLAG_DIRTY] : await kvGet(FLAG_DIRTY);
    return parseDirtyList(raw);
  }

  async function setDirtyIds(ids) {
    const uniq = Array.from(new Set((ids || []).map(String)));
    const raw = JSON.stringify(uniq);
    memoryKv[FLAG_DIRTY] = raw;
    await kvSet(FLAG_DIRTY, raw);
  }

  async function getDeletedIds() {
    const raw = memoryKv[FLAG_DELETED] != null ? memoryKv[FLAG_DELETED] : await kvGet(FLAG_DELETED);
    return parseDirtyList(raw);
  }

  async function setDeletedIds(ids) {
    const uniq = Array.from(new Set((ids || []).map(String)));
    const raw = JSON.stringify(uniq);
    memoryKv[FLAG_DELETED] = raw;
    await kvSet(FLAG_DELETED, raw);
  }

  const SomtumStore = {
    get isReady() { return ready; },

    async init() {
      if (ready && db) return true;
      try {
        db = await openDB();
        await migrateFromLegacy();
        const dirty = await kvGet(FLAG_DIRTY);
        if (dirty != null) memoryKv[FLAG_DIRTY] = String(dirty);
        const deleted = await kvGet(FLAG_DELETED);
        if (deleted != null) memoryKv[FLAG_DELETED] = String(deleted);
        const metaDirty = await kvGet(FLAG_META_DIRTY);
        if (metaDirty != null) memoryKv[FLAG_META_DIRTY] = String(metaDirty);
        SMALL_LS_KEYS.forEach((k) => {
          const v = safeLSGet(k);
          if (v != null) memoryKv[k] = v;
        });
        ready = true;
        global.dispatchEvent(new CustomEvent('somtum-store-ready'));
        return true;
      } catch (e) {
        console.error('[SomtumStore] init failed, LS-only fallback', e);
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf('somtum') === 0) memoryKv[k] = localStorage.getItem(k);
          }
        } catch (e2) { /* */ }
        ready = true;
        return false;
      }
    },

    getItem(key) {
      if (Object.prototype.hasOwnProperty.call(memoryKv, key)) return memoryKv[key];
      const ls = safeLSGet(key);
      if (ls !== null) memoryKv[key] = ls;
      return ls;
    },

    setItem(key, value) {
      const str = value === null || value === undefined ? '' : String(value);

      if (key === 'somtumAppData') {
        memoryKv[key] = str;
        enqueue(async () => {
          try {
            const data = JSON.parse(str);
            await importLegacyObject(data);
          } catch (e) {
            console.error('[SomtumStore] appData structured persist failed', e);
          }
        });
        if (str.length <= LS_APPDATA_MAX_CHARS) {
          safeLSSet(key, str);
        } else {
          safeLSRemove(key);
          console.info('[SomtumStore] skipped LS appData mirror (size', str.length, ')');
        }
        return;
      }

      if (key === 'somtumAutoBackup') {
        memoryKv[key] = str;
        enqueue(() => kvSet(key, str));
        if (str.length <= LS_APPDATA_MAX_CHARS) safeLSSet(key, str);
        else safeLSRemove(key);
        return;
      }

      memoryKv[key] = str;
      if (SMALL_LS_KEYS.has(key) || key.indexOf('somtum') === 0) {
        safeLSSet(key, str);
      }
      if (db) enqueue(() => kvSet(key, str));
    },

    removeItem(key) {
      delete memoryKv[key];
      safeLSRemove(key);
      if (db) enqueue(() => kvDel(key));
    },

    async getMeta() {
      return getMeta();
    },

    async saveMeta(partial) {
      const cur = (await getMeta()) || {};
      const next = Object.assign({}, cur, partial || {});
      await setMeta(next);
      memoryKv[FLAG_META_DIRTY] = '1';
      await kvSet(FLAG_META_DIRTY, '1');
    },

    markMetaDirty() {
      memoryKv[FLAG_META_DIRTY] = '1';
      enqueue(() => kvSet(FLAG_META_DIRTY, '1'));
    },

    async isMetaDirty() {
      const v = memoryKv[FLAG_META_DIRTY] != null ? memoryKv[FLAG_META_DIRTY] : await kvGet(FLAG_META_DIRTY);
      return v === '1' || v === 'true';
    },

    async clearMetaDirty() {
      memoryKv[FLAG_META_DIRTY] = '0';
      await kvSet(FLAG_META_DIRTY, '0');
    },

    async putTx(tx) {
      await putTxRecord(tx);
    },

    async deleteTx(id) {
      await deleteTxRecord(id);
    },

    async getTx(id) {
      return idbOp(STORE_TX, 'readonly', (s) => s.get(String(id)));
    },

    async getTxByDateRange(startDate, endDate) {
      if (!db) return [];
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TX, 'readonly');
        const store = tx.objectStore(STORE_TX);
        const results = [];
        let req;
        if (startDate && endDate) {
          const range = IDBKeyRange.bound(startDate, endDate);
          req = store.index('date').openCursor(range);
        } else if (startDate) {
          req = store.index('date').openCursor(IDBKeyRange.lowerBound(startDate));
        } else {
          req = store.openCursor();
        }
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        req.onerror = () => reject(req.error);
      });
    },

    async getAllTx() {
      return this.getTxByDateRange(null, null);
    },

    async countTx() {
      if (txCountCache != null) return txCountCache;
      txCountCache = await countTx();
      return txCountCache;
    },

    async markDirty(id) {
      const ids = await getDirtyIds();
      if (ids.indexOf(String(id)) === -1) ids.push(String(id));
      await setDirtyIds(ids);
    },

    async markDeleted(id) {
      const ids = await getDeletedIds();
      if (ids.indexOf(String(id)) === -1) ids.push(String(id));
      await setDeletedIds(ids);
      const dirty = (await getDirtyIds()).filter((x) => x !== String(id));
      await setDirtyIds(dirty);
      await deleteTxRecord(id);
    },

    async getDirtyIds() { return getDirtyIds(); },
    async getDeletedIds() { return getDeletedIds(); },

    async clearDirty(ids) {
      if (!ids || !ids.length) {
        await setDirtyIds([]);
        return;
      }
      const set = new Set(ids.map(String));
      const left = (await getDirtyIds()).filter((x) => !set.has(x));
      await setDirtyIds(left);
    },

    async clearDeleted(ids) {
      if (!ids || !ids.length) {
        await setDeletedIds([]);
        return;
      }
      const set = new Set(ids.map(String));
      const left = (await getDeletedIds()).filter((x) => !set.has(x));
      await setDeletedIds(left);
    },

    async persistAppState(appData, opts) {
      opts = opts || {};
      if (!appData) return;
      await this.saveMeta({
        categories: appData.categories,
        materials: appData.materials,
        equipments: appData.equipments,
        customGoal: appData.customGoal
      });
      if (opts.writeAllTx && Array.isArray(appData.transactions)) {
        for (let i = 0; i < appData.transactions.length; i++) {
          const t = appData.transactions[i];
          if (t && t.id) await putTxRecord(t);
        }
      }
    },

    async buildLegacyAppData(base) {
      const meta = (await getMeta()) || {};
      const txs = await this.getAllTx();
      return {
        transactions: txs,
        categories: meta.categories || (base && base.categories) || { income: [], expense: [] },
        materials: meta.materials || (base && base.materials) || [],
        equipments: meta.equipments || (base && base.equipments) || [],
        customGoal: meta.customGoal != null ? meta.customGoal : (base && base.customGoal) || null
      };
    },

    async flush() { await writeQueue; },

    async stats() {
      const n = await this.countTx();
      const dirty = await getDirtyIds();
      const deleted = await getDeletedIds();
      return {
        ready,
        idb: !!db,
        txCount: n,
        dirtyCount: dirty.length,
        deletedCount: deleted.length,
        lsWriteFailures,
        migratedAt: memoryKv[FLAG_MIGRATED] || (await kvGet(FLAG_MIGRATED))
      };
    },

    _scoreAppDataRaw: scoreAppDataRaw,
    _parseDirtyList: parseDirtyList,
    LS_APPDATA_MAX_CHARS
  };

  global.SomtumStore = SomtumStore;
})(typeof window !== 'undefined' ? window : globalThis);
