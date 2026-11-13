/* SEARCH ON THE SERVER (v2 rebuild, Phase 5, 2 Nov 2026).
 *
 * Her own search (search.gen.js — the code her browser runs, joined unchanged) over her answers in D1 (table kb, loaded
 * at each deploy) and the answers admins approved (table answers, at once, no deploy), with her meaning table
 * (meera-words.bin, bundled with the router). Made once per router copy and kept; made again when kb_version changes.
 *
 * What a question gets back: the 3 best answers with their scores (only the question's language and English of each,
 * ~2 KB), how she understood the question, and the walk-through each answer offers. No ERP data is involved — only her
 * written answers. */
import { makeSearch } from './search.gen.js';

let ENGINE = { version: null, s: null, walks: null, at: 0 };
export function resetEngine() { ENGINE = { version: null, s: null, walks: null, at: 0 }; }

/* an admin's words are text: escaped, with **bold** for button names (as the browser's gaMd shows them) */
const md = s => String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const all3 = v => ({ en: v, hi: v, hg: v });
/** an approved answer, as the browser makes it from GET /learned (guide-ai.js gaAiLearned) */
export function learnedEntry(x) {
  const a = x.answer || {};
  return { id: 'learned-' + x.id, tab: x.screen || '', q: all3([x.question]), a: all3(md(a.a)),
    why: a.why ? all3(md(a.why)) : undefined, steps: a.steps && a.steps.length ? all3(a.steps.map(md)) : undefined };
}

/** her search, ready: (re)made when her answers changed */
export async function engine(db, words, version) {
  if (ENGINE.s && ENGINE.version === version) return ENGINE;
  const rows = await db.kbAll();
  const list = rows.filter(r => r.kind === 'answer').map(r => r.body);
  const have = new Set(list.map(e => e.id));
  for (const x of await db.learned()) { const e = learnedEntry(x); if (!have.has(e.id)) list.push(e); }
  /* the walk-through an answer offers, found as the browser finds it (guide-walks.js gaWalkFor): by the answers it was
   * made from, by the job it replaces, or by the button that starts it */
  const walks = new Map(), bySel = new Map();
  for (const r of rows.filter(r => r.kind === 'walk')) {
    const w = r.body;
    for (const k of [w.id, w.replaces, w.existing].concat(w.from || [])) if (k && !walks.has(k)) walks.set(k, w);
    const go = (w.steps || []).find(st => st.sel && st.wait === 'click');
    if (go && /^#[\w-]+$/.test(go.sel) && !bySel.has(go.sel)) bySel.set(go.sel, w);
  }
  const s = makeSearch();
  const t0 = Date.now();
  s.load(list, words || null);
  ENGINE = { version, s, walks, bySel, at: Date.now(), loadMs: Date.now() - t0, n: list.length };
  return ENGINE;
}

/** one entry, cut to what the answer needs: the asked language and English */
function slim(e, lang) {
  const pick = o => (o && typeof o === 'object' && !Array.isArray(o) ? { en: o.en, [lang]: o[lang] } : o);
  const out = {};
  for (const [k, v] of Object.entries(e)) {
    if (['phr', 'all', 'body', 'raw', 'pn', 'pw'].includes(k)) continue;   // her search's own working, not the answer
    /* the fuller explanation is three parts, each in three languages: each part cut the same way (5 Nov) */
    out[k] = k === 'q' ? { en: (v.en || []).slice(0, 1), [lang]: (v[lang] || []).slice(0, 1) }
      : k === 'more' && v ? { for: pick(v.for), how: pick(v.how), when: pick(v.when) } : pick(v);
  }
  return out;
}

/** a question: { q, screen, lang, spell, tabs, admin, names } → { hits, understood } */
export function search(E, body) {
  const s = E.s, h = s.host;
  h.screen = String(body.screen || '').slice(0, 40);
  h.people = Array.isArray(body.names) ? body.names.slice(0, 400).map(String) : [];
  h.tabs = Array.isArray(body.tabs) ? body.tabs.slice(0, 100).map(String) : [];
  h.admin = !!body.admin;
  h.switches = new Set(body.spell ? ['spell'] : []);
  const t0 = Date.now();
  const r = s.find(String(body.q || '').slice(0, 300));
  const lang = ['en', 'hi', 'hg'].includes(body.lang) ? body.lang : r.lang;
  const hits = r.hits.slice(0, 3).map(x => ({ id: x.e.id, s: Math.round(x.s * 10000) / 10000, e: slim(x.e, lang), walk: E.walks.get(x.e.id) || (x.e.task && E.walks.get(x.e.task)) || (x.e.sel && E.bySel.get(x.e.sel)) || null }));
  return { hits, understood: r.understood, lang: r.lang, offTopic: !!r.offTopic, ms: Date.now() - t0 };
}
/** the browser's "sure": the best answer at 0.75 or more and 0.04 ahead of the next (as her tests score it) */
export const sure = list => !!(list[0] && list[0].s >= 0.75 && !(list[1] && list[0].s - list[1].s < 0.04 && list[1].id !== list[0].id));
