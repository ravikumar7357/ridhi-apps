// Pricing-API ListingMatch.gs (16 Nov 2026): Amazon's own listing data into the cache sheet (lmListings / lmCatalog / lmMeta).
// Runs the real .gs files in node against a fake Amazon (reports, Listings Items, Catalog Items, FBA) and a fake cache spreadsheet.
// node Replenish-App/tests/listing-match-test.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const P = path.join(__dirname, '..', '..', 'Pricing-API') + '/';
const FILES = ['SpApi.gs', 'Code.gs', 'MailPo.gs', 'Nightly.gs', 'ListingImages.gs', 'ListingFix.gs', 'InventoryAge.gs', 'Research.gs', 'ListingMatch.gs'];
const SRC = FILES.map(f => fs.readFileSync(P + f, 'utf8')).join('\n;\n');

/* ---------- A FIXED CLOCK (17 Nov 2026): the whole test — this file and the .gs code it runs — starts at 16 Nov 2026 10:00 IST and
 * moves on only by the time the test itself takes. Before, it ran on the computer's clock, and one check could not pass between
 * 11:10 and 11:32 IST: its pretend "17:40" landed on today and its pretend "18:02" on yesterday. Now the result is the same at any
 * time of day. `new Date(x)` with a value, Date.parse and Date.UTC work as always. ---------- */
const REAL_DATE = Date, TEST_T0 = REAL_DATE.now(), TEST_BASE = REAL_DATE.UTC(2026, 10, 16, 4, 30);
const fakeNow = () => TEST_BASE + (REAL_DATE.now() - TEST_T0);
class FakeDate extends REAL_DATE {
  constructor(...args) { if (args.length) super(...args); else super(fakeNow()); }
  static now() { return fakeNow(); }
}
global.Date = FakeDate;
let pass = 0, fail = 0;
const ok = (n, c, i) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (i !== undefined ? '  ' + i : '')); } };

/* ---------- a "time zone" in which the time is H:M right now (the schedule reads the script's time zone) ---------- */
function tzAt(H, M) {
  const d = new Date();                         // the fixed clock above
  // always the SAME DAY as that clock (no jump to the day before or after): 17:40 and then 18:02 are 22 minutes apart, whenever the test runs
  const off = (H * 60 + (M || 0)) - (d.getUTCHours() * 60 + d.getUTCMinutes());
  return 'OFF:' + off;                          // minutes; fmt below shifts the clock by them
}
function fmt(d, tz, pat) {
  if (/^OFF:/.test(tz)) { d = new Date(d.getTime() + Number(tz.slice(4)) * 60000); tz = 'UTC'; }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  if (pat === 'H') return String(+p.hour);
  if (pat === 'EEE') return d.toUTCString().slice(0, 3);
  return pat.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
}

