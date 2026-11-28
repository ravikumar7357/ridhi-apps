/* REJECTED PIECES ARE SCRAPPED, on the screens (Ravi, 27 Nov): an order of 100 with 5 rejected WITH A REASON reads the same on
 * the PPC line, the lot's history card and the PPC Report — 5 Rejected, 5 to cut, none with a karigar — and the Order Console
 * and the SHP board agree with what Cutting Data and the Job Work form accept. Without a reason, or with the switch lineHold
 * off, every figure and column is as before. (src/app/core/ppc-one.js, flow/flow-report.js, flow/flow-core.js,
 * orders/production-to-shipping.js, orders/shp-board.js.) Cases are made up.
 *   node tests/rejected-screens-test.js      (SCREENS_APP=<folder like src/app> tests another copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.SCREENS_APP || path.join(__dirname, '..', 'src', 'app');
const src = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
/** From the line that matches to the next closing brace at the margin (or to `end`). */
function cut(file, startRe, end) {
  const s = src(file), i = s.search(startRe);
  if (i < 0) throw new Error(String(startRe) + ' not found in ' + file);
  return s.slice(i, s.indexOf(end || '\n}', i) + (end || '\n}').length);
}
const L = 'core/lookups.js', J = 'production/job-work-entry.js', K = 'core/look-alike-skus.js', F = 'flow/flow-core.js',
  O = 'orders/production-to-shipping.js', S = 'orders/shp-board.js';
