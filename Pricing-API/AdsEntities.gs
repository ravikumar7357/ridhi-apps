/* Pricing-API / AdsEntities.gs — Amazon's own record of the Sponsored Products set-up, READ ONLY (14 Nov 2026).
 *
 * WHY. Search Term Analysis (Sellora, tab 'st') suggests changes and downloads them as an Amazon bulk file. A new
 * negative or a new keyword needs only the campaign and ad-group IDs the reports already carry — but a bid change or a
 * pause changes an EXISTING keyword or target, and the bulk file must name it by its own ID. The reports do not carry
 * those IDs, nor the current bids, nor the negatives already in place. Amazon's /sp/…/list endpoints do. This file
 * reads them twice a day into one cache, `adEntities`, which the browser reads through ?cache=adEntities (no redeploy).
 *
 * It changes nothing at Amazon: every call here is a POST to a /list endpoint, which only reads.
 *
 * THE CACHE — adEntities = { v, at, err: { brand: message }, d: { SP: {…}, CPC: {…} } }, each brand:
 *   at   when it was read (script time zone)
 *   kw   [[keywordId, adGroupId, campaignId, keywordText, matchType, bid, state]]        keywords, enabled and paused
 *   tg   [[targetId, adGroupId, campaignId, expression, bid, state]]                    targets, written as the reports
 *        write them: "close-match", "loose-match", "substitutes", "complements", 'asin="B0…"', 'category="…"'
 *   neg  [[level 'ag' | 'cp', id, campaignId, adGroupId, text, matchType]]             every enabled negative: keyword
 *        negatives with NEGATIVE_EXACT / NEGATIVE_PHRASE, ASIN negatives with text 'asin="B0…"' and matchType 'ASIN'
 *   cp   { campaignId: [name, state, dailyBudget, biddingStrategy, topOfSearch%, restOfSearch%, productPage%, targetingType] }
 *   ag   { adGroupId: [campaignId, name, defaultBid, state] }
 *   n    counts, for entStatus
 * A brand that fails KEEPS its last good copy (marked stale: true) and its error is in err — never written as empty,
 * because an empty list would read as "no keywords, no negatives" and every check would pass that should not.
 *
 * SELLORA ALSO USES IT TO MARK REVIEW ITEMS DONE: a change downloaded in a bulk file is "seen at Amazon" once this
 * record shows it (the negative there, the bid at its new value).
 *
 * RUN FROM THE EDITOR (Ravi):
 *   entSetup()    once: installs the two daily timers (07:00 and 19:00, script time zone) and reads both brands now
 *   entTest()     reads both brands now and prints the counts and a few rows of each — check them against the Ads console
 *   entStatus()   what the cache holds, when it was read, any errors
 *   entRunNow()   read again now
 *   entStop()     removes the timers. To undo everything: entStop, delete this file, delete the adEntities tab.
 *
 * Own file, own timers, own lease (ENT_LEASE) — like AmazonMatch.gs it touches no other file and takes no script lock,
 * so it never holds up the nightly run. Needs nothing new: the Ads login and scope Sellora already uses.
 */

