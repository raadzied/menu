const runtime = require('./runtime'); // ضبط المسارات والـ .env/config — يجب أن يكون أول سطر
if (runtime.PACKAGED && process.platform === 'win32') {
  try { require('child_process').execSync('chcp 65001', { stdio: 'ignore' }); } catch (_) {}
}
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const qrRoutes = require('./routes/qr');
const dashboardRoutes = require('./routes/dashboard');
const userRoutes = require('./routes/users');
const { csrfGuard } = require('./middleware/auth');
const { baseUrl, detectLanIp } = require('./utils');
const { brand, applyTokens } = require('./brand');
const { brandStatic } = require('./brandify');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
       imgSrc: ["'self'", 'data:', 'blob:'],
       mediaSrc: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      'upgrade-insecure-requests': null,
    },
  },
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  hsts: false,
  referrerPolicy: { policy: 'no-referrer' },
  originAgentCluster: false,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(cookieParser());

if (!process.env.SESSION_SECRET) {
  console.error('خطأ أمني: SESSION_SECRET غير مضبوط في ملف الإعدادات.');
  process.exit(1);
}

app.use(session({
  name: brand.cookieName,
  secret: process.env.SESSION_SECRET,
  store: require('./db/session-store')(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: false, maxAge: 8 * 60 * 60 * 1000 },
}));

const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
const strictLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'محاولات كثيرة، يرجى الانتظار دقيقة.' });
app.use('/api/', apiLimiter);

/* بوابة الالتقاط: اكتشاف أنظمة التشغيل (ويندوز/أندرويد/آبل/فايرفوكس)
   عند اتصالها بشبكة المطعم — تُحوَّل تلقائيًا لصفحة مسخن
   ملاحظة S24/S25 وآيفون الحديثة: تفحص https أيضاً ولا يمكن اعتراضه بدون شهادة،
   لكن طلبات http يجب الرد عليها بسرعة وبدون كاش حتى تظهر نافذة الدخول */
const PROBE_HOSTS = [
  'www.msftconnecttest.com', 'www.msftncsi.com', 'connectivitycheck.gstatic.com',
  'connectivitycheck.android.com', 'clients3.google.com', 'captive.apple.com',
  'www.apple.com', 'www.icloud.com', 'detectportal.firefox.com', 'cp.cloudflare.com',
  'example.com', 'neverssl.com', 'httpcheck.android.com',
  'connectivitycheck.samsung.com', 'www.samsung.com',
  'connectivitycheck.gstatic.cn', 'play.googleapis.com',
];
const PROBE_PATHS = ['/generate_204', '/gen_204', '/hotspot-detect.html', '/ncsi.txt', '/success.txt',
  '/canonical/index.html', '/status.txt', '/library/test/success.html', '/httpinfo.json', '/'];
function isProbe(req) {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (PROBE_HOSTS.includes(host)) return true;
  return req.path === '/redirect' || (PROBE_PATHS.includes(req.path) && !/^(192\.168|localhost|\d+\.)/.test(host));
}
/* اسم الشبكة المحلي → عنوان السيرفر (موحّد أصل التخزين، ويتجاوز DoH بأجهزة الزبائن) */
app.use((req, res, next) => {
  const hostHeader = (req.headers.host || '').toLowerCase().split(':')[0];
  if (hostHeader === 'menu.lan') {
    return res.redirect(301, `http://${detectLanIp()}${req.originalUrl === '/' ? '/menu' : req.originalUrl}`);
  }
  next();
});

app.use((req, res, next) => {
  if (!isProbe(req)) return next();
  // منع الكاش تماماً: الأجهزة الحديثة تكره الاستجابات المخزنة للـ probes
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  /* أي جهاز يتصل يدخل المنيو مباشرة: تحويل واحد لكل الفحوص (أندرويد/آبل/ويندوز) */
  return res.redirect(302, `http://${detectLanIp()}/menu`);
});

app.use('/api/', csrfGuard);
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);

