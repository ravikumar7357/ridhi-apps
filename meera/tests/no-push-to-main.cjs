/* NO AUTOMATION PUSHES TO MAIN (master plan C.1, decision 6) — run by her deploy gate.
 * Reads every GitHub workflow in .github/workflows and fails when one could change main by itself:
 *   - only meera-autobank.yml may have "contents: write" (to push its own autobank/* branch and open the pull request);
 *   - every "git push" in any workflow must name an autobank/* branch, never main, preview/* or a bare push;
 *   - no workflow may merge a pull request or turn on auto-merge ("gh pr merge", "--auto").
 * GitHub's own rule (a ruleset on main that only Ravi can pass) is the lock; this check keeps the workflows honest.
 *   node meera/tests/no-push-to-main.cjs */
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', '..', '.github', 'workflows');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
for (const f of fs.readdirSync(DIR).filter(f => /\.ya?ml$/.test(f))) {
  const y = fs.readFileSync(path.join(DIR, f), 'utf8');
  const lines = y.split(/\r?\n/).filter(l => !/^\s*#/.test(l));
  const write = lines.some(l => /^\s*contents:\s*write\b/.test(l));
  ok(!write || f === 'meera-autobank.yml', `${f}: only meera-autobank.yml may write to the repository`);
  lines.filter(l => /\bgit\s+push\b/.test(l)).forEach(l => {
    ok(/refs\/heads\/\$HEAD"?\s*$/.test(l.trim()) || /\bautobank\//.test(l), `${f}: a push that does not name an autobank/* branch: ${l.trim()}`);
    ok(!/\b(main|master|preview\/)\b/.test(l), `${f}: a push naming main or a test link: ${l.trim()}`);
  });
  ok(!lines.some(l => /\bgh\s+pr\s+merge\b|--auto\b|enablePullRequestAutoMerge/.test(l)), `${f}: no workflow merges a pull request by itself`);
  if (f === 'meera-autobank.yml') {
    ok(/HEAD="autobank\//.test(y), 'meera-autobank.yml: its branch is autobank/<branch>');
    ok(/case "\$HEAD" in autobank\/\*\)/.test(y), 'meera-autobank.yml: it stops before pushing anything that is not autobank/*');
  }
}
console.log(`no-push-to-main: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
