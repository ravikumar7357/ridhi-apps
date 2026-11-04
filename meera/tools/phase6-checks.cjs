/* Phase 6, items 4, 5 and 7: the answer-format check stops meera.js's build; "Show me" boxes join the never-break list;
 * the deploy gate also runs the answers check, the guide-errors check, her router's tests and the privacy test. Run once. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
function edit(rel, pairs) {
  const f = path.join(ROOT, rel);
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of pairs) { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`${rel}: found ${n}× — ${a.slice(0, 70)}`); s = s.replace(a, () => b); }
  fs.writeFileSync(f, s);
}
edit('meera/client/build.cjs', [["function build() {\n",
  "function build() {\n"
+ "  /* Phase 6: a broken answer stops the build, in plain words (meera/tests/answers-check.cjs) */\n"
+ "  const bad = require(path.join(ROOT, 'meera', 'tests', 'answers-check.cjs')).check();\n"
+ "  if (bad.length) { console.log(`meera.js NOT BUILT — her answers have ${bad.length} problem(s):`); bad.slice(0, 30).forEach(b => console.log('  • ' + b)); process.exit(1); }\n"]]);
edit('meera/tests/never-break.cjs', [["  ok(!walkMissing.length, 'every walk-through box is in the app'",
  "  /* Phase 6: every answer's \"Show me\" box, and every part of a screen she explains, is still in the app */\n"
+ "  const bankAll = JSON.parse(fs.readFileSync(path.join(APP, 'public/guide/meera-bank.json'), 'utf8'));\n"
+ "  const showMissing = [];\n"
+ "  for (const e of bankAll) for (const id of idsIn(e.sel).concat(e.p ? idsIn(e.p[5]) : [])) if (!known(ids, src, id)) showMissing.push(e.id + ' → #' + id);\n"
+ "  ok(!showMissing.length, 'every answer\\'s \"Show me\" box is in the app' + (showMissing.length ? ': ' + showMissing.slice(0, 8).join(', ') : ''));\n"
+ "  ok(!walkMissing.length, 'every walk-through box is in the app'"]]);
edit('meera/tests/ci-gate.cjs', [["const CHECKS = [\n",
  "const CHECKS = [\n"
+ "  /* Phase 6 */\n"
+ "  { name: 'her answers are well-formed', cmd: ['meera/tests/answers-check.cjs'], fix: 'fix the answers named above in Replenish-App/public/guide/' },\n"
+ "  { name: 'guide-errors is up to date with the screens', cmd: ['meera/tools/make-errors.cjs', '--check'], fix: 'run: node meera/tools/make-errors.cjs, then her gate, and commit meera/client/src/legacy/guide-errors.ts', warnOnly: true },\n"
+ "  { name: 'her router\\'s tests', cmd: ['meera/router/test/router.test.mjs'], fix: 'a router test failed (see the FAIL lines)' },\n"
+ "  { name: 'the page and the router clean questions alike', cmd: ['meera/router/test/same-cleaning.test.mjs'], fix: 'gaClean (guide-ai.ts) and clean (meera/router/src/redact.js) must change together' },\n"
+ "  { name: 'privacy: nothing personal is kept or sent', cmd: ['meera/tools/phase4-privacy.mjs'], fix: 'a privacy check failed (see the FAIL lines) — never ship this' },\n"]]);
console.log('ok');
