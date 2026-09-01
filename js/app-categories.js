/* ============================================================
 * STone — app-categories.js
 * Tabs, category report, category manager, materials/equipments, reset all data
 * Split from js/app.js (behavior unchanged; window.* API kept)
 * Load order: storage → app-core → app-dashboard → app-tx →
 *             app-categories → app-features → reports → firebase
 * ============================================================ */

    window.switchTab = function(tabKey) {
      ['history', 'categoryReport', 'categoryManager'].forEach(k => {
        document.getElementById(`tabContent-${k}`).classList.add('hidden');
        document.getElementById(`tab-${k}`).className = "flex-1 py-3 text-xs font-bold text-center border-b-2 border-transparent text-gray-500";
      });
      document.getElementById(`tabContent-${tabKey}`).classList.remove('hidden');
      document.getElementById(`tab-${tabKey}`).className = "flex-1 py-3 text-xs font-bold text-center border-b-2 border-brand-500 text-brand-600";

      if (tabKey === 'categoryManager') {
        window.renderCategoryTree();
        window.renderMaterialTags();
      }
    }

    window.renderCategoryReport = function(type) {
      currentReportTab = type || currentReportTab;
      const activeType = currentReportTab;
      const btnInc = document.getElementById('catReportBtn-income');
      const btnExp = document.getElementById('catReportBtn-expense');

      if (btnInc && btnExp) {
        btnInc.className = activeType === 'income' ? "px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-100 text-emerald-800" : "px-3 py-1.5 text-xs rounded-lg bg-gray-100 text-gray-600";
        btnExp.className = activeType === 'expense' ? "px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-100 text-rose-800" : "px-3 py-1.5 text-xs rounded-lg bg-gray-100 text-gray-600";
      }

      const filteredTx = window.getFilteredTransactions().filter(t => t.type === activeType);
      const limitedReport = filteredTx.slice(0, reportDisplayLimit);

      if (filteredTx.length > reportDisplayLimit) {
        document.getElementById('loadMoreReportContainer').classList.remove('hidden');
      } else {
        document.getElementById('loadMoreReportContainer').classList.add('hidden');
      }

      window.renderDrillDownAccordion(limitedReport, 'categoryReportList', 'catReportTab');
    }

    window.changeCalendarMonth = async function(delta) {
      // Prevent overflow when current day is 29/30/31
      calendarCurrentDate.setDate(1);
      calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + delta);
      try {
        if (typeof window.ensureTransactionsLoaded === 'function') {
          await window.ensureTransactionsLoaded(true);
        }
      } catch (e) { console.warn(e); }
      renderFullMonthCalendar();
    }

    function renderFullMonthCalendar() {
      const year = calendarCurrentDate.getFullYear(), month = calendarCurrentDate.getMonth();
      document.getElementById('calendarMonthYear').innerText = `${['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'][month]} ${year + 543}`;
      
      const firstDay = new Date(year, month, 1).getDay(), days = new Date(year, month + 1, 0).getDate();
      const grid = document.getElementById('fullCalendarGrid');
      grid.innerHTML = '';
      const todayStr = getLocalYYYYMMDD();

      for(let i=0;i<firstDay;i++) grid.innerHTML += `<div class="p-1 min-h-[72px] bg-gray-50/30 rounded-xl"></div>`;

      for(let day=1;day<=days;day++) {
        const dStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const txs = (window.appData.transactions||[]).filter(t => t.date === dStr);
        let html = `<div class="flex justify-between items-center px-0.5 w-full"><span class="text-[10px] font-semibold">${day}</span></div>`;

        let cellBg = 'bg-gray-50 border-gray-100';
        let net = 0;

        if(txs.length > 0) {
          const daySums = window.sumIncomeExpense(txs);
          let inc = daySums.income, exp = daySums.expense;
          net = daySums.net;

          // สีพื้นหลังตามกำไร/ขาดทุน
          if (net > 0) {
            cellBg = 'bg-emerald-50 border-emerald-200';
          } else if (net < 0) {
            cellBg = 'bg-rose-50 border-rose-200';
          } else {
            cellBg = 'bg-gray-50 border-gray-200';
          }

          html += `<div class="text-center w-full mt-0.5 leading-tight">
            ${inc>0 ? `<span class="text-[8px] font-bold text-emerald-600 block">+${inc.toLocaleString()}</span>` : ''}
            ${exp>0 ? `<span class="text-[8px] font-bold text-rose-500 block">-${exp.toLocaleString()}</span>` : ''}
            <span class="text-[8px] font-extrabold block mt-0.5 ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}">${net >= 0 ? '+' : ''}${net.toLocaleString()}</span>
          </div>`;
        }

        // วันนี้เน้นด้วย ring (ทับสีพื้นได้)
        const todayRing = (dStr === todayStr) ? 'ring-2 ring-brand-500' : '';
        grid.innerHTML += `<div onclick="openCalendarDayModal('${dStr}')" class="p-1 min-h-[72px] rounded-xl border flex flex-col items-center transition-all cursor-pointer hover:opacity-90 ${cellBg} ${todayRing}">${html}</div>`;
      }
    }

    window.openCalendarDayModal = async function(dStr) {
      selectedCalendarDay = dStr;
      let txs = (window.appData.transactions || []).filter(t => t.date === dStr);
      try {
        if (window.SomtumStore && SomtumStore.getTxByDateRange) {
          const fromIdb = await SomtumStore.getTxByDateRange(dStr, dStr);
          if (fromIdb && fromIdb.length) txs = fromIdb;
        }
      } catch (e) { console.warn('cal day IDB', e); }
      const sums = window.sumIncomeExpense(txs);
      const inc = sums.income, exp = sums.expense, net = sums.net;

      document.getElementById('calDayInc').innerText = '฿' + inc.toLocaleString('th-TH', {minimumFractionDigits: 2});
      document.getElementById('calDayExp').innerText = '฿' + exp.toLocaleString('th-TH', {minimumFractionDigits: 2});
      document.getElementById('calDayNet').innerText = '฿' + net.toLocaleString('th-TH', {minimumFractionDigits: 2});
      document.getElementById('calModalTitle').innerHTML = `<i class="fa-solid fa-calendar-day"></i> รายการวันที่ ${escapeHTML(String(dStr || ''))}`;
      
      window.renderDrillDownAccordion(txs, 'calDayTxList', 'calDayModal');
      document.getElementById('calendarDayModal').classList.remove('hidden');
    }

    window.openAddTxFromCalendar = function(t) {
      closeTransactionModal();
      document.getElementById('calendarDayModal').classList.add('hidden');
      openTransactionModal(t);
      document.getElementById('txDate').value = selectedCalendarDay;
    }

    window.setManagerType = function(type) {
      managerType = type;
      document.getElementById('mgrType-income').className = type === 'income' ? 'px-2.5 py-1 text-[11px] rounded-md font-semibold bg-emerald-600 text-white transition-all' : 'px-2.5 py-1 text-[11px] rounded-md font-semibold text-gray-600 transition-all';
      document.getElementById('mgrType-expense').className = type === 'expense' ? 'px-2.5 py-1 text-[11px] rounded-md font-semibold bg-rose-600 text-white transition-all' : 'px-2.5 py-1 text-[11px] rounded-md font-semibold text-gray-600 transition-all';
      window.renderCategoryTree();
    }

    window.renderCategoryTree = function() {
      const list = document.getElementById('fullCategoryTree');
      if (!list) return;
      list.innerHTML = '';

      (window.appData.categories[managerType] || []).forEach(function(cat, i) {
        let badge = '';
        if (cat.flags?.isMaterialCategory) badge = `<span class="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">วัตถุดิบ</span>`;
        if (cat.flags?.isEquipmentCategory) badge = `<span class="text-[9px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium">อุปกรณ์</span>`;

        const isListCat = !!(cat.flags?.isMaterialCategory || cat.flags?.isEquipmentCategory);
        const treeHtml = isListCat
          ? '<span class="text-[10px] text-gray-400 italic">เลือกจากลิสต์วัตถุดิบ/อุปกรณ์อัตโนมัติ</span>'
          : window.renderSubTreeHtml(cat.subs || [], [i], 1);

        list.innerHTML += `
          <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3">
            <div class="flex justify-between items-center mb-2">
              <span class="font-bold text-xs text-gray-800 dark:text-gray-100 flex items-center gap-1.5"><i class="fa-solid fa-folder text-brand-500"></i> ${escapeHTML(cat.name)} ${badge}</span>
              <div class="flex items-center gap-2">
                <button type="button" onclick="renameMainCategory(${i})" class="text-blue-500 hover:text-blue-700 text-xs" title="แก้ไขชื่อหมวดหมู่"><i class="fa-solid fa-pen"></i></button>
                <button type="button" onclick="deleteMainCategory(${i})" class="text-gray-400 hover:text-rose-500 text-xs" title="ลบหมวดหมู่"><i class="fa-solid fa-trash"></i></button>
              </div>
            </div>
            <div class="mb-2 space-y-1">${treeHtml}</div>
            ${isListCat ? '' : `
            <div class="flex gap-1.5">
              <input type="text" id="newSub-${i}" placeholder="เพิ่มรายการย่อยชั้น 2..." class="flex-1 text-[11px] border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100">
              <button type="button" onclick="addSubCategory(${i})" class="bg-gray-800 dark:bg-gray-600 hover:bg-gray-900 dark:hover:bg-gray-500 text-white text-[11px] px-3 py-1.5 rounded-lg">+ เพิ่ม</button>
            </div>`}
          </div>`;
      });
    };

    /**
     * Render nested subs for category manager.
     * pathIdx = [catIndex, ...childIndices] for CRUD callbacks.
     * depth = current tree depth (1 = under main category → level 2 of 5).
     */
    window.renderSubTreeHtml = function(subs, pathIdx, depth) {
      if (!subs || subs.length === 0) {
        return '<span class="text-[10px] text-gray-400 italic">ไม่มีรายการย่อย</span>';
      }
      let html = '';
      const pad = Math.min((depth - 1) * 12, 48);
      subs.forEach(function(node, j) {
        const name = window.catNodeName(node);
        const kids = window.catNodeChildren(node);
        const childPath = pathIdx.concat([j]);
        const pathStr = childPath.join(',');
        const canAddChild = depth < (window.MAX_CAT_DEPTH - 1); // depth 1..3 can add → max depth 4 under main → total levels 5
        html += `<div class="border-l-2 border-brand-100 pl-2" style="margin-left:${pad}px">
          <div class="flex flex-wrap items-center gap-1 mb-1">
            <span class="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-2 py-0.5 rounded text-[10px] inline-flex items-center gap-1">
              ${kids.length ? '<i class="fa-solid fa-folder-open text-brand-400 text-[9px]"></i>' : '<i class="fa-solid fa-tag text-gray-400 text-[9px]"></i>'}
              ${escapeHTML(name)}
              <button type="button" onclick="renameSubCategoryPath('${pathStr}')" class="text-blue-500 hover:text-blue-700" title="แก้ไข"><i class="fa-solid fa-pen text-[9px]"></i></button>
              <button type="button" onclick="deleteSubCategoryPath('${pathStr}')" class="text-gray-400 hover:text-rose-500" title="ลบ"><i class="fa-solid fa-xmark"></i></button>
            </span>
          </div>`;
        if (kids.length > 0) {
          html += window.renderSubTreeHtml(kids, childPath, depth + 1);
        }
        if (canAddChild) {
          html += `<div class="flex gap-1 mb-1.5" style="margin-left:4px">
            <input type="text" id="newNested-${pathStr.replace(/,/g,'-')}" placeholder="เพิ่มชั้นถัดไป (สูงสุด ${window.MAX_CAT_DEPTH} ชั้น)..." class="flex-1 text-[10px] border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800">
            <button type="button" onclick="addNestedCategory('${pathStr}')" class="bg-brand-500 hover:bg-brand-600 text-white text-[10px] px-2 py-1 rounded">+</button>
          </div>`;
        }
        html += '</div>';
      });
      return html;
    };

    /** Resolve array reference for path [catIdx, ...indices] → parent array + last index */
    window.resolveCatPath = function(pathStr) {
      const parts = String(pathStr).split(',').map(Number);
      if (!parts.length || parts.some(function(n) { return isNaN(n); })) return null;
      const catIdx = parts[0];
      const cat = (window.appData.categories[managerType] || [])[catIdx];
      if (!cat) return null;
      if (parts.length === 1) {
        return { cat: cat, parentArr: null, index: catIdx, node: cat, depth: 0 };
      }
      let arr = cat.subs;
      if (!Array.isArray(arr)) return null;
      for (let d = 1; d < parts.length - 1; d++) {
        const node = arr[parts[d]];
        if (node == null) return null;
        // Promote string leaf to branch if we need to go deeper (should not happen in resolve)
        if (typeof node === 'string') return null;
        if (!Array.isArray(node.children)) node.children = [];
        arr = node.children;
      }
      const last = parts[parts.length - 1];
      return { cat: cat, parentArr: arr, index: last, node: arr[last], depth: parts.length - 1 };
    };

    window.addNestedCategory = function(pathStr) {
      const inputId = 'newNested-' + String(pathStr).replace(/,/g, '-');
      const input = document.getElementById(inputId);
      const val = input ? input.value.trim() : '';
      if (!val) return;
      const badName = window.isInvalidCategoryName(val);
      if (badName) { alert(badName); return; }
      const resolved = window.resolveCatPath(pathStr);
      if (!resolved || resolved.node == null) return;
      // Promote string leaf → branch object so we can attach children
      let node = resolved.node;
      if (typeof node === 'string') {
        node = { name: node, children: [] };
        resolved.parentArr[resolved.index] = node;
      }
      if (!Array.isArray(node.children)) node.children = [];
      // depth of new child under main; block when already at max depth
      if (resolved.depth >= window.MAX_CAT_DEPTH - 1) {
        alert('ซ้อนได้สูงสุด ' + window.MAX_CAT_DEPTH + ' ชั้น');
        return;
      }
      const exists = node.children.some(function(c) {
        return window.catNodeName(c).toLowerCase() === val.toLowerCase();
      });
      if (exists) { alert('มีรายการนี้อยู่แล้วในชั้นนี้'); return; }
      node.children.push(val);
      if (input) input.value = '';
      window.syncDataToCloud(true);
      window.renderCategoryTree();
      window.showToast('เพิ่มหมวดซ้อนเรียบร้อย');
    };

    window.renameSubCategoryPath = function(pathStr) {
      const resolved = window.resolveCatPath(pathStr);
      if (!resolved || resolved.node == null) return;
      const oldName = window.catNodeName(resolved.node);
      window.openRenameModal('แก้ไขรายการย่อย', 'ชื่อใหม่จะถูกอัปเดตในรายการที่บันทึกไว้แล้วด้วย', oldName, async function(trimmed) {
        if (trimmed === oldName) return;
        const badRename = window.isInvalidCategoryName(trimmed);
        if (badRename) { alert(badRename); return; }
        const siblings = resolved.parentArr || [];
        if (siblings.some(function(s, idx) {
          return idx !== resolved.index && window.catNodeName(s).toLowerCase() === trimmed.toLowerCase();
        })) {
          alert('มีรายการย่อยนี้อยู่แล้ว');
          return;
        }
        if (typeof resolved.node === 'string') {
          resolved.parentArr[resolved.index] = trimmed;
        } else if (window.isCatBranch(resolved.node)) {
          resolved.node.name = trimmed;
        }
        // Update transactions: replace segment in nested path or exact match
        if (typeof window.loadAllTransactions === 'function') {
          try { await window.loadAllTransactions(); } catch (e) { console.warn(e); }
        }
        let updatedCount = 0;
        const catName = resolved.cat.name;
        for (const tx of (window.appData.transactions || [])) {
          if (tx.type !== managerType || tx.category !== catName) continue;
          let changed = false;
          if (tx.subCategory === oldName) {
            tx.subCategory = trimmed;
            changed = true;
          } else if (tx.subCategory && tx.subCategory.indexOf(window.CAT_PATH_SEP) >= 0) {
            const parts = tx.subCategory.split(window.CAT_PATH_SEP).map(function(s) { return s.trim(); });
            let hit = false;
            for (let p = 0; p < parts.length; p++) {
              if (parts[p] === oldName) { parts[p] = trimmed; hit = true; }
            }
            if (hit) {
              tx.subCategory = parts.join(window.CAT_PATH_SEP);
              changed = true;
            }
          } else if (tx.subCategory && tx.subCategory.includes(oldName)) {
            // multi-select comma list
            const parts = tx.subCategory.split(',').map(function(s) { return s.trim(); });
            const idx = parts.indexOf(oldName);
            if (idx !== -1) {
              parts[idx] = trimmed;
              tx.subCategory = parts.join(', ');
              changed = true;
            }
          }
          if (changed) {
            updatedCount++;
            if (window.SomtumStore && SomtumStore.putTx) {
              try {
                await SomtumStore.putTx(tx);
                if (SomtumStore.markDirty) await SomtumStore.markDirty(tx.id);
              } catch (e) { console.warn('putTx after renameSubPath', e); }
            }
          }
        }
        window.syncDataToCloud(true);
        window.renderCategoryTree();
        window.refreshDashboard();
        window.showToast(updatedCount > 0
          ? 'แก้ไขรายการย่อยเรียบร้อย (อัปเดต ' + updatedCount + ' รายการ)'
          : 'แก้ไขรายการย่อยเรียบร้อย');
      });
    };

    window.deleteSubCategoryPath = function(pathStr) {
      const resolved = window.resolveCatPath(pathStr);
      if (!resolved || resolved.node == null) return;
      const subName = window.catNodeName(resolved.node);
      window.showConfirmModal('ยืนยันการลบรายการย่อย', 'ต้องการลบ "' + subName + '" และรายการซ้อนภายใต้ (ถ้ามี) ใช่หรือไม่?', function() {
        resolved.parentArr.splice(resolved.index, 1);
        window.syncDataToCloud(true);
        window.renderCategoryTree();
        window.showToast('ลบรายการย่อยแล้ว');
      });
    };

    // Rename main category + update all related transactions (via modal)
    window.renameMainCategory = function(i) {
      const cats = window.appData.categories[managerType];
      const cat = cats[i];
      if (!cat) return;
      const oldName = cat.name;
      window.openRenameModal('แก้ไขหมวดหมู่หลัก', 'ชื่อใหม่จะถูกอัปเดตในรายการที่บันทึกไว้แล้วด้วย', oldName, async (trimmed) => {
        if (trimmed === oldName) return;
        const badMain = window.isInvalidCategoryName(trimmed);
        if (badMain) { alert(badMain); return; }
        if (cats.some((c, idx) => idx !== i && c.name.toLowerCase() === trimmed.toLowerCase())) {
          alert('มีหมวดหมู่นี้อยู่แล้ว');
          return;
        }
        cat.name = trimmed;
        // Bulk ops must see full dataset, not only current filter cache
        if (typeof window.loadAllTransactions === 'function') {
          try { await window.loadAllTransactions(); } catch (e) { console.warn(e); }
        }
        let updatedCount = 0;
        for (const tx of (window.appData.transactions || [])) {
          if (tx.type === managerType && tx.category === oldName) {
            tx.category = trimmed;
            updatedCount++;
            // Persist renamed tx to IndexedDB + mark dirty for offline re-sync
            if (window.SomtumStore && SomtumStore.putTx) {
              try {
                await SomtumStore.putTx(tx);
                if (SomtumStore.markDirty) await SomtumStore.markDirty(tx.id);
              } catch (e) { console.warn('putTx after renameMain', e); }
            }
          }
        }
        window.syncDataToCloud(true);
        if (window.currentUser && updatedCount > 0) {
          try {
            let batch = window.writeBatch(window.db);
            let count = 0;
            for (const tx of window.appData.transactions) {
              if (tx.type === managerType && tx.category === trimmed) {
                const txRef = window.doc(window.db, "users", window.currentUser.uid, "transactions", tx.id);
                batch.set(txRef, JSON.parse(JSON.stringify(tx)), { merge: true });
                count++;
                if (count >= 400) { await batch.commit(); batch = window.writeBatch(window.db); count = 0; }
              }
            }
            if (count > 0) await batch.commit();
          } catch (e) {
            console.error('Rename category tx sync error:', e);
            window.showToast('อัปเดตชื่อหมวดหมู่แล้ว แต่ซิงค์รายการบางส่วนล้มเหลว', 'error');
          }
        }
        window.renderCategoryTree();
        window.refreshDashboard();
        window.showToast(updatedCount > 0
          ? `แก้ไขหมวดหมู่เรียบร้อย (อัปเดต ${updatedCount} รายการ)`
          : 'แก้ไขหมวดหมู่เรียบร้อย');
      });
    };

    // Rename sub-category + update related transactions
    window.renameSubCategory = function(i, j) {
      // Legacy (i, j) API → path-based implementation (supports nested nodes)
      window.renameSubCategoryPath(String(i) + ',' + String(j));
    };

    window.addNewCategory = function() {
      const nameInput = document.getElementById('newCatName');
      const name = nameInput.value.trim();
      if (!name) return;
      const bad = window.isInvalidCategoryName(name);
      if (bad) { alert(bad); return; }

      const isMaterial = document.getElementById('newCatIsMaterial').checked;
      const isEquipment = document.getElementById('newCatIsEquipment').checked;
      const cats = window.appData.categories[managerType];

      if(cats.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        alert('มีหมวดหมู่นี้อยู่แล้ว');
        return;
      }

      const newCat = { name, subs: [] };
      if (isMaterial || isEquipment) {
        newCat.flags = {};
        if (isMaterial) newCat.flags.isMaterialCategory = true;
        if (isEquipment) newCat.flags.isEquipmentCategory = true;
      }

      cats.push(newCat);
      nameInput.value = '';
      document.getElementById('newCatIsMaterial').checked = false;
      document.getElementById('newCatIsEquipment').checked = false;

      window.syncDataToCloud(true); // immediate sync for categories
      window.renderCategoryTree();
      window.showToast('เพิ่มหมวดหมู่เรียบร้อย');
    }

    window.deleteMainCategory = function(i) {
      const catName = window.appData.categories[managerType][i]?.name || '';
      const usedCount = (window.appData.transactions || []).filter(t => t.category === catName && t.type === managerType).length;
      const warnMsg = usedCount > 0
        ? `หมวดหมู่นี้ถูกใช้ใน ${usedCount} รายการแล้ว การลบอาจทำให้รายการเก่าแสดงหมวดหมู่ไม่ถูกต้อง ต้องการลบจริงหรือไม่?`
        : "การลบหมวดหมู่หลักจะทำให้รายการย่อยทั้งหมดถูกลบด้วย";
      window.showConfirmModal("ยืนยันการลบหมวดหมู่", warnMsg, () => {
        window.appData.categories[managerType].splice(i, 1);
        window.syncDataToCloud(true);
        window.renderCategoryTree();
        window.showToast('ลบหมวดหมู่แล้ว');
      });
    }

    window.addSubCategory = function(i) {
      const input = document.getElementById('newSub-' + i);
      const val = input ? input.value.trim() : '';
      if (!val) return;
      const bad = window.isInvalidCategoryName(val);
      if (bad) { alert(bad); return; }

      const cat = window.appData.categories[managerType][i];
      if (!cat.subs) cat.subs = [];
      const exists = cat.subs.some(function(s) {
        return window.catNodeName(s).toLowerCase() === val.toLowerCase();
      });
      if (exists) {
        alert('มีรายการย่อยนี้อยู่แล้ว');
        return;
      }

      cat.subs.push(val);
      if (input) input.value = '';
      window.syncDataToCloud(true);
      window.renderCategoryTree();
      window.showToast('เพิ่มรายการย่อยแล้ว');
    }

    window.deleteSubCategory = function(i, j) {
      // Legacy entry → delegate to path-based delete
      window.deleteSubCategoryPath(String(i) + ',' + String(j));
    }

    window.renderMaterialTags = function() {
      const list = document.getElementById('materialItemsList');
      if(!list) return;
      list.innerHTML = '';

      window.appData.materials.forEach((m, idx) => {
        list.innerHTML += `<span class="bg-amber-50 text-amber-900 border border-amber-200 px-2.5 py-1 rounded-xl text-[11px] inline-flex items-center gap-1.5 font-medium">${escapeHTML(m)} <button onclick="renameMaterialItem('วัตถุดิบ', ${idx})" class="text-blue-600 hover:text-blue-800" title="แก้ไข"><i class="fa-solid fa-pen text-[9px]"></i></button> <button onclick="deleteMaterialItem('วัตถุดิบ', ${idx})" class="text-amber-700 hover:text-rose-600" title="ลบ"><i class="fa-solid fa-xmark"></i></button></span>`;
      });
      window.appData.equipments.forEach((eq, idx) => {
        list.innerHTML += `<span class="bg-blue-50 text-blue-900 border border-blue-200 px-2.5 py-1 rounded-xl text-[11px] inline-flex items-center gap-1.5 font-medium">${escapeHTML(eq)} <button onclick="renameMaterialItem('อุปกรณ์', ${idx})" class="text-blue-600 hover:text-blue-800" title="แก้ไข"><i class="fa-solid fa-pen text-[9px]"></i></button> <button onclick="deleteMaterialItem('อุปกรณ์', ${idx})" class="text-blue-700 hover:text-rose-600" title="ลบ"><i class="fa-solid fa-xmark"></i></button></span>`;
      });
    }

    window.addNewMaterialItem = function() {
      const type = document.getElementById('newItemType').value;
      const nameInput = document.getElementById('newItemName');
      const name = nameInput.value.trim();
      if(!name) return;

      if(type === 'วัตถุดิบ') {
        if(window.appData.materials.includes(name)) { alert('มีรายการนี้อยู่แล้ว'); return; }
        window.appData.materials.push(name);
      } else {
        if(window.appData.equipments.includes(name)) { alert('มีรายการนี้อยู่แล้ว'); return; }
        window.appData.equipments.push(name);
      }

      nameInput.value = '';
      window.syncDataToCloud(true);
      window.renderMaterialTags();
      window.showToast('เพิ่มรายการสำเร็จ');
    }

    // Rename material / equipment + update transactions (via modal)
    window.renameMaterialItem = function(type, idx) {
      const arr = type === 'วัตถุดิบ' ? window.appData.materials : window.appData.equipments;
      const oldName = arr[idx];
      if (!oldName) return;
      window.openRenameModal('แก้ไขชื่อ' + type, 'ชื่อใหม่จะถูกอัปเดตในรายการที่บันทึกไว้แล้วด้วย', oldName, async (trimmed) => {
        if (trimmed === oldName) return;
        if (arr.some((n, i) => i !== idx && n.toLowerCase() === trimmed.toLowerCase())) {
          alert('มีรายการนี้อยู่แล้ว');
          return;
        }
        arr[idx] = trimmed;
        if (typeof window.loadAllTransactions === 'function') {
          try { await window.loadAllTransactions(); } catch (e) { console.warn(e); }
        }
        let updatedCount = 0;
        for (const tx of (window.appData.transactions || [])) {
          if (!tx.subCategory) continue;
          let changed = false;
          if (tx.subCategory === oldName) {
            tx.subCategory = trimmed;
            changed = true;
          } else if (tx.subCategory.includes(oldName)) {
            const parts = tx.subCategory.split(',').map(s => s.trim());
            for (let i = 0; i < parts.length; i++) {
              if (parts[i] === oldName) {
                parts[i] = trimmed;
                changed = true;
              }
            }
            if (changed) {
              tx.subCategory = parts.join(', ');
            }
          }
          if (changed) {
            updatedCount++;
            if (window.SomtumStore && SomtumStore.putTx) {
              try {
                await SomtumStore.putTx(tx);
                if (SomtumStore.markDirty) await SomtumStore.markDirty(tx.id);
              } catch (e) { console.warn('putTx after renameMaterial', e); }
            }
          }
        }
        window.syncDataToCloud(true);
        if (window.currentUser && updatedCount > 0) {
          try {
            let batch = window.writeBatch(window.db);
            let count = 0;
            for (const tx of window.appData.transactions) {
              if (tx.subCategory === trimmed || (tx.subCategory || '').includes(trimmed)) {
                const txRef = window.doc(window.db, "users", window.currentUser.uid, "transactions", tx.id);
                batch.set(txRef, JSON.parse(JSON.stringify(tx)), { merge: true });
                count++;
                if (count >= 400) { await batch.commit(); batch = window.writeBatch(window.db); count = 0; }
              }
            }
            if (count > 0) await batch.commit();
          } catch (e) {
            console.error('Rename material tx sync error:', e);
            window.showToast('แก้ไขชื่อแล้ว แต่ซิงค์รายการบางส่วนล้มเหลว', 'error');
          }
        }
        window.renderMaterialTags();
        window.refreshDashboard();
        window.showToast(updatedCount > 0
          ? `แก้ไข${type}เรียบร้อย (อัปเดต ${updatedCount} รายการ)`
          : `แก้ไข${type}เรียบร้อย`);
      });
    };

    window.deleteMaterialItem = function(type, idx) {
      const itemName = type === 'วัตถุดิบ'
        ? (window.appData.materials[idx] || 'รายการนี้')
        : (window.appData.equipments[idx] || 'รายการนี้');
      const usedCount = (window.appData.transactions || []).filter(t => (t.subCategory || '').includes(itemName)).length;
      const warnMsg = usedCount > 0
        ? `"${itemName}" ถูกใช้ใน ${usedCount} รายการแล้ว การลบอาจทำให้รายการเก่าหายจาก checklist ต้องการลบจริงหรือไม่?`
        : `ต้องการลบ${type} "${itemName}" ใช่หรือไม่?`;
      window.showConfirmModal("ยืนยันการลบ", warnMsg, () => {
        if(type === 'วัตถุดิบ') window.appData.materials.splice(idx, 1);
        else window.appData.equipments.splice(idx, 1);
        window.syncDataToCloud(true);
        window.renderMaterialTags();
        window.showToast('ลบรายการสำเร็จ');
      });
    }

    window.resetAllData = function() {
      window.showConfirmModal(
        "ยืนยันการล้างข้อมูลทั้งหมด",
        "ข้อมูลรายรับ-รายจ่าย หมวดหมู่ และเป้าหมายทั้งหมดจะถูกลบทั้งในเครื่องและบน Cloud (ถ้าล็อกอินอยู่) การกระทำนี้ไม่สามารถย้อนกลับได้",
        async () => {
          window.showToast("กำลังล้างข้อมูล...");
          // Clear IndexedDB tx + meta + kv + legacy sources completely
          if (window.SomtumStore && SomtumStore.clearAllUserData) {
            try {
              await SomtumStore.clearAllUserData();
            } catch (e) {
              console.error('clearAllUserData failed', e);
            }
          }
          window.appData = {
            transactions: [],
            categories: JSON.parse(JSON.stringify(window.DEFAULT_CATEGORIES)),
            materials: [...window.DEFAULT_MATERIALS],
            equipments: [...window.DEFAULT_EQUIPMENTS],
            customGoal: null,
            customGoalPercent: null
          };
          window.__txCacheLoaded = false;
          window.__loadedRange = { start: null, end: null };
          // Persist empty meta (defaults only) so IDB is not left empty for migrate to refill
          try {
            if (window.SomtumStore && SomtumStore.persistAppState) {
              await SomtumStore.persistAppState(window.appData, { writeAllTx: true });
            }
            if (window.SomtumStore && typeof SomtumStore.flush === 'function') {
              await SomtumStore.flush();
            }
          } catch (e) {
            console.error('persist empty state after clear failed', e);
          }
          window.saveLocalOnly();
          if (typeof lastAutoBackupHash !== 'undefined') lastAutoBackupHash = '';

          if (window.currentUser && window.db) {
            try {
              // Restore owner uid after clearAll wiped it
              SomtumStore.setItem('somtumDataOwnerUid', window.currentUser.uid);
              const settingsRef = window.doc(window.db, "users", window.currentUser.uid, "meta", "settings");
              await window.setDoc(settingsRef, {
                categories: window.appData.categories,
                materials: window.appData.materials,
                equipments: window.appData.equipments,
                customGoal: null,
                customGoalPercent: null,
                updatedAt: new Date().toISOString()
              });
              const txCollRef = window.collection(window.db, "users", window.currentUser.uid, "transactions");
              const snap = await window.getDocs(txCollRef);
              let batch = window.writeBatch(window.db);
              let count = 0;
              for (const d of snap.docs) {
                batch.delete(d.ref);
                count++;
                if (count >= 400) {
                  await batch.commit();
                  batch = window.writeBatch(window.db);
                  count = 0;
                }
              }
              if (count > 0) await batch.commit();
            } catch (e) {
              console.error("Reset cloud error:", e);
            }
          }
          window.refreshDashboard();
          window.showToast("ล้างข้อมูลทั้งหมดเรียบร้อยแล้ว");
        }
      );
    };
