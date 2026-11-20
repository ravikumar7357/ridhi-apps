/* THE JUDGE, MEASURED — before any "live karo" (17 Nov 2026).
 *
 *   set GROQ_API_KEY=...          (PowerShell: $env:GROQ_API_KEY = '...')   — your own Groq key; never in the repository
 *   node meera/tools/judge-eval.cjs                      her tuning sets (eval, eval2, hinglish-tune: 549 everyday questions)
 *   node meera/tools/judge-eval.cjs --set eval2 --limit 40 --show
 *   node meera/tools/judge-eval.cjs --sure 0.85          try another judgeSure (config.ts) without editing it
 *   node meera/tools/judge-eval.cjs --model llama-3.1-8b-instant    a smaller Groq model for the judge (JUDGE_MODEL)
 *   node meera/tools/judge-eval.cjs --held               ALSO the held-back sets — SCORING ONLY: never tune on them
 *
 * For every test question (each knows the answer id it should get): her own answer as today; then, where the judge would
 * be asked (not sure, "did you mean", or sure under judgeSure; never live figures, outside or chat), the SAME prompt and
 * candidates the router sends (meera/router/src/worker.js JUDGE_SYSTEM, candLine; the question cleaned the router's way),
 * straight to Groq. Then: right / wrong / not sure before and after, how many the judge fixed and broke, how many
 * questions went to Groq, and the tokens they cost. Nothing is kept anywhere; only made-up and test questions are sent. */
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const has = k => process.argv.includes('--' + k);
const KEY = process.env.GROQ_API_KEY || '';
if (!KEY) { console.log('Set GROQ_API_KEY first (your own key; it is never written anywhere).'); process.exit(2); }
const MODEL = arg('model', process.env.JUDGE_MODEL || 'openai/gpt-oss-120b');
const LIMIT = +arg('limit', 0) || Infinity;
const SHOW = has('show');

(async () => {
  const W = await import(pathToFileURL(path.join(ROOT, 'meera', 'router', 'src', 'worker.js')).href);
  const { readPick } = await import(pathToFileURL(path.join(ROOT, 'meera', 'router', 'src', 'providers.js')).href);
  const { clean } = await import(pathToFileURL(path.join(ROOT, 'meera', 'router', 'src', 'redact.js')).href);
  const M = await require(path.join(ROOT, 'meera', 'tests', 'harness.cjs')).load({ root: ROOT });
  const CFG = M.run('MEERA_CONFIG');
  const SURE = +arg('sure', CFG.judgeSure || 0.9), TOP = CFG.judgeTop || 20;
  const BANK = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, 'Replenish-App', 'public', 'guide', 'meera-bank.json'), 'utf8')).map(e => [e.id, e]));
  const EV = path.join(ROOT, 'meera', 'bank', 'evals');
  const sets = (arg('set', '') ? [arg('set')] : ['eval', 'eval2', 'hinglish-tune']).concat(has('held') ? ['typos-held', 'hinglish-held'] : []);
  let tokens = 0, asked = 0;
  async function groq(user) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.2, max_tokens: 1500, response_format: { type: 'json_object' }, ...(/gpt-oss/.test(MODEL) ? { reasoning_effort: 'low' } : {}),
        messages: [{ role: 'system', content: W.JUDGE_SYSTEM }, { role: 'user', content: user }] }) });
    if (r.status === 429) { await new Promise(ok => setTimeout(ok, 8000)); return groq(user); }   // Groq's own rate limit: wait, try again
    if (!r.ok) throw new Error('Groq HTTP ' + r.status);
    const j = await r.json();
    tokens += (j.usage && j.usage.total_tokens) || 0;
    return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  }
  for (const set of sets) {
    const f = path.join(EV, set + '.json');
    if (!fs.existsSync(f)) { console.log('no such set: ' + set); continue; }
    const list = JSON.parse(fs.readFileSync(f, 'utf8')).filter(x => x && x.q && x.id).slice(0, LIMIT);
    const s = { before: { right: 0, wrong: 0, none: 0 }, after: { right: 0, wrong: 0, none: 0 }, fixed: 0, broke: 0, judged: 0 };
    const lines = [];
    for (const t of list) {
      const tab = t.tab || 'shop';
      const own = await M.answer(t.q, tab);
      M.run('GA_TOPK = ' + TOP);
      let hits;
      try { hits = M.find(t.q, tab).filter(h => !/^learned-/.test(h.id)); } finally { M.run('GA_TOPK = MEERA_CONFIG.topK'); }
      const mark = id => (id === t.id ? 'right' : id ? 'wrong' : 'none');
      const before = mark(own.bank);
      let shown = own.bank, how = 'own';
      const kind = M.run('typeof miClassify === "function"') ? (M.ctx.__q = t.q, M.run('miClassify(__q).intent')) : 'unknown';
      const goes = !own.off && (own.miss || own.bank) && hits.length >= 2 && !(own.bank && hits[0].s >= SURE) && !['data', 'outside', 'chat'].includes(kind);
      if (goes) {
        const entries = hits.map(h => BANK.get(h.id)).filter(Boolean);
        const q = clean(t.q, []);
        const user = `Screen open now: ${tab}\nKind of question: ${kind}\nQuestion: ${q}\n\nCandidates:\n${entries.map(W.candLine).join('\n')}`;
        let p = null;
        try { p = readPick(await groq(user), entries.map(e => e.id)); asked++; } catch (e) { console.log('  groq: ' + e.message); }
        if (p && p.pick) { shown = p.pick; how = 'judge'; }
        else if (p && p.ask.length) { shown = null; how = 'ask'; }   // "which one?": counted as not sure (never wrong)
        s.judged++;
      }
      const after = how === 'ask' ? 'none' : mark(shown);
      s.before[before]++; s.after[after]++;
      if (before !== 'right' && after === 'right') s.fixed++;
      if (before === 'right' && after !== 'right') s.broke++;
      if (SHOW || (before !== after)) lines.push(`${before === after ? '   ' : after === 'right' ? ' + ' : ' - '} [${kind}] ${t.q}\n      want ${t.id} · her ${own.bank || '-'} · after ${how === 'ask' ? 'asks which' : shown || '-'}${goes ? '' : ' (no judge)'}`);
    }
    const pct = (o, k) => Math.round(100 * o[k] / (list.length || 1)) + '%';
    console.log(`\n== ${set} (${list.length})${/held/.test(set) ? ' — HELD BACK: scoring only, never tune on it' : ''}`);
    console.log(`  before: right ${pct(s.before, 'right')}, wrong ${pct(s.before, 'wrong')}, not sure ${pct(s.before, 'none')}`);
    console.log(`  after:  right ${pct(s.after, 'right')}, wrong ${pct(s.after, 'wrong')}, not sure ${pct(s.after, 'none')}`);
    console.log(`  judge asked ${s.judged} times · fixed ${s.fixed} · broke ${s.broke}`);
    lines.forEach(l => console.log(l));
  }
  console.log(`\nmodel ${MODEL} · judgeSure ${SURE} · ${asked} Groq calls · ${tokens} tokens (${asked ? Math.round(tokens / asked) : 0} a question)`);
})().catch(e => { console.error(e); process.exit(1); });
