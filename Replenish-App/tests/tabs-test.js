/* WHAT EACH ACCOUNT IS SHOWN — the real code, cut out of the page and run.
 *
 * Neither suite covers the tab wiring: prod-test evaluates the production block and shop-test the
 * Shopify block, and this sits above both. It decides what a printer can see, which is exactly the
 * kind of thing that is never noticed until somebody outside the company is looking at the wrong
 * screen — or, as happened today, at a permission error with their name on it.
 */
const fs = require('fs');
const APP = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const html = fs.readFileSync(APP, 'utf8');
/* The page is written CRLF; the anchors below are plain newlines. */
const mod = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/\r\n/g, '\n');

/* Just the piece that decides, verbatim. */
const from = mod.indexOf('/**\n * The only section a vendor can actually use.');
const to = mod.indexOf('/**\n * Is this sign-in a vendor?');
if (from < 0 || to < 0 || to < from) throw new Error('the vendor-tab rule is not where it was');
const block = mod.slice(from, to);

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); } };

/* ---- the world it runs in ---- */
const els = {};
const mk = id => (els[id] = { id, style: {} });
const NAV_MAP = { repl: 'tabRepl', vend: 'tabVend', vlog: 'tabVlog', pbase: 'tabPbase', hr: 'tabHr',
  ord: 'tabOrd', vord: 'tabVord' };
Object.values(NAV_MAP).forEach(mk);
const $ = id => els[id] || null;
let ME = { email: 'p9982028893@vendors-tfr.app', admin: false, tabs: [] };
let TAB_NOW = '';
const SHOWN = [];
const showTab = w => { SHOWN.push(w); TAB_NOW = w; };
let SYNCED = 0;
const syncNavGroups = () => { SYNCED++; };

const fn = new Function('$', 'ME', 'NAV_MAP', 'TAB_NOW', 'showTab', 'syncNavGroups',
  block + '\n;return { vendorOnlyTabs, VENDOR_TABS };');
const A = fn($, ME, NAV_MAP, TAB_NOW, showTab, syncNavGroups);

console.log('\n== a printer is shown the one screen that works for them ==');
{
  /* Ravi ticked History for a printer so they could see what they had sent. History reads every
   * printer's orders at once — the one thing the rules refuse a vendor — so they were told their
   * account is not allowed to read production data. */
  ME.tabs = ['vend', 'vlog', 'pbase', 'repl'];
  Object.values(els).forEach(e => { e.style = {}; });
  A.vendorOnlyTabs();

  ok('the portal is kept', ME.tabs.indexOf('vend') >= 0, JSON.stringify(ME.tabs));
  ok('…and it is the only one, however it was ticked', ME.tabs.length === 1, JSON.stringify(ME.tabs));
  ok('the History button is taken off their sidebar', els.tabVlog.style.display === 'none');
  ok('…and Base Data, and the planning board',
     els.tabPbase.style.display === 'none' && els.tabRepl.style.display === 'none');
  ok('…while the portal button stays', els.tabVend.style.display !== 'none');
  ok('the sidebar groups are redrawn, so an empty heading does not linger', SYNCED > 0);
}

console.log('\n== and moved off one they are already reading ==');
{
  ME.tabs = ['vend', 'vlog'];
  TAB_NOW = 'vlog'; SHOWN.length = 0;
  /* TAB_NOW is read from the enclosing scope, so it has to be handed in again. */
  const A2 = new Function('$', 'ME', 'NAV_MAP', 'TAB_NOW', 'showTab', 'syncNavGroups',
    block + '\n;return { vendorOnlyTabs };')($, ME, NAV_MAP, 'vlog', showTab, syncNavGroups);
  A2.vendorOnlyTabs();
  ok('a printer already on the History screen is moved to their portal',
     SHOWN.length === 1 && SHOWN[0] === 'vend', JSON.stringify(SHOWN));
}

console.log('\n== nothing ticked at all ==');
{
  ME.tabs = [];
  SHOWN.length = 0;
  A.vendorOnlyTabs();
  ok('they still get the portal, which is what they came for',
     ME.tabs.length === 1 && ME.tabs[0] === 'vend', JSON.stringify(ME.tabs));
}

console.log('\n== a staff account is not touched ==');
{
  /* vendorOnlyTabs is only ever called once the database has confirmed a vendor, but if that ever
   * changes, the list it keeps must still be the vendor's — this documents what it does, not who
   * calls it. */
  ok('the list it keeps is the portal alone', A.VENDOR_TABS.join(',') === 'vend', A.VENDOR_TABS.join(','));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
