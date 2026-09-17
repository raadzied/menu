const express = require('express');
console.log('[orders.js] loaded, bills route defined at line 119');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { nowSql } = require('../utils');

const router = express.Router();

const MAX_LINES = 30;
const MAX_QTY_PER_LINE = 50;
const MAX_NOTES_LEN = 300;
const optStmt = db.prepare('SELECT * FROM item_options WHERE menu_item_id = ? AND id = ?');

router.post('/', (req, res) => {
  const { session_id, table_token, items, notes } = req.body || {};
  if (!session_id || !table_token || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'بيانات الطلب غير مكتملة' });
  }
  if (items.length > MAX_LINES) return res.status(400).json({ error: 'عدد الأصناف في الطلب كبير جدًا' });
  let cleanNotes = null;
  if (notes != null && String(notes).trim() !== '') {
    const n = String(notes).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (n.length > MAX_NOTES_LEN) return res.status(400).json({ error: 'الملاحظة أطول من الحد المسموح (300 حرف)' });
    cleanNotes = n || null;
  }
  const table = db.prepare('SELECT * FROM tables WHERE token = ?').get(String(table_token));
  if (!table) return res.status(404).json({ error: 'طاولة غير صالحة' });

  const session = db.prepare('SELECT * FROM table_sessions WHERE id = ? AND table_id = ?').get(Number(session_id) || 0, table.id);
  if (!session || session.status !== 'active') {
    return res.status(403).json({ error: 'الجلسة غير نشطة، الرجاء إعادة مسح رمز QR' });
  }
  if (new Date(session.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) {
    db.prepare(`UPDATE table_sessions SET status='expired', ended_at = ? WHERE id = ?`).run(nowSql(), session.id);
    db.prepare(`UPDATE tables SET status='available' WHERE id = ?`).run(table.id);
    require('../evict').evictSession(db, { tableId: table.id, sessionId: session.id, reason: 'expired_on_order' });
    return res.status(403).json({ error: 'انتهت مدة الجلسة، الرجاء إعادة مسح رمز QR' });
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
      INSERT INTO orders (table_id, session_id, status, notes, total) VALUES (?,?,?,?,?)
    `).run(table.id, session.id, 'pending', cleanNotes, total);
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
    SELECT o.id, o.total, o.created_at, o.notes, t.table_number, t.label AS table_label
    FROM orders o JOIN tables t ON t.id = o.table_id
    WHERE o.id > ? AND o.status = 'pending'
    ORDER BY o.id ASC
  `).all(sinceId);
  res.json(rows);
});

router.get('/bills/session/:id', requireAuth, (req, res) => {
  const session = db.prepare(`
    SELECT s.*, t.label, t.table_number FROM table_sessions s JOIN tables t ON t.id = s.table_id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة' });

  const orders = db.prepare(`
    SELECT * FROM orders WHERE session_id = ? AND status != 'cancelled' ORDER BY id ASC
  `).all(session.id);

  const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const merged = {};
  let grandTotal = 0;
  for (const o of orders) {
    o.items = itemStmt.all(o.id);
    for (const it of o.items) {
      const key = `${it.menu_item_id}|${it.unit_price}`;
      if (!merged[key]) {
        merged[key] = { menu_item_id: it.menu_item_id, item_name_ar: it.item_name_ar, unit_price: it.unit_price, quantity: 0, line_total: 0 };
      }
      merged[key].quantity += it.quantity;
      merged[key].line_total += it.line_total;
      grandTotal += it.line_total;
    }
  }
  const mergedItems = Object.values(merged).sort((a, b) => a.menu_item_id - b.menu_item_id);

  res.json({
    session,
    orders,
    merged_items: mergedItems,
    total: grandTotal,
    orders_count: orders.length,
  });
});

router.get('/bills', requireAuth, (req, res) => {
  const sessions = db.prepare(`
    SELECT s.id AS session_id, s.table_id, s.started_at, s.expires_at, s.duration_minutes, t.label, t.table_number
    FROM table_sessions s JOIN tables t ON t.id = s.table_id
    WHERE s.status = 'active'
    ORDER BY s.expires_at ASC
  `).all();

  const orderStmt = db.prepare(`SELECT * FROM orders WHERE session_id = ? AND status != 'cancelled' ORDER BY id ASC`);
  const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  const now = Date.now();
  const bills = [];

  for (const s of sessions) {
    const expiresMs = new Date(s.expires_at.replace(' ', 'T') + 'Z').getTime();
    const remaining = Math.max(0, Math.round((expiresMs - now) / 1000));
    const orders = orderStmt.all(s.session_id);
    const merged = {};
    let total = 0;
    for (const o of orders) {
      o.items = itemStmt.all(o.id);
      for (const it of o.items) {
        const key = `${it.menu_item_id}|${it.unit_price}`;
        if (!merged[key]) {
          merged[key] = { menu_item_id: it.menu_item_id, item_name_ar: it.item_name_ar, unit_price: it.unit_price, quantity: 0, line_total: 0 };
        }
        merged[key].quantity += it.quantity;
        merged[key].line_total += it.line_total;
        total += it.line_total;
      }
    }
    bills.push({
      session_id: s.session_id,
      table_id: s.table_id,
      label: s.label,
      table_number: s.table_number,
      remaining_seconds: remaining,
      expiring_soon: remaining <= 300,
      orders_count: orders.length,
      items: Object.values(merged).sort((a, b) => a.menu_item_id - b.menu_item_id),
      total,
    });
  }

  res.json(bills);
});

router.get('/:id/track', (req, res) => {
  const { session_id, table_token } = req.query;
  if (!session_id || !table_token) return res.status(400).json({ error: 'بيانات غير كافية' });
  const table = db.prepare('SELECT * FROM tables WHERE token = ?').get(String(table_token));
  if (!table) return res.status(404).json({ error: 'الطلب غير موجود' });

  const order = db.prepare(`
    SELECT id, status, total, created_at FROM orders
    WHERE id = ? AND session_id = ? AND table_id = ?
  `).get(req.params.id, Number(session_id) || 0, table.id);

  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json(order);
});

router.get('/', requireAuth, (req, res) => {
  const { status } = req.query;
  let rows;
  if (status) {
    rows = db.prepare(`
      SELECT o.*, t.table_number FROM orders o JOIN tables t ON t.id = o.table_id
      WHERE o.status = ? ORDER BY o.created_at DESC
    `).all(status);
  } else {
    rows = db.prepare(`
      SELECT o.*, t.table_number FROM orders o JOIN tables t ON t.id = o.table_id
      ORDER BY o.created_at DESC LIMIT 200
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