const db = require('./db/database');
const { nowSql } = require('./utils');

/* صفحة المنيو الرئيسية تدعم المتصفحات القديمة: فحص قدرات داخل الصفحة ينقل
   المتصفح القديم تلقائيًا إلى /menu-lite (نسخة HTML خالص بلا JS) */
const menuTemplate = applyTokens(require('fs').readFileSync(path.join(__dirname, 'public', 'menu.html'), 'utf8'));
const MENU_UA_GUARD = `
<script>
(function () {
  /* فحص القدرات بدون eval (سياسة CSP تمنع eval): ES6 primitives + fetch + Promise
     تقييم eval كان يفشل دائمًا بسبب CSP فيُحوَّل كل جهاز — حتى الحديث — إلى menu-lite */
  var ok = typeof Promise !== 'undefined' && typeof fetch === 'function' &&
           typeof Symbol === 'function' && typeof String.raw === 'function';
  if (ok) return;
  var m = location.search.match(/[?&]t=([^&]+)/);
  var sm = location.search.match(/[?&]s=([^&]+)/);
  location.replace('/menu-lite' + (m ? '?t=' + encodeURIComponent(m[1]) : '') + (sm ? '&s=' + encodeURIComponent(sm[1]) : ''));
})();
</script>
`;

app.get('/menu', (req, res) => {
  const html = menuTemplate.replace('<link rel="stylesheet" href="/css/menu.css">',
    MENU_UA_GUARD + '<link rel="stylesheet" href="/css/menu.css">');
  res.type('html').send(html);
});

/* ===== تقديم الصور المحسّنة: نسخ opt/ (WebP/JPEG) بكاش طويل =====
   الأسماء ومسارات قاعدة البيانات لا تتغير — تُقدَّم النسخة المحسّنة إن
   وُجدت، وإلا الأصل عبر express.static. التوليد: node tools/optimize-images.js */
const fs = require('fs');
const OPT_TYPES = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const optMem = new Map();
function optFile(dir, name) {
  const key = dir + '|' + name;
  let e = optMem.get(key);
  if (e === undefined) {
    e = null;
    try {
      const p = path.join(dir, 'opt', name);
      const st = fs.statSync(p);
      if (st.isFile()) {
        const buf = fs.readFileSync(p);
        e = { buf, type: OPT_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream', etag: '"' + buf.length.toString(36) + '-' + Math.round(st.mtimeMs).toString(36) + '"' };
      }
    } catch (_) {}
    optMem.set(key, e);
  }
  return e;
}
const MENU_ROOTS = [process.env.ASSETS_DIR ? path.join(process.env.ASSETS_DIR, 'menu') : null,
  path.join(__dirname, 'public', 'assets', 'menu')].filter(Boolean);
const IMG_ROOT = path.join(__dirname, 'public', 'images');
function serveSidecar(req, res, next, roots, name) {
  const stem = name.replace(/\.(png|jpe?g|webp)$/i, '');
  const wantsWebp = /image\/webp/.test(String(req.headers.accept || ''));
  const cands = wantsWebp ? [stem + '.webp', stem + '.jpg', stem + '.png'] : [stem + '.jpg', stem + '.png', stem + '.webp'];
  for (const r of roots) {
    for (const c of cands) {
      const e = optFile(r, c);
      if (!e) continue;
      res.set('Content-Type', e.type);
      res.set('Cache-Control', 'public, max-age=604800');
      res.set('ETag', e.etag);
      if (req.headers['if-none-match'] === e.etag) return res.status(304).end();
      if (req.method === 'HEAD') return res.end();
      return res.send(e.buf);
    }
  }
  next();
}
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let m = req.path.match(/^\/assets\/menu\/([A-Za-z0-9._-]+\.(?:png|jpe?g|webp))$/i);
  if (m) return serveSidecar(req, res, next, MENU_ROOTS, m[1]);
  m = req.path.match(/^\/images\/(back|logo)\.(png|jpe?g|webp)$/i);
  if (m) return serveSidecar(req, res, next, [IMG_ROOT], m[1] + '.' + m[2]);
  next();
});

