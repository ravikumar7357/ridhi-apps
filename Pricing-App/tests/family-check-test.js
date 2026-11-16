/* Family & Category Check (src/app/listing/family-check.js) over the real file in a stub page.
 *   node tests/family-check-test.js
 * Only live children (buyable AND stock > 0) · Not in family + the suggested family · duplicate / missing / different theme · the list:
 * every family closed on load, one open at a time (arrow / line, again closes, Esc closes, the clicked line stays put), the column header
 * only inside the open family, its rows drawn only then, its theme read only then (no "Read themes" button) · ticks + the bar: Removed on
 * purpose (N, one reason), Link to family (N, one family only), Open in Listing Errors (N), Select all in this family · Removed on purpose
 * hides for good and is saved, Undo brings it back, a linked / not-live child leaves every list · fixes through sqSendWithCheck · the CSV
 * (red only) · ratings · the counts never change by opening, closing or ticking · other screens unchanged. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', 'family-check.js'), 'utf8');
const RTC = 'SP|S:RTC14-P', RNP = 'SP|S:RNP20-P';

// The sample: tablecloths RTC14-1…6 (parent RTC14-P) with two children left out (RTC14-7, RTC14-11); napkins RNP20-1…3 (parent RNP20-P)
// with one left out (RNP20-9); children that are not live; a product of its own.
function sample(o) {
  o = o || {};
  const T = c => `Ridhi Block Print Tablecloth Rectangle 60x90 Inch Floral - ${c}`;
  const N = c => `Ridhi Cloth Napkins Cotton 18 x 18 Inch Set of Six Dinner - ${c}`;
  const it = (sku, x) => Object.assign({ sku, asin: 'B0' + sku.replace(/\W/g, ''), st: 'BUYABLE,DISCOVERABLE', pt: 'TABLECLOTH', t: T((x && x.c) || ''), lvl: 'child', psku: 'RTC14-P', c: '', z: '60x90' }, x || {});
  const nk = (sku, x) => Object.assign({ sku, asin: 'B0' + sku.replace(/\W/g, ''), st: 'BUYABLE,DISCOVERABLE', pt: 'TABLE_NAPKIN', t: N((x && x.c) || ''), lvl: 'child', psku: 'RNP20-P', c: '', z: '18x18' }, x || {});
  const items = [
    { sku: 'RTC14-P', asin: 'BPARENT14', st: 'DISCOVERABLE', pt: 'TABLECLOTH', t: 'Ridhi Block Print Tablecloth Rectangle', lvl: 'parent' },
    it('RTC14-1', { c: 'Blue' }), it('RTC14-2', { c: 'Red' }), it('RTC14-3', { c: 'White' }), it('RTC14-4', { c: '' }),
    it('RTC14-5', { c: 'Grey' }), it('RTC14-6', { c: 'Grey' }),
    it('RTC14-7', { c: 'Yellow', psku: '', lvl: '' }),                                  // live, no parent: belongs to RTC14
    it('RTC14-11', { c: o.c11 || 'Mint', psku: '', lvl: '' }),                          // the same
    it('RTC14-8', { c: 'Pink', psku: '', lvl: '' }),                                    // no parent, but no stock: not live
    it('RTC14-9', { c: 'Lime', psku: '', lvl: '', st: 'DISCOVERABLE' }),                // no parent, not buyable: not live
    it('RTC14-10', { c: 'Blue' }),                                                       // same colour as RTC14-1, but no stock: not live
    { sku: 'RNP20-P', asin: 'BPARENT20', st: 'DISCOVERABLE', pt: 'TABLE_NAPKIN', t: 'Ridhi Cloth Napkins', lvl: 'parent' },
    nk('RNP20-1', { c: 'Sage' }), nk('RNP20-2', { c: 'Rust' }), nk('RNP20-3', { c: 'Rust' }),
    nk('RNP20-9', { c: 'Navy', psku: '', lvl: '' }),                                     // live, no parent: belongs to RNP20
    { sku: 'ZZ-100', asin: 'B0ZZ100', st: 'BUYABLE,DISCOVERABLE', pt: 'PILLOW', t: 'Velvet cushion cover 18x18', lvl: '', c: 'Blue', z: '18x18' },   // a product of its own
  ];
  if (o.desk) {                                                                          // a COLOR/SET_NAME family: colour alone is not the variation
    const D = c => `CPC Desk Organizer Set Bamboo Drawer Tray Office - ${c}`;
    const dk = (sku, x) => Object.assign({ sku, asin: 'B0' + sku.replace(/\W/g, ''), st: 'BUYABLE,DISCOVERABLE', pt: 'STORAGE_BOX', t: D((x && x.c) || ''), lvl: 'child', psku: 'ROD-P', c: '', z: '' }, x || {});
    items.push({ sku: 'ROD-P', asin: 'BPARENTOD', st: 'DISCOVERABLE', pt: 'STORAGE_BOX', t: 'CPC Desk Organizer Set', lvl: 'parent' },
      dk('ROD-1', { c: 'Black' }), dk('ROD-2', { c: 'Black' }), dk('ROD-3', { c: '' }), dk('ROD-9', { c: 'Black', psku: '', lvl: '' }));
  }
  const qty = { 'RTC14-8': 0, 'RTC14-10': 0 };
  const rows = items.filter(i => i.lvl !== 'parent').map(i => ({ sku: i.sku, asin: i.asin, parent: '', title: i.t, qty: qty[i.sku] != null ? qty[i.sku] : 5, status: 'Active' }));
  return { items, rows };
}
// Amazon's answers to ?lfix=get: the variation theme (the parents SIZE/COLOR, RTC14-3 COLOR only) and the values.
const THEME = { 'RTC14-P': 'SIZE/COLOR', 'RNP20-P': 'SIZE/COLOR', 'RTC14-3': 'COLOR', 'ROD-P': 'COLOR/SET_NAME', 'ROD-1': 'COLOR/SET_NAME', 'ROD-2': 'COLOR/SET_NAME', 'ROD-3': 'COLOR/SET_NAME' };

function setup(opts) {
  opts = opts || {};
  const store = opts.store || {};
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], scrollIntoView() {} });
  els.fcPane = Object.assign(el('fcPane'), { addEventListener() {} });
  const S = sample(opts);
  const IML = { SP: { at: new Date(Date.now() - 3600e3), items: S.items }, CPC: { at: new Date(Date.now() - 3600e3), items: [] } };
  const HEALTH = { SP: { at: new Date(), rows: S.rows }, CPC: { at: new Date(), rows: [] } };
  const LR_CAT = { SP: { 'RTC14-4': { color: 'Green', size: '60x90' }, 'RTC14-5': { color: 'Grey', size: '60x90' }, 'RTC14-6': { color: 'Black', size: '60x90' } }, CPC: {} };
  const sends = [], calls = [], reads = [], docKeys = [], scrolls = [];
  const amazon = sku => {
    const i = S.items.find(x => x.sku === sku) || {};
    const at = {};
    if (i.c) at.color = [{ value: i.c, language_tag: 'en_US', marketplace_id: 'M' }];
    if (i.z) at.size = [{ value: i.z, language_tag: 'en_US', marketplace_id: 'M' }];
    const th = THEME[sku] || (i.lvl === 'child' ? 'SizeName-ColorName' : i.lvl === 'parent' && /^ZQ/.test(sku) ? 'SIZE/COLOR' : '');
    if (th) at.variation_theme = [{ name: th, marketplace_id: 'M' }];
    if (i.psku) at.child_parent_sku_relationship = [{ child_relationship_type: 'variation', parent_sku: i.psku, marketplace_id: 'M' }];
    if (i.lvl) at.parentage_level = [{ value: i.lvl, marketplace_id: 'M' }];
    return { ok: true, sku, productType: i.pt || '', attributes: at, issues: [] };
  };
  const mem = opts.mem || {};                       // this browser's saved copy (a second page load can share it)
  const ctx = {
    $: el,
    document: { addEventListener: (ev, fn) => docKeys.push(fn), querySelectorAll: () => [], createElement: () => ({ click() {} }),
      querySelector: () => (opts.lineTop != null ? { getBoundingClientRect: () => ({ top: opts.lineTop }) } : null) },
    window: { scrollTo() {}, scrollBy: (x, y) => scrolls.push(y), __TEST_ERP: !!opts.test },
    MutationObserver: class { observe() {} }, localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } }, setTimeout: fn => { fn(); return 0; }, clearTimeout() {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: class { constructor(p) { this.p = p; } }, CSS: { escape: s => s },
    BRAND_NAME: { SP: 'Ridhi', CPC: 'CPC' }, IML, HEALTH, LR_CAT, H_LOADED: true, ME: { email: 'vishesh.g@example.com', tabs: ['health'] },
    parentName: (b, asin, fallback) => ({ BPARENT14: 'Floral Tablecloth', BPARENT20: 'Cotton Napkins' }[asin] || fallback),
    baCall: async q => { reads.push(q.sku); if (q.sku === opts.failSku) throw new Error('429'); if (q.lfix === 'get') return amazon(q.sku); return {}; },
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
  };
  const tail = '\n;return { FC, fcBuild, fcSuggest, fcProblems, fcTheme, fcStem, fcAlike, fcRating, fcLowRated, fcDrawAll, fcOpen, fcOkSet, fcOkSetMany, fcOkUndo, fcOkLoad,'
    + ' fcLink, fcLinkMany, fcSetValue, fcAfterSend, fcOpenLerr, fcCsv, fcGroups, fcCount, fcClick, fcToggle, fcReadFamily, fcSelected, FC_CSV_COLS, FC_STEP };';
  const C = new Function(...Object.keys(ctx), SRC + tail)(...Object.values(ctx));
  const body = () => C.FC.view ? el('fcBody').innerHTML : '';
  const click = (fc, data) => C.fcClick(Object.assign({ dataset: Object.assign({ fc }, data || {}), closest: () => null }));
  const tick = sku => click('tick', { fcB: 'SP', fcS: sku });
  const counts = () => ['orphan', 'dup', 'missing', 'theme'].map(k => C.fcCount(C.FC.view, k)).join(',');
  return Object.assign(C, { el, store, sends, calls, reads, S, IML, HEALTH, LR_CAT, mem, body, click, tick, counts, docKeys, scrolls });
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
// every queued read landed (a paused background read stops the wait after a while)
const flushAll = async C => { for (let i = 0; i < 3000 && (C.FC.reads.q.length || C.FC.reads.inflight); i++) await new Promise(r => setImmediate(r)); await flush(); };
const rowsOf = v => v.groups.flatMap(g => g.rows);
const probOf = (v, sku, k) => { const r = rowsOf(v).find(x => x.c.sku === sku); return r ? r.probs.find(p => p.k === k) || null : null; };
const heads = html => (html.match(/class="fc-head"/g) || []).length;
const drawnRows = html => (html.match(/class="fc-row/g) || []).length;

(async () => {
  console.log('== the small rules ==');
  {
    const C = setup();
    ok('theme as a key: SIZE/COLOR = SizeName-ColorName = color_size', C.fcTheme('SIZE/COLOR') === 'COLOR+SIZE' && C.fcTheme('SizeName-ColorName') === 'COLOR+SIZE' && C.fcTheme('color_size') === 'COLOR+SIZE');
    ok('theme COLOR is not COLOR+SIZE', C.fcTheme('COLOR') === 'COLOR');
    ok('SKU stem: RTC14-7 → RTC14, R-CP-351 → R-CP', C.fcStem('RTC14-7') === 'RTC14' && C.fcStem('R-CP-351') === 'R-CP');
  }

  console.log('== RULE 1: only live children ==');
  const A = setup();
  await A.fcOpen();
  let v = A.FC.view;
  {
    ok('live = buyable AND stock > 0: 13 of 16 children', v.live === 13 && v.all === 16, `live ${v.live} all ${v.all}`);
    A.fcToggle(RTC);
    ok('the not-live ones are never shown (even with their family open), never in the CSV', !/RTC14-8|RTC14-9|RTC14-10/.test(A.body()) && !/RTC14-8|RTC14-9|RTC14-10/.test(A.fcCsv(v).text));
    A.fcToggle(RTC);
    ok('a not-live child with the same colour as RTC14-1 makes no duplicate', !probOf(v, 'RTC14-1', 'dup'));
    ok('the meta line says live children only', /Live children only \(buyable and in stock\): 13 of 16/.test(A.el('fcMeta').innerHTML), A.el('fcMeta').innerHTML);
  }

  console.log('== open / close: one family at a time ==');
  {
    const C = setup();
    await C.fcOpen();
    const html = C.body();
    ok('on load every family is CLOSED: 2 lines, no child rows, no column header', heads(html) === 2 && drawnRows(html) === 0 && !/class="fc-colh"/.test(html) && !/<thead/.test(html), `${heads(html)} ${drawnRows(html)}`);
    ok('no guessing: before Amazon\'s theme is in, a line says "theme not read" — no Duplicate / Missing value chips', /theme not read/.test(html) && !/duplicate colour\/size|missing value/.test(html) && /2 not in family/.test(html), strip(html).slice(0, 500));
    ok('…the cards say "Checking themes… 0 of 2" and count no Duplicate / Missing value yet', /Checking themes… 0 of 2/.test(html) && C.counts() === '3,0,0,0', C.counts());
    ok('the background reads ONE listing per family (its parent), 2 at a time', C.reads.join() === 'RTC14-P,RNP20-P', C.reads.join());
    await flushAll(C);
    const html2 = C.body();
    ok('as the themes arrive, the colour / size families count (Duplicate 4, Missing value 1) and "Checking themes" goes', C.counts() === '3,4,1,0' && !/Checking themes/.test(html2) && !/theme not read/.test(html2), C.counts());
    ok('a closed line: name, brand, parent SKU, ASIN, live children, theme, problem chips', /Floral Tablecloth<\/b> <small class="muted">Ridhi · parent SKU RTC14-P · BPARENT14 · 6 live children · theme SIZE\/COLOR<\/small>/.test(html2) && /2 not in family/.test(html2) && /2 duplicate colour\/size/.test(html2), strip(html2).slice(0, 400));
    ok('no "Read themes" button anywhere', !/Read (variation )?themes|data-fc="read/.test(html + C.el('fcPane').innerHTML));
    C.click('grp', { fcV: RTC });
    let h = C.body();
    ok('the arrow opens THAT family: its problem rows (5) and its column header', C.FC.open === RTC && drawnRows(h) === 5 && (h.match(/class="fc-colh"/g) || []).length === 1 && /aria-expanded="true"/.test(h), drawnRows(h));
    ok('…the column header is inside the open family (SKU · ASIN · Colour · Size · Stock · Problem · Suggested fix)', /<tbody class="fc-grp is-open">[^]*<tr class="fc-colh">[^]*<th>SKU<\/th><th>ASIN<\/th><th>Colour<\/th><th>Size<\/th><th class="num">Stock<\/th><th>Problem<\/th><th>Suggested fix<\/th>/.test(h));
    ok('opening reads ITS children\'s themes, 2 at a time', C.reads.length === 4 && C.reads.slice(2).every(s => /^RTC14-[1-6]$/.test(s)), C.reads.join());
    ok('…the header says "Reading theme…" while they are out', /Reading theme…/.test(h));
    await flush();
    h = C.body();
    ok('…and not once they are in; the theme shows in the line', !/Reading theme…/.test(h) && /theme SIZE\/COLOR/.test(h));
    ok('…read: its 6 live children only — no stray child, no napkin child', C.reads.length === 8 && C.reads.slice(2).every(s => /^RTC14-[1-6]$/.test(s)), C.reads.join());
    ok('…open, it now shows 6 problem rows (RTC14-3: different theme)', drawnRows(h) === 6);
    C.click('grp', { fcV: RTC });
    ok('clicked again: it closes', C.FC.open === '' && drawnRows(C.body()) === 0);
    C.click('grp', { fcV: RTC });
    const before = C.reads.length;
    ok('opened again: nothing read again (kept for the session)', C.reads.length === before && before === 8);
    C.click('grp', { fcV: RNP });
    h = C.body();
    ok('opening another closes the first: only the napkins\' rows are drawn', C.FC.open === RNP && drawnRows(h) === 3 && !/data-fc-s="RTC14-/.test(h) && (h.match(/aria-expanded="true"/g) || []).length === 1);
    await flush();
    C.docKeys.forEach(fn => fn({ key: 'Escape' }));
    ok('Esc closes the open family', C.FC.open === '' && drawnRows(C.body()) === 0);
    const P = setup({ popupOpen: true });
    await P.fcOpen();
    P.fcToggle(RTC);
    P.docKeys.forEach(fn => fn({ key: 'Escape' }));
    ok('…but not while Amazon\'s check popup is open (Esc is the popup\'s)', P.FC.open === RTC);
    // no page jump: the line was at 300 px before; drawn again it is at 500 → the page scrolls by 200 so it stays at 300
    const J = setup({ lineTop: 500 });
    await J.fcOpen();
    J.fcToggle(RNP, { closest: () => ({ getBoundingClientRect: () => ({ top: 300 }) }) });
    ok('no page jump: the clicked line is kept where it was (scrolled by the difference)', J.scrolls.length === 1 && J.scrolls[0] === 200, J.scrolls.join());
  }

  console.log('== RULE 2: Not in family ==');
  {
    const p = probOf(v, 'RTC14-7', 'orphan');
    ok('RTC14-7 is "Not in family" (red) with the suggested family RTC14-P', p && p.sev === 'r' && p.fix.kind === 'link' && /RTC14-P/.test(p.fix.text), JSON.stringify(p));
    ok('…and why: the SKU (live children only), the title, the product type', p && /SKU like 6 children/.test(p.text) && /title matches/.test(p.text) && /same product type/.test(p.text), p && p.text);
    ok('RNP20-9 belongs to the napkins', probOf(v, 'RNP20-9', 'orphan') && probOf(v, 'RNP20-9', 'orphan').fix.text === 'Link to RNP20-P');
    ok('a product of its own (ZZ-100) is no error', !rowsOf(v).some(r => r.c.sku === 'ZZ-100'));
    ok('card "Not in family" = 3', A.fcCount(v, 'orphan') === 3);
    A.fcToggle(RTC);
    ok('the open row has a tick box, [Link to family] and [Removed on purpose]', /data-fc="tick"[^>]*data-fc-s="RTC14-7"/.test(A.body()) && /data-fc="link"[^>]*data-fc-s="RTC14-7"/.test(A.body()) && /data-fc="ok"[^>]*data-fc-s="RTC14-7"/.test(A.body()));
    ok('ratings: none in Sellora\'s data — reported on the page', v.ratingFound === 0 && /ratings: none in Sellora/.test(A.el('fcMeta').innerHTML));
  }

  console.log('== duplicate, missing, different theme ==');
  {
    await flushAll(A);
    v = A.FC.view;
    ok('RTC14-5 and RTC14-6: same colour + size (red)', probOf(v, 'RTC14-5', 'dup') && probOf(v, 'RTC14-6', 'dup') && /RTC14-5/.test(probOf(v, 'RTC14-6', 'dup').text));
    ok('the catalogue gives RTC14-6 another colour → [Set colour/size] "Black"', probOf(v, 'RTC14-6', 'dup').fix.kind === 'set' && probOf(v, 'RTC14-6', 'dup').fix.set.color === 'Black');
    ok('RTC14-5 already holds its catalogue colour → Fix by hand', probOf(v, 'RTC14-5', 'dup').fix.kind === 'hand');
    ok('RNP20-2 and RNP20-3 (napkins, never opened): duplicate once their parent\'s theme is in — the children never read', probOf(v, 'RNP20-2', 'dup') && !A.reads.some(s => /^RNP20-\d/.test(s)));
    const t = probOf(v, 'RTC14-3', 'theme');
    ok('after opening: RTC14-3 "Different theme" (yellow) — COLOR, the family uses SIZE/COLOR', t && t.sev === 'y' && /COLOR; the family uses SIZE\/COLOR/.test(t.text) && t.fix.kind === 'hand', t && t.text);
    ok('the siblings written SizeName-ColorName are the same theme', !probOf(v, 'RTC14-1', 'theme') && !probOf(v, 'RTC14-2', 'theme'));
    ok('the missing colour now names the theme; Set colour "Green"', /the theme is SIZE\/COLOR/.test(probOf(v, 'RTC14-4', 'missing').text) && probOf(v, 'RTC14-4', 'missing').fix.set.color === 'Green');
    ok('the reads are kept in this browser (the saved copy)', !!A.mem.fcReads1 && /RTC14-3/.test(A.mem.fcReads1));
    const csv = A.fcCsv(v);
    ok('CSV: red problems only (orphan 3 + dup 4 + missing 1 = 8 lines, no theme line)', csv.n === 8 && !/Theme COLOR/.test(csv.text) && csv.text.split('\r\n')[0].replace('﻿', '') === A.FC_CSV_COLS.join(','), csv.n);
    A.click('card', { fcV: 'theme' });
    ok('a card is a filter: Different theme keeps only RTC14-3', A.fcGroups(v).flatMap(g => g.rows).map(r => r.c.sku).join() === 'RTC14-3');
    A.click('card', { fcV: 'theme' });
    ok('…clicked again: everything', A.fcGroups(v).flatMap(g => g.rows).length === 9);
  }

  console.log('== ticks and the bar ==');
  {
    const C = setup();
    await C.fcOpen();
    C.fcToggle(RTC);
    await flush();
    const counts0 = C.counts();
    ok('no bar while nothing is ticked', !/class="fc-bar"/.test(C.body()));
    C.tick('RTC14-7');
    let h = C.body();
    ok('one ticked: "1 selected · Removed on purpose (1) · Link to family (1) · Clear"', /1 selected<\/b>/.test(h) && /Removed on purpose \(1\)/.test(h) && /Link to family \(1\)/.test(h) && /data-fc="bclear"/.test(h) && /class="fc-tick"[^>]*data-fc-s="RTC14-7" checked/.test(h));
    ok('tick boxes on the duplicate / missing rows too; none on a theme-only row', /data-fc="tick"[^>]*data-fc-s="RTC14-5"/.test(h) && /data-fc="tick"[^>]*data-fc-s="RTC14-4"/.test(h) && !/data-fc="tick"[^>]*data-fc-s="RTC14-3"/.test(h));
    C.click('bclear');
    C.click('selfam', { fcV: RTC });
    ok('[Select all in this family] ticks its "Not in family" rows (RTC14-7, RTC14-11) only', [...C.FC.sel].sort().join() === 'SP|RTC14-11,SP|RTC14-7' && /Clear this family/.test(C.body()), [...C.FC.sel].join());
    // two of one family: Link sends ONE popup with both
    await C.click('blink');
    const s = C.sends[0];
    ok('Link to family (2): one sqSendWithCheck, two listings, both to RTC14-P, screen "Family Check"', C.sends.length === 1 && s.jobs.length === 2 && s.jobs.every(j => j.body.patches[1].value[0].parent_sku === 'RTC14-P' && j.body.patches[2].value[0].name === 'SIZE/COLOR') && s.opts.screen === 'Family Check' && /Link 2 children/.test(s.opts.title));
    // two families: no link, the button says why
    C.click('bclear');
    C.tick('RTC14-7');
    C.fcToggle(RNP);
    C.tick('RNP20-9');
    h = C.body();
    ok('ticked children of two families: Link to family is disabled and says why', /data-fc="blink" disabled title="Link to family links children of one family at a time — the ticked ones belong to 2 families\."/.test(h) && /class="fc-why"/.test(h));
    ok('…and nothing is sent', (await C.fcLinkMany(['SP|RTC14-7', 'SP|RNP20-9'])) === null && C.sends.length === 1);
    ok('ticks survive closing / opening families (2 selected)', /2 selected<\/b>/.test(C.body()));
    // Removed on purpose for all, one reason
    C.click('bok');
    ok('Removed on purpose (2): one reason box for all, "low rating" in it', /Reason for all 2 <input type="text" data-fc-f="breason" value="low rating"/.test(C.body()));
    C.FC.bulkReason = 'discontinued colour';
    await C.click('boksave');
    const sp = C.store['listingrules/famok_SP'].items;
    ok('both saved with who / when / that reason, and gone from the red list', sp['RTC14-7'].on && sp['RNP20-9'].on && sp['RNP20-9'].reason === 'discontinued colour' && sp['RTC14-7'].by === 'vishesh.g@example.com'
      && !probOf(C.FC.view, 'RTC14-7', 'orphan') && !probOf(C.FC.view, 'RNP20-9', 'orphan'));
    ok('the ticks go with them; the grey link says 2', C.FC.sel.size === 0 && /2 removed on purpose › Show/.test(C.body()));
    // Open in Listing Errors (N)
    C.fcToggle(RTC);
    C.tick('RTC14-5'); C.tick('RTC14-6'); C.tick('RTC14-4');
    h = C.body();
    ok('duplicate / missing ticked: [Open in Listing Errors (3)], no Link / Removed', /Open in Listing Errors \(3\)/.test(h) && !/data-fc="blink"/.test(h));
    C.click('blerr');
    ok('…opens Listing Errors with just those 3 SKUs', C.calls.some(c => c.leOnly && c.leOnly.slice().sort().join() === 'RTC14-4,RTC14-5,RTC14-6') && C.calls.some(c => c.tab === 'lerr'));
    C.click('bclear');
    ok('the counts never change by opening, closing or ticking (only the 2 marks took 2 off "Not in family")', C.counts() === counts0.replace(/^3/, '1'), `${counts0} → ${C.counts()}`);
    // a ticked child with the same colour + size as another ticked child is held back (Fix by hand), the other is sent
    const H = setup({ c11: 'Yellow' });
    await H.fcOpen();
    await H.fcLinkMany(['SP|RTC14-7', 'SP|RTC14-11']);
    const hs = H.sends[0];
    ok('two ticked with the same colour + size: one sent, the other held back and named', hs && hs.jobs.length === 1 && hs.opts.held.length === 1 && /already used by RTC14-7/.test(hs.opts.held[0].why), JSON.stringify(hs && hs.opts.held));
  }

  console.log('== a theme that is not colour + size: waiting for Amazon theme data ==');
  {
    const ROD = 'SP|S:ROD-P';
    const C = setup({ desk: true });
    await C.fcOpen();
    C.fcToggle(ROD);
    await flush();
    const vv = C.FC.view;
    const h = C.body();
    ok('COLOR/SET_NAME family, two children both Black: NO duplicate', !probOf(vv, 'ROD-1', 'dup') && !probOf(vv, 'ROD-2', 'dup'));
    ok('…a child with no colour: NO missing value', !probOf(vv, 'ROD-3', 'missing'));
    ok('…instead grey "Waiting for Amazon theme data" on those rows and in the family line', ['ROD-1', 'ROD-2', 'ROD-3'].every(s => { const p = probOf(vv, s, 'wait'); return p && p.sev === 'g' && /Waiting for Amazon theme data — the theme is COLOR\/SET_NAME/.test(p.text); })
      && /<span class="fc-chip is-g">Waiting for Amazon theme data<\/span>/.test(h));
    const row1 = (h.match(/<tr class="fc-row[^"]*"><td class="fc-tk">(?:(?!<\/tr>)[^])*<b>ROD-1<\/b>(?:(?!<\/tr>)[^])*<\/tr>/) || [''])[0];
    ok('…no button, no tick box on a waiting row', row1 && !/data-fc="tick"/.test(row1) && !/<button/.test(row1), row1.slice(0, 300));
    ok('…not counted on the cards (only ROD-9 "Not in family" adds one), not in the CSV', C.counts() === '4,4,1,0' && !/ROD-[123]/.test(C.fcCsv(vv).text), C.counts());
    ok('the colour + size families are unchanged (RTC14-5 / RTC14-6 still duplicate, RTC14-4 still missing)', !!probOf(vv, 'RTC14-5', 'dup') && !!probOf(vv, 'RTC14-4', 'missing'));
    ok('a stray child of that family is still "Not in family" (Amazon shows no parent)', !!probOf(vv, 'ROD-9', 'orphan'));
    await C.fcLinkMany(['SP|ROD-9']);
    const s = C.sends[0];
    ok('…and Link to family is not held back because a sibling is also Black (colour alone is not the variation)', s && s.jobs.length === 1 && !(s.opts.held || []).length && s.jobs[0].body.patches[2].value[0].name === 'COLOR/SET_NAME', JSON.stringify(s && s.opts.held));
  }

  console.log('== no guessing: the themes read in the background ==');
  {
    const C = setup({ desk: true });
    await C.fcOpen();
    ok('three families, the first two parents asked at once (2 calls at most)', C.reads.join() === 'RTC14-P,RNP20-P' && C.FC.reads.q.some(j => j.bg && j.sku === 'ROD-P'));
    C.fcToggle(RTC);
    for (let i = 0; i < 5; i++) await flush();
    ok('while a family is open the background reads pause (ROD-P waits; the open family\'s children are read)', !C.reads.includes('ROD-P') && C.reads.filter(s => /^RTC14-[1-6]$/.test(s)).length === 6, C.reads.join());
    C.fcToggle(RTC);
    await flushAll(C);
    ok('closed: they go on (ROD-P read)', C.reads.includes('ROD-P'));
    ok('the COLOR/SET_NAME family: grey "Waiting for Amazon theme data", not counted', !!probOf(C.FC.view, 'ROD-1', 'wait') && !probOf(C.FC.view, 'ROD-1', 'dup'));
    const again = setup({ desk: true, mem: C.mem });
    await again.fcOpen();
    ok('kept in the saved copy: the next page load reads nothing and counts at once', again.reads.length === 0 && again.counts() === C.counts() && !/Checking themes|theme not read/.test(again.body()), again.reads.join() + ' ' + again.counts());
    const F = setup({ failSku: 'RNP20-P' });
    await F.fcOpen();
    await flushAll(F);
    ok('a parent Amazon could not answer: "theme could not be read", nothing counted for it', /theme could not be read/.test(F.body()) && !probOf(F.FC.view, 'RNP20-2', 'dup') && !!probOf(F.FC.view, 'RTC14-5', 'dup'));
    const F2 = setup({ mem: F.mem });
    await F2.fcOpen();
    ok('…the failure is not saved: the next page load asks again', F2.reads.join() === 'RNP20-P', F2.reads.join());
  }

  console.log('== counts unchanged by the list ==');
  {
    const C = setup();
    await C.fcOpen();
    C.fcToggle(RTC); await flush(); C.fcToggle(RNP); await flush();
    const c0 = C.counts();
    C.fcToggle(RTC); C.fcToggle(RTC); C.fcToggle(RNP); C.tick('RNP20-9'); C.click('bclear'); C.docKeys.forEach(fn => fn({ key: 'Escape' }));
    ok('open, close, another, tick, clear, Esc: the four cards are the same', C.counts() === c0 && c0 === '3,4,1,1', c0 + ' / ' + C.counts());
  }

  console.log('== long lists: drawn a part at a time ==');
  {
    const C = setup();
    const many = [];
    for (let i = 0; i < 150; i++) {
      many.push({ sku: `ZQ${i}-P`, asin: 'BPZQ' + i, st: 'DISCOVERABLE', pt: 'RUG', t: 'Rug ' + i, lvl: 'parent' });
      ['a', 'b'].forEach(x => many.push({ sku: `ZQ${i}-${x}`, asin: `B0ZQ${i}${x}`, st: 'BUYABLE', pt: 'RUG', t: 'Jute rug ' + i, lvl: 'child', psku: `ZQ${i}-P`, c: 'Beige', z: '5x7' }));
    }
    C.S.items.push(...many);
    many.filter(m => m.lvl === 'child').forEach(m => C.HEALTH.SP.rows.push({ sku: m.sku, asin: m.asin, parent: '', title: m.t, qty: 2 }));
    await C.fcOpen();
    await flushAll(C);
    const h = C.body();
    ok(`152 families with a problem: only ${C.FC_STEP} lines drawn, then "Show more families (92 left)"`, heads(h) === 60 && /Show more families \(92 left\)/.test(h), heads(h));
    C.click('more');
    ok('Show more: 120 lines', heads(C.body()) === 120);
    ok('the cards still count every family', C.fcCount(C.FC.view, 'dup') === 304);
  }

  console.log('== the fixes go through sqSendWithCheck ==');
  {
    const C = setup();
    await C.fcOpen();
    await C.fcLink('SP', 'RTC14-7');
    const s = C.sends[0];
    const body = s && s.jobs[0].body;
    ok('Link to family (one row) → sqSendWithCheck, parentage child, parent RTC14-P, the parent\'s theme', C.sends.length === 1 && body.productType === 'TABLECLOTH'
      && JSON.stringify(body.patches.map(p => p.path)) === JSON.stringify(['/attributes/parentage_level', '/attributes/child_parent_sku_relationship', '/attributes/variation_theme'])
      && body.patches[1].value[0].parent_sku === 'RTC14-P' && body.patches[2].value[0].name === 'SIZE/COLOR');
    ok('…the popup lists the changes with the old values (for Put back)', s.jobs[0].changes.length === 3 && s.jobs[0].changes.every(c => Array.isArray(c.oldV)));
    await C.fcSetValue('SP', 'RTC14-4', 'missing');
    const s2 = C.sends[1];
    ok('Set colour/size → sqSendWithCheck with color "Green" (the catalogue\'s), the language kept', s2 && s2.jobs[0].body.patches[0].path === '/attributes/color' && s2.jobs[0].body.patches[0].value[0].value === 'Green' && s2.jobs[0].body.patches[0].value[0].language_tag === 'en_US');
    ok('a Fix by hand problem has no send — fcSetValue does nothing for RTC14-5', (await C.fcSetValue('SP', 'RTC14-5', 'dup')) === null && C.sends.length === 2);
    C.fcOpenLerr('SP', 'RTC14-3');
    ok('Open in Listing Errors: that one SKU, then the Listing Errors tab', C.calls.some(c => c.leOnly && c.leOnly.join() === 'RTC14-3') && C.calls.some(c => c.tab === 'lerr'));
    ok('nothing in the file sends any other way', !/imPost|lfix: 'patch', brand, sku, productType: pt, patches \}\)\s*;|baCall\(\{ lfix: 'patch'|limg: 'patch'/.test(SRC));
    C.fcAfterSend({ jobs: [{ brand: 'SP', sku: 'RTC14-4', state: 'accepted' }] }, () => ({ color: 'Green' }));
    ok('accepted: RTC14-4 has its colour and leaves the list', !probOf(C.FC.view, 'RTC14-4', 'missing'));
    C.fcAfterSend({ jobs: [{ brand: 'SP', sku: 'RTC14-7', state: 'accepted' }, { brand: 'SP', sku: 'RTC14-11', state: 'working' }] }, () => ({ psku: 'RTC14-P', theme: 'SIZE/COLOR', lvl: 'child' }));
    ok('a bulk Link: the accepted one leaves the list, the one still working says so', !probOf(C.FC.view, 'RTC14-7', 'orphan') && !!probOf(C.FC.view, 'RTC14-11', 'orphan') && /still working/.test(C.FC.note['SP|RTC14-11']));
  }

  console.log('== RULE 3: Removed on purpose (one row) ==');
  const B = setup();
  await B.fcOpen();
  {
    await B.fcOkSet('SP', 'RTC14-7', 'low rating');
    v = B.FC.view;
    const html = B.body();
    ok('the child leaves the red list at once', !probOf(v, 'RTC14-7', 'orphan') && B.fcCount(v, 'orphan') === 2);
    ok('saved with who / when / reason in listingrules/famok_SP', (() => { const e = (B.store['listingrules/famok_SP'] || { items: {} }).items['RTC14-7']; return e && e.on && e.by === 'vishesh.g@example.com' && e.name === 'Vishesh G' && e.reason === 'low rating' && e.at > 0 && e.fam === 'RTC14-P'; })(), JSON.stringify(B.store));
    ok('nothing else is written: one document, kind famok', Object.keys(B.store).join() === 'listingrules/famok_SP' && B.store['listingrules/famok_SP'].kind === 'famok');
    ok('the page shows only the grey link "1 removed on purpose › Show"', /1 removed on purpose › Show/.test(html) && !/data-fc-s="RTC14-7"/.test(html));
    ok('not in the CSV', !/RTC14-7/.test(B.fcCsv(v).text));
    B.click('showok');
    ok('Show: the list with who, the reason and [Undo]', /RTC14-7/.test(B.body()) && /Vishesh G/.test(B.body()) && /low rating/.test(B.body()) && /data-fc="undo"/.test(B.body()));
    ok('the e-mail is never on the page', !/example\.com/.test(B.body()));
    const B2 = setup({ store: B.store });
    await B2.fcOpen();
    ok('for good: after a reload it is still not an error', !probOf(B2.FC.view, 'RTC14-7', 'orphan') && B2.FC.view.removed.length === 1);
    await B2.fcOkUndo('SP', 'RTC14-7');
    ok('Undo brings it back as an error', !!probOf(B2.FC.view, 'RTC14-7', 'orphan') && B2.FC.view.removed.length === 0);
    const e = B.store['listingrules/famok_SP'].items['RTC14-7'];
    ok('…saved: on false, who undid it and when, the first mark kept', e.on === false && e.undoneBy === 'vishesh.g@example.com' && e.undoneAt > 0 && e.reason === 'low rating');
    const B3 = setup({ store: B.store });
    await B3.fcOpen();
    ok('…and after a reload it is an error again', !!probOf(B3.FC.view, 'RTC14-7', 'orphan'));
  }

  console.log('== a linked or no-longer-live child leaves every list ==');
  {
    const D = setup();
    await D.fcOpen();
    await D.fcOkSet('SP', 'RTC14-7', 'low rating');
    D.S.items.find(i => i.sku === 'RTC14-7').psku = 'RTC14-P';
    v = D.fcBuild();
    ok('linked: not an error, not in the removed list', !probOf(v, 'RTC14-7', 'orphan') && v.removed.length === 0);
    D.S.items.find(i => i.sku === 'RTC14-7').psku = '';
    D.HEALTH.SP.rows.find(r => r.sku === 'RTC14-7').qty = 0;
    v = D.fcBuild();
    ok('no longer live: not an error, not in the removed list, not counted', !probOf(v, 'RTC14-7', 'orphan') && v.removed.length === 0 && v.live === 12);
    D.HEALTH.SP.rows.find(r => r.sku === 'RTC14-7').qty = 3;
    v = D.fcBuild();
    ok('live again (and never linked): still removed on purpose — the mark holds', !probOf(v, 'RTC14-7', 'orphan') && v.removed.length === 1);
  }

  console.log('== ratings (if Sellora ever holds them) ==');
  {
    const R = setup();
    R.S.items.find(i => i.sku === 'RTC14-7').rating = 3.5;
    R.S.items.find(i => i.sku === 'RTC14-7').reviews = 12;
    await R.fcOpen();
    ok('rating below 4 → treated as removed on purpose (listed as automatic)', !probOf(R.FC.view, 'RTC14-7', 'orphan') && R.FC.view.removed[0].why === 'rating' && R.FC.view.ratingFound === 1);
    ok('…and the page says ratings were found', /ratings found for 1 listings/.test(R.el('fcMeta').innerHTML));
    ok('0 reviews → error; 4 or more → error; none → error', !R.fcLowRated({ rating: 3, reviews: 0 }) && !R.fcLowRated({ rating: 4.2, reviews: 30 }) && !R.fcLowRated(null) && R.fcLowRated({ rating: 3.9, reviews: 1 }));
  }

  console.log('== the test site, the Categories tab ==');
  {
    const T = setup({ test: true });
    await T.fcOpen();
    await T.fcOkSet('SP', 'RTC14-7', 'low rating');
    ok('test site: hidden on the page, nothing saved, and it says so', !probOf(T.FC.view, 'RTC14-7', 'orphan') && !Object.keys(T.store).length && /Test site — the mark is kept on this page only/.test(T.el('fcMeta').innerHTML));
    T.click('tab', { fcV: 'cat' });
    ok('Categories: "Coming with the automatic refresh — browse nodes"', /Coming with the automatic refresh — browse nodes/.test(T.el('fcBody').innerHTML));
  }

  console.log('== other screens unchanged ==');
  {
    const assigns = SRC.match(/\b(HEALTH|IML|LR_CAT|LI_WS|AMZ|H_CTX|H_LOADED|LR|SP|LH|SQ)\s*(\[[^\]]*\])*\s*(\.\w+)*\s*=(?!=)/g) || [];
    ok('family-check.js never writes Listing Health / Image Manager / catalogue / Workspace / planner state', !assigns.length, assigns.join(' | '));
    ok('the search waits 250 ms after typing', /FC_T = setTimeout\(fcDrawAll, 250\)/.test(SRC));
    const root = path.join(__dirname, '..', '..');
    let changed = [];
    try { changed = cp.execSync('git diff --name-only HEAD -- Pricing-App/src Pricing-App/firestore.rules Pricing-API', { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean); } catch (e) { changed = ['(git not available)']; }
    const allowed = ['Pricing-App/src/app/ORDER', 'Pricing-App/src/app/core/nav.js', 'Pricing-App/src/index.html', 'Pricing-App/src/styles.css', 'Pricing-App/src/app/listing/family-check.js'];
    ok('only this screen\'s file, its CSS and its menu entry changed — no backend, no rules, no other screen', changed.every(f => allowed.includes(f)), changed.join(', '));
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
    let cssDiff = '';
    try { cssDiff = cp.execSync('git diff -U0 HEAD -- Pricing-App/src/styles.css', { cwd: root, encoding: 'utf8' }); } catch (e) { cssDiff = ''; }
    ok('styles.css: only #paneFam / #tabFam lines change', cssDiff.split(/\r?\n/).filter(l => /^[+-](?![+-])/.test(l)).every(l => /#paneFam|#tabFam|^[+-]\s+background:var\(--card\);border:1px/.test(l)) && /#paneFam \.fc-bar/.test(css));
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    ok('menu: column 2 · Check, right after BSR Audit', /<button id="tabBsr" class="nav">BSR Audit<\/button>\r\n      <button id="tabFam" class="nav">Family &amp; Category Check<\/button><\/div>/.test(html) && /data-tabs="[^"]*bsr,fam,/.test(html));
    ok('nav.js: the tab, its title, with Listing Health (TAB_INHERIT)', /'lhist', 'fam'\]/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'core', 'nav.js'), 'utf8')) && /fam: 'health'/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'core', 'nav.js'), 'utf8')));
    ok('the new file is CRLF', !/(^|[^\r])\n/.test(SRC));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
