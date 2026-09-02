/* Emergency SYNC loader for firebase.js */
(function () {
  var url = 'https://cdn.jsdelivr.net/gh/uburiram/STone@ca0490e2cff6dcd2949876030e241fd4f3b836d6/js/firebase.js';
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
      (0, eval)(xhr.responseText);
      console.info('[STone] emergency SYNC loaded', 'firebase.js', xhr.responseText.length);
    } else {
      console.error('[STone] emergency HTTP', xhr.status, url);
    }
  } catch (e) {
    console.error('[STone] emergency SYNC fail', 'firebase.js', e);
  }
})();
