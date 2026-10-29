/* THE NO-WORSE GATE (v2 rebuild, 29 Oct 2026 — plan section 2, rule 3).
 *
 *   node meera/tests/gate.cjs                 compare now against the baseline: fails if any score drops or any
 *                                             golden answer changes
 *   node meera/tests/gate.cjs --bundle        the same, for meera.js — Meera as her own file (Phase 1)
 *   node meera/tests/gate.cjs --accept "why"  a change that is MEANT (an improvement, or an urgent ERP fix that changes
 *                                             her answers): shows what changed, then makes today's numbers and answers
 *                                             the new baseline and writes the reason in meera/bank/baseline/ACCEPTED.md.
 *                                             Commit meera/bank/baseline/ with the change.
 *   node meera/tests/gate.cjs --allow <file>  golden changes listed in <file> (one key per line) are allowed this once
 *   node meera/tests/gate.cjs --baseline      record the baseline from scratch (Phase 0 only)
 *
 * Scores must be equal or better: right first time and right-or-offered may not fall, wrong may not rise — on each of
 * the three test sets and on the spelling-mistake set. Sizes are printed, not judged. */
const fs = require('fs'), path = require('path');
const { measure } = require('./measure.cjs');
const DIR = path.join(__dirname, '..', 'bank', 'baseline');
const f = n => path.join(DIR, n);
const CI = !!process.env.GITHUB_ACTIONS;

