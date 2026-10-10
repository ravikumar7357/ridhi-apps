/* Scan to pack (src/app/replenishment/pack-scan.js): what a code is, when a camera read counts, and what is saved.
 *   node tests/pack-scan-test.js      (PKS_SRC=<file> to test another copy — teeth/teeth-pack-scan.js does) */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.PKS_SRC || path.join(__dirname, '..', 'src', 'app', 'replenishment', 'pack-scan.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

function load(opts) {
  opts = opts || {};
  const els = {}, saved = [];
  const el = id => els[id] || (els[id] = { id, value: '', textContent: '', innerHTML: '', style: {}, classList: { toggle() {}, add() {}, remove() {} }, onclick: null, remove() {} });
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
  };
  const api = new Function(...Object.keys(ctx), SRC + '\n;return { PKS, pksResolve, pksFrame, pksCount, pksUndo, pksNextBox, pksSaveNow, pksImg, pksHit };')(...Object.values(ctx));
  api.PKS.p = { id: 'PKT', title: 'T', boxes: [] }; api.PKS.box = 1; api.PKS.per = 1;
  return Object.assign(api, { saved, els });
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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
