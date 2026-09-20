const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  /* ---- whether a design is still being made ---- */
  ['a design is being made until somebody says otherwise',
   "const palLiveOf = key => ((PAL.groups || {}).live || {})[key] !== false;",
   'const palLiveOf = key => !!((PAL.groups || {}).live || {})[key];'],
  ['stopping one stops the work on it',
   '      live, open: d.toMake, toMake: live ? d.toMake : 0,',
   '      live, open: d.toMake, toMake: d.toMake,'],
  ['…but keeps what was open on it when it was stopped',
   '      live, open: d.toMake, toMake: live ? d.toMake : 0,',
   '      live, open: 0, toMake: live ? d.toMake : 0,'],
  /* ---- the two decisions travel together ---- */
  ['a group edit does not undo a stop decision',
   '  return palPutGroups(map, Object.assign({}, (PAL.groups || {}).live || {}));',
   '  return palPutGroups(map, {});'],
  ['…and both go in one record',
   "  const rec = { at: new Date().toISOString(), by: ME.email, map, live };",
   "  const rec = { at: new Date().toISOString(), by: ME.email, map };"],
  ['…and the stop list is read back off it',
   "    PAL.groups = { map: (g && g.map) || {}, live: (g && g.live) || {}, at: (g && g.at) || '', by: (g && g.by) || '' };",
   "    PAL.groups = { map: (g && g.map) || {}, at: (g && g.at) || '', by: (g && g.by) || '' };"],
  /* ---- the sheet ---- */
  ['the sheet has a row for every design',
   '  palDesigns().forEach(d => {' + NL + "    rows.push([d.brand, d.color, d.group || '', d.live ? 'yes' : 'no',",
   '  palDesigns().slice(0, 1).forEach(d => {' + NL + "    rows.push([d.brand, d.color, d.group || '', d.live ? 'yes' : 'no',"],
  ['…and the two columns that are his',
   "const PAL_SHEET_COLS = ['Brand', 'Design', 'Group', 'Continue',",
   "const PAL_SHEET_COLS = ['Brand', 'Design',"],
  ['the columns are found by name, whatever order they are in',
   '  const at = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };' + NL
     + "  const iB = at(['brand']), iD = at(['design', 'colour', 'color']);",
   "  const at = () => -1;" + NL + '  const iB = 0, iD = 1;'],
  ['a file with neither decision on it is refused',
   "  if (iG < 0 && iC < 0) return { err: 'The file has neither a Group nor a Continue column, so there is nothing in it to read.' };",
   ''],
  ['a design the catalogue has never seen is refused',
   "    if (!d) { skip.push({ row: e.row, key, why: 'no SKU in the catalogue is ' + (e.brand || '?') + ' ' + (e.design || '?') + '.' }); return; }",
   '    if (!d) return;'],
  ['the same design twice is refused rather than resolved',
   "    if (seen.has(key)) { skip.push({ row: e.row, key, why: 'the same brand and design is on row ' + seen.get(key) + ' as well.' }); return; }",
   ''],
  ['Continue has to be yes or no',
   '      if (!yes && !no) { skip.push({ row: e.row, key, why: \'Continue has to be yes or no, not "\' + e.cont + \'".\' }); return; }',
   ''],
  ['a row that says what the screen already says is not written',
   "      if (want !== (d.group || '')) set.push({ row: e.row, key, d, field: 'group', from: d.group || '', to: want });",
   "      set.push({ row: e.row, key, d, field: 'group', from: d.group || '', to: want });"],
  ['the sheet needs the right that ticks them by hand',
   '  if (!palCanEdit()) return PAL_NO_EDIT;' + NL + '  const rows = (plan && plan.set) || [];',
   '  const rows = (plan && plan.set) || [];'],
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
