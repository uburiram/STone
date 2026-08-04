ไฟล์ที่แก้แล้วสำหรับ uburiram/STone

ชื่อแอป (แสดงผล):
  name / title: ระบบบันทึกต้นทุน กำไร - STone
  short_name (ใต้ไอคอนบนหน้าจอ): STone

วางทับใน repo:
  js/app.js
  js/firebase.js
  service-worker.js
  index.html
  build.sh

storage.js ไม่ต้องแก้ (key ภายใน somtum* คงเดิมเพื่อไม่เสียข้อมูล)

หลัง copy:
  chmod +x build.sh && ./build.sh

หมายเหตุ PWA: ถ้าเคยติดตั้งแอปเก่า ต้องถอนติดตั้งแล้วติดตั้งใหม่
จึงจะเห็นชื่อใหม่บนหน้าจอหลัก
