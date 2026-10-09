/* Pricing-API / SearchTerms.gs — search terms and targeting.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

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