/* صفحة البوابة تحوّل مباشرة للمنيو (قبل التقديم الثابت) — لا طاولات ولا أكواد */
app.use((req, res, next) => {
  if (req.path === '/portal.html' || req.path === '/portal') return res.redirect(302, '/menu');
  next();
});

/* مجلد Assets قابل للكتابة في وضع exe — يقدَّم قبل الملفات المضمونة */
if (process.env.ASSETS_DIR) {
  app.use('/assets', express.static(process.env.ASSETS_DIR, { maxAge: '1d' }));
}
app.use(brandStatic(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

app.get('/', (req, res) => {
  res.redirect('/portal.html');
});

app.get('/menu', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'menu.html'));
});

app.get('/favicon.ico', (req, res) => {
  const e = optFile(IMG_ROOT, 'logo.png');
  if (e) {
    res.set('Content-Type', e.type);
    res.set('Cache-Control', 'public, max-age=604800');
    res.set('ETag', e.etag);
    if (req.headers['if-none-match'] === e.etag) return res.status(304).end();
    return res.send(e.buf);
  }
  res.sendFile(path.join(__dirname, 'public', 'images', 'logo.png'));
});

app.get('/admin', (req, res) => {
  res.redirect('/admin/dashboard.html');
});

app.get('/portal.html', (req, res) => {
  res.type('html').send(portalHtml);
});

/* نموذج HTML خالص لدخول الطاولة (بلا JS — يعمل على أقدم المتصفحات/iOS الويف فيو).
   النجاح: تحويل إلى المنيو. الفشل: إعادة الصفحة مع رسالة خطأ ظاهرة. */
const portalHtml = applyTokens(require('fs').readFileSync(path.join(__dirname, 'public', 'portal.html'), 'utf8'));
app.post('/enter', strictLimiter, (req, res) => {
  /* لا أكواد — أي إرسال يذهب للمنيو مباشرة (للتوافق مع روابط/نماذج قديمة) */
  return res.redirect(302, '/menu');
});

const escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* نسخة HTML خالص من المنيو للمتصفحات/الويف فيو القديمة (بلا fetch/fliterals).
   تعمل كاملاً بدون JS: تدخل الجلسة من الخادم وتعرض الأصناف والعداد لحظة التحميل. */
