/* FBA ONLY BY LIST (28 Nov: with FBA lists on, ticking SKUs on Finished Goods and making a list is the one way to FBA).
 * Every other way is refused at the save and no longer offered; taking pieces back still works. Off, all as before.
 *   node tests/fba-only-test.js      (teeth/teeth-fba-only.js runs it against broken copies) */
const { whole, appFile, NOW, HOUR, iso, row, sent, store, scanHead, editStore, movement, counts, check: ok, line } = require('./india-store-harness');

const SAYS = /tick the SKUs on Finished Goods and press Make FBA list/;
const OTHER = 'inventory/fg-other-movements.js', SCAN = 'inventory/fg-scanning.js', CORR = 'inventory/fg-corrections.js', EDIT = 'inventory/fg-change-remove.js';
const lists = (S, sw = '1') => { S.run(appFile('inventory/fba-lists.js')); S.saved.fbaList = sw; return S; };
/* the repeat rule, as an ordinary account unless o.approver */
function repeat(S, o = {}) {
  Object.assign(S.ctx, { spIsVendor: () => false, ptDtMs: () => 0 });
  S.ctx.ME = { email: 'store@test', admin: false, fbaRepeatApprove: !!o.approver };
  S.run(line('core/helpers.js', 'const dTodayIndia') + line('core/helpers.js', 'const dAdd') + line('core/helpers.js', 'const ptDayWords')
    + line(EDIT, 'const fgiDmy') + 'const ptIsoDate = d => String(d || "").split("/").reverse().join("-");\n' + appFile('inventory/fg-fba-repeat.js'));
  S.boxes = [];
  S.ctx.fapAsk = async text => { S.boxes.push(text); return true; };
  S.requests = () => Object.values(S.db._fbaRepeat || {});
  return S;
}
const lately = () => [row('O', 'OPENING', 20), sent('R', 1, { createdAt: iso(NOW - 48 * HOUR) })];   // A went to FBA two days ago
const moved = S => S.patches.flatMap(p => Object.keys(p)).filter(k => k.startsWith('pt_fgiLedger/'));

/** A screen whose dialogs are kept, with the movement types as the app has them. */
function screen(sw, o) {
  const S = lists(store(o), sw);
  const shown = [];
  const box = S.ctx.$;
  S.ctx.$ = id => Object.assign(box(id), { addEventListener() {} });
  Object.assign(S.ctx, { ptOpenDialog: d => shown.push(d), dToday: () => '2026-11-28', fgiMaster: () => ({}), fgiOrdFill: () => [], FN: { n: 0 },
    fgiScanRender() {}, fgiIsMarker: () => false, ptIsoDate: () => '', ptPut: async (p, v) => S.writes.push({ [p]: v }) });
  S.run(appFile(OTHER) + whole(SCAN, 'fgiScanOpen') + whole(SCAN, 'fgiScanHead') + appFile(CORR) + whole(EDIT, 'fgiEditOpen') + whole(EDIT, 'fgiEditLocked'));
  /* the types a dialog offers, from its drawn drop-down */
  S.offered = (open, id) => {
    shown.length = 0;
    open();
    const html = (shown[0] || {}).html || '', at = html.indexOf(`id="${id}"`);
    return (html.slice(at, html.indexOf('</select>', at)).match(/value="[A-Z_]+"/g) || []).map(v => v.slice(7, -1)).join();
  };
  S.shown = shown;
  return S;
}
const mine = (txnType, qty, over) => movement(txnType, qty, Object.assign({ createdBy: 'store@test' }, over));

