/* STone Phase-5 — monthly snapshot + duplicate tx quick action (no schema change)
 * Load AFTER app-phase4.js
 */
(function () {
  'use strict';

  function pad2(n) { return String(n).padStart(2, '0'); }
  function ymd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fmtMoney(v) {
    var n = Number(v) || 0;
    return (n < 0 ? '-฿' : '฿') + Math.abs(n).toLocaleString('th-TH', { maximumFractionDigits: 0 });
  }
  function fmtPct(v) {
    if (v == null || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function escapeHtml(s) {
    if (typeof window.escapeHTML === 'function') return window.escapeHTML(String(s));
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function monthBounds(ref) {
    var y = ref.getFullYear(), m = ref.getMonth();
    return {
      start: new Date(y, m, 1, 0, 0, 0, 0),
      end: new Date(y, m + 1, 0, 23, 59, 59, 999),
      label: (m + 1) + '/' + y
    };
  }

  function inMonth(txDate, start, end) {
    if (!txDate || typeof txDate !== 'string') return false;
    var p = txDate.split('-');
    if (p.length < 3) return false;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0, 0);
    return d >= start && d <= end;
  }

  function sumTx(list) {
    if (typeof window.sumIncomeExpense === 'function') return window.sumIncomeExpense(list);
    var income = 0, expense = 0;
    (list || []).forEach(function (tx) {
      var a = Number(tx.amount) || 0;
      if (tx.type === 'income') income += a;
      else if (tx.type === 'expense') expense += a;
    });
    return { income: income, expense: expense, net: income - expense };
  }

  function topExpense(list, limit) {
    var map = {};
    (list || []).forEach(function (tx) {
      if (!tx || tx.type !== 'expense') return;
      var c = tx.category || 'ไม่ระบุ';
      map[c] = (map[c] || 0) + (Number(tx.amount) || 0);
    });
    return Object.keys(map).map(function (k) {
      return { name: k, total: map[k] };
    }).sort(function (a, b) { return b.total - a.total; }).slice(0, limit || 1);
  }

  function ensureSnapshot() {
    var existing = document.getElementById('phase5MonthlySnapshot');
    if (existing) return existing;
    var panel = document.createElement('div');
    panel.id = 'phase5MonthlySnapshot';
    panel.className = 'stone-month-snap stone-card bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-3.5';
    panel.innerHTML =
      '<div class="flex items-center justify-between gap-2 mb-2">' +
        '<h3 class="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">' +
          '<i class="fa-solid fa-calendar-check mr-1.5 text-brand-500"></i>สรุปเดือนนี้' +
        '</h3>' +
        '<button type="button" id="phase5OpenMonthly" class="text-[10px] font-semibold text-brand-600 dark:text-brand-400">' +
          'ดูเต็ม <i class="fa-solid fa-chevron-right text-[9px]"></i>' +
        '</button>' +
      '</div>' +
      '<div id="phase5SnapBody" class="space-y-2 text-xs"></div>';

    var anchor = document.getElementById('phase2Insights') || document.getElementById('dashboardInsight');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    } else {
      var main = document.querySelector('main');
      if (main) main.insertBefore(panel, main.firstChild);
    }

    var btn = document.getElementById('phase5OpenMonthly');
    if (btn) {
      btn.addEventListener('click', function () {
        if (typeof window.openMonthlyReportModal === 'function') {
          window.openMonthlyReportModal();
        } else {
          var m = document.getElementById('monthlyReportModal');
          if (m) m.classList.remove('hidden');
        }
      });
    }
    return panel;
  }

  window.updatePhase5Snapshot = function () {
    try {
      ensureSnapshot();
      var body = document.getElementById('phase5SnapBody');
      if (!body) return;

      var now = new Date();
      var curB = monthBounds(now);
      var prevRef = new Date(now.getFullYear(), now.getMonth() - 1, 15);
      var prevB = monthBounds(prevRef);

      var all = (window.appData && window.appData.transactions) || [];
      var curList = all.filter(function (tx) { return inMonth(tx.date, curB.start, curB.end); });
      var prevList = all.filter(function (tx) { return inMonth(tx.date, prevB.start, prevB.end); });
      var cur = sumTx(curList);
      var prev = sumTx(prevList);
      var top = topExpense(curList, 1);
      var netDelta = prev.net !== 0 ? ((cur.net - prev.net) / Math.abs(prev.net)) * 100 : (cur.net === 0 ? 0 : 100);
      var tip = '';
      if (curList.length === 0) {
        tip = 'ยังไม่มีรายการเดือนนี้ — เริ่มบันทึกวันนี้ เพื่อดูสรุปอัตโนมัติ';
      } else if (cur.expense > 0 && cur.income > 0) {
        var ratio = (cur.net / cur.income) * 100;
        if (ratio >= 30) tip = 'อัตรากำไรประมาณ ' + ratio.toFixed(0) + '% ของรายรับ — สุขภาพดี';
        else if (ratio >= 0) tip = 'กำไรยังบาง — ตรวจหมวดรายจ่ายที่กินงบ';
        else tip = 'เดือนนี้รายจ่ายสูงกว่ารายรับ — โฟกัสต้นทุนหลัก';
      } else if (cur.income === 0 && cur.expense > 0) {
        tip = 'มีแต่รายจ่าย — อย่าลืมบันทึกรายรับด้วย';
      } else {
        tip = 'มีรายรับแล้ว ลองบันทึกรายจ่ายเพื่อดูสัดส่วนกำไร';
      }

      var netCls = cur.net >= 0 ? 'text-emerald-600' : 'text-rose-600';
      var deltaCls = netDelta >= 0 ? 'text-emerald-600' : 'text-rose-600';
      body.innerHTML =
        '<div class="grid grid-cols-3 gap-2">' +
          '<div class="stone-snap-cell">' +
            '<div class="stone-snap-label">รายรับ</div>' +
            '<div class="stone-snap-val text-emerald-600">' + fmtMoney(cur.income) + '</div>' +
          '</div>' +
          '<div class="stone-snap-cell">' +
            '<div class="stone-snap-label">รายจ่าย</div>' +
            '<div class="stone-snap-val text-rose-600">' + fmtMoney(cur.expense) + '</div>' +
          '</div>' +
          '<div class="stone-snap-cell">' +
            '<div class="stone-snap-label">สุทธิ</div>' +
            '<div class="stone-snap-val ' + netCls + '">' + fmtMoney(cur.net) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-500 dark:text-gray-400">' +
          '<span>เทียบเดือนก่อน <span class="font-semibold ' + deltaCls + '">' + fmtPct(netDelta) + '</span></span>' +
          '<span>' + curList.length + ' รายการ</span>' +
        '</div>' +
        (top.length
          ? '<div class="text-[11px] text-gray-600 dark:text-gray-300">หมวดจ่ายสูงสุด: <b>' + escapeHtml(top[0].name) + '</b> ' + fmtMoney(top[0].total) + '</div>'
          : '') +
        '<p class="text-[10px] text-gray-400 leading-relaxed">' + escapeHtml(tip) + '</p>';
    } catch (e) {
      console.warn('phase5 snapshot', e);
    }
  };

  window.duplicateTransaction = async function (id) {
    try {
      var tx = ((window.appData && window.appData.transactions) || []).find(function (t) {
        return t && String(t.id) === String(id);
      });
      if (!tx && window.SomtumStore && SomtumStore.getTx) {
        try { tx = await SomtumStore.getTx(id); } catch (e) { /* ignore */ }
      }
      if (!tx) {
        if (typeof window.showToast === 'function') window.showToast('ไม่พบรายการ', 'error');
        return;
      }
      if (typeof window.openTransactionModal === 'function') {
        window.openTransactionModal(tx.type);
      }
      setTimeout(function () {
        try {
          var dateEl = document.getElementById('txDate');
          var timeEl = document.getElementById('txTime');
          var catEl = document.getElementById('txCategory');
          var amtEl = document.getElementById('txAmount');
          var noteEl = document.getElementById('txNote');
          if (dateEl) dateEl.value = ymd(new Date());
          if (timeEl) {
            var now = new Date();
            timeEl.value = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
          }
          if (catEl && tx.category) {
            catEl.value = tx.category;
            if (typeof window.onCategoryChange === 'function') {
              try { window.onCategoryChange(); } catch (e2) { /* ignore */ }
            }
          }
          if (amtEl) amtEl.value = Number(tx.amount) || '';
          if (noteEl) noteEl.value = tx.note || '';
          if (typeof window.showToast === 'function') {
            window.showToast('คัดลอกแล้ว — ตรวจก่อนบันทึก', 'success');
          }
        } catch (err) {
          console.warn('duplicate fill', err);
        }
      }, 80);
    } catch (e) {
      console.warn('duplicateTransaction', e);
    }
  };

  function enhanceDrillDownButtons() {
    document.querySelectorAll('button[onclick*="editTransaction("]').forEach(function (btn) {
      if (btn.dataset.phase5Dup) return;
      btn.dataset.phase5Dup = '1';
      var m = (btn.getAttribute('onclick') || '').match(/editTransaction\(['"]([^'"]+)['"]\)/);
      if (!m) return;
      var id = m[1];
      var dup = document.createElement('button');
      dup.type = 'button';
      dup.className = 'text-gray-400 hover:text-brand-600 text-[11px] p-0.5';
      dup.title = 'คัดลอกเป็นรายการใหม่';
      dup.innerHTML = '<i class="fa-solid fa-copy"></i>';
      dup.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        window.duplicateTransaction(id);
      });
      if (btn.parentNode) btn.parentNode.insertBefore(dup, btn);
    });
  }

  function installDrillDownHook() {
    var prev = window.renderDrillDownAccordion;
    if (typeof prev !== 'function' || prev.__phase5Hooked) return;
    var wrapped = function () {
      var ret = prev.apply(this, arguments);
      setTimeout(enhanceDrillDownButtons, 30);
      setTimeout(enhanceDrillDownButtons, 200);
      return ret;
    };
    wrapped.__phase5Hooked = true;
    window.renderDrillDownAccordion = wrapped;
  }

  function installRefreshHook() {
    var prev = window.refreshDashboard;
    if (typeof prev !== 'function' || prev.__phase5Hooked) return;
    var wrapped = async function () {
      var ret = await prev.apply(this, arguments);
      try {
        window.updatePhase5Snapshot();
        enhanceDrillDownButtons();
      } catch (e) { /* ignore */ }
      return ret;
    };
    wrapped.__phase5Hooked = true;
    window.refreshDashboard = wrapped;
  }

  function boot() {
    installDrillDownHook();
    installRefreshHook();
    ensureSnapshot();
    setTimeout(function () { window.updatePhase5Snapshot(); }, 80);
    setTimeout(enhanceDrillDownButtons, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  setTimeout(boot, 400);
  setTimeout(boot, 1500);
})();
