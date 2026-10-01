/* The ported Shopify Orders + Adjustments block, cut out of the DEPLOYED page and run.
 *
 * Same discipline as prod-test.js: nothing here restates the app's logic, the block is taken
 * verbatim out of index.html and evaluated in a stub DOM. What is being asked is not "does Shopify
 * work" — that was true in Sellora and the code is unchanged — but "did the MOVE break anything",
 * which is a much narrower and more answerable question:
 *
 *   - the backend. Sellora's `API` is config/api; this app's `API` is config/replapi, a different
 *     Apps Script. Every call had to be repointed at PRAPI. Getting this wrong is silent: the wrong
 *     script answers, or answers with nothing, and the screen shows a plausible figure.
 *   - the MCF POST, which places real parcels and costs real money.
 *   - soGuessBrand, which used the listing-health snapshot and now uses this app's own.
 *   - the dropped production view: nothing may still try to publish to the other project.
 *   - the multi-select widget, which is this app's copy now rather than a second one.
 */
const fs = require('fs');
const APP = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';

const html = fs.readFileSync(APP, 'utf8');
const mod = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const start = mod.indexOf('/* ================= SHOPIFY ORDERS & ADJUSTMENTS');
if (start < 0) throw new Error('the Shopify block is not in the page');
const block = mod.slice(start);

/* ---- stub DOM, built from the page's OWN ids so it cannot drift from the markup ---- */
const els = {};
const mkEl = id => {
  const e = {
    id, value: '', innerHTML: '', textContent: '', className: '', checked: false, disabled: false,
    style: {}, dataset: {}, _listeners: {}, _hidden: false, children: [],
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    querySelector: () => null, querySelectorAll: () => [],
    focus() {}, click() {}, remove() {}, appendChild() {},
    getAttribute: () => null, setAttribute() {},
    classList: {
      add(c) { if (c === 'hide') e._hidden = true; },
      remove(c) { if (c === 'hide') e._hidden = false; },
      toggle(c, on) { if (c === 'hide') e._hidden = (on === undefined ? !e._hidden : !!on); },
      contains(c) { return c === 'hide' ? e._hidden : false; },
    },
  };
  return e;
};
/* every id in the page, so a missing stub means a missing element and not a missing test fixture */
[...html.matchAll(/\sid="([\w-]+)"/g)].forEach(m => { els[m[1]] = mkEl(m[1]); });
/* plus the handful the code builds at render time */
['soAll', 'ajAll', 'soGoAdj', 'soMcfRefresh'].forEach(i => { els[i] = mkEl(i); });
const $ = id => els[id] || (els[id] = mkEl(id));

const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const nf = v => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US'));
const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

/* ---- the two backends, kept apart on purpose ---- */
const CALLS = { prGet: [], apiPost: [], apiGet: [] };
let PRAPI = { url: 'https://script.google.com/PRICE-RESEARCH/exec', key: 'pr-key' };
let API = { url: 'https://script.google.com/REPLENISH/exec', key: 'repl-key' };
let PRGET_REPLY = { ok: true };
const prGet = async params => { CALLS.prGet.push(params); return PRGET_REPLY; };
const apiGet = async params => { CALLS.apiGet.push(params); return { ok: true }; };

let FETCHES = [];
let FETCH_REPLY = () => ({ ok: true });
const fetch = async (url, opts) => {
  FETCHES.push({ url: String(url), method: (opts && opts.method) || 'GET',
    body: opts && opts.body ? JSON.parse(opts.body) : null });
  const d = FETCH_REPLY();
  return { ok: true, status: 200, text: async () => JSON.stringify(d), json: async () => d };
};

/* ---- Firestore ---- */
const DOCS = {};
const SETS = [];
const doc = (_db, ...p) => ({ path: p.join('/') });
const getDoc = async ref => ({ exists: () => Object.prototype.hasOwnProperty.call(DOCS, ref.path),
  data: () => DOCS[ref.path] });
const setDoc = async (ref, data) => { SETS.push({ path: ref.path, data }); DOCS[ref.path] = data; };
const serverTimestamp = () => 'ts';

let REPL = { SP: null, CPC: null };
const ME = { email: 'ravi@thefabricrush.com', admin: true };
let INDIA_LOADED = true, INDIA_ROWS = [];
let CONFIRM = true;
const confirm = () => CONFIRM;
const alert = () => {};
const parseCsv = () => [];
const colIdx = (h, names) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
const MS = {};
const MSCALLS = [];
const msInit = (id, label, opts) => { MS[id] = { sel: new Set(), opts: opts || [], label }; MSCALLS.push(['init', id]); };
const msFill = (id, vals, label) => { if (MS[id]) { MS[id].opts = vals || []; MS[id].label = label; } MSCALLS.push(['fill', id]); };
const msVals = id => (MS[id] ? [...MS[id].sel] : []);
const msHas = (id, v) => { const m = MS[id]; return !m || !m.sel.size || m.sel.has(String(v || '')); };
const msSet = (id, arr) => { if (MS[id]) MS[id].sel = new Set((arr || []).filter(Boolean)); };
const msClearAll = () => Object.keys(MS).forEach(k => { MS[k].sel = new Set(); });
const msPaint = () => {}; const msToggle = () => {}; const msChanged = () => {};

let DOWNLOADS = [];
class Blob { constructor(p) { this.parts = p; } }
const URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
let OPENED = [];
const open = (u) => { OPENED.push(u); return { document: { write() {}, close() {} }, focus() {}, print() {} }; };
const document = {
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ set href(v) {}, get href() { return ''; }, download: '', click() { DOWNLOADS.push(this.download); }, style: {} }),
  addEventListener() {},
};
const window = { open };
const dbx = {};


/* ---- the production tracker's database, faked just enough to be written to ---- */
let RT = {};                       // path -> value, as the RTDB would hold it
const PATCHES = [];
let WORK = {};                     // "order|sku" -> { cut, pressed } already done on the floor
const PTG = { masters: {}, mdb: [], ob: [], press: [], freeze: {}, err: '', busy: false };
const PT = { base: [], cut: [], at: {} };
const SOX = { rows: [] };
const ptLoadGates = async () => {};
const ptNum = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const obUC = v => String(v == null ? '' : v).trim().toUpperCase();
const ptPatch = async patch => {
  PATCHES.push(patch);
  Object.keys(patch).forEach(k => { if (patch[k] === null) delete RT[k]; else RT[k] = patch[k]; });
};
const ptPut = async (path, value) => { RT[path] = value; };
const ptDelete = async path => { delete RT[path]; };
const obCutQty = (o, sku) => (WORK[obUC(o) + '|' + obUC(sku)] || {}).cut || 0;
const obPressQty = (o, sku) => (WORK[obUC(o) + '|' + obUC(sku)] || {}).pressed || 0;
const ptList = o => Object.keys(o || {}).map(k => Object.assign({ _key: k }, o[k]));


/* ---- what the Shopify Production screen borrows from the production block ---- */
const ORD = { busy: false, rows: [], at: '2026-09-06 12:45' };
const ORD_THRESHOLD = q => 100;
const ordCutReq = () => true;
const ptImgCell = sku => '<td data-img="' + String(sku).toUpperCase() + '">none</td>';
const ptImgFill = () => {};
const ptEmpty = (id, msg) => { els[id] && (els[id].innerHTML = '<tbody><tr><td>' + msg + '</td></tr></tbody>'); };
const ptFill = () => {};
const ptDownload = (name, lines) => { DOWNLOADS.push(name); LAST_CSV = lines; };
let LAST_CSV = [];
const ptGet = async node => (node === 'pt_customSkus' ? CUSTOMDB : (String(node).indexOf('pt_orderBook/') === 0 ? (RT[node] || null) : {}));
const ptCi = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
const ordFilters = () => ({ ord: els.odOrd.value || '', art: els.odArt.value || '', sub: els.odSub.value || '',
  col: els.odCol.value || '', sz: els.odSz.value || '', st: els.odStatus.value || '',
  q: (els.odQ.value || '').trim().toLowerCase() });
let CUSTOMDB = {};
/* ordLines is the ONE place cut/issued/pressed are worked out — the real one, so both screens
 * cannot drift apart. Rebuilt here from the same inputs the app gives it. */
function ordLines() {
  const byKey = {};
  (PTG.ob || []).forEach(r => {
    const no = obUC(r.orderNo), sku = obUC(r.sku);
    if (!no || !sku) return;
    const k = no + '|' + sku;
    const e = byKey[k] || (byKey[k] = { orderNo: no, sku, qty: 0, orderDate: r.orderDate || '',
      articleType: r.articleType || '', articleSubtype: r.articleSubtype || '',
      color: r.color || '', size: r.size || '', src: r.src || '',
      shopOrderNo: r.shopOrderNo || '', shopOrderId: r.shopOrderId || '', adjId: r.adjId || '',
      needsSku: r.needsSku === true, shopDoneAt: r.shopDoneAt || '', shopDoneWhy: r.shopDoneWhy || '' });
    e.qty += parseInt(r.qty, 10) || 0;
  });
  return Object.values(byKey).map(l => {
    const cut = obCutQty(l.orderNo, l.sku), pressed = obPressQty(l.orderNo, l.sku);
    let issued = 0, received = 0;
    (PT.base || []).forEach(r => {
      if (!r || obUC(r.orderNo) !== l.orderNo || obUC(r.sku) !== l.sku) return;
      issued += ptNum(r.issuePieces); received += ptNum(r.receivedPieces);
    });
    return Object.assign({}, l, { cut, pressed, issued, received, cutReq: true,
      cutPct: l.qty > 0 ? (cut / l.qty) * 100 : 0, cutDone: cut >= l.qty,
      pendingCut: Math.max(0, l.qty - cut), pendingMake: Math.max(0, l.qty - pressed),
      open: l.shopDoneAt ? false : pressed < l.qty });
  }).sort((a, b) => a.orderNo.localeCompare(b.orderNo) || a.sku.localeCompare(b.sku));
}
const dToday = () => new Date().toISOString().slice(0, 10);   // the page's own helper, outside this slice
const ctx = { AUDIT_OFF: true,
  $, esc, nf, csvCell, parseCsv, colIdx, doc, getDoc, setDoc, serverTimestamp, db: dbx, dToday,
  PRAPI, API, prGet, apiGet, REPL, ME, INDIA_LOADED, INDIA_ROWS, confirm, alert,
  MS, msInit, msFill, msVals, msHas, msSet, msClearAll, msPaint, msToggle, msChanged,
  fetch, Blob, URL, document, window, open, console, setTimeout, clearTimeout,
  PTG, PT, SOX, ptLoadGates, ptNum, obUC,
  /* The production block's pack rule, which this harness does not load: the number after the last dash, else 1. */
  obPcsPerPack: sku => { const m = String(sku || '').match(/-(\d{1,2})$/); return m ? +m[1] : 1; }, ptPatch, ptPut, ptDelete, obCutQty, obPressQty, ptList,
  ORD, ORD_THRESHOLD, ordLines, ordCutReq, ptImgCell, ptImgFill, ptEmpty, ptFill, ptDownload, ptGet,
  ptCi, ordFilters, mdbOf: () => null,
  Set, Map, Date, Number, String, Object, Array, JSON, Math, isFinite, isNaN, parseInt, parseFloat,
  encodeURIComponent, RegExp, Promise, Boolean, Error, Infinity, NaN,
};
const EXPORT = '\n;return {'
  + 'SHOP:()=>SHOP, setSHOP:v=>{SHOP=v}, SHOP_META:()=>SHOP_META, setMETA:v=>{SHOP_META=v},'
  + 'soShipFrom, soWord, srAll, srSave, srSetStatus, srLineRoom, srReturnedQty, srRender, SR:()=>SR, setSR:v=>{SR=v}, zipState, zoneOf, milesBetween, daysEstimate, zipLL, ZONE_DAYS, indiaDaysEstimate, addBizDays, inBandOf,'
  + 'SHOP_STOCK:()=>SHOP_STOCK, setSTOCK:v=>{SHOP_STOCK=v; SHOP_STOCK_BY={SP:{},CPC:{}}}, setSTOCKCASE:v=>{SHOP_STOCK_CASE=v; SHOP_STOCK_CASE_BY={SP:{},CPC:{}}},'
  + 'SHOP_SKU:()=>SHOP_SKU, setSKU:v=>{SHOP_SKU=v}, setINDIA:v=>{SHOP_INDIA=v; SHOP_INDIA_LOADED=true},'
  + 'loadShopStock, loadShopIndia, soGuessBrand, soMcf, soAmzKey, soAmzCase, soLive, soSendQty, soMcfPlan, soBestBrand, soMcfHas, mcfErr, openShopOrder,'
  + 'apiPost, soMcfPayload, renderShop, soRows, SO_ALL_ROWS:()=>SO_ALL_ROWS, ensureShop, soStamp, sdToday, sdShift, soStoreDay,'
  + 'renderAdj, ajRows, soAdjId, soPackOf, soIndiaOf, soLineState, soFlags,'
  + 'shpSyncAll, shpSyncOrder, shpSyncMsg, shpPlanOrder, shpNeeds, shpLineShipped, shpOldestOpen, shpUnseen, shpCloseShipped, SHP_REACH_MAX_DAYS, shpOrderNo, shpOrderOf, shpWorkDone, adjOpen, shpBucket, shpBucketRun, shpDoneWhy, soProdStatus, soProdChip, shpBucketSheetRows, shpBucketXlRead, SHB_XL_COLS,'
  + 'setStockLoaded:v=>{SHOP_STOCK_LOADED=v},'
  + 'setIndia:(d,l,e)=>{SHOP_INDIA=d;SHOP_INDIA_LOADED=l;SHOP_INDIA_ERR=e}'
  + ', setCustom:v=>{SHP_CUSTOM=v}'
  + ', soIndexNames, soPackFit, shpSkuFromTitle, shpWords, shpSyncSoon, SHP_BUSY:()=>SHP_BUSY, SHP_AGAIN:()=>SHP_AGAIN, setSyncAll:v=>{shpSyncAll=v}'
  + ', soBulkPlan, soBulkApply, soBulkSheet, SO_LOC_OPTIONS, soLine, soLocOf, soBulkXlsx, soBinList, soCrc32'
  + '};';
const fn = new Function(...Object.keys(ctx), block + EXPORT);
const A = fn(...Object.values(ctx));

/* ---- runner ---- */
let pass = 0, fail = 0;
const ok = (what, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + what); }
  else { fail++; console.log('  FAIL ' + what + (extra ? '   [' + extra + ']' : '')); }
};

