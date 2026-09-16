const express = require('express');
const QRCode = require('qrcode');
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { detectLanIp, buildWifiPayload, escapeHtml } = require('../utils');
const { brand } = require('../brand');

const router = express.Router();

router.get('/table/:id.png', requireAuth, async (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).send('الطاولة غير موجودة');
  const url = `http://${detectLanIp()}/menu?t=${table.token}`;
  try {
    const png = await QRCode.toBuffer(url, { width: 500, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (e) {
    res.status(500).send('فشل توليد رمز QR');
  }
});

router.get('/table/:id/link', requireAuth, (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'الطاولة غير موجودة' });
  res.json({ url: `http://${detectLanIp()}/menu?t=${table.token}` });
});

router.get('/print', requireAuth, async (req, res) => {
  const tables = db.prepare('SELECT * FROM tables ORDER BY table_number').all();
  const wifiSsid = process.env.WIFI_SSID || '';
  const cards = [];
  for (const table of tables) {
    const url = `http://${detectLanIp()}/menu?t=${table.token}`;
    const qr = await QRCode.toDataURL(url, { width: 420, margin: 1 });
    const wifiPayload = buildWifiPayload(wifiSsid, process.env.WIFI_PASSWORD || '');
    const qrWifi = wifiPayload ? await QRCode.toDataURL(wifiPayload, { width: 240, margin: 1 }) : '';
    cards.push({ table, url, qr, qrWifi });
  }
  const rows = cards.map((c) => `
      <div class="tcard">
        <div class="tcard__head">
          <div class="tcard__num">${escapeHtml(c.table.table_number)}</div>
          <div class="tcard__title">
            <div class="brand">${escapeHtml(brand.nameAr)}</div>
            <div class="label">${c.table.label ? escapeHtml(c.table.label) + ' — ' : ''}طاولة ${escapeHtml(c.table.table_number)}</div>
          </div>
        </div>
        <div class="tcard__body">
          <div class="step">
            <div class="step__n">١</div>
            <div class="step__t">اتصل بشبكة<br><b>${escapeHtml(wifiSsid) || '—'}</b><br>(أول مرة فقط)</div>
            ${c.qrWifi ? `<img class="step__img--sm" src="${c.qrWifi}" alt="QR واي فاي">` : ''}
          </div>
          <div class="step step--main">
            <div class="step__n">٢</div>
            <div class="step__t">امسح لجلسة طاولتك <b>(${escapeHtml(c.table.session_minutes)} دقيقة)</b></div>
            <img class="step__img--big" src="${c.qr}" alt="QR جلسة">
          </div>
          <div class="step">
            <div class="step__t">كود الطاولة<br>(إدخال يدوي)</div>
            <div class="side-code">${escapeHtml(c.table.card_code) || '······'}</div>
            <div class="step__t" style="margin-top:6px">أو افتح:</div>
            <div class="side-net" style="font-weight:700">menu.lan</div>
          </div>
        </div>
        <div class="tcard__foot">بعد الاتصال بالشبكة: امسح خطوة ٢ أو أدخل الكود — وطلبك يصل الكاشير باسم طاولتك · عند أي استفسار نادِ الكاشير</div>
      </div>
  `).join('');
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>بطاقات الطاولات | ${brand.nameAr}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; margin: 10mm; color: #1c1207; background: #f6efe6; }
  .toolbar { display: flex; justify-content: center; gap: 12px; margin-bottom: 14px; }
  .print-btn { padding: 10px 34px; font-size: 15px; font-weight: 700; border: none; border-radius: 999px; cursor: pointer;
    background: linear-gradient(90deg, ${brand.colors.accent}, ${brand.colors.accentDeep}); color: #fff; box-shadow: 0 3px 12px ${brand.colors.glow}; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
  .tcard { background: #fffdf8; border: 1px solid #e4d5bd; border-radius: 14px; padding: 14px; page-break-inside: avoid;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  .tcard__head { display: flex; align-items: center; gap: 12px; border-bottom: 2px dashed #e4d5bd; padding-bottom: 10px; }
  .tcard__num { width: 54px; height: 54px; border-radius: 50%; background: #241409; color: #f5b04c; display: flex;
    align-items: center; justify-content: center; font-size: 26px; font-weight: 900; }
  .brand { font-size: 22px; font-weight: 900; color: ${brand.colors.brandText}; }
  .label { font-size: 13px; color: #6b5a45; }
  .tcard__body { display: flex; align-items: stretch; justify-content: space-between; gap: 8px; padding: 12px 0; }
  .step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; text-align: center; }
  .step--main { flex: 1.5; border-right: 1px dashed #e4d5bd; border-left: 1px dashed #e4d5bd; }
  .step__n { width: 22px; height: 22px; border-radius: 50%; background: ${brand.colors.brandText}; color: #fff; font-weight: 800; font-size: 14px; line-height: 22px; }
  .step__t { font-size: 10.5px; color: #6b5a45; line-height: 1.5; }
  .step__t b { color: #3d2f1f; }
  .step__img--sm { width: 84px; height: 84px; }
  .step__img--big { width: 150px; height: 150px; }
  .side-code { direction: ltr; font-family: Consolas, 'Courier New', monospace; font-weight: 900; font-size: 26px;
    letter-spacing: 3px; color: ${brand.colors.brandText}; background: #fdf3e3; border: 2px dashed #e0a96d; border-radius: 12px; padding: 8px 4px; }
  .side-net { font-size: 11px; color: #1a5276; direction: ltr; }
  .tcard__foot { border-top: 2px dashed #e4d5bd; padding-top: 8px; font-size: 11px; color: #6b5a45; text-align: center; }
  .code { direction: ltr; display: inline-block; font-weight: 800; color: ${brand.colors.brandText}; letter-spacing: 1px; }
  @media print { .toolbar { display: none; } body { background: #fff; } .grid { gap: 5mm; } }
</style>
</head>
<body>
<div class="toolbar"><button class="print-btn" onclick="window.print()">🖨️ طباعة البطاقات</button></div>
<div class="grid">${rows}</div>
</body>
</html>`;
  res.send(html);
});

module.exports = router;
