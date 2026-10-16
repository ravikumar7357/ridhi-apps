/* FAST SHOPIFY ORDERS, phases 0–2 (docs/shopify-fast-orders/PLAN.md) — the device copy and the script behind it.
 *   node tests/shopify-copy-test.js          (part of npm run check)
 * What must hold:
 *   - the merge keeps Shopify's newest word on every order, drops a voided one, and does not let an overlap echo
 *     undo a change made here;
 *   - every "changed since" starts five minutes before the last one ended;
 *   - finished orders older than 90 days leave the copy, open ones never do;
 *   - a shipped or cancelled order keeps no name, address, phone or email;
 *   - a copy in another format, of another account, or a week unused is thrown away, never read;
 *   - THE ORDER FORMAT CANNOT CHANGE WITHOUT THE VERSION NUMBER CHANGING (see VERSIONS below);
 *   - the script: by date (Shopify filters "not shipped"), by id, changed since; no `customer`; the cursor on
 *     Shopify's clock; photos only when asked.
 * Nothing here reaches Shopify, Apps Script or Firestore. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(process.env.SO_COPY_SRC || path.join(ROOT, 'src', 'app', 'shopify', 'shopify-copy.js'), 'utf8');
const GS = fs.readFileSync(process.env.SO_GS || path.join(ROOT, '..', 'Pricing-API', 'Shopify.gs'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();
const dayOf = ms => iso(ms).slice(0, 10);

/* THE ORDER FORMAT, PER VERSION. When an order's fields change — in Shopify.gs or in what the app adds — this test
 * fails. Raise SO_COPY.ver in shopify-copy.js and add the new line here; a copy written in the old format is then
 * thrown away instead of being read as if it were the new one. */
const VERSIONS = {
  1: 'order:at,cancelReason,cancelledAt,channel,cur,email,ff,fin,id,items,no,note,refUnits,ship,shippedAt,shopBrand,tags,total,trk,trkCo,trkUrl,upd'
    + '|ship:a1,a2,city,company,country,name,phone,state,zip'
    + '|item:cq,ffl,fq,grams,img,lid,name,pid,price,qty,rq,sku,variant,vid',
};

/* ================= the script (Pricing-API/Shopify.gs), run against a fake Shopify ================= */
function script(pages, opts) {
  opts = opts || {};
  const calls = [];
  const ctx = { console, Date, JSON, Math, String, Number, encodeURIComponent, decodeURIComponent, Utilities: { sleep() {} } };
  vm.createContext(ctx);
  vm.runInContext(GS, ctx);
  let n = 0;
  ctx.shopifyGet_ = p => {
    calls.push(p);
    if (/\/shop\.json/.test(p)) return { json: { shop: { iana_timezone: 'America/New_York' } }, link: '', date: '' };
    const pg = pages[Math.min(n++, pages.length - 1)];
    return { json: { orders: clone(pg.orders) }, link: pg.next ? '<https://x/orders.json?page_info=' + pg.next + '>; rel="next"' : '',
      date: pg.date || '' };
  };
  ctx.shopifyAttachImages_ = orders => { ctx.photoPass = (ctx.photoPass || 0) + 1; orders.forEach(o => o.items.forEach(i => { i.img = 'img'; })); };
  return { ctx, calls, run: (...a) => ctx.shopifyOrders_(...a) };
}
const raw = (id, over) => Object.assign({
  id, name: '#' + id, order_number: id, created_at: '2026-10-10T10:00:00-04:00', updated_at: '2026-10-10T11:00:00-04:00',
  cancelled_at: null, cancel_reason: null, financial_status: 'paid', fulfillment_status: null, currency: 'USD', total_price: '20.00',
  shipping_address: { first_name: 'Ann', last_name: 'Lee', address1: '1 Main St', city: 'Austin', province_code: 'TX', zip: '78701', country_code: 'US', phone: '555' },
  email: 'ann@x.com', phone: '', note: '', tags: '', fulfillments: [], refunds: [],
  line_items: [{ id: 9, sku: 'S1', title: 'Quilt', variant_title: 'Red', quantity: 1, price: '20', grams: 500, product_id: 7, variant_id: 8, fulfillable_quantity: 1, current_quantity: 1, fulfillment_status: null }],
}, over || {});

console.log('THE SCRIPT');
{
  const S = script([{ orders: [raw(1), raw(2, { fulfillment_status: 'fulfilled' })], date: 'Thu, 15 Oct 2026 10:00:00 GMT' }]);
  const r = S.run('2026-10-01', '2026-10-15', true, 0, { photos: false });
  ok('by date, "not shipped": Shopify is asked to leave the shipped ones out', /fulfillment_status=unfulfilled/.test(S.calls[0]));
  ok('…and the filter still stands behind it', r.orders.length === 1 && r.orders[0].id === '1');
  ok('`customer` is no longer asked for', !/[,=]customer[,&]/.test(S.calls[0]) && /updated_at/.test(S.calls[0]));
  ok('no photo pass unless asked', !S.ctx.photoPass && !r.orders[0].items[0].img);
  ok('the answer says how it was asked', r.mode === 'dates' && r.tz === 'America/New_York');
  ok('each order carries Shopify\'s updated_at', r.orders[0].upd === '2026-10-10T11:00:00-04:00');
  ok('cursor = the earlier of Shopify\'s clock and its newest change', r.cursor === iso(Date.parse('2026-10-10T11:00:00-04:00')), r.cursor);
  const S2 = script([{ orders: [raw(1)] }]);
  S2.run('2026-10-01', '2026-10-15', false);
  ok('every order, and a call made the old way still gets its photos', !/fulfillment_status=/.test(S2.calls[0]) && S2.ctx.photoPass === 1);

  /* THE VERSION GUARD: the format of an order, as the script makes it and the app adds to it. */
  const o = r.orders[0];
  const shape = 'order:' + Object.keys(Object.assign({}, o, { shopBrand: '', channel: '' })).sort().join(',')
    + '|ship:' + Object.keys(o.ship).sort().join(',')
    + '|item:' + Object.keys(Object.assign({}, o.items[0], { img: '' })).sort().join(',');
  const verM = SRC.match(/ver:\s*(\d+)/);
  const ver = verM ? Number(verM[1]) : 0;
  ok('THE ORDER FORMAT MATCHES ITS VERSION NUMBER (raise SO_COPY.ver and add a line to VERSIONS when it changes)',
    VERSIONS[ver] === shape, 'SO_COPY.ver ' + ver + '\n      now:      ' + shape + '\n      recorded: ' + VERSIONS[ver]);
}
{
  const ids = Array.from({ length: 260 }, (_, i) => String(1000 + i)).join(',');
  const S = script([{ orders: [raw(1000, { created_at: '2026-08-01T10:00:00-04:00' })] }, { orders: [] }]);
  const r = S.run(undefined, undefined, false, 0, { ids, photos: false });
  ok('by id: 250 a request, no dates, nothing trimmed', S.calls.length === 2 && /ids=1000,/.test(S.calls[0]) && !/created_at_min/.test(S.calls[0])
    && r.mode === 'ids' && r.orders.length === 1 && r.tz === '');
}
{
  const S = script([{ orders: [raw(5, { created_at: '2026-07-01T10:00:00-04:00', fulfillment_status: 'fulfilled', updated_at: '2026-10-15T05:00:00-04:00' }),
    raw(6, { financial_status: 'voided', updated_at: '2026-10-15T05:01:00-04:00' })], next: 'P2', date: 'Thu, 15 Oct 2026 08:59:00 GMT' }]);
  const r = S.run(undefined, undefined, false, Date.now() - 1, { since: '2026-10-15T08:00:00.000Z', photos: false });
  ok('changed since: asks by updated_at_min, all statuses', /updated_at_min=2026-10-15T08%3A00%3A00.000Z/.test(S.calls[0]) && /status=any/.test(S.calls[0]));
  ok('…keeps an OLD order and a SHIPPED one — the copy needs to know both', r.orders[0].id === '5' && r.orders[0].ff === 'fulfilled');
  ok('…a voided order comes back as a removal', r.orders[1].gone === 'voided' && r.orders[1].id === '6');
  ok('…out of time, it says where it stopped', r.more && r.next === 'P2');
  ok('…and the cursor is Shopify\'s clock (its first reply), not the newest change, when that is earlier',
    r.cursor === '2026-10-15T08:59:00.000Z', r.cursor);
  const S2 = script([{ orders: [] }]);
  S2.run(undefined, undefined, false, 0, { since: '2026-10-15T08:00:00.000Z', next: 'P2', photos: false });
  ok('…and goes on from there when asked', /page_info=P2/.test(S2.calls[0]));
}

