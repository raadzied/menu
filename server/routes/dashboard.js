const express = require('express');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/summary', requireAuth, (req, res) => {
  const todayOrders = db.prepare(`
    SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders
    WHERE date(created_at) = date('now') AND status != 'cancelled'
  `).get();
  const pendingOrders = db.prepare(`SELECT COUNT(*) c FROM orders WHERE status IN ('pending','confirmed','preparing')`).get();
  const topItems = db.prepare(`
    SELECT item_name_ar, SUM(quantity) qty FROM order_items
    JOIN orders ON orders.id = order_items.order_id
    WHERE date(orders.created_at) = date('now') AND orders.status != 'cancelled'
    GROUP BY item_name_ar ORDER BY qty DESC LIMIT 5
  `).all();
  res.json({
    today_orders_count: todayOrders.c, today_revenue: todayOrders.s,
    pending_orders: pendingOrders.c, top_items_today: topItems,
  });
});

module.exports = router;
