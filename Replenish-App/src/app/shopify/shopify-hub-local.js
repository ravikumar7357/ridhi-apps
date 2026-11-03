/* ================= SHOPIFY HUB — ONE PAGE FOR THE SALES AND SHIPPING TEAMS, TEST (2026-11-02) =================
 *
 * Ravi, 2 Nov: "build a one page like the Shopify hub … the production bucket is for production, and the sales team and
 * shipping team will see the Shopify hub page … with everything working". One menu item, "Shopify hub", opens the whole
 * hub (public/shopify-hub/, made by Ridhihome/shopify-hub/tools/build-web.js) in a frame, in the ERP's look. Production
 * has its own page, "Production bucket" (bucket-team.js).
 *
 * ONLY ON THE LOCAL PAGE AND THE TEST ERP. On the real ERP this file does nothing at all: no menu item, no page.
 *
 * THE SHARED DATA (Supabase): window.SHOS gives the hub the Shopify OS database's address, its publishable key and the
 * signed-in person's Firebase sign-in (the ERP's own: no second password). The database checks the person on every call
 * (shopify-os/supabase/26 and 28). Where the database is: Firestore config/shopifyos { url, key } (an admin puts it there
 * once; key = the PUBLISHABLE key). No box on the page. Until it is there, each browser keeps its own data. A secret key is refused.
 *
 * SHOPIFY through the Pricing API, read only, exactly as before: the hub asks, this page reads ?shopify=orders for both
 * stores with the signed-in person's access and hands the orders over, with the ERP's own stock figures. Writes to Shopify
 * and real MCF stay behind the test ERP's switches (build-test-erp.js), which are off.
 *
 * SELF-CONTAINED ON PURPOSE: the menu items and the page are made here, showTab is wrapped for these pages only. Remove
 * this file (and its line in ORDER) and nothing of it is left.
 */
const SHUB_ON = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\]|ravikumar7357\.github\.io)$/.test(location.hostname);
const SHUB_WEB = SHUB_ON ? new URL('shopify-hub/index.html', location.href).href : '';
const SHUB_LOCAL = 'http://localhost:8790/';
let SHUB_URL = SHUB_WEB;
/* ONE PAGE (Ravi, 2 Nov, last word): "a one page like the Shopify hub is built … sales team and shipping team will see the
 * Shopify hub page" — the whole hub on one page; production has its own Production bucket page (bucket-team.js). */
