/* Create Listing & Pre-Submit Check (roadmap #8, 20 Nov 2026): src/app/listing/create-listing.js over the real Listing Rules, ListingMatch
 * reader, Workspace, Fix all, the one send path, Listing History, the shared AI file (listing-ai.js) and the priority file, in a stub page,
 * with a mocked backend (GET ?ai=ask, ?lfix=get / schema; POST lcreate=put answered here — no Amazon, no Claude).
 *   node tests/create-listing-test.js
 * Checks: a clone fills the fields (never the pictures or the product id); the required fields, grouped, Filled / Missing; the shared
 * rules block a bad title, long search terms and another brand's name (and Create stays disabled); ✨ AI write uses the shared aiAsk with
 * the approved house style, and is hidden when AI is off; Check with Amazon on the test site says so (no fake pass); Create is disabled
 * on the test site and on a local copy, and on live goes through the one send path (Amazon's check → approve → send → Listing History
 * "Created"); the draft survives a reload and Clear draft empties it; nothing is asked of Amazon or the AI when the screen opens. */
const fs = require('fs'), path = require('path');
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 700) : '')); } };
const H = 3600000;
const IST = ms => new Date(ms + 5.5 * H).toISOString().slice(0, 16).replace('T', ' ');
const A = sku => 'B0' + sku.replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(8, 'X').slice(0, 8);
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const GOOD = (size, color) => `Ridhi Cloth Napkins 100% Cotton ${size} Inch Block Print - ${color}`;
const B5 = ['Soft cotton: a soft, thick cotton that feels good in the hand and gets softer with every wash, the way a good napkin should.',
  'Hand block printed: each napkin is printed by hand with carved wooden blocks, so every piece is a little different from the next one.',
  'Set of six: six napkins of 18 x 18 inches each, enough for a family dinner or a small party, folded and ready to use from the box.',
  'Easy care: machine wash cold with like colours and tumble dry low; iron warm if you like them crisp for a dinner with friends.',
  'For every table: everyday meals, holidays, picnics and brunch — the colour goes well with plain plates and with patterned ones.'];
const KIDS = [
  { sku: 'NP-1', p: 'NP-P', t: GOOD('18 x 18', 'Blue'), kw: 'dinner napkins reusable washable table linen', color: 'Blue', size: '18x18' },
  { sku: 'NP-2', p: 'NP-P', t: GOOD('18 x 18', 'Red'), kw: 'dinner napkins', color: 'Red', size: '18x18' },
];
const SCHEMA_REQ = ['item_name', 'brand', 'item_type_keyword', 'externally_assigned_product_identifier', 'purchasable_offer', 'color', 'item_package_weight', 'bullet_point'];
const AIR = { calls: [], status: 'ready' };
const aiFetch = async url => {
  const q = Object.fromEntries(new URL(String(url)).searchParams.entries());
  if (q.task === 'status') return { text: async () => JSON.stringify({ ok: true, ready: AIR.status === 'ready', monthUsd: 1, limitUsd: 80 }) };
  AIR.calls.push(q);
  const res = { title: { title: GOOD('18 x 18', 'Sage') }, bullets: { bullets: B5.map(b => b.replace('18 x 18', '18 x 18')) }, description: { description: 'Printed by hand with carved wooden blocks on soft cotton. Each napkin is a little different.\n\nSet of six, 18 x 18 inches. Machine wash cold.' },
    kw: { kw: 'serviettes party wedding kitchen everyday picnic brunch holiday' } }[q.task] || {};
  return { text: async () => JSON.stringify({ ok: true, task: q.task, result: res, why: 'x', model: 'claude-sonnet-5-5', costUsd: 0.01, monthUsd: 1, limitUsd: 80,
    style: q.style ? { pt: q.style.split('@')[0], at: Number(q.style.split('@')[1]) } : null }) };
};
function cacheOf(at) {
  const items = {}, cat = {};
  KIDS.forEach(k => {
    items[k.sku] = { sku: k.sku, asin: A(k.sku), b: 'SP', as: 'BUYABLE,DISCOVERABLE', pt: 'NAPKIN', t: k.t, bl: B5, d: 'A plain description of the product, long enough to be a description of it. '.repeat(4), hl: [], kw: k.kw,
      lvl: 'child', psku: k.p, theme: 'COLOR_NAME', itk: 'cloth-napkins', va: { color: k.color, material: 'Cotton', size: k.size }, img: {}, iss: [], readAt: at, rs: 'Active', price: 20, ch: 'AMAZON_NA', rAt: at, fba: 5, fyp: null, inSupReport: false, sup: null };
    cat[A(k.sku)] = { asin: A(k.sku), t: k.t, brand: '', img: {}, pa: [A(k.p)], kids: [], theme: 'COLOR_NAME', tattrs: [], vals: {}, bc: 'Home & Kitchen', rk: { main: null, sub: null }, aplus: null, readAt: at };
  });
  const meta = { v: 2, kind: 'full', startedAt: IST(at), finishedAt: IST(at), upTo: IST(at), lastFull: { finishedAt: IST(at), brands: ['SP', 'CPC'], gaveUp: [] }, hash: 'h9',
    parts: { listings: { SP: ['lmListings_SP_1_0'], CPC: ['lmListings_CPC_1_0'] }, catalog: { SP: ['lmCatalog_SP_1_0'], CPC: ['lmCatalog_CPC_1_0'] } } };
  return { lmMeta: meta, lmListings_SP_1_0: { b: 'SP', items }, lmCatalog_SP_1_0: { b: 'SP', items: cat }, lmListings_CPC_1_0: { b: 'CPC', items: {} }, lmCatalog_CPC_1_0: { b: 'CPC', items: {} } };
}
const memStore = () => { let v = null; return { get: async () => (v ? JSON.parse(JSON.stringify(v)) : null), put: async x => { v = JSON.parse(JSON.stringify(x)); }, del: async () => { v = null; }, peek: () => v }; };