var ENT_HOURS = [7, 19];          // script time zone (India): after the nightly run, and again in the evening
var ENT_BRANDS = ['SP', 'CPC'];
var ENT_LIVE = ['ENABLED', 'PAUSED'];   // archived keywords and targets cannot be changed, so they are not kept
// Each list: [path, media type (Accept and Content-Type), the key the items come back under].
var ENT_LIST = {
  kw: ['/sp/keywords/list', 'application/vnd.spKeyword.v3+json', 'keywords'],
  tg: ['/sp/targets/list', 'application/vnd.spTargetingClause.v3+json', 'targetingClauses'],
  nk: ['/sp/negativeKeywords/list', 'application/vnd.spNegativeKeyword.v3+json', 'negativeKeywords'],
  cnk: ['/sp/campaignNegativeKeywords/list', 'application/vnd.spCampaignNegativeKeyword.v3+json', 'campaignNegativeKeywords'],
  nt: ['/sp/negativeTargets/list', 'application/vnd.spNegativeTargetingClause.v3+json', 'negativeTargetingClauses'],
  cnt: ['/sp/campaignNegativeTargets/list', 'application/vnd.spCampaignNegativeTargetingClause.v3+json', 'campaignNegativeTargetingClauses'],
  cp: ['/sp/campaigns/list', 'application/vnd.spCampaign.v3+json', 'campaigns'],
  ag: ['/sp/adGroups/list', 'application/vnd.spAdGroup.v3+json', 'adGroups'],
};
// Auto targeting, as Amazon's list names it → as the reports (and Sellora) write it.
var ENT_AUTO = {
  QUERY_HIGH_REL_MATCHES: 'close-match', QUERY_BROAD_REL_MATCHES: 'loose-match',
  ASIN_SUBSTITUTE_RELATED: 'substitutes', ASIN_ACCESSORY_RELATED: 'complements',
};
// Manual targeting predicates → the word the reports use before ="…".
var ENT_PRED = {
  ASIN_SAME_AS: 'asin', ASIN_EXPANDED_FROM: 'asin-expanded', ASIN_CATEGORY_SAME_AS: 'category', ASIN_BRAND_SAME_AS: 'brand',
  ASIN_PRICE_LESS_THAN: 'price<', ASIN_PRICE_GREATER_THAN: 'price>', ASIN_PRICE_BETWEEN: 'price',
  ASIN_REVIEW_RATING_LESS_THAN: 'rating<', ASIN_REVIEW_RATING_GREATER_THAN: 'rating>', ASIN_REVIEW_RATING_BETWEEN: 'rating',
  ASIN_IS_PRIME_SHIPPING_ELIGIBLE: 'prime-shipping-eligible', ASIN_AGE_RANGE_SAME_AS: 'age-range', ASIN_GENRE_SAME_AS: 'genre',
};

/* ============================== editor functions ============================== */

function entSetup() {
  // 1. The cache sheet must be writable by whoever runs this — the timers run as that person.
  try {
    var ss = cacheSheet_();
    var probe = ss.getSheetByName('entProbe') || ss.insertSheet('entProbe');
    probe.getRange(1, 1).setValue('ok ' + nowStamp_());
    ss.deleteSheet(probe);
  } catch (e) {
    Logger.log('❌ cannot edit the cache spreadsheet: ' + (e.message || e) + ' — ask Ravi to share it as Editor, then run entSetup again.');
    return;
  }
  // 2. The timers.
  entStop();
  ENT_HOURS.forEach(function (h) { ScriptApp.newTrigger('entTick').timeBased().atHour(h).everyDays(1).create(); });
  Logger.log('✓ timers installed: entTick daily at ' + ENT_HOURS.join(':00 and ') + ':00 (' + Session.getScriptTimeZone() + ').');
  // 3. The first read now.
  entRunNow();
}

function entStop() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'entTick') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('entStop: ' + n + ' timer(s) removed.');
}

function entRunNow() {
  var r = entTick();
  Logger.log(JSON.stringify(r, null, 1));
  return r;
}

