/* MEERA SEARCHES ON HER ROUTER (v2 rebuild, Phase 5, 2 Nov 2026) — meera.js only.
 *
 *   switch "server"     SIDE BY SIDE. She answers in the browser exactly as before; after each answer the same question
 *                       (phone numbers, order numbers, amounts and emails taken out) goes to her router's search with
 *                       the browser's own top answers, and the router keeps whether the two agree (cleaned). Nothing the
 *                       person sees changes.
 *   switch "serveruse"  ANSWERS FROM THE ROUTER. Her 837 KB answer file and 1.3 MB meaning table are no longer
 *                       downloaded: each question gets the router's 3 best answers (~2 KB). The browser keeps only a
 *                       small list for the screen open now (meera/backup/<screen>.json, a few KB) and answers from it,
 *                       saying so, when the router cannot be reached or its search is switched off.
 * Her router's own switches (meera / ai / search, GET /config) are read once at start: "meera off" hides her. */

declare function gaBankIndex(list: unknown[]): { list: MdEntry[] };
declare function gaWalkAdd(w: unknown): void;
declare function gaWalksLoad(): Promise<unknown>;

const MEERA_SIDE: boolean = meeraOn('server');
const MEERA_REMOTE: boolean = meeraOn('serveruse');
const SRV = { down: false, full: false, last: null as null | { text: string; hits: { e: any; s: number }[]; offTopic: boolean }, cfg: null as null | { meera: boolean; ai: boolean; search: boolean; stopped: string }, tab: '' };

/** what is personal out before the search sees it: emails, phone numbers (10+ digits), tax ids, amounts of money. Order
 * and document numbers and other numbers stay — her answers are found by them ("AMZ-… me kitna bacha", the "e.g. 07001"
 * box) and they say nothing about a person; names stay too (they mean "karigar"). The router never keeps the question as
 * typed: a side-by-side record keeps it fully cleaned (names, order numbers… out). */
const srvClean = (q: string): string => String(q || '').slice(0, 500)
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
  .replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/gi, '[TAX-ID]').replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '[TAX-ID]')
  .replace(/\+?\d[\d\s-]{8,}\d/g, (m, at: number, all: string) => (m.replace(/\D/g, '').length >= 10 && !/[A-Z]-?$/i.test(all.slice(Math.max(0, at - 4), at)) ? '[PHONE]' : m))   // AMZ-01092026-01 is an order, not a phone
  .replace(/(?:₹|\brs\.?|\binr)\s*\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s*(?:\/-|₹|(?:rs|inr|rupees?|rupaye|rupay|rupiya|rupiye)\b\.?)/gi, '[AMOUNT]');
/* where her search runs (master plan D.2): her search on Firebase Cloud Functions (config.ts searchUrl); her router
 * (GA_AI_URL) keeps the AI, the learning records, her switches and the side-by-side records */
