/**
 * Firebase Auth + Firestore sync for ส้มตำนายหนึ่ง
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
      window.showConfirmModal("ยืนยันการออกจากระบบ", "ข้อมูลของบัญชีนี้จะถูกลบออกจากเครื่องเพื่อความปลอดภัย และระบบจะสลับเป็นโหมดใช้งานทั่วไป", async () => {
        try {
          if (window.unsubTransactions) { window.unsubTransactions(); window.unsubTransactions = null; }
          if (window.unsubSettings) { window.unsubSettings(); window.unsubSettings = null; }
          await signOut(auth);
          // Clear everything to prevent cross-user data leak
          SomtumStore.removeItem('somtumAppData');
          SomtumStore.removeItem('somtumLastSyncedTimestamp');
          SomtumStore.removeItem('somtumHasUnsyncedData');
          SomtumStore.removeItem('somtumDataOwnerUid');
          SomtumStore.removeItem('somtumAutoBackup');
          SomtumStore.removeItem('somtumAutoBackupTime');
          SomtumStore.removeItem('somtumAutoBackupUid');
          SomtumStore.removeItem('somtumLastGoalNotified');
          // Reset in-memory backup hash so next session starts clean
          if (typeof lastAutoBackupHash !== 'undefined') lastAutoBackupHash = '';
          window.appData = {
            transactions: [],
            categories: JSON.parse(JSON.stringify(window.DEFAULT_CATEGORIES)),
            materials: [...window.DEFAULT_MATERIALS],
            equipments: [...window.DEFAULT_EQUIPMENTS],
            customGoal: null
          };
          window.refreshDashboard();
          window.showToast('ออกจากระบบแล้ว');
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
        avatar.src = user.photoURL || 'https://raw.githubusercontent.com/uburiram/STone/37019fb50a43edddf1b2aaa534de2276b231e57e/icon_256x256.png';
        nameElem.innerText = user.displayName || user.email || 'ผู้ใช้ Google';
        if (statusElem) statusElem.innerText = 'เชื่อมต่อ Google แล้ว — พร้อมซิงค์ Cloud';
        if (badge) badge.className = 'absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-emerald-500 border-2 border-white dark:border-gray-800 rounded-full';
        btnLogin.classList.add('hidden');
        btnLogout.classList.remove('hidden');

        // Safety: classic script may not have finished early-load yet if module
        // ran first. Re-hydrate from localStorage before guest-merge decision.
        try {
          const raw = SomtumStore.getItem('somtumAppData');
          if (raw && typeof window.sanitizeAppData === 'function') {
            const parsed = window.sanitizeAppData(JSON.parse(raw));
            const memLen = (window.appData && window.appData.transactions) ? window.appData.transactions.length : 0;
            const diskLen = (parsed.transactions || []).length;
            // Prefer the larger / more complete dataset to avoid wiping local work
            if (diskLen > memLen) {
              window.appData = parsed;
            } else if (!window.appData || !Array.isArray(window.appData.transactions)) {
              window.appData = parsed;
            }
          }
        } catch (e) {
          console.warn('Auth hydrate from localStorage failed:', e);
        }

        const lastOwnerUid = SomtumStore.getItem('somtumDataOwnerUid');
        const localTransactions = (window.appData && window.appData.transactions) || [];

        if (lastOwnerUid === user.uid) {
          window.initFirestoreListeners();
        } else if (localTransactions.length > 0) {
          pendingGuestData = JSON.parse(JSON.stringify(window.appData));
          document.getElementById('guestMergeModal').classList.remove('hidden');
        } else {
          SomtumStore.setItem('somtumDataOwnerUid', user.uid);
          window.initFirestoreListeners();
        }
      } else {
        avatar.src = 'https://raw.githubusercontent.com/uburiram/STone/37019fb50a43edddf1b2aaa534de2276b231e57e/icon_256x256.png';
        nameElem.innerText = 'ผู้ใช้งานทั่วไป (ยังไม่ได้ล็อกอิน)';
        statusElem.innerText = 'บันทึกข้อมูลเฉพาะในเครื่องนี้';
        badge.className = 'absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-gray-400 border-2 border-white rounded-full';
        btnLogin.classList.remove('hidden');
        btnLogout.classList.add('hidden');
        document.getElementById('btnSyncNow').classList.add('hidden');
      }
    });

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
                  if (cloudCat.subs) localCat.subs = Array.from(new Set([...(localCat.subs || []), ...cloudCat.subs]));
                  if (cloudCat.flags) {
                    localCat.flags = localCat.flags || {};
                    if (cloudCat.flags.isMaterialCategory) localCat.flags.isMaterialCategory = true;
                    if (cloudCat.flags.isEquipmentCategory) localCat.flags.isEquipmentCategory = true;
                  }
                } else {
                  mergedCategories[type].push(cloudCat);
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

        const localTx = pendingGuestData.transactions || [];
        let batch = writeBatch(db);
        let count = 0;
        for (const tx of localTx) {
          const txRef = doc(db, "users", window.currentUser.uid, "transactions", tx.id);
          batch.set(txRef, tx, { merge: true });
          count++;
          if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }
        if (count > 0) await batch.commit();

        await setDoc(settingsRef, {
          categories: window.appData.categories,
          materials: window.appData.materials,
          equipments: window.appData.equipments,
          customGoal: window.appData.customGoal,
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
        for (const tx of (pendingGuestData.transactions || [])) {
          const txRef = doc(db, "users", window.currentUser.uid, "transactions", tx.id);
          batch.set(txRef, tx);
          count++;
          if (count >= 400) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }
        if (count > 0) await batch.commit();
        window.showToast('อัปโหลดข้อมูลเครื่องทับ Cloud เรียบร้อย');
      } else {
        SomtumStore.removeItem('somtumAppData');
        window.appData = {
          transactions: [],
          categories: JSON.parse(JSON.stringify(window.DEFAULT_CATEGORIES)),
          materials: [...window.DEFAULT_MATERIALS],
          equipments: [...window.DEFAULT_EQUIPMENTS],
          customGoal: null
        };
      }
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
          window.appData = window.sanitizeAppData(window.appData);
          window.saveLocalOnly();
          window.refreshDashboard();
        } else {
          const bootPayload = JSON.parse(JSON.stringify({
            categories: window.appData.categories,
            materials: window.appData.materials || [],
            equipments: window.appData.equipments || [],
            customGoal: (window.appData.customGoal && Number(window.appData.customGoal) > 0) ? Number(window.appData.customGoal) : null,
            updatedAt: new Date().toISOString()
          }));
          setDoc(settingsRef, bootPayload);
        }
      });

      const txCollRef = collection(db, "users", window.currentUser.uid, "transactions");
      window.unsubTransactions = onSnapshot(txCollRef, async (querySnap) => {
        const txs = [];
        querySnap.forEach((d) => { txs.push(d.data()); });
        // Persist cloud snapshot into structured IDB (per-tx), then load current filter range
        if (SomtumStore.persistAppState) {
          const tmp = window.sanitizeAppData(Object.assign({}, window.appData, { transactions: txs }));
          await SomtumStore.persistAppState(tmp, { writeAllTx: true });
        }
        window.appData = window.sanitizeAppData(Object.assign({}, window.appData, { transactions: txs }));
        if (typeof window.ensureTransactionsLoaded === 'function') {
          await window.ensureTransactionsLoaded(true);
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

      let batch = writeBatch(db);
      let count = 0;
      for (const id of dirtyIds) {
        let tx = (window.appData.transactions || []).find(t => t.id === id);
        if (!tx && SomtumStore.getTx) tx = await SomtumStore.getTx(id);
        if (!tx) continue;
        const txRef = doc(db, "users", window.currentUser.uid, "transactions", id);
        batch.set(txRef, JSON.parse(JSON.stringify(tx)), { merge: true });
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      for (const id of deletedIds) {
        const txRef = doc(db, "users", window.currentUser.uid, "transactions", id);
        batch.delete(txRef);
        count++;
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      if (count > 0) await batch.commit();

      if (SomtumStore.clearDirty) await SomtumStore.clearDirty(dirtyIds);
      if (SomtumStore.clearDeleted) await SomtumStore.clearDeleted(deletedIds);
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
          updatedAt: new Date().toISOString()
        })), { merge: true });

        let batch = writeBatch(db);
        let count = 0;
        for (const tx of allTx) {
          if (!tx || !tx.id) continue;
          const txRef = doc(db, "users", window.currentUser.uid, "transactions", tx.id);
          batch.set(txRef, JSON.parse(JSON.stringify(tx)), { merge: true });
          count++;
          if (count >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();

        const localIds = new Set(allTx.map(t => t.id));
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
            updatedAt: new Date().toISOString()
          }));
          const settingsRef = doc(db, "users", window.currentUser.uid, "meta", "settings");
          // Offline: Firestore persistentLocalCache queues this write automatically
          await setDoc(settingsRef, payload, { merge: true });
          window._pendingSettingsSync = false;
          if (navigator.onLine) {
            window.updateSyncUI(true);
          } else {
            SomtumStore.setItem('somtumHasUnsyncedData', 'true');
            window.updateSyncUI(false);
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
      try {
        // With persistentLocalCache, setDoc queues while offline and syncs later
        const txRef = doc(db, "users", window.currentUser.uid, "transactions", txObj.id);
        await setDoc(txRef, JSON.parse(JSON.stringify(txObj)));
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
        throw e; // let caller show error toast
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
      try {
        const txRef = doc(db, "users", window.currentUser.uid, "transactions", txId);
        await deleteDoc(txRef);
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
      }
    };

    // saveLocalOnly: meta + flags only (transactions already in IDB per-record)
    window.saveLocalOnly = function() {
      try {
        if (window.SomtumStore && SomtumStore.persistAppState) {
          // fire-and-forget meta persist (tx written at call site)
          SomtumStore.persistAppState(window.appData, { writeAllTx: false }).catch(function(e) {
            console.error('persistAppState', e);
          });
        } else {
          // Fallback legacy path
          SomtumStore.setItem('somtumAppData', JSON.stringify(window.appData));
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
        throw e;
      }
    };
