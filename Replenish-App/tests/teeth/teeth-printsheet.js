const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  /* ---- only a printer prints ---- */
  /* THE HOLE THIS CLOSES: eight active non-printers could be put on a line today. */
  ['a vendor who is not a printer cannot be given a line',
   '  if (want && !spIsPrinterCode(want)) {',
   '  if (false) {'],

  ['…and printing is the categories whose name says so',
   "const spIsPrinterCode = c => { const v = voMasterRow(c); return !!(v && v.active !== false && /print/i.test(String(v.category || ''))); };",
   'const spIsPrinterCode = c => !!voMasterRow(c);'],

  ['…and a retired printer is not one',
   "const spIsPrinterCode = c => { const v = voMasterRow(c); return !!(v && v.active !== false && /print/i.test(String(v.category || ''))); };",
   "const spIsPrinterCode = c => { const v = voMasterRow(c); return !!(v && /print/i.test(String(v.category || ''))); };"],

  ['…and the refusal says what they actually are',
   "    return `${voName(want)} is ${v.active === false ? 'no longer active' : 'a ' + (v.category || 'vendor').toLowerCase()}, not a printer. `",
   "    return `That is not a printer. `"],

  /* ---- reading a cell ---- */
  ['a printer can be named by its code',
   '  return list.find(v => String(v.code).toLowerCase() === k)' + NL
     + "    || list.find(v => String(v.desc || v.name || '').toLowerCase() === k)",
   "    return list.find(v => String(v.desc || v.name || '').toLowerCase() === k)"],

  ['…or by its name',
   "    || list.find(v => String(v.desc || v.name || '').toLowerCase() === k)" + NL,
   ''],

  ['…or the way the dropdown writes it',
   "    || list.find(v => (String(v.desc || v.name || '') + ' (' + v.code + ')').toLowerCase() === k)" + NL,
   ''],

  ['…and only a printer is looked for',
   '  const list = spPrinters();',
   '  const list = voAllVendors();'],

  /* ---- the sheet ---- */
  ['the sheet leaves out a SKU with nothing open',
   '    const keys = spSkuKeys(r);' + NL + '    if (!keys.length) return;                       // nothing open — nobody to give it to',
   '    const keys = spSkuKeys(r);'],

  ['…and counts the open lines',
   "    rows.push([r.sku, [r.articleSubtype, r.color, r.size].filter(Boolean).join(' · ')," + NL
     + "      keys.length, now || '', '']);",
   "    rows.push([r.sku, [r.articleSubtype, r.color, r.size].filter(Boolean).join(' · ')," + NL
     + "      (r.orders || []).length, now || '', '']);"],

  /* A BLANK CELL IS NOT AN INSTRUCTION — reading it as one would strip every untouched row. */
  ['a blank Printer cell is left alone',
   '    if (sku && prn) out.push({ sku, printer: prn, row: i + 1 });',
   '    if (sku) out.push({ sku, printer: prn, row: i + 1 });'],

  ['…and a file without the columns says which is missing',
   "  if (iPrn < 0) return { err: 'The file has no Printer column. Download the printer sheet to see the columns it reads.' };",
   '  if (false) return { err: 0 };'],

  /* ---- the plan ---- */
  ['one row becomes one assignment per open line',
   '    const keys = spSkuKeys(r);' + NL + "    if (!keys.length) { skip.push({ row: e.row, sku: e.sku, why: 'every order for it is already finished.' }); return; }",
   '    const keys = [e.sku];' + NL + "    if (!keys.length) { skip.push({ row: e.row, sku: e.sku, why: 'every order for it is already finished.' }); return; }"],

  ['…and a SKU that is not on screen is refused',
   "    if (!r) { skip.push({ row: e.row, sku: e.sku, why: 'that SKU is not on screen — clear the filters, or take the row out.' }); return; }",
   '    if (!r) { return; }'],

  ['…and a line that already has that printer is not written again',
   '      if (spPrinter(no, e.sku) === v.code) { same.push({ no, sku: e.sku, code: v.code }); return; }',
   '      if (false) { return; }'],

  ['…and a queue this account may not touch is refused',
   '      if (!spCanAssignOrder(no)) { skip.push({ row: e.row, sku: e.sku, why: spNoAssignFor(no) }); return; }',
   '      if (false) { return; }'],

  /* A KARIGAR IS SAID TO BE A KARIGAR. */
  ['…and a karigar is named as one',
   "      skip.push({ row: e.row, sku: e.sku, why: isPerson" + NL
     + "        ? `\"${e.printer}\" is a karigar, not a printer. Printing is given to a printer; a karigar is given work in the entry sheet.`",
   "      skip.push({ row: e.row, sku: e.sku, why: false" + NL
     + "        ? `\"${e.printer}\" is a karigar, not a printer. Printing is given to a printer; a karigar is given work in the entry sheet.`"],

  /* ---- doing it ---- */
  ['running a sheet asks for the assign right',
   '  if (!spCanAssign() && !bkCanAssign()) return SP_NO_ASSIGN;' + NL + '  if (!plan.assign.length) {',
   '  if (false) return SP_NO_ASSIGN;' + NL + '  if (!plan.assign.length) {'],

  ['…and it actually assigns',
   "    const err = await spAssign(a.no, a.sku, a.code, { noRender: true });",
   "    const err = '';"],

  ['…and says who got how many',
   "  $('odMsg').textContent = `${nf(done.length)} line(s) given to ${nf(byPrinter.size)} printer(s) — `",
   "  $('odMsg').textContent = `done — `"],

  ['…and a sheet with nothing to do says so',
   "      ? `Nothing to do — all ${nf(plan.same.length)} line(s) in ${name || 'that sheet'} already have the printer named.`",
   "      ? `x`"],
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
