/* PPC · a lot's history card (src/app/core/ppc-one.js — p1History and its helpers), and the main list's stage cells and order.
 * Ravi, 24 Nov: "the 2nd image is not even understandable"; 25 Nov, of the step cards: "make it like I can actually know which
 * peice is where and also how manuy peices passed which stage and when". The card now shows where every ordered piece is
 * (adding up to the order) and what passed each step on which day, then the entries.
 *   node tests/ppc-history-test.js      (PPC_ONE=<file> to test another copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.env.PPC_ONE || path.join(__dirname, '..', 'src', 'app', 'core', 'ppc-one.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

const obUC = s => String(s == null ? '' : s).trim().toUpperCase();
function load(events) {
  const ctx = {
    obUC, esc: s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])),
    flowKey: (o, s) => obUC(o) + '__' + obUC(s), ptIsoDate: v => String(v || '').slice(0, 10), ptDtMs: v => Date.parse(v) || 0,
    FLOW: { ppc: {}, res: {} }, FLOW_ROUTES: [], flowRouteOf: () => 'inhouse', ME: { admin: true }, console, Date, Math, Set, Map, setTimeout: () => 0, document: { querySelector: () => null, addEventListener() {} }, $: () => null,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(FILE, 'utf8') + '\n;this.__t = { P1, p1History, p1HistNote, p1HistPlaces, p1HistPassed, p1StageCell, p1PendingOrder, p1Urgent };', ctx);
  ctx.p1Events = () => events || [];   // the registers are not read here: the card's events are given
  return ctx.__t;
}
const line = (o, st, s) => ({ x: { r: { orderNo: o, sku: 'CPC-01', qty: st.q }, s: Object.assign({ key: obUC(o) + '__CPC-01' }, s) }, st });
const stage = (w, done, na) => ({ w: w || 0, m: 0, done: !!done, na: !!na });
/** One order line's WIP figures (p1WipLine's shape): only the places given are filled. */
const W = o => Object.assign({ q: 0, done: 0, bal: 0, grg: 0, prn: 0, m: 0, emb: 0, cut: 0, raw: 0, kar: 0, qc: 0, rdy: 0, inp: 0, todo: 0, who: [] }, o);
const ago = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const E = (k, day, pcs, o) => Object.assign({ k, day, ms: Date.parse(day + 'T10:00:00'), t: true, orderNo: 'AMZ-1', sku: 'CPC-01', pcs, unit: 'pcs', party: '', by: '', ref: '', vr: '' }, o);

/* Ravi's screen, 25 Nov ("its not even understandable … which peice is where and … how many peices passed which stage and
 * when"): 50 ordered, 44 still at the RFD store for SS Hand Block (41 days), 2 printed back and waiting to be cut, 4 in
 * Finished Goods — the step cards said "Not yet · 4 of 50" five times over and never where the 2 were. */
const ev = [E('ISS', '2026-11-10', 1, { party: 'Prem Singh', by: 'mohit', ref: 'Job Work · issue', vr: 'bd_1' }), E('QC', '2026-11-12', 1, { party: 'Rajkumar', by: 'Rajkumar', ref: 'QC check', vr: 'qc_1' }),
  E('FG', '2026-11-13', 1, { party: 'QC (Production flow)', by: 'ridhistore22', ref: 'Finished Goods RCP-A', vr: 'RCP-A' }), E('ISS', '2026-11-17', 3, { party: 'Prem Singh' }),
  E('REC', '2026-11-18', 3, { party: 'Prem Singh' }), E('RFD', '2026-11-18', 2, { party: 'SS Hand Block', ref: 'Challan RFD-306', vr: 'RFD-306' }), E('PRN', '2026-11-18', 2, { party: 'SS Hand Block' }),
  E('QC', '2026-11-18', 3, { party: 'Choti Devi', ref: 'QC check · 6 for alteration' }), E('FG', '2026-11-19', 1, { party: 'QC (Production flow)', ref: 'Finished Goods RCP-B', vr: 'RCP-B' }), E('FG', '2026-11-19', 2, { party: 'QC (Production flow)', ref: 'Finished Goods RCP-C', vr: 'RCP-C' })];
const way = { planned: true, q: 50, plan: stage(0, 1), rfd: stage(44), prn: stage(0), cut: stage(2), iss: stage(0), kar: stage(0), qc: stage(0), rdy: stage(0) };
const A = load(ev);
const R = (o) => Object.assign({ gk: 'L1', lot: null, notPlanned: 0, sku: 'CPC-01', what: 'Square Tablecloth', ordered: 50, orders: new Set(['AMZ-1']),
  lines: [line('AMZ-1', way, {}).x], ln: [line('AMZ-1', way, {})], wl: [W({ q: 50, done: 4, cut: 2, grg: 44 })],
  holds: [{ orderNo: 'AMZ-1', sku: 'CPC-01', stage: 'RFD store', since: ago(41), who: 'SS Hand Block' }, { orderNo: 'AMZ-1', sku: 'CPC-01', stage: 'Cutting', since: ago(7), who: 'Cutting department' }] }, o);
