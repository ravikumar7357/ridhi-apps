/* ================= LISTING · ✨ AI WRITING — the AI buttons and cards of the Listing module (19 Nov 2026) =================
 * ONE door to the backend's AI: aiAsk(task, brand, sku, opts) → GET ?ai=ask (Pricing-API/ListingAI.gs). Every ✨ button of every
 * screen uses it — there is no other copy. Tasks: title, bullets, description, kw, season, aplus_text, ip_rewrite, error_explain,
 * image_check. The backend reads the listing itself (the ListingMatch cache, the Optimiser's search words); only rule words travel in
 * the address (the protected words, the words to avoid, the template, the season, the risky word, Amazon's issue code).
 *
 * WHERE THE BUTTONS ARE (each file draws its button with aiBtnHtml; this file does the rest):
 *   Listing Errors → Content (listing-content.js)   ✨ AI title / bullets / description / search terms → "Use AI version" fills the box
 *   Listing Errors → What Amazon says (listing-errors.js)   ✨ Explain this error — a read-only card
 *   Fix all titles / Fix all search terms popups (title-fix.js, kw-fix.js)   ✨ AI version per row → "Use AI version" puts it in the row
 *   Listing Optimiser review (listing-optimiser.js)   ✨ AI rewrite of the whole listing (title, bullets, description, search terms)
 *   Season planner child panel (season-planner.js)   ✨ AI season Item Highlights / season title
 *   A+ Content rows Missing / Draft (aplus-audit.js)   ✨ Draft A+ text — Copy (A+ is made in Seller Central's A+ Content Manager)
 *   IP & Trademark Guard finding (ip-guard.js)   ✨ Rewrite without this word → title / search terms into the existing Fix all popup,
 *                                                bullets / description / Item Highlights through the safe send
 *   Image Manager editor (image-manager.js)   ✨ Check main photo — a read-only pass / fail card
 *
 * THE SAFE FLOW, every change: Claude suggests → OUR rules check it (aiCheck: the protected words of the suggestion-words rule, the IP &
 * Trademark Guard lists, the title rules — 60–75, the template, the 74–75 short forms — lrKwCheck's 249 bytes, our brand words, the
 * Listing Content checks): a failed check is red and Approve / Use stays disabled until the text is fixed (the AI text can be edited in
 * the card) → the person approves → THE ONE SEND PATH (listing-send-check.js sqSendWithCheck: Amazon's check → send → read again →
 * Listing History, marked "AI suggested" → Put back). Nothing is sent by the AI, nothing runs when a page opens (a click only), and
 * the buttons are HIDDEN until the backend says it is set up: ONE status call per page load (aiStatusCheck: GET ?ai=ask&task=status,
 * kept for the browser session) — no key, no route deployed, or "AI not set up yet" = no ✨ button anywhere, every page exactly as before.
 * Set up, a click that meets the month's limit says so in a calm grey line ("Monthly AI limit reached").
 * Under each card: "AI used this month: $X of $80".
 * PART 2 (20 Nov 2026): every writing task sends the APPROVED house style of the listing's product type (&style=, Listing Rules → ✨ AI house
 * style: the guides the backend learnt, Approve, Learn again) and its card says "Follows: … house style (approved …)" / "No house style yet";
 * the read-only page tasks — ✨ Fix these first (Listing Health), ✨ Draft title template (Listing Rules), ✨ Why did rank change? (BSR
 * Audit), ✨ Suggest the right category (Categories), ✨ Did this change work? (Listing History), ✨ Bundle ideas (Bought Together) —
 * send only the page's numbers, ids and rule names (&d=), never listing text.
 * Main functions: aiStatusCheck, aiOn, aiAsk, aiBtnHtml, aiCheck, aiOpen, aiCardHtml, aiApprove, aiPreset, aiWasUsed, aiReport. Every name starts with ai / AI. */

const AI_TASKS = ['title', 'bullets', 'description', 'kw', 'season', 'aplus_text', 'ip_rewrite', 'error_explain', 'image_check',
  'fix_first', 'title_template', 'bsr_why', 'category_suggest', 'change_result', 'bundle_ideas'];             // PART 2: the page tasks
const AI_STYLED = ['title', 'bullets', 'description', 'kw', 'season', 'aplus_text', 'ip_rewrite', 'title_template'];   // follow an approved house style
const AI_LIMIT_DEF = 80;
const AI_SCREEN = { lc: 'Listing Errors', send: 'AI suggestion', tt: 'Titles · Fix all', kf: 'Search terms · Fix all', ipg: 'IP & Trademark Guard' };
const AI_SALE = /\b(?:black friday|cyber monday|prime day|deals?|sale|discount|offers?|clearance|free shipping)\b|\d+\s*%\s*off\b/i;
// what a task writes, in words (the card's heading)
const AI_WHAT = { title: 'title', bullets: 'bullet points', description: 'description', kw: 'search terms', season: 'season text', aplus_text: 'A+ text draft',
  ip_rewrite: 'rewrite', error_explain: 'explanation', image_check: 'main photo check' };
// the attribute each field writes, and its name in words
const AI_ATTR = { title: 'item_name', bullets: 'bullet_point', desc: 'product_description', kw: 'generic_keyword', hl: 'title_differentiation' };
let AI = { ready: null, status: null, off: false, why: '', month: null, limit: null, memo: new Map(), jobs: new Map(), used: new Map(), calls: 0, n: 0 };
const AI_SESSION_KEY = 'sellora_ai_ready';     // the status answer, kept for the browser session (sessionStorage)
const AI_WAIT_API_MS = 120000;                  // how long the status check waits for the backend address (sign-in reads it)

/* ----- is AI set up? ONE cheap status call per page load (no Claude call), kept for the session ----- */
// true only when the backend said it has the key; until then (and when it is not set up) every ✨ button is hidden.
const aiOn = () => AI.ready === true;
function aiSessionGet() { try { const v = JSON.parse(sessionStorage.getItem(AI_SESSION_KEY) || 'null'); return v && typeof v.ready === 'boolean' ? v : null; } catch (e) { return null; } }
function aiSessionSet(ready) { try { sessionStorage.setItem(AI_SESSION_KEY, JSON.stringify({ ready, at: Date.now() })); } catch (e) { /* private window: asked again next load */ } }
/** The one status check: GET ?ai=ask&task=status → { ok, ready, monthUsd, limitUsd }. A backend without the route, a failed call or
 *  ready: false → hidden. Asked once per page load (the session's answer is used when there is one). Returns the promise of AI.ready. */
function aiStatusCheck() {
  if (AI.status) return AI.status;
  const kept = aiSessionGet();
  if (kept) { AI.ready = kept.ready; if (AI.ready) aiStyleOkLoad(); AI.status = Promise.resolve(AI.ready); return AI.status; }
  if (typeof API === 'undefined') { AI.ready = false; AI.status = Promise.resolve(false); return AI.status; }   // a page with no backend at all
  AI.status = (async () => {
    const t0 = Date.now();
    while (!(typeof API !== 'undefined' && API && API.url) && Date.now() - t0 < AI_WAIT_API_MS) await new Promise(res => setTimeout(res, 500));
    if (!(typeof API !== 'undefined' && API && API.url)) { AI.ready = false; return false; }
    let reply = null;
    try { reply = await aiGet({ ai: 'ask', task: 'status' }); } catch (e) { reply = null; }
    AI.ready = !!(reply && reply.ok && reply.ready === true);
    if (reply && reply.monthUsd != null) AI.month = Number(reply.monthUsd) || 0;
    if (reply && reply.limitUsd != null) AI.limit = Number(reply.limitUsd) || AI_LIMIT_DEF;
    if (reply) aiSessionSet(AI.ready);                 // a failed call is not kept: the next page load asks again
    if (AI.ready) aiStyleOkLoad();                     // the approved house style guides (Listing Rules' own store), once
    return AI.ready;
  })();
  return AI.status;
}

/* ----- small helpers ----- */
const aiEsc = s => String(s == null ? '' : s).replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[ch]));
const aiUsd = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const aiLine = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const aiCfg = () => (typeof LR !== 'undefined' && LR) || (typeof LR_DEFAULT !== 'undefined' ? LR_DEFAULT : {});
// "AI used this month: $3.20 of $80" — '' until an answer has said it
const aiUsedLine = () => (AI.month == null ? '' : `AI used this month: ${aiUsd(AI.month)} of ${aiUsd(AI.limit || AI_LIMIT_DEF).replace(/\.00$/, '')}`);

/* ============================================================================================
 * 1. THE ONE DOOR: aiAsk
 * ============================================================================================ */
// One GET to the backend (the key goes as every Sellora GET does). The answer as JSON, whatever it is.
async function aiGet(params) {
  if (typeof API === 'undefined' || !API || !API.url) return { ok: false, reason: 'The backend is not configured on this page' };
  const url = new URL(API.url);
  url.searchParams.set('key', API.key);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') url.searchParams.set(k, v); });
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { return { ok: false, reason: /^\s*</.test(text) ? 'The backend answered with a web page, not data' : 'The backend sent something that is not data' }; }
}
/** THE ONE FUNCTION every ✨ button uses. task: one of AI_TASKS. opts: { words, avoid (lists), field, season, word, code, tpl, max, hlmax,
 *  asin }. → { ok, task, result, why, model, costUsd, monthUsd, limitUsd, cached } or { ok: false, reason }. Never throws. A good answer is
 *  kept for the page's life (the backend keeps it 6 hours too); a failure is asked again on the next click. */
