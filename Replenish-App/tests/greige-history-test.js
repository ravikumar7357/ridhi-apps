/* A FABRIC'S STOCK HISTORY ON THE GREIGE DESK INVENTORY (Ravi, 20 Nov: click the fabric name, see every in and out
 * "in the tally ledger format"). Pins the ledger page: each row opens on the last one's closing, the last closing is the
 * figure the Inventory page shows, and the two shelves (RFD on the shelf, greige in the store) keep to their own cloth.
 * Loads the real src/app/flow/greige-desk.js. Made-up fabrics and mills only.
 *   node tests/greige-history-test.js */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = path.join(__dirname, '..', 'src', 'app', 'flow', 'greige-desk.js');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

/* The desk's own closure, opened up for the test: its inner functions are handed out just before it returns. */
function desk(me) {
  const anchor = '  return { open: open,';
  const code = fs.readFileSync(SRC, 'utf8');
  if (code.split(anchor).length !== 2) throw new Error('greige-desk.js: the closing "return { open" line moved; update this test');
  const opened = code.replace(anchor, '  globalThis.__GDT = { fabShelfLedger, fabFlowRows, invFabricName, histIn, histOut, histMove, histDays, histDayName, histMonthName, histDayBadges, invNeedState, invCoverPct, invNeedCell, invActionCell, invWorthShowing, setDB: function (v) { DB = v; } };\n' + anchor);
  const ctx = { console, window: { document: {} }, ME: me || { admin: true } };
  vm.createContext(ctx);
  vm.runInContext(opened, ctx);
  return ctx.__GDT;
}

/* ---- the business, in its own words ---- */
const MASTER = [{ rfd: 'Cambric 44', greige: 'Greige Cambric 48', active: true }];
let seq = 0;
const entry = (date, txnType, qty, more) => Object.assign({ id: 'e' + (++seq), date, lot: 'LOT-1', fabricType: 'Cambric 44', txnType, qty, party: '', bill: '', orderNo: '' }, more || {});
const greigeIn = (date, qty, more) => entry(date, 'RECEIVE_GREIGE', qty, Object.assign({ fabricType: 'Greige Cambric 48', party: 'Test Mill', bill: 'TM/1', orderNo: 'PO/1' }, more));
const sentForRfd = (date, qty, more) => entry(date, 'ISSUE_TO_RFD', qty, Object.assign({ fabricType: 'Greige Cambric 48', party: 'Test Processor' }, more));
const rfdBack = (date, qty, more) => entry(date, 'RECEIVE_RFD', qty, Object.assign({ party: 'Test Processor', final: true }, more));
const openingRfd = (date, qty, more) => entry(date, 'OPENING_RFD', qty, Object.assign({ lot: 'LOT-OPEN' }, more));
const toCutting = (date, qty, more) => entry(date, 'ISSUE_TO_CUTTING', qty, Object.assign({ party: 'Cutting' }, more));
const damaged = (date, qty, state, more) => entry(date, 'DAMAGE', qty, Object.assign({ state, note: 'stain' }, more));
const closings = page => page.lines.map(l => Math.round(l.closing));

const G = desk();
const ledger = (fab, shelf, from, to) => { G.setDB({ mst: MASTER, fab, gpo: [], users: [] }); return G.fabShelfLedger(fab, 'Cambric 44', shelf, from || '', to || ''); };
const inventory = fab => { G.setDB({ mst: MASTER, fab, gpo: [], users: [] }); return G.fabFlowRows(fab).filter(e => e.fabricType === 'Cambric 44')[0]; };

console.log('== RFD on the shelf, Tally\'s way ==');
{
  const fab = [openingRfd('2026-09-22', 400), greigeIn('2026-09-25', 1200), sentForRfd('2026-09-27', 1200),
    rfdBack('2026-10-10', 1118), toCutting('2026-10-14', 320), damaged('2026-11-02', 28, 'RFD'), toCutting('2026-11-12', 300)];
  const p = ledger(fab, 'rfd');
  ok('only RFD entries are on the RFD page', p.lines.length === 5, p.lines.map(l => l.row.txnType).join());
  ok('each row opens on the last row\'s closing', p.lines.every((l, i) => i === 0 ? l.opening === 0 : l.opening === p.lines[i - 1].closing));
  ok('the running closings are right', closings(p).join() === '400,1518,1198,1170,870', closings(p).join());
  ok('in and out are split as Tally does', p.inQty === 1518 && p.outQty === 648, p.inQty + ' / ' + p.outQty);
  ok('the last closing is the RFD on shelf figure on the Inventory page', p.closing === inventory(fab).rfdLeft, p.closing + ' vs ' + inventory(fab).rfdLeft);
}

