/* BUTTON 4 — Compare the REAL ERP with GitHub.   node tools/compare-real.js
 *
 * READS ONLY. It deploys nothing, changes nothing on Firebase, and leaves your branch and your files as they were.
 * It answers three questions, line by line:
 *
 *   1. Is the REAL ERP (what fabricrush-replenish.web.app and price-research-48ff3.web.app serve right now) the code
 *      on GitHub's main?  It builds main the way a deploy does (tests/build-dist.js, in a throw-away copy of main beside
 *      this folder) and compares the two pages. If they differ, somebody deployed code that is not on main.
 *   2. Is the TEST ERP (R1) the code on dev?  It builds dev the way GitHub does and compares with what R1 serves.
 *   3. What does R1 have that the real ERP has not?  Every file and commit on dev that is not on main.
 *
 * It also brings your local "main" up to GitHub's (fast-forward only; never your own branch, never a checkout).
 * Needs esbuild for step 1 (the deploy build) — it is looked for in Replenish-App/node_modules here, then in the
 * "Amazon Inventory" folder beside this one. Without it, step 1 is skipped and says so. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const MAINCOPY = path.join(ROOT, '..', '_compare-main');
const TEMPDIR = path.join(ROOT, '..', '_compare-tmp');
const REAL = { factory: 'https://fabricrush-replenish.web.app/', sellora: 'https://price-research-48ff3.web.app/' };
const TEST = { factory: 'https://ravikumar7357.github.io/ridhi-apps/replenish/', sellora: 'https://ravikumar7357.github.io/ridhi-apps/sellora/' };

const C = { g: s => '\x1b[32m' + s + '\x1b[0m', r: s => '\x1b[31m' + s + '\x1b[0m', y: s => '\x1b[33m' + s + '\x1b[0m', b: s => '\x1b[36m' + s + '\x1b[0m' };
const report = [], verdict = [];
const say = (s, color) => { report.push(s); console.log(color ? color(s) : s); };
const head = s => say('\n== ' + s + ' ==', C.b);
fs.mkdirSync(TEMPDIR, { recursive: true });
const NM = [path.join(ROOT, 'Replenish-App', 'node_modules'), path.join(ROOT, '..', 'Amazon Inventory', 'Replenish-App', 'node_modules')]
  .find(p => fs.existsSync(path.join(p, 'esbuild')));
const ENV = Object.assign({}, process.env, { TEMP: TEMPDIR, TMP: TEMPDIR, TMPDIR: TEMPDIR }, NM ? { NODE_PATH: NM } : {});
const sh = (cmd, cwd, env) => cp.execSync(cmd, { cwd: cwd || ROOT, encoding: 'utf8', env: Object.assign({}, ENV, env || {}),
  stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim();
const tryd = (f, dflt) => { try { return f(); } catch (e) { return dflt; } };
const get = async u => { const r = await fetch(u, { cache: 'no-store' }); return { t: await r.text(), deployed: r.headers.get('last-modified') || '?' }; };
/* A text-encoding mark at the very start and Windows line ends are not code: both sides lose them before comparing. */
const clean = s => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

/** Lines one side has and the other has not (counted, so a line that appears twice more on one side shows). */
function compare(label, built, served, builtName, servedName) {
  const a = clean(built).split('\n'), b = clean(served).split('\n');
  const count = arr => arr.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const ca = count(a), cb = count(b), onlyA = [], onlyB = [];
  ca.forEach((n, l) => { if (n > (cb.get(l) || 0) && l.trim()) onlyA.push(l); });
  cb.forEach((n, l) => { if (n > (ca.get(l) || 0) && l.trim()) onlyB.push(l); });
  if (!onlyA.length && !onlyB.length) { say(`${label}: SAME`, C.g); return true; }
  say(`${label}: DIFFERENT — ${onlyB.length} line(s) only in ${servedName}, ${onlyA.length} only in ${builtName}`, C.r);
  const show = (arr, who) => { arr.slice(0, 12).forEach(l => say(`   ${who}: ${l.trim().slice(0, 170)}`)); if (arr.length > 12) say(`   … and ${arr.length - 12} more`); };
  show(onlyB, servedName.padEnd(5)); show(onlyA, builtName.padEnd(5));
  return false;
}

