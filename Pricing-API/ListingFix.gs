/* Pricing-API / ListingFix.gs — Listing Errors: read a listing's issues, the allowed values, and fix attributes.
 * Added 2026-10-09 (Ravi: "amazon listing ... kya error h and mujhe app se hi thik krna h").
 *
 *   GET  ?lfix=get&brand=&sku=            the listing: product type, status, every issue (with the attributes it
 *                                         names), and the current value of every attribute
 *   GET  ?lfix=schema&brand=&pt=&attrs=   what Amazon allows for those attributes on that product type
 *                                         (Product Type Definitions API): type, allowed values, max length
 *   POST {lfix:'patch', brand, sku, productType, patches:[{op, path:'/attributes/x', value}], apply, by}
 *                                         ALWAYS checked with Amazon first (VALIDATION_PREVIEW); sent for real only
 *                                         when apply is true and Amazon reports no ERROR
 *   GET  ?lfix=history[&sku=]             every change sent from the app
 *
 * Uses the plumbing in ListingImages.gs (limgSp_, limgErr_, limgSeller_). Images are fixed in the Image Manager. */

function lfixIssue_(i) {
  return { severity: i.severity, code: i.code, message: i.message, attrs: i.attributeNames || [],
    cats: i.categories || [], enforced: !!(i.enforcements && i.enforcements.actions && i.enforcements.actions.length) };
}

