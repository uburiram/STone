/**
 * Override phase2 panel placement to end of dashboard (no schema change).
 * Runs after app-phase2.js; safe if phase2 missing.
 */
(function () {
  'use strict';
  if (window.__stonePhase2AnchorFix) return;
  window.__stonePhase2AnchorFix = true;

  function getEnd() {
    var m = document.getElementById('afterDashboardAnchor');
    if (m) return m;
    var g = document.getElementById('fullCalendarGrid');
    if (g) {
      var cal = g.closest('.space-y-4') || g.parentElement;
      if (cal) return cal;
    }
    var btn = document.querySelector('button.stone-action-income');
    if (btn) {
      var row = btn.closest('.grid');
      if (row) return row;
    }
    return document.getElementById('dashboardInsight');
  }

  function place() {
    try {
      var panel = document.getElementById('phase2Insights');
      if (!panel) return;
      var anchor = getEnd();
      if (!anchor || !anchor.parentNode) return;
      if (anchor.nextElementSibling === panel) return;
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    } catch (e) {
      console.info('[phase2-anchor]', e && e.message ? e.message : e);
    }
  }

  function hook() {
    place();
    var prev = window.updatePhase2Insights;
    if (typeof prev === 'function' && !prev.__anchorFixHooked) {
      var w = function () {
        var r = prev.apply(this, arguments);
        setTimeout(place, 0);
        setTimeout(place, 80);
        return r;
      };
      w.__anchorFixHooked = true;
      window.updatePhase2Insights = w;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hook);
  } else {
    hook();
  }
  [400, 1000, 2000, 4000].forEach(function (ms) { setTimeout(hook, ms); });
})();