console.log('== greige in the store ==');
{
  const fab = [greigeIn('2026-09-25', 1200), sentForRfd('2026-09-27', 800), damaged('2026-09-28', 15, 'GREIGE'),
    rfdBack('2026-10-10', 760), damaged('2026-10-12', 5, 'RFD')];
  const p = ledger(fab, 'greige');
  ok('greige page holds the receipt, the issue and the greige damage only', p.lines.map(l => l.row.txnType).join() === 'RECEIVE_GREIGE,ISSUE_TO_RFD,DAMAGE');
  ok('entries written under the greige name count under the fabric', p.lines[0].inQty === 1200);
  ok('the last closing is the Greige in store figure', p.closing === inventory(fab).greigeLeft && p.closing === 385, p.closing + ' vs ' + inventory(fab).greigeLeft);
  const r = ledger(fab, 'rfd');
  ok('RFD damage comes off the RFD page, not the greige one', r.lines.length === 2 && r.closing === 755, r.closing);
}

console.log('== the date boxes ==');
{
  const fab = [openingRfd('2026-09-01', 100), rfdBack('2026-10-01', 50), toCutting('2026-10-15', 30), rfdBack('2026-10-31', 20), toCutting('2026-11-05', 10)];
  const p = ledger(fab, 'rfd', '2026-10-01', '2026-10-31');
  ok('entries before "from" make the opening', p.opening === 100, p.opening);
  ok('both edge days are counted in', p.lines.length === 3 && p.lines[0].row.date === '2026-10-01' && p.lines[2].row.date === '2026-10-31');
  ok('entries after "to" are left out', p.closing === 140, p.closing);
  const none = ledger(fab, 'rfd', '2026-12-01', '');
  ok('a range with no entries still says what the shelf held', none.lines.length === 0 && none.opening === 130 && none.closing === 130, none.closing);
  const onlyTo = ledger(fab, 'rfd', '', '2026-09-30');
  ok('a "to" alone stops the page there', onlyTo.lines.length === 1 && onlyTo.closing === 100);
}

console.log('== order, holds and neighbours ==');
{
  const fab = [toCutting('2026-10-05', 30), rfdBack('2026-10-05', 200), openingRfd('2026-10-01', 10)];
  const p = ledger(fab, 'rfd');
  ok('rows come oldest first; on one day in the order they were written', p.lines.map(l => l.row.txnType).join() === 'OPENING_RFD,ISSUE_TO_CUTTING,RECEIVE_RFD');
  ok('a cutting entered before the day\'s receipt can show a dip, as it happened', closings(p).join() === '10,-20,180', closings(p).join());

  const held = [rfdBack('2026-10-01', 500), rfdBack('2026-10-02', 90, { approval: { status: 'pending' } }), rfdBack('2026-10-03', 40, { approval: { status: 'approved' } })];
  ok('a receipt waiting for shrinkage approval is not on the shelf; an approved one is', ledger(held, 'rfd').closing === 540 && ledger(held, 'rfd').closing === inventory(held).rfdLeft);

  const mixed = [rfdBack('2026-10-01', 500), rfdBack('2026-10-01', 70, { fabricType: 'Poplin 58' }), rfdBack('2026-10-02', 5, { fabricType: 'cambric 44' })];
  ok('another fabric stays off the page; the name is matched whatever its case', ledger(mixed, 'rfd').closing === 505);

  ok('a fabric with no entries gives an empty page, not an error', (() => { const e = ledger([], 'rfd'); return e.lines.length === 0 && e.opening === 0 && e.closing === 0; })());
  ok('a shelf it does not know gives an empty page', ledger([rfdBack('2026-10-01', 5)], 'processor').lines.length === 0);

  const before = JSON.stringify(fab); ledger(fab, 'rfd');
  ok('the rows handed in are not changed or re-ordered', JSON.stringify(fab) === before);
}

