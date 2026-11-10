/* ORDER ALERT LIST, STAGE 1 (docs/data-reduction/ALERT-LIST-PLAN.md, section 9) - orders/order-alerts.js, the hook in
 * core/history.js and the split of orders/order-ticker.js, run on fake pages.
 *   node tests/order-alerts-test.js     (OA_TICKER / OA_ALERTS / OA_HIST = <file> to test another copy; the Teeth part does)
 * What must hold: the strip's items are byte-for-byte what today's ticker gave; the sales order date is always used when it
 * is known; every one of the four save helpers tells the list after a SUCCESSFUL save and a failed save does not; the hook
 * never throws; nothing writes to the database except the four helpers (and the few writers that exist today, listed);
 * a save is worked out once, ~3 seconds later, in ONE update, only for lines that changed; a write that fails offline is
 * tried again; of two pages one wins the lease; a check repairs and logs a difference; the switch OFF means no timer, no
 * write and no extra read; and a broken copy of any of these makes this suite fail. */
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), { spawnSync } = require('child_process');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const TICKER = rd(process.env.OA_TICKER || path.join(APP, 'orders', 'order-ticker.js'));
const ALERTS = rd(process.env.OA_ALERTS || path.join(APP, 'orders', 'order-alerts.js'));
const HIST = rd(process.env.OA_HIST || path.join(APP, 'core', 'history.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' - ' + d : '')); } };

/* TODAY'S TICKER, as it was before the split: the yardstick the new code is held to. */
const OLD_ITEMS = `function otkItemsOld() {
  const today = dToday(), soDue = typeof SOX !== 'undefined' && SOX.rows ? ordDueIndex() : null;
  const open = ordLines().filter(l => l.open && !(typeof shpInsertProduct === 'function' && shpInsertProduct(l.sku)));
  const crit = [], per = new Map();
  let pcs = 0;
  open.forEach(l => {
    const owe = Math.max(0, (+l.qty || 0) - (+l.pressed || 0) - (+l.fromStock || 0));
    const ch = OTK_CHANNEL[String(l.orderNo).split('-')[0]] || 'Other';
    const e = per.get(ch) || per.set(ch, { lines: 0, pcs: 0 }).get(ch); e.lines++; e.pcs += owe; pcs += owe;
    const due = (soDue && soDue.get(l.orderNo + '|' + l.sku)) || l.mtoDue || '';
    if (!due) return;
    const d = otkDays(due, today);
    if (d < -1) return;
    crit.push({ no: l.orderNo, d, what: [l.articleSubtype || l.itemName || l.articleType, l.color].filter(Boolean).join(' · ') || l.sku, qty: l.qty });
  });
  crit.sort((a, b) => b.d - a.d || a.no.localeCompare(b.no));
  const out = [{ kind: 'sum', txt: \`Pending: \${nf(open.length)} lines · \${nf(pcs)} pcs\`, sub: [...per.entries()].sort((a, b) => b[1].lines - a[1].lines).map(([k, v]) => \`\${k} \${nf(v.lines)}\`).join(' · ') }];
  const late = crit.filter(c => c.d > 0).length;
  if (crit.length) out.push({ kind: 'sum', txt: \`Critical: \${nf(late)} late · \${nf(crit.length - late)} due today / tomorrow\` });
  crit.slice(0, 40).forEach(c => out.push({ kind: c.d > 0 ? 'late' : 'due', no: c.no,
    tag: c.d > 0 ? \`LATE \${c.d} day\${c.d > 1 ? 's' : ''}\` : c.d === 0 ? 'DUE TODAY' : 'DUE TOMORROW', txt: \`\${c.no} · \${c.what} · \${nf(c.qty)} pcs\` }));
  if (crit.length > 40) out.push({ kind: 'sum', txt: \`+ \${nf(crit.length - 40)} more critical lines in the Order Console\` });
  return out;
}`;

/* ---- the lines (the shape ordLines gives) ---- */
const L = (orderNo, sku, o) => Object.assign({ open: true, orderNo, sku, qty: 10, pressed: 0, fromStock: 0, mtoDue: '', mto: false,
  pendingCut: 0, pendingMake: 0, madeToPress: 0, pendingPrint: 0, itemName: 'Cushion', color: 'Blue' }, o || {});
function fixtureLines() {
  const lines = [
    L('AMZ-1', 'S1', { qty: 10, pressed: 2, fromStock: 1 }),                           // sales order says 2026-11-01
    L('SHP-9', 'S2', { mto: true, mtoDue: '2026-11-07', itemName: 'Quilt', color: 'Red', articleSubtype: 'Reversible quilt', pendingMake: 4 }),
    L('ONL-3', 'S3'),                                                                  // no date at all
    L('B2B-5', 'S4', { open: false }),
    L('AMZ-2', 'S5'),                                                                  // a pillow insert: left out
    L('LEG-2', 'S6', { mto: true, mtoDue: '2026-11-06', pendingPrint: 3 }),
    L('XXX-1', 'S7', { mtoDue: '2026-11-05', itemName: '', color: '' }),               // an unknown channel, no name
    L('AMZ-3', 'S8', { qty: 3, pressed: 5, fromStock: 2 }),                            // pressed more than ordered: owes 0
    L('AMZ-3', 'S9', { mtoDue: '2026-11-05' }),                                        // the same order twice: tie on the order number
    L('B2B-7', 'S10', { qty: 20, mtoDue: '2026-12-01' }),                              // far away: not critical
  ];
  for (let i = 0; i < 45; i++) lines.push(L('AMZ-' + (100 + i), 'K' + i, { qty: 5 + i, mtoDue: '2026-11-0' + (1 + (i % 6)) }));
  return lines;
}
const SO_DUE = () => new Map([['AMZ-1|S1', '2026-11-01'], ['SHP-9|S2', '2026-11-10'], ['B2B-7|S10', '2026-11-06']]);

/* ---- a fake database that understands nested paths, and fake timers ---- */
function makeDb() {
  const root = {};
  const parts = p => String(p).split('/').filter(Boolean);
  return {
    root,
    get(p) { let n = root; for (const s of parts(p)) { if (n == null || typeof n !== 'object') return null; n = n[s]; } return n === undefined ? null : JSON.parse(JSON.stringify(n)); },
    set(p, v) {
      const ps = parts(p); let n = root;
      for (let i = 0; i < ps.length - 1; i++) { if (n[ps[i]] == null || typeof n[ps[i]] !== 'object') n[ps[i]] = {}; n = n[ps[i]]; }
      if (v === null) delete n[ps[ps.length - 1]];
      else n[ps[ps.length - 1]] = (v && typeof v === 'object' && v['.sv']) ? Date.now() : JSON.parse(JSON.stringify(v));
    },
  };
}

/* One page: the ticker and the alert list on a fake page. o: db, ls, lines, soDue, registers, so (false = Sales Orders not loaded),
 * harness, vendor, offline (object with .down). */
function page(o) {
  o = o || {};
  const db = o.db || makeDb(), net = o.net || { down: false };
  const LS = new Map(Object.entries(o.ls || {}));
  const stats = { writes: [], reads: [], cas: 0, timers: 0 };
  const timers = [];
  const ctx = {
    localStorage: { getItem: k => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => LS.set(k, String(v)), removeItem: k => { LS.delete(k); } },
    AUDIT: { on: !o.harness },
    ME: { email: 'ravi@x.com', admin: true, tabs: [] }, NAV_IS_VENDOR: !!o.vendor,
    PTG_ALL: ['ob'], ptHas: () => o.registers !== false, ptPeek: r => (r === 'ob' ? (o.obRows || []) : null),
    SOX: { rows: o.so === false ? null : [] },
    ordDueIndex: () => (o.soDue || SO_DUE)(), ordLines: () => (o.lines || fixtureLines()),
    shpInsertProduct: sku => sku === 'S5',
    dToday: () => '2026-11-06', nf: n => String(n), esc: s => String(s), $: () => null, showTab: () => {},
    ptGetFresh: async p => { stats.reads.push(p); if (net.down) throw new Error('offline'); if (o.denyRead) throw new Error('read 401'); return db.get(p); },
    ptCas: async (p, expect, next) => {
      stats.cas++;
      if (net.down) throw new Error('offline');
      if (JSON.stringify(db.get(p)) !== JSON.stringify(expect == null ? null : expect)) return 'changed';
      db.set(p, next); return '';
    },
    ptAuditWrite: async u => { stats.writes.push(u); if (net.down) throw new Error('offline'); Object.keys(u).forEach(p => db.set(p, u[p])); return true; },
    setTimeout: (fn, ms) => { stats.timers++; timers.push({ fn, ms }); return timers.length; }, setInterval: () => 0, clearTimeout: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(TICKER + '\n' + ALERTS + '\n' + OLD_ITEMS + '\n;this.__t = { otkItems, otkItemsFrom, otkItemsOld, oalEntry, oalKey, oalAfterSave, oalOn, oalCheck, oalFlush, oalSaveFlag, oalAllEntries, OAL };', ctx);
  return { t: ctx.__t, ctx, db, stats, LS, net, timers,
    /* runs the timers set so far; anything they set in turn waits for the next call */
    runTimers: async () => { const batch = timers.splice(0); for (const x of batch) await x.fn(); } };
}
const ON = { alertListBuild: '1' };
const save = (p, path, v) => p.t.oalAfterSave(path, v, 'put');
const listWrites = p => p.stats.writes.filter(u => Object.keys(u).some(k => k.indexOf('pt_orderAlerts/') === 0));

console.log('Same items as today');
{ const p = page({ ls: ON });
  const a = JSON.stringify(p.t.otkItems()), b = JSON.stringify(p.t.otkItemsOld());
  ok('the strip from entries = today\'s strip, byte for byte (with sales order dates)', a === b && a.length > 500);
  ok('...and it carries the late, due-soon and "more" lines', /LATE 5 day/.test(a) && /due today \/ tomorrow/.test(a) && /more critical lines/.test(a));
  const q = page({ ls: ON, so: false });
  ok('...and without Sales Orders loaded too', JSON.stringify(q.t.otkItems()) === JSON.stringify(q.t.otkItemsOld()));
  const e = p.t.oalAllEntries(), one = e.get('AMZ-1__S1');
  ok('an entry holds what the strip needs', one && one.no === 'AMZ-1' && one.qty === 10 && one.pr === 2 && one.fs === 1 && one.what === 'Cushion · Blue' && one.tab === 'ord' && one.id === 'AMZ-1__S1');
  ok('open lines only, inserts left out', !e.has('B2B-5__S4') && !e.has('AMZ-2__S5') && e.has('ONL-3__S3'));
  ok('an entry is small', JSON.stringify(one).length < 260, String(JSON.stringify(one).length));
  const items = p.t.otkItemsFrom([...e.values()], '2026-11-06');
  ok('otkItemsFrom takes plain entries', items[0].txt.indexOf('Pending: 53 lines') === 0, items[0].txt); }

{ const i = ALERTS.indexOf('function oalAllEntries'), b = ALERTS.slice(i, ALERTS.indexOf('\n}\n', i));
  ok('the list never loads registers: it asks ptHas first, before it reads any line', b.indexOf('ptHas(PTG_ALL)') > 0 && b.indexOf('ptHas(PTG_ALL)') < b.indexOf('ordLines()'));
  ok('...and the register graph knows it as a quiet reader', rd(path.join(__dirname, 'page-registers-graph.js')).includes("QUIET_READERS = new Set(['oalAllEntries'])")); }

console.log('Sales order date is always used when known');
{ const p = page({ ls: ON }), e = p.t.oalAllEntries();
  ok('SO date beats the 5 working days', e.get('SHP-9__S2').due === '2026-11-10' && e.get('SHP-9__S2').dh === 'so');
  ok('...a line with no SO date keeps its 5 working days', e.get('LEG-2__S6').due === '2026-11-06' && e.get('LEG-2__S6').dh === 'mto');
  ok('...a line with neither has no date', e.get('ONL-3__S3').due === '' && e.get('ONL-3__S3').dh === '');
  ok('...a worked-out SO date moves the line out of the critical list', !/SHP-9/.test(JSON.stringify(p.t.otkItems()))); }

console.log('Switch order');
ok('off by default', page().t.oalOn() === false);
ok('flag on -> on', page({ ls: { alFlagLast: '1' } }).t.oalOn() === true);
ok("device '1' -> on without the flag", page({ ls: ON }).t.oalOn() === true);
ok("device '0' beats the flag", page({ ls: { alertListBuild: '0', alFlagLast: '1' } }).t.oalOn() === false);
ok('never in a harness', page({ harness: true, ls: ON }).t.oalOn() === false);
ok('never for a vendor', page({ vendor: true, ls: ON }).t.oalOn() === false);
{ const p = page(); p.t.oalSaveFlag(true); const a = p.LS.get('alFlagLast'); p.t.oalSaveFlag(false);
  ok('the flag answer is kept for the next page, and cleared', a === '1' && !p.LS.has('alFlagLast')); }
{ const AUTH = rd(path.join(APP, 'core', 'auth.js')), i = AUTH.indexOf("getDoc(doc(db, 'config', 'flags'))"), blk = i < 0 ? '' : AUTH.slice(i, AUTH.indexOf('dmStart', i));
  ok('sign-in saves alertListBuild from the same single read', /oalSaveFlag\(!!d && \(d\.alertListBuild === true/.test(blk));
  ok('a failed read turns it off', /\.catch\([^\n]*oalSaveFlag\(false\)/.test(blk));
  ok('still only one flags read at sign-in', (AUTH.match(/doc\(db, 'config', 'flags'\)/g) || []).length === 1); }

console.log('Switch OFF: nothing happens');
async function offTests() {
  const p = page({ lines: fixtureLines() });
  save(p, 'pt_orderBook/ob1', { orderNo: 'AMZ-1', sku: 'S1' });
  p.t.oalAfterSave('', { 'pt_pressInventory/x': { orderNo: 'AMZ-1', sku: 'S1' } }, 'patch');
  await p.runTimers(); await p.t.oalCheck(); await p.t.oalFlush();
  ok('no timer', p.stats.timers === 0, String(p.stats.timers));
  ok('no write', p.stats.writes.length === 0 && p.stats.cas === 0);
  ok('no extra read', p.stats.reads.length === 0); }

console.log('Hook: a save is worked out once, 3 seconds later, in one update');
async function hookTests() {
  const p = page({ ls: ON });
  save(p, 'pt_orderBook/ob1', { orderNo: 'AMZ-1', sku: 'S1' });
  p.t.oalAfterSave('', { 'pt_pressInventory/pr1': { orderNo: 'SHP-9', sku: 'S2' }, 'pt_shopProd/LEG-2__S6': { handedAt: '' }, 'pt_masters/x': 1 }, 'patch');
  save(p, 'pt_orderBook/ob1', { orderNo: 'AMZ-1', sku: 'S1' });
  ok('one timer for many saves, 3 s', p.timers.length === 1 && p.timers[0].ms === 3000, JSON.stringify(p.timers.map(x => x.ms)));
  ok('nothing written before the timer', p.stats.writes.length === 0);
  await p.runTimers();
  const w = listWrites(p);
  ok('ONE update', w.length === 1, String(w.length));
  const ks = Object.keys(w[0]).sort();
  ok('only the touched lines', ks.join() === ['pt_orderAlerts/l/AMZ-1__S1', 'pt_orderAlerts/l/LEG-2__S6', 'pt_orderAlerts/l/SHP-9__S2'].join(), ks.join());
  ok('the entry written is the shared rule\'s, with the SO date', w[0]['pt_orderAlerts/l/AMZ-1__S1'].due === '2026-11-01' && w[0]['pt_orderAlerts/l/AMZ-1__S1'].dh === 'so' && w[0]['pt_orderAlerts/l/AMZ-1__S1'].at > 0);
  save(p, 'pt_orderBook/ob1', { orderNo: 'AMZ-1', sku: 'S1' }); await p.runTimers();
  ok('a save that changes nothing writes nothing', listWrites(p).length === 1);
  const lines = fixtureLines(); lines[0].pressed = 3;
  const q = page({ ls: ON, lines, db: p.db }); q.t.OAL.last = new Map(p.t.OAL.last);
  save(q, 'pt_orderBook/ob1', { orderNo: 'AMZ-1', sku: 'S1' }); await q.runTimers();
  ok('a changed line is written (pieces pressed)', listWrites(q).length === 1 && p.db.get('pt_orderAlerts/l/AMZ-1__S1').pr === 3);
  lines[0].open = false; save(q, 'pt_orderBook/ob1', { orderNo: 'AMZ-1', sku: 'S1' }); await q.runTimers();
  ok('a closed line is taken off the list', p.db.get('pt_orderAlerts/l/AMZ-1__S1') === null);
  const n = page({ ls: ON, so: false }); save(n, 'pt_orderBook/ob1', { orderNo: 'AMZ-1', sku: 'S1' }); await n.runTimers();
  ok('a page without Sales Orders writes nothing (the check on another page sets it right)', n.stats.writes.length === 0);
  const r = page({ ls: ON, registers: false }); save(r, 'pt_orderBook/ob1', { orderNo: 'AMZ-1', sku: 'S1' }); await r.runTimers();
  ok('a page without the registers writes nothing and reads nothing', r.stats.writes.length === 0 && r.stats.reads.length === 0);
  const lk = page({ ls: ON, obRows: [{ _key: 'ob7', orderNo: 'ONL-3', sku: 'S3' }] });
  lk.t.oalAfterSave('', { 'pt_orderBook/ob7/status': 'closed' }, 'patch'); await lk.runTimers();
  ok('a deeper path finds its line from the page\'s copy', listWrites(lk).length === 1 && Object.keys(listWrites(lk)[0])[0] === 'pt_orderAlerts/l/ONL-3__S3');
  const lease = page({ ls: ON }); lease.t.oalAfterSave('pt_orderAlerts/lease', { by: 'x' }, 'put'); lease.t.oalAfterSave('pt_audit/x', 1, 'put');
  ok('the list\'s own and unrelated saves start nothing', lease.timers.length === 0);
  const bad = page({ ls: ON }); let threw = false;
  try { bad.t.oalAfterSave('pt_orderBook/x', { get orderNo() { throw new Error('boom'); }, sku: 'S' }, 'put'); bad.t.oalAfterSave(undefined, undefined, undefined); bad.t.oalAfterSave('', null, 'patch'); } catch (e) { threw = true; }
  ok('the hook never throws', !threw); }

console.log('Retry survives offline');
async function retryTests() {
  const p = page({ ls: ON });
  p.net.down = true;
  save(p, 'pt_orderBook/ob1', { orderNo: 'AMZ-1', sku: 'S1' }); await p.runTimers();
  ok('the failed line goes on the retry list', Object.keys(p.t.OAL.retry).join() === 'pt_orderAlerts/l/AMZ-1__S1');
  ok('...and is kept in storage', /AMZ-1__S1/.test(p.LS.get('oalRetry') || ''));
  ok('...a retry is planned', p.timers.length === 1 && p.timers[0].ms === 30000);
  p.net.down = false; await p.runTimers();
  ok('back online the line is written', p.db.get('pt_orderAlerts/l/AMZ-1__S1') && p.db.get('pt_orderAlerts/l/AMZ-1__S1').no === 'AMZ-1');
  ok('...and the retry list is empty', Object.keys(p.t.OAL.retry).length === 0 && !p.LS.has('oalRetry'));
  const q = page({ ls: ON });
  q.net.down = true; save(q, 'pt_orderBook/ob1', { orderNo: 'AMZ-1', sku: 'S1' }); await q.runTimers(); await q.runTimers();
  ok('still offline: kept, and the wait grows', Object.keys(q.t.OAL.retry).length === 1 && q.timers.length === 1 && q.timers[0].ms === 60000, JSON.stringify(q.timers.map(x => x.ms)));
  const big = page({ ls: ON }); big.net.down = true;
  big.t.oalAfterSave('', Object.fromEntries(Array.from({ length: 5 }, (_, i) => ['pt_pressInventory/p' + i, { orderNo: 'AMZ-' + (100 + i), sku: 'K' + i }])), 'patch'); await big.runTimers();
  ok('five lines in one failed update all wait for the retry', Object.keys(big.t.OAL.retry).length === 5); }

console.log('Lease and the full check');
async function checkTests() {
  const db = makeDb();
  const a = page({ ls: ON, db }), b = page({ ls: ON, db });
  await Promise.all([a.t.oalCheck(), b.t.oalCheck()]);
  const built = [a, b].filter(x => listWrites(x).length > 0);
  ok('of two pages one wins the lease', built.length === 1, String(built.length));
  const lease = db.get('pt_orderAlerts/lease');
  ok('...the lease names it and runs 15 minutes', lease && lease.by && lease.until - Date.now() > 14 * 60 * 1000 && lease.until - Date.now() <= 15 * 60 * 1000 + 1000);
  const list = db.get('pt_orderAlerts/l') || {};
  ok('the first check builds the whole list and the version', Object.keys(list).length === 53 && db.get('pt_orderAlerts/v') === 1 && db.get('pt_orderAlerts/at') > 0, String(Object.keys(list).length));
  const winner = built[0], loser = built[0] === a ? b : a;
  await loser.t.oalCheck();
  ok('the lease holds: the other page does nothing while it runs', listWrites(loser).length === 0);
  ok('...the log has the rebuild line, small', (() => { const day = Object.keys(db.get('pt_orderAlertsLog') || {})[0], l = db.get('pt_orderAlertsLog/' + day) || {}; const v = Object.values(l); return v.length === 1 && v[0].kind === 'rebuild' && JSON.stringify(v[0]).length < 300; })());
  /* drift: somebody's hand edit, a save made elsewhere */
  db.set('pt_orderAlerts/l/AMZ-1__S1/pr', 99); db.set('pt_orderAlerts/l/GONE-1__X', { no: 'GONE-1' });
  db.set('pt_orderAlerts/lease', { by: 'old', until: 1 });
  winner.stats.writes.length = 0;
  await loser.t.oalCheck();
  const fixed = db.get('pt_orderAlerts/l');
  ok('an expired lease passes to the other page, which repairs the list', fixed['AMZ-1__S1'].pr === 2 && !fixed['GONE-1__X']);
  const day = Object.keys(db.get('pt_orderAlertsLog'))[0], logs = Object.values(db.get('pt_orderAlertsLog/' + day)).filter(x => x.kind === 'check');
  ok('...and logs what it found', logs.length === 1 && logs[0].changed === 1 && logs[0].extra === 1 && logs[0].missing === 0 && logs[0].same === false && logs[0].sample.length === 2, JSON.stringify(logs));
  ok('...in a few small lines', JSON.stringify(logs[0]).length < 400);
  db.set('pt_orderAlerts/lease', { by: 'old', until: 1 });
  const before = Object.values(db.get('pt_orderAlertsLog/' + day)).length;
  loser.stats.writes.length = 0; await loser.t.oalCheck();
  ok('a clean check rewrites no line (only the checked-at time)', loser.stats.writes.length === 1 && Object.keys(loser.stats.writes[0]).join() === 'pt_orderAlerts/at');
  ok('...and a clean check is not logged again within the hour', Object.values(db.get('pt_orderAlertsLog/' + day)).length === before);
  const reads = page({ ls: ON, so: false }); await reads.t.oalCheck();
  ok('a page without Sales Orders does not check and reads nothing', reads.stats.reads.length === 0 && reads.stats.writes.length === 0 && reads.stats.cas === 0);
  const noreg = page({ ls: ON, registers: false }); await noreg.t.oalCheck();
  ok('a page without the registers does not check and reads nothing', noreg.stats.reads.length === 0 && noreg.stats.cas === 0);
  const nr = page({ ls: ON, denyRead: true }); await nr.t.oalCheck(); await nr.t.oalCheck();
  ok('a login refused the list read writes no log line and does not check again', nr.stats.writes.length === 0 && nr.stats.reads.length === 1 && nr.t.OAL.noRead === true, JSON.stringify(nr.stats.reads));
  const old = makeDb(); old.set('pt_orderAlerts/v', 0); old.set('pt_orderAlerts/l/OLD__X', { no: 'OLD' });
  await page({ ls: ON, db: old }).t.oalCheck();
  ok('a new rule version rebuilds the whole list', old.get('pt_orderAlerts/v') === 1 && !old.get('pt_orderAlerts/l/OLD__X') && Object.keys(old.get('pt_orderAlerts/l')).length === 53); }

console.log('The four save helpers tell the list');
async function helperTests() {
  function hist(failWith) {
    const calls = [], fetches = [];
    const ctx = {
      PT_URL: 'https://db', ptPath: p => p, ptAuthQuery: async () => '', ptLiveWrote: () => {}, BASE: { on: false }, ME: { email: 'a@b' },
      baseEnsureWhere: async () => {}, baseRoutePath: () => false, baseRouteUpdates: u => ({ updates: u, months: [] }), baseForget: async () => {},
      oalAfterSave: (p, v, k) => { calls.push([p, v, k]); },
      fetch: async (url, o) => {
        o = o || {}; fetches.push([url, o.method || 'GET']);
        /* the save itself fails; the history, sync and recycle-bin lines (their paths start pt_audit / pt_sync / pt_trash) do not */
        const hit = !!failWith && (o.method || 'GET') !== 'GET' && !/"pt_(audit|sync|trash)\//.test(String(o.body || ''));
        return { ok: !hit, status: hit ? 500 : 200, statusText: '', headers: { get: () => 'tag' }, json: async () => null };
      },
    };
    vm.createContext(ctx); vm.runInContext(HIST + '\n;this.__h = { ptPut, ptCas, ptPatch, ptDelete };', ctx);
    return { h: ctx.__h, calls, fetches };
  }
  const run = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message || e); } };
  const tick = () => new Promise(r => setTimeout(r, 5));
  let x = hist(); await x.h.ptPut('pt_orderBook/a', { orderNo: 'AMZ-1', sku: 'S1' }); await tick();
  ok('ptPut tells the list after a good save', x.calls.length === 1 && x.calls[0][0] === 'pt_orderBook/a' && x.calls[0][2] === 'put', JSON.stringify(x.calls));
  x = hist(); await x.h.ptCas('pt_flow/n', null, { n: 1 }); await tick();
  ok('ptCas tells the list after a good save', x.calls.length === 1 && x.calls[0][2] === 'put' && x.calls[0][1].n === 1, JSON.stringify(x.calls));
  x = hist(); await x.h.ptPatch({ 'pt_pressInventory/p': { orderNo: 'AMZ-1', sku: 'S1' } }); await tick();
  ok('ptPatch tells the list after a good save', x.calls.length === 1 && x.calls[0][2] === 'patch' && Object.keys(x.calls[0][1])[0] === 'pt_pressInventory/p', JSON.stringify(x.calls));
  x = hist(); await x.h.ptDelete('pt_orderBook/a'); await tick();
  ok('ptDelete tells the list after a good save', x.calls.length === 1 && x.calls[0][2] === 'delete' && x.calls[0][0] === 'pt_orderBook/a', JSON.stringify(x.calls));
  for (const [name, fn] of [['ptPut', h => h.ptPut('pt_orderBook/a', {})], ['ptPatch', h => h.ptPatch({ 'pt_orderBook/a': {} })], ['ptDelete', h => h.ptDelete('pt_orderBook/a')]]) {
    x = hist(true); const err = await run(() => fn(x.h)); await tick();
    ok(`a failed ${name} does not tell the list`, !!err && x.calls.length === 0, err + ' ' + JSON.stringify(x.calls));
  }
  /* ptCas that finds somebody else got there first writes nothing, so tells nothing */
  x = hist(); const res = await x.h.ptCas('pt_flow/n', { n: 5 }, { n: 6 }); await tick();
  ok('a ptCas that loses ("changed") does not tell the list', res === 'changed' && x.calls.length === 0);
  ok('a page without the alert list file still saves (typeof guard)', await (async () => { const c = { PT_URL: 'u', ptPath: p => p, ptAuthQuery: async () => '', ptLiveWrote: () => {}, BASE: { on: false }, ME: {}, fetch: async () => ({ ok: true, status: 200, headers: { get: () => '' }, json: async () => null }) };
    vm.createContext(c); vm.runInContext(HIST + '\n;this.__h = { ptPut };', c); return (await c.__h.ptPut('pt_x/a', 1)) === null; })());
  /* after the sync note, and after the save: the order inside each helper */
  const body = n => { const i = HIST.indexOf('function ' + n + '('); const j = HIST.indexOf('\n}\n', i); return HIST.slice(i, j); };
  for (const n of ['ptPut', 'ptCas', 'ptPatch', 'ptDelete']) {
    const b = body(n), hk = b.indexOf('oalAfterSave'), sn = b.indexOf('ptSyncNote');
    ok(`${n}: one guarded hook line, after ptSyncNote`, (b.match(/oalAfterSave/g) || []).length === 2 && /if \(typeof oalAfterSave === 'function'\) oalAfterSave\(/.test(b) && sn > 0 && hk > sn);
  } }

console.log('Nothing writes to the database except the four helpers');
/* Every place that can write: a fetch with PUT / PATCH / DELETE, or a Firestore write. The list is what exists today. */
const WRITERS = {
  http: { 'core/history.js': 5 },                                 // ptAuditWrite (1) + ptPut, ptCas, ptPatch, ptDelete
  post: { 'replenishment/india-usa-express.js': 1, 'vendors/portal/phone-pin.js': 2 },      // Apps Script / sign-in PIN, not the database
  fire: { 'core/access-design.js': 4, 'masters/master-database-edit.js': 2, 'orders/custom-order-skus.js': 2, 'replenishment/article-review.js': 3,
    'replenishment/fba-box-template.js': 1, 'replenishment/follow-ups.js': 3, 'replenishment/minutes-of-meeting.js': 1, 'replenishment/packing-list-labels.js': 2,
    'replenishment/priority.js': 1, 'replenishment/purchase-orders.js': 3, 'replenishment/replenishment.js': 10, 'replenishment/revenue-target.js': 3,
    'replenishment/top-asin.js': 4, 'shopify/shopify-orders.js': 3, 'vendors/portal/phone-pin.js': 2 },   // Firestore documents (settings, requests), not the production database
};
function srcFiles(dir, rel) { rel = rel || ''; return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(d => d.isDirectory() ? srcFiles(dir, path.posix.join(rel, d.name)) : (d.name.endsWith('.js') ? [path.posix.join(rel, d.name)] : [])); }
function scanWrites(files) {
  const bad = [], count = (re, t) => (t.match(re) || []).length;
  Object.keys(files).forEach(f => {
    const t = files[f];
    [['http', /method:\s*['"](PUT|PATCH|DELETE)['"]/g], ['post', /method:\s*['"]POST['"]/g], ['fire', /\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\(/g],
      ['sdk', /\b(set|update|push|remove)\(\s*ref\(/g]].forEach(([k, re]) => {
      const n = count(re, t), allowed = (WRITERS[k] || {})[f] || 0;
      if (n !== allowed) bad.push(`${f}: ${n} ${k} write(s), ${allowed} allowed`);
    });
  });
  return bad;
}
{ const files = {}; srcFiles(APP).forEach(f => { files[f] = rd(path.join(APP, f)); });
  const bad = scanWrites(files);
  ok('every database write is one of the four helpers (or a listed writer)', bad.length === 0, bad.join('; '));
  ok('the alert list has no write of its own (it goes through ptAuditWrite)', !/method:|setDoc|fetch\(/.test(ALERTS) && /ptAuditWrite\(/.test(ALERTS));
  const sneak = Object.assign({}, files, { 'orders/sneaky.js': "await fetch(url, { method: 'PUT', body: x });" });
  ok('teeth: a stray PUT in another file is caught', scanWrites(sneak).length === 1);
  const sneak2 = Object.assign({}, files, { 'orders/sneaky.js': 'await setDoc(doc(db, "a", "b"), {});' });
  ok('teeth: a stray Firestore write is caught', scanWrites(sneak2).length === 1);
  const sneak3 = Object.assign({}, files, { 'core/history.js': files['core/history.js'] + "\nawait fetch(u, { method: 'PATCH' });" });
  ok('teeth: a sixth write inside history.js is caught', scanWrites(sneak3).length === 1);
  ok('teeth: the list keeps all of today\'s writers (an allow-list entry nobody uses is caught)', scanWrites(Object.assign({}, files, { 'replenishment/top-asin.js': '' })).length === 1); }

(async () => {
  await offTests();
  await hookTests(); await retryTests(); await checkTests(); await helperTests();
  /* Teeth: broken copies must make this suite fail. */
  if (!process.env.OA_TICKER && !process.env.OA_ALERTS && !process.env.OA_HIST) {
    console.log('Teeth');
    const T = rd(path.join(APP, 'orders', 'order-ticker.js')), A = rd(path.join(APP, 'orders', 'order-alerts.js')), H = rd(path.join(APP, 'core', 'history.js'));
    const BROKEN = [
      ['pieces owed off by one', 'OA_TICKER', T.replace('Math.max(0, l.qty - l.pr - l.fs)', 'Math.max(0, l.qty - l.pr - l.fs + 1)')],
      ['the sales order date is not used', 'OA_ALERTS', A.replace("const so = (soDue && soDue.get(l.orderNo + '|' + l.sku)) || '';", "const so = '';")],
      ['hook removed from ptPatch', 'OA_HIST', H.replace("  if (typeof oalAfterSave === 'function') oalAfterSave('', updates, 'patch');\n", '')],
      ['hook removed from ptDelete', 'OA_HIST', H.replace("  if (typeof oalAfterSave === 'function') oalAfterSave(path, null, 'delete');\n", '')],
      ['hook fires before the save is known good', 'OA_HIST', H.replace("  if (typeof oalAfterSave === 'function') oalAfterSave(path, value, 'put');\n", '').replace("  const r = await fetch(`${PT_URL}/${ptPath(path)}.json` + await ptAuthQuery(), {\n    method: 'PUT'", "  if (typeof oalAfterSave === 'function') oalAfterSave(path, value, 'put');\n  const r = await fetch(`${PT_URL}/${ptPath(path)}.json` + await ptAuthQuery(), {\n    method: 'PUT'")],
      ['switch off still writes', 'OA_ALERTS', A.replace('function oalOn() {', 'function oalOn() { return true;')],
      ['the check ignores the switch', 'OA_ALERTS', A.replace('if (!oalOn() || OAL.busy || OAL.noRead || !oalReady()) return;', 'if (OAL.busy || !oalReady()) return;')],
      ['a failed write is forgotten (no retry)', 'OA_ALERTS', A.replace('catch (e) { oalKeep(up); }\n}', 'catch (e) { /* lost */ }\n}')],
      ['no lease: every page checks', 'OA_ALERTS', A.replace("if (cur && cur.until > now && cur.by !== OAL.me) return false;", '').replace("return (await ptCas(OAL_NODE + '/lease', cur == null ? null : cur, { by: OAL.me, until: now + OAL_CHECK_MS })) === '';", 'return true;')],
      ['every line written every time', 'OA_ALERTS', A.replace("if (OAL.last.has(k) && OAL.last.get(k) === fp) return;", '')],
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oal-'));
    BROKEN.forEach(([name, env, src], k) => {
      const orig = env === 'OA_TICKER' ? T : env === 'OA_ALERTS' ? A : H;
      if (src === orig) { ok('teeth: ' + name + ' (mutation applied)', false, 'the text to break was not found'); return; }
      const f = path.join(dir, 'b' + k + '.js'); fs.writeFileSync(f, src);
      const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { [env]: f }), encoding: 'utf8' });
      ok('teeth: ' + name, r.status !== 0);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
