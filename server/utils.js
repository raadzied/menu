const crypto = require('crypto');
const os = require('os');

/* عدد خانات كود الطاولة المطبوع (6 أرقام). التحقق يقبل 5-6 للأكواد القديمة المطبوعة. */
const CARD_CODE_LEN = 6;
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function generateToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomDigits(len) {
  let out = '';
  for (let i = 0; i < len; i++) out += crypto.randomInt(0, 10).toString();
  return out;
}

function minutesFromNow(minutes) {
  const d = new Date(Date.now() + minutes * 60 * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function detectLanIp() {
  if (process.env.LAN_IP) return process.env.LAN_IP;
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function baseUrl() {
  const ip = detectLanIp();
  const port = process.env.PORT || 3000;
  const needsPort = port !== '80';
  return `http://${ip}${needsPort ? ':' + port : ''}`;
}

/* حمولة QR بمواصفة Wi-Fi Alliance — الهروب الصحيح للرموز \ ; : , "
   T:WPA عند وجود كلمة مرور (وليس nopass دائمًا) */
function escapeWifiField(s) {
  return String(s).replace(/([\\;:,"])/g, '\\$1');
}
function buildWifiPayload(ssid, password) {
  if (!ssid) return '';
  const hasPass = Boolean(password);
  const type = hasPass ? 'WPA' : 'nopass';
  return `WIFI:T:${type};S:${escapeWifiField(ssid)};${hasPass ? `P:${escapeWifiField(password)};` : ''}H:false;;`;
}

module.exports = { generateToken, minutesFromNow, nowSql, detectLanIp, baseUrl, buildWifiPayload, escapeHtml, randomDigits, CARD_CODE_LEN };