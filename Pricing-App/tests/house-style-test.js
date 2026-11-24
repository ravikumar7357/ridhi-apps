/* ✨ AI house style + the Part 2 backend tasks (20 Nov 2026): Pricing-API/ListingAI.gs itself, run in a sandbox with a mocked Claude
 * (UrlFetchApp), a mocked Sellora Listing Cache (lmGet_ / lmPut_), Script Properties, CacheService and the timer.
 *   node tests/house-style-test.js
 * Checks: aiLearnStyle reads EVERY listing of both brands and groups them by product type; Haiku in batches (good examples first),
 * Sonnet one guide per type, saved in lmAiStyle as "draft" with the date, listings read and cost; never an invented word or title (only
 * words and titles from our own listings); learning stops at the month's limit; a guide is used ONLY when the page names it approved
 * (product type + the guide's date), and then it is in the prompt of every writing task; no guide → the task works as before; the
 * house style sentence is in the system prompt; Learn again is budget-checked; the page tasks check what the AI answers. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 700) : '')); } };
const GS = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'ListingAI.gs'), 'utf8');

/* ----- the listings: three product types, both brands; "good" = live, in stock, no Amazon error ----- */
function listings() {
  const out = { SP: {}, CPC: {} };
  const add = (b, sku, pt, t, good, extra) => { out[b][sku] = Object.assign({ sku, asin: 'B0' + sku.replace(/\W/g, '').padEnd(8, 'X').slice(0, 8), pt, t, as: good ? 'BUYABLE,DISCOVERABLE' : 'DISCOVERABLE', qty: good ? 5 : 0, fba: good ? 5 : 0,
    bl: ['Hand Block Print: printed by hand.', '100% Cotton: soft.', 'Size: 60 x 90 Inch.', 'Care: machine wash cold.', 'Uses: dinner and parties.'], d: 'Printed by hand in Jaipur.', kw: 'table linen dinner', hl: [],
    va: { color: 'Blue', size: '60x90', material: 'Cotton', item_shape: 'Rectangle' }, iss: good ? [] : [{ c: '90220', s: 'ERROR', m: 'Missing colour', a: ['color'] }] }, extra || {}); };
  for (let i = 0; i < 130; i++) add(i % 3 ? 'SP' : 'CPC', 'TC-' + i, 'TABLECLOTH', `Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch Hand Block Print - Blue ${i}`, i % 4 !== 0);
  for (let i = 0; i < 70; i++) add('SP', 'NP-' + i, 'NAPKIN', `Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Hand Block Print - Red ${i}`, i % 2 === 0);
  for (let i = 0; i < 5; i++) add('CPC', 'PM-' + i, 'PLACEMAT', `CPC Placemats Set of 4 Cotton 13 x 19 Inch - Green ${i}`, true);
  add('SP', 'TC-P', 'TABLECLOTH', 'Parent title', true, { lvl: 'parent' });              // a parent: not a listing to learn from
  return out;
}
function sandbox(opts) {
  opts = opts || {};
  const props = Object.assign({ CLAUDE_API_KEY: 'sk-test', LM_CACHE_ID: 'x' }, opts.props || {});
  const tabs = {};
  const L = listings();
  const meta = { parts: { listings: {}, catalog: {} } };
  ['SP', 'CPC'].forEach(b => {
    const skus = Object.keys(L[b]);
    const half = Math.ceil(skus.length / 2);
    meta.parts.listings[b] = [`lmListings_${b}_2_0`, `lmListings_${b}_2_1`];
    tabs[`lmListings_${b}_2_0`] = { items: {} };
    tabs[`lmListings_${b}_2_1`] = { items: {} };
    meta.parts.catalog[b] = [];
    skus.forEach((sku, i) => { tabs[meta.parts.listings[b][0]].items[sku] = L[b][sku]; void i; void half; });
  });
  // a listing must be found by lmHash_(sku) % parts: put each SKU in its own part
  const hash = s => { s = String(s); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  ['SP', 'CPC'].forEach(b => { const all = Object.assign({}, tabs[meta.parts.listings[b][0]].items); tabs[meta.parts.listings[b][0]].items = {}; Object.keys(all).forEach(sku => { tabs[meta.parts.listings[b][hash(sku) % 2]].items[sku] = all[sku]; }); });
  tabs.lmMeta = meta;
  const calls = [], logs = [], triggers = [];
  const answer = opts.answer || {};
  const claude = (body) => {
    const user = typeof body.messages[0].content === 'string' ? body.messages[0].content : body.messages[0].content.map(c => c.text || '').join('');
    const task = (user.match(/^TASK: (\w+)/) || [])[1];
    calls.push({ task, model: body.model, user, body });
    let j;
    if (answer[task]) j = answer[task](user, body);
    else if (task === 'style_notes') j = { notes: ['Titles start with the brand, then the product', 'Sizes like "60 x 90 Inch"'] };
    else if (task === 'style_guide') j = { title_pattern: 'Brand Product Shape Material Size Print - Colour', title_length: '70-75 characters', size_style: '"60 x 90 Inch"', colour_shape_material: 'colour last, after " - "',
      bullets: ['Hand Block Print: …', '100% Cotton: …', 'Size: …', 'Care: …', 'Uses: …'], description: 'two short paragraphs', always: ['Hand Block Print', '100% Cotton', 'Organic Bamboo Silk'], never: ['cheap'],
      examples: ['Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch Hand Block Print - Blue 1', 'An Invented Title That Is Not Ours'] };
    else if (task === 'title') j = { title: 'Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch Hand Block Print - Blue', why: 'x' };
    else if (task === 'bullets') j = { bullets: ['a', 'b', 'c', 'd', 'e'], why: 'x' };
    else if (task === 'description') j = { description: 'A description.', why: 'x' };
    else if (task === 'kw') j = { kw: 'serviettes party', why: 'x' };
    else if (task === 'season') j = { text: 'Christmas table linen', why: 'x' };
    else if (task === 'aplus_text') j = { headline: 'Printed by hand', blocks: [{ heading: 'Craft', body: 'By hand.' }], why: 'x' };
    else if (task === 'ip_rewrite') j = { sentence: 'Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch Hand Block Print', why: 'x' };
    else if (task === 'fix_first') j = { items: [{ sku: 'TC-1', line: 'Hidden from search and has 5 in stock' }, { sku: 'NOT-SENT', line: 'x' }], why: 'x' };
    else if (task === 'title_template') j = { template: '{brand} {product} {shape} {material} {size} Inch {pattern} - {color}', why: 'x' };
    else if (task === 'bsr_why') j = { summary: 'Rank fell after the price went up.', reasons: ['price up 20%'], missing: ['ads spend'], why: 'x' };
    else if (task === 'category_suggest') j = { id: '1063916', reason: 'Its siblings are in Tablecloths.', why: 'x' };
    else if (task === 'change_result') j = { verdict: 'better', line: 'Sessions 400 → 520, units 20 → 31.', why: 'x' };
    else if (task === 'bundle_ideas') j = { pairs: [{ a: 'TC-1', b: 'NP-1', why: 'bought together 30 times' }], others: [{ asin: 'B0OTHER001', why: 'candles beside 12 of ours' }], why: 'x' };
    else j = { why: 'x' };
    return { model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(j) }], usage: { input_tokens: 2000, output_tokens: 500 } };
  };
  const env = {
    prop_: k => (props[k] == null ? '' : String(props[k]).trim()),
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props[k] == null ? null : props[k]), setProperty: (k, v) => { props[k] = String(v); } }) },
    lmGet_: name => (tabs[name] ? JSON.parse(JSON.stringify(tabs[name])) : null), lmPut_: (name, obj) => { tabs[name] = JSON.parse(JSON.stringify(obj)); return 1; },
    lmHash_: hash, LM_BRANDS: ['SP', 'CPC'], setBrand_: b => b,
    listingAuditFrom_: () => ({ ok: true }), listingKeywords_: () => ({ ok: false }),
    UrlFetchApp: { fetch: (url, o) => { const r = claude(JSON.parse(o.payload)); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(r) }; } },
    Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 7).replace('-', ''), computeDigest: (a, s) => [...Buffer.from(require('crypto').createHash('sha256').update(String(s)).digest())],
      base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'), DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 } },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' }, CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ScriptApp: { getProjectTriggers: () => triggers.slice(), deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: fn => ({ timeBased: () => ({ after: ms => ({ create: () => { triggers.push({ fn, ms, getHandlerFunction: () => fn }); } }) }) }) },
    Logger: { log: s => logs.push(String(s)) },
  };
  const names = ['aiTest', 'aiAsk_', 'aiLearnStyle', 'aiLearnStyleTick', 'aiStyleListings_', 'aiStyleFor_', 'aiMonth_', 'aiMonthKey_', 'AI_SYSTEM', 'AI_STYLE_BATCH'];
  const api = new Function(...Object.keys(env), GS + '\n;return {' + names.join(',') + '};')(...Object.values(env));
  return Object.assign(api, { props, tabs, calls, logs, triggers, L });
}
const TOTAL = 130 + 70 + 5;