async function setup(opts) {
  opts = opts || {};
  const now = Date.now();
  const tabs = cacheOf(now - H);
  const saved = [];
  let C;
  const baCall = async q => {
    C.asked.push(q);
    if (q.cache) { const d = tabs[q.cache]; if (!d) throw new Error('nothing cached'); return { ok: true, name: q.cache, data: JSON.parse(JSON.stringify(d)) }; }
    if (q.lfix === 'get') {
      const k = KIDS.find(x => x.sku === q.sku) || { t: 'New', color: 'Sage', size: '18x18' };
      return { ok: true, productType: 'NAPKIN', status: ['BUYABLE'], issues: [], sku: q.sku, asin: A(q.sku), title: k.t,
        attributes: { item_name: [{ value: k.t, language_tag: 'en_US' }], brand: [{ value: 'Ridhi', language_tag: 'en_US' }], item_type_keyword: [{ value: 'cloth-napkins' }], color: [{ value: k.color, language_tag: 'en_US' }],
          material: [{ value: 'Cotton', language_tag: 'en_US' }], main_product_image_locator: [{ media_location: 'https://x/y.jpg' }], externally_assigned_product_identifier: [{ type: 'upc', value: '012345678905' }],
          item_package_weight: [{ value: 0.5, unit: 'pounds' }], fulfillment_availability: [{ fulfillment_channel_code: 'AMAZON_NA' }] } };
    }
    if (q.lfix === 'schema') {
      const names = String(q.attrs).split(',');
      if (/^zz_sellora_required_/.test(names[0])) return { ok: true, productType: 'NAPKIN', attrs: { [names[0]]: { missing: true }, _required: SCHEMA_REQ } };
      const shape = n => (n === 'item_package_weight' || n === 'purchasable_offer' || n === 'externally_assigned_product_identifier' ? { name: n, title: n.replace(/_/g, ' '), fields: [{ field: 'value' }, { field: 'unit' }] }
        : { name: n, title: n.replace(/_/g, ' '), fields: [{ field: 'value', type: 'string' }] });
      return { ok: true, productType: 'NAPKIN', attrs: Object.fromEntries(names.map(n => [n, shape(n)])) };
    }
    return {};
  };
  C = load({ lm: true, ws: true, sp: true, fa: true, lh: true, ai: true, pr: true, cl: true, baCall, window: opts.window,
    post: body => (body.lcreate ? (opts.amz ? opts.amz(body) : { ok: true, status: body.apply ? 'ACCEPTED' : 'VALID', issues: [], submissionId: 'sub-' + body.sku }) : { ok: true, status: 'ACCEPTED' }),
    setDoc: async (ref, data) => { saved.push({ path: ref.path, data: JSON.parse(JSON.stringify(data)) }); },
    ctx: Object.assign({ imOnly() {}, leOnly() {}, leShow() {}, leListEnsure() {}, imListRender() {}, ME: { email: 'vishesh.g@example.com' }, parentName: (b, asin, f) => f,
      fetch: aiFetch, API: { url: 'https://backend.test/exec', key: 'k' }, sessionStorage: { getItem: () => null, setItem() {} } }, opts.ctx || {}) });
  C.asked = [];
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.FA.log = [];
  C.HEALTH.SP = { at: new Date(), rows: KIDS.map(k => ({ brand: 'SP', sku: k.sku, asin: A(k.sku), parent: A(k.p), title: k.t, qty: 5, status: 'Active', channel: 'AMAZON_NA', price: 20, aplus: true, aplusAt: now, checked: now,
    content: { titleLen: k.t.length, images: 8, bullets: 5, descLen: 300, title: k.t } })) };
  C.HEALTH.CPC = { at: new Date(), rows: [] };
  C.setCat('SP', Object.fromEntries(KIDS.map(k => [k.sku, { subcat: 'Napkin Set', color: k.color, size: k.size }])));
  const mem = { copy: null };
  C.lmStoreUse({ get: async () => mem.copy, put: async c => { mem.copy = JSON.parse(JSON.stringify(c)); return true; } });
  await C.lmEnsure();
  await C.lmRefresh();
  C.reset();
  C.clStoreUse(opts.store || memStore());
  if (C.aiStatusCheck) await C.aiStatusCheck();
  return { C, saved };
}
const html = C => { C.clDraw(); return C.el('clPane').innerHTML; };
const fillGood = C => { const L = C.getCL(); Object.assign(L, { sku: 'NP-9', colour: 'Sage', size: '18x18', price: '24.99', title: GOOD('18 x 18', 'Sage'), bullets: B5.slice(), kw: 'serviettes party wedding kitchen' }); };

