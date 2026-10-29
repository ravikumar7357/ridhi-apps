/* Phase 4: the hooks for learning from staff (switch "learn", meera.js only) put into her current files. CRLF kept.
 * Every hook is `typeof meeraLearn… === 'function'`: inside the page (lazy off) they do not exist, so nothing changes. */
const fs = require('fs'), path = require('path');
const L = path.join(__dirname, '..', 'client', 'src', 'legacy');
function edit(file, pairs) {
  const f = path.join(L, file);
  let s = fs.readFileSync(f, 'utf8');
  for (let [a, b] of pairs) {
    a = a.replace(/\r?\n/g, '\r\n'); b = b.replace(/\r?\n/g, '\r\n');
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${file}: found ${n}× — ${a.slice(0, 70)}`);
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(f, s);
}
edit('guide-ask.js', [
  ["  if (r.miss) gaMissKeep(q, r.miss === true ? 'none' : r.miss);\n",
   "  if (r.miss) gaMissKeep(q, r.miss === true ? 'none' : r.miss);\n"
 + "  if (typeof meeraLearnAnswered === 'function') meeraLearnAnswered(q, r);   // Phase 4, switch \"learn\": a miss or \"not sure\" kept (cleaned)\n"],
  ["    const c = e.target.closest('[data-gq]'); if (c) gaAsk(c.dataset.gq);",
   "    const c = e.target.closest('[data-gq]'); if (c) { if (typeof meeraLearnTap === 'function') meeraLearnTap(c.dataset.gq); gaAsk(c.dataset.gq); }"],
  ["    if (!up) gaMissKeep(GA.lastQ || '', 'not-helpful ' + id.slice(5));\n",
   "    if (!up) gaMissKeep(GA.lastQ || '', 'not-helpful ' + id.slice(5));\n"
 + "    if (!up && typeof meeraLearnDown === 'function') meeraLearnDown(GA.lastQ || '', id.slice(5));   // Phase 4: kept, and \"What were you looking for?\"\n"],
]);
edit('guide.js', [
  ["  go.onclick = e => { e.stopPropagation(); if (menu.classList.contains('hide')) { draw(); menu.classList.remove('hide'); } else shut(); };",
   "  go.onclick = e => { e.stopPropagation(); if (menu.classList.contains('hide')) { draw(); if (typeof meeraLearnMenu === 'function') menu.insertAdjacentHTML('beforeend', meeraLearnMenu()); menu.classList.remove('hide'); } else shut(); };"],
  ["    if (b.dataset.m === 'help') { guideSwitch(!guideIsOn()); draw(); return; }\n",
   "    if (b.dataset.m === 'help') { guideSwitch(!guideIsOn()); draw(); if (typeof meeraLearnMenu === 'function') menu.insertAdjacentHTML('beforeend', meeraLearnMenu()); return; }\n"
 + "    if (b.dataset.m === 'learn') { shut(); if (typeof meeraLearnAdmin === 'function') meeraLearnAdmin(); return; }   // Phase 4: admins only\n"],
]);
console.log('ok');