/* ================= the device copy (src/app/shopify/shopify-copy.js) ================= */
function fakeIdb() {
  const dbs = new Map();
  const later = f => setTimeout(f, 0);
  return { dbs, indexedDB: {
    open: name => {
      const req = {};
      if (!dbs.has(name)) dbs.set(name, new Map());
      const store = dbs.get(name);
      const db = { objectStoreNames: { contains: () => true }, createObjectStore: () => {}, close: () => {},
        transaction: () => { const tx = {}; const st = {
          get: k => { const q = { result: clone(store.get(k)) }; later(() => tx.oncomplete && tx.oncomplete()); return q; },
          put: (v, k) => { store.set(k, clone(v)); const q = { result: k }; later(() => tx.oncomplete && tx.oncomplete()); return q; },
          delete: k => { store.delete(k); const q = { result: undefined }; later(() => tx.oncomplete && tx.oncomplete()); return q; } };
          tx.objectStore = () => st; return tx; } };
      later(() => { req.result = db; req.onsuccess && req.onsuccess(); });
      return req;
    },
    deleteDatabase: name => { const r = {}; dbs.delete(name); later(() => r.onsuccess && r.onsuccess()); return r; },
  } };
}

function world(opts) {
  opts = opts || {};
  const idb = opts.idb || fakeIdb();
  const ls = new Map(Object.entries(opts.ls || {}));
  const asks = [], msgs = [];
  const prGet = async p => {
    asks.push(clone(p));
    if (opts.prGet) return opts.prGet(p);
    return { ok: true, orders: [] };
  };
  const ctx = {
    indexedDB: idb.indexedDB, navigator: { storage: { persist: async () => true } },
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) },
    auth: { currentUser: { uid: opts.uid || 'u1' } }, ME: { email: 'x@y' },
    prGet, sdToday: () => dayOf(Date.now()), sdShift: (d, n) => dayOf(Date.parse(d + 'T00:00:00Z') + n * DAY),
    SHP_REACH_MAX_DAYS: 150, PTG: { ob: opts.ob || [] }, SHOP_META: opts.meta || {}, adjOpen: () => true,
    soStamp: () => 'now', soMsg: (t, bad) => msgs.push([t, !!bad]), renderShop: () => {}, shpSyncSoon: () => {},
    console: { info() {}, warn() {}, log() {} }, window: {}, setInterval: () => 0,
    $: id => (opts.els || {})[id] || null,
    /* Firestore, as the app's SDK sees it — the same map the script's fake REST writes into (phase 3). */
    db: {}, doc: (d, c, id) => ({ path: c + '/' + id }),
    getDoc: async r => { const fsm = opts.fs || new Map(); (opts.reads || []).push(r.path); return { exists: () => fsm.has(r.path), data: () => ({ json: JSON.stringify(fsm.get(r.path)) }) }; },
    onSnapshot: () => () => {},
    soWant: () => opts.want,
    fetchShopOrders: async o => { (opts.fell || []).push(o); },
  };
  const names = 'SO_COPY, soCopyMode, soCopySetMode, soCopyMs, soCopyDone, soCopyStrip, soCopyMerge, soCopyAskFrom, soCopyPrune, soCopyStale, '
    + 'soCopyCovers, soCopyView, soCopyDiff, soCopyRead, soCopyPut, soCopyGet, soCopyWipe, soCopyRecord, soCopyRefresh, soCopyOpen, '
    + 'soCopyAfterFetch, soCopyTouch, soCopyReport, soOldOpen, soAskStore, soPhotosLoad, soPhotosApply, getSHOP: () => SHOP, setSHOP: v => { SHOP = v; }, '
    + 'getFetched: () => SHOP_FETCHED_AT, soCopySharedOn, soSharedDaysToRead, soSharedApplyDay, soCopyAge, soCopyAgeShow, soCopySyncLog, soCopyCountDiff, soCopyCountFix, soCopyCountRun';
  const fn = new Function(...Object.keys(ctx), 'let SHOP = { orders: [] }, SHOP_FETCHED_AT = 0;\n' + SRC + '\n;return { ' + names + ' };');
  return Object.assign(fn(...Object.values(ctx)), { idb, ls, asks, msgs });
}
const ord = (id, over) => Object.assign({ id: String(id), upd: '2026-10-15T10:00:00Z', no: '#' + id, at: '2026-10-10', cancelledAt: '', ff: 'unfulfilled',
  email: 'a@b.c', ship: { name: 'Ann Lee', company: '', a1: '1 Main St', a2: '', city: 'Austin', state: 'TX', zip: '78701', country: 'US', phone: '555' },
  items: [{ sku: 'S1', qty: 1, pid: '7', vid: '8' }], shopBrand: 'SP', channel: 'Shopify' }, over || {});

