/**
 * STone auto real-time / reconnect sync (no schema change)
 * - After save while online: existing saveTransactionToFirestore already setDoc
 * - Offline: dirty queue + setDoc persistent cache
 * - On browser online / tab visible: soft-flush dirty automatically
 */
(function () {
  'use strict';

  if (window.__stoneAutoSyncHooked) return;
  window.__stoneAutoSyncHooked = true;

  window._autoSyncInFlight = false;
  window._autoSyncLastAt = 0;

  async function hasPending() {
    try {
      if (window.SomtumStore && SomtumStore.getDirtyIds) {
        var d = await SomtumStore.getDirtyIds();
        if (d && d.length) return true;
      }
      if (window.SomtumStore && SomtumStore.getDeletedIds) {
        var del = await SomtumStore.getDeletedIds();
        if (del && del.length) return true;
      }
      if (window.SomtumStore && SomtumStore.isMetaDirty) {
        if (await SomtumStore.isMetaDirty()) return true;
      }
      if (window.SomtumStore && SomtumStore.getItem) {
        if (SomtumStore.getItem('somtumHasUnsyncedData') === 'true') return true;
      }
      if (window._pendingSettingsSync) return true;
    } catch (e) { /* */ }
    return false;
  }

  window.runAutoCloudSync = async function (reason) {
    try {
      if (!navigator.onLine) return;
      if (!window.currentUser || !window.db) return;
      if (window._autoSyncInFlight) return;
      var now = Date.now();
      if (now - (window._autoSyncLastAt || 0) < 1200) return;
      window._autoSyncLastAt = now;

      if (!(await hasPending())) {
        if (typeof window.updateSyncUI === 'function') window.updateSyncUI(true);
        return;
      }

      window._autoSyncInFlight = true;
      if (typeof window._doSoftSyncToCloud === 'function') {
        await window._doSoftSyncToCloud();
      } else if (typeof window.checkAndSyncCloudData === 'function') {
        try { await window._doSoftSyncToCloud(); } catch (e) { /* */ }
      }

      var still = await hasPending();
      if (!still) {
        try {
          if (window.SomtumStore && SomtumStore.removeItem) {
            SomtumStore.removeItem('somtumHasUnsyncedData');
          }
        } catch (e2) { /* */ }
        if (typeof window.updateSyncUI === 'function') window.updateSyncUI(true);
        if (typeof window.updatePendingSyncButton === 'function') window.updatePendingSyncButton();
        if (reason === 'online' || reason === 'visibility') {
          if (typeof window.showToast === 'function') {
            window.showToast('ซิงค์ข้อมูลขึ้นคลาวด์อัตโนมัติแล้ว', 'success');
          }
        }
      } else {
        try {
          if (window.SomtumStore && SomtumStore.setItem) {
            SomtumStore.setItem('somtumHasUnsyncedData', 'true');
          }
        } catch (e3) { /* */ }
        if (typeof window.updateSyncUI === 'function') window.updateSyncUI(false);
        if (typeof window.updatePendingSyncButton === 'function') window.updatePendingSyncButton();
      }
    } catch (err) {
      console.warn('[STone] runAutoCloudSync', reason, err);
    } finally {
      window._autoSyncInFlight = false;
    }
  };

  function hookSave() {
    var prev = window.saveTransactionToFirestore;
    if (typeof prev !== 'function' || prev.__autoSyncHooked) return;
    var wrapped = async function (txObj) {
      var result = await prev.apply(this, arguments);
      try {
        if (navigator.onLine && window.currentUser) {
          if (txObj && txObj.id && window.SomtumStore && SomtumStore.clearDirty) {
            try { await SomtumStore.clearDirty([String(txObj.id)]); } catch (e) { /* */ }
          }
          setTimeout(function () { window.runAutoCloudSync('after-save'); }, 400);
        }
      } catch (e) { /* */ }
      return result;
    };
    wrapped.__autoSyncHooked = true;
    window.saveTransactionToFirestore = wrapped;
  }

  function hookDelete() {
    var prev = window.deleteTransactionFromFirestore;
    if (typeof prev !== 'function' || prev.__autoSyncHooked) return;
    var wrapped = async function () {
      var result = await prev.apply(this, arguments);
      try {
        if (navigator.onLine) {
          setTimeout(function () { window.runAutoCloudSync('after-delete'); }, 400);
        }
      } catch (e) { /* */ }
      return result;
    };
    wrapped.__autoSyncHooked = true;
    window.deleteTransactionFromFirestore = wrapped;
  }

  window.addEventListener('online', function () {
    setTimeout(function () { window.runAutoCloudSync('online'); }, 500);
    setTimeout(function () { window.runAutoCloudSync('online-retry'); }, 2500);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      setTimeout(function () { window.runAutoCloudSync('visibility'); }, 400);
    }
  });

  setTimeout(hookSave, 800);
  setTimeout(hookSave, 2500);
  setTimeout(hookDelete, 800);
  setTimeout(hookDelete, 2500);
  setTimeout(function () { window.runAutoCloudSync('boot'); }, 4000);
})();
