# STone — Security notes

## Firestore rules

ไฟล์ `firestore.rules` จำกัดการเข้าถึงเฉพาะเจ้าของ `users/{uid}/...` เท่านั้น

```bash
# ต้องมี Firebase CLI และล็อกอินโปรเจกต์ stone-3eac7 (หรือโปรเจกต์จริงของคุณ)
firebase deploy --only firestore:rules
```

ตรวจใน Firebase Console → Firestore → Rules ว่า rules ล่าสุดถูก publish แล้ว

## หลักการ

- ผู้ใช้ที่ไม่ได้ล็อกอิน **อ่าน/เขียน cloud ไม่ได้**
- ผู้ใช้ A **เข้าถึง users/B ไม่ได้**
- ธุรกรรมต้องมี `type` เป็น `income` | `expense` และ `amount > 0`

## ข้อมูลบนเครื่อง

- Key ภายในยังขึ้นต้น `somtum*` เพื่อไม่ให้ข้อมูลเก่าหายหลังอัปเดต
- ชื่อที่ผู้ใช้เห็นและชื่อมอดูลผู้ดูแลใช้ **STone**

## CSP

`index.html` มี Content-Security-Policy พื้นฐาน ยังต้องมี `unsafe-inline` สำหรับ handler เดิม

## Checklist ก่อน production

- [ ] Deploy `firestore.rules`
- [ ] เปิดเฉพาะ OAuth client / domain ที่ใช้จริงใน Firebase Auth
- [ ] ทดสอบล็อกอินจากโดเมน production
- [ ] มีหน้า `privacy.html` ลิงก์จากแอปและจากหน้าร้านสโตร์