(async () => {
  console.log('== what the forms offer ==');
  {
    const on = screen('1'), off = screen('0');
    const entry = S => S.offered(() => S.ctx.fgiEntryOpen('RECEIVE', ''), 'fgmType');
    ok('stock entry: no Send to FBA', entry(on) === 'RECEIVE,ISSUE', entry(on));
    ok('…and says where to go', SAYS.test(on.shown[0].note));
    ok('stock entry, switch off: as before', entry(off) === 'RECEIVE,ISSUE,FBA' && !SAYS.test(off.shown[0].note), entry(off));
    const scan = S => S.offered(() => S.ctx.fgiScanOpen(), 'fgsType');
    ok('scanning: no Send to FBA', scan(on) === 'RECEIVE,ISSUE', scan(on));
    ok('scanning, switch off: as before', scan(off) === 'RECEIVE,ISSUE,FBA');
    for (const [txnType, expected] of [['ISSUE', 'RECEIVE,ISSUE'], ['FBA', 'RECEIVE,ISSUE,FBA']]) {
      const rows = [row('O', 'OPENING', 20), mine(txnType, 2)];
      const S = screen('1', { rows });
      ok(`edit of a${txnType === 'FBA' ? 'n FBA' : 'n issue'} row`, S.offered(() => S.ctx.fgiEditOpen('F'), 'fgeType') === expected);
      S.ctx.ME = { email: 'store@test' };
      S.ctx.fgiCanEdit = () => false;
      ok(`correction request on a${txnType === 'FBA' ? 'n FBA' : 'n issue'} row`, S.offered(() => S.ctx.fgiCorrOpen('F'), 'fgcType') === expected);
    }
    const E = screen('0', { rows: [row('O', 'OPENING', 20), mine('ISSUE', 2)] });
    ok('edit, switch off: as before', E.offered(() => E.ctx.fgiEditOpen('F'), 'fgeType') === 'RECEIVE,ISSUE,FBA');
  }

  console.log('== the entry form ==');
  {
    const save = async (S, type) => {
      Object.entries({ fgmType: type, fgmSku: 'A', fgmQty: '2', fgmWho: 'x', fgmFbaAcct: 'Ridhi FBA' }).forEach(([k, v]) => { S.box(k).value = v; });
      return S.ctx.fgiEntrySave();
    };
    const S = repeat(screen('1', { rows: lately() }));
    const said = await save(S, 'FBA');
    ok('a save to FBA is refused with where to go', SAYS.test(said), said);
    ok('…before anything is asked, read or written', S.boxes.length === 0 && S.requests().length === 0 && S.writes.length === 0 && S.reads.length === 0);
    const I = repeat(screen('1'));
    ok('an issue still saves', await save(I, 'ISSUE') === '' && I.writes.length === 1);
  }

  console.log('== scanning ==');
  {
    const S = screen('1');
    Object.entries({ fgsType: 'FBA', fgsAcct: 'Ridhi FBA' }).forEach(([k, v]) => { S.box(k).value = v; });
    ok('a scan to FBA is refused', SAYS.test(S.ctx.fgiScanHead().err || ''));
    S.box('fgsType').value = 'ISSUE';
    S.box('fgsWho').value = 'x';
    ok('a scan to issue is not', S.ctx.fgiScanHead().err === '');
    const off = screen('0');
    Object.entries({ fgsType: 'FBA', fgsAcct: 'Ridhi FBA' }).forEach(([k, v]) => { off.box(k).value = v; });
    ok('switch off: as before', off.ctx.fgiScanHead().err === '');
  }

  console.log('== repeat FBA requests ==');
  {
    const N = lists(repeat(store({ rows: lately() })));
    N.ctx.fresh = [row('n', 'FBA', 2)];
    const gate = await N.run('fapGate(fresh, "S")');
    ok('no new request is asked for', SAYS.test(gate.stop || '') && N.boxes.length === 0 && N.requests().length === 0 && N.writes.length === 0, gate.stop);

    const waiting = { sku: 'A', qty: 2, status: 'waiting', askedBy: 'amy@test', askedAt: iso(NOW), recent: [], row: row('W', 'FBA', 2, { issuedFor: 'Ridhi FBA' }) };
    const H = lists(repeat(store({ rows: lately(), requests: { W: waiting } }), { approver: true }));
    const said = await H.ctx.fapApprove('W');
    ok('an earlier request cannot be approved, and is not claimed', SAYS.test(said) && /reject it/.test(said) && H.writes.length === 0 && H.db._fbaRepeat.W.status === 'waiting', said);
    await H.ctx.fapReread();
    H.run('fapRender()');
    const html = H.box('fgTable').innerHTML;
    ok('the list offers Reject only', html.includes('data-fapno="W"') && !html.includes('data-fapok'));
    ok('…and says what to do', SAYS.test(H.box('fgMsg').textContent));
    ok('it can be rejected', await H.ctx.fapReject('W', 'Make a list') === '' && H.db._fbaRepeat.W.status === 'rejected');
    const off = lists(repeat(store({ rows: lately(), requests: { W: waiting } }), { approver: true }), '0');
    await off.ctx.fapReread();
    off.run('fapRender()');
    ok('switch off: Approve is there', off.box('fgTable').innerHTML.includes('data-fapok="W"') && !SAYS.test(off.box('fgMsg').textContent));
  }

  console.log('== edits ==');
  {
    const edit = async (r, input, o = {}) => {
      const S = lists(repeat(editStore({ rows: [row('O', 'OPENING', 20), r].concat(o.more || []) })), o.sw);
      S.ctx.ME = { email: 'store@test', admin: false };
      return { S, said: await S.ctx.fgiEditApply('F', input) };
    };
    const raised = await edit(movement('FBA', 2), { qty: 3 }, { more: [sent('R', 1)] });
    ok('more pieces: refused with where to go, not "send the extra as a new entry"', SAYS.test(raised.said) && moved(raised.S).length === 0, raised.said);
    ok('an issue turned into FBA: refused', SAYS.test((await edit(movement('ISSUE', 2), { txnType: 'FBA', who: 'Ridhi FBA' })).said));
    const other = await edit(movement('FBA', 2), { sku: 'B' }, { more: [row('B', 'OPENING', 20, { sku: 'B' })] });
    ok('another SKU on an FBA row: refused', moved(other.S).length === 0 && other.said !== '', other.said);
    ok('fewer pieces: saved', (await edit(movement('FBA', 3), { qty: 2 })).said === '');
    ok('the date: saved', (await edit(movement('FBA', 2), { remarks: 'checked' })).said === '');
    ok('FBA turned into an issue: saved', (await edit(movement('FBA', 2), { txnType: 'ISSUE', who: 'x' })).said === '');
    const as = await edit(movement('FBA', 2), { qty: 3 }, { sw: '0' });
    ok('switch off: the repeat rule answers, as before', /ask the approver/.test(as.said), as.said);
  }

  console.log('== asking for a correction ==');
  {
    const ask = async (r, boxes, sw = '1') => {
      const S = screen(sw, { rows: [row('O', 'OPENING', 20), r] });
      S.ctx.ME = { email: 'store@test' };
      S.ctx.fgiCanEdit = () => false;
      const form = Object.assign({ fgcKind: 'edit', fgcType: r.txnType, fgcSku: 'A', fgcQty: String(r.qty), fgcWho: 'x', fgcDate: '', fgcOrd: '', fgcReason: '', fgcWhy: 'typed wrong' }, boxes);
      Object.entries(form).forEach(([k, v]) => { S.box(k).value = v; });
      S.ctx.ptGet = async () => ({});
      /* the row's date box shows the day it was made when it has none */
      S.box('fgcDate').value = String(r.createdAt).slice(0, 10);
      return { S, said: await S.ctx.fgiCorrSave('F') };
    };
    const more = await ask(mine('FBA', 2), { fgcQty: '3' });
    ok('more pieces to FBA: not taken', SAYS.test(more.said) && more.S.writes.length === 0, more.said);
    ok('an issue to become FBA: not taken', SAYS.test((await ask(mine('ISSUE', 2), { fgcType: 'FBA' })).said));
    const fewer = await ask(mine('FBA', 3), { fgcQty: '2' });
    ok('fewer pieces: asked', fewer.said === '' && fewer.S.writes.length === 1, fewer.said);
    ok('removing the entry: asked', (await ask(mine('FBA', 2), { fgcKind: 'delete' })).said === '');
    ok('switch off: as before', (await ask(mine('FBA', 2), { fgcQty: '3' }, '0')).said === '');
  }

  console.log('== packing outside a list ==');
  {
    const S = lists(store());
    S.run(appFile('replenishment/pack-core.js'));
    S.ctx.old = { id: 'P', account: 'Ridhi FBA', boxes: [{ n: 1, items: [{ sku: 'A', qty: 1 }] }] };
    const said = (await S.run('packLedgerWrite(old, "")')).err || '';
    ok('an old packing list says to make an FBA list, and nothing leaves', /Tick the SKUs on Finished Goods and press Make FBA list/.test(said) && S.writes.length === 0, said);
  }

  console.log('== taking pieces back ==');
  {
    const S = lists(store());
    S.ctx.wrote = 0;
    const said = await S.run('fgiFbaWrite(fgiFbaReturnWants([{ _id: "R", txnType: "FBA_RETURN", sku: "A", qty: 1, linkedFbaId: "F" }]), async () => { wrote++; })');
    ok('a return can still be taken out', said === '' && S.ctx.wrote === 1, said);
    const refused = await S.run('fgiFbaWrite([{ sku: "A", qty: 1, current: 20 }], async () => { wrote++; })');
    ok('any other new FBA is refused', SAYS.test(refused) && S.ctx.wrote === 1, refused);
  }

  const { pass, fail } = counts();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL the suite stopped - ' + e.stack); process.exit(1); });
