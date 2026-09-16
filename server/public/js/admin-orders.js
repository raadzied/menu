let ordersFilter = 'pending';
let ordersRefreshTimer = null;

async function renderOrders(root) {
  root.innerHTML = `
    <div class="view-section">
      <div class="view-section__title">فواتير الطاولات النشطة</div>
      <div id="billsPanel"><div class="empty-state">جاري تحميل الفواتير...</div></div>
    </div>
    <div class="view-section">
      <div class="view-section__title">الطلبات</div>
      <div class="chips" id="orderFilters"></div>
      <div id="ordersPanel"><div class="empty-state">جاري التحميل...</div></div>
    </div>
  `;
  loadBills();
  ensureBillsRefresh();
  await loadOrders();
  if (ordersRefreshTimer) clearInterval(ordersRefreshTimer);
  ordersRefreshTimer = setInterval(() => {
    if (document.getElementById('ordersPanel')) loadOrders(); else clearInterval(ordersRefreshTimer);
  }, 10000);
}

async function loadOrders() {
  const panel = document.getElementById('ordersPanel');
  if (!panel) return;
  try {
    const orders = await Api.get('/api/orders');
    const counts = { '': orders.length };
    for (const o of orders) counts[o.status] = (counts[o.status] || 0) + 1;
    renderChips(counts);
    const list = ordersFilter ? orders.filter((o) => o.status === ordersFilter) : orders;
    if (!list.length) { panel.innerHTML = '<div class="empty-state">لا توجد طلبات هنا — الطلبات الجديدة تظهر تلقائياً</div>'; return; }
    panel.innerHTML = `<div class="orders-grid">${list.map(orderCard).join('')}</div>`;
    panel.querySelectorAll('[data-order-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await Api.patch(`/api/orders/${btn.dataset.id}/status`, { status: btn.dataset.orderAction });
        loadOrders();
        if (typeof updateNavBadges === 'function') updateNavBadges();
      });
    });
  } catch (e) { panel.innerHTML = '<div class="empty-state">تعذر تحميل الطلبات</div>'; }
}

function renderChips(counts) {
  const box = document.getElementById('orderFilters');
  if (!box) return;
  const defs = [
    ['pending', 'قيد الانتظار'],
    ['confirmed', 'مؤكد'],
    ['preparing', 'قيد التحضير'],
    ['served', 'تم التقديم'],
    ['cancelled', 'ملغى'],
    ['', 'الكل'],
  ];
  box.innerHTML = defs.map(([v, label]) =>
    `<button class="chip ${ordersFilter === v ? 'active' : ''}" data-f="${v}">${label}<span class="num">${counts[v] || 0}</span></button>`
  ).join('');
  box.querySelectorAll('.chip').forEach((c) => {
    c.addEventListener('click', () => {
      ordersFilter = c.dataset.f;
      loadOrders();
    });
  });
}

function orderCard(o) {
  const items = o.items.map((i) => `
    <div class="order-card__item">
      <span class="order-card__item-name">${esc(i.item_name_ar)}</span>
      <span class="num order-card__item-qty">×${i.quantity}</span>
      <span class="num order-card__item-price">${(i.line_total || i.unit_price * i.quantity).toLocaleString('en-US')}</span>
    </div>`).join('');
  const time = o.created_at ? o.created_at.split(' ')[1].slice(0, 5) : '';
  const acts = nextActions(o.status);
  const primary = acts.find((a) => a.value !== 'cancelled');
  const cancel = acts.find((a) => a.value === 'cancelled');
  return `
    <div class="order-card st-${o.status}">
      <div class="order-card__head">
        <span class="order-card__table">طاولة <span class="num">${o.table_number}</span></span>
        <span class="order-card__meta"><span class="num">#${o.id}</span> · <span class="num">${time}</span></span>
      </div>
      <div class="order-card__items">${items}</div>
      ${o.notes ? `<div class="order-card__note">ملاحظة: ${esc(o.notes)}</div>` : ''}
      <div class="order-card__foot">
        <span class="order-card__total"><span class="num">${o.total.toLocaleString('en-US')}</span> ريال</span>
        <span class="badge badge-${o.status}">${statusLabel(o.status)}</span>
      </div>
      ${primary || cancel ? `
      <div class="order-card__actions">
        ${primary ? `<button class="btn btn-${primary.cls}" data-order-action="${primary.value}" data-id="${o.id}">${primary.label}</button>` : ''}
        ${cancel ? `<button class="btn btn-ghost" data-order-action="cancelled" data-id="${o.id}">إلغاء</button>` : ''}
      </div>` : ''}
    </div>
  `;
}

function nextActions(status) {
  switch (status) {
    case 'pending': return [
      { value: 'confirmed', label: 'تأكيد الطلب', cls: 'success' },
      { value: 'cancelled', label: 'إلغاء', cls: 'danger' },
    ];
    case 'confirmed': return [
      { value: 'preparing', label: 'بدء التحضير', cls: 'info' },
      { value: 'cancelled', label: 'إلغاء', cls: 'danger' },
    ];
    case 'preparing': return [
      { value: 'served', label: 'تم التقديم', cls: 'white' },
    ];
    default: return [];
  }
}