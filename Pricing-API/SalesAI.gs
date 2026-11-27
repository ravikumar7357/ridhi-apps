/* Pricing-API / SalesAI.gs — Sellora's "This week in plain English": Claude writes 2–3 plain sentences about LAST WEEK's sales movers
 * (Sales card #2, 23 Nov 2026).
 *
 * A NEW FILE THAT CHANGES NOTHING ELSE. The only other change is ONE line in Code.gs doPost, beside { ai: 'plan' } (after the sign-in check):
 *
 *     if (p.ai === 'sales_insight') return json_(who.email ? saiInsight_(p, who) : { ok: false, error: 'Sign in again — the backend could not confirm who you are (' + who.why + ').' });
 *
 * WHAT IT DOES: Sellora works out the movers itself (sales/sales-insight.js: the last finished week against the week before, the biggest
 *   $ drops and gains per parent, each one's driver, "everything else") and POSTs ONLY those facts — names, $, %, drivers, every number
 *   already written as text. Claude (AI_MODEL_FAST, default claude-haiku-5-5) writes the summary; nothing is read or changed anywhere.
 *   Sellora checks the answer again (every number must be one it sent) and shows its own rule-written sentence when it does not pass.
 *
 * SAME ENGINE AS ListingAI.gs (one global scope): aiClaude_ (the call, structured JSON), aiCost_ / aiSpend_ / aiMonth_ (the US$ count and the
 *   monthly cap, AI_MONTH_LIMIT_USD, default $50), aiLog_ (one row in the "AI log" tab), aiHash_, the 6-hour CacheService answer.
 * AT MOST ONE CLAUDE CALL PER BRAND PER WEEK: the answer is kept in Script Property SAI_KEEP ({ "SP|2026-11-15": { h, text, model, at } },
 *   the newest SAI_KEEP_MAX). The same facts again → the kept text, free. Different facts for a week already written (a nightly run restated
 *   a day) → no new call: { ok: false, error, kept } — Sellora shows the kept text only when its numbers still match, else its own sentence.
 * THE ANSWER: { ok: true, text, model, cached, costUsd, monthUsd, limitUsd } or { ok: false, error[, kept] }. Never throws.
 *
 * RUN FROM THE EDITOR: saiTest() — a made-up week (no Sellora data), logs the answer and its cost.
 * To undo: delete this file and the one line in Code.gs (and Script Property SAI_KEEP).
 * Main functions: saiInsight_, saiFacts_, saiNumbersOk_, saiTest. Every name starts with sai / SAI. */

var SAI_KEEP_PROP = 'SAI_KEEP';
var SAI_KEEP_MAX = 12;                 // brand-weeks kept (a property holds at most 9 KB)
var SAI_TEXT_MAX = 700;                // characters of summary at most
var SAI_MOVERS_MAX = 8;

var SAI_SYSTEM = [
  'You explain, in plain English, why an Amazon seller\'s weekly revenue changed (brands Ridhi and CPC: hand block print home textiles).',
  'FACTS were worked out by the seller\'s own code: the week, the week before, the brand\'s change in $ and %, the biggest movers (a product',
  'or parent each: its change in $ and %, and its driver — what the data shows, or "no clear driver"), "everythingElse" (the rest of the',
  'products together) and topMoverShare (how much of the whole change the biggest mover is).',
  'Write 2 or 3 short sentences for a busy owner: what happened to revenue, how much of the change the top mover explains (use',
  'topMoverShare when it is given), and the one or two drivers that matter most.',
  'RULES: use ONLY the facts given. Copy every number EXACTLY as it is written in FACTS (the same $ and % text) — never round, add,',
  'subtract or work out a new number, never a number that is not in FACTS. Name a driver only as FACTS states it; a mover with "no clear',
  'driver" has none. No advice beyond what the drivers show, no guesses about causes, no sale words, no emojis, no lists, no headings.',
  'Answer ONLY with the JSON object: { "summary": "…" }.',
].join('\n');

// The task's settings for aiClaude_ (built when used: ListingAI.gs's helpers may load after this file).
function saiTask_() { return { fast: true, effort: 'low', schema: aiObj_({ summary: { type: 'string' } }) }; }

