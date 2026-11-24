/* Placement (src/app/ads/placement.js, the chart and the two tables; src/app/ads/placement-decide.js, the decisions) over the
 * real files in the stub page ppc-history-test.js builds, with one small campaign.
 *   node tests/placement-test.js
 * Covers (22 Nov review): each half labelled with its window (cards, heading, column tips; the chart and lower tables), one
 * name for the spend with no orders everywhere, Decision and Action right after the first column with sorting still working,
 * "+$0.30 last 7 days" in cents under $1 and the same rule on every row, the chart sized to its card with clean y-axis steps
 * and a partial day / week marked, Placement's "no target" chip in N-Gram's words, and the luck cut-off in How Sellora decides.
 * 24 Nov: the bar shared with Search Term Analysis / N-Gram — filters matched through each campaign's ad groups → products,
 * decisions unchanged by filters, the 7-day window giving no Raise / Lower, 14 / 60 greyed until their caches exist, counts
 * that agree, blanks sorted last, and no hidden target (the warning at the top). */
const fs = require('fs'), path = require('path');
const { setup } = require('./ppc-history-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const NAMES = ['ST', 'STA', 'STA_NOTGT', 'PLX_CHIPS', 'plxRecLine', 'plxWinTxt', 'renderPlx', 'plxLegend', 'renderPlc', 'plcNiceStep', 'plcPartial', 'plcAxis',
  'PLC_WIN', 'PLC_NOORD', 'setPlc: v => { PLC = v; }', 'getSort: () => PLX_SORT',
  'STA_F', 'plxCampPass', 'plxModel', 'plxWinOn', 'staFChips', 'STA_SET_DEF', 'STS',
  'setWin: k => { STA_WIN = k; }', 'getLast: () => PLX_LAST', 'setPlxSort: s => { PLX_SORT = s; }'];
// Today in Amazon's own date (Pacific), and n days before it.
const pt = n => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(Date.now() - (n || 0) * 86400000));

function page() {
  const S = setup({ plc: true, names: NAMES });
  const { C, $ } = S;
  const ST = C.ST;
  ST.loaded = true; ST.extra = true; ST.costs = false;
  ST.plc = { from: '2026-10-14', to: '2026-11-12', d: { SP: { from: '2026-10-14', to: '2026-11-12', rows: [
    { cid: 'c1', cn: 'SP - Runner - Broad', p: 'Top of Search on-Amazon', i: 5000, c: 200, sp: 150, o: 12, s: 600 },
    { cid: 'c1', cn: 'SP - Runner - Broad', p: 'Other on-Amazon', i: 3000, c: 100, sp: 60, o: 0, s: 0 },
    { cid: 'c1', cn: 'SP - Runner - Broad', p: 'Detail Page on-Amazon', i: 2000, c: 50, sp: 20, o: 1, s: 40 },
  ] } } };
  // The last 7 days (not counted): 30 cents on one click, $14.60, and nothing at all on the product page.
  ST.plcr = { d: { SP: { rows: [{ cid: 'c1', p: 'Top of Search on-Amazon', sp: 0.3, c: 1 }, { cid: 'c1', p: 'Other on-Amazon', sp: 14.6, c: 20 }] } } };
  ST.ent = { d: { SP: { cp: { c1: ['SP - Runner - Broad', 'ENABLED', 50, 'LEGACY_FOR_SALES', 20, 0, 10, 'MANUAL', 0] } } } };
  ST.src = {};
  $('plcBrand').value = 'SP';
  $('panePlc').classList.remove('hide');
  return S;
}
// The nightly placement cache: 30 days, about $6–8.5k a day, the last ~$9.4k.
function nightly(withToday) {
  const byDate = {};
  for (let i = 30; i >= 1; i--) {
    const sp = i === 1 ? 9400 : 6000 + (i * 83) % 2500;
    byDate[pt(i)] = { 'Top of Search on-Amazon': [1000, 300, sp * 0.6, 20, sp], 'Other on-Amazon': [800, 200, sp * 0.4, 0, 0] };
  }
  if (withToday) byDate[pt(0)] = { 'Top of Search on-Amazon': [100, 30, 900, 2, 1800] };
  return { at: '21 Nov, 06:10', d: { SP: { byPlace: { 'Top of Search on-Amazon': [30000, 9000, 140000, 600, 300000], 'Other on-Amazon': [24000, 6000, 90000, 0, 0] },
    mis: { 'Other on-Amazon': 90000 }, byDate, worst: [{ cn: 'SP - Runner - Broad', p: 'Other on-Amazon', c: 6000, sp: 90000 }] } } };
}

