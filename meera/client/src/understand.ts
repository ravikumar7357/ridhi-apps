/* MEERA UNDERSTANDS A QUESTION — spelling mistakes (v2 rebuild, Phase 2, 29 Oct 2026).
 *
 * One self-contained step, with no page access at all, so it can later run on her server unchanged (plan Phase 5):
 * a question and a word list in, the question as she understood it out, with every change she made.
 *
 *   muUnderstand("karigr ko kaam kaise de", dict)  →  { text: "karigar ko kaam kaise de", changes: [{ from: "karigr", to: "karigar" }] }
 *
 * For each word she does not know (a word she knows, a number, a code with digits, a karigar's name or Hindi script is
 * left exactly as it is):
 *   1. sound-alike   — Hinglish sounds made the same: k/q/c, w/v, ph/f, z/j, ee/i, oo/u, doubled letters ("maaal" → maal)
 *   2. close spelling — a letter dropped, added, changed, or two swapped, the first letter too; the commonest such word in
 *                       her answers wins. Careful with short words, where a slip easily makes another word ("truck",
 *                       "chai"): up to 5 letters only two letters swapped or a vowel dropped ("mial", "krte");
 *                       6–8 letters, 1 letter off; 9 and more, 2 off if the first letter is right ("untouched" stays)
 *   3. joined / split — "jobwork" → "job work", "scan ner" → "scanner"
 *   Hindi script: the same sound — short or long matra (ि/ी, ु/ू, े/ै, ो/ौ), the dot (nukta), a halant — matched to
 *   her answers' Hindi words ("कहँ" → कहाँ is left: a missing matra is not a sound slip).
 * Switched on by "spell" (core/meera-bridge.js); off, she reads questions exactly as before. */

interface MeeraDict {
  /** every word she knows: her answers' words, her own word list, filler words, people's names */
  known: Set<string>;
  /** how common each word is in her answers (more common wins a tie) */
  freq: Map<string, number>;
  /** two words her answers use side by side ("job work") — a word is split only into such a pair */
  pairs: Set<string>;
}
interface MeeraUnderstood { text: string; changes: { from: string; to: string }[] }

/** the sound of a word: Hinglish spellings of one sound made the same */
function muSound(w: string): string {
  return w.toLowerCase()
    .replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/q/g, 'k').replace(/c(?!h)/g, 'k')
    .replace(/w/g, 'v').replace(/z/g, 'j').replace(/x/g, 'ks')
    .replace(/(.)\1+/g, '$1');
}
/** the sound of a Hindi-script word: the spellings phones mix up made the same */
function muSoundHi(w: string): string {
  return w.replace(/़/g, '').replace(/ी/g, 'ि').replace(/ू/g, 'ु').replace(/ै/g, 'े').replace(/ौ/g, 'ो').replace(/्/g, '');
}
/** letters apart, a swap of two neighbours counting as one (Damerau); stops early past `max` */
function muDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = max + 1;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** what a dictionary needs worked out once: words by sound, and by length for the close-spelling search */
interface MeeraDictIndex { dict: MeeraDict; bySound: Map<string, string>; bySoundHi: Map<string, string>; byLen: Map<number, string[]>; cache: Map<string, string | null> }
function muIndex(dict: MeeraDict): MeeraDictIndex {
  const bySound = new Map<string, string>(), bySoundHi = new Map<string, string>(), byLen = new Map<number, string[]>();
  const f = (w: string) => dict.freq.get(w) || 0;
  for (const w of dict.known) {
    if (/^[ऀ-ॿ]{2,}$/.test(w) && f(w) > 0) { const k = muSoundHi(w), had = bySoundHi.get(k); if (!had || f(w) > f(had)) bySoundHi.set(k, w); continue; }
    if (!/^[a-z]{3,}$/.test(w)) continue;
    const s = muSound(w), had = bySound.get(s);
    if (f(w) > 0 && (!had || f(w) > f(had))) bySound.set(s, w);   // only her answers' words are corrections
    if (!byLen.has(w.length)) byLen.set(w.length, []);
    byLen.get(w.length)!.push(w);
  }
  return { dict, bySound, bySoundHi, byLen, cache: new Map() };
}

