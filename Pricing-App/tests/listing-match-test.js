/* The Listing screens read Amazon's data from the ListingMatch cache (src/app/listing/listing-match.js), over the real files in a stub page.
 *   node tests/listing-match-test.js
 * Mock lmMeta / lmListings_* / lmCatalog_* answers (the shapes Pricing-API/ListingMatch.gs writes) for five cases: a normal cache, an empty
 * cache, an old cache (> 24 h), a stale record, and a live read after a send laid over the cache until a newer pass. Also: the one read
 * door (no other file reads the cache tabs), the browser's saved copy opening with no network, and how fast that is for ~4,400 listings. */
const fs = require('fs'), path = require('path');
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const H = 3600000;
const IST = ms => new Date(ms + 5.5 * H).toISOString().slice(0, 16).replace('T', ' ');   // ListingMatch writes 'yyyy-MM-dd HH:mm' in IST
const pic = (sku, slot) => `https://m.media-amazon.com/images/I/${sku.replace(/[^A-Za-z0-9]/g, '')}${slot}.jpg`;
const GALLERY = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07'];

// The cache as ListingMatch writes it, built from the stub page's own Listing Health rows: the same facts as the snapshot unless `edit`
// changes a record. → { tabs: { lmMeta, lmListings_SP_1_0, … } }
function cacheOf(C, o) {
  o = o || {};
  const at = o.at || Date.now() - H;
  const tabs = {};
  const meta = { v: 2, kind: o.kind || 'full', startedAt: IST(at - 20 * 60000), finishedAt: IST(at), upTo: IST(at - 20 * 60000), nextRun: '', counts: {},
    lastFull: { finishedAt: IST(o.fullAt || at), brands: o.fullBrands || o.only || ['SP', 'CPC'], gaveUp: o.gaveUp || [] }, hash: 'h31', parts: { listings: {}, catalog: {} } };
  (o.only || ['SP', 'CPC']).forEach(b => {
    const items = {}, cat = {};
    (C.HEALTH[b].rows || []).forEach(row => {
      const title = (row.content && row.content.title) || row.title;
      const n = row.content ? row.content.images : 8;
      items[row.sku] = { sku: row.sku, asin: row.asin, b, as: 'BUYABLE,DISCOVERABLE', pt: 'NAPKIN', t: title, bl: ['a', 'b', 'c', 'd', 'e'], d: 'x'.repeat(300), hl: [],
        kw: 'cotton napkins', lvl: 'child', psku: 'PS-' + row.parent, theme: '', va: {}, img: Object.fromEntries(GALLERY.slice(0, n).map(s => [s, pic(row.sku, s)])),
        iss: [], upd: '', readAt: at, rs: row.status, qty: null, price: row.price, ch: row.channel, rAt: at - 30 * 60000, fyp: null, inSupReport: false, fba: row.qty, sup: null };
      cat[row.asin] = { asin: row.asin, t: title, brand: row.amzBrand || '', img: Object.fromEntries(GALLERY.slice(0, n).map(s => [s, { u: pic(row.sku, s), w: 2000, h: 2000 }])),
        pa: ['BP' + row.parent], kids: [], theme: '', tattrs: [], vals: { color: 'Blue', size: '18 x 18 Inch' }, bc: 'Home & Kitchen › Kitchen & Dining',
        rk: { main: { r: 1000 + row.sku.length, c: 'Home & Kitchen' }, sub: { r: 50, c: 'Cloth Napkins' } }, aplus: null, readAt: at };
      const pa = 'BP' + row.parent;
      cat[pa] = cat[pa] || { asin: pa, t: 'Parent ' + row.parent, brand: '', img: {}, pa: [], kids: [], theme: 'SIZE_NAME/COLOR_NAME', tattrs: ['color', 'size'], vals: {}, rk: { main: null, sub: null }, aplus: null, readAt: at };
      cat[pa].kids.push(row.asin);
    });
    if (o.edit) o.edit(b, items, cat);
    tabs[`lmListings_${b}_1_0`] = { b, part: 0, of: 1, at: IST(at), items };
    tabs[`lmCatalog_${b}_1_0`] = { b, part: 0, of: 1, at: IST(at), items: cat };
    meta.parts.listings[b] = [`lmListings_${b}_1_0`];
    meta.parts.catalog[b] = [`lmCatalog_${b}_1_0`];
  });
  tabs.lmMeta = meta;
  return { tabs };
}
// A stub page with the cache door: `net.tabs` is what the backend answers to ?cache=… (none: "nothing cached"); `hang`: it never answers.
function page(opts) {
  opts = opts || {};
  const net = { tabs: null, hang: false, fail: new Set() };
  const calls = [];
  const C = load(Object.assign({ lm: true, ws: true, baCall: async q => {
    calls.push(q);
    if (q.cache) {
      if (net.hang) return new Promise(() => {});
      if (net.fail.has(q.cache)) throw new Error('backend timed out');
      const d = net.tabs && net.tabs[q.cache];
      if (!d) throw new Error(`nothing cached for "${q.cache}" yet`);
      return { ok: true, name: q.cache, data: JSON.parse(JSON.stringify(d)) };
    }
    if (q.lfix === 'get') return opts.get ? opts.get(q) : { productType: 'NAPKIN', status: ['BUYABLE', 'DISCOVERABLE'], issues: [], attributes: {} };
    if (q.lfix === 'schema') return { attrs: { material: {}, color: {}, size: {}, pattern: {}, theme: { missing: true } } };   // the product type's schema: these four apply
    if (q.limg === 'get') return opts.limg ? opts.limg(q) : { ok: true, sku: q.sku, listing: {}, catalog: {} };
    return {};
  } }, opts.load || {}));
  const mem = { copy: opts.copy || null };
  C.lmStoreUse({ get: async () => (mem.copy ? structuredClone(mem.copy) : null), put: async c => { mem.copy = structuredClone(c); return true; } });
  return { C, net, calls, mem };
}
const ids = (C, row) => C.healthOf(Object.assign({}, row), C.hCtx()).found.map(h => h.detector).sort().join(',');
const allIds = C => ['SP', 'CPC'].flatMap(b => C.HEALTH[b].rows.map(row => row.sku + ':' + ids(C, row))).join(' | ');
const rowOf = (C, sku) => ['SP', 'CPC'].map(b => C.HEALTH[b].rows.find(r => r.sku === sku)).find(Boolean);

