// منطق صفحة منيو الزبون - تصميم {{NAME_AR}} (حلقة نارية متوهجة + تبويبات سفلية للأقسام)
// الأصناف تُعرض في كاروسيل دائري ثلاثي الأبعاد: الصنف الأمامي واضح، والبقية بضبابية خفيفة،
// مع سحب أفقي بحركة سلسة (قصور ذاتي + التصاق بالمركز).

/* ===== مؤثر لمس بصري (Ripple) — أُزيلت كل الأصوات من الواجهة ===== */
const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function haptic(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} } }
/* تفعيل بالنقرة (pointerup) بدل click: يستجيب فورًا للّمس على الجوال ويتجنّب
   «الضغطة الأولى المبتلوعة» في WebView/الأجهزة البطيئة. يبقى click/keyboard للموصل ولإمكانية الوصول. */
function bindTap(el, fn) {
  if (!el) return;
  let down = null, tapped = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() }; tapped = false;
  }, { passive: true });
  el.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 600;
    down = null;
    if (moved < 12 && quick) { tapped = true; try { e.preventDefault(); } catch (_) {} fn(e); }
  });
  el.addEventListener('click', (e) => { if (tapped) { tapped = false; return; } fn(e); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); } });
}
function addRipple(el, e) {
  // بلا getBoundingClientRect/getComputedStyle (كانت تُجبر إعادة تخطيط فورية لمشهد الـ3D = 89ms تعليق)
  if (!el || el.classList.contains('cart-fab')) return;
  const size = 220;
  const s = document.createElement('span');
  s.className = 'ripple';
  const x = (typeof e.offsetX === 'number' ? e.offsetX : size / 2);
  const y = (typeof e.offsetY === 'number' ? e.offsetY : size / 2);
  s.style.width = s.style.height = size + 'px';
  s.style.left = (x - size / 2) + 'px';
  s.style.top = (y - size / 2) + 'px';
  el.classList.add('ripple-host');
  el.appendChild(s);
  s.addEventListener('animationend', () => s.remove(), { once: true });
  setTimeout(() => s.remove(), 700);
}

const app = document.getElementById('app');
const params = new URLSearchParams(window.location.search);
const tableToken = params.get('t');
const claimedSession = params.get('s');

let sessionInfo = null;
let categories = [];
let activeCatId = null;
let cart = {};
let countdownTimer = null;
let pollTimer = null;

function renderState(title, desc, back = false) {
  const backBtn = back === 'portal'
    ? `<button class="btn btn-primary" onclick="location.replace('/portal.html')" style="margin-top:20px;">الذهاب لصفحة الدخول</button>`
    : back ? `<button class="btn btn-primary" onclick="location.reload()" style="margin-top:20px;">العودة للمنيو والطلب مجدداً</button>` : '';
  app.innerHTML = `
    <div class="state-screen">
      <div class="state-screen__badge"></div>
      <div class="state-screen__title">${title}</div>
      <div class="state-screen__desc">${desc}</div>
      ${backBtn}
    </div>
  `;
}

function renderJoin() {
  app.innerHTML = `
    <div class="state-screen">
      <div class="state-screen__badge"></div>
      <div class="state-screen__title">كود الطاولة</div>
      <div class="state-screen__desc">امسح رمز QR على طاولتك، أو ادخل الكود المكوّن من 6 أرقام المطبوع على بطاقتها:</div>
      <input id="joinCode" type="text" inputmode="numeric" maxlength="8" autocomplete="off"
        placeholder="0 0 0 0 0 0" style="width:min(72vw,240px);text-align:center;direction:ltr;font-family:var(--font-mono);font-weight:700;font-size:26px;letter-spacing:8px;padding:12px 10px 12px 18px;border-radius:14px;border:1px solid var(--dark-line);background:var(--dark-800);color:var(--paper-000);">
      <div id="joinErr" style="color:#f0a794;font-size:12px;min-height:18px;"></div>
      <button class="add-btn" id="joinBtn" style="max-width:240px;width:min(72vw,240px)">دخول</button>
    </div>
  `;
  const input = document.getElementById('joinCode');
  const btn = document.getElementById('joinBtn');
  const errEl = document.getElementById('joinErr');
  const submit = () => {
    const code = (input.value || '').replace(/\D/g, '');
    errEl.textContent = '';
    if (code.length !== 6) { errEl.textContent = 'الكود 6 أرقام'; return; }
    btn.disabled = true;
    fetch('/api/session/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    }).then((r) => r.json().then((d) => ({ ok: r.ok, d }))).then((x) => {
      btn.disabled = false;
      if (x.ok && x.d.menu_url) { location.href = x.d.menu_url; return; }
      errEl.textContent = (x.d && x.d.error) || 'تعذر التحقق — نادِ الكاشير';
      input.select();
    }).catch(() => { btn.disabled = false; errEl.textContent = 'تعذر الاتصال بالخادم'; });
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  input.focus();
}

