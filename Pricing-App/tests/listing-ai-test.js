/* ✨ AI writing (19 Nov 2026): src/app/listing/listing-ai.js over the real Listing Rules, ListingMatch reader, Workspace, Season planner,
 * Fix all, Fix all titles / search terms, IP & Trademark Guard, Listing Content, the one send path and Listing History, in a stub page,
 * with a MOCKED backend (GET ?ai=ask answered here — no Claude, no Amazon).
 *   node tests/listing-ai-test.js
 * Checks: one shared function everywhere (only aiAsk asks the backend; every screen draws its button with aiBtnHtml); no call when a page
 * opens; "AI not set up yet" / "Monthly AI limit reached" as a calm grey line, and no more calls after it; every task's answer judged by
 * OUR rules — protected words kept, other brands and restricted claims blocked, sale words blocked, 249 bytes, no title words in search
 * terms, 5 bullets, the title rules (60–75, template, short forms), the season named — with Approve / Use / Copy disabled while a check
 * fails, and enabled again when the AI text is edited to pass; Approve goes through the one send path (Amazon's check → send → Listing
 * History "AI suggested", with the old value for Put back); Use goes into Listing Content's box or a Fix all row; the IP & Trademark
 * Guard's rewrite into the existing Fix all popups; the read-only cards (Explain this error, Check main photo); the A+ draft's Copy. */
const fs = require('fs'), path = require('path');
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 900) : '')); } };
const H = 3600000;
const IST = ms => new Date(ms + 5.5 * H).toISOString().slice(0, 16).replace('T', ' ');
const A = sku => 'B0' + sku.replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(8, 'X').slice(0, 8);
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const wait = async (cond, n) => { for (let i = 0; i < (n || 400) && !cond(); i++) await new Promise(r => setTimeout(r, 1)); };
const SRC = path.join(__dirname, '..', 'src', 'app');

const GOOD = (size, color) => `Ridhi Cloth Napkins 100% Cotton ${size} Inch Block Print - ${color}`;
const B5 = ['Soft cotton: a soft, thick cotton that feels good in the hand and gets softer with every wash, the way a good napkin should.',
  'Hand block printed: each napkin is printed by hand with carved wooden blocks, so every piece is a little different from the next one.',
  'Set of six: six napkins of 18 x 18 inches each, enough for a family dinner or a small party, folded and ready to use from the box.',
  'Easy care: machine wash cold with like colours and tumble dry low; iron warm if you like them crisp for a dinner with friends.',
  'For every table: everyday meals, holidays, picnics and brunch — the colour goes well with plain plates and with patterned ones.'];
const KIDS = [
  { b: 'SP', sku: 'NP-1', p: 'NP-P', qty: 5, t: GOOD('18 x 18', 'Blue'), kw: 'dinner napkins reusable washable table linen', color: 'Blue', size: '18x18' },
  { b: 'SP', sku: 'NP-2', p: 'NP-P', qty: 7, t: GOOD('20 x 20', 'Red'), kw: 'dinner napkins, pottery barn style; table linen, organic cloth', color: 'Red', size: '20x20' },
  { b: 'SP', sku: 'NP-3', p: 'NP-P', qty: 3, t: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Pottery Barn Style - Green', kw: 'dinner napkins',
    bl: [B5[0], 'A Disney-inspired print the children love at every dinner and every party, printed by hand on soft cotton.', B5[2], B5[3], B5[4]], color: 'Green', size: '18x18' },
];

function cacheOf(kids, at) {
  const tabs = {};
  const meta = { v: 2, kind: 'full', startedAt: IST(at - 20 * 60000), finishedAt: IST(at), upTo: IST(at), lastFull: { finishedAt: IST(at), brands: ['SP', 'CPC'], gaveUp: [] }, hash: 'h9', parts: { listings: {}, catalog: {} } };
  ['SP', 'CPC'].forEach(b => {
    const items = {}, cat = {};
    kids.filter(k => k.b === b).forEach(k => {
      items[k.sku] = { sku: k.sku, asin: A(k.sku), b, as: 'BUYABLE,DISCOVERABLE', pt: 'NAPKIN', t: k.t, bl: k.bl || B5, d: k.d || 'A plain description of the product, long enough to be a description of it. '.repeat(4), hl: k.hl || [], kw: k.kw || '',
        lvl: k.p ? 'child' : '', psku: k.p, va: Object.assign({ color: k.color, material: 'Cotton' }, k.size ? { size: k.size } : {}), img: {}, iss: [],
        readAt: at, rs: 'Active', price: 20, ch: 'AMAZON_NA', rAt: at - 30 * 60000, fba: k.qty, fyp: null, inSupReport: false, sup: null };
      cat[A(k.sku)] = { asin: A(k.sku), t: k.t, brand: '', img: { MAIN: { u: `https://m.media-amazon.com/images/I/${k.sku.replace(/\W/g, '')}.jpg`, w: 2000, h: 2000 } }, pa: k.p ? [A(k.p)] : [], kids: [], theme: '', tattrs: [], vals: {},
        bc: 'Home & Kitchen', rk: { main: null, sub: null }, aplus: null, readAt: at };
    });
    tabs[`lmListings_${b}_1_0`] = { b, items };
    tabs[`lmCatalog_${b}_1_0`] = { b, items: cat };
    meta.parts.listings[b] = [`lmListings_${b}_1_0`];
    meta.parts.catalog[b] = [`lmCatalog_${b}_1_0`];
  });
  tabs.lmMeta = meta;
  return tabs;
}