console.log('== who sees the link ==');
{
  const admin = desk({ admin: true }); admin.setDB({ mst: [], fab: [], users: [] });
  ok('whoever may see the fabric ledger gets the name as a button', /<button[^>]*data-invh="Cambric 44"/.test(admin.invFabricName('Cambric 44')));
  const noLedger = desk({ email: 'staff@example.com', tabs: ['gdesk'] }); noLedger.setDB({ mst: [], fab: [], users: [] });
  ok('without fabric-ledger access the name is plain text', noLedger.invFabricName('Cambric 44') === '<b>Cambric 44</b>');
  ok('a name with odd characters is written as text, never as HTML', !/<img/.test(admin.invFabricName('<img src=x>')));
}

console.log('== a statement: the signed metres sit in the Cause, the balance at the right (Ravi, 21 Nov) ==');
{
  ok('what came in: "+1,200" in green', /color:var\(--ok-ink\)[^>]*>\+1,200</.test(G.histIn(1200)));
  ok('what went out: "−1,200" in red', /color:var\(--bad\)[^>]*>−1,200</.test(G.histOut(1200)));
  ok('a movement in shows "+", one out shows "−", none shows nothing (no "+0")',
    /\+800</.test(G.histMove({ inQty: 800, outQty: 0 })) && /−500</.test(G.histMove({ inQty: 0, outQty: 500 })) && G.histMove({ inQty: 0, outQty: 0 }) === '');
}

console.log('== an opening and a closing balance for each date (Ravi, 21 Nov) ==');
{
  /* Two receipts and an issue on 25 Sep, one issue on 27 Sep, one receipt on 10 Oct. */
  const fab = [greigeIn('2026-09-25', 800), greigeIn('2026-09-25', 200, { lot: 'LOT-2' }), sentForRfd('2026-09-25', 300),
    sentForRfd('2026-09-27', 500), greigeIn('2026-10-10', 150, { lot: 'LOT-3' })];
  const days = G.histDays(ledger(fab, 'greige').lines);
  ok('one day per date, in order', days.map(d => d.date).join() === '2026-09-25,2026-09-27,2026-10-10', days.map(d => d.date).join());
  ok('25 Sep opens on 0 and closes on 700 (800 + 200 − 300)', days[0].opening === 0 && days[0].closing === 700, days[0].opening + ' → ' + days[0].closing);
  ok('…with its in and out for that day', days[0].inQty === 1000 && days[0].outQty === 300 && days[0].lines.length === 3);
  ok('each day opens where the day before closed', days[1].opening === days[0].closing && days[2].opening === days[1].closing);
  ok('27 Sep: 700 − 500 = 200; 10 Oct: 200 + 150 = 350', days[1].closing === 200 && days[2].closing === 350);
  ok('no lines, no days', G.histDays([]).length === 0);
}