async function aiAsk(task, brand, sku, opts) {
  opts = opts || {};
  if (!AI_TASKS.includes(task)) return { ok: false, reason: 'Unknown AI task' };
  const params = { ai: 'ask', task, brand: brand === 'CPC' ? 'CPC' : 'SP' };
  if (sku) params.sku = String(sku);
  else if (opts.asin) params.asin = String(opts.asin);
  const list = v => [...new Set((Array.isArray(v) ? v : []).map(s => aiLine(String(s).replace(/\|/g, ' '))).filter(Boolean))].slice(0, 40).join('|');
  if (opts.words && opts.words.length) params.words = list(opts.words);
  if (opts.avoid && opts.avoid.length) params.avoid = list(opts.avoid);
  ['field', 'season', 'word', 'code', 'tpl', 'max', 'hlmax', 'pt', 'style', 'newsku', 'colour', 'size'].forEach(k => { if (opts[k] != null && opts[k] !== '') params[k] = String(opts[k]).slice(0, 200); });
  if (opts.d) params.d = (typeof opts.d === 'string' ? opts.d : JSON.stringify(opts.d)).slice(0, 8000);      // a page task's facts: numbers, ids, rule names
  const key = JSON.stringify(params);
  if (AI.memo.has(key)) return AI.memo.get(key);
  AI.calls++;
  let reply;
  try { reply = await aiGet(params); } catch (e) { reply = { ok: false, reason: 'Could not reach the backend (' + String((e && e.message) || e).slice(0, 100) + ')' }; }
  if (!reply || typeof reply !== 'object') reply = { ok: false, reason: 'The backend gave no answer' };
  // a backend without the AI route answers like the old ASIN lookup: AI is not set up there yet
  if (!reply.ok && !reply.reason && /No ASIN found/i.test(String(reply.error || ''))) reply.reason = 'AI not set up yet';
  if (!reply.ok && !reply.reason) reply.reason = String(reply.error || 'The AI request failed');
  if (reply.monthUsd != null) AI.month = Number(reply.monthUsd) || 0;
  if (reply.limitUsd != null) AI.limit = Number(reply.limitUsd) || AI_LIMIT_DEF;
  if (!reply.ok && /not set up yet|limit reached/i.test(reply.reason)) { AI.off = true; AI.why = reply.reason; }
  if (!reply.ok && /not set up yet/i.test(reply.reason)) { AI.ready = false; aiSessionSet(false); }    // the buttons go away on the next draw
  if (reply.ok) { AI.off = false; AI.why = ''; AI.memo.set(key, reply); }
  return reply;
}

/* ============================================================================================
 * 2. THE LISTING, AND OUR RULES ON A SUGGESTION
 * ============================================================================================ */
/** Everything the checks need about one listing: { brand, sku, asin, pt, ctx, cfg, row, fresh, m, now: { title, bullets, desc, kw, hl },
 *  facts (the suggestion-words rule's facts), rows (Listing Health is loaded) }. */
function aiCtx(brand, sku) {
  let ctx = null;
  try { ctx = typeof hCtx === 'function' ? hCtx() : null; } catch (e) { ctx = null; }
  ctx = ctx || { cfg: aiCfg() };
  const rows = (typeof HEALTH !== 'undefined' && HEALTH[brand] && HEALTH[brand].rows) || [];
  const row = Object.assign({ brand }, rows.find(r => r.sku === sku) || { sku });
  let fresh = row;
  try { if (rows.length && typeof lrFresh === 'function') fresh = Object.assign({ brand }, lrFresh(row, ctx)); } catch (e) { fresh = row; }
  const m = (typeof lmGet === 'function' && lmGet(sku, brand)) || {};
  const title = (typeof hTitleText === 'function' ? hTitleText(fresh) : '') || m.t || '';
  const kw = fresh.kw != null ? String(fresh.kw) : String(m.kw || '');
  const pt = String(m.pt || fresh.pt || '');
  let facts = {};
  try { facts = typeof lrSwFacts === 'function' ? lrSwFacts(fresh, ctx.cfg, m.va || null, { pt, title }) : {}; } catch (e) { facts = {}; }
  return { brand, sku, asin: row.asin || m.asin || '', pt, ctx, cfg: ctx.cfg || aiCfg(), row, fresh, m, rows: rows.length > 0, facts,
    now: { title, bullets: (m.bl || []).slice(), desc: String(m.d || ''), kw, hl: (m.hl || []).slice() } };
}
/** The protected words of a text (the suggestion-words rule, RULE 1): [{ text, cls, keys }] — each phrase once, as written. */
function aiProtected(text, mode, facts) {
  if (!text || typeof lrSuggestWords !== 'function') return [];
  let r;
  try { r = lrSuggestWords(String(text), { mode, facts: facts || {} }); } catch (e) { return []; }
  const out = [], seen = new Set();
  let cur = null;
  (r.toks || []).forEach(t => {
    if (!t.cls || !t.k) { cur = null; return; }
    if (cur && cur.cls === t.cls) { cur.words.push(t.w); cur.keys.push(t.k); return; }
    cur = { cls: t.cls, words: [t.w], keys: [t.k] };
    out.push(cur);
  });
  return out.map(p => ({ text: p.words.join(' '), cls: p.cls, keys: p.keys }))
    .filter(p => { const k = p.keys.join(' '); if (seen.has(k)) return false; seen.add(k); return true; });
}
/** The protected phrases a new text leaves out: ['Hand Block Print', …]. A size counts as kept when its numbers are there
 *  ("54 x 54 Inch" → "54x54 Inch" keeps it). */
function aiLost(keep, after) {
  const keys = new Set([...String(after || '').matchAll(/\S+/g)].map(m => (typeof lrSwKey === 'function' ? lrSwKey(m[0].replace(/^[^\p{L}\p{N}%]+|[^\p{L}\p{N}%]+$/gu, '')) : m[0].toLowerCase())).filter(Boolean));
  const nums = new Set(String(after || '').match(/\d+(?:\.\d+)?/g) || []);
  const unit = typeof LR_SW_UNIT !== 'undefined' ? LR_SW_UNIT : ['x', 'inch', 'in', 'cm'];
  return keep.filter(p => {
    if (p.cls === 'size') return (p.text.match(/\d+(?:\.\d+)?/g) || []).some(n => !nums.has(n));
    return p.keys.filter(k => !unit.includes(k)).some(k => !keys.has(k));
  }).map(p => p.text);
}
// The risky words (IP & Trademark Guard) in a text, the ones allowed on purpose left out: ['risky word “Pottery Barn” (…)'].
function aiRisk(c, text) {
  if (typeof ipgTitleRisk !== 'function' || !text) return [];
  try { return [...new Set(ipgTitleRisk(c.brand, c.sku, c.fresh, String(text), c.cfg))]; } catch (e) { return []; }
}
// The words the backend must not write: every risky word the listing holds now (its title, bullets, description, search terms, Item Highlights).
function aiAvoid(c) {
  if (typeof ipgFind !== 'function') return [];
  const all = [c.now.title, c.now.bullets.join('\n'), c.now.desc, c.now.kw, c.now.hl.join('\n')].join('\n');
  try { return [...new Set(ipgFind(all, c.cfg).map(x => x.word))].slice(0, 30); } catch (e) { return []; }
}
// A sale word in a text ("Black Friday", "deal", "% off"), or ''.
const aiSaleWord = text => { const m = String(text || '').match(AI_SALE); return m ? m[0] : ''; };
// Our brand words in a text (search terms must not hold them: Amazon reads the brand field).
function aiOurBrands(c, text) {
  if (typeof lrBrandWords !== 'function') return [];
  let words = [];
  try { words = lrBrandWords(c.fresh, c.cfg) || []; } catch (e) { words = []; }
  return words.filter(w => (typeof lrFind === 'function' ? lrFind(String(text), w) >= 0 : String(text).toLowerCase().includes(String(w).toLowerCase())));
}
const aiTitleLimits = c => (typeof ttLimits === 'function' ? ttLimits(c.cfg) : { min: 60, max: 75 });
const aiKwMax = c => (typeof lrKwMax === 'function' ? lrKwMax(c.cfg) : 249);

/** OUR RULES ON A SUGGESTION: { pass, fails: [red, Approve disabled], notes: [amber, to look at] }. field: title | kw | bullets | desc | hl |
 *  aplus. o: { season (name), seasonWords, hlMax, word (the risky word that must be gone), keep (the protected phrases of the old text) }. */
