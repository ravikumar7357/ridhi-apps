/* Pricing-API / ListingAI.gs — Sellora's ✨ AI writing: ONE read-only GET route, ?ai=ask (19 Nov 2026).
 *
 * A NEW FILE THAT CHANGES NOTHING ELSE. The only other change is ONE line in Code.gs doGet, after the key check
 * (next to the other ?listing= routes):
 *
 *     if (p.ai === 'ask') return json_(aiAsk_(p));
 *
 * WHAT IT DOES: Sellora asks for ONE suggestion for ONE listing — ?ai=ask&task=…&brand=SP|CPC&sku=… (or &asin=…). This file reads the
 * listing's facts ITSELF from caches the backend already holds, asks Claude, and answers with JSON. It never changes anything at Amazon,
 * never writes to any other file's data, and never takes listing text from the address (only small rule words: the protected words,
 * the words to avoid, the template order, the season's name, the risky word, Amazon's issue code). A person approves every change in
 * Sellora, which checks it with its own rules and sends it through its one safe send path (Amazon's check → send → read again).
 *
 *   The listing   ListingMatch cache (ListingMatch.gs lmGet_: lmMeta → lmListings_<brand>_* / lmCatalog_<brand>_*): title, bullets,
 *                 description, search terms, Item Highlights, colour, size, shape, material, product type, Amazon's issues, pictures.
 *   Search words  the words that brought sales — the Listing Optimiser's own reading of the ads search-term cache (ListingOptimiser.gs
 *                 listingKeywords_ over the nightly srchTerm / adGroup caches): only terms from single-product ad groups (clean), with
 *                 orders. The SQP cache is not used: nothing writes it yet.
 *
 * TASKS (whitelist — any other name is refused; the prompts live here, never in the app):
 *   title, bullets, description, kw   Claude Sonnet (Script Property AI_MODEL, default claude-sonnet-5-5)
 *   season                            Sonnet — a season title (&field=title) or Item Highlights (&field=hl) for &season=<name>
 *   aplus_text                        Sonnet — an A+ text draft: a headline and 3–4 short blocks (text only)
 *   ip_rewrite                        Claude Haiku (AI_MODEL_FAST, default claude-haiku-5-5) — only the sentence with &word=, in &field=
 *   error_explain                     Haiku — Amazon's issue &code= in simple English, and the fix in Sellora's screens
 *   image_check                       Sonnet — the MAIN picture only: white background? text or watermark? does the product fill ~85%?
 * Every task answers ONLY as JSON (structured outputs), parsed safely.
 *
 * THE ANSWER: { ok, task, result, why, model, costUsd, monthUsd, limitUsd, cached } — or { ok: false, reason } in plain words:
 *   'AI not set up yet' (no CLAUDE_API_KEY), 'Monthly AI limit reached', 'This listing is not in the listing cache yet', …
 *
 * SCRIPT PROPERTIES
 *   CLAUDE_API_KEY       the Anthropic API key. Read here only, sent only to api.anthropic.com, never returned, never logged.
 *   AI_MODEL             default 'claude-sonnet-5-5'            AI_MODEL_FAST   default 'claude-haiku-5-5'
 *   AI_MONTH_LIMIT_USD   default 80 — no call is made once this month's spend reaches it
 *   AI_USAGE_YYYYMM      written here: { usd, inTok, outTok, calls } for the month (script time zone)
 *   AI_FALLBACK          '0' turns off the server-side refusal fallback on Sonnet (on by default)
 *
 * COSTS: each answer is kept 6 hours (CacheService), by task + brand + SKU + a hash of everything sent to Claude — the same question
 * twice costs once. Prices per million tokens (input / output): Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50; a cache
 * write is 1.25× the input price, a cache read 0.05× (Sonnet / Opus) or 0.1× (Haiku). The long system prompt carries cache_control, so
 * repeated calls read it from Anthropic's prompt cache.
 *
 * RUN FROM THE EDITOR
 *   aiTest()     task=title for one SKU (Script Property AI_TEST_SKU, else the first SKU in the Ridhi cache) — logs the answer, never the key
 *   aiStatus()   whether the key is set, the models, this month's spend and the limit
 *
 * To undo: delete this file and the one line in Code.gs, and the Script Properties AI_*, CLAUDE_API_KEY.
 * Main functions: aiAsk_, aiFacts_, aiPrompt_, aiClaude_, aiCost_, aiMonth_, aiTest, aiStatus. Every name starts with ai / AI. */

