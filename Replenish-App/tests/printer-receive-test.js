/* PRINTER RECEIVE (Ravi, 16 Nov — the mockup he approved; 19 Nov — received on the printer's view, Design A).
 *   node tests/printer-receive-test.js        (VP_SRC= / FR_SRC= / PR_SRC=<file> run another copy of that file; teeth)
 * The real functions are cut out of src/ and run against stubs: vendor-portal.js (the sent / waiting / approved helpers, vpVsAdd,
 * vpLineIsHist, vpCustStatus, vpCustKpis), flow-receive.js (flowExtraAsks, flowExtraAnswer) and printer-receive.js (the printer's view
 * table, its Receive cell, the share-out over a cloth line's SKUs, the save).
 * What must hold:
 *  - the printer may send up to what is ordered; anything more is its own batch that waits for approval and does not count;
 *  - an approved extra counts and grows the order; a rejected one never counts;
 *  - a line is History once received in full, recorded in full and nothing waits; a bulk order never goes there;
 *  - on the printer's view each line has one Receive button with the printer's figure and ✎ for another amount; a line the printer
 *    entered nothing for can still be received — a box, up to what is still to come; the view-only box sees no Receive at all;
 *  - a cloth line for several SKUs is shared out by what was ordered for each, never more than each still has to come;
 *  - only an admin approves, and the answer is written on the batch itself. */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const VP = rd(process.env.VP_SRC || path.join(APP, 'vendors/portal/vendor-portal.js')), VO = rd(path.join(APP, 'vendors/orders/vendor-orders.js'));
