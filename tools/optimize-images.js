/* يولّد نسخًا محسّنة (WebP + JPEG) لصور المنيو والخلفية والشعار في مجلدات opt/
   بجوار الأصل. تُخدَم هذه النسخ تلقائيًا من الوسيط في server/index.js.
   التشغيل: node tools/optimize-images.js   (مرة واحدة عند إضافة/تغيير صور) */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'server', 'public');

const TASKS = [
  { dir: path.join(PUBLIC, 'assets', 'menu'), max: 600, webp: 72, jpeg: 80 },
  { dir: path.join(PUBLIC, 'images'), max: 1080, webp: 65, jpeg: 72, only: ['back.png', 'logo.png'] },
];

async function run() {
  let saved = 0, out = 0;
  for (const t of TASKS) {
    if (!fs.existsSync(t.dir)) continue;
    const optDir = path.join(t.dir, 'opt');
    fs.mkdirSync(optDir, { recursive: true });
    const names = fs.readdirSync(t.dir).filter((f) => {
      if (!/\.(png|jpe?g)$/i.test(f)) return false;
      if (t.only && !t.only.includes(f.toLowerCase())) return false;
      return true;
    });
    for (const name of names) {
      const src = path.join(t.dir, name);
      const base = name.replace(/\.(png|jpe?g)$/i, '');
      const original = fs.statSync(src).size;
      saved += original;
      const isLogo = name.toLowerCase() === 'logo.png';
      if (isLogo) {
        /* الشعار قد يحوي شفافية: WEBP صغير + PNG مصغّر (بلا JPEG لئلا تُفقد الشفافية) */
        await sharp(src).resize({ width: 128, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(optDir, base + '.webp'));
        await sharp(src).resize({ width: 128, withoutEnlargement: true }).png({ palette: true, quality: 90 }).toFile(path.join(optDir, base + '.png'));
        out += 2;
      } else {
        const img = sharp(src, { animated: false }).resize({ width: t.max, withoutEnlargement: true });
        await img.clone().webp({ quality: t.webp }).toFile(path.join(optDir, base + '.webp'));
        await img.clone().jpeg({ quality: t.jpeg, mozjpeg: true }).toFile(path.join(optDir, base + '.jpg'));
        out += 2;
        const j = fs.statSync(path.join(optDir, base + '.jpg')).size;
        console.log(`${path.basename(t.dir)}/${name}: ${(original / 1024).toFixed(0)}KB -> jpg ${(j / 1024).toFixed(0)}KB`);
      }
      const w = fs.statSync(path.join(optDir, base + '.webp')).size;
      if (isLogo) console.log(`${path.basename(t.dir)}/${name}: ${(original / 1024).toFixed(0)}KB -> webp ${(w / 1024).toFixed(0)}KB + png128`);
    }
  }
  console.log(`\nتم توليد ${out} ملفًا في مجلدات opt/ (الأصل ${(saved / 1048576).toFixed(1)}MB لن يُمسّ).`);
}

run().catch((e) => { console.error(e); process.exit(1); });
