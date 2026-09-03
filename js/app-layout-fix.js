/**
 * Layout: move full-month calendar up under dashboard action buttons
 * (right below insight / KPI area). No data/schema changes.
 */
(function () {
  function moveCalendarUp() {
    try {
      var grid = document.getElementById('fullCalendarGrid');
      if (!grid) return;
      var calCard = grid.closest('.space-y-4') || grid.closest('.bg-white') || grid.parentElement;
      if (!calCard) return;

      // Prefer anchor after action buttons
      var incomeBtn =
        document.querySelector('button.stone-action-income') ||
        document.querySelector('button[onclick*="openTransactionModal"]');
      var actionsRow = incomeBtn ? incomeBtn.closest('.grid') : null;
      if (!actionsRow || !actionsRow.parentNode) {
        // fallback: after KPI / insight
        var insight = document.getElementById('dashboardInsight');
        if (!insight || !insight.parentNode) return;
        var after =
          document.getElementById('phase5MonthlySnapshot') ||
          document.getElementById('phase2Insights') ||
          insight;
        if (after.nextSibling !== calCard) {
          after.parentNode.insertBefore(calCard, after.nextSibling);
        }
        return;
      }

      // Already in place?
      if (actionsRow.nextElementSibling === calCard) return;

      // Insert calendar right after action buttons row
      actionsRow.parentNode.insertBefore(calCard, actionsRow.nextSibling);
    } catch (e) {
      console.info('[layout] calendar move skip:', e && e.message ? e.message : e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', moveCalendarUp);
  } else {
    moveCalendarUp();
  }
  // phase panels inject async — re-run shortly
  setTimeout(moveCalendarUp, 400);
  setTimeout(moveCalendarUp, 1200);
})();
