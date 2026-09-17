const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { brand } = require('../brand');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'محاولات دخول كثيرة جدًا، حاول مرة أخرى بعد قليل' },
  standardHeaders: true,
  legacyHeaders: false,
});

const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8u8W6hgpXbxYkq7g3XCxdCUxE8bhSa';

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
  
  const ok = user 
    ? await bcrypt.compare(password, user.password_hash) 
    : await bcrypt.compare(password, DUMMY_HASH);

  if (!user || !ok) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'خطأ في الخادم' });
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    try {
      db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
        .run(user.id, 'login', `تسجيل دخول: ${user.username}`);
    } catch (e) { console.error('audit fail:', e); }
    res.json({ ok: true, user: { username: user.username, role: user.role, full_name: user.full_name } });
  });
});

router.post('/logout', requireAuth, (req, res) => {
  const userId = req.session.userId;
  try {
    db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
      .run(userId, 'logout', 'تسجيل خروج');
  } catch (e) { console.error('audit fail:', e); }
  
  req.session.destroy(() => {
    res.clearCookie(brand.cookieName);
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'غير مسجل الدخول' });
  res.json({ username: req.session.username, role: req.session.role });
});

module.exports = router;