/** The facts Sellora sent, cleaned to exactly the fields the prompt names (text cut, numbers kept as Sellora wrote them). null when not usable. */
function saiFacts_(f) {
  if (!f || typeof f !== 'object') return null;
  var money = /^[+−-]?\$[\d,]+$/, pct = /^([+−-]?\d+(\.\d+)?%|—)$/;
  var week = /^[A-Z][a-z]{2} \d{1,2}-([A-Z][a-z]{2} )?\d{1,2}$/;
  var dir = String(f.direction || '');
  var out = {
    brand: ['Ridhi', 'CPC', 'Ridhi + CPC'].indexOf(String(f.brand)) >= 0 ? String(f.brand) : '',
    week: week.test(String(f.week || '')) ? String(f.week) : '',
    weekBefore: week.test(String(f.weekBefore || '')) ? String(f.weekBefore) : '',
    direction: ['fell', 'rose', 'held'].indexOf(dir) >= 0 ? dir : '',
    change: money.test(String(f.change || '')) ? String(f.change) : '',
    changePct: pct.test(String(f.changePct || '')) ? String(f.changePct) : '',
    topMoverShare: /^\d{1,4}%$/.test(String(f.topMoverShare || '')) ? String(f.topMoverShare) : '',
    movers: [],
    everythingElse: money.test(String(f.everythingElse || '')) ? String(f.everythingElse) : '',
  };
  (Array.isArray(f.movers) ? f.movers : []).slice(0, SAI_MOVERS_MAX).forEach(function (m) {
    m = m || {};
    if (!money.test(String(m.change || ''))) return;
    out.movers.push({ name: aiCut_(m.name, 60), change: String(m.change), changePct: pct.test(String(m.changePct || '')) ? String(m.changePct) : '',
      driver: aiCut_(m.driver, 140) || 'no clear driver' });
  });
  if (!out.brand || !out.week || !out.weekBefore || !out.direction || !out.change || !out.movers.length) return null;
  return out;
}

// The numbers in a text: "$9,400", "12.3%", "16-22" → [9400, 12.3, 16, 22].
function saiNums_(text) {
  return (String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(function (s) { return Number(s.replace(/,/g, '')); }).filter(function (n) { return isFinite(n); });
}
/** True when every number in `text` is one of the numbers in the facts (Sellora checks the same again). */
function saiNumbersOk_(text, facts) {
  var allowed = {};
  saiNums_(JSON.stringify(facts)).forEach(function (n) { allowed[n] = 1; });
  return !!String(text || '').trim() && saiNums_(text).every(function (n) { return allowed[n] === 1; });
}

function saiKeepAll_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(SAI_KEEP_PROP) || '{}') || {}; } catch (e) { return {}; } }
function saiKeepPut_(key, v) {
  var all = saiKeepAll_();
  all[key] = v;
  var keys = Object.keys(all).sort(function (a, b) { return (all[b].at || 0) - (all[a].at || 0); });
  keys.slice(SAI_KEEP_MAX).forEach(function (k) { delete all[k]; });
  PropertiesService.getScriptProperties().setProperty(SAI_KEEP_PROP, JSON.stringify(all));
}

