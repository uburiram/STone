/**
 * SomtumStore v2.1 — IndexedDB per-transaction store + per-account scopes.
 *
 * Goals:
 *  - Do NOT require loading one giant JSON blob for normal use
 *  - Stop dual-writing full appData into localStorage (Quota bottleneck)
 *  - Track dirty/deleted tx ids for incremental cloud sync
 *  - Never drop existing localStorage / v1 IDB data without migrating first
 *  - Isolate data per account (uid) vs guest so multi-shop on one phone is safe
 *
 * Scope model (Approach A):
 *  - activeScope = 'guest' | <firebase uid>
 *  - guest uses legacy DB name `somtum-idb-v2` (keeps existing single-user data)
 *  - logged-in user uses `somtum-idb-v2-u-<uid>`
 *  - localStorage dual-write for user scopes is prefixed `somtum@<uid>:...`
 *  - guest keeps unprefixed LS keys for backward compatibility
 *  - somtumDarkMode is global (shared across scopes)
 */
(function (global) {
  'use strict';

  const DB_VERSION = 1;
  const STORE_META = 'meta';
  const STORE_TX = 'tx';
  const STORE_KV = 'kv';

  const META_KEY = 'settings';
  const FLAG_MIGRATED = '__migrated_v2';
  const FLAG_DIRTY = '__dirty_tx_ids';
  const FLAG_DELETED = '__deleted_tx_ids';
  const FLAG_META_DIRTY = '__meta_dirty';
  const SCOPE_POINTER_KEY = 'somtumActiveScope';

  /** Keys that dual-write to localStorage (small flags only) */
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

  /** Never namespace these — UI prefs / pointers shared on the device */
  const GLOBAL_LS_KEYS = new Set(['somtumDarkMode', 'somtumActiveScope', 'somtumDataOwnerUid']);

  const LS_APPDATA_MAX_CHARS = 400000;

  const memoryKv = Object.create(null);
  let db = null;
  let ready = false;
  let writeQueue = Promise.resolve();
  let lsWriteFailures = 0;
  let txCountCache = null;
  /** @type {string} 'guest' or Firebase uid */
  let activeScope = 'guest';

  function dbNameForScope(scope) {
    if (!scope || scope === 'guest') return 'somtum-idb-v2';
    return 'somtum-idb-v2-u-' + String(scope);
  }

  /** Map logical key → localStorage key for current scope */
  function lsKeyFor(key) {
    if (GLOBAL_LS_KEYS.has(key)) return key;
    if (activeScope === 'guest') return key;
    // user scope: prefix to avoid clobbering guest / other accounts
    return 'somtum@' + activeScope + ':' + key;
  }

  function openDB(scope) {
    const name = dbNameForScope(scope || activeScope);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, DB_VERSION);
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

  function safeLsGet(logicalKey) {
    try { return localStorage.getItem(lsKeyFor(logicalKey)); } catch (e) { return null; }
  }
  function safeLsSet(logicalKey, value) {
    try {
      localStorage.setItem(lsKeyFor(logicalKey), value);
      return true;
    } catch (e) {
      lsWriteFailures++;
      console.warn('[STone] LS write failed', logicalKey, e && e.name);
      return false;
    }
  }
  function safeLsRemove(logicalKey) {
    try { localStorage.removeItem(lsKeyFor(logicalKey)); } catch (e) { /* ignore */ }
  }

  function enqueue(fn) {
    // Keep the queue alive after errors; record last failure for diagnostics
    writeQueue = writeQueue.then(fn).catch((e) => {
      console.error('[STone] write queue error', e);
      try {
        memoryKv['__lastWriteError'] = String((e && e.message) || e || 'unknown');
        memoryKv['__lastWriteErrorAt'] = new Date().toISOString();
      } catch (e2) { /* ignore */ }
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
    // Wait for transaction oncomplete (not just request success) so the next
    // readonly range query always sees this write — fixes "only new tx visible".
    await new Promise(function (resolve, reject) {
      if (!db) return reject(new Error('DB not open'));
      const trx = db.transaction(STORE_TX, 'readwrite');
      trx.objectStore(STORE_TX).put(clean);
      trx.oncomplete = function () { resolve(); };
      trx.onerror = function () { reject(trx.error || new Error('putTx failed')); };
      trx.onabort = function () { reject(trx.error || new Error('putTx aborted')); };
    });
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
      customGoal: data.customGoal != null ? data.customGoal : null,
      customGoalPercent: data.customGoalPercent != null ? data.customGoalPercent : null
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

  /**
   * Legacy migration only for guest scope (unprefixed LS + old shared DB).
   * User scopes start clean or from their own prior session.
   */
  async function migrateFromLegacy() {
    if (activeScope !== 'guest') {
      // User scope: only seed flags if empty; do not pull guest/legacy blobs
      const migrated = await kvGet(FLAG_MIGRATED);
      if (!migrated) {
        await kvSet(FLAG_MIGRATED, new Date().toISOString());
        memoryKv[FLAG_MIGRATED] = await kvGet(FLAG_MIGRATED);
      }
      txCountCache = await countTx();
      console.info('[STone] scope=', activeScope, 'ready tx=', txCountCache);
      return;
    }

    const migrated = await kvGet(FLAG_MIGRATED);
    const existingCount = await countTx();

    const candidates = [];
    const lsBlob = safeLsGet('somtumAppData');
    if (lsBlob) candidates.push({ src: 'localStorage', raw: lsBlob, score: scoreAppDataRaw(lsBlob) });
    const v1Blob = await openLegacyV1();
    if (v1Blob) candidates.push({ src: 'idb-v1', raw: v1Blob, score: scoreAppDataRaw(v1Blob) });
    const kvBlob = memoryKv['somtumAppData'] || (await kvGet('somtumAppData'));
    if (kvBlob) candidates.push({ src: 'kv', raw: String(kvBlob), score: scoreAppDataRaw(String(kvBlob)) });

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    if (best && best.score >= 0) {
      try {
        const parsed = JSON.parse(best.raw);
        const bestN = Array.isArray(parsed.transactions) ? parsed.transactions.length : 0;
        // Import rules:
        //  - never migrated → import (first-time upgrade)
        //  - already migrated + empty IDB → skip (deliberate clearAllUserData)
        //  - already migrated + legacy strictly richer than non-empty IDB → merge
        if (migrated && existingCount === 0) {
          console.info('[STone] v2 already migrated & empty — skip legacy re-import (intentional clear)');
        } else if (!migrated || bestN > existingCount) {
          const result = await importLegacyObject(parsed);
          console.info('[STone] migrated/merged from', best.src, 'tx=', result.tx, 'idbBefore=', existingCount, 'legacyN=', bestN);
        } else {
          console.info('[STone] v2 ready, tx count=', existingCount, '(legacy not richer)');
        }
      } catch (e) {
        console.error('[STone] migrate parse/import failed', e);
      }
    } else if (existingCount > 0) {
      console.info('[STone] v2 ready, tx count=', existingCount);
    }

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('somtum') === 0 && k.indexOf('somtum@') !== 0 &&
            k !== 'somtumAppData' && k !== 'somtumAutoBackup' && k !== SCOPE_POINTER_KEY) {
          const v = safeLsGet(k) || localStorage.getItem(k);
          if (v != null && SMALL_LS_KEYS.has(k)) {
            memoryKv[k] = v;
            await kvSet(k, v);
          }
        }
      }
    } catch (e) { /* ignore */ }

    await kvSet(FLAG_MIGRATED, new Date().toISOString());
    memoryKv[FLAG_MIGRATED] = await kvGet(FLAG_MIGRATED);
    txCountCache = await countTx();
    console.info('[STone] migration complete (guest). tx=', txCountCache);
    try {
      const seeded = await kvGet('__seed_dirty_v2');
      if (!seeded && txCountCache > 0) {
        memoryKv['__need_seed_dirty'] = '1';
      }
    } catch (e) { /* */ }
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

  function clearMemoryKeepGlobal() {
    const dark = memoryKv['somtumDarkMode'];
    Object.keys(memoryKv).forEach((k) => { delete memoryKv[k]; });
    if (dark != null) memoryKv['somtumDarkMode'] = dark;
    txCountCache = null;
  }

  const SomtumStore = {
    get isReady() { return ready; },
    get activeScope() { return activeScope; },

    /** Current IndexedDB database name for active scope */
    get dbName() { return dbNameForScope(activeScope); },

    /**
     * Switch storage scope. Pass null/undefined/'guest' for guest, or Firebase uid.
     * Closes previous IDB, opens target scope DB, migrates if guest.
     * Does NOT delete the previous scope's data (Approach A).
     */
    async switchScope(uidOrNull) {
      const next = (uidOrNull && String(uidOrNull)) || 'guest';
      if (next === activeScope && ready && db) {
        return true;
      }
      if (this._initLock) {
        try { await this._initLock; } catch (e) { /* */ }
        if (next === activeScope && ready && db) return true;
      }
      console.info('[STone] switchScope', activeScope, '→', next);
      try {
        await writeQueue;
      } catch (e) { /* */ }
      if (db) {
        try { db.close(); } catch (e) { /* */ }
        db = null;
      }
      ready = false;
      clearMemoryKeepGlobal();
      activeScope = next;
      try {
        safeLsSet(SCOPE_POINTER_KEY, activeScope);
      } catch (e) { /* */ }
      // Also keep a readable owner pointer for older code paths
      if (activeScope === 'guest') {
        try { localStorage.removeItem('somtumDataOwnerUid'); } catch (e) { /* */ }
      } else {
        try { localStorage.setItem('somtumDataOwnerUid', activeScope); } catch (e) { /* */ }
      }
      return this.init();
    },

    async init() {
      // Restore last logged-in account scope so data is visible even if Google session expired
      if (!this._bootScopeApplied) {
        this._bootScopeApplied = true;
        if (!activeScope || activeScope === 'guest') {
          var persisted = 'guest';
          try {
            var ptr = localStorage.getItem(SCOPE_POINTER_KEY);
            if (ptr && ptr !== 'guest' && String(ptr).length >= 8) persisted = String(ptr);
            else {
              var uid = localStorage.getItem('somtumDataOwnerUid');
              if (uid && uid !== 'guest' && String(uid).length >= 8) persisted = String(uid);
            }
          } catch (e) { /* */ }
          if (persisted !== 'guest') {
            activeScope = persisted;
            console.info('[STone] restore persisted scope', activeScope);
          }
        }
      }
      if (ready && db) return true;
      if (this._initLock) return this._initLock;
      var self = this;
      this._initLock = (async function() {
        try {
          return await self._initInner();
        } finally {
          self._initLock = null;
        }
      })();
      return this._initLock;
    },

    async _initInner() {
      if (ready && db) return true;
      try {
        db = await openDB(activeScope);
        await migrateFromLegacy();
        const dirty = await kvGet(FLAG_DIRTY);
        if (dirty != null) memoryKv[FLAG_DIRTY] = String(dirty);
        const deleted = await kvGet(FLAG_DELETED);
        if (deleted != null) memoryKv[FLAG_DELETED] = String(deleted);
        const metaDirty = await kvGet(FLAG_META_DIRTY);
        if (metaDirty != null) memoryKv[FLAG_META_DIRTY] = String(metaDirty);
        SMALL_LS_KEYS.forEach((k) => {
          const v = safeLsGet(k);
          if (v != null) memoryKv[k] = v;
        });
        // Global dark mode may live on unprefixed key always
        if (memoryKv['somtumDarkMode'] == null) {
          try {
            const g = localStorage.getItem('somtumDarkMode');
            if (g != null) memoryKv['somtumDarkMode'] = g;
          } catch (e) { /* */ }
        }
        if (memoryKv['__need_seed_dirty'] === '1' || !(await kvGet('__seed_dirty_v2'))) {
          try {
            const seeded = await kvGet('__seed_dirty_v2');
            if (!seeded) {
              const n = await countTx();
              if (n > 0) {
                const allList = await new Promise((resolve, reject) => {
                  const tx = db.transaction(STORE_TX, 'readonly');
                  const req = tx.objectStore(STORE_TX).getAll();
                  req.onsuccess = () => resolve(req.result || []);
                  req.onerror = () => reject(req.error);
                });
                await setDirtyIds(allList.filter((x) => x && x.id).map((x) => String(x.id)));
                memoryKv[FLAG_META_DIRTY] = '1';
                await kvSet(FLAG_META_DIRTY, '1');
                console.info('[STone] seeded dirty on init', n);
              }
              await kvSet('__seed_dirty_v2', '1');
              memoryKv['__seed_dirty_v2'] = '1';
            }
          } catch (seedErr) {
            console.warn('seed on init', seedErr);
          }
          delete memoryKv['__need_seed_dirty'];
        }
        ready = true;
        // Persist owner marker inside this scope
        if (activeScope !== 'guest') {
          memoryKv['somtumDataOwnerUid'] = activeScope;
          safeLsSet('somtumDataOwnerUid', activeScope);
          await kvSet('somtumDataOwnerUid', activeScope).catch(() => {});
        }
        global.dispatchEvent(new CustomEvent('somtum-store-ready', {
          detail: { scope: activeScope }
        }));
        return true;
      } catch (e) {
        console.error('[STone] init failed, LS-only fallback', e);
        try {
          SMALL_LS_KEYS.forEach((k) => {
            const v = safeLsGet(k);
            if (v != null) memoryKv[k] = v;
          });
        } catch (e2) { /* */ }
        ready = true;
        return false;
      }
    },

    getItem(key) {
      if (Object.prototype.hasOwnProperty.call(memoryKv, key)) return memoryKv[key];
      const ls = safeLsGet(key);
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
            console.error('[STone] appData structured persist failed', e);
          }
        });
        if (str.length <= LS_APPDATA_MAX_CHARS) {
          safeLsSet(key, str);
        } else {
          safeLsRemove(key);
          console.info('[STone] skipped LS appData mirror (size', str.length, ')');
        }
        return;
      }

      if (key === 'somtumAutoBackup') {
        memoryKv[key] = str;
        enqueue(() => kvSet(key, str));
        if (str.length <= LS_APPDATA_MAX_CHARS) safeLsSet(key, str);
        else safeLsRemove(key);
        return;
      }

      memoryKv[key] = str;
      if (SMALL_LS_KEYS.has(key) || key.indexOf('somtum') === 0 || key.indexOf('__') === 0) {
        if (GLOBAL_LS_KEYS.has(key) || SMALL_LS_KEYS.has(key) || key === 'somtumAppData' || key === 'somtumAutoBackup') {
          safeLsSet(key, str);
        } else if (key.indexOf('somtum') === 0) {
          safeLsSet(key, str);
        }
      }
      if (db) enqueue(() => kvSet(key, str));
    },

    removeItem(key) {
      delete memoryKv[key];
      safeLsRemove(key);
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
        customGoal: appData.customGoal,
        customGoalPercent: appData.customGoalPercent
      });
      if (opts.writeAllTx && Array.isArray(appData.transactions)) {
        for (let i = 0; i < appData.transactions.length; i++) {
          const t = appData.transactions[i];
          if (t && t.id) await putTxRecord(t);
        }
      }
    },

    /**
     * Apply a cloud transaction snapshot safely.
     * - Upserts every cloud tx into IDB
     * - Removes local IDB txs that are absent from cloud ONLY when they are not
     *   pending local upload (dirty) — never drops unsynced local work
     * - Does not touch other accounts / guest scope
     * Returns { keptLocalDirty, pruned, upserted }
     */
    async applyCloudTxSnapshot(cloudTxs, opts) {
      opts = opts || {};
      const list = Array.isArray(cloudTxs) ? cloudTxs : [];
      const cloudIds = new Set();
      let upserted = 0;
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!t || !t.id) continue;
        cloudIds.add(String(t.id));
        await putTxRecord(t);
        upserted++;
      }

      const dirty = new Set((await getDirtyIds()).map(String));
      const deleted = new Set((await getDeletedIds()).map(String));
      const localAll = await this.getAllTx();
      let pruned = 0;
      let keptLocalDirty = 0;
      // Safety: never mass-prune when cloud snapshot looks incomplete vs local IDB.
      // (Firestore fromCache / race after single setDoc can briefly report a subset.)
      const skipPrune = !!opts.skipPrune ||
        (localAll.length > 0 && list.length > 0 && list.length < Math.max(1, Math.floor(localAll.length * 0.5)));
      if (skipPrune && !opts.forcePrune) {
        console.info('[STone] skip cloud prune (snapshot looks incomplete)', {
          cloud: list.length, local: localAll.length
        });
        txCountCache = null;
        return { keptLocalDirty: dirty.size, pruned: 0, upserted: upserted, skippedPrune: true };
      }
      for (let i = 0; i < localAll.length; i++) {
        const t = localAll[i];
        if (!t || !t.id) continue;
        const id = String(t.id);
        if (cloudIds.has(id)) continue;
        if (dirty.has(id)) {
          keptLocalDirty++;
          continue;
        }
        if (deleted.has(id)) {
          await deleteTxRecord(id);
          pruned++;
          continue;
        }
        await deleteTxRecord(id);
        pruned++;
      }
      txCountCache = null;
      return { keptLocalDirty, pruned, upserted };
    },

    async buildLegacyAppData(base) {
      const meta = (await getMeta()) || {};
      const txs = await this.getAllTx();
      return {
        transactions: txs,
        categories: meta.categories || (base && base.categories) || { income: [], expense: [] },
        materials: meta.materials || (base && base.materials) || [],
        equipments: meta.equipments || (base && base.equipments) || [],
        customGoal: meta.customGoal != null ? meta.customGoal : (base && base.customGoal) || null,
        customGoalPercent: meta.customGoalPercent != null ? meta.customGoalPercent : (base && base.customGoalPercent) || null
      };
    },

    async flush() { await writeQueue; },

    /**
     * Wipe all app data from the ACTIVE scope only (IDB + scoped LS keys).
     * Keeps UI prefs like dark mode. Does not touch other accounts' DBs.
     * For guest scope also removes legacy sources (somtum-idb-v1 + residual LS)
     * so migrateFromLegacy cannot re-import old data after a deliberate clear.
     */
    async clearAllUserData() {
      txCountCache = null;
      if (db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TX, 'readwrite');
          tx.objectStore(STORE_TX).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_META, 'readwrite');
          tx.objectStore(STORE_META).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        // Also clear KV store so no residual somtumAppData / flags remain in IDB
        try {
          await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_KV, 'readwrite');
            tx.objectStore(STORE_KV).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        } catch (e) { /* */ }
      }
      const wipeKeys = [
        'somtumAppData', 'somtumHasUnsyncedData', 'somtumLastSyncedTimestamp',
        'somtumDataOwnerUid', 'somtumAutoBackup', 'somtumAutoBackupTime',
        'somtumAutoBackupUid', 'somtumLastGoalNotified', 'somtumLastBackupRemind',
        FLAG_DIRTY, FLAG_DELETED, FLAG_META_DIRTY, '__seed_dirty_v2', '__need_seed_dirty'
      ];
      for (const k of wipeKeys) {
        delete memoryKv[k];
        safeLsRemove(k);
        if (db) {
          try { await kvDel(k); } catch (e) { /* */ }
        }
      }

      // Guest: purge legacy sources that migrateFromLegacy would otherwise re-import
      if (activeScope === 'guest') {
        try {
          const toRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf('somtum') === 0 &&
                !GLOBAL_LS_KEYS.has(k) &&
                k.indexOf('somtum@') !== 0) {
              toRemove.push(k);
            }
          }
          toRemove.forEach((k) => {
            try { localStorage.removeItem(k); } catch (e) { /* */ }
          });
        } catch (e) { /* */ }

        try {
          await new Promise((resolve) => {
            const req = indexedDB.deleteDatabase('somtum-idb-v1');
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          });
          console.info('[STone] deleted legacy DB somtum-idb-v1');
        } catch (e) {
          console.warn('[STone] delete somtum-idb-v1 failed', e);
        }
      }

      // Re-mark migrated so next init does not treat empty DB as "never migrated"
      await kvSet(FLAG_MIGRATED, new Date().toISOString());
      memoryKv[FLAG_MIGRATED] = await kvGet(FLAG_MIGRATED);
      // Prevent seedDirty from treating empty as needing seed from nowhere
      memoryKv['__seed_dirty_v2'] = '1';
      try { await kvSet('__seed_dirty_v2', '1'); } catch (e) { /* */ }
    },

    async seedDirtyIfNeeded() {
      try {
        const seeded = memoryKv['__seed_dirty_v2'] || (await kvGet('__seed_dirty_v2'));
        if (seeded) return;
        const n = await countTx();
        if (n > 0) {
          const all = await this.getAllTx();
          const ids = all.filter((t) => t && t.id).map((t) => String(t.id));
          await setDirtyIds(ids);
          memoryKv[FLAG_META_DIRTY] = '1';
          await kvSet(FLAG_META_DIRTY, '1');
          console.info('[STone] seeded dirty ids', ids.length);
        }
        memoryKv['__seed_dirty_v2'] = '1';
        await kvSet('__seed_dirty_v2', '1');
      } catch (e) {
        console.warn('seedDirtyIfNeeded', e);
      }
    },

    /**
     * If we are on empty guest scope but a uid-scoped IDB exists on this device,
     * reopen that account DB. Never deletes any database.
     */
    async recoverScopeIfEmpty() {
      if (activeScope && activeScope !== 'guest') return false;
      let n = 0;
      try { n = await countTx(); } catch (e) { n = 0; }
      if (n > 0) return false;
      let names = [];
      try {
        if (typeof indexedDB !== 'undefined' && indexedDB.databases) {
          const list = await indexedDB.databases();
          names = (list || []).map(function(x) { return x && x.name; }).filter(Boolean);
        }
      } catch (e) {
        return false;
      }
      const uids = [];
      for (let i = 0; i < names.length; i++) {
        const nm = names[i];
        if (nm && nm.indexOf('somtum-idb-v2-u-') === 0) {
          uids.push(nm.slice('somtum-idb-v2-u-'.length));
        }
      }
      if (!uids.length) return false;
      let pick = uids[0];
      try {
        const saved = localStorage.getItem('somtumDataOwnerUid') || localStorage.getItem(SCOPE_POINTER_KEY);
        if (saved && uids.indexOf(saved) !== -1) pick = saved;
      } catch (e) { /* */ }
      console.info('[STone] recover account scope from IDB', pick, 'candidates', uids.length);
      await this.switchScope(pick);
      return true;
    },

    async stats() {
      const n = await this.countTx();
      const dirty = await getDirtyIds();
      const deleted = await getDeletedIds();
      return {
        ready,
        idb: !!db,
        scope: activeScope,
        dbName: dbNameForScope(activeScope),
        txCount: n,
        dirtyCount: dirty.length,
        deletedCount: deleted.length,
        lsWriteFailures,
        migratedAt: memoryKv[FLAG_MIGRATED] || (await kvGet(FLAG_MIGRATED))
      };
    },

    _scoreAppDataRaw: scoreAppDataRaw,
    _parseDirtyList: parseDirtyList,
    _dbNameForScope: dbNameForScope,
    _lsKeyFor: lsKeyFor,
    LS_APPDATA_MAX_CHARS
  };

  global.SomtumStore = SomtumStore;
  global.SToneStore = global.SomtumStore;
})(typeof window !== 'undefined' ? window : globalThis);
