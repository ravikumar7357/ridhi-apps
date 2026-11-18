/* SMOOTH TO USE — the Listing screens' drawing and reacting, timed at full size on mock data (17 Nov 2026).
 *   node tests/smooth-bench.js            → a table: screen · action · ms (the median of a few runs)
 *   node tests/smooth-bench.js --json     → the same as JSON (smooth-test.js compares against it)
 * ~4,400 listings (Ridhi 2,680, CPC 1,720), the biggest parent "Tablecloth Main" with 490 children. What is timed is the JavaScript a
 * click, a scroll, a keystroke or a tick runs — building the HTML, judging, grouping, sorting — in a stub page (no browser here: the
 * browser's own layout and paint come on top and cannot be measured in this harness). */
const { load } = require('./listing-rules-test.js');
const { performance } = require('perf_hooks');

const BIG = 490;
const COLORS = ['Red', 'Blue', 'Green', 'Grey', 'Navy', 'Mustard', 'Rust', 'Teal', 'Sage', 'Pink', 'Ivory', 'Black'];
const SIZES = ['60x90', '60x120', '60x84', '70x70', '60x102'];
const TITLE = (c, s, i) => `Ridhi Rectangle Tablecloth ${s.replace('x', ' x ')} Inch Cotton Dining Table Cover Block Print ${i} - ${c}`;

/** The stub page with the full mock catalogue. `files`: another version of some source files (smooth-test.js: before → after). */
function bigPage(opts) {
  opts = opts || {};
  const C = load(Object.assign({ ws: true, sp: true, fa: true, lh: true }, opts.load || {}, opts.files ? { files: opts.files } : {}));
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.SP.today = new Date(2026, 10, 12);
  C.FA.log = [];
  ['SP', 'CPC'].forEach(b => { C.LI_WS.schema[b].TABLECLOTH = { at: Date.now(), ok: ['material', 'color', 'size', 'pattern'], hl: { none: true } }; });
  const now = Date.now();
  const H = 3600000;
  ['SP', 'CPC'].forEach(brand => {
    const cat = {};
    const n = brand === 'SP' ? 2680 : 1720;
    const rows = [];
    for (let i = 0; i < n; i++) {
      // the biggest parent first (Ridhi only), then parents of 1–40 children
      const parent = brand === 'SP' && i < BIG ? 'TM' : `${brand}P${Math.floor((i - (brand === 'SP' ? BIG : 0)) / (1 + (i % 40)))}`;
      const sku = `${brand}-${String(i).padStart(5, '0')}`;
      const c = COLORS[i % COLORS.length], s = SIZES[i % SIZES.length];
      // a mix of problems so every screen has work: long titles, few pictures, out of stock, an inactive one, over-limit search words
      const title = i % 7 === 0 ? TITLE(c, s, i) + ' for Kitchen Party Wedding Holiday Outdoor Picnic' : TITLE(c, s, i);
      const imgs = i % 11 === 0 ? 4 : 8;
      const qty = i % 13 === 0 ? 0 : 5 + (i % 9);
      rows.push({ brand, parent, sku, asin: 'B0' + brand + String(i).padStart(6, '0'), title, qty, price: 20 + (i % 30), status: i % 17 === 0 ? 'Inactive' : 'Active', channel: 'AFN',
        aplus: i % 5 !== 0, aplusAt: now, checked: now - (i % 3) * H, content: { titleLen: title.length, images: imgs, bullets: i % 19 === 0 ? 3 : 5, descLen: 300, title } });
      cat[sku] = { color: c, size: s, subcat: 'Rectangle Tablecloth' };
      const kw = i % 9 === 0 ? Array.from({ length: 45 }, (_, k) => 'word' + k).join(' ') : 'cotton tablecloth dining';
      C.LI_WS.live[brand][sku] = { at: now - (i % 5) * H, cAt: now - (i % 5) * H, pt: 'TABLECLOTH', title, titleLen: title.length, catTitle: title, tAt: now, kw: kw.slice(0, 300), kwBytes: Buffer.byteLength(kw.replace(/[\s;,.]+/g, '')), bul: 5, desc: 300,
        specs: { material: true, color: true, size: true, pattern: i % 4 !== 0 } };
    }
    C.HEALTH[brand].rows = rows;
    C.setCat(brand, cat);
    C._cat = Object.assign(C._cat || {}, { [brand]: cat });
  });
  C.LI_WS.liveV++;
  C.reset();
  return C;
}
/** Listing Health's own page (Parent ASINs, Child listings): listing-health.js, the rules, the cache door, listing-health-data.js,
 *  parent-check.js and the Workspace files, over the same mock catalogue. `files`: other versions of some files (before → after). */
