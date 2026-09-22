const Notify = (() => {
  let audioCtx = null;
  let lastOrderId = 0;
  let muted = localStorage.getItem('{{SLUG}}.notifyMuted') === '1';
  let timer = null;

  function ensureCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      console.log('[Notify] Resuming audio context...');
      audioCtx.resume().then(() => console.log('[Notify] Audio context resumed')).catch(() => {});
    }
    return audioCtx;
  }

  function playSound() {
    try {
      const ctx = ensureCtx();
      if (!ctx) {
        console.log('[Notify] No audio context available');
        return;
      }
      console.log('[Notify] Playing sound, ctx.state:', ctx.state);
      const t0 = ctx.currentTime;
      const tone = (freq, start, dur, vol) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + start);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0 + start);
        osc.stop(t0 + start + dur + 0.05);
      };
      tone(880, 0, 0.2, 0.5);
      tone(1174.66, 0.22, 0.35, 0.45);
    } catch (e) {
      console.error('[Notify] playSound error:', e);
    }
  }

  function showToast(order) {
    console.log('[Notify] showToast for order:', order);
    const box = document.getElementById('notifyStack');
    if (!box) {
      console.log('[Notify] notifyStack not found');
      return;
    }
    const el = document.createElement('div');
    el.className = 'notify-toast';
    el.innerHTML = `
      <div class="notify-toast__title">طلب جديد #${order.id}</div>
      <div>طاولة <span class="num">${order.table_number || '-'}</span> — <span class="num">${order.total.toLocaleString('en-US')}</span> ريال</div>
      ${order.notes ? `<div class="notify-toast__note">🗒️ ${esc(order.notes)}</div>` : ''}
    `;
    el.addEventListener('click', () => {
      closeToast(el);
      switchView('orders');
    });
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => closeToast(el), 8000);
  }

  function closeToast(el) {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }

  async function poll() {
    console.log('[Notify] Polling for new orders since ID:', lastOrderId);
    try {
      const rows = await Api.get(`/api/orders/new-since/${lastOrderId}`);
      console.log('[Notify] Poll response:', rows);
      if (!Array.isArray(rows) || !rows.length) return;
      const fresh = rows.filter((r) => r.id > lastOrderId);
      lastOrderId = Math.max(lastOrderId, ...rows.map((r) => r.id));
      localStorage.setItem('{{SLUG}}.lastOrderId', String(lastOrderId));
      if (!fresh.length) return;
      if (!muted) {
        console.log('[Notify] Playing sound for', fresh.length, 'new orders');
        playSound();
      } else {
        console.log('[Notify] Sound muted, skipping playSound');
      }
      fresh.forEach(showToast);
    } catch (e) {
      console.error('[Notify] Poll error:', e);
    }
  }

  function toggle() {
    muted = !muted;
    localStorage.setItem('{{SLUG}}.notifyMuted', muted ? '1' : '0');
    const btn = document.getElementById('notifyToggleBtn');
    if (btn) btn.textContent = muted ? 'تشغيل صوت الطلبات' : 'كتم صوت الطلبات';
    if (!muted) playSound();
  }

  async function init() {
    console.log('[Notify] init() called');
    const btn = document.getElementById('notifyToggleBtn');
    if (btn) {
      btn.textContent = muted ? 'تشغيل صوت الطلبات' : 'كتم صوت الطلبات';
      btn.addEventListener('click', toggle);
      console.log('[Notify] Button found, muted:', muted);
    } else {
      console.log('[Notify] Button NOT found');
    }
    
    // استئناف الصوت عند أي تفاعل أو عند التركيز على النافذة
    document.addEventListener('pointerdown', ensureCtx, { passive: true });
    document.addEventListener('click', ensureCtx, { passive: true });
    window.addEventListener('focus', ensureCtx, { passive: true });
    
    // محاولة استئناف تلقائية بعد ثانية
    setTimeout(ensureCtx, 1000);

    try {
      const d = await Api.get('/api/orders/last-id');
      console.log('[Notify] last-id response:', d);
      const serverMax = (d && d.max_id) ? d.max_id : 0;
      const stored = parseInt(localStorage.getItem('{{SLUG}}.lastOrderId') || '0', 10);
      lastOrderId = Math.max(serverMax, stored);
      localStorage.setItem('{{SLUG}}.lastOrderId', String(lastOrderId));
      console.log('[Notify] Initialized lastOrderId:', lastOrderId);
    } catch (e) {
      console.error('[Notify] Init last-id error:', e);
    }
    if (timer) clearInterval(timer);
    timer = setInterval(poll, 4000);
    console.log('[Notify] Poll timer started (4s interval)');
  }

  return { init, toggle };
})();