console.log('== the decisions: their window, the columns, the last 7 days ==');
{
  const { C, $ } = page();
  C.renderPlx();
  const t = $('plxTable').innerHTML, head = t.slice(0, t.indexOf('</thead>'));
  const cols = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => strip(m[1]).replace(/[↓↑]/g, '').trim());
  ok('Decision and Action come right after "Campaign · placement", before the numbers', cols[0] === 'Campaign · placement' && cols[1] === 'Decision' && cols[2] === 'Action' && cols[3] === 'Now', cols.join(' | '));
  ok('Impr. is no column; impressions are in the Clicks tip', !cols.includes('Impr.') && /title="5,000 impressions">200</.test(t));
  ok('every number column\'s tip names the window: "Settled 14 Oct – 12 Nov · 7-day sales"', ['Clicks', 'Spend', 'Sales', 'Orders', 'ACoS', 'CPC', 'CVR'].every(c => new RegExp(`title="Settled 14 Oct – 12 Nov · 7-day sales[^"]*"[^>]*>${c}`).test(head)), head.slice(0, 400));
  ok('the heading says the window', $('plxWin').textContent === 'Settled 14 Oct – 12 Nov · 7-day sales');
  ok('the cards say it too', /<span>Settled 14 Oct – 12 Nov<\/span><span>7-day sales<\/span>/.test($('plxKpis').innerHTML), strip($('plxKpis').innerHTML).slice(0, 200));
  // One row's cells: the decision, then the action, then the numbers.
  const tos = t.slice(t.indexOf('Top of Search</td>'));
  ok('a placement row: decision cell, action cell, then Now', tos.indexOf('plx-dec') < tos.indexOf('plx-actc') && tos.indexOf('plx-actc') < tos.indexOf('+20%'), strip(tos.slice(0, 400)));
  // The last 7 days.
  ok('"+$0.30 last 7 days": cents under $1, never "+$0"', /\+\$0\.30 last 7 days/.test(t) && !/\+\$0 last/.test(t));
  ok('"+$15 last 7 days" in whole dollars from $1', /\+\$15 last 7 days/.test(t));
  ok('no line when the last 7 days had no clicks and no spend (Product Page)', (() => { const i = t.indexOf('Product Page</td>'); const row = t.slice(i, t.indexOf('</tr>', i)); return !/last 7 days/.test(row); })());
  ok('the campaign row follows the same rule: its own last 7 days', (() => { const i = t.indexOf('plx-camp'); const row = t.slice(i, t.indexOf('</tr>', i)); return /\+\$15 last 7 days/.test(row); })());
  ok('plxRecLine: cents under $1, whole dollars from $1, a click with no spend still shows, nothing otherwise',
    /\+\$0\.30 last/.test(C.plxRecLine(0.3, 1)) && /\+\$0\.00 last/.test(C.plxRecLine(0, 2)) && /\+\$12 last/.test(C.plxRecLine(12.4, 5)) && /\+\$1 last/.test(C.plxRecLine(1, 1)) && C.plxRecLine(0, 0) === '');
  // Sorting still works.
  $('plxTable').listeners.click.forEach(f => f({ target: { closest: s => (s === '[data-sort]' ? { dataset: { sort: 'c' } } : null) } }));
  ok('sorting still works (Clicks)', C.getSort().k === 'c' && /plx-sort on" data-sort="c"/.test($('plxTable').innerHTML));
  // 13 orders, no unit cost: N-Gram's words.
  ok(`no target: the chip reads "${C.STA_NOTGT}", as on N-Gram Analysis`, C.PLX_CHIPS.find(c => c[0] === 'notgt')[1] === C.STA_NOTGT && $('plxActBar').innerHTML.includes(C.STA_NOTGT)
    && t.includes(C.STA_NOTGT + ': no unit cost'), strip($('plxActBar').innerHTML));
  C.plxLegend();
  const lg = strip($('plxLegendBody').innerHTML);
  ok('How Sellora decides: the luck cut-off, 5% for a placement and 1% for a negative, and why', /under 5% of the time/.test(lg) && /needs under 1%/.test(lg) && /harder to undo/.test(lg), lg.slice(0, 200));
  ok('…and that the lower half is a different report', /last 30 days with 30-day sales/.test(lg) && /differ slightly/.test(lg));
}

