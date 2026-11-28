/* INDIA STORE PIECES HELD FOR WEBSITE ORDERS (27 Nov: stock the open Ridhi and CPC orders need cannot go to FBA).
 *   node tests/shop-hold-test.js      (SHP_HOLD_SRC / SHP_ORDERS_SRC=<file> to test another copy — teeth/teeth-shop-hold.js does)
 * Loads src/app/inventory/fg-shop-hold.js, from the Shopify tab the order rules it publishes by, and every way to FBA, with a
 * made-up database. (SHP_MUT_FILE=<path under src/app> SHP_MUT_SRC=<file> tests a copy of one of those screens' files.) */
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..', 'src', 'app');
const mutated = f => (process.env.SHP_MUT_FILE && path.resolve(f) === path.resolve(APP, process.env.SHP_MUT_FILE) ? process.env.SHP_MUT_SRC : f);
const read = f => fs.readFileSync(mutated(f), 'utf8').replace(/\r\n/g, '\n');
const HOLD = read(process.env.SHP_HOLD_SRC || path.join(APP, 'inventory', 'fg-shop-hold.js'));
const ORDERS = read(process.env.SHP_ORDERS_SRC || path.join(APP, 'shopify', 'shopify-orders.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' - ' + extra : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* the app's own small helpers, taken from their files so they cannot drift */
const cut = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + 1); if (a < 0 || b < 0) throw new Error('not found: ' + from); return src.slice(a, b); };
const line = (file, start) => cut(read(path.join(APP, file)), start, '\n') + '\n';
const fn = (src, name) => cut(src, 'function ' + name + '(', '\n}\n') + '\n}\n';
const HELPERS = line('inventory/amazon-listing-status.js', 'const lstKey') + line('inventory/finished-goods.js', 'const fgiNum')
  + line('core/gates.js', 'const obUC') + fn(read(path.join(APP, 'orders/vendor-holdings.js')), 'fgiOutParts')
  + fn(read(path.join(APP, 'core/history.js')), 'ptSame');

const NOW = Date.parse('2026-11-27T12:00:00Z'), HOUR = 3600000;

/* a database that answers like ptGetFresh and ptCas; before: runs once between the read and the write */
function database(start, o) {
  const data = Object.assign({}, start), writes = [];
  const at = p => p.split('/').slice(2).reduce((v, k) => (v == null ? v : v[k]), data);
  const set = (p, v) => { const seg = p.split('/').slice(2); let n = data; seg.slice(0, -1).forEach(k => { n = n[k] = n[k] || {}; }); n[seg[seg.length - 1]] = v; };
  const copy = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
  return { data, writes,
    ptGetFresh: async p => { if (o.offline) throw new Error('offline'); return copy(at(p)); },
    ptCas: async (p, expect, next, opts) => {
      if (o.before) { const b = o.before; o.before = null; b(set); }
      if (o.refused) return 'refused';
      if (!same(copy(at(p)), copy(expect))) return 'changed';
      set(p, copy(next)); writes.push({ p, next: copy(next), quiet: !!(opts && opts.quiet) }); return '';
    } };
}
function load(o) {
  o = o || {};
  const db = database(o.db || {}, o), warns = [];
  const ctx = { localStorage: { getItem: () => { if (o.lsBlocked) throw new Error('blocked'); return o.ls === undefined ? null : o.ls; } },
    console: { warn: (...a) => warns.push(a.join(' ')) }, ptGetFresh: db.ptGetFresh, ptCas: db.ptCas,
    ME: { email: 'admin@example.com', admin: o.admin !== false }, FGI: { set: o.set || {} }, fgiOf: () => ({ current: 10 }),
    window: o.testSite ? { __TEST_ERP: {} } : {}, location: { hostname: 'localhost' }, nf: String };
  const keys = Object.keys(ctx);
  const api = new Function(...keys, HELPERS + HOLD + '\n;return { shpHoldOn, shpHoldBuild, shpHoldNeed,shpHoldPublish, fgiHoldState, fgiHeld, fgiFbaFree, fgiReleaseCreate, fgiReleasePlan, fgiReleaseSpend, fgiHoldAgeWhy, fgiHoldOldWarning };')(...keys.map(k => ctx[k]));
  return Object.assign(api, { db, warns });
}

const claim = (orderNo, sku, sets, perSet) => ({ orderNo, sku, sets, perSet: perSet || 1 });
const issue = (sku, qty, over) => Object.assign({ txnType: 'ISSUE', sku, qty }, over);
/* both stores noted just now; SP needs sp pieces of A, CPC needs cpc */
const noted = (sp, cpc, releases, at) => ({ SP: { at: at || Date.now(), skus: { A: sp } }, CPC: { at: at || Date.now(), skus: cpc ? { A: cpc } : {} }, releases });
const release = (left, at, sku) => ({ sku: sku || 'A', pcs: left, left, reason: 'urgent', by: 'admin@example.com', at: at || '2026-11-27T01:00:00Z' });

/* ---- the Shopify tab's side ---- */
function shop(o) {
  o = o || {};
  const published = [], warns = [], said = [], asked = [], msg = { textContent: o.msg || '' };
  const ctx = Object.assign({
    SHOP: { orders: o.orders || [], holdRead: o.holdRead }, SHOP_META: o.meta || {}, SHOP_STOCK_LOADED: o.stock !== false,
    SHOP_INDIA_AT: o.indiaAt === undefined ? 'now' : o.indiaAt, SHOP_INDIA_ERR: '', PTG: { ob: o.ob || [], mdb: [{}] }, PTG_ALL: [],
    SO_BRANDS: ['SP', 'CPC'], SO_COPY: { windowDays: 14 }, ME: { email: 'a@example.com' }, console: { warn: (...a) => warns.push(a.join(' ')) },
    sdToday: () => '2026-11-27', sdShift: (iso, d) => new Date(Date.parse(iso + 'T00:00:00Z') + d * 86400000).toISOString().slice(0, 10),
    soIndexNames() {}, soApplyTypedSkus() {}, soSendQty: (id, sku, n) => n, soMcfHas: () => false, soMcf: x => ({ v: x.fba ? 'yes' : 'no' }),
    soOrdBrand: x => (x.shopBrand === 'CPC' ? 'CPC' : 'SP'), soAcctName: b => b, shpSheetAllows: x => !x.offSheet,
    soIndiaKey: () => '', soPackFit: sku => (sku === 'NAP-12' ? { ok: true, pack: 4 } : null), obPcsPerPack: sku => (sku === 'PAIR' ? 2 : 1),
    shpTakenNumbers: () => new Map((o.ob || []).map(r => [r.orderNo, String(r.shopOrderId)])), shpOrderNo: n => 'SHP-' + String(n).replace('#', ''),
    shpHoldOn: () => o.on !== false, shpOnTestSite: () => false, prOn: () => true, ptRegLoaded: () => true,
    shpHoldNeed: claims => ({ skus: claims, orders: { from: claims } }), shpHoldPublish: async (store, figure) => { published.push({ store, figure }); },
    ptNeed: async () => {}, ptGet: async () => { if (o.offline) throw new Error('offline'); return {}; }, ptList: () => [],
    $: () => msg, soMsg: t => { msg.textContent = t; said.push(t); }, SHP_REACH_MAX_DAYS: 150,
    soAskStore: async (brand, want, ids) => { asked.push({ brand, want, ids }); const a = (o.old || {})[brand] || {}; if (a.fails) throw new Error(a.fails); return { orders: a.orders || [], more: !!a.more }; },
  });
  if (o.publishWhy) ctx.shpHoldPublish = async () => o.publishWhy;
  const keys = Object.keys(ctx);
  const src = line('core/gates.js', 'const obUC') + ordersSide();
  const api = new Function(...keys, src + '\n;return { soHoldClaims, soHoldReadOf, soHoldReadOld, soHoldPublish };')(...keys.map(k => ctx[k]));
  return Object.assign(api, { published, warns, said, asked, msg, SHOP: ctx.SHOP });
}
/* the Shopify tab's order rules and the whole hold section, as they are in the app */
const ordersSide = () => fn(ORDERS, 'soLive') + fn(ORDERS, 'soIndiaOwed') + cut(ORDERS, 'const SO_CB_RE', '/** Tracking numbers as one cell')
  + cut(ORDERS, '/** The lines of an order that still have a claim', 'function soAllocIndia(')
  + cut(ORDERS, '/* ---------- India stock HELD FROM FBA', 'function soIndia(order)');