console.log('== learning: every listing, grouped by product type, good examples first ==');
{
  const S = sandbox();
  const st = S.aiLearnStyle();
  const n = S.aiStyleListings_();
  ok(`every listing of both brands is read (${TOTAL}; the parent left out), grouped by product type: TABLECLOTH 130, NAPKIN 70, PLACEMAT 5`,
    n.n === TOTAL && n.groups.TABLECLOTH.length === 130 && n.groups.NAPKIN.length === 70 && n.groups.PLACEMAT.length === 5, JSON.stringify({ n: n.n, k: Object.keys(n.groups) }));
  const notes = S.calls.filter(c => c.task === 'style_notes'), guides = S.calls.filter(c => c.task === 'style_guide');
  ok('Haiku reads them in batches of 60 (3 + 2 + 1 = 6 calls), Sonnet writes one guide per product type (3)', notes.length === 6 && notes.every(c => /haiku/.test(c.model)) && guides.length === 3 && guides.every(c => /sonnet/.test(c.model)),
    notes.length + ' / ' + guides.length);
  const first = JSON.parse(notes[0].user.replace(/^TASK: style_notes\nFACTS: /, ''));
  ok('…the good examples (live, in stock, no Amazon error) come first and are marked, so they count more', first.listings.slice(0, 50).every(x => x.good === 1) && first.listings.some(x => 'good' in x), first.listings.slice(0, 5).map(x => x.good).join());
  const tab = S.tabs.lmAiStyle;
  const g = tab.guides.TABLECLOTH;
  ok('saved in the tab lmAiStyle: status "draft", the date, listings read, the cost of the run', tab.status === 'draft' && tab.read === TOTAL && tab.costUsd > 0 && g.status === 'draft' && g.n === 130 && g.good > 0 && g.at > 0 && Object.keys(tab.guides).length === 3,
    JSON.stringify({ status: tab.status, read: tab.read, cost: tab.costUsd, n: g.n, good: g.good }));
  ok('never an invented word or title: "Organic Bamboo Silk" (not in our listings) is dropped from "always"; only our real titles are examples',
    g.guide.always.join() === 'Hand Block Print,100% Cotton' && g.guide.examples.length === 1 && g.guide.examples[0] === 'Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch Hand Block Print - Blue 1', JSON.stringify(g.guide));
  ok('…the guide asks only for what is in our listings: the Sonnet call gets our notes and our own best titles', JSON.parse(guides[0].user.replace(/^TASK: style_guide\nFACTS: /, '')).bestTitles.every(t => /^Ridhi Tablecloth/.test(t)));
  ok('finished: the timer removed, the state says finished', st.finished === true && S.triggers.length === 0);
}