function healthPage(opts) {
  opts = opts || {};
  const fs = require('fs'), path = require('path');
  const L = f => (opts.files && f in opts.files ? opts.files[f] : fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', f), 'utf8'));
  const els = {};
  const mk = id => ({ id, value: id === 'hBrandView' ? 'ALL' : id === 'hIssueView' ? 'ALL' : '', innerHTML: '', textContent: '', dataset: {}, style: {}, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [],
    contains: () => false, firstChild: null, insertAdjacentHTML() {}, getBoundingClientRect: () => ({ top: 0, height: 0 }), offsetHeight: 0, scrollTop: 0 });
  const el = id => els[id] || (els[id] = mk(id));
  const ctx = {
    $: el, document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, createElement: () => mk('x'), activeElement: null, getElementById: () => null, visibilityState: 'visible' },
    window: { addEventListener() {}, scrollTo() {}, open() {}, scrollY: 0, innerHeight: 900 }, MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} },
    localStorage: { getItem: () => null, setItem() {} }, CSS: { escape: s => s }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, requestAnimationFrame: () => 0,
    BRAND_NAME: { SP: 'Ridhi', CPC: 'CPC' }, IML: { SP: { at: new Date(), items: [] }, CPC: { at: new Date(), items: [] } },
    IM_SLOTS: ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'], getDoc: async () => ({ exists: () => false }), setDoc: async () => {}, doc: (db, c, id) => ({ path: c + '/' + id }),
    db: {}, serverTimestamp: () => 0, baCall: async () => ({}), imPost: async () => ({}), showTab() {}, imLoad() {}, imListLoad: async () => {}, ME: { email: 'test@example.com' },
    parentName: (brand, asin, fallback) => fallback || ('Parent ' + asin), parentNameCell: (b, p, t) => String(t || p), wireParentNameCells() {}, navigator: { clipboard: null },
    lcBytes: s => Buffer.byteLength(String(s || ''), 'utf8'),
    AUDIT_MANUAL: {}, PARENT_NAMES: {},
  };
  const src = ['listing-health.js', 'listing-rules.js', 'listing-match.js', 'listing-health-data.js', 'parent-check.js', 'listing-rules-tab.js', 'listing-workspace.js', 'listing-saved.js', 'listing-kid.js', 'listing-bf.js', 'listing-sync.js'].map(L).join('\n')
    + '\n;LR = JSON.parse(JSON.stringify(LR_DEFAULT));'
    + '\n;return { HEALTH, LI_WS, LR_CAT, renderHealth, hCtx, healthOf, reset: () => { H_CTX = null; }, setLoaded: v => { H_LOADED = v; }, setView: v => { H_VIEW = v; }, setSort: s => { H_SORT = s; },'
    + ' setFocus: f => { H_FOCUS = f; }, getRender: () => H_RENDER, lmStoreUse, setSaved: v => { LR_SAVED_AT = v; },'
    + ' liWsRender, liWsPanelOpen, liWsPanelRender, liWsParents, hFocusBar, LR_STALE_DAYS, LR_DAY,'
    + ' hHealthKept: typeof hHealthKept === "function" ? hHealthKept : null, hHealthUntil: typeof hHealthUntil === "function" ? hHealthUntil : null };';
  const C = new Function(...Object.keys(ctx), src)(...Object.values(ctx));
  C.el = el;
  C.lmStoreUse({ get: async () => null, put: async () => true });
  C.setLoaded(true);
  C.LI_WS.stored = true;
  // the same catalogue as bigPage
  const B = bigPage({ files: opts.files });
  ['SP', 'CPC'].forEach(b => {
    C.HEALTH[b] = { at: new Date(), rows: B.HEALTH[b].rows.map(r => Object.assign({}, r)) };
    C.LR_CAT[b] = Object.assign({}, B._cat[b]);
    C.LI_WS.live[b] = B.LI_WS.live[b];
  });
  C.LI_WS.liveV++;
  C.reset();
  return C;
}
// Time fn: the median of `runs` runs, in ms (rounded to 0.1).
function time(fn, runs) {
  const t = [];
  for (let i = 0; i < (runs || 3); i++) { const t0 = performance.now(); fn(i); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  return Math.round(t[Math.floor(t.length / 2)] * 10) / 10;
}

/** Every timed action: [{ screen, action, ms }]. */
function bench(opts) {
  const out = [];
  const add = (screen, action, ms) => out.push({ screen, action, ms });
  const C = bigPage(opts);
  // --- Workspace (Listing Health) ---
  C.LI_WS.on = true;
  C.LI_WS.mode = 'live';
  add('Workspace', 'first draw (4,400 listings judged, 100 parents shown)', time(() => { C.reset(); C.LI_WS.liveV++; C.liWsRender(); }, 3));
  add('Workspace', 'redraw (nothing changed)', time(() => C.liWsRender(), 5));
  add('Workspace', 'open the biggest parent (490 children) — the side panel', time(() => { C.LI_WS.panel = null; C.liWsPanelOpen('SP|TM'); }, 3));
  add('Workspace', 'panel redraw (a read landed)', time(() => { C.LI_WS.panelSig = null; C.liWsPanelRender(); }, 3));
  add('Workspace', 'the Fix all block of the biggest parent', time(() => C.faBlockHtml('SP', 'TM'), 3));
  const kid = C.LI_WS.byKey.get('SP|TM').kids[0];
  add('Workspace', 'a child of the biggest parent (the sidebar)', time(() => C.lkHtml(kid, { where: 'ws' }), 5));
  // --- Season planner (Listing Optimiser) ---
  C.SP.on = true;
  add('Season planner', 'the parent list', time(() => C.spRender(), 3));
  add('Season planner', 'open the biggest parent (490 children)', time(() => { C.SP.panel = null; C.spOpenParent('SP|TM'); }, 3));
  add('Season planner', 'panel redraw', time(() => C.spPanelsRender(), 3));
  return { C, out };
}

if (require.main === module) {
  const { out } = bench();
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
  else {
    const w = Math.max(...out.map(r => (r.screen + ' · ' + r.action).length));
    out.forEach(r => console.log((r.screen + ' · ' + r.action).padEnd(w) + '  ' + String(r.ms).padStart(8) + ' ms'));
  }
}
module.exports = { bigPage, healthPage, bench, time };
