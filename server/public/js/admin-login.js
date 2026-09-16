document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const errBox = document.getElementById('loginError');
  errBox.classList.remove('show');
  btn.disabled = true;
  btn.textContent = 'جاري الدخول...';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      errBox.textContent = data.error || 'تعذر تسجيل الدخول';
      errBox.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'تسجيل الدخول';
      return;
    }
    window.location.href = '/admin/dashboard.html';
  } catch (err) {
    errBox.textContent = 'تعذر الاتصال بالخادم';
    errBox.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'تسجيل الدخول';
  }
});