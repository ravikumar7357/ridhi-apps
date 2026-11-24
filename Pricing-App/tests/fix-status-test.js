/* FIX STATUS — "Still not fixed on Amazon" (24 Nov 2026, MD task #4): src/app/listing/fix-status.js and its hooks in listing-send-check.js.
 *   node tests/fix-status-test.js
 * Covers: the fix record (what it was meant to fix, taken before the send, on the Listing History row) · ✅ fixed · ⏳ checking · ⚠️ still on
 * Amazon after 24 h · ❌ new error after the fix · fixed in Seller Central (an error gone with no Sellora send) · the stale hint after 3 days
 * · a later fix replaces an earlier one · "Mark as seen" per user · the bell only for Listing users, its count and panel · the Fix status page
 * and CSV · the Listing Health line · nothing written on the test site · not on the Dashboard. */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const APP = path.join(__dirname, '..', 'src', 'app');
const SRC = ['listing/listing-send-check.js', 'listing/fix-status.js'].map(f => `/* ${f} */\n` + fs.readFileSync(path.join(APP, f), 'utf8')).join('\n;\n');
const H = 3600000, DAY = 24 * H, T0 = Date.parse('2026-11-24T10:00:00Z');
function makeEl(id) {
  const cls = new Set();
  return { id, value: '', hidden: false, innerHTML: '', textContent: '', title: '', dataset: {}, style: {}, attrs: {},
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener() {}, querySelector(sel) { return sel === '.fs-badge' ? (this.badge || (this.badge = makeEl('badge'))) : null; },
    querySelectorAll: () => [], closest: () => null, getBoundingClientRect: () => ({ right: 900, bottom: 60 }) };
}
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()), apply: () => stub() });
let STUBS = [];
let RECORD = Promise.resolve();
// The sandbox: one shared Firestore (store: doc id → data), the clock at `now`, the signed-in user `me`.
function app(opt) {
  const o = Object.assign({ now: T0, me: { email: 'asha.k@ridhi.example', admin: false, tabs: ['lerr'] }, store: {}, test: false }, opt);
  for (let tries = 0; tries < 200; tries++) {
    const els = {};
    const $ = id => els[id] || (els[id] = makeEl(id));
    const writes = [];
    const base = { $, els, store: o.store, writes, ME: o.me, console: { log() {}, warn() {}, error() {}, table() {} }, Intl, Math, JSON, Promise, Set, Map, WeakMap, Number, String, Object, Array, RegExp, Error, Symbol, Proxy, isFinite, isNaN, parseInt, parseFloat,
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      window: { __TEST_ERP: o.test, innerWidth: 1440, innerHeight: 900 }, document: { addEventListener() {}, querySelectorAll: () => [], visibilityState: 'visible' },
      db: {}, doc: (db, coll, id) => ({ id }), getDoc: async ref => ({ exists: () => ref.id in o.store, data: () => JSON.parse(JSON.stringify(o.store[ref.id])) }),
      setDoc: async (ref, data, opts) => { writes.push([ref.id, data]); o.store[ref.id] = opts && opts.merge ? deepMerge(o.store[ref.id] || {}, data) : JSON.parse(JSON.stringify(data)); },
      serverTimestamp: () => o.now, onAuthStateChanged() {}, auth: {}, TAB_OK: () => true, HEALTH: o.HEALTH || { SP: { rows: [] }, CPC: { rows: [] } } };
    STUBS.forEach(n => { if (!(n in base)) base[n] = stub(); });
    const ctx = vm.createContext(base);
    vm.runInContext(`(() => { const RD = Date; class FD extends RD { constructor(...a) { if (a.length) super(...a); else super(${o.now}); } static now() { return ${o.now}; } } globalThis.Date = FD; })();`, ctx);
    try {
      vm.runInContext(SRC, ctx, { filename: 'app.js' });
      ctx.run = code => vm.runInContext(code, ctx);
      return ctx;
    } catch (e) {
      const m = /^(\w+) is not defined/.exec(e.message);
      if (m && !STUBS.includes(m[1])) { STUBS.push(m[1]); continue; }
      throw e;
    }
  }
  throw new Error('sandbox: too many missing globals');
}
function deepMerge(a, b) { const out = Object.assign({}, a); Object.keys(b).forEach(k => { out[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], b[k]) : b[k]; }); return out; }
// A Listing History row (a fix record) and a read of the listing.
const row = (o) => Object.assign({ id: 'r' + Math.random().toString(36).slice(2, 8), kind: 'listing', brand: 'SP', sku: 'RQL147-K', asin: 'B0Q', label: 'Quilt', field: 'Unit count', attr: 'unit_count',
  old: '', new: '4', at: T0 - 30 * H, name: 'Asha K', result: 'accepted', screen: 'Listing Errors', run: 'run1',
  fi: [{ c: '90244', s: 'E', m: 'The value for Ounce / Unit Count is missing', a: ['unit_count'] }], e0: ['90244|unit_count'] }, o);
