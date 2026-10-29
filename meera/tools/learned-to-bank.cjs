/* WHAT ADMINS APPROVED → MEERA'S ANSWER FILE (v2 rebuild, Phase 4, 29 Oct 2026) — the weekly build step until Phase 5.
 *
 *   node meera/tools/learned-to-bank.cjs --from export.json        from a saved export (tests, or by hand)
 *   ROUTER_URL=… EXPORT_KEY=… node meera/tools/learned-to-bank.cjs   straight from her router (GET /export, its own key)
 *
 * Into Replenish-App/public/guide/meera-bank.json (the file itself is the source):
 *   approved answers     each becomes (or updates) the entry "learned-<id>" — the same id the browsers already give it
 *                        from GET /learned, so it is never there twice
 *   approved spellings   a new way of asking for the answer it led to (in its language); one with a cleaned-out part
 *                        ("[NAME] ko …") is left out — it would teach her the placeholder
 * Prints what changed; writes nothing when nothing did. The gate (meera/tests/gate.cjs) then checks she is no worse;
 * .github/workflows/meera-learned.yml does all of this each Monday and opens a pull request — merging it is the "live karo". */
const fs = require('fs'), path = require('path');
const BANK = path.join(__dirname, '..', '..', 'Replenish-App', 'public', 'guide', 'meera-bank.json');
/* an admin's words are text: escaped, with **bold** for button names (as guide-ai.js gaMd shows them) */
const md = s => String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const all3 = v => ({ en: v, hi: v, hg: v });

function merge(bank, exp) {
  const byId = new Map(bank.map(e => [e.id, e]));
  const out = { added: [], updated: [], spellings: [], skipped: [] };
  for (const x of exp.answers || []) {
    const a = x.answer || {}, id = 'learned-' + (+x.id);
    if (!+x.id || !String(a.a || '').trim() || !String(x.question || '').trim()) { out.skipped.push(id); continue; }
    const entry = { id, tab: String(x.screen || ''), q: all3([String(x.question)]), a: all3(md(a.a)) };
    if (a.why) entry.why = all3(md(a.why));
    if (Array.isArray(a.steps) && a.steps.length) entry.steps = all3(a.steps.map(md));
    const had = byId.get(id);
    if (!had) { bank.push(entry); byId.set(id, entry); out.added.push(id); }
    else if (JSON.stringify(had) !== JSON.stringify(entry)) { Object.keys(had).forEach(k => delete had[k]); Object.assign(had, entry); out.updated.push(id); }
  }
  for (const s of exp.spellings || []) {
    const q = String(s.question || '').trim(), e = byId.get(String(s.answer || ''));
    if (!q || !e || /\[[A-Z-]+\]/.test(q)) { out.skipped.push('spelling: ' + q); continue; }
    const lang = ['en', 'hi', 'hg'].includes(s.lang) ? s.lang : 'hg';
    e.q = e.q || {};
    const list = e.q[lang] = e.q[lang] || [];
    if (![].concat(e.q.en || [], e.q.hi || [], e.q.hg || []).some(w => w.toLowerCase() === q.toLowerCase())) { list.push(q); out.spellings.push(`${e.id} ← ${q}`); }
  }
  return out;
}
module.exports = { merge };

if (require.main === module) (async () => {
  const i = process.argv.indexOf('--from');
  let exp;
  if (i > 0) exp = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
  else {
    const url = String(process.env.ROUTER_URL || 'https://meera-router.erp-9a0.workers.dev').replace(/\/$/, '') + '/export';
    if (!process.env.EXPORT_KEY) { console.log('No EXPORT_KEY: nothing read.'); process.exit(0); }
    const r = await fetch(url, { headers: { 'x-export-key': process.env.EXPORT_KEY } });
    if (!r.ok) { console.log(`::error::her router said ${r.status} for /export`); process.exit(1); }
    exp = await r.json();
  }
  const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
  const out = merge(bank, exp);
  const changed = out.added.length + out.updated.length + out.spellings.length;
  console.log(`answers added ${out.added.length}, updated ${out.updated.length}; ways of asking added ${out.spellings.length}; left out ${out.skipped.length}`);
  out.added.concat(out.updated).forEach(x => console.log('  answer ' + x));
  out.spellings.forEach(x => console.log('  spelling ' + x));
  if (changed) fs.writeFileSync(BANK, JSON.stringify(bank));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nsummary=${out.added.length} answers, ${out.updated.length} updated, ${out.spellings.length} ways of asking\n`);
})().catch(e => { console.error(e); process.exit(1); });
