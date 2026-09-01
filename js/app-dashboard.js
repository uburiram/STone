/* ============================================================
 * STone — app-dashboard.js
 * UI state, filters, toast/modals, onload, refreshDashboard, history list helpers, KPI
 * Split from js/app.js (behavior unchanged; window.* API kept)
 * Load order: storage → app-core → app-dashboard → app-tx →
 *             app-categories → app-features → reports → firebase
 * ============================================================ */


    let currentFilter = 'monthly';
    let selectedCustomDate = getLocalYYYYMMDD();
    let selectedStartDate = getLocalYYYYMMDD();
    let selectedEndDate = getLocalYYYYMMDD();
    let selectedCalendarDay = getLocalYYYYMMDD();
    let calendarCurrentDate = new Date();
    let managerType = 'income';
    let _editTxIdTemp = null;
    let currentReportTab = 'income';
    let historyDisplayLimit = 50;
    let reportDisplayLimit = 50;
    let lastCardDetailType = null;

    window.finishLoading = function() {
      const overlay = document.getElementById('loadingOverlay');
      if(overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.classList.add('hidden'), 300);
      }
      window.refreshDashboard();
    }

    window.showToast = function(msg, type = 'success') {
      const toast = document.getElementById('toast');
      document.getElementById('toastMsg').innerText = msg;
      document.getElementById('toastIcon').className = type === 'success' ? 'fa-solid fa-circle-check text-emerald-400' : 'fa-solid fa-circle-xmark text-rose-400';
      toast.style.opacity = '1';
      setTimeout(() => toast.style.opacity = '0', 3000);
    }

    window.showConfirmModal = function(title, desc, onConfirmCallback) {
      const modal = document.getElementById('customConfirmModal');
      document.getElementById('confirmModalTitle').innerText = title;
      document.getElementById('confirmModalDesc').innerText = desc;
      const btnOk = document.getElementById('confirmModalBtnOk');
      const btnCancel = document.getElementById('confirmModalBtnCancel');
      
      const newBtnOk = btnOk.cloneNode(true);
      const newBtnCancel = btnCancel.cloneNode(true);
      btnOk.parentNode.replaceChild(newBtnOk, btnOk);
      btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

      newBtnOk.onclick = () => {
        modal.classList.add('hidden');
        if (onConfirmCallback) onConfirmCallback();
      };
      newBtnCancel.onclick = () => {
        modal.classList.add('hidden');
      };
      modal.classList.remove('hidden');
    };

    window.closeRenameModal = function() {
      document.getElementById('renameModal').classList.add('hidden');
      window._renameCallback = null;
    };

    window.openRenameModal = function(title, desc, currentValue, onSave) {
      const modal = document.getElementById('renameModal');
      document.getElementById('renameModalTitle').innerText = title;
      document.getElementById('renameModalDesc').innerText = desc || 'กรอกชื่อใหม่ด้านล่าง';
      const input = document.getElementById('renameModalInput');
      input.value = currentValue || '';
      window._renameCallback = onSave;

      const btnOk = document.getElementById('renameModalBtnOk');
      const newBtnOk = btnOk.cloneNode(true);
      btnOk.parentNode.replaceChild(newBtnOk, btnOk);
      newBtnOk.onclick = () => {
        const val = input.value.trim();
        if (!val) {
          alert('ชื่อห้ามว่าง');
          input.focus();
          return;
        }
        modal.classList.add('hidden');
        if (window._renameCallback) window._renameCallback(val);
        window._renameCallback = null;
      };

      // Enter key submits
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          newBtnOk.click();
        } else if (e.key === 'Escape') {
          window.closeRenameModal();
        }
      };

      modal.classList.remove('hidden');
      setTimeout(() => { input.focus(); input.select(); }, 50);
    };

    function createDynamicManifest() {
      // Prefer static manifest.webmanifest (TWA / Play). Dynamic blob remains as fallback.

      const manifest = {
        // name = ชื่อเต็มตอนติดตั้ง / หน้าข้อมูลแอป
        name: "ระบบบันทึกต้นทุน กำไร - STone",
        // short_name = ชื่อใต้ไอคอนบนหน้าจอ (สั้นเพื่อไม่ถูกตัด)
        short_name: "STone",
        description: "ระบบบันทึกต้นทุน กำไร - STone",
        start_url: "./",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ea580c",
        icons: [
          { src: "./icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "./icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "./icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "./icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      };
      const blob = new Blob([JSON.stringify(manifest)], {type: 'application/json'});
      document.getElementById('manifest-placeholder').setAttribute('href', URL.createObjectURL(blob));
    }

    window.onload = function() {
      createDynamicManifest();
      // Re-hydrate after store init / migration (prefer richer dataset).
      if (typeof window.__hydrateAppDataFromStore === 'function') {
        window.__hydrateAppDataFromStore(true);
      } else if (!window.appData || !Array.isArray(window.appData.transactions)) {
        try {
          const savedData = SomtumStore.getItem('somtumAppData');
          window.appData = window.sanitizeAppData(savedData ? JSON.parse(savedData) : {});
        } catch (e) {
          console.error('Load local data failed:', e);
          window.appData = window.sanitizeAppData({});
        }
      }
      document.getElementById('selectedDate').value = selectedCustomDate;
      document.getElementById('startDate').value = selectedStartDate;
      document.getElementById('endDate').value = selectedEndDate;
      window.setTimeFilter('monthly');
      window.finishLoading();

      if (SomtumStore.getItem('somtumHasUnsyncedData') === 'true') {
        setTimeout(() => {
          const m = document.getElementById('syncPromptModal');
          if (m) m.classList.remove('hidden');
        }, 1000);
      }
    };

    window.setTimeFilter = function(filter) {
      currentFilter = filter;
      historyDisplayLimit = 50;
      reportDisplayLimit = 50;
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('bg-brand-600', 'text-white', 'shadow-sm');
        btn.classList.add('text-gray-600', 'dark:text-gray-300');
      });
      const activeBtn = document.getElementById(`filter-${filter}`);
      if (activeBtn) {
        activeBtn.classList.add('bg-brand-600', 'text-white', 'shadow-sm');
        activeBtn.classList.remove('text-gray-600', 'dark:text-gray-300');
      }

      const singleContainer = document.getElementById('singleDateContainer');
      const rangeContainer = document.getElementById('rangeDateContainer');

      if (filter === 'custom') {
        singleContainer.classList.remove('hidden');
        singleContainer.classList.add('flex');
        rangeContainer.classList.add('hidden');
        rangeContainer.classList.remove('flex');
      } else if (filter === 'range') {
        rangeContainer.classList.remove('hidden');
        rangeContainer.classList.add('flex');
        singleContainer.classList.add('hidden');
        singleContainer.classList.remove('flex');
      } else {
        singleContainer.classList.add('hidden');
        singleContainer.classList.remove('flex');
        rangeContainer.classList.add('hidden');
        rangeContainer.classList.remove('flex');
      }
      window.refreshDashboard();
    }

    window.onCustomDateSelect = function() {
      selectedCustomDate = document.getElementById('selectedDate').value;
      window.setTimeFilter('custom');
    };

    window.onDateRangeSelect = function() {
      selectedStartDate = document.getElementById('startDate').value;
      selectedEndDate = document.getElementById('endDate').value;
      if (selectedStartDate && selectedEndDate) {
        // Swap UI values if user picked inverted range
        if (selectedStartDate > selectedEndDate) {
          const tmp = selectedStartDate;
          selectedStartDate = selectedEndDate;
          selectedEndDate = tmp;
          document.getElementById('startDate').value = selectedStartDate;
          document.getElementById('endDate').value = selectedEndDate;
        }
        window.setTimeFilter('range');
      }
    };

    // Time-range filter only (used by KPI / ratio / goals — must NOT be affected by
    // history search / type / category / amount / note filters).
    window.getTimeFilteredTransactions = function() {
      const txList = window.appData.transactions || [];
      const now = new Date();
      // Normalize inverted custom range so start <= end
      let rangeStart = selectedStartDate;
      let rangeEnd = selectedEndDate;
      if (currentFilter === 'range' && rangeStart && rangeEnd && rangeStart > rangeEnd) {
        const tmp = rangeStart; rangeStart = rangeEnd; rangeEnd = tmp;
      }

      return txList.filter(tx => {
        const txDate = parseLocalDate(tx.date);
        if (currentFilter === 'custom') {
          return tx.date === selectedCustomDate;
        }
        if (currentFilter === 'range') {
          if (!rangeStart || !rangeEnd) return true;
          return tx.date >= rangeStart && tx.date <= rangeEnd;
        }
        if (currentFilter === 'daily') {
          return tx.date === getLocalYYYYMMDD();
        }
        if (currentFilter === 'weekly') {
          const day = now.getDay();
          const diff = day === 0 ? -6 : 1 - day;
          const startOfWeek = new Date(now);
          startOfWeek.setDate(now.getDate() + diff);
          startOfWeek.setHours(0, 0, 0, 0);
          const endOfWeek = new Date(startOfWeek);
          endOfWeek.setDate(startOfWeek.getDate() + 6);
          endOfWeek.setHours(23, 59, 59, 999);
          return txDate >= startOfWeek && txDate <= endOfWeek;
        }
        if (currentFilter === 'monthly') {
          return txDate.getMonth() === now.getMonth() && txDate.getFullYear() === now.getFullYear();
        }
        if (currentFilter === 'yearly') {
          return txDate.getFullYear() === now.getFullYear();
        }
        return true; // 'all'
      });
    };

    // Full filter: time + history UI filters (search / type / category / amount / note)
    window.getFilteredTransactions = function() {
      const searchQuery = (document.getElementById('searchTxInput') || {value:''}).value.toLowerCase();
      const histType = (document.getElementById('histFilterType') || {value:'all'}).value;
      const histCat = (document.getElementById('histFilterCategory') || {value:'all'}).value;
      const minAmtRaw = (document.getElementById('histFilterMinAmt') || {value:''}).value;
      const maxAmtRaw = (document.getElementById('histFilterMaxAmt') || {value:''}).value;
      const hasNoteOnly = !!(document.getElementById('histFilterHasNote') || {}).checked;
      const minAmt = minAmtRaw === '' ? null : Number(minAmtRaw);
      const maxAmt = maxAmtRaw === '' ? null : Number(maxAmtRaw);

      return window.getTimeFilteredTransactions().filter(tx => {
        if (histType !== 'all' && tx.type !== histType) return false;
        if (histCat !== 'all' && tx.category !== histCat) return false;

        const amt = Number(tx.amount) || 0;
        if (minAmt !== null && !isNaN(minAmt) && amt < minAmt) return false;
        if (maxAmt !== null && !isNaN(maxAmt) && amt > maxAmt) return false;
        if (hasNoteOnly && !(tx.note && String(tx.note).trim())) return false;

        if (searchQuery) {
          const txt = `${tx.category} ${tx.subCategory || ''} ${tx.note || ''}`.toLowerCase();
          if (!txt.includes(searchQuery)) return false;
        }
        return true;
      });
    };

    window.populateHistoryCategoryFilter = function() {
      const sel = document.getElementById('histFilterCategory');
      if (!sel) return;
      const prev = sel.value;
      const names = new Set();
      (window.appData.categories?.income || []).forEach(c => names.add(c.name));
      (window.appData.categories?.expense || []).forEach(c => names.add(c.name));
      (window.appData.transactions || []).forEach(t => { if (t.category) names.add(t.category); });
      sel.innerHTML = '<option value="all">ทุกหมวดหมู่</option>' +
        [...names].sort().map(n => `<option value="${escapeAttr(String(n))}">${escapeHTML(String(n))}</option>`).join('');
      if ([...names].includes(prev) || prev === 'all') sel.value = prev;
    };

    window.renderDrillDownAccordion = function(txList, containerId, prefix = 'dd') {
      const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
      if (!container) return;
      if (!txList || txList.length === 0) {
        container.innerHTML = `<div class="text-center py-6 text-gray-400 text-xs">ไม่มีรายการข้อมูล</div>`;
        return;
      }

      /** Group one type's transactions by category → subCategory */
      function buildTypeGroup(list) {
        const grouped = {};
        (list || []).forEach(function(tx) {
          const cat = tx.category || 'ไม่ระบุหมวดหมู่';
          const sub = tx.subCategory || 'ทั่วไป';
          if (!grouped[cat]) grouped[cat] = { total: 0, subs: {} };
          grouped[cat].total = window.roundMoney(grouped[cat].total + window.roundMoney(tx.amount));
          if (!grouped[cat].subs[sub]) grouped[cat].subs[sub] = { total: 0, items: [] };
          grouped[cat].subs[sub].total = window.roundMoney(grouped[cat].subs[sub].total + window.roundMoney(tx.amount));
          grouped[cat].subs[sub].items.push(tx);
        });
        return grouped;
      }

      function renderTypeSection(typeKey, typeLabel, typeColorClass, grouped, sectionIdx) {
        const catNames = Object.keys(grouped);
        if (catNames.length === 0) return '';
        let typeTotal = 0;
        catNames.forEach(function(c) { typeTotal = window.roundMoney(typeTotal + grouped[c].total); });
        let html = `
          <div class="mb-3">
            <div class="flex justify-between items-center px-1 mb-1.5">
              <span class="text-xs font-bold ${typeColorClass} flex items-center gap-1.5">
                <i class="fa-solid ${typeKey === 'income' ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'} text-[10px]"></i>
                ${typeLabel}
              </span>
              <span class="text-xs font-bold ${typeColorClass}">฿${typeTotal.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
            </div>
        `;
        catNames.forEach(function(catName, catIdx) {
          const catData = grouped[catName];
          const catId = prefix + '-' + typeKey + '-cat-' + sectionIdx + '-' + catIdx;
          let subHtml = '';
          Object.keys(catData.subs).forEach(function(subName, subIdx) {
            const subData = catData.subs[subName];
            const subId = prefix + '-' + typeKey + '-sub-' + sectionIdx + '-' + catIdx + '-' + subIdx;
            const itemsHtml = subData.items.map(function(it) {
              const isInc = it.type === 'income';
              const safeId = window.escapeAttr(it.id);
              return `
              <div class="flex justify-between items-center py-1.5 px-2.5 text-xs bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 my-1 shadow-2xs cursor-pointer hover:border-brand-300 transition-all" onclick="editTransaction('${safeId}')" title="แตะเพื่อแก้ไข">
                <div class="flex flex-col">
                  <span class="font-medium text-gray-800 dark:text-gray-100 text-[11px]">${escapeHTML(it.date)} ${it.time ? '• ' + escapeHTML(it.time) : ''}</span>
                  <span class="text-[10px] text-gray-500">${escapeHTML(it.category || '')}${it.subCategory ? ' • ' + escapeHTML(it.subCategory) : ''}</span>
                  ${it.note ? `<span class="text-[10px] text-gray-400 italic">${escapeHTML(it.note)}</span>` : ''}
                </div>
                <div class="flex items-center gap-2" onclick="event.stopPropagation()">
                  <span class="font-bold text-xs ${isInc ? 'text-emerald-600' : 'text-rose-600'}">
                    ${isInc ? '+' : '-'}฿${Number(it.amount).toLocaleString('th-TH', {minimumFractionDigits: 2})}
                  </span>
                  <div class="flex gap-1.5 ml-1">
                    <button onclick="editTransaction('${safeId}')" class="text-brand-500 hover:text-brand-700 text-[11px] p-0.5" title="แก้ไข"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="deleteTransaction('${safeId}')" class="text-gray-400 hover:text-rose-600 text-[11px] p-0.5" title="ลบ"><i class="fa-solid fa-trash"></i></button>
                  </div>
                </div>
              </div>`;
            }).join('');

            subHtml += `
            <div class="bg-gray-50/80 dark:bg-gray-900/40 rounded-xl p-2 border border-gray-100 dark:border-gray-700 my-1.5">
              <div class="flex justify-between items-center text-xs font-semibold text-gray-700 dark:text-gray-200 cursor-pointer py-0.5" onclick="toggleSubDetail('${subId}')">
                <span class="flex items-center gap-1.5">
                  <i class="fa-solid fa-angle-right text-gray-400 text-[10px] transition-transform" id="icon-${subId}"></i>
                  <span>${escapeHTML(subName)}</span>
                  <span class="text-[9px] bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-200 px-1.5 py-0.2 rounded-full font-normal">${subData.items.length}</span>
                </span>
                <span class="font-bold text-gray-700 dark:text-gray-200">฿${subData.total.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
              </div>
              <div id="${subId}" class="hidden mt-1.5 pt-1 border-t border-gray-200/60 dark:border-gray-600 space-y-1">
                ${itemsHtml}
              </div>
            </div>`;
          });

          html += `
          <div class="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xs p-3 my-2">
            <div class="flex justify-between items-center cursor-pointer" onclick="toggleSubDetail('${catId}')">
              <span class="font-bold text-xs text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <i class="fa-solid fa-folder text-brand-500"></i>
                <span>${escapeHTML(catName)}</span>
              </span>
              <span class="font-bold text-xs text-gray-800 dark:text-gray-100 flex items-center gap-1">
                ฿${catData.total.toLocaleString('th-TH', {minimumFractionDigits: 2})}
                <i class="fa-solid fa-caret-down text-gray-400 ml-1 transition-transform" id="icon-${catId}"></i>
              </span>
            </div>
            <div id="${catId}" class="hidden space-y-1 pt-2">
              ${subHtml}
            </div>
          </div>`;
        });
        html += '</div>';
        return html;
      }

      const incomeList = [];
      const expenseList = [];
      (txList || []).forEach(function(tx) {
        if (!tx) return;
        if (tx.type === 'income') incomeList.push(tx);
        else if (tx.type === 'expense') expenseList.push(tx);
      });

      const incGrouped = buildTypeGroup(incomeList);
      const expGrouped = buildTypeGroup(expenseList);

      let html = '';
      html += renderTypeSection('income', 'รายรับ', 'text-emerald-700 dark:text-emerald-300', incGrouped, 0);
      html += renderTypeSection('expense', 'รายจ่าย', 'text-rose-700 dark:text-rose-300', expGrouped, 1);

      if (!html) {
        container.innerHTML = `<div class="text-center py-6 text-gray-400 text-xs">ไม่มีรายการข้อมูล</div>`;
        return;
      }
      container.innerHTML = html;
    };

    window.toggleSubDetail = function(id) {
      const el = document.getElementById(id);
      if(el) {
        el.classList.toggle('hidden');
        const icon = document.getElementById('icon-' + id);
        if (icon) icon.classList.toggle('rotate-180');
      }
    }

    window.refreshDashboard = async function() {
      try {
        if (typeof window.ensureTransactionsLoaded === 'function') {
          await window.ensureTransactionsLoaded(false);
        }
      } catch (e) { console.warn('tx load before refresh', e); }
      if (typeof window.populateHistoryCategoryFilter === 'function') window.populateHistoryCategoryFilter();
      // KPI / ratio / goal: time filter only (not history search/type/category filters)
      const kpiTx = window.getTimeFilteredTransactions();
      // History list & category report: full filters
      const filteredTx = window.getFilteredTransactions();
      const sums = window.sumIncomeExpense(kpiTx);
      const totalIncome = sums.income;
      const totalExpense = sums.expense;

      const netProfit = sums.net;
      const targetGoal = window.resolveTargetGoal(totalExpense, totalIncome);
      const goalAchievedPercent = targetGoal > 0 ? (totalIncome / targetGoal) * 100 : 0;

      document.getElementById('kpiTotalIncome').innerText = `฿${totalIncome.toLocaleString('th-TH', {minimumFractionDigits:2})}`;
      document.getElementById('kpiTotalExpense').innerText = `฿${totalExpense.toLocaleString('th-TH', {minimumFractionDigits:2})}`;
      document.getElementById('kpiNetProfit').innerText = `฿${netProfit.toLocaleString('th-TH', {minimumFractionDigits:2})}`;
      document.getElementById('kpiTargetAmount').innerText = `฿${targetGoal.toLocaleString('th-TH', {minimumFractionDigits:2})}`;

      const totalBoth = totalIncome + totalExpense;
      document.getElementById('kpiIncomePercent').innerText = totalBoth > 0 ? `คิดเป็น ${((totalIncome/totalBoth)*100).toFixed(1)}% ของกระแสเงิน` : '';
      document.getElementById('kpiExpensePercent').innerText = totalBoth > 0 ? `คิดเป็น ${((totalExpense/totalBoth)*100).toFixed(1)}% ของกระแสเงิน` : '';

      const pmElem = document.getElementById('kpiProfitMargin');
      if (totalIncome > 0) {
        const pm = (netProfit / totalIncome) * 100;
        pmElem.innerText = `อัตรากำไรสุทธิ: ${pm.toFixed(1)}%`;
        pmElem.className = `text-[10px] mt-0.5 font-bold ${pm >= 0 ? 'text-emerald-500' : 'text-rose-500'}`;
      } else {
        pmElem.innerText = '';
      }

      document.getElementById('kpiGoalPercent').innerText = `${goalAchievedPercent.toFixed(1)}%`;
      document.getElementById('kpiGoalProgressBar').style.width = `${Math.min(goalAchievedPercent, 100)}%`;

      const goalBadge = document.getElementById('kpiGoalBadge');
      if (goalAchievedPercent >= 100) {
        goalBadge.innerText = 'ทะลุเป้า';
        goalBadge.className = 'px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-700';
      } else {
        goalBadge.innerText = 'กำลังทำตามเป้า';
        goalBadge.className = 'px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-800';
      }

      const profitElem = document.getElementById('kpiNetProfit');
      const profitIcon = document.getElementById('kpiProfitIcon');
      if (netProfit >= 0) {
        profitElem.className = "text-lg sm:text-2xl font-bold text-emerald-600";
        profitIcon.className = "fa-solid fa-arrow-trend-up text-emerald-500 text-sm";
      } else {
        profitElem.className = "text-lg sm:text-2xl font-bold text-rose-600";
        profitIcon.className = "fa-solid fa-arrow-trend-down text-rose-500 text-sm";
      }

      const ratioText = document.getElementById('profitExpenseRatioText');
      const ratioDesc = document.getElementById('profitExpenseRatioDesc');
      const ratioBar = document.getElementById('profitExpenseBar');

      if (totalExpense > 0) {
        const pct = (netProfit / totalExpense) * 100;
        ratioText.innerText = `${pct.toFixed(1)}%`;
        ratioText.className = `text-4xl font-extrabold ${pct >= 0 ? 'text-emerald-500' : 'text-rose-500'} mb-1`;
        ratioDesc.innerHTML = pct >= 0 ? `กำไร <strong>${pct.toFixed(1)}%</strong> ของต้นทุน` : `ขาดทุน <strong>${Math.abs(pct).toFixed(1)}%</strong> ของต้นทุน`;
        ratioBar.style.width = `${Math.min(Math.abs(pct), 100)}%`;
        ratioBar.className = pct >= 0 ? "bg-emerald-500 h-2 rounded-full transition-all duration-700" : "bg-rose-500 h-2 rounded-full transition-all duration-700";
      } else {
        ratioText.innerText = "0%";
        ratioText.className = "text-4xl font-extrabold text-gray-300 mb-1";
        ratioDesc.innerText = "ยังไม่มีรายจ่าย";
        ratioBar.style.width = "0%";
      }

      renderFullMonthCalendar();
      renderTransactionHistory(filteredTx);
      renderCategoryReport(currentReportTab);
    }

    window.safeCalculate = function(expr) {
      if (!expr) return 0;
      // Support × (U+00D7), x/X, ÷ as multiply/divide
      let cleaned = String(expr)
        .replace(/×/g, '*')
        .replace(/x/gi, '*')
        .replace(/÷/g, '/')
        .replace(/\s+/g, '');
      if (!/^[0-9+\-*/().]+$/.test(cleaned)) return NaN;
      try {
        let rawTokens = cleaned.match(/(\d+(?:\.\d+)?|[+\-*/()])/g);
        if (!rawTokens) return NaN;

        // Fold unary +/- into the following number (start of expr, after operator, or after '(')
        let tokens = [];
        for (let i = 0; i < rawTokens.length; i++) {
          const t = rawTokens[i];
          if ((t === '-' || t === '+') &&
              (tokens.length === 0 ||
               '+-*/('.includes(String(tokens[tokens.length - 1])))) {
            const next = rawTokens[i + 1];
            if (next && !isNaN(next)) {
              tokens.push(parseFloat((t === '-' ? '-' : '') + next));
              i++;
              continue;
            }
          }
          if (!isNaN(t)) tokens.push(parseFloat(t));
          else tokens.push(t);
        }

        let outputQueue = [];
        let operatorStack = [];
        let precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };

        for (let token of tokens) {
          if (typeof token === 'number') {
            outputQueue.push(token);
          } else if ('+-*/'.includes(token)) {
            while (
              operatorStack.length > 0 &&
              '+-*/'.includes(operatorStack[operatorStack.length - 1]) &&
              precedence[operatorStack[operatorStack.length - 1]] >= precedence[token]
            ) {
              outputQueue.push(operatorStack.pop());
            }
            operatorStack.push(token);
          } else if (token === '(') {
            operatorStack.push(token);
          } else if (token === ')') {
            while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
              outputQueue.push(operatorStack.pop());
            }
            operatorStack.pop();
          }
        }
        while (operatorStack.length > 0) {
          outputQueue.push(operatorStack.pop());
        }

        let evalStack = [];
        for (let token of outputQueue) {
          if (typeof token === 'number') {
            evalStack.push(token);
          } else {
            let b = evalStack.pop();
            let a = evalStack.pop();
            if (a === undefined || b === undefined) return NaN;
            if (token === '+') evalStack.push(a + b);
            if (token === '-') evalStack.push(a - b);
            if (token === '*') evalStack.push(a * b);
            if (token === '/') {
              if (b === 0) return NaN;
              evalStack.push(a / b);
            }
          }
        }
        return evalStack.length === 1 ? evalStack[0] : NaN;
      } catch (e) {
        return NaN;
      }
    };

    function appendMathSymbol(symbol) {
      document.getElementById('txAmount').value += symbol;
      document.getElementById('txAmount').focus();
    }

    function clearMathAmount() {
      document.getElementById('txAmount').value = '';
      document.getElementById('txAmount').focus();
    }

    function calculateAmount() {
      const inputField = document.getElementById('txAmount');
      let val = inputField.value.trim();
      if(!val) return;
      const result = window.safeCalculate(val);
      if (!isNaN(result) && isFinite(result)) {
        inputField.value = Number(Math.max(0, result)).toFixed(2);
      }
    }
