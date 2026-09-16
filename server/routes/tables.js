const express = require('express');
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generateToken, minutesFromNow, nowSql, randomDigits, CARD_CODE_LEN } = require('../utils');
const { evictSession } = require('../evict');

const router = express.Router();

function newCardCode() {
  for (let i = 0; i < 50; i++) {
    const code = randomDigits(CARD_CODE_LEN);
    const clash = db.prepare('SELECT 1 FROM tables WHERE card_code = ?').get(code);
    if (!clash) return code;
  }
  return null;
}

router.get('/', requireAuth, (req, res) => {
  const expired = db.prepare(`
    SELECT * FROM table_sessions WHERE status = 'active' AND expires_at < datetime('now')
  `).all();
  for (const session of expired) {
    db.prepare(`UPDATE table_sessions SET status='expired', ended_at = ? WHERE id = ?`).run(nowSql(), session.id);
    db.prepare(`UPDATE tables SET status='available' WHERE id = ?`).run(session.table_id);
    evictSession(db, { tableId: session.table_id, sessionId: session.id, reason: 'expired' });
  }
  const tables = db.prepare('SELECT * FROM tables ORDER BY table_number').all();
  const activeSessionStmt = db.prepare(`
    SELECT * FROM table_sessions WHERE table_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1
  `);
  const devicesStmt = db.prepare('SELECT COUNT(*) AS c FROM session_devices WHERE session_id = ?');
  res.json(tables.map((t) => {
    const s = activeSessionStmt.get(t.id) || null;
    if (s) s.device_count = devicesStmt.get(s.id).c;
    return { ...t, active_session: s };
  }));
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { table_number, label, session_minutes, token } = req.body || {};
  if (!table_number) return res.status(400).json({ error: 'رقم الطاولة مطلوب' });
  try {
    const finalToken = token && /^[a-f0-9]{32}$/.test(token) ? token : generateToken();
    const code = newCardCode();
    if (!code) return res.status(500).json({ error: 'تعذر توليد كود الطاولة' });
    const info = db.prepare(
      `INSERT INTO tables (table_number, label, token, session_minutes, card_code) VALUES (?,?,?,?,?)`
    ).run(table_number, label || `طاولة ${table_number}`, finalToken, session_minutes || 20, code);
    db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
      .run(req.session.userId, 'create_table', `إنشاء طاولة رقم ${table_number}`);
    res.json({ ok: true, id: info.lastInsertRowid, token: finalToken, card_code: code });
  } catch (e) {
    res.status(400).json({ error: 'رقم الطاولة مستخدم بالفعل أو بيانات غير صحيحة' });
  }
});

router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { label, session_minutes, status, reset_code } = req.body || {};
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
  if (!table) return res.status(404).json({ error: 'الطاولة غير موجودة' });
  if ('token' in req.body) return res.status(400).json({ error: 'رمز الطاولة دائم ولا يمكن تغييره' });
  if ('table_number' in req.body) return res.status(400).json({ error: 'رقم الطاولة لا يمكن تعديله بعد إنشاء الرمز' });
  db.prepare(`
    UPDATE tables SET label = COALESCE(?, label), session_minutes = COALESCE(?, session_minutes), status = COALESCE(?, status)
    WHERE id = ?
  `).run(label ?? null, session_minutes ?? null, status ?? null, id);
  let newCode = null;
  if (reset_code) {
    newCode = newCardCode();
    if (!newCode) return res.status(500).json({ error: 'تعذر توليد كود جديد' });
    db.prepare('UPDATE tables SET card_code = ? WHERE id = ?').run(newCode, id);
    require('./session_public').clearCodeGuard(String(newCode), String(table.card_code || ''));
    db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
      .run(req.session.userId, 'reset_card_code', `إعادة توليد كود الطاولة رقم ${table.table_number}`);
  }
  db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
    .run(req.session.userId, 'update_table', `تعديل طاولة رقم ${table.table_number}`);
  res.json({ ok: true, card_code: newCode });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tables WHERE id = ?').run(req.params.id);
  db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
    .run(req.session.userId, 'delete_table', `حذف طاولة id=${req.params.id}`);
  res.json({ ok: true });
});

router.post('/:id/session/start', requireAuth, (req, res) => {
  const { id } = req.params;
  const { minutes } = req.body || {};
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
  if (!table) return res.status(404).json({ error: 'الطاولة غير موجودة' });
  db.prepare(`UPDATE table_sessions SET status='closed', ended_at = ? WHERE table_id = ? AND status='active'`)
    .run(nowSql(), id);
  const duration = minutes && minutes > 0 ? minutes : table.session_minutes;
  const expiresAt = minutesFromNow(duration);
  const info = db.prepare(`
    INSERT INTO table_sessions (table_id, duration_minutes, expires_at, status) VALUES (?,?,?, 'active')
  `).run(id, duration, expiresAt);
  db.prepare(`UPDATE tables SET status='occupied' WHERE id = ?`).run(id);
  db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
    .run(req.session.userId, 'start_session', `بدء جلسة لطاولة رقم ${table.table_number} لمدة ${duration} دقيقة`);
  res.json({ ok: true, session_id: info.lastInsertRowid, expires_at: expiresAt });
});

router.post('/:id/session/extend', requireAuth, (req, res) => {
  const { id } = req.params;
  const addMinutes = parseInt((req.body || {}).minutes, 10);
  if (!addMinutes || addMinutes <= 0) return res.status(400).json({ error: 'عدد الدقائق غير صحيح' });
  const session = db.prepare(`SELECT * FROM table_sessions WHERE table_id = ? AND status='active' ORDER BY id DESC LIMIT 1`).get(id);
  if (!session) return res.status(404).json({ error: 'لا توجد جلسة نشطة لهذه الطاولة' });
  const base = new Date(session.expires_at.replace(' ', 'T') + 'Z').getTime();
  const newExpires = new Date(base + addMinutes * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(`UPDATE table_sessions SET expires_at = ?, extended_by_minutes = extended_by_minutes + ? WHERE id = ?`)
    .run(newExpires, addMinutes, session.id);
  db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
    .run(req.session.userId, 'extend_session', `تمديد جلسة الطاولة id=${id} بمقدار ${addMinutes} دقيقة`);
  res.json({ ok: true, expires_at: newExpires });
});

router.post('/:id/session/end', requireAuth, (req, res) => {
  const { id } = req.params;
  const session = db.prepare(`SELECT * FROM table_sessions WHERE table_id = ? AND status='active' ORDER BY id DESC LIMIT 1`).get(id);
  db.prepare(`UPDATE table_sessions SET status='closed', ended_at = ? WHERE table_id = ? AND status='active'`)
    .run(nowSql(), id);
  db.prepare(`UPDATE tables SET status='available' WHERE id = ?`).run(id);
  evictSession(db, { tableId: parseInt(id, 10), sessionId: session ? session.id : null, reason: 'closed_by_cashier' });
  if (session) {
    db.prepare(`UPDATE orders SET status='served', updated_at = datetime('now')
                WHERE session_id = ? AND status IN ('pending','confirmed','preparing')`).run(session.id);
  }
  db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
    .run(req.session.userId, 'end_session', `إغلاق الفاتورة وإنهاء جلسة الطاولة id=${id}`);
  res.json({ ok: true });
});

module.exports = router;
