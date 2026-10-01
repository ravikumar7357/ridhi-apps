/* ================= A NEW VERSION IS OUT =================
 * An installed app on a phone stays open for days, still running the version it opened with — which is
 * how a fix could be live and the phone still show the old screen. Every few minutes, and whenever the
 * app comes back to the front, it asks the server for the page's fingerprint (a HEAD request, a few
 * hundred bytes); when it has changed, a bar offers to reload. */
(() => {
  try {
    if (typeof document.getElementById !== 'function' || typeof fetch !== 'function' || location.protocol !== 'https:') return;
    /* ONE CHECKER, NOT TWO (2026-10-01). The APP VERSION script at the top of the page asks the same question every
     * 5 minutes and on return to the tab, and shows #appvBar; with both running a tab polled twice and could show
     * two bars. This one now stands down whenever that one is there, and stays as the fallback if it ever is not. */
    if (window.__APPV) return;
    let first = null;
    const tag = () => fetch('/', { method: 'HEAD', cache: 'no-store' }).then(r => r.headers.get('etag') || r.headers.get('last-modified') || '').catch(() => '');
    const show = () => {
      if (document.getElementById('updBar')) return;
      const b = document.createElement('div');
      b.id = 'updBar';
      b.innerHTML = '<span>A new version of the app is ready.</span><button type="button">Update now</button>';
      b.querySelector('button').onclick = () => location.reload();
      document.body.appendChild(b);
    };
    const check = async () => { const t = await tag(); if (!t) return; if (first === null) { first = t; return; } if (t !== first) show(); };
    check();
    setInterval(check, 3 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  } catch (e) { console.warn('[app] update check off:', e); }
})();
