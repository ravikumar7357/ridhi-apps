/* MEERA'S NUMBERS — what the baseline records and the gate compares (v2 rebuild, 29 Oct 2026).
 *
 *   scores   the three test sets (eval, eval2, parts): right first time / offered among the top 3 / wrong / not sure
 *   typos    the same questions with made-up spelling mistakes (the same mistakes every run)
 *   golden   Meera's whole answer to every test question — the text, her buttons, which answer — to spot ANY change
 *   sizes    what a computer downloads for her
 *
 * The scoring is the one used since 24 Oct: "sure" = top score ≥ 0.75 and ahead of the next by 0.04. */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { load } = require('./harness.cjs');
const ROOT = path.join(__dirname, '..', '..');
const EVALS = path.join(__dirname, '..', 'bank', 'evals');
const readEval = n => JSON.parse(fs.readFileSync(path.join(EVALS, n + '.json'), 'utf8'));

function classify(h, x) {
  const ok = id => id === x.id;
  const sure = h[0] && h[0].s >= 0.75 && !(h[1] && h[0].s - h[1].s < 0.04 && h[1].id !== h[0].id);
  if (sure && ok(h[0].id)) return 'right';
  if (h[0] && h[0].s >= 0.32 && h.slice(0, 3).some(z => z.s >= 0.32 && ok(z.id))) return 'offered';
  return sure ? 'wrong' : 'none';
}
async function score(M, list) {
  const res = { right: 0, offered: 0, wrong: 0, none: 0 };
  const per = [];
  for (const x of list) { const k = classify(M.find(x.q, x.tab || 'shop'), x); res[k]++; per.push(k); }
  return { ...res, per };
}

/* The same mistakes every run: a small seeded random, one or two words per question changed the way people type
 * (a letter dropped, two swapped, one doubled, a vowel changed). Only Latin-letter words of 4+ letters. */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function typoOf(q, r) {
  const words = q.split(/(\s+)/);
  const idx = words.map((w, i) => (/^[a-z]{4,}$/i.test(w) ? i : -1)).filter(i => i >= 0);
  if (!idx.length) return null;
  const n = Math.min(idx.length, r() < 0.5 ? 1 : 2);
  for (let k = 0; k < n; k++) {
    const i = idx[Math.floor(r() * idx.length)], w = words[i], p = 1 + Math.floor(r() * (w.length - 2));
    const how = Math.floor(r() * 4);
    words[i] = how === 0 ? w.slice(0, p) + w.slice(p + 1)                                   // dropped
      : how === 1 ? w.slice(0, p) + w[p + 1] + w[p] + w.slice(p + 2)                        // swapped
      : how === 2 ? w.slice(0, p) + w[p] + w.slice(p)                                       // doubled
      : w.slice(0, p) + ('aeiou'.includes(w[p].toLowerCase()) ? 'aeiou'[(('aeiou'.indexOf(w[p].toLowerCase())) + 1) % 5] : w[p]) + w.slice(p + 1);   // vowel
  }
  const t = words.join('');
  return t === q ? null : t;
}
function typoSet() {
  const r = rng(29102026);
  const out = [];
  for (const name of ['eval', 'eval2']) for (const x of readEval(name)) {
    if (!x.id) continue;   // only questions Meera should answer
    const t = typoOf(x.q, r);
    if (t) out.push({ q: t, from: x.q, id: x.id, alt: x.alt });
  }
  return out;
}

function sizes() {
  const app = path.join(ROOT, 'Replenish-App');
  const one = f => { const b = fs.readFileSync(f); return { raw: b.length, gzip: zlib.gzipSync(b, { level: 9 }).length }; };
  const out = {};
  for (const f of ['meera-bank.json', 'meera-words.bin', 'meera-walks.json']) out[f] = one(path.join(app, 'public', 'guide', f));
  /* her code inside the page itself (every page load): the guide*.js files, and the picture within them */
  const order = fs.readFileSync(path.join(app, 'src/app/ORDER'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => /^core\/(guide|meera)|^@meera\//.test(s));
  const where = f => (f.startsWith('@meera/') ? path.join(ROOT, 'meera', 'client', 'src', f.slice(7)) : path.join(app, 'src/app', f));
  const code = order.map(f => fs.readFileSync(where(f)));
  const all = Buffer.concat(code);
  out['code in the page'] = { raw: all.length, gzip: zlib.gzipSync(all, { level: 9 }).length, files: order.length };
  const art = [path.join(ROOT, 'meera/client/src/legacy/guide-art.js'), path.join(app, 'src/app/core/guide-art.js')].find(f => fs.existsSync(f));
  if (art) out['picture (guide-art.js)'] = one(art);
  return out;
}

async function measure(opts = {}) {
  const t0 = Date.now();
  const M = await load({ root: ROOT, bundle: !!opts.bundle, switches: opts.switches });   // bundle: Meera as her own file, meera.js (Phase 1)
  const loadMs = Date.now() - t0;
  const sets = { eval: readEval('eval'), eval2: readEval('eval2'), parts: readEval('eval-parts') };
  const scores = {};
  for (const [k, list] of Object.entries(sets)) scores[k] = await score(M, list);
  const typos = typoSet();
  const typoScore = await score(M, typos);
  const t1 = Date.now();
  const golden = {};
  for (const [k, list] of Object.entries(sets)) for (const x of list) {
    const key = k + '|' + (x.tab || 'shop') + '|' + x.q;
    golden[key] = await M.answer(x.q, x.tab || 'shop');
  }
  const perQ = (Date.now() - t1) / Object.values(sets).reduce((a, l) => a + l.length, 0);
  return { scores, typos: { count: typos.length, ...typoScore }, golden, sizes: sizes(), timing: { loadMs, msPerAnswer: Math.round(perQ * 10) / 10 }, typoList: typos };
}
module.exports = { measure, classify, typoSet, sizes };

if (require.main === module) measure({ bundle: process.argv.includes('--bundle'), switches: (process.argv.find(a => a.startsWith('--on=')) || '').slice(5).split(',').filter(Boolean) }).then(m => {
  const short = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { right: v.right, offered: v.offered, wrong: v.wrong, none: v.none }]));
  console.log(JSON.stringify({ scores: short(m.scores), typos: { count: m.typos.count, right: m.typos.right, offered: m.typos.offered, wrong: m.typos.wrong, none: m.typos.none }, sizes: m.sizes, timing: m.timing, golden: Object.keys(m.golden).length }, null, 1));
}).catch(e => { console.error(e); process.exit(1); });
