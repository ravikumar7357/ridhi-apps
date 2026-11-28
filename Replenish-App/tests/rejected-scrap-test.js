/* REJECTED PIECES ARE SCRAPPED, the counting (Ravi, 27 Nov). A piece the karigar or QC rejects WITH A REASON is gone: a new
 * one is cut, or issued on a line that needs no cutting. A rejection without a reason counts as before; switch lineHold off,
 * every figure is as before. (src/app/core/lookups.js — flowRejOf; core/look-alike-skus.js — cutGuard;
 * production/job-work-entry.js — bdGuard, bdOrdersFor; flow/flow-core.js — flowState; flow/flow-entries.js — flowIssuable.)
 * Cases are made up.
 *   node tests/rejected-scrap-test.js      (SCRAP_APP=<folder like src/app> tests another copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.SCRAP_APP || path.join(__dirname, '..', 'src', 'app');
const src = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
/** From the line that matches to the next closing brace at the margin (or to `end`). */
function cut(file, startRe, end) {
  const s = src(file), i = s.search(startRe);
  if (i < 0) throw new Error(String(startRe) + ' not found in ' + file);
  return s.slice(i, s.indexOf(end || '\n}', i) + (end || '\n}').length);
}
const L = 'core/lookups.js', J = 'production/job-work-entry.js', K = 'core/look-alike-skus.js', F = 'flow/flow-core.js';
const CODE = [cut('core/history.js', /^function lineHoldOn\(/m), cut('core/history.js', /^const REJ_REASONS/m, ';'),
  cut(L, /^let BASE_IX/m, ';'), cut(L, /^function obBaseIndex\(/m), cut(L, /^function obRowScrap\(/m), cut(L, /^const obQcRows/m, '\n'),
  cut(L, /^const obQcScrapOf/m, '\n'), cut(L, /^let QCREJ_IX/m, ';'), cut(L, /^function obQcRejIndex\(/m), cut(L, /^function obQcScrapQty\(/m), cut(L, /^function flowRejOf\(/m),
  cut(K, /^const obCutKept/m, ';'), cut(K, /^function cutGuard\(/m),
  cut(J, /^function obIssueSums\(/m), cut(J, /^function obIssueOfOrder\(/m), cut(J, /^function obIssueOfCut\(/m), cut(J, /^function bdPrintedBackErr\(/m), cut(J, /^function bdCutReq\(/m), cut(J, /^function bdGuard\(/m), cut(J, /^function bdOrdersFor\(/m),
  cut(F, /^function flowCountScrap\(/m), cut(F, /^function flowReplaceCloth\(/m), cut(F, /^function flowStoreClothPcs\(/m), cut(F, /^function flowState\(/m),
  cut('flow/flow-entries.js', /^const flowIssuable/m, ';')].join('\n');

const NO = 'OC-1', SKU = 'MADE-UP';
const up = s => String(s || '').trim().toUpperCase();
/** One order line of 100 and its registers. o: { off, noCut, printed, store, cut, jobs, checks, plan, qty } */
function line(o) {
  o = o || {};
  const qty = o.qty || 100, cutQty = o.cut == null ? 100 : o.cut, cuts = !o.noCut;
  const jobs = o.jobs || [], checks = o.checks || [];
  const sum = (rows, f) => rows.reduce((t, r) => t + (+r[f] || 0), 0);
  const plan = o.plan ? { route: o.plan, fabric: { name: 'Cotton', perPc: 2, metres: 200 } } : null;
  const made = () => sum(checks, 'ok');
  const ctx = {
    console, nf: String, obUC: up, ptNum: v => Number(v) || 0, obKeyOf: (a, b) => up(a) + '|' + up(b), PT_NONE: Object.freeze([]),
    localStorage: { getItem: k => (k === 'lineHold' && !o.off ? '1' : null) },
    PT: { base: jobs.map(j => Object.assign({ orderNo: NO, sku: SKU }, j)), cut: [] }, PTG: { qc: [] }, QC: { checks: checks.map(c => Object.assign({ orderNo: NO, sku: SKU }, c)) },
    prOn: () => false, obIsLegacy: () => false, obOrderedQty: () => qty, obCutQty: () => cutQty, obPressQty: made,
    obLines: () => [{ orderNo: NO, sku: SKU }], cutSkuOf: () => ({ cuttingRequired: cuts, color: 'Red', fabric: 'Cotton' }),
    FLOW: { ppc: plan ? { k: plan } : {}, dem: {}, res: {} }, FLOW_REAL: true, flowKey: () => 'k', ptIsoDate: v => v, flowFrom: () => '9999-01-01', flowOpenNew: () => false,
    flowRouteOf: p => p.route, flowPrinted: r => r === 'inhouse' || r === 'emb', ordVendorOf: () => null, ordQcOf: () => ({ ok: made() }), ordFgAt: () => null, ordWaitingAt: () => '',
    flowChIndex: () => ({}), flowPoIndex: () => ({}), flowR2: n => Math.round(n * 100) / 100, flowInHand: () => false, flowEmbByVendor: () => false,
    flowPrintWhat: () => ({ kind: cuts ? 'fabric' : 'sku', code: 'X' }), flowToPrint: () => ({ pcs: qty, metres: 200 }), flowRemFrac: () => 1, flowPrintsSomething: () => true,
    flowPrintedStock: () => (o.store === undefined ? 0 : o.store),
    flowQcLine: () => ({ rej: sum(checks, 'rejected') }), flowQcOpen: () => !!o.qcOpen, flowFabOwed: () => ({ left: 0 }), flowPrintExtras: () => [], flowRufflePrinter: () => null,
    flowBoardOwns: () => false, flowIsBack: () => false, flowIsMto: () => false,
  };
  vm.createContext(ctx);
  vm.runInContext(CODE + '\nthis.REASONS = REJ_REASONS; this.flowIssuable = flowIssuable;', ctx);
  const row = { orderNo: NO, sku: SKU, qty, orderDate: '2026-11-27', cutReq: cuts, cut: cutQty, issued: sum(jobs, 'issuePieces'), received: sum(jobs, 'receivedPieces'),
    pressed: made(), printer: o.printed == null ? '' : 'A printer', printed: o.printed || 0, open: true };
  const state = () => ctx.flowState(row);
  return { ctx, row, state,
    /** the largest quantity the cutting / issue form accepts */
    mayCut: () => most(n => ctx.cutGuard(NO, SKU, n)), mayIssue: excl => most(n => ctx.bdGuard(NO, SKU, n, excl)),
    figures: () => { const s = state(); return JSON.stringify([most(n => ctx.cutGuard(NO, SKU, n)), most(n => ctx.bdGuard(NO, SKU, n)), s.bucket, s.cut, s.issuedNet, s.canCut, s.canIssue, ctx.flowIssuable(row, s)]); } };
}
function most(refusal) { let n = 0; while (n < 500 && refusal(n + 1) === '') n++; return n; }

/** A Job Work entry of `pcs` pieces, all back, `rej` of them rejected — `why` of those with a reason. */
const job = (pcs, rej, why, id) => Object.assign({ id: id || 'j1', issuePieces: pcs, receivedPieces: pcs - rej, rejectionPieces: rej },
  why ? { rejections: { r1: { at: '2026-11-27T05:00:00Z', pcs: why, why: 'Stain', by: 'x@test' } } } : {});
const qcRow = (good, rejected, withReason, baseId) => Object.assign({ checked: good + rejected, ok: good, rejected, baseId: baseId || 'j1' }, withReason ? { rejWhy: 'Print fault' } : {});

console.log('== the reasons ==');
{ const r = line().ctx.REASONS;
  ok('the seven reasons, "Other" last', r.length === 7 && r[0] === 'Stitching fault' && r[6] === 'Other', r.join()); }

console.log('== a karigar rejects 5 of 100 with a reason ==');
{ const a = line({ jobs: [job(100, 5, 5)] }), s = a.state();
  ok('cutting allows 5 and refuses 6', a.mayCut() === 5, String(a.mayCut()));
  ok('…and says the scrapped pieces are not counted', /already cut 95 pcs \(scrapped pieces not counted\)/.test(a.ctx.cutGuard(NO, SKU, 6)), a.ctx.cutGuard(NO, SKU, 6));
  ok('issue refused until the new pieces are cut', a.mayIssue() === 0 && /Cut more pieces first/.test(a.ctx.bdGuard(NO, SKU, 1)), a.ctx.bdGuard(NO, SKU, 1));
  ok('the line is back in Cutting with 5 to cut, nothing to issue', s.bucket === 'cut' && s.canCut === 5 && s.canIssue === 0 && a.ctx.flowIssuable(a.row, s) === 0, JSON.stringify(s));
  ok('95 well cut, 95 issued, 5 scrapped by the karigar', s.cutGood === 95 && s.issuedNet === 95 && s.rej.kar === 5 && s.rej.qc === 0 && s.rej.scrap === 5);
  const o = a.ctx.bdOrdersFor(SKU)[0];
  ok('Job Work offers the order with room 5 but nothing cut', o.byOrder === 5 && o.byCut === 0 && o.left === 0 && o.cutUsed === 100, JSON.stringify(o)); }
{ const b = line({ cut: 105, jobs: [job(100, 5, 5)] }), s = b.state();
  ok('once 5 more are cut: nothing more to cut, exactly 5 to issue on both screens', b.mayCut() === 0 && b.mayIssue() === 5 && s.canIssue === 5 && b.ctx.flowIssuable(b.row, s) === 5 && s.bucket === 'raw', b.figures()); }
{ const c = line({ cut: 105, jobs: [job(100, 5, 5), job(5, 0, 0, 'j2')] });
  ok('the replacements issued: nothing left to cut or issue', c.mayCut() === 0 && c.mayIssue() === 0 && c.state().canIssue === 0 && c.state().canCut === 0, c.figures());
  ok('correcting the second entry: it may still be 5, not 6', c.mayIssue('j2') === 5, String(c.mayIssue('j2'))); }

console.log('== QC rejects 5 with a reason ==');
{ const a = line({ jobs: [job(100, 0, 0)], checks: [qcRow(95, 5, true)] }), s = a.state();
  ok('cutting allows 5 and refuses 6', a.mayCut() === 5, String(a.mayCut()));
  ok('issue refused until the new pieces are cut', a.mayIssue() === 0 && s.canIssue === 0, a.figures());
  ok('the line is back in Cutting', s.bucket === 'cut' && s.canCut === 5 && s.rej.qc === 5 && s.issuedNet === 95, JSON.stringify(s)); }
{ const b = line({ cut: 105, jobs: [job(100, 0, 0)], checks: [qcRow(95, 5, true)] });
  ok('after the new cut, 5 may be issued', b.mayIssue() === 5 && b.state().canIssue === 5, b.figures()); }
{ const c = line({ cut: 110, jobs: [job(50, 0, 0), job(50, 0, 0, 'j2')], checks: [qcRow(45, 5, true, 'j2')] });
  ok('correcting an entry leaves out what QC scrapped from that entry', c.ctx.obIssueOfOrder(NO, SKU, 'j2') === 50 && c.ctx.obIssueOfOrder(NO, SKU, 'j1') === 45,
    c.ctx.obIssueOfOrder(NO, SKU, 'j2') + ' ' + c.ctx.obIssueOfOrder(NO, SKU, 'j1')); }

console.log('== a line PPC planned straight to Job Work ==');
{ const a = line({ cut: 0 });
  a.ctx.flowPlanRouteOf = () => 'jobwork';
  const o = a.ctx.bdOrdersFor(SKU)[0];
  ok('nothing cut: the form offers all 100, the same as Save accepts', o.left === 100 && o.byCut === o.byOrder && a.mayIssue() === 100 && a.ctx.bdCutReq(NO, SKU) === false, JSON.stringify(o) + ' ' + a.mayIssue()); }
{ const b = line({ cut: 0 }), o = b.ctx.bdOrdersFor(SKU)[0];
  ok('any other route, nothing cut: held by cutting on both', o.left === 0 && o.byCut === 0 && b.mayIssue() === 0, JSON.stringify(o)); }

console.log('== rejections without a reason count as before ==');
const same = (name, o) => { const on = line(o).figures(), off = line(Object.assign({ off: true }, o)).figures(); ok(name, on === off, on + ' vs ' + off); };
same('karigar rejection without a reason', { jobs: [job(100, 5, 0)] });
same('QC rejection without a reason', { jobs: [job(100, 0, 0)], checks: [qcRow(95, 5, false)] });
same('QC rejection without a reason, planned line', { plan: 'stitch', jobs: [job(100, 0, 0)], checks: [qcRow(95, 5, false)] });
same('no rejection at all, over-cut line', { plan: 'stitch', cut: 110, jobs: [job(60, 0, 0)] });
{ const a = line({ jobs: [job(100, 5, 0)] });
  ok('…the karigar one is issued again without a new cut, as today', a.mayCut() === 0 && a.mayIssue() === 5, a.figures()); }
{ const m = line({ plan: 'stitch', jobs: [job(100, 8, 5)], checks: [qcRow(89, 3, false)] }), s = m.state();
  ok('mixed line: only the 5 with a reason are cut again; QC\'s 3 without one go back to the store', m.mayCut() === 5 && s.canCut === 5 && s.canIssue === 3 && s.issuedNet === 92, m.figures()); }
{ const x = line({ jobs: [job(100, 3, 10)] });
  ok('scrap is never more than the entry\'s rejected total', x.ctx.flowRejOf(NO, SKU).scrap === 3 && x.ctx.flowRejOf(NO, SKU).karOld === 0); }
{ const n = line({ jobs: [Object.assign(job(100, 5, 0), { rejections: { r1: { pcs: 5, why: '' } } })] });
  ok('an entry with an empty reason is not scrap', n.ctx.flowRejOf(NO, SKU).scrap === 0 && n.ctx.flowRejOf(NO, SKU).karOld === 5); }

console.log('== a line that needs no cutting ==');
{ const a = line({ noCut: true, cut: 0, jobs: [job(100, 5, 5)] }), s = a.state();
  ok('only the issue opens again: 5, not 6', a.mayIssue() === 5 && s.canIssue === 5 && s.canCut === 0 && s.bucket === 'raw' && a.ctx.flowIssuable(a.row, s) === 5, a.figures()); }
{ const b = line({ noCut: true, cut: 0, plan: 'jobwork', jobs: [job(100, 0, 0)], checks: [qcRow(95, 5, true)] });
  ok('…the same after a QC rejection', b.mayIssue() === 5 && b.state().canIssue === 5, b.figures()); }
{ const c = line({ noCut: true, cut: 0, jobs: [job(100, 5, 5), job(5, 0, 0, 'j2')] });
  ok('…and closes once the replacements are issued', c.mayIssue() === 0 && c.state().canIssue === 0, c.figures()); }

console.log('== printed lines need printed cloth for the new piece ==');
const printed = o => line(Object.assign({ plan: 'inhouse', printed: 100, jobs: [job(100, 5, 5)] }, o));
{ const s = printed({ store: 0 }).state();
  ok('none in store: nothing to cut, 5 pieces short of printed cloth', s.canCut === 0 && s.needReprint === 5 && s.bucket === 'cut', JSON.stringify(s)); }
{ const s = printed({ store: 6 }).state();   // 6 m at 2 m a piece
  ok('cloth for 3 in store: 3 to cut, 2 short', s.canCut === 3 && s.needReprint === 2, JSON.stringify(s)); }
{ const s = printed({ store: 100 }).state();
  ok('enough in store: 5 to cut, none short', s.canCut === 5 && !s.needReprint, JSON.stringify(s)); }
{ const s = printed({ store: null }).state();
  ok('store not read: not held back, nothing flagged', s.canCut === 5 && !s.needReprint, JSON.stringify(s)); }
{ const s = printed({ noCut: true, cut: 0, store: 2 }).state();   // printed on the piece itself: the store counts pieces
  ok('printed on the item: 2 in store → 2 to issue, 3 short', s.canIssue === 2 && s.needReprint === 3, JSON.stringify(s)); }

console.log('== switch off ==');
{ const a = line({ off: true, jobs: [job(100, 5, 5)] }), s = a.state();
  ok('a reason changes nothing: as the same rejection without one', a.figures() === line({ off: true, jobs: [job(100, 5, 0)] }).figures(), a.figures());
  ok('…no new cut, the piece is issued again, no scrap figures', a.mayCut() === 0 && a.mayIssue() === 5 && s.rej === undefined && s.cutGood === undefined && s.needReprint === undefined); }
same('(on and off agree when nothing has a reason, no-cut line)', { noCut: true, cut: 0, jobs: [job(100, 5, 0)] });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
