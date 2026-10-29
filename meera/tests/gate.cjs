/* THE NO-WORSE GATE (v2 rebuild, 29 Oct 2026 — plan section 2, rule 3).
 *
 *   node meera/tests/gate.cjs --baseline     record today's numbers and golden answers (Phase 0, once)
 *   node meera/tests/gate.cjs                compare now against the baseline: fails if any score drops or any golden
 *                                            answer changes
 *   node meera/tests/gate.cjs --allow <file>  golden changes listed in <file> (one key per line) are allowed — a change
 *                                            that was MEANT to improve those answers; every one is printed for Ravi
 *
 * Scores must be equal or better: right first time and right-or-offered may not fall, wrong may not rise — on each of
 * the three test sets and on the spelling-mistake set. Sizes are printed, not judged. */
const fs = require('fs'), path = require('path');
const { measure } = require('./measure.cjs');
const DIR = path.join(__dirname, '..', 'bank', 'baseline');
const f = n => path.join(DIR, n);

function compare(base, now) {
  const fails = [], notes = [];
  const sets = Object.keys(base.scores).concat(['typos']);
  for (const k of sets) {
    const b = k === 'typos' ? base.typos : base.scores[k], n = k === 'typos' ? now.typos : now.scores[k];
    const line = `${k}: right ${b.right}→${n.right}, offered ${b.offered}→${n.offered}, wrong ${b.wrong}→${n.wrong}, not sure ${b.none}→${n.none}`;
    if (n.right < b.right) fails.push('fewer right first time — ' + line);
    else if (n.right + n.offered < b.right + b.offered) fails.push('fewer right or offered — ' + line);
    else if (n.wrong > b.wrong) fails.push('more confidently wrong — ' + line);
    else notes.push(line);
  }
  return { fails, notes };
}
function goldenDiff(base, now, allowed) {
  const changed = [], allowedSeen = [];
  for (const [k, a] of Object.entries(base)) {
    const b = now[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    (allowed.has(k) ? allowedSeen : changed).push({ key: k, before: a, after: b });
  }
  for (const k of Object.keys(now)) if (!(k in base)) changed.push({ key: k, before: null, after: now[k] });
  return { changed, allowedSeen };
}

async function main() {
  const args = process.argv.slice(2);
  const now = await measure();
  if (args.includes('--baseline')) {
    fs.mkdirSync(DIR, { recursive: true });
    const { golden, typoList, ...nums } = now;
    for (const k of Object.keys(nums.scores)) delete nums.scores[k].per;
    delete nums.typos.per;
    fs.writeFileSync(f('baseline.json'), JSON.stringify({ made: new Date().toISOString().slice(0, 10), ...nums }, null, 1) + '\n');
    fs.writeFileSync(f('golden.json'), JSON.stringify(golden, null, 1) + '\n');
    fs.writeFileSync(f('typo-set.json'), JSON.stringify(typoList, null, 1) + '\n');
    console.log('baseline written:', Object.keys(golden).length, 'golden answers,', typoList.length, 'spelling-mistake questions');
    return;
  }
  const base = JSON.parse(fs.readFileSync(f('baseline.json'), 'utf8'));
  const golden = JSON.parse(fs.readFileSync(f('golden.json'), 'utf8'));
  const ai = args.indexOf('--allow');
  const allowed = new Set(ai >= 0 ? fs.readFileSync(args[ai + 1], 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean) : []);
  const { fails, notes } = compare(base, now);
  const g = goldenDiff(golden, now.golden, allowed);
  notes.forEach(l => console.log('  ok   ' + l));
  fails.forEach(l => console.log('  FAIL ' + l));
  console.log(`golden answers: ${Object.keys(golden).length - g.changed.length - g.allowedSeen.length} the same, ${g.allowedSeen.length} changed as intended, ${g.changed.length} changed unexpectedly`);
  for (const c of g.allowedSeen.concat(g.changed).slice(0, 40))
    console.log(`  ${g.changed.includes(c) ? 'CHANGED' : 'meant  '} ${c.key}\n     before: ${c.before ? c.before.bank + ' · ' + c.before.text.slice(0, 90) : '(none)'}\n     after:  ${c.after ? c.after.bank + ' · ' + c.after.text.slice(0, 90) : '(none)'}`);
  console.log('sizes now:', Object.entries(now.sizes).map(([k, v]) => `${k} ${Math.round(v.gzip / 1024)} KB`).join(' · '));
  console.log(`speed: starts in ${now.timing.loadMs} ms, ${now.timing.msPerAnswer} ms an answer (baseline ${base.timing.loadMs} ms, ${base.timing.msPerAnswer} ms)`);
  if (fails.length || g.changed.length) { console.log('MEERA GATE: FAILED'); process.exit(1); }
  console.log('MEERA GATE: passed — no worse than the baseline');
}
main().catch(e => { console.error(e); process.exit(1); });