(async () => {
  say('Compare the REAL ERP with GitHub — ' + new Date().toLocaleString() + '  (reads only)', C.b);

  head('1. GitHub');
  sh('git fetch -q origin');
  const branch = sh('git rev-parse --abbrev-ref HEAD');
  if (branch !== 'main') tryd(() => sh('git fetch -q origin main:main'), null);   // local main follows GitHub's; never the branch you are on
  say(`GitHub main ${sh('git rev-parse --short origin/main')} · GitHub dev ${sh('git rev-parse --short origin/dev')} · you are on ${branch}`);
  const behind = Number(sh('git rev-list --count origin/dev..origin/main'));
  if (behind) { say(`dev is MISSING ${behind} commit(s) of main — R1 is older than main. Bring main into dev before comparing screens.`, C.r); verdict.push(C.r(`dev lacks ${behind} commit(s) of main`)); }
  else say('dev has everything main has', C.g);
  const dirty = sh('git status --porcelain');
  if (dirty) say('note: you have changes not yet sent (they are not part of any comparison below)', C.y);

  head('2. REAL ERP vs GitHub main');
  let realOk = null;
  try { sh(`git worktree remove --force "${MAINCOPY}"`); } catch (e) { /* none left over */ }
  try {
    sh(`git worktree add --detach "${MAINCOPY}" origin/main`);
    const realF = await get(REAL.factory), realS = await get(REAL.sellora);
    say(`factory ERP last deployed: ${realF.deployed} · Sellora last deployed: ${realS.deployed}`);
    if (!NM) say('factory: SKIPPED — esbuild is not installed here (npm install in Replenish-App), so main cannot be built the deploy way', C.y);
    else {
      sh('node tests/build-dist.js', path.join(MAINCOPY, 'Replenish-App'));
      const dist = fs.readFileSync(path.join(MAINCOPY, 'Replenish-App', 'dist', 'index.html'), 'utf8');
      realOk = compare('factory ERP (real) vs main', dist, realF.t, 'MAIN', 'REAL');
    }
    /* Sellora is deployed as public/ itself. main's public can lag its own src, so it is also built from src. */
    const sPub = fs.readFileSync(path.join(MAINCOPY, 'Pricing-App', 'public', 'index.html'), 'utf8');
    tryd(() => sh('node Replenish-App/tests/assemble.js --root Pricing-App --force', MAINCOPY), null);
    const sSrc = fs.readFileSync(path.join(MAINCOPY, 'Pricing-App', 'public', 'index.html'), 'utf8');
    const sOk = compare('Sellora (real) vs main', sSrc, realS.t, 'MAIN', 'REAL');
    if (clean(sPub) !== clean(sSrc)) say('   (main\'s Sellora public/index.html is behind its own src — it was not re-assembled before committing)', C.y);
    realOk = realOk !== false && sOk;
  } catch (e) { say('could not finish: ' + String(e.stderr || e.message).split('\n')[0], C.r); realOk = false; }
  finally { tryd(() => sh(`git worktree remove --force "${MAINCOPY}"`), null); }
  verdict.push(realOk ? C.g('REAL ERP = GitHub main') : C.r('REAL ERP is NOT GitHub main — someone deployed code that is not on main (lines above)'));

  head('3. TEST ERP (R1) vs GitHub dev');
  const devSha = sh('git rev-parse origin/dev');
  const liveF = await get(TEST.factory), liveS = await get(TEST.sellora);
  const r1sha = (liveF.t.match(/sha: "([0-9a-f]+)"/) || [])[1] || '?';
  say(`R1 is serving the build of ${r1sha}; GitHub dev is ${devSha.slice(0, 7)}` + (devSha.startsWith(r1sha) ? '' : ' — R1 has not caught up yet (wait ~2 min after a send)'), devSha.startsWith(r1sha) ? null : C.y);
  /* Build dev exactly as GitHub does: a clean copy of dev, so your unsent changes do not count. */
  const DEVCOPY = path.join(ROOT, '..', '_compare-dev');
  let r1Ok = false;
  try {
    tryd(() => sh(`git worktree remove --force "${DEVCOPY}"`), null);
    sh(`git worktree add --detach "${DEVCOPY}" origin/dev`);
    sh('node Replenish-App/tests/build-test-erp.js', DEVCOPY, { GITHUB_SHA: devSha, GITHUB_REF_NAME: 'dev' });
    const norm = s => clean(s).replace(/built: "[^"]*"/, 'built: ""').replace(/\d{4}-\d\d-\d\d \d\d:\d\d UTC/g, 'WHEN');
    const f = compare('R1 factory vs dev', norm(fs.readFileSync(path.join(DEVCOPY, '_site', 'replenish', 'index.html'), 'utf8')), norm(liveF.t), 'DEV', 'R1');
    const s = compare('R1 Sellora vs dev', norm(fs.readFileSync(path.join(DEVCOPY, '_site', 'sellora', 'index.html'), 'utf8')), norm(liveS.t), 'DEV', 'R1');
    r1Ok = f && s;
  } catch (e) { say('could not finish: ' + String(e.stderr || e.message).split('\n')[0], C.r); }
  finally { tryd(() => sh(`git worktree remove --force "${DEVCOPY}"`), null); }
  verdict.push(r1Ok ? C.g('TEST ERP (R1) = GitHub dev') : C.r('TEST ERP (R1) is NOT GitHub dev (lines above)'));

  head('4. What R1 has that the REAL ERP has not (dev vs main)');
  const files = sh('git diff --stat origin/main origin/dev -- . ":(exclude)Replenish-App/public/index.html" ":(exclude)Pricing-App/public/index.html"');
  say(files || 'nothing — dev and main are the same code');
  const commits = sh('git log --format="%h %s" --no-merges origin/main..origin/dev');
  if (commits) { say('\ncommits on dev, not yet on main:'); commits.split('\n').forEach(l => say('  ' + l)); }

  head('RESULT');
  verdict.forEach(v => console.log('  ' + v));
  report.push('', 'RESULT', ...verdict.map(v => '  ' + v.replace(/\x1b\[\d+m/g, '')));
  fs.writeFileSync(path.join(TEMPDIR, '..', 'compare-real-report.txt'), report.join('\n'));
  console.log('\nThe same, as a file: ' + path.join(TEMPDIR, '..', 'compare-real-report.txt'));
  fs.rmSync(TEMPDIR, { recursive: true, force: true });
})().catch(e => { console.error(C.r('Stopped: ' + (e.stack || e))); tryd(() => sh(`git worktree remove --force "${MAINCOPY}"`), null); process.exitCode = 1; });
