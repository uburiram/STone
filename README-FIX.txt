ไฟล์ที่แก้ไขแล้วสำหรับ uburiram/STone (bugfix pass — เสถียร)

## สรุปบั๊กที่พบและแก้ไข

1. CACHE_NAME ใน service-worker.js เป็นค่าชั่วคราว 'somtum-v16-bugfix'
   → แก้เป็นเวอร์ชันที่ build bump อัตโนมัติ (somtum-vYYYYMMDDHHMMSS)

2. dist/ ไม่ sync กับ source ล่าสุด (โค้ด scope isolation, branding STone, boot gate)
   → รัน build.sh ใหม่ → dist/ ตรงกับ root 100%

3. มี directory ผิดปกติชื่อ "tests " (มี space) และไฟล์ว่างใน dist/
   → ลบออกแล้ว

4. CORE_ASSETS ใน SW ไม่รวม icon-maskable-* และ icon_256x256.png
   → เพิ่มแล้ว เพื่อ PWA offline icon ครบ

5. README.md ยังใช้ชื่อเก่า "ส้มตำนายหนึ่ง" และอ้าง DB v1 / cache v6
   → อัปเดตให้ตรงสถาปัตยกรรมจริง (STone, somtum-idb-v2 + per-uid scopes)

6. build.sh ไม่ copy README.md / ตัวเองเข้า dist/
   → เพิ่ม copy เพื่อให้ dist/ เป็น snapshot ที่ deploy ได้ทันที

## การทดสอบหลังแก้

- node tests/calc.test.js          → 21 passed, 0 failed
- node tests/storage-logic.test.js → 25 passed, 0 failed
- node --check ทุกไฟล์ JS         → syntax OK
- diff root vs dist (app/storage/firebase/sw/index) → identical
- ไม่มี directory ชื่อมี space เหลือ

## ไฟล์ที่เปลี่ยน

- service-worker.js   (CACHE + CORE_ASSETS)
- build.sh            (copy README + self)
- README.md           (rebrand + architecture จริง)
- dist/*              (rebuild ทั้งหมดจาก source ล่าสุด)
- README-FIX.txt      (ไฟล์นี้)

storage.js / app.js / firebase.js / index.html ไม่ต้องแก้เพิ่ม
(โค้ดหลักมี boot gate, escape, scope isolation, money rounding ครบแล้ว)

หลัง copy ลง repo จริง:
  chmod +x build.sh && bash build.sh

หมายเหตุ PWA: ถ้าเคยติดตั้งแอปเก่า ต้องถอนติดตั้งแล้วติดตั้งใหม่
จึงจะเห็น short_name = STone บนหน้าจอหลัก
