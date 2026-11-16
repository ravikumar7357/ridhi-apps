// Pricing-API ListingMatch.gs (16 Nov 2026): Amazon's own listing data into the cache sheet (lmListings / lmCatalog / lmMeta).
// Runs the real .gs files in node against a fake Amazon (reports, Listings Items, Catalog Items, FBA) and a fake cache spreadsheet.
// node Replenish-App/tests/listing-match-test.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const P = path.join(__dirname, '..', '..', 'Pricing-API') + '/';
const FILES = ['SpApi.gs', 'Code.gs', 'Nightly.gs', 'ListingImages.gs', 'InventoryAge.gs', 'Research.gs', 'ListingMatch.gs'];
const SRC = FILES.map(f => fs.readFileSync(P + f, 'utf8')).join('\n;\n');
let pass = 0, fail = 0;
const ok = (n, c, i) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (i !== undefined ? '  ' + i : '')); } };

/* ---------- a time zone in which the hour is H right now (the schedule reads the script's time zone) ---------- */
function tzAt(H) {
  let off = H - new Date().getUTCHours();
  if (off > 14) off -= 24;
  if (off < -12) off += 24;
  return off === 0 ? 'UTC' : 'Etc/GMT' + (off > 0 ? '-' : '+') + Math.abs(off);
}
function fmt(d, tz, pat) {
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
    W[b] = { skus, cat, fyp: {} };
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
    issues: x.iss.map(i => ({ code: i.c, severity: i.s, message: i.m, attributeNames: i.a || [] })) };
}
function catalogItem(asin, c) {
  const rel = c.kids ? [{ type: 'VARIATION', childAsins: c.kids, variationTheme: { theme: c.theme, attributes: c.tattrs } }] : [{ type: 'VARIATION', parentAsins: c.pa }];
  const attrs = {};
  Object.keys(c.vals || {}).forEach(k => { attrs[k] = [{ value: c.vals[k] }]; });
  return { asin, summaries: [{ itemName: c.t, brand: 'Ridhi', browseClassification: { displayName: 'Tablecloths', classificationId: '1' } }],
    images: [{ images: Object.keys(c.img).map(v => ({ variant: v, link: c.img[v].link, width: c.img[v].w, height: c.img[v].h })).concat(Object.keys(c.img).map(v => ({ variant: v, link: c.img[v].link + '?small', width: 75, height: 75 }))) }],
    relationships: [{ marketplaceId: 'ATVPDKIKX0DER', relationships: rel }], attributes: attrs,
    classifications: [{ classifications: [{ displayName: 'Tablecloths', classificationId: '1', parent: { displayName: 'Kitchen & Table Linens', parent: { displayName: 'Home & Kitchen' } } }] }],
    salesRanks: [{ displayGroupRanks: [{ rank: 13206, title: 'Home & Kitchen' }], classificationRanks: [{ rank: 109, title: 'Tablecloths' }] }] };
}

/* ---------- one Apps Script project in a vm ---------- */
function setup(o) {
  o = o || {};
  const W = o.W || world(o);
  const props = Object.assign({ CACHE_SHEET_ID: 'CACHE', SP_SELLER_ID: 'SELLER-SP', CPC_SELLER_ID: 'SELLER-CPC' }, o.props || {});
  const sheets = new Map();
  const log = [], calls = [], triggers = [];
  let repN = 0;
  const reps = {};
  const sheet = name => {
    const s = { name, rows: [] };
    s.api = {
      getName: () => name, clear: () => { s.rows = []; },
      getLastRow: () => s.rows.length, getMaxRows: () => Math.max(1, s.rows.length), getMaxColumns: () => 1, deleteColumns() {}, deleteRows() {},
      getRange: (r, c, n) => ({
        setValues: v => { if (o.failWrite && o.failWrite(name)) throw new Error('Service Spreadsheets failed'); s.rows = v.map(x => x[0]); },
        getValues: () => s.rows.slice(r - 1, r - 1 + n).map(x => [x]),
        setValue: v => { s.rows[r - 1] = v; },
      }),
    };
    return s;
  };
  const SS = {
    getSheetByName: n => (sheets.has(n) ? sheets.get(n).api : null),
    insertSheet: n => { const s = sheet(n); sheets.set(n, s); return s.api; },
    deleteSheet: api => { sheets.delete(api.getName()); },
    getSheets: () => [...sheets.values()].map(s => s.api),
  };
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)),
    getBlob: () => ({ setContentType() { return this; }, getDataAsString: () => (typeof body === 'string' ? body : JSON.stringify(body)) }) });
  let ctx;
  const brand = () => ctx.ACTIVE_PREFIX;
  const fetch = (url, opt) => {
    opt = opt || {};
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
    if (p === '/fba/inventory/v1/summaries') {
      const sku = q.get('sellerSkus');
      return resp(200, { payload: { inventorySummaries: w.skus[sku] ? [{ sellerSku: sku, inventoryDetails: { fulfillableQuantity: w.skus[sku].fbaLive != null ? w.skus[sku].fbaLive : w.skus[sku].fba } }] : [] } });
    }
    throw new Error('unexpected fetch ' + url);
  };
  ctx = {
    UrlFetchApp: { fetch },
    SpreadsheetApp: { openById: () => SS, create: () => SS },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; }, getProperties: () => props }) },
    CacheService: { getScriptCache: () => ({ get: () => 'tok', put() {} }) },
    Utilities: { sleep() {}, formatDate: fmt, ungzip: b => b },
    Session: { getScriptTimeZone: () => o.tz || tzAt(o.hour == null ? 13 : o.hour) },
    ScriptApp: { getProjectTriggers: () => triggers, deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: h => ({ timeBased: () => ({ everyMinutes: m => ({ create: () => triggers.push({ getHandlerFunction: () => h, m }) }) }) }) },
    Logger: { log: s => log.push(String(s)) }, console,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  if (o.tune) vm.runInContext(o.tune, ctx);
  const read = n => vm.runInContext('cacheRead_(' + JSON.stringify(n) + ')', ctx);
  const run = s => vm.runInContext(s, ctx);
  const state = () => JSON.parse(props.LM_STATE || '{}');
  const allItems = (kind, b) => {
    const meta = read('lmMeta'), out = {}, dup = [];
    ((meta.parts[kind] || {})[b] || []).forEach(t => { const p = read(t); Object.keys(p.items).forEach(k => { if (out[k]) dup.push(k); out[k] = p.items[k]; }); });
    return { items: out, dup };
  };
  // ticks until the full pass is done (a 13:00 tick starts it)
  const fullPass = (max) => { let n = 0; do { run('lmTick()'); n++; } while (state().run && n < (max || 60)); return n; };
  return { W, props, sheets, log, calls, triggers, reps, ctx, read, run, state, allItems, fullPass, setHour: h => { o.tz = tzAt(h); }, opts: o };
}
const tabs = T => [...T.sheets.keys()];

