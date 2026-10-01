/* ================= A NEW VERSION IS OUT =================
 * A tab left open for days still runs the version it opened with, which is how a fix can be live and
 * the screen still show the old one. Every few minutes, and whenever the tab comes back to the front,
 * this asks the server for the page's fingerprint (a HEAD request, a few hundred bytes); when it has
 * changed, a bar offers to reload. */
(() => {
  try {
    if (typeof document.getElementById !== 'function' || typeof fetch !== 'function' || location.protocol !== 'https:') return;
    let first = null;
    const tag = () => fetch('/', { method: 'HEAD', cache: 'no-store' }).then(r => r.headers.get('etag') || r.headers.get('last-modified') || '').catch(() => '');
    const show = () => {
      if (document.getElementById('updBar')) return;
      const b = document.createElement('div');
      b.id = 'updBar';
      b.innerHTML = '<span>A new version of Sellora is ready.</span><button type="button">Update now</button>';
      b.querySelector('button').onclick = () => location.reload();
      document.body.appendChild(b);
    };
    const check = async () => { const t = await tag(); if (!t) return; if (first === null) { first = t; return; } if (t !== first) show(); };
    check();
    setInterval(check, 3 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  } catch (e) { console.warn('[app] update check off:', e); }
})();