/* ---------- the fake world: our listings per brand, the catalog, the suppressed report, stock ---------- */
const A = (b, n) => (b === 'SP' ? 'B0SP' : 'B0CP') + String(n).padStart(6, '0');
function world(o) {
  o = o || {};
  const W = {};
  ['SP', 'CPC'].forEach(b => {
    const n = (o.n && o.n[b]) || (b === 'SP' ? 47 : 23);
    const skus = {}, cat = {};
    const parent = (b === 'SP' ? 'B0SPPARENT' : 'B0CPPARENT');
    cat[parent] = { t: 'Parent ' + b, img: {}, kids: [], theme: 'SIZE/COLOR', tattrs: ['size', 'color'] };
    for (let i = 1; i <= n; i++) {
      const sku = (b === 'SP' ? 'RTC14-' : 'CPC-') + i, asin = A(b, i);
      skus[sku] = { asin, status: i % 9 === 0 ? 'Inactive' : 'Active', qty: null, price: 20 + i, ch: 'AMAZON_NA', as: ['BUYABLE', 'DISCOVERABLE'], pt: 'TABLECLOTH',
        t: 'Title ' + sku, bl: ['Bullet one ' + sku, 'Bullet two'], d: (o.longText ? 'x'.repeat(o.longText) : 'Description ') + sku, hl: ['Cotton'], kw: 'table cloth',
        color: 'Color' + i, size: '60x90', lvl: 'child', psku: 'PARENT-' + b, theme: 'SIZE/COLOR', img: { main_product_image_locator: 'https://m.media-amazon.com/images/I/' + sku + '-main.jpg' },
        iss: [], upd: '2026-11-01T00:00:00Z', fba: i * 2 };
      cat[asin] = { t: 'Shown ' + sku, img: { MAIN: { link: 'https://m.media-amazon.com/images/I/' + sku + '-live.jpg', w: 1500, h: 1500 } }, pa: [parent], vals: { color: 'Color' + i, size: '60x90' } };
      cat[parent].kids.push(asin);
    }
    // A+ documents (A+ Content API): Ridhi — one approved on children 1–10, a draft on 11–12, one waiting on 13, a rejected one on 14,
    // an approved one attached to nothing; CPC — one approved on children 1–5. Children past those have no A+.
    const doc = (k, n, st, bd, upd, kids) => ({ k, n, s: st, bd, u: upd, a: kids.map(i => A(b, i)) });
    const aplus = b === 'SP'
      ? [doc('SP-DOC-1', 'Tablecloth A+ 2026', 'APPROVED', ['STANDARD'], '2026-10-01T10:00:00Z', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        doc('SP-DOC-2', 'Napkins draft', 'DRAFT', ['STANDARD'], '2026-09-01T10:00:00Z', [11, 12]),
        doc('SP-DOC-3', 'Runner premium', 'SUBMITTED', ['PREMIUM'], '2026-11-14T10:00:00Z', [13]),
        doc('SP-DOC-4', 'Placemats', 'REJECTED', ['STANDARD'], '2026-11-10T10:00:00Z', [14]),
        doc('SP-DOC-5', 'Old launch page', 'APPROVED', [], '2025-03-01T10:00:00Z', [])]
      : [doc('CPC-DOC-1', 'Desk set A+', 'APPROVED', ['STANDARD'], '2026-08-01T10:00:00Z', [1, 2, 3, 4, 5])];
    W[b] = { skus, cat, fyp: {}, aplus: o.aplus && o.aplus[b] ? o.aplus[b] : aplus };
  });
  return W;
}
const tsv = (head, rows) => [head.join('\t')].concat(rows.map(r => r.join('\t'))).join('\n') + '\n';
function reportText(W, b, type) {
  const w = W[b];
  if (type === 'GET_MERCHANT_LISTINGS_ALL_DATA') {
    return tsv(['item-name', 'seller-sku', 'price', 'quantity', 'open-date', 'asin1', 'fulfillment-channel', 'status'],
      Object.keys(w.skus).map(s => { const x = w.skus[s]; return [x.t, s, x.price, x.qty == null ? '' : x.qty, '2025-01-01', x.asin, x.ch, x.status]; }));
  }
  if (type === 'GET_MERCHANTS_LISTINGS_FYP_REPORT') {
    return tsv(['Status', 'Reason', 'SKU', 'ASIN', 'Product name', 'Condition', 'Status Change Date', 'Issue Description'],
      Object.keys(w.fyp).map(s => ['Suppressed', w.fyp[s][0], s, w.skus[s].asin, w.skus[s].t, 'New', '2026-11-10', w.fyp[s][1]]));
  }
  return tsv(['sku', 'asin', 'product-name', 'afn-fulfillable-quantity', 'available', 'inv-age-0-to-90-days'],
    Object.keys(w.skus).map(s => [s, w.skus[s].asin, w.skus[s].t, w.skus[s].fba, w.skus[s].fba + 5, w.skus[s].fba]));
}
function listingItem(sku, x) {
  const v = s => [{ value: s, marketplace_id: 'ATVPDKIKX0DER' }];
  const at = { item_name: v(x.t), bullet_point: x.bl.map(s => ({ value: s })), product_description: v(x.d), title_differentiation: x.hl.map(s => ({ value: s })),
    generic_keyword: v(x.kw), color: v(x.color), size: v(x.size), parentage_level: v(x.lvl), child_parent_sku_relationship: [{ child_relationship_type: 'variation', parent_sku: x.psku }],
    variation_theme: [{ name: x.theme }] };
  Object.keys(x.img).forEach(k => { at[k] = [{ media_location: x.img[k] }]; });
  return { sku, summaries: [{ asin: x.asin, status: x.as, productType: x.pt, itemName: x.t, lastUpdatedDate: x.upd, createdDate: '2025-01-01T00:00:00Z' }], attributes: at,
    issues: x.iss.map(i => Object.assign({ code: i.c, severity: i.s, message: i.m, attributeNames: i.a || [] }, i.e ? { enforcements: { actions: i.e.map(a => ({ action: a })), exemption: { status: 'NOT_EXEMPT' } } } : {})) };
}
function catalogItem(asin, c) {
  const rel = c.kids ? [{ type: 'VARIATION', childAsins: c.kids, variationTheme: { theme: c.theme, attributes: c.tattrs } }] : [{ type: 'VARIATION', parentAsins: c.pa }];
  const attrs = {};
  Object.keys(c.vals || {}).forEach(k => { attrs[k] = [{ value: c.vals[k] }]; });
  return { asin, summaries: [{ itemName: c.t, brand: 'Ridhi', browseClassification: { displayName: 'Tablecloths', classificationId: '1' } }],
    images: [{ images: Object.keys(c.img).map(v => ({ variant: v, link: c.img[v].link, width: c.img[v].w, height: c.img[v].h })).concat(Object.keys(c.img).map(v => ({ variant: v, link: c.img[v].link + '?small', width: 75, height: 75 }))) }],
    relationships: [{ marketplaceId: 'ATVPDKIKX0DER', relationships: rel }], attributes: attrs,
    classifications: [{ classifications: [{ displayName: 'Tablecloths', classificationId: '1', parent: { displayName: 'Kitchen & Table Linens', classificationId: '20', parent: { displayName: 'Home & Kitchen', classificationId: '300' } } }] }],
    salesRanks: [{ displayGroupRanks: [{ rank: 13206, title: 'Home & Kitchen', websiteDisplayGroup: 'home_garden_display_on_website' }],
      classificationRanks: [{ rank: 2400, title: 'Kitchen & Table Linens', classificationId: '20' }, { rank: 109, title: 'Tablecloths', classificationId: '1' }] }] };
}

/* ---------- one Apps Script project in a vm ---------- */
function setup(o) {
  o = o || {};
  const W = o.W || world(o);
  const props = Object.assign({ API_KEY: 'K', CACHE_SHEET_ID: 'CACHE', SP_SELLER_ID: 'SELLER-SP', CPC_SELLER_ID: 'SELLER-CPC' }, o.noBook ? {} : { LM_CACHE_ID: 'LMBOOK' }, o.props || {});
  // two spreadsheets: the nightly cache (with a tab of its own) and "Sellora Listing Cache"
  // a fake clock for the tick budget: o.msPerCall per SP-API call, Utilities.sleep and o.msPerWrite per sheet write move it on
  let skew = 0;
  const books = new Map(), created = [];
  const log = [], calls = [], triggers = [];
  let repN = 0;
  const reps = {};
  const sheet = name => {
    const s = { name, rows: [] };
    s.api = {
      getName: () => name, clear: () => { s.rows = []; },
      getLastRow: () => s.rows.length, getMaxRows: () => Math.max(1, s.rows.length), getMaxColumns: () => 1, deleteColumns() {}, deleteRows() {},
      getRange: (r, c, n) => ({
        setValues: v => { if (o.failWrite && o.failWrite(name)) throw new Error('Service Spreadsheets failed'); if (o.msPerWrite) skew += o.msPerWrite; s.rows = v.map(x => x[0]); },
        getValues: () => s.rows.slice(r - 1, r - 1 + n).map(x => [x]),
        setValue: v => { s.rows[r - 1] = v; },
      }),
    };
    return s;
  };
  const book = (id, name) => {
    const sheets = new Map();
    const SS = {
      getId: () => id, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id + '/edit', getName: () => name,
      getSheetByName: n => (sheets.has(n) ? sheets.get(n).api : null),
      insertSheet: n => { const s = sheet(n); sheets.set(n, s); return s.api; },
      deleteSheet: api => { sheets.delete(api.getName()); },
      getSheets: () => [...sheets.values()].map(s => s.api),
    };
    books.set(id, { id, name, sheets, SS });
    return SS;
  };
  book('CACHE', 'Amazon Research — nightly cache').insertSheet('matchBiz').getRange(1, 1, 1, 1).setValues([["'{\"d\":{\"SP\":{\"2026-11-01\":[1]}}}"]]);
  if (!o.noBook) book('LMBOOK', 'Sellora Listing Cache');
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)),
    getBlob: () => ({ setContentType() { return this; }, getDataAsString: () => (typeof body === 'string' ? body : JSON.stringify(body)) }) });
  let ctx;
  const brand = () => ctx.ACTIVE_PREFIX;
  const fetch = (url, opt) => {
    opt = opt || {};
    if (o.msPerCall) skew += o.msPerCall;
    const u = new URL(url), q = u.searchParams, p = u.pathname;
    const b = brand();
    calls.push({ b, p, q: Object.fromEntries(q), m: opt.method || 'get' });
    if (o.netFail && o.netFail(calls[calls.length - 1], calls.length)) throw new Error('Address unavailable: ' + p);
    if (u.host === 'dl') return resp(200, reportText(W, reps[p.slice(1)].b, reps[p.slice(1)].type));
    if (p === '/reports/2021-06-30/reports' && opt.method === 'post') {
      const type = JSON.parse(opt.payload).reportType, id = 'R' + (++repN);
      reps[id] = { b, type, polls: 0 };
      return resp(202, { reportId: id });
    }
    let m;
    if ((m = p.match(/^\/reports\/2021-06-30\/reports\/(.+)$/))) {
      const r = reps[decodeURIComponent(m[1])];
      r.polls++;
      const s = o.repStatus ? o.repStatus(r.type, r.b, r.polls) : 'DONE';
      return resp(200, { processingStatus: s, reportDocumentId: 'D' + decodeURIComponent(m[1]) });
    }
    if ((m = p.match(/^\/reports\/2021-06-30\/documents\/D(.+)$/))) return resp(200, { url: 'https://dl/' + decodeURIComponent(m[1]) });
    const w = W[b];
    if ((m = p.match(/^\/listings\/2021-08-01\/items\/[^/]+\/(.+)$/))) {               // getListingsItem
      const sku = decodeURIComponent(m[1]);
      return w.skus[sku] ? resp(200, listingItem(sku, w.skus[sku])) : resp(404, { errors: [{ code: 'NOT_FOUND', message: 'no' }] });
    }
    if (/^\/listings\/2021-08-01\/items\/[^/]+$/.test(p)) {                              // searchListingsItems
      if (o.listFail && o.listFail(calls[calls.length - 1])) return resp(500, { errors: [{ code: 'InternalFailure', message: 'boom' }] });
      if (q.get('lastUpdatedAfter')) {
        if (o.noUpdatedAfter) return resp(400, { errors: [{ code: 'InvalidInput', message: 'lastUpdatedAfter' }] });
        const since = Date.parse(q.get('lastUpdatedAfter'));
        const ch = Object.keys(w.skus).filter(s => Date.parse(w.skus[s].upd) > since).sort((x, y) => Date.parse(w.skus[x].upd) - Date.parse(w.skus[y].upd));
        const start = Number(q.get('pageToken') || 0), page = ch.slice(start, start + 20);
        return resp(200, { numberOfResults: ch.length, items: page.map(s => listingItem(s, w.skus[s])), pagination: start + 20 < ch.length ? { nextToken: String(start + 20) } : {} });
      }
      const ids = (q.get('identifiers') || '').split(',').map(decodeURIComponent);
      const hide = o.hide || [];
      return resp(200, { numberOfResults: ids.length, items: ids.filter(s => w.skus[s] && !hide.includes(s)).map(s => listingItem(s, w.skus[s])) });
    }
    if (p === '/catalog/2022-04-01/items') {
      if (o.catFail && o.catFail(calls[calls.length - 1])) return resp(500, { errors: [{ code: 'InternalFailure', message: 'boom' }] });
      const ids = (q.get('identifiers') || '').split(',');
      return resp(200, { items: ids.filter(a => w.cat[a]).map(a => catalogItem(a, w.cat[a])) });
    }
    if (p.indexOf('/aplus/2020-11-01/') === 0) {
      const call = calls[calls.length - 1];
      if (o.aplusFail && o.aplusFail(call, calls.length)) return resp(o.aplusFailCode || 500, { errors: [{ code: 'InternalFailure', message: 'boom' }] });
      const docs = w.aplus || [];
      if (p === '/aplus/2020-11-01/contentDocuments') {                                    // searchContentDocuments
        const size = o.aplusPage || 2, start = Number(q.get('pageToken') || 0), page = docs.slice(start, start + size);
        return resp(200, Object.assign({ contentMetadataRecords: page.map(d => ({ contentReferenceKey: d.k,
          contentMetadata: Object.assign({ name: d.n, marketplaceId: 'ATVPDKIKX0DER', status: d.s, badgeSet: d.bd, updateTime: d.u }, d.rr ? { rejectionReasons: d.rr } : {}) })) },
          start + size < docs.length ? { nextPageToken: String(start + size) } : {}));
      }
      if (p === '/aplus/2020-11-01/contentPublishRecords') {
        const asin = q.get('asin'), on = docs.filter(d => d.s === 'APPROVED' && d.a.includes(asin));
        return resp(200, { publishRecordList: on.map(d => ({ marketplaceId: 'ATVPDKIKX0DER', locale: 'en-US', asin, contentType: 'EBC', contentReferenceKey: d.k })) });
      }
      let am;
      if ((am = p.match(/^\/aplus\/2020-11-01\/contentDocuments\/([^/]+)\/asins$/))) {      // listContentDocumentAsinRelations
        const d = docs.find(x => x.k === decodeURIComponent(am[1]));
        if (!d) return resp(404, { errors: [{ code: 'NotFound', message: 'no such document' }] });
        const size = o.aplusAsinPage || 4, start = Number(q.get('pageToken') || 0), page = d.a.slice(start, start + size);
        return resp(200, Object.assign({ asinMetadataSet: page.map(a => ({ asin: a })) }, start + size < d.a.length ? { nextPageToken: String(start + size) } : {}));
      }
      if ((am = p.match(/^\/aplus\/2020-11-01\/contentDocuments\/([^/]+)$/))) {               // getContentDocument
        const d = docs.find(x => x.k === decodeURIComponent(am[1]));
        if (!d) return resp(404, { errors: [{ code: 'NotFound', message: 'no such document' }] });
        return resp(200, { contentRecord: { contentReferenceKey: d.k, contentMetadata: { name: d.n, marketplaceId: 'ATVPDKIKX0DER', status: d.s, badgeSet: d.bd, updateTime: d.u },
          contentDocument: { name: d.n, contentType: 'EBC', locale: 'en-US', contentModuleList: [
            { contentModuleType: 'STANDARD_HEADER_IMAGE_TEXT', standardHeaderImageText: { headline: { value: 'Made by hand' }, block: { image: { uploadDestinationId: 'aplus-media/sc/abc.jpg', altText: 'A table' },
              headline: { value: 'Block printed cotton' }, body: { textList: [{ value: 'Printed by hand in Jaipur.' }] } } } },
            { contentModuleType: 'STANDARD_FOUR_IMAGE_TEXT', standardFourImageText: { block1: { image: { uploadDestinationId: 'aplus-media/sc/one.jpg' }, headline: { value: 'Soft' } } } }] } } });
      }
    }
    if (p === '/fba/inventory/v1/summaries') {
      const sku = q.get('sellerSkus');
      return resp(200, { payload: { inventorySummaries: w.skus[sku] ? [{ sellerSku: sku, inventoryDetails: { fulfillableQuantity: w.skus[sku].fbaLive != null ? w.skus[sku].fbaLive : w.skus[sku].fba } }] : [] } });
    }
    throw new Error('unexpected fetch ' + url);
  };
  ctx = {
    UrlFetchApp: { fetch },
    SpreadsheetApp: {
      openById: id => { if (o.badBook && id === props.LM_CACHE_ID) throw new Error('Document is missing'); if (!books.has(id)) throw new Error('Document ' + id + ' is missing'); return books.get(id).SS; },
      create: name => { const id = 'NEW' + (created.length + 1); created.push(name); return book(id, name); },
    },
    ContentService: { createTextOutput: t => ({ setMimeType() { return this; }, text: t }), MimeType: { JSON: 'json' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; }, getProperties: () => props }) },
    CacheService: { getScriptCache: () => ({ get: () => 'tok', put() {} }) },
    Utilities: { sleep: ms => { if (o.msPerCall) skew += ms; }, formatDate: fmt, ungzip: b => b },
    Session: { getScriptTimeZone: () => o.tz || tzAt(o.hour == null ? 13 : o.hour, o.min == null ? 5 : o.min), getEffectiveUser: () => ({ getEmail: () => (o.mail != null ? o.mail : 'ops@workspace.example') }) },
    ScriptApp: { getProjectTriggers: () => triggers, deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: h => ({ timeBased: () => ({ everyMinutes: m => ({ create: () => triggers.push({ getHandlerFunction: () => h, m }) }) }) }) },
    Logger: { log: s => log.push(String(s)) }, console,
  };
  ctx.__skew = () => skew;
  ctx.Date = class extends FakeDate {};         // the .gs code reads the fixed clock too (its own class: the tick-budget skew below stays this setup's)
  vm.createContext(ctx);
  if (o.msPerCall) vm.runInContext('(function () { var real = Date.now; Date.now = function () { return real() + __skew(); }; })();', ctx);
  vm.runInContext(SRC, ctx);
  if (o.tune) vm.runInContext(o.tune, ctx);
  const read = n => vm.runInContext('lmGet_(' + JSON.stringify(n) + ')', ctx);
  const run = s => vm.runInContext(s, ctx);
  const state = () => JSON.parse(props.LM_STATE || '{}');
  const allItems = (kind, b) => {
    const meta = read('lmMeta'), out = {}, dup = [];
    ((meta.parts[kind] || {})[b] || []).forEach(t => { const p = read(t); Object.keys(p.items).forEach(k => { if (out[k]) dup.push(k); out[k] = p.items[k]; }); });
    return { items: out, dup };
  };
  // ticks until the full pass is done (a 13:00 tick starts it)
  const aplusOn = () => vm.runInContext('(function () { var st = lmState_(), now = new Date(), tz = Session.getScriptTimeZone(); var today = Utilities.formatDate(now, tz, "yyyy-MM-dd");'
    + ' var mins = Number(Utilities.formatDate(now, tz, "H")) * 60 + Number(Utilities.formatDate(now, tz, "mm")); return !!st.ap || lmAplusDue_(st, today, mins); })()', ctx);
  let aplusTicks = 0;
  const aplusRead = (max) => { let n = 0; while (!state().run && aplusOn() && n < (max || 30)) { run('lmTick()'); n++; } aplusTicks += n; return n; };
  const fullPass = (max) => { let n = 0; do { run('lmTick()'); n++; } while (state().run && n < (max || 60)); if (!o.noAplusAfter) aplusRead(); return n; };
  const get = q => JSON.parse(vm.runInContext('doGet({ parameter: ' + JSON.stringify(Object.assign({ key: 'K' }, q)) + ' }).text', ctx));
  return { W, props, get sheets() { const b = books.get(props.LM_CACHE_ID); return b ? b.sheets : new Map(); }, books, created, log, calls, triggers, reps, ctx, read, run, state, allItems, fullPass, aplusRead, get aplusTicks() { return aplusTicks; }, get,
    setHour: h => { o.tz = null; o.hour = h; }, setTime: (h, m) => { o.tz = null; o.hour = h; o.min = m; }, opts: o };
}
const tabs = T => [...T.sheets.keys()];

