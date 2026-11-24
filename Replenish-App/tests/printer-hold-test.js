/* The printer's hold (Vishesh, 23 Nov): a NEW plan's Vendor Order line is not shown to the printer until its RFD challan is made.
 * Covers flow/flow-printorder.js (flowHoldOn, flowVoLines, flowVoSync, flowVoRelease), flow/flow-vendor.js (flowVpAfterLoad),
 * the new access right flprn, the bell item in core/friendly.js and the Greige Desk pill.
 *   node tests/printer-hold-test.js      (SRC_DIR=<dir> to test another copy of src/app — used to prove the tests have teeth) */
const fs = require('fs'), path = require('path');
const APP = process.env.SRC_DIR || path.join(__dirname, '..', 'src', 'app');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

const FLOW_SRC = read('flow/flow-printorder.js') + '\n' + read('flow/flow-vendor.js');
const K1 = 'AMZ-1__S1', K2 = 'AMZ-1__S2';
const item = (sku, code, metres) => ({ sku, pcs: 5, metres, unit: 'm', print: { kind: 'fabric', code, label: 'Rb · Red · Hand' } });

/** The flow code with its outside helpers faked: ls = localStorage, ch = the RFD challan index, vo = Vendor Orders read. */
function load(opts) {
  opts = opts || {};
  const ls = Object.assign({}, opts.ls || {});
  const ctx = {
    FLOW: { po: {}, ppc: {}, ch: {} }, FLOW_ON: true, FLOW_COMPANY: 'Ridhi', VO: { rows: opts.vo || [] }, VP: opts.vp || {}, ME: Object.assign({ email: 'ppc@x', admin: false }, opts.me || {}),
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
    flowChIndex: () => opts.ch || {}, flowRows: () => [], flowR2: n => Math.round((+n || 0) * 100) / 100, obUC: s => String(s == null ? '' : s).trim().toUpperCase(),
    fabKey: v => String(v || '').trim().toUpperCase(), cutSkuOf: () => ({ brand: 'B', color: 'Red', fabric: 'Cotton' }), ptImgOf: () => '', voFabricCatalogue: () => new Map(),
    voLines: o => (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {})).filter(Boolean),
    voNewOrderNo: (() => { let n = 0; return () => 'VPO-T' + (++n); })(), voTodayDMY: () => '23/11/2026',
    ptList: x => x || [], ptGet: async () => opts.branch || null, flowTestsOn: () => false, flowMay: () => false, nf: v => String(v), $: () => null,
  };
  const api = new Function(...Object.keys(ctx), FLOW_SRC + '\n;return { flowHoldOn, flowVoLines, flowVoSync, flowVoRelease, flowVpAfterLoad, flowVpHoldApply, flowHoldSaveFlag, VO:()=>VO, VP:()=>VP, setAs:v=>{FLOW_VP_AS=v}, ls:()=>ls };')(...Object.values(ctx));
  return api;
}
const printOrder = items => ({ no: 'PRN-1', orderNo: 'AMZ-1', printer: { code: 'P1', name: 'Sanganer Prints' }, items: Object.fromEntries(items.map(([k, it]) => [k, it])) });
const planOf = () => ({ dates: { cut: '2026-12-01' }, fabric: { name: 'Cotton' }, print: { dir: 'Hand' } });
/** Run a sync of one print order and return { patch, order } for the Vendor Order it placed. */
function sync(A, po, nos) { const local = { [po.no]: po }, patch = {}; const r = A.flowVoSync(local, nos || [po.no], patch, planOf); return { patch, placed: r.placed, local }; }
const runningLines = res => (res.placed.find(o => o.orderType === 'running') || { lines: [] }).lines;

console.log('The switch');
{
  ok('missing flag = off', load().flowHoldOn() === false);
  ok('last answer 1 = on', load({ ls: { printerHoldLast: '1' } }).flowHoldOn() === true);
  ok('device override 0 beats the flag', load({ ls: { printerHoldLast: '1', printerHold: '0' } }).flowHoldOn() === false);
  ok('device override 1 turns it on', load({ ls: { printerHold: '1' } }).flowHoldOn() === true);
  const A = load(); A.flowHoldSaveFlag(true); ok('saving the flag keeps it for the next load', A.flowHoldOn() === true);
  A.flowHoldSaveFlag(false); ok('saving off clears it', A.flowHoldOn() === false);
}

console.log('Placing a plan');
{
  const po = printOrder([[K1, item('S1', 'RB1-H', 10)]]);
  const off = sync(load(), po);
  ok('switch off: nothing is held', runningLines(off).length === 1 && !runningLines(off)[0].awaitRfd);
  const on = sync(load({ ls: { printerHold: '1' } }), po);
  ok('switch on: a new plan\'s line is held', runningLines(on).length === 1 && runningLines(on)[0].awaitRfd === true);
  const withCh = sync(load({ ls: { printerHold: '1' }, ch: { [K1]: { no: 'RFD-1' } } }), po);
  ok('switch on, but the line already has a challan: visible', !runningLines(withCh)[0].awaitRfd);
}