const CODE = [cut('core/history.js', /^function lineHoldOn\(/m),
  cut(L, /^let BASE_IX/m, ';'), cut(L, /^function obBaseIndex\(/m), cut(L, /^function obRowScrap\(/m), cut(L, /^const obQcRows/m, '\n'),
  cut(L, /^const obQcScrapOf/m, '\n'), cut(L, /^let QCREJ_IX/m, ';'), cut(L, /^function obQcRejIndex\(/m), cut(L, /^function obQcScrapQty\(/m), cut(L, /^function flowRejOf\(/m),
  cut(K, /^const obCutKept/m, ';'), cut(K, /^function cutGuard\(/m),
  cut(J, /^function obIssueSums\(/m), cut(J, /^function obIssueOfOrder\(/m), cut(J, /^function obIssueOfCut\(/m), cut(J, /^function bdPrintedBackErr\(/m), cut(J, /^function bdCutReq\(/m), cut(J, /^function bdGuard\(/m),
  cut(F, /^function flowCountScrap\(/m), cut(F, /^function flowScrapRedo\(/m), cut(F, /^function flowReplaceCloth\(/m), cut(F, /^function flowStoreClothPcs\(/m), cut(F, /^function flowState\(/m),
  cut('flow/flow-entries.js', /^const flowIssuable/m, ';'), cut('reports/last-week.js', /^function repRecvDated\(/m),
  cut(O, /^function ordLinesBuild\(/m), cut(O, /^function pdIso\(/m), cut(S, /^function shpbScrapOf\(/m), cut(S, /^function shpbStages\(/m),
  src('flow/flow-report.js'), src('core/ppc-one.js')].join('\n');

const NO = 'OC-1', SKU = 'MADE-UP';
const up = s => String(s || '').trim().toUpperCase();
const num = v => Number(v) || 0;
/** One order line of 100, planned, and its registers. o: { off, noCut, printed, store, cut, jobs, checks } */
function line(o) {
  o = o || {};
  const qty = 100, cutQty = o.cut == null ? 100 : o.cut, cuts = !o.noCut, jobs = o.jobs || [], checks = o.checks || [];
  const sum = (rows, f) => rows.reduce((t, r) => t + (+r[f] || 0), 0), passed = sum(checks, 'ok');
  const plan = { route: o.printed != null ? 'inhouse' : 'stitch', at: '2026-11-20T05:00:00Z', sku: SKU, fabric: { name: 'Cotton', perPc: 2, metres: 200 } };
  const home = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const ctx = {
    console, Date, Math, Set, Map, setTimeout: () => 0, nf: String, esc: s => String(s == null ? '' : s), obUC: up, ptNum: num, PT_NONE: Object.freeze([]),
    obKeyOf: (a, b) => up(a) + '|' + up(b), flowKey: (a, b) => up(a) + '__' + up(b), ptIsoDate: v => String(v || '').slice(0, 10), ptDtMs: v => Date.parse(v) || 0,
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }, $: id => (id === 'p1Home' ? home : null), ME: { admin: true },
    localStorage: { getItem: k => (k === 'lineHold' && !o.off ? '1' : null) },
    PT: { base: jobs.map(j => Object.assign({ orderNo: NO, sku: SKU, empName: 'Kajal', issueDate: '2026-11-22', receivingDate: '2026-11-25' }, j)), cut: [{ orderNo: NO, sku: SKU, pieces: cutQty, cutDate: '2026-11-21' }] },
    PTG: { qc: [], press: [], mdb: [], ob: [{ orderNo: NO, sku: SKU, qty, orderDate: '2026-11-19' }] },
    QC: { checks: checks.map(c => Object.assign({ orderNo: NO, sku: SKU, date: '2026-11-26' }, c)) },
    FLOW: { ppc: { [up(NO) + '__' + SKU]: plan }, dem: {}, res: {}, ch: {} }, FLOW_REAL: true, FLOW_ROUTES: [], flowRouteOf: p => p.route, flowPrinted: r => r === 'inhouse',
    flowFrom: () => '2026-01-01', flowOpenNew: () => false, flowInHand: () => false, flowEmbByVendor: () => false, flowR2: n => Math.round(n * 100) / 100,
    flowChIndex: () => ({}), flowPoIndex: () => ({}), flowPrintWhat: () => ({ kind: cuts ? 'fabric' : 'sku', code: 'X' }), flowToPrint: () => ({ pcs: qty, metres: 200 }),
    flowRemFrac: () => 1, flowPrintsSomething: () => true, flowPrintedStock: () => o.store || 0, flowFabOwed: () => ({ unit: 'pcs', left: 0, need: 100 }), flowPrintExtras: () => [], flowRufflePrinter: () => null,
    flowQcLine: () => ({ rej: sum(checks, 'rejected'), checked: sum(checks, 'checked'), altOpen: 0, deptOpen: 0 }), flowQcOpen: () => false,
    flowQcWaiting: (r, s) => Math.max(0, s.receivedAll - sum(checks, 'checked')), flowStanding: () => [], flowFgWaiting: x => Math.max(0, x.s.qc - x.s.india), flowBoardOwns: () => false, flowIsBack: () => false, flowIsMto: () => false,
    ordVendorOf: () => null, ordQcOf: () => ({ ok: passed }), ordFgAt: () => null, ordWaitingAt: () => '',
    prOn: () => false, obIsLegacy: () => false, obOrderedQty: () => qty, obCutQty: () => cutQty, obPressQty: () => passed, cutSkuOf: () => ({ cuttingRequired: cuts, color: 'Red', fabric: 'Cotton' }),
    /* the order book's own helpers, and the SHP board's */
    soColName: i => 'C' + i, dToday: () => '2026-11-27', flowRepDay: v => String(v || '').slice(0, 10), flowRepPad: n => String(n).padStart(2, '0'), obWhat: () => ({}), ordCustomName: () => '', obPieces: r => r.qty, obIsShop: () => false, spOf: () => null, ordIsMto: () => false, spNum: num, ordCutReq: () => cuts, ORD_THRESHOLD: () => 100,
    SHPB: { pressBy: {} }, shpbStockOf: () => 0, shpbIsQuilt: () => false, shpbKey: () => 'k', shpbGated: () => false, shpbFlowOf: () => null,
  };
  vm.createContext(ctx);
  vm.runInContext(CODE + '\nthis.__t = { P1, flowState, ordLinesBuild, shpbStages, bdGuard, cutGuard, p1Board, p1History, p1DrawInv, p1WipData, p1WipSheets, p1WipTable,'
    + ' flowRepLines, flowRepSheets, flowRepBody, p1RepTable, FLOW_REP, p1LineStages };', ctx);
  const t = ctx.__t, made = t.ordLinesBuild()[0];
  const row = Object.assign({}, made, { cutReq: cuts, printer: o.printed != null ? 'A printer' : '', printed: o.printed || 0, open: true });
  const s = t.flowState(row);
  ctx.flowRows = () => [{ r: row, s, recent: true }];
  ctx.ordLines = () => [row];
  const board = t.p1Board()[0];
  t.P1.hist = board.gk; t.P1.histOrd = ''; t.P1.shown = true; t.P1.tab = ''; t.P1.inv = board.gk;
  const card = t.p1History(board); t.P1.hist = '';
  t.p1DrawInv();
  const rep = t.flowRepLines({ from: '2026-11-01', to: '2026-11-30', on: 'planned', today: '2026-11-27' })[0];
  return { t, ctx, row, s, made, board, card, page: home.innerHTML, rep, wl: board.wl[0], stg: board.ln[0].st,
    /** the largest quantity the cutting / issue form accepts */
    mayCut: () => most(n => t.cutGuard(NO, SKU, n)), mayIssue: () => most(n => t.bdGuard(NO, SKU, n)), shp: () => t.shpbStages([row]) };
}
function most(refusal) { let n = 0; while (n < 500 && refusal(n + 1) === '') n++; return n; }
const places = at => Object.entries(at).filter(([, v]) => v).map(([k, v]) => k + ' ' + v).join(', ');
const onCard = (card, n, label) => new RegExp('<b>' + n + '</b><span class="hp-l">' + label).test(card);

/** A Job Work entry of `pcs` pieces, all back, `rej` of them rejected — `why` of those with a reason. */
const job = (pcs, rej, why, id, back) => Object.assign({ id: id || 'j1', issuePieces: pcs, receivedPieces: back == null ? pcs - rej : back, rejectionPieces: rej },
  why ? { rejections: { r1: { at: '2026-11-25T05:00:00Z', pcs: why, why: 'Stain', note: 'oil', by: 'mohit@test' } } } : {});
const qcRow = (good, rejected, withReason) => Object.assign({ id: 'q1', checked: good + rejected, ok: good, rejected, baseId: 'j1' }, withReason ? { rejWhy: 'Print fault' } : {});

console.log('== the karigar rejects 5 of 100 with a reason ==');
{ const a = line({ jobs: [job(100, 5, 5)] });
  ok('PPC line: 5 to cut, none with a karigar, none not started', a.wl.cut === 5 && a.wl.kar === 0 && a.wl.todo === 0 && a.wl.rej === 5 && a.wl.qc === 95, JSON.stringify(a.wl));
  ok('…and it says "5 rejected" on the lot and on its order line', (a.page.match(/>5 rejected</g) || []).length === 2, String((a.page.match(/rejected/g) || []).length));
  ok('…the cut, issue and karigar stages are not done', !a.stg.cut.done && !a.stg.iss.done && !a.stg.kar.done && a.stg.cut.w === 5);
  ok('history card: "5 rejected (scrapped) — 5 to cut again" under the bar', /class="hwarn"><b>5<\/b> rejected \(scrapped\) — 5 to cut again<\/div>/.test(a.card) && a.card.indexOf('hbar') < a.card.indexOf('rejected (scrapped)'));
  ok('…5 to cut, 95 in QC, none with a karigar, nothing "not started"', onCard(a.card, 5, 'To cut') && onCard(a.card, 95, 'In QC') && !/With karigar<\/span><span|>Not started</.test(a.card) && !/Not traced/.test(a.card));
  ok('…the entries list "Rejected at karigar" with the reason, 5 pieces', /Rejected at karigar<\/span><\/td><td class="num"><b>5<\/b>/.test(a.card) && /scrapped · Stain · oil/.test(a.card));
  ok('Report: 5 Rejected, 5 to cut, 0 with karigar, adding up to 100', a.rep.rejected === 5 && places(a.rep.at) === 'toCut 5, recv 95', a.rep.rejected + ' | ' + places(a.rep.at));
  const sheet = a.t.flowRepSheets([a.rep])[0], head = sheet.rows[2].map(c => c.v), at = head.indexOf('Rejected');
  ok('…its Excel has a Rejected column beside Completed, holding 5, every row the same width', head[at - 1] === 'Completed' && sheet.rows[3][at].v === 5 && sheet.rows.every(r => r.length === head.length));
  ok('…so has the page, group headings spanning every column', />Rejected<\/th>/.test(a.t.p1RepTable([a.rep])) && spans(a.t.p1RepTable([a.rep])) === head.length && />Rejected<\/th>/.test((Object.assign(a.t.FLOW_REP, { from: '2026-11-01', to: '2026-11-30', on: 'planned' }), a.t.flowRepBody())), String(spans(a.t.p1RepTable([a.rep]))));
  const table = a.t.p1WipTable([{ lead: ['x'], w: a.wl }], { lead: [['Order', 1]] });
  ok('WIP table: a Rejected column after Not started, not added into In process', /<th>Not started<\/th><th>Rejected<\/th>/.test(table) && (table.match(/<th[ >]/g) || []).length === (table.match(/<td[ >]/g) || []).length && a.wl.inp === 100);
  const xl = a.t.p1WipSheets(a.t.p1WipData()).slice(0, 3);
  ok('WIP Excel: headings and values match, Rejected 5', xl.every(s => s.head.includes('Rejected') && s.rows.every(r => r.length === s.head.length) && s.rows[0][s.head.indexOf('Rejected')] === 5), JSON.stringify(xl.map(s => [s.head.length, s.rows[0].length])));
  ok('Order Console: 5 pending to cut, the cut column still says 100 cut', a.made.pendingCut === 5 && a.made.cut === 100 && a.made.cutPct === 95, JSON.stringify([a.made.pendingCut, a.made.cut, a.made.cutPct]));
  const q = a.shp();
  ok('SHP board: 5 to cut, nothing to issue, nothing to receive — as the forms accept', q.cutW === 5 && q.issW === 0 && q.recW === 0 && a.mayCut() === 5 && a.mayIssue() === 0, JSON.stringify([q.cutW, q.issW, q.recW, a.mayCut(), a.mayIssue()])); }
function spans(html) { return (html.split('</tr>')[0].match(/colspan="\d+"/g) || []).reduce((t, m) => t + +m.match(/\d+/)[0], 0); }

{ const b = line({ cut: 105, jobs: [job(100, 5, 5)] }), q = b.shp();
  ok('once 5 more are cut: 5 "Cut, in store" on PPC and Report, and the SHP board offers the 5 the form accepts', b.wl.raw === 5 && b.wl.cut === 0 && b.rep.at.cutStore === 5 && q.cutW === 0 && q.issW === 5 && b.mayIssue() === 5, JSON.stringify([b.wl.raw, b.rep.at, q.issW, b.mayIssue()]));
  ok('…the card says all replaced', /5<\/b> rejected \(scrapped\) — all replaced/.test(b.card)); }

console.log('== QC rejects 5 with a reason ==');
{ const a = line({ jobs: [job(100, 0, 0)], checks: [qcRow(95, 5, true)] }), q = a.shp();
  ok('PPC line: 5 to cut, none with a karigar', a.wl.cut === 5 && a.wl.kar === 0 && a.wl.todo === 0 && a.wl.rej === 5, JSON.stringify(a.wl));
  ok('history card: the same, and the ledger says "scrapped · Print fault"', /5<\/b> rejected \(scrapped\) — 5 to cut again/.test(a.card) && /scrapped · Print fault/.test(a.card) && !/back to the karigar/.test(a.card));
  ok('Report: 5 Rejected, 5 to cut, 0 with karigar', a.rep.rejected === 5 && a.rep.at.toCut === 5 && a.rep.at.kar === 0 && a.rep.at.recv === 0, places(a.rep.at));
  ok('SHP board: 5 to cut, nothing to issue', q.cutW === 5 && q.issW === 0 && q.recW === 0 && a.mayIssue() === 0, JSON.stringify([q.cutW, q.issW, q.recW])); }
{ const b = line({ cut: 105, jobs: [job(100, 0, 0), job(5, 0, 0, 'j2', 0)], checks: [qcRow(95, 5, true)] }), q = b.shp();
  ok('the replacements with a karigar: 5 with karigar on PPC, Report and the SHP board', b.wl.kar === 5 && b.rep.at.kar === 5 && b.rep.at.recv === 0 && q.recW === 5 && q.issW === 0 && !b.stg.kar.done, JSON.stringify([b.wl.kar, b.rep.at, q.recW])); }

console.log('== printed cloth and no-cut lines ==');
{ const a = line({ printed: 100, store: 0, jobs: [job(100, 5, 5)] });
  ok('no printed cloth: still 5 to cut on PPC and Report, and the card says 5 more to print', a.wl.cut === 5 && a.wl.todo === 0 && a.rep.at.toCut === 5 && a.rep.at.prnStore === 0 && /needs <b>5<\/b> more printed/.test(a.card), JSON.stringify([a.wl.cut, a.rep.at])); }
{ const a = line({ noCut: true, cut: 0, jobs: [job(100, 5, 5)] });
  ok('a no-cut line: the 5 are "Cut, in store" (to issue) on PPC and Report; the card says to issue again', a.wl.raw === 5 && a.wl.cut === 0 && a.wl.todo === 0 && a.rep.at.cutStore === 5 && /5 to issue again/.test(a.card), JSON.stringify([a.wl.raw, a.rep.at])); }

{ const a = line({ noCut: true, cut: 0, printed: 100, store: 0, jobs: [job(100, 5, 5)] });
  ok('…printed on the item with none in store: still 5 to give a karigar, 5 more to print', a.s.canIssue === 0 && a.wl.raw === 5 && a.wl.todo === 0 && a.rep.at.cutStore === 5 && /needs <b>5<\/b> more printed/.test(a.card), JSON.stringify([a.wl.raw, a.wl.todo, a.rep.at])); }
console.log('== a scrapped piece finishes no stage, even with nothing waiting there ==');
{ const empty = { grg: 0, prn: 0, emb: 0, cut: 0, raw: 0, kar: 0, qc: 0, alt: 0, rdy: 0, ship: 0, m: 0 };
  const done = (a, state) => a.t.p1LineStages({ r: a.row, s: Object.assign({}, a.s, state) }, empty);
  const k = line({ jobs: [job(100, 5, 5)] }), cutStage = done(k, { issuedNet: 95 });
  ok('100 cut, 5 of them scrapped: To cut is not ticked', !cutStage.cut.done && !cutStage.iss.done);
  const q = line({ jobs: [job(100, 0, 0)], checks: [qcRow(95, 5, true)] }), back = done(q, {});
  ok('100 received, 5 of them scrapped at QC: With karigar is not ticked', !back.kar.done && !back.iss.done);
  const whole = line({ cut: 105, jobs: [job(100, 5, 5), job(5, 0, 0, 'j2')] }), all = done(whole, {});
  ok('…and ticked once the replacements are in', all.cut.done && all.iss.done && all.kar.done); }
console.log('== without a reason, or switch off: as before ==');
const seen = a => JSON.stringify([a.wl, a.stg, a.rep.at, a.made.pendingCut, a.shp(), a.card, a.page.replace(/Read [^<]*/, ''), a.t.p1WipSheets(a.t.p1WipData()).slice(0, 3), a.t.flowRepSheets([a.rep])[0], a.t.p1RepTable([a.rep])]);
{ const a = line({ jobs: [job(100, 5, 0)] });
  ok('no reason: no Rejected anywhere, nothing to cut again', !/scrapped|Rejected at karigar|class="hwarn"/.test(a.card) && !/>5 rejected</.test(a.page) && a.wl.cut === 0 && a.wl.rej === 0 && a.made.pendingCut === 0 && !a.t.flowRepSheets([a.rep])[0].rows[2].some(c => c.v === 'Rejected') && !a.t.p1WipSheets(a.t.p1WipData())[0].head.includes('Rejected') && !/Rejected/.test(a.t.p1WipTable([{ lead: ['x'], w: a.wl }], { lead: [['Order', 1]] })));
  ok('…the SHP board offers it for issue again, as today', a.shp().issW === 5 && a.shp().cutW === 0); }
{ const off = line({ off: true, jobs: [job(100, 5, 5)] }), none = line({ off: true, jobs: [job(100, 5, 0)] });
  ok('switch off: a reason changes no screen', seen(off) === seen(none));
  ok('…and a QC reason neither', seen(line({ off: true, jobs: [job(100, 0, 0)], checks: [qcRow(95, 5, true)] })) === seen(line({ off: true, jobs: [job(100, 0, 0)], checks: [qcRow(95, 5, false)] }))); }
ok('switch on without a reason reads as switch off', seen(line({ jobs: [job(100, 5, 0)] })) === seen(line({ off: true, jobs: [job(100, 5, 0)] })));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
