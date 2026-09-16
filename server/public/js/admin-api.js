/* تنقية موحّدة لأي نص قادم من قاعدة البيانات قبل إدراجه في HTML (يمنع XSS) */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const Api = {
  async request(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { window.location.href = '/admin/login.html'; throw new Error('غير مصرح'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'حدث خطأ');
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body || {}); },
  patch(url, body) { return this.request('PATCH', url, body || {}); },
  del(url) { return this.request('DELETE', url); },
};

function openModal(html) {
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalBackdrop').classList.add('open');
}
function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
  document.getElementById('modalBody').innerHTML = '';
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') closeModal();
  });
});

function statusLabel(s) {
  const map = {
    pending: 'قيد الانتظار', confirmed: 'مؤكد', preparing: 'قيد التحضير',
    served: 'تم التقديم', cancelled: 'ملغى',
    active: 'نشطة', expired: 'منتهية', closed: 'مغلقة',
    available: 'متاحة', occupied: 'مشغولة', disabled: 'معطّلة',
  };
  return map[s] || s;
}
