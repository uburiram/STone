/**
 * Firebase Auth + Firestore sync for STone
 * Depends on: SomtumStore (js/storage.js), window.appData helpers (js/app.js)
 */
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
    import { getAuth, initializeAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, indexedDBLocalPersistence, browserPopupRedirectResolver } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
    import {
      initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
      collection, doc, getDoc, setDoc, deleteDoc, getDocs, onSnapshot, writeBatch
    } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

    
// Ensure IndexedDB store is ready before any auth/hydrate path touches app data.
// app.js may still be parsing; init is idempotent and LS fallback works either way.
if (typeof SomtumStore !== 'undefined' && SomtumStore.init) {
  await SomtumStore.init();
}

const firebaseConfig = {
      apiKey: "AIzaSyAPWL6-lCNacvrVT3ap1YUAe6emoL74Rj8",
      authDomain: "stone-3eac7.firebaseapp.com",
      projectId: "stone-3eac7",
      storageBucket: "stone-3eac7.firebasestorage.app",
      messagingSenderId: "987122684250",
      appId: "1:987122684250:web:b0c73525f863885a2b2363",
      measurementId: "G-68EG2KRP15"
    };

    const app = initializeApp(firebaseConfig);

    // initializeAuth + popupRedirectResolver is required for reliable Google login
    // when the app is hosted OUTSIDE Firebase Hosting (e.g. GitHub Pages).
    // signInWithRedirect is broken on GH Pages because browsers block third-party
    // storage between uburiram.github.io and *.firebaseapp.com.
    let auth;
    try {
      auth = initializeAuth(app, {
        persistence: indexedDBLocalPersistence,
        popupRedirectResolver: browserPopupRedirectResolver
      });
    } catch (e) {
      // Already initialized (HMR / double load)
      auth = getAuth(app);
      try {
        await setPersistence(auth, indexedDBLocalPersistence);
      } catch (e2) {
        try { await setPersistence(auth, browserLocalPersistence); } catch (e3) { /* */ }
      }
    }
    window.auth = auth;

    // Firestore offline persistence (IndexedDB)
    let db;
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      });
    } catch (e) {
      console.warn('persistentLocalCache unavailable, fallback getFirestore-compatible init', e);
      const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      db = getFirestore(app);
    }
    window.db = db;
    window._firestoreOfflineEnabled = true;
    window.collection = collection;
    window.doc = doc;
    window.getDoc = getDoc;
    window.setDoc = setDoc;
    window.deleteDoc = deleteDoc;
    window.getDocs = getDocs;
    window.writeBatch = writeBatch;
    window.onSnapshot = onSnapshot;

    const googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({ prompt: 'select_account' });
    googleProvider.addScope('profile');
    googleProvider.addScope('email');

    window.currentUser = null;
    window.unsubTransactions = null;
    window.unsubSettings = null;
    let pendingGuestData = null;

    // Best-effort: complete any leftover redirect (usually null on GH Pages)
    try {
      if (auth.authStateReady) await auth.authStateReady();
      const redirectResult = await getRedirectResult(auth);
      if (redirectResult && redirectResult.user) {
        console.info('[auth] redirect result', redirectResult.user.email);
        if (typeof window.showToast === 'function') {
          window.showToast('ลงชื่อเข้าใช้สำเร็จ: ' + (redirectResult.user.displayName || redirectResult.user.email));
        }
      }
    } catch (error) {
      if (error && error.code && error.code !== 'auth/missing-initial-state') {
        console.error('Redirect Auth Error:', error);
      }
    }

    /**
     * Google login — POPUP first (works on GitHub Pages).
     * Redirect is last resort only; often fails on GH Pages due to 3rd-party storage.
     */
    window.loginGoogle = async function() {
      try {
        if (typeof window.showToast === 'function') {
          window.showToast('กำลังเปิดหน้าต่างเข้าสู่ระบบ Google...');
        }

        const result = await signInWithPopup(auth, googleProvider);
        if (result && result.user) {
          // onAuthStateChanged will update UI; toast here for feedback
          if (typeof window.showToast === 'function') {
            window.showToast('ลงชื่อเข้าใช้สำเร็จ: ' + (result.user.displayName || result.user.email));
          }
          // Force UI if onAuthStateChanged is slow
          window.currentUser = result.user;
          try {
            const nameElem = document.getElementById('userName');
            const btnLogin = document.getElementById('btnLoginGoogle');
            const btnLogout = document.getElementById('btnLogoutGoogle');
            const statusElem = document.getElementById('userSyncText');
            const avatar = document.getElementById('userAvatar');
            if (nameElem) nameElem.innerText = result.user.displayName || result.user.email || 'ผู้ใช้ Google';
            if (btnLogin) btnLogin.classList.add('hidden');
            if (btnLogout) btnLogout.classList.remove('hidden');
            if (statusElem) statusElem.innerText = 'เชื่อมต่อ Google แล้ว — พร้อมซิงค์ Cloud';
            if (avatar && result.user.photoURL) avatar.src = result.user.photoURL;
          } catch (uiErr) { console.warn(uiErr); }
          return;
        }
      } catch (popupError) {
        const code = popupError && popupError.code;
        console.warn('[auth] popup failed', code, popupError);

        if (code === 'auth/popup-closed-by-user') {
          if (typeof window.showToast === 'function') {
            window.showToast('ปิดหน้าต่างเข้าสู่ระบบแล้ว', 'error');
          }
          return;
        }

        if (code === 'auth/popup-blocked') {
          alert(
            'เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป\n\n' +
            'วิธีแก้:\n' +
            '1) กดไอคอนป๊อปอัปในแถบที่อยู่ แล้ว "อนุญาต"\n' +
            '2) หรือเปิดเว็บใน Chrome/Safari (ไม่ใช่ในแอป LINE/Facebook)\n' +
            'แล้วกดเข้าสู่ระบบอีกครั้ง'
          );
          return;
        }

        // internal-error / network / other — explain clearly (redirect usually also fails on GH Pages)
        const msg = (popupError && popupError.message) ? popupError.message : String(popupError);
        alert(
          'เข้าสู่ระบบไม่สำเร็จ (' + (code || 'unknown') + ')\n\n' +
          msg + '\n\n' +
          'แนะนำ:\n' +
          '• เปิดเว็บใน Chrome หรือ Safari โดยตรง (ไม่เปิดผ่าน LINE)\n' +
          '• อนุญาตป๊อปอัปสำหรับ uburiram.github.io\n' +
          '• ตรวจว่าใน Firebase Console → Authentication → Authorized domains มี uburiram.github.io'
        );
      }
    };

    window.logoutGoogle = async function() {
      window.showConfirmModal(
        "ยืนยันการออกจากระบบ",
        "ระบบจะสลับเป็นโหมดใช้งานทั่วไป\n\nข้อมูลของบัญชีนี้ยังถูกเก็บแยกไว้ในเครื่อง (ไม่ปนกับร้านอื่น) เมื่อล็อกอินบัญชีเดิมอีกครั้งจะโหลดกลับมาอัตโนมัติ",
        async () => {
        try {
          if (window.unsubTransactions) { window.unsubTransactions(); window.unsubTransactions = null; }
          if (window.unsubSettings) { window.unsubSettings(); window.unsubSettings = null; }
          await signOut(auth);
          // Approach A: do NOT wipe the account DB — switch to isolated guest scope
          if (SomtumStore.switchScope) {
            await SomtumStore.switchScope(null);
          } else if (SomtumStore.clearAllUserData) {
            await SomtumStore.clearAllUserData();
          }
          if (typeof lastAutoBackupHash !== 'undefined') lastAutoBackupHash = '';
          window.__txCacheLoaded = false;
          window.__loadedRange = { start: null, end: null };
          // Load guest-scope data (may be empty or prior guest entries)
          if (typeof window.__hydrateAppDataFromStoreAsync === 'function') {
            await window.__hydrateAppDataFromStoreAsync();
          } else {
            window.appData = {
              transactions: [],
              categories: JSON.parse(JSON.stringify(window.DEFAULT_CATEGORIES)),
              materials: [...window.DEFAULT_MATERIALS],
              equipments: [...window.DEFAULT_EQUIPMENTS],
              customGoal: null,
              customGoalPercent: null
            };
          }
          if (typeof window.refreshDashboard === 'function') window.refreshDashboard();
          window.showToast('ออกจากระบบแล้ว — โหมดใช้งานทั่วไป');
        } catch (error) {
          console.error("Logout failed:", error);
        }
      });
    };

    onAuthStateChanged(auth, async (user) => {
      window.currentUser = user;
      const avatar = document.getElementById('userAvatar');
      const nameElem = document.getElementById('userName');
      const statusElem = document.getElementById('userSyncText');
      const badge = document.getElementById('syncStatusBadge');
      const btnLogin = document.getElementById('btnLoginGoogle');
      const btnLogout = document.getElementById('btnLogoutGoogle');

      if (user) {
        avatar.src = user.photoURL || './icon-192.png';
        nameElem.innerText = user.displayName || user.email || 'ผู้ใช้ Google';
        if (statusElem) statusElem.innerText = 'เชื่อมต่อ Google แล้ว — พร้อมซิงค์ Cloud';
        if (badge) badge.className = 'absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-emerald-500 border-2 border-white dark:border-gray-800 rounded-full';
        btnLogin.classList.add('hidden');
        btnLogout.classList.remove('hidden');

        // Snapshot guest-scope data BEFORE switching (for optional merge prompt)
        let guestSnapshot = null;
        try {
          const wasGuest = !SomtumStore.activeScope || SomtumStore.activeScope === 'guest';
          if (wasGuest) {
            let guestTx = [];
            if (SomtumStore.getAllTx) guestTx = await SomtumStore.getAllTx();
            const guestMeta = SomtumStore.getMeta ? await SomtumStore.getMeta() : null;
            if ((guestTx && guestTx.length) || (guestMeta && guestMeta.categories)) {
              guestSnapshot = {
                transactions: guestTx || [],
                categories: (guestMeta && guestMeta.categories) || (window.appData && window.appData.categories) || JSON.parse(JSON.stringify(window.DEFAULT_CATEGORIES)),
                materials: (guestMeta && guestMeta.materials) || (window.appData && window.appData.materials) || [...window.DEFAULT_MATERIALS],
                equipments: (guestMeta && guestMeta.equipments) || (window.appData && window.appData.equipments) || [...window.DEFAULT_EQUIPMENTS],
                customGoal: guestMeta && guestMeta.customGoal != null ? guestMeta.customGoal : (window.appData && window.appData.customGoal) || null,
                customGoalPercent: guestMeta && guestMeta.customGoalPercent != null ? guestMeta.customGoalPercent : (window.appData && window.appData.customGoalPercent) || null
              };
            }
          }
        } catch (snapErr) {
          console.warn('guest snapshot failed', snapErr);
        }

        // Approach A: open isolated IDB for this uid (does not touch guest / other uids)
        try {
          if (SomtumStore.switchScope) {
            await SomtumStore.switchScope(user.uid);
          } else {
            SomtumStore.setItem('somtumDataOwnerUid', user.uid);
          }
        } catch (scopeErr) {
          console.error('switchScope failed', scopeErr);
        }

        window.__txCacheLoaded = false;
        window.__loadedRange = { start: null, end: null };

        // Hydrate from THIS user's scope only
        try {
          if (typeof window.__hydrateAppDataFromStoreAsync === 'function') {
            await window.__hydrateAppDataFromStoreAsync();
          } else {
            if (SomtumStore.getAllTx) {
              const all = await SomtumStore.getAllTx();
              if (all) window.appData.transactions = all;
            }
            if (SomtumStore.getMeta) {
              const meta = await SomtumStore.getMeta();
              if (meta) {
                if (meta.categories) window.appData.categories = meta.categories;
                if (meta.materials) window.appData.materials = meta.materials;
                if (meta.equipments) window.appData.equipments = meta.equipments;
                if (meta.customGoal !== undefined) window.appData.customGoal = meta.customGoal;
                if (meta.customGoalPercent !== undefined) window.appData.customGoalPercent = meta.customGoalPercent;
              }
            }
            window.appData = window.sanitizeAppData(window.appData || {});
          }
        } catch (e) {
          console.warn('Auth hydrate failed:', e);
        }

        const userTxCount = (window.appData && window.appData.transactions)
          ? window.appData.transactions.length
          : 0;
        const guestTxCount = guestSnapshot && guestSnapshot.transactions
          ? guestSnapshot.transactions.length
          : 0;

        // Merge prompt only when: user scope is empty AND guest had local data
        if (userTxCount === 0 && guestTxCount > 0) {
          pendingGuestData = JSON.parse(JSON.stringify(guestSnapshot));
          const bakModal = document.getElementById('backupRemindModal');
          if (bakModal) bakModal.classList.add('hidden');
          const mergeModal = document.getElementById('guestMergeModal');
          if (mergeModal) mergeModal.classList.remove('hidden');
        } else {
          SomtumStore.setItem('somtumDataOwnerUid', user.uid);
          window.initFirestoreListeners();
        }
      } else {
        avatar.src = './icon-192.png';
        nameElem.innerText = 'ผู้ใช้งานทั่วไป (ยังไม่ได้ล็อกอิน)';
        statusElem.innerText = 'บันทึกข้อมูลเฉพาะในเครื่องนี้';
        badge.className = 'absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-gray-400 border-2 border-white rounded-full';
        btnLogin.classList.remove('hidden');
        btnLogout.classList.add('hidden');
        document.getElementById('btnSyncNow').classList.add('hidden');

        // Ensure guest scope is active when signed out (e.g. session expired)
        try {
          if (SomtumStore.switchScope && SomtumStore.activeScope !== 'guest') {
            await SomtumStore.switchScope(null);
            window.__txCacheLoaded = false;
            window.__loadedRange = { start: null, end: null };
            if (typeof window.__hydrateAppDataFromStoreAsync === 'function') {
              await window.__hydrateAppDataFromStoreAsync();
            }
            if (typeof window.refreshDashboard === 'function') window.refreshDashboard();
          }
        } catch (e) {
          console.warn('guest scope restore failed', e);
        }
      }
    });

    /**
     * Merge category subs trees by node name (case-insensitive).
     * - string leaf and branch with same name → keep branch, merge children
     * - two branches → recursive children merge
     * - local order preserved; cloud-only nodes appended
     */
    window.mergeSubsByName = function(localSubs, cloudSubs) {
      const local = Array.isArray(localSubs) ? localSubs : [];
      const cloud = Array.isArray(cloudSubs) ? cloudSubs : [];

      function nodeName(n) {
        if (typeof n === 'string') return n;
        if (n && typeof n === 'object' && typeof n.name === 'string') return n.name;
        return '';
      }
      function nodeChildren(n) {
        if (typeof n === 'string') return [];
        if (n && typeof n === 'object' && Array.isArray(n.children)) return n.children;
        return [];
      }
      function isBranch(n) {
        return n && typeof n === 'object' && typeof n.name === 'string';
      }

      const map = new Map(); // key = lower name → { name, childrenArr | null }
      const order = [];

      function upsert(node, preferCloudChildren) {
        const name = nodeName(node).trim();
        if (!name) return;
        const key = name.toLowerCase();
        const kids = nodeChildren(node);
        if (!map.has(key)) {
          order.push(key);
          if (kids.length > 0 || isBranch(node)) {
            map.set(key, { name: name, children: kids.slice() });
          } else {
            map.set(key, { name: name, children: null }); // pure leaf
          }
          return;
        }
        const cur = map.get(key);
        // Prefer preserving original display casing from first insert (local)
        if (kids.length > 0) {
          if (cur.children == null) cur.children = [];
          cur.children = window.mergeSubsByName(cur.children, kids);
        } else if (isBranch(node) && cur.children == null) {
          // empty branch stays leaf unless we already have children
        }
      }

      local.forEach(function(n) { upsert(n, false); });
      cloud.forEach(function(n) { upsert(n, true); });

      return order.map(function(key) {
        const cur = map.get(key);
        if (cur.children && cur.children.length > 0) {
          return { name: cur.name, children: cur.children };
        }
        return cur.name;
      });
    };

    window.resolveGuestDataConflict = async function(action) {
      document.getElementById('guestMergeModal').classList.add('hidden');
      if (!window.currentUser) return;

      try {
      if (action === 'merge') {
        window.showToast("กำลังนำเข้าข้อมูล...");
        const settingsRef = doc(db, "users", window.currentUser.uid, "meta", "settings");
        const cloudSnap = await getDoc(settingsRef);
        let cloudSettings = cloudSnap.exists() ? cloudSnap.data() : null;

        let mergedCategories = JSON.parse(JSON.stringify(window.appData.categories));
        let mergedMaterials = [...window.appData.materials];
        let mergedEquipments = [...window.appData.equipments];
        let mergedGoal = window.appData.customGoal;

        if (cloudSettings) {
          if (cloudSettings.materials) mergedMaterials = Array.from(new Set([...cloudSettings.materials, ...mergedMaterials]));
          if (cloudSettings.equipments) mergedEquipments = Array.from(new Set([...cloudSettings.equipments, ...mergedEquipments]));
          ['income', 'expense'].forEach(type => {
            if (cloudSettings.categories && cloudSettings.categories[type]) {
              const cloudCats = cloudSettings.categories[type];
              cloudCats.forEach(cloudCat => {
                let localCat = mergedCategories[type].find(c => c.name.trim().toLowerCase() === cloudCat.name.trim().toLowerCase());
                if (localCat) {
                  if (cloudCat.subs) {
                    localCat.subs = window.mergeSubsByName(localCat.subs || [], cloudCat.subs || []);
                  }
                  if (cloudCat.flags) {
                    localCat.flags = localCat.flags || {};
                    if (cloudCat.flags.isMaterialCategory) localCat.flags.isMaterialCategory = true;
                    if (cloudCat.flags.isEquipmentCategory) localCat.flags.isEquipmentCategory = true;
                  }
                } else {
                  // Deep-clone cloud cat so later local edits do not mutate the snapshot
                  mergedCategories[type].push(JSON.parse(JSON.stringify(cloudCat)));
                }
              });
            }
          });
          if (!mergedGoal && cloudSettings.customGoal) mergedGoal = cloudSettings.customGoal;
        }

        window.appData.categories = mergedCategories;
        window.appData.materials = mergedMaterials;
        window.appData.equipments = mergedEquipments;
        window.appData.customGoal = mergedGoal;

        // Sanitize + filter so every doc passes Firestore rules (no data loss of valid rows)
        const sanitizedGuest = window.sanitizeAppData
          ? window.sanitizeAppData({ transactions: pendingGuestData.transactions || [], categories: pendingGuestData.categories })
          : { transactions: pendingGuestData.transactions || [] };
        const localTx = (sanitizedGuest.transactions || []).filter(function(tx) {
          return tx && tx.id && (tx.type === 'income' || tx.type === 'expense') &&
            tx.date && Number(tx.amount) > 0;
        });
        let batch = writeBatch(db);
        let count = 0;
        for (const tx of localTx) {
          const clean = JSON.parse(JSON.stringify(tx));
          clean.id = String(clean.id);
          clean.amount = Number(clean.amount);
          const txRef = doc(db, "users", window.currentUser.uid, "transactions", clean.id);
          batch.set(txRef, clean, { merge: true });
          count++;
          if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }
        if (count > 0) await batch.commit();

        await setDoc(settingsRef, {
          categories: window.appData.categories,
          materials: window.appData.materials,
          equipments: window.appData.equipments,
          customGoal: window.appData.customGoal,
          customGoalPercent: window.appData.customGoalPercent,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        window.showToast('รวมข้อมูลสำเร็จ');
      } else if (action === 'local') {
        window.showToast("กำลังนำเข้าข้อมูล...");
        const settingsRef = doc(db, "users", window.currentUser.uid, "meta", "settings");
        await setDoc(settingsRef, {
          categories: pendingGuestData.categories,
          materials: pendingGuestData.materials,
          equipments: pendingGuestData.equipments,
          customGoal: pendingGuestData.customGoal,
          customGoalPercent: pendingGuestData.customGoalPercent,
          updatedAt: new Date().toISOString()
        });
        const txCollRef = collection(db, "users", window.currentUser.uid, "transactions");
        const snap = await getDocs(txCollRef);
        let batch = writeBatch(db);
        let count = 0;
        for (const d of snap.docs) {
          batch.delete(d.ref);
          count++;
          if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }
        if (count > 0) await batch.commit();

        batch = writeBatch(db);
        count = 0;
        const sanitizedLocal = window.sanitizeAppData
          ? window.sanitizeAppData({ transactions: pendingGuestData.transactions || [], categories: pendingGuestData.categories })
          : { transactions: pendingGuestData.transactions || [] };
        const localOnlyTx = (sanitizedLocal.transactions || []).filter(function(tx) {
          return tx && tx.id && (tx.type === 'income' || tx.type === 'expense') &&
            tx.date && Number(tx.amount) > 0;
        });
        for (const tx of localOnlyTx) {
          const clean = JSON.parse(JSON.stringify(tx));
          clean.id = String(clean.id);
          clean.amount = Number(clean.amount);
          const txRef = doc(db, "users", window.currentUser.uid, "transactions", clean.id);
          batch.set(txRef, clean);
          count++;
          if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }
        if (count > 0) await batch.commit();
        window.showToast('อัปโหลดข้อมูลเครื่องทับ Cloud เรียบร้อย');
      } else {
        // "ใช้ข้อมูลบน Cloud เท่านั้น" — ล้าง tx store + meta ทั้งหมด ไม่ใช่แค่ key เดียว
        if (SomtumStore.clearAllUserData) {
          try {
            await SomtumStore.clearAllUserData();
          } catch (e) {
            console.error('clearAllUserData (cloud-only) failed', e);
            SomtumStore.removeItem('somtumAppData');
          }
        } else {
          SomtumStore.removeItem('somtumAppData');
        }
        window.appData = {
          transactions: [],
          categories: JSON.parse(JSON.stringify(window.DEFAULT_CATEGORIES)),
          materials: [...window.DEFAULT_MATERIALS],
          equipments: [...window.DEFAULT_EQUIPMENTS],
          customGoal: null,
          customGoalPercent: null
        };
      }
      // setItem หลัง clearAll เพื่อ restore owner uid ที่ถูก wipe
      SomtumStore.setItem('somtumDataOwnerUid', window.currentUser.uid);
      pendingGuestData = null;
      window.initFirestoreListeners();
      } catch (err) {
        console.error("Guest merge error:", err);
        window.showToast('เกิดข้อผิดพลาดขณะรวมข้อมูล กรุณาลองใหม่', 'error');
        // Still try to init listeners so the app is usable
        try { window.initFirestoreListeners(); } catch(e) {}
      }
    };

    window.initFirestoreListeners = function() {
      if (!window.currentUser) return;
      if (window.unsubTransactions) { window.unsubTransactions(); window.unsubTransactions = null; }
      if (window.unsubSettings) { window.unsubSettings(); window.unsubSettings = null; }

      SomtumStore.setItem('somtumDataOwnerUid', window.currentUser.uid);
      const settingsRef = doc(db, "users", window.currentUser.uid, "meta", "settings");
      window.unsubSettings = onSnapshot(settingsRef, (docSnap) => {
        // Skip applying remote settings while local category/settings write is in flight
        // to prevent race condition that wipes newly added categories
        if (window._pendingSettingsSync) return;

        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.categories) window.appData.categories = data.categories;
          if (data.materials) window.appData.materials = data.materials;
          if (data.equipments) window.appData.equipments = data.equipments;
          if (data.customGoal !== undefined) window.appData.customGoal = data.customGoal;
          if (data.customGoalPercent !== undefined) window.appData.customGoalPercent = data.customGoalPercent;
          window.appData = window.sanitizeAppData(window.appData);
          window.saveLocalOnly();
          window.refreshDashboard();
        } else {
          const bootPayload = JSON.parse(JSON.stringify({
            categories: window.appData.categories,
            materials: window.appData.materials || [],
            equipments: window.appData.equipments || [],
            customGoal: (window.appData.customGoal && Number(window.appData.customGoal) > 0) ? Number(window.appData.customGoal) : null,
            customGoalPercent: (window.appData.customGoalPercent !== null && window.appData.customGoalPercent !== undefined && !isNaN(Number(window.appData.customGoalPercent))) ? Number(window.appData.customGoalPercent) : null,
            updatedAt: new Date().toISOString()
          }));
          setDoc(settingsRef, bootPayload);
        }
      });

      const txCollRef = collection(db, "users", window.currentUser.uid, "transactions");
      window.unsubTransactions = onSnapshot(txCollRef, async (querySnap) => {
        // Skip applying remote txs while a local write is in flight (race protection).
        // Mark deferred so UI can refresh from local/IDB after the write finishes.
        if (window._pendingTxSync && window._pendingTxSync > 0) {
          window._txSnapshotDeferred = true;
          console.info('[STone] skip tx snapshot while local write pending', window._pendingTxSync);
          return;
        }
        window._txSnapshotDeferred = false;

        const txs = [];
        querySnap.forEach((d) => { txs.push(d.data()); });
        const fromCache = !!(querySnap.metadata && querySnap.metadata.fromCache);
        const hasPending = !!(querySnap.metadata && querySnap.metadata.hasPendingWrites);

        // Safe apply: upsert cloud + prune local orphans, but KEEP dirty (unsynced) local txs.
        // Skip prune on incomplete/cached snapshots so local history is never wiped.
        try {
          if (SomtumStore.applyCloudTxSnapshot) {
            const stats = await SomtumStore.applyCloudTxSnapshot(txs, {
              skipPrune: fromCache || hasPending
            });
            if (stats && (stats.pruned || stats.keptLocalDirty || stats.skippedPrune)) {
              console.info('[STone] cloud snapshot applied', stats, { fromCache: fromCache, hasPending: hasPending });
            }
          } else if (SomtumStore.persistAppState) {
            const tmp = window.sanitizeAppData(Object.assign({}, window.appData, { transactions: txs }));
            await SomtumStore.persistAppState(tmp, { writeAllTx: true });
          }
        } catch (e) {
          console.error('[STone] applyCloudTxSnapshot failed', e);
        }

        // Union for UI: previous memory + cloud + dirty local (never cloud-only replace)
        const byId = new Map();
        ((window.appData && window.appData.transactions) || []).forEach(function(t) {
          if (t && t.id) byId.set(String(t.id), t);
        });
        txs.forEach(function(t) {
          if (t && t.id) byId.set(String(t.id), t);
        });
        try {
          const dirtyIds = SomtumStore.getDirtyIds ? await SomtumStore.getDirtyIds() : [];
          if (dirtyIds && dirtyIds.length) {
            for (let i = 0; i < dirtyIds.length; i++) {
              const id = String(dirtyIds[i]);
              if (byId.has(id)) continue;
              let localTx = SomtumStore.getTx ? await SomtumStore.getTx(id) : null;
              if (localTx) byId.set(id, localTx);
            }
          }
        } catch (mergeErr) {
          console.warn('[STone] dirty merge into snapshot failed', mergeErr);
        }

        const merged = Array.from(byId.values());
        window.appData = window.sanitizeAppData(Object.assign({}, window.appData, { transactions: merged }));
        // Soft reload: union with IDB range (ensureTransactionsLoaded no longer blind-replaces)
        if (typeof window.ensureTransactionsLoaded === 'function') {
          window.__txCacheLoaded = false;
          window.__preferMemoryTx = true;
          try {
            await window.ensureTransactionsLoaded(true);
          } catch (loadErr) {
            console.warn('[STone] post-snapshot ensureTransactionsLoaded', loadErr);
          }
        }
        window.saveLocalOnly();
        window.refreshDashboard();
        window.updateSyncUI(true);
      }, (error) => {
        console.error("Transactions snapshot error:", error);
        window.updateSyncUI(false);
      });
    };

    window.updateSyncUI = function(isSynced) {
      const statusElem = document.getElementById('userSyncText');
      const badge = document.getElementById('syncStatusBadge');
      const btnSync = document.getElementById('btnSyncNow');
      if (!window.currentUser) return;

      if (isSynced) {
        statusElem.innerText = 'ข้อมูลซิงค์ตรงกันแล้ว (Cloud Connected)';
        badge.className = 'absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-emerald-500 border-2 border-white dark:border-gray-800 rounded-full';
        btnSync.classList.add('hidden');
        btnSync.classList.remove('animate-pulse');
        SomtumStore.setItem('somtumHasUnsyncedData', 'false');
      } else {
        statusElem.innerText = 'มีข้อมูลรอซิงค์ขึ้น Cloud...';
        badge.className = 'absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-amber-500 border-2 border-white dark:border-gray-800 rounded-full';
        btnSync.classList.remove('hidden');
        btnSync.classList.add('animate-pulse');
        SomtumStore.setItem('somtumHasUnsyncedData', 'true');
      }
      if (typeof window.updatePendingSyncButton === 'function') window.updatePendingSyncButton();
    };

    window.updatePendingSyncButton = function() {
      const btnSync = document.getElementById('btnSyncNow');
      const banner = document.getElementById('unsyncedBanner');
      const hasUnsynced = SomtumStore.getItem('somtumHasUnsyncedData') === 'true' || !!window._pendingSettingsSync;
      if (btnSync) {
        if (window.currentUser && hasUnsynced) {
          btnSync.classList.remove('hidden');
          btnSync.classList.add('animate-pulse');
        } else if (!hasUnsynced) {
          btnSync.classList.add('hidden');
          btnSync.classList.remove('animate-pulse');
        }
      }
      if (banner) {
        if (window.currentUser && hasUnsynced) banner.classList.remove('hidden');
        else banner.classList.add('hidden');
      }
    };

    /**
     * Soft sync: อัปโหลด settings + รายการในเครื่อง (merge) โดยไม่ลบรายการบน Cloud
     * ใช้ตอนออนไลน์กลับมา / auto flush
     */
    window._doSoftSyncToCloud = async function() {
      if (!window.currentUser || !window.db) return;
      window.appData = window.sanitizeAppData(window.appData);

      // Settings only when meta dirty (or always once if API missing)
      const metaDirty = !SomtumStore.isMetaDirty || await SomtumStore.isMetaDirty();
      if (metaDirty) {
        const settingsRef = doc(db, "users", window.currentUser.uid, "meta", "settings");
        const payload = JSON.parse(JSON.stringify({
          categories: window.appData.categories,
          materials: window.appData.materials || [],
          equipments: window.appData.equipments || [],
          customGoal: (window.appData.customGoal && Number(window.appData.customGoal) > 0) ? Number(window.appData.customGoal) : null,
            customGoalPercent: (window.appData.customGoalPercent !== null && window.appData.customGoalPercent !== undefined && !isNaN(Number(window.appData.customGoalPercent))) ? Number(window.appData.customGoalPercent) : null,
          updatedAt: new Date().toISOString()
        }));
        await setDoc(settingsRef, payload, { merge: true });
        if (SomtumStore.clearMetaDirty) await SomtumStore.clearMetaDirty();
      }

      // Incremental: only dirty transactions (fallback: current memory range if no dirty API)
      let dirtyIds = SomtumStore.getDirtyIds ? await SomtumStore.getDirtyIds() : [];
      let deletedIds = SomtumStore.getDeletedIds ? await SomtumStore.getDeletedIds() : [];

      if ((!dirtyIds || !dirtyIds.length) && (!deletedIds || !deletedIds.length)) {
        // Nothing queued — still ok (settings may have been the only change)
        return;
      }

      const uploadedIds = [];
      const deletedOkIds = [];
      let batch = writeBatch(db);
      let count = 0;
      let pendingOps = [];

      const flushBatch = async () => {
        if (count === 0) return;
        await batch.commit();
        // Only after successful commit, record ids from this batch
        for (let i = 0; i < pendingOps.length; i++) {
          const op = pendingOps[i];
          if (op.kind === 'set') uploadedIds.push(op.id);
          else if (op.kind === 'del') deletedOkIds.push(op.id);
        }
        pendingOps = [];
        batch = writeBatch(db);
        count = 0;
      };

      for (const id of dirtyIds) {
        let tx = (window.appData.transactions || []).find(t => t && String(t.id) === String(id));
        if (!tx && SomtumStore.getTx) tx = await SomtumStore.getTx(id);
        if (!tx) {
          // Cannot upload — leave in dirty queue (do NOT clear)
          console.warn('[STone] soft sync skip missing dirty tx', id);
          continue;
        }
        // Must pass Firestore rules (amount > 0, type, id)
        const amount = Number(tx.amount);
        if (!tx.id || !tx.type || !tx.date || !(amount > 0) ||
            (tx.type !== 'income' && tx.type !== 'expense')) {
          console.warn('[STone] soft sync skip invalid tx for rules', id, tx);
          continue;
        }
        const clean = JSON.parse(JSON.stringify(tx));
        clean.id = String(clean.id);
        clean.amount = amount;
        const txRef = doc(db, "users", window.currentUser.uid, "transactions", String(id));
        batch.set(txRef, clean, { merge: true });
        pendingOps.push({ kind: 'set', id: String(id) });
        count++;
        if (count >= 400) await flushBatch();
      }
      for (const id of deletedIds) {
        const txRef = doc(db, "users", window.currentUser.uid, "transactions", String(id));
        batch.delete(txRef);
        pendingOps.push({ kind: 'del', id: String(id) });
        count++;
        if (count >= 400) await flushBatch();
      }
      await flushBatch();

      // Clear ONLY ids that were actually committed — never drop failed/missing
      if (uploadedIds.length && SomtumStore.clearDirty) await SomtumStore.clearDirty(uploadedIds);
      if (deletedOkIds.length && SomtumStore.clearDeleted) await SomtumStore.clearDeleted(deletedOkIds);
    };

    /**
     * Force sync: เครื่องนี้เป็นต้นทาง — อัปโหลดทั้งหมด แล้วลบรายการบน Cloud
     * ที่ไม่มีในเครื่อง (รายการที่ถูกลบไปแล้ว)
     */
    window._doForceSyncWithPrune = async function() {
      if (!window.currentUser || !window.db) return;
      window.showToast('กำลังซิงค์แบบเครื่องนี้เป็นต้นทาง...');
      try {
        // Full local set from IDB (not only in-memory range)
        let allTx = window.appData.transactions || [];
        if (SomtumStore.getAllTx) {
          allTx = await SomtumStore.getAllTx();
        }
        window.appData = window.sanitizeAppData(Object.assign({}, window.appData, { transactions: allTx }));

        const settingsRef = doc(db, "users", window.currentUser.uid, "meta", "settings");
        await setDoc(settingsRef, JSON.parse(JSON.stringify({
          categories: window.appData.categories,
          materials: window.appData.materials || [],
          equipments: window.appData.equipments || [],
          customGoal: (window.appData.customGoal && Number(window.appData.customGoal) > 0) ? Number(window.appData.customGoal) : null,
            customGoalPercent: (window.appData.customGoalPercent !== null && window.appData.customGoalPercent !== undefined && !isNaN(Number(window.appData.customGoalPercent))) ? Number(window.appData.customGoalPercent) : null,
          updatedAt: new Date().toISOString()
        })), { merge: true });

        let batch = writeBatch(db);
        let count = 0;
        const forceUploaded = [];
        for (const tx of allTx) {
          if (!tx || !tx.id) continue;
          const amount = Number(tx.amount);
          if (!(amount > 0) || (tx.type !== 'income' && tx.type !== 'expense') || !tx.date) {
            console.warn('[STone] force sync skip invalid tx', tx && tx.id);
            continue;
          }
          const clean = JSON.parse(JSON.stringify(tx));
          clean.id = String(clean.id);
          clean.amount = amount;
          const txRef = doc(db, "users", window.currentUser.uid, "transactions", clean.id);
          batch.set(txRef, clean, { merge: true });
          forceUploaded.push(clean.id);
          count++;
          if (count >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();

        const localIds = new Set(forceUploaded);
        const txCollRef = collection(db, "users", window.currentUser.uid, "transactions");
        const snap = await getDocs(txCollRef);
        batch = writeBatch(db);
        count = 0;
        let pruned = 0;
        for (const d of snap.docs) {
          if (!localIds.has(d.id)) {
            batch.delete(d.ref);
            count++;
            pruned++;
            if (count >= 400) {
              await batch.commit();
              batch = writeBatch(db);
              count = 0;
            }
          }
        }
        if (count > 0) await batch.commit();

        // Clear queues only after successful upload + prune
        if (SomtumStore.clearDirty) await SomtumStore.clearDirty([]);
        if (SomtumStore.clearDeleted) await SomtumStore.clearDeleted([]);
        if (SomtumStore.clearMetaDirty) await SomtumStore.clearMetaDirty();

        window.updateSyncUI(true);
        SomtumStore.removeItem('somtumHasUnsyncedData');
        if (typeof window.updatePendingSyncButton === 'function') window.updatePendingSyncButton();
        window.showToast(
          pruned > 0
            ? `ซิงค์สำเร็จ (ลบรายการบน Cloud ที่ไม่มีในเครื่อง ${pruned} รายการ)`
            : 'ซิงค์สำเร็จ (ข้อมูลตรงกับเครื่องนี้แล้ว)'
        );
      } catch (e) {
        console.error("Force sync error:", e);
        window.showToast('ซิงค์ล้มเหลว: ' + (e.message || 'unknown'), 'error');
      }
    };

    /**
     * @param {boolean} forcePrompt
     *  - true  = ปุ่ม "ซิงค์ตอนนี้" → ถามยืนยัน แล้ว force sync + prune
     *  - false = auto (เน็ตกลับมา) → soft merge ไม่ลบ Cloud
     */
    window.checkAndSyncCloudData = async function(forcePrompt = false) {
      if (!window.currentUser) {
        window.showToast('กรุณาล็อกอินด้วย Google ก่อนซิงค์', 'error');
        return;
      }
      if (!navigator.onLine) {
        window.showToast('ออฟไลน์อยู่ — ข้อมูลถูกเก็บในเครื่องแล้ว จะซิงค์เมื่อเน็ตกลับมา', 'error');
        return;
      }

      if (forcePrompt) {
        const localCount = (SomtumStore.countTx ? await SomtumStore.countTx() : (window.appData.transactions || []).length);
        window.showConfirmModal(
          'ซิงค์แบบเครื่องนี้เป็นต้นทาง',
          `ระบบจะอัปโหลดข้อมูลในเครื่องนี้ขึ้น Cloud ทั้งหมด (${localCount} รายการ) แล้วลบรายการบน Cloud ที่ไม่มีในเครื่องนี้\n\n⚠️ ถ้าใช้อีกเครื่องและยังไม่ได้ซิงค์มา ข้อมูลเครื่องอื่นอาจหาย\n\nต้องการดำเนินการต่อหรือไม่?`,
          () => { window._doForceSyncWithPrune(); }
        );
        return;
      }

      // Soft auto-sync
      window.showToast('กำลังซิงค์ข้อมูล...');
      try {
        await window._doSoftSyncToCloud();
        window.updateSyncUI(true);
        SomtumStore.removeItem('somtumHasUnsyncedData');
        if (typeof window.updatePendingSyncButton === 'function') window.updatePendingSyncButton();
        window.showToast('ซิงค์ข้อมูลสำเร็จ');
      } catch (e) {
        console.error("Soft sync error:", e);
        window.showToast('ซิงค์ข้อมูลล้มเหลว: ' + (e.message || 'unknown'), 'error');
      }
    };

    window.confirmSyncData = function(shouldSync) {
      document.getElementById('syncPromptModal').classList.add('hidden');
      if (shouldSync) {
        // จาก modal เตือนตอนเปิดแอป → ใช้ force sync + confirm ซ้ำอีกชั้นผ่าน checkAndSyncCloudData(true)
        window.checkAndSyncCloudData(true);
      }
    };

    let syncTimer = null;
    // Flag to prevent onSnapshot from overwriting local category/settings changes
    window._pendingSettingsSync = false;
    // Counter: >0 means local tx write in flight — skip applying remote tx snapshot
    window._pendingTxSync = 0;

    window.syncDataToCloud = function(immediate = false) {
      window.saveLocalOnly();
      if (!window.currentUser) {
        SomtumStore.setItem('somtumHasUnsyncedData', 'true');
        if (typeof window.updatePendingSyncButton === 'function') window.updatePendingSyncButton();
        return;
      }
      window.updateSyncUI(false);
      window._pendingSettingsSync = true;
      if (syncTimer) clearTimeout(syncTimer);

      const doSync = async () => {
        try {
          // Strip undefined (Firestore rejects undefined field values)
          window.appData = window.sanitizeAppData(window.appData);
          const payload = JSON.parse(JSON.stringify({
            categories: window.appData.categories,
            materials: window.appData.materials || [],
            equipments: window.appData.equipments || [],
            customGoal: (window.appData.customGoal && Number(window.appData.customGoal) > 0) ? Number(window.appData.customGoal) : null,
            customGoalPercent: (window.appData.customGoalPercent !== null && window.appData.customGoalPercent !== undefined && !isNaN(Number(window.appData.customGoalPercent))) ? Number(window.appData.customGoalPercent) : null,
            updatedAt: new Date().toISOString()
          }));
          const settingsRef = doc(db, "users", window.currentUser.uid, "meta", "settings");
          // Offline: Firestore persistentLocalCache queues this write automatically
          await setDoc(settingsRef, payload, { merge: true });
          if (SomtumStore.clearMetaDirty) {
            try { await SomtumStore.clearMetaDirty(); } catch (e) { /* */ }
          }
          // Also flush any pending dirty/deleted transactions (soft, no prune)
          try {
            await window._doSoftSyncToCloud();
          } catch (txSyncErr) {
            console.warn('[STone] settings sync ok but tx soft-sync failed', txSyncErr);
            SomtumStore.setItem('somtumHasUnsyncedData', 'true');
          }
          window._pendingSettingsSync = false;
          // Reflect remaining dirty state accurately
          let stillDirty = false;
          try {
            const d = SomtumStore.getDirtyIds ? await SomtumStore.getDirtyIds() : [];
            const del = SomtumStore.getDeletedIds ? await SomtumStore.getDeletedIds() : [];
            stillDirty = (d && d.length > 0) || (del && del.length > 0);
          } catch (e) { /* */ }
          if (stillDirty || !navigator.onLine) {
            SomtumStore.setItem('somtumHasUnsyncedData', 'true');
            window.updateSyncUI(false);
          } else if (navigator.onLine) {
            window.updateSyncUI(true);
          }
          if (typeof window.updatePendingSyncButton === 'function') window.updatePendingSyncButton();
        } catch (e) {
          console.error("Settings sync error:", e);
          window._pendingSettingsSync = false;
          SomtumStore.setItem('somtumHasUnsyncedData', 'true');
          window.updateSyncUI(false);
          if (typeof window.updatePendingSyncButton === 'function') window.updatePendingSyncButton();
          if (navigator.onLine) {
            window.showToast('ซิงค์หมวดหมู่/ตั้งค่าล้มเหลว: ' + (e.message || 'unknown'), 'error');
          }
        }
      };

      if (immediate) {
        doSync();
      } else {
        syncTimer = setTimeout(doSync, 500);
      }
    };

    window.saveTransactionToFirestore = async function(txObj) {
      if (!window.currentUser) {
        SomtumStore.setItem('somtumHasUnsyncedData', 'true');
        return;
      }
      window.updateSyncUI(false);
      if (!navigator.onLine) {
        SomtumStore.setItem('somtumHasUnsyncedData', 'true');
      }
      window._pendingTxSync = (window._pendingTxSync || 0) + 1;
      try {
        // With persistentLocalCache, setDoc queues while offline and syncs later
        const clean = JSON.parse(JSON.stringify(txObj));
        clean.id = String(clean.id);
        clean.amount = Number(clean.amount);
        const txRef = doc(db, "users", window.currentUser.uid, "transactions", clean.id);
        await setDoc(txRef, clean);
        // Do NOT clearDirty immediately — wait until a non-cache snapshot includes this id.
        // Clearing too early lets an incomplete snapshot prune sibling local txs.
        if (navigator.onLine) {
          window.updateSyncUI(true);
        } else {
          SomtumStore.setItem('somtumHasUnsyncedData', 'true');
          window.updateSyncUI(false);
        }
      } catch (e) {
        console.error("Save tx error:", e);
        SomtumStore.setItem('somtumHasUnsyncedData', 'true');
        window.updateSyncUI(false);
        throw e;
      } finally {
        window._pendingTxSync = Math.max(0, (window._pendingTxSync || 1) - 1);
        // Snapshot may have been skipped while pending — refresh UI from local/IDB now
        window._txSnapshotDeferred = false;
        try {
          if (txObj && txObj.id && window.appData && Array.isArray(window.appData.transactions)) {
            const id = String(txObj.id);
            const idx = window.appData.transactions.findIndex(function(t) { return t && String(t.id) === id; });
            if (idx > -1) window.appData.transactions[idx] = txObj;
            else window.appData.transactions.push(txObj);
          }
          // Prefer in-memory list for the next refresh (already has old + new)
          window.__preferMemoryTx = true;
          window.__txCacheLoaded = true;
          if (typeof window.refreshDashboard === 'function') {
            await window.refreshDashboard();
          }
        } catch (uiErr) {
          console.warn('[STone] post-save UI refresh', uiErr);
        }
      }
    };

    window.deleteTransactionFromFirestore = async function(txId) {
      if (!window.currentUser) {
        SomtumStore.setItem('somtumHasUnsyncedData', 'true');
        return;
      }
      window.updateSyncUI(false);
      if (!navigator.onLine) {
        SomtumStore.setItem('somtumHasUnsyncedData', 'true');
      }
      window._pendingTxSync = (window._pendingTxSync || 0) + 1;
      try {
        const id = String(txId);
        const txRef = doc(db, "users", window.currentUser.uid, "transactions", id);
        await deleteDoc(txRef);
        if (SomtumStore.clearDeleted) await SomtumStore.clearDeleted([id]);
        if (navigator.onLine) {
          window.updateSyncUI(true);
        } else {
          SomtumStore.setItem('somtumHasUnsyncedData', 'true');
          window.updateSyncUI(false);
        }
      } catch (e) {
        console.error("Delete tx error:", e);
        SomtumStore.setItem('somtumHasUnsyncedData', 'true');
        window.updateSyncUI(false);
        throw e;
      } finally {
        window._pendingTxSync = Math.max(0, (window._pendingTxSync || 1) - 1);
      }
    };

    // saveLocalOnly: meta + flags only (transactions already in IDB per-record)
    // Overrides the early stub in app.js once this module has loaded.
    window.saveLocalOnly = function() {
      try {
        if (window.SomtumStore && SomtumStore.persistAppState) {
          // fire-and-forget meta persist (tx written at call site)
          SomtumStore.persistAppState(window.appData, { writeAllTx: false }).catch(function(e) {
            console.error('persistAppState', e);
          });
        } else if (window.SomtumStore && SomtumStore.setItem) {
          // Fallback legacy path
          try {
            SomtumStore.setItem('somtumAppData', JSON.stringify(window.appData));
          } catch (e2) {
            console.error('legacy setItem appData failed', e2);
          }
        }
        if (!navigator.onLine && window.currentUser) {
          SomtumStore.setItem('somtumHasUnsyncedData', 'true');
          if (typeof window.updatePendingSyncButton === 'function') window.updatePendingSyncButton();
        }
        if (typeof window.performAutoBackup === 'function') {
          clearTimeout(window._autoBakT);
          window._autoBakT = setTimeout(function() { window.performAutoBackup(); }, 5000);
        }
      } catch (e) {
        console.error("saveLocalOnly failed:", e);
        // Do not throw — callers already handle local save failures at putTx level
      }
    };