async function init() {
  if (!tableToken) {
    renderJoin();
    return;
  }
  renderState('جاري التحضير', 'يتم الآن تجهيز قائمة الطعام الخاصة بطاولتك...');
  try {
    const checkUrl = `/api/session/check?t=${encodeURIComponent(tableToken)}` +
      (claimedSession ? `&s=${encodeURIComponent(claimedSession)}` : '');
    const res = await fetch(checkUrl);
    const data = await res.json();
    if (res.status === 410 || data.status === 'ended') { location.replace('/portal.html'); return; }
    if (!res.ok) { renderState('تعذر فتح المنيو', data.error || 'حدث خطأ غير متوقع.'); return; }
    sessionInfo = data;
    try { history.replaceState(null, '', `/menu?t=${encodeURIComponent(tableToken)}&s=${encodeURIComponent(sessionInfo.session_id)}`); } catch (_) {}
    if (data.card_code) { try { localStorage.setItem('{{SLUG}}_code', data.card_code); } catch (_) {} }
    const catRes = await fetch('/api/menu/public');
    categories = await catRes.json();
    activeCatId = categories.length ? categories[0].id : null;
    renderMenu();
    startCountdown();
    startPolling();
  } catch (e) {
    renderState('لا يوجد اتصال بالخادم', 'تأكد من اتصال جهازك بشبكة المطعم المحلية (واي فاي) وحاول مرة أخرى.');
  }
}

function formatPrice(v) { return `${v.toLocaleString('en-US')} ريال`; }

function renderMenu() {
  app.innerHTML = `
    <div class="menu-shell">
      <header class="menu-header">
        <div class="menu-header__logo">
          <img src="/images/logo.png?v=2" alt="{{NAME_AR}}">
          <div class="menu-header__title">{{NAME_AR}}</div>
        </div>
        <div class="menu-header__actions">
          <div class="table-pill">طاولة <strong>${sessionInfo.table_number}</strong>${sessionInfo.devices > 1 ? ` <span style="opacity:0.75">· ${sessionInfo.devices} أجهزة</span>` : ''}</div>
        </div>
      </header>
      <div class="session-bar">
        <div class="session-bar__track"><div class="session-bar__fill" id="sessionFill"></div></div>
        <div class="session-bar__time" id="sessionTime">--:--</div>
      </div>
      <div class="category-heading" id="categoryHeading"></div>

      <div class="category-view" id="categoryView"></div>

      <nav class="bottom-nav" id="bottomNav"></nav>
    </div>

    <div class="cart-fab" id="cartFab">
      <span class="cart-fab__count" id="cartCount">0</span>
      <span class="cart-fab__total" id="cartTotal">0 ريال</span>
    </div>

    <div class="cart-drawer" id="cartDrawer">
      <div class="cart-drawer__backdrop" id="cartBackdrop"></div>
      <div class="cart-drawer__panel">
        <button class="close-drawer-btn" id="closeCartBtn">✕</button>
        <div class="cart-drawer__title">طلبك</div>
        <div id="cartLines"></div>
        <div class="cart-summary"><span>الإجمالي</span><span id="cartSummaryTotal">0 ريال</span></div>
        <textarea class="notes-field" id="orderNotes" maxlength="300" placeholder="ملاحظات إضافية على الطلب (اختياري)"></textarea>
        <button class="submit-order-btn" id="submitOrderBtn">إرسال الطلب إلى الكاشير</button>
      </div>
    </div>
  `;

  renderBottomNav();
  renderCategoryView();

  bindTap(document.getElementById('cartFab'), () => toggleDrawer(true));
  bindTap(document.getElementById('closeCartBtn'), () => toggleDrawer(false));
  bindTap(document.getElementById('cartBackdrop'), () => toggleDrawer(false));
  bindTap(document.getElementById('submitOrderBtn'), submitOrder);

}

