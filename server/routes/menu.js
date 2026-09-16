const express = require('express');
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function cleanTextField(v, max) {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return s.slice(0, max);
}
function cleanPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n < 0 || n > 1e9) return null;
  return n;
}
/* صورة الصنف: مسار محلي أو data:image/base64 فقط — يمنع javascript: وdata:text */
function cleanImagePath(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\/[A-Za-z0-9._/-]{1,300}$/.test(s)) return s;
  if (/^https?:\/\/[A-Za-z0-9._:/%-]{1,300}$/.test(s)) return s;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]{1,1600000}$/.test(s.replace(/\s/g, ''))) {
    return s.replace(/\s/g, '');
  }
  return null;
}

router.get('/public', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order').all();
  const itemsStmt = db.prepare(`SELECT * FROM menu_items WHERE category_id = ? AND is_available = 1 ORDER BY sort_order`);
  const optionsStmt = db.prepare('SELECT * FROM item_options WHERE menu_item_id = ? ORDER BY sort_order');
  const data = categories.map((c) => ({
    ...c,
    items: itemsStmt.all(c.id).map((it) => ({ ...it, options: optionsStmt.all(it.id) })),
  }));
  res.json(data);
});

router.get('/categories', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order').all());
});

router.post('/categories', requireAuth, requireAdmin, (req, res) => {
  const { name_ar, name_en, sort_order } = req.body || {};
  if (!name_ar) return res.status(400).json({ error: 'اسم القسم بالعربي مطلوب' });
  const info = db.prepare('INSERT INTO categories (name_ar, name_en, sort_order) VALUES (?,?,?)')
    .run(name_ar, name_en || null, sort_order || 0);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.patch('/categories/:id', requireAuth, requireAdmin, (req, res) => {
  const { name_ar, name_en, sort_order, is_active } = req.body || {};
  db.prepare(`
    UPDATE categories SET name_ar = COALESCE(?, name_ar), name_en = COALESCE(?, name_en),
      sort_order = COALESCE(?, sort_order), is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(name_ar ?? null, name_en ?? null, sort_order ?? null, is_active ?? null, req.params.id);
  res.json({ ok: true });
});

router.delete('/categories/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/items', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM menu_items ORDER BY category_id, sort_order').all());
});

router.post('/items', requireAuth, requireAdmin, (req, res) => {
  let { category_id, name_ar, name_en, description_ar, price, image_path, is_spicy, sort_order } = req.body || {};
  name_ar = cleanTextField(name_ar, 120);
  name_en = cleanTextField(name_en, 120);
  description_ar = cleanTextField(description_ar, 500);
  const cleanImg = cleanImagePath(image_path);
  if (image_path != null && String(image_path).trim() !== '' && cleanImg == null) {
    return res.status(400).json({ error: 'مسار/بيانات الصورة غير صحيحة' });
  }
  image_path = cleanImg;
  if (!category_id || !name_ar || price == null) {
    return res.status(400).json({ error: 'القسم والاسم والسعر حقول مطلوبة' });
  }
  price = cleanPrice(price);
  if (price == null) return res.status(400).json({ error: 'السعر غير صحيح' });
  const info = db.prepare(`
    INSERT INTO menu_items (category_id, name_ar, name_en, description_ar, price, image_path, is_spicy, sort_order)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(category_id, name_ar, name_en || null, description_ar || null, price, image_path || null, is_spicy ? 1 : 0, sort_order || 0);
  db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
    .run(req.session.userId, 'create_item', `إضافة صنف: ${name_ar}`);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.patch('/items/:id', requireAuth, requireAdmin, (req, res) => {
  let { category_id, name_ar, name_en, description_ar, price, image_path, is_available, is_spicy, sort_order } = req.body || {};
  name_ar = name_ar !== undefined && name_ar !== null ? cleanTextField(name_ar, 120) : null;
  name_en = name_en !== undefined && name_en !== null ? cleanTextField(name_en, 120) : null;
  description_ar = description_ar !== undefined && description_ar !== null ? cleanTextField(description_ar, 500) : null;
  if (image_path !== undefined && image_path !== null && String(image_path) !== '') {
    const cleanImg = cleanImagePath(image_path);
    if (cleanImg == null) return res.status(400).json({ error: 'مسار/بيانات الصورة غير صحيحة' });
    image_path = cleanImg;
  }
  if (price != null) {
    price = cleanPrice(price);
    if (price == null) return res.status(400).json({ error: 'السعر غير صحيح' });
  }
  db.prepare(`
    UPDATE menu_items SET
      category_id = COALESCE(?, category_id), name_ar = COALESCE(?, name_ar),
      name_en = COALESCE(?, name_en), description_ar = COALESCE(?, description_ar),
      price = COALESCE(?, price), image_path = COALESCE(?, image_path),
      is_available = COALESCE(?, is_available), is_spicy = COALESCE(?, is_spicy),
      sort_order = COALESCE(?, sort_order), updated_at = datetime('now')
    WHERE id = ?
  `).run(
    category_id ?? null, name_ar ?? null, name_en ?? null, description_ar ?? null,
    price ?? null, image_path ?? null, is_available ?? null, is_spicy ?? null, sort_order ?? null, req.params.id
  );
  db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
    .run(req.session.userId, 'update_item', `تعديل صنف id=${req.params.id}`);
  res.json({ ok: true });
});

router.delete('/items/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
  db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
    .run(req.session.userId, 'delete_item', `حذف صنف id=${req.params.id}`);
  res.json({ ok: true });
});

module.exports = router;
