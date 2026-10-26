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
 *
 * NOTHING TO START (Ravi, 26 Oct: "why i have to start shopify hub … just upload this to test site"). The hub now
 * also comes as plain files beside this page (public/shopify-hub/, made by Ridhihome/shopify-hub/tools/build-web.js):
 * its server code runs inside the frame and keeps its data in that browser. That copy is used whenever it is there;
 * the hub on this computer (localhost:8790) only when it is not.
 */
const SHUB_ON = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\]|ravikumar7357\.github\.io)$/.test(location.hostname);
const SHUB_WEB = SHUB_ON ? new URL('shopify-hub/index.html', location.href).href : '';
const SHUB_LOCAL = 'http://localhost:8790/';
let SHUB_URL = SHUB_WEB;
if (SHUB_ON && $('secShopify') && $('paneShop')) {
  const link = document.createElement('a');
  link.id = 'tabShub'; link.className = 'nav'; link.href = '#shub';
  link.innerHTML = 'Shopify hub (test) <span class="navbadge" style="background:#7c3aed">TEST</span>';
  $('secShopify').appendChild(link);

  const pane = document.createElement('div');
  pane.id = 'paneShub'; pane.className = 'hide';
  pane.innerHTML = `<div class="card" style="padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <span style="font-weight:700">Shopify hub</span>
      <span class="muted" style="font-size:12.5px">Test · Shopify read through the Pricing API · kept in this browser · nothing is saved to the ERP or sent to Shopify</span>
      <span id="shubState" class="muted" style="font-size:12.5px;margin-left:auto"></span>
      <button type="button" class="ghost" id="shubReload" style="padding:7px 13px;font-size:12.5px">Reload</button>
    </div>
    <div id="shubDown" class="warn hide" style="margin-bottom:12px">The Shopify hub could not be opened: this copy of the ERP has no
      shopify-hub folder, and no hub is running on this computer. Run <b>Ridhihome\\shopify-hub\\start-hub.cmd</b>, then press Reload.</div>
    <iframe id="shubFrame" title="Shopify hub" style="width:100%;height:calc(100vh - 150px);min-height:560px;border:0;border-radius:18px;background:var(--bg)"></iframe>`;
  $('paneShop').after(pane);

  /* Which hub: the copy beside this page if it is there, else the one on this computer. For the local one a cross-site
   * read is not allowed, but whether the request goes through at all is enough. */
  async function shubCheck() {
    try { if ((await fetch(SHUB_WEB, { method: 'HEAD', cache: 'no-store' })).ok) { SHUB_URL = SHUB_WEB; return true; } } catch (e) { /* not published here */ }
    const up = await fetch(SHUB_LOCAL + 'api/state', { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false);
    if (up) SHUB_URL = SHUB_LOCAL;
    return up;
  }
  async function shubLoad(force) {
    const up = await shubCheck();
    $('shubDown').classList.toggle('hide', up);
    $('shubFrame').classList.toggle('hide', !up);
    $('shubState').textContent = !up ? 'Hub not found' : SHUB_URL === SHUB_WEB ? 'Hub ready' : 'Hub on this computer';
    if (up && (force || !$('shubFrame').src)) $('shubFrame').src = SHUB_URL + '?embed=1#orders';
  }
  $('shubReload').onclick = () => shubLoad(true);

  /* Shopify through the Pricing API (Ravi, 26 Oct: "pricing api has shopify access also … make this read that access").
   * The hub on this computer has no ERP keys; this page reads ?shopify=orders for both stores — the same read the
   * Shopify tab makes, with the signed-in user's access — and hands the orders to the hub frame. Read only: nothing is
   * written to Shopify from here. When the frame loads it is told the ERP can do this, and the orders are sent once;
   * after that the hub's "Fetch orders" asks for them again. Messages go only to, and are taken only from, the hub. */
  const shubOrigin = () => new URL(SHUB_URL).origin;
  let shubSent = false, shubBusy = false;
  async function shubSendOrders() {
    const fr = $('shubFrame');
    if (shubBusy || !fr.contentWindow) return;
    shubBusy = true; $('shubState').textContent = 'Reading Shopify through the Pricing API…';
    const day = ms => new Date(ms).toISOString().slice(0, 10);
    const win = { start: day(Date.now() - 14 * 86400000), end: day(Date.now()), open: '1', nophoto: '1' };
    const one = shop => prGet(Object.assign({ shopify: 'orders' }, shop ? { shop } : {}, win), { timeoutMs: 150000 })
      .then(d => ({ orders: d.orders || [], more: !!d.more }), e => ({ error: e.message || String(e) }));
    try {
      const [Ridhi, CPC] = await Promise.all([one(''), one('CPC')]);
      fr.contentWindow.postMessage({ type: 'shub-orders', got: { Ridhi, CPC } }, shubOrigin());
      const n = x => x.error ? 'not read' : x.orders.length + ' open';
      $('shubState').textContent = `Shopify via Pricing API · Ridhi ${n(Ridhi)} · CPC ${n(CPC)} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } finally { shubBusy = false; }
  }
  /* Tracking by Shopify (Ravi, 26 Oct): the hub asks this page to talk to Shopify for it, through the Pricing API
   * (Pricing-API/ShopifyHub.gs) — Shopify's own tracking of each parcel, a dry run of "mark these lines shipped", and
   * the real thing. The real thing is a write to the live stores, so it goes only when the test ERP lets it through
   * (build-test-erp.js HUB_SHOPIFY_WRITES, off until the Shopify tokens have the fulfilment permissions); the hub is
   * told which in the hello below and keeps its changes "held" until then. */
  const shubWrites = () => !!(window.__TEST_ERP && window.__TEST_ERP.hubShopifyWrites);
  const shubCsv = v => (Array.isArray(v) ? v : []).map(String).join(',');
  async function shubAnswer(kind, a) {
    const shop = a.store === 'CPC' ? 'CPC' : '';
    if (kind === 'order') return prGet({ shopify: 'orders', shop, ids: String(a.id || ''), open: '0', nophoto: '1' }, { timeoutMs: 120000 });
    if (kind === 'track') return prGet({ shopify: 'tracking', shop, ids: shubCsv(a.ids) }, { timeoutMs: 120000 });
    if (kind === 'fulfilCheck') return prGet({ shopify: 'fulfilCheck', shop, orderId: a.orderId, lines: shubCsv(a.lines), company: a.company, numbers: shubCsv(a.numbers) }, { timeoutMs: 120000 });
    if (kind === 'fulfil') {
      if (!shubWrites()) throw new Error('Sending to Shopify is switched off on the test ERP.');
      return apiPost({ shopify: 'fulfilLines', shop, orderId: a.orderId, lines: a.lines, company: a.company, numbers: a.numbers, notify: a.notify !== false });
    }
    throw new Error('The ERP does not know the request "' + kind + '".');
  }
  $('shubFrame').addEventListener('load', () => {
    const fr = $('shubFrame');
    if (!fr.src || !fr.contentWindow) return;
    fr.contentWindow.postMessage({ type: 'shub-erp', writes: shubWrites() }, shubOrigin());
    if (!shubSent) { shubSent = true; shubSendOrders(); }
  });
  window.addEventListener('message', e => {
    if (e.origin !== shubOrigin() || e.source !== $('shubFrame').contentWindow || !e.data) return;
    if (e.data.type === 'shub-want-orders') shubSendOrders();
    if (e.data.type === 'shub-ask' && typeof e.data.kind === 'string') {
      const { id, kind } = e.data, reply = m => { try { e.source.postMessage(Object.assign({ type: 'shub-answer', id }, m), shubOrigin()); } catch (x) { /* frame gone */ } };
      shubAnswer(kind, e.data.args || {}).then(data => reply({ ok: true, data }), err => reply({ ok: false, error: err.message || String(err) }));
    }
  });

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
