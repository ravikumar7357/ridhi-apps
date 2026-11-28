/* RECEIVE FROM THE FILLER, UNDER REC (28 Nov): a quilt line with pieces still at the filler has a Receive button in the Rec column.
 *   node tests/quilt-filler-receive-test.js
 * The real cell, form and save are cut out of src/app/orders/shp-board.js and run against stubs. */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'orders', 'shp-board.js'), 'utf8').replace(/\r\n/g, '\n');
const between = (from, to) => { const i = SRC.indexOf(from), j = SRC.indexOf(to, i + from.length); if (i < 0 || j < 0) throw new Error(from + ' not found'); return SRC.slice(i, j); };
const CELL = between('const shpbFillOf =', 'function shpbCell(');
const FORM = between("  if (act === 'fillrec') {", "  if (act === 'fill') {");
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

function board(iss, rec, may) {
  const fill = { code: 'F1', name: 'Filler One', iss: { a: { qty: iss } }, rec: rec ? { b: { qty: rec } } : {} };
  const out = { saved: null, redrawn: 0 };
  const ctx = {
    SHPB: { ready: { K: { fill } } }, SHPB_STAGE_BG: '', SHPB_PAD: '', ME: { email: 'a@x.com' },
    shpbKey: () => 'K', shpbIsQuilt: r => !!r.quilt, shpbStages: () => ({ qcD: 4 }), shpbMay: a => a === 'fill' && may,
    shpbToday: () => '2026-11-28', shpbSetReady: async (k, v) => { out.saved = v.fill; return ''; }, shpbAfter: () => { out.redrawn++; },
    voAllVendors: () => [], esc: String, nf: String, ptOpenDialog: d => d,
  };
  const F = new Function(...Object.keys(ctx), CELL + '\nreturn { cell: shpbFillCell, open: (act, r, who) => {\n' + FORM + '} };')(...Object.values(ctx));
  return Object.assign(out, F);
}
const quilt = { quilt: true, orderNo: 'SHP-1', sku: 'Q-1', qty: 4 };
const hasBtn = b => b.cell(quilt, 'K').includes('data-shpb-act="fillrec"');

(async () => {
  ok('4 issued, 3 back: Receive shows', hasBtn(board(4, 3, true)));
  ok('all back: no Receive', !hasBtn(board(4, 4, true)));
  ok('nothing issued: no Receive', !hasBtn(board(0, 0, true)));
  ok('without the filler right: no Receive', !hasBtn(board(4, 3, false)));
  ok('a line that is not a quilt: no Receive', !board(4, 3, true).cell({ qty: 4 }, 'K').includes('fillrec'));

  const b = board(4, 1, true), d = b.open('fillrec', quilt, 'SHP-1');
  ok('the form asks only pieces and date, pieces filled with the 3 still out',
    d.fields.map(f => f.key).join() === 'rec,date' && d.fields[0].value === 3 && d.fields[0].max === 3, JSON.stringify(d.fields));
  ok('blank or 0 pieces is refused and nothing saved', !!(await d.onSave({ rec: '', date: '2026-11-28' })) && !!(await d.onSave({ rec: 0 })) && !b.saved);
  ok('more than is with the filler is refused', !!(await d.onSave({ rec: 4, date: '2026-11-28' })) && !b.saved);
  const err = await d.onSave({ rec: 2, date: '2026-11-27' });
  const got = Object.values((b.saved || {}).rec || {});
  ok('2 received: added to the history, filler and issues kept, board redrawn',
    err === '' && got.map(x => x.qty).join() === '1,2' && got[1].date === '2026-11-27' && b.saved.name === 'Filler One' && b.saved.code === 'F1'
    && Object.keys(b.saved.iss).length === 1 && b.redrawn === 1, JSON.stringify([err, b.saved]));
  const none = board(4, 4, true).open('fillrec', quilt, 'SHP-1');
  ok('opened after everything came back: says so, no Save', !none.onSave && /Nothing is with the filler/.test(none.subtitle));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
