/* Phase 6: guide-walks.ts's type notes — marks only, no change in what it does. Run once. */
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '..', 'client', 'src', 'legacy', 'guide-walks.ts');
let s = fs.readFileSync(f, 'utf8');
const rep = (a, b) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(`found ${n}× — ${a.slice(0, 70)}`); s = s.replace(a, () => b); };
rep("    GUIDE_TASKS.push({ id: w.id, k: [], need: ['-'], title: w.title, steps: w.steps, admin: !!w.admin, walk: true });",
    "    (GUIDE_TASKS as any[]).push({ id: w.id, k: [], need: ['-'], title: w.title, steps: w.steps, admin: !!w.admin, walk: true });");
rep("function gaWalkStart(id, mode, q) {", "function gaWalkStart(id, mode, q?) {");
rep("  if (iv && iv.unref) iv.unref();", "  if (iv && (iv as any).unref) (iv as any).unref();");
rep("const gaLater = (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); };", "const gaLater = (fn, ms) => { const t: any = setTimeout(fn, ms); if (t && t.unref) t.unref(); };");
rep("  try { if (navigator.connection && navigator.connection.saveData) return; }", "  try { const c = (navigator as any).connection; if (c && c.saveData) return; }");
fs.writeFileSync(f, s);
console.log('ok');
