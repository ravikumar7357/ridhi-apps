/* WHOEVER REJECTS PIECES SAYS WHY, the entry forms (Ravi, 27 Nov). Switch lineHold on: a reason is asked ("Other" with a note)
 * and written on the Job Work row (rejections/<id>) or the QC check (rejWhy, rejNote); pieces still wrong after alteration,
 * spotting or touching become a QC rejection on an order. Switch off: nothing new is asked or written.
 * (src/app/production/reject-reason.js and the forms that use it.) Cases are made up.
 *   node tests/rejected-reason-test.js      (REASON_APP=<folder like src/app> tests another copy)
 * The last part breaks copies of the code and expects this file to fail on each. */
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), cp = require('child_process');
const APP = process.env.REASON_APP || path.join(__dirname, '..', 'src', 'app');
const src = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
function cut(file, startRe, end) {
  const s = src(file), i = s.search(startRe);
  if (i < 0) throw new Error(String(startRe) + ' not found in ' + file);
  return s.slice(i, s.indexOf(end || '\n}', i) + (end || '\n}').length);
}
const R = 'production/reject-reason.js', W = 'production/whatsapp.js', J = 'production/job-work-corrections.js', Q = 'production/quality-control.js';
const CODE = [cut('core/history.js', /^function lineHoldOn\(/m), cut('core/history.js', /^const REJ_REASONS/m, ';'), src(R),
  cut(W, /^function bdApplyRej\(/m), cut(J, /^function jwCorrPlan\(/m), cut(J, /^async function jwCorrApprove\(/m),
  cut(Q, /^function qcEditCheck\(/m), cut(Q, /^function qcCorrectable\(/m), cut(Q, /^async function qcInboxCorrect\(/m),
  cut(Q, /^const QC_DRAFTS/m, ';'), cut(Q, /^const qcDraftId/m, '\n'), cut(Q, /^const qcPcs/m, '\n'), cut(Q, /^const qcNewCheckId/m, '\n'),
  cut(Q, /^function qcRetMsg\(/m, '\n'), cut(Q, /^function qcRetInfo\(/m), cut(Q, /^async function qcSaveReturn\(/m),
  cut(Q, /^const qcUnfinishedOrders/m, '\n'), cut(Q, /^function qcScrapOrderOf\(/m), cut(Q, /^const qcScrapNotReady/m, '\n'), cut(Q, /^function qcAltScrapChecks\(/m), cut(Q, /^function qcWriteReturn\(/m), cut(Q, /^const qcScrapNote/m, ';'),
  cut(Q, /^function qcCheckRecords\(/m), cut(Q, /^function qcInboxRefusal\(/m), cut(Q, /^async function qcDeptBack\(/m),
  cut('core/line-hold.js', /^const LINE_HOLD_DRAFT_MS/m, ';'), cut('core/line-hold.js', /^function lineHoldDraftId\(/m), cut('core/line-hold.js', /^function lineHoldDraftDone\(/m, '\n')].join('\n');

/** One PC. o: { off, orders: the SKU's order lines of 10 pieces, each { orderNo, date, pressed?, open? } } */
function screen(o) {
  o = o || {};
  const boxes = {}, writes = [], nothing = () => {};
  const box = id => boxes[id] || (boxes[id] = { value: '', textContent: '', innerHTML: '', className: '', disabled: false, hidden: null,
    classList: { toggle(c, on) { boxes[id].hidden = !!on; } } });
  const up = s => String(s || '').trim().toUpperCase();
  const orders = o.orders || [{ orderNo: 'OC-NEW', date: '2026-11-20' }, { orderNo: 'OC-OLD', date: '2026-11-01' }];
  const ctx = {
    ordLines: () => orders.map(l => Object.assign({ sku: 'MADE-UP', qty: 10, pressed: 0, open: true }, l)),
    ptOpenDialog: cfg => { ctx.__dlg = cfg; }, qcDeptEmps: () => [], qcAvailToCheck: () => 99, qcIssuedTotal: () => 0, qcAltTotal: () => 0,
    qcInboxStatuses: () => [{ r: { id: 'b1', sku: 'MADE-UP', orderNo: 'OC-NEW' }, since: 20, accepted: ctx.QC.checks.reduce((t, c) => t + (c.checked || 0), 0) }],
    ptStampFrom: (a, b) => b, JWC: { rows: {} }, PT: { base: [] }, JWC_ADMIN_ONLY: [], jwCorrBadge: nothing, qcTookOf: () => 0, whoShort: e => String(e).split('@')[0],
    console, $: box, nf: String, esc: s => String(s).replace(/[<>&"]/g, '_'), obUC: up, qcNorm: up, ptNum: v => Number(v) || 0,
    ME: { email: 'qc@test', admin: true }, localStorage: { getItem: k => (k === 'lineHold' && !o.off ? '1' : null) },
    ptCanEdit: () => true, ptNumErr: () => '', ptDateErr: () => '', ptDateOrderErr: () => '', ptIsoDate: () => '', ptNow: () => '27/11/2026, 10:00', ptStampDate: () => '27/11/2026, 10:00',
    ptDtMs: d => Date.parse(d) || 0, prOn: () => false, cutOrdersFor: () => orders,
    ptPut: async (p, v) => { writes.push({ [p]: v }); }, ptPatch: async v => { writes.push(v); },
    frmRemember: nothing, renderQc: nothing, renderQcRetForm: nothing, qcParts: () => ({}), qcMyName: () => 'qc', qcSendRemark: d => 'sent to ' + d,
    QC: { checks: [], ret: [], issue: [{ id: 'i1', sku: 'MADE-UP', employee: 'Made-up Tailor', pieces: 10 }] }, QC_DEPTS: { spotting: 'Spotting', touching: 'Touching' },
    QC_SPLIT: ['passed', 'forAlteration', 'rejected', 'spotting', 'touching'], qcCheckedOf: e => ['passed', 'rejected'].reduce((t, k) => t + (+e[k] || 0), 0),
    qcPendingOf: r => 10 - ctx.QC.ret.reduce((t, x) => t + x.received, 0), qcRetOf: () => 0,
    qcDeptRows: () => [{ c: { id: 's1', sku: 'MADE-UP', orderNo: o.sendOrder === undefined ? 'OC-NEW' : o.sendOrder, baseId: 'b1' }, dept: 'spotting', left: 3 }],
    qcSaveHeld: async s => { await s.write(); return ''; }, cutSkuOf: () => null, bdGuard: () => '',
  };
  vm.createContext(ctx);
  vm.runInContext(CODE + '\nthis.rejEditPcs = rejEditPcs;', ctx);
  const comeBack = async (got, bad, why, note) => {
    Object.entries({ qcrPick: 'i1', qcrBy: 'qc', qcrPcs: got, qcrOk: got - bad, qcrRej: bad, qcrRemarks: '', qcrWhy: why || '', qcrNote: note || '' })
      .forEach(([id, v]) => { box(id).value = String(v); });
    await ctx.qcSaveReturn();
    return box('qcrMsg').textContent;
  };
  return { ctx, box, writes, comeBack };
}
const row = o => Object.assign({ id: 'b1', sku: 'MADE-UP', empName: 'Made-up Karigar', issuePieces: 20, receivedPieces: 10, rejectionPieces: 0, pendingPieces: 10 }, o);
const lines = r => Object.values(r.rejections || {});
const stain = { why: 'Stain', note: '' };

(async () => {
  console.log('== the Job Work receive ==');
  { const a = screen().ctx, was = row();
    ok('rejecting without a reason is refused', /Pick why the 3 piece/.test(a.bdApplyRej(was, 3).err || ''));
    ok('a reason that is not on the list is refused', !!a.bdApplyRej(was, 3, { why: 'Bad', note: '' }).err);
    ok('"Other" without a note is refused', /short note/.test(a.bdApplyRej(was, 3, { why: 'Other', note: '' }).err || ''));
    const r = a.bdApplyRej(was, 3, { why: 'Other', note: 'made-up note' }).row, l = lines(r)[0];
    ok('written as rejections/<id> = at, pcs, why, note, by', lines(r).length === 1 && l.pcs === 3 && l.why === 'Other' && l.note === 'made-up note' && l.by === 'qc@test' && /^\d{4}-.*Z$/.test(l.at), JSON.stringify(r.rejections));
    ok('the total stays rejectionPieces; the row handed in is untouched', r.rejectionPieces === 3 && r.pendingPieces === 7 && !was.rejections && was.rejectionPieces === 0);
    const more = a.bdApplyRej(r, 5, stain).row;
    ok('a further rejection logs only what is new', more.rejectionPieces === 5 && lines(more).length === 2 && lines(more).reduce((t, x) => t + x.pcs, 0) === 5);
    ok('no note given, no note field', lines(more).some(x => x.why === 'Stain' && !('note' in x)));
    const less = a.bdApplyRej(more, 4).row;
    ok('lowering needs no reason and the log comes down with it', lines(less).reduce((t, x) => t + x.pcs, 0) === 4 && lines(more).reduce((t, x) => t + x.pcs, 0) === 5, JSON.stringify(less.rejections));
    ok('lowered to none: the log is empty', lines(a.bdApplyRej(more, 0).row).length === 0); }
  { const a = screen().ctx;
    const r = row({ rejectionPieces: 2, pendingPieces: 8, rejections: { old: { at: '2026-11-26T00:00:00Z', pcs: 5, why: 'Stain' } } });
    const n = a.bdApplyRej(r, 4, { why: 'Wrong size', note: '' }).row;
    ok('a log left too long is brought down before the new pieces are added', n.rejections.old.pcs === 2 && lines(n).reduce((t, x) => t + x.pcs, 0) === 4, JSON.stringify(n.rejections)); }

  console.log('== a correction ==');
  { const a = screen().ctx;
    ok('raising the rejects without a reason is refused', /Pick why/.test(a.jwCorrPlan(row(), { rejectionPieces: '2' }).err || ''));
    const p = a.jwCorrPlan(row(), { rejectionPieces: '2', rejWhy: 'Stain' }, 'asker@test');
    ok('the reason is logged under whoever rejected', lines(p.next)[0].by === 'asker@test' && lines(p.next)[0].pcs === 2, JSON.stringify(p));
    ok('another change needs no reason', !a.jwCorrPlan(row({ rejectionPieces: 2, pendingPieces: 8 }), { remarks: 'x' }).err); }

  console.log('== QC pass window and check edit ==');
  { const a = screen().ctx, x = { r: row(), wait: 5 };
    ok('rejected pieces without a reason are refused', /Pick why/.test(a.qcInboxRefusal(x, { passed: 3, rejected: 2 })));
    ok('passing alone asks nothing', a.qcInboxRefusal(x, { passed: 3 }) === '');
    const c = a.qcCheckRecords(x.r, { passed: 3, rejected: 2, spotting: 1, rejWhy: 'Print fault', rejNote: '' }, 'd');
    ok('the check carries rejWhy beside rejected; the send does not', c[0].rejWhy === 'Print fault' && !('rejNote' in c[0]) && !('rejWhy' in c[1]), JSON.stringify(c));
    ok('an old rejection may stay without a reason on edit', a.rejEditPcs({ rejected: 2 }, 2, { why: '' }) === 0);
    ok('raising an old one is refused; one that had a reason still needs one', !!a.rejOldErr({ rejected: 2 }, 3, { why: '' }) && a.rejEditPcs({ rejected: 2, rejWhy: 'Stain' }, 2, { why: '' }) === 2 && a.rejOldErr({ rejected: 2, rejWhy: 'Stain' }, 3, { why: '' }) === '');
    const was = { rejected: 2, rejWhy: 'Other', rejNote: 'n' };
    const upd = a.rejWhyOnEdit(was, stain);
    ok('edit updates the reason and drops the old note', upd.rejWhy === 'Stain' && !('rejNote' in upd) && was.rejNote === 'n');
    ok('edit to no rejects drops the reason', !('rejWhy' in a.rejWhyOnEdit({ rejected: 0, rejWhy: 'Stain' }, stain))); }

  console.log('== back from alteration ==');
  { const a = screen();
    const said = await a.comeBack(5, 2);
    ok('still wrong without a reason: nothing saved', a.writes.length === 0 && /Pick why/.test(said), said);
    const done = await a.comeBack(5, 2, 'Stain'), w = a.writes[0] || {}, chk = Object.keys(w).filter(k => k.startsWith('pt_qcChecks/')).map(k => w[k])[0] || {};
    ok('one update writes the return and one QC rejection', a.writes.length === 1 && Object.keys(w).length === 2, JSON.stringify(a.writes));
    ok('…on the oldest order, with its reason, counting nothing as checked or passed', chk.orderNo === 'OC-OLD' && chk.rejected === 2 && chk.rejWhy === 'Stain' && chk.checked === 0 && chk.ok === 0 && chk.forAlteration === 0 && !chk.baseId && !!chk.altReturnId, JSON.stringify(chk));
    ok('…held on screen once, and the screen says where', a.ctx.QC.checks.length === 1 && a.ctx.QC.ret.length === 1 && /2 scrapped on OC-OLD/.test(done), done); }
  { const a = screen(); await a.comeBack(3, 0);
    ok('all mended: the return alone, no reason asked', a.writes.length === 1 && Object.keys(a.writes[0])[0].startsWith('pt_qcReturns/') && a.ctx.QC.checks.length === 0); }
  { const a = screen({ orders: [] }), said = await a.comeBack(2, 1, 'Stain');
    ok('a SKU on no order: the return alone, and the screen says so', a.writes.length === 1 && a.ctx.QC.checks.length === 0 && /No order of MADE-UP is unfinished/.test(said), said); }
  const made = { orderNo: 'OC-OLD', date: '2026-11-01', pressed: 10 }, closed = { orderNo: 'OC-SHUT', date: '2026-10-01', open: false };
  { const a = screen({ orders: [made, closed, { orderNo: 'OC-NEW', date: '2026-11-20', pressed: 9 }] }); await a.comeBack(2, 1, 'Stain');
    ok('an order made in full or closed is passed over for the oldest unfinished one', a.ctx.QC.checks[0].orderNo === 'OC-NEW', JSON.stringify(a.ctx.QC.checks)); }
  { const a = screen({ orders: [made, closed] }), said = await a.comeBack(2, 1, 'Stain');
    ok('none unfinished: the return is saved, nothing is cut again', a.writes.length === 1 && a.ctx.QC.checks.length === 0 && /unfinished/.test(said), said); }

  console.log('== old rejections never become scrap ==');
  const check = o => Object.assign({ id: 'q1', sku: 'MADE-UP', baseId: 'b1', checked: 5, ok: 3, rejected: 2, date: '2026-11-20' }, o);
  const edit = async (c, v, opts) => { const a = screen(opts); a.ctx.QC.checks = [c]; a.ctx.qcEditCheck('q1');
    const said = await a.ctx.__dlg.onSave(Object.assign({ checked: '5', forAlteration: '0', rejected: '2' }, v));
    return { a, said, boxes: a.ctx.__dlg.fields.some(f => f.key === 'rejWhy'), saved: a.ctx.QC.checks[0] }; };
  { const up = await edit(check(), { rejected: '3' }), why = await edit(check(), { rejWhy: 'Stain' }), same = await edit(check(), { remarks: 'x' });
    ok('check edit: no reason boxes on an old rejection', !up.boxes);
    ok('raising it is refused: record a new QC check', /These 2 rejected pieces were recorded before .* new QC check/.test(up.said) && up.a.writes.length === 0, up.said);
    ok('giving it a reason is refused', /recorded before a reason/.test(why.said) && why.a.writes.length === 0, why.said);
    ok('another change saves, still without a reason', same.said === '' && !('rejWhy' in same.saved), same.said); }
  { const r = await edit(check({ rejWhy: 'Stain' }), { rejected: '3', rejWhy: 'Stain' });
    ok('a check that has a reason keeps its boxes and may be raised', r.boxes && r.said === '' && r.saved.rejected === 3 && r.saved.rejWhy === 'Stain', r.said); }
  { const r = await edit(check(), { rejected: '3' }, { off: true });
    ok('switch off: edited as before', r.said === '' && r.saved.rejected === 3, r.said); }
  const correct = async (checks, v, opts) => { const a = screen(opts); a.ctx.QC.checks = checks;
    return { a, said: await a.ctx.qcInboxCorrect('b1', Object.assign({ passed: '6', rejected: '4' }, v)) }; };
  const two = (first, second) => [check(first), check(Object.assign({ id: 'q2' }, second))];
  { const mixed = await correct(two({}, { rejWhy: 'Stain' }), { rejWhy: 'Stain' });
    ok('a correction of reasoned and old rejections together is refused', /cannot be corrected as one check. Ask Ravi/.test(mixed.said) && mixed.a.writes.length === 0, mixed.said);
    ok('…and borrows no reason for the merged total', mixed.a.ctx.qcCorrectable(mixed.a.ctx.qcInboxStatuses()[0]).values.rejWhy === '');
    const up = await correct(two({}, {}), { rejected: '5' }), why = await correct(two({}, {}), { rejWhy: 'Stain' }), same = await correct(two({}, {}), {});
    ok('old rejections raised or given a reason in a correction: refused', /recorded before a reason/.test(up.said) && /recorded before a reason/.test(why.said), up.said + why.said);
    ok('old rejections corrected without either stay without a reason', same.said === '' && same.a.ctx.QC.checks.every(c => !c.rejWhy), same.said);
    const all = await correct(two({ rejWhy: 'Stain' }, { rejWhy: 'Stain' }), {});
    ok('all with a reason: corrected, the reason kept', all.said === '' && all.a.ctx.QC.checks[0].rejWhy === 'Stain', all.said);
    const off = await correct(two({}, { rejWhy: 'Stain' }), {}, { off: true });
    ok('switch off: a mixed entry is corrected as before', off.said === '', off.said); }

  console.log('== an old correction request ==');
  const approve = async (change, opts) => { const a = screen(opts); a.ctx.PT.base = [row()];
    a.ctx.JWC.rows = { c1: { id: 'c1', rowId: 'b1', status: 'pending', by: 'asker@test', change } };
    return { a, said: await a.ctx.jwCorrApprove('c1') }; };
  { const r = await approve({ rejectionPieces: '2' });
    ok('raising rejects with no reason: refused, naming who asked', r.said === 'This request was sent before a reason was asked for rejected pieces — reject it and ask asker to send it again with the reason.' && r.a.writes.length === 0, r.said);
    const given = await approve({ rejectionPieces: '2', rejWhy: 'Stain' }), off = await approve({ rejectionPieces: '2' }, { off: true }), other = await approve({ remarks: 'x' });
    ok('with a reason, with the switch off, or no new rejects: approved', given.said === '' && off.said === '' && other.said === '', given.said + off.said + other.said); }
  { const a = screen(); a.box('qcrRej').value = '2'; a.ctx.qcRetInfo(); const shown = a.box('qcrWhy').hidden === false;
    a.box('qcrRej').value = ''; a.ctx.qcRetInfo();
    ok('the boxes show only while pieces are still wrong', shown && a.box('qcrWhy').hidden === true); }

  console.log('== spotting / touching ==');
  { const a = screen();
    ok('reject without a reason is refused', /Pick why/.test(await a.ctx.qcDeptBack('s1', 2, true)) && a.writes.length === 0);
    await a.ctx.qcDeptBack('s1', 2, true, stain);
    const c = Object.values(a.writes[0])[0];
    ok('one record: the rejection with its reason, on the send\'s own order', a.writes.length === 1 && c.rejected === 2 && c.rejWhy === 'Stain' && c.orderNo === 'OC-NEW', JSON.stringify(a.writes));
    await a.ctx.qcDeptBack('s1', 1, false);
    ok('coming back passed asks nothing', !('rejWhy' in Object.values(a.writes[1])[0])); }
  { const a = screen({ sendOrder: '' }); await a.ctx.qcDeptBack('s1', 1, true, stain);
    ok('a send with no order is scrapped on the SKU\'s oldest order', Object.values(a.writes[0])[0].orderNo === 'OC-OLD'); }

  console.log('== switch off ==');
  { const a = screen({ off: true }), c = a.ctx;
    const r = c.bdApplyRej(row(), 3, stain);
    ok('Job Work: saved as before, no log', !r.err && !('rejections' in r.row));
    ok('correction: the same', !('rejections' in c.jwCorrPlan(row(), { rejectionPieces: '2' }).next));
    ok('QC pass: no reason asked', c.qcInboxRefusal({ r: row(), wait: 5 }, { rejected: 2 }) === '');
    await a.comeBack(5, 2, 'Stain'); await c.qcDeptBack('s1', 1, true);
    ok('alteration and spotting write only what they did before', a.writes.length === 2 && Object.keys(a.writes[0]).length === 1 && c.QC.checks.length === 1 && !('rejWhy' in c.QC.checks[0]), JSON.stringify(a.writes));
    ok('no boxes in a dialog', c.rejWhyFields().length === 0 && c.rejWhyHtml('x') === ''); }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail || process.env.REASON_APP) process.exit(fail ? 1 : 0);
  teeth();
})().catch(e => { console.error(e); process.exit(1); });

/** Each broken copy must make this file fail. */
function teeth() {
  const BREAKS = [
    ['the reason is not required', R, "if (!REJ_REASONS.includes(reason.why)) return", "if (false) return"],
    ['"Other" needs no note', R, "reason.why === 'Other' && !reason.note", 'false'],
    ['the switch is ignored', R, 'lineHoldOn() && pcs > 0', 'pcs > 0'],
    ['the log is not brought down', R, 'rejLogTrimmed(row.rejections, Math.min(before, rejected))', 'row.rejections'],
    ['Job Work writes no log', W, ', rejLogFor(row, rej, reason));', ');'],
    ['alteration records no rejection', Q, 'if (!orderNo) return [];', 'return [];'],
    ['alteration picks the newest order', Q, '(ptDtMs(a.date) - ptDtMs(b.date)) || a.orderNo', '(ptDtMs(b.date) - ptDtMs(a.date)) || a.orderNo'],
    ['an old rejection may be edited into scrap', R, 'if (!lineHoldOn() || !rejWasOld(before)', 'if (true || !rejWasOld(before)'],
    ['an old check shows the reason boxes', Q, '...(rejWasOld(r) ? [] : rejWhyFields(r)),', '...rejWhyFields(r),'],
    ['a mixed correction goes through', Q, 'if (lineHoldOn() && fix.mixed)', 'if (false)'],
    ['a correction borrows one reason for all', Q, 'rejWhyOf(mixed ? null : reasoned[0])', 'rejWhyOf(reasoned[0])'],
    ['a correction forgets the old-rejection rule', Q, 'rejOldErr(fix.values, rejected, reason) || ', ''],
    ['scrap goes on a finished order', Q, ' && l.open && l.pressed < l.qty', ''],
    ['an old request is not told apart', J, '&& !rejWhyOf(q.change).why)', '&& false)'],
    ['spotting drops the reason', Q, 'rejected, ...rejWhySaved(rejected, reason),', 'rejected,'],
  ];
  let missed = 0;
  console.log('\n== broken copies ==');
  BREAKS.forEach(([name, file, from, to]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reason-'));
    ['core/history.js', 'core/line-hold.js', R, W, J, Q].forEach(f => {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      const text = src(f);
      if (f === file && !text.includes(from)) throw new Error('break not found: ' + name);
      fs.writeFileSync(path.join(dir, f), f === file ? text.replace(from, () => to) : text);
    });
    const run = cp.spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { REASON_APP: dir }) });
    fs.rmSync(dir, { recursive: true, force: true });
    if (run.status === 0) missed++;
    console.log((run.status === 0 ? '  MISSED ' : '  BITES  ') + name);
  });
  console.log(missed ? `${missed} break(s) missed` : 'every break was caught');
  process.exit(missed ? 1 : 0);
}
