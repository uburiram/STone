/* ============================================================
 * STone — app-core.js
 * Money helpers, boot gate, defaults, categories tree helpers, appData, sanitize, hydrate, date utils
 * Split from js/app.js (behavior unchanged; window.* API kept)
 * Load order: storage → app-core → app-dashboard → app-tx →
 *             app-categories → app-features → reports → firebase
 * ============================================================ */

    /** Money helpers — consistent 2-decimal arithmetic (avoid float drift / NaN) */
    window.roundMoney = function(n) {
      const x = Number(n);
      if (!isFinite(x)) return 0;
      return Math.round(x * 100) / 100;
    };
    /** Sum income/expense from a transaction list. Unknown types are ignored. */
    window.sumIncomeExpense = function(list) {
      let income = 0, expense = 0;
      (list || []).forEach(function(tx) {
        if (!tx) return;
        const a = window.roundMoney(tx.amount);
        if (tx.type === 'income') income = window.roundMoney(income + a);
        else if (tx.type === 'expense') expense = window.roundMoney(expense + a);
      });
      return {
        income: income,
        expense: expense,
        net: window.roundMoney(income - expense)
      };
    };

    window.escapeHTML = function(str) {
      if (str == null) return '';
      if (typeof str !== 'string') str = String(str);
      return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    };
    window.escapeAttr = function(str) {
      return window.escapeHTML(str);
    };

    /**
     * Boot gate: prevent saves / destructive writes until SomtumStore.init + first hydrate finish.
     * Stops empty-state overwrite races on cold start / auth restore.
     */
    window.__storeReady = false;
    window.__bootPromise = null;
    window.whenStoreReady = function() {
      if (window.__storeReady) return Promise.resolve(true);
      return new Promise(function(resolve) {
        if (window.__storeReady) { resolve(true); return; }
        var done = function() { resolve(true); };
        window.addEventListener('somtum-store-ready', done, { once: true });
        // Safety timeout so UI never hangs forever if IDB is blocked
        setTimeout(function() {
          if (!window.__storeReady) {
            console.warn('[boot] store ready timeout — allowing limited operation');
            window.__storeReady = true;
          }
          resolve(true);
        }, 8000);
      });
    };

    /** Early stub: real implementation is assigned by firebase.js module when it loads */
    if (typeof window.saveLocalOnly !== 'function') {
      window.saveLocalOnly = function() {
        try {
          if (window.SomtumStore && typeof SomtumStore.persistAppState === 'function') {
            SomtumStore.persistAppState(window.appData, { writeAllTx: false }).catch(function(e) {
              console.error('persistAppState (stub)', e);
            });
          } else if (window.SomtumStore && typeof SomtumStore.setItem === 'function') {
            try {
              SomtumStore.setItem('somtumAppData', JSON.stringify(window.appData));
            } catch (e2) { console.error(e2); }
          }
        } catch (e) {
          console.error('saveLocalOnly stub failed:', e);
        }
      };
    }

    window.DEFAULT_CATEGORIES = {
      income: [
        { name: 'เงินสด', subs: [] },
        { name: 'เงินโอน', subs: [] },
        { name: 'โครงการรัฐ', subs: ['คนละครึ่ง', 'เราเที่ยวด้วยกัน', 'บัตรสวัสดิการแห่งรัฐ'] },
        { name: 'delivery', subs: ['Grab food', 'LINE Man', 'shopee food'] }
      ],
      expense: [
        { name: 'ซื้อวัตถุดิบต่าง ๆ เพื่อการลงทุน', subs: [], flags: { isMaterialCategory: true } },
        { name: 'ซื้ออุปกรณ์และสิ่งของที่จำเป็น', subs: [], flags: { isEquipmentCategory: true } },
        { name: 'ค่าเช่าสถานที่', subs: ['ค่าเช่าที่', 'ค่าไฟ', 'ค่าน้ำ', 'ค่าเก็บขยะ'] },
        { name: 'ค่าเดินทาง', subs: ['เติมน้ำมัน', 'ค่าที่จอดรถ'] },
        { name: 'ค่าแก๊สหุงต้ม', subs: [] },
        { name: 'ค่าใช้จ่ายแฝงอื่น ๆ', subs: ['ค่าเช่าบ้าน (รวมค่าน้ำค่าไฟ)'] }
      ]
    };

    window.DEFAULT_MATERIALS = ['มะละกอ', 'พริกสด/พริกแห้ง', 'กระเทียม', 'มะนาว', 'น้ำปลา', 'ปลาร้า', 'ปูดำ/ปูม้า', 'หมูกรอบ/หมูยอ', 'เส้นขนมจีน', 'ถั่วฝักยาว', 'ผงชูรส', 'ถุงพลาสติก/กล่อง'];
    window.DEFAULT_EQUIPMENTS = ['ครก/ไม้ตีครก', 'จานชาม/ช้อนส้อม', 'โต๊ะเก้าอี้', 'เขียง/มีด'];


    /** Max category tree depth (level 1 = main category, levels 2–5 = nested under it) */
    window.MAX_CAT_DEPTH = 5;
    /** Separator for nested path stored in transaction.subCategory (legacy plain strings still work) */
    window.CAT_PATH_SEP = ' › ';

    /** Reject names that break nested path encoding or are empty. */
    window.isInvalidCategoryName = function(name) {
      const s = String(name == null ? '' : name).trim();
      if (!s) return 'กรุณาระบุชื่อ';
      if (s.indexOf(window.CAT_PATH_SEP) !== -1) {
        return 'ชื่อต้องไม่มีเครื่องหมาย "' + window.CAT_PATH_SEP + '"';
      }
      // Also block bare › which might be typed without spaces
      if (s.indexOf('›') !== -1) {
        return 'ชื่อต้องไม่มีเครื่องหมาย ›';
      }
      return null;
    };


    window.isCatBranch = function(node) {
      return node && typeof node === 'object' && typeof node.name === 'string';
    };
    window.catNodeName = function(node) {
      if (typeof node === 'string') return node;
      if (window.isCatBranch(node)) return node.name;
      return '';
    };
    window.catNodeChildren = function(node) {
      if (typeof node === 'string') return [];
      if (window.isCatBranch(node) && Array.isArray(node.children)) return node.children;
      return [];
    };
    /** Recursively sanitize a subs array. Preserves legacy string leaves. Depth = nesting under main category (1..4 → total levels 2..5). */
    window.sanitizeSubsTree = function(subs, depth) {
      if (!Array.isArray(subs)) return [];
      if (depth > window.MAX_CAT_DEPTH - 1) return []; // main cat is depth 0 of tree root; children start at depth 1
      const out = [];
      const seen = new Set();
      for (let i = 0; i < subs.length; i++) {
        const s = subs[i];
        if (typeof s === 'string') {
          const name = String(s).trim().slice(0, 200);
          if (!name) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(name);
        } else if (window.isCatBranch(s)) {
          const name = String(s.name).trim().slice(0, 200);
          if (!name) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const children = window.sanitizeSubsTree(s.children, depth + 1);
          if (children.length > 0) {
            out.push({ name: name, children: children });
          } else {
            // empty branch → store as plain leaf (backward-friendly)
            out.push(name);
          }
        }
      }
      return out;
    };
    /** Walk tree by name path (array of names under main cat). Returns node or null. */
    window.findCatNodeByPath = function(subs, namePath) {
      let list = Array.isArray(subs) ? subs : [];
      let node = null;
      for (let d = 0; d < namePath.length; d++) {
        const want = namePath[d];
        node = null;
        for (let i = 0; i < list.length; i++) {
          if (window.catNodeName(list[i]) === want) {
            node = list[i];
            break;
          }
        }
        if (node == null) return null;
        list = window.catNodeChildren(node);
      }
      return node;
    };
    /** Direct children list for a path under category.subs (empty path → top-level subs). */
    window.getChildrenAtPath = function(subs, namePath) {
      if (!namePath || namePath.length === 0) return Array.isArray(subs) ? subs : [];
      const node = window.findCatNodeByPath(subs, namePath);
      return window.catNodeChildren(node);
    };
    /** True if this category has any selectable sub structure (tree or flat). */
    window.categoryHasSubs = function(cat) {
      return !!(cat && Array.isArray(cat.subs) && cat.subs.length > 0);
    };
    /** Collect leaf names (flat) — for legacy includes checks. */
    window.collectLeafNames = function(subs, acc) {
      acc = acc || [];
      (subs || []).forEach(function(n) {
        const kids = window.catNodeChildren(n);
        if (kids.length === 0) acc.push(window.catNodeName(n));
        else window.collectLeafNames(kids, acc);
      });
      return acc;
    };


    window.appData = {
      transactions: [],
      categories: JSON.parse(JSON.stringify(window.DEFAULT_CATEGORIES)),
      materials: [...window.DEFAULT_MATERIALS],
      equipments: [...window.DEFAULT_EQUIPMENTS],
      customGoal: null,          // เป้าเป็นจำนวนเงิน (บาท)
      customGoalPercent: null    // เป้าเป็น % มาร์กอัปบนรายจ่าย (60 = ×1.6)
    };

    /** คำนวณยอดเป้าหมายรายรับจากโหมดที่ตั้งไว้ */
    window.resolveTargetGoal = function(totalExpense, totalIncome) {
      const exp = Number(totalExpense) || 0;
      const inc = Number(totalIncome) || 0;
      // 1) ตั้งเป็นจำนวนเงิน
      if (window.appData.customGoal && window.appData.customGoal > 0) {
        return window.roundMoney(window.appData.customGoal);
      }
      // 2) ตั้งเป็นเปอร์เซ็นต์มาร์กอัปบนรายจ่าย (เช่น 60 → รายจ่าย × 1.6)
      if (window.appData.customGoalPercent !== null && window.appData.customGoalPercent !== undefined) {
        const pct = Number(window.appData.customGoalPercent);
        if (!isNaN(pct) && pct >= 0) {
          if (exp > 0) return window.roundMoney(exp * (1 + pct / 100));
          if (inc > 0) return window.roundMoney(inc);
          return 1000;
        }
      }
      // 3) สูตรเริ่มต้น = มาร์กอัป 60%
      if (exp > 0) return window.roundMoney(exp * 1.6);
      if (inc > 0) return window.roundMoney(inc);
      return 1000;
    };

    window.sanitizeAppData = function(data) {
      if (!data || typeof data !== 'object') {
        data = {};
      }
      // Clean any leftover multi-shop keys
      delete data.shops;
      delete data.currentShopId;
      delete data.version;

      if (!Array.isArray(data.transactions)) data.transactions = [];
      if (!data.categories || typeof data.categories !== 'object') {
        data.categories = JSON.parse(JSON.stringify(window.DEFAULT_CATEGORIES));
      }
      if (!Array.isArray(data.categories.income)) {
        data.categories.income = JSON.parse(JSON.stringify(window.DEFAULT_CATEGORIES.income));
      }
      if (!Array.isArray(data.categories.expense)) {
        data.categories.expense = JSON.parse(JSON.stringify(window.DEFAULT_CATEGORIES.expense));
      }
      ['income', 'expense'].forEach(type => {
        data.categories[type] = data.categories[type].filter(c => c && typeof c.name === 'string').map(c => {
          const cleaned = {
            name: String(c.name).slice(0, 100),
            // Nested tree up to MAX_CAT_DEPTH; legacy string[] leaves preserved as-is
            subs: window.sanitizeSubsTree(Array.isArray(c.subs) ? c.subs : [], 1)
          };
          // Firestore rejects undefined — only include flags when present
          if (c.flags && typeof c.flags === 'object') {
            cleaned.flags = {};
            if (c.flags.isMaterialCategory) cleaned.flags.isMaterialCategory = true;
            if (c.flags.isEquipmentCategory) cleaned.flags.isEquipmentCategory = true;
            if (Object.keys(cleaned.flags).length === 0) delete cleaned.flags;
          }
          return cleaned;
        });
        if (data.categories[type].length === 0) {
          data.categories[type] = JSON.parse(JSON.stringify(window.DEFAULT_CATEGORIES[type]));
        }
      });
      if (!Array.isArray(data.materials)) data.materials = [...window.DEFAULT_MATERIALS];
      if (!Array.isArray(data.equipments)) data.equipments = [...window.DEFAULT_EQUIPMENTS];
      if (data.customGoal !== null && data.customGoal !== undefined) {
        const g = Number(data.customGoal);
        data.customGoal = (!isNaN(g) && g > 0) ? g : null;
      } else {
        data.customGoal = null;
      }
      if (data.customGoalPercent !== null && data.customGoalPercent !== undefined) {
        const p = Number(data.customGoalPercent);
        data.customGoalPercent = (!isNaN(p) && p >= 0) ? p : null;
      } else {
        data.customGoalPercent = null;
      }
      data.transactions = data.transactions.filter(tx => {
        // Validate date format YYYY-MM-DD
        const dateOk = typeof tx.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tx.date);
        return tx && typeof tx === 'object'
          && (tx.type === 'income' || tx.type === 'expense')
          && dateOk
          && !isNaN(Number(tx.amount)) && Number(tx.amount) > 0;
      }).map(tx => ({
        id: String(tx.id || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2))),
        type: tx.type,
        date: tx.date,
        time: (typeof tx.time === 'string' && /^\d{2}:\d{2}/.test(tx.time)) ? tx.time.slice(0,5) : '00:00',
        category: String(tx.category || 'ไม่ระบุ').slice(0, 100),
        subCategory: tx.subCategory ? String(tx.subCategory).slice(0, 200) : '',
        amount: Number(Number(tx.amount).toFixed(2)),
        note: tx.note ? String(tx.note).slice(0, 500) : ''
      }));
      return data;
    };

    // CRITICAL: Hydrate from SomtumStore (IndexedDB primary, localStorage fallback).
    // Safe to call before/after SomtumStore.init() — getItem falls back to LS until migration runs.
    // Module script (Firebase Auth) may restore session before onload; empty appData would cause data loss.
    window.__txCacheLoaded = false;
    window.__loadedRange = { start: null, end: null };

    /** Compute YYYY-MM-DD bounds for current time filter (inclusive). null = all */
    window.getFilterDateBounds = function() {
      const now = new Date();
      const ymd = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
      };
      if (currentFilter === 'custom') {
        return { start: selectedCustomDate, end: selectedCustomDate };
      }
      if (currentFilter === 'range') {
        let a = selectedStartDate, b = selectedEndDate;
        if (a && b && a > b) { const t = a; a = b; b = t; }
        return { start: a || null, end: b || null };
      }
      if (currentFilter === 'daily') {
        const t = getLocalYYYYMMDD();
        return { start: t, end: t };
      }
      if (currentFilter === 'weekly') {
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() + diff);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        return { start: ymd(startOfWeek), end: ymd(endOfWeek) };
      }
      if (currentFilter === 'monthly') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { start: ymd(start), end: ymd(end) };
      }
      if (currentFilter === 'yearly') {
        return { start: now.getFullYear() + '-01-01', end: now.getFullYear() + '-12-31' };
      }
      return { start: null, end: null }; // all
    };

    /** Load transactions for filter range into appData (from IDB, not giant LS blob) */
    window.ensureTransactionsLoaded = async function(force) {
      if (!window.SomtumStore || !SomtumStore.getTxByDateRange) return;
      const bounds = window.getFilterDateBounds();
      let start = bounds.start;
      let end = bounds.end;

      // IMPORTANT:
      // - filter "all" => start/end are null => must load EVERY transaction (unbounded).
      // - Do NOT shrink unbounded range to the visible calendar month
      //   (that bug made KPI "ทั้งหมด" only count the calendar month).
      // - When range is already bounded (daily/weekly/month/…), expand to also
      //   cover the month shown on the calendar so the calendar grid is complete.
      const isUnbounded = (start == null && end == null);
      if (!isUnbounded && typeof calendarCurrentDate !== 'undefined' && calendarCurrentDate) {
        const cy = calendarCurrentDate.getFullYear();
        const cm = calendarCurrentDate.getMonth();
        const cStart = cy + '-' + String(cm + 1).padStart(2, '0') + '-01';
        const lastDay = new Date(cy, cm + 1, 0).getDate();
        const cEnd = cy + '-' + String(cm + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
        if (!start || cStart < start) start = cStart;
        if (!end || cEnd > end) end = cEnd;
      }

      const same = window.__loadedRange && window.__loadedRange.start === start && window.__loadedRange.end === end;
      if (same && window.__txCacheLoaded && !force) return;

      try {
        // null,null => getAll via openCursor (see storage.getTxByDateRange)
        const list = await SomtumStore.getTxByDateRange(start, end);
        let merged = list || [];
        // Preserve in-memory txs that are still dirty (just saved / offline) and missing
        // from this IDB range read — prevents UI flash-empty right after save while logged in.
        try {
          const dirtyIds = SomtumStore.getDirtyIds ? await SomtumStore.getDirtyIds() : [];
          if (dirtyIds && dirtyIds.length) {
            const have = new Set(merged.map(function(t) { return t && t.id ? String(t.id) : ''; }));
            const mem = (window.appData && window.appData.transactions) || [];
            for (let i = 0; i < dirtyIds.length; i++) {
              const id = String(dirtyIds[i]);
              if (have.has(id)) continue;
              let tx = mem.find(function(t) { return t && String(t.id) === id; });
              if (!tx && SomtumStore.getTx) tx = await SomtumStore.getTx(id);
              if (!tx || !tx.date) continue;
              // Only include if within requested range (or unbounded)
              if (start && tx.date < start) continue;
              if (end && tx.date > end) continue;
              merged.push(tx);
              have.add(id);
            }
          }
        } catch (mergeErr) {
          console.warn('ensureTransactionsLoaded dirty merge', mergeErr);
        }
        window.appData.transactions = merged;
        window.__loadedRange = { start: start, end: end };
        window.__txCacheLoaded = true;
      } catch (e) {
        console.error('ensureTransactionsLoaded failed', e);
      }
    };

    window.__hydrateAppDataFromStore = function(preferRicher) {
      // Sync path: try meta + optional legacy blob only for structure defaults
      // NEVER replace a non-empty in-memory tx list with empty (race protection)
      try {
        const savedData = SomtumStore.getItem('somtumAppData');
        if (savedData) {
          const parsed = window.sanitizeAppData(JSON.parse(savedData));
          const memLen = (window.appData && Array.isArray(window.appData.transactions))
            ? window.appData.transactions.length : 0;
          const diskLen = (parsed.transactions || []).length;
          const applyMeta = function() {
            window.appData.categories = parsed.categories;
            window.appData.materials = parsed.materials;
            window.appData.equipments = parsed.equipments;
            window.appData.customGoal = parsed.customGoal;
            if (parsed.customGoalPercent !== undefined) {
              window.appData.customGoalPercent = parsed.customGoalPercent;
            }
          };
          if (preferRicher && memLen > 0) {
            if (diskLen >= memLen) {
              applyMeta();
              if (!window.__txCacheLoaded) window.appData.transactions = parsed.transactions;
            } else {
              // Keep richer memory txs; still take categories if present
              if (parsed.categories) window.appData.categories = parsed.categories;
            }
          } else {
            applyMeta();
            // Only adopt disk txs when memory is empty / not yet loaded from IDB
            if (!window.__txCacheLoaded && (memLen === 0 || diskLen >= memLen)) {
              window.appData.transactions = parsed.transactions || [];
            }
          }
        } else if (!window.appData || !Array.isArray(window.appData.transactions)) {
          window.appData = window.sanitizeAppData(window.appData || {});
        }
      } catch (e) {
        console.error('Hydrate from SomtumStore failed:', e);
        if (!window.appData || !Array.isArray(window.appData.transactions)) {
          window.appData = window.sanitizeAppData({});
        }
      }
    };

    window.__hydrateAppDataFromStoreAsync = async function() {
      try {
        if (SomtumStore.getMeta) {
          const meta = await SomtumStore.getMeta();
          if (meta) {
            if (meta.categories) window.appData.categories = meta.categories;
            if (meta.materials) window.appData.materials = meta.materials;
            if (meta.equipments) window.appData.equipments = meta.equipments;
            if (meta.customGoal !== undefined) window.appData.customGoal = meta.customGoal;
            if (meta.customGoalPercent !== undefined) window.appData.customGoalPercent = meta.customGoalPercent;
            window.appData = window.sanitizeAppData(window.appData);
          }
        }
        // Prefer full history on first paint so no month looks "missing"
        let n = SomtumStore.countTx ? await SomtumStore.countTx() : 0;
        if (n > 0 && SomtumStore.getAllTx) {
          const all = await SomtumStore.getAllTx();
          // Do not clobber a richer in-memory list (e.g. just-added tx before IDB flush)
          const memLen = (window.appData.transactions || []).length;
          if (!window.__txCacheLoaded || (all && all.length >= memLen)) {
            window.appData.transactions = all || [];
          }
          window.__txCacheLoaded = true;
          window.__loadedRange = { start: null, end: null };
        } else {
          await window.ensureTransactionsLoaded(true);
        }
        // Recovery: if IDB empty but legacy blob exists, force structured import.
        // Skip when already migrated and empty (intentional clearAllUserData) so data
        // does not silently reappear after user wiped it.
        n = SomtumStore.countTx ? await SomtumStore.countTx() : 0;
        if (n === 0) {
          let alreadyMigrated = false;
          try {
            const mig = SomtumStore.getItem && SomtumStore.getItem('__migrated_v2');
            alreadyMigrated = !!mig;
            if (!alreadyMigrated && SomtumStore.getMeta) {
              // FLAG may live only in IDB kv after clear re-seed
              const stats = SomtumStore.stats ? await SomtumStore.stats() : null;
              if (stats && stats.migratedAt) alreadyMigrated = true;
            }
          } catch (e) { /* */ }
          if (alreadyMigrated) {
            console.info('[hydrate] IDB empty + migrated — skip legacy blob recovery (intentional clear)');
          } else {
            const raw = SomtumStore.getItem('somtumAppData');
            if (raw) {
              try {
                const parsed = window.sanitizeAppData(JSON.parse(raw));
                if ((parsed.transactions || []).length > 0 && SomtumStore.persistAppState) {
                  await SomtumStore.persistAppState(parsed, { writeAllTx: true });
                  window.appData = parsed;
                  window.__txCacheLoaded = true;
                  window.__loadedRange = { start: null, end: null };
                  console.info('[hydrate] recovered', parsed.transactions.length, 'txs from legacy blob');
                }
              } catch (e2) { console.warn(e2); }
            }
          }
        }
      } catch (e) {
        console.error('async hydrate failed', e);
        window.__hydrateAppDataFromStore(true);
      } finally {
        window.__storeReady = true;
        try {
          window.dispatchEvent(new CustomEvent('somtum-app-hydrated'));
        } catch (ev) { /* */ }
      }
    };

    /** Always load full tx set from IDB for bulk ops (export / rename / force sync) */
    window.loadAllTransactions = async function() {
      if (window.SomtumStore && typeof SomtumStore.getAllTx === 'function') {
        try {
          const all = await SomtumStore.getAllTx();
          if (Array.isArray(all)) {
            window.appData.transactions = all;
            window.__txCacheLoaded = true;
            window.__loadedRange = { start: null, end: null };
            return all;
          }
        } catch (e) {
          console.warn('loadAllTransactions', e);
        }
      }
      return window.appData.transactions || [];
    };

    window.__hydrateAppDataFromStore(false);

    // After IDB migration, load meta + range (not full blob into RAM forever)
    if (window.SomtumStore && typeof window.SomtumStore.init === 'function') {
      window.__bootPromise = window.SomtumStore.init().then(async function () {
        await window.__hydrateAppDataFromStoreAsync();
        if (typeof window.refreshDashboard === 'function' && document.getElementById('kpiTotalIncome')) {
          try { await window.refreshDashboard(); } catch (e) { /* UI may not be ready */ }
        }
        return true;
      }).catch(function (e) {
        console.warn('SomtumStore.init from app.js:', e);
        window.__storeReady = true;
        return false;
      });
    } else {
      window.__storeReady = true;
    }

    window.getLocalYYYYMMDD = function(dateObj = new Date()) {
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    function parseLocalDate(dateString) {
      if(!dateString) return new Date();
      const parts = dateString.split('-');
      if(parts.length !== 3) return new Date();
      return new Date(parts[0], parts[1]-1, parts[2]);
    }
