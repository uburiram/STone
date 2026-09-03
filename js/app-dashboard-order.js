/**
 * Force dashboard order (no schema/data change):
 * insight → ratio/KPI/actions/calendar → phase2 (แนวโน้ม 14 วัน) → phase5 → rest
 * GitHub phase2 still anchors after insight; this re-places after each update.
 */
(function () {
  'use strict';
  if (window.__stoneDashOrderHooked) return;
  window.__stoneDashOrderHooked = true;

  function el(id) { return document.getElementById(id); }

  function calendarBlock() {
    var grid = el('fullCalendarGrid');
    if (!grid) return null;
    return grid.closest('.space-y-4') || grid.parentElement;
  }

  function actionRow() {
    var btn = document.querySelector('button.stone-action-income');
    return btn ? btn.closest('.grid') : null;
  }

  function kpiGrid() {
    var kpi = el('kpiTotalIncome');
    return kpi ? kpi.closest('.grid') : null;
  }

  function ratioCard() {
    var t = el('profitExpenseRatioText');
    return t ? t.closest('.stone-card') || t.closest('div.bg-white') : null;
  }

  function orderedDashboardNodes() {
    var nodes = [];
    var r = ratioCard();
    var k = kpiGrid();
    var a = actionRow();
    var c = calendarBlock();
    if (r) nodes.push(r);
    if (k) nodes.push(k);
    if (a) nodes.push(a);
    if (c) nodes.push(c);
    return nodes;
  }

  function placeAfter(ref, node) {
    if (!ref || !node || !ref.parentNode) return;
    if (ref.nextElementSibling === node) return;
    ref.parentNode.insertBefore(node, ref.nextSibling);
  }

  function applyOrder() {
    try {
      var insight = el('dashboardInsight');
      if (!insight || !insight.parentNode) return;

      var nodes = orderedDashboardNodes();
      var cursor = insight;
      for (var i = 0; i < nodes.length; i++) {
        placeAfter(cursor, nodes[i]);
        cursor = nodes[i];
      }

      var phase2 = el('phase2Insights');
      if (phase2) {
        placeAfter(cursor, phase2);
        cursor = phase2;
      }

      var phase5 = el('phase5MonthlySnapshot');
      if (phase5) {
        placeAfter(cursor, phase5);
      }
    } catch (e) {
      console.info('[dash-order]', e && e.message ? e.message : e);
    }
  }

  function hook() {
    applyOrder();
    var p2 = window.updatePhase2Insights;
    if (typeof p2 === 'function' && !p2.__dashOrderHooked) {
      var w2 = function () {
        var r = p2.apply(this, arguments);
        setTimeout(applyOrder, 0);
        setTimeout(applyOrder, 50);
        return r;
      };
      w2.__dashOrderHooked = true;
      window.updatePhase2Insights = w2;
    }
    var rd = window.refreshDashboard;
    if (typeof rd === 'function' && !rd.__dashOrderHooked) {
      var wr = async function () {
        var r = await rd.apply(this, arguments);
        setTimeout(applyOrder, 0);
        setTimeout(applyOrder, 80);
        return r;
      };
      wr.__dashOrderHooked = true;
      window.refreshDashboard = wr;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hook);
  } else {
    hook();
  }
  setTimeout(hook, 300);
  setTimeout(hook, 800);
  setTimeout(hook, 1600);
  setTimeout(hook, 3000);
  setTimeout(applyOrder, 4500);
})();