(async () => {
  console.log('== setup and the first full pass ==');
  {
    const T = setup({ hour: 10, noBook: true });
    const cacheBefore = JSON.stringify([...T.books.get('CACHE').sheets.values()].map(x => [x.name, x.rows]));
    T.run('lmTick()');
    ok('a tick before lmSetup: nothing is asked of Amazon, nothing written, it says to run lmSetup', !T.calls.length && !T.created.length && T.log.some(l => /run lmSetup\(\) once/.test(l)));
    T.run('lmSetup()');
    ok('lmSetup: creates the spreadsheet "Sellora Listing Cache" and keeps its id in Script Property LM_CACHE_ID (not in the code)',
      T.created.join() === 'Sellora Listing Cache' && T.props.LM_CACHE_ID === 'NEW1' && T.log.some(l => /Created the spreadsheet "Sellora Listing Cache": https:\/\/docs\.google\.com\/spreadsheets\/d\/NEW1/.test(l)));
    ok('…checks it can be written (probe written and removed), lmTick every 10 minutes, a full pass asked for',
      T.triggers.length === 1 && T.triggers[0].getHandlerFunction() === 'lmTick' && T.triggers[0].m === 10 && !T.sheets.has('lmProbe') && T.state().reset === true);
    T.run('lmSetup()');
    ok('…run twice: the same spreadsheet (no second one), still one timer', T.created.length === 1 && T.props.LM_CACHE_ID === 'NEW1' && T.triggers.length === 1 && T.log.some(l => /^Using the spreadsheet/.test(l)));
    const ticks = T.fullPass();
    const meta = T.read('lmMeta');
    ok('the full pass finishes (' + ticks + ' tick(s)) and lmMeta names the parts per brand', !T.state().run && meta.kind === 'full' && meta.parts.listings.SP.length >= 1 && meta.parts.catalog.CPC.length >= 1, JSON.stringify(meta.parts));
    const sp = T.allItems('listings', 'SP'), cpc = T.allItems('listings', 'CPC');
    ok('every SKU of the All Listings report is in lmListings, once (Ridhi 47, CPC 23)', Object.keys(sp.items).length === 47 && Object.keys(cpc.items).length === 23 && !sp.dup.length && !cpc.dup.length);
    const r = sp.items['RTC14-3'];
    ok('a record: report facts (status, price, channel), Amazon status, product type, title, bullets, description, highlights, search terms',
      r.rs === 'Active' && r.price === 23 && r.ch === 'AMAZON_NA' && r.as === 'BUYABLE,DISCOVERABLE' && r.pt === 'TABLECLOTH' && r.t === 'Title RTC14-3'
      && r.bl.length === 2 && r.d === 'Description RTC14-3' && r.hl[0] === 'Cotton' && r.kw === 'table cloth', JSON.stringify(r));
    ok('…variation attributes, parentage, our picture slots, stock from the FBA report, read times', r.va.color === 'Color3' && r.va.size === '60x90' && r.lvl === 'child' && r.psku === 'PARENT-SP'
      && r.theme === 'SIZE/COLOR' && /RTC14-3-main/.test(r.img.MAIN) && r.fba === 6 && r.readAt > 0 && r.rAt > 0);
    ok('…an Inactive listing keeps Amazon\'s word', sp.items['RTC14-9'].rs === 'Inactive');
    const cat = T.allItems('catalog', 'SP').items;
    const c = cat[A('SP', 3)], par = cat.B0SPPARENT;
    ok('lmCatalog: shown title, the largest picture with width/height, parent, values, browse path, both sales ranks, A+ not read',
      c.t === 'Shown RTC14-3' && c.img.MAIN.w === 1500 && c.img.MAIN.h === 1500 && !/small/.test(c.img.MAIN.u) && c.pa[0] === 'B0SPPARENT' && c.vals.color === 'Color3'
      && c.bc === 'Home & Kitchen › Kitchen & Table Linens › Tablecloths' && c.rk.main.r === 13206 && c.rk.sub.r === 109 && c.aplus === null, JSON.stringify(c));
    ok('…the category id of every step of the browse path (bcIds, in the path\'s order), and EVERY category rank with its id (rks) — the best one still in rk.sub',
      JSON.stringify(c.bcIds) === '["300","20","1"]' && JSON.stringify(c.rks) === JSON.stringify([{ id: '20', c: 'Kitchen & Table Linens', r: 2400 }, { id: '1', c: 'Tablecloths', r: 109 }])
      && c.rk.sub.id === '1' && c.rk.sub.c === 'Tablecloths' && !('id' in c.rk.main), JSON.stringify([c.bcIds, c.rks, c.rk]));
    ok('…the parent (named by its children, read in the same pass): theme and its attributes, children', par && par.theme === 'SIZE/COLOR' && par.tattrs.join() === 'size,color' && par.kids.length === 47);
    ok('scratch tabs are gone at the end', !tabs(T).some(n => /^lmScr_/.test(n)), tabs(T).join());
    ok('lmMeta counts per brand (status, suppressed, stock)', meta.counts.SP.skus === 47 && meta.counts.SP.status.Active === 42 && meta.counts.SP.status.Inactive === 5 && meta.counts.SP.fba === 47);
    const listCalls = T.calls.filter(x => /^\/listings\/2021-08-01\/items\/[^/]+$/.test(x.p));
    ok('Listings Items: 20 SKUs a call, each SKU asked once (3 + 2 calls)', listCalls.length === 5 && listCalls.every(x => x.q.identifiersType === 'SKU' && x.q.pageSize === '20' && x.q.includedData === 'summaries,attributes,issues'));
    const catCalls = T.calls.filter(x => x.p === '/catalog/2022-04-01/items');
    ok('Catalog Items: 20 ASINs a call with every part asked for', catCalls.every(x => x.q.identifiers.split(',').length <= 20 && x.q.includedData === 'summaries,images,relationships,attributes,classifications,salesRanks'));
    ok('reports: All Listings, Suppressed and the FBA stock report Listing Health already uses, per brand',
      Object.values(T.reps).map(r => r.b + ':' + r.type).sort().join() === ['CPC:GET_FBA_INVENTORY_PLANNING_DATA', 'CPC:GET_MERCHANTS_LISTINGS_FYP_REPORT', 'CPC:GET_MERCHANT_LISTINGS_ALL_DATA',
        'SP:GET_FBA_INVENTORY_PLANNING_DATA', 'SP:GET_MERCHANTS_LISTINGS_FYP_REPORT', 'SP:GET_MERCHANT_LISTINGS_ALL_DATA'].join());
    ok('no lock: the lease is our own and released', T.props.LM_LEASE === undefined);
    ok('every lm tab is in "Sellora Listing Cache"; the nightly cache spreadsheet is exactly as it was', tabs(T).includes('lmMeta') && tabs(T).some(n => /^lmListings_SP_/.test(n))
      && JSON.stringify([...T.books.get('CACHE').sheets.values()].map(x => [x.name, x.rows])) === cacheBefore);
    const g = T.get({ cache: 'lmMeta' }), g2 = T.get({ cache: 'matchBiz' }), g3 = T.get({ cache: meta.parts.listings.SP[0] });
    ok('Code.gs ?cache=lmMeta and ?cache=lmListings_… read "Sellora Listing Cache"', g.ok && g.data.kind === 'full' && g3.ok && g3.data.items['RTC14-1'] !== undefined === (T.run('lmHash_("RTC14-1")') % meta.parts.listings.SP.length === 0), JSON.stringify(g).slice(0, 120));
    ok('…every other ?cache= tab works exactly as before (matchBiz from the nightly cache)', g2.ok && g2.data.d.SP['2026-11-01'][0] === 1);
    ok('…an lm tab that does not exist: the usual "nothing cached" answer', T.get({ cache: 'lmCatalog_SP_9_9' }).error === 'nothing cached for "lmCatalog_SP_9_9" yet');
    const N = setup({ noBook: true });
    ok('…before lmSetup has ever run: ?cache=lmMeta says nothing is cached (no spreadsheet is created by a read)', N.get({ cache: 'lmMeta' }).error === 'nothing cached for "lmMeta" yet' && !N.created.length);
    const Bd = setup({ hour: 13, badBook: true });
    Bd.run('lmSetup()');
    ok('a "Sellora Listing Cache" that will not open: lmSetup says so and never makes a new one, installs nothing', !Bd.created.length && !Bd.triggers.length && Bd.log.some(l => /cannot use the "Sellora Listing Cache"/.test(l)));
    Bd.run('lmTick()');
    ok('…and a tick asks Amazon nothing, the error is in the state', !Bd.calls.length && Bd.state().errors.some(e => /will not open/.test(e)));
  }

  console.log('== batching and resume ==');
  {
    // tiny scratch tabs: a full one is written and the reading goes on in the SAME tick (it used to end the tick)
    const S = setup({ hour: 13, tune: 'LM_SCR_MAX = 3000;' });
    const sTicks = S.fullPass();
    const sp1 = S.allItems('listings', 'SP');
    ok('a full scratch buffer is written and the tick reads on: the whole pass in ' + sTicks + ' tick, every SKU once', sTicks === 1 && Object.keys(sp1.items).length === 47 && !sp1.dup.length);
    // a slow Amazon (a minute a call on a fake clock): every tick stops at its time budget; one call dies on the network
    const T = setup({ hour: 13, msPerCall: 60000, netFail: (c, n) => c.p.indexOf('/listings/') === 0 && c.q.identifiers && c.q.identifiers.split(',')[0] === 'RTC14-28' && !global.__died && (global.__died = 1) });
    const ticks = T.fullPass();
    const sp = T.allItems('listings', 'SP');
    ok('many ticks (' + ticks + '), each carrying on where the last stopped: every SKU once', ticks >= 4 && Object.keys(sp.items).length === 47 && !sp.dup.length);
    const asked = {};
    T.calls.filter(x => /^\/listings\/2021-08-01\/items\/[^/]+$/.test(x.p) && x.b === 'SP').forEach(x => x.q.identifiers.split(',').forEach(s => { asked[s] = (asked[s] || 0) + 1; }));
    ok('a call that died is asked again on the next tick; nothing else is read twice', asked['RTC14-28'] === 2 && Object.keys(asked).filter(s => asked[s] > 1).length === 20, JSON.stringify(asked));
    ok('…and its error is in the state, plain', (T.state().errors || []).some(e => /Listings page at RTC14-28/.test(e)));
    ok('the state stays small (Script Property limit 9 KB)', T.props.LM_STATE.length < 9000);
    const busy = setup({ hour: 13 });
    busy.props.LM_LEASE = String(Date.now());
    busy.run('lmTick()');
    ok('another tick still running (lease under 7 minutes): skipped', !busy.state().run && busy.log.some(l => /skipped/.test(l)));
  }

  console.log('== suppressed: only from the report, or Buyable without Discoverable ==');
  {
    const W = world();
    W.SP.fyp['RTC14-4'] = ['Missing information', 'The main image is missing'];
    W.SP.skus['RTC14-5'].as = ['BUYABLE'];
    W.SP.skus['RTC14-6'].iss = [{ c: '18320', s: 'ERROR', m: 'The main image is missing or incorrect', a: ['main_product_image_locator'] }];
    W.SP.skus['RTC14-9'].status = 'Inactive';
    const T = setup({ W, hour: 13 });
    T.fullPass();
    const it = T.allItems('listings', 'SP').items;
    ok('in the Suppressed report: suppressed, with Amazon\'s reason', it['RTC14-4'].sup && it['RTC14-4'].sup.src === 'report' && /Missing information — The main image is missing/.test(it['RTC14-4'].sup.why));
    ok('status BUYABLE without DISCOVERABLE: suppressed (by status)', it['RTC14-5'].sup && it['RTC14-5'].sup.src === 'status');
    ok('an ERROR issue alone is NOT "suppressed" (the issue is kept as Amazon wrote it)', it['RTC14-6'].sup === null && it['RTC14-6'].iss[0].c === '18320' && it['RTC14-6'].iss[0].s === 'ERROR' && it['RTC14-6'].iss[0].a[0] === 'main_product_image_locator');
    ok('Inactive is not "suppressed"', it['RTC14-9'].sup === null);
    const c = T.read('lmMeta').counts.SP;
    ok('lmMeta counts them apart: 1 by report, 1 by status', c.supReport === 1 && c.supStatus === 1);
    const E = setup({ hour: 13, repStatus: (type, b) => (type === 'GET_MERCHANTS_LISTINGS_FYP_REPORT' ? 'CANCELLED' : 'DONE') });
    E.fullPass();
    ok('a Suppressed report CANCELLED by Amazon ("no data") means none suppressed — the pass goes on', E.read('lmMeta').counts.SP.supReport === 0 && E.read('lmMeta').lastFull.brands.length === 2);
  }

  console.log('== enforcement action names and the Suppressed-report flag (rules b and c) ==');
  {
    const W = world();
    W.SP.skus['RTC14-11'].iss = [{ c: '5665', s: 'ERROR', m: 'Removed from search: prohibited keyword', a: ['generic_keyword'], e: ['SEARCH_SUPPRESSED'] }];
    W.SP.skus['RTC14-12'].iss = [{ c: '99300', s: 'WARNING', m: 'The colour value is hidden', a: ['color'], e: ['ATTRIBUTE_SUPPRESSED'] }];
    W.SP.skus['RTC14-13'].iss = [{ c: '8541', s: 'ERROR', m: 'The swatch image is missing; the listing may be suppressed', a: ['swatch_product_image_locator'] }];
    W.SP.fyp['RTC14-14'] = ['Missing information', 'no main image'];
    const T = setup({ W, hour: 13 });
    T.fullPass();
    const it = T.allItems('listings', 'SP').items;
    ok('lmListings keeps each issue\'s enforcement action names (e), only where Amazon names some', JSON.stringify(it['RTC14-11'].iss[0].e) === '["SEARCH_SUPPRESSED"]'
      && JSON.stringify(it['RTC14-12'].iss[0].e) === '["ATTRIBUTE_SUPPRESSED"]' && it['RTC14-13'].iss[0].e === undefined);
    ok('b) SEARCH_SUPPRESSED → suppressed (by enforcement), even while BUYABLE + DISCOVERABLE', it['RTC14-11'].sup && it['RTC14-11'].sup.src === 'enforcement' && /^SEARCH_SUPPRESSED \(5665\)/.test(it['RTC14-11'].sup.why));
    ok('…ATTRIBUTE_SUPPRESSED is not one of the two: not suppressed; an ERROR alone: not suppressed', it['RTC14-12'].sup === null && it['RTC14-13'].sup === null);
    ok('c) the Suppressed-report flag per SKU: inSupReport true for the SKU in the report, false for the others', it['RTC14-14'].inSupReport === true && it['RTC14-14'].sup.src === 'report'
      && it['RTC14-1'].inSupReport === false && it['RTC14-11'].inSupReport === false);
    const c = T.read('lmMeta').counts.SP;
    ok('lmMeta counts: suppressed by report 1 (Amazon\'s own count), by enforcement 1', c.supReport === 1 && c.supEnforced === 1, JSON.stringify(c));
    ok('the live read (?lfix=get): lfixIssue_ passes the action names (acts) and keeps the old yes/no flag (enforced)',
      JSON.stringify(T.run('lfixIssue_({ severity: "ERROR", code: "5665", message: "m", attributeNames: ["a"], enforcements: { actions: [{ action: "SEARCH_SUPPRESSED" }, { action: "LISTING_SUPPRESSED" }] } })'))
        === JSON.stringify({ severity: 'ERROR', code: '5665', message: 'm', attrs: ['a'], cats: [], enforced: true, acts: ['SEARCH_SUPPRESSED', 'LISTING_SUPPRESSED'] })
      && JSON.stringify(T.run('lfixIssue_({ severity: "ERROR", code: "8541", message: "m" })')) === JSON.stringify({ severity: 'ERROR', code: '8541', message: 'm', attrs: [], cats: [], enforced: false, acts: [] }));
    const sh = T.run('limgShape_(' + JSON.stringify({ sku: 'X', summaries: [{ asin: 'B0X', status: ['BUYABLE', 'DISCOVERABLE'] }], attributes: {},
      issues: [{ severity: 'ERROR', code: '5665', message: 'm', attributeNames: [], enforcements: { actions: [{ action: 'SEARCH_SUPPRESSED' }] } }, { severity: 'WARNING', code: '1', message: 'w' }] }) + ')');
    ok('the saved list snapshot (?limg=page): each issue keeps e = the action names, nothing added when there are none', JSON.stringify(sh.iss[0].e) === '["SEARCH_SUPPRESSED"]' && !('e' in sh.iss[1])
      && sh.iss[0].c === '5665' && sh.ie === 1);
    const li = T.run('lmItem_(' + JSON.stringify({ sku: 'S1', summaries: [{ asin: 'B0S1', status: ['BUYABLE'] }], issues: [], attributes: { material: [{ value: 'Cotton', marketplace_id: 'ATVPDKIKX0DER' }],
      care_instructions: [{ value: '', marketplace_id: 'ATVPDKIKX0DER' }], theme: [{ marketplace_id: 'ATVPDKIKX0DER', language_tag: 'en_US' }], item_shape: [{ value: 'Square' }], bullet_point: [{ value: 'b' }] } }) + ', 1)');
    ok('lmListings: sp = the Workspace\'s spec attributes that are filled (an empty value, or only the marketplace / language tags, is not filled)', JSON.stringify(li.sp) === '["material","item_shape"]', JSON.stringify(li.sp));
  }

  console.log('== a failed read never wipes data ==');
  {
    const T = setup({ hour: 13 });
    T.fullPass();
    const before = T.allItems('listings', 'SP').items;
    const metaBefore = T.read('lmMeta');
    // the next pass: the listings call for RTC14-21… fails every time, the stock report fails, one SKU disappears from Amazon's answer
    T.W.SP.skus['RTC14-1'].t = 'New title';
    T.opts.listFail = c => c.b === 'SP' && c.q.identifiers && c.q.identifiers.split(',')[0] === 'RTC14-28';
    T.opts.repStatus = (type, b) => (type === 'GET_FBA_INVENTORY_PLANNING_DATA' && b === 'SP' ? 'FATAL' : 'DONE');
    T.opts.hide = ['RTC14-2'];
    T.setHour(18);
    T.fullPass();
    const after = T.allItems('listings', 'SP').items;
    ok('a page that failed ' + 3 + ' times: those 20 SKUs keep their last good record (stale, old read time)', ['RTC14-28', 'RTC14-30', 'RTC14-45'].every(s => after[s] && after[s].stale === 1 && after[s].readAt === before[s].readAt && after[s].t === before[s].t));
    ok('…the rest is fresh', after['RTC14-1'].t === 'New title' && !after['RTC14-1'].stale);
    ok('a SKU Amazon did not return this time: kept, not removed', after['RTC14-2'] && after['RTC14-2'].stale === 1 && after['RTC14-2'].t === 'Title RTC14-2');
    ok('the stock report failed 3 times: stock kept from the last read (fbaStale), never 0', after['RTC14-3'].fba === 6 && after['RTC14-3'].fbaStale === 1);
    ok('…the errors say so, plainly', T.state().errors.some(e => /FBA stock report/.test(e)) && T.state().errors.some(e => /gave up on 20 listings from RTC14-28/.test(e)), JSON.stringify(T.state().errors));
    // an All Listings report with no rows: that brand is dropped whole
    const Z = setup({ hour: 13 });
    Z.fullPass();
    const zBefore = JSON.stringify(Z.allItems('listings', 'CPC').items);
    Object.keys(Z.W.CPC.skus).forEach(s => { Z.W.CPC.skus[s].hidden = 1; });
    const keep = Z.W.CPC.skus; Z.W.CPC.skus = {};
    Z.setHour(18);
    Z.fullPass();
    Z.W.CPC.skus = keep;
    ok('an All Listings report with no rows is a failure: that brand\'s data is untouched', JSON.stringify(Z.allItems('listings', 'CPC').items) === zBefore && Z.read('lmMeta').lastFull.gaveUp.join() === 'CPC');
    ok('…the other brand still refreshed', Z.read('lmMeta').lastFull.brands.join() === 'SP');
    // a cache write that fails: nothing is counted as read
    const F = setup({ hour: 13, failWrite: n => /^lmScr_SP_L_/.test(n) && !global.__wf && (global.__wf = 1) });
    F.fullPass();
    ok('a scratch write that failed: those listings are read again, nothing lost', Object.keys(F.allItems('listings', 'SP').items).length === 47 && F.state().errors.some(e => /could not write the cache sheet/.test(e)));
    ok('a light pass before any full pass changes nothing', (() => { const L = setup({ hour: 10 }); L.run('lmTick()'); return !L.read('lmMeta'); })());
  }

  console.log('== chunked cache write ==');
  {
    const T = setup({ hour: 13, longText: 1900, tune: 'LM_PART_MAX = 40000; LM_PART_SKUS = 25;' });
    T.fullPass();
    const meta = T.read('lmMeta');
    const sizes = meta.parts.listings.SP.map(t => JSON.stringify(T.read(t)).length);
    ok('a part past LM_PART_MAX: the brand is laid out in twice the parts (' + meta.parts.listings.SP.length + '), every part under the limit', meta.parts.listings.SP.length >= 4 && sizes.every(s => s <= 40000), sizes.join());
    const sp = T.allItems('listings', 'SP');
    ok('…still every SKU once', Object.keys(sp.items).length === 47 && !sp.dup.length);
    T.log.length = 0; T.run('lmStatus()');
    const SL = T.log.join('\n');
    ok('lmStatus prints "listings laid out in N parts" as a note, never under "error"', /^note       \[[^\]]+\] Ridhi: listings laid out in \d+ parts$/m.test(SL) && /^last pass  note: \[[^\]]+\] Ridhi: listings laid out/m.test(SL)
      && !/^error .*laid out/m.test(SL) && !/^last pass  \[.*laid out/m.test(SL), SL);
    const old = T.state(); old.errors = (old.errors || []).concat(['[2026-11-16 17:20] Ridhi: listings laid out in 32 parts']); T.props.LM_STATE = JSON.stringify(old);
    T.log.length = 0; T.run('lmStatus()');
    ok('…also a line an older version filed under errors', /^note       \[2026-11-16 17:20\] Ridhi: listings laid out in 32 parts$/m.test(T.log.join('\n')));
    ok('…no tab of the too-small layout is left behind', tabs(T).filter(n => /^lmListings_SP_/.test(n)).sort().join() === meta.parts.listings.SP.slice().sort().join(), tabs(T).filter(n => /^lmListings_SP_/.test(n)).join());
    const C = setup({ hour: 13, longText: 1900, tune: 'LM_PART_MAX = 200000;' });
    C.fullPass();
    const big = C.read('lmMeta').parts.listings.SP.map(n => C.sheets.get(n));
    ok('…a part bigger than one cell spans several rows (cacheWrite_ cuts at 40,000 characters) and reads back whole', big.some(s => s.rows.length > 1) && Object.keys(C.allItems('listings', 'SP').items).length === 47, big.map(s => s.rows.length).join());
    ok('a SKU\'s part is lmHash_(sku) % parts (the same sum for Sellora)', meta.hash === 'h31' && meta.parts.listings.SP.every((t, i) => Object.keys(T.read(t).items).every(s => T.run('lmHash_(' + JSON.stringify(s) + ')') % meta.parts.listings.SP.length === i)));
    // more listings later: the old layout's tabs are dropped only after lmMeta names the new ones
    for (let i = 48; i <= 140; i++) {
      const sku = 'RTC14-' + i;
      T.W.SP.skus[sku] = Object.assign({}, T.W.SP.skus['RTC14-1'], { asin: A('SP', i), t: 'Title ' + sku });
      T.W.SP.cat[A('SP', i)] = Object.assign({}, T.W.SP.cat[A('SP', 1)]);
    }
    const oldTabs = meta.parts.listings.SP.slice();
    T.setHour(18);
    T.fullPass();
    const m2 = T.read('lmMeta');
    ok('a brand that grew gets a bigger layout; its old tabs are gone, the new ones hold all 140', m2.parts.listings.SP.length > oldTabs.length && oldTabs.every(t => !T.sheets.has(t)) && Object.keys(T.allItems('listings', 'SP').items).length === 140);
  }

  console.log('== the light pass ==');
  {
    const T = setup({ hour: 13 });
    T.fullPass();
    const before = T.allItems('listings', 'SP').items;
    const recent = new Date(Date.now() + 60000).toISOString();
    ['RTC14-7', 'RTC14-8', 'RTC14-12'].forEach(s => { T.W.SP.skus[s].upd = recent; T.W.SP.skus[s].t = 'Changed ' + s; });
    T.W.SP.skus['RTC14-8'].as = ['BUYABLE'];
    T.W.SP.cat[A('SP', 7)].t = 'Shown changed';
    T.setHour(15);
    T.calls.length = 0;
    T.run('lmTick()');
    ok('15:00, 0 min after the full pass: no light pass yet (every ' + 15 + ' min)', !T.calls.length);
    const st = T.state(); st.lightAt = Date.now() - 16 * 60000; T.props.LM_STATE = JSON.stringify(st);
    T.run('lmTick()');
    const after = T.allItems('listings', 'SP').items;
    const lc = T.calls.filter(c => /^\/listings\/2021-08-01\/items\/[^/]+$/.test(c.p));
    ok('the light pass asks only for listings changed since the full pass (lastUpdatedAfter, sorted by change time)', lc.length >= 1 && lc.every(c => c.q.lastUpdatedAfter && c.q.sortBy === 'lastUpdatedDate'));
    ok('…the 3 changed listings are updated', ['RTC14-7', 'RTC14-8', 'RTC14-12'].every(s => after[s].t === 'Changed ' + s && after[s].readAt > before[s].readAt));
    ok('…every other listing is left exactly as it was', Object.keys(before).filter(s => !['RTC14-7', 'RTC14-8', 'RTC14-12'].includes(s)).every(s => JSON.stringify(after[s]) === JSON.stringify(before[s])));
    ok('…report facts and stock are kept on an updated listing; suppression follows the new status', after['RTC14-8'].rs === 'Active' && after['RTC14-8'].fba === 16 && after['RTC14-8'].sup && after['RTC14-8'].sup.src === 'status');
    ok('…their catalog entries are read again too', T.allItems('catalog', 'SP').items[A('SP', 7)].t === 'Shown changed');
    ok('…only the parts holding them are rewritten; lmMeta says light', T.read('lmMeta').kind === 'light' && T.read('lmMeta').lastLight.brands.SP.changed === 3);
    T.setHour(8);
    const st2 = T.state(); st2.lightAt = Date.now() - 60 * 60000; T.props.LM_STATE = JSON.stringify(st2);
    T.calls.length = 0;
    T.run('lmTick()');
    ok('08:00: outside 09:00–21:00, no light pass', !T.calls.length);
    // Amazon refuses lastUpdatedAfter: the listings read longest ago instead
    const O = setup({ hour: 13, noUpdatedAfter: 1, tune: 'LM_LIGHT_MAX = 30;' });
    O.fullPass();
    O.setHour(11);
    const s3 = O.state(); s3.lightAt = 0; O.props.LM_STATE = JSON.stringify(s3);
    O.calls.length = 0;
    O.run('lmTick()');
    const byId = O.calls.filter(c => c.b === 'SP' && c.q.identifiersType === 'SKU');
    ok('no lastUpdatedAfter: the oldest-read listings instead (30 here, 200 by default), 20 a call', byId.length === 2 && byId.reduce((n, c) => n + c.q.identifiers.split(',').length, 0) === 30, byId.length);
    // more changed than one light pass reads: the next one carries on
    const M = setup({ hour: 13, tune: 'LM_LIGHT_MAX = 20;' });
    M.fullPass();
    Object.keys(M.W.SP.skus).slice(0, 30).forEach((s, i) => { M.W.SP.skus[s].upd = new Date(Date.now() + (i + 1) * 60000).toISOString(); M.W.SP.skus[s].t = 'Changed'; });
    M.setHour(12);
    const s4 = M.state(); s4.lightAt = 0; M.props.LM_STATE = JSON.stringify(s4);
    M.run('lmTick()');
    let n1 = Object.values(M.allItems('listings', 'SP').items).filter(r => r.t === 'Changed').length;
    const s5 = M.state(); s5.lightAt = 0; M.props.LM_STATE = JSON.stringify(s5);
    M.run('lmTick()');
    const n2 = Object.values(M.allItems('listings', 'SP').items).filter(r => r.t === 'Changed').length;
    ok('more changed than one light pass reads (' + n1 + ' of 30): the next light pass carries on from there', n1 === 20 && n2 === 30, n1 + ' then ' + n2);
  }

  console.log('== the schedule ==');
  {
    const T = setup({ hour: 12 });
    T.run('lmTick()');
    ok('12:00 with no full pass asked for: nothing starts', !T.state().run && !T.calls.length);
    T.setHour(13);
    T.run('lmTick()');
    ok('13:00: the full pass starts by itself', !!T.state().run || !!T.read('lmMeta'));
    T.fullPass();
    T.calls.length = 0;
    T.setHour(14);
    const s = T.state(); s.lightAt = Date.now(); T.props.LM_STATE = JSON.stringify(s);
    T.run('lmTick()');
    ok('14:00: the 13:00 pass is not repeated', !T.state().run && !T.calls.some(c => c.m === 'post'));
    T.setHour(18);
    T.run('lmTick()');
    ok('18:00: the second full pass starts (its reports are asked for)', T.calls.filter(c => c.m === 'post').length === 6);
  }

  console.log('== faster full passes: reports 30 minutes early, reads while waiting, a 5-minute timer ==');
  {
    const T = setup({ hour: 10, repStatus: (type, b, polls) => (polls >= 2 ? 'DONE' : 'IN_PROGRESS') });
    T.run('lmSetup()');
    T.run('lmTick()');
    ok('a full pass starting: the timer becomes every 5 minutes (still one timer)', T.triggers.length === 1 && T.triggers[0].m === 5 && T.props.LM_TIMER_MIN === '5');
    T.fullPass();
    ok('…and back to every 10 minutes when it is done', T.triggers.length === 1 && T.triggers[0].m === 10 && T.props.LM_TIMER_MIN === '10');
    // next: a SKU new on Amazon, one gone; the All Listings report takes 5 polls, the stock report 7
    T.W.SP.skus['RTC14-48'] = Object.assign({}, T.W.SP.skus['RTC14-1'], { asin: A('SP', 48), t: 'Title RTC14-48' });
    T.W.SP.cat[A('SP', 48)] = Object.assign({}, T.W.SP.cat[A('SP', 1)], { t: 'Shown RTC14-48' });
    delete T.W.SP.skus['RTC14-47'];
    T.opts.repStatus = (type, b, polls) => (type === 'GET_MERCHANT_LISTINGS_ALL_DATA' ? (polls >= 5 ? 'DONE' : 'IN_PROGRESS') : type === 'GET_FBA_INVENTORY_PLANNING_DATA' ? (polls >= 7 ? 'DONE' : 'IN_PROGRESS') : 'DONE');
    const reads = () => T.calls.filter(c => /^\/listings\/2021-08-01\/items\/[^/]+$/.test(c.p) || c.p === '/catalog/2022-04-01/items').length;
    const finished = T.read('lmMeta').finishedAt;
    T.setTime(12, 20); T.calls.length = 0; T.run('lmTick()');
    ok('12:20: nothing starts yet', !T.state().run && !T.calls.some(c => c.m === 'post'));
    T.setTime(12, 35); T.calls.length = 0; T.run('lmTick()');
    ok('12:35: the 13:00 pass starts — its 6 reports are asked now, nothing is read before 13:00', !!T.state().run && T.calls.filter(c => c.m === 'post').length === 6 && reads() === 0 && T.state().run.readFrom.slice(11) === '13:00');
    ok('…the timer is every 5 minutes', T.triggers[0].m === 5);
    T.log.length = 0; T.run('lmStatus()');
    ok('…lmStatus says so', /reports asked early; listings are read from 13:00/.test(T.log.join('\n')) && /timer      every 5 minutes/.test(T.log.join('\n')), T.log.join('\n'));
    T.setTime(12, 50); T.calls.length = 0; T.run('lmTick()');
    ok('12:50: the reports are polled, still nothing read', reads() === 0 && T.calls.some(c => /^\/reports\/2021-06-30\/reports\/R/.test(c.p)));
    T.setTime(13, 1); T.calls.length = 0; T.run('lmTick()');
    const x = T.state().run.B.SP;
    ok('13:01: listings AND catalog are read while the All Listings and stock reports are still not ready (SKU list of the last pass)',
      reads() > 0 && T.calls.some(c => c.p === '/catalog/2022-04-01/items') && x.rep.L.st === 'asked' && x.rep.S.st === 'asked' && x.ks === 'cache' && x.ki === 1 && !x.kf, JSON.stringify(x));
    ok('…nothing is written to lmListings before every report is in', T.read('lmMeta').finishedAt === finished && !!T.state().run);
    let n = 0; while (T.state().run && n < 20) { T.run('lmTick()'); n++; }
    const it = T.allItems('listings', 'SP').items, cat = T.allItems('catalog', 'SP').items;
    ok('the pass finishes once the reports are in (' + n + ' more ticks): the new SKU is read (fresh, not "not read"), the gone one has left with its catalog entry',
      !T.state().run && it['RTC14-48'] && !it['RTC14-48'].stale && !it['RTC14-48'].noRead && it['RTC14-48'].t === 'Title RTC14-48' && cat[A('SP', 48)] && cat[A('SP', 48)].t === 'Shown RTC14-48'
      && !it['RTC14-47'] && !cat[A('SP', 47)] && Object.keys(it).length === 47 && !!cat.B0SPPARENT);
    ok('…stock from the stock report that came last; the timer back to 10 minutes', it['RTC14-3'].fba === 6 && !it['RTC14-3'].fbaStale && T.triggers.length === 1 && T.triggers[0].m === 10);
    const asked = {};
    T.calls.filter(c => /^\/listings\/2021-08-01\/items\/[^/]+$/.test(c.p) && c.b === 'SP').forEach(c => c.q.identifiers.split(',').forEach(s => { asked[s] = (asked[s] || 0) + 1; }));
    ok('…no SKU was read twice', Object.keys(asked).length > 40 && Object.keys(asked).every(s => asked[s] === 1), JSON.stringify(asked));
    T.setTime(17, 40); T.calls.length = 0; T.opts.repStatus = null; T.run('lmTick()');
    ok('17:40: the 18:00 pass starts early the same way', !!T.state().run && T.state().run.readFrom.slice(11) === '18:00' && T.calls.filter(c => c.m === 'post').length === 6 && reads() === 0);
    T.setTime(18, 2); n = 0; while (T.state().run && n < 20) { T.run('lmTick()'); n++; }
    ok('…reports ready when the reading starts: done in ' + n + ' tick', n === 1 && !T.state().run);
    // lmRunNow: reads at once; no timer installed: a tick never makes one
    const R = setup({ hour: 15 });
    R.run('lmRunNow()'); R.run('lmTick()');
    ok('lmRunNow: reads at once (no waiting for an hour); no timer installed → none made', !R.state().run && R.read('lmMeta').kind === 'full' && !R.triggers.length);
    // a pass begun by the older version: begun again with the new steps
    const O = setup({ hour: 15 });
    O.props.LM_STATE = JSON.stringify({ run: { kind: 'full', startedAt: '2026-11-16 15:24', B: { SP: { ph: 'items', rep: {}, i: 40 }, CPC: { ph: 'rep', rep: {} } }, errors: [] } });
    O.run('lmTick()');
    ok('a pass the older version began is started again with the new steps (a note says so)', !O.state().run && O.read('lmMeta').kind === 'full' && O.state().notes.some(l => /started again with the new steps/.test(l)));
  }

  console.log('== how long a full pass takes (simulated clock) ==');
  {
    // 4,400 SKUs (Ridhi 2,680, CPC 1,720); 1.2 s a call plus our gaps; 1.5 s a sheet write; reports ready at 13:00
    const T = setup({ hour: 13, min: 0, n: { SP: 2680, CPC: 1720 }, msPerCall: 1200, msPerWrite: 1500 });
    const ticks = T.fullPass(30);
    const m = T.read('lmMeta');
    ok('a full pass of 4,400 SKUs: ' + ticks + ' five-minute ticks after 13:00 (≈ ' + ticks * 5 + ' minutes), every SKU there', ticks <= 6 && m.counts.SP.skus === 2680 && m.counts.CPC.skus === 1720, ticks);
  }

  console.log('== lmCheck: the proof ==');
  {
    const W = world({ n: { SP: 5, CPC: 5 } });
    W.SP.fyp['RTC14-2'] = ['Missing information', 'no image'];
    const T = setup({ W, hour: 13 });
    T.fullPass();
    T.run('Math.random = (function () { var i = 0; var seq = [0.0, 0.2, 0.4, 0.6, 0.8]; return function () { return seq[i++ % seq.length]; }; })();');
    T.W.SP.skus['RTC14-3'].t = 'Changed on Amazon';
    T.W.SP.skus['RTC14-4'].fbaLive = 0;
    T.W.SP.skus['RTC14-1'].as = ['DISCOVERABLE', 'BUYABLE'];       // the same status, Amazon's words in the other order
    T.W.SP.skus['RTC14-5'].as = ['BUYABLE'];                       // a real change
    T.log.length = 0;
    T.run('lmCheck()');
    const L = T.log.join('\n');
    ok('counts against fresh reports: all listings, each status, suppressed — OK when equal', /Ridhi  all listings\s+Amazon 5\s+cache 5\s+OK/.test(L) && /Ridhi  status Active\s+Amazon 5\s+cache 5\s+OK/.test(L) && /Ridhi  suppressed \(report\)\s+Amazon 1\s+cache 1\s+OK/.test(L), L.slice(0, 900));
    ok('10 SKUs (5 a brand), each with a live Listings, catalog and stock read', (L.match(/── (Ridhi|CPC) · /g) || []).length === 10);
    const block = sku => (L.split('── ').find(x => x.indexOf(sku + ' · ') > 0 && x.indexOf('Ridhi · ' + sku + ' ') === 0) || '');
    ok('a title changed since: DIFFERENT with both values; status, issues, pictures OK', /title \(ours\)\s+DIFFERENT cache: Title RTC14-3\s+·\s+live: Changed on Amazon/.test(block('RTC14-3')) && /status\s+OK/.test(block('RTC14-3')) && /issues\s+OK/.test(block('RTC14-3')) && /our pictures\s+OK/.test(block('RTC14-3')), block('RTC14-3'));
    ok('status values are sorted before comparing: BUYABLE,DISCOVERABLE = DISCOVERABLE,BUYABLE (OK); BUYABLE alone is DIFFERENT',
      /status\s+OK\s+BUYABLE,DISCOVERABLE/.test(block('RTC14-1')) && /status\s+DIFFERENT cache: BUYABLE,DISCOVERABLE\s+·\s+live: BUYABLE\s*$/m.test(block('RTC14-5')), block('RTC14-1') + block('RTC14-5'));
    ok('…stock that moved: DIFFERENT', /stock \(Available\)\s+DIFFERENT cache: 8\s+·\s+live: 0/.test(block('RTC14-4')), block('RTC14-4'));
    ok('…the catalog lines: title shoppers see, live pictures (with size), parent ASIN', /title shoppers see\s+OK/.test(block('RTC14-1')) && /live pictures\s+OK\s+MAIN=RTC14-1-live\.jpg\(1500x1500\)/.test(block('RTC14-1')) && /parent ASIN\s+OK/.test(block('RTC14-1')), block('RTC14-1'));
    T.W.CPC.skus['CPC-99'] = Object.assign({}, T.W.CPC.skus['CPC-1'], { asin: A('CPC', 99) });
    T.log.length = 0;
    T.run('lmCheck()');
    ok('a listing Amazon has that the cache does not: the count line says DIFFERENT', /CPC  all listings\s+Amazon 6\s+cache 5\s+DIFFERENT/.test(T.log.join('\n')));
    T.log.length = 0;
    T.run('lmSku("RTC14-2")');
    const S = T.log.join('\n');
    ok('lmSku: the listing and its catalog entry, laid out to compare with Seller Central', /Ridhi · RTC14-2 · ASIN B0SP000002/.test(S) && /SUPPRESSED \(report\): Missing information — no image/.test(S) && /browse path\s+Home & Kitchen › Kitchen & Table Linens › Tablecloths/.test(S) && /A\+\s+not in the catalog API/.test(S), S);
    T.log.length = 0;
    T.run('lmStatus()');
    ok('lmStatus: what the cache holds per brand', /Ridhi  5 SKUs \(Active 5\)/.test(T.log.join('\n')), T.log.join('\n'));
  }

  console.log('== script minutes today (lmStatus) ==');
  {
    const T = setup({ hour: 13 });
    T.fullPass();
    const u = JSON.parse(T.props.LM_USAGE);
    ok('every tick adds its minutes to today\'s count (Script Property LM_USAGE)', u.runs >= 1 && u.ms >= 0 && u.day.length === 10);
    T.log.length = 0; T.run('lmStatus()');
    let L = T.log.join('\n');
    ok('lmStatus: today\'s ListingMatch minutes and runs, the daily limit of a Workspace account (360 min)', /ListingMatch  [\d.]+ min in \d+ run\(s\)/.test(L) && /daily limit   360 min of timer time for the WHOLE project \(a Google Workspace account\)/.test(L) && /no sign of the daily limit today/.test(L), L);
    T.triggers.push({ getHandlerFunction: () => 'matchTick' }, { getHandlerFunction: () => 'nightlyTick' });
    const G = setup({ hour: 13, mail: 'someone@gmail.com' });
    G.log.length = 0; G.run('lmStatus()');
    ok('…a Gmail account: 90 min', /daily limit   90 min .*\(a Gmail account\)/.test(G.log.join('\n')));
    const v = JSON.parse(T.props.LM_USAGE); v.ms = 130 * 60000; T.props.LM_USAGE = JSON.stringify(v);
    T.log.length = 0; T.run('lmStatus()'); L = T.log.join('\n');
    ok('ListingMatch alone past a third of the limit: a warning that names the other timers and what to change', /⚠️ ListingMatch alone has used 36% of the daily limit today\. With matchTick, nightlyTick on top/.test(L) && /LM_LIGHT_EVERY_MIN = 30/.test(L), L);
    const w = JSON.parse(T.props.LM_USAGE); w.ms = 0; w.last = Date.now() - 70 * 60000; T.props.LM_USAGE = JSON.stringify(w);
    T.setHour(14);
    const st = T.state(); st.lightAt = Date.now(); T.props.LM_STATE = JSON.stringify(st);
    T.run('lmTick()');
    T.log.length = 0; T.run('lmStatus()'); L = T.log.join('\n');
    ok('a tick that did not come for over 25 minutes: "the project looks NEAR OR OVER ITS DAILY LIMIT"', /⚠️ lmTick did not run \d\d:\d\d–\d\d:\d\d today/.test(L) && /NEAR OR OVER ITS DAILY LIMIT/.test(L), L);
    const y = JSON.parse(T.props.LM_USAGE); y.day = '2000-01-01'; T.props.LM_USAGE = JSON.stringify(y);
    T.log.length = 0; T.run('lmStatus()');
    ok('a new day starts the count again', /ListingMatch  0 min in 0 run\(s\)/.test(T.log.join('\n')));
  }

  console.log('== the Listing Optimiser review judged on the facts Sellora posts from its cache (ListingOptimiser.gs) ==');
  {
    const vm = require('vm');
    const asked = [];
    const link = s => `https://m.media-amazon.com/images/I/${s}.jpg`;
    const live = { summaries: [{ itemName: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Dinner Napkins Set of 6 - Blue', brandName: 'Ridhi', browseClassification: { displayName: 'Cloth Napkins' } }],
      attributes: { bullet_point: ['Soft cotton', 'Block print by hand', 'Set of 6', 'Machine wash', 'Gift ready'].map(v => ({ value: v })), product_description: [{ value: 'x'.repeat(400) }],
        item_type_keyword: [{ value: 'cloth-napkins' }], size: [{ value: '18 x 18 Inch' }], color: [{ value: 'Blue' }], material: [{ value: 'Cotton' }] },
      images: [{ images: [{ variant: 'MAIN', link: link('M'), width: 2000, height: 2000 }, { variant: 'PT01', link: link('P1'), width: 800, height: 800 }, { variant: 'PT02', link: link('P2'), width: 2000, height: 2000 }] }],
      salesRanks: [{ classificationRanks: [{ title: 'Cloth Napkins', rank: 52 }], displayGroupRanks: [{ title: 'Home & Kitchen', rank: 10234 }] }] };
    const ctx = { Logger: { log() {} }, console, marketplaceId_: () => 'ATVPDKIKX0DER', prop_: () => '',
      spRetry_: p => { asked.push(p); return JSON.parse(JSON.stringify(live)); } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(P + 'ListingOptimiser.gs', 'utf8'), ctx);
    const facts = { title: live.summaries[0].itemName, brand: 'Ridhi', category: 'Cloth Napkins', bullets: live.attributes.bullet_point.map(b => b.value), bulletsKnown: true,
      description: 'x'.repeat(400), descriptionKnown: true, itemType: 'cloth-napkins', size: '18 x 18 Inch', color: 'Blue', material: 'Cotton',
      images: { MAIN: { link: link('M'), w: 2000, h: 2000 }, PT01: { link: link('P1'), w: 800, h: 800 }, PT02: { link: link('P2'), w: 2000, h: 2000 }, BAD: { link: link('X'), w: 1, h: 1 }, PT03: { link: 'javascript:x', w: 1, h: 1 } },
      rank: { title: 'Cloth Napkins', value: 52 }, readAt: 1 };
    const fromLive = vm.runInContext('listingReview_("B0TEST0001", "")', ctx);
    const n = asked.length;
    const fromCache = vm.runInContext('listingReview_("B0TEST0001", "", ' + JSON.stringify(facts) + ')', ctx);
    ok('with posted facts: no catalog call (the keyword step uses the same facts); without: the catalog is read as before (the audit and the keyword step)',
      n === 2 && asked.length === 2 && asked.every(p => /\/catalog\/2022-04-01\/items\/B0TEST0001/.test(p)), asked.join(' | '));
    ok('…the audit says where it came from (src cache), and keeps only real picture slots with https links', fromCache.audit.src === 'cache' && Object.keys(fromCache.audit.images.slots).sort().join() === 'MAIN,PT01,PT02' && !fromLive.audit.src);
    const strip = r => JSON.parse(JSON.stringify({ findings: r.findings, suggestion: r.suggestion, images: r.audit.images, rank: r.audit.rank, title: r.audit.title, bullets: r.audit.bullets }));
    ok('the same listing judged the same both ways: findings, suggested title, pictures (PT01 no zoom), rank', JSON.stringify(strip(fromCache)) === JSON.stringify(strip(fromLive)) && fromCache.audit.images.noZoom.join() === 'PT01 (800x800)',
      JSON.stringify(strip(fromCache)).slice(0, 200) + ' vs ' + JSON.stringify(strip(fromLive)).slice(0, 200));
    const codeGs = fs.readFileSync(P + 'Code.gs', 'utf8');
    ok('Code.gs doPost: listing=review takes the facts (a read through the signed-in POST, as the sends)', /if \(p\.listing === 'review'\) \{ setBrand_\(p\.brand\); return json_\(listingReview_\(p\.asin, p\.target, p\.facts\)\); \}/.test(codeGs));
  }

  console.log('== this file changes nothing else ==');
  {
    const src = fs.readFileSync(P + 'ListingMatch.gs', 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    ok('ListingMatch never opens the nightly cache spreadsheet (no cacheSheet_ / cacheRead_ / cacheWrite_ call)', !/cacheSheet_\(|cacheRead_\(|cacheWrite_\(/.test(code));
    const codeGs = fs.readFileSync(P + 'Code.gs', 'utf8');
    ok('Code.gs: one line — lm tabs from lmCacheRead_, everything else from cacheRead_ as before; CRLF kept', /var c = \/\^lm\(Meta\$\|Listings_\|Catalog_\|Aplus_\)\/\.test\(String\(p\.cache\)\) \? lmCacheRead_\(String\(p\.cache\)\) : cacheRead_\(String\(p\.cache\)\);/.test(codeGs) && !/(^|[^\r])\n/.test(codeGs));
    ok('no LockService, no writes to Amazon (only report requests and reads)', !/LockService\./.test(src) && !/'(put|patch|delete)'/.test(src) && !/method:\s*'(put|patch|delete)'/.test(src));
    ok('no keys in the code', !/(CLIENT_SECRET|REFRESH_TOKEN|Atzr\||amzn1\.application)/.test(src.replace(/prop_\(|getProperty\(/g, '')));
    ok('the line endings are one kind (CRLF, like most of Pricing-API)', !/(^|[^\r])\n/.test(src) && /\r\n/.test(src));
    ok('every name it adds starts with lm / LM_ (no clash with the other files)', (src.match(/^function (\w+)/gm) || []).every(f => /^function (lm|LM)/.test(f)) && (src.match(/^var (\w+)/gm) || []).every(v => /^var LM_/.test(v)));
  }

  console.log('== A+ content: once a day after the 13:00 pass (18 Nov 2026) ==');
  {
    const aplusCalls = T => T.calls.filter(c => c.p.indexOf('/aplus/') === 0);
    // --- the daily read ---
    const T = setup({ hour: 13 });
    T.fullPass();
    const meta = T.read('lmMeta'), sp = T.read('lmAplus_SP'), cpc = T.read('lmAplus_CPC');
    ok('after the 13:00 full pass the A+ read runs and lmMeta names one tab per brand', !T.state().ap && meta.aplus && meta.aplus.SP.tab === 'lmAplus_SP' && meta.aplus.CPC.tab === 'lmAplus_CPC' && !meta.aplus.SP.stale && T.aplusTicks >= 1, JSON.stringify(meta.aplus));
    ok('every document with its name, status, type and last update (Ridhi 5, CPC 1)', sp.ok && sp.nDocs === 5 && cpc.nDocs === 1
      && sp.docs['SP-DOC-1'].n === 'Tablecloth A+ 2026' && sp.docs['SP-DOC-1'].s === 'APPROVED' && sp.docs['SP-DOC-1'].t === 'Basic' && sp.docs['SP-DOC-1'].u === '2026-10-01T10:00:00Z'
      && sp.docs['SP-DOC-2'].s === 'DRAFT' && sp.docs['SP-DOC-3'].s === 'SUBMITTED' && sp.docs['SP-DOC-3'].t === 'Premium' && sp.docs['SP-DOC-4'].s === 'REJECTED', JSON.stringify(sp.docs['SP-DOC-3']));
    ok('a document with no badge from Amazon has no type (never guessed)', sp.docs['SP-DOC-5'].t === '' && sp.docs['SP-DOC-5'].bd.length === 0);
    ok('the ASINs each document is attached to — a long list read page by page (10 ASINs, 4 a page)', sp.docs['SP-DOC-1'].a.length === 10 && sp.docs['SP-DOC-1'].a[9] === A('SP', 10)
      && sp.docs['SP-DOC-2'].a.join() === [A('SP', 11), A('SP', 12)].join() && sp.docs['SP-DOC-5'].a.length === 0);
    ok('per ASIN: the documents it is on', sp.asins[A('SP', 3)].join() === 'SP-DOC-1' && sp.asins[A('SP', 13)].join() === 'SP-DOC-3' && sp.asins[A('SP', 20)] === undefined && sp.nAsins === 14);
    // calls: Ridhi 3 search pages (5 documents, 2 a page) + 3 + 1 + 1 + 1 + 1 ASIN-list calls (the 10-ASIN list is 3 pages); CPC 1 + 2 (5 ASINs)
    const nSp = aplusCalls(T).filter(c => c.b === 'SP').length, nCpc = aplusCalls(T).filter(c => c.b === 'CPC').length;
    ok('the exact calls are counted and kept: Ridhi ' + nSp + ', CPC ' + nCpc, nSp === 10 && nCpc === 3 && sp.calls === 10 && cpc.calls === 3 && meta.aplus.SP.calls === 10, sp.calls + ' / ' + cpc.calls);
    ok('only A+ reads: searchContentDocuments and the ASIN lists, nothing written to Amazon', aplusCalls(T).every(c => c.m === 'get' && /^\/aplus\/2020-11-01\/contentDocuments(\/[^/]+\/asins)?$/.test(c.p)));
    ok('the scratch tab is gone; the listing parts are untouched', !T.sheets.has('lmApScr_SP') && !T.sheets.has('lmApScr_CPC') && meta.parts.listings.SP.length >= 1 && meta.kind === 'full');
    // --- once a day ---
    T.calls.length = 0;
    T.run('lmTick()');
    ok('a later tick the same day: A+ is not read again', !aplusCalls(T).length && T.state().apDay);
    T.setHour(18);
    T.fullPass();
    ok('the 18:00 full pass: A+ is not read again (once a day)', !aplusCalls(T).length);
    T.run('lmAplusNow()');
    T.calls.length = 0;
    T.aplusRead();
    ok('lmAplusNow(): one extra read on the next free tick', aplusCalls(T).length === 13 && !T.state().apAsk && !T.state().ap);
    // --- not before 13:00, not in a morning pass ---
    const M = setup({ hour: 10 });
    M.run('lmRunNow()');
    M.fullPass();
    ok('a full pass in the morning (lmRunNow at 10:00): no A+ read — it follows the 13:00 pass only', !aplusCalls(M).length && !M.read('lmMeta').aplus);
    // --- Code.gs ---
    const g = T.get({ cache: 'lmAplus_SP' });
    ok('Code.gs ?cache=lmAplus_SP reads the tab from "Sellora Listing Cache"', g.ok && g.data.docs['SP-DOC-1'].a.length === 10);
    const d = T.get({ lh: 'aplusdoc', brand: 'SP', doc: 'SP-DOC-1', asins: '1' });
    ok('?lh=aplusdoc: one document on request — status, type, its modules\' texts and picture ids, its ASINs', d.ok && d.status === 'APPROVED' && d.type === 'Basic' && d.modules.length === 2
      && d.modules[0].type === 'STANDARD_HEADER_IMAGE_TEXT' && d.modules[0].texts.includes('Block printed cotton') && d.modules[0].texts.includes('Printed by hand in Jaipur.')
      && d.modules[0].imgs[0].id === 'aplus-media/sc/abc.jpg' && d.asins.length === 10, JSON.stringify(d).slice(0, 400));
    ok('…a document that is not there: a plain error, no crash', T.get({ lh: 'aplusdoc', brand: 'SP', doc: 'NOPE' }).status === 404);
    // --- a rejection reason, when Amazon sends one ---
    const R = setup({ hour: 13, aplus: { SP: [{ k: 'RJ', n: 'Rejected doc', s: 'REJECTED', bd: ['STANDARD'], u: '2026-11-01T00:00:00Z', a: [A('SP', 1)], rr: ['Image contains a web link'] },
      { k: 'OK1', n: 'Fine', s: 'APPROVED', bd: ['STANDARD'], u: '2026-11-01T00:00:00Z', a: [A('SP', 2)] }] } });
    R.fullPass();
    ok('Amazon\'s rejection reason is kept when Amazon sends one — and [] when it does not', R.read('lmAplus_SP').docs.RJ.rr.join() === 'Image contains a web link' && sp.docs['SP-DOC-4'].rr.length === 0);
    // --- failures never wipe ---
    const F = setup({ hour: 13 });
    F.fullPass();
    const good = JSON.stringify(F.read('lmAplus_SP').docs);
    F.opts.aplusFail = c => c.b === 'SP' && c.p === '/aplus/2020-11-01/contentDocuments';
    F.run('lmAplusNow()');
    F.aplusRead();
    const fm = F.read('lmMeta');
    ok('the document search fails 3 times: the last good tab stays as it was, lmMeta marks it stale with the reason', JSON.stringify(F.read('lmAplus_SP').docs) === good && fm.aplus.SP.stale === 1
      && /failed 3 times/.test(fm.aplus.SP.err) && fm.aplus.SP.at === JSON.parse(JSON.stringify(fm.aplus.SP)).at && !!fm.aplus.SP.triedAt, JSON.stringify(fm.aplus.SP));
    ok('…the other brand is read as usual', fm.aplus.CPC.stale === 0 && F.read('lmAplus_CPC').ok);
    ok('…and the error is said plainly', (F.state().errors || []).some(e => /Ridhi A\+ could not be read/.test(e)));
    // one document's ASIN list fails: its last good list is kept and marked
    const P1 = setup({ hour: 13 });
    P1.fullPass();
    P1.W.SP.aplus[0].a = [A('SP', 1)];                                   // would shrink — but its read fails
    P1.opts.aplusFail = c => /SP-DOC-1\/asins$/.test(c.p);
    P1.run('lmAplusNow()');
    P1.aplusRead();
    const p1 = P1.read('lmAplus_SP');
    ok('one document\'s ASIN list fails 3 times: that document keeps the list of the last read, marked; the others are fresh', p1.docs['SP-DOC-1'].a.length === 10 && p1.docs['SP-DOC-1'].as === 1
      && !p1.docs['SP-DOC-2'].as && p1.partial === 0 && P1.read('lmMeta').aplus.SP.stale === 0, JSON.stringify(p1.docs['SP-DOC-1']));
    // …and with no last read to fall back on: the list is unknown (null), counted as partial
    const P2 = setup({ hour: 13, aplusFail: c => /SP-DOC-2\/asins$/.test(c.p) });
    P2.fullPass();
    const p2 = P2.read('lmAplus_SP');
    ok('…with no earlier read: that document\'s list is unknown (a: null) and the read says so (partial 1) — never "no ASINs"', p2.docs['SP-DOC-2'].a === null && p2.partial === 1 && P2.read('lmMeta').aplus.SP.partial === 1 && p2.docs['SP-DOC-1'].a.length === 10);
    // an answer that cannot be right
    const E1 = setup({ hour: 13 });
    E1.fullPass();
    E1.W.SP.aplus = [];
    E1.run('lmAplusNow()');
    E1.aplusRead();
    ok('Amazon suddenly lists no documents where the last read had 5: a failed read, the tab stays, marked stale', E1.read('lmAplus_SP').nDocs === 5 && E1.read('lmMeta').aplus.SP.stale === 1 && /no A\+ documents/.test(E1.read('lmMeta').aplus.SP.err));
    const E2 = setup({ hour: 13, aplus: { SP: [{ k: 'X1', n: 'Approved, nothing attached', s: 'APPROVED', bd: [], u: '', a: [] }, { k: 'X2', n: 'Another', s: 'APPROVED', bd: [], u: '', a: [] }] } });
    E2.fullPass();
    ok('documents but not one ASIN on any of them (the old "A+ missing everywhere" answer): nothing is written, lmMeta says why', !E2.sheets.has('lmAplus_SP') && E2.read('lmMeta').aplus.SP.stale === 1
      && /no ASIN on any of them/.test(E2.read('lmMeta').aplus.SP.err) && !E2.read('lmMeta').aplus.SP.at);
    // a 403: no retries
    const N = setup({ hour: 13, aplusFail: () => true, aplusFailCode: 403 });
    N.fullPass();
    ok('a 403 (no access): given up at once (2 calls, one per brand), said plainly, nothing written', aplusCalls(N).length === 2 && /no access to the A\+ Content API \(403\)/.test(N.read('lmMeta').aplus.SP.err) && !N.sheets.has('lmAplus_SP'));
    // the network dying every tick must not hold the light passes back for ever
    const D = setup({ hour: 13, netFail: c => c.p.indexOf('/aplus/') === 0 });
    D.fullPass();
    ok('a network that fails on every A+ call: given up after 6 ticks, the light passes are free again', !D.state().ap && D.aplusTicks === 6 && D.read('lmMeta').aplus.SP.stale === 1 && !!D.state().apDay, D.aplusTicks + ' ' + JSON.stringify(D.state().ap));
    // --- a slow Amazon: several ticks, every document once ---
    const big = Array.from({ length: 60 }, (_, i) => ({ k: 'B' + i, n: 'Doc ' + i, s: i % 5 ? 'APPROVED' : 'DRAFT', bd: ['STANDARD'], u: '2026-11-01T00:00:00Z', a: [A('SP', i + 1)] }));
    const S = setup({ hour: 13, n: { SP: 80 }, aplus: { SP: big }, aplusPage: 20 });
    S.fullPass();
    S.opts.msPerCall = 0;
    const before = S.calls.length;
    ok('60 documents: ' + S.read('lmAplus_SP').calls + ' calls (3 search pages + one ASIN list each)', S.read('lmAplus_SP').nDocs === 60 && S.read('lmAplus_SP').calls === 63 && S.calls.length === before);
    const Slow = setup({ hour: 13, n: { SP: 80 }, aplus: { SP: big }, aplusPage: 20, noAplusAfter: true });
    Slow.fullPass();
    Slow.opts.msPerCall = 20000;                                         // 20 s a call from here on: ~11 calls fit a tick
    Slow.ctx.__slow = 1;
    const ticks = Slow.aplusRead(40);
    const asked = {};
    aplusCalls(Slow).filter(c => /\/asins$/.test(c.p) && c.b === 'SP').forEach(c => { asked[c.p] = (asked[c.p] || 0) + 1; });
    ok('a slow Amazon: the read carries on tick after tick (' + ticks + ' ticks) and every ASIN list is asked once', ticks >= 1 && Slow.read('lmAplus_SP').nDocs === 60 && Object.keys(asked).length === 60 && Object.values(asked).every(n => n === 1), ticks + ' ' + Object.keys(asked).length);
    // --- lmStatus and the code ---
    T.log.length = 0;
    T.run('lmStatus()');
    ok('lmStatus says what A+ holds: documents, ASINs, when, the calls', T.log.some(l => /Ridhi {2}5 documents on 14 ASINs · read .* with 10 calls/.test(l)), T.log.filter(l => /A\+|documents/.test(l)).join(' | '));
    T.log.length = 0;
    T.run('lmAplus("' + A('SP', 13) + '")');
    ok('lmAplus(asin): that ASIN\'s documents', T.log.some(l => /"Runner premium" · SUBMITTED · Premium/.test(l)), T.log.join(' | '));
    T.log.length = 0;
    T.run('lmAplusCheck()');
    ok('lmAplusCheck(): cache against Amazon\'s publish records — every line MATCH', T.log.filter(l => /MATCH|DIFFERENT/.test(l)).length >= 6 && !T.log.some(l => /DIFFERENT/.test(l)), T.log.filter(l => /DIFFERENT/.test(l)).join(' | '));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