app.get('/menu-lite', strictLimiter, (req, res) => {
  const t = String(req.query.t || '').replace(/[^A-Za-z0-9_-]/g, '');
  res.type('html');
  /* وضع العرض: نسخة خام للهواتف القديمة بلا كود وبلا جلسة — للطلب: جهاز حديث أو الكاشير */
    try {
      const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order').all();
      const itemsStmt = db.prepare('SELECT * FROM menu_items WHERE category_id = ? AND is_available = 1 ORDER BY sort_order');
      const rows = categories.map((c) => {
        const items = itemsStmt.all(c.id);
        const lis = items.map((it) => `
        <li class="item">
          <div class="row"><span class="nm">${escapeHtml(it.name_ar)}</span><span class="pr">${it.price.toLocaleString('ar-EG')} ر.ي</span></div>
          ${it.description_ar ? `<div class="ds">${escapeHtml(it.description_ar)}</div>` : ''}
        </li>`).join('');
        return `<section><h2>${escapeHtml(c.name_ar)}</h2><ul>${lis}</ul></section>`;
      }).join('');
      return res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>منيو ${brand.nameAr}</title>
<style>body{font-family:system-ui,'Segoe UI',Arial,sans-serif;background:#111;color:#fff;margin:0;padding:0 16px 40px}
hdr{display:block;padding:16px 0 10px;border-bottom:1px solid #333;text-align:center}
hdr b{font-size:22px}
section{margin-top:22px}h2{color:#c0392b;border-right:4px solid #c0392b;padding-right:10px;font-size:20px;margin:0 0 8px}
ul{list-style:none;margin:0;padding:0}
li.item{padding:10px 2px;border-bottom:1px solid #252525;display:block}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.nm{font-size:17px;font-weight:600}.pr{color:#ffb300;font-weight:700;white-space:nowrap}
.ds{color:#bbb;font-size:13px;margin-top:4px}
.foot{background:#161616;border-top:1px solid #333;text-align:center;padding:12px;font-size:14px;color:#eee;margin:20px -16px -40px}
nav{display:block;text-align:center;padding:10px 0}
nav a{color:#ffb300;font-size:15px}</style></head><body>
<hdr><b>منيو ${brand.nameAr}</b></hdr>
${rows}
<nav><a href="/menu">النسخة التفاعلية (للأجهزة الحديثة)</a></nav>
<div class="foot">للطلب: افتح النسخة التفاعلية من جهاز حديث — أو اطلب مباشرة من الكاشير</div>
</body></html>`);
    } catch (e) {
      console.error('menu-lite display:', e.message);
      return res.status(500).send('تعذر تحميل المنيو');
    }
 });

app.use((req, res) => {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (/^(192\.168|127\.|localhost|\[::1\])/.test(host)) return res.status(404).send('الصفحة غير موجودة');
  res.redirect(302, `http://${detectLanIp()}/menu`);
});

app.use((err, req, res, next) => {
  console.error('خطأ غير معالج:', err.stack);
  res.status(500).send('عذراً، حدث خطأ داخلي.');
});

app.use((err, req, res, next) => {
  console.error('خطأ غير معالج:', err.stack);
  res.status(500).send('عذراً، حدث خطأ داخلي.');
});

function friendlyListenError(label) {
  return (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`منفذ ${label} مستخدم من برنامج آخر — شغّل نسخة واحدة فقط من النظام`);
      if (label === PORT) process.exit(1);
    } else if (err.code === 'EACCES') {
      console.error(`لا صلاحية للمنفذ ${label} — شغّل البرنامج كمسؤول أو غيّر PORT`);
    } else {
      console.error(`خطأ في المنفذ ${label}:`, err.message);
      if (label === PORT) process.exit(1);
    }
  };
}

const mainServer = app.listen(PORT, '0.0.0.0', () => {
  /* أول تشغيل كـ exe: تهيئة القاعدة إذا كانت خالية + إظهار بيانات المدير + فتح اللوحة */
  if (runtime.PACKAGED) {
    const hadUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
    if (!hadUsers) {
      require('./db/seed').run();
    }
    if (runtime.firstRun && !hadUsers) {
      console.log(`\n** أول تشغيل — اسم المستخدم: admin  |  كلمة المرور: ${runtime.firstRun.adminPassword}`);
    }
    if (runtime.firstRun) {
      console.log(`** ملف الإعدادات: ${path.join(runtime.dataDir, 'config.env')} (تعديلها يتطلب إعادة التشغيل)`);
    }
    if (!process.argv.includes('--no-browser')) {
      try {
        require('child_process').exec(`cmd /c start "" "http://localhost:${PORT}/admin/login.html"`);
      } catch (_) {}
    }
  }
  console.log(`\n== ${brand.systemName} — ${brand.nameAr} — يعمل الآن ==`);
  console.log(`محليًا: http://localhost:${PORT}`);
  console.log(`على الشبكة المحلية: ${baseUrl()}/admin/login.html`);
  console.log(`لوحة التحكم: /admin/login.html\n`);
});
mainServer.on('error', friendlyListenError(PORT));

if (PORT !== '80' && PORT !== 80) {
  const portalServer = app.listen(80, '0.0.0.0', () => console.log(`بوابة الالتقاط تعمل على المنفذ 80 (فتح تلقائي عند الاتصال بالشبكة)`));
  portalServer.on('error', friendlyListenError(80));
}
