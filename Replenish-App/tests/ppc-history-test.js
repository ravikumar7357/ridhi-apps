/* PPC · a lot's history card (src/app/core/ppc-one.js — p1History and its helpers), and the main list's stage cells and order.
 * Ravi, 24 Nov: "the 2nd image is not even understandable" — the card said "To plan" over a line that was cut, issued and
 * in QC, showed Cut 0 beside "✓ Cut" and 621 into Finished Goods on an order of 497. It now opens on where the pieces are,
 * with counts that never pass the order, and says it when the entries add up to more.
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
  vm.runInContext(fs.readFileSync(FILE, 'utf8') + '\n;this.__t = { P1, p1History, p1HistSay, p1HistNote, p1LineDone, p1HistSteps, p1StageCell, p1PendingOrder, p1Urgent };', ctx);
  ctx.p1Events = () => events || [];   // the registers are not read here: the card's events are given
  return ctx.__t;
}
const line = (o, st, s) => ({ x: { r: { orderNo: o, sku: 'CPC-01' }, s: Object.assign({ key: obUC(o) + '__CPC-01' }, s) }, st });
const stage = (w, done, na) => ({ w: w || 0, m: 0, done: !!done, na: !!na });
/* Ravi's CPC-01: 497 ordered, issued without a Cutting Data row, 95 passed QC, all 497 in Finished Goods (before the fix the
 * line still showed 402 in QC — the flow rule now closes it; this card must still read straight for any such line) */
const inQc = { planned: true, q: 497, plan: stage(0, 1), rfd: stage(0, 0, 1), prn: stage(0, 0, 1), cut: stage(0, 1), iss: stage(0, 1), kar: stage(0, 1), qc: stage(402), rdy: stage(0, 1) };
const sQc = { back: 0, cut: 0, issuedNet: 497, received: 497, qc: 95, india: 497 };
const ev = [
  { k: 'ISS', ms: 1, day: '2026-10-08', t: true, orderNo: 'AMZ-1', sku: 'CPC-01', pcs: 101, unit: 'pcs', party: 'Pradeep Contractor', by: 'mohit', ref: 'Job Work · issue', vr: 'bd_1' },
  { k: 'QC', ms: 2, day: '2026-10-09', t: true, orderNo: 'AMZ-1', sku: 'CPC-01', pcs: 95, unit: 'pcs', party: 'Anita', by: 'Anita', ref: 'QC check · 6 for alteration', vr: 'qc_1' },
  { k: 'FG', ms: 3, day: '2026-10-29', t: true, orderNo: 'AMZ-1', sku: 'CPC-01', pcs: 621, unit: 'pcs', party: 'Production', by: 'rahul', ref: 'Finished Goods RCP-MV', vr: 'RCP-MV' }];

const A = load(ev);
{ const d = A.p1LineDone(line('AMZ-1', inQc, sQc).x, inQc);
  ok('step counts come from the line, capped at its order: issued 497, QC 95, in FG 497', d.iss === 497 && d.qc === 95 && d.rdy === 497 && d.cut === 0);
  const big = A.p1LineDone({ s: { india: 621, received: 900 } }, { planned: true, q: 497 });
  ok('…a register past the order never shows more than the order (621 in FG → 497)', big.rdy === 497 && big.kar === 497); }

{ const r = { gk: 'NEW|CPC-01', lot: null, notPlanned: 0, sku: 'CPC-01', what: 'Square Tablecloth', ordered: 497, orders: new Set(['AMZ-1']),
    ln: [line('AMZ-1', inQc, sQc)], lines: [line('AMZ-1', inQc, sQc).x], holds: [{ orderNo: 'AMZ-1', sku: 'CPC-01', stage: 'QC', since: '2026-10-08', who: 'Quality Control' }] };
  A.P1.hist = r.gk; A.P1.histOrd = '';
  const h = A.p1History(r);
  ok('no lot and nothing waiting for a plan → "No lot", not "To plan"', />No lot</.test(h) && !/>To plan</.test(h));
  ok('opens on where the pieces are: "402 pcs in QC"', /Where the 497 pieces are now/.test(h) && /<b>402 pcs<\/b> in QC/.test(h));
  ok('a step done with no entry of its own says so (Cut), not "0 of 497"', /Cut<\/div><div class="hc-ok">✓ Done<\/div><div class="hc-n"><span class="muted">no entry of its own/.test(h));
  ok('QC passed reads "95 of 497"', /QC passed<\/div>[^]*?<b>95<\/b> of 497/.test(h));
  ok('a step not this line\'s way (printing) is left out', !/>Printed</.test(h));
  ok('entries past the order are said under the list: into FG 621', /more than the 497 ordered/.test(h) && /in finished goods <b>621<\/b>/.test(h));
  ok('the register\'s own words are dropped ("Job Work · issue"), the voucher shown once', !/Job Work · issue/.test(h) && (h.match(/RCP-MV/g) || []).length === 1);
  ok('a note worth reading stays ("6 for alteration")', /QC check · 6 for alteration/.test(h));
  ok('one order: no Order column', !/<th>Order<\/th>/.test(h));
  r.notPlanned = 497; ok('something still waiting for a plan → "To plan"', />To plan</.test(A.p1History(r))); }