const order = (no, over, item) => Object.assign({ id: String(no), no: '#' + no, items: [Object.assign({ sku: 'A', qty: 3 }, item)] }, over);

/* ---- every way to FBA, with the screens' own code ---- */
const vm = require('vm');
const appFile = f => read(path.join(APP, f));
const whole = (f, name) => { const t = appFile(f), i = t.search(new RegExp('^(async )?function ' + name + '\\(', 'm')); if (i < 0) throw new Error(name + ' not found in ' + f); return t.slice(i, t.indexOf('\n}', i) + 2) + '\n'; };
const KINDS = { ISSUE: { dir: -1 }, FBA: { dir: -1 }, RECEIVE: { dir: 1 } };
const row = (id, txnType, qty, over) => Object.assign({ _id: id, txnType, sku: 'A', qty }, over);

/* A screen with 10 of A in stock, website orders needing 4.
 * o: { off, need, released, age (hours), noFigure, writeFails, giveBackFails, unread, admin, rows, store } */
function screen(o) {
  o = o || {};
  const writes = [], boxes = {}, nothing = () => {};
  const releases = o.released ? { r: release(o.released) } : {};
  const db = database(o.noFigure ? {} : noted(o.need === undefined ? 4 : o.need, 0, releases, Date.now() - (o.age || 0) * HOUR), o);
  const box = id => boxes[id] || (boxes[id] = { value: '', textContent: '', innerHTML: '', className: '', checked: false, dataset: {}, classList: { toggle: nothing, add: nothing, remove: nothing } });
  let swaps = 0;
  const write = async p => { if (o.writeFails) throw new Error('offline'); writes.push(p); };
  const ctx = { console: { warn: nothing }, localStorage: { getItem: k => (k === 'shopHold' && !o.off ? '1' : null) }, $: box, nf: String, esc: String,
    obUC: s => String(s || '').trim().toUpperCase(), lstKey: s => String(s).toUpperCase(), ME: { email: 'store@test', admin: o.admin !== false },
    ptGetFresh: async p => { if (o.unread) throw new Error('no signal'); return db.ptGetFresh(p); },
    ptCas: async (...a) => { if (o.giveBackFails && swaps++) throw new Error('no signal'); return db.ptCas(...a); },
    ptPatch: write, ptPut: async (p, v) => write({ [p]: v }), ptGet: async () => null,
    FGI: { rows: o.rows || [row('O', 'OPENING', 10)], set: {}, err: '' }, PTG: { mdb: [{ sku: 'A' }] },
    fgiNum: v => parseFloat(v) || 0, fgiNewId: p => p + '-new', fgiRowId: r => r._id,
    fbaBadge: nothing, fgiOverBadge: nothing, renderFgi: nothing, lstAlertFor: async () => '', fgiCanEntry: () => true, fgiCanEdit: () => true,
    FGI_FBA_ACCOUNTS: ['Ridhi FBA'], fgiOutAlloc: () => ({ orders: [], loose: 0 }), fgiOutOrderCheck: () => ({ fields: {} }), fgiOutTxt: () => '', fgiStockReread: async () => '' };
  ctx.fgiStock = () => { const by = new Map(); ctx.FGI.rows.forEach(r => { const b = by.get(r.sku) || { current: 0 }; b.current += r.txnType === 'OPENING' ? r.qty : -r.qty; by.set(r.sku, b); }); return by; };
  ctx.fgiOf = sku => ctx.fgiStock().get(ctx.obUC(sku)) || { current: 0 };
  vm.createContext(ctx);
  vm.runInContext(HOLD, ctx);
  const run = code => vm.runInContext(code, ctx);
  return { ctx, run, writes, box, db, left: () => ((db.data.releases || {}).r || {}).left };
}
const scanHead = t => ({ t, k: KINDS[t], err: '', date: '27/11/2026', who: 'Ridhi FBA', hand: '', orderNo: '', orderSource: '', extFrom: '' });
function editScreen(o) {
  const S = screen(o);
  Object.assign(S.ctx, { FGI_KINDS: KINDS, fgiIsMarker: () => false, fgiEditLocked: () => '', ptIsoDate: () => '', fgiOrdersFor: () => [],
    fgiEffect: r => (r.txnType === 'OPENING' ? r.qty : -r.qty),
    ptGet: async p => S.ctx.FGI.rows.find(r => p.endsWith('/' + r._id)) });
  S.run(whole('inventory/fg-corrections.js', 'fgiEditApply'));
  return S;
}
const movement = (txnType, qty) => row('F', txnType, qty, { issuedFor: 'x', date: '27/11/2026' });

/* Each way to send q pieces of A; answers { S, said }. */
const WAYS = {
  'entry form': async (o, q, t = 'FBA') => {
    const S = screen(o);
    S.ctx.FGI_KINDS = KINDS;
    S.run(whole('inventory/fg-other-movements.js', 'fgiOutCheck') + whole('inventory/fg-other-movements.js', 'fgiEntrySave'));
    Object.entries({ fgmType: t, fgmSku: 'A', fgmQty: String(q), fgmWho: 'Ridhi FBA', fgmFbaAcct: 'Ridhi FBA' }).forEach(([k, v]) => { S.box(k).value = v; });
    return { S, said: await S.ctx.fgiEntrySave() };
  },
  'scan, entered as scanned': async (o, q, t = 'FBA') => {
    const S = screen(o);
    Object.assign(S.ctx, { FGS: { rows: new Map([['A', { sku: 'A', qty: q }]]) }, fgiScanHead: () => scanHead(t) });
    S.run(whole('inventory/fg-scanning.js', 'fgiScanFlush'));
    return { S, said: await S.ctx.fgiScanFlush('A') };
  },
  'scan, added to the row of this batch': async (o, q, t = 'FBA') => {
    const S = screen(Object.assign({}, o, { rows: [row('O', 'OPENING', 11), row('F', t, 1)] }));
    Object.assign(S.ctx, { FGS: { rows: new Map([['A', { sku: 'A', qty: q + 1, saved: 1, id: 'F' }]]) }, fgiScanHead: () => scanHead(t), fgiOutParts: () => [] });
    S.run(whole('inventory/fg-scanning.js', 'fgiScanFlush'));
    return { S, said: await S.ctx.fgiScanFlush('A') };
  },
  'scan, Save all': async (o, q, t = 'FBA') => {
    const S = screen(o);
    Object.assign(S.ctx, { FGS: { rows: new Map([['A', { sku: 'A', qty: q }]]), unknown: new Map() }, fgiScanAuto: () => false, fgiScanHead: () => scanHead(t) });
    S.run(whole('inventory/fg-scanning.js', 'fgiScanSave'));
    return { S, said: await S.ctx.fgiScanSave() };
  },
  'packing list Finish': async (o, q) => {
    const S = screen(o);
    Object.assign(S.ctx, { fgiOutOrders: () => [], ordLines: () => [] });
    S.run(whole('inventory/fg-other-movements.js', 'fgiOutCheck') + appFile('replenishment/pack-core.js'));
    S.ctx.list = { id: 'P', date: '2026-11-27', account: 'Ridhi FBA', boxes: [{ n: 1, items: [{ sku: 'A', qty: q }] }] };
    return { S, said: (await S.run('packLedgerWrite(list, "")')).err || '' };
  },
  'edit of an issue into FBA': async (o, q) => {
    const S = editScreen(Object.assign({}, o, { rows: [row('O', 'OPENING', 10), movement('ISSUE', q)] }));
    return { S, said: await S.ctx.fgiEditApply('F', { txnType: 'FBA', who: 'Ridhi FBA' }) };
  },
};

