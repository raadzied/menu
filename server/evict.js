/* ===== الطرد بعد إنهاء الجلسة (سياسة منيو ون) =====
   عند انتهاء/إغلاق جلسة طاولة:
   1) نافذة حجز config.env الثواني (افتراضي 4) تُمنع فيها كل أجهزة الطاولة من
      بدء جلسة جديدة — حتى لو أعادت مسح QR: يظهر لها "أعد الاتصال بالشبكة".
   2) بعد انتهاء المهلة لا تعمل الجلسة إلا بمسح رمز جديد/إدخال كود الكرت
      (أي فعليًا لا عودة تلقائية للجلسة القديمة).
   3) اختياري — الطرد من الواي فاي فعليًا: إذا ضُبط ROUTER_KICK_URL في config.env
      يستدعي السيرفر موجّه الشبكة (مايكروتيك/نظام كروت) بـ macs & ips & seconds
      لقطع أجهزة الجلسة الموثقة ثم إعادة السماح. بدون ضبطه يعمل الحجز المنطقي فقط. */
const { nowSql } = require('./utils');

function reconnectSeconds() {
  const n = parseInt(process.env.SESSION_RECONNECT_SECONDS || '4', 10);
  return Number.isFinite(n) && n >= 0 ? n : 4;
}

function plusSecondsSql(sec) {
  return new Date(Date.now() + sec * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function remainingOf(until) {
  if (!until) return 0;
  const ms = new Date(String(until).replace(' ', 'T') + 'Z').getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

function evictSession(db, { tableId, sessionId, reason }) {
  const sec = reconnectSeconds();
  try {
    if (sec > 0) db.prepare('UPDATE tables SET evict_until = ? WHERE id = ?').run(plusSecondsSql(sec), tableId);
    else db.prepare('UPDATE tables SET evict_until = NULL WHERE id = ?').run(tableId);
  } catch (e) {
    console.error('evictSession:', e.message);
    return;
  }
  if (sec > 0 && sessionId && (process.env.ROUTER_KICK_URL || process.env.ROUTER_SSH_PASS)) {
    try {
      const macs = db.prepare('SELECT mac FROM hotspot_clients WHERE session_id = ?').all(sessionId).map((r) => r.mac);
      const ips = db.prepare('SELECT ip FROM session_devices WHERE session_id = ?').all(sessionId).map((r) => r.ip);
      const base = process.env.ROUTER_KICK_URL;
      if (base && (macs.length || ips.length)) {
        const url = `${base}${base.includes('?') ? '&' : '?'}macs=${encodeURIComponent(macs.join(','))}&ips=${encodeURIComponent(ips.join(','))}&seconds=${sec}&reason=${encodeURIComponent(reason || 'session_end')}`;
        fetch(url).then((r) => console.log(`موجّه الطرد رد بـ HTTP ${r.status}`))
          .catch((e) => console.error('تعذر استدعاء موجّه الطرد:', e.message));
      }
      if (process.env.ROUTER_SSH_PASS) {
        require('./router-kick').kickStations({ macs, ips, seconds: sec }).catch(() => {});
      }
    } catch (e) {
      console.error('evict hook:', e.message);
    }
  }
  if (sec > 0) console.log(`الطاولة ${tableId}: طرد الأجهزة (${reason || 'end'}) — حجز ${sec} ثوانٍ ثم يلزم مسح الرمز من جديد`);
}

function evictRemaining(db, table) {
  const rem = remainingOf(table.evict_until);
  if (!rem && table.evict_until) {
    db.prepare('UPDATE tables SET evict_until = NULL WHERE id = ?').run(table.id);
  }
  return rem;
}

const BLOCK_MSG = (sec) => `انتهت الجلسة — أعد الاتصال بشبكة المطعم ثم امسح رمز طاولتك خلال ${sec} ثانية`;

module.exports = { evictSession, evictRemaining, reconnectSeconds, BLOCK_MSG };
