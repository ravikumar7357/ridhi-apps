/* MEERA LEARNS HINGLISH FROM HER OWN ANSWERS (Ravi, 11 Nov: "I want meera to find out the linking of hinglish words and its
 * meaning and formation so that we can use that to understand hinglish too").
 *   node meera/tools/hinglish-learn.cjs [--show]      writes Replenish-App/public/guide/meera-links.json
 *
 * Every answer of hers is written three times — English, Hindi and Hinglish — sentence for sentence: the answer line, the
 * why, each step, each part's line, and what it is for / how it works / when to use it. About 20,000 sentences, three ways.
 * From those she works out, by herself:
 *   1. WORD LINKS — which Hinglish word goes with which English word ("dikhao" ↔ show, "jinki" ↔ which, "chadhao" ↔ enter).
 *      Counted the way translators' tools do it (word alignment): every word of a Hinglish sentence is first given an equal
 *      share of the English sentence's words; then, round after round, a word gets more of the English words it keeps
 *      appearing with and less of the rest, until each settles on its own.
 *   2. HINDI LETTERS — the same for each Hindi-script word ("दिखाओ" ↔ show).
 *   3. FORMATION — the families: a root and its endings ("kar": karo, karna, karein, kariye, karke, karta…; "dikh": dikha,
 *      dikhao, dikhta…). A word she never saw, with a known root and a known ending, is read through its family.
 *   4. SPELLINGS — the same sound written differently ("kaha", "kahan", "kahaan"), through her sound-alike rule.
 * A link is kept only when it is seen often enough and clearly enough; an English word written in a Hinglish sentence
 * ("Email", "Save") is already English and needs no link. The file is read by her search when the switch "hglinks" is on. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const BANK = path.join(ROOT, 'Replenish-App', 'public', 'guide', 'meera-bank.json');
const OUT = path.join(ROOT, 'Replenish-App', 'public', 'guide', 'meera-links.json');
const SHOW = process.argv.includes('--show');

/* ---------- the sentences, three ways ---------- */
const plain = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
const enWords = s => plain(s).toLowerCase().match(/[a-z][a-z0-9']*/g) || [];
const hiWords = s => plain(s).toLowerCase().match(/[ऀ-ॿ]+|[a-z][a-z0-9']*/g) || [];
const pairs = { hg: [], hi: [] }, asks = { hg: [], hi: [] };
const add = (en, hg, hi) => {
  if (!en) return;
  const e = enWords(en);
  if (hg) pairs.hg.push([enWords(hg), e]);
  if (hi) pairs.hi.push([hiWords(hi), e]);
};
const three = (o, f) => { if (o && typeof o === 'object' && !Array.isArray(o)) f(o.en, o.hg, o.hi); };
const each = (o, f) => { if (o && o.en && Array.isArray(o.en)) o.en.forEach((en, i) => f(en, (o.hg || [])[i], (o.hi || [])[i])); };
const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
for (const e of bank) {
  if (e.p) add(e.p[2], e.p[4], e.p[3]);
  three(e.a, add); three(e.why, add); each(e.steps, add);
  if (e.more) { three(e.more.for, add); three(e.more.when, add); each(e.more.how, add); }
  /* her ways of asking: the same question, though not line for line — each Hinglish (or Hindi) way set against all the
   * English ways together. This is where the asking words live ("kahan", "kitne", "jinki", "dikhao") */
  if (e.q && e.q.en && e.q.en.length) {
    const en = e.q.en.join(' . ');
    (e.q.hg || []).forEach(q => asks.hg.push([enWords(q), enWords(en)]));
    (e.q.hi || []).forEach(q => asks.hi.push([hiWords(q), enWords(en)]));
  }
}

/* ---------- 1 and 2: word links, by alignment ---------- */
/* English words that carry no meaning of their own: never a link's answer */
const EN_STOP = new Set(('a an the is are was were be been to of in on at for by it its this that these those my me i we our your you and or but so if ' +
  'as with from do does did done can will would should could has have had there here them they their he she his her him into onto also just than then').split(' '));
/* every word her English sentences use, and how often: such a word is shared, never relinked */
const EN_SEEN = new Map();
for (const [, e] of pairs.hg) for (const w of new Set(e)) EN_SEEN.set(w, (EN_SEEN.get(w) || 0) + 1);
function align(list, rounds) {
  /* t[f][e]: how much of English word e each Hinglish (or Hindi) word f takes; the empty word NULL takes the leftovers */
  const t = new Map();
  for (const [src, tgt] of list) for (const f of src.concat('\u0000')) {
    let m = t.get(f); if (!m) t.set(f, m = new Map());
    for (const e of tgt) m.set(e, 1);
  }
  for (const m of t.values()) { const n = m.size; for (const e of m.keys()) m.set(e, 1 / n); }
  for (let r = 0; r < rounds; r++) {
    const cnt = new Map(), tot = new Map();
    for (const [src, tgt] of list) {
      const fs2 = src.concat('\u0000');
      for (const e of tgt) {
        let den = 0; for (const f of fs2) den += t.get(f).get(e) || 0;
        if (!den) continue;
        for (const f of fs2) { const c = (t.get(f).get(e) || 0) / den; if (!c) continue;
          let m = cnt.get(f); if (!m) cnt.set(f, m = new Map()); m.set(e, (m.get(e) || 0) + c); tot.set(f, (tot.get(f) || 0) + c); }
      }
    }
    for (const [f, m] of cnt) { const T = tot.get(f), tm = t.get(f); for (const e of tm.keys()) tm.set(e, (m.get(e) || 0) / T); }
  }
  return t;
}
/* how often each word is seen, and with which English words it shares a sentence */
const seen = list => { const n = new Map(); for (const [src] of list) for (const f of new Set(src)) n.set(f, (n.get(f) || 0) + 1); return n; };
function links(list, minSeen, minShare) {
  const t = align(list, 8), n = seen(list), out = {};
  for (const [f, m] of t) {
    if (f === '\u0000' || (n.get(f) || 0) < minSeen || /^\d/.test(f)) continue;
    const best = [...m].filter(([e]) => !EN_STOP.has(e) && e.length > 1).sort((a, b) => b[1] - a[1]);
    if (!best.length) continue;
    const [e, p] = best[0];
    if (e === f || p < minShare || (EN_SEEN.get(f) || 0) >= 3) continue;   // an English word (or one her English uses too, like 'karigar') stays as it is; or no clear meaning
    out[f] = [e, Math.round(p * 100) / 100, n.get(f)];
  }
  return out;
}
/* the answers' sentences first, strictly; the ways of asking fill in the words the sentences leave out, more loosely */
const fill = (a, b) => { for (const [w, v] of Object.entries(b)) if (!a[w]) a[w] = v; return a; };
const HG = fill(links(pairs.hg, 3, 0.25), links(asks.hg, 3, 0.15)), HI = fill(links(pairs.hi, 3, 0.25), links(asks.hi, 3, 0.15));

/* ---------- 3: formation — a root and its endings ---------- */
/* the endings Hinglish verbs and nouns take, longest first; a root keeps at least three letters */
const ENDINGS = ['iyega', 'iyegi', 'iyenge', 'iyega', 'enge', 'egi', 'ega', 'unga', 'ungi', 'iye', 'iyo', 'ein', 'aen', 'ana', 'ane', 'ani', 'ate', 'ati', 'ata',
  'aya', 'aye', 'ayi', 'ao', 'ai', 'na', 'ne', 'ni', 'ke', 'kr', 'ta', 'ti', 'te', 'ya', 'ye', 'yi', 'o', 'e', 'i', 'a', 'u'].filter((x, i, a) => a.indexOf(x) === i)
  .sort((a, b) => b.length - a.length);
/* a root keeps at least four letters ("saare" is not "saar" + e, "kitne" is not "kit" + ne) */
const rootOf = w => { for (const x of ENDINGS) if (w.length - x.length >= 4 && w.endsWith(x)) return w.slice(0, -x.length); return w.length >= 4 ? w : ''; };
const fam = new Map();                                 // root → { english word → how often its forms are seen }
for (const [w, [e, , c]] of Object.entries(HG)) {
  const r = rootOf(w); if (!r || r === w && w.length < 4) continue;
  let m = fam.get(r); if (!m) fam.set(r, m = new Map()); m.set(e, (m.get(e) || 0) + c);
}
const ROOTS = {};
for (const [r, m] of fam) {
  const all = [...m.values()].reduce((a, b) => a + b, 0), [e, c] = [...m].sort((a, b) => b[1] - a[1])[0];
  if (c / all >= 0.6 && all >= 4 && m.size >= 1 && [...Object.keys(HG)].filter(w => rootOf(w) === r).length >= 3) ROOTS[r] = e;   // three forms or more, agreeing on one meaning
}

/* ---------- 4: spellings — one sound, several ways of writing it ---------- */
const sound = w => w.toLowerCase().replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/q/g, 'k')
  .replace(/c(?!h)/g, 'k').replace(/w/g, 'v').replace(/z/g, 'j').replace(/(?<=[aeiou])h(?![aeiou])/g, '').replace(/n$/, '').replace(/(.)\1+/g, '$1');
const SOUND = {};
const bySound = new Map();
for (const [w, [e, , c]] of Object.entries(HG)) { const k = sound(w); let m = bySound.get(k); if (!m) bySound.set(k, m = new Map()); m.set(e, (m.get(e) || 0) + c); }
for (const [k, m] of bySound) { const all = [...m.values()].reduce((a, b) => a + b, 0), [e, c] = [...m].sort((a, b) => b[1] - a[1])[0]; if (c / all >= 0.6) SOUND[k] = e; }

const out = { made: new Date().toISOString().slice(0, 10), from: { hinglish: pairs.hg.length, hindi: pairs.hi.length },
  endings: ENDINGS, hg: Object.fromEntries(Object.entries(HG).map(([w, [e]]) => [w, e])), hi: Object.fromEntries(Object.entries(HI).map(([w, [e]]) => [w, e])),
  roots: ROOTS, sounds: SOUND };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`learnt from ${pairs.hg.length} Hinglish and ${pairs.hi.length} Hindi sentences, ${asks.hg.length} + ${asks.hi.length} ways of asking: ${Object.keys(out.hg).length} Hinglish words, ${Object.keys(out.hi).length} Hindi words, `
  + `${Object.keys(ROOTS).length} word families, ${Object.keys(SOUND).length} spellings → ${path.relative(ROOT, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
if (SHOW) {
  for (const w of ['dikhao', 'dikhaiye', 'jinki', 'saare', 'karni', 'chadhao', 'chadhaiye', 'kholiye', 'dabaiye', 'likhiye', 'bhejo', 'nikalo', 'banao', 'kitne', 'kahan', 'chahiye',
    'baaki', 'naya', 'purana', 'galat', 'wapas', 'aaya', 'diya', 'hatao', 'chuniye', 'dekhiye', 'kapda', 'maal', 'tarikh'])
    console.log(w.padEnd(10), '→', (HG[w] || ['—'])[0], HG[w] ? `(${HG[w][1]}, seen ${HG[w][2]})` : '', '| root', rootOf(w), '→', ROOTS[rootOf(w)] || '—');
  for (const w of ['दिखाओ', 'दबाएँ', 'खोलें', 'लिखें', 'भेजें', 'कपड़ा', 'कितने', 'कहाँ', 'बाकी', 'चुनें']) console.log(w.padEnd(8), '→', (HI[w] || ['—'])[0]);
}
