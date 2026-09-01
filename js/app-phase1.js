/* STone Phase-1 UI intelligence — additive, no data schema change
 * Load AFTER app-dashboard.js
 */
(function () {
  'use strict';

  window.updateDashboardInsight = function (kpiTx, totalIncome, totalExpense, netProfit) {
    const titleEl = document.getElementById('dashboardInsightTitle');
    const descEl = document.getElementById('dashboardInsightDesc');
    const iconEl = document.getElementById('dashboardInsightIcon');
    if (!titleEl || !descEl) return;

    const n = (kpiTx && kpiTx.length) || 0;
    const fmt = function (v) {
      return '฿' + Number(v || 0).toLocaleString('th-TH', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
    };
    const filterLabel = ({
      all: 'ทั้งหมด',
      daily: 'วันนี้',
      weekly: 'สัปดาห์นี้',
      monthly: 'เดือนนี้',
      yearly: 'ปีนี้',
      custom: 'วันที่เลือก',
      range: 'ช่วงวันที่เลือก'
    })[typeof currentFilter !== 'undefined' ? currentFilter : 'monthly'] || 'ช่วงนี้';

    let icon = 'fa-lightbulb';
    let title = '';
    let desc = '';

    if (n === 0) {
      icon = 'fa-clipboard-list';
      title = filterLabel + ' ยังไม่มีรายการ';
      desc = 'เริ่มบันทึกรายรับหรือรายจ่าย เพื่อดูสุขภาพร้านแบบสรุปอัตโนมัติ';
    } else if (totalExpense === 0 && totalIncome > 0) {
      icon = 'fa-coins';
      title = 'มีรายรับ ' + fmt(totalIncome) + ' · ยังไม่มีรายจ่าย';
      desc = 'บันทึกต้นทุนด้วย จะเห็นสัดส่วนกำไรต่อต้นทุนชัดขึ้น';
    } else if (totalIncome === 0 && totalExpense > 0) {
      icon = 'fa-receipt';
      title = 'มีรายจ่าย ' + fmt(totalExpense) + ' · ยังไม่มีรายรับ';
      desc = 'บันทึกรายรับในช่วงนี้ เพื่อดูกำไรสุทธิที่แท้จริง';
    } else if (netProfit > 0) {
      icon = 'fa-seedling';
      title = 'กำไรสุทธิ ' + fmt(netProfit) + ' (' + filterLabel + ')';
      const margin = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : '0';
      desc = n + ' รายการ · อัตรากำไรประมาณ ' + margin + '% ของรายรับ';
    } else if (netProfit < 0) {
      icon = 'fa-triangle-exclamation';
      title = 'ขาดทุน ' + fmt(Math.abs(netProfit)) + ' (' + filterLabel + ')';
      desc = 'รายจ่ายสูงกว่ารายรับ · ตรวจหมวดต้นทุนที่กินงบมาก';
    } else {
      icon = 'fa-equals';
      title = 'รายรับและรายจ่ายสมดุล (' + filterLabel + ')';
      desc = n + ' รายการ · กำไรสุทธิ 0';
    }

    titleEl.textContent = title;
    descEl.textContent = desc;
    if (iconEl) iconEl.innerHTML = '<i class="fa-solid ' + icon + ' text-sm"></i>';
  };

  const _setTimeFilter = window.setTimeFilter;
  if (typeof _setTimeFilter === 'function') {
    window.setTimeFilter = function (filter) {
      _setTimeFilter(filter);
      document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.classList.remove('filter-active');
      });
      const activeBtn = document.getElementById('filter-' + filter);
      if (activeBtn) activeBtn.classList.add('filter-active');
    };
  }

  const _refresh = window.refreshDashboard;
  if (typeof _refresh === 'function') {
    window.refreshDashboard = async function () {
      await _refresh.apply(this, arguments);
      try {
        const kpiTx = typeof window.getTimeFilteredTransactions === 'function'
          ? window.getTimeFilteredTransactions()
          : [];
        const sums = typeof window.sumIncomeExpense === 'function'
          ? window.sumIncomeExpense(kpiTx)
          : { income: 0, expense: 0, net: 0 };
        window.updateDashboardInsight(kpiTx, sums.income, sums.expense, sums.net);

        const ratioDesc = document.getElementById('profitExpenseRatioDesc');
        const ratioText = document.getElementById('profitExpenseRatioText');
        if (ratioDesc && sums.expense === 0) {
          if (ratioText) {
            ratioText.innerText = '—';
            ratioText.className = 'text-4xl font-extrabold text-gray-300 dark:text-gray-600 mb-1';
          }
          if (sums.income > 0) {
            ratioDesc.innerHTML =
              '<div class="stone-empty-hint"><span>มีรายรับแล้ว แต่ยังไม่มีรายจ่ายในช่วงนี้</span>' +
              '<div class="hint-actions"><button type="button" class="hint-chip expense" onclick="openTransactionModal(\'expense\')">+ บันทึกรายจ่าย</button></div></div>';
          } else {
            ratioDesc.innerHTML =
              '<div class="stone-empty-hint"><span>ยังไม่มีข้อมูลเพื่อคำนวณสัดส่วน</span>' +
              '<div class="hint-actions">' +
              '<button type="button" class="hint-chip" onclick="openTransactionModal(\'income\')">+ รายรับ</button>' +
              '<button type="button" class="hint-chip expense" onclick="openTransactionModal(\'expense\')">+ รายจ่าย</button>' +
              '</div></div>';
          }
        }
      } catch (e) {
        console.warn('phase1 insight', e);
      }
    };
  }
})();

/* Phase-2 loader (keeps index.html unchanged) */
(function loadPhase2() {
  if (window.__stonePhase2Loading) return;
  window.__stonePhase2Loading = true;
  var s = document.createElement('script');
  s.src = './js/app-phase2.js';
  s.async = false;
  s.onerror = function () { console.warn('[STone] app-phase2.js failed to load'); };
  (document.body || document.documentElement).appendChild(s);
})();