async function waysToFba() {
  console.log('== every way to FBA (stock 10, website orders need 4) ==');
  for (const [name, way] of Object.entries(WAYS)) {
    const a = await way({}, 6);
    ok(name + ': the free pieces go', a.said === '' && a.S.writes.length === 1, a.said);
    const b = await way({}, 7);
    ok(name + ': a held piece does not', /free for FBA/.test(b.said) && b.S.writes.length === 0, b.said);
    const c = await way({ released: 2 }, 7);
    ok(name + ': a release lets it go, and 1 of it is used', c.said === '' && c.S.writes.length === 1 && c.S.left() === 1, c.said + ' ' + c.S.left());
    const d = await way({ age: 7, released: 9 }, 1);
    ok(name + ': an old figure refuses, release or not', /6 hours/.test(d.said) && d.S.writes.length === 0 && d.S.left() === 9, d.said);
    const e = await way({ noFigure: true }, 1);
    ok(name + ': no figure refuses', /Shopify Orders/.test(e.said) && e.S.writes.length === 0, e.said);
    const f = await way({ writeFails: true, released: 2 }, 7);
    ok(name + ': a failed save gives the release back and says so', /Not saved.*offline.*given back/.test(f.said) && f.S.left() === 2, f.said + ' ' + f.S.left());
    const g = await way({ off: true, noFigure: true }, 10);
    ok(name + ': switch off, as before', g.said === '' && g.S.writes.length === 1, g.said);
  }
  for (const name of ['entry form', 'scan, entered as scanned', 'scan, added to the row of this batch', 'scan, Save all']) {
    const a = await WAYS[name]({ noFigure: true }, 8, 'ISSUE');
    ok(name + ': an issue (not FBA) is never held', a.said === '' && a.S.writes.length === 1, a.said);
  }
  const unread = await WAYS['entry form']({ unread: true }, 1);
  ok('the figure unreadable at save: refused', /could not be checked/.test(unread.said) && unread.S.writes.length === 0, unread.said);
  const check = screen({});
  check.ctx.FGI.set = { _shopHold: noted(4, 0) };
  check.run(whole('inventory/fg-other-movements.js', 'fgiOutCheck'));
  ok('the stock check itself refuses held pieces for FBA, before any "already sent today" warning, and not for an issue',
    /free for FBA/.test(check.run('fgiOutCheck("A", 7, "FBA", 0)')) && check.run('fgiOutCheck("A", 7, "ISSUE", 0)') === '');
  const fresh = await WAYS['entry form']({}, 6);
  ok('the form reads the figure afresh', fresh.S.ctx.FGI.set._shopHold.SP.skus.A === 4);
  const lost = await WAYS['entry form']({ writeFails: true, giveBackFails: true, released: 2 }, 7);
  ok('a release that cannot be given back is said, with the pieces', /1 released piece\(s\).*NOT given back/.test(lost.said), lost.said);
  ok('Finish short of stock still says to receive it', /Receive it in Finished Goods first/.test((await WAYS['packing list Finish']({}, 11)).said));
  ok('Finish short because of the hold does not', !/Receive it/.test((await WAYS['packing list Finish']({}, 7)).said));

  console.log('== pieces that go back to FBA by deleting or undoing a return ==');
  const returned = [row('O', 'OPENING', 5), row('F', 'FBA', 5, { fbaReturned: 5, fbaShippedAt: 'x', fbaShipment: 'S1' }), row('R', 'FBA_RETURN', 5, { linkedFbaId: 'F', fbaShipBack: 'S1' })];
  /* stock 5 (5 in, 5 sent, 5 back); the website orders need `need` */
  const back = async (how, o) => {
    const S = screen(Object.assign({ rows: returned.map(r => Object.assign({}, r)) }, o));
    S.ctx.fgiStock = () => new Map([['A', { current: 5 }]]);
    if (how === 'delete') {
      Object.assign(S.ctx, { FGI_PICK: { ledger: new Set() }, PTG: {} });
      S.run(whole('inventory/fg-change-remove.js', 'fgiDeleteRun'));
      S.ctx.plan = { gone: o.both ? ['F', 'R'] : ['R'], rows: o.both ? returned.slice(1) : [returned[2]], refused: [], skus: [], updates: { x: null }, pressBack: new Map(), fbaBack: new Map() };
      return { S, said: await S.run('fgiDeleteRun(plan)') };
    }
    Object.assign(S.ctx, { fbaCan: () => true, fbaFresh: async () => [{ id: 'F', row: S.ctx.FGI.rows[1] }], fbaState: () => ({ st: 'shipped' }), renderFba() {}, FBA_PILL: {} });
    S.run(whole('inventory/fba-ship-excel.js', 'fbaUndo'));
    return { S, said: await S.ctx.fbaUndo('F') };
  };
  for (const how of ['delete', 'undo']) {
    const a = await back(how, { need: 0 });
    ok(how + ': free pieces go back to FBA', a.said === '' && a.S.writes.length === 1, a.said);
    const b = await back(how, { need: 1 });
    ok(how + ': held pieces do not', /free for FBA/.test(b.said) && b.S.writes.length === 0, b.said);
    const c = await back(how, { need: 1, released: 1 });
    ok(how + ': a release lets them, and is used', c.said === '' && c.S.left() === 0, c.said);
    const d = await back(how, { need: 1, off: true });
    ok(how + ': switch off, as before', d.said === '' && d.S.writes.length === 1, d.said);
  }
  const both = await back('delete', { noFigure: true, both: true });
  ok('a return deleted with its dispatch sends nothing to FBA', both.said === '' && both.S.writes.length === 1, both.said);

  console.log('== edits of a movement ==');
  const edit = async (type, qty, input, o) => {
    const S = editScreen(Object.assign({ rows: [row('O', 'OPENING', 10 + qty), movement(type, qty)] }, o));
    return S.ctx.fgiEditApply('F', input);
  };
  ok('more pieces on an FBA row: only the extra is judged', await edit('FBA', 5, { qty: 11 }) === '');
  ok('…and refused beyond the free pieces', /free for FBA/.test(await edit('FBA', 5, { qty: 12 })));
  ok('fewer pieces, or only a note, needs no figure', await edit('FBA', 5, { qty: 2 }, { noFigure: true }) === '' && await edit('FBA', 5, { remarks: 'n' }, { noFigure: true }) === '');
  ok('an issue turned into FBA is judged whole', /free for FBA/.test(await edit('ISSUE', 7, { txnType: 'FBA' }, { need: 11 })));

  console.log('== the scanner warns at scan time ==');
  const packing = async o => {
    const S = screen(o), store = (o && o.store) || [4, 5];
    Object.assign(S.ctx, { ordLines: () => [{ orderNo: 'OC-1', sku: 'A', qty: 4 }, { orderNo: 'OC-2', sku: 'A', qty: 5 }],
      fgiOutOrders: () => [{ orderNo: 'OC-1', store: store[0] }, { orderNo: 'OC-2', store: store[1] }], fgiLoad: async () => {},
      pksResolve: () => ({ sku: 'A' }), pksSaveSoon: () => {}, pkLookupSku: () => ({}) });
    S.run(appFile('replenishment/pack-core.js'));
    await S.run('packDataReady()');
    return S;
  };
  const stores = async o => JSON.stringify((await packing(o)).run('packOrderLines({ orders: ["OC-1", "OC-2"] }).map(l => l.store)'));
  ok('opening a packing screen reads the figure; the lines share what is free', await stores({}) === '[4,2]');
  ok('no figure: nothing to pack', await stores({ noFigure: true }) === '[0,0]');
  ok('switch off: the lines as before', await stores({ off: true, noFigure: true }) === '[4,5]');
  const scanSaid = {
    phone: async (o, packed) => {
      const S = await packing(o);
      S.ctx.PKS = { p: { scan: { orders: ['OC-1', 'OC-2'], packed: { A: packed }, wrong: [] } }, per: 1 };
      S.run('const pksOrderLines = () => packOrderLines(PKS.p.scan);\n' + whole('replenishment/pack-scan.js', 'pksCount'));
      return S.run('pksCount("A").why');
    },
    desk: async (o, packed) => {
      const S = await packing(o), said = [];
      Object.assign(S.ctx, { PKV: { p: { scan: { orders: ['OC-1', 'OC-2'], packed: { A: packed }, wrong: [] } }, last: {}, tab: 'order' }, PKV_DEBOUNCE_MS: 0,
        mdbOf: () => null, pkvSay: (kind, title, sub) => said.push(sub), pksBeep: () => {}, pkvMark: () => {}, pkvRender: () => {} });
      S.run(whole('inventory/pack-verify.js', 'pkvOnCode'));
      S.run('pkvOnCode("A")');
      return said[0];
    },
  };
  for (const [name, said] of Object.entries(scanSaid)) {
    ok(name + ': says the pieces are held', /held for website orders/.test(await said({}, { 'OC-1': 4, 'OC-2': 2 })));
    ok(name + ': says the figure is old', /6 hours/.test(await said({ age: 7 }, {})));
    ok(name + ': store short for the order, not the hold: the old words', /India Store holds no more/.test(await said({ need: 0, store: [4, 2] }, { 'OC-1': 4, 'OC-2': 2 })));
    ok(name + ': switch off, the old words', /India Store holds no more/.test(await said({ off: true, store: [4, 2] }, { 'OC-1': 4, 'OC-2': 2 })));
  }

  console.log('== Finished Goods stock list ==');
  const table = o => {
    const S = screen(o);
    Object.assign(S.ctx, { fgiMaster: () => ({}), fgiStatus: () => ({ txt: 'ok' }), lstOf: () => ({ st: 'unknown' }), LST_PILL: { unknown: ['', ''] }, ptFillSelect: () => {},
      FGI_PICK: { stock: new Set() }, ptImgCell: () => '<td></td>', ptImgFill: () => {}, ptImgPatch: null });
    S.ctx.FGI.set = { _shopHold: noted(4, 0) };
    S.run(cut(appFile('inventory/finished-goods.js'), 'const FGI_NUM_COLS', 'function fgiRenderStock(') + whole('inventory/finished-goods.js', 'fgiRenderStock'));
    S.run('fgiRenderStock(new Map([["A", { sku: "A", current: 10, opening: 10, received: 0, issued: 0, fba: 0, pending: 0 }]]))');
    return S.box('fgTable').innerHTML;
  };
  const on = table({}), off = table({ off: true });
  ok('switch on: a Shopify held column and the figure', on.includes('<th class="num">Shopify held</th>') && on.includes('<td class="num">4</td>'));
  ok('an admin has the release button, nobody else', on.includes('data-fgrel="A"') && !table({ admin: false }).includes('data-fgrel'));
  ok('switch off: no column, no button', !off.includes('Held') && !off.includes('data-fgrel'));
  ok('the figure columns line up as before', off.includes('<th class="num">In stock</th><th>Amazon</th><th>Tag</th><th class="num">Rate</th><th class="num">Value</th><th></th>'));
  const R = screen({});
  let form = null;
  R.ctx.ptOpenDialog = cfg => { form = cfg; };
  R.ctx.FGI.set = { _shopHold: noted(4, 0) };
  R.run('fgiReleaseOpen("a")');
  const first = await form.onSave({ pieces: '2', reason: 'urgent' }), second = await form.onSave({ pieces: '2', reason: 'urgent' });
  ok('the release form saves once, however often it is pressed', first === '' && /already saved/.test(second) && R.db.data.releases['REL-new'].left === 2, first + second);
}

