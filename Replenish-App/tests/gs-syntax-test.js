/* Every Apps Script file in the repository must at least parse. A typo in a .gs file is otherwise found only after
 * `clasp push`, by the live backend failing. Run: node Replenish-App/tests/gs-syntax-test.js (CI runs it on every
 * pull request). */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['Pricing-API', 'Repl-API', 'Repl-API-CPC', 'Backup-Script'];
let bad = 0, n = 0;
for (const d of DIRS) {
  const dir = path.join(ROOT, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(x => /\.(gs|js)$/.test(x))) {
    n++;
    try { new Function(fs.readFileSync(path.join(dir, f), 'utf8')); }
    catch (e) { bad++; console.log('FAIL ' + d + '/' + f + ': ' + e.message); }
  }
}
console.log(`${n - bad} of ${n} Apps Script files parse`);
process.exit(bad ? 1 : 0);