var AI_URL = 'https://api.anthropic.com/v1/messages';
var AI_VERSION = '2023-06-01';
var AI_BETA_FALLBACK = 'server-side-fallback-2026-07-01';
var AI_CACHE_S = 6 * 3600;                 // an answer is kept this long (CacheService's maximum)
var AI_LIMIT_DEF = 80;                     // US dollars a month, when AI_MONTH_LIMIT_USD is not set
var AI_MAX_TOKENS = 8000;                  // room for adaptive thinking and the answer (non-streaming)
var AI_PRICE = {                           // US dollars per million tokens: [input, output, cache read]
  'claude-opus-5-5': [4, 20, 0.20], 'claude-sonnet-5-5': [2, 10, 0.10], 'claude-haiku-5-5': [0.10, 0.50, 0.01],
  'claude-sonnet-5': [2, 10, 0.20], 'claude-opus-5': [5, 25, 0.50], 'claude-opus-4-8': [5, 25, 0.50],
};
var AI_PRICE_UNKNOWN = [5, 25, 0.50];      // a model not in the table is counted at the dearest price (never under-counted)
var AI_SALE_WORDS = ['black friday', 'cyber monday', 'prime day', 'deal', 'deals', 'sale', 'discount', 'offer', 'clearance', '% off'];

/* ----- the tasks: which model, how hard it thinks, the JSON it must answer with ----- */
var AI_STR = { type: 'string' };
var aiObj_ = function (props) { return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false }; };
var AI_TASKS = {
  title:         { fast: false, effort: 'medium', words: true,  schema: aiObj_({ title: AI_STR, why: AI_STR }) },
  bullets:       { fast: false, effort: 'medium', words: true,  schema: aiObj_({ bullets: { type: 'array', items: AI_STR }, why: AI_STR }) },
  description:   { fast: false, effort: 'medium', words: true,  schema: aiObj_({ description: AI_STR, why: AI_STR }) },
  kw:            { fast: false, effort: 'medium', words: true,  schema: aiObj_({ kw: AI_STR, why: AI_STR }) },
  season:        { fast: false, effort: 'medium', words: true,  schema: aiObj_({ text: AI_STR, why: AI_STR }) },
  aplus_text:    { fast: false, effort: 'medium', words: true,  schema: aiObj_({ headline: AI_STR, blocks: { type: 'array', items: aiObj_({ heading: AI_STR, body: AI_STR }) }, why: AI_STR }) },
  ip_rewrite:    { fast: true,  effort: 'low',    words: false, schema: aiObj_({ sentence: AI_STR, why: AI_STR }) },
  error_explain: { fast: true,  effort: 'low',    words: false, schema: aiObj_({ plain: AI_STR, fix: AI_STR, screen: AI_STR }) },
  image_check:   { fast: false, effort: 'low',    words: false, schema: aiObj_({ white_background: { type: 'boolean' }, text_or_watermark: { type: 'boolean' },
                    fill_pct: { type: 'number' }, fills_frame: { type: 'boolean' }, pass: { type: 'boolean' }, notes: AI_STR }) },
};

