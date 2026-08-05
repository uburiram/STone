/**
 * STone reports: PDF export, monthly summary, daily slip
 * Load after js/app.js
 */
    // ----- PDF Export -----
    // โหลดฟอนต์ไทย (Sarabun) สำหรับ jsPDF — แคช base64 ใน memory หลังโหลดครั้งแรก
    window._pdfThaiFontB64 = null;
    window._loadThaiPdfFont = async function() {
      if (window._pdfThaiFontB64) return window._pdfThaiFontB64;
      // ลองจาก session cache ก่อน
      try {
        const cached = sessionStorage.getItem('stonePdfFontSarabun');
        if (cached && cached.length > 1000) {
          window._pdfThaiFontB64 = cached;
          return cached;
        }
      } catch (e) { /* ignore */ }

      const urls = [
        'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/sarabun/Sarabun-Regular.ttf',
        'https://github.com/google/fonts/raw/main/ofl/sarabun/Sarabun-Regular.ttf'
      ];
      let lastErr = null;
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          }
          const b64 = btoa(binary);
          window._pdfThaiFontB64 = b64;
          try { sessionStorage.setItem('stonePdfFontSarabun', b64); } catch (e) { /* quota */ }
          return b64;
        } catch (e) {
          lastErr = e;
          console.warn('Thai font fetch failed:', url, e);
        }
      }
      throw lastErr || new Error('ไม่สามารถโหลดฟอนต์ไทยได้');
    };

    window.exportDataToPDF = async function() {
      const txs = window.getFilteredTransactions();
      if (!txs || txs.length === 0) {
        alert('ไม่มีข้อมูลตามตัวกรองปัจจุบัน');
        return;
      }
      if (typeof window.jspdf === 'undefined') {
        alert('ไม่สามารถโหลดไลบรารี PDF ได้ กรุณาตรวจสอบอินเทอร์เน็ต');
        return;
      }

      window.showToast('กำลังสร้าง PDF (โหลดฟอนต์ไทย)...');
      let fontReady = false;
      let fontB64 = null;
      try {
        fontB64 = await window._loadThaiPdfFont();
        fontReady = true;
      } catch (e) {
        console.warn('PDF Thai font unavailable, fallback default font', e);
        if (!confirm('โหลดฟอนต์ไทยไม่สำเร็จ ภาษาไทยใน PDF อาจเป็นสี่เหลี่ยม\nต้องการสร้าง PDF ต่อหรือไม่?')) return;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const fontName = 'Sarabun';

      if (fontReady && fontB64) {
        doc.addFileToVFS('Sarabun-Regular.ttf', fontB64);
        doc.addFont('Sarabun-Regular.ttf', fontName, 'normal');
        doc.setFont(fontName, 'normal');
      }

      const pdfSums = window.sumIncomeExpense(txs);
      const totalInc = pdfSums.income, totalExp = pdfSums.expense;
      const net = pdfSums.net;

      doc.setFontSize(16);
      doc.text('รายงานรายรับ-รายจ่าย — STone', 105, 15, { align: 'center' });
      doc.setFontSize(10);
      doc.text('วันที่พิมพ์: ' + new Date().toLocaleString('th-TH'), 105, 22, { align: 'center' });
      doc.setFontSize(9);
      doc.text(
        `รายรับ: ${totalInc.toLocaleString('th-TH', {minimumFractionDigits:2})} | รายจ่าย: ${totalExp.toLocaleString('th-TH', {minimumFractionDigits:2})} | สุทธิ: ${net.toLocaleString('th-TH', {minimumFractionDigits:2})}`,
        105, 28, { align: 'center' }
      );

      const body = txs.map(t => [
        t.date,
        t.time || '',
        t.type === 'income' ? 'รายรับ' : 'รายจ่าย',
        t.category || '',
        t.subCategory || '',
        Number(t.amount).toLocaleString('th-TH', {minimumFractionDigits:2}),
        t.note || ''
      ]);

      const tableOpts = {
        startY: 34,
        head: [['วันที่', 'เวลา', 'ประเภท', 'หมวดหมู่', 'รายการย่อย', 'จำนวนเงิน', 'โน้ต']],
        body: body,
        styles: {
          fontSize: 8,
          cellPadding: 1.8,
          font: fontReady ? fontName : 'helvetica',
          fontStyle: 'normal',
          overflow: 'linebreak',
          valign: 'middle'
        },
        headStyles: {
          fillColor: [234, 88, 12],
          textColor: 255,
          fontStyle: 'normal',
          font: fontReady ? fontName : 'helvetica',
          fontSize: 8
        },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 14 },
          2: { cellWidth: 16 },
          5: { halign: 'right', cellWidth: 22 },
          6: { cellWidth: 'auto' }
        },
        margin: { left: 8, right: 8 },
        didDrawPage: function(data) {
          // ใส่เลขหน้า
          const pageCount = doc.internal.getNumberOfPages();
          doc.setFontSize(8);
          if (fontReady) doc.setFont(fontName, 'normal');
          doc.text(
            'หน้า ' + data.pageNumber + ' / ' + pageCount,
            doc.internal.pageSize.getWidth() / 2,
            doc.internal.pageSize.getHeight() - 8,
            { align: 'center' }
          );
        }
      };

      doc.autoTable(tableOpts);

      doc.save(`stone-report-${window.getLocalYYYYMMDD()}.pdf`);
      window.showToast(fontReady
        ? 'สร้างไฟล์ PDF เรียบร้อย (รองรับภาษาไทย)'
        : 'สร้างไฟล์ PDF แล้ว (ฟอนต์ไทยไม่พร้อม — ข้อความอาจไม่สมบูรณ์)');
    };

    // Init notification permission (safe)
    if (typeof window.finishLoading === 'function') {
      const origFinish = window.finishLoading;
      window.finishLoading = function() {
        origFinish();
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          setTimeout(() => Notification.requestPermission().catch(()=>{}), 3000);
        }
      };
    }

    // ----- Monthly Report -----
    window.openMonthlyReportModal = function() {
      const monthInput = document.getElementById('monthlyReportMonth');
      if (monthInput) {
        const now = new Date();
        const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        if (!monthInput.value) monthInput.value = ym;
      }
      window.renderMonthlyReport();
      document.getElementById('monthlyReportModal').classList.remove('hidden');
    };

    window.renderMonthlyReport = function() {
      const body = document.getElementById('monthlyReportBody');
      if (!body) return;

      const monthInput = document.getElementById('monthlyReportMonth');
      let y, m;
      if (monthInput && monthInput.value && /^\d{4}-\d{2}$/.test(monthInput.value)) {
        const parts = monthInput.value.split('-');
        y = Number(parts[0]);
        m = Number(parts[1]) - 1;
      } else {
        const now = new Date();
        y = now.getFullYear();
        m = now.getMonth();
      }
      const selected = new Date(y, m, 1);
      const prev = new Date(y, m - 1, 1);
      const prevY = prev.getFullYear();
      const prevM = prev.getMonth();

      const sumMonth = (year, month) => {
        let inc = 0, exp = 0, count = 0;
        const incCatMap = {};
        const expCatMap = {};
        (window.appData.transactions || []).forEach(tx => {
          const d = parseLocalDate(tx.date);
          if (!d || d.getFullYear() !== year || d.getMonth() !== month) return;
          const amt = Number(tx.amount) || 0;
          count++;
          const catName = tx.category || 'ไม่ระบุ';
          if (tx.type === 'income') {
            inc += amt;
            incCatMap[catName] = (incCatMap[catName] || 0) + amt;
          } else {
            exp += amt;
            expCatMap[catName] = (expCatMap[catName] || 0) + amt;
          }
        });
        const topIncCats = Object.entries(incCatMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const topExpCats = Object.entries(expCatMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
        return { inc, exp, net: inc - exp, topIncCats, topExpCats, count };
      };

      const cur = sumMonth(y, m);
      const prv = sumMonth(prevY, prevM);
      const pct = (a, b) => {
        if (b === 0) return a === 0 ? 'เท่าเดิม' : 'เพิ่มขึ้นจากศูนย์';
        const v = ((a - b) / Math.abs(b) * 100);
        const sign = v > 0 ? 'เพิ่มขึ้น ' : (v < 0 ? 'ลดลง ' : '');
        return sign + Math.abs(v).toFixed(1) + '% จากเดือนก่อน';
      };
      const monthName = selected.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
      const prevName = prev.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
      const margin = cur.inc > 0 ? (cur.net / cur.inc * 100) : null;

      body.innerHTML = `
        <div class="text-center shrink-0">
          <div class="text-base font-bold text-gray-800 dark:text-gray-100 leading-tight">${monthName}</div>
          <div class="text-[11px] text-gray-500 mt-0.5">เทียบกับ ${prevName} · ${cur.count} รายการ</div>
        </div>
        <div class="grid grid-cols-3 gap-1.5 shrink-0">
          <div class="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl px-1.5 py-2.5 text-center">
            <div class="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">รายรับ</div>
            <div class="text-sm font-bold text-emerald-700 leading-tight mt-0.5">฿${cur.inc.toLocaleString('th-TH', {minimumFractionDigits: 0})}</div>
            <div class="text-[9px] text-gray-500 mt-1 leading-tight">${pct(cur.inc, prv.inc)}</div>
          </div>
          <div class="bg-rose-50 dark:bg-rose-900/20 rounded-xl px-1.5 py-2.5 text-center">
            <div class="text-[10px] font-semibold text-rose-800 dark:text-rose-300">รายจ่าย</div>
            <div class="text-sm font-bold text-rose-700 leading-tight mt-0.5">฿${cur.exp.toLocaleString('th-TH', {minimumFractionDigits: 0})}</div>
            <div class="text-[9px] text-gray-500 mt-1 leading-tight">${pct(cur.exp, prv.exp)}</div>
          </div>
          <div class="bg-orange-50 dark:bg-orange-900/20 rounded-xl px-1.5 py-2.5 text-center">
            <div class="text-[10px] font-semibold text-orange-800 dark:text-orange-300">กำไรสุทธิ</div>
            <div class="text-sm font-bold ${cur.net >= 0 ? 'text-emerald-700' : 'text-rose-700'} leading-tight mt-0.5">฿${cur.net.toLocaleString('th-TH', {minimumFractionDigits: 0})}</div>
            <div class="text-[9px] text-gray-500 mt-1 leading-tight">${pct(cur.net, prv.net)}</div>
            ${margin !== null ? `<div class="text-[9px] font-semibold mt-0.5 ${margin >= 0 ? 'text-emerald-600' : 'text-rose-600'}">${margin.toFixed(1)}% ของรายรับ</div>` : ''}
          </div>
        </div>
        <div class="bg-gray-50 dark:bg-gray-700/40 rounded-xl px-3 py-2 flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
          <div class="text-xs font-bold text-gray-800 dark:text-gray-100 shrink-0">หมวดที่ใช้เยอะสุด</div>
          <div class="shrink-0">
            <div class="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 mb-1 flex items-center gap-1">
              <i class="fa-solid fa-arrow-trend-up text-[10px]"></i> รายรับ
            </div>
            ${cur.topIncCats.length ? cur.topIncCats.map(([name, val], i) => `
              <div class="flex justify-between items-center py-1 border-b border-emerald-100/80 dark:border-emerald-900/40 last:border-0 gap-2">
                <span class="text-xs text-gray-700 dark:text-gray-200 truncate">${i + 1}. ${escapeHTML(name)}</span>
                <span class="text-xs font-bold text-emerald-700 dark:text-emerald-300 whitespace-nowrap">฿${val.toLocaleString('th-TH', {minimumFractionDigits: 0})}</span>
              </div>`).join('') : '<div class="text-xs text-gray-400 py-1">ยังไม่มีรายรับในเดือนนี้</div>'}
          </div>
          <div class="shrink-0">
            <div class="text-[11px] font-bold text-rose-700 dark:text-rose-300 mb-1 flex items-center gap-1">
              <i class="fa-solid fa-arrow-trend-down text-[10px]"></i> รายจ่าย
            </div>
            ${cur.topExpCats.length ? cur.topExpCats.map(([name, val], i) => `
              <div class="flex justify-between items-center py-1 border-b border-rose-100/80 dark:border-rose-900/40 last:border-0 gap-2">
                <span class="text-xs text-gray-700 dark:text-gray-200 truncate">${i + 1}. ${escapeHTML(name)}</span>
                <span class="text-xs font-bold text-rose-700 dark:text-rose-300 whitespace-nowrap">฿${val.toLocaleString('th-TH', {minimumFractionDigits: 0})}</span>
              </div>`).join('') : '<div class="text-xs text-gray-400 py-1">ยังไม่มีรายจ่ายในเดือนนี้</div>'}
          </div>
        </div>
        <div class="bg-gray-50 dark:bg-gray-700/40 rounded-xl px-3 py-2 text-xs text-gray-700 dark:text-gray-200 shrink-0">
          <div class="font-bold text-gray-800 dark:text-gray-100 mb-1">เดือนก่อน — ${prevName}</div>
          <div class="flex flex-wrap gap-x-3 gap-y-0.5 leading-snug">
            <span>รับ <b>฿${prv.inc.toLocaleString('th-TH', {minimumFractionDigits: 0})}</b></span>
            <span>จ่าย <b>฿${prv.exp.toLocaleString('th-TH', {minimumFractionDigits: 0})}</b></span>
            <span>กำไร <b class="${prv.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}">฿${prv.net.toLocaleString('th-TH', {minimumFractionDigits: 0})}</b></span>
          </div>
        </div>
      `;
    };

    // ----- Daily slip (fullscreen on-screen + print) -----
    window.printDailySlip = async function(dateStr) {
      const fallbackToday = (typeof getLocalYYYYMMDD === 'function')
        ? getLocalYYYYMMDD()
        : window.getLocalYYYYMMDD();
      const day = (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) ? dateStr : fallbackToday;
      // Prefer IDB for the selected day so slip is complete even if memory only has a filter range
      let txs = (window.appData.transactions || []).filter(t => t.date === day);
      try {
        if (window.SomtumStore && SomtumStore.getTxByDateRange) {
          const fromIdb = await SomtumStore.getTxByDateRange(day, day);
          if (fromIdb && fromIdb.length) txs = fromIdb;
        }
      } catch (e) { console.warn('printDailySlip IDB', e); }
      const sums = window.sumIncomeExpense(txs);
      const inc = sums.income, exp = sums.expense, net = sums.net;

      // Percentages
      const marginPct = inc > 0 ? (net / inc) * 100 : 0;           // กำไรต่อรายรับ
      const expOfIncPct = inc > 0 ? (exp / inc) * 100 : (exp > 0 ? 100 : 0); // รายจ่ายต่อรายรับ
      const profitOfExpPct = exp > 0 ? (net / exp) * 100 : null;   // กำไรต่อต้นทุน

      const fmt = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtPct = (n) => (n === null || !isFinite(n)) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
      const netColor = net >= 0 ? '#047857' : '#be123c';
      const marginColor = marginPct >= 0 ? '#047857' : '#be123c';

      // Thai date label
      let dateLabel = day;
      try {
        const parts = day.split('-');
        if (parts.length === 3) {
          const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          dateLabel = d.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }
      } catch (e) { /* keep ISO */ }

      // Remove previous overlay if any
      const old = document.getElementById('dailySlipOverlay');
      if (old) old.remove();

      const overlay = document.createElement('div');
      overlay.id = 'dailySlipOverlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `
<div class="ds-backdrop">
  <div class="ds-sheet">
    <div class="ds-header">
      <div class="ds-title">พิมพ์ใบสรุปยอดประจำวัน</div>
      <button type="button" class="ds-close" aria-label="ปิด">&times;</button>
    </div>
    <div class="ds-date-bar no-print">
      <label class="ds-date-label">เลือกวันที่</label>
      <input type="date" id="dailySlipDateInput" value="${day}" class="ds-date-input">
    </div>
    <div class="ds-body" id="dailySlipPrintArea">
      <div class="ds-brand">สรุปยอดประจำวัน</div>
      <div class="ds-date">${dateLabel}</div>
      <div class="ds-card ds-inc">
        <div class="ds-label">รายรับ</div>
        <div class="ds-amt">฿${fmt(inc)}</div>
      </div>
      <div class="ds-card ds-exp">
        <div class="ds-label">รายจ่าย <span class="ds-pct-inline">${fmtPct(expOfIncPct)} ของรายรับ</span></div>
        <div class="ds-amt">฿${fmt(exp)}</div>
      </div>
      <div class="ds-card ds-net" style="border-color:${netColor}">
        <div class="ds-label">สุทธิ (กำไร/ขาดทุน)</div>
        <div class="ds-amt" style="color:${netColor}">฿${fmt(net)}</div>
        <div class="ds-pct" style="color:${marginColor}">อัตรากำไร ${fmtPct(marginPct)} ของรายรับ</div>
        <div class="ds-pct-sub">${profitOfExpPct === null ? 'ยังไม่มีรายจ่ายเพื่อเทียบต้นทุน' : ('กำไรต่อต้นทุน ' + fmtPct(profitOfExpPct))}</div>
      </div>
      <div class="ds-meta">${txs.length} รายการ · อัปเดต ${new Date().toLocaleString('th-TH')}</div>
    </div>
    <div class="ds-actions">
      <button type="button" class="ds-btn ds-btn-print">พิมพ์ / บันทึกเป็น PDF</button>
      <button type="button" class="ds-btn ds-btn-close2">ปิด</button>
    </div>
  </div>
</div>`;

      const style = document.createElement('style');
      style.id = 'dailySlipStyle';
      style.textContent = `
#dailySlipOverlay{position:fixed;inset:0;z-index:120;font-family:'Prompt',system-ui,sans-serif}
#dailySlipOverlay .ds-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:stretch;justify-content:center;padding:0}
#dailySlipOverlay .ds-sheet{background:#fff;width:100%;max-width:480px;height:100%;max-height:100dvh;display:flex;flex-direction:column;box-shadow:0 0 40px rgba(0,0,0,.25)}
@media(min-width:520px){
  #dailySlipOverlay .ds-backdrop{align-items:center;padding:16px}
  #dailySlipOverlay .ds-sheet{height:auto;max-height:min(92dvh,720px);border-radius:24px;overflow:hidden}
}
#dailySlipOverlay .ds-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #eee;flex-shrink:0;background:linear-gradient(90deg,#ea580c,#f59e0b);color:#fff}
#dailySlipOverlay .ds-title{font-weight:700;font-size:clamp(15px,4.2vw,17px)}
#dailySlipOverlay .ds-close{background:transparent;border:0;color:#fff;font-size:28px;line-height:1;cursor:pointer;padding:0 6px}
#dailySlipOverlay .ds-date-bar{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid #eee;background:#fff7ed;flex-shrink:0}
#dailySlipOverlay .ds-date-label{font-size:13px;font-weight:600;color:#9a3412;white-space:nowrap}
#dailySlipOverlay .ds-date-input{flex:1;font-size:14px;padding:8px 10px;border:1px solid #fdba74;border-radius:12px;background:#fff;color:#111;font-family:inherit}
#dailySlipOverlay .ds-body{flex:1;overflow:auto;padding:clamp(16px,4vw,24px);text-align:center;-webkit-overflow-scrolling:touch}
#dailySlipOverlay .ds-brand{font-size:clamp(22px,6.5vw,28px);font-weight:800;color:#111;margin:4px 0 6px}
#dailySlipOverlay .ds-date{font-size:clamp(13px,3.6vw,15px);color:#555;margin-bottom:clamp(14px,3vw,20px)}
#dailySlipOverlay .ds-card{border:2px solid #e5e7eb;border-radius:16px;padding:clamp(12px,3.5vw,18px);margin:0 0 12px;background:#fafafa}
#dailySlipOverlay .ds-inc{border-color:#a7f3d0;background:#ecfdf5}
#dailySlipOverlay .ds-exp{border-color:#fecdd3;background:#fff1f2}
#dailySlipOverlay .ds-net{background:#fff7ed}
#dailySlipOverlay .ds-label{font-size:clamp(13px,3.5vw,15px);font-weight:600;color:#374151;margin-bottom:4px}
#dailySlipOverlay .ds-pct-inline{font-weight:700;color:#be123c;font-size:clamp(12px,3.2vw,14px)}
#dailySlipOverlay .ds-amt{font-size:clamp(28px,9vw,40px);font-weight:800;letter-spacing:-0.02em;line-height:1.15;font-variant-numeric:tabular-nums}
#dailySlipOverlay .ds-inc .ds-amt{color:#047857}
#dailySlipOverlay .ds-exp .ds-amt{color:#be123c}
#dailySlipOverlay .ds-pct{font-size:clamp(16px,4.5vw,20px);font-weight:700;margin-top:8px}
#dailySlipOverlay .ds-pct-sub{font-size:clamp(13px,3.5vw,15px);color:#6b7280;margin-top:4px;font-weight:600}
#dailySlipOverlay .ds-meta{font-size:clamp(12px,3.2vw,13px);color:#6b7280;margin-top:8px}
#dailySlipOverlay .ds-actions{display:flex;gap:10px;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0));border-top:1px solid #eee;flex-shrink:0;background:#fff}
#dailySlipOverlay .ds-btn{flex:1;padding:14px 12px;border-radius:14px;font-size:clamp(14px,3.8vw,16px);font-weight:700;border:0;cursor:pointer;font-family:inherit}
#dailySlipOverlay .ds-btn-print{background:#ea580c;color:#fff}
#dailySlipOverlay .ds-btn-close2{background:#f3f4f6;color:#374151}
@media print{
  body > *:not(#dailySlipOverlay){display:none!important}
  #dailySlipOverlay{position:static}
  #dailySlipOverlay .ds-backdrop{background:#fff;padding:0}
  #dailySlipOverlay .ds-sheet{box-shadow:none;max-width:100%;height:auto;max-height:none;border-radius:0}
  #dailySlipOverlay .ds-header,#dailySlipOverlay .ds-actions,#dailySlipOverlay .ds-close,#dailySlipOverlay .ds-date-bar,.no-print{display:none!important}
  #dailySlipOverlay .ds-body{padding:12mm}
  #dailySlipOverlay .ds-amt{font-size:28pt}
}
`;
      // replace previous style
      const oldStyle = document.getElementById('dailySlipStyle');
      if (oldStyle) oldStyle.remove();
      document.head.appendChild(style);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';

      const close = () => {
        overlay.remove();
        document.body.style.overflow = '';
      };
      overlay.querySelector('.ds-close').addEventListener('click', close);
      overlay.querySelector('.ds-btn-close2').addEventListener('click', close);
      overlay.querySelector('.ds-backdrop').addEventListener('click', (e) => {
        if (e.target === overlay.querySelector('.ds-backdrop')) close();
      });
      overlay.querySelector('.ds-btn-print').addEventListener('click', () => {
        window.print();
      });
      const dateInput = overlay.querySelector('#dailySlipDateInput');
      if (dateInput) {
        dateInput.addEventListener('change', () => {
          const v = dateInput.value;
          if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
            window.printDailySlip(v);
          }
        });
      }
    };

