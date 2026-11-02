/* Phase 1, step 6: Meera's router moves into her folder — meera-router/ → meera/router/ — and still deploys on its own
 * (.github/workflows/meera-router.yml), as the same Cloudflare Worker "meera-router" at the same address. */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
function edit(rel, pairs) {
  const f = path.join(ROOT, rel);
  let s = fs.readFileSync(f, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
  for (const [a, b, all] of pairs) {
    const n = s.split(a).length - 1;
    if (all ? n < 1 : n !== 1) throw new Error(`${rel}: found ${n} times: ${a.slice(0, 80)}`);
    s = all ? s.split(a).join(b) : s.replace(a, () => b);
  }
  fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
  console.log('  ' + rel);
}
git('mv', 'meera-router', path.join('meera', 'router'));
console.log('moved meera-router/ → meera/router/');

edit('.github/workflows/meera-router.yml', [
  ["#   main   a push that changes meera-router/ is tested", "#   main   a push that changes meera/router/ (Meera's router, moved there 29 Oct) is tested"],
  ["    paths: ['meera-router/**', 'Replenish-App/src/app/core/guide-ai.js', '.github/workflows/meera-router.yml']",
   "    paths: ['meera/router/**', 'meera/client/src/legacy/guide-ai.js', '.github/workflows/meera-router.yml']"],
  ["        working-directory: meera-router\n", "        working-directory: meera/router\n"],
  ["put its ID in meera-router/wrangler.", "put its ID in meera/router/wrangler."],
]);
/* the wrangler steps name the folder too */
{
  const f = path.join(ROOT, '.github/workflows/meera-router.yml');
  const s = fs.readFileSync(f, 'utf8');
  const n = (s.match(/workingDirectory: meera-router/g) || []).length;
  if (n) { fs.writeFileSync(f, s.split('workingDirectory: meera-router').join('workingDirectory: meera/router')); console.log('  wrangler steps:', n); }
  if (/meera-router\//.test(fs.readFileSync(f, 'utf8'))) throw new Error('meera-router/ still named in the workflow');
}
edit('meera/router/test/same-cleaning.test.mjs', [
  ["/* The page cleans a question before it leaves (Replenish-App/src/app/core/guide-ai.js, gaClean)", "/* The page cleans a question before it leaves (meera/client/src/legacy/guide-ai.js, gaClean)"],
  ["const src = readFileSync(path.join(HERE, '..', '..', 'Replenish-App', 'src', 'app', 'core', 'guide-ai.js'), 'utf8');",
   "const src = readFileSync(path.join(HERE, '..', '..', 'client', 'src', 'legacy', 'guide-ai.js'), 'utf8');"],
]);
edit('meera/tests/never-break.cjs', [["path.join(ROOT, 'meera-router/src/worker.js')", "path.join(ROOT, 'meera/router/src/worker.js')"]]);
edit('meera/client/src/legacy/guide-ai.js', [
  ["through her router (meera-router/, a Cloudflare Worker)", "through her router (meera/router/, a Cloudflare Worker)"],
  ["(meera-router/src/redact.js)", "(meera/router/src/redact.js)"],
]);