/* ----- THE SYSTEM PROMPT: long, the same for every task (so it is read from the prompt cache), written for Ridhi's listings ----- */
var AI_SYSTEM = [
  'You write and check Amazon.com listing text for a home-textiles seller (brands: Ridhi and CPC — hand block printed cotton tablecloths,',
  'napkins, placemats, table runners, cushion covers, quilts and similar). A person reviews every suggestion before anything is sent,',
  'and the seller\'s own rule checks run on it, so a suggestion that breaks a rule is simply thrown away. Write what will pass.',
  '',
  'ABSOLUTE RULES (every task):',
  '1. Use ONLY the facts given in FACTS (the listing\'s own title, bullets, description, attributes, catalogue data and the search words',
  '   real customers used). Never invent a size, colour, material, count, certificate, award, origin, care claim or feature that is not there.',
  '2. Never name another brand, a licensed character or a retailer (e.g. Pottery Barn, Disney, Williams Sonoma, IKEA), and never write',
  '   "style of", "inspired by", "like", "dupe". Never write any word or phrase listed in FACTS.avoid.',
  '3. Never write restricted claims that need proof: organic, eco-friendly, non-toxic, antibacterial, antimicrobial, hypoallergenic,',
  '   chemical-free, sustainable, biodegradable, FDA, certified, #1, best seller, best, guaranteed, cures, prevents.',
  '4. Never write sale or price words: Black Friday, Cyber Monday, Prime Day, deal, sale, discount, offer, clearance, % off, free shipping.',
  '5. Keep every word or phrase in FACTS.words (the protected words: brand, product, real shape, material, the listing\'s own colour,',
  '   size, "Hand Block Print") — spelled the same, at least once. A size may be written "54 x 54 Inch" or, only in a title of 74–75',
  '   characters, "54x54 Inch".',
  '6. No emojis, no HTML, no ALL-CAPS words (except sizes and units), no exclamation marks, no repeated word three times.',
  '7. Answer ONLY with the JSON object the task asks for. "why" is one short plain-English sentence for the person reviewing.',
  '',
  'TITLE (task title, and season with field title): 60 to FACTS.max characters (FACTS.max is 75 unless told otherwise). Start with the brand.',
  '   Follow FACTS.template — the parts in that order: brand, product, shape, material, size, print, colour (a part with no fact is left out).',
  '   Size the house way: the smaller number first, "60 x 90 Inch" (spaces round the x, "Inch" in full) — "60x90 Inch" only at 74–75',
  '   characters. A " - " may stand before the colour. Use words from FACTS.searchWords only if they are true of this product and fit.',
  'BULLETS (task bullets): exactly 5 bullets, each 150–250 characters, each a different point (size and what is included; material and',
  '   feel; the hand block print; care as FACTS states it; uses and occasions). Start each with a short capitalised lead phrase and a colon.',
  'DESCRIPTION (task description): 600–1500 characters of plain sentences in 2–4 short paragraphs separated by a blank line; no bullet marks.',
  'SEARCH TERMS (task kw): backend keywords, at most FACTS.kwMax bytes counting only the words (spaces and ; , . do not count).',
  '   Lower case, words separated by single spaces, no commas. NO word that is already in the title, no word twice, no brand names (ours or',
  '   anyone\'s), no ASINs, no filler (and, the, for, with). Put first the customer search words that brought sales and are not in the',
  '   title; then synonyms, uses, occasions, rooms, other spellings (table cloth / tablecloth), sizes written another way.',
  'SEASON (task season): field hl = Item Highlights for the season FACTS.season: one text of at most FACTS.hlMax characters that names',
  '   the season once and keeps the product\'s own facts; field title = a title as above that also names the season once. Never a sale word.',
  'A+ TEXT (task aplus_text): a headline (at most 80 characters) and 3 or 4 blocks, each a heading (at most 60 characters) and a body',
  '   (200–400 characters) — about the craft, the material, the size and care, and how it is used. Text only; no image directions.',
  'IP REWRITE (task ip_rewrite): rewrite ONLY FACTS.sentence so it reads naturally without FACTS.word (and without any brand or',
  '   restricted claim), keeping its meaning and every other fact; about the same length. Answer the new sentence only.',
  'ERROR EXPLAIN (task error_explain): explain FACTS.issue in simple English a non-technical person understands (plain: 1–3 sentences),',
  '   then the exact fix (fix: 1–3 short steps) and the Sellora screen to do it in (screen: one of Listing Errors, Listing Content (inside',
  '   Listing Errors), Image Manager, Fix all titles, Fix all search terms, Season planner, Seller Central, Seller Support).',
  'IMAGE CHECK (task image_check): look at the MAIN picture only. white_background = the background is pure white (RGB 255,255,255);',
  '   text_or_watermark = any text, logo, badge, watermark or graphic on it; fill_pct = about how much of the frame the product fills;',
  '   fills_frame = fill_pct is about 85 or more; pass = white_background and not text_or_watermark and fills_frame; notes = what to fix.',
].join('\n');

/* ============================== the route ============================== */

