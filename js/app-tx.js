/* Emergency SYNC loader for app-tx.js (no eval — CSP safe) */
(function () {
  var url = 'https://cdn.jsdelivr.net/gh/uburiram/STone@ca0490e2cff6dcd2949876030e241fd4f3b836d6/js/app-tx.js';
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
      var el = document.createElement('script');
      el.text = xhr.responseText;
      (document.head || document.documentElement).appendChild(el);
      console.info('[STone] emergency SYNC loaded', 'app-tx.js', xhr.responseText.length);

      var _hf = window.handleFormSubmit;
      if (typeof _hf === 'function' && !_hf.__rtPref) {
        window.handleFormSubmit = async function () {
          window.__preferMemoryTx = true;
          window.__txCacheLoaded = true;
          return _hf.apply(this, arguments);
        };
        window.handleFormSubmit.__rtPref = true;
      }

    } else {
      console.error('[STone] emergency HTTP', xhr.status, url);
    }
  } catch (e) {
    console.error('[STone] emergency SYNC fail', 'app-tx.js', e);
  }
})();