function renderBottomNav() {
  const svgIcons = {
    'العروض': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 12.7c-1.2 3.9-4.5 6.3-8.6 6.3-4.9 0-9-4-9-9 0-4.1 2.4-7.4 6.3-8.6-.6 4.4 2.9 8.2 7.4 8.2 1.4 0 2.8-.4 3.9-1.2.1.7 0 2.4 0 4.3z"/></svg>',
    'المقبلات': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14h18a9 9 0 0 1-18 0z"/><path d="M7 14c0-2.2 2.2-4 5-4s5 1.8 5 4"/><path d="M12 10V7"/><path d="M9.5 5.5c.6-.9 1.6-1.2 2.5-.8.9-.4 1.9-.1 2.5.8"/></svg>',
    'البيتزا': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21C7 17.5 4 13.8 4 10a8 8 0 0 1 16 0c0 3.8-3 7.5-8 11z"/><path d="M8 9.5c2.6-1.4 5.4-1.4 8 0"/><path d="M9.5 13.5c1.6-.9 3.4-.9 5 0"/><circle cx="10" cy="7.5" r="0.6" fill="currentColor" stroke="none"/><circle cx="14" cy="7" r="0.6" fill="currentColor" stroke="none"/><circle cx="12" cy="11" r="0.6" fill="currentColor" stroke="none"/></svg>',
    'المشروبات': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10l-1 6a4 4 0 0 1-8 0z"/><path d="M12 13v6"/><path d="M8.5 21h7"/><path d="M17 4.5c1.2-.6 2.3-.5 3 .5"/></svg>',
    'الحلويات': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13.5C4 9.4 7.6 6.5 12 6.5s8 2.9 8 7c0 1.4-1.1 2.5-2.5 2.5h-11C5.1 16 4 14.9 4 13.5z"/><path d="M8.5 6.3c.5-1.2 1.8-2 3.5-2s3 .8 3.5 2"/><path d="M12 4.3V2.5"/><path d="M7 19.5h10"/></svg>'
  };
  const defaultSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/></svg>';
  const nav = document.getElementById('bottomNav');
  nav.innerHTML = '<span class="bottom-nav__glass" id="bottomNavGlass"></span>' + categories.map((c) => `
    <button class="bottom-nav__item ${c.id === activeCatId ? 'active' : ''}" data-cat="${c.id}">
      <span class="bottom-nav__icon">${svgIcons[c.name_ar] || defaultSvg}</span>
      <span>${c.name_ar}</span>
    </button>
  `).join('');
  nav.querySelectorAll('.bottom-nav__item').forEach((btn) => {
    bindTap(btn, () => {
      activeCatId = parseInt(btn.dataset.cat, 10);
      nav.querySelectorAll('.bottom-nav__item').forEach((b) => b.classList.toggle('active', b === btn));
      moveNavGlass();
      renderCategoryView();
    });
  });
  requestAnimationFrame(moveNavGlass);
}

function moveNavGlass() {
  const nav = document.getElementById('bottomNav');
  const glass = document.getElementById('bottomNavGlass');
  const active = nav ? nav.querySelector('.bottom-nav__item.active') : null;
  if (!nav || !glass || !active) return;
  const navRect = nav.getBoundingClientRect();
  const btnRect = active.getBoundingClientRect();
  const width = btnRect.width * 0.95;
  const left = btnRect.left - navRect.left + (btnRect.width - width) / 2;
  glass.style.left = `${left}px`;
  glass.style.width = `${width}px`;
}

