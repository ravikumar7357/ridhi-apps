const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  /* ---- the allocation is a choice, not a score ---- */
  ['a group only goes to a printer who was given it',
   '    const mine = printers.filter(p => palTakes(p, g));',
   '    const mine = printers;'],
  ['…and "nobody was given it" is a different answer from "everybody is full"',
   '    return { group: g, picks, short: left, unassigned: !printers.some(p => palTakes(p, g)) };',
   '    return { group: g, picks, short: left };'],
  ['a printer with no groups takes none',
   "const palTakes = (p, g) => (Array.isArray(p && p.groups) ? p.groups : []).indexOf(g.name) >= 0;",
   'const palTakes = () => true;'],
  ['the ticked groups are what gets stored',
   '  const groups = (Array.isArray(v.palGroups) ? v.palGroups : []).map(String).filter(Boolean);',
   '  const groups = [];'],
  /* ---- the capacity is measured ---- */
  ['the capacity is measured, not the typed figure',
   '  const byTables = tables > 0 && shared > 0 ? tables * shared : 0;',
   '  const byTables = 0;'],
  ['…and tables raise it',
   '    return { pcs: Math.round(Math.max(byTables, proven)), from: byTables >= proven ? \'tables\' : \'own\',',
   '    return { pcs: Math.round(proven || byTables), from: byTables >= proven ? \'tables\' : \'own\','],
  ['…but never below what the printer has proved',
   '    return { pcs: Math.round(Math.max(byTables, proven)), from: byTables >= proven ? \'tables\' : \'own\',',
   '    return { pcs: Math.round(byTables || proven), from: byTables >= proven ? \'tables\' : \'own\','],
  ['the rate is the best month, not the average',
   '    if (full > best) { best = full; bestMonth = ym; part = share < 1; }',
   '    best = (best + full) / 2; bestMonth = ym; part = share < 1;'],
  ['…and the month we are in is scaled to a whole one',
   '  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();' + NL
     + '  return Math.max(1, now.getDate()) / days;',
   '  return 1;'],
  ['…and a month gone by is left alone',
   "  if (ym !== here) return 1;",
   ''],
  ['a delivery date is read whichever way round it is written',
   "  m = t.match(/^(\\d{1,2})[-\\/.](\\d{1,2})[-\\/.](\\d{4})/);" + NL
     + "  return m ? m[3] + '-' + String(m[2]).padStart(2, '0') : '';",
   "  return '';"],
  ['a printer is measured on their own vendor',
   '  const code = String(p.vendorCode || \'\').trim().toUpperCase();' + NL + '  if (code) return code;',
   ''],
  ['…and on nobody when nothing matches',
   '  const hit = (voAllVendors ? voAllVendors() : []).find(v =>' + NL
     + '    norm(v.name) === want || norm(v.desc) === want || norm(v.code) === want);',
   '  const hit = (voAllVendors ? voAllVendors() : [])[0];'],
  ['a printer with nothing to plan against is refused',
   '  if (!tables && !cap)',
   '  if (false)'],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: pathm.join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-150)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
