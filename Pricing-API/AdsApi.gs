/* Pricing-API / AdsApi.gs — Amazon Ads API: token, profiles, PPC reports, and the editor checks for both APIs.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

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

