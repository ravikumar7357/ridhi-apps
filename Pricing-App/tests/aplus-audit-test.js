/* A+ Content (roadmap #5, 18 Nov 2026): src/app/listing/aplus-audit.js over the real listing-match.js and family-check.js in a stub page.
 *   node tests/aplus-audit-test.js
 * Mock data in the shapes the backend writes (lmMeta.aplus + lmAplus_<brand>, Pricing-API/ListingMatch.gs): every status, Missing with
 * and without a sibling's live document, Not checked (no read / a document without its list / a publish record that disagrees), an old
 * (stale) read, Stuck (> 7 days), a forgotten draft (30+ days), an unused document, a family gap, a document on the parent ASIN, the
 * "Stock > 0 only" toggle, "No A+ needed" + Undo (one, many, a family), both views, and SCREEN = DOWNLOAD. Also: the screen makes no
 * Amazon call by itself (Preview A+ and the accuracy report only on a click), and Listing Health's A+ answer comes from the same data. */
const fs = require('fs'), path = require('path');
const L = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', f), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 700) : '')); } };
const H = 3600000, DAY = 24 * H;
const IST = ms => new Date(ms + 5.5 * H).toISOString().slice(0, 16).replace('T', ' ');
const A = sku => 'B0' + sku.replace(/[^A-Z0-9]/gi, '').toUpperCase().padEnd(8, 'X').slice(0, 8);
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/* ---- the sample: 6 families + one product with no family ---- */
function sample(o) {
  o = o || {};
  const now = Date.now();
  const kid = (brand, sku, psku, qty) => ({ brand, sku, psku, asin: A(sku), qty: qty == null ? 5 : qty });
  const kids = [
    kid('SP', 'TC-1', 'TC-P'), kid('SP', 'TC-2', 'TC-P'), kid('SP', 'TC-3', 'TC-P'), kid('SP', 'TC-4', 'TC-P'), kid('SP', 'TC-5', 'TC-P', 0), kid('SP', 'TC-6', 'TC-P'),
    kid('SP', 'NP-1', 'NP-P'), kid('SP', 'NP-2', 'NP-P'),
    kid('SP', 'RN-1', 'RN-P'), kid('SP', 'RN-2', 'RN-P'),
    kid('SP', 'PM-1', 'PM-P'), kid('SP', 'PM-2', 'PM-P'),
    kid('SP', 'CS-1', 'CS-P'), kid('SP', 'CS-2', 'CS-P'),
    kid('CPC', 'CD-1', 'CD-P'), kid('CPC', 'CD-2', 'CD-P'),
    kid('SP', 'LS-1', ''),
  ];
  const doc = (k, n, s, t, daysAgo, skus, rr) => ({ k, n, s, t, bd: t === 'Premium' ? ['PREMIUM'] : t === 'Basic' ? ['STANDARD'] : [], u: new Date(now - daysAgo * DAY).toISOString(), rr: rr || [], a: skus === null ? null : skus.map(x => (/^B0/.test(x) ? x : A(x))) });
  const docs = {
    SP: [doc('D-LIVE', 'Tablecloth A+', 'APPROVED', 'Premium', 20, ['TC-1', 'TC-2', 'TC-3']),
      doc('D-REJ', 'Tablecloth winter', 'REJECTED', 'Basic', 5, ['TC-6'], ['Image has a web link']),
      doc('D-DRAFT', 'Runner story', 'DRAFT', 'Basic', 45, ['RN-1']),
      doc('D-NEW', 'Runner new', 'DRAFT', 'Basic', 3, ['RN-2']),
      doc('D-WAIT', 'Placemats A+', 'SUBMITTED', 'Basic', 10, ['PM-1']),
      doc('D-WAIT2', 'Placemats two', 'SUBMITTED', 'Basic', 2, ['PM-2']),
      doc('D-PAR', 'Coasters (on the parent)', 'APPROVED', '', 60, [A('CS-P')]),
      doc('D-UNUSED', 'Old launch page', 'APPROVED', 'Basic', 300, ['B0NOTOURS1'])],
    CPC: [doc('C-LIVE', 'Desk set A+', 'APPROVED', 'Basic', 12, ['CD-1'])],
  };
  if (o.docs) o.docs(docs, doc);
  const sales = { [A('TC-1')]: [9, 1000], [A('TC-4')]: [4, 400], [A('TC-6')]: [7, 900], [A('NP-1')]: [1, 50], [A('NP-2')]: [2, 70], [A('RN-1')]: [3, 300], [A('RN-2')]: [1, 10], [A('CD-2')]: [2, 120], [A('LS-1')]: [1, 5], [A('TC-5')]: [1, 77] };
  return { kids, docs, sales, now };
}
// The cache tabs as ListingMatch.gs writes them: the listings, the catalog (with each child's parent), lmMeta.aplus and the A+ tabs.
function cacheOf(S, o) {
  o = o || {};
  const at = o.at || Date.now() - H, apAt = o.apAt || Date.now() - 2 * H;
  const tabs = {};
  const meta = { v: 2, kind: 'full', startedAt: IST(at - 20 * 60000), finishedAt: IST(at), upTo: IST(at), lastFull: { finishedAt: IST(at), brands: ['SP', 'CPC'], gaveUp: [] }, hash: 'h31', parts: { listings: {}, catalog: {} } };
  ['SP', 'CPC'].forEach(b => {
    const items = {}, cat = {};
    S.kids.filter(k => k.brand === b).forEach(k => {
      items[k.sku] = { sku: k.sku, asin: k.asin, b, as: 'BUYABLE,DISCOVERABLE', pt: 'HOME', t: 'Title of ' + k.sku, bl: [], d: '', hl: [], kw: '', lvl: k.psku ? 'child' : '', psku: k.psku, va: {}, img: {}, iss: [],
        readAt: at, rs: 'Active', price: 20, ch: 'AMAZON_NA', rAt: at - 30 * 60000, fba: k.qty, fyp: null, inSupReport: false, sup: null };
      cat[k.asin] = { asin: k.asin, t: 'Title of ' + k.sku, brand: '', img: { MAIN: { u: `https://m.media-amazon.com/images/I/${k.sku.replace(/\W/g, '')}.jpg`, w: 2000, h: 2000 } }, pa: k.psku ? [A(k.psku)] : [], kids: [], theme: '', tattrs: [],
        vals: {}, bc: 'Home & Kitchen › Tablecloths', rk: { main: null, sub: null }, aplus: null, readAt: at };
    });
    tabs[`lmListings_${b}_1_0`] = { b, items };
    tabs[`lmCatalog_${b}_1_0`] = { b, items: cat };
    meta.parts.listings[b] = [`lmListings_${b}_1_0`];
    meta.parts.catalog[b] = [`lmCatalog_${b}_1_0`];
  });
  if (!o.noAplus) {
    meta.aplus = {};
    ['SP', 'CPC'].forEach(b => {
      if (o.noAplusFor === b) return;
      const d = {};
      S.docs[b].forEach(x => { d[x.k] = x; });
      tabs['lmAplus_' + b] = { b, v: 1, at: IST(apAt), atMs: apAt, ok: true, calls: S.docs[b].length + 2, nDocs: S.docs[b].length, partial: S.docs[b].filter(x => x.a === null).length, docs: d };
      meta.aplus[b] = Object.assign({ tab: 'lmAplus_' + b, at: IST(apAt), atMs: apAt, calls: S.docs[b].length + 2, docs: S.docs[b].length, asins: 0, partial: 0, stale: 0, err: '' }, (o.aplusMeta || {})[b] || {});
    });
  }
  tabs.lmMeta = meta;
  return tabs;
}
function setup(opts) {
  opts = opts || {};
  const S = opts.S || sample(opts);
  const store = opts.store || {};
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [] });
  const IML = {}, HEALTH = {};
  ['SP', 'CPC'].forEach(b => {
    const mine = S.kids.filter(k => k.brand === b);
    const parents = [...new Set(mine.map(k => k.psku).filter(Boolean))];
    IML[b] = { at: new Date(), items: parents.map(p => ({ sku: p, asin: A(p), lvl: 'parent', st: 'DISCOVERABLE', pt: 'HOME', t: { 'TC-P': 'Floral Tablecloth', 'NP-P': 'Cotton Napkins', 'RN-P': 'Table Runner', 'PM-P': 'Placemats', 'CS-P': 'Coasters', 'CD-P': 'Desk Organizer Set' }[p] || p, img: {}, live: {}, iss: [] }))
      .concat(mine.map(k => ({ sku: k.sku, asin: k.asin, st: 'BUYABLE,DISCOVERABLE', pt: 'HOME', t: 'Title of ' + k.sku, lvl: k.psku ? 'child' : '', psku: k.psku, pa: k.psku ? A(k.psku) : '', c: '', z: '', img: {}, live: {}, iss: [] }))) };
    HEALTH[b] = { at: new Date(), rows: mine.map(k => Object.assign({ sku: k.sku, asin: k.asin, parent: k.psku ? A(k.psku) : '', title: 'Title of ' + k.sku, qty: k.qty, status: 'Active', channel: 'AMAZON_NA', price: 20 }, (opts.health || {})[k.sku] || {})) };
  });
  const calls = [], copied = [];
  const net = { tabs: opts.noCache ? null : cacheOf(S, opts.cache), doc: opts.docAnswer || null, pub: opts.pub || {} };
  const ctx = {
    $: el, document: { addEventListener() {}, querySelectorAll: () => [], createElement: () => ({ click() {} }), querySelector: () => null },
    window: { scrollTo() {}, scrollBy() {}, addEventListener() {}, __TEST_ERP: false },
    MutationObserver: class { observe() {} }, localStorage: { getItem: () => null, setItem() {} }, setTimeout: fn => { fn(); return 0; }, clearTimeout() {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: class { constructor(p) { this.p = p; } }, CSS: { escape: s => s }, console: { table() {}, log() {} },
    navigator: { clipboard: { writeText: async t => { copied.push(t); } } },
    BRAND_NAME: { SP: 'Ridhi', CPC: 'CPC' }, IML, HEALTH, LR_CAT: { SP: {}, CPC: {} }, H_LOADED: true, ME: { email: 'vishesh.g@example.com', tabs: ['health'] },
    SALES30: opts.noSales ? { asins: {}, at: '' } : { asins: S.sales, at: '2026-11-17 09:00' },
    WEEKLY: { rows: opts.weekly || {} }, LI_WS: { aplus: { SP: {}, CPC: {} }, liveV: 0 },
    parentName: (b, asin, fallback) => fallback,
    baCall: async q => {
      calls.push(q);
      if (q.cache) {
        const d = net.tabs && net.tabs[q.cache];
        if (!d) throw new Error(`nothing cached for "${q.cache}" yet`);
        return { ok: true, name: q.cache, data: JSON.parse(JSON.stringify(d)) };
      }
      if (q.lh === 'aplusdoc') { if (opts.docFail) throw new Error('Amazon answered 500'); return net.doc ? net.doc(q) : { ok: true, key: q.doc, name: 'Tablecloth A+', status: 'APPROVED', type: 'Premium', updated: '2026-10-29T10:00:00Z', reasons: [],
        modules: [{ type: 'STANDARD_HEADER_IMAGE_TEXT', texts: ['Made by hand', 'Printed in Jaipur'], imgs: [{ id: 'aplus-media/sc/abc.jpg', alt: 'A table' }] }], asins: [] }; }
      if (q.lh === 'aplusasin') { const map = {}; String(q.asins).split(',').forEach(a => { if (a in net.pub) map[a] = net.pub[a]; }); return { ok: true, map }; }
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
  const src = L('listing-match.js') + '\n' + L('family-check.js') + '\n' + L('aplus-audit.js')
    + '\n;return { APC, FC, apcBuild, apcGroups, apcDraw, apcOpen, apcClick, apcFilter, apcCsv, apcDocsCsv, apcDocs, apcShownRows, apcFixList, apcSummary, apcOkSetMany, apcOkUndo, apcPreview, apcWhat, apcRowView,'
    + ' aplusCounts, aplusAccuracyReport, APC_CSV_COLS, APC_DOC_COLS, APC_ST, LM, lmEnsure, lmRefresh, lmStoreUse, lmOk, lmGetAplus, lmAplusDocs, lmAplusState, lmAplusOf, lmAplusFresh, lmVersion, lmDataLabel };';
  const C = new Function(...Object.keys(ctx), src)(...Object.values(ctx));
  const saved = { copy: opts.savedCopy || null, puts: 0 };
  C.lmStoreUse({ get: async () => saved.copy, put: async c => { saved.copy = JSON.parse(JSON.stringify(c)); saved.puts++; return true; } });
  const body = () => els.apcBody.innerHTML;
  const click = d => C.apcClick({ dataset: d });
  return { C, S, els, el, calls, copied, store, net, saved, IML, HEALTH, ctx, body, click, text: () => strip(body()) };
}
// A page opened on A+ Content, the cache read.
async function open(opts) {
  const T = setup(opts);
  await T.C.lmEnsure();
  await T.C.lmRefresh();
  await T.C.apcOpen();
  await new Promise(r => setTimeout(r, 0));
  return T;
}
const rowOf = (T, sku) => T.C.apcBuild().rows.find(p => p.c.sku === sku);
// the product rows the screen draws, in order: [{ key, text }]
const screenRows = T => [...T.body().matchAll(/<tr class="fc-row apc-row[^"]*" data-apc-row="([^"]+)">([\s\S]*?)<\/tr>/g)].map(m => ({ key: m[1], text: strip(m[2]) }));
const openAll = T => { T.click({ apc: 'openall' }); T.C.APC.limit = 1e6; T.C.apcDraw(); };
const csvRows = text => text.replace(/^﻿/, '').trim().split('\r\n').map(line => { const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out; });

(async () => {
  console.log('== the statuses, from Amazon\'s A+ documents only ==');
  const T = await open();
  const C = T.C;
  const st = sku => { const p = rowOf(T, sku); return p ? p.bucket : '(not shown)'; };
  ok('Live: an approved document on the ASIN', st('TC-1') === 'live' && rowOf(T, 'TC-1').doc.n === 'Tablecloth A+' && rowOf(T, 'TC-1').what === 'Nothing to do — A+ is live');
  ok('Live through the parent: a document attached to the parent ASIN covers its children', st('CS-1') === 'live' && st('CS-2') === 'live' && rowOf(T, 'CS-1').via === 'parent');
  ok('Waiting: a submitted document — "Nothing to do — Amazon reviewing"', st('PM-2') === 'waiting' && !rowOf(T, 'PM-2').stuck && rowOf(T, 'PM-2').what === 'Nothing to do — Amazon reviewing');
  ok('Stuck: waiting for more than 7 days — "Stuck in review since <date> — contact Seller Support"', st('PM-1') === 'waiting' && rowOf(T, 'PM-1').stuck && /^Stuck in review since \d{1,2} \w{3} \d{4} — contact Seller Support$/.test(rowOf(T, 'PM-1').what), rowOf(T, 'PM-1').what);
  ok('Draft: "Submit “<document>” for approval"', st('RN-2') === 'draft' && !rowOf(T, 'RN-2').oldDraft && rowOf(T, 'RN-2').what === 'Submit “Runner new” for approval', rowOf(T, 'RN-2').what);
  ok('Forgotten draft: a draft not touched for 30+ days', st('RN-1') === 'draft' && rowOf(T, 'RN-1').oldDraft && /^Forgotten draft \(not touched since .*\) — submit “Runner story” for approval, or delete it$/.test(rowOf(T, 'RN-1').what), rowOf(T, 'RN-1').what);
  ok('Rejected, with Amazon\'s reason: "Fix: <reason>, then resubmit"', st('TC-6') === 'rejected' && rowOf(T, 'TC-6').what === 'Fix: Image has a web link, then resubmit', rowOf(T, 'TC-6').what);
  ok('Missing + a sibling with a live document: "Add this ASIN to “<document>” in A+ Content Manager (2 minutes)"', st('TC-4') === 'missing' && rowOf(T, 'TC-4').what === 'Add this ASIN to “Tablecloth A+” in A+ Content Manager (2 minutes)', rowOf(T, 'TC-4').what);
  ok('Missing + no sibling has one: "Create A+ for this family (one document can cover all 2 products)"', st('NP-1') === 'missing' && rowOf(T, 'NP-1').what === 'Create A+ for this family (one document can cover all 2 products)', rowOf(T, 'NP-1').what);
  ok('Missing, a product with no family: "Create A+ for this product"', st('LS-1') === 'missing' && rowOf(T, 'LS-1').what === 'Create A+ for this product');
  ok('the other brand has its own documents', st('CD-1') === 'live' && st('CD-2') === 'missing' && rowOf(T, 'CD-2').what === 'Add this ASIN to “Desk set A+” in A+ Content Manager (2 minutes)');
  {
    const R = await open({ docs: (docs, doc) => { docs.SP[1] = doc('D-REJ', 'Tablecloth winter', 'REJECTED', 'Basic', 5, ['TC-6']); } });
    ok('Rejected and Amazon sent no reason: the line says where the reason is (never an invented one)', rowOf(R, 'TC-6').what === 'Fix what Amazon rejected, then resubmit “Tablecloth winter” (Amazon\'s reason is in A+ Content Manager and in its e-mail)', rowOf(R, 'TC-6').what);
    const M = await open({ docs: (docs, doc) => { docs.SP.push(doc('D-NP', 'Napkins coming', 'SUBMITTED', 'Basic', 1, ['NP-1'])); } });
    ok('Missing + a sibling\'s document still on its way: "Add this ASIN to “<document>” (in review) so it goes live with its family"', rowOf(M, 'NP-2').what === 'Add this ASIN to “Napkins coming” (in review) so it goes live with its family', rowOf(M, 'NP-2').what);
  }

  console.log('== Not checked: grey, never an error ==');
  {
    const N = await open({ cache: { noAplus: true } });
    const rows = N.C.apcBuild().rows;
    ok('no A+ read at all: every product is Not checked — none Missing, nothing to fix, no money at risk', rows.every(p => p.bucket === 'unchecked') && N.C.apcFixList(N.C.apcBuild()).length === 0 && N.C.apcSummary(N.C.apcBuild()).risk === 0);
    ok('…and the page says so plainly, and still lists the products', /A\+ not checked yet/.test(N.text()) && /A\+ has not been read yet — it is read once a day after the 13:00 refresh/.test(N.text()) && N.C.apcGroups(N.C.apcBuild()).length === 7);
    const P = await open({ docs: (docs, doc) => { docs.SP.push(doc('D-NULL', 'List not read', 'APPROVED', 'Basic', 1, null)); } });
    ok('one document\'s product list could not be read: a product on no document is Not checked, not Missing (it may be on that one)', rowOf(P, 'TC-4').bucket === 'unchecked' && rowOf(P, 'NP-1').bucket === 'unchecked'
      && /could not say which products/.test(rowOf(P, 'TC-4').what) && rowOf(P, 'TC-1').bucket === 'live' && rowOf(P, 'CD-2').bucket === 'missing', rowOf(P, 'TC-4').what);
    const G = await open({ health: { 'TC-4': { aplus: true, aplusAt: Date.now() - 2 * DAY } } });
    ok('a publish record of the last 14 days says A+ IS on the page, but no document lists the ASIN: Not checked, with the reason', rowOf(G, 'TC-4').bucket === 'unchecked' && /Amazon's publish record of .* says A\+ is on the page, but no A\+ document lists this ASIN/.test(rowOf(G, 'TC-4').what), rowOf(G, 'TC-4').what);
    const G2 = await open({ health: { 'TC-4': { aplus: true, aplusAt: Date.now() - 30 * DAY } } });
    ok('…an old publish record (30 days) does not hold it back: Missing', rowOf(G2, 'TC-4').bucket === 'missing');
    const U = await open({ docs: (docs, doc) => { docs.SP.push(doc('D-ODD', 'Odd status', 'SUSPENDED', 'Basic', 1, ['NP-1'])); } });
    ok('a status Sellora does not know: Not checked (never guessed)', rowOf(U, 'NP-1').bucket === 'unchecked' && /SUSPENDED/.test(rowOf(U, 'NP-1').what));
    const Z = await open({ docs: docs => { docs.CPC.length = 0; } });
    ok('Amazon listed no documents for a brand: that brand is Not checked, not "all missing"', rowOf(Z, 'CD-1').bucket === 'unchecked' && rowOf(Z, 'CD-2').bucket === 'unchecked' && rowOf(Z, 'TC-4').bucket === 'missing');
  }

  console.log('== an old (stale) A+ read ==');
  {
    const O = await open({ cache: { apAt: Date.now() - 50 * H, aplusMeta: { SP: { stale: 1, err: 'the document list failed 3 times', triedAt: IST(Date.now() - 2 * H) } } } });
    const stt = O.C.lmAplusState('SP');
    ok('the last good read is kept and shown, marked old — with why', stt.has && stt.old && stt.stale && rowOf(O, 'TC-1').bucket === 'live' && rowOf(O, 'TC-4').bucket === 'missing'
      && /old data: the last read failed \(the document list failed 3 times\); the last good read is shown/.test(strip(O.els.apcMeta.innerHTML)), strip(O.els.apcMeta.innerHTML));
    ok('…an old read is not used by Listing Health (it answers from its own reads, as before)', O.C.lmAplusFresh('SP') === false && O.C.lmAplusOf('SP', A('TC-1'), A('TC-P')) === null);
    ok('…the sheet says the data time is old', /\(old\)$/.test(O.C.apcCsv().rows.find(r => r.sku === 'TC-1').time));
  }

  console.log('== the top summary ==');
  const model = C.apcBuild();
  const sum = C.apcSummary(model);
  // toggle on: 16 live products (TC-5 has no stock). live: TC-1,2,3, CS-1,2, CD-1 = 6 · waiting PM-1, PM-2 · draft RN-1, RN-2 · rejected TC-6 · missing TC-4, NP-1, NP-2, CD-2, LS-1
  ok('coverage: "Live on 6 of 16 products (38%)"', sum.live === 6 && sum.counted === 16 && sum.pct === 38 && /Live on 6 of 16 products \(38%\)/.test(T.text()), JSON.stringify(sum.n));
  ok('the bar is split Live / Waiting / Draft / Rejected / Missing', sum.n.live === 6 && sum.n.waiting === 2 && sum.n.draft === 2 && sum.n.rejected === 1 && sum.n.missing === 5 && /apc-bar[\s\S]*k-live[\s\S]*k-waiting[\s\S]*k-draft[\s\S]*k-rejected[\s\S]*k-missing/.test(T.body()));
  ok('"Sales without A+ (30 days)" = the 30-day sales of Missing + Rejected + Draft: $1,855', sum.risk === 1855 && /Sales without A\+ \(30 days\) \$1,855 8 products: Missing \+ Rejected \+ Draft/.test(T.text()), sum.risk + ' ' + T.text().slice(0, 300));
  ok('six cards with their counts and a one-word meaning, each with a tooltip', ['Live 6 approved', 'Waiting 2 reviewing', 'Draft 2 unsubmitted', 'Rejected 1 fix', 'Missing 5 none', 'No A+ needed 0 hidden'].every(t => T.text().includes(t))
    && (T.body().match(/class="fc-box apc-box[^"]*"[^>]*title="[^"]{20,}"/g) || []).length === 6);
  ok('the chips: All · Fix first 8 · Missing 5 · Rejected 1 · Draft 2 · Waiting 2 · Stuck 1 · Live 6 · No A+ needed 0', /All Fix first 8 Missing 5 Rejected 1 Draft 2 Waiting 2 Stuck 1 Live 6 No A\+ needed 0/.test(T.text()), T.text().slice(200, 500));
  ok('the shared "Amazon data" label and when A+ was read', /Amazon data: Full refresh: .* · Ridhi: A\+ read .* \(8 documents\) · CPC: A\+ read .* \(1 documents\) · A\+ is read once a day after the 13:00 refresh/.test(strip(T.els.apcMeta.innerHTML)), strip(T.els.apcMeta.innerHTML));
  {
    const W = await open({ weekly: { [A('TC-1')]: { brand: 'SP', weeks: { '2026-11-01': { u: 60, sessions: 600 }, '2026-11-08': { u: 40, sessions: 400 } } }, [A('TC-4')]: { brand: 'SP', weeks: { '2026-11-08': { u: 20, sessions: 500 } } } } });
    ok('with sessions in the weekly store: "products with A+ convert 10.0% vs 4.0% without" for the brand', /Ridhi: products with A\+ convert 10\.0% vs 4\.0% without/.test(W.text()), W.text().slice(0, 400));
    ok('without enough sessions on both sides the line is not shown (nothing invented)', !/convert/.test(T.text()));
    const NS = await open({ noSales: true });
    ok('no 30-day sales pulled: the money shows "—" and says why; products are still listed', /Sales without A\+ \(30 days\) — sales not pulled yet/.test(NS.text()) && /30-day sales not pulled yet/.test(strip(NS.els.apcMeta.innerHTML)) && NS.C.apcBuild().rows.length === 16);
  }

  console.log('== By product: families, the most money at risk first ==');
  const groups = C.apcGroups(model);
  ok('families closed by default, sorted by 30-day sales without A+ (Tablecloth $1,300 · Runner $310 · Desk set $120 · Napkins $120 · no-family $5 · …)',
    groups.map(x => x.f.name).slice(0, 5).join(' | ') === 'Floral Tablecloth | Table Runner | Cotton Napkins | Desk Organizer Set | Title of LS-1' && C.APC.open.size === 0 && screenRows(T).length === 0, groups.map(x => x.f.name + ' ' + x.g.risk).join(' | '));
  ok('a family line: name, brand, live children, "3 of 5 have A+", its badges and the money', /Floral Tablecloth Ridhi · 5 live children 3 of 5 have A\+ 1 missing 1 rejected Family gap \$1,300 without A\+/.test(T.text()), T.text().slice(400, 900));
  T.click({ apc: 'grp', apcV: groups[0].f.fk });
  ok('opened: its products with picture, SKU, ASIN link, status, document, type, last updated, 30-day sales and one "What to do"', screenRows(T).length === 5 && /<img class="cc-pic"/.test(T.body())
    && T.body().includes(`<a href="https://www.amazon.com/dp/${A('TC-4')}" target="_blank" rel="noopener"`)
    && /TC-1 .* ✓ Live Tablecloth A\+ Premium \d{1,2} \w{3} \d{4} \$1,000 Nothing to do — A\+ is live/.test(screenRows(T).find(r => r.key.endsWith(A('TC-1'))).text), screenRows(T).find(r => r.key.endsWith(A('TC-1'))).text);
  ok('inside a family: what needs doing first (the biggest sales first), the live ones last', screenRows(T).map(r => r.key.split('|')[1]).join() === [A('TC-6'), A('TC-4'), A('TC-1'), A('TC-2'), A('TC-3')].join(), screenRows(T).map(r => r.key).join());
  ok('the family gap: the exact ASINs to add, and Copy ASIN list', new RegExp(`Family gap: 1 product of this family has no A\\+ while the others are on “Tablecloth A\\+”\\. Add this ASIN to that document: ${A('TC-4')} Copy ASIN list`).test(T.text()), T.text().slice(700, 1200));
  await C.apcClick({ dataset: { apc: 'copy', apcV: A('TC-4'), apcId: 'gap:' + groups[0].f.fk } });
  ok('Copy ASIN list puts the ASINs on the clipboard', T.copied.join() === A('TC-4'));
  T.click({ apc: 'closeall' });
  ok('Open all / Close all', (openAll(T), screenRows(T).length === 16) && (T.click({ apc: 'closeall' }), screenRows(T).length === 0));

  console.log('== chips, cards, search ==');
  T.click({ apc: 'chip', apcV: 'fix' });
  const fix = C.apcFixList(C.apcBuild()).map(p => p.c.sku);
  ok('"Fix first": Missing / Rejected / Draft as one list, the biggest 30-day sales first', fix.join() === 'TC-6,TC-4,RN-1,CD-2,NP-2,NP-1,RN-2,LS-1' && screenRows(T).map(r => r.key.split('|')[1]).join() === fix.map(A).join(), fix.join());
  T.click({ apc: 'chip', apcV: 'stuck' });
  openAll(T);
  ok('chip Stuck: only the product waiting more than 7 days', screenRows(T).length === 1 && /PM-1/.test(screenRows(T)[0].text) && / Stuck /.test(screenRows(T)[0].text));
  T.click({ apc: 'f', apcV: 'rejected' });
  ok('a card filters; pressed again it clears', C.APC.f === 'rejected' && (T.click({ apc: 'f', apcV: 'rejected' }), C.APC.f === ''));
  C.apcFilter({ dataset: { apcF: 'q' }, value: 'runner story' });
  openAll(T);
  ok('search by document name', screenRows(T).length === 1 && /RN-1/.test(screenRows(T)[0].text));
  C.apcFilter({ dataset: { apcF: 'q' }, value: A('NP-2').toLowerCase() });
  openAll(T);
  ok('search by ASIN', screenRows(T).length === 1 && /NP-2/.test(screenRows(T)[0].text));
  C.apcFilter({ dataset: { apcF: 'q' }, value: 'desk organizer' });
  openAll(T);
  ok('search by family', screenRows(T).length === 2 && /Live on 1 of 2 products/.test(T.text()));
  C.apcFilter({ dataset: { apcF: 'q' }, value: '' });
  C.apcFilter({ dataset: { apcF: 'brand' }, value: 'CPC' });
  ok('the brand picker: everything follows it', C.apcSummary(C.apcBuild()).total === 2 && /Live on 1 of 2 products \(50%\)/.test(T.text()) && /\$120/.test(T.text()));
  C.apcFilter({ dataset: { apcF: 'brand' }, value: 'ALL' });
  T.click({ apc: 'closeall' });

  console.log('== "Stock > 0 only" ==');
  ok('on (default): a product with no stock is not listed', !rowOf(T, 'TC-5') && C.APC.stock === true);
  C.apcFilter({ dataset: { apcF: 'stock' }, checked: false });
  ok('off: it is listed and counted (17 products), and the money follows', !!rowOf(T, 'TC-5') && rowOf(T, 'TC-5').bucket === 'missing' && C.apcSummary(C.apcBuild()).counted === 17 && C.apcSummary(C.apcBuild()).risk === 1855 + 77);
  C.apcFilter({ dataset: { apcF: 'stock' }, checked: true });
  ok('on again: back to 16', C.apcSummary(C.apcBuild()).counted === 16 && !rowOf(T, 'TC-5'));

  console.log('== "No A+ needed" + Undo ==');
  await C.apcOkSetMany(['SP|' + A('NP-1')]);
  ok('one row: it leaves Missing and "Fix first" at once; the counts and the money follow', rowOf(T, 'NP-1').bucket === 'none' && C.apcSummary(C.apcBuild()).n.missing === 4 && C.apcSummary(C.apcBuild()).risk === 1805 && C.apcSummary(C.apcBuild()).counted === 15
    && !C.apcFixList(C.apcBuild()).some(p => p.c.sku === 'NP-1') && /1 marked “No A\+ needed” \(not counted\)/.test(T.text()));
  const mark = T.store['listingrules/aplusok_SP'];
  ok('saved the way "Removed on purpose" is: listingrules/aplusok_<brand>, with who and when', mark && mark.kind === 'aplusok' && mark.items[A('NP-1')].on === true && mark.items[A('NP-1')].by === 'vishesh.g@example.com' && mark.items[A('NP-1')].name === 'Vishesh G' && mark.items[A('NP-1')].at > 0 && mark.items[A('NP-1')].st === 'missing', JSON.stringify(mark));
  ok('its line says who marked it', /^No A\+ needed — marked by Vishesh G on \d{1,2} \w{3} \d{4}$/.test(rowOf(T, 'NP-1').what), rowOf(T, 'NP-1').what);
  T.click({ apc: 'chip', apcV: 'none' });
  openAll(T);
  ok('chip "No A+ needed": the marked product, with Undo', screenRows(T).length === 1 && /NP-1/.test(screenRows(T)[0].text) && /data-apc="undo"/.test(T.body()));
  await C.apcOkUndo('SP', A('NP-1'));
  ok('Undo: it is Missing again; who undid it is kept', rowOf(T, 'NP-1').bucket === 'missing' && T.store['listingrules/aplusok_SP'].items[A('NP-1')].on === false && T.store['listingrules/aplusok_SP'].items[A('NP-1')].undoneBy === 'vishesh.g@example.com' && C.apcSummary(C.apcBuild()).risk === 1855);
  T.click({ apc: 'chip', apcV: '' });
  T.click({ apc: 'closeall' });
  // ticks and the bar
  T.click({ apc: 'grp', apcV: groups[0].f.fk });
  T.click({ apc: 'tick', apcB: 'SP', apcS: A('TC-4') });
  ok('a tick: the bar "1 selected · No A+ needed (1) · Clear"', /1 selected No A\+ needed \(1\) Clear/.test(T.text()));
  T.click({ apc: 'selfam', apcV: groups[0].f.fk });
  ok('"Select all in family" ticks every product of the family that is not Live (2); Live rows have no tick', C.APC.sel.size === 2 && /2 selected/.test(T.text()) && (T.body().match(/class="fc-tick"/g) || []).length === 2 && /Clear this family/.test(T.text()));
  await C.apcClick({ dataset: { apc: 'bok' } });
  ok('the bar\'s button marks them all in one go (one write per brand)', rowOf(T, 'TC-4').bucket === 'none' && rowOf(T, 'TC-6').bucket === 'none' && C.APC.sel.size === 0 && T.store['listingrules/aplusok_SP'].items[A('TC-6')].on === true);
  ok('a marked product that later gets a live document is simply Live (the mark hides errors only)', (() => { const p = rowOf(T, 'TC-1'); return p.bucket === 'live'; })());
  {
    const again = await open({ store: T.store });
    ok('the marks come back after a reload', rowOf(again, 'TC-4').bucket === 'none' && rowOf(again, 'NP-1').bucket === 'missing');
    const ns = await open({ noSave: true });
    await ns.C.apcOkSetMany(['SP|' + A('NP-1')]);
    ok('a mark that could not be saved says so (kept on this page only)', /Not saved — the mark is kept on this page only/.test(strip(ns.els.apcMeta.innerHTML)) && rowOf(ns, 'NP-1').bucket === 'none');
  }
  await C.apcOkUndo('SP', A('TC-4'));
  await C.apcOkUndo('SP', A('TC-6'));
  T.click({ apc: 'closeall' });

  console.log('== By A+ document ==');
  T.click({ apc: 'view', apcV: 'doc' });
  const docs = C.apcDocs(C.apcBuild());
  const D = k => docs.find(x => x.d.k === k);
  ok('every document as a card: name, status, type, last updated, how many products it is on', docs.length === 9 && /Tablecloth A\+ ✓ Live Ridhi · Premium · updated \d{1,2} \w{3} \d{4} · on 3 products at Amazon · 3 live in Sellora/.test(T.text()), T.text().slice(300, 900));
  ok('"add these ASINs to this document": the live family members that have no A+ yet, first in the list', docs[0].d.k === 'D-LIVE' && D('D-LIVE').add.join() === A('TC-4')
    && new RegExp(`Add this ASIN to this document \\(\\$400 of 30-day sales without A\\+\\) — live family members that have no A\\+ yet \\(Floral Tablecloth\\): ${A('TC-4')} Copy ASIN list`).test(T.text()), JSON.stringify(D('D-LIVE').add));
  ok('an unused document: "Not on any live product"', D('D-UNUSED').unused && D('D-UNUSED').liveN === 0 && /Old launch page ✓ Live Not on any live product/.test(T.text()));
  ok('a document on the parent ASIN counts the children it covers (not unused)', !D('D-PAR').unused && D('D-PAR').liveN === 2);
  ok('stuck and forgotten documents say so', D('D-WAIT').stuck && D('D-DRAFT').oldDraft && /Placemats A\+ Waiting Stuck/.test(T.text()) && /Runner story Draft Forgotten draft/.test(T.text()));
  ok('a rejected document shows Amazon\'s reason', /Tablecloth winter Rejected[\s\S]*Amazon's reason: Image has a web link/.test(T.text()));
  T.click({ apc: 'chip', apcV: 'unused' });
  ok('chip "Not on any live product"', (T.body().match(/class="card apc-dcard"/g) || []).length === 1 && /Old launch page/.test(T.text()));
  T.click({ apc: 'chip', apcV: 'add' });
  ok('chip "Has ASINs to add"', (T.body().match(/class="card apc-dcard"/g) || []).length === 2 && /Tablecloth A\+/.test(T.text()) && /Desk set A\+/.test(T.text()));
  T.click({ apc: 'chip', apcV: '' });

  console.log('== SCREEN = DOWNLOAD ==');
  {
    const csvD = C.apcDocsCsv();
    const cells = csvRows(csvD.text);
    ok('Download documents: the cards in view, Excel-ready (UTF-8 BOM, CRLF), the stated columns', csvD.text.charCodeAt(0) === 0xFEFF && cells[0].join('|') === C.APC_DOC_COLS.join('|') && cells.length === 10 && !/[^\r]\n/.test(csvD.text));
    const cards = [...T.body().matchAll(/<div class="card apc-dcard"[^>]*>([\s\S]*?)<div class="apc-da">/g)].map(m => strip(m[1]));
    ok('…the same documents in the same order as the screen, the same status / type / date / ASINs to add', cards.length === 9 && cells.slice(1).every((r, i) => cards[i].startsWith(r[1]) && cards[i].includes(r[2].replace('Live', '✓ Live')) && (!r[3] || cards[i].includes(r[3])) && (!r[4] || cards[i].includes(r[4])) && (!r[7] || cards[i].includes(r[7]))),
      cells.slice(1).map((r, i) => r[1] + ' / ' + cards[i].slice(0, 40)).join(' || '));
    T.click({ apc: 'view', apcV: 'prod' });
    const check = (label) => {
      const want = C.APC.f === 'fix';
      if (!want) openAll(T);
      else { C.APC.flat = 1e6; C.apcDraw(); }
      const scr = screenRows(T), csv = C.apcCsv(), rows = csvRows(csv.text).slice(1);
      const same = scr.length === rows.length && rows.every((r, i) => {
        const t = scr[i].text;
        return scr[i].key.endsWith('|' + r[3]) && t.includes(r[2]) && t.includes(r[6] === 'Live' ? '✓ Live' : r[6]) && (!r[7] || t.includes(r[7])) && (!r[8] || t.includes(r[8])) && (!r[9] || t.includes(r[9])) && t.includes(r[11])
          && (r[5] === '' ? true : t.includes('$' + Math.round(Number(r[5])).toLocaleString('en-US')));
      });
      ok(label + ': ' + rows.length + ' rows on the screen = ' + rows.length + ' rows in the sheet, the same order, status, document, type, date, sales and "What to do"', same && rows.length > 0,
        scr.length + ' vs ' + rows.length + ' · ' + (rows.find((r, i) => !scr[i] || !scr[i].text.includes(r[11])) || []).join(' | '));
      return { csv, rows };
    };
    const all = check('all products');
    ok('the sheet\'s columns: Brand · Family · SKU · ASIN · Stock · 30-day sales · A+ status · Document name · Type · Last updated · Amazon\'s reason · What to do · Amazon link · Data time',
      csvRows(all.csv.text)[0].join(' · ') === "Brand · Family · SKU · ASIN · Stock · 30-day sales · A+ status · Document name · Type · Last updated · Amazon's reason · What to do · Amazon link · Data time" && all.csv.text.charCodeAt(0) === 0xFEFF);
    const tc6 = all.rows.find(r => r[2] === 'TC-6');
    ok('a row of the sheet, whole', tc6[0] === 'Ridhi' && tc6[1] === 'Floral Tablecloth' && tc6[3] === A('TC-6') && tc6[4] === '5' && tc6[5] === '900.00' && tc6[6] === 'Rejected' && tc6[7] === 'Tablecloth winter' && tc6[8] === 'Basic'
      && /^\d{1,2} \w{3} \d{4}$/.test(tc6[9]) && tc6[10] === 'Image has a web link' && tc6[11] === 'Fix: Image has a web link, then resubmit' && tc6[12] === 'https://www.amazon.com/dp/' + A('TC-6') && /^\d{1,2} \w{3} \d{2}:\d{2}$/.test(tc6[13]), tc6.join(' | '));
    T.click({ apc: 'chip', apcV: 'fix' });
    const f = check('"Fix first"');
    ok('…in the ranked order', f.rows.map(r => r[2]).join() === 'TC-6,TC-4,RN-1,CD-2,NP-2,NP-1,RN-2,LS-1');
    T.click({ apc: 'chip', apcV: 'missing' });
    check('chip Missing');
    C.apcFilter({ dataset: { apcF: 'brand' }, value: 'CPC' });
    T.click({ apc: 'chip', apcV: '' });
    check('one brand');
    C.apcFilter({ dataset: { apcF: 'brand' }, value: 'ALL' });
    C.apcFilter({ dataset: { apcF: 'stock' }, checked: false });
    const off = check('"Stock > 0 only" off');
    ok('…17 rows with the toggle off', off.rows.length === 17 && off.rows.some(r => r[2] === 'TC-5' && r[4] === '0'));
    C.apcFilter({ dataset: { apcF: 'stock' }, checked: true });
    C.apcFilter({ dataset: { apcF: 'q' }, value: 'tablecloth' });
    check('a search');
    C.apcFilter({ dataset: { apcF: 'q' }, value: '' });
    T.click({ apc: 'closeall' });
  }

  console.log('== no Amazon call by itself; Preview A+ on a click only ==');
  ok('opening and using the screen made only cache reads (lmMeta and the tabs it names)', T.calls.every(q => q.cache) && T.calls.filter(q => /^lmAplus_/.test(q.cache)).length === 2, JSON.stringify(T.calls.filter(q => !q.cache)));
  T.click({ apc: 'grp', apcV: groups[0].f.fk });
  await C.apcPreview('SP|D-LIVE', 'SP|' + A('TC-1'));
  ok('Preview A+: ONE read of that one document (?lh=aplusdoc), shown under the row — its modules, texts and pictures small', T.calls.filter(q => q.lh === 'aplusdoc').length === 1 && T.calls.find(q => q.lh === 'aplusdoc').doc === 'D-LIVE'
    && /class="apc-prevr"/.test(T.body()) && /standard header image text/.test(T.text()) && /Made by hand/.test(T.text()) && /<img class="apc-pimg" src="https:\/\/m\.media-amazon\.com\/images\/S\/aplus-media\/sc\/abc\.jpg"/.test(T.body()));
  await C.apcPreview('SP|D-LIVE', 'SP|' + A('TC-1'));
  await C.apcPreview('SP|D-LIVE', 'SP|' + A('TC-1'));
  ok('closing and opening it again reads nothing more', T.calls.filter(q => q.lh === 'aplusdoc').length === 1);
  {
    const F = await open({ docFail: true });
    F.C.APC.view = 'doc'; F.C.apcDraw();
    await F.C.apcPreview('SP|D-LIVE', 'doc:SP|D-LIVE');
    ok('a preview that fails says so, with Try again — nothing else breaks', /Could not read this document: Amazon answered 500 Try again/.test(F.text()));
  }
  T.click({ apc: 'closeall' });

  console.log('== the screen opens from the saved copy, fast ==');
  {
    const first = await open();
    ok('the A+ tabs are kept in the browser\'s saved copy', first.saved.puts >= 1 && first.saved.copy.aplus.SP.raw.docs['D-LIVE'].n === 'Tablecloth A+' && !!first.saved.copy.aplus.SP.key);
    const off = setup({ noCache: true, savedCopy: first.saved.copy });
    await off.C.lmEnsure();
    await off.C.apcOpen();
    ok('opened with the backend unreachable: the same statuses from the saved copy', rowOf(off, 'TC-1').bucket === 'live' && rowOf(off, 'TC-4').bucket === 'missing' && off.C.apcSummary(off.C.apcBuild()).live === 6);
    // only the A+ read is newer: its tabs alone are read
    const two = setup({ savedCopy: first.saved.copy });
    two.net.tabs.lmMeta = JSON.parse(JSON.stringify(first.saved.copy.meta));      // the same listing pass as the saved copy…
    two.net.tabs.lmMeta.aplus.SP.at = '2026-11-19 13:25';                         // …and a newer A+ read of one brand
    two.net.tabs.lmAplus_SP.at = '2026-11-19 13:25';
    two.net.tabs.lmAplus_SP.docs['D-LIVE'].n = 'Tablecloth A+ (renamed)';
    await two.C.lmEnsure();
    await two.C.lmRefresh();
    await new Promise(r => setTimeout(r, 0));
    await two.C.lmRefresh();
    const read = two.calls.map(q => q.cache);
    ok('when only the daily A+ read is newer, only that brand\'s A+ tab is read again (not every listing tab, not the other brand)', read.filter(c => c === 'lmAplus_SP').length === 1 && !read.some(c => /^lm(Listings|Catalog)_/.test(c) || c === 'lmAplus_CPC')
      && two.C.lmGetAplus(A('TC-1'), 'SP').main.n === 'Tablecloth A+ (renamed)', read.join());
    // an A+ tab the backend cannot give yet (its route not deployed): asked once, not on every 15-minute check
    const nd = setup();
    delete nd.net.tabs.lmAplus_SP;
    await nd.C.lmEnsure();
    await nd.C.lmRefresh(); await new Promise(r => setTimeout(r, 0));
    await nd.C.lmRefresh(); await nd.C.lmRefresh(); await nd.C.lmRefresh();
    ok('an A+ tab that cannot be read is asked once (again after an hour), never on every check — and that brand is simply Not checked', nd.calls.filter(q => q.cache === 'lmAplus_SP').length === 1 && nd.C.lmGetAplus(A('TC-1'), 'SP') === null
      && nd.C.lmGetAplus(A('CD-1'), 'CPC').status === 'APPROVED', nd.calls.map(q => q.cache).join());
    // the big catalogue
    const big = sample();
    for (let i = 0; i < 4000; i++) { const p = 'F' + Math.floor(i / 20) + '-P'; big.kids.push({ brand: i % 3 ? 'SP' : 'CPC', sku: 'F' + i, psku: p, asin: 'B1' + String(i).padStart(8, '0'), qty: 3 }); }
    big.docs.SP.push({ k: 'BIG', n: 'Big one', s: 'APPROVED', t: 'Basic', bd: ['STANDARD'], u: new Date().toISOString(), rr: [], a: big.kids.filter((k, i) => i % 2).map(k => k.asin) });
    const B = await open({ S: big });
    const t0 = Date.now();
    B.C.APC.model = null; B.C.APC.fam = null;
    B.C.apcDraw();
    const ms = Date.now() - t0;
    ok('4,000 products: the first screenful (60 closed families) drawn in ' + ms + ' ms; not one product row is built until a family is opened', ms < 1500 && screenRows(B).length === 0 && (B.body().match(/class="fc-head"/g) || []).length === 60);
    const t1 = Date.now();
    B.click({ apc: 'chip', apcV: 'missing' });
    ok('…a chip redraws from what is held in ' + (Date.now() - t1) + ' ms (the families are not worked out again)', Date.now() - t1 < 400 && B.C.APC.fam && B.C.APC.fam.v);
  }

  console.log('== empty state and loading ==');
  {
    const E = await open({ docs: (docs, doc) => { docs.SP = [doc('ALL', 'Everything', 'APPROVED', 'Basic', 5, ['TC-1', 'TC-2', 'TC-3', 'TC-4', 'TC-6', 'NP-1', 'NP-2', 'RN-1', 'RN-2', 'PM-1', 'PM-2', 'CS-1', 'CS-2', 'LS-1'])]; docs.CPC = [doc('ALLC', 'Everything CPC', 'APPROVED', 'Basic', 5, ['CD-1', 'CD-2'])]; } });
    ok('"Every live product has A+ ✓" when nothing is left', /Every live product has A\+ ✓/.test(E.text()) && E.C.apcSummary(E.C.apcBuild()).pct === 100);
    const Ld = setup();
    Ld.C.APC.loading = true; Ld.C.apcDraw();
    ok('skeleton rows while loading', /apc-skel/.test(Ld.body()) && /sp-skel/.test(Ld.body()));
  }

  console.log('== the console: aplusCounts() and aplusAccuracyReport() ==');
  {
    const counts = C.aplusCounts();
    ok('aplusCounts(): per brand, each status and the sales without A+', counts.Ridhi.products === 14 && counts.Ridhi.live === 5 && counts.Ridhi.waiting === 2 && counts.Ridhi.stuck === 1 && counts.Ridhi.draft === 2 && counts.Ridhi.rejected === 1 && counts.Ridhi.missing === 4
      && counts.Ridhi.salesWithoutAplus30d === 1735 && counts.CPC.live === 1 && counts.CPC.missing === 1 && counts.CPC.salesWithoutAplus30d === 120 && counts.Ridhi.documents === 8 && counts.Ridhi.callsOfThatRead === 10, JSON.stringify(counts));
    // Amazon agrees with everything except: TC-4 (Sellora: Missing) has A+ published, and D-WAIT was approved since the read
    const pub = {};
    T.S.kids.forEach(k => { pub[k.asin] = ['TC-1', 'TC-2', 'TC-3', 'CD-1', 'TC-4'].includes(k.sku); });
    pub[A('TC-P')] = false; pub[A('NP-P')] = false; pub[A('RN-P')] = false; pub[A('PM-P')] = false; pub[A('CS-P')] = true; pub[A('CD-P')] = false;
    const R = await open({ pub, docAnswer: q => { const d = T.S.docs[q.brand].find(x => x.k === q.doc); return { ok: true, key: d.k, name: d.n, status: d.k === 'D-WAIT' ? 'APPROVED' : d.s, type: d.t, modules: [], asins: d.a }; } });
    R.calls.length = 0;
    const rep = await R.C.aplusAccuracyReport();
    const by = sku => rep.rows.find(r => r.SKU === sku);
    ok('aplusAccuracyReport(): SKU · Sellora says · Amazon says · MATCH / DIFFERENT, for products of every status', rep.rows.length === 16 && by('TC-1').result === 'MATCH' && by('TC-6').result === 'MATCH' && by('RN-1').result === 'MATCH' && by('NP-1').result === 'MATCH' && by('CS-1').result === 'MATCH',
      JSON.stringify(rep.rows.map(r => r.SKU + ' ' + r.result)));
    ok('…a product Sellora calls Missing that Amazon shows A+ on: DIFFERENT', by('TC-4').result === 'DIFFERENT' && /A\+ published on the page/.test(by('TC-4')['Amazon says']));
    ok('…a document whose status changed at Amazon since the read: DIFFERENT', by('PM-1').result === 'DIFFERENT' && /document APPROVED/.test(by('PM-1')['Amazon says']) && rep.different === 2 && rep.match === 14);
    ok('…it reads Amazon only because a person ran it: publish records 10 ASINs a call, each document once', R.calls.filter(q => q.lh === 'aplusasin').length === 3 && R.calls.filter(q => q.lh === 'aplusdoc').length === 8 && R.calls.every(q => q.lh === 'aplusasin' || q.lh === 'aplusdoc'),
      R.calls.map(q => q.lh).join());
  }

  console.log('== the read door (listing-match.js) ==');
  ok('lmGetAplus(asin): its documents, the one that counts, the status', C.lmGetAplus(A('TC-1'), 'SP').status === 'APPROVED' && C.lmGetAplus(A('TC-1'), 'SP').main.n === 'Tablecloth A+' && C.lmGetAplus(A('TC-4'), 'SP').status === 'NONE'
    && C.lmGetAplus(A('CS-1'), 'SP').via === 'parent' && C.lmGetAplus(A('CS-1'), 'SP', A('CS-P')).status === 'APPROVED');
  ok('an approved document wins over a draft on the same ASIN', (await open({ docs: (docs, doc) => { docs.SP.push(doc('D-EXTRA', 'A newer draft', 'DRAFT', 'Basic', 1, ['TC-1'])); } })).C.lmGetAplus(A('TC-1'), 'SP').main.k === 'D-LIVE');
  ok('lmAplusDocs(): every document; one brand or both', C.lmAplusDocs().length === 9 && C.lmAplusDocs('CPC').length === 1 && C.lmAplusDocs('SP')[0].u > 0);
  {
    const code = L('aplus-audit.js');
    ok('aplus-audit.js reads the A+ data only through lmGetAplus / lmAplusDocs / lmAplusState (no cache tab, no Firestore, no fetch of its own)', !/lmAplus_|lmMeta|lmListings_|lmCatalog_|getDoc\(|setDoc\(|fetch\(/.test(code) && /lmGetAplus\(/.test(code) && /lmAplusDocs\(/.test(code));
    ok('its only backend calls are the two a person starts: Preview A+ and the accuracy report', (code.match(/baCall\(/g) || []).length === 3 && (code.match(/baCall\(\{ lh: 'aplusdoc'/g) || []).length === 2 && (code.match(/baCall\(\{ lh: 'aplusasin'/g) || []).length === 1);
    ok('every name it adds starts with apc / APC (and the two console names)', (code.match(/^(?:async )?function (\w+)/gm) || []).every(f => /function (apc|aplusCounts|aplusAccuracyReport)/.test(f)) && (code.match(/^(?:const|let) (\w+)/gm) || []).every(f => /^(?:const|let) (apc|APC)/.test(f)),
      (code.match(/^(?:const|let) (\w+)/gm) || []).filter(f => !/^(?:const|let) (apc|APC)/.test(f)).join());
    ok('no "live" Amazon read on opening: apcOpen calls only the saved-data loaders', !/baCall/.test(code.slice(code.indexOf('async function apcOpen'), code.indexOf('const apcPaneOn'))));
  }

  console.log('== Listing Health\'s A+ answer comes from the same data ==');
  {
    const { load } = require('./listing-rules-test.js');
    const mk = (o) => {
      const net = {};
      const C2 = load({ lm: true, ws: true, baCall: async q => { if (q.cache) { if (!net.tabs[q.cache]) throw new Error('nothing cached for "' + q.cache + '" yet'); return { ok: true, name: q.cache, data: JSON.parse(JSON.stringify(net.tabs[q.cache])) }; } net.other = (net.other || 0) + 1; return {}; } });
      C2.lmStoreUse({ get: async () => null, put: async () => true });
      const at = Date.now() - H, apAt = o.apAt || Date.now() - 2 * H;
      const meta = { v: 2, kind: 'full', startedAt: IST(at - 20 * 60000), finishedAt: IST(at), upTo: IST(at), lastFull: { finishedAt: IST(at), brands: ['SP', 'CPC'], gaveUp: [] }, hash: 'h31', parts: { listings: {}, catalog: {} }, aplus: {} };
      net.tabs = { lmMeta: meta };
      ['SP', 'CPC'].forEach(b => {
        const items = {}, cat = {};
        C2.HEALTH[b].rows.forEach(r => { items[r.sku] = { sku: r.sku, asin: r.asin, b, as: 'BUYABLE,DISCOVERABLE', pt: 'NAPKIN', t: r.title, bl: [], d: '', hl: [], kw: '', lvl: 'child', psku: '', va: {}, img: {}, iss: [], readAt: at, rs: r.status, price: r.price, ch: r.channel, rAt: at, fba: r.qty, fyp: null, inSupReport: false, sup: null };
          cat[r.asin] = { asin: r.asin, t: r.title, img: {}, pa: [], kids: [], vals: {}, rk: { main: null, sub: null }, aplus: null, readAt: at }; });
        net.tabs[`lmListings_${b}_1_0`] = { b, items }; net.tabs[`lmCatalog_${b}_1_0`] = { b, items: cat };
        meta.parts.listings[b] = [`lmListings_${b}_1_0`]; meta.parts.catalog[b] = [`lmCatalog_${b}_1_0`];
        const docs = o.docs(b, C2.HEALTH[b].rows);
        net.tabs['lmAplus_' + b] = { b, v: 1, at: IST(apAt), atMs: apAt, ok: true, calls: 3, docs };
        meta.aplus[b] = { tab: 'lmAplus_' + b, at: IST(apAt), atMs: apAt, calls: 3, docs: Object.keys(docs).length, stale: 0, err: '' };
      });
      return { C2, net };
    };
    const first = rows => rows[0], second = rows => rows[1];
    const X = mk({ docs: (b, rows) => ({ D1: { k: 'D1', n: 'Live doc', s: 'APPROVED', t: 'Basic', bd: [], u: new Date().toISOString(), rr: [], a: [first(rows).asin] }, D2: { k: 'D2', n: 'A draft', s: 'DRAFT', t: 'Basic', bd: [], u: new Date().toISOString(), rr: [], a: [second(rows).asin] } }) });
    const r1 = X.C2.HEALTH.SP.rows[0], r2 = X.C2.HEALTH.SP.rows[1], r3 = X.C2.HEALTH.SP.rows[2];
    r2.aplus = false; r2.aplusAt = Date.now() - DAY;        // the snapshot's own publish record for r2: no A+
    const before = X.C2.score(r3.sku).aplus;
    await X.C2.lmEnsure(); await X.C2.lmRefresh();
    X.C2.reset();
    const a1 = X.C2.score(r1.sku).aplus, a2 = X.C2.score(r2.sku).aplus;
    ok('an approved document on the ASIN: Listing Health says A+ is there (from the A+ document, in Listing Health\'s own words)', a1.v === true && a1.lm === true && a1.src === 'listing' && a1.doc === 'Live doc');
    ok('a draft only: no A+ live — not stale, so it counts', a2.v === false && a2.stale === false && a2.lm === true);
    ok('before the cache was read, the answer was the snapshot\'s publish record, as always', before.lm === undefined);
    // a row whose snapshot says "no A+" and the documents agree
    X.C2.HEALTH.SP.rows[3].aplus = false; X.C2.HEALTH.SP.rows[3].aplusAt = Date.now() - DAY;
    X.C2.reset();
    const a4 = X.C2.score(X.C2.HEALTH.SP.rows[3].sku).aplus;
    ok('documents say none and no fresh publish record says otherwise: A+ missing, from the daily read', a4.v === false && a4.lm === true && a4.stale === false);
    // the guard: documents say none, a fresh publish record says it is on the page
    X.C2.HEALTH.SP.rows[3].aplus = true; X.C2.HEALTH.SP.rows[3].aplusAt = Date.now() - 2 * DAY;
    X.C2.reset();
    const a5 = X.C2.score(X.C2.HEALTH.SP.rows[3].sku).aplus;
    ok('…a publish record of the last 14 days that says A+ IS on the page wins until it is old (and says until when)', a5.v === true && a5.lm === undefined && a5.until > Date.now());
    ok('no one-by-one A+ reads are queued while the daily read is fresh', X.C2.lmOk('SP') && (() => { const src = L('listing-workspace.js'); return /if \(!force && typeof lmAplusFresh === 'function' && lmAplusFresh\(brand\)\) return 0;/.test(src); })()
      && /if \(typeof lmAplusFresh === 'function' && lmAplusFresh\(brand\)\) \{/.test(L('listing-health-data.js')));
    const Old = mk({ apAt: Date.now() - 40 * H, docs: (b, rows) => ({ D1: { k: 'D1', n: 'Live doc', s: 'APPROVED', t: 'Basic', bd: [], u: new Date().toISOString(), rr: [], a: [first(rows).asin] } }) });
    await Old.C2.lmEnsure(); await Old.C2.lmRefresh();
    Old.C2.reset();
    ok('an A+ read older than 30 hours is not used: Listing Health answers from its own publish records, exactly as before', Old.C2.score(Old.C2.HEALTH.SP.rows[0].sku).aplus.lm === undefined);
  }

  console.log('== the labels say the backend\'s own schedule ==');
  {
    const gs = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'ListingMatch.gs'), 'utf8');
    const lmJs = L('listing-match.js'), syncJs = L('listing-sync.js');
    const hours = JSON.parse((gs.match(/var LM_FULL_HOURS = (\[[^\]]*\]);/) || [])[1] || '[]');
    const shown = JSON.parse((lmJs.match(/const LM_FULL_AT = (\[[^\]]*\]);/) || [])[1] || '[]');
    ok('"next refresh ~HH:00" on every Listing screen uses the hours ListingMatch.gs runs its full passes at (' + hours.join(':00, ') + ':00)', hours.length > 0 && JSON.stringify(hours) === JSON.stringify(shown), JSON.stringify(hours) + ' vs ' + JSON.stringify(shown));
    const apGs = Number((gs.match(/var LM_APLUS_HOUR = (\d+);/) || [])[1]), apJs = Number((lmJs.match(/const LM_APLUS_AT = (\d+);/) || [])[1]);
    ok('"A+ is read once a day after the ' + apGs + ':00 refresh" is the pass ListingMatch.gs reads A+ after — and that pass is one of its full passes', apGs === apJs && hours.includes(apGs)
      && new RegExp('A\\+ is read once a day after the ' + apGs + ':00 refresh').test(strip(T.els.apcMeta.innerHTML)), apGs + ' vs ' + apJs);
    ok('the browser sync line names its own hours (every 2 hours, 9 AM – 7 PM; origin/listing-sync-2h) — the backend passes are not on that clock', /const LY_CYCLE_MS = 2 \* 60 \* 60 \* 1000;/.test(syncJs) && /const LY_FROM_HOUR = 9;/.test(syncJs) && /const LY_TO_HOUR = 19;/.test(syncJs)
      && /next sync \$\{/.test(syncJs) && !/\bLY_/.test(gs));
  }

  console.log('== the menu, the pane, the styles ==');
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    const nav = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'core', 'nav.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
    const order = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'ORDER'), 'utf8');
    ok('"A+ Content" in the Listing menu under "2 · Check", right after Family & Category Check', /<div class="navcol-h">2 · Check<\/div>[\s\S]*?<button id="tabFam" class="nav">Family &amp; Category Check<\/button>\s*<button id="tabAplus" class="nav">A\+ Content<\/button><\/div>/.test(html)
      && /data-tabs="[^"]*fam,aplus,lhist"/.test(html) && /<div id="paneAplus" class="hide"><div id="apcPane"><\/div><\/div>/.test(html));
    ok('the tab is known to the app: TABS, its title, and it comes with Listing Health', /'fam', 'aplus'\];/.test(nav) && /aplus: 'A\+ Content'/.test(nav) && /TAB_INHERIT = \{[^}]*aplus: 'health'/.test(nav));
    ok('the file is joined after category-check.js', /listing\/category-check\.js\r?\nlisting\/aplus-audit\.js/.test(order));
    ok('the same look as Family & Category Check: its styles cover both panes', /:is\(#paneFam,#paneAplus\) \.fc-box\{/.test(css) && /:is\(#paneFam,#paneAplus\) \.fc-chip\.is-r\{/.test(css) && /:is\(#paneFam,#paneAplus\) \.cc-fchip\{/.test(css) && !/\n\s*#paneFam \.fc-/.test(css));
    ok('its own colours are the shared ones (var(--…)): no fixed colour but the white behind a picture', (() => { const own = css.slice(css.indexOf('/* ----- A+ Content (listing/aplus-audit.js)'), css.indexOf('@media (max-width:860px){#paneAplus')); return own.length > 500 && (own.match(/#[0-9a-fA-F]{3,6}\b/g) || []).every(c => c === '#fff'); })());
    ok('a sticky header', /#paneAplus \.apc-tb\{position:sticky;top:var\(--apc-top,0px\)/.test(css));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
