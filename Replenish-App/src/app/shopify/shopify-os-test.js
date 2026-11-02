/* ================= SHOPIFY OS — OPS PAGE IN THE ERP, TEST ONLY (2026-11-02) =================
 *
 * Ravi, 02 Nov: "do everything we can right now … push them into test and don't change anything in main". One more page
 * under the Shopify menu — "Shopify OS (test)" — showing the Shopify OS ops page (public/shopify-os/ops.html, from
 * Ridhihome/shopify-os/hub/ops.html): problems board, morning numbers, route suggestions, production batches, feed status.
 *
 * ONLY ON THE LOCAL PAGE AND THE TEST ERP, exactly like "Shopify hub (test)": on the real ERP this file does nothing.
 *
 * SIGN-IN: the ERP's own. The page asks this file for the signed-in person's Firebase ID token; Supabase trusts this
 * Firebase project (third-party auth), and every database function checks the person (verified email, on the Shopify OS
 * people list) before it reads or changes anything. No second password, no key with powers in the browser.
 *
 * WHERE THE DATABASE IS: Firestore config/shopifyos { url, key } when an admin has put it there, else the box on this
 * page (saved in this browser). key = Supabase's PUBLISHABLE key (made to be public). A secret key is refused.
 *
 * STOCK (step F): stock() reads FBA (what Amazon will ship today, per account) and India sellable stock with the Shopify
 * Orders tab's own reads (loadShopStock / loadShopIndia / the Amazon SKU mapping) and hands the figures to the page,
 * which saves them in Shopify OS. Read only on the ERP side: nothing in the ERP, Shopify or Amazon is changed.
 *
 * SELF-CONTAINED ON PURPOSE (same reasons as shopify-hub-local.js): the menu item and pane are made here, showTab is
 * wrapped for this one page. Remove this file (and its line in ORDER) and nothing of it is left.
 */
