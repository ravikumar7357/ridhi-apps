/* Phase 6: guide-ask.ts's type notes (and those it shows in guide-ai.ts and learn.ts) — type marks only; what she does
 * does not change. Run once. */
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'client', 'src');
function edit(rel, pairs) {
  const f = path.join(SRC, rel);
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b, all] of pairs) {
    const n = s.split(a).length - 1;
    if (all ? n < 1 : n !== 1) throw new Error(`${rel}: found ${n}× — ${a.slice(0, 70)}`);
    s = all ? s.split(a).join(b) : s.replace(a, () => b);
  }
  fs.writeFileSync(f, s);
}
edit('legacy/guide-ask.ts', [
  /* her running state: it gains fields as she works (the last question, the boxes a fix points at, tickets) */
  ["let GA = { built: false, greeted: false };", "let GA: any = { built: false, greeted: false };   // her running state: lastQ, fix, tickets… are added as she works"],
  ["function gaSay(html, acts, after, src) {", "function gaSay(html, acts?, after?, src?) {"],
  ["function gaTabsSaid(q) { const t = String(q || '').toLowerCase(); return new Set(GA_TAB_SAY.filter(([, re]) => re.test(t)).map(([tab]) => tab)); }",
   "function gaTabsSaid(q) { const t = String(q || '').toLowerCase(); return new Set(GA_TAB_SAY.filter(([, re]) => (re as RegExp).test(t)).map(([tab]) => tab as string)); }"],
  ["    const a = e.target.closest('[data-ga]');", "    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-ga]');"],
  ["    const c = e.target.closest('[data-gq]');", "    const c = (e.target as HTMLElement).closest<HTMLElement>('[data-gq]');"],
  /* "search what I typed": a mark on her answer function, read once */
  ["gaAnswer.asTyped", "(gaAnswer as any).asTyped", true],
  /* her word list: sets of words */
  ["  const known = new Set(), pairs = new Set(), names = new Set(), freq = new Map()", "  const known = new Set<string>(), pairs = new Set<string>(), names = new Set<string>(), freq = new Map<string, number>()"],
]);
edit('legacy/guide-ai.ts', [["async function gaAiAsk(q, own) {", "async function gaAiAsk(q, own?) {"]]);
/* gaDict is real now (guide-ask.ts): only the strict check of her new files needs its outline */
edit('learn.ts', [["declare function gaDict(): { known: Set<string>; freq: Map<string, number>; names: Set<string> };\n", ""]]);
edit('legacy-globals.d.ts', [["declare const guideLang: () => string;\n", "declare const guideLang: () => string;\ndeclare function gaDict(): { known: Set<string>; freq: Map<string, number>; names: Set<string>; pairs: Set<string> };\n"]]);
/* names that belong to the ERP page itself (her code asks for them with typeof first) */
fs.writeFileSync(path.join(SRC, 'legacy', 'erp-page.d.ts'), `/* NAMES OF THE ERP PAGE ITSELF that her older code looks for — always with typeof first, so a page without them is fine
 * (v2 rebuild, Phase 6: for the type check of all her files, tsconfig.legacy.json). */
declare const FR: { shown?: boolean } | undefined;
declare function frHomeShow(): void;
`);
console.log('ok');