console.log('Orders already placed');
{
  const A = load({ ls: { printerHold: '1' } });
  const po = printOrder([[K1, item('S1', 'RB1-H', 10)]]);
  const old = { id: 'vpo1', orderNo: 'VPO-1', vendorCode: 'P1', orderType: 'running', status: 'Placed', lines: [{ lineId: 'ln_old', sku: 'RB1-H', flowPart: K1 + '|body', meters: 10 }] };
  A.VO().rows = [old]; po.vo = { running: { code: 'P1', id: 'vpo1', orderNo: 'VPO-1' } };
  const res = sync(A, po);
  ok('a line already on the Vendor Order without the flag stays visible after a re-plan', !runningLines(res)[0].awaitRfd);
  const held = Object.assign({}, old, { lines: [Object.assign({}, old.lines[0], { awaitRfd: true })] });
  A.VO().rows = [held];
  ok('a line still held stays held after a re-plan (no challan yet)', runningLines(sync(A, po))[0].awaitRfd === true);
  const po2 = printOrder([[K1, item('S1', 'RB1-H', 10)], [K2, item('S1', 'RB1-H', 6)]]); po2.vo = po.vo;
  A.VO().rows = [old];
  const two = runningLines(sync(A, po2));
  ok('visible old part and held new part of the SAME fabric are not merged', two.length === 2 && two.filter(l => l.awaitRfd).length === 1, JSON.stringify(two.map(l => [l.flowPart, l.awaitRfd])));
  ok('the held line carries only the new part', (two.find(l => l.awaitRfd) || {}).flowPart === K2 + '|body');
  const noMerge = load({ ls: { printerHold: '1' } }).flowVoLines(po2, planOf, new Map([[K1 + '|body', false]]));
  ok('flowVoLines: known visible + new held = two lines', noMerge.running.length === 2);
}

async function portalTests() {
console.log('The printer\'s portal');
  const rows = () => [
    { id: 'a', orderNo: 'VPO-A', vendorCode: 'P1', lines: [{ lineId: '1', flowPart: K1 + '|body', awaitRfd: true, notes: 'n1' }, { lineId: '2', flowPart: K2 + '|body', notes: 'n2' }] },
    { id: 'b', orderNo: 'VPO-B', vendorCode: 'P1', lines: [{ lineId: '3', flowPart: 'X|body', awaitRfd: true }] },
    { id: 'c', orderNo: 'VPO-C', vendorCode: 'P1', lines: [{ lineId: '4', flowPart: 'Y|body' }] },
  ];
  const printer = load({ vp: { code: 'P1', name: 'Sanganer', rows: rows() } });
  await printer.flowVpAfterLoad();
  {
    const P = printer.VP().rows;
    ok('printer sign-in: held line hidden', P.find(o => o.id === 'a').lines.length === 1 && P.find(o => o.id === 'a').lines[0].lineId === '2');
    ok('printer sign-in: order with every line held is gone', !P.some(o => o.id === 'b'));
    ok('printer sign-in: old order untouched', P.find(o => o.id === 'c').lines.length === 1);
    const admin = load({ me: { admin: true }, vp: { code: 'P1', name: 'Sanganer', rows: [] }, branch: rows() });
    admin.setAs({ code: 'P1', name: 'Sanganer' });
    await admin.flowVpAfterLoad();
    const V = admin.VP().rows, a = V.find(o => o.id === 'a');
    ok('View as printer: held lines still shown', a.lines.length === 2 && V.some(o => o.id === 'b'));
    ok('View as printer: held line marked waiting for RFD challan', /Waiting for RFD challan/.test(a.lines[0].notes) && !/Waiting/.test(a.lines[1].notes));
  }
}

