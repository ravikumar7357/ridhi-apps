/* Pricing-API / CreatorProbe.gs — EDITOR CHECK (23 Nov 2026): can OUR Ads API key see Creator Connections and
 * Amazon Attribution? Run creatorAccessProbe from the editor and read the log. READ ONLY: every call is a GET,
 * nothing is written anywhere, and only status codes, counts and Amazon's error text are logged — never a token,
 * an invoice address or an amount.
 *
 * For each brand (SP, CPC) it asks, with that brand's ADS_* key and profile:
 *   1. GET /invoices                  Creator Connections spend lives ONLY on the advertising invoices.
 *                                     200 → the key can read billing. 401/403 → the login needs billing access.
 *      GET /invoices/{newest}         …and then looks for Creator Connections lines on the newest invoice.
 *   2. GET /attribution/advertisers   Amazon Attribution. 200 with advertisers → usable. 200 but empty, or a
 *                                     401/403 → the brand is not signed up for Attribution, or the login lacks it.
 *   3. GET /attribution/publishers    Attribution's publisher list (affiliate / creator publishers). Same reading.
 * Per-creator SALES from Creator Connections are in the console only — no API gives them, so nothing to probe. */

function cpGet_(path, profileId, accept) {
  var headers = { Authorization: 'Bearer ' + adsToken_(), 'Amazon-Advertising-API-ClientId': adsClientId_() };
  if (profileId) headers['Amazon-Advertising-API-Scope'] = String(profileId);
  if (accept) headers.Accept = accept;
  try {
    var r = UrlFetchApp.fetch(adsHost_() + path, { method: 'get', muteHttpExceptions: true, headers: headers });
    var text = r.getContentText() || '', body = null;
    try { body = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { code: r.getResponseCode(), body: body, said: r.getResponseCode() >= 300 ? text.slice(0, 200) : '' };
  } catch (e) { return { code: 0, body: null, said: String(e.message || e).slice(0, 200) }; }
}

/** Try the versioned media type first, then plain JSON — Amazon answers 406/415 when it wants the other. */
function cpGetEither_(path, profileId, versioned) {
  var r = cpGet_(path, profileId, versioned);
  if (r.code === 406 || r.code === 415 || r.code === 400) r = cpGet_(path, profileId, 'application/json');
  return r;
}

function cpVerdict_(code) {
  if (code >= 200 && code < 300) return 'OK';
  if (code === 401 || code === 403) return 'NO ACCESS';
  if (code === 404) return 'NOT FOUND (endpoint or not enrolled)';
  if (!code) return 'NO ANSWER';
  return 'ERROR';
}

function creatorAccessProbe() {
  var saved = ACTIVE_PREFIX;
  ['SP', 'CPC'].forEach(function (b) {
    setBrand_(b);
    Logger.log('==================== ' + b + ' ====================');
    var pid;
    try { pid = adsProfileId_(); Logger.log('profile ' + pid + ' (host ' + adsHost_() + ')'); }
    catch (e) { Logger.log('❌ no profile — ' + (e.message || e)); return; }

    /* 1. Invoices → Creator Connections spend */
    var inv = cpGetEither_('/invoices?count=5', pid, 'application/vnd.invoices.v1.1+json');
    Logger.log('1. Invoices: %s %s%s', inv.code, cpVerdict_(inv.code), inv.said ? ' — ' + inv.said : '');
    if (inv.code === 200 && inv.body) {
      var list = (inv.body.payload && inv.body.payload.invoiceSummaries) || inv.body.invoiceSummaries || inv.body.invoices || [];
      Logger.log('   invoices returned: %s', list.length);
      if (list[0]) Logger.log('   invoice summary fields: %s', Object.keys(list[0]).join(', '));   // names only, no values
      var total = 0, checked = 0;
      list.forEach(function (sum, i) {
        var id = sum.id || sum.invoiceId || sum.invoiceNumber || sum.invoiceSummaryId
          || (sum.invoiceSummary && (sum.invoiceSummary.id || sum.invoiceSummary.invoiceId));
        if (!id) return;
        var d = cpGetEither_('/invoices/' + encodeURIComponent(id), pid, 'application/vnd.invoice.v1.2+json');
        if (d.code !== 200) { Logger.log('   invoice %s detail: %s %s%s', i + 1, d.code, cpVerdict_(d.code), d.said ? ' — ' + d.said : ''); return; }
        checked++;
        var cc = (JSON.stringify(d.body || {}).match(/creator[\s_-]?connections?/gi) || []).length;
        total += cc;
        Logger.log('   invoice %s: Creator Connections mentions %s', i + 1, cc);
      });
      if (!checked) Logger.log('   could not open any invoice detail — send me the "invoice summary fields" line');
      else Logger.log('   → %s', total ? 'the key CAN give Creator Connections spend' : 'no Creator Connections lines on the last ' + checked + ' invoices (none billed, or a different label)');
    }

    /* 2 + 3. Amazon Attribution */
    var adv = cpGet_('/attribution/advertisers', pid, 'application/json');
    var advList = adv.body && (adv.body.advertisers || (Array.isArray(adv.body) ? adv.body : null));
    Logger.log('2. Attribution advertisers: %s %s%s%s', adv.code, cpVerdict_(adv.code),
      advList ? ' — ' + advList.length + ' advertiser(s)' : '', adv.said ? ' — ' + adv.said : '');
    if (adv.code === 200 && advList && !advList.length) Logger.log('   empty → this brand is not set up in Amazon Attribution');

    var pub = cpGet_('/attribution/publishers', pid, 'application/json');
    var pubList = pub.body && (pub.body.publishers || (Array.isArray(pub.body) ? pub.body : null));
    Logger.log('3. Attribution publishers: %s %s%s%s', pub.code, cpVerdict_(pub.code),
      pubList ? ' — ' + pubList.length + ' publisher(s)' : '', pub.said ? ' — ' + pub.said : '');
  });
  ACTIVE_PREFIX = saved;
  Logger.log('Done. OK = our key can give it. NO ACCESS = add the permission on the Ads account (Billing / Attribution).');
}
