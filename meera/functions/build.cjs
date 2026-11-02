/* Makes meera/functions ready to deploy (and to test): her search code from meera/router/src into lib/, her answers,
 * walk-throughs and meaning table from Replenish-App/public/guide into data/, and data/version.json (a fingerprint).
 *   node meera/functions/build.cjs [--check]      --check: fails when lib/ or data/ is not what the sources make */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..'), F = __dirname;
const COPY = [['meera/router/src/search.js', 'lib/search.js'], ['meera/router/src/search.gen.js', 'lib/search.gen.js'], ['meera/router/src/auth.js', 'lib/auth.js'],
  ['Replenish-App/public/guide/meera-bank.json', 'data/meera-bank.json'], ['Replenish-App/public/guide/meera-walks.json', 'data/meera-walks.json'],
  ['Replenish-App/public/guide/meera-words.bin', 'data/meera-words.bin']];
const want = new Map(COPY.map(([s, d]) => [d, fs.readFileSync(path.join(ROOT, s))]));
const v = crypto.createHash('sha256');
for (const d of ['data/meera-bank.json', 'data/meera-walks.json', 'data/meera-words.bin']) v.update(want.get(d));
want.set('data/version.json', Buffer.from(JSON.stringify({ v: v.digest('hex').slice(0, 12) }) + '\n'));
if (process.argv.includes('--check')) {
  const stale = [...want].filter(([d, b]) => !fs.existsSync(path.join(F, d)) || !fs.readFileSync(path.join(F, d)).equals(b)).map(([d]) => d);
  if (stale.length) { console.log('meera/functions/' + stale.join(', ') + ' is NOT what her sources make — run node meera/functions/build.cjs'); process.exit(1); }
  console.log('meera/functions is what her sources make'); process.exit(0);
}
for (const [d, b] of want) { fs.mkdirSync(path.dirname(path.join(F, d)), { recursive: true }); fs.writeFileSync(path.join(F, d), b); }
console.log(`meera/functions ready: ${want.size} files, answers ${JSON.parse(want.get('data/version.json')).v}`);
