/* Family & Category Check (src/app/listing/family-check.js) over the real file in a stub page, with recorded Amazon-like answers:
 * ?lfix=cat (Catalog Items: relationships with parentAsins / childAsins + variationTheme, attributes as [{ value, language_tag, marketplace_id }])
 * and the Listings API issues the Image Manager snapshot carries.
 *   node tests/family-check-test.js
 * Every flag from Amazon's data only: Not in family = no parent in Amazon's catalog (the SKU guess is only "Suggested family") · Duplicate =
 * Amazon issue OR equal values on ALL the theme's attributes (COLOR/SET_NAME with different set names → 0) · Missing value = Amazon issue OR
 * an empty catalog value · Different theme = Amazon issue · unread = grey, never counted · source + read time on every problem · read on open,
 * in the background (2 at a time, paused while a family is open), "Read again", kept in the saved copy · the list (one family open at a time,
 * Esc, no page jump), ticks + the bar, Removed on purpose / Undo, fixes through sqSendWithCheck, the CSV, fcFamilyReport, other screens. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', 'family-check.js'), 'utf8');
const RTC = 'SP|S:RTC14-P', RNP = 'SP|S:RNP20-P', ROD = 'SP|S:ROD-P';
const A = sku => ('B0' + sku.replace(/\W/g, '').toUpperCase() + 'XXXXXXXXXX').slice(0, 10);   // a 10-character ASIN per SKU

// Our listings: tablecloths RTC14-1…6 (parent RTC14-P) and two parentless ones next to them (RTC14-7, RTC14-11); napkins RNP20-1…3 (parent
// RNP20-P) and RNP20-9; not-live ones; a product of its own; optionally the desk organisers (COLOR/SET_NAME).
function sample(o) {
  o = o || {};
  const T = c => `Ridhi Block Print Tablecloth Rectangle 60x90 Inch Floral - ${c}`;
  const N = c => `Ridhi Cloth Napkins Cotton 18 x 18 Inch Set of Six Dinner - ${c}`;
  const it = (sku, x) => Object.assign({ sku, asin: A(sku), st: 'BUYABLE,DISCOVERABLE', pt: 'TABLECLOTH', t: T((x && x.c) || ''), lvl: 'child', psku: 'RTC14-P', c: '', z: '60x90' }, x || {});
  const nk = (sku, x) => Object.assign({ sku, asin: A(sku), st: 'BUYABLE,DISCOVERABLE', pt: 'TABLE_NAPKIN', t: N((x && x.c) || ''), lvl: 'child', psku: 'RNP20-P', c: '', z: '18x18' }, x || {});
  const items = [
    { sku: 'RTC14-P', asin: 'BPARENT014', st: 'DISCOVERABLE', pt: 'TABLECLOTH', t: 'Ridhi Block Print Tablecloth Rectangle', lvl: 'parent' },
    it('RTC14-1', { c: 'Blue' }), it('RTC14-2', { c: 'Red' }),
    it('RTC14-3', { c: 'White', iss: [{ s: 'W', c: '90220', m: 'The variation theme COLOR does not match the parent\'s variation theme SIZE/COLOR.', a: ['variation_theme'] }] }),
    it('RTC14-4', { c: '' }), it('RTC14-5', { c: 'Grey' }), it('RTC14-6', { c: 'Grey' }),
    it('RTC14-7', { c: 'Yellow', psku: '', lvl: '' }), it('RTC14-11', { c: o.c11 || 'Mint', psku: '', lvl: '' }),
    it('RTC14-8', { c: 'Pink', psku: '', lvl: '' }),                                    // no stock: not live
    it('RTC14-9', { c: 'Lime', psku: '', lvl: '', st: 'DISCOVERABLE' }),                // not buyable: not live
    it('RTC14-10', { c: 'Blue' }),                                                       // no stock: not live
    nk('RNP20-1', { c: 'Sage' }), nk('RNP20-2', { c: 'Rust' }), nk('RNP20-3', { c: 'Rust' }),
    nk('RNP20-9', { c: 'Navy', psku: '', lvl: '' }),
    { sku: 'ZZ-100', asin: A('ZZ-100'), st: 'BUYABLE,DISCOVERABLE', pt: 'PILLOW', t: 'Velvet cushion cover 18x18', lvl: '', c: 'Blue', z: '18x18' },
  ];
  if (!o.noNapkinParent) items.splice(12, 0, { sku: 'RNP20-P', asin: 'BPARENT020', st: 'DISCOVERABLE', pt: 'TABLE_NAPKIN', t: 'Ridhi Cloth Napkins', lvl: 'parent' });
  if (o.desk) {
    const D = c => `CPC Desk Organizer Set Bamboo Drawer Tray Office - ${c}`;
    const dk = (sku, x) => Object.assign({ sku, asin: A(sku), st: 'BUYABLE,DISCOVERABLE', pt: 'STORAGE_BOX', t: D(x.set), lvl: 'child', psku: 'ROD-P', c: 'Black', z: '' }, x);
    items.push({ sku: 'ROD-P', asin: 'BPARENTDSK', st: 'DISCOVERABLE', pt: 'STORAGE_BOX', t: 'CPC Desk Organizer Set', lvl: 'parent' },
      dk('ROD-1', { set: '3 Piece' }), dk('ROD-2', { set: '5 Piece' }), dk('ROD-3', { set: '7 Piece' }));
  }
  if (o.sameAsin) {                                                                     // "Tablecloth 2": two of our SKUs on one ASIN, Amazon resale SKUs
    items.push(it('RTC-14-5', { asin: A('RTC14-5'), c: 'Grey' }),                        // a second SKU of ours on RTC14-5's ASIN
      it('amzn.gr.RTC14-6-W7Q2', { asin: A('RTC14-6'), c: 'Grey', psku: '', lvl: '' }),  // Amazon's resale SKU on RTC14-6's ASIN
      it('amzn.gr.RTC14-12-K9', { asin: A('RTC14-12'), c: 'Teal', psku: '', lvl: '' })); // a resale SKU with an ASIN of its own, no parent
  }
  (o.iss || []).forEach(([sku, i]) => { items.find(x => x.sku === sku).iss = [i]; });
  const qty = { 'RTC14-8': 0, 'RTC14-10': 0 };
  const rows = items.filter(i => i.lvl !== 'parent').map(i => ({ sku: i.sku, asin: i.asin, parent: '', title: i.t, qty: qty[i.sku] != null ? qty[i.sku] : 5, status: 'Active' }));
  return { items, rows };
}
// Amazon's catalog, recorded from our listings: each parent its childAsins + variationTheme, each child its parent and theme values.
const CAT_THEME = { 'RTC14-P': ['SIZE/COLOR', ['size', 'color']], 'RNP20-P': ['SIZE/COLOR', ['size', 'color']], 'ROD-P': ['COLOR/SET_NAME', ['color', 'set_name']] };
function catalog(S, o) {
  const out = {};
  const parentOf = sku => S.items.find(x => x.sku === sku);
  const allItems = S.items.concat(o.noNapkinParent ? [{ sku: 'RNP20-P', asin: 'BPARENT020', lvl: 'parent' }] : []);
  allItems.forEach(i => {
    if (/^amzn\.gr\./.test(i.sku)) return;                                               // the catalog is per ASIN; a resale SKU is not an entry of its own
    const val = v => (v ? [{ value: v, language_tag: 'en_US', marketplace_id: 'ATVPDKIKX0DER' }] : undefined);
    if (i.lvl === 'parent') {
      const th = CAT_THEME[i.sku] || (/^ZQ/.test(i.sku) ? ['SIZE/COLOR', ['size', 'color']] : null);
      const kids = S.items.filter(k => k.psku === i.sku).map(k => k.asin);
      out[i.asin] = { asin: i.asin, relationships: [{ marketplaceId: 'ATVPDKIKX0DER', relationships: th ? [{ type: 'VARIATION', childAsins: kids, variationTheme: { theme: th[0], attributes: th[1] } }] : [] }], attributes: {} };
      return;
    }
    const noParent = !i.psku || (o.kidNoParent || []).includes(i.sku);
    const p = i.psku ? parentOf(i.psku) || allItems.find(x => x.sku === i.psku) : null;
    const attrs = { color: val(i.c), size: val(i.z), set_name: val(i.set), item_name: val(i.t) };
    Object.keys(attrs).forEach(k => attrs[k] === undefined && delete attrs[k]);
    out[i.asin] = { asin: i.asin, relationships: [{ marketplaceId: 'ATVPDKIKX0DER', relationships: noParent || !p ? [] : [{ type: 'VARIATION', parentAsins: [p.asin] }] }], attributes: attrs };
  });
  return out;
}

function setup(opts) {
  opts = opts || {};
  const store = opts.store || {};
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], scrollIntoView() {} });
  els.fcPane = Object.assign(el('fcPane'), { addEventListener() {} });
  const S = sample(opts);
  const IML = { SP: { at: new Date(Date.now() - 3 * 3600e3), items: S.items }, CPC: { at: new Date(Date.now() - 3 * 3600e3), items: [] } };
  const HEALTH = { SP: { at: new Date(), rows: S.rows }, CPC: { at: new Date(), rows: [] } };
  const LR_CAT = { SP: { 'RTC14-4': { color: 'Green', size: '60x90' }, 'RTC14-5': { color: 'Grey', size: '60x90' }, 'RTC14-6': { color: 'Black', size: '60x90' } }, CPC: {} };
  const sends = [], calls = [], reads = [], cats = [], docKeys = [], scrolls = [], loads = [];
  const listing = sku => {
    const i = S.items.find(x => x.sku === sku) || {};
    const at = {};
    if (i.c) at.color = [{ value: i.c, language_tag: 'en_US', marketplace_id: 'M' }];
    if (i.z) at.size = [{ value: i.z, language_tag: 'en_US', marketplace_id: 'M' }];
    const th = i.lvl === 'parent' ? (CAT_THEME[sku] || ['SIZE/COLOR'])[0] : i.lvl === 'child' ? 'SizeName-ColorName' : '';
    if (th) at.variation_theme = [{ name: th, marketplace_id: 'M' }];
    if (i.psku) at.child_parent_sku_relationship = [{ child_relationship_type: 'variation', parent_sku: i.psku, marketplace_id: 'M' }];
    if (i.lvl) at.parentage_level = [{ value: i.lvl, marketplace_id: 'M' }];
    return { ok: true, sku, productType: i.pt || '', attributes: at, issues: [] };
  };
  const mem = opts.mem || {};
  const ctx = {
    $: el,
    document: { addEventListener: (ev, fn) => docKeys.push(fn), querySelectorAll: () => [], createElement: () => ({ click() {} }),
      querySelector: () => (opts.lineTop != null ? { getBoundingClientRect: () => ({ top: opts.lineTop }) } : null) },
    window: { scrollTo() {}, scrollBy: (x, y) => scrolls.push(y), __TEST_ERP: !!opts.test },
    MutationObserver: class { observe() {} }, localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } }, setTimeout: fn => { fn(); return 0; }, clearTimeout() {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: class { constructor(p) { this.p = p; } }, CSS: { escape: s => s }, console: { table() {} },
    BRAND_NAME: { SP: 'Ridhi', CPC: 'CPC' }, IML, HEALTH, LR_CAT, H_LOADED: true, ME: { email: 'vishesh.g@example.com', tabs: ['health'] },
    parentName: (b, asin, fallback) => ({ BPARENT014: 'Floral Tablecloth', BPARENT020: 'Cotton Napkins', BPARENTDSK: 'CPC Desk Organizer Set' }[asin] || fallback),
    baCall: async q => {
      if (q.lfix === 'cat') {
        const asins = q.asins.split(',');
        cats.push(asins);
        if (opts.failCat && asins.includes(opts.failCat)) throw new Error('429 Too Many Requests');
        const cat = catalog(S, opts);
        return { ok: true, items: asins.map(a => cat[a]).filter(Boolean) };
      }
      reads.push(q.sku);
      if (q.lfix === 'get') return listing(q.sku);
      return {};
    },
    lsGet: async (coll, id) => (opts.test ? null : store[coll + '/' + id] ? JSON.parse(JSON.stringify(store[coll + '/' + id])) : null),
    lsSave: async (coll, id, data) => {
      if (opts.test) return false;
      const k = coll + '/' + id, cur = store[k] || {};
      store[k] = Object.assign({}, cur, data, { items: Object.assign({}, cur.items || {}, data.items || {}) });
      return true;
    },
    sqSendWithCheck: (jobs, o) => { sends.push({ jobs, opts: o }); return Promise.resolve({}); },
    sqIsOpen: () => !!opts.popupOpen,
    sqName: e => String(e || '').split('@')[0].split(/[._-]+/).map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
    sqValText: v => (Array.isArray(v) ? v.map(e => e.value || e.name || e.parent_sku || '').join(' · ') : ''),
    showTab: t => calls.push({ tab: t }), leOnly: (skus, label) => calls.push({ leOnly: skus, label }), leShow() {}, leListEnsure() {},
    // the saved snapshots (Refresh reloads them; it never rebuilds them from Amazon) and their meta documents (the "New data" check)
    imListLoad: async b => { loads.push('iml:' + b); if (opts.onImlLoad) opts.onImlLoad(b, IML); }, imListBuild: () => loads.push('BUILD'),
    loadHealthCache: async () => { loads.push('health'); if (opts.onHealthLoad) opts.onHealthLoad(HEALTH); },
    getDoc: async ref => ({ exists: () => !!(opts.saved && opts.saved[ref.path]), data: () => ({ at: { toDate: () => new Date(opts.saved[ref.path]) } }) }),
    doc: (d, coll, id) => ({ path: coll + '/' + id }), db: {},
  };
  const tail = '\n;return { FC, fcBuild, fcSuggest, fcProblems, fcStem, fcAlike, fcRating, fcLowRated, fcIssueKind, fcAttrVal, fcCatTake, fcDrawAll, fcOpen, fcOkSet, fcOkSetMany, fcOkUndo,'
    + ' fcLink, fcLinkMany, fcSetValue, fcAfterSend, fcOpenLerr, fcCsv, fcGroups, fcCount, fcClick, fcToggle, fcReadCat, fcReadAllCat, fcSelected, fcFamilyReport, fcRefresh, fcCheckNewer, fcClock, FC_CSV_COLS, FC_STEP };';
  const C = new Function(...Object.keys(ctx), SRC + tail)(...Object.values(ctx));
  const body = () => el('fcBody').innerHTML;
  const click = (fc, data) => C.fcClick(Object.assign({ dataset: Object.assign({ fc }, data || {}), closest: () => null }));
  const tick = sku => click('tick', { fcB: 'SP', fcS: sku });
  const counts = () => ['orphan', 'dup', 'missing', 'theme'].map(k => C.fcCount(C.FC.view, k)).join(',');
  return Object.assign(C, { el, store, sends, calls, reads, cats, S, IML, HEALTH, LR_CAT, mem, body, click, tick, counts, docKeys, scrolls, loads });
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const flushAll = async C => { for (let i = 0; i < 4000 && (C.FC.reads.inflight || (C.FC.reads.q.length && !(C.FC.reads.q[0].bg && C.FC.open))); i++) await new Promise(r => setImmediate(r)); await flush(); };
const rowsOf = v => v.groups.flatMap(g => g.rows);
const probOf = (v, sku, k) => { const r = rowsOf(v).find(x => x.c.sku === sku); return r ? r.probs.find(p => p.k === k) || null : null; };
const heads = html => (html.match(/class="fc-head"/g) || []).length;
const drawnRows = html => (html.match(/class="fc-row/g) || []).length;
const ready = async opts => { const C = setup(opts); await C.fcOpen(); await flushAll(C); return C; };

(async () => {
  console.log('== the small rules ==');
  {
    const C = setup();
    ok('SKU stem: RTC14-7 → RTC14, R-CP-351 → R-CP', C.fcStem('RTC14-7') === 'RTC14' && C.fcStem('R-CP-351') === 'R-CP');
    ok('Amazon issues: duplicate / missing / theme / not about variations', C.fcIssueKind({ s: 'E', c: '8560', m: 'Duplicate variation: another child of this parent has the same variation attribute values.' }) === 'dup'
      && C.fcIssueKind({ s: 'E', c: '90228', m: 'The variation attribute set_name is required for the variation theme COLOR/SET_NAME.', a: ['set_name'] }) === 'missing'
      && C.fcIssueKind({ s: 'W', c: '90220', m: 'The variation theme COLOR does not match the parent\'s variation theme SIZE/COLOR.' }) === 'theme'
      && C.fcIssueKind({ s: 'E', c: '18320', m: 'The main image is missing or incorrect.' }) === ''
      && C.fcIssueKind({ s: 'I', c: '1', m: 'variation theme info' }) === '');
    ok('a catalog value as text: { value }, nested, empty', C.fcAttrVal([{ value: 'Black', language_tag: 'en_US', marketplace_id: 'M' }]) === 'Black' && C.fcAttrVal([{ value: { value: '3 Piece' } }]) === '3 Piece' && C.fcAttrVal(undefined) === '');
  }

  console.log('== RULE 1: only live children ==');
  {
    const C = await ready();
    const v = C.FC.view;
    ok('live = buyable AND stock > 0: 13 of 16 children', v.live === 13 && v.all === 16, `${v.live} ${v.all}`);
    ok('the not-live ones are never asked about, never shown, never in the CSV', !C.cats.flat().some(a => [A('RTC14-8'), A('RTC14-9'), A('RTC14-10')].includes(a)) && !/RTC14-(8|9|10)\b/.test(C.fcCsv(v).text));
    ok('a product of its own (ZZ-100) is never asked about and is no error', !C.cats.flat().includes(A('ZZ-100')) && !rowsOf(v).some(r => r.c.sku === 'ZZ-100'));
  }

  console.log('== on load: not read = grey, then Amazon in the background ==');
  {
    const C = setup();
    await C.fcOpen();
    const h = C.body();
    ok('before Amazon answers: no Not in family / Duplicate / Missing value — only the issue Amazon already gave (Different theme 1)', C.counts() === '0,0,0,1', C.counts());
    ok('the parentless listings next to a family are grey "Not read from Amazon yet", not counted', probOf(C.FC.view, 'RTC14-7', 'unread') && probOf(C.FC.view, 'RTC14-7', 'unread').sev === 'g' && C.fcCount(C.FC.view, 'unread') === 3);
    ok('…the family line says "Reading from Amazon…" (queued at once); the cards "Reading Amazon… 0 of 2"', /<span class="fc-reading">Reading from Amazon…<\/span>/.test(h) && /Reading Amazon… 0 of 2/.test(h), strip(h).slice(0, 300));
    ok('the background asks ONE call per family: the parent first, then its live children and the listings suggested to it', C.cats.length === 2
      && C.cats[0][0] === 'BPARENT014' && C.cats[0].length === 9 && C.cats[0].includes(A('RTC14-7')) && C.cats[1][0] === 'BPARENT020' && C.cats[1].length === 5, JSON.stringify(C.cats));
    ok('no ?lfix=get read for any of it', C.reads.length === 0);
    await flushAll(C);
    const h2 = C.body();
    ok('as Amazon answers the cards fill: Not in family 3, Duplicate 4, Missing value 1, Different theme 1', C.counts() === '3,4,1,1' && !/Reading Amazon/.test(h2), C.counts());
    ok('the family line shows Amazon\'s theme and its attributes, and when it was read', /theme SIZE\/COLOR \(size, color\) · read just now/.test(h2), strip(h2).slice(0, 400));
  }

  console.log('== the flags, from Amazon ==');
  const B = await ready();
  let v = B.FC.view;
  {
    const p = probOf(v, 'RTC14-7', 'orphan');
    ok('Not in family: Amazon\'s catalog shows no parent for RTC14-7 (source: Amazon catalog, read time)', p && p.sev === 'r' && /Amazon's catalog shows no parent/.test(p.text) && p.src === 'Amazon catalog' && p.at > 0);
    ok('…our SKU guess only names the suggested family', /Floral Tablecloth \(SKU like 6 children/.test(p.sug) && p.fix.kind === 'link');
    ok('RTC14-5 / RTC14-6: same size + color on Amazon → Duplicate (Amazon catalog)', probOf(v, 'RTC14-5', 'dup') && /Same size: 60x90 · color: Grey as RTC14-6/.test(probOf(v, 'RTC14-5', 'dup').text) && probOf(v, 'RTC14-5', 'dup').src === 'Amazon catalog');
    ok('RTC14-4: color empty in Amazon\'s catalog → Missing value; the brand catalogue gives "Green" → Set colour/size', /No color on Amazon — the theme is SIZE\/COLOR/.test(probOf(v, 'RTC14-4', 'missing').text) && probOf(v, 'RTC14-4', 'missing').fix.set.color === 'Green');
    const t = probOf(v, 'RTC14-3', 'theme');
    ok('RTC14-3: Amazon issue 90220 about the theme → Different theme (yellow), source "Amazon issue 90220" and the snapshot\'s time', t && t.sev === 'y' && t.src === 'Amazon issue 90220' && t.at === B.IML.SP.at.getTime());
    B.fcToggle(RTC);
    const h = B.body();
    ok('each problem row shows its source and read time', /<small class="fc-src">Amazon catalog · read just now<\/small>/.test(h) && /<small class="fc-src">Amazon issue 90220 · read 3 h ago<\/small>/.test(h));
    ok('the Amazon values column: each theme attribute and its value', /<td class="fc-vals">size: 60x90 · color: Grey<\/td>/.test(h) && /<td class="fc-vals">size: 60x90 · color: —<\/td>/.test(h));
    ok('…a "Not in family" row shows its own Amazon values on the family\'s theme attributes', /<b>RTC14-7<\/b>(?:(?!<\/tr>)[^])*<td class="fc-vals">size: 60x90 · color: Yellow<\/td>/.test(h));
    B.fcToggle(RTC);
    const csv = B.fcCsv(v);
    ok('CSV: red problems only, with source and read time', csv.n === 8 && /,Amazon catalog,\d{4}-\d\d-\d\d \d\d:\d\d,/.test(csv.text) && !/90220/.test(csv.text) && csv.text.split('\r\n')[0].replace('\uFEFF', '') === B.FC_CSV_COLS.join(','), csv.n);
  }
  {
    const C = await ready({ desk: true });
    const vv = C.FC.view;
    ok('COLOR/SET_NAME family, all Black, different set names → 0 duplicates, 0 missing', !['ROD-1', 'ROD-2', 'ROD-3'].some(s => probOf(vv, s, 'dup') || probOf(vv, s, 'missing')) && C.counts() === '3,4,1,1', C.counts());
    const rep = await C.fcFamilyReport('Desk Organizer');
    ok('fcFamilyReport: theme, attribute names and each child\'s values as Amazon returned them', rep.theme === 'COLOR/SET_NAME' && rep.attributes.join() === 'color,set_name'
      && rep.children.map(c => c.values.set_name).join() === '3 Piece,5 Piece,7 Piece' && rep.children.every(c => c.values.color === 'Black' && c.amazonParent === 'BPARENTDSK'), JSON.stringify(rep));
    ok('…with the family\'s counts (all 0) and the cards', Object.values(rep.familyCounts).every(n => n === 0) && rep.cards['Not in family'] === 3 && rep.cards.Duplicate === 4);
  }
  {
    const C = await ready({ desk: true, iss: [['ROD-2', { s: 'E', c: '8560', m: 'Duplicate variation: another child of this parent has the same variation attribute values.', a: ['set_name'] }]] });
    const d = probOf(C.FC.view, 'ROD-2', 'dup');
    ok('an Amazon duplicate issue is shown even when the catalog values differ (source "Amazon issue 8560")', d && d.src === 'Amazon issue 8560' && /Duplicate variation/.test(d.text) && !probOf(C.FC.view, 'ROD-1', 'dup'));
  }
  {
    const C = await ready({ iss: [['RNP20-1', { s: 'E', c: '90228', m: 'The variation attribute size is required for the variation theme SIZE/COLOR.', a: ['size'] }]] });
    ok('an Amazon "missing variation attribute" issue → Missing value (Amazon issue 90228)', probOf(C.FC.view, 'RNP20-1', 'missing') && probOf(C.FC.view, 'RNP20-1', 'missing').src === 'Amazon issue 90228');
  }
  {
    const C = await ready({ kidNoParent: ['RTC14-2'] });
    const p = probOf(C.FC.view, 'RTC14-2', 'orphan');
    ok('our listing says RTC14-2 is a child, Amazon\'s catalog shows no parent → Not in family (suggested family: ours)', p && /our listing names this family/.test(p.sug) && C.counts().startsWith('4,'), C.counts());
  }
  {
    const C = await ready({ noNapkinParent: true });
    ok('a family whose parent ASIN we do not know: its children read, then their Amazon parent (one more call) → values and Duplicate', C.cats.some(c => c[0] === 'BPARENT020')
      && !!probOf(C.FC.view, 'RNP20-2', 'dup'), JSON.stringify(C.cats));
  }
  {
    const C = await ready({ failCat: 'BPARENT020' });
    ok('Amazon could not be read: grey "Amazon could not be read", nothing counted for that family', /Amazon could not be read/.test(C.body()) && !probOf(C.FC.view, 'RNP20-2', 'dup') && !!probOf(C.FC.view, 'RTC14-5', 'dup'));
  }

  console.log('== one row per ASIN; Amazon resale SKUs left out ==');
  {
    const C = await ready({ sameAsin: true });
    const vv = C.FC.view;
    const r5 = rowsOf(vv).find(r => r.c.asin === A('RTC14-5'));
    ok('same ASIN with 2 of our SKUs (RTC14-5, RTC-14-5): ONE child, no duplicate between them', r5 && r5.c.skus.slice().sort().join() === 'RTC-14-5,RTC14-5' && rowsOf(vv).filter(r => r.c.asin === A('RTC14-5')).length === 1
      && !/RTC-14-5/.test((probOf(vv, r5.c.sku, 'dup') || {}).text || ''), r5 && JSON.stringify(r5.c.skus));
    ok('two DIFFERENT ASINs with equal size + color (RTC14-5 / RTC14-6) are still a duplicate', !!probOf(vv, r5.c.sku, 'dup') && /as RTC14-6$/.test(probOf(vv, r5.c.sku, 'dup').text) && !!probOf(vv, 'RTC14-6', 'dup'));
    ok('the counts are per ASIN: Duplicate 4, Not in family 3 (as without the extra SKUs); live 13 of 16 ASINs', C.counts() === '3,4,1,1' && vv.live === 13 && vv.all === 16, `${C.counts()} ${vv.live}/${vv.all}`);
    ok('amzn.gr. SKUs: no flag, no row of their own, never asked about (the resale ASIN of its own is not read)', !rowsOf(vv).some(r => /^amzn\.gr\./.test(r.c.sku)) && !C.cats.flat().includes(A('RTC14-12')) && !vv.cands.some(c => /^amzn/.test(c.sku)));
    C.fcToggle(RTC);
    const h = C.body();
    const other = r5.c.skus.find(x => x !== r5.c.sku);
    ok('the ASIN row lists its other SKU and a grey "2 SKUs on one ASIN" (information, not counted)', h.includes(`<small class="fc-also">also ${other} <span class="fc-chip is-g">2 SKUs on one ASIN</span></small>`), strip(h).slice(0, 600));
    ok('…and the resale SKU only inside its ASIN\'s row: "Amazon resale SKU: amzn.gr.RTC14-6-W7Q2"', /<b>RTC14-6<\/b><small class="fc-also">Amazon resale SKU: amzn\.gr\.RTC14-6-W7Q2<\/small>/.test(h));
    const line = (h.match(/<tr class="fc-head" data-fc="grp" data-fc-v="SP\|S:RTC14-P"(?:(?!<\/tr>)[^])*<\/tr>/) || [''])[0];
    ok('…the family line says it too (grey)', line.includes('<span class="fc-chip is-g">2 SKUs on one ASIN</span>'), strip(line));
    ok('the CSV names every SKU of the ASIN', /RTC-14-5 \/ RTC14-5|RTC14-5 \/ RTC-14-5/.test(C.fcCsv(vv).text));
    const M = await ready({ sameAsin: true, kidNoParent: ['RTC14-5', 'RTC-14-5'] });
    const row = rowsOf(M.FC.view).find(r => r.c.asin === A('RTC14-5'));
    const notShown = row.c.skus.find(x => x !== row.c.sku);
    await M.fcOkSet('SP', row.c.sku, 'low rating');
    M.FC.ok.SP[notShown] = M.FC.ok.SP[row.c.sku]; delete M.FC.ok.SP[row.c.sku];        // the mark sits on the ASIN's other SKU
    ok('a Removed-on-purpose mark on ANY of the ASIN\'s SKUs holds', !rowsOf(M.fcBuild()).some(r => r.c.asin === A('RTC14-5') && r.probs.some(p => p.k === 'orphan')));
  }

  console.log('== read on open, Read again, the saved copy ==');
  {
    const C = setup();
    await C.fcOpen();
    C.fcToggle(RTC);
    ok('opening a family already being read asks nothing more', C.cats.length === 2);
    await flushAll(C);
    C.fcToggle(RTC); C.fcToggle(RTC);
    ok('opening a family Amazon answered for: nothing read again', C.cats.length === 2);
    C.click('reread', { fcV: RTC });
    ok('"Read again" asks Amazon for that family once more', C.cats.length === 3 && C.cats[2][0] === 'BPARENT014');
    ok('…its line says "Reading from Amazon…" while it is out', /Reading from Amazon…/.test(C.body()));
    await flushAll(C);
    const again = setup({ mem: C.mem });
    await again.fcOpen();
    ok('kept in the saved copy: the next page load asks nothing and counts at once', again.cats.length === 0 && again.counts() === '3,4,1,1', again.counts());
    const F = await ready({ failCat: 'BPARENT020' });
    const F2 = setup({ mem: F.mem });
    await F2.fcOpen();
    ok('a family Amazon could not answer is asked again on the next page load', F2.cats.length === 1 && F2.cats[0][0] === 'BPARENT020', JSON.stringify(F2.cats));
  }
  {
    const C = setup({ desk: true });
    await C.fcOpen();
    ok('the background: 2 calls at most', C.FC.reads.inflight === 2 && C.cats.length === 2);
    C.fcToggle(RTC);
    await flushAll(C);
    ok('while a family is open the background waits (the desk organisers not asked yet)', !C.cats.some(c => c[0] === 'BPARENTDSK'), JSON.stringify(C.cats.map(c => c[0])));
    C.fcToggle(RTC);
    await flushAll(C);
    ok('closed: it goes on', C.cats.some(c => c[0] === 'BPARENTDSK'));
  }

  console.log('== open / close: one family at a time ==');
  {
    const C = await ready();
    const h = C.body();
    ok('every family CLOSED: 2 lines, no rows, no column header', heads(h) === 2 && drawnRows(h) === 0 && !/fc-colh/.test(h));
    C.click('grp', { fcV: RTC });
    let h2 = C.body();
    ok('the arrow opens THAT family: its rows and its column header (SKU · ASIN · Amazon values · Stock · Problem · Suggested fix)', C.FC.open === RTC && drawnRows(h2) === 6
      && /<th>SKU<\/th><th>ASIN<\/th><th>Amazon values<\/th><th class="num">Stock<\/th><th>Problem<\/th><th>Suggested fix<\/th>/.test(h2) && /data-fc="reread"/.test(h2), drawnRows(h2));
    C.click('grp', { fcV: RNP });
    h2 = C.body();
    ok('opening another closes the first', C.FC.open === RNP && !/data-fc-s="RTC14-/.test(h2) && drawnRows(h2) === 3);
    C.docKeys.forEach(fn => fn({ key: 'Escape' }));
    ok('Esc closes it', C.FC.open === '' && drawnRows(C.body()) === 0);
    const J = await ready({ lineTop: 500 });
    J.fcToggle(RNP, { closest: () => ({ getBoundingClientRect: () => ({ top: 300 }) }) });
    ok('no page jump: the clicked line stays where it was', J.scrolls.length === 1 && J.scrolls[0] === 200);
  }

  console.log('== ticks, the bar, Removed on purpose, Link ==');
  {
    const C = await ready();
    const c0 = C.counts();
    C.fcToggle(RTC);
    C.click('selfam', { fcV: RTC });
    ok('Select all in this family ticks its "Not in family" rows (RTC14-7, RTC14-11)', [...C.FC.sel].sort().join() === 'SP|RTC14-11,SP|RTC14-7');
    await C.click('blink');
    const s = C.sends[0];
    ok('Link to family (2): one sqSendWithCheck, both to RTC14-P with the parent listing\'s theme', s && s.jobs.length === 2 && s.jobs.every(j => j.body.patches[1].value[0].parent_sku === 'RTC14-P' && j.body.patches[2].value[0].name === 'SIZE/COLOR') && s.opts.screen === 'Family Check');
    C.fcAfterSend({ jobs: [{ brand: 'SP', sku: 'RTC14-7', asin: A('RTC14-7'), state: 'accepted' }, { brand: 'SP', sku: 'RTC14-11', asin: A('RTC14-11'), state: 'working' }] }, job => {
      const r = C.FC.cat['SP|' + job.asin]; Object.assign(r, { pa: 'BPARENT014' }); });
    ok('accepted: RTC14-7 leaves the list; the one still working says so', !probOf(C.FC.view, 'RTC14-7', 'orphan') && !!probOf(C.FC.view, 'RTC14-11', 'orphan') && /still working/.test(C.FC.note['SP|RTC14-11']));
    C.click('bclear');
    C.tick('RTC14-11');
    C.fcToggle(RNP);
    C.tick('RNP20-9');
    ok('ticked in two families: Link to family is disabled and says why', /data-fc="blink" disabled title="Link to family links children of one family at a time/.test(C.body()));
    C.click('bok');
    C.FC.bulkReason = 'discontinued';
    await C.click('boksave');
    const items = C.store['listingrules/famok_SP'].items;
    ok('Removed on purpose (2): saved with who / when / that reason, gone from the red list', items['RTC14-11'].reason === 'discontinued' && items['RNP20-9'].on && !probOf(C.FC.view, 'RNP20-9', 'orphan') && /2 removed on purpose › Show/.test(C.body()));
    ok('the counts: only the link and the 2 marks took "Not in family" from 3 to 0', C.counts() === c0.replace(/^3/, '0'), C.counts());
    await C.fcOkUndo('SP', 'RNP20-9');
    ok('Undo brings it back', !!probOf(C.FC.view, 'RNP20-9', 'orphan') && C.store['listingrules/famok_SP'].items['RNP20-9'].on === false);
    const H = await ready({ c11: 'Yellow' });
    await H.fcLinkMany(['SP|RTC14-7', 'SP|RTC14-11']);
    ok('two ticked with the same Amazon values (size + color): one sent, the other held back and named', H.sends[0] && H.sends[0].jobs.length === 1 && /Amazon shows the same size: 60x90 · color: Yellow as RTC14-7/.test(H.sends[0].opts.held[0].why), JSON.stringify(H.sends[0] && H.sends[0].opts.held));
    await B.fcSetValue('SP', 'RTC14-4', 'missing');
    ok('Set colour/size → sqSendWithCheck with color "Green" (the brand catalogue\'s)', B.sends[0] && B.sends[0].jobs[0].body.patches[0].path === '/attributes/color' && B.sends[0].jobs[0].body.patches[0].value[0].value === 'Green');
    ok('a Fix by hand problem sends nothing', (await B.fcSetValue('SP', 'RTC14-5', 'dup')) === null);
    B.fcOpenLerr('SP', ['RTC14-5', 'RTC14-6']);
    ok('Open in Listing Errors: just those SKUs', B.calls.some(c => c.leOnly && c.leOnly.join() === 'RTC14-5,RTC14-6'));
  }

  console.log('== a linked or no-longer-live child leaves every list ==');
  {
    const C = await ready();
    await C.fcOkSet('SP', 'RTC14-7', 'low rating');
    ok('marked: hidden, in the removed list', !probOf(C.FC.view, 'RTC14-7', 'orphan') && C.FC.view.removed.length === 1);
    C.FC.cat['SP|' + A('RTC14-7')].pa = 'BPARENT014';                          // Amazon now shows it in the family
    let vv = C.fcBuild();
    ok('Amazon shows a parent: not an error, not in the removed list', !probOf(vv, 'RTC14-7', 'orphan') && vv.removed.length === 0);
    C.FC.cat['SP|' + A('RTC14-7')].pa = '';
    C.HEALTH.SP.rows.find(r => r.sku === 'RTC14-7').qty = 0;
    vv = C.fcBuild();
    ok('no longer live: in no list, not counted', !probOf(vv, 'RTC14-7', 'orphan') && vv.removed.length === 0 && vv.live === 12);
  }

  console.log('== ratings, the test site, Categories ==');
  {
    const R = setup();
    R.S.items.find(i => i.sku === 'RTC14-7').rating = 3.5;
    R.S.items.find(i => i.sku === 'RTC14-7').reviews = 12;
    await R.fcOpen();
    await flushAll(R);
    ok('rating below 4 → removed on purpose by itself', !probOf(R.FC.view, 'RTC14-7', 'orphan') && R.FC.view.removed[0].why === 'rating' && R.FC.view.ratingFound === 1);
    const T = await ready({ test: true });
    await T.fcOkSet('SP', 'RTC14-7', 'low rating');
    ok('test site: the mark is not saved and it says so', !Object.keys(T.store).length && /Test site — the mark is kept on this page only/.test(T.el('fcMeta').innerHTML));
    T.click('tab', { fcV: 'cat' });
    ok('Categories: "Coming with the automatic refresh — browse nodes"', /Coming with the automatic refresh — browse nodes/.test(T.el('fcBody').innerHTML));
  }

  console.log('== long lists ==');
  {
    const C = setup();
    const many = [];
    for (let i = 0; i < 150; i++) {
      many.push({ sku: `ZQ${i}-P`, asin: ('BPZQ' + i + 'XXXXXX').slice(0, 10), st: 'DISCOVERABLE', pt: 'RUG', t: 'Rug ' + i, lvl: 'parent' });
      ['a', 'b'].forEach(x => many.push({ sku: `ZQ${i}-${x}`, asin: A(`ZQ${i}-${x}`), st: 'BUYABLE', pt: 'RUG', t: 'Jute rug ' + i, lvl: 'child', psku: `ZQ${i}-P`, c: 'Beige', z: '5x7' }));
    }
    C.S.items.push(...many);
    many.filter(m => m.lvl === 'child').forEach(m => C.HEALTH.SP.rows.push({ sku: m.sku, asin: m.asin, parent: '', title: m.t, qty: 2 }));
    await C.fcOpen();
    await flushAll(C);
    const h = C.body();
    ok(`152 families with a problem: ${C.FC_STEP} lines drawn, then "Show more families (92 left)"`, heads(h) === 60 && /Show more families \(92 left\)/.test(h), heads(h));
    ok('one Amazon call per family (152)', C.cats.length === 152, C.cats.length);
    ok('the cards count every family', C.fcCount(C.FC.view, 'dup') === 304);
  }

  console.log('== Refresh: the latest saved data, and Amazon again ==');
  {
    const C = await ready();
    const pane = C.el('fcPane').innerHTML;
    ok('[Refresh] sits next to Export CSV', /id="fcRefresh" data-fc="refresh"[^>]*>Refresh<\/button><button type="button" class="ghost fc-famonly" data-fc="csv">Export CSV<\/button>/.test(pane));
    const again = setup({ mem: C.mem, onHealthLoad: H => { H.SP = { at: new Date(), rows: H.SP.rows.map(r => Object.assign({}, r, r.sku === 'RTC14-7' ? { qty: 0 } : {})) }; } });
    await again.fcOpen();
    ok('(the saved copy: a new page load reads nothing)', again.cats.length === 0 && again.counts() === '3,4,1,1');
    again.fcToggle(RTC);
    const run = again.fcRefresh();
    ok('click: the button is disabled and says "Refreshing…"', again.el('fcRefresh').disabled === true && again.el('fcRefresh').textContent === 'Refreshing…');
    await run;
    ok('the saved snapshots are reloaded from storage (Image Manager both brands, Listing Health) — never rebuilt from Amazon', again.loads.join() === 'iml:SP,iml:CPC,health');
    ok('then every family is read from Amazon again, ignoring the saved copy, 2 calls at a time — "Families 0 / 2"', again.cats.length === 2 && again.FC.reads.inflight === 2
      && again.el('fcRefresh').textContent === 'Refreshing… Families 0 / 2' && /<b>Families 0 \/ 2<\/b>/.test(again.el('fcMeta').innerHTML), again.el('fcRefresh').textContent);
    ok('…even with a family open (the open family stays open)', again.FC.open === RTC);
    await flushAll(again);
    ok('done: the button is back, the cards and rows show the new data (RTC14-7 out of stock → Not in family 2)', again.el('fcRefresh').disabled === false && again.el('fcRefresh').textContent === 'Refresh'
      && again.counts() === '2,4,1,1' && !probOf(again.FC.view, 'RTC14-7', 'orphan') && again.FC.open === RTC, again.counts());
    ok('no page jump (nothing scrolled)', again.scrolls.length === 0);
    ok('…and the new reads are kept', JSON.parse(again.mem.fcCat1).cat['SP|BPARENT014'].at >= JSON.parse(C.mem.fcCat1).cat['SP|BPARENT014'].at);
    ok('per-family [Read again] is still there', /data-fc="reread"/.test(again.body()));
  }
  {
    const C = await ready();
    const m = C.el('fcMeta').innerHTML;
    const t = ms => C.fcClock(ms);
    ok('the top line: "Errors/status saved <time> · stock saved <time> · families read <time>"', m.includes(`Errors/status saved ${t(C.IML.SP.at.getTime())}`) && m.includes(`stock saved ${t(C.HEALTH.SP.at.getTime())}`)
      && /families read \d{1,2}:\d\d [AP]M/.test(m), strip(m));
    ok('…today as "1:42 PM"', /^\d{1,2}:\d\d [AP]M$/.test(C.fcClock(Date.now())));
    ok('…none older than 24 h: no yellow', !/class="fc-old"/.test(m));
    const O = setup();
    O.IML.SP.at = new Date(Date.now() - 30 * 3600e3); O.IML.CPC.at = new Date(Date.now() - 30 * 3600e3);
    await O.fcOpen(); await flushAll(O);
    const mo = O.el('fcMeta').innerHTML;
    ok('a saved part older than 24 h is yellow (only that part)', /<span class="fc-old">Errors\/status saved [^<]+<\/span>/.test(mo) && /<span class="">stock saved/.test(mo), strip(mo));
  }
  {
    const C = await ready({ saved: { 'imgsnap/SP': Date.now() + 5000, 'health/SP': Date.now() - 864e5 } });
    ok('no newer snapshot: nothing shown', !/New data available/.test(C.el('fcMeta').innerHTML));
    ok('a newer saved Image Manager snapshot (the 1 PM / 6 PM refresh): "New data available — [Refresh]"', (await C.fcCheckNewer()) === true
      && /New data available — <button type="button" class="fc-b" data-fc="refresh">Refresh<\/button>/.test(C.el('fcMeta').innerHTML));
    const H = await ready({ saved: { 'health/CPC': Date.now() + 5000 } });
    H.HEALTH.CPC.at = new Date(Date.now() - 3600e3);
    ok('…a newer Listing Health snapshot too', (await H.fcCheckNewer()) === true);
    C.click('refresh');
    ok('clicking it starts the Refresh and the message goes', C.FC.refresh.on === true && !/New data available/.test(C.el('fcMeta').innerHTML));
    await flushAll(C);
  }

  console.log('== the family picture (drawing only) ==');
  {
    const kid = (html, sku) => {
      const box = html.split('<div class="fc-kid ').slice(1).map(x => x.split('</div>')[0]).find(x => x.includes('<small>' + sku + '</small>'));
      const m = box && /^is-(\w+)"><b>(.*?)<\/b><small>.*<span class="fc-chip is-\w+">([^<]+)<\/span>$/.exec(box);
      return m ? { k: m[1], label: strip(m[2]).trim(), status: m[3] } : null;
    };
    const C = await ready();
    const c0 = C.counts();
    ok('closed: no picture', !/fc-map/.test(C.body()));
    C.fcToggle(RTC);
    const h = C.body();
    ok('open: the picture sits above the column header', h.indexOf('class="fc-mapr"') > -1 && h.indexOf('class="fc-mapr"') < h.indexOf('class="fc-colh"'));
    ok('the parent box on top: parent SKU, ASIN, theme', /<div class="fc-par"><span>Parent<\/span><b>RTC14-P<\/b><small>BPARENT014 · SIZE\/COLOR<\/small><\/div>/.test(h));
    ok('one box per live child (6 linked + 2 not in family)', (h.match(/class="fc-kid /g) || []).length === 8);
    ok('a box: its Amazon values as the label, the SKU, "Linked"', JSON.stringify(kid(h, 'RTC14-1')) === JSON.stringify({ k: 'l', label: '60x90 / Blue', status: 'Linked' }), JSON.stringify(kid(h, 'RTC14-1')));
    ok('"Not in family" (red) for the orphans', kid(h, 'RTC14-7').status === 'Not in family' && kid(h, 'RTC14-7').k === 'r' && kid(h, 'RTC14-11').status === 'Not in family');
    ok('"Duplicate" (red) for the two with the same size + colour', kid(h, 'RTC14-5').status === 'Duplicate' && kid(h, 'RTC14-6').status === 'Duplicate');
    ok('an empty value is shown as empty, never guessed', kid(h, 'RTC14-4').label === '60x90' && kid(h, 'RTC14-4').status === 'Linked');
    ok('"6 of 8 sizes visible to shoppers" · "2 orphans found"', /<b>6 of 8<\/b> sizes visible to shoppers/.test(h) && /<b>2<\/b> orphans found/.test(h), strip(h.slice(h.indexOf('fc-nums'), h.indexOf('fc-nums') + 300)));
    ok('reviews: "not available (Amazon doesn\'t provide them)"', h.includes('reviews: not available (Amazon doesn&#39;t provide them)') || h.includes('reviews: not available (Amazon doesn\'t provide them)'));
    ok('drawing only: the cards and rows are the same', C.counts() === c0 && drawnRows(h) === 6, C.counts());
    ok('no page jump (nothing scrolled)', C.scrolls.length === 0);
    await C.fcLink('SP', 'RTC14-7');
    C.sends[0].opts.onDone({ jobs: [{ brand: 'SP', sku: 'RTC14-7', asin: A('RTC14-7'), state: 'accepted' }] });
    const h2 = C.body();
    ok('after Amazon accepted the Link: "Relinked ✓" (green), 7 of 8 visible, 1 orphan', JSON.stringify(kid(h2, 'RTC14-7')) === JSON.stringify({ k: 'ok', label: '60x90 / Yellow', status: 'Relinked ✓' })
      && /<b>7 of 8<\/b> sizes visible/.test(h2) && /<b>1<\/b> orphan found/.test(h2), JSON.stringify(kid(h2, 'RTC14-7')));
    const W = await ready();
    await W.fcLink('SP', 'RTC14-11');
    W.sends[0].opts.onDone({ jobs: [{ brand: 'SP', sku: 'RTC14-11', asin: A('RTC14-11'), state: 'working' }] });
    W.fcToggle(RTC);
    ok('still working: no "Relinked ✓" yet', kid(W.body(), 'RTC14-11').status === 'Not in family');
    await W.fcOkSet('SP', 'RTC14-7', 'low rating');
    ok('removed on purpose stays hidden in the picture too', !kid(W.body(), 'RTC14-7') && /<b>6 of 7<\/b> sizes visible/.test(W.body()));
    const U = await ready({ failCat: 'BPARENT020' });
    U.fcToggle(RNP);
    const hu = U.body();
    ok('a family Amazon could not be read for: grey "not read" boxes, none counted as visible', /is-g">not read</.test(hu) && /<b>0 of \d+<\/b> sizes visible/.test(hu) && !/>Linked</.test(hu), strip(hu.slice(hu.indexOf('fc-map'), hu.indexOf('fc-map') + 400)));
    await flushAll(U);
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
    const mine = css.split(/\r?\n/).filter(l => /:is\(#paneFam,#paneAplus\) \.fc-(map|par|kids?|nums|revs|chip\.is-ok)/.test(l));   // (18 Nov 2026: the same rules dress the A+ Content pane too)
    ok('the picture uses the theme colours only (light + dark): no fixed colours', mine.length >= 10 && mine.every(l => !/#[0-9a-f]{3,6}\b|rgb\(/i.test(l)));
  }

  console.log('== other screens unchanged ==');
  {
    const assigns = SRC.match(/\b(HEALTH|IML|LR_CAT|LI_WS|AMZ|H_CTX|H_LOADED|LR|SP|LH|SQ)\s*(\[[^\]]*\])*\s*(\.\w+)*\s*=(?!=)/g) || [];
    ok('family-check.js never writes Listing Health / Image Manager / catalogue / Workspace / planner state', !assigns.length, assigns.join(' | '));
    ok('the only backend calls: ?lfix=cat and ?lfix=get (reads); sends only through sqSendWithCheck', (SRC.match(/baCall\(\{ lfix: '(\w+)'/g) || []).every(m => /'cat'|'get'/.test(m)) && !/imPost|lfix: 'patch'[^]{0,40}baCall/.test(SRC));
    ok('the search waits 200 ms after typing (18 Nov 2026: every Listing search box, results within 300 ms)', /FC_T = setTimeout\(fcDrawAll, 200\)/.test(SRC));
    const root = path.join(__dirname, '..', '..');
    let changed = [];
    try { changed = cp.execSync('git diff --name-only HEAD -- Pricing-App/src Pricing-App/firestore.rules Pricing-API', { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean); } catch (e) { changed = ['(git not available)']; }
    const allowed = ['Pricing-App/src/styles.css', 'Pricing-App/src/app/listing/family-check.js'];
    ok('only this screen\'s file and its CSS changed — no backend, no rules, no other screen', changed.every(f => allowed.includes(f)), changed.join(', '));
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    ok('menu: column 2 · Check, right after BSR Audit (A+ Content follows it since 18 Nov 2026)', /<button id="tabBsr" class="nav">BSR Audit<\/button>\r\n      <button id="tabFam" class="nav">Family &amp; Category Check<\/button>\r\n      <button id="tabAplus" class="nav">A\+ Content<\/button><\/div>/.test(html));
    ok('the file is CRLF', !/(^|[^\r])\n/.test(SRC));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
