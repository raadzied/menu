const viewTitles = { orders: 'الطلبات والفواتير', tables: 'الطاولات والجلسات', menu: 'إدارة المنيو', overview: 'التقارير', users: 'المستخدمون' };
const viewRenderers = { orders: renderOrders, tables: renderTables, menu: renderMenuAdmin, overview: renderOverview, users: renderUsers };
let currentUser = null;

async function boot() {
  try { currentUser = await Api.get('/api/auth/me'); }
  catch (e) { window.location.href = '/admin/login.html'; return; }

  document.getElementById('userFooter').textContent = `${currentUser.username} (${currentUser.role === 'admin' ? 'مدير' : 'كاشير'})`;
  document.getElementById('topbarUser').textContent = currentUser.role === 'admin' ? 'صلاحية: مدير النظام' : 'صلاحية: كاشير';
  if (currentUser.role !== 'admin') document.getElementById('usersLink').style.display = 'none';

  document.querySelectorAll('.sidebar__link[data-view]').forEach((link) => {
    link.addEventListener('click', () => switchView(link.dataset.view));
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await Api.post('/api/auth/logout');
    window.location.href = '/admin/login.html';
  });
  switchView('orders');
  Notify.init();
  updateNavBadges();
  setInterval(updateNavBadges, 15000);
}

function switchView(view) {
  document.querySelectorAll('.sidebar__link').forEach((l) => l.classList.toggle('active', l.dataset.view === view));
  document.getElementById('viewTitle').textContent = viewTitles[view];
  const root = document.getElementById('viewRoot');
  root.innerHTML = '<div class="empty-state">جاري التحميل...</div>';
  viewRenderers[view](root);
}

async function updateNavBadges() {
  try {
    const s = await Api.get('/api/dashboard/summary');
    setBadge('badgeOrders', s.pending_orders + s.active_tables);
  } catch (e) {}
}

function setBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  if (count > 0) { el.textContent = count; el.hidden = false; }
  else el.hidden = true;
}

boot();