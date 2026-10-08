const express = require('express');
const QRCode = require('qrcode');
const { requireAuth } = require('../middleware/auth');
const { detectLanIp, buildWifiPayload, escapeHtml } = require('../utils');
const { brand } = require('../brand');

const router = express.Router();

/* لافتة الكاشير: QR شبكة الواي فاي + QR المنيو — تُطبع مرة واحدة وتوضع عند الكاونتر */
router.get('/sign', requireAuth, async (req, res) => {
  const wifiSsid = process.env.WIFI_SSID || '';
  const wifiPayload = buildWifiPayload(wifiSsid, process.env.WIFI_PASSWORD || '');
  const qrWifi = wifiPayload ? await QRCode.toDataURL(wifiPayload, { width: 520, margin: 1 }) : '';
  const menuUrl = `http://${detectLanIp()}/menu`;
  const qrMenu = await QRCode.toDataURL(menuUrl, { width: 300, margin: 1 });
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>لافتة الكاشير | ${escapeHtml(brand.nameAr)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; margin: 10mm; color: #1c1207; background: #f6efe6; }
  .toolbar { display: flex; justify-content: center; gap: 12px; margin-bottom: 14px; }
  .print-btn { padding: 10px 34px; font-size: 15px; font-weight: 700; border: none; border-radius: 999px; cursor: pointer;
    background: linear-gradient(90deg, ${brand.colors.accent}, ${brand.colors.accentDeep}); color: #fff; }
  .tcard { background: #fffdf8; border: 3px solid ${brand.colors.brandText}; border-radius: 14px; padding: 18px; max-width: 640px; margin: 0 auto; page-break-inside: avoid; }
  .tcard__head { display: flex; align-items: center; gap: 12px; border-bottom: 2px dashed #e4d5bd; padding-bottom: 10px; }
  .tcard__num { font-size: 40px; }
  .brand { font-size: 24px; font-weight: 900; color: ${brand.colors.brandText}; }
  .label { font-size: 14px; color: #6b5a45; }
  .tcard__body { display: flex; justify-content: space-between; gap: 8px; padding: 14px 0; text-align: center; }
  .step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .step--main { flex: 1.4; border-right: 1px dashed #e4d5bd; border-left: 1px dashed #e4d5bd; }
  .step__n { width: 24px; height: 24px; border-radius: 50%; background: ${brand.colors.brandText}; color: #fff; font-weight: 800; line-height: 24px; }
  .step__t { font-size: 12px; color: #6b5a45; line-height: 1.6; }
  .step__t b { color: #3d2f1f; }
  .step__img--sm { width: 110px; height: 110px; }
  .step__img--big { width: 210px; height: 210px; }
  .side-net { font-size: 14px; color: #1a5276; font-weight: 700; direction: ltr; }
  .tcard__foot { border-top: 2px dashed #e4d5bd; padding-top: 8px; font-size: 12px; color: #6b5a45; text-align: center; }
  @media print { .toolbar { display: none; } body { background: #fff; } }
</style>
</head>
<body>
<div class="toolbar"><button class="print-btn" onclick="window.print()">طباعة اللافتة</button></div>
<div class="tcard">
  <div class="tcard__head">
    <div class="tcard__num">📶</div>
    <div class="tcard__title">
      <div class="brand">${escapeHtml(brand.nameAr)} — اطلب من جوالك</div>
      <div class="label">امسح رمز الشبكة للدخول على الواي فاي</div>
    </div>
  </div>
  <div class="tcard__body">
    <div class="step step--main">
      <div class="step__n">١</div>
      <div class="step__t">امسح رمز <b>الشبكة</b> بكاميرا هاتفك<br><b>${escapeHtml(wifiSsid) || '—'}</b></div>
      ${qrWifi ? `<img class="step__img--big" src="${qrWifi}" alt="QR الشبكة">` : '<div class="step__t">اضبط WIFI_SSID في الإعدادات أولًا</div>'}
    </div>
    <div class="step">
      <div class="step__n">٢</div>
      <div class="step__t">بعد الاتصال افتح المنيو<br>أو انتظر صفحة الدخول</div>
      <img class="step__img--sm" src="${qrMenu}" alt="QR المنيو">
      <div class="side-net">menu.lan</div>
    </div>
    <div class="step">
      <div class="step__n">٣</div>
      <div class="step__t">اطلب من جوالك<br>وخذ <b>رقم طلبك</b><br>وادفع هنا</div>
    </div>
  </div>
  <div class="tcard__foot">تُطبع مرة واحدة وتوضع عند الكاونتر</div>
</div>
</body>
</html>`;
  res.send(html);
});

module.exports = router;
