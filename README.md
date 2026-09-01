# ระบบบันทึกต้นทุน กำไร - STone

Modular PWA + IndexedDB (per-account scopes) + Firebase Auth/Firestore + CSP

## โครงสร้าง

```
STone/
├── index.html              # UI + CSP + script tags
├── service-worker.js       # network-first สำหรับ app shell (auth-safe)
├── build.sh                # modular (default) หรือ --bundle → dist/
├── js/
│   ├── storage.js          # SomtumStore v2.1 (IDB per-tx + scope isolation)
│   ├── app-core.js         # helpers, boot gate, defaults, hydrate, sanitize
│   ├── app-dashboard.js    # filter/KPI (default รายเดือน), onload, toast
│   ├── app-tx.js           # บันทึกรายรับ-จ่าย, ปฏิทิน, export/import
│   ├── app-categories.js   # หมวดหมู่, วัตถุดิบ, ล้างข้อมูล
│   ├── app-features.js     # dark mode, auto-backup, PWA, SW register
│   ├── app.js              # stub เท่านั้น (ไม่ใช้รันจริง — ดูโมดูลด้านบน)
│   ├── reports.js          # PDF / รายงาน
│   └── firebase.js         # Auth + Firestore incremental sync (ES module)
├── tests/
│   ├── calc.test.js
│   ├── storage-logic.test.js
│   └── e2e-flow.test.js
├── dist/                   # ผลจาก build.sh สำหรับ deploy
└── icons (*.png)           # PWA icons รวม maskable
```

**ลำดับโหลด script (สำคัญ):**

```text
storage.js
→ app-core.js
→ app-dashboard.js
→ app-tx.js
→ app-categories.js
→ app-features.js
→ reports.js
→ firebase.js (type=module)
```

**ชื่อแสดงผล (PWA):**
- `name` / title: ระบบบันทึกต้นทุน กำไร - STone
- `short_name` (ใต้ไอคอน): STone

## Storage model (สำคัญ)

`SomtumStore` **ไม่ลบข้อมูลเดิม** และแยก scope ตามบัญชี:

| Scope | IndexedDB | localStorage keys |
|-------|-----------|-------------------|
| guest | `somtum-idb-v2` | ไม่ prefix (backward compatible) |
| logged-in uid | `somtum-idb-v2-u-<uid>` | `somtum@<uid>:...` (ยกเว้น global) |

Global keys (shared): `somtumDarkMode`, `somtumActiveScope`, `somtumDataOwnerUid`

1. เปิด IDB ตาม scope ปัจจุบัน
2. migrate จาก localStorage / legacy blob อัตโนมัติ
3. ถ้ามีข้อมูลทั้งสองฝั่ง → เลือกชุดที่รายการ transactions เยอะกว่า (และ checksum ยอด)
4. Dual-write เฉพาะ key เล็ก (flags) กลับ localStorage
5. Memory cache ทำให้ `getItem`/`setItem` ใช้แบบ sync เหมือนเดิม
6. ไม่ dual-write ไฟล์ appData ใหญ่เกิน `LS_APPDATA_MAX_CHARS` (400000) เพื่อกัน QuotaExceeded

Boot gate (`__storeReady` + `whenStoreReady`) ป้องกันการ save ทับ empty state ตอน cold start / auth restore

## UX defaults

- แดชบอร์ดเริ่มที่ตัวกรอง **รายเดือน**
- ปิด popup เตือนสำรองข้อมูลรายสัปดาห์ (Auto Backup เงียบในพื้นหลังยังทำงาน + Export JSON ได้ตามปกติ)

## CSP

meta CSP พื้นฐาน จำกัด script/style/connect เฉพาะ CDN ที่ใช้  
ยังต้องมี `'unsafe-inline'` เพราะมี `onclick=` และ Tailwind config inline  
(ถ้าจะ harden ต่อ ควรย้าย handlers ไป `addEventListener` + nonce)

## Service Worker

- กลยุทธ์ **network-first** สำหรับ HTML / `js/*` (deploy แล้วเห็นของใหม่เร็ว)
- `CORE_ASSETS` pre-cache รวมโมดูล `app-core` … `app-features` (offline-ready)
- `CACHE_NAME` ถูก bump อัตโนมัติเมื่อรัน `./build.sh`

## Build

```bash
chmod +x build.sh
./build.sh            # modular → dist/ (คัดลอกโมดูลทั้งหมด)
./build.sh --bundle   # รวม storage + app-* เป็น js/app.bundle.js
```

รันเทสต์ pure logic:

```bash
node tests/calc.test.js
node tests/storage-logic.test.js
node tests/e2e-flow.test.js
```

## Deploy บนมือถือ (GitHub)

1. อัปโหลดไฟล์ที่แก้ทับพาธเดิม
2. รอ Pages/hosting อัปเดต
3. เปิดแอปออนไลน์หนึ่งครั้ง (ให้ SW ตัวใหม่ติดตั้ง)
4. Hard refresh หรือปิด–เปิด PWA ถ้ายังเห็นของเก่า
