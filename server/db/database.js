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

/* ===== ترحيلات آمنة عند الإقلاع (idempotent) ===== */
const CODE_ALPHABET = '0123456789';
const CARD_CODE_LEN = 6;

function genCardCode(existing) {
  let code;
  do {
    code = '';
    for (let i = 0; i < CARD_CODE_LEN; i++) code += crypto.randomInt(0, CODE_ALPHABET.length).toString();
  } while (existing.has(code));
  existing.add(code);
  return code;
}

function migrate() {
  const cols = db.prepare('PRAGMA table_info(tables)').all().map((c) => c.name);
  if (!cols.includes('card_code')) db.exec('ALTER TABLE tables ADD COLUMN card_code TEXT');
  if (!cols.includes('evict_until')) db.exec('ALTER TABLE tables ADD COLUMN evict_until TEXT');

  const needsRegen = db.prepare(
    "SELECT COUNT(*) AS c FROM tables WHERE card_code IS NULL OR length(card_code) != 6 OR card_code GLOB '*[^0-9]*'"
  ).get().c;
  if (needsRegen > 0) {
    const used = new Set();
    for (const row of db.prepare('SELECT id FROM tables').all()) {
      db.prepare('UPDATE tables SET card_code = ? WHERE id = ?').run(genCardCode(used), row.id);
    }
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_card_code ON tables(card_code)');

  db.exec(`CREATE TABLE IF NOT EXISTS session_devices (
    session_id INTEGER NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
    ip TEXT NOT NULL,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, ip)
  )`);

  // إغلاق أي جلسات active مكررة لطاولة (إبقاء الأحدث) ثم فرض قيد الفريدة
  db.exec(`
    UPDATE table_sessions SET status='closed', ended_at = datetime('now')
    WHERE status='active' AND id NOT IN (
      SELECT MAX(id) FROM table_sessions WHERE status='active' GROUP BY table_id
    )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_per_table ON table_sessions(table_id) WHERE status='active'`);
}

try {
  migrate();
} catch (e) {
  console.error('تحذير: فشل ترحيل قاعدة البيانات:', e.message);
}

module.exports = db;
