/* Pricing-API / Setup.gs — setup helper, run once from the editor.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

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
