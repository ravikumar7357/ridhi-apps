/* The installed app's service worker (2026-09-22).
 *
 * It exists so a phone will offer "Install app", and so the app opens to a page rather than a
 * browser error when the phone has no signal. It is deliberately NOT a cache of the app:
 *
 *   - The page itself is always fetched from the network FIRST. A deployed fix must reach every phone
 *     on its next open — the same rule firebase.json sets with no-cache. The copy kept here is used
 *     only when the network fails outright.
 *   - Nothing that is not this site's own page or icons is touched: every database, sign-in and
 *     backend call goes straight to the network, never through a cache.
 */
const CACHE = 'ridhi-shell-v1';
const SHELL = ['/', '/icon-192.png', '/icon-512.png', '/logo.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // databases, sign-in, backends: untouched
  const isPage = req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';
  if (!isPage && SHELL.indexOf(url.pathname) < 0) return;         // everything else: the network as usual
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && isPage) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(isPage ? '/' : req).then(hit => hit || new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>'
      + '<body style="font-family:system-ui;padding:32px;text-align:center;color:#334155"><h2>No internet</h2>'
      + '<p>The app needs a connection to read the registers. It will open as soon as you are back online.</p></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } })))
  );
});