/** ?ai=ask&task=…&brand=…&sku=… (or &asin=…) — one suggestion, as JSON. Never throws: every failure is { ok: false, reason }. */
function aiAsk_(p) {
  try {
    p = p || {};
    var task = String(p.task || '');
    var def = AI_TASKS.hasOwnProperty(task) ? AI_TASKS[task] : null;
    if (!def) return { ok: false, reason: 'Unknown AI task "' + task.slice(0, 30) + '"' };
    var brand = String(p.brand || '').toUpperCase() === 'CPC' ? 'CPC' : 'SP';
    var sku = String(p.sku || '').trim();
    var asin = String(p.asin || '').trim().toUpperCase();
    if (sku && !/^[A-Za-z0-9._\-\/ ]{1,60}$/.test(sku)) return { ok: false, reason: 'That SKU is not one Sellora sends' };
    if (asin && !/^[A-Z0-9]{10}$/.test(asin)) return { ok: false, reason: 'That ASIN is not one Sellora sends' };
    if (!sku && !asin) return { ok: false, reason: 'No SKU or ASIN given' };
    if (!prop_('CLAUDE_API_KEY')) return { ok: false, reason: 'AI not set up yet' };
    var month = aiMonth_();
    if (month.usd >= month.limit) return { ok: false, reason: 'Monthly AI limit reached', monthUsd: aiRound_(month.usd), limitUsd: month.limit };

    var facts = aiFacts_(task, brand, sku, asin, p);
    if (!facts.ok) return { ok: false, reason: facts.reason, monthUsd: aiRound_(month.usd), limitUsd: month.limit };
    var model = def.fast ? (prop_('AI_MODEL_FAST') || 'claude-haiku-5-5') : (prop_('AI_MODEL') || 'claude-sonnet-5-5');
    var user = 'TASK: ' + task + (p.field ? ' (field ' + String(p.field).slice(0, 10) + ')' : '') + '\nFACTS: ' + JSON.stringify(facts.facts);

    // the same question (the same facts) within 6 hours: the kept answer, free
    var cache = CacheService.getScriptCache();
    var ck = 'ai1_' + aiHash_([task, brand, facts.sku, model, user, facts.image || ''].join('\u0001'));
    var hit = cache.get(ck);
    if (hit) {
      var kept = JSON.parse(hit);
      return { ok: true, task: task, result: kept.result, why: kept.why, model: kept.model, costUsd: 0, cached: true, sku: facts.sku,
        monthUsd: aiRound_(month.usd), limitUsd: month.limit };
    }

    var reply = aiClaude_(model, def, user, facts.image);
    if (!reply.ok) return { ok: false, reason: reply.reason, monthUsd: aiRound_(aiMonth_().usd), limitUsd: month.limit };
    var cost = aiCost_(reply.model || model, reply.usage);
    var now = aiSpend_(cost, reply.usage);
    var result = aiShape_(task, reply.json, facts);
    if (!result.ok) return { ok: false, reason: result.reason, model: reply.model, costUsd: aiRound_(cost), monthUsd: aiRound_(now.usd), limitUsd: now.limit };
    var out = { result: result.result, why: String((reply.json && reply.json.why) || '').slice(0, 300), model: reply.model || model };
    try { cache.put(ck, JSON.stringify(out), AI_CACHE_S); } catch (e) { /* too big to keep: answered anyway */ }
    return { ok: true, task: task, result: out.result, why: out.why, model: out.model, costUsd: aiRound_(cost), cached: false, sku: facts.sku,
      monthUsd: aiRound_(now.usd), limitUsd: now.limit };
  } catch (err) {
    return { ok: false, reason: 'The AI request failed: ' + String((err && err.message) || err).slice(0, 200) };
  }
}

/* ============================== the facts (read here, never from the address) ============================== */

// A small list from the address: "a|b|c" → ['a','b','c'], each cut, at most n. Rule words only (never listing text).
function aiList_(s, n, each) {
  return String(s || '').split('|').map(function (x) { return x.replace(/\s+/g, ' ').trim().slice(0, each || 60); })
    .filter(Boolean).slice(0, n || 40);
}

