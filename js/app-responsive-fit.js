/**
 * Ensure viewport fits device; load responsive CSS if missing.
 * No schema/data change.
 */
(function () {
  'use strict';
  if (window.__stoneResponsiveFit) return;
  window.__stoneResponsiveFit = true;

  function ensureViewport() {
    try {
      var meta = document.querySelector('meta[name="viewport"]');
      var content =
        'width=device-width, initial-scale=1, viewport-fit=cover';
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        (document.head || document.documentElement).appendChild(meta);
      }
      meta.setAttribute('content', content);
    } catch (e) { /* */ }
  }

  function ensureCss() {
    try {
      if (document.getElementById('stoneResponsiveCss')) return;
      var link = document.createElement('link');
      link.id = 'stoneResponsiveCss';
      link.rel = 'stylesheet';
      link.href = './css/stone-responsive.css?v=202609031640';
      (document.head || document.documentElement).appendChild(link);
    } catch (e) { /* */ }
  }

  function lockHorizontal() {
    try {
      document.documentElement.style.overflowX = 'hidden';
      document.body && (document.body.style.overflowX = 'hidden');
      document.body && (document.body.style.maxWidth = '100vw');
    } catch (e2) { /* */ }
  }

  function run() {
    ensureViewport();
    ensureCss();
    lockHorizontal();
  }

  run();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  }
  setTimeout(run, 200);
  setTimeout(run, 800);
  window.addEventListener('orientationchange', function () {
    setTimeout(run, 100);
    setTimeout(run, 400);
  });
  window.addEventListener('resize', function () {
    setTimeout(lockHorizontal, 50);
  });
})();
