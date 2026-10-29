/* TWO MORE SPELLING TEST SETS (Phase 2 check, 29 Oct 2026 — Ravi: "a second spelling test set that you did NOT use while
 * tuning … Use it only for scoring from now on", and Hindi-script mistakes reported separately).
 *
 *   node meera/tests/typo-sets.cjs --make   writes them ONCE into meera/bank/evals/ (then they are frozen: never re-made,
 *                                           never looked at while changing her spelling — scoring only)
 *
 *   typos-held.json   Latin-letter questions (all three test sets, the button/column ones too) with mistakes made a
 *                     different way from the first set (which drops, swaps, doubles a letter or changes a vowel, never
 *                     the first letter): a key next to the right one on the keyboard (the first letter too), Hinglish
 *                     vowels left out ("krna"), sounds spelt another way (q/k, v/w, z/s, ph/f, ee/oo, aa), the last
 *                     letter missing, two words run together, one long word split.
 *   typos-hi.json     Hindi-script questions with the mistakes phones make: short/long matra (ि/ी, ु/ू, े/ै, ो/ौ),
 *                     the dot (nukta) left out or added, ं/ँ, a matra or halant left out. */
const fs = require('fs'), path = require('path');
const EVALS = path.join(__dirname, '..', 'bank', 'evals');
const readEval = n => JSON.parse(fs.readFileSync(path.join(EVALS, n + '.json'), 'utf8'));
function rng(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }   // xorshift, not set 1's

const KEYS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function near(c, r) {
  for (let y = 0; y < 3; y++) {
    const x = KEYS[y].indexOf(c);
    if (x < 0) continue;
    const opts = [KEYS[y][x - 1], KEYS[y][x + 1], (KEYS[y - 1] || '')[x], (KEYS[y + 1] || '')[x]].filter(Boolean);
    return opts[Math.floor(r() * opts.length)];
  }
  return c;
}
const SOUND = [[/k/, 'q'], [/c(?!h)/, 'k'], [/w/, 'v'], [/v/, 'w'], [/s/, 'z'], [/f/, 'ph'], [/i/, 'ee'], [/u/, 'oo'], [/a/, 'aa'], [/ee/, 'i'], [/oo/, 'u']];
function latinSlip(words, i, r) {
  const w = words[i];
  const how = Math.floor(r() * 7);
  if (how === 0) { const p = Math.floor(r() * w.length); return w.slice(0, p) + near(w[p], r) + w.slice(p + 1); }                       // keyboard
  if (how === 1) { const v = [...w.slice(1, -1).matchAll(/[aeiou]/g)].map(m => m.index + 1); if (!v.length) return null; const p = v[Math.floor(r() * v.length)]; return w.slice(0, p) + w.slice(p + 1); }   // vowel left out
  if (how === 2) { const s = SOUND.filter(([re]) => re.test(w)); if (!s.length) return null; const [re, to] = s[Math.floor(r() * s.length)]; return w.replace(re, to); }   // sound
  if (how === 3) return w.length >= 5 ? w.slice(0, -1) : null;                                                                          // last letter missing
  if (how === 4) { if (i + 2 >= words.length || !/^[a-z]+$/i.test(words[i + 2])) return null; words[i + 1] = ''; return w; }           // run together
  if (how === 5) { if (w.length < 7) return null; const p = 3 + Math.floor(r() * (w.length - 5)); return w.slice(0, p) + ' ' + w.slice(p); }   // split
  return w.length >= 5 ? w.slice(0, 1) + near(w[1], r) + w.slice(2) : null;                                                              // keyboard, 2nd letter
}
const DEV = [[/ि/, 'ी'], [/ी/, 'ि'], [/ु/, 'ू'], [/ू/, 'ु'], [/े/, 'ै'], [/ै/, 'े'], [/ो/, 'ौ'], [/ं/, 'ँ'], [/ँ/, 'ं'], [/़/, ''], [/([जफडढकखग])(?!़)/, '$1़'], [/[ािीुूेैो]/, ''], [/्/, '']];
function hindiSlip(w, r) {
  const s = DEV.filter(([re]) => re.test(w));
  if (!s.length) return null;
  const [re, to] = s[Math.floor(r() * s.length)];
  return w.replace(re, to);
}
function make(list, r, isWord, slip) {
  const out = [];
  for (const x of list) {
    const words = x.q.split(/(\s+)/);
    const idx = words.map((w, i) => (isWord(w) ? i : -1)).filter(i => i >= 0);
    if (!idx.length) continue;
    const n = Math.min(idx.length, r() < 0.55 ? 1 : 2);
    for (let k = 0; k < n; k++) {
      const i = idx[Math.floor(r() * idx.length)];
      for (let tries = 0; tries < 6; tries++) { const t = slip(words, i, r); if (t && t !== words[i]) { words[i] = t; break; } }
    }
    const q = words.join('');
    if (q !== x.q) out.push({ q, from: x.q, id: x.id, tab: x.tab });
  }
  return out;
}
function makeAll() {
  const all = ['eval', 'eval2', 'eval-parts'].flatMap(n => readEval(n).filter(x => x.id));
  const held = make(all.filter(x => /[a-z]{4,}/i.test(x.q)), rng(31102026), w => /^[a-z]{4,}$/i.test(w), latinSlip);
  const hi = make(all.filter(x => /[ऀ-ॿ]/.test(x.q)), rng(5112026), w => /[ऀ-ॿ]{2,}/.test(w) && /^[ऀ-ॿ]+$/.test(w), (words, i, r) => hindiSlip(words[i], r));
  return { held, hindi: hi };
}
const FILES = { held: 'typos-held.json', hindi: 'typos-hi.json' };
/** the frozen sets, or none if not made yet */
function load() {
  const out = {};
  for (const [k, f] of Object.entries(FILES)) { const p = path.join(EVALS, f); if (fs.existsSync(p)) out[k] = JSON.parse(fs.readFileSync(p, 'utf8')); }
  return out;
}
module.exports = { load };

if (require.main === module && process.argv.includes('--make')) {
  const sets = makeAll();
  for (const [k, f] of Object.entries(FILES)) {
    const p = path.join(EVALS, f);
    if (fs.existsSync(p) && !process.argv.includes('--again')) { console.log(f, 'exists — frozen, not made again'); continue; }
    fs.writeFileSync(p, JSON.stringify(sets[k], null, 1) + '\n');
    console.log(f, sets[k].length, 'questions');
  }
}
