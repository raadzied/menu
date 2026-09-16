let billsRefreshTimer = null;
let billsTimer = null;

function fmtTime(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

async function loadBills() {
  const panel = document.getElementById('billsPanel');
  if (!panel) return;
  try {
    const bills = await Api.get('/api/orders/bills');
    if (!bills.length) {
      clearInterval(billsTimer);
      billsTimer = null;
      panel.innerHTML = '<div class="empty-state">لا توجد طاولات نشطة حالياً</div>';
      return;
    }
    panel.innerHTML = `<div class="bills-grid">${bills.map(billCard).join('')}</div>`;
    panel.querySelectorAll('[data-extend]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await Api.post(`/api/tables/${btn.dataset.extend}/session/extend`, { minutes: 10 });
        loadBills();
      });
    });
    panel.querySelectorAll('[data-close-bill]').forEach((btn) => {
      btn.addEventListener('click', () => confirmCloseBill(btn.dataset.closeBill, btn.dataset.tableId));
    });
    panel.querySelectorAll('[data-print-bill]').forEach((btn) => {
      btn.addEventListener('click', () => printBill(parseInt(btn.dataset.printBill, 10)));
    });
    startCountdowns();
  } catch (e) { panel.innerHTML = '<div class="empty-state">تعذر تحميل الفواتير</div>'; }
}

function ensureBillsRefresh() {
  if (billsRefreshTimer) clearInterval(billsRefreshTimer);
  billsRefreshTimer = setInterval(() => {
    if (document.getElementById('billsPanel')) loadBills();
    else clearInterval(billsRefreshTimer);
  }, 8000);
}

function billCard(b) {
  const items = b.items.length
    ? b.items.map((i) => `
      <div class="bill-item">
        <span class="bill-item__name">${esc(i.item_name_ar)}</span>
        <span class="bill-item__qty">×<span class="num">${i.quantity}</span></span>
        <span class="bill-item__price"><span class="num">${i.line_total.toLocaleString('en-US')}</span> ريال</span>
      </div>`).join('')
    : '<div class="empty-state">لا توجد أصناف بعد</div>';
  return `
    <div class="bill-card ${b.expiring_soon ? 'bill-card--urgent' : ''}" data-bill-id="${b.session_id}">
      <div class="bill-card__head">
        <div class="bill-card__title">${esc(b.label)}</div>
        <div class="bill-card__count">${b.orders_count} طلب</div>
      </div>
      <div class="bill-card__items">${items}</div>
      <div class="bill-card__foot">
        <div class="bill-card__total">فاتورة الطاولة: <span class="num">${b.total.toLocaleString('en-US')}</span> ريال</div>
        <div class="bill-card__time">متبقي <span class="num bill-timer" data-rem="${b.remaining_seconds}">${fmtTime(b.remaining_seconds)}</span></div>
      </div>
      <div class="bill-card__actions">
        <button class="btn btn-white" data-print-bill="${b.session_id}">طباعة الفاتورة</button>
        <button class="btn btn-ghost" data-extend="${b.table_id}">+10 دقائق</button>
        <button class="btn btn-danger" data-close-bill="${b.session_id}" data-table-id="${b.table_id}">دفع وإغلاق</button>
      </div>
    </div>
  `;
}

function startCountdowns() {
  if (billsTimer) return;
  billsTimer = setInterval(() => {
    document.querySelectorAll('.bill-timer').forEach((el) => {
      const sec = parseInt(el.dataset.rem, 10) || 0;
      const next = Math.max(0, sec - 1);
      el.dataset.rem = String(next);
      el.textContent = fmtTime(next);
      if (next === 0) el.closest('.bill-card').classList.add('bill-card--urgent');
    });
  }, 1000);
}

