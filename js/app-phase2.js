/* STone Phase-2 — insights from existing transactions only (no schema change)
 * Load AFTER app-phase1.js / app-dashboard.js
 */
(function () {
  'use strict';

  function pad2(n) { return String(n).padStart(2, '0'); }

  function ymd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseYmd(s) {
    if (!s || typeof s !== 'string') return null;
    var p = s.split('-');
    if (p.length !== 3) return null;
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function fmtMoney(v) {
    var n = Number(v) || 0;
    var abs = Math.abs(n);
    var s = abs.toLocaleString('th-TH', { maximumFractionDigits: 0 });
    return (n < 0 ? '-฿' : '฿') + s;
  }

  function fmtPct(v) {
    if (v == null || !isFinite(v)) return '—';
    var sign = v > 0 ? '+' : '';
    return sign + v.toFixed(1) + '%';
  }

  function getPeriodBounds() {
    var filter = (typeof currentFilter !== 'undefined') ? currentFilter : 'monthly';
    var now = new Date();
    now.setHours(12, 0, 0, 0);
    var start, end, prevStart, prevEnd, label, prevLabel;

    function endOfDay(d) {
      var x = new Date(d);
      x.setHours(23, 59, 59, 999);
      return x;
    }
    function startOfDay(d) {
      var x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    }

    if (filter === 'daily') {
      start = startOfDay(now);
      end = endOfDay(now);
      prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 1);
      prevEnd = endOfDay(prevStart);
      label = 'วันนี้';
      prevLabel = 'เมื่อวาน';
    } else if (filter === 'weekly') {
      var day = now.getDay();
      var diff = day === 0 ? -6 : 1 - day;
      start = startOfDay(now);
      start.setDate(now.getDate() + diff);
      end = endOfDay(start);
      end.setDate(start.getDate() + 6);
      prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 7);
      prevEnd = endOfDay(prevStart); prevEnd.setDate(prevStart.getDate() + 6);
      label = 'สัปดาห์นี้';
      prevLabel = 'สัปดาห์ก่อน';
    } else if (filter === 'monthly') {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      prevEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      label = 'เดือนนี้';
      prevLabel = 'เดือนก่อน';
    } else if (filter === 'yearly') {
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      prevStart = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0);
      prevEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      label = 'ปีนี้';
      prevLabel = 'ปีก่อน';
    } else if (filter === 'custom') {
      var d = parseYmd(typeof selectedCustomDate !== 'undefined' ? selectedCustomDate : ymd(now)) || now;
      start = startOfDay(d);
      end = endOfDay(d);
      prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 1);
      prevEnd = endOfDay(prevStart);
      label = 'วันที่เลือก';
      prevLabel = 'วันก่อนหน้า';
    } else if (filter === 'range') {
      var rs = parseYmd(typeof selectedStartDate !== 'undefined' ? selectedStartDate : null);
      var re = parseYmd(typeof selectedEndDate !== 'undefined' ? selectedEndDate : null);
      if (!rs || !re) {
        start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
        prevEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        label = 'เดือนนี้'; prevLabel = 'เดือนก่อน';
      } else {
        if (rs > re) { var t = rs; rs = re; re = t; }
        start = startOfDay(rs);
        end = endOfDay(re);
        var days = Math.round((end - start) / 86400000) + 1;
        prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1); prevEnd = endOfDay(prevEnd);
        prevStart = startOfDay(prevEnd); prevStart.setDate(prevStart.getDate() - (days - 1));
        label = 'ช่วงที่เลือก';
        prevLabel = 'ช่วงก่อนหน้า';
      }
    } else {
      end = endOfDay(now);
      start = startOfDay(now); start.setDate(start.getDate() - 29);
      prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1); prevEnd = endOfDay(prevEnd);
      prevStart = startOfDay(prevEnd); prevStart.setDate(prevStart.getDate() - 29);
      label = '30 วันล่าสุด';
      prevLabel = '30 วันก่อนหน้า';
    }

    return { start: start, end: end, prevStart: prevStart, prevEnd: prevEnd, label: label, prevLabel: prevLabel, filter: filter };
  }

  function inRange(txDateStr, start, end) {
    var d = parseYmd(txDateStr);
    if (!d) return false;
    d.setHours(12, 0, 0, 0);
    return d >= start && d <= end;
  }

  function sumList(list) {
    if (typeof window.sumIncomeExpense === 'function') {
      return window.sumIncomeExpense(list);
    }
    var income = 0, expense = 0;
    (list || []).forEach(function (tx) {
      var a = Number(tx.amount) || 0;
      if (tx.type === 'income') income += a;
      else if (tx.type === 'expense') expense += a;
    });
    return { income: income, expense: expense, net: income - expense };
  }

  function filterTx(start, end) {
    var list = (window.appData && window.appData.transactions) || [];
    return list.filter(function (tx) {
      return tx && inRange(tx.date, start, end);
    });
  }

  function topCategories(list, type, limit) {
    var map = {};
    (list || []).forEach(function (tx) {
      if (!tx || tx.type !== type) return;
      var cat = tx.category || 'ไม่ระบุ';
      map[cat] = (map[cat] || 0) + (Number(tx.amount) || 0);
    });
    return Object.keys(map).map(function (k) {
      return { name: k, total: map[k] };
    }).sort(function (a, b) {
      return b.total - a.total;
    }).slice(0, limit || 3);
  }

  function dailySeries(days) {
    var list = (window.appData && window.appData.transactions) || [];
    var now = new Date();
    now.setHours(12, 0, 0, 0);
    var series = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(now.getDate() - i);
      var key = ymd(d);
      series.push({ date: key, income: 0, expense: 0, net: 0 });
    }
    var idx = {};
    series.forEach(function (s, i) { idx[s.date] = i; });
    list.forEach(function (tx) {
      if (!tx || !tx.date || idx[tx.date] === undefined) return;
      var a = Number(tx.amount) || 0;
      var s = series[idx[tx.date]];
      if (tx.type === 'income') s.income += a;
      else if (tx.type === 'expense') s.expense += a;
      s.net = s.income - s.expense;
    });
    return series;
  }

  function buildSparklineSvg(series, w, h) {
    w = w || 280;
    h = h || 48;
    if (!series || !series.length) {
      return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="stone-spark" aria-hidden="true"></svg>';
    }
    var nets = series.map(function (s) { return s.net; });
    var max = Math.max.apply(null, nets.concat([0]));
    var min = Math.min.apply(null, nets.concat([0]));
    var span = max - min || 1;
    var pad = 4;
    var points = series.map(function (s, i) {
      var x = pad + (i / Math.max(series.length - 1, 1)) * (w - pad * 2);
      var y = pad + (1 - (s.net - min) / span) * (h - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var zeroY = pad + (1 - (0 - min) / span) * (h - pad * 2);
    var last = series[series.length - 1];
    var stroke = (last && last.net >= 0) ? '#10b981' : '#f43f5e';
    return (
      '<svg viewBox="0 0 ' + w + ' ' + h + '" class="stone-spark" preserveAspectRatio="none" aria-hidden="true">' +
      '<line x1="' + pad + '" x2="' + (w - pad) + '" y1="' + zeroY.toFixed(1) + '" y2="' + zeroY.toFixed(1) + '" class="stone-spark-zero"/>' +
      '<polyline fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="' + points.join(' ') + '"/>' +
      '</svg>'
    );
  }

  function ensurePanel() {
    var existing = document.getElementById('phase2Insights');
    if (existing) return existing;

    var panel = document.createElement('div');
    panel.id = 'phase2Insights';
    panel.className = 'stone-phase2 space-y-3';
    panel.innerHTML =
      '<div class="stone-card bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-3.5">' +
        '<div class="flex items-center justify-between mb-2">' +
          '<h3 class="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider">' +
            '<i class="fa-solid fa-chart-line mr-1.5 text-brand-500"></i>แนวโน้ม 14 วัน' +
          '</h3>' +
          '<span id="phase2SparkHint" class="text-[10px] text-gray-400">กำไรสุทธิรายวัน</span>' +
        '</div>' +
        '<div id="phase2SparkWrap" class="w-full h-12">' + buildSparklineSvg([]) + '</div>' +
        '<div class="flex justify-between mt-1.5 text-[10px] text-gray-400">' +
          '<span>ย้อนหลัง</span><span>วันนี้</span>' +
        '</div>' +
      '</div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
        '<div class="stone-card bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-3.5">' +
          '<h3 class="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-2">' +
            '<i class="fa-solid fa-arrows-left-right mr-1.5 text-brand-500"></i>เทียบ<span id="phase2CompareLabel"></span>' +
          '</h3>' +
          '<div id="phase2CompareBody" class="space-y-1.5 text-xs"></div>' +
        '</div>' +
        '<div class="stone-card bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-3.5">' +
          '<h3 class="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-2">' +
            '<i class="fa-solid fa-ranking-star mr-1.5 text-brand-500"></i>หมวดรายจ่ายติดท็อป' +
          '</h3>' +
          '<div id="phase2TopCats" class="space-y-1.5 text-xs"></div>' +
        '</div>' +
      '</div>';

    var anchor = document.getElementById('dashboardInsight');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    } else {
      var main = document.querySelector('main');
      if (main) main.insertBefore(panel, main.firstChild);
    }
    return panel;
  }

  function deltaRow(label, cur, prev) {
    var diff = cur - prev;
    var pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : (cur === 0 ? 0 : 100);
    var cls = diff > 0 ? 'text-emerald-600' : (diff < 0 ? 'text-rose-600' : 'text-gray-500');
    if (label.indexOf('รายจ่าย') >= 0) {
      cls = diff < 0 ? 'text-emerald-600' : (diff > 0 ? 'text-rose-600' : 'text-gray-500');
    }
    return (
      '<div class="flex justify-between items-center gap-2">' +
        '<span class="text-gray-500 dark:text-gray-400">' + label + '</span>' +
        '<span class="font-semibold tabular-nums ' + cls + '">' +
          fmtMoney(cur) +
          ' <span class="text-[10px] font-medium opacity-80">(' + fmtPct(pct) + ')</span>' +
        '</span>' +
      '</div>'
    );
  }

  window.updatePhase2Insights = function () {
    try {
      ensurePanel();
      var bounds = getPeriodBounds();
      var curList = filterTx(bounds.start, bounds.end);
      var prevList = filterTx(bounds.prevStart, bounds.prevEnd);
      var cur = sumList(curList);
      var prev = sumList(prevList);

      var labelEl = document.getElementById('phase2CompareLabel');
      if (labelEl) labelEl.textContent = ' ' + bounds.label + ' vs ' + bounds.prevLabel;

      var body = document.getElementById('phase2CompareBody');
      if (body) {
        if (curList.length === 0 && prevList.length === 0) {
          body.innerHTML = '<p class="text-gray-400 text-[11px] leading-relaxed">ยังไม่มีข้อมูลเปรียบเทียบ — บันทึกรายการสักหน่อย แล้วกลับมาดูแนวโน้ม</p>';
        } else {
          body.innerHTML =
            deltaRow('รายรับ', cur.income, prev.income) +
            deltaRow('รายจ่าย', cur.expense, prev.expense) +
            deltaRow('กำไรสุทธิ', cur.net, prev.net) +
            '<p class="text-[10px] text-gray-400 pt-1">เทียบกับ ' + bounds.prevLabel +
            ' · รายการช่วงนี้ ' + curList.length + ' / ก่อนหน้า ' + prevList.length + '</p>';
        }
      }

      var top = topCategories(curList, 'expense', 3);
      var topEl = document.getElementById('phase2TopCats');
      if (topEl) {
        if (!top.length) {
          topEl.innerHTML = '<p class="text-gray-400 text-[11px]">ยังไม่มีรายจ่ายในช่วงนี้</p>';
        } else {
          var maxT = top[0].total || 1;
          topEl.innerHTML = top.map(function (c, i) {
            var pct = Math.round((c.total / maxT) * 100);
            return (
              '<div>' +
                '<div class="flex justify-between gap-2 mb-0.5">' +
                  '<span class="text-gray-700 dark:text-gray-200 truncate">' + (i + 1) + '. ' + escapeHtml(c.name) + '</span>' +
                  '<span class="font-semibold text-rose-600 tabular-nums shrink-0">' + fmtMoney(c.total) + '</span>' +
                '</div>' +
                '<div class="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">' +
                  '<div class="h-full rounded-full bg-rose-400/90" style="width:' + pct + '%"></div>' +
                '</div>' +
              '</div>'
            );
          }).join('');
        }
      }

      var series = dailySeries(14);
      var wrap = document.getElementById('phase2SparkWrap');
      if (wrap) wrap.innerHTML = buildSparklineSvg(series, 280, 48);
      var hint = document.getElementById('phase2SparkHint');
      if (hint) {
        var last7 = series.slice(-7);
        var net7 = last7.reduce(function (a, s) { return a + s.net; }, 0);
        hint.textContent = '7 วันล่าสุดสุทธิ ' + fmtMoney(net7);
        hint.className = 'text-[10px] font-medium ' + (net7 >= 0 ? 'text-emerald-600' : 'text-rose-600');
      }
    } catch (e) {
      console.warn('phase2 insights', e);
    }
  };

  function escapeHtml(s) {
    if (typeof window.escapeHTML === 'function') return window.escapeHTML(String(s));
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function installHook() {
    var prev = window.refreshDashboard;
    if (typeof prev !== 'function') return;
    if (prev.__phase2Hooked) return;
    var wrapped = async function () {
      var ret = await prev.apply(this, arguments);
      window.updatePhase2Insights();
      return ret;
    };
    wrapped.__phase2Hooked = true;
    window.refreshDashboard = wrapped;
  }

  function boot() {
    installHook();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        ensurePanel();
        setTimeout(function () { window.updatePhase2Insights(); }, 50);
      });
    } else {
      ensurePanel();
      setTimeout(function () { window.updatePhase2Insights(); }, 50);
    }
  }

  boot();
})();
