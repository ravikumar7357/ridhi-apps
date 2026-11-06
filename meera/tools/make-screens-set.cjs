/* THE "ASKED FROM DIFFERENT SCREENS" TEST SET (switch "screenfirst", 2 Nov 2026) → meera/bank/evals/screens.json
 *
 * Each question is asked from one screen, with the answer that is right FROM THAT SCREEN, worked out from the answers
 * themselves (not from what Meera says):
 *   part   a button, column, box or option with the same name on several screens ("Export", "Refresh", "Template"),
 *          asked from each of two of them — right: the one on the screen that is open
 *   other  a test question (eval.json, eval2.json) asked from a screen that is not its answer's — right: its own answer
 *          (nothing on the open screen should take it)
 *   named  a test question that names its screen ("Job Work mein …") asked from Shopify Orders — right: its own answer
 * Made once and kept; the same every run (no randomness).   node meera/tools/make-screens-set.cjs */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'Replenish-App/public/guide/meera-bank.json'), 'utf8'));
const ev = n => JSON.parse(fs.readFileSync(path.join(ROOT, 'meera/bank/evals', n + '.json'), 'utf8'));
const byId = new Map(bank.map(e => [e.id, e]));
const out = [];

/* part: names that are plain words (no symbols or numbers), on 2+ screens; 45 names, 2 screens each */
const by = new Map();
for (const e of bank) {
  if (!e.p || !e.tab || !/^[A-Za-z][A-Za-z +]{2,30}$/.test(e.p[0])) continue;
  const k = e.p[0].toLowerCase();
  if (!by.has(k)) by.set(k, []);
  if (!by.get(k).some(x => x.tab === e.tab)) by.get(k).push(e);
}
const ways = [L => `what does ${L} do`, L => `${L} kya karta hai`, L => `${L} ka matlab kya hai`, L => `${L} क्या है`, L => `what is ${L} here`, L => `${L} button kis kaam ka hai`];
let w = 0;
[...by].filter(([, es]) => es.length >= 2).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 45).forEach(([, es]) => {
  es.sort((a, b) => a.tab.localeCompare(b.tab)).slice(0, 2).forEach(e => out.push({ q: ways[w++ % ways.length](e.p[0]), tab: e.tab, id: e.id, kind: 'part' }));
});

/* other: questions whose answer belongs to a screen, asked from another screen (the next one in this list) */
const ROUND = ['shop', 'ord', 'pbase', 'qc', 'fgi', 'pack', 'flow', 'so', 'vord', 'pcut', 'att', 'hr', 'dash', 'rep'];
const tests = [...ev('eval'), ...ev('eval2')].filter(x => x.id && byId.has(x.id) && byId.get(x.id).tab);
let r = 0;
tests.filter((x, i) => i % 4 === 0).slice(0, 45).forEach(x => {
  const own = byId.get(x.id).tab;
  let t = ROUND[r++ % ROUND.length];
  if (t === own) t = ROUND[r++ % ROUND.length];
  out.push({ q: x.q, tab: t, id: x.id, kind: 'other' });
});

/* named: the question names its own screen, asked from Shopify Orders */
const SAY = { pbase: ['Job Work mein ', 'in job work, '], qc: ['QC mein ', 'in QC, '], pcut: ['Cutting mein ', 'in cutting, '], ord: ['Order Console mein ', 'in order console, '],
  pack: ['Packing List mein ', 'in packing list, '], fgi: ['Finished goods mein ', 'in finished goods, '], so: ['Sales order mein ', 'in sales orders, '] };
Object.entries(SAY).forEach(([tab, [hg, en]]) => {
  tests.filter(x => byId.get(x.id).tab === tab).slice(0, 4).forEach((x, i) => out.push({ q: (/[a-z]/i.test(x.q) && i % 2 ? en : hg) + x.q, tab: 'shop', id: x.id, kind: 'named' }));
});

fs.writeFileSync(path.join(ROOT, 'meera/bank/evals/screens.json'), JSON.stringify(out, null, 1) + '\n');
const n = k => out.filter(x => x.kind === k).length;
console.log(`screens.json: ${out.length} questions — ${n('part')} same name on different screens, ${n('other')} asked from another screen, ${n('named')} naming their screen`);
