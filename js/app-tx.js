/* ============================================================
 * STone — app-tx.js
 * Transaction modal CRUD, card detail, goals, history/calendar, export/import
 * Split from js/app.js (behavior unchanged; window.* API kept)
 * Load order: storage → app-core → app-dashboard → app-tx →
 *             app-categories → app-features → reports → firebase
 * ============================================================ */


    window.openTransactionModal = function(type, editId = null) {
      document.getElementById('txType').value = type;
      document.getElementById('editTxId').value = editId || '';

      const modalHeader = document.getElementById('modalHeaderBg');
      modalHeader.className = type === 'income' ? "p-4 text-white flex justify-between items-center bg-emerald-600" : "p-4 text-white flex justify-between items-center bg-rose-600";
      document.getElementById('modalTitle').innerHTML = type === 'income' ? `<i class="fa-solid fa-plus-circle mr-2"></i>บันทึกรายรับ` : `<i class="fa-solid fa-minus-circle mr-2"></i>บันทึกรายจ่าย`;

      const catSelect = document.getElementById('txCategory');
      catSelect.innerHTML = '';
      window.appData = window.sanitizeAppData(window.appData);
      const catList = (window.appData.categories && window.appData.categories[type]) ? window.appData.categories[type] : [];
      if (catList.length === 0) {
        alert('ไม่พบหมวดหมู่ กรุณาเพิ่มหมวดหมู่ก่อนในแท็บตั้งค่า');
        return;
      }
      catList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.innerText = c.name;
        catSelect.appendChild(opt);
      });

      document.getElementById('txDate').value = getLocalYYYYMMDD();
      document.getElementById('txTime').value = new Date().toTimeString().split(' ')[0].substring(0, 5);
      document.getElementById('txAmount').value = '';
      document.getElementById('txNote').value = '';
      _editTxIdTemp = null;

      if (editId) {
        const tx = window.appData.transactions.find(t => t.id === editId);
        if (tx) {
          _editTxIdTemp = tx;
          document.getElementById('txDate').value = tx.date;
          document.getElementById('txTime').value = tx.time;
          catSelect.value = tx.category;
          document.getElementById('txAmount').value = tx.amount;
          document.getElementById('txNote').value = tx.note || '';
        }
      }

      onCategoryChange();
      document.getElementById('transactionModal').classList.remove('hidden');
    }

    window.onCategoryChange = function() {
      const type = document.getElementById('txType').value;
      const catSelect = document.getElementById('txCategory');
      const subContainer = document.getElementById('subCatContainer');
      const nestedContainer = document.getElementById('nestedSubLevels');
      const chkContainer = document.getElementById('multiMaterialContainer');
      const chkList = document.getElementById('materialsChecklist');
      const chkLabel = document.getElementById('checklistLabel');

      const catObj = (window.appData.categories[type] || []).find(c => c.name === catSelect.value);
      if (subContainer) subContainer.classList.add('hidden');
      if (chkContainer) chkContainer.classList.add('hidden');
      if (nestedContainer) nestedContainer.innerHTML = '';

      if (!catObj) return;

      const isMaterial = catObj.flags && catObj.flags.isMaterialCategory;
      const isEquipment = catObj.flags && catObj.flags.isEquipmentCategory;

      if (isMaterial || isEquipment) {
        chkContainer.classList.remove('hidden');
        chkLabel.innerHTML = isMaterial
          ? `<i class="fa-solid fa-basket-shopping text-brand-500 mr-1"></i> เลือกวัตถุดิบ:`
          : `<i class="fa-solid fa-toolbox text-brand-500 mr-1"></i> เลือกอุปกรณ์:`;
        chkList.innerHTML = '';

        const sourceList = isMaterial ? window.appData.materials : window.appData.equipments;
        let existingItems = [];
        if (_editTxIdTemp && _editTxIdTemp.subCategory) {
          // multi-select uses ", " join — do not split nested path sep
          existingItems = _editTxIdTemp.subCategory.split(', ').map(s => s.trim()).filter(Boolean);
        }

        (sourceList || []).forEach((item) => {
          const checked = existingItems.includes(item) ? 'checked' : '';
          chkList.innerHTML += `
            <label class="flex items-center space-x-2 bg-white p-2 rounded-xl border border-gray-100 shadow-sm cursor-pointer hover:border-brand-300">
              <input type="checkbox" name="matCheck" value="${escapeAttr(String(item))}" class="text-brand-500 focus:ring-brand-500 rounded" ${checked}>
              <span class="text-[11px] text-gray-700 font-medium">${escapeHTML(String(item))}</span>
            </label>`;
        });
        return;
      }

      if (window.categoryHasSubs(catObj)) {
        subContainer.classList.remove('hidden');
        // Pre-fill path from edit if present
        let prePath = [];
        if (_editTxIdTemp && _editTxIdTemp.subCategory && _editTxIdTemp.subCategory.indexOf(', ') === -1) {
          prePath = String(_editTxIdTemp.subCategory).split(window.CAT_PATH_SEP).map(s => s.trim()).filter(Boolean);
        } else if (_editTxIdTemp && _editTxIdTemp.subCategory) {
          // legacy single sub (no path sep, no multi comma list treated as path)
          const single = String(_editTxIdTemp.subCategory).trim();
          if (single && single.indexOf(',') === -1) prePath = [single];
        }
        window.renderNestedSubSelects(catObj.subs, prePath, 0);
      }
    };

    /** Cascading selects for nested category path (max depth under main cat). */
    window.renderNestedSubSelects = function(rootSubs, prePath, fromLevel) {
      const nestedContainer = document.getElementById('nestedSubLevels');
      if (!nestedContainer) return;
      // Remove levels from fromLevel onward
      const existing = nestedContainer.querySelectorAll('[data-sub-level]');
      existing.forEach(function(el) {
        const lv = Number(el.getAttribute('data-sub-level'));
        if (lv >= fromLevel) el.remove();
      });

      // Build path selected so far from levels 0..fromLevel-1
      const pathSoFar = [];
      for (let lv = 0; lv < fromLevel; lv++) {
        const sel = nestedContainer.querySelector('select[data-sub-level="' + lv + '"]');
        if (sel && sel.value) pathSoFar.push(sel.value);
        else break;
      }

      const children = window.getChildrenAtPath(rootSubs, pathSoFar);
      if (!children || children.length === 0) return;

      // Depth limit: fromLevel is 0-based under main cat; max levels under main = MAX_CAT_DEPTH - 1
      if (fromLevel >= window.MAX_CAT_DEPTH - 1) return;

      const wrap = document.createElement('div');
      wrap.setAttribute('data-sub-level', String(fromLevel));
      wrap.className = 'mb-1.5';
      const label = document.createElement('label');
      label.className = 'block text-[11px] font-medium text-gray-600 mb-0.5';
      label.textContent = fromLevel === 0 ? 'รายการย่อย' : ('ชั้นที่ ' + (fromLevel + 2));
      const sel = document.createElement('select');
      sel.setAttribute('data-sub-level', String(fromLevel));
      sel.className = 'w-full border border-gray-300 rounded-xl px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm';
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = '— เลือก —';
      sel.appendChild(emptyOpt);
      children.forEach(function(node) {
        const opt = document.createElement('option');
        opt.value = window.catNodeName(node);
        opt.textContent = window.catNodeName(node);
        sel.appendChild(opt);
      });
      if (prePath && prePath[fromLevel]) {
        sel.value = prePath[fromLevel];
      }
      sel.addEventListener('change', function() {
        const type = document.getElementById('txType').value;
        const catSelect = document.getElementById('txCategory');
        const catObj = (window.appData.categories[type] || []).find(c => c.name === catSelect.value);
        if (!catObj) return;
        window.renderNestedSubSelects(catObj.subs, null, fromLevel + 1);
      });
      wrap.appendChild(label);
      wrap.appendChild(sel);
      nestedContainer.appendChild(wrap);

      // If prePath continues, cascade further
      if (prePath && prePath[fromLevel]) {
        window.renderNestedSubSelects(rootSubs, prePath, fromLevel + 1);
      } else if (sel.value) {
        window.renderNestedSubSelects(rootSubs, null, fromLevel + 1);
      }
    };

    window.collectNestedSubPath = function() {
      const nestedContainer = document.getElementById('nestedSubLevels');
      if (!nestedContainer) return '';
      const path = [];
      const selects = nestedContainer.querySelectorAll('select[data-sub-level]');
      const ordered = Array.from(selects).sort(function(a, b) {
        return Number(a.getAttribute('data-sub-level')) - Number(b.getAttribute('data-sub-level'));
      });
      for (let i = 0; i < ordered.length; i++) {
        const v = ordered[i].value;
        if (!v) break;
        path.push(v);
      }
      return path.join(window.CAT_PATH_SEP);
    };

    /** Select / deselect all multi-select checklist items (materials or equipments). */
    window.toggleAllMaterials = function(checked) {
      document.querySelectorAll('input[name="matCheck"]').forEach(function(el) {
        el.checked = !!checked;
      });
    };

    window.closeTransactionModal = function() {
      document.getElementById('transactionModal').classList.add('hidden');
    };

    window.handleFormSubmit = async function(e) {
      e.preventDefault();
      // Wait for store hydrate so we never persist against empty/partial state on cold start
      if (typeof window.whenStoreReady === 'function') {
        try { await window.whenStoreReady(); } catch (w) { /* proceed with best effort */ }
      }
      calculateAmount();
      const amountVal = Number(document.getElementById('txAmount').value);
      if (isNaN(amountVal) || amountVal <= 0) {
        alert('กรุณาระบุจำนวนเงินให้ถูกต้องและมากกว่า 0 บาท');
        return;
      }

      const type = document.getElementById('txType').value;
      const date = document.getElementById('txDate').value;
      const time = document.getElementById('txTime').value;
      const category = document.getElementById('txCategory').value;
      const note = document.getElementById('txNote').value.trim();
      const editId = document.getElementById('editTxId').value;

      // Validate date format before save
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        alert('กรุณาเลือกวันที่ให้ถูกต้อง');
        return;
      }

      const catObj = (window.appData.categories && window.appData.categories[type])
        ? window.appData.categories[type].find(c => c.name === category)
        : null;
      let subCategory = '';

      if (catObj && (catObj.flags?.isMaterialCategory || catObj.flags?.isEquipmentCategory)) {
        const checked = Array.from(document.querySelectorAll('input[name="matCheck"]:checked')).map(el => el.value);
        subCategory = checked.join(', ');
      } else if (catObj && window.categoryHasSubs(catObj)) {
        // Nested path (or single level) from cascading selects
        subCategory = window.collectNestedSubPath();
        // Fallback to legacy single select if present
        if (!subCategory) {
          const legacy = document.getElementById('txSubCategory');
          if (legacy && legacy.value) subCategory = legacy.value;
        }
      }

      const txObj = {
        id: editId || (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2))),
        type, date, time, category, subCategory, amount: window.roundMoney(amountVal), note
      };

      if(editId) {
        const idx = window.appData.transactions.findIndex(t => t.id === editId);
        if(idx > -1) window.appData.transactions[idx] = txObj;
        else window.appData.transactions.push(txObj);
      } else {
        window.appData.transactions.push(txObj);
      }

      // Save local: single tx to IDB + meta (no giant LS blob)
      try {
        if (window.SomtumStore && SomtumStore.putTx) {
          await SomtumStore.putTx(txObj);
          await SomtumStore.markDirty(txObj.id);
          await SomtumStore.persistAppState(window.appData, { writeAllTx: false });
        }
        window.saveLocalOnly();
      } catch (err) {
        console.error(err);
        window.showToast('บันทึกลงเครื่องล้มเหลว (ที่เก็บข้อมูลอาจเต็ม)', 'error');
        return;
      }

      closeTransactionModal();

      // Keep full in-memory list (old + new). Flag tells ensureTransactionsLoaded
      // not to replace with a partial IDB/cloud result right after save.
      window.__preferMemoryTx = true;
      window.__txCacheLoaded = true;
      try {
        if (typeof window.refreshDashboard === 'function') {
          await window.refreshDashboard();
        }
      } catch (uiErr) {
        console.warn('refreshDashboard after save', uiErr);
      }

      // Then try cloud (incremental — single doc)
      try {
        await window.saveTransactionToFirestore(txObj);
        window.showToast(editId ? 'อัปเดตข้อมูลแล้ว' : 'บันทึกข้อมูลเรียบร้อย');
      } catch (err) {
        console.error(err);
        window.showToast('บันทึกลงเครื่องแล้ว แต่ซิงค์ Cloud ล้มเหลว', 'error');
      }

      // Refresh again after cloud write settles (snapshot may have been skipped while pending)
      try {
        if (typeof window.refreshDashboard === 'function') {
          await window.refreshDashboard();
        }
      } catch (uiErr2) { /* */ }

      if(!document.getElementById('calendarDayModal').classList.contains('hidden')) {
        openCalendarDayModal(selectedCalendarDay);
      }
      if(!document.getElementById('cardDetailModal').classList.contains('hidden') && lastCardDetailType) {
        openCardDetailModal(lastCardDetailType);
      }
    }

    window.editTransaction = async function(id) {
      let tx = (window.appData.transactions || []).find(t => t.id === id);
      if (!tx && window.SomtumStore && SomtumStore.getTx) {
        try { tx = await SomtumStore.getTx(id); } catch (e) { console.warn(e); }
      }
      if (tx) openTransactionModal(tx.type, id);
      else window.showToast('ไม่พบรายการ', 'error');
    }

    window.deleteTransaction = function(id) {
      window.showConfirmModal("ยืนยันการลบ", "คุณต้องการลบรายการนี้ใช่หรือไม่?", async () => {
        window.appData.transactions = window.appData.transactions.filter(t => t.id !== id);
        try {
          if (window.SomtumStore && SomtumStore.markDeleted) {
            await SomtumStore.markDeleted(id);
          }
          window.saveLocalOnly();
        } catch (err) {
          window.showToast('ลบในเครื่องล้มเหลว', 'error');
          return;
        }
        window.refreshDashboard();
        if(!document.getElementById('calendarDayModal').classList.contains('hidden')) {
          openCalendarDayModal(selectedCalendarDay);
        }
        if(!document.getElementById('cardDetailModal').classList.contains('hidden') && lastCardDetailType) {
          openCardDetailModal(lastCardDetailType);
        }
        try {
          await window.deleteTransactionFromFirestore(id);
          window.showToast('ลบรายการเรียบร้อย');
        } catch (err) {
          console.error(err);
          window.showToast('ลบในเครื่องแล้ว แต่ซิงค์ Cloud ล้มเหลว', 'error');
        }
      });
    }

    window.openCardDetailModal = function(cardType) {
      lastCardDetailType = cardType;
      const modal = document.getElementById('cardDetailModal');
      const itemsContainer = document.getElementById('cardDetailItems');
      const header = document.getElementById('cardDetailHeader');
      const title = document.getElementById('cardDetailTitle');
      // Match KPI totals: time filter only (ignore history search filters)
      const filteredTx = window.getTimeFilteredTransactions();
      let listData = [];
      let totalAmount = 0;

      if (cardType === 'income') {
        listData = filteredTx.filter(t => t.type === 'income');
        header.className = "p-4 text-white flex justify-between items-center bg-emerald-600";
        title.innerHTML = `<i class="fa-solid fa-wallet mr-2"></i>รายละเอียดรายรับ`;
      } else if (cardType === 'expense') {
        listData = filteredTx.filter(t => t.type === 'expense');
        header.className = "p-4 text-white flex justify-between items-center bg-rose-600";
        title.innerHTML = `<i class="fa-solid fa-receipt mr-2"></i>รายละเอียดรายจ่าย`;
      } else {
        listData = filteredTx;
        header.className = "p-4 text-white flex justify-between items-center bg-brand-600";
        title.innerHTML = `<i class="fa-solid fa-chart-line mr-2"></i>รายละเอียดกำไร/ขาดทุน`;
      }

      listData.forEach(t => totalAmount = window.roundMoney(totalAmount + window.roundMoney(t.amount)));

      document.getElementById('cardDetailSummary').innerHTML = `
        <div>พบข้อมูลทั้งหมด <strong>${listData.length}</strong> รายการ (ตามตัวกรองเวลาปัจจุบัน)</div>
        <div class="mt-1 text-base ${cardType === 'expense' ? 'text-rose-600' : (cardType === 'income' ? 'text-emerald-600' : 'text-brand-600')}">
          รวม ${cardType === 'expense' ? '-' : (cardType === 'income' ? '+' : '')}฿${totalAmount.toLocaleString('th-TH', {minimumFractionDigits: 2})}
        </div>`;
      window.renderDrillDownAccordion(listData, itemsContainer, 'kpiModal');
      modal.classList.remove('hidden');
    }

    window.setGoalModeUI = function(mode) {
      const pctBox = document.getElementById('goalModePercentBox');
      const amtBox = document.getElementById('goalModeAmountBox');
      const btnPct = document.getElementById('goalModeBtnPercent');
      const btnAmt = document.getElementById('goalModeBtnAmount');
      if (!pctBox || !amtBox) return;
      const isPct = mode === 'percent';
      pctBox.classList.toggle('hidden', !isPct);
      amtBox.classList.toggle('hidden', isPct);
      if (btnPct && btnAmt) {
        btnPct.className = isPct
          ? 'flex-1 py-2 rounded-xl text-xs font-bold bg-brand-600 text-white'
          : 'flex-1 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
        btnAmt.className = !isPct
          ? 'flex-1 py-2 rounded-xl text-xs font-bold bg-brand-600 text-white'
          : 'flex-1 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
      }
      window.updateGoalPreview();
    };

    window.updateGoalPreview = function() {
      const filteredTx = window.getTimeFilteredTransactions();
      const gSums = window.sumIncomeExpense(filteredTx);
      const totalIncome = gSums.income;
      const totalExpense = gSums.expense;
      const el = document.getElementById('goalCalculationBreakdown');
      if (!el) return;

      const modePct = document.getElementById('goalModePercentBox') &&
        !document.getElementById('goalModePercentBox').classList.contains('hidden');

      let lines = [];
      lines.push(`<div class="text-[11px] text-gray-500">ช่วงที่เลือก: รายรับ ฿${totalIncome.toLocaleString('th-TH', {minimumFractionDigits: 2})} · รายจ่าย ฿${totalExpense.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>`);

      if (modePct) {
        const raw = (document.getElementById('customGoalPercentInput') || {}).value;
        const pct = Number(raw);
        const usePct = (!isNaN(pct) && pct >= 0) ? pct : 60;
        const goal = totalExpense > 0
          ? window.roundMoney(totalExpense * (1 + usePct / 100))
          : (totalIncome > 0 ? totalIncome : 1000);
        lines.push(`<div class="font-bold text-gray-800 dark:text-gray-100 text-sm mt-1">เป้าหมาย ≈ ฿${goal.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>`);
        lines.push(`<div class="text-[11px] text-gray-600 dark:text-gray-300">มาร์กอัป +${usePct}% บนรายจ่าย (รายจ่าย × ${(1 + usePct / 100).toFixed(2)})</div>`);
        if (totalExpense <= 0) {
          lines.push(`<div class="text-[11px] text-amber-600">ยังไม่มีรายจ่ายในช่วงนี้ — ใช้ยอดสำรองชั่วคราว</div>`);
        }
      } else {
        const raw = (document.getElementById('customGoalInput') || {}).value;
        const val = Number(raw);
        if (!raw || isNaN(val) || val <= 0) {
          const auto = window.resolveTargetGoal(totalExpense, totalIncome);
          lines.push(`<div class="text-[11px] text-gray-500 mt-1">ใส่จำนวนเงินเพื่อดูว่าคิดเป็นกี่ % ของรายจ่าย</div>`);
          lines.push(`<div class="text-[11px]">เป้าปัจจุบันในระบบ: ฿${auto.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>`);
        } else {
          const goal = window.roundMoney(val);
          lines.push(`<div class="font-bold text-gray-800 dark:text-gray-100 text-sm mt-1">เป้าหมาย ฿${goal.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>`);
          if (totalExpense > 0) {
            const ofExp = (goal / totalExpense) * 100;
            const markup = ((goal / totalExpense) - 1) * 100;
            lines.push(`<div class="text-[11px] text-gray-600 dark:text-gray-300">คิดเป็น <b>${ofExp.toFixed(1)}%</b> ของรายจ่าย</div>`);
            lines.push(`<div class="text-[11px] text-gray-600 dark:text-gray-300">มาร์กอัป <b>${markup >= 0 ? '+' : ''}${markup.toFixed(1)}%</b> จากรายจ่าย</div>`);
          } else {
            lines.push(`<div class="text-[11px] text-amber-600">ยังไม่มีรายจ่ายในช่วงนี้ — ยังเทียบ % ไม่ได้</div>`);
          }
          if (totalIncome > 0) {
            const prog = (totalIncome / goal) * 100;
            lines.push(`<div class="text-[11px] text-brand-600 mt-1">ความคืบหน้าตอนนี้ ${prog.toFixed(1)}% ของเป้านี้</div>`);
          }
        }
      }
      el.innerHTML = lines.join('');
    };

    window.openGoalDetailModal = function() {
      const hasAmt = window.appData.customGoal && window.appData.customGoal > 0;
      const hasPct = window.appData.customGoalPercent !== null && window.appData.customGoalPercent !== undefined;
      const mode = hasAmt ? 'amount' : 'percent';
      const pctInput = document.getElementById('customGoalPercentInput');
      const amtInput = document.getElementById('customGoalInput');
      if (pctInput) {
        pctInput.value = hasPct ? window.appData.customGoalPercent
          : (hasAmt ? '' : 60);
      }
      if (amtInput) amtInput.value = hasAmt ? window.appData.customGoal : '';
      window.setGoalModeUI(mode);
      document.getElementById('goalDetailModal').classList.remove('hidden');
    };

    window.saveCustomGoal = function() {
      const modePct = document.getElementById('goalModePercentBox') &&
        !document.getElementById('goalModePercentBox').classList.contains('hidden');

      if (modePct) {
        const raw = document.getElementById('customGoalPercentInput').value.trim();
        const pct = Number(raw);
        if (raw === '' || isNaN(pct) || pct < 0) {
          alert('กรุณาใส่เปอร์เซ็นต์มาร์กอัปที่ถูกต้อง (เช่น 60)');
          return;
        }
        window.appData.customGoalPercent = pct;
        window.appData.customGoal = null; // โหมด % ชนะโหมดจำนวน
      } else {
        const raw = document.getElementById('customGoalInput').value.trim();
        const val = Number(raw);
        if (!raw || isNaN(val) || val <= 0) {
          alert('กรุณาใส่เป้าหมายที่เป็นตัวเลขมากกว่า 0');
          return;
        }
        window.appData.customGoal = window.roundMoney(val);
        window.appData.customGoalPercent = null;
      }
      window.syncDataToCloud(true);
      window.refreshDashboard();
      window.showToast('ตั้งเป้าหมายสำเร็จ');
      document.getElementById('goalDetailModal').classList.add('hidden');
    };

    window.clearCustomGoal = function() {
      window.appData.customGoal = null;
      window.appData.customGoalPercent = null;
      const pctInput = document.getElementById('customGoalPercentInput');
      const amtInput = document.getElementById('customGoalInput');
      if (pctInput) pctInput.value = '60';
      if (amtInput) amtInput.value = '';
      window.setGoalModeUI('percent');
      window.syncDataToCloud(true);
      window.refreshDashboard();
      window.showToast('กลับไปใช้เป้าหมายสูตรปกติ (+60%)');
    };

    function renderTransactionHistory(txList) {
      const listElem = document.getElementById('transactionList');
      document.getElementById('transactionCount').innerText = `${txList.length} รายการ`;
      listElem.innerHTML = '';

      if (txList.length === 0) {
        document.getElementById('loadMoreHistoryContainer').classList.add('hidden');
        return listElem.innerHTML = `<div class="text-center py-6 text-gray-400 text-xs">ไม่พบรายการ</div>`;
      }

      // Group by date first so day totals are never partial
      const dateGrouped = {};
      txList.forEach(tx => {
        const d = tx.date || 'ไม่ระบุวันที่';
        if (!dateGrouped[d]) dateGrouped[d] = { inc: 0, exp: 0, items: [] };
        if (tx.type === 'income') dateGrouped[d].inc = window.roundMoney(dateGrouped[d].inc + window.roundMoney(tx.amount));
        if (tx.type === 'expense') dateGrouped[d].exp = window.roundMoney(dateGrouped[d].exp + window.roundMoney(tx.amount));
        dateGrouped[d].items.push(tx);
      });

      const sortedDates = Object.keys(dateGrouped).sort((a, b) => new Date(b) - new Date(a));
      // Take complete days until we roughly reach the display limit
      let shownCount = 0;
      const visibleDates = [];
      for (const d of sortedDates) {
        if (shownCount >= historyDisplayLimit && visibleDates.length > 0) break;
        visibleDates.push(d);
        shownCount += dateGrouped[d].items.length;
      }
      if (visibleDates.length < sortedDates.length) {
        document.getElementById('loadMoreHistoryContainer').classList.remove('hidden');
      } else {
        document.getElementById('loadMoreHistoryContainer').classList.add('hidden');
      }

      visibleDates.forEach((dStr, dIdx) => {
        const dayData = dateGrouped[dStr];
        const net = dayData.inc - dayData.exp;
        const containerId = `history-date-container-${dIdx}`;
        const bodyId = `history-date-body-${dIdx}`;

        const card = document.createElement('div');
        card.className = "bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xs overflow-hidden my-2";
        card.innerHTML = `
          <div class="p-3 bg-gray-50/80 dark:bg-gray-700/50 hover:bg-gray-100/80 dark:hover:bg-gray-700 cursor-pointer transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2" onclick="toggleSubDetail('${bodyId}')">
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-calendar-day text-brand-600"></i>
              <span class="font-bold text-xs text-gray-800 dark:text-gray-100">วันที่ ${dStr}</span>
              <span class="text-[10px] bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-200 px-2 py-0.5 rounded-full font-medium">${dayData.items.length} รายการ</span>
            </div>
            <div class="flex items-center gap-3 text-[11px]">
              <span class="text-emerald-600 font-semibold">+฿${dayData.inc.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
              <span class="text-rose-600 font-semibold">-฿${dayData.exp.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
              <span class="font-bold ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}">สุทธิ ฿${net.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
              <i class="fa-solid fa-caret-down text-gray-400 ml-1 transition-transform" id="icon-${bodyId}"></i>
            </div>
          </div>
          <div id="${bodyId}" class="hidden p-2 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
            <div id="${containerId}"></div>
          </div>
        `;
        listElem.appendChild(card);
        window.renderDrillDownAccordion(dayData.items, containerId, `hist-${dIdx}`);
      });
    }

    window.loadMoreHistory = function() {
      historyDisplayLimit += 50;
      window.refreshDashboard();
    };

    window.loadMoreReport = function() {
      reportDisplayLimit += 50;
      window.renderCategoryReport(currentReportTab);
    };

    window.exportDataToCSV = function() {
      const txs = window.getFilteredTransactions();
      if(!txs || txs.length === 0) {
        alert('ไม่มีข้อมูลบัญชีตามช่วงเวลาหรือเงื่อนไขที่เลือก');
        return;
      }
      // Helper to neutralize CSV formula injection and escape quotes
      const safe = (val) => {
        let s = String(val == null ? '' : val).replace(/"/g, '""');
        if (/^[=+\-@]/.test(s)) s = "'" + s; // prevent formula injection
        return s;
      };
      let csv = "\uFEFFวันที่,เวลา,ประเภท,หมวดหมู่,รายการย่อย,จำนวนเงิน(บาท),โน้ต\n";
      txs.forEach(t => {
        const typeStr = t.type === 'income' ? 'รายรับ' : 'รายจ่าย';
        csv += `"${safe(t.date)}","${safe(t.time || '')}","${safe(typeStr)}","${safe(t.category)}","${safe(t.subCategory || '')}","${safe(t.amount)}","${safe(t.note || '')}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stone-report-${window.getLocalYYYYMMDD()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.showToast('ส่งออก CSV เรียบร้อยแล้ว');
    };

    window.exportDataToJSON = async function() {
      let payload = window.appData;
      try {
        if (window.SomtumStore && SomtumStore.buildLegacyAppData) {
          payload = await SomtumStore.buildLegacyAppData(window.appData);
        }
      } catch (e) { console.warn('export buildLegacy', e); }
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `stone-backup-${window.getLocalYYYYMMDD()}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      if (typeof window.markWeeklyBackupDone === 'function') window.markWeeklyBackupDone();
      window.showToast('สำรองข้อมูล JSON เรียบร้อย');
    }

    window.importDataFromJSON = function(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const parsed = JSON.parse(e.target.result);
          if (!parsed.transactions || !parsed.categories) {
            alert('ไฟล์ JSON ไม่ถูกต้องตามโครงสร้างแอป');
            return;
          }
          window.showConfirmModal("ยืนยันการนำเข้าข้อมูล", "ข้อมูลใหม่จะถูกนำมาแทนที่ข้อมูลปัจจุบัน คุณต้องการดำเนินการต่อหรือไม่?", async () => {
            window.showToast("กำลังนำเข้าข้อมูล...");
            const newData = window.sanitizeAppData(parsed);
            const ownerUid = window.currentUser ? window.currentUser.uid : null;
            try {
              // CRITICAL: wipe old IDB txs first — persistAppState only PUTs, never deletes orphans
              if (window.SomtumStore && SomtumStore.clearAllUserData) {
                await SomtumStore.clearAllUserData();
              }
              if (ownerUid) SomtumStore.setItem('somtumDataOwnerUid', ownerUid);
              window.appData = newData;
              if (window.SomtumStore && SomtumStore.persistAppState) {
                await SomtumStore.persistAppState(newData, { writeAllTx: true });
                if (SomtumStore.markDirty) {
                  for (const tx of (newData.transactions || [])) {
                    if (tx && tx.id) await SomtumStore.markDirty(tx.id);
                  }
                }
                if (SomtumStore.markMetaDirty) SomtumStore.markMetaDirty();
              }
              // Also keep a legacy blob only if small enough (handled inside setItem)
              try {
                SomtumStore.setItem('somtumAppData', JSON.stringify(newData));
              } catch (e2) { /* quota ok — IDB is source of truth */ }
              window.__txCacheLoaded = false;
              window.__loadedRange = { start: null, end: null };
              if (typeof window.ensureTransactionsLoaded === 'function') {
                await window.ensureTransactionsLoaded(true);
              }
              window.saveLocalOnly();
            } catch (e) {
              console.error(e);
              window.showToast('บันทึกลงเครื่องล้มเหลว', 'error');
              return;
            }

            if (window.currentUser && window.db) {
              try {
                // 1) Write settings first
                const settingsRef = window.doc(window.db, "users", window.currentUser.uid, "meta", "settings");
                await window.setDoc(settingsRef, {
                  categories: newData.categories,
                  materials: newData.materials,
                  equipments: newData.equipments,
                  customGoal: newData.customGoal,
                  customGoalPercent: newData.customGoalPercent,
                  updatedAt: new Date().toISOString()
                }, { merge: true });

                // 2) Write all new transactions first (safer than delete-first)
                const newIds = new Set((newData.transactions || []).map(t => t.id));
                let batch = window.writeBatch(window.db);
                let count = 0;
                for (const tx of (newData.transactions || [])) {
                  const txRef = window.doc(window.db, "users", window.currentUser.uid, "transactions", tx.id);
                  batch.set(txRef, tx);
                  count++;
                  if (count >= 400) { await batch.commit(); batch = window.writeBatch(window.db); count = 0; }
                }
                if (count > 0) await batch.commit();

                // 3) Delete old transactions that are not in the new set
                const txCollRef = window.collection(window.db, "users", window.currentUser.uid, "transactions");
                const snap = await window.getDocs(txCollRef);
                batch = window.writeBatch(window.db);
                count = 0;
                for (const d of snap.docs) {
                  if (!newIds.has(d.id)) {
                    batch.delete(d.ref);
                    count++;
                    if (count >= 400) { await batch.commit(); batch = window.writeBatch(window.db); count = 0; }
                  }
                }
                if (count > 0) await batch.commit();

                window.updateSyncUI(true);
                window.showToast('นำเข้าข้อมูลสำเร็จ');
              } catch (err) {
                console.error("Import cloud error:", err);
                window.showToast('นำเข้าในเครื่องสำเร็จ แต่ซิงค์ Cloud ล้มเหลว กรุณากดปุ่มซิงค์', 'error');
              }
            } else {
              window.showToast('นำเข้าข้อมูลสำเร็จ (บันทึกในเครื่อง)');
            }
            window.refreshDashboard();
          });
        } catch (err) {
          alert('เกิดข้อผิดพลาดในการอ่านไฟล์ JSON');
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    };