/* wrapped, because several of these await and this file is CommonJS */
(async () => {

console.log('\n== the backend the move had to repoint ==');
{
  CALLS.prGet = []; FETCHES = [];
  DOCS['stock/SP'] = { m: { 'RCNBMIX': 40, 'RTC301-6090': 5 } };
  DOCS['stock/CPC'] = { m: { 'RCNBmix': 12 } };

  await A.loadShopIndia();
  ok('India stock goes through the PRICE RESEARCH backend, not this app\'s own',
    CALLS.prGet.length === 1 && CALLS.apiGet.length === 0, JSON.stringify(CALLS.prGet));
  ok('…and it asks for the India stock', JSON.stringify(CALLS.prGet[0]) === JSON.stringify({ india: 'stock' }),
    JSON.stringify(CALLS.prGet[0]));

  /* MCF places real parcels. It must post to the Price Research script — the one that has MCF in
   * it — and never to the replenishment script. */
  FETCHES = [];
  FETCH_REPLY = () => ({ ok: true, id: 'MCF-1' });
  await A.apiPost({ mcf: 'preview' });
  ok('the MCF post goes to the Price Research backend', FETCHES.length === 1
    && FETCHES[0].url.indexOf('PRICE-RESEARCH') >= 0, FETCHES[0] && FETCHES[0].url);
  ok('…never to the replenishment backend', FETCHES[0].url.indexOf('REPLENISH') < 0);
  ok('…and it carries THAT backend\'s key', FETCHES[0].body.key === 'pr-key', FETCHES[0].body.key);
  ok('it is a POST', FETCHES[0].method === 'POST');
}

console.log('\n== a backend this account cannot read is said plainly, not as "not configured" ==');
{
  const saved = A;
  /* rebuild with no Price Research access, which is the real case for a factory-only account */
  const ctx2 = Object.assign({}, ctx, { PRAPI: null });
  const A2 = new Function(...Object.keys(ctx2), block + EXPORT)(...Object.values(ctx2));
  let msg = '';
  try { await A2.apiPost({ mcf: 'preview' }); } catch (e) { msg = e.message; }
  ok('it names the document and what to ask for', /config\/api/.test(msg) && /allowed to read/.test(msg), msg);
  ok('it does NOT blame configuration that is fine', !/not configured/.test(msg), msg);
}

console.log('\n== Amazon stock, and the casing that must survive ==');
{
  A.setSTOCK({}); A.setSTOCKCASE({});
  await A.loadShopStock();
  ok('both brands are merged into one map', A.SHOP_STOCK()['RCNBMIX'] === 40 && A.SHOP_STOCK()['RTC301-6090'] === 5);
  /* Amazon SKUs are case-sensitive: matching ignores case, but what is SENT back must be spelled
   * the way Amazon spells it. This is the bug Ravi caught on screen on 2026-08-25. */
  ok('a lower-case spelling still matches', A.soAmzKey('rcnbmix') === 'RCNBMIX');
  ok('…but Amazon\'s OWN spelling is what comes back out',
    ['RCNBMIX', 'RCNBmix'].includes(A.soAmzCase('rcnbmix')), A.soAmzCase('rcnbmix'));
}

console.log('\n== which brand to ship from, now read from THIS app\'s snapshot ==');
{
  REPL.SP = { rows: [{ sku: 'RCNBMIX' }, { sku: 'RTC301-6090' }] };
  REPL.CPC = { rows: [{ sku: 'RQL72' }] };
  const order = o => ({ id: o.id || 'o1', items: o.items });
  ok('a SP sku picks SP', A.soGuessBrand(order({ items: [{ sku: 'RCNBMIX' }] })) === 'SP');
  ok('a CPC sku picks CPC', A.soGuessBrand(order({ items: [{ sku: 'RQL72' }] })) === 'CPC');
  ok('a sku in neither gives no answer rather than a wrong one',
    A.soGuessBrand(order({ items: [{ sku: 'NOT-A-SKU' }] })) === '');
  /* It is a GUESS that preselects a dropdown. An empty snapshot must not crash the dialog. */
  REPL.SP = null; REPL.CPC = null;
  ok('no snapshot at all is answered, not thrown',
    A.soGuessBrand(order({ items: [{ sku: 'RCNBMIX' }] })) === '');
  REPL.SP = { rows: [{ sku: 'RCNBMIX' }, { sku: 'RTC301-6090' }] };
  REPL.CPC = { rows: [{ sku: 'RQL72' }] };
}

console.log('\n== nothing is published to the production tracker any more ==');
{
  SETS.length = 0;
  const paths = SETS.map(s => s.path).join(' ');
  ok('no write goes to a prod-orders document', !/prodOrders|prod_orders|prodnotes/i.test(paths), paths);
  ok('the block carries no reference to the publish functions',
    !/publishProdOrders|loadProdNotes|soProdNote/.test(block));
  ok('and none to the second project\'s config', !/PROD_CHUNK|PROD_NOTES/.test(block));
}

console.log('\n== the multi-select is this app\'s, not a second copy ==');
{
  ok('the block declares no MS of its own', !/^const MS = \{\};/m.test(block));
  ok('nor any of the widget\'s functions', !/^function msPaint\(/m.test(block) && !/^function msInit\(/m.test(block));
  ok('but it still uses it', /msInit\(|msVals\(/.test(block));
}

console.log('\n== an order that has shipped does not need making ==');
{
  /* "jitne bhi order, order console me banane ke liye aate h abhi wo close nahi hote h … jo shopify
   * me fulfill show ho rhe h ya mark complete dikhana chahiye."
   *
   * The sync has always said it closes an order "when the stock arrives or the order ships". It did
   * the first. soLineState reads refunds, buyer removals, send quantity and pack splits — and never
   * once looked at fulfilment, which is on the order as o.ff and already used elsewhere in this file
   * to tell a cancellation from a return. So 621 Shopify orders sat waiting to be made, some of them
   * shipped in July. */
  A.setSTOCK({}); A.setINDIA({}); A.setStockLoaded(true); A.setMETA({}); A.setSKU({});
  const item = (sku, qty) => ({ sku, name: sku, variant: '', qty, ffl: 'unfulfilled', rq: 0 });
  const mk = ff => ({ id: 'o-ship', no: '#5001', at: '2026-07-01T10:00:00Z',
    items: [item('RCNBMIX', 2)], ship: { name: 'A Buyer', country: 'US' }, ff });

  /* Nothing in FBA and nothing in India, so the line is genuinely production's. */
  const open = A.soFlags(mk(null), {});
  ok('an unshipped order is not marked shipped', open.shipped === false, JSON.stringify(open.shipped));
  const needOpen = A.shpNeeds(Object.assign({}, mk(null), open));
  ok('…and it asks for the piece to be made', needOpen.length === 1, String(needOpen.length));

  /* FULLY FULFILLED means the whole thing went. There is nothing left to make. */
  const done = A.soFlags(mk('fulfilled'), {});
  ok('a fulfilled order is marked shipped', done.shipped === true);
  const needDone = A.shpNeeds(Object.assign({}, mk('fulfilled'), done));
  ok('…and asks for nothing', needDone.length === 0, String(needDone.length));

  /* PARTIAL IS NOT GUESSED AT. Shopify's status is per order: "partial" says some of it went and
   * does not say which line, so the order is left exactly as it was rather than half-closed on a
   * guess. */
  const part = A.soFlags(mk('partial'), {});
  ok('a partly shipped order is not treated as shipped', part.shipped === false);
  ok('…and still asks for what it asked for before',
     A.shpNeeds(Object.assign({}, mk('partial'), part)).length === 1);

  /* ---- THE WINDOW REACHES AS FAR AS THE UNFINISHED WORK. "humko ise permanent hi fix krna
   * padega." The sync judges only what the fetch returns, and the fetch was a flat thirty days on
   * the reasoning that older orders have shipped. They had — which is exactly why their production
   * rows needed judging, and never got it. ---- */
  {
    const wasOb = PTG.ob;
    /* THE APP'S OWN DAY, not this machine's. Everything the app filters by date works in the
     * marketplace's day (PT); counting back from a UTC midnight made "150 days ago" one date here
     * and another one there, and the test failed for a few hours every night. */
    const day = n => A.sdShift(A.sdToday(), n);

    PTG.ob = [];
    ok('with nothing open, the window has nowhere it must reach', A.shpOldestOpen() === '');

    PTG.ob = ([
      { orderNo: 'SHP-1', sku: 'A', src: 'SHP', orderDate: day(-10) },
      { orderNo: 'SHP-2', sku: 'B', src: 'SHP', orderDate: day(-44) },
      { orderNo: 'SHP-3', sku: 'C', src: 'SHP', orderDate: day(-3) },
      /* An order that is not Shopify's is not this window's business. */
      { orderNo: 'AMZ-9', sku: 'D', src: '', orderDate: day(-300) },
    ]);
    ok('it reaches back to the oldest Shopify order still open', A.shpOldestOpen() === day(-44),
       A.shpOldestOpen() + ' vs ' + day(-44));
    ok('…and ignores an order that is not Shopify\u2019s', A.shpOldestOpen() !== day(-300));

    /* CAPPED, because one fetch has to come back. A year of orders would page for ever while the
     * screen showed nothing. */
    PTG.ob = ([
      { orderNo: 'SHP-OLD', sku: 'E', src: 'SHP', orderDate: day(-500) },
    ]);
    ok('a very old order does not make the fetch reach back for ever',
       A.shpOldestOpen() === day(-A.SHP_REACH_MAX_DAYS), A.shpOldestOpen());

    /* A date the order book cannot read is skipped rather than reached past. */
    PTG.ob = ([
      { orderNo: 'SHP-BAD', sku: 'F', src: 'SHP', orderDate: 'not a date' },
      { orderNo: 'SHP-OK', sku: 'G', src: 'SHP', orderDate: day(-7) },
    ]);
    ok('a date nobody can read is skipped, not guessed at', A.shpOldestOpen() === day(-7));

    PTG.ob = wasOb;
  }

  /* ---- ORDER #3289, EXACTLY AS SHOPIFY SHOWS IT. Partially fulfilled: one line in transit with a
   * FedEx number on it, one still in progress — and the app was asking production to make the one in
   * transit.
   *
   * I had written, twice, that a partial order could not be resolved because the payload "does not
   * say WHICH line". It does: every item carries ffl, and this file already reads it in soLive. I
   * found o.ff and stopped looking. ---- */
  {
    const ln = (sku, ffl) => ({ sku, name: sku, variant: '120" x 80"', qty: 1, ffl, rq: 0 });
    const o3289 = { id: 'o-3289', no: '#3289', at: '2026-08-08T08:51:00Z', ff: 'partial',
      items: [ln('RTC72-80120', 'unfulfilled'), ln('RTC374-80120', 'fulfilled')] };
    const st = A.soFlags(o3289, {});
    ok('the order is partial, so it is not shipped as a whole', st.shipped === false);

    const need = A.shpNeeds(Object.assign({}, o3289, st));
    ok('the line still in progress is asked for',
       need.some(w => w.sku === 'RTC72-80120'), need.map(w => w.sku).join());
    ok('…and the line already in transit is NOT',
       !need.some(w => w.sku === 'RTC374-80120'), need.map(w => w.sku).join());
    ok('…so exactly one piece is wanted from production', need.length === 1, String(need.length));

    /* The rule reads the word, not a fragment of it. */
    ok('a line says for itself whether it shipped',
       A.shpLineShipped({ ffl: 'fulfilled' }) === true
       && A.shpLineShipped({ ffl: 'unfulfilled' }) === false
       && A.shpLineShipped({}) === false);
    /* "partial" on a LINE is not "gone": part of a line is still part of it. */
    ok('…and a partly fulfilled line is not treated as gone',
       A.shpLineShipped({ ffl: 'partial' }) === false);
  }

  /* ---- AND ITS ADJUSTMENTS GO WITH IT. "ADJ-2923-RTC526090 order hote h but unka real #2923 order
   * number yadi fulfill ho to wo bhi auto production se remove ho jana chahiye."
   *
   * This reverses what the file said an hour ago. It cannot be narrower than "the order shipped",
   * because Shopify hands over a fulfilment STATUS and no fulfilment DATE — so there is no way to
   * ask whether the order shipped before the adjustment was raised, and the replacement is still
   * owed, or after it. One rule covers both. ---- */
  {
    const meta = {};
    meta['o-adj'] = { lines: { 'RTC52-6090': { adj: 'ADJ-2923-RTC526090', adjQty: 1,
      adjReason: 'Wrong size', adjState: 'raised', adjName: 'A tablecloth' } } };
    A.setMETA(meta);
    /* Nothing on the order itself needs making — the adjustment is the only work on it. */
    const withAdj = ff => ({ id: 'o-adj', no: '#2923', at: '2026-07-28T10:00:00Z', items: [], ff });

    const liveOne = A.soFlags(withAdj(null), meta['o-adj']);
    ok('an adjustment on an order still open asks for its piece',
       A.shpNeeds(Object.assign({}, withAdj(null), liveOne)).length === 1,
       String(A.shpNeeds(Object.assign({}, withAdj(null), liveOne)).length));

    const shippedOne = A.soFlags(withAdj('fulfilled'), meta['o-adj']);
    ok('…and the same adjustment on a fulfilled order asks for nothing',
       A.shpNeeds(Object.assign({}, withAdj('fulfilled'), shippedOne)).length === 0,
       String(A.shpNeeds(Object.assign({}, withAdj('fulfilled'), shippedOne)).length));

    /* On a PARTLY fulfilled order the adjustment asks its own line, not the order. */
    const partOne = A.soFlags(withAdj('partial'), meta['o-adj']);
    ok('…a partly shipped order keeps an adjustment whose own line has not gone',
       A.shpNeeds(Object.assign({}, withAdj('partial'), partOne)).length === 1);
    const partGone = Object.assign({}, withAdj('partial'),
      { items: [{ sku: 'RTC52-6090', name: 'x', qty: 1, ffl: 'fulfilled', rq: 0 }] });
    ok('…but drops one whose own line is already in transit',
       A.shpNeeds(Object.assign({}, partGone, A.soFlags(partGone, meta['o-adj']))).length === 0,
       String(A.shpNeeds(Object.assign({}, partGone, A.soFlags(partGone, meta['o-adj']))).length));

    /* NOTHING IS DESTROYED BY THIS. Only the production row goes; the adjustment keeps its own state
     * on the order and stays on the Adjustments tab, where a replacement that really is still owed
     * can be seen and raised again. */
    const ln = meta['o-adj'].lines['RTC52-6090'];
    ok('the adjustment itself is untouched by any of it',
       ln.adjState === 'raised' && ln.adj === 'ADJ-2923-RTC526090' && ln.adjQty === 1,
       JSON.stringify(ln));
    ok('…so it is still open, and still on the Adjustments tab', A.adjOpen(ln) === true);
    A.setMETA({});
  }

  /* And the reading is on the word, not on a fragment of it. */
  ok('an empty fulfilment status is not shipped', A.soFlags(mk(''), {}).shipped === false);
  ok('…and "unfulfilled" certainly is not',
     A.soFlags(mk('unfulfilled'), {}).shipped === false, String(A.soFlags(mk('unfulfilled'), {}).shipped));
}

console.log('\n== the orders table: as many cells as it has headers ==');
{
  A.setSHOP({ orders: [], from: '2026-09-01', to: '2026-09-06', tz: 'America/Los_Angeles', at: 'x' });
  A.setMETA({}); A.setSKU({});
  const item = (sku, qty) => ({ sku, name: sku, variant: '', qty, ffl: 'unfulfilled', rq: 0 });
  A.setSHOP({ orders: [
    { id: 'gid1', no: '#1001', at: '2026-09-05T10:00:00Z', items: [item('RCNBMIX', 2)],
      ship: { name: 'A Buyer', country: 'US' }, total: 40, cur: 'USD', cancelled: false, chargeback: false },
    { id: 'gid2', no: '#1002', at: '2026-09-05T11:00:00Z', items: [item('RTC301-6090', 9)],
      ship: { name: 'B Buyer', country: 'IN' }, total: 90, cur: 'INR', cancelled: true, cancelledAt: '2026-09-05', chargeback: false },
  ], from: '2026-09-01', to: '2026-09-06', tz: 'America/Los_Angeles', at: 'now' });

  els.soTable.innerHTML = '';
  A.renderShop();
  const h = els.soTable.innerHTML;
  const heads = (h.match(/<th\b/g) || []).length;
  const firstRow = (h.match(/<tr[^>]*data-so="[^"]*"[\s\S]*?<\/tr>/) || [''])[0];
  const cells = (firstRow.match(/<td\b/g) || []).length;
  ok('the table rendered at all', heads > 0 && cells > 0, 'th=' + heads + ' td=' + cells);
  ok('every header has a cell under it — a mismatch puts every column after it over the wrong data',
    heads === cells, heads + ' headers vs ' + cells + ' cells');
  {
    /* Ravi, 2026-09-28: "pahle me order par click krta tha to order ... sab dikhta tha" — the one-page table returned
     * before its wiring, so a click on an order, a heading or a tick did nothing. */
    const fake = { rows: [{ dataset: { so: 'gid1' } }], sorts: [{ dataset: { soSort: 'no' } }], picks: [{ dataset: { id: 'gid1' }, checked: false }] };
    const was = els.soTable.querySelectorAll;
    els.soTable.querySelectorAll = sel => (sel === '[data-so]' ? fake.rows : sel === '[data-so-sort]' ? fake.sorts : sel === '.soPick' ? fake.picks : []);
    A.renderShop();
    els.soTable.querySelectorAll = was;
    ok('this is the one-page table', /Pick · make/.test(els.soTable.innerHTML));
    ok('…a click on an order opens it', typeof fake.rows[0].onclick === 'function');
    ok('…its headings sort', typeof fake.sorts[0].onclick === 'function');
    ok('…and a tick is counted', typeof fake.picks[0].onchange === 'function');
  }
  ok('both orders are on screen', (h.match(/data-so="/g) || []).length === 2);
  /* A cancelled order is struck through AND says the word — colour alone does not print. */
  ok('a cancelled order is marked as such', /so-cancel/.test(h) && /Cancelled/.test(h));
  ok('the Production column is gone with the view that fed it', !/>Production</.test(h), h.slice(0, 200));
}

console.log('\n== the store\'s day, not this browser\'s ==');
{
  /* The Shopify store and the Amazon reports both run on Pacific time. A day boundary read in the
   * wrong zone is a whole day of orders missing or counted twice. */
  const d = A.sdToday();
  ok('today comes back as a plain ISO date', /^\d{4}-\d{2}-\d{2}$/.test(d), d);
  ok('a day back is a day back', A.sdShift('2026-03-01', -1) === '2026-02-28', A.sdShift('2026-03-01', -1));
  ok('and it crosses a year end', A.sdShift('2026-01-01', -1) === '2025-12-31', A.sdShift('2026-01-01', -1));
}


console.log('\n== THE GUARD: nothing runs until both stock figures are in ==');
{
  /* This is the one that matters. "Need from production" means neither Amazon nor India can fill
   * it — and before those two maps load, NEITHER CAN, so all 574 orders on the screen read as
   * pending. Without this guard a slow workbook would open a production order for every one. */
  RT = {}; PTG.ob = []; SOX.rows = []; WORK = {}; PATCHES.length = 0;
  PTG.mdb = [{ sku: 'RCNBMIX', articleType: 'Napkin', subtype: 'Plain', color: 'Blue', size: '20x20' }];
  const mk = (id, no, sku, qty) => ({ id, no, at: '2026-09-05T10:00:00Z',
    items: [{ sku, name: sku, qty, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'B', country: 'US' }, total: 10, cur: 'USD', cancelled: false });
  A.setSHOP({ orders: [mk('g1', '#4876', 'RCNBMIX', 2)], from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  A.setMETA({}); A.setSKU({}); A.setSTOCK({}); A.setSTOCKCASE({});

  A.setStockLoaded(false); A.setIndia({}, true, '');
  let t = await A.shpSyncAll({ force: true });
  ok('with Amazon stock unread it refuses, and says why',
    !!t.err && /Amazon stock has not been read/.test(t.err), t.err);
  ok('and writes absolutely nothing', PATCHES.length === 0 && !Object.keys(RT).length);

  A.setStockLoaded(true); A.setIndia({}, false, '');
  t = await A.shpSyncAll({ force: true });
  ok('with India stock unread it refuses too', !!t.err && /India stock has not been read/.test(t.err), t.err);

  A.setIndia({}, true, 'the workbook could not be opened');
  t = await A.shpSyncAll({ force: true });
  ok('a FAILED India read is not the same as an empty one', !!t.err && /India stock has not been read/.test(t.err), t.err);
  ok('…and the reason it failed is carried through', /workbook could not be opened/.test(t.err), t.err);
  ok('still nothing written', PATCHES.length === 0);
}

console.log('\n== a Shopify order nothing can fill opens under its own number ==');
{
  RT = {}; PTG.ob = []; SOX.rows = []; WORK = {}; PATCHES.length = 0;
  A.setStockLoaded(true); A.setIndia({}, true, '');
  const t = await A.shpSyncAll({ force: true });

  ok('the order is named after the Shopify order', t.written === 1 && !!RT['pt_orderBook/ob_shp_SHP-4876_RCNBMIX'],
    Object.keys(RT).join(', '));
  const row = RT['pt_orderBook/ob_shp_SHP-4876_RCNBMIX'];
  ok('SHP- so it can never collide with a raised order', row.orderNo === 'SHP-4876');
  ok('it carries the actual Shopify order number', row.shopOrderNo === '#4876');
  ok('and the Shopify order id', row.shopOrderId === 'g1');
  ok('the quantity is what is owed', row.qty === 2, String(row.qty));
  ok('the reason is on the row, for whoever reads it on the floor',
    /neither Amazon nor India/.test(row.remarks), row.remarks);
  ok('a sales order exists so it shows in the Order Console', !!RT['pt_salesOrders/SHP-4876']);
  ok('…approved, with no invented delivery date',
    RT['pt_salesOrders/SHP-4876'].status === 'approved' && RT['pt_salesOrders/SHP-4876'].deliveryDate === '');
  ok('written in ONE batch', PATCHES.length === 1, String(PATCHES.length));
}

console.log('\n== it closes itself when the stock arrives ==');
{
  /* The tracking half: an order stops needing production the moment Amazon can fill it, and the
   * order-book line has to go with it or the floor makes something already on a shelf. */
  A.setSTOCK({ RCNBMIX: 40 }); A.setSTOCKCASE({ RCNBMIX: 'RCNBMIX' });
  const t = await A.shpSyncAll({ force: true });
  ok('the line closes once Amazon can cover it', t.removed === 1
    && !RT['pt_orderBook/ob_shp_SHP-4876_RCNBMIX'], JSON.stringify({ r: t.removed, w: t.written }));
  ok('and the order goes with its last line', !RT['pt_salesOrders/SHP-4876']);

  /* …unless the floor has already started. */
  A.setSTOCK({}); A.setSTOCKCASE({});
  await A.shpSyncAll({ force: true });
  WORK['SHP-4876|RCNBMIX'] = { cut: 2 };
  A.setSTOCK({ RCNBMIX: 40 }); A.setSTOCKCASE({ RCNBMIX: 'RCNBMIX' });
  const t2 = await A.shpSyncAll({ force: true });
  ok('a line already cut against is NOT withdrawn', !!RT['pt_orderBook/ob_shp_SHP-4876_RCNBMIX'],
    JSON.stringify(t2.kept));
  ok('and it is reported rather than done silently', t2.kept.length === 1, JSON.stringify(t2.kept));
  WORK = {}; A.setSTOCK({}); A.setSTOCKCASE({});
}

console.log('\n== only the lines that need making, not the whole order ==');
{
  /* 210 of the orders on that screen are "partly" — one line Amazon has, one it does not. Ordering
   * the whole order would make pieces already sitting in FBA. */
  RT = {}; PTG.ob = []; SOX.rows = []; WORK = {};
  PTG.mdb = [
    { sku: 'RCNBMIX', articleType: 'Napkin', subtype: 'Plain', color: 'Blue', size: '20x20' },
    { sku: 'RTC301-6090', articleType: 'Tablecloth', subtype: 'Plain', color: 'Red', size: '60x90' },
  ];
  A.setSTOCK({ RCNBMIX: 50 }); A.setSTOCKCASE({ RCNBMIX: 'RCNBMIX' });
  A.setSHOP({ orders: [{ id: 'g2', no: '#4877', at: '2026-09-05T10:00:00Z',
    items: [{ sku: 'RCNBMIX', name: 'n', qty: 2, ffl: 'unfulfilled', rq: 0 },
            { sku: 'RTC301-6090', name: 't', qty: 3, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'B', country: 'US' }, total: 10, cur: 'USD', cancelled: false }],
    from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  const t = await A.shpSyncAll({ force: true });
  ok('only the line nothing can fill is ordered', t.written === 1
    && !!RT['pt_orderBook/ob_shp_SHP-4877_RTC301-6090'], Object.keys(RT).join(', '));
  ok('the line Amazon holds is NOT ordered', !RT['pt_orderBook/ob_shp_SHP-4877_RCNBMIX']);

  /* A cancelled order is not made. */
  A.setSHOP({ orders: [{ id: 'g3', no: '#4878', at: '2026-09-05T10:00:00Z',
    items: [{ sku: 'RTC301-6090', name: 't', qty: 3, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'B', country: 'US' }, total: 10, cur: 'USD', cancelled: true, cancelledAt: '2026-09-05' }],
    from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  const t2 = await A.shpSyncAll({ force: true });
  ok('a cancelled order is never sent to production', !RT['pt_orderBook/ob_shp_SHP-4878_RTC301-6090'],
    JSON.stringify(t2.written));
}

console.log('\n== an adjustment joins the SAME order, it does not open a second ==');
{
  RT = {}; PTG.ob = []; SOX.rows = []; WORK = {};
  A.setSTOCK({}); A.setSTOCKCASE({});
  A.setSHOP({ orders: [{ id: 'g4', no: '#4879', at: '2026-09-05T10:00:00Z',
    items: [{ sku: 'RTC301-6090', name: 't', qty: 3, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'B', country: 'US' }, total: 10, cur: 'USD', cancelled: false }],
    from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  A.setMETA({ g4: { lines: { RCNBMIX: { adj: 'ADJ-4879-RCNBMIX', adjQty: 1, adjReason: 'Wrong size',
    adjOrder: '#4879', adjOrderDate: '2026-09-05', adjState: 'raised' } } } });
  const t = await A.shpSyncAll({ force: true });

  ok('one Shopify order is ONE production order',
    Object.keys(RT).filter(k => /^pt_salesOrders\//.test(k)).length === 1, Object.keys(RT).join(', '));
  ok('the pending line and the adjustment are both on it', t.written === 2
    && !!RT['pt_orderBook/ob_shp_SHP-4879_RTC301-6090'] && !!RT['pt_orderBook/ob_shp_SHP-4879_RCNBMIX'],
    JSON.stringify(t.written));
  ok('the adjustment id rides on its own line',
    RT['pt_orderBook/ob_shp_SHP-4879_RCNBMIX'].adjId === 'ADJ-4879-RCNBMIX');
  ok('and the pending line has no adjustment id to claim',
    RT['pt_orderBook/ob_shp_SHP-4879_RTC301-6090'].adjId === '');

  /* A received adjustment is not made again. */
  A.setMETA({ g4: { lines: { RCNBMIX: { adj: 'ADJ-4879-RCNBMIX', adjQty: 1, adjReason: 'Wrong size',
    adjOrder: '#4879', adjOrderDate: '2026-09-05', adjState: 'received' } } } });
  const t2 = await A.shpSyncAll({ force: true });
  ok('one already received is withdrawn', t2.removed === 1
    && !RT['pt_orderBook/ob_shp_SHP-4879_RCNBMIX'], JSON.stringify(t2));
}

console.log('\n== an order it cannot see is added to, never withdrawn ==');
{
  /* Opening the Adjustments tab without fetching leaves SO_ALL_ROWS empty. That is not evidence
   * that nothing is pending, and treating it as such would withdraw every order ever opened. */
  RT = {}; PTG.ob = []; SOX.rows = []; WORK = {};
  A.setSHOP({ orders: [], from: '', to: '', tz: '', at: '' });
  A.renderShop();
  A.setMETA({ old1: { lines: { RCNBMIX: { adj: 'ADJ-3790-RCNBMIX', adjQty: 1, adjReason: 'Wrong size',
    adjOrder: '#3790', adjOrderDate: '2026-08-18', adjState: 'raised' } } } });
  /* a pending line this run cannot see, already on the order from an earlier run */
  PTG.ob = [{ id: 'ob_shp_SHP-3790_RTC301-6090', orderNo: 'SHP-3790', sku: 'RTC301-6090', qty: 3,
    orderDate: '2026-08-18', src: 'SHP', shopOrderNo: '#3790', shopOrderId: 'old1', adjId: '' }];
  const t = await A.shpSyncAll({ force: true });
  ok('the adjustment still reaches production', !!RT['pt_orderBook/ob_shp_SHP-3790_RCNBMIX'],
    Object.keys(RT).join(', '));
  ok('and the line it could not judge is left exactly where it was', t.removed === 0,
    JSON.stringify({ removed: t.removed }));
  ok('it is still on screen too', (PTG.ob || []).some(x => x.sku === 'RTC301-6090'));
}

console.log('\n== a large first run is confirmed, once ==');
{
  RT = {}; PTG.ob = []; SOX.rows = []; WORK = {}; PATCHES.length = 0;
  const orders = [], mdb = [];
  for (let i = 1; i <= 60; i++) {
    const sku = 'RTC' + i + '-6090';
    mdb.push({ sku, articleType: 'Tablecloth', subtype: 'Plain', color: 'Blue', size: '60x90' });
    orders.push({ id: 'b' + i, no: '#' + (5000 + i), at: '2026-09-05T10:00:00Z',
      items: [{ sku, name: 't', qty: 1, ffl: 'unfulfilled', rq: 0 }],
      ship: { name: 'B', country: 'US' }, total: 10, cur: 'USD', cancelled: false });
  }
  PTG.mdb = mdb; A.setMETA({});
  A.setSHOP({ orders, from: '', to: '', tz: '', at: 'x' });
  A.renderShop();

  CONFIRM = false;
  const t = await A.shpSyncAll();
  ok('sixty new orders are not opened without being asked', t.cancelled === true && PATCHES.length === 0,
    JSON.stringify({ c: t.cancelled, p: PATCHES.length }));
  ok('and it says nothing was sent', /Nothing was sent to production/.test(A.shpSyncMsg(t)), A.shpSyncMsg(t));

  CONFIRM = true;
  const t2 = await A.shpSyncAll();
  ok('said yes, and all sixty open', t2.written === 60 && t2.newOrders === 60, JSON.stringify({ w: t2.written, n: t2.newOrders }));
  ok('one sales order each', Object.keys(RT).filter(k => /^pt_salesOrders\//.test(k)).length === 60);

  /* And the steady state is silent: nothing new, nothing asked, nothing written. */
  PATCHES.length = 0;
  const t3 = await A.shpSyncAll();
  ok('a second run writes nothing and asks nothing', t3.written === 0 && PATCHES.length === 0,
    JSON.stringify({ w: t3.written, p: PATCHES.length }));
  ok('…and has nothing to say', A.shpSyncMsg(t3) === '', A.shpSyncMsg(t3));
}


console.log('\n== a SKU nobody has catalogued still gets its order ==');
{
  /* It used to be refused: 17 of 66 adjusted lines were named and left out for want of a master row.
   * Now the order opens with the SKU as Shopify spells it, and the code goes on the Custom SKUs
   * list for its article, colour and size to be filled in. */
  RT = {}; PTG.ob = []; SOX.rows = []; WORK = {}; PATCHES.length = 0;
  A.setCustom(null);
  PTG.mdb = [{ sku: 'RCNBMIX', articleType: 'Napkin', subtype: 'Plain', color: 'Blue', size: '20x20' }];
  A.setStockLoaded(true); A.setIndia({}, true, ''); A.setSTOCK({}); A.setSTOCKCASE({});
  A.setMETA({});
  A.setSHOP({ orders: [{ id: 'g9', no: '#4900', at: '2026-09-06T10:00:00Z',
    items: [{ sku: 'RTC52-60108', name: 'Sage Rectangle Tablecloth', variant: '60x108', qty: 2, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'B', country: 'US' }, total: 10, cur: 'USD', cancelled: false }],
    from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  const t = await A.shpSyncAll({ force: true });

  ok('the order opens even though the SKU is unknown',
    !!RT['pt_orderBook/ob_shp_SHP-4900_RTC52-60108'], Object.keys(RT).join(', '));
  const row = RT['pt_orderBook/ob_shp_SHP-4900_RTC52-60108'];
  ok('the SKU is Shopify\'s own code, not a generated one', row.sku === 'RTC52-60108');
  ok('the quantity is right', row.qty === 2, String(row.qty));
  ok('the row says the code is not catalogued yet', row.needsSku === true
    && /Custom SKUs list/.test(row.remarks), row.remarks);
  ok('article and colour are left BLANK rather than guessed',
    row.articleType === '' && row.color === '' && row.size === '');

  /* And the code itself is now waiting on the Custom SKUs list. */
  const cs = RT['pt_customSkus/RTC52-60108'];
  ok('it is on the Custom SKUs list', !!cs, Object.keys(RT).filter(k => /custom/i.test(k)).join(', '));
  ok('marked custom, so it never quietly amends the real catalogue', cs.isCustom === true);
  ok('carrying the product name, so it is not a bare code to decipher',
    /Sage Rectangle Tablecloth/.test(cs.shopName), cs.shopName);
  ok('and its article, colour and size are the blanks left to fill',
    cs.articleType === '' && cs.color === '' && cs.size === '');
  ok('the run reports it', t.custom.length === 1 && t.custom[0] === 'RTC52-60108', JSON.stringify(t.custom));
  ok('the message says it was catalogued, not refused',
    /Custom SKUs list/.test(A.shpSyncMsg(t)) && !/could not be ordered/.test(A.shpSyncMsg(t)), A.shpSyncMsg(t));

  /* The order line and the code arrive TOGETHER — a row naming a code the Master Database cannot
   * explain is worse than either alone. */
  ok('both went up in the same batch', PATCHES.length === 1
    && Object.keys(PATCHES[0]).some(k => /^pt_orderBook\//.test(k))
    && Object.keys(PATCHES[0]).some(k => /^pt_customSkus\//.test(k)), String(PATCHES.length));

  /* Running again must not write the custom row a second time. */
  PATCHES.length = 0;
  const t2 = await A.shpSyncAll({ force: true });
  ok('a second run does not re-add it', t2.custom.length === 0 && PATCHES.length === 0, JSON.stringify(t2.custom));

  /* Once Ravi completes it in the Master Database, the order line picks the details up. */
  PTG.mdb = PTG.mdb.concat([{ sku: 'RTC52-60108', articleType: 'Tablecloth', subtype: 'Plain', color: 'Sage', size: '60x108' }]);
  const t3 = await A.shpSyncAll({ force: true });
  ok('completing the master row fills the order line in', t3.written === 1
    && RT['pt_orderBook/ob_shp_SHP-4900_RTC52-60108'].articleType === 'Tablecloth', JSON.stringify(t3.written));
  ok('and the row stops saying it needs cataloguing',
    RT['pt_orderBook/ob_shp_SHP-4900_RTC52-60108'].needsSku === false);
}


console.log('\n== a duplicate order can never get in ==');
{
  const clean = () => { RT = {}; PTG.ob = []; SOX.rows = []; WORK = {}; PATCHES.length = 0;
    A.setCustom(null); A.setMETA({}); A.setSTOCK({}); A.setSTOCKCASE({});
    A.setStockLoaded(true); A.setIndia({}, true, ''); };
  const order = (id, no, sku, qty) => ({ id, no, at: '2026-09-05T10:00:00Z',
    items: [{ sku, name: sku, qty, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'B', country: 'US' }, total: 10, cur: 'USD', cancelled: false });

  clean();
  PTG.mdb = [{ sku: 'RTC301-6090', articleType: 'Tablecloth', subtype: 'Plain', color: 'Red', size: '60x90' }];

  /* TWO SHOPS, BOTH WITH AN ORDER #1001. Every shop numbers from 1, and this screen reads fetched
   * and imported orders as one list, so this is not a hypothetical. */
  A.setSHOP({ orders: [order('gid-aaaa1111', '#1001', 'RTC301-6090', 2),
                       order('gid-bbbb2222', '#1001', 'RTC301-6090', 3)],
    from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  const t = await A.shpSyncAll({ force: true });

  const obKeys = Object.keys(RT).filter(k => /^pt_orderBook\//.test(k));
  ok('two different Shopify orders do NOT share a production order', obKeys.length === 2, obKeys.join(', '));
  const nos = obKeys.map(k => RT[k].orderNo).sort();
  ok('the first keeps the plain number', nos[0] === 'SHP-1001', JSON.stringify(nos));
  ok('the second is given its own, from its own Shopify id', nos[1] !== 'SHP-1001' && /^SHP-1001-/.test(nos[1]), nos[1]);
  ok('and each keeps its own quantity — neither is summed into the other',
    obKeys.map(k => RT[k].qty).sort().join(',') === '2,3', obKeys.map(k => RT[k].qty).join(','));
  ok('each row still names the Shopify order it belongs to',
    obKeys.every(k => RT[k].shopOrderNo === '#1001')
    && new Set(obKeys.map(k => RT[k].shopOrderId)).size === 2);

  /* The suffix comes from the order's OWN id, so it is the same on every run whatever else is
   * loaded — and running again must not open a third order. */
  const before = Object.keys(RT).filter(k => /^pt_orderBook\//.test(k)).sort().join('|');
  PATCHES.length = 0;
  const t2 = await A.shpSyncAll({ force: true });
  ok('a second run opens nothing new', t2.written === 0 && PATCHES.length === 0, JSON.stringify(t2.written));
  ok('and the numbers are exactly the same as before',
    Object.keys(RT).filter(k => /^pt_orderBook\//.test(k)).sort().join('|') === before);

  /* …even if the OTHER order is the one loaded first. The claim is read out of the order book, so
   * it survives whatever order the list happens to arrive in. */
  A.setSHOP({ orders: [order('gid-bbbb2222', '#1001', 'RTC301-6090', 3),
                       order('gid-aaaa1111', '#1001', 'RTC301-6090', 2)],
    from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  const t3 = await A.shpSyncAll({ force: true });
  ok('reversing the order they arrive in changes nothing', t3.written === 0
    && Object.keys(RT).filter(k => /^pt_orderBook\//.test(k)).sort().join('|') === before,
    JSON.stringify({ w: t3.written }));
}

console.log('\n== two rows for one order and SKU would DOUBLE a quantity ==');
{
  /* This is the dangerous shape, because it does not look like a duplicate. ordLines() adds rows
   * together by order and SKU, so a second row shows up as twice the pieces and nothing says so.
   * One stale key — an older prefix, a half-finished migration — is all it takes. */
  RT = {}; SOX.rows = []; WORK = {}; PATCHES.length = 0; A.setCustom(null); A.setMETA({});
  A.setStockLoaded(true); A.setIndia({}, true, ''); A.setSTOCK({}); A.setSTOCKCASE({});
  PTG.mdb = [{ sku: 'RTC301-6090', articleType: 'Tablecloth', subtype: 'Plain', color: 'Red', size: '60x90' }];
  PTG.ob = [
    { id: 'ob_shp_SHP-2001_RTC301-6090', orderNo: 'SHP-2001', sku: 'RTC301-6090', qty: 2,
      orderDate: '2026-09-05', src: 'SHP', shopOrderNo: '#2001', shopOrderId: 'g2001', adjId: '' },
    /* the same order and SKU, written under an older key */
    { id: 'ob_adj_SHP-2001_RTC301-6090', orderNo: 'SHP-2001', sku: 'RTC301-6090', qty: 2,
      orderDate: '2026-09-05', src: 'ADJ', shopOrderNo: '#2001', shopOrderId: 'g2001', adjId: '' },
  ];
  A.setSHOP({ orders: [{ id: 'g2001', no: '#2001', at: '2026-09-05T10:00:00Z',
    items: [{ sku: 'RTC301-6090', name: 't', qty: 2, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'B', country: 'US' }, total: 10, cur: 'USD', cancelled: false }],
    from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  const t = await A.shpSyncAll({ force: true });

  ok('the stray row is deleted', t.dupes === 1, JSON.stringify({ d: t.dupes }));
  ok('and it is the one at the wrong key that goes',
    PATCHES[0]['pt_orderBook/ob_adj_SHP-2001_RTC301-6090'] === null,
    JSON.stringify(Object.keys(PATCHES[0] || {})));
  ok('exactly one row is left for that order and SKU',
    (PTG.ob || []).filter(x => x.orderNo === 'SHP-2001' && x.sku === 'RTC301-6090').length === 1,
    String((PTG.ob || []).filter(x => x.orderNo === 'SHP-2001').length));
  ok('the quantity is the real one, not the doubled one',
    (PTG.ob || []).find(x => x.orderNo === 'SHP-2001').qty === 2);
  ok('and the message says a duplicate was cleared',
    /duplicate row\(s\) removed/.test(A.shpSyncMsg(t)), A.shpSyncMsg(t));
}

console.log('\n== the same order twice in one list is planned once ==');
{
  /* Fetched orders and imported orders are read as one list, and the same order can be in both. */
  RT = {}; PTG.ob = []; SOX.rows = []; WORK = {}; PATCHES.length = 0; A.setCustom(null); A.setMETA({});
  PTG.mdb = [{ sku: 'RTC301-6090', articleType: 'Tablecloth', subtype: 'Plain', color: 'Red', size: '60x90' }];
  const same = () => ({ id: 'g3001', no: '#3001', at: '2026-09-05T10:00:00Z',
    items: [{ sku: 'RTC301-6090', name: 't', qty: 4, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'B', country: 'US' }, total: 10, cur: 'USD', cancelled: false });
  A.setSHOP({ orders: [same(), same()], from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  const t = await A.shpSyncAll({ force: true });

  ok('one production order, not two',
    Object.keys(RT).filter(k => /^pt_salesOrders\//.test(k)).length === 1, Object.keys(RT).join(', '));
  ok('one order-book row, not two',
    Object.keys(RT).filter(k => /^pt_orderBook\//.test(k)).length === 1);
  ok('the quantity is the order\'s, not twice it', RT['pt_orderBook/ob_shp_SHP-3001_RTC301-6090'].qty === 4,
    String(RT['pt_orderBook/ob_shp_SHP-3001_RTC301-6090'].qty));
  ok('and the repeat is reported rather than silently dropped',
    t.skipped.some(s => /planned twice/.test(s.why)), JSON.stringify(t.skipped));
}


console.log('\n== an order somebody has written DONE on ==');
{
  RT = {}; PTG.ob = []; SOX.rows = []; WORK = {}; PATCHES.length = 0;
  A.setCustom(null); A.setMETA({}); A.setSTOCK({}); A.setSTOCKCASE({});
  A.setStockLoaded(true); A.setIndia({}, true, '');
  PTG.mdb = [{ sku: 'RTCR0009-90', articleType: 'Tablecloth', subtype: 'Round', color: 'Indigo', size: '90' }];
  const order = (id, no, note) => ({ id, no, at: '2026-09-06T10:00:00Z', note: note || '',
    items: [{ sku: 'RTCR0009-90', name: 'Indigo Flower Round Tablecloth', qty: 1, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'R', country: 'US' }, total: 35, cur: 'USD', cancelled: false });

  /* Nothing written: it needs making, as before. */
  A.setSHOP({ orders: [order('g1', '#4001', '')], from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  await A.shpSyncAll({ force: true });
  ok('an ordinary order still opens', !!RT['pt_orderBook/ob_shp_SHP-4001_RTCR0009-90'],
    Object.keys(RT).join(', '));

  /* DONE on the Shopify note: it must not, and the one already open must close. */
  A.setSHOP({ orders: [order('g1', '#4001', 'DONE')], from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  const t = await A.shpSyncAll({ force: true });
  ok('DONE closes the production order', t.removed === 1
    && !RT['pt_orderBook/ob_shp_SHP-4001_RTCR0009-90'], JSON.stringify({ r: t.removed }));
  ok('and the order itself goes with it', !RT['pt_salesOrders/SHP-4001']);
  ok('the message says why', /marked done on Shopify/.test(A.shpSyncMsg(t)), A.shpSyncMsg(t));

  /* The three words he named, in the shapes they actually get typed. */
  const opens = async note => {
    RT = {}; PTG.ob = []; SOX.rows = [];
    A.setSHOP({ orders: [order('g2', '#4002', note)], from: '', to: '', tz: '', at: 'x' });
    A.renderShop();
    await A.shpSyncAll({ force: true });
    return !!RT['pt_orderBook/ob_shp_SHP-4002_RTCR0009-90'];
  };
  ok('DONE stops it', !(await opens('DONE')));
  ok('done, lower case, stops it', !(await opens('done')));
  ok('Ready stops it', !(await opens('Ready')));
  ok('READY TO SHIP stops it', !(await opens('READY TO SHIP')));
  ok('ready to ship, spaced oddly, stops it', !(await opens(' ready  to  ship ')));
  ok('DONE. with a full stop stops it', !(await opens('DONE.')));
  ok('a note that is done on one line and something else on another stops it',
    !(await opens('Gift wrap please\nDONE')));

  /* AND THE ONES THAT MUST NOT BE STOPPED. A substring match here would silently refuse to make
   * goods somebody is waiting for, and nothing on any screen would report it. */
  ok('"done by Friday" does NOT stop it', await opens('Please have this done by Friday'));
  ok('"ready when the fabric arrives" does NOT stop it', await opens('ready when the fabric arrives'));
  ok('"not done" does NOT stop it', await opens('not done'));
  ok('"already ready to ship the rest" does NOT stop it', await opens('already ready to ship the rest'));
  ok('an empty note does not stop it', await opens(''));
}

console.log('\n== it is the same answer everywhere, not just for production ==');
{
  const mk = note => ({ id: 'g5', no: '#4005', at: '2026-09-06T10:00:00Z', note,
    items: [{ sku: 'RTCR0009-90', name: 'x', qty: 1, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'R', country: 'US' }, total: 35, cur: 'USD', cancelled: false });
  A.setSHOP({ orders: [mk('DONE')], from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  const rows = A.soRows();
  ok('the row is flagged', rows[0].handled === true);
  /* One string, read by the column, the pending count, the filter and the export — so the screen
   * and the production order can never disagree about what this order is. */
  ok('the "Ship from" column says Marked done, not Need from production',
    rows[0].route === 'Marked done', rows[0].route);
  ok('and it names what said so, so nobody has to hunt for it',
    /Shopify note/.test(rows[0].handledWhy) && /DONE/.test(rows[0].handledWhy), rows[0].handledWhy);

  A.setSHOP({ orders: [mk('')], from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  ok('without the note it is pending again', A.soRows()[0].route === 'Need from production',
    A.soRows()[0].route);
}

console.log('\n== an adjustment survives the note ==');
{
  /* A note about the original shipment does not withdraw a piece somebody deliberately asked for.
   * Dropping it silently is the failure this whole screen keeps guarding against. */
  RT = {}; PTG.ob = []; SOX.rows = [];
  A.setSHOP({ orders: [{ id: 'g6', no: '#4006', at: '2026-09-06T10:00:00Z', note: 'DONE',
    items: [{ sku: 'RTCR0009-90', name: 'x', qty: 1, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'R', country: 'US' }, total: 35, cur: 'USD', cancelled: false }],
    from: '', to: '', tz: '', at: 'x' });
  A.setMETA({ g6: { lines: { 'RTCR0009-90': { adj: 'ADJ-4006-RTCR000990', adjQty: 1,
    adjReason: 'Wrong size', adjOrder: '#4006', adjOrderDate: '2026-09-06', adjState: 'raised' } } } });
  A.renderShop();
  await A.shpSyncAll({ force: true });
  ok('the adjustment still opens its order', !!RT['pt_orderBook/ob_shp_SHP-4006_RTCR000990']
    || !!RT['pt_orderBook/ob_shp_SHP-4006_RTCR0009-90'], Object.keys(RT).join(', '));
  const row = RT['pt_orderBook/ob_shp_SHP-4006_RTCR0009-90'];
  ok('and it is there because of the adjustment, not the order line',
    row && row.adjId === 'ADJ-4006-RTCR000990' && /adjustment/.test(row.remarks), row && row.remarks);
  ok('one piece, not two — the order line itself was not counted', row && row.qty === 1, row && String(row.qty));
  A.setMETA({});
}

console.log('\n== the picture comes from Shopify, not the catalogue ==');
{
  /* "shopify ke order ki image shopify se aani chahiye not from masterdata base." Shopify sends the
   * photo with the order — the variant's where there is one — and it was being carried as far as the
   * Custom SKUs list and then dropped. */
  RT = {}; PTG.ob = []; SOX.rows = []; A.setMETA({});
  A.setSHOP({ orders: [{ id: 'img1', no: '#5100', at: A.sdShift(A.sdToday(), -1) + 'T10:00:00Z',
    items: [{ sku: 'RTCR0009-90', name: 'Quilt', qty: 1, ffl: 'unfulfilled', rq: 0,
      img: 'https://cdn.shopify.com/s/files/1/0/variant-photo.jpg' }],
    ship: { name: 'R', country: 'US' }, total: 35, cur: 'USD' }], from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  await A.shpSyncAll({ force: true });
  const row = RT['pt_orderBook/ob_shp_SHP-5100_RTCR0009-90'];
  ok('the order row keeps the photo the order was placed against',
     row && row.shopImg === 'https://cdn.shopify.com/s/files/1/0/variant-photo.jpg',
     row && String(row.shopImg));

  /* A photo that turns up later must rewrite the row — otherwise "nothing has changed" keeps the
   * blank cell for ever. */
  PTG.ob = [Object.assign({}, row, { shopImg: '' })];
  RT = {};
  await A.shpSyncAll({ force: true });
  ok('…and a row whose photo has only now arrived is written again',
     !!RT['pt_orderBook/ob_shp_SHP-5100_RTCR0009-90'], Object.keys(RT).join(', '));

  RT = {}; PTG.ob = []; SOX.rows = [];
}

console.log('\n== an order nobody fetched is still judged ==');
{
  /* #2923, EXACTLY AS IT HAPPENED. The order was placed on 28 July and carries an open adjustment.
   * The oldest order the app had fetched was 9 August, so #2923 was never in the window — and an
   * order that is not in the window cannot be asked whether it shipped. The replacement was
   * therefore demanded again on every run, months after the parcel went.
   *
   * Dates are worked out from today so this test cannot rot: the reach has a floor at
   * SHP_REACH_MAX_DAYS, and hard-coded dates would drift past it and start passing for the wrong
   * reason. */
  const july = A.sdShift(A.sdToday(), -46);
  const sept = A.sdShift(A.sdToday(), -3);
  RT = {}; PTG.ob = []; SOX.rows = []; CALLS.prGet.length = 0;

  const liveOne = { id: 'o-sept', no: '#3400', at: sept + 'T10:00:00Z',
    items: [{ sku: 'RTCR0009-90', name: 'x', qty: 1, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'R', country: 'US' }, total: 35, cur: 'USD' };
  A.setSHOP({ orders: [liveOne], from: '', to: '', tz: '', at: 'x' });
  A.setMETA({ 'o-july': { lines: { 'RTC52-6090': { adj: 'ADJ-2923-RTC526090', adjQty: 1,
    adjReason: 'Damaged', adjOrder: '#2923', adjOrderDate: july, adjState: 'raised' } } } });
  A.renderShop();                                  // this is what fills SO_ALL_ROWS

  ok('the order carrying the replacement is known to be one nobody fetched',
     A.shpUnseen().has('o-july') && A.shpUnseen().get('o-july') === july,
     JSON.stringify([...A.shpUnseen()]));
  ok('…and the window now reaches back to it rather than stopping at the newest work',
     A.shpOldestOpen() === july, A.shpOldestOpen());

  /* While it cannot be seen, the replacement is demanded — which is right, and is also the state
   * Ravi was looking at. */
  await A.shpSyncAll({ force: true });
  const row = 'pt_orderBook/ob_shp_SHP-2923_RTC52-6090';
  ok('an order nobody can see still has its replacement made', !!RT[row], Object.keys(RT).join(', '));

  /* Now the app asks Shopify about exactly that order, and Shopify says it shipped. */
  PRGET_REPLY = { orders: [{ id: 'o-july', no: '#2923', at: july, ff: 'fulfilled',
    items: [{ sku: 'RTC52-6090', name: 'x', qty: 1, ffl: 'fulfilled', rq: 0 }],
    ship: { name: 'R', country: 'US' }, total: 20, cur: 'USD' }] };
  const out = await A.shpCloseShipped();
  const asked = CALLS.prGet.filter(p => p && p.shopify === 'orders');
  ok('it asks Shopify for the days it was missing, fulfilled orders included',
     asked.some(p => p.start === july && p.open === '0'), JSON.stringify(asked));
  /* A WINDOW PER MISSING ORDER'S OWN DAYS, AND BOTH STORES (2026-09-23). It used to ask for the whole
   * reach — up to 150 days — in one call; three thousand orders do not fit one page, the answer came
   * back truncated, and the old orders it was looking for were exactly the ones cut off. 82 shipped
   * lines were still being asked of production, and the CPC store was never asked at all. */
  ok('…each window is a fortnight, not the whole reach', asked.every(p => {
    const d = (new Date(p.end + 'T00:00:00Z') - new Date(p.start + 'T00:00:00Z')) / 86400000;
    return d <= 15;
  }), JSON.stringify(asked.map(p => p.start + ' → ' + p.end)));
  ok('…and CPC is asked for the same days, so a CPC order can close too',
     asked.some(p => p.shop === 'CPC' && p.start === july), JSON.stringify(asked));
  ok('…it stops as soon as every missing order has been found', asked.length === 2, String(asked.length));
  ok('…and the order that has shipped is closed', out.closed === 1, JSON.stringify(out));
  ok('…so the replacement is gone from production', !(row in RT), Object.keys(RT).join(', '));

  /* AND IT ONLY EVER CLOSES. This pass runs without the stock context a real judgement needs, so an
   * order that comes back still open must be left exactly as it was rather than re-decided. */
  RT = {}; PTG.ob = []; SOX.rows = [];
  A.renderShop();
  await A.shpSyncAll({ force: true });
  const before = Object.keys(RT).sort().join(',');
  PRGET_REPLY = { orders: [{ id: 'o-july', no: '#2923', at: july, ff: 'unfulfilled',
    items: [{ sku: 'RTC52-6090', name: 'x', qty: 1, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'R', country: 'US' }, total: 20, cur: 'USD' }] };
  const out2 = await A.shpCloseShipped();
  ok('an order that is still open is not CLOSED', out2.closed === 0, JSON.stringify(out2));
  ok('…and a row it already has is left exactly as it was', Object.keys(RT).sort().join(',') === before);

  /* A PART-SHIPPED ORDER FROM MONTHS AGO STILL NEEDS ITS REST MADE (Ravi, 2026-09-23: "partially order
   * ship hue jo ki production se required h nahi show ho rhe h"). #3873 was exactly this: seven lines,
   * three gone, four still to send — and one row in the Order Console, because the order had long
   * since dropped out of the fetched window and this pass only ever closed. */
  RT = {}; PTG.ob = []; SOX.rows = []; A.setMETA({});
  const halfId = 'o-half', halfDay = A.sdShift(A.sdToday(), -40);
  /* It is not on screen: the only way it can be judged is through this reach. */
  A.setSHOP({ orders: [liveOne], from: '', to: '', tz: '', at: 'x' });
  A.setMETA({ [halfId]: { lines: { 'RTC52-6090': { adj: 'ADJ-HALF', adjQty: 1, adjReason: 'Damaged',
    adjOrder: '#3873', adjOrderDate: halfDay, adjState: 'raised' } } } });
  A.renderShop();
  PRGET_REPLY = { orders: [{ id: halfId, no: '#3873', at: halfDay, ff: 'partial',
    items: [{ sku: 'RTC52-6090', name: 'sent', qty: 1, ffl: 'fulfilled', rq: 0, fq: 0, cq: 1 },
      { sku: 'RTC52-72140', name: 'still to send', qty: 1, ffl: '', rq: 0, fq: 1, cq: 1 }],
    ship: { name: 'R', country: 'US' }, total: 40, cur: 'USD' }] };
  const outHalf = await A.shpCloseShipped();
  const stillRow = 'pt_orderBook/ob_shp_SHP-3873_RTC52-72140';
  ok('a part-shipped older order is brought up to date, not skipped', outHalf.opened === 1 && outHalf.closed === 0, JSON.stringify(outHalf));
  ok('…the line still to send is opened in the Order Console', !!RT[stillRow], Object.keys(RT).join(', '));
  ok('…and the line that has gone is not asked for', !RT['pt_orderBook/ob_shp_SHP-3873_RTC52-6090'], Object.keys(RT).join(', '));

  /* A CANCELLED ORDER CLOSES TOO — but only what the ORDER asked for. A replacement raised against
   * it is a piece somebody deliberately asked for, and cancelling the order it refers to does not
   * withdraw that: only fulfilment does. So this is asked of an order line. */
  RT = {}; PTG.ob = []; SOX.rows = []; A.setMETA({});
  A.setSHOP({ orders: [liveOne], from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  PTG.ob = [{ id: 'ob_shp_SHP-2923_RTC52-6090', orderNo: 'SHP-2923', sku: 'RTC52-6090', src: 'SHP',
    qty: 1, orderDate: july, shopOrderId: 'o-july', shopOrderNo: '#2923' }];
  RT['pt_orderBook/ob_shp_SHP-2923_RTC52-6090'] = PTG.ob[0];
  ok('the line of an order nobody fetched is waiting', row in RT);
  PRGET_REPLY = { orders: [{ id: 'o-july', no: '#2923', at: july, ff: 'unfulfilled',
    cancelledAt: july, cancelReason: 'customer',
    items: [{ sku: 'RTC52-6090', name: 'x', qty: 1, ffl: 'unfulfilled', rq: 0 }],
    ship: { name: 'R', country: 'US' }, total: 20, cur: 'USD' }] };
  const out3 = await A.shpCloseShipped();
  ok('a cancelled order closes as well', out3.closed === 1 && !(row in RT), JSON.stringify(out3));

  /* Nothing outstanding means nothing to ask about — no call at all. */
  RT = {}; PTG.ob = []; SOX.rows = []; A.setMETA({}); A.renderShop();
  CALLS.prGet.length = 0;
  const out4 = await A.shpCloseShipped();
  ok('with nothing outstanding it does not call Shopify at all',
     out4.looked === 0 && CALLS.prGet.length === 0);

  PRGET_REPLY = { ok: true };
  A.setMETA({}); RT = {}; PTG.ob = []; SOX.rows = [];
}

console.log('\n== a set of 8 napkins is 8 pieces, not 2 packs × 8 ==');
{
  /* "Yaha humne 8x2 kyo kiya h jabki order qty me 1 set h, meaning 8x1, so qty should be 8." Shopify
   * sells RCNB302-8; Amazon stocks RCNB302 in packs of four, and has none. */
  A.setSTOCK({ RCNB302: 0 }); A.setINDIA({}); A.setStockLoaded(true); A.setMETA({}); A.setSKU({});
  const o = { id: 'gid-n', no: '#3500', at: '2026-08-11T10:00:00Z', ship: { name: 'B', country: 'US' },
    items: [{ sku: 'RCNB302-8', name: 'Viridian Green Border Napkins', variant: '', qty: 1, ffl: 'unfulfilled', rq: 0 }] };
  A.setSHOP({ orders: [o], from: '', to: '', tz: 'America/Los_Angeles', at: '' });
  A.soIndexNames();
  const fit = A.soPackFit('RCNB302-8');
  ok('the split is seen: 8 napkins = 2 × RCNB302 (pack of 4)', fit && fit.ok && fit.factor === 2 && fit.pack === 4, JSON.stringify(fit));
  const need = A.shpNeeds(Object.assign({}, o, A.soFlags(o, {})));
  const n = need.find(x => x.sku === 'RCNB302-8');
  ok('the need is 2 Amazon packs to send…', n && n.qty === 2, JSON.stringify(need));
  ok('…which is 8 pieces and 1 set — not 16', n && n.pcs === 8 && n.shopQty === 1, JSON.stringify(n));
  const plan = A.shpPlanOrder(o, true, 'SHP-3500');
  const row = plan.rows.find(r => r.sku === 'RCNB302-8');
  ok('the order-book row carries pieces and sets', row && row.qty === 2 && row.pcs === 8 && row.shopQty === 1, JSON.stringify(row));
  const o2 = { id: 'gid-t', no: '#3501', at: '2026-08-11T10:00:00Z', ship: { name: 'B', country: 'US' },
    items: [{ sku: 'RTC23-6060', name: 'Square Tablecloth', variant: '', qty: 3, ffl: 'unfulfilled', rq: 0 }] };
  A.setSHOP({ orders: [o, o2], from: '', to: '', tz: 'America/Los_Angeles', at: '' }); A.soIndexNames();
  const t = A.shpNeeds(Object.assign({}, o2, A.soFlags(o2, {}))).find(x => x.sku === 'RTC23-6060');
  ok('a line that is not a split keeps its own quantity as sets', t && t.qty === 3 && t.shopQty === 3, JSON.stringify(t));
  A.setSHOP({ orders: [], from: '', to: '', tz: 'America/Los_Angeles', at: '' }); A.setSTOCK({}); A.setMETA({});
}

console.log('\n== bulk update: Location, At location, Line status ==');
{
  /* "i need the bulk upload option for order update like location, at location, line status. and add
   * location bin number 3000, 4000, 5000." */
  ok('bins 3000, 4000 and 5000 are offered', ['3000', '4000', '5000'].every(b => A.SO_LOC_OPTIONS.includes(b)));

  const item = (sku, qty) => ({ sku, name: sku, variant: '', qty, ffl: 'unfulfilled', rq: 0 });
  A.setSHOP({ orders: [
    { id: 'g1', no: '#3408', at: '2026-09-05T10:00:00Z', items: [item('RPC327-1616', 2), item('RTC23-6060', 1)],
      ship: { name: 'A', country: 'US' }, total: 40, cur: 'USD' },
    { id: 'g2', no: '#3409', at: '2026-09-05T11:00:00Z', items: [item('RQL72-Q', 1)],
      ship: { name: 'B', country: 'US' }, total: 90, cur: 'USD' },
  ], from: '2026-09-01', to: '2026-09-06', tz: 'America/Los_Angeles', at: 'now' });
  A.setMETA({ g1: { lines: { 'RTC23-6060': { st: 'In cutting' } } } });
  A.setSKU({ 'RQL72-Q': { loc: 'A.1' } });
  SETS.length = 0;

  const sheet = A.soBulkSheet(A.SHOP().orders);
  ok('the update sheet has the columns it reads back',
     sheet[0].join('|') === 'Channel|Order|SKU|Product|Ordered|Location|At location|Line status', sheet[0].join('|'));
  ok('…one row per line, with what is recorded today', sheet.length === 4
     && sheet.find(r => r[2] === 'RTC23-6060')[7] === 'In cutting' && sheet.find(r => r[2] === 'RQL72-Q')[5] === 'A.1');

  const csv = [sheet[0],
    ['Shopify', '3408', 'RPC327-1616', '', 2, '3000', '1', 'Packed'],     // no "#", bin, a short count
    ['Shopify', '#3408', 'RTC23-6060', '', 1, '', '', '-'],                // clear the status, leave the rest
    ['Shopify', '#3409', 'RQL72-Q', '', 1, '4000', '', ''],                // move the bin
    ['Shopify', '#3409', 'RTC23-6060', '', 1, '5000', '', ''],             // a SKU the order does not carry
    ['Shopify', '#9999', 'RQL72-Q', '', 1, '5000', '', ''],                // an order that is not loaded
    ['Shopify', '#3408', 'RPC327-1616', '', 2, '', 'two', ''],             // not a number
  ];
  const plan = A.soBulkPlan(csv);
  ok('the file becomes a plan without changing anything', !plan.err && !A.SHOP_SKU()['RPC327-1616'], JSON.stringify(plan.err));
  ok('…two locations', plan.loc.size === 2 && plan.loc.get('RPC327-1616') === '3000' && plan.loc.get('RQL72-Q') === '4000',
     JSON.stringify([...plan.loc]));
  ok('…two order lines', plan.lines.length === 2, JSON.stringify(plan.lines));
  ok('…and three rows set aside, each with its reason', plan.skipped.length === 3
     && /RTC23-6060 is not on order 3409/.test(plan.skipped.join(' ')) && /9999 is not loaded/.test(plan.skipped.join(' '))
     && /"two" is not a whole number/.test(plan.skipped.join(' ')), plan.skipped.join(' | '));

  const msg = await A.soBulkApply(plan);
  ok('applying it says what changed', /2 location\(s\) and 2 order line\(s\)/.test(msg) && /3 row\(s\) set aside/.test(msg), msg);
  ok('the bins are saved against the SKU', A.soLocOf('RPC327-1616') === '3000' && A.soLocOf('RQL72-Q') === '4000');
  const pc = A.soLine('g1', 'RPC327-1616');
  ok('At location is recorded on that order line, with its log', pc.q === 1 && (pc.log || []).length === 1, JSON.stringify(pc));
  ok('…and the one short piece raises the adjustment, as the panel would', pc.adjQty === 1 && !!pc.adj, JSON.stringify(pc));
  ok('the line status is set', pc.st === 'Packed');
  ok('"-" clears a status', !A.soLine('g1', 'RTC23-6060').st);
  ok('the SKUs and the orders are each saved once', SETS.length === 2, SETS.map(s => s.path).join(', '));

  const again = A.soBulkPlan(csv.slice(0, 4));
  ok('the same file again changes nothing', again.loc.size === 0 && again.lines.length === 0,
     JSON.stringify({ loc: [...again.loc], lines: again.lines }));
  ok('a file without the columns is refused by name', /Order/.test(A.soBulkPlan([['SKU', 'Location'], ['X', '1']]).err));

  /* "i need dropdown for location which is already set." A CSV cannot hold one; the sheet is a .xlsx. */
  ok('the zip checksum is the standard one', A.soCrc32(new TextEncoder().encode('123456789')) === 0xCBF43926);
  A.setSKU({ 'RQL72-Q': { loc: 'SHELF-9' } });
  ok('the bin list is the standard bins and the ones in use', A.soBinList().includes('3000') && A.soBinList().includes('SHELF-9'));
  const xrows = A.soBulkSheet(A.SHOP().orders);
  const bytes = A.soBulkXlsx(xrows, A.soBinList());
  const XFILE = __dirname + '/soxlsx-check.xlsx';
  fs.writeFileSync(XFILE, bytes);

  /* Opened by a real spreadsheet library, not by the code that wrote it. */
  const py = require('child_process').spawnSync('python', ['-c', [
    'import openpyxl, json, sys',
    'wb = openpyxl.load_workbook(sys.argv[1])',
    'ws = wb["Update"]',
    'dv = [(d.type, str(d.sqref), d.formula1, d.showErrorMessage) for d in ws.data_validations.dataValidation]',
    'names = {n: wb.defined_names[n].attr_text for n in wb.defined_names}',
    'rows = [[c.value for c in r] for r in ws.iter_rows()]',
    'print(json.dumps({"sheets": wb.sheetnames, "hidden": wb["Lists"].sheet_state, "dv": dv, "names": names, "rows": rows, "bins": [c.value for c in wb["Lists"]["A"]], "freeze": ws.freeze_panes}))',
  ].join('\n'), XFILE], { encoding: 'utf8' });
  let X = null;
  try { X = JSON.parse(py.stdout); } catch (e) { /* reported below */ }
  ok('Excel\'s own format opens it', !!X, (py.stderr || '').slice(-300));
  if (X) {
    ok('…with the update sheet and a hidden list sheet', X.sheets.join() === 'Update,Lists' && X.hidden === 'hidden', JSON.stringify([X.sheets, X.hidden]));
    ok('…a dropdown on Location, drawn from the bins', X.dv.some(d => d[0] === 'list' && /^F2:F/.test(d[1]) && d[2] === 'Bins')
       && /Lists!\$A\$1:\$A\$\d+/.test(X.names.Bins), JSON.stringify([X.dv, X.names]));
    ok('…which still lets a new bin be typed', X.dv.every(d => !d[3]));
    ok('…and one on Line status', X.dv.some(d => d[0] === 'list' && /^H2:H/.test(d[1]) && d[2] === 'LineStatus'));
    ok('…the bins that are offered are the ones in use', X.bins.includes('3000') && X.bins.includes('SHELF-9') && X.bins.includes('A.1'), JSON.stringify(X.bins));
    ok('…the rows are all there, text as text and numbers as numbers',
       X.rows.length === 4 && X.rows[1][1] === '#3408' && X.rows[1][4] === 2 && X.rows[0][5] === 'Location', JSON.stringify(X.rows[1]));
    ok('…and the heading stays on screen', X.freeze === 'A2');
  }

  /* AND IT COMES BACK: read by the app's own .xlsx reader, into the same plan a CSV makes. */
  const HTML = fs.readFileSync(APP, 'utf8');
  const rs = HTML.indexOf('const PK_TD = new TextDecoder();'), re = HTML.indexOf('async function pkReadFile(file)');
  const reader = new Function(HTML.slice(rs, re) + '; return pkReadXlsx;')();
  /* Filled in the way somebody would in Excel, by editing the XML of the cell we wrote. */
  const back = await reader(bytes);
  ok('the app reads its own sheet back', back.length === 4 && back[0][5] === 'Location' && back[1][2] === 'RPC327-1616', JSON.stringify(back[1]));
  back[1][5] = '5000'; back[1][7] = 'Ready';
  const p2 = A.soBulkPlan(back);
  ok('…and a bin chosen from the dropdown becomes the update', p2.loc.get('RPC327-1616') === '5000'
     && p2.lines.some(l => l.sku === 'RPC327-1616' && l.st === 'Ready'), JSON.stringify({ loc: [...p2.loc], lines: p2.lines }));

  A.setSHOP({ orders: [], from: '', to: '', tz: 'America/Los_Angeles', at: '' }); A.setMETA({}); A.setSKU({});
}


console.log('\n== a filter on this screen must not decide what production hears about ==');
{
  /* Ravi, 18 Sep: "my team not seeing cpc shopify orders on their access, jis par ridhi shopify
   * chal rha h."
   *
   * The Order Console's Shopify views read the ORDER BOOK, not the live feed — an order appears
   * there once a production order has been opened for it. shpPlanAll opens those from SO_ALL_ROWS,
   * which is DECLARED as "every order mapped, before any filter" and, until now, was assigned after
   * the shops picker and the day picker had already thinned it.
   *
   * So somebody with "Shopify" ticked — a filter set before CPC existed — was running a sync that
   * could not see CPC at all, and the team saw Ridhi and nothing else. */
  RT = {}; PTG.ob = []; SOX.rows = []; A.setMETA({});
  const day = A.sdShift(A.sdToday(), -1) + 'T10:00:00Z';
  const line = sku => [{ sku, name: 'x', qty: 1, ffl: 'unfulfilled', rq: 0 }];
  A.setSHOP({ orders: [
    { id: 'r1', no: '#7001', at: day, items: line('RTCR0009-90'), ship: { name: 'R', country: 'US' },
      total: 35, cur: 'USD', channel: 'Shopify' },
    { id: 'c1', no: '#7002', at: day, items: line('RTC52-6090'), ship: { name: 'C', country: 'US' },
      total: 40, cur: 'USD', channel: 'CPC Shopify' },
  ], from: '', to: '', tz: '', at: 'x' });

  /* Only Ridhi ticked — exactly what a picker set up before the second store existed looks like. */
  msSet('soChan', ['Shopify']);
  A.renderShop();

  const all = A.SO_ALL_ROWS();
  ok('the filtered screen draws only the store that is ticked',
    /7001/.test(els.soTable.innerHTML) && !/7002/.test(els.soTable.innerHTML));
  ok('…but both orders are still kept, because the filter is about what is DRAWN',
    all.length === 2 && all.some(r => r.id === 'c1'), JSON.stringify(all.map(r => r.id)));

  await A.shpSyncAll({ force: true });
  ok('…so the CPC order still opens a production order',
    !!RT['pt_orderBook/ob_shp_SHP-7002_RTC52-6090'], Object.keys(RT).join(', '));
  ok('…and so does the Ridhi one', !!RT['pt_orderBook/ob_shp_SHP-7001_RTCR0009-90']);

  /* The same for the day picker, which hid anything not placed today. */
  RT = {}; PTG.ob = []; SOX.rows = [];
  msSet('soChan', []);
  els.soDay.value = '0';                 // placed today — and both of these were placed yesterday
  A.renderShop();
  ok('a day picker hides the rows but keeps the orders',
    A.SO_ALL_ROWS().length === 2, JSON.stringify(A.SO_ALL_ROWS().map(r => r.id)));
  await A.shpSyncAll({ force: true });
  ok('…so yesterday’s orders still reach production',
    !!RT['pt_orderBook/ob_shp_SHP-7002_RTC52-6090'] && !!RT['pt_orderBook/ob_shp_SHP-7001_RTCR0009-90'],
    Object.keys(RT).join(', '));

  els.soDay.value = '';
  RT = {}; PTG.ob = []; SOX.rows = [];
}


console.log('\n== a line with no SKU is refused OUT LOUD, not dropped ==');
{
  /* Ravi, 18 Sep: "CPC Shopify production order open nahi ho rhe h."
   *
   * 89 of CPC's 276 unfulfilled lines have no SKU on the Shopify variant, and 52 CPC orders have no
   * coded line at all. shpNeeds refused them with the same silent `return` it uses for a line that
   * is owed nothing — so those orders opened nothing and said nothing about why.
   *
   * Nothing here invents a code. A production order against a guess is worse than none. It says
   * which product, so the fix can be made where it belongs: on the variant, in Shopify. */
  RT = {}; PTG.ob = []; SOX.rows = []; A.setMETA({});
  const day = A.sdShift(A.sdToday(), -1) + 'T10:00:00Z';
  A.setSHOP({ orders: [
    /* Everything coded — opens as it always did. */
    { id: 'n1', no: '#8001', at: day, ship: { name: 'A', country: 'US' }, total: 10, cur: 'USD',
      items: [{ sku: 'RTCR0009-90', name: 'Quilt', qty: 1, ffl: 'unfulfilled', rq: 0 }] },
    /* One coded line and one without — the coded half must still open. */
    { id: 'n2', no: '#8002', at: day, ship: { name: 'B', country: 'US' }, total: 20, cur: 'USD',
      items: [{ sku: 'RTC52-6090', name: 'Tablecloth', qty: 1, ffl: 'unfulfilled', rq: 0 },
        { sku: '', name: 'Ruffle Tablecloth - Apatite Blue', variant: '54" X 54"', qty: 2, ffl: 'unfulfilled', rq: 0 }] },
    /* Nothing coded at all — this is the CPC order that opened nothing and explained nothing. */
    { id: 'n3', no: '#8003', at: day, ship: { name: 'C', country: 'US' }, total: 30, cur: 'USD',
      items: [{ sku: '', name: 'Cotton Block Print Tablecloth – Autumn Vine', variant: '60" x 120"', qty: 1, ffl: 'unfulfilled', rq: 0 }] },
    /* A line owed NOTHING — refunded in full. It must be ignored in silence: there is nothing to
     * make and nothing anybody needs to fix. */
    { id: 'n4', no: '#8004', at: day, ship: { name: 'D', country: 'US' }, total: 40, cur: 'USD',
      items: [{ sku: '', name: 'Refunded thing', qty: 2, ffl: 'unfulfilled', rq: 2 }] },
    /* And one refused for a DIFFERENT reason: a dot cannot be a key in the production database. */
    { id: 'n5', no: '#8005', at: day, ship: { name: 'E', country: 'US' }, total: 50, cur: 'USD',
      items: [{ sku: 'BAD.SKU', name: 'Dotted code', qty: 1, ffl: 'unfulfilled', rq: 0 }] },
  ], from: '', to: '', tz: '', at: 'x' });
  A.renderShop();

  /* ---- what shpNeeds itself now hands back ---- */
  const o2 = A.SO_ALL_ROWS().find(r => r.id === 'n2');
  const noSku = [];
  /* shpNeeds hands back a LIST — it builds a Map inside and returns its values. */
  const want = A.shpNeeds(o2, noSku);
  ok('the coded line is still wanted', want.length === 1 && want[0].sku === 'RTC52-6090',
    JSON.stringify(want.map(w => w.sku)));
  /* Read through a guard: break the fix and this FAILS rather than taking the suite with it. */
  ok('…and the codeless one is handed back rather than dropped',
    noSku.length === 1 && /Apatite Blue/.test((noSku[0] || {}).name || ''), JSON.stringify(noSku));
  ok('…with the variant in the name, which is what finds it in Shopify',
    /54" X 54"/.test((noSku[0] || {}).name || ''), String((noSku[0] || {}).name));
  /* Nobody passing the array still gets the old behaviour, which is what every other caller wants. */
  ok('a caller that does not ask for them is unaffected', A.shpNeeds(o2).length === 1);

  /* ---- and what the sync does with them ---- */
  const t = await A.shpSyncAll({ force: true });
  ok('the fully coded order opens', !!RT['pt_orderBook/ob_shp_SHP-8001_RTCR0009-90']);
  ok('the half-coded order opens its coded half', !!RT['pt_orderBook/ob_shp_SHP-8002_RTC52-6090']);
  ok('NOTHING is invented for a line with no code',
    !Object.keys(RT).some(k => /SHP-8003/.test(k)), Object.keys(RT).join(', '));
  ok('all three codeless lines are reported, by product',
    t.skipped.filter(s => s.sku === '(no code)').length === 2,
    JSON.stringify(t.skipped.map(s => s.why)));
  ok('…naming the product and saying where the fix is',
    t.skipped.some(s => /Autumn Vine/.test(s.why) && /set it in Shopify/.test(s.why)),
    JSON.stringify(t.skipped.map(s => s.why)));

  /* A LINE OWED NOTHING IS NOT A PROBLEM. Refunded in full, so there is nothing to make — and it
   * must not be reported as a missing code, or the list of things to fix fills up with things that
   * are not broken. */
  const refunded = A.SO_ALL_ROWS().find(r => r.id === 'n4');
  const noSku4 = [];
  const want4 = A.shpNeeds(refunded, noSku4);
  ok('a line refunded in full is wanted by nobody', want4.length === 0, JSON.stringify(want4));
  ok('…and is not reported as a missing code either', noSku4.length === 0, JSON.stringify(noSku4));

  /* AN ADJUSTMENT FOR NOUGHT PIECES. adjQty comes off the order's own meta and can be zero;
   * without the guard it becomes a production order for nothing at all. */
  A.setMETA(Object.assign({}, A.SHOP_META(), { n1: { lines: {
    'RTCR0009-90': { adj: 'ADJ-ZERO', adjQty: 0, adjReason: 'typed down to nothing', adjState: 'raised' } } } }));
  const zeroAdj = A.SO_ALL_ROWS().find(r => r.id === 'n1');
  const wantZero = A.shpNeeds(zeroAdj).filter(w => w.adjId === 'ADJ-ZERO');
  ok('an adjustment for nought pieces asks for nothing', wantZero.length === 0,
    JSON.stringify(A.shpNeeds(zeroAdj).map(w => [w.sku, w.qty, w.adjId])));
  A.setMETA({});
  /* And a refusal for another reason is still named on its own. */
  ok('a SKU the database cannot key is still refused by name',
    t.skipped.some(s => s.sku === 'BAD.SKU'), JSON.stringify(t.skipped.map(s => s.sku)));

  const msg = A.shpSyncMsg(t);
  ok('the message says how many and what to do about it',
    /NO SKU on the Shopify variant/.test(msg) && /Set the SKU on the product in Shopify/.test(msg), msg);
  ok('…and it still reports what DID open', /in the Order Console/.test(msg), msg);
  ok('…and names the other refusal separately from the codeless ones',
    /BAD.SKU/.test(msg) && /could not be ordered/.test(msg), msg);

  RT = {}; PTG.ob = []; SOX.rows = [];
}

console.log('\n== a codeless line is found by its title ==');
{
  /* Ravi, 2026-09-23, on CPC #6571: "title me 3 things h subtype color and size but size me yaha "
   * sign h to iske basis par masterdata me sku mil jayega".
   *
   * The real line and the real master row, both verbatim from live:
   *   Shopify: name "Ruffle Tablecloth - Agate Green" · variant '52" X 70"' · sku ""
   *   master:  CPCRU005-5270 · Tablecloth · Ruffle Rectangular Tablecloth · Agate Green · 52x70
   * Note the shop says "Ruffle Tablecloth" and the master says "Ruffle RECTANGULAR Tablecloth", so
   * the subtype is not what can be matched on. Colour and size are. */
  const mdb = [
    { sku: 'CPCRU005-5270', articleType: 'Tablecloth', subtype: 'Ruffle Rectangular Tablecloth', color: 'Agate Green', size: '52x70' },
    { sku: 'CPCRU005-6', articleType: 'Tablecloth', subtype: 'Ruffle Rectangular Tablecloth', color: 'Agate Green', size: '60x90' },
    { sku: 'CPCCRU005', articleType: 'Pillow Cover', subtype: 'Ruffle Pillow Cover', color: 'Agate Green', size: '20x20' },
    { sku: 'CPCRU009-5270', articleType: 'Tablecloth', subtype: 'Ruffle Rectangular Tablecloth', color: 'Sage Green', size: '52x70' },
  ];
  const wasPTG = PTG.mdb;
  PTG.mdb = mdb;

  ok('the inch marks come off and the × becomes an x', A.shpWords('52" X 70"') === '52x70', A.shpWords('52" X 70"'));
  ok('…and a tissue box keeps its halves', A.shpWords('5x4.5x5') === '5x4.5x5', A.shpWords('5x4.5x5'));

  const hit = A.shpSkuFromTitle('Ruffle Tablecloth - Agate Green', '52" X 70"');
  ok('the line Ravi showed finds its SKU', !!hit && hit.sku === 'CPCRU005-5270', JSON.stringify(hit && hit.sku));

  /* THE SIZE IS WHAT PINS IT. The same product in another size is a different SKU, and guessing
   * between them would put the wrong thing on the floor. */
  ok('another size of the same product is not mistaken for it',
     (A.shpSkuFromTitle('Ruffle Tablecloth - Agate Green', '60" X 90"') || {}).sku === 'CPCRU005-6');
  ok('a size nobody makes matches nothing', A.shpSkuFromTitle('Ruffle Tablecloth - Agate Green', '99" X 99"') === null);
  ok('a colour nobody has matches nothing', A.shpSkuFromTitle('Ruffle Tablecloth - Aubergine', '52" X 70"') === null);
  /* Colour and size alone are not enough: a pillow cover and a tablecloth can share both. */
  ok('the product type still has to agree', A.shpSkuFromTitle('Napkin - Agate Green', '52" X 70"') === null);
  ok('…and a pillow cover in the same colour finds the pillow cover',
     (A.shpSkuFromTitle('Ruffle Pillow Cover - Agate Green', '20" X 20"') || {}).sku === 'CPCCRU005');

  /* WHAT IT IS HAS TO AGREE IN FULL, and these two are why. Both were matched by the first, looser
   * rule on live orders, and both were wrong. */
  PTG.mdb = mdb.concat([
    { sku: 'WCWRC0001-2036', articleType: 'Pillow Cover', subtype: 'Ruffle Pillow Cover', color: 'White', size: '20x36' },
    { sku: 'CPCRU008-60120', articleType: 'Tablecloth', subtype: 'Ruffle Rectangular Tablecloth', color: 'Pink Sapphire', size: '60x120' },
  ]);
  ok('a bed pillow INSERT is not matched to a ruffle pillow COVER',
     A.shpSkuFromTitle('White Bed Pillow Insert - Twin/Queen/King', 'King 20x36 in (51 x 91 Cm) / Set of 2') === null);
  ok('a plain tablecloth is not matched to a RUFFLE one',
     A.shpSkuFromTitle('Cotton Block Print Tablecloth – Pink Sapphire', '60" x 120"') === null);
  /* But the shape word the shop leaves out is forgiven — the size already says which it is. */
  ok('…while "Rectangular", which the shop never writes, is not held against it',
     (A.shpSkuFromTitle('Cotton Block Print Tablecloth – Agate Green', '52" X 70"') || {}) !== null);
  /* And one plural, because the shop writes Napkins and the master writes Napkin. */
  PTG.mdb = mdb.concat([{ sku: 'CPCNE043', articleType: 'Napkin', subtype: 'Embroidery Napkin', color: 'Autumn Vine', size: '18x18' }]);
  ok('"Napkins" finds "Napkin"',
     (A.shpSkuFromTitle('Cotton Embroidery Napkins - Autumn Vine', '18 x 18 in / Set of 12') || {}).sku === 'CPCNE043');
  PTG.mdb = mdb;

  /* THE TITLE SAYS RUFFLE AND THE CANDIDATE IS NOT ONE (Ravi, 2026-09-24, on SHP-6020). The line,
   * verbatim from the shop: name "Ruffle Tablecloth - Yellow Citrine" · variant "54X54" · sku "".
   * It was matched to CPC014-5454, a plain Square Tablecloth, because the old rule only checked
   * that the MASTER's words were in the title and "square" is a shape the shop leaves out. Nothing
   * asked whether the TITLE said something the candidate does not have. */
  PTG.mdb = mdb.concat([
    { sku: 'CPC014-5454', articleType: 'Tablecloth', subtype: 'Square Tablecloth', color: 'Yellow Citrine', size: '54x54' },
    /* The vocabulary is learned from the catalogue, so "ruffle" only counts as a word about the
     * product because some subtype somewhere uses it — as these do. */
    { sku: 'CPCRU014-6060', articleType: 'Tablecloth', subtype: 'Ruffle Square Tablecloth', color: 'Yellow Citrine', size: '60x60' },
  ]);
  ok('a RUFFLE title does not match a plain product', A.shpSkuFromTitle('Ruffle Tablecloth - Yellow Citrine', '54X54') === null);
  ok('…and the plain title still matches the plain product',
     (A.shpSkuFromTitle('Cotton Block Print Tablecloth - Yellow Citrine', '54X54') || {}).sku === 'CPC014-5454');
  ok('…while the ruffle in a size that EXISTS is found',
     (A.shpSkuFromTitle('Ruffle Tablecloth - Yellow Citrine', '60X60') || {}).sku === 'CPCRU014-6060');
  /* AND A WORD THAT NAMES NO ALTERNATIVE OF THE SAME KIND OBJECTS TO NOTHING. "Set" is in one
   * subtype somewhere — an oven mitt and pot holder set — and "Set of 12" in a napkin's variant is
   * a pack size, not a claim about what the product is. Reading it as one stopped three real napkin
   * orders from opening. */
  PTG.mdb = mdb.concat([
    { sku: 'CPCNE043', articleType: 'Napkin', subtype: 'Embroidery Napkin', color: 'Autumn Vine', size: '18x18' },
    { sku: 'MITT-1', articleType: 'Kitchen', subtype: 'Oven Mitts and Pot Holder Set', color: 'Autumn Vine', size: '7x12' },
  ]);
  ok('"Set of 12" is a pack size, not a product',
     (A.shpSkuFromTitle('Cotton Embroidery Napkins - Autumn Vine', '18 x 18 in / Set of 12') || {}).sku === 'CPCNE043');
  ok('…and a material the catalogue never names is not one either',
     (A.shpSkuFromTitle('Cotton Embroidery Napkins - Autumn Vine', '18 x 18 in') || {}).sku === 'CPCNE043');
  PTG.mdb = mdb;

  /* A word in the COLOUR is not a claim about the product. */
  PTG.mdb = mdb.concat([{ sku: 'CPCX-1818', articleType: 'Pillow Cover', subtype: 'Piping Pillow Cover', color: 'Apricot Rosette Vine', size: '18x18' },
    { sku: 'CPCV-2020', articleType: 'Tablecloth', subtype: 'Vine Tablecloth', color: 'Blue', size: '20x20' }]);
  ok('a colour that happens to contain a product word is not read as one',
     (A.shpSkuFromTitle('Piping Pillow Cover - Apricot Rosette Vine', '18X18') || {}).sku === 'CPCX-1818');
  PTG.mdb = mdb;

  /* TWO ROWS EQUALLY GOOD IS A QUESTION, NOT A MATCH. */
  PTG.mdb = mdb.concat([{ sku: 'OTHER-5270', articleType: 'Tablecloth', subtype: 'Ruffle Round Tablecloth', color: 'Agate Green', size: '52x70' }]);
  ok('two products that fit equally well match nothing at all',
     A.shpSkuFromTitle('Ruffle Tablecloth - Agate Green', '52" X 70"') === null);
  PTG.mdb = mdb;

  /* AND IT REACHES THE ORDER BOOK — with a mark saying where the code came from. */
  const order = { id: 'o-title', no: '#6571', at: A.sdShift(A.sdToday(), -16) + 'T10:00:00Z', ff: '',
    items: [{ sku: '', name: 'Ruffle Tablecloth - Agate Green', variant: '52" X 70"', qty: 1, fq: 1, cq: 1 }],
    ship: { name: 'A buyer', country: 'US' }, total: 55.99, cur: 'USD' };
  const want = A.shpNeeds(order, []);
  ok('the sync now asks production for it', want.length === 1 && want[0].sku === 'CPCRU005-5270', JSON.stringify(want));
  ok('…and records that the code came from the title', !!want[0].viaTitle && want[0].why.join(' ').indexOf('by its title') >= 0,
     JSON.stringify(want[0].why));
  const plan = A.shpPlanOrder(order, true);
  const row = plan.rows[0];
  ok('the production row is written under the code that was found',
     !!row && row.sku === 'CPCRU005-5270' && row.titleMatch === true, JSON.stringify(row && { sku: row.sku, titleMatch: row.titleMatch }));
  ok('…and it carries the article, colour and size off that master row',
     !!row && row.articleType === 'Tablecloth' && row.color === 'Agate Green' && row.size === '52x70',
     JSON.stringify(row && { a: row.articleType, c: row.color, s: row.size }));

  /* The screen says where the code came from, rather than pretending Shopify sent it. */
  const wasShop = A.SHOP();
  A.setSHOP({ orders: [order], from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  ok('the row says the SKU was worked out from the title', /SKU from the title: CPCRU005-5270/.test(els.soTable.innerHTML),
     els.soTable.innerHTML.slice(0, 200));
  A.setSHOP(wasShop);
  PTG.mdb = wasPTG;
}
console.log('\n== a line with no SKU says so on its own row ==');
{
  /* CPC #6571, 2026-09-23: "Need from production" on the screen and nothing in the Order Console.
   * The backend's answer for it was `line: (no sku) · Ruffle Tablecloth - Agate Green · qty 1` —
   * the Shopify variant has no SKU, and a production row is keyed on one. The sync has always named
   * such a line and skipped it; it said so only in the summary line for the whole run. */
  const was = { shop: A.SHOP(), meta: A.SHOP_META() };
  const order = { id: 'o-nosku', no: '#6571', at: A.sdShift(A.sdToday(), -16) + 'T10:00:00Z', ff: '',
    items: [{ sku: '', name: 'Ruffle Tablecloth - Agate Green', qty: 1, fq: 1, cq: 1 },
      { sku: 'RTC52-6090', name: 'has a code', qty: 2, fq: 2, cq: 2 }],
    ship: { name: 'A buyer', country: 'US' }, total: 40, cur: 'USD' };
  A.setSHOP({ orders: [order], from: '', to: '', tz: '', at: 'x' });
  A.setMETA({});
  const rows = A.soRows();
  const r = rows.find(x => x.id === 'o-nosku');
  ok('the row knows which of its lines have no code', !!r && (r.noSku || []).length === 1, JSON.stringify(r && r.noSku));
  ok('…and it names the product, which is how somebody finds it in Shopify',
     !!r && r.noSku[0] === 'Ruffle Tablecloth - Agate Green', JSON.stringify(r && r.noSku));
  A.renderShop();
  const html = els.soTable.innerHTML;
  ok('the row says it on screen, where "Need from production" is',
     /have no SKU — cannot open/.test(html), html.slice(0, 200));
  /* AND THE SYNC REALLY DOES SKIP IT — the row is not just a warning, it is the truth. */
  const plan = A.shpPlanOrder(order, true);
  ok('the sync opens the line that has a code', Object.keys(plan.patch).some(k => k.indexOf('RTC52-6090') >= 0),
     JSON.stringify(Object.keys(plan.patch)));
  ok('…and refuses the one that has none, by name',
     plan.skipped.some(x => /no SKU on its Shopify variant/.test(x.why) && /Agate Green/.test(x.why)),
     JSON.stringify(plan.skipped));
  /* A line nobody is waiting for is not worth a warning: only what is still live counts. */
  A.setSHOP({ orders: [Object.assign({}, order, { items: [{ sku: '', name: 'gone', qty: 1, fq: 0, cq: 0, rq: 1 }] })], from: '', to: '', tz: '', at: 'x' });
  const r2 = A.soRows().find(x => x.id === 'o-nosku');
  ok('a codeless line that is refunded or removed raises nothing', !!r2 && (r2.noSku || []).length === 0, JSON.stringify(r2 && r2.noSku));
  A.setSHOP(was.shop); A.setMETA(was.meta);
}
console.log('\n== an ask that arrives mid-sync is kept, not dropped ==');
{
  /* Ravi, 2026-09-23: a CPC order read "Need from production" and no production order opened.
   *
   * Opening the tab starts two things that both call the sync: the India stock read and the order
   * fetch. Coming back to a tab that already had orders, India lands first, so a sync runs over the
   * OLD list — and the call carrying the NEWLY fetched orders arrives while that one is still
   * running. It used to be dropped on the floor, and those orders were never judged. */
  let runs = 0;
  const realAll = A.shpSyncAll;
  const was = { busy: A.SHP_BUSY(), again: A.SHP_AGAIN() };
  ok('nothing is running to begin with', was.busy === false && was.again === null, JSON.stringify(was));

  /* A sync that takes a moment, so a second ask genuinely lands inside it. */
  A.setSyncAll(async () => { runs++; await new Promise(r => setTimeout(r, 20)); return { written: 0, removed: 0, kept: [], skipped: [], custom: [], err: '' }; });
  const first = A.shpSyncSoon();
  const second = A.shpSyncSoon();          // arrives while the first is still going
  ok('the second ask is remembered rather than thrown away', A.SHP_AGAIN() !== null, String(A.SHP_AGAIN()));
  await first; await second;
  ok('…and it runs once the first finishes, so the new orders are judged', runs === 2, 'runs=' + runs);
  ok('…and nothing is left queued behind it', A.SHP_AGAIN() === null && A.SHP_BUSY() === false,
     JSON.stringify({ again: A.SHP_AGAIN(), busy: A.SHP_BUSY() }));

  /* A third ask during the second run queues itself once — it does not stack into a loop. */
  runs = 0;
  let inner = null;
  A.setSyncAll(async () => { runs++; if (runs === 1) { inner = A.shpSyncSoon(); } await new Promise(r => setTimeout(r, 5)); return { written: 0, removed: 0, kept: [], skipped: [], custom: [], err: '' }; });
  await A.shpSyncSoon();
  if (inner) await inner;
  ok('an ask made from inside a run is honoured exactly once', runs === 2, 'runs=' + runs);
  A.setSyncAll(realAll);
}
console.log('\n== MCF: one parcel for what the chosen account holds ==');
{
  /* Ravi, 2026-09-24: "4 line item me order h and 1 hi mcf me pada h then m chahta hu wo 1 hi mcf ho
   * jay, baki mcf me nahi h wo n ho" — and the raw "SellerSKU is invalid" that made the app look fake.
   * Stock stubs: Ridhi holds RCNBMIX 40 and RTC301-6090 5; CPC holds RCNBmix 12. */
  A.setSTOCK({}); A.setSTOCKCASE({}); A.setMETA({}); A.setSKU({});
  await A.loadShopStock();
  const o = { id: 'gid-M1', no: '#M1', at: '2026-09-24', ship: {}, items: [
    { sku: 'RCNBMIX', name: 'Napkins', qty: 2 },
    { sku: 'RTC301-6090', name: 'Tablecloth', qty: 1 },
    { sku: 'RTCPR241-60', name: 'Runner', qty: 1 },
    { sku: '', name: 'Tablecloth with no code', qty: 1 }] };
  const sp = A.soMcfPlan(o, 'SP');
  ok('Ridhi ships the two lines it holds, and not the other two',
     sp.send.map(x => x.shop).join(',') === 'RCNBMIX,RTC301-6090' && sp.out.length === 2, JSON.stringify(sp.send.map(x => x.shop)));
  ok('…and says why each of the others stays out',
     sp.out.some(x => /not in Ridhi FBA/.test(x.why)) && sp.out.some(x => /no SKU/.test(x.why)), JSON.stringify(sp.out.map(x => x.why)));
  const cpc = A.soMcfPlan(o, 'CPC');
  ok('CPC holds only the napkins — a SKU stocked only on Ridhi is not claimed for CPC',
     cpc.send.map(x => x.shop).join(',') === 'RCNBMIX' && cpc.out.some(x => x.label === 'RTC301-6090' && /not in CPC FBA/.test(x.why)),
     JSON.stringify({ send: cpc.send.map(x => x.shop), out: cpc.out.map(x => x.label + ':' + x.why) }));
  ok('the account that can ship the most lines is chosen', A.soBestBrand(o) === 'SP');
  $('soMcfBrand').value = 'SP';
  const pay = A.soMcfPayload(o);
  ok('the parcel carries only those lines', pay.items.length === 2 && pay.items[0].qty === 2, JSON.stringify(pay.items));
  $('soMcfBrand').value = 'CPC';
  ok('…in the spelling of the account that ships it', A.soMcfPayload(o).items.map(x => x.sku).join(',') === 'RCNBmix',
     JSON.stringify(A.soMcfPayload(o).items));
  const big = Object.assign({}, o, { id: 'gid-M2', items: [{ sku: 'RCNBMIX', name: 'Napkins', qty: 20 }] });
  ok('a line the account holds too few of is left out, with the count', A.soMcfPlan(big, 'CPC').send.length === 0
     && /only 12 in CPC FBA, need 20/.test(A.soMcfPlan(big, 'CPC').out[0].why));

  /* After sending: only the lines in the parcel read "MCF done". */
  A.setMETA({ 'gid-M1': { mcfId: 'SHOP-M1', mcfSkus: ['RCNBMIX', 'RTC301-6090'] } });
  ok('a line in the parcel reads MCF done', A.soLineState(o, o.items[0]).v === 'sent');
  ok('…a line left out does not', A.soLineState(o, o.items[2]).v !== 'sent', A.soLineState(o, o.items[2]).v);
  ok('…and nothing already sent is offered again', A.soMcfPlan(o, 'SP').send.length === 0);
  A.setMETA({ 'gid-M1': { mcfId: 'OLD-M1' } });
  ok('an order sent before lines were recorded counts as sent whole', A.soLineState(o, o.items[2]).v === 'sent');
  A.setMETA({});

  /* The error, in words. */
  const raw = 'SP-API 400 on /fba/outbound/2020-07-01/fulfillmentOrders/preview :: {"errors":[{"code":"InvalidInput","message":"1 error(s) is/are present: the SellerSKU is invalid.","details":""}]}';
  const m = A.mcfErr(new Error(raw), 'Could not check speeds', { acct: 'Ridhi', skus: ['RTC354-6060'] });
  ok('an unknown SKU is said in words, and the SKU is named', /Amazon does not recognise this SKU on the Ridhi account/.test(m) && /RTC354-6060/.test(m), m);
  ok('…Amazon\'s own text is kept, under Technical detail', /<details class="mcf-raw"><summary>Technical detail<\/summary>/.test(m) && m.indexOf('SP-API 400') > m.indexOf('<details'));
  ok('…and it does not lead with it', m.indexOf('SP-API') > m.indexOf('Amazon does not recognise'));
  ok('a busy Amazon says so', /Amazon is busy/.test(A.mcfErr(new Error('SP-API 429 QuotaExceeded'), 'Could not send', {})));
}
console.log('\n== Order panel, design 1 (wide sheet, tidied) ==');
{
  /* Ravi picked design 1 on 2026-09-24: order number and Shopify state in one header, the lines in one
   * box, Amazon and the order's status side by side, the count and the buttons at the foot. */
  A.setSTOCK({}); A.setSTOCKCASE({}); A.setMETA({}); A.setSKU({});
  await A.loadShopStock();
  const o = { id: 'gid-D1', no: '#D1', at: '2026-09-24 10:12', ship: { name: 'Tracy Hogan', city: 'Austin' }, ff: 'unfulfilled', trk: [], items: [
    { sku: 'RCNBMIX', name: 'Napkins', qty: 2 },
    { sku: 'RTC301-6090', name: 'Tablecloth', qty: 1 },
    { sku: 'RTCPR241-60', name: 'Runner', qty: 1 },
    { sku: '', name: 'Tablecloth with no code', qty: 1 }] };
  A.setSHOP({ orders: [o], from: '', to: '', tz: 'America/Los_Angeles', at: '' });
  A.openShopOrder('gid-D1');
  ok('the header reads "Order #D1", the date moves to the line under it', els.soTitle.textContent === 'Order #D1' && /2026-09-24 10:12/.test(els.soSub.textContent), els.soTitle.textContent + ' | ' + els.soSub.textContent);
  ok('…with Shopify\'s state beside it, and no tracking said as a chip', /No tracking yet/.test(els.soFf.innerHTML), els.soFf.innerHTML);
  ok('the foot counts lines and pieces', els.soFootSum.textContent === '4 lines · 5 pcs', els.soFootSum.textContent);
  const seg = els.soMcfSeg.innerHTML;
  ok('the account is said, not offered: a Ridhi order ships from Ridhi', /From Ridhi FBA/.test(seg) && !/CPC/.test(seg) && !/<button/.test(seg), seg);
  ok('the worked-out column is called Route, so it is not read as Line status twice', /<th[^>]*>Route<\/th>/.test(els.soItems.innerHTML));
  const html = fs.readFileSync(APP, 'utf8');
  ok('the × closes like Close does', /\$\('soX'\)\.onclick = \(\) => \$\('soCancel'\)\.onclick\(\);/.test(html));
  ok('the account select is still there for everything that reads it', /<select id="soMcfBrand" class="hide"/.test(html));
  A.setMETA({});
}
console.log('\n== an order sees only its own Amazon account ==');
{
  /* Ravi, 2026-09-24: "ridhi ke order me only ridhi dikhna chahiye and cpc ke cpc — don't show ridhi cpc in
   * ridhi order". Stock stubs: Ridhi holds RCNBMIX 40 and RTC301-6090 5; CPC holds RCNBmix 12. */
  A.setSTOCK({}); A.setSTOCKCASE({}); A.setMETA({}); A.setSKU({});
  await A.loadShopStock();
  const items = [{ sku: 'RCNBMIX', name: 'Napkins', qty: 2 }, { sku: 'RTC301-6090', name: 'Tablecloth', qty: 1 }];
  const rid = { id: 'gid-R1', no: '#R1', at: '2026-09-24', ship: {}, ff: 'unfulfilled', trk: [], items };
  const cpc = { id: 'gid-C1', no: '#C1', at: '2026-09-24', ship: {}, ff: 'unfulfilled', trk: [], shopBrand: 'CPC', items };
  A.setSHOP({ orders: [rid, cpc], from: '', to: '', tz: 'America/Los_Angeles', at: '' });

  A.openShopOrder('gid-R1');
  let h = els.soItems.innerHTML;
  ok('a Ridhi order ships from Ridhi', els.soMcfBrand.value === 'SP');
  ok('…its FBA column is Ridhi\'s, and CPC is not on it', /Ridhi FBA<\/th>/.test(h) && !/CPC/.test(h), h.match(/<th[^>]*>[^<]*FBA<\/th>/g));
  ok('…showing Ridhi\'s own figure', /st-approved">40</.test(h));

  A.openShopOrder('gid-C1');
  h = els.soItems.innerHTML;
  ok('a CPC order ships from CPC', els.soMcfBrand.value === 'CPC' && /From CPC FBA/.test(els.soMcfSeg.innerHTML));
  ok('…its FBA column is CPC\'s, and Ridhi is not on it', /CPC FBA<\/th>/.test(h) && !/Ridhi/.test(h));
  ok('…a SKU only Ridhi holds reads "not in FBA" on a CPC order', (h.match(/<td class="num"><span class="muted">not in FBA<\/span><\/td>/g) || []).length === 1, h.match(/st-[a-z]+">[^<]*<|not in FBA/g));
  ok('…and its plan ships only what CPC holds', /Sends<\/em><span>RCNBMIX × 2</.test(els.soMcfBox.innerHTML) && /not in CPC FBA/.test(els.soMcfBox.innerHTML), els.soMcfBox.innerHTML);
  ok('…with no pointer to the other account', !/Ridhi/.test(els.soMcfBox.innerHTML));

  ok('the order route is judged on its own account: the CPC order is only part-filled by FBA', A.soMcf(cpc).v === 'part' && A.soMcf(rid).v === 'yes', A.soMcf(cpc).v + ' / ' + A.soMcf(rid).v);
  ok('…and the line CPC lacks is not "FBA ready" there', A.soLineState(cpc, items[1]).v !== 'fba' && A.soLineState(rid, items[1]).v === 'fba');

  /* NOTHING TO SEND is one sentence, and no big disabled button (Ravi, 2026-09-24: keep design 1, less clutter). */
  const none = { id: 'gid-C2', no: '#C2', at: '2026-09-24', ship: {}, ff: 'unfulfilled', trk: [], shopBrand: 'CPC', items: [items[1]] };
  A.setSHOP({ orders: [rid, cpc, none], from: '', to: '', tz: 'America/Los_Angeles', at: '' });
  A.openShopOrder('gid-C2');
  ok('an order CPC holds none of says so in one line', /CPC FBA holds none of these lines — nothing to send to Amazon/.test(els.soMcfBox.innerHTML) && !/Stays out/.test(els.soMcfBox.innerHTML), els.soMcfBox.innerHTML);
  ok('…and the Check button is not shown', els.soMcfPreview.classList.contains('hide'));
  A.openShopOrder('gid-C1');
  ok('an order that can send shows the button again', !els.soMcfPreview.classList.contains('hide'));
  const src = fs.readFileSync(APP, 'utf8');
  ok('other sizes: two named and the rest counted, in a cell that wraps — no long line pushing the panel sideways',
     !/this size is out · /.test(src) && /alts\.slice\(0, 2\)/.test(src) && /td\.so-route\{white-space:normal/.test(src));
  A.setMETA({ 'gid-C1': { mcfId: 'SHOP-C1', mcfBrand: 'SP' } });
  A.openShopOrder('gid-C1');
  ok('an order already sent keeps the account it went on, so its status is asked there', els.soMcfBrand.value === 'SP');
  A.setMETA({});
}
console.log('\n== THE PRODUCTION BUCKET (Ravi, 2026-09-26) ==');
{
  /* "jo shopify ke order production se required rahe pahle wo ek bucket me aay then us bucket me se me manually
   * production order open kar saku … koi duplicate order open n ho". */
  RT = {}; PTG.ob = []; SOX.rows = []; WORK = {}; PATCHES.length = 0;
  PTG.mdb = [{ sku: 'RCNBMIX', articleType: 'Napkin', subtype: 'Plain', color: 'Blue', size: '20x20' },
             { sku: 'RCNBRED', articleType: 'Napkin', subtype: 'Plain', color: 'Red', size: '20x20' }];
  const mk = (id, no, items, extra) => Object.assign({ id, no, at: '2026-09-20T10:00:00Z',
    items: items.map(([sku, qty]) => ({ sku, name: sku, qty, ffl: 'unfulfilled', rq: 0 })),
    ship: { name: 'B', country: 'US' }, total: 10, cur: 'USD', cancelled: false }, extra || {});
  A.setMETA({}); A.setSKU({}); A.setSTOCK({}); A.setSTOCKCASE({});
  A.setStockLoaded(true);
  /* India has 5 red napkins — so the red line reads "covered" even if the shelf is empty. */
  A.setIndia({ RCNBRED: [5] }, true, '');
  A.setSHOP({ orders: [mk('b1', '#5001', [['RCNBMIX', 2], ['RCNBRED', 1]])], from: '', to: '', tz: '', at: 'x' });
  A.renderShop();

  let t = await A.shpSyncAll({ maintain: true });
  ok('the automatic run opens nothing any more', t.written === 0 && !Object.keys(RT).some(k => /^pt_orderBook\//.test(k)), JSON.stringify(Object.keys(RT)));
  let b = A.shpBucket();
  const need = b.find(x => x.sku === 'RCNBMIX'), cov = b.find(x => x.sku === 'RCNBRED');
  ok('…the line nothing can fill waits in the bucket', need && need.kind === 'make' && need.qty === 2, JSON.stringify(b.map(x => [x.sku, x.kind])));
  ok('…and the line India says it can fill is offered apart, to open anyway', cov && cov.kind === 'covered');
  ok('…each line says what FBA and India hold for it', cov && cov.india === 5 && need && (need.fba === null || need.fba === 0), JSON.stringify(cov && { f: cov.fba, i: cov.india }));
  /* Ravi, 2026-09-27: "jo order FBA se fulfill kar rahe uska filter". */
  ok('a stock-covered line says which stock can fill it', cov && cov.from === 'india', JSON.stringify(cov && cov.from));
  {
    const src = require('fs').readFileSync(APP, 'utf8');
    ok('the bucket offers "FBA can fill" / "India can fill" on the stock-covered tab', /<select id="shbFrom"[^>]*><option value="">FBA or India<\/option><option value="fba">FBA can fill \(MCF\)<\/option><option value="india">India can fill<\/option>/.test(src)
       && /\(SHB\.tab !== 'covered' \|\| !SHB\.from \|\| x\.from === SHB\.from\)/.test(src));
  }
  ok('the Shopify tab says so on the order, and counts it on the button', /In the production bucket/.test(els.soTable.innerHTML), '');

  ok('opening a stock-covered line needs a reason', /say why they have to be made anyway/.test(await A.shpBucketRun([cov.key], '')));
  ok('opening the ticked line writes it', (await A.shpBucketRun([need.key], '')) === '');
  const row = RT['pt_orderBook/ob_shp_SHP-5001_RCNBMIX'];
  ok('…under the Shopify order number, marked as opened from the bucket, by whom', row && row.orderNo === 'SHP-5001' && row.openedFrom === 'bucket' && row.openedBy && row.qty === 2, JSON.stringify(row));
  ok('…and only that line — the red one stays in the bucket', !RT['pt_orderBook/ob_shp_SHP-5001_RCNBRED'] && A.shpBucket().some(x => x.sku === 'RCNBRED') && !A.shpBucket().some(x => x.sku === 'RCNBMIX'));
  ok('…with its sales order', !!RT['pt_salesOrders/SHP-5001']);

  /* THE DUPLICATE GUARD: this screen has not seen the row (another person opened it), the database has. */
  const keepOb = PTG.ob; PTG.ob = [];
  const again = A.shpBucket().find(x => x.sku === 'RCNBMIX');
  ok('a line another person already opened is skipped from the database, never opened twice',
     again && /is already open/.test(await A.shpBucketRun([again.key], '')), '');
  PTG.ob = keepOb;

  ok('the stock-covered line opens with a reason, and says so on the row', (await A.shpBucketRun([cov.key], 'India stock is not really there')) === ''
     && RT['pt_orderBook/ob_shp_SHP-5001_RCNBRED'] && RT['pt_orderBook/ob_shp_SHP-5001_RCNBRED'].forced === true
     && /India stock is not really there/.test(RT['pt_orderBook/ob_shp_SHP-5001_RCNBRED'].forcedWhy));
  ok('…and the sales order carries both lines, the first not dropped', (RT['pt_salesOrders/SHP-5001'].lines || []).map(l => l.sku).sort().join() === 'RCNBMIX,RCNBRED',
     JSON.stringify(RT['pt_salesOrders/SHP-5001'].lines));

  /* STOCK TURNS UP: a line somebody opened is a decision — the automatic run leaves it. */
  A.setSTOCK({ RCNBMIX: 40 }); A.setSTOCKCASE({ RCNBMIX: 'RCNBMIX' });
  A.renderShop();
  t = await A.shpSyncAll({ maintain: true });
  ok('stock turning up does not withdraw an opened line', !!RT['pt_orderBook/ob_shp_SHP-5001_RCNBMIX'] && t.removed === 0);
  A.renderShop();
  ok('the Shopify team sees the order in production', /In production/.test(els.soTable.innerHTML));

  /* THE SHIPPING TEAM FULFILS IT: the open production lines complete themselves, kept on the book. */
  A.setSHOP({ orders: [mk('b1', '#5001', [['RCNBMIX', 2], ['RCNBRED', 1]], { ff: 'fulfilled' })], from: '', to: '', tz: '', at: 'x' });
  A.renderShop();
  t = await A.shpSyncAll({ maintain: true });
  ok('an order fulfilled on Shopify completes its open production lines', t.done === 2
     && RT['pt_orderBook/ob_shp_SHP-5001_RCNBMIX/shopDoneWhy'] === 'fulfilled' && !!RT['pt_orderBook/ob_shp_SHP-5001_RCNBMIX/shopDoneAt'], JSON.stringify(t.done));
  ok('…kept, not deleted', !!RT['pt_orderBook/ob_shp_SHP-5001_RCNBMIX']);
  const line = ordLines().find(l => l.orderNo === 'SHP-5001' && l.sku === 'RCNBMIX');
  ok('…so the line is no longer open — it is in the complete window', line && line.open === false, JSON.stringify(line));
  ok('…and the Shopify team reads "Fulfilled by shipping team"', /Fulfilled by shipping team/.test((A.soProdStatus({ id: 'b1' }) || {}).txt || ''), JSON.stringify(A.soProdStatus({ id: 'b1' })));
  t = await A.shpSyncAll({ maintain: true });
  ok('…and a second run does not complete it again', t.done === 0);
  /* THE BUCKET IN EXCEL (Ravi: "excel se import export kr ske becuase manually bahut bada task h"). */
  {
    RT = {}; PTG.ob = []; SOX.rows = []; PATCHES.length = 0;
    A.setSTOCK({}); A.setSTOCKCASE({});
    A.setSHOP({ orders: [mk('b2', '#5002', [['RCNBMIX', 3], ['RCNBRED', 1]]), mk('b3', '#5003', [['RCNBMIX', 1]])], from: '', to: '', tz: '', at: 'x' });
    A.renderShop();
    const sheet = A.shpBucketSheetRows(), H = sheet[0];
    ok('the bucket downloads as a sheet: a Line ID, the section, Open and Reason columns, a row per line',
       ['Line ID', 'Section', 'Open', 'Reason (stock-covered lines)'].every(c => H.indexOf(c) >= 0) && sheet.length === 4, JSON.stringify(sheet.map(r => r[0])));
    const fill = sheet.map((r, i) => { if (!i) return r; const x = r.slice(); x[H.indexOf('Open')] = /RCNBMIX/.test(x[0]) ? 'yes' : (/b2\|RCNBRED/.test(x[0]) ? 'Yes' : ''); return x; });
    let rd = A.shpBucketXlRead(fill);
    ok('the filled sheet is read: yes rows only', !rd.err && rd.keys.length === 3, JSON.stringify(rd.keys));
    ok('…a stock-covered yes with no reason is refused, by order and SKU', /#5002 RCNBRED/.test(await A.shpBucketRun(rd.keys, rd.reasons)));
    fill.forEach((r, i) => { if (i && /b2\|RCNBRED/.test(r[0])) r[H.indexOf('Reason (stock-covered lines)')] = 'shelf is empty'; });
    rd = A.shpBucketXlRead(fill);
    ok('with its reason, every yes row opens through the same check', (await A.shpBucketRun(rd.keys, rd.reasons)) === ''
       && RT['pt_orderBook/ob_shp_SHP-5002_RCNBMIX'] && RT['pt_orderBook/ob_shp_SHP-5003_RCNBMIX']
       && /shelf is empty/.test((RT['pt_orderBook/ob_shp_SHP-5002_RCNBRED'] || {}).forcedWhy || ''), Object.keys(RT).join(' '));
    A.renderShop();
    rd = A.shpBucketXlRead(fill);
    ok('uploading the same sheet again opens nothing twice — the rows are no longer in the bucket', rd.keys.length === 0 && rd.skipped.length === 3, JSON.stringify(rd.skipped));
    ok('a sheet without Line ID and Open is refused', /Line ID/.test(A.shpBucketXlRead([['SKU'], ['X']]).err || ''));
  }
  /* #3873, 2026-09-28: a "READY TO SHIP" note hid three pieces nobody had made — out of the bucket, and its one
   * production line closed as "marked done". */
  {
    const wasShop = A.SHOP();
    PTG.mdb = PTG.mdb.concat([{ sku: 'RCNBGRN', articleType: 'Napkin', subtype: 'Plain', color: 'Green', size: '20x20' }]);
    A.setSHOP({ orders: [mk('b9', '#5009', [['RCNBGRN', 1], ['RCNBRED', 1]], { note: 'READY TO SHIP' })], from: '', to: '', tz: '', at: 'x' });
    A.renderShop();
    const o = A.soRows().find(r => r.no === '#5009');
    ok('a READY TO SHIP order still reads as marked done', o && o.handled === true);
    const g = A.shpBucket().find(x => x.id === 'b9' && x.sku === 'RCNBGRN');
    ok('…but its line nothing can fill waits in the bucket, the note shown', g && g.kind === 'make' && /READY TO SHIP/.test(g.why),
       JSON.stringify(A.shpBucket().filter(x => x.id === 'b9').map(x => [x.sku, x.kind, x.why])));
    ok('…its stock-covered line does not — that one is the shipping team\'s', !A.shpBucket().some(x => x.id === 'b9' && x.sku === 'RCNBRED'));
    /* The note still closes production lines in general — most such orders had the piece made, and "READY TO SHIP"
     * is written when it is (48 orders on 28 Sep, most with their line already on the book). */
    ok('…the note still means "marked done" for a line opened the usual way', A.shpDoneWhy(o, 'RCNBGRN') === 'marked done', A.shpDoneWhy(o, 'RCNBGRN'));
    ok('…opening it from the bucket writes it', (await A.shpBucketRun([g.key], '')) === '' && !!RT['pt_orderBook/ob_shp_SHP-5009_RCNBGRN'],
       Object.keys(RT).filter(k => /5009/.test(k)).join(' '));
    ok('…and records that it was opened with the note already there', /READY TO SHIP/.test((RT['pt_orderBook/ob_shp_SHP-5009_RCNBGRN'] || {}).openedPastNote || ''),
       JSON.stringify(RT['pt_orderBook/ob_shp_SHP-5009_RCNBGRN']));
    A.renderShop();
    await A.shpSyncAll({ maintain: true });
    /* The patch lands as separate paths ("…/shopDoneAt"), and the screen's own copy is PTG.ob — both are looked at. */
    const closed = Object.keys(RT).some(k => /ob_shp_SHP-5009_RCNBGRN\/shopDoneAt$/.test(k) && RT[k])
      || (PTG.ob || []).some(x => x && /SHP-5009_RCNBGRN$/.test(x.id || '') && x.shopDoneAt);
    ok('…and the automatic run does not close it again as "marked done"', !!RT['pt_orderBook/ob_shp_SHP-5009_RCNBGRN'] && !closed,
       Object.keys(RT).filter(k => /5009/.test(k)).join(' '));
    A.setSHOP(wasShop); A.renderShop();
  }
  ok('a cancelled or refunded line is over too, and says which', A.shpDoneWhy({ cancelled: true }, 'X') === 'cancelled'
     && A.shpDoneWhy({ items: [{ sku: 'X', qty: 2, rq: 2, ffl: 'unfulfilled' }] }, 'X') === 'refunded');
}
console.log('\n== Shopify returns, typed by hand, tracked to the USA warehouse (Ravi, 2026-09-26) ==');
await (async () => {
  const was = { shop: A.SHOP(), meta: A.SHOP_META() };
  A.setSHOP(Object.assign({}, was.shop, { orders: [{ id: '9001', no: '#R1', at: '2026-09-20', shopBrand: 'SP', ship: { name: 'Jane Doe', zip: '90210', state: 'CA' },
    items: [{ lid: 'L1', sku: 'A1', name: 'Napkins', qty: 4, rq: 0 }, { lid: 'L2', sku: 'B2', name: 'Runner', qty: 1, rq: 0 }] }] }));
  A.setMETA({});
  SETS.length = 0;
  ok('nothing ticked is refused', /Tick at least one line/.test(await A.srSave('9001', { items: [] })));
  ok('more than the order held is refused', /only 4 of 4/.test(await A.srSave('9001', { items: [{ lid: 'L1', qty: 5 }] })), await A.srSave('9001', { items: [{ lid: 'L1', qty: 5 }] }));
  ok('an order not loaded is refused', /Pick an order/.test(await A.srSave('nope', { items: [{ lid: 'L1', qty: 1 }] })));
  const first = await A.srSave('9001', { items: [{ lid: 'L1', qty: 2 }, { lid: 'L2', qty: 0 }], trk: '9400 1111', carrier: 'USPS', reason: 'Damaged', date: '2026-09-25' });
  ok('2 of the 4 napkins come back, with the return tracking — written to the order\'s own entry', first === '' && SETS.length === 1 && SETS[0].path === 'audit/shoporders', first + ' ' + JSON.stringify(SETS.map(x => x.path)));
  const r = A.srAll()[0];
  ok('…recorded with the order, the customer, the lines and the stage', r && r.orderNo === '#R1' && r.customer === 'Jane Doe' && r.items.length === 1 && r.items[0].sku === 'A1' && r.items[0].qty === 2 && r.trk === '9400 1111' && r.status === 'started', JSON.stringify(r));
  ok('a second return may bring back only the 2 that are left', /only 2 of 4/.test(await A.srSave('9001', { items: [{ lid: 'L1', qty: 3 }] })) && (await A.srSave('9001', { items: [{ lid: 'L1', qty: 2 }] })) === '');
  ok('…and then nothing', /only 0 of 4/.test(await A.srSave('9001', { items: [{ lid: 'L1', qty: 1 }] })));
  ok('the return moves along: on its way → received (dated, with the condition) → closed',
     (await A.srSetStatus('9001', r.id, 'transit', '')) === '' && (await A.srSetStatus('9001', r.id, 'received', 'one napkin torn')) === ''
     && !!A.srAll().find(x => x.id === r.id).receivedAt && /torn/.test(A.srAll().find(x => x.id === r.id).note) && (await A.srSetStatus('9001', r.id, 'closed', 'refunded')) === '',
     JSON.stringify(A.srAll().find(x => x.id === r.id)));
  A.setSR({ tab: 'all', q: '' }); A.srRender();
  ok('the window lists them', /#R1/.test(els.srTable.innerHTML) && /9400 1111/.test(els.srTable.innerHTML), els.srTable.innerHTML.slice(0, 200));
  /* the delivery-days tool */
  ok('a zip is placed by its first three digits when the lookup is silent', A.zipState('90210') === 'CA' && A.zipState('07001') === 'NJ' && A.zipState('99501') === 'AK' && A.zipState('00000') === '');
  ok('distance makes the zone, the zone makes the days', A.zoneOf(40, 'NJ') === 1 && A.zoneOf(500, 'NJ') === 4 && A.zoneOf(2500, 'CA') === 8 && A.zoneOf(100, 'HI') === 9 && A.ZONE_DAYS[8][0] === '4–5');
  const d = await A.daysEstimate('07001', '90210');
  ok('New Jersey to Beverly Hills: zone 8, 4–5 days by ground', !d.err && d.zone === 8 && d.days[0] === '4–5' && d.miles > 2000, JSON.stringify(d));
  ok('a zip nobody can place is said, not guessed', /not one I can place/.test((await A.daysEstimate('07001', '00000')).err || ''));
  A.setSHOP(was.shop); A.setMETA(was.meta);
})();
/* The summary sits INSIDE the async block: the returns tests await, and a summary outside printed "0 passed" before they ran. */
console.log('\n== The Ship-from cell says one thing, then the stock in plain words (Ravi, 2026-09-26: "too messy") ==');
{
  const e = x => String(x == null ? '' : x);
  const c1 = A.soShipFrom({ id: 'z1', route: 'MCF ready', mcf: 'yes', india: 'no' }, e);
  ok('MCF ready: one pill, MCF not said again, India in words', (c1.match(/class="st /g) || []).length === 1 && /MCF ready/.test(c1) && !/MCF <b/.test(c1) && /India <b[^>]*>No stock<\/b>/.test(c1), c1);
  const c2 = A.soShipFrom({ id: 'z2', route: 'Need from production', mcf: 'no', india: 'part' }, e);
  ok('needs production: one red pill, both stock facts in one plain line', (c2.match(/class="st /g) || []).length === 1 && /Needs production/.test(c2) && /MCF <b[^>]*>No stock<\/b> · India <b[^>]*>Partly<\/b>/.test(c2), c2);
}
console.log('\n== The Shopify tab stays quick with the real order book (Ravi, 2026-09-26: "shopify orders wala hang ho rha h") ==');
{
  const src = require('fs').readFileSync(APP, 'utf8');
  ok('the search waits for a pause in typing instead of redrawing on every key', /\$\('soFilter'\)\.addEventListener\('input', \(\) => \{ clearTimeout\(t\); t = setTimeout\(renderShop, 220\); \}\)/.test(src) && !/\['soState', 'soFilter', 'soDay'\]\.forEach/.test(src));
  ok('the sync planner reads the master and the order book through indexes, not a walk per order', /const mdbBy = shpMdbBy\(\);/.test(src) && /shpObOf\(no\)\.forEach/.test(src));
}
console.log('\n== India → USA by DHL Express / FedEx International Priority (Ravi, 2026-09-27) ==');
await (async () => {
  ok('business days skip the weekend', A.addBizDays('2026-09-25', 1) === '2026-09-28' && A.addBizDays('2026-09-28', 4) === '2026-10-02');
  ok('a metro state, the rest of the lower 48, and the far ones are three bands', A.inBandOf('NY') === 'metro' && A.inBandOf('MT') === 'lower48' && A.inBandOf('HI') === 'remote');
  const r = await A.indiaDaysEstimate('10001', '2026-09-28');
  ok('India → New York, picked up Monday: 3–4 days, landing Thu–Fri, both services', !r.err && r.dhl.days.join('-') === '3-4' && r.dhl.from === '2026-10-01' && r.dhl.to === '2026-10-02' && r.fedex.to === '2026-10-02', JSON.stringify(r));
  ok('a zip nobody can place is said, not guessed', /not one I can place/.test((await A.indiaDaysEstimate('00000', '2026-09-28')).err || ''));
})();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
})();

