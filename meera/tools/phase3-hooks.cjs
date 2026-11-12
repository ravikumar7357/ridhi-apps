/* Phase 3: the hooks for her new look (switch "design", meera.js only) put into her current files. CRLF kept.
 * Every hook is `typeof meeraDesign… === 'function'` — inside the page (lazy off) they do not exist, so nothing changes;
 * in meera.js with "design" off they return at once. Run once. */
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
const LAYER = "(typeof meeraLayer === 'function' ? meeraLayer() : document.body)";

edit('guide.js', [
  /* where her pieces go, and what a click really landed on */
  ["/** The pieces on the page: the dim, the lit box, the arrow, Meera and her bubble, and the top-bar switch. */\n",
   "/* Where her pieces go: the page — or, with her new look (Phase 3, switch \"design\"), her own sealed box (meera/client/src/design.ts).\n"
 + " * And what a click or key really landed on: inside her sealed box the page sees only the box itself, so the page-wide\n"
 + " * listeners below ask for the first thing on the event's path (on the page as it is today, that is e.target). */\n"
 + "const gdTarget = e => (e.composedPath && e.composedPath()[0]) || e.target;\n"
 + "/** The pieces on the page: the dim, the lit box, the arrow, Meera and her bubble, and the top-bar switch. */\n"],
  ["  document.body.appendChild(root);\n", `  ${LAYER}.appendChild(root);\n`],
  ["ring.className = 'hide'; document.body.appendChild(ring);", `ring.className = 'hide'; ${LAYER}.appendChild(ring);`],
  ["pill.innerHTML = GUIDE_FACE + '<span></span>'; document.body.appendChild(pill);", `pill.innerHTML = GUIDE_FACE + '<span></span>'; ${LAYER}.appendChild(pill);`],
  ["  document.body.appendChild(go);\n", `  ${LAYER}.appendChild(go);\n`],
  ["  document.body.appendChild(menu);\n", `  ${LAYER}.appendChild(menu);\n`],
  ["if (e.key === '?' && !GUIDE.tour && !(e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')))",
   "if (e.key === '?' && !GUIDE.tour && !(gdTarget(e).closest && gdTarget(e).closest('input, textarea, select, [contenteditable]')))"],
  ["!e.target.closest('#gdMenu, #gdLaunch')) shut(); });", "!(gdTarget(e).closest && gdTarget(e).closest('#gdMenu, #gdLaunch'))) shut(); });"],
  ["    const t = e.target;\n    if (t.closest && t.closest('#gdBubble,", "    const t = gdTarget(e);\n    if (t.closest && t.closest('#gdBubble,"],
  ["!ours(e.target) && !inBox(e.target)) { e.preventDefault(); e.stopPropagation(); } };", "!ours(gdTarget(e)) && !inBox(gdTarget(e))) { e.preventDefault(); e.stopPropagation(); } };"],
  ["  document.addEventListener('focusin', e => {\n    const el = e.target;", "  document.addEventListener('focusin', e => {\n    const el = gdTarget(e);"],
  ["const acted = e => { if (e.isTrusted && !ours(e.target)) GUIDE.act = Date.now(); };", "const acted = e => { if (e.isTrusted && !ours(gdTarget(e))) GUIDE.act = Date.now(); };"],
  ["    if (GUIDE.tour && !GUIDE.selfClick && !ours(e.target) && !inBox(e.target)) { e.preventDefault(); e.stopPropagation(); return; }",
   "    if (GUIDE.tour && !GUIDE.selfClick && !ours(gdTarget(e)) && !inBox(gdTarget(e))) { e.preventDefault(); e.stopPropagation(); return; }"],
  ["    const b = e.target.closest && e.target.closest('button, [role=button], input[type=button], input[type=submit]');",
   "    const b = gdTarget(e).closest && gdTarget(e).closest('button, [role=button], input[type=button], input[type=submit]');"],
  /* a first-visit walk-round is the only place for her full figure */
  ["  GUIDE.tour = { tab, steps, kind: 'tour' };\n", "  GUIDE.tour = { tab, steps, kind: 'tour', first: !asked };   // first: opened by itself on a first visit\n"],
  ["function guideShow() {\n  const t = GUIDE.tour; if (!t) return;\n", "function guideShow() {\n  const t = GUIDE.tour; if (!t) return;\n  if (typeof meeraDesignShow === 'function') meeraDesignShow(t);\n"],
  ["  bub.classList.toggle('gd-up', !!(r && hidBelow > 0 && hidAbove < hidBelow));\n}\n",
   "  bub.classList.toggle('gd-up', !!(r && hidBelow > 0 && hidAbove < hidBelow));\n  if (typeof meeraDesignPlace === 'function') meeraDesignPlace(el, r, bub);\n}\n"],
]);

edit('guide-ask.js', [
  ["  const lang = /[ऀ-ॿ]/.test(q) ? 'hi' : words.some(w => GUIDE_HG.has(w)) ? 'hg' : 'en';\n",
   "  let lang = /[ऀ-ॿ]/.test(q) ? 'hi' : words.some(w => GUIDE_HG.has(w)) ? 'hg' : 'en';\n"
 + "  if (typeof meeraDesignLang === 'function' && meeraDesignLang() === 'hi') lang = 'hi';   // her new look: हिंदी chosen in the Ask box\n"],
  ["  document.body.appendChild(box);\n  $('gaClose').onclick = guideAskClose;", `  ${LAYER}.appendChild(box);\n  $('gaClose').onclick = guideAskClose;`],
  ["  if (q) gaAsk(q);\n  setTimeout(() => { try { $('gaQ').focus(); }", "  if (typeof meeraDesignAskOpen === 'function') meeraDesignAskOpen();\n  if (q) gaAsk(q);\n  setTimeout(() => { try { $('gaQ').focus(); }"],
  ["  $('gaChips').innerHTML = chips.slice(0, 5).map(c => `<button type=\"button\" class=\"ga-chip\" data-gq=\"${esc(c)}\">${esc(c)}</button>`).join('');\n}\n",
   "  $('gaChips').innerHTML = chips.slice(0, 5).map(c => `<button type=\"button\" class=\"ga-chip\" data-gq=\"${esc(c)}\">${esc(c)}</button>`).join('');\n  if (typeof meeraDesignChips === 'function') meeraDesignChips();\n}\n"],
  ["function gaSay(html, acts, after) {\n", "/** One message from her. src: where the answer came from — 'guide' (her answers), 'ai', 'checked' (an AI answer an admin checked). */\nfunction gaSay(html, acts, after, src) {\n"],
  ["  $('gaLog').appendChild(d);\n  $('gaLog').scrollTop = $('gaLog').scrollHeight;\n}\nasync function gaAsk(q) {",
   "  $('gaLog').appendChild(d);\n  if (typeof meeraDesignSay === 'function') meeraDesignSay(d, src || '');\n  $('gaLog').scrollTop = $('gaLog').scrollHeight;\n}\nasync function gaAsk(q) {"],
  ["  gaSay(und + r.html, r.acts || [], (r.after || '') + fb);\n", "  gaSay(und + r.html, r.acts || [], (r.after || '') + fb, r.bank ? 'guide' : '');\n"],
]);

edit('guide-ai.js', [["    gaSay(html, [], fb);\n", "    gaSay(html, [], fb, b.source === 'saved' ? 'checked' : 'ai');\n"]]);
edit('guide-walks.js', [["n.setAttribute('role', 'status'); document.body.appendChild(n); }", `n.setAttribute('role', 'status'); ${LAYER}.appendChild(n); }`]]);
console.log('ok');