function lfixGet_(p) {
  setBrand_(p.brand);
  var sku = String(p.sku || '').trim();
  if (!sku) return { ok: false, error: 'Give a SKU.' };
  var seller;
  try { seller = limgSeller_(''); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  var r = limgSp_('/listings/2021-08-01/items/' + seller + '/' + encodeURIComponent(sku) + '?marketplaceIds=' + marketplaceId_() +
    '&includedData=summaries,attributes,issues', 'get');
  if (r.code >= 300) return limgErr_(r, 'Reading listing ' + sku);
  var b = r.body, s = (b.summaries && b.summaries[0]) || {};
  return {
    ok: true, brand: ACTIVE_PREFIX, sku: b.sku || sku, asin: s.asin || '', productType: s.productType || '',
    status: s.status || [], title: s.itemName || '', mainImage: s.mainImage ? s.mainImage.link : '',
    issues: (b.issues || []).map(lfixIssue_), attributes: b.attributes || {},
  };
}

/* ---- what Amazon allows: the product type's JSON schema, cut down to the attributes asked for ---- */
function lfixSchemaDoc_(pt) {
  var r = limgSp_('/definitions/2020-09-01/productTypes/' + encodeURIComponent(pt) + '?marketplaceIds=' + marketplaceId_() +
    '&requirements=LISTING&locale=en_US', 'get');
  if (r.code >= 300) throw new Error(limgErr_(r, 'Product type ' + pt).error);
  var link = r.body.schema && r.body.schema.link && r.body.schema.link.resource;
  if (!link) throw new Error('Amazon sent no schema for ' + pt);
  var s = UrlFetchApp.fetch(link, { muteHttpExceptions: true });
  if (s.getResponseCode() >= 300) throw new Error('The schema for ' + pt + ' could not be read (' + s.getResponseCode() + ')');
  return { schema: JSON.parse(s.getContentText()), required: r.body.schema && r.body.schema.required };
}

/** The useful part of one attribute's schema: a flat list of its fields, each with type, allowed values, limits. */
function lfixAttrShape_(name, def) {
  var out = { name: name, title: def.title || name, description: String(def.description || '').slice(0, 400), fields: [] };
  var item = (def.items && def.items.properties) ? def.items : null;
  if (!item) return out;
  out.required = (item.required || []).slice();
  Object.keys(item.properties).forEach(function (f) {
    if (f === 'marketplace_id' || f === 'language_tag') return;
    var d = item.properties[f], fd = { field: f, title: d.title || f, type: d.type || '' };
    if (d.enum) { fd.enum = d.enum.slice(0, 400); fd.enumNames = (d.enumNames || []).slice(0, 400); }
    if (d.anyOf) d.anyOf.forEach(function (a) { if (a.enum) { fd.enum = (fd.enum || []).concat(a.enum).slice(0, 400); fd.enumNames = (fd.enumNames || []).concat(a.enumNames || a.enum).slice(0, 400); } });
    if (d.maxLength) fd.maxLength = d.maxLength;
    if (d.minimum != null) fd.minimum = d.minimum;
    if (d.maxUtf8ByteLength) fd.maxBytes = d.maxUtf8ByteLength;
    out.fields.push(fd);
    /* One level down (e.g. unit_count.type.value): Amazon nests the allowed values there. */
    var sub = (d.properties) || (d.items && d.items.properties) || null;
    if (sub) Object.keys(sub).forEach(function (g) {
      var e = sub[g], gd = { field: f + '.' + g, title: (d.title || f) + ' · ' + (e.title || g), type: e.type || '' };
      if (e.enum) { gd.enum = e.enum.slice(0, 400); gd.enumNames = (e.enumNames || []).slice(0, 400); }
      if (e.maxLength) gd.maxLength = e.maxLength;
      out.fields.push(gd);
    });
  });
  if (def.maxItems) out.maxItems = def.maxItems;
  return out;
}

function lfixSchema_(p) {
  setBrand_(p.brand);
  var pt = String(p.pt || '').trim().toUpperCase();
  var attrs = String(p.attrs || '').split(',').map(function (a) { return a.trim(); }).filter(Boolean).slice(0, 20);
  if (!pt || !attrs.length) return { ok: false, error: 'Give a product type and the attributes.' };
  var cache = CacheService.getScriptCache(), out = {}, todo = [];
  attrs.forEach(function (a) {
    var c = cache.get('lfix2_' + ACTIVE_PREFIX + '_' + pt + '_' + a);
    if (c) out[a] = JSON.parse(c); else todo.push(a);
  });
  if (todo.length) {
    var doc;
    try { doc = lfixSchemaDoc_(pt); } catch (e) { return { ok: false, error: String(e.message || e) }; }
    var props = (doc.schema && doc.schema.properties) || {};
    todo.forEach(function (a) {
      out[a] = props[a] ? lfixAttrShape_(a, props[a]) : { name: a, missing: true };
      try { cache.put('lfix2_' + ACTIVE_PREFIX + '_' + pt + '_' + a, JSON.stringify(out[a]).slice(0, 95000), 21600); } catch (e) { /* too big to cache */ }
    });
    out._required = (doc.schema && doc.schema.required) || [];
  }
  return { ok: true, productType: pt, attrs: out };
}

/* ---- changing a listing ---- */
var LFIX_PATH = /^\/attributes\/[a-z0-9_]+$/;

function lfixPatch_(p) {
  setBrand_(p.brand);
  var sku = String(p.sku || '').trim(), pt = String(p.productType || '').trim();
  var patches = p.patches || [];
  if (!sku || !pt) return { ok: false, error: 'SKU and product type are both needed.' };
  if (!patches.length) return { ok: false, error: 'Nothing changed.' };
  if (patches.length > 30) return { ok: false, error: 'At most 30 changes at once.' };
  /* Only attribute values, and never the images (the Image Manager owns those, with its own checks). */
  var bad = patches.filter(function (x) {
    return !x || ['add', 'replace', 'delete'].indexOf(x.op) < 0 || !LFIX_PATH.test(String(x.path || ''))
      || /image_locator/.test(String(x.path)) || (x.op !== 'delete' && !Array.isArray(x.value));
  });
  if (bad.length) return { ok: false, error: 'Not an attribute change this screen may send: ' + JSON.stringify(bad[0]).slice(0, 200) };
  var mk = marketplaceId_();
  patches = patches.map(function (x) {
    var v = (x.value || []).map(function (e) { var o = {}; Object.keys(e || {}).forEach(function (k) { o[k] = e[k]; }); if (!o.marketplace_id) o.marketplace_id = mk; return o; });
    return x.op === 'delete' ? { op: 'delete', path: x.path, value: v.length ? v : [{ marketplace_id: mk }] } : { op: x.op, path: x.path, value: v };
  });
  var seller;
  try { seller = limgSeller_(''); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  var path = '/listings/2021-08-01/items/' + seller + '/' + encodeURIComponent(sku) + '?marketplaceIds=' + mk + '&includedData=issues';
  var body = { productType: pt, patches: patches };

  var pre = limgSp_(path + '&mode=VALIDATION_PREVIEW', 'patch', body);
  if (pre.code >= 300) return limgErr_(pre, 'Checking the change with Amazon');
  var issues = (pre.body.issues || []).map(lfixIssue_);
  var errors = issues.filter(function (i) { return i.severity === 'ERROR'; });
  /* INVALID with only warnings is still Amazon saying no — never reported as fine. */
  var invalid = pre.body.status === 'INVALID';
  if (errors.length || invalid || !p.apply) {
    return { ok: !errors.length && !invalid, previewOnly: true, status: pre.body.status, issues: issues, patches: patches,
      error: errors.length || invalid ? 'Amazon would reject this: ' + (errors.length ? errors : issues).map(function (i) { return i.message; }).join(' | ') : '' };
  }
  var real = limgSp_(path, 'patch', body);
  if (real.code >= 300) return limgErr_(real, 'Sending the change');
  var out = { ok: real.body.status === 'ACCEPTED', status: real.body.status, submissionId: real.body.submissionId,
    issues: (real.body.issues || []).map(lfixIssue_), patches: patches };
  if (!out.ok) out.error = 'Amazon did not accept it (status ' + real.body.status + ').';
  lfixLog_({ at: new Date().toISOString(), by: String(p.by || ''), brand: ACTIVE_PREFIX, sku: sku,
    paths: patches.map(function (x) { return x.op + ' ' + x.path; }), status: out.status, submissionId: out.submissionId || '' });
  return out;
}

function lfixLog_(row) {
  var props = PropertiesService.getScriptProperties(), list = [];
  try { list = JSON.parse(props.getProperty('LFIX_LOG') || '[]'); } catch (e) { list = []; }
  list.unshift(row);
  var s = JSON.stringify(list.slice(0, 200));
  while (s.length > 8500 && list.length > 1) { list.pop(); s = JSON.stringify(list); }
  props.setProperty('LFIX_LOG', s);
}
function lfixHistory_(sku) {
  var list = [];
  try { list = JSON.parse(prop_('LFIX_LOG') || '[]'); } catch (e) { list = []; }
  if (sku) list = list.filter(function (r) { return r.sku === sku; });
  return { ok: true, rows: list };
}
