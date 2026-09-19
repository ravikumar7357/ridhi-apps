const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10), BS = String.fromCharCode(92), Q = String.fromCharCode(39);

const breaks = [
  /* ---- the size ---- */
  ['a size written back to front is the same size',
   '  if (p) return [parseFloat(p[1]), parseFloat(p[2])].sort((a, b) => a - b).join(\'x\');',
   "  if (p) return p[1] + 'x' + p[2];"],

  ['…and two different sizes do NOT fold into one',
   '  if (p) return [parseFloat(p[1]), parseFloat(p[2])].sort((a, b) => a - b).join(\'x\');',
   "  if (p) return 'any';"],

  ['the inch mark is not part of a size',
   "  return hrN(v).replace(new RegExp(String.fromCharCode(0x2033) + '|\"|' + String.fromCharCode(0x2032) + \"|'\", 'g'), '')",
   '  return hrN(v)'],

  ['…nor which times sign was typed',
   "    .replace(new RegExp(String.fromCharCode(0x00D7) + '|\\\\*', 'g'), 'x')",
   '    '],

  ['a round size is the same with the word and without it',
   '  const t = prNorm(v).replace(/' + BS + 's*' + BS + 'b(round|rd)$/, ' + Q + Q + ').trim();',
   '  const t = prNorm(v);'],

  ['…and a misspelling is NOT folded in with it',
   '  const t = prNorm(v).replace(/' + BS + 's*' + BS + 'b(round|rd)$/, ' + Q + Q + ').trim();',
   '  const t = prNorm(v).replace(/' + BS + 's*(round+d*|rd)$/, ' + Q + Q + ').trim();'],

  /* ---- the spelling pair ---- */
  ['rectangle and rectangular are one word',
   "const PR_SPELL = [['rectangular', 'rectangle']];",
   'const PR_SPELL = [];'],

  ['…and folding it is what prNameKey does',
   '  PR_SPELL.forEach(([a, b]) => { t = t.split(a).join(b); });',
   '  '],

  /* IF NAMES FOLDED INTO EACH OTHER WHOLESALE, a square tablecloth would be priced as a rectangular
   * one — which is the whole reason the pair is a named list and not a rule. */
  ['…without square and rectangle becoming one thing',
   '  PR_SPELL.forEach(([a, b]) => { t = t.split(a).join(b); });',
   "  t = t.replace(/^(square|rectangle|rectangular)/, 'shape');"],

  /* ---- what work a line is ---- */
  ['the firm\'s kind decides what work its lines are',
   '  const cat = voCatOf(vendorCode);' + NL + '  const amb = PR_SVC_AMBIGUOUS[hrN(cat)];',
   "  const cat = 'Printer';" + NL + '  const amb = PR_SVC_AMBIGUOUS[hrN(cat)];'],

  ['…a fabricator answers with both of its jobs',
   '  if (amb) return amb.slice();',
   '  '],

  ['…and a firm with no kind written down gates nothing',
   '  return one ? [one] : PR_SERVICES.map(x => x.key);',
   "  return one ? [one] : ['Block print'];"],

  ['…while the gate still shuts on work the firm was not given',
   '  if (!prLineServices(code, o).some(k => hrN(k) === hrN(r.service))) return false;',
   '  '],

  /* ---- the match itself ---- */
  ['a rate for the other unit is not reached',
   "  if (want.kind !== (prIsRunning(r) ? 'running' : 'cut')) return false;",
   '  '],

  ['…nor one belonging to another firm',
   '  if (String(code) !== String(r.vendor)) return false;',
   '  '],

  ['…and the article, subtype and size all have to agree',
   '    : prNameKey(want.articleType) === prNameKey(r.articleType)' + NL
     + '      && prNameKey(want.subtype) === prNameKey(r.subtype)' + NL
     + '      && prSizeKey(want.size) === prSizeKey(r.size);',
   '    : prNameKey(want.articleType) === prNameKey(r.articleType);'],

  ['…the running side on fabric and print direction',
   '    ? prNameKey(want.fabric) === prNameKey(r.fabric) && prNameKey(want.print) === prNameKey(r.print)',
   '    ? prNameKey(want.fabric) === prNameKey(r.fabric)'],

  /* ---- the column and the money ask the same question ---- */
  ['the column counts through prLineMatches',
   '    voLines(o).forEach(l => { if (l && !l.cancelled && prLineMatches(r, o, l)) n++; });',
   '    voLines(o).forEach(l => { if (l && !l.cancelled) n++; });'],

  ['…and a cancelled line is not live work',
   '    voLines(o).forEach(l => { if (l && !l.cancelled && prLineMatches(r, o, l)) n++; });',
   '    voLines(o).forEach(l => { if (l && prLineMatches(r, o, l)) n++; });'],

  /* The vendor payout carries the same line, so the anchor names the one in prUsage by what
   * follows it. */
  ['…and a cancelled order is not either',
   "    if (!o || o.status === 'Cancelled') return;" + NL
     + '    voLines(o).forEach(l => { if (l && !l.cancelled && prLineMatches(r, o, l)) n++; });',
   '    if (!o) return;' + NL
     + '    voLines(o).forEach(l => { if (l && !l.cancelled && prLineMatches(r, o, l)) n++; });'],

  ['the price a line is paid comes off the same match',
   '    .filter(r => prApproved(r) && prLineMatches(r, o, l, vendorCode))',
   '    .filter(r => prApproved(r))'],

  ['…and only an approved rate prices anything',
   '    .filter(r => prApproved(r) && prLineMatches(r, o, l, vendorCode))',
   '    .filter(r => prLineMatches(r, o, l, vendorCode))'],

  /* ---- and the duplicate check reads it the same way ---- */
  ['two rates one line would reach are one rate',
   '  prNameKey(r.fabric), prNameKey(r.print), prNameKey(r.articleType), prNameKey(r.subtype),' + NL
     + '  prSizeKey(r.size), prNameKey(r.filler), hrN(r.weight), prCols(r)].join(\'|\');',
   '  hrN(r.fabric), hrN(r.print), hrN(r.articleType), hrN(r.subtype),' + NL
     + "  hrN(r.size), hrN(r.filler), hrN(r.weight), prCols(r)].join('|');"],
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
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-200)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