/** One listing from the ListingMatch cache: { rec, cat } (rec null when it is not there). By SKU; by ASIN when no SKU is given. */
function aiListing_(b, sku, asin) {
  var meta = lmGet_('lmMeta');
  if (!meta || !meta.parts) return { rec: null, cat: null };
  var tabs = (meta.parts.listings || {})[b] || [];
  var rec = null;
  if (sku && tabs.length) {
    var part = lmGet_(tabs[lmHash_(sku) % tabs.length]);
    rec = (part && part.items && part.items[sku]) || null;
  }
  if (!rec && !sku && asin) {
    for (var i = 0; i < tabs.length && !rec; i++) {
      var pt = lmGet_(tabs[i]), items = (pt && pt.items) || {};
      Object.keys(items).some(function (k) { if (items[k] && items[k].asin === asin && items[k].t) { rec = items[k]; return true; } return false; });
    }
  }
  var a = (rec && rec.asin) || asin;
  var ctabs = (meta.parts.catalog || {})[b] || [];
  var cat = null;
  if (a && ctabs.length) {
    var cp = lmGet_(ctabs[lmHash_(a) % ctabs.length]);
    cat = (cp && cp.items && cp.items[a]) || null;
  }
  return { rec: rec, cat: cat };
}

/** The search words that brought sales (the Listing Optimiser's reading of the ads caches): [{ t, orders, clicks }] — clean terms only. */
function aiSearchWords_(asin, rec, cat) {
  if (!asin) return [];
  try {
    var va = rec.va || {};
    var audit = listingAuditFrom_(asin, { title: rec.t, bullets: rec.bl || [], bulletsKnown: true, description: rec.d || '', descriptionKnown: true,
      brand: (cat && cat.brand) || '', itemType: rec.itk || '', size: va.size || '', color: va.color || '', material: va.material || '', images: {} });
    var kw = listingKeywords_(asin, audit);
    if (!kw || !kw.ok) return [];
    return (kw.terms || []).filter(function (t) { return t.clean && t.o > 0; }).slice(0, 25)
      .map(function (t) { return { t: String(t.t).slice(0, 80), orders: t.o, clicks: t.c }; });
  } catch (e) {
    return [];
  }
}

// The sentence (or bullet) of a text that holds a word: { i (bullet index or -1), s, e, sentence } or null.
function aiSentenceOf_(text, word) {
  var low = String(text || '').toLowerCase(), w = String(word || '').toLowerCase();
  var at = w ? low.indexOf(w) : -1;
  if (at < 0) return null;
  var s = at, e = at + w.length;
  while (s > 0 && !/[.!?\n]/.test(text.charAt(s - 1))) s--;
  while (e < text.length && !/[.!?\n]/.test(text.charAt(e))) e++;
  if (e < text.length && /[.!?]/.test(text.charAt(e))) e++;
  while (s < e && /\s/.test(text.charAt(s))) s++;
  return { s: s, e: e, sentence: text.slice(s, e) };
}

