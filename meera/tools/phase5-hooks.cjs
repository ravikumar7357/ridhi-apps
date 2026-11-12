/* Phase 5: the hooks for searching on her router (switches "server" and "serveruse", meera.js only), put into her current
 * files. CRLF kept. Every hook is `typeof meeraServer… === 'function'` (and asks its switch): inside the page, or with
 * the switches off, nothing changes. Run once. */
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
edit('guide-walks.js', [
  /* one walk-through taken in — the same as before, now also callable for one walk the router sends (Phase 5) */
  ["    .then(list => {\n      (Array.isArray(list) ? list : []).forEach(w => {\n        if (!w || !w.id) return;\n",
   "    .then(list => {\n      (Array.isArray(list) ? list : []).forEach(gaWalkAdd);\n      return GA_WALK_OF;\n    });\n  return GA_WALKS_P;\n}\n"
 + "/** One walk-through taken in (from meera-walks.json; or, searching on her router, one the router sends with an answer). */\n"
 + "function gaWalkAdd(w) {\n        if (!w || !w.id) return;\n"],
  ["        if (go && /^#[\\w-]+$/.test(go.sel) && !GA_WALK_SEL.has(go.sel)) GA_WALK_SEL.set(go.sel, id);\n      });\n      return GA_WALK_OF;\n    });\n  return GA_WALKS_P;\n}\n",
   "        if (go && /^#[\\w-]+$/.test(go.sel) && !GA_WALK_SEL.has(go.sel)) GA_WALK_SEL.set(go.sel, id);\n}\n"],
]);
edit('guide-ask.js', [
  ["  if (GA_BANK) return Promise.resolve(GA_BANK);\n  if (!GA_BANK_P) GA_BANK_P = fetch('/guide/meera-bank.json'",
   "  if (GA_BANK) return Promise.resolve(GA_BANK);\n"
 + "  if (!GA_BANK_P && typeof meeraServerBank === 'function') { const p = meeraServerBank(); if (p) GA_BANK_P = p; }   // Phase 5: her router searches; the small list for this screen only\n"
 + "  if (!GA_BANK_P) GA_BANK_P = fetch('/guide/meera-bank.json'"],
  ["function gaWordsLoad() {\n  if (GA_W !== null) return Promise.resolve(GA_W);\n",
   "function gaWordsLoad() {\n  if (GA_W !== null) return Promise.resolve(GA_W);\n"
 + "  if (typeof meeraServerWords === 'function') { const p = meeraServerWords(); if (p) return p; }   // Phase 5: her router has the meaning table\n"],
  ["async function gaAnswer(q) {\n  let understood = null;\n  if (typeof muUnderstand === 'function' && meeraOn('spell') && !gaAnswer.asTyped) {",
   "async function gaAnswer(q) {\n  let understood = null, served = null;\n"
 + "  /* Phase 5, switch \"serveruse\": her router searches (and understands the spelling); without it, her small list here */\n"
 + "  if (typeof meeraServerFetch === 'function' && meeraOn('serveruse')) {\n"
 + "    served = await meeraServerFetch(q, !!gaAnswer.asTyped);\n"
 + "    if (served && served.understood.changes.length && !gaAnswer.asTyped) { understood = served.understood; q = served.understood.text; }\n"
 + "  }\n"
 + "  if (!served && typeof muUnderstand === 'function' && meeraOn('spell') && !gaAnswer.asTyped) {"],
  ["  if (understood && r) r.understood = understood;\n  return r;\n}\n",
   "  if (understood && r) r.understood = understood;\n  if (r && !served && meeraOn('serveruse')) r.offline = true;   // answered from her small list here\n  return r;\n}\n"],
  ["function gaBankFind(means, words, q) {\n  const B = GA_BANK;\n",
   "function gaBankFind(means, words, q) {\n  if (typeof meeraServerHits === 'function') { const h = meeraServerHits(q); if (h) return h; }   // Phase 5: her router's answer to this question\n  const B = GA_BANK;\n"],
  ["  if (typeof meeraLearnAnswered === 'function') meeraLearnAnswered(q, r);",
   "  if (typeof meeraLearnAnswered === 'function') meeraLearnAnswered(q, r);\n  if (typeof meeraServerAfter === 'function') meeraServerAfter(q);   // Phase 5, switch \"server\": her router's search, side by side"],
  ["  gaSay(und + r.html, r.acts || [], (r.after || '') + fb, r.bank ? 'guide' : '');\n",
   "  /* Phase 5: her router could not be reached — said, and answered from her small list for this screen */\n"
 + "  const off = r.offline ? `<div class=\"ga-und\">${LL('From my short list for this screen — my full search can\\'t be reached right now.', 'इस स्क्रीन की मेरी छोटी लिस्ट से — मेरी पूरी खोज अभी नहीं मिल रही।', 'Is screen ki meri chhoti list se — meri poori khoj abhi nahi mil rahi.')}</div>` : '';\n"
 + "  gaSay(off + und + r.html, r.acts || [], (r.after || '') + fb, r.bank ? 'guide' : '');\n"],
]);
console.log('ok');