/* ---- the test website: counted from the shared copy ---- */
const COPY_FILE = path.join(APP, 'shopify', 'shopify-copy.js');
/* Today is 27 Nov: the tab reaches back 150 days, to 30 June. The copy last heard from Shopify an hour ago. */
const FLOOR = '2026-06-30';
function sharedCopy(o) {
  const at = o.at || Date.now() - HOUR, docs = new Map(), stores = {};
  ['SP', 'CPC'].forEach(b => {
    const days = (o.days || {})[b] || {};
    stores[b] = Object.assign({ cursor: 'c', syncedAt: at, filledFrom: '2026-10-15', days: {} }, (o.store || {})[b]);
    Object.entries(days).forEach(([d, orders]) => {
      stores[b].days[d] = 1;
      docs.set('shopify_cache_days/' + b + '_' + d, { json: JSON.stringify({ orders: Object.fromEntries(orders.map(x => [x.id, x])) }) });
    });
  });
  docs.set('shopify_cache/meta', { json: JSON.stringify({ v: o.version || 1, stores }) });
  return { at, docs, stores };
}
/* the usual copy: one Ridhi order for 3 of A, one old CPC order for 2 */
const usual = over => sharedCopy(Object.assign({ days: { SP: { '2026-11-20': [order(1)] }, CPC: { '2026-08-01': [order(2, {}, { qty: 2 })] } } }, over));

/* The test website: the real hold rules and the real readers of the shared copy, a made-up Firestore and database. There is
 * no way to ask live Shopify here: a call to it would stop the suite. */
function testSite(o) {
  o = o || {};
  const copy = o.copy || usual(), reads = [], warns = [], indexed = [], box = { textContent: '', className: '' };
  const db = database(o.db || {}, o);
  const ctx = {
    window: { __TEST_ERP: {} }, localStorage: { getItem: () => null }, console: { warn: (...a) => warns.push(a.join(' ')) },
    SHOP: { orders: o.screen || [] }, SHOP_META: o.meta || {}, SHOP_STOCK_LOADED: o.stock !== false, SHOP_INDIA_AT: 'now', SHOP_INDIA_ERR: '',
    PTG: { ob: [], mdb: [{}], at: 1 }, PTG_ALL: [], prOn: () => true, ptRegLoaded: () => !o.noBook, SO_BRANDS: ['SP', 'CPC'], SHP_REACH_MAX_DAYS: 150,
    ME: { email: 'a@example.com', admin: true }, FGI: { set: {} }, db: {},
    doc: (_, coll, id) => coll + '/' + id,
    getDoc: async ref => {
      reads.push(ref);
      if (o.silent) return new Promise(() => {});
      if (o.denied) throw Object.assign(new Error('ERP data: permission denied'), { code: 'permission-denied' });
      if (o.failOnce === ref) { o.failOnce = ''; throw new Error('no signal'); }
      const v = copy.docs.get(ref);
      return { exists: () => !!v, data: () => v };
    },
    ptGetFresh: db.ptGetFresh, ptCas: o.savingOff ? async () => { throw new Error('Saving is off in the TEST ERP'); } : db.ptCas,
    ptNeed: async () => {}, ptGet: async () => o.ledger || [], ptList: v => v,
    sdToday: () => '2026-11-27', sdShift: (iso, d) => new Date(Date.parse(iso + 'T00:00:00Z') + d * 86400000).toISOString().slice(0, 10),
    soIndexNames: more => indexed.push((more || []).map(x => x.no)), soApplyTypedSkus() {}, soSendQty: (id, sku, n) => n, soMcfHas: () => false,
    soMcf: () => ({ v: 'no' }), soOrdBrand: x => (x.shopBrand === 'CPC' ? 'CPC' : 'SP'), soAcctName: b => (b === 'CPC' ? 'CPC' : 'Ridhi'),
    shpSheetAllows: () => true, soIndiaKey: () => '', soPackFit: () => null, obPcsPerPack: () => 1, shpTakenNumbers: () => new Map(),
    shpOrderNo: n => 'SHP-' + String(n).replace('#', ''), $: () => box,
    setTimeout: (f, ms) => setTimeout(f, o.silent ? 1 : ms), clearTimeout,
  };
  const COPY = read(COPY_FILE);
  const copyReaders = cut(COPY, 'const SO_COPY = {', 'const SO_BRANDS') + line('shopify/shopify-copy.js', 'const soCopyMs')
    + line('shopify/shopify-copy.js', 'const soCopyDone') + fn(COPY, 'soCopyStrip') + fn(COPY, 'soCopyMerge')
    + cut(COPY, '/** The contents page. Throws', '/** Which days to read') + fn(COPY, 'soSharedDaysToRead');
  const keys = Object.keys(ctx);
  const src = HELPERS + HOLD + copyReaders + fn(read(path.join(APP, 'core', 'database-read.js')), 'ptWithin') + ordersSide();
  const api = new Function(...keys, src + '\n;return { soHoldPublish, fgiHoldState };')(...keys.map(k => ctx[k]));
  const noted = b => ((db.data[b]) || null);
  return Object.assign(api, { copy, reads, db, warns, indexed, box, noted, o });
}
const published = async o => { const S = testSite(o); await S.soHoldPublish(); return S; };
const NOT_NOTED = /Pieces held for website orders were not noted: /;

