let tablesRefreshTimer = null;

async function renderTables(root) {
  root.innerHTML = `
    <div class="toolbar"><div></div><button class="btn btn-primary" id="addTableBtn">إضافة طاولة جديدة</button></div>
    <div class="grid-cards" id="tablesGrid"><div class="empty-state">جاري التحميل...</div></div>
  `;
  document.getElementById('addTableBtn').addEventListener('click', openAddTableModal);
  await loadTables();
  if (tablesRefreshTimer) clearInterval(tablesRefreshTimer);
  tablesRefreshTimer = setInterval(() => {
    if (document.getElementById('tablesGrid')) loadTables(); else clearInterval(tablesRefreshTimer);
  }, 5000);
}

async function loadTables() {
  const grid = document.getElementById('tablesGrid');
  if (!grid) return;
  try {
    const tables = await Api.get('/api/tables');
    if (!tables.length) { grid.innerHTML = '<div class="empty-state">لا توجد طاولات بعد</div>'; return; }
    grid.innerHTML = tables.map(tableCard).join('');
    bindTableCardEvents(tables);
  } catch (e) { grid.innerHTML = '<div class="empty-state">تعذر تحميل الطاولات</div>'; }
}

function tableCard(t) {
  const session = t.active_session;
  let timerText = 'لا توجد جلسة نشطة';
  if (session && session.status === 'active') {
    const remaining = Math.max(0, Math.round((new Date(session.expires_at.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 60000));
    timerText = `الوقت المتبقي: <span class="num">${remaining}</span> دقيقة`;
    if (session.device_count > 1) timerText += ` · <span class="num">${session.device_count}</span> أجهزة`;
  }
  return `
    <div class="table-card">
      <div class="table-card__head"><span class="table-card__num">طاولة <span class="num">${t.table_number}</span></span><span class="badge badge-${t.status}">${statusLabel(t.status)}</span></div>
      <div style="font-size:12px; color:#9a9a9a; margin-bottom:6px;">${esc(t.label)} &middot; الجلسة: <span class="num">${t.session_minutes}</span> د &middot; كود: <span class="num" style="color:#fbbf24;letter-spacing:2px;">${esc(t.card_code) || '—'}</span></div>
      <div class="table-card__timer">${timerText}</div>
      <div class="table-card__actions">
        ${session && session.status === 'active'
          ? `<button class="btn btn-secondary" data-action="extend" data-id="${t.id}">تمديد 10د</button>
             <button class="btn btn-danger" data-action="end" data-id="${t.id}">إنهاء الجلسة</button>`
          : `<button class="btn btn-secondary" data-action="start" data-id="${t.id}">بدء جلسة</button>`}
        <button class="btn btn-ghost" data-action="qr" data-id="${t.id}">رمز QR</button>
        <button class="btn btn-ghost" data-action="edit" data-id="${t.id}">تعديل</button>
      </div>
    </div>
  `;
}

function bindTableCardEvents(tables) {
  document.querySelectorAll('[data-action="start"]').forEach((btn) => btn.addEventListener('click', async () => { await Api.post(`/api/tables/${btn.dataset.id}/session/start`); loadTables(); }));
  document.querySelectorAll('[data-action="extend"]').forEach((btn) => btn.addEventListener('click', async () => { await Api.post(`/api/tables/${btn.dataset.id}/session/extend`, { minutes: 10 }); loadTables(); }));
  document.querySelectorAll('[data-action="end"]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('هل تريد إنهاء جلسة هذه الطاولة؟')) return;
    await Api.post(`/api/tables/${btn.dataset.id}/session/end`); loadTables();
  }));
  document.querySelectorAll('[data-action="qr"]').forEach((btn) => btn.addEventListener('click', () => openQrModal(btn.dataset.id, tables.find((t) => String(t.id) === btn.dataset.id))));
  document.querySelectorAll('[data-action="edit"]').forEach((btn) => btn.addEventListener('click', () => openEditTableModal(tables.find((t) => String(t.id) === btn.dataset.id))));
}

