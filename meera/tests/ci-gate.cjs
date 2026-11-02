/* MEERA'S GATE ON GITHUB — which checks may stop a deploy, and a plain message when one does (Ravi, 29 Oct 2026).
 *
 *   node meera/tests/ci-gate.cjs [<commit before this push>]      (GitHub passes it as MEERA_BASE)
 *
 * It looks at what the push changed:
 *   - Meera herself (meera/, her answers and files in Replenish-App/public/guide and /meera, the bridge, the screen
 *     announcement in nav.js, the page's join order or builder), or
 *   - a screen box she points at (an id her walk-rounds, walk-throughs or answers light up, added or removed in the ERP)
 *   → the full gate runs and BLOCKS the deploy if she got worse.
 * Anything else — an ordinary ERP change that does not touch her — still runs every check, but only WARNS, so an
 * urgent ERP fix is never stuck behind her. A new branch (no "before" commit) gets the full gate.
 *
 * The checks: meera.js is what her sources make; the never-break list; her scores and 580 golden answers, in the page
 * and as meera.js. A meant change is accepted with: node meera/tests/gate.cjs --accept "why" (then commit
 * meera/bank/baseline/). */
const fs = require('fs'), path = require('path'), { execFileSync, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); } catch (e) { return null; } };

const MEERA_PATHS = [/^meera\//, /^Replenish-App\/public\/guide\//, /^Replenish-App\/public\/meera\//, /^Replenish-App\/src\/app\/core\/meera-bridge\.js$/,
  /^Replenish-App\/src\/app\/core\/nav\.js$/, /^Replenish-App\/src\/app\/ORDER$/, /^Replenish-App\/tests\/assemble\.js$/, /^\.github\/workflows\/replenish-hosting\.yml$/];

/* every box id Meera points at: her walk-rounds and fixes, her job guides, the walk-throughs, the answers' "Show me" */
function meeraIds() {
  const ids = new Set();
  const add = s => { for (const m of String(s || '').replace(/\[[^\]]*\]/g, '').matchAll(/#([A-Za-z][\w-]*)/g)) ids.add(m[1]); };
  for (const f of ['guide-tours.js', 'guide-ask.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'meera/client/src/legacy', f), 'utf8');
    for (const m of src.matchAll(/sel:\s*'([^']*)'/g)) add(m[1]);
  }
  const g = p => JSON.parse(fs.readFileSync(path.join(ROOT, 'Replenish-App/public/guide', p), 'utf8'));
  for (const w of g('meera-walks.json')) for (const s of w.steps || []) { add(s.sel); add(s.skip); }
  for (const e of g('meera-bank.json')) { add(e.sel); if (e.p) add(e.p[5]); }
  return ids;
}

function scope(base) {
  if (!base || /^0+$/.test(base) || git('cat-file', '-e', base + '^{commit}') === null)
    return { full: true, why: 'a new branch or an unknown starting point — the full gate' };
  const files = (git('diff', '--name-only', base, 'HEAD') || '').split('\n').filter(Boolean);
  const mine = files.filter(f => MEERA_PATHS.some(re => re.test(f)));
  if (mine.length) return { full: true, why: `this push changes Meera's own files (${mine.slice(0, 4).join(', ')}${mine.length > 4 ? ' …' : ''})` };
  const diff = (git('diff', '-U0', base, 'HEAD', '--', 'Replenish-App/src', 'Replenish-App/public/index.html') || '').split('\n').filter(l => /^[+-][^+-]/.test(l));
  const ids = meeraIds();
  const hit = [...ids].filter(id => diff.some(l => new RegExp(`(^|[^\\w-])${id.replace(/[-]/g, '\\-')}([^\\w-]|$)`).test(l)));
  if (hit.length) return { full: true, why: `this push changes screen boxes Meera points at (#${hit.slice(0, 5).join(', #')}${hit.length > 5 ? ' …' : ''})` };
  return { full: false, why: `this push does not touch Meera or the boxes she points at (${files.length} file(s) changed)` };
}

const CHECKS = [
  { name: 'meera.js is what her sources make', cmd: ['meera/client/build.cjs', '--check'], fix: 'run: node meera/client/build.cjs, and commit Replenish-App/public/meera/' },
  { name: 'never-break list', cmd: ['meera/tests/never-break.cjs'], fix: 'a never-break item failed (see the FAIL lines): fix it — these must always work' },
  { name: 'no-worse gate, Meera in the page', cmd: ['meera/tests/gate.cjs'], fix: 'if the change is meant: node meera/tests/gate.cjs --accept "why", commit meera/bank/baseline/' },
  { name: 'no-worse gate, Meera as meera.js', cmd: ['meera/tests/gate.cjs', '--bundle'], fix: 'meera.js answers differently from the page: rebuild it (node meera/client/build.cjs) and re-run' },
];

const base = process.argv[2] || process.env.MEERA_BASE || '';
const sc = scope(base);
console.log(`Meera's gate — ${sc.full ? 'FULL (may block the deploy)' : 'WARN ONLY (cannot block)'}: ${sc.why}\n`);
const failed = [];
for (const c of CHECKS) {
  console.log(`---- ${c.name}`);
  const r = spawnSync(process.execPath, c.cmd.map((a, i) => (i ? a : path.join(ROOT, a))), { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: sc.full ? process.env.GITHUB_ACTIONS || '' : '' } });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  if (r.status !== 0) failed.push(c);
}
if (!failed.length) { console.log('\nMEERA: all checks passed.'); process.exit(0); }
console.log(`\n${sc.full ? 'MEERA BLOCKED THIS DEPLOY' : 'MEERA WARNING (the deploy goes ahead)'} — ${failed.length} check(s) failed:`);
for (const c of failed) {
  console.log(`  • ${c.name} — ${c.fix}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::${sc.full ? 'error' : 'warning'} title=Meera: ${c.name}::${c.fix}`);
}
process.exit(sc.full ? 1 : 0);