function compare(base, now) {
  const fails = [], notes = [];
  const sets = Object.keys(base.scores).concat(['typos'], Object.keys(base.extra || {}));
  const name = { eval: 'test set 1', eval2: 'test set 2', parts: 'button/column questions', typos: 'spelling-mistake questions',
    held: 'spelling set 2 (held back, scoring only)', hindi: 'Hindi-script spelling mistakes' };
  const get = (o, k) => (k === 'typos' ? o.typos : o.scores[k] || (o.extra || {})[k]);
  for (const k of sets) {
    const b = get(base, k), n = get(now, k);
    if (!n) { fails.push({ line: `${name[k] || k}: missing now`, why: `${name[k] || k} was not measured` }); continue; }
    const line = `${name[k] || k}: right ${b.right}→${n.right}, offered ${b.offered}→${n.offered}, wrong ${b.wrong}→${n.wrong}, not sure ${b.none}→${n.none}`;
    if (n.right < b.right) fails.push({ line, why: `${name[k] || k}: ${b.right - n.right} fewer answered right first time (${b.right} → ${n.right})` });
    else if (n.right + n.offered < b.right + b.offered) fails.push({ line, why: `${name[k] || k}: fewer answered right or offered (${b.right + b.offered} → ${n.right + n.offered})` });
    else if (n.wrong > b.wrong) fails.push({ line, why: `${name[k] || k}: ${n.wrong - b.wrong} more answered confidently WRONG (${b.wrong} → ${n.wrong})` });
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
const short = a => (a ? `${a.bank || '-'} · ${a.text.slice(0, 90)}` : '(none)');
function writeBaseline(now) {
  fs.mkdirSync(DIR, { recursive: true });
  const { golden, typoList, ...nums } = now;
  for (const k of Object.keys(nums.scores)) delete nums.scores[k].per;
  delete nums.typos.per;
  for (const k of Object.keys(nums.extra || {})) delete nums.extra[k].per;
  fs.writeFileSync(f('baseline.json'), JSON.stringify({ made: new Date().toISOString().slice(0, 10), ...nums }, null, 1) + '\n');
  fs.writeFileSync(f('golden.json'), JSON.stringify(golden, null, 1) + '\n');
  fs.writeFileSync(f('typo-set.json'), JSON.stringify(typoList, null, 1) + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  const bundle = args.includes('--bundle');
  /* --on=design,…: her switches on (meera.js only) — a look-only switch must give the very same answers */
  const switches = ((args.find(a => a.startsWith('--on=')) || '').slice(5)).split(',').filter(Boolean);
  if (switches.length && !bundle) { console.log('switches work in meera.js only: add --bundle'); process.exit(2); }
  if (switches.length && args.includes('--accept')) { console.log('the baseline is recorded with every switch off'); process.exit(2); }
  const now = await measure({ bundle, switches });
  if (switches.length) console.log('switches on: ' + switches.join(', '));
  if (bundle) console.log('checking meera.js — Meera as her own file');
  if (args.includes('--baseline')) {
    writeBaseline(now);
    console.log('baseline written:', Object.keys(now.golden).length, 'golden answers,', now.typoList.length, 'spelling-mistake questions');
    return;
  }
  const base = JSON.parse(fs.readFileSync(f('baseline.json'), 'utf8'));
  const golden = JSON.parse(fs.readFileSync(f('golden.json'), 'utf8'));
  const ai = args.indexOf('--allow');
  const allowed = new Set(ai >= 0 ? fs.readFileSync(args[ai + 1], 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean) : []);
  const { fails, notes } = compare(base, now);
  const g = goldenDiff(golden, now.golden, allowed);
  notes.forEach(l => console.log('  ok   ' + l));
  fails.forEach(x => console.log('  FAIL ' + x.line));
  console.log(`golden answers: ${Object.keys(golden).length - g.changed.length - g.allowedSeen.length} the same, ${g.allowedSeen.length} changed as intended, ${g.changed.length} changed unexpectedly`);
  for (const c of g.allowedSeen.concat(g.changed).slice(0, 40))
    console.log(`  ${g.changed.includes(c) ? 'CHANGED' : 'meant  '} ${c.key}\n     before: ${short(c.before)}\n     after:  ${short(c.after)}`);
  console.log('sizes now:', Object.entries(now.sizes).map(([k, v]) => `${k} ${Math.round(v.gzip / 1024)} KB`).join(' · '));
  console.log(`speed: starts in ${now.timing.loadMs} ms, ${now.timing.msPerAnswer} ms an answer (baseline ${base.timing.loadMs} ms, ${base.timing.msPerAnswer} ms)`);

  /* --accept "why": a meant change becomes the new baseline, with the reason on record */
  const acc = args.indexOf('--accept');
  if (acc >= 0) {
    const why = String(args[acc + 1] || '').trim();
    if (!why || why.startsWith('--')) { console.log('Say why, in quotes: node meera/tests/gate.cjs --accept "what changed and why"'); process.exit(2); }
    if (bundle) { console.log('Accept with Meera in the page (without --bundle); meera.js must then match it.'); process.exit(2); }
    writeBaseline(now);
    const lines = [`## ${new Date().toISOString().slice(0, 16).replace('T', ' ')} — ${why}`, ''];
    fails.forEach(x => lines.push(`- score: ${x.line}`));
    g.changed.forEach(c => lines.push(`- answer \`${c.key}\`\n  - before: ${short(c.before)}\n  - after: ${short(c.after)}`));
    if (!fails.length && !g.changed.length) lines.push('- no score or answer changed (only the record refreshed)');
    const log = f('ACCEPTED.md');
    const head = fs.existsSync(log) ? '' : '# Meera — changes accepted into the baseline\n\nEach entry: when, why, and what it changed. Made by `node meera/tests/gate.cjs --accept "why"`.\n\n';
    fs.appendFileSync(log, head + lines.join('\n') + '\n\n');
    console.log(`\nACCEPTED: the baseline now has today's numbers and answers (${g.changed.length} answer(s), ${fails.length} score(s) changed).`);
    console.log('Reason written in meera/bank/baseline/ACCEPTED.md. Commit meera/bank/baseline/ together with your change.');
    return;
  }

  if (fails.length || g.changed.length) {
    const reasons = fails.map(x => x.why);
    if (g.changed.length) reasons.push(`${g.changed.length} of Meera's ${Object.keys(golden).length} recorded answers changed${bundle ? ' in meera.js' : ''} (listed above)`);
    console.log('\nMEERA GATE BLOCKED THIS — Meera would be worse than her baseline' + (bundle ? ' (as her own file, meera.js)' : '') + ':');
    reasons.forEach(r => console.log('  • ' + r));
    console.log('\nWhat to do:');
    console.log('  • If Meera really got worse: undo or fix the change.');
    console.log('  • If the change is MEANT (an improvement, or an urgent ERP fix that changes her answers), accept it:');
    console.log('        node meera/tests/gate.cjs --accept "what changed and why"');
    console.log('    then commit meera/bank/baseline/ with the change and push again.');
    if (CI) reasons.forEach(r => console.log(`::error title=Meera gate blocked::${r} — if meant: node meera/tests/gate.cjs --accept "why", commit meera/bank/baseline/`));
    process.exit(1);
  }
  console.log('MEERA GATE: passed — no worse than the baseline');
}
main().catch(e => { console.error(e); process.exit(1); });