function openAddTableModal() {
  openModal(`
    <div class="modal__title">إضافة طاولة جديدة</div>
    <div class="field"><label>رقم الطاولة</label><input id="newTableNumber" type="number" min="1"></div>
    <div class="field"><label>اسم/موقع الطاولة (اختياري)</label><input id="newTableLabel" type="text" placeholder="مثال: الشرفة 2"></div>
    <div class="field"><label>مدة الجلسة (بالدقائق)</label><input id="newTableMinutes" type="number" value="20" min="1"></div>
    <div class="modal__actions"><button class="btn btn-primary" id="saveNewTableBtn">إضافة</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button></div>
  `);
  document.getElementById('saveNewTableBtn').addEventListener('click', async () => {
    try {
      await Api.post('/api/tables', {
        table_number: parseInt(document.getElementById('newTableNumber').value, 10),
        label: document.getElementById('newTableLabel').value || undefined,
        session_minutes: parseInt(document.getElementById('newTableMinutes').value, 10) || 20,
      });
      closeModal(); loadTables();
    } catch (e) { alert(e.message); }
  });
}

function openEditTableModal(t) {
  openModal(`
    <div class="modal__title">تعديل طاولة ${t.table_number}</div>
    <div class="field"><label>اسم/موقع الطاولة</label><input id="editTableLabel" type="text" value="${esc(t.label)}"></div>
    <div class="field"><label>مدة الجلسة الافتراضية (بالدقائق)</label><input id="editTableMinutes" type="number" value="${t.session_minutes}" min="1"></div>
    <div class="field"><label>كود الطاولة (6 أرقام — يُطبع على البطاقة)</label>
      <div style="display:flex; gap:8px; align-items:center;">
        <input id="editTableCode" type="text" value="${esc(t.card_code)}" readonly style="flex:1;">
        <button class="btn btn-ghost" id="regenCodeBtn" type="button">كود جديد</button>
      </div>
    </div>
    <div class="field"><label>الحالة</label>
      <select id="editTableStatus">
        <option value="available" ${t.status === 'available' ? 'selected' : ''}>متاحة</option>
        <option value="occupied" ${t.status === 'occupied' ? 'selected' : ''}>مشغولة</option>
        <option value="disabled" ${t.status === 'disabled' ? 'selected' : ''}>معطّلة</option>
      </select>
    </div>
    <div class="modal__actions">
      <button class="btn btn-primary" id="saveEditTableBtn">حفظ</button>
      <button class="btn btn-danger" id="deleteTableBtn">حذف الطاولة</button>
      <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
    </div>
  `);
  document.getElementById('saveEditTableBtn').addEventListener('click', async () => {
    try {
      await Api.patch(`/api/tables/${t.id}`, {
        label: document.getElementById('editTableLabel').value,
        session_minutes: parseInt(document.getElementById('editTableMinutes').value, 10),
        status: document.getElementById('editTableStatus').value,
      });
      closeModal(); loadTables();
    } catch (e) { alert(e.message); }
  });
  document.getElementById('regenCodeBtn').addEventListener('click', async () => {
    if (!confirm('سيُلغى الكود الحالي المطبوع فورًا. يجب إعادة طباعة بطاقة هذه الطاولة بالكود الجديد. متابعة؟')) return;
    try {
      const d = await Api.patch(`/api/tables/${t.id}`, { reset_code: true });
      document.getElementById('editTableCode').value = d.card_code || '';
      loadTables();
      alert('الكود الجديد: ' + d.card_code + ' — أعد طباعة بطاقة هذه الطاولة');
    } catch (e) { alert(e.message); }
  });
  document.getElementById('deleteTableBtn').addEventListener('click', async () => {
    if (!confirm('سيتم حذف هذه الطاولة نهائيًا، هل أنت متأكد؟')) return;
    await Api.del(`/api/tables/${t.id}`); closeModal(); loadTables();
  });
}

async function openQrModal(tableId, table) {
  openModal(`
    <div class="modal__title">رمز QR لطاولة ${table ? table.table_number : ''}</div>
    <div class="qr-preview"><img src="/api/qr/table/${tableId}.png" alt="رمز QR"><div class="qr-link" id="qrLinkText">جاري تحميل الرابط...</div></div>
    <div class="qr-note">هذا الرمز دائم ولا يتغير — يُطبع ويُحفر على الطاولة مرة واحدة.</div>
    <div class="modal__actions">
      <button class="btn btn-secondary" id="printQrBtn">طباعة صفحة الرموز</button>
      <button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>
    </div>
  `);
  try { const { url } = await Api.get(`/api/qr/table/${tableId}/link`); document.getElementById('qrLinkText').textContent = url; } catch (e) {}
  document.getElementById('printQrBtn').addEventListener('click', () => {
    window.open('/api/qr/print', '_blank');
  });
}
