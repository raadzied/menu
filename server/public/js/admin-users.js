async function renderUsers(root) {
  if (currentUser.role !== 'admin') { root.innerHTML = '<div class="empty-state">هذا القسم متاح لمدير النظام فقط</div>'; return; }
  root.innerHTML = `
    <div class="toolbar"><div></div><button class="btn btn-primary" id="addUserBtn">إضافة مستخدم</button></div>
    <div class="panel" id="usersPanel"><div class="empty-state">جاري التحميل...</div></div>
  `;
  document.getElementById('addUserBtn').addEventListener('click', openAddUserModal);
  await loadUsers();
}

async function loadUsers() {
  const panel = document.getElementById('usersPanel');
  try {
    const users = await Api.get('/api/users');
    panel.innerHTML = `
      <table class="data-table"><thead><tr><th>اسم المستخدم</th><th>الاسم الكامل</th><th>الصلاحية</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${users.map((u) => `
        <tr>
          <td>${u.username}</td><td>${u.full_name || '—'}</td><td>${u.role === 'admin' ? 'مدير' : 'كاشير'}</td>
          <td><span class="badge ${u.is_active ? 'badge-active' : 'badge-cancelled'}">${u.is_active ? 'مفعّل' : 'موقوف'}</span></td>
          <td><button class="btn btn-ghost" data-edit-user="${u.id}">تعديل</button></td>
        </tr>
      `).join('')}</tbody></table>
    `;
    panel.querySelectorAll('[data-edit-user]').forEach((btn) => btn.addEventListener('click', () => openEditUserModal(users.find((u) => u.id == btn.dataset.editUser))));
  } catch (e) { panel.innerHTML = '<div class="empty-state">تعذر تحميل المستخدمين</div>'; }
}

function openAddUserModal() {
  openModal(`
    <div class="modal__title">إضافة مستخدم جديد</div>
    <div class="field"><label>اسم المستخدم</label><input id="newUsername" type="text"></div>
    <div class="field"><label>الاسم الكامل</label><input id="newFullName" type="text"></div>
    <div class="field"><label>كلمة المرور (8 أحرف على الأقل)</label><input id="newPassword" type="password"></div>
    <div class="field"><label>الصلاحية</label><select id="newRole"><option value="cashier">كاشير</option><option value="admin">مدير</option></select></div>
    <div class="modal__actions"><button class="btn btn-primary" id="saveUserBtn">إضافة</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button></div>
  `);
  document.getElementById('saveUserBtn').addEventListener('click', async () => {
    try {
      await Api.post('/api/users', {
        username: document.getElementById('newUsername').value,
        full_name: document.getElementById('newFullName').value || undefined,
        password: document.getElementById('newPassword').value,
        role: document.getElementById('newRole').value,
      });
      closeModal(); loadUsers();
    } catch (e) { alert(e.message); }
  });
}

function openEditUserModal(u) {
  openModal(`
    <div class="modal__title">تعديل ${u.username}</div>
    <div class="field"><label>الاسم الكامل</label><input id="editFullName" type="text" value="${u.full_name || ''}"></div>
    <div class="field"><label>كلمة مرور جديدة (اتركها فارغة لعدم التغيير)</label><input id="editPassword" type="password"></div>
    <div class="field"><label>الصلاحية</label>
      <select id="editRole"><option value="cashier" ${u.role === 'cashier' ? 'selected' : ''}>كاشير</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>مدير</option></select>
    </div>
    <div class="field"><label>الحالة</label>
      <select id="editActive"><option value="1" ${u.is_active ? 'selected' : ''}>مفعّل</option><option value="0" ${!u.is_active ? 'selected' : ''}>موقوف</option></select>
    </div>
    <div class="modal__actions"><button class="btn btn-primary" id="saveEditUserBtn">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button></div>
  `);
  document.getElementById('saveEditUserBtn').addEventListener('click', async () => {
    try {
      await Api.patch(`/api/users/${u.id}`, {
        full_name: document.getElementById('editFullName').value,
        password: document.getElementById('editPassword').value || undefined,
        role: document.getElementById('editRole').value,
        is_active: parseInt(document.getElementById('editActive').value, 10),
      });
      closeModal(); loadUsers();
    } catch (e) { alert(e.message); }
  });
}
