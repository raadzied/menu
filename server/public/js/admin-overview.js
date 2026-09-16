async function renderOverview(root) {
  try {
    const s = await Api.get('/api/dashboard/summary');
    root.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-card__label">طلبات اليوم</div><div class="stat-card__value"><span class="num">${s.today_orders_count}</span></div></div>
        <div class="stat-card"><div class="stat-card__label">إيراد اليوم</div><div class="stat-card__value"><span class="num">${s.today_revenue.toLocaleString('en-US')}</span> ريال</div></div>
        <div class="stat-card"><div class="stat-card__label">طلبات قيد التنفيذ</div><div class="stat-card__value"><span class="num">${s.pending_orders}</span></div></div>
        <div class="stat-card"><div class="stat-card__label">طاولات مشغولة</div><div class="stat-card__value"><span class="num">${s.active_tables}</span> / <span class="num">${s.total_tables}</span></div></div>
      </div>
      <div class="panel">
        <div class="panel__title">الأصناف الأكثر طلبًا اليوم</div>
        ${s.top_items_today.length ? `
          <table class="data-table"><thead><tr><th>الصنف</th><th>الكمية المطلوبة</th></tr></thead>
          <tbody>${s.top_items_today.map((i) => `<tr><td>${esc(i.item_name_ar)}</td><td><span class="num">${i.qty}</span></td></tr>`).join('')}</tbody></table>
        ` : '<div class="empty-state">لا توجد طلبات بعد اليوم</div>'}
      </div>
    `;
  } catch (e) { root.innerHTML = `<div class="empty-state">تعذر تحميل البيانات</div>`; }
}
