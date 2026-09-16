/* مخزن جلسات دائم فوق express-session — يكتب في جدول sessions بقاعدة البيانات،
   فلا تُطرد الجلسات عند إعادة تشغيل السيرفر، مع تنظيف دوري للمنتهية. */
const { Store } = require('express-session');
const db = require('./database');
const crypto = require('crypto');

db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
)`);

class SqliteStore extends Store {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at && row.expires_at < Date.now()) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.data));
    } catch (e) { return cb(e); }
  }

  set(sid, sess, cb) {
    try {
      const exp = sess && sess.cookie && sess.cookie.maxAge
        ? Date.now() + sess.cookie.maxAge : Date.now() + 24 * 3600 * 1000;
      db.prepare(`INSERT INTO sessions (sid, data, expires_at) VALUES (?,?,?)
        ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at`)
        .run(sid, JSON.stringify(sess), exp);
      if (cb) cb(null);
    } catch (e) { if (cb) cb(e); }
  }

  destroy(sid, cb) {
    try { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); if (cb) cb(null); }
    catch (e) { if (cb) cb(e); }
  }

  touch(sid, sess, cb) {
    try {
      const exp = sess && sess.cookie && sess.cookie.maxAge
        ? Date.now() + sess.cookie.maxAge : Date.now() + 24 * 3600 * 1000;
      db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(exp, sid);
      if (cb) cb(null);
    } catch (e) { if (cb) cb(e); }
  }
}

setInterval(() => {
  try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); } catch (_) {}
}, 15 * 60 * 1000).unref();

module.exports = function sessionStoreFactory() {
  return new SqliteStore();
};
module.exports.prune = () => { try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); } catch (_) {} };
