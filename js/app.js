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

    let currentFilter = 'monthly';
    let selectedCustomDate = getLocalYYYYMMDD();
    let selectedStartDate = getLocalYYYYMMDD();
    let selectedEndDate = getLocalYYYYMMDD();
    let selectedCalendarDay = getLocalYYYYMMDD();
    let calendarCurrentDate = new Date();
    let managerType = 'income';
    let _editTxIdTemp = null;
    let currentReportTab = 'income';
    let historyDisplayLimit = 50;
    let reportDisplayLimit = 50;
    let lastCardDetailType = null;

    window.finishLoading = function() {
      const overlay = document.getElementById('loadingOverlay');
      if(overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.classList.add('hidden'), 300);
      }
      window.refreshDashboard();
    }

    window.showToast = function(msg, type = 'success') {
      const toast = document.getElementById('toast');
      document.getElementById('toastMsg').innerText = msg;
      document.getElementById('toastIcon').className = type === 'success' ? 'fa-solid fa-circle-check text-emerald-400' : 'fa-solid fa-circle-xmark text-rose-400';
      toast.style.opacity = '1';
      setTimeout(() => toast.style.opacity = '0', 3000);
    }

    window.showConfirmModal = function(title, desc, onConfirmCallback) {
      const modal = document.getElementById('customConfirmModal');
      document.getElementById('confirmModalTitle').innerText = title;
      document.getElementById('confirmModalDesc').innerText = desc;
      const btnOk = document.getElementById('confirmModalBtnOk');
      const btnCancel = document.getElementById('confirmModalBtnCancel');
      
      const newBtnOk = btnOk.cloneNode(true);
      const newBtnCancel = btnCancel.cloneNode(true);
      btnOk.parentNode.replaceChild(newBtnOk, btnOk);
      btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

      newBtnOk.onclick = () => {
        modal.classList.add('hidden');
        if (onConfirmCallback) onConfirmCallback();
      };
      newBtnCancel.onclick = () => {
        modal.classList.add('hidden');
      };
      modal.classList.remove('hidden');
    };

    window.closeRenameModal = function() {
      document.getElementById('renameModal').classList.add('hidden');
      window._renameCallback = null;
    };

    window.openRenameModal = function(title, desc, currentValue, onSave) {
      const modal = document.getElementById('renameModal');
      document.getElementById('renameModalTitle').innerText = title;
      document.getElementById('renameModalDesc').innerText = desc || 'กรอกชื่อใหม่ด้านล่าง';
      const input = document.getElementById('renameModalInput');
      input.value = currentValue || '';
      window._renameCallback = onSave;

      const btnOk = document.getElementById('renameModalBtnOk');
      const newBtnOk = btnOk.cloneNode(true);
      btnOk.parentNode.replaceChild(newBtnOk, btnOk);
      newBtnOk.onclick = () => {
        const val = input.value.trim();
        if (!val) {
          alert('ชื่อห้ามว่าง');
          input.focus();
          return;
        }
        modal.classList.add('hidden');
        if (window._renameCallback) window._renameCallback(val);
        window._renameCallback = null;
      };

      // Enter key submits
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          newBtnOk.click();
        } else if (e.key === 'Escape') {
          window.closeRenameModal();
        }
      };

      modal.classList.remove('hidden');
      setTimeout(() => { input.focus(); input.select(); }, 50);
    };

    function createDynamicManifest() {
      // Prefer static manifest.webmanifest (TWA / Play). Dynamic blob remains as fallback.

      const manifest = {
        // name = ชื่อเต็มตอนติดตั้ง / หน้าข้อมูลแอป
        name: "ระบบบันทึกต้นทุน กำไร - STone",
        // short_name = ชื่อใต้ไอคอนบนหน้าจอ (สั้นเพื่อไม่ถูกตัด)
        short_name: "STone",
        description: "ระบบบันทึกต้นทุน กำไร - STone",
        start_url: "./",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ea580c",
        icons: [
          { src: "./icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "./icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "./icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "./icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      };
      const blob = new Blob([JSON.stringify(manifest)], {type: 'application/json'});
      document.getElementById('manifest-placeholder').setAttribute('href', URL.createObjectURL(blob));
    }

    window.onload = function() {
      createDynamicManifest();
      // Re-hydrate after store init / migration (prefer richer dataset).
      if (typeof window.__hydrateAppDataFromStore === 'function') {
        window.__hydrateAppDataFromStore(true);
      } else if (!window.appData || !Array.isArray(window.appData.transactions)) {
        try {
          const savedData = SomtumStore.getItem('somtumAppData');
          window.appData = window.sanitizeAppData(savedData ? JSON.parse(savedData) : {});
        } catch (e) {
          console.error('Load local data failed:', e);
          window.appData = window.sanitizeAppData({});
        }
      }
      document.getElementById('selectedDate').value = selectedCustomDate;
      document.getElementById('startDate').value = selectedStartDate;
      document.getElementById('endDate').value = selectedEndDate;
      window.setTimeFilter('monthly');
      window.finishLoading();

      if (SomtumStore.getItem('somtumHasUnsyncedData') === 'true') {
        setTimeout(() => {
          const m = document.getElementById('syncPromptModal');
          if (m) m.classList.remove('hidden');
        }, 1000);
      }
    };

    window.setTimeFilter = function(filter) {
      currentFilter = filter;
      historyDisplayLimit = 50;
      reportDisplayLimit = 50;
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('bg-brand-600', 'text-white', 'shadow-sm');
        btn.classList.add('text-gray-600', 'dark:text-gray-300');
      });
      const activeBtn = document.getElementById(`filter-${filter}`);
      if (activeBtn) {
        activeBtn.classList.add('bg-brand-600', 'text-white', 'shadow-sm');
        activeBtn.classList.remove('text-gray-600', 'dark:text-gray-300');
      }

      const singleContainer = document.getElementById('singleDateContainer');
      const rangeContainer = document.getElementById('rangeDateContainer');

      if (filter === 'custom') {
        singleContainer.classList.remove('hidden');
        singleContainer.classList.add('flex');
        rangeContainer.classList.add('hidden');
        rangeContainer.classList.remove('flex');
      } else if (filter === 'range') {
        rangeContainer.classList.remove('hidden');
        rangeContainer.classList.add('flex');
        singleContainer.classList.add('hidden');
        singleContainer.classList.remove('flex');
      } else {
        singleContainer.classList.add('hidden');
        singleContainer.classList.remove('flex');
        rangeContainer.classList.add('hidden');
        rangeContainer.classList.remove('flex');
      }
      window.refreshDashboard();
    }

    window.onCustomDateSelect = function() {
      selectedCustomDate = document.getElementById('selectedDate').value;
      window.setTimeFilter('custom');
    };

    window.onDateRangeSelect = function() {
      selectedStartDate = document.getElementById('startDate').value;
      selectedEndDate = document.getElementById('endDate').value;
      if (selectedStartDate && selectedEndDate) {
        // Swap UI values if user picked inverted range
        if (selectedStartDate > selectedEndDate) {
          const tmp = selectedStartDate;
          selectedStartDate = selectedEndDate;
          selectedEndDate = tmp;
          document.getElementById('startDate').value = selectedStartDate;
          document.getElementById('endDate').value = selectedEndDate;
        }
        window.setTimeFilter('range');
      }
    };

    // Time-range filter only (used by KPI / ratio / goals — must NOT be affected by
    // history search / type / category / amount / note filters).
    window.getTimeFilteredTransactions = function() {
      const txList = window.appData.transactions || [];
      const now = new Date();
      // Normalize inverted custom range so start <= end
      let rangeStart = selectedStartDate;
      let rangeEnd = selectedEndDate;
      if (currentFilter === 'range' && rangeStart && rangeEnd && rangeStart > rangeEnd) {
        const tmp = rangeStart; rangeStart = rangeEnd; rangeEnd = tmp;
      }

      return txList.filter(tx => {
        const txDate = parseLocalDate(tx.date);
        if (currentFilter === 'custom') {
          return tx.date === selectedCustomDate;
        }
        if (currentFilter === 'range') {
          if (!rangeStart || !rangeEnd) return true;
          return tx.date >= rangeStart && tx.date <= rangeEnd;
        }
        if (currentFilter === 'daily') {
          return tx.date === getLocalYYYYMMDD();
        }
        if (currentFilter === 'weekly') {
          const day = now.getDay();
          const diff = day === 0 ? -6 : 1 - day;
          const startOfWeek = new Date(now);
          startOfWeek.setDate(now.getDate() + diff);
          startOfWeek.setHours(0, 0, 0, 0);
          const endOfWeek = new Date(startOfWeek);
          endOfWeek.setDate(startOfWeek.getDate() + 6);
          endOfWeek.setHours(23, 59, 59, 999);
          return txDate >= startOfWeek && txDate <= endOfWeek;
        }
        if (currentFilter === 'monthly') {
          return txDate.getMonth() === now.getMonth() && txDate.getFullYear() === now.getFullYear();
        }
        if (currentFilter === 'yearly') {
          return txDate.getFullYear() === now.getFullYear();
        }
        return true; // 'all'
      });
    };

    // Full filter: time + history UI filters (search / type / category / amount / note)
    window.getFilteredTransactions = function() {
      const searchQuery = (document.getElementById('searchTxInput') || {value:''}).value.toLowerCase();
      const histType = (document.getElementById('histFilterType') || {value:'all'}).value;
      const histCat = (document.getElementById('histFilterCategory') || {value:'all'}).value;
      const minAmtRaw = (document.getElementById('histFilterMinAmt') || {value:''}).value;
      const maxAmtRaw = (document.getElementById('histFilterMaxAmt') || {value:''}).value;
      const hasNoteOnly = !!(document.getElementById('histFilterHasNote') || {}).checked;
      const minAmt = minAmtRaw === '' ? null : Number(minAmtRaw);
      const maxAmt = maxAmtRaw === '' ? null : Number(maxAmtRaw);

      return window.getTimeFilteredTransactions().filter(tx => {
        if (histType !== 'all' && tx.type !== histType) return false;
        if (histCat !== 'all' && tx.category !== histCat) return false;

        const amt = Number(tx.amount) || 0;
        if (minAmt !== null && !isNaN(minAmt) && amt < minAmt) return false;
        if (maxAmt !== null && !isNaN(maxAmt) && amt > maxAmt) return false;
        if (hasNoteOnly && !(tx.note && String(tx.note).trim())) return false;

        if (searchQuery) {
          const txt = `${tx.category} ${tx.subCategory || ''} ${tx.note || ''}`.toLowerCase();
          if (!txt.includes(searchQuery)) return false;
        }
        return true;
      });
    };

    window.populateHistoryCategoryFilter = function() {
      const sel = document.getElementById('histFilterCategory');
      if (!sel) return;
      const prev = sel.value;
      const names = new Set();
      (window.appData.categories?.income || []).forEach(c => names.add(c.name));
      (window.appData.categories?.expense || []).forEach(c => names.add(c.name));
      (window.appData.transactions || []).forEach(t => { if (t.category) names.add(t.category); });
      sel.innerHTML = '<option value="all">ทุกหมวดหมู่</option>' +
        [...names].sort().map(n => `<option value="${escapeAttr(String(n))}">${escapeHTML(String(n))}</option>`).join('');
      if ([...names].includes(prev) || prev === 'all') sel.value = prev;
    };

    window.renderDrillDownAccordion = function(txList, containerId, prefix = 'dd') {
      const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
      if (!container) return;
      if (!txList || txList.length === 0) {
        container.innerHTML = `<div class="text-center py-6 text-gray-400 text-xs">ไม่มีรายการข้อมูล</div>`;
        return;
      }

      /** Group one type's transactions by category → subCategory */
      function buildTypeGroup(list) {
        const grouped = {};
        (list || []).forEach(function(tx) {
          const cat = tx.category || 'ไม่ระบุหมวดหมู่';
          const sub = tx.subCategory || 'ทั่วไป';
          if (!grouped[cat]) grouped[cat] = { total: 0, subs: {} };
          grouped[cat].total = window.roundMoney(grouped[cat].total + window.roundMoney(tx.amount));
          if (!grouped[cat].subs[sub]) grouped[cat].subs[sub] = { total: 0, items: [] };
          grouped[cat].subs[sub].total = window.roundMoney(grouped[cat].subs[sub].total + window.roundMoney(tx.amount));
          grouped[cat].subs[sub].items.push(tx);
        });
        return grouped;
      }

      function renderTypeSection(typeKey, typeLabel, typeColorClass, grouped, sectionIdx) {
        const catNames = Object.keys(grouped);
        if (catNames.length === 0) return '';
        let typeTotal = 0;
        catNames.forEach(function(c) { typeTotal = window.roundMoney(typeTotal + grouped[c].total); });
        let html = `
          <div class="mb-3">
            <div class="flex justify-between items-center px-1 mb-1.5">
              <span class="text-xs font-bold ${typeColorClass} flex items-center gap-1.5">
                <i class="fa-solid ${typeKey === 'income' ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'} text-[10px]"></i>
                ${typeLabel}
              </span>
              <span class="text-xs font-bold ${typeColorClass}">฿${typeTotal.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
            </div>
        `;
        catNames.forEach(function(catName, catIdx) {
          const catData = grouped[catName];
          const catId = prefix + '-' + typeKey + '-cat-' + sectionIdx + '-' + catIdx;
          let subHtml = '';
          Object.keys(catData.subs).forEach(function(subName, subIdx) {
            const subData = catData.subs[subName];
            const subId = prefix + '-' + typeKey + '-sub-' + sectionIdx + '-' + catIdx + '-' + subIdx;
            const itemsHtml = subData.items.map(function(it) {
              const isInc = it.type === 'income';
              const safeId = window.escapeAttr(it.id);
              return `
              <div class="flex justify-between items-center py-1.5 px-2.5 text-xs bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 my-1 shadow-2xs cursor-pointer hover:border-brand-300 transition-all" onclick="editTransaction('${safeId}')" title="แตะเพื่อแก้ไข">
                <div class="flex flex-col">
                  <span class="font-medium text-gray-800 dark:text-gray-100 text-[11px]">${escapeHTML(it.date)} ${it.time ? '• ' + escapeHTML(it.time) : ''}</span>
                  <span class="text-[10px] text-gray-500">${escapeHTML(it.category || '')}${it.subCategory ? ' • ' + escapeHTML(it.subCategory) : ''}</span>
                  ${it.note ? `<span class="text-[10px] text-gray-400 italic">${escapeHTML(it.note)}</span>` : ''}
                </div>
                <div class="flex items-center gap-2" onclick="event.stopPropagation()">
                  <span class="font-bold text-xs ${isInc ? 'text-emerald-600' : 'text-rose-600'}">
                    ${isInc ? '+' : '-'}฿${Number(it.amount).toLocaleString('th-TH', {minimumFractionDigits: 2})}
                  </span>
                  <div class="flex gap-1.5 ml-1">
                    <button onclick="editTransaction('${safeId}')" class="text-brand-500 hover:text-brand-700 text-[11px] p-0.5" title="แก้ไข"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="deleteTransaction('${safeId}')" class="text-gray-400 hover:text-rose-600 text-[11px] p-0.5" title="ลบ"><i class="fa-solid fa-trash"></i></button>
                  </div>
                </div>
              </div>`;
            }).join('');

            subHtml += `
            <div class="bg-gray-50/80 dark:bg-gray-900/40 rounded-xl p-2 border border-gray-100 dark:border-gray-700 my-1.5">
              <div class="flex justify-between items-center text-xs font-semibold text-gray-700 dark:text-gray-200 cursor-pointer py-0.5" onclick="toggleSubDetail('${subId}')">
                <span class="flex items-center gap-1.5">
                  <i class="fa-solid fa-angle-right text-gray-400 text-[10px] transition-transform" id="icon-${subId}"></i>
                  <span>${escapeHTML(subName)}</span>
                  <span class="text-[9px] bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-200 px-1.5 py-0.2 rounded-full font-normal">${subData.items.length}</span>
                </span>
                <span class="font-bold text-gray-700 dark:text-gray-200">฿${subData.total.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
              </div>
              <div id="${subId}" class="hidden mt-1.5 pt-1 border-t border-gray-200/60 dark:border-gray-600 space-y-1">
                ${itemsHtml}
              </div>
            </div>`;
          });

          html += `
          <div class="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xs p-3 my-2">
            <div class="flex justify-between items-center cursor-pointer" onclick="toggleSubDetail('${catId}')">
              <span class="font-bold text-xs text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <i class="fa-solid fa-folder text-brand-500"></i>
                <span>${escapeHTML(catName)}</span>
              </span>
              <span class="font-bold text-xs text-gray-800 dark:text-gray-100 flex items-center gap-1">
                ฿${catData.total.toLocaleString('th-TH', {minimumFractionDigits: 2})}
                <i class="fa-solid fa-caret-down text-gray-400 ml-1 transition-transform" id="icon-${catId}"></i>
              </span>
            </div>
            <div id="${catId}" class="hidden space-y-1 pt-2">
              ${subHtml}
            </div>
          </div>`;
        });
        html += '</div>';
        return html;
      }

      const incomeList = [];
      const expenseList = [];
      (txList || []).forEach(function(tx) {
        if (!tx) return;
        if (tx.type === 'income') incomeList.push(tx);
        else if (tx.type === 'expense') expenseList.push(tx);
      });

      const incGrouped = buildTypeGroup(incomeList);
      const expGrouped = buildTypeGroup(expenseList);

      let html = '';
      html += renderTypeSection('income', 'รายรับ', 'text-emerald-700 dark:text-emerald-300', incGrouped, 0);
      html += renderTypeSection('expense', 'รายจ่าย', 'text-rose-700 dark:text-rose-300', expGrouped, 1);

      if (!html) {
        container.innerHTML = `<div class="text-center py-6 text-gray-400 text-xs">ไม่มีรายการข้อมูล</div>`;
        return;
      }
      container.innerHTML = html;
    };

    window.toggleSubDetail = function(id) {
      const el = document.getElementById(id);
      if(el) {
        el.classList.toggle('hidden');
        const icon = document.getElementById('icon-' + id);
        if (icon) icon.classList.toggle('rotate-180');
      }
    }

    window.refreshDashboard = async function() {
      try {
        if (typeof window.ensureTransactionsLoaded === 'function') {
          await window.ensureTransactionsLoaded(false);
        }
      } catch (e) { console.warn('tx load before refresh', e); }
      if (typeof window.populateHistoryCategoryFilter === 'function') window.populateHistoryCategoryFilter();
      // KPI / ratio / goal: time filter only (not history search/type/category filters)
      const kpiTx = window.getTimeFilteredTransactions();
      // History list & category report: full filters
      const filteredTx = window.getFilteredTransactions();
      const sums = window.sumIncomeExpense(kpiTx);
      const totalIncome = sums.income;
      const totalExpense = sums.expense;

      const netProfit = sums.net;
      const targetGoal = window.resolveTargetGoal(totalExpense, totalIncome);
      const goalAchievedPercent = targetGoal > 0 ? (totalIncome / targetGoal) * 100 : 0;

      document.getElementById('kpiTotalIncome').innerText = `฿${totalIncome.toLocaleString('th-TH', {minimumFractionDigits:2})}`;
      document.getElementById('kpiTotalExpense').innerText = `฿${totalExpense.toLocaleString('th-TH', {minimumFractionDigits:2})}`;
      document.getElementById('kpiNetProfit').innerText = `฿${netProfit.toLocaleString('th-TH', {minimumFractionDigits:2})}`;
      document.getElementById('kpiTargetAmount').innerText = `฿${targetGoal.toLocaleString('th-TH', {minimumFractionDigits:2})}`;

      const totalBoth = totalIncome + totalExpense;
      document.getElementById('kpiIncomePercent').innerText = totalBoth > 0 ? `คิดเป็น ${((totalIncome/totalBoth)*100).toFixed(1)}% ของกระแสเงิน` : '';
      document.getElementById('kpiExpensePercent').innerText = totalBoth > 0 ? `คิดเป็น ${((totalExpense/totalBoth)*100).toFixed(1)}% ของกระแสเงิน` : '';

      const pmElem = document.getElementById('kpiProfitMargin');
      if (totalIncome > 0) {
        const pm = (netProfit / totalIncome) * 100;
        pmElem.innerText = `อัตรากำไรสุทธิ: ${pm.toFixed(1)}%`;
        pmElem.className = `text-[10px] mt-0.5 font-bold ${pm >= 0 ? 'text-emerald-500' : 'text-rose-500'}`;
      } else {
        pmElem.innerText = '';
      }

      document.getElementById('kpiGoalPercent').innerText = `${goalAchievedPercent.toFixed(1)}%`;
      document.getElementById('kpiGoalProgressBar').style.width = `${Math.min(goalAchievedPercent, 100)}%`;

      const goalBadge = document.getElementById('kpiGoalBadge');
      if (goalAchievedPercent >= 100) {
        goalBadge.innerText = 'ทะลุเป้า';
        goalBadge.className = 'px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-700';
      } else {
        goalBadge.innerText = 'กำลังทำตามเป้า';
        goalBadge.className = 'px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-800';
      }

      const profitElem = document.getElementById('kpiNetProfit');
      const profitIcon = document.getElementById('kpiProfitIcon');
      if (netProfit >= 0) {
        profitElem.className = "text-lg sm:text-2xl font-bold text-emerald-600";
        profitIcon.className = "fa-solid fa-arrow-trend-up text-emerald-500 text-sm";
      } else {
        profitElem.className = "text-lg sm:text-2xl font-bold text-rose-600";
        profitIcon.className = "fa-solid fa-arrow-trend-down text-rose-500 text-sm";
      }

      const ratioText = document.getElementById('profitExpenseRatioText');
      const ratioDesc = document.getElementById('profitExpenseRatioDesc');
      const ratioBar = document.getElementById('profitExpenseBar');

      if (totalExpense > 0) {
        const pct = (netProfit / totalExpense) * 100;
        ratioText.innerText = `${pct.toFixed(1)}%`;
        ratioText.className = `text-4xl font-extrabold ${pct >= 0 ? 'text-emerald-500' : 'text-rose-500'} mb-1`;
        ratioDesc.innerHTML = pct >= 0 ? `กำไร <strong>${pct.toFixed(1)}%</strong> ของต้นทุน` : `ขาดทุน <strong>${Math.abs(pct).toFixed(1)}%</strong> ของต้นทุน`;
        ratioBar.style.width = `${Math.min(Math.abs(pct), 100)}%`;
        ratioBar.className = pct >= 0 ? "bg-emerald-500 h-2 rounded-full transition-all duration-700" : "bg-rose-500 h-2 rounded-full transition-all duration-700";
      } else {
        ratioText.innerText = "0%";
        ratioText.className = "text-4xl font-extrabold text-gray-300 mb-1";
        ratioDesc.innerText = "ยังไม่มีรายจ่าย";
        ratioBar.style.width = "0%";
      }

      renderFullMonthCalendar();
      renderTransactionHistory(filteredTx);
      renderCategoryReport(currentReportTab);
    }

    window.safeCalculate = function(expr) {
      if (!expr) return 0;
      // Support × (U+00D7), x/X, ÷ as multiply/divide
      let cleaned = String(expr)
        .replace(/×/g, '*')
        .replace(/x/gi, '*')
        .replace(/÷/g, '/')
        .replace(/\s+/g, '');
      if (!/^[0-9+\-*/().]+$/.test(cleaned)) return NaN;
      try {
        let rawTokens = cleaned.match(/(\d+(?:\.\d+)?|[+\-*/()])/g);
        if (!rawTokens) return NaN;

        // Fold unary +/- into the following number (start of expr, after operator, or after '(')
        let tokens = [];
        for (let i = 0; i < rawTokens.length; i++) {
          const t = rawTokens[i];
          if ((t === '-' || t === '+') &&
              (tokens.length === 0 ||
               '+-*/('.includes(String(tokens[tokens.length - 1])))) {
            const next = rawTokens[i + 1];
            if (next && !isNaN(next)) {
              tokens.push(parseFloat((t === '-' ? '-' : '') + next));
              i++;
              continue;
            }
          }
          if (!isNaN(t)) tokens.push(parseFloat(t));
          else tokens.push(t);
        }

        let outputQueue = [];
        let operatorStack = [];
        let precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };

        for (let token of tokens) {
          if (typeof token === 'number') {
            outputQueue.push(token);
          } else if ('+-*/'.includes(token)) {
            while (
              operatorStack.length > 0 &&
              '+-*/'.includes(operatorStack[operatorStack.length - 1]) &&
              precedence[operatorStack[operatorStack.length - 1]] >= precedence[token]
            ) {
              outputQueue.push(operatorStack.pop());
            }
            operatorStack.push(token);
          } else if (token === '(') {
            operatorStack.push(token);
          } else if (token === ')') {
            while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
              outputQueue.push(operatorStack.pop());
            }
            operatorStack.pop();
          }
        }
        while (operatorStack.length > 0) {
          outputQueue.push(operatorStack.pop());
        }

        let evalStack = [];
        for (let token of outputQueue) {
          if (typeof token === 'number') {
            evalStack.push(token);
          } else {
            let b = evalStack.pop();
            let a = evalStack.pop();
            if (a === undefined || b === undefined) return NaN;
            if (token === '+') evalStack.push(a + b);
            if (token === '-') evalStack.push(a - b);
            if (token === '*') evalStack.push(a * b);
            if (token === '/') {
              if (b === 0) return NaN;
              evalStack.push(a / b);
            }
          }
        }
        return evalStack.length === 1 ? evalStack[0] : NaN;
      } catch (e) {
        return NaN;
      }
    };

    function appendMathSymbol(symbol) {
      document.getElementById('txAmount').value += symbol;
      document.getElementById('txAmount').focus();
    }

    function clearMathAmount() {
      document.getElementById('txAmount').value = '';
      document.getElementById('txAmount').focus();
    }

    function calculateAmount() {
      const inputField = document.getElementById('txAmount');
      let val = inputField.value.trim();
      if(!val) return;
      const result = window.safeCalculate(val);
      if (!isNaN(result) && isFinite(result)) {
        inputField.value = Number(Math.max(0, result)).toFixed(2);
      }
    }

    window.openTransactionModal = function(type, editId = null) {
      document.getElementById('txType').value = type;
      document.getElementById('editTxId').value = editId || '';

      const modalHeader = document.getElementById('modalHeaderBg');
      modalHeader.className = type === 'income' ? "p-4 text-white flex justify-between items-center bg-emerald-600" : "p-4 text-white flex justify-between items-center bg-rose-600";
      document.getElementById('modalTitle').innerHTML = type === 'income' ? `<i class="fa-solid fa-plus-circle mr-2"></i>บันทึกรายรับ` : `<i class="fa-solid fa-minus-circle mr-2"></i>บันทึกรายจ่าย`;

      const catSelect = document.getElementById('txCategory');
      catSelect.innerHTML = '';
      window.appData = window.sanitizeAppData(window.appData);
      const catList = (window.appData.categories && window.appData.categories[type]) ? window.appData.categories[type] : [];
      if (catList.length === 0) {
        alert('ไม่พบหมวดหมู่ กรุณาเพิ่มหมวดหมู่ก่อนในแท็บตั้งค่า');
        return;
      }
      catList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.innerText = c.name;
        catSelect.appendChild(opt);
      });

      document.getElementById('txDate').value = getLocalYYYYMMDD();
      document.getElementById('txTime').value = new Date().toTimeString().split(' ')[0].substring(0, 5);
      document.getElementById('txAmount').value = '';
      document.getElementById('txNote').value = '';
      _editTxIdTemp = null;

      if (editId) {
        const tx = window.appData.transactions.find(t => t.id === editId);
        if (tx) {
          _editTxIdTemp = tx;
          document.getElementById('txDate').value = tx.date;
          document.getElementById('txTime').value = tx.time;
          catSelect.value = tx.category;
          document.getElementById('txAmount').value = tx.amount;
          document.getElementById('txNote').value = tx.note || '';
        }
      }

      onCategoryChange();
      document.getElementById('transactionModal').classList.remove('hidden');
    }

    window.onCategoryChange = function() {
      const type = document.getElementById('txType').value;
      const catSelect = document.getElementById('txCategory');
      const subContainer = document.getElementById('subCatContainer');
      const nestedContainer = document.getElementById('nestedSubLevels');
      const chkContainer = document.getElementById('multiMaterialContainer');
      const chkList = document.getElementById('materialsChecklist');
      const chkLabel = document.getElementById('checklistLabel');

      const catObj = (window.appData.categories[type] || []).find(c => c.name === catSelect.value);
      if (subContainer) subContainer.classList.add('hidden');
      if (chkContainer) chkContainer.classList.add('hidden');
      if (nestedContainer) nestedContainer.innerHTML = '';

      if (!catObj) return;

      const isMaterial = catObj.flags && catObj.flags.isMaterialCategory;
      const isEquipment = catObj.flags && catObj.flags.isEquipmentCategory;

      if (isMaterial || isEquipment) {
        chkContainer.classList.remove('hidden');
        chkLabel.innerHTML = isMaterial
          ? `<i class="fa-solid fa-basket-shopping text-brand-500 mr-1"></i> เลือกวัตถุดิบ:`
          : `<i class="fa-solid fa-toolbox text-brand-500 mr-1"></i> เลือกอุปกรณ์:`;
        chkList.innerHTML = '';

        const sourceList = isMaterial ? window.appData.materials : window.appData.equipments;
        let existingItems = [];
        if (_editTxIdTemp && _editTxIdTemp.subCategory) {
          // multi-select uses ", " join — do not split nested path sep
          existingItems = _editTxIdTemp.subCategory.split(', ').map(s => s.trim()).filter(Boolean);
        }

        (sourceList || []).forEach((item) => {
          const checked = existingItems.includes(item) ? 'checked' : '';
          chkList.innerHTML += `
            <label class="flex items-center space-x-2 bg-white p-2 rounded-xl border border-gray-100 shadow-sm cursor-pointer hover:border-brand-300">
              <input type="checkbox" name="matCheck" value="${escapeAttr(String(item))}" class="text-brand-500 focus:ring-brand-500 rounded" ${checked}>
              <span class="text-[11px] text-gray-700 font-medium">${escapeHTML(String(item))}</span>
            </label>`;
        });
        return;
      }

      if (window.categoryHasSubs(catObj)) {
        subContainer.classList.remove('hidden');
        // Pre-fill path from edit if present
        let prePath = [];
        if (_editTxIdTemp && _editTxIdTemp.subCategory && _editTxIdTemp.subCategory.indexOf(', ') === -1) {
          prePath = String(_editTxIdTemp.subCategory).split(window.CAT_PATH_SEP).map(s => s.trim()).filter(Boolean);
        } else if (_editTxIdTemp && _editTxIdTemp.subCategory) {
          // legacy single sub (no path sep, no multi comma list treated as path)
          const single = String(_editTxIdTemp.subCategory).trim();
          if (single && single.indexOf(',') === -1) prePath = [single];
        }
        window.renderNestedSubSelects(catObj.subs, prePath, 0);
      }
    };

    /** Cascading selects for nested category path (max depth under main cat). */
    window.renderNestedSubSelects = function(rootSubs, prePath, fromLevel) {
      const nestedContainer = document.getElementById('nestedSubLevels');
      if (!nestedContainer) return;
      // Remove levels from fromLevel onward
      const existing = nestedContainer.querySelectorAll('[data-sub-level]');
      existing.forEach(function(el) {
        const lv = Number(el.getAttribute('data-sub-level'));
        if (lv >= fromLevel) el.remove();
      });

      // Build path selected so far from levels 0..fromLevel-1
      const pathSoFar = [];
      for (let lv = 0; lv < fromLevel; lv++) {
        const sel = nestedContainer.querySelector('select[data-sub-level="' + lv + '"]');
        if (sel && sel.value) pathSoFar.push(sel.value);
        else break;
      }

      const children = window.getChildrenAtPath(rootSubs, pathSoFar);
      if (!children || children.length === 0) return;

      // Depth limit: fromLevel is 0-based under main cat; max levels under main = MAX_CAT_DEPTH - 1
      if (fromLevel >= window.MAX_CAT_DEPTH - 1) return;

      const wrap = document.createElement('div');
      wrap.setAttribute('data-sub-level', String(fromLevel));
      wrap.className = 'mb-1.5';
      const label = document.createElement('label');
      label.className = 'block text-[11px] font-medium text-gray-600 mb-0.5';
      label.textContent = fromLevel === 0 ? 'รายการย่อย' : ('ชั้นที่ ' + (fromLevel + 2));
      const sel = document.createElement('select');
      sel.setAttribute('data-sub-level', String(fromLevel));
      sel.className = 'w-full border border-gray-300 rounded-xl px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm';
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = '— เลือก —';
      sel.appendChild(emptyOpt);
      children.forEach(function(node) {
        const opt = document.createElement('option');
        opt.value = window.catNodeName(node);
        opt.textContent = window.catNodeName(node);
        sel.appendChild(opt);
      });
      if (prePath && prePath[fromLevel]) {
        sel.value = prePath[fromLevel];
      }
      sel.addEventListener('change', function() {
        const type = document.getElementById('txType').value;
        const catSelect = document.getElementById('txCategory');
        const catObj = (window.appData.categories[type] || []).find(c => c.name === catSelect.value);
        if (!catObj) return;
        window.renderNestedSubSelects(catObj.subs, null, fromLevel + 1);
      });
      wrap.appendChild(label);
      wrap.appendChild(sel);
      nestedContainer.appendChild(wrap);

      // If prePath continues, cascade further
      if (prePath && prePath[fromLevel]) {
        window.renderNestedSubSelects(rootSubs, prePath, fromLevel + 1);
      } else if (sel.value) {
        window.renderNestedSubSelects(rootSubs, null, fromLevel + 1);
      }
    };

    window.collectNestedSubPath = function() {
      const nestedContainer = document.getElementById('nestedSubLevels');
      if (!nestedContainer) return '';
      const path = [];
      const selects = nestedContainer.querySelectorAll('select[data-sub-level]');
      const ordered = Array.from(selects).sort(function(a, b) {
        return Number(a.getAttribute('data-sub-level')) - Number(b.getAttribute('data-sub-level'));
      });
      for (let i = 0; i < ordered.length; i++) {
        const v = ordered[i].value;
        if (!v) break;
        path.push(v);
      }
      return path.join(window.CAT_PATH_SEP);
    };

    /** Select / deselect all multi-select checklist items (materials or equipments). */
    window.toggleAllMaterials = function(checked) {
      document.querySelectorAll('input[name="matCheck"]').forEach(function(el) {
        el.checked = !!checked;
      });
    };

    window.closeTransactionModal = function() {
      document.getElementById('transactionModal').classList.add('hidden');
    };

    window.handleFormSubmit = async function(e) {
      e.preventDefault();
      // Wait for store hydrate so we never persist against empty/partial state on cold start
      if (typeof window.whenStoreReady === 'function') {
        try { await window.whenStoreReady(); } catch (w) { /* proceed with best effort */ }
      }
      calculateAmount();
      const amountVal = Number(document.getElementById('txAmount').value);
      if (isNaN(amountVal) || amountVal <= 0) {
        alert('กรุณาระบุจำนวนเงินให้ถูกต้องและมากกว่า 0 บาท');
        return;
      }

      const type = document.getElementById('txType').value;
      const date = document.getElementById('txDate').value;
      const time = document.getElementById('txTime').value;
      const category = document.getElementById('txCategory').value;
      const note = document.getElementById('txNote').value.trim();
      const editId = document.getElementById('editTxId').value;

      // Validate date format before save
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        alert('กรุณาเลือกวันที่ให้ถูกต้อง');
        return;
      }

      const catObj = (window.appData.categories && window.appData.categories[type])
        ? window.appData.categories[type].find(c => c.name === category)
        : null;
      let subCategory = '';

      if (catObj && (catObj.flags?.isMaterialCategory || catObj.flags?.isEquipmentCategory)) {
        const checked = Array.from(document.querySelectorAll('input[name="matCheck"]:checked')).map(el => el.value);
        subCategory = checked.join(', ');
      } else if (catObj && window.categoryHasSubs(catObj)) {
        // Nested path (or single level) from cascading selects
        subCategory = window.collectNestedSubPath();
        // Fallback to legacy single select if present
        if (!subCategory) {
          const legacy = document.getElementById('txSubCategory');
          if (legacy && legacy.value) subCategory = legacy.value;
        }
      }

      const txObj = {
        id: editId || (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2))),
        type, date, time, category, subCategory, amount: window.roundMoney(amountVal), note
      };

      if(editId) {
        const idx = window.appData.transactions.findIndex(t => t.id === editId);
        if(idx > -1) window.appData.transactions[idx] = txObj;
        else window.appData.transactions.push(txObj);
      } else {
        window.appData.transactions.push(txObj);
      }

      // Save local: single tx to IDB + meta (no giant LS blob)
      try {
        if (window.SomtumStore && SomtumStore.putTx) {
          await SomtumStore.putTx(txObj);
          await SomtumStore.markDirty(txObj.id);
          await SomtumStore.persistAppState(window.appData, { writeAllTx: false });
        }
        window.saveLocalOnly();
      } catch (err) {
        console.error(err);
        window.showToast('บันทึกลงเครื่องล้มเหลว (ที่เก็บข้อมูลอาจเต็ม)', 'error');
        return;
      }

      closeTransactionModal();

      // Update UI immediately from in-memory + IDB data (do not wait for cloud snapshot).
      // When logged in, onSnapshot may be skipped during _pendingTxSync — without this
      // the new row only appears after a full page refresh.
      try {
        if (typeof window.refreshDashboard === 'function') {
          await window.refreshDashboard();
        }
      } catch (uiErr) {
        console.warn('refreshDashboard after save', uiErr);
      }

      // Then try cloud (incremental — single doc)
      try {
        await window.saveTransactionToFirestore(txObj);
        window.showToast(editId ? 'อัปเดตข้อมูลแล้ว' : 'บันทึกข้อมูลเรียบร้อย');
      } catch (err) {
        console.error(err);
        window.showToast('บันทึกลงเครื่องแล้ว แต่ซิงค์ Cloud ล้มเหลว', 'error');
      }

      // Refresh again after cloud write settles (snapshot may have been skipped while pending)
      try {
        if (typeof window.refreshDashboard === 'function') {
          await window.refreshDashboard();
        }
      } catch (uiErr2) { /* */ }

      if(!document.getElementById('calendarDayModal').classList.contains('hidden')) {
        openCalendarDayModal(selectedCalendarDay);
      }
      if(!document.getElementById('cardDetailModal').classList.contains('hidden') && lastCardDetailType) {
        openCardDetailModal(lastCardDetailType);
      }
    }

    window.editTransaction = async function(id) {
      let tx = (window.appData.transactions || []).find(t => t.id === id);
      if (!tx && window.SomtumStore && SomtumStore.getTx) {
        try { tx = await SomtumStore.getTx(id); } catch (e) { console.warn(e); }
      }
      if (tx) openTransactionModal(tx.type, id);
      else window.showToast('ไม่พบรายการ', 'error');
    }

    window.deleteTransaction = function(id) {
      window.showConfirmModal("ยืนยันการลบ", "คุณต้องการลบรายการนี้ใช่หรือไม่?", async () => {
        window.appData.transactions = window.appData.transactions.filter(t => t.id !== id);
        try {
          if (window.SomtumStore && SomtumStore.markDeleted) {
            await SomtumStore.markDeleted(id);
          }
          window.saveLocalOnly();
        } catch (err) {
          window.showToast('ลบในเครื่องล้มเหลว', 'error');
          return;
        }
        window.refreshDashboard();
        if(!document.getElementById('calendarDayModal').classList.contains('hidden')) {
          openCalendarDayModal(selectedCalendarDay);
        }
        if(!document.getElementById('cardDetailModal').classList.contains('hidden') && lastCardDetailType) {
          openCardDetailModal(lastCardDetailType);
        }
        try {
          await window.deleteTransactionFromFirestore(id);
          window.showToast('ลบรายการเรียบร้อย');
        } catch (err) {
          console.error(err);
          window.showToast('ลบในเครื่องแล้ว แต่ซิงค์ Cloud ล้มเหลว', 'error');
        }
      });
    }

    window.openCardDetailModal = function(cardType) {
      lastCardDetailType = cardType;
      const modal = document.getElementById('cardDetailModal');
      const itemsContainer = document.getElementById('cardDetailItems');
      const header = document.getElementById('cardDetailHeader');
      const title = document.getElementById('cardDetailTitle');
      // Match KPI totals: time filter only (ignore history search filters)
      const filteredTx = window.getTimeFilteredTransactions();
      let listData = [];
      let totalAmount = 0;

      if (cardType === 'income') {
        listData = filteredTx.filter(t => t.type === 'income');
        header.className = "p-4 text-white flex justify-between items-center bg-emerald-600";
        title.innerHTML = `<i class="fa-solid fa-wallet mr-2"></i>รายละเอียดรายรับ`;
      } else if (cardType === 'expense') {
        listData = filteredTx.filter(t => t.type === 'expense');
        header.className = "p-4 text-white flex justify-between items-center bg-rose-600";
        title.innerHTML = `<i class="fa-solid fa-receipt mr-2"></i>รายละเอียดรายจ่าย`;
      } else {
        listData = filteredTx;
        header.className = "p-4 text-white flex justify-between items-center bg-brand-600";
        title.innerHTML = `<i class="fa-solid fa-chart-line mr-2"></i>รายละเอียดกำไร/ขาดทุน`;
      }

      listData.forEach(t => totalAmount = window.roundMoney(totalAmount + window.roundMoney(t.amount)));

      document.getElementById('cardDetailSummary').innerHTML = `
        <div>พบข้อมูลทั้งหมด <strong>${listData.length}</strong> รายการ (ตามตัวกรองเวลาปัจจุบัน)</div>
        <div class="mt-1 text-base ${cardType === 'expense' ? 'text-rose-600' : (cardType === 'income' ? 'text-emerald-600' : 'text-brand-600')}">
          รวม ${cardType === 'expense' ? '-' : (cardType === 'income' ? '+' : '')}฿${totalAmount.toLocaleString('th-TH', {minimumFractionDigits: 2})}
        </div>`;
      window.renderDrillDownAccordion(listData, itemsContainer, 'kpiModal');
      modal.classList.remove('hidden');
    }

    window.setGoalModeUI = function(mode) {
      const pctBox = document.getElementById('goalModePercentBox');
      const amtBox = document.getElementById('goalModeAmountBox');
      const btnPct = document.getElementById('goalModeBtnPercent');
      const btnAmt = document.getElementById('goalModeBtnAmount');
      if (!pctBox || !amtBox) return;
      const isPct = mode === 'percent';
      pctBox.classList.toggle('hidden', !isPct);
      amtBox.classList.toggle('hidden', isPct);
      if (btnPct && btnAmt) {
        btnPct.className = isPct
          ? 'flex-1 py-2 rounded-xl text-xs font-bold bg-brand-600 text-white'
          : 'flex-1 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
        btnAmt.className = !isPct
          ? 'flex-1 py-2 rounded-xl text-xs font-bold bg-brand-600 text-white'
          : 'flex-1 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
      }
      window.updateGoalPreview();
    };

    window.updateGoalPreview = function() {
      const filteredTx = window.getTimeFilteredTransactions();
      const gSums = window.sumIncomeExpense(filteredTx);
      const totalIncome = gSums.income;
      const totalExpense = gSums.expense;
      const el = document.getElementById('goalCalculationBreakdown');
      if (!el) return;

      const modePct = document.getElementById('goalModePercentBox') &&
        !document.getElementById('goalModePercentBox').classList.contains('hidden');

      let lines = [];
      lines.push(`<div class="text-[11px] text-gray-500">ช่วงที่เลือก: รายรับ ฿${totalIncome.toLocaleString('th-TH', {minimumFractionDigits: 2})} · รายจ่าย ฿${totalExpense.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>`);

      if (modePct) {
        const raw = (document.getElementById('customGoalPercentInput') || {}).value;
        const pct = Number(raw);
        const usePct = (!isNaN(pct) && pct >= 0) ? pct : 60;
        const goal = totalExpense > 0
          ? window.roundMoney(totalExpense * (1 + usePct / 100))
          : (totalIncome > 0 ? totalIncome : 1000);
        lines.push(`<div class="font-bold text-gray-800 dark:text-gray-100 text-sm mt-1">เป้าหมาย ≈ ฿${goal.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>`);
        lines.push(`<div class="text-[11px] text-gray-600 dark:text-gray-300">มาร์กอัป +${usePct}% บนรายจ่าย (รายจ่าย × ${(1 + usePct / 100).toFixed(2)})</div>`);
        if (totalExpense <= 0) {
          lines.push(`<div class="text-[11px] text-amber-600">ยังไม่มีรายจ่ายในช่วงนี้ — ใช้ยอดสำรองชั่วคราว</div>`);
        }
      } else {
        const raw = (document.getElementById('customGoalInput') || {}).value;
        const val = Number(raw);
        if (!raw || isNaN(val) || val <= 0) {
          const auto = window.resolveTargetGoal(totalExpense, totalIncome);
          lines.push(`<div class="text-[11px] text-gray-500 mt-1">ใส่จำนวนเงินเพื่อดูว่าคิดเป็นกี่ % ของรายจ่าย</div>`);
          lines.push(`<div class="text-[11px]">เป้าปัจจุบันในระบบ: ฿${auto.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>`);
        } else {
          const goal = window.roundMoney(val);
          lines.push(`<div class="font-bold text-gray-800 dark:text-gray-100 text-sm mt-1">เป้าหมาย ฿${goal.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>`);
          if (totalExpense > 0) {
            const ofExp = (goal / totalExpense) * 100;
            const markup = ((goal / totalExpense) - 1) * 100;
            lines.push(`<div class="text-[11px] text-gray-600 dark:text-gray-300">คิดเป็น <b>${ofExp.toFixed(1)}%</b> ของรายจ่าย</div>`);
            lines.push(`<div class="text-[11px] text-gray-600 dark:text-gray-300">มาร์กอัป <b>${markup >= 0 ? '+' : ''}${markup.toFixed(1)}%</b> จากรายจ่าย</div>`);
          } else {
            lines.push(`<div class="text-[11px] text-amber-600">ยังไม่มีรายจ่ายในช่วงนี้ — ยังเทียบ % ไม่ได้</div>`);
          }
          if (totalIncome > 0) {
            const prog = (totalIncome / goal) * 100;
            lines.push(`<div class="text-[11px] text-brand-600 mt-1">ความคืบหน้าตอนนี้ ${prog.toFixed(1)}% ของเป้านี้</div>`);
          }
        }
      }
      el.innerHTML = lines.join('');
    };

    window.openGoalDetailModal = function() {
      const hasAmt = window.appData.customGoal && window.appData.customGoal > 0;
      const hasPct = window.appData.customGoalPercent !== null && window.appData.customGoalPercent !== undefined;
      const mode = hasAmt ? 'amount' : 'percent';
      const pctInput = document.getElementById('customGoalPercentInput');
      const amtInput = document.getElementById('customGoalInput');
      if (pctInput) {
        pctInput.value = hasPct ? window.appData.customGoalPercent
          : (hasAmt ? '' : 60);
      }
      if (amtInput) amtInput.value = hasAmt ? window.appData.customGoal : '';
      window.setGoalModeUI(mode);
      document.getElementById('goalDetailModal').classList.remove('hidden');
    };

    window.saveCustomGoal = function() {
      const modePct = document.getElementById('goalModePercentBox') &&
        !document.getElementById('goalModePercentBox').classList.contains('hidden');

      if (modePct) {
        const raw = document.getElementById('customGoalPercentInput').value.trim();
        const pct = Number(raw);
        if (raw === '' || isNaN(pct) || pct < 0) {
          alert('กรุณาใส่เปอร์เซ็นต์มาร์กอัปที่ถูกต้อง (เช่น 60)');
          return;
        }
        window.appData.customGoalPercent = pct;
        window.appData.customGoal = null; // โหมด % ชนะโหมดจำนวน
      } else {
        const raw = document.getElementById('customGoalInput').value.trim();
        const val = Number(raw);
        if (!raw || isNaN(val) || val <= 0) {
          alert('กรุณาใส่เป้าหมายที่เป็นตัวเลขมากกว่า 0');
          return;
        }
        window.appData.customGoal = window.roundMoney(val);
        window.appData.customGoalPercent = null;
      }
      window.syncDataToCloud(true);
      window.refreshDashboard();
      window.showToast('ตั้งเป้าหมายสำเร็จ');
      document.getElementById('goalDetailModal').classList.add('hidden');
    };

    window.clearCustomGoal = function() {
      window.appData.customGoal = null;
      window.appData.customGoalPercent = null;
      const pctInput = document.getElementById('customGoalPercentInput');
      const amtInput = document.getElementById('customGoalInput');
      if (pctInput) pctInput.value = '60';
      if (amtInput) amtInput.value = '';
      window.setGoalModeUI('percent');
      window.syncDataToCloud(true);
      window.refreshDashboard();
      window.showToast('กลับไปใช้เป้าหมายสูตรปกติ (+60%)');
    };

    function renderTransactionHistory(txList) {
      const listElem = document.getElementById('transactionList');
      document.getElementById('transactionCount').innerText = `${txList.length} รายการ`;
      listElem.innerHTML = '';

      if (txList.length === 0) {
        document.getElementById('loadMoreHistoryContainer').classList.add('hidden');
        return listElem.innerHTML = `<div class="text-center py-6 text-gray-400 text-xs">ไม่พบรายการ</div>`;
      }

      // Group by date first so day totals are never partial
      const dateGrouped = {};
      txList.forEach(tx => {
        const d = tx.date || 'ไม่ระบุวันที่';
        if (!dateGrouped[d]) dateGrouped[d] = { inc: 0, exp: 0, items: [] };
        if (tx.type === 'income') dateGrouped[d].inc = window.roundMoney(dateGrouped[d].inc + window.roundMoney(tx.amount));
        if (tx.type === 'expense') dateGrouped[d].exp = window.roundMoney(dateGrouped[d].exp + window.roundMoney(tx.amount));
        dateGrouped[d].items.push(tx);
      });

      const sortedDates = Object.keys(dateGrouped).sort((a, b) => new Date(b) - new Date(a));
      // Take complete days until we roughly reach the display limit
      let shownCount = 0;
      const visibleDates = [];
      for (const d of sortedDates) {
        if (shownCount >= historyDisplayLimit && visibleDates.length > 0) break;
        visibleDates.push(d);
        shownCount += dateGrouped[d].items.length;
      }
      if (visibleDates.length < sortedDates.length) {
        document.getElementById('loadMoreHistoryContainer').classList.remove('hidden');
      } else {
        document.getElementById('loadMoreHistoryContainer').classList.add('hidden');
      }

      visibleDates.forEach((dStr, dIdx) => {
        const dayData = dateGrouped[dStr];
        const net = dayData.inc - dayData.exp;
        const containerId = `history-date-container-${dIdx}`;
        const bodyId = `history-date-body-${dIdx}`;

        const card = document.createElement('div');
        card.className = "bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xs overflow-hidden my-2";
        card.innerHTML = `
          <div class="p-3 bg-gray-50/80 dark:bg-gray-700/50 hover:bg-gray-100/80 dark:hover:bg-gray-700 cursor-pointer transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2" onclick="toggleSubDetail('${bodyId}')">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-calendar-day text-brand-600"></i>
              <span class="font-bold text-xs text-gray-800 dark:text-gray-100">วันที่ ${dStr}</span>
              <span class="text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-200 px-2 py-0.5 rounded-full font-medium">${dayData.items.length} รายการ</span>
            </div>
            <div class="flex items-center gap-3 text-[11px]">
              <span class="text-emerald-600 font-semibold">+฿${dayData.inc.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
              <span class="text-rose-600 font-semibold">-฿${dayData.exp.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
              <span class="font-bold ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}">สุทธิ ฿${net.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
              <i class="fa-solid fa-caret-down text-gray-400 ml-1 transition-transform" id="icon-${bodyId}"></i>
            </div>
          </div>
          <div id="${bodyId}" class="hidden p-2 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
            <div id="${containerId}"></div>
          </div>
        `;
        listElem.appendChild(card);
        window.renderDrillDownAccordion(dayData.items, containerId, `hist-${dIdx}`);
      });
    }

    window.loadMoreHistory = function() {
      historyDisplayLimit += 50;
      window.refreshDashboard();
    };

    window.loadMoreReport = function() {
      reportDisplayLimit += 50;
      window.renderCategoryReport(currentReportTab);
    };

    window.exportDataToCSV = function() {
      const txs = window.getFilteredTransactions();
      if(!txs || txs.length === 0) {
        alert('ไม่มีข้อมูลบัญชีตามช่วงเวลาหรือเงื่อนไขที่เลือก');
        return;
      }
      // Helper to neutralize CSV formula injection and escape quotes
      const safe = (val) => {
        let s = String(val == null ? '' : val).replace(/"/g, '""');
        if (/^[=+\-@]/.test(s)) s = "'" + s; // prevent formula injection
        return s;
      };
      let csv = "\uFEFFวันที่,เวลา,ประเภท,หมวดหมู่,รายการย่อย,จำนวนเงิน(บาท),โน้ต\n";
      txs.forEach(t => {
        const typeStr = t.type === 'income' ? 'รายรับ' : 'รายจ่าย';
        csv += `"${safe(t.date)}","${safe(t.time || '')}","${safe(typeStr)}","${safe(t.category)}","${safe(t.subCategory || '')}","${safe(t.amount)}","${safe(t.note || '')}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stone-report-${window.getLocalYYYYMMDD()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.showToast('ส่งออก CSV เรียบร้อยแล้ว');
    };

    window.exportDataToJSON = async function() {
      let payload = window.appData;
      try {
        if (window.SomtumStore && SomtumStore.buildLegacyAppData) {
          payload = await SomtumStore.buildLegacyAppData(window.appData);
        }
      } catch (e) { console.warn('export buildLegacy', e); }
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `stone-backup-${window.getLocalYYYYMMDD()}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      if (typeof window.markWeeklyBackupDone === 'function') window.markWeeklyBackupDone();
      window.showToast('สำรองข้อมูล JSON เรียบร้อย');
    }

    window.importDataFromJSON = function(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const parsed = JSON.parse(e.target.result);
          if (!parsed.transactions || !parsed.categories) {
            alert('ไฟล์ JSON ไม่ถูกต้องตามโครงสร้างแอป');
            return;
          }
          window.showConfirmModal("ยืนยันการนำเข้าข้อมูล", "ข้อมูลใหม่จะถูกนำมาแทนที่ข้อมูลปัจจุบัน คุณต้องการดำเนินการต่อหรือไม่?", async () => {
            window.showToast("กำลังนำเข้าข้อมูล...");
            const newData = window.sanitizeAppData(parsed);
            const ownerUid = window.currentUser ? window.currentUser.uid : null;
            try {
              // CRITICAL: wipe old IDB txs first — persistAppState only PUTs, never deletes orphans
              if (window.SomtumStore && SomtumStore.clearAllUserData) {
                await SomtumStore.clearAllUserData();
              }
              if (ownerUid) SomtumStore.setItem('somtumDataOwnerUid', ownerUid);
              window.appData = newData;
              if (window.SomtumStore && SomtumStore.persistAppState) {
                await SomtumStore.persistAppState(newData, { writeAllTx: true });
                if (SomtumStore.markDirty) {
                  for (const tx of (newData.transactions || [])) {
                    if (tx && tx.id) await SomtumStore.markDirty(tx.id);
                  }
                }
                if (SomtumStore.markMetaDirty) SomtumStore.markMetaDirty();
              }
              // Also keep a legacy blob only if small enough (handled inside setItem)
              try {
                SomtumStore.setItem('somtumAppData', JSON.stringify(newData));
              } catch (e2) { /* quota ok — IDB is source of truth */ }
              window.__txCacheLoaded = false;
              window.__loadedRange = { start: null, end: null };
              if (typeof window.ensureTransactionsLoaded === 'function') {
                await window.ensureTransactionsLoaded(true);
              }
              window.saveLocalOnly();
            } catch (e) {
              console.error(e);
              window.showToast('บันทึกลงเครื่องล้มเหลว', 'error');
              return;
            }

            if (window.currentUser && window.db) {
              try {
                // 1) Write settings first
                const settingsRef = window.doc(window.db, "users", window.currentUser.uid, "meta", "settings");
                await window.setDoc(settingsRef, {
                  categories: newData.categories,
                  materials: newData.materials,
                  equipments: newData.equipments,
                  customGoal: newData.customGoal,
                  customGoalPercent: newData.customGoalPercent,
                  updatedAt: new Date().toISOString()
                }, { merge: true });

                // 2) Write all new transactions first (safer than delete-first)
                const newIds = new Set((newData.transactions || []).map(t => t.id));
                let batch = window.writeBatch(window.db);
                let count = 0;
                for (const tx of (newData.transactions || [])) {
                  const txRef = window.doc(window.db, "users", window.currentUser.uid, "transactions", tx.id);
                  batch.set(txRef, tx);
                  count++;
                  if (count >= 400) { await batch.commit(); batch = window.writeBatch(window.db); count = 0; }
                }
                if (count > 0) await batch.commit();

                // 3) Delete old transactions that are not in the new set
                const txCollRef = window.collection(window.db, "users", window.currentUser.uid, "transactions");
                const snap = await window.getDocs(txCollRef);
                batch = window.writeBatch(window.db);
                count = 0;
                for (const d of snap.docs) {
                  if (!newIds.has(d.id)) {
                    batch.delete(d.ref);
                    count++;
                    if (count >= 400) { await batch.commit(); batch = window.writeBatch(window.db); count = 0; }
                  }
                }
                if (count > 0) await batch.commit();

                window.updateSyncUI(true);
                window.showToast('นำเข้าข้อมูลสำเร็จ');
              } catch (err) {
                console.error("Import cloud error:", err);
                window.showToast('นำเข้าในเครื่องสำเร็จ แต่ซิงค์ Cloud ล้มเหลว กรุณากดปุ่มซิงค์', 'error');
              }
            } else {
              window.showToast('นำเข้าข้อมูลสำเร็จ (บันทึกในเครื่อง)');
            }
            window.refreshDashboard();
          });
        } catch (err) {
          alert('เกิดข้อผิดพลาดในการอ่านไฟล์ JSON');
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    };

    window.switchTab = function(tabKey) {
      ['history', 'categoryReport', 'categoryManager'].forEach(k => {
        document.getElementById(`tabContent-${k}`).classList.add('hidden');
        document.getElementById(`tab-${k}`).className = "flex-1 py-3 text-xs font-bold text-center border-b-2 border-transparent text-gray-500";
      });
      document.getElementById(`tabContent-${tabKey}`).classList.remove('hidden');
      document.getElementById(`tab-${tabKey}`).className = "flex-1 py-3 text-xs font-bold text-center border-b-2 border-brand-500 text-brand-600";

      if (tabKey === 'categoryManager') {
        window.renderCategoryTree();
        window.renderMaterialTags();
      }
    }

    window.renderCategoryReport = function(type) {
      currentReportTab = type || currentReportTab;
      const activeType = currentReportTab;
      const btnInc = document.getElementById('catReportBtn-income');
      const btnExp = document.getElementById('catReportBtn-expense');

      if (btnInc && btnExp) {
        btnInc.className = activeType === 'income' ? "px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-100 text-emerald-800" : "px-3 py-1.5 text-xs rounded-lg bg-gray-100 text-gray-600";
        btnExp.className = activeType === 'expense' ? "px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-100 text-rose-800" : "px-3 py-1.5 text-xs rounded-lg bg-gray-100 text-gray-600";
      }

      const filteredTx = window.getFilteredTransactions().filter(t => t.type === activeType);
      const limitedReport = filteredTx.slice(0, reportDisplayLimit);

      if (filteredTx.length > reportDisplayLimit) {
        document.getElementById('loadMoreReportContainer').classList.remove('hidden');
      } else {
        document.getElementById('loadMoreReportContainer').classList.add('hidden');
      }

      window.renderDrillDownAccordion(limitedReport, 'categoryReportList', 'catReportTab');
    }

    window.changeCalendarMonth = async function(delta) {
      // Prevent overflow when current day is 29/30/31
      calendarCurrentDate.setDate(1);
      calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + delta);
      try {
        if (typeof window.ensureTransactionsLoaded === 'function') {
          await window.ensureTransactionsLoaded(true);
        }
      } catch (e) { console.warn(e); }
      renderFullMonthCalendar();
    }

    function renderFullMonthCalendar() {
      const year = calendarCurrentDate.getFullYear(), month = calendarCurrentDate.getMonth();
      document.getElementById('calendarMonthYear').innerText = `${['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'][month]} ${year + 543}`;
      
      const firstDay = new Date(year, month, 1).getDay(), days = new Date(year, month + 1, 0).getDate();
      const grid = document.getElementById('fullCalendarGrid');
      grid.innerHTML = '';
      const todayStr = getLocalYYYYMMDD();

      for(let i=0;i<firstDay;i++) grid.innerHTML += `<div class="p-1 min-h-[72px] bg-gray-50/30 rounded-xl"></div>`;

      for(let day=1;day<=days;day++) {
        const dStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const txs = (window.appData.transactions||[]).filter(t => t.date === dStr);
        let html = `<div class="flex justify-between items-center px-0.5 w-full"><span class="text-[10px] font-semibold">${day}</span></div>`;

        let cellBg = 'bg-gray-50 border-gray-100';
        let net = 0;

        if(txs.length > 0) {
          const daySums = window.sumIncomeExpense(txs);
          let inc = daySums.income, exp = daySums.expense;
          net = daySums.net;

          // สีพื้นหลังตามกำไร/ขาดทุน
          if (net > 0) {
            cellBg = 'bg-emerald-50 border-emerald-200';
          } else if (net < 0) {
            cellBg = 'bg-rose-50 border-rose-200';
          } else {
            cellBg = 'bg-gray-50 border-gray-200';
          }

          html += `<div class="text-center w-full mt-0.5 leading-tight">
            ${inc>0 ? `<span class="text-[8px] font-bold text-emerald-600 block">+${inc.toLocaleString()}</span>` : ''}
            ${exp>0 ? `<span class="text-[8px] font-bold text-rose-500 block">-${exp.toLocaleString()}</span>` : ''}
            <span class="text-[8px] font-extrabold block mt-0.5 ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${net >= 0 ? '+' : ''}${net.toLocaleString()}</span>
          </div>`;
        }

        // วันนี้เน้นด้วย ring (ทับสีพื้นได้)
        const todayRing = (dStr === todayStr) ? 'ring-2 ring-brand-500' : '';
        grid.innerHTML += `<div onclick="openCalendarDayModal('${dStr}')" class="p-1 min-h-[72px] rounded-xl border flex flex-col items-center transition-all cursor-pointer hover:opacity-90 ${cellBg} ${todayRing}">${html}</div>`;
      }
    }

    window.openCalendarDayModal = async function(dStr) {
      selectedCalendarDay = dStr;
      let txs = (window.appData.transactions || []).filter(t => t.date === dStr);
      try {
        if (window.SomtumStore && SomtumStore.getTxByDateRange) {
          const fromIdb = await SomtumStore.getTxByDateRange(dStr, dStr);
          if (fromIdb && fromIdb.length) txs = fromIdb;
        }
      } catch (e) { console.warn('cal day IDB', e); }
      const sums = window.sumIncomeExpense(txs);
      const inc = sums.income, exp = sums.expense, net = sums.net;

      document.getElementById('calDayInc').innerText = '฿' + inc.toLocaleString('th-TH', {minimumFractionDigits: 2});
      document.getElementById('calDayExp').innerText = '฿' + exp.toLocaleString('th-TH', {minimumFractionDigits: 2});
      document.getElementById('calDayNet').innerText = '฿' + net.toLocaleString('th-TH', {minimumFractionDigits: 2});
      document.getElementById('calModalTitle').innerHTML = `<i class="fa-solid fa-calendar-day"></i> รายการวันที่ ${escapeHTML(String(dStr || ''))}`;
      
      window.renderDrillDownAccordion(txs, 'calDayTxList', 'calDayModal');
      document.getElementById('calendarDayModal').classList.remove('hidden');
    }

    window.openAddTxFromCalendar = function(t) {
      closeTransactionModal();
      document.getElementById('calendarDayModal').classList.add('hidden');
      openTransactionModal(t);
      document.getElementById('txDate').value = selectedCalendarDay;
    }

    window.setManagerType = function(type) {
      managerType = type;
      document.getElementById('mgrType-income').className = type === 'income' ? 'px-2.5 py-1 text-[11px] rounded-md font-semibold bg-emerald-600 text-white transition-all' : 'px-2.5 py-1 text-[11px] rounded-md font-semibold text-gray-600 transition-all';
      document.getElementById('mgrType-expense').className = type === 'expense' ? 'px-2.5 py-1 text-[11px] rounded-md font-semibold bg-rose-600 text-white transition-all' : 'px-2.5 py-1 text-[11px] rounded-md font-semibold text-gray-600 transition-all';
      window.renderCategoryTree();
    }

    window.renderCategoryTree = function() {
      const list = document.getElementById('fullCategoryTree');
      if (!list) return;
      list.innerHTML = '';

      (window.appData.categories[managerType] || []).forEach(function(cat, i) {
        let badge = '';
        if (cat.flags?.isMaterialCategory) badge = `<span class="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">วัตถุดิบ</span>`;
        if (cat.flags?.isEquipmentCategory) badge = `<span class="text-[9px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium">อุปกรณ์</span>`;

        const isListCat = !!(cat.flags?.isMaterialCategory || cat.flags?.isEquipmentCategory);
        const treeHtml = isListCat
          ? '<span class="text-[10px] text-gray-400 italic">เลือกจากลิสต์วัตถุดิบ/อุปกรณ์อัตโนมัติ</span>'
          : window.renderSubTreeHtml(cat.subs || [], [i], 1);

        list.innerHTML += `
          <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3">
            <div class="flex justify-between items-center mb-2">
              <span class="font-bold text-xs text-gray-800 dark:text-gray-100 flex items-center gap-1.5"><i class="fa-solid fa-folder text-brand-500"></i> ${escapeHTML(cat.name)} ${badge}</span>
              <div class="flex items-center gap-2">
                <button type="button" onclick="renameMainCategory(${i})" class="text-blue-500 hover:text-blue-700 text-xs" title="แก้ไขชื่อหมวดหมู่"><i class="fa-solid fa-pen"></i></button>
                <button type="button" onclick="deleteMainCategory(${i})" class="text-gray-400 hover:text-rose-500 text-xs" title="ลบหมวดหมู่"><i class="fa-solid fa-trash"></i></button>
              </div>
            </div>
            <div class="mb-2 space-y-1">${treeHtml}</div>
            ${isListCat ? '' : `
            <div class="flex gap-1.5">
              <input type="text" id="newSub-${i}" placeholder="เพิ่มรายการย่อยชั้น 2..." class="flex-1 text-[11px] border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100">
              <button type="button" onclick="addSubCategory(${i})" class="bg-gray-800 dark:bg-gray-600 hover:bg-gray-900 dark:hover:bg-gray-500 text-white text-[11px] px-3 py-1.5 rounded-lg">+ เพิ่ม</button>
            </div>`}
          </div>`;
      });
    };

    /**
     * Render nested subs for category manager.
     * pathIdx = [catIndex, ...childIndices] for CRUD callbacks.
     * depth = current tree depth (1 = under main category → level 2 of 5).
     */
    window.renderSubTreeHtml = function(subs, pathIdx, depth) {
      if (!subs || subs.length === 0) {
        return '<span class="text-[10px] text-gray-400 italic">ไม่มีรายการย่อย</span>';
      }
      let html = '';
      const pad = Math.min((depth - 1) * 12, 48);
      subs.forEach(function(node, j) {
        const name = window.catNodeName(node);
        const kids = window.catNodeChildren(node);
        const childPath = pathIdx.concat([j]);
        const pathStr = childPath.join(',');
        const canAddChild = depth < (window.MAX_CAT_DEPTH - 1); // depth 1..3 can add → max depth 4 under main → total levels 5
        html += `<div class="border-l-2 border-brand-100 pl-2" style="margin-left:${pad}px">
          <div class="flex flex-wrap items-center gap-1 mb-1">
            <span class="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-2 py-0.5 rounded text-[10px] inline-flex items-center gap-1">
              ${kids.length ? '<i class="fa-solid fa-folder-open text-brand-400 text-[9px]"></i>' : '<i class="fa-solid fa-tag text-gray-400 text-[9px]"></i>'}
              ${escapeHTML(name)}
              <button type="button" onclick="renameSubCategoryPath('${pathStr}')" class="text-blue-500 hover:text-blue-700" title="แก้ไข"><i class="fa-solid fa-pen text-[9px]"></i></button>
              <button type="button" onclick="deleteSubCategoryPath('${pathStr}')" class="text-gray-400 hover:text-rose-500" title="ลบ"><i class="fa-solid fa-xmark"></i></button>
            </span>
          </div>`;
        if (kids.length > 0) {
          html += window.renderSubTreeHtml(kids, childPath, depth + 1);
        }
        if (canAddChild) {
          html += `<div class="flex gap-1 mb-1.5" style="margin-left:4px">
            <input type="text" id="newNested-${pathStr.replace(/,/g,'-')}" placeholder="เพิ่มชั้นถัดไป (สูงสุด ${window.MAX_CAT_DEPTH} ชั้น)..." class="flex-1 text-[10px] border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800">
            <button type="button" onclick="addNestedCategory('${pathStr}')" class="bg-brand-500 hover:bg-brand-600 text-white text-[10px] px-2 py-1 rounded">+</button>
          </div>`;
        }
        html += '</div>';
      });
      return html;
    };

    /** Resolve array reference for path [catIdx, ...indices] → parent array + last index */
    window.resolveCatPath = function(pathStr) {
      const parts = String(pathStr).split(',').map(Number);
      if (!parts.length || parts.some(function(n) { return isNaN(n); })) return null;
      const catIdx = parts[0];
      const cat = (window.appData.categories[managerType] || [])[catIdx];
      if (!cat) return null;
      if (parts.length === 1) {
        return { cat: cat, parentArr: null, index: catIdx, node: cat, depth: 0 };
      }
      let arr = cat.subs;
      if (!Array.isArray(arr)) return null;
      for (let d = 1; d < parts.length - 1; d++) {
        const node = arr[parts[d]];
        if (node == null) return null;
        // Promote string leaf to branch if we need to go deeper (should not happen in resolve)
        if (typeof node === 'string') return null;
        if (!Array.isArray(node.children)) node.children = [];
        arr = node.children;
      }
      const last = parts[parts.length - 1];
      return { cat: cat, parentArr: arr, index: last, node: arr[last], depth: parts.length - 1 };
    };

    window.addNestedCategory = function(pathStr) {
      const inputId = 'newNested-' + String(pathStr).replace(/,/g, '-');
      const input = document.getElementById(inputId);
      const val = input ? input.value.trim() : '';
      if (!val) return;
      const badName = window.isInvalidCategoryName(val);
      if (badName) { alert(badName); return; }
      const resolved = window.resolveCatPath(pathStr);
      if (!resolved || resolved.node == null) return;
      // Promote string leaf → branch object so we can attach children
      let node = resolved.node;
      if (typeof node === 'string') {
        node = { name: node, children: [] };
        resolved.parentArr[resolved.index] = node;
      }
      if (!Array.isArray(node.children)) node.children = [];
      // depth of new child under main; block when already at max depth
      if (resolved.depth >= window.MAX_CAT_DEPTH - 1) {
        alert('ซ้อนได้สูงสุด ' + window.MAX_CAT_DEPTH + ' ชั้น');
        return;
      }
      const exists = node.children.some(function(c) {
        return window.catNodeName(c).toLowerCase() === val.toLowerCase();
      });
      if (exists) { alert('มีรายการนี้อยู่แล้วในชั้นนี้'); return; }
      node.children.push(val);
      if (input) input.value = '';
      window.syncDataToCloud(true);
      window.renderCategoryTree();
      window.showToast('เพิ่มหมวดซ้อนเรียบร้อย');
    };

    window.renameSubCategoryPath = function(pathStr) {
      const resolved = window.resolveCatPath(pathStr);
      if (!resolved || resolved.node == null) return;
      const oldName = window.catNodeName(resolved.node);
      window.openRenameModal('แก้ไขรายการย่อย', 'ชื่อใหม่จะถูกอัปเดตในรายการที่บันทึกไว้แล้วด้วย', oldName, async function(trimmed) {
        if (trimmed === oldName) return;
        const badRename = window.isInvalidCategoryName(trimmed);
        if (badRename) { alert(badRename); return; }
        const siblings = resolved.parentArr || [];
        if (siblings.some(function(s, idx) {
          return idx !== resolved.index && window.catNodeName(s).toLowerCase() === trimmed.toLowerCase();
        })) {
          alert('มีรายการย่อยนี้อยู่แล้ว');
          return;
        }
        if (typeof resolved.node === 'string') {
          resolved.parentArr[resolved.index] = trimmed;
        } else if (window.isCatBranch(resolved.node)) {
          resolved.node.name = trimmed;
        }
        // Update transactions: replace segment in nested path or exact match
        if (typeof window.loadAllTransactions === 'function') {
          try { await window.loadAllTransactions(); } catch (e) { console.warn(e); }
        }
        let updatedCount = 0;
        const catName = resolved.cat.name;
        for (const tx of (window.appData.transactions || [])) {
          if (tx.type !== managerType || tx.category !== catName) continue;
          let changed = false;
          if (tx.subCategory === oldName) {
            tx.subCategory = trimmed;
            changed = true;
          } else if (tx.subCategory && tx.subCategory.indexOf(window.CAT_PATH_SEP) >= 0) {
            const parts = tx.subCategory.split(window.CAT_PATH_SEP).map(function(s) { return s.trim(); });
            let hit = false;
            for (let p = 0; p < parts.length; p++) {
              if (parts[p] === oldName) { parts[p] = trimmed; hit = true; }
            }
            if (hit) {
              tx.subCategory = parts.join(window.CAT_PATH_SEP);
              changed = true;
            }
          } else if (tx.subCategory && tx.subCategory.includes(oldName)) {
            // multi-select comma list
            const parts = tx.subCategory.split(',').map(function(s) { return s.trim(); });
            const idx = parts.indexOf(oldName);
            if (idx !== -1) {
              parts[idx] = trimmed;
              tx.subCategory = parts.join(', ');
              changed = true;
            }
          }
          if (changed) {
            updatedCount++;
            if (window.SomtumStore && SomtumStore.putTx) {
              try {
                await SomtumStore.putTx(tx);
                if (SomtumStore.markDirty) await SomtumStore.markDirty(tx.id);
              } catch (e) { console.warn('putTx after renameSubPath', e); }
            }
          }
        }
        window.syncDataToCloud(true);
        window.renderCategoryTree();
        window.refreshDashboard();
        window.showToast(updatedCount > 0
          ? 'แก้ไขรายการย่อยเรียบร้อย (อัปเดต ' + updatedCount + ' รายการ)'
          : 'แก้ไขรายการย่อยเรียบร้อย');
      });
    };

    window.deleteSubCategoryPath = function(pathStr) {
      const resolved = window.resolveCatPath(pathStr);
      if (!resolved || resolved.node == null) return;
      const subName = window.catNodeName(resolved.node);
      window.showConfirmModal('ยืนยันการลบรายการย่อย', 'ต้องการลบ "' + subName + '" และรายการซ้อนภายใต้ (ถ้ามี) ใช่หรือไม่?', function() {
        resolved.parentArr.splice(resolved.index, 1);
        window.syncDataToCloud(true);
        window.renderCategoryTree();
        window.showToast('ลบรายการย่อยแล้ว');
      });
    };

    // Rename main category + update all related transactions (via modal)
    window.renameMainCategory = function(i) {
      const cats = window.appData.categories[managerType];
      const cat = cats[i];
      if (!cat) return;
      const oldName = cat.name;
      window.openRenameModal('แก้ไขหมวดหมู่หลัก', 'ชื่อใหม่จะถูกอัปเดตในรายการที่บันทึกไว้แล้วด้วย', oldName, async (trimmed) => {
        if (trimmed === oldName) return;
        const badMain = window.isInvalidCategoryName(trimmed);
        if (badMain) { alert(badMain); return; }
        if (cats.some((c, idx) => idx !== i && c.name.toLowerCase() === trimmed.toLowerCase())) {
          alert('มีหมวดหมู่นี้อยู่แล้ว');
          return;
        }
        cat.name = trimmed;
        // Bulk ops must see full dataset, not only current filter cache
        if (typeof window.loadAllTransactions === 'function') {
          try { await window.loadAllTransactions(); } catch (e) { console.warn(e); }
        }
        let updatedCount = 0;
        for (const tx of (window.appData.transactions || [])) {
          if (tx.type === managerType && tx.category === oldName) {
            tx.category = trimmed;
            updatedCount++;
            // Persist renamed tx to IndexedDB + mark dirty for offline re-sync
            if (window.SomtumStore && SomtumStore.putTx) {
              try {
                await SomtumStore.putTx(tx);
                if (SomtumStore.markDirty) await SomtumStore.markDirty(tx.id);
              } catch (e) { console.warn('putTx after renameMain', e); }
            }
          }
        }
        window.syncDataToCloud(true);
        if (window.currentUser && updatedCount > 0) {
          try {
            let batch = window.writeBatch(window.db);
            let count = 0;
            for (const tx of window.appData.transactions) {
              if (tx.type === managerType && tx.category === trimmed) {
                const txRef = window.doc(window.db, "users", window.currentUser.uid, "transactions", tx.id);
                batch.set(txRef, JSON.parse(JSON.stringify(tx)), { merge: true });
                count++;
                if (count >= 400) { await batch.commit(); batch = window.writeBatch(window.db); count = 0; }
              }
            }
            if (count > 0) await batch.commit();
          } catch (e) {
            console.error('Rename category tx sync error:', e);
            window.showToast('อัปเดตชื่อหมวดหมู่แล้ว แต่ซิงค์รายการบางส่วนล้มเหลว', 'error');
          }
        }
        window.renderCategoryTree();
        window.refreshDashboard();
        window.showToast(updatedCount > 0
          ? `แก้ไขหมวดหมู่เรียบร้อย (อัปเดต ${updatedCount} รายการ)`
          : 'แก้ไขหมวดหมู่เรียบร้อย');
      });
    };

    // Rename sub-category + update related transactions
    window.renameSubCategory = function(i, j) {
      // Legacy (i, j) API → path-based implementation (supports nested nodes)
      window.renameSubCategoryPath(String(i) + ',' + String(j));
    };

    window.addNewCategory = function() {
      const nameInput = document.getElementById('newCatName');
      const name = nameInput.value.trim();
      if (!name) return;
      const bad = window.isInvalidCategoryName(name);
      if (bad) { alert(bad); return; }

      const isMaterial = document.getElementById('newCatIsMaterial').checked;
      const isEquipment = document.getElementById('newCatIsEquipment').checked;
      const cats = window.appData.categories[managerType];

      if(cats.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        alert('มีหมวดหมู่นี้อยู่แล้ว');
        return;
      }

      const newCat = { name, subs: [] };
      if (isMaterial || isEquipment) {
        newCat.flags = {};
        if (isMaterial) newCat.flags.isMaterialCategory = true;
        if (isEquipment) newCat.flags.isEquipmentCategory = true;
      }

      cats.push(newCat);
      nameInput.value = '';
      document.getElementById('newCatIsMaterial').checked = false;
      document.getElementById('newCatIsEquipment').checked = false;

      window.syncDataToCloud(true); // immediate sync for categories
      window.renderCategoryTree();
      window.showToast('เพิ่มหมวดหมู่เรียบร้อย');
    }

    window.deleteMainCategory = function(i) {
      const catName = window.appData.categories[managerType][i]?.name || '';
      const usedCount = (window.appData.transactions || []).filter(t => t.category === catName && t.type === managerType).length;
      const warnMsg = usedCount > 0
        ? `หมวดหมู่นี้ถูกใช้ใน ${usedCount} รายการแล้ว การลบอาจทำให้รายการเก่าแสดงหมวดหมู่ไม่ถูกต้อง ต้องการลบจริงหรือไม่?`
        : "การลบหมวดหมู่หลักจะทำให้รายการย่อยทั้งหมดถูกลบด้วย";
      window.showConfirmModal("ยืนยันการลบหมวดหมู่", warnMsg, () => {
        window.appData.categories[managerType].splice(i, 1);
        window.syncDataToCloud(true);
        window.renderCategoryTree();
        window.showToast('ลบหมวดหมู่แล้ว');
      });
    }

    window.addSubCategory = function(i) {
      const input = document.getElementById('newSub-' + i);
      const val = input ? input.value.trim() : '';
      if (!val) return;
      const bad = window.isInvalidCategoryName(val);
      if (bad) { alert(bad); return; }

      const cat = window.appData.categories[managerType][i];
      if (!cat.subs) cat.subs = [];
      const exists = cat.subs.some(function(s) {
        return window.catNodeName(s).toLowerCase() === val.toLowerCase();
      });
      if (exists) {
        alert('มีรายการย่อยนี้อยู่แล้ว');
        return;
      }

      cat.subs.push(val);
      if (input) input.value = '';
      window.syncDataToCloud(true);
      window.renderCategoryTree();
      window.showToast('เพิ่มรายการย่อยแล้ว');
    }

    window.deleteSubCategory = function(i, j) {
      // Legacy entry → delegate to path-based delete
      window.deleteSubCategoryPath(String(i) + ',' + String(j));
    }

    window.renderMaterialTags = function() {
      const list = document.getElementById('materialItemsList');
      if(!list) return;
      list.innerHTML = '';

      window.appData.materials.forEach((m, idx) => {
        list.innerHTML += `<span class="bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-1 rounded-xl text-[11px] inline-flex items-center gap-1.5 font-medium">${escapeHTML(m)} <button onclick="renameMaterialItem('วัตถุดิบ', ${idx})" class="text-blue-600 hover:text-blue-800" title="แก้ไข"><i class="fa-solid fa-pen text-[9px]"></i></button> <button onclick="deleteMaterialItem('วัตถุดิบ', ${idx})" class="text-amber-700 hover:text-rose-600" title="ลบ"><i class="fa-solid fa-xmark"></i></button></span>`;
      });
      window.appData.equipments.forEach((eq, idx) => {
        list.innerHTML += `<span class="bg-blue-50 text-blue-900 border border-blue-200 px-2.5 py-1 rounded-xl text-[11px] inline-flex items-center gap-1.5 font-medium">${escapeHTML(eq)} <button onclick="renameMaterialItem('อุปกรณ์', ${idx})" class="text-blue-600 hover:text-blue-800" title="แก้ไข"><i class="fa-solid fa-pen text-[9px]"></i></button> <button onclick="deleteMaterialItem('อุปกรณ์', ${idx})" class="text-blue-700 hover:text-rose-600" title="ลบ"><i class="fa-solid fa-xmark"></i></button></span>`;
      });
    }

    window.addNewMaterialItem = function() {
      const type = document.getElementById('newItemType').value;
      const nameInput = document.getElementById('newItemName');
      const name = nameInput.value.trim();
      if(!name) return;

      if(type === 'วัตถุดิบ') {
        if(window.appData.materials.includes(name)) { alert('มีรายการนี้อยู่แล้ว'); return; }
        window.appData.materials.push(name);
      } else {
        if(window.appData.equipments.includes(name)) { alert('มีรายการนี้อยู่แล้ว'); return; }
        window.appData.equipments.push(name);
      }

      nameInput.value = '';
      window.syncDataToCloud(true);
      window.renderMaterialTags();
      window.showToast('เพิ่มรายการสำเร็จ');
    }

    // Rename material / equipment + update transactions (via modal)
    window.renameMaterialItem = function(type, idx) {
      const arr = type === 'วัตถุดิบ' ? window.appData.materials : window.appData.equipments;
      const oldName = arr[idx];
      if (!oldName) return;
      window.openRenameModal('แก้ไขชื่อ' + type, 'ชื่อใหม่จะถูกอัปเดตในรายการที่บันทึกไว้แล้วด้วย', oldName, async (trimmed) => {
        if (trimmed === oldName) return;
        if (arr.some((n, i) => i !== idx && n.toLowerCase() === trimmed.toLowerCase())) {
          alert('มีรายการนี้อยู่แล้ว');
          return;
        }
        arr[idx] = trimmed;
        if (typeof window.loadAllTransactions === 'function') {
          try { await window.loadAllTransactions(); } catch (e) { console.warn(e); }
        }
        let updatedCount = 0;
        for (const tx of (window.appData.transactions || [])) {
          if (!tx.subCategory) continue;
          let changed = false;
          if (tx.subCategory === oldName) {
            tx.subCategory = trimmed;
            changed = true;
          } else if (tx.subCategory.includes(oldName)) {
            const parts = tx.subCategory.split(',').map(s => s.trim());
            for (let i = 0; i < parts.length; i++) {
              if (parts[i] === oldName) {
                parts[i] = trimmed;
                changed = true;
              }
            }
            if (changed) {
              tx.subCategory = parts.join(', ');
            }
          }
          if (changed) {
            updatedCount++;
            if (window.SomtumStore && SomtumStore.putTx) {
              try {
                await SomtumStore.putTx(tx);
                if (SomtumStore.markDirty) await SomtumStore.markDirty(tx.id);
              } catch (e) { console.warn('putTx after renameMaterial', e); }
            }
          }
        }
        window.syncDataToCloud(true);
        if (window.currentUser && updatedCount > 0) {
          try {
            let batch = window.writeBatch(window.db);
            let count = 0;
            for (const tx of window.appData.transactions) {
              if (tx.subCategory === trimmed || (tx.subCategory || '').includes(trimmed)) {
                const txRef = window.doc(window.db, "users", window.currentUser.uid, "transactions", tx.id);
                batch.set(txRef, JSON.parse(JSON.stringify(tx)), { merge: true });
                count++;
                if (count >= 400) { await batch.commit(); batch = window.writeBatch(window.db); count = 0; }
              }
            }
            if (count > 0) await batch.commit();
          } catch (e) {
            console.error('Rename material tx sync error:', e);
            window.showToast('แก้ไขชื่อแล้ว แต่ซิงค์รายการบางส่วนล้มเหลว', 'error');
          }
        }
        window.renderMaterialTags();
        window.refreshDashboard();
        window.showToast(updatedCount > 0
          ? `แก้ไข${type}เรียบร้อย (อัปเดต ${updatedCount} รายการ)`
          : `แก้ไข${type}เรียบร้อย`);
      });
    };

    window.deleteMaterialItem = function(type, idx) {
      const itemName = type === 'วัตถุดิบ'
        ? (window.appData.materials[idx] || 'รายการนี้')
        : (window.appData.equipments[idx] || 'รายการนี้');
      const usedCount = (window.appData.transactions || []).filter(t => (t.subCategory || '').includes(itemName)).length;
      const warnMsg = usedCount > 0
        ? `"${itemName}" ถูกใช้ใน ${usedCount} รายการแล้ว การลบอาจทำให้รายการเก่าหายจาก checklist ต้องการลบจริงหรือไม่?`
        : `ต้องการลบ${type} "${itemName}" ใช่หรือไม่?`;
      window.showConfirmModal("ยืนยันการลบ", warnMsg, () => {
        if(type === 'วัตถุดิบ') window.appData.materials.splice(idx, 1);
        else window.appData.equipments.splice(idx, 1);
        window.syncDataToCloud(true);
        window.renderMaterialTags();
        window.showToast('ลบรายการสำเร็จ');
      });
    }

    window.resetAllData = function() {
      window.showConfirmModal(
        "ยืนยันการล้างข้อมูลทั้งหมด",
        "ข้อมูลรายรับ-รายจ่าย หมวดหมู่ และเป้าหมายทั้งหมดจะถูกลบทั้งในเครื่องและบน Cloud (ถ้าล็อกอินอยู่) การกระทำนี้ไม่สามารถย้อนกลับได้",
        async () => {
          window.showToast("กำลังล้างข้อมูล...");
          // Clear IndexedDB tx + meta + kv + legacy sources completely
          if (window.SomtumStore && SomtumStore.clearAllUserData) {
            try {
              await SomtumStore.clearAllUserData();
            } catch (e) {
              console.error('clearAllUserData failed', e);
            }
          }
          window.appData = {
            transactions: [],
            categories: JSON.parse(JSON.stringify(window.DEFAULT_CATEGORIES)),
            materials: [...window.DEFAULT_MATERIALS],
            equipments: [...window.DEFAULT_EQUIPMENTS],
            customGoal: null,
            customGoalPercent: null
          };
          window.__txCacheLoaded = false;
          window.__loadedRange = { start: null, end: null };
          // Persist empty meta (defaults only) so IDB is not left empty for migrate to refill
          try {
            if (window.SomtumStore && SomtumStore.persistAppState) {
              await SomtumStore.persistAppState(window.appData, { writeAllTx: true });
            }
            if (window.SomtumStore && typeof SomtumStore.flush === 'function') {
              await SomtumStore.flush();
            }
          } catch (e) {
            console.error('persist empty state after clear failed', e);
          }
          window.saveLocalOnly();
          if (typeof lastAutoBackupHash !== 'undefined') lastAutoBackupHash = '';

          if (window.currentUser && window.db) {
            try {
              // Restore owner uid after clearAll wiped it
              SomtumStore.setItem('somtumDataOwnerUid', window.currentUser.uid);
              const settingsRef = window.doc(window.db, "users", window.currentUser.uid, "meta", "settings");
              await window.setDoc(settingsRef, {
                categories: window.appData.categories,
                materials: window.appData.materials,
                equipments: window.appData.equipments,
                customGoal: null,
                customGoalPercent: null,
                updatedAt: new Date().toISOString()
              });
              const txCollRef = window.collection(window.db, "users", window.currentUser.uid, "transactions");
              const snap = await window.getDocs(txCollRef);
              let batch = window.writeBatch(window.db);
              let count = 0;
              for (const d of snap.docs) {
                batch.delete(d.ref);
                count++;
                if (count >= 400) {
                  await batch.commit();
                  batch = window.writeBatch(window.db);
                  count = 0;
                }
              }
              if (count > 0) await batch.commit();
            } catch (e) {
              console.error("Reset cloud error:", e);
            }
          }
          window.refreshDashboard();
          window.showToast("ล้างข้อมูลทั้งหมดเรียบร้อยแล้ว");
        }
      );
    };

    // ==================== NEW FEATURES (Clean - No Multi-Shop) ====================

    // ----- Dark Mode -----
    window.toggleDarkMode = function() {
      const html = document.documentElement;
      const isDark = html.classList.toggle('dark');
      SomtumStore.setItem('somtumDarkMode', isDark ? '1' : '0');
      const icon = document.getElementById('darkModeIcon');
      if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      window.showToast(isDark ? 'เปิดโหมดมืดแล้ว' : 'เปิดโหมดสว่างแล้ว');
    };
    (function initDark() {
      if (SomtumStore.getItem('somtumDarkMode') === '1') {
        document.documentElement.classList.add('dark');
        const icon = document.getElementById('darkModeIcon');
        if (icon) icon.className = 'fa-solid fa-sun';
      }
    })();

    // ----- Goal Notification (persistent flag) -----
    window.checkGoalNotification = function() {
      const filteredTx = window.getTimeFilteredTransactions();
      const gSums = window.sumIncomeExpense(filteredTx);
      let totalIncome = gSums.income, totalExpense = gSums.expense;
      const targetGoal = window.resolveTargetGoal(totalExpense, totalIncome);
      const pct = targetGoal > 0 ? (totalIncome / targetGoal) * 100 : 0;
      const now = Date.now();
      const lastNotified = parseInt(SomtumStore.getItem('somtumLastGoalNotified') || '0', 10);

      if (pct >= 100 && now - lastNotified > 300000) { // 5 min cooldown
        SomtumStore.setItem('somtumLastGoalNotified', String(now));
        window.showToast('🎉 ยินดีด้วย! บรรลุเป้าหมายแล้ว ' + pct.toFixed(0) + '%', 'success');
        if (typeof Notification !== 'undefined') {
          if (Notification.permission === 'granted') {
            new Notification('ระบบบันทึกต้นทุน กำไร - STone', { body: 'บรรลุเป้าหมายรายรับแล้ว! ' + pct.toFixed(0) + '%', icon: './icon-192.png' });
          } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
          }
        }
      } else if (pct >= 80 && pct < 100 && now - lastNotified > 600000) {
        SomtumStore.setItem('somtumLastGoalNotified', String(now));
        window.showToast('ใกล้บรรลุเป้าหมายแล้ว! ' + pct.toFixed(0) + '%', 'success');
      }
    };

    // Hook into refreshDashboard (safe, preserve async)
    if (typeof window.refreshDashboard === 'function') {
      const originalRefresh = window.refreshDashboard;
      window.refreshDashboard = async function() {
        await originalRefresh();
        window.checkGoalNotification();
      };
    }

    // ----- Auto Backup (content hash + scoped) -----
    let lastAutoBackupHash = '';
    /** djb2 hash — catches any content change (notes, category names, etc.) */
    function simpleContentHash(str) {
      let h = 5381;
      for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) + str.charCodeAt(i);
        h = h >>> 0; // force uint32
      }
      return h.toString(36);
    }
    window.performAutoBackup = async function() {
      try {
        let data = window.appData;
        if (window.SomtumStore && SomtumStore.buildLegacyAppData) {
          data = await SomtumStore.buildLegacyAppData(window.appData);
        }
        const dataStr = JSON.stringify(data);
        const hash = simpleContentHash(dataStr);
        if (hash === lastAutoBackupHash) return;
        // Respect LS size guard used by SomtumStore (avoid silent quota failures)
        const maxChars = (window.SomtumStore && SomtumStore.LS_APPDATA_MAX_CHARS)
          ? SomtumStore.LS_APPDATA_MAX_CHARS
          : 400000;
        if (dataStr.length > maxChars) {
          // Still try IDB-only path via setItem (storage skips oversized LS mirror)
          console.warn('[STone autoBackup] large payload', dataStr.length, 'chars — IDB/kv only');
        }
        SomtumStore.setItem('somtumAutoBackup', dataStr);
        SomtumStore.setItem('somtumAutoBackupTime', new Date().toISOString());
        if (window.currentUser) SomtumStore.setItem('somtumAutoBackupUid', window.currentUser.uid);
        lastAutoBackupHash = hash;
        // Verify read-back for critical recovery path
        const check = SomtumStore.getItem('somtumAutoBackup');
        if (!check && dataStr.length <= maxChars) {
          console.warn('[STone autoBackup] write verification failed (quota?)');
        }
      } catch (e) { console.warn('[STone] Auto backup failed', e); }
    };
    window.restoreAutoBackup = function() {
      const bak = SomtumStore.getItem('somtumAutoBackup');
      const t = SomtumStore.getItem('somtumAutoBackupTime');
      const bakUid = SomtumStore.getItem('somtumAutoBackupUid');
      if (!bak) {
        alert('ยังไม่มี Auto Backup');
        return;
      }
      // Prevent restoring another user's backup
      if (window.currentUser && bakUid && bakUid !== window.currentUser.uid) {
        alert('Auto Backup นี้เป็นของบัญชีอื่น ไม่สามารถกู้คืนได้');
        return;
      }
      if (!window.currentUser && bakUid) {
        // Guest trying to restore a logged-in user's backup
        if (!confirm('Auto Backup นี้สร้างจากบัญชีที่ล็อกอินอยู่ ต้องการกู้คืนเป็นข้อมูล Guest ใช่หรือไม่?')) return;
      }
      window.showConfirmModal('กู้คืนจาก Auto Backup', 'ข้อมูลปัจจุบันจะถูกแทนที่ด้วยสำรองเมื่อ ' + (t ? new Date(t).toLocaleString('th-TH') : 'ไม่ทราบเวลา') + ' ต้องการดำเนินการต่อหรือไม่?', async () => {
        try {
          // Parse backup BEFORE clear — clearAllUserData wipes somtumAutoBackup keys
          const restored = window.sanitizeAppData(JSON.parse(bak));
          const ownerUid = window.currentUser ? window.currentUser.uid : (bakUid || null);
          if (window.SomtumStore && SomtumStore.clearAllUserData) {
            await SomtumStore.clearAllUserData();
          }
          if (ownerUid) SomtumStore.setItem('somtumDataOwnerUid', ownerUid);
          window.appData = restored;
          if (window.SomtumStore && SomtumStore.persistAppState) {
            await SomtumStore.persistAppState(restored, { writeAllTx: true });
            if (SomtumStore.markDirty) {
              for (const tx of (restored.transactions || [])) {
                if (tx && tx.id) await SomtumStore.markDirty(tx.id);
              }
            }
            if (SomtumStore.markMetaDirty) SomtumStore.markMetaDirty();
          }
          window.__txCacheLoaded = false;
          window.__loadedRange = { start: null, end: null };
          window.saveLocalOnly();
          window.syncDataToCloud();
          if (typeof window.ensureTransactionsLoaded === 'function') {
            await window.ensureTransactionsLoaded(true);
          }
          window.refreshDashboard();
          window.showToast('กู้คืนจาก Auto Backup สำเร็จ');
        } catch (e) {
          console.error(e);
          alert('กู้คืนล้มเหลว');
        }
      });
    };
    setInterval(window.performAutoBackup, 15 * 60 * 1000);
    // Auto-backup debounce is handled inside unified saveLocalOnly (module script)

    // ----- Weekly backup reminder -----
    window.markWeeklyBackupDone = function() {
      SomtumStore.setItem('somtumLastBackupRemind', String(Date.now()));
    };
    window.checkWeeklyBackupReminder = function() {
      // Disabled: popup เตือนสำรองข้อมูลประจำสัปดาห์รบกวนการใช้งานจริง
      // ยังคงมี Auto Backup เงียบ ๆ ในพื้นหลัง และปุ่ม Export/กู้คืนได้ตามปกติ
      return;
    };
    // Hook after finish loading
    if (typeof window.finishLoading === 'function') {
      const _finBak = window.finishLoading;
      window.finishLoading = function() {
        _finBak();
        // Weekly backup reminder popup disabled (annoying in real use)
        // STone auto backup snapshot shortly after UI ready (silent, no popup)
        setTimeout(function() {
          if (typeof window.performAutoBackup === 'function') {
            window.performAutoBackup();
          }
        }, 4000);
      };
    }

    // Confirm before leaving if there is unsynced data
    window.addEventListener('beforeunload', function(e) {
      const hasUnsynced = SomtumStore.getItem('somtumHasUnsyncedData') === 'true';
      const pendingSettings = !!window._pendingSettingsSync;
      if (hasUnsynced || pendingSettings) {
        // Try one last sync attempt (best-effort; browser may cancel async)
        try {
          if (typeof window.syncDataToCloud === 'function' && window.currentUser) {
            window.syncDataToCloud(true);
          }
          if (typeof window.saveLocalOnly === 'function') {
            window.saveLocalOnly();
          }
          if (window.SomtumStore && typeof window.SomtumStore.flush === 'function') {
            // Best-effort; browser may kill async work on unload
            window.SomtumStore.flush();
          }
        } catch (err) { /* ignore */ }
        e.preventDefault();
        e.returnValue = 'มีข้อมูลที่อาจยังไม่ได้ซิงค์ ต้องการออกจากหน้านี้จริงหรือไม่?';
        return e.returnValue;
      }
    });

    // ----- Online / Offline status + pending sync queue -----
    window.updateNetworkStatusUI = function() {
      const online = navigator.onLine;
      const badge = document.getElementById('networkStatusBadge');
      const text = document.getElementById('networkStatusText');
      if (badge) {
        if (online) {
          badge.className = 'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700';
          badge.innerHTML = '<i class="fa-solid fa-wifi"></i> ออนไลน์';
        } else {
          badge.className = 'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700';
          badge.innerHTML = '<i class="fa-solid fa-plane"></i> ออฟไลน์';
        }
      }
      if (text) {
        if (online) {
          text.className = 'text-[10px] mt-0.5 font-medium text-emerald-600';
          text.innerHTML = '<i class="fa-solid fa-wifi mr-1"></i>ออนไลน์';
        } else {
          text.className = 'text-[10px] mt-0.5 font-medium text-rose-500';
          text.innerHTML = '<i class="fa-solid fa-plane mr-1"></i>ออฟไลน์ — บันทึกในเครื่องก่อน';
        }
      }
    };

    window.flushPendingSync = async function() {
      if (!navigator.onLine) return;
      if (!window.currentUser) return;
      const hasUnsynced = SomtumStore.getItem('somtumHasUnsyncedData') === 'true';
      const pendingSettings = !!window._pendingSettingsSync;
      if (!hasUnsynced && !pendingSettings) return;
      try {
        window.showToast('เน็ตกลับมาแล้ว กำลังซิงค์ข้อมูลค้าง...', 'success');
        if (typeof window.checkAndSyncCloudData === 'function') {
          await window.checkAndSyncCloudData(false);
        } else if (typeof window.syncDataToCloud === 'function') {
          window.syncDataToCloud(true);
        }
      } catch (e) {
        console.error('flushPendingSync error:', e);
      }
    };

    window.addEventListener('online', function() {
      window.updateNetworkStatusUI();
      window.showToast('กลับมาออนไลน์แล้ว', 'success');
      // Small delay to let network stabilize
      setTimeout(() => window.flushPendingSync(), 1200);
    });
    window.addEventListener('offline', function() {
      window.updateNetworkStatusUI();
      window.showToast('ออฟไลน์ — ข้อมูลจะถูกบันทึกในเครื่อง', 'error');
    });
    // Initial paint
    window.updateNetworkStatusUI();
    if (typeof window.updatePendingSyncButton === 'function') window.updatePendingSyncButton();


    // ----- PWA install prompt (browser only; skip if already installed) -----
    window._deferredPwaPrompt = null;
    window._pwaInstallMode = 'manual'; // 'native' | 'manual'

    window.isRunningAsInstalledPwa = function() {
      try {
        if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
        if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) return true;
        if (typeof navigator !== 'undefined' && navigator.standalone === true) return true; // iOS Safari
      } catch (e) { /* ignore */ }
      return false;
    };

    window.dismissPwaInstallPrompt = function(days) {
      days = days || 14;
      try {
        localStorage.setItem('stonePwaInstallDismissedAt', String(Date.now()));
        localStorage.setItem('stonePwaInstallDismissDays', String(days));
      } catch (e) { /* ignore */ }
      const modal = document.getElementById('pwaInstallModal');
      if (modal) modal.classList.add('hidden');
    };

    window.shouldShowPwaInstallPrompt = function() {
      if (window.isRunningAsInstalledPwa()) return false;
      try {
        const at = parseInt(localStorage.getItem('stonePwaInstallDismissedAt') || '0', 10);
        const days = parseInt(localStorage.getItem('stonePwaInstallDismissDays') || '14', 10);
        if (at && Date.now() - at < days * 24 * 60 * 60 * 1000) return false;
      } catch (e) { /* ignore */ }
      return true;
    };

    /** Detect platform/browser for install guidance */
    window.detectPwaInstallPlatform = function() {
      const ua = (navigator.userAgent || '').toLowerCase();
      const isIOS = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isAndroid = /android/.test(ua);
      const isMac = /macintosh|mac os x/.test(ua) && !isIOS;
      const isWin = /windows/.test(ua);
      const isLinux = /linux/.test(ua) && !isAndroid;

      // In-app browsers cannot install PWAs reliably
      const isLine = /line\//.test(ua);
      const isFB = /fban|fbav|fb_iab|instagram/.test(ua);
      const isInApp = isLine || isFB || /wv\)|; wv/.test(ua);

      const isChrome = /chrome|crios|chromium/.test(ua) && !/edg|opr|samsung/.test(ua);
      const isEdge = /edg\//.test(ua);
      const isSamsung = /samsungbrowser/.test(ua);
      const isFirefox = /firefox|fxios/.test(ua);
      const isSafari = /safari/.test(ua) && !/chrome|crios|chromium|android|fxios/.test(ua);
      const isOpera = /opr|opera/.test(ua);

      return {
        isIOS: isIOS,
        isAndroid: isAndroid,
        isMac: isMac,
        isWin: isWin,
        isLinux: isLinux,
        isDesktop: !isIOS && !isAndroid,
        isInApp: isInApp,
        isLine: isLine,
        isFB: isFB,
        isChrome: isChrome,
        isEdge: isEdge,
        isSamsung: isSamsung,
        isFirefox: isFirefox,
        isSafari: isSafari,
        isOpera: isOpera
      };
    };

    /** Manual install steps per platform (Thai) */
    window.getPwaManualInstallGuide = function() {
      const p = window.detectPwaInstallPlatform();

      if (p.isInApp) {
        const appName = p.isLine ? 'LINE' : (p.isFB ? 'Facebook/Instagram' : 'แอปนี้');
        return {
          label: 'เปิดในเบราว์เซอร์จริงก่อนติดตั้ง',
          steps: [
            'ตอนนี้คุณเปิดผ่าน ' + appName + ' ซึ่งติดตั้งแอปลงหน้าจอโฮมไม่ได้',
            'แตะเมนู ⋯ หรือปุ่มเปิดในเบราว์เซอร์ (Open in browser)',
            p.isIOS
              ? 'เลือกเปิดด้วย Safari แล้วค่อยทำตามขั้นตอน iPhone ด้านล่าง'
              : 'เลือกเปิดด้วย Chrome แล้วกดเมนู ⋮ → "ติดตั้งแอป" หรือ "Add to Home screen"',
            'หรือคัดลอกลิงก์นี้ แล้ววางใน Chrome / Safari โดยตรง'
          ]
        };
      }

      if (p.isIOS) {
        return {
          label: 'วิธีติดตั้งบน iPhone / iPad (Safari)',
          steps: [
            'เปิดเว็บนี้ด้วย Safari (ไม่ใช่ Chrome ในบางเวอร์ชันที่ยังไม่รองรับ)',
            'แตะปุ่มแชร์ □↑ ที่แถบล่าง (หรือบนสุด)',
            'เลื่อนหาแล้วแตะ "เพิ่มไปยังหน้าจอโฮม" (Add to Home Screen)',
            'กด "เพิ่ม" — ไอคอน STone จะปรากฏบนหน้าจอโฮม'
          ]
        };
      }

      if (p.isAndroid && p.isSamsung) {
        return {
          label: 'วิธีติดตั้งบน Android (Samsung Internet)',
          steps: [
            'แตะเมนู ☰ หรือ ⋮ มุมบน/ล่าง',
            'เลือก "เพิ่มหน้าไปยัง" หรือ "Add page to"',
            'เลือก "หน้าจอหลัก" / Home screen',
            'ยืนยัน — ไอคอน STone จะขึ้นบนหน้าจอโฮม'
          ]
        };
      }

      if (p.isAndroid && p.isFirefox) {
        return {
          label: 'วิธีติดตั้งบน Android (Firefox)',
          steps: [
            'แตะเมนู ⋮ มุมขวาบน',
            'เลือก "ติดตั้ง" หรือ "Install"',
            'ถ้าไม่มีเมนูติดตั้ง ให้เลือก "Add to Home screen"',
            'ยืนยันการเพิ่มไอคอนลงหน้าจอโฮม'
          ]
        };
      }

      if (p.isAndroid) {
        return {
          label: 'วิธีติดตั้งบน Android (Chrome)',
          steps: [
            'แตะเมนู ⋮ มุมขวาบน',
            'เลือก "ติดตั้งแอป" หรือ "Install app" / "Add to Home screen"',
            'กดติดตั้ง/เพิ่ม — เปิด STone จากไอคอนบนหน้าจอโฮมได้เลย',
            'ถ้าไม่เห็นเมนู: รีเฟรชหน้า รอสักครู่ แล้วเปิดเมนูอีกครั้ง'
          ]
        };
      }

      if (p.isDesktop && (p.isChrome || p.isEdge || p.isOpera)) {
        return {
          label: 'วิธีติดตั้งบนคอมพิวเตอร์ (Chrome / Edge)',
          steps: [
            'ดูที่แถบที่อยู่ (Address bar) ด้านขวา มีไอคอนติดตั้ง ⊕ หรือคอมพิวเตอร์พร้อมลูกศร',
            'คลิกไอคอนนั้น แล้วกด "ติดตั้ง"',
            'หรือเปิดเมนู ⋮ → "ติดตั้ง STone…" / "Install STone…"',
            'หลังติดตั้งจะเปิดเป็นหน้าต่างแอปแยกจากเบราว์เซอร์'
          ]
        };
      }

      if (p.isDesktop && p.isFirefox) {
        return {
          label: 'วิธีติดตั้งบนคอมพิวเตอร์ (Firefox)',
          steps: [
            'Firefox ยังไม่รองรับการติดตั้ง PWA เต็มรูปแบบบนเดสก์ท็อปบางเวอร์ชัน',
            'แนะนำเปิดด้วย Google Chrome หรือ Microsoft Edge',
            'จากนั้นใช้ไอคอนติดตั้งบนแถบที่อยู่ หรือเมนู ⋮ → ติดตั้งแอป',
            'หรือสร้างบุ๊กมาร์กไว้ใช้ชั่วคราว'
          ]
        };
      }

      if (p.isMac && p.isSafari) {
        return {
          label: 'วิธีติดตั้งบน Mac (Safari)',
          steps: [
            'ใน Safari เมนู File (ไฟล์) → "Add to Dock" หรือ "เพิ่มใน Dock" (macOS ใหม่)',
            'หรือแชร์ → เพิ่มไปยัง Dock / Home Screen ตามเวอร์ชันระบบ',
            'ถ้าไม่พบเมนู แนะนำเปิดด้วย Chrome แล้วกดติดตั้งจากแถบที่อยู่',
            'หลังเพิ่มแล้วเปิดจาก Dock ได้เหมือนแอป'
          ]
        };
      }

      return {
        label: 'วิธีติดตั้งลงหน้าจอโฮม',
        steps: [
          'เปิดเมนูของเบราว์เซอร์ (⋮ หรือ ☰)',
          'เลือก "ติดตั้งแอป" / "Install app" หรือ "Add to Home screen"',
          'ยืนยันการติดตั้ง — ไอคอน STone จะปรากฏบนหน้าจอโฮมหรือเดสก์ท็อป',
          'ถ้าไม่พบเมนู ลองเปิดด้วย Chrome หรือ Safari แล้วทำซ้ำ'
        ]
      };
    };

    /** Update modal UI for native vs manual mode */
    window.updatePwaInstallModalUI = function() {
      const canNative = !!window._deferredPwaPrompt;
      window._pwaInstallMode = canNative ? 'native' : 'manual';

      const nativeBlock = document.getElementById('pwaInstallNativeBlock');
      const manualBlock = document.getElementById('pwaInstallManualBlock');
      const okBtn = document.getElementById('pwaInstallOk');
      const title = document.getElementById('pwaInstallTitle');
      const subtitle = document.getElementById('pwaInstallSubtitle');
      const platformLabel = document.getElementById('pwaInstallPlatformLabel');
      const stepsEl = document.getElementById('pwaInstallSteps');
      const hint = document.getElementById('pwaInstallHint');

      if (hint) hint.classList.add('hidden');

      if (canNative) {
        if (nativeBlock) nativeBlock.classList.remove('hidden');
        if (manualBlock) manualBlock.classList.add('hidden');
        if (okBtn) {
          okBtn.textContent = 'ติดตั้งเลย';
          okBtn.classList.remove('hidden');
        }
        if (title) title.textContent = 'ติดตั้ง STone ลงหน้าจอโฮม';
        if (subtitle) {
          subtitle.textContent = 'กดปุ่ม "ติดตั้งเลย" เพื่อติดตั้งทันที เปิดใช้ได้เหมือนแอปและใช้งานออฟไลน์ได้';
        }
      } else {
        if (nativeBlock) nativeBlock.classList.add('hidden');
        if (manualBlock) manualBlock.classList.remove('hidden');
        const guide = window.getPwaManualInstallGuide();
        if (platformLabel) platformLabel.textContent = guide.label;
        if (stepsEl) {
          stepsEl.innerHTML = '';
          (guide.steps || []).forEach(function(step) {
            const li = document.createElement('li');
            li.textContent = step;
            stepsEl.appendChild(li);
          });
        }
        if (okBtn) {
          // Manual mode: primary action is "เข้าใจแล้ว" (close); steps already visible
          okBtn.textContent = 'เข้าใจแล้ว';
        }
        if (title) title.textContent = 'ติดตั้ง STone ลงหน้าจอโฮม';
        if (subtitle) {
          subtitle.textContent = 'เบราว์เซอร์นี้ติดตั้งอัตโนมัติไม่ได้ — ทำตามขั้นตอนด้านล่างได้เลย';
        }
      }
    };

    window.showPwaInstallPrompt = function() {
      if (!window.shouldShowPwaInstallPrompt()) return;
      const modal = document.getElementById('pwaInstallModal');
      if (!modal) return;
      window.updatePwaInstallModalUI();
      modal.classList.remove('hidden');
    };

    window.triggerNativePwaInstall = async function() {
      if (!window._deferredPwaPrompt) return false;
      try {
        window._deferredPwaPrompt.prompt();
        const choice = await window._deferredPwaPrompt.userChoice;
        window._deferredPwaPrompt = null;
        window.updatePwaInstallModalUI();
        if (choice && choice.outcome === 'accepted') {
          window.dismissPwaInstallPrompt(365);
          if (typeof window.showToast === 'function') {
            window.showToast('กำลังติดตั้ง STone…', 'success');
          }
          return true;
        }
        // User dismissed native dialog — hide our modal for a week
        window.dismissPwaInstallPrompt(7);
        return false;
      } catch (err) {
        console.warn('[STone] native install prompt failed', err);
        window._deferredPwaPrompt = null;
        // Fall back to manual instructions
        window.updatePwaInstallModalUI();
        window.showPwaInstallPrompt();
        return false;
      }
    };

    window.initPwaInstallPrompt = function() {
      if (window.isRunningAsInstalledPwa()) return;
      if (window._pwaInstallInited) return;
      window._pwaInstallInited = true;

      window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        window._deferredPwaPrompt = e;
        // If modal already open in manual mode, switch to native install button
        const modal = document.getElementById('pwaInstallModal');
        if (modal && !modal.classList.contains('hidden')) {
          window.updatePwaInstallModalUI();
        }
      });

      window.addEventListener('appinstalled', function() {
        window._deferredPwaPrompt = null;
        window.dismissPwaInstallPrompt(365);
        if (typeof window.showToast === 'function') {
          window.showToast('ติดตั้ง STone เรียบร้อยแล้ว', 'success');
        }
      });

      const dismissBtn = document.getElementById('pwaInstallDismiss');
      const okBtn = document.getElementById('pwaInstallOk');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', function() {
          window.dismissPwaInstallPrompt(14);
        });
      }
      if (okBtn) {
        okBtn.addEventListener('click', async function() {
          // Native path: trigger browser install UI immediately
          if (window._deferredPwaPrompt) {
            await window.triggerNativePwaInstall();
            return;
          }
          // Manual path: steps already shown — acknowledge and close
          window.dismissPwaInstallPrompt(7);
        });
      }

      // Wait a bit for beforeinstallprompt (Chrome often fires after SW is ready)
      setTimeout(function() {
        if (window.shouldShowPwaInstallPrompt()) {
          window.showPwaInstallPrompt();
        }
      }, 4500);
      // Second chance: if prompt event arrives late, modal UI updates via listener;
      // if modal was never shown and event exists, show again once more
      setTimeout(function() {
        if (!window.shouldShowPwaInstallPrompt()) return;
        const modal = document.getElementById('pwaInstallModal');
        if (modal && modal.classList.contains('hidden') && window._deferredPwaPrompt) {
          window.showPwaInstallPrompt();
        } else if (modal && !modal.classList.contains('hidden')) {
          window.updatePwaInstallModalUI();
        }
      }, 9000);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        window.initPwaInstallPrompt();
      });
    } else {
      window.initPwaInstallPrompt();
    }


    // ----- Register Service Worker -----
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function() {
        // Prefer sibling service-worker.js (same directory as this HTML when hosted)
        const swUrl = 'service-worker.js';
        navigator.serviceWorker.register(swUrl).then(function(reg) {
          console.log('Service Worker registered:', reg.scope);
        }).catch(function(err) {
          console.warn('Service Worker registration failed:', err);
        });
      });
    }