/** Reads both brands now and prints what came back, so the counts can be checked against the Ads console. */
function entTest() {
  var r = entTick();
  Logger.log('Read ' + (r && r.at) + ' in ' + (r && r.secs) + ' s.');
  var c = cacheRead_('adEntities') || { d: {} };
  ENT_BRANDS.forEach(function (b) {
    var x = c.d[b];
    if (!x) { Logger.log(b + ': nothing — ' + ((c.err || {})[b] || 'not read')); return; }
    Logger.log('==== ' + b + (x.stale ? ' (STALE — last good copy, today\'s read failed: ' + c.err[b] + ')' : '') + ' — read ' + x.at);
    Logger.log('  keywords ' + x.kw.length + ' · targets ' + x.tg.length + ' · negatives ' + x.neg.length
      + ' · campaigns ' + Object.keys(x.cp).length + ' · ad groups ' + Object.keys(x.ag).length);
    Logger.log('  check: Ads console → Campaign manager → Sponsored Products → Targeting / Negative targeting, same states');
    x.kw.slice(0, 3).forEach(function (k) { Logger.log('  keyword  ' + k[3] + ' (' + k[4] + ') bid ' + k[5] + ' ' + k[6] + ' · id ' + k[0]); });
    x.tg.slice(0, 3).forEach(function (t) { Logger.log('  target   ' + t[3] + ' bid ' + t[4] + ' ' + t[5] + ' · id ' + t[0]); });
    x.neg.slice(0, 3).forEach(function (n) { Logger.log('  negative ' + n[4] + ' (' + n[5] + ') at ' + (n[0] === 'cp' ? 'campaign ' + n[2] : 'ad group ' + n[3])); });
    var one = Object.keys(x.cp)[0];
    if (one) Logger.log('  campaign ' + x.cp[one][0] + ' · ' + x.cp[one][1] + ' · budget ' + x.cp[one][2] + ' · ' + x.cp[one][3]
      + ' · top ' + x.cp[one][4] + '% rest ' + x.cp[one][5] + '% product ' + x.cp[one][6] + '% · ' + x.cp[one][7]);
  });
}

function entStatus() {
  var c = cacheRead_('adEntities');
  if (!c) { Logger.log('No adEntities cache yet — run entSetup().'); return; }
  Logger.log('adEntities written ' + c.at);
  ENT_BRANDS.forEach(function (b) {
    var x = (c.d || {})[b];
    Logger.log(b + ': ' + (x ? JSON.stringify(x.n) + ' read ' + x.at + (x.stale ? ' STALE' : '') : 'none')
      + ((c.err || {})[b] ? ' · error: ' + c.err[b] : ''));
  });
  var timers = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'entTick'; }).length;
  Logger.log('timers: ' + timers + (timers ? '' : ' — run entSetup() to install them'));
}

/* ============================== the read ============================== */

// The timer's entry: one read of both brands under our own lease (not the script lock — the nightly run holds that).
function entTick() {
  var props = PropertiesService.getScriptProperties();
  var lease = Number(props.getProperty('ENT_LEASE') || 0);
  if (lease && Date.now() - lease < 6 * 60000) { Logger.log('entTick: another read is still going — skipped.'); return { skipped: true }; }
  props.setProperty('ENT_LEASE', String(Date.now()));
  try { return entRun_(); }
  finally { props.deleteProperty('ENT_LEASE'); }
}

// Read both brands into adEntities. A brand that fails keeps its last good copy.
function entRun_() {
  var t0 = Date.now();
  var old = cacheRead_('adEntities') || {};
  var out = { v: 1, at: nowStamp_(), d: old.d || {}, err: {} };
  var saved = ACTIVE_PREFIX;
  try {
    ENT_BRANDS.forEach(function (b) {
      setBrand_(b);
      try {
        out.d[b] = entReadBrand_();
      } catch (e) {
        out.err[b] = String(e.message || e).slice(0, 300);
        if (out.d[b]) out.d[b].stale = true;
      }
    });
  } finally { setBrand_(saved); }
  cacheWrite_('adEntities', out);
  var sum = { at: out.at, secs: Math.round((Date.now() - t0) / 1000) };
  ENT_BRANDS.forEach(function (b) { sum[b] = out.err[b] ? 'FAILED: ' + out.err[b] : (out.d[b] || {}).n; });
  return sum;
}

