/* Scan to pack (src/app/replenishment/pack-scan.js): what a code is, when a camera read counts, and what is saved.
 *   node tests/pack-scan-test.js      (PKS_SRC=<file> to test another copy — teeth/teeth-pack-scan.js does) */
const fs = require('fs'), path = require('path');
/* The rules live in pack-core.js (shared with Pack & verify); the screen is pack-scan.js. Both are loaded, core first, as the page does. */
const CORE = fs.readFileSync(process.env.PKC_SRC || path.join(__dirname, '..', 'src', 'app', 'replenishment', 'pack-core.js'), 'utf8');
const SRC = CORE + '\n' + fs.readFileSync(process.env.PKS_SRC || path.join(__dirname, '..', 'src', 'app', 'replenishment', 'pack-scan.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

function load(opts) {
  opts = opts || {};
  const els = {}, saved = [], patches = [];
  /* the real $() gives null for an id that is not on the page; the Done card's fields exist only while it is drawn */
  const el = id => els[id] || (/^pksDone(Acc|Hand)$/.test(id) ? undefined : els[id] = { id, value: '', textContent: '', innerHTML: '', style: {}, classList: { toggle() {}, add() {}, remove() {} }, onclick: null, remove() {} });
  const ctx = {
    $: el, document: { createElement: () => el('x' + Math.random()), body: { appendChild() {} }, head: { appendChild() {} } }, window: {}, navigator: {},
    obUC: s => String(s == null ? '' : s).trim().toUpperCase(), pkNum: v => { const n = Number(v); return isFinite(n) ? n : 0; },
    FN: { map: new Map([['X0045G8P3B', 'RTC136060'], ['X003ZK2Q9L', 'RCN371-1']]) },
    replRowMap: () => ({ RTC136060: { subcat: 'Square Tablecloth', size: '60x60', image: 'https://m.media-amazon.com/images/I/81RpvEJa+bL._SL120_.jpg' }, 'RCN371-1': { subcat: 'Napkin', size: '20x20', image: '' } }),
    PK_META: {}, PTG: { mdb: [{ sku: 'RQL34-Q' }] },
    pkLookupSku: sku => ({ RTC136060: { desc: 'Cotton Square Tablecloth 60x60', size: '60x60', material: '100% COTTON', perPcsWt: 0.42 } }[sku] || { desc: 'Cotton ' + sku, size: '', material: '100% COTTON', perPcsWt: 0 }),
    pkTotals: p => ({ boxes: (p.boxes || []).length, qty: (p.boxes || []).reduce((s, b) => s + (b.items || []).reduce((t, i) => t + i.qty, 0), 0) }),
    savePkOne: async p => { if (opts.saveFails) throw new Error('offline'); saved.push(JSON.parse(JSON.stringify(p))); },
    ptImgOf: sku => (opts.img || {})[sku], esc: s => String(s == null ? '' : s), pkMsg: () => {}, setTimeout, clearTimeout, confirm: () => true,
    PK: [], PK_LOADED: true, loadPk: async () => {}, loadPkWt: async () => {}, fnLoad: async () => {}, ptOpenDialog: () => {}, pkToday: () => '2026-10-10', pkId: () => 'PKT', ME: { email: 't' },
    /* what pack-core.js reads and writes (the Finished Goods side), stubbed */
    nf: v => String(v), FGI: { rows: [], err: '' }, fgiLoad: async () => {}, mdbOf: () => null, PK_WT: {},
    ordLines: () => opts.lines || [], fgiOrderKnown: no => (opts.lines || []).some(l => l.orderNo === no),
    fgiOutOrders: sku => (opts.lines || []).filter(l => l.sku === sku).map(l => ({ orderNo: l.orderNo, store: (opts.store || {})[l.orderNo + '|' + sku] || 0 })),
    fgiOf: sku => ({ current: (opts.stock || {})[sku] || 0 }), fgiOutCheck: (sku, qty) => qty > ((opts.stock || {})[sku] || 0) ? 'You don\'t have enough stock — ' + sku : '',
    fgiOutAlloc: (sku, n) => ({ orders: [{ orderNo: 'AUTO', qty: n }], loose: 0 }), fgiCanEntry: () => opts.right !== false, FGI_NO_ENTRY: 'no right', FGI_FBA_ACCOUNTS: ['Ridhi FBA', 'CPC FBA'],
    fgiNewId: p => p + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(), ptPatch: async patch => { patches.push(patch); }, fbaBadge: () => {}, fgiOverBadge: () => {}, lstAlertFor: async () => '',
    renderPack: () => {}, renderFgi: () => {},
  };
  const api = new Function(...Object.keys(ctx), SRC + '\n;return { PKS, pksAimed, pksResolve, pksFrame, pksCount, pksUndo, pksNextBox, pksSaveNow, pksImg, pksHit, pksDone, pksFinishAsk, packScanNew };')(...Object.values(ctx));
  api.PKS.p = { id: 'PKT', title: 'T', account: 'Ridhi FBA', date: '2026-10-10', boxes: [] }; api.PKS.box = 1; api.PKS.per = 1;
  if (opts.orders) api.PKS.p.scan = api.packScanNew(opts.orders, [], '', '');
  return Object.assign(api, { saved, els, patches });
}

(async () => {
  console.log('== what a code is ==');
  let A = load();
  ok('an FNSKU label is its SKU', A.pksResolve('x0045g8p3b').sku === 'RTC136060' && A.pksResolve('X0045G8P3B').how === 'fnsku');
  ok('a SKU this app knows is itself', A.pksResolve('rtc136060').sku === 'RTC136060' && A.pksResolve('RQL34-Q').sku === 'RQL34-Q');
  ok('anything else is nothing — never a guess', A.pksResolve('X00ZZZZZZZ').sku === '' && A.pksResolve('RTC13606').sku === '');

  console.log('== a camera read counts once per piece ==');
  A = load();
  const t0 = 1e6;
  ok('the first frame alone does not count', A.pksFrame('X0045G8P3B', t0) === false);
  ok('the second frame agreeing does', A.pksFrame('X0045G8P3B', t0 + 100) === true);
  let more = 0; for (let i = 2; i < 30; i++) if (A.pksFrame('X0045G8P3B', t0 + i * 100)) more++;
  ok('the same label held in view for 3 s counts no more', more === 0, String(more));
  ok('after it leaves the frame (> 0.7 s) the next piece counts again', A.pksFrame('X0045G8P3B', t0 + 4000) === false && A.pksFrame('X0045G8P3B', t0 + 4100) === true);
  ok('a different label counts after two frames, no gap needed', A.pksFrame('X003ZK2Q9L', t0 + 4200) === false && A.pksFrame('X003ZK2Q9L', t0 + 4300) === true);
  ok('one stray frame of a misread is never counted', A.pksFrame('X0045G8P38', t0 + 9000) === false && A.pksFrame('X003ZK2Q9L', t0 + 9100) === false);

  console.log('== 21 Oct: a held label read now and then is still one piece ==');
  A = load();
  /* a blurry label held still, read every 0.2–0.4 s with misses in between: counted 7–10 times before */
  let n = 0, t = 2e6;
  for (const gap of [0, 300, 250, 400, 200, 350, 300, 400, 250, 300, 380, 220]) { t += gap; if (A.pksFrame('X0045G8P3B', t, A.PKS, 1)) n++; }
  ok('a label held still and read every 0.2–0.4 s counts once', n === 1, String(n));
  ok('taken away for more than 0.9 s and the next piece shown, it counts again', A.pksFrame('X0045G8P3B', t + 1500, A.PKS, 1) === true);
  A = load(); A.PKS.frameMs = 400;
  ok('a slow phone (a picture every 0.4 s) waits longer before a piece has gone', A.pksFrame('X003ZK2Q9L', 3e6, A.PKS, 1) === true && A.pksFrame('X003ZK2Q9L', 3e6 + 1800, A.PKS, 1) === false);
  A = load();
  ok('a known code counts on one read', A.pksFrame('X0045G8P3B', 4e6, A.PKS, 1) === true);
  ok('an unknown code still needs two', A.pksFrame('X00UNKNOWN', 5e6) === false && A.pksFrame('X00UNKNOWN', 5e6 + 100) === true);
  ok('the camera reads a known code with one read (pksLoop)', /pksFrame\(c, now, PKS, pksResolve\(c\)\.sku \? 1 : PKS_AGREE\)/.test(SRC));
  const body = name => (SRC.replace(/\r\n/g, '\n').match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n}\\n')) || [''])[0];
  ok('changing box, keeping a piece aside, or a QC accept do not forget the label in view (no second count)',
    ['pksGoBox', 'pksNextBox', 'pksKeptAside'].every(f => body(f) && !body(f).includes('PKS.seen = null')) && /pksSeenNow\(code\);[^\n]*\n\s*pksHit\(code, "qc"\)/.test(SRC.replace(/\r\n/g, '\n')));

  console.log('== 21 Oct, S24 video: a clear label in the box, nothing read ==');
  A = load();
  const vid = { videoWidth: 1080, videoHeight: 1920, clientWidth: 400, clientHeight: 190 };
  const at = (code, x, y) => ({ rawValue: code, boundingBox: { x: x - 100, y: y - 30, width: 200, height: 60 } });
  ok('one label in view is read wherever the phone says it is', A.pksAimed([at('X003W2O642', 960, 540)], vid) === 'X003W2O642');
  ok('of two, the one in the box on screen', A.pksAimed([at('X0045G8P3B', 540, 300), at('X003ZK2Q9L', 540, 960)], vid) === 'X003ZK2Q9L');
  ok('nothing found is nothing', A.pksAimed([], vid) === null && A.pksAimed([{ rawValue: '' }], vid) === null);
  const flat = SRC.replace(/\r\n/g, '\n');
  ok('a phone reader that fails on every picture is set aside after five, and the other reader takes over', /catch \(e\) \{[\s\S]{0,200}if \(\+\+PKS\.detErr >= 5\) \{ PKS\.det = null; pksWzLoad\(\)/.test(flat));
  ok('the phone reader missing a picture hands every other one to the better reader at once (no 2.5 s wait)', /if \(!code && \(PKS\.zxN = \(PKS\.zxN \|\| 0\) \+ 1\) % 2 === 0\) \{\n\s*if \(PKS\.wz\) code = await pksWzRead\(v\)/.test(flat));
  ok('the better reader is fetched when the camera opens', /if \(PKS\.det\) pksWzLoad\(\)\.catch/.test(flat));

  console.log('== counting into the box ==');
  A = load();
  let r = A.pksCount('X0045G8P3B');
  ok('a scan adds the product with everything the packing list prints', r.ok && r.item.sku === 'RTC136060' && r.item.desc === 'Cotton Square Tablecloth 60x60'
    && r.item.size === '60x60' && r.item.material === '100% COTTON' && r.item.perPcsWt === 0.42 && r.item.qty === 1);
  A.pksCount('X0045G8P3B'); A.PKS.per = 4; A.pksCount('X0045G8P3B');
  ok('more pieces add to the same line; pieces per scan is honoured', A.PKS.p.boxes[0].items.length === 1 && A.PKS.p.boxes[0].items[0].qty === 6);
  const before = JSON.stringify(A.PKS.p);
  r = A.pksCount('X00NOTREAL');
  ok('an unknown code is refused, with the code and why', !r.ok && r.code === 'X00NOTREAL' && /not in the FNSKU list/.test(r.why));
  ok('…and the box is exactly as it was', JSON.stringify(A.PKS.p) === before);
  A.pksUndo();
  ok('Undo takes back the last scan (4 pieces)', A.PKS.p.boxes[0].items[0].qty === 2);
  A.pksUndo(); A.pksUndo();
  ok('Undo to zero removes the line', A.PKS.p.boxes[0].items.length === 0);

  console.log('== boxes ==');
  A = load();
  A.pksCount('X0045G8P3B'); A.pksCount('X003ZK2Q9L');
  A.pksNextBox({ L: '60', W: '40', H: '30', gross: '9.5' });
  ok('the finished box keeps its size and weight', A.PKS.p.boxes[0].L === 60 && A.PKS.p.boxes[0].H === 30 && A.PKS.p.boxes[0].grossWtOverride === 9.5);
  ok('the next box is open', A.PKS.box === 2);
  A.pksCount('X0045G8P3B');
  ok('a scan now goes into box 2', A.PKS.p.boxes.find(b => b.n === 2).items[0].sku === 'RTC136060' && A.PKS.p.boxes[0].items.length === 2);
  A.pksNextBox({}); await wait(20); A.saved.length = 0;
  A.PKS.dirty = true; await A.pksSaveNow();
  ok('an empty box at the end is never saved', A.saved.length === 1 && A.saved[0].boxes.map(b => b.n).join() === '1,2', JSON.stringify(A.saved[0] && A.saved[0].boxes.map(b => b.n)));
  ok('…but stays open on the phone for the next scan', A.PKS.box === 3 && A.PKS.p.boxes.some(b => b.n === 3));

  console.log('== saving ==');
  A = load();
  A.pksCount('X0045G8P3B'); A.pksCount('X0045G8P3B');
  await wait(900);
  ok('saved shortly after scanning stops, once', A.saved.length === 1 && A.saved[0].boxes[0].items[0].qty === 2);
  const F = load({ saveFails: true });
  F.pksCount('X0045G8P3B'); F.PKS.dirty = true; await F.pksSaveNow();
  ok('a failed save says so and keeps the list on the phone, marked unsaved', /Not saved/.test(F.PKS.err) && F.PKS.dirty === true && F.PKS.p.boxes[0].items[0].qty === 1);

  console.log('== the picture ==');
  A = load({ img: { RTC136060: 'https://m.media-amazon.com/images/I/81RpvEJa+bL._AC_SL120_.jpg' } });
  ok("Amazon's picture is asked for at 900 px", A.pksImg('RTC136060') === 'https://m.media-amazon.com/images/I/81RpvEJa+bL._SL900_.jpg', A.pksImg('RTC136060'));
  ok('without one, the snapshot\'s', /81RpvEJa\+bL\._SL900_\.jpg$/.test(load().pksImg('RTC136060')));
  ok('no picture is no picture (the screen says so)', load().pksImg('RCN371-1') === '');

  console.log('== against the orders (shared rules, pack-core.js) ==');
  const ORD = { orders: ['OC-1'], lines: [{ orderNo: 'OC-1', sku: 'RTC136060', qty: 2 }], store: { 'OC-1|RTC136060': 2 }, stock: { RTC136060: 2 } };
  A = load(ORD);
  r = A.pksCount('X0045G8P3B'); const r2 = A.pksCount('X0045G8P3B');
  ok('pieces the order wants count, and say what is left', r.ok && r.left === 1 && r2.ok && r2.left === 0 && A.PKS.p.boxes[0].items[0].qty === 2 && A.PKS.p.scan.packed.RTC136060['OC-1'] === 2, JSON.stringify([r, r2]));
  r = A.pksCount('X0045G8P3B');
  ok('the third is NOT COUNTED: the order is full', !r.ok && r.kind === 'full' && /already packed/.test(r.why) && A.PKS.p.boxes[0].items[0].qty === 2);
  r = A.pksCount('X003ZK2Q9L');
  ok('a known SKU on no order is WRONG ARTICLE — never in the box, listed on the list', !r.ok && r.kind === 'wrong' && r.sku === 'RCN371-1' && A.PKS.p.boxes[0].items.length === 1 && A.PKS.p.scan.wrong.length === 1 && A.PKS.p.scan.wrong[0].sku === 'RCN371-1');
  A.pksUndo();
  ok('undo gives the piece back to the order', A.PKS.p.boxes[0].items[0].qty === 1 && A.PKS.p.scan.packed.RTC136060['OC-1'] === 1);
  A.PKS.per = 4; r = A.pksCount('X0045G8P3B');
  ok('4 per scan when the order wants 1: one counted, says so', r.ok && r.n === 1 && r.short && A.PKS.p.boxes[0].items[0].qty === 2);
  A = load({ orders: ['OC-1'], lines: ORD.lines, store: { 'OC-1|RTC136060': 0 } });
  r = A.pksCount('X0045G8P3B');
  ok('nothing in the India Store for the order: NOT COUNTED, says to receive first', !r.ok && r.kind === 'full' && /receive it in Finished Goods first/.test(r.why));
  A = load();
  ok('a list with no orders has no guard — every known label counts (10 Oct)', A.pksCount('X003ZK2Q9L').ok && A.pksCount('X0045G8P3B').ok);

  console.log('== Finish → Done writes the Send to FBA rows once ==');
  A = load(ORD); A.pksCount('X0045G8P3B'); A.pksCount('X0045G8P3B');
  A.PKS.on = true; A.pksFinishAsk();
  ok('the finish card offers Pause and Done', /Done — write Send to FBA/.test(A.els.pksCard.innerHTML) && /Pause/.test(A.els.pksCard.innerHTML));
  A.els.pksDoneHand = { value: 'Raju' };
  await A.pksDone();
  const keys = Object.keys(A.patches[0] || {});
  ok('one PATCH, one FBA row for the SKU, 2 pcs for OC-1, box 1, handed to Raju', A.patches.length === 1 && keys.length === 1 && /^pt_fgiLedger\/FBA-/.test(keys[0]) && A.patches[0][keys[0]].qty === 2 && JSON.stringify(A.patches[0][keys[0]].orders) === '[{"orderNo":"OC-1","qty":2}]' && A.patches[0][keys[0]].handoverTo === 'Raju' && A.patches[0][keys[0]].packId === 'PKT', JSON.stringify(A.patches));
  ok('the list is saved with the ledger ids and closes', A.saved.length >= 1 && A.saved[A.saved.length - 1].scan.ledgerIds.length === 1 && A.PKS.on === false);
  A.PKS.on = true; A.pksFinishAsk();
  ok('Finish again: already written, no Done button', /already written/.test(A.els.pksCard.innerHTML) && !/Done — write/.test(A.els.pksCard.innerHTML));
  const S = load(Object.assign({}, ORD, { stock: { RTC136060: 1 } })); S.pksCount('X0045G8P3B'); S.pksCount('X0045G8P3B'); S.PKS.on = true; S.pksFinishAsk(); await S.pksDone();
  ok('more than the store holds: Done refuses, nothing written, the screen stays open', S.patches.length === 0 && /Not done/.test(S.els.pksSay.textContent) && S.PKS.on === true);
  const N = load(); N.pksCount('X0045G8P3B'); N.PKS.on = true; N.pksFinishAsk();
  ok('a list with no orders: Done still offered, FBA account asked where the list has none', /Done — write/.test(N.els.pksCard.innerHTML) && /pksDoneAcc/.test(N.els.pksCard.innerHTML) === false);
  const Q = load({ stock: { RTC136060: 5 } }); Q.PKS.p.account = 'Amazon'; Q.pksCount('X0045G8P3B'); Q.PKS.on = true; Q.pksFinishAsk();
  ok('…an account that is not an FBA account is asked for', /pksDoneAcc/.test(Q.els.pksCard.innerHTML));
  await Q.pksDone();
  ok('…and Done without it refuses', Q.patches.length === 0 && /FBA account/.test(Q.els.pksSay.textContent));
  Q.els.pksDoneAcc = { value: 'CPC FBA' }; await Q.pksDone();
  ok('…with it, the rows go, dealt to orders the Auto way, account on the row', Q.patches.length === 1 && Object.values(Q.patches[0])[0].issuedFor === 'CPC FBA' && Object.values(Q.patches[0])[0].orders[0].orderNo === 'AUTO');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
