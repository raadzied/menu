let menuCategories = [];
let menuItems = [];

async function renderMenuAdmin(root) {
  root.innerHTML = `
    <div class="toolbar"><div></div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-secondary" id="addCategoryBtn">إضافة قسم</button>
        <button class="btn btn-primary" id="addItemBtn">إضافة صنف</button>
      </div>
    </div>
    <div id="menuAdminRoot"><div class="empty-state">جاري التحميل...</div></div>
  `;
  document.getElementById('addCategoryBtn').addEventListener('click', openAddCategoryModal);
  document.getElementById('addItemBtn').addEventListener('click', () => openItemModal(null));
  await loadMenuAdmin();
}

async function loadMenuAdmin() {
  const holder = document.getElementById('menuAdminRoot');
  try {
    [menuCategories, menuItems] = await Promise.all([Api.get('/api/menu/categories'), Api.get('/api/menu/items')]);
    if (!menuCategories.length) { holder.innerHTML = '<div class="empty-state">لا توجد أقسام بعد، أضف قسمًا للبدء</div>'; return; }
    holder.innerHTML = menuCategories.map((c) => {
      const items = menuItems.filter((i) => i.category_id === c.id);
      return `
        <div class="panel">
          <div class="panel__title" style="display:flex; justify-content:space-between; align-items:center;">
            <span>${esc(c.name_ar)} ${c.is_active ? '' : '(غير مفعّل)'}</span>
            <span style="display:flex; gap:8px;">
              <button class="btn btn-ghost" data-cat-edit="${c.id}">تعديل القسم</button>
              <button class="btn btn-danger" data-cat-del="${c.id}">حذف القسم</button>
            </span>
          </div>
          ${items.length ? `
            <table class="data-table"><thead><tr><th>الصنف</th><th>السعر</th><th>الحالة</th><th></th></tr></thead>
            <tbody>${items.map((it) => `
              <tr>
                <td>${esc(it.name_ar)}${it.is_spicy ? ' <span class="spicy-tag" style="border-color:var(--fire-orange);color:var(--fire-orange);">حار</span>' : ''}</td>
                <td><span class="num">${it.price.toLocaleString('en-US')}</span> ريال</td>
                <td><span class="badge ${it.is_available ? 'badge-active' : 'badge-cancelled'}">${it.is_available ? 'متاح' : 'متوقف'}</span></td>
                <td style="display:flex; gap:6px;">
                  <button class="btn btn-ghost" data-item-edit="${it.id}">تعديل</button>
                  <button class="btn btn-danger" data-item-del="${it.id}">حذف</button>
                </td>
              </tr>
            `).join('')}</tbody></table>
          ` : '<div class="empty-state">لا توجد أصناف في هذا القسم</div>'}
        </div>
      `;
    }).join('');
    bindMenuAdminEvents();
  } catch (e) { holder.innerHTML = '<div class="empty-state">تعذر تحميل بيانات المنيو</div>'; }
}

function bindMenuAdminEvents() {
  document.querySelectorAll('[data-cat-edit]').forEach((btn) => btn.addEventListener('click', () => openEditCategoryModal(menuCategories.find((c) => c.id == btn.dataset.catEdit))));
  document.querySelectorAll('[data-cat-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('سيتم حذف القسم وكل الأصناف بداخله. متابعة؟')) return;
    await Api.del(`/api/menu/categories/${btn.dataset.catDel}`); loadMenuAdmin();
  }));
  document.querySelectorAll('[data-item-edit]').forEach((btn) => btn.addEventListener('click', () => openItemModal(menuItems.find((i) => i.id == btn.dataset.itemEdit))));
  document.querySelectorAll('[data-item-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('حذف هذا الصنف نهائيًا؟')) return;
    await Api.del(`/api/menu/items/${btn.dataset.itemDel}`); loadMenuAdmin();
  }));
}

function openAddCategoryModal() {
  openModal(`
    <div class="modal__title">إضافة قسم جديد</div>
    <div class="field"><label>الاسم بالعربي</label><input id="catNameAr" type="text"></div>
    <div class="field"><label>الاسم بالإنجليزي (اختياري)</label><input id="catNameEn" type="text"></div>
    <div class="field"><label>ترتيب الظهور</label><input id="catOrder" type="number" value="0"></div>
    <div class="modal__actions"><button class="btn btn-primary" id="saveCatBtn">إضافة</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button></div>
  `);
  document.getElementById('saveCatBtn').addEventListener('click', async () => {
    try {
      await Api.post('/api/menu/categories', {
        name_ar: document.getElementById('catNameAr').value,
        name_en: document.getElementById('catNameEn').value || undefined,
        sort_order: parseInt(document.getElementById('catOrder').value, 10) || 0,
      });
      closeModal(); loadMenuAdmin();
    } catch (e) { alert(e.message); }
  });
}

