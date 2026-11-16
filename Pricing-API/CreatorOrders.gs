/* Pricing-API / CreatorOrders.gs — CONTENT CREATORS: Creator Setu's gift orders in, and what happened to them back out
 * (16 Nov 2026). The ERP page is Replenish-App/src/app/shopify/creator-orders.js; the spec is Khushi's
 * erp-content-creators-for-umesh.md. Built here, in the backend that already sends MCF, rather than on Cloudflare
 * (Ravi, 16 Nov: "use apps script, build it in pricing api").
 *
 *   IN   Creator Setu's server  POST <this web app>/exec?creator=order   (Content-Type: application/json)
 *        body = Khushi's order JSON + "key": "<CREATOR_SETU_SECRET>"
 *        An Apps Script web app cannot read request headers, so the key travels in the BODY — never in the address,
 *        which is logged. And it always answers HTTP 200: the outcome is in the body, { ok:false, code:401|400|503, error }.
 *        Saved to Firestore creatorOrders/{reference}, created "only if it is not there": the same order sent twice is
 *        one order, never overwritten, and the second send is answered like the first ({ ok:true, already:true }).
 *
 *   OUT  The ERP page, after a status change: apiPost({ creator: 'report', reference }) — the ordinary write door
 *        (WRITE_KEY + the person's Firebase sign-in, Code.gs doPost). The status is READ HERE from Firestore, never taken
 *        from the request, and posted to Creator Setu (sent_to_amazon | shipped | delivered | cancelled) with the same
 *        key. What was told is written on the order (field "setu"), so each status is told once.
 *
 * FIRESTORE with the script owner's own token (ScriptApp.getOAuthToken + the datastore scope), as ShopifyCache.gs
 * does — no key file. The owner's token is not subject to the security rules.
 *
 * SCRIPT PROPERTY: CREATOR_SETU_SECRET (24+ characters, the key Khushi made). Until it is set, the door is shut.
 * NEVER LOGGED: the address, phone or email. Only the reference and the outcome. */

var CO = {
  proj: 'price-research-48ff3',
  col: 'creatorOrders',
  brands: ['ridhi', 'cotton-print-club'],
  erpUrl: 'https://fabricrush-replenish.web.app/#creators?ref=',
  setuUrl: 'https://creator-growth-engine.netlify.app/api/erp/orders/',
  setuStatus: { 'Sent to Amazon': 'sent_to_amazon', 'Shipped': 'shipped', 'Delivered': 'delivered', 'Cancelled': 'cancelled' },
};

/* ---------- small pieces ---------- */
function coStr_(v, max) { return v == null ? '' : String(v).trim().slice(0, max || 200); }
/** Same length, same characters, compared in time that does not depend on where they differ. */
function coSameKey_(want, got) {
  want = String(want || ''); got = String(got || '');
  if (want.length < 24 || got.length !== want.length) return false;
  var d = 0;
  for (var i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
function coSecret_() { return String(PropertiesService.getScriptProperties().getProperty('CREATOR_SETU_SECRET') || ''); }

/**
 * The order as Creator Setu sends it, checked and cut to size: { order } or { error } — the error names the field in
 * plain words, so the person on the Creator Setu side can fix it.
 */
function coCleanOrder_(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'the body is not a JSON object' };
  var reference = coStr_(b.reference, 60);
  if (!reference) return { error: 'reference is missing' };
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,59}$/.test(reference)) return { error: 'reference may hold only letters, numbers, - and _' };
  if (/^ERP-CC-/i.test(reference)) return { error: 'reference ERP-CC-… is kept for orders typed in the ERP' };
  var brand = coStr_(b.brand, 40).toLowerCase();
  if (CO.brands.indexOf(brand) < 0) return { error: 'brand must be "ridhi" or "cotton-print-club"' };
  var c = b.creator && typeof b.creator === 'object' ? b.creator : {};
  var s = b.shipTo && typeof b.shipTo === 'object' ? b.shipTo : {};
  var shipTo = {
    name: coStr_(s.name, 80) || coStr_(c.name, 80), line1: coStr_(s.line1, 120), line2: coStr_(s.line2, 120) || null, city: coStr_(s.city, 80),
    state: coStr_(s.state, 40).toUpperCase(), zip: coStr_(s.zip, 20), country: coStr_(s.country, 2).toUpperCase(), phone: coStr_(s.phone, 30),
  };
  if (!shipTo.name) return { error: 'a name is missing' };
  if (!shipTo.line1) return { error: 'line1 is missing' };
  if (!shipTo.city) return { error: 'city is missing' };
  if (!shipTo.state) return { error: 'state is missing' };
  if (!shipTo.zip) return { error: 'zip is missing' };
  if (!/^[A-Z]{2}$/.test(shipTo.country)) return { error: 'country is missing (two letters, e.g. US)' };
  if (shipTo.country === 'US' && !/^[A-Z]{2}$/.test(shipTo.state)) return { error: 'state must be two letters for the US (e.g. OR)' };
  if (shipTo.country === 'US' && !/^\d{5}(-\d{4})?$/.test(shipTo.zip)) return { error: 'zip must be 5 digits (or 5+4) for the US' };
  var raw = Array.isArray(b.lines) ? b.lines : [];
  if (!raw.length) return { error: 'lines is missing (at least one line with a sku and a quantity)' };
  if (raw.length > 10) return { error: 'at most 10 lines' };
  var lines = [];
  for (var i = 0; i < raw.length; i++) {
    var l = raw[i] && typeof raw[i] === 'object' ? raw[i] : {};
    var sku = coStr_(l.sku, 60), quantity = Number(l.quantity);
    if (!sku) return { error: 'line ' + (i + 1) + ': sku is missing' };
    if (!(quantity === Math.floor(quantity) && quantity >= 1 && quantity <= 20)) return { error: 'line ' + (i + 1) + ': quantity must be a whole number from 1 to 20' };
    var price = Number(l.priceUsd);
    lines.push({ sku: sku, asin: coStr_(l.asin, 20), title: coStr_(l.title, 120), color: coStr_(l.color, 60), size: coStr_(l.size, 60),
      quantity: quantity, priceUsd: isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0 });
  }
  var approvedAt = coStr_(b.approvedAt, 40);
  return { order: {
    reference: reference, brand: brand, campaign: coStr_(b.campaign, 120),
    creator: { name: coStr_(c.name, 80) || shipTo.name, instagram: coStr_(c.instagram, 60).replace(/^@+/, ''), email: coStr_(c.email, 120) },
    shipTo: shipTo, lines: lines,
    approvedAt: approvedAt && !isNaN(Date.parse(approvedAt)) ? new Date(Date.parse(approvedAt)).toISOString() : '',
    note: coStr_(b.note, 500),
  } };
}

