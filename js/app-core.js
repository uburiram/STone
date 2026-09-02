/* Emergency SYNC loader for app-core.js (no eval — CSP safe) */
(function () {
  var url = 'https://cdn.jsdelivr.net/gh/uburiram/STone@ca0490e2cff6dcd2949876030e241fd4f3b836d6/js/app-core.js';
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
      var el = document.createElement('script');
      el.text = xhr.responseText;
      (document.head || document.documentElement).appendChild(el);
      console.info('[STone] emergency SYNC loaded', 'app-core.js', xhr.responseText.length);

      var prev = window.ensureTransactionsLoaded;
      if (typeof prev === 'function' && !prev.__rtUnion) {
        window.ensureTransactionsLoaded = async function (force) {
          if (window.__preferMemoryTx && window.__txCacheLoaded && !force) {
            window.__preferMemoryTx = false;
            return;
          }
          var before = (window.appData && window.appData.transactions) || [];
          await prev.apply(this, arguments);
          var after = (window.appData && window.appData.transactions) || [];
          if (before.length > after.length) {
            var byId = new Map();
            after.forEach(function (t) { if (t && t.id) byId.set(String(t.id), t); });
            before.forEach(function (t) {
              if (!t || !t.id) return;
              if (!byId.has(String(t.id))) byId.set(String(t.id), t);
            });
            window.appData.transactions = Array.from(byId.values());
          }
        };
        window.ensureTransactionsLoaded.__rtUnion = true;
      }

    } else {
      console.error('[STone] emergency HTTP', xhr.status, url);
    }
  } catch (e) {
    console.error('[STone] emergency SYNC fail', 'app-core.js', e);
  }
})();
