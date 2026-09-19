const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  /* ---- the one-button ask ---- */
  ['the button asks for the sizes',
   '  rfdPieceLines(o).forEach(x => {' + NL + '    const left = rfdPcsAllowed(o, x.sku).left;',
   '  [].forEach(x => {' + NL + '    const left = rfdPcsAllowed(o, x.sku).left;'],

  ['…and the cloth',
   '  rfdFabrics(o).forEach(x => {' + NL + '    const left = rfdAllowed(o, x.fabric).left;',
   '  [].forEach(x => {' + NL + '    const left = rfdAllowed(o, x.fabric).left;'],

  ['…for what is LEFT, not for what the order holds',
   '    const left = rfdPcsAllowed(o, x.sku).left;' + NL + "    if (left > 0) asks.push({ unit: 'pcs', pieces: left,",
   '    const left = x.pieces;' + NL + "    if (left > 0) asks.push({ unit: 'pcs', pieces: left,"],

  ['…and asks for nothing when there is nothing left',
   "  if (!asks.length) return { err: 'Everything this order needs has already been asked for.' };",
   '  if (false) return { err: 0 };'],

  ['…in one write, not one per size',
   '  const patch = {};' + NL + '  recs.forEach(r => { patch[base + r.id] = r; });' + NL + '  try { await ptPatch(patch); }',
   '  const patch = {};' + NL + '  recs.forEach(r => { patch[base + r.id] = r; });' + NL
     + '  try { for (const r of recs) await ptPut(base + r.id, r); }'],

  ['…and every one of them gets an id of its own',
   "  const id = 'rfd_' + Date.now() + '_' + (seq || 0) + '_' + Math.random().toString(36).slice(2, 7);",
   "  const id = 'rfd_' + Date.now() + '_x';"],

  ['…and the pieces and the metres are counted apart',
   "  const pcs = rfdRound(recs.filter(r => rfdUnit(r) === 'pcs').reduce((a, r) => a + rfdWant(r), 0));",
   '  const pcs = rfdRound(recs.reduce((a, r) => a + rfdWant(r), 0));'],

  /* ---- the receipt ---- */
  ['the lots are mirrored where the printer can read them',
   '    sends: rfdSends(rec).slice(-10).map(x => ({ qty: parseFloat(x.qty) || 0, date: x.date || \'\', at: x.at || \'\' })) };',
   '  };'],

  ['…with the date on each',
   "    sends: rfdSends(rec).slice(-10).map(x => ({ qty: parseFloat(x.qty) || 0, date: x.date || '', at: x.at || '' })) };",
   '    sends: rfdSends(rec).slice(-10).map(x => ({ qty: parseFloat(x.qty) || 0 })) };'],

  ['…and the printer reads them newest first',
   '    .sort((a, b) => String(b.at || \'\').localeCompare(String(a.at || \'\')) || (b.seq - a.seq));',
   '    .sort((a, b) => String(a.at || \'\').localeCompare(String(b.at || \'\')) || (a.seq - b.seq));'],

  ['…and a lot of nothing is not a lot',
   '  return out.filter(x => x.qty > 0)',
   '  return out.filter(x => true)'],

  /* ---- the order picker ---- */
  ['the picked order is the one shown',
   '  return list.find(o => o.id === VP.rfdOrder) || list[0];',
   '  return list[0];'],

  ['…and a pick that has gone falls back rather than showing nothing',
   '  return list.find(o => o.id === VP.rfdOrder) || list[0];',
   '  return list.find(o => o.id === VP.rfdOrder) || null;'],

  /* ---- the screen ---- */
  ['the screen offers the picker',
   '        <select id="vpRfdPick" style="flex:0 0 340px">${pick}</select>',
   '        <select style="flex:0 0 340px">${pick}</select>'],

  ['…and the one button',
   '          ? `<button id="vpRfdAll" title="Raises a requirement for everything this order still needs, in one go.">Ask for everything still needed — ${esc(leftTxt)}</button>`',
   '          ? `<button title="x">Ask for everything still needed — ${esc(leftTxt)}</button>`'],

  ['…which says how much it will ask for',
   '  const leftTxt = [leftPcs ? nf(leftPcs) + \' pcs\' : \'\', leftM ? nf(leftM) + \' m\' : \'\'].filter(Boolean).join(\' · \');',
   "  const leftTxt = 'something';"],

  ['…and shows one order, not all of them',
   '  const o = vpRfdOrder() || orders[0];',
   '  const o = orders[0];'],
];

const BASE = 1;
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing or not unique: ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'],
    { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > BASE : false;
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-160)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