(async () => {
  console.log('MERGE');
  {
    const A = world();
    const m = {};
    let r = A.soCopyMerge(m, [ord(1), ord(2)]);
    ok('new orders are added', r.added === 2 && m['1'] && m['2']);
    r = A.soCopyMerge(m, [ord(1, { upd: '2026-10-15T11:00:00Z', ff: 'partial' })]);
    ok('a newer version replaces it — Shopify is the master', r.changed === 1 && m['1'].ff === 'partial');
    r = A.soCopyMerge(m, [ord(1, { upd: '2026-10-15T10:30:00Z', ff: 'unfulfilled' })]);
    ok('an OLDER version (an overlap echo) does not undo a newer one', r.kept === 1 && m['1'].ff === 'partial');
    r = A.soCopyMerge(m, [ord(1, { upd: '2026-10-15T11:00:00Z', ff: 'unfulfilled' })]);
    ok('the SAME version from Shopify replaces ours (Shopify wins)', m['1'].ff === 'unfulfilled');
    m['2'] = Object.assign(ord(2, { ff: 'fulfilled' }), { mine: Date.now() });
    r = A.soCopyMerge(m, [ord(2)]);
    ok('a change made HERE survives an echo of the same version…', r.kept === 1 && m['2'].ff === 'fulfilled');
    A.soCopyMerge(m, [ord(2, { upd: '2026-10-15T12:00:00Z', ff: 'fulfilled', trk: ['T1'] })]);
    ok('…until Shopify sends a newer one, which wins', m['2'].trk[0] === 'T1' && !m['2'].mine);
    r = A.soCopyMerge(m, [{ id: '1', gone: 'voided' }]);
    ok('a voided order leaves the copy', r.removed === 1 && !m['1']);
  }

  console.log('OVERLAP');
  {
    const A = world();
    ok('every "changed since" starts five minutes before the cursor', A.soCopyAskFrom('2026-10-15T10:00:00.000Z') === '2026-10-15T09:55:00.000Z');
    ok('…on any offset Shopify writes it in', A.soCopyAskFrom('2026-10-15T06:00:00-04:00') === '2026-10-15T09:55:00.000Z');
    ok('no cursor, no "since" — the copy is filled the full way', A.soCopyAskFrom('') === '');
  }

  console.log('PRUNE');
  {
    const A = world(), now = Date.parse('2026-10-15T12:00:00Z');
    const m = { a: ord('a', { at: '2026-06-01', ff: 'fulfilled' }), b: ord('b', { at: '2026-06-01' }), c: ord('c', { at: '2026-10-01', ff: 'fulfilled' }),
      d: ord('d', { at: '2026-07-01', cancelledAt: '2026-07-02' }), e: ord('e', { at: '2026-07-18', ff: 'fulfilled' }) };
    const n = A.soCopyPrune(m, now);
    ok('finished orders older than 90 days go (shipped and cancelled)', n === 2 && !m.a && !m.d);
    ok('an OPEN order stays, however old', !!m.b);
    ok('recent finished orders stay, and the 90th day is kept', !!m.c && !!m.e);
  }

  console.log('CUSTOMER DETAILS');
  {
    const A = world();
    const o = ord(1, { ff: 'fulfilled' });
    const s = A.soCopyStrip(o);
    ok('a shipped order keeps no name, street, zip, phone or email', !s.ship.name && !s.ship.a1 && !s.ship.zip && !s.ship.phone && !s.email && !s.ship.city);
    ok('…but keeps its state and country (the delivery and MCF columns)', s.ship.state === 'TX' && s.ship.country === 'US');
    ok('…without touching the order on screen', o.ship.name === 'Ann Lee' && o.email === 'a@b.c');
    ok('a cancelled order is stripped too', !A.soCopyStrip(ord(2, { cancelledAt: '2026-10-11' })).ship.name);
    ok('an order still to ship keeps the address it ships to', A.soCopyStrip(ord(3)).ship.a1 === '1 Main St');
    const m = {};
    A.soCopyMerge(m, [ord(4, { ff: 'fulfilled' })]);
    ok('nothing reaches the copy unstripped — the merge strips', !m['4'].ship.name && !m['4'].email);
  }

  console.log('VERSION, ACCOUNT, AGE');
  {
    const A = world();
    const now = Date.now(), good = { ver: A.SO_COPY.ver, uid: 'u1', usedAt: now, cursor: 'x', orders: {} };
    ok('a good copy is used', A.soCopyStale(good, 'u1', now) === '');
    ok('a copy in another format is NOT read', /format/.test(A.soCopyStale(Object.assign({}, good, { ver: A.SO_COPY.ver + 1 }), 'u1', now)));
    ok('nor another account\'s', /account/.test(A.soCopyStale(good, 'u2', now)));
    ok('nor one unused for 7 days', /7 days/.test(A.soCopyStale(Object.assign({}, good, { usedAt: now - 7 * DAY - 1 }), 'u1', now)));
    await A.soCopyPut('SP', Object.assign({}, good, { ver: 0 }));
    const r = await A.soCopyRead('SP');
    await new Promise(res => setTimeout(res, 5));
    ok('…and it is deleted on sight, not kept', !r.rec && !(await A.soCopyGet('SP')));
    await A.soCopyPut('SP', good);
    await A.soCopyWipe();
    ok('Sign out wipes the whole copy', !A.idb.dbs.has(A.SO_COPY.db));
    ok('the shipped switch is today\'s way, and the copy is off', A.soCopyMode() === 'direct' && world({ ls: { soCopyMode: 'copy' } }).soCopyMode() === 'copy');
  }

  console.log('WHAT THE TAB SHOWS');
  {
    const A = world();
    const m = { 1: ord(1, { at: '2026-10-10' }), 2: ord(2, { at: '2026-08-01' }), 3: ord(3, { at: '2026-08-01' }), 4: ord(4, { at: '2026-10-11', ff: 'fulfilled' }) };
    const w = { start: '2026-10-01', end: '2026-10-16', open: '0' };
    ok('the window, plus the old unfinished ones by id', A.soCopyView(m, w, ['2']).map(o => o.id).join() === '4,2,1');
    ok('"not yet shipped" leaves the shipped ones out', A.soCopyView(m, Object.assign({}, w, { open: '1' }), ['2']).map(o => o.id).join() === '2,1');
    ok('a copy made of "not yet shipped" does not cover "every order"', !A.soCopyCovers({ from: '2026-10-01', all: false }, w)
      && A.soCopyCovers({ from: '2026-10-01', all: true }, w) && !A.soCopyCovers({ from: '2026-10-05', all: true }, w));
    const ob = [{ src: 'SHP', shopOrderId: '77', orderDate: '2026-08-20' }, { src: 'SHP', shopOrderId: '78', orderDate: '2026-10-10' },
      { src: 'SHP', shopOrderId: '', orderDate: '2026-08-05' }, { src: 'AMZ', shopOrderId: '79', orderDate: '2026-08-01' }];
    const B = world({ ob, meta: { 88: { lines: { a: { adj: 1, adjOrderDate: '2026-09-01' } } } } });
    const o = B.soOldOpen('2026-10-01');
    ok('old unfinished orders: open production lines and adjustments, by id', [...o.ids].sort().join() === '77,88');
    ok('…a line with no Shopify id is reached the old way, by date', o.reach === '2026-08-05');
  }

  console.log('SHADOW COMPARE');
  {
    const A = world();
    const live = [ord(1), ord(2, { ff: 'fulfilled' })], copy = [ord(1), A.soCopyStrip(ord(2, { ff: 'fulfilled' }))];
    ok('the same orders, once stripped alike, are no difference', A.soCopyDiff(live, copy, 0).mismatch === 0);
    const d = A.soCopyDiff([ord(1), ord(5)], [ord(1, { ff: 'partial' }), ord(6)], 0);
    ok('missing, extra and changed orders are each counted', d.mismatch === 3 && d.missing[0] === '#5' && d.extra[0] === '#6' && d.changed[0] === '#1');
    const r = A.soCopyDiff([ord(1)], [ord(1, { upd: '2026-10-15T10:10:00Z', ff: 'partial' })], Date.parse('2026-10-15T10:05:00Z'));
    ok('an order Shopify changed after the live read is a race, not a fault', r.mismatch === 0 && r.race === 1);
  }

  console.log('COPY MODE, END TO END (fake Shopify, fake IndexedDB)');
  {
    const today = dayOf(Date.now()), w = { start: dayOf(Date.now() - 14 * DAY), end: dayOf(Date.now() + DAY), open: '0' };
    let since = [];
    const answer = p => {
      if (p.since) { since.push(p.since); return { ok: true, mode: 'since', cursor: '2026-10-15T12:00:00.000Z',
        orders: p.shop === 'CPC' ? [] : [ord(1, { at: today, upd: '2026-10-15T11:59:00Z', ff: 'fulfilled', trk: ['T9'] }), ord(3, { at: today })] }; }
      if (p.ids) return { ok: true, mode: 'ids', cursor: '2026-10-15T09:00:00.000Z', orders: [] };
      return { ok: true, mode: 'dates', cursor: '2026-10-15T09:00:00.000Z', tz: 'America/New_York', from: p.start, to: p.end,
        orders: p.shop === 'CPC' ? [ord(9, { at: today })] : [ord(1, { at: today }), ord(2, { at: today })] };
    };
    const A = world({ ls: { soCopyMode: 'copy' }, prGet: answer });
    ok('no copy yet: the tab opens the full way', (await A.soCopyOpen(w)) === false);
    const sp = await A.soAskStore('SP', w, new Set()), cpc = await A.soAskStore('CPC', w, new Set());
    await A.soCopyAfterFetch({ SP: sp, CPC: cpc }, w, Date.now());
    const kept = await A.soCopyGet('SP');
    ok('…and keeps what it fetched as the copy, with Shopify\'s cursor', kept && kept.cursor === '2026-10-15T09:00:00.000Z' && Object.keys(kept.orders).length === 2);
    ok('…no photo pass in the orders request', A.asks.every(p => p.nophoto === '1'));
    A.asks.length = 0;
    ok('next open: the copy is on screen without asking Shopify', (await A.soCopyOpen(w)) === true && A.asks.length === 0
      && A.getSHOP().orders.length === 3 && A.getSHOP().copy.from === 'copy');
    await A.soCopyRefresh(w);
    ok('then only what CHANGED is asked for, from five minutes before the cursor', since.length === 2 && since[0] === '2026-10-15T08:55:00.000Z');
    const now2 = await A.soCopyGet('SP');
    ok('the change is merged and the cursor moves to Shopify\'s new one', now2.cursor === '2026-10-15T12:00:00.000Z'
      && now2.orders['1'].ff === 'fulfilled' && !!now2.orders['3'] && !now2.orders['1'].ship.name);
    ok('and the tab redraws with it', A.getSHOP().orders.length === 4 && A.getSHOP().orders.find(o => o.id === '1').trk[0] === 'T9' && A.getFetched() > 0);

    A.setSHOP(Object.assign(A.getSHOP(), { orders: A.getSHOP().orders }));
    A.soCopyTouch('2', { ff: 'fulfilled', trk: ['OWN1'] });
    await new Promise(res => setTimeout(res, 20));
    const t = await A.soCopyGet('SP');
    ok('OWN ACTION: after Fulfil the copy changes at once', t.orders['2'].ff === 'fulfilled' && t.orders['2'].trk[0] === 'OWN1' && !!t.orders['2'].mine
      && A.getSHOP().orders.find(o => o.id === '2').ff === 'fulfilled');

    const B = world({ ls: { soCopyMode: 'copy' }, prGet: p => (p.since ? { ok: true, orders: [] } : answer(p)), idb: A.idb });
    await B.soCopyRefresh(w);
    ok('a script that does not know "changed since" yet: filled the full way, nothing lost', B.asks.some(p => p.start && !p.since) && B.getSHOP().orders.length === 3);
  }

  console.log('SHADOW MODE');
  {
    const today = dayOf(Date.now()), w = { start: dayOf(Date.now() - 14 * DAY), end: dayOf(Date.now() + DAY), open: '0' };
    let live = [ord(1, { at: today }), ord(2, { at: today })], changed = [];
    const answer = p => {
      if (p.since) return { ok: true, mode: 'since', cursor: '2026-10-15T12:00:00.000Z', orders: p.shop === 'CPC' ? [] : clone(changed) };
      return { ok: true, mode: 'dates', cursor: '2026-10-15T12:00:00.000Z', tz: '', orders: p.shop === 'CPC' ? [] : clone(live) };
    };
    const A = world({ ls: { soCopyMode: 'shadow' }, prGet: answer });
    const run = async () => {
      const sp = await A.soAskStore('SP', w, new Set()), cpc = await A.soAskStore('CPC', w, new Set());
      await A.soCopyAfterFetch({ SP: sp, CPC: cpc }, w, Date.now());
      return JSON.parse(A.ls.get('soCopyLog')).pop().stores.SP;
    };
    let r = await run();
    ok('first run: nothing to compare yet, the copy is made', r.mode === 'no copy');
    live = [ord(1, { at: today, upd: '2026-10-15T11:00:00Z', ff: 'fulfilled' }), ord(2, { at: today })];
    changed = [live[0]];
    r = await run();
    ok('a change that "changed since" brought in: zero differences', r.mode === 'delta' && r.mismatch === 0 && r.delta.changed === 1, JSON.stringify(r));
    live = [ord(1, { at: today, upd: '2026-10-15T11:00:00Z', ff: 'fulfilled' }), ord(2, { at: today, upd: '2026-10-15T11:30:00Z', ff: 'partial' })];
    changed = [];
    r = await run();
    ok('a change it MISSED is logged as a difference', r.mismatch === 1 && r.changed[0] === '#2', JSON.stringify(r));
    ok('…and the report adds them up', A.soCopyReport().differences === 1 && A.soCopyReport().compared === 2);
    ok('shadow never touches what is on screen', A.getSHOP().orders.length === 0);
    const D = world({ prGet: answer });
    await D.soCopyAfterFetch({ SP: await D.soAskStore('SP', w, new Set()), CPC: { orders: [] } }, w, Date.now());
    ok('"Load from Shopify directly" keeps nothing on the device', !D.idb.dbs.has(D.SO_COPY.db) || !(await D.soCopyGet('SP')));
  }

  console.log('SAFETY NETS (phase 4)');
  {
    const A = world(), t = Date.parse('2026-10-15T12:00:00Z');
    ok('age: grey under 15 minutes', A.soCopyAge(t - 4 * 60000, t).tone === 'ok' && A.soCopyAge(t - 4 * 60000, t).txt === 'Updated 4 min ago');
    ok('age: orange from 15', A.soCopyAge(t - 15 * 60000, t).tone === 'warn');
    ok('age: red from 30', A.soCopyAge(t - 30 * 60000, t).tone === 'bad' && A.soCopyAge(t - 95 * 60000, t).txt === 'Updated 1 h 35 min ago');
    const el = { style: {} };
    const B = world({ ls: { soCopyMode: 'copy' }, els: { soAge: el } });
    B.setSHOP({ orders: [], copy: { syncedAt: Date.now() - 40 * 60000 } });
    B.soCopyAgeShow();
    ok('…shown on the toolbar in copy mode, in red', /40 min ago/.test(el.textContent) && /B91C1C/.test(el.style.color));
    const D = world({ els: { soAge: el } });
    D.setSHOP({ orders: [], copy: { syncedAt: Date.now() } });
    D.soCopyAgeShow();
    ok('…and not at all in today\'s way', el.textContent === '');

    for (let i = 0; i < 120; i++) A.soCopySyncLog({ store: 'SP', how: 'changed since', i });
    const log = JSON.parse(A.ls.get('soCopySyncLog'));
    ok('sync log: every run kept, the newest 100', log.length === 100 && log[99].i === 119 && !!log[0].at);

    const today = dayOf(Date.now()), w = { start: dayOf(Date.now() - 14 * DAY), end: dayOf(Date.now() + DAY), open: '0' };
    const fell = [];
    const F = world({ ls: { soCopyMode: 'copy' }, fell, prGet: () => { throw new Error('Failed to fetch'); } });
    const old = { ver: F.SO_COPY.ver, uid: 'u1', cursor: '2026-10-15T09:00:00.000Z', from: w.start, all: true, at: Date.now(), usedAt: Date.now(),
      syncedAt: Date.now() - 31 * 60000, orders: { 1: ord(1, { at: today }) } };
    await F.soCopyPut('SP', old); await F.soCopyPut('CPC', Object.assign({}, old, { orders: {} }));
    await F.soCopyRefresh(w);
    ok('AUTO FALL-BACK: a copy over 30 minutes old that cannot be updated → loaded the old way', fell.length === 1 && fell[0].live === true);
    ok('…saying why, and the failure is in the sync log', F.msgs.some(m => m[1] && /30 minutes/.test(m[0]))
      && JSON.parse(F.ls.get('soCopySyncLog')).some(l => l.how === 'failed'));
    const fell2 = [];
    const G = world({ ls: { soCopyMode: 'copy' }, fell: fell2, idb: F.idb, prGet: () => { throw new Error('Failed to fetch'); } });
    await G.soCopyPut('SP', Object.assign({}, old, { syncedAt: Date.now() - 5 * 60000 }));
    await G.soCopyPut('CPC', Object.assign({}, old, { orders: {}, syncedAt: Date.now() - 5 * 60000 }));
    await G.soCopyRefresh(w);
    ok('…a fresh copy stays on screen, with the failure said out loud', fell2.length === 0 && G.msgs.some(m => m[1]) && G.getSHOP().orders.length === 1);

    const orders = { 1: ord(1, { at: '2026-10-10' }), 2: ord(2, { at: '2026-10-10' }), 3: ord(3, { at: '2026-10-11' }) };
    const bad = A.soCopyCountDiff(orders, { '2026-10-10': ['1'], '2026-10-11': ['3'], '2026-10-12': ['4'] }, '2026-10-01', '2026-10-16');
    ok('count check: a day with an order DELETED on Shopify, and a day the copy never heard of', bad.join() === '2026-10-10,2026-10-12');
    A.soCopyCountFix(orders, bad, [ord(1, { at: '2026-10-10' }), ord(4, { at: '2026-10-12' })]);
    ok('…both days loaded again: the deleted order goes, the missing one arrives, other days untouched',
      !orders['2'] && !!orders['1'] && !!orders['4'] && !!orders['3']);
    const H = world({ ls: { soCopyMode: 'copy' }, prGet: p => p.shopify === 'orderIds'
      ? { ok: true, mode: 'orderIds', days: p.shop === 'CPC' ? {} : { [today]: ['1'] } }
      : { ok: true, mode: 'dates', cursor: 'x', orders: p.shop === 'CPC' ? [] : [ord(1, { at: today })] } });
    await H.soCopyPut('SP', Object.assign({}, old, { orders: { 1: ord(1, { at: today }), 2: ord(2, { at: today }) } }));
    await H.soCopyPut('CPC', Object.assign({}, old, { orders: {} }));
    await H.soCopyCountRun(w);
    const after = await H.soCopyGet('SP');
    ok('…end to end: the deleted order leaves the device copy, the other stays', !!after.orders['1'] && !after.orders['2']);
  }
  {
    const S = script([{ orders: [raw(1), raw(2, { financial_status: 'voided' }), raw(3, { created_at: '2026-09-01T10:00:00-04:00' })] }]);
    const r = S.ctx.shopifyOrderIds_('2026-10-01', '2026-10-15');
    ok('the script: order ids per day, voided and out-of-window left out, three small fields only',
      r.mode === 'orderIds' && JSON.stringify(r.days) === '{"2026-10-10":["1"]}' && /fields=id,created_at,financial_status&/.test(S.calls[0]));
  }

  await phase3();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

/* ================= PHASE 3: the shared copy — the real ShopifyCache.gs against a fake Firestore, and the app reading
 * the very same fake Firestore ================= */
const GSC = fs.readFileSync(process.env.SO_GSC || path.join(ROOT, '..', 'Pricing-API', 'ShopifyCache.gs'), 'utf8');
function cacheScript(o) {
  const fsm = o.fs, commits = [], mails = [], props = new Map(Object.entries(o.props || {}));
  const T = { now: o.now || Date.now(), lockFree: true };
  class FD extends Date { constructor(...a) { if (a.length) super(...a); else super(T.now); } static now() { return T.now; } }
  const IST = 5.5 * 3600e3;
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => body });
  const ctx = { console, JSON, Math, String, Number, Object, encodeURIComponent, Date: FD,
    Utilities: { formatDate: (d, tz, f) => { const x = new Date(d.getTime() + IST);
      return f === 'yyyy-MM-dd' ? x.toISOString().slice(0, 10) : f === 'H' ? String(x.getUTCHours()) : String(x.getUTCMinutes()); } },
    ScriptApp: { getOAuthToken: () => 'owner-token' },
    LockService: { getScriptLock: () => ({ tryLock: () => T.lockFree, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)) }) },
    MailApp: { sendEmail: (...a) => mails.push(a) }, Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@x' }) },
    Logger: { log() {} },
    UrlFetchApp: { fetch: (url, opt) => {
      if (!/Bearer owner-token/.test(JSON.stringify((opt || {}).headers || {}))) return resp(401, 'no token');
      const rel = url.split('/documents')[1];
      if (rel === ':commit') {
        const w = JSON.parse(opt.payload).writes;
        commits.push(w.map(x => (x.update ? x.update.name.split('/documents/')[1] : 'DEL ' + x.delete.split('/documents/')[1])));
        w.forEach(x => { if (x.update) fsm.set(x.update.name.split('/documents/')[1], JSON.parse(x.update.fields.json.stringValue)); else fsm.delete(x.delete.split('/documents/')[1]); });
        return resp(200, '{}');
      }
      const p = rel.slice(1);
      return fsm.has(p) ? resp(200, JSON.stringify({ fields: { json: { stringValue: JSON.stringify(fsm.get(p)) } } })) : resp(404, '');
    } },
  };
  vm.createContext(ctx);
  vm.runInContext(GSC, ctx);
  ctx.asked = [];
  ctx.setShopBrand_ = b => { ctx.brand = b === 'CPC' ? 'CPC' : 'SP'; };
  ctx.shopifyOrders_ = (from, to, unf, dl, op) => { ctx.asked.push(Object.assign({ brand: ctx.brand, from, to }, op)); return o.shopify(ctx.brand, from, to, op, T); };
  /* Shopify's ids per day, for the count check: o.ids(brand) or, by default, exactly what the copy already holds. */
  ctx.counted = [];
  ctx.shopifyOrderIds_ = (from, to) => {
    ctx.counted.push({ brand: ctx.brand, from, to });
    if (o.ids) return { ok: true, mode: 'orderIds', days: o.ids(ctx.brand), more: false };
    const days = {};
    fsm.forEach((v, k) => { if (k.startsWith('shopify_cache_days/' + ctx.brand + '_')) days[v.day] = Object.keys(v.orders); });
    return { ok: true, mode: 'orderIds', days, more: false };
  };
  return { ctx, T, commits, mails, props, fsm };
}