const E = (c, a, m) => ({ s: 'E', c, a: a ? [a] : [], m: m || 'error ' + c });
const compute = (C, rows, reads, sc, now) => C.fsCompute(rows, { fresh: (b, sku) => reads[b + '|' + sku] || null, pics: () => null, sc: sc || {}, now: now || T0 });

console.log('== the states of a fix ==');
{
  const C = app();
  const fixed = compute(C, [row()], { 'SP|RQL147-K': { iss: [], gAt: T0 - 2 * H, at: T0 - 2 * H } })[0];
  eq('fix → a read after it no longer shows 90244 → ✅ Fixed, confirmed at that read', [fixed.state, fixed.confirmedAt], ['fixed', T0 - 2 * H]);
  const still = compute(C, [row()], { 'SP|RQL147-K': { iss: [E('90244', 'unit_count', 'The value for Ounce / Unit Count is missing')], gAt: T0 - H, at: T0 - H } })[0];
  eq('fix → still there 30 h later → ⚠️ Still on Amazon (no stale hint before 3 days)', [still.state, still.hint], ['still', '']);
  const early = compute(C, [row({ at: T0 - 5 * H })], { 'SP|RQL147-K': { iss: [E('90244', 'unit_count')], gAt: T0 - H, at: T0 - H } })[0];
  eq('…5 h after the send, still showing → ⏳ Checking', early.state, 'checking');
  const notRead = compute(C, [row({ at: T0 - 2 * H })], { 'SP|RQL147-K': { iss: [E('90244', 'unit_count')], gAt: T0 - 3 * H, at: T0 - 3 * H } })[0];
  eq('no read since the send → ⏳ Checking (judged only on a read made AFTER the fix)', [notRead.state, notRead.readAt], ['checking', 0]);
  const stale = compute(C, [row({ at: T0 - 4 * DAY })], { 'SP|RQL147-K': { iss: [E('90244', 'unit_count')], gAt: T0 - H, at: T0 - H } })[0];
  eq('still on Amazon 4 days after → the stale hint', [stale.state, stale.hint], ['still', 'Likely stale on Amazon — re-submit once, or open a Seller Central case']);
  const newErr = compute(C, [row()], { 'SP|RQL147-K': { iss: [E('8541', 'swatch_product_image_locator', 'The swatch image is missing')], gAt: T0 - H, at: T0 - H } })[0];
  eq('fix → 90244 gone but a NEW error 8541 appeared → ❌ New error after fix', [newErr.state, newErr.newErr && newErr.newErr.c], ['newerr', '8541']);
  const oldErr = compute(C, [row({ e0: ['90244|unit_count', '5665|item_name'] })], { 'SP|RQL147-K': { iss: [E('5665', 'item_name')], gAt: T0 - H, at: T0 - H } })[0];
  eq('an error the listing already had before the send is not "new" → ✅ (90244 gone)', oldErr.state, 'fixed');
  // a fix with no Amazon issue: the field itself
  const tRow = row({ attr: 'item_name', field: 'Title', fi: [], e0: [], new: 'Ridhi Hand Block Print Quilt Queen 90 x 108 Inch' });
  eq('a title fix (no Amazon issue): the title read after it is the new one → ✅', compute(C, [tRow], { 'SP|RQL147-K': { iss: [], title: 'Ridhi Hand Block Print Quilt Queen 90 x 108 Inch', cAt: T0 - H, gAt: T0 - H, at: T0 - H } })[0].state, 'fixed');
  eq('…Amazon still holds the old title 30 h later → ⚠️', compute(C, [tRow], { 'SP|RQL147-K': { iss: [], title: 'Old quilt title', cAt: T0 - H, gAt: T0 - H, at: T0 - H } })[0].state, 'still');
  const later = compute(C, [row({ id: 'old', at: T0 - 50 * H }), row({ id: 'new', at: T0 - 26 * H })], { 'SP|RQL147-K': { iss: [E('90244', 'unit_count')], gAt: T0 - H, at: T0 - H } });
  eq('two fixes of the same field: only the later one counts', later.map(r => r.id), ['new']);
  eq('a rejected or test-site send is no fix', compute(C, [row({ result: 'rejected' }), row({ result: 'notsent' })], {}).length, 0);
}