/* ---------- Firestore over REST, as the script's owner ---------- */
function coValue_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return v === Math.floor(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(coValue_) } };
  if (typeof v === 'object') { var f = {}; Object.keys(v).forEach(function (k) { f[k] = coValue_(v[k]); }); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
function coPlain_(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(coPlain_);
  if ('mapValue' in v) { var o = {}, f = (v.mapValue && v.mapValue.fields) || {}; Object.keys(f).forEach(function (k) { o[k] = coPlain_(f[k]); }); return o; }
  return null;
}
function coUrl_(path) { return 'https://firestore.googleapis.com/v1/projects/' + CO.proj + '/databases/(default)/documents/' + path; }
function coAuth_() { return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }; }
/** One document as plain JavaScript, or null when it is not there. */
function coRead_(path) {
  var r = UrlFetchApp.fetch(coUrl_(path), { muteHttpExceptions: true, headers: coAuth_() });
  if (r.getResponseCode() === 404) return null;
  if (r.getResponseCode() >= 300) throw new Error('Firestore ' + r.getResponseCode() + ' reading');
  return coPlain_({ mapValue: { fields: JSON.parse(r.getContentText() || '{}').fields || {} } });
}
/** Create a document only if it is not there: 'created' | 'exists'. */
function coCreate_(id, data) {
  var r = UrlFetchApp.fetch(coUrl_(CO.col) + '?documentId=' + encodeURIComponent(id), { method: 'post', muteHttpExceptions: true,
    contentType: 'application/json', headers: coAuth_(), payload: JSON.stringify({ fields: coValue_(data).mapValue.fields }) });
  if (r.getResponseCode() === 409) return 'exists';
  if (r.getResponseCode() >= 300) throw new Error('Firestore ' + r.getResponseCode() + ' writing');
  return 'created';
}
/** Write ONE field of a document that exists, leaving every other field as it is. */
function coWriteField_(path, field, value) {
  var r = UrlFetchApp.fetch(coUrl_(path) + '?updateMask.fieldPaths=' + encodeURIComponent(field) + '&currentDocument.exists=true', {
    method: 'patch', muteHttpExceptions: true, contentType: 'application/json', headers: coAuth_(),
    payload: JSON.stringify({ fields: (function () { var f = {}; f[field] = coValue_(value); return f; })() }) });
  if (r.getResponseCode() >= 300) throw new Error('Firestore ' + r.getResponseCode() + ' writing');
}

/* ---------- IN: Creator Setu → ERP ---------- */
/**
 * The order door. p = the parsed body. Always answers an object (Code.gs turns it into JSON):
 *   { ok:true, reference, url [, already:true] } · { ok:false, code:401|400|503, error }.
 */