/* =========================================================================
   الكاروسيل الدائري ثلاثي الأبعاد (coverflow أسطواني)
   ========================================================================= */
 const CAR = {
  items: [], cards: [], pos: 0, count: 0,
  R: 0, angle: 26, gap: 1.18, cw: 0, stepPx: 220, visLimit: 2.4,
  stage: null, ring: null, dotsEl: null,
  dragging: false, pointerId: null, startX: 0, startPos: 0,
  lastX: 0, lastT: 0, vel: 0, moved: 0, raf: 0, tweenId: 0,
};

function renderCategoryView() {
  const view = document.getElementById('categoryView');
  const heading = document.getElementById('categoryHeading');
  const cat = categories.find((c) => c.id === activeCatId);
  if (heading) heading.textContent = cat ? cat.name_ar : '';
  if (!cat || !cat.items.length) {
    CAR.items = []; CAR.cards = []; CAR.count = 0;
    view.innerHTML = `<div class="state-screen" style="min-height:auto; padding:60px 20px; background:transparent;"><div class="state-screen__desc">لا توجد أصناف في هذا القسم حاليًا</div></div>`;
    return;
  }
  view.innerHTML = `
    <div class="carousel-stage" id="carouselStage" tabindex="0" aria-roledescription="carousel" aria-label="أصناف ${cat.name_ar}">
      <div class="carousel-ring" id="carouselRing">
        ${cat.items.map(renderCarouselCard).join('')}
      </div>
      <div class="carousel-dots" id="carouselDots" aria-hidden="true"></div>
      <div class="carousel-hint" id="carouselHint">اسحب يمينًا ويسارًا لتصفح الأصناف</div>
    </div>
  `;
  CAR.items = cat.items;
  CAR.cards = Array.from(view.querySelectorAll('.carousel-card'));
  CAR.count = CAR.cards.length;
  CAR.stage = document.getElementById('carouselStage');
  CAR.ring = document.getElementById('carouselRing');
  CAR.dotsEl = document.getElementById('carouselDots');

  bindItemControls(cat.items);
  buildDots();
  bindCarouselDrag();
  CAR.pos = 0;
  CAR._lastActive = 0;
  measureCarousel();
  layoutCarousel();

  // أنميشن دخول متدرّج للأصناف (على عناصر البطاقة الداخلية — لا يعارض تحكّم JS بالموضع)
  if (!REDUCED) {
    CAR.cards.forEach((card, idx) => {
      const a = card.querySelector('.item-photo-ring');
      const b = card.querySelector('.item-slide__name');
      const delay = Math.min(idx * 55, 420);
      [a, b].forEach((el) => { if (el) { el.style.animationDelay = delay + 'ms'; el.classList.add('enter'); } });
      setTimeout(() => { [a, b].forEach((el) => { if (el) { el.classList.remove('enter'); el.style.animationDelay = ''; } }); }, delay + 520);
    });
  }

  // تلميح حركة خفيف أول مرة: ننظر للجانب ثم نستقر على الأول
  if (CAR.count > 1) { CAR.pos = 0.16; layoutCarousel(); tweenTo(0, 420); }
}

function renderCarouselCard(item) {
  const initial = item.name_ar.trim().charAt(0);
  return `
    <section class="item-slide carousel-card" data-item-id="${item.id}" aria-hidden="true">
      <div class="item-photo-ring">
        ${item.image_path ? `<img src="${item.image_path}" alt="${item.name_ar}" draggable="false" loading="lazy" decoding="async" width="300" height="300">` : `<div class="item-photo-ring__initial">${initial}</div>`}
      </div>
      <div class="item-slide__name">${item.name_ar}</div>
      ${item.description_ar ? `<div class="item-slide__desc">${item.description_ar}</div>` : ''}
      ${item.is_spicy ? '<span class="spicy-tag">حار</span>' : ''}
      <div class="item-slide__price">${formatPrice(item.price)}</div>
      <div class="item-slide__control"></div>
    </section>
  `;
}

/* المسافة الصحيحة لتوزيع البطاقات حول دائرة بلا تداخل = نصف قطر «الإسقاط الرأسي» (apotem):
   R = (عرضالبطاقة / 2) / tan(زاويةالخطوة / 2). نضرب في gap لترك هامش تنفّس بين الأصناف. */