console.log('== the lower half: its window, one name for the spend with no orders ==');
{
  const { C, $, els } = page();
  els.plcChart = Object.assign($('plcChart'), { clientWidth: 1180 });
  C.setPlc(Object.assign(nightly(false), { loaded: true }));
  C.renderPlc();
  const tb = $('plcTable').innerHTML, wo = $('plcWorst').innerHTML;
  ok('the placement table: "Spend with no orders", each tip "Last 30 days · 30-day sales"', /title="Last 30 days · 30-day sales · spend on clicks[^"]*">Spend with no orders</.test(tb) && (tb.match(/title="Last 30 days · 30-day sales/g) || []).length === 8, strip(tb.slice(0, 300)));
  ok('the worst offenders: the same name', /Spend with no orders<\/th>/.test(wo) && !/nothing back/.test(wo));
  ok('the chart line: "… spend with no orders"', /spend with no orders/.test($('plcChSub').innerHTML) && !/bought nothing/.test($('plcChSub').innerHTML));
  const SRC = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const all = ['app/ads/placement.js', 'app/ads/placement-decide.js'].map(SRC).join('\n');
  const html = SRC('index.html');
  const pane = html.slice(html.indexOf('<div id="panePlc"'), html.indexOf('<!-- /panePlc -->'));
  ok('no other name for it is left in Placement (code, export, headings)', !/misallocation|bought nothing|nothing back|wasted spend|that bought/i.test(all.replace(/it was "spend misallocation", "bought nothing",\s*\n?\s*\* "spend, nothing back" and "wasted spend"/, '')) && !/misallocation|bought nothing|nothing back|wasted/i.test(pane));
  ok('the headings of the lower half say their window, and one line says the totals differ', (pane.match(/<span class="plx-win">Last 30 days · 30-day sales<\/span>/g) || []).length === 3
    && /<p class="plx-split">From a different report than the decisions above, so totals differ slightly\.<\/p>\s*<div class="card plx-chcard">/.test(pane));
  // The chart.
  const svg = $('plcChart').innerHTML;
  ok('the chart takes the card\'s full width (1180 px here), not 640', /<svg width="1180"/.test(svg), svg.slice(0, 80));
  const ticks = [...svg.matchAll(/text-anchor="end"[^>]*>([^<]+)</g)].map(m => m[1]);
  ok(`clean y-axis steps, at most 6 lines: ${ticks.join(' ')}`, ticks.join(' ') === '$0 $2k $4k $6k $8k $10k', ticks.join(' '));
  ok('plcNiceStep: 1 / 2 / 5 × 10^n', C.plcNiceStep(9400, 5) === 2000 && C.plcNiceStep(4200, 5) === 1000 && C.plcNiceStep(23000, 5) === 5000 && C.plcNiceStep(130, 5) === 50 && C.plcNiceStep(0.5, 5) === 0.2);
  ok('the last bar is a full day (yesterday, Amazon\'s date): no "partial day" mark', !/partial day/.test(svg));
  C.setPlc(Object.assign(nightly(true), { loaded: true }));
  C.renderPlc();
  ok('a day from today on is marked "partial day"', /class="plc-part"[^>]*>partial day</.test($('plcChart').innerHTML) && /fill-opacity="\.45"/.test($('plcChart').innerHTML));
  ok('plcPartial: weeks cut by the window\'s first or last day are partial; whole ones are not', C.plcPartial('2026-11-15', 1, ['a', 'b', 'c'], '2026-10-20', '2026-11-19') === ''
    && (() => { $('plcGranSeg').listeners.click.forEach(f => f({ target: { closest: () => ({ dataset: { g: 'week' } }) } })); const a = C.plcPartial('2026-10-18', 0, ['2026-10-18', 'x'], '2026-10-20', '2026-11-19'); const b = C.plcPartial('2026-11-15', 1, ['x', '2026-11-15'], '2026-10-11', '2026-11-19'); const c = C.plcPartial('2026-10-11', 0, ['2026-10-11', 'x'], '2026-10-11', '2026-11-19'); return a === 'partial week' && b === 'partial week' && c === ''; })());
}


