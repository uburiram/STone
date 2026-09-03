/**
 * Viewport fit v2 — load CSS, lock width, enable filter scroll
 * No schema/data change
 */
(function () {
  'use strict';
  if (window.__stoneResponsiveFitV2) return;
  window.__stoneResponsiveFitV2 = true;

  var CSS_HREF = './css/stone-responsive.css?v=202609031800';

  function ensureViewport() {
    try {
      var meta = document.querySelector('meta[name="viewport"]');
      var content = 'width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover';
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
      var existing = document.getElementById('stoneResponsiveCss');
      if (existing) {
        if (existing.getAttribute('href') !== CSS_HREF) existing.setAttribute('href', CSS_HREF);
        return;
      }
      var link = document.createElement('link');
      link.id = 'stoneResponsiveCss';
      link.rel = 'stylesheet';
      link.href = CSS_HREF;
      (document.head || document.documentElement).appendChild(link);
    } catch (e) { /* */ }
  }

  function lockWidth() {
    try {
      var html = document.documentElement;
      var body = document.body;
      if (!body) return;
      html.style.overflowX = 'hidden';
      html.style.maxWidth = '100%';
      html.style.width = '100%';
      body.style.overflowX = 'hidden';
      body.style.maxWidth = '100%';
      body.style.width = '100%';
      body.style.margin = '0';

      var main = document.querySelector('main');
      if (main) {
        main.style.maxWidth = 'min(56rem, 100%)';
        main.style.width = '100%';
        main.style.overflowX = 'hidden';
      }

      var strips = document.querySelectorAll('.overflow-x-auto, .hide-scrollbar');
      for (var i = 0; i < strips.length; i++) {
        var el = strips[i];
        el.style.maxWidth = '100%';
        el.style.overflowX = 'auto';
        el.style.webkitOverflowScrolling = 'touch';
      }
    } catch (e2) { /* */ }
  }

  function run() {
    ensureViewport();
    ensureCss();
    lockWidth();
  }

  run();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  }
  [100, 400, 1000, 2000].forEach(function (ms) { setTimeout(run, ms); });
  window.addEventListener('orientationchange', function () {
    setTimeout(run, 150);
    setTimeout(run, 500);
  });
  window.addEventListener('resize', function () {
    setTimeout(lockWidth, 50);
  });
})();
