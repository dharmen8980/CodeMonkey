// Served as a separate file so the login page needs no inline script and can run
// under a strict CSP.
(function () {
  var form = document.getElementById('f');
  var err = document.getElementById('err');
  var btn = document.getElementById('btn');

  function fail(msg) {
    err.textContent = msg;          // textContent, never innerHTML
    err.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Signing in…';

    fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: document.getElementById('username').value,
        token: document.getElementById('token').value,
      }),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (b) {
          return { status: r.status, body: b };
        });
      })
      .then(function (r) {
        if (r.status === 200) {
          window.location.replace('/turns');
          return;
        }
        if (r.status === 429) return fail('Too many attempts. Try again later.');
        if (r.status === 503) return fail('Server not configured: CHAT_TOKEN missing.');
        var left = r.body && typeof r.body.attempts_left === 'number'
          ? ' (' + r.body.attempts_left + ' attempts left)'
          : '';
        fail('Invalid credentials' + left);
      })
      .catch(function () { fail('Network error. Try again.'); });
  });
})();