console.log('== learning stops at the $80 limit ==');
{
  const key = 'AI_USAGE_' + new Date().toISOString().slice(0, 7).replace('-', '');
  const S0 = sandbox({ props: { [key]: JSON.stringify({ usd: 79.99, calls: 1 }) } });
  ok('$79.99 spent: not started (it would go over), nothing asked of Claude', S0.aiLearnStyle() === null && S0.calls.length === 0 && S0.logs.some(l => /not started/.test(l)), S0.logs.join(' | '));
  // enough to start, not enough to finish: it stops on the way and says so
  // enough to start; then other AI use this month (another person) takes the rest while it learns: it stops before going over
  let S1 = null;
  S1 = sandbox({ props: { [key]: JSON.stringify({ usd: 79.0, calls: 1 }) }, answer: { style_notes: () => { const u = JSON.parse(S1.props[key]); if (u.usd < 79.9) S1.props[key] = JSON.stringify(Object.assign(u, { usd: 79.95 })); return { notes: ['n'] }; } } });
  const st = S1.aiLearnStyle();
  ok('…spending runs out on the way: it stops before going over, says "Monthly AI limit reached", the tab says "stopped"', st === null || (!!st.stopped && /Monthly AI limit reached/.test(st.stopped) && S1.tabs.lmAiStyle.status === 'stopped' && S1.aiMonth_().usd <= 80),
    JSON.stringify(st && { stopped: st.stopped, usd: S1.aiMonth_().usd }));
  const S2 = sandbox({ props: { [key]: JSON.stringify({ usd: 79.99 }) } });
  const r = S2.aiAsk_({ task: 'learn_style', brand: 'SP' });
  ok('Learn again from the page is budget-checked: "Monthly AI limit reached — learning would cost about …"', !r.ok && /Monthly AI limit reached — learning would cost about \$/.test(r.reason) && S2.calls.length === 0, JSON.stringify(r));
  const S3 = sandbox();
  const r3 = S3.aiAsk_({ task: 'learn_style', brand: 'SP' });
  ok('…within the budget it starts on a timer (the request does not wait for it): started, the estimate, 205 listings, 3 product types', r3.ok && r3.started && r3.listings === TOTAL && r3.productTypes === 3 && S3.triggers.length === 1 && S3.calls.length === 0, JSON.stringify(r3));
}