const FR = rd(process.env.FR_SRC || path.join(APP, 'flow/flow-receive.js'));
const PR = rd(process.env.PR_SRC || path.join(APP, 'vendors/portal/printer-receive.js'));
const cut = (src, name) => { let i = src.indexOf('async function ' + name + '('); if (i < 0) i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return src.slice(i, src.indexOf('\n}', i) + 2); };
const line = (src, head) => { const i = src.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return src.slice(i, src.indexOf('\n', i)) + '\n'; };
const vsBlock = s => { const i = s.indexOf('const vpVsRound ='); return s.slice(i, s.indexOf('\n/** Only the printer', i) + 1); };
const PARTS = [line(VO, 'const voLines ='), line(VO, 'const voParts ='), line(VP, 'const vpQty ='), vsBlock(VP),
  line(VP, 'const vpVsKey ='), (s => { const i = s.indexOf('const vpVsAll ='); return s.slice(i, s.indexOf(';\n', i) + 2); })(VP), cut(VP, 'vpVsOf'),
  line(VP, 'const vpRecvAll ='), (s => { const i = s.indexOf('const vpLineIsHist ='); return s.slice(i, s.indexOf('\n', i) + 1); })(VP),
  cut(VP, 'vpVsAdd'), line(VP, 'const vpVsSplit ='), cut(VP, 'vpCustStatus'), cut(VP, 'vpCustKpis'),
  line(VP, 'const VP_RECV_CNT ='), line(VP, 'const vpRecvKey ='), cut(VP, 'vpRecvCnt'),
  line(FR, 'const flowQtyTxt ='), line(FR, 'let FLOW_VOIX ='), line(FR, 'const FLOW_CLOTH_OVER ='), line(FR, 'const flowMostOf ='), line(FR, 'const flowChUnit ='), cut(FR, 'flowVoIndex'), cut(FR, 'flowExtraAsks'), cut(FR, 'flowExtraAnswer'),
  line(PR, 'const VPR ='), line(PR, 'const VPR_RETRY_MS ='), cut(PR, 'vprEnsure'), line(PR, 'const vprOn ='), line(PR, 'const vprMay ='), line(PR, 'const vprReady ='), (src => { const i = src.indexOf('const vprKeys ='); return src.slice(i, src.indexOf('};\n', i) + 3); })(PR),
  line(PR, 'let VPR_IX ='), cut(PR, 'vprDueIndex'), cut(PR, 'vprTargets'), cut(PR, 'vprOffer'), cut(PR, 'vprKeysPending'), cut(PR, 'vprReceiveLine'), cut(PR, 'vprSplit'), cut(PR, 'vprShareOut'),
  cut(PR, 'vprWholePieces'), cut(PR, 'vprRoundMetres'), line(PR, 'const vprOnlyGiven ='), cut(PR, 'vprRecvCell'), cut(PR, 'vprPendingAll'), cut(PR, 'vprReceiveFor'),
  line(VP, 'const VP_SHEET_COLS ='), line(VP, 'const VP_SHEET_NUM ='), line(VP, 'const VP_SHEET_EMPTY ='), cut(VP, 'vpSheetLines'), cut(VP, 'vpSheetCells'), cut(VP, 'vpOrderLabel'), cut(VP, 'vpToReceiveCell'), line(VP, 'const vpToReceive ='), line(VP, 'const vpOnTheWay ='), cut(VP, 'vpSheetTable'),
  cut(PR, 'vprSplitHint'), cut(PR, 'vprSheet'), cut(PR, 'vprReceive'), cut(PR, 'vprBarSync'), cut(PR, 'vprTabSync'), line(PR, 'const VPR_HIST ='), line(PR, 'const vprHistRows ='), cut(PR, 'vprHistTotals'), cut(PR, 'vprHistHtml'), (src => { const i = src.indexOf('const VP_DUE_ONLY ='); return src.slice(i, src.indexOf('\n};', i) + 3); })(VP), cut(VP, 'vpDueOnlyOk'), cut(VP, 'vpDueChip'), cut(VP, 'vpRejNote'), line(PR, 'const VPR_REJ_REASONS ='), line(PR, 'const VPR_REJ ='), cut(PR, 'vprReject'), line(PR, 'const vprRejLink ='), cut(PR, 'vprFabricOf'), cut(PR, 'vprHistRejects'), line(PR, 'const vprIsoOfDmy ='), line(PR, 'const vprSkuFabric ='), cut(PR, 'vprHistOld'), (src => { const i = src.indexOf('const vprHistAll ='); return src.slice(i, src.indexOf('\nfunction', i) + 1); })(PR), cut(PR, 'vprRejSeen'), line(PR, 'const vprHistId ='), (src => { const i = src.indexOf('const vprHistEditLink ='); return src.slice(i, src.indexOf('function vprHistEditForm', i)); })(PR), cut(PR, 'vprRejectReceived'), line(PR, 'const vprRejPending ='), (src => { const i = src.indexOf('const flowMixTxt ='); return src.slice(i, src.indexOf("'0'; };", i) + 7); })(FR)].join('\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

function load(o) {
  o = o || {};
  const puts = [], saves = [], said = [], syncs = [], els = { flVpX: { innerHTML: '' } }, flowRowsNow = [];
  const ctx = {
    ME: Object.assign({ email: 'rbp@x', admin: false, tabs: [] }, o.me || {}), VP: Object.assign({ code: 'P1', rows: o.rows || [] }, o.vp || {}),
    VO: { rows: o.vo || [] }, FLOW: { po: o.po || {}, said: '', ppc: o.notRead ? null : {}, ch: o.ch || {} }, flowGuard: async () => o.guardErr || '', FLOW_RUF: '~ruffle', FLOW_ON: true, NAV_IS_VENDOR: !!o.vendor,
    esc: s => String(s == null ? '' : s), nf: n => String(n), obUC: s => String(s || '').toUpperCase(), fabKey: s => String(s || '').toLowerCase(),
    flowR2: n => Math.round((+n || 0) * 100) / 100, vpVsWhen: () => 'today', vpIsCustom: x => !!(x && x.custom),
    vpRecvOf: (l, x) => ({ qty: +((x && x.recv && x.recv[l.lineId]) || 0), how: '' }), renderVp() {}, vpSay: (id, m, bad) => said.push({ m, bad }),
    ptPut: async (p, v) => { if (o.putFails) throw new Error('offline'); puts.push([p, v]); },
    document: { querySelector: () => o.box || null },
    vpVsCan: () => true, flowDueRows: () => o.due || [], flowRows: () => flowRowsNow, dToday: () => '2026-11-16',
    flowMay: tab => !!(ctx.ME.admin || (ctx.ME.tabs || []).includes(tab)), cutSkuOf: sku => (o.master || {})[sku] || null,
    VP_PART: '', vpPartOk: () => true, vpQOk: () => true, vpLineOn: () => false, voLineMatches: () => true, voDueOf: (x, l) => l.dueX || null, voWant: () => '',
    vpDueClass: x => (x && x.st === 'late' ? 'vo-late' : ''), voDueHtml: x => (x ? x.due : '—'), vpIsShop: () => false, vpForOrders: l => ((l && l.forOrders) || []).map(x => x && x.orderNo).filter(Boolean),
    ptImgCellSrc: () => '<td></td>', ptImgCell: () => '<td></td>', vpRunPic: () => '<td></td>', flowVoProgSync: () => syncs.push(1), $: id => els[id], reads: [], flowChIndex: () => o.chIx || {}, flowRecvRows: () => o.recvRows || [], vpHistRows: () => o.oldRows || [], patches: [], ptPatch: async p => { if (o.patchFails) throw new Error('offline'); ctx.patches.push(p); }, voProm: l => l.prom || '', VO_SOON: 3, flowDueDay: d => d,
    flowEnsureData: () => { ctx.reads.push(1); return Promise.resolve(); },
    flowDueRecvSave: async (pk, got, opt) => { saves.push({ pk, got, opt }); flowDueRecvSaveSaid(); return o.saveErr || ''; },
  };
  function flowDueRecvSaveSaid() { ctx.flowDueRecvSave.said = 'Received from RBP-Bagru on RFD-1.'; }
  const names = Object.keys(ctx);
  const A = new Function(...names, PARTS + '\nreturn { vprPendingAll, vprReceiveFor, vpVsSum, vpVsWait, vpVsApproved, vpOrdOf, vpVsSplit, vpVsAdd, vpLineIsHist, vpCustStatus, vpCustKpis, flowExtraAsks, flowExtraAnswer, vprSplit, vprOffer, vprRecvCell, vprSheet, vprReceive, vprBarSync, vprTabSync, vprEnsure, VPR, VPR_HIST, vprHistRows, vprHistTotals, vprHistHtml, vpDueOnlyOk, vpDueChip, vpSentKept, vprHistOld, flowMostOf, vpToReceiveCell, vpOnTheWay, vprRejectReceived, vprHistEditLink, vprReject, vpRejNote, vprRejSeen, vprRejPending, VPR_REJ };')(...names.map(k => ctx[k]));
  return Object.assign(A, { patches: ctx.patches, puts, saves, said, syncs, els, ctx });
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

  /* ---- the printer's view: Receive on the line (19 Nov, Design A) ---- */
  {
    const due = (key, need, left, more) => Object.assign({ l: { key, fabric: 'Sheeting 82' }, unit: 'm', need, left, back: need - left, code: 'P1', printer: 'RBP-Bagru',
      sku: key.split('__')[1], r: { articleSubtype: 'Pillow', size: key.endsWith('16') ? '16x16' : '18x18' } }, more || {});
    const D16 = due('B2B-4__P16', 6, 6), D18 = due('B2B-4__P18', 4, 4);
    const mb = (qty, more) => b('a', qty, Object.assign({ unit: 'm', sku: 'RBPSF9-H-82' }, more || {}));
    const cloth = (vs, recv, part) => ({ id: 'o1', vendorCode: 'P1', orderNo: 'VPO-9', orderType: 'running', vSent: vs || {}, recv: recv || {},
      lines: [{ lineId: 'a', sku: 'RBPSF9-H-82', fabricType: 'Sheeting 82', meters: 10, flowPart: part || 'B2B-4__P16|body+B2B-4__P18|body' }] });
    const recv = { me: { tabs: ['flchl'] }, vp: { viewAs: true } };
    const at = (o, more) => load(Object.assign({ rows: [o], due: [D16, D18] }, recv, more || {}));

    const S = load();
    const two = [{ key: 'P16', weight: 6, cap: 6.6 }, { key: 'P18', weight: 4, cap: 4.4 }];
    ok('a cloth line for two SKUs: 5 m is shared by what was ordered (6 m and 4 m) — 3 m and 2 m', JSON.stringify(S.vprSplit(5, two, false)) === '{"P16":3,"P18":2}', JSON.stringify(S.vprSplit(5, two, false)));
    ok('…never more than one still has to come: with 1 m left on the first, 5 m goes 1 + 4', JSON.stringify(S.vprSplit(5, [{ key: 'A', weight: 6, cap: 1 }, { key: 'B', weight: 4, cap: 10 }], false)) === '{"A":1,"B":4}');
    const p3 = S.vprSplit(5, [{ key: 'A', weight: 1, cap: 5 }, { key: 'B', weight: 1, cap: 5 }, { key: 'C', weight: 1, cap: 5 }], true) || {};
    ok('…pieces stay whole, one extra piece a line: 5 over three equal lines is 2 + 2 + 1', JSON.stringify(p3) === '{"A":2,"B":2,"C":1}', JSON.stringify(p3));
    const p2 = S.vprSplit(2, [{ key: 'A', weight: 1, cap: 10 }, { key: 'B', weight: 1, cap: 10 }, { key: 'C', weight: 1, cap: 10 }], true) || {};
    ok('…2 over three equal lines is 1 + 1, never 2 on one', JSON.stringify(p2) === '{"A":1,"B":1}', JSON.stringify(p2));
    const mr = S.vprSplit(1, [{ key: 'A', weight: 1, cap: 0.33 }, { key: 'B', weight: 1, cap: 0.34 }, { key: 'C', weight: 1, cap: 0.34 }], false) || {};
    ok('…metres: the rounding left over never puts a line over what it may take', mr.A <= 0.33 && mr.B <= 0.34 && mr.C <= 0.34 && Math.round((mr.A + mr.B + mr.C) * 100) === 100, JSON.stringify(mr));
    ok('…more than all of them can take: refused', S.vprSplit(12, two, false) === null);

    const o5 = cloth({ k: mb(5) });
    const cell = at(o5).vprRecvCell(o5, o5.lines[0], 'o1|0');
    ok('printer sent 5 m: one green "Receive 5 m" on the line, with ✎ for another amount', /data-vprgo="o1\|0" data-q="5"/.test(cell) && /Receive 5 m/.test(cell) && /data-vprless="o1\|0"/.test(cell), cell);
    ok('…and it says where the 5 m goes: Pillow 16x16 3 m · Pillow 18x18 2 m', /Pillow 16x16 <b>3 m<\/b> · Pillow 18x18 <b>2 m<\/b>/.test(cell), cell);
    const o0 = cloth({});
    const box = at(o0).vprRecvCell(o0, o0.lines[0], 'o1|0');
    ok('printer entered nothing: a box straight away, up to the 11 m still to come (10% over on cloth)', /data-vprbox="o1\|0"[^>]*max="11"/.test(box) && /Printer has not entered it/.test(box) && !/data-q=/.test(box), box);
    const lessA = at(o5); lessA.VPR.less = 'o1|0';
    ok('✎ opens a box filled with the printer’s 5 m', /data-vprbox="o1\|0"[^>]*value="5"/.test(lessA.vprRecvCell(o5, o5.lines[0], 'o1|0')));
    const oIn = cloth({ k: mb(5) }, { a: 5 });
    ok('all the printer entered is in: still receivable with a box, and a note', /All the printer entered is in/.test(at(oIn).vprRecvCell(oIn, oIn.lines[0], 'o1|0')));
    ok('the figures not read yet: no button, it says so', /reading…/.test(at(o5, { notRead: true }).vprRecvCell(o5, o5.lines[0], 'o1|0')));
    ok('another printer’s lines are never received on this printer’s order', /—/.test(at(o5, { due: [due('B2B-4__P16', 6, 6, { code: 'P2' })] }).vprRecvCell(o5, o5.lines[0], 'o1|0')));
    /* FROM THE STORE (24 Nov): every line any printer sent that is not in yet, with the same Receive offer */
    {
      const oS = Object.assign(cloth({ k: mb(5) }, {}), { vendorName: 'RBP-Bagru' });
      const P = load(Object.assign({ rows: [], vo: [oS], due: [D16, D18] }, recv));
      P.ctx.VP.code = 'KEEP';
      const lst = P.vprPendingAll();
      ok('the Store lists a line a printer sent that is not in yet: VPO-9, 5 sent, 0 in, 5 m offered', lst && lst.length === 1 && lst[0].id === 'o1|0' && lst[0].v.n === 5 && lst[0].sent === 5 && lst[0].got === 0 && lst[0].printer === 'RBP-Bagru',
        JSON.stringify(lst && lst.map(x => [x.id, x.v.n, x.sent, x.got])));
      ok('…VP.code is put back as it was', P.ctx.VP.code === 'KEEP');
      const none = load(Object.assign({ rows: [], vo: [cloth({}, {})], due: [D16, D18] }, recv)).vprPendingAll();
      ok('a printer that sent nothing: nothing listed', none && none.length === 0);
      const allIn = load(Object.assign({ rows: [], vo: [cloth({ k: mb(5) }, { a: 5 })], due: [D16, D18] }, recv)).vprPendingAll();
      ok('…all of it in: nothing listed', allIn && allIn.length === 0);
      ok('the figures not read yet: null (the Store says it is reading)', load(Object.assign({ rows: [], vo: [oS], due: [D16, D18], notRead: true }, recv)).vprPendingAll() === null);
      const R = load(Object.assign({ rows: [], vo: [oS], due: [D16, D18] }, recv));
      R.ctx.VP.code = 'KEEP';
      const er = await R.vprReceiveFor('o1|0', 5);
      ok('Receive from the Store takes the 5 m in on the printer\'s challan, and VP.code is put back', er === '' && R.saves.length === 1 && R.ctx.VP.code === 'KEEP', er + ' ' + JSON.stringify(R.saves));
      ok('…an order that is not on the list is refused', /not on the list/.test(await R.vprReceiveFor('zz|0', 1)));
    }
    const oRuf = cloth({ k: mb(2) }, {}, 'B2B-4__P16|ruffle');
    ok('ruffle cloth is not received here (it goes on its challan)', !/data-vprgo/.test(at(oRuf).vprRecvCell(oRuf, oRuf.lines[0], 'o1|0')));

    /* a quilt: one flow line printed as front and back — two portal lines share it */
    const quilt = recvd => ({ id: 'q1', vendorCode: 'P1', orderNo: 'VPO-Q', orderType: 'running', vSent: { k: b('f', 5, { unit: 'm' }) }, recv: { f: recvd, b: recvd },
      lines: [{ lineId: 'f', sku: 'Q-F', meters: 5, flowPart: 'SHP-9__Q|Front' }, { lineId: 'b', sku: 'Q-B', meters: 5, flowPart: 'SHP-9__Q|Back' }] });
    const QD = due('SHP-9__Q', 10, 10);
    const q0 = quilt(0), qa = load(Object.assign({ rows: [q0], due: [QD] }, recv));
    ok('a quilt front entered 5 m: "Receive 5 m" on the front', /Receive 5 m/.test(qa.vprRecvCell(q0, q0.lines[0], 'q1|0')), qa.vprRecvCell(q0, q0.lines[0], 'q1|0'));
    const q5 = quilt(2.5), qb = load(Object.assign({ rows: [q5], due: [due('SHP-9__Q', 10, 5)], chIx: { 'SHP-9__Q': { recv: 5 } } }, recv));
    ok('…once those 5 m are in (shown 2.5 on each side), the front offers nothing again', !/data-q=/.test(qb.vprRecvCell(q5, q5.lines[0], 'q1|0')), qb.vprRecvCell(q5, q5.lines[0], 'q1|0'));
    const pcs2 = { id: 'o3', vendorCode: 'P1', orderType: 'cut', vSent: { k: b('d', 9) }, recv: {}, lines: [{ lineId: 'd', sku: 'D', qty: 6, flowPart: 'A__D1|sku+A__D2|sku' }] };
    const pc = load(Object.assign({ rows: [pcs2], due: [due('A__D1', 3, 2.5, { unit: 'pcs' }), due('A__D2', 3, 2.5, { unit: 'pcs' })] }, recv)).vprRecvCell(pcs2, pcs2.lines[0], 'o3|0');
    ok('pieces: the most is whole on each line (2 + 2), so "Receive 4 pcs" is offered, not 5', /Receive 4 pcs/.test(pc), pc);

    /* THE ORDER SHEET (21 Nov, the sketch): Date, Image, Order Number, Item, Ordered, Sent by printer, Received, Due Date — and Receive. */
    const o5d = Object.assign(cloth({ k: mb(5) }, { a: 4 }), { orderDate: '12/11/2026' });
    const sheet = at(o5d, { master: {} }).vprSheet([o5d], {});
    const heads = (sheet.match(/<th[^>]*>([^<]*)<\/th>/g) || []).map(x => x.replace(/<[^>]+>/g, '')).join('|');
    ok('the one table: Date, Image, Order Number, Item, Ordered, Sent by printer, To receive, Due Date, Receive',
      heads === 'Date|Image|Order Number|Item|Ordered|Sent by printer|To receive|Due Date|Receive', heads);
    const cells = ((sheet.match(/<tbody><tr[^>]*>([\s\S]*?)<\/tr>/) || [])[1] || '').split('</td>').map(c => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    ok('…the row reads: order date, order number, the cloth, 10 m ordered, 5 sent with "1 on the way" under it (4 are in), 6 m to receive with "4 m received" under it',
      cells[0] === '12/11/2026' && cells[2] === 'VPO-9' && /Sheeting 82/.test(cells[3]) && cells[4] === '10 m' && cells[5] === '5 1 on the way' && cells[6] === '6 m 4 m received', JSON.stringify(cells));
    /* 25 Nov: Sent by printer keeps the total (it showed 0 once everything was received); the real order is the number */
    const allIn = cloth({ k: mb(5) }, { a: 5 }), shAll = at(allIn, { master: {} }).vprSheet([allIn], {});
    const cAll = ((shAll.match(/<tbody><tr[^>]*>([\s\S]*?)<\/tr>/) || [])[1] || '').split('</td>').map(c => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    ok('…everything the printer sent is in: Sent by printer still says 5 (it showed 0), with nothing "on the way"', cAll[5] === '5', JSON.stringify(cAll));
    const withSo = cloth({ k: mb(5) }, { a: 4 }); withSo.lines[0].forOrders = [{ orderNo: 'AMZ-24112026-AIR', qty: 100 }];
    const shSo = at(withSo, { master: {} }).vprSheet([withSo], {});
    ok('the order number on the sheet is the real order (AMZ-24112026-AIR), the VPO small under it', /AMZ-24112026-AIR[^<]*<div[^>]*>VPO-9<\/div>/.test(shSo), shSo.slice(shSo.indexOf('<tbody>'), shSo.indexOf('<tbody>') + 500));
    ok('…a line that names no sales order keeps the VPO', /<td[^>]*>VPO-9</.test(sheet));
    ok('…and the printer own sheet calls the to-receive figure "Pending with you"', /'Pending with you'/.test(VP));
    ok('…a Shopify reference is kept as it was', /vpIsShop\(o\) && \(l\.shopRef/.test(VP));
    ok('…Sent by printer is the number alone — no batches, no approval note', !/batch\(es\)|waiting approval/.test(sheet));
    ok('…as many cells as headings', cells.filter(Boolean).length >= 8 && (sheet.match(/<tbody><tr[^>]*>[\s\S]*?<\/tr>/)[0].match(/<td/g) || []).length === 9);
    const view = load({ rows: [o5], due: [D16, D18], me: { tabs: ['vpview'] }, vp: { viewAs: true } }).vprSheet([o5], {});
    ok('the view-only box: the same table without Receive, and nothing to press', !/>Receive</.test(view) && !/data-vprgo/.test(view) && />Order Number</.test(view));
    ok('a printer’s own sign-in never gets Receive', !/data-vprgo/.test(load({ rows: [o5], due: [D16, D18], me: { tabs: ['flchl'] }, vp: { viewAs: true }, vendor: true }).vprSheet([o5], {})));

    const R = at(o5);
    const er = await R.vprReceive('o1|0', 5);
    ok('Receive 5 m saves once, today, through the usual receive save: 3 m on Pillow 16x16 and 2 m on Pillow 18x18', !er && R.saves.length === 1 && R.saves[0].pk === 'P1'
      && JSON.stringify(R.saves[0].got) === '{"B2B-4__P16":3,"B2B-4__P18":2}' && R.saves[0].opt.date === '2026-11-16' && R.saves[0].opt.deduct === true, er + JSON.stringify(R.saves));
    ok('…the printer’s copy of what came back is written, and it says the portal shows it', R.syncs.length === 1 && /printer's portal shows it/.test(R.VPR.said));
    const big = at(o5);
    ok('more than is still to come: refused, nothing saved', /more than the 11 m still to come/.test(await big.vprReceive('o1|0', 12)) && !big.saves.length);
    const cut = { id: 'o2', vendorCode: 'P1', orderNo: 'VPO-3', orderType: 'cut', vSent: {}, recv: {}, lines: [{ lineId: 'c', sku: 'C1', qty: 4, flowPart: 'SHP-7__C1|sku' }] };
    const P = load(Object.assign({ rows: [cut], due: [due('SHP-7__C1', 4, 4, { unit: 'pcs' })] }, recv));
    ok('pieces are whole: 1.5 is refused', /pieces are whole/.test(await P.vprReceive('o2|0', 1.5)) && !P.saves.length);
    const F = at(o5, { saveErr: 'Could not save: offline' });
    ok('a failed save is said as it is, and nothing is sent on to the printer', /Could not save/.test(await F.vprReceive('o1|0', 5)) && !F.syncs.length);
    const E = at(o5, { notRead: true });
    E.vprEnsure(); E.vprEnsure(); await new Promise(r => setTimeout(r, 0)); E.vprEnsure();
    ok('the figures are read once, and a read that came back short is not repeated on every draw (at most once a minute)', E.ctx.reads.length === 1 && /could not read the figures/.test(E.vprRecvCell(o5, o5.lines[0], 'o1|0')), E.ctx.reads.length);
    const V = load({ rows: [o5], me: { tabs: ['vpview'] }, vp: { viewAs: true }, notRead: true }); V.vprEnsure();
    ok('…the view-only box never reads them', V.ctx.reads.length === 0);
    const D = at(o5);
    const [r1, r2] = await Promise.all([D.vprReceive('o1|0', 5), D.vprReceive('o1|0', 5)]);
    ok('pressed twice before the first save is back: one save, the second is told to wait', D.saves.length === 1 && !r1 && /Still saving/.test(r2), JSON.stringify([r1, r2, D.saves.length]));
    ok('a line gone from the screen is refused', /not on screen any more/.test(await at(o5).vprReceive('zz|0', 5)));
  }

  /* ---- extra pieces, for the printer on screen ---- */
  {
    const ask = (code, id) => ({ vendorCode: code, vendorName: code, id, orderNo: 'VPO-' + id, orderType: 'cut', lines: [L], vSent: { k: b('a', 4), w: b('a', 2, { ask: true }) } });
    const A = load({ vo: [ask('P1', 'o1'), ask('P2', 'o2')], me: { admin: true }, vp: { viewAs: true } });
    ok('the list for one printer shows only its own extras', A.flowExtraAsks('P2').length === 1 && A.flowExtraAsks('P2')[0].o.vendorCode === 'P2' && A.flowExtraAsks().length === 2);
    A.vprBarSync();
    ok('an admin on the printer’s view sees "Extra pieces to approve (1)" for that printer', /data-vprxopen/.test(A.els.flVpX.innerHTML) && /navbadge[^>]*>1</.test(A.els.flVpX.innerHTML), A.els.flVpX.innerHTML);
    const N = load({ vo: [ask('P1', 'o1')], me: { admin: false, tabs: ['flchl'] }, vp: { viewAs: true } });
    N.vprBarSync();
    ok('…the challan person (not an admin) sees no approve button', !/data-vprxopen/.test(N.els.flVpX.innerHTML));
    const Vw = load({ vo: [], me: { tabs: ['vpview'] }, vp: { viewAs: true } }); Vw.vprBarSync();
    ok('…the view-only box sees none', Vw.els.flVpX.innerHTML === '');
  }

  /* ---- History in place of Completed on the office's view (20 Nov) ---- */
  {
    const tabRow = A => { const el = { cls: new Set(), classList: { toggle: (c, on) => { if (on) el.cls.add(c); else el.cls.delete(c); } } };
      A.els.vpTabDone = { insertAdjacentHTML: (where, html) => { el.where = where; el.html = html; A.els.vpTabRx = el; } }; return A; };
    const C = tabRow(load({ me: { tabs: ['flchl'] }, vp: { viewAs: true } }));
    C.vprTabSync(); C.vprTabSync();
    ok('the challan person gets a History button right after where Completed was, once', C.els.vpTabRx && C.els.vpTabRx.where === 'afterend' && /data-vprhist="1"/.test(C.els.vpTabRx.html) && />History</.test(C.els.vpTabRx.html) && !C.els.vpTabRx.cls.has('hide'));
    const V = tabRow(load({ me: { tabs: ['vpview'] }, vp: { viewAs: true } })); V.vprTabSync();
    ok('…the view-only box gets none', !V.els.vpTabRx);
    const P = tabRow(load({ me: { tabs: ['flchl'] }, vp: { viewAs: true }, vendor: true })); P.vprTabSync();
    ok('…a printer\'s own sign-in gets none (it keeps Completed)', !P.els.vpTabRx);
  }

  /* ---- the strip's figures are buttons (19 Nov) ---- */
  {
    const ln = (st, prom) => ({ dueX: st ? { st, due: '2026-11-10' } : null, prom });
    const F = load({ vp: { dueOnly: 'late' } });
    ok('"past the due date" pressed: only late lines', F.vpDueOnlyOk({}, ln('late')) && !F.vpDueOnlyOk({}, ln('soon')) && !F.vpDueOnlyOk({}, ln(null)));
    F.ctx.VP.dueOnly = 'soon';
    ok('"due in the next days": due today and soon, not late', F.vpDueOnlyOk({}, ln('today')) && F.vpDueOnlyOk({}, ln('soon')) && !F.vpDueOnlyOk({}, ln('late')));
    F.ctx.VP.dueOnly = 'wait';
    ok('"waiting for cloth from us": only those', F.vpDueOnlyOk({}, ln('wait')) && !F.vpDueOnlyOk({}, ln('late')));
    F.ctx.VP.dueOnly = 'nodate';
    ok('"with no date from you": lines with cloth and no date, not waiting ones', F.vpDueOnlyOk({}, ln('late')) && !F.vpDueOnlyOk({}, ln('late', '2026-11-30')) && !F.vpDueOnlyOk({}, ln('wait')));
    F.ctx.VP.dueOnly = '';
    ok('nothing pressed: every line', F.vpDueOnlyOk({}, ln(null)) && F.vpDueOnlyOk({}, ln('late')));
    const chip = F.vpDueChip('late', 56, '56 past the due date', 'red');
    ok('each figure is a button that filters', /data-vpdue="late"/.test(chip) && /Show only these lines/.test(chip));
    F.ctx.VP.dueOnly = 'late';
    ok('…pressed, it shows ✕ and brings every line back', /56 past the due date ✕/.test(F.vpDueChip('late', 56, '56 past the due date', 'red')) && /Show every line/.test(F.vpDueChip('late', 56, '56 past the due date', 'red')));
    F.ctx.VP.dueOnly = '';
    ok('a figure of 0 is not shown', F.vpDueChip('wait', 0, '0 waiting', 'red') === '');
  }

  /* ---- Reject: bad goods turned away on receive (19 Nov) ---- */
  {
    const due = (key, need, left, more) => Object.assign({ l: { key, fabric: 'Cambric 60' }, unit: 'pcs', need, left, back: need - left, code: 'P1', printer: 'RBP-Bagru', sku: 'C1', r: {} }, more || {});
    const cutO = (vs, rej, recvd) => ({ id: 'o2', vendorCode: 'P1', orderNo: 'VPO-3', orderType: 'cut', vSent: vs || {}, vRej: rej || {}, recv: recvd || {},
      lines: [{ lineId: 'c', sku: 'C1', qty: 4, articleSubtype: 'Tablecloth', flowPart: 'SHP-7__C1|sku' }] });
    const at = (o, more) => load(Object.assign({ rows: [o], due: [due('SHP-7__C1', 4, 4)], me: { tabs: ['flchl'] }, vp: { viewAs: true, name: 'RBP-Bagru' } }, more || {}));
    const rj = (qty, more) => Object.assign({ lineId: 'c', sku: 'C1', qty, unit: 'pcs', reason: 'Print fault', at: '2026-11-19T10:00:00Z', by: 'challan@x' }, more || {});

    const o4 = cutO({ k: b('c', 4) });
    const A = at(o4);
    ok('sent 4, rejected 0: still counts 4 as sent', A.vpSentKept(o4, o4.lines[0]) === 4);
    const cell = A.vprRecvCell(o4, o4.lines[0], 'o2|0');
    ok('a line with goods the printer entered offers Reject beside Receive', /data-vprrej="o2\|0"/.test(cell) && /Receive 4 pcs/.test(cell), cell);
    const oAllIn = cutO({ k: b('c', 4) }, {}, { c: 4 });
    ok('…nothing left to take in: no Reject', !/data-vprrej/.test(at(oAllIn).vprRecvCell(oAllIn, oAllIn.lines[0], 'o2|0')));

    const R = at(o4);
    const er = await R.vprReject('o2|0', 2, 'Print fault', '');
    const paths = Object.keys((R.patches[0] || {}));
    ok('Reject 2 pcs writes one save: the reject on the printer\'s order and a notice for the bell', !er && R.patches.length === 1 && paths.length === 2
      && /^pt_vendorOrders\/P1\/o2\/vRej\/rj_/.test(paths[0]) && /^pt_recvRejects\/rj_/.test(paths[1]), er + JSON.stringify(paths));
    const recW = R.patches[0][paths[0]], note = R.patches[0][paths[1]];
    ok('…with the amount, reason, who and when; the notice waits (pending) and names the printer, order and fabric', recW.qty === 2 && recW.reason === 'Print fault' && recW.by === 'rbp@x' && recW.lineId === 'c'
      && note.status === 'pending' && note.printer === 'RBP-Bagru' && note.orderNo === 'VPO-3' && note.fabric === 'Cambric 60', JSON.stringify(note));
    const o2 = R.ctx.VP.rows[0];
    ok('…the order on screen is a new copy with the reject; the old one is untouched', o2 !== o4 && Object.keys(o2.vRej).length === 1 && !Object.keys(o4.vRej).length);
    ok('…only 2 now count as sent, so Receive offers 2', R.vpSentKept(o2, o2.lines[0]) === 2 && /Receive 2 pcs/.test(R.vprRecvCell(o2, o2.lines[0], 'o2|0')));
    ok('…and the bell gets it at once', R.VPR_REJ.rows === null || R.VPR_REJ.rows.length === 1);
    const st = R.vpCustStatus(o2, o2.lines[0]);
    ok('the printer\'s status says "2 pcs rejected by Ridhi — send again"', /2 pcs rejected by Ridhi — send again/.test(st), st);
    ok('…and under what it sent: the reason', /2 pcs rejected by Ridhi — Print fault · send again/.test(R.vpRejNote(o2, o2.lines[0], 'pcs')));

    ok('more than the printer entered and we have not taken in: refused', /more than the 4 pcs/.test(await at(o4).vprReject('o2|0', 5, 'Print fault', '')));
    ok('no reason: refused', /Pick a reason/.test(await at(o4).vprReject('o2|0', 1, '', '')));
    ok('"Other" with no note: refused', /Write what is wrong/.test(await at(o4).vprReject('o2|0', 1, 'Other', '')));
    ok('half a piece: refused', /pieces are whole/.test(await at(o4).vprReject('o2|0', 1.5, 'Print fault', '')));
    const F = at(o4, { patchFails: true });
    ok('a failed save says so and changes nothing', /Could not save/.test(await F.vprReject('o2|0', 1, 'Print fault', '')) && F.ctx.VP.rows[0] === o4);

    /* the printer sends again */
    const oR = cutO({ k: b('c', 4) }, { r1: rj(2) });
    const P = load({ rows: [oR], box: { value: '2' } });
    await P.vpVsAdd('o2', 0);
    ok('the printer can send the 2 rejected again: they count at once, no approval asked', P.puts.length === 1 && P.puts[0][1].qty === 2 && !P.puts[0][1].ask, JSON.stringify(P.puts));

    /* History */
    const H = at(oR);
    Object.assign(H.VPR_HIST, { from: '2026-11-01', to: '2026-11-19' });
    const hh = H.vprHistHtml();
    ok('History lists the reject in red with its reason, and keeps it out of what came', /REJECTED/.test(hh) && /Print fault/.test(hh) && /class="vo-late"/.test(hh) && /Rejected 2 pcs/.test(hh) && !/Cambric 60 <b[^>]*>2 pcs/.test(hh), hh.slice(0, 900));

    /* the bell */
    const B = load({ me: { admin: true, email: 'ravi@x' } });
    B.VPR_REJ.rows = [{ id: 'rj1', status: 'pending', qty: 2 }];
    ok('"Seen" marks the notice seen (who and when) and takes it off the bell', !(await B.vprRejSeen('rj1')) && B.patches[0]['pt_recvRejects/rj1/status'] === 'seen' && B.patches[0]['pt_recvRejects/rj1/seenBy'] === 'ravi@x' && B.vprRejPending().length === 0);
  }

  /* ---- History: the old "Sending now" deliveries (20 Nov) ---- */
  {
    const old = (day, sent, kept, more) => Object.assign({ day, date: day, orderNo: 'VPO-OLD', run: false, unit: 'pcs', sku: 'cpc1', what: 'Cushion · Blue', sent, kept, no: false, short: kept == null ? 0 : sent - kept, note: '', at: '' }, more || {});
    const O = load({ oldRows: [old('12/11/2026', 10, 8), old('14/11/2026', 5, null), old('15/11/2026', 4, 0, { no: true }), old('01/09/2026', 3, 3)], me: { tabs: ['flchl'] }, vp: { viewAs: true } });
    const rows = O.vprHistOld('2026-10-20', '2026-11-19');
    ok('old deliveries come into History by their day (dd/mm/yyyy read right), only those in the range', rows.length === 3 && rows.map(r => r.day).join() === '2026-11-12,2026-11-14,2026-11-15', JSON.stringify(rows.map(r => r.day)));
    ok('…accepted 8 of 10: shows 8 with "printer said 10 pcs, 2 short"', rows[0].qty === 8 && /printer said 10 pcs, 2 short/.test(rows[0].note) && !rows[0].notCome);
    ok('…not checked yet / not accepted: listed, not counted as come', rows[1].notCome && /not checked yet/.test(rows[1].note) && rows[2].notCome && /not accepted/.test(rows[2].note));
    Object.assign(O.VPR_HIST, { from: '2026-10-20', to: '2026-11-19' });
    const h = O.vprHistHtml();
    ok('…an old pieces line takes its fabric from the master', load({ oldRows: [old('12/11/2026', 10, 8)], master: { CPC1: { fabric: 'Cambric 60' } } }).vprHistOld('2026-11-01', '2026-11-19')[0].fabric === 'Cambric 60');
    ok('…the window marks them "old way" and the totals count only the accepted 8', /old way/.test(h) && /fabric not named <b[^>]*>8 pcs/.test(h), h.slice(0, 700));
  }

  /* ---- 21 Nov: To receive, 10% of the order, History → Edit ---- */
  {
    const T = load();
    ok('cloth may come 10% over the ORDER: ordered 100 m, 50 m in → at most 60 m (was 55)', T.flowMostOf('m', 100, 50) === 60);
    ok('…nothing in yet: 110 m; all 110 in: 0', T.flowMostOf('m', 100, 0) === 110 && T.flowMostOf('m', 100, 110) === 0);
    ok('…pieces never come over: ordered 4, 1 in → 3', T.flowMostOf('pcs', 4, 1) === 3);
    const c1 = T.vpToReceiveCell(10, { qty: 4, how: '' }, 'm');
    ok('To receive: ordered 10 m, 4 m in → 6 m still to come, "4 m received" under it', /<b[^>]*>6<\/b> <span[^>]*>m<\/span>/.test(c1) && /4 m received/.test(c1), c1);
    ok('…all in: says so', /all in/.test(T.vpToReceiveCell(4, { qty: 4, how: '' }, 'pcs')));
    ok('…more came than ordered (cloth over): still all in, never a minus figure', /all in/.test(T.vpToReceiveCell(10, { qty: 11, how: '' }, 'm')));
    ok('Sent by printer is what is on its way: sent 40, 32 in → 8; all in → 0; received more than entered → 0, never minus',
      T.vpOnTheWay(40, 32) === 8 && T.vpOnTheWay(60, 60) === 0 && T.vpOnTheWay(0, 5) === 0 && T.vpOnTheWay(2.5, 1.25) === 1.25);

    const ch = closed => ({ 'RFD-1': Object.assign({ no: 'RFD-1', orderNo: 'SHP-7', lines: [{ key: 'SHP-7__C1', sku: 'C1', pcs: 5, print: { kind: 'sku' }, item: 'Tablecloth', fabric: 'Cambric 60' }],
      receipts: { r1: { date: '2026-11-18', at: '2026-11-18T10:00:00Z', items: { 'SHP-7__C1': 5 } } } }, closed ? { closed: { at: 't', why: 'all received' } } : {}) });
    const vo = () => ({ id: 'o2', vendorCode: 'P1', orderNo: 'VPO-3', orderType: 'cut', vSent: {}, vRej: {}, lines: [{ lineId: 'c', sku: 'C1', qty: 5, flowPart: 'SHP-7__C1|sku' }] });
    const E = load({ ch: ch(true), rows: [vo()], me: { admin: true, email: 'ravi@x' }, vp: { viewAs: true, name: 'RBP-Bagru' } });
    const er = await E.vprRejectReceived('RFD-1|r1|SHP-7__C1', 2, 'Damaged / stain', '');
    const P = E.patches[0] || {};
    ok('History → Edit: 2 of the 5 received pcs moved to rejected — the receipt keeps 3, with a note of it', !er && P['pt_flowChallans/RFD-1/receipts/r1/items/SHP-7__C1'] === 3
      && Object.keys(P).some(k => /^pt_flowChallans\/RFD-1\/receipts\/r1\/rejectedLater\/rj_/.test(k)), er + JSON.stringify(Object.keys(P)));
    ok('…a reject on the printer\'s order (it must send them again) and a notice for the admins\' bell, in the same save', Object.keys(P).some(k => /^pt_vendorOrders\/P1\/o2\/vRej\/rj_/.test(k)) && Object.keys(P).some(k => /^pt_recvRejects\/rj_/.test(k)));
    ok('…the challan, closed as all received, opens again', P['pt_flowChallans/RFD-1/closed'] === null && !E.ctx.FLOW.ch['RFD-1'].closed && E.ctx.FLOW.ch['RFD-1'].receipts.r1.items['SHP-7__C1'] === 3);
    ok('…the printer\'s copy of what came back is written again', E.syncs.length === 1);
    const all = load({ ch: ch(false), rows: [vo()], me: { admin: true }, vp: { viewAs: true } });
    await all.vprRejectReceived('RFD-1|r1|SHP-7__C1', 5, 'Print fault', '');
    ok('…all 5 moved: the line leaves the receipt', all.patches[0]['pt_flowChallans/RFD-1/receipts/r1/items/SHP-7__C1'] === null && !('pt_flowChallans/RFD-1/closed' in all.patches[0]));
    ok('…not an admin: refused, nothing saved', /Only an admin/.test(await load({ ch: ch(false), rows: [vo()], me: { tabs: ['flchl'] }, vp: { viewAs: true } }).vprRejectReceived('RFD-1|r1|SHP-7__C1', 1, 'Print fault', '')));
    const big = load({ ch: ch(false), rows: [vo()], me: { admin: true }, vp: { viewAs: true } });
    ok('…more than that receipt took in: refused', /only 5 pcs was received/.test(await big.vprRejectReceived('RFD-1|r1|SHP-7__C1', 6, 'Print fault', '')) && !big.patches.length);
    ok('…no reason: refused', /Pick a reason/.test(await load({ ch: ch(false), rows: [vo()], me: { admin: true }, vp: { viewAs: true } }).vprRejectReceived('RFD-1|r1|SHP-7__C1', 1, '', '')));
    const busy = load({ ch: ch(false), rows: [vo()], me: { admin: true }, vp: { viewAs: true }, guardErr: 'Somebody else saved here just now' });
    ok('…somebody else saved on the challan meanwhile: refused, nothing saved', /Somebody else/.test(await busy.vprRejectReceived('RFD-1|r1|SHP-7__C1', 1, 'Print fault', '')) && !busy.patches.length);
    ok('the Edit link is for admins, on receipts only', /data-vprhedit="RFD-1\|r1\|K"/.test(load({ me: { admin: true } }).vprHistEditLink({ no: 'RFD-1', rid: 'r1', l: { key: 'K' } }))
      && load({ me: { tabs: ['flchl'] } }).vprHistEditLink({ no: 'RFD-1', rid: 'r1', l: { key: 'K' } }) === '' && load({ me: { admin: true } }).vprHistEditLink({ rejected: true, rid: 'x', l: {} }) === '');
  }

  /* ---- History: what came from the printer on screen ---- */
  {
    const rr = (day, code, fabric, qty, unit, no) => ({ day, time: '10:00', no: no || 'RFD-1', printerCode: code, orderNo: 'SHP-1', sku: 'S', code: 'PF-1', fabric, qty, unit, by: 'challan', note: '', l: { item: 'Pillow' } });
    const rows = [rr('2026-11-18', 'P1', 'Sheeting 82', 5, 'm'), rr('2026-11-10', 'P1', 'Sheeting 82', 2.5, 'm'), rr('2026-11-12', 'P1', 'Cambric 60', 4, 'pcs'), rr('2026-11-15', 'P2', 'Sheeting 82', 9, 'm'), rr('2026-09-01', 'P1', 'Sheeting 82', 7, 'm')];
    const H = load({ recvRows: rows, me: { tabs: ['flchl'] }, vp: { viewAs: true } });
    const got = H.vprHistRows('P1', '2026-10-20', '2026-11-19');
    ok('History: only the printer on screen, only the days asked for', got.length === 3 && got.every(r => r.printerCode === 'P1'), JSON.stringify(got.map(r => [r.day, r.printerCode])));
    ok('…with what came added up by fabric: Cambric 60 4 pcs · Sheeting 82 7.5 m', JSON.stringify(H.vprHistTotals(got)) === '[{"fab":"Cambric 60","unit":"pcs","q":4},{"fab":"Sheeting 82","unit":"m","q":7.5}]', JSON.stringify(H.vprHistTotals(got)));
    Object.assign(H.VPR_HIST, { from: '2026-10-20', to: '2026-11-19' });
    const html = H.vprHistHtml();
    ok('…the window lists each receipt with challan, order, item, fabric, qty and who took it in, and offers Excel', /RFD-1/.test(html) && /SHP-1/.test(html) && /Pillow/.test(html) && /<b>Sheeting 82<\/b>/.test(html) && /<b>5 m<\/b>/.test(html) && /challan/.test(html) && /data-vprhxl="1"(?![^>]*disabled)/.test(html), html.slice(0, 800));
    Object.assign(H.VPR_HIST, { from: '2026-01-01', to: '2026-01-31' });
    ok('…no receipt on those days: it says so, and Excel is off', /Nothing was received/.test(H.vprHistHtml()) && /data-vprhxl="1" [^>]*disabled/.test(H.vprHistHtml()));
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
    ok('…it then counts, and the list is empty', A.flowExtraAsks().length === 0 && A.vpVsSum(Object.values(A.ctx.VO.rows[0].vSent)) === 6);
    ok('…on a new copy of the order in a new list (what may still be received is worked out again), the old one untouched', A.ctx.VO.rows[0] !== o1 && !o1.vSent.w.approved);
    const N = load({ vo: [order()], me: { admin: false } });
    ok('a non-admin cannot approve', /Only an admin/.test(await N.flowExtraAnswer('P1|o1|w', true)) && !N.puts.length);
    const o2 = order(), Rj = load({ vo: [o2], me: { admin: true } });
    await Rj.flowExtraAnswer('P1|o1|w', false);
    ok('Reject writes rejected; the extra never counts', Rj.puts[0][0].endsWith('/w/rejected') && Rj.vpVsSum(Object.values(Rj.ctx.VO.rows[0].vSent)) === 4);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