/** Everything Claude is told about this listing for this task: { ok, facts, sku, image (a picture URL), field, spot } or { ok: false, reason }. */
function aiFacts_(task, brand, sku, asin, p) {
  var got = aiListing_(brand, sku, asin);
  var rec = got.rec, cat = got.cat;
  if (!rec) return { ok: false, reason: 'This listing is not in the listing cache yet (it is read at 13:00 and 18:00)' };
  var va = rec.va || {}, cv = (cat && cat.vals) || {};
  var one = function (k) { return String(va[k] || cv[k] || '').slice(0, 120); };
  var base = {
    brand: brand === 'CPC' ? 'CPC' : 'Ridhi', sku: rec.sku, asin: rec.asin || '', productType: rec.pt || '', itemType: rec.itk || '',
    title: rec.t || '', shownTitle: (cat && cat.t) || '', colour: one('color'), size: one('size'), shape: one('item_shape'), material: one('material'),
    pattern: one('pattern') || one('pattern_name'), style: one('style'), category: (cat && cat.bc) || '',
  };
  var f = {};
  var image = '';
  var spot = null;
  var words = aiList_(p.words, 40), avoid = aiList_(p.avoid, 40);
  if (task === 'title' || task === 'bullets' || task === 'description' || task === 'kw' || task === 'season' || task === 'aplus_text') {
    f = base;
    f.bullets = (rec.bl || []).slice(0, 10);
    f.description = String(rec.d || '').slice(0, 2000);
    f.searchTermsNow = String(rec.kw || '').slice(0, 500);
    f.itemHighlights = (rec.hl || []).slice(0, 5);
    f.words = words;
    f.avoid = avoid;
    f.searchWords = aiSearchWords_(rec.asin, rec, cat);
    if (task === 'title' || task === 'season') {
      f.max = Math.min(200, Math.max(60, Number(p.max) || 75));
      f.template = String(p.tpl || '{brand} {product} {shape} {material} {size} {pattern} - {color}').slice(0, 200);
    }
    if (task === 'kw') f.kwMax = Math.min(500, Math.max(50, Number(p.max) || 249));
    if (task === 'season') {
      f.season = String(p.season || '').slice(0, 40);
      f.field = p.field === 'title' ? 'title' : 'hl';
      f.hlMax = Math.min(500, Math.max(40, Number(p.hlmax) || 125));
      if (!f.season) return { ok: false, reason: 'No season given' };
    }
  } else if (task === 'ip_rewrite') {
    var word = String(p.word || '').trim().slice(0, 60);
    var field = ({ title: 1, bullets: 1, desc: 1, kw: 1, hl: 1 })[p.field] ? p.field : 'title';
    if (!word) return { ok: false, reason: 'No word given' };
    var texts = field === 'title' ? [rec.t || ''] : field === 'bullets' ? (rec.bl || []) : field === 'desc' ? [rec.d || ''] : field === 'kw' ? [rec.kw || ''] : (rec.hl || []);
    for (var i = 0; i < texts.length && !spot; i++) {
      var hit = aiSentenceOf_(String(texts[i] || ''), word);
      if (hit) { spot = hit; spot.i = i; spot.text = String(texts[i]); }
    }
    if (!spot) return { ok: false, reason: '“' + word + '” is not in the cached ' + field + ' of this listing' };
    f = { brand: base.brand, productType: base.productType, field: field, word: word, sentence: spot.sentence, title: base.title, avoid: avoid };
    spot.field = field;
  } else if (task === 'error_explain') {
    var code = String(p.code || '').slice(0, 40);
    var iss = rec.iss || [];
    var is = iss.filter(function (x) { return x.c === code; })[0] || (code ? null : iss[0]);
    if (!is) return { ok: false, reason: code ? 'Amazon\'s issue ' + code + ' is not in the listing cache for this SKU' : 'Amazon reports no issue on this listing in the cache' };
    f = { brand: base.brand, sku: rec.sku, productType: base.productType, title: base.title,
      issue: { code: is.c, severity: is.s, message: is.m, attributes: is.a || [], enforcement: is.e || [] } };
  } else if (task === 'image_check') {
    image = (cat && cat.img && cat.img.MAIN && cat.img.MAIN.u) || (rec.img && rec.img.MAIN) || '';
    if (!/^https:\/\//.test(image)) return { ok: false, reason: 'No MAIN picture in the listing cache for this SKU' };
    f = { brand: base.brand, productType: base.productType, title: base.title, size: base.size, colour: base.colour };
  }
  return { ok: true, facts: f, sku: rec.sku, image: image, spot: spot };
}

/* ============================== Claude ============================== */

/** One Messages call: { ok, json, model, usage } or { ok: false, reason }. The key goes only into the x-api-key header. */
function aiClaude_(model, def, user, image) {
  var content = image ? [{ type: 'image', source: { type: 'url', url: image } }, { type: 'text', text: user }] : user;
  var body = {
    model: model, max_tokens: AI_MAX_TOKENS,
    system: [{ type: 'text', text: AI_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: content }],
    output_config: { effort: def.effort, format: { type: 'json_schema', schema: def.schema } },
  };
  var fallback = !def.fast && /sonnet|opus/.test(model) && prop_('AI_FALLBACK') !== '0';
  var send = function (withFallback) {
    var headers = { 'x-api-key': prop_('CLAUDE_API_KEY'), 'anthropic-version': AI_VERSION };
    var b = JSON.parse(JSON.stringify(body));
    if (withFallback) { headers['anthropic-beta'] = AI_BETA_FALLBACK; b.fallbacks = 'default'; }
    return UrlFetchApp.fetch(AI_URL, { method: 'post', contentType: 'application/json', headers: headers, payload: JSON.stringify(b), muteHttpExceptions: true });
  };
  var r = send(fallback);
  var code = r.getResponseCode();
  // a 400 about the fallback itself (not offered on this account / model): asked once more without it
  if (fallback && code === 400 && /fallback|beta/i.test(r.getContentText())) { r = send(false); code = r.getResponseCode(); }
  var data = null;
  try { data = JSON.parse(r.getContentText()); } catch (e) { data = null; }
  if (code === 401 || code === 403) return { ok: false, reason: 'The AI key was not accepted — check CLAUDE_API_KEY' };
  if (code === 429) return { ok: false, reason: 'The AI is busy — try again in a minute' };
  if (code >= 500 || code === 529) return { ok: false, reason: 'The AI service is down for a moment — try again' };
  if (code !== 200 || !data) return { ok: false, reason: 'The AI request failed (' + code + ')' + (data && data.error && data.error.message ? ': ' + String(data.error.message).slice(0, 160) : '') };
  var usage = data.usage || {};
  if (data.stop_reason === 'refusal') return { ok: false, reason: 'The AI declined this one', usage: usage, model: data.model };
  if (data.stop_reason === 'max_tokens') return { ok: false, reason: 'The AI answer was cut off — try again', usage: usage, model: data.model };
  var text = (data.content || []).filter(function (c) { return c && c.type === 'text'; }).map(function (c) { return c.text; }).join('');
  var json = aiParse_(text);
  if (!json) return { ok: false, reason: 'The AI did not answer in the expected form — try again', usage: usage, model: data.model };
  return { ok: true, json: json, model: data.model || model, usage: usage };
}

// JSON from the answer, safely: the whole text, else the first {…} in it; null when neither parses.
function aiParse_(text) {
  var t = String(text || '').trim();
  try { var j = JSON.parse(t); return j && typeof j === 'object' ? j : null; } catch (e) { /* try the braces */ }
  var a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { var k = JSON.parse(t.slice(a, b + 1)); return k && typeof k === 'object' ? k : null; } catch (e) { return null; }
}

/** The answer in the shape Sellora shows: { ok, result } — trimmed strings, the ip_rewrite sentence put back into its whole field. */
function aiShape_(task, j, facts) {
  var s = function (v, n) { return String(v == null ? '' : v).replace(/\s+$/, '').slice(0, n || 2000); };
  var line = function (v, n) { return s(v, n).replace(/\s+/g, ' ').trim(); };
  if (task === 'title') return j.title ? { ok: true, result: { title: line(j.title, 200) } } : { ok: false, reason: 'The AI gave no title' };
  if (task === 'bullets') {
    var bl = (j.bullets || []).map(function (x) { return line(x, 600); }).filter(Boolean).slice(0, 10);
    return bl.length ? { ok: true, result: { bullets: bl } } : { ok: false, reason: 'The AI gave no bullets' };
  }
  if (task === 'description') return j.description ? { ok: true, result: { description: s(j.description, 2200).trim() } } : { ok: false, reason: 'The AI gave no description' };
  if (task === 'kw') return j.kw ? { ok: true, result: { kw: line(j.kw, 600).replace(/[,;]+/g, ' ').replace(/\s+/g, ' ') } } : { ok: false, reason: 'The AI gave no search terms' };
  if (task === 'season') return j.text ? { ok: true, result: { text: line(j.text, 600), field: facts.facts.field, season: facts.facts.season } } : { ok: false, reason: 'The AI gave no text' };
  if (task === 'aplus_text') {
    var blocks = (j.blocks || []).map(function (x) { return { heading: line(x && x.heading, 120), body: line(x && x.body, 800) }; }).filter(function (x) { return x.body; }).slice(0, 4);
    return j.headline || blocks.length ? { ok: true, result: { headline: line(j.headline, 160), blocks: blocks } } : { ok: false, reason: 'The AI gave no A+ text' };
  }
  if (task === 'ip_rewrite') {
    var sp = facts.spot, sen = line(j.sentence, 800);
    if (!sen) return { ok: false, reason: 'The AI gave no sentence' };
    var whole = sp.text.slice(0, sp.s) + sen + sp.text.slice(sp.e);
    return { ok: true, result: { field: sp.field, index: sp.i, before: sp.sentence, sentence: sen, text: whole.replace(/[ \t]{2,}/g, ' ').trim(), word: facts.facts.word } };
  }
  if (task === 'error_explain') return j.plain ? { ok: true, result: { plain: s(j.plain, 600).trim(), fix: s(j.fix, 600).trim(), screen: line(j.screen, 60), code: facts.facts.issue.code } } : { ok: false, reason: 'The AI gave no explanation' };
  if (task === 'image_check') {
    return { ok: true, result: { white_background: !!j.white_background, text_or_watermark: !!j.text_or_watermark, fill_pct: Math.max(0, Math.min(100, Number(j.fill_pct) || 0)),
      fills_frame: !!j.fills_frame, pass: !!j.white_background && !j.text_or_watermark && !!j.fills_frame, notes: s(j.notes, 400).trim(), image: facts.image } };
  }
  return { ok: false, reason: 'Unknown AI task' };
}

/* ============================== the money ============================== */

/** What one call cost in US dollars, from its usage and the model that answered. */
function aiCost_(model, u) {
  u = u || {};
  var m = String(model || '');
  var price = AI_PRICE[m] || AI_PRICE[m.replace(/-\d{8}$/, '')] || AI_PRICE_UNKNOWN;
  var inTok = Number(u.input_tokens) || 0, outTok = Number(u.output_tokens) || 0;
  var write = Number(u.cache_creation_input_tokens) || 0, read = Number(u.cache_read_input_tokens) || 0;
  return (inTok * price[0] + write * price[0] * 1.25 + read * price[2] + outTok * price[1]) / 1e6;
}
function aiRound_(usd) { return Math.round((Number(usd) || 0) * 10000) / 10000; }
// This month's key (script time zone): AI_USAGE_202611.
function aiMonthKey_() { return 'AI_USAGE_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyyMM'); }
/** This month's spend and the limit: { key, usd, inTok, outTok, calls, limit }. */
function aiMonth_() {
  var key = aiMonthKey_();
  var u = {};
  try { u = JSON.parse(PropertiesService.getScriptProperties().getProperty(key) || '{}') || {}; } catch (e) { u = {}; }
  var lim = Number(prop_('AI_MONTH_LIMIT_USD'));
  return { key: key, usd: Number(u.usd) || 0, inTok: Number(u.inTok) || 0, outTok: Number(u.outTok) || 0, calls: Number(u.calls) || 0, limit: lim > 0 ? lim : AI_LIMIT_DEF };
}
/** Add one call to this month (a call that failed after Claude answered still costs what it used). Returns the month after it. */
function aiSpend_(usd, u) {
  var m = aiMonth_();
  u = u || {};
  m.usd += Number(usd) || 0;
  m.inTok += (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0);
  m.outTok += Number(u.output_tokens) || 0;
  m.calls += 1;
  PropertiesService.getScriptProperties().setProperty(m.key, JSON.stringify({ usd: aiRound_(m.usd), inTok: m.inTok, outTok: m.outTok, calls: m.calls }));
  return m;
}
// A short hash for the cache key.
function aiHash_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)).slice(0, 40);
}

