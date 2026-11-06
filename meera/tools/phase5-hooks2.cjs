/* Phase 5, second round: with "serveruse" her router judges "not about the ERP" (it has all her answers), and the "sure"
 * bar is the one for a search with meanings (the router's is). CRLF kept. Run once. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
function edit(f, pairs, crlf = true) {
  let s = fs.readFileSync(f, 'utf8');
  for (let [a, b] of pairs) {
    if (crlf) { a = a.replace(/\r?\n/g, '\r\n'); b = b.replace(/\r?\n/g, '\r\n'); }
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${path.basename(f)}: found ${n}× — ${a.slice(0, 70)}`);
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(f, s);
}
const ASK = path.join(ROOT, 'meera', 'client', 'src', 'legacy', 'guide-ask.js');
edit(ASK, [
  ["  const bar = (GA_W ? GA_BANK_SURE_SEM : GA_BANK_SURE) - 0.001;", "  const bar = (GA_W || gaRemote() ? GA_BANK_SURE_SEM : GA_BANK_SURE) - 0.001;"],
  ["hits[0] && hits[0].s >= (GA_W ? GA_BANK_SURE_SEM : GA_BANK_SURE)) {", "hits[0] && hits[0].s >= (GA_W || gaRemote() ? GA_BANK_SURE_SEM : GA_BANK_SURE)) {"],
  ["function gaOffTopic(means) {\n",
   "/** Phase 5, switch \"serveruse\": her router searched (with meanings) — its scores are read with the meaning-search bar */\n"
 + "const gaRemote = () => typeof meeraServerHits === 'function' && meeraOn('serveruse');\n"
 + "function gaOffTopic(means) {\n"
 + "  if (typeof meeraServerOffTopic === 'function') { const v = meeraServerOffTopic(); if (v !== null) return v; }   // Phase 5: the router, with all her answers, says\n"],
]);
const SRV = path.join(ROOT, 'meera', 'client', 'src', 'server.ts');
edit(SRV, [
  ["/* ---------- her router's switches ---------- */\n(async () => {\n  if (!(MEERA_SIDE || MEERA_REMOTE)) return;",
   "/* ---------- her router's switches ---------- */\n/* read once her files have all started (the router's address is set further on) */\n"
 + "setTimeout(async () => {\n  if (!(MEERA_SIDE || MEERA_REMOTE)) return;"],
  ["  if (!SRV.cfg.meera) meeraStop('switched off on her router');\n})();", "  if (!SRV.cfg.meera) meeraStop('switched off on her router');\n}, 0);"],
  ["const SRV = { last: null as null | { text: string; hits: { e: any; s: number }[] },", "const SRV = { last: null as null | { text: string; hits: { e: any; s: number }[]; offTopic: boolean },"],
  ["  SRV.last = { text: (r.body.understood && r.body.understood.text) || q, hits: r.body.hits.map((h: any) => ({ e: h.e, s: h.s })) };",
   "  SRV.last = { text: (r.body.understood && r.body.understood.text) || q, hits: r.body.hits.map((h: any) => ({ e: h.e, s: h.s })), offTopic: !!r.body.offTopic };"],
  ["/** instead of her whole answer file:",
   "/** \"not about the ERP\": the router's verdict (it has all her answers); with the router out of reach she never refuses —\n"
 + " * her small list knows too few words to judge (null: the browser judges, as before) */\n"
 + "function meeraServerOffTopic(): boolean | null {\n  if (!MEERA_REMOTE) return null;\n  return SRV.last ? SRV.last.offTopic : false;\n}\n"
 + "/** instead of her whole answer file:"],
], false);
const GEN = path.join(ROOT, 'meera', 'router', 'build-search.cjs');
edit(GEN, [["      try { const r = gaRead(u.text); return { understood: u, lang: r.lang, hits: gaBankFind(r.means, r.words, u.text) }; }",
  "      try { const r = gaRead(u.text); return { understood: u, lang: r.lang, hits: gaBankFind(r.means, r.words, u.text), offTopic: gaOffTopic(r.means) }; }"]], false);
const SJS = path.join(ROOT, 'meera', 'router', 'src', 'search.js');
edit(SJS, [["  return { hits, understood: r.understood, lang: r.lang, ms: Date.now() - t0 };", "  return { hits, understood: r.understood, lang: r.lang, offTopic: !!r.offTopic, ms: Date.now() - t0 };"]], false);
console.log('ok');
