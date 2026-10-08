const express = require('express');
console.log('[orders.js] loaded (counter mode — no tables/sessions)');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { nowSql } = require('../utils');

const router = express.Router();

const MAX_LINES = 30;
const MAX_QTY_PER_LINE = 50;
const MAX_NOTES_LEN = 300;
const optStmt = db.prepare('SELECT * FROM item_options WHERE menu_item_id = ? AND id = ?');

/* حماية من سبام الطلبات: 10 طلبات/دقيقة لكل جهاز (ذاكرة محلية) */
const orderHits = new Map();
function orderThrottle(req) {
  if (orderHits.size > 2000) orderHits.clear();
  const key = req.ip || 'x';
  const now = Date.now();
  const e = orderHits.get(key);
  if (!e || now - e.start > 60000) { orderHits.set(key, { count: 1, start: now }); return true; }
  e.count += 1;
  return e.count <= 10;
}

/* طلب كاونتر: بدون طاولة وبدون جلسة — الزبون يستلم رقمًا ويدفع عند الكاشير */
router.post('/', (req, res) => {
  const { items, notes } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'بيانات الطلب غير مكتملة' });
  }
  if (!orderThrottle(req)) return res.status(429).json({ error: 'طلبات كثيرة، انتظر دقيقة وحاول مجددًا' });
  if (items.length > MAX_LINES) return res.status(400).json({ error: 'عدد الأصناف في الطلب كبير جدًا' });
  let cleanNotes = null;
  if (notes != null && String(notes).trim() !== '') {
const n = String(notes).split('').filter((ch) => { const c = ch.charCodeAt(0); return c >= 32 || c === 9 || c === 10 || c === 13; }).join('').trim();
    if (n.length > MAX_NOTES_LEN) return res.status(400).json({ error: 'الملاحظة أطول من الحد المسموح (300 حرف)' });
    cleanNotes = n || null;
  }

  const itemStmt = db.prepare('SELECT * FROM menu_items WHERE id = ? AND is_available = 1');
  let total = 0;
  const lineItems = [];
  for (const it of items) {
    const itemId = Number(it && it.menu_item_id);
    if (!Number.isInteger(itemId) || itemId <= 0) return res.status(400).json({ error: 'بيانات صنف غير صحيحة' });
    const menuItem = itemStmt.get(itemId);
    if (!menuItem) return res.status(400).json({ error: `صنف غير متاح: ${itemId}` });
    const qtyRaw = parseInt(it.quantity, 10);
    if (!Number.isFinite(qtyRaw) || qtyRaw < 1 || qtyRaw > MAX_QTY_PER_LINE) {
      return res.status(400).json({ error: `كمية الصنف "${menuItem.name_ar}" غير صحيحة (الحد الأقصى ${MAX_QTY_PER_LINE})` });
    }
    const qty = qtyRaw;
    /* الخيارات: يجب أن تكون معرّفات صحيحة وتابعة لهذا الصنف تحديدًا (منع خلط الأصناف) */
    let rawOpts = [];
    if (Array.isArray(it.options) && it.options.length) {
      if (it.options.length > 10) return res.status(400).json({ error: 'عدد الإضافات كبير جدًا' });
      rawOpts = [...new Set(it.options.map((o) => Number(o)))];
      if (rawOpts.some((o) => !Number.isInteger(o) || o <= 0)) return res.status(400).json({ error: 'إضافة غير صحيحة' });
      for (const oid of rawOpts) {
        const opt = optStmt.get(menuItem.id, oid);
        if (!opt) return res.status(400).json({ error: 'إضافة لا تخص الصنف المحدد' });
      }
    }
    const extra = rawOpts.reduce((s, oid) => {
      const o = optStmt.get(menuItem.id, oid);
      return s + Math.max(0, Number(o && o.extra_price) || 0);
    }, 0);
    const unitPrice = Math.max(0, menuItem.price) + extra;
    const lineTotal = unitPrice * qty;
    total += lineTotal;
    lineItems.push({
      menu_item_id: menuItem.id, item_name_ar: menuItem.name_ar, unit_price: unitPrice,
      quantity: qty, options_json: JSON.stringify(rawOpts), line_total: lineTotal,
    });
  }

  const insertOrder = db.transaction(() => {
    const orderInfo = db.prepare(`
      INSERT INTO orders (status, notes, total) VALUES (?,?,?)
    `).run('pending', cleanNotes, total);
    const insertLine = db.prepare(`
      INSERT INTO order_items (order_id, menu_item_id, item_name_ar, unit_price, quantity, options_json, line_total)
      VALUES (?,?,?,?,?,?,?)
    `);
    for (const li of lineItems) {
      insertLine.run(orderInfo.lastInsertRowid, li.menu_item_id, li.item_name_ar, li.unit_price, li.quantity, li.options_json, li.line_total);
    }
    return orderInfo.lastInsertRowid;
  });

  const orderId = insertOrder();
  res.json({ ok: true, order_id: orderId, total });
});

router.get('/last-id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT COALESCE(MAX(id),0) AS max_id FROM orders').get();
  res.json(row);
});

router.get('/new-since/:id', requireAuth, (req, res) => {
  const sinceId = parseInt(req.params.id, 10);
  if (Number.isNaN(sinceId) || sinceId < 0) return res.status(400).json({ error: 'معرف غير صحيح' });
  const rows = db.prepare(`
    SELECT id, total, created_at, notes FROM orders
    WHERE id > ? AND status = 'pending'
    ORDER BY id ASC
  `).all(sinceId);
  res.json(rows);
});

/* تتبع عام برقم الطلب (شاشة كاونتر — لا بيانات حساسة تُعرض) */
router.get('/:id/track', (req, res) => {
  const order = db.prepare(`
    SELECT id, status, total, created_at FROM orders WHERE id = ?
  `).get(req.params.id);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json(order);
});

router.get('/', requireAuth, (req, res) => {
  const { status } = req.query;
  let rows;
  if (status) {
    rows = db.prepare(`
      SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC
    `).all(status);
  } else {
    rows = db.prepare(`
      SELECT * FROM orders ORDER BY created_at DESC LIMIT 200
    `).all();
  }
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  res.json(rows.map((o) => ({ ...o, items: itemsStmt.all(o.id) })));
});

router.patch('/:id/status', requireAuth, (req, res) => {
  const { status } = req.body || {};
  const allowed = ['pending', 'confirmed', 'preparing', 'served', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'حالة غير صحيحة' });
  const info = db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'الطلب غير موجود' });
  try {
    db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)')
      .run(req.session.userId, 'update_order_status', `تحديث حالة الطلب #${req.params.id} إلى ${status}`);
  } catch (e) { console.error('audit fail:', e); }
  res.json({ ok: true });
});

module.exports = router;