console.log('== fixed in Seller Central ==');
{
  const C = app();
  const saved = { at: T0 - 2 * H, e: { 'SP|RTC14': { '90244|unit_count': { s: T0 - 3 * DAY, m: 'The value for Ounce / Unit Count is missing' } }, 'SP|RTC15': { '18320|main_product_image_locator': { s: T0 - DAY, m: 'Main image missing' } } }, sc: {} };
  const cur = new Map([['SP|RTC14', { at: T0 - H, errs: [] }], ['SP|RTC15', { at: T0 - H, errs: [] }]]);
  const rows = [row({ sku: 'RTC15', at: T0 - 5 * H })];                 // Sellora fixed RTC15
  const next = C.fsWatchStep(saved, cur, rows, T0);
  eq('an error gone from a newer read with NO Sellora send → fixed in Seller Central; RTC15 (Sellora sent a fix) is not', Object.keys(next.sc), ['SP|RTC14|90244|unit_count']);
  eq('…its record: code, words, when it was first seen and when it was gone', [next.sc['SP|RTC14|90244|unit_count'].c, next.sc['SP|RTC14|90244|unit_count'].seen, next.sc['SP|RTC14|90244|unit_count'].gone], ['90244', T0 - 3 * DAY, T0 - H]);
  const rec = compute(C, [], {}, next.sc).find(r => r.by === 'sc');
  eq('…in the list: "✅ Fixed in Seller Central", who = Seller Central', [rec.state, rec.who, C.run('FS_STATES')[rec.state]], ['scfixed', 'Seller Central', '✅ Fixed in Seller Central']);
  const again = C.fsWatchStep(next, new Map([['SP|RTC14', { at: T0 - H, errs: [] }]]), [], T0 + H);
  eq('the watch keeps no error that is gone; a listing not read now keeps what it had', [Object.keys(again.e), Object.keys(again.sc).length], [[], 1]);
  const older = C.fsWatchStep({ at: T0, e: saved.e, sc: {} }, new Map([['SP|RTC14', { at: T0 - H, errs: [] }]]), [], T0);
  eq('a read OLDER than the watch is no proof → nothing recorded', Object.keys(older.sc).length, 0);
  const first = C.fsWatchStep({}, new Map([['SP|RTC14', { at: T0, errs: [{ k: '90244|unit_count', m: 'x' }] }]]), [], T0);
  eq('the first time: the errors are only remembered (first seen now)', [first.e['SP|RTC14']['90244|unit_count'].s, Object.keys(first.sc).length], [T0, 0]);
}