function aiCheck(c, field, value, o) {
  o = o || {};
  const fails = [], notes = [];
  const add = (list, s) => { if (s && !list.includes(s)) list.push(s); };
  const text = Array.isArray(value) ? value.join('\n') : String(value == null ? '' : value);
  if (!aiLine(text)) return { pass: false, fails: ['the text is empty'], notes };
  if (field === 'title') {
    const t = aiLine(text);
    const lim = aiTitleLimits(c);
    if (t.length > lim.max) add(fails, `${t.length} characters, over ${lim.max}`);
    if (lim.min && t.length < lim.min) add(fails, `${t.length} characters, under ${lim.min}`);
    // every title rule of Fix all titles (template, size format, length, keyword, brand at the start, risky words, Amazon's limits)
    if (typeof ttCheck === 'function' && c.rows) {
      try { ttCheck(c.brand, c.row, t, c.ctx).fails.forEach(f => add(fails, f)); } catch (e) { add(notes, 'the title rules could not be run here'); }
    } else if (typeof lcCheck === 'function') {
      lcCheck('item_name', [t], { title: t, brand: c.brand, sku: c.sku }).forEach(f => add(f.bad || /Listing Rules|Size/.test(f.msg) ? fails : notes, f.msg));
      // the title safety check (22 Nov 2026, listing-rules.js lrTitleMissing) — ttCheck runs it on the other path
      const was = c.now && c.now.title;
      if (was && typeof lrTitleMissing === 'function') {
        const miss = lrTitleMissing(was, t, {});
        if (miss.length) add(fails, `${typeof LR_BLOCKED === 'string' ? LR_BLOCKED : 'Blocked by the safety check'} — it would lose ${miss.map(w => `"${w}"`).join(', ')}`);
      }
    }
  } else if (field === 'kw') {
    const t = aiLine(text);
    const max = aiKwMax(c);
    const chk = typeof lrKwCheck === 'function' ? lrKwCheck(t, max) : { over: false, bytes: t.length, max };
    if (chk.over) add(fails, `${chk.bytes} bytes, over ${max}`);
    const key = w => (typeof lrSwKey === 'function' ? lrSwKey(w) : w.toLowerCase());
    const words = t.split(/[\s,;]+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, '')).filter(Boolean);
    const inTitle = new Set(String(c.now.title).split(/[^\p{L}\p{N}%]+/u).filter(w => w.length > 2).map(key));
    const dup = [...new Set(words.filter(w => w.length > 2 && inTitle.has(key(w))).map(w => w.toLowerCase()))];
    if (dup.length) add(fails, `already in the title: ${dup.slice(0, 8).join(', ')}`);
    const seen = new Map();
    words.forEach(w => { const k = key(w); if (k && !/^\d/.test(k)) seen.set(k, (seen.get(k) || 0) + 1); });
    const rep = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    if (rep.length) add(fails, `said twice: ${rep.slice(0, 8).join(', ')}`);
    if (/\bB0[A-Z0-9]{8}\b/i.test(t)) add(fails, 'holds an ASIN');
    const ours = aiOurBrands(c, t);
    if (ours.length) add(fails, `our brand name “${ours[0]}” — Amazon reads the brand field, not search terms`);
  } else if (field === 'bullets') {
    const list = (Array.isArray(value) ? value : text.split(/\n+/)).map(aiLine).filter(Boolean);
    if (typeof lcCheck === 'function') lcCheck('bullet_point', list).forEach(f => add(f.bad || /Listing Rules/.test(f.msg) ? fails : notes, f.msg));
    if (list.length < 5) add(fails, `${list.length} bullet${list.length === 1 ? '' : 's'} — 5 are asked for`);
    list.forEach((b, i) => { if (b.length > 500) add(fails, `bullet ${i + 1}: ${b.length} characters — Amazon's limit is 500`); });
  } else if (field === 'desc') {
    if (typeof lcCheck === 'function') lcCheck('product_description', [text]).forEach(f => add(f.bad || /Listing Rules/.test(f.msg) ? fails : notes, f.msg));
    if (text.length > 2000) add(fails, `${text.length} characters — Amazon's limit is 2,000`);
  } else if (field === 'hl') {
    const max = +o.hlMax || 125;
    const t = aiLine(text);
    if (t.length > max) add(fails, `${t.length} characters, over ${max}`);
    const sw = (o.seasonWords && o.seasonWords.length ? o.seasonWords : [o.season]).filter(Boolean);
    if (sw.length && !sw.some(w => (typeof lrHas === 'function' ? lrHas(t, w) : t.toLowerCase().includes(String(w).toLowerCase())))) add(fails, `does not name ${o.season || 'the season'}`);
    // an out-of-season name (the one season-date rule): never added
    const cfg = c.cfg || {};
    const today = new Date();
    (cfg.events || []).forEach(ev => {
      try {
        if (typeof lrSeasonState === 'function' && lrSeasonState(ev, today, cfg.events).expired && typeof lrWords === 'function'
          && lrWords(ev.words).some(w => lrHas(t, w))) add(fails, `names ${ev.name}, which is out of season now`);
      } catch (e) { /* the rule could not be read: the person checks */ }
    });
  }
  if (o.season && field === 'title') {
    const sw = (o.seasonWords && o.seasonWords.length ? o.seasonWords : [o.season]).filter(Boolean);
    if (!sw.some(w => (typeof lrHas === 'function' ? lrHas(text, w) : text.toLowerCase().includes(String(w).toLowerCase())))) add(fails, `does not name ${o.season}`);
  }
  // every field: the protected words of the old text stay (search terms: the ones the title does not already carry)
  if (o.keep && o.keep.length) {
    let keep = o.keep;
    if (field === 'kw') { const tk = new Set(aiProtected(c.now.title, 'title', c.facts).flatMap(p => p.keys)); keep = keep.filter(p => p.keys.some(k => !tk.has(k))); }
    const lost = aiLost(keep, text);
    if (lost.length) add(fails, `leaves out a protected word: ${lost.slice(0, 5).map(w => '“' + w + '”').join(', ')}`);
  }
  // every field: no other brand's name and no restricted claim (IP & Trademark Guard), no sale word
  if (field !== 'title' || !(typeof ttCheck === 'function' && c.rows)) aiRisk(c, text).forEach(f => add(fails, f));
  const sale = aiSaleWord(text);
  if (sale) add(fails, `sale word “${sale}”`);
  if (o.word && (typeof ipgKeyOf === 'function' && typeof ipgFind === 'function'
    ? ipgFind(text, c.cfg).some(x => x.k === ipgKeyOf(o.word)) : text.toLowerCase().includes(String(o.word).toLowerCase()))) add(fails, `still holds “${o.word}”`);
  return { pass: !fails.length, fails, notes };
}

/* ============================================================================================
 * 3. THE BUTTONS (drawn by each screen) AND THE CARDS (drawn here)
 * ============================================================================================ */
/** A ✨ button. task: one of AI_TASKS. o: { label, use: lc | tt | kf | send | ipg | copy | read, field, key (a Fix all row), season,
 *  swords (the season's words), hlmax, word, code, place: row (a table row is added under the button's row) | block (inside the closest
 *  [data-ai-block]) | after (after the button's parent — the default), screen }. Never makes a call: a click does. */
function aiBtnHtml(task, brand, sku, o) {
  if (!aiOn()) return '';                   // AI not set up: no button, the page as it always was
  o = o || {};
  const x = {};
  ['use', 'field', 'key', 'season', 'swords', 'hlmax', 'word', 'wk', 'code', 'place', 'screen', 'asin', 'd', 'pt', 'match', 'product', 'at', 'fieldName', 'brands', 'into'].forEach(k => { if (o[k] != null && o[k] !== '') x[k] = o[k]; });
  const off = AI.off ? ' is-off' : '';
  const tip = AI.off ? AI.why : (o.tip || 'Claude suggests; our rules check it; nothing is sent until you approve');
  return `<button type="button" class="ghost im-b ai-btn${off}" data-ai="${aiEsc(task)}" data-ai-b="${aiEsc(brand)}" data-ai-s="${aiEsc(sku || '')}" data-ai-x="${aiEsc(JSON.stringify(x))}" title="${aiEsc(tip)}">✨ ${aiEsc(o.label || 'AI ' + (AI_WHAT[task] || task))}</button>`;
}
// The button's facts back: { task, brand, sku, x }.
function aiBtnOf(btn) {
  let x = {};
  try { x = JSON.parse(btn.dataset.aiX || '{}') || {}; } catch (e) { x = {}; }
  return { task: btn.dataset.ai, brand: btn.dataset.aiB === 'CPC' ? 'CPC' : 'SP', sku: btn.dataset.aiS || '', x };
}
// The field a job writes: title | bullets | desc | kw | hl | aplus | explain | image.
function aiFieldOf(task, x) {
  if (AI_PAGE.includes(task)) return 'page';
  if (task === 'description') return 'desc';
  if (task === 'season') return x.field === 'title' ? 'title' : 'hl';
  if (task === 'aplus_text') return 'aplus';
  if (task === 'error_explain') return 'explain';
  if (task === 'image_check') return 'image';
  if (task === 'ip_rewrite') return x.field || 'title';
  return task;
}
// The text of a field now: Listing Content's boxes (what the person sees there), else the freshest data (live read / ListingMatch).
function aiBefore(c, field, use) {
  if (use === 'lc' && typeof lcNow === 'function' && typeof LE !== 'undefined' && LE) {
    try {
      if (field === 'title') return lcNow('item_name')[0] || '';
      if (field === 'bullets') return lcNow('bullet_point');
      if (field === 'desc') return lcNow('product_description').join('\n');
      if (field === 'kw') return lcNow('generic_keyword').join(' ');
    } catch (e) { /* the box is not drawn: the cache's text */ }
  }
  if (field === 'bullets') return c.now.bullets;
  if (field === 'hl') return c.now.hl.join(' · ');
  return field === 'title' ? c.now.title : field === 'desc' ? c.now.desc : field === 'kw' ? c.now.kw : '';
}
// The words aiAsk sends (rule words only): protected words, words to avoid, the template order, the limits.
function aiOptsFor(task, field, c, x, before) {
  const mode = field === 'kw' ? 'kw' : field === 'hl' ? 'hl' : 'title';
  const words = aiProtected(field === 'kw' || field === 'title' || field === 'hl' ? (Array.isArray(before) ? before.join(' ') : before) : c.now.title, mode, c.facts).map(p => p.text);
  const o = { words, avoid: aiAvoid(c), field: task === 'season' || task === 'ip_rewrite' ? x.field : '' };
  if (field === 'title') {
    o.max = aiTitleLimits(c).max;
    try { const tpl = typeof lrTemplateFor === 'function' ? lrTemplateFor(c.row, c.cfg) : null; if (tpl && tpl.template) o.tpl = tpl.template; } catch (e) { /* the backend's default order */ }
  }
  if (field === 'kw') o.max = aiKwMax(c);
  if (task === 'season') { o.season = x.season; o.hlmax = x.hlmax; }
  if (task === 'ip_rewrite') o.word = x.word;
  if (task === 'error_explain') o.code = x.code;
  if (x.asin) o.asin = x.asin;
  if (AI_STYLED.includes(task)) o.style = aiStyleParam(c.pt);           // the approved house style of its product type, if any
  return o;
}
// Where a card goes: a row under the button's table row, inside its block, or after the button's parent.
function aiPlace(btn, id, x) {
  const doc = btn.ownerDocument || document;
  let host = doc.querySelector(`[data-ai-card="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`);
  if (host) return host;
  const tr = x.place === 'row' && btn.closest ? btn.closest('tr') : null;
  const div = doc.createElement('div');
  div.className = 'ai-card';
  div.dataset.aiCard = id;
  if (tr && tr.parentNode) {
    const row = doc.createElement('tr');
    row.className = 'ai-tr';
    const td = doc.createElement('td');
    td.colSpan = tr.children ? tr.children.length : 1;
    td.appendChild(div);
    row.appendChild(td);
    tr.parentNode.insertBefore(row, tr.nextSibling);
    return div;
  }
  // a card at the top of a named box (Bought Together: the report under its toolbar)
  const into = x.place === 'into' && x.into && doc.getElementById ? doc.getElementById(x.into) : null;
  if (into) { into.insertBefore(div, into.firstChild || null); return div; }
  const block = x.place === 'block' && btn.closest ? btn.closest('[data-ai-block]') : null;
  if (block) { block.appendChild(div); return div; }
  const after = btn.parentNode;
  if (after && after.parentNode) after.parentNode.insertBefore(div, after.nextSibling);
  else if (after) after.appendChild(div);
  return div;
}

