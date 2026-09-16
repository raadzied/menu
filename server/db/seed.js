require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./database');
const { brand } = require('../brand');
function makeToken() {
  return crypto.randomBytes(16).toString('hex');
}

function run() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    const hash = bcrypt.hashSync(password, 12);
    db.prepare(`INSERT INTO users (username, password_hash, role, full_name) VALUES (?,?,?,?)`)
      .run(username, hash, 'admin', 'مدير النظام');
    console.log(`تم إنشاء حساب المدير: ${username} / ${password} (يرجى تغيير كلمة المرور فورًا من لوحة التحكم)`);
  } else {
    console.log('يوجد مستخدمون بالفعل، تم تخطي إنشاء حساب المدير.');
  }

  const tableCount = db.prepare('SELECT COUNT(*) AS c FROM tables').get().c;
  if (tableCount === 0) {
    const defaultMinutes = parseInt(process.env.DEFAULT_TABLE_SESSION_MINUTES || '20', 10);
    const insertTable = db.prepare(
      `INSERT INTO tables (table_number, label, token, session_minutes) VALUES (?,?,?,?)`
    );
    const insertMany = db.transaction((count) => {
      for (let i = 1; i <= count; i++) {
        insertTable.run(i, `طاولة ${i}`, makeToken(), defaultMinutes);
      }
    });
    insertMany(15);
    console.log('تم إنشاء 15 طاولة افتراضية.');
  } else {
    console.log('توجد طاولات بالفعل، تم تخطي إنشاء الطاولات.');
  }

  const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (!brand.demoMenu) {
    console.log('الهوية بلا منيو تجريبي (demo_menu=false) — تبدأ بقوائم فارغة، أضف الأصناف من لوحة التحكم.');
  } else if (catCount === 0) {
    const insertCat = db.prepare(
      `INSERT INTO categories (name_ar, name_en, sort_order) VALUES (?,?,?)`
    );
    const categories = [
      ['رولات مسخن', 'Musakhan Rolls', 1],
      ['المقبلات', 'Appetizers', 2],
      ['البيتزا', 'Pizza', 3],
      ['المشروبات', 'Beverages', 4],
      ['الحلويات', 'Desserts', 5],
    ];
    const catIds = {};
    const insertAll = db.transaction(() => {
      for (const [ar, en, order] of categories) {
        const info = insertCat.run(ar, en, order);
        catIds[ar] = info.lastInsertRowid;
      }
    });
    insertAll();

    const insertItem = db.prepare(`
      INSERT INTO menu_items (category_id, name_ar, name_en, description_ar, price, is_spicy, sort_order)
      VALUES (?,?,?,?,?,?,?)
    `);

    const itemsFixed = [
      ['رولات مسخن', 'مسخن رولز دجاج', 'Chicken Musakhan Rolls', 'رولات الدجاج المسخن بالبصل والسماق مع صلصة الطحينة', 4500, 0, 1],
      ['رولات مسخن', 'مسخن رولز لحم', 'Beef Musakhan Rolls', 'رولات اللحم المسخن بالبصل والسماق والصنوبر', 5000, 0, 2],
      ['رولات مسخن', 'مسخن رولز مشكل', 'Mixed Musakhan Rolls', 'خليط لحم ودجاج مسخن مع صلصة الطحينة الخاصة', 5500, 1, 3],
      ['المقبلات', 'حمص بالطحينة', 'Hummus', 'حمص كريمي مع زيت الزيتون وحبات الحمص الكاملة', 1800, 0, 1],
      ['المقبلات', 'متبل باذنجان', 'Mutabbal', 'باذنجان مشوي مهروس مع الطحينة والثوم', 1800, 0, 2],
      ['المقبلات', 'فتوش', 'Fattoush Salad', 'سلطة خضار طازجة مع خبز محمص ودبس الرمان', 2000, 0, 3],
      ['البيتزا', 'بيتزا زعتر وجبنة', 'Zaatar Cheese Pizza', 'عجينة طازجة مع خليط الزعتر البلدي وجبنة موزاريلا', 3200, 0, 1],
      ['البيتزا', 'بيتزا دجاج مشوي', 'Grilled Chicken Pizza', 'قطع دجاج مشوي مع فلفل ملون وجبن موزاريلا', 3600, 0, 2],
      ['البيتزا', 'بيتزا سوبريم مسخن', 'Musakhan Supreme Pizza', 'دجاج مسخن وبصل وسماق وصنوبر فوق قاعدة بيتزا مقرمشة', 3900, 0, 3],
      ['المشروبات', 'شاي بالنعناع', 'Mint Tea', 'شاي أحمر طازج مع النعناع', 700, 0, 1],
      ['المشروبات', 'عصير ليمون بالنعناع', 'Lemon Mint Juice', 'عصير ليمون طازج مع النعناع المثلج', 1200, 0, 2],
      ['المشروبات', 'مشروب غازي', 'Soft Drink', 'علبة مشروب غازي مبرد', 500, 0, 3],
      ['الحلويات', 'كنافة نابلسية', 'Nabulsi Kunafa', 'كنافة جبنة ساخنة مغطاة بالقطر والفستق', 2500, 0, 1],
      ['الحلويات', 'مغلي', 'Maghli', 'حلوى تقليدية بالقرفة والمكسرات', 1500, 0, 2],
      ['الحلويات', 'قطايف', 'Qatayef', 'قطايف محشوة بالجوز أو الجبنة مع القطر', 2000, 0, 3],
    ];
    const insertFixed = db.transaction(() => {
      for (const [catAr, nameAr, nameEn, desc, price, spicy, order] of itemsFixed) {
        insertItem.run(catIds[catAr], nameAr, nameEn, desc, price, spicy, order);
      }
    });
    insertFixed();
    console.log(`تم إدخال أقسام وأصناف المنيو التجريبية (${brand.nameAr}).`);
  } else {
    console.log('توجد أقسام منيو بالفعل، تم تخطي التهيئة.');
  }

  console.log('\nاكتملت تهيئة قاعدة البيانات بنجاح.');
}

module.exports = { run };
if (require.main === module) run();