/** POST { ai: 'sales_insight', brand: 'SP' | 'CPC' | 'ALL', week: 'yyyy-MM-dd' (the week's Sunday), facts } — signed-in people only (Code.gs). */
function saiInsight_(p, who) {
  try {
    p = p || {};
    if (!who || !who.email) return { ok: false, error: 'Sign in again — the backend could not confirm who you are' };
    var brand = String(p.brand || '').toUpperCase();
    if (brand !== 'SP' && brand !== 'CPC' && brand !== 'ALL') return { ok: false, error: 'brand must be SP, CPC or ALL' };
    var wk = String(p.week || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wk)) return { ok: false, error: 'week must be the week\'s Sunday, yyyy-MM-dd' };
    var facts = saiFacts_(p.facts);
    if (!facts) return { ok: false, error: 'The movers sent are not in the expected form' };
    if (!prop_('CLAUDE_API_KEY')) return { ok: false, error: 'AI not set up yet' };
    var h = aiHash_(JSON.stringify(facts));
    var key = brand + '|' + wk;
    var kept = saiKeepAll_()[key];
    var month = aiMonth_();
    // one call per brand per week: the same facts → the kept text; other facts for a week already written → no new call
    if (kept && kept.h === h) return { ok: true, text: kept.text, model: kept.model, cached: true, costUsd: 0, monthUsd: aiRound_(month.usd), limitUsd: month.limit };
    if (kept) return { ok: false, error: 'This week was already summarised once — Sellora\'s own summary is shown for the new figures', kept: kept.text, monthUsd: aiRound_(month.usd), limitUsd: month.limit };
    if (month.usd >= month.limit) return { ok: false, error: 'Monthly AI limit reached', monthUsd: aiRound_(month.usd), limitUsd: month.limit };
    var model = prop_('AI_MODEL_FAST') || 'claude-haiku-5-5';
    var user = 'TASK: sales_insight\nFACTS: ' + JSON.stringify(facts);
    // the same question within 6 hours (another browser at the same moment): the kept answer, free
    var cache = CacheService.getScriptCache();
    var ck = 'sai1_' + aiHash_([key, model, user].join('\u0001'));
    var hit = cache.get(ck);
    if (hit) { var c = JSON.parse(hit); return { ok: true, text: c.text, model: c.model, cached: true, costUsd: 0, monthUsd: aiRound_(month.usd), limitUsd: month.limit }; }
    var reply = aiClaude_(model, saiTask_(), user, '', SAI_SYSTEM);
    var cost = reply.usage ? aiCost_(reply.model || model, reply.usage) : 0;
    var now = reply.usage ? aiSpend_(cost, reply.usage) : aiMonth_();
    aiLog_('sales_insight ' + brand, reply.model || model, reply.usage, cost, who.email, reply.ok ? 'ok' : reply.reason);
    if (!reply.ok) return { ok: false, error: reply.reason, costUsd: aiRound_(cost), monthUsd: aiRound_(now.usd), limitUsd: now.limit };
    var text = aiCut_(reply.json && reply.json.summary, SAI_TEXT_MAX);
    if (!text) return { ok: false, error: 'The AI gave no summary', costUsd: aiRound_(cost), monthUsd: aiRound_(now.usd), limitUsd: now.limit };
    if (!saiNumbersOk_(text, facts)) {
      aiLog_('sales_insight ' + brand, reply.model || model, null, 0, who.email, 'refused: a number not in the facts');
      return { ok: false, error: 'The AI summary named a number that is not in the movers — Sellora\'s own summary is shown', costUsd: aiRound_(cost), monthUsd: aiRound_(now.usd), limitUsd: now.limit };
    }
    var used = reply.model || model;
    saiKeepPut_(key, { h: h, text: text, model: used, at: Date.now() });
    try { cache.put(ck, JSON.stringify({ text: text, model: used }), AI_CACHE_S); } catch (e) { /* answered anyway */ }
    return { ok: true, text: text, model: used, cached: false, costUsd: aiRound_(cost), monthUsd: aiRound_(now.usd), limitUsd: now.limit };
  } catch (err) {
    return { ok: false, error: 'The AI summary failed: ' + String((err && err.message) || err).slice(0, 200) };
  }
}

/** Editor: a made-up week through the whole path (one Claude call, logged and counted) — no Sellora data is read. */
function saiTest() {
  var facts = { brand: 'Ridhi', week: 'Nov 15-21', weekBefore: 'Nov 8-14', direction: 'fell', change: '$9,400', changePct: '−12.3%', topMoverShare: '41%',
    movers: [{ name: 'Test Napkins Set of 4', change: '−$3,850', changePct: '−62%', driver: 'out of stock — 0 FBA units as of 23 Nov; 3 days without a sale' },
      { name: 'Test Tablecloth', change: '+$1,200', changePct: '+18%', driver: 'price −10%' }],
    everythingElse: '−$6,750' };
  var r = saiInsight_({ brand: 'SP', week: '2000-01-02', facts: facts }, { email: 'editor-test' });
  Logger.log(JSON.stringify(r, null, 2));
  Logger.log('numbers check: ' + (r.text ? saiNumbersOk_(r.text, saiFacts_(facts)) : 'no text'));
}