/** A click on a ✨ button: one aiAsk, then the card — the old text beside the AI's, our checks, the one action. */
async function aiOpen(btn) {
  const { task, brand, sku, x } = aiBtnOf(btn);
  const id = [task, brand, sku, x.field || '', x.key || '', x.season || '', x.word || '', x.code || ''].join('|');
  const host = aiPlace(btn, id, x);
  if (AI.jobs.has(id) && AI.jobs.get(id).busy) return null;
  // not set up yet / the month's limit reached: a calm grey line, no call
  if (AI.off) { host.innerHTML = aiQuietHtml(AI.why); return null; }
  const c = aiCtx(brand, sku);
  const field = aiFieldOf(task, x);
  const use = x.use || 'send';
  const job = { id, task, brand, sku, x, use, field, c, busy: true, before: aiBefore(c, field, use) };
  AI.jobs.set(id, job);
  host.innerHTML = '<div class="ai-wait muted">✨ Asking the AI… nothing changes on Amazon.</div>';
  if (btn.disabled !== undefined) btn.disabled = true;
  const reply = await aiAsk(task, brand, sku, field === 'page' ? aiPageOpts(task, brand, sku, x) : aiOptsFor(task, field, c, x, job.before));
  if (btn.disabled !== undefined) btn.disabled = false;
  job.busy = false;
  job.reply = reply;
  if (!reply.ok) { host.innerHTML = /not set up|limit reached/i.test(reply.reason) ? aiQuietHtml(reply.reason) : aiFailHtml(job, reply.reason); return reply; }
  job.text = aiTextOf(job, reply.result || {});
  job.keep = field === 'aplus' || field === 'explain' || field === 'image' || field === 'page' ? [] : aiProtected(Array.isArray(job.before) ? job.before.join(' ') : job.before,
    field === 'kw' ? 'kw' : field === 'hl' ? 'hl' : 'title', c.facts);
  if (field === 'bullets' || field === 'desc') job.keep = [];      // a rewrite of the bullets / description keeps the facts, not each word
  aiRecheck(job);
  host.innerHTML = aiCardHtml(job);
  return reply;
}
// The AI's text of a job, in the field's shape (bullets: a list; ip_rewrite of a bullet: the whole list with that bullet rewritten).
function aiTextOf(job, r) {
  if (job.task === 'title') return r.title || '';
  if (job.task === 'bullets') return (r.bullets || []).slice();
  if (job.task === 'description') return r.description || '';
  if (job.task === 'kw') return r.kw || '';
  if (job.task === 'season') return r.text || '';
  if (job.task === 'aplus_text') return [r.headline].concat((r.blocks || []).map(b => (b.heading ? b.heading + '\n' : '') + b.body)).filter(Boolean).join('\n\n');
  if (job.task === 'ip_rewrite') {
    if (job.field === 'bullets') { const list = job.c.now.bullets.slice(); list[r.index || 0] = r.text; return list; }
    if (job.field === 'hl') { const list = job.c.now.hl.slice(); list[r.index || 0] = r.text; return list.join(' · '); }
    return r.text || '';
  }
  return '';
}
// The checks of a job's text as it stands (the card's box may have been edited).
function aiRecheck(job) {
  if (job.field === 'explain' || job.field === 'image' || job.field === 'page') { job.chk = { pass: true, fails: [], notes: [] }; return job.chk; }
  const o = { keep: job.keep, word: job.task === 'ip_rewrite' ? job.x.wk || job.x.word : '', season: job.task === 'season' ? job.x.season : '', seasonWords: job.x.swords || [],
    hlMax: job.x.hlmax };
  job.chk = aiCheck(job.c, job.field === 'aplus' ? 'aplus' : job.field, job.text, o);
  return job.chk;
}
const aiQuietHtml = why => `<div class="ai-quiet">✨ ${aiEsc(why || 'AI not set up yet')}${/limit/i.test(why || '') ? ' — the buttons work again next month.' : ' — the buttons start working once the backend has the key.'}${aiUsedLine() ? ` <small>${aiEsc(aiUsedLine())}</small>` : ''}</div>`;
const aiFailHtml = (job, why) => `<div class="ai-quiet is-bad">✨ ${aiEsc(why)} <button type="button" class="ghost im-b" data-ai-act="close" data-ai-id="${aiEsc(job.id)}">Close</button></div>`;
// A text for the card, with the words that came in marked (the same diff every suggestion shows).
function aiMarkHtml(before, after) {
  const b = Array.isArray(before) ? before.join('\n') : String(before || '');
  const a = Array.isArray(after) ? after.join('\n') : String(after || '');
  if (typeof sqWordDiff === 'function' && typeof ttMark === 'function') {
    try { const d = sqWordDiff(b, a); return ttMark(a, d.added || [], 'tt-add'); } catch (e) { /* plain */ }
  }
  return aiEsc(a);
}
const aiLen = (field, v) => (field === 'kw' ? `${typeof lrKwBytes === 'function' ? lrKwBytes(String(v || '')) : String(v || '').length} bytes`
  : field === 'bullets' ? `${(v || []).length} bullets` : `${String(v || '').length} characters`);
// The action of a card, by where it came from.
function aiActHtml(job) {
  const dis = job.chk.pass ? '' : ' disabled';
  const tip = job.chk.pass ? '' : ` title="${aiEsc('Fix what is red first: ' + job.chk.fails.join(' · '))}"`;
  if (job.field === 'explain' || job.field === 'image') return '';
  if (job.field === 'aplus') return `<button type="button" class="sp-main" data-ai-act="copy" data-ai-id="${aiEsc(job.id)}"${dis}${tip}>Copy A+ text</button><span class="muted ai-hint">A+ is made in Seller Central → A+ Content Manager; paste it there.</span>`;
  if (job.use === 'lc') return `<button type="button" class="sp-main" data-ai-act="use" data-ai-id="${aiEsc(job.id)}"${dis}${tip}>Use AI version</button><span class="muted ai-hint">Fills the box above — Check and Apply as always.</span>`;
  if (job.use === 'tt' || job.use === 'kf') return `<button type="button" class="sp-main" data-ai-act="use" data-ai-id="${aiEsc(job.id)}"${dis}${tip}>Use AI version</button><span class="muted ai-hint">Puts it in this row — then Check with Amazon &amp; send as always.</span>`;
  if (job.use === 'ipg' && (job.field === 'title' || job.field === 'kw')) return `<button type="button" class="sp-main" data-ai-act="use" data-ai-id="${aiEsc(job.id)}"${dis}${tip}>Use in Fix all ${job.field === 'kw' ? 'search terms' : 'titles'}</button>`;
  return `<button type="button" class="sp-main" data-ai-act="approve" data-ai-id="${aiEsc(job.id)}"${dis}${tip}>Approve &amp; send</button><span class="muted ai-hint">Amazon checks it first; you see before → after.</span>`;
}
// The checks, as the suggestions show them: ✓ passes / ✕ red reasons, and amber notes.
const aiChkHtml = chk => `<div class="tt-chk ai-chk${chk.pass ? '' : ' is-bad'}" data-ai-chk>${chk.pass ? '✓ Passes every rule we check' : '✕ ' + aiEsc(chk.fails.join(' · '))}</div>`
  + (chk.notes.length ? `<div class="ai-note">• ${aiEsc(chk.notes.join(' · '))}</div>` : '');
