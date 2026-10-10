/* ================================ PRICING-API — FILE MAP ================================
 * Until 2026-10-09 this backend was this one file of 7,584 lines. It is now split by topic, with
 * no line of code changed. All .gs files share ONE global scope, so a function in any file can
 * call a function in any other; nothing runs when a file loads except plain `var X = value`.
 * To find what serves a request, start at doGet / doPost below and follow the function name.
 *
 *   Code.gs              settings, brand switch (setBrand_), and the ROUTES: doGet / doPost
 *   MailPo.gs            greige purchase orders sent as PDF mail
 *   SpApi.gs             SP-API plumbing: properties, marketplace, host, token, the raw call + retry
 *   AdsApi.gs            Amazon Ads API: token, profiles, PPC reports, editor checks
 *   SkuPictures.gs       pictures for a SKU (?imgsku=)
 *   ListingOptimiser.gs  Listing Optimiser: audit, keywords, SQP, title / bullet rules, suggestions
 *   MarketBasket.gs      Bought Together (Market Basket Analysis)
 *   ListingImages.gs     Image Manager: image stack read / patch, catalogue walk, Drive uploads
 *   ListingFix.gs        Listing Errors: a listing's issues, allowed values, attribute fixes
 *   ShopifySkuSales.gs   Shopify per-SKU sales and stock
 *   SearchTerms.gs       search terms and targeting
 *   Shopify.gs           Shopify: store tokens, REST calls, orders, daily totals
 *   Mcf.gs               MCF: shipping a Shopify order out of FBA, "in progress" mark
 *   OrderAudits.gs       audits of the Orders workbooks + editor checks
 *   Nightly.gs           the nightly pipeline
 *   WeeklyPpc.gs         Weekly PPC & Organic dashboard
 *   Lookups.gs           the ?asin= lookup (By Amazon Link): catalogue, offers, fees
 *   BrandAnalytics.gs    Brand Analytics reports
 *   InventoryAge.gs      FBA inventory age
 *   Notifications.gs     approval mails + two stock-column checks
 *   SalesAnalysis.gs     Sales Analysis from the Orders workbooks
 *   ListingHealth.gs     Listing Health
 *   Research.gs          DataDive, catalogue pictures / parents, Variation explorer, Product research
 *   Setup.gs             setup helper, run once from the editor
 *
 * Deploy is unchanged: `clasp push -f`, then `clasp create-deployment -i <the same id>`.
 * ================================================================================== */

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
    // ?india=stock (the Ready Goods workbook) was removed on 2026-10-09: Ready Goods will never be part of
    // these apps again (Ravi). India stock is the Replenish app's own Finished Goods.
    // Pictures for imported orders, resolved from the SKU. Asked for once, at import.
    if (p.imgsku) return json_(skuImages_(p.imgsku));
    // What a listing currently IS — title, bullets, description, image slots — for the optimiser.
    // Image stack of one listing (ListingImages.gs): catalogue + our listing, and the change log.
    if (p.limg === 'get') return json_(limgGet_(p));
    // Listing Errors (ListingFix.gs): a listing's issues and attributes, and what Amazon allows for them.
    if (p.lfix === 'get') return json_(lfixGet_(p));
    if (p.lfix === 'schema') return json_(lfixSchema_(p));
    if (p.lfix === 'history') return json_(lfixHistory_(p.sku));
    if (p.lfix === 'content') return json_(lfixContent_(p));
    if (p.limg === 'history') return json_(limgHistory_(p.sku));
    if (p.limg === 'page') return json_(limgPage_(p));
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
    if (p.limg === 'patch') return json_(limgPatch_(p));
    if (p.lfix === 'patch') return json_(lfixPatch_(p));
    if (p.limg === 'upload') return json_(limgUpload_(p));
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