const srvSearchBase = (): string => MEERA_CONFIG.searchUrl || GA_AI_URL;
async function srvCall(path: string, body: object | null, ms: number, base: string = GA_AI_URL): Promise<{ status: number; body: any }> {
  if (!base) return { status: 0, body: {} };
  const tok = await ERP_MEERA.token();
  if (!tok) return { status: 0, body: {} };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = setTimeout(() => { try { ctl && ctl.abort(); } catch (e) { /* gone */ } }, ms);
  try {
    const r = await fetch(base.replace(/\/$/, '') + path, { method: body ? 'POST' : 'GET', signal: ctl ? ctl.signal : undefined,
      headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let j: any = {};
    try { j = await r.json(); } catch (e) { /* not JSON */ }
    return { status: r.status, body: j };
  } catch (e) { return { status: 0, body: {} }; } finally { clearTimeout(t); }
}
function srvAsk(q: string, extra: object): Promise<{ status: number; body: any }> {
  const u = ERP_MEERA.user();
  return srvCall('/search', { q: srvClean(q), screen: gaHere(), lang: gaRead(q).lang, spell: meeraOn('spell'), names: gaNames(), tabs: u.tabs, admin: u.admin, ...extra },
    MEERA_CONFIG.searchUrl ? MEERA_CONFIG.searchWaitMs : MEERA_CONFIG.routerWaitMs, srvSearchBase());
}
/** Ask Meera opened (guide-ask.ts): her search on the server starts while the person types — a cold start is hidden.
 * Only with "server" or "serveruse" on; at most every 5 minutes; nothing is waited for or sent but the call itself. */
let SRV_WOKE = 0;
function meeraServerWake(): void {
  if (!(MEERA_SIDE || MEERA_REMOTE) || !MEERA_CONFIG.searchUrl || (SRV.cfg && !SRV.cfg.search) || Date.now() - SRV_WOKE < 5 * 60e3) return;
  SRV_WOKE = Date.now();
  srvCall('/wake', null, MEERA_CONFIG.searchWaitMs, MEERA_CONFIG.searchUrl).catch(() => { /* asleep: her own copy answers */ });   // with the person's sign-in
}

/* ---------- side by side ---------- */
/** after each answer: her search on the server on the same question; the two top answers go to her router, which keeps
 * whether they agree (the question cleaned again there) — for "Meera's learning → Switches" */
function meeraServerAfter(q: string): void {
  if (!MEERA_SIDE || MEERA_REMOTE || (SRV.cfg && !SRV.cfg.search)) return;
  try {
    const cq = srvClean(q);
    const mine = gaSpellFind(cq).slice(0, 3).map(h => ({ id: h.e.id, s: Math.round(h.s * 10000) / 10000 }));
    srvAsk(q, MEERA_CONFIG.searchUrl ? {} : { compare: mine }).then(r => {   // not waited for: the person already has her answer
      if (!MEERA_CONFIG.searchUrl || r.status !== 200 || !Array.isArray(r.body.hits)) return;
      const server = r.body.hits.slice(0, 3).map((h: any) => ({ id: h.id, s: h.s }));
      srvCall('/diff', { q: cq, names: gaNames(), screen: gaHere(), spell: meeraOn('spell'), browser: mine, server }, MEERA_CONFIG.routerWaitMs);
    }, () => { /* skipped */ });
  } catch (e) { /* the comparison is skipped */ }
}

/* ---------- answers from the router ---------- */
/** before an answer: the router's 3 best (and how it understood the question); null when it cannot be had */
async function meeraServerFetch(q: string, asTyped = false): Promise<null | { understood: { text: string; changes: { from: string; to: string }[] } }> {
  if (!MEERA_REMOTE) return null;
  SRV.last = null;
  /* switched off, or stopped to stay free (the month's meter, the cent alarm): her own full copy, as before Phase 5 */
  if (SRV.cfg && !SRV.cfg.search) { if (!SRV.down) { SRV.down = true; GA_BANK = null; GA_BANK_P = null; if (GA_W === false) GA_W = null; } return null; }
  const r = await srvAsk(q, asTyped ? { spell: false } : {});
  if (r.status !== 200 || !Array.isArray(r.body.hits)) {
    /* her router cannot be reached (or its search is off): from now on, her own full copy, as before Phase 5 — fetched
     * once; with no internet at all it cannot come, and the small list for the screen answers */
    if (!SRV.down) { SRV.down = true; GA_BANK = null; GA_BANK_P = null; if (GA_W === false) GA_W = null; }
    return null;
  }
  for (const h of r.body.hits) if (h.walk) { try { gaWalkAdd(h.walk); } catch (e) { /* no walk */ } }
  SRV.last = { text: (r.body.understood && r.body.understood.text) || q, hits: r.body.hits.map((h: any) => ({ e: h.e, s: h.s })), offTopic: !!r.body.offTopic };
  return { understood: r.body.understood || { text: q, changes: [] } };
}
/** her search's result for this question, if the router gave it (guide-ask.js gaBankFind asks first) */
function meeraServerHits(q: string): null | { e: any; s: number }[] {
  if (!MEERA_REMOTE || !SRV.last) return null;
  return SRV.last.text === q ? SRV.last.hits : null;
}
/** did the router answer the question being answered now (its scores are read with the meaning-search bar) */
function meeraServerServed(): boolean { return MEERA_REMOTE && !!SRV.last; }
/** stopped on purpose (switched off, or to stay free): she searches on her own and says nothing about the server */
function meeraServerStopped(): boolean { return !!SRV.cfg && !SRV.cfg.search; }
/** "not about the ERP": the router's verdict (it has all her answers); with the router out of reach she never refuses —
 * her small list knows too few words to judge (null: the browser judges, as before) */
function meeraServerOffTopic(): boolean | null {
  if (!MEERA_REMOTE) return null;
  if (SRV.last) return SRV.last.offTopic;
  return SRV.full ? null : false;   // her own full copy is here: she judges as before
}
/** instead of her whole answer file: the small list for the screen open now (and the general one) */
function meeraServerBank(): Promise<unknown> | null {
  if (!MEERA_REMOTE) return null;
  if (SRV.down) return fetch('/guide/meera-bank.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error('offline'))))
    .then(list => (typeof gaWalksLoad === 'function' ? gaWalksLoad().then(() => list, () => list) : list))
    .then(list => { SRV.full = true; return (GA_BANK = gaBankIndex(list)); }, () => srvSmall());   // no internet: the small list
  return srvSmall();
}
/** the small list for the screen open now (and the general one) */
function srvSmall(): Promise<unknown> {
  const tab = gaHere() || '_';
  SRV.tab = tab;
  const one = (t: string) => fetch(MEERA_BASE + 'backup/' + t + '.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  return Promise.all([one(tab), tab === '_' ? Promise.resolve(null) : one('_')]).then(([a, b]: any[]) => {
    const list = ([] as any[]).concat((a && a.answers) || [], (b && b.answers) || []);
    for (const w of ([] as any[]).concat((b && b.walks) || [], (a && a.walks) || [])) { try { gaWalkAdd(w); } catch (e) { /* no walk */ } }   // the general list's (renamed jobs) first
    return (GA_BANK = gaBankIndex(list));
  });
}
/** her meaning table is not downloaded: the router has it */
function meeraServerWords(): Promise<unknown> | null {
  if (!MEERA_REMOTE || SRV.down) return null;   // her router out of reach: her own meaning table, as before
  GA_W = false;
  return Promise.resolve(false);
}
/* a new screen: its own small list, at the next question */
try { if (MEERA_REMOTE) ERP_MEERA.on('screen', () => { if (gaHere() !== SRV.tab) { GA_BANK = null; GA_BANK_P = null; } }); } catch (e) { /* no screens */ }

/* ---------- her router's switches ---------- */
/* read once her files have all started (the router's address is set further on) */
setTimeout(async () => {
  if (!(MEERA_SIDE || MEERA_REMOTE)) return;
  const r = await srvCall('/config', null, MEERA_CONFIG.routerWaitMs);
  if (r.status !== 200) return;
  SRV.cfg = { meera: r.body.meera !== false, ai: r.body.ai !== false, search: r.body.search !== false, stopped: String(r.body.searchStopped || '') };
  if (!SRV.cfg.meera) meeraStop('switched off on her router');
}, 0);
