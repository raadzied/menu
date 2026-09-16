/* ===== محوّل الطرد الحقيقي للواي فاي — راوتر OpenWrt عبر SSH =====
   التفعيل عبر config.env:
     ROUTER_SSH_HOST=192.168.1.1   ROUTER_SSH_USER=root   ROUTER_SSH_PASS=...
   عند إنهاء جلسة (evictSession يستدعي kickStations):
     1) يفكّ اقتران أجهزة الجلسة عن نقاط الوصول:  iw dev <ap-iface> station del <mac>
        → ينقطع الواي فاي عن الجهاز فورًا ثم يحاول إعادة الاتصال.
     2) يضيف كل MAC إلى مجموعة nft ذات انتهاء-صلاحية (timeout = ثوانٍ الحجز):
        table inet menuone_kick → كل عنصر يسقط تلقائيًا بعد المهلة بلا أي تنظيف خلفي،
        والطلبات المتعددة المتزامنة تتشارك الجدول بأمان.
   → النتيجة: انقطاع فعلي قصير ثم عودة للشبكة، مع بقاء الجلسة القديمة مقفلة حتى إعادة المسح.
   لا تُطبع كلمة المرور أبدًا. */
const { Client } = require('ssh2');

const SAFE_MAC = /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/;
const SAFE_IP = /^(\d{1,3}\.){3}\d{1,3}$/;

function ssh(host, user, pass, cmd, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let out = '';
    const to = setTimeout(() => { try { conn.end(); } catch (_) {} reject(new Error('SSH timeout')); }, timeoutMs);
    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(to); conn.end(); return reject(err); }
        stream.on('data', (b) => { out += b; });
        stream.stderr.on('data', () => {});
        stream.on('close', () => { clearTimeout(to); conn.end(); resolve(out.trim()); });
      });
    });
    conn.on('error', (e) => { clearTimeout(to); reject(e); });
    conn.connect({ host, port: 22, username: user, password: pass, readyTimeout: 8000 });
  });
}

async function kickStations({ macs, ips, seconds, log = console }) {
  const host = process.env.ROUTER_SSH_HOST || '192.168.1.1';
  const user = process.env.ROUTER_SSH_USER || 'root';
  const pass = process.env.ROUTER_SSH_PASS;
  if (!pass) return { skipped: 'ROUTER_SSH_PASS غير مضبوط — الطرد المنطقي فقط' };

  const cleanMacs = [...new Set((Array.isArray(macs) ? macs : []).map((m) => String(m).toLowerCase()).filter((m) => SAFE_MAC.test(m)))];
  const cleanIps = [...new Set((Array.isArray(ips) ? ips : []).filter((i) => SAFE_IP.test(i)))];
  if (!cleanMacs.length && !cleanIps.length) return { skipped: 'لا عناوين للجلسة' };
  const sec = Math.max(1, Math.min(parseInt(seconds, 10) || 4, 300));

  try {
    // حلّ IPs→MACs على الراوتر ثم دمجها مع الـ MACs المعروفة صراحةً
    const known = cleanMacs.join(' ');
    const ipResolvers = cleanIps.map((ip) => `awk '$1=="${ip}"{print $4}' /proc/net/arp`).join(' ; ');
    const realCmd =
      `RES=$( ${ipResolvers} ) ; ` +
      `ALL="${known} $RES" ; ` +
      `APIFS=$(iw dev | awk '/Interface/{i=$2} /type AP/{print i}') ; ` +
      `nft add table inet menuone_kick 2>/dev/null ; ` +
      `nft add chain inet menuone_kick f { type filter hook input priority 0 \\; policy accept \\; } 2>/dev/null ; ` +
      `nft add set inet menuone_kick banned { type ether_addr \\; flags dynamic \\; timeout ${sec}s \\; } 2>/dev/null ; ` +
      `nft add rule inet menuone_kick f ether saddr @banned drop 2>/dev/null ; ` +
      `for m in $ALL; do for i in $APIFS; do iw dev $i station del $m 2>/dev/null; done; ` +
      `nft add element inet menuone_kick banned { $m } 2>/dev/null; done ; ` +
      `echo KICKED_${sec}s`;
    const out = await ssh(host, user, pass, realCmd);
    log.log(`طرد واي فاي فعلي (nft+deauth): ${cleanMacs.length} MAC مباشرة${cleanIps.length ? ' + ' + cleanIps.length + ' عبر IP' : ''} — الحجز ${sec}s ثم فكّ تلقائي`);
    return { ok: true, macs: cleanMacs.length, ips: cleanIps.length, seconds: sec, out };
  } catch (e) {
    log.error('محوّل الطرد (SSH):', e.message);
    return { error: e.message };
  }
}

module.exports = { kickStations };