function measureCarousel() {
  if (!CAR.stage || !CAR.count) return;
  const stageRect = CAR.stage.getBoundingClientRect();
  const cw = CAR.cards[0] ? CAR.cards[0].offsetWidth : Math.min(stageRect.width * 0.72, 320);
  CAR.cw = cw || 300;
  const aRad = CAR.angle * Math.PI / 180;
  CAR.R = (CAR.cw / 2) / Math.tan(aRad / 2) * CAR.gap;   // apothem × هامش
  CAR.stepPx = CAR.cw * 0.92;                             // مسافة السحب لتقدّم خانة واحدة
  CAR.visLimit = Math.max(1.35, Math.min(2.4, CAR.count / 2 - 0.08)); // نافذة الرؤية (تضمّن الجيران وتُخفي منطقة الالتفاف)
  CAR.ring.style.transform = `translateZ(${-CAR.R}px)`;
}

function frontIndex() {
  const N = CAR.count; if (N <= 0) return 0;
  return ((Math.round(CAR.pos) % N) + N) % N;
}
// إزاحة دورية أقرب خانة (تعطي loop لانهائي): d في المدى (-N/2, N/2]
function circularOffset(i) {
  const N = CAR.count; if (N <= 1) return 0;
  const d = i - CAR.pos;
  return d - N * Math.round(d / N);
}

function layoutCarousel() {
  if (!CAR.cards || !CAR.count) return;
  const step = CAR.angle, R = CAR.R, vis = CAR.visLimit, N = CAR.count;
  for (let i = 0; i < N; i++) {
    const card = CAR.cards[i];
    const off = circularOffset(i);
    const ad = Math.abs(off);
    const rot = off * step;

    let blur, opacity, bright, scale;
    if (ad <= 0.5) { blur = 0; opacity = 1; bright = 1; scale = 1; }
    else {
      blur = Math.min(3.2, (ad - 0.5) * 1.35);                  // بلور خفيف جدًا على الجوانب
      bright = Math.max(0.85, 1 - ad * 0.05);
      scale = Math.max(0.95, 1 - ad * 0.02);
      if (ad <= 1) opacity = 1 - (ad - 0.5) * 0.22;             // الجار ≈ 0.89 (ظاهر بوضوح)
      else { const k = (ad - 1) / Math.max(0.001, vis - 1); opacity = Math.max(0, 0.89 * (1 - k)); }
    }
    if (ad > vis + 0.3) opacity = 0;                            // اختفاء تام قبل منطقة الالتفاف

    card.style.transform = `translate(-50%, -50%) rotateY(${rot}deg) translateZ(${R}px) scale(${scale.toFixed(3)})`;
    card.style.zIndex = String(1000 - Math.round(ad * 10));
    // الصنف النشط: بلا طبقة فلتر إطلاقًا (blur(0) يبقى يُجبر إعادة توضيب مُكلفة عند تغيّر محتواه)
    card.style.filter = (ad <= 0.5) ? 'none' : `blur(${blur.toFixed(2)}px) brightness(${bright.toFixed(3)})`;
    card.style.opacity = opacity.toFixed(3);

    const front = ad < 0.5;
    card.classList.toggle('is-active', front);
    card.setAttribute('aria-hidden', front ? 'false' : 'true');
    card.style.pointerEvents = (front && opacity > 0.5) ? 'auto' : 'none';
  }
  // تغيّر الأمام → «تِك» كعقارب + نبضة للصنف الواضح
  const fi = frontIndex();
  if (fi !== CAR._lastActive) { CAR._lastActive = fi; if (CAR.count > 1) onActiveChange(fi); }
  updateDots();
}

