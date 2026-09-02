/* STone Phase-4 — skeleton list, offline clarity, pending sync count (no schema change)
 * Load AFTER app-phase3.js
 */
(function () {
  'use strict';

  var SKELETON_ROWS = 4;

  function skeletonHtml() {
    var rows = '';
    for (var i = 0; i < SKELETON_ROWS; i++) {
      rows +=
        '<div class="stone-skel-row" aria-hidden="true">' +
          '<div class="stone-skel-line stone-skel-w-40"></div>' +
          '<div class="stone-skel-line stone-skel-w-24"></div>' +
          '<div class="stone-skel-line stone-skel-w-16"></div>' +
        '</div>';
    }
    return (
      '<div id="phase4Skeleton" class="stone-skel space-y-2 py-1" role="status" aria-label="กำลังโหลดรายการ">' +
        rows +
      '</div>'
    );
  }

  function showListSkeleton() {
    var list = document.getElementById('transactionList');
    if (!list) return;
    if (list.querySelector('.stone-skel')) return;
    if (list.children.length > 0 && !list.querySelector('#phase4Skeleton')) {
      list.classList.add('stone-list-refreshing');
      return;
    }
    list.innerHTML = skeletonHtml();
  }

  function hideListSkeleton() {
    var list = document.getElementById('transactionList');
    if (!list) return;
    list.classList.remove('stone-list-refreshing');
    var sk = document.getElementById('phase4Skeleton');
    if (sk) sk.remove();
  }

  function staggerCards() {
    var list = document.getElementById('transactionList');
    if (!list) return;
    var cards = list.querySelectorAll(':scope > div');
    cards.forEach(function (el, i) {
      el.classList.add('stone-row-enter');
      el.style.animationDelay = Math.min(i * 40, 320) + 'ms';
    });
  }

  async function getPendingCount() {
    try {
      if (window.SomtumStore && typeof SomtumStore.getDirtyIds === 'function') {
        var ids = await SomtumStore.getDirtyIds();
        return (ids && ids.length) ? ids.length : 0;
      }
    } catch (e) { /* ignore */ }
    try {
      if (window.SomtumStore && typeof SomtumStore.getItem === 'function') {
        if (SomtumStore.getItem('somtumHasUnsyncedData') === 'true') return 1;
      }
    } catch (e2) { /* ignore */ }
    return 0;
  }

  function setBodyOnline(online) {
    document.body.classList.toggle('stone-offline', !online);
    document.body.classList.toggle('stone-online', !!online);
  }

  function enhanceNetworkBadge(online, pending) {
    var badge = document.getElementById('networkStatusBadge');
    var text = document.getElementById('networkStatusText');
    if (badge) {
      badge.classList.remove('stone-net-pulse');
      void badge.offsetWidth;
      badge.classList.add('stone-net-pulse');
      if (!online) {
        badge.className =
          'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700 stone-net-pulse';
        badge.innerHTML = '<i class="fa-solid fa-cloud-slash"></i> ออฟไลน์';
        badge.title = 'ไม่มีเน็ต — บันทึกในเครื่องได้ตามปกติ';
      } else if (pending > 0) {
        badge.className =
          'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700 stone-net-pulse';
        badge.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> รอซิงค์ ' + pending;
        badge.title = 'มีข้อมูล ' + pending + ' รายการรออัปขึ้นคลาวด์';
      } else {
        badge.className =
          'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700 stone-net-pulse';
        badge.innerHTML = '<i class="fa-solid fa-wifi"></i> ออนไลน์';
        badge.title = 'เชื่อมต่อแล้ว';
      }
    }
    if (text) {
      if (!online) {
        text.className = 'text-[10px] mt-0.5 font-medium text-rose-500';
        text.innerHTML = '<i class="fa-solid fa-cloud-slash mr-1"></i>ออฟไลน์ — บันทึกในเครื่องก่อน';
      } else if (pending > 0) {
        text.className = 'text-[10px] mt-0.5 font-medium text-amber-600';
        text.innerHTML = '<i class="fa-solid fa-cloud-arrow-up mr-1"></i>ออนไลน์ · รอซิงค์ ' + pending + ' รายการ';
      } else {
        text.className = 'text-[10px] mt-0.5 font-medium text-emerald-600';
        text.innerHTML = '<i class="fa-solid fa-wifi mr-1"></i>ออนไลน์';
      }
    }

    var soft = document.getElementById('phase4OfflineStrip');
    if (!online) {
      if (!soft) {
        soft = document.createElement('div');
        soft.id = 'phase4OfflineStrip';
        soft.className = 'stone-offline-strip';
        soft.innerHTML =
          '<i class="fa-solid fa-cloud-slash"></i> โหมดออฟไลน์ — รายการใหม่จะถูกเก็บในเครื่อง แล้วซิงค์เมื่อเน็ตกลับมา';
        var host = document.querySelector('main') || document.body;
        host.insertBefore(soft, host.firstChild);
      }
      soft.classList.remove('hidden');
    } else if (soft) {
      soft.classList.add('hidden');
    }
  }

  function installNetworkHook() {
    if (window.__phase4NetHooked) return;
    window.__phase4NetHooked = true;
    var prev = window.updateNetworkStatusUI;
    window.updateNetworkStatusUI = async function () {
      var online = navigator.onLine;
      setBodyOnline(online);
      if (typeof prev === 'function') {
        try { prev.apply(this, arguments); } catch (e) { /* ignore */ }
      }
      var pending = 0;
      try { pending = await getPendingCount(); } catch (e2) { pending = 0; }
      enhanceNetworkBadge(online, pending);
    };
    if (!window.__phase4NetInterval) {
      window.__phase4NetInterval = setInterval(function () {
        if (typeof window.updateNetworkStatusUI === 'function') {
          window.updateNetworkStatusUI();
        }
      }, 45000);
    }
  }

  function installRefreshHook() {
    var prev = window.refreshDashboard;
    if (typeof prev !== 'function' || prev.__phase4Hooked) return;
    var wrapped = async function () {
      try { showListSkeleton(); } catch (e) { /* ignore */ }
      var ret = await prev.apply(this, arguments);
      try {
        hideListSkeleton();
        staggerCards();
        if (typeof window.updateNetworkStatusUI === 'function') {
          window.updateNetworkStatusUI();
        }
      } catch (e2) { /* ignore */ }
      return ret;
    };
    wrapped.__phase4Hooked = true;
    window.refreshDashboard = wrapped;
  }

  function installOnlineToastUpgrade() {
    if (window.__phase4OnlineHooked) return;
    window.__phase4OnlineHooked = true;
    window.addEventListener('online', function () {
      setTimeout(async function () {
        var n = await getPendingCount();
        if (n > 0 && typeof window.showToast === 'function') {
          window.showToast('มี ' + n + ' รายการรอซิงค์ขึ้นคลาวด์', 'success');
        }
      }, 600);
    });
  }

  function boot() {
    installNetworkHook();
    installRefreshHook();
    installOnlineToastUpgrade();
    setBodyOnline(navigator.onLine);
    if (typeof window.updateNetworkStatusUI === 'function') {
      window.updateNetworkStatusUI();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  setTimeout(boot, 300);
  setTimeout(boot, 1200);
})();
