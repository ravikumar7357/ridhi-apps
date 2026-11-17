/* The CATEGORIES tab of Family & Category Check (src/app/listing/category-check.js) over the real files in a stub page: listing-match.js
 * (the cache's one read door), family-check.js (the shell, the live rule, the families) and category-check.js.
 *   node tests/category-check-test.js
 * Mock ListingMatch catalog records (browse path `bc`, ranks `rk`) for each error — Mixed category, No category, Rank mismatch — a child not
 * in the cache ("Category not read yet"), Correct on purpose + Undo, the bulk ticks, the filters / search / CSV, the empty state, the
 * cache-missing and old-cache fallback, Family check's "stock saved" time, and the speed for ~4,400 live children. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const L = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', f), 'utf8');
const H = 3600000;
const IST = ms => new Date(ms + 5.5 * H).toISOString().slice(0, 16).replace('T', ' ');
const A = sku => ('B0' + sku.replace(/\W/g, '').toUpperCase() + 'XXXXXXXXXX').slice(0, 10);
const TC = 'Home & Kitchen › Kitchen & Dining › Kitchen & Table Linens › Tablecloths';
const NP = 'Home & Kitchen › Kitchen & Dining › Kitchen & Table Linens › Cloth Napkins';
const BS = 'Home & Kitchen › Bedding › Sheets & Pillowcases › Bed Sheets';
const PC = 'Home & Kitchen › Bedding › Decorative Pillows, Inserts & Covers › Throw Pillow Covers';
const DO = 'Office Products › Office & School Supplies › Desk Accessories › Desk Organizers';
const SB = 'Home & Kitchen › Storage & Organization › Storage Boxes';
const leaf = p => p.split(' › ').pop();

// Our listings and what Amazon's catalog says of each: `bc` the browse path ('' = Amazon has none, undefined = not in the cache at all),
// `sub` the category its best-seller rank is in (default: its own leaf).
function sample(o) {
  o = o || {};
  const kid = (brand, sku, psku, x) => Object.assign({ brand, sku, asin: A(sku), psku, qty: 5, bc: TC, rank: 1234 }, x || {});
  let kids = [
    kid('SP', 'RTC14-1', 'RTC14-P'), kid('SP', 'RTC14-2', 'RTC14-P'),
    kid('SP', 'RTC14-3', 'RTC14-P', { sub: 'Table Runners' }),                         // ranked in a category that is not on its path
    kid('SP', 'RTC14-4', 'RTC14-P', { bc: '' }),                                        // Amazon has no browse node
    kid('SP', 'RTC14-5', 'RTC14-P', { bc: BS }),                                        // in Bed Sheets, its family in Tablecloths
    kid('SP', 'RTC14-6', 'RTC14-P', { bc: undefined }),                                 // not in the cache: "Category not read yet"
    kid('SP', 'RTC14-8', 'RTC14-P', { bc: BS, qty: 0 }),                                // no stock: not live, never shown
    kid('SP', 'RNP20-1', 'RNP20-P', { bc: NP }), kid('SP', 'RNP20-2', 'RNP20-P', { bc: NP }), kid('SP', 'RNP20-3', 'RNP20-P', { bc: NP }),
    kid('SP', 'ZZ-100', '', { bc: PC }),                                                // a product of its own, fine
    kid('SP', 'ZZ-200', '', { bc: '' }),                                                // a product of its own with no category
    kid('CPC', 'CD-1', 'CD-P', { bc: DO, qty: 9 }), kid('CPC', 'CD-2', 'CD-P', { bc: SB, qty: 2 }),   // 1 against 1: the side with more stock is the family's
  ];
  if (o.allFine) kids = kids.filter(k => !['RTC14-3', 'RTC14-4', 'RTC14-5', 'RTC14-6', 'ZZ-200', 'CD-2'].includes(k.sku));
  if (o.big) {
    kids = [];
    for (let i = 0; i < o.big; i++) { const b = i % 5 < 3 ? 'SP' : 'CPC'; kids.push(kid(b, `${b}K-${i}`, `${b}P-${i % 400}`, { bc: i % 97 === 0 ? BS : TC })); }
  }
  const parents = [...new Set(kids.filter(k => k.psku).map(k => k.brand + '|' + k.psku))].map(x => { const [brand, sku] = x.split('|'); return { brand, sku, asin: A(sku) }; });
  return { kids, parents };
}
// The cache as ListingMatch writes it, for the sample.
function cacheOf(S, o) {
  o = o || {};
  const at = o.at || Date.now() - H;
  const tabs = {};
  const meta = { v: 2, kind: 'full', startedAt: IST(at - 20 * 60000), finishedAt: IST(at), upTo: IST(at), lastFull: { finishedAt: IST(at), brands: ['SP', 'CPC'], gaveUp: [] }, hash: 'h31', parts: { listings: {}, catalog: {} } };
  ['SP', 'CPC'].forEach(b => {
    const items = {}, cat = {};
    S.kids.filter(k => k.brand === b).forEach(k => {
      items[k.sku] = { sku: k.sku, asin: k.asin, b, as: 'BUYABLE,DISCOVERABLE', pt: 'HOME', t: 'Title of ' + k.sku, bl: [], d: '', hl: [], kw: '', lvl: k.psku ? 'child' : '', psku: k.psku, va: {}, img: {}, iss: [],
        readAt: at, rs: 'Active', price: 20, ch: 'AMAZON_NA', rAt: at - 30 * 60000, fba: k.qty, fyp: null, inSupReport: false, sup: null };
      if (k.bc === undefined) return;
      const sub = k.sub || leaf(k.bc);
      cat[k.asin] = { asin: k.asin, t: 'Title of ' + k.sku, brand: '', img: { MAIN: { u: `https://m.media-amazon.com/images/I/${k.sku.replace(/\W/g, '')}.jpg`, w: 2000, h: 2000 } }, pa: k.psku ? [A(k.psku)] : [], kids: [], theme: '', tattrs: [],
        vals: {}, bc: k.bc, bcId: '', rk: k.bc ? { main: { r: 50000 + k.rank, c: k.bc.split(' › ')[0] }, sub: { r: k.rank, c: sub } } : { main: null, sub: null }, aplus: null, readAt: at };
    });
    tabs[`lmListings_${b}_1_0`] = { b, items };
    tabs[`lmCatalog_${b}_1_0`] = { b, items: cat };
    meta.parts.listings[b] = [`lmListings_${b}_1_0`];
    meta.parts.catalog[b] = [`lmCatalog_${b}_1_0`];
  });
  tabs.lmMeta = meta;
  return tabs;
}
function setup(opts) {
  opts = opts || {};
  const S = opts.S || sample(opts);
  const store = opts.store || {};
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
  const item = k => ({ sku: k.sku, asin: k.asin, st: 'BUYABLE,DISCOVERABLE', pt: 'HOME', t: 'Title of ' + k.sku, lvl: k.psku ? 'child' : '', psku: k.psku, c: '', z: '', img: {}, live: {}, iss: [] });
  const IML = {}, HEALTH = {};
  ['SP', 'CPC'].forEach(b => {
    IML[b] = { at: new Date(Date.now() - 3 * H), items: S.parents.filter(p => p.brand === b).map(p => ({ sku: p.sku, asin: p.asin, st: 'DISCOVERABLE', pt: 'HOME', t: 'Family ' + p.sku, lvl: 'parent' }))
      .concat(S.kids.filter(k => k.brand === b).map(item)) };
    HEALTH[b] = { at: new Date(opts.healthAt || Date.now()), rows: S.kids.filter(k => k.brand === b).map(k => ({ sku: k.sku, asin: k.asin, parent: '', title: 'Title of ' + k.sku, qty: k.qty, status: 'Active', channel: 'AMAZON_NA', price: 20 })) };
  });
  const calls = [];
  const net = { tabs: opts.noCache ? null : cacheOf(S, opts.cache) };
  const ctx = {
    $: el, document: { addEventListener() {}, querySelectorAll: () => [], createElement: () => ({ click() {} }), querySelector: () => null },
    window: { scrollTo() {}, scrollBy() {}, __TEST_ERP: false },
    MutationObserver: class { observe() {} }, localStorage: { getItem: () => null, setItem() {} }, setTimeout: fn => { fn(); return 0; }, clearTimeout() {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: class { constructor(p) { this.p = p; } }, CSS: { escape: s => s }, console: { table() {}, log() {} },
    BRAND_NAME: { SP: 'Ridhi', CPC: 'CPC' }, IML, HEALTH, LR_CAT: { SP: {}, CPC: {} }, H_LOADED: true, ME: { email: 'vishesh.g@example.com', tabs: ['health'] },
    parentName: (b, asin, fallback) => ({ [A('RTC14-P')]: 'Floral Tablecloth', [A('RNP20-P')]: 'Cotton Napkins', [A('CD-P')]: 'Desk Organizer Set' }[asin] || fallback),
    baCall: async q => {
      calls.push(q);
      if (q.cache) {
        const d = net.tabs && net.tabs[q.cache];
        if (!d) throw new Error(`nothing cached for "${q.cache}" yet`);
        return { ok: true, name: q.cache, data: JSON.parse(JSON.stringify(d)) };
      }
      if (q.lfix === 'cat') return { ok: true, items: [] };
      return {};
    },
    lsGet: async (coll, id) => (store[coll + '/' + id] ? JSON.parse(JSON.stringify(store[coll + '/' + id])) : null),
    lsSave: async (coll, id, data) => {
      if (opts.noSave) return false;
      const k = coll + '/' + id, cur = store[k] || {};
      store[k] = Object.assign({}, cur, data, { items: Object.assign({}, cur.items || {}, data.items || {}) });
      return true;
    },
    sqSendWithCheck: () => Promise.resolve({}), sqIsOpen: () => false,
    sqName: e => String(e || '').split('@')[0].split(/[._-]+/).map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
    showTab() {}, lrNorm: s => String(s || '').toLowerCase(), lrKwBytes: s => String(s || '').length, lrPicId: u => String(u), lrWholeCut: s => String(s || ''),
    imThumb: u => u.replace(/\.jpg$/, '._SL120_.jpg'),
  };
  const src = L('listing-match.js') + '\n' + L('family-check.js') + '\n' + L('category-check.js')
    + '\n;return { FC, CC, fcBuild, fcDrawAll, fcOpen, fcClick, fcClock, ccDraw, ccBuild, ccGroups, ccClick, ccFilter, ccCsv, ccReport, ccOkSetMany, ccOkUndo, ccInfo, ccShort, ccSame, CC_CSV_COLS,'
    + ' lmEnsure, lmRefresh, lmStoreUse, lmStockAt, lmOk, lmGetAsin, lmFmt };';
  const C = new Function(...Object.keys(ctx), src)(...Object.values(ctx));
  C.lmStoreUse({ get: async () => null, put: async () => true });
  const body = () => els.fcBody.innerHTML;
  const click = d => C.ccClick({ dataset: d });
  return { C, S, els, el, calls, store, net, IML, HEALTH, body, click, text: () => strip(body()) };
}
// A page opened on the Categories tab, the cache read.
async function open(opts) {
  const T = setup(opts);
  await T.C.lmEnsure();
  await T.C.lmRefresh();
  await T.C.fcOpen();
  T.C.FC.tab = 'cat';
  T.C.fcDrawAll();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  return T;
}
const RTC = 'SP|S:RTC14-P', CD = 'CPC|S:CD-P';
const card = (T, name) => { const m = T.body().match(new RegExp('<span>' + name + '</span><b>([\\d,]+)</b><small>(\\w+)</small>')); return m ? [Number(m[1].replace(/,/g, '')), m[2]] : null; };

(async () => {
  console.log('== the data: Amazon only, through lmGetAsin; this tab reads nothing itself ==');
  {
    const code = L('category-check.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    ok('category-check.js makes no backend call of its own (no baCall, no fetch) and reads the cache only through lmGetAsin', !/baCall\(|fetch\(|getDoc\(/.test(code) && /lmGetAsin\(/.test(code) && !/lmCatalog_|lmListings_|lmMeta/.test(code));
    ok('every name it adds starts with cc / CC', (code.match(/^(?:async )?function (\w+)/gm) || []).every(f => /function cc/.test(f)) && (code.match(/^(?:const|let) (\w+)/gm) || []).every(v => /^(const|let) (cc|CC)/.test(v)));
    const order = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'ORDER'), 'utf8');
    ok('it is in ORDER right after family-check.js', /listing\/family-check\.js\r?\nlisting\/category-check\.js\r?\n/.test(order));
  }

  console.log('== the tab: cards, chips, families closed, most errors first ==');
  const T = await open();
  {
    ok('four cards in the Families style: Mixed category 2 · No category 2 · Rank mismatch 1 (each "error") · Correct on purpose 0 ("hidden")',
      String(card(T, 'Mixed category')) === '2,error' && String(card(T, 'No category')) === '2,error' && String(card(T, 'Rank mismatch')) === '1,error' && String(card(T, 'Correct on purpose')) === '0,hidden',
      [card(T, 'Mixed category'), card(T, 'No category'), card(T, 'Rank mismatch'), card(T, 'Correct on purpose')].join(' | '));
    ok('filter chips: All · Mixed category · No category · Rank mismatch · Correct on purpose', (T.body().match(/class="cc-fchip[^"]*"[^>]*>([^<]+)/g) || []).map(s => s.replace(/.*>/, '').trim()).join('|') === 'All|Mixed category|No category|Rank mismatch|Correct on purpose');
    ok('every family is one closed line (no child rows drawn)', (T.body().match(/class="fc-head"/g) || []).length === 5 && !/class="fc-row/.test(T.body()) && /▸/.test(T.body()) && !/▾/.test(T.body()));
    const heads = (T.body().match(/<tr class="fc-head"[\s\S]*?<\/tr>/g) || []).map(strip);
    ok('the family line: name, brand, live children, and the main category as a short path — the full path on hover',
      /^▸ Floral Tablecloth Ridhi · 6 live children Home & Kitchen › Kitchen & Table Linens › Tablecloths/.test(heads[0]) && T.body().includes(`title="${TC.replace(/&/g, '&amp;')}"`), heads[0]);
    ok('…with its error chips', /1 mixed category 1 no category 1 rank mismatch$/.test(heads[0]), heads[0]);
    ok('sorted with the most errors first (3 · 1 · 1 · 0 · 0)', heads.map(h => (h.match(/\d+ (mixed|no|rank)/g) || []).length).join() === '3,1,1,0,0' && /Floral Tablecloth/.test(heads[0]), heads.map(h => h.slice(0, 30)).join(' | '));
    ok('a live listing with no family is a line of its own ("1 live listing, no family")', heads.some(h => /Title of ZZ-200 Ridhi · 1 live listing, no family/.test(h)));
    ok('not-live children are left out (RTC14-8 has no stock)', !T.C.ccBuild().groups.some(g => g.rows.some(r => r.c.sku === 'RTC14-8')));
    ok('the meta line says what is counted and that one ASIN is not read yet', /Live children only \(buyable and in stock\): 13 of 14 ASINs/.test(T.els.fcMeta.innerHTML) && /1 live ASIN is not in the Amazon data yet/.test(T.els.fcMeta.innerHTML), strip(T.els.fcMeta.innerHTML));
  }

  console.log('== opening a family: its children, with no network wait ==');
  {
    const before = T.calls.length;
    T.click({ cc: 'grp', ccV: RTC });
    const rows = (T.body().match(/<tr class="fc-row[\s\S]*?<\/tr>/g) || []);
    const row = sku => rows.find(r => r.includes(`<b>${sku}</b>`)) || '';
    ok('opening reads nothing (no call), and draws the 6 live children', T.calls.length === before && rows.length === 6 && /▾/.test(T.body()));
    ok('a child row: picture thumbnail, SKU, ASIN linking to its Amazon page in a new tab, short browse path (full on hover), "#1,234 in Tablecloths"',
      /<img class="cc-pic" src="https:\/\/m\.media-amazon\.com\/images\/I\/RTC141\._SL120_\.jpg"/.test(row('RTC14-1')) && new RegExp(`<a href="https://www.amazon.com/dp/${A('RTC14-1')}" target="_blank" rel="noopener"`).test(row('RTC14-1'))
      && /Home &amp; Kitchen › Kitchen &amp; Table Linens › Tablecloths/.test(row('RTC14-1')) && /#1,234 in Tablecloths/.test(row('RTC14-1')), row('RTC14-1'));
    ok('a fine child: a small green tick and nothing else (no tick box, no button, no text)', /<span class="cc-tick"[^>]*>✓<\/span>/.test(row('RTC14-1')) && !/fc-p |data-cc="ok"|type="checkbox"/.test(row('RTC14-1')) && strip('<td' + row('RTC14-1').split('<td class="fc-prob cc-prob"')[1]) === '✓', strip('<td' + row('RTC14-1').split('<td class="fc-prob cc-prob"')[1]));
    ok('1 Mixed category: "This child is in Bed Sheets, its family is in Tablecloths." + the hint',
      strip(row('RTC14-5')).includes('This child is in Bed Sheets, its family is in Tablecloths. What to do: Shoppers browsing Tablecloths won\'t see it. Ask Amazon to move it, or mark it \'Correct on purpose\'.'), strip(row('RTC14-5')));
    ok('2 No category: the plain line + "Shoppers can\'t find it by browsing. Check the product type / item type keyword in Seller Central."',
      strip(row('RTC14-4')).includes('Amazon has no category (browse node) for this live ASIN. What to do: Shoppers can\'t find it by browsing. Check the product type / item type keyword in Seller Central.'), strip(row('RTC14-4')));
    ok('3 Rank mismatch: "Ranked in Table Runners, listed in Tablecloths." + "Amazon may have placed it wrong. Check the item type keyword."',
      strip(row('RTC14-3')).includes('Ranked in Table Runners, listed in Tablecloths. What to do: Amazon may have placed it wrong. Check the item type keyword.') && /#1,234 in Table Runners/.test(row('RTC14-3')), strip(row('RTC14-3')));
    ok('errors are red, each with a tick box and "Correct on purpose"', ['RTC14-3', 'RTC14-4', 'RTC14-5'].every(s => /fc-p is-r/.test(row(s)) && /type="checkbox"/.test(row(s)) && /data-cc="ok"[^>]*>Correct on purpose/.test(row(s))));
    ok('not in the cache: grey "Category not read yet" — not an error, no tick box, not counted', /Category not read yet/.test(row('RTC14-6')) && !/is-r|type="checkbox"|data-cc="ok"/.test(row('RTC14-6')) && /fc-chip is-g/.test(row('RTC14-6')));
    T.click({ cc: 'grp', ccV: CD });
    ok('more than one family can be open; a 1-against-1 family: the child on the side with less stock is the one named (CD-2 in Storage Boxes, family in Desk Organizers)',
      /▾[\s\S]*▾/.test(T.body()) && T.text().includes('This child is in Storage Boxes, its family is in Desk Organizers.'));
    T.click({ cc: 'closeall' });
    ok('Close all: every family closed again', !/class="fc-row/.test(T.body()));
    T.click({ cc: 'openall' });
    ok('Open all: every family open (13 live children drawn)', (T.body().match(/class="fc-row/g) || []).length === 13);
    T.click({ cc: 'closeall' });
  }

  console.log('== rules: same names, short paths ==');
  {
    ok('"Kitchen & Table Linens" = "Kitchen and Table Linens" (case, & / and, punctuation set aside)', T.C.ccSame('Kitchen & Table Linens', 'kitchen and table-linens') && !T.C.ccSame('Tablecloths', 'Table Runners'));
    ok('the short path: the department, the shelf, the product; three parts or fewer stay whole', T.C.ccShort(TC.split(' › ')) === 'Home & Kitchen › Kitchen & Table Linens › Tablecloths' && T.C.ccShort(SB.split(' › ')) === SB);
    const P = await open({ S: (() => { const s = sample(); s.kids.find(k => k.sku === 'RTC14-3').sub = 'Kitchen & Table Linens'; return s; })() });
    ok('a rank in a category higher up the same browse path is NOT a mismatch', String(card(P, 'Rank mismatch')) === '0,error');
  }

  console.log('== Correct on purpose, Undo, saved with who and when ==');
  {
    T.click({ cc: 'grp', ccV: RTC });
    await T.click({ cc: 'ok', ccB: 'SP', ccS: A('RTC14-5') });
    const saved = (T.store['listingrules/catok_SP'] || {}).items || {};
    ok('the row leaves the errors at once: Mixed category 2 → 1, Correct on purpose 1', String(card(T, 'Mixed category')) === '1,error' && String(card(T, 'Correct on purpose')) === '1,hidden');
    ok('saved the way "Removed on purpose" is: listingrules/catok_SP, kind catok, with who and when', T.store['listingrules/catok_SP'].kind === 'catok' && saved[A('RTC14-5')].on === true
      && saved[A('RTC14-5')].by === 'vishesh.g@example.com' && saved[A('RTC14-5')].name === 'Vishesh G' && saved[A('RTC14-5')].at > Date.now() - 5000 && saved[A('RTC14-5')].sku === 'RTC14-5' && saved[A('RTC14-5')].k === 'mixed', JSON.stringify(saved));
    ok('in the family it now shows a grey "Correct on purpose", no red, no tick box', (() => { const r = (T.body().match(/<tr class="fc-row[\s\S]*?<\/tr>/g) || []).find(x => x.includes('<b>RTC14-5</b>')); return /Correct on purpose/.test(r) && !/is-r|type="checkbox"/.test(r); })());
    ok('"1 marked correct › Show"', /1 marked correct › Show/.test(T.text()));
    T.click({ cc: 'showok' });
    ok('…Show: the child, what it would say, who · when, and Undo', /This child is in Bed Sheets, its family is in Tablecloths\./.test(T.text()) && /Vishesh G · \d/.test(T.text()) && /data-cc="undo"[^>]*>Undo/.test(T.body()));
    const again = await open({ store: T.store });
    ok('after a reload it is still hidden (the saved mark is read)', String(card(again, 'Mixed category')) === '1,error' && String(card(again, 'Correct on purpose')) === '1,hidden');
    await T.click({ cc: 'undo', ccB: 'SP', ccS: A('RTC14-5') });
    ok('Undo: an error again (2), who undid it kept beside the first mark', String(card(T, 'Mixed category')) === '2,error' && String(card(T, 'Correct on purpose')) === '0,hidden'
      && T.store['listingrules/catok_SP'].items[A('RTC14-5')].on === false && T.store['listingrules/catok_SP'].items[A('RTC14-5')].undoneBy === 'vishesh.g@example.com');
    const N = await open({ noSave: true });
    await N.click({ cc: 'ok', ccB: 'SP', ccS: A('RTC14-5') });
    ok('a mark that could not be saved says so (kept on this page only)', /Not saved — the mark is kept on this page only\./.test(N.els.fcMeta.innerHTML));
  }

  console.log('== bulk: ticks, "Select all in family", one button ==');
  {
    T.click({ cc: 'tick', ccB: 'SP', ccS: A('RTC14-5') });
    ok('one tick: the bar "1 selected · Mark correct on purpose (1) · Clear"', /1 selected Mark correct on purpose \(1\) Clear/.test(T.text()));
    ok('…and the open family offers "Select all in family"', /data-cc="selfam"[^>]*>Select all in family/.test(T.body()));
    T.click({ cc: 'selfam', ccV: RTC });
    ok('Select all in family: its 3 error rows ticked (not the fine or unread ones)', T.C.CC.sel.size === 3 && /3 selected Mark correct on purpose \(3\)/.test(T.text()) && /Clear this family/.test(T.body()));
    T.click({ cc: 'tick', ccB: 'CPC', ccS: A('CD-2') });
    await T.click({ cc: 'bok' });
    ok('one button marks all 4 ticked rows (both brands): errors 0 · 1 · 0, Correct on purpose 4, nothing left ticked',
      String(card(T, 'Mixed category')) === '0,error' && String(card(T, 'No category')) === '1,error' && String(card(T, 'Rank mismatch')) === '0,error' && String(card(T, 'Correct on purpose')) === '4,hidden' && T.C.CC.sel.size === 0
      && Object.keys(T.store['listingrules/catok_CPC'].items).length === 1, [card(T, 'Mixed category'), card(T, 'No category'), card(T, 'Rank mismatch'), card(T, 'Correct on purpose')].join('|'));
    const order = (T.body().match(/<tr class="fc-head"[\s\S]*?<\/tr>/g) || []).map(strip);
    ok('marking does not move a family (the order stays while the data is the same)', /Floral Tablecloth/.test(order[0]));
    for (const [b, id] of [['SP', A('RTC14-5')], ['SP', A('RTC14-4')], ['SP', A('RTC14-3')], ['CPC', A('CD-2')]]) await T.click({ cc: 'undo', ccB: b, ccS: id });
    T.click({ cc: 'closeall' });
  }

  console.log('== filters, search, CSV ==');
  {
    T.click({ cc: 'chip', ccV: 'none' });
    T.click({ cc: 'openall' });
    const skus = () => (T.body().match(/<td class="fc-sku"><b>([^<]+)/g) || []).map(s => s.replace(/.*<b>/, ''));
    ok('chip "No category": only the two children with no category (in their families)', skus().sort().join() === 'RTC14-4,ZZ-200' && /cc-fchip is-on[^>]*>No category/.test(T.body()));
    T.click({ cc: 'f', ccV: 'mixed' });
    T.click({ cc: 'openall' });
    ok('the Mixed category card does the same for mixed', skus().sort().join() === 'CD-2,RTC14-5');
    T.click({ cc: 'f', ccV: 'mixed' });
    T.click({ cc: 'openall' });
    ok('pressing the card again clears it (All)', skus().length === 13 && /cc-fchip is-on[^>]*>All/.test(T.body()));
    const search = q => { T.C.ccFilter({ dataset: { ccF: 'q' }, value: q }); return skus().sort().join(); };
    ok('search by SKU, by ASIN, by family name, by category name', search('rtc14-3') === 'RTC14-3' && search(A('CD-2').toLowerCase()) === 'CD-2' && search('cotton napkins') === 'RNP20-1,RNP20-2,RNP20-3' && search('bed sheets') === 'RTC14-5',
      [search('rtc14-3'), search(A('CD-2').toLowerCase()), search('cotton napkins'), search('bed sheets')].join(' | '));
    search('');
    T.C.ccFilter({ dataset: { ccF: 'brand' }, value: 'CPC' });
    ok('brand filter: CPC only (cards follow: Mixed 1)', skus().sort().join() === 'CD-1,CD-2' && String(card(T, 'Mixed category')) === '1,error');
    T.C.ccFilter({ dataset: { ccF: 'brand' }, value: 'ALL' });
    T.click({ cc: 'chip', ccV: 'rank' });
    const csv = T.C.ccCsv();
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    ok('Export CSV = what is in view: family, SKU, ASIN, browse path, BSR, error, hint', lines[0] === 'Brand,Family,SKU,ASIN,Browse path,BSR,Error,What to do' && csv.n === 1
      && lines[1] === `Ridhi,Floral Tablecloth,RTC14-3,${A('RTC14-3')},${TC},"#1,234 in Table Runners","Ranked in Table Runners, listed in Tablecloths.",Amazon may have placed it wrong. Check the item type keyword.`, lines[1]);
    T.click({ cc: 'chip', ccV: '' });
    ok('…with All in view: every live child, a fine one with empty error columns', T.C.ccCsv().n === 13 && T.C.ccCsv().text.includes(`Ridhi,Floral Tablecloth,RTC14-1,${A('RTC14-1')},${TC},"#1,234 in Tablecloths",,`));
    T.click({ cc: 'closeall' });
    const rep = T.C.ccReport();
    ok('ccReport(): the counts per brand', rep.Ridhi.mixedCategory === 1 && rep.Ridhi.noCategory === 2 && rep.Ridhi.rankMismatch === 1 && rep.Ridhi.notReadYet === 1 && rep.Ridhi.liveChildren === 11 && rep.Ridhi.families === 2
      && rep.CPC.mixedCategory === 1 && rep.CPC.liveChildren === 2 && rep.CPC.cacheUsable === true, JSON.stringify(rep));
  }

  console.log('== the empty state ==');
  {
    const E = await open({ allFine: true });
    ok('no errors: "All live products are in the right category ✓", cards all 0', /All live products are in the right category ✓/.test(E.text()) && String(card(E, 'Mixed category')) === '0,error' && String(card(E, 'No category')) === '0,error' && String(card(E, 'Rank mismatch')) === '0,error');
    ok('…and the families can still be opened under it (every child a green tick)', (E.body().match(/class="fc-head"/g) || []).length === 4 && (() => { E.click({ cc: 'openall' }); return (E.body().match(/cc-tick/g) || []).length === 7 && !/is-r/.test(E.body().split('fc-boxes')[1].split('cc-chips')[1]); })());
    T.click({ cc: 'chip', ccV: 'ok' });
    ok('a filter with nothing in it says so ("Nothing is marked correct on purpose.")', /Nothing is marked correct on purpose ?\./.test(T.text()));
    T.click({ cc: 'chip', ccV: '' });
  }

  console.log('== the cache missing or older than 24 hours: grey "not read yet", never an error ==');
  {
    const M = await open({ noCache: true });
    ok('no cache: every card 0, no red anywhere, no error text', String(card(M, 'Mixed category')) === '0,error' && String(card(M, 'No category')) === '0,error' && String(card(M, 'Rank mismatch')) === '0,error'
      && !/fc-chip is-r|fc-p is-r|class="err"/.test(M.body()) && !/error:|could not|failed/i.test(M.text()), M.text().slice(0, 200));
    ok('…"Category not read yet" on the families, and a plain line saying why', /Category not read yet/.test(M.text()) && /Amazon's category data is not here right now/.test(strip(M.els.fcMeta.innerHTML)) && !/All live products are in the right category/.test(M.text()));
    ok('…the families and their live children are still listed (never an empty screen)', (M.body().match(/class="fc-head"/g) || []).length === 5 && (() => { M.click({ cc: 'openall' }); return (M.body().match(/class="fc-row/g) || []).length === 13; })());
    const O = await open({ cache: { at: Date.now() - 30 * H } });
    ok('a cache older than 24 hours: the same (nothing flagged from old data)', !O.C.lmOk() && String(card(O, 'Mixed category')) === '0,error' && /Category not read yet/.test(O.text()) && !/fc-chip is-r/.test(O.body()));
  }

  console.log('== the Families tab and its "stock saved" time ==');
  {
    const F = await open({ healthAt: Date.now() - 5 * 24 * H });
    F.C.FC.tab = 'fam'; F.C.FC.built = false;
    F.C.fcDrawAll();
    const rAt = Date.now() - H - 30 * 60000;
    ok('the cache\'s stock is in use (its report is newer than the 5-day-old snapshot): "stock saved" shows ListingMatch\'s report time, not the snapshot\'s',
      Math.abs(F.C.lmStockAt('SP') - rAt) < 60000 && strip(F.els.fcMeta.innerHTML).includes('stock saved ' + F.C.fcClock(F.C.lmStockAt('SP'))) && !/<span class="fc-old">stock saved/.test(F.els.fcMeta.innerHTML), strip(F.els.fcMeta.innerHTML).slice(0, 160));
    const G = await open({});
    G.C.FC.tab = 'fam'; G.C.FC.built = false;
    G.C.fcDrawAll();
    ok('a snapshot newer than the cache\'s report: the snapshot\'s own time, as before', G.C.lmStockAt('SP') === 0 && strip(G.els.fcMeta.innerHTML).includes('stock saved ' + G.C.fcClock(G.HEALTH.SP.at.getTime())));
    ok('the Families tab still draws its own cards (Not in family · Duplicate · Missing value · Different theme), none of the Categories ones', /Not in family/.test(G.text()) && /Different theme/.test(G.text()) && !/Mixed category|cc-fchip/.test(G.body()));
    const N = await open({ noCache: true, healthAt: Date.now() - 5 * 24 * H });
    ok('no cache: lmStockAt is 0 (the snapshot\'s time shows)', N.C.lmStockAt('SP') === 0);
  }

  console.log('== speed: ~4,400 live children ==');
  {
    const B = setup({ big: 4400 });
    await B.C.lmEnsure(); await B.C.lmRefresh(); await B.C.fcOpen();
    B.C.FC.tab = 'cat';
    const n0 = B.calls.length;
    const t0 = Date.now();
    B.C.fcDrawAll();
    const t1 = Date.now();
    const fk = B.C.ccBuild().groups[0].f.fk;
    B.click({ cc: 'grp', ccV: fk });
    const t2 = Date.now();
    console.log(`    4,400 live children in ${B.C.ccBuild().groups.length} families: the tab drawn in ${t1 - t0} ms, a family opened in ${t2 - t1} ms`);
    ok('the tab is drawn from memory in under 1 second, a family opens at once, and neither makes a call', t1 - t0 < 1000 && t2 - t1 < 300 && B.calls.length === n0, `${t1 - t0} / ${t2 - t1} ms`);
    ok('only the first 60 families are put on the page ("Show more families")', (B.body().match(/class="fc-head"/g) || []).length === 60 && /Show more families \(\d+ left\)/.test(B.text()));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
