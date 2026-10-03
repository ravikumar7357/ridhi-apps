/**
 * Pricing API â€” the backend for the "Amazon Price Research" Firebase app.
 *
 * A STANDALONE Apps Script (bound to no spreadsheet). It exists only to hold the SP-API
 * credentials server-side and expose ONE read-only endpoint the web app can call. The user never
 * opens this â€” there is no sheet and no UI.
 *
 * Why this and not a Cloud Function: Firebase's free Spark plan blocks Cloud Functions from making
 * outbound calls to external hosts, so a Function could never reach Amazon. Apps Script can, and is
 * free. The browser NEVER sees the credentials â€” it only ever talks to this endpoint.
 *
 * It returns RAW Amazon data (price + fees + catalog). The reverse-costing maths lives in the app,
 * so changing a rate there recomputes instantly without another Amazon call.
 *
 * Script Properties (Project Settings â†’ Script Properties) â€” never in code:
 *     SP_CLIENT_ID, SP_CLIENT_SECRET, SP_REFRESH_TOKEN
 *     API_KEY            shared secret the app must send as ?key=â€¦ (protects the SP-API quota)
 *     (optional) SP_REGION = na|eu|fe , SP_MARKETPLACE_ID = ATVPDKIKX0DER
 *
 * Endpoint (deploy as Web App â†’ Execute as: Me Â· Who has access: Anyone):
 *     GET  ?key=<API_KEY>&asin=<ASIN or full Amazon URL>[&price=<override>]
 *     GET  ?key=<API_KEY>&ping=1                â†’ health/credentials check
 *   â†’  { ok, asin, title, brand, category, weight, dims:{l,w,h,unit}, buyBox, lowest, offers,
 *        price, referral, fba, feeTotal, feePrice }
 *   â†’  { ok:false, error:"â€¦" }  on any failure (always HTTP 200 â€” read `ok`, not the status).
 */

var LWA_URL = 'https://api.amazon.com/auth/o2/token';
var ACTIVE_PREFIX = 'SP';

// The seller's own "Orders Data" workbooks (from the FBA-Sheet system). Read-only, to attach REAL
// last-30-day units + revenue to a child ASIN. Only the seller's own ASINs appear here â€” a
// competitor's child ASINs simply won't match, and come back with blank sales (which is honest:
// nobody can get a competitor's actual units from Amazon's API).
var ORDERS_DATA_IDS = [
  '1OLIo0mYIgClBuABrfivPoLG-M1xS_rLwkQpFRAF_0kA',   // Ridhi Orders Data
  '1jjDNWNF327mVQTKfmcadioB5AO5A9BP_9M1CC9t4L2o',   // CPC Orders Data
];
var ORDERS_PT = 'America/Los_Angeles';

/* WHICH SALES CHANNELS COUNT AS SALES.  (Orders column [8], "Sales Channel".)
 *
 * The workbooks carry every marketplace the account sells on, and the Revenue column is in each
 * marketplace's OWN currency. So a single Amazon.com.mx order read as dollars added 2,642.99 to a
 * day that was really about 140 dollars bigger â€” 13% of CPC's 9 August, from one row.
 *
 * Adding pesos to dollars does not produce a number that means anything, and there is no exchange
 * rate in this workbook to fix it with. Until the sheet carries a currency column, the only honest
 * answer is to count the marketplace the dashboards are actually compared against.
 *
 * Add a channel here to include it â€” and only do that once its rows are known to be in USD.
 *
 * A row with NO channel at all is KEPT. The column was added part way through the workbook's life,
 * and dropping everything older than it would erase most of the history to fix one row.
 */
var ORDERS_CHANNELS = ['amazon.com'];
function chanOk_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return true;
  return ORDERS_CHANNELS.indexOf(s) >= 0;
}

// The brands' MAIN workbooks â€” read-only, only to look up Parent ASIN from their Catalog tabs
// (the FBA inventory report has no parent-ASIN field).
var RIDHI_SHEET_ID = '1QPTz69Q128OWAm2ewe13jkciXOC9CUfkmVEJMA-iKKo';
var CPC_SHEET_ID   = '1UHHVMqUu3Q2vfLQRKvbOnesjvjL_YdKg2KCh-G084fg';

/** Point every following SP-API call at a brand's credentials. 'CPC' â†’ CPC_*, anything else â†’ SP_*. */
function setBrand_(b) {
  ACTIVE_PREFIX = (String(b || '').toUpperCase() === 'CPC') ? 'CPC' : 'SP';
  return ACTIVE_PREFIX;
}

/* ===================== Web endpoint ===================== */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    // Shared-secret gate. The credentials are safe regardless (they never leave this script), but
    // without this anyone with the URL could burn the SP-API quota.
    var key = prop_('API_KEY');
    if (!key) return json_({ ok: false, error: 'API_KEY is not set on the backend.' });
    // Trim the incoming key: a stray space/newline picked up when pasting it into Firestore is
    // invisible but breaks the match, and the resulting "Unauthorized" looks like a real auth fault.
    var sent = String(p.key || '').trim();
    if (sent !== key) {
      return json_({ ok: false, error: 'Unauthorized.' +
        (sent ? ' (sent a ' + sent.length + '-char key; backend expects ' + key.length + ')' : ' (no key sent)') });
    }

    /* ---- can we actually do MCF and write tracking back? A question, not a change. ---- */
    /* Names only, never values: enough to spot a property saved under a slightly different name. */
    /* A real read, not just a scope list: what the store actually has waiting to be shipped. */
    if (p.shoptest) return json_(shopTest_(String(p.shop || '')));
    if (p.propnames) return json_({ ok: true, names: PropertiesService.getScriptProperties().getKeys().filter(function (k) { return /SHOPIFY/i.test(k); }).map(function (k) { return JSON.stringify(k); }) });
    if (p.mcfdiag) return json_(mcfDiag_(String(p.brand || 'SP').toUpperCase(), String(p.shop || '')));
    if (p.fuldiag) return json_(fulfilDiag_(p.days));

    if (p.ping) {
      getToken_();                                  // throws if the credentials are wrong
      return json_({ ok: true, pong: true, marketplace: marketplaceId_(), host: spHost_() });
    }

    // Variation explorer: parent/child listings of a reference product, with each child's
    // color/size/price + REAL last-30-day units & revenue from the seller's own Orders data.
    if (p.children) return json_(exploreChildren_(p.children));

    // Listing audit â†’ launch review: last-30-day units + revenue for EVERY ASIN that sold, so the
    // browser can roll it up per parent and flag a launch that is under target after its first month.
    //
    // CHUNKED is the one the app uses. Reading both Orders workbooks end to end in a single request
    // ran past what the browser will wait for â€” the fetch died with a bare network error, which
    // looks like a broken endpoint rather than "this is taking too long". A bounded slice per
    // request always returns, and the browser can show progress while it walks through.
    // Ads API connection test: which advertising profiles each brand's credentials can see.
    if (p.ads === 'profiles') return json_(adsProfilesBoth_());
    // PPC (Sponsored Products) per ASIN. Amazon builds these reports asynchronously, so it is three
    // calls: ask, wait, collect. One brand at a time â€” each has its own credentials and profile.
    if (p.ads === 'ppcCreate') { setBrand_(p.brand); return json_(ppcCreate_(p.days)); }
    if (p.ads === 'ppcRange')  { setBrand_(p.brand); return json_(ppcCreateRange_(p.start, p.end)); }
    if (p.ads === 'ppcStatus') { setBrand_(p.brand); return json_(ppcStatus_(p.id)); }
    if (p.ads === 'ppcFetch')  { setBrand_(p.brand); return json_(ppcFetch_(p.id, p.gran)); }
    // Account trends: whole-account totals per day, out of the Orders workbooks.
    if (p.daily === 'sales')   return json_(dailySalesChunk_(p.book, p.start, p.n, p.days));
    // The live top-up: today and the few days around it, read from the tail of each sheet.
    if (p.daily === 'recent')  return json_(dailyRecent_(p.days));
    // Product photos for the deal planner, 20 ASINs a call.
    if (p.imgs)                { setBrand_(p.brand); return json_(lhImages_(p.imgs)); }
    // Parent ASIN per child ASIN, 20 a call — the Master Database fills its Parent ASIN column from this.
    if (p.parents)             { setBrand_(p.brand); return json_(catParents_(p.parents)); }
    // Shopify daily totals on demand (the dashboard's own refresh; the nightly run does this too).
    /* Every product and variant with its SKU — what the SKU audit reads. One page of 250 products
     * per call: the whole catalogue in one answer is exactly the kind of big, slow response Google
     * loses on the way back. */
    if (p.shopify === 'skus') {
      setShopBrand_(p.shop);
      return json_(shopifySkuList_(p.page));
    }
    if (p.shopify === 'daily') return json_(shopifyDaily_(p.start, p.end));
    // Individual Shopify orders, for the tab that decides what ships and how.
    if (p.shopify === 'orders') {
      /* Which store's orders. Absent means Ridhi, which is every call made before today. */
      setShopBrand_(p.shop);
      var ords = shopifyOrders_(p.start, p.end, p.open === '1');
      ords.shop = shopifyStore_();
      ords.shopBrand = String(p.shop || '').toUpperCase() === 'CPC' ? 'CPC' : 'SP';
      return json_(ords);
    }
    /* One store's per-SKU sales + stock built now, rather than waiting for the night. */
    if (p.shopSkuBuild) return json_(shopSkuBuild_(String(p.shop || ''), Date.now() + 300000));
    // Whatever the nightly run has already worked out. One fast read instead of the whole grind.
    if (p.cache) {
      var c = cacheRead_(String(p.cache));
      return json_(c ? { ok: true, name: p.cache, data: c } : { ok: false, error: 'nothing cached for "' + p.cache + '" yet' });
    }
    if (p.cacheState) return json_({ ok: true, state: nState_() });
    // Live India stock, read straight from the warehouse workbook on every call. Not cached nightly
    // on purpose: the whole complaint was that the stored copy had gone stale.
    if (p.india === 'stock') return json_(indiaStockLive_());
    // Pictures for imported orders, resolved from the SKU. Asked for once, at import.
    if (p.imgsku) return json_(skuImages_(p.imgsku));
    // What a listing currently IS — title, bullets, description, image slots — for the optimiser.
    if (p.listing === 'audit') { setBrand_(p.brand); return json_(listingAudit_(p.asin)); }
    // The keyword evidence: what shoppers searched on the way to this ASIN, and which of those words
    // the listing never says.
    if (p.listing === 'keywords') { setBrand_(p.brand); return json_(listingKeywords_(p.asin)); }
    // Everything the optimiser screen needs about one listing, in one round trip.
    if (p.listing === 'review') { setBrand_(p.brand); return json_(listingReview_(p.asin, p.target)); }
    // Search Query Performance for one ASIN: ask, then poll. Amazon builds it asynchronously.
    if (p.listing === 'sqpAsk') { setBrand_(p.brand); return json_(baCreate_('sqp', p.period || 'MONTH', p.asin, p.back)); }
    // Which windows can actually be asked for, built by the same function that builds the request.
    if (p.listing === 'periods') return json_(baPeriods_(p.period, p.n));
    if (p.listing === 'sqpGet') { setBrand_(p.brand); return json_(sqpAllCollect_(p.id, p.asin)); }
    // Bought together: which products share a basket with this one, and which of those are ours.
    if (p.listing === 'basketAsk') { setBrand_(p.brand); return json_(basketAsk_(p.period, p.back)); }
    if (p.listing === 'basketGet') { setBrand_(p.brand); return json_(basketGet_(p.id)); }
    if (p.listing === 'basketAll') { setBrand_(p.brand); return json_(basketAll_(p.id)); }

    // Weekly PPC & Organic dashboard: sales out of the Orders workbooks, sessions out of SP-API.
    if (p.weekly === 'sales')  return json_(weeklySalesChunk_(p.book, p.start, p.n, p.weeks));
    if (p.weekly === 'keys')   return json_({ ok: true, weeks: weeklyKeys_(p.weeks) });
    if (p.traffic === 'create') { setBrand_(p.brand); return json_(trafficCreate_(p.start, p.end)); }
    if (p.traffic === 'status') { setBrand_(p.brand); return json_(trafficStatus_(p.id)); }
    if (p.traffic === 'fetch')  { setBrand_(p.brand); return json_(trafficFetch_(p.doc)); }

    if (p.sales30 === 'chunk') return json_(sales30Chunk_(p.book, p.start, p.n));
    if (p.sales30) return json_(sales30All_());   // whole scan in one go â€” only safe on small books

    // Product research: keyword search Amazon's catalog â†’ each hit's brand/size/outer+inner material/
    // weight/BSR + a rough sale-qty estimate assumed FROM the BSR (labelled an estimate on purpose).
    // fo/fi = outer/inner material filters â€” keep only hits that actually match them.
    if (p.research) return json_(researchProducts_(p.research, p.count, p.fo, p.fi));

    // DataDive proxy: forward any GET /v1/â€¦ path to DataDive with the server-held x-api-key, return
    // raw JSON. Generic on purpose â€” one stable branch covers niches / keywords / rank-radars / etc.,
    // so all the shaping lives in the fast-to-redeploy frontend, never here.
    if (p.dd) return json_(ddProxy_(p.dd));

    // Brand Analytics access check â€” does this SP-API app have the Brand Analytics role? Tries to
    // CREATE a Search Terms report; a 403 / access-denied means the role is missing.
    if (p.ba === 'check') return json_(baCheck_());
    // Brand Analytics reports are async: create returns a reportId; poll returns the parsed rows once
    // Amazon marks it DONE. The browser polls so no single request blocks for minutes.
    if (p.ba === 'create') return json_(baCreate_(p.type, p.period, p.asin));
    if (p.ba === 'poll') return json_(baPoll_(p.id));

    // Sales Analysis: monthly units + revenue per SKU, read from the Orders workbook in chunks,
    // and the Catalog tab that says what colour and article each SKU is.
    if (p.sales === 'cat') return json_(saCatalog_(p.brand));
    if (p.sales === 'chunk') return json_(saChunk_(p.book, p.start, p.rows));

    // FBA inventory ageing â€” same async create/poll shape, per brand.
    if (p.age === 'create') { setBrand_(p.brand); return json_(ageCreate_()); }
    if (p.age === 'poll') { setBrand_(p.brand); return json_(agePoll_(p.id)); }

    // Listing health. create/poll = the listings report (status/price/qty â€” "is it broken");
    // content = a 20-ASIN catalog chunk (title/images/bullets â€” "is it weak"), walked by the browser
    // because a full catalog sweep can't fit in one request.
    if (p.lh === 'create') { setBrand_(p.brand); return json_(lhCreate_()); }
    if (p.lh === 'poll') { setBrand_(p.brand); return json_(lhPoll_(p.id)); }
    if (p.lh === 'content') { setBrand_(p.brand); return json_(lhContent_(p.asins)); }
    if (p.agNow === 'ask') { setBrand_(p.brand); return json_(agNowAsk_()); }
    if (p.agNow === 'get') { setBrand_(p.brand); return json_(agNowGet_(p.id)); }
    if (p.adState === 'build') return json_(adStateAll_());
    // A+ content. `aplusasin` is the authoritative one (publish records per ASIN); `aplus` is the
    // older document-first sweep, kept for diagnosis.
    if (p.lh === 'aplusasin') { setBrand_(p.brand); return json_(lhAplusAsins_(p.asins)); }
    // Weekly BSR snapshot: sales rank + its category for a batch of child ASINs.
    if (p.lh === 'bsr') { setBrand_(p.brand); return json_(lhBsr_(p.asins)); }

    // Nudge the approvers by email. Best effort â€” the app's queue is what actually matters.
    if (p.notify === 'approval') return json_(notifyApproval_(p.to, p.subj, p.body));
    if (p.lh === 'aplus') { setBrand_(p.brand); return json_(lhAplus_(p.token)); }

    var asin = asinFromUrl_(p.asin || '');
    if (!asin) return json_({ ok: false, error: 'No ASIN found in "' + (p.asin || '') + '".' });

    var cat = fetchCatalog_(asin);
    var off = fetchOffers_(asin);
    var price = Number(p.price) > 0 ? Number(p.price) : (off.buyBox || off.lowest);
    if (!price) {
      return json_({ ok: false, asin: asin, title: cat.title, brand: cat.brand,
        category: cat.category, weight: cat.weight, dims: cat.dims, offers: off.offers,
        error: 'This ASIN has no live offer (out of stock / not buyable). Pass a price to override.' });
    }
    var fees = fetchFees_(asin, price);

    return json_({
      ok: true, asin: asin,
      title: cat.title, brand: cat.brand, category: cat.category, weight: cat.weight, dims: cat.dims,
      buyBox: off.buyBox, lowest: off.lowest, offers: off.offers,
      price: price, feePrice: price,
      referral: fees.referral, fba: fees.fba, feeTotal: fees.total,
    });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err).slice(0, 300) });
  }
}

/**
 * Everything that CHANGES something, kept off doGet on purpose.
 *
 * A GET is meant to be safe to repeat â€” browsers prefetch them, proxies cache them, a refresh fires
 * them again. Placing a real shipment down that road is asking for a duplicate parcel. These live
 * on POST, where a repeat is at least a deliberate act, and the fulfilment order id makes even a
 * deliberate repeat harmless.
 *
 * The body arrives as text/plain, NOT application/json. That is not sloppiness: application/json
 * makes the browser send a CORS preflight, and an Apps Script web app cannot answer one. text/plain
 * keeps it a "simple request", which goes straight through. The content is JSON either way.
 */
function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    var p = {};
    try { p = JSON.parse(raw); } catch (x) { return json_({ ok: false, error: 'Body was not JSON.' }); }

    var key = prop_('API_KEY');
    if (!key) return json_({ ok: false, error: 'API_KEY is not set on the backend.' });
    if (String(p.key || '').trim() !== key) return json_({ ok: false, error: 'Unauthorized.' });

    if (p.mail === 'po') return json_(mailPo_(p));
    if (p.mcf === 'preview') return json_(mcfPreview_(p.order || {}));
    if (p.mcf === 'create')  return json_(mcfCreate_(p.order || {}));
    if (p.mcf === 'status')  return json_(mcfStatus_(p.mcfId, p.brand));
    if (p.shopify === 'fulfil') {
      /* The tracking has to go to the store the order is actually in. */
      setShopBrand_(p.shop);
      return json_(shopifyFulfil_(p.orderId, p.trk || [], p.trkCo, p.notify));
    }
    return json_({ ok: false, error: 'Unknown POST action.' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err).slice(0, 400) });
  }
}

/* ===================== GREIGE PO BY MAIL =====================
 *
 * The Replenishment app builds the PO page; this turns it into a PDF and sends it from the account
 * this script is deployed as, with the PDF attached. Only a PO can be sent this way: the subject and
 * body are written here, the number must look like a greige PO, at most five addresses, and at most
 * MAILPO_DAILY a day — so the key cannot be used to send anything else from the owner's mailbox.
 */
var MAILPO_DAILY = 40;
function mailPo_(p) {
  var list = function (s) { return String(s || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean); };
  var to = list(p.to), cc = list(p.cc);
  var okMail = function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); };
  if (!to.length) return { ok: false, error: 'No address to send it to.' };
  var bad = to.concat(cc).filter(function (x) { return !okMail(x); });
  if (bad.length) return { ok: false, error: '"' + bad[0] + '" is not an email address.' };
  if (to.length + cc.length > 5) return { ok: false, error: 'Five addresses at most.' };
  var poNo = String(p.poNo || '').trim().toUpperCase();
  if (!/^GPO-\d{6}-[A-Z0-9]{2,4}$/.test(poNo)) return { ok: false, error: 'That is not a greige PO number.' };
  var html = String(p.html || '');
  if (!html || html.length > 300000) return { ok: false, error: 'The PO page is missing or too large.' };
  /* Nothing that runs: the PDF converter ignores scripts, and so should anything reading the mail. */
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  var day = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();
  var used = parseInt(props.getProperty('MAILPO_' + day) || '0', 10) || 0;
  if (used >= MAILPO_DAILY) return { ok: false, error: 'Daily limit of ' + MAILPO_DAILY + ' PO mails reached. Try tomorrow.' };
  var from = String(p.fromName || 'The Fabric Rush').replace(/[\r\n]/g, ' ').slice(0, 80);
  var msg = String(p.message || '').slice(0, 1500);
  var pdf = Utilities.newBlob(html, 'text/html', poNo + '.html').getAs('application/pdf').setName(poNo + '.pdf');
  MailApp.sendEmail({
    to: to.join(','), cc: cc.join(','), name: from,
    subject: 'Purchase Order ' + poNo + ' - ' + from,
    body: 'Dear Sir/Madam,\n\nPlease find attached our Purchase Order ' + poNo + '.\n\n'
      + (msg ? msg + '\n\n' : '') + 'Kindly confirm receipt and the delivery date.\n\nRegards,\n' + from,
    attachments: [pdf],
  });
  props.setProperty('MAILPO_' + day, String(used + 1));
  return { ok: true, sent: to.length + cc.length };
}

/** Run once from the Apps Script editor so Google asks for permission to send mail. */
function authorizeMail() {
  Logger.log('Mail quota left today: ' + MailApp.getRemainingDailyQuota());
}

/** JSON response. Always HTTP 200 â€” the caller reads `ok`, which keeps error text readable in fetch(). */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ===================== SP-API plumbing ===================== */

function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  return v ? String(v).trim() : '';
}
function marketplaceId_() { return prop_(ACTIVE_PREFIX + '_MARKETPLACE_ID') || 'ATVPDKIKX0DER'; }
function spHost_() {
  var r = (prop_(ACTIVE_PREFIX + '_REGION') || 'na').toLowerCase();
  if (r === 'eu') return 'https://sellingpartnerapi-eu.amazon.com';
  if (r === 'fe') return 'https://sellingpartnerapi-fe.amazon.com';
  return 'https://sellingpartnerapi-na.amazon.com';
}
function getToken_() {
  var pfx = ACTIVE_PREFIX, cacheKey = 'sp_token_' + pfx;
  var cache = CacheService.getScriptCache(), cached = cache.get(cacheKey);
  if (cached) return cached;
  var id = prop_(pfx + '_CLIENT_ID'), secret = prop_(pfx + '_CLIENT_SECRET'), refresh = prop_(pfx + '_REFRESH_TOKEN');
  if (!id || !secret || !refresh) throw new Error(pfx + ' credentials missing in Script Properties.');
  var resp = UrlFetchApp.fetch(LWA_URL, {
    method: 'post',
    payload: { grant_type: 'refresh_token', refresh_token: refresh, client_id: id, client_secret: secret },
    muteHttpExceptions: true,
  });
  var body = JSON.parse(resp.getContentText() || '{}');
  if (resp.getResponseCode() !== 200 || !body.access_token) throw new Error('LWA token failed: ' + resp.getContentText());
  cache.put(cacheKey, body.access_token, 3000);
  return body.access_token;
}
function sp_(path, method, payload) {
  var opt = {
    method: method || 'get', muteHttpExceptions: true,
    headers: { 'x-amz-access-token': getToken_() }, contentType: 'application/json',
  };
  if (payload) opt.payload = JSON.stringify(payload);
  var resp = UrlFetchApp.fetch(spHost_() + path, opt);
  var text = resp.getContentText();
  if (resp.getResponseCode() >= 300) throw new Error('SP-API ' + resp.getResponseCode() + ' on ' + path + ' :: ' + text);
  return text ? JSON.parse(text) : {};
}
/** GET/POST with retry on 429 â€” the Pricing + Fees APIs are heavily rate-limited (~0.5-1 req/sec). */
function spRetry_(path, method, payload) {
  for (var a = 0; a < 4; a++) {
    try { return sp_(path, method, payload); }
    catch (e) {
      var m = String(e.message || '').toLowerCase();
      if (m.indexOf('429') < 0 && m.indexOf('quota') < 0) throw e;
      Utilities.sleep(1500 * (a + 1));
    }
  }
  return sp_(path, method, payload);
}
function num_(v) { var f = parseFloat(v); return isNaN(f) ? 0 : f; }

/* ===================== Amazon Ads API ===================== */
/*
 * A DIFFERENT API from SP-API, with its own credentials. The SP-API LWA app is not authorised for
 * advertising, so PPC figures come from per-brand ADS_* properties: SP_ADS_CLIENT_ID / _SECRET /
 * _REFRESH_TOKEN, and the same three under CPC_. Both brands may legitimately share one set of
 * values (one Amazon Ads login covering both accounts) â€” what separates them then is the PROFILE,
 * which is why profile discovery is the first thing to get right.
 */
var ADS_HOSTS = {
  na: 'https://advertising-api.amazon.com',
  eu: 'https://advertising-api-eu.amazon.com',
  fe: 'https://advertising-api-fe.amazon.com',
};

function adsHost_() {
  // Falls back to the brand's SP-API region, then NA â€” an advertising account lives in the same
  // region as the selling account in every setup here.
  var r = (prop_(ACTIVE_PREFIX + '_ADS_REGION') || prop_(ACTIVE_PREFIX + '_REGION') || 'na').toLowerCase();
  return ADS_HOSTS[r] || ADS_HOSTS.na;
}

function adsClientId_() { return prop_(ACTIVE_PREFIX + '_ADS_CLIENT_ID'); }

/** Access token for the ACTIVE brand's advertising account. Cached for 50 min (they last 60). */
function adsToken_() {
  var pfx = ACTIVE_PREFIX, cacheKey = 'ads_token_' + pfx;
  var cache = CacheService.getScriptCache(), cached = cache.get(cacheKey);
  if (cached) return cached;
  var id = prop_(pfx + '_ADS_CLIENT_ID'), secret = prop_(pfx + '_ADS_CLIENT_SECRET'), refresh = prop_(pfx + '_ADS_REFRESH_TOKEN');
  if (!id || !secret || !refresh) {
    throw new Error('Missing Script Properties: ' + pfx + '_ADS_CLIENT_ID / ' + pfx + '_ADS_CLIENT_SECRET / ' + pfx + '_ADS_REFRESH_TOKEN');
  }
  var resp = UrlFetchApp.fetch(LWA_URL, {
    method: 'post',
    payload: { grant_type: 'refresh_token', refresh_token: refresh, client_id: id, client_secret: secret },
    muteHttpExceptions: true,
  });
  var body = {};
  try { body = JSON.parse(resp.getContentText() || '{}'); } catch (e) {}
  if (resp.getResponseCode() !== 200 || !body.access_token) {
    throw new Error('Ads LWA token failed (' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
  cache.put(cacheKey, body.access_token, 3000);
  return body.access_token;
}

/**
 * One Ads API call for the ACTIVE brand. `profileId` is omitted only by /v2/profiles â€” every other
 * endpoint is scoped to a profile and 401s without it.
 */
function adsCall_(path, method, payload, profileId, accept) {
  var headers = {
    Authorization: 'Bearer ' + adsToken_(),
    'Amazon-Advertising-API-ClientId': adsClientId_(),
  };
  if (profileId) headers['Amazon-Advertising-API-Scope'] = String(profileId);
  if (accept) headers.Accept = accept;
  var opt = { method: method || 'get', muteHttpExceptions: true, headers: headers };
  if (payload) { opt.contentType = accept || 'application/json'; opt.payload = JSON.stringify(payload); }
  var resp = UrlFetchApp.fetch(adsHost_() + path, opt);
  var text = resp.getContentText();
  if (resp.getResponseCode() >= 300) {
    throw new Error('Ads API ' + resp.getResponseCode() + ' on ' + path + ' :: ' + text);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Every advertising profile each brand's credentials can see.
 *
 * This is the connection test: it proves the three properties are right AND shows which profile the
 * PPC pull should be scoped to. A brand failing here reports its own error rather than sinking the
 * whole response â€” one brand's credentials being wrong should not hide that the other's are fine.
 */
function adsProfilesBoth_() {
  var out = {}, saved = ACTIVE_PREFIX;
  ['SP', 'CPC'].forEach(function (b) {
    setBrand_(b);
    try {
      var list = adsCall_('/v2/profiles') || [];
      out[b] = {
        ok: true,
        host: adsHost_(),
        configured: prop_(b + '_ADS_PROFILE_ID') || '',
        profiles: list.map(function (p) {
          var a = p.accountInfo || {};
          return {
            profileId: String(p.profileId),
            country: p.countryCode || '',
            currency: p.currencyCode || '',
            type: a.type || '',
            name: a.name || '',
            marketplace: a.marketplaceStringId || '',
            sellerId: a.id || '',
          };
        }),
      };
    } catch (e) {
      out[b] = { ok: false, error: String(e.message || e) };
    }
  });
  ACTIVE_PREFIX = saved;
  return { ok: true, brands: out };
}

/**
 * Shape-check the ADS_* properties without printing them.
 *
 * "invalid_client" says the client id + secret pair was rejected, which is nearly always a copy
 * mistake rather than a permissions problem: a secret from a different security profile, a value
 * pasted with the label still attached, or one field simply left as the SP-API one. Comparing the
 * PREFIX and LENGTH of each value against what Amazon issues finds all three without ever putting a
 * credential in the execution log.
 */
function adsCheck() {
  var vals = {};
  ['SP', 'CPC'].forEach(function (b) {
    var id = prop_(b + '_ADS_CLIENT_ID'), sec = prop_(b + '_ADS_CLIENT_SECRET'), ref = prop_(b + '_ADS_REFRESH_TOKEN');
    vals[b] = { id: id, sec: sec, ref: ref };
    Logger.log('â”€â”€ ' + b + ' â”€â”€');
    Logger.log('  CLIENT_ID     ' + (id
      ? (id.length + ' chars, starts "' + id.slice(0, 28) + 'â€¦"'
        + (id.indexOf('amzn1.application-oa2-client.') === 0 ? ' âœ…' : ' âŒ should start amzn1.application-oa2-client.'))
      : 'âŒ MISSING'));
    Logger.log('  CLIENT_SECRET ' + (sec
      ? (sec.length + ' chars'
        + (sec.length === 64 && /^[0-9a-f]+$/i.test(sec) ? ' âœ… (64-char hex)'
          : sec.indexOf('amzn1.oa2-cs.') === 0 ? ' âœ… (amzn1.oa2-csâ€¦)'
          : ' âŒ neither 64-char hex nor amzn1.oa2-csâ€¦ â€” looks like the wrong field'))
      : 'âŒ MISSING'));
    Logger.log('  REFRESH_TOKEN ' + (ref
      ? (ref.length + ' chars, starts "' + ref.slice(0, 5) + 'â€¦"'
        + (ref.indexOf('Atzr|') === 0 ? ' âœ…' : ' âŒ should start Atzr|'))
      : 'âŒ MISSING'));
  });
  // Sharing one Amazon Ads login across both brands is normal and fine â€” worth stating plainly so an
  // identical pair does not get "fixed" into a broken one.
  Logger.log('â”€â”€ both brands â”€â”€');
  Logger.log('  same CLIENT_ID     ' + (vals.SP.id === vals.CPC.id ? 'yes' : 'no'));
  Logger.log('  same CLIENT_SECRET ' + (vals.SP.sec === vals.CPC.sec ? 'yes' : 'no'));
  Logger.log('  same REFRESH_TOKEN ' + (vals.SP.ref === vals.CPC.ref ? 'yes' : 'no'));
  Logger.log('  (all three "yes" is valid â€” one login covering both accounts. A MIX of yes and no is');
  Logger.log('   the usual cause of invalid_client: a token from one app with another app\'s secret.)');
}

/* ---------- Getting a refresh token, without curl ----------
 *
 * A refresh token is minted ONCE, by a human logging in and approving. That produces a short-lived
 * `code` in the browser's address bar, which must then be exchanged for the refresh token within
 * about five minutes â€” and each code works exactly once. The exchange is the part people usually do
 * in curl or Postman and get wrong (wrong redirect_uri, expired code, code already spent), so it
 * lives here instead: two functions, run from the editor.
 *
 * ONE-TIME SETUP, per brand, in Script Properties:
 *   <BRAND>_ADS_CLIENT_ID       from the Ads API security profile
 *   <BRAND>_ADS_CLIENT_SECRET   from the same profile
 *   <BRAND>_ADS_REDIRECT_URI    any https URL listed in that profile's "Allowed Return URLs"
 *
 * THEN:
 *   1. run adsAuthUrl()   â†’ open the logged URL, sign in as the account that owns the ads, approve
 *   2. the browser lands on the return URL with ?code=â€¦ in the address bar â€” copy that code value
 *   3. put it in <BRAND>_ADS_AUTH_CODE and run adsExchange() within five minutes
 *   4. copy the refresh token it prints into <BRAND>_ADS_REFRESH_TOKEN
 */

// The sign-in page differs by region; the token endpoint (LWA_URL) does not.
var ADS_AUTH_PAGES = {
  na: 'https://www.amazon.com/ap/oa',
  eu: 'https://eu.account.amazon.com/ap/oa',
  fe: 'https://apac.account.amazon.com/ap/oa',
};

function adsAuthUrl() {
  var saved = ACTIVE_PREFIX;
  ['SP', 'CPC'].forEach(function (b) {
    setBrand_(b);
    var id = prop_(b + '_ADS_CLIENT_ID'), redirect = prop_(b + '_ADS_REDIRECT_URI');
    Logger.log('â”€â”€ ' + b + ' â”€â”€');
    if (!id) { Logger.log('  âŒ set ' + b + '_ADS_CLIENT_ID first'); return; }
    if (!redirect) { Logger.log('  âŒ set ' + b + '_ADS_REDIRECT_URI first (an https URL listed in the security profile\'s Allowed Return URLs)'); return; }
    var region = (prop_(b + '_ADS_REGION') || prop_(b + '_REGION') || 'na').toLowerCase();
    var url = (ADS_AUTH_PAGES[region] || ADS_AUTH_PAGES.na)
      + '?client_id=' + encodeURIComponent(id)
      + '&scope=' + encodeURIComponent('advertising::campaign_management')
      + '&response_type=code'
      + '&redirect_uri=' + encodeURIComponent(redirect);
    Logger.log('  Open this, sign in, approve:');
    Logger.log('  ' + url);
    Logger.log('  Then copy the ?code=â€¦ value from the address bar into ' + b + '_ADS_AUTH_CODE and run adsExchange().');
  });
  ACTIVE_PREFIX = saved;
}

function adsExchange() {
  var any = false;
  ['SP', 'CPC'].forEach(function (b) {
    var code = prop_(b + '_ADS_AUTH_CODE');
    if (!code) return;
    any = true;
    Logger.log('â”€â”€ ' + b + ' â”€â”€');
    var id = prop_(b + '_ADS_CLIENT_ID'), secret = prop_(b + '_ADS_CLIENT_SECRET'), redirect = prop_(b + '_ADS_REDIRECT_URI');
    if (!id || !secret || !redirect) { Logger.log('  âŒ needs ' + b + '_ADS_CLIENT_ID, _CLIENT_SECRET and _ADS_REDIRECT_URI'); return; }
    // A code pasted straight out of the address bar often drags the rest of the query string with
    // it. Cutting at the first & saves a confusing "invalid_grant" that says nothing about why.
    code = String(code).split('&')[0].trim();
    var resp = UrlFetchApp.fetch(LWA_URL, {
      method: 'post',
      payload: {
        grant_type: 'authorization_code', code: code,
        redirect_uri: redirect, client_id: id, client_secret: secret,
      },
      muteHttpExceptions: true,
    });
    var body = {};
    try { body = JSON.parse(resp.getContentText() || '{}'); } catch (e) {}
    if (resp.getResponseCode() !== 200 || !body.refresh_token) {
      Logger.log('  âŒ ' + resp.getResponseCode() + ': ' + resp.getContentText());
      var desc = String(body.error_description || '');
      // Amazon names the offending parameter, so say what was actually sent for it. Printing the
      // value in quotes is the point: a trailing slash or a stray space is invisible otherwise, and
      // that is exactly what this error is almost always about.
      if (desc.indexOf('redirect_uri') >= 0) {
        Logger.log('  â†’ redirect_uri is the problem. This is EXACTLY what was sent, quoted:');
        Logger.log('      "' + redirect + '"');
        Logger.log('    Open the security profile\'s Allowed Return URLs and compare character by');
        Logger.log('    character. Usually it is a trailing slash. Change ' + b + '_ADS_REDIRECT_URI to');
        Logger.log('    match, then run adsAuthUrl() again â€” the code is tied to the URI it was');
        Logger.log('    issued with, so a NEW code is needed after any change here.');
      } else if (desc.indexOf('refresh_token') >= 0 || body.error === 'invalid_grant') {
        Logger.log('  â†’ the code expired (5 min), or was already used once. Codes are single use:');
        Logger.log('    run adsAuthUrl() again and exchange the fresh one straight away.');
      } else if (body.error === 'invalid_client') {
        Logger.log('  â†’ client id and secret are not a matching pair.');
      }
      return;
    }
    Logger.log('  âœ… copy this into ' + b + '_ADS_REFRESH_TOKEN :');
    Logger.log('  ' + body.refresh_token);
    Logger.log('  â€¦then DELETE ' + b + '_ADS_AUTH_CODE â€” it is spent, and leaving it there only');
    Logger.log('  makes the next run look broken.');
  });
  if (!any) Logger.log('Nothing to do: set SP_ADS_AUTH_CODE and/or CPC_ADS_AUTH_CODE first (see adsAuthUrl).');
}

/**
 * SP-API credentials, per brand, checked in the order they can fail.
 *
 * Three separate things get called "credentials not working", and they need different fixes:
 *   1. the properties are not there at all
 *   2. they are there but Amazon will not issue a token   (wrong id/secret/refresh token)
 *   3. a token comes back but the account cannot read      (app not authorised for that seller)
 * So each is reported on its own line instead of one "failed".
 */
function spCheck() {
  var saved = ACTIVE_PREFIX;
  ['SP', 'CPC'].forEach(function (b) {
    setBrand_(b);
    Logger.log('â•â• ' + b + ' (' + (BRAND_LABEL_[b] || b) + ') â•â•');

    var need = [b + '_CLIENT_ID', b + '_CLIENT_SECRET', b + '_REFRESH_TOKEN'];
    var missing = need.filter(function (k) { return !prop_(k); });
    if (missing.length) { Logger.log('  âŒ 1/3 properties â€” missing: ' + missing.join(', ')); return; }
    Logger.log('  âœ… 1/3 properties present');

    try { getToken_(); Logger.log('  âœ… 2/3 Amazon issued a token'); }
    catch (e) { Logger.log('  âŒ 2/3 token: ' + String(e.message || e).slice(0, 240)); return; }

    // A token only proves the app exists. This proves it can actually READ this seller's catalogue,
    // which is the thing the images and the health sweep need.
    try {
      var r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
        '&keywords=cotton&pageSize=1&includedData=summaries', 'get');
      Logger.log('  âœ… 3/3 catalog reachable Â· marketplace ' + marketplaceId_()
        + ' Â· ' + ((r.items || []).length ? 'returned an item' : 'returned no items (still a valid call)'));
    } catch (e) {
      Logger.log('  âŒ 3/3 catalog: ' + String(e.message || e).slice(0, 240));
    }
  });
  ACTIVE_PREFIX = saved;
  Logger.log('');
  Logger.log('All three âœ… on both brands means the Deal planner can fetch each brand\'s own photos,');
  Logger.log('and Listing Health can refresh CPC again instead of showing a stored snapshot.');
}
var BRAND_LABEL_ = { SP: 'Ridhi', CPC: 'CPC' };

/* ---------- Which promo reports does this account actually have? ---------- */
/*
 * Report types differ by account and marketplace, and the documentation lists more than any one
 * seller can pull. Writing a deal calendar against a type Amazon will reject is a day spent finding
 * that out the slow way â€” so this ASKS, once, and prints what came back.
 *
 * Each type is requested with a short, recent date range. A type the account has comes back with a
 * reportId; one it does not comes back 400 with the reason. Nothing is downloaded either way.
 */
var PROMO_REPORT_TYPES = [
  'GET_COUPON_PERFORMANCE_REPORT',
  'GET_PROMOTION_PERFORMANCE_REPORT',
  'GET_SALES_AND_TRAFFIC_REPORT',          // control: known to work, proves the probe itself is sound
];

function promoProbe() {
  var saved = ACTIVE_PREFIX;
  ['SP', 'CPC'].forEach(function (brand) {
    setBrand_(brand);
    Logger.log('â•â• ' + brand + ' â•â•');
    var end = new Date(Date.now() - 2 * 86400000);
    var start = new Date(end.getTime() - 27 * 86400000);
    var f = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
    PROMO_REPORT_TYPES.forEach(function (type) {
      try {
        var body = {
          reportType: type,
          marketplaceIds: [marketplaceId_()],
          dataStartTime: f(start) + 'T00:00:00Z',
          dataEndTime: f(end) + 'T23:59:59Z',
        };
        var r = sp_('/reports/2021-06-30/reports', 'post', body);
        Logger.log('  âœ… ' + type + ' â†’ reportId ' + (r.reportId || '?'));
      } catch (e) {
        var m = String(e.message || e);
        Logger.log('  âŒ ' + type);
        Logger.log('       ' + m.slice(0, 300));
      }
      Utilities.sleep(1500);               // createReport is rate-limited; do not trip it while probing
    });
  });
  ACTIVE_PREFIX = saved;
  Logger.log('');
  Logger.log('A âœ… means the account can pull that report, so a deal calendar can be built on it.');
  Logger.log('A âŒ with "invalid report type" means Amazon has no such report for this account â€”');
  Logger.log('that data can only come from Seller Central by hand or by CSV export.');
}

/**
 * Time one slice of the daily Orders scan, per workbook.
 *
 * A browser gives up on a request long before Apps Script does, so "Failed to fetch" says nothing
 * about WHY. This puts a number on it: if one chunk takes 30 seconds here, the chunk is too big,
 * and no amount of retrying in the browser will change that.
 */
/**
 * Prove the day boundaries line up with Seller Central.
 *
 * A date that is off by one still produces perfectly reasonable-looking totals, so it can sit there
 * for months. This prints the last few days per workbook next to the raw cell it came from, ready to
 * be held against the Sales Snapshot in Seller Central for the same date.
 */
function dayCheck() {
  ORDERS_DATA_IDS.forEach(function (id, ix) {
    var ss = SpreadsheetApp.openById(id), sh = null;
    ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
    if (!sh) { Logger.log('book ' + ix + ': no Orders tab'); return; }
    Logger.log('â•â• book ' + ix + ' Â· ' + sh.getName() + ' Â· script tz ' + Session.getScriptTimeZone() + ' â•â•');
    var r = dailySalesChunk_(ix, 2, 4000, 20);
    Object.keys(r.dates || {}).sort().reverse().slice(0, 6).forEach(function (d) {
      var v = r.dates[d];
      Logger.log('  ' + d + '  sales $' + Math.round(v[0]).toLocaleString() + '  units ' + v[1] + '  orders ' + v[2]);
    });
    // The raw cell, so a mismatch can be traced to the sheet rather than argued about.
    var raw = sh.getRange(2, 3).getValue();
    Logger.log('  row 2 Date cell: ' + raw + '  (type ' + (raw instanceof Date ? 'Date' : typeof raw) + ')'
      + (raw instanceof Date ? ' â†’ reads as ' + Utilities.formatDate(raw, Session.getScriptTimeZone(), 'yyyy-MM-dd') : ''));
  });
  Logger.log('');
  Logger.log('Hold these against Seller Central â†’ Sales Snapshot for the same date. They should match');
  Logger.log('to the dollar; if they are one day out, the boundary is wrong, not the arithmetic.');
}

function dailyTest() {
  for (var ix = 0; ix < ORDERS_DATA_IDS.length; ix++) {
    var t0 = new Date().getTime();
    var r = dailySalesChunk_(ix, 2, 10000, 400);
    var ms = new Date().getTime() - t0;
    if (!r.ok) { Logger.log('âŒ book ' + ix + ': ' + r.error); continue; }
    Logger.log('book ' + ix + ' (' + r.lastRow + ' rows total): 10,000 rows in ' + ms + 'ms Â· '
      + Object.keys(r.dates).length + ' days in range');
    Logger.log('   â†’ a full pass needs about ' + Math.ceil(r.lastRow / 10000) + ' chunks â‰ˆ '
      + Math.round(Math.ceil(r.lastRow / 10000) * ms / 1000) + 's');
  }
}

/**
 * The whole PPC report round trip for both brands: profile â†’ create â†’ poll â†’ download.
 *
 * The app does these three steps across separate HTTP calls, so a failure in any of them arrives in
 * the browser as one line of red text that the next progress message overwrites. Run here, each step
 * either prints what it got or says exactly where it stopped â€” which is the only way to tell
 * "Amazon refused the request" from "the report came back empty" from "nobody ever asked".
 */
function ppcTest() {
  var saved = ACTIVE_PREFIX;
  ['SP', 'CPC'].forEach(function (b) {
    setBrand_(b);
    Logger.log('â•â• ' + b + ' (' + (BRAND_LABEL_[b] || b) + ') â•â•');

    var pid;
    try { pid = adsProfileId_(); Logger.log('  âœ… profile ' + pid); }
    catch (e) { Logger.log('  âŒ profile: ' + String(e.message || e).slice(0, 250)); return; }

    // A short, recent window â€” enough to prove the pipe works without waiting on a big report.
    var end = new Date(Date.now() - 2 * 86400000);
    var start = new Date(end.getTime() - 6 * 86400000);
    var f = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };

    var c;
    try {
      c = ppcCreateRange_(f(start), f(end));
      if (!c.ok) { Logger.log('  âŒ create: ' + c.error); return; }
      Logger.log('  âœ… create ' + f(start) + ' â†’ ' + f(end) + ' Â· reportId ' + c.reportId);
    } catch (e) { Logger.log('  âŒ create: ' + String(e.message || e).slice(0, 250)); return; }

    // Amazon usually takes a couple of minutes. Apps Script has six, so wait a few rounds and say
    // plainly if it is simply still building rather than calling that a failure.
    var st = null;
    for (var i = 0; i < 12; i++) {
      Utilities.sleep(15000);
      try { st = ppcStatus_(c.reportId); } catch (e) { Logger.log('  âŒ poll: ' + String(e.message || e).slice(0, 250)); return; }
      Logger.log('     poll ' + (i + 1) + ': ' + st.status);
      if (st.ready || st.dead || /fail|cancel/i.test(st.status || '')) break;
    }
    if (!st || !st.ready) {
      Logger.log('  â³ not ready after 3 minutes â€” status ' + ((st && st.status) || '?')
        + (st && st.error ? ' Â· ' + st.error : '') + '. That is slow, not broken; the app waits 10.');
      return;
    }

    try {
      var d = ppcFetch_(c.reportId, 'day');
      var n = d.dates ? Object.keys(d.dates).length : 0;
      Logger.log('  âœ… downloaded Â· ' + n + ' day(s) of data');
      if (n) {
        var k = Object.keys(d.dates).sort()[0], v = d.dates[k];
        Logger.log('     e.g. ' + k + ' â†’ impressions ' + v[0] + ', clicks ' + v[1] + ', spend $' + v[2]
          + ', orders ' + v[3] + ', ad sales $' + v[4]);
      } else {
        Logger.log('     Amazon returned a valid but EMPTY report â€” no Sponsored Products activity in');
        Logger.log('     that window for this profile. Check the profile is the advertising account');
        Logger.log('     the campaigns actually run under.');
      }
    } catch (e) { Logger.log('  âŒ download: ' + String(e.message || e).slice(0, 250)); }
  });
  ACTIVE_PREFIX = saved;
}

/** Run this from the Apps Script editor to see both brands' profiles in the log. */
function adsTest() {
  var r = adsProfilesBoth_();
  ['SP', 'CPC'].forEach(function (b) {
    var x = r.brands[b];
    if (!x.ok) { Logger.log('âŒ ' + b + ': ' + x.error); return; }
    Logger.log('âœ… ' + b + ' (' + x.host + ') â€” ' + x.profiles.length + ' profile(s)');
    x.profiles.forEach(function (p) {
      Logger.log('   ' + p.profileId + '  ' + p.country + '  ' + p.type + '  ' + (p.name || '(no name)'));
    });
  });
}

/* ---------- Sponsored Products: spend and ad sales per ASIN ---------- */

// v3 reporting speaks its own media type on both the request and the response.
var ADS_REPORT_MIME = 'application/vnd.createasyncreportrequest.v3+json';

/**
 * The advertising profile this brand's PPC figures belong to.
 *
 * Deliberately REFUSES to guess when more than one seller profile is visible. Both brands may share
 * one Amazon Ads login, and in that case picking "the first seller profile in the US" would quietly
 * charge one brand's spend to the other â€” a wrong number that looks perfectly reasonable on screen.
 * Better to stop and ask for <BRAND>_ADS_PROFILE_ID.
 */
function adsProfileId_() {
  var pfx = ACTIVE_PREFIX;
  var forced = prop_(pfx + '_ADS_PROFILE_ID');
  if (forced) return forced;

  var cache = CacheService.getScriptCache(), key = 'ads_profile_' + pfx, hit = cache.get(key);
  if (hit) return hit;

  var want = (prop_(pfx + '_ADS_COUNTRY') || 'US').toUpperCase();
  var list = adsCall_('/v2/profiles') || [];
  var sellers = list.filter(function (p) {
    return String(p.countryCode || '').toUpperCase() === want
      && String((p.accountInfo || {}).type || '').toLowerCase() === 'seller';
  });
  if (!sellers.length) {
    throw new Error(pfx + ': no ' + want + ' seller profile is visible to these credentials'
      + (list.length ? ' (it can see ' + list.length + ' other profile(s) â€” run adsTest).' : '.'));
  }
  if (sellers.length > 1) {
    throw new Error(pfx + ': ' + sellers.length + ' ' + want + ' seller profiles are visible ('
      + sellers.map(function (p) { return p.profileId + ' ' + ((p.accountInfo || {}).name || '?'); }).join(', ')
      + '). Set ' + pfx + '_ADS_PROFILE_ID so the right account is used.');
  }
  cache.put(key, String(sellers[0].profileId), 21600);
  return String(sellers[0].profileId);
}

/** Ask for a Sponsored Products advertised-product report over the last `days` complete days. */
function ppcCreate_(days) {
  var d = Math.min(Math.max(Number(days) || 30, 1), 90);
  // Ends YESTERDAY: today is still accruing, and a half-day would read as a collapse in spend.
  var end = new Date(Date.now() - 86400000);
  var start = new Date(end.getTime() - (d - 1) * 86400000);
  var f = function (x) { return Utilities.formatDate(x, ORDERS_PT, 'yyyy-MM-dd'); };
  var body = {
    name: 'ppc-' + ACTIVE_PREFIX + '-' + f(start) + '-to-' + f(end),
    startDate: f(start), endDate: f(end),
    configuration: {
      adProduct: 'SPONSORED_PRODUCTS',
      groupBy: ['advertiser'],                 // one row per advertised ASIN, not per campaign
      columns: ['advertisedAsin', 'impressions', 'clicks', 'cost', 'purchases30d', 'sales30d'],
      reportTypeId: 'spAdvertisedProduct',
      timeUnit: 'SUMMARY',                     // the whole window in one row per ASIN
      format: 'GZIP_JSON',
    },
  };
  var r = adsCall_('/reporting/reports', 'post', body, adsProfileId_(), ADS_REPORT_MIME);
  return { ok: true, brand: ACTIVE_PREFIX, reportId: r.reportId || '', status: r.status || '', start: f(start), end: f(end) };
}

/**
 * The same report, but DAILY over an explicit range, so the caller can fold it into weeks.
 *
 * The range is capped at 31 days because that is the v3 reporting limit, and it cannot reach back
 * further than about 95 days because that is how long Amazon keeps the data. Neither is negotiable,
 * so a long history has to be asked for in several passes â€” and the oldest weeks will simply never
 * have ad figures.
 */
function ppcCreateRange_(startDate, endDate) {
  var s = String(startDate || '').slice(0, 10), e = String(endDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) {
    return { ok: false, error: 'start and end must be yyyy-MM-dd.' };
  }
  var days = Math.round((new Date(e + 'T00:00:00Z') - new Date(s + 'T00:00:00Z')) / 86400000) + 1;
  if (days < 1) return { ok: false, error: 'end is before start.' };
  if (days > 31) return { ok: false, error: 'Range is ' + days + ' days; the Ads API allows at most 31 per report.' };

  var body = {
    name: 'ppcw-' + ACTIVE_PREFIX + '-' + s + '-to-' + e,
    startDate: s, endDate: e,
    configuration: {
      adProduct: 'SPONSORED_PRODUCTS',
      groupBy: ['advertiser'],
      // `date` is what makes DAILY meaningful â€” without it every day collapses into one row again.
      columns: ['date', 'advertisedAsin', 'impressions', 'clicks', 'cost', 'purchases30d', 'sales30d'],
      reportTypeId: 'spAdvertisedProduct',
      timeUnit: 'DAILY',
      format: 'GZIP_JSON',
    },
  };
  // Same 425 handling as the wide reports — a restarted pass asks for these exact windows again.
  return adsAsk_(body, { brand: ACTIVE_PREFIX, kind: 'ppc', start: s, end: e });
}

/** Where a requested report has got to. Amazon takes a few minutes over these. */
function ppcStatus_(id) {
  if (!id) return { ok: false, error: 'No reportId given.' };
  var r = adsCall_('/reporting/reports/' + encodeURIComponent(id), 'get', null, adsProfileId_(), ADS_REPORT_MIME);
  return {
    ok: true, status: r.status || '', ready: r.status === 'COMPLETED',
    url: r.url || '', error: r.failureReason || '',
  };
}

/**
 * Download a finished report and fold it to { ASIN: [impressions, clicks, spend, orders, adSales] }.
 *
 * The download is gzipped JSON from a presigned link â€” that link is NOT an Ads API endpoint, so it
 * carries no auth headers of ours and must be fetched plain.
 */
function ppcFetch_(id, gran) {
  var s = ppcStatus_(id);
  if (!s.ok) return s;
  if (!s.ready || !s.url) return { ok: false, error: 'Report is not ready yet (' + (s.status || '?') + ').' + (s.error ? ' ' + s.error : '') };

  var resp = UrlFetchApp.fetch(s.url, { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Report download failed (' + resp.getResponseCode() + ').');

  var text;
  try {
    text = Utilities.ungzip(resp.getBlob().setContentType('application/x-gzip')).getDataAsString();
  } catch (e) {
    text = resp.getContentText();          // Amazon occasionally hands back plain JSON
  }
  var rows = JSON.parse(text || '[]');
  if (!rows || !rows.length) return { ok: true, n: 0, weekly: false, asins: {} };

  // A DAILY report carries a `date` on every row; a SUMMARY one does not. That single field decides
  // the shape returned â€” flat totals per ASIN, or totals per ASIN per week â€” so the caller never has
  // to say which kind of report it asked for.
  var weekly = !!rows[0].date;

  // gran='day' collapses the ASIN dimension entirely and returns whole-account totals per date â€”
  // what an account trends view needs, and a fraction of the size of the per-ASIN shape.
  //
  // gran='both' returns BOTH shapes from this one download. The nightly run needs each of them, and
  // fetching twice would mean downloading and ungzipping the same report again inside a six-minute
  // budget that is already the tightest thing in the pipeline.
  var g = String(gran || '').toLowerCase();
  var byDate = null;
  if (weekly && (g === 'day' || g === 'both')) {
    byDate = {};
    for (var d = 0; d < rows.length; d++) {
      var y = rows[d], key = String(y.date || '').slice(0, 10); if (!key) continue;
      var t = byDate[key] || (byDate[key] = [0, 0, 0, 0, 0]);
      t[0] += Number(y.impressions) || 0;
      t[1] += Number(y.clicks) || 0;
      t[2] += Number(y.cost) || 0;
      t[3] += Number(y.purchases30d) || 0;
      t[4] += Number(y.sales30d) || 0;
    }
    Object.keys(byDate).forEach(function (k) {
      byDate[k][2] = Math.round(byDate[k][2] * 100) / 100;
      byDate[k][4] = Math.round(byDate[k][4] * 100) / 100;
    });
    if (g === 'day') return { ok: true, n: Object.keys(byDate).length, gran: 'day', dates: byDate };
  }

  // The per-ASIN per-DAY shape, for date ranges that are not whole weeks. Only built for 'both', and
  // only over the recent window â€” it is by far the largest thing this function can return, and the
  // browser pulls it whole.
  var byAsinDay = (g === 'both' && weekly) ? {} : null;
  var dayFrom = byAsinDay ? dayWindowFrom_() : '';

  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var x = rows[i];
    var a = String(x.advertisedAsin || '').trim().toUpperCase(); if (!a) continue;
    var impr = Number(x.impressions) || 0, clk = Number(x.clicks) || 0, cost = Number(x.cost) || 0;
    var pur = Number(x.purchases30d) || 0, sal = Number(x.sales30d) || 0;
    var b;
    if (weekly) {
      var day = String(x.date).slice(0, 10);
      var ms = new Date(day + 'T12:00:00Z').getTime();
      if (isNaN(ms)) continue;
      var wk = weekKeyOf_(ms);
      var byWeek = out[a] || (out[a] = {});
      b = byWeek[wk] || (byWeek[wk] = [0, 0, 0, 0, 0]);
      if (byAsinDay && day >= dayFrom) {
        var ad = byAsinDay[a] || (byAsinDay[a] = {});
        var bd = ad[day] || (ad[day] = [0, 0, 0, 0, 0]);
        bd[0] += impr; bd[1] += clk; bd[2] += cost; bd[3] += pur; bd[4] += sal;
      }
    } else {
      b = out[a] || (out[a] = [0, 0, 0, 0, 0]);
    }
    b[0] += impr; b[1] += clk; b[2] += cost; b[3] += pur; b[4] += sal;
  }
  var round = function (b) { b[2] = Math.round(b[2] * 100) / 100; b[4] = Math.round(b[4] * 100) / 100; };
  Object.keys(out).forEach(function (a) {
    if (weekly) Object.keys(out[a]).forEach(function (w) { round(out[a][w]); });
    else round(out[a]);
  });
  if (byAsinDay) Object.keys(byAsinDay).forEach(function (a) {
    Object.keys(byAsinDay[a]).forEach(function (dd) { round(byAsinDay[a][dd]); });
  });
  var res = { ok: true, n: Object.keys(out).length, weekly: weekly, asins: out };
  if (byDate) { res.gran = 'both'; res.dates = byDate; res.asinDays = byAsinDay || {}; }
  return res;
}

/* ===================== Pictures for a SKU =====================
 *
 * Orders that arrive by IMPORT (CPC Shopify, the Etsy shops) carry no product ids, so the Shopify
 * image lookup cannot help them — and the photo is the thing a packer actually reads. So the picture
 * is found from the SKU instead: SKU -> ASIN out of the seller's own Catalog tab, then ASIN -> image
 * from the catalogue API, the same call the deal planner already uses.
 *
 * Resolved ONCE, at import, and stored on the line. Doing it per render would mean twenty catalogue
 * calls every time somebody opened the tab.
 */
function skuAsinMap_() {
  var out = {}, diag = [];
  ['SP', 'CPC'].forEach(function (brand) {
    var id = (brand === 'CPC') ? CPC_SHEET_ID : RIDHI_SHEET_ID;
    var tab = (brand === 'CPC') ? 'CPC Catalog' : 'Catalog';
    var note = { brand: brand, tab: tab, n: 0 };
    diag.push(note);
    try {
      var ss = SpreadsheetApp.openById(id);
      var sh = ss.getSheetByName(tab);
      if (!sh) {
        note.error = 'no tab named "' + tab + '"';
        note.tabsSeen = ss.getSheets().map(function (x) { return x.getName(); }).slice(0, 25);
        return;
      }
      if (sh.getLastRow() < 2) { note.error = 'that tab is empty'; return; }
      var rows = sh.getRange(1, 1, sh.getLastRow(), Math.min(sh.getLastColumn(), 12)).getValues();
      // BY NAME, not by position. This sheet is maintained by hand and a column inserted in front of
      // ASIN would otherwise start returning the wrong identifier — which fails silently, because a
      // wrong ASIN just yields no picture rather than an error.
      //
      // And the header row is FOUND, not assumed to be row 1. The India workbook taught that one:
      // it opens with a totals strip, and reading row 1 as the header there gave an empty map that
      // was indistinguishable from real emptiness. A hand-kept Catalog tab can do the same.
      var scan = Math.min(rows.length, 10), hr = -1, iSku = -1, iAsin = -1;
      for (var h = 0; h < scan; h++) {
        var head = rows[h].map(function (c) { return String(c).trim().toLowerCase(); });
        var hs = head.indexOf('sku'), ha = head.indexOf('asin');
        if (hs >= 0 && ha >= 0) { hr = h; iSku = hs; iAsin = ha; break; }
      }
      if (hr < 0) {
        note.error = 'no row in the first ' + scan + ' carries both a "SKU" and an "ASIN" column';
        note.row1 = rows[0].map(function (c) { return String(c).slice(0, 20); });
        return;
      }
      note.headerRow = hr + 1;
      var noAsin = 0;
      for (var r = hr + 1; r < rows.length; r++) {
        var sku = String(rows[r][iSku] || '').trim().toUpperCase();
        if (!sku) continue;
        var asin = String(rows[r][iAsin] || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(asin)) { noAsin++; continue; }
        if (!out[sku]) { out[sku] = asin; note.n++; }
      }
      if (noAsin) note.noAsin = noAsin;
    } catch (e) {
      // Still not fatal — the other brand may answer — but it is now SAID, not swallowed.
      note.error = 'cannot open that workbook: ' + (e.message || e);
    }
  });
  return { map: out, diag: diag };
}

/** sku -> image URL, for as many of the given SKUs as the catalogue can answer for. */
function skuImages_(skusCsv) {
  var want = String(skusCsv || '').split(',').map(function (x) { return x.trim().toUpperCase(); })
    .filter(Boolean);
  if (!want.length) return { ok: true, n: 0, asked: 0, d: {} };
  var cat = skuAsinMap_(), map = cat.map;
  var asinOf = {}, asins = [], miss = [];
  want.forEach(function (sku) {
    var a = map[sku];
    if (a) { asinOf[sku] = a; if (asins.indexOf(a) < 0) asins.push(a); }
    else miss.push(sku);
  });
  var imgOf = {}, hurt = 0;
  // Twenty at a time: the catalogue call rejects the whole batch past that.
  for (var i = 0; i < asins.length; i += 20) {
    var chunk = asins.slice(i, i + 20);
    try {
      var r = lhImages_(chunk.join(','));
      var got = (r && (r.d || r.imgs || r.images)) || {};
      Object.keys(got).forEach(function (a) { if (got[a]) imgOf[a] = got[a]; });
    } catch (e) { hurt++; /* one bad chunk must not cost the rest — but it is counted */ }
    if (i + 20 < asins.length) Utilities.sleep(300);
  }
  var out = {};
  want.forEach(function (sku) { var a = asinOf[sku]; if (a && imgOf[a]) out[sku] = imgOf[a]; });
  var res = { ok: true, n: Object.keys(out).length, asked: want.length, d: out, diag: cat.diag };
  // A picture that does not arrive is an empty box, and an empty box reads as "this product has no
  // photo" — not as "the lookup never worked". So anything short of a full answer says why.
  if (res.n < want.length) res.why = skuImgWhy_(cat.diag, miss, asins.length, Object.keys(imgOf).length, hurt);
  return res;
}

/** One sentence a person can act on, built out of what the lookup actually met on the way. */
function skuImgWhy_(diag, miss, nAsin, nImg, hurt) {
  var say = [], broken = [], pairs = 0;
  diag.forEach(function (d) {
    pairs += d.n;
    if (d.error) broken.push(d.tab + ': ' + d.error);
  });
  if (!pairs) {
    say.push('The Catalog tabs gave no SKU \u2192 ASIN pairs at all' +
      (broken.length ? ' \u2014 ' + broken.join('; ') : '') + '.');
  } else {
    if (broken.length) say.push(broken.join('; ') + '.');
    if (miss.length) say.push(miss.length + ' SKU(s) are not in the Catalog tabs (e.g. ' + miss.slice(0, 5).join(', ') + ').');
    if (nAsin && !nImg) say.push('The catalogue returned no image for any of the ' + nAsin + ' ASIN(s) that were found.');
    else if (nAsin && nImg < nAsin) say.push('The catalogue had no image for ' + (nAsin - nImg) + ' of ' + nAsin + ' ASIN(s).');
  }
  if (hurt) say.push(hurt + ' catalogue batch(es) errored.');
  return say.join(' ');
}

/** Editor check: does the Catalog tab give ASINs, and do those ASINs give pictures? */
function skuImgTest() {
  var cat = skuAsinMap_(), map = cat.map;
  cat.diag.forEach(function (d) {
    Logger.log('tab "' + d.tab + '" (' + d.brand + '): ' + d.n + ' pair(s)' +
      (d.headerRow ? ', header on row ' + d.headerRow : '') +
      (d.noAsin ? ', ' + d.noAsin + ' row(s) with a SKU but no valid ASIN' : '') +
      (d.error ? '  \u2192 ' + d.error : ''));
    if (d.tabsSeen) Logger.log('    tabs in that workbook: ' + d.tabsSeen.join(' | '));
    if (d.row1) Logger.log('    row 1 reads: ' + d.row1.join(' | '));
  });
  var keys = Object.keys(map);
  Logger.log(keys.length + ' SKU -> ASIN pair(s) in total');
  if (!keys.length) return;
  var sample = keys.slice(0, 5);
  Logger.log('  e.g. ' + sample.map(function (k) { return k + ' -> ' + map[k]; }).join(' \u00b7 '));
  var r = skuImages_(sample.join(','));
  Logger.log('pictures: ' + r.n + ' of ' + r.asked + (r.why ? '  \u2192 ' + r.why : ''));
  Object.keys(r.d).forEach(function (k) { Logger.log('   ' + k + ': ' + String(r.d[k]).slice(0, 90)); });
}

/* ===================== Listing optimiser: what the listing IS today =====================
 *
 * Step one of the optimiser is not advice, it is FACTS: what Amazon currently holds for this ASIN.
 * Everything suggested downstream is measured against this, so a wrong or half-read "current" makes
 * every suggestion after it wrong in the same direction and nothing on screen would show it.
 *
 * Three things this deliberately does NOT do:
 *
 *   It does not guess at a missing field. `bullet_point` and `product_description` come back on the
 *   Catalog attributes for a listing this seller contributes to, and NOT AT ALL for one they do not.
 *   An empty array from "Amazon sent nothing" and one from "the seller wrote no bullets" are opposite
 *   problems with opposite fixes, so both are reported, separately, along with the attribute keys
 *   Amazon actually returned.
 *
 *   It does not read BACKEND SEARCH TERMS, because the Catalog API does not carry them and nothing
 *   else public does. They are seller-private and live only on the Listings Items API
 *   (/listings/2021-08-01, `generic_keyword`), which needs the Product Listing role and the seller's
 *   merchant token. Until those exist the field is reported as UNKNOWN, never as empty — an empty
 *   keyword box reads as "no keywords set", which is a decision somebody would act on.
 *
 *   It does not score anything. Scoring belongs with the keyword evidence, which comes from SQP and
 *   the ads search-term cache, not from here.
 */
function listingAudit_(asin) {
  var a = String(asin || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(a)) return { ok: false, error: 'That is not an ASIN: "' + asin + '"' };

  var r;
  try {
    r = spRetry_('/catalog/2022-04-01/items/' + a + '?marketplaceIds=' + marketplaceId_() +
      '&includedData=summaries,attributes,images,salesRanks', 'get');
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 300) };
  }

  var s = (r.summaries && r.summaries[0]) || {};
  var at = r.attributes || {};
  var out = {
    ok: true, asin: a,
    title: String(s.itemName || ''),
    brand: s.brandName || s.brand || '',
    category: (s.browseClassification && s.browseClassification.displayName) || '',
    // WHAT AMAZON ACTUALLY SENT. Without this list, a blank bullets box is unexplainable: it could be
    // the seller's fault, the role's fault, or this code reading the wrong field name.
    attrKeys: Object.keys(at).sort(),
  };

  // Marketplace-scoped attributes arrive as arrays of {value, marketplace_id}. Flattened here so
  // nothing downstream has to know that shape.
  function vals(key) {
    var v = at[key];
    if (!v) return null;
    if (!Array.isArray(v)) v = [v];
    return v.map(function (x) {
      return (x && typeof x === 'object') ? String(x.value == null ? '' : x.value) : String(x);
    }).filter(function (t) { return t !== ''; });
  }

  var bp = vals('bullet_point');
  out.bullets = bp || [];
  out.bulletsKnown = !!bp;          // false = Amazon sent no bullet_point at all, NOT "no bullets"

  var pd = vals('product_description');
  out.description = pd ? pd.join('\n') : '';
  out.descriptionKnown = !!pd;

  /* Attributes Amazon already holds, which the title rules measure against. These are FACTS about
   * the listing, so suggesting one be added to a title is not inventing a claim — and size and
   * colour are exactly what a shopper scans a results page for. `item_type_keyword` is Amazon's own
   * word for what the product IS, which saves guessing the product type out of the title text. */
  var first = function (k) { var v = vals(k); return v && v.length ? v[0] : ''; };
  out.itemType = first('item_type_keyword');
  out.size = first('size');
  out.color = first('color');
  out.material = first('material');
  out.listPrice = first('list_price');

  // Backend keywords are never on this API. Said out loud rather than left to look empty.
  out.searchTerms = null;
  out.searchTermsWhy = 'Backend search terms are not on the Catalog API and are not public anywhere. '
    + 'They need the Listings Items API (/listings/2021-08-01, generic_keyword), which requires the '
    + 'Product Listing role and this brand’s merchant token.';

  /* IMAGES, BY SLOT. The count on its own says nothing: seven images with no dimensions shot and no
   * close-up is a different listing from seven that cover the set. Amazon names the slots (MAIN,
   * PT01..PT08, SWCH), so what is MISSING is answerable, not a matter of taste. */
  var imgs = (r.images && r.images[0] && r.images[0].images) || [];
  var slots = {}, small = [];
  imgs.forEach(function (im) {
    if (!im || !im.variant || !im.link) return;
    var w = Number(im.width) || 0, h = Number(im.height) || 0;
    var cur = slots[im.variant];
    // One variant comes back at several sizes; keep the largest, which is the one Amazon serves for
    // zoom and the only one whose resolution is worth judging.
    if (!cur || w > cur.w) slots[im.variant] = { w: w, h: h, link: im.link };
  });
  Object.keys(slots).forEach(function (k) {
    // Below 1000px on the long side Amazon does not offer zoom, and zoom is measurably worth having.
    var v = slots[k];
    if (Math.max(v.w, v.h) < 1000) small.push(k + ' (' + v.w + 'x' + v.h + ')');
  });
  out.images = {
    slots: slots,
    n: Object.keys(slots).length,
    hasMain: !!slots.MAIN,
    noZoom: small,
    // PT01..PT06 is the set Amazon's own guidance asks for; naming the empty ones turns "add more
    // images" into a job somebody can actually do.
    emptySlots: ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06'].filter(function (k) { return !slots[k]; }),
  };

  var sr = (r.salesRanks && r.salesRanks[0]) || {};
  var ranks = (sr.classificationRanks || []).concat(sr.displayGroupRanks || []);
  out.rank = ranks.length ? { title: ranks[0].title || '', value: Number(ranks[0].rank) || 0 } : null;

  return out;
}

/**
 * Editor check: run this ONCE before trusting any of the above.
 *
 * It answers the question the whole optimiser is built on and which no amount of reading the docs
 * settles: does Amazon return bullet_point and product_description for THIS seller's own ASINs?
 * If it does, the Listings Items API is needed only for the backend keywords. If it does not, it is
 * needed for all three, and that changes what can be built before the role arrives.
 */
function listingAuditTest(asin) {
  /* FINDS ITS OWN ASIN. The editor's Run button cannot pass an argument, so a test that needs one is
   * a test nobody runs — it just prints "pass an ASIN" and stops. The seller's own Catalog tab
   * already maps SKU to ASIN, so there is a real listing to hand without asking for anything. */
  var a = asin || prop_('TEST_ASIN');
  if (!a) {
    var cat = skuAsinMap_();
    var keys = Object.keys(cat.map || {});
    if (keys.length) {
      a = cat.map[keys[0]];
      Logger.log('No ASIN given — using ' + a + ' (SKU ' + keys[0] + ') from the Catalog tab. '
        + keys.length + ' listing(s) available.');
    }
  }
  if (!a) {
    Logger.log('No ASIN to test. Pass one as the argument, or set TEST_ASIN, '
      + 'or check that the Catalog tab has SKU and ASIN columns (run skuImgTest).');
    return;
  }
  var r = listingAudit_(a);
  if (!r.ok) { Logger.log('FAILED: ' + r.error); return; }
  Logger.log('ASIN ' + r.asin + '  brand=' + r.brand + '  category=' + r.category);
  Logger.log('TITLE (' + r.title.length + ' chars): ' + r.title);
  Logger.log('BULLETS: ' + (r.bulletsKnown
    ? r.bullets.length + ' returned'
    : 'Amazon sent NO bullet_point attribute at all — the Listings Items API is needed for these too'));
  r.bullets.forEach(function (b, i) { Logger.log('   ' + (i + 1) + '. (' + b.length + ') ' + b.slice(0, 120)); });
  Logger.log('DESCRIPTION: ' + (r.descriptionKnown
    ? r.description.length + ' chars' : 'not returned by the Catalog API'));
  Logger.log('IMAGES: ' + r.images.n + ' slot(s) — ' + Object.keys(r.images.slots).join(', '));
  if (r.images.emptySlots.length) Logger.log('   empty: ' + r.images.emptySlots.join(', '));
  if (r.images.noZoom.length) Logger.log('   under 1000px (no zoom): ' + r.images.noZoom.join(', '));
  Logger.log('SEARCH TERMS: unknown by design — ' + r.searchTermsWhy);
  Logger.log('ATTRIBUTE KEYS AMAZON RETURNED (' + r.attrKeys.length + '):');
  Logger.log('   ' + r.attrKeys.join(', '));
}

/* ===================== Listing optimiser: what the listing DOES NOT SAY =====================
 *
 * The suggestions are only worth anything if they come from evidence, so this is the evidence: the
 * search terms shoppers actually used on the way to buying this ASIN, and which of their words the
 * listing does not contain anywhere.
 *
 * WORD BY WORD, NOT PHRASE BY PHRASE. Amazon indexes the words of a listing, not its phrases — a
 * listing containing "cotton" and "bottle" and "sleeve" can be found by "cotton bottle sleeve"
 * without those three words ever standing together. So testing whether the PHRASE appears would
 * report almost every term as missing and bury the handful that really are. The test is: which of a
 * term's words are absent from the listing altogether.
 *
 * The terms come from the ads cache, which is real spend and real orders. Search terms carry no
 * ASIN — Amazon reports them against the AD GROUP — so the join is ASIN → ad groups → their terms,
 * and a group holding several ASINs means its terms belong to all of them. That is a real limit of
 * the report, not of this code, and it is stated on the way out rather than hidden.
 */
var LKW_STOP = ('a,an,and,are,as,at,be,by,for,from,has,in,is,it,its,of,on,or,that,the,to,with,'
  + 'you,your,my,our,this,these,those,i,we,they,them,he,she,his,her,not,no,do,does,did,'
  + 'have,had,but,if,so,than,then,too,very,can,will,just,also,into,out,up,down,over,under').split(',');

/** The words a piece of listing text actually contains. */
function lkwWords_(text) {
  var out = {};
  String(text || '').toLowerCase()
    // Punctuation splits words, but a hyphen inside a word does not: "quick-dry" is searched both
    // ways, so it is kept whole AND split.
    .replace(/[^a-z0-9\-\s]/g, ' ')
    .split(/\s+/).forEach(function (w) {
      if (!w) return;
      out[w] = 1;
      if (w.indexOf('-') >= 0) w.split('-').forEach(function (p) { if (p) out[p] = 1; });
    });
  return out;
}

/* AN ASIN IS NOT A KEYWORD, and it was topping the list.
 *
 * Shoppers paste ASINs into the search box, and ASIN-TARGETED ads report the targeted ASIN as the
 * "search term" — usually a COMPETITOR's. Both arrive here looking like high-converting words nobody
 * has used: b0gjddnzn3 came back with 5 orders and 269 clicks. There is nothing to do with it. You
 * cannot put it in a title, and if it is a rival's ASIN, putting it anywhere would be worse than
 * useless. Dropped from the words AND from the terms. */
var LKW_ASIN_RE = /^b0[a-z0-9]{8}$/i;

/* Amazon does not reliably match a plural to its singular, but a listing that says "covers" plainly
 * does say "cover" to a reader, and reporting it as missing sends somebody to add a word that is
 * already there. Checked both ways — conservative, only the trailing s. */
function lkwHas_(have, w) {
  if (have[w] || have[w + 's']) return true;
  if (w.length > 3 && w.charAt(w.length - 1) === 's' && have[w.slice(0, -1)]) return true;
  return false;
}

/* THE SAME SIZE, WRITTEN ANOTHER WAY — and deliberately NOT called covered.
 *
 * Shoppers search "18x18". The listing says 18" x 18", which breaks into the words 18 and 18. Whether
 * Amazon matches one to the other depends on how it tokenises that string, and I do not know that for
 * certain. Both confident answers are dangerous in opposite directions: calling it MISSING sends
 * somebody to add a size their title already states, and calling it COVERED hides a query the listing
 * may genuinely not rank for — and that one only shows up as sales that never happen.
 *
 * So it is neither. It comes back as its own state, with both forms shown, and the person who can
 * check it decides. The cheap move is to put the joined form in the BACKEND keywords, where it costs
 * nothing and removes the question.
 */
function lkwSizeAlt_(have, w) {
  var m = w.match(/^([0-9]+(?:\.[0-9]+)?)[x\u00d7]([0-9]+(?:\.[0-9]+)?)$/);
  return !!(m && have[m[1]] && have[m[2]]);
}

/** Content words of a search term — stopwords and single characters carry no index weight. */
function lkwTermWords_(term) {
  var out = [], seen = {};
  String(term || '').toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ').split(/\s+/).forEach(function (w) {
    if (!w || w.length < 2) return;
    if (LKW_STOP.indexOf(w) >= 0) return;
    if (LKW_ASIN_RE.test(w)) return;
    if (seen[w]) return;
    seen[w] = 1; out.push(w);
  });
  return out;
}

function listingKeywords_(asin) {
  var a = String(asin || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(a)) return { ok: false, error: 'That is not an ASIN: "' + asin + '"' };

  var audit = listingAudit_(a);
  if (!audit.ok) return audit;

  var stC = cacheRead_('srchTerm'), agC = cacheRead_('adGroup');
  if (!stC || !agC) {
    return { ok: false, error: 'The ads search-term cache has not been built yet. It is collected by '
      + 'the nightly run — check nightlyStatus() for srchTerm and adGroup.' };
  }

  /* Which ad groups advertise this ASIN. Both caches are per brand, so this walks whatever brands
   * the cache holds rather than assuming the one the request set. */
  var mine = {}, shared = 0;
  Object.keys(agC.d || {}).forEach(function (brand) {
    var groups = (agC.d[brand] && agC.d[brand].groups) || {};
    Object.keys(groups).forEach(function (ag) {
      var list = groups[ag].a || [];
      if (list.indexOf(a) < 0) return;
      mine[ag] = { name: groups[ag].n || '', campaign: groups[ag].cn || '',
        asins: list.length, clean: list.length === 1 };
      // A group carrying several ASINs cannot attribute its terms to one of them. Counted, and said.
      if (list.length > 1) shared++;
    });
  });
  if (!Object.keys(mine).length) {
    return { ok: true, asin: a, terms: [], missing: [], words: [],
      why: 'No advertising ad group carries this ASIN, so there are no search terms to read for it. '
        + 'A product with no Sponsored Products history has no keyword evidence here — the listing '
        + 'can still be judged on its title, bullets and images.' };
  }

  // Every term reported against those groups, added up.
  var byTerm = {};
  Object.keys(stC.d || {}).forEach(function (brand) {
    ((stC.d[brand] && stC.d[brand].rows) || []).forEach(function (r) {
      if (!mine[r.ag]) return;
      var t = String(r.t || '').toLowerCase().trim();
      if (!t) return;
      if (LKW_ASIN_RE.test(t)) return;              // an ASIN is not a keyword
      var b = byTerm[t] || (byTerm[t] = { t: t, i: 0, c: 0, o: 0, s: 0, sp: 0, clean: false });
      // A term seen in even ONE single-ASIN group is safely this product's.
      if (mine[r.ag].clean) b.clean = true;
      b.i += Number(r.i) || 0; b.c += Number(r.c) || 0;
      b.o += Number(r.o) || 0; b.s += Number(r.s) || 0; b.sp += Number(r.sp) || 0;
    });
  });

  // What the listing says, everywhere a shopper's word could be indexed from.
  /* WHAT "the listing never says" WAS CHECKED AGAINST. Returned, because the claim is only as good as
   * the text behind it: if the bullets never arrived, every word looks missing and the whole table is
   * noise that reads like insight. */
  var checked = { title: (audit.title || '').length, bullets: (audit.bullets || []).length,
    description: (audit.description || '').length };
  var have = lkwWords_([audit.title, (audit.bullets || []).join(' '), audit.description].join(' '));

  /* CLEAN AND CONTAMINATED EVIDENCE ARE COUNTED SEPARATELY, NEVER BLENDED.
   *
   * A note saying "some of these may belong to a sibling" is not enough when EVERY group is shared:
   * the first run of this returned pillow, scalloped, euro sham, quilted bag and desk organiser for
   * one ASIN, all of them real terms belonging to other products. A list like that is not a weak
   * answer, it is a wrong one, and acting on it puts a neighbour's words in this listing's title.
   *
   * A term seen in even one SINGLE-ASIN group is this product's beyond doubt; everything else is
   * held apart and labelled. Where there is no clean evidence at all, that is said plainly instead of
   * handing over the contaminated list with a caveat nobody reads. */
  var terms = [], missWord = {}, missClean = {}, altAlt = {};
  Object.keys(byTerm).forEach(function (t) {
    var b = byTerm[t];
    var words = lkwTermWords_(t);
    var raw = words.filter(function (w) { return !lkwHas_(have, w); });
    // Split off the sizes the listing DOES state, just in another form. They are neither missing nor
    // safely covered, so they are counted apart and never mixed into the "never says" list.
    var altForms = raw.filter(function (w) { return lkwSizeAlt_(have, w); });
    var absent = raw.filter(function (w) { return !lkwSizeAlt_(have, w); });
    altForms.forEach(function (w) {
      var m = altAlt[w] || (altAlt[w] = { w: w, orders: 0, clicks: 0, impr: 0, terms: 0, eg: [] });
      m.orders += b.o; m.clicks += b.c; m.impr += b.i; m.terms++;
      if (m.eg.length < 3) m.eg.push(t);
    });
    b.words = words.length;
    b.absent = absent;
    b.covered = absent.length === 0;
    terms.push(b);
    // A word is worth adding in proportion to what the terms containing it actually did.
    absent.forEach(function (w) {
      [missWord, b.clean ? missClean : null].forEach(function (bag) {
        if (!bag) return;
        var m = bag[w] || (bag[w] = { w: w, orders: 0, clicks: 0, impr: 0, terms: 0, eg: [] });
        m.orders += b.o; m.clicks += b.c; m.impr += b.i; m.terms++;
        if (m.eg.length < 4) m.eg.push(t);
      });
    });
  });

  var byOrders = function (x, y) { return (y.o - x.o) || (y.c - x.c) || (y.i - x.i); };
  terms.sort(byOrders);
  var missing = terms.filter(function (b) { return !b.covered; }).slice(0, 120);
  var rank = function (bag) {
    return Object.keys(bag).map(function (w) { return bag[w]; })
      .sort(function (x, y) { return (y.orders - x.orders) || (y.clicks - x.clicks) || (y.impr - x.impr); })
      .slice(0, 60);
  };
  var words = rank(missClean), wordsShared = rank(missWord), altSizes = rank(altAlt);
  var nClean = terms.filter(function (b) { return b.clean; }).length;

  return {
    ok: true, asin: a, checked: checked,
    title: audit.title, bullets: audit.bullets, description: audit.description,
    groups: Object.keys(mine).length, sharedGroups: shared,
    nTerms: terms.length, nClean: nClean,
    terms: terms.slice(0, 120),
    missing: missing,
    // THE ACTIONABLE LIST, from single-ASIN ad groups only. Terms are evidence; WORDS are what goes
    // into a title, a bullet or the backend keywords, and one word usually fixes several terms.
    words: words,
    // The same worked out over every group, contaminated ones included. Kept so the tool can OFFER
    // it, clearly marked, rather than pretending the evidence does not exist — but never as the
    // headline, because these words may be a neighbouring product's.
    wordsShared: wordsShared,
    // Sizes the listing states in a DIFFERENT FORM. Not missing, not confidently covered.
    altSizes: altSizes,
    trust: nClean ? 'clean' : (terms.length ? 'shared' : 'none'),
    note: !terms.length ? ''
      : nClean
        ? (shared ? shared + ' of the ' + Object.keys(mine).length + ' ad group(s) also carry other ASINs; '
            + 'their terms are held back and only the ' + nClean + ' term(s) from single-product groups '
            + 'are used above.' : '')
        : 'EVERY ad group carrying this ASIN also carries others, so NOTHING here can be attributed to '
          + 'this product with confidence. Amazon reports search terms against the ad group, not the '
          + 'ASIN. The words below are the whole ad group, and may belong to a sibling — to get '
          + 'per-ASIN terms, either split the ad groups so one group advertises one product, or use '
          + 'the Search Query Performance report, which is reported per ASIN.',
  };
}

/**
 * HOW MUCH OF THE AD EVIDENCE IS USABLE AT ALL — across every advertised ASIN, not one.
 *
 * B0GK8Z2L13 came back with zero clean terms, and the next decision (build the suggestions on ads
 * data, or add the Search Query Performance report first) turns entirely on whether that is one
 * awkward product or the normal shape of this account. Guessing it would mean building the wrong
 * half first.
 *
 * Reads only the adGroup cache — no API calls, no reports, so it is instant and can be re-run any
 * time the ad structure changes.
 */
function listingKeywordsCoverage() {
  var agC = cacheRead_('adGroup');
  if (!agC) { Logger.log('No adGroup cache yet — check nightlyStatus().'); return; }

  var clean = {}, dirty = {}, groupsPer = {};
  Object.keys(agC.d || {}).forEach(function (brand) {
    var groups = (agC.d[brand] && agC.d[brand].groups) || {};
    Object.keys(groups).forEach(function (ag) {
      var list = groups[ag].a || [];
      list.forEach(function (asin) {
        groupsPer[asin] = (groupsPer[asin] || 0) + 1;
        if (list.length === 1) clean[asin] = (clean[asin] || 0) + 1;
        else dirty[asin] = (dirty[asin] || 0) + 1;
      });
    });
  });

  var all = Object.keys(groupsPer);
  var withClean = all.filter(function (a) { return clean[a]; });
  var onlyDirty = all.filter(function (a) { return !clean[a]; });
  Logger.log(all.length + ' ASIN(s) have ad history.');
  Logger.log('  ' + withClean.length + ' (' + Math.round(withClean.length / all.length * 100)
    + '%) sit in at least one SINGLE-PRODUCT ad group — these get trustworthy keyword evidence.');
  Logger.log('  ' + onlyDirty.length + ' (' + Math.round(onlyDirty.length / all.length * 100)
    + '%) are ONLY in shared groups — for these the ads data cannot say which product a term belongs to.');

  // Group sizes, because "shared" covers everything from a pair to a catch-all of two hundred.
  var sizes = {};
  Object.keys(agC.d || {}).forEach(function (brand) {
    var groups = (agC.d[brand] && agC.d[brand].groups) || {};
    Object.keys(groups).forEach(function (ag) {
      var n = (groups[ag].a || []).length;
      var band = n === 1 ? '1' : n <= 3 ? '2-3' : n <= 10 ? '4-10' : n <= 30 ? '11-30' : '30+';
      sizes[band] = (sizes[band] || 0) + 1;
    });
  });
  Logger.log('');
  Logger.log('AD GROUPS BY HOW MANY PRODUCTS THEY CARRY:');
  ['1', '2-3', '4-10', '11-30', '30+'].forEach(function (b) {
    if (sizes[b]) Logger.log('   ' + b + ' product(s): ' + sizes[b] + ' group(s)');
  });
  Logger.log('');
  Logger.log(withClean.length && withClean.length / all.length > 0.5
    ? 'VERDICT: most products have clean evidence — the ads cache is enough to build the suggestions on.'
    : 'VERDICT: most products have NO clean evidence. The ads cache alone cannot answer "which words '
      + 'does THIS listing miss" for them. Either the ad groups get split one product per group, or '
      + 'the Search Query Performance report is needed, which reports per ASIN.');
}

/** Editor check: the keyword evidence for one real listing, and what it is not saying. */
function listingKeywordsTest(asin) {
  var a = asin || prop_('TEST_ASIN');
  if (!a) {
    var cat = skuAsinMap_(), keys = Object.keys(cat.map || {});
    // The FIRST catalogue ASIN is rarely an advertised one; prefer a SKU the ads cache has heard of,
    // or this prints "no ad group" on a product that simply was never advertised and proves nothing.
    var agC = cacheRead_('adGroup'), advertised = {};
    Object.keys((agC && agC.d) || {}).forEach(function (b) {
      var g = (agC.d[b] && agC.d[b].groups) || {};
      Object.keys(g).forEach(function (k) { (g[k].a || []).forEach(function (x) { advertised[x] = 1; }); });
    });
    for (var i = 0; i < keys.length && !a; i++) if (advertised[cat.map[keys[i]]]) a = cat.map[keys[i]];
    if (!a && keys.length) a = cat.map[keys[0]];
    Logger.log('No ASIN given — using ' + a + (Object.keys(advertised).length
      ? ' (' + Object.keys(advertised).length + ' ASIN(s) have ad history)' : ''));
  }
  var r = listingKeywords_(a);
  if (!r.ok) { Logger.log('FAILED: ' + r.error); return; }
  Logger.log('ASIN ' + r.asin + ' — ' + r.groups + ' ad group(s), ' + r.nTerms + ' search term(s), '
    + r.nClean + ' of them from single-product groups');
  if (r.why) { Logger.log(r.why); return; }
  if (r.note) Logger.log('NOTE: ' + r.note);
  Logger.log('');
  if (r.trust !== 'clean') {
    // The whole point of the split: on contaminated evidence the tool must not print a confident
    // list. It prints the shared one, labelled, and says what would fix it.
    Logger.log('*** NO CLEAN EVIDENCE FOR THIS ASIN — the words below are the AD GROUP’S, and some');
    Logger.log('*** of them belong to other products. Do not put them in this title as they stand.');
    Logger.log('');
    r.wordsShared.slice(0, 12).forEach(function (w) {
      Logger.log('   [group] ' + w.w + '  —  ' + w.orders + ' order(s), ' + w.clicks + ' click(s)   e.g. ' + w.eg.slice(0, 2).join(' / '));
    });
    Logger.log('');
    Logger.log(r.terms.filter(function (b) { return b.covered; }).length + ' of ' + r.nTerms + ' term(s) already covered.');
    return;
  }
  Logger.log('WORDS THE LISTING NEVER SAYS (top 15, by orders behind them):');
  r.words.slice(0, 15).forEach(function (w) {
    Logger.log('   ' + w.w + '  —  ' + w.orders + ' order(s), ' + w.clicks + ' click(s), '
      + w.impr + ' impression(s), in ' + w.terms + ' term(s)   e.g. ' + w.eg.join(' / '));
  });
  Logger.log('');
  Logger.log('TOP TERMS THAT DID NOT CONVERT INTO THE LISTING (top 10):');
  r.missing.slice(0, 10).forEach(function (b) {
    Logger.log('   "' + b.t + '"  ' + b.o + ' order(s), ' + b.c + ' click(s)  —  missing: ' + b.absent.join(', '));
  });
  var covered = r.terms.filter(function (b) { return b.covered; }).length;
  Logger.log('');
  Logger.log(covered + ' of ' + r.nTerms + ' term(s) are already fully covered by the listing text.');
}

/* ===================== SQP for the WHOLE catalogue, per ASIN =====================
 *
 * The ads search-term cache cannot answer "which words does THIS listing miss" for 98% of the
 * catalogue: Amazon reports ad search terms against the AD GROUP, and 1,701 of 1,734 advertised
 * ASINs sit only in groups that carry several products (measured 2026-08-22, listingKeywordsCoverage).
 * A term from such a group may belong to any of them.
 *
 * Search Query Performance is reported PER ASIN, so it does not have that problem at all. And the
 * `asin` report option is OPTIONAL: leave it out and ONE report covers every product the brand owns.
 * That turns a per-listing question that would need 3,646 report round-trips into a single nightly
 * one.
 *
 * Asking and collecting are separate on purpose — Amazon builds these asynchronously and a report
 * sits at IN_PROGRESS for longer than anyone will watch. The pending id is parked in Script
 * Properties so the editor flow is: run once to ask, run again later to collect.
 */
var SQP_PENDING = 'SQP_ALL_PENDING';
var SQP_CACHE = 'sqp';
var SQP_MAX_Q = 40;          // queries kept per ASIN

/** Ask for one brand-wide SQP report. Returns the id; nothing is collected here. */
function sqpAllAsk_(period) {
  var r = baCreate_('sqp', period || 'MONTH', '');    // no ASIN = every product this brand owns
  if (!r.ok) return r;
  return r;
}

/**
 * Collect a finished brand-wide report into a per-ASIN cache.
 *
 * Only what a listing can act on is kept. The full report is one row per ASIN per query and runs to
 * tens of thousands of rows; the cache sheet has already been broken once by a report nobody trimmed
 * (see the search-term cut). Queries are kept per ASIN, best first, capped — and WHAT WAS DROPPED IS
 * COUNTED, because a silent cap reads as "this is everything".
 */
/* One Search Query Performance row, read EXPLICITLY.
 *
 * The generic shaper hunts for field names with regexes, which was fine while nothing depended on
 * getting the right one. Here it is not: this report carries TWO numbers for everything, and they
 * answer opposite questions.
 *
 *   total*  — the WHOLE MARKET for that query. "ruffle pillow covers" drew 96,860 impressions and
 *             1,878 clicks across every seller on Amazon.
 *   asin*   — what THIS listing got out of it: 1,876 impressions, 13 clicks, 2 cart adds.
 *
 * Reading the market number as the product's would tell a seller their listing had 96,860
 * impressions on a query that in fact barely saw them. That is the most expensive mistake this tool
 * could make, because it would be a flattering one — nobody questions a good number.
 *
 * Both are kept, because both matter and they matter differently: the market volume is the size of
 * the opportunity, and the ASIN's share is how much of it the listing is currently taking. A big
 * query with a tiny share is exactly what a listing fix is for.
 */
function sqpRow_(x) {
  var q = x.searchQueryData || {};
  var im = x.impressionData || {};
  var cl = x.clickData || {};
  var ca = x.cartAddData || {};
  var pu = x.purchaseData || {};
  var n = function (v) { return Number(v) || 0; };
  return {
    asin: String(x.asin || '').trim().toUpperCase(),
    q: String(q.searchQuery || '').trim().toLowerCase(),
    // How often the query is searched, and where it ranks. The size of the prize.
    vol: n(q.searchQueryVolume),
    rank: n(q.searchQueryScore),
    // THIS listing.
    i: n(im.asinImpressionCount),
    iShare: n(im.asinImpressionShare),
    c: n(cl.asinClickCount),
    cShare: n(cl.asinClickShare),
    cart: n(ca.asinCartAddCount),
    o: n(pu.asinPurchaseCount),
    oShare: n(pu.asinPurchaseShare),
    // The market, for comparison only. Never to be shown as the listing's own.
    mktI: n(im.totalQueryImpressionCount),
    mktC: n(cl.totalClickCount),
    mktO: n(pu.totalPurchaseCount),
  };
}

function sqpAllCollect_(id, knownAsin) {
  var p = baPoll_(id);
  if (!p.ok) return p;
  if (p.status !== 'done') return { ok: true, status: p.status };
  if (p.kind !== 'sqp') return { ok: false, error: 'That report is not Search Query Performance (got ' + p.kind + ').' };

  /* A REPORT ASKED FOR ONE ASIN DOES NOT REPEAT IT ON EVERY ROW.
   *
   * This is what threw away all 100 rows of the first working report: the collector demanded an
   * `asin` field on each row, and there was none to find, because the request already named it.
   * Amazon was not at fault and neither was the window — the parsing was. When the caller knows
   * which ASIN it asked about, that is the answer for every row. */
  var known = String(knownAsin || '').trim().toUpperCase();
  var byAsin = {}, noAsin = 0, noQuery = 0, kept = 0;
  (p.raw || []).forEach(function (x) {
    var r = sqpRow_(x);
    var a = r.asin || known;
    if (!/^[A-Z0-9]{10}$/.test(a)) { noAsin++; return; }
    if (!r.q) { noQuery++; return; }
    r.asin = a;
    (byAsin[a] || (byAsin[a] = [])).push(r);
  });

  var dropped = 0;
  Object.keys(byAsin).forEach(function (a) {
    var list = byAsin[a];
    // A query is worth keeping in proportion to what it DID, not how often it was searched: a huge
    // query nobody bought from teaches a listing nothing.
    // What the LISTING did first, then the size of the query — a huge query this product never
    // converted is still worth keeping, because that gap is the whole point of the exercise.
    list.sort(function (x, y) { return (y.o - x.o) || (y.c - x.c) || (y.vol - x.vol); });
    if (list.length > SQP_MAX_Q) { dropped += list.length - SQP_MAX_Q; list.length = SQP_MAX_Q; }
    kept += list.length;
  });

  return { ok: true, status: 'done', asins: Object.keys(byAsin).length,
    rows: p.total || 0, kept: kept, dropped: dropped, noAsin: noAsin, noQuery: noQuery,
    // The first raw row, so that when nothing is kept the FIELD NAMES are on screen instead of
    // being guessed at from the outside.
    sample: p.sample || null, d: byAsin };
}

/**
 * Editor flow, two runs.
 *
 * FIRST RUN asks Amazon for the report and parks the id. SECOND RUN (a few minutes later) collects
 * it and writes the cache. Run it a third time and it asks again — the id is cleared once used.
 *
 * This exists to prove the thing the whole design now rests on: that a report asked for WITHOUT an
 * ASIN really does come back with one row per ASIN per query, for every product. If it does not,
 * the per-ASIN plan is wrong and it is better to find out here than after the UI is built on it.
 */
/* SQP IS ONE REPORT PER ASIN. Amazon said so outright when the brand-wide one was tried:
 * "This report type requires the report option(s): asin." So the whole-catalogue idea is dead —
 * 3,646 listings cannot each have a report on demand, and what replaces it is a ROTATION over the
 * products that matter. Before building that, one thing has to be proved: that a report for a
 * product which certainly HAD traffic comes back with rows. The first control returned 0 rows, but
 * it was a low-traffic bottle holder, so zero said nothing either way.
 *
 * This picks the most-advertised ASIN there is — the one with the most ad impressions in the cache —
 * so an empty answer would be a real finding rather than an unlucky pick. */
function sqpTest(period) {
  var props = PropertiesService.getScriptProperties();
  var pend = prop_(SQP_PENDING);

  if (!pend) {
    var pick = sqpBusiestAsin_();
    if (!pick.asin) { Logger.log('No advertised ASIN to test with: ' + pick.why); return; }
    Logger.log('Testing with ' + pick.asin + ' — ' + pick.impr + ' ad impression(s) in the cache, '
      + 'the busiest product there is. An empty report for THIS one would mean something.');
    var r = baCreate_('sqp', period || 'MONTH', pick.asin);
    if (!r.ok) { Logger.log('Could not ask: ' + r.error); return; }
    props.setProperty(SQP_PENDING, r.reportId + '||' + pick.asin);
    Logger.log('Report ' + r.reportId + ' asked for ' + r.period + ' (' + r.window + '). RUN AGAIN in a few minutes.');
    return;
  }

  var parts = pend.split('|'), id = parts[0], asin = parts[2] || '';
  var b = sqpAllCollect_(id, asin);
  if (!b.ok) {
    var dead = /FATAL|CANCELLED/i.test(String(b.error || ''));
    Logger.log((dead ? 'Report failed: ' : 'Not ready: ') + b.error);
    if (b.reason) { Logger.log('AMAZON’S OWN REASON:'); Logger.log('   ' + b.reason); }
    if (dead) props.deleteProperty(SQP_PENDING);
    else Logger.log('The id is still parked — run again shortly.');
    return;
  }
  if (b.status !== 'done') { Logger.log('Still ' + b.status + ' — run again shortly.'); return; }
  props.deleteProperty(SQP_PENDING);

  Logger.log('ASIN ' + asin + ': ' + b.rows + ' row(s), kept ' + b.kept + ' query row(s).');
  if (!b.kept) {
    Logger.log('Nothing kept. ' + b.noAsin + ' row(s) had no ASIN, ' + b.noQuery + ' had no query text.');
    Logger.log('When rows came back but none survived, the fault is in the READING, not the report.');
    if (b.sample) Logger.log('RAW FIRST ROW: ' + JSON.stringify(b.sample).slice(0, 900));
    return;
  }
  Logger.log('(this listing’s own numbers, with the whole query’s market beside them)');
  Object.keys(b.d).forEach(function (a) {
    b.d[a].slice(0, 12).forEach(function (q) {
      Logger.log('   "' + q.q + '"  vol ' + q.vol + '  |  mine: ' + q.i + ' impr, ' + q.c + ' click, '
        + q.cart + ' cart, ' + q.o + ' purch (' + q.iShare + '% of impressions)'
        + '  |  market: ' + q.mktI + ' impr, ' + q.mktO + ' purch');
    });
  });
  Logger.log('');
  Logger.log('SQP WORKS. Next: a nightly rotation — one report per ASIN, N a night, over the products');
  Logger.log('that matter, because the whole catalogue cannot be covered.');
}

/** The advertised ASIN with the most impressions behind it. A meaningful thing to test with. */
function sqpBusiestAsin_() {
  var agC = cacheRead_('adGroup'), stC = cacheRead_('srchTerm');
  if (!agC || !stC) return { asin: '', why: 'the ads caches have not been built yet' };
  var imprOfGroup = {};
  Object.keys(stC.d || {}).forEach(function (brand) {
    ((stC.d[brand] && stC.d[brand].rows) || []).forEach(function (r) {
      imprOfGroup[r.ag] = (imprOfGroup[r.ag] || 0) + (Number(r.i) || 0);
    });
  });
  var best = { asin: '', impr: 0 };
  Object.keys(agC.d || {}).forEach(function (brand) {
    var groups = (agC.d[brand] && agC.d[brand].groups) || {};
    Object.keys(groups).forEach(function (ag) {
      var list = groups[ag].a || [];
      // Split across the ASINs the group carries, so a catch-all of two hundred does not crown a
      // product that happens to sit inside it.
      var share = (imprOfGroup[ag] || 0) / Math.max(1, list.length);
      list.forEach(function (a) {
        var t = (best.byAsin && best.byAsin[a] || 0) + share;
        best.byAsin = best.byAsin || {};
        best.byAsin[a] = t;
        if (t > best.impr) { best.impr = t; best.asin = a; }
      });
    });
  });
  return { asin: best.asin, impr: Math.round(best.impr), why: best.asin ? '' : 'no ASIN carried any impressions' };
}

/* ===================== Listing optimiser: judging a title =====================
 *
 * AMAZON'S RULES, NOT TIKTOK'S. The two tools look similar and their rules are not: TikTok cuts a
 * title at ~40 characters on a phone and wants the product type first with no brand; Amazon shows
 * far more, expects the BRAND first, and indexes every word in the title. Carrying the TikTok rules
 * over would confidently produce worse Amazon titles.
 *
 * What this does NOT do is invent facts. Every suggestion is built from words already in the
 * listing, its own attributes, or the search evidence — never from what the product "probably" is.
 * A title that claims a material or a size the product does not have is a suppression waiting to
 * happen, and it would be this code that wrote it.
 */

/* 75 CHARACTERS. Amazon moved from recommendation to ENFORCEMENT on 27 July 2026: every category
 * except Media is capped at 75 characters including spaces, and Amazon is actively rewriting titles
 * that exceed it (brand owners get 14 days to review its rewrite before it lands).
 *
 * This code said 200 until 2026-08-22, which is the old working limit — so it was calling a
 * 189-character title "inside the limit" when it is two and a half times the cap and Amazon will
 * replace it. Ravi caught that; it was worth checking rather than trusting what was already written.
 *
 * The 200 figure is not gone, it MOVED: the total budget is still 200, now split 75 for the title
 * and 125 for the new ITEM HIGHLIGHTS field. So detail cut from a title is not lost — it has
 * somewhere to go, and saying so is the difference between a useful trim and a destructive one. */
var TT_HARD = 75, TT_HILITE = 125, TT_LONG = 60;

/* Words Amazon's style guide keeps out of titles. Promotional claims, not descriptions — they are
 * also the first thing a listing gets flagged for. */
var TT_BANNED = [
  'best seller', 'bestseller', 'best-seller', 'free shipping', 'sale', 'discount', 'cheap',
  'top rated', 'guarantee', 'guaranteed', '100% quality', 'new arrival', 'limited time',
  'hot item', 'must have', 'amazing', 'perfect gift for everyone',
];

function ttWords_(s) { return String(s || '').trim().split(/\s+/).filter(Boolean); }

/* COMPARING A SIZE TO A TITLE IS A PUNCTUATION PROBLEM, not a text one.
 *
 * The attribute says 12" x 3.75" and the title says 12'' x 3.75'' — the same size, typed two ways,
 * because Amazon's own form and whoever wrote the title reached for different quote characters.
 * Compared literally, the rule reports a size as missing that is already there, and somebody adds it
 * twice. Every kind of quote collapses to one, and so does spacing around x and punctuation. */
function ttNorm_(s) {
  return String(s || '').toLowerCase()
    .replace(/[‘’“”′″]/g, '"')
    .replace(/''/g, '"').replace(/[`´]/g, '"')
    .replace(/\s*x\s*/g, 'x')
    .replace(/[^a-z0-9".]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * What is wrong with a title, as a list of findings — each one checkable, none of them taste.
 *
 * `have` is the listing's own word set, used to answer "is this word anywhere else" so a fix can say
 * whether a word is genuinely absent or merely absent from the title.
 */
function titleFindings_(title, audit) {
  var t = String(title || '');
  var low = t.toLowerCase();
  var out = [];

  if (!t) return [{ k: 'empty', bad: true, msg: 'There is no title.' }];

  if (t.length > TT_HARD) {
    out.push({ k: 'length', bad: true,
      msg: t.length + ' characters, against Amazon’s ' + TT_HARD + '-character cap (enforced since '
        + '27 July 2026, every category except Media). This is not a recommendation — Amazon rewrites '
        + 'titles over the cap itself, and its rewrite is what shoppers will see unless you get there '
        + 'first. The detail you cut belongs in ITEM HIGHLIGHTS, which holds another '
        + TT_HILITE + ' characters.' });
  } else if (t.length > TT_LONG) {
    out.push({ k: 'length', bad: false,
      msg: t.length + ' characters — inside the ' + TT_HARD + '-character cap, with little room left.' });
  }

  // BRAND FIRST. Amazon's style guide asks for it, and a brand buried mid-title reads as a keyword.
  var brand = String((audit && audit.brand) || '').trim();
  if (brand) {
    if (low.indexOf(brand.toLowerCase()) !== 0) {
      out.push({ k: 'brand', bad: true,
        msg: low.indexOf(brand.toLowerCase()) < 0
          ? 'The brand "' + brand + '" is not in the title at all.'
          : 'The title does not START with the brand "' + brand + '".' });
    }
  }

  /* THE PRODUCT TYPE, and where it sits. Amazon returns its own `item_type_keyword` for the listing,
   * so what the product IS does not have to be guessed from the words. A shopper scanning results
   * should meet it early; buried past the halfway mark it is doing nothing. */
  var ptype = String((audit && audit.itemType) || '').replace(/[-_]+/g, ' ').trim();
  /* SOMETIMES item_type_keyword IS THE BROWSE NODE, NOT THE PRODUCT.
   *
   * On B0H367KBV4 it came back as "sports water bottle accessories" — word for word the category
   * name. Told to put that in the title, somebody would, and the title would be worse for it: no
   * shopper types "sports water bottle accessories". A rule that fires confidently on a taxonomy
   * label is worse than one that stays quiet, so when the field is just the category, or ends in a
   * shelf word, it is not used as the product name. */
  var cat = String((audit && audit.category) || '').trim();
  var shelfy = /\s(accessories|products|supplies|sets|items|goods)$/i.test(ptype);
  if (ptype && (ttNorm_(ptype) === ttNorm_(cat) || shelfy)) {
    out.push({ k: 'type', bad: false, skipped: true,
      msg: 'Amazon’s item type for this listing is "' + ptype + '", which is its shelf, not what the '
        + 'product is called — so the title is not judged against it. Name the product in your own '
        + 'words instead, in the first few words.' });
    ptype = '';
  }
  if (ptype) {
    var at = low.indexOf(ptype.toLowerCase());
    if (at < 0) {
      out.push({ k: 'type', bad: true,
        msg: 'Amazon files this as "' + ptype + '" and the title never says it.' });
    } else if (at > t.length / 2) {
      out.push({ k: 'type', bad: false,
        msg: '"' + ptype + '" only appears ' + at + ' characters in — the product type belongs near the front.' });
    }
  }

  /* One phrase, one finding. "guarantee" and "guaranteed" both match the same six letters on the
   * page, and reporting them separately turns one problem into two lines of noise. The longest match
   * wins, because it is the one actually written. */
  var hits = TT_BANNED.filter(function (w) { return low.indexOf(w) >= 0; })
    .sort(function (a, b) { return b.length - a.length; });
  var said = [];
  hits.forEach(function (w) {
    if (said.some(function (o) { return o.indexOf(w) >= 0; })) return;
    said.push(w);
    out.push({ k: 'banned', bad: true, msg: 'Contains "' + w + '", which Amazon’s title guidance disallows.' });
  });

  // ALL-CAPS words. Amazon asks for title case; a shouted word is also a wasted one.
  var caps = ttWords_(t).filter(function (w) {
    return w.length > 3 && w === w.toUpperCase() && /[A-Z]{4}/.test(w);
  });
  if (caps.length) {
    out.push({ k: 'caps', bad: false, msg: caps.length + ' word(s) in capitals (' + caps.slice(0, 4).join(', ')
      + '). Amazon asks for title case.' });
  }

  // A word repeated in a title buys nothing: Amazon indexes it once.
  var seen = {}, dupes = [];
  ttWords_(low.replace(/[^a-z0-9\s]/g, ' ')).forEach(function (w) {
    if (w.length < 4) return;
    if (seen[w] && dupes.indexOf(w) < 0) dupes.push(w);
    seen[w] = 1;
  });
  if (dupes.length) {
    out.push({ k: 'dupe', bad: false,
      msg: 'Repeats ' + dupes.slice(0, 5).map(function (w) { return '"' + w + '"'; }).join(', ')
        + '. Amazon indexes a word once — a repeat costs characters and returns nothing.' });
  }

  /* Attributes Amazon already holds that the title does not mention. These are FACTS from the
   * listing, so putting them in is not a claim — and size and colour are exactly what a shopper
   * scans a results page for. */
  ['size', 'color', 'material'].forEach(function (k) {
    var v = String((audit && audit[k]) || '').trim();
    if (!v) return;
    if (ttNorm_(t).indexOf(ttNorm_(v)) < 0) {
      out.push({ k: 'attr', bad: false, field: k, value: v,
        msg: 'Amazon holds ' + k + ' = "' + v + '" for this listing and the title does not say it.' });
    }
  });

  return out;
}

/** Editor check: judge one real title and print every finding. */
function titleRulesTest(asin) {
  var a = asin;
  if (!a) {
    var cat = skuAsinMap_(), keys = Object.keys(cat.map || {});
    a = prop_('TEST_ASIN') || (keys.length ? cat.map[keys[0]] : '');
  }
  if (!a) { Logger.log('No ASIN to test.'); return; }
  var audit = listingAudit_(a);
  if (!audit.ok) { Logger.log('FAILED: ' + audit.error); return; }
  Logger.log('ASIN ' + audit.asin + '  (' + audit.category + ')');
  Logger.log('TITLE (' + audit.title.length + '): ' + audit.title);
  Logger.log('');
  var f = titleFindings_(audit.title, audit);
  if (!f.length) { Logger.log('No findings — this title passes every rule checked.'); return; }
  f.forEach(function (x) { Logger.log((x.bad ? '  [FIX]  ' : '  [look] ') + x.msg); });
}

/* ===================== Listing optimiser: judging bullets and the description =====================
 *
 * Same discipline as the title rules: every finding is checkable against the listing or against
 * Amazon's own stated guidance, and nothing here invents a fact about the product.
 *
 * The one judgement call worth writing down: an ALL-CAPS LEAD-IN ("PREMIUM QUILTED BOTTLE COVER —")
 * is NOT flagged. Amazon's style guide dislikes capitals, but a short capitalised opener followed by
 * a sentence is the convention across most of the category and it scans well on a phone. A whole
 * bullet in capitals is a different thing and is flagged. Rules that fight a working convention get
 * ignored wholesale, and then the real findings go with them.
 */
var BL_WANT = 5;              // Amazon shows five in almost every category
var BL_LONG = 250;            // past this the tail is cut on a phone
var BL_HARD = 500;            // most categories reject beyond this
var DS_LONG = 2000;

/* Claims Amazon does not allow in bullets or the description. Pricing, availability, contact
 * details and guarantees — the things that get a listing flagged rather than merely ignored. */
var BL_BANNED = [
  'free shipping', 'money back', 'money-back', 'satisfaction guaranteed', 'guarantee',
  'best seller', 'bestseller', 'sale', 'discount', 'cheapest', 'lowest price',
  'www.', 'http', '.com', 'email us', 'contact us', 'call us',
];

function bulletFindings_(bullets, audit) {
  var out = [];
  var list = (bullets || []).map(function (b) { return String(b || ''); }).filter(function (b) { return b.trim(); });

  if (!list.length) {
    return [{ k: 'none', bad: true, msg: 'This listing has no bullet points at all. They are the most '
      + 'read part of a page after the images.' }];
  }
  if (list.length < BL_WANT) {
    out.push({ k: 'count', bad: true,
      msg: 'Only ' + list.length + ' bullet(s). Amazon shows ' + BL_WANT + ' — the empty slots are free space.' });
  }

  var allWords = {}, repeated = {};
  list.forEach(function (b, i) {
    var n = i + 1, low = b.toLowerCase();

    if (b.length > BL_HARD) {
      out.push({ k: 'len', bad: true, bullet: n,
        msg: 'Bullet ' + n + ' is ' + b.length + ' characters. Most categories cut off past ' + BL_HARD + '.' });
    } else if (b.length > BL_LONG) {
      out.push({ k: 'len', bad: false, bullet: n,
        msg: 'Bullet ' + n + ' is ' + b.length + ' characters — a phone shows roughly the first ' + BL_LONG + '.' });
    }

    // A WHOLE bullet shouted. A capitalised opener is the category convention and is left alone.
    var letters = b.replace(/[^a-zA-Z]/g, '');
    if (letters.length > 40 && letters === letters.toUpperCase()) {
      out.push({ k: 'caps', bad: true, bullet: n, msg: 'Bullet ' + n + ' is entirely in capitals.' });
    }

    BL_BANNED.forEach(function (w) {
      if (low.indexOf(w) >= 0) {
        out.push({ k: 'banned', bad: true, bullet: n,
          msg: 'Bullet ' + n + ' contains "' + w + '", which Amazon does not allow in bullets.' });
      }
    });

    // Words shared across bullets. Amazon indexes each once, so a word in all five is four wasted.
    var seenHere = {};
    low.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).forEach(function (w) {
      if (w.length < 5 || seenHere[w]) return;
      seenHere[w] = 1;
      allWords[w] = (allWords[w] || 0) + 1;
      if (allWords[w] >= 4) repeated[w] = allWords[w];
    });
  });

  var rep = Object.keys(repeated);
  if (rep.length) {
    out.push({ k: 'overlap', bad: false,
      msg: rep.slice(0, 6).map(function (w) { return '"' + w + '" (' + repeated[w] + ')'; }).join(', ')
        + ' appear in four or more bullets. Amazon indexes a word once — those repeats are space that '
        + 'could carry something the listing does not say yet.' });
  }

  /* Attributes Amazon holds that no bullet mentions. Facts, not claims — and the bullets are where a
   * shopper looks for exactly these. */
  ['size', 'color', 'material'].forEach(function (k) {
    var v = String((audit && audit[k]) || '').trim();
    if (!v) return;
    /* A SIZE IS NOT A STRING, IT IS ITS NUMBERS.
     *
     * Bullet 2 says "measures 12 inches in height and 3.75 inches in diameter" — the size is plainly
     * stated, just not as 12" x 3.75". Matching the text reports it missing, and somebody adds it a
     * second time. So a size is checked by whether every NUMBER in it appears; colour and material
     * are words, and there the words themselves are the fact. */
    var said;
    if (k === 'size') {
      var nums = v.match(/[0-9]+(?:\.[0-9]+)?/g) || [];
      if (!nums.length) return;
      var text = list.join(' ');
      said = nums.every(function (nm) {
        return new RegExp('(^|[^0-9.])' + nm.replace(/\\./g, '\\\\.') + '([^0-9]|$)').test(text);
      });
    } else {
      said = ttNorm_(list.join(' ')).indexOf(ttNorm_(v)) >= 0;
    }
    if (said) return;
    out.push({ k: 'attr', bad: false, field: k, value: v,
      msg: 'No bullet mentions the ' + k + ' ("' + v + '"), which Amazon already holds for this listing.' });
  });

  return out;
}

function descFindings_(desc, bullets, audit) {
  var d = String(desc || '');
  var out = [];
  if (!d.trim()) {
    return [{ k: 'none', bad: true, msg: 'There is no description. It is indexed, and on a page with '
      + 'no A+ content it is the only place left to answer a question the bullets did not.' }];
  }
  if (d.length > DS_LONG) {
    out.push({ k: 'len', bad: false, msg: d.length + ' characters. Most categories stop indexing past '
      + 'about ' + DS_LONG + '.' });
  }
  if (/<[a-z][^>]*>/i.test(d)) {
    out.push({ k: 'html', bad: false, msg: 'Contains HTML tags. Some categories strip them and show '
      + 'the raw markup instead — worth checking how this renders on the live page.' });
  }
  var low = d.toLowerCase();
  BL_BANNED.forEach(function (w) {
    if (low.indexOf(w) >= 0) {
      out.push({ k: 'banned', bad: true, msg: 'The description contains "' + w + '", which Amazon does not allow.' });
    }
  });

  /* A description that only repeats the bullets is a wasted field: the words are already indexed and
   * the shopper has already read them. */
  var b = (bullets || []).join(' ').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  var bset = {}; b.forEach(function (w) { if (w.length > 4) bset[w] = 1; });
  var dw = low.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 4; });
  var uniq = {}; dw.forEach(function (w) { if (!bset[w]) uniq[w] = 1; });
  var newWords = Object.keys(uniq).length;
  if (dw.length && newWords / dw.length < 0.15) {
    out.push({ k: 'echo', bad: false,
      msg: 'Only ' + Math.round(newWords / dw.length * 100) + '% of the description’s words are not '
        + 'already in the bullets. It is repeating them rather than adding anything.' });
  }
  return out;
}

/** Editor check: judge the bullets and description of one real listing. */
function bulletRulesTest(asin) {
  var a = asin;
  if (!a) {
    var cat = skuAsinMap_(), keys = Object.keys(cat.map || {});
    a = prop_('TEST_ASIN') || (keys.length ? cat.map[keys[0]] : '');
  }
  if (!a) { Logger.log('No ASIN to test.'); return; }
  var r = listingAudit_(a);
  if (!r.ok) { Logger.log('FAILED: ' + r.error); return; }
  Logger.log('ASIN ' + r.asin + '  (' + r.category + ')');
  Logger.log('');
  Logger.log('BULLETS (' + (r.bullets || []).length + '):');
  var bf = bulletFindings_(r.bullets, r);
  if (!bf.length) Logger.log('   nothing to fix.');
  bf.forEach(function (x) { Logger.log((x.bad ? '  [FIX]  ' : '  [look] ') + x.msg); });
  Logger.log('');
  Logger.log('DESCRIPTION (' + r.description.length + ' chars):');
  var df = descFindings_(r.description, r.bullets, r);
  if (!df.length) Logger.log('   nothing to fix.');
  df.forEach(function (x) { Logger.log((x.bad ? '  [FIX]  ' : '  [look] ') + x.msg); });
}

/* ===================== Listing optimiser: the SUGGESTED title =====================
 *
 * The rule this whole file obeys: EVERY WORD IN THE SUGGESTION ALREADY EXISTS. It comes from the
 * current title, from an attribute Amazon holds for the listing, or from a search term shoppers
 * actually used. Nothing is written about the product that was not already true of it.
 *
 * That is not caution for its own sake. A title claiming a material, a size or a certification the
 * product does not have is a suppression, and it would be this function that wrote it — on 3,646
 * listings at once, with nobody reading each one.
 *
 * So this REARRANGES and TRIMS. It does not compose.
 */

/* Words that carry nothing in an Amazon title. Not banned — just the first things to drop when the
 * title has to lose characters, because they say nothing a shopper is searching for. */
var TS_FILLER = ['with', 'and', 'for', 'the', 'a', 'an', 'of', 'in', 'on', 'to', 'your', 'our',
  'perfect', 'great', 'lovely', 'beautiful', 'stylish', 'elegant', 'premium', 'quality'];

/**
 * A suggested title, plus the reason for every change.
 *
 * `add` is the ranked missing-word list when there is trustworthy keyword evidence, and empty when
 * there is not — in which case this still does useful work, because reordering and de-duplicating
 * need no evidence at all.
 */
function titleSuggest_(audit, add, target) {
  /* THE TARGET IS A CHOICE, NOT A RULE, and the difference is worth stating.
   *
   * Amazon's cap is 200 characters. Anything shorter is a decision about what a shopper reads: the
   * first 80 or so are all that show on a phone, so a shorter title puts the words that matter in
   * front of the words that do not. It is a real trade — every phrase dropped is a phrase Amazon can
   * no longer index this listing on — so the caller sets it and everything dropped is named. */
  var cap = Math.max(30, Math.min(Number(target) || TT_HARD, 200));
  var cur = String((audit && audit.title) || '').trim();
  if (!cur) return { ok: false, error: 'No current title to work from.' };

  var brand = String(audit.brand || '').trim();
  var why = [];

  /* The title is read as COMMA-SEPARATED PHRASES, because that is how these titles are written and
   * a phrase is the unit that can be moved or dropped without leaving a fragment behind. Splitting
   * on words instead produces "Cotton Bottle Cover Sleeve Reusable" style rubble. */
  var parts = cur.split(/\s*,\s*/).map(function (p) { return p.trim(); }).filter(Boolean);

  // The brand leads. If it is buried inside the first phrase, it is lifted out rather than repeated.
  var lead = brand;
  if (brand) {
    if (parts.length && parts[0].toLowerCase().indexOf(brand.toLowerCase()) === 0) {
      parts[0] = parts[0].slice(brand.length).replace(/^[\s,\-–—]+/, '');
      if (!parts[0]) parts.shift();
    } else if (cur.toLowerCase().indexOf(brand.toLowerCase()) < 0) {
      why.push('Brand "' + brand + '" put at the front — Amazon asks for it there and it was missing.');
    } else {
      why.push('Brand "' + brand + '" moved to the front.');
    }
  }

  /* De-duplicate WORDS across the whole title. Amazon indexes a word once, so a second "bottle" is
   * characters spent for nothing. The FIRST occurrence stays, because that is the one a reader meets. */
  var seen = {}, dropped = [];
  parts = parts.map(function (p) {
    var kept = p.split(/\s+/).filter(function (w) {
      var k = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!k || k.length < 4) return true;                 // short words are grammar, not keywords
      if (seen[k]) { dropped.push(w); return false; }
      seen[k] = 1;
      return true;
    }).join(' ').trim();
    return kept;
  }).filter(Boolean);
  if (dropped.length) {
    why.push('Removed repeated word(s): ' + dropped.slice(0, 6).join(', ')
      + '. Amazon indexes a word once, so the repeat cost characters and returned nothing.');
  }

  /* Attributes Amazon already holds and the title does not say. FACTS about this listing, so adding
   * one is not a claim. Only colour and size — material is often already in the phrases and is the
   * easiest to get wrong. */
  var extra = [];
  ['color', 'size'].forEach(function (k) {
    var v = String(audit[k] || '').trim();
    if (!v) return;
    var joined = ttNorm_(parts.join(' '));
    if (k === 'size') {
      var nums = v.match(/[0-9]+(?:\.[0-9]+)?/g) || [];
      if (nums.length && nums.every(function (n) { return parts.join(' ').indexOf(n) >= 0; })) return;
    } else if (joined.indexOf(ttNorm_(v)) >= 0) return;
    extra.push(v);
    why.push('Added the ' + k + ' "' + v + '" — Amazon already holds it for this listing and the title did not say it.');
  });

  /* Search words the listing never uses. ONLY from clean evidence: a word taken from a shared ad
   * group may belong to a different product, and putting it here is how a neighbour's keywords end
   * up in this title. The caller decides what counts as clean; this trusts what it is handed. */
  var kw = [];
  (add || []).slice(0, 6).forEach(function (w) {
    var word = String(w.w || w).trim();
    if (!word || seen[word.toLowerCase()]) return;
    kw.push(word);
    seen[word.toLowerCase()] = 1;
  });
  if (kw.length) {
    why.push('Added search word(s) shoppers used and the listing never said: ' + kw.join(', ') + '.');
  }

  var out = [lead].concat(parts.slice(0, 1)).filter(Boolean).join(' ');
  var tail = parts.slice(1).concat(extra.length ? [extra.join(', ')] : []).concat(kw.length ? [kw.join(' ')] : []);

  // TRIM TO FIT, and say what went. Filler goes first, then whole phrases from the END — the front
  // of a title is what a shopper reads and what the index weights.
  var cut = [];
  var build = function () { return [out].concat(tail).filter(Boolean).join(', '); };
  while (build().length > cap && tail.length) {
    var last = tail[tail.length - 1];
    var words = last.split(/\s+/);
    var lean = words.filter(function (w) { return TS_FILLER.indexOf(w.toLowerCase()) < 0; });
    if (lean.length < words.length) { tail[tail.length - 1] = lean.join(' '); continue; }
    cut.push(tail.pop());
  }
  if (cut.length) {
    why.push('Trimmed towards ' + cap + ' characters by dropping from the END, where a title does least '
      + 'work: "' + cut.join('", "') + '". Every one of those is a phrase Amazon can no longer index '
      + 'this listing on — keep them only if the length is worth it.');
  }
  if (build().length > cap) {
    why.push('Could not reach ' + cap + ' characters without cutting into the brand and the product '
      + 'itself, so it stopped at ' + build().length + '.');
  }

  var next = build();
  /* WHAT WAS CUT IS HANDED BACK, not discarded. Since 27 July 2026 the title holds 75 characters and
   * ITEM HIGHLIGHTS holds another 125 — so the phrases trimmed out of a title are not waste, they are
   * the raw material for the field next to it. A tool that only deletes is doing half the job. */
  return { ok: true, current: cur, suggested: next,
    curLen: cur.length, newLen: next.length, why: why,
    cap: cap, cut: cut,
    highlights: cut.length ? cut.join(', ').slice(0, TT_HILITE) : '' };
}

/** Editor check: the current title and the suggested one, side by side, with every reason. */
function titleSuggestTest(asin) {
  var a = asin;
  if (!a) {
    var cat = skuAsinMap_(), keys = Object.keys(cat.map || {});
    a = prop_('TEST_ASIN') || (keys.length ? cat.map[keys[0]] : '');
  }
  var audit = listingAudit_(a);
  if (!audit.ok) { Logger.log('FAILED: ' + audit.error); return; }

  // Only CLEAN keyword evidence is allowed to reach the suggestion.
  var add = [];
  try {
    var kw = listingKeywords_(a);
    if (kw.ok && kw.trust === 'clean') add = kw.words || [];
    else if (kw.ok) Logger.log('(no clean keyword evidence for this ASIN, so no search words are added)');
  } catch (e) { /* keywords are optional here */ }

  var r = titleSuggest_(audit, add);
  if (!r.ok) { Logger.log(r.error); return; }
  Logger.log('ASIN ' + audit.asin);
  Logger.log('');
  Logger.log('CURRENT   (' + r.curLen + '): ' + r.current);
  Logger.log('SUGGESTED (' + r.newLen + '): ' + r.suggested);
  Logger.log('');
  Logger.log('WHY:');
  r.why.forEach(function (w) { Logger.log('   - ' + w); });
}

/* ===================== Listing optimiser: everything about one listing, in one call =====================
 *
 * The screen asks one question — "what is wrong with this listing and what should it say instead" —
 * so it makes one request. Four round trips to Apps Script, each redirecting before it answers,
 * is most of a minute for a page that could have taken one.
 *
 * SQP is NOT included. It is a report Amazon builds asynchronously and it takes minutes; folding it
 * in here would make every listing take as long as the slowest thing in it. The screen asks for it
 * separately, and only when somebody wants it.
 */
function listingReview_(asin, target) {
  var a = String(asin || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(a)) return { ok: false, error: 'That is not an ASIN: "' + asin + '"' };

  var audit = listingAudit_(a);
  if (!audit.ok) return audit;

  /* Keyword evidence is OPTIONAL and never fatal. A product with no ad history is a normal thing,
   * and the rest of the review is still worth showing for it. */
  var kw = null;
  try { kw = listingKeywords_(a); } catch (e) { kw = { ok: false, error: String(e.message || e) }; }
  var clean = (kw && kw.ok && kw.trust === 'clean') ? (kw.words || []) : [];

  return {
    ok: true, asin: a,
    audit: audit,
    findings: {
      title: titleFindings_(audit.title, audit),
      bullets: bulletFindings_(audit.bullets, audit),
      description: descFindings_(audit.description, audit.bullets, audit),
      images: imageFindings_(audit),
    },
    // Only CLEAN evidence reaches the suggestion. A word from a shared ad group may be a neighbour's.
    suggestion: titleSuggest_(audit, clean, target),
    keywords: kw && kw.ok ? {
      trust: kw.trust, groups: kw.groups, nTerms: kw.nTerms, nClean: kw.nClean,
      note: kw.note, checked: kw.checked, words: kw.words || [], wordsShared: kw.wordsShared || [],
      altSizes: kw.altSizes || [],
      missing: (kw.missing || []).slice(0, 40),
    } : { trust: 'none', note: (kw && kw.error) || 'No keyword evidence.', words: [], wordsShared: [], missing: [] },
  };
}

/* Images, judged by SLOT rather than by count.
 *
 * Seven images that are seven angles of the same thing is a different listing from seven that answer
 * seven different questions, and only the slots can tell them apart. Amazon names them, so what is
 * missing is answerable rather than a matter of taste.
 */
function imageFindings_(audit) {
  var out = [], im = (audit && audit.images) || { slots: {}, emptySlots: [], noZoom: [] };
  if (!im.hasMain) {
    out.push({ k: 'main', bad: true, msg: 'There is no MAIN image. Nothing else on the page matters until there is.' });
  }
  var n = im.n || 0;
  if (n < 4) {
    out.push({ k: 'count', bad: true,
      msg: 'Only ' + n + ' image slot(s) filled. Amazon shows up to seven, and the ones past the first '
        + 'are where a shopper decides.' });
  } else if ((im.emptySlots || []).length) {
    out.push({ k: 'count', bad: false,
      msg: n + ' slot(s) filled; ' + im.emptySlots.join(', ') + ' empty. Free space on the page.' });
  }
  if ((im.noZoom || []).length) {
    out.push({ k: 'zoom', bad: true,
      msg: (im.noZoom || []).join(', ') + ' are under 1000px on the long side, so Amazon offers no '
        + 'zoom on them. Zoom is one of the few image things with a measured effect on conversion.' });
  }
  return out;
}

/* ===================== Bought together: Market Basket Analysis =====================
 *
 * "Which of my other products end up in the same basket as this one" is a real Brand Analytics
 * report — GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT — and it answers exactly that: for each of your
 * ASINs, the products most often purchased alongside it, with the share of baskets.
 *
 * It is worth having for two different reasons, and they pull in opposite directions:
 *   - a product frequently bought with yours is a BUNDLE, a virtual bundle, or a cross-sell.
 *   - if that product is a COMPETITOR'S, it is a gap in your own range: the customer wanted both and
 *     you only sold one of them.
 * So the report is kept whole and the "is it mine" question is answered separately, from the
 * seller's own catalogue, rather than being assumed either way.
 *
 * Whether this report needs an `asin` option is NOT assumed. SQP did, and that was only discovered
 * by asking and reading Amazon's own refusal. The same reader is in place here, so a wrong guess
 * comes back as a sentence rather than as silence.
 */
var MB_PENDING = 'MB_PENDING';

function basketAsk_(period, back) {
  var p = (period || 'MONTH').toUpperCase();
  var w = baPeriodWindow_(p, back);
  try {
    var r = sp_('/reports/2021-06-30/reports', 'post', {
      reportType: 'GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT',
      marketplaceIds: [marketplaceId_()],
      reportOptions: { reportPeriod: p },
      dataStartTime: w.start.toISOString(), dataEndTime: w.end.toISOString(),
    });
    return { ok: true, reportId: r.reportId, period: p,
      window: w.start.toISOString().slice(0, 10) + ' → ' + w.end.toISOString().slice(0, 10) };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 400) }; }
}

/**
 * Collect a finished basket report into { asin: [ {withAsin, title, share, mine} ] }.
 *
 * `mine` is answered from the seller's OWN Catalog tab, not guessed from the brand name on the
 * title — a brand string can be anything, and getting this backwards turns "extend your range" into
 * "build a bundle" or the other way round.
 */
function basketGet_(id) {
  var p = baPoll_(id);
  if (!p.ok) return p;
  if (p.status !== 'done') return { ok: true, status: p.status };

  var mineSet = {};
  try {
    var cat = skuAsinMap_();
    Object.keys(cat.map || {}).forEach(function (sku) { mineSet[cat.map[sku]] = 1; });
  } catch (e) { /* no catalogue access — every row simply comes back with mine:null */ }
  var known = !!Object.keys(mineSet).length;

  var out = {}, rows = 0, noAsin = 0;
  (p.raw || []).forEach(function (x) {
    var a = String(baGet_(x, /^asin$/i, true) || baGet_(x, /purchased.*asin|^asin/i, true) || '').toUpperCase();
    var w = String(baGet_(x, /purchased.?with.?asin|combination.*asin|with.?asin/i, true) || '').toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(a) || !/^[A-Z0-9]{10}$/.test(w)) { noAsin++; return; }
    rows++;
    (out[a] || (out[a] = [])).push({
      withAsin: w,
      title: String(baGet_(x, /product.?title|title|name/i, true) || ''),
      share: num_(baGet_(x, /combination.?percent|percentage|share/i)),
      // null, not false, when the catalogue could not be read: "not mine" and "I could not tell"
      // are different answers and only one of them is a reason to go and source a product.
      mine: known ? !!mineSet[w] : null,
    });
  });
  Object.keys(out).forEach(function (a) {
    out[a].sort(function (x, y) { return (y.share || 0) - (x.share || 0); });
    if (out[a].length > 10) out[a].length = 10;
  });
  return { ok: true, status: 'done', asins: Object.keys(out).length, rows: rows,
    noAsin: noAsin, total: p.total || 0, sample: p.sample || null, catalogueKnown: known, d: out };
}

/** Editor check, two runs: ask, then collect. Proves the report exists and what its rows look like. */
function basketTest(period) {
  var props = PropertiesService.getScriptProperties();
  var pend = prop_(MB_PENDING);
  if (!pend) {
    var a = basketAsk_(period || 'MONTH');
    if (!a.ok) { Logger.log('Could not ask: ' + a.error); return; }
    props.setProperty(MB_PENDING, a.reportId);
    Logger.log('Market Basket report ' + a.reportId + ' asked for ' + a.period + ' (' + a.window + ').');
    Logger.log('RUN AGAIN in a few minutes.');
    return;
  }
  var r = basketGet_(pend);
  if (!r.ok) {
    var dead = /FATAL|CANCELLED/i.test(String(r.error || ''));
    Logger.log((dead ? 'Failed: ' : 'Not ready: ') + r.error);
    if (r.reason) { Logger.log('AMAZON’S OWN REASON:'); Logger.log('   ' + r.reason); }
    if (dead) props.deleteProperty(MB_PENDING); else Logger.log('Still parked — run again shortly.');
    return;
  }
  if (r.status !== 'done') { Logger.log('Still ' + r.status + ' — run again shortly.'); return; }
  props.deleteProperty(MB_PENDING);

  Logger.log(r.total + ' row(s) in the report; ' + r.rows + ' usable, covering ' + r.asins + ' ASIN(s).');
  if (r.noAsin) Logger.log(r.noAsin + ' row(s) had no readable ASIN pair.');
  if (!r.rows) {
    Logger.log('Nothing usable. RAW FIRST ROW so the field names are visible rather than guessed:');
    Logger.log('   ' + JSON.stringify(r.sample).slice(0, 900));
    return;
  }
  if (!r.catalogueKnown) Logger.log('(the Catalog tab could not be read, so "mine" is unknown on every row)');
  Object.keys(r.d).slice(0, 4).forEach(function (a) {
    Logger.log('');
    Logger.log(a + ' is bought together with:');
    r.d[a].slice(0, 5).forEach(function (x) {
      Logger.log('   ' + x.withAsin + '  ' + (x.share ? x.share + '%' : '')
        + '  ' + (x.mine === null ? '[unknown]' : x.mine ? '[YOURS]' : '[someone else’s]')
        + '  ' + String(x.title).slice(0, 70));
    });
  });
}

/* ===================== Market Basket, across the whole catalogue =====================
 *
 * The report is BRAND-WIDE, so one of it answers for every product — which is why this is a screen
 * of its own rather than a card on a single listing.
 *
 * It is split into two buckets because the two answers call for opposite work:
 *
 *   BUNDLE CANDIDATES — both products are yours. Customers are already buying them together, so a
 *   bundle, a virtual bundle or a cross-sell placement is capturing something that is happening
 *   anyway. Nothing to source, nothing to make.
 *
 *   RANGE GAPS — the partner is somebody else's. The customer wanted both and you sold one of them.
 *   That is a product to add, and it is ranked by HOW MANY of your ASINs it pairs with rather than
 *   by a single share: a product that shows up beside twenty of yours is a hole in the range, while
 *   one that shows up beside a single ASIN at a high share is that ASIN's accessory.
 *
 * Mixing the two into one "bought together" list is what makes the report look interesting and turn
 * out to be unusable — you cannot act on a row until you know whose the other product is.
 */
function basketAll_(id) {
  var g = basketGet_(id);
  if (!g.ok || g.status !== 'done') return g;

  /* SKU beside the ASIN, for our own products only. An ASIN is not a thing anyone recognises; the
   * SKU is what Ravi's own sheets, POs and packing lists are keyed on. */
  var skuOf = {};
  try {
    var cat = skuAsinMap_();
    Object.keys(cat.map || {}).forEach(function (sku) {
      var a = cat.map[sku];
      if (a && !skuOf[a]) skuOf[a] = sku;
    });
  } catch (e) { /* no catalogue — the ASIN stands on its own */ }

  var pairs = [], gapBy = {}, seenPair = {};
  Object.keys(g.d || {}).forEach(function (a) {
    (g.d[a] || []).forEach(function (x) {
      if (x.mine) {
        /* A PAIR IS ONE FACT, REPORTED TWICE. Amazon lists A-with-B and B-with-A, and showing both
         * makes twenty bundle ideas look like forty. Keyed on the sorted pair so it lands once, and
         * the higher of the two shares is kept — they are usually not identical, because the share
         * is of each product's OWN baskets. */
        var k = [a, x.withAsin].sort().join('|');
        if (seenPair[k]) { seenPair[k].share = Math.max(seenPair[k].share, x.share || 0); return; }
        seenPair[k] = { a: a, b: x.withAsin, aSku: skuOf[a] || '', bSku: skuOf[x.withAsin] || '',
          title: x.title || '', share: x.share || 0 };
        pairs.push(seenPair[k]);
      } else if (x.mine === false) {
        var e = gapBy[x.withAsin] || (gapBy[x.withAsin] = {
          asin: x.withAsin, title: x.title || '', n: 0, best: 0, with: [] });
        e.n++;
        if ((x.share || 0) > e.best) e.best = x.share || 0;
        if (e.with.length < 8) e.with.push({ asin: a, sku: skuOf[a] || '' });
        if (!e.title && x.title) e.title = x.title;
      }
    });
  });

  pairs.sort(function (p, q) { return (q.share || 0) - (p.share || 0); });
  var gaps = Object.keys(gapBy).map(function (k) { return gapBy[k]; })
    // How MANY of your products it pairs with first: that is what separates a hole in the range from
    // one product's accessory. The best single share breaks ties.
    .sort(function (p, q) { return (q.n - p.n) || (q.best - p.best); });

  return { ok: true, status: 'done', asins: g.asins, rows: g.rows, total: g.total,
    catalogueKnown: g.catalogueKnown, mineCount: Object.keys(skuOf).length,
    pairs: pairs.slice(0, 300), gaps: gaps.slice(0, 300), skuOf: skuOf, d: g.d };
}

/* ===================== Live India stock =====================
 *
 * The India figure the Replenishment app shows is a CSV somebody uploaded, and Ravi says it is out of
 * date. The live one lives in his main workbook. Reading THAT directly means one number with one
 * source — the alternative, another upload, is how the two drifted apart in the first place.
 */
var INDIA_SHEET_ID = '1GhjXEZkbJmAXv-dL6IoJfTtspcTlLVWNkSuXeXTSshw';

/**
 * Editor probe: what is actually in that workbook.
 *
 * Run before wiring anything to it. Guessing a tab name or a column position is how a reader ends up
 * silently returning zeros — and a zero India stock reads as "nothing in India", which is a decision
 * somebody would act on.
 */
function indiaSheetProbe(tabName) {
  var ss;
  try { ss = SpreadsheetApp.openById(INDIA_SHEET_ID); }
  catch (e) { Logger.log('Cannot open ' + INDIA_SHEET_ID + ': ' + (e.message || e)); return; }
  Logger.log('Workbook: ' + ss.getName());
  var want = String(tabName || INDIA_TAB);
  ss.getSheets().forEach(function (sh) {
    var last = sh.getLastColumn(), rows = sh.getLastRow();
    if (!last || !rows) { Logger.log('  tab "' + sh.getName() + '"  empty'); return; }
    var head = sh.getRange(1, 1, 1, Math.min(last, 30)).getValues()[0];
    Logger.log('  tab "' + sh.getName() + '"  gid=' + sh.getSheetId() + '  ' + rows + ' rows');
    Logger.log('      ' + head.map(function (h, i) { return (i + 1) + ':' + String(h).slice(0, 20); }).join(' | '));
    if (sh.getName() === want) {
      var n = Math.min(5, rows - 1);
      if (n > 0) {
        sh.getRange(2, 1, n, Math.min(last, 30)).getValues().forEach(function (r, k) {
          Logger.log('      row ' + (k + 2) + ': ' + r.slice(0, 15).map(function (v) { return String(v).slice(0, 18); }).join(' | '));
        });
      }
    }
  });
}

var INDIA_TAB = 'Main';

/**
 * Live India stock, straight out of the warehouse workbook.
 *
 * THE HEADER ROW IS NOT ROW 1. Row 1 of "Main" is a totals strip (105,550 · 30,965 · …) and row 2
 * carries the names. Reading row 1 as headers gives a set of numbers to match column names against,
 * every match fails, and the reader returns an empty map — which on screen is indistinguishable from
 * "there is nothing in India". So the header row is FOUND, by looking for the one containing SKU,
 * and the columns are taken BY NAME rather than by position: a column inserted in that workbook must
 * not silently shift what this reads.
 *
 * Two quantities, and they are not interchangeable:
 *   India Stock        pieces in the warehouse
 *   India Stock Cust.  = pieces / Pack, i.e. how many SELLABLE units that is
 * A Shopify customer buys a set, so an order line compares against the SELLABLE figure. Both are
 * returned; the app shows the sellable one and keeps the pieces for the tooltip.
 */
function indiaStockLive_() {
  var ss = SpreadsheetApp.openById(INDIA_SHEET_ID);
  var sh = ss.getSheetByName(INDIA_TAB);
  if (!sh) throw new Error('Tab "' + INDIA_TAB + '" not found in ' + ss.getName());
  var rows = sh.getDataRange().getValues();
  if (!rows.length) return { ok: true, n: 0, d: {} };

  var hdr = -1;
  for (var i = 0; i < Math.min(10, rows.length); i++) {
    var joined = rows[i].map(function (c) { return String(c).trim().toLowerCase(); });
    if (joined.indexOf('sku') >= 0 && joined.join('|').indexOf('india stock') >= 0) { hdr = i; break; }
  }
  if (hdr < 0) throw new Error('Could not find the header row in "' + INDIA_TAB + '" (looked for SKU + India Stock in the first 10 rows).');

  var head = rows[hdr].map(function (c) { return String(c).trim().toLowerCase(); });
  var find = function (re) { for (var j = 0; j < head.length; j++) if (re.test(head[j])) return j; return -1; };
  var iSku  = find(/^sku$/);
  var iQty  = find(/^india stock$/);
  var iCust = find(/^india stock cust/);
  var iPack = find(/^pack$/);
  var iStat = find(/^status$/);
  if (iSku < 0 || iQty < 0) throw new Error('Header row found but SKU / India Stock columns were not.');

  var out = {}, n = 0;
  for (var r = hdr + 1; r < rows.length; r++) {
    var sku = String(rows[r][iSku] || '').trim().toUpperCase(); if (!sku) continue;
    var pieces = Number(rows[r][iQty]) || 0;
    var pack = iPack >= 0 ? (Number(rows[r][iPack]) || 1) : 1;
    // Trust the sheet's own figure where it has one; fall back to pieces/pack. Floored, because half
    // a set cannot be shipped and rounding up would promise stock that does not exist.
    var cust = iCust >= 0 && rows[r][iCust] !== '' ? Number(rows[r][iCust]) : (pack > 0 ? pieces / pack : pieces);
    out[sku] = [Math.floor(cust) || 0, pieces, pack, iStat >= 0 ? String(rows[r][iStat] || '').trim() : ''];
    n++;
  }
  return { ok: true, n: n, at: nowStamp_(), tab: INDIA_TAB, d: out };
}

/** Editor check: does the live read work, and does it agree with the sheet? */
function indiaStockTest() {
  var r = indiaStockLive_();
  var keys = Object.keys(r.d);
  Logger.log(r.n + ' SKU(s) read from "' + r.tab + '"');
  keys.slice(0, 6).forEach(function (k) {
    Logger.log('   ' + k + ': ' + r.d[k][0] + ' sellable  (' + r.d[k][1] + ' pieces / pack ' + r.d[k][2] + ')  ' + r.d[k][3]);
  });
  var live = keys.filter(function (k) { return r.d[k][0] > 0; }).length;
  Logger.log(live + ' SKU(s) have stock; ' + (keys.length - live) + ' are at zero.');
}

/* ===================== Shopify per-SKU: what sold, and what is left =====================/* ===================== Shopify per-SKU: what sold, and what is left =====================
 *
 * The Shopify side has always been an ACCOUNT total here — one number a day, stored as a third
 * channel beside the two Amazon brands. That is all the dashboard needed. A replenishment view needs
 * the opposite shape: per SKU, and with the stock sitting behind it.
 *
 * Two separate things, deliberately kept apart:
 *   shopifySkuSales_  what sold in a window, per SKU, out of the orders
 *   shopifyStock_     what is on hand right now, per SKU, out of the product variants
 *
 * They cannot be one call: sales are a window and stock is an instant, and pretending otherwise is
 * how a stock figure ends up quietly dated to the start of a 90-day range.
 */
var SHOP_SKU_DAYS = 90;

/**
 * Units and money per SKU over a window.
 *
 * CANCELLED ORDERS ARE NOT DEMAND. A cancelled order tells you somebody changed their mind, not that
 * a unit needs replacing, and counting it would inflate every reorder that follows from it.
 * `financial_status: voided` goes the same way, matching shopifyOrders_.
 *
 * ⚠️ Refunds are NOT deducted. A refunded line still counts as sold, because the line items carry no
 * refund of their own and the refund endpoint is a separate walk. For replenishment that errs the
 * safe way — slightly more demand, not less — but it is a real overstatement and worth knowing.
 */
function shopifySkuSales_(fromIso, toIso, deadlineMs) {
  var fields = 'id,created_at,cancelled_at,financial_status,line_items';
  var base = '/orders.json?status=any&limit=250&fields=' + fields + shopWindow_(fromIso, toIso);
  var out = {}, out30 = {}, pageInfo = null, guard = 0, orders = 0, orders30 = 0;
  /* THE LAST 30 DAYS TOO (Ravi, 2026-09-29), out of the same walk: an order on or after this day counts in both. */
  var from30 = Utilities.formatDate(new Date(Date.parse(toIso + 'T00:00:00Z') - 29 * 86400000), 'UTC', 'yyyy-MM-dd');
  do {
    var r = shopifyGet_(pageInfo
      ? '/orders.json?limit=250&fields=' + fields + '&page_info=' + encodeURIComponent(pageInfo)
      : base);
    (r.json.orders || []).forEach(function (o) {
      if (!shopInWindow_(o, fromIso, toIso)) return;
      if (o.cancelled_at) return;
      if (String(o.financial_status || '').toLowerCase() === 'voided') return;
      orders++;
      var recent = shopDayOf_(o) >= from30;
      if (recent) orders30++;
      (o.line_items || []).forEach(function (li) {
        var sku = String(li.sku || '').trim(); if (!sku) return;
        var q = Number(li.quantity) || 0;
        var e = out[sku] || (out[sku] = [0, 0]);          // units, revenue
        e[0] += q;
        e[1] += (Number(li.price) || 0) * q;
        if (recent) { var e3 = out30[sku] || (out30[sku] = [0, 0]); e3[0] += q; e3[1] += (Number(li.price) || 0) * q; }
      });
    });
    pageInfo = shopifyNextPageInfo_(r.link);
    if (deadlineMs && Date.now() > deadlineMs) {
      return { ok: true, more: true, n: orders, d: out };
    }
  } while (pageInfo && ++guard < 80);
  Object.keys(out).forEach(function (k) { out[k][1] = Math.round(out[k][1] * 100) / 100; });
  Object.keys(out30).forEach(function (k) { out30[k][1] = Math.round(out30[k][1] * 100) / 100; });
  return { ok: true, more: false, n: orders, d: out, n30: orders30, d30: out30, from30: from30 };
}

/**
 * On-hand units per SKU, summed across every location.
 *
 * Read off the product VARIANTS rather than the inventory-levels endpoint: variants already carry the
 * SKU, and inventory_levels is keyed by inventory_item_id, which would need a second walk just to
 * learn which SKU each one is. The trade is that this is the total across locations with no split by
 * location — which is the number a reorder decision uses anyway.
 *
 * A SKU that is not in Shopify at all comes back ABSENT, never 0. "Not stocked on Shopify" and
 * "stocked and empty" are different answers and the app shows them differently.
 */
function shopifyStock_(deadlineMs) {
  var out = {}, pageInfo = null, guard = 0;
  do {
    var r = shopifyGet_(pageInfo
      ? '/products.json?limit=250&fields=variants&page_info=' + encodeURIComponent(pageInfo)
      : '/products.json?limit=250&fields=variants');
    (r.json.products || []).forEach(function (p) {
      (p.variants || []).forEach(function (v) {
        var sku = String(v.sku || '').trim(); if (!sku) return;
        out[sku] = (out[sku] || 0) + (Number(v.inventory_quantity) || 0);
      });
    });
    pageInfo = shopifyNextPageInfo_(r.link);
    if (deadlineMs && Date.now() > deadlineMs) return { ok: true, more: true, stock: out };
  } while (pageInfo && ++guard < 80);
  return { ok: true, more: false, stock: out };
}

/**
 * One page of products, with every variant's SKU.
 *
 * A VARIANT WITH NO SKU IS RETURNED, not skipped — "this product has no code" is the thing the audit
 * is looking for, and a reader that drops it cannot find it. Nothing here guesses a code.
 */
function shopifySkuList_(pageInfo) {
  var fields = 'id,title,status,handle,product_type,variants';
  var path = pageInfo
    ? '/products.json?limit=250&fields=' + fields + '&page_info=' + encodeURIComponent(String(pageInfo))
    : '/products.json?limit=250&fields=' + fields;
  var r = shopifyGet_(path);
  var rows = [];
  (r.json.products || []).forEach(function (p) {
    (p.variants || []).forEach(function (v) {
      rows.push([String(p.id), String(p.title || ''), String(p.status || ''), String(p.handle || ''),
        String(p.product_type || ''), String(v.id), String(v.title || ''), String(v.sku == null ? '' : v.sku),
        Number(v.inventory_quantity) || 0, String(v.price == null ? '' : v.price)]);
    });
  });
  return { ok: true, cols: ['productId', 'product', 'status', 'handle', 'type', 'variantId', 'variant', 'sku', 'stock', 'price'],
    n: rows.length, rows: rows, next: shopifyNextPageInfo_(r.link) || '' };
}

/** Editor check: does the Shopify side give per-SKU sales and stock at all, and do the SKUs match? */
function shopSkuTest() {
  var to = new Date(), from = new Date(to.getTime() - 14 * 86400000);
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  var s = shopifySkuSales_(iso(from), iso(to), Date.now() + 60000);
  var keys = Object.keys(s.d);
  Logger.log('sales: ' + s.n + ' order(s), ' + keys.length + ' SKU(s)' + (s.more ? ' (ran out of time)' : ''));
  Logger.log('  e.g. ' + keys.slice(0, 5).map(function (k) { return k + ' = ' + s.d[k][0] + 'u $' + s.d[k][1]; }).join(' · '));
  var st = shopifyStock_(Date.now() + 60000);
  var sk = Object.keys(st.stock);
  Logger.log('stock: ' + sk.length + ' SKU(s)' + (st.more ? ' (ran out of time)' : ''));
  Logger.log('  e.g. ' + sk.slice(0, 5).map(function (k) { return k + ' = ' + st.stock[k]; }).join(' · '));
  // The join is the whole feature. If these two sets barely overlap, the SKUs are written differently
  // on the two sides and every projection built on the join would be quietly empty.
  var hit = keys.filter(function (k) { return st.stock[k] != null; }).length;
  Logger.log('overlap: ' + hit + ' of ' + keys.length + ' sold SKUs have a stock figure'
    + (keys.length && hit < keys.length * 0.5 ? '  ⚠ LOW — the two sides may not use the same SKU text' : ''));
}

/* ===================== Search terms & targeting =====================
 *
 * Three more Sponsored Products reports, for the question "what did people actually TYPE, and does
 * it match what we are bidding on".
 *
 *   spSearchTerm       what the shopper typed, and which of our targets caught it
 *   spTargeting        the keywords/targets we added, and what they did
 *   spAdvertisedProduct  again — but grouped down to CAMPAIGN + AD GROUP this time
 *
 * That third one is not a duplicate. The PPC report groups by advertiser only, so every campaign an
 * ASIN runs in collapses into a single row — right for PPC & Organic, useless here. Adding ad-group
 * columns to it would split its rows and quietly change every figure on that tab, so this asks for
 * its own copy instead.
 *
 * It exists because SEARCH TERM REPORTS CARRY NO ASIN. Amazon reports a term against the ad group it
 * matched in, and an ad group can advertise several ASINs. So "product wise" is a JOIN through the
 * ad group, and where a group holds more than one ASIN the term genuinely belongs to all of them —
 * the app says so rather than picking one.
 */
var ADS_WIDE_CFG = {
  st: {
    reportTypeId: 'spSearchTerm', groupBy: ['searchTerm'],
    columns: ['searchTerm', 'keyword', 'matchType', 'campaignId', 'campaignName',
      'adGroupId', 'adGroupName', 'impressions', 'clicks', 'cost', 'purchases30d', 'sales30d'],
  },
  tgt: {
    reportTypeId: 'spTargeting', groupBy: ['targeting'],
    columns: ['keyword', 'targeting', 'matchType', 'campaignId', 'campaignName',
      'adGroupId', 'adGroupName', 'impressions', 'clicks', 'cost', 'purchases30d', 'sales30d'],
  },
  ag: {
    reportTypeId: 'spAdvertisedProduct', groupBy: ['advertiser'],
    columns: ['advertisedAsin', 'advertisedSku', 'campaignId', 'campaignName',
      'adGroupId', 'adGroupName', 'impressions', 'clicks', 'cost', 'purchases30d', 'sales30d',
      'purchasesSameSku30d', 'attributedSalesSameSku30d'],
  },
  // Where the ad was shown: top of search, rest of search, product page, off Amazon. DAILY, because
  // the whole point of a placement view is watching the mix move — a single summary row cannot show
  // that top-of-search quietly took over a week's budget.
  // Placement is NOT its own report type — `spCampaignPlacement` does not exist, and asking for it
  // gets "reportTypeId is unknown or invalid" (confirmed live, 2026-08-16). It is the CAMPAIGN report
  // with campaignPlacement added to groupBy, which is what turns on `placementClassification`.
  plc: {
    reportTypeId: 'spCampaigns', groupBy: ['campaign', 'campaignPlacement'],
    columns: ['date', 'campaignId', 'campaignName', 'placementClassification',
      'impressions', 'clicks', 'cost', 'purchases30d', 'sales30d'],
    timeUnit: 'DAILY',
  },
};

/** Ask for one of the three. SUMMARY, so one row per term/target over the whole window. */
function adsWideCreate_(kind, startDate, endDate) {
  var cfg = ADS_WIDE_CFG[kind];
  if (!cfg) return { ok: false, error: 'Unknown report kind "' + kind + '".' };
  var s = String(startDate || '').slice(0, 10), e = String(endDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) {
    return { ok: false, error: 'start and end must be yyyy-MM-dd.' };
  }
  var days = Math.round((new Date(e + 'T00:00:00Z') - new Date(s + 'T00:00:00Z')) / 86400000) + 1;
  if (days > 31) return { ok: false, error: 'Range is ' + days + ' days; the Ads API allows at most 31.' };
  var body = {
    name: kind + '-' + ACTIVE_PREFIX + '-' + s + '-to-' + e,
    startDate: s, endDate: e,
    configuration: {
      adProduct: 'SPONSORED_PRODUCTS',
      groupBy: cfg.groupBy, columns: cfg.columns, reportTypeId: cfg.reportTypeId,
      // SUMMARY unless the report needs a day on every row. A `date` column with SUMMARY is a
      // contradiction — the whole window collapses to one row and the date means nothing.
      timeUnit: cfg.timeUnit || 'SUMMARY', format: 'GZIP_JSON',
    },
  };
  return adsAsk_(body, { brand: ACTIVE_PREFIX, kind: kind, start: s, end: e });
}

/**
 * POST a report request, treating 425 DUPLICATE as the success it actually is.
 *
 * Amazon refuses a second identical request with 425 and puts the id of the report it ALREADY has in
 * the message: `{"code":"425","detail":"The Request is a duplicate of : <id>"}`. That is not an
 * error — it is the answer to the question, arriving by an unusual door. Reading it as a failure is
 * how a pass that restarts on the same day ends up with NO report for a window it has already asked
 * for: the second ask is refused, and the first id was thrown away when the pass reset.
 */
function adsAsk_(body, meta) {
  try {
    var r = adsCall_('/reporting/reports', 'post', body, adsProfileId_(), ADS_REPORT_MIME);
    return { ok: true, brand: meta.brand, kind: meta.kind, reportId: r.reportId || '',
      status: r.status || '', start: meta.start, end: meta.end };
  } catch (err) {
    var m = String(err.message || err).match(/duplicate of\s*:?\s*([0-9a-fA-F-]{16,})/);
    if (m) {
      return { ok: true, brand: meta.brand, kind: meta.kind, reportId: m[1],
        status: 'DUPLICATE', start: meta.start, end: meta.end, dup: true };
    }
    throw err;
  }
}

/** Download a finished report and hand back its raw rows. Shared by all three. */
function adsWideRows_(id) {
  var s = ppcStatus_(id);
  if (!s.ok || !s.ready || !s.url) throw new Error('Report is not ready (' + (s.status || '?') + ').');
  var resp = UrlFetchApp.fetch(s.url, { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Report download failed (' + resp.getResponseCode() + ').');
  var text;
  try { text = Utilities.ungzip(resp.getBlob().setContentType('application/x-gzip')).getDataAsString(); }
  catch (e) { text = resp.getContentText(); }
  return JSON.parse(text || '[]') || [];
}

var wNum_ = function (v) { return Number(v) || 0; };
var wStr_ = function (v) { return String(v == null ? '' : v).trim(); };
var wMoney_ = function (v) { return Math.round((Number(v) || 0) * 100) / 100; };

/**
 * Search terms, folded to one row per (ad group, search term).
 *
 * ZERO-CLICK TERMS ARE DROPPED. They are the large majority of rows and nothing on this tab can say
 * anything about them — you cannot call a term wasteful, convertible or worth harvesting on the
 * strength of an impression. Keeping them would multiply the cache the browser downloads for no
 * answer. The count that was dropped is returned so the app can say so instead of implying the
 * account only ever had this many terms.
 */
/* NAMES ARE NOT REPEATED ON EVERY ROW.
 *
 * Campaign and ad-group names run to 50 characters and repeat across thousands of rows — they were
 * most of the payload. A 30-day search-term cache came to several megabytes, which is what tipped
 * the cache spreadsheet over and is far too much for the browser to download besides.
 *
 * So the rows carry ids, and `names` maps id → name once. Same information, a fraction of the size.
 * The frontend joins them back on load. */
var ST_MIN_CLICKS = 3;          // clicks a term needs before "it did not convert" means anything

function adsWideFoldSt_(rows) {
  var out = {}, dropped = 0, names = {};
  for (var i = 0; i < rows.length; i++) {
    var x = rows[i];
    var term = wStr_(x.searchTerm); if (!term) continue;
    var ag = wStr_(x.adGroupId), cid = wStr_(x.campaignId);
    if (ag && !names[ag]) names[ag] = wStr_(x.adGroupName);
    if (cid && !names[cid]) names[cid] = wStr_(x.campaignName);
    var k = ag + '|' + term.toLowerCase();
    var b = out[k] || (out[k] = { t: term, ag: ag, cid: cid,
      kw: wStr_(x.keyword), mt: wStr_(x.matchType), i: 0, c: 0, sp: 0, o: 0, s: 0 });
    b.i += wNum_(x.impressions); b.c += wNum_(x.clicks); b.sp += wNum_(x.cost);
    b.o += wNum_(x.purchases30d); b.s += wNum_(x.sales30d);
  }
  /* THE CUT, and why it is where it is.
   *
   * A 30-day search-term report came to about 30 MB — it broke the cache spreadsheet outright and no
   * browser is going to download it. So something has to go, and the question is what can be dropped
   * WITHOUT losing an answer.
   *
   * Kept: every term that produced an ORDER (that is the harvest list, and it is small), and every
   * term with at least ST_MIN_CLICKS clicks (enough to say the traffic did not convert).
   * Dropped: the long tail of one- and two-click terms with nothing to show. You cannot call a term
   * wasteful on two clicks — that is not evidence, it is noise, and it is most of the file.
   *
   * The cut is applied AFTER aggregating, not per raw row: the same term can arrive on several rows
   * and judging each one alone would drop a term that clears the bar once its rows are added up.
   *
   * What went is COUNTED AND RETURNED, and the tab says so. A silent cap would read as "this is
   * everything", which is the one thing it must never do. */
  var list = [], dropSpend = 0;
  Object.keys(out).forEach(function (k) {
    var b = out[k];
    if (!(b.o > 0) && b.c < ST_MIN_CLICKS) { dropped++; dropSpend += b.sp; return; }
    b.sp = wMoney_(b.sp); b.s = wMoney_(b.s); list.push(b);
  });
  return { rows: list, dropped: dropped, dropSpend: wMoney_(dropSpend), minClicks: ST_MIN_CLICKS, names: names };
}

/** The targets we added — one row per (ad group, target). Kept even at zero clicks: a keyword that
 *  never gets a click is itself an answer, and there are orders of magnitude fewer of them. */
function adsWideFoldTgt_(rows) {
  var out = {}, names = {};
  for (var i = 0; i < rows.length; i++) {
    var x = rows[i];
    var target = wStr_(x.keyword) || wStr_(x.targeting); if (!target) continue;
    var ag = wStr_(x.adGroupId), cid = wStr_(x.campaignId);
    if (ag && !names[ag]) names[ag] = wStr_(x.adGroupName);
    if (cid && !names[cid]) names[cid] = wStr_(x.campaignName);
    var k = ag + '|' + target.toLowerCase() + '|' + wStr_(x.matchType).toLowerCase();
    var b = out[k] || (out[k] = { t: target, ag: ag, cid: cid,
      mt: wStr_(x.matchType), i: 0, c: 0, sp: 0, o: 0, s: 0 });
    b.i += wNum_(x.impressions); b.c += wNum_(x.clicks); b.sp += wNum_(x.cost);
    b.o += wNum_(x.purchases30d); b.s += wNum_(x.sales30d);
  }
  var list = [];
  Object.keys(out).forEach(function (k) { var b = out[k]; b.sp = wMoney_(b.sp); b.s = wMoney_(b.s); list.push(b); });
  return { rows: list, names: names };
}

/**
 * adGroupId → the ASINs advertised in it, plus an ASIN → parent lookup alongside.
 *
 * The ASIN list is a LIST, never one ASIN: a group can advertise several, and that is exactly why a
 * search term cannot always be pinned to a single product. The parent comes from the same
 * SKU → parent map the catalogue tabs use, resolved here rather than in the browser so there is one
 * answer to "what is this ASIN's parent" instead of two that can disagree.
 */
/**
 * The campaign × product figures NOW, without waiting for the nightly pass (2026-10-03). Asks for the same 30 days the
 * nightly run would (to yesterday, PT) — Amazon answers a repeat ask with the report it already has — and, once it is
 * ready, folds it and puts it in the adGroup cache for this brand only. The nightly pass overwrites it as usual.
 */
/**
 * IS THIS PRODUCT'S AD RUNNING? (2026-10-03, Ravi: "add kro ki wo particular asin active h or pause h us campaign me").
 * The reports carry no state, so the Sponsored Products lists are read — product ads, ad groups and campaigns, each
 * ENABLED / PAUSED / ARCHIVED — and kept per brand in the adState cache:
 *   { ad: { 'adGroupId|sku': 'E'|'P'|'A' }, ag: { adGroupId: … }, cp: { campaignId: … }, at }
 * An ad runs only when all three are enabled; the app says which one stopped it. READ ONLY: no state is changed.
 *
 * Stored as ONE letter on each adGroup-cache row (`st`), not as a cache of its own: the full lists came to 1.2 MB of
 * ads the view never shows, on top of the 1.8 MB it already downloads. E running · a ad paused · g ad group paused ·
 * c campaign paused · A archived (any of the three) · ? not in Amazon's lists.
 */
function adsListAll_(path, mime, key) {
  var out = [], token = null, guard = 0;
  do {
    var body = { maxResults: 1000, stateFilter: { include: ['ENABLED', 'PAUSED', 'ARCHIVED'] } };
    if (token) body.nextToken = token;
    var r = adsCall_(path, 'post', body, adsProfileId_(), mime);
    out = out.concat(r[key] || []);
    token = r.nextToken || null;
  } while (token && ++guard < 200);
  return out;
}
function adStateOf_() {
  var S = function (v) { v = String(v || '').toUpperCase(); return v === 'ENABLED' ? 'E' : v === 'PAUSED' ? 'P' : v === 'ARCHIVED' ? 'A' : '?'; };
  var ad = {}, ag = {}, cp = {};
  adsListAll_('/sp/productAds/list', 'application/vnd.spProductAd.v3+json', 'productAds').forEach(function (x) {
    var k = wStr_(x.adGroupId) + '|' + wStr_(x.sku);
    // The same SKU twice in one ad group: running if either copy runs.
    if (ad[k] !== 'E') ad[k] = S(x.state);
  });
  adsListAll_('/sp/adGroups/list', 'application/vnd.spAdGroup.v3+json', 'adGroups').forEach(function (x) { ag[wStr_(x.adGroupId)] = S(x.state); });
  adsListAll_('/sp/campaigns/list', 'application/vnd.spCampaign.v3+json', 'campaigns').forEach(function (x) { cp[wStr_(x.campaignId)] = S(x.state); });
  return { ad: ad, ag: ag, cp: cp, at: nowStamp_() };
}
function adStateAll_() {
  var saved = ACTIVE_PREFIX, d = {}, out = {};
  try {
    ['SP', 'CPC'].forEach(function (b) {
      setBrand_(b);
      try { d[b] = adStateOf_(); out[b] = { ads: Object.keys(d[b].ad).length, adGroups: Object.keys(d[b].ag).length, campaigns: Object.keys(d[b].cp).length }; }
      catch (e) { out[b] = { error: String(e.message || e).slice(0, 300) }; }
    });
  } finally { setBrand_(saved); }
  var c = cacheRead_('adGroup');
  if (!c || !c.d) return { ok: false, error: 'no adGroup cache to mark', brands: out };
  Object.keys(d).forEach(function (b) {                          // a brand that failed keeps the letters it had
    var pack = c.d[b]; if (!pack || !pack.rows) return;
    var n = { E: 0, a: 0, g: 0, c: 0, A: 0, '?': 0 };
    pack.rows.forEach(function (r) { r.st = adStateLetter_(d[b], r); n[r.st]++; });
    pack.stAt = d[b].at;
    out[b].marked = n;
  });
  cacheWrite_('adGroup', c);
  return { ok: true, brands: out };
}
function adStateLetter_(s, r) {
  var ad = s.ad[r.ag + '|' + r.sku], ag = s.ag[r.ag], cp = s.cp[r.cid];
  if (!ad || !ag || !cp) return '?';
  if (ad === 'A' || ag === 'A' || cp === 'A') return 'A';
  if (cp === 'P') return 'c';
  if (ag === 'P') return 'g';
  if (ad === 'P') return 'a';
  return ad === 'E' && ag === 'E' && cp === 'E' ? 'E' : '?';
}

function agNowAsk_() {
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  var we = new Date(Date.now() - 86400000), ws = new Date(we.getTime() - 29 * 86400000);
  return adsWideCreate_('ag', iso(ws), iso(we));
}
function agNowGet_(id) {
  var s = ppcStatus_(id);
  if (!s.ok || !s.ready) return { ok: true, ready: false, status: s.status || '', error: s.error || '' };
  var fold = adsWideFoldAg_(adsWideRows_(id));
  var c = cacheRead_('adGroup') || {};
  var d = c.d || {};
  d[ACTIVE_PREFIX] = fold;
  cacheWrite_('adGroup', { at: nowStamp_(), d: d });
  var mark = null;
  try { mark = adStateAll_(); } catch (e) { mark = { ok: false, error: String(e.message || e).slice(0, 200) }; }
  return { ok: true, ready: true, brand: ACTIVE_PREFIX, rows: fold.rows.length, groups: Object.keys(fold.groups).length, state: mark };
}

function adsWideFoldAg_(rows) {
  var parents = {};
  try { parents = catalogParents_() || {}; } catch (e) { parents = {}; }   // no Sheets access → blank
  var groups = {}, parentOf = {}, out = {}, names = {};
  for (var i = 0; i < rows.length; i++) {
    var x = rows[i], ag = wStr_(x.adGroupId), a = wStr_(x.advertisedAsin).toUpperCase();
    if (!ag || !a) continue;
    var e = groups[ag] || (groups[ag] = { n: wStr_(x.adGroupName), cn: wStr_(x.campaignName), a: [] });
    if (e.a.indexOf(a) < 0) e.a.push(a);
    var sku = wStr_(x.advertisedSku);
    if (sku && parents[sku] && !parentOf[a]) parentOf[a] = parents[sku];
    /* CAMPAIGN × PRODUCT (2026-10-03, Ravi: "kis campaign me kis product me mera achcha ya bura chal rha h
     * and uska action kya and uske against me stock h ya nahi"). The figures were in this report all along
     * and were dropped here; now one row per (ad group, SKU) keeps them, with the SKU so the app can put
     * the FBA stock beside it. Names once per id, as in the search-term fold. */
    var cid = wStr_(x.campaignId);
    if (!names[ag]) names[ag] = wStr_(x.adGroupName);
    if (cid && !names[cid]) names[cid] = wStr_(x.campaignName);
    var k = ag + '|' + a + '|' + sku;
    var b = out[k] || (out[k] = { ag: ag, cid: cid, a: a, sku: sku, i: 0, c: 0, sp: 0, o: 0, s: 0, oo: 0, os: 0 });
    b.i += wNum_(x.impressions); b.c += wNum_(x.clicks); b.sp += wNum_(x.cost);
    b.o += wNum_(x.purchases30d); b.s += wNum_(x.sales30d);
    // OWN sales: what was bought of THIS SKU after the click. sales30d also counts other products bought after it (2026-10-03).
    b.oo += wNum_(x.purchasesSameSku30d); b.os += wNum_(x.attributedSalesSameSku30d);
  }
  var list = [];
  Object.keys(out).forEach(function (k) {
    var b = out[k];
    if (!(b.i > 0) && !(b.sp > 0)) return;          // never shown in the window: nothing to say about it
    b.sp = wMoney_(b.sp); b.s = wMoney_(b.s); b.os = wMoney_(b.os); list.push(b);
  });
  return { groups: groups, parent: parentOf, rows: list, names: names };
}

/**
 * Placement: where the ad was shown, day by day, plus the spend that bought nothing.
 *
 * SPEND MISALLOCATION is Ravi's definition and it is deliberately the plain one: money spent on
 * clicks that produced no order at all. Amazon has no such field — this is ours — so the GRAIN it is
 * counted at is the whole decision, and the grain is CAMPAIGN × PLACEMENT OVER THE WINDOW, never
 * per day.
 *
 * Per day would be indefensible here. `sales30d` is attributed to the CLICK date and keeps
 * collecting orders for a month afterwards, so a click from three days ago has barely had time to
 * convert. Counting each day separately would mark almost all recent spend as "bought nothing" and
 * the number would fall as the data matured — a metric that improves on its own while nobody does
 * anything is worse than no metric.
 *
 * "This campaign's top-of-search spend produced nothing in thirty days" is a sentence somebody can
 * act on. That is what this counts.
 */
function adsWideFoldPlc_(rows) {
  var byDate = {}, byPlace = {}, cell = {};
  var blank = function () { return [0, 0, 0, 0, 0]; };   // impr, clicks, cost, orders, sales
  var add = function (t, x) {
    t[0] += wNum_(x.impressions); t[1] += wNum_(x.clicks); t[2] += wNum_(x.cost);
    t[3] += wNum_(x.purchases30d); t[4] += wNum_(x.sales30d);
  };
  for (var i = 0; i < rows.length; i++) {
    var x = rows[i];
    var p = wStr_(x.placementClassification) || 'Unknown';
    var day = wStr_(x.date).slice(0, 10);
    if (day) {
      var d = byDate[day] || (byDate[day] = {});
      add(d[p] || (d[p] = blank()), x);
    }
    add(byPlace[p] || (byPlace[p] = blank()), x);
    // The misallocation grain: one bucket per campaign per placement, summed across every day.
    var ck = wStr_(x.campaignId) + '|' + p;
    var c = cell[ck] || (cell[ck] = { cn: wStr_(x.campaignName), p: p, t: blank() });
    add(c.t, x);
  }
  // A campaign+placement that took clicks and returned no order at all: its whole spend is the waste.
  var mis = {}, worst = [];
  Object.keys(cell).forEach(function (k) {
    var c = cell[k], t = c.t;
    if (!(t[1] > 0) || t[3] > 0) return;                 // no clicks, or it did convert
    mis[c.p] = wMoney_((mis[c.p] || 0) + t[2]);
    worst.push({ cn: c.cn, p: c.p, c: t[1], sp: wMoney_(t[2]) });
  });
  worst.sort(function (a, b) { return b.sp - a.sp; });
  var round = function (m) { Object.keys(m).forEach(function (k) {
    m[k][2] = wMoney_(m[k][2]); m[k][4] = wMoney_(m[k][4]); }); };
  round(byPlace);
  Object.keys(byDate).forEach(function (d) { round(byDate[d]); });
  return { byDate: byDate, byPlace: byPlace, mis: mis, worst: worst.slice(0, 300) };
}

/**
 * Editor test: ask for all three, one short window, and report what Amazon said.
 *
 * Worth running before trusting the nightly. A column name the API does not recognise fails the
 * whole report with a 400 at CREATE time, and inside the nightly that shows up only as a line in
 * lastError hours later.
 */
function stTest() {
  var end = new Date(Date.now() - 2 * 86400000);
  var start = new Date(end.getTime() - 6 * 86400000);
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  var asked = [];
  ['SP', 'CPC'].forEach(function (brand) {
    setBrand_(brand);
    ['st', 'tgt', 'ag', 'plc'].forEach(function (kind) {
      try {
        var r = adsWideCreate_(kind, iso(start), iso(end));
        Logger.log(brand + ' ' + kind + ': ' + (r.ok ? 'asked, id ' + r.reportId : 'FAILED ' + r.error));
        if (r.ok && r.reportId) asked.push({ brand: brand, kind: kind, id: r.reportId });
      } catch (e) {
        Logger.log(brand + ' ' + kind + ': FAILED ' + String(e.message || e).slice(0, 300));
      }
    });
  });
  // Remembered so the collector needs no arguments. The editor's Run button cannot pass any, and a
  // function you have to edit before every run is one nobody runs.
  nSet_('ST_TEST_IDS', JSON.stringify(asked));
  Logger.log('Wait a few minutes, then run stTestCollect() — no arguments, it picks these up.');
}

/**
 * Collect whatever stTest asked for and show what the rows ACTUALLY contain.
 *
 * Amazon accepting the report at CREATE time only proves the configuration parsed. It says nothing
 * about whether a row carries `searchTerm`, `keyword` or `advertisedSku` under those names — and a
 * field read under the wrong name comes back blank, which looks like an account with no data rather
 * than a bug. So this prints the first row verbatim and then checks the fields the folders rely on.
 */
function stTestCollect() {
  var asked = [];
  try { asked = JSON.parse(nProp_('ST_TEST_IDS') || '[]'); } catch (e) { asked = []; }
  if (!asked.length) { Logger.log('Nothing to collect — run stTest() first.'); return; }
  var NEED = {
    st: ['searchTerm', 'keyword', 'matchType', 'adGroupId', 'campaignName', 'clicks', 'cost', 'purchases30d', 'sales30d'],
    tgt: ['keyword', 'targeting', 'matchType', 'adGroupId', 'campaignName', 'clicks', 'cost', 'purchases30d', 'sales30d'],
    ag: ['advertisedAsin', 'advertisedSku', 'adGroupId', 'adGroupName', 'campaignId', 'campaignName', 'impressions', 'clicks', 'cost', 'purchases30d', 'sales30d'],
    plc: ['date', 'campaignId', 'campaignName', 'placementClassification', 'impressions', 'clicks', 'cost', 'purchases30d', 'sales30d'],
  };
  asked.forEach(function (j) {
    setBrand_(j.brand);
    var s;
    try { s = ppcStatus_(j.id); } catch (e) { Logger.log(j.brand + ' ' + j.kind + ': status failed — ' + e); return; }
    if (!s.ready) { Logger.log(j.brand + ' ' + j.kind + ': still ' + (s.status || '?') + (s.error ? ' — ' + s.error : '')); return; }
    var rows;
    try { rows = adsWideRows_(j.id); } catch (e) { Logger.log(j.brand + ' ' + j.kind + ': download failed — ' + e); return; }
    Logger.log(j.brand + ' ' + j.kind + ': ' + rows.length + ' rows');
    if (!rows.length) { Logger.log('   (no rows — nothing ran in that window, or nothing matched)'); return; }
    Logger.log('   first row: ' + JSON.stringify(rows[0]).slice(0, 600));
    var missing = NEED[j.kind].filter(function (f) { return !(f in rows[0]); });
    Logger.log(missing.length ? '   ⚠ MISSING FIELDS: ' + missing.join(', ') : '   ✅ every field the app reads is present');
  });
}

/**
 * What the two accounts allow today.
 *
 * Shopify: the scopes granted to this token, read from the token itself, and whether the ones a
 * fulfilment with a tracking number needs are among them.
 * Amazon: an MCF call that changes nothing — listing fulfilment orders. Unauthorized means the app
 * does not carry the Fulfillment Outbound role for that brand; anything else means it does.
 */
/** The last few fulfilled orders, and what their fulfilments say about who shipped them. */
function fulfilDiag_(days) {
  /* Today's orders are all still unfulfilled, which says nothing — look back a few days. */
  var max = new Date(Date.now() - (Number(days) || 5) * 864e5).toISOString();
  var r = shopifyGet_('/orders.json?status=any&limit=10&created_at_max=' + encodeURIComponent(max)
    + '&fields=id,name,created_at,fulfillment_status,fulfillments,tags');
  var out = [];
  (r.json.orders || []).forEach(function (o) {
    (o.fulfillments || []).forEach(function (f) {
      out.push({ order: o.name, at: f.created_at, status: f.status,
        service: f.service, company: f.tracking_company,
        hasTracking: !!f.tracking_number, locationId: f.location_id });
    });
    if (!(o.fulfillments || []).length) out.push({ order: o.name, at: o.created_at, status: 'no fulfilment yet', fulfillment_status: o.fulfillment_status });
  });
  return { ok: true, store: shopifyStore_(), rows: out };
}

/** The last 30 days of a store: how many orders, how many still unfulfilled, and the newest few. */
function shopTest_(shopBrand) {
  setShopBrand_(shopBrand);
  var from = new Date(Date.now() - 30 * 864e5).toISOString();
  /* EVERY order in the window, not the first page: Shopify hands back 250 at a time and points
   * at the next page in the Link header. A count taken from one page is a count of the page. */
  var path = '/orders.json?status=any&limit=250&created_at_min=' + encodeURIComponent(from)
    + '&fields=id,name,created_at,fulfillment_status,financial_status,line_items';
  var orders = [], pages = 0;
  while (path && pages < 20) {
    var r = shopifyGet_(path);
    (r.json.orders || []).forEach(function (o) { orders.push(o); });
    pages++;
    var next = (r.link || '').match(/<[^>]*[?&]page_info=([^>&]+)[^>]*>;\s*rel="next"/);
    path = next ? '/orders.json?limit=250&page_info=' + next[1] : '';
  }
  var open = orders.filter(function (o) { return !o.fulfillment_status; });
  return { ok: true, store: shopifyStore_(), sinceDays: 30, pages: pages, orders: orders.length, unfulfilled: open.length,
    newest: orders.slice(0, 5).map(function (o) {
      return { order: o.name, at: o.created_at, paid: o.financial_status, fulfilled: o.fulfillment_status || "no",
        lines: (o.line_items || []).map(function (li) { return li.sku + " x" + li.quantity; }) };
    }) };
}

function mcfDiag_(brand, shopBrand) {
  setShopBrand_(shopBrand || brand);
  var out = { ok: true, brand: brand, shopAs: shopBrand || brand, shopify: {}, amazon: {} };
  /* Say what the properties actually hold — a 401 is usually a store/token that do not belong
   * together, or a paste that brought a space with it. Never print the token itself. */
  var tk = prop_(SHOP_PREFIX + 'SHOPIFY_TOKEN') || '';
  out.config = { storeProp: prop_(SHOP_PREFIX + 'SHOPIFY_STORE') || '(not set)',
    tokenLen: tk.length, tokenStarts: tk.slice(0, 6), tokenHasSpace: /s/.test(tk) };

  try {
    var scRes = UrlFetchApp.fetch('https://' + shopifyStore_() + '/admin/oauth/access_scopes.json', {
      method: 'get', muteHttpExceptions: true,
      headers: { 'X-Shopify-Access-Token': shopifyToken_() },
    });
    var scBody = scRes.getContentText();
    if (scRes.getResponseCode() !== 200) throw new Error('Shopify ' + scRes.getResponseCode() + ': ' + scBody.slice(0, 200));
    var have = (JSON.parse(scBody).access_scopes || []).map(function (x) { return x.handle; });
    var needRead = ['read_orders', 'read_products'];
    var needWrite = ['write_merchant_managed_fulfillment_orders', 'write_assigned_fulfillment_orders'];
    out.shopify = {
      store: shopifyStore_(),
      scopes: have,
      canRead: needRead.filter(function (x) { return have.indexOf(x) < 0; }).length === 0,
      /* Either write scope is enough — which one depends on whether the location is a fulfilment
       * service or the merchant's own. */
      canWriteTracking: needWrite.some(function (x) { return have.indexOf(x) >= 0; }),
      missing: needRead.concat(needWrite).filter(function (x) { return have.indexOf(x) < 0; }),
    };
  } catch (e) { out.shopify = { error: String(e.message || e) }; }

  try {
    setBrand_(brand);
    var token = getToken_();
    var url = spHost_() + '/fba/outbound/2020-07-01/fulfillmentOrders?queryStartDate='
      + encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString());
    var res = UrlFetchApp.fetch(url, {
      method: 'get', muteHttpExceptions: true,
      headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
    });
    var code = res.getResponseCode();
    var body = res.getContentText();
    var n = null;
    try { n = (JSON.parse(body).payload || {}).fulfillmentOrders; } catch (e2) { n = null; }
    out.amazon = {
      host: spHost_(),
      status: code,
      /* 403 with an "Unauthorized" body is Amazon's way of saying the ROLE is missing, not the key. */
      canMcf: code === 200,
      recentOrders: n ? n.length : null,
      why: code === 200 ? '' : body.slice(0, 300),
    };
  } catch (e) { out.amazon = { error: String(e.message || e) }; }

  return out;
}

/* ===================== Shopify ===================== */
/*
 * A third sales channel alongside the two Amazon accounts. Ported from the Amazon Hub script rather
 * than written afresh â€” that version already handles the store-domain confusion and the 429s.
 *
 * Credentials live in Script Properties, never in code:
 *   SHOPIFY_STORE   â€” "mystore.myshopify.com" (the admin.shopify.com URL is also understood)
 *   SHOPIFY_TOKEN   â€” Admin API access token (shpat_â€¦)
 *
 * Sales = line-item price Ã— quantity, which is the same thing Amazon calls Ordered Product Sales.
 * Not total_price: that includes shipping and tax and would not compare with the Amazon figures.
 */
var SHOP_API_VERSION = '2024-10';

/** '' is Ridhi's store; 'CPC_' is Cotton Print Club's. Nothing sets this but setShopBrand_. */
var SHOP_PREFIX = '';

/** Point the following Shopify calls at a store. 'CPC' â†’ CPC_SHOPIFY_*, anything else â†’ SHOPIFY_*. */
function setShopBrand_(b) {
  SHOP_PREFIX = (String(b || '').toUpperCase() === 'CPC') ? 'CPC_' : '';
  return SHOP_PREFIX;
}

/** The Admin API token for whichever store is selected. */
function shopifyToken_() {
  /* A token pasted into Script Properties often brings a space or a newline with it, and Shopify
   * answers that with a 401 that reads like the token itself is wrong. */
  var t = String(prop_(SHOP_PREFIX + 'SHOPIFY_TOKEN') || '').trim();
  if (t && t.indexOf('shpss_') === 0) throw new Error(SHOP_PREFIX + "SHOPIFY_TOKEN holds the app's SECRET (shpss_...), not an Admin API access token (shpat_...).");
  if (!t) throw new Error(SHOP_PREFIX + 'SHOPIFY_TOKEN missing â€” set the Admin API access token in Script Properties.');
  return t;
}

function shopifyStore_() {
  var s = prop_(SHOP_PREFIX + 'SHOPIFY_STORE');
  if (!s) throw new Error(SHOP_PREFIX + 'SHOPIFY_STORE missing â€” set it (e.g. mystore.myshopify.com) in Script Properties.');
  s = s.trim().replace(/^https?:\/\//, '');
  // The new admin URL form: admin.shopify.com/store/<handle> â†’ <handle>.myshopify.com
  var m = s.match(/admin\.shopify\.com\/store\/([^\/?#]+)/i);
  if (m) return m[1] + '.myshopify.com';
  s = s.replace(/\/.*$/, '');
  if (/^admin\.shopify\.com$/i.test(s)) {
    throw new Error('SHOPIFY_STORE is the admin URL. Use the myshopify domain instead, '
      + 'e.g. "yourstore.myshopify.com" (Shopify Admin â†’ Settings â†’ Domains).');
  }
  if (s.indexOf('.myshopify.com') < 0) s += '.myshopify.com';
  return s;
}

/** GET an Admin API path. Returns { json, link } â€” the Link header carries the next page. */
function shopifyGet_(pathQuery) {
  var token = shopifyToken_();
  var url = 'https://' + shopifyStore_() + '/admin/api/' + SHOP_API_VERSION + pathQuery;
  for (var att = 0; att < 5; att++) {
    var resp = UrlFetchApp.fetch(url, {
      method: 'get', muteHttpExceptions: true,
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    var code = resp.getResponseCode();
    if (code === 429) { Utilities.sleep(2500); continue; }
    if (code >= 300) throw new Error('Shopify ' + code + ': ' + resp.getContentText().slice(0, 300));
    var h = resp.getHeaders();
    return { json: JSON.parse(resp.getContentText() || '{}'), link: h['Link'] || h['link'] || '' };
  }
  throw new Error('Shopify: too many 429s (rate limit) â€” try again.');
}

/** POST/PUT an Admin API path. Same retry on 429 as the GET, same error shape. */
function shopifyWrite_(pathQuery, method, body) {
  /* The store this call belongs to — Ridhi unless somebody set the other one. */
  var token = shopifyToken_();
  var url = 'https://' + shopifyStore_() + '/admin/api/' + SHOP_API_VERSION + pathQuery;
  for (var att = 0; att < 5; att++) {
    var resp = UrlFetchApp.fetch(url, {
      method: method || 'post', muteHttpExceptions: true, contentType: 'application/json',
      headers: { 'X-Shopify-Access-Token': token },
      payload: JSON.stringify(body || {}),
    });
    var code = resp.getResponseCode();
    if (code === 429) { Utilities.sleep(2500); continue; }
    var text = resp.getContentText();
    if (code === 401 || code === 403) {
      throw new Error('Shopify ' + code + ' â€” the token cannot WRITE. The app needs the fulfilment '
        + 'write scope, and a token issued before the scope was added will not have it: '
        + text.slice(0, 200));
    }
    if (code >= 300) throw new Error('Shopify ' + code + ': ' + text.slice(0, 300));
    return JSON.parse(text || '{}');
  }
  throw new Error('Shopify: too many 429s (rate limit) â€” try again.');
}

function shopifyNextPageInfo_(link) {
  var m = String(link || '').match(/<[^>]*[?&]page_info=([^>&]+)[^>]*>;\s*rel="next"/);
  return m ? decodeURIComponent(m[1]) : null;
}

/* THE QUERY WINDOW AND THE DAY WERE MEASURED IN DIFFERENT ZONES.
 *
 * `created_at_min`/`max` were sent as ...T00:00:00Z and ...T23:59:59Z, in UTC. The day an order
 * belongs to is then taken from the first ten characters of `created_at`, which Shopify returns in
 * the STORE's offset. Those two only agree if the store runs on UTC, and this one does not.
 *
 * On a store behind UTC every evening order falls into the next UTC day and was cut off by the max
 * bound: orders placed after about 5pm simply never arrived. That is exactly what "the app stops at
 * #3411 while Shopify shows #3416" looks like. A store ahead of UTC loses its early mornings the
 * same way, at the other end.
 *
 * Rather than hard-code the shop's timezone — which is a setting somebody can change without
 * telling anyone — the window is widened by a day at each end and the exact filtering is done on
 * the store-local date afterwards. One extra day of orders costs one page; a missing day costs a
 * shipment.
 */
function shopWindow_(fromIso, toIso) {
  var shift = function (iso, days) {
    return new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  };
  return '&created_at_min=' + encodeURIComponent(shift(fromIso, -1) + 'T00:00:00Z')
       + '&created_at_max=' + encodeURIComponent(shift(toIso, 1) + 'T23:59:59Z');
}
/** The store-local trading date of an order, and whether it lands inside the asked-for window. */
function shopDayOf_(o) { return String((o && o.created_at) || '').slice(0, 10); }
function shopInWindow_(o, fromIso, toIso) {
  var d = shopDayOf_(o);
  return !!d && d >= fromIso && d <= toIso;
}

/**
 * Daily totals between two dates: { 'YYYY-MM-DD': [sales, units, orders] }.
 *
 * The day comes from `created_at`, which Shopify returns with the STORE's own offset â€” so slicing
 * the first ten characters gives the store-local trading date. That is deliberately the same idea
 * as the Amazon side, where the day is the marketplace's day, not the server's. Getting this wrong
 * is what shifted the Amazon figures by a day, and it is just as easy to get wrong here.
 */
function shopifyDaily_(fromIso, toIso, deadlineMs) {
  var fields = 'id,created_at,financial_status,line_items';
  var path = '/orders.json?status=any&limit=250&fields=' + fields + shopWindow_(fromIso, toIso);
  var out = {}, pageInfo = null, guard = 0, orders = 0;
  do {
    var r = shopifyGet_(pageInfo
      ? '/orders.json?limit=250&fields=' + fields + '&page_info=' + encodeURIComponent(pageInfo)
      : path);
    (r.json.orders || []).forEach(function (o) {
      // Cancelled and refunded-to-zero orders should not count as sales.
      if (String(o.financial_status || '').toLowerCase() === 'voided') return;
      // The window was widened by a day at each end; this is where it is trimmed back, on the
      // store's own date rather than on UTC.
      if (!shopInWindow_(o, fromIso, toIso)) return;
      var day = shopDayOf_(o);
      var b = out[day] || (out[day] = [0, 0, 0]);
      (o.line_items || []).forEach(function (li) {
        var qty = Number(li.quantity) || 0;
        b[0] += (Number(li.price) || 0) * qty;
        b[1] += qty;
      });
      b[2] += 1;
      orders++;
    });
    pageInfo = shopifyNextPageInfo_(r.link);
    guard++;
  } while (pageInfo && guard < 300 && (!deadlineMs || Date.now() < deadlineMs));
  Object.keys(out).forEach(function (d) { out[d][0] = Math.round(out[d][0] * 100) / 100; });
  return { ok: true, from: fromIso, to: toIso, orders: orders, more: !!pageInfo, dates: out };
}

/**
 * Individual orders, with everything a shipment needs on them.
 *
 * The daily roll-up above answers "how did we do"; this answers "what has to go out of the door",
 * so it carries the address, the line items with their SKUs, and the per-item weight Shopify keeps
 * in `grams`. Nothing is aggregated â€” a courier label is made from one order at a time.
 *
 * `unfulfilled` narrows it to what is still owed, which is almost always the question. Shopify
 * reports a fully shipped order as 'fulfilled' and leaves the field NULL when nothing has shipped,
 * so "still owed" is "not fulfilled", null included â€” checking for the string alone would hide
 * every untouched order.
 */
/**
 * The store's own IANA timezone, e.g. "America/New_York".
 *
 * Shopify stamps `created_at` with the STORE's offset, and that is the date every order in this
 * response carries. So "today" in the app has to mean today in the STORE's day — not the viewer's
 * in India, and not the marketplace's PT. Read rather than hard-coded, for the same reason
 * shopWindow_ refuses to hard-code it: it is a setting somebody can change without telling anyone.
 * One extra request, cached for the execution so a paged fetch does not ask again.
 */
var SHOP_TZ_CACHE = null;
function shopTz_() {
  if (SHOP_TZ_CACHE !== null) return SHOP_TZ_CACHE;
  try {
    var r = shopifyGet_('/shop.json?fields=iana_timezone');
    SHOP_TZ_CACHE = (r.json.shop && r.json.shop.iana_timezone) || '';
  } catch (e) { SHOP_TZ_CACHE = ''; }   // the orders still work; the app falls back and says so
  return SHOP_TZ_CACHE;
}

function shopifyOrders_(fromIso, toIso, unfulfilled, deadlineMs) {
  // `fulfillments` carries the tracking numbers. `fulfillment_status` alone only says whether
  // something shipped, never what it shipped on â€” and "shipped" without a tracking number is not an
  // answer anybody can give a customer.
  // cancelled_at is the ONLY honest marker for a cancelled order: status=any returns them looking
  // exactly like live ones, and fulfillment_status stays null on both. Without it the app cannot
  // tell "nothing has shipped yet" from "this is never shipping".
  // `refunds` is what makes a refunded line visible at all. Shopify does NOT put "this line was
  // refunded" on the line item — it puts the refund on the order, as a list pointing back by
  // line_item_id. Without it a refunded line looks exactly like a live one: it keeps its order in
  // "Need from production" for ever and it goes into an MCF parcel that nobody is owed.
  var fields = 'id,name,order_number,created_at,cancelled_at,cancel_reason,'
    + 'financial_status,fulfillment_status,currency,'
    + 'total_price,shipping_address,customer,email,phone,note,line_items,tags,fulfillments,refunds';
  var base = '/orders.json?status=any&limit=250&fields=' + fields + shopWindow_(fromIso, toIso);
  var out = [], pageInfo = null, guard = 0;
  do {
    var r = shopifyGet_(pageInfo
      ? '/orders.json?limit=250&fields=' + fields + '&page_info=' + encodeURIComponent(pageInfo)
      : base);
    (r.json.orders || []).forEach(function (o) {
      if (!shopInWindow_(o, fromIso, toIso)) return;      // trimmed on the STORE's date
      var ff = String(o.fulfillment_status || '').toLowerCase();
      if (unfulfilled && ff === 'fulfilled') return;
      if (String(o.financial_status || '').toLowerCase() === 'voided') return;
      var a = o.shipping_address || {};
      // Refunded units per line, added up across every refund on the order.
      var refBy = {};
      (o.refunds || []).forEach(function (rf) {
        (rf.refund_line_items || []).forEach(function (rl) {
          var k = String(rl.line_item_id || '');
          if (k) refBy[k] = (refBy[k] || 0) + (Number(rl.quantity) || 0);
        });
      });
      var refUnits = 0;
      var items = (o.line_items || []).map(function (li) {
        var lid = li.id ? String(li.id) : '';
        var rq = refBy[lid] || 0;
        refUnits += rq;
        return {
          lid: lid,
          // Refunded units on this line.
          rq: rq,
          // Shopify's OWN "still to fulfil" count, and the line's own fulfilment state. Both are
          // needed together: fulfillable_quantity drops to 0 when a line SHIPS as well as when it
          // is refunded, so it means "fulfilment not required" only on a line that never shipped.
          // Read alone it would mark every despatched order as cancelled.
          fq: li.fulfillable_quantity == null ? null : Number(li.fulfillable_quantity),
          // What is left after REFUNDS AND ORDER EDITS. An edit that takes a line off the order does
          // not refund it and does not appear in `refunds` at all — Shopify keeps the original
          // quantity and drops this one, and its admin lists those lines under "Removed". Without it
          // a line the buyer had taken off still got picked, packed and sent.
          cq: li.current_quantity == null ? null : Number(li.current_quantity),
          ffl: li.fulfillment_status || '',
          sku: String(li.sku || '').trim(),
          name: li.title || '',
          variant: li.variant_title || '',
          qty: Number(li.quantity) || 0,
          price: Number(li.price) || 0,
          // Shopify holds weight in grams per UNIT; the line's weight is that times the quantity.
          grams: (Number(li.grams) || 0) * (Number(li.quantity) || 0),
          // Carried so the photo can be looked up below. A line item has no image of its own.
          pid: li.product_id ? String(li.product_id) : '',
          vid: li.variant_id ? String(li.variant_id) : '',
        };
      });
      /* Tracking, gathered across every fulfilment on the order.
       *
       * An order can ship in more than one parcel, so there can be more than one number, and a
       * single fulfilment can itself carry several in `tracking_numbers`. All of them are kept:
       * showing the first and hiding the rest is how a customer gets told half a shipment is lost.
       * Cancelled fulfilments are dropped â€” their numbers point at parcels that never went. */
      var trk = [], trkCo = '', trkUrl = '', shippedAt = '';
      (o.fulfillments || []).forEach(function (f) {
        if (String(f.status || '').toLowerCase() === 'cancelled') return;
        var list = (f.tracking_numbers && f.tracking_numbers.length)
          ? f.tracking_numbers : [f.tracking_number];
        list.forEach(function (t) {
          var s = String(t || '').trim();
          if (s && trk.indexOf(s) < 0) trk.push(s);
        });
        if (!trkCo && f.tracking_company) trkCo = String(f.tracking_company);
        var u = f.tracking_url || (f.tracking_urls && f.tracking_urls[0]);
        if (!trkUrl && u) trkUrl = String(u);
        var c = String(f.created_at || '').slice(0, 10);
        if (c && (!shippedAt || c < shippedAt)) shippedAt = c;
      });

      out.push({
        id: String(o.id),
        no: o.name || ('#' + o.order_number),
        at: String(o.created_at || '').slice(0, 10),
        // Empty for a live order. Kept as a DATE rather than a boolean so the app can say when.
        cancelledAt: String(o.cancelled_at || '').slice(0, 10),
        cancelReason: o.cancel_reason || '',
        fin: o.financial_status || '',
        // Units refunded across the whole order. An order whose every unit came back is over,
        // whatever its fulfilment status says.
        refUnits: refUnits,
        // Shopify leaves this NULL when nothing has shipped; 'unfulfilled' is clearer to read than
        // an empty cell, and 'partial' is a real state that must not be rounded to either end.
        ff: String(o.fulfillment_status || 'unfulfilled'),
        trk: trk, trkCo: trkCo, trkUrl: trkUrl, shippedAt: shippedAt,
        cur: o.currency || 'USD',
        total: Number(o.total_price) || 0,
        note: o.note || '',
        tags: o.tags || '',
        ship: {
          name: a.name || ((a.first_name || '') + ' ' + (a.last_name || '')).trim(),
          company: a.company || '', a1: a.address1 || '', a2: a.address2 || '',
          city: a.city || '', state: a.province_code || a.province || '',
          zip: a.zip || '', country: a.country_code || a.country || '',
          phone: a.phone || o.phone || '',
        },
        email: o.email || '',
        items: items,
      });
    });
    pageInfo = shopifyNextPageInfo_(r.link);
    guard++;
  } while (pageInfo && guard < 300 && (!deadlineMs || Date.now() < deadlineMs));

  shopifyAttachImages_(out, deadlineMs);
  return { ok: true, from: fromIso, to: toIso, tz: shopTz_(),
    n: out.length, more: !!pageInfo, orders: out };
}

/* ===================== MCF: shipping a Shopify order out of FBA =====================
 *
 * Three calls, deliberately separate, because they carry very different consequences.
 *
 *   PREVIEW  asks Amazon what it WOULD do â€” which speeds are possible, the fee for each, the
 *            delivery date. Creates nothing. Safe to call as often as you like.
 *   CREATE   places a real shipment. Amazon picks, packs and ships; it costs money and there is no
 *            undo button in this app.
 *   STATUS   reads back what happened, including the tracking number once Amazon has one.
 *
 * The whole design rests on ONE idea: the fulfilment order id is derived from the Shopify order
 * number, never generated. Amazon rejects a duplicate id, so a double-click, a retry after a
 * timeout, or two people working the same list cannot ship the same order twice. That is a much
 * stronger guarantee than a disabled button, because it holds even when the browser is not involved.
 */

/** 'SHOP-1042' from Shopify's '#1042'. Stable, so the same order always maps to the same MCF id. */
function mcfIdOf_(orderNo) {
  return 'SHOP-' + String(orderNo || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
}

/** The address and item shape both preview and create need, built once from what the browser sent. */
function mcfBody_(o) {
  var a = o.ship || {};
  if (!a.a1 || !a.city || !a.country) throw new Error('The order has no usable shipping address.');
  var items = (o.items || []).filter(function (i) { return i.sku && Number(i.qty) > 0; });
  if (!items.length) throw new Error('No line has a SKU Amazon could ship.');
  return {
    address: {
      name: String(a.name || '').slice(0, 50) || 'Customer',
      addressLine1: String(a.a1).slice(0, 60),
      addressLine2: String(a.a2 || '').slice(0, 60) || undefined,
      city: String(a.city).slice(0, 50),
      stateOrRegion: String(a.state || '').slice(0, 150),
      postalCode: String(a.zip || '').slice(0, 20),
      countryCode: String(a.country).slice(0, 2).toUpperCase(),
      phone: String(a.phone || '').slice(0, 20) || undefined,
    },
    items: items.map(function (i, n) {
      return {
        sellerSku: String(i.sku).trim(),
        // Amazon keys its response by this, so it has to be stable AND unique inside the order.
        sellerFulfillmentOrderItemId: String(n + 1),
        quantity: Number(i.qty),
      };
    }),
  };
}

/**
 * What Amazon would charge and when it would arrive, per speed. Creates nothing.
 *
 * Every speed is asked for at once rather than one at a time: the answer for Standard does not tell
 * you whether Priority is even available, and a person choosing how to ship needs all three in front
 * of them or they are not choosing, they are guessing.
 */
function mcfPreview_(o) {
  setBrand_(o.brand || 'SP');
  /* The Shopify half of this — marking the order in progress — belongs to the store the order
   * is in, which is not always the Amazon account it ships from. Absent means Ridhi. */
  setShopBrand_(o.shop || '');
  var b = mcfBody_(o);
  var r = sp_('/fba/outbound/2020-07-01/fulfillmentOrders/preview', 'post', {
    marketplaceId: marketplaceId_(),
    address: b.address,
    items: b.items,
    shippingSpeedCategories: ['Standard', 'Expedited', 'Priority'],
  });
  var previews = (r.payload && r.payload.fulfillmentPreviews) || [];
  return {
    ok: true,
    mcfId: mcfIdOf_(o.no),
    previews: previews.map(function (p) {
      var fees = (p.estimatedFees || []).reduce(function (s, f) {
        return s + Number((f.amount && f.amount.value) || 0);
      }, 0);
      var dates = (p.fulfillmentPreviewShipments || []).map(function (s) {
        return String(s.latestArrivalDate || '').slice(0, 10);
      }).filter(Boolean).sort();
      return {
        speed: p.shippingSpeedCategory,
        // Amazon says outright when it cannot ship this; showing a fee beside "not fulfillable"
        // would invite somebody to click it.
        ok: p.isFulfillable !== false,
        fee: Math.round(fees * 100) / 100,
        cur: ((p.estimatedFees || [])[0] || {}).amount ? p.estimatedFees[0].amount.currencyCode : 'USD',
        weight: (p.estimatedShippingWeight && p.estimatedShippingWeight.value) || null,
        arriveBy: dates[dates.length - 1] || '',
        unfulfillable: (p.unfulfillablePreviewItems || []).map(function (u) {
          return u.sellerSku + ': ' + (u.itemUnfulfillableReasons || []).join(', ');
        }),
      };
    }),
  };
}

/** Place the shipment. Real money, real parcel. The id makes a repeat call harmless. */
function mcfCreate_(o) {
  setBrand_(o.brand || 'SP');
  /* The Shopify half of this — marking the order in progress — belongs to the store the order
   * is in, which is not always the Amazon account it ships from. Absent means Ridhi. */
  setShopBrand_(o.shop || '');
  var speed = String(o.speed || 'Standard');
  if (['Standard', 'Expedited', 'Priority'].indexOf(speed) < 0) throw new Error('Unknown shipping speed "' + speed + '".');
  var b = mcfBody_(o);
  var id = mcfIdOf_(o.no);
  try {
    sp_('/fba/outbound/2020-07-01/fulfillmentOrders', 'post', {
      marketplaceId: marketplaceId_(),
      sellerFulfillmentOrderId: id,
      displayableOrderId: String(o.no || id).slice(0, 40),
      displayableOrderDate: (o.at || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z',
      displayableOrderComment: String(o.comment || 'Thank you for your order.').slice(0, 1000),
      shippingSpeedCategory: speed,
      destinationAddress: b.address,
      items: b.items,
    });
  } catch (e) {
    // A repeat of an order already placed is NOT a failure. Amazon rejecting the duplicate is the
    // safety net doing its job, and the honest answer is "it is already on its way", not an error.
    if (String(e.message || '').indexOf('DuplicateRequest') < 0) throw e;
    return { ok: true, mcfId: id, already: true, shop: mcfMarkShopInProgress_(o) };
  }
  return { ok: true, mcfId: id, already: false, shop: mcfMarkShopInProgress_(o) };
}

/**
 * Tell Shopify the order is being worked on, now that Amazon has it.
 *
 * DELIBERATELY UNABLE TO FAIL THE MCF ORDER. By the time this runs the parcel is already booked with
 * Amazon and money is committed; throwing here would report a failure for something that succeeded,
 * and the obvious next move — pressing the button again — would be an attempt to place it twice.
 * So every outcome comes back as data on the response and the caller shows it.
 */
function mcfMarkShopInProgress_(o) {
  if (String(prop_('SHOPIFY_INPROGRESS') || '').toLowerCase() !== 'on') {
    return { ok: false, off: true, note: 'Shopify "in progress" is switched off (Script Property SHOPIFY_INPROGRESS).' };
  }
  try { return shopifyMarkInProgress_(o && o.id); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 220) }; }
}

/** What Amazon has done with it since, tracking included. */
function mcfStatus_(mcfId, brand) {
  setBrand_(brand || 'SP');
  var r = sp_('/fba/outbound/2020-07-01/fulfillmentOrders/' + encodeURIComponent(mcfId), 'get');
  var p = r.payload || {};
  var trk = [], co = '', shipped = '';
  (p.fulfillmentShipments || []).forEach(function (s) {
    (s.fulfillmentShipmentPackage || []).forEach(function (k) {
      var t = String(k.trackingNumber || '').trim();
      if (t && trk.indexOf(t) < 0) trk.push(t);
      if (!co && k.carrierCode) co = String(k.carrierCode);
    });
    var d = String(s.shippingDate || '').slice(0, 10);
    if (d && (!shipped || d < shipped)) shipped = d;
  });
  return {
    ok: true, mcfId: mcfId,
    status: (p.fulfillmentOrder && p.fulfillmentOrder.fulfillmentOrderStatus) || '',
    trk: trk, trkCo: co, shippedAt: shipped,
  };
}

/**
 * Mark the Shopify order shipped, with Amazon's tracking number on it.
 *
 * Goes through FULFILMENT ORDERS rather than the old per-order endpoint, which Shopify has retired:
 * you ask which fulfilment orders exist, then fulfil the ones assigned to you. Only OPEN ones are
 * touched, so running this twice cannot raise a second fulfilment or send the customer a second
 * shipping email.
 */
function shopifyFulfil_(orderId, trk, company, notify) {
  var fo = shopifyGet_('/orders/' + encodeURIComponent(orderId) + '/fulfillment_orders.json').json;
  var open = (fo.fulfillment_orders || []).filter(function (f) {
    var s = String(f.status || '').toLowerCase();
    return s === 'open' || s === 'in_progress' || s === 'scheduled';
  });
  if (!open.length) return { ok: true, already: true, note: 'Nothing open to fulfil on Shopify.' };
  var list = (trk || []).filter(Boolean).map(String);
  var r = shopifyWrite_('/fulfillments.json', 'post', {
    fulfillment: {
      line_items_by_fulfillment_order: open.map(function (f) { return { fulfillment_order_id: f.id }; }),
      tracking_info: list.length
        ? { number: list[0], company: company || 'Amazon Logistics' }
        : undefined,
      notify_customer: notify !== false,
    },
  });
  // ONE number goes out, however many Amazon gave. Reading keeps them all; writing does not, and the
  // proper fix waits on the write token (there is nothing to test a payload against until then).
  // What must not wait is saying so: a two-parcel order otherwise tells the customer about one
  // parcel and tells us it told them about all of them. The ones left behind ride back in `held`.
  return {
    ok: true, already: false, id: (r.fulfillment && r.fulfillment.id) || '',
    sent: list.slice(0, 1), held: list.slice(1),
  };
}


/* ===================== Shopify: "in progress" after MCF =====================
 *
 * When a parcel has been handed to Amazon MCF, the Shopify order is no longer just sitting there —
 * somebody IS fulfilling it, and Shopify has a status that says exactly that. This moves it.
 *
 * FOUR THINGS TO KNOW BEFORE TOUCHING THIS, all of them checked rather than assumed (2026-09-01):
 *
 *   1. There is no REST way to do it. `fulfillmentOrderReportProgress` is a GRAPHQL mutation, and
 *      it is new — Shopify's docs put it in API version 2026-07. Until 2025 the official answer was
 *      that IN_PROGRESS could not be reached at all without registering a fulfilment service.
 *
 *   2. So it runs on its OWN API version, SHOP_GQL_VERSION, and leaves SHOP_API_VERSION where it is.
 *      Everything else here — reading orders, the images, the fulfilment write — is REST on 2024-10
 *      and has been working for months. Dragging all of it forward two years to gain one mutation is
 *      a much bigger change than this feature is worth, and it would be an untested one.
 *
 *   3. It needs a token the account may not have: scope `write_merchant_managed_fulfillment_orders`
 *      (or `write_assigned_fulfillment_orders`) PLUS the `fulfill_and_ship_orders` permission. A
 *      token issued before those were added does NOT gain them — it has to be re-issued.
 *
 *   4. THE DOCS DO NOT ACTUALLY PROMISE THE STATUS FLIPS. They say the mutation "reports the
 *      progress of an open or in-progress fulfillment order"; that it lands on IN_PROGRESS is a
 *      forum report, not documentation. So this returns whatever Shopify says the status became,
 *      and the caller records that rather than assuming. Run `shopifyInProgressTest` on ONE order
 *      and read the real answer before switching it on for everybody.
 *
 * OFF BY DEFAULT. Set Script Property SHOPIFY_INPROGRESS = "on" to arm it. Off, nothing is called.
 */
var SHOP_GQL_VERSION = '2026-07';

/**
 * One GraphQL call.
 *
 * Kept apart from shopifyWrite_ because GraphQL answers **200 OK with the failure inside the body**.
 * Running it through the REST helper would read that as success, and a write that quietly did
 * nothing is the worst of the three outcomes.
 */
function shopifyGql_(query, variables) {
  /* The store this call belongs to — Ridhi unless somebody set the other one. */
  var token = shopifyToken_();
  var url = 'https://' + shopifyStore_() + '/admin/api/' + SHOP_GQL_VERSION + '/graphql.json';
  var resp = UrlFetchApp.fetch(url, {
    method: 'post', muteHttpExceptions: true, contentType: 'application/json',
    headers: { 'X-Shopify-Access-Token': token },
    payload: JSON.stringify({ query: query, variables: variables || {} }),
  });
  var code = resp.getResponseCode(), text = resp.getContentText();
  if (code === 401 || code === 403) {
    throw new Error('Shopify ' + code + ' — this token cannot write fulfilment orders. It needs '
      + 'write_merchant_managed_fulfillment_orders and fulfill_and_ship_orders, and a token issued '
      + 'before those scopes were added will not have them: ' + text.slice(0, 160));
  }
  if (code >= 300) throw new Error('Shopify ' + code + ': ' + text.slice(0, 300));
  var d = JSON.parse(text || '{}');
  if (d.errors && d.errors.length) {
    throw new Error('Shopify GraphQL: ' + String(d.errors[0].message || '').slice(0, 200));
  }
  return d.data || {};
}

/**
 * Move an order's OPEN fulfilment orders to "in progress".
 *
 * Only genuinely OPEN ones are touched, so running this twice is harmless — the second run finds
 * nothing open and says so, exactly like shopifyFulfil_ does.
 */
function shopifyMarkInProgress_(shopifyOrderId) {
  // An IMPORTED order (Etsy, CPC Shopify) has an id like "IMP-…" and does not exist in this Shopify
  // store at all. Sending that to Shopify would 404 on an order somebody would then go looking for.
  var id = String(shopifyOrderId || '').trim();
  if (!/^\d+$/.test(id)) return { ok: true, skipped: true, note: 'Not a Shopify-fetched order — nothing to move.' };

  var fo = shopifyGet_('/orders/' + encodeURIComponent(id) + '/fulfillment_orders.json').json;
  var open = (fo.fulfillment_orders || []).filter(function (f) {
    return String(f.status || '').toLowerCase() === 'open';
  });
  if (!open.length) return { ok: true, already: true, note: 'No open fulfilment order on this Shopify order.' };

  // `progressReport` is optional and its inner field names are not something this code has verified,
  // so it is not sent. One guess fewer.
  var Q = 'mutation($id: ID!) {'
        + '  fulfillmentOrderReportProgress(id: $id) {'
        + '    fulfillmentOrder { id status }'
        + '    userErrors { field message }'
        + '  }'
        + '}';
  var moved = [];
  for (var i = 0; i < open.length; i++) {
    var d = shopifyGql_(Q, { id: 'gid://shopify/FulfillmentOrder/' + open[i].id });
    var p = (d && d.fulfillmentOrderReportProgress) || {};
    var errs = (p.userErrors || []).map(function (e) { return e.message; }).filter(Boolean);
    if (errs.length) throw new Error(errs.join('; ').slice(0, 200));
    moved.push({
      id: open[i].id,
      // What Shopify SAYS it is now — not what this code hoped it would be.
      status: (p.fulfillmentOrder && p.fulfillmentOrder.status) || '',
    });
  }
  return { ok: true, moved: moved };
}

/**
 * Editor check: run the whole thing against ONE order and print exactly what Shopify answered.
 *
 * The same shape as indiaStockTest and basketTest — when something has never run against the real
 * account, the fix is one line printed in the editor, not a redeploy per guess. Put a real Shopify
 * order id (the long number, not "#4136") in ORDER_ID and press Run.
 */
function shopifyInProgressTest() {
  var ORDER_ID = '';
  if (!ORDER_ID) {
    Logger.log('Put a numeric Shopify order id in ORDER_ID first (Shopify admin URL: /orders/<this number>).');
    return;
  }
  Logger.log('token set: %s · graphql version: %s', !!prop_('SHOPIFY_TOKEN'), SHOP_GQL_VERSION);
  try {
    var fo = shopifyGet_('/orders/' + ORDER_ID + '/fulfillment_orders.json').json;
    (fo.fulfillment_orders || []).forEach(function (f) {
      Logger.log('fulfilment order %s — status %s · assigned to %s', f.id, f.status,
        (f.assigned_location && f.assigned_location.name) || '?');
    });
    Logger.log('RESULT: %s', JSON.stringify(shopifyMarkInProgress_(ORDER_ID)));
  } catch (e) {
    Logger.log('FAILED: %s', e.message || e);
  }
}

/**
 * Hang a product photo on every line item.
 *
 * A Shopify line item carries no image, only the ids, so the products have to be asked for
 * separately â€” once for the whole page of orders rather than once per line, which for a few hundred
 * orders is the difference between two requests and a thousand.
 *
 * The VARIANT's own photo wins where it has one: on a catalogue of colourways, the product-level
 * image is whichever colour happens to be first, and shipping the wrong colour because the picture
 * said so is a real mistake. The product image is the fallback, not the answer.
 */
function shopifyAttachImages_(orders, deadlineMs) {
  var ids = {}, list = [];
  orders.forEach(function (o) {
    o.items.forEach(function (i) { if (i.pid && !ids[i.pid]) { ids[i.pid] = 1; list.push(i.pid); } });
  });
  if (!list.length) return;

  var byVariant = {}, byProduct = {};
  for (var i = 0; i < list.length; i += 100) {
    if (deadlineMs && Date.now() > deadlineMs) break;
    var chunk = list.slice(i, i + 100);
    try {
      var r = shopifyGet_('/products.json?limit=250&fields=id,image,images,variants&ids=' + chunk.join(','));
      (r.json.products || []).forEach(function (p) {
        var pid = String(p.id);
        if (p.image && p.image.src) byProduct[pid] = p.image.src;
        var srcById = {};
        (p.images || []).forEach(function (im) { if (im && im.id) srcById[String(im.id)] = im.src; });
        (p.variants || []).forEach(function (v) {
          var src = v.image_id ? srcById[String(v.image_id)] : '';
          if (src) byVariant[String(v.id)] = src;
        });
      });
    } catch (e) { /* photos are a nicety â€” an order still ships without one */ }
  }

  orders.forEach(function (o) {
    o.items.forEach(function (it) {
      it.img = (it.vid && byVariant[it.vid]) || (it.pid && byProduct[it.pid]) || '';
    });
  });
}

/**
 * Are there duplicate order rows in an Orders workbook?
 *
 * Every scan in this file trusts the workbook: it adds up the rows it finds. So if the same orders
 * were imported twice, every figure built on them is double and no amount of care on this side can
 * tell â€” the rows look exactly like real sales, because they ARE real sales, written down twice.
 *
 * This counts each (Order ID + ASIN + date) combination and reports the ones that appear more than
 * once, with the dates they fall on. A clean workbook reports nothing. Run it from the editor:
 *
 *   ordersDupCheck(0)   Ridhi        ordersDupCheck(1)   CPC
 */
function ordersDupCheck(bookIx, days) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) { Logger.log('No orders workbook #' + ix); return; }
  var back = Math.min(Math.max(Number(days) || 60, 1), 400);
  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var cutoff = new Date(todayStr + 'T00:00:00Z').getTime() - back * 86400000;

  var sh = null, ss = SpreadsheetApp.openById(id);
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) { Logger.log('No Orders tab in workbook #' + ix); return; }

  var lastRow = sh.getLastRow();
  var data = sh.getRange(2, 1, Math.max(0, lastRow - 1), 10).getValues();
  var seen = {}, perDay = {}, dupDay = {}, rows = 0, dupRows = 0;

  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (!chanOk_(r[8])) continue;                    // other marketplaces, other currencies
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    var dMs = toMs_(r[2]); if (!dMs || dMs < cutoff) continue;
    var day = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd');
    // Order id + ASIN + date: one line of one order on one day can only legitimately appear once.
    var key = String(r[0] || '') + '|' + String(r[4] || '') + '|' + day;
    rows++;
    perDay[day] = (perDay[day] || 0) + 1;
    if (seen[key]) { dupRows++; dupDay[day] = (dupDay[day] || 0) + 1; }
    seen[key] = (seen[key] || 0) + 1;
  }

  Logger.log('workbook  #' + ix + '  (' + (ix === 0 ? 'Ridhi' : 'CPC') + ')');
  Logger.log('window    last ' + back + ' days, ' + rows + ' rows read');
  Logger.log('duplicates ' + dupRows + ' row(s) repeat an order line already seen');
  if (!dupRows) { Logger.log('âœ… Nothing repeated â€” the workbook is clean.'); return; }
  Logger.log('');
  Logger.log('date         rows   repeated');
  Object.keys(perDay).sort().forEach(function (d) {
    Logger.log('  ' + d + '  ' + String(perDay[d]).padStart(6) + '   ' + String(dupDay[d] || 0).padStart(6)
      + (dupDay[d] ? '   <-- ' + Math.round(dupDay[d] / perDay[d] * 100) + '% of this day is a repeat' : ''));
  });
}

/**
 * The workbook against the cache, day by day.
 *
 * Two numbers for the same day from the two ends of the pipeline: one counted here and now straight
 * off the sheet in a single pass, the other whatever the nightly run left in the `daily` cache. They
 * should be identical. Where they are not, the fault is between them â€” in the slicing, the
 * accumulator or the merge â€” and the ratio says how badly.
 *
 *   dailyAudit(0)   Ridhi        dailyAudit(1)   CPC
 */
function dailyAudit(bookIx, days) {
  var ix = Number(bookIx) || 0;
  var brand = ix === 0 ? 'SP' : 'CPC';
  var id = ORDERS_DATA_IDS[ix];
  if (!id) { Logger.log('No orders workbook #' + ix); return; }
  // Reaches as far back as the cache itself does. The old 120-day ceiling meant a YTD figure could
  // not be checked at all past April, and a year-to-date number nobody can audit is a number nobody
  // can trust. The sheet is read in one pass either way, so a longer window costs nothing extra.
  //   dailyAudit(0, 260)  the year so far      dailyAudit(0, 800)  everything the cache holds
  var back = Math.min(Math.max(Number(days) || 21, 1), NIGHTLY_DAILY_DAYS);
  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var cutoff = new Date(todayStr + 'T00:00:00Z').getTime() - back * 86400000;

  var sh = null, ss = SpreadsheetApp.openById(id);
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) { Logger.log('No Orders tab in workbook #' + ix); return; }

  // Counted exactly the way dailySalesChunk_ counts, but in ONE pass over the whole window, so no
  // slicing, no accumulator and no merge can come between the rows and the total.
  var lastRow = sh.getLastRow();
  var data = sh.getRange(2, 1, Math.max(0, lastRow - 1), 10).getValues();
  var sheet = {}, offChan = {}, offRows = 0;
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    var dMs = toMs_(r[2]); if (!dMs || dMs < cutoff) continue;
    var day = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd');
    // Off-marketplace rows are counted SEPARATELY rather than just skipped. A filter nobody can see
    // is how the last one hid: dropping thousands of dollars silently and dropping nothing look
    // identical from the outside.
    if (!chanOk_(r[8])) {
      offChan[String(r[8] || '(blank)')] = (offChan[String(r[8] || '(blank)')] || 0) + (Number(r[6]) || 0);
      offRows++;
      continue;
    }
    sheet[day] = (sheet[day] || 0) + (Number(r[6]) || 0);
  }

  var c = cacheRead_('daily');
  var cached = (c && c.d && c.d[brand]) || {};
  Logger.log('workbook #' + ix + ' (' + (ix === 0 ? 'Ridhi' : 'CPC') + ')  ·  cache written ' + ((c && c.at) || 'never'));
  Logger.log('');
  Logger.log('date            sheet        cache     ratio');
  var bad = 0, totS = 0, totK = 0;
  var days = Object.keys(sheet).sort();
  days.forEach(function (d) {
    var s = Math.round(sheet[d]);
    var k = Math.round((cached[d] && cached[d][0]) || 0);
    totS += s; totK += k;
    var ratio = s ? (k / s) : 0;
    if (s && Math.abs(ratio - 1) > 0.02) bad++;
    Logger.log('  ' + d + '  ' + String(s).padStart(10) + '   ' + String(k).padStart(10)
      + '   ' + ratio.toFixed(2) + (s && Math.abs(ratio - 1) > 0.02 ? '  <--' : ''));
  });
  Logger.log('');
  // The window's TOTAL, so a period figure can be checked against Seller Central in one line instead
  // of adding up a screen of days by hand. Day-by-day says where; this says how much.
  Logger.log('  TOTAL ' + (days.length ? days[0] + ' to ' + days[days.length - 1] : '(nothing)')
    + '   sheet ' + Math.round(totS).toLocaleString('en-US')
    + '   cache ' + Math.round(totK).toLocaleString('en-US')
    + '   ' + (totS ? (totK / totS).toFixed(3) : '-') + 'x'
    + (totS ? '   diff ' + Math.round(totK - totS).toLocaleString('en-US') : ''));
  if (offRows) {
    Logger.log('');
    Logger.log('  EXCLUDED, not on ' + ORDERS_CHANNELS.join('/') + ' -- ' + offRows
      + ' row(s), in their own marketplace currency, NOT dollars:');
    Object.keys(offChan).sort().forEach(function (k) {
      Logger.log('    ' + k + '   ' + offChan[k].toFixed(2));
    });
  }
  Logger.log('');
  Logger.log(bad ? bad + ' day(s) where the cache disagrees with the sheet.'
                 : 'OK - every day matches, the pipeline is faithful to the workbook.');
}

/**
 * The workbook against the PER-ASIN WEEKLY cache, week by week.
 *
 * dailyAudit checks the `daily` cache, which is what the Ad Console draws. Parent Listing Review and
 * PPC & Organic never touch that cache â€” they read `weekly`, a different shape built by a different
 * phase, and nothing checked it. That is how a six-week average sat 28% high while dailyAudit
 * reported every day at 1.00: both were true, about different caches.
 *
 * Same method as dailyAudit. One pass over the sheet, bucketed by the same week key the pipeline
 * uses, against whatever the nightly run published. Where a week disagrees the ASINs behind it are
 * named, because a doubled week is always a handful of ASINs and not the whole catalogue â€” and
 * knowing which ones turns a rebuild into a question you can answer.
 *
 *   weeklyAudit(0)   Ridhi        weeklyAudit(1)   CPC
 */
function weeklyAudit(bookIx, weeks) {
  var ix = Number(bookIx) || 0;
  var brand = ix === 0 ? 'SP' : 'CPC';
  var id = ORDERS_DATA_IDS[ix];
  if (!id) { Logger.log('No orders workbook #' + ix); return; }

  var sh = null, ss = SpreadsheetApp.openById(id);
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) { Logger.log('No Orders tab in workbook #' + ix); return; }

  var keys = weeklyKeys_(Number(weeks) || 26), first = keys[0], want = {};
  keys.forEach(function (k) { want[k] = 1; });

  // Counted exactly the way weeklySalesChunk_ counts, but in ONE pass over the whole window, so no
  // slicing, no accumulator and no merge can come between the rows and the total.
  var lastRow = sh.getLastRow();
  var data = sh.getRange(2, 1, Math.max(0, lastRow - 1), 10).getValues();
  var sheetWk = {}, sheetAsin = {};
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var asin = String(r[4] || '').trim().toUpperCase(); if (!asin) continue;
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (!chanOk_(r[8])) continue;                    // other marketplaces, other currencies
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    var dMs = toMs_(r[2]); if (!dMs) continue;
    var wk = weekKeyOf_(dMs);
    if (wk < first || !want[wk]) continue;
    var rev = Number(r[6]) || 0;
    sheetWk[wk] = (sheetWk[wk] || 0) + rev;
    var sa = sheetAsin[wk] || (sheetAsin[wk] = {});
    sa[asin] = (sa[asin] || 0) + rev;
  }

  var c = cacheRead_('weekly');
  var byAsin = (c && c.rows && c.rows[brand]) || {};
  var cacheWk = {}, cacheAsin = {};
  Object.keys(byAsin).forEach(function (a) {
    var byWeek = byAsin[a] || {};
    Object.keys(byWeek).forEach(function (w) {
      var v = (byWeek[w] && byWeek[w][1]) || 0;
      cacheWk[w] = (cacheWk[w] || 0) + v;
      var ca = cacheAsin[w] || (cacheAsin[w] = {});
      ca[a] = (ca[a] || 0) + v;
    });
  });

  Logger.log('workbook #' + ix + ' (' + (ix === 0 ? 'Ridhi' : 'CPC')
    + ')  Â·  weekly cache written ' + ((c && c.at) || 'never'));
  Logger.log('');
  Logger.log('week            sheet        cache     ratio');
  var bad = [];
  keys.forEach(function (w) {
    var s = Math.round(sheetWk[w] || 0), k = Math.round(cacheWk[w] || 0);
    if (!s && !k) return;
    var ratio = s ? (k / s) : 0;
    var off = s && Math.abs(ratio - 1) > 0.02;
    if (off) bad.push(w);
    Logger.log('  ' + w + '  ' + String(s).padStart(10) + '   ' + String(k).padStart(10)
      + '   ' + ratio.toFixed(2) + (off ? '  <--' : ''));
  });
  Logger.log('');
  if (!bad.length) { Logger.log('OK - every week matches the workbook.'); return; }

  Logger.log(bad.length + ' week(s) disagree with the workbook. The ASINs behind them:');
  bad.forEach(function (w) {
    var s = sheetAsin[w] || {}, k = cacheAsin[w] || {}, names = {};
    Object.keys(s).forEach(function (a) { names[a] = 1; });
    Object.keys(k).forEach(function (a) { names[a] = 1; });
    // Sorted by how many dollars each ASIN is out by, not by ratio: an ASIN that is 3x on $40 is
    // noise, and one that is 1.4x on $30,000 is the whole problem.
    var list = Object.keys(names).map(function (a) {
      return { a: a, s: Math.round(s[a] || 0), k: Math.round(k[a] || 0) };
    }).filter(function (x) { return Math.abs(x.k - x.s) > 1; })
      .sort(function (p, q) { return Math.abs(q.k - q.s) - Math.abs(p.k - p.s); });
    Logger.log('  ' + w + '  ' + list.length + ' ASIN(s) differ, worst first:');
    list.slice(0, 8).forEach(function (x) {
      Logger.log('    ' + x.a + '  sheet ' + String(x.s).padStart(8) + '   cache ' + String(x.k).padStart(8)
        + '   ' + (x.s ? (x.k / x.s).toFixed(2) : '-'));
    });
  });
}

/**
 * One day of one Orders workbook, pulled apart every way that could explain a gap.
 *
 * dailyAudit and weeklyAudit both answer "is the pipeline faithful to the workbook". Neither can
 * answer "is the workbook the same thing Seller Central is showing", because that question is not
 * about the pipeline at all â€” it is about what the workbook's columns MEAN.
 *
 * So this prints the header row in full, then that one day broken down by every column that could
 * account for a difference: the totals the code uses, the totals it throws away, every numeric
 * column summed, and every short text column grouped. The code has only ever read columns A to J;
 * if tax, shipping or a marketplace sits past that, nothing has ever looked at it.
 *
 *   daySplit(1, '2026-08-09')     CPC, 9 Aug        daySplit(0, '2026-08-09')     Ridhi
 */
function daySplit(bookIx, day) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) { Logger.log('No orders workbook #' + ix); return; }
  var want = String(day || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(want)) {
    Logger.log('Pass the day as yyyy-mm-dd, e.g.  daySplit(1, "2026-08-09")'); return;
  }

  var sh = null, ss = SpreadsheetApp.openById(id);
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) { Logger.log('No Orders tab in workbook #' + ix); return; }

  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  Logger.log('workbook #' + ix + ' (' + (ix === 0 ? 'Ridhi' : 'CPC') + ')   tab "' + sh.getName()
    + '"   ' + (lastRow - 1) + ' rows x ' + lastCol + ' columns');
  Logger.log('the code reads only:  [0] order  [2] date  [4] asin  [5] units  [6] sales  [7] status  [9] mcf');
  Logger.log('');
  Logger.log('COLUMNS');
  head.forEach(function (h, i) { Logger.log('  [' + i + '] ' + (String(h || '').trim() || '(blank)')); });

  var data = sh.getRange(2, 1, Math.max(0, lastRow - 1), lastCol).getValues();
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var dMs = toMs_(data[i][2]);
    if (dMs && Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd') === want) rows.push(data[i]);
  }

  var isMcf = function (r) { return String(r[9] || '').toUpperCase() === 'MCF'; };
  var isCan = function (r) { return String(r[7] || '').toLowerCase() === 'cancelled'; };
  var sum = function (list, c) {
    return list.reduce(function (s, r) { return s + (Number(r[c]) || 0); }, 0);
  };
  var offChan = function (r) { return !chanOk_(r[8]); };
  var kept = rows.filter(function (r) { return !isMcf(r) && !isCan(r) && !offChan(r); });

  Logger.log('');
  Logger.log('DAY ' + want);
  Logger.log('  rows on this date          ' + rows.length);
  Logger.log('  units  [5]  all rows       ' + Math.round(sum(rows, 5)));
  Logger.log('  sales  [6]  all rows       ' + sum(rows, 6).toFixed(2));
  Logger.log('  sales  [6]  MCF rows       ' + sum(rows.filter(isMcf), 6).toFixed(2) + '   (dropped)');
  Logger.log('  sales  [6]  cancelled      ' + sum(rows.filter(isCan), 6).toFixed(2) + '   (dropped)');
  Logger.log('  sales  [6]  other channel  ' + sum(rows.filter(offChan), 6).toFixed(2)
    + '   (dropped - not ' + ORDERS_CHANNELS.join('/') + ', and in another currency)');
  Logger.log('  >> WHAT THE APP COUNTS     ' + sum(kept, 6).toFixed(2)
    + '   from ' + kept.length + ' rows, ' + Math.round(sum(kept, 5)) + ' units');

  Logger.log('');
  Logger.log('EVERY NUMERIC COLUMN, over the rows the app counts');
  Logger.log('  (a tax or shipping column here is the usual reason a workbook sits above Seller Central)');
  head.forEach(function (h, c) {
    var n = 0, tot = 0;
    kept.forEach(function (r) { if (r[c] !== '' && r[c] != null && !isNaN(Number(r[c]))) { n++; tot += Number(r[c]); } });
    if (n && Math.abs(tot) > 0.005) {
      Logger.log('  [' + c + '] ' + (String(h || '').trim() || '(blank)') + '  =  ' + tot.toFixed(2));
    }
  });

  Logger.log('');
  Logger.log('EVERY SHORT TEXT COLUMN, grouped (rows / sales)');
  head.forEach(function (c0, c) {
    var g = {}, keys = [];
    for (var j = 0; j < rows.length; j++) {
      var v = rows[j][c];
      if (v instanceof Date || (v !== '' && v != null && !isNaN(Number(v)))) return;   // not a label
      var k = String(v == null ? '' : v).trim() || '(blank)';
      if (k.length > 40) return;                       // free text, not a category
      if (!g[k]) { g[k] = [0, 0]; keys.push(k); if (keys.length > 12) return; }
      g[k][0]++; g[k][1] += Number(rows[j][6]) || 0;
    }
    if (!keys.length || keys.length > 12) return;
    Logger.log('  [' + c + '] ' + (String(c0 || '').trim() || '(blank)'));
    keys.sort().forEach(function (k) {
      Logger.log('        ' + k + '   ' + g[k][0] + ' rows   ' + g[k][1].toFixed(2));
    });
  });

  Logger.log('');
  Logger.log('FIRST 2 ROWS, every column, so the shape is not a guess');
  rows.slice(0, 2).forEach(function (r, n) {
    Logger.log('  row ' + (n + 1) + ':');
    r.forEach(function (v, c) {
      Logger.log('     [' + c + '] ' + (String(head[c] || '').trim() || '?') + ' = '
        + (v instanceof Date ? Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd HH:mm') + ' (Date)' : String(v)));
    });
  });
}
/**
 * Can this script place MCF orders at all?
 *
 * Creating a fulfilment order needs the "Amazon Fulfillment" role ("Ship to Amazon, and Amazon ships
 * directly to customer"). NOT "Shipping" / "Direct-to-Consumer Shipping" — those cover buying your
 * OWN labels through a different API.
 *
 * WARNING: a 403 here is NOT proof the role is missing. SP-API answers an unrecognised PATH with
 * "403 Unauthorized - Access to requested resource is denied", the very same words it uses for a real
 * permission refusal. These calls sat on `/fbaOutbound/2020-07-01/...` for a while, which is the
 * API's NAME and not its URL; the path is `/fba/outbound/2020-07-01/...`. The role was ticked and the
 * refresh token was current the whole time, and neither made any difference, because the request
 * never reached the API at all. Check the path before touching any credentials.
 *
 * The role is granted per app in Seller Central, NOT by the credentials already working here â€” catalogue,
 * pricing, reports and inventory all come from roles this app has, and none of them imply this one.
 * Without it every call returns 403 no matter how correct the payload is.
 *
 * So this asks the LIST endpoint, which is read-only and creates nothing. A 200 means the door is
 * open. Run it before anybody builds a button that spends money.
 */
function mcfCheck() {
  ['SP', 'CPC'].forEach(function (b) {
    setBrand_(b);
    var label = (b === 'SP' ? 'Ridhi' : 'CPC') + ' (' + b + ')';
    try {
      var from = Utilities.formatDate(new Date(Date.now() - 7 * 86400000), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
      var r = sp_('/fba/outbound/2020-07-01/fulfillmentOrders?queryStartDate=' + encodeURIComponent(from), 'get');
      var list = (r.payload && r.payload.fulfillmentOrders) || [];
      Logger.log(label + '  OK - outbound fulfilment is authorised.  ' + list.length
        + ' MCF order(s) in the last 7 days.  marketplace ' + marketplaceId_());
    } catch (e) {
      var m = String(e.message || e);
      Logger.log(label + '  FAILED');
      Logger.log('   ' + m.slice(0, 300));
      if (m.indexOf('403') >= 0 || m.toLowerCase().indexOf('unauthorized') >= 0) {
        Logger.log('   -> 403. Check in THIS order:');
        Logger.log('      1. the PATH - SP-API says 403 for an unknown path too, in the same words.');
        Logger.log('         It must be /fba/outbound/2020-07-01/... ("fbaOutbound" is the API name).');
        Logger.log('      2. the role "Amazon Fulfillment" on the app in Develop Apps.');
        Logger.log('         NOT "Shipping" - that one is for buying your own labels.');
        Logger.log('      3. the token - one minted before the role does not carry it, so re-authorise');
        Logger.log('         and paste the NEW refresh token into ' + b + '_REFRESH_TOKEN.');
      }
    }
  });
  setBrand_('SP');
}

function daySplitRidhiYesterday() { daySplit(0, Utilities.formatDate(new Date(Date.now() - 86400000), ORDERS_PT, 'yyyy-MM-dd')); }
function daySplitCPCYesterday()   { daySplit(1, Utilities.formatDate(new Date(Date.now() - 86400000), ORDERS_PT, 'yyyy-MM-dd')); }

/* The editor's Run button takes no arguments, so the second brand needs its own name in the list. */
function dailyAuditRidhi() { dailyAudit(0); }
function dailyAuditCPC()   { dailyAudit(1); }
/* The whole year so far, for checking a YTD figure against Seller Central in one line. */
function dailyAuditYearRidhi() { dailyAudit(0, 400); }
function dailyAuditYearCPC()   { dailyAudit(1, 400); }
function weeklyAuditRidhi() { weeklyAudit(0); }
function weeklyAuditCPC()   { weeklyAudit(1); }
function ordersDupCheckRidhi() { ordersDupCheck(0); }
function ordersDupCheckCPC()   { ordersDupCheck(1); }

/**
 * What is sitting in each scratch accumulator right now.
 *
 * The merges add slices up, so a slice that is in there twice doubles whatever it covers. This lists
 * what a merge would actually see: how many slices, how many carry a key, and which keys repeat.
 * Run it DURING a pass to catch the state that produced a bad cache â€” a finished phase clears its
 * own accumulator, so afterwards there is nothing left to look at.
 */
function accCheck() {
  ['daily', 'weekly', 'dayAsin', 'ads', 'adsAsin', 'adsAsinDay',
   'srchTerm', 'targeting', 'adGroup', 'placement', 'shopSku', 'sessions'].forEach(function (name) {
    var raw = accReadRaw_(name);
    if (!raw.length) { Logger.log(name + ': empty'); return; }
    var keyed = 0, counts = {}, perBrand = {};
    raw.forEach(function (p) {
      if (!p) return;
      if (p.k) { keyed++; counts[p.k] = (counts[p.k] || 0) + 1; }
      perBrand[p.brand || '?'] = (perBrand[p.brand || '?'] || 0) + 1;
    });
    var repeats = Object.keys(counts).filter(function (k) { return counts[k] > 1; });
    Logger.log(name + ': ' + raw.length + ' slice(s), ' + keyed + ' keyed, '
      + (raw.length - keyed) + ' UNKEYED'
      + ' · by brand ' + JSON.stringify(perBrand)
      + (repeats.length ? ' · REPEATED KEYS: ' + repeats.slice(0, 6).join(', ') : ''));
  });
  var st = nState_();
  Logger.log('state: day ' + (st.day || '—') + ', phase ' + (st.phase || 'idle')
    + ', cursor book ' + st.book + ' row ' + st.row
    + ', accumulators started this pass ' + JSON.stringify(st.acc || {}));
}

/** Run from the editor to prove the credentials and see a few days of totals. */
function shopifyCheck() {
  try { Logger.log('store  ' + shopifyStore_()); }
  catch (e) { Logger.log('âŒ ' + e.message); return; }
  var end = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var start = Utilities.formatDate(new Date(Date.now() - 6 * 86400000), ORDERS_PT, 'yyyy-MM-dd');
  try {
    var r = shopifyDaily_(start, end);
    Logger.log('âœ… ' + r.orders + ' order(s) between ' + start + ' and ' + end);
    Object.keys(r.dates).sort().forEach(function (d) {
      var v = r.dates[d];
      Logger.log('   ' + d + '  $' + v[0].toLocaleString() + '  ' + v[1] + ' units  ' + v[2] + ' orders');
    });
    if (!r.orders) Logger.log('   (No orders in that window â€” not an error, just a quiet week.)');
  } catch (e) { Logger.log('âŒ ' + e.message); }
}

/* ===================== Nightly pipeline ===================== */
/*
 * Everything the browser used to grind through â€” the Orders scan, the ad reports, the per-week
 * session reports â€” done overnight instead, so opening a tab becomes a read rather than a wait.
 *
 * SHAPED BY TWO HARD LIMITS, not by preference:
 *   1. Apps Script stops a run at six minutes. The full job is far longer, so this is not one long
 *      script â€” it is a STATE MACHINE that wakes every ten minutes, does a few minutes of work,
 *      writes down where it got to, and stops. A phase needing an hour simply takes six wake-ups.
 *   2. Apps Script cannot write to Firestore without a service account. It can write to a Sheet, so
 *      results land in a cache spreadsheet the app reads through one fast endpoint.
 *
 * The asynchronous ad and session reports suit this far better than a browser ever did: asking and
 * collecting become two different wake-ups, and nobody is sitting there watching.
 */
var NIGHTLY_START_HOUR = 5;          // script-timezone hour a fresh daily pass begins
var NIGHTLY_BUDGET_MS = 4.5 * 60000; // work per wake-up, leaving slack inside the 6-minute ceiling
var NIGHTLY_ROWS = 12000;            // Orders rows per pass
// How far back per-ASIN PER-DAY figures are kept, for date ranges that are not whole weeks.
// Short deliberately: this shape is ~50x the size of the weekly one, the browser pulls it whole,
// and Amazon only retains ad data for ~95 days anyway. Older ranges are answered from the weeks.
var ASIN_DAY_WINDOW = 45;
// 800 days, not 400: the dashboard compares this year against last year, and a YTD figure in
// December needs the whole of the previous year to sit beside it.
var NIGHTLY_DAILY_DAYS = 800;
var NIGHTLY_SHOP_STEP = 60;          // days of Shopify orders per pass
var CACHE_CELL = 40000;              // characters per cell; the hard limit is 50k

function nProp_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function nSet_(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }
function nowStamp_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }

/** The cache spreadsheet, created on first use; its id is remembered in Script Properties. */
function cacheSheet_() {
  var id = nProp_('CACHE_SHEET_ID');
  if (id) {
    /* A sheet that WILL NOT OPEN IS AN EMERGENCY, NOT A REASON TO START OVER.
     *
     * This used to fall through and create a fresh spreadsheet, which silently discarded every cache
     * in the old one — months of ad history read "empty" one morning with nothing to explain it, and
     * the only visible trace was that the id had changed. A transient Drive error or a moment of
     * quota is enough to trigger it, and the cost is enormous and irreversible.
     *
     * So: retry once, and if it still will not open, THROW. The nightly stops with a message a person
     * can act on. Rebuilding deliberately is a decision; having it happen while nobody is looking is
     * not. Clearing CACHE_SHEET_ID is the explicit way to ask for a new one. */
    try { return SpreadsheetApp.openById(id); }
    catch (e1) {
      Utilities.sleep(2000);
      try { return SpreadsheetApp.openById(id); }
      catch (e2) {
        nSet_('CACHE_SHEET_LOST', id + ' @ ' + nowStamp_() + ' :: ' + String(e2.message || e2).slice(0, 200));
        throw new Error('The cache spreadsheet ' + id + ' will not open, twice in a row: '
          + (e2.message || e2) + '. Nothing has been rebuilt — every cache is still in that file if it '
          + 'can be recovered. Open https://docs.google.com/spreadsheets/d/' + id + '/edit to see why. '
          + 'To deliberately start a NEW cache from scratch, clear the CACHE_SHEET_ID script property.');
      }
    }
  }
  var ss = SpreadsheetApp.create('Amazon Research â€” nightly cache');
  nSet_('CACHE_SHEET_ID', ss.getId());
  return ss;
}

/**
 * Store an object as JSON split across rows: a cell holds ~50k characters and these datasets run to
 * megabytes. Column A, one chunk per row, read back by plain concatenation.
 */
function cacheWrite_(name, obj) {
  var ss = cacheSheet_();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  var s = JSON.stringify(obj), rows = [];
  for (var i = 0; i < s.length; i += CACHE_CELL) rows.push(["'" + s.substr(i, CACHE_CELL)]);
  if (!rows.length) rows.push(["'{}"]);
  sh.getRange(1, 1, rows.length, 1).setValues(rows);
  cacheTrim_(sh, rows.length);
  return rows.length;
}

/**
 * Cut a sheet back to the cells it actually uses.
 *
 * Every new sheet arrives as 1000 rows x 26 columns = 26,000 cells, and these sheets only ever use
 * COLUMN A. `clear()` empties content but leaves the grid at whatever size it grew to, so the waste
 * accumulates and never comes back. A spreadsheet is capped at 10 million cells, and there is no
 * reason to spend any of them on emptiness.
 *
 * Ravi spotted this looking at the cache sheet directly. It is housekeeping rather than the cause of
 * the file becoming unopenable — the sheer VOLUME OF TEXT is the likelier culprit there — but there
 * is no argument for carrying 25 empty columns on every cache either.
 */
function cacheTrim_(sh, usedRows) {
  try {
    var maxC = sh.getMaxColumns();
    if (maxC > 1) sh.deleteColumns(2, maxC - 1);
    var keep = Math.max(1, usedRows);
    var maxR = sh.getMaxRows();
    if (maxR > keep) sh.deleteRows(keep + 1, maxR - keep);
  } catch (e) { /* trimming is housekeeping — never let it fail a write that already succeeded */ }
}

/**
 * Editor: shrink EVERY sheet in the cache file to the cells it uses, and say how much came back.
 *
 * One-off for the sheets that already exist; new writes trim themselves from now on.
 */
function cacheTrimAll() {
  var ss = cacheSheet_();
  var before = 0, after = 0;
  ss.getSheets().forEach(function (sh) {
    var r0 = sh.getMaxRows(), c0 = sh.getMaxColumns();
    before += r0 * c0;
    var used = sh.getLastRow();
    cacheTrim_(sh, used);
    var r1 = sh.getMaxRows(), c1 = sh.getMaxColumns();
    after += r1 * c1;
    Logger.log(sh.getName() + ': ' + r0 + 'x' + c0 + ' -> ' + r1 + 'x' + c1
      + (used ? '  (' + used + ' row(s) of data)' : '  (empty)'));
  });
  Logger.log('TOTAL cells ' + before.toLocaleString() + ' -> ' + after.toLocaleString()
    + '  ·  ' + (before - after).toLocaleString() + ' freed. A spreadsheet allows 10,000,000.');
}

function cacheRead_(name) {
  var ss = cacheSheet_();
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return null;
  var vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues(), s = '';
  // The leading apostrophe forces Sheets to keep the text verbatim; it is not part of the JSON.
  for (var i = 0; i < vals.length; i++) s += String(vals[i][0] || '').replace(/^'/, '');
  try { return JSON.parse(s); } catch (e) { return null; }
}

function nState_() { try { return JSON.parse(nProp_('NIGHTLY_STATE') || '{}'); } catch (e) { return {}; } }
function nSaveState_(st) { nSet_('NIGHTLY_STATE', JSON.stringify(st)); }

/* ---------- accumulators live in the SHEET, never in Script Properties ----------
 *
 * A Script Property value is capped at 9 KB. The state started out carrying the data it was
 * collecting â€” 800 days across two brands is already past that, and the per-ASIN weekly set runs to
 * megabytes â€” so the whole nightly run would have died the moment it had gathered anything worth
 * keeping, and died quietly, because the write that fails is the one recording where it got to.
 *
 * So the state holds only the CURSOR, and each pass APPENDS its slice as one row to a scratch tab.
 * Appending is cheap and needs nothing read back; the rows are merged once, when the phase ends.
 */
/**
 * Append a slice, wiping whatever a previous pass left in this accumulator first.
 *
 * The accumulator must only ever hold slices from the pass that is running. Clearing it when a
 * fresh pass STARTS was not enough: a pass that died before its phase reached the merge left its
 * slices behind, and the next pass added its own on top. The merges add, so every figure came out
 * exactly double — for every day at once, which is what made it look like a data problem rather
 * than a bookkeeping one.
 *
 * Keying the slices did not save it either. Leftovers written before keys existed carried no key,
 * and the dedupe deliberately keeps unkeyed slices rather than risk dropping real sales — so the
 * one case that mattered was the one case it let through.
 *
 * Clearing on the FIRST append of each phase, tracked in the run's own state, makes it true by
 * construction: whatever is in there when a phase starts writing is from another pass, and goes.
 */
function accStart_(st, name) {
  st.acc = st.acc || {};
  if (st.acc[name]) return;
  accClear_(name);
  st.acc[name] = 1;
}

function accAppend_(name, obj) {
  var ss = cacheSheet_();
  var sh = ss.getSheetByName('_' + name) || ss.insertSheet('_' + name);
  var s = JSON.stringify(obj);
  // Still chunked: one pass's slice can itself exceed a cell.
  //
  // ONE setValues, not appendRow per chunk. Each appendRow is its own round-trip to Sheets, so a
  // multi-megabyte slice — which the search-term report certainly is — turned into hundreds of them
  // and ate the whole tick before it could record where it had got to. The rows are built in memory
  // and written once.
  var rows = [];
  for (var i = 0; i < s.length; i += CACHE_CELL) rows.push(["'" + s.substr(i, CACHE_CELL)]);
  rows.push(['<<END>>']);                       // marks where one appended object stops
  var at = sh.getLastRow() + 1;
  sh.getRange(at, 1, rows.length, 1).setValues(rows);
  // Scratch tabs arrive 1000x26 like any other. They only use column A, and they can be appended to
  // many times in a pass, so the empty columns are pure carried weight.
  if (sh.getMaxColumns() > 1) { try { sh.deleteColumns(2, sh.getMaxColumns() - 1); } catch (e) {} }
}

/**
 * Every appended object, in order, WITH DUPLICATE SLICES DROPPED.
 *
 * Each append carries a `k` naming the piece of work it came from â€” the workbook row it started at,
 * the ad report id, the session week. The same `k` appearing twice means the same rows were read
 * twice: a retry, a tick that died after appending but before its cursor was saved, two ticks that
 * overlapped. It has happened three separate ways now, and every time the merges ADDED the slice a
 * second time and produced sales that were exactly double for a run of days.
 *
 * Dropping repeats HERE fixes it for every merge at once, and does it structurally: it no longer
 * matters how a duplicate got written, only that it is counted once. The LAST copy wins, being the
 * more recent read of the same rows.
 *
 * A slice with no `k` is from an older append and is always kept â€” there is nothing to compare it
 * against, and silently dropping it would lose real sales.
 */
function accReadAll_(name) {
  var raw = accReadRaw_(name);
  var lastAt = {}, out = [];
  raw.forEach(function (p, i) { if (p && p.k) lastAt[p.k] = i; });
  raw.forEach(function (p, i) {
    if (!p) return;
    if (p.k && lastAt[p.k] !== i) return;          // an earlier copy of a slice read again later
    out.push(p);
  });
  return out;
}

/** Every appended object exactly as stored, duplicates and all. */
function accReadRaw_(name) {
  var ss = cacheSheet_();
  var sh = ss.getSheetByName('_' + name);
  if (!sh || sh.getLastRow() < 1) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  var out = [], buf = '';
  for (var i = 0; i < vals.length; i++) {
    var v = String(vals[i][0] || '');
    if (v === '<<END>>') { if (buf) { try { out.push(JSON.parse(buf)); } catch (e) {} } buf = ''; continue; }
    buf += v.replace(/^'/, '');
  }
  if (buf) { try { out.push(JSON.parse(buf)); } catch (e) {} }
  return out;
}

function accClear_(name) {
  var ss = cacheSheet_();
  var sh = ss.getSheetByName('_' + name);
  if (sh) ss.deleteSheet(sh);
}

/**
 * Editor: redo the ADS phases only, from a clean slate. Nothing else in the pass is touched.
 *
 * `nightlyRunNow` restarts everything — 800 days of orders, Shopify, the weekly rebuild — which is
 * hours of work to get at ad reports that take fifteen minutes. This resets just `adsAsk`/`adsGet`.
 *
 * It CLEARS the ad accumulators first, and that is the point of it. Slices already collected under an
 * older shape would otherwise survive the merge (they key on a report id that is no longer being
 * re-collected, so nothing replaces them) and the cache would be written in the old format from data
 * nobody can see. Starting the phase clean is the only way to be sure of what comes out.
 *
 * Then run nightlyTick() every few minutes until nightlyStatus() says the queue is empty.
 */
function adsRedo() {
  var st = nState_();
  if (!st.day) { Logger.log('No pass in progress — run nightlyRunNow() instead.'); return; }
  ['ads', 'adsAsin', 'adsAsinDay', 'srchTerm', 'targeting', 'adGroup', 'placement'].forEach(function (n) {
    accClear_(n);
    if (st.acc) delete st.acc[n];          // so accStart_ does not think it has already cleared them
  });
  st.phase = 'adsAsk';
  st.pending = [];
  nSaveState_(st);
  Logger.log('Ad phases reset. Every ad accumulator is cleared and the reports will be asked for again.');
  Logger.log('Now run nightlyTick() — wait 2-3 minutes between runs — until nightlyStatus() shows');
  Logger.log('"queued 0" and the srchTerm / targeting / adGroup / placement caches carry a stamp.');
  Logger.log('Amazon usually takes 10-20 minutes to build these, so the first few ticks will collect nothing.');
}

/** Install the wake-up. Run once from the editor; running it again replaces the old trigger. *//** Install the wake-up. Run once from the editor; running it again replaces the old trigger. */
function installNightly() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightlyTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nightlyTick').timeBased().everyMinutes(10).create();
  Logger.log('âœ… nightlyTick now runs every 10 minutes.');
  Logger.log('   Each run does a few minutes of work and stops; a fresh pass starts after '
    + NIGHTLY_START_HOUR + ':00 ' + Session.getScriptTimeZone() + '.');
  Logger.log('   Watch it with nightlyStatus().');
}

function removeNightly() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightlyTick') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Nightly trigger removed.');
}

function nightlyStatus() {
  var st = nState_();
  Logger.log('day       ' + (st.day || 'â€”'));
  Logger.log('phase     ' + (st.phase || 'idle'));
  Logger.log('cursor    book ' + (st.book == null ? 'â€”' : st.book) + ', row ' + (st.row || 'â€”'));
  Logger.log('queued    ' + ((st.pending || []).length) + ' ad report(s)');
  Logger.log('finished  ' + (st.finishedAt || 'not yet'));
  // WITH ITS TIME. An unstamped lastError is unreadable: a quota refusal from the 06:00 tick looks
  // exactly like one from a minute ago, and the two mean opposite things — one is history, the other
  // is the reason nothing is moving. Old errors were being chased as if they were live.
  if (st.lastError) Logger.log('last error ' + (st.lastErrorAt ? '[' + st.lastErrorAt + '] ' : '[time unknown — recorded before stamping] ') + st.lastError);
  // The weekly cache's own verdict on itself, from the last time it was published. This is the one
  // that used to go unchecked, so it gets a line of its own rather than a footnote.
  var wc = st.weeklyCheck;
  if (!wc) Logger.log('weekly check  not run yet - it happens when the weekly phase publishes');
  else if (wc.bad && wc.bad.length) {
    Logger.log('weekly check  ' + wc.bad.length + ' WEEK(S) DISAGREE with the daily cache  (' + (wc.at || '?') + ')');
    wc.bad.forEach(function (b) {
      Logger.log('   ' + b.brand + '  ' + b.wk + '  weekly ' + b.weekly + '  vs daily ' + b.daily + '  ' + b.ratio + 'x');
    });
    Logger.log('   run weeklyAudit(0) / weeklyAudit(1) to see which ASINs are behind it');
  } else Logger.log('weekly check  OK - ' + (wc.checked || 0) + ' week(s) match the daily cache  (' + (wc.at || '?') + ')');
  ['daily', 'weekly', 'dailyAsin', 'ads', 'adsAsin', 'adsAsinDay',
   'srchTerm', 'targeting', 'adGroup', 'placement', 'shopSku', 'shopSkuCPC', 'sessions'].forEach(function (n) {
    var c = cacheRead_(n);
    Logger.log('cache ' + n + ': ' + (c ? ('ok Â· updated ' + (c.at || '?')
      + (c.from ? ' Â· from ' + c.from : '')) : 'empty'));
  });
  var lost = nProp_('CACHE_SHEET_LOST');
  if (lost) {
    Logger.log('⚠️ THE CACHE SHEET WAS REPLACED — every cache was lost and is rebuilding.');
    Logger.log('   old sheet ' + lost);
    Logger.log('   clear the CACHE_SHEET_LOST script property once this is understood.');
  }
  var id = nProp_('CACHE_SHEET_ID');
  if (id) Logger.log('cache sheet https://docs.google.com/spreadsheets/d/' + id + '/edit');
}

/**
 * Force a fresh pass now, without waiting for the start hour.
 *
 * Takes the same lock a tick does, and says so rather than pretending. Clearing the state while a
 * tick is mid-flight achieved nothing: that tick finishes on the state it read at the start and
 * saves it back over the reset, so the pass carries on from where it was and the person who asked
 * for a fresh one has no way to tell it did not happen.
 */
function nightlyRunNow() {
  var lock = LockService.getScriptLock();
  // WAITS for the running tick rather than giving up. A tick lasts about five minutes and the
  // trigger fires every ten, so tryLock(0) turned a one-click reset into a guessing game about
  // which half of the ten minutes you were in. This just sits until the tick is done.
  Logger.log('Waiting for any running tick to finishâ€¦ (up to 8 minutes)');
  if (!lock.tryLock(8 * 60 * 1000)) {
    Logger.log('A tick held the lock for the whole wait, so the reset was NOT done. Try again.');
    return;
  }
  try {
    var st = nState_();
    // An explicit flag, not just a blank day. The day check depends on the very state being
    // replaced, so a reset that failed to take looked exactly like one that worked.
    nSaveState_({ day: '', reset: true, sessDone: st.sessDone || {} });
    var back = nState_();
    Logger.log(back.reset
      ? 'Cleared and verified — the next nightlyTick starts a fresh pass.'
      : 'âš  The reset did NOT stick: the state still reads ' + JSON.stringify(back).slice(0, 200));
    Logger.log('To go immediately, run nightlyTick() yourself â€” repeatedly, until nightlyStatus() says done.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * One wake-up. Advances whatever phase the run is in, for a few minutes, then stops.
 * The phases run in dependency order and every one of them is resumable â€” that is the whole point.
 */
function nightlyTick() {
  // ONE TICK AT A TIME, always.
  //
  // The 10-minute trigger and a Run from the editor are two different callers of this same function,
  // and nothing stopped them overlapping. Two ticks that start together read the same cursor, scan
  // the same rows and both append the slice â€” and the merges ADD, so those orders get counted twice.
  // The result is a sales figure that is simply too high, with nothing anywhere to say so.
  //
  // tryLock(0), not a wait: a tick that cannot get in has nothing useful to do, and the next one is
  // ten minutes away.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    Logger.log('Another tick is already running â€” skipped.');
    return;
  }
  try {
    nightlyTickLocked_();
  } finally {
    lock.releaseLock();
  }
}

function nightlyTickLocked_() {
  var t0 = new Date().getTime();
  var left = function () { return NIGHTLY_BUDGET_MS - (new Date().getTime() - t0); };
  var st = nState_();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var hour = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));

  // What this tick decided and why. Without it, "the reset did not take" is impossible to tell
  // apart from "the reset took and the pass was quick", and both have happened.
  Logger.log('tick: day=' + (st.day || '(none)') + ' today=' + today + ' hour=' + hour
    + ' phase=' + (st.phase || '(none)') + ' reset=' + (st.reset ? 'yes' : 'no'));

  // A new day starts the moment the clock passes the start hour â€” not on a rolling 24h timer, which
  // drifts a little each run and eventually kicks off in the middle of the afternoon.
  //
  // `reset` is an EXPLICIT request from nightlyRunNow and is honoured whatever the clock says. The
  // day check alone was ambiguous: it depends on the state that is being replaced, so when a reset
  // silently failed to take there was no way to tell from the outside.
  if (st.reset || (st.day !== today && hour >= NIGHTLY_START_HOUR)) {
    Logger.log('tick: starting a FRESH pass' + (st.reset ? ' (asked for by nightlyRunNow)' : ''));
    st = { day: today, phase: 'daily', book: 0, row: 2, daily: {}, weekly: {},
           pending: [], acc: {}, sessDone: (st.sessDone || {}) };
    // Start every pass with empty scratch tabs. Each phase clears its own once it has merged, but a
    // pass abandoned half way â€” the clock rolling past the start hour while reports were still
    // pending, a phase erroring out â€” leaves slices behind. The merges ADD, so those leftovers would
    // be counted a second time tonight and the week would report more spend than was ever bought.
    ['daily', 'weekly', 'dayAsin', 'ads', 'adsAsin', 'adsAsinDay',
     'srchTerm', 'targeting', 'adGroup', 'placement', 'shopSku', 'sessions'].forEach(accClear_);
    nSaveState_(st);
  }
  if (!st.day || st.phase === 'done') return;

  try {
    while (left() > 20000) {
      // SAVE AFTER EVERY STEP, not once at the end.
      //
      // A step appends its slice to the scratch tab and moves the cursor past it, but the cursor
      // only becomes real when the state is written. Saving once at the end meant an execution that
      // died â€” a 30-minute timeout on a slow Sheets read is the way it actually happens â€” left every
      // slice it had appended sitting there with the cursor still pointing at the first of them. The
      // next tick re-read those same rows and appended them a second time, and the merges ADD, so
      // the sales came out higher than they ever were. Saving per step costs one Properties write
      // and bounds the damage at a single slice.
      if (st.phase === 'daily') { if (!nPhaseOrders_(st, 'daily')) { nSaveState_(st); break; } }
      else if (st.phase === 'shop') { if (!nPhaseShop_(st, left)) { nSaveState_(st); break; } }
      else if (st.phase === 'shopSku') { if (!nPhaseShopSku_(st, left)) { nSaveState_(st); break; } }
      else if (st.phase === 'weekly') { if (!nPhaseOrders_(st, 'weekly')) { nSaveState_(st); break; } }
      else if (st.phase === 'adsAsk') { nPhaseAdsAsk_(st); }
      else if (st.phase === 'adsGet') { if (!nPhaseAdsGet_(st, left)) { nSaveState_(st); break; } }
      else if (st.phase === 'sess') { if (!nPhaseSessions_(st, left)) { nSaveState_(st); break; } }
      else break;
      nSaveState_(st);
    }
  } catch (e) {
    st.lastErrorAt = nowStamp_(); st.lastError = String(e.message || e).slice(0, 300);
  }
  nSaveState_(st);
}

/** Orders scan, one bounded slice per call, moving through books then on to the next phase. */
function nPhaseOrders_(st, kind) {
  var r = kind === 'daily'
    ? dailySalesChunk_(st.book, st.row, NIGHTLY_ROWS, NIGHTLY_DAILY_DAYS)
    : weeklySalesChunk_(st.book, st.row, NIGHTLY_ROWS, 26, true);   // true: also bucket by day
  if (!r.ok) {
    st.lastErrorAt = nowStamp_(); st.lastError = r.error;
    st.phase = (kind === 'daily') ? 'weekly' : 'adsAsk'; st.book = 0; st.row = 2;
    return true;
  }
  var brand = st.book === 0 ? 'SP' : 'CPC';
  // Appended, not held in the state â€” see the note on accAppend_.
  // Keyed by exactly which rows this is: the same book and start row can only mean the same orders,
  // however many times it gets appended.
  var sliceKey = kind + '|' + st.book + '|' + st.row;
  accStart_(st, kind);
  accAppend_(kind, { k: sliceKey, brand: brand, d: (kind === 'daily' ? (r.dates || {}) : (r.asins || {})) });
  // The weekly pass buckets the same rows by day as well, for the recent window. Written to its own
  // accumulator so the two shapes stay separable, but read from the one scan.
  if (kind === 'weekly' && r.asinDays && Object.keys(r.asinDays).length) {
    accStart_(st, 'dayAsin');
    accAppend_('dayAsin', { k: sliceKey, brand: brand, d: r.asinDays });
  }

  if (!r.done && r.next) { st.row = r.next; return true; }
  st.book++; st.row = 2;
  if (st.book < (r.books || ORDERS_DATA_IDS.length)) return true;
  st.book = 0;
  if (kind === 'daily') { st.phase = 'shop'; st.shopTo = ''; }
  else {
    var wkRows = nMergeWeekly_();
    // Checked BEFORE it is published, against the cache that is already proven against the sheet.
    // Published either way: a tab with sales somebody has been warned about beats a tab with none,
    // and there is nothing to put back if this is thrown away. The verdict travels with the cache
    // and sits in nightlyStatus, so a bad week is a thing that gets noticed rather than a thing
    // somebody eventually spots in an average six weeks wide.
    st.weeklyCheck = nWeekVsDay_(wkRows);
    st.weeklyCheck.at = nowStamp_();
    if (st.weeklyCheck.bad.length) {
      Logger.log('WEEKLY CACHE DISAGREES with the daily cache on '
        + st.weeklyCheck.bad.length + ' week(s): '
        + st.weeklyCheck.bad.map(function (b) {
            return b.brand + ' ' + b.wk + ' weekly ' + b.weekly + ' vs daily ' + b.daily + ' (' + b.ratio + 'x)';
          }).join(' Â· ')
        + '  -- run weeklyAudit(0) / weeklyAudit(1) to see which ASINs.');
    }
    cacheWrite_('weekly', { at: nowStamp_(), rows: wkRows, check: st.weeklyCheck });
    cacheWrite_('dailyAsin', { at: nowStamp_(), from: dayWindowFrom_(), d: nMergeDayAsin_() });
    accClear_('weekly'); accClear_('dayAsin');
    st.phase = 'adsAsk';
  }
  return true;
}

/** The oldest day per-ASIN daily figures are kept for, as the marketplace reckons it. */
function dayWindowFrom_() {
  return Utilities.formatDate(new Date(Date.now() - ASIN_DAY_WINDOW * 86400000), ORDERS_PT, 'yyyy-MM-dd');
}

/**
 * Fold every appended per-ASIN daily slice into { brand: { asin: { day: [units, revenue] } } }.
 *
 * ADDS, like the weekly merge it rides along with, and for the same reason: the workbook is walked
 * 12,000 rows at a time, so one day's orders arrive spread across however many slices they fell in.
 */
function nMergeDayAsin_() {
  var out = {};
  accReadAll_('dayAsin').forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      var byDay = part.d[asin], row = into[asin] || (into[asin] = {});
      Object.keys(byDay).forEach(function (day) {
        var v = byDay[day], c = row[day] || (row[day] = [0, 0]);
        c[0] += v[0] || 0;
        c[1] = Math.round((c[1] + (v[1] || 0)) * 100) / 100;
      });
    });
  });
  return out;
}

/** Fold every appended daily slice into { brand: { date: [sales, units, orders] } }. */
function nMergeDaily_() {
  var out = {};
  // Recorded in the execution log, so a cache that comes out wrong can be traced to what went into
  // it without having to catch the run in the act.
  var raw = accReadRaw_('daily'), kept = accReadAll_('daily');
  Logger.log('merge daily: ' + raw.length + ' slice(s) written, ' + kept.length + ' counted, '
    + (raw.length - kept.length) + ' dropped as repeats');
  kept.forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (day) {
      var v = part.d[day], b = into[day] || (into[day] = [0, 0, 0]);
      b[0] = Math.round((b[0] + v[0]) * 100) / 100; b[1] += v[1]; b[2] += v[2];
    });
  });
  return out;
}

/** Fold every appended ad slice into { brand: { date: [impr, clicks, spend, orders, sales] } }. */
function nMergeAds_() {
  var out = {};
  accReadAll_('ads').forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    // A later slice for the same day REPLACES an earlier one rather than adding to it: the report
    // is a full statement of that day, so adding would double whatever the overlap covered.
    Object.keys(part.d || {}).forEach(function (day) { into[day] = part.d[day]; });
  });
  return out;
}

/**
 * Fold every appended per-ASIN ad slice into { brand: { asin: { week: [impr, clicks, spend, orders,
 * sales] } } } â€” the shape the PPC & Organic grid works in.
 *
 * ADDS where the daily merge above REPLACES, and the difference matters. The slices are disjoint
 * runs of days, so a DAY only ever appears in one of them and replacing is safe. A WEEK is not:
 * the 31-day slices cut straight through the middle of one, and replacing there would throw away
 * whichever half arrived first and report a week at part of its real spend.
 */
/**
 * The three wide reports, per brand.
 *
 * REPLACES where the per-ASIN merge ADDS, and that is right here: each of these is ONE report
 * covering the whole window, so a second slice for the same brand is the same report read again —
 * a retry, not another piece. Adding would double every term in it.
 */
function nMergeWide_(name) {
  var out = {};
  accReadAll_(name).forEach(function (part) { if (part && part.brand) out[part.brand] = part.d; });
  return out;
}

function nMergeAdsAsin_() {
  var out = {};
  accReadAll_('adsAsin').forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      var byWeek = part.d[asin], row = into[asin] || (into[asin] = {});
      Object.keys(byWeek).forEach(function (wk) {
        var v = byWeek[wk], c = row[wk] || (row[wk] = [0, 0, 0, 0, 0]);
        c[0] += v[0] || 0; c[1] += v[1] || 0;
        c[2] = Math.round((c[2] + (v[2] || 0)) * 100) / 100;
        c[3] += v[3] || 0;
        c[4] = Math.round((c[4] + (v[4] || 0)) * 100) / 100;
      });
    });
  });
  return out;
}

/**
 * Fold every appended per-ASIN daily ad slice into
 * { brand: { asin: { day: [impr, clicks, spend, orders, sales] } } }.
 *
 * REPLACES per day, unlike the per-week merge beside it. The 31-day slices are disjoint runs of
 * days, so a day only ever comes from one of them â€” whereas a WEEK is cut in half by the boundary
 * between two slices and has to be added up.
 */
function nMergeAdsAsinDay_() {
  var out = {};
  accReadAll_('adsAsinDay').forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      var byDay = part.d[asin], row = into[asin] || (into[asin] = {});
      Object.keys(byDay).forEach(function (day) { row[day] = byDay[day]; });
    });
  });
  return out;
}

/** Fold every appended session slice into { brand: { asin: { week: [sessions, pageViews] } } }. */
function nMergeSessions_() {
  var out = {};
  accReadAll_('sessions').forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      (into[asin] || (into[asin] = {}))[part.week] = part.d[asin];
    });
  });
  return out;
}

/** Fold every appended weekly slice into { brand: { asin: { week: [units, sales] } } }. */
function nMergeWeekly_() {
  var out = {};
  accReadAll_('weekly').forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      var byWeek = part.d[asin], row = into[asin] || (into[asin] = {});
      Object.keys(byWeek).forEach(function (wk) {
        var v = byWeek[wk], c = row[wk] || (row[wk] = [0, 0]);
        c[0] += v[0]; c[1] = Math.round((c[1] + v[1]) * 100) / 100;
      });
    });
  });
  return out;
}

/**
 * The per-ASIN weekly totals against the account daily totals, week by week.
 *
 * These two caches are built by different phases from the same workbook, so they must agree. The
 * daily one is the side dailyAudit already proves against the sheet, which makes it the reference:
 * where they differ, the weekly side is the one that moved.
 *
 * Run at the moment the weekly cache is about to be published, which is the last point anybody is
 * looking. It costs nothing â€” both sets are already in hand, and no workbook is read again.
 *
 * Only WHOLE weeks the daily window covers are compared, and never the week in progress: the two
 * phases run minutes apart, so a live week can legitimately differ by whatever arrived between them.
 */
function nWeekVsDay_(rows) {
  var c = cacheRead_('daily');
  var daily = (c && c.d) || {};
  var todayPt = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var thisWeek = weekKeyOf_(Date.parse(todayPt + 'T00:00:00Z'));
  var out = { checked: 0, bad: [] };

  Object.keys(rows || {}).forEach(function (brand) {
    var byDay = daily[brand];
    if (!byDay) return;                                   // nothing to compare against yet
    var days = Object.keys(byDay).sort();
    if (!days.length) return;
    var lo = days[0], hi = days[days.length - 1];

    var wk = {}, byAsin = rows[brand] || {};
    Object.keys(byAsin).forEach(function (a) {
      var byWeek = byAsin[a] || {};
      Object.keys(byWeek).forEach(function (w) { wk[w] = (wk[w] || 0) + ((byWeek[w] && byWeek[w][1]) || 0); });
    });

    var dw = {};
    days.forEach(function (day) {
      var w = weekKeyOf_(Date.parse(day + 'T00:00:00Z'));
      dw[w] = (dw[w] || 0) + ((byDay[day] && byDay[day][0]) || 0);
    });

    Object.keys(wk).sort().forEach(function (w) {
      if (w >= thisWeek) return;
      // Whole week inside the daily window, judged by DATE rather than by counting seven entries:
      // a day with no orders has no entry at all, and skipping the week for that would quietly stop
      // checking the quiet weeks.
      var end = Utilities.formatDate(new Date(Date.parse(w + 'T00:00:00Z') + 6 * 86400000), 'UTC', 'yyyy-MM-dd');
      if (w < lo || end > hi) return;
      out.checked++;
      var a = Math.round(wk[w]), b = Math.round(dw[w] || 0);
      var ratio = b ? a / b : 0;
      if (Math.abs(ratio - 1) > 0.02) {
        out.bad.push({ brand: brand, wk: w, weekly: a, daily: b, ratio: Math.round(ratio * 100) / 100 });
      }
    });
  });
  return out;
}

/**
 * Shopify daily totals, walked backwards a couple of months at a time.
 *
 * Stored under the brand key 'SHOP' alongside Ridhi and CPC, in the same [sales, units, orders]
 * shape â€” so every total, comparison and chart in the dashboard treats it as just another channel
 * without a single special case.
 */
function nPhaseShop_(st, left) {
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  var finish = function () {
    cacheWrite_('daily', { at: nowStamp_(), d: nMergeDaily_() });
    accClear_('daily');
    st.phase = 'shopSku';
    return true;
  };
  if (!prop_('SHOPIFY_STORE') || !prop_('SHOPIFY_TOKEN')) {
    st.shopNote = 'Shopify skipped â€” SHOPIFY_STORE / SHOPIFY_TOKEN not set.';
    return finish();
  }
  var oldest = new Date(Date.now() - NIGHTLY_DAILY_DAYS * 86400000);
  var to = st.shopTo ? new Date(st.shopTo + 'T00:00:00Z') : new Date();
  if (to.getTime() < oldest.getTime()) return finish();        // walked the whole window
  var from = new Date(Math.max(oldest.getTime(), to.getTime() - NIGHTLY_SHOP_STEP * 86400000));
  try {
    var r = shopifyDaily_(iso(from), iso(to), Date.now() + Math.max(20000, left() - 20000));
    // The Shopify walk is keyed by the slice of dates it covers, for the same reason.
    accStart_(st, 'daily');
    accAppend_('daily', { k: 'shop|' + iso(from) + '|' + iso(to), brand: 'SHOP', d: r.dates || {} });
    // Step back past the slice just done. `more` means the page walk ran out of time, so the same
    // slice is retried next wake-up rather than half of it being silently accepted.
    if (!r.more) st.shopTo = iso(new Date(from.getTime() - 86400000));
  } catch (e) {
    st.lastErrorAt = nowStamp_(); st.lastError = 'shopify: ' + String(e.message || e).slice(0, 200);
    return finish();
  }
  return left() > 30000;
}

/**
 * Shopify per SKU: 90 days of sales, then what is on hand right now.
 *
 * Its own phase rather than a job inside nPhaseShop_, because the two want different things. That one
 * walks 800 days for account totals and deliberately does NOT ask for line items — they are most of
 * the payload. This one needs line items but only reaches back 90 days, which is a few hundred
 * orders. Folding them together would have meant carrying line items across 800 days to use 90.
 *
 * Sales first and stock LAST, in that order. Stock is an instant, not a window, so it is taken as
 * close as possible to the moment the cache is published.
 */
/* BOTH STORES (Ravi, 2026-09-29: "shopify stock CPC ke liye bhi add karo"): Ridhi's figures go to the cache
 * 'shopSku' as before, CPC's to 'shopSkuCPC', in the same shape. */
var SHOP_SKU_STORES = ['', 'CPC'];
function shopSkuCacheName_(shop) { return String(shop || '').toUpperCase() === 'CPC' ? 'shopSkuCPC' : 'shopSku'; }

/** One store's 90 days of sales per SKU and its stock now, written to its cache. {ok, more, skipped}. */
function shopSkuBuild_(shop, deadlineMs) {
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  setShopBrand_(shop);
  try {
    if (!prop_(SHOP_PREFIX + 'SHOPIFY_STORE') || !prop_(SHOP_PREFIX + 'SHOPIFY_TOKEN')) return { ok: false, skipped: true };
    var to = new Date(), from = new Date(to.getTime() - SHOP_SKU_DAYS * 86400000);
    var s = shopifySkuSales_(iso(from), iso(to), deadlineMs - 30000);
    // A part-walked window is NOT written. Half the orders would read as a real 90-day figure and
    // every reorder built on it would be short, with nothing on screen to say why.
    if (s.more) return { ok: false, more: true };
    var stock = shopifyStock_(deadlineMs - 5000);
    cacheWrite_(shopSkuCacheName_(shop), {
      at: nowStamp_(), from: iso(from), to: iso(to), days: SHOP_SKU_DAYS,
      orders: s.n, d: s.d, shop: String(shop || '').toUpperCase() === 'CPC' ? 'CPC' : 'SP',
      d30: s.d30, orders30: s.n30, from30: s.from30,
      // Absent rather than empty when the stock walk did not finish — see the note in the app: no
      // stock figure and zero stock are different answers.
      stock: stock.more ? null : stock.stock,
      stockAt: stock.more ? '' : nowStamp_(),
    });
    return { ok: true, more: false, orders: s.n, skus: Object.keys(s.d).length, stockSkus: stock.more ? 0 : Object.keys(stock.stock).length };
  } finally { setShopBrand_(''); }
}

function nPhaseShopSku_(st, left) {
  var done = function () { st.phase = 'weekly'; st.book = 0; st.row = 2; st.shopSkuI = 0; return true; };
  st.shopSkuI = st.shopSkuI || 0;
  while (st.shopSkuI < SHOP_SKU_STORES.length) {
    var r;
    try { r = shopSkuBuild_(SHOP_SKU_STORES[st.shopSkuI], Date.now() + Math.max(20000, left())); }
    catch (e) {
      st.lastErrorAt = nowStamp_(); st.lastError = 'shopSku' + (SHOP_SKU_STORES[st.shopSkuI] || '') + ': ' + String(e.message || e).slice(0, 200);
      r = { ok: false };
    }
    if (r.more) return false;                  // the same store again on the next wake-up
    st.shopSkuI++;
    if (st.shopSkuI < SHOP_SKU_STORES.length && left() < 90000) return false;
  }
  return done();
}

/** Ask for every ad report the run needs. Instant â€” only ids come back. */
function nPhaseAdsAsk_(st) {
  var end0 = new Date(Date.now() - 86400000);
  var iso = function (d) { return Utilities.formatDate(d, ORDERS_PT, 'yyyy-MM-dd'); };
  st.pending = [];
  ['SP', 'CPC'].forEach(function (brand) {
    setBrand_(brand);
    /* ADS_BACK is 93, not 95, and the start is clamped as well.
     *
     * Amazon keeps Sponsored Products data for about 95 days and refuses a report that starts even
     * ONE day earlier: "startDate (2026-05-15) must be equal to or after report type data retention
     * start date (2026-05-16)". At exactly 95 the oldest window sits on that boundary, and the dates
     * are built by subtracting milliseconds and then formatting in PT — which can land a day early
     * all by itself, the same zone shift that has caused trouble here before. So the oldest slice was
     * rejected EVERY night, quietly, and the far end of the ad history simply never arrived.
     *
     * Two days of margin costs two days of the oldest week — which was never reliably there — and
     * buys a backfill that actually completes. */
    var ADS_BACK = 93;
    var oldest = new Date(end0.getTime() - ADS_BACK * 86400000);
    for (var off = 0; off < ADS_BACK; off += 31) {
      var e = new Date(end0.getTime() - off * 86400000);
      var s = new Date(e.getTime() - Math.min(30, ADS_BACK - off - 1) * 86400000);
      if (s.getTime() < oldest.getTime()) s = oldest;      // never ask past what Amazon still holds
      try {
        var c = ppcCreateRange_(iso(s), iso(e));
        if (c.ok && c.reportId) st.pending.push({ brand: brand, kind: 'ppc', start: iso(s), end: iso(e), id: c.reportId });
      } catch (err) { st.lastErrorAt = nowStamp_(); st.lastError = 'ads ask ' + brand + ': ' + String(err.message || err).slice(0, 160); }
    }
    // Search terms, targeting and the ad-group→ASIN map: ONE 30-day window each, not the 95 days the
    // PPC report walks back over. A search term report is orders of magnitude wider than a per-ASIN
    // one, and "what are people typing" is a question about the recent window anyway.
    var we = end0, ws = new Date(end0.getTime() - 29 * 86400000);
    ['st', 'tgt', 'ag', 'plc'].forEach(function (kind) {
      try {
        var w = adsWideCreate_(kind, iso(ws), iso(we));
        if (w.ok && w.reportId) st.pending.push({ brand: brand, kind: kind, start: iso(ws), end: iso(we), id: w.reportId });
        else {
          // "?" told us nothing. An ask can come back ok:true with an EMPTY reportId, which is a
          // different failure from a rejected configuration and needs naming as one.
          st.lastErrorAt = nowStamp_();
          st.lastError = 'ads ask ' + brand + ' ' + kind + ': '
            + (w.error || (w.ok ? 'accepted but returned no reportId (status ' + (w.status || '?') + ')' : 'unknown'));
        }
      } catch (err) { st.lastErrorAt = nowStamp_(); st.lastError = 'ads ask ' + brand + ' ' + kind + ': ' + String(err.message || err).slice(0, 160); }
    });
  });
  st.phase = 'adsGet';
}

/** Collect whatever Amazon has finished; anything still building waits for the next wake-up. */
function nPhaseAdsGet_(st, left) {
  st.pending = st.pending || [];
  // One download, two shapes, two caches: whole-account per day for the Ad Console, per ASIN per
  // week for PPC & Organic. Both are written together so neither can be left a night behind.
  var finish = function () {
    cacheWrite_('ads', { at: nowStamp_(), d: nMergeAds_() });
    cacheWrite_('adsAsin', { at: nowStamp_(), d: nMergeAdsAsin_() });
    cacheWrite_('adsAsinDay', { at: nowStamp_(), from: dayWindowFrom_(), d: nMergeAdsAsinDay_() });
    cacheWrite_('srchTerm', { at: nowStamp_(), d: nMergeWide_('srchTerm') });
    cacheWrite_('targeting', { at: nowStamp_(), d: nMergeWide_('targeting') });
    cacheWrite_('adGroup', { at: nowStamp_(), d: nMergeWide_('adGroup') });
    cacheWrite_('placement', { at: nowStamp_(), d: nMergeWide_('placement') });
    // Whether each product ad is running today — read, never written (2026-10-03).
    try { adStateAll_(); } catch (err) { st.lastErrorAt = nowStamp_(); st.lastError = 'ad state: ' + String(err.message || err).slice(0, 160); }
    accClear_('ads'); accClear_('adsAsin'); accClear_('adsAsinDay');
    accClear_('srchTerm'); accClear_('targeting'); accClear_('adGroup'); accClear_('placement');
    st.phase = 'sess';
    return true;
  };
  if (!st.pending.length) return finish();
  var still = [];
  for (var i = 0; i < st.pending.length; i++) {
    var job = st.pending[i];
    var kind = job.kind || 'ppc';
    // A search term report is far bigger to download, ungzip and fold than a per-ASIN one, so it
    // needs more of the tick left before it is worth starting. Running out mid-parse costs the
    // whole tick and the job comes back untouched anyway.
    if (left() < (kind === 'ppc' ? 25000 : 60000)) { still = still.concat(st.pending.slice(i)); break; }
    setBrand_(job.brand);
    try {
      var s = ppcStatus_(job.id);
      if (/fail|cancel/i.test(s.status || '')) continue;      // dropped: it will never arrive
      if (!s.ready) { still.push(job); continue; }
      if (kind === 'ppc') {
        var d = ppcFetch_(job.id, 'both');
        accStart_(st, 'ads');
        accAppend_('ads', { k: 'ads|' + job.id, brand: job.brand, d: d.dates || {} });
        accStart_(st, 'adsAsin');
        accAppend_('adsAsin', { k: 'ads|' + job.id, brand: job.brand, d: d.asins || {} });
        if (d.asinDays && Object.keys(d.asinDays).length) {
          accStart_(st, 'adsAsinDay');
          accAppend_('adsAsinDay', { k: 'ads|' + job.id, brand: job.brand, d: d.asinDays });
        }
      } else if (kind === 'st') {
        var f = adsWideFoldSt_(adsWideRows_(job.id));
        accStart_(st, 'srchTerm');
        accAppend_('srchTerm', { k: 'st|' + job.id, brand: job.brand,
          d: { rows: f.rows, names: f.names, dropped: f.dropped, dropSpend: f.dropSpend,
               minClicks: f.minClicks, from: job.start, to: job.end } });
      } else if (kind === 'tgt') {
        accStart_(st, 'targeting');
        accAppend_('targeting', { k: 'tgt|' + job.id, brand: job.brand,
          d: (function (f) { return { rows: f.rows, names: f.names, from: job.start, to: job.end }; })(adsWideFoldTgt_(adsWideRows_(job.id))) });
      } else if (kind === 'ag') {
        accStart_(st, 'adGroup');
        accAppend_('adGroup', { k: 'ag|' + job.id, brand: job.brand, d: adsWideFoldAg_(adsWideRows_(job.id)) });
      } else if (kind === 'plc') {
        accStart_(st, 'placement');
        accAppend_('placement', { k: 'plc|' + job.id, brand: job.brand,
          d: adsWideFoldPlc_(adsWideRows_(job.id)) });
      }
    } catch (e) { still.push(job); }                          // a blip â€” try again next wake-up
  }
  st.pending = still;
  if (!st.pending.length) return finish();
  return false;
}

/**
 * Sessions: one SP-API report per brand per week. The slowest phase by far, and the one that gains
 * most from running overnight. A week already collected is never asked for again â€” only the current,
 * still-changing week is.
 */
function nPhaseSessions_(st, left) {
  st.sessDone = st.sessDone || {};
  var weeks = weeklyKeys_(26);
  var current = weeks[weeks.length - 1];
  /* The CURRENT week for every brand first, then the backfill ALTERNATING brands.
   *
   * This used to be "every outstanding week of SP, then every outstanding week of CPC". With one
   * report per wake-up (see below) that meant CPC was not asked for anything at all until SP's whole
   * 26-week backfill had finished — several nights of it — so CPC had no sessions and no page views
   * for any week, including the current one. On Parent Listing Review that read as a brand nobody
   * visits, sitting next to real units and real sales.
   *
   * Alternating costs nothing and makes starving one brand impossible. The current week goes first
   * because it is the one every tab shows, and it is re-asked every pass regardless of sessDone —
   * the week is still changing. */
  var jobs = [];
  ['SP', 'CPC'].forEach(function (brand) { jobs.push({ brand: brand, week: current }); });
  for (var i = weeks.length - 2; i >= 0; i--) {
    ['SP', 'CPC'].forEach(function (brand) {
      if (!st.sessDone[brand + '|' + weeks[i]]) jobs.push({ brand: brand, week: weeks[i] });
    });
  }
  if (!jobs.length) {
    cacheWrite_('sessions', { at: nowStamp_(), d: nMergeSessions_() });
    accClear_('sessions');
    st.phase = 'done'; st.finishedAt = nowStamp_();
    return true;
  }
  // ONE report per wake-up, not a burst.
  //
  // SP-API allows report creation at roughly one a minute after a small burst, and asking for 52 in
  // a row spends that burst in seconds and then earns a QuotaExceeded for everything after it. The
  // trigger already fires every ten minutes, so pacing to one per wake-up costs nothing that matters
  // — the whole point of running overnight is that it does not have to be quick — and it never
  // trips the limit. A backfill takes a couple of nights instead of one, and then only the current
  // week is ever asked for again.
  var perTick = 1;
  for (var j = 0; j < jobs.length && j < perTick; j++) {
    if (left() < 45000) return false;
    var job = jobs[j];
    setBrand_(job.brand);
    var end = Utilities.formatDate(new Date(new Date(job.week + 'T00:00:00Z').getTime() + 6 * 86400000), 'UTC', 'yyyy-MM-dd');
    try {
      var c = trafficCreate_(job.week, end);
      if (!c.reportId) continue;
      // Waited on here rather than across wake-ups: these are small and usually quick, and a second
      // queue for them would double the bookkeeping for very little gain.
      var got = null;
      for (var k = 0; k < 12 && left() > 25000; k++) {
        Utilities.sleep(10000);
        var s = trafficStatus_(c.reportId);
        if (s.dead) { got = {}; break; }                      // no data that week â€” a real answer
        if (s.ready) { got = (trafficFetch_(s.doc).asins || {}); break; }
      }
      if (got == null) return false;
      var slice = {};
      Object.keys(got).forEach(function (a) { slice[a] = [got[a][0], got[a][1]]; });
      accStart_(st, 'sessions');
      accAppend_('sessions', { k: 'sess|' + job.brand + '|' + job.week, brand: job.brand, week: job.week, d: slice });
      st.sessDone[job.brand + '|' + job.week] = 1;
      nSaveState_(st);
    } catch (e) {
      var m = String(e.message || e);
      st.lastErrorAt = nowStamp_(); st.lastError = 'sessions: ' + m.slice(0, 160);
      // A quota refusal is not a failure to retry harder at — it is a request to come back later.
      if (/429|quota/i.test(m)) return false;
    }
  }
  // Written out after every week collected, so a run that stops half way still leaves the sessions
  // it did gather usable rather than holding them hostage until the whole backfill finishes.
  cacheWrite_('sessions', { at: nowStamp_(), d: nMergeSessions_() });
  return false;
}

/* ===================== Weekly PPC & Organic dashboard ===================== */
/*
 * Three sources, one grid. Per ASIN, per week:
 *   total sales + units   â† the seller's own Orders workbooks (full history)
 *   ad spend + ad sales   â† Ads API          (only ~95 days back â€” Amazon's retention, not a choice)
 *   sessions + page views â† SP-API Sales & Traffic report
 * Organic sales is then total âˆ’ ad sales, TACoS is spend Ã· total, CVR is units Ã· sessions.
 *
 * Weeks run SUNDAYâ†’SATURDAY, which is how Seller Central cuts its own weekly reports. Matching that
 * matters: a week boundary one day off makes every figure disagree with Amazon's own screens, and
 * the disagreement is small enough to be argued about rather than noticed.
 */
var WEEKLY_WEEKS = 26;

/** The Sunday (PT) that starts the week containing `ms`, as yyyy-MM-dd. */
/**
 * The Sunday starting the week that contains `ms`.
 *
 * `ms` ALREADY carries the trading date as UTC midnight — that is what toMs_ hands back, and what
 * the ad reports are normalised to before they get here. So the weekday is read in UTC and no
 * timezone conversion happens at all.
 *
 * This used to re-format that instant in PT to get the weekday, which is the same trap as reading
 * the Orders date cell in the wrong zone: UTC midnight is the previous evening in PT, so every date
 * came back a day early. On six days of seven the "days back" arithmetic quietly absorbed it and the
 * right Sunday still came out. On SUNDAY it did not — a Sunday looked like the Saturday before, went
 * back six days instead of none, and every Sunday's orders were filed under the PREVIOUS week.
 *
 * A week was therefore missing its own Sunday and carrying the next one, which is worth roughly a
 * seventh of the week. Found by Ravi checking Aug 2-8 against Seller Central: $119,735 here against
 * $143,718.88 there, and the gap was one Sunday.
 */
function weekKeyOf_(ms) {
  var back = new Date(ms).getUTCDay();                         // 0=Sun â€¦ 6=Sat
  return Utilities.formatDate(new Date(ms - back * 86400000), 'UTC', 'yyyy-MM-dd');
}

/** The week keys the dashboard covers, oldest first, ending with the week in progress. */
function weeklyKeys_(weeks) {
  var n = Math.min(Math.max(Number(weeks) || WEEKLY_WEEKS, 1), 104);
  // Which week we are in is a question about the MARKETPLACE's day, so "now" is turned into the PT
  // trading date first and then handed over the same way a stored date is. Passing the raw instant
  // would roll the window into the next week on Saturday evening PT, when UTC has already ticked.
  var todayPt = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var thisWeek = weekKeyOf_(Date.parse(todayPt + 'T00:00:00Z'));
  var base = new Date(thisWeek + 'T00:00:00Z').getTime();
  var out = [];
  for (var i = n - 1; i >= 0; i--) out.push(Utilities.formatDate(new Date(base - i * 7 * 86400000), 'UTC', 'yyyy-MM-dd'));
  return out;
}

/**
 * One bounded slice of the Orders scan, bucketed by week instead of a single 30-day total.
 * Same chunking contract as sales30Chunk_ â€” follow `next` until it is 0.
 * Shape: { ASIN: { '2026-05-10': [units, revenue], â€¦ } }
 *
 * Also buckets the SAME rows by day, for the recent window only, and returns them as `asinDays`.
 * A date range that is not a whole number of Sunâ†’Saturday weeks can only be answered from per-day
 * figures, and doing it here costs nothing: the rows have already been read and the day is one more
 * bucket off the timestamp that the week key is derived from anyway. Walking the workbooks a second
 * time for it would be the expensive way to get the same numbers.
 */
function weeklySalesChunk_(bookIx, startRow, nRows, weeks, withDays) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) return { ok: false, error: 'No orders workbook #' + ix + '.' };

  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { return { ok: false, error: 'Could not open orders workbook #' + ix + ': ' + e }; }

  var sh = null;
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) return { ok: true, book: ix, lastRow: 0, read: 0, next: 0, done: true, asins: {} };

  var lastRow = sh.getLastRow();
  var start = Math.max(2, Number(startRow) || 2);
  if (lastRow < 2 || start > lastRow) {
    return { ok: true, book: ix, lastRow: lastRow, read: 0, next: 0, done: true, asins: {} };
  }
  var n = Math.min(Math.max(1, Math.min(Number(nRows) || SALES30_CHUNK, SALES30_CHUNK)), lastRow - start + 1);

  var keys = weeklyKeys_(weeks), first = keys[0];
  var want = {};
  keys.forEach(function (k) { want[k] = 1; });

  // The per-day breakdown is ONLY built when asked for, and only the nightly run asks. It is several
  // times the size of the weekly shape, and the browser's own refresh does not use it: adding it to
  // every response made the biggest workbook's slice large enough that the fetch died, which wiped
  // that brand's sales and left them wiped, because the caller clears before it scans.
  //
  // The window is short for the same reason. Per ASIN per day over six months is megabytes, and
  // nobody asks a question that old at day resolution â€” they ask it about the last few weeks.
  var wantDays = !!withDays && String(withDays) !== 'false' && String(withDays) !== '0';
  var dayFrom = wantDays ? Utilities.formatDate(new Date(Date.now() - ASIN_DAY_WINDOW * 86400000), ORDERS_PT, 'yyyy-MM-dd') : '';

  var out = {}, outDays = {};
  var data = sh.getRange(start, 1, n, 10).getValues();
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var asin = String(r[4] || '').trim().toUpperCase(); if (!asin) continue;
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (!chanOk_(r[8])) continue;                    // other marketplaces, other currencies
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    var dMs = toMs_(r[2]); if (!dMs) continue;
    var units = Number(r[5]) || 0, rev = Number(r[6]) || 0;

    // toMs_ hands back UTC midnight of the calendar date the cell holds, so formatting it back in
    // UTC returns that same date. Reading it in any other zone moves it a day â€” the oldest bug in
    // this file, and the one that looks most plausible when it is wrong.
    if (wantDays) {
      var day = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd');
      if (day >= dayFrom) {
        var ad = outDays[asin] || (outDays[asin] = {});
        var bd = ad[day] || (ad[day] = [0, 0]);
        bd[0] += units; bd[1] += rev;
      }
    }

    var wk = weekKeyOf_(dMs);
    if (wk < first || !want[wk]) continue;          // outside the window
    var a = out[asin] || (out[asin] = {});
    var b = a[wk] || (a[wk] = [0, 0]);
    b[0] += units;
    b[1] += rev;
  }

  var next = start + n;
  return {
    ok: true, book: ix, books: ORDERS_DATA_IDS.length, weeks: keys,
    lastRow: lastRow, read: n, next: next > lastRow ? 0 : next, done: next > lastRow,
    at: Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd HH:mm') + ' PT',
    asins: out, asinDays: wantDays ? outDays : undefined, dayFrom: dayFrom,
  };
}

/* ---------- Account trends: one row per DAY, whole account ---------- */
/*
 * Deliberately NOT per ASIN. This answers "how is the account doing" â€” the shape a PPC dashboard
 * takes â€” and dropping the ASIN dimension makes it small enough to hold a year of days and roll up
 * into weeks, months or quarters in the browser without asking Amazon anything again.
 *
 * Orders are counted DISTINCT by Order ID, not as rows: a two-item order is one order, and treating
 * it as two would quietly inflate every conversion figure built on top of it.
 */
function dailySalesChunk_(bookIx, startRow, nRows, days) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) return { ok: false, error: 'No orders workbook #' + ix + '.' };

  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { return { ok: false, error: 'Could not open orders workbook #' + ix + ': ' + e }; }

  var sh = null;
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) return { ok: true, book: ix, lastRow: 0, read: 0, next: 0, done: true, dates: {} };

  var lastRow = sh.getLastRow();
  var start = Math.max(2, Number(startRow) || 2);
  if (lastRow < 2 || start > lastRow) {
    return { ok: true, book: ix, lastRow: lastRow, read: 0, next: 0, done: true, dates: {} };
  }
  var n = Math.min(Math.max(1, Math.min(Number(nRows) || SALES30_CHUNK, SALES30_CHUNK)), lastRow - start + 1);

  var back = Math.min(Math.max(Number(days) || 400, 1), 800);
  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var cutoff = new Date(todayStr + 'T00:00:00Z').getTime() - back * 86400000;

  var out = {};
  var firstOrder = '', lastOrder = '', prevOrder = '';
  // Day strings are derived from the ms value, and the same date repeats for thousands of rows in a
  // row â€” so the last one is remembered instead of re-formatting a Date per row. Utilities.formatDate
  // is the single most expensive thing in this loop; calling it 20,000 times is what made the whole
  // request outlive the browser's patience.
  var lastMs = -1, lastDay = '';
  var data = sh.getRange(start, 1, n, 10).getValues();
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (!chanOk_(r[8])) continue;                    // other marketplaces, other currencies
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    var dMs = toMs_(r[2]); if (!dMs || dMs < cutoff) continue;
    if (dMs !== lastMs) { lastMs = dMs; lastDay = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd'); }
    var b = out[lastDay] || (out[lastDay] = [0, 0, 0]);   // sales, units, orders
    b[0] += Number(r[6]) || 0;
    b[1] += Number(r[5]) || 0;
    // The lines of one order sit together, so a CHANGE of order id is a new order. That replaces a
    // per-row "have I seen this id" map â€” 20,000 string keys per chunk, for an answer a single
    // comparison already gives.
    var oid = r[0] ? String(r[0]) : '';
    if (oid) {
      if (!firstOrder) firstOrder = oid;
      if (oid !== prevOrder) { b[2] += 1; prevOrder = oid; }
      lastOrder = oid;
    }
  }
  Object.keys(out).forEach(function (d) { out[d][0] = Math.round(out[d][0] * 100) / 100; });

  var next = start + n;
  return {
    ok: true, book: ix, books: ORDERS_DATA_IDS.length,
    lastRow: lastRow, read: n, next: next > lastRow ? 0 : next, done: next > lastRow,
    // The caller uses these to avoid counting one order twice when its lines straddle a chunk edge.
    // The lines of an order sit together in the sheet, so comparing the two ends is enough.
    firstOrder: firstOrder, lastOrder: lastOrder,
    at: Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd HH:mm') + ' PT',
    dates: out,
  };
}

/**
 * Just the last few days, read from the TAIL of each Orders sheet.
 *
 * The nightly cache is right for history and wrong for today: sales keep arriving all day, and a
 * figure stamped 05:47 is not "today", it is breakfast. This exists to top up the recent end
 * without re-reading a quarter of a million rows — new orders are appended, so the answer is in the
 * last few thousand rows.
 *
 * If the tail turns out to hold nothing recent (a sheet ordered newest-first), it falls back to the
 * head rather than reporting an empty day, which would read as "no sales today".
 */
function dailyRecent_(days) {
  var back = Math.min(Math.max(Number(days) || 5, 1), 40);
  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var cutoff = new Date(todayStr + 'T00:00:00Z').getTime() - back * 86400000;
  // SIZED BY THE WINDOW ASKED FOR, not fixed. 20,000 rows covered five days comfortably and a month
  // not at all â€” and a tail that stops short does not report an error, it reports a day with no
  // orders, which reads as a bad day rather than an unread one. 2,000 rows a day is well clear of
  // the busiest day either book has had, and the read is still bounded by the sheet's own length.
  var TAIL = Math.min(200000, Math.max(20000, back * 2000));
  var out = {};

  for (var ix = 0; ix < ORDERS_DATA_IDS.length; ix++) {
    var brand = ix === 0 ? 'SP' : 'CPC';
    var sh = null;
    try {
      var ss = SpreadsheetApp.openById(ORDERS_DATA_IDS[ix]);
      ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
    } catch (e) { continue; }
    if (!sh) continue;
    var lastRow = sh.getLastRow();
    if (lastRow < 2) continue;

    var scan = function (startRow, n) {
      var got = {};
      // NARROW ON THE DATE COLUMN FIRST, then read the full rows only for the band that is in range.
      //
      // The tail is sized at 2,000 rows a day, which is far more than either book actually writes —
      // deliberately, so a busy day can never run past it. The cost is that on an ordinary book the
      // tail reaches back months, and reading all ten columns of all of it was the bulk of the wait
      // on this call (the Sales Dashboard asks for the whole month on every open). One column is a
      // tenth of the cells to fetch.
      //
      // No assumption is made about the sheet's order: the band is simply the first to the last row
      // whose date falls in the window, and the loop below still filters every row it reads. Rows
      // outside the window never touched the running order id before either, so the order count is
      // unchanged.
      var dcol = sh.getRange(startRow, 3, n, 1).getValues();
      var lo = -1, hi = -1;
      for (var q = 0; q < n; q++) {
        var qMs = toMs_(dcol[q][0]);
        if (!qMs || qMs < cutoff) continue;
        if (lo < 0) lo = q;
        hi = q;
      }
      if (lo < 0) return got;                        // nothing in this stretch falls in the window
      var data = sh.getRange(startRow + lo, 1, hi - lo + 1, 10).getValues();
      var lastMs = -1, lastDay = '';
      for (var i = 0; i < data.length; i++) {
        var r = data[i];
        if (String(r[9] || '').toUpperCase() === 'MCF') continue;
        if (!chanOk_(r[8])) continue;                // other marketplaces, other currencies
        if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
        var dMs = toMs_(r[2]); if (!dMs || dMs < cutoff) continue;
        if (dMs !== lastMs) { lastMs = dMs; lastDay = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM-dd'); }
        var b = got[lastDay] || (got[lastDay] = [0, 0, 0]);
        b[0] += Number(r[6]) || 0; b[1] += Number(r[5]) || 0;
        var oid = r[0] ? String(r[0]) : '';
        if (oid && oid !== got._last) { b[2] += 1; got._last = oid; }
      }
      delete got._last;
      return got;
    };

    var n = Math.min(TAIL, lastRow - 1);
    var res = scan(lastRow - n + 1, n);
    if (!Object.keys(res).length) res = scan(2, n);      // sheet is newest-first after all
    Object.keys(res).forEach(function (d) {
      var b = (out[brand] || (out[brand] = {}));
      b[d] = res[d];
    });
  }

  // Shopify for the same window — it is a channel like any other and must not lag behind.
  if (prop_('SHOPIFY_STORE') && prop_('SHOPIFY_TOKEN')) {
    try {
      var from = Utilities.formatDate(new Date(cutoff), 'UTC', 'yyyy-MM-dd');
      var s = shopifyDaily_(from, todayStr);
      out.SHOP = s.dates || {};
    } catch (e) { out.shopError = String(e.message || e).slice(0, 160); }
  }
  return { ok: true, days: back, at: nowStamp_(), d: out };
}

/* ---------- Sessions: SP-API Sales & Traffic, one report per week ---------- */
/*
 * ONE REPORT PER WEEK, deliberately. In this report `dateGranularity` only splits the by-DATE
 * section; the by-ASIN section is aggregated over whatever range you ask for, with no date on it.
 * So the only way to get sessions per ASIN per week is to ask for exactly one week at a time.
 * That makes the first backfill 26 requests per brand â€” slow, but it happens once, and after that
 * only the current week needs re-asking.
 */
function trafficCreate_(startDate, endDate) {
  var body = {
    reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
    marketplaceIds: [marketplaceId_()],
    dataStartTime: startDate + 'T00:00:00Z',
    dataEndTime: endDate + 'T23:59:59Z',
    reportOptions: { asinGranularity: 'CHILD', dateGranularity: 'DAY' },
  };
  var r = sp_('/reports/2021-06-30/reports', 'post', body);
  return { ok: true, brand: ACTIVE_PREFIX, reportId: r.reportId || '', start: startDate, end: endDate };
}

function trafficStatus_(id) {
  if (!id) return { ok: false, error: 'No reportId given.' };
  var r = sp_('/reports/2021-06-30/reports/' + encodeURIComponent(id));
  var s = r.processingStatus || '';
  return {
    ok: true, status: s, ready: s === 'DONE', doc: r.reportDocumentId || '',
    // FATAL usually means "no data for this range", which for a week before the listing existed is
    // the correct answer rather than a failure â€” the caller decides.
    dead: s === 'FATAL' || s === 'CANCELLED',
  };
}

/** Shape: { ASIN: [sessions, pageViews, unitsOrdered, orderedProductSales] } */
function trafficFetch_(docId) {
  if (!docId) return { ok: false, error: 'No document id given.' };
  var d = sp_('/reports/2021-06-30/documents/' + encodeURIComponent(docId));
  if (!d.url) return { ok: false, error: 'Report document carries no download url.' };
  var resp = UrlFetchApp.fetch(d.url, { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Report download failed (' + resp.getResponseCode() + ').');
  var text;
  if (String(d.compressionAlgorithm || '').toUpperCase() === 'GZIP') {
    text = Utilities.ungzip(resp.getBlob().setContentType('application/x-gzip')).getDataAsString();
  } else {
    text = resp.getContentText();
  }
  var j = JSON.parse(text || '{}');
  var rows = j.salesAndTrafficByAsin || [];
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var x = rows[i];
    var asin = String(x.childAsin || x.parentAsin || '').trim().toUpperCase(); if (!asin) continue;
    var t = x.trafficByAsin || {}, s = x.salesByAsin || {};
    var b = out[asin] || (out[asin] = [0, 0, 0, 0]);
    b[0] += Number(t.sessions) || 0;
    b[1] += Number(t.pageViews) || 0;
    b[2] += Number(s.unitsOrdered) || 0;
    b[3] += Number((s.orderedProductSales || {}).amount) || 0;
  }
  Object.keys(out).forEach(function (a) { out[a][3] = Math.round(out[a][3] * 100) / 100; });
  return { ok: true, n: Object.keys(out).length, asins: out };
}

/* ===================== Lookups ===================== */

/**
 * ASIN out of any Amazon URL form (/dp/ASIN, /gp/product/ASIN, /product/ASIN, ?asin=ASIN),
 * or a bare ASIN. Returns '' when nothing looks like an ASIN.
 */
function asinFromUrl_(v) {
  var s = String(v || '').trim();
  if (!s) return '';
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase();                      // bare ASIN
  var m = s.match(/\/(?:dp|gp\/product|product|gp\/aw\/d)\/([A-Z0-9]{10})/i)   // the usual link shapes
       || s.match(/[?&](?:asin|ASIN)=([A-Z0-9]{10})/)
       || s.match(/\/([A-Z0-9]{10})(?:[/?]|$)/);                              // last-resort path segment
  return m ? m[1].toUpperCase() : '';
}

/**
 * Catalog details for an ASIN â†’ {title, brand, category, weight, dims}. Non-fatal: blanks on failure.
 * `dims` = {l, w, h, unit} â€” the PACKAGE size Amazon has on file (falls back to item size), for the
 * seller's reference only. Weight prefers item, dims prefer package (the FBA tier is sized on package).
 */
function fetchCatalog_(asin) {
  var out = { title: '', brand: '', category: '', weight: 0, dims: null };
  try {
    var r = spRetry_('/catalog/2022-04-01/items/' + asin + '?marketplaceIds=' + marketplaceId_() +
      '&includedData=summaries,attributes,dimensions', 'get');
    var s = (r.summaries && r.summaries[0]) || {};
    out.title = s.itemName || '';
    out.brand = s.brandName || s.brand || '';
    out.category = (s.browseClassification && s.browseClassification.displayName) || '';
    var d = (r.dimensions && r.dimensions[0]) || {};
    var w = (d.item && d.item.weight) || (d.package && d.package.weight) || null;
    if (w && w.value) out.weight = num_(w.value);
    // Package size preferred (matches the FBA tier / the app's "Package size" fields); else item size.
    var box = d.package || d.item || {};
    var l = box.length && num_(box.length.value), wd = box.width && num_(box.width.value),
        h = box.height && num_(box.height.value);
    if (l > 0 && wd > 0 && h > 0) {
      var u = (box.length && box.length.unit) || (box.width && box.width.unit) || '';
      out.dims = { l: l, w: wd, h: h, unit: String(u || '').toLowerCase() };
    }
  } catch (e) { Logger.log('catalog ' + asin + ': ' + e); }
  return out;
}

/** Live offers for an ASIN â†’ {buyBox, lowest, offers}. 0s when the ASIN has no live offer. */
function fetchOffers_(asin) {
  var out = { buyBox: 0, lowest: 0, offers: 0 };
  var r = spRetry_('/products/pricing/v0/items/' + asin + '/offers?MarketplaceId=' + marketplaceId_() +
    '&ItemCondition=New', 'get');
  var sum = (r.payload && r.payload.Summary) || {};
  out.offers = num_(sum.TotalOfferCount);
  var bb = (sum.BuyBoxPrices && sum.BuyBoxPrices[0]) || null;
  if (bb) out.buyBox = num_((bb.LandedPrice && bb.LandedPrice.Amount) || (bb.ListingPrice && bb.ListingPrice.Amount));
  // LowestPrices carries several fulfilment channels â€” take the cheapest landed price of any of them.
  ((sum.LowestPrices) || []).forEach(function (lp) {
    var amt = num_((lp.LandedPrice && lp.LandedPrice.Amount) || (lp.ListingPrice && lp.ListingPrice.Amount));
    if (amt > 0 && (out.lowest === 0 || amt < out.lowest)) out.lowest = amt;
  });
  return out;
}

/**
 * Amazon's fee estimate for selling THIS asin at `price`, fulfilled by FBA â†’ {referral, fba, total}.
 * Works for any ASIN, not just your own listings â€” that's what makes product research possible.
 * Referral scales with the price, so the estimate is only valid at the price it was quoted at.
 */
function fetchFees_(asin, price) {
  var out = { referral: 0, fba: 0, total: 0 };
  var body = {
    FeesEstimateRequest: {
      MarketplaceId: marketplaceId_(),
      IsAmazonFulfilled: true,
      Identifier: asin + '-' + Date.now(),
      PriceToEstimateFees: { ListingPrice: { CurrencyCode: 'USD', Amount: price } },
    },
  };
  var r = spRetry_('/products/fees/v0/items/' + asin + '/feesEstimate', 'post', body);
  var res = (r.payload && r.payload.FeesEstimateResult) || {};
  if (res.Status && String(res.Status).toUpperCase() !== 'SUCCESS') {
    throw new Error('fees ' + res.Status + (res.Error ? ' â€” ' + (res.Error.Message || '') : ''));
  }
  var est = res.FeesEstimate || {};
  out.total = num_(est.TotalFeesEstimate && est.TotalFeesEstimate.Amount);
  (est.FeeDetailList || []).forEach(function (f) {
    var t = String(f.FeeType || '').toLowerCase();
    var amt = num_(f.FeeAmount && f.FeeAmount.Amount);
    if (t.indexOf('referral') >= 0) out.referral += amt;
    else if (t.indexOf('fba') >= 0 || t.indexOf('fulfillment') >= 0) out.fba += amt;
  });
  return out;
}

/* ===================== Brand Analytics ===================== */

/**
 * Probe whether the SP-API app can use Brand Analytics: try to CREATE a Search Terms report for the
 * last complete week. Success (a reportId comes back) â‡’ access is there. A 403 / Unauthorized /
 * access-denied â‡’ the app is missing the Brand Analytics role (add it in Developer Central, then
 * re-authorize). An "InvalidInput" about dates still means ACCESS is fine â€” just the window.
 */
function baCheck_() {
  var now = new Date();
  var d = now.getUTCDay();                                   // 0 Sun â€¦ 6 Sat
  var lastSat = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((d + 1) % 7 || 7)));
  var start = new Date(lastSat.getTime() - 6 * 86400000);   // that week's Sunday
  try {
    var r = sp_('/reports/2021-06-30/reports', 'post', {
      reportType: 'GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT',
      marketplaceIds: [marketplaceId_()],
      reportOptions: { reportPeriod: 'WEEK' },
      dataStartTime: start.toISOString(), dataEndTime: lastSat.toISOString(),
    });
    return { ok: true, access: true, reportId: r.reportId,
      note: 'Brand Analytics access looks OK â€” the report was accepted (id ' + r.reportId + ').' };
  } catch (e) {
    var msg = String(e.message || e);
    var denied = /403|unauthorized|access|forbidden|not have|role/i.test(msg);
    return { ok: false, access: false, denied: denied, error: msg.slice(0, 400),
      note: denied
        ? 'The app is missing the Brand Analytics role. Add it in Seller Central â†’ Developer Central, then re-authorize + update SP_REFRESH_TOKEN.'
        : 'Access may be fine but the request was rejected (likely the date window) â€” share this error.' };
  }
}

/** Most recent COMPLETE reporting window for a Brand Analytics period. */
/* WHICH WINDOW A BRAND ANALYTICS REPORT COVERS — and why you cannot just pick two dates.
 *
 * Amazon builds these per PERIOD, not per date range: a whole Sunday-to-Saturday week, a whole
 * calendar month, a whole calendar quarter. Ask for 3 August to 19 August and it does not trim to
 * fit, it refuses. So the app offers real periods rather than a date picker that would silently
 * snap to something nobody chose.
 *
 * `back` counts completed periods backwards: 0 is the most recent COMPLETE one, 1 the one before.
 * Never the running period — a month in progress is not a month, and its figures set beside
 * finished ones read as a collapse. PPC & Organic learned that one the hard way.
 */
function baPeriodWindow_(period, back) {
  var n = Math.max(0, Number(back) || 0);
  var now = new Date();
  var p = String(period || 'WEEK').toUpperCase();

  if (p === 'MONTH') {
    var s0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n - 1, 1));
    var e0 = new Date(Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth() + 1, 0));
    return { start: s0, end: e0, label: Utilities.formatDate(s0, 'UTC', 'MMMM yyyy') };
  }

  if (p === 'QUARTER') {
    var q = Math.floor(now.getUTCMonth() / 3) - n - 1;
    var y = now.getUTCFullYear();
    while (q < 0) { q += 4; y -= 1; }
    return { start: new Date(Date.UTC(y, q * 3, 1)), end: new Date(Date.UTC(y, q * 3 + 3, 0)),
      label: 'Q' + (q + 1) + ' ' + y };
  }

  var d = now.getUTCDay();
  var lastSat = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),
    now.getUTCDate() - ((d + 1) % 7 || 7) - n * 7));
  var ws = new Date(lastSat.getTime() - 6 * 86400000);
  return { start: ws, end: lastSat,
    label: Utilities.formatDate(ws, 'UTC', 'd MMM') + ' to ' + Utilities.formatDate(lastSat, 'UTC', 'd MMM yyyy') };
}

/* The periods that can actually be asked for, with their real dates.
 *
 * Built by the SAME function that builds the request, so a dropdown label and the window Amazon is
 * actually asked for cannot drift apart. This app has been bitten by exactly that: two copies of the
 * same date arithmetic, one in the browser and one in the backend, disagreeing by a day and putting
 * a seventh of every week in the wrong bucket.
 */
function baPeriods_(period, howMany) {
  var p = String(period || 'MONTH').toUpperCase();
  var n = Math.min(Math.max(Number(howMany) || 12, 1), 24);
  var out = [];
  for (var i = 0; i < n; i++) {
    var w = baPeriodWindow_(p, i);
    out.push({ back: i, label: w.label,
      from: Utilities.formatDate(w.start, 'UTC', 'yyyy-MM-dd'),
      to: Utilities.formatDate(w.end, 'UTC', 'yyyy-MM-dd') });
  }
  return { ok: true, period: p, periods: out };
}

/** Create a Brand Analytics report. type='terms' â†’ Search Terms (whole marketplace, top-3 ASINs per
 *  term); otherwise Search Query Performance (own products, optionally one ASIN). Returns a reportId. */
function baCreate_(type, period, asin, back) {
  period = (period || 'WEEK').toUpperCase();
  var w = baPeriodWindow_(period, back);
  var isTerms = (type === 'terms');
  var options = { reportPeriod: period };
  if (!isTerms && asin) options.asin = String(asin).trim().toUpperCase();
  try {
    var r = sp_('/reports/2021-06-30/reports', 'post', {
      reportType: isTerms ? 'GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT'
                          : 'GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT',
      marketplaceIds: [marketplaceId_()], reportOptions: options,
      dataStartTime: w.start.toISOString(), dataEndTime: w.end.toISOString(),
    });
    return { ok: true, reportId: r.reportId, period: period, label: w.label,
      window: w.start.toISOString().slice(0, 10) + ' â†’ ' + w.end.toISOString().slice(0, 10) };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 400) }; }
}

/** Poll a report; when DONE, download + parse + shape the rows. Also returns one raw sample row so
 *  the exact field names can be confirmed against the shaped output. */
function baPoll_(id) {
  if (!id) return { ok: false, error: 'no report id' };
  var r;
  try { r = sp_('/reports/2021-06-30/reports/' + id, 'get'); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
  var st = r.processingStatus;
  if (st === 'FATAL' || st === 'CANCELLED') {
    /* A FAILED REPORT COMES WITH ITS OWN REASON, and it was being thrown away.
     *
     * Amazon attaches a document to a failed report saying WHY — a date range it will not accept, an
     * option this report type does not take, an entitlement that is missing. Returning only "ended as
     * FATAL" turns a one-line answer into guesswork, and the guessing is done against an API that
     * rate-limits report creation. */
    var why = '';
    try {
      if (r.reportDocumentId) {
        var ed = sp_('/reports/2021-06-30/documents/' + r.reportDocumentId, 'get');
        var eb = UrlFetchApp.fetch(ed.url, { muteHttpExceptions: true }).getBlob();
        if (ed.compressionAlgorithm === 'GZIP') {
          try { eb = Utilities.ungzip(eb.setContentType('application/x-gzip')); } catch (e2) {}
        }
        why = String(eb.getDataAsString('UTF-8') || '').slice(0, 700);
      } else {
        why = '(Amazon attached no document to the failure, which usually means the report type '
          + 'accepted the request but had NO DATA for that window.)';
      }
    } catch (e) { why = '(could not read the failure document: ' + (e.message || e) + ')'; }
    return { ok: false, status: st, reason: why, error: 'Report ended as ' + st + (why ? ' — ' + why : '') };
  }
  if (st !== 'DONE') return { ok: true, status: 'processing', raw: st };
  var doc;
  try { doc = sp_('/reports/2021-06-30/documents/' + r.reportDocumentId, 'get'); }
  catch (e) { return { ok: false, error: 'document: ' + String(e.message || e).slice(0, 200) }; }
  var blob = UrlFetchApp.fetch(doc.url, { muteHttpExceptions: true }).getBlob();
  if (doc.compressionAlgorithm === 'GZIP') {
    // UrlFetchApp sometimes auto-decompresses a gzip response (Content-Encoding), so a second ungzip
    // throws "Could not decompress gzip". Try to ungzip; if it fails, the bytes are already plain.
    try { blob = Utilities.ungzip(blob.setContentType('application/x-gzip')); } catch (e) {}
  }
  var text = blob.getDataAsString('UTF-8');
  var j; try { j = JSON.parse(text); } catch (e) { return { ok: false, error: 'could not parse report: ' + String(text).slice(0, 150) }; }
  var arr = j.dataByAsin || j.dataByDepartmentAndSearchTerm || [];
  return { ok: true, status: 'done', kind: j.dataByAsin ? 'sqp' : 'terms',
    // The shaped rows are what the Analytics tab has always read. The RAW array rides alongside for
    // callers that need fields the generic shaper flattens away — SQP's asin* figures, which are the
    // listing's own, as opposed to the total* figures, which are the whole market's.
    rows: baShape_(j), raw: arr, sample: arr[0] || null, total: arr.length };
}

/** First value in `o` whose KEY matches `re` (case-insensitive). Optionally require a string value. */
function baGet_(o, re, wantStr) {
  if (!o || typeof o !== 'object') return null;
  for (var k in o) { if (re.test(k)) { var v = o[k]; if (!wantStr || typeof v === 'string') return v; } }
  return null;
}
/** First sub-object in `o` whose key matches `re` (e.g. impressionData / clickData / purchaseData). */
function baObj_(o, re) { var v = baGet_(o, re); return (v && typeof v === 'object') ? v : {}; }

/**
 * Report JSON â†’ flat rows for the UI. Field names differ across report variants, so match keys by
 * PATTERN rather than exact spelling (the nested impression/click/purchase objects map fine; only the
 * top-level query/volume + the share fields needed loosening).
 */
function baShape_(j) {
  function n(v) { return num_(v); }
  if (j.dataByAsin) {
    return j.dataByAsin.map(function (x) {
      var imp = baObj_(x, /impression/i), clk = baObj_(x, /click/i), pur = baObj_(x, /purchase/i);
      return {
        // KEPT. This report can be asked for ONE ASIN or for the whole brand, and the shape is the
        // same either way — so dropping the ASIN was harmless while the app only ever asked about one
        // product, and makes the brand-wide report useless the moment it is asked for. It is the one
        // field that says which listing a query belongs to.
        asin: baGet_(x, /^asin$|asin/i, true) || '',
        query: baGet_(x, /search.?query$|^keyword|search.?term|^query$/i, true) ||
               baGet_(x, /query|keyword|term/i, true) || '',
        volume: n(baGet_(x, /volume/i)),
        impressions: n(baGet_(imp, /total.*impression|impression.*count|total.?count/i)),
        impShare: n(baGet_(imp, /share/i)),
        clicks: n(baGet_(clk, /total.*click|click.*count|total.?count/i)),
        purchases: n(baGet_(pur, /total.*purchase|purchase.*count|total.?count/i)),
        purShare: n(baGet_(pur, /share/i)),
      };
    }).sort(function (a, b) { return (b.volume || 0) - (a.volume || 0); });
  }
  var rows = (j.dataByDepartmentAndSearchTerm || []).map(function (x) {
    return { searchTerm: baGet_(x, /search.?term|^query$/i, true) || '', freqRank: n(baGet_(x, /frequency.?rank|freq/i)),
      asin: baGet_(x, /clicked.*asin|^asin/i, true) || '', title: baGet_(x, /clicked.*name|product.?name|title/i, true) || '',
      clickRank: n(baGet_(x, /click.?share.?rank|click.?rank/i)), clickShare: n(baGet_(x, /click.?share/i)),
      convShare: n(baGet_(x, /conversion.?share|conv.?share/i)) };
  }).sort(function (a, b) { return (a.freqRank || 1e9) - (b.freqRank || 1e9); });
  return rows.slice(0, 1000);                                             // cap the marketplace-wide list
}

/* ===================== FBA inventory age ===================== */

/** Kick off the FBA Inventory Planning report (a snapshot â€” no date range). */
function ageCreate_() {
  try {
    var r = sp_('/reports/2021-06-30/reports', 'post', {
      reportType: 'GET_FBA_INVENTORY_PLANNING_DATA',
      marketplaceIds: [marketplaceId_()],
    });
    return { ok: true, reportId: r.reportId, brand: ACTIVE_PREFIX };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 400) }; }
}

/**
 * Poll the ageing report; when DONE, parse the TSV and attach Parent ASIN per SKU from the brand's
 * Catalog tab. The age-bucket COLUMN NAMES are read from the report itself â€” Amazon has changed the
 * bucket boundaries over the years, so nothing is hard-coded.
 */
function agePoll_(id) {
  if (!id) return { ok: false, error: 'no report id' };
  var r;
  try { r = sp_('/reports/2021-06-30/reports/' + id, 'get'); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
  var st = r.processingStatus;
  if (st === 'FATAL' || st === 'CANCELLED') return { ok: false, status: st, error: 'Report ended as ' + st };
  if (st !== 'DONE') return { ok: true, status: 'processing' };

  var doc;
  try { doc = sp_('/reports/2021-06-30/documents/' + r.reportDocumentId, 'get'); }
  catch (e) { return { ok: false, error: 'document: ' + String(e.message || e).slice(0, 200) }; }
  var blob = UrlFetchApp.fetch(doc.url, { muteHttpExceptions: true }).getBlob();
  if (doc.compressionAlgorithm === 'GZIP') {
    try { blob = Utilities.ungzip(blob.setContentType('application/x-gzip')); } catch (e) {}   // may already be plain
  }
  var rows = parseTsv_(blob.getDataAsString('UTF-8'));
  if (!rows.length) return { ok: true, status: 'done', rows: [], ageCols: [], total: 0 };

  var headers = Object.keys(rows[0]);
  var ageCols = headers.filter(function (h) { return /inv[-_ ]?age|inventory[-_ ]?age/i.test(h); });
  // Estimated storage cost â€” the money side of ageing, so it belongs next to the buckets.
  var storageCol = headers.filter(function (h) {
    return /storage/i.test(h) && /cost|fee|charge/i.test(h) && !/long.?term/i.test(h);
  })[0] || headers.filter(function (h) { return /storage/i.test(h); })[0] || '';
  var parents = catalogParents_();

  /* WHICH COLUMN IS "AVAILABLE" — and it is not the one called `available`.
   *
   * MCF can only ship what Amazon can pick TODAY. Seller Central calls that Available, and the
   * column that means exactly that is `afn-fulfillable-quantity`: "units in Amazon fulfilment
   * centres that can be picked, packed and shipped". This report ALSO carries a column literally
   * named `available` which counts more than that — RQL147-K read 13 there while Seller Central
   * showed Available 7, with 0 inbound and 1 reserved (Ravi, 2026-09-01). Reading the friendlier
   * name first meant MCF offered stock Amazon would refuse to ship.
   *
   * So the fulfillable column is preferred EXPLICITLY, `available` is only a fallback for an account
   * whose report does not carry it, and the name that was used rides back in the response so the
   * screen can say which number it is looking at rather than leaving it to be guessed again. */
  var AVAIL_PREF = ['afn-fulfillable-quantity', 'sellable-quantity', 'available'];
  var availCol = '';
  for (var ai = 0; ai < AVAIL_PREF.length && !availCol; ai++) {
    for (var hi = 0; hi < headers.length; hi++) {
      if (String(headers[hi]).trim().toLowerCase() === AVAIL_PREF[ai]) { availCol = headers[hi]; break; }
    }
  }

  var out = rows.map(function (x) {
    var sku = String(pick_(x, ['sku', 'msku', 'seller-sku']) || '').trim();
    if (!sku) return null;
    /* FNSKU  the code on the label stuck to the piece. The scanner in the Replenishment app reads it,
     * and it is in THIS report and nowhere else the app already asks for. */
    var o = { sku: sku, asin: pick_(x, ['asin']) || '', parent: parents[sku] || '', fnsku: String(pick_(x, ['fnsku', 'fn-sku']) || '').trim(),
      product: String(pick_(x, ['product-name', 'item-name']) || '').slice(0, 90),
      available: availCol ? num_(x[availCol]) : num_(pick_(x, AVAIL_PREF)),
      storage: storageCol ? num_(x[storageCol]) : 0,
      age: {}, total: 0 };
    ageCols.forEach(function (h) { var v = num_(x[h]); o.age[h] = v; o.total += v; });
    return o;
  }).filter(Boolean).sort(function (a, b) { return b.total - a.total; });   // worst ageing first

  return { ok: true, status: 'done', rows: out.slice(0, 3000), ageCols: ageCols,
    storageCol: storageCol, availCol: availCol, headers: headers, total: out.length };
}

/** SKU â†’ Parent ASIN from the brand's Catalog tab on its main workbook (col A = SKU, col D = Parent). */
function catalogParents_() {
  var out = {};
  try {
    var id = (ACTIVE_PREFIX === 'CPC') ? CPC_SHEET_ID : RIDHI_SHEET_ID;
    var tab = (ACTIVE_PREFIX === 'CPC') ? 'CPC Catalog' : 'Catalog';
    var sh = SpreadsheetApp.openById(id).getSheetByName(tab);
    if (!sh || sh.getLastRow() < 2) return out;
    sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (row) {
      var sku = String(row[0] || '').trim();
      if (sku) out[sku] = row[3] || '';
    });
  } catch (e) { Logger.log('catalogParents_: ' + e); }   // no Sheets access â†’ parents just stay blank
  return out;
}

/** TSV text â†’ array of objects keyed by lowercased header. */
function parseTsv_(text) {
  var lines = String(text || '').split(/\r?\n/);
  if (lines.length < 2) return [];
  var headers = lines[0].split('\t').map(function (h) { return h.trim().toLowerCase(); });
  var out = [];
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    var c = lines[i].split('\t'), o = {};
    for (var j = 0; j < headers.length; j++) o[headers[j]] = c[j];
    out.push(o);
  }
  return out;
}

/** First non-empty value among candidate keys of an object. */
function pick_(o, names) {
  for (var i = 0; i < names.length; i++) if (o[names[i]] !== undefined && o[names[i]] !== '') return o[names[i]];
  return '';
}

/* ===================== Notifications ===================== */

/**
 * Email the approvers that something is waiting for them. Sent from the account this script runs as.
 *
 * BEST EFFORT ON PURPOSE. The approval queue in the app is the source of truth; this is only a nudge.
 * If the mail scope has not been granted, or the daily quota is spent, this returns the reason and
 * the caller still reports the submission as successful â€” because it was.
 *
 * âš ï¸ Needs the script to be re-authorised once after this scope is added to appsscript.json.
 */
function notifyApproval_(toCsv, subject, body) {
  var to = String(toCsv || '').split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }).slice(0, 20);
  if (!to.length) return { ok: false, error: 'no valid recipients' };
  var subj = String(subject || 'Approval pending').slice(0, 200);
  var text = String(body || '').slice(0, 4000);
  var sent = [], failed = [];
  to.forEach(function (addr) {
    try { MailApp.sendEmail(addr, subj, text); sent.push(addr); }
    catch (e) { failed.push(addr + ': ' + String(e.message || e).slice(0, 120)); }
  });
  if (!sent.length) return { ok: false, error: failed.join(' | ') || 'nothing sent' };
  return { ok: true, sent: sent, failed: failed, quotaLeft: (function () {
    try { return MailApp.getRemainingDailyQuota(); } catch (e) { return null; }
  })() };
}

/**
 * RUN THIS ONCE FROM THE EDITOR to grant the mail permission and prove email actually works.
 *
 * Running it does two jobs: Apps Script asks for the new MailApp scope (accept it), and a real email
 * lands in your inbox â€” so "it is authorised" is something you SEE rather than assume. Read the
 * execution log for the outcome either way.
 */
function testApprovalEmail() {
  var me = Session.getEffectiveUser().getEmail();
  if (!me) { Logger.log('Could not read your email address. Run this from the editor while signed in.'); return; }
  try {
    MailApp.sendEmail(me, 'Amazon Research â€” approval email test',
      'If you are reading this, the backend can send approval notifications.\n\n' +
      'Remaining email quota today: ' + MailApp.getRemainingDailyQuota());
    Logger.log('SENT to ' + me + '. Check your inbox. Remaining quota today: ' + MailApp.getRemainingDailyQuota());
  } catch (e) {
    Logger.log('FAILED: ' + (e.message || e) +
      '\nIf this mentions authorisation, re-run and accept the permission prompt.');
  }
}

/**
 * Editor check: what the stock report ACTUALLY says about one SKU.
 *
 * The whole MCF column rests on one number, and which column that number comes from was wrong once
 * already. This prints every header and every value for a single SKU, so the next disagreement with
 * Seller Central takes one run instead of a deploy per guess. Put a SKU in SKU and press Run.
 */
function stockColsTest() {
  var SKU = '';
  var BRAND = 'SP';
  if (!SKU) { Logger.log('Put a SKU in the SKU variable first, e.g. RQL147-K.'); return; }
  setBrand_(BRAND);
  var r = ageCreate_();
  Logger.log('report requested: %s', JSON.stringify(r).slice(0, 200));
  Logger.log('Now run stockColsPoll() with that reportId once Amazon says DONE.');
}
function stockColsPoll(reportId, sku) {
  var d = agePoll_(reportId);
  if (d.status !== 'done') { Logger.log('status: %s — run again in a minute', d.status); return; }
  Logger.log('the column being used for Available: "%s"', d.availCol || '(none found — falling back)');
  Logger.log('all headers: %s', (d.headers || []).join(' | '));
  var hit = (d.rows || []).filter(function (x) {
    return String(x.sku).toUpperCase() === String(sku || '').toUpperCase();
  })[0];
  Logger.log(hit ? sku + ' → available ' + hit.available + ' (total aged ' + hit.total + ')'
                 : sku + ' is not in the report at all');
}


/* ===================== SALES ANALYSIS =====================
 *
 * Monthly units and revenue per SKU, straight off the brand's own Orders workbook, plus the Catalog
 * tab that says what colour and article a SKU is. Everything the report shows is built from these
 * two — nothing is read from any other project.
 *
 * READ IN CHUNKS, NOT IN ONE GO. These workbooks hold 174,000 and 193,000 rows. A single pass over
 * one of them has already been measured at 92 seconds and then started failing outright, which is
 * why the daily figures are chunked as well. The browser calls this repeatedly and adds the pieces
 * up; each call is small and finishes.
 *
 * The same three exclusions as every other sales figure in this backend, so the totals here can be
 * held against the Sales Dashboard without an argument: MCF orders are not sales (they are somebody
 * else's order being shipped), cancelled rows are not sales, and other marketplaces are priced in
 * their own currency — a single Amazon.com.mx line read as dollars once moved a day by 13%.
 *
 *   ?sales=cat&brand=SP                       → { map: { SKU: {color,size,subcat,asin} } }
 *   ?sales=chunk&book=0&start=2&rows=20000    → { d: { SKU: { 'YYYY-MM': [qty, amt] } }, next, done }
 */
function saCatalog_(brand) {
  var isCpc = String(brand || '').toUpperCase() === 'CPC';
  // The Catalog tab lives in the brand's MAIN workbook, not the Orders one — the same books and the
  // same tab names skuAsinMap_ already uses, so there is one idea of where the catalogue is.
  var bookId = isCpc ? CPC_SHEET_ID : RIDHI_SHEET_ID;
  var tab = isCpc ? 'CPC Catalog' : 'Catalog';
  var ss = null, sh = null;
  try { ss = SpreadsheetApp.openById(bookId); sh = ss.getSheetByName(tab); }
  catch (e) { return { ok: false, error: 'Could not open the ' + (isCpc ? 'CPC' : 'Ridhi') + ' workbook: ' + e }; }
  if (!sh) return { ok: false, error: 'No "' + tab + '" tab in the ' + (isCpc ? 'CPC' : 'Ridhi') + ' workbook.' };
  if (sh.getLastRow() < 2) return { ok: true, map: {}, n: 0, tab: sh.getName() };

  var nc = Math.min(13, sh.getLastColumn());
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, nc).getValues();
  var map = {}, n = 0;
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var sku = String(r[0] || '').trim();
    if (!sku) continue;
    map[sku] = {
      asin: String(r[1] || '').trim(),
      color: String(r[7] || '').trim(),
      size: String(r[8] || '').trim(),
      subcat: String(r[9] || '').trim(),
    };
    n++;
  }
  return { ok: true, map: map, n: n, tab: sh.getName(), book: ss.getName() };
}

function saChunk_(bookIx, startRow, nRows) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) return { ok: false, error: 'No orders workbook #' + ix + '.' };
  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { return { ok: false, error: 'Could not open orders workbook #' + ix + ': ' + e }; }

  var sh = null;
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) return { ok: true, book: ix, lastRow: 0, read: 0, next: 0, done: true, d: {} };

  var lastRow = sh.getLastRow();
  var start = Math.max(2, Number(startRow) || 2);
  if (lastRow < 2 || start > lastRow) return { ok: true, book: ix, lastRow: lastRow, read: 0, next: 0, done: true, d: {} };
  var n = Math.min(Math.max(1, Math.min(Number(nRows) || SALES30_CHUNK, SALES30_CHUNK)), lastRow - start + 1);

  var out = {};
  // The month string is derived from the date, and the same date repeats for thousands of rows —
  // so the last one is remembered rather than re-formatted per row. formatDate is by far the most
  // expensive call in this loop; that lesson was learned on the daily figures.
  var lastMs = -1, lastMk = '';
  var data = sh.getRange(start, 1, n, 10).getValues();
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var sku = String(r[3] || '').trim();
    if (!sku) continue;
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    if (!chanOk_(r[8])) continue;
    var dMs = toMs_(r[2]); if (!dMs) continue;
    if (dMs !== lastMs) { lastMs = dMs; lastMk = Utilities.formatDate(new Date(dMs), 'UTC', 'yyyy-MM'); }
    var m = out[sku] || (out[sku] = {});
    var b = m[lastMk] || (m[lastMk] = [0, 0]);
    b[0] += Number(r[5]) || 0;      // units
    b[1] += Number(r[6]) || 0;      // revenue
  }
  var next = start + n;
  return { ok: true, book: ix, lastRow: lastRow, read: n, next: next > lastRow ? 0 : next,
    done: next > lastRow, d: out };
}

/** Editor check: does one chunk read, and what does it actually say? */
function saChunkTest() {
  for (var ix = 0; ix < ORDERS_DATA_IDS.length; ix++) {
    var t0 = new Date().getTime();
    var r = saChunk_(ix, 2, 20000);
    if (!r.ok) { Logger.log('book %s: %s', ix, r.error); continue; }
    var skus = Object.keys(r.d);
    Logger.log('book %s (%s rows total): 20,000 rows in %sms · %s SKU(s) touched · a full pass needs ~%s chunks',
      ix, r.lastRow, new Date().getTime() - t0, skus.length, Math.ceil(r.lastRow / 20000));
    if (skus.length) {
      var s = skus[0];
      Logger.log('   e.g. %s → %s', s, JSON.stringify(r.d[s]));
    }
  }
  var c = saCatalog_('SP');
  Logger.log('catalog: %s', c.ok ? c.n + ' SKU(s) from "' + c.tab + '" in "' + c.book + '"' : c.error);
  if (c.ok && c.n) {
    var k = Object.keys(c.map)[0];
    Logger.log('   e.g. %s → %s', k, JSON.stringify(c.map[k]));
  }
}

/* ===================== Listing health ===================== */

/**
 * Ask Amazon for the full listings report. Same async create/poll shape as the ageing report.
 * GET_MERCHANT_LISTINGS_ALL_DATA covers EVERY listing (active and inactive) â€” inactive ones are the
 * whole point here, so the "active only" variant of this report would defeat the purpose.
 */
function lhCreate_() {
  try {
    var r = sp_('/reports/2021-06-30/reports', 'post', {
      reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
      marketplaceIds: [marketplaceId_()],
    });
    return { ok: true, reportId: r.reportId, brand: ACTIVE_PREFIX };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 400) }; }
}

/**
 * Poll the listings report; when DONE, shape one row per SKU.
 *
 * Column names are resolved through pick_ with several candidate spellings because Amazon's flat
 * files are not consistent between report flavours (and have drifted over the years) â€” the ageing
 * report taught us the same lesson. A missing column degrades one field, it never breaks the row.
 *
 * NOTE: this returns FACTS ONLY (status, price, qty, dates). The health SCORE is computed in the
 * browser so the rules can be tuned without a backend redeploy â€” the backend is version-pinned and
 * every rule change would otherwise cost a Manage-deployments round trip.
 */
function lhPoll_(id) {
  if (!id) return { ok: false, error: 'no report id' };
  var r;
  try { r = sp_('/reports/2021-06-30/reports/' + id, 'get'); }
  catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
  var st = r.processingStatus;
  if (st === 'FATAL' || st === 'CANCELLED') return { ok: false, status: st, error: 'Report ended as ' + st };
  if (st !== 'DONE') return { ok: true, status: 'processing' };

  var doc;
  try { doc = sp_('/reports/2021-06-30/documents/' + r.reportDocumentId, 'get'); }
  catch (e) { return { ok: false, error: 'document: ' + String(e.message || e).slice(0, 200) }; }
  var blob = UrlFetchApp.fetch(doc.url, { muteHttpExceptions: true }).getBlob();
  if (doc.compressionAlgorithm === 'GZIP') {
    try { blob = Utilities.ungzip(blob.setContentType('application/x-gzip')); } catch (e) {}
  }
  var rows = parseTsv_(blob.getDataAsString('UTF-8'));
  if (!rows.length) return { ok: true, status: 'done', rows: [], total: 0 };

  var parents = catalogParents_();
  // BLANK IS NOT ZERO. This report's `price` and `quantity` are the MERCHANT-fulfilled fields, and on
  // an FBA listing they are routinely empty â€” the stock lives on the FBA side, not here. Reading an
  // empty cell as 0 made every FBA listing look "out of stock / no price", which is how the first
  // run reported 2,437 of 2,437 listings as not selling. So an absent cell returns null ("unknown")
  // and only a real 0 returns 0; the frontend must never treat null as a fault.
  function numOrNull_(v) {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    var f = parseFloat(v);
    return isNaN(f) ? null : f;
  }

  var out = rows.map(function (x) {
    var sku = String(pick_(x, ['seller-sku', 'sku', 'msku']) || '').trim();
    if (!sku) return null;
    // "status" is a free-text word (Active / Inactive / Incomplete). Kept verbatim so an unexpected
    // value is visible rather than silently bucketed.
    var status = String(pick_(x, ['status', 'listing-status', 'item-status']) || '').trim();
    return {
      sku: sku,
      asin: String(pick_(x, ['asin1', 'asin', 'product-id']) || '').trim(),
      parent: parents[sku] || '',
      title: String(pick_(x, ['item-name', 'product-name']) || '').slice(0, 200),
      price: numOrNull_(pick_(x, ['price', 'item-price'])),
      qty: numOrNull_(pick_(x, ['quantity', 'afn-fulfillable-quantity'])),
      status: status,
      channel: String(pick_(x, ['fulfillment-channel', 'fulfilment-channel']) || '').trim(),
      opened: String(pick_(x, ['open-date', 'open_date']) || '').slice(0, 10),
    };
  }).filter(Boolean);

  // A peek at the real column names + one real row. The first run showed that guessing at this
  // report's schema is exactly how the numbers went wrong, so the schema is now inspectable from the
  // UI instead of being argued about.
  var sample = {};
  var hdrs = Object.keys(rows[0]);
  hdrs.forEach(function (h) { sample[h] = String(rows[0][h] == null ? '' : rows[0][h]).slice(0, 60); });
  // How many rows actually carry a merchant price / quantity at all â€” the honest answer to
  // "is this column usable for this seller".
  var withPrice = 0, withQty = 0;
  out.forEach(function (r) { if (r.price != null) withPrice++; if (r.qty != null) withQty++; });

  return { ok: true, status: 'done', rows: out.slice(0, 3000), total: out.length,
    headers: hdrs, sample: sample, withPrice: withPrice, withQty: withQty };
}

/**
 * Content quality for a batch of ASINs â€” the "is this listing well built" half.
 *
 * Called in CHUNKS from the browser (asins= up to 20 per call, several calls per page of results)
 * because a catalog sweep over ~1,000 ASINs cannot finish inside one Apps Script request. The
 * frontend walks the list and merges each chunk in as it lands.
 *
 * Image count = distinct VARIANTS (MAIN, PT01â€¦, SWCH), not the raw images array â€” Amazon returns the
 * same photo at several resolutions, so counting the array would report ~5x the real number.
 */
/* pageSize=20 on every multi-ASIN catalog call (2026-10-03): Amazon's searchCatalogItems returns TEN items per page by
 * default, so of every 20 ASINs asked, ten came back as "missing" and kept whatever was stored before — which is how
 * Listing Health showed "no image" on listings that had images (RTME-S-001-1420). */
function lhContent_(asinsCsv) {
  var asins = String(asinsCsv || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 20);
  if (!asins.length) return { ok: false, error: 'no asins' };
  var r;
  try {
    r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
      '&identifiers=' + asins.join(',') + '&identifiersType=ASIN&pageSize=20' +
      '&includedData=summaries,attributes,images', 'get');
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }

  var out = {};
  (r.items || []).forEach(function (it) {
    var s = (it.summaries && it.summaries[0]) || {}, a = it.attributes || {};
    var variants = {};
    ((it.images && it.images[0] && it.images[0].images) || []).forEach(function (im) {
      if (im && im.variant) variants[im.variant] = 1;
    });
    var bullets = Array.isArray(a.bullet_point) ? a.bullet_point.filter(function (b) {
      return b && String(b.value == null ? b : b.value).trim();
    }).length : 0;
    var desc = attrVal_(a, 'product_description');
    var title = s.itemName || attrVal_(a, 'item_name') || '';
    out[it.asin] = {
      title: String(title).slice(0, 200),
      titleLen: String(title).length,
      images: Object.keys(variants).length,
      bullets: bullets,
      descLen: String(desc || '').length,
      brand: s.brandName || attrVal_(a, 'brand') || '',
    };
  });
  // ASINs Amazon returned nothing for are reported as such rather than defaulted to zeros â€” a
  // catalog miss and a genuinely empty listing are different problems and must not look alike.
  var missing = asins.filter(function (x) { return !out[x]; });
  return { ok: true, content: out, missing: missing };
}

/**
 * Which ASINs have LIVE A+ content, walked one page of content documents at a time.
 *
 * Deliberately document-first, not ASIN-first: asking "does this ASIN have A+?" one ASIN at a time
 * would be ~3,000 calls, whereas listing the A+ documents and reading each one's ASINs is a handful
 * of calls per page. The browser pages through with the returned token and inverts the result â€” any
 * ASIN NOT in the set has no A+ content.
 *
 * Only APPROVED documents count. A draft or rejected A+ page is not live on the listing, and
 * counting it would tell the seller a listing is fine when the shopper sees nothing.
 *
 * Needs the A+ Content role on the SP-API app. If it is missing this returns ok:false with the real
 * error rather than an empty set, because an empty set would look exactly like "no listing has A+"
 * and send the seller off to fix 3,000 listings that are already fine.
 */
/**
 * Sales rank for a batch of ASINs (up to 20 per call), for the weekly BSR snapshot.
 *
 * BSR belongs to a CHILD ASIN â€” a variation parent is not buyable and carries no rank of its own â€”
 * so the caller rolls these up per parent. The rank's CATEGORY is returned alongside it because a
 * rank is meaningless without one: 5,000 in Home & Kitchen and 5,000 in Bedding are not comparable,
 * and a listing can be re-categorised between weeks.
 */
function lhBsr_(asinsCsv) {
  var asins = String(asinsCsv || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 20);
  if (!asins.length) return { ok: false, error: 'no asins' };
  var r;
  try {
    r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
      '&identifiers=' + asins.join(',') + '&identifiersType=ASIN&pageSize=20' +
      '&includedData=salesRanks,summaries', 'get');
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }

  // Amazon reports TWO different ranks and they must not be mixed:
  //   displayGroupRanks   â†’ the broad department, e.g. #13,206 in Home & Kitchen  (MAIN)
  //   classificationRanks â†’ the specific browse node, e.g. #109 in Throw Pillow Covers  (SUB)
  // An earlier cut took whichever number was SMALLEST, which is almost always the sub-category rank
  // â€” so it compared a sub-category number one week against a main-category number the next.
  var pick = function (list) {
    var best = 0, cat = '';
    (list || []).forEach(function (x) {
      var n = num_(x.rank);
      if (n > 0 && (best === 0 || n < best)) { best = n; cat = x.title || x.classificationId || ''; }
    });
    return { rank: best, cat: String(cat).slice(0, 60) };
  };
  var out = {};
  (r.items || []).forEach(function (it) {
    var block = (it.salesRanks && it.salesRanks[0]) || {};
    var main = pick(block.displayGroupRanks), sub = pick(block.classificationRanks);
    // rank 0 means "no rank returned", which is NOT rank zero â€” the caller must not store it as one.
    if (main.rank > 0 || sub.rank > 0) {
      out[it.asin] = { rank: main.rank || 0, cat: main.cat,
        sub: sub.rank || 0, subCat: sub.cat };
    }
  });
  return { ok: true, map: out };
}

/**
 * Does each of these ASINs have LIVE A+ content? One call per ASIN, up to 10 per request.
 *
 * This asks Amazon the exact question we need â€” `contentPublishRecords` returns the A+ documents
 * actually PUBLISHED against an ASIN, so a non-empty list means the shopper sees A+ on that page.
 *
 * It replaces an earlier document-first approach (list A+ documents, read their ASINs, invert the
 * set) which was chosen because it needed far fewer calls â€” and which reported A+ as missing on all
 * 3,225 listings. Publish records are the authoritative answer; ~2 minutes for the whole catalogue
 * at 10 per call and 3 calls in flight is a price worth paying for an answer that is correct.
 *
 * Returns { map: {asin: true|false} }. An ASIN whose lookup ERRORS is left OUT of the map entirely
 * rather than recorded as false â€” "we could not tell" must never harden into "it is missing".
 */
function lhAplusAsins_(asinsCsv) {
  var asins = String(asinsCsv || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 10);
  if (!asins.length) return { ok: false, error: 'no asins' };
  var mkt = marketplaceId_(), map = {}, errs = [], roleMissing = false;
  asins.forEach(function (asin) {
    try {
      var r = spRetry_('/aplus/2020-11-01/contentPublishRecords?marketplaceId=' + mkt +
        '&asin=' + encodeURIComponent(asin), 'get');
      map[asin] = ((r.publishRecordList || []).length > 0);
    } catch (e) {
      var msg = String(e.message || e);
      if (/403|Access to requested resource is denied|Unauthorized/i.test(msg)) roleMissing = true;
      if (errs.length < 3) errs.push(asin + ': ' + msg.slice(0, 120));
    }
  });
  return { ok: true, map: map, errors: errs, roleMissing: roleMissing };
}

function lhAplus_(token) {
  var mkt = marketplaceId_();
  var r;
  try {
    r = spRetry_('/aplus/2020-11-01/contentDocuments?marketplaceId=' + mkt +
      (token ? '&pageToken=' + encodeURIComponent(token) : ''), 'get');
  } catch (e) {
    var msg = String(e.message || e);
    return { ok: false, error: msg.slice(0, 300),
      roleMissing: /403|Unauthorized|Access to requested resource is denied/i.test(msg) };
  }
  var recs = r.contentMetadataRecords || [];
  var asins = [], docs = 0, statuses = {}, errs = [];
  recs.forEach(function (rec) {
    var meta = rec.contentMetadata || {};
    var st = String(meta.status || 'UNKNOWN').toUpperCase();
    statuses[st] = (statuses[st] || 0) + 1;
    if (st !== 'APPROVED') return;                     // drafts / rejected are not live on the page
    docs++;
    try {
      var a = spRetry_('/aplus/2020-11-01/contentDocuments/' +
        encodeURIComponent(rec.contentReferenceKey) + '/asins?marketplaceId=' + mkt, 'get');
      (a.asinMetadataSet || []).forEach(function (m) { if (m && m.asin) asins.push(m.asin); });
    } catch (e) {
      // Record it. Silently dropping these is how "A+ missing on everything" could look like a fact.
      if (errs.length < 3) errs.push(String(e.message || e).slice(0, 120));
    }
  });
  return { ok: true, asins: asins, docs: docs, seen: recs.length, statuses: statuses,
    errors: errs, nextToken: r.nextPageToken || '' };
}

/* ===================== DataDive proxy ===================== */

/**
 * Forward a GET DataDive path (must start with /v1/) using the server-held DD_API_KEY. Read-only,
 * GET-only, /v1/-only â€” so the browser can drive any DataDive read without ever seeing the key.
 * Returns { ok, data } (raw DataDive JSON) or { ok:false, error }.
 */
function ddProxy_(path) {
  path = String(path || '');
  if (path.indexOf('/v1/') !== 0) return { ok: false, error: 'Only /v1/ paths are allowed (got "' + path.slice(0, 40) + '").' };
  var key = prop_('DD_API_KEY');
  if (!key) return { ok: false, error: 'DD_API_KEY is not set on the backend (Script Properties).' };
  var resp;
  try {
    resp = UrlFetchApp.fetch('https://api.datadive.tools' + path, {
      method: 'get', muteHttpExceptions: true,
      headers: { accept: 'application/json', 'x-api-key': key },
    });
  } catch (e) { return { ok: false, error: 'DataDive fetch failed: ' + (e.message || e) }; }
  var code = resp.getResponseCode(), text = resp.getContentText();
  if (code >= 300) return { ok: false, error: 'DataDive ' + code + ': ' + String(text).slice(0, 300) };
  var body; try { body = JSON.parse(text); } catch (e) { return { ok: false, error: 'DataDive returned non-JSON.' }; }
  return { ok: true, data: body };
}

/* ===================== Variation explorer ===================== */

/**
 * MAIN photo per ASIN, up to 20 at a time.
 *
 * Amazon returns the same photo at a dozen resolutions. The SMALLEST one at least 150px wide is
 * picked: a planner grid draws these at thumbnail size, and pulling a 1,600px original for each row
 * would cost more to download than the whole page.
 */
function lhImages_(asinsCsv) {
  // Malformed identifiers are dropped rather than passed on. Amazon rejects the WHOLE batch of 20
  // with a 400 if one of them is not an ASIN, so a single stray value (the health snapshot carries
  // literal "N/A" for listings with no parent) would cost every photo in the chunk.
  var asins = String(asinsCsv || '').split(',').map(function (s) { return s.trim().toUpperCase(); })
    .filter(function (s) { return /^[A-Z0-9]{10}$/.test(s); }).slice(0, 20);
  if (!asins.length) return { ok: false, error: 'no valid ASINs in the request' };
  var r;
  try {
    // `relationships` costs nothing extra on this call and answers the question that comes next: a
    // VARIATION parent is usually not buyable and carries no photo of its own, so when it comes back
    // empty the caller needs its children â€” and the seller's own catalogue is the only reliable
    // place to get them. Guessing from a stale snapshot is how 65 parents ended up with no picture
    // and nothing to fall back to.
    r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
      '&identifiers=' + asins.join(',') + '&identifiersType=ASIN&pageSize=20' +
      '&includedData=images,relationships', 'get');
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }

  var out = {}, kids = {};
  (r.items || []).forEach(function (it) {
    ((it.relationships && it.relationships[0] && it.relationships[0].relationships) || []).forEach(function (rel) {
      if (rel && rel.childAsins && rel.childAsins.length) {
        kids[it.asin] = (kids[it.asin] || []).concat(rel.childAsins.slice(0, 6));
      }
    });
  });
  (r.items || []).forEach(function (it) {
    var imgs = (it.images && it.images[0] && it.images[0].images) || [];
    var best = null;
    imgs.forEach(function (im) {
      if (!im || im.variant !== 'MAIN' || !im.link) return;
      var w = Number(im.width) || 0;
      if (w < 150) return;
      if (!best || w < best.w) best = { w: w, link: im.link };
    });
    // No MAIN at 150px+ â€” take the largest MAIN there is rather than showing nothing.
    if (!best) {
      imgs.forEach(function (im) {
        if (!im || im.variant !== 'MAIN' || !im.link) return;
        var w = Number(im.width) || 0;
        if (!best || w > best.w) best = { w: w, link: im.link };
      });
    }
    if (best) out[it.asin] = best.link;
  });
  // "No photo" and "Amazon has never heard of this ASIN under these credentials" are different
  // problems with different fixes, and reporting them as one number is why this kept looking like a
  // fallback that was not trying hard enough. Separated here so the caller can say which it is.
  var returned = {};
  (r.items || []).forEach(function (it) { returned[it.asin] = 1; });
  return {
    ok: true, images: out, kids: kids,
    noImage: asins.filter(function (x) { return returned[x] && !out[x]; }),
    notFound: asins.filter(function (x) { return !returned[x]; }),
    missing: asins.filter(function (x) { return !out[x]; }),
  };
}

/**
 * PARENT ASIN per ASIN, up to 20 at a time, straight from Amazon's catalogue (relationships only, so the answer is small).
 * Three answers kept apart, because they mean different things to whoever fills the master:
 *   parents[asin]  = the variation parent;
 *   single         = Amazon knows the ASIN and it has no parent (a stand-alone listing, or itself a parent);
 *   notFound       = Amazon returned nothing for it under these credentials.
 */
function catParents_(asinsCsv) {
  var asins = String(asinsCsv || '').split(',').map(function (s) { return s.trim().toUpperCase(); })
    .filter(function (s) { return /^[A-Z0-9]{10}$/.test(s); }).slice(0, 20);
  if (!asins.length) return { ok: false, error: 'no valid ASINs in the request' };
  var r;
  try {
    r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
      '&identifiers=' + asins.join(',') + '&identifiersType=ASIN&pageSize=20&includedData=relationships', 'get');
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
  var parents = {}, seen = {};
  (r.items || []).forEach(function (it) {
    seen[it.asin] = 1;
    (it.relationships || []).forEach(function (block) {
      (block.relationships || []).forEach(function (rel) {
        if (!parents[it.asin] && rel && rel.parentAsins && rel.parentAsins.length) parents[it.asin] = rel.parentAsins[0];
      });
    });
  });
  return {
    ok: true, parents: parents,
    single: asins.filter(function (x) { return seen[x] && !parents[x]; }),
    notFound: asins.filter(function (x) { return !seen[x]; }),
  };
}

/** Generic Catalog Items get for one ASIN with the given includedData. Returns {} on failure. */
function catGet_(asin, included) {
  try {
    return spRetry_('/catalog/2022-04-01/items/' + asin + '?marketplaceIds=' + marketplaceId_() +
      '&includedData=' + included, 'get');
  } catch (e) { Logger.log('catGet ' + asin + ': ' + e); return {}; }
}

/** The variation relationship array for this marketplace, flattened. */
function relOf_(item) {
  var rels = (item.relationships || []).filter(function (r) { return true; });
  var out = [];
  rels.forEach(function (block) { (block.relationships || []).forEach(function (r) { out.push(r); }); });
  return out;
}

/**
 * From any ASIN in a variation family, resolve â†’ { parent, theme, children:[asin,â€¦] }.
 * The pasted link is usually a CHILD, so: read its relationships; if it lists children it IS the
 * parent; if it lists a parent, fetch that parent's children; if neither, it's a standalone listing.
 */
function resolveVariation_(asin) {
  var item = catGet_(asin, 'relationships,summaries');
  var rels = relOf_(item);
  var kids = [], parent = asin, theme = '';
  rels.forEach(function (r) {
    if (r.childAsins && r.childAsins.length) { kids = r.childAsins.slice(); if (r.variationTheme) theme = r.variationTheme.theme || ''; }
    if (r.parentAsins && r.parentAsins.length) parent = r.parentAsins[0];
  });
  if (!kids.length && parent !== asin) {
    var pit = catGet_(parent, 'relationships');
    relOf_(pit).forEach(function (r) {
      if (r.childAsins && r.childAsins.length) { kids = r.childAsins.slice(); if (r.variationTheme) theme = r.variationTheme.theme || ''; }
    });
  }
  if (!kids.length) kids = [asin];                        // standalone listing â†’ just itself
  var title = (item.summaries && item.summaries[0] && item.summaries[0].itemName) || '';
  return { parent: parent, theme: theme, children: kids, title: title };
}

/** Colour / size / BSR / title for a batch of child ASINs (up to 20 per Catalog call). */
function childAttrs_(asins) {
  var out = {};
  for (var i = 0; i < asins.length; i += 20) {
    var batch = asins.slice(i, i + 20);
    var r;
    try {
      r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
        '&identifiers=' + batch.join(',') + '&identifiersType=ASIN&pageSize=20' +
        '&includedData=summaries,attributes,salesRanks', 'get');
    } catch (e) { Logger.log('childAttrs: ' + e); r = {}; }
    (r.items || []).forEach(function (it) {
      var s = (it.summaries && it.summaries[0]) || {}, a = it.attributes || {};
      out[it.asin] = {
        title: s.itemName || '',
        color: s.color || attrVal_(a, 'color') || '',
        size: s.size || attrVal_(a, 'size') || attrVal_(a, 'size_name') || '',
        bsr: bsrOf_(it),
      };
    });
    if (i + 20 < asins.length) Utilities.sleep(600);
  }
  return out;
}
function attrVal_(a, key) {
  var v = a[key];
  if (Array.isArray(v) && v.length) return v[0].value != null ? v[0].value : v[0];
  return '';
}
/** Best (lowest) sales rank across the item's display-group / classification ranks. 0 if none. */
function bsrOf_(it) {
  var best = 0;
  ((it.salesRanks && it.salesRanks[0]) ? (it.salesRanks[0].displayGroupRanks || []).concat(it.salesRanks[0].classificationRanks || []) : [])
    .forEach(function (r) { var n = num_(r.rank); if (n > 0 && (best === 0 || n < best)) best = n; });
  return best;
}

/** Any date cell/string â†’ epoch ms (date only, UTC midnight of the yyyy-MM-dd). 0 if unparseable. */
/*
 * âš ï¸ The Date column is a DATE-ONLY cell, and Apps Script hands it over as midnight in the SCRIPT's
 * timezone (Asia/Kolkata). Re-formatting that instant in ANY other zone moves the calendar date:
 * 2026-08-05 00:00 IST is 2026-08-04 11:30 PT, so reading it "in PT" silently reported every day's
 * sales against the day before. The figures looked plausible â€” just shifted â€” which is the worst
 * kind of wrong.
 *
 * The cell already holds the PT trading date (that is what the FBA-Sheet system writes into it), so
 * the job here is to READ BACK the date as written, not to convert it. That means formatting in the
 * script's own zone â€” the one the Date was built in.
 */
function toMs_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return new Date(Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') + 'T00:00:00Z').getTime();
  }
  var m = String(v == null ? '' : v).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(+m[1], (+m[2]) - 1, +m[3]) : 0;
}

/**
 * REAL last-30-day units + revenue per ASIN, summed from the seller's own Orders Data workbooks
 * (both brands). MCF + cancelled excluded, PT day boundaries â€” same rules the FBA reports use.
 * One pass per sheet, keyed by ASIN. Competitor ASINs simply won't be in the map.
 *
 * `wantSet` narrows it to one variation family (the explorer's case). Pass NOTHING and every ASIN
 * that sold is returned â€” that is what the listing-audit launch tracker needs, and it costs the same
 * single pass, so there is no reason to make the caller enumerate thousands of ASINs it already has.
 */
function sales30ByAsin_(wantSet) {
  var all = !wantSet;
  var map = {};
  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var cutoff = new Date(todayStr + 'T00:00:00Z').getTime() - 30 * 86400000;
  ORDERS_DATA_IDS.forEach(function (id) {
    var ss; try { ss = SpreadsheetApp.openById(id); } catch (e) { Logger.log('openById ' + id + ': ' + e); return; }
    ['Orders', 'CPC Orders'].forEach(function (tab) {          // each workbook holds only its brand's tab
      var sh = ss.getSheetByName(tab); if (!sh || sh.getLastRow() < 2) return;
      var data = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues();
      for (var i = 0; i < data.length; i++) {
        var r = data[i];
        var asin = String(r[4] || '').trim().toUpperCase(); if (!asin || (!all && !wantSet[asin])) continue;
        if (String(r[9] || '').toUpperCase() === 'MCF') continue;
        if (!chanOk_(r[8])) continue;                // other marketplaces, other currencies
        if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
        var dMs = toMs_(r[2]); if (!dMs || dMs < cutoff) continue;
        var b = map[asin] || { qty: 0, amt: 0 };
        b.qty += Number(r[5]) || 0; b.amt += Number(r[6]) || 0;
        map[asin] = b;
      }
    });
  });
  return map;
}

/**
 * Every ASIN that sold in the last 30 days, for the listing-audit launch review ("a month after
 * launch, is it doing $6,000?"). Rolling a CHILD's sales up to its PARENT is left to the browser â€”
 * it already holds the parentâ†”child map from the listing-health snapshot, so sending that mapping
 * here would only be a second, staler copy of it.
 *
 * Pairs are [units, revenue] rather than {q,a}: same numbers, roughly half the JSON, and this
 * response carries a few thousand ASINs.
 */
function sales30All_() {
  var map = sales30ByAsin_(null);
  var out = {}, n = 0;
  Object.keys(map).forEach(function (a) {
    out[a] = [map[a].qty, Math.round(map[a].amt * 100) / 100];
    n++;
  });
  return { ok: true, days: 30, n: n,
    at: Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd HH:mm') + ' PT',
    asins: out };
}

var SALES30_CHUNK = 20000;   // rows per request â€” big enough to finish quickly, small enough to return

/**
 * ONE bounded slice of the 30-day Orders scan: rows [start, start+n) of one workbook.
 *
 * The caller walks the workbook by following `next` until it comes back 0, adding up the ASIN
 * figures as it goes. Splitting it this way is what makes the scan survivable: the work per request
 * is capped by the caller, not by how many orders the business has ever taken, so the endpoint
 * cannot grow its way into a timeout the way the single-shot version did.
 *
 * Revenue is returned UNROUNDED â€” a slice is a partial sum, and rounding each one before they are
 * added together would drift by up to half a cent per slice.
 */
function sales30Chunk_(bookIx, startRow, nRows) {
  var ix = Number(bookIx) || 0;
  var id = ORDERS_DATA_IDS[ix];
  if (!id) return { ok: false, error: 'No orders workbook #' + ix + ' (there are ' + ORDERS_DATA_IDS.length + ').' };

  var ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { return { ok: false, error: 'Could not open orders workbook #' + ix + ': ' + e }; }

  // Each workbook holds only its own brand's tab, so the first one that exists is the right one.
  var sh = null;
  ['Orders', 'CPC Orders'].forEach(function (t) { if (!sh) sh = ss.getSheetByName(t); });
  if (!sh) return { ok: true, book: ix, lastRow: 0, read: 0, next: 0, done: true, asins: {} };

  var lastRow = sh.getLastRow();
  var start = Math.max(2, Number(startRow) || 2);
  if (lastRow < 2 || start > lastRow) {
    return { ok: true, book: ix, lastRow: lastRow, read: 0, next: 0, done: true, asins: {} };
  }
  var want = Number(nRows) || SALES30_CHUNK;
  var n = Math.min(Math.max(1, Math.min(want, SALES30_CHUNK)), lastRow - start + 1);

  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var cutoff = new Date(todayStr + 'T00:00:00Z').getTime() - 30 * 86400000;

  var out = {};
  var data = sh.getRange(start, 1, n, 10).getValues();
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var asin = String(r[4] || '').trim().toUpperCase(); if (!asin) continue;
    if (String(r[9] || '').toUpperCase() === 'MCF') continue;
    if (!chanOk_(r[8])) continue;                    // other marketplaces, other currencies
    if (String(r[7] || '').toLowerCase() === 'cancelled') continue;
    var dMs = toMs_(r[2]); if (!dMs || dMs < cutoff) continue;
    var b = out[asin] || (out[asin] = [0, 0]);
    b[0] += Number(r[5]) || 0;
    b[1] += Number(r[6]) || 0;
  }

  var next = start + n;
  return {
    ok: true, book: ix, books: ORDERS_DATA_IDS.length, tab: sh.getName(),
    lastRow: lastRow, read: n, next: next > lastRow ? 0 : next, done: next > lastRow,
    at: Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd HH:mm') + ' PT',
    asins: out,
  };
}

/** Orchestrate the explorer response for a reference link/ASIN. */
function exploreChildren_(input) {
  var asin = asinFromUrl_(input);
  if (!asin) return { ok: false, error: 'No ASIN found in "' + input + '".' };
  var v = resolveVariation_(asin);
  var kids = v.children.slice(0, 60);                        // safety cap
  var attrs = childAttrs_(kids);

  var wantSet = {}; kids.forEach(function (a) { wantSet[a] = 1; });
  var sales = sales30ByAsin_(wantSet);                       // one Orders scan for the whole family

  var rows = kids.map(function (a) {
    var at = attrs[a] || {}, s = sales[a] || null, price = 0;
    try { var off = fetchOffers_(a); price = off.buyBox || off.lowest; } catch (e) {}
    Utilities.sleep(700);                                    // Offers ~0.5-1 req/sec
    return {
      asin: a, title: at.title || '', color: at.color || '', size: at.size || '',
      price: price, bsr: at.bsr || 0,
      qty30: s ? s.qty : null, amt30: s ? s.amt : null,      // null = not in the seller's own sales
    };
  });

  return {
    ok: true, parent: v.parent, theme: v.theme, title: v.title,
    count: rows.length, truncated: v.children.length > kids.length, children: rows,
  };
}

/* ===================== Product research (keyword â†’ market) ===================== */

/**
 * Keyword-search Amazon's catalog and describe each hit for competitor research:
 * brand Â· size Â· outer material Â· inner material Â· weight Â· BSR Â· an ESTIMATED monthly sale qty
 * ASSUMED from the BSR (a rough heuristic â€” Amazon publishes no competitor sales). Materials come
 * from whatever attributes the listing actually carries, so they're often sparse (blank, not wrong).
 */
function researchProducts_(query, countRaw, foRaw, fiRaw) {
  var q = String(query || '').trim();
  if (!q) return { ok: false, error: 'Enter a product name / keywords to search.' };
  var want = Math.min(Math.max(parseInt(countRaw, 10) || 20, 1), 100);   // hard safety cap 100
  var fo = String(foRaw || '').trim(), fi = String(fiRaw || '').trim();   // outer / inner material filters
  var dbg = { want: want, pages: 0, scanned: 0, raw: 0, priced: 0, filtered: !!(fo || fi), pageErr: '', priceErr: '' };

  // A catalog page holds â‰¤20 hits; walk pages via nextToken until we have `want` MATCHING hits (or
  // Amazon runs out). When a material filter is set, only hits that actually match it are kept.
  var items = [], token = '';
  for (var page = 0; items.length < want && page < 6; page++) {
    var path = '/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
      '&keywords=' + encodeURIComponent(q) + '&pageSize=20' +
      '&includedData=summaries,attributes,salesRanks,dimensions,relationships' +
      (token ? '&pageToken=' + encodeURIComponent(token) : '');
    var r;
    try { r = spRetry_(path, 'get'); dbg.pages++; }
    catch (e) {
      dbg.pageErr = String(e.message || e).slice(0, 160);
      if (!items.length) return { ok: false, error: 'Amazon catalog search failed: ' + (e.message || e) };
      break;                                              // keep the pages we already got
    }
    (r.items || []).forEach(function (it) {
      dbg.scanned++;
      if (matchesMaterials_(it, fo, fi)) items.push(it);
    });
    token = (r.pagination && r.pagination.nextToken) || '';
    if (!token || items.length >= want) break;
    Utilities.sleep(600);
  }
  dbg.raw = items.length;
  items = items.slice(0, want);

  // "How many listings in that family" = variation child-count. Each hit's own relationships tell us
  // if it's a parent (has childAsins) or a child (has parentAsins); for children we batch-look-up the
  // parent's child-count once. varCountFor() then resolves each ASIN â†’ number of variations (â‰¥1).
  var selfKids = {}, parentOf = {};
  items.forEach(function (it) {
    var kids = 0, par = '';
    relOf_(it).forEach(function (r) {
      if (r.childAsins && r.childAsins.length) kids = r.childAsins.length;
      if (r.parentAsins && r.parentAsins.length) par = r.parentAsins[0];
    });
    if (kids) selfKids[it.asin] = kids;
    if (par) parentOf[it.asin] = par;
  });
  var needParents = {};
  Object.keys(parentOf).forEach(function (a) { var p = parentOf[a]; if (p && !selfKids[p]) needParents[p] = 1; });
  var parentKids = parentChildCounts_(Object.keys(needParents));
  function varCountFor(asin) {
    if (selfKids[asin]) return selfKids[asin];
    var p = parentOf[asin];
    if (p) { if (selfKids[p]) return selfKids[p]; if (parentKids[p] > 0) return parentKids[p]; }
    return 1;                                             // standalone listing = just itself
  }

  var rows = items.map(function (it) {
    var s = (it.summaries && it.summaries[0]) || {}, a = it.attributes || {};
    var bsr = bsrOf_(it), mat = materialsOf_(a);
    return {
      asin: it.asin || '',
      title: s.itemName || '',
      brand: s.brandName || s.brand || attrFirst_(a, ['brand']) || '',
      size: s.size || attrFirst_(a, ['size', 'size_name']) || '',
      pack: packOf_(a, s.itemName),                       // units per pack (Set of N / Pack of N)
      outer: mat.outer,
      inner: mat.inner,
      weight: round2_(catWeight_(it)),
      price: 0,                                           // filled from batch pricing below
      bsr: bsr,
      variations: varCountFor(it.asin),                   // # of ASINs in that variation family
      saleQtyEst: bsr > 0 ? salesFromBsr_(bsr) : null,    // null = no rank â‡’ can't even guess
    };
  });

  // Selling price â€” the catalog search carries none, so batch the Pricing API (â‰¤20 ASINs/call).
  // Dedupe + validate first: a malformed or duplicate ASIN makes the whole pricing batch 400.
  var seen = {}, asins = [];
  rows.forEach(function (x) {
    var a = x.asin;
    if (a && /^[A-Z0-9]{10}$/.test(a) && !seen[a]) { seen[a] = 1; asins.push(a); }
  });
  var priceMap = pricesForAsins_(asins, dbg);
  rows.forEach(function (x) { x.price = round2_(priceMap[x.asin] || 0); });
  dbg.priced = rows.filter(function (x) { return x.price > 0; }).length;

  return { ok: true, query: q, count: rows.length, rows: rows, dbg: dbg };
}

function round2_(n) { return Math.round(num_(n) * 100) / 100; }

/**
 * Lowest current selling price for a batch of ASINs â†’ {asin: price}. 0 when no live offer.
 * Uses the batch Item-Offers endpoint (same buy-box data as fetchOffers_, â‰¤20 ASINs per POST). That
 * endpoint is HARSHLY rate-limited (~0.1 req/sec), so batches are paced ~2s apart and lean on
 * spRetry_'s 429 back-off; anything still unpriced falls back to the per-ASIN offers (a faster bucket).
 */
function pricesForAsins_(asins, dbg) {
  var out = {}, mp = marketplaceId_();
  for (var i = 0; i < asins.length; i += 20) {
    var batch = asins.slice(i, i + 20);
    var reqs = batch.map(function (a) {
      return { uri: '/products/pricing/v0/items/' + a + '/offers', method: 'GET',
               MarketplaceId: mp, ItemCondition: 'New' };
    });
    var r;
    try { r = spRetry_('/batches/products/pricing/v0/itemOffers', 'post', { requests: reqs }); }
    catch (e) { if (dbg && !dbg.priceErr) dbg.priceErr = priceErrMsg_(e); Logger.log('prices batch: ' + e); r = {}; }
    (r.responses || []).forEach(function (resp) {
      var pl = (resp.body && resp.body.payload) || {};
      var uri = (resp.request && resp.request.uri) || '';
      var m = uri.match(/items\/([A-Z0-9]{10})\//);
      var asin = pl.ASIN || (m ? m[1] : '');
      if (asin) out[asin] = priceFromSummary_(pl.Summary || {});
    });
    if (i + 20 < asins.length) Utilities.sleep(2000);
  }
  // Per-ASIN fallback for any that stayed unpriced â€” a separate (0.5/sec) bucket, so pace ~2s.
  var missing = asins.filter(function (a) { return !(out[a] > 0); });
  for (var j = 0; j < missing.length && j < 60; j++) {
    try {
      var o = spRetry_('/products/pricing/v0/items/' + missing[j] + '/offers?MarketplaceId=' + mp +
        '&ItemCondition=New', 'get');
      out[missing[j]] = priceFromSummary_((o.payload && o.payload.Summary) || {});
    } catch (e) { if (dbg && !dbg.priceErr) dbg.priceErr = priceErrMsg_(e); }
    Utilities.sleep(1800);
  }
  return out;
}

/** Short, human note for a pricing error â€” collapse Amazon's raw error dump to one clean line. */
function priceErrMsg_(e) {
  var m = String((e && e.message) || e || '');
  if (/429|quota/i.test(m)) return 'Amazon rate-limited the pricing calls â€” a few prices were skipped (try a smaller count for full pricing).';
  if (/\b400\b|invalidinput/i.test(m)) return 'Amazon rejected a pricing request for some items â€” those prices were skipped.';
  return 'Some prices could not be fetched â€” those rows show no price.';
}

/** Buy-box (else lowest) price out of a Pricing Summary block. 0 if none. */
function priceFromSummary_(sum) {
  var bb = (sum.BuyBoxPrices && sum.BuyBoxPrices[0]) || null;
  var price = bb ? num_((bb.LandedPrice && bb.LandedPrice.Amount) || (bb.ListingPrice && bb.ListingPrice.Amount)) : 0;
  if (!price) {
    var lp = (sum.LowestPrices && sum.LowestPrices[0]) || null;
    if (lp) price = num_((lp.LandedPrice && lp.LandedPrice.Amount) || (lp.ListingPrice && lp.ListingPrice.Amount));
  }
  return price;
}

/** First non-empty attribute value across candidate keys (attributes vary wildly by product type). */
function attrFirst_(a, keys) {
  for (var i = 0; i < keys.length; i++) { var v = attrVal_(a, keys[i]); if (v) return String(v); }
  return '';
}
// OUTER = the COVER/shell only. Deliberately NO generic `material`/`fabric_type` here â€” on an insert
// those usually describe the FILL, which was leaking into "Outer Material" (e.g. showing "50%
// Polyester, 50% Feathers" for a Cotton-cover pillow). Better blank than wrong.
var PR_OUTER_KEYS = ['outer_material', 'cover_material', 'outer_material_type', 'shell_material', 'outer_shell_material'];
var PR_INNER_KEYS = ['inner_material', 'fill_material', 'filling_material', 'fill_material_type', 'pillow_filling', 'stuffing'];

// Fill/stuffing words â€” a generic "material" string containing one of these describes the FILL, so it
// must never be shown as the cover/outer.
var PR_FILL_RE = /down|feather|fiber ?fill|fiberfill|polyester fiber|microfiber|hollow ?fiber|memory foam|\bfoam\b|alternative|stuffing/i;

/**
 * Resolve {outer, inner} for a listing. Cover-specific attrs first; then parse a combined `fabric_type`
 * ("Cover : 100% Cotton, Filling: â€¦"); then a GENERIC material as a last resort for the cover â€” but
 * only when it isn't just the fill repeated (the MIULEE leak) and doesn't itself read as a fill word.
 */
function materialsOf_(a) {
  var outer = attrFirst_(a, PR_OUTER_KEYS), inner = attrFirst_(a, PR_INNER_KEYS);
  var ft = attrFirst_(a, ['fabric_type', 'material_composition']);
  if (!outer) outer = fabricSeg_(ft, 'outer');
  if (!inner) inner = fabricSeg_(ft, 'inner');
  if (!outer) {
    var gen = attrFirst_(a, ['material', 'fabric_type', 'material_type', 'material_composition']);
    if (gen) {
      if (inner && sameMat_(gen, inner)) { /* the fill repeated â†’ not the cover, leave blank */ }
      else if (PR_FILL_RE.test(gen)) { if (!inner) inner = gen; }   // a fill word â†’ belongs to inner
      else outer = gen;                                             // a real cover/shell fabric
    }
  }
  return { outer: outer, inner: inner };
}
/** Two material strings equal ignoring case/punctuation/spacing. */
function sameMat_(x, y) {
  var n = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };
  return n(x) === n(y);
}

/** Pull the cover ("outer") or fill ("inner") half out of a "Cover: X, Filling: Y" fabric string. */
function fabricSeg_(s, which) {
  var t = String(s || ''); if (!t) return '';
  var m = t.match(/^([\s\S]*?)(?:filling|fill)\s*:?\s*([\s\S]*)$/i);
  if (!m) return '';                                     // no cover/fill split â†’ don't guess
  if (which === 'inner') return m[2].replace(/[,;|]\s*$/, '').trim();
  return m[1].replace(/cover\s*:?/i, '').replace(/[,;|]\s*$/, '').trim();  // outer = the part before "filling"
}

/**
 * Every word of `term` present in `haystack` â€” as an exact substring OR within a small edit distance
 * of some haystack word (so a typo like "polyster" still matches "polyester", since Amazon's keyword
 * search is fuzzy but our filter would otherwise be exact). Empty term â‡’ no constraint.
 */
function matchTerm_(term, haystack) {
  var t = String(term || '').toLowerCase().trim();
  if (!t) return true;
  var hs = String(haystack || '').toLowerCase();
  var words = hs.split(/[^a-z0-9]+/).filter(Boolean);
  return t.split(/\s+/).every(function (w) {
    if (!w) return true;
    if (hs.indexOf(w) >= 0) return true;                          // exact substring
    var tol = w.length >= 8 ? 2 : (w.length >= 5 ? 1 : 0);       // typo tolerance scales with length
    if (!tol) return false;
    return words.some(function (hw) { return editDist_(w, hw) <= tol; });
  });
}

/** Levenshtein edit distance (bounded use â€” short material words only). */
function editDist_(a, b) {
  var m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;                             // early out â€” can't be within tol
  var prev = [], cur = [], i, j;
  for (j = 0; j <= n; j++) prev[j] = j;
  for (i = 1; i <= m; i++) {
    cur[0] = i;
    for (j = 1; j <= n; j++) {
      var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

/**
 * Does a catalog hit match the outer/inner material filters? Materials are sparse, so each term is
 * matched against the COMBINED haystack (outer + inner + title) rather than field-by-field â€” the
 * user's "outer/inner" split doesn't always line up with where Amazon put the word. Both terms must
 * still appear (fuzzily), so an item unrelated to either material is dropped.
 */
function matchesMaterials_(it, fo, fi) {
  if (!fo && !fi) return true;
  var s = (it.summaries && it.summaries[0]) || {}, a = it.attributes || {};
  var mat = materialsOf_(a);
  var hay = mat.outer + ' ' + mat.inner + ' ' + (s.itemName || '');
  return matchTerm_(fo, hay) && matchTerm_(fi, hay);
}

/** Units per pack: from pack attributes, else parsed from the title ("Set of 2", "Pack of 10"). 1 default. */
function packOf_(a, title) {
  var keys = ['number_of_items', 'item_package_quantity', 'unit_count'];
  for (var i = 0; i < keys.length; i++) { var n = parseInt(attrVal_(a, keys[i]), 10); if (n > 0) return n; }
  var t = String(title || '');
  var m = t.match(/set of (\d+)/i) || t.match(/pack of (\d+)/i) ||
          t.match(/(\d+)\s*[- ]?(?:count|pack|pcs|pieces|pc)\b/i);
  var k = m ? parseInt(m[1], 10) : 0;
  return k > 0 ? k : 1;
}

/** Batch-fetch relationships for parent ASINs â†’ {parentAsin: childCount}. */
function parentChildCounts_(asins) {
  var out = {};
  for (var i = 0; i < asins.length; i += 20) {
    var batch = asins.slice(i, i + 20), r;
    try {
      r = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
        '&identifiers=' + batch.join(',') + '&identifiersType=ASIN&pageSize=20&includedData=relationships', 'get');
    } catch (e) { Logger.log('parentKids: ' + e); r = {}; }
    (r.items || []).forEach(function (it) {
      var kids = 0;
      relOf_(it).forEach(function (rr) { if (rr.childAsins && rr.childAsins.length) kids = rr.childAsins.length; });
      out[it.asin] = kids;
    });
    if (i + 20 < asins.length) Utilities.sleep(600);
  }
  return out;
}

/** Package weight (lb) preferred, else item weight, from a catalog item's dimensions block. 0 if none. */
function catWeight_(it) {
  var d = (it.dimensions && it.dimensions[0]) || {};
  var w = (d.package && d.package.weight) || (d.item && d.item.weight) || null;
  return w && w.value ? num_(w.value) : 0;
}

/**
 * ROUGH monthly sale-qty ASSUMED from a BSR (US Home-&-Kitchen-ish curve). Amazon publishes no
 * competitor sales, so this is a heuristic tier ladder, NOT a measurement â€” the UI labels it "est.".
 * One honest place to tune: adjust the [maxRank, unitsPerMonth] tiers if real experience disagrees.
 */
function salesFromBsr_(rank) {
  var tiers = [
    [50, 2000], [200, 1000], [500, 600], [1000, 350], [2000, 200], [5000, 100],
    [10000, 50], [20000, 25], [50000, 12], [100000, 5],
  ];
  for (var i = 0; i < tiers.length; i++) if (rank <= tiers[i][0]) return tiers[i][1];
  return 2;   // deep in the long tail
}

/* ===================== Setup helper (run once from the editor) ===================== */

/**
 * Run this ONCE from the Apps Script editor (â–¶ Run) after setting the credentials. It generates a
 * random API_KEY if one isn't set and logs everything the web app needs. View â†’ Logs to read it.
 */
function setupAndTest() {
  var props = PropertiesService.getScriptProperties();
  if (!prop_('API_KEY')) {
    var k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('API_KEY', k);
    Logger.log('Generated API_KEY: ' + k);
  } else {
    Logger.log('API_KEY (already set): ' + prop_('API_KEY'));
  }
  var miss = ['SP_CLIENT_ID', 'SP_CLIENT_SECRET', 'SP_REFRESH_TOKEN'].filter(function (x) { return !prop_(x); });
  if (miss.length) { Logger.log('âŒ MISSING credentials: ' + miss.join(', ')); return; }
  try { getToken_(); Logger.log('âœ… LWA token OK â€” credentials work.'); }
  catch (e) { Logger.log('âŒ LWA token failed: ' + e); return; }
  // Test against a REAL, in-stock ASIN â€” an ASIN that doesn't exist returns a confusing 400/404 that
  // looks like a permissions problem but isn't. Defaults to one of the seller's own live listings;
  // set a TEST_ASIN property to use a different one.
  var testAsin = prop_('TEST_ASIN') || 'B0G4944HW4';
  var t = JSON.parse(doGet({ parameter: { key: prop_('API_KEY'), asin: testAsin } }).getContent());
  if (t.ok) {
    Logger.log('âœ… Lookup OK (' + testAsin + ') â€” "' + String(t.title).slice(0, 50) + '"');
    Logger.log('   price $' + t.price + '  Â·  referral $' + t.referral + '  Â·  FBA $' + t.fba +
      '  Â·  ' + t.offers + ' offers');
  } else {
    Logger.log('âš ï¸ Lookup failed (' + testAsin + '): ' + t.error);
    Logger.log('   "invalid ASIN" / "not found" = that ASIN is not live â€” NOT a permissions problem.');
    Logger.log('   "403 / Unauthorized"         = the app is missing the PRICING role.');
    Logger.log('   Retry with any in-stock ASIN: set a TEST_ASIN script property.');
  }
  Logger.log('\nNow: Deploy â†’ New deployment â†’ Web app â†’ Execute as ME, Access ANYONE â†’ copy the /exec URL.');
}
