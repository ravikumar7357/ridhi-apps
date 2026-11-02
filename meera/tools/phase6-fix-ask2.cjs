/* Phase 6: the last four type notes of guide-ask.ts / guide-walks.ts — marks only. Run once. */
const fs = require('fs'), path = require('path');
const L = path.join(__dirname, '..', 'client', 'src', 'legacy');
function edit(rel, pairs) {
  const f = path.join(L, rel);
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of pairs) { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`${rel}: found ${n}× — ${a.slice(0, 70)}`); s = s.replace(a, () => b); }
  fs.writeFileSync(f, s);
}
edit('guide-ask.ts', [
  ["function guideAskOpen(q) {", "function guideAskOpen(q?) {"],
  ["  gaPeople().forEach(w => { add(w, 0); names.add(w); });", "  gaPeople().forEach((w: string) => { add(w, 0); names.add(w); });"],
  /* a job guide: the eight written here, and the walk-throughs taken in (guide-walks.ts) — which may be for admins only */
  ["const GUIDE_TASKS = [", "const GUIDE_TASKS: any[] = ["],
]);
console.log('ok');
