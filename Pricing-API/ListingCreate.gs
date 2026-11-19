/* Pricing-API / ListingCreate.gs — Create Listing (roadmap #8, 20 Nov 2026): a NEW SKU on Amazon, Amazon's check first.
 *
 * A NEW FILE THAT CHANGES NOTHING ELSE. The only other change is ONE line in Code.gs doPost, next to the lfix=patch line:
 *
 *     if (p.lcreate === 'put') return json_(lcreatePut_(p));
 *
 *   POST {lcreate:'put', brand, sku, productType, attributes: { name: [values] }, apply, by}
 *     1 the SKU must be NEW: if Amazon already has a listing with it, nothing is sent ("This SKU already exists")
 *     2 ALWAYS checked with Amazon first: putListingsItem with mode=VALIDATION_PREVIEW (nothing is created)
 *     3 created for real only when apply is true AND Amazon's check reported no ERROR (and the status is not INVALID)
 *   Pictures are never sent from here (the Image Manager adds them after). A product identifier (UPC / EAN) is only the one the person
 *   types: Sellora never copies one from the listing it clones (a new listing needs its own, or Amazon's exemption). The same plumbing as ListingFix.gs (limgSp_, limgErr_,
 *   limgSeller_, lfixIssue_, lfixLog_) — read only, nothing there is changed.
 * Sellora's Create Listing screen sends it through its one safe send path (Amazon's check → the person approves → send → read again →
 * Listing History "Created"). The required fields come from the existing GET ?lfix=schema (no new GET route).
 * Main function: lcreatePut_. */

var LCREATE_ATTR = /^[a-z0-9_]{1,80}$/;
var LCREATE_NEVER = /image_locator|^merchant_suggested_asin$/;

function lcreatePut_(p) {
  setBrand_(p.brand);
  var sku = String(p.sku || '').trim(), pt = String(p.productType || '').trim().toUpperCase();
  var attrs = p.attributes && typeof p.attributes === 'object' ? p.attributes : null;
  if (!sku || !/^[A-Za-z0-9._\-\/ ]{1,40}$/.test(sku)) return { ok: false, error: 'Give a new SKU (letters, numbers, . _ - /, at most 40).' };
  if (!pt || !/^[A-Z0-9_]{2,60}$/.test(pt)) return { ok: false, error: 'Give the product type.' };
  if (!attrs || !Object.keys(attrs).length) return { ok: false, error: 'No attributes to create the listing with.' };
  var names = Object.keys(attrs);
  if (names.length > 150) return { ok: false, error: 'At most 150 attributes.' };
  var bad = names.filter(function (k) { return !LCREATE_ATTR.test(k) || !Array.isArray(attrs[k]); });
  if (bad.length) return { ok: false, error: 'Not an attribute this screen may send: ' + bad[0] };
  var never = names.filter(function (k) { return LCREATE_NEVER.test(k); });
  if (never.length) return { ok: false, error: 'Pictures are not sent from Create Listing (the Image Manager adds them after): ' + never.join(', ') };
  var mk = marketplaceId_();
  var body = { productType: pt, requirements: 'LISTING', attributes: {} };
  names.forEach(function (k) {
    body.attributes[k] = attrs[k].map(function (e) { var o = {}; Object.keys(e || {}).forEach(function (f) { o[f] = e[f]; }); if (!o.marketplace_id) o.marketplace_id = mk; return o; });
  });
  var seller;
  try { seller = limgSeller_(''); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  var base = '/listings/2021-08-01/items/' + seller + '/' + encodeURIComponent(sku) + '?marketplaceIds=' + mk;
  // 1 a NEW SKU only: an existing listing is never overwritten from here
  var have = limgSp_(base + '&includedData=summaries', 'get');
  if (have.code === 200 && have.body && have.body.sku) return { ok: false, exists: true, error: 'This SKU already exists on Amazon — choose a new SKU (Create Listing never changes an existing listing).' };
  if (have.code >= 300 && have.code !== 404) return limgErr_(have, 'Checking the SKU is new');
  // 2 Amazon's check (nothing is created)
  var path = base + '&includedData=issues';
  var pre = limgSp_(path + '&mode=VALIDATION_PREVIEW', 'put', body);
  if (pre.code >= 300) return limgErr_(pre, 'Checking the new listing with Amazon');
  var issues = (pre.body.issues || []).map(lfixIssue_);
  var errors = issues.filter(function (i) { return i.severity === 'ERROR'; });
  var invalid = pre.body.status === 'INVALID';
  if (errors.length || invalid || !p.apply) {
    return { ok: !errors.length && !invalid, previewOnly: true, status: pre.body.status, issues: issues,
      error: errors.length || invalid ? 'Amazon would reject this: ' + (errors.length ? errors : issues).map(function (i) { return i.message; }).join(' | ') : '' };
  }
  // 3 created for real
  var real = limgSp_(path, 'put', body);
  if (real.code >= 300) return limgErr_(real, 'Creating the listing');
  var out = { ok: real.body.status === 'ACCEPTED', status: real.body.status, submissionId: real.body.submissionId, issues: (real.body.issues || []).map(lfixIssue_), created: true };
  if (!out.ok) out.error = 'Amazon did not accept it (status ' + real.body.status + ').';
  lfixLog_({ at: new Date().toISOString(), by: String(p.by || ''), brand: ACTIVE_PREFIX, sku: sku, paths: ['create ' + pt + ' (' + names.length + ' attributes)'],
    status: out.status, submissionId: out.submissionId || '' });
  return out;
}
