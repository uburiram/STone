/**
 * Viewport fit v3.1 — load CSS, hide leftover boot UI only
 */
(function () {
  'use strict';
  if (window.__stoneResponsiveFitV31) return;
  window.__stoneResponsiveFitV31 = true;

  var CSS_HREF = './css/stone-responsive.css?v=202609031920';

  function ensureViewport() {
    try {
      var meta = document.querySelector('meta[name="viewport"]');
      var content = 'width=device-width, initial-scale=1, viewport-fit=cover';
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        (document.head || document.documentElement).appendChild(meta);
      }
      meta.setAttribute('content', content);
    } catch (e) {}
  }

  function ensureCss() {
    try {
      var el = document.getElementById('stoneResponsiveCss');
      if (el) {
        el.setAttribute('href', CSS_HREF);
        return;
      }
      var link = document.createElement('link');
      link.id = 'stoneResponsiveCss';
      link.rel = 'stylesheet';
      link.href = CSS_HREF;
      (document.head || document.documentElement).appendChild(link);
    } catch (e) {}
  }

  function hideBootLeftover() {
    try {
      var boot = document.getElementById('bootBox');
      if (boot) boot.remove();
    } catch (e) {}
  }

  function run() {
    ensureViewport();
    ensureCss();
    hideBootLeftover();
  }

  run();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  }
  setTimeout(run, 200);
  setTimeout(run, 1000);
  window.addEventListener('orientationchange', function () {
    setTimeout(run, 200);
  });
})();
