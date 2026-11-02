/* Phase 6: guide.ts's type notes — marks only; what she does does not change. Run once. */
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '..', 'client', 'src', 'legacy', 'guide.ts');
let s = fs.readFileSync(f, 'utf8');
const rep = (a, b) => { a = a.replace(/\r?\n/g, '\r\n'); b = b.replace(/\r?\n/g, '\r\n'); const n = s.split(a).length - 1; if (n !== 1) throw new Error(`found ${n}× — ${a.slice(0, 70)}`); s = s.replace(a, () => b); };
/* her walk-round's running state: it gains fields as she works (the box, the step's wait, a pause, the ring…) */
rep("const GUIDE = { tour: null, i: 0, typing: 0, miss: {}, field: null, btn: null, seenErr: new Map(), built: false };",
    "const GUIDE: any = { tour: null, i: 0, typing: 0, miss: {}, field: null, btn: null, seenErr: new Map(), built: false };   // el, live, wait, paused, ring… are added as she works");
rep("  root.querySelectorAll('[data-gd-lang]').forEach(b => b.onclick = () => {", "  root.querySelectorAll<HTMLElement>('[data-gd-lang]').forEach(b => b.onclick = () => {");
rep("    const b = e.target.closest('[data-m]'); if (!b) return;", "    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-m]'); if (!b) return;");
rep("  return [...document.querySelectorAll('.ptmodal, .modal, .pks')].some(el =>", "  return [...document.querySelectorAll<HTMLElement>('.ptmodal, .modal, .pks')].some(el =>");
/* a screen's steps read off the page: some name a box (el), some a selector (sel) */
rep("  const st = [{ en: `This is <b>${esc(title)}</b>.", "  const st: any[] = [{ en: `This is <b>${esc(title)}</b>.");
rep("  document.addEventListener('invalid', e => {\n    const el = e.target;", "  document.addEventListener('invalid', e => {\n    const el = e.target as HTMLInputElement;");
rep("      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;", "      const el = (m.target.nodeType === 1 ? m.target : m.target.parentElement) as HTMLElement | null;");
fs.writeFileSync(f, s);
console.log('ok');
