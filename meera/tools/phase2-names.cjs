/* Phase 2: names stay as typed. Sample (made-up) karigars, a party, SKUs and colours are put where the ERP keeps them;
 * then misspelled names are asked. Nothing may turn into a name, and no name may appear that was not typed. */
const path = require('path');
const { load } = require('../tests/harness.cjs');
(async () => {
  const M = await load({ root: path.join(__dirname, '..', '..'), bundle: true, switches: ['spell'] });
  M.ctx.PTE.emp = [[1, 'Ramesh Kumar'], [2, 'Salim Ansari'], [3, 'Govind Prasad']];
  M.ctx.PTG = { masters: { vendor: { v1: { code: 'SHP', name: 'Shree Printers' }, v2: { code: 'MKT', name: 'Mehta Textiles' } }, colour: { c1: { name: 'Mustard' } } },
    mdb: [{ sku: 'RCN148', brand: 'Ridhi', color: 'Mustard' }, { sku: 'TBL-60x90-IND', brand: 'Fabricrush', color: 'Indigo' }] };
  /* words that exist only as names ("printers", "textiles" are ordinary words of her answers, so they may be corrected) */
  const names = ['ramesh', 'kumar', 'salim', 'ansari', 'govind', 'prasad', 'shree', 'mehta', 'mustard', 'ridhi', 'fabricrush', 'indigo', 'rcn148'];
  let bad = 0;
  for (const q of ['Ramsh ko maal diya kaha chadhau', 'Salm ka hisab kaha dekhe', 'Govnd ne pieces wapas kiye', 'Shre Printrs ka order kaha hai',
    'Mehta Textils ko kapda bheja', 'RCN14B ka stock kitna hai', 'TBL-60x90-IN kaha hai', 'mustrd colour ka order', 'pakking list kaha hai', 'karigar ko maaal kaise de']) {
    const u = M.ctx.MEERA.understand(q);
    const shown = names.filter(n => u.text.toLowerCase().includes(n) && !q.toLowerCase().includes(n));
    if (shown.length) bad++;
    console.log((shown.length ? 'NAME SHOWN ' + shown.join(',') : 'ok').padEnd(12), '|', q, '=>', u.text, u.changes.length ? '(' + u.changes.map(c => c.from + '>' + c.to).join(', ') + ')' : '(as typed)');
  }
  console.log(bad ? bad + ' question(s) showed a name that was not typed' : 'no name shown that was not typed');
  process.exit(bad ? 1 : 0);
})();