/** One card: old and AI side by side, the checks, the action, the cost. */
function aiCardHtml(job) {
  const r = (job.reply && job.reply.result) || {};
  const close = `<button type="button" class="sp-x ai-x" data-ai-act="close" data-ai-id="${aiEsc(job.id)}" aria-label="Close">×</button>`;
  const cost = job.reply ? [job.reply.cached ? 'kept answer, no cost' : job.reply.costUsd != null ? aiUsd(job.reply.costUsd) + ' this answer' : '', aiUsedLine()].filter(Boolean).join(' · ') : '';
  const AI_HEAD = { fix_first: 'Fix these first', title_template: 'title template draft', bsr_why: 'why the rank changed', category_suggest: 'category suggestion', change_result: 'did this change work?', bundle_ideas: 'bundle ideas' };
  const what = AI_HEAD[job.task] || (job.task === 'season' ? (job.x.season || '') + ' ' + (job.field === 'title' ? 'title' : 'Item Highlights') : AI_WHAT[job.task] || job.task);
  const head = `<div class="ai-h"><b>✨ AI ${aiEsc(what)}</b>${close}</div>`;
  const styled = AI_STYLED.includes(job.task) ? aiStyleLine(job) + ' · ' : '';      // PART 2: which house style it follows
  const foot = `<div class="ai-foot muted">${aiEsc(styled)}${job.reply && job.reply.why ? aiEsc(job.reply.why) + ' · ' : ''}${aiEsc(cost)}</div>`;
  if (job.field === 'page') return head + `<div class="ai-exp">${aiPageCardHtml(job)}</div>` + foot;
  if (job.field === 'explain') {
    return head + `<div class="ai-exp"><p>${aiEsc(r.plain)}</p>${r.fix ? `<p><b>Fix:</b> ${aiEsc(r.fix)}</p>` : ''}${r.screen ? `<p class="muted">Where: ${aiEsc(r.screen)}</p>` : ''}</div>` + foot;
  }
  if (job.field === 'image') {
    const line = (ok, t) => `<li class="sp-chk ${ok ? 'is-ok' : 'is-no'}"><i>${ok ? '✓' : '✕'}</i>${aiEsc(t)}</li>`;
    return head + `<div class="ai-img">${r.image ? `<img src="${aiEsc(r.image)}" alt="Main picture" loading="lazy">` : ''}<div><div class="ai-verdict ${r.pass ? 'is-ok' : 'is-bad'}">${r.pass ? '✓ Main photo passes' : '✕ Main photo needs work'}</div>`
      + `<ul class="sp-checks">${line(r.white_background, 'White background')}${line(!r.text_or_watermark, 'No text, logo or watermark')}${line(r.fills_frame, `Product fills the frame (about ${Math.round(r.fill_pct || 0)}% — 85% asked)`)}</ul>`
      + `${r.notes ? `<p class="muted">${aiEsc(r.notes)}</p>` : ''}<p class="muted ai-hint">Read only — nothing changes. Replace the picture in Your stack below if it needs work.</p></div></div>` + foot;
  }
  const rows = job.field === 'bullets' ? 7 : job.field === 'desc' || job.field === 'aplus' ? 8 : 2;
  const val = Array.isArray(job.text) ? job.text.join('\n') : job.text;
  const oldTxt = Array.isArray(job.before) ? job.before.map((b, i) => `${i + 1}. ${b}`).join('\n') : job.before;
  const oldCol = job.field === 'aplus' ? '' : `<div class="ai-col"><small>Now · ${aiEsc(aiLen(job.field, job.before))}</small><div class="tt-old ai-txt">${aiEsc(oldTxt) || '<span class="muted">(none)</span>'}</div></div>`;
  return head + `<div class="ai-ba${job.field === 'aplus' ? ' is-one' : ''}">${oldCol}`
    + `<div class="ai-col"><small>✨ AI · <span data-ai-n>${aiEsc(aiLen(job.field, job.text))}</span></small><div class="tt-new ai-txt" data-ai-new>${aiMarkHtml(job.before, job.text)}</div>`
    + `<details class="kf-ed"><summary>Edit the AI text</summary><textarea data-ai-edit="${aiEsc(job.id)}" rows="${rows}" spellcheck="false">${aiEsc(val)}</textarea>${job.field === 'bullets' ? '<small class="muted">One bullet per line.</small>' : ''}</details></div></div>`
    + `<div data-ai-chks>${aiChkHtml(job.chk)}</div><div class="ai-a">${aiActHtml(job)}</div>` + foot;
}
// The card follows an edit of the AI text: its length, its checks, its button (the box being typed in keeps its place).
function aiEdited(el) {
  const job = AI.jobs.get(el.dataset.aiEdit);
  if (!job) return null;
  const raw = String(el.value || '');
  job.text = job.field === 'bullets' ? raw.split(/\n+/).map(aiLine).filter(Boolean) : job.field === 'desc' || job.field === 'aplus' ? raw.trim() : aiLine(raw);
  aiRecheck(job);
  const card = el.closest ? el.closest('[data-ai-card]') : null;
  if (!card) return null;
  const n = card.querySelector('[data-ai-n]');
  if (n) n.textContent = aiLen(job.field, job.text);
  const nw = card.querySelector('[data-ai-new]');
  if (nw) nw.innerHTML = aiMarkHtml(job.before, job.text);
  const chks = card.querySelector('[data-ai-chks]');
  if (chks) chks.innerHTML = aiChkHtml(job.chk);
  const act = card.querySelector('.ai-a');
  if (act) act.innerHTML = aiActHtml(job);
  return null;
}

/* ============================================================================================
 * 4. THE ACTIONS — into the existing flows, never a send of its own
 * ============================================================================================ */
// Remember that this text came from the AI (Listing History marks the send "AI suggested"; listing-send-check.js asks aiWasUsed).
function aiMarkUsed(brand, sku, value) {
  const k = brand + '|' + sku;
  if (!AI.used.has(k)) AI.used.set(k, new Set());
  const set = AI.used.get(k);
  (Array.isArray(value) ? [value.join(' · '), ...value] : [value]).forEach(v => { const s = aiLine(v); if (s) set.add(s); });
}
/** FOR listing-send-check.js: was this new value one the AI suggested for this listing (as approved, maybe edited in the card)? */
function aiWasUsed(brand, sku, value) {
  const set = AI.used.get(brand + '|' + sku);
  if (!set || !set.size) return false;
  const v = aiLine(value);
  return !!v && (set.has(v) || [...set].some(s => s.length > 20 && v.includes(s)));
}
// An attribute's values for a patch: [{ value, language_tag }].
const aiVals = (field, v) => (field === 'bullets' ? v : field === 'hl' ? String(v).split(/\s+·\s+/) : [v]).map(value => ({ value: String(value), language_tag: 'en_US' }));
/** Approve & send: THE ONE SEND PATH (Amazon's check → send → read again → Listing History "AI suggested" → Put back). */
function aiApprove(job) {
  if (!job.chk || !job.chk.pass || typeof sqSendWithCheck !== 'function') return null;
  const attr = AI_ATTR[job.field];
  if (!attr) return null;
  if (!job.c.pt) { aiSay(job, 'The product type of this listing is not known yet — open it in Listing Errors first.'); return null; }
  const before = job.field === 'bullets' ? job.before : job.field === 'hl' ? job.c.now.hl : [job.before];
  const oldV = (before || []).filter(v => v !== '').map(value => ({ value: String(value), language_tag: 'en_US' }));
  const value = aiVals(job.field, job.text);
  aiMarkUsed(job.brand, job.sku, job.text);
  const screen = job.x.screen || AI_SCREEN[job.use] || AI_SCREEN.send;
  const sqv = v => (typeof sqValText === 'function' ? sqValText(v) : v.map(x => x.value).join(' · '));
  return sqSendWithCheck([{ brand: job.brand, sku: job.sku, asin: job.c.asin, label: job.c.now.title || job.sku,
    body: { lfix: 'patch', brand: job.brand, sku: job.sku, productType: job.c.pt, patches: [{ op: 'replace', path: '/attributes/' + attr, value }] },
    changes: [{ field: typeof sqField === 'function' ? sqField(attr) : attr, old: sqv(oldV), new: sqv(value), attr, oldV }] }], {
    screen, title: `${screen} · ${job.sku}`,
    onDone: sum => { aiSay(job, typeof sqSummaryText === 'function' ? sqSummaryText(sum) : ''); if (typeof ipgAfterSend === 'function') ipgAfterSend(); } });
}
// A line under a card's button.
function aiSay(job, text) {
  const card = typeof document !== 'undefined' && document.querySelector ? document.querySelector(`[data-ai-card="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(job.id) : job.id}"]`) : null;
  const a = card && card.querySelector('.ai-a');
  if (a && text) a.insertAdjacentHTML('beforeend', `<div class="ai-said">${aiEsc(text)}</div>`);
}
/** Use AI version: into the screen it came from — Listing Content's box, a Fix all row, or the Fix all popup of IP & Trademark Guard. */
function aiUse(job) {
  if (!job.chk || !job.chk.pass) return null;
  aiMarkUsed(job.brand, job.sku, job.text);
  if (job.use === 'lc') return aiUseLc(job);
  if (job.use === 'tt' || job.use === 'kf') return aiUseRow(job.use, job.x.key, job.text);
  if (job.use === 'ipg') {
    const ai = new Map([[job.sku, job.text]]);
    if (job.field === 'title' && typeof ttStartList === 'function') return ttStartList(job.brand, [job.sku], { title: job.sku, parent: '', extra: new Map([[job.sku, [`Risky word: ${job.x.word || ''}`]]]), ai });
    if (job.field === 'kw' && typeof kfPreview === 'function' && typeof kfItemOf === 'function') {
      const item = kfItemOf(job.brand, job.c.row, job.c.ctx, null);
      return kfPreview([item], { title: job.sku, row: 'ipkw', name: 'Risky words in search terms', brand: job.brand, parent: '', ai });
    }
  }
  return null;
}
// Listing Content: the AI text into its box, as if typed there (its checks and Check / Apply follow).
function aiUseLc(job) {
  if (typeof $ !== 'function') return null;
  const fire = el => { if (el && typeof el.oninput === 'function') el.oninput(); };
  if (job.field === 'title' && $('lcTitle')) { $('lcTitle').value = job.text; fire($('lcTitle')); }
  else if (job.field === 'desc' && $('lcDesc')) { $('lcDesc').value = job.text; fire($('lcDesc')); }
  else if (job.field === 'kw' && $('lcKw')) { $('lcKw').value = job.text; fire($('lcKw')); }
  else if (job.field === 'bullets') {
    const boxes = [...document.querySelectorAll('.lcBullet')];
    if (typeof LC_EXTRA !== 'undefined' && boxes.length < job.text.length && typeof lcSetVals === 'function') {
      lcSetVals('bullet_point', job.text);
      if (typeof leFixRender === 'function') leFixRender();
      return null;
    }
    boxes.forEach((box, i) => { box.value = job.text[i] || ''; });
    fire(boxes[0]);
  }
  aiSay(job, '✓ In the box above — press Check with Amazon, then Apply.');
  return null;
}
/** A Fix all popup's row takes the AI text as its edit (a held row becomes a row to send, if it can be sent). kind: tt | kf. */
function aiUseRow(kind, key, text) {
  const run = kind === 'tt' ? (typeof TT !== 'undefined' && TT.run) : (typeof KF !== 'undefined' && KF.run);
  if (!run || run.closed) return null;
  const p = run.plans.find(x => x.key === key);
  if (!p) return null;
  aiIntoPlan(kind, run, p, text);
  if (kind === 'tt' && typeof ttDraw === 'function') ttDraw();
  if (kind === 'kf' && typeof kfDraw === 'function') kfDraw();
  return null;
}
// One plan of a Fix all popup with the AI text in it, ticked.
function aiIntoPlan(kind, run, p, text) {
  if (!p.ok) {
    const m = (typeof lmGet === 'function' && lmGet(p.sku, p.brand)) || {};
    const pt = p.pt || m.pt || '';
    if (!pt) return false;
    if (kind === 'tt') Object.assign(p, { ok: true, pt, oldTitle: p.oldTitle || p.before, fixes: p.fixes || ['AI version'], notes: p.notes || [], src: p.src || {}, dropped: p.dropped || [],
      lim: p.lim || (typeof ttLimits === 'function' ? ttLimits(run.ctx.cfg) : { max: 75 }), after: p.after || p.before, ai: true });
    else Object.assign(p, { ok: true, pt, removed: p.removed || [], toks: p.toks || [], ai: true });
  }
  run.edit.set(p.key, text);
  if (run.chk) run.chk.delete(p.key);
  run.sel.add(p.key);
  return true;
}
/** FOR title-fix.js / kw-fix.js: a popup opened with o.ai (Map sku → AI text) starts with those texts as the rows' edits. */
function aiPreset(kind, run) {
  const ai = run && run.o && run.o.ai;
  if (!ai || !ai.size) return;
  run.plans.forEach(p => { if (ai.has(p.sku)) { aiIntoPlan(kind, run, p, ai.get(p.sku)); aiMarkUsed(p.brand, p.sku, ai.get(p.sku)); } });
}
// Copy the A+ text.
function aiCopy(job, btn) {
  if (!job.chk.pass) return null;
  const text = Array.isArray(job.text) ? job.text.join('\n') : job.text;
  const done = () => { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy A+ text'; }, 1500); };
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => aiSay(job, 'The browser would not copy it — select the text in the box instead.'));
  return null;
}

