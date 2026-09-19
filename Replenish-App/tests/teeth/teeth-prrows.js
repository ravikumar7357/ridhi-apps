const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  ['an array gives each row its index as its key',
   "    ? raw.map((v, i) => (v && typeof v === 'object' ? Object.assign({ _key: String(i) }, v) : null))",
   "    ? raw.map((v, i) => (v && typeof v === 'object' ? Object.assign({ _key: String(i + 1) }, v) : null))"],
  ['a row with no vendor is not a rate',
   '  return rows.filter(x => x && x.vendor);',
   '  return rows.filter(x => x);'],
  ['only what changed is sent',
   "    if (PR_SNAP[r._key] !== now[r._key]) patch['pt_printerRates/' + r._key] = prBare(r); });",
   "    patch['pt_printerRates/' + r._key] = prBare(r); });"],
  ['the key is not stored inside the row',
   'const prBare = r => { const o = Object.assign({}, r); delete o._key; return o; };',
   'const prBare = r => Object.assign({}, r);'],
  ['nothing changed sends nothing',
   '  if (!Object.keys(patch).length) return;',
   '  '],
  ['two new rows get two names',
   "const prNewKey = i => 'pr_' + Date.now().toString(36) + '_' + String(i).padStart(3, '0') + '_' + Math.random().toString(36).slice(2, 7);",
   "const prNewKey = i => 'pr_new';"],
  ['a removed rate deletes its path',
   "  Object.keys(PR_SNAP).forEach(k => { if (!(k in now)) patch['pt_printerRates/' + k] = null; });",
   '  '],
  ['a change to the same rate refuses the save',
   "  const clash = Object.keys(patch).map(p => p.slice('pt_printerRates/'.length)).filter(k => storedOf(k) !== PR_SNAP[k]);",
   '  const clash = [];'],
  /* THE WHOLE POINT OF GOING ROW BY ROW: somebody else's change elsewhere must NOT refuse this save. */
  ['…but a change to a different rate does not',
   "  const clash = Object.keys(patch).map(p => p.slice('pt_printerRates/'.length)).filter(k => storedOf(k) !== PR_SNAP[k]);",
   "  const clash = Object.keys(PR_SNAP).filter(k => storedOf(k) !== PR_SNAP[k]);"],
  ['an edit stays the same row',
   "        r._key != null ? { _key: r._key } : {});" + NL + '      await hrSavePrRate();',
   '        {});' + NL + '      await hrSavePrRate();'],
  ['loading takes the snapshot a save is compared against',
   '      HR.prate = prRowsOf(pr);' + NL + '      prSnapTake(HR.prate);',
   '      HR.prate = prRowsOf(pr);'],
  ['a refused change says the account lacks the right',
   "    throw new Error('The production database refused the change — this account does not hold the right '",
   "    throw new Error('The production database answered 401 '"],
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