console.log('== a guide is used ONLY when approved; then in every writing task ==');
{
  const S = sandbox();
  S.aiLearnStyle();
  const at = S.tabs.lmAiStyle.guides.TABLECLOTH.at;
  const ask = (task, extra) => { S.calls.length = 0; const r = S.aiAsk_(Object.assign({ task, brand: 'SP', sku: 'TC-1' }, extra || {})); return { r, user: (S.calls[0] || {}).user || '' }; };
  let x = ask('title');
  ok('no approved guide (nothing sent): the title works as before — no house style in the prompt, "style": null', x.r.ok && !/houseStyle/.test(x.user) && x.r.style === null, JSON.stringify(x.r).slice(0, 200));
  x = ask('title', { style: 'TABLECLOTH@' + at });
  ok('approved (the page sends TABLECLOTH@<the guide\'s date>): the guide is in the prompt, the answer says which', x.r.ok && /houseStyle/.test(x.user) && /House style for TABLECLOTH/.test(x.user) && x.r.style && x.r.style.pt === 'TABLECLOTH' && x.r.style.at === at, x.user.slice(0, 200));
  x = ask('title', { style: 'TABLECLOTH@' + (at - 1) });
  ok('a guide learnt again since it was approved (another date): not used until approved again', x.r.ok && !/houseStyle/.test(x.user) && x.r.style === null);
  x = S.aiAsk_({ task: 'title', brand: 'SP', sku: 'NP-1', style: 'TABLECLOTH@' + at });
  ok('another product type\'s guide is never used (a napkin with the tablecloth guide named)', x.ok && x.style === null);
  const tasks = [['title'], ['bullets'], ['description'], ['kw'], ['season', { season: 'Christmas', field: 'hl' }], ['aplus_text'], ['ip_rewrite', { word: 'Hand Block Print', field: 'title' }]];
  const used = tasks.map(([t, e]) => { const y = ask(t, Object.assign({ style: 'TABLECLOTH@' + at }, e || {})); return t + ':' + (y.r.ok && /houseStyle/.test(y.user) ? 'yes' : 'NO ' + (y.r.reason || '')); });
  ok('every writing task (title, bullets, description, kw, season Item Highlights, aplus_text, ip_rewrite) gets the approved guide', used.every(u => /:yes$/.test(u)), used.join(' · '));
  const sys = S.AI_SYSTEM.replace(/\s+/g, ' ');
  ok('the system prompt carries the house style sentence exactly', sys.includes('write in our house style (pattern, order, tone, words we always use). Then improve it with your own Amazon knowledge — stronger search words, clearer benefits, better readability — but never break our house style, our rules or our protected words, and never invent facts.'), sys.slice(sys.indexOf('HOUSE STYLE'), sys.indexOf('HOUSE STYLE') + 300));
  const ro = ask('error_explain', { style: 'TABLECLOTH@' + at });
  ok('a read-only task (explain an error) never gets it', !/houseStyle/.test(ro.user));
}

console.log('== who we are, the product type, aiTest ==');
{
  const S = sandbox({ props: { AI_TEST_SKU: 'TC-1' } });
  const sys = S.AI_SYSTEM.replace(/\s+/g, ' ');
  ok("the system prompt: hand block print home textiles AND clothing; the listing's own product type decides the style and words (dresses: style, fit, size, fabric; tablecloths: shape, size, material); never invent",
    sys.includes('hand block print home textiles and clothing') && sys.includes('FACTS.productType') && sys.includes('clothing (DRESS') && sys.includes('style, fit') && sys.includes('shape, size, material') && sys.includes('never invent a fit, size, fabric'));
  S.aiTest();
  const q = S.calls.find(c => c.task === 'title');
  const f = q ? JSON.parse(q.user.replace(/^TASK: title\nFACTS: /, '')) : {};
  ok("aiTest() sends the protected words of its listing's title, as the page does (Ridhi, Hand Block Print, Blue, Cotton, 100% Cotton, 60 x 90 Inch)", ['Ridhi', 'Hand Block Print', 'Blue', '100% Cotton', '60 x 90 Inch'].every(w => (f.words || []).includes(w)) && S.logs.some(l => /protected words sent/.test(l)), JSON.stringify(f.words));
}

