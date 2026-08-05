# ระบบบันทึกต้นทุน กำไร - STone

Modular PWA + IndexedDB (per-account scopes) + Firebase Auth/Firestore + CSP

## โครงสร้าง

```
STone/
├── index.html              # UI + CSP + script tags
├── service-worker.js       # network-first สำหรับ app shell (auth-safe)
├── build.sh                # modular หรือ --bundle → dist/
├── js/
│   ├── storage.js          # SomtumStore v2.1 (IDB per-tx + scope isolation)
│   ├── app.js              # UI / dashboard / categories / export / calc
│   └── firebase.js         # Auth + Firestore incremental sync (ES module)
├── tests/
│   ├── calc.test.js
│   └── storage-logic.test.js
├── dist/                   # ผลจาก build.sh สำหรับ deploy
└── icons (*.png)           # PWA icons รวม maskable
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

## CSP

meta CSP พื้นฐาน จำกัด script/style/connect เฉพาะ CDN ที่ใช้  
ยังต้องมี `'unsafe-inline'` เพราะมี `onclick=` และ Tailwind config inline  
(ถ้าจะ harden ต่อ ควรย้าย handlers ไป `addEventListener` + nonce)

## Build

```bash
chmod +x build.sh
./build.sh          # แยกไฟล์ → dist/  (และ bump CACHE_NAME อัตโนมัติ)
./build.sh --bundle # รวม storage+app → dist/js/app.bundle.js
```

เสิร์ฟด้วย static server (ต้องไม่ใช่ `file://` ถ้าจะใช้ module + SW):

```bash
npx serve dist
```

## ทดสอบ

```bash
node tests/calc.test.js
node tests/storage-logic.test.js
```

## ตรวจหลัง deploy

1. เปิดแอปครั้งแรกหลังอัปเดต → รายการเดิมครบ
2. DevTools → Application → IndexedDB → `somtum-idb-v2` (หรือ `...-u-<uid>`) มี store `meta` / `tx` / `kv`
3. localStorage ยังมีสำเนา key เล็กที่สำคัญ
4. บันทึกรายการใหม่ → refresh แล้วยังอยู่ (ออฟไลน์ได้)
5. Console: `[SomtumStore] migration complete` หรือ seed dirty ตามกรณี
6. ถ้าเคยติดตั้ง PWA เก่า (ชื่อเดิม) → ถอนติดตั้งแล้วติดตั้งใหม่เพื่อเห็น short_name = STone

## หมายเหตุ

- Key ภายในยังใช้ prefix `somtum*` เพื่อไม่ให้ข้อมูลเดิมหาย
- Service Worker ใช้ network-first สำหรับ HTML/JS เพื่อให้ hotfix auth/login ขึ้นทันที
- ไม่ cache traffic ของ Google/Firebase auth


## ความปลอดภัย & สโตร์

- `firestore.rules` — deploy ด้วย Firebase CLI (ดู SECURITY.md)
- `privacy.html` — นโยบายความเป็นส่วนตัว
- `manifest.webmanifest` — PWA / TWA แบบไฟล์คงที่
- `js/reports.js` — มอดูลรายงาน (PDF, สรุปรายเดือน, ใบสรุปประจำวัน)

### ทดสอบ

```bash
node tests/calc.test.js
node tests/storage-logic.test.js
node tests/e2e-flow.test.js
```

หมายเหตุ: key ข้อมูลในเครื่องยังใช้ prefix `somtum*` เพื่อไม่ให้ข้อมูลเก่าหาย ชื่อที่แสดงและมอดูลผู้ดูแลใช้ **STone**
