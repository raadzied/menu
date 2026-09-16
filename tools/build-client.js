/* ===== بناء نسخة مخصصة لمطعم: node tools/build-client.js <client> =====
   1) يجهّز clients/<name>/ (brand.json، app-icon.png → .ico، seed.db اختياري، logo.png اختياري)
   2) يبني exe بهوية هذا المطعم فقط (pkg) + يحقن الأيقونة (rcedit)
   3) يولّد سكربت Inno Setup (وإن وُجد ISCC يترجمه لمثبّت مباشرًا)
   الملفات الأصلية في الشجرة تُستعاد دائمًا بعد البناء (try/finally). */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const clientName = process.argv[2];
if (!clientName) {
  console.error('الاستخدام: node tools/build-client.js <اسم-العميل>   (مثل: mesakhen)');
  process.exit(1);
}

const clientDir = path.join(ROOT, 'clients', clientName);
const brandPath = path.join(clientDir, 'brand.json');
if (!fs.existsSync(brandPath)) {
  console.error(`لا يوجد ${path.join('clients', clientName, 'brand.json')}`);
  process.exit(1);
}
const brand = JSON.parse(fs.readFileSync(brandPath, 'utf8'));
const slug = brand.slug || clientName;
const exeName = `MenuOne-${slug}.exe`;
const outExe = path.join(ROOT, 'dist', exeName);
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });

function step(msg) { console.log(`\n=== ${msg} ===`); }
function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error(`فشل: ${cmd} ${args.join(' ')}`);
}

const restore = [];
function swapFile(target, source) {
  const bak = target + '.bak-build';
  if (fs.existsSync(bak)) fs.rmSync(bak, { force: true });
  if (fs.existsSync(target)) fs.renameSync(target, bak);
  if (source) fs.copyFileSync(source, target);
  restore.push(() => {
    if (fs.existsSync(bak)) { fs.rmSync(target, { force: true }); fs.renameSync(bak, target); }
    else if (source) fs.rmSync(target, { force: true });
  });
}

async function main() {
  /* 1) الهوية */
  step(`هوية العميل: ${brand.name_ar} (${slug})`);
  swapFile(path.join(ROOT, 'brand.json'), brandPath);

  /* 2) لقطة قاعدة بيانات المطعم (اختيارية) */
  const clientSeed = path.join(clientDir, 'seed.db');
  /* --refresh-data: التقط بيانات الإنتاج الحالية (ProgramData) قبل البناء */
  if (process.argv.includes('--refresh-data')) {
    step('تحديث لقطة البيانات من نسخة التشغيل');
    const prodRoot = process.env.ProgramData || process.env.PROGRAMDATA || 'C:\\ProgramData';
    const prodDb = path.join(prodRoot, 'MenuOne', slug, 'restaurant.db');
    if (!fs.existsSync(prodDb)) throw new Error(`لا توجد قاعدة تشغيل عند: ${prodDb}`);
    const { DatabaseSync } = require('node:sqlite');
    const pdb = new DatabaseSync(prodDb);
    pdb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    pdb.close();
    fs.copyFileSync(prodDb, clientSeed);
    console.log(`تم تحديث ${path.relative(ROOT, clientSeed)} (${(fs.statSync(clientSeed).size / 1024).toFixed(0)}KB)`);
  }
  if (fs.existsSync(clientSeed)) {
    step('تضمين لقطة قاعدة البيانات الحالية للمطعم');
    swapFile(path.join(ROOT, 'server', 'db', 'seed.db'), clientSeed);
  } else {
    step('لا لقطة بيانات — قاعدة جديدة تُهيّأ تلقائيًا أول تشغيل');
    swapFile(path.join(ROOT, 'server', 'db', 'seed.db'), null);
  }

  /* 3) شعار داخل الصفحات (اختياري) */
  const clientLogo = path.join(clientDir, 'logo.png');
  if (fs.existsSync(clientLogo)) {
    step('تخصيص شعار داخل الصفحات (public/images/logo.png)');
    swapFile(path.join(ROOT, 'server', 'public', 'images', 'logo.png'), clientLogo);
  }

  /* 4) أيقونة .ico من app-icon.png (يُعاد التوليد إذا كان PNG أحدث) */
  const iconPng = path.join(clientDir, 'app-icon.png');
  const iconIco = path.join(clientDir, 'app.ico');
  let icoPath = null;
  if (fs.existsSync(iconPng)) {
    if (!fs.existsSync(iconIco) || fs.statSync(iconIco).mtimeMs < fs.statSync(iconPng).mtimeMs) {
      step('توليد أيقونة البرنامج (.ico)');
      const pngToIco = (await import('png-to-ico')).default;
      fs.writeFileSync(iconIco, await pngToIco(iconPng));
    }
    icoPath = iconIco;
  }

  /* 5) ملف Node الأساسي المخصص: rcedit قبل pkg — لأن rcedit على الناتج يتلف الحزمة المرفقة.
        (تجربة موثقة: rcedit-x64 يعيد كتابة PE ويسقط الـ overlay — الحل PKG_NODE_PATH) */
  let pkgBase = null;
  if (icoPath) {
    step('تجهيز الملف الأساسي بالأيقونة وبيانات الهوية');
    const os = require('os');
    const cacheRoot = path.join(process.env.PKG_CACHE_PATH || path.join(os.homedir(), '.pkg-cache'));
    let baseFile = null;
    if (fs.existsSync(cacheRoot)) {
      for (const tag of fs.readdirSync(cacheRoot)) {
        const dir = path.join(cacheRoot, tag);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const f of fs.readdirSync(dir)) {
          if (/^fetched-v24.*-win-x64$/.test(f)) baseFile = path.join(dir, f);
        }
      }
    }
    if (!baseFile) throw new Error('لم يُعثر على ملف Node الأساسي في كاش pkg — شغّل البناء مرة ليُنزل تلقائيًا');
    const customDir = path.join(ROOT, 'build-cache', slug);
    fs.mkdirSync(customDir, { recursive: true });
    pkgBase = path.join(customDir, 'base-node.exe');
    fs.copyFileSync(baseFile, pkgBase);
    const { rcedit } = require('rcedit');
    await rcedit(pkgBase, {
      icon: icoPath,
      'version-string': {
        ProductName: `منيو ون - ${brand.name_ar}`,
        FileDescription: brand.system_name || 'Menu One',
        CompanyName: 'Menu One',
      },
    });
  }

  /* 6) pkg */
  step('بناء الملف التنفيذي (pkg)');
  const { exec: pkgExec } = require('@yao-pkg/pkg');
  process.chdir(ROOT);
  if (pkgBase) process.env.PKG_NODE_PATH = pkgBase;
  await pkgExec(['.', '--targets', 'node24-win-x64', '--output', outExe]);
  delete process.env.PKG_NODE_PATH;
}