async function testWebsite() {
  console.log('== the test website counts from the shared copy ==');
  const A = await published();
  ok('each store is noted from its own orders in the copy', same(A.noted('SP').skus, { A: 3 }) && same(A.noted('CPC').skus, { A: 2 }), JSON.stringify(A.db.data) + A.box.textContent);
  ok('noted with the time the copy last heard from Shopify', A.noted('SP').at === A.copy.at && A.noted('CPC').at === A.copy.at);
  ok('noted with the orders behind each SKU', same(A.noted('SP').orders, { A: [{ no: 'SHP-1', pcs: 3 }] }) && same(A.noted('CPC').orders, { A: [{ no: 'SHP-2', pcs: 2 }] }), JSON.stringify(A.db.data));
  ok('the contents page and each listed day, once', same(A.reads.slice().sort(), ['shopify_cache/meta', 'shopify_cache_days/CPC_2026-08-01', 'shopify_cache_days/SP_2026-11-20']), A.reads.join());
  ok('the tab says the copy\'s time and from which day orders were counted', /Test website.*Ridhi: copy of .+, orders counted from 2026-10-15; CPC: copy of /.test(A.box.textContent), A.box.textContent);
  ok('…and that a copy this short may miss an older order', /does not reach back 150 days/.test(A.box.textContent) && !/6 hours/.test(A.box.textContent) && A.box.className === 'muted');
  ok('the names on the copy\'s orders are known for pack sizes', A.indexed.some(x => same(x, ['#1'])) && A.indexed.some(x => same(x, ['#2'])));
  const timed = await published({ copy: usual({ at: Date.parse('2026-11-27T08:35:00Z') }) });
  ok('the copy\'s time is India time', /copy of 27 Nov, 14:05/.test(timed.box.textContent), timed.box.textContent);

  const long = await published({ copy: usual({ store: { SP: { filledFrom: '2026-06-30' }, CPC: { filledFrom: '2026-05-01' } } }) });
  ok('a copy that reaches back 150 days: no warning', /counted from 2026-06-30/.test(long.box.textContent) && !/reach back/.test(long.box.textContent), long.box.textContent);
  const edge = await published({ copy: usual({ days: { SP: { '2026-06-30': [order(3, {}, { qty: 4 })], '2026-06-29': [order(4)] }, CPC: { '2026-08-01': [order(2)] } } }) });
  ok('days from 150 days back are counted; an older day is not even read', same(edge.noted('SP').skus, { A: 4 }) && !edge.reads.includes('shopify_cache_days/SP_2026-06-29'), edge.reads.join());

  const rules = await published({ screen: [order(1, {}, { qty: 50 }), order(9)], ledger: [issue('A', 1, { shpOrderNo: 'SHP-1' })],
    copy: usual({ days: { SP: { '2026-11-20': [order(1), order(5, { ff: 'fulfilled' }), order(6, { cancelledAt: '2026-11-21' }), order(7, { note: 'done' })] }, CPC: { '2026-08-01': [order(2)] } } }) });
  ok('the same counting rules, issued pieces taken off, and only the copy\'s orders, once', same(rules.noted('SP').skus, { A: 2 }), JSON.stringify(rules.db.data));

  console.log('== the copy is read once ==');
  const R = await published();
  R.reads.length = 0;
  await R.soHoldPublish();
  ok('nothing changed: only the contents page is read again', same(R.reads, ['shopify_cache/meta']), R.reads.join());
  const meta = JSON.parse(R.copy.docs.get('shopify_cache/meta').json);
  meta.stores.SP.days['2026-11-20'] = 2;
  R.copy.docs.set('shopify_cache/meta', { json: JSON.stringify(meta) });
  R.copy.docs.set('shopify_cache_days/SP_2026-11-20', { json: JSON.stringify({ orders: { 1: order(1, {}, { qty: 8 }) } }) });
  R.reads.length = 0;
  await R.soHoldPublish();
  ok('a day the copy changed is read again, alone, and counted', same(R.reads, ['shopify_cache/meta', 'shopify_cache_days/SP_2026-11-20']) && R.noted('SP').skus.A === 8, R.reads.join());
  const T = testSite();
  await Promise.all([T.soHoldPublish(), T.soHoldPublish()]);
  ok('opening the tab and Fetch at once share one read', T.reads.length === 3, T.reads.join());
  const again = await published({ failOnce: 'shopify_cache/meta' });
  const first = again.box.textContent;
  await again.soHoldPublish();
  ok('a failed read is asked again next time', /no signal/.test(first) && !!again.noted('SP'), first + ' / ' + again.box.textContent);

  console.log('== not noted, and why ==');
  const none = { docs: new Map() };
  for (const [name, o, why] of [['no copy', { copy: none }, /there is no shared copy/], ['another format', { copy: usual({ version: 99 }) }, /format/],
    ['no read right', { denied: true }, /may not read the shared copy.*Shopify right/], ['no answer', { silent: true }, /No answer for 90 seconds/],
    ['no order book', { noBook: true }, /order book/], ['stock not in', { stock: false }, /stock has not been read/], ['saving off', { savingOff: true }, /Saving is off/]]) {
    const S = await published(o);
    ok('said on the tab, nothing noted: ' + name, NOT_NOTED.test(S.box.textContent) && why.test(S.box.textContent) && S.box.className === 'err'
      && S.db.writes.length === 0 && S.warns.length >= 1 && !/were noted from/.test(S.box.textContent), S.box.textContent);
  }
  const gone = usual();
  gone.docs.delete('shopify_cache_days/SP_2026-11-20');
  for (const [name, copy, why] of [['a listed day is missing', gone, /2026-11-20 but they are not there/],
    ['the store was never filled', usual({ store: { SP: { filledFrom: '' } } }), /not been filled/],
    ['the store never synced', usual({ store: { SP: { syncedAt: 0 } } }), /not been filled/],
    ['the store holds no days', usual({ days: { CPC: { '2026-08-01': [order(2)] } } }), /holds no orders/]]) {
    const S = await published({ copy });
    ok('only the other store is noted: ' + name, !S.noted('SP') && !!S.noted('CPC') && why.test(S.box.textContent) && /not noted: Ridhi: /.test(S.box.textContent)
      && /noted from the shared copy of the orders — CPC: /.test(S.box.textContent) && S.box.className === 'err', S.box.textContent);
  }

  console.log('== how old the copy is, and noting it again ==');
  const old = await published({ copy: usual({ at: Date.now() - 7 * HOUR }) });
  ok('an old copy is noted at its own age, and the test website accepts it', old.noted('SP').at === old.copy.at && old.fgiHoldState(old.db.data).state === 'ok');
  ok('…and the tab warns', /TEST ONLY.*over 6 hours old/.test(old.box.textContent), old.box.textContent);
  const at = Date.now() - HOUR, held = (t, n) => ({ at: t, by: 'x', skus: { A: n }, orders: { A: [{ no: 'SHP-1', pcs: n }] } });
  const rewrite = async (stored) => (await published({ copy: usual({ at }), db: { SP: stored } })).db.writes.filter(w => /SP$/.test(w.p)).length;
  ok('the same copy with a changed need is noted again', await rewrite(held(at, 9)) === 1);
  ok('the same copy with the same need is not', await rewrite(held(at, 3)) === 0);
  ok('the same copy noted without its orders is noted again', await rewrite({ at, by: 'x', skus: { A: 3 } }) === 1);
  ok('a newer copy is noted at once, same need or not', await rewrite(held(at - 60000, 3)) === 1);
  ok('an older copy never replaces a newer figure', await rewrite(held(at + 60000, 9)) === 0);

  console.log('== the refusal on the test website ==');
  const words = (testSiteOn, hold) => load({ testSite: testSiteOn }).fgiHoldAgeWhy(hold);
  const aged = h => noted(1, 0, {}, Date.now() - h * HOUR), warn = (testSiteOn, hold) => load({ testSite: testSiteOn }).fgiHoldOldWarning(hold);
  ok('test website, old: accepted', words(true, aged(7)) === '', words(true, aged(7)));
  ok('…with a warning', /TEST ONLY.*over 6 hours old/.test(warn(true, aged(7))), warn(true, aged(7)));
  ok('…and none while the figure is fresh', warn(true, aged(1)) === '');
  ok('live, old: still refused, no test warning', /6 hours/.test(words(false, aged(7))) && warn(false, aged(7)) === '');
  for (const [name, hold] of [['not known', {}], ['clock ahead', noted(1, 0, {}, Date.now() + HOUR)]]) {
    ok('test website, ' + name + ': says UAT mode and the shared copy', /UAT mode on.*Shopify Orders.*shared copy/.test(words(true, hold)), words(true, hold));
    ok('live, ' + name + ': the words as before', /open the Shopify Orders tab and press Fetch orders, then try again/.test(words(false, hold)) && !/UAT|shared copy/.test(words(false, hold)));
  }
  ok('a current figure refuses nothing there', words(true, noted(1, 0)) === '');
}

