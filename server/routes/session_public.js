const express = require('express');
const db = require('../db/database');
const { minutesFromNow, nowSql, baseUrl } = require('../utils');
const { evictSession, evictRemaining, BLOCK_MSG } = require('../evict');

const router = express.Router();

/* أكواد الطاولات ستة أرقام دائماً؛ لا تُقبل الأكواد القديمة الأقصر. */
const CODE_RE = /^\d{6}$/;

function isExpired(session) {
  return new Date(session.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now();
}

function expireIfDead(session) {
  if (session && session.status === 'active' && isExpired(session)) {
    db.prepare(`UPDATE table_sessions SET status='expired', ended_at = ? WHERE id = ?`).run(nowSql(), session.id);
    db.prepare(`UPDATE tables SET status='available' WHERE id = ?`).run(session.table_id);
    evictSession(db, { tableId: session.table_id, sessionId: session.id, reason: 'expired' });
    return null;
  }
  return session;
}

const findActiveStmt = () => db.prepare(`
  SELECT * FROM table_sessions WHERE table_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1
`);

/* إنشاء أو استرجاع جلسة الطاولة داخل معاملة ذرّية (يمنع جلستين لنفس الطاولة) */
function ensureSession(table) {
  const active = expireIfDead(findActiveStmt().get(table.id));
  if (active) return active;
  try {
    db.exec('BEGIN IMMEDIATE');
    const race = expireIfDead(findActiveStmt().get(table.id));
    if (race) {
      db.exec('COMMIT');
      return race;
    }
    const duration = table.session_minutes || 20;
    const expiresAt = minutesFromNow(duration);
    const info = db.prepare(`
      INSERT INTO table_sessions (table_id, duration_minutes, expires_at, status) VALUES (?,?,?, 'active')
    `).run(table.id, duration, expiresAt);
    db.prepare(`UPDATE tables SET status='occupied' WHERE id = ?`).run(table.id);
    db.exec('COMMIT');
    return db.prepare('SELECT * FROM table_sessions WHERE id = ?').get(info.lastInsertRowid);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw e;
  }
}

function sessionPayload(table, session) {
  const extended = session.extended_by_minutes || 0;
  return {
    table_id: table.id,
    table_number: table.table_number,
    label: table.label,
    session_id: session.id,
    expires_at: session.expires_at,
    duration_minutes: session.duration_minutes,
    total_minutes: session.duration_minutes + extended,
    card_code: table.card_code || null,
    devices: db.prepare('SELECT COUNT(*) AS c FROM session_devices WHERE session_id = ?').get(session.id).c,
    server_time: nowSql(),
  };
}

function registerDevice(sessionId, req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
  if (ip) db.prepare('INSERT OR IGNORE INTO session_devices (session_id, ip) VALUES (?,?)').run(sessionId, ip);
}

/* ===== حارس تخمين أكواد الطاولات (دائم في SQLite — لا يُمحى بإعادة التشغيل) =====
   طبقتان: حد نافذة زمنية لكل IP، وعدّاد تصاعدي لكل كود يجلب قفلًا بالوقت. */
db.exec(`CREATE TABLE IF NOT EXISTS redeem_guard (
  key TEXT PRIMARY KEY,
  fails INTEGER DEFAULT 0,
  window_start INTEGER DEFAULT 0,
  blocked_until INTEGER DEFAULT 0,
  strikes INTEGER DEFAULT 0
)`);
const guardGet = (key) => db.prepare('SELECT * FROM redeem_guard WHERE key = ?').get(key);
function guardPut(key, fails, windowStart, blockedUntil, strikes) {
  db.prepare(`INSERT INTO redeem_guard (key, fails, window_start, blocked_until, strikes) VALUES (?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, window_start=excluded.window_start,
      blocked_until=excluded.blocked_until, strikes=excluded.strikes`)
    .run(key, fails, windowStart, blockedUntil, strikes);
}
const IP_WINDOW_MS = 60 * 1000;
const IP_MAX = 10;
function ipAttemptOk(prefix, ip) {
  const now = Date.now();
  const key = prefix + ip;
  const r = guardGet(key);
  if (!r || now - r.window_start > IP_WINDOW_MS) { guardPut(key, 1, now, 0, r ? r.strikes : 0); return true; }
  guardPut(key, r.fails + 1, r.window_start, r.blocked_until, r.strikes);
  return r.fails + 1 <= IP_MAX;
}
const CODE_WINDOW_MS = 10 * 60 * 1000;
const CODE_MAX_FAILS = 8;
const CODE_BLOCK_TIERS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
function codeLockSeconds(code) {
  const r = guardGet('c:' + code);
  if (!r || r.blocked_until <= Date.now()) return 0;
  return Math.ceil((r.blocked_until - Date.now()) / 1000);
}
function codeFailed(code) {
  const now = Date.now();
  const key = 'c:' + code;
  const r = guardGet(key);
  let fails = !r || now - r.window_start > CODE_WINDOW_MS ? 1 : r.fails + 1;
  let blocked = r ? r.blocked_until : 0;
  let strikes = r ? r.strikes : 0;
  let window = !r || now - r.window_start > CODE_WINDOW_MS ? now : r.window_start;
  if (fails >= CODE_MAX_FAILS && blocked <= now) {
    strikes += 1;
    blocked = now + CODE_BLOCK_TIERS_MS[Math.min(strikes - 1, CODE_BLOCK_TIERS_MS.length - 1)];
    fails = 0; window = now;
  }
  guardPut(key, fails, window, blocked, strikes);
}
function codeSucceeded(code) { db.prepare('DELETE FROM redeem_guard WHERE key = ?').run('c:' + code); }
function clearCodeGuard(...codes) {
  const del = db.prepare('DELETE FROM redeem_guard WHERE key = ?');
  for (const c of codes) { if (c) del.run('c:' + c); }
}

router.get('/check', (req, res) => {
  const { t, s } = req.query;
  if (!t) return res.status(400).json({ error: 'رابط غير صالح' });
  const table = db.prepare('SELECT * FROM tables WHERE token = ?').get(t);
  if (!table) return res.status(404).json({ error: 'الطاولة غير موجودة، الرجاء التأكد من الرمز' });
  if (table.status === 'disabled') return res.status(403).json({ error: 'هذه الطاولة غير مفعّلة حاليًا' });
  /* ادّعاء صريح بجلسة (إعادة تحميل/رجوع من المودم): إن كانت منتهية لا نُنشئ
     أخرى ولا ننتظر مهلة الطرد — نُرسل العميل لصفحة الدخول مباشرة. */
  if (s && /^\d+$/.test(String(s))) {
    const claimed = db.prepare('SELECT * FROM table_sessions WHERE id = ? AND table_id = ?').get(Number(s), table.id);
    const freshClaimed = claimed && claimed.status === 'active' && expireIfDead(claimed);
    if (!freshClaimed) {
      return res.status(410).json({ status: 'ended', error: 'انتهت الجلسة', portal_url: '/portal.html' });
    }
    const active = expireIfDead(findActiveStmt().get(table.id));
    const session = active || freshClaimed;
    registerDevice(session.id, req);
    return res.json(sessionPayload(table, session));
  }
  const blocked = evictRemaining(db, table);
  if (blocked > 0) return res.status(423).json({ error: BLOCK_MSG(blocked), retry_in_seconds: blocked });
  try {
    const session = ensureSession(table);
    registerDevice(session.id, req);
    res.json(sessionPayload(table, session));
  } catch (e) {
    res.status(500).json({ error: 'تعذر بدء الجلسة، حاول مرة أخرى' });
  }
});

/* فحص حالة طاولة معروفة بالكود — لتتذكر البوابة جلسة الهاتف (بلا أي سر). */
router.get('/peek', (req, res) => {
  const rawP = String(req.query.code || '').replace(/\D/g, '');
  if (!CODE_RE.test(rawP)) return res.status(400).json({ error: 'كود غير صحيح' });
  if (!ipAttemptOk('p:', req.ip || '')) return res.status(429).json({ error: 'محاولات كثيرة' });
  const tbl = db.prepare('SELECT * FROM tables WHERE card_code = ?').get(rawP);
  if (!tbl) return res.status(400).json({ error: 'كود غير صحيح' });
  const ses = expireIfDead(findActiveStmt().get(tbl.id));
  res.json({
    table_number: tbl.table_number,
    active: !!ses,
    remaining_seconds: ses ? Math.max(0, Math.floor((new Date(ses.expires_at.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000)) : 0,
  });
});

/* اشتراك مشترك بين الـ API و نموذج HTML القديم (الأجهزة بلا JS جديد) */
function redeemCode(rawCode, req) {
  const ip = req.ip || 'unknown';
  if (!ipAttemptOk('r:', ip)) {
    return { ok: false, status: 429, error: 'محاولات كثيرة — انتظر دقيقة أو نادِ الكاشير' };
  }
  const raw = String(rawCode || '').replace(/\D/g, '');
  if (!CODE_RE.test(raw)) {
    return { ok: false, status: 400, error: 'الكود غير صحيح' };
  }
  const locked = codeLockSeconds(raw);
  if (locked > 0) {
    return { ok: false, status: 429, error: 'تم إيقاف هذا الكود مؤقتًا لكثرة المحاولات — نادِ الكاشير' };
  }
  const table = db.prepare('SELECT * FROM tables WHERE card_code = ?').get(raw);
  if (!table || table.status === 'disabled') {
    codeFailed(raw);
    return { ok: false, status: 400, error: 'الكود غير صحيح' };
  }
  codeSucceeded(raw);
  const blocked = evictRemaining(db, table);
  if (blocked > 0) {
    return { ok: false, status: 423, error: BLOCK_MSG(blocked), retry_in_seconds: blocked };
  }
  try {
    const session = ensureSession(table);
    registerDevice(session.id, req);
    return {
      ok: true,
      table_number: table.table_number,
      card_code: raw,
      token: table.token,
      devices: db.prepare('SELECT COUNT(*) AS c FROM session_devices WHERE session_id = ?').get(session.id).c,
      menu_url: `/menu?t=${table.token}`,
    };
  } catch (e) {
    return { ok: false, status: 500, error: 'تعذر بدء الجلسة' };
  }
}

/* استبدال كرت الطاولة المطبوع (5 أحرف) — بديل الدخول اليدوي للمسح QR.
   ينضم للجلسة النشطة أو ينشئها ذرّياً. */
router.post('/redeem', (req, res) => {
  const r = redeemCode((req.body || {}).code, req);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true, table_number: r.table_number, card_code: r.card_code, devices: r.devices, menu_url: r.menu_url });
});

router.get('/status/:sessionId', (req, res) => {
  const session = db.prepare('SELECT * FROM table_sessions WHERE id = ?').get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة' });
  /* إثبات ملكية: يجب إرسال token الطاولة مع الطلب — يمنع استطلاع معارف متسلسلة */
  const ownerTable = db.prepare('SELECT * FROM tables WHERE id = ?').get(session.table_id);
  if (!ownerTable || String(req.query.t || '') !== ownerTable.token) {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  const fresh = expireIfDead(session);
  if (!fresh) {
    const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(session.table_id);
    const wait = t ? evictRemaining(db, t) : 0;
    return res.json({ status: 'expired', expires_at: session.expires_at, server_time: nowSql(), ...(wait > 0 ? { retry_in_seconds: wait } : {}) });
  }
  res.json({
    status: fresh.status,
    expires_at: fresh.expires_at,
    total_minutes: fresh.duration_minutes + (fresh.extended_by_minutes || 0),
    server_time: nowSql(),
  });
});

/* ===== بوابة الكروت (Gate): يستدعيها المودم/نظام الكرت للتحقق من صلاحية جلسة الطاولة =====
   GET /api/session/gate/<TOKEN>?mac=AA:BB:..&key=SECRET
   → pending  : لا جلسة — يحوَّل الزبون لرابط المنيو (بطاقة الطاولة)
   → allowed  : جلسة نشطة + الثواني المتبقية (التمديد من لوحة التحكم ينعكس فورًا)
   GET /api/session/gate?mac=... → حالة الجهاز المرتبط مؤخرًا (للكتم بعد الإنهاء) */
db.exec(`CREATE TABLE IF NOT EXISTS hotspot_clients (
  mac TEXT PRIMARY KEY, token TEXT, session_id INTEGER, seen_at TEXT
)`);

function gateKeyOk(req) {
  const k = process.env.GATE_KEY;
  return !k || (req.query.key || '') === k;
}

function gateFor(table, mac) {
  const session = expireIfDead(findActiveStmt().get(table.id));
  if (mac) {
    db.prepare(`INSERT INTO hotspot_clients (mac, token, session_id, seen_at) VALUES (?,?,?,?)
      ON CONFLICT(mac) DO UPDATE SET token=excluded.token, session_id=excluded.session_id, seen_at=excluded.seen_at`)
      .run(mac.toLowerCase(), table.token, session ? session.id : null, nowSql());
  }
  if (!session) {
    const wait = evictRemaining(db, table);
    return {
      status: 'pending',
      table_number: table.table_number,
      redirect: `${baseUrl()}/menu?t=${table.token}`,
      ...(wait > 0 ? { retry_in_seconds: wait, evicted: true } : {}),
    };
  }
  const remaining = Math.max(0, Math.floor((new Date(session.expires_at.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000));
  return {
    status: remaining > 0 ? 'allowed' : 'expired',
    table_number: table.table_number,
    session_id: session.id,
    remaining_seconds: remaining,
    expires_at: session.expires_at,
    redirect: `${baseUrl()}/menu?t=${table.token}`,
  };
}

router.get('/gate/:token', (req, res) => {
  if (!gateKeyOk(req)) return res.status(403).json({ error: 'مفتاح غير صحيح' });
  const table = db.prepare('SELECT * FROM tables WHERE token = ?').get(req.params.token);
  if (!table) return res.status(404).json({ error: 'رمز غير معروف' });
  if (table.status === 'disabled') return res.json({ status: 'blocked', table_number: table.table_number });
  res.json(gateFor(table, (req.query.mac || '').toLowerCase() || null));
});

router.get('/gate', (req, res) => {
  if (!gateKeyOk(req)) return res.status(403).json({ error: 'مفتاح غير صحيح' });
  const mac = (req.query.mac || '').toLowerCase();
  if (!mac) return res.status(400).json({ error: 'mac مطلوب' });
  const client = db.prepare('SELECT * FROM hotspot_clients WHERE mac = ?').get(mac);
  if (!client) return res.json({ status: 'unknown' });
  const table = db.prepare('SELECT * FROM tables WHERE token = ?').get(client.token);
  if (!table) return res.json({ status: 'unknown' });
  res.json(gateFor(table, mac));
});

module.exports = router;
module.exports.redeemCode = redeemCode;
module.exports.clearCodeGuard = clearCodeGuard;
module.exports.ensureSession = ensureSession;
module.exports.registerDevice = registerDevice;
module.exports.sessionPayload = sessionPayload;
module.exports.isExpired = isExpired;
module.exports.expireIfDead = expireIfDead;
module.exports.findActiveStmt = findActiveStmt;
