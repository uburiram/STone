/**
 * Layout: move full-month calendar up under dashboard action buttons
 * + place phase2 (แนวโน้ม 14 วัน) AFTER dashboard block
 * (right below insight / KPI area). No data/schema changes.
 */
(function () {
  function moveCalendarUp() {
    try {
      var grid = document.getElementById('fullCalendarGrid');
      if (!grid) return;
      var calCard = grid.closest('.space-y-4') || grid.closest('.bg-white') || grid.parentElement;
      if (!calCard) return;

      var incomeBtn =
        document.querySelector('button.stone-action-income') ||
        document.querySelector('button[onclick*="openTransactionModal"]');
      var actionsRow = incomeBtn ? incomeBtn.closest('.grid') : null;
      if (!actionsRow || !actionsRow.parentNode) {
        var insight = document.getElementById('dashboardInsight');
        if (!insight || !insight.parentNode) return;
        // Keep calendar in dashboard zone — after insight, before phase2
        if (insight.nextSibling !== calCard && (!insight.nextElementSibling || insight.nextElementSibling.id !== 'phase2Insights')) {
          var insertAt = insight.nextSibling;
          // skip phase panels if they ended up right after insight
          var n = insight.nextElementSibling;
          while (n && (n.id === 'phase2Insights' || n.id === 'phase5MonthlySnapshot')) {
            n = n.nextElementSibling;
          }
          insight.parentNode.insertBefore(calCard, n || null);
        }
        return;
      }

      if (actionsRow.nextElementSibling === calCard) return;
      actionsRow.parentNode.insertBefore(calCard, actionsRow.nextSibling);
    } catch (e) {
      console.info('[layout] calendar move skip:', e && e.message ? e.message : e);
    }
  }

  function placePhase2AfterDashboard() {
    try {
      var panel = document.getElementById('phase2Insights');
      if (!panel) return;
      var marker = document.getElementById('afterDashboardAnchor');
      var grid = document.getElementById('fullCalendarGrid');
      var cal = grid ? (grid.closest('.space-y-4') || grid.parentElement) : null;
      var anchor = marker || cal;
      if (!anchor || !anchor.parentNode) return;
      if (anchor.nextElementSibling === panel) return;
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    } catch (e) {
      console.info('[layout] phase2 place skip:', e && e.message ? e.message : e);
    }
  }

  function run() {
    moveCalendarUp();
    placePhase2AfterDashboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  setTimeout(run, 400);
  setTimeout(run, 1200);
  setTimeout(placePhase2AfterDashboard, 2000);
})();
