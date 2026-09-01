/* STone Phase-3 — micro-interactions + smart form suggest (no schema change)
 * Load AFTER app-phase2.js (or app-phase1 if phase2 absent)
 */
(function () {
  'use strict';

  function txList() {
    return (window.appData && Array.isArray(window.appData.transactions))
      ? window.appData.transactions
      : [];
  }

  function suggestCategory(type) {
    var counts = {};
    var lastSeen = {};
    txList().forEach(function (tx, i) {
      if (!tx || tx.type !== type || !tx.category) return;
      counts[tx.category] = (counts[tx.category] || 0) + 1;
      lastSeen[tx.category] = i;
    });
    var keys = Object.keys(counts);
    if (!keys.length) return null;
    keys.sort(function (a, b) {
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      return (lastSeen[b] || 0) - (lastSeen[a] || 0);
    });
    return keys[0];
  }

  function suggestAmounts(type, category, limit) {
    limit = limit || 3;
    var seen = {};
    var out = [];
    var list = txList().slice().reverse();
    for (var i = 0; i < list.length && out.length < limit; i++) {
      var tx = list[i];
      if (!tx || tx.type !== type) continue;
      if (category && tx.category !== category) continue;
      var a = Number(tx.amount);
      if (!a || a <= 0) continue;
      var key = a.toFixed(2);
      if (seen[key]) continue;
      seen[key] = true;
      out.push(a);
    }
    return out;
  }

  function avgAmount(type, category) {
    var sum = 0, n = 0;
    txList().forEach(function (tx) {
      if (!tx || tx.type !== type) return;
      if (category && tx.category !== category) return;
      var a = Number(tx.amount);
      if (a > 0) { sum += a; n++; }
    });
    if (!n) return null;
    return Math.round((sum / n) * 100) / 100;
  }

  function ensureSuggestBar() {
    var form = document.getElementById('transactionForm');
    if (!form) return null;
    var existing = document.getElementById('phase3SuggestBar');
    if (existing) return existing;
    var bar = document.createElement('div');
    bar.id = 'phase3SuggestBar';
    bar.className = 'stone-suggest hidden';
    bar.innerHTML =
      '<div class="stone-suggest-label"><i class="fa-solid fa-wand-magic-sparkles"></i> แนะนำจากรายการก่อนหน้า</div>' +
      '<div id="phase3SuggestChips" class="stone-suggest-chips"></div>';
    var amountInput = document.getElementById('txAmount');
    if (amountInput && amountInput.parentNode) {
      amountInput.parentNode.insertBefore(bar, amountInput);
    } else {
      form.insertBefore(bar, form.firstChild);
    }
    return bar;
  }

  function renderSuggestChips(type, category) {
    var bar = ensureSuggestBar();
    var chips = document.getElementById('phase3SuggestChips');
    if (!bar || !chips) return;

    var amounts = suggestAmounts(type, category, 3);
    var avg = avgAmount(type, category);
    var html = '';

    if (avg && amounts.indexOf(avg) === -1) {
      html += '<button type="button" class="stone-suggest-chip" data-amount="' + avg + '">' +
        'เฉลี่ย ฿' + Number(avg).toLocaleString('th-TH', { maximumFractionDigits: 0 }) +
        '</button>';
    }
    amounts.forEach(function (a) {
      html += '<button type="button" class="stone-suggest-chip" data-amount="' + a + '">' +
        '฿' + Number(a).toLocaleString('th-TH', { maximumFractionDigits: 2 }) +
        '</button>';
    });

    if (!html) {
      bar.classList.add('hidden');
      chips.innerHTML = '';
      return;
    }
    chips.innerHTML = html;
    bar.classList.remove('hidden');
    chips.querySelectorAll('.stone-suggest-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var input = document.getElementById('txAmount');
        if (!input) return;
        var v = Number(btn.getAttribute('data-amount'));
        input.value = (Math.round(v * 100) / 100).toFixed(2);
        input.classList.add('stone-pulse-once');
        setTimeout(function () { input.classList.remove('stone-pulse-once'); }, 400);
        tryHaptic(8);
      });
    });
  }

  function tryHaptic(ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms || 10);
    } catch (e) { /* ignore */ }
  }

  function pulseEl(el) {
    if (!el) return;
    el.classList.remove('stone-kpi-flash');
    void el.offsetWidth;
    el.classList.add('stone-kpi-flash');
    setTimeout(function () { el.classList.remove('stone-kpi-flash'); }, 600);
  }

  function flashKpis() {
    ['kpiTotalIncome', 'kpiTotalExpense', 'kpiNetProfit', 'kpiTargetAmount'].forEach(function (id) {
      pulseEl(document.getElementById(id));
    });
  }

  function installModalHook() {
    var prev = window.openTransactionModal;
    if (typeof prev !== 'function' || prev.__phase3Hooked) return;
    var wrapped = function (type, editId) {
      var ret = prev.apply(this, arguments);
      try {
        if (editId) {
          var bar = document.getElementById('phase3SuggestBar');
          if (bar) bar.classList.add('hidden');
          return ret;
        }
        var catSelect = document.getElementById('txCategory');
        if (catSelect && catSelect.options.length) {
          var suggested = suggestCategory(type);
          if (suggested) {
            for (var i = 0; i < catSelect.options.length; i++) {
              if (catSelect.options[i].value === suggested) {
                catSelect.value = suggested;
                break;
              }
            }
          }
          if (typeof window.onCategoryChange === 'function') {
            try { window.onCategoryChange(); } catch (e) { /* ignore */ }
          }
          renderSuggestChips(type, catSelect.value);
          if (!catSelect.dataset.phase3Suggest) {
            catSelect.dataset.phase3Suggest = '1';
            catSelect.addEventListener('change', function () {
              var t = document.getElementById('txType');
              var typeNow = t ? t.value : type;
              renderSuggestChips(typeNow, catSelect.value);
            });
          }
        }
        var modal = document.getElementById('transactionModal');
        if (modal) {
          modal.classList.add('stone-modal-enter');
          setTimeout(function () { modal.classList.remove('stone-modal-enter'); }, 350);
        }
      } catch (e) {
        console.warn('phase3 suggest', e);
      }
      return ret;
    };
    wrapped.__phase3Hooked = true;
    window.openTransactionModal = wrapped;
  }

  function installSubmitHook() {
    var prev = window.handleFormSubmit;
    if (typeof prev !== 'function' || prev.__phase3Hooked) return;
    var wrapped = async function (e) {
      var before = txList().length;
      var result = await prev.apply(this, arguments);
      try {
        var after = txList().length;
        setTimeout(flashKpis, 80);
        if (after >= before) tryHaptic(12);
      } catch (err) { /* ignore */ }
      return result;
    };
    wrapped.__phase3Hooked = true;
    window.handleFormSubmit = wrapped;
  }

  function installRefreshHook() {
    var prev = window.refreshDashboard;
    if (typeof prev !== 'function' || prev.__phase3RefreshHooked) return;
    var wrapped = async function () {
      var ret = await prev.apply(this, arguments);
      try {
        var overlay = document.getElementById('loadingOverlay');
        if (!overlay || overlay.classList.contains('hidden') || overlay.style.opacity === '0') {
          setTimeout(flashKpis, 30);
        }
      } catch (e) { /* ignore */ }
      return ret;
    };
    wrapped.__phase3RefreshHooked = true;
    window.refreshDashboard = wrapped;
  }

  function enhanceLoading() {
    var overlay = document.getElementById('loadingOverlay');
    if (!overlay || overlay.dataset.phase3) return;
    overlay.dataset.phase3 = '1';
    if (!document.getElementById('phase3LoadHint')) {
      var hint = document.createElement('p');
      hint.id = 'phase3LoadHint';
      hint.className = 'text-[10px] text-gray-400 mt-1';
      hint.textContent = 'เตรียมแดชบอร์ด…';
      overlay.appendChild(hint);
    }
  }

  function boot() {
    enhanceLoading();
    installModalHook();
    installSubmitHook();
    installRefreshHook();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  setTimeout(boot, 200);
  setTimeout(boot, 1000);
})();
