# ส้มตำนายหนึ่ง — Modular + IndexedDB + CSP

## โครงสร้าง

```
somtum-app/
├── index.html          # UI + CSP + script tags
├── service-worker.js   # cache v6 (รวม js/*)
├── build.sh            # modular หรือ --bundle
├── js/
│   ├── storage.js      # SomtumStore (IndexedDB + migrate จาก localStorage)
│   ├── app.js          # UI / dashboard / categories / export
│   ├── firebase.js     # Auth + Firestore sync (ES module)
│   └── app.bundle.js   # (optional) storage+app รวมกัน
└── dist/               # ผลจาก build.sh สำหรับ deploy
```

## การย้ายข้อมูล (สำคัญ)

`SomtumStore` **ไม่ลบข้อมูลเดิม**:

1. เปิด IndexedDB `somtum-idb-v1`
2. อ่าน `localStorage` ทุก key ที่ขึ้นต้น `somtum`
3. ถ้ามีข้อมูลทั้งสองฝั่ง → เลือกชุดที่ **รายการ transactions เยอะกว่า** (และ checksum ยอด)
4. **Dual-write** key สำคัญกลับไป localStorage ด้วย (กันเครื่องที่ IDB ล้ม)
5. Memory cache ทำให้ `getItem/setItem` ใช้แบบ sync เหมือนเดิม

ข้อมูลเก่าใน `localStorage.somtumAppData` จะถูกย้ายอัตโนมัติครั้งแรกที่เปิดแอปหลังอัปเดต

## CSP

ใส่ meta CSP พื้นฐาน จำกัด script/style/connect เฉพาะ CDN ที่ใช้  
ยังต้องมี `'unsafe-inline'` เพราะมี `onclick=` และ Tailwind config inline  
(ถ้าจะ harden ต่อ ควรย้าย handlers ไป `addEventListener` + nonce)

## Build

```bash
./build.sh          # แยกไฟล์ → dist/
./build.sh --bundle # รวม storage+app → dist/js/app.bundle.js
```

เสิร์ฟด้วย static server (ต้องไม่ใช่ `file://` ถ้าจะใช้ module + SW):

```bash
npx serve dist
```

## ตรวจหลัง deploy

1. เปิดแอปครั้งแรกหลังอัปเดต → รายการเดิมครบ
2. DevTools → Application → IndexedDB → `somtum-idb-v1` มี `somtumAppData`
3. localStorage ยังมีสำเนา key สำคัญ
4. บันทึกรายการใหม่ → refresh แล้วยังอยู่ (ออฟไลน์ได้)
5. Console: `[SomtumStore] migration complete`
