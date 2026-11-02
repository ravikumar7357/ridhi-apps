/* MEERA'S SEARCH AS A SMALL SERVICE (master plan D.2, 2 Nov 2026) — the portable layer (decision 5).
 *
 * Plain JavaScript with no Firebase in it: a request in ({ method, path, origin, authorization, body }), a reply out
 * ({ status, headers, body }). index.js puts it on Firebase Cloud Functions; the same file could run on Supabase Edge
 * Functions or Cloudflare later. Her own search (lib/search.js + lib/search.gen.js — the code her browser runs, copied
 * by build.cjs from meera/router/src) over her answers, walk-throughs and meaning table (data/, copied from
 * Replenish-App/public/guide), plus the answers admins approved (read from her Cloudflare router's /learned, at most every
 * 5 minutes, with the asker's own sign-in).
 *
 * It keeps nothing and writes nothing: no database (Firestore / Realtime Database are never touched — the quota fix
 * stands), no file, no log of questions. Questions arrive already cleaned by the browser (srvClean).
 *   GET  /wake     starts her search (cold start while the person types), answers { ok }
 *   POST /search   { q, screen, lang, spell, tabs, admin, names } → { hits, understood, lang, offTopic, ms, v, n }
 * Only the ERP's own pages may ask (live site and its test links), and /search only for a signed-in person. */
import { engine, search } from './lib/search.js';
import { verify } from './lib/auth.js';

const ORIGIN_OK = o => /^https:\/\/fabricrush-replenish(--[a-z0-9-]+)?\.(web\.app|firebaseapp\.com)$/.test(String(o || ''));
const cors = origin => (ORIGIN_OK(origin) ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-max-age': '86400', vary: 'origin' } : null);
const out = (status, body, h) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(h || {}) }, body: JSON.stringify(body) });
/* a person's questions per instance per day — a cap so one stuck page cannot keep two instances busy all day */
const PER_DAY = 400;

/** files: { bank: [...], walks: [...], words: ArrayBuffer, version: 'abc' }; env: { FIREBASE_PROJECT_ID, ROUTER_URL } */
export function makeService({ files, env, fetcher = fetch }) {
  let learned = { at: 0, list: [], n: -1 };
  const asked = new Map();
  const rows = files.bank.map(b => ({ kind: 'answer', body: b })).concat(files.walks.map(w => ({ kind: 'walk', body: w })));
  async function readLearned(auth) {
    if (Date.now() - learned.at < 5 * 60e3 || !env.ROUTER_URL) return learned.list;
    learned.at = Date.now();
    try {
      const r = await fetcher(env.ROUTER_URL.replace(/\/$/, '') + '/learned', { headers: { authorization: auth, origin: 'https://fabricrush-replenish.web.app' } });
      if (r.ok) { const j = await r.json(); learned.list = Array.isArray(j.answers) ? j.answers : (Array.isArray(j) ? j : []); }
    } catch (e) { /* her router not reachable: the approved answers she already had */ }
    return learned.list;
  }
  async function ticket(auth) {
    if (!env.ROUTER_URL) return { ok: false, why: 'no-router' };
    try {
      const r = await fetcher(env.ROUTER_URL.replace(/\/$/, '') + '/search-ticket', { method: 'POST', headers: { authorization: auth, origin: 'https://fabricrush-replenish.web.app', 'content-type': 'application/json' }, body: '{}' });
      if (!r.ok) return { ok: false, why: 'router-' + r.status };
      const j = await r.json();
      return { ok: !!j.ok, why: j.why || '' };
    } catch (e) { return { ok: false, why: 'router-down' }; }   // fail closed: no count, no search
  }
  const ready = async auth => {
    const list = auth ? await readLearned(auth) : learned.list;
    return engine({ kbAll: async () => rows, learned: async () => list }, files.words, files.version + ':' + list.length);
  };
  return {
    async handle(req) {
      const h = cors(req.origin);
      if (req.method === 'OPTIONS') return h ? { status: 204, headers: h, body: '' } : out(403, { error: 'origin' });
      if (!h) return out(403, { error: 'origin' });
      if (req.path === '/wake' && req.method === 'GET') {
        if (!(await verify(String(req.authorization || '').replace(/^Bearer\s+/i, ''), env, fetcher))) return out(401, { error: 'sign-in' }, h);
        const E = await ready(''); return out(200, { ok: true, n: E.n, loadMs: E.loadMs }, h);
      }
      if (req.path === '/search' && req.method === 'POST') {
        const who = await verify(String(req.authorization || '').replace(/^Bearer\s+/i, ''), env, fetcher);
        if (!who) return out(401, { error: 'sign-in' }, h);
        const day = new Date().toISOString().slice(0, 10), k = who.uid + '|' + day, n = (asked.get(k) || 0) + 1;
        if (asked.size > 5000) asked.clear();
        asked.set(k, n);
        if (n > PER_DAY) return out(429, { error: 'too-many' }, h);
        let body = req.body;
        if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return out(400, { error: 'json' }, h); } }
        /* the daily limit for all staff together (her router's shared count, 5,000): over it, or her router out of
         * reach, no search here — the browser answers from her own copy (a firm limit: never more, whatever restarts) */
        const t = await ticket(req.authorization);
        if (!t.ok) return out(429, { error: t.why || 'daily-limit' }, h);
        const E = await ready(req.authorization);
        const r = search(E, { ...body, admin: who.admin });
        return out(200, { ...r, v: E.version, n: E.n }, h);
      }
      return out(404, { error: 'not-found' }, h);
    },
  };
}