(async () => {
  console.log('== setup and the first full pass ==');
  {
    const T = setup({ hour: 10 });
    T.run('lmSetup()');
    ok('lmSetup: the cache sheet is checked (probe written and removed), lmTick every 10 minutes, a full pass asked for',
      T.triggers.length === 1 && T.triggers[0].getHandlerFunction() === 'lmTick' && T.triggers[0].m === 10 && !T.sheets.has('lmProbe') && T.state().reset === true);
    T.run('lmSetup()');
    ok('…run twice: still one timer', T.triggers.length === 1);
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
  }

  console.log('== batching and resume ==');
  {
    // tiny scratch tabs: every tick stops after one call and writes what it read; one call dies on the network
    const T = setup({ hour: 13, tune: 'LM_SCR_MAX = 3000;', netFail: (c, n) => c.p.indexOf('/listings/') === 0 && c.q.identifiers && c.q.identifiers.split(',')[0] === 'RTC14-28' && !global.__died && (global.__died = 1) });
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

  console.log('== lmCheck: the proof ==');
  {
    const W = world({ n: { SP: 5, CPC: 5 } });
    W.SP.fyp['RTC14-2'] = ['Missing information', 'no image'];
    const T = setup({ W, hour: 13 });
    T.fullPass();
    T.run('Math.random = (function () { var i = 0; var seq = [0.0, 0.2, 0.4, 0.6, 0.8]; return function () { return seq[i++ % seq.length]; }; })();');
    T.W.SP.skus['RTC14-3'].t = 'Changed on Amazon';
    T.W.SP.skus['RTC14-4'].fbaLive = 0;
    T.log.length = 0;
    T.run('lmCheck()');
    const L = T.log.join('\n');
    ok('counts against fresh reports: all listings, each status, suppressed — OK when equal', /Ridhi  all listings\s+Amazon 5\s+cache 5\s+OK/.test(L) && /Ridhi  status Active\s+Amazon 5\s+cache 5\s+OK/.test(L) && /Ridhi  suppressed \(report\)\s+Amazon 1\s+cache 1\s+OK/.test(L), L.slice(0, 900));
    ok('10 SKUs (5 a brand), each with a live Listings, catalog and stock read', (L.match(/── (Ridhi|CPC) · /g) || []).length === 10);
    const block = sku => (L.split('── ').find(x => x.indexOf(sku + ' · ') > 0 && x.indexOf('Ridhi · ' + sku + ' ') === 0) || '');
    ok('a title changed since: DIFFERENT with both values; status, issues, pictures OK', /title \(ours\)\s+DIFFERENT cache: Title RTC14-3\s+·\s+live: Changed on Amazon/.test(block('RTC14-3')) && /status\s+OK/.test(block('RTC14-3')) && /issues\s+OK/.test(block('RTC14-3')) && /our pictures\s+OK/.test(block('RTC14-3')), block('RTC14-3'));
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

  console.log('== this file changes nothing else ==');
  {
    const src = fs.readFileSync(P + 'ListingMatch.gs', 'utf8');
    ok('no LockService, no writes to Amazon (only report requests and reads)', !/LockService\./.test(src) && !/'(put|patch|delete)'/.test(src) && !/method:\s*'(put|patch|delete)'/.test(src));
    ok('no keys in the code', !/(CLIENT_SECRET|REFRESH_TOKEN|Atzr\||amzn1\.application)/.test(src.replace(/prop_\(|getProperty\(/g, '')));
    ok('the line endings are one kind (CRLF, like most of Pricing-API)', !/(^|[^\r])\n/.test(src) && /\r\n/.test(src));
    ok('every name it adds starts with lm / LM_ (no clash with the other files)', (src.match(/^function (\w+)/gm) || []).every(f => /^function (lm|LM)/.test(f)) && (src.match(/^var (\w+)/gm) || []).every(v => /^var LM_/.test(v)));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