async function phase3() {
  console.log('THE SHARED COPY — the script (phase 3)');
  const IST = 5.5 * 3600e3;
  const N = Date.now(), d = k => dayOf(N - k * DAY + IST);
  const fsm = new Map();
  const changes = { SP: [], CPC: [] }, fill = {
    SP: [ord(1, { at: d(1) }), ord(2, { at: d(1), ff: 'fulfilled' }), ord(3, { at: d(5) })],
    CPC: [ord(9, { at: d(3), shopBrand: 'CPC', channel: 'CPC Shopify' })] };
  const shopify = (b, from, to, op) => op.since ? { mode: 'since', orders: clone(changes[b]), cursor: iso(N + 60000) }
    : { mode: 'dates', orders: clone(fill[b]), cursor: iso(N - 60000), more: false };
  const S = cacheScript({ fs: fsm, now: N, shopify });
  const meta = () => fsm.get('shopify_cache/meta');

  S.T.lockFree = false;
  ok('not while the nightly run holds the lock', S.ctx.shopCacheSync_({}).skipped === 'the nightly run is working' && !S.commits.length);
  S.T.lockFree = true;
  S.T.now = Date.parse(d(0) + 'T20:30:00Z');   // 02:00 IST the next morning
  ok('not outside 8 AM–10 PM IST', /working hours/.test(S.ctx.shopCacheSync_({}).skipped || ''));
  S.T.now = N;

  let r = S.ctx.shopCacheSync_({ force: true });
  ok('a store with no copy yet is filled: the last 30 days, both stores, no photos', r.ok && S.ctx.asked.length === 2
    && S.ctx.asked[0].from === dayOf(N - 30 * DAY + IST) && S.ctx.asked.every(a => a.photos === false), JSON.stringify(r));
  ok('…one document per store per day placed', fsm.has('shopify_cache_days/SP_' + d(1)) && fsm.has('shopify_cache_days/SP_' + d(5))
    && fsm.has('shopify_cache_days/CPC_' + d(3)) && Object.keys(fsm.get('shopify_cache_days/SP_' + d(1)).orders).length === 2);
  ok('…the contents page written LAST, in its own write', S.commits[S.commits.length - 1].join() === 'shopify_cache/meta'
    && S.commits.slice(0, -1).every(c => c.every(p => p !== 'shopify_cache/meta')));
  ok('…with Shopify\'s cursor, the day times and where the fill began', meta().stores.SP.cursor === iso(N - 60000)
    && meta().stores.SP.days[d(1)] === N && meta().stores.SP.filledFrom === dayOf(N - 30 * DAY + IST) && meta().v === S.ctx.SC.ver);
  ok('…a shipped order keeps no customer details in the shared copy', !fsm.get('shopify_cache_days/SP_' + d(1)).orders['2'].ship.name
    && fsm.get('shopify_cache_days/SP_' + d(1)).orders['1'].ship.name === 'Ann Lee');
  ok('…and a sync log line on the contents page', meta().log.length === 1 && meta().log[0].ok && meta().log[0].stores.SP.mode === 'fill');
  ok('the script and the app agree on the format\'s version number', S.ctx.SC.ver === world().SO_COPY.ver);

  /* ---- the app reads the shared copy ---- */
  console.log('THE SHARED COPY — the app (phase 3)');
  const want = { start: d(14), end: d(-1), open: '0' };
  const reads = [], asks = [];
  const app = extra => world(Object.assign({ ls: { soCopyMode: 'copy', soCopyShared: '1' }, fs: fsm, want, reads,
    prGet: p => { asks.push(p); if (p.shopify === 'cacheSync') return { ok: true }; if (p.ids) return { ok: true, mode: 'ids', orders: [] };
      throw new Error('Shopify was asked: ' + JSON.stringify(p)); } }, extra || {}));
  const A = app();
  ok('the shared copy is off as shipped', world().soCopySharedOn() === false && A.soCopySharedOn() === true);
  await A.soCopyRefresh(want);
  ok('a NEW device builds its copy from Firestore — Shopify is not asked', A.getSHOP().orders.length === 4
    && !asks.some(p => p.shopify === 'orders'), JSON.stringify(asks) + ' / ' + A.getSHOP().orders.length);
  ok('…and the sync log says where it came from', JSON.parse(A.ls.get('soCopySyncLog')).pop().how === 'shared copy');

  changes.SP = [ord(1, { at: d(1), upd: iso(N + 30000), ff: 'fulfilled', trk: ['T1'] }), { id: '3', at: d(5), upd: iso(N + 30000), gone: 'voided' }];
  S.T.now = N + 5 * 60000;
  S.ctx.shopCacheSync_({ force: true });
  const since = S.ctx.asked.filter(a => a.since).pop();
  ok('the timer asks "changed since", five minutes before the cursor', !!since && since.since === iso(N - 60000 - 5 * 60000), since && since.since);
  ok('…merges the change into its day, and a voided order leaves its day', fsm.get('shopify_cache_days/SP_' + d(1)).orders['1'].ff === 'fulfilled'
    && !fsm.get('shopify_cache_days/SP_' + d(5)).orders['3'] && !fsm.get('shopify_cache_days/SP_' + d(1)).orders['1'].ship.name);
  ok('…and the cursor moves to Shopify\'s new one', meta().stores.SP.cursor === iso(N + 60000));

  const B = app({ idb: A.idb });
  reads.length = 0;
  await B.soCopyRefresh(want);
  const dayReads = reads.filter(p => /shopify_cache_days/.test(p));
  ok('the device reads only the days whose time moved', dayReads.length === 2 && dayReads.every(p => p.endsWith(d(1)) || p.endsWith(d(5))), dayReads.join());
  ok('…the change shows, and the removed order is gone from the device too', B.getSHOP().orders.find(o => o.id === '1').ff === 'fulfilled'
    && !B.getSHOP().orders.find(o => o.id === '3'));

  reads.length = 0; asks.length = 0;
  await B.soCopyRefresh(want, { now: true });
  ok('the Refresh button asks the script to sync now, before reading', !!asks[0] && asks[0].shopify === 'cacheSync');
  ok('nothing changed: the contents page is the only read', reads.length === 1 && reads[0] === 'shopify_cache/meta', reads.join());

  /* the safety nets around it */
  const m = clone(meta()); m.stores.SP.syncedAt = Date.now() - 31 * 60000; m.stores.CPC.syncedAt = Date.now() - 31 * 60000;
  const fs2 = new Map(fsm); fs2.set('shopify_cache/meta', m);
  const direct = [];
  const C = world({ ls: { soCopyMode: 'copy', soCopyShared: '1' }, fs: fs2, want, idb: A.idb,
    prGet: p => { direct.push(p); return p.since ? { ok: true, mode: 'since', cursor: iso(N + 120000), orders: [] } : { ok: true }; } });
  await C.soCopyRefresh(want);
  ok('a shared copy over 30 minutes old is not used: the device asks Shopify itself', direct.some(p => p.since), JSON.stringify(direct));
  const w40 = Object.assign({}, want, { start: d(40) });
  direct.length = 0;
  const D = world({ ls: { soCopyMode: 'copy', soCopyShared: '1' }, fs: fsm, want: w40,
    prGet: p => { direct.push(p); return { ok: true, mode: 'dates', cursor: 'x', orders: [] }; } });
  await D.soCopyRefresh(w40);
  ok('…nor one that does not reach back to the window\'s first day', direct.some(p => p.shopify === 'orders' && p.start === d(40)));
  const offReads = [];
  const E = world({ ls: { soCopyMode: 'copy' }, fs: fsm, want, reads: offReads, prGet: () => ({ ok: true, mode: 'dates', cursor: 'x', orders: [] }) });
  await E.soCopyRefresh(want);
  ok('with the shared copy off, Firestore is not read at all', offReads.length === 0);

  /* ---- the script's own safety nets ---- */
  console.log('THE SHARED COPY — budget, alert, clean-up (phase 3 / 4)');
  const today = dayOf(N + IST);
  const at = (h, min) => Date.parse(today + 'T00:00:00Z') + (h * 60 + min) * 60000 - IST;
  fsm.set('shopify_cache/meta', Object.assign(meta(), { writes: { day: today, n: 6000 } }));
  S.T.now = at(12, 12);
  ok('over 5,000 writes a day: it slows to every 30 minutes', /budget/.test(S.ctx.shopCacheSync_({}).skipped || ''));
  S.T.now = at(12, 32);
  ok('…and still runs on the half hour', !S.ctx.shopCacheSync_({}).skipped);

  const F = cacheScript({ fs: new Map(), now: at(12, 0), shopify: () => { throw new Error('Shopify 503'); } });
  for (let i = 0; i < 4; i++) F.ctx.shopCacheTick();
  ok('three failed syncs in a row send ONE email, not one a run', F.mails.length === 1 && /3 syncs in a row failed/.test(F.mails[0][1]) && F.mails[0][0] === 'owner@x');
  F.props.set('SHOP_CACHE_ALERT_TO', 'ops@x'); F.props.set('SHOP_CACHE_FAILS', '2');
  F.ctx.shopCacheTick();
  ok('…to the address in SHOP_CACHE_ALERT_TO when there is one', F.mails.length === 2 && F.mails[1][0] === 'ops@x');
  const F2 = cacheScript({ fs: new Map(), now: at(12, 0), props: { SHOP_CACHE_FAILS: '2' }, shopify: () => ({ mode: 'dates', orders: [], cursor: iso(N) }) });
  F2.ctx.shopCacheTick();
  ok('…and a good sync starts the count again', F2.props.get('SHOP_CACHE_FAILS') === '0' && !F2.mails.length);

  const gfs = new Map([['shopify_cache/meta', { v: 1, stores: { SP: { cursor: iso(N - 1000), syncedAt: N - 1000, filledFrom: d(30), days: {} },
    CPC: { cursor: iso(N - 1000), syncedAt: N - 1000, filledFrom: d(30), days: {} } }, prunedDay: today }]]);
  const G = cacheScript({ fs: gfs, now: N, shopify: (b, f, t, op, T) => (T.now += 5 * 60000,
    { mode: 'since', orders: [ord(5, { at: d(2), upd: iso(N) })], cursor: iso(N), next: 'more' }) });
  G.ctx.shopCacheSync_({ force: true });
  const gm = gfs.get('shopify_cache/meta');
  ok('a run out of time keeps what it got but does NOT move the cursor', gm.stores.SP.cursor === iso(N - 1000)
    && !!gfs.get('shopify_cache_days/SP_' + d(2)) && gm.log[0].stores.SP.partial === true);

  const old = dayOf(N - 100 * DAY + IST), turning = dayOf(N - 61 * DAY + IST);
  const hfs = new Map([['shopify_cache/meta', { v: 1, stores: { SP: { cursor: iso(N - 1000), syncedAt: N, filledFrom: d(30),
      days: { [old]: 1, [turning]: 1 } } }, prunedDay: 'yesterday' }],
    ['shopify_cache_days/SP_' + old, { store: 'SP', day: old, orders: { 7: ord(7, { at: old, ff: 'fulfilled' }), 8: ord(8, { at: old }) } }],
    ['shopify_cache_days/SP_' + turning, { store: 'SP', day: turning, orders: { 6: ord(6, { at: turning }) } }]]);
  const P = cacheScript({ fs: hfs, now: N, shopify: () => ({ mode: 'since', orders: [], cursor: iso(N) }) });
  P.ctx.shopCacheSync_({ force: true });
  const oldDoc = hfs.get('shopify_cache_days/SP_' + old);
  ok('once a day: finished orders older than 90 days leave the shared copy, open ones stay', !!oldDoc && !oldDoc.orders['7'] && !!oldDoc.orders['8']);
  ok('…and the day that has just turned 60 loses its customer details, open orders included',
    !hfs.get('shopify_cache_days/SP_' + turning).orders['6'].ship.name && hfs.get('shopify_cache_days/SP_' + turning).orders['6'].ship.state === 'TX');
  const n0 = P.commits.length;
  P.ctx.shopCacheSync_({ force: true });
  ok('…once a day, not every run', P.commits.slice(n0).every(c => c.every(p => !p.includes(old))));

  const cfs = new Map([['shopify_cache/meta', { v: 1, stores: { SP: { cursor: iso(N - 1000), syncedAt: N, filledFrom: d(30), days: { [d(2)]: 1, [d(3)]: 1 } } },
      prunedDay: today, countedDay: 'yesterday' }],
    ['shopify_cache_days/SP_' + d(2), { store: 'SP', day: d(2), orders: { 5: ord(5, { at: d(2) }), 6: ord(6, { at: d(2) }) } }],
    ['shopify_cache_days/SP_' + d(3), { store: 'SP', day: d(3), orders: { 4: ord(4, { at: d(3) }) } }]]);
  const Q = cacheScript({ fs: cfs, now: N, ids: b => (b === 'SP' ? { [d(2)]: ['5'], [d(3)]: ['4'], [d(4)]: ['11'] } : {}),
    shopify: (b, f, t, op) => (op.since ? { mode: 'since', orders: [], cursor: iso(N) }
      : { mode: 'dates', cursor: iso(N), orders: [ord(5, { at: d(2) }), ord(4, { at: d(3) }), ord(11, { at: d(4) })] }) });
  const rq = Q.ctx.shopCacheSync_({ force: true });
  ok('COUNT CHECK: an order DELETED on Shopify leaves the shared copy (its day is loaded again whole)',
    !cfs.get('shopify_cache_days/SP_' + d(2)).orders['6'] && !!cfs.get('shopify_cache_days/SP_' + d(2)).orders['5'], JSON.stringify(rq.count));
  ok('…a day the copy never heard of arrives, and a day that matches is left alone',
    !!cfs.get('shopify_cache_days/SP_' + d(4)) && rq.count.SP.reloaded.join() === [d(4), d(2)].sort().join());
  ok('…once a day, and logged on the contents page', cfs.get('shopify_cache/meta').countedDay === today
    && !!cfs.get('shopify_cache/meta').log.pop().count && (Q.ctx.counted.length = 0, Q.ctx.shopCacheSync_({ force: true }), Q.ctx.counted.length === 0));

  /* ---- PHASE 5: side by side — shadow mode compares the shared copy with what Shopify just said ---- */
  console.log('SIDE BY SIDE (phase 5)');
  const sfs = new Map();
  let liveNow = [ord(21, { at: d(1), upd: iso(N - 3600e3) }), ord(22, { at: d(2), upd: iso(N - 3600e3) })];
  const SS = cacheScript({ fs: sfs, now: N, shopify: (b, f, t, op) => (op.since ? { mode: 'since', orders: [], cursor: iso(N - 60000) }
    : { mode: 'dates', orders: b === 'SP' ? clone(liveNow) : [], cursor: iso(N - 60000) }) });
  SS.ctx.shopCacheSync_({ force: true });
  const SW = world({ ls: { soCopyMode: 'shadow', soCopyShared: '1' }, fs: sfs, want,
    prGet: p => (p.since ? { ok: true, mode: 'since', cursor: iso(N), orders: [] }
      : { ok: true, mode: 'dates', cursor: iso(N), tz: '', orders: p.shop === 'CPC' ? [] : clone(liveNow) }) });
  const sideBySide = async () => {
    await SW.soCopyAfterFetch({ SP: await SW.soAskStore('SP', want, new Set()), CPC: await SW.soAskStore('CPC', want, new Set()) }, want, Date.now());
    return JSON.parse(SW.ls.get('soCopyLog')).pop().stores.SP.shared;
  };
  let sb = await sideBySide();
  ok('the shared copy against live Shopify: the same orders, zero differences', sb && sb.live === 2 && sb.mismatch === 0, JSON.stringify(sb));
  liveNow = [ord(21, { at: d(1), upd: iso(N + 120000), ff: 'fulfilled' }), ord(22, { at: d(2), upd: iso(N - 3600e3) })];
  sb = await sideBySide();
  ok('…a change since its last sync is "behind" (up to 5 minutes, by design), not a fault', sb.mismatch === 0 && sb.behind === 1, JSON.stringify(sb));
  liveNow = [ord(21, { at: d(1), upd: iso(N - 3600e3) }), ord(22, { at: d(2), upd: iso(N - 3600e3), ff: 'partial' })];
  sb = await sideBySide();
  ok('…a change the shared copy MISSED is a difference, and the report adds it up', sb.mismatch === 1 && sb.changed[0] === '#22'
    && SW.soCopyReport().sharedDifferences === 1 && SW.soCopyReport().sharedCompared === 3);

  const big = cacheScript({ fs: new Map(), now: N, shopify: () => ({ mode: 'dates', cursor: iso(N),
    orders: Array.from({ length: 900 }, (_, i) => ord(i + 1, { at: d(1), note: 'x'.repeat(1200) })) }) });
  const rb = big.ctx.shopCacheSync_({ force: true });
  ok('a day too big for one Firestore document is refused out loud, not cut short', !rb.ok && /over what one document holds/.test(rb.stores.SP.err || ''));
  ok('the script reaches Firestore only with its owner\'s own token (no key file)', !/private_key|client_email|serviceAccount/i.test(GSC)
    && /ScriptApp\.getOAuthToken\(\)/.test(GSC));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'Pricing-API', 'appsscript.json'), 'utf8').replace(/^﻿/, ''));
  ok('…the manifest asks for Firestore and keeps every scope the script used before', ['script.send_mail', 'script.external_request', 'spreadsheets', 'drive',
    'script.scriptapp', 'userinfo.email', 'script.container.ui', 'datastore'].every(s => manifest.oauthScopes.includes('https://www.googleapis.com/auth/' + s)));
}