(async () => {
  console.log('== the switch: on by itself on the test website only ==');
  {
    ok('off by default away from the test website', load().shpHoldOn() === false);
    ok('on by itself on the test website', load({ testSite: true }).shpHoldOn() === true);
    ok('can still be turned off on the test website', load({ testSite: true, ls: '0' }).shpHoldOn() === false);
    ok('turned on for one computer', load({ ls: '1' }).shpHoldOn() === true);
    ok('turned off', load({ ls: '0' }).shpHoldOn() === false);
    const B = load({ lsBlocked: true });
    ok('saved settings blocked: off, and the console says why', B.shpHoldOn() === false && B.warns.length === 1);
  }

  console.log('== the need of one store, in pieces ==');
  {
    const B = load().shpHoldBuild;
    ok('sets become pieces, and orders add up', same(B([claim('SHP-1', 'a', 3, 4), claim('SHP-2', 'A', 1, 4)], []), { A: 16 }));
    ok('issued to that order (SHP board) is taken off', same(B([claim('SHP-1', 'A', 5)], [issue('A', 2, { shpOrderNo: 'SHP-1' })]), { A: 3 }));
    ok('issued naming the order in its list is taken off', same(B([claim('SHP-1', 'A', 5)], [issue('A', 9, { orders: [{ orderNo: 'SHP-1', qty: 2 }] })]), { A: 3 }));
    ok('issued with a single order number is taken off', same(B([claim('SHP-1', 'A', 5)], [issue('A', 4, { orderNo: 'shp-1' })]), { A: 1 }));
    ok('a row naming the order both ways counts once', same(B([claim('SHP-1', 'A', 5)], [issue('A', 2, { shpOrderNo: 'SHP-1', orders: [{ orderNo: 'SHP-1', qty: 2 }] })]), { A: 3 }));
    ok('two lines of one SKU on one order: the issue comes off once', same(B([claim('SHP-1', 'A', 3), claim('SHP-1', 'A', 3)], [issue('A', 2, { shpOrderNo: 'SHP-1' })]), { A: 4 }));
    ok('reversed, another order, another SKU, or sent to FBA: not taken off', same(B([claim('SHP-1', 'A', 5)], [
      issue('A', 1, { shpOrderNo: 'SHP-1', reversed: true }), issue('A', 1, { shpOrderNo: 'SHP-2' }), issue('B', 1, { shpOrderNo: 'SHP-1' }),
      issue('A', 1, { txnType: 'FBA', orderNo: 'SHP-1' })]), { A: 5 }));
    ok('issued in full or beyond: nothing held, never below nought', same(B([claim('SHP-1', 'A', 2), claim('SHP-2', 'A', 1)], [issue('A', 7, { shpOrderNo: 'SHP-1' })]), { A: 1 }));
    ok('a SKU the database cannot hold as a key is made safe', same(B([claim('SHP-1', 'a.b/c', 1)], []), { A_B_C: 1 }));
  }

  console.log('== the orders behind the need ==');
  {
    const N = load().shpHoldNeed;
    const from = (orderNo, sets, on, ref, sku) => Object.assign(claim(orderNo, sku || 'A', sets), { on, ref });
    const need = N([from('SHP-1000', 2, '2026-11-20', '#1000'), from('SHP-999', 4, '2026-11-20', '#999'), from('SHP-7', 1, '2026-11-01', '#7'),
      from('SHP-7', 1, '2026-11-01', '#7'), from('SHP-5', 2, '2026-11-02', '#5'), from('SHP-8', 1, '', '#8', 'a.b')],
    [issue('A', 1, { shpOrderNo: 'SHP-999' }), issue('A', 2, { shpOrderNo: 'SHP-5' })]);
    ok('per SKU, oldest first, with pieces and date; the pieces asked only when some were issued', same(need.orders.A,
      [{ no: 'SHP-7', pcs: 2, on: '2026-11-01' }, { no: 'SHP-999', pcs: 3, on: '2026-11-20', of: 4 }, { no: 'SHP-1000', pcs: 2, on: '2026-11-20' }]), JSON.stringify(need));
    ok('an order issued in full is not listed, and each SKU\'s orders add up to its pieces',
      Object.keys(need.skus).every(k => need.orders[k].reduce((n, o) => n + o.pcs, 0) === need.skus[k]) && need.skus.A === 7);
    ok('under a database-safe SKU key; no date, no date field', same(need.orders.A_B, [{ no: 'SHP-8', pcs: 1 }]));
    const blank = N([from('', 1, '2026-11-01', '#1'), from('', 2, '2026-11-02', '#2')], []);
    ok('orders with no production number stay apart, under their Shopify name', same(blank.orders.A.map(o => [o.no, o.pcs]), [['#1', 1], ['#2', 2]]) && blank.skus.A === 3, JSON.stringify(blank));
  }

  console.log('== how old the figure is ==');
  {
    const S = load().fgiHoldState, at = (sp, cpc) => ({ SP: sp && { at: sp }, CPC: cpc && { at: cpc } });
    ok('missing when nothing is noted', S({}, NOW).state === 'missing');
    ok('missing when one store is not noted', S(at(NOW, 0), NOW).state === 'missing' && S(at(0, NOW), NOW).state === 'missing');
    ok('ok at exactly 6 hours', S(at(NOW, NOW - 6 * HOUR), NOW).state === 'ok');
    const st = S(at(NOW - 7 * HOUR, NOW), NOW);
    ok('stale beyond 6 hours, judged on the older store', st.state === 'stale' && st.ageMs === 7 * HOUR);
    const MIN = 60000;
    ok('a clock 10 minutes ahead is allowed', S(at(NOW + 10 * MIN, NOW), NOW).state === 'ok');
    ok('further ahead, in either store, is not trusted', S(at(NOW + 10 * MIN + 1, NOW), NOW).state === 'stale' && S(at(NOW, NOW + HOUR), NOW).state === 'stale');
  }

  console.log('== free for FBA ==');
  {
    const F = load().fgiFbaFree;
    ok('stock 10, need 4: 6 free', F('A', 10, noted(4, 0)) === 6);
    ok('need 15 of 10: none free', F('a', 10, noted(15, 0)) === 0);
    ok('need 15 of 10, 3 released: FBA may take 3 more', F('A', 10, noted(15, 0, { r: release(3) })) === 3);
    ok('never more than the stock, whatever is released', F('A', 10, noted(15, 0, { r: release(20) })) === 10 && F('A', 10, noted(4, 0, { r: release(9) })) === 10);
    ok('a SKU below nought has nothing free', F('A', -2, noted(0, 0, { r: release(3) })) === 0);
    ok('both stores are held', F('A', 10, noted(4, 3)) === 3);
    ok('new arrivals stay held', F('A', 14, noted(15, 0)) === 0 && F('A', 18, noted(15, 0)) === 3);
    ok('released pieces are free again; another SKU\'s and used-up releases are not', F('A', 10, noted(4, 0, { r1: release(2), r2: release(5, '', 'B'), r3: release(0) })) === 8);
    ok('read from the Finished Goods settings when not handed in', load({ set: { _shopHold: noted(4, 0) } }).fgiFbaFree('A') === 6);
  }

  console.log('== noting the figure ==');
  {
    const NOW = Date.now();   // noting a figure is judged against this PC's clock
    const fig = (at, n) => ({ at, by: 'a@example.com', skus: n ? { A: n } : {} });
    const run = async (stored, figure, o) => { const S = load(Object.assign({ db: stored ? { SP: stored } : {} }, o)); await S.shpHoldPublish('SP', figure); return S; };
    ok('the first figure is written, quietly', (await run(null, fig(NOW, 4))).db.writes[0].quiet === true);
    ok('a newer, different figure replaces it', (await run(fig(NOW - 1000, 4), fig(NOW, 5))).db.data.SP.skus.A === 5);
    ok('a figure noted by a clock far ahead is replaced', (await run(fig(NOW + HOUR, 4), fig(NOW, 5))).db.data.SP.skus.A === 5);
    ok('an older read never replaces a newer one', (await run(fig(NOW, 4), fig(NOW - 1000, 5))).db.writes.length === 0);
    ok('unchanged and under an hour old: not written', (await run(fig(NOW - HOUR, 4), fig(NOW, 4))).db.writes.length === 0);
    ok('unchanged but over an hour old: written again', (await run(fig(NOW - HOUR - 1, 4), fig(NOW, 4))).db.writes.length === 1);
    ok('nothing needed, as the database keeps it (no skus): not rewritten', (await run({ at: NOW - 1000, by: 'x' }, fig(NOW, 0))).db.writes.length === 0);
    const raced = await run(fig(NOW - 5000, 1), fig(NOW - 1000, 4), { before: set => set('pt_fgiSettings/_shopHold/SP', fig(NOW, 9)) });
    ok('another PC writes a newer one in between: theirs stays', raced.db.data.SP.skus.A === 9);
    const off = await run(null, fig(NOW, 4), { offline: true });
    ok('a failed read never throws, and the console says why', off.db.writes.length === 0 && /offline/.test(off.warns[0]));
    ok('live: the same read is never written again, even with another need', (await run(fig(NOW, 4), fig(NOW, 5))).db.writes.length === 0);
    ok('live: a read a second newer with the same need waits', (await run(fig(NOW - 1000, 4), fig(NOW, 4))).db.writes.length === 0);
    ok('refused by the rules: said in the console', (await run(null, fig(NOW, 4), { refused: true })).warns.length === 1);
    const named = (at, no) => Object.assign(fig(at, 4), { orders: { A: [{ no, pcs: 4 }] } });
    ok('a figure without its orders is replaced by a newer read that has them', (await run(fig(NOW - 1000, 4), named(NOW, 'SHP-1'))).db.data.SP.orders.A[0].no === 'SHP-1');
    ok('the same pieces for another order are noted again', (await run(named(NOW - 1000, 'SHP-1'), named(NOW, 'SHP-2'))).db.writes.length === 1);
    ok('the same pieces for the same orders wait', (await run(named(NOW - 1000, 'SHP-1'), named(NOW, 'SHP-1'))).db.writes.length === 0);
  }

  console.log('== releases ==');
  {
    const v = { id: 'REL-1', sku: 'a', pieces: 2, reason: 'urgent' };
    const C = load();
    ok('an admin\'s release is saved with who and why', (await C.fgiReleaseCreate(v)) === '' && C.db.data.releases['REL-1'].left === 2 && C.db.data.releases['REL-1'].reason === 'urgent');
    ok('pressed twice: saved once', /already saved/.test(await C.fgiReleaseCreate(v)) && C.db.writes.length === 1);
    for (const [name, bad, o] of [['not an admin', v, { admin: false }], ['no reason', Object.assign({}, v, { reason: ' ' })], ['half a piece', Object.assign({}, v, { pieces: 1.5 })],
      ['nought pieces', Object.assign({}, v, { pieces: 0 })], ['no SKU', Object.assign({}, v, { sku: '' })]]) {
      const R = load(o); ok('refused: ' + name, (await R.fgiReleaseCreate(bad)) !== '' && R.db.writes.length === 0);
    }
    const P = load().fgiReleasePlan, stamp = { by: 'p', at: 't' };
    const hold = noted(4, 0, { newer: release(3, '2026-11-27T02:00:00Z'), older: release(2, '2026-11-26T02:00:00Z') }), before = JSON.stringify(hold);
    ok('within the free pieces: no release used', same(P(hold, [{ sku: 'A', qty: 6, current: 10 }], stamp).used, {}));
    const p = P(hold, [{ sku: 'A', qty: 9, current: 10 }], stamp);
    ok('beyond them: the oldest release first', same(p.used, { older: 2, newer: 1 }) && p.next.newer.left === 2 && p.next.older.left === 0);
    ok('what was used stays on record', same(p.next.older.uses, [{ pcs: 2, by: 'p', at: 't' }]));
    ok('the releases handed in are not changed', JSON.stringify(hold) === before);
    ok('two lines of one SKU are judged together', P(hold, [{ sku: 'A', qty: 6, current: 10 }, { sku: 'a', qty: 6, current: 10 }], stamp).short[0].qty === 12);
    const s = P(hold, [{ sku: 'A', qty: 9, current: 10 }, { sku: 'B', qty: 2, current: 1 }], stamp);
    ok('one SKU short: nothing at all is used', s.short.length === 1 && same(s.used, {}) && s.next === hold.releases);

    const over = noted(15, 0, { r: release(3) });
    ok('orders beyond the stock: a release of 3 is spent on exactly those 3', same(P(over, [{ sku: 'A', qty: 3, current: 10 }], stamp).used, { r: 3 }));
    ok('…and a fourth piece is refused', P(over, [{ sku: 'A', qty: 4, current: 10 }], stamp).short[0].free === 3);

    const spend = async (o, wants) => { const S = load(Object.assign({ db: noted(4, 0, { r: release(2) }) }, o)); return Object.assign(await S.fgiReleaseSpend(wants || [{ sku: 'A', qty: 8, current: 10 }]), { S }); };
    const a = await spend();
    ok('a save uses the release up in the database', a.err === '' && a.used.r === 2 && a.S.db.data.releases.r.left === 0);
    ok('spent once: the same pieces cannot be sent again', /held for website orders/.test((await a.S.fgiReleaseSpend([{ sku: 'A', qty: 2, current: 2 }])).err));
    const b = await spend({ before: set => set('pt_fgiSettings/_shopHold/releases/r/left', 0) });
    ok('somebody else used it in between: refused, not spent twice', b.err !== '' && same(b.used, {}) && b.S.db.writes.length === 0);
    ok('an old figure refuses the save', /6 hours/.test((await spend({ db: noted(4, 0, {}, Date.now() - 7 * HOUR) })).err));
    ok('an unreadable database refuses the save', /could not be checked/.test((await spend({ offline: true })).err));
  }

  await waysToFba();

  console.log('== which orders count (Shopify tab) ==');
  {
    const claims = (orders, o) => shop(Object.assign({ orders }, o)).soHoldClaims('SP');
    ok('an open order counts, under its production number', same(claims([order(1)]), [{ orderNo: 'SHP-1', sku: 'A', sets: 3, perSet: 1, ref: '#1', on: '' }]));
    const dated = claims([order(1, { at: '2026-11-20T10:00:00+05:30', customer: 'Made Up', phone: '000' })])[0];
    ok('it carries the order\'s name and date, and nothing about the customer', dated.ref === '#1' && dated.on === '2026-11-20'
      && same(Object.keys(dated), ['orderNo', 'sku', 'sets', 'perSet', 'ref', 'on']), JSON.stringify(dated));
    for (const [name, o] of [['cancelled', order(1, { cancelledAt: 'x' })], ['shipped', order(1, { ff: 'fulfilled' })], ['marked done', order(1, { note: 'done' })],
      ['MCF done in a note', order(1, { note: 'MCF done' })], ['chargeback', order(1, { tags: 'chargeback' })], ['off the pending sheet', order(1, { offSheet: true })],
      ['Amazon can fill it', order(1, { fba: true })], ['the other store\'s', order(1, { shopBrand: 'CPC' })], ['line already shipped', order(1, {}, { ffl: 'fulfilled' })]]) {
      ok('does not count: ' + name, claims([o]).length === 0);
    }
    ok('does not count: sent to Amazon whole', claims([order(1)], { meta: { 1: { mcfId: 'M' } } }).length === 0);
    ok('a part-shipped line counts only what is left', claims([order(1, { ff: 'partial' }, { fq: 1 })])[0].sets === 1);
    ok('a pack counts its pieces', claims([order(1, {}, { sku: 'PAIR' })])[0].perSet === 2 && claims([order(1, {}, { sku: 'NAP-12' })])[0].perSet === 4);
    ok('the order book\'s number is used', claims([order(1)], { ob: [{ shopOrderId: '1', orderNo: 'SHP-1-X' }] })[0].orderNo === 'SHP-1-X');
    ok('a number another order owns is not borrowed', claims([order(1)], { ob: [{ shopOrderId: '99', orderNo: 'SHP-1' }] })[0].orderNo === '');

    const R = shop().soHoldReadOf, want = { start: '2026-11-13', end: '2026-11-28' }, full = { SP: {}, CPC: {} };
    ok('a full read stamps both stores', same(R(full, want, 7), { SP: 7, CPC: 7 }));
    ok('a failed or cut-off store is not stamped', same(R({ SP: { more: true }, CPC: { err: 'x' } }, want, 7), { SP: 0, CPC: 0 }));
    ok('narrowed dates are not a full read', R(full, { start: '2026-11-14', end: '2026-11-28' }, 7).SP === 0 && R(full, { start: '2026-11-13', end: '2026-11-26' }, 7).SP === 0);

    const pub = async o => { const S = shop(Object.assign({ orders: [order(1)], holdRead: { SP: 7, CPC: 8 } }, o)); await S.soHoldPublish(); return S; };
    const both = await pub();
    ok('each store is noted with the time Shopify was read', same(both.published.map(x => [x.store, x.figure.at]), [['SP', 7], ['CPC', 8]]));
    ok('…with its pieces and the orders behind them', both.published[0].figure.skus.length === 1 && both.published[0].figure.orders.from.length === 1);
    const part = await pub({ holdRead: { SP: 7, CPC: 0 } });
    ok('a partial load leaves that store alone and says so', part.published.length === 1 && part.warns.length === 1);
    ok('switch off: no write at all', (await pub({ on: false })).published.length === 0);
    ok('India stock not in yet: nothing written', (await pub({ indiaAt: '' })).published.length === 0);
    ok('Amazon stock not in: nothing written', (await pub({ stock: false })).published.length === 0);
    ok('no fetch from Shopify (device copy): nothing written', (await pub({ holdRead: undefined })).published.length === 0);
    const down = await pub({ offline: true });
    ok('the store ledger unreadable: nothing written, console says why', down.published.length === 0 && /offline/.test(down.warns[0]));

    console.log('== older unshipped orders ==');
    const stamps = { SP: 7, CPC: 8 };
    const older = async (o, bookIn = true) => { const S = shop(Object.assign({ orders: [order(1)] }, o)); await S.soHoldReadOld(S.SHOP, stamps, bookIn); return S; };
    const A = await older({ old: { SP: { orders: [order(1, {}, { qty: 9 }), order(2)] } } });
    ok('each store is asked for unshipped orders as far back as the tab reaches', same(A.asked.map(x => [x.brand, x.want, x.ids]),
      ['SP', 'CPC'].map(b => [b, { start: '2026-06-30', end: '2026-11-27', open: '1' }, []])), JSON.stringify(A.asked));
    ok('they count, each order once, the one on screen winning', same(A.soHoldClaims('SP').map(c => [c.orderNo, c.sets]).sort(), [['SHP-1', 3], ['SHP-2', 3]]));
    ok('the tab\'s own list is left as it was', A.SHOP.orders.length === 1);
    ok('then both stores are stamped', same(A.SHOP.holdRead, stamps));
    const B = await older({ old: { SP: { more: true }, CPC: { fails: 'timed out' } } });
    ok('a cut-off or failed older read stamps neither', same(B.SHOP.holdRead, { SP: 0, CPC: 0 }) && /timed out/.test(B.SHOP.holdWhy.CPC));
    ok('no order book: neither is stamped', same((await older({}, false)).SHOP.holdRead, { SP: 0, CPC: 0 }));

    console.log('== never silently ==');
    const line = /^Pieces held for website orders were not noted: /;
    for (const [name, o, why] of [['no fetch from Shopify', { holdRead: undefined }, /press Fetch orders/], ['stock not in', { indiaAt: '' }, /stock/],
      ['a store not read', { holdRead: { SP: 7, CPC: 0 } }, /CPC: its orders/], ['the ledger unreadable', { offline: true }, /offline/], ['the save refused', { publishWhy: 'may not' }, /may not/]]) {
      const S = await pub(o);
      ok('said on the tab: ' + name, line.test(S.said[0]) && why.test(S.said[0]) && S.warns.length >= 1, S.said[0]);
    }
    ok('noted: an earlier such line goes', (await pub({ msg: 'Pieces held for website orders were not noted: x' })).msg.textContent === '');
    ok('noted: another message stays', (await pub({ msg: 'other' })).msg.textContent === 'other');
    ok('switch off: nothing said', (await pub({ on: false, holdRead: undefined })).said.length === 0);

    console.log('== the Fetch orders button ==');
    const press = async o => {
      const log = { copy: 0, old: [], full: 0, noted: 0 }, box = { value: '', disabled: false, innerHTML: '', textContent: '' };
      const ctx = { shpHoldOn: () => !o.off, shpOnTestSite: () => !!o.testSite, soCopyMode: () => o.mode || 'copy', SHOP: { orders: [], copy: {} }, soCopyRefresh: async () => { log.copy++; }, soWant: () => ({ start: 's', end: 'e', open: '0' }),
        $: () => box, soMsg() {}, prOn: () => o.gates, ptRegLoaded: r => r === 'ob' && o.book, PTG: { at: o.at }, soOldOpen: () => ({ ids: new Set(), reach: '' }),
        soAskStore: async () => { log.full++; return { orders: [] }; }, soStamp: () => '', soCopyAfterFetch: async () => {}, renderShop() {}, SHOP_FETCHED_AT: 0, SHOP_META: {},
        soPhotosLoad: async () => {}, shpSyncSoon() {}, soHoldReadOf: () => ({ SP: 1, CPC: 1 }), soHoldReadOld: async (s, stamps, bookIn) => { log.old.push(bookIn); }, soHoldPublish() { log.noted++; }, console };
      if (o.shopifyOff) ctx.soAskStore = async () => { log.full++; throw new Error('Live Shopify is off on the test link'); };
      const keys = Object.keys(ctx);
      const rule = from => cut(ORDERS, from, '\n') + '\n';
      const rules = rule('const soHoldBookIn') + rule('const soHoldFromCopy');
      await new Function(...keys, rules + cut(ORDERS, 'async function fetchShopOrders(', 'let SO_ALL_ROWS') + '\n;return fetchShopOrders;')(...keys.map(k => ctx[k]))();
      return log;
    };
    const copyOff = await press({ off: true });
    ok('switch off, copy mode: only what changed is asked, as before', copyOff.copy === 1 && copyOff.full === 0 && copyOff.old.length === 0);
    const onBook = await press({ gates: true, book: true });
    ok('switch on, copy mode: read in full, then the older orders', onBook.copy === 0 && onBook.full === 2 && same(onBook.old, [true]));
    ok('the order book not loaded is passed on', same((await press({ gates: true, book: false })).old, [false]) && same((await press({ gates: false, at: '' })).old, [false]) && same((await press({ gates: false, at: 'x' })).old, [true]));
    ok('live: the figure is not noted before the older orders are read', onBook.noted === 1 && onBook.old.length === 1);
    const testCopy = await press({ testSite: true });
    ok('test website, copy mode: the shortcut is taken, and the figure noted', testCopy.copy === 1 && testCopy.full === 0 && testCopy.noted === 1, JSON.stringify(testCopy));
    const testDirect = await press({ testSite: true, mode: 'direct', shopifyOff: true });
    ok('test website, live Shopify off: noted all the same, and no older orders asked of Shopify', testDirect.noted === 1 && testDirect.old.length === 0, JSON.stringify(testDirect));
    const testOff = await press({ testSite: true, off: true });
    ok('test website with the switch off: nothing noted', testOff.copy === 1 && testOff.noted === 0);
  }

  await testWebsite();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL the suite stopped - ' + e.stack); process.exit(1); });