function buildDots() {
  if (!CAR.dotsEl) return;
  if (CAR.count <= 1) { CAR.dotsEl.innerHTML = ''; return; }
  CAR.dotsEl.innerHTML = CAR.items.map((_, i) => `<button type="button" class="carousel-dot" data-i="${i}" aria-label="صنف ${i + 1}"></button>`).join('');
  CAR.dotsEl.querySelectorAll('.carousel-dot').forEach((b) => {
    bindTap(b, () => {
      const N = CAR.count, desired = parseInt(b.dataset.i, 10);
      const anchor = Math.round(CAR.pos);
      let delta = desired - frontIndex();
      if (delta > N / 2) delta -= N; if (delta < -N / 2) delta += N;
      tweenTo(anchor + delta);
    });
  });
}

function updateDots() {
  if (!CAR.dotsEl) return;
  const idx = frontIndex();
  CAR.dotsEl.querySelectorAll('.carousel-dot').forEach((b, i) => b.classList.toggle('active', i === idx));
}

function cancelTween() { if (CAR.tweenId) { cancelAnimationFrame(CAR.tweenId); CAR.tweenId = 0; } }

function tweenTo(target, forceDur) {
  cancelTween();
  const from = CAR.pos;
  const dist = Math.abs(target - from);
  if (dist < 0.001) { CAR.pos = target; layoutCarousel(); return; }
  const dur = forceDur || Math.min(720, Math.max(300, dist * 230));
  const t0 = performance.now();
  const ease = (k) => 1 - Math.pow(1 - k, 3); // easeOutCubic
  const frame = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    CAR.pos = from + (target - from) * ease(k);
    layoutCarousel();
    if (k < 1) CAR.tweenId = requestAnimationFrame(frame);
    else { CAR.tweenId = 0; CAR.pos = ((target % CAR.count) + CAR.count) % CAR.count; layoutCarousel(); } // تطبيع بلا أي قفزة (دوري)
  };
  CAR.tweenId = requestAnimationFrame(frame);
}

function bindCarouselDrag() {
  const stage = CAR.stage;
  if (!stage) return;

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    // لا نبدأ السحب إذا بدأت اللمسة فوق زر/حقل — حتى لا نبتلع نقرتها (خصوصًا «إضافة إلى الطلب» على الجوال)
    if (e.target.closest('button, input, textarea, a, select')) return;
    cancelTween();
    CAR.dragging = true; CAR.pointerId = e.pointerId; CAR.moved = 0;
    CAR.startX = e.clientX; CAR.startPos = CAR.pos;
    CAR.lastX = e.clientX; CAR.lastT = performance.now(); CAR.vel = 0;
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    stage.classList.add('is-dragging');
    hideHint();
  };
  const onMove = (e) => {
    if (!CAR.dragging || e.pointerId !== CAR.pointerId) return;
    const dx = e.clientX - CAR.startX;
    CAR.moved = Math.max(CAR.moved, Math.abs(dx));
    // في RTL: السحب لليسار يُقدّم للصنف التالي (pos يزيد) — بلا حدود (loop)
    const p = CAR.startPos - dx / CAR.stepPx;
    const now = performance.now();
    const dt = now - CAR.lastT;
    if (dt > 0) CAR.vel = (CAR.vel * 0.6) + ((p - CAR.pos) / dt * 16) * 0.4;
    CAR.lastX = e.clientX; CAR.lastT = now; CAR.pos = p;
    if (!CAR.raf) CAR.raf = requestAnimationFrame(() => { CAR.raf = 0; layoutCarousel(); });
  };
  const onUp = (e) => {
    if (!CAR.dragging || (e && e.pointerId !== CAR.pointerId)) return;
    CAR.dragging = false;
    try { stage.releasePointerCapture(CAR.pointerId); } catch (_) {}
    stage.classList.remove('is-dragging');
    const anchor = Math.round(CAR.startPos);
    let target;
    if (CAR.moved < 6) target = anchor;                       // نقرة بلا سحب: لا تغيير
    else { target = Math.round(CAR.pos + CAR.vel * 5); target = Math.max(anchor - 3, Math.min(anchor + 3, target)); }
    tweenTo(target);
    if (CAR.moved > 6) swallowNextClick();
  };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('lostpointercapture', onUp);

  // عجلة الفأرة أفقية/عمودية لتدوير الكاروسيل بلطف
  let wheelAcc = 0, wheelTimer = 0;
  stage.addEventListener('wheel', (e) => {
    if (CAR.count <= 1) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    e.preventDefault();
    wheelAcc += delta;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      const step = Math.max(-3, Math.min(3, Math.round(wheelAcc / 80)));
      wheelAcc = 0;
      if (step) tweenTo(Math.round(CAR.pos) + step);
    }, 90);
  }, { passive: false });

  // التنقل بلوحة المفاتيح
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); tweenTo(Math.round(CAR.pos) + 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); tweenTo(Math.round(CAR.pos) - 1); }
  });

  const onResize = () => { if (CAR.count) { measureCarousel(); layoutCarousel(); } };
  window.addEventListener('resize', onResize);
}

