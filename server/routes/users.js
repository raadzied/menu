const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, username, role, full_name, is_active, created_at FROM users').all());
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role, full_name } = req.body || {};
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'اسم المستخدم مطلوب وكلمة المرور يجب أن تكون 8 أحرف على الأقل' });
  }
  try {
    const hash = bcrypt.hashSync(password, 12);
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, role, full_name) VALUES (?,?,?,?)
    `).run(username, hash, role === 'admin' ? 'admin' : 'cashier', full_name || null);
    db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
      .run(req.session.userId, 'create_user', `إنشاء مستخدم: ${username}`);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل' });
  }
});

router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { password, role, full_name, is_active } = req.body || {};
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
    const hash = bcrypt.hashSync(password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  }
  db.prepare(`
    UPDATE users SET role = COALESCE(?, role), full_name = COALESCE(?, full_name), is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(role ?? null, full_name ?? null, is_active ?? null, id);
  db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
    .run(req.session.userId, 'update_user', `تعديل مستخدم id=${id}`);
  res.json({ ok: true });
});

module.exports = router;