/* ----- Listing Optimiser: the whole listing, one click (four answers: title, bullets, description, search terms) ----- */
/** The Optimiser review's card: one button that asks for all four, each with its own card and its own Approve. */
function aiOptCardHtml(brand, sku) {
  if (!sku || !aiOn()) return '';
  return `<div class="card ai-opt" style="padding:12px 14px;margin-bottom:12px" data-ai-block><div class="sec" style="margin-top:0">✨ AI rewrite</div>`
    + `<div class="muted" style="font-size:12px;margin-bottom:6px">Claude rewrites the title, bullets, description and search terms from this listing's own facts and the words customers bought through. Our rules check each one; nothing is sent until you approve it.</div>`
    + `<button type="button" class="ghost im-b ai-btn${AI.off ? ' is-off' : ''}" data-ai-all="${aiEsc(brand)}|${aiEsc(sku)}" title="${aiEsc(AI.off ? AI.why : 'Four AI answers, one after another')}">✨ AI rewrite of the whole listing</button></div>`;
}
async function aiOptAll(btn) {
  const [brand, sku] = String(btn.dataset.aiAll || '').split('|');
  const tasks = [['title', 'AI title'], ['bullets', 'AI bullets'], ['description', 'AI description'], ['kw', 'AI search terms']];
  const block = btn.closest ? btn.closest('[data-ai-block]') : null;
  btn.disabled = true;
  for (const [task, label] of tasks) {
    const doc = btn.ownerDocument || document;
    const holder = doc.createElement('div');
    holder.className = 'ai-optf';
    holder.innerHTML = aiBtnHtml(task, brand, sku, { use: 'send', label, place: 'after', screen: 'Listing Optimiser' });
    if (block) block.appendChild(holder);
    const b = holder.querySelector('[data-ai]');
    b.style.display = 'none';
    const reply = await aiOpen(b);
    if (reply && !reply.ok && /not set up|limit reached/i.test(reply.reason || '')) break;
  }
  btn.disabled = false;
  return null;
}


/* ============================================================================================
 * 5. PART 2 (20 Nov 2026) — the house style, and the read-only answers of the Listing pages
 * ============================================================================================ */
const AI_PAGE = ['fix_first', 'title_template', 'bsr_why', 'category_suggest', 'change_result', 'bundle_ideas'];
const AI_STYLE_DOC = 'aistyle';                 // listingrules/aistyle: { items: { PT: { at (the guide's date), approvedAt, by, name } } }
const AI_DAY = 86400000;
const AI_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const aiDay = ms => (ms ? AI_DATE.format(new Date(ms)) : '');
const aiPtWord = pt => String(pt || '').toLowerCase().replace(/_/g, ' ');

/* ----- the house style: approvals (Listing Rules' own store), the guides (the backend's lmAiStyle tab) ----- */
/** The approved guides, read once (listingrules/aistyle, the store Listing Rules' marks use): AI.styleOk = { PT: { at, approvedAt, name } }. */
async function aiStyleOkLoad() {
  if (AI.styleOkP) return AI.styleOkP;
  AI.styleOkP = (async () => {
    try { const d = typeof lsGet === 'function' ? await lsGet('listingrules', AI_STYLE_DOC) : null; AI.styleOk = (d && d.items) || {}; } catch (e) { AI.styleOk = {}; }
    return AI.styleOk;
  })();
  return AI.styleOkP;
}
// &style= for a writing task: "<PT>@<the approved guide's date>", or '' (no approved guide: the task works as before).
function aiStyleParam(pt) {
  const k = String(pt || '').toUpperCase();
  const ok = AI.styleOk && AI.styleOk[k];
  return ok && ok.at ? `${k}@${ok.at}` : '';
}
// The card's grey line: "Follows: tablecloth house style (approved 20 Nov)" / "No house style yet".
function aiStyleLine(job) {
  const st = job.reply && job.reply.style;
  if (st && st.pt) { const ok = (AI.styleOk || {})[st.pt] || {}; return `Follows: ${aiPtWord(st.pt)} house style (approved ${aiDay(ok.approvedAt || st.at)})`; }
  return 'No house style yet';
}
/** Listing Rules → "AI house style" (shown only when AI is set up): opens to the guides, each with Approve; "Learn again". */
function aiStyleSectionHtml() {
  if (!aiOn()) return '';
  return '<details class="lr-allow-sec ai-style" data-ai-style><summary><b>✨ AI house style</b><span class="muted"> — how our listings are written, learnt from every listing; '
    + 'only an approved guide is used by the AI suggestions</span></summary><div class="ai-style-b" data-ai-style-b><span class="muted">Open to read the guides.</span></div></details>';
}
async function aiStyleLoad(box) {
  if (!box) return null;
  box.innerHTML = '<span class="muted">Reading the house style guides…</span>';
  let reply;
  try { reply = await aiGet({ ai: 'ask', task: 'style_get' }); } catch (e) { reply = { ok: false, reason: String((e && e.message) || e) }; }
  await aiStyleOkLoad();
  AI.styleTab = reply && reply.ok ? reply : null;
  box.innerHTML = aiStyleBodyHtml(AI.styleTab, reply && !reply.ok ? reply.reason || reply.error : '');
  return reply;
}
function aiStyleBodyHtml(r, err) {
  if (err) return `<div class="ai-quiet">${aiEsc(err)}</div>`;
  const tab = (r && r.style) || {};
  const guides = Object.values(tab.guides || {}).sort((a, b) => (b.n || 0) - (a.n || 0));
  const L = r && r.learning;
  const state = L && !L.finished && !L.stopped ? `Learning now: ${L.done} of ${L.of} product types done` : tab.stopped ? aiEsc(tab.stopped)
    : tab.finishedAt ? `Learnt ${aiDay(tab.finishedAt)} from ${Number(tab.read || 0).toLocaleString('en-US')} listings · ${aiUsd(tab.costUsd || 0)}` : 'Not learnt yet — Umesh runs aiLearnStyle() once in the Apps Script editor';
  const head = `<div class="ai-style-h"><span class="muted">${state}</span> <button type="button" class="ghost im-b" data-ai-style-act="learn" title="Reads every listing again and writes new draft guides (checked against the month's AI limit first)">Learn again</button></div>`;
  if (!guides.length) return head;
  return head + guides.map(g => {
    const ok = (AI.styleOk || {})[g.pt];
    const approved = ok && String(ok.at) === String(g.at);
    const gd = g.guide || {};
    return `<div class="ai-style-g"><div class="ai-style-gh"><b>${aiEsc(aiPtWord(g.pt))}</b><span class="muted"> · ${Number(g.n || 0).toLocaleString('en-US')} listings read · ${Number(g.good || 0).toLocaleString('en-US')} good examples · ${aiDay(g.at)}</span>`
      + (approved ? `<span class="fc-chip is-g">Approved ${aiDay(ok.approvedAt)}${ok.name ? ' · ' + aiEsc(ok.name) : ''}</span>`
        : `<button type="button" class="ghost im-b" data-ai-style-act="ok" data-ai-style-pt="${aiEsc(g.pt)}" data-ai-style-at="${aiEsc(g.at)}">Approve</button>`) + '</div>'
      + `<ul class="ai-style-l"><li><b>Title:</b> ${aiEsc(gd.title_pattern)} <span class="muted">(${aiEsc(gd.title_length)})</span></li><li><b>Size:</b> ${aiEsc(gd.size_style)}</li>`
      + `<li><b>Colour, shape, material:</b> ${aiEsc(gd.colour_shape_material)}</li><li><b>Bullets:</b> ${aiEsc((gd.bullets || []).join(' · '))}</li><li><b>Description:</b> ${aiEsc(gd.description)}</li>`
      + `<li><b>Always:</b> ${aiEsc((gd.always || []).join(', '))} · <b>Never:</b> ${aiEsc((gd.never || []).join(', '))}</li><li><b>Our best titles:</b> ${aiEsc((gd.examples || []).join(' | '))}</li></ul></div>`;
  }).join('');
}
async function aiStyleApprove(pt, at, box) {
  const by = (typeof ME !== 'undefined' && ME && ME.email) || '';
  const name = typeof sqName === 'function' ? sqName(by) : by;
  const item = { at: Number(at), approvedAt: Date.now(), by, name };
  try { if (typeof lsSave === 'function') await lsSave('listingrules', AI_STYLE_DOC, { items: { [pt]: item } }); } catch (e) { if (box) box.insertAdjacentHTML('beforeend', `<div class="err">Not saved: ${aiEsc(e.message || e)}</div>`); return null; }
  AI.styleOk = Object.assign({}, AI.styleOk || {}, { [pt]: item });
  if (box) box.innerHTML = aiStyleBodyHtml(AI.styleTab, '');
  return item;
}
async function aiStyleLearn(box) {
  const by = (typeof ME !== 'undefined' && ME && ME.email) || '';
  const r = await aiGet({ ai: 'ask', task: 'learn_style', by });
  const line = r && r.ok ? (r.running ? 'Already learning — this list follows when it is done.' : `Learning started: ${Number(r.listings || 0).toLocaleString('en-US')} listings, ${r.productTypes} product types, about ${aiUsd(r.estimateUsd)}. It runs on the backend; open this again in a few minutes.`)
    : (r && (r.reason || r.error)) || 'Could not start';
  if (box) box.insertAdjacentHTML('afterbegin', `<div class="ai-said">${aiEsc(line)}</div>`);
  return r;
}