const SHOS_ON = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\]|ravikumar7357\.github\.io)$/.test(location.hostname);
if (SHOS_ON && $('secShopify') && $('paneShop')) {
  const link = document.createElement('a');
  link.id = 'tabShos'; link.className = 'nav'; link.href = '#shos';
  link.innerHTML = 'Shopify OS (test) <span class="navbadge" style="background:#0f7a5f">TEST</span>';
  $('secShopify').appendChild(link);

  const pane = document.createElement('div');
  pane.id = 'paneShos'; pane.className = 'hide';
  pane.innerHTML = `<div class="card" style="padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <span style="font-weight:700">Shopify OS</span>
      <span class="muted" style="font-size:12.5px">Test · alerts, morning numbers, routes, batches · signed in with your ERP account · nothing is sent to Shopify or Amazon</span>
      <span id="shosState" class="muted" style="font-size:12.5px;margin-left:auto"></span>
      <button type="button" class="ghost" id="shosSetup" style="padding:7px 13px;font-size:12.5px">Connection</button>
      <button type="button" class="ghost" id="shosReload" style="padding:7px 13px;font-size:12.5px">Reload</button>
    </div>
    <div id="shosForm" class="card hide" style="padding:14px 16px;display:grid;gap:8px;max-width:640px">
      <b>Connect this browser to the Shopify OS database</b>
      <span class="muted" style="font-size:12.5px">Supabase → Project Settings → API Keys. Use the <b>publishable</b> key (starts with sb_publishable_). Never the secret key.</span>
      <input id="shosUrl" placeholder="https://xxxx.supabase.co" autocomplete="off" spellcheck="false">
      <input id="shosKey" placeholder="sb_publishable_…" autocomplete="off" spellcheck="false">
      <div style="display:flex;gap:8px;align-items:center"><button type="button" id="shosSave">Save in this browser</button><span id="shosFormMsg" class="muted" style="font-size:12.5px"></span></div>
    </div>
    <iframe id="shosFrame" title="Shopify OS" style="width:100%;height:calc(100vh - 150px);min-height:560px;border:0;border-radius:18px;background:var(--bg)"></iframe>`;
  $('paneShop').after(pane);

  /* ---------------- where the database is ---------------- */
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
    try {
      const l = JSON.parse(localStorage.getItem('shos_cfg') || 'null');
      if (l && shosUrlOk(l.url) && shosKeyOk(l.key)) return (SHOS_CFG = { url: l.url, key: l.key, from: 'this browser' });
    } catch (e) { /* nothing saved */ }
    $('shosForm').classList.remove('hide');
    throw new Error('Shopify OS is not connected in this browser yet: fill in the box above (Connection).');
  }
  $('shosSetup').onclick = () => $('shosForm').classList.toggle('hide');
  $('shosSave').onclick = () => {
    const url = $('shosUrl').value.trim().replace(/\/+$/, ''), key = $('shosKey').value.trim();
    if (!shosUrlOk(url)) { $('shosFormMsg').textContent = 'The address should look like https://xxxx.supabase.co'; return; }
    if (/^sb_secret_/.test(key)) { $('shosFormMsg').textContent = 'That is the SECRET key. Never put it in a browser: use the publishable one.'; return; }
    if (!shosKeyOk(key)) { $('shosFormMsg').textContent = 'That does not look like the publishable key (sb_publishable_…).'; return; }
    try { localStorage.setItem('shos_cfg', JSON.stringify({ url, key })); } catch (e) { $('shosFormMsg').textContent = 'This browser would not save it.'; return; }
    SHOS_CFG = null; $('shosKey').value = ''; $('shosForm').classList.add('hide'); shosLoad(true);
  };

  /* ---------------- what the ops page may ask this page for ---------------- */
  const shosDate = v => { const d = v instanceof Date ? v : v ? new Date(v) : null; return d && !isNaN(d) ? d : null; };
  window.SHOS = {
    config: shosConfig,
    /* The signed-in person's Firebase ID token (refreshed by Firebase when it is old). */
    async token() {
      const u = auth.currentUser;
      if (!u) throw new Error('Sign in to the ERP first.');
      return u.getIdToken();
    },
    /* list = [{ store: 'RBP' | 'CPC', sku }] → { rows: [{ store, sku, fba, india }], as_of, why }. Reads only. */
    async stock(list) {
      await Promise.all([
        typeof loadShopStock === 'function' ? loadShopStock().catch(() => {}) : null,
        typeof loadShopIndia === 'function' ? loadShopIndia().catch(() => {}) : null,
        typeof loadShopSku === 'function' && !Object.keys(SHOP_SKU || {}).length ? loadShopSku().catch(() => {}) : null,
      ]);
      const up = s => String(s == null ? '' : s).trim().toUpperCase();
      const rows = []; let fbaHit = 0, indHit = 0;
      (Array.isArray(list) ? list : []).forEach(x => {
        const brand = x.store === 'CPC' ? 'CPC' : 'SP', sku = up(x.sku);
        if (!sku || !/^(RBP|CPC)$/.test(x.store)) return;
        let amz = ''; try { amz = up(soAmzSku(sku)); } catch (e) { /* no mapping */ }
        const by = (SHOP_STOCK_BY && SHOP_STOCK_BY[brand]) || {};
        const f = by[sku] != null ? by[sku] : amz && by[amz] != null ? by[amz] : null;
        const read = !!(SHOP_STOCK_AT && SHOP_STOCK_AT[brand]);
        const ind = typeof soIndiaOf === 'function' ? soIndiaOf(sku) : null;
        const fba = f != null ? Number(f) || 0 : read ? 0 : null;        // account read, SKU not in it = 0
        const india = ind ? Number(ind[0]) || 0 : null;                  // sellable sets, not loose pieces
        if (fba == null && india == null) return;
        if (f != null) fbaHit++;
        if (ind && Number(ind[0])) indHit++;
        rows.push({ store: x.store, sku: String(x.sku).trim(), fba, india });
      });
      /* The OLDEST of the readings used, so a newer reading already in Shopify OS is never replaced by this one. */
      const times = [SHOP_STOCK_AT && SHOP_STOCK_AT.SP, SHOP_STOCK_AT && SHOP_STOCK_AT.CPC, SHOP_INDIA_AT].map(shosDate).filter(Boolean);
      const asOf = times.length ? new Date(Math.min(...times.map(d => d.getTime()))) : new Date();
      const fmt = d => d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'not read';
      const why = `FBA Ridhi ${fmt(shosDate(SHOP_STOCK_AT && SHOP_STOCK_AT.SP))} · CPC ${fmt(shosDate(SHOP_STOCK_AT && SHOP_STOCK_AT.CPC))} · India ${fmt(shosDate(SHOP_INDIA_AT))}`
        + ` · ${fbaHit} SKUs found in FBA, ${indHit} with India stock, of ${(list || []).length} still to ship`
        + (SHOP_INDIA_ERR ? ` · India not read: ${SHOP_INDIA_ERR}` : '');
      return { rows, as_of: asOf.toISOString(), why };
    },
  };

  function shosLoad(force) {
    const fr = $('shosFrame');
    shosConfig().then(c => { $('shosState').textContent = 'Database: ' + c.from; }, e => { $('shosState').textContent = e.message; });
    if (force || !fr.src) fr.src = new URL('shopify-os/ops.html', location.href).href + '?v=' + Date.now();
  }
  $('shosReload').onclick = () => shosLoad(true);

  /* The one extra page: showTab opens it itself, and hands every other page to the showTab it found. */
  const showTabBefore = showTab;
  showTab = function (which) {
    if (which !== 'shos') {
      pane.classList.add('hide'); link.classList.remove('on');
      return showTabBefore(which);
    }
    document.querySelectorAll('[id^="pane"]').forEach(el => el.classList.toggle('hide', el !== pane));
    document.querySelectorAll('.side a.nav.on').forEach(el => el.classList.remove('on'));
    link.classList.add('on');
    if (TAB_NOW && TAB_NOW !== 'shos' && typeof tabShed === 'function') tabShed(TAB_NOW);
    TAB_NOW = 'shos';
    $('pageTitle').textContent = 'Shopify OS (test)';
    try { document.title = 'Shopify OS (test) · Ridhi Home & Living'; if (location.hash !== '#shos') history.pushState(null, '', '#shos'); } catch (e) { /* only the address */ }
    if (typeof navOpenFor === 'function') navOpenFor('shop');
    if (typeof topbarSync === 'function') topbarSync();
    shosLoad(false);
  };
  link.onclick = e => { e.preventDefault(); showTab('shos'); };
  window.addEventListener('hashchange', () => { if (location.hash === '#shos' && TAB_NOW !== 'shos' && ME && ME.tabs) showTab('shos'); });
}
