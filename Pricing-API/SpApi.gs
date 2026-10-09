/* Pricing-API / SpApi.gs — SP-API plumbing: properties, marketplace, host, access token, the raw call with retry.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

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

