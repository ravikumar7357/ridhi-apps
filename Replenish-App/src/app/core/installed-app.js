/* ================= THE INSTALLED APP =================
 * The service worker only makes the app installable and gives it an offline page; it always fetches
 * the page from the network first (see /sw.js). "Install app" appears only when the browser says the
 * app can be installed, and goes once it is. */
(() => {
  try {
    if (typeof document.getElementById !== 'function' || typeof navigator === 'undefined') return;   // a test run, not a browser
    if ('serviceWorker' in navigator && location.protocol === 'https:')
      navigator.serviceWorker.register('/sw.js').catch(e => console.warn('[app] service worker not registered:', e));
    let ask = null;
    const b = document.getElementById('installBtn');
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); ask = e; if (b) b.classList.remove('hide'); });
    window.addEventListener('appinstalled', () => { ask = null; if (b) b.classList.add('hide'); });
    if (b) b.onclick = async () => { if (!ask) return; ask.prompt(); try { await ask.userChoice; } catch (e) { /* dismissed */ } ask = null; b.classList.add('hide'); };
  } catch (e) { console.warn('[app] install not offered:', e); }
})();