function coOrderIn_(p, nowMs) {
  var secret = coSecret_();
  if (!coSameKey_(secret, p && p.key)) return { ok: false, code: 401, error: 'unauthorized' };
  var c = coCleanOrder_(p);
  if (c.error) return { ok: false, code: 400, error: c.error };
  var o = c.order, at = new Date(nowMs || Date.now()).toISOString();
  var rec = {
    reference: o.reference, brand: o.brand, campaign: o.campaign, creator: o.creator, shipTo: o.shipTo, lines: o.lines,
    approvedAt: o.approvedAt || at, status: 'New', source: 'creator-setu', createdAt: at,
    notes: o.note ? 'Creator Setu: ' + o.note : '', log: [{ at: at, by: 'Creator Setu', what: 'sent from Creator Setu' }],
  };
  var result;
  try { result = coCreate_(o.reference, rec); }
  catch (e) {
    console.log('creator-orders: not saved ' + o.reference + ' — ' + String(e && e.message || e).slice(0, 120));
    return { ok: false, code: 503, error: 'the ERP could not save it right now — send it again in a minute' };
  }
  console.log('creator-orders: ' + result + ' ' + o.reference);
  var out = { ok: true, reference: o.reference, url: CO.erpUrl + encodeURIComponent(o.reference) };
  if (result === 'exists') out.already = true;
  return out;
}

/* ---------- OUT: ERP → Creator Setu ---------- */
/** What Creator Setu is told for this order as it stands, or null when there is nothing to tell. */
function coSetuReport_(o) {
  var status = CO.setuStatus[o && o.status];
  if (!status) return null;
  var a = (o && o.amazon) || {};
  var at = (status === 'sent_to_amazon' && a.sentAt) || (status === 'shipped' && (a.shippedAt || a.checkedAt))
    || (status === 'delivered' && a.deliveredAt) || o.updAt || '';
  var iso = at && !isNaN(Date.parse(at)) ? new Date(Date.parse(at)).toISOString() : new Date().toISOString();
  return { status: status, amazonOrderId: a.orderId || '', carrier: a.carrier || '', tracking: a.tracking || '', at: iso };
}
/** May this ERP person ask for a report? The same right the Firestore rule gives: an admin, or Shopify Orders. */
function coMayReport_(email) {
  if (!email) return false;
  if (email === 'ravi@thefabricrush.com') return true;
  var p = coRead_('perms/' + encodeURIComponent(email));
  if (!p) return false;
  var has = function (l) { return Array.isArray(l) && l.indexOf('shop') >= 0; };
  return p.admin === true || has(p.tabs) || (p.repl === true && has(p.replTabs));
}
/**
 * Tell Creator Setu about one order. who = { email } from Code.gs writerOf_. Answers
 *   { ok:true, reported, setu } · { ok:true, already|skipped } · { ok:false, error [, setu] }.
 */
function coReport_(p, who, nowMs) {
  var email = String((who && who.email) || '').toLowerCase();
  if (!email) return { ok: false, error: 'Sign in to the ERP again — the backend could not confirm who you are.' };
  var ref = coStr_(p && p.reference, 60);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,59}$/.test(ref)) return { ok: false, error: 'reference is missing' };
  if (!coMayReport_(email)) return { ok: false, error: 'This account does not hold Shopify Orders.' };
  var path = CO.col + '/' + encodeURIComponent(ref);
  var o = coRead_(path);
  if (!o) return { ok: false, error: 'Order ' + ref + ' not found.' };
  if (o.source !== 'creator-setu') return { ok: true, skipped: 'typed in the ERP — Creator Setu does not know it' };
  var rep = coSetuReport_(o);
  if (!rep) return { ok: true, skipped: 'nothing to report for ' + (o.status || 'New') };
  if (o.setu && o.setu.status === rep.status && !o.setu.error) return { ok: true, already: true, setu: o.setu };
  var secret = coSecret_();
  if (secret.length < 24) return { ok: false, error: 'CREATOR_SETU_SECRET is not set on the backend.' };
  var r = UrlFetchApp.fetch(CO.setuUrl + encodeURIComponent(ref), { method: 'post', muteHttpExceptions: true,
    contentType: 'application/json', headers: { Authorization: 'Bearer ' + secret }, payload: JSON.stringify(rep) });
  var code = r.getResponseCode(), at = new Date(nowMs || Date.now()).toISOString();
  if (code >= 300) {
    var why = code === 401 ? 'Creator Setu refused the key (401) — the two keys differ'
      : code === 404 ? 'Creator Setu does not know ' + ref + ' (404)' : 'Creator Setu answered ' + code;
    var bad = { status: (o.setu && o.setu.status) || '', tried: rep.status, error: why, at: at, by: email };
    try { coWriteField_(path, 'setu', bad); } catch (e) { /* the answer still says it */ }
    console.log('creator-orders: report refused ' + ref + ' ' + code);
    return { ok: false, error: why, setu: bad };
  }
  var setu = { status: rep.status, at: at, by: email };
  coWriteField_(path, 'setu', setu);
  console.log('creator-orders: reported ' + ref + ' ' + rep.status);
  return { ok: true, reported: rep.status, setu: setu };
}

/** Editor check: is the door set up? Prints whether the key is set and whether Firestore answers. Changes nothing. */
function creatorOrdersCheck() {
  Logger.log('CREATOR_SETU_SECRET set: %s (%s characters)', coSecret_().length >= 24, coSecret_().length);
  try { coRead_(CO.col + '/__check__'); Logger.log('Firestore: answers'); }
  catch (e) { Logger.log('Firestore: FAILED — %s', e.message || e); }
  Logger.log('Creator Setu sends to: %s?creator=order', ScriptApp.getService().getUrl());
}
