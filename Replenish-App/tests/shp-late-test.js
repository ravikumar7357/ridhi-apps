/* THE SHP BOARD'S LATE COLOURS (Ravi, 16 Nov — MIS meeting, printer delays; in place of "Stuck > 24h" of 13 Nov).
 *   node tests/shp-late-test.js
 * The real rule is cut out of src/app/orders/shp-board.js and run against stubs, today = 16 Nov 2026. A pending line is measured at
 * the first stage holding its pieces against the date PPC planned for that stage — printer receive and cut: the Cut date; issue,
 * receive and QC: the QC date; press and shipping: the Ready date — red once past it, yellow on it and the day before, white
 * otherwise; with no date for that stage, red after 7 days with nothing done (every day counted). */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const SRC = rd(path.join(__dirname, '..', 'src', 'app', 'orders', 'shp-board.js'));
const CSS = rd(path.join(__dirname, '..', 'src', 'styles.css'));
const cut = name => { const i = SRC.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return SRC.slice(i, SRC.indexOf('\n}', i) + 2); };
const line = head => { const i = SRC.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return SRC.slice(i, SRC.indexOf('\n', i)) + '\n'; };
const block = head => { const i = SRC.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return SRC.slice(i, SRC.indexOf('];', i) + 2) + '\n'; };
const PARTS = [block('const SHPB_STAGES ='), line('const SHPB_LATE_DAYS ='), line('const SHPB_DUE_OF ='), line('const SHPB_DUE_NAME ='), line('const shpbDaysBetween ='),
  cut('shpbStageNow'), cut('shpbStageDue'), cut('shpbLateNow')].join('\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

/* A line is described by where its pieces wait (W per stage), its plan dates, its ready date and its last move. */
const ctx = {
  shpbStages: lines => Object.assign({}, lines[0].w), shpbPlanOf: r => r.plan || null, shpbReadyOf: r => ({ date: r.ready || '' }),
  shpbLastMove: r => r.last || '', shpbStatusInfo: r => ({ label: r.at || 'At printer' }), nf: n => String(n),
  shpbDmy: iso => String(iso).split('-').reverse().join('-'),
};
const F = new Function(...Object.keys(ctx), PARTS + '\nreturn { shpbLateNow, shpbStageNow, shpbStageDue, shpbDaysBetween };')(...Object.values(ctx));
const T = '2026-11-16';
const L = o => Object.assign({ open: true, w: {}, plan: { dates: { cut: '2026-11-20', qc: '2026-11-25', ready: '2026-11-30' } }, ready: '2026-11-30', last: '2026-11-15' }, o);
const tone = r => (F.shpbLateNow(r, T) || {}).tone || '';

/* which date each stage is measured against */
ok('at the printer: measured against the Cut date', F.shpbStageDue(L(), 'prcv') === '2026-11-20' && F.shpbStageNow(L({ w: { prcW: 5 } })) === 'prcv');
ok('cut → Cut date; issue, receive, QC → QC date; press and shipping → Ready date',
  F.shpbStageDue(L(), 'cut') === '2026-11-20' && ['issue', 'receive', 'qc'].every(s => F.shpbStageDue(L(), s) === '2026-11-25')
  && F.shpbStageDue(L(), 'press') === '2026-11-30' && F.shpbStageDue(L(), 'hand') === '2026-11-30');
ok('the stage now is the first one holding pieces (some at the printer, some already with a karigar → the printer)',
  F.shpbStageNow(L({ w: { prcW: 2, recW: 3 } })) === 'prcv' && F.shpbStageNow(L({ w: { qcW: 1, prsW: 4 } })) === 'qc');

/* red / yellow / white against that date */
ok('past its Cut date at the printer (cut 15 Nov, today 16 Nov) → red', tone(L({ w: { prcW: 5 }, plan: { dates: { cut: '2026-11-15' } } })) === 'late');
ok('Cut date today → yellow; Cut date tomorrow → yellow', tone(L({ w: { cutW: 5 }, plan: { dates: { cut: T } } })) === 'near'
  && tone(L({ w: { cutW: 5 }, plan: { dates: { cut: '2026-11-17' } } })) === 'near');
ok('Cut date in 2 days → white', tone(L({ w: { cutW: 5 }, plan: { dates: { cut: '2026-11-18' } } })) === '');
ok('with a karigar past the QC date → red, even though the Cut date is long gone', tone(L({ w: { recW: 3 }, plan: { dates: { cut: '2026-11-01', qc: '2026-11-14' } } })) === 'late');
ok('waiting to be pressed, Ready date tomorrow → yellow', tone(L({ w: { prsW: 2 }, ready: '2026-11-17' })) === 'near');
const red = F.shpbLateNow(L({ w: { prcW: 5 }, at: 'At printer', last: '2026-10-20', plan: { dates: { cut: '2026-11-10' } } }), T);
ok('a red line keeps where it waits and since when, and says why', red.at === 'At printer' && red.since === '2026-10-20' && /6 days past its Cut date \(10-11-2026\)/.test(red.why), JSON.stringify(red));

/* no date for the stage: the 7-day rule, every day counted */
ok('not planned yet, nothing done for 7 days → red', tone(L({ w: { planW: 5 }, plan: null, ready: '', last: '2026-11-09' })) === 'late');
ok('…for 6 days → white', tone(L({ w: { planW: 5 }, plan: null, ready: '', last: '2026-11-10' })) === '');
ok('a stage with no date set, still moving → white', tone(L({ w: { issW: 2 }, plan: { dates: {} }, last: '2026-11-14' })) === '');

/* not coloured */
ok('a closed line, or one with nothing waiting → white', tone(L({ open: false, w: { prcW: 5 }, plan: { dates: { cut: '2026-11-01' } } })) === '' && tone(L({ w: {} })) === '');

/* the last move is read off the line's own flow dates (dd-mm-yyyy) — on 16 Nov a copy of this lost its pattern and read none, so
 * no undated line could ever turn red */
const LM = new Function('shpbSteps', cut('shpbLastMove') + '\nreturn shpbLastMove;')(r => r.steps);
ok('the last move is the newest day in the line\'s flow (20-10-2026, 05-11-2026 → 2026-11-05); none → ""',
  LM({ steps: [{ when: 'ordered 20-10-2026' }, { when: 'QC 05-11-2026 · 4 pcs' }, { when: '' }] }) === '2026-11-05' && LM({ steps: [{ when: 'not yet' }] }) === '', LM({ steps: [{ when: 'ordered 20-10-2026' }, { when: 'QC 05-11-2026 · 4 pcs' }] }));

/* on the board */
ok('the row takes the colour and a red one keeps "last step"', /tr class="vo-' \+ dl\.tone \+ '"/.test(SRC) && /dl && dl\.tone === 'late' \? `<div[^`]*last step:/.test(SRC));
ok('the Stuck pill and the "Stuck > 24h" button are gone; the button is "Late" and filters the red lines',
  !/Stuck \$\{nf|Stuck &gt; 24h|shpbStuck/.test(SRC) && /">Late · \$\{nf\(n\)\}<\/button>/.test(SRC) && /SHPB\.late && SHPB\.tab !== 'done'\) list = list\.filter/.test(SRC));
ok('the colours cover the whole row, the peach stage cells too', /#odTable tbody tr\.vo-late td\{background:var\(--bad-bg\) !important\}/.test(CSS)
  && /#odTable tbody tr\.vo-near td\{background:var\(--warn-bg\) !important\}/.test(CSS));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
