/* PRINTER RECEIVE, REBUILT (Ravi, 16 Nov — the mockup he approved).
 *   node tests/printer-receive-test.js        (VP_SRC=<file> / FR_SRC=<file> run another copy of either file; teeth)
 * The real functions are cut out of src/ and run against stubs: vendor-portal.js (the sent / waiting / approved helpers, vpVsAdd,
 * vpLineIsHist, vpCustStatus, vpCustKpis) and flow-receive.js (flowDueRecvCell, flowDueRecvOne, flowExtraAsks, flowExtraAnswer).
 * What must hold:
 *  - the printer may send up to what is ordered; anything more is its own batch that waits for approval and does not count;
 *  - an approved extra counts and grows the order; a rejected one never counts;
 *  - a line is History once received in full, recorded in full and nothing waits; a bulk order never goes there;
 *  - the receiving sheet has one Receive button per line with the printer's figure and "other amount?"; a line the printer entered
 *    nothing for can still be received (Ravi, 16 Nov 5 pm / 17 Nov: not mandatory) — a box, up to what is still to come;
 *  - only an admin approves, and the answer is written on the batch itself. */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const VP = rd(process.env.VP_SRC || path.join(APP, 'vendors/portal/vendor-portal.js')), VO = rd(path.join(APP, 'vendors/orders/vendor-orders.js'));
