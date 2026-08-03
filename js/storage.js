/**
 * SomtumStore — IndexedDB primary storage with safe localStorage migration.
 *
 * Design goals (data safety first):
 *  1. Never lose existing localStorage data on upgrade.
 *  2. Dual-write critical keys to localStorage as a safety net (Quota-aware).
 *  3. In-memory cache so existing sync call sites can stay synchronous.
 *  4. Prefer the richer dataset when both IDB and localStorage have data.
 *
 * Public API (sync after init completes):
 *   await SomtumStore.init()
 *   SomtumStore.getItem(key) / setItem(key, value) / removeItem(key)
 *   SomtumStore.getJSON(key) / setJSON(key, obj)
 *   SomtumStore.isReady
 */
(function (global) {
  'use strict';

  const DB_NAME = 'somtum-idb-v1';
  const DB_VERSION = 1;
  const STORE_NAME = 'kv';
  const META_MIGRATED = '__somtum_idb_migrated_v1';

  /** Keys that must dual-write to localStorage for crash recovery / old code paths */
  const CRITICAL_KEYS = new Set([
    'somtumAppData',
    'somtumHasUnsyncedData',
    'somtumLastSyncedTimestamp',
    'somtumDataOwnerUid',
    'somtumAutoBackup',
    'somtumAutoBackupTime',
    'somtumAutoBackupUid',
    'somtumLastGoalNotified',
    'somtumDarkMode',
    'somtumLastBackupRemind'
  ]);

  /** All keys we own (used during migration scan) */
  const OWNED_PREFIX = 'somtum';

  const memory = Object.create(null);
  let db = null;
  let ready = false;
  let writeQueue = Promise.resolve();
  let lsWriteFailures = 0;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IDB open failed'));
      req.onblocked = () => {
        console.warn('[SomtumStore] IDB open blocked — close other tabs?');
      };
    });
  }

  function idbGet(key) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve(undefined);
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbSet(key, value) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbDelete(key) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbGetAllKeys() {
    return new Promise((resolve, reject) => {
      if (!db) return resolve([]);
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function safeLSGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeLSSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      lsWriteFailures++;
      // QuotaExceeded: keep IDB as source of truth; do not throw to callers
      console.warn('[SomtumStore] localStorage write failed for', key, e && e.name);
      return false;
    }
  }

  function safeLSRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) { /* ignore */ }
  }

  /** Score dataset richness for conflict resolution */
  function scoreAppDataRaw(raw) {
    if (!raw || typeof raw !== 'string') return -1;
    try {
      const d = JSON.parse(raw);
      const n = Array.isArray(d.transactions) ? d.transactions.length : 0;
      let amountSum = 0;
      if (Array.isArray(d.transactions)) {
        for (let i = 0; i < d.transactions.length; i++) {
          amountSum += Number(d.transactions[i].amount) || 0;
        }
      }
      // Prefer more transactions; tie-break by payload size and amount checksum
      return n * 1e9 + raw.length + Math.min(Math.abs(amountSum), 1e8);
    } catch (e) {
      return -1;
    }
  }

  /**
   * One-time migration: copy localStorage → IDB, resolve conflicts safely.
   */
  async function migrateFromLocalStorage() {
    const migratedFlag = await idbGet(META_MIGRATED);
    const lsApp = safeLSGet('somtumAppData');
    const idbApp = await idbGet('somtumAppData');

    // Collect every somtum* key from localStorage
    const lsKeys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(OWNED_PREFIX) === 0) lsKeys.push(k);
      }
    } catch (e) {
      console.warn('[SomtumStore] cannot scan localStorage', e);
    }

    // Load existing IDB keys into memory first
    const idbKeys = await idbGetAllKeys();
    for (const k of idbKeys) {
      if (typeof k === 'string' && k.indexOf('__') === 0) continue;
      const v = await idbGet(k);
      if (v !== undefined && v !== null) memory[k] = String(v);
    }

    // Merge localStorage keys into memory + IDB
    for (const k of lsKeys) {
      const lsVal = safeLSGet(k);
      if (lsVal === null) continue;

      if (k === 'somtumAppData') {
        const lsScore = scoreAppDataRaw(lsVal);
        const idbScore = scoreAppDataRaw(memory[k] || null);
        if (lsScore > idbScore) {
          memory[k] = lsVal;
          await idbSet(k, lsVal);
          console.info('[SomtumStore] migrated somtumAppData from localStorage (richer)', lsScore, '>', idbScore);
        } else if (idbScore >= 0 && !memory[k]) {
          // already in memory from IDB load
        } else if (idbScore < 0 && lsScore >= 0) {
          memory[k] = lsVal;
          await idbSet(k, lsVal);
        }
        // If IDB is richer, still ensure localStorage has a copy for dual-write safety
        if (idbScore > lsScore && memory[k]) {
          safeLSSet(k, memory[k]);
        }
      } else {
        // Non-appData keys: prefer non-empty IDB, else LS
        if (memory[k] === undefined || memory[k] === null || memory[k] === '') {
          memory[k] = lsVal;
          await idbSet(k, lsVal);
        }
      }
    }

    // If IDB had appData but LS did not (e.g. LS cleared / quota), restore LS copy
    if (memory['somtumAppData'] && !lsApp) {
      safeLSSet('somtumAppData', memory['somtumAppData']);
    }

    await idbSet(META_MIGRATED, new Date().toISOString());
    console.info('[SomtumStore] migration complete. keys in memory:', Object.keys(memory).length);
  }

  function enqueueWrite(fn) {
    writeQueue = writeQueue.then(fn).catch((e) => {
      console.error('[SomtumStore] background write error', e);
    });
    return writeQueue;
  }

  const SomtumStore = {
    get isReady() {
      return ready;
    },

    /**
     * Must be awaited before first getItem of app data on cold start.
     * Safe to call multiple times.
     */
    async init() {
      if (ready && db) return true;
      try {
        db = await openDB();
        await migrateFromLocalStorage();
        ready = true;
        global.dispatchEvent(new CustomEvent('somtum-store-ready'));
        return true;
      } catch (e) {
        console.error('[SomtumStore] init failed — falling back to localStorage only', e);
        // Fallback: populate memory from localStorage so app still works
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf(OWNED_PREFIX) === 0) {
              memory[k] = localStorage.getItem(k);
            }
          }
        } catch (e2) { /* ignore */ }
        ready = true; // allow sync API; writes go to LS only
        return false;
      }
    },

    getItem(key) {
      if (Object.prototype.hasOwnProperty.call(memory, key)) {
        return memory[key];
      }
      // Fallback for keys set before init finished
      const ls = safeLSGet(key);
      if (ls !== null) memory[key] = ls;
      return ls;
    },

    setItem(key, value) {
      const str = value === null || value === undefined ? '' : String(value);
      memory[key] = str;

      // Dual-write critical keys to localStorage (best-effort)
      if (CRITICAL_KEYS.has(key) || key.indexOf(OWNED_PREFIX) === 0) {
        safeLSSet(key, str);
      }

      if (db) {
        enqueueWrite(() => idbSet(key, str));
      }
    },

    removeItem(key) {
      delete memory[key];
      safeLSRemove(key);
      if (db) {
        enqueueWrite(() => idbDelete(key));
      }
    },

    getJSON(key) {
      const raw = this.getItem(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },

    setJSON(key, obj) {
      this.setItem(key, JSON.stringify(obj));
    },

    /** Flush pending IDB writes (call before unload if needed) */
    async flush() {
      await writeQueue;
    },

    /** Debug / support */
    async stats() {
      const keys = Object.keys(memory);
      const app = memory['somtumAppData'];
      let txCount = 0;
      try {
        if (app) txCount = (JSON.parse(app).transactions || []).length;
      } catch (e) { /* ignore */ }
      return {
        ready,
        idb: !!db,
        keyCount: keys.length,
        txCount,
        lsWriteFailures,
        migratedAt: memory[META_MIGRATED] || (await idbGet(META_MIGRATED))
      };
    }
  };

  global.SomtumStore = SomtumStore;
})(typeof window !== 'undefined' ? window : self);