function confirmCloseBill(sessionId, tableId) {
  openModal(`
    <div class="invoice-sheet">
      <div class="invoice-sheet__head"><div class="invoice-sheet__brand">{{NAME_AR}}</div></div>
      <div class="invoice-sheet__meta">هل تريد إغلاق فاتورة هذه الطاولة وإنهاء الجلسة؟</div>
      <div class="invoice-sheet__meta">بعد الإغلاق تُعاد كل الطلبات غير المقدمة كـ"تم التقديم"، ويُفتح من يأتي لاحقاً فاتورة جديدة.</div>
    </div>
    <div class="modal__actions">
      <button class="btn btn-primary" id="confirmCloseBtn">تأكيد الدفع والإغلاق</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>
  `);
  document.getElementById('confirmCloseBtn').addEventListener('click', async () => {
    try {
      await Api.post(`/api/tables/${tableId}/session/end`);
      closeModal();
      await loadBills();
      showFinalBill(sessionId);
    } catch (e) { closeModal(); }
  });
}

async function showFinalBill(sessionId) {
  try {
    const bill = await Api.get(`/api/orders/bills/session/${sessionId}`);
    const s = bill.session;
    openModal(`
      <div class="invoice-sheet session-bill">
        <div class="invoice-sheet__head">
          <div class="invoice-sheet__brand">{{NAME_AR}}</div>
          <div class="invoice-sheet__meta">فاتورة الطاولة — مدفوعة</div>
        </div>
        <div class="invoice-sheet__meta">الطاولة: <span class="num">${esc(s.label || ('طاولة ' + s.table_number))}</span>
          &middot; <span class="num">${bill.orders_count}</span> طلب</div>
        <table class="data-table invoice-table">
          <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead>
          <tbody>
            ${bill.merged_items.map((i) => `
              <tr>
                <td>${esc(i.item_name_ar)}</td>
                <td><span class="num">${i.quantity}</span></td>
                <td><span class="num">${i.unit_price.toLocaleString('en-US')}</span></td>
                <td><span class="num">${i.line_total.toLocaleString('en-US')}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="invoice-sheet__total">الإجمالي: <span class="num">${bill.total.toLocaleString('en-US')}</span> ريال</div>
      </div>
      <div class="modal__actions">
        <button class="btn btn-primary" onclick="printBill(${sessionId})">طباعة الفاتورة</button>
        <button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>
      </div>
    `);
  } catch (e) {}
}

async function printBill(sessionId) {
  let bill;
  try {
    bill = await Api.get(`/api/orders/bills/session/${sessionId}`);
  } catch (e) { return; }
  const s = bill.session;
  const lines = bill.merged_items.map((i) => `
    <tr>
      <td>${esc(i.item_name_ar)}</td>
      <td><span class="num">${i.quantity}</span></td>
      <td><span class="num">${i.unit_price.toLocaleString('en-US')}</span></td>
      <td><span class="num">${i.line_total.toLocaleString('en-US')}</span></td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>فاتورة الطاولة ${esc(s.label || s.table_number)}</title>
    <style>
      body { direction: rtl; font-family: 'Segoe UI', Arial, sans-serif; padding: 24px; color: #000; }
      .inv-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 14px; }
      .inv-brand { font-size: 22px; font-weight: 800; }
      .inv-sub { margin: 4px 0; }
      .inv-table { width: 100%; border-collapse: collapse; margin: 12px 0; }
      .inv-table th, .inv-table td { border: 1px solid #ccc; padding: 8px 10px; text-align: right; }
      .inv-table th { background: #f2f2f2; }
      .num { font-weight: 700; }
      .inv-total { font-size: 19px; font-weight: 800; text-align: left; margin-top: 12px; }
    </style></head><body>
      <div class="inv-head"><div class="inv-brand">{{NAME_AR}}</div><div>فاتورة الطاولة</div></div>
      <div class="inv-sub">الطاولة: <span class="num">${esc(s.label || ('طاولة ' + s.table_number))}</span> &middot; <span class="num">${bill.orders_count}</span> طلب في الجلسة</div>
      <table class="inv-table">
        <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead>
        <tbody>${lines}</tbody>
      </table>
      <div class="inv-total">إجمالي الفاتورة: <span class="num">${bill.total.toLocaleString('en-US')}</span> ريال</div>
      <div class="inv-sub">{{NAME_AR}} - شكراً لزيارتكم</div>
      <script>window.onload = function(){ window.print(); }<\/script>
    </body></html>`;
  const w = window.open('', '_blank', 'width=420,height=640');
  w.document.write(html);
  w.document.close();
}