console.log('== the fix record, written by the one send path ==');
{
  const C = app();
  C.run(`lmOk = () => true; liWsLiveMap = () => ({ live: {} });
    lmLiveOf = (b, sku) => ({ iss: [{ s: 'E', c: '90244', m: 'The value for Ounce / Unit Count is missing', a: ['unit_count'] }, { s: 'W', c: '99300', m: 'Your image PT03 is small', a: [] }, { s: 'E', c: '5665', m: 'Title too long', a: ['item_name'] }], gAt: ${T0 - 2 * H}, at: ${T0 - 2 * H} });`);
  const info = C.run(`fsJobInfo({ brand: 'SP', sku: 'RQL147-K', changes: [{ attr: 'unit_count' }, { attr: 'PT03', pic: true }] })`);
  eq('taken before the send: the issues about each field (unit_count → 90244; PT03 → the message naming PT03)', [info.byAttr.unit_count.map(i => i.c), info.byAttr.PT03.map(i => i.c)], [['90244'], ['99300']]);
  eq('…and every ERROR the listing had then', info.e0, ['90244|unit_count', '5665|item_name']);
  ok('sqSendWithCheck takes it for each job BEFORE anything is sent', /run\.jobs\.forEach\(job => \{ if \(!job\.fx && typeof fsJobInfo === 'function'\)/.test(fs.readFileSync(path.join(APP, 'listing/listing-send-check.js'), 'utf8')));
  const rows = C.run(`sqLogRows({ brand: 'SP', sku: 'RQL147-K', asin: 'B0Q', label: 'Quilt', body: { lfix: 'patch', productType: 'QUILT' }, changes: [{ field: 'Unit count', old: '', new: '4', attr: 'unit_count' }], state: 'accepted',
    fx: fsJobInfo({ brand: 'SP', sku: 'RQL147-K', changes: [{ attr: 'unit_count' }] }) }, { opts: { screen: 'Listing Errors' }, at: ${T0}, jobs: [1] })`);
  ok('the Listing History row carries it: SKU, brand, field, time, who — and fi (what it meant to fix) + e0', rows.length === 1 && rows[0].sku === 'RQL147-K' && rows[0].brand === 'SP' && rows[0].attr === 'unit_count' && rows[0].at === T0
    && rows[0].fi[0].c === '90244' && rows[0].fi[0].m === 'The value for Ounce / Unit Count is missing' && rows[0].e0.length === 2, JSON.stringify(rows[0]).slice(0, 300));
  RECORD = (async () => {
    const W = app();
    const r1 = Object.assign({}, rows[0]);
    await W.run('lhistAdd')([r1], { at: T0, logDocs: new Map() });
    const docId = Object.keys(W.store).find(k => /^listing_/.test(k));
    ok('lhistAdd writes it to the shared /history log (one place, every user)', !!docId && W.store[docId].rows[r1.id].fi[0].c === '90244');
    const changed = Object.assign({}, r1, { result: 'accepted', fi: [], e0: [] });
    await W.run('lhistAdd')([changed], { at: T0, logDocs: new Map([[r1.id, docId]]) });
    ok('…written again (Check again): the record keeps what it was meant to fix', W.store[docId].rows[r1.id].fi[0].c === '90244');
    const T = app({ test: true });
    eq('the test site writes nothing (the log, and so no fix record)', [await T.run('lhistAdd')([r1], { at: T0 }), Object.keys(T.store).length], ['', 0]);
  })();
}

async function bellTests() {
  console.log('== the bell: Listing users only, its count, "Mark as seen" per user ==');
  const store = {};
  const rows = [row({ id: 'still1', at: T0 - 30 * H }), row({ id: 'fixed1', sku: 'RTC9', at: T0 - 3 * H }), row({ id: 'new1', sku: 'RTC10', at: T0 - 6 * H, run: 'run2' }), row({ id: 'new1b', sku: 'RTC10', attr: 'item_name', field: 'Title', fi: [], at: T0 - 6 * H, run: 'run2' })];
  const reads = { 'SP|RQL147-K': { iss: [E('90244', 'unit_count')], gAt: T0 - H, at: T0 - H }, 'SP|RTC9': { iss: [], gAt: T0 - H, at: T0 - H }, 'SP|RTC10': { iss: [E('8541', 'swatch_product_image_locator')], gAt: T0 - H, at: T0 - H } };
  const setup = C => { C.run(`FS.on = true; FS.loaded = true; FS.rows = ${JSON.stringify(rows)}; fsFresh = (b, sku) => (${JSON.stringify(reads)})[b + '|' + sku] || null; fsPics = () => null; FS.sig = null;`); C.run('FS.recs = fsCompute(FS.rows, { fresh: fsFresh, pics: fsPics, sc: {}, now: ' + T0 + ' })'); };
  const A = app({ store, me: { email: 'asha.k@ridhi.example', tabs: ['lerr'] } });
  setup(A);
  A.run('fsBellDraw()');
  eq('count = ⚠️ + ❌ not yet seen: 1 still + 1 new error (a send that changed two fields is ONE new error)', [A.$('fsBell').hidden, A.$('fsBell').badge.textContent, A.$('fsBell').badge.hidden], [false, '2', false]);
  const panel = strip(A.run('fsPanelHtml(' + T0 + ')'));
  ok('the panel: SKU · the issue in words · "fixed 30 hours ago — Amazon still shows it" · Open listing · Mark as seen', /RQL147-K Ridhi The value for Ounce \/ Unit Count is missing \(90244\) fixed 30 hours ago — Amazon still shows it Open listing Mark as seen/.test(panel), panel.slice(0, 400));
  ok('…the new error: "a new error appeared: error 8541"', /fixed 6 hours ago — a new error appeared: error 8541/.test(panel));
  ok('…at the bottom: "✅ 1 fix confirmed by Amazon today" and "See all fix status →"', /✅ 1 fix confirmed by Amazon today See all fix status →/.test(panel));
  await A.run('fsMarkSeen')('still1');
  eq('Mark as seen → the count drops to 1; the item stays in the full list', [A.$('fsBell').badge.textContent, A.run('FS.recs.some(r => r.id === "still1")'), /RQL147-K/.test(strip(A.run('fsPageHtml()')))], ['1', true, true]);
  const seenDoc = Object.keys(store).find(k => /^fixseen_/.test(k));
  ok('…remembered for this user (history/fixseen_<id from the e-mail> — never the e-mail itself)', !!seenDoc && 'still1' in store[seenDoc].seen && !/asha/i.test(seenDoc), seenDoc);
  const B = app({ store, me: { email: 'ravi.s@ridhi.example', tabs: ['health'] } });
  setup(B);
  await B.run('fsSeenLoad')();
  B.run('fsBellDraw()');
  eq('another user still sees 2: "seen" is per user', [B.run('fsSeenId()') !== A.run('fsSeenId()'), B.$('fsBell').badge.textContent], [true, '2']);
  const A2 = app({ store, me: { email: 'asha.k@ridhi.example', tabs: ['lerr'] } });
  setup(A2);
  await A2.run('fsSeenLoad')();
  A2.run('fsBellDraw()');
  eq('…and Asha on another computer: still 1 (her marks come from the shared store)', A2.$('fsBell').badge.textContent, '1');
  const N = app({ me: { email: 'sales.only@ridhi.example', tabs: ['sales', 'ppcn'] } });
  await N.run('fsStart')();
  eq('a user without Listing access: no bell at all', [N.run('fsMay()'), N.run('FS.on'), N.$('fsBell').hidden], [false, false, true]);
  eq('…Listing users (Image Manager, Listing Errors, Listing Health…) and admins do get it', [app({ me: { email: 'x@y.z', tabs: ['img'] } }).run('fsMay()'), app({ me: { email: 'x@y.z', admin: true, tabs: [] } }).run('fsMay()')], [true, true]);
  const Z = app({ me: { email: 'x@y.z', tabs: ['lerr'] } });
  Z.run('FS.on = true; FS.rows = []; FS.recs = []; fsBellDraw()');
  eq('no records (a test / local build with no sends): the bell shows no count', Z.$('fsBell').badge.hidden, true);

  console.log('== Fix status page, CSV, the Listing Health line ==');
  const page = strip(A.run('fsPageHtml()'));
  ok('summary chips: ✅ Fixed 1 · ⏳ Checking 0 · ⚠️ Still on Amazon 1 · ❌ New error 2 · Fixed in Seller Central 0', /✅ Fixed 1 ⏳ Checking 0 ⚠️ Still on Amazon 1 ❌ New error 2 Fixed in Seller Central 0/.test(page), page.slice(0, 200));
  ok('the table: SKU, brand, issue, fixed by, who, sent at, last checked, state, hint, Open listing', /SKU Brand Issue Fixed by Who Sent at Last checked State Hint/.test(page) && /RQL147-K Ridhi The value for Ounce \/ Unit Count is missing \(90244\) Sellora Asha K/.test(page));
  A.run("FS.f.state = 'still'");
  ok('filter by state: only ⚠️', /Results: 1/.test(strip(A.run('fsPageHtml()'))));
  const csv = A.run('fsCsv(fsPageRecs())');
  ok('CSV: the same columns, the rows the filters keep', /^﻿SKU,Brand,Issue,Code,Fixed by,Who,Sent at,Last checked,State,New error,Hint\r\nRQL147-K,Ridhi,The value for Ounce \/ Unit Count is missing,90244,Sellora,Asha K,/.test(csv), csv.slice(0, 200));
  ok('Listing Health line: "Fixed in Sellora on 23 Nov — ⚠️ Amazon still shows it (30 h)"', /Fixed in Sellora on 23 Nov — ⚠️ Amazon still shows it \(30 h\)/.test(A.run("fsKidLine('SP', 'RQL147-K')")), A.run("fsKidLine('SP', 'RQL147-K')"));
  ok('…"✅ Fixed — confirmed 24 Nov"', /✅ Fixed — confirmed 24 Nov/.test(A.run("fsKidLine('SP', 'RTC9')")));

  console.log('== the bell is always clickable: 0 items, the test site, before the data is in ==');
  {
    const okRows = [row({ id: 'ok1', sku: 'RTC9', at: T0 - 3 * H }), row({ id: 'chk1', sku: 'RTC11', at: T0 - 2 * H })];
    const okReads = { 'SP|RTC9': { iss: [], gAt: T0 - H, at: T0 - H }, 'SP|RTC11': { iss: [E('90244', 'unit_count')], gAt: T0 - H, at: T0 - H } };
    const Z0 = app();
    Z0.run(`FS.on = true; FS.loaded = true; FS.rows = ${JSON.stringify(okRows)}; FS.recs = fsCompute(FS.rows, { fresh: (b, sku) => (${JSON.stringify(okReads)})[b + '|' + sku] || null, pics: () => null, sc: {}, now: ${T0} }); fsBellDraw();`);
    eq('0 items: no red count', Z0.$('fsBell').badge.hidden, true);
    Z0.run('fsPanel(true)');
    const p0 = strip(Z0.$('fsPanel').innerHTML);
    ok('…a click still opens the panel: "✅ All fixes accepted by Amazon — nothing waiting." + "✅ 1 fix confirmed by Amazon today" + "See all fix status →"', Z0.run('FS.open') === true && Z0.$('fsPanel').hidden === false
      && /✅ All fixes accepted by Amazon — nothing waiting\./.test(p0) && /✅ 1 fix confirmed by Amazon today/.test(p0) && /See all fix status →/.test(p0), p0);
    ok('…and says a recent one is still being checked (not called accepted yet)', /⏳ 1 recent fix is still being checked/.test(p0));
    const none = app();
    none.run('FS.on = true; FS.loaded = true; FS.rows = []; FS.recs = []; fsPanel(true)');
    const pn = strip(none.$('fsPanel').innerHTML);
    ok('…no fix at all: the same words, no "confirmed today" line', /✅ All fixes accepted by Amazon — nothing waiting\./.test(pn) && !/confirmed by Amazon today/.test(pn) && /See all fix status →/.test(pn), pn);
    const seenAll = app();
    seenAll.run(`FS.on = true; FS.loaded = true; FS.rows = ${JSON.stringify([row({ id: 'still9' })])}; FS.recs = fsCompute(FS.rows, { fresh: () => ({ iss: [${JSON.stringify(E('90244', 'unit_count'))}], gAt: ${T0 - H}, at: ${T0 - H} }), pics: () => null, sc: {}, now: ${T0} }); FS.seen.add('still9'); fsBellDraw(); fsPanel(true)`);
    ok('…everything marked as seen: no red count, and it does not claim all were accepted', seenAll.$('fsBell').badge.hidden === true && /Nothing new waiting — the 1 you marked as seen is still in Fix status\./.test(strip(seenAll.$('fsPanel').innerHTML)));
    const Tst = app({ test: true });
    Tst.run(`FS.on = true; FS.loaded = true; FS.rows = ${JSON.stringify(rows)}; FS.recs = fsCompute(FS.rows, { fresh: (b, sku) => (${JSON.stringify(reads)})[b + '|' + sku] || null, pics: () => null, sc: {}, now: ${T0} }); fsBellDraw(); fsPanel(true)`);
    const pt = strip(Tst.$('fsPanel').innerHTML);
    ok('test site: no red count (even with records), the panel opens with the test words + "See all fix status →"', Tst.$('fsBell').badge.hidden === true && Tst.run('FS.open') === true
      && /Test site — fixes aren't sent to Amazon here, so there's nothing to track\. Real fix status shows on live Sellora\./.test(pt) && /See all fix status →/.test(pt) && !/Mark as seen/.test(pt), pt);
    const early = app();
    early.run('FS.on = true; FS.rows = null; FS.recs = []; fsPanel(true)');
    ok('before the fixes are read: the panel opens and says it is checking (never "all accepted" too early)', early.run('FS.open') === true && /Checking your fixes against Amazon…/.test(strip(early.$('fsPanel').innerHTML)) && !/All fixes accepted/.test(early.$('fsPanel').innerHTML));
  }

  console.log('== an old fix (before the bell): ✅ only when the field is right AND Amazon shows no issue on it ==');
  {
    const C = app();
    const old = o => { const r = row(o); delete r.fi; delete r.e0; return r; };
    const ounce = { s: 'W', c: '90244', a: [], m: 'The value for Ounce / Unit Count is missing' };
    const st = (r, iss) => compute(C, [r], { 'SP|RQL147-K': { iss, gAt: T0 - H, at: T0 - H } })[0];
    const a = st(old({ at: T0 - 30 * H }), [ounce]);
    eq('old Unit count fix, Amazon still shows Ounce 90244 on it (a warning, no attribute named) → ⚠️ Still on Amazon, not ✅', [a.state, a.code, a.issue], ['still', '90244', 'The value for Ounce / Unit Count is missing']);
    eq('…4 days on → the stale hint', st(old({ at: T0 - 4 * DAY }), [ounce]).hint, 'Likely stale on Amazon — re-submit once, or open a Seller Central case');
    eq('…5 h after the send → ⏳ Checking', st(old({ at: T0 - 5 * H }), [ounce]).state, 'checking');
    eq('…an issue naming the attribute (unit_count_type) counts too', st(old({ at: T0 - 30 * H }), [{ s: 'W', c: '99001', a: ['unit_count_type'], m: 'x' }]).state, 'still');
    eq('…Amazon shows nothing on that field → ✅ Fixed', st(old({ at: T0 - 30 * H }), [{ s: 'E', c: '5665', a: ['item_name'], m: 'Title too long' }]).state, 'fixed');
    const t = old({ attr: 'item_name', field: 'Title', new: 'New quilt title', at: T0 - 30 * H });
    eq('old title fix: the title is the new one but Amazon still has an issue on item_name → ⚠️, not ✅', compute(C, [t], { 'SP|RQL147-K': { iss: [{ s: 'W', c: '8016', a: ['item_name'], m: 'Title has a word that is not allowed' }], title: 'New quilt title', cAt: T0 - H, gAt: T0 - H, at: T0 - H } })[0].state, 'still');
    eq('…the title right and no issue on it → ✅', compute(C, [t], { 'SP|RQL147-K': { iss: [], title: 'New quilt title', cAt: T0 - H, gAt: T0 - H, at: T0 - H } })[0].state, 'fixed');
  }

  console.log('== the shared watch and summary: never on the test site ==');
  const S = {};
  const L = app({ store: S, test: false, HEALTH: { SP: { rows: [{ sku: 'RQL147-K' }] }, CPC: { rows: [] } } });
  setup(L);
  await L.run('fsShare')();
  ok('live: the watch (history/fixwatch) and the ⚠️/❌ summary the daily email reads (history/fixstatus) are kept', !!S.fixwatch && Array.isArray(S.fixstatus.items) && S.fixstatus.items.some(i => i.sku === 'RQL147-K' && i.state === 'still'));
  const TS = {};
  const TT = app({ store: TS, test: true, HEALTH: { SP: { rows: [{ sku: 'RQL147-K' }] }, CPC: { rows: [] } } });
  setup(TT);
  await TT.run('fsShare')();
  eq('test site: nothing written', Object.keys(TS).length, 0);
  const dash = fs.readFileSync(path.join(APP, 'core/dashboard.js'), 'utf8');
  ok('not on the main Dashboard', !/fsBell|fsUnseen|fsCompute|Fix status/.test(dash));
}

Promise.resolve().then(async () => {
  await RECORD;
  await bellTests();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch(e => { console.log('TEST ERROR', e && e.stack || e); process.exit(1); });
