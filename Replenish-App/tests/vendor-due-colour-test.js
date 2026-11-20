/* THE VENDOR PORTAL'S ROW COLOURS (Ravi, 16 Nov — MIS meeting, printer delays): red once a line is past its due date, yellow on
 * the due day and the day before, white otherwise; a line waiting for cloth from us stays white.
 *   node tests/vendor-due-colour-test.js
 * The real functions are cut out of src/ (vendor-orders.js voDays / voDueOf / voDueTone, vendor-portal.js vpDueClass) and run
 * against stubs, today = 16 Nov 2026. Every list of the portal — the custom sheet, the order table, the single order, the two card
 * boards — must take its colour from vpDueClass. */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const VP = rd(path.join(APP, 'vendors/portal/vendor-portal.js')), VO = rd(path.join(APP, 'vendors/orders/vendor-orders.js'));
const CSS = rd(path.join(__dirname, '..', 'src', 'styles.css'));
const cut = (src, name) => { const i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return src.slice(i, src.indexOf('\n}', i) + 2); };
const line = (src, head) => { const i = src.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return src.slice(i, src.indexOf('\n', i)) + '\n'; };
const PARTS = [cut(VO, 'voDays'), line(VO, 'const VO_SOON ='), line(VO, 'const VO_DUE_CTX ='), cut(VO, 'voFlowCtx'), line(VO, 'const voParts ='),
  cut(VO, 'voDueOf'), cut(VO, 'voDueTone'), line(VP, 'const vpDueClass =')].join('\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

const ctx = {
  dToday: () => '2026-11-16', voLines: o => o.lines || [], voQty: (o, l) => +l.qty || 0, voDone: l => +l.done || 0,
  voDue: l => l.due || '', voUnit: () => 'pcs',
};
const F = new Function(...Object.keys(ctx), PARTS + '\nreturn { voDueOf, voDueTone, vpDueClass };')(...Object.values(ctx));
const order = { lines: [] }, ln = o => Object.assign({ qty: 10, done: 0 }, o);
const tone = l => F.vpDueClass(F.voDueOf(order, l));

ok('past the due date (15 Nov, today 16 Nov) → red', tone(ln({ due: '2026-11-15' })) === 'vo-late', tone(ln({ due: '2026-11-15' })));
ok('due today → yellow', tone(ln({ due: '2026-11-16' })) === 'vo-near');
ok('due tomorrow → yellow', tone(ln({ due: '2026-11-17' })) === 'vo-near');
ok('due in 2 days → white', tone(ln({ due: '2026-11-18' })) === '');
ok('no due date → white', tone(ln({ due: '' })) === '');
ok('all received → white, even past its date', tone(ln({ due: '2026-11-01', done: 10 })) === '');
ok('part received, past its date → still red for what is left', tone(ln({ due: '2026-11-10', done: 4 })) === 'vo-late');
/* waiting for cloth from us: the flow gave the printer nothing on this order yet — our delay, not the printer's */
const waiting = { flowProg: { given: 0, back: 0 }, lines: [] }, wl = ln({ due: '2026-11-01', flowPart: 'SHP-1__T1|sku' });
waiting.lines.push(wl);
ok('past its date but waiting for cloth from us → white', F.voDueOf(waiting, wl).st === 'wait' && F.vpDueClass(F.voDueOf(waiting, wl)) === '', JSON.stringify(F.voDueOf(waiting, wl)));

/* every list of the portal takes the colour */
const uses = (VP.match(/vpDueClass\(/g) || []).length;
ok('the custom sheet, the order table, the single order and the two card boards all colour their lines (5 places)', uses === 5, String(uses));
ok('the colours are in the stylesheet: red rows, yellow rows, red and yellow cards',
  /table\.xl tbody tr\.vo-late td\{background:var\(--bad-bg\)\}/.test(CSS) && /table\.xl tbody tr\.vo-near td\{background:var\(--warn-bg\)\}/.test(CSS)
  && /\.vpb-line\.vo-late\{background:var\(--bad-bg\)\}/.test(CSS) && /\.vpb-line\.vo-near\{background:var\(--warn-bg\)\}/.test(CSS));

/* the table shades every second row grey (tbody tr:nth-child(even) td); the colours must come after it and be as strong, or every
 * other late row shows white — it did on the first try, 16 Nov */
ok('…and they win over the grey shading of every second row', CSS.indexOf('table.xl tbody tr:nth-child(even) td') > 0
  && CSS.indexOf('table.xl tbody tr.vo-late td') > CSS.indexOf('table.xl tbody tr:nth-child(even) td'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