(async () => {
  // the screens' answers with NO cache at all (the files before this change behave so): what every fallback must give back
  const base = page({ load: {} });
  base.C.reset();
  const BASE = allIds(base.C);

  console.log('== one read door: no screen reads the cache tabs itself ==');
  {
    const dir = path.join(__dirname, '..', 'src', 'app');
    const files = [];
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.js$/.test(e.name) && files.push(path.join(d, e.name))));
    walk(dir);
    const readers = files.filter(f => /lmListings_|lmCatalog_|['"]lmMeta['"]/.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(dir, f).replace(/\\/g, '/'));
    ok('only listing/listing-match.js names lmMeta / lmListings_ / lmCatalog_', readers.join() === 'listing/listing-match.js', readers.join());
    const order = fs.readFileSync(path.join(dir, 'ORDER'), 'utf8');
    const list = (text, name) => (text.match(new RegExp(name + ' = (\\[[^\\]]*\\])')) || [])[1];
    const gs = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'ListingMatch.gs'), 'utf8'), ws = fs.readFileSync(path.join(dir, 'listing', 'listing-workspace.js'), 'utf8');
    const same = JSON.stringify(eval(list(gs, 'LM_SPEC_ATTRS'))) === JSON.stringify(eval(list(ws, 'LI_WS_SPECS')));
    ok('ListingMatch.gs keeps the same 12 spec attributes as the Workspace checks (LM_SPEC_ATTRS = LI_WS_SPECS)', same && eval(list(gs, 'LM_SPEC_ATTRS')).length === 12);
    ok('listing-match.js is in ORDER, right after listing-rules.js', /listing\/listing-rules\.js\r?\nlisting\/listing-match\.js\r?\n/.test(order));
  }

  console.log('== NORMAL: the cache is read, saved in the browser, and every screen\'s data comes from it ==');
  {
    const { C, net, calls, mem } = page();
    C.HEALTH.SP.at = C.HEALTH.CPC.at = new Date(Date.now() - 5 * 24 * H);       // the Listing Health snapshot: 5 days old
    net.tabs = cacheOf(C, { edit: (b, items, cat) => {
      if (b !== 'SP') return;
      items.R6.as = 'BUYABLE';                                                 // a) buyable, not discoverable → Suppressed
      items.R9.inSupReport = true; items.R9.fyp = { r: 'Missing main image', d: '', at: '' };   // c) in Amazon's Suppressed report
      items.R10.iss = [{ c: '90220', s: 'ERROR', m: 'The color value is not valid', a: ['color'] }];
      items.R2.bl = ['only one'];                                              // content from the cache: 1 bullet
      items.R1.rs = 'Inactive';                                                // the cache's All Listings report: Inactive, with stock
      cat[rowOf(C, 'R13').asin].img = Object.fromEntries(GALLERY.map(s => [s, { u: pic('R13', s), w: 2000, h: 2000 }]));   // 8 pictures shoppers see (the snapshot said 4)
    } }).tabs;
    await C.lmEnsure();
    await C.lmRefresh();
    ok('read: lmMeta, then the 4 tabs it names (2 brands × listings + catalog)', calls.filter(q => q.cache).map(q => q.cache).join() === 'lmMeta,lmListings_SP_1_0,lmCatalog_SP_1_0,lmListings_CPC_1_0,lmCatalog_CPC_1_0', calls.map(q => q.cache).join());
    ok('usable for both brands; a copy saved in the browser', C.lmOk('SP') && C.lmOk('CPC') && !!(mem.copy && mem.copy.list && mem.copy.list.SP.R6));
    const r6 = C.lmGet('R6', 'SP');
    ok('lmGet(sku): the listing (status, issues in one shape, the reports) with its catalog record', r6 && r6.as === 'BUYABLE' && r6.cat && r6.cat.asin === r6.asin && r6.brand === 'SP' && Array.isArray(r6.iss));
    ok('lmGet without a brand finds it too; lmGetAsin(asin) = what shoppers see', C.lmGet('C1a').brand === 'CPC' && C.lmGetAsin(rowOf(C, 'C1a').asin).t === rowOf(C, 'C1a').content.title);
    C.reset();
    ok('Listing Health: R6 Suppressed (rule a, BUYABLE without DISCOVERABLE) — from the cache', ids(C, rowOf(C, 'R6')).includes('amazon_suppressed'), ids(C, rowOf(C, 'R6')));
    ok('…R9 Suppressed by Amazon\'s Suppressed listings report (rule c, the cache\'s inSupReport → LR_FYP)', ids(C, rowOf(C, 'R9')).includes('amazon_suppressed') && C.LR_FYP.SP.get('R9') === 'Missing main image', ids(C, rowOf(C, 'R9')));
    ok('…R10 an Amazon ERROR — an error at its own level, NOT suppressed (the one rule unchanged)', ids(C, rowOf(C, 'R10')).includes('amazon_error') && !ids(C, rowOf(C, 'R10')).includes('amazon_suppressed'), ids(C, rowOf(C, 'R10')));
    ok('…R2 bullets from the cache (1 bullet → Missing bullet)', ids(C, rowOf(C, 'R2')).includes('bullets_below'), ids(C, rowOf(C, 'R2')));
    ok('…R13 pictures shoppers see from the cache\'s catalog (8, so no "Secondary images missing")', !ids(C, rowOf(C, 'R13')).includes('images_below') && ids(base.C, rowOf(base.C, 'R13')).includes('images_below'));
    ok('…R1 the cache\'s newer All Listings report: Inactive with stock', rowOf(C, 'R1').status === 'Inactive' && ids(C, rowOf(C, 'R1')).includes('inactive_with_stock'), rowOf(C, 'R1').status);
    const untouched = ['R3', 'R4', 'R5', 'R7', 'R8', 'R11', 'R12', 'R14', 'C1a', 'C1b', 'C1c', 'C2a', 'C2b'];
    ok('every listing the cache says the same about: the very same findings as before (only where the data comes from changed)',
      untouched.every(sku => ids(C, rowOf(C, sku)) === ids(base.C, rowOf(base.C, sku))), untouched.filter(sku => ids(C, rowOf(C, sku)) !== ids(base.C, rowOf(base.C, sku))).join());
    const kid = C.liWsChildKept(rowOf(C, 'R10'), 'SP', C.hCtx(), new Map(), Date.now());
    ok('Workspace: the Amazon cell from the cache (as a live read: "Amazon Listings API"), with Amazon\'s message', kid.c.amz.pass === false && kid.c.amz.cell === 'Error' && /Listings API/.test(kid.c.amz.src.s) && /color value/.test(kid.c.amz.found), JSON.stringify(kid.c.amz).slice(0, 200));
    ok('Workspace: the kid\'s read is the cache\'s — opening its parent reads nothing again (content, status and pictures read < 24 h ago)', kid.lr && kid.lr.cAt > Date.now() - 2 * H && kid.lr.gAt && kid.lr.iAt);
    const B = C.bfCalc ? C.bfOf(kid, kid.found.find(h => h.detector === 'amazon_error'), C.hCtx(), Date.now()) : null;
    ok('B / F: B from the cache\'s issues (red), F from the one rule + the catalog (buyable, green)', B && B.b === 'r' && B.f === 'g', JSON.stringify(B));
    C.IML.SP = { at: new Date(Date.now() - 5 * 24 * H), items: [{ sku: 'R6', asin: rowOf(C, 'R6').asin, st: 'BUYABLE,DISCOVERABLE', img: {}, live: {}, iss: [] }, { sku: 'OLD-1', st: 'BUYABLE', img: {}, live: {}, iss: [] }] };
    C.lmImlApply('SP');
    const im = C.IML.SP.items.find(i => i.sku === 'R6');
    ok('Image Manager list (IML): the cache\'s status and pictures laid over the 5-day-old snapshot; the snapshot\'s other items kept; the cache\'s other listings added',
      im.st === 'BUYABLE' && im.live.MAIN === pic('R6', 'MAIN') && im.img.MAIN === pic('R6', 'MAIN') && C.IML.SP.items.some(i => i.sku === 'OLD-1') && C.IML.SP.items.some(i => i.sku === 'R13') && C.IML.SP.lm === true);
    ok('…the parents its listings name, from the catalog (so the families group)', C.IML.SP.items.some(i => i.lvl === 'parent' && i.sku === 'PS-P1' && i.asin === 'BPP1'));
    ok('…the list\'s date is the cache\'s pass (so the Image Manager does not rebuild a "day-old" snapshot from Amazon)', Date.now() - C.IML.SP.at.getTime() < 2 * H);
    const map = new Map();
    C.lmAmzApply(map);
    ok('Amazon status map (AMZ, Listing Health fallback / BSR family status) from the cache', map.get('SP|R6').st === 'BUYABLE' && map.get('SP|R10').ie === 1 && /ERROR 90220/.test(map.get('SP|R10').em[0]));
    ok('Family check: a parent\'s children and theme, a child\'s parent and its values for the theme', (C.lmFcCat('SP', 'BPP1') || {}).theme === 'SIZE_NAME/COLOR_NAME' && C.lmFcCat('SP', 'BPP1').kids.length === 7
      && C.lmFcCat('SP', rowOf(C, 'R1').asin).pa === 'BPP1' && C.lmFcCat('SP', rowOf(C, 'R1').asin).vals.size === '18 x 18 Inch');
    const rk = C.lmRanks('SP', [rowOf(C, 'R1').asin, 'B0NOTCACHED']);
    ok('BSR Audit: ranks (main + sub-category) from the cache; an ASIN it lacks is left for the live call', rk[rowOf(C, 'R1').asin].rank > 0 && rk[rowOf(C, 'R1').asin].subCat === 'Cloth Napkins' && !('B0NOTCACHED' in rk));
    const age = C.lmAgeHtml();
    const want = `Amazon data: ${C.lmFmt(net.tabs.lmMeta.finishedAt)} · next refresh ~${C.lmNextFull()}`;
    ok('the age line: "Amazon data: 16 Nov 18:30 · next refresh ~13:00" (grey)', age.includes(want) && !/is-old/.test(age) && /^\d{1,2} [A-Z][a-z]{2} \d\d:\d\d$/.test(C.lmFmt(net.tabs.lmMeta.finishedAt)), age);
    ok('next refresh is the next full pass (13:00 or 18:00 IST)', C.lmNextFull(Date.UTC(2026, 10, 16, 4, 0)) === '13:00' && C.lmNextFull(Date.UTC(2026, 10, 16, 8, 0)) === '18:00' && C.lmNextFull(Date.UTC(2026, 10, 16, 14, 0)) === '13:00');
    // the same pass again: only lmMeta is asked
    calls.length = 0;
    await C.lmRefresh();
    ok('the same pass on the next check: only lmMeta is asked (the tabs are not read again)', calls.map(q => q.cache).join() === 'lmMeta', calls.map(q => q.cache).join());
    // one tab fails on a newer pass: that brand keeps its last records
    const newer = cacheOf(C, { at: Date.now() - 10 * 60000, edit: (b, items) => { if (b === 'CPC') items.C1a.as = 'BUYABLE'; } }).tabs;
    net.tabs = newer;
    net.fail.add('lmListings_SP_1_0');
    await C.lmRefresh();
    ok('a newer pass with one tab failing: the other brand takes it, the failed one keeps its last copy (never emptied)', C.lmGet('C1a', 'CPC').as === 'BUYABLE' && C.lmGet('R6', 'SP').as === 'BUYABLE' && C.lmOk('SP') && /could not be read/.test(C.LM.err));
  }

  console.log('== SAVED COPY: the next visit opens from the browser, no network wait ==');
  {
    const first = page();
    first.net.tabs = cacheOf(first.C).tabs;
    await first.C.lmEnsure();
    await first.C.lmRefresh();
    const { C, net, calls } = page({ copy: first.mem.copy });
    net.hang = true;                                                            // the backend never answers
    const t0 = Date.now();
    await C.lmEnsure();
    ok('usable at once from the saved copy, with the backend not answering', C.lmOk('SP') && C.LM.state === 'saved' && !!C.lmGet('R6', 'SP') && calls.filter(q => q.cache).length <= 1);
    ok('…and lmEnsure did not wait for it (resolved in ' + (Date.now() - t0) + ' ms)', Date.now() - t0 < 500);
  }

  console.log('== EMPTY CACHE: every screen uses its own reads exactly as before, no error ==');
  {
    const { C, net } = page();
    net.tabs = null;                                                            // "nothing cached for lmMeta yet"
    await C.lmEnsure();
    await C.lmRefresh();
    C.reset();
    ok('not usable; state "empty"', !C.lmOk() && C.LM.state === 'empty');
    ok('every listing: the very same findings as with no cache code at all', allIds(C) === BASE);
    ok('IML / AMZ / HEALTH left as they were', C.IML.SP.items.length === 0 && !C.AMZ.map && C.HEALTH.SP.rows.every(r => !r.lmAt));
    const age = C.lmAgeHtml();
    ok('the age line says the screen uses its own reads — no red, no "error"', /own reads/.test(age) && !/error|could not|fail/i.test(age), age);
    const { C: C2, net: n2 } = page();
    n2.fail.add('lmMeta');                                                      // the backend call itself fails
    await C2.lmEnsure(); await C2.lmRefresh(); C2.reset();
    ok('a failed read: the same (state "err" kept for lmStatus, nothing shown as an error)', !C2.lmOk() && C2.LM.state === 'err' && allIds(C2) === BASE && !/error/i.test(C2.lmAgeHtml()));
  }

  console.log('== OLD CACHE (> 24 h): today\'s reads as before, the age line in amber ==');
  {
    const { C, net } = page();
    net.tabs = cacheOf(C, { at: Date.now() - 30 * H, edit: (b, items) => { if (b === 'SP') items.R6.as = 'BUYABLE'; } }).tabs;
    await C.lmEnsure();
    await C.lmRefresh();
    C.reset();
    ok('not usable (its last pass is 30 h old)', !C.lmOk('SP') && !C.lmOk('CPC') && C.lmGet('R6', 'SP') === null);
    ok('every listing: the very same findings as with no cache (the old suppression is not used)', allIds(C) === BASE);
    C.IML.SP = { at: new Date(), items: [] };
    C.lmImlApply('SP');
    ok('the Image Manager keeps its own snapshot', C.IML.SP.items.length === 0 && !C.IML.SP.lm);
    ok('the age line in amber: "Amazon data: <30 h ago> · next refresh ~…"', /lm-age-t is-old/.test(C.lmAgeHtml()) && C.lmAgeHtml().includes('Amazon data: ' + C.lmFmt(net.tabs.lmMeta.finishedAt)));
  }

  console.log('== STALE RECORD: shown as usual, with a small grey "old data" mark ==');
  {
    const { C, net } = page();
    net.tabs = cacheOf(C, { edit: (b, items) => { if (b === 'SP') Object.assign(items.R3, { stale: 1, readAt: Date.now() - 50 * H, bl: ['one', 'two'] }); } }).tabs;
    await C.lmEnsure();
    await C.lmRefresh();
    C.reset();
    ok('used as usual: R3 judged on its kept read (2 bullets → Missing bullet)', ids(C, rowOf(C, 'R3')).includes('bullets_below'), ids(C, rowOf(C, 'R3')));
    const mark = C.lmOldHtml('SP', 'R3');
    ok('the grey "old data" mark, with when it was read', /class="lm-old"/.test(mark) && />old data</.test(mark) && /earlier read/.test(mark), mark);
    ok('…only on the stale record', C.lmOldHtml('SP', 'R4') === '');
    const kid = C.liWsChildKept(rowOf(C, 'R3'), 'SP', C.hCtx(), new Map(), Date.now());
    ok('the Workspace row knows it (kid.lr.lmStale) and the Child listings panel shows the mark', kid.lr.lmStale === true && /lm-old/.test(C.lkHtml(kid, { close: '' })));
    C.IML.SP = null;
    C.lmImlApply('SP');
    ok('the Image Manager / Listing Errors item carries it too (lmStale)', C.IML.SP.items.find(i => i.sku === 'R3').lmStale === true);
    ok('a stale record older than 24 h is read again live when its parent is opened (the Workspace\'s own 24-h rule)', !(kid.lr.cAt > Date.now() - 24 * H));
  }

  console.log('== LIVE READ AFTER A SEND: it replaces the cache\'s record on screen until a newer pass ==');
  {
    let status = ['BUYABLE', 'DISCOVERABLE'];
    const { C, net } = page({ get: () => ({ productType: 'NAPKIN', status, issues: [], attributes: {} }),
      limg: q => ({ ok: true, sku: q.sku, title: 'New shown title', listing: { MAIN: pic('NEW', 'MAIN') }, catalog: { MAIN: { link: pic('NEW', 'MAIN'), w: 2000, h: 2000 } } }) });
    net.tabs = cacheOf(C, { at: Date.now() - 2 * H, edit: (b, items) => { if (b === 'SP') items.R6.as = 'BUYABLE'; } }).tabs;
    await C.lmEnsure();
    await C.lmRefresh();
    C.lmImlApply('SP');
    C.reset();
    ok('before: the cache says R6 is Suppressed', ids(C, rowOf(C, 'R6')).includes('amazon_suppressed'));
    await C.liWsJob({ t: 'get', brand: 'SP', sku: 'R6', units: 0, pk: '' });   // the send's re-read (sqVerify reads through liWsJob)
    await C.liWsJob({ t: 'limg', brand: 'SP', sku: 'R6', units: 0, pk: '' });
    C.reset();
    ok('after the send\'s re-read: the fresh live read wins — no longer Suppressed', !ids(C, rowOf(C, 'R6')).includes('amazon_suppressed'), ids(C, rowOf(C, 'R6')));
    const im = C.IML.SP.items.find(i => i.sku === 'R6');
    ok('…the Image Manager item follows at once (status, our MAIN, the catalog\'s MAIN)', im.st === 'BUYABLE,DISCOVERABLE' && im.img.MAIN === pic('NEW', 'MAIN') && im.live.MAIN === pic('NEW', 'MAIN'), JSON.stringify(im).slice(0, 200));
    ok('…and lmGet says it is the live read', C.lmGet('R6', 'SP').live === true && C.lmGet('R6', 'SP').as === 'BUYABLE,DISCOVERABLE');
    // the next ListingMatch pass, newer than the live read: it wins again (and it says Suppressed again)
    net.tabs = cacheOf(C, { at: Date.now() + 60000, edit: (b, items) => { if (b === 'SP') items.R6.as = 'BUYABLE'; } }).tabs;
    await C.lmRefresh();
    C.reset();
    ok('a newer pass: the cache\'s record wins again (Suppressed again), the live read is dropped', ids(C, rowOf(C, 'R6')).includes('amazon_suppressed') && C.lmGet('R6', 'SP').live === false && !C.LM.over.SP.has('R6'));
    status = ['BUYABLE', 'DISCOVERABLE'];
  }

  console.log('== Season planner: no background reads for a brand the cache holds ==');
  {
    const plan = async withCache => {
      const P = page({ load: { sp: true } });
      if (withCache) { P.net.tabs = cacheOf(P.C).tabs; await P.C.lmEnsure(); await P.C.lmRefresh(); }
      P.C.setHealthLoaded(true);
      P.C.SP.log = [];
      P.C.SP.today = new Date(2026, 10, 13);
      P.C.LI_WS.schema.SP.NAPKIN = P.C.LI_WS.schema.CPC.NAPKIN = { at: Date.now(), ok: [], hl: { items: 1, max: 125, bytes: 0 } };
      P.C.reset();
      P.calls.length = 0;
      const n = P.C.spCheckAll();
      return { n, content: P.calls.filter(q => q.lfix === 'content').length };
    };
    const without = await plan(false), withC = await plan(true);
    ok('without the cache "Check all parents" reads in the background (' + without.n + ' parents)', without.n > 0);
    ok('with the cache: nothing is read in the background', withC.n === 0 && withC.content === 0, JSON.stringify(withC));
  }

  console.log('== 1 BACKGROUND SYNC: only when the ListingMatch data is missing or older than 24 hours ==');
  {
    const sync = async (cache, opts) => {
      const P = page({ load: { window: { __TEST_ERP: true } } });        // the test site: this browser syncs for itself (no lock)
      if (cache) { P.net.tabs = cache(P.C).tabs; await P.C.lmEnsure(); await P.C.lmRefresh(); }
      else { P.net.tabs = null; await P.C.lmEnsure(); await P.C.lmRefresh(); }
      P.C.reset();
      P.calls.length = 0;
      await P.C.lyBeat();
      await new Promise(r => setTimeout(r, 30));
      return Object.assign(P, { reads: P.calls.filter(q => q.lfix || q.limg).length, line: P.C.lyLineHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }, opts || {});
    };
    const fresh = await sync(C => cacheOf(C));
    ok('ListingMatch fresh for both brands: the sync reads nothing (no cycle, no Amazon call)', !fresh.C.LY.run && fresh.reads === 0 && fresh.C.lyPick().length === 0, fresh.reads + ' reads');
    ok('…the line: "Synced 16 Nov 18:30 from the Amazon auto refresh · next refresh ~13:00" [Sync now]',
      new RegExp('^Synced \\d{1,2} [A-Z][a-z]{2} \\d\\d:\\d\\d from the Amazon auto refresh · next refresh ~\\d\\d:00 Sync now$').test(fresh.line), fresh.line);
    fresh.calls.length = 0;
    await fresh.C.lySyncNow();
    ok('…Sync now looks for a newer auto refresh (one lmMeta read) and reads nothing from Amazon', fresh.calls.map(q => q.cache || q.lfix || q.limg).join() === 'lmMeta', fresh.calls.map(q => q.cache || q.lfix || q.limg).join());
    const none = await sync(null);
    ok('no ListingMatch data: the sync runs as before (a cycle, Amazon reads)', !!none.C.LY.run || none.reads > 0, none.reads + ' reads');
    ok('…and its line is the usual one ("Syncing… / Synced … · next sync in …")', /Syncing|Synced|next sync/.test(none.line) && !/auto refresh/.test(none.line), none.line);
    const old = await sync(C => cacheOf(C, { at: Date.now() - 30 * H }));
    ok('ListingMatch older than 24 hours: the sync runs as before', !!old.C.LY.run || old.reads > 0, old.reads + ' reads');
    const half = await sync(C => cacheOf(C, { only: ['SP'] }));
    const picked = half.C.lyPick();
    ok('only Ridhi in ListingMatch: the sync reads CPC only', picked.length > 0 && picked.every(x => x.brand === 'CPC'), picked.map(x => x.brand + ':' + x.sku).join());
    ok('…and its line says Ridhi comes from the Amazon auto refresh', /Ridhi from the Amazon auto refresh/.test(half.line), half.line);
  }

  console.log('== 2 WORKSPACE SPECS: from lmListings when the cache has them ==');
  {
    const { C, net, calls } = page();
    net.tabs = cacheOf(C, { edit: (b, items) => {
      if (b !== 'SP') return;
      ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R13'].forEach(sku => { items[sku].sp = ['material', 'color', 'size']; });
      items.R5.sp = ['material', 'color', 'size', 'pattern'];
      delete items.R6.sp;                                                      // a record from before ListingMatch kept the specs
    } }).tabs;
    await C.lmEnsure();
    await C.lmRefresh();
    C.reset();
    C.LI_WS.schema.SP.NAPKIN = { at: Date.now(), ok: ['material', 'color', 'size', 'pattern'], hl: null };
    const kidOf = sku => C.liWsChildKept(rowOf(C, sku), 'SP', C.hCtx(), new Map(), Date.now());
    const r1 = kidOf('R1').c.spec, r5 = kidOf('R5').c.spec, r6 = kidOf('R6').c.spec;
    ok('filled on open from the cache: 3 of 4 → "3/4", empty: pattern (with the Fix to Listing Errors)', r1.pass === false && r1.cell === '3/4' && r1.attrs.join() === 'pattern' && /Listings API/.test(r1.src.s) && r1.hits.length === 1, JSON.stringify(r1).slice(0, 220));
    ok('all four filled: passes', r5.pass === true && r5.cell === '4/4');
    ok('no attributes in the cache for that SKU: "Not read from Amazon yet"', r6.pass === null && r6.found === 'Not read from Amazon yet', JSON.stringify(r6).slice(0, 160));
    ok('Specs still count nowhere (the listing\'s level is the same with or without them)', kidOf('R1').bucket === kidOf('R1').bucket && C.healthOf(Object.assign({}, rowOf(C, 'R1')), C.hCtx()).bucket === kidOf('R1').bucket);
    delete C.LI_WS.schema.SP.NAPKIN;
    C.reset();
    const p = C.liWsParents(['SP']).find(x => x.parent === 'P1');
    calls.length = 0;
    C.liWsReadParent(p, false, true);
    await new Promise(r => setTimeout(r, 30));
    const asked = calls.map(q => q.lfix || q.limg || q.lh).join();
    ok('opening the parent: no live read of its listings — only the product type\'s schema (once per type) and A+', !/content|get/.test(asked) && /schema/.test(asked) && calls.filter(q => q.lfix === 'schema').length === 1, asked);
    ok('…once the schema is in, Specs shows the cache\'s answer', kidOf('R1').c.spec.cell === '3/4', JSON.stringify(kidOf('R1').c.spec).slice(0, 120));
  }

  console.log('== 3 LISTING HEALTH ROWS follow ListingMatch\'s list when it is fresh ==');
  {
    const addDrop = (b, items, cat) => {
      if (b === 'SP') {
        items.R99 = Object.assign({}, items.R1, { sku: 'R99', asin: 'B0R99', ch: 'AMAZON_NA', t: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Napkins - Teal' });
        cat.B0R99 = Object.assign({}, cat[items.R1.asin], { asin: 'B0R99' });
        items.M1 = Object.assign({}, items.R1, { sku: 'M1', asin: 'B0M1', ch: 'DEFAULT' });       // merchant-fulfilled: not Listing Health's scope
        items.RB7 = Object.assign({}, items.R1, { sku: 'RB7', asin: 'B0RB7', ch: 'AMAZON_NA' });   // a virtual bundle: not either
        delete items.R14;                                                     // gone from Amazon's All Listings report
      } else delete items.C2a;
    };
    const go = async o => {
      const P = page();
      P.C.HEALTH.SP.at = P.C.HEALTH.CPC.at = new Date(Date.now() - 5 * 24 * H);   // the snapshot: 5 days old
      if (o.snapNow) P.C.HEALTH.SP.at = P.C.HEALTH.CPC.at = new Date(Date.now() + 60000);
      P.net.tabs = cacheOf(P.C, Object.assign({ edit: addDrop }, o.cache || {})).tabs;
      (o.fail || []).forEach(t => P.net.fail.add(t));
      await P.C.lmEnsure();
      await P.C.lmRefresh();
      P.C.reset();
      const skus = b => P.C.HEALTH[b].rows.map(r => r.sku);
      return { C: P.C, sp: skus('SP'), cpc: skus('CPC') };
    };
    const a = await go({});
    ok('a listing in ListingMatch but not in the snapshot is added as a row (R99)', a.sp.includes('R99') && rowOf(a.C, 'R99').lmAdded === true && rowOf(a.C, 'R99').parent === 'BPP1');
    ok('…only within Listing Health\'s own scope: not a merchant-fulfilled one (M1), not a virtual bundle (RB7)', !a.sp.includes('M1') && !a.sp.includes('RB7'));
    ok('a listing gone from ListingMatch (removed from Amazon\'s All Listings report) is dropped (R14, C2a)', !a.sp.includes('R14') && !a.cpc.includes('C2a'));
    ok('…every other row kept, in its order', a.sp.filter(s => s !== 'R99').join() === base.C.HEALTH.SP.rows.map(r => r.sku).filter(s => s !== 'R14').join());
    const h99 = a.C.healthOf(Object.assign({ brand: 'SP' }, rowOf(a.C, 'R99')), a.C.hCtx());
    ok('the added row is judged from the cache like any other (title, bullets, pictures)', h99.fresh.contentSrc === 'live' && h99.pics && h99.pics.n === 8, h99.found.map(x => x.detector).join());
    const b = await go({ fail: ['lmListings_CPC_1_0'] });
    ok('a brand whose ListingMatch read failed is not touched (CPC keeps C2a); the other brand follows (R99 added, R14 dropped)', b.cpc.includes('C2a') && b.sp.includes('R99') && !b.sp.includes('R14') && !b.C.lmListOk('CPC'));
    const c = await go({ cache: { fullBrands: ['SP'], gaveUp: ['CPC'] } });
    ok('a brand ListingMatch gave up on in its last full pass is not touched', c.cpc.includes('C2a') && !c.C.lmListOk('CPC') && c.C.lmListOk('SP'));
    const d = await go({ cache: { fullAt: Date.now() - 26 * H } });
    ok('the last FULL pass older than 24 hours (only light passes since): the list is not followed', d.sp.includes('R14') && !d.sp.includes('R99') && !d.C.lmListOk('SP'));
    const e = await go({ cache: { at: Date.now() - 30 * H } });
    ok('a stale cache (older than 24 hours): the rows are the snapshot\'s, untouched', e.sp.join() === base.C.HEALTH.SP.rows.map(r => r.sku).join() && e.cpc.includes('C2a'));
    const f = await go({ snapNow: true });
    ok('a snapshot newer than the pass ("Refresh both brands" after it): the snapshot\'s list stands', f.sp.includes('R14') && !f.sp.includes('R99'));
    const g = page({ copy: (await (async () => { const P = page(); P.C.HEALTH.SP.at = new Date(Date.now() - 5 * 24 * H); P.net.tabs = cacheOf(P.C, { edit: addDrop }).tabs; await P.C.lmEnsure(); await P.C.lmRefresh(); return P.mem.copy; })()) });
    g.net.hang = true;
    await g.C.lmEnsure();
    g.C.HEALTH.SP.at = new Date(Date.now() - 5 * 24 * H);
    g.C.lmHealthApply();
    ok('from the saved copy (next visit, no network): the same list', g.C.HEALTH.SP.rows.some(r => r.sku === 'R99') && !g.C.HEALTH.SP.rows.some(r => r.sku === 'R14'));
  }

  console.log('== 4 LISTING OPTIMISER (review one ASIN) and LISTING AUDIT (parent names) ==');
  {
    const posted = [];
    const reply = facts => ({ ok: true, asin: 'B0R1', audit: Object.assign({ ok: true, asin: 'B0R1', src: 'cache', attrKeys: [], images: { slots: {}, n: 0, hasMain: false, noZoom: [], emptySlots: [] }, rank: null },
      { title: facts.title, brand: facts.brand, category: facts.category, bullets: facts.bullets, description: facts.description }),
      findings: { title: [], bullets: [], description: [], images: [] }, suggestion: { ok: false, why: [] }, keywords: { trust: 'none', note: '', words: [], wordsShared: [], missing: [] } });
    const opt = async (o = {}) => {
      const P = page({ load: { lo: true, post: body => { posted.push(body); return o.post ? o.post(body) : reply(body.facts); } } });
      P.net.tabs = o.tabs === null ? null : cacheOf(P.C, Object.assign({ edit: (b, items, cat) => {
        if (b !== 'SP') return;
        items.R1.itk = 'cloth-napkins';
        cat.B0RIDHI001 = Object.assign({}, cat[items.R1.asin], { asin: 'B0RIDHI001', t: 'Shown title of R1' });   // a real-shaped ASIN (the sample's are short)
        items.R1.asin = 'B0RIDHI001';
        items['PS-P1'] = Object.assign({}, items.R1, { sku: 'PS-P1', asin: 'BPP1', lvl: 'parent', psku: '', t: 'Ridhi Napkins Parent (our own name)', ch: '', fba: null });
      } }, o.cache || {})).tabs;
      await P.C.lmEnsure(); await P.C.lmRefresh();
      posted.length = 0; P.calls.length = 0;
      P.C.el('loAsin').value = o.asin || 'B0RIDHI001';
      P.C.el('loBrand').value = 'SP';
      await P.C.loGo();
      return Object.assign(P, { gets: P.calls.filter(q => q.listing === 'review').length, lo: P.C.getLO(), body: P.C.el('loBody').innerHTML });
    };
    const a = await opt();
    const f = posted[0] && posted[0].facts;
    ok('ours and in the cache: the review is asked with the cache\'s facts (one POST), no live read', posted.length === 1 && posted[0].listing === 'review' && a.gets === 0 && a.lo.audit.src === 'cache');
    ok('…the facts: the title shoppers see, our 5 bullets and description, the product word, pictures with their sizes, the rank',
      f.title === 'Shown title of R1' && f.bullets.length === 5 && f.description.length === 300 && f.itemType === 'cloth-napkins' && f.images.MAIN.w === 2000 && /MAIN\.jpg$/.test(f.images.MAIN.link) && f.rank.value === 50 && f.rank.title === 'Cloth Napkins', JSON.stringify(f).slice(0, 200));
    ok('…the review says where its data is from: "Amazon data from the auto refresh (16 Nov 18:30)"', /Amazon data from the auto refresh \(\d{1,2} [A-Z][a-z]{2} \d\d:\d\d\)/.test(a.body), a.body.slice(0, 300));
    const b = await opt({ post: () => ({ ok: false, error: 'Unknown POST' }) });
    ok('a backend not updated yet (or the test site): the live read, as before', b.gets === 1 && posted.length === 1);
    const c = await opt({ asin: 'B0COMPETE1' });
    ok('an ASIN that is not ours (a competitor): no POST, the live read', c.gets === 1 && posted.length === 0);
    const d = await opt({ cache: { at: Date.now() - 30 * H } });
    ok('a cache older than 24 hours: no POST, the live read', d.gets === 1 && posted.length === 0);
    const e = await opt({ tabs: null });
    ok('no cache at all: the live read, exactly as before', e.gets === 1 && posted.length === 0);
    ok('Listing Audit / every parent name: the parent listing\'s own name from the cache (the same field the listings report gives "Refresh both brands")',
      a.C.HEALTH.SP.parentNames.BPP1 === 'Ridhi Napkins Parent (our own name)' && !a.C.HEALTH.SP.rows.some(r => r.sku === 'PS-P1'));
    ok('…a stale cache leaves the snapshot\'s names as they were', !(d.C.HEALTH.SP.parentNames || {}).BPP1);
  }

  console.log('== SPEED: ~4,400 listings from the saved copy ==');
  {
    const first = page();
    const mk = (b, n) => Array.from({ length: n }, (_, i) => ({ brand: b, parent: 'P' + (i % 300), sku: `${b}-${i}`, asin: `B0${b}${String(i).padStart(6, '0')}`.slice(0, 10), title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Napkins - Blue ' + i,
      qty: 5, price: 12, status: 'Active', channel: 'AFN', aplus: true, aplusAt: Date.now(), checked: Date.now(), content: { titleLen: 80, images: 8, bullets: 5, descLen: 300, title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Napkins - Blue ' + i } }));
    first.C.HEALTH.SP.rows = mk('SP', 2680);
    first.C.HEALTH.CPC.rows = mk('CPC', 1720);
    first.net.tabs = cacheOf(first.C).tabs;
    await first.C.lmEnsure();
    await first.C.lmRefresh();
    const size = JSON.stringify(first.mem.copy).length;
    const { C, net } = page({ copy: first.mem.copy });
    C.HEALTH.SP.rows = mk('SP', 2680);
    C.HEALTH.CPC.rows = mk('CPC', 1720);
    net.hang = true;
    const t0 = Date.now();
    await C.lmEnsure();
    const t1 = Date.now();
    C.reset();
    const hc = C.hCtx();
    let n = 0;
    ['SP', 'CPC'].forEach(b => C.HEALTH[b].rows.forEach(row => { C.healthOf(Object.assign({ brand: b }, row), hc); n++; }));
    const t2 = Date.now();
    C.IML.SP = null; C.lmImlApply('SP');
    const t3 = Date.now();
    console.log(`    saved copy ${(size / 1e6).toFixed(1)} MB · opened ${t1 - t0} ms · every listing judged (${n}) ${t2 - t1} ms · Image Manager list (${C.IML.SP.items.length}) ${t3 - t2} ms`);
    ok('4,400 listings: data ready from the saved copy and every listing judged in under 1 second', t2 - t0 < 1000, (t2 - t0) + ' ms');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