// Every page of one list for the active brand.
function entList_(k, states) {
  var L = ENT_LIST[k], out = [], token = null, guard = 0;
  do {
    var body = { maxResults: 1000, stateFilter: { include: states } };
    if (token) body.nextToken = token;
    var r = adsCall_(L[0], 'post', body, adsProfileId_(), L[1]);
    out = out.concat(r[L[2]] || []);
    token = r.nextToken || null;
  } while (token && ++guard < 300);
  if (token) throw new Error(L[0] + ' had more than ' + guard + ' pages — stopped, so the list is not cut short silently.');
  return out;
}

// A target's expression written the way the reports write it.
function entExpr_(t) {
  var ex = (t.resolvedExpression && t.resolvedExpression.length) ? t.resolvedExpression : (t.expression || []);
  return ex.map(function (p) {
    var type = String(p.type || '');
    if (ENT_AUTO[type]) return ENT_AUTO[type];
    var w = ENT_PRED[type] || type.toLowerCase();
    if (p.value == null || p.value === '') return w;
    var v = String(p.value);
    if (type === 'ASIN_SAME_AS' || type === 'ASIN_EXPANDED_FROM') v = v.toUpperCase();
    return /[<>]$/.test(w) ? w + v : w + '="' + v + '"';
  }).join(' ');
}

// One brand: keywords, targets, the four kinds of negative, campaigns and ad groups.
function entReadBrand_() {
  var S = function (v) { return String(v == null ? '' : v); };
  var N = function (v) { var x = Number(v); return isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null; };
  var kw = entList_('kw', ENT_LIVE).map(function (x) {
    return [S(x.keywordId), S(x.adGroupId), S(x.campaignId), S(x.keywordText), S(x.matchType), N(x.bid), S(x.state)];
  });
  var tg = entList_('tg', ENT_LIVE).map(function (x) {
    return [S(x.targetId), S(x.adGroupId), S(x.campaignId), entExpr_(x), N(x.bid), S(x.state)];
  });
  var neg = [];
  entList_('nk', ['ENABLED']).forEach(function (x) { neg.push(['ag', S(x.keywordId), S(x.campaignId), S(x.adGroupId), S(x.keywordText), S(x.matchType)]); });
  entList_('cnk', ['ENABLED']).forEach(function (x) { neg.push(['cp', S(x.keywordId), S(x.campaignId), '', S(x.keywordText), S(x.matchType)]); });
  entList_('nt', ['ENABLED']).forEach(function (x) { neg.push(['ag', S(x.targetId), S(x.campaignId), S(x.adGroupId), entExpr_(x), 'ASIN']); });
  entList_('cnt', ['ENABLED']).forEach(function (x) { neg.push(['cp', S(x.targetId), S(x.campaignId), '', entExpr_(x), 'ASIN']); });
  var cp = {};
  entList_('cp', ENT_LIVE).forEach(function (x) {
    var db = x.dynamicBidding || {}, pct = { PLACEMENT_TOP: 0, PLACEMENT_REST_OF_SEARCH: 0, PLACEMENT_PRODUCT_PAGE: 0 };
    (db.placementBidding || []).forEach(function (p) { if (p && p.placement in pct) pct[p.placement] = Number(p.percentage) || 0; });
    cp[S(x.campaignId)] = [S(x.name), S(x.state), N((x.budget || {}).budget), S(db.strategy),
      pct.PLACEMENT_TOP, pct.PLACEMENT_REST_OF_SEARCH, pct.PLACEMENT_PRODUCT_PAGE, S(x.targetingType)];
  });
  var ag = {};
  entList_('ag', ENT_LIVE).forEach(function (x) { ag[S(x.adGroupId)] = [S(x.campaignId), S(x.name), N(x.defaultBid), S(x.state)]; });
  return { at: nowStamp_(), kw: kw, tg: tg, neg: neg, cp: cp, ag: ag,
    n: { kw: kw.length, tg: tg.length, neg: neg.length, cp: Object.keys(cp).length, ag: Object.keys(ag).length } };
}