{ const done = { planned: true, q: 10, plan: stage(0, 1), rfd: stage(0, 0, 1), prn: stage(0, 1), cut: stage(0, 1), iss: stage(0, 1), kar: stage(0, 1), qc: stage(0, 1), rdy: stage(0, 1) };
  const r = { gk: 'L1', lot: null, notPlanned: 0, ln: [line('A', done, { back: 10, cut: 10, issuedNet: 10, received: 10, qc: 10, india: 10 })] };
  ok('all through → "All 10 pieces are in Finished Goods."', A.p1HistSay(A.p1HistSteps(r, r.ln).filter(s => !s.na), 10) === 'All 10 pieces are in Finished Goods.'); }

{ const kar = { planned: true, q: 10, plan: stage(0, 1), rfd: stage(0, 0, 1), prn: stage(0, 0, 1), cut: stage(0, 1), iss: stage(0, 1), kar: stage(10), qc: stage(0), rdy: stage(0) };
  const r = { gk: 'L2', ln: [line('B', kar, { issuedNet: 10 })], holds: [{ orderNo: 'B', sku: 'CPC-01', stage: 'With karigar', since: '2026-11-20', who: 'Sunil' }] };
  const say = A.p1HistSay(A.p1HistSteps(r, r.ln).filter(s => !s.na), 10);
  ok('with a karigar: "10 pcs with Sunil", never "with karigar with Sunil"', /<b>10 pcs<\/b> with Sunil/.test(say) && !/with karigar with/.test(say), say); }

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
{ const rfdW = { planned: true, q: 50, plan: stage(0, 1), rfd: stage(50), prn: stage(0), cut: stage(0, 0, 1), iss: stage(0), kar: stage(0), qc: stage(0), rdy: stage(0) };
  const r = { gk: 'L3', ln: [line('C', rfdW, { given: 0 })], holds: [{ orderNo: 'C', sku: 'CPC-01', stage: 'Printer', ref: 'print order to give', since: '2026-11-22', who: 'Bhavya Ethnic' }] };
  const steps = A.p1HistSteps(r, r.ln).filter(s => !s.na), say = A.p1HistSay(steps, 50);
  ok('history: cloth still at the RFD store → "50 pcs at RFD store, for Bhavya Ethnic"', /<b>50 pcs<\/b> at RFD store, for Bhavya Ethnic/.test(say), say);
  ok('…and its card "Cloth to printer" counts what was given: 0 of 50', steps.some(s => s.k === 'rfd' && s.title === 'Cloth to printer' && s.got === 0 && s.of === 50)); }
{ const L = (sku, o) => Object.assign({ sku, lot: { id: '2611-' + sku }, over: 0, stuck: 0 }, o);
  const list = [L('A'), L('B', { stuck: 9 }), L('C', { over: 3 }), L('N', { lot: null }), L('D', { over: 8, stuck: 2 }), L('E', { stuck: 7 })].sort(A.p1PendingOrder).map(r => r.sku).join(' ');
  ok('Pending: late lots first (latest first), then stuck past 7 days, then not planned, then by lot', list === 'D C B N A E', list);
  ok('7 days at one place is not stuck yet; 8 is', !A.p1Urgent(L('x', { stuck: 7 })) && A.p1Urgent(L('x', { stuck: 8 }))); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