/* ----- the facts a page task sends (numbers, ids, rule names — never listing text) ----- */
/** ✨ Fix these first: the top 20 Critical / Important listings (listing-priority.js order) of the brands on screen. */
function aiFixFirstData(brands) {
  if (typeof prOf !== 'function') return { items: [] };
  const list = [];
  (brands || ['SP', 'CPC']).forEach(b => ((typeof HEALTH !== 'undefined' && HEALTH[b] && HEALTH[b].rows) || []).forEach(row => {
    const p = prOf(b, row.sku, [], { row });
    if (p.k === 'crit' || p.k === 'imp') list.push({ b, row, p });
  }));
  const top = prSort(list, x => ({ k: x.p.k, asin: x.row.asin, stock: x.p.stock })).slice(0, 20);
  AI.fixFirst = new Map(top.map(x => [x.row.sku, x]));
  const words = x => prFound(x.row).filter(h => !h.fill).map(h => h.what || h.name).slice(0, 6);
  return { salesOld: !!prSalesOld(), items: top.map(x => ({ sku: x.row.sku, level: x.p.k, problems: words(x), stock: x.p.stock, live: x.p.live,
    sales: typeof apcSales === 'function' && x.row.asin ? apcSales(x.row.asin) : null, sessions: (typeof apcTraffic === 'function' && x.row.asin && apcTraffic(x.row.asin) || {}).s || null })) };
}
/** ✨ Suggest the right category: the Amazon categories Sellora already reads for the family (each sibling's browse path and its rank
 *  categories, with their ids) — the AI may pick only one of these. */
function aiCatData(brand, sku) {
  const rows = (typeof HEALTH !== 'undefined' && HEALTH[brand] && HEALTH[brand].rows) || [];
  const row = rows.find(r => r.sku === sku) || {};
  const fam = row.parent ? rows.filter(r => r.parent === row.parent) : [row];
  const opts = new Map();
  const add = (id, path) => { id = String(id || ''); if (!/^\d{3,20}$/.test(id)) return; const o = opts.get(id) || { id, path: path || '', n: 0 }; o.n++; if (!o.path && path) o.path = path; opts.set(id, o); };
  fam.forEach(r => {
    const a = r.asin && typeof lmGetAsin === 'function' ? lmGetAsin(r.asin, brand) : null;
    if (!a) return;
    add(a.bcId || (a.bcIds || []).slice(-1)[0], a.bc);
    (a.rks || []).forEach(x => add(x.id, x.c));
  });
  const me = row.asin && typeof lmGetAsin === 'function' ? lmGetAsin(row.asin, brand) : null;
  const m = (typeof lmGet === 'function' && lmGet(sku, brand)) || {};
  return { family: row.parent || '', pt: m.pt || '', colour: (m.va || {}).color || '', size: (m.va || {}).size || '',
    current: me ? { id: me.bcId || '', path: me.bc || '' } : null, options: [...opts.values()].sort((x, y) => y.n - x.n).slice(0, 20) };
}
/** ✨ Did this change work?: 14 days (two weekly rows) before the change and after it — sessions, units, conversion — from the weekly store. */
function aiChangeData(asin, at, field) {
  const W = typeof WEEKLY !== 'undefined' && WEEKLY && WEEKLY.rows ? WEEKLY.rows[String(asin || '').toUpperCase()] || WEEKLY.rows[asin] : null;
  const weeks = W && W.weeks ? Object.keys(W.weeks).sort() : [];
  const ms = w => Date.parse(w) || 0;
  const done = w => ms(w) + 7 * AI_DAY <= Date.now();
  const before = weeks.filter(w => ms(w) && ms(w) + 7 * AI_DAY <= at).slice(-2);
  const after = weeks.filter(w => ms(w) >= at && done(w)).slice(0, 2);
  const sum = list => { let s = 0, u = 0; list.forEach(w => { const c = W.weeks[w] || {}; s += Number(c.sessions) || 0; u += Number(c.u) || 0; }); return { days: list.length * 7, sessions: s, units: u, conv: s ? Math.round(u * 1000 / s) / 10 : null, weeks: list }; };
  return { field: field || '', at: new Date(at).toISOString().slice(0, 10), before: sum(before), after: sum(after) };
}
/** ✨ Bundle ideas: the Market Basket report on the page — our pairs and the others' products bought with ours (ASINs, SKUs, counts). */
function aiBundleData() {
  const r = typeof MB !== 'undefined' ? MB : null;
  if (!r) return {};
  return { ours: (r.pairs || []).slice(0, 25).map(p => ({ asin: p.a + '+' + p.b, name: [p.aSku, p.bSku].filter(Boolean).join(' + '), n: p.n || null, share: p.share || null })),
    others: (r.gaps || []).slice(0, 25).map(g => ({ asin: g.asin, name: (g.with || []).slice(0, 4).map(y => y.sku || y.asin).join(', '), n: g.n || null, share: g.best || null })) };
}