main()
  .catch((e) => { console.error('\nخطأ البناء:', e.message); process.exitCode = 1; })
  .finally(() => {
    for (const fn of restore.reverse()) fn();
    writeInstaller();
  });

/* 7) توليد Inno Setup */
function writeInstaller() {
  step('توليد مثبّت Inno Setup');
  /* مشغّل مخفي — يفتح السيرفر بدون نافذة كونسول قابلة للإغلاق بالخطأ */
  const vbs = [
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'Set ws = CreateObject("Wscript.Shell")',
    'dir = fso.GetParentFolderName(WScript.ScriptFullName)',
    `ws.Run Chr(34) & dir & "\\\\${exeName}" & Chr(34), 0, False`,
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(ROOT, 'dist', 'run-hidden.vbs'), vbs, 'utf8');

  const issPath = path.join(ROOT, 'dist', `MenuOne-${slug}.iss`);
  const clientIco = path.join(clientDir, 'app.ico');
  const setupIcon = fs.existsSync(clientIco) ? clientIco : path.join(ROOT, 'server', 'public', 'images', 'logo.png');
  const iss = `; مثبّت تلقائي — منيو ون: ${brand.name_ar}
[Setup]
AppName=منيو ون - ${brand.name_ar}
AppVersion=1.0.0
AppPublisher=Menu One
DefaultDirName={autopf}\\MenuOne-${slug}
DefaultGroupName=منيو ون - ${brand.name_ar}
OutputDir=.
OutputBaseFilename=MenuOne-${slug}-Setup
SetupIconFile=${setupIcon}
UninstallDisplayIcon={app}\\${exeName}
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
CloseApplications=yes
WizardStyle=modern

[Files]
Source: "${exeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "run-hidden.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\\فتح لوحة التحكم"; Filename: "http://localhost:3000/admin/login.html"
Name: "{group}\\إيقاف السيرفر (من مهام Windows)"; Filename: "{sys}\\taskmgr.exe"
Name: "{commondesktop}\\منيو ون - ${brand.name_ar}"; Filename: "{sys}\\wscript.exe"; Parameters: """{app}\\run-hidden.vbs"""; IconFilename: "{app}\\${exeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "إنشاء اختصار على سطح المكتب"
Name: "autostart"; Description: "تشغيل النظام تلقائيًا مع بدء ويندوز"; GroupDescription: "خيارات:"

[Registry]
Root: HKLM; Subkey: "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"; ValueType: string; ValueName: "MenuOne-${slug}"; ValueData: "wscript.exe ""{app}\\run-hidden.vbs"""; Tasks: autostart

[Run]
; استثناء جدار الحماية — ضروري لوصول جوالات الزبائن على الشبكة المحلية
Filename: "netsh"; Parameters: "advfirewall firewall add rule name=""MenuOne-${slug}"" dir=in action=allow program=""{app}\\${exeName}"" enable=yes"; Flags: runhidden; StatusMsg: "إضافة استثناء جدار الحماية..."
Filename: "{sys}\\wscript.exe"; Parameters: """{app}\\run-hidden.vbs"""; Description: "تشغيل النظام الآن (بدون نافذة)"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "netsh"; Parameters: "advfirewall firewall delete rule name=""MenuOne-${slug}"""; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
; بيانات المطعم (restaurant.db + الإعدادات) في ProgramData وتبقى بعد الحذف
`;
  fs.writeFileSync(issPath, '\ufeff' + iss, 'utf8');
  console.log('تم توليد:', issPath);

  const isccCandidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe'),
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  ];
  const iscc = isccCandidates.find((p) => fs.existsSync(p));
  if (iscc) {
    step('ترجمة مثبّت Setup.exe');
    const r2 = spawnSync(iscc, [issPath], { cwd: path.join(ROOT, 'dist'), stdio: 'inherit' });
    if (r2.status !== 0) { console.error('فشل ISCC'); process.exitCode = 1; return; }
    console.log('المثبّت جاهز: dist\\' + `MenuOne-${slug}-Setup.exe`);
  } else {
    console.log('\n* Inno Setup غير مثبّت على الجهاز — ثبّته من jrsoftware.org/inno ثم شغّل:');
    console.log(`  ISCC.exe "${issPath}"`);
  }
  console.log(`\nتم بناء نسخة ${brand.name_ar}: ${outExe}`);
}
