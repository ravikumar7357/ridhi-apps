/* ================= CORE · VERSION CHECK: "A new version of Sellora is ready" =================
 * Screens: every screen — the update bar (updBar) is added to the page body, whichever screen is open.
 * Does: every three minutes, and whenever the tab comes back to the front, asks the server for the page's
 * fingerprint; once it changes, shows a bar with an "Update now" button that reloads. Only over https.
 * Main pieces: one self-running block holding tag (fetch the fingerprint), show (the bar) and check. */

/* ================= A NEW VERSION IS OUT =================
 * A tab left open for days still runs the version it opened with, which is how a fix can be live and
 * the screen still show the old one. Every few minutes, and whenever the tab comes back to the front,
 * this asks the server for the page's fingerprint (a HEAD request, a few hundred bytes); when it has
 * changed, a bar offers to reload. */
(() => {
  try {
    // Only in a real browser, over https — never on a local file or in a test runner.
    if (typeof document.getElementById !== 'function' || typeof fetch !== 'function'
      || location.protocol !== 'https:') return;
    let first = null;   // the fingerprint this tab opened with
    // The page's fingerprint: its ETag or Last-Modified header, from a HEAD request; '' when the request fails.
    const tag = () => fetch('/', { method: 'HEAD', cache: 'no-store' })
      .then(res => res.headers.get('etag') || res.headers.get('last-modified') || '')
      .catch(() => '');
    // Put the update bar on the page, once.
    const show = () => {
      if (document.getElementById('updBar')) return;
      const bar = document.createElement('div');
      bar.id = 'updBar';
      bar.innerHTML = '<span>A new version of Sellora is ready.</span><button type="button">Update now</button>';
      bar.querySelector('button').onclick = () => location.reload();
      document.body.appendChild(bar);
    };
    // Compare the fingerprint now with the first one seen; a change means a new version is live.
    const check = async () => {
      const latest = await tag();
      if (!latest) return;
      if (first === null) {
        first = latest;
        return;
      }
      if (latest !== first) show();
    };
    // Now, every three minutes, and whenever the tab comes back to the front.
    check();
    setInterval(check, 3 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  } catch (e) {
    console.warn('[app] update check off:', e);
  }
})();