(async () => {
  console.log('== opening the screen: the draft only — nothing asked of Amazon or the AI ==');
  {
    AIR.calls.length = 0;
    const { C } = await setup();
    const before = C.asked.length;
    await C.clOpen();
    ok('the screen draws its six steps; no Amazon read, no AI call on opening', /1 · Start/.test(html(C)) && /6 · Create/.test(html(C)) && C.asked.length === before && AIR.calls.length === 0);
    ok('"From a Research product" is greyed out: "No research records yet" (none is kept — never invented)', /<button type="button" class="ghost im-b" disabled[^>]*>No research records yet<\/button>/.test(html(C)) && C.clResearch().length === 0);
  }

  console.log('== clone an existing SKU ==');
  const T = await setup();
  const C = T.C;
  {
    ok('Copy from NP-1: product type, parent, theme, title, bullets, description, search terms and the attributes Sellora holds', C.clClone('NP-1') && C.getCL().pt === 'NAPKIN' && C.getCL().parentSku === 'NP-P' && C.getCL().theme === 'COLOR_NAME'
      && C.getCL().title === GOOD('18 x 18', 'Blue') && C.getCL().bullets.length === 5 && C.getCL().attrs.color[0].value === 'Blue' && C.getCL().attrs.material[0].value === 'Cotton' && C.getCL().parentAsin === A('NP-P'), JSON.stringify(C.getCL()).slice(0, 300));
    ok('…a SKU Sellora does not hold is said plainly', !C.clClone('NOPE-1') && /not in the auto refresh data/.test(C.getCL().msg));
    C.clClone('NP-1');
    await C.clReadAll();
    const a = C.getCL().attrs;
    ok('Read every attribute from Amazon (a click): all of them — but never its pictures or its product identifier', a.brand[0].value === 'Ridhi' && a.item_package_weight && !a.main_product_image_locator && !a.externally_assigned_product_identifier && C.getCL().readAll, Object.keys(a).join());
  }

  console.log('== the required fields: grouped, Filled / Missing; the rest under "Good to fill" ==');
  {
    await C.clSchemaRead();
    const req = C.clRequired();
    const by = g => req.filter(r => r.group === g).map(r => r.name).sort().join();
    ok('the product type\'s required list read through the existing ?lfix=schema (no new route)', C.getCL().schema && C.getCL().schema.required.length === SCHEMA_REQ.length && C.asked.filter(q => q.lfix === 'schema').length === 2);
    ok('grouped: Basics (brand, item type, product id) · Variation (colour) · Content (title, bullets) · Offer (price) · Shipping (package weight)',
      by('Basics') === 'brand,externally_assigned_product_identifier,item_type_keyword' && by('Variation') === 'color' && by('Content') === 'bullet_point,item_name' && by('Offer') === 'purchasable_offer' && by('Shipping') === 'item_package_weight', req.map(r => r.group + ':' + r.name).join(' '));
    const miss = req.filter(r => !r.filled).map(r => r.name).sort();
    ok('Missing before the new values: the product id (never copied), the price', miss.join() === 'externally_assigned_product_identifier,purchasable_offer', miss.join());
    const h = html(C);
    ok('…shown as Filled / Missing, in that order of groups, with the rest folded under "Good to fill"', /✕ Missing/.test(h) && /✓ Filled/.test(h) && /<summary>Good to fill \(\d+\)<\/summary>/.test(h) && h.indexOf('>Basics ') < h.indexOf('>Variation ') && h.indexOf('>Variation ') < h.indexOf('>Offer '));
    C.getCL().price = '24.99';
    C.getCL().fields.externally_assigned_product_identifier = '036000291452';
    ok('the price and the new listing\'s own UPC typed → every required field Filled', C.clRequired().every(r => r.filled), C.clRequired().filter(r => !r.filled).map(r => r.name).join());
  }

  console.log('== our rules block a bad title, long search terms, another brand\'s name (the shared aiCheck) ==');
  {
    fillGood(C);
    let pre = C.clPreSubmit();
    ok('a good new listing: every check passes (title rules, bullets, description, search terms, SKU, price, colour, required fields)', pre.pass, pre.checks.filter(x => !x.ok).map(x => x.t + ': ' + x.why).join(' | '));
    const L = C.getCL();
    L.title = 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch - Sage Pottery Barn Style Set For Dinner Parties And More';
    let chk = C.clChecks();
    ok('a bad title: over 75 · Block Print left out · another brand\'s name — red, with its priority chip', !chk.title.pass && chk.title.fails.some(f => /over 75/.test(f)) && chk.title.fails.some(f => /Block Print/.test(f)) && chk.title.fails.some(f => /Pottery Barn/.test(f))
      && /pr-chip[^"]*is-r[^>]*>🔴 Critical/.test(html(C)), chk.title.fails.join(' | '));
    ok('…and Create is disabled', !C.clPreSubmit().pass && /<button type="button" data-cl="create"[^>]*disabled/.test(html(C)));
    L.title = GOOD('18 x 18', 'Sage');
    L.kw = 'serviettes ' + 'w'.repeat(260);
    chk = C.clChecks();
    ok('search terms over 249 bytes → red', !chk.kw.pass && chk.kw.fails.some(f => /bytes, over 249/.test(f)), chk.kw.fails.join(' | '));
    L.kw = 'serviettes party';
    L.bullets[1] = 'A Disney print on soft cotton for a dinner party with family and friends, printed by hand with carved blocks.';
    chk = C.clChecks();
    ok('another brand\'s name in a bullet → red', !chk.bullets.pass && chk.bullets.fails.some(f => /Disney/.test(f)), chk.bullets.fails.join(' | '));
    L.bullets = B5.slice();
    L.colour = 'Red';
    pre = C.clPreSubmit();
    ok('a colour and size a sibling already has (NP-2 is Red 18x18) → "already has this colour and size"', !pre.pass && pre.checks.some(x => /already has this colour and size/.test(x.why)), pre.checks.map(x => x.why).join(' | '));
    L.colour = 'Sage';
    L.sku = 'NP-2';
    ok('a SKU that is already ours → "already a listing of ours"', C.clPreSubmit().checks.some(x => /already a listing of ours/.test(x.why)));
    L.sku = 'NP-9';
  }

  console.log('== ✨ AI write: hidden when AI is off; the shared aiAsk with the approved house style ==');
  {
    ok('AI set up: the "✨ AI write" button is there', /data-cl="ai"/.test(html(C)));
    C.AI.styleOk = { NAPKIN: { at: 1763600000000, approvedAt: Date.now(), name: 'V' } };
    AIR.calls.length = 0;
    await C.clAiWrite();
    const q = AIR.calls;
    ok('four calls through the shared aiAsk: title, bullets, description, search terms — for the new SKU, its colour and size, cloned from NP-1', q.map(x => x.task).join() === 'title,bullets,description,kw'
      && q.every(x => x.sku === 'NP-1' && x.newsku === 'NP-9' && x.colour === 'Sage' && x.size === '18x18'), JSON.stringify(q[0]));
    ok('…each with the APPROVED house style of the product type (&style=NAPKIN@…)', q.every(x => x.style === 'NAPKIN@1763600000000'));
    const h = html(C);
    ok('the suggestions show beside the fields, judged by the same rules, "Use it" only when they pass; "Follows: napkin house style"', /✨ AI suggestion/.test(h) && /Follows: napkin house style/.test(strip(h)) && C.clAiCheck('title').pass && /data-cl="aiuse" data-cl-f="title">Use it/.test(h));
    ok('Use it → the title box takes the suggestion', C.clAiUse('title') && C.getCL().title === GOOD('18 x 18', 'Sage'));
    const { C: off } = await (async () => { AIR.status = 'off'; const t = await setup(); AIR.status = 'ready'; return t; })();
    off.clClone('NP-1');
    ok('AI not set up: no "✨ AI write" button at all', !/data-cl="ai"/.test(html(off)) && !/AI write/.test(html(off)));
  }

  console.log('== Check with Amazon and Create: never on the test site; on live, the one send path ==');
  {
    const { C: test } = await setup({ window: { __TEST_ERP: true } });
    test.clClone('NP-1');
    await test.clReadAll();
    await test.clSchemaRead();
    fillGood(test);
    test.getCL().fields.externally_assigned_product_identifier = '036000291452';
    await test.clAmazonCheck();
    ok('test site: "Check with Amazon" says "Amazon check runs on live Sellora" — no POST, never a fake pass', test.getCL().amz.test && /Amazon check runs on live Sellora/.test(html(test)) && !test.calls.some(x => x.lcreate));
    ok('test site: Create is disabled, "Test site — not sent to Amazon"', /<button type="button" data-cl="create"[^>]*disabled/.test(html(test)) && /Test site — not sent to Amazon/.test(html(test)) && test.clCreate() === null);
    const { C: local } = await setup({ ctx: { location: { hostname: 'localhost' } } });
    ok('a local copy (localhost): Create disabled too', local.clTestSite() === true);
    // live
    await C.clAmazonCheck();
    ok('live: Check with Amazon = the backend\'s lcreate=put in preview (apply false, nothing created) → "✓ Amazon will accept it"', C.getCL().amz.ok && C.calls.some(x => x.lcreate === 'put' && x.apply === false && x.sku === 'NP-9') && /✓ Amazon will accept it/.test(html(C)));
    const body = C.calls.find(x => x.lcreate === 'put');
    ok('…the new listing: its content, colour, price, parent and theme — no picture, its own UPC only', body.attributes.item_name[0].value === C.getCL().title && body.attributes.color[0].value === 'Sage'
      && body.attributes.purchasable_offer[0].our_price[0].schedule[0].value_with_tax === 24.99 && body.attributes.child_parent_sku_relationship[0].parent_sku === 'NP-P' && body.attributes.variation_theme[0].name === 'COLOR_NAME'
      && !body.attributes.main_product_image_locator && body.attributes.externally_assigned_product_identifier[0].value === '036000291452', JSON.stringify(Object.keys(body.attributes)));
    ok('live: Create is enabled once every check passes', C.clPreSubmit().pass && !/<button type="button" data-cl="create"[^>]*disabled/.test(html(C)));
    const sent = C.clCreate();
    await C.SQ.run.checked;
    ok('Create → THE ONE SEND PATH: Amazon\'s check first (apply false), screen "Create Listing"', C.calls.filter(x => x.lcreate && x.apply === false).length === 2 && !C.calls.some(x => x.lcreate && x.apply === true) && C.SQ.screens.slice(-1)[0] === 'Create Listing');
    await C.sqApprove();
    C.sqClose();
    await sent;
    await new Promise(r => setTimeout(r, 5));
    const rows = T.saved.filter(x => /^history\/listing_/.test(x.path)).flatMap(x => Object.values(x.data.rows));
    const row = rows.find(x => x.sku === 'NP-9');
    ok('…approved: sent once (apply true), read again; Listing History "Created", marked AI suggested (its title came from ✨ AI write) — no Put back (a new SKU has no old value)', C.calls.filter(x => x.lcreate && x.apply === true).length === 1 && !!row && row.field === 'Created' && row.screen === 'Create Listing · AI suggested' && row.ai === true && row.oldV == null,
      JSON.stringify(row));
    ok('after it: "Add pictures in Image Manager" and "Close this listing" (instead of Put back)', /Add pictures in Image Manager/.test(html(C)) && /Close this listing/.test(html(C)), C.getCL().sent && C.getCL().sent.state);
  }

  console.log('== the draft: kept in this browser, back after a reload; Clear draft ==');
  {
    const store = memStore();
    const { C: a } = await setup({ store });
    a.clClone('NP-1');
    Object.assign(a.getCL(), { sku: 'NP-77', colour: 'Mustard', price: '19.50', title: 'my title' });
    await a.clDraftSave();
    const { C: b } = await setup({ store });
    await b.clOpen();
    ok('a reload (a new page, the same browser): the form is back — SKU, colour, price, title, the clone', b.getCL().sku === 'NP-77' && b.getCL().colour === 'Mustard' && b.getCL().price === '19.50' && b.getCL().title === 'my title' && b.getCL().src === 'NP-1' && /Draft restored/.test(html(b)));
    await b.clDraftClear();
    ok('Clear draft: the form is empty and nothing is kept', !b.getCL().sku && !b.getCL().src && store.peek() === null);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
