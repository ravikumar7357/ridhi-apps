/* ================= SHOPIFY HUB — LOCAL TEST PAGE (2026-10-23) =================
 *
 * Ravi, 23 Oct: "integrate this in my ERP locally … make an extra page just to check the things". The new Shopify
 * section runs from Ridhihome/shopify-hub (its own small backend on http://localhost:8790). This file puts it inside
 * the ERP as one more page under the Shopify menu — "Shopify hub (test)" — shown in a frame.
 *
 * ONLY ON THE LOCAL PAGE AND THE TEST ERP. Everything below runs only when the page is opened from localhost
 * (VS Code button 1) or from the test ERP (ravikumar7357.github.io, Ravi 23 Oct: "push this to test"). On the real
 * ERP it does nothing at all: no menu item, no page. Either way the frame shows the hub running on the computer
 * the page is opened on (localhost:8790) — on the test ERP, Chrome asks once to allow the local network.
 *
 * SELF-CONTAINED ON PURPOSE. The menu item and the page are made here, at load, instead of being added to
 * src/index.html and nav.js: prod-test counts the menu's links and nav.js keeps fixed maps of every page, and a
 * test page must not change either. showTab is wrapped so it knows this one extra page; every other page opens
 * exactly as before. Remove this file (and its line in ORDER) and nothing of it is left.
 */
const SHUB_ON = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\]|ravikumar7357\.github\.io)$/.test(location.hostname);
const SHUB_URL = 'http://localhost:8790/';
if (SHUB_ON && $('secShopify') && $('paneShop')) {
  const link = document.createElement('a');
  link.id = 'tabShub'; link.className = 'nav'; link.href = '#shub';
  link.innerHTML = 'Shopify hub (test) <span class="navbadge" style="background:#7c3aed">TEST</span>';
  $('secShopify').appendChild(link);

  const pane = document.createElement('div');
  pane.id = 'paneShub'; pane.className = 'hide';
  pane.innerHTML = `<div class="card" style="padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <span style="font-weight:700">Shopify hub</span>
      <span class="muted" style="font-size:12.5px">Local test · runs from Ridhihome/shopify-hub · temp orders, nothing is saved to the ERP</span>
      <span id="shubState" class="muted" style="font-size:12.5px;margin-left:auto"></span>
      <button type="button" class="ghost" id="shubReload" style="padding:7px 13px;font-size:12.5px">Reload</button>
      <a class="ghost" href="${SHUB_URL}" target="_blank" rel="noopener" style="padding:7px 13px;font-size:12.5px;border-radius:12px;text-decoration:none;color:var(--ink);background:var(--card);box-shadow:var(--sh-1);font-weight:600">Open in its own tab ↗</a>
    </div>
    <div id="shubDown" class="warn hide" style="margin-bottom:12px">The Shopify hub is not running on this computer. Double-click
      <b>Ridhihome\\shopify-hub\\start-hub.cmd</b> (or run <code>node shopify-hub/server.js</code> from the Ridhihome folder), then press Reload.
      On the test link, if Chrome asks to let this site reach devices on your local network, allow it — that is the hub.</div>
    <iframe id="shubFrame" title="Shopify hub" style="width:100%;height:calc(100vh - 150px);min-height:560px;border:0;border-radius:18px;background:var(--bg)"></iframe>`;
  $('paneShop').after(pane);

  /* Is the hub up? A cross-site read is not allowed, but whether the request goes through at all is enough. */
  const shubCheck = () => fetch(SHUB_URL + 'api/state', { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false);
  async function shubLoad(force) {
    const up = await shubCheck();
    $('shubDown').classList.toggle('hide', up);
    $('shubFrame').classList.toggle('hide', !up);
    $('shubState').textContent = up ? 'Hub running' : 'Hub not running';
    if (up && (force || !$('shubFrame').src)) $('shubFrame').src = SHUB_URL + '?embed=1#orders';
  }
  $('shubReload').onclick = () => shubLoad(true);

  /* The one extra page: showTab opens it itself, and hands every other page to the real showTab. */
  const showTabReal = showTab;
  showTab = function (which) {
    if (which !== 'shub') {
      pane.classList.add('hide'); link.classList.remove('on');
      return showTabReal(which);
    }
    document.querySelectorAll('[id^="pane"]').forEach(el => el.classList.toggle('hide', el !== pane));
    document.querySelectorAll('.side a.nav.on').forEach(el => el.classList.remove('on'));
    link.classList.add('on');
    if (TAB_NOW && TAB_NOW !== 'shub' && typeof tabShed === 'function') tabShed(TAB_NOW);
    TAB_NOW = 'shub';
    $('pageTitle').textContent = 'Shopify hub (test)';
    try { document.title = 'Shopify hub (test) · Ridhi Home & Living'; if (location.hash !== '#shub') history.pushState(null, '', '#shub'); } catch (e) { /* only the address */ }
    if (typeof navOpenFor === 'function') navOpenFor('shop');
    if (typeof topbarSync === 'function') topbarSync();
    shubLoad(false);
  };
  link.onclick = e => { e.preventDefault(); showTab('shub'); };
  /* Back / Forward to #shub, which nav.js does not know. */
  window.addEventListener('hashchange', () => { if (location.hash === '#shub' && TAB_NOW !== 'shub' && ME && ME.tabs) showTab('shub'); });
}