A.P1.hist = 'L1'; A.P1.histOrd = '';
{ const D = { rfd: { days: 41, who: ['SS Hand Block'] }, cut: { days: 7, who: [] } }, pl = A.p1HistPlaces([W({ q: 50, done: 4, cut: 2, grg: 44 })], 50, D);
  ok('where the pieces are: 4 in Finished Goods, 2 to cut, 44 at the RFD store — adding up to the 50 ordered',
    pl.rows.map(x => x.f + ' ' + x.pcs).join(', ') === 'done 4, cut 2, grg 44' && pl.rows.reduce((t, x) => t + x.pcs, 0) === 50 && !pl.over, JSON.stringify(pl.rows.map(x => [x.f, x.pcs])));
  ok('…the RFD store row says who it is for and since when (SS Hand Block, 41 days)', pl.rows[2].who[0] === 'SS Hand Block' && pl.rows[2].days === 41);
  const nt = A.p1HistPlaces([W({ q: 50, done: 4 })], 50, {});
  ok('pieces no register places are shown as "not traced", never dropped (46 of 50)', nt.rows[1].f === 'none' && nt.rows[1].pcs === 46 && /Not traced/.test(nt.rows[1].label));
  const cl = A.p1HistPlaces([W({ q: 50, m: 71 })], 50, { prn: { days: 9, who: ['Bhavya Ethnic'] } });
  ok('cloth at the printer (metres, not pieces yet): the rest of the order is "At printer, as cloth (71 m)"', cl.rows.length === 1 && cl.rows[0].pcs === 50 && cl.rows[0].label === 'At printer, as cloth (71 m)' && cl.rows[0].who[0] === 'Bhavya Ethnic');
  ok('more placed than ordered is counted, to be said', A.p1HistPlaces([W({ q: 50, done: 40, qc: 20 })], 50, {}).over === 10); }
{ const S = { rfd: stage(44), prn: stage(0), cut: stage(2), iss: stage(0), kar: stage(0), qc: stage(0), rdy: stage(0) }, ps = A.p1HistPassed(ev, S), by = k => ps.find(x => x.k === k);
  ok('what passed each step: QC 4, on 12 Nov (1) and 18 Nov (3)', by('QC').n === 4 && JSON.stringify(by('QC').days) === JSON.stringify([{ day: '2026-11-12', n: 1 }, { day: '2026-11-18', n: 3 }]));
  ok('…given to karigar 4 (10 Nov · 1, 17 Nov · 3); into Finished Goods 4 (13 Nov · 1, and 1 + 2 on 19 Nov made one: 19 Nov · 3)', by('ISS').n === 4 && by('ISS').days.length === 2 && by('FG').n === 4 && JSON.stringify(by('FG').days) === JSON.stringify([{ day: '2026-11-13', n: 1 }, { day: '2026-11-19', n: 3 }]));
  ok('a step on the way with no entry yet is listed ("Cut", none yet); rejected and shipping only when on record', by('CUT') && by('CUT').n === 0 && !by('REJ') && !by('SHIP'));
  ok('cloth sent in metres stays in metres', A.p1HistPassed([E('RFD', '2026-11-18', 71, { unit: 'm' })], { rfd: stage(0) })[0].unit === 'm'); }
{ const h = A.p1History(R());
  ok('the card: "Where the 50 pieces are now", a bar, and every place in the list', /Where the 50 pieces are now/.test(h) && /class="hbar"/.test(h) && /<b>44<\/b><span class="hp-l">At RFD store, not sent to the printer yet<\/span><span class="hp-w">for SS Hand Block<\/span><span class="hp-d late">4[12] days<\/span>/.test(h) && /<b>2<\/b><span class="hp-l">To cut/.test(h) && /<b>4<\/b><span class="hp-l">In Finished Goods/.test(h));
  ok('…the bar\'s parts are shares of the order (44 of 50 = 88%)', /class="hb st" style="width:88.00%"/.test(h));
  ok('"What passed each step, and when": Passed QC 4, of 50, 12 Nov · 1 and 18 Nov · 3', /<b>Passed QC<\/b><\/td><td class="num"><b>4<\/b>[^]*?of 50[^]*?12 Nov · <b>1<\/b>[^]*?18 Nov · <b>3<\/b>/.test(h));
  ok('…a step with nothing yet says "none yet"', /<b>Cut<\/b><\/td><td class="num"><b>—<\/b>[^]*?none yet/.test(h));
  ok('no lot and nothing waiting for a plan → "No lot", not "To plan"', />No lot</.test(h) && !/>To plan</.test(h));
  ok('the register\'s own words are dropped ("Job Work · issue"), the voucher shown once', !/Job Work · issue/.test(h) && (h.match(/RCP-A/g) || []).length === 1);
  ok('a note worth reading stays ("6 for alteration")', /QC check · 6 for alteration/.test(h));
  ok('one order: no Order column', !/<th>Order<\/th>/.test(h));
  ok('the old step cards are gone', !/class="hcards"|class="hc /.test(h));
  ok('something still waiting for a plan → "To plan"', />To plan</.test(A.p1History(R({ notPlanned: 50 })))); }
{ /* Ravi's CPC-01 (24 Nov): 621 into Finished Goods on an order of 497 — said in red, never shown as if it were the count */
  const B = load([E('FG', '2026-10-29', 621)]), w497 = { planned: true, q: 497, plan: stage(0, 1), rfd: stage(0, 0, 1), prn: stage(0, 0, 1), cut: stage(0, 1), iss: stage(0, 1), kar: stage(0, 1), qc: stage(0, 1), rdy: stage(0, 1) };
  B.P1.hist = 'L9'; B.P1.histOrd = '';
  const h = B.p1History({ gk: 'L9', lot: null, notPlanned: 0, sku: 'CPC-01', what: 'x', ordered: 497, orders: new Set(['AMZ-1']), lines: [line('AMZ-1', w497, {}).x], ln: [line('AMZ-1', w497, {})], wl: [W({ q: 497, done: 497 })], holds: [] });
  ok('entries past the order: 621 into Finished Goods in red, "more than the 497 ordered"', /<b class="late">621<\/b>[^]*?more than the 497 ordered/.test(h));
  ok('…while where the pieces are still adds up: all 497 in Finished Goods', /<b>497<\/b><span class="hp-l">In Finished Goods/.test(h) && !/Not traced/.test(h)); }
{ /* two orders on one lot: the order picked narrows both parts to its own line */
  const w1 = Object.assign({}, way, { q: 30 }), w2 = Object.assign({}, way, { q: 20 });
  const r = R({ orders: new Set(['AMZ-1', 'AMZ-2']), lines: [line('AMZ-1', w1, {}).x, line('AMZ-2', w2, {}).x], ln: [line('AMZ-1', w1, {}), line('AMZ-2', w2, {})],
    wl: [W({ q: 30, done: 30 }), W({ q: 20, grg: 20 })], holds: [] });
  ok('all orders: an Order column, "Where the 50 pieces"', /<th>Order<\/th>/.test(A.p1History(r)) && /Where the 50 pieces/.test(A.p1History(r)));
  A.P1.histOrd = 'AMZ-2'; const h2 = A.p1History(r); A.P1.histOrd = '';
  ok('…order AMZ-2 picked: "Where the 20 pieces", only its 20 at the RFD store', /Where the 20 pieces/.test(h2) && /<b>20<\/b><span class="hp-l">At RFD store/.test(h2) && !/In Finished Goods<\/span>/.test(h2)); }

ok('a plan entry shows no voucher (its lot number)', A.p1HistNote({ k: 'PLAN', ref: 'Plan · Printing', vr: '001-GR' }) === 'Plan · Printing');

/* THE MAIN LIST (Ravi, 24 Nov: "refine this page design too" — keep the columns, late and stuck first) */
{ const c = A.p1StageCell;
  ok('pieces waiting: an amber pill with the pieces and days', c({ w: 40, m: 0 }, { days: 3 }) === '<td class="sg"><span class="wp"><b>40</b><i>3 d</i></span></td>');
  ok('…waiting past 7 days turns the pill red', /class="wp late"/.test(c({ w: 210, m: 0 }, { days: 11 })) && !/late/.test(c({ w: 210, m: 0 }, { days: 7 })));
  ok('…metres at the printer: "71 m"', /<b>71 m<\/b>/.test(c({ w: 0, m: 71 }, { days: 9 })));
  ok('done: a soft ✓', /sdone"><span class="dn">✓/.test(c({ w: 0, m: 0, done: true })));
  ok('not reached yet: blank, no grey dot', c({ w: 0, m: 0, done: false }) === '<td class="sg"></td>');
  ok('not this lot\'s way: a faint dash', c({ na: true }) === '<td class="sg sna">—</td>');
  /* dev, 24 Nov: the RFD store column says which printer the cloth is for — kept on the new pills */
  ok('At RFD store: the pill and "for <printer>" under it', /<b>50<\/b><i>2 d<\/i><\/span><span class="for">for Bhavya Ethnic<\/span>/.test(c({ w: 50, m: 0 }, { days: 2, who: ['Bhavya Ethnic'] }, 'rfd')));
  ok('…other columns never say "for"', !/class="for"/.test(c({ w: 50, m: 0 }, { days: 2, who: ['Sunil'] }, 'kar'))); }
{ const L = (sku, o) => Object.assign({ sku, lot: { id: '2611-' + sku }, over: 0, stuck: 0 }, o);
  const list = [L('A'), L('B', { stuck: 9 }), L('C', { over: 3 }), L('N', { lot: null }), L('D', { over: 8, stuck: 2 }), L('E', { stuck: 7 })].sort(A.p1PendingOrder).map(r => r.sku).join(' ');
  ok('Pending: late lots first (latest first), then stuck past 7 days, then not planned, then by lot', list === 'D C B N A E', list);
  ok('7 days at one place is not stuck yet; 8 is', !A.p1Urgent(L('x', { stuck: 7 })) && A.p1Urgent(L('x', { stuck: 8 }))); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
