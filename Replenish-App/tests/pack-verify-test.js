/* Pack & verify (src/app/inventory/pack-verify.js): the desktop board on Finished Goods, driven in a stub DOM with the
 * shared rules (pack-core.js) and Scan to pack's helpers (pack-scan.js) loaded as the page loads them.
 *   node tests/pack-verify-test.js      (PKV_SRC=<file> to test another copy — teeth/teeth-pack-verify.js does) */
const fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(f, 'utf8');
const SRC = R(path.join(__dirname, '..', 'src', 'app', 'replenishment', 'pack-core.js')) + '\n'
  + R(path.join(__dirname, '..', 'src', 'app', 'replenishment', 'pack-scan.js')) + '\n'
  + R(process.env.PKV_SRC || path.join(__dirname, '..', 'src', 'app', 'inventory', 'pack-verify.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const up = s => String(s == null ? '' : s).trim().toUpperCase();
const wait = ms => new Promise(r => setTimeout(r, ms));

function load(o) {
  o = o || {};
  const els = {}, saved = [], patches = [], dialogs = [];
  const mk = id => ({ id, value: '', textContent: '', innerHTML: '', className: '', style: {}, disabled: false, _hidden: false,
    classList: { toggle(c, on) { if (c === 'hide') this._el._hidden = on === undefined ? !this._el._hidden : !!on; if (c === 'on') this._el._on = !!on; }, add(c) { if (c === 'hide') this._el._hidden = true; }, remove(c) { if (c === 'hide') this._el._hidden = false; } },
    focus() {}, remove() { delete els[this.id]; }, prepend(h) { this._kids = (this._kids || []).concat([h]); }, insertBefore() {}, parentNode: null, onclick: null, onkeydown: null });
  const el = id => { if (els[id]) return els[id]; if ((o.missing || /^(pkvCloseForm|pkvPlanTa)$/).test(id)) return null;   /* on the page these exist only while drawn */ const e = mk(id); e.classList._el = e; e.parentNode = { insertBefore() {} }; els[id] = e; return e; };
  const lines = o.lines || [{ orderNo: 'OC-1', sku: 'RTC136060', qty: 2 }, { orderNo: 'OC-2', sku: 'RTC136060', qty: 1 }, { orderNo: 'OC-1', sku: 'RQL34-Q', qty: 1 }];
  const store = o.store || { 'OC-1|RTC136060': 2, 'OC-2|RTC136060': 1, 'OC-1|RQL34-Q': 1 };
  const ctx = {
    $: el, document: { createElement: () => { const e = mk('tmp' + Math.random()); e.classList._el = e; return e; }, body: { appendChild() {} }, head: { appendChild() {} } }, window: {}, navigator: {},
    obUC: up, pkNum: v => { const n = Number(v); return isFinite(n) ? n : 0; }, nf: v => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US')),
    esc: s => String(s == null ? '' : s), setTimeout, clearTimeout, confirm: () => true, ME: { email: 'packer@test' },
    FN: { map: new Map([['X0045G8P3B', 'RTC136060'], ['X003ZK2Q9L', 'RCN371-1'], ['X00QL34Q00', 'RQL34-Q']]) }, fnLoad: async () => {},
    replRowMap: () => ({ RTC136060: { subcat: 'Square Tablecloth', size: '60x60', image: 'https://m.media-amazon.com/images/I/81RpvEJa+bL._SL120_.jpg' }, 'RCN371-1': { subcat: 'Napkin', size: '20x20' }, 'RQL34-Q': { subcat: 'Quilt', size: 'Q' } }),
    PTG: { mdb: [{ sku: 'RQL34-Q' }] }, PK_META: {}, mdbOf: sku => ({ RTC136060: { subcat: 'Square Tablecloth', color: 'Blue', size: '60x60' }, 'RCN371-1': { subcat: 'Napkin', color: 'Red', size: '20x20' }, 'RQL34-Q': { subcat: 'Quilt', color: 'Grey', size: 'Q' } })[up(sku)] || null,
    pkLookupSku: sku => ({ RTC136060: { desc: 'Cotton Square Tablecloth 60x60', size: '60x60', material: '100% COTTON', perPcsWt: 0.42 } }[sku] || { desc: 'Cotton ' + sku, size: '', material: '100% COTTON', perPcsWt: 0 }),
    pkTotals: p => ({ boxes: (p.boxes || []).length, qty: (p.boxes || []).reduce((s, b) => s + (b.items || []).reduce((t, i) => t + i.qty, 0), 0) }),
    ptImgOf: () => '', ptImgShared: async () => {}, pkMsg: () => {},
    PK: o.PK || [], PK_LOADED: true, loadPk: async () => {}, loadPkWt: async () => {}, PK_WT: o.wt || { RTC136060: 0.42 }, PK_WT_LOADED: true, savePkWt: async m => { ctx.learned = m; }, PK_DEF: { L: 56, W: 43, H: 28, pkgWt: 1.5, volDiv: 5000, material: '100% COTTON' },
    savePkOne: async p => { if (o.saveFails && o.saveFails()) throw new Error('offline'); saved.push(JSON.parse(JSON.stringify(p))); },
    pkToday: () => '2026-10-12', pkId: () => 'PKV1', renderPack: () => {}, renderFgi: () => { ctx.rendered = (ctx.rendered || 0) + 1; },
    ptOpenDialog: cfg => { dialogs.push(cfg); }, ptDlgClose: () => {},
    FGI: { rows: o.rows || [], err: '' }, fgiLoad: async () => {}, fgiCanEntry: () => o.right !== false, FGI_NO_ENTRY: 'Only somebody with "Can add stock entries"…', FGI_FBA_ACCOUNTS: ['Ridhi FBA', 'CPC FBA'],
    ordLines: () => lines, fgiOrderKnown: no => lines.some(l => l.orderNo === up(no)),
    fgiOutOrders: sku => lines.filter(l => l.sku === up(sku)).map(l => ({ orderNo: l.orderNo, store: store[l.orderNo + '|' + l.sku] || 0 })),
    fgiOf: sku => ({ current: (o.stock || { RTC136060: 3, 'RQL34-Q': 1 })[up(sku)] || 0 }),
    fgiOutCheck: (sku, qty) => qty > ctx.fgiOf(sku).current ? `You don't have enough stock — ${up(sku)}` : '',
    fgiOutAlloc: (sku, n) => ({ orders: [{ orderNo: 'AUTO', qty: n }], loose: 0 }), fgiNewId: p => p + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
    ptPatch: async patch => { if (o.patchFails) throw new Error('offline'); patches.push(patch); }, fbaBadge: () => {}, fgiOverBadge: () => {}, lstAlertFor: async () => '',
    fbaState: r => ({ st: r.fbaShippedAt ? 'shipped' : 'waiting' }),
  };
  const api = new Function(...Object.keys(ctx), SRC + '\n;return { PKV: () => PKV.p, pkvOpen, pkvStart, pkvOnCode, pkvUndo, pkvCloseBox, pkvReopen, pkvFinish, pkvTab, pkvRender, pkvSaveNow, pksFrame, PKS };')(...Object.values(ctx));
  return Object.assign(api, { els, saved, patches, dialogs, ctx });
}
/* open the dialog and start a session the way the person would */
async function start(A, fields) {
  await A.pkvOpen();
  Object.entries(Object.assign({ pkvAcc: 'Ridhi FBA', pkvInv: 'INV7', pkvHand: 'Raju', pkvOrds: 'oc-1, OC-2' }, fields || {})).forEach(([k, v]) => { A.ctx.$(k).value = v; });
  await A.pkvStart();
}

(async () => {
  console.log('== opening and starting ==');
  let A = load({ right: false });
  await A.pkvOpen();
  ok('no stock-entry right: the message, no dialog', A.dialogs.length === 0 && /stock entries/.test(A.els.fgMsg.textContent));
  A = load();
  await A.pkvOpen();
  ok('the dialog opens wide, with the FBA accounts to pick from', A.dialogs.length === 1 && A.dialogs[0].wide === true && /Ridhi FBA/.test(A.dialogs[0].html) && /CPC FBA/.test(A.dialogs[0].html));
  A.ctx.$('pkvOrds').value = 'OC-1, ZZ-9'; await A.pkvStart();
  ok('an order not in the Order Console stops the start', /Not in the Order Console: ZZ-9/.test(A.els.pkvMsg.textContent) && A.saved.length === 0);
  A.ctx.$('pkvOrds').value = ''; await A.pkvStart();
  ok('no order and no plan: stops too', /at least one/.test(A.els.pkvMsg.textContent) && A.saved.length === 0);
  A = load(); await start(A);
  let p = A.PKV();
  ok('started: a packing list document with the scan block, saved at once, the board shown', p && p.id === 'PKV1' && p.title === 'Scan 2026-10-12 · INV7' && p.account === 'Ridhi FBA' && p.invoice === 'INV7' && p.status === 'progress'
    && JSON.stringify(p.scan.orders) === '["OC-1","OC-2"]' && p.scan.handoverTo === 'Raju' && A.saved.length === 1 && A.els.pkvWork._hidden === false, JSON.stringify(p));
  ok('the board: one line per SKU, its orders under it, ordered / packed / left', /RTC136060/.test(A.els.pkvLines.innerHTML) && /OC-1 0\/2/.test(A.els.pkvLines.innerHTML) && /OC-2 0\/1/.test(A.els.pkvLines.innerHTML) && /RQL34-Q/.test(A.els.pkvLines.innerHTML));
  ok('the header fields lock while a session is open', A.els.pkvOrds.disabled === true && A.els.pkvStart.disabled === true);

  console.log('== scans ==');
  A.pkvOnCode('x0045g8p3b', 'typed');
  p = A.PKV();
  ok('a good scan: +1 in box 1, for the oldest order, green, the picture and the article shown', p.boxes[0].items[0].sku === 'RTC136060' && p.boxes[0].items[0].qty === 1 && p.boxes[0].items[0].desc === 'Cotton Square Tablecloth 60x60'
    && p.scan.packed.RTC136060['OC-1'] === 1 && A.els.pkvFb.className === 'pkvfb good' && /for OC-1/.test(A.els.pkvFbSub.innerHTML) && /2 left/.test(A.els.pkvFbSub.innerHTML) && /81RpvEJa/.test(A.els.pkvFbImg.innerHTML), A.els.pkvFbSub.innerHTML);
  A.pkvOnCode('X0045G8P3B', 'typed');
  ok('the same code typed again within a second is one double read — ignored', p.boxes[0].items[0].qty === 1);
  await wait(1050);
  A.pkvOnCode('X0045G8P3B', 'typed'); A.pkvOnCode('RTC136060', 'typed');
  ok('after a second it counts; a SKU typed as itself counts; OC-1 full then OC-2', p.boxes[0].items[0].qty === 3 && p.scan.packed.RTC136060['OC-1'] === 2 && p.scan.packed.RTC136060['OC-2'] === 1);
  A.pkvOnCode('X0045G8P3B', 'camera');
  ok('a fourth: ORDER FULL, amber, not added', p.boxes[0].items[0].qty === 3 && A.els.pkvFb.className === 'pkvfb full' && /ORDER FULL/.test(A.els.pkvFbMsg.innerHTML));
  A.pkvOnCode('X003ZK2Q9L', 'camera');
  ok('a known SKU on no order: WRONG ARTICLE, red, blocked, listed', p.boxes[0].items.length === 1 && A.els.pkvFb.className === 'pkvfb bad' && /WRONG ARTICLE: RCN371-1/.test(A.els.pkvFbMsg.innerHTML) && p.scan.wrong.length === 1 && p.scan.wrong[0].sku === 'RCN371-1' && /RCN371-1/.test(A.els.pkvWrong.innerHTML) && A.els.pkvWrongN.textContent === '1');
  A.pkvOnCode('X00NOTREAL', 'camera');
  ok('an unknown code: NOT KNOWN, nothing added', /NOT KNOWN/.test(A.els.pkvFbMsg.innerHTML) && p.boxes[0].items.length === 1 && p.scan.scans === 6);
  ok('the board moved: OC-1 2/2, OC-2 1/1, 0 left on the tablecloth', /OC-1 2\/2/.test(A.els.pkvLines.innerHTML) && /OC-2 1\/1/.test(A.els.pkvLines.innerHTML));
  A.pkvUndo();
  ok('undo takes the last good scan back (box and order)', p.boxes[0].items[0].qty === 2 && !p.scan.packed.RTC136060['OC-2']);
  await wait(3100);
  ok('saved 3 s after the last change, with the box as it is', A.saved.length >= 2 && A.saved[A.saved.length - 1].boxes[0].items[0].qty === 2 && A.els.pkvSaved.textContent === 'saved');

  console.log('== boxes ==');
  A.pkvCloseBox();
  ok('Close box draws the form with the default size', A.els.pkvBoxes._kids && A.els.pkvBoxes._kids.length === 1 && A.els.pkvL.value === '' && /Close box 1/.test(A.els.pkvBoxes._kids[0].innerHTML));
  A.ctx.$('pkvL').value = '60'; A.ctx.$('pkvW').value = '40'; A.ctx.$('pkvH').value = '30'; A.ctx.$('pkvScale').value = '3.5';
  A.els.pkvCloseOk.onclick();
  ok('the box keeps its size and the scale reading; box 2 opens', p.boxes[0].L === 60 && p.boxes[0].H === 30 && p.boxes[0].grossWtOverride === 3.5 && A.PKV && A.PKV().boxes.length === 2 && /Box 2/.test(A.els.pkvBoxes.innerHTML));
  A.pkvOnCode('X0045G8P3B', 'camera');
  ok('a scan now goes into box 2', p.boxes[1].items[0].sku === 'RTC136060' && p.boxes[1].items[0].qty === 1 && p.boxes[0].items[0].qty === 2);
  ok('weights on the board: net from the master, gross from the scale', /net 0\.84 kg · gross 3\.50 kg \(scale\)/.test(A.els.pkvBoxes.innerHTML), A.els.pkvBoxes.innerHTML);
  A.pkvCloseBox(); A.els.pkvCloseOk.onclick();
  A.pkvCloseBox();
  ok('an empty box cannot be closed', /Box 3 is empty/.test(A.els.pkvFbMsg.innerHTML));
  A.pkvReopen(1);
  ok('reopen box 1: the empty box 3 goes, scans go into box 1 again', p.boxes.length === 2 && A.pkvRender() === undefined && /Box 1.*open/.test(A.els.pkvBoxes.innerHTML));
  A.pkvOnCode('X00QL34Q00', 'camera');
  ok('…into box 1 indeed', p.boxes[0].items.some(it => it.sku === 'RQL34-Q' && it.qty === 1));

  console.log('== Scan a piece: read-only ==');
  A.pkvTab('piece');
  const before = JSON.stringify(p);
  A.pkvOnCode('X0045G8P3B', 'camera');
  ok('the lookup: stock, open orders, boxes in this list; nothing changed', /In the store/.test(A.els.pkvPiece.innerHTML) && /OC-1/.test(A.els.pkvPiece.innerHTML) && /box 1 \(2 pcs/.test(A.els.pkvPiece.innerHTML) && JSON.stringify(p) === before, A.els.pkvPiece.innerHTML);
  A.pkvTab('order');

  console.log('== Finish ==');
  A.patches.length = 0;
  await A.pkvFinish();
  const keys = Object.keys(A.patches[0] || {});
  ok('one PATCH with one Send to FBA row per SKU', A.patches.length === 1 && keys.length === 2 && keys.every(k => /^pt_fgiLedger\/FBA-/.test(k)), JSON.stringify(keys));
  const rows = Object.values(A.patches[0] || {}), tc = rows.find(r => r.sku === 'RTC136060');
  ok('the tablecloth row: 3 pcs, 2 for OC-1 and 1 for OC-2, boxes 1 and 2, handed to Raju, pack id', tc && tc.qty === 3 && JSON.stringify(tc.orders) === '[{"orderNo":"OC-1","qty":2},{"orderNo":"OC-2","qty":1}]' && JSON.stringify(tc.boxes) === '[{"n":1,"qty":2},{"n":2,"qty":1}]' && tc.handoverTo === 'Raju' && tc.packId === 'PKV1' && tc.date === '12/10/2026', JSON.stringify(tc));
  const last = A.saved[A.saved.length - 1];
  ok('the list is saved with the ledger ids, done, and the lines carry their per-piece weight', last.scan.ledgerIds.length === 2 && last.scan.done === true && last.boxes[0].items[0].perPcsWt === 0.42 && A.ctx.rendered >= 1);
  ok('the screen says so and offers another session', A.els.pkvFb.className === 'pkvfb good' && /Packing list built/.test(A.els.pkvFbMsg.innerHTML) && /2 Send to FBA row/.test(A.els.pkvFbSub.innerHTML) && /Start another session/.test(A.els.pkvMsg.innerHTML));
  A.pkvOnCode('X0045G8P3B', 'camera');
  ok('a scan after Finish is refused', /finished/.test(A.els.pkvFbMsg.innerHTML) && p.boxes[1].items[0].qty === 1);
  await A.pkvFinish();
  ok('Finish again writes nothing twice', A.patches.length === 1);

  console.log('== Finish when something is wrong ==');
  let S = load({ stock: { RTC136060: 1, 'RQL34-Q': 1 } }); await start(S); S.pkvOnCode('X0045G8P3B'); S.pkvOnCode('X0045G8P3B');
  await S.pkvFinish();
  ok('more than the store holds: refused, nothing written, nothing marked done', S.patches.length === 0 && /Not finished/.test(S.els.pkvFbMsg.innerHTML) && /enough stock/.test(S.els.pkvFbMsg.innerHTML) && !S.PKV().scan.done);
  S = load(); await start(S); await S.pkvFinish();
  ok('nothing packed: refused', S.patches.length === 0 && /Nothing packed/.test(S.els.pkvFbMsg.innerHTML));
  let fails = 0; S = load({ saveFails: () => fails-- > 0 }); await start(S); S.pkvOnCode('X0045G8P3B');
  fails = 1; await S.pkvFinish();
  ok('the rows written but the list not saved: says so, keeps the ids', S.patches.length === 1 && /did not save/.test(S.els.pkvFbMsg.innerHTML) && S.PKV().scan.ledgerIds.length === 1);
  await S.pkvFinish();
  ok('Finish again: only the save is retried, nothing written twice', S.patches.length === 1 && S.saved[S.saved.length - 1].scan.ledgerIds.length === 1 && /Packing list saved/.test(S.els.pkvFbMsg.innerHTML));

  console.log('== resume and a pasted plan ==');
  const open = { id: 'OLD1', title: 'Scan 2026-10-11', account: 'CPC FBA', date: '2026-10-11', status: 'progress', boxes: [{ n: 1, items: [{ sku: 'RTC136060', qty: 1 }] }], scan: { orders: ['OC-1'], plan: [], planNo: '', handoverTo: '', packed: { RTC136060: { 'OC-1': 1 } }, wrong: [], ledgerIds: [], done: false } };
  let Rz = load({ PK: [open, { id: 'DONE', status: 'done', scan: { ledgerIds: ['x'] } }, { id: 'FILE', status: 'progress', boxes: [] }] });
  await Rz.pkvOpen();
  ok('open sessions: only lists in progress that were started by scanning and not finished', /OLD1/.test(Rz.dialogs[0].html) && !/DONE/.test(Rz.dialogs[0].html) && !/value="FILE"/.test(Rz.dialogs[0].html));
  Rz.ctx.$('pkvResume').value = 'OLD1'; Rz.els.pkvResume.onchange();
  ok('resumed in the last box with something in it, the orders and account restored', Rz.PKV().id === 'OLD1' && Rz.els.pkvOrds.value === 'OC-1' && Rz.els.pkvAcc.value === 'CPC FBA' && /OC-1 1\/2/.test(Rz.els.pkvLines.innerHTML));
  Rz.pkvOnCode('X0045G8P3B');
  ok('and carries on from there', Rz.PKV().boxes[0].items[0].qty === 2 && Rz.PKV().scan.packed.RTC136060['OC-1'] === 2);
  const Pl = load(); await Pl.pkvOpen(); Pl.ctx.$('pkvOrds').value = ''; Pl.ctx.$('pkvAcc').value = 'Ridhi FBA'; Pl.ctx.$('pkvInv').value = 'SHIP1';
  Pl.els.pkvPlanTa = { value: 'Merchant SKU\tFNSKU\tQuantity\nRTC136060\tX0045G8P3B\t2\nRQL34-Q\tX00QL34Q00\t1', remove() {} };
  await Pl.pkvStart();
  ok('a pasted Amazon plan is the order: lines capped by the store', Pl.PKV() && Pl.PKV().scan.planNo === 'FBA-PLAN-SHIP1' && Pl.PKV().scan.plan.length === 2 && /FBA-PLAN-SHIP1 0\/2/.test(Pl.els.pkvLines.innerHTML), Pl.els.pkvMsg.textContent);
  Pl.pkvOnCode('X003ZK2Q9L');
  ok('a SKU not on the plan is WRONG ARTICLE', /WRONG ARTICLE/.test(Pl.els.pkvFbMsg.innerHTML));
  const Pu = load(); await Pu.pkvOpen(); Pu.ctx.$('pkvOrds').value = ''; Pu.els.pkvPlanTa = { value: 'sku\tqty\nNOPE-1\t2', remove() {} }; await Pu.pkvStart();
  ok('a plan naming a SKU nobody knows stops the start', /Not a SKU this app knows: NOPE-1/.test(Pu.els.pkvMsg.textContent) && !Pu.PKV());

  console.log('== the camera frame guard is its own, not Scan to pack\'s ==');
  { const B = load(); const cam = { seen: null }; const t0 = 1e6;
    ok('two frames agree → counts, once; Scan to pack\'s state untouched', B.pksFrame('X0045G8P3B', t0, cam) === false && B.pksFrame('X0045G8P3B', t0 + 100, cam) === true && B.pksFrame('X0045G8P3B', t0 + 200, cam) === false && B.PKS.seen === null); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
