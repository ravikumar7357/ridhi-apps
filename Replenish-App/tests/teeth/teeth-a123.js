const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  /* ---- A-1 ---- */
  ['"All" is not a label',
   "  if (PR_COL_ANY.indexOf(t.toLowerCase()) >= 0) return '';",
   '  '],
  ['…and the form accepts it',
   "      && PR_COL_ANY.indexOf(String(v.colours).trim().toLowerCase()) < 0)",
   '      && true)'],
  /* The prRec guard was REDUNDANT once prColLabel answers blank for "All" — removed from the app,
   * so there is nothing left here to break. */
  ['…while Gadd stays a label',
   "const PR_COL_ANY = ['all', 'any', 'all colours', 'all colors', 'any colours', 'any colors', 'na', 'n/a', '-'];",
   "const PR_COL_ANY = ['all', 'any', 'gadd', 'all colours', 'all colors', 'any colours', 'any colors', 'na', 'n/a', '-'];"],

  /* ---- A-2 ---- */
  ['the order says what work it is',
   '  if (o && o.service && prSvc(o.service)) return [prSvc(o.service).key];',
   '  '],
  ['a filling rate for the other filler is not this rate',
   '    if (f && prNameKey(f) !== prNameKey(r.filler)) return false;',
   '    '],
  ['two fillers and no word on which is no rate',
   '  if (hits.length > 1 && hits.some(prIsFill)' + NL
     + '      && new Set(hits.map(r => prNameKey(r.filler))).size > 1) return null;',
   '  '],
  ['…and the reason names the fillers',
   "  if (fillers.length > 1) return 'two fillers are priced — ' + fillers.join(' and ')",
   "  if (fillers.length > 1) return 'two fillers are priced'"],
  ['…and a rate that is not approved is named as such',
   "  if (!ok.length) return all.length + ' rate(s) match but none is approved yet';",
   '  '],
  ['…and an uncovered colour count with its number',
   "  if (n > 0) return 'the design has ' + n + ' colours and no approved rate covers that count';",
   '  '],
  ['the line overrides its order on the filler',
   "const prLineFiller = (o, l) => String((l && l.filler) || (o && o.filler) || '').trim();",
   "const prLineFiller = (o, l) => String((o && o.filler) || (l && l.filler) || '').trim();"],
  ['the reason reaches the payout row',
   "      const why = row ? '' : prRateWhy(o.vendorCode, o, l);",
   "      const why = '';"],
  ['…and the cell',
   '      + `<td class="num"${r.rate == null ? ` style="color:var(--bad)" title="${esc(r.why)}"` : \'\'}>',
   '      + `<td class="num"${r.rate == null ? ` style="color:var(--bad)"` : \'\'}>'],
  ['…and the drill-down',
   "      ? 'NO APPROVED RATE prices this work, so it is adding nothing to the total: ' + r.why + '. The pieces '",
   "      ? 'NO APPROVED RATE prices this work, so it is adding nothing to the total. The pieces '"],
  /* the form */
  ['a filling order shows the filler box',
   '    wrap.classList.toggle(\'hide\', !(svc && svc.fill));',
   '    wrap.classList.toggle(\'hide\', true);'],
  ['…and printing hides it',
   '    wrap.classList.toggle(\'hide\', !(svc && svc.fill));',
   '    wrap.classList.toggle(\'hide\', false);'],
  ['…and a filling order without one is refused',
   "  if (svcRec && svcRec.fill && !filler) return 'Say which filler this order is for — the firm prices each one apart.';",
   '  '],
  ['…and the order carries it',
   '    ...(svcRec && svcRec.fill ? { filler } : {}),',
   '    '],

  /* ---- A-3 ---- */
  ['a cancelled order still owes what was accepted on it',
   '    if (!o) return;' + NL + '    voLines(o).forEach((l, li) => {' + NL + '      if (!l) return;',
   "    if (!o || o.status === 'Cancelled') return;" + NL + '    voLines(o).forEach((l, li) => {' + NL + '      if (!l) return;'],
  ['…and a cancelled line likewise',
   '    if (!o) return;' + NL + '    voLines(o).forEach((l, li) => {' + NL + '      if (!l) return;',
   '    if (!o) return;' + NL + '    voLines(o).forEach((l, li) => {' + NL + '      if (!l || l.cancelled) return;'],
  ['…and it is marked',
   '        if (gone) g[key].gone += kept;',
   '        '],
  ['…on the screen',
   '${nf(r.gone)} on a cancelled order</span>` : \'\'}</td>`',
   '</span>` : \'\'}</td>`'],
  ['…and in the drill-down',
   "    + `<td>${esc(d.orderNo)}${d.gone ? ' <span class=\"pill pill-low\" title=\"Cancelled after this was taken in. Still owed.\">cancelled</span>' : ''}</td>`",
   '    + `<td>${esc(d.orderNo)}</td>`'],

  /* ---- the sequence ---- */
  ['a later ask is later inside one millisecond',
   '  const n = Object.keys(o.rfdReqs || {}).length + (seq || 0);',
   '  const n = (seq || 0);'],
  ['…and the tenth is after the ninth',
   "  const id = 'rfd_' + Date.now() + '_' + String(n).padStart(4, '0') + '_' + Math.random().toString(36).slice(2, 7);",
   "  const id = 'rfd_' + Date.now() + '_' + String(n) + '_' + Math.random().toString(36).slice(2, 7);"],
];

const BASE = 1;
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing or not unique (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'],
    { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > BASE : false;
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-200)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