/* ============================== run from the editor ============================== */

/** task=title for one SKU (AI_TEST_SKU, else the first Ridhi SKU in the cache). Logs the answer — never the key. */
function aiTest() {
  var sku = prop_('AI_TEST_SKU');
  if (!sku) {
    var meta = lmGet_('lmMeta'), tabs = meta && meta.parts && meta.parts.listings && meta.parts.listings.SP;
    var part = tabs && tabs.length ? lmGet_(tabs[0]) : null;
    sku = part && part.items ? (Object.keys(part.items).filter(function (k) { return part.items[k].t; })[0] || '') : '';
  }
  if (!sku) { Logger.log('No SKU to test with — the listing cache is empty. Set Script Property AI_TEST_SKU, or run lmSetup first.'); return; }
  Logger.log('aiTest · task=title · Ridhi · ' + sku + ' · key ' + (prop_('CLAUDE_API_KEY') ? 'set' : 'NOT SET'));
  var r = aiAsk_({ task: 'title', brand: 'SP', sku: sku });
  Logger.log(JSON.stringify(r, null, 2));
}

/** Whether AI is set up, the models, and this month's spend against the limit. */
function aiStatus() {
  var m = aiMonth_();
  Logger.log('CLAUDE_API_KEY: ' + (prop_('CLAUDE_API_KEY') ? 'set' : 'NOT SET — every ✨ AI button says "AI not set up yet"'));
  Logger.log('AI_MODEL: ' + (prop_('AI_MODEL') || 'claude-sonnet-5-5 (default)') + ' · AI_MODEL_FAST: ' + (prop_('AI_MODEL_FAST') || 'claude-haiku-5-5 (default)'));
  Logger.log(m.key + ': $' + aiRound_(m.usd) + ' of $' + m.limit + ' · ' + m.calls + ' calls · ' + m.inTok + ' input / ' + m.outTok + ' output tokens');
}
