/* ============================================================
 * STone — app-features.js
 * Dark mode, goal notify, auto-backup, weekly reminder (disabled), network, PWA, service worker
 * Split from js/app.js (behavior unchanged; window.* API kept)
 * Load order: storage → app-core → app-dashboard → app-tx →
 *             app-categories → app-features → reports → firebase
 * ============================================================ */


    // ==================== NEW FEATURES (Clean - No Multi-Shop) ====================

    // ----- Dark Mode -----
    window.toggleDarkMode = function() {
      const html = document.documentElement;
      const isDark = html.classList.toggle('dark');
      SomtumStore.setItem('somtumDarkMode', isDark ? '1' : '0');
      const icon = document.getElementById('darkModeIcon');
      if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      window.showToast(isDark ? 'เปิดโหมดมืดแล้ว' : 'เปิดโหมดสว่างแล้ว');
    };
    (function initDark() {
      if (SomtumStore.getItem('somtumDarkMode') === '1') {
        document.documentElement.classList.add('dark');
        const icon = document.getElementById('darkModeIcon');
        if (icon) icon.className = 'fa-solid fa-sun';
      }
    })();

    // ----- Goal Notification (persistent flag) -----
    window.checkGoalNotification = function() {
      const filteredTx = window.getTimeFilteredTransactions();
      const gSums = window.sumIncomeExpense(filteredTx);
      let totalIncome = gSums.income, totalExpense = gSums.expense;
      const targetGoal = window.resolveTargetGoal(totalExpense, totalIncome);
      const pct = targetGoal > 0 ? (totalIncome / targetGoal) * 100 : 0;
      const now = Date.now();
      const lastNotified = parseInt(SomtumStore.getItem('somtumLastGoalNotified') || '0', 10);

      if (pct >= 100 && now - lastNotified > 300000) { // 5 min cooldown
        SomtumStore.setItem('somtumLastGoalNotified', String(now));
        window.showToast('🎉 ยินดีด้วย! บรรลุเป้าหมายแล้ว ' + pct.toFixed(0) + '%', 'success');
        if (typeof Notification !== 'undefined') {
          if (Notification.permission === 'granted') {
            new Notification('ระบบบันทึกต้นทุน กำไร - STone', { body: 'บรรลุเป้าหมายรายรับแล้ว! ' + pct.toFixed(0) + '%', icon: './icon-192.png' });
          } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
          }
        }
      } else if (pct >= 80 && pct < 100 && now - lastNotified > 600000) {
        SomtumStore.setItem('somtumLastGoalNotified', String(now));
        window.showToast('ใกล้บรรลุเป้าหมายแล้ว! ' + pct.toFixed(0) + '%', 'success');
      }
    };

    // Hook into refreshDashboard (safe, preserve async)
    if (typeof window.refreshDashboard === 'function') {
      const originalRefresh = window.refreshDashboard;
      window.refreshDashboard = async function() {
        await originalRefresh();
        window.checkGoalNotification();
      };
    }

    // ----- Auto Backup (content hash + scoped) -----
    let lastAutoBackupHash = '';
    /** djb2 hash — catches any content change (notes, category names, etc.) */
    function simpleContentHash(str) {
      let h = 5381;
      for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) + str.charCodeAt(i);
        h = h >>> 0; // force uint32
      }
      return h.toString(36);
    }
    window.performAutoBackup = async function() {
      try {
        let data = window.appData;
        if (window.SomtumStore && SomtumStore.buildLegacyAppData) {
          data = await SomtumStore.buildLegacyAppData(window.appData);
        }
        const dataStr = JSON.stringify(data);
        const hash = simpleContentHash(dataStr);
        if (hash === lastAutoBackupHash) return;
        // Respect LS size guard used by SomtumStore (avoid silent quota failures)
        const maxChars = (window.SomtumStore && SomtumStore.LS_APPDATA_MAX_CHARS)
          ? SomtumStore.LS_APPDATA_MAX_CHARS
          : 400000;
        if (dataStr.length > maxChars) {
          // Still try IDB-only path via setItem (storage skips oversized LS mirror)
          console.warn('[STone autoBackup] large payload', dataStr.length, 'chars — IDB/kv only');
        }
        SomtumStore.setItem('somtumAutoBackup', dataStr);
        SomtumStore.setItem('somtumAutoBackupTime', new Date().toISOString());
        if (window.currentUser) SomtumStore.setItem('somtumAutoBackupUid', window.currentUser.uid);
        lastAutoBackupHash = hash;
        // Verify read-back for critical recovery path
        const check = SomtumStore.getItem('somtumAutoBackup');
        if (!check && dataStr.length <= maxChars) {
          console.warn('[STone autoBackup] write verification failed (quota?)');
        }
      } catch (e) { console.warn('[STone] Auto backup failed', e); }
    };
    window.restoreAutoBackup = function() {
      const bak = SomtumStore.getItem('somtumAutoBackup');
      const t = SomtumStore.getItem('somtumAutoBackupTime');
      const bakUid = SomtumStore.getItem('somtumAutoBackupUid');
      if (!bak) {
        alert('ยังไม่มี Auto Backup');
        return;
      }
      // Prevent restoring another user's backup
      if (window.currentUser && bakUid && bakUid !== window.currentUser.uid) {
        alert('Auto Backup นี้เป็นของบัญชีอื่น ไม่สามารถกู้คืนได้');
        return;
      }
      if (!window.currentUser && bakUid) {
        // Guest trying to restore a logged-in user's backup
        if (!confirm('Auto Backup นี้สร้างจากบัญชีที่ล็อกอินอยู่ ต้องการกู้คืนเป็นข้อมูล Guest ใช่หรือไม่?')) return;
      }
      window.showConfirmModal('กู้คืนจาก Auto Backup', 'ข้อมูลปัจจุบันจะถูกแทนที่ด้วยสำรองเมื่อ ' + (t ? new Date(t).toLocaleString('th-TH') : 'ไม่ทราบเวลา') + ' ต้องการดำเนินการต่อหรือไม่?', async () => {
        try {
          // Parse backup BEFORE clear — clearAllUserData wipes somtumAutoBackup keys
          const restored = window.sanitizeAppData(JSON.parse(bak));
          const ownerUid = window.currentUser ? window.currentUser.uid : (bakUid || null);
          if (window.SomtumStore && SomtumStore.clearAllUserData) {
            await SomtumStore.clearAllUserData();
          }
          if (ownerUid) SomtumStore.setItem('somtumDataOwnerUid', ownerUid);
          window.appData = restored;
          if (window.SomtumStore && SomtumStore.persistAppState) {
            await SomtumStore.persistAppState(restored, { writeAllTx: true });
            if (SomtumStore.markDirty) {
              for (const tx of (restored.transactions || [])) {
                if (tx && tx.id) await SomtumStore.markDirty(tx.id);
              }
            }
            if (SomtumStore.markMetaDirty) SomtumStore.markMetaDirty();
          }
          window.__txCacheLoaded = false;
          window.__loadedRange = { start: null, end: null };
          window.saveLocalOnly();
          window.syncDataToCloud();
          if (typeof window.ensureTransactionsLoaded === 'function') {
            await window.ensureTransactionsLoaded(true);
          }
          window.refreshDashboard();
          window.showToast('กู้คืนจาก Auto Backup สำเร็จ');
        } catch (e) {
          console.error(e);
          alert('กู้คืนล้มเหลว');
        }
      });
    };
    setInterval(window.performAutoBackup, 15 * 60 * 1000);
    // Auto-backup debounce is handled inside unified saveLocalOnly (module script)

    // ----- Weekly backup reminder -----
    window.markWeeklyBackupDone = function() {
      SomtumStore.setItem('somtumLastBackupRemind', String(Date.now()));
    };
    window.checkWeeklyBackupReminder = function() {
      // Disabled: popup เตือนสำรองข้อมูลประจำสัปดาห์รบกวนการใช้งานจริง
      // ยังคงมี Auto Backup เงียบ ๆ ในพื้นหลัง และปุ่ม Export/กู้คืนได้ตามปกติ
      return;
    };
    // Hook after finish loading
    if (typeof window.finishLoading === 'function') {
      const _finBak = window.finishLoading;
      window.finishLoading = function() {
        _finBak();
        // Weekly backup reminder popup disabled (annoying in real use)
        // STone auto backup snapshot shortly after UI ready (silent, no popup)
        setTimeout(function() {
          if (typeof window.performAutoBackup === 'function') {
            window.performAutoBackup();
          }
        }, 4000);
      };
    }

    // Confirm before leaving if there is unsynced data
    window.addEventListener('beforeunload', function(e) {
      const hasUnsynced = SomtumStore.getItem('somtumHasUnsyncedData') === 'true';
      const pendingSettings = !!window._pendingSettingsSync;
      if (hasUnsynced || pendingSettings) {
        // Try one last sync attempt (best-effort; browser may cancel async)
        try {
          if (typeof window.syncDataToCloud === 'function' && window.currentUser) {
            window.syncDataToCloud(true);
          }
          if (typeof window.saveLocalOnly === 'function') {
            window.saveLocalOnly();
          }
          if (window.SomtumStore && typeof window.SomtumStore.flush === 'function') {
            // Best-effort; browser may kill async work on unload
            window.SomtumStore.flush();
          }
        } catch (err) { /* ignore */ }
        e.preventDefault();
        e.returnValue = 'มีข้อมูลที่อาจยังไม่ได้ซิงค์ ต้องการออกจากหน้านี้จริงหรือไม่?';
        return e.returnValue;
      }
    });

    // ----- Online / Offline status + pending sync queue -----
    window.updateNetworkStatusUI = function() {
      const online = navigator.onLine;
      const badge = document.getElementById('networkStatusBadge');
      const text = document.getElementById('networkStatusText');
      if (badge) {
        if (online) {
          badge.className = 'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700';
          badge.innerHTML = '<i class="fa-solid fa-wifi"></i> ออนไลน์';
        } else {
          badge.className = 'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700';
          badge.innerHTML = '<i class="fa-solid fa-plane"></i> ออฟไลน์';
        }
      }
      if (text) {
        if (online) {
          text.className = 'text-[10px] mt-0.5 font-medium text-emerald-600';
          text.innerHTML = '<i class="fa-solid fa-wifi mr-1"></i>ออนไลน์';
        } else {
          text.className = 'text-[10px] mt-0.5 font-medium text-rose-500';
          text.innerHTML = '<i class="fa-solid fa-plane mr-1"></i>ออฟไลน์ — บันทึกในเครื่องก่อน';
        }
      }
    };

    window.flushPendingSync = async function() {
      if (!navigator.onLine) return;
      if (!window.currentUser) return;
      const hasUnsynced = SomtumStore.getItem('somtumHasUnsyncedData') === 'true';
      const pendingSettings = !!window._pendingSettingsSync;
      if (!hasUnsynced && !pendingSettings) return;
      try {
        window.showToast('เน็ตกลับมาแล้ว กำลังซิงค์ข้อมูลค้าง...', 'success');
        if (typeof window.checkAndSyncCloudData === 'function') {
          await window.checkAndSyncCloudData(false);
        } else if (typeof window.syncDataToCloud === 'function') {
          window.syncDataToCloud(true);
        }
      } catch (e) {
        console.error('flushPendingSync error:', e);
      }
    };

    window.addEventListener('online', function() {
      window.updateNetworkStatusUI();
      window.showToast('กลับมาออนไลน์แล้ว', 'success');
      // Small delay to let network stabilize
      setTimeout(() => window.flushPendingSync(), 1200);
    });
    window.addEventListener('offline', function() {
      window.updateNetworkStatusUI();
      window.showToast('ออฟไลน์ — ข้อมูลจะถูกบันทึกในเครื่อง', 'error');
    });
    // Initial paint
    window.updateNetworkStatusUI();
    if (typeof window.updatePendingSyncButton === 'function') window.updatePendingSyncButton();


    // ----- PWA install prompt (browser only; skip if already installed) -----
    window._deferredPwaPrompt = null;
    window._pwaInstallMode = 'manual'; // 'native' | 'manual'

    window.isRunningAsInstalledPwa = function() {
      try {
        if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
        if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) return true;
        if (typeof navigator !== 'undefined' && navigator.standalone === true) return true; // iOS Safari
      } catch (e) { /* ignore */ }
      return false;
    };

    window.dismissPwaInstallPrompt = function(days) {
      days = days || 14;
      try {
        localStorage.setItem('stonePwaInstallDismissedAt', String(Date.now()));
        localStorage.setItem('stonePwaInstallDismissDays', String(days));
      } catch (e) { /* ignore */ }
      const modal = document.getElementById('pwaInstallModal');
      if (modal) modal.classList.add('hidden');
    };

    window.shouldShowPwaInstallPrompt = function() {
      if (window.isRunningAsInstalledPwa()) return false;
      try {
        const at = parseInt(localStorage.getItem('stonePwaInstallDismissedAt') || '0', 10);
        const days = parseInt(localStorage.getItem('stonePwaInstallDismissDays') || '14', 10);
        if (at && Date.now() - at < days * 24 * 60 * 60 * 1000) return false;
      } catch (e) { /* ignore */ }
      return true;
    };

    /** Detect platform/browser for install guidance */
    window.detectPwaInstallPlatform = function() {
      const ua = (navigator.userAgent || '').toLowerCase();
      const isIOS = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isAndroid = /android/.test(ua);
      const isMac = /macintosh|mac os x/.test(ua) && !isIOS;
      const isWin = /windows/.test(ua);
      const isLinux = /linux/.test(ua) && !isAndroid;

      // In-app browsers cannot install PWAs reliably
      const isLine = /line\//.test(ua);
      const isFB = /fban|fbav|fb_iab|instagram/.test(ua);
      const isInApp = isLine || isFB || /wv\)|; wv/.test(ua);

      const isChrome = /chrome|crios|chromium/.test(ua) && !/edg|opr|samsung/.test(ua);
      const isEdge = /edg\//.test(ua);
      const isSamsung = /samsungbrowser/.test(ua);
      const isFirefox = /firefox|fxios/.test(ua);
      const isSafari = /safari/.test(ua) && !/chrome|crios|chromium|android|fxios/.test(ua);
      const isOpera = /opr|opera/.test(ua);

      return {
        isIOS: isIOS,
        isAndroid: isAndroid,
        isMac: isMac,
        isWin: isWin,
        isLinux: isLinux,
        isDesktop: !isIOS && !isAndroid,
        isInApp: isInApp,
        isLine: isLine,
        isFB: isFB,
        isChrome: isChrome,
        isEdge: isEdge,
        isSamsung: isSamsung,
        isFirefox: isFirefox,
        isSafari: isSafari,
        isOpera: isOpera
      };
    };

    /** Manual install steps per platform (Thai) */
    window.getPwaManualInstallGuide = function() {
      const p = window.detectPwaInstallPlatform();

      if (p.isInApp) {
        const appName = p.isLine ? 'LINE' : (p.isFB ? 'Facebook/Instagram' : 'แอปนี้');
        return {
          label: 'เปิดในเบราว์เซอร์จริงก่อนติดตั้ง',
          steps: [
            'ตอนนี้คุณเปิดผ่าน ' + appName + ' ซึ่งติดตั้งแอปลงหน้าจอโฮมไม่ได้',
            'แตะเมนู ⋯ หรือปุ่มเปิดในเบราว์เซอร์ (Open in browser)',
            p.isIOS
              ? 'เลือกเปิดด้วย Safari แล้วค่อยทำตามขั้นตอน iPhone ด้านล่าง'
              : 'เลือกเปิดด้วย Chrome แล้วกดเมนู ⋮ → "ติดตั้งแอป" หรือ "Add to Home screen"',
            'หรือคัดลอกลิงก์นี้ แล้ววางใน Chrome / Safari โดยตรง'
          ]
        };
      }

      if (p.isIOS) {
        return {
          label: 'วิธีติดตั้งบน iPhone / iPad (Safari)',
          steps: [
            'เปิดเว็บนี้ด้วย Safari (ไม่ใช่ Chrome ในบางเวอร์ชันที่ยังไม่รองรับ)',
            'แตะปุ่มแชร์ □↑ ที่แถบล่าง (หรือบนสุด)',
            'เลื่อนหาแล้วแตะ "เพิ่มไปยังหน้าจอโฮม" (Add to Home Screen)',
            'กด "เพิ่ม" — ไอคอน STone จะปรากฏบนหน้าจอโฮม'
          ]
        };
      }

      if (p.isAndroid && p.isSamsung) {
        return {
          label: 'วิธีติดตั้งบน Android (Samsung Internet)',
          steps: [
            'แตะเมนู ☰ หรือ ⋮ มุมบน/ล่าง',
            'เลือก "เพิ่มหน้าไปยัง" หรือ "Add page to"',
            'เลือก "หน้าจอหลัก" / Home screen',
            'ยืนยัน — ไอคอน STone จะขึ้นบนหน้าจอโฮม'
          ]
        };
      }

      if (p.isAndroid && p.isFirefox) {
        return {
          label: 'วิธีติดตั้งบน Android (Firefox)',
          steps: [
            'แตะเมนู ⋮ มุมขวาบน',
            'เลือก "ติดตั้ง" หรือ "Install"',
            'ถ้าไม่มีเมนูติดตั้ง ให้เลือก "Add to Home screen"',
            'ยืนยันการเพิ่มไอคอนลงหน้าจอโฮม'
          ]
        };
      }

      if (p.isAndroid) {
        return {
          label: 'วิธีติดตั้งบน Android (Chrome)',
          steps: [
            'แตะเมนู ⋮ มุมขวาบน',
            'เลือก "ติดตั้งแอป" หรือ "Install app" / "Add to Home screen"',
            'กดติดตั้ง/เพิ่ม — เปิด STone จากไอคอนบนหน้าจอโฮมได้เลย',
            'ถ้าไม่เห็นเมนู: รีเฟรชหน้า รอสักครู่ แล้วเปิดเมนูอีกครั้ง'
          ]
        };
      }

      if (p.isDesktop && (p.isChrome || p.isEdge || p.isOpera)) {
        return {
          label: 'วิธีติดตั้งบนคอมพิวเตอร์ (Chrome / Edge)',
          steps: [
            'ดูที่แถบที่อยู่ (Address bar) ด้านขวา มีไอคอนติดตั้ง ⊕ หรือคอมพิวเตอร์พร้อมลูกศร',
            'คลิกไอคอนนั้น แล้วกด "ติดตั้ง"',
            'หรือเปิดเมนู ⋮ → "ติดตั้ง STone…" / "Install STone…"',
            'หลังติดตั้งจะเปิดเป็นหน้าต่างแอปแยกจากเบราว์เซอร์'
          ]
        };
      }

      if (p.isDesktop && p.isFirefox) {
        return {
          label: 'วิธีติดตั้งบนคอมพิวเตอร์ (Firefox)',
          steps: [
            'Firefox ยังไม่รองรับการติดตั้ง PWA เต็มรูปแบบบนเดสก์ท็อปบางเวอร์ชัน',
            'แนะนำเปิดด้วย Google Chrome หรือ Microsoft Edge',
            'จากนั้นใช้ไอคอนติดตั้งบนแถบที่อยู่ หรือเมนู ⋮ → ติดตั้งแอป',
            'หรือสร้างบุ๊กมาร์กไว้ใช้ชั่วคราว'
          ]
        };
      }

      if (p.isMac && p.isSafari) {
        return {
          label: 'วิธีติดตั้งบน Mac (Safari)',
          steps: [
            'ใน Safari เมนู File (ไฟล์) → "Add to Dock" หรือ "เพิ่มใน Dock" (macOS ใหม่)',
            'หรือแชร์ → เพิ่มไปยัง Dock / Home Screen ตามเวอร์ชันระบบ',
            'ถ้าไม่พบเมนู แนะนำเปิดด้วย Chrome แล้วกดติดตั้งจากแถบที่อยู่',
            'หลังเพิ่มแล้วเปิดจาก Dock ได้เหมือนแอป'
          ]
        };
      }

      return {
        label: 'วิธีติดตั้งลงหน้าจอโฮม',
        steps: [
          'เปิดเมนูของเบราว์เซอร์ (⋮ หรือ ☰)',
          'เลือก "ติดตั้งแอป" / "Install app" หรือ "Add to Home screen"',
          'ยืนยันการติดตั้ง — ไอคอน STone จะปรากฏบนหน้าจอโฮมหรือเดสก์ท็อป',
          'ถ้าไม่พบเมนู ลองเปิดด้วย Chrome หรือ Safari แล้วทำซ้ำ'
        ]
      };
    };

    /** Update modal UI for native vs manual mode */
    window.updatePwaInstallModalUI = function() {
      const canNative = !!window._deferredPwaPrompt;
      window._pwaInstallMode = canNative ? 'native' : 'manual';

      const nativeBlock = document.getElementById('pwaInstallNativeBlock');
      const manualBlock = document.getElementById('pwaInstallManualBlock');
      const okBtn = document.getElementById('pwaInstallOk');
      const title = document.getElementById('pwaInstallTitle');
      const subtitle = document.getElementById('pwaInstallSubtitle');
      const platformLabel = document.getElementById('pwaInstallPlatformLabel');
      const stepsEl = document.getElementById('pwaInstallSteps');
      const hint = document.getElementById('pwaInstallHint');

      if (hint) hint.classList.add('hidden');

      if (canNative) {
        if (nativeBlock) nativeBlock.classList.remove('hidden');
        if (manualBlock) manualBlock.classList.add('hidden');
        if (okBtn) {
          okBtn.textContent = 'ติดตั้งเลย';
          okBtn.classList.remove('hidden');
        }
        if (title) title.textContent = 'ติดตั้ง STone ลงหน้าจอโฮม';
        if (subtitle) {
          subtitle.textContent = 'กดปุ่ม "ติดตั้งเลย" เพื่อติดตั้งทันที เปิดใช้ได้เหมือนแอปและใช้งานออฟไลน์ได้';
        }
      } else {
        if (nativeBlock) nativeBlock.classList.add('hidden');
        if (manualBlock) manualBlock.classList.remove('hidden');
        const guide = window.getPwaManualInstallGuide();
        if (platformLabel) platformLabel.textContent = guide.label;
        if (stepsEl) {
          stepsEl.innerHTML = '';
          (guide.steps || []).forEach(function(step) {
            const li = document.createElement('li');
            li.textContent = step;
            stepsEl.appendChild(li);
          });
        }
        if (okBtn) {
          // Manual mode: primary action is "เข้าใจแล้ว" (close); steps already visible
          okBtn.textContent = 'เข้าใจแล้ว';
        }
        if (title) title.textContent = 'ติดตั้ง STone ลงหน้าจอโฮม';
        if (subtitle) {
          subtitle.textContent = 'เบราว์เซอร์นี้ติดตั้งอัตโนมัติไม่ได้ — ทำตามขั้นตอนด้านล่างได้เลย';
        }
      }
    };

    window.showPwaInstallPrompt = function() {
      if (!window.shouldShowPwaInstallPrompt()) return;
      const modal = document.getElementById('pwaInstallModal');
      if (!modal) return;
      window.updatePwaInstallModalUI();
      modal.classList.remove('hidden');
    };

    window.triggerNativePwaInstall = async function() {
      if (!window._deferredPwaPrompt) return false;
      try {
        window._deferredPwaPrompt.prompt();
        const choice = await window._deferredPwaPrompt.userChoice;
        window._deferredPwaPrompt = null;
        window.updatePwaInstallModalUI();
        if (choice && choice.outcome === 'accepted') {
          window.dismissPwaInstallPrompt(365);
          if (typeof window.showToast === 'function') {
            window.showToast('กำลังติดตั้ง STone…', 'success');
          }
          return true;
        }
        // User dismissed native dialog — hide our modal for a week
        window.dismissPwaInstallPrompt(7);
        return false;
      } catch (err) {
        console.warn('[STone] native install prompt failed', err);
        window._deferredPwaPrompt = null;
        // Fall back to manual instructions
        window.updatePwaInstallModalUI();
        window.showPwaInstallPrompt();
        return false;
      }
    };

    window.initPwaInstallPrompt = function() {
      if (window.isRunningAsInstalledPwa()) return;
      if (window._pwaInstallInited) return;
      window._pwaInstallInited = true;

      window.addEventListener('beforeinstallprompt', function(e) {
        e.preventDefault();
        window._deferredPwaPrompt = e;
        // If modal already open in manual mode, switch to native install button
        const modal = document.getElementById('pwaInstallModal');
        if (modal && !modal.classList.contains('hidden')) {
          window.updatePwaInstallModalUI();
        }
      });

      window.addEventListener('appinstalled', function() {
        window._deferredPwaPrompt = null;
        window.dismissPwaInstallPrompt(365);
        if (typeof window.showToast === 'function') {
          window.showToast('ติดตั้ง STone เรียบร้อยแล้ว', 'success');
        }
      });

      const dismissBtn = document.getElementById('pwaInstallDismiss');
      const okBtn = document.getElementById('pwaInstallOk');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', function() {
          window.dismissPwaInstallPrompt(14);
        });
      }
      if (okBtn) {
        okBtn.addEventListener('click', async function() {
          // Native path: trigger browser install UI immediately
          if (window._deferredPwaPrompt) {
            await window.triggerNativePwaInstall();
            return;
          }
          // Manual path: steps already shown — acknowledge and close
          window.dismissPwaInstallPrompt(7);
        });
      }

      // Wait a bit for beforeinstallprompt (Chrome often fires after SW is ready)
      setTimeout(function() {
        if (window.shouldShowPwaInstallPrompt()) {
          window.showPwaInstallPrompt();
        }
      }, 4500);
      // Second chance: if prompt event arrives late, modal UI updates via listener;
      // if modal was never shown and event exists, show again once more
      setTimeout(function() {
        if (!window.shouldShowPwaInstallPrompt()) return;
        const modal = document.getElementById('pwaInstallModal');
        if (modal && modal.classList.contains('hidden') && window._deferredPwaPrompt) {
          window.showPwaInstallPrompt();
        } else if (modal && !modal.classList.contains('hidden')) {
          window.updatePwaInstallModalUI();
        }
      }, 9000);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        window.initPwaInstallPrompt();
      });
    } else {
      window.initPwaInstallPrompt();
    }


    // ----- Register Service Worker -----
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function() {
        // Prefer sibling service-worker.js (same directory as this HTML when hosted)
        const swUrl = 'service-worker.js';
        navigator.serviceWorker.register(swUrl).then(function(reg) {
          console.log('Service Worker registered:', reg.scope);
        }).catch(function(err) {
          console.warn('Service Worker registration failed:', err);
        });
      });
    }

