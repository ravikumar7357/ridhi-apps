/* The shared SAVED COPY of the live reads (src/app/listing/listing-saved.js) with the Season planner and the Workspace, over the real
 * files in a stub page.
 *   node tests/saved-copy-test.js
 * Saved in /history/lcache_<brand>_<0..9> (the existing collection every listing user may write — no rule change); the planner opens
 * INSTANTLY from it (no Amazon call); a landed read is written to it; only children older than 24 h are read again, oldest first, 2 at
 * a time, never while a parent panel is open, failures tried again after an hour; an ACCEPTED send updates it without a second read;
 * "checked N h ago · Read again"; the test site uses the browser copy only; the size per 1,000 SKUs. */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const NOV = new Date(2026, 10, 13);
const H = 3600000;
const TITLE = c => `Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print - ${c}`;
const wait = ms => new Promise(r => setTimeout(r, ms));

// A stub page: Firestore in memory (getDoc / setDoc merge), Amazon (baCall content / get, the send) counted call by call.
function setup(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.store || {});          // "history/lcache_SP_3" → data
  const gets = [];
  const calls = [];
  const amazon = {};                                           // sku → attributes as Amazon holds them (after a send)
  const merge = (a, b) => { Object.keys(b).forEach(k => { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') merge(a[k], b[k]); else a[k] = b[k]; }); return a; };
  const baCall = async q => {
    calls.push(q);
    await wait(2);
    if (q.lfix === 'content') {
      if (opts.failContent) throw new Error('Amazon did not answer');
      return { items: Object.fromEntries(q.skus.split(',').map(sku => [sku, { productType: 'NAPKIN', item_name: [{ value: TITLE('Blue') }], generic_keyword: [{ value: (amazon[sku] && amazon[sku].kw) || 'cotton napkins' }], bullet_point: [{ value: 'a' }, { value: 'b' }, { value: 'c' }, { value: 'd' }, { value: 'e' }], product_description: [{ value: 'x'.repeat(300) }] }])) };
    }
    if (q.lfix === 'get') return { productType: 'NAPKIN', attributes: (amazon[q.sku] && amazon[q.sku].attrs) || {}, issues: [] };
    return {};
  };
  const post = body => {
    if (body.apply) amazon[body.sku] = { attrs: Object.fromEntries((body.patches || []).map(p => [p.path.replace('/attributes/', ''), p.value])) };
    return body.apply ? { ok: true, status: 'ACCEPTED', submissionId: 's-' + body.sku } : { ok: true, previewOnly: true, issues: [] };
  };
  const C = load({ ws: true, sp: true, window: opts.window, post, baCall,
    getDoc: async ref => { gets.push(ref.path); const d = store[ref.path]; return { exists: () => !!d, data: () => JSON.parse(JSON.stringify(d)) }; },
    setDoc: async (ref, data, o) => { const k = ref.path; const copy = JSON.parse(JSON.stringify(data)); store[k] = o && o.merge && store[k] ? merge(store[k], copy) : copy; } });
  C.setHealthLoaded(true);
  C.SP.log = [];
  C.SP.today = NOV;
  C.LI_WS.schema.SP.NAPKIN = { at: Date.now(), ok: [], hl: { items: 1, max: 125, bytes: 0 } };
  ['SP', 'CPC'].forEach(b => C.HEALTH[b].rows.splice(0));
  const cat = {};
  const put = (sku, parent) => {
    const title = TITLE('Blue');
    C.HEALTH.SP.rows.push({ brand: 'SP', parent, sku, asin: 'B0' + sku, title, qty: 5, price: 12, status: 'Active', channel: 'AFN', aplus: true, aplusAt: Date.now(), checked: Date.now(), content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } });
    cat[sku] = { color: 'Blue', size: '18x18', subcat: 'Napkin Set' };
  };
  const done = () => { C.setCat('SP', cat); C.LI_WS.liveV++; C.reset(); C.SP.itemsKey = ''; };
  return { C, store, gets, calls, put, done, amazon };
}
// one saved record, as listing-saved.js writes it
const rec = (ageH, kw, hl) => ({ c: Date.now() - ageH * H, t: TITLE('Blue'), tl: TITLE('Blue').length, kw, kb: kw.replace(/[\s;,.]/g, '').length, pt: 'NAPKIN', bul: 5, desc: 300, w: { emb: false, bp: true, hb: false }, br: 'Ridhi', h: Date.now() - ageH * H, hl });
// the saved documents for these records (each SKU in its own shard, as the real code places it)
function savedStore(C, records) {
  const store = {};
  Object.entries(records).forEach(([sku, r]) => {
    const id = 'history/' + C.svDocId('SP', sku);
    store[id] = store[id] || { kind: 'lcache', brand: 'SP', items: {} };
    store[id].items[sku] = r;
  });
  return store;
}

(async () => {
  console.log('== where it is saved: /history/lcache_<brand>_<0..9>, no rule change ==');
  {
    const fs = require('fs');
    const rules = fs.readFileSync(require('path').join(__dirname, '..', 'firestore.rules'), 'utf8');
    ok('firestore.rules already lets every listing user (canAny) read and write /history — nothing to add', /match \/history\/\{doc\} \{\s*allow read, write: if canAny\(\);/.test(rules));
    const { C } = setup();
    const ids = new Set(Array.from({ length: 500 }, (_, i) => C.svDocId('SP', 'SKU-' + i)));
    ok('a SKU always lands in the same one of 10 documents per brand: history/lcache_SP_0 … lcache_SP_9', ids.size === 10 && [...ids].every(id => /^lcache_SP_[0-9]$/.test(id)) && C.svDocId('SP', 'ABC') === C.svDocId('SP', 'ABC'));
  }

  console.log('== open: instant from the saved copy — no call to Amazon ==');
  {
    const probe = setup();
    const records = {};
    for (let i = 0; i < 12; i++) records['S' + i] = rec(3, i < 8 ? 'cotton napkins thanksgiving' : 'cotton napkins thanksgiving christmas', ['Thanksgiving and Christmas table decor']);
    const { C, calls, gets, put, done } = setup({ store: savedStore(probe.C, records) });
    for (let i = 0; i < 12; i++) put('S' + i, 'PS');
    done();
    C.SP.brand = 'SP';
    const t0 = Date.now();
    await C.spOn();
    const page = strip(C.el('spPane').innerHTML);
    ok('the planner opens with the saved copy: "🎄 Christmas missing · 8" and "Ready 8" straight away', /Parent PS 12 listings · 🎄 Christmas missing · 8/.test(page) && /Ready 8 · Needs your OK 0 · Fix by hand 0/.test(page), page.slice(0, 500));
    ok('…without one call to Amazon (every child was read 3 h ago — fresh)', !calls.some(q => q.lfix === 'content') && C.SV.state === 'ready' && C.SV.n === 12, JSON.stringify(calls.map(q => q.lfix)));
    ok(`…in ${Date.now() - t0} ms: the 20 saved documents were read at the same time`, gets.filter(p => /^history\/lcache_(SP|CPC)_\d$/.test(p)).length === 20);
    ok('the parent card: "checked 3 h ago · Read again"', /checked 3 h ago · Read again/.test(page), page.slice(0, 600));
    C.spOpenParent('SP|PS');
    ok('…and the parent panel and the child panel say it too', /checked 3 h ago · Read again/.test(strip(C.el('spPanel').innerHTML)) && /checked 3 h ago/.test(strip(C.spKidHtml(C.spCompute().find(i => i.sku === 'S0'), C.spGroupOf('SP|PS')))));
    // Read again: that parent from Amazon now, even though it is fresh
    C.spCloseParent(false);
    C.spReadAgain('SP|PS');
    const content = calls.filter(q => q.lfix === 'content');
    ok('Read again: the parent is read from Amazon now (titles and search words, 12 SKUs in one call), not in the background', content.length === 1 && content[0].skus.split(',').length === 12
      && /Reading from Amazon…/.test(C.spCheckedHtml(C.spGroupOf('SP|PS'))));
    for (let i = 0; i < 300 && (C.LI_WS.inflight || C.LI_WS.q.length); i++) await wait(3);
    await C.svFlush();
    ok('…and what it read is written to the saved copy', C.SV.writes > 0);
  }

  console.log('== a read lands → saved for every user (and a newer read in this browser always wins) ==');
  {
    const { C, store, put, done } = setup();
    put('R1', 'PR');
    done();
    C.LI_WS.q.push({ t: 'content', brand: 'SP', skus: ['R1'], units: 1, pk: '' });
    C.liWsPump();
    for (let i = 0; i < 100 && C.LI_WS.inflight; i++) await wait(3);
    await C.svFlush();
    const d = store['history/' + C.svDocId('SP', 'R1')];
    const r = d && d.items && d.items.R1;
    ok('the content read is saved: title, search words and their count, product type, bullets, description, rule words, when', !!r && r.t === TITLE('Blue') && r.kw === 'cotton napkins' && r.kb === 13 && r.pt === 'NAPKIN' && r.bul === 5 && r.desc === 300 && r.w.bp === true && r.c > 0,
      JSON.stringify(r));
    ok('the document: kind "lcache", NO "day" field (Listing History never lists it), only this SKU touched (merge)', d.kind === 'lcache' && !('day' in d) && Object.keys(d.items).join() === 'R1');
    // Item Highlights come with ?lfix=get
    C.LI_WS.q.push({ t: 'get', brand: 'SP', sku: 'R1', units: 1, pk: '' });
    C.liWsPump();
    for (let i = 0; i < 100 && C.LI_WS.inflight; i++) await wait(3);
    await C.svFlush();
    ok('Item Highlights (?lfix=get) are saved with their own time; the content part stays', Array.isArray(store['history/' + C.svDocId('SP', 'R1')].items.R1.hl) && store['history/' + C.svDocId('SP', 'R1')].items.R1.h > 0 && store['history/' + C.svDocId('SP', 'R1')].items.R1.kw === 'cotton napkins');
    const entry = C.LI_WS.live.SP.R1;
    ok('an OLDER saved record never replaces a newer read in this browser', C.svMerge('SP', 'R1', rec(30, 'old words', ['old'])) === false && entry.kw === 'cotton napkins');
    ok('…a NEWER one does', C.svMerge('SP', 'R1', Object.assign(rec(0, 'newer words', ['newer']), { c: Date.now() + 1000, h: Date.now() + 1000 })) === true && entry.kw === 'newer words' && entry.hl[0] === 'newer');
  }

  console.log('== background refresh: only children older than 24 h, oldest first; failures tried again later ==');
  {
    const probe = setup();
    const records = { F1: rec(2, 'cotton thanksgiving christmas', ['Thanksgiving and Christmas table decor']), F2: rec(20, 'cotton thanksgiving christmas', ['Thanksgiving and Christmas table decor']),
      O1: rec(30, 'cotton', ['Soft cotton']), O2: rec(72, 'cotton', ['Soft cotton']), O3: rec(48, 'cotton', ['Soft cotton']) };
    const { C, calls, put, done } = setup({ store: savedStore(probe.C, records) });
    ['F1', 'F2', 'O1', 'O2', 'O3', 'N1'].forEach(sku => put(sku, 'PB'));
    done();
    await C.spOn();
    for (let i = 0; i < 300 && (C.LI_WS.inflight || C.LI_WS.q.length); i++) await wait(3);
    const content = calls.filter(q => q.lfix === 'content');
    const read = content.flatMap(q => q.skus.split(','));
    ok('only the children older than 24 h (and the one never read) are read again — F1 (2 h) and F2 (20 h) are not', read.sort().join() === 'N1,O1,O2,O3', JSON.stringify(content.map(q => q.skus)));
    ok('oldest first: never read, then 72 h, 48 h, 30 h', content[0].skus === 'N1,O2,O3,O1', content[0].skus);
    // a failed read is skipped, and tried again an hour later
    const f = setup({ failContent: true, store: savedStore(probe.C, { X1: rec(30, 'cotton', ['Soft cotton']) }) });
    f.put('X1', 'PX');
    f.done();
    await f.C.spOn();
    for (let i = 0; i < 300 && (f.C.LI_WS.inflight || f.C.LI_WS.q.length); i++) await wait(3);
    const tries = () => f.calls.filter(q => q.lfix === 'content').length;
    const first = tries();
    f.C.SP.check.at = 0; f.C.SP.itemsKey = '';
    f.C.spCheckAll();
    const skipped = tries() === first;
    f.C.LI_WS.live.SP.X1.cErrAt = Date.now() - 2 * H; f.C.LI_WS.liveV++;
    f.C.SP.check.at = 0; f.C.SP.itemsKey = '';
    f.C.spCheckAll();
    for (let i = 0; i < 300 && (f.C.LI_WS.inflight || f.C.LI_WS.q.length); i++) await wait(3);
    ok('a failed read is skipped (the screen keeps the saved copy: "checked 1 d ago") and tried again after an hour', first === 1 && skipped && tries() === 2
      && /checked 1 d ago/.test(f.C.spCheckedHtml(f.C.spGroupOf('SP|PX'))), `${first} / ${skipped} / ${tries()}`);
  }

  console.log('== an ACCEPTED send updates the saved copy at once — no second read ==');
  {
    const probe = setup();
    const { C, store, calls, put, done } = setup({ store: savedStore(probe.C, { A1: rec(3, 'cotton napkins', ['Soft cotton']) }) });
    put('A1', 'PA');
    done();
    await C.spOn();
    const before = calls.length;
    const r = C.spApprove(['SP|A1']);
    await C.SQ.run.checked;
    await C.sqApprove();
    C.sqClose();
    await r.run;
    await C.svFlush();
    const after = calls.slice(before);
    const saved = store['history/' + C.svDocId('SP', 'A1')].items.A1;
    ok('Amazon accepted: the popup read the listing once to check (?lfix=get) — and NO content read after it', C.SQ.run.jobs[0].state === 'accepted' && after.filter(q => q.lfix === 'get').length === 1 && !after.some(q => q.lfix === 'content'),
      JSON.stringify(after.map(q => q.lfix)));
    ok('the saved copy holds the new search words and Item Highlights at once', saved.kw === 'cotton napkins thanksgiving christmas' && saved.hl[0] === 'Thanksgiving and Christmas table decor, soft cotton' && Date.now() - saved.c < 60000,
      JSON.stringify([saved.kw, saved.hl]));
    C.SP.itemsKey = '';
    ok('…and the planner shows the child up to date straight away', C.spBucket(C.spCompute().find(i => i.sku === 'A1')) === 'ok');
  }

  console.log('== the test site: saving off — the browser copy only ==');
  {
    const { C, store, gets, put, done } = setup({ window: { __TEST_ERP: true } });
    put('T1', 'PT');
    done();
    await C.svLoad();
    C.LI_WS.q.push({ t: 'content', brand: 'SP', skus: ['T1'], units: 1, pk: '' });
    C.liWsPump();
    for (let i = 0; i < 100 && C.LI_WS.inflight; i++) await wait(3);
    await C.svFlush();
    ok('nothing read from or written to the database; the read is kept in this browser (24 h) as before', C.SV.state === 'off' && !gets.some(p => /lcache/.test(p)) && !Object.keys(store).some(k => /lcache/.test(k)) && C.LI_WS.live.SP.T1.cAt > 0);
  }

  console.log('== size ==');
  {
    const { C } = setup();
    // a realistic record: a 70–110 letter title, ~200 letters of search words, one Item Highlights text of ~100
    const items = {};
    for (let i = 0; i < 1000; i++) items['RH-NPK-' + (10000 + i) + '-BLU'] = rec(3, 'cotton cloth napkins dinner table linen reusable washable soft handmade block print floral farmhouse wedding party thanksgiving christmas holiday kitchen dining buffet restaurant', ['Thanksgiving and Christmas table decor, soft hand block printed cotton, machine washable']);
    const bytes = JSON.stringify(items).length;
    const perDoc = Math.round(bytes / 10);
    ok(`1,000 SKUs ≈ ${(bytes / 1048576).toFixed(2)} MB (${Math.round(bytes / 1000)} bytes a SKU) — ${(perDoc / 1024).toFixed(0)} KB in each of the 10 documents; 10,000 SKUs a brand stay under Firestore's 1 MB a document`,
      bytes < 700000 && perDoc * 10 < 1000000, String(bytes));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