console.log('== 24 Nov: the same bar, filters, date window, target warning and help as Search Term Analysis / N-Gram ==');
{
  const { C, $ } = page();
  const ST = C.ST;
  ST.ent.d.SP.cp.c1[5] = 20;   // Rest of Search at +20% now, so its 0 orders in 100 clicks is a real Lower (not "already at 0%")
  const clearF = () => { ['par', 'asin', 'cp'].forEach(k => C.STA_F[k].clear()); C.STA_F.stock = ''; };
  // Filter matching through each campaign's ad groups → products (staModel's agInfo).
  const M = { brands: ['SP'], agInfo: { SP: new Map([['a1', { cid: 'c1', asins: ['B0RUN'], parents: ['P-RUN'] }], ['a2', { cid: 'c1', asins: ['B0MAT'], parents: ['P-MAT'] }],
    ['a3', { cid: 'c2', asins: ['B0NAP'], parents: ['P-NAP'] }]]) } };
  C.STA_F.asin.add('SP|B0MAT');
  ok('a campaign matches a product filter when any of its ad groups advertises it (c1 has the mat in its second ad group; c2 does not)',
    C.plxCampPass('SP', 'c1', M) === true && C.plxCampPass('SP', 'c2', M) === false);
  clearF(); C.STA_F.par.add('SP|P-NAP');
  ok('…a parent product the same way; a campaign the filter names directly', C.plxCampPass('SP', 'c2', M) && !C.plxCampPass('SP', 'c1', M)
    && (() => { clearF(); C.STA_F.cp.add('SP|c1'); return C.plxCampPass('SP', 'c1', M) && !C.plxCampPass('SP', 'c2', M); })());
  clearF();
  ok('…no filter: every campaign passes', C.plxCampPass('SP', 'c2', M) && C.plxCampPass('SP', 'cX', M));
  // Decisions unchanged by filters (judged on the whole campaign), on both halves.
  C.renderPlx();
  const decOf = P => P.camps.flatMap(x => x.rows.map(r => r.key + ':' + r.dec + ':' + (r.to == null ? '' : r.to))).join('|');
  const before = decOf(C.getLast());
  C.STA_F.cp.add('SP|cX');
  C.renderPlx();
  const P1 = C.getLast();
  ok('filters only narrow what is shown: nothing matches cX, and every decision is the same as without it', decOf(P1) === before && P1.all.length === 0 && P1.total === 1
    && /Nothing matches these filters/.test($('plxTable').innerHTML), before);
  ok('…the chips say it in campaigns: "Showing 0 of 1 campaigns"', /Showing 0 of 1 campaigns/.test($('plcChips').innerHTML), $('plcChips').innerHTML.slice(0, 120));
  C.setPlc(Object.assign({ at: '21 Nov', d: { SP: { byPlace: {}, mis: {}, byDate: {}, worst: [{ cn: 'SP - Runner - Broad', p: 'Other on-Amazon', c: 60, sp: 30 }] } } }, { loaded: true }));
  C.renderPlc();
  ok('…the table of spend with no orders below follows the filters too (per campaign); the chart line says the chart and totals are every campaign',
    !/SP - Runner - Broad/.test($('plcWorst').innerHTML) && /not split by campaign/.test($('plcChSub').innerHTML));
  clearF(); C.STA_F.cp.add('SP|c1');
  C.renderPlc();
  ok('…and shows the campaign the filter picks', /SP - Runner - Broad/.test($('plcWorst').innerHTML));
  clearF();
  // Counts agree: the proposals card, the chips and the table, for the same set.
  C.renderPlx();
  const P = C.getLast(), nRL = P.rowsAll.filter(r => r.dec === 'raise' || r.dec === 'lower').length;
  const chipN = k => { const m = new RegExp(`data-a="${k}"[^>]*>[^<]*<span>(\\d+)`).exec($('plxActBar').innerHTML); return m ? Number(m[1]) : 0; };
  ok(`counts agree: the proposals card (${nRL}) = the Raise + Lower chips = the rows of the table; units named`, nRL > 0 && chipN('raise') + chipN('lower') === nRL
    && new RegExp(`<b>${nRL}</b>`).test($('plxKpis').innerHTML) && /Decision · campaign × placement rows/.test($('plxActBar').innerHTML)
    && /1 campaign · \d+ campaign × placement rows/.test($('plxSub').textContent), $('plxSub').textContent);
  // The 7-day window: no Raise or Lower from it.
  ST.plcr = { from: '2026-11-17', to: '2026-11-23', d: { SP: { from: '2026-11-17', to: '2026-11-23', rows: ST.plc.d.SP.rows.map(r => Object.assign({}, r)) } } };
  C.setWin('7');
  C.renderPlx();
  const P7 = C.getLast();
  ok('7 days: plcRecent, "sales still coming in" — no Raise or Lower, Watch with the reason', P7.win === '7' && P7.rowsAll.every(r => r.dec !== 'raise' && r.dec !== 'lower')
    && P7.rowsAll.some(r => r.dec === 'watch' && /Would lower/.test(r.why) && /still coming in/.test(r.why)) && !$('plcWinNote').classList.contains('hide')
    && /Last 7 days/.test($('plxWin').textContent), P7.rowsAll.map(r => r.dec).join());
  ok('…the data line names the days', /the last 7 days, 17 Nov – 23 Nov/.test($('plcMsg').innerHTML), $('plcMsg').innerHTML.slice(0, 200));
  C.setWin('30');
  // 14 / 60: greyed until plcD14 / plcD60 exist, then on by themselves.
  C.renderPlx();
  const seg = () => $('plcWinSeg').innerHTML;
  const btn = k => (new RegExp(`<button[^>]*data-win="${k}"[^>]*>`).exec(seg()) || [''])[0];
  ok('14 and 60 days: greyed "coming soon (needs the backend: plcD14 / plcD60)"', / disabled/.test(btn('14')) && /needs the backend: plcD14/.test(btn('14')) && / disabled/.test(btn('60')) && /plcD60/.test(btn('60'))
    && !/ disabled/.test(btn('30')) && !/ disabled/.test(btn('7')), btn('14'));
  ST.wx = Object.assign(ST.wx || {}, { plcD14: { from: '2026-10-28', to: '2026-11-10', d: { SP: { rows: ST.plc.d.SP.rows.map(r => Object.assign({}, r)) } } } });
  C.renderPlx();
  ok('…once plcD14 exists (rows in plcSettled\'s shape), 14 days switches on by itself; 60 stays greyed', C.plxWinOn('14') && !/ disabled/.test(btn('14')) && / disabled/.test(btn('60')));
  // Blanks last: a campaign with no sales has no ACoS — last whether ACoS is sorted up or down.
  ST.plc.d.SP.rows.push({ cid: 'c2', cn: 'SP - No sales', p: 'Top of Search on-Amazon', i: 100, c: 5, sp: 4, o: 0, s: 0 });
  const orderBy = d => { C.setPlxSort({ k: 'acos', d }); C.renderPlx(); return [...$('plxTable').innerHTML.matchAll(/plx-camp[\s\S]*?<b>([^<]+)<\/b>/g)].map(m => m[1]); };
  const up = orderBy(1), down = orderBy(-1);
  ok('empty values sort last in both directions (ACoS: the campaign with no sales)', up[up.length - 1] === 'SP - No sales' && down[down.length - 1] === 'SP - No sales', up.join(', ') + ' / ' + down.join(', '));
  // No hidden target: with no unit cost and no target, the warning at the top; nothing raised against a target.
  C.renderPlx();
  ok('no hidden target: no unit cost and no target for Ridhi → the warning at the top with "Set a target ACoS" on Ridhi; 13 orders → "no target", never Raise',
    !$('plcTgtWarn').classList.contains('hide') && /data-settgt="SP"/.test($('plcTgtWarn').innerHTML) && C.getLast().rowsAll.some(r => r.chip === 'notgt')
    && C.getLast().rowsAll.every(r => r.dec !== 'raise'));
  C.STS.SP = Object.assign({}, C.STA_SET_DEF.SP, { fallbackTgt: 30, fallbackBe: 45 });
  C.STS.stamp = (C.STS.stamp || 0) + 1;
  C.renderPlx();
  ok('…a target set in Lists & settings: the warning goes, and the campaign is judged against it (the same place every page reads)',
    $('plcTgtWarn').classList.contains('hide'));
  const SRC = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'ads', f), 'utf8');
  ok('the bar is Search Term Analysis\'s own code (staBarWire, staWinBar, staPfBar, staFChips, staTgtWarn), not a copy', /staBarWire\(\{ pg: 'plc'/.test(SRC('placement-decide.js'))
    && /staWinBar\('plcWinSeg'/.test(SRC('placement-decide.js')) && /staPfBar\('plcPf'/.test(SRC('placement-decide.js')) && /staTgtWarn\('plcTgtWarn'/.test(SRC('placement-decide.js'))
    && !/function staWinBar|function staPfBar|function staFChips/.test(SRC('placement-decide.js')));
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const pane = html.slice(html.indexOf('<div id="panePlc"'), html.indexOf('<!-- /panePlc -->'));
  const at = id => pane.indexOf(`id="${id}"`);
  ok('the bar in the same order: brand, date window, filters, then the actions; search and placement on the second row; the warning on top',
    at('plcTgtWarn') < at('plcBrand') && at('plcBrand') < at('plcWinSeg') && at('plcWinSeg') < at('plcPf') && at('plcPf') < at('plxRlBtn') && at('plxRlBtn') < at('plxFilter')
    && at('plxFilter') < at('plxPlace') && at('plxPlace') < at('plcChips') && /title="Placement figures are per campaign, so they cover every product in it\."/.test(pane));
  ok('hover help on every column of the decisions table and on every card', (() => {
    const h = $('plxTable').innerHTML, head = h.slice(0, h.indexOf('</thead>'));
    const ths = [...head.matchAll(/<th(?=[\s>])[^>]*>/g)].map(m => m[0]);
    return ths.length >= 12 && ths.every(t => / title="/.test(t)) && ($('plxKpis').innerHTML.match(/class="adx-box plx-kpi[^"]*" style="[^"]*" title="/g) || []).length === 5;
  })(), $('plxTable').innerHTML.slice(0, 200));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