/* ----- the read-only cards of the page tasks ----- */
function aiPageCardHtml(job) {
  const r = (job.reply && job.reply.result) || {};
  const list = items => (items && items.length ? `<ul class="ai-l">${items.map(x => `<li>${aiEsc(x)}</li>`).join('')}</ul>` : '');
  if (job.task === 'fix_first') {
    return `<ol class="ai-ff">${(r.items || []).map(x => { const f = AI.fixFirst && AI.fixFirst.get(x.sku); const k = f ? f.p.k : '';
      return `<li>${typeof prChipHtml === 'function' && k ? prChipHtml(k) : ''}<b class="ui-mono">${aiEsc(x.sku)}</b> — ${aiEsc(x.line)} <button type="button" class="ghost im-b" data-ai-act="fixopen" data-ai-id="${aiEsc(job.id)}" data-ai-sku="${aiEsc(x.sku)}">Open the fix</button></li>`; }).join('')}</ol>`
      + `<p class="muted ai-hint">Read only — each button opens the existing fix; nothing is sent from here.${AI.fixFirstOld ? ' Sales data old: ordered by stock.' : ''}</p>`;
  }
  if (job.task === 'bsr_why') return `<p>${aiEsc(r.summary)}</p>${list(r.reasons)}${r.missing && r.missing.length ? `<p class="muted"><b>Not known:</b> ${aiEsc(r.missing.join(' · '))}</p>` : ''}`;
  if (job.task === 'change_result') return `<p class="ai-verdict ${r.verdict === 'better' ? 'is-ok' : r.verdict === 'worse' ? 'is-bad' : ''}">${aiEsc(r.verdict === 'not enough data yet' ? 'Not enough data yet' : r.verdict === 'better' ? '✓ It worked' : r.verdict === 'worse' ? '✕ It got worse' : 'No clear change')}</p><p>${aiEsc(r.line)}</p>`;
  if (job.task === 'bundle_ideas') {
    return `${r.pairs && r.pairs.length ? '<p><b>Sell together</b></p><ul class="ai-l">' + r.pairs.map(p => `<li>${aiEsc(p.a)} + ${aiEsc(p.b)} — ${aiEsc(p.why)}</li>`).join('') + '</ul>' : ''}`
      + `${r.others && r.others.length ? '<p><b>Bought with ours</b></p><ul class="ai-l">' + r.others.map(o => `<li class="ui-mono">${aiEsc(o.asin)} <span>— ${aiEsc(o.why)}</span></li>`).join('') + '</ul>' : ''}<p class="muted ai-hint">Ideas only — nothing changes.</p>`;
  }
  if (job.task === 'category_suggest') {
    return `<p><b>${aiEsc(r.path || r.id)}</b> <span class="muted ui-mono">${aiEsc(r.id)}</span></p><p>${aiEsc(r.reason)}</p>`
      + `<div class="ai-a"><button type="button" class="sp-main" data-ai-act="catopen" data-ai-id="${aiEsc(job.id)}">Fix it in Listing Errors</button><span class="muted ai-hint">Opens the listing's category there (recommended browse node ${aiEsc(r.id)}); Amazon checks it before it is sent.</span></div>`;
  }
  if (job.task === 'title_template') {
    return `<p class="ui-mono">${aiEsc(r.template)}</p>${r.examples && r.examples.length ? `<p class="muted">From our titles like: ${aiEsc(r.examples.join(' | '))}</p>` : ''}`
      + `<div class="ai-a"><button type="button" class="sp-main" data-ai-act="tplUse" data-ai-id="${aiEsc(job.id)}">Add as a new template</button><span class="muted ai-hint">Adds a row to the table above — check it, then press Save as always. Nothing is saved by itself.</span></div>`;
  }
  return '';
}
// The page task's facts at the click (the button keeps only what the click cannot read again).
function aiPageOpts(task, brand, sku, x) {
  if (task === 'fix_first') { const d = aiFixFirstData(x.brands || [brand]); AI.fixFirstOld = d.salesOld; return { d }; }
  if (task === 'category_suggest') return { d: aiCatData(brand, sku) };
  if (task === 'change_result') return { d: aiChangeData(x.asin, Number(x.at) || 0, x.fieldName) };
  if (task === 'bundle_ideas') return { d: aiBundleData() };
  if (task === 'title_template') return { pt: x.pt, style: aiStyleParam(x.pt) };
  return { d: x.d || {} };
}
// A page task's button press: fix_first → the listing's own fix; a category → Listing Errors with that attribute; a template → Listing Rules' table.
function aiPageAct(act, job, el) {
  const r = (job.reply && job.reply.result) || {};
  if (act === 'fixopen') {
    const f = AI.fixFirst && AI.fixFirst.get(el.dataset.aiSku);
    if (!f || typeof lrFixOpen !== 'function') return null;
    const pic = f.p.problems.some(k => /image|main|picture/.test(k));
    return lrFixOpen(pic ? 'img' : 'lerr', f.b, f.row.sku, []);
  }
  if (act === 'catopen' && typeof lrFixOpen === 'function') return lrFixOpen('lerr', job.brand, job.sku, ['recommended_browse_nodes']);
  if (act === 'tplUse' && r.template && typeof renderLrules === 'function') {
    const cfg = LR || (LR = JSON.parse(JSON.stringify(LR_DEFAULT)));
    const parts = (r.template.match(/\{(\w+)\}/g) || []).map(t => t.slice(1, -1)).filter(k => ['brand', 'product', 'size', 'color'].includes(k));
    cfg.templates.push({ brand: job.brand, match: job.x.match || '', product: job.x.product || '', material: '', pattern: '', uses: '', required: parts.join(','), template: r.template, reference: (r.examples || [])[0] || '' });
    if (typeof LR_DIRTY !== 'undefined') LR_DIRTY = true;
    if (typeof H_CTX !== 'undefined') H_CTX = null;
    renderLrules();
    return null;
  }
  return null;
}
/** Bought Together: the ✨ button beside the report's search box (once), when AI is set up. */
function aiBundleBtn() {
  if (!aiOn() || typeof $ !== 'function' || !$('mbFilter') || ($('mbAiBtn') && $('mbAiBtn').innerHTML)) return;
  const host = $('mbAiBtn') || null;
  const html = aiBtnHtml('bundle_ideas', typeof $('mbBrand') !== 'undefined' && $('mbBrand') && $('mbBrand').value === 'CPC' ? 'CPC' : 'SP', '', { use: 'read', place: 'into', into: 'mbBody', label: 'Bundle ideas' });
  if (host) host.innerHTML = html; else if ($('mbFilter').insertAdjacentHTML) $('mbFilter').insertAdjacentHTML('afterend', `<span id="mbAiBtn" class="ai-inline">${html}</span>`);
}
/** Listing Rules → Title templates: the sub-categories that no template matches, with how many listings, each with ✨ Draft title template. */
function aiTplHtml(cfg) {
  if (!aiOn() || typeof HEALTH === 'undefined' || typeof lrTemplateFor !== 'function') return '';
  const by = new Map();
  ['SP', 'CPC'].forEach(b => ((HEALTH[b] && HEALTH[b].rows) || []).forEach(row => {
    const r = row.brand ? row : Object.assign({ brand: b }, row);
    const cat = (LR_CAT[b] || {})[row.sku];
    if (!cat || lrTemplateFor(r, cfg)) return;
    const m = (typeof lmGet === 'function' && lmGet(row.sku, b)) || {};
    const k = b + '|' + (cat.subcat || '');
    const g = by.get(k) || { b, subcat: cat.subcat || '', n: 0, pts: new Map() };
    g.n++;
    if (m.pt) g.pts.set(m.pt, (g.pts.get(m.pt) || 0) + 1);
    by.set(k, g);
  }));
  const groups = [...by.values()].sort((a, b) => b.n - a.n).slice(0, 12);
  if (!groups.length) return '';
  return `<tbody class="ai-tpl"><tr><td colspan="11"><b>✨ No template yet:</b> ${groups.map(g => {
    const pt = [...g.pts.entries()].sort((a, b) => b[1] - a[1])[0];
    return `<span class="ai-tpl-g">${aiEsc((typeof BRAND_NAME !== 'undefined' && BRAND_NAME[g.b]) || g.b)} · ${aiEsc(g.subcat || 'no sub-category')} (${g.n.toLocaleString('en-US')} titles) `
      + (pt ? aiBtnHtml('title_template', g.b, '', { use: 'read', pt: pt[0], match: g.subcat, product: g.subcat, label: 'Draft title template', place: 'after' }) : '<span class="muted">no product type read yet</span>') + '</span>';
  }).join(' ')}</td></tr></tbody>`;
}

/* ----- the page's clicks and edits; the one status check ----- */
if (typeof document !== 'undefined' && document.addEventListener) {
  aiStatusCheck();
  document.addEventListener('click', e => {
    // Listing Rules → ✨ AI house style: opened (its guides are read then), Approve, Learn again
    const sum = e.target && e.target.closest ? e.target.closest('[data-ai-style] > summary') : null;
    if (sum) { const det = sum.parentNode; setTimeout(() => { if (det.open && !det.dataset.loaded) { det.dataset.loaded = '1'; aiStyleLoad(det.querySelector('[data-ai-style-b]')); } }, 0); return; }
    const sa = e.target && e.target.closest ? e.target.closest('[data-ai-style-act]') : null;
    if (sa) { const box = sa.closest('[data-ai-style-b]'); if (sa.dataset.aiStyleAct === 'ok') aiStyleApprove(sa.dataset.aiStylePt, sa.dataset.aiStyleAt, box); else aiStyleLearn(box); return; }
    const el = e.target && e.target.closest ? e.target.closest('[data-ai],[data-ai-act],[data-ai-all]') : null;
    if (!el || el.disabled) return;
    if (el.dataset.aiAll) { aiOptAll(el); return; }
    if (el.dataset.ai) { e.preventDefault(); aiOpen(el); return; }
    const job = AI.jobs.get(el.dataset.aiId);
    const act = el.dataset.aiAct;
    if (act === 'close') { const card = el.closest('[data-ai-card]'); const tr = card && card.closest('tr.ai-tr'); (tr || card).remove(); if (job) AI.jobs.delete(job.id); return; }
    if (!job) return;
    if (act === 'fixopen' || act === 'catopen' || act === 'tplUse') aiPageAct(act, job, el);
    else if (act === 'approve') aiApprove(job);
    else if (act === 'use') aiUse(job);
    else if (act === 'copy') aiCopy(job, el);
  });
  document.addEventListener('input', e => { if (e.target && e.target.dataset && e.target.dataset.aiEdit !== undefined) aiEdited(e.target); });
}

/** CONSOLE: aiReport() — whether AI answered yet on this page, this month's spend, the calls made, the answers kept, the cards open. */
function aiReport() {
  const out = { ready: AI.ready, set: !AI.off, why: AI.why || '', monthUsd: AI.month, limitUsd: AI.limit, callsThisPage: AI.calls, kept: AI.memo.size, cards: AI.jobs.size };
  if (typeof console !== 'undefined') console.log('AI', out);
  return out;
}
