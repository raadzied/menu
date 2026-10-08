const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'restaurant.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db;

function loadSchema() {
  if (fs.existsSync(SCHEMA_PATH)) {
    const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(sql);
  }
}

try {
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON');
  loadSchema();
} catch (e) {
  console.error('فشل فتح قاعدة البيانات:', e.message);
  throw e;
}

const rawTransaction = db.transaction && typeof db.transaction === 'function'
  ? db.transaction.bind(db)
  : null;

db.transaction = function (fn) {
  if (rawTransaction) {
    return rawTransaction(fn);
  }
  return function (...args) {
    try {
      db.exec('BEGIN');
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
};

/* ===== ترحيل إزالة نظام الطاولات (idempotent) =====
   قرار الإدارة: حذف الطاولات/الجلسات/الأكواد نهائيًا (تُعاد في تحديث لاحق —
   النسخة الكاملة محفوظة في فرع git المستقل backup-full-tables-system).
   القواعد الحالية خالية من الطلبات، فيُسقط الهيكل القديم مباشرة. */
function migrate() {
  db.exec('DROP TABLE IF EXISTS session_devices');
  db.exec('DROP TABLE IF EXISTS redeem_guard');
  db.exec('DROP TABLE IF EXISTS hotspot_clients');
  db.exec('DROP TABLE IF EXISTS table_sessions');
  db.exec('DROP TABLE IF EXISTS tables');
  db.exec('DROP INDEX IF EXISTS idx_orders_table');
  db.exec('DROP INDEX IF EXISTS idx_sessions_table');
  db.exec('DROP INDEX IF EXISTS idx_sessions_status');
  db.exec('DROP INDEX IF EXISTS idx_tables_card_code');
  db.exec('DROP INDEX IF EXISTS idx_one_active_per_table');
  // إسقاط عمودي table_id وsession_id من الطلبات (مراجع لجداول محذوفة —
  // بقاؤهما يكسر أي INSERT لأن FK يتطلب وجود الجدول الأب)
  try {
    const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
    if (cols.includes('table_id')) db.exec('ALTER TABLE orders DROP COLUMN table_id');
    if (cols.includes('session_id')) db.exec('ALTER TABLE orders DROP COLUMN session_id');
  } catch (e) {
    console.error('تحذير: تعذر إسقاط أعمدة الطلبات:', e.message);
  }
}

try {
  migrate();
} catch (e) {
  console.error('تحذير: فشل ترحيل قاعدة البيانات:', e.message);
}

module.exports = db;
