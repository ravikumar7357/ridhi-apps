/* Karigar Analysis: Day by day and Monthly target. See 2026-09-22-ka-daily-target-code.js. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};
const code = fs.readFileSync(__dirname + '/2026-09-22-ka-daily-target-code.js', 'utf8').split(CR + LF).join(LF);

one(`            <option value="dept">Department study</option>
          </select>`,
`            <option value="dept">Department study</option>
            <option value="daily">Day by day</option>
            <option value="target">Monthly target</option>
          </select>`, 'views');
one(`            <option value="26">Last 26 weeks</option>
          </select>
          <span id="kaBands" class="hide" style="flex:0 0 auto">`,
`            <option value="26">Last 26 weeks</option>
          </select>
          <select id="kaMonth" class="hide" style="flex:0 0 170px" title="Which month"></select>
          <button id="kaTgtBtn" class="ghost hide" title="Labour value ₹ a month, per person, and a name's own figure">Set targets</button>
          <span id="kaBands" class="hide" style="flex:0 0 auto">`, 'month + targets button');

one(`  const mix = $('kaGroup').value === 'mix';
  $('kaMetric').classList.toggle('hide', mix);           // the mix is pieces by level — a metric picker would do nothing
  $('kaBands').classList.toggle('hide', !mix);
  if (mix) return renderKaMix();`,
`  const mix = $('kaGroup').value === 'mix';
  const grp = $('kaGroup').value, byMonth = grp === 'daily' || grp === 'target';
  $('kaMetric').classList.toggle('hide', mix || grp === 'target');   // the target is always labour value
  $('kaBands').classList.toggle('hide', !mix);
  $('kaWeeks').classList.toggle('hide', byMonth);
  $('kaMonth').classList.toggle('hide', !byMonth);
  $('kaTgtBtn').classList.toggle('hide', grp !== 'target' || !ME.admin);
  if (byMonth && !$('kaMonth').options.length) {
    $('kaMonth').innerHTML = kaMonths().map(m => \`<option value="\${esc(m.ym)}">\${esc(m.label)}</option>\`).join('');
  }
  if (grp === 'daily') return renderKaDaily();
  if (grp === 'target') return renderKaTarget();
  if (mix) return renderKaMix();`, 'dispatch');

one(`  if (!KA.pick || ['karigar', 'mix'].indexOf($('kaGroup').value) < 0) { box.innerHTML = ''; box.classList.add('hide'); return; }`,
`  if (!KA.pick || ['karigar', 'mix', 'daily', 'target'].indexOf($('kaGroup').value) < 0) { box.innerHTML = ''; box.classList.add('hide'); return; }`, 'detail on the new views');

one(`      if (!KA.levels) KA.levels = (await ptGet('pt_articleLevel')) || {};`,
`      if (!KA.levels) KA.levels = (await ptGet('pt_articleLevel')) || {};
      if (!KA.targets) KA.targets = (await ptGet('pt_kaTargets')) || {};`, 'load targets');
one(`    KA.levels = (await ptGet('pt_articleLevel')) || {};
    PA.err = PTG.err || '';`,
`    KA.levels = (await ptGet('pt_articleLevel')) || {};
    KA.targets = (await ptGet('pt_kaTargets')) || {};
    PA.err = PTG.err || '';`, 'refresh targets');

one(`['kaMetric', 'kaGroup', 'kaWeeks', 'kaDept'].forEach(id => $(id).addEventListener('change', renderKa));`,
`['kaMetric', 'kaGroup', 'kaWeeks', 'kaDept', 'kaMonth'].forEach(id => $(id).addEventListener('change', renderKa));`, 'month redraws');

one(`$('kaExport').onclick = () => {
  if ($('kaGroup').value === 'mix') {`,
`$('kaTgtBtn').onclick = () => kaTargetsOpen();
$('kaExport').onclick = () => {
  if ($('kaGroup').value === 'daily') {
    const x = KA.daily; if (!x || !x.rows.length) return;
    const head = ['Karigar', 'Department'].concat(x.d.days.map(ms => paDayIso(ms)), ['Total', 'Days worked']);
    ptDownload('karigar-day-by-day-' + x.d.ym + '-' + x.metric, [head].concat(x.rows.map(r => [r.name, r.dept].concat(r.vals, [r.total, r.worked]))).map(l => l.map(csvCell).join(',')));
    return;
  }
  if ($('kaGroup').value === 'target') {
    const x = KA.target; if (!x || !x.rows.length) return;
    const head = ['Karigar', 'Department', 'People', 'Month target ₹', 'Done so far ₹', 'Should be by today ₹', 'Of the pace %',
      'Short by ₹', 'Needed a day ₹', 'Month end at this pace ₹', 'Days worked', 'Stage'];
    ptDownload('karigar-targets-' + x.ym, [head].concat(x.rows.map(r => [r.name, r.dept, paTeamSize(r.key, Date.now()), r.target, r.done, r.expected,
      r.pace == null ? '' : Math.round(r.pace * 100), r.short, r.needPerDay, r.projected, r.daysWorked, KA_TGT_STATUS[r.status][0]])).map(l => l.map(csvCell).join(',')));
    return;
  }
  if ($('kaGroup').value === 'mix') {`, 'export');

one(`/* ---------- ARTICLE MIX: who makes the easy articles, who makes the hard ones ----------`,
code + `
/* ---------- ARTICLE MIX: who makes the easy articles, who makes the hard ones ----------`, 'the code');

one(`  .kpis{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:10px}`,
`  .kpis{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:10px}
  /* Sundays in the day-by-day study: shaded, not hidden — work done on one still counts. */
  table.xl th.ka-sun,table.xl td.ka-sun{background:#f3f4f6}`, 'sunday shade');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
