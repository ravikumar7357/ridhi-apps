/* PLACE ORDER FROM THE DEMAND BASKET, CHECKED AGAIN (src/app/orders/orders-one-line.js — demAtPrinters, demStillShort and
 * demBasketPlace's save). Ravi, 26 Nov: two people ordered the same cloth for one shortage. Switch "lineHold" on: just before the
 * basket is placed the printer orders are read again; if more of a colour was ordered since it was added, the person is asked
 * whether they still want this order. Cases are made up.
 *   node tests/demand-still-short-test.js      (DEM_FILE=<a copy of orders-one-line.js> tests that copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.env.DEM_FILE || path.join(__dirname, '..', 'src', 'app', 'orders', 'orders-one-line.js');
const SRC = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const HIS = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'core', 'history.js'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const cut = (src, re, end) => { const i = src.search(re); if (i < 0) throw new Error(re + ' not found'); return src.slice(i, src.indexOf(end || '\n}', i) + (end || '\n}').length); };
const KEY = 'MADE-UP VOIL|RED|Vertical';

/** One PC at the Order Console's Demand. db: metres of Made-up Voil · Red · Vertical the printers owe, as the database has it now. */
function screen(o) {
  const asked = [], placed = [], dialog = {};
  const ctx = {
    console: { warn: () => {}, log: console.log }, nf: String, esc: s => String(s), Math, Object, Promise, String, Map,
    localStorage: { getItem: k => (k === 'lineHold' && !o.off ? '1' : null) },
    VO: { rows: [{ m: o.db }], err: '' }, ORD_DEM: { voOk: !o.firstReadFailed },   // the screen opened with the printer orders as they were then
    ensureVo: async () => { if (ctx.VO.rows !== null) return;   // as the app: reads only when the screen's copy was dropped
      if (o.readFails) { ctx.VO.rows = []; ctx.VO.err = 'read 503'; return; } ctx.VO.rows = [{ m: o.db }]; ctx.VO.err = ''; },
    ordDemandAtPrintersCol: () => (o.notRead || !ctx.ORD_DEM.voOk ? null : { col: new Map([[KEY, { runM: ctx.VO.rows.reduce((t, r) => t + r.m, 0) }]]) }),
    confirm: q => { asked.push(q); return o.answer; }, renderOrd: () => {}, voName: () => 'Made-up Printer', vrqCanApprove: () => true,
    voFabricCatalogue: () => new Map(), voPlace: async () => { placed.push(1); return ''; }, $: () => null,
    ORD: { demBasket: {}, demRows: new Map([[KEY, { key: KEY, fabric: 'Made-up Voil', colour: 'Red', give: 200, need: 500, atM: o.screenAt != null ? o.screenAt : 300, products: [] }]]) },
    ptOpenDialog: d => { dialog.d = d; }, voMasterRow: () => ({}), VOF: null,
  };
  vm.createContext(ctx);
  vm.runInContext([cut(HIS, /^function lineHoldOn\(/m), cut(SRC, /^function demBasketAdd\(/m), cut(SRC, /^function demAtPrinters\(/m),
    cut(SRC, /^async function demStillShort\(/m), cut(SRC, /^function demBasketPlace\(/m)].join('\n'), ctx);
  return { ctx, asked, placed, add: () => ctx.demBasketAdd(KEY, 'P1', 'Vertical'),
    place: async () => { ctx.demBasketPlace('P1'); return dialog.d.onSave({ deliv: '2026-12-01', pri: 'P2', notes: '' }); } };
}

(async () => {
  console.log('== nothing changed at the printers ==');
  { const o = { db: 300 }, s = screen(o); s.add(); const said = await s.place();
    ok('placed, nobody asked', said === '' && s.placed.length === 1 && s.asked.length === 0, said); }

  console.log('== somebody ordered the same colour meanwhile ==');
  { const o = { db: 300, answer: false }, s = screen(o); s.add(); o.db = 500; const said = await s.place();
    ok('the person is asked, with how much more was ordered and what this order adds', s.asked.length === 1 && /Made-up Voil · Red · Vertical: 200 m more \(this order adds 200 m\)/.test(s.asked[0]), s.asked[0]);
    ok('…"no": nothing placed, the basket kept and the dialog says so', s.placed.length === 0 && /Not placed/.test(said) && (s.ctx.ORD.demBasket.P1 || []).length === 1, said); }
  { const o = { db: 300, answer: true }, s = screen(o); s.add(); o.db = 500; const said = await s.place();
    ok('…"yes": placed once', said === '' && s.placed.length === 1 && s.asked.length === 1); }
  { const o = { db: 300, screenAt: 120 }, s = screen(o); s.add(); const said = await s.place();
    ok('a filtered Demand view (it shows only its share at printers) is not taken for a new order', said === '' && s.asked.length === 0, s.asked[0]); }
  { const o = { db: 300, notRead: true }, s = screen(o); s.add(); o.notRead = false; o.db = 900; const said = await s.place();
    ok('a line added before the printer orders were read is not questioned on a made-up baseline', said === '' && s.asked.length === 0, s.asked[0]); }

  console.log('== fails loudly ==');
  { const o = { db: 300 }, s = screen(o); s.add(); o.readFails = true; const said = await s.place();
    ok('the printer orders cannot be read: nothing placed, says what to do', s.placed.length === 0 && /Not placed/.test(said) && /press again/.test(said), said); }

  { const o = { db: 300, firstReadFailed: true }, s = screen(o); s.add(); const said = await s.place();
    ok('the screen could not read printer orders when it opened, a good read now: placed, not blocked', said === '' && s.placed.length === 1, said); }
  { const o = { db: 300, firstReadFailed: true, readFails: true }, s = screen(o); s.add(); const said = await s.place();
    ok('printer orders unreadable both times: placed as today, since its lines have nothing to be checked against', said === '' && s.placed.length === 1, said); }
  { const o = { db: 300 }, s = screen(o); s.add(); o.readFails = true; await s.place();
    ok('a failed read again: Demand shows At printers as unknown, not as nothing owed', s.ctx.ordDemandAtPrintersCol() === null && s.ctx.ORD_DEM.voOk === false); }

  console.log('== switch off ==');
  { const o = { db: 300, off: true }, s = screen(o); s.add(); o.db = 900; const said = await s.place();
    ok('placed as it always was, no question', said === '' && s.placed.length === 1 && s.asked.length === 0); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
