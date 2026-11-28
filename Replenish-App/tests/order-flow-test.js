/* ORDER FLOW FIXES (28 Nov 2026, order-to-shipping test): 5 pieces were issued with 2 printed; "Completed" closed an order line
 * at 2 of 3; an item PPC sent straight to Job Work could not be issued; an order cut to 5 left the printer holding 998 with no
 * word to anybody.
 *   node tests/order-flow-test.js      (APP_DIR=<a broken or older copy of src/app> for the teeth check) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : path.join(__dirname, '..', 'src', 'app');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); return src.slice(i, src.indexOf(b, i) + b.length); };
const load = (ctx, code) => { vm.createContext(ctx); vm.runInContext(code, ctx); return ctx; };

(async () => {
  console.log('== issue only what is printed ==');
  { const src = read('production/job-work-entry.js');
    const run = (s, used, want, flow = { ppc: {} }, scrap = 0) => load({ obQcScrapQty: () => scrap, FLOW: flow, flowKey: () => 'k', flowRows: () => [{ s: Object.assign({ key: 'k' }, s) }], obUC: x => x, console: { warn() {} } },
      cut(src, 'function bdPrintedBackErr(', '\n}\n') + `this.said = bdPrintedBackErr('O', 'A', ${used}, ${want});`).said;
    const printed = { plan: {}, printed: true, cutReq: false, back: 2 };
    ok('5 with 2 printed is refused and the most is named', /2 pcs are back from the printer and 0 already issued — at most 2 more/.test(run(printed, 0, 5)));
    ok('the 2 that are back may go, once', run(printed, 0, 2) === '' && run(printed, 2, 1) !== '');
    ok('a piece rejected at QC may go again', run(Object.assign({ qcRej: 1 }, printed), 2, 1) === '');
    const one = Object.assign({ qcRej: 1 }, printed);
    ok('a scrapped reject opens one place, not two', run(one, 1, 2, undefined, 1) !== '' && run(one, 1, 1, undefined, 1) === '');
    ok('cut lines, unprinted lines and unplanned lines are left to the older limits', [{ cutReq: true }, { printed: false }, { plan: null }].every(x => run(Object.assign({}, printed, x), 0, 99) === ''));
    ok('with no flow read it stays quiet', run(printed, 0, 99, null) === '');
    ok('the issue guard asks it', /const unprinted = bdPrintedBackErr\(orderNo, sku, used, want, exclId\);\n  if \(unprinted\) return unprinted;/.test(src)); }

  console.log('== Job Work straight away needs no cutting ==');
  { const t = load({}, cut(read('flow/flow-entries.js'), 'const flowIssuable', ';\n') + 'this.f = flowIssuable;');
    ok('an item whose master says cut, sent straight to Job Work, can be issued', t.f({ cutReq: true, qty: 20 }, { cutReq: false, cut: 0, issued: 0 }) === 20);
    ok('a line that does cut still issues only what is cut', t.f({ cutReq: true, qty: 20 }, { cutReq: true, cut: 4, issued: 1 }) === 3); }

  console.log('== Completed means all of it ==');
  { const src = read('orders/production-to-shipping.js');
    const run = async (pressed, o = {}) => { const seen = { saved: null, asked: 0 };
      const ctx = { ptCanEdit: () => true, PT_NO_EDIT: 'no', spKey: () => 'k', spOf: () => null, obUC: x => x, spNum: v => +v || 0, nf: String, ME: { email: 'a@test', admin: !!o.admin },
        ordLines: () => [{ orderNo: 'O', sku: 'A', qty: 3, received: pressed, pressed }], prompt: () => { seen.asked++; return o.why; }, ptPut: async (p, v) => { seen.saved = v; }, PTG: {}, ORD_IX: {}, renderOrd() {} };
      if (o.was) ctx.spOf = () => o.was;
      load(ctx, cut(src, 'function spShortClose(', '\n}\n') + cut(src, 'async function spHandover(', '\n}\n') + 'this.f = spHandover;');
      seen.err = await ctx.f('O', 'A', !o.undo); return seen; };
    const staff = await run(2);
    ok('2 of 3 stays open for staff, with the figures', !staff.saved && /only 2 of 3/.test(staff.err) && !staff.asked, JSON.stringify(staff));
    const silent = await run(2, { admin: true, why: '' });
    ok('an admin must give a reason', !silent.saved && silent.asked === 1 && /no reason/.test(silent.err));
    const said = await run(2, { admin: true, why: 'buyer took 2' });
    ok('with a reason it closes and the reason stays on the record', said.err === '' && said.saved.shortClose.why === 'buyer took 2' && said.saved.shortClose.done === 2 && said.saved.shortClose.of === 3, JSON.stringify(said.saved));
    const was = { orderNo: 'O', sku: 'A', shortClose: { why: 'old' } };
    const undone = await run(2, { was, undo: true }), later = await run(3, { was });
    ok('an undo, and a later full hand-over, clear the old short note', undone.saved.shortClose === null && later.saved.shortClose === null, JSON.stringify([undone.saved, later.saved]));
    const full = await run(3);
    ok('all of it closes as before, with no question', full.err === '' && full.saved.handedAt && !full.saved.shortClose && !full.asked); }

  console.log('== an order cut below what the printer holds ==');
  { const src = read('orders/raise-sales-order.js');
    const run = given => load({ ordVendorOf: () => (given == null ? null : { given }), nf: String, console: { warn() {} } }, cut(src, 'function soPrinterAsk(', '\n}\n') + "this.q = soPrinterAsk('O', 'A', 5);").q;
    ok('both figures are asked about', /order for 998 pcs of A, and this makes the order 5/.test(run(998)));
    ok('no question when the printer holds no more, or has nothing', run(5) === '' && run(null) === '');
    ok('asked before the change is recorded', /const held = soPrinterAsk\(o\._id, plan\.sku, plan\.to\);\n  if \(held && !confirm\(held\)\) return/.test(src));
    const ppc = read('core/ppc-one.js');
    const note = load({ p1N: String }, cut(ppc, 'const overNote = ', '};\n') + 'this.f = overNote;').f;
    ok('PPC\'s line says both figures, and nothing otherwise', /Printer has 998, order is 5/.test(note([{ s: { overPrint: 998 }, r: { qty: 5 } }])) && note([{ s: {}, r: { qty: 5 } }]) === '');
    const mark = given => load({ p: {}, printed: true, v: { given }, qty: 5, s: {} }, cut(read('flow/flow-core.js'), 'if (p && printed && v && +v.given > qty)', '\n')).s.overPrint;
    ok('a line is marked only when the printer holds more', mark(998) === 998 && mark(5) === undefined);
    ok('both PPC rows show it', /\$\{overNote\(r\.lines\)\}/.test(ppc) && /\$\{overNote\(\[l\.x\]\)\}/.test(ppc)); }
  { const src = read('orders/raise-sales-order.js'), asked = [];
    const ctx = { VO: { rows: null }, nf: String, console: { warn() {} }, confirm: x => { asked.push(x); return false; } };
    ctx.ensureVo = async () => { ctx.VO.rows = []; }; ctx.ordVendorOf = () => (ctx.VO.rows ? { given: 998 } : null);
    const body = cut(src, "  if (typeof VO !== 'undefined' && VO.rows == null", "return 'Not asked — the quantity stays as it is.';\n");
    load(ctx, cut(src, 'function soPrinterAsk(', '\n}\n') + 'this.f = async (o, plan) => {\n' + body + "return 'went';\n};");
    const said = await ctx.f({ _id: 'O' }, { sku: 'A', to: 5 });
    ok('the printers\' orders are read first, so the question is asked', asked.length === 1 && /998/.test(asked[0]) && /stays as it is/.test(said), said); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