/** the word she thinks was meant, or null to leave it as it is */
function muFix(w: string, ix: MeeraDictIndex): string | null {
  if (ix.cache.has(w)) return ix.cache.get(w)!;
  const { dict } = ix, f = (x: string) => dict.freq.get(x) || 0;
  let out: string | null = null;
  /* 1. the same sound */
  const s = muSound(w), same = w.length >= 4 ? ix.bySound.get(s) : undefined;
  if (same && same !== w) out = same;
  /* 2. a close spelling (the limits by length are above). Of the closest, the likeliest slip first — two letters
   *    swapped ("mial" → mail), then only vowels different, Hinglish-style ("krte" → karte), then the same first letter —
   *    and among those the commonest in her answers */
  if (!out && w.length >= 4) {
    const max = w.length >= 9 ? 2 : 1;
    const sorted = (x: string) => x.split('').sort().join(''), bones = (x: string) => x.replace(/[aeiou]/g, '');
    const kind = (k: string) => (sorted(k) === sorted(w) ? 3 : bones(k) === bones(w) ? 2 : k[0] === w[0] ? 1 : 0);
    let best: string | null = null, bd = max + 1, bk = -1, bf = -1;
    for (let L = w.length - max; L <= w.length + max; L++) for (const k of ix.byLen.get(L) || []) {
      if (f(k) <= 0) continue;   // a word only known (filler, a name) is never a correction
      const d = muDistance(w, k, max);
      if (d > bd || d > max) continue;
      const kk = kind(k), fk = f(k);
      /* short: two letters swapped, or a vowel dropped Hinglish-style from a word of at most one vowel ("krte", not "mine") */
      if (w.length <= 5 && !(kk === 3 || (kk === 2 && k.length !== w.length && w.replace(/[^aeiou]/g, '').length <= 1))) continue;
      if (d === 2 && k[0] !== w[0]) continue;
      /* only the last letter different — another form of the word, not a slip ("computed", "figured", "chadhayi") */
      let same = 0; while (same < w.length && w[same] === k[same]) same++;
      if (same >= Math.min(w.length, k.length) - 1 && Math.abs(w.length - k.length) <= 1 && kk !== 3) continue;
      if (d < bd || kk > bk || (kk === bk && fk > bf)) { best = k; bd = d; bk = kk; bf = fk; }
    }
    if (best) out = best;
  }
  ix.cache.set(w, out);
  return out;
}

function muUnderstand(q: string, ix: MeeraDictIndex): MeeraUnderstood {
  const parts = String(q || '').split(/(\s+)/);   // the spaces kept, so the question reads the same
  const changes: { from: string; to: string }[] = [];
  const known = (w: string) => ix.dict.known.has(w);
  const word = (p: string) => p.toLowerCase().replace(/[’']/g, '').replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
  const plain = (w: string) => /^[a-z]{3,}$/.test(w);
  for (let i = 0; i < parts.length; i += 2) {
    const w = word(parts[i]);
    if (known(w)) continue;
    if (/^[ऀ-ॿ]{2,}$/.test(w)) {   // Hindi script: the same sound only
      const to = ix.bySoundHi.get(muSoundHi(w));
      if (to && to !== w) { changes.push({ from: parts[i], to }); parts[i] = to; }
      continue;
    }
    if (!plain(w)) continue;
    /* 3a. two words written as one: "jobwork" → "job work" */
    let split: string | null = null;
    if (w.length >= 6) for (let k = 3; k <= w.length - 3; k++) {
      const a = w.slice(0, k), b = w.slice(k);
      if (ix.dict.pairs.has(a + ' ' + b)) { split = a + ' ' + b; break; }   // "jobwork" → job work; not "payroll" → pay roll
    }
    /* 3b. one word written as two: "scan ner" → "scanner" (with the next word) */
    if (!split && i + 2 < parts.length) {
      const nx = word(parts[i + 2]), joined = w + nx;
      if (plain(nx) && !known(nx) && known(joined)) {
        changes.push({ from: parts[i] + parts[i + 1] + parts[i + 2], to: joined });
        parts[i] = joined; parts[i + 1] = ''; parts[i + 2] = '';
        continue;
      }
    }
    const to = split || muFix(w, ix);
    if (to && to !== w) { changes.push({ from: parts[i], to }); parts[i] = to; }
  }
  return { text: parts.join(''), changes };
}
