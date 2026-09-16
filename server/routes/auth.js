const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { brand } = require('../brand');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'محاولات دخول كثيرة جدًا، حاول مرة أخرى بعد قليل' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
  if (!user) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'خطأ في الخادم' });
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
      .run(user.id, 'login', `تسجيل دخول: ${user.username}`);
    res.json({ ok: true, user: { username: user.username, role: user.role, full_name: user.full_name } });
  });
});

router.post('/logout', (req, res) => {
  const userId = req.session.userId;
  if (userId) {
    db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
      .run(userId, 'logout', 'تسجيل خروج');
  }
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