function afterPortal() {
console.log('Releasing the hold');
{
  const A = load({ ls: { printerHold: '1' } });
  A.VO().rows = [{ id: 'a', orderNo: 'VPO-A', vendorCode: 'P1', lines: [{ lineId: '1', flowPart: K1 + '|body', awaitRfd: true }, { lineId: '2', flowPart: K2 + '|body', awaitRfd: true }] }];
  const patch = {}, n = A.flowVoRelease([K1], patch);
  ok('challaned line: awaitRfd=null written at its own path', patch['pt_vendorOrders/P1/a/lines/0/awaitRfd'] === null && 'pt_vendorOrders/P1/a/lines/0/awaitRfd' in patch);
  ok('line without a challan: nothing written', !('pt_vendorOrders/P1/a/lines/1/awaitRfd' in patch) && Object.keys(patch).length === 1 && n === 1);
  ok('the order itself is never rewritten', !Object.keys(patch).some(k => k === 'pt_vendorOrders/P1/a'));
  ok('VO.rows shows the line open now, the other still held', !A.VO().rows[0].lines[0].awaitRfd && A.VO().rows[0].lines[1].awaitRfd === true);
  const merged = load({ ch: { [K1]: { no: 'R1' } } }); merged.VO().rows = [{ id: 'm', vendorCode: 'P1', lines: [{ flowPart: [K1 + '|body', K2 + '|body'].join('+'), awaitRfd: true }] }];
  const p2 = {}; merged.flowVoRelease([], p2);
  ok('a merged line is released only when ALL its parts have a challan', Object.keys(p2).length === 0);
  merged.flowVoRelease([K2], p2);
  ok('...and is released once the last part is challaned', p2['pt_vendorOrders/P1/m/lines/0/awaitRfd'] === null);
}

console.log('Access right');
{
  const design = read('core/access-design.js');
  ok('access list has flprn in Production flow', /name: 'Production flow'[^\n]*\['flprn', 'Approve a change of printer on an RFD challan'\]/.test(design));
  ok('flprn is a factory right (host, sign-in, setup, friendly names)', /'flprn'/.test(read('core/access-host.js')) && /'flprn'/.test(read('core/auth.js')) && /'flprn'/.test(read('core/setup.js')) && /flprn:/.test(read('core/friendly.js')));
  ok('the switch is read from config/flags.printerHold at sign-in', /d\.printerHold === true/.test(read('core/auth.js')) && /flowHoldSaveFlag\(false\)/.test(read('core/auth.js')));
}

console.log('Bell: My work today');
{
  const FR_SRC = read('core/friendly.js');
  const cut = FR_SRC.slice(FR_SRC.indexOf('function frPrnWaiting'), FR_SRC.indexOf('/** Every card'));
  const cards = FR_SRC.slice(FR_SRC.indexOf('function frCards'), FR_SRC.indexOf('/** What the page needs'));
  const mk = (may, dem, flowDem) => new Function('flowPrnMay', 'FR', 'FLOW', 'flowPrnWaiting', 'frMay', 'frTry', 'frNum', 'frQ', 'frWhen', 'showTab', 'GD', 'flowPrnApprove', 'flowEnsureData', 'ME',
    cut + '\n' + cards + '\n;return frCards;')(may === null ? undefined : () => may, { dem, fg: [] }, { dem: flowDem || null }, undefined, () => false, (f, d) => { try { return f(); } catch (e) { return d; } }, v => Number(v) || 0, s => s, () => {}, () => {}, {}, async () => '', async () => {}, { admin: false, tabs: [] });
  const dem = { K1: { printerMove: { status: 'waiting', orderNo: 'AMZ-1', sku: 'S1', from: { name: 'Sanganer' }, to: { name: 'Choudhary' }, pcs: 40, by: 'a@x' } }, K2: { printerMove: { status: 'done' } }, K3: {} };
  const C = mk(true, dem)();
  ok('approver: one item per waiting request', C.length === 1 && C[0].title === 'Printer change · AMZ-1 · S1: Sanganer → Choudhary · 40 pcs', JSON.stringify(C.map(c => c.title)));
  ok('the item has Approve and Open', C[0].act.label === 'Approve' && typeof C[0].act.run === 'function' && typeof C[0].open === 'function');
  ok('non-approver: no item', mk(false, dem)().length === 0);
  ok('no flowPrnMay at all: no item', mk(null, dem)().length === 0);
  const frLoad = FR_SRC.slice(FR_SRC.indexOf('async function frLoad'), FR_SRC.indexOf('/* ---------- approving'));
  ok('non-approvers cause no extra read; approvers read pt_flowDemand once, only when the flow is not loaded',
    /flowPrnMay\(\) && !FLOW\.dem && \(force \|\| !FR\.dem\)\) jobs\.push\(\(\) => ptGet\('pt_flowDemand'\)/.test(frLoad));
}
console.log('Greige Desk pill');
{
  const gd = read('flow/greige-desk.js'), fn = gd.slice(gd.indexOf('function gdPrnWaitingPill'), gd.indexOf('function invDetail'));
  const pill = (w) => new Function('flowPrnWaiting', fn + '\n;return gdPrnWaitingPill;')(w);
  ok('pill shows the count beside Send to printer', /3 waiting approval/.test(pill(() => [1, 2, 3])('Cotton')));
  ok('no pill when none wait, or when the list is not there', pill(() => [])('Cotton') === '' && pill(undefined)('Cotton') === '');
  ok('the pill sits right after the Send to printer button', /Send to printer<\/button>' \+ gdPrnWaitingPill\(r\.fabric\)/.test(gd));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}
portalTests().then(afterPortal);
