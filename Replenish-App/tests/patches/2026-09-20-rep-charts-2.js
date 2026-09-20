/* Putting the three charts on the screen. Second half of 2026-09-20-rep-charts.js. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. somewhere to draw them ---- */
one(`        <div id="repKpis" class="kpis" style="margin-top:10px"></div>`,
`        <div id="repKpis" class="kpis" style="margin-top:10px"></div>
      </div>
      <div id="repCharts" class="repcharts hide">`, 'a place for them');

/* ---- 2. the panels ---- */
one(`  /* The three earlier weeks, then last week, then what changed. The last column of the trend IS
   * last week, so the eye lands on it right before the change it caused. */`,
`  /* ---- THE CHARTS. Every figure on them is in the table below, so nothing is only a picture. ---- */
  const wkLabel = w => repWkRange(w).split(' – ')[0];
  const totals = weeks.map((w, i) => rows.reduce((n2, r) => n2 + (r.hist[i] || 0), 0));
  $('repCharts').classList.remove('hide');
  $('repCharts').innerHTML =
    '<div class="card repchart"><div class="repchart-h">Pieces received each week'
      + '<span class="repchart-s">' + esc(wkLabel(weeks[0])) + ' to ' + esc(repWkRange(week)) + '</span></div>'
      + repTrendSvg(weeks, totals, weeks.map(wkLabel)) + '</div>'
    + '<div class="card repchart"><div class="repchart-h">What came back last week'
      + '<span class="repchart-s">by article type &middot; the rest are in the table below</span></div>'
      + repShareSvg(rows) + '</div>';

  /* The three earlier weeks, then last week, then what changed. The last column of the trend IS
   * last week, so the eye lands on it right before the change it caused. */`, 'the two panels');

/* ---- 3. the sparkline column ---- */
one(`  const head = '<thead><tr>'
    + '<th class="frz">Article type</th>'
    + older.map(w => \`<th class="num muted" style="font-weight:600">\${esc(repWkRange(w).split(' – ')[0])}</th>\`).join('')
    + \`<th class="num">Last week</th><th class="num">Customer</th>\`
    + \`<th class="num">Change</th><th>Week on week</th>\`
    + '</tr></thead>';`,
`  const head = '<thead><tr>'
    + '<th class="frz">Article type</th>'
    + older.map(w => \`<th class="num muted" style="font-weight:600">\${esc(repWkRange(w).split(' – ')[0])}</th>\`).join('')
    + \`<th class="num">Last week</th><th class="num">Customer</th>\`
    + \`<th class="num">Change</th><th>Week on week</th><th>Trend</th>\`
    + '</tr></thead>';`, 'the column');

one(`    + \`\${r.delta ? (r.delta > 0 ? '+' : '') + nf(r.delta) : '<span class="muted">—</span>'}</td>\`
    + \`<td>\${repPctCell(r)}</td></tr>\`).join('');`,
`    + \`\${r.delta ? (r.delta > 0 ? '+' : '') + nf(r.delta) : '<span class="muted">—</span>'}</td>\`
    + \`<td>\${repPctCell(r)}</td>\`
    /* THE SHAPE OF ITS WEEKS. The figures are already in the columns to the left — this is for the
     * one thing a row of numbers cannot show, which is whether it is climbing or falling. */
    + \`<td style="padding:4px 10px">\${repSparkSvg(r.hist, weeks.map(wkLabel))}</td></tr>\`).join('');`, 'the sparkline');

one(`    + \`<td>\${repPctCell({ pct, prod, delta: prod - prevProd })}</td></tr></tfoot>\`;`,
`    + \`<td>\${repPctCell({ pct, prod, delta: prod - prevProd })}</td>\`
    + \`<td style="padding:4px 10px">\${repSparkSvg(totals, weeks.map(wkLabel))}</td></tr></tfoot>\`;`, 'and on the total row');

/* ---- 4. the other views have no charts, so they clear them ---- */
one(`function repRenderLive() {`,
`/* Every view that is not the week-on-week one clears the panel rather than leaving last week's
 * charts sitting above a different table. */
function repChartsOff() { const el = $('repCharts'); if (el) { el.innerHTML = ''; el.classList.add('hide'); } }

function repRenderLive() {`, 'the others clear it');

one(`  const week = ($('repWk') || {}).value || repLastFullWeek();
  const brand = $('repBrand').value;
  const { prevWeek, weeks, rows } = repWow(week, brand, false);

  if (!rows.length) {`,
`  const week = ($('repWk') || {}).value || repLastFullWeek();
  const brand = $('repBrand').value;
  const { prevWeek, weeks, rows } = repWow(week, brand, false);

  if (!rows.length) {
    repChartsOff();`, 'and so does an empty week');

/* ---- 5. the panel's own styling ---- */
one(`  .kpis{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:10px}`,
`  .kpis{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:10px}
  /* TWO PANELS SIDE BY SIDE, and one above the other when there is no room for two. The chart is the
     only loud thing in the panel: the heading is small, there is no frame around the plot and no
     fill behind it. */
  .repcharts{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px;margin-top:12px}
  .repchart{margin:0;padding:14px 16px 10px}
  .repchart-h{font-size:13px;font-weight:700;margin-bottom:10px;display:flex;flex-direction:column;gap:2px}
  .repchart-s{font-size:11px;font-weight:400;color:var(--muted)}`, 'the panel');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
