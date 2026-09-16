function ipv4ToInt(s) {
  const p = String(s).split('.');
  if (p.length !== 4) return null;
  const n = p.map(Number);
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((n[0] << 24) | (n[1] << 16) | (n[2] << 8) | n[3]) >>> 0;
}

function adminIpAllowed(req) {
  const cfg = (process.env.ADMIN_ALLOW_IPS || '').trim();
  if (!cfg) return true;
  const ip = req.ip || '';
  if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') return true;
  const needle = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return cfg.split(',').map((s) => s.trim()).filter(Boolean).some((rule) => {
    if (rule.includes('/')) {
      const [base, bitsRaw] = rule.split('/');
      const bits = Number(bitsRaw);
      const ipn = ipv4ToInt(needle);
      const basen = ipv4ToInt(base);
      if (ipn == null || basen == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
      const mask = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
      return (ipn & mask) === (basen & mask);
    }
    const n = ipv4ToInt(rule);
    return n !== null && n === ipv4ToInt(needle);
  });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId && adminIpAllowed(req)) {
    return next();
  }
  if (req.session && req.session.userId) {
    return res.status(403).json({ error: 'عنوان IP غير مصرح للوحة التحكم' });
  }
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  }
  return res.redirect('/admin/login.html');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin' && adminIpAllowed(req)) {
    return next();
  }
  if (req.session && req.session.role === 'admin') {
    return res.status(403).json({ error: 'عنوان IP غير مصرح للوحة التحكم' });
  }
  return res.status(403).json({ error: 'صلاحيات المدير مطلوبة لهذا الإجراء' });
}

// CSRF defense-in-depth: any state-changing request carrying an Origin header
// must come from the same host (or an explicitly allow-listed admin host).
// Requests without Origin (curl, Node, fetch with no-cors same-device) pass.
function csrfGuard(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  let ok = false;
  try {
    const o = new URL(origin);
    if (o.protocol === 'http:' || o.protocol === 'https:') {
      const host = String(req.headers.host || '').split(':')[0];
      const allowedHosts = new Set([host, '127.0.0.1', 'localhost', '::1']);
      for (const a of (process.env.ADMIN_ALLOW_IPS || '').split(',')) {
        const t = String(a).trim().split('/')[0];
        if (t) allowedHosts.add(t);
      }
      ok = allowedHosts.has(o.hostname);
    }
  } catch (e) {
    ok = false;
  }
  if (!ok) return res.status(403).json({ error: 'أصل الطلب غير مصرح' });
  return next();
}

module.exports = { requireAuth, requireAdmin, csrfGuard, adminIpAllowed };