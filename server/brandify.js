/* ===== تقديم الملفات النصية مع حقن الهوية =====
   بديل عن express.static للملفات النصية (html/css/js):
   يقرأ الملف، يستبدل وسوم {{TOKENS}} من brand.json، ويرسله مع كاش بالموديفاي.
   الملفات الثنائية (صور/خطوط/رفع) تبقى على express.static العادي. */
const fs = require('fs');
const path = require('path');
const { applyTokens } = require('./brand');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function brandStatic(rootDir) {
  const root = path.resolve(rootDir);
  const cache = new Map();

  return function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try {
      rel = decodeURIComponent(req.path);
    } catch (_) {
      return next();
    }
    if (!rel || rel.includes('\0')) return next();
    const file = path.resolve(root, '.' + path.posix.normalize(rel));
    if (!file.startsWith(root + path.sep) && file !== root) return next();
    const ext = path.extname(file).toLowerCase();
    if (!TYPES[ext]) return next();

    let entry;
    try {
      entry = fs.statSync(file);
    } catch (_) {
      return next();
    }
    if (!entry.isFile()) return next();

    const key = file;
    const cached = cache.get(key);
    if (cached && cached.mtimeMs === entry.mtimeMs) {
      return send(cached.content);
    }
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      console.error('brandStatic:', e.message);
      return next();
    }
    const content = applyTokens(text);
    cache.set(key, { mtimeMs: entry.mtimeMs, content });
    return send(content);

    function send(content) {
      res.set('Content-Type', TYPES[ext]);
      res.set('ETag', `W/"${entry.size}-${Math.round(entry.mtimeMs)}"`);
      res.set('Cache-Control', 'public, max-age=60');
      if (req.method === 'HEAD') return res.end();
      res.send(content);
    }
  };
}

module.exports = { brandStatic };