const FR = rd(process.env.FR_SRC || path.join(APP, 'flow/flow-receive.js'));
const cut = (src, name) => { let i = src.indexOf('async function ' + name + '('); if (i < 0) i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return src.slice(i, src.indexOf('\n}', i) + 2); };
const line = (src, head) => { const i = src.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return src.slice(i, src.indexOf('\n', i)) + '\n'; };
const vsBlock = s => { const i = s.indexOf('const vpVsRound ='); return s.slice(i, s.indexOf('\n/** Only the printer', i) + 1); };
const PARTS = [line(VO, 'const voLines ='), line(VO, 'const voParts ='), line(VP, 'const vpQty ='), vsBlock(VP),
  line(VP, 'const vpVsKey ='), (s => { const i = s.indexOf('const vpVsAll ='); return s.slice(i, s.indexOf(';\n', i) + 2); })(VP), cut(VP, 'vpVsOf'),
  line(VP, 'const vpRecvAll ='), (s => { const i = s.indexOf('const vpLineIsHist ='); return s.slice(i, s.indexOf('\n', i) + 1); })(VP),
  cut(VP, 'vpVsAdd'), line(VP, 'const vpVsSplit ='), cut(VP, 'vpCustStatus'), cut(VP, 'vpCustKpis'),
  line(FR, 'const flowQtyTxt ='), line(FR, 'let FLOW_VOIX ='), cut(FR, 'flowVoIndex'), cut(FR, 'flowVsOfKey'), line(FR, 'const flowDueTyped ='),
  cut(FR, 'flowDueRecvCell'), cut(FR, 'flowDueRecvOne'), cut(FR, 'flowExtraAsks'), cut(FR, 'flowExtraAnswer'),
  line(FR, 'const flowDueDay ='), line(FR, 'const flowRemDays ='), line(FR, 'const FLOW_REM_SOON ='), cut(FR, 'flowRemOf'), cut(FR, 'flowDueTone'),
  cut(FR, 'flowDuePrinters'), cut(FR, 'flowDueBar')].join('\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

function load(o) {
  o = o || {};
  const puts = [], saves = [], said = [];
  const ctx = {
    ME: Object.assign({ email: 'rbp@x', admin: false }, o.me || {}), VP: Object.assign({ code: 'P1', rows: o.rows || [] }, o.vp || {}),
    VO: { rows: o.vo || [] }, FLOW: { po: o.po || {}, said: '' }, FLOW_DUE: { less: o.less || '', typed: {}, printer: '', lateOnly: !!o.lateOnly }, FLOW_RUF: '~ruffle',
    esc: s => String(s == null ? '' : s), nf: n => String(n), obUC: s => String(s || '').toUpperCase(), fabKey: s => String(s || '').toLowerCase(),
    flowR2: n => Math.round((+n || 0) * 100) / 100, vpVsWhen: () => 'today', vpIsCustom: x => !!(x && x.custom),
    vpRecvOf: (l, x) => ({ qty: +((x && x.recv && x.recv[l.lineId]) || 0) }), renderVp() {}, vpSay: (id, m, bad) => said.push({ m, bad }),
    ptPut: async (p, v) => { if (o.putFails) throw new Error('offline'); puts.push([p, v]); },
    document: { querySelector: () => o.box || null },
    vpVsCan: () => true, flowVsRuleOn: () => true, flowVsPending: o.pending || (() => ({ vs: 0, pending: 0, blocked: true })),
    flowDueRows: () => o.due || [], dToday: () => '2026-11-16',
    flowDueRecvSave: async (pk, got, opt) => { saves.push({ pk, got, opt }); flowDueRecvSaveSaid(); return o.saveErr || ''; },
  };
  function flowDueRecvSaveSaid() { ctx.flowDueRecvSave.said = 'Received from RBP-Bagru on RFD-1.'; }
  const names = Object.keys(ctx);
  const A = new Function(...names, PARTS + '\nreturn { vpVsSum, vpVsWait, vpVsApproved, vpOrdOf, vpVsSplit, vpVsAdd, vpLineIsHist, vpCustStatus, vpCustKpis, flowDueRecvCell, flowDueRecvOne, flowExtraAsks, flowExtraAnswer, flowDueTone, flowDueBar };')(...names.map(k => ctx[k]));
  return Object.assign(A, { puts, saves, said, ctx });
}

const b = (lineId, qty, more) => Object.assign({ lineId, sku: 'X', qty, unit: 'pcs', at: '2026-11-16T10:00:00Z' }, more || {});
const L = { lineId: 'a', sku: 'X', qty: 4 };

/* ---- what counts as sent ---- */
{
  const A = load();
  const list = [b('a', 3), b('a', 2, { ask: true }), b('a', 1, { ask: true, approved: { at: 't' } }), b('a', 5, { ask: true, rejected: { at: 't' } }), b('a', 9, { removed: { at: 't' } })];
  ok('sent counts the plain batches and an approved extra (3 + 1), not a waiting, rejected or struck-off one', A.vpVsSum(list) === 4, A.vpVsSum(list));
  ok('…waiting approval is the 2 nobody has answered', A.vpVsWait(list) === 2);
  const o = { orderType: 'cut', lines: [L], vSent: { k1: b('a', 1, { ask: true, approved: { at: 't' } }) } };
  ok('an approved extra grows the order (4 → 5)', A.vpOrdOf(o, L) === 5, A.vpOrdOf(o, L));
  ok('typed 6 with 4 open: 4 count now, 2 wait', JSON.stringify(A.vpVsSplit(6, 4)) === '{"counts":4,"extra":2}');
  ok('typed 2 with nothing open: all 2 wait', JSON.stringify(A.vpVsSplit(2, 0)) === '{"counts":0,"extra":2}');
}
/* ---- the printer presses Send ---- */
(async () => {
  {
    const o = { id: 'o1', orderType: 'cut', lines: [L], vSent: {} };
    const A = load({ rows: [o], box: { value: '6', disabled: false } });
    A.ctx.ME.email = 'rbp@x';
    await A.vpVsAdd('o1', 0);
    ok('Send 6 on 4 ordered writes two batches on the printer\'s own order', A.puts.length === 2 && A.puts.every(([p]) => p.startsWith('pt_vendorOrders/P1/o1/vSent/')), JSON.stringify(A.puts));
    ok('…4 count, 2 marked to wait for approval', A.puts[0][1].qty === 4 && !A.puts[0][1].ask && A.puts[1][1].qty === 2 && A.puts[1][1].ask === true);
    ok('…and the printer is told the 2 went for approval', /2 pcs more than the order — sent to Ridhi for approval/.test(A.said[0].m), A.said[0] && A.said[0].m);
  }
  {
    const o = { id: 'o1', orderType: 'cut', lines: [L], vSent: {} };
    const A = load({ rows: [o], box: { value: '0' } });
    await A.vpVsAdd('o1', 0);
    ok('Send with nothing typed saves nothing and says so', !A.puts.length && A.said[0].bad);
  }
  {
    const o = { id: 'o1', orderType: 'cut', lines: [L], vSent: {} };
    const A = load({ rows: [o], box: { value: '3' }, putFails: true });
    await A.vpVsAdd('o1', 0);
    ok('a failed save says so in red and keeps nothing', A.said[0].bad && /Could not save/.test(A.said[0].m) && !Object.keys(o.vSent).length);
  }

  /* ---- History ---- */
  {
    const A = load();
    const full = { custom: true, orderType: 'cut', lines: [L], vSent: { k: b('a', 4) }, recv: { a: 4 } };
    ok('received in full and recorded in full: History', A.vpLineIsHist(full, L));
    ok('…received in full but the printer has not recorded it: stays, with its Send box', !A.vpLineIsHist({ ...full, vSent: {} }, L));
    ok('…an extra still waiting: stays', !A.vpLineIsHist({ ...full, vSent: { k: b('a', 4), w: b('a', 1, { ask: true }) } }, L));
    ok('…part received: stays', !A.vpLineIsHist({ ...full, recv: { a: 3 } }, L));
    ok('…a bulk order never goes to History', !A.vpLineIsHist({ ...full, custom: false }, L));
    const st = A.vpCustStatus({ orderType: 'cut', lines: [L], vSent: { k: b('a', 3), w: b('a', 2, { ask: true }) }, recv: { a: 1 } }, L);
    ok('status says it in words: waiting approval and on the way', /\+2 pcs waiting Ridhi's approval/.test(st) && /2 pcs on the way/.test(st), st);
    const k = A.vpCustKpis([{ orderType: 'cut', lines: [L], vSent: { k: b('a', 3), w: b('a', 2, { ask: true }) }, recv: { a: 1 } }], [full], false);
    ok('the strip: Sent 3, Received 1, Waiting approval 2, History (1)', /Sent <b[^>]*>3 pcs/.test(k) && /Received <b[^>]*>1 pcs/.test(k) && /Waiting approval <b[^>]*>2 pcs/.test(k) && /History \(1\)/.test(k), k);
    ok('…in History the button takes you back', /Back to my orders/.test(A.vpCustKpis([], [], true)));
  }

  /* ---- the receiving sheet ---- */
  {
    const x = { l: { key: 'O1__X' }, unit: 'pcs', po: 'PO1', left: 4, orderNo: 'SHP-1', sku: 'X', code: 'P1', printer: 'RBP-Bagru' };
    const blocked = load().flowDueRecvCell(x, 'P1|O1__X');
    ok('printer entered nothing: still receivable — a box up to the 4 still to come, with a note', /data-fldless="P1\|O1__X"[^>]*max="4"/.test(blocked) && /data-fldgo/.test(blocked) && !/data-q=/.test(blocked) && /Printer has not entered pieces/.test(blocked), blocked);
    const A = load({ pending: () => ({ vs: 3, pending: 3, blocked: false }) });
    const cell = A.flowDueRecvCell(x, 'P1|O1__X');
    ok('printer entered 3: one button "Receive 3 pcs" on the line, and "other amount?"', /data-fldgo="P1\|O1__X" data-q="3"/.test(cell) && /Receive 3 pcs/.test(cell) && /other amount\?/.test(cell), cell);
    const less = load({ pending: () => ({ vs: 3, pending: 3, blocked: false }), less: 'P1|O1__X' }).flowDueRecvCell(x, 'P1|O1__X');
    ok('"other amount?" opens a box filled with 3, up to the 4 still to come', /data-fldless="P1\|O1__X"[^>]*max="4"[^>]*value="3"/.test(less) && /At most 4 pcs — still to come/.test(less), less);
    const allIn = load({ pending: () => ({ vs: 3, pending: 0, blocked: false }) }).flowDueRecvCell(x, 'P1|O1__X');
    ok('all the printer entered is in: still receivable up to what is still to come, with a note', /data-fldless/.test(allIn) && /All the printer entered is in/.test(allIn), allIn);
    const R = load({ due: [x] });
    const er = await R.flowDueRecvOne('P1|O1__X', 3);
    ok('pressing Receive saves that one line, today, through the usual receive save', !er && R.saves.length === 1 && R.saves[0].pk === 'P1' && R.saves[0].got.O1__X === 3 && R.saves[0].opt.date === '2026-11-16', JSON.stringify(R.saves));
    ok('…and says the printer\'s portal shows it', /printer's portal shows it/.test(R.ctx.FLOW.said));
    ok('a line no longer owed is refused', /not owed any more/.test(await load({ due: [] }).flowDueRecvOne('P1|O1__X', 3)));
  }

  /* ---- late lines on the receiving sheet (18 Nov) — today is 16 Nov in these tests ---- */
  {
    const A = load();
    const line = (due, withPrinter) => ({ due, withPrinter: withPrinter == null ? 3 : withPrinter, code: 'P1', printer: 'RBP-Bagru', l: { key: 'K' + due }, unit: 'pcs' });
    ok('past its due date, cloth with the printer: red', A.flowDueTone(line('2026-11-13'), '2026-11-16') === 'late');
    ok('due today: yellow', A.flowDueTone(line('2026-11-16'), '2026-11-16') === 'near');
    ok('due tomorrow: yellow', A.flowDueTone(line('2026-11-17'), '2026-11-16') === 'near');
    ok('due in two days: white', A.flowDueTone(line('2026-11-18'), '2026-11-16') === '');
    ok('past due but our RFD cloth has not gone: white — the delay is ours', A.flowDueTone(line('2026-11-10', 0), '2026-11-16') === '');
    ok('no due date: white', A.flowDueTone(line(''), '2026-11-16') === '');
    const due = [line('2026-11-10'), line('2026-11-12'), line('2026-11-20'), line('2026-11-01', 0)];
    const bar = load({ due }).flowDueBar(false);
    ok('the toolbar offers "Late only (2)" — the two late lines with cloth at the printer', /data-fldlate="1"[^>]*>Late only \(2\)/.test(bar), bar.slice(0, 900));
    ok('…with "Late only" on, the button brings every line back', /Show all lines/.test(load({ due, lateOnly: true }).flowDueBar(false)));
    ok('nothing late: no button', !/data-fldlate/.test(load({ due: [line('2026-11-20')] }).flowDueBar(false)));
  }

  /* ---- approvals ---- */
  {
    const order = () => ({ vendorCode: 'P1', vendorName: 'RBP-Bagru', id: 'o1', orderNo: 'VPO-1', orderType: 'cut', lines: [L], vSent: { k: b('a', 4), w: b('a', 2, { ask: true }) } });
    const o1 = order();
    const A = load({ vo: [o1], me: { admin: true, email: 'ravi@x' } });
    const asks = A.flowExtraAsks();
    ok('the list shows the 2 extra pieces waiting, with ordered 4 and sent before 4', asks.length === 1 && asks[0].b.qty === 2 && asks[0].ord === 4 && asks[0].before === 4, JSON.stringify(asks.map(a => [a.b.qty, a.ord, a.before])));
    const er = await A.flowExtraAnswer('P1|o1|w', true);
    ok('Approve writes approved on the batch itself', !er && A.puts.length === 1 && A.puts[0][0] === 'pt_vendorOrders/P1/o1/vSent/w/approved' && A.puts[0][1].by === 'ravi@x', JSON.stringify(A.puts));
    ok('…it then counts, and the list is empty', A.flowExtraAsks().length === 0 && A.vpVsSum(Object.values(o1.vSent)) === 6);
    const N = load({ vo: [order()], me: { admin: false } });
    ok('a non-admin cannot approve', /Only an admin/.test(await N.flowExtraAnswer('P1|o1|w', true)) && !N.puts.length);
    const o2 = order(), Rj = load({ vo: [o2], me: { admin: true } });
    await Rj.flowExtraAnswer('P1|o1|w', false);
    ok('Reject writes rejected; the extra never counts', Rj.puts[0][0].endsWith('/w/rejected') && Rj.vpVsSum(Object.values(o2.vSent)) === 4);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