// منع نقرة خاطئة على زر «إضافة» بعد السحب
function swallowNextClick() {
  const cap = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  CAR.stage.addEventListener('click', cap, { capture: true, once: true });
}
function hideHint() {
  const hint = document.getElementById('carouselHint');
  if (hint) hint.classList.add('gone');
}

function bindItemControls(items) {
  document.querySelectorAll('.carousel-card').forEach((card) => {
    const id = parseInt(card.dataset.itemId, 10);
    const item = items.find((i) => i.id === id);
    const holder = card.querySelector('.item-slide__control');
    if (item && holder) renderItemControl(item, holder);
  });
}

function renderItemControl(item, holder) {
  if (!holder || !item) return;
  const qty = cart[item.id] ? cart[item.id].qty : 0;
  if (qty === 0) {
    holder.innerHTML = `<button class="add-btn">إضافة إلى الطلب</button>`;
    bindTap(holder.querySelector('.add-btn'), () => {
      cart[item.id] = { item, qty: 1 };
      renderItemControl(item, holder);
      updateCartFab();
      haptic(12); bumpFab();
    });
  } else {
    holder.innerHTML = `
      <div class="qty-control">
        <button data-action="dec">−</button>
        <span>${qty}</span>
        <button data-action="inc">+</button>
      </div>
    `;
    bindTap(holder.querySelector('[data-action="inc"]'), () => {
      cart[item.id].qty += 1;
      renderItemControl(item, holder);
      updateCartFab();
      haptic(6); bumpFab();
    });
    bindTap(holder.querySelector('[data-action="dec"]'), () => {
      cart[item.id].qty -= 1;
      if (cart[item.id].qty <= 0) delete cart[item.id];
      renderItemControl(item, holder);
      updateCartFab();
      haptic(6);
    });
  }
}

function cartArray() { return Object.values(cart); }
function cartTotal() { return cartArray().reduce((s, l) => s + l.item.price * l.qty, 0); }

function updateCartFab() {
  const lines = cartArray();
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const total = cartTotal();
  const fab = document.getElementById('cartFab');
  document.getElementById('cartCount').textContent = count;
  document.getElementById('cartTotal').textContent = formatPrice(total);
  fab.classList.toggle('visible', count > 0);
  fab.classList.toggle('has-items', count > 0);

  document.getElementById('cartLines').innerHTML = lines.map((l) => `
    <div class="cart-line">
      <span class="cart-line__name">${l.item.name_ar} × ${l.qty}</span>
      <span class="cart-line__price">${formatPrice(l.item.price * l.qty)}</span>
    </div>
  `).join('') || '<p style="color:var(--gray-400); font-size:14px;">لم تختر أي صنف بعد.</p>';

  document.getElementById('cartSummaryTotal').textContent = formatPrice(total);
  document.getElementById('submitOrderBtn').disabled = count === 0;
}

function toggleDrawer(open) { document.getElementById('cartDrawer').classList.toggle('open', open); }

async function submitOrder() {
  const btn = document.getElementById('submitOrderBtn');
  btn.disabled = true;
  btn.textContent = 'جاري إرسال الطلب...';
  const items = cartArray().map((l) => ({ menu_item_id: l.item.id, quantity: l.qty }));
  const notes = document.getElementById('orderNotes').value.trim();
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionInfo.session_id, table_token: tableToken, items, notes: notes || undefined }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'تعذر إرسال الطلب');
      btn.disabled = false;
      btn.textContent = 'إرسال الطلب إلى الكاشير';
      return;
    }
    cart = {};
    toggleDrawer(false);
    stopTimers();
    renderState('تم استلام طلبك', 'وصل طلبك إلى الكاشير وسيتم تجهيزه قريبًا. شكرًا لزيارتك {{NAME_AR}}.', true);
  } catch (e) {
    alert('تعذر الاتصال بالخادم، تحقق من اتصال الشبكة المحلية');
    btn.disabled = false;
    btn.textContent = 'إرسال الطلب إلى الكاشير';
  }
}

