/* ===== وضع التشغيل: تطوير (عادي) مقابل تشغيل كملف exe مُغلَّف =====
   يُستدعى أول شيء قبل أي module آخر ليضبط المسارات والـ dotenv.
   - Dev:    القاعدة والملفات في مكانها القديم (server/db/restaurant.db) و.env الجذر.
   - Packaged (pkg): كل البيانات في مجلد قابل للكتابة:
       %ProgramData%\MenuOne\<slug>\
         config.env       الإعدادات (يُنشأ تلقائيًا أول تشغيل)
         restaurant.db    قاعدة البيانات (تُنسخ من seed.db المضمّن أول تشغيل إن وُجد)
         assets\          صور أصناف يضيفها المطعم لاحقًا (تُخدم من /assets)
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PACKAGED = !!process.pkg;
const BRAND_FILE = process.env.BRAND_PATH || path.join(__dirname, '..', 'brand.json');

let slug = 'menuone';
try {
  slug = (JSON.parse(fs.readFileSync(BRAND_FILE, 'utf8')).slug || 'menuone').replace(/[^a-z0-9_-]/gi, '');
} catch (_) {}

let dataDir = null;
let firstRun = null;

if (PACKAGED) {
  const base = process.env.ProgramData || process.env.PROGRAMDATA
    || path.join(os.homedir(), 'AppData', 'Roaming');
  dataDir = process.env.DATA_DIR || path.join(base, 'MenuOne', slug);
  /* بعض أجهزة ويندوز تمنع الكتابة في ProgramData أو LocalAppData؛
     اختبر الإنشاء نفسه ثم انتقل إلى مجلد التطبيق القابل للكتابة. */
  try {
    fs.mkdirSync(path.join(dataDir, 'assets'), { recursive: true });
    const probe = path.join(dataDir, '.write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (_) {
    const localBase = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const fallbackDir = path.join(localBase, 'MenuOne', slug);
    try {
      fs.mkdirSync(path.join(fallbackDir, 'assets'), { recursive: true });
      dataDir = fallbackDir;
    } catch (_) {
      const appDir = path.join(path.dirname(process.execPath), 'data');
      fs.mkdirSync(path.join(appDir, 'assets'), { recursive: true });
      dataDir = appDir;
    }
  }

  const configPath = path.join(dataDir, 'config.env');
  if (!fs.existsSync(configPath)) {
    const adminPassword = crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{4}/g).join('-');
    fs.writeFileSync(configPath, [
      `# إعدادات ${slug} — بعد أي تعديل أعد تشغيل البرنامج`,
      'PORT=3000',
      `LAN_IP=`,
      `SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`,
      'ADMIN_USERNAME=admin',
      `ADMIN_PASSWORD=${adminPassword}`,
      'DEFAULT_TABLE_SESSION_MINUTES=20',
      'WIFI_SSID=',
      'WIFI_PASSWORD=',
      'SESSION_RECONNECT_SECONDS=4',
      '# ROUTER_KICK_URL=http://<موجه-الشبكة>/kick — اختياري: طرد واي فاي فعلي لماك/آي أجهزة الجلسة',
      'ROUTER_KICK_URL=',
      '# طرد واي فاي فعلي عبر راوتر OpenWrt (SSH): املأ كلمة المرور لتفعيله',
      'ROUTER_SSH_HOST=192.168.1.1',
      'ROUTER_SSH_USER=root',
      'ROUTER_SSH_PASS=',
      '',
    ].join('\r\n'), 'utf8');
    firstRun = { adminPassword };
  }

  const dbFile = path.join(dataDir, 'restaurant.db');
  if (!fs.existsSync(dbFile)) {
    const seedFile = path.join(__dirname, 'db', 'seed.db');
    if (fs.existsSync(seedFile)) fs.copyFileSync(seedFile, dbFile);
  }

  process.env.DB_PATH = dbFile;
  process.env.ASSETS_DIR = path.join(dataDir, 'assets');
  require('dotenv').config({ path: configPath });
} else {
  require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '..', '.env') });
}

module.exports = { PACKAGED, dataDir, slug, firstRun, BRAND_FILE };
