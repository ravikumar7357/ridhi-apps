/* NO JUMP TO THE OLD FLOW PAGE (28 Nov 2026): PPC's "Receive" for printed cloth and the Greige Desk's "N lines" link left for the
 * old page; the box now opens where the person is.
 *   node tests/no-old-page-test.js      (APP_DIR=<a broken or older copy of src/app> for the teeth check) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : path.join(__dirname, '..', 'src', 'app');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); return src.slice(i, src.indexOf(b, i) + b.length); };

console.log('== receive printed cloth ==');
const run = printer => { const seen = { opened: null, said: [] };
  const ctx = { flowDueRecvOpen: (who, only) => { seen.opened = { who, only }; }, frToast: t => seen.said.push(t), obUC: v => String(v).toUpperCase() };
  vm.createContext(ctx); vm.runInContext(cut(read('core/ppc-one.js'), 'function p1RecvPrinted(', '\n}\n') + 'this.f = p1RecvPrinted;', ctx);
  ctx.f({ r: { orderNo: 'AMZ-1', sku: 'a' }, s: { plan: { printer } } });
  return seen; };
{ const s = run({ code: 'V1', name: 'RBP' });
  ok('a line with a printer gets the receive box for that printer, narrowed to its order and SKU, challan or not', s.opened && s.opened.who === 'V1' && s.opened.only.orderNo === 'AMZ-1' && s.opened.only.sku === 'a' && !s.said.length, JSON.stringify(s.opened));
  s.opened.only.none();
  ok('nothing still to come: it says so by name', /AMZ-1 A: nothing is still to come from RBP/.test(s.said[0] || ''));
  const n = run(null);
  ok('no printer on the plan: a message, and nothing opens', !n.opened && /no printer on its PPC plan/.test(n.said[0] || ''), JSON.stringify(n)); }

console.log('== the buttons ==');
{ const p1 = read('core/ppc-one.js'), gd = read('flow/greige-desk.js');
  ok('PPC\'s Receive stays on the page', /else if \(k === 'PRN'\) p1RecvPrinted\(x\);/.test(p1) && !/FLOW_VIEW = 'dhist'; showTab\('flow'\)/.test(p1));
  ok('the receive box is the shared one: it saves through the Printer\'s view rules', /await flowDueRecvSave\(key, got,/.test(cut(read('flow/flow-receive.js'), 'function flowDueRecvOpen(', '\n}\n')));
  ok('the Greige Desk\'s "lines" link opens the send card', /if \(t\.getAttribute\('data-gdlines'\)\) \{ gdSendToPrinter\(/.test(gd) && !/gdToFlow\('drfd', t\.getAttribute\('data-gdlines'\)\)/.test(gd)); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
