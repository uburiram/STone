ไฟล์ที่แก้แล้วสำหรับ uburiram/STone

วางทับใน repo ตาม path นี้:
  js/app.js
  js/firebase.js
  service-worker.js
  index.html
  build.sh

storage.js ไม่ต้องแก้

หลัง copy รัน:
  chmod +x build.sh && ./build.sh

สรุปแพตช์หลัก:
  1.1 resetAllData → clearAllUserData
  1.2 guest cloud-only → clearAllUserData
  1.3 rename* → putTx + markDirty
  2.x SW fallback / safeCalculate / backup hash / CSP / local icons
  3.x typo / goal text / modal clash / CACHE auto-bump
  + importDataFromJSON / restoreAutoBackup ล้าง tx store ก่อนเขียนใหม่
  + createDynamicManifest ใช้ icon-192/512 + maskable แยกขนาดถูกต้อง