console.log('== the page tasks check what the AI answers ==');
{
  const S = sandbox();
  const page = (task, d, extra) => { S.calls.length = 0; return S.aiAsk_(Object.assign({ task, brand: 'SP', d: JSON.stringify(d) }, extra || {})); };
  let r = page('fix_first', { items: [{ sku: 'TC-1', level: 'crit', problems: ['Suppressed'], stock: 5 }, { sku: 'TC-2', level: 'imp', problems: ['A+ missing'], stock: 9 }] });
  ok('fix_first: no SKU needed; only the SKUs sent come back (an invented one is dropped), one line each', r.ok && r.result.items.length === 1 && r.result.items[0].sku === 'TC-1' && /haiku/.test(S.calls[0].model), JSON.stringify(r));
  r = page('fix_first', { items: [] });
  ok('…nothing to choose from: said, no call', !r.ok && /Nothing Critical or Important/.test(r.reason) && !S.calls.length);
  r = page('category_suggest', { options: [{ id: '1063916', path: 'Tablecloths' }, { id: '3734591', path: 'Table Runners' }] });
  ok('category_suggest: one of the ids Sellora sent', r.ok && r.result.id === '1063916' && r.result.path === 'Tablecloths');
  r = page('category_suggest', { options: [{ id: '3734591', path: 'Table Runners' }] });
  ok('…an id that was not offered is refused', !r.ok && /not one of the options/.test(r.reason), JSON.stringify(r));
  r = page('change_result', { before: { days: 14, sessions: 400, units: 20 }, after: { days: 7, sessions: 100, units: 4 } });
  ok('change_result: under 14 days after → "Not enough data yet", no Claude call, no cost', r.ok && r.result.verdict === 'not enough data yet' && /Not enough data yet/.test(r.result.line) && !S.calls.length && r.costUsd === 0, JSON.stringify(r));
  r = page('change_result', { before: { days: 14, sessions: 400, units: 20 }, after: { days: 14, sessions: 520, units: 31 } });
  ok('…with 14 days each side: the verdict and the numbers (Haiku)', r.ok && r.result.verdict === 'better' && /Haiku|haiku/.test(S.calls[0].model));
  r = page('title_template', {}, { pt: 'PLACEMAT', brand: 'CPC' });
  ok('title_template: our own titles of that product type are the examples; only known parts', r.ok && /\{brand\}/.test(r.result.template) && JSON.parse(S.calls[0].user.replace(/^TASK: title_template\nFACTS: /, '')).examples.every(t => /^CPC Placemats/.test(t)), JSON.stringify(r).slice(0, 300));
  const S2 = sandbox({ answer: { title_template: () => ({ template: '{brand} {product} {occasions} {size}', why: '' }) } });
  r = S2.aiAsk_({ task: 'title_template', brand: 'CPC', pt: 'PLACEMAT' });
  ok('…a part Sellora does not have ({occasions}: seasons never go into titles) → refused', !r.ok && /parts Sellora does not have/.test(r.reason));
  r = page('bsr_why', { weekA: { week: '2026-W46', rank: 900 } });
  ok('bsr_why: two weeks are needed — said, no guess', !r.ok && /Two weeks of rank/.test(r.reason) && !S.calls.length);
  r = page('bsr_why', { weekA: { week: '2026-W46', rank: 900 }, weekB: { week: '2026-W45', rank: 400 }, changes: ['Price up 20%'] });
  ok('…with both weeks: a summary, the reasons, what is missing', r.ok && /price/i.test(r.result.summary) && r.result.missing.length === 1);
  r = page('bundle_ideas', { ours: [{ asin: 'A+B', name: 'TC-1 + NP-1', n: 30 }], others: [] });
  ok('bundle_ideas: pairs of ours and others bought with ours (ideas only)', r.ok && r.result.pairs.length === 1 && r.result.others.length === 1);
  r = S.aiAsk_({ task: 'style_notes', brand: 'SP', sku: 'TC-1' });
  ok('the learning\'s own steps can never be asked for from the page', !r.ok && /Unknown AI task/.test(r.reason));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