function startCountdown() { updateCountdown(); countdownTimer = setInterval(updateCountdown, 1000); }

function updateCountdown() {
  const fill = document.getElementById('sessionFill');
  const timeEl = document.getElementById('sessionTime');
  if (!fill || !timeEl || !sessionInfo) return;
  const expires = new Date(sessionInfo.expires_at.replace(' ', 'T') + 'Z').getTime();
  const remainingMs = expires - Date.now();
  if (remainingMs <= 0) {
    stopTimers();
    renderState('انتهت مدة الجلسة', 'انتهى الوقت المخصص لتصفح المنيو. ابدأ جلسة جديدة من صفحة الدخول أو امسح رمز QR على طاولتك.', 'portal');
    return;
  }
  const totalMinutes = sessionInfo.total_minutes || sessionInfo.duration_minutes || 20;
  const totalMs = totalMinutes * 60 * 1000;
  const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
  fill.style.width = `${pct}%`;
  fill.classList.toggle('warn', pct <= 40 && pct > 15);
  fill.classList.toggle('danger', pct <= 15);
  const m = Math.floor(remainingMs / 60000);
  const s = Math.floor((remainingMs % 60000) / 1000);
  timeEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startPolling() {
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/session/status/${sessionInfo.session_id}?t=${encodeURIComponent(tableToken)}`);
      const data = await res.json();
      if (data.status === 'expired' || data.status === 'closed') {
        stopTimers();
        renderState('انتهت الجلسة', 'أنهى الكاشير هذه الجلسة أو انتهت مدتها. ابدأ جلسة جديدة من صفحة الدخول.', 'portal');
        return;
      }
      if (data.expires_at !== sessionInfo.expires_at) sessionInfo.expires_at = data.expires_at;
      if (data.total_minutes) sessionInfo.total_minutes = data.total_minutes;
    } catch (e) { /* تجاهل أخطاء الشبكة المؤقتة */ }
  }, 15000);
}

function stopTimers() {
  if (countdownTimer) clearInterval(countdownTimer);
  if (pollTimer) clearInterval(pollTimer);
}

/* ===== مؤثرات عند التنقّل والضغط ===== */
function onActiveChange(i) {
  haptic(6);
  if (REDUCED) return;
  const card = CAR.cards && CAR.cards[i];
  if (!card) return;
  const img = card.querySelector('.item-photo-ring img, .item-photo-ring__initial');
  if (img) { img.classList.remove('card-pop'); void img.offsetWidth; img.classList.add('card-pop'); }
}
function bumpFab() {
  const fab = document.getElementById('cartFab');
  if (!fab || REDUCED) return;
  fab.classList.remove('bump'); void fab.offsetWidth; fab.classList.add('bump');
  setTimeout(() => fab.classList.remove('bump'), 460);
}

/* التقاط لمسة أي زر: نقرات صوتية + هزّاز + أنميشن ضغط نابض (أسلوب Framer-Motion whileTap).
   passive=true حتى لا نعرقل تأخير المتصفّح على اللمس (مفتاح إزالة «التعليق»). */
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button, .bottom-nav__item, .cart-fab, .qty-control button, .carousel-dot');
  if (!b) return;
  b.classList.add('pressed');
  if (!REDUCED) addRipple(b, e);
}, { passive: true });
const clearPressed = () => document.querySelectorAll('.pressed').forEach((el) => el.classList.remove('pressed'));
document.addEventListener('pointerup', () => setTimeout(clearPressed, 240), { passive: true });
document.addEventListener('pointercancel', clearPressed, { passive: true });
window.addEventListener('blur', clearPressed);

init();