console.log('== each date folds to its opening and closing; a click shows what moved (Ravi, 21 Nov) ==');
{
  ok('a date reads with its weekday: 2026-11-20 is "Fri 20 Nov"', G.histDayName('2026-11-20') === 'Fri 20 Nov', G.histDayName('2026-11-20'));
  ok('…the right weekday across a month end: 2026-12-01 is "Tue 1 Dec"', G.histDayName('2026-12-01') === 'Tue 1 Dec');
  ok('the month heading: "November 2026"', G.histMonthName('2026-11-20') === 'November 2026');
  ok('no date, no name', G.histDayName('') === '' && G.histMonthName('') === '');
  const both = G.histDayBadges({ inQty: 594, outQty: 300 });
  ok('a folded date shows what moved as labels: "+594 in" green, "−300 out" red', /pill-ok[^>]*>\+594 in</.test(both) && /pill-out[^>]*>\u2212300 out</.test(both));
  ok('…only what moved — never "+0 in" or "−0 out"', !/0 out/.test(G.histDayBadges({ inQty: 594, outQty: 0 })) && !/in</.test(G.histDayBadges({ inQty: 0, outQty: 300 })));
  const code = fs.readFileSync(SRC, 'utf8');
  ok('a date opens only when clicked (each date remembers itself), and Open all opens every one',
    /if \(on\) h \+= d\.lines\.map/.test(code) && /INV_HIST\.open\[day\] = !INV_HIST\.open\[day\]/.test(code) && /function invHistOpenAll\(\)/.test(code));
  ok('opening a fabric starts with every date folded', /INV_HIST\.to = ''; INV_HIST\.open = \{\};/.test(code));
  ok('the period on top in four figures: Opening, Came in, Went out, Closing',
    /figure\('Opening'/.test(code) && /figure\('Came in'/.test(code) && /figure\('Went out'/.test(code) && /figure\('Closing'/.test(code));
  ok('a movement is labelled "in" (green) when cloth came in, "out" (red) when it went out',
    /\(came \? '<span class="pill pill-ok" title="came in">in<\/span>' : '<span class="pill pill-out" title="went out">out<\/span>'\)/.test(code));
}

console.log('== the Inventory, laid out to act on (Ravi, 21 Nov) ==');
{
  const row = (need, free, short, greigeM, greige) => ({ fabric: 'Canvas', ppc: { name: 'Canvas', need, lines: 39, free, desk: free, short, onWay: 0, greigeM, greige } });
  const shortRow = row(6772, 594, 6178, 7040, 'Canvas 48" Greige'), coveredRow = row(547, 1022, 0, 0, 'Duck 64" Greige');
  ok('what PPC asks of a fabric: short, covered, or none',
    G.invNeedState(shortRow) === 'short' && G.invNeedState(coveredRow) === 'ok' && G.invNeedState({ ppc: null }) === 'none' && G.invNeedState(row(0, 0, 0, 0, '')) === 'none');
  ok('short but covered by greige on its way counts as covered', G.invNeedState(row(500, 100, 400, 0, 'X')) === 'ok');
  ok('the bar: 594 of 6,772 is 9% covered; more free than needed stops at 100%', G.invCoverPct(shortRow.ppc) === 9 && G.invCoverPct(coveredRow.ppc) === 100);
  const need = G.invNeedCell(shortRow, false);
  ok('the need cell: metres, lines, the bar and "9% covered · 6,178 short"', /<b>6,772 m<\/b>/.test(need) && /39 lines/.test(need) && /width:9%/.test(need) && /9% covered/.test(need) && /6,178 short/.test(need));
  ok('a fabric PPC does not need says so', /no PPC demand/.test(G.invNeedCell({ ppc: null }, false)));
  ok('Action: a short fabric gets "Raise PO · 7,040 m" (the same greige PO as before)', /data-ppcpo="Canvas\|7040"[^>]*>Raise PO · 7,040 m</.test(G.invActionCell(shortRow, false)));
  /* Ravi, 21 Nov: "remove those fabrics from inventory completely whose says add greige name" */
  const noName = (stock) => Object.assign(row(75, 0, 75, 79, ''), { owned: stock, onOrder: 0 });
  ok('a short fabric with no greige name is left out of the Inventory, even with cloth on the shelf',
    G.invWorthShowing(noName(0)) === false && G.invWorthShowing(noName(120)) === false);
  ok('…and no row anywhere says "add greige name" any more', !/add greige name/.test(G.invActionCell(row(75, 0, 75, 79, ''), false)) && !/data-ppcpo/.test(G.invActionCell(row(75, 0, 75, 79, ''), false)));
  ok('a short fabric with a greige name stays, even with no stock', G.invWorthShowing(Object.assign(row(75, 0, 75, 79, 'Canvas Greige'), { owned: 0, onOrder: 0 })) === true);
  ok('a covered fabric stays, and so does one with only stock or only a PO and no PPC need',
    G.invWorthShowing(Object.assign(row(547, 1022, 0, 0, ''), { owned: 0, onOrder: 0 })) === true
    && G.invWorthShowing({ ppc: null, owned: 40, onOrder: 0 }) === true && G.invWorthShowing({ ppc: null, owned: 0, onOrder: 900 }) === true);
  ok('a fabric with nothing at all stays out', G.invWorthShowing({ ppc: null, owned: 0, onOrder: 0 }) === false && G.invWorthShowing({ ppc: null, owned: 0.04, onOrder: 0 }) === false);
  ok('the Inventory list uses this one rule', /\}\)\.filter\(invWorthShowing\)/.test(fs.readFileSync(SRC, 'utf8')));
  ok('…a covered fabric shows "covered"', /pill-ok">covered</.test(G.invActionCell(coveredRow, false)));
  const code = fs.readFileSync(SRC, 'utf8');
  ok('a filter by what needs doing: All · Short for PPC · Covered · No PPC demand', /\['all', 'short', 'ok', 'none'\]\.map/.test(code) && /data-invshow="' \+ k \+ '"/.test(code));
  ok('short fabrics come first, then covered, then those not needed', /var INV_SHOW_ORDER = \{ short: 0, ok: 1, none: 2 \};/.test(code));
  ok('the stock columns sit under "Where the cloth is now →"', /Where the cloth is now (→|\\u2192)/.test(code));
  ok('the long note is gone from the toolbar', !/PPC demand is what the production plans need in RFD; short is after the RFD free today/.test(code));
  ok('no Total row under the Inventory (metres of different cloths added together)', !/<tfoot><tr><td class="frz" style="text-align:left">Total/.test(code));
  ok('"18 lines" is a link to Demand → RFD for that fabric', /data-gdlines="Canvas"[^>]*>39 lines</.test(need) && /if \(t\.getAttribute\('data-gdlines'\)\) \{ gdToFlow\('drfd', t\.getAttribute\('data-gdlines'\)\)/.test(code));
}

console.log('== the lines open Demand → RFD with only that fabric (Ravi, 21 Nov) ==');
{
  /* The real gdToFlow, run against a pretend app page: its tab switch and the flow's search box. */
  const code = fs.readFileSync(SRC, 'utf8'), anchor = '  return { open: open,';
  const box = { value: 'old search' }, seen = {};
  const ctx = { console, window: { document: { getElementById: id => (id === 'flQ' ? box : null) } },
    showTab: t => { seen.tab = t; }, ensureFlow: () => { seen.drawn = box.value; } };
  vm.createContext(ctx);
  vm.runInContext(code.replace(anchor, '  globalThis.__T = { gdToFlow: gdToFlow, view: function () { return FLOW_VIEW; } };\n' + anchor), ctx);
  ctx.FLOW_VIEW = 'ppc';
  ctx.__T.gdToFlow('drfd', 'Canvas');
  ok('a click on the lines opens the flow on Demand → RFD', seen.tab === 'flow' && ctx.FLOW_VIEW === 'drfd');
  ok('…with the fabric in its search box, before the list is drawn', box.value === 'Canvas' && seen.drawn === 'Canvas');
  ctx.__T.gdToFlow('drfd', '');
  ok('the plain Demand → RFD button clears it, so the whole list shows',
    box.value === '' && seen.drawn === '' && /if \(t\.getAttribute\('data-gdflow'\)\) \{ gdToFlow\(t\.getAttribute\('data-gdflow'\), ''\);/.test(code));
  /* Ravi, 21 Nov: Send to printer "should open the list of those products which needs that fabric";
   * Vishesh, 23 Nov: it makes that fabric's RFD challan right here (the card itself is tested in flow-test.js) */
  ok('Send to printer on an RFD lot opens the RFD challan card for that fabric, on the Inventory page',
    code.includes(`data-gdsend="' + esc(r.fabric) + '" title="Make an RFD challan to a printer for the products waiting for ' + esc(r.fabric) + '">Send to printer</button>`)
    && /if \(t\.getAttribute\('data-gdsend'\)\) \{ gdSendToPrinter\(t\.getAttribute\('data-gdsend'\)\); return; \}/.test(code)
    && /flowShelfChallanOpen\(fabric, function/.test(code) && !code.includes('data-gdflow="drfd">Send to printer'));
  ok('…and without the flow in the page it still opens that fabric\'s lines on Demand → RFD',
    /if \(typeof flowShelfChallanOpen !== 'function'\) \{ gdToFlow\('drfd', fabric\); return; \}/.test(code));
}

console.log('== the Inventory\'s cloth types: one drop-down beside the search box (Ravi, 21 Nov) ==');
{
  const code = fs.readFileSync(SRC, 'utf8');
  ok('a place for it sits before the search box', /<div class=\\"topacts\\"><span id=\\"lmTopPick\\" class=\\"toppick\\"><\/span><input id=\\"lmQ\\"/.test(code));
  ok('the Inventory fills it with "All (n)" first, then every type with its count',
    /\$\('lmTopPick'\)\.innerHTML = '<select id="invType" aria-label="Type of cloth">'\s*\+ \['all'\]\.concat\(types\)/.test(code) && /esc\(t === 'all' \? 'All' : t\) \+ ' \(' \+ count\(t\) \+ '\)<\/option>'/.test(code));
  ok('every other screen leaves it empty', /\$\('lmTopPick'\)\.innerHTML = '';/.test(code));
  ok('choosing a type filters the Inventory', /if \(ev\.target\.id === 'invType'\) \{ UI\.inv = ev\.target\.value \|\| 'all';/.test(code));
  ok('the old row of chips is gone', !/role="tablist" aria-label="Type of cloth"/.test(code) && !/data-inv="' \+ esc\(t\)/.test(code));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