/* ----- THE MOCKED BACKEND: GET ?ai=ask (every other GET is the Sellora backend's usual answers) ----- */
const AIR = { mode: 'on', calls: [], answer: {}, status: 'ready', statusCalls: [] };
// a browser session's storage (the status answer is kept in it for the session)
const aiFetchStyle = null;
const sessionOf = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };
const RESULT = {
  title: () => ({ title: GOOD('18 x 18', 'Blue') }),
  bullets: () => ({ bullets: B5.slice() }),
  description: () => ({ description: 'These napkins are printed by hand with carved wooden blocks on soft cotton. Each one is a little different, which is the charm of a hand block print.\n\nThey are 18 x 18 inches and come as a set of six. Machine wash cold and tumble dry low.' }),
  kw: () => ({ kw: 'serviettes reusable washable dinner party wedding kitchen everyday picnic brunch holiday linen' }),
  season: q => ({ text: 'Christmas dinner table napkins, hand block printed in soft cotton', field: q.field, season: q.season }),
  aplus_text: () => ({ headline: 'Printed by hand in Jaipur', blocks: [{ heading: 'The craft', body: 'Every napkin is printed by hand with carved wooden blocks.' }, { heading: 'The cotton', body: 'Soft cotton that gets softer with every wash.' }, { heading: 'Care', body: 'Machine wash cold, tumble dry low.' }] }),
  ip_rewrite: q => ({ field: q.field, index: 0, before: 'x', sentence: 'y', text: q.field === 'kw' ? 'dinner table linen serviettes' : 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print - Green', word: q.word }),
  error_explain: q => ({ plain: 'Amazon wants a colour on this listing and it has none.', fix: 'Open the listing in Listing Errors and fill in the colour.', screen: 'Listing Errors', code: q.code }),
  fix_first: q => ({ items: JSON.parse(q.d).items.slice(0, 2).map(x => ({ sku: x.sku, line: 'Has ' + x.stock + ' in stock and a problem customers see' })) }),
  title_template: q => ({ template: '{brand} {product} {size} Inch {pattern} - {color}', pt: q.pt, examples: ['Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print - Blue'] }),
  bsr_why: () => ({ summary: 'Rank fell when the price went up.', reasons: ['Price up 20% in week A'], missing: ['ads spend'] }),
  category_suggest: () => ({ id: '1063916', path: 'Tablecloths', reason: 'Its siblings are in Tablecloths.' }),
  change_result: () => ({ verdict: 'not enough data yet', line: 'Not enough data yet — it needs 14 days before and after the change.' }),
  bundle_ideas: () => ({ pairs: [{ a: 'NP-1', b: 'NP-2', why: 'bought together often' }], others: [] }),
  image_check: () => ({ white_background: true, text_or_watermark: true, fill_pct: 70, fills_frame: false, pass: false, notes: 'A logo in the corner; the napkin fills about 70%.', image: 'https://m.media-amazon.com/images/I/NP1.jpg' }),
};
const aiFetch = async url => {
  const q = Object.fromEntries(new URL(String(url)).searchParams.entries());
  if (q.ai !== 'ask') return { text: async () => JSON.stringify({ ok: false, error: 'not mocked' }) };
  // the one status call (no Claude): set up or not, as AIR.status says ('ready' | 'nokey' | 'old' = a backend without the route)
  if (q.task === 'status') {
    AIR.statusCalls.push(q);
    const st = AIR.status === 'old' ? { ok: false, error: 'No ASIN found in "".' } : { ok: true, ready: AIR.status === 'ready', monthUsd: 3.2, limitUsd: 80 };
    return { text: async () => JSON.stringify(st) };
  }
  AIR.calls.push(q);
  let reply;
  if (AIR.mode === 'off') reply = { ok: false, reason: 'AI not set up yet' };
  else if (AIR.mode === 'limit') reply = { ok: false, reason: 'Monthly AI limit reached', monthUsd: 80.02, limitUsd: 80 };
  else if (AIR.mode === 'old') reply = { ok: false, error: 'No ASIN found in "".' };
  else {
    const over = AIR.answer[q.task];
    reply = { ok: true, task: q.task, result: over ? over(q) : RESULT[q.task](q), why: 'Made from the listing\'s own facts.', model: 'claude-sonnet-5-5', costUsd: 0.0123, monthUsd: 3.2, limitUsd: 80, cached: false,
      style: q.style ? { pt: q.style.split('@')[0], at: Number(q.style.split('@')[1]) } : null };
  }
  return { text: async () => JSON.stringify(reply) };
};

let T0offPage = null;
const T0off = () => T0offPage;
async function setup(opts) {
  opts = opts || {};
  const kids = KIDS.map(k => Object.assign({}, k));
  const store = {};
  const saved = [];
  const now = Date.now();
  const at = now - H;
  const net = { tabs: cacheOf(kids, at) };
  let C;
  const kidOf = sku => kids.find(k => k.sku === sku) || {};
  const baCall = async q => {
    C.asked.push(q);
    if (q.cache) {
      const d = net.tabs && net.tabs[q.cache];
      if (!d) throw new Error(`nothing cached for "${q.cache}" yet`);
      return { ok: true, name: q.cache, data: JSON.parse(JSON.stringify(d)) };
    }
    if (q.lfix === 'get') { const k = kidOf(q.sku); return { productType: 'NAPKIN', status: ['BUYABLE', 'DISCOVERABLE'], issues: [], title: k.t,
      attributes: { generic_keyword: [{ value: k.kw, language_tag: 'en_US' }], item_name: [{ value: k.t, language_tag: 'en_US' }], color: [{ value: k.color }], material: [{ value: 'Cotton' }], size: k.size ? [{ value: k.size }] : [] } }; }
    if (q.lfix === 'content') {
      const items = {};
      q.skus.split(',').forEach(sku => { const k = kidOf(sku); items[sku] = { productType: 'NAPKIN', item_name: [{ value: k.t }], bullet_point: (k.bl || B5).map(v => ({ value: v })), product_description: [{ value: 'd'.repeat(300) }], generic_keyword: [{ value: k.kw }] }; });
      return { items };
    }
    return {};
  };
  C = load({ lm: true, ws: true, sp: true, fa: true, lh: true, le: true, ai: opts.ai !== false, pr: opts.ai !== false, baCall,
    getDoc: async ref => { const d = store[ref.path]; return { exists: () => !!d, data: () => JSON.parse(JSON.stringify(d)) }; },
    setDoc: async (ref, data) => { saved.push({ path: ref.path, data: JSON.parse(JSON.stringify(data)) }); store[ref.path] = Object.assign({}, store[ref.path] || {}, data); },
    ctx: { imOnly() {}, imListRender() {}, ME: { email: 'vishesh.g@example.com' }, parentName: (b, asin, fallback) => fallback,
      fetch: aiFetch, API: { url: 'https://backend.test/exec', key: 'read-key' }, sessionStorage: opts.session || sessionOf() } });
  if (C.aiStatusCheck) await C.aiStatusCheck();
  C.asked = [];
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.SP.today = new Date(2026, 11, 10);
  C.FA.log = [];
  ['SP', 'CPC'].forEach(b => { C.LI_WS.schema[b].NAPKIN = { at: now, ok: [], hl: { none: true } }; });
  ['SP', 'CPC'].forEach(b => {
    const mine = kids.filter(k => k.b === b);
    C.HEALTH[b] = { at: new Date(), rows: mine.map(k => ({ brand: b, sku: k.sku, asin: A(k.sku), parent: k.p ? A(k.p) : '', title: k.t, qty: k.qty, status: 'Active', channel: 'AMAZON_NA', price: 20, aplus: true, aplusAt: now, checked: now,
      content: { titleLen: k.t.length, images: 8, bullets: 5, descLen: 300, title: k.t } })) };
    const cat = {};
    mine.forEach(k => { cat[k.sku] = { subcat: 'Napkin Set', color: k.color, size: k.size }; });
    C.setCat(b, cat);
  });
  const mem = { copy: null };
  C.lmStoreUse({ get: async () => mem.copy, put: async c => { mem.copy = JSON.parse(JSON.stringify(c)); return true; } });
  await C.lmEnsure();
  await C.lmRefresh();
  C.reset();
  return { C, saved, store, kids };
}

/* ----- a small page for the cards: a button from aiBtnHtml, its parent, the document that makes the card ----- */
const unq = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function page() {
  const made = [];
  const node = tag => ({ tag, dataset: {}, className: '', innerHTML: '', children: [], style: {}, parentNode: null,
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, insertBefore(c) { this.children.push(c); c.parentNode = this; return c; },
    querySelector(sel) { return sel === '[data-ai]' && /data-ai="/.test(this.innerHTML) ? btnFrom(this.innerHTML, doc, this) : null; }, remove() { this.gone = true; } });
  const doc = { made, createElement: t => { const n = node(t); made.push(n); return n; },
    querySelector: sel => { const m = String(sel).match(/data-ai-card="(.*)"\]$/); return m ? made.find(e => e.dataset.aiCard === m[1] && !e.gone) || null : null; } };
  const block = node('div');
  return { doc, made, block, btn: html => btnFrom(html, doc, null, block) };
}
function btnFrom(html, doc, parent, block) {
  const attr = n => { const m = html.match(new RegExp(n + '="([^"]*)"')); return m ? unq(m[1]) : ''; };
  const grand = { insertBefore(c) { c.parentNode = grand; }, appendChild(c) { c.parentNode = grand; } };
  return { dataset: { ai: attr('data-ai'), aiB: attr('data-ai-b'), aiS: attr('data-ai-s'), aiX: attr('data-ai-x') }, style: {}, disabled: false, ownerDocument: doc,
    parentNode: parent || { parentNode: grand }, closest: sel => (sel === '[data-ai-block]' ? block || null : null) };
}
// Press a ✨ button: { reply, card (its HTML), job }.
async function press(C, P, html) {
  const b = P.btn(html);
  const reply = await C.aiOpen(b);
  const { task, brand, sku, x } = C.aiBtnOf(b);
  const id = [task, brand, sku, x.field || '', x.key || '', x.season || '', x.word || '', x.code || ''].join('|');
  const host = P.doc.querySelector(`[data-ai-card="${id}"]`);
  return { reply, card: host ? host.innerHTML : '', job: C.AI.jobs.get(id), id };
}
const enabled = (card, act) => new RegExp(`data-ai-act="${act}"[^>]*>`).test(card) && !new RegExp(`data-ai-act="${act}"[^>]*disabled`).test(card);
const patches = (C, apply) => C.calls.filter(c => c.lfix === 'patch' && c.apply === apply);

(async () => {
  console.log('== one shared function everywhere ==');
  {
    const files = {};
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) files[path.relative(SRC, p).replace(/\\/g, '/')] = fs.readFileSync(p, 'utf8'); });
    walk(SRC);
    const asks = Object.keys(files).filter(f => /ai: 'ask'|ai=ask|'ai', 'ask'/.test(files[f]));
    ok('only listing-ai.js asks the backend for AI (one aiAsk; no copy anywhere)', asks.join() === 'listing/listing-ai.js', asks.join());
    ok('…and aiAsk is defined once', Object.values(files).reduce((n, s) => n + (s.match(/async function aiAsk\(/g) || []).length, 0) === 1);
    const screens = { 'listing/listing-content.js': ["aiBtnHtml('title'", "aiBtnHtml('bullets'", "aiBtnHtml('description'", "aiBtnHtml('kw'"], 'listing/title-fix.js': ["aiBtnHtml('title'"], 'listing/kw-fix.js': ["aiBtnHtml('kw'"],
      'listing/listing-optimiser.js': ['aiOptCardHtml('], 'listing/season-planner.js': ["aiBtnHtml('season'"], 'listing/aplus-audit.js': ["aiBtnHtml('aplus_text'"], 'listing/ip-guard.js': ["aiBtnHtml('ip_rewrite'"],
      'listing/listing-errors.js': ["aiBtnHtml('error_explain'"], 'listing/image-manager.js': ["aiBtnHtml('image_check'"] };
    const missing = Object.entries(screens).flatMap(([f, list]) => list.filter(s => !(files[f] || '').includes(s)).map(s => f + ' ' + s));
    ok('every screen draws its ✨ button with the shared aiBtnHtml / aiOptCardHtml (8 places, 13 buttons)', !missing.length, missing.join(' · '));
    const order = fs.readFileSync(path.join(SRC, 'ORDER'), 'utf8').split(/\r?\n/).filter(l => l === 'listing/listing-ai.js');
    ok('listing-ai.js is in ORDER once', order.length === 1);
    const gs = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'ListingAI.gs'), 'utf8');
    const code = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'Code.gs'), 'utf8');
    ok('the backend: ListingAI.gs answers ?ai=ask with a whitelist of the 9 tasks; Code.gs has the one route line', /function aiAsk_\(p\)/.test(gs) && ['title', 'bullets', 'description', 'kw', 'season', 'aplus_text', 'ip_rewrite', 'error_explain', 'image_check'].every(t => new RegExp(`\\b${t}:\\s+\\{ fast:`).test(gs))
      && (code.match(/aiAsk_\(/g) || []).length === 1 && /if \(p\.ai === 'ask'\) return json_\(aiAsk_\(p\)\);/.test(code));
    ok('…the key is read from Script Properties, sent only as x-api-key, never returned or logged', /'x-api-key': prop_\('CLAUDE_API_KEY'\)/.test(gs) && !/Logger\.log\([^)]*prop_\('CLAUDE_API_KEY'\)\)/.test(gs) && !/key:\s*prop_\('CLAUDE_API_KEY'\)/.test(gs));
    ok('…a status call that never reaches Claude; the brand set by aiAsk_ itself (setBrand_) before any brand read; the fallback OFF unless AI_FALLBACK = 1',
      /if \(task === 'status'\) \{[^\n]*ready: !!prop_\('CLAUDE_API_KEY'\)/.test(gs) && gs.indexOf('setBrand_(brand);') > 0 && gs.indexOf('setBrand_(brand);') < gs.indexOf('aiFacts_(task, brand') && /prop_\('AI_FALLBACK'\) === '1'/.test(gs));
    const G = new Function(gs + '\n;return { aiCost_ };')();
    const u = { input_tokens: 1e6, output_tokens: 1e6 };
    ok('…cost at the price of the model Anthropic RETURNED: Sonnet 5.5 $12, Haiku 5.5 $0.60, Opus 5.5 $24, an unknown model at the dearest $30',
      Math.round(G.aiCost_('claude-sonnet-5-5', u)) === 12 && Math.abs(G.aiCost_('claude-haiku-5-5', u) - 0.6) < 1e-9 && Math.round(G.aiCost_('claude-opus-5-5', u)) === 24 && Math.round(G.aiCost_('claude-x', u)) === 30);
    ok('…a fallback\'s steps each at their own model\'s price (Sonnet 5.5 step + Opus 4.8 step = $12 + $30)',
      Math.round(G.aiCost_('claude-sonnet-5-5', { input_tokens: 2e6, output_tokens: 2e6, iterations: [{ model: 'claude-sonnet-5-5', input_tokens: 1e6, output_tokens: 1e6 }, { model: 'claude-opus-4-8', input_tokens: 1e6, output_tokens: 1e6 }] })) === 42);
    ok('…listing text never comes from the address (only rule words: words, avoid, tpl, season, word, code, field, max, hlmax)', !/(^|[^\w.])p\.(title|bullets|description|kw|text|desc)\b/.test(gs), (gs.match(/(^|[^\w.])p\.(title|bullets|description|kw|text|desc)\b/g) || []).join());
  }

  // the pages a person sees: IP & Trademark Guard (families open), a Season planner child panel, the Fix all titles popup
  const draw = async X => {
    await X.ipgOpen();
    await wait(() => X.IPG.loaded && X.IPG.okLoaded);
    X.IPG.open = new Set(X.ipgGroups(X.ipgBuild()).map(x => x.f.fk));
    X.ipgDraw();
    const ipg = X.el('ipgBody').innerHTML;
    const item = X.spCompute(new Date(2026, 11, 10)).find(i => i.sku === 'NP-1' && i.active && i.active.length);
    const kid = item ? X.spKidHtml(item, null) : 'no season on';
    X.ttStartList('SP', ['NP-1', 'NP-3'], { title: 'test' });
    await wait(() => X.TT.run && X.TT.run.plans.length && !X.TT.run.total);
    const tt = X.el('spModalBox').innerHTML;
    X.ttClose();
    return { ipg, kid, tt };
  };

  console.log('== AI not set up: no ✨ button anywhere — every page exactly as before ==');
  {
    AIR.status = 'nokey';
    const n0 = AIR.statusCalls.length;
    const T0 = await setup();
    const C0 = T0.C;
    T0offPage = C0;
    ok('one status call when the page loads (no Claude call) → not set up', AIR.statusCalls.length === n0 + 1 && C0.AI.ready === false && AIR.calls.length === 0, AIR.statusCalls.length - n0);
    ok('…aiBtnHtml and the Optimiser card draw nothing', C0.aiBtnHtml('title', 'SP', 'NP-1', { use: 'send' }) === '' && C0.aiOptCardHtml('SP', 'NP-1') === '');
    const off = await draw(C0);
    const plain = await draw((await setup({ ai: false })).C);
    // the priority chips (listing-priority.js) are the one thing added with AI off — set aside here (tests/priority-test.js has them)
    const noPr = h => h.replace(/ ?<span class="pr-chip[^>]*>[^<]*<\/span> ?|<button type="button" class="cc-fchip[^"]*" data-ipg="prf"[^>]*>[^<]*<\/button>/g, '');
    ok('IP & Trademark Guard, the Season planner child panel and the Fix all titles popup are EXACTLY what they were without the AI file (the priority chips aside)',
      noPr(off.ipg) === plain.ipg && noPr(off.kid) === plain.kid && noPr(off.tt) === plain.tt && !/data-ai|ai-row|sp-ai/.test(off.ipg + off.kid + off.tt),
      (() => { const a = noPr(off.ipg), b = plain.ipg; let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(Math.max(0, i - 150), i + 150) + ' ||| ' + b.slice(Math.max(0, i - 150), i + 150); })());
    C0.el('leBrand').value = 'SP';
    C0.setLE({ sku: 'NP-1', asin: A('NP-1'), productType: 'NAPKIN', title: GOOD('18 x 18', 'Blue'), issues: [], attributes: { item_name: [{ value: GOOD('18 x 18', 'Blue'), language_tag: 'en_US' }] } }, {});
    ok('…and Listing Content has no ✨ button and no AI mark at all', !/data-ai/.test(C0.lcSectionHtml()));
    AIR.status = 'old';
    const T1 = await setup();
    ok('a backend without the route (the old answer "No ASIN found") → not set up, no buttons', T1.C.AI.ready === false && T1.C.aiBtnHtml('kw', 'SP', 'NP-1', {}) === '');
    AIR.status = 'ready';
    const ses = sessionOf();
    const n1 = AIR.statusCalls.length;
    const T2 = await setup({ session: ses });
    const T3 = await setup({ session: ses });
    ok('set up → the buttons are drawn; the answer is kept for the session: a second page load makes no status call', T2.C.AI.ready === true && T3.C.AI.ready === true && AIR.statusCalls.length === n1 + 1
      && /data-ai="title"/.test(T3.C.aiBtnHtml('title', 'SP', 'NP-1', {})), AIR.statusCalls.length - n1);
  }

  const T = await setup();
  const C = T.C;

  console.log('== nothing runs when a page opens (set up) ==');
  {
    const on = await draw(C);
    ok('the pages draw their ✨ buttons (IP & Trademark Guard, Season planner child panel, Fix all titles rows)', /data-ai="ip_rewrite"/.test(on.ipg) && /data-ai="season"/.test(on.kid) && /data-ai="title"/.test(on.tt), [/data-ai="ip_rewrite"/.test(on.ipg), /data-ai="season"/.test(on.kid), /data-ai="title"/.test(on.tt)].join());
    ok('…the Season planner offers ONLY Item Highlights (seasons never go into titles)', /AI [^<]+ Item Highlights/.test(on.kid) && !/ title<\/button>|&quot;field&quot;:&quot;title&quot;/.test(on.kid), strip(on.kid).slice(0, 300));
    ok('…and no AI call was made by opening or drawing them', AIR.calls.length === 0 && C.AI.calls === 0, AIR.calls.length);
  }

  console.log('== a click that finds AI gone / the monthly limit: a calm grey line ==');
  {
    AIR.mode = 'old';
    let r = await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'send' }));
    ok('the route gone after the page loaded ("No ASIN found") → "AI not set up yet", grey — and the buttons go away', !r.reply.ok && /AI not set up yet/.test(r.card) && /ai-quiet"/.test(r.card) && !/is-bad/.test(r.card)
      && C.AI.ready === false && C.aiBtnHtml('kw', 'SP', 'NP-1', {}) === '', r.card);
    C.AI.ready = true;
    C.AI.off = false;
    AIR.mode = 'limit';
    r = await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'send' }));
    ok('the month\'s limit → "Monthly AI limit reached", grey, and "AI used this month: $80.02 of $80"', /Monthly AI limit reached — the buttons work again next month/.test(strip(r.card)) && /AI used this month: \$80\.02 of \$80/.test(strip(r.card)), strip(r.card));
    AIR.mode = 'on';
    C.AI.off = false;
  }

  console.log('== a title: the protected words go to the backend; our title rules judge the answer ==');
  {
    let r = await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'send' }));
    const q = AIR.calls.slice(-1)[0];
    ok('the call: task=title, brand, SKU — and only rule words (protected words, template, max 75); no listing text', q.task === 'title' && q.brand === 'SP' && q.sku === 'NP-1' && q.max === '75' && !('title' in q) && !('kw' in q),
      JSON.stringify(q));
    ok('…the protected words of the title now are sent: brand, product, material, size, Block Print, colour', ['Ridhi', 'Cloth Napkins', 'Block Print', 'Blue'].every(w => q.words.split('|').includes(w)) && /18 x 18/.test(q.words) && /Cotton/.test(q.words), q.words);
    ok('a title that passes: old and AI side by side, "✓ Passes every rule we check", Approve & send enabled, the cost line', r.reply.ok && /Now · /.test(strip(r.card)) && /✨ AI · 63 characters/.test(strip(r.card))
      && /✓ Passes every rule we check/.test(strip(r.card)) && enabled(r.card, 'approve') && /\$0\.01 this answer · AI used this month: \$3\.20 of \$80/.test(strip(r.card)), strip(r.card));
    C.AI.memo.clear(); AIR.answer.title = () => ({ title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Pottery Barn Style - Blue' });
    r = await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'send', key: 'b' }));
    ok('another brand\'s name → red (risky word), "Block Print" left out → red (protected word), Approve disabled', /risky word “Pottery Barn Style”/.test(strip(r.card)) && /leaves out a protected word: “Block Print”/.test(strip(r.card)) && !enabled(r.card, 'approve') && /data-ai-act="approve"[^>]*disabled/.test(r.card), strip(r.card));
    C.AI.memo.clear(); AIR.answer.title = () => ({ title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Reusable Dinner Party Kitchen - Blue' });
    r = await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'send', key: 'c' }));
    ok('a title over 75 → "… characters, over 75" in red, Approve disabled', /\d+ characters, over 75/.test(strip(r.card)) && !enabled(r.card, 'approve'), strip(r.card));
    C.AI.memo.clear(); AIR.answer.title = () => ({ title: 'Ridhi Cloth Napkins 100% Cotton 18x18 Inch Block Print - Blue' });
    r = await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'send', key: 'd' }));
    ok('the short form "18x18 Inch" in a title of 61 characters (below 74) → the house size rule says no', !r.job.chk.pass && r.job.chk.fails.some(f => /Size/i.test(f)), r.job.chk.fails.join(' | '));
    // edit the AI text in the card to pass → the button is enabled again
    const el = { dataset: { aiEdit: r.id }, value: GOOD('18 x 18', 'Blue'), closest: () => null };
    C.aiEdited(el);
    ok('editing the AI text in the card judges it again: now it passes', r.job.chk.pass && r.job.text === GOOD('18 x 18', 'Blue'), r.job.chk.fails.join(' | '));
    C.AI.memo.clear(); delete AIR.answer.title;
    await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'send', key: 'e' }));
    const before = AIR.calls.length;
    await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'send', key: 'f' }));
    ok('the same question twice on a page: one call (the answer is kept)', AIR.calls.length === before, AIR.calls.length - before);
  }

  console.log('== Approve & send: the one send path, Listing History "AI suggested", Put back ==');
  {
    C.AI.memo.clear(); AIR.answer.title = () => ({ title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Hand Block Print - Blue' });
    const r = await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'send', key: 'send', screen: 'Listing Optimiser' }));
    C.AI.memo.clear(); delete AIR.answer.title;
    ok('the AI title passes', r.job.chk.pass, r.job.chk.fails.join(' | '));
    ok('nothing is sent before Approve', patches(C, false).length === 0 && patches(C, true).length === 0);
    const done = C.aiApprove(r.job);
    await C.SQ.run.checked;
    ok('Approve: Amazon checks it first (not sent), item_name, the screen "Listing Optimiser"', patches(C, false).length === 1 && patches(C, true).length === 0 && patches(C, false)[0].patches[0].path === '/attributes/item_name'
      && patches(C, false)[0].patches[0].value[0].value === r.job.text && C.SQ.screens.slice(-1)[0] === 'Listing Optimiser', JSON.stringify(patches(C, false)[0]));
    await C.sqApprove();
    C.sqClose();
    await done;
    await new Promise(res => setTimeout(res, 5));
    const rows = T.saved.filter(x => /^history\/listing_/.test(x.path)).flatMap(x => Object.values(x.data.rows));
    const row = rows.find(x => x.sku === 'NP-1' && x.field === 'Title');
    ok('…sent, and in Listing History as "Listing Optimiser · AI suggested" with ai: true and the OLD title for Put back', patches(C, true).length === 1 && !!row && row.screen === 'Listing Optimiser · AI suggested' && row.ai === true
      && row.old === GOOD('18 x 18', 'Blue') && row.new === r.job.text && row.oldV && row.oldV[0].value === GOOD('18 x 18', 'Blue') && row.attr === 'item_name', JSON.stringify(row));
    ok('a send that did not come from the AI is not marked', !C.aiWasUsed('SP', 'NP-2', 'anything else'));
  }

  console.log('== search terms: 249 bytes, no title words, no repeats, no brand names, no risky words, protected words kept ==');
  {
    let r = await press(C, page(), C.aiBtnHtml('kw', 'SP', 'NP-1', { use: 'send' }));
    ok('good search terms pass (bytes counted the Amazon way), Approve enabled', r.job.chk.pass && enabled(r.card, 'approve') && /✨ AI · \d+ bytes/.test(strip(r.card)), r.job.chk.fails.join(' | '));
    C.AI.memo.clear(); AIR.answer.kw = () => ({ kw: 'cotton napkins blue ridhi dinner dinner pottery barn ' + 'w'.repeat(240) });
    r = await press(C, page(), C.aiBtnHtml('kw', 'SP', 'NP-1', { use: 'send', key: 'bad' }));
    const f = r.job.chk.fails.join(' | ');
    // OUR WORD RULES (27 Nov 2026): the AI's answer goes through the one rule BEFORE it is shown — what it took out is said on the card
    const cut = (r.job.cleaned || []).map(x => x.w + ':' + x.why).join(' ');
    ok('the AI answer through our rule: the repeat (dinner), the title words it added (cotton, blue), another brand (pottery barn), the limit (www…) out — said on the card',
      /dinner:duplicate/.test(cut) && /cotton:limit — the title already says it/.test(cut) && /blue:limit — the title already says it/.test(cut) && /pottery:other brand/.test(cut) && /barn:other brand/.test(cut) && /w{240}:limit/.test(cut)
      && /Our rules took out of the AI's answer/.test(r.card), cut);
    ok('…our brand "ridhi" STAYS (kept once, never removed); "napkins" stays (it was in the search terms already)', /\bridhi\b/.test(r.job.text) && /\bnapkins\b/.test(r.job.text) && C.lrKwCheck(r.job.text, 249).bytes <= 249, r.job.text);
    // (2 Dec 2026) what it lost is PUT BACK — not only blocked: the protected words of the search terms now ("reusable", "washable")
    ok('…the protected words it left out are PUT BACK ("+ reusable (protected, put back)"), said on the card; nothing red', /\breusable\b/.test(r.job.text) && /\bwashable\b/.test(r.job.text)
      && (r.job.putBack || []).map(x => x.w).join() === 'reusable,washable' && /Put back: <ins class="kf-add">\+ reusable<\/ins> \(protected, put back\)/.test(r.card) && !f, f + ' | ' + r.job.text);
    ok('…Approve enabled only now that it passes', enabled(r.card, 'approve') && r.job.chk.pass);
    // the checks themselves (a hand edit of the card is checked, not cleaned): over the limit, title words, twice, another brand → red; our brand → fine
    const c1 = C.aiCtx('SP', 'NP-1');
    const f2 = C.aiCheck(c1, 'kw', 'cotton napkins blue ridhi dinner dinner pottery barn ' + 'w'.repeat(240)).fails.join(' | ');
    ok('a hand edit: over 249 bytes → red; a title word that is not protected (inch) → red; a word twice → red; another brand → red', /bytes, over 249/.test(f2)
      && /said twice: dinner/.test(f2) && /pottery barn/i.test(f2) && /already in the title: inch/.test(C.aiCheck(c1, 'kw', 'dinner napkins reusable washable inch').fails.join(' | ')), f2);
    ok('…our brand name and the important words the title also has (cotton, napkins, blue) are NOT red any more', !/our brand name/.test(f2) && !/already in the title/.test(C.aiCheck(c1, 'kw', 'ridhi cotton napkins blue reusable washable dinner').fails.join(' | ')), f2);
    C.AI.memo.clear(); AIR.answer.kw = () => ({ kw: 'serviettes party wedding' });
    r = await press(C, page(), C.aiBtnHtml('kw', 'SP', 'NP-1', { use: 'send', key: 'lost' }));
    ok('the protected words of the search terms now (dinner, napkins, reusable, washable) are put back next to their words; the answer passes', ['dinner', 'napkins', 'reusable', 'washable'].every(w => new RegExp('\\b' + w + '\\b').test(r.job.text))
      && r.job.chk.pass && enabled(r.card, 'approve') && /serviettes party wedding/.test(r.job.text), r.job.text + ' | ' + r.job.chk.fails.join(' | '));
    C.AI.memo.clear(); delete AIR.answer.kw;
  }

  console.log('== bullets, description, A+ text ==');
  {
    let r = await press(C, page(), C.aiBtnHtml('bullets', 'SP', 'NP-1', { use: 'send' }));
    ok('5 good bullets pass', r.job.chk.pass && Array.isArray(r.job.text) && r.job.text.length === 5 && enabled(r.card, 'approve'), r.job.chk.fails.join(' | '));
    C.AI.memo.clear(); AIR.answer.bullets = () => ({ bullets: B5.slice(0, 3).concat(['A Disney print on soft cotton for a dinner party with family and friends, printed by hand with carved blocks.']) });
    r = await press(C, page(), C.aiBtnHtml('bullets', 'SP', 'NP-1', { use: 'send', key: 'bad' }));
    ok('4 bullets → red; "Disney" → red (another brand\'s name); Approve disabled', /4 bullets — 5 are asked for/.test(r.job.chk.fails.join(' | ')) && /Disney/.test(r.job.chk.fails.join(' | ')) && !enabled(r.card, 'approve'), r.job.chk.fails.join(' | '));
    C.AI.memo.clear(); delete AIR.answer.bullets;
    r = await press(C, page(), C.aiBtnHtml('description', 'SP', 'NP-1', { use: 'send' }));
    ok('a description passes', r.job.chk.pass, r.job.chk.fails.join(' | '));
    C.AI.memo.clear(); AIR.answer.description = () => ({ description: 'Organic cotton napkins, antibacterial and hand printed. Black Friday deal. '.repeat(5) });
    r = await press(C, page(), C.aiBtnHtml('description', 'SP', 'NP-1', { use: 'send', key: 'bad' }));
    ok('restricted claims ("organic", "antibacterial") and a sale word → red', /organic/i.test(r.job.chk.fails.join(' | ')) && /antibacterial/i.test(r.job.chk.fails.join(' | ')) && /sale word/.test(r.job.chk.fails.join(' | ')), r.job.chk.fails.join(' | '));
    C.AI.memo.clear(); delete AIR.answer.description;
    r = await press(C, page(), C.aiBtnHtml('aplus_text', 'SP', 'NP-1', { use: 'copy', place: 'row' }));
    ok('A+ draft: a headline and blocks, one column, "Copy A+ text" enabled, "made in A+ Content Manager"', /Printed by hand in Jaipur/.test(strip(r.card)) && enabled(r.card, 'copy') && /A\+ Content Manager/.test(strip(r.card)) && /ai-ba is-one/.test(r.card) && !/data-ai-act="approve"/.test(r.card), strip(r.card));
    C.AI.memo.clear(); AIR.answer.aplus_text = () => ({ headline: 'Like Pottery Barn, but printed by hand', blocks: [{ heading: 'x', body: 'Soft cotton.' }] });
    r = await press(C, page(), C.aiBtnHtml('aplus_text', 'SP', 'NP-1', { use: 'copy', key: 'bad' }));
    ok('…with another brand\'s name: Copy disabled', !enabled(r.card, 'copy'), strip(r.card));
    C.AI.memo.clear(); delete AIR.answer.aplus_text;
  }

  console.log('== Season planner: a season\'s Item Highlights ==');
  {
    const btn = C.aiBtnHtml('season', 'SP', 'NP-1', { use: 'send', field: 'hl', season: 'Christmas', swords: ['Christmas', 'Xmas'], hlmax: 125, screen: 'Season planner' });
    let r = await press(C, page(), btn);
    const q = AIR.calls.slice(-1)[0];
    ok('the call: task=season, field=hl, the season\'s name, hlmax', q.task === 'season' && q.field === 'hl' && q.season === 'Christmas' && q.hlmax === '125', JSON.stringify(q));
    ok('Item Highlights that name the season pass, Approve enabled', r.job.chk.pass && enabled(r.card, 'approve'), r.job.chk.fails.join(' | '));
    C.AI.memo.clear(); AIR.answer.season = () => ({ text: 'Black Friday deal on block print napkins', field: 'hl', season: 'Christmas' });
    r = await press(C, page(), C.aiBtnHtml('season', 'SP', 'NP-1', { use: 'send', field: 'hl', season: 'Christmas', swords: ['Christmas', 'Xmas'], hlmax: 125, key: 'bad' }));
    ok('no season named and a sale word → red, Approve disabled', /does not name Christmas/.test(r.job.chk.fails.join(' | ')) && /sale word “Black Friday”/.test(r.job.chk.fails.join(' | ')) && !enabled(r.card, 'approve'), r.job.chk.fails.join(' | '));
    C.AI.memo.clear(); delete AIR.answer.season;
  }

  console.log('== Listing Content: "Use AI version" fills the box (Check / Apply as always) ==');
  {
    const boxes = {};
    const box = id => boxes[id] || (boxes[id] = { id, value: '', oninput: null, dataset: {}, style: {}, innerHTML: '', textContent: '' });
    C.el('leBrand').value = 'SP';
    C.setLE({ sku: 'NP-1', asin: A('NP-1'), productType: 'NAPKIN', title: GOOD('18 x 18', 'Blue'), issues: [], attributes: { item_name: [{ value: GOOD('18 x 18', 'Blue'), language_tag: 'en_US' }],
      bullet_point: B5.map(v => ({ value: v, language_tag: 'en_US' })), product_description: [{ value: 'd'.repeat(300), language_tag: 'en_US' }], generic_keyword: [{ value: 'dinner napkins', language_tag: 'en_US' }] } }, {});
    const html = C.lcSectionHtml();
    ok('the Content section draws ✨ AI title / bullets / description / search terms', ['title', 'bullets', 'description', 'kw'].every(t => new RegExp(`data-ai="${t}"`).test(html)) && /data-ai-block/.test(html));
    C.el('lcTitle').value = GOOD('18 x 18', 'Blue');
    let typed = 0;
    C.el('lcTitle').oninput = () => { typed++; };
    C.AI.memo.clear(); AIR.answer.title = () => ({ title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Hand Block Print - Blue' });
    const r = await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'lc', place: 'block', key: 'lc' }));
    C.AI.memo.clear(); delete AIR.answer.title;
    ok('the card: "Use AI version", enabled', enabled(r.card, 'use') && /Fills the box above/.test(strip(r.card)), strip(r.card));
    C.aiUse(r.job);
    ok('Use AI version → the title box holds the AI title, its own checks run (as if typed)', C.el('lcTitle').value === r.job.text && typed === 1);
    ok('…and a later Apply of that title will be marked "AI suggested"', C.aiWasUsed('SP', 'NP-1', r.job.text));
    void box;
  }

  console.log('== Fix all titles / search terms: the AI version into a row; the IP & Trademark Guard\'s rewrite into the popup ==');
  {
    C.ttStartList('SP', ['NP-1'], { title: 'test' });
    await wait(() => C.TT.run && C.TT.run.plans.length && !C.TT.run.total);
    const run = C.TT.run, p = run.plans[0];
    const pop = C.el('spModalBox').innerHTML;
    ok('the Fix all titles row draws "✨ AI version"', /data-ai="title"/.test(pop) && /AI version/.test(pop));
    C.AI.memo.clear(); AIR.answer.title = () => ({ title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Hand Block Print - Blue' });
    const r = await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'tt', key: p.key }));
    C.AI.memo.clear(); delete AIR.answer.title;
    C.aiUse(r.job);
    ok('Use AI version → the row\'s new title is the AI title, ticked, judged by every title rule (ttRunCheck)', run.edit.get(p.key) === r.job.text && run.sel.has(p.key) && p.ok && C.ttRunCheck(run, p).pass, JSON.stringify(C.ttRunCheck(run, p)));
    C.ttClose();
    // the IP & Trademark Guard: NP-3's title holds "Pottery Barn Style" → the AI rewrite → the existing Fix all titles popup, as the row's edit
    const g = await press(C, page(), C.aiBtnHtml('ip_rewrite', 'SP', 'NP-3', { use: 'ipg', field: 'title', word: 'Pottery Barn Style', wk: 'Pottery Barn', screen: 'IP & Trademark Guard' }));
    const q = AIR.calls.slice(-1)[0];
    ok('the rewrite: task=ip_rewrite, field=title, the word — the backend reads the sentence itself', q.task === 'ip_rewrite' && q.field === 'title' && q.word === 'Pottery Barn Style' && !q.text, JSON.stringify(q));
    ok('the rewritten title passes (the word gone), "Use in Fix all titles"', g.job.chk.pass && enabled(g.card, 'use') && /Use in Fix all titles/.test(g.card), g.job.chk.fails.join(' | '));
    C.aiUse(g.job);
    await wait(() => C.TT.run && C.TT.run.plans.length && !C.TT.run.total);
    const p3 = C.TT.run.plans.find(x => x.sku === 'NP-3');
    ok('…the existing Fix all titles popup opens with the AI title as NP-3\'s edit, ticked', !!p3 && C.TT.run.edit.get(p3.key) === g.job.text && C.TT.run.sel.has(p3.key), p3 && JSON.stringify([p3.ok, p3.why, C.TT.run.edit.get(p3.key)]));
    C.ttClose();
    C.AI.memo.clear(); AIR.answer.ip_rewrite = q2 => ({ field: q2.field, index: 0, text: 'dinner napkins pottery barn table linen', word: q2.word });
    const bad = await press(C, page(), C.aiBtnHtml('ip_rewrite', 'SP', 'NP-2', { use: 'ipg', field: 'kw', word: 'pottery barn style', wk: 'Pottery Barn' }));
    // search terms (27 Nov 2026): our one rule runs on the AI's answer first — the risky word it still holds is taken out before it is shown
    ok('a search-terms rewrite that still holds the word → our rule takes it out first ("pottery barn": other brand), said on the card', !/pottery|barn/i.test(bad.job.text) && (bad.job.cleaned || []).some(x => /pottery/i.test(x.w)) && /Our rules took out/.test(bad.card), JSON.stringify([bad.job.text, bad.job.cleaned]));
    C.AI.memo.clear(); delete AIR.answer.ip_rewrite;
    const kw = await press(C, page(), C.aiBtnHtml('ip_rewrite', 'SP', 'NP-2', { use: 'ipg', field: 'kw', word: 'organic', wk: 'organic', key: 'k2' }));
    C.aiUse(kw.job);
    await wait(() => C.KF.run && C.KF.run.plans.length && !C.KF.run.total);
    const pk = C.KF.run && C.KF.run.plans[0];
    ok('search terms: the existing Fix all search terms popup opens with the AI text as the edit', !!pk && C.KF.run.edit.get(pk.key) === kw.job.text && C.KF.run.sel.has(pk.key), pk && JSON.stringify([pk.ok, pk.why]));
    C.kfClick({ dataset: { kf: 'cancel' } });
  }

  console.log('== read-only cards: Explain this error, Check main photo ==');
  {
    let r = await press(C, page(), C.aiBtnHtml('error_explain', 'SP', 'NP-1', { use: 'read', code: '90220', label: 'Explain this error' }));
    ok('Explain this error: the code goes, plain English + the fix + where; no Approve, no Use', AIR.calls.slice(-1)[0].code === '90220' && /Amazon wants a colour/.test(strip(r.card)) && /Fix: Open the listing in Listing Errors/.test(strip(r.card))
      && !/data-ai-act="(approve|use|copy)"/.test(r.card), strip(r.card));
    r = await press(C, page(), C.aiBtnHtml('image_check', 'SP', 'NP-1', { use: 'read', label: 'Check main photo' }));
    ok('Check main photo: pass / fail per check (white ✓, text ✕, fills ✕ 70%), read only', /✕ Main photo needs work/.test(strip(r.card)) && /✓ White background/.test(strip(r.card)) && /✕ No text, logo or watermark/.test(strip(r.card)) && /about 70%/.test(strip(r.card))
      && !/data-ai-act="(approve|use|copy)"/.test(r.card), strip(r.card));
  }

  console.log('== Listing Optimiser: the whole listing, one click ==');
  {
    const html = C.aiOptCardHtml('SP', 'NP-1');
    ok('the Optimiser card has one "✨ AI rewrite of the whole listing" button (no call yet)', /data-ai-all="SP\|NP-1"/.test(html) && /AI rewrite of the whole listing/.test(html));
    C.AI.memo.clear();
    const P = page();
    const n = AIR.calls.length;
    const btn = { dataset: { aiAll: 'SP|NP-1' }, disabled: false, ownerDocument: P.doc, closest: () => P.block };
    await C.aiOptAll(btn);
    ok('…one click asks for title, bullets, description and search terms — four cards, each with its own checks and Approve', AIR.calls.slice(n).map(q => q.task).join() === 'title,bullets,description,kw'
      && P.made.filter(e => e.dataset.aiCard).length === 4 && P.made.filter(e => e.dataset.aiCard).every(e => /data-ai-act="approve"/.test(e.innerHTML)), AIR.calls.slice(n).map(q => q.task).join());
  }

  console.log('== PART 2: the house style on every writing card; the page tasks ==');
  {
    C.AI.memo.clear();
    C.AI.styleOk = {};
    let r = await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'send', key: 'st0' }));
    ok('no approved guide: no &style= sent, the card says "No house style yet"', !('style' in AIR.calls.slice(-1)[0]) && /No house style yet/.test(strip(r.card)), strip(r.card).slice(-200));
    C.AI.styleOk = { NAPKIN: { at: 1763600000000, approvedAt: new Date(2026, 10, 20).getTime(), name: 'Vishesh G' } };
    C.AI.memo.clear();
    AIR.answer.title = () => ({ title: GOOD('18 x 18', 'Blue') });
    const answer = AIR.answer.title;
    const orig = aiFetchStyle;
    void orig;
    r = await press(C, page(), C.aiBtnHtml('title', 'SP', 'NP-1', { use: 'send', key: 'st1' }));
    const q = AIR.calls.slice(-1)[0];
    ok('an approved guide for its product type: &style=NAPKIN@<the guide\'s date> is sent', q.style === 'NAPKIN@1763600000000', JSON.stringify(q));
    ok('…and the card says "Follows: napkin house style (approved 20 Nov)" when the backend used it', /Follows: napkin house style \(approved 20 Nov\)/.test(strip(r.card)), strip(r.card).slice(-220));
    void answer;
    C.AI.memo.clear(); delete AIR.answer.title;
    const kinds = ['bullets', 'description', 'kw'].map(t => { C.AI.memo.clear(); return t; });
    for (const t of kinds) await press(C, page(), C.aiBtnHtml(t, 'SP', 'NP-1', { use: 'send', key: 'st-' + t }));
    ok('every writing task sends the approved guide (bullets, description, search terms)', AIR.calls.slice(-3).every(x => x.style === 'NAPKIN@1763600000000'), AIR.calls.slice(-3).map(x => x.task + ':' + x.style).join(' '));
    C.AI.styleOk = {};
    ok('Listing Rules → "✨ AI house style": a section only when AI is set up', /✨ AI house style/.test(C.aiStyleSectionHtml ? C.aiStyleSectionHtml() : '') && T0off().aiStyleSectionHtml() === '');
    // ✨ Fix these first
    r = await press(C, page(), C.aiBtnHtml('fix_first', 'SP', '', { use: 'read', brands: ['SP'], label: 'Fix these first' }));
    const ff = AIR.calls.slice(-1)[0], d = JSON.parse(ff.d || '{}');
    ok('Fix these first: the top Critical / Important listings go as facts (SKU, level, problem names, stock — no listing text), the best come back with one line each and "Open the fix"',
      ff.task === 'fix_first' && Array.isArray(d.items) && d.items.length > 0 && d.items.length <= 20 && d.items.every(x => x.sku && (x.level === 'crit' || x.level === 'imp') && !('title' in x)) && /Open the fix/.test(r.card) && /in stock and a problem/.test(strip(r.card)), JSON.stringify(d).slice(0, 300) + ' ' + strip(r.card).slice(0, 200));
    r = await press(C, page(), C.aiBtnHtml('title_template', 'SP', '', { use: 'read', pt: 'NAPKIN', match: 'Napkin Set', product: 'Napkin Set', label: 'Draft title template' }));
    ok('Draft title template: the product type goes; the draft and "Add as a new template" (never saved by itself)', AIR.calls.slice(-1)[0].pt === 'NAPKIN' && /\{brand\} \{product\}/.test(r.card) && /Add as a new template/.test(r.card) && /Nothing is saved by itself/.test(strip(r.card)));
    r = await press(C, page(), C.aiBtnHtml('bsr_why', 'SP', '', { use: 'read', d: { parent: 'B0P', weekA: { week: 'W46', rank: 900 }, weekB: { week: 'W45', rank: 400 } }, label: 'Why did rank change?' }));
    ok('Why did rank change?: week A and B go as numbers; the summary, the reasons, what is not known', JSON.parse(AIR.calls.slice(-1)[0].d).weekA.rank === 900 && /Rank fell/.test(strip(r.card)) && /Not known: ads spend/.test(strip(r.card)));
    r = await press(C, page(), C.aiBtnHtml('category_suggest', 'SP', 'NP-1', { use: 'read', place: 'row', label: 'Suggest the right category' }));
    const cd = JSON.parse(AIR.calls.slice(-1)[0].d);
    ok('Suggest the right category: only category ids Sellora reads go as options; the fix opens Listing Errors (Amazon checks it)', Array.isArray(cd.options) && cd.options.every(o => /^\d+$/.test(o.id)) && /Fix it in Listing Errors/.test(r.card), JSON.stringify(cd));
    r = await press(C, page(), C.aiBtnHtml('change_result', 'SP', 'NP-1', { use: 'read', place: 'row', asin: 'B0NP1XXXXX', at: Date.now() - 20 * 86400000, fieldName: 'Title', label: 'Did this change work?' }));
    const cr = JSON.parse(AIR.calls.slice(-1)[0].d);
    ok('Did this change work?: 14 days before vs after from the weekly store (none here: 0 days) → "Not enough data yet"', cr.before.days === 0 && cr.after.days === 0 && /Not enough data yet/.test(strip(r.card)), JSON.stringify(cr));
    r = await press(C, page(), C.aiBtnHtml('bundle_ideas', 'SP', '', { use: 'read', place: 'into', into: 'mbBody', label: 'Bundle ideas' }));
    ok('Bundle ideas: read-only ideas ("Ideas only — nothing changes")', /Sell together/.test(strip(r.card)) && /Ideas only/.test(strip(r.card)) && !/data-ai-act="(approve|use)"/.test(r.card));
    ok('no page task can send anything: none of their cards has Approve', !/data-ai-act="approve"/.test(r.card));
  }

  console.log('== the rule results and counts are untouched by the AI file ==');
  {
    const plain = load();
    const withAi = load({ ai: true });
    const sig = X => X.rows.map(r => r.sku + ':' + X.ids(r.sku)).join(' ');
    ok('every listing of the rules sample is judged the same with listing-ai.js loaded', sig(plain) === sig(withAi));
    ok('aiReport(): calls made on this page, answers kept', C.aiReport().callsThisPage === C.AI.calls && C.AI.calls === AIR.calls.length);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
