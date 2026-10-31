/* Phase 2: puts the spelling hook into guide-ask.js (CRLF kept). Run once. */
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '..', 'client', 'src', 'legacy', 'guide-ask.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('function gaSpell(')) { console.log('already there'); process.exit(0); }
const NL = '\r\n';
const once = (from, to) => { if (s.split(from).length !== 2) throw new Error('not found once: ' + from.slice(0, 60)); s = s.replace(from, to); };

/* 1. the hook, right after gaPeople */
const hook = [
  '/* SPELLING (v2 rebuild, Phase 2, 29 Oct 2026). With the "spell" switch on, a question is first read the way she',
  ' * understands it — "karigr ko kaam kaise de" as "karigar ko kaam kaise de" (meera/client/src/understand.ts, which is',
  ' * only inside meera.js). Switch off, or Meera inside the page: the question is read exactly as typed. Her word list:',
  ' * every word of her answers and their ways of asking, her own word list, filler words and the karigars\' names. */',
  'let GA_DICT = null;',
  'function gaDict() {',
  '  const known = new Set(), freq = new Map(), add = (w, n) => { known.add(w); if (n) freq.set(w, (freq.get(w) || 0) + n); };',
  '  (GA_BANK ? GA_BANK.list : []).forEach(e => {',
  '    const q = e.q || {};',
  '    [].concat(q.en || [], q.hg || [], q.hi || []).forEach(t => gaWords(t).forEach(w => add(w, 2)));',
  '    gaWords(gaPlain((e.a || {}).en) + \' \' + gaPlain((e.a || {}).hg)).forEach(w => add(w, 1));',
  '    if (e.p) gaWords(e.p[0]).forEach(w => add(w, 2));',
  '  });',
  '  Object.keys(GUIDE_SYN).forEach(w => add(w, 1));',
  '  GUIDE_STOP.forEach(w => add(w, 0));',
  '  gaPeople().forEach(w => add(w, 0));',
  '  return { known, freq };',
  '}',
  'function gaSpell(q) {',
  '  const none = { text: q, changes: [] };',
  '  if (typeof muUnderstand !== \'function\' || !meeraOn(\'spell\') || !GA_BANK) return none;',
  '  try { if (!GA_DICT) GA_DICT = muIndex(gaDict()); return muUnderstand(q, GA_DICT); } catch (e) { return none; }',
  '}',
].join(NL) + NL;
once('/** How well an entry fits: its key meanings found in the question,', hook + '/** How well an entry fits: its key meanings found in the question,');

/* 2. gaAnswer reads the question as understood, and says what it changed */
once('async function gaAnswer(q) {' + NL + '  const { lang, means, words } = gaRead(q);',
  'async function gaAnswer(q) {' + NL
  + '  let understood = null;' + NL
  + '  if (typeof muUnderstand === \'function\' && meeraOn(\'spell\')) { await gaBankLoad(); const u = gaSpell(q); if (u.changes.length) { understood = u; q = u.text; } }' + NL
  + '  const r = await gaAnswer1(q);' + NL
  + '  if (understood && r) r.understood = understood;' + NL
  + '  return r;' + NL
  + '}' + NL
  + 'async function gaAnswer1(q) {' + NL + '  const { lang, means, words } = gaRead(q);');

/* the bank (and the gaDict cache) is rebuilt when the bank reloads */
once('    .then(list => (GA_BANK = gaBankIndex(Array.isArray(list) ? list : [])))',
  '    .then(list => { GA_DICT = null; return (GA_BANK = gaBankIndex(Array.isArray(list) ? list : [])); })');
fs.writeFileSync(f, s);
console.log('ok');