const SHUB_PAGES = [['hub', 'Shopify hub']];
let SHUB_PAGE = 'hub';
if (SHUB_ON && $('secShopify') && $('paneShop')) {
  const links = {};
  SHUB_PAGES.forEach(([k, name]) => {
    const a = document.createElement('a');
    a.id = 'tabShub'; a.className = 'nav'; a.href = '#shub';
    a.innerHTML = `${name} <span class="navbadge" style="background:#7c3aed">TEST</span>`;
    $('secShopify').appendChild(a);
    links[k] = a;
  });

  const pane = document.createElement('div');
  pane.id = 'paneShub'; pane.className = 'hide';
  pane.innerHTML = `<div class="card" style="padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <span style="font-weight:700" id="shubName">Shopify</span>
      <span class="muted" style="font-size:12.5px">Test · shared by the team in the Shopify OS database · Shopify read through the Pricing API · nothing is sent to Shopify or Amazon</span>
      <span id="shubState" class="muted" style="font-size:12.5px;margin-left:auto"></span>
      <button type="button" class="ghost" id="shubReload" style="padding:7px 13px;font-size:12.5px">Reload</button>
    </div>
    <div id="shubDown" class="warn hide" style="margin-bottom:12px">The Shopify pages could not be opened: this copy of the ERP has no
      shopify-hub folder, and no hub is running on this computer. Run <b>Ridhihome\\shopify-hub\\start-hub.cmd</b>, then press Reload.</div>
    <iframe id="shubFrame" title="Shopify" style="width:100%;height:calc(100vh - 150px);min-height:560px;border:0;border-radius:18px;background:var(--bg)"></iframe>`;
  $('paneShop').after(pane);

  /* ---------------- the Shopify OS database (Supabase) ---------------- */
  let SHOS_CFG = null;
  const shosUrlOk = u => /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(String(u || '').trim());
  /* Only a key that can do no more than the browser may: sb_publishable_…, or an old-style JWT whose role is anon. */
  function shosKeyOk(k) {
    k = String(k || '').trim();
    if (/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(k)) return true;
    if (/^sb_secret_/.test(k)) return false;
    const p = k.split('.');
    if (p.length !== 3) return false;
    try { return JSON.parse(atob(p[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; } catch (e) { return false; }
  }
  async function shosConfig() {
    if (SHOS_CFG) return SHOS_CFG;
    try {
      const s = await getDoc(doc(db, 'config', 'shopifyos'));
      const d = s.exists() ? s.data() : null;
      if (d && shosUrlOk(d.url) && shosKeyOk(d.key)) return (SHOS_CFG = { url: d.url.trim(), key: d.key.trim(), from: 'ERP settings' });
    } catch (e) { /* not readable for this account: the browser's own setting below */ }
    /* No box on the page (Ravi, 2 Nov: "remove this"): until config/shopifyos exists, each browser keeps its own data. */
    throw new Error('kept in this browser only');
  }
  /* What the hub frame (same site) takes from this page: the database, and who is signed in. */
  window.SHOS = {
    config: shosConfig,
    async token() { const u = auth.currentUser; if (!u) throw new Error('Sign in to the ERP first.'); return u.getIdToken(); },
    async email() { return (auth.currentUser && auth.currentUser.email) || ''; },
  };

  /* Which hub: the copy beside this page if it is there, else the one on this computer. For the local one a cross-site
   * read is not allowed, but whether the request goes through at all is enough. */
  async function shubCheck() {
    try { if ((await fetch(SHUB_WEB, { method: 'HEAD', cache: 'no-store' })).ok) { SHUB_URL = SHUB_WEB; return true; } } catch (e) { /* not published here */ }
    const up = await fetch(SHUB_LOCAL + 'api/state', { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false);
    if (up) SHUB_URL = SHUB_LOCAL;
    return up;
  }
  let shubShown = '', shubDb = '';
  async function shubLoad(force) {
    const up = await shubCheck();
    $('shubDown').classList.toggle('hide', up);
    $('shubFrame').classList.toggle('hide', !up);
    $('shubName').textContent = 'Shopify hub';
    let db = 'kept in this browser only';
    try { const c = await shosConfig(); db = 'shared database (' + c.from + ')'; } catch (e) { db = e.message; }
    shubDb = db;
    $('shubState').textContent = !up ? 'Hub not found' : (SHUB_URL === SHUB_WEB ? 'Ready' : 'Hub on this computer') + ' · ' + db;
    /* Loaded once and kept: coming back to the page does not load the hub (or Shopify) again — Reload does. */
    if (up && (force || shubShown !== SHUB_PAGE)) { shubShown = SHUB_PAGE; $('shubFrame').src = SHUB_URL + '?embed=1#orders'; }
  }
  $('shubReload').onclick = () => shubLoad(true);

  /* Shopify through the Pricing API (Ravi, 26 Oct: "pricing api has shopify access also … make this read that access").
   * The hub has no ERP keys; this page reads ?shopify=orders for both stores — the same read the Shopify tab makes, with
   * the signed-in user's access — and hands the orders to the hub frame. Read only. When the frame loads it is told the
   * ERP can do this, and the orders are sent once; after that the hub's "Fetch orders" asks for them again. Messages go
   * only to, and are taken only from, the hub. */
  const shubOrigin = () => new URL(SHUB_URL).origin;
  let shubBusy = false;
  /* `want` = { Ridhi: [order ids], CPC: [...] }: the orders the hub is still working on. They are read again by id (any
   * status), so a cancellation, refund, edit or a shipment made outside the hub reaches the hub even after the order has
   * left the 14-day window or is marked shipped — the window alone only brings orders still to ship. Read only. */
  async function shubSendOrders(want) {
    const fr = $('shubFrame');
    if (shubBusy || !fr.contentWindow) return;
    shubBusy = true; $('shubState').textContent = 'Reading Shopify through the Pricing API…';
    const day = ms => new Date(ms).toISOString().slice(0, 10);
    const win = { start: day(Date.now() - 14 * 86400000), end: day(Date.now()), open: '1', nophoto: '1' };
    const ids = list => (Array.isArray(list) ? list : []).map(String).filter(x => /^\d+$/.test(x)).slice(0, 500);
    const one = async (shop, store) => {
      try {
        const d = await prGet(Object.assign({ shopify: 'orders' }, shop ? { shop } : {}, win), { timeoutMs: 150000 });
        const orders = d.orders || [], have = new Set(orders.map(o => String(o.id)));
        const more = ids((want || {})[store]).filter(x => !have.has(x));
        for (let i = 0; i < more.length; i += 100) {
          const r = await prGet(Object.assign({ shopify: 'orders', ids: more.slice(i, i + 100).join(','), open: '0', nophoto: '1' }, shop ? { shop } : {}), { timeoutMs: 150000 });
          orders.push(...(r.orders || []));
        }
        return { orders, more: !!d.more, rechecked: more.length };
      } catch (e) { return { error: e.message || String(e) }; }
    };
    try {
      const [Ridhi, CPC] = await Promise.all([one('', 'Ridhi'), one('CPC', 'CPC')]);
      let info = null;
      try { $('shubState').textContent = 'Reading stock from the ERP…'; info = await shubInfo({ Ridhi, CPC }); } catch (e) { info = { error: e.message || String(e) }; }
      fr.contentWindow.postMessage({ type: 'shub-orders', got: { Ridhi, CPC, info } }, shubOrigin());
      const n = x => x.error ? 'not read' : x.orders.length + ' open';
      /* Where the hub keeps its work stays on the line (Ravi, 3 Nov: it was hidden once the orders came in). */
      $('shubState').textContent = `Shopify via Pricing API · Ridhi ${n(Ridhi)} · CPC ${n(CPC)} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${shubDb ? ' · ' + shubDb : ''}`;
    } finally { shubBusy = false; }
  }
  /* THE ERP'S OWN FIGURES FOR EACH ITEM (Ravi, 26 Oct: "I don't know MCF has how many and India inventory has how
   * many"), sent with the orders. READ ONLY — the same reads the Shopify Orders tab makes, done only if that tab has not
   * already done them, and nothing is written anywhere: FBA in the order's own account (loadShopStock / soFbaIn), India
   * Finished Goods in sellable units (loadShopIndia / soIndiaOf), the Amazon code when it differs (soAmzSku), the shelf
   * bin (loadShopSku / soLocOf), the same design in other sizes with stock (soSizeAlternatives), and an open production
   * line for the order (the order book, PTG.ob, by Shopify order id and SKU — as the Orders tab's Production column). */
  async function shubInfo(got) {
    await Promise.all([
      typeof loadShopStock === 'function' && !SHOP_STOCK_LOADED ? loadShopStock().catch(() => {}) : null,
      typeof loadShopIndia === 'function' ? loadShopIndia().catch(() => {}) : null,
      typeof loadShopSku === 'function' && !Object.keys(SHOP_SKU || {}).length ? loadShopSku().catch(() => {}) : null,
      /* The Shopify Orders page's records (MCF sent, status box, notes): read if that page has not read them yet. There is
       * no "loaded" flag for them in the ERP — the name used here before did not exist, so this whole read failed and no
       * stock or MCF record ever reached the hub (Ravi, 3 Nov: "0 orders with an ERP record"). */
      typeof loadShopMeta === 'function' && !Object.keys((typeof SHOP_META === 'object' && SHOP_META) || {}).length ? loadShopMeta().catch(() => {}) : null,
      typeof ptLoadGates === 'function' ? ptLoadGates(false, true).catch(() => {}) : null,
    ]);
    const up = s => String(s == null ? '' : s).trim().toUpperCase();
    const at = d => (d && d.toISOString ? d.toISOString() : '');
    const out = { at: Date.now(), skus: {}, lines: {}, orders: {},
      stockAt: { Ridhi: at(SHOP_STOCK_AT.SP), CPC: at(SHOP_STOCK_AT.CPC) }, indiaAt: SHOP_INDIA_AT || '', indiaErr: SHOP_INDIA_ERR || '' };
    /* WHAT THE SHOPIFY ORDERS PAGE ALREADY KNOWS ABOUT EACH ORDER (Ravi, 2 Nov: a "MCF DONE" order the hub still offered
     * to send): its status box, our note, the carrier, and Amazon's MCF id with when, how fast and its state — read from
     * the same records that page shows (SHOP_META), never written. The hub shows them in the order and warns on a clash. */
    const str = v => String(v == null ? '' : v).slice(0, 300);
    ['Ridhi', 'CPC'].forEach(store => ((got[store] || {}).orders || []).forEach(o => {
      const m = (typeof SHOP_META === 'object' && SHOP_META && SHOP_META[o.id]) || null; if (!m) return;
      const r = { s: str(m.s), note: str(m.note), carrier: str(m.carrier), mcfId: str(m.mcfId), mcfAt: str(m.mcfAt), mcfSpeed: str(m.mcfSpeed), mcfStatus: str(m.mcfStatus),
        mcfSkus: Array.isArray(m.mcfSkus) ? m.mcfSkus.map(str) : null };
      if (Object.keys(r).some(k => r[k] && (!Array.isArray(r[k]) || r[k].length))) out.orders[String(o.id)] = r;
    }));
    [['Ridhi', 'SP'], ['CPC', 'CPC']].forEach(([store, brand]) => ((got[store] || {}).orders || []).forEach(o => (o.items || []).forEach(i => {
      const sku = up(i.sku); if (!sku) return;
      let amz = ''; try { amz = soAmzSku(sku) || ''; } catch (e) { /* no mapping */ }
      const amzKey = up(amz), key = store + '|' + sku;
      if (!out.skus[key]) {
        const fba = amzKey ? soFbaIn(brand, amzKey) : null, ind = soIndiaOf(sku);
        let alts = []; try { alts = soSizeAlternatives(sku, brand).map(a => ({ sku: a.sku, size: a.size, shape: a.shape, fba: a.fba, india: a.india })); } catch (e) { /* no master yet */ }
        out.skus[key] = { amz: amzKey && amzKey !== sku ? amz : '', fba: fba == null ? null : Number(fba) || 0,
          india: ind ? Number(ind[0]) || 0 : null, pieces: ind ? Number(ind[1]) || 0 : null, pack: ind ? Number(ind[2]) || 0 : null,
          shelf: soLocOf(sku) || '', alts };
      }
      const ks = [sku, amzKey].filter(Boolean);
      const open = (PTG.ob || []).find(r => r && String(r.shopOrderId || '') === String(o.id) && ks.includes(up(r.sku)));
      /* Sent to Amazon MCF from this ERP already (the Orders tab's "MCF done"): the hub must never send it again. */
      const meta = (typeof SHOP_META === 'object' && SHOP_META && SHOP_META[o.id]) || {};
      let mcf = ''; try { mcf = meta.mcfId && soMcfHas(o.id, i.sku) ? String(meta.mcfId) : ''; } catch (e) { mcf = meta.mcfId && !Array.isArray(meta.mcfSkus) ? String(meta.mcfId) : ''; }
      if (open || mcf) out.lines[o.id + '|' + i.lid] = Object.assign(open ? { prod: String(open.orderNo || open.id || '') } : {}, mcf ? { mcf } : {});
    })));
    /* EVERY ORDER THE ERP KNOWS, not only the last 14 days (Ravi, 3 Nov: 306 "late" orders were older than the hub's
     * window, so their ERP records never reached the database). Short form: the status box, our note (cut to 120), the
     * MCF id and when — and the SHP- production orders open for it in the order book. Read only. */
    const short = v => String(v == null ? '' : v).slice(0, 120);
    if (typeof SHOP_META === 'object' && SHOP_META) Object.keys(SHOP_META).forEach(id => {
      if (!/^\d+$/.test(id) || out.orders[id]) return;
      const m = SHOP_META[id] || {};
      const r = { s: short(m.s), note: short(m.note), mcfId: short(m.mcfId), mcfAt: short(m.mcfAt) };
      if (r.s || r.note || r.mcfId) out.orders[id] = r;
    });
    /* prod = SHP- orders still being made · prodDone = handed over (or marked done for Shopify): made, waiting to ship. */
    (PTG.ob || []).forEach(r => {
      const id = String((r && r.shopOrderId) || ''); if (!/^\d+$/.test(id)) return;
      const rec = out.orders[id] || (out.orders[id] = {}), k = r.handedAt || r.shopDoneAt ? 'prodDone' : 'prod';
      const no = String(r.orderNo || r.id || ''); rec[k] = rec[k] || [];
      if (no && !rec[k].includes(no) && rec[k].length < 10) rec[k].push(no);
    });
    return out;
  }
  /* Tracking by Shopify (Ravi, 26 Oct): the hub asks this page to talk to Shopify for it, through the Pricing API
   * (Pricing-API/ShopifyHub.gs) — Shopify's own tracking of each parcel, a dry run of "mark these lines shipped", and
   * the real thing. The real thing is a write to the live stores, so it goes only when the test ERP lets it through
   * (build-test-erp.js HUB_SHOPIFY_WRITES, off until the Shopify tokens have the fulfilment permissions); the hub is
   * told which in the hello below and keeps its changes "held" until then. */
  const shubWrites = () => !!(window.__TEST_ERP && window.__TEST_ERP.hubShopifyWrites);
  const shubCsv = v => (Array.isArray(v) ? v : []).map(String).join(',');
  /* THE PRODUCTION BUCKET, asked for by the hub's "Production bucket" button (Ravi, 2 Nov: "get the bucket ready in our
   * Shopify hub"). The ERP's own bucket (bucket-excel.js shpBucketOpen), not a copy: it is worked out from the Shopify
   * Orders tab's orders, notes and stock, so those are read first if this page has not read them yet (ensureShop — the
   * same read as opening Shopify Orders), and India stock is waited for, since the bucket judges stock. Then the bucket
   * opens over the hub; what it does (open production lines, take goods from production) it does exactly as from the
   * Shopify Orders page. Whatever it would have said on that page comes back to the hub as a message. */
  async function shubBucket() {
    if (typeof shpBucketOpen !== 'function' || typeof ensureShop !== 'function') throw new Error('This ERP has no production bucket.');
    const said = () => (($('soMsg') && $('soMsg').textContent) || '').trim();
    if (!Object.keys(SHOP_META || {}).length || !SHOP_STOCK_LOADED) {
      $('shubState').textContent = 'Reading the Shopify orders and stock for the bucket…';
      await ensureShop();
    }
    if (typeof loadShopIndia === 'function') { try { await loadShopIndia(); } catch (e) { /* the bucket says so */ } }
    const before = said();
    await shpBucketOpen();
    $('shubState').textContent = 'Production bucket opened';
    const now = said();
    return now && now !== before ? { msg: now, bad: /could not|not been read|refused|denied/i.test(now) } : {};
  }
  async function shubAnswer(kind, a) {
    if (kind === 'prodBucket') return shubBucket();
    const shop = a.store === 'CPC' ? 'CPC' : '';
    if (kind === 'order') return prGet({ shopify: 'orders', shop, ids: String(a.id || ''), open: '0', nophoto: '1' }, { timeoutMs: 120000 });
    /* One order WITH its product photos (the list is read without them, for speed): asked when that order is opened. */
    if (kind === 'orderPhotos') {
      const d = await prGet({ shopify: 'orders', shop, ids: String(a.id || '').replace(/\D/g, ''), open: '0' }, { timeoutMs: 60000 });
      const o = (d.orders || [])[0] || {};
      return { imgs: (o.items || []).map(i => ({ lid: String(i.lid || ''), img: String(i.img || '') })) };
    }
    if (kind === 'track') return prGet({ shopify: 'tracking', shop, ids: shubCsv(a.ids) }, { timeoutMs: 120000 });
    if (kind === 'fulfilCheck') return prGet({ shopify: 'fulfilCheck', shop, orderId: a.orderId, lines: shubCsv(a.lines), company: a.company, numbers: shubCsv(a.numbers) }, { timeoutMs: 120000 });
    /* Amazon MCF through the Pricing API (Mcf.gs). Fees and status only read Amazon; the test ERP lets those two
     * through. A real parcel (mcfCreate) only when the test ERP allows MCF writes — it does not. */
    if (kind === 'mcfPreview') return apiPost({ mcf: 'preview', order: a.order });
    if (kind === 'mcfStatus') return apiPost({ mcf: 'status', mcfId: String(a.mcfId || ''), brand: a.brand === 'CPC' ? 'CPC' : 'SP' });
    if (kind === 'mcfCreate') {
      if (!(window.__TEST_ERP && window.__TEST_ERP.hubMcfWrites)) throw new Error('Real MCF parcels are not sent from the test ERP — send MCF from the ERP\'s Shopify tab.');
      return apiPost({ mcf: 'create', order: a.order });
    }
    if (kind === 'fulfil') {
      if (!shubWrites()) throw new Error('Sending to Shopify is switched off on the test ERP.');
      return apiPost({ shopify: 'fulfilLines', shop, orderId: a.orderId, lines: a.lines, company: a.company, numbers: a.numbers, notify: a.notify !== false });
    }
    throw new Error('The ERP does not know the request "' + kind + '".');
  }
  $('shubFrame').addEventListener('load', () => {
    const fr = $('shubFrame');
    if (!fr.src || !fr.contentWindow) return;
    /* The hub answers this hello by asking for the orders, with the ids it is still working on. */
    fr.contentWindow.postMessage({ type: 'shub-erp', writes: shubWrites() }, shubOrigin());
  });
  window.addEventListener('message', e => {
    if (e.origin !== shubOrigin() || e.source !== $('shubFrame').contentWindow || !e.data) return;
    if (e.data.type === 'shub-want-orders') shubSendOrders(e.data.ids && typeof e.data.ids === 'object' ? e.data.ids : null);
    if (e.data.type === 'shub-ask' && typeof e.data.kind === 'string') {
      const { id, kind } = e.data, reply = m => { try { e.source.postMessage(Object.assign({ type: 'shub-answer', id }, m), shubOrigin()); } catch (x) { /* frame gone */ } };
      shubAnswer(kind, e.data.args || {}).then(data => reply({ ok: true, data }), err => reply({ ok: false, error: err.message || String(err) }));
    }
  });

  /* The one page: showTab opens it itself, and hands every other page to the real showTab. Key: shub. */
  const isShub = w => w === 'shub';
  const showTabReal = showTab;
  showTab = function (which) {
    if (!isShub(which)) {
      pane.classList.add('hide'); Object.values(links).forEach(l => l.classList.remove('on'));
      return showTabReal(which);
    }
    document.querySelectorAll('[id^="pane"]').forEach(el => el.classList.toggle('hide', el !== pane));
    document.querySelectorAll('.side a.nav.on, #secShopify a.nav.on').forEach(el => el.classList.remove('on'));
    links.hub.classList.add('on');
    if (TAB_NOW && !isShub(TAB_NOW) && typeof tabShed === 'function') tabShed(TAB_NOW);
    TAB_NOW = which;
    $('pageTitle').textContent = 'Shopify hub (test)';
    try { document.title = 'Shopify hub (test) · Ridhi Home & Living'; if (location.hash !== '#shub') history.pushState(null, '', '#shub'); } catch (e) { /* only the address */ }
    if (typeof navOpenFor === 'function') navOpenFor('shop');
    if (typeof topbarSync === 'function') topbarSync();
    shubLoad(false);
  };
  links.hub.onclick = e => { e.preventDefault(); showTab('shub'); };
  /* Back / Forward to #shub, which nav.js does not know. */
  window.addEventListener('hashchange', () => { if (location.hash === '#shub' && TAB_NOW !== 'shub' && ME && ME.tabs) showTab('shub'); });
}