function openEditCategoryModal(c) {
  openModal(`
    <div class="modal__title">تعديل قسم</div>
    <div class="field"><label>الاسم بالعربي</label><input id="catNameAr" type="text" value="${esc(c.name_ar)}"></div>
    <div class="field"><label>الاسم بالإنجليزي</label><input id="catNameEn" type="text" value="${esc(c.name_en)}"></div>
    <div class="field"><label>ترتيب الظهور</label><input id="catOrder" type="number" value="${c.sort_order}"></div>
    <div class="field"><label>الحالة</label>
      <select id="catActive"><option value="1" ${c.is_active ? 'selected' : ''}>مفعّل</option><option value="0" ${!c.is_active ? 'selected' : ''}>غير مفعّل</option></select>
    </div>
    <div class="modal__actions"><button class="btn btn-primary" id="saveCatBtn">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button></div>
  `);
  document.getElementById('saveCatBtn').addEventListener('click', async () => {
    await Api.patch(`/api/menu/categories/${c.id}`, {
      name_ar: document.getElementById('catNameAr').value,
      name_en: document.getElementById('catNameEn').value,
      sort_order: parseInt(document.getElementById('catOrder').value, 10),
      is_active: parseInt(document.getElementById('catActive').value, 10),
    });
    closeModal(); loadMenuAdmin();
  });
}

function openItemModal(item) {
  const isEdit = !!item;
  const catOptions = menuCategories.map((c) => `<option value="${c.id}" ${item && item.category_id === c.id ? 'selected' : ''}>${esc(c.name_ar)}</option>`).join('');
  let currentImageBase64 = item ? (item.image_path || '') : '';

  openModal(`
    <div class="modal__title">${isEdit ? 'تعديل صنف' : 'إضافة صنف جديد'}</div>
    <div class="field"><label>القسم</label><select id="itemCat">${catOptions}</select></div>
    <div class="field"><label>الاسم بالعربي</label><input id="itemNameAr" type="text" value="${item ? esc(item.name_ar) : ''}" required></div>
    <div class="field"><label>الاسم بالإنجليزي (اختياري)</label><input id="itemNameEn" type="text" value="${item ? esc(item.name_en) : ''}"></div>
    <div class="field"><label>الوصف (اختياري)</label><textarea id="itemDesc">${item ? esc(item.description_ar) : ''}</textarea></div>
    <div class="field">
      <label>صورة الصنف</label>
      <input id="itemFile" type="file" accept="image/*" style="display:block; width:100%; padding:8px; background:var(--dark-800); border:1px solid var(--dark-line); border-radius:6px; color:var(--paper-000);">
      <div id="imagePreviewContainer" style="margin-top:10px; display:${currentImageBase64 ? 'block' : 'none'}; text-align:center;">
        <img id="imagePreview" src="${esc(currentImageBase64)}" style="max-height:100px; max-width:100%; border-radius:8px; border:2px solid var(--fire-orange); object-fit:cover;">
      </div>
    </div>
    <div class="field"><label>السعر (ريال)</label><input id="itemPrice" type="number" step="0.01" value="${item ? item.price : ''}" required></div>
    <div class="field"><label>حار؟</label>
      <select id="itemSpicy"><option value="0" ${item && !item.is_spicy ? 'selected' : ''}>لا</option><option value="1" ${item && item.is_spicy ? 'selected' : ''}>نعم</option></select>
    </div>
    ${isEdit ? `<div class="field"><label>الحالة</label>
      <select id="itemAvailable"><option value="1" ${item.is_available ? 'selected' : ''}>متاح</option><option value="0" ${!item.is_available ? 'selected' : ''}>متوقف مؤقتًا</option></select>
    </div>` : ''}
    <div class="modal__actions"><button class="btn btn-primary" id="saveItemBtn">${isEdit ? 'حفظ' : 'إضافة'}</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button></div>
  `);

  document.getElementById('itemFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        currentImageBase64 = event.target.result;
        const img = document.getElementById('imagePreview');
        img.src = currentImageBase64;
        document.getElementById('imagePreviewContainer').style.display = 'block';
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById('saveItemBtn').addEventListener('click', async () => {
    const name_ar = document.getElementById('itemNameAr').value.trim();
    const priceVal = parseFloat(document.getElementById('itemPrice').value);
    if (!name_ar) { alert('الرجاء إدخال اسم الصنف بالعربي'); return; }
    if (isNaN(priceVal) || priceVal < 0) { alert('الرجاء إدخال سعر صحيح'); return; }

    const payload = {
      category_id: parseInt(document.getElementById('itemCat').value, 10),
      name_ar,
      name_en: document.getElementById('itemNameEn').value.trim() || undefined,
      description_ar: document.getElementById('itemDesc').value.trim() || undefined,
      price: priceVal,
      image_path: currentImageBase64 || undefined,
      is_spicy: parseInt(document.getElementById('itemSpicy').value, 10),
    };
    try {
      if (isEdit) {
        payload.is_available = parseInt(document.getElementById('itemAvailable').value, 10);
        await Api.patch(`/api/menu/items/${item.id}`, payload);
      } else {
        await Api.post('/api/menu/items', payload);
      }
      closeModal();
      loadMenuAdmin();
    } catch (e) {
      alert(e.message || 'حدث خطأ أثناء الحفظ');
    }
  });
}
