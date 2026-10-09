/* ===================== LISTING IMAGES (Listings Items API) =====================
 *
 * The image stack of ONE listing, read and changed: MAIN, PT01..PT08 and the SWATCH.
 *
 * Two different answers to "what are the images", and both are shown because they disagree:
 *   - the CATALOG (what shoppers see right now): /catalog/2022-04-01 `images`, by variant;
 *   - the LISTING (what THIS seller has submitted): /listings/2021-08-01 attributes
 *     main_product_image_locator, other_product_image_locator_1..8, swatch_product_image_locator.
 * Amazon builds the detail page from every contributor, so a slot can be live on the catalogue and
 * empty in our listing, or the other way round while a change is still being processed.
 *
 * Writing needs the Product Listing role on the SP-API app and the brand's seller id. The seller id
 * is found once, from a fees estimate (that answer always names the seller asking), and kept in
 * Script Property <BRAND>_SELLER_ID.
 *
 * A change is ALWAYS sent as VALIDATION_PREVIEW first. Only if Amazon reports no ERROR is it sent
 * for real. Amazon processes it asynchronously: ACCEPTED means queued, not live.
 *
 * Images Amazon does not have yet are uploaded to a public Google Drive folder, because Amazon takes
 * a URL and fetches the picture itself; it does not accept a file.
 */

var LIMG_SLOTS = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08', 'SWCH'];
var LIMG_ATTR = {
  MAIN: 'main_product_image_locator',
  PT01: 'other_product_image_locator_1', PT02: 'other_product_image_locator_2',
  PT03: 'other_product_image_locator_3', PT04: 'other_product_image_locator_4',
  PT05: 'other_product_image_locator_5', PT06: 'other_product_image_locator_6',
  PT07: 'other_product_image_locator_7', PT08: 'other_product_image_locator_8',
  SWCH: 'swatch_product_image_locator',
};

/** Raw SP-API call that hands back status + body instead of throwing, so a 403 can be named. */
function limgSp_(path, method, payload) {
  var opt = {
    method: method || 'get', muteHttpExceptions: true,
    headers: { 'x-amz-access-token': getToken_() }, contentType: 'application/json',
  };
  if (payload) opt.payload = JSON.stringify(payload);
  for (var a = 0; a < 4; a++) {
    var resp = UrlFetchApp.fetch(spHost_() + path, opt);
    var code = resp.getResponseCode(), text = resp.getContentText();
    if (code === 429 && a < 3) { Utilities.sleep(1500 * (a + 1)); continue; }
    var body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (e) { body = { raw: text.slice(0, 500) }; }
    return { code: code, body: body };
  }
}

function limgErr_(r, what) {
  var errs = (r.body && r.body.errors) || [];
  var msg = errs.map(function (e) { return (e.code || '') + ': ' + (e.message || ''); }).join(' | ')
    || JSON.stringify(r.body).slice(0, 300);
  var out = { ok: false, status: r.code, error: what + ' — Amazon answered ' + r.code + ': ' + msg };
  if (r.code === 403) {
    out.role = false;
    out.error += ' (403 means the SP-API app does not have the Product Listing role for this brand,'
      + ' or the refresh token was issued before the role was added and must be re-authorised.)';
  }
  return out;
}

/** The brand's seller id: Script Property first, otherwise asked of the Fees API once and kept. */
function limgSeller_(asinHint) {
  var key = ACTIVE_PREFIX + '_SELLER_ID';
  var have = prop_(key);
  if (have) return have;
  var asin = asinHint;
  if (!asin) {
    var m = skuAsinMap_().map || {};
    var ks = Object.keys(m);
    asin = ks.length ? m[ks[0]] : '';
  }
  if (!asin) throw new Error('No ASIN to ask Amazon for the seller id with. Set Script Property ' + key + '.');
  var r = limgSp_('/products/fees/v0/items/' + asin + '/feesEstimate', 'post', {
    FeesEstimateRequest: {
      MarketplaceId: marketplaceId_(), IsAmazonFulfilled: true, Identifier: 'seller-id-' + Date.now(),
      PriceToEstimateFees: { ListingPrice: { CurrencyCode: 'USD', Amount: 20 } },
    },
  });
  var id = r.body && r.body.payload && r.body.payload.FeesEstimateResult &&
    r.body.payload.FeesEstimateResult.FeesEstimateIdentifier &&
    r.body.payload.FeesEstimateResult.FeesEstimateIdentifier.SellerId;
  if (!id) throw new Error('Amazon did not name the seller id (fees answered ' + r.code + '). Set Script Property ' + key + '.');
  PropertiesService.getScriptProperties().setProperty(key, id);
  return id;
}

/** Which of OUR SKUs sit on an ASIN. One ASIN can carry several (FBA + MFN, old + new). */
function limgSkusForAsin_(seller, asin) {
  var r = limgSp_('/listings/2021-08-01/items/' + seller + '?marketplaceIds=' + marketplaceId_() +
    '&identifiers=' + asin + '&identifiersType=ASIN&includedData=summaries&pageSize=20', 'get');
  if (r.code >= 300) return limgErr_(r, 'Finding the SKU for ' + asin);
  return {
    ok: true, skus: (r.body.items || []).map(function (it) {
      var s = (it.summaries && it.summaries[0]) || {};
      return { sku: it.sku, status: (s.status || []).join(','), fnsku: s.fnSku || '' };
    }),
  };
}

/** What shoppers see: the catalogue's images by slot, largest size of each. */
function limgCatalog_(asin) {
  var r = limgSp_('/catalog/2022-04-01/items/' + asin + '?marketplaceIds=' + marketplaceId_() +
    '&includedData=images,summaries,relationships', 'get');
  if (r.code >= 300) return { ok: false, error: limgErr_(r, 'Catalogue').error };
  var slots = {};
  var imgs = (r.body.images && r.body.images[0] && r.body.images[0].images) || [];
  imgs.forEach(function (im) {
    if (!im || !im.variant || !im.link) return;
    var w = Number(im.width) || 0;
    if (!slots[im.variant] || w > slots[im.variant].w) slots[im.variant] = { w: w, h: Number(im.height) || 0, link: im.link };
  });
  var s = (r.body.summaries && r.body.summaries[0]) || {};
  var parent = '';
  ((r.body.relationships && r.body.relationships[0] && r.body.relationships[0].relationships) || []).forEach(function (rel) {
    if (rel.parentAsins && rel.parentAsins.length) parent = rel.parentAsins[0];
  });
  return { ok: true, slots: slots, title: s.itemName || '', color: s.color || '', size: s.size || '', parent: parent };
}

/**
 * GET ?limg=get&brand=SP|CPC&sku=…   or   &asin=…
 * Both views of the stack, plus the listing's product type (a patch needs it) and open issues.
 */
function limgGet_(p) {
  setBrand_(p.brand);
  var sku = String(p.sku || '').trim(), asin = String(p.asin || '').trim().toUpperCase();
  var seller;
  try { seller = limgSeller_(/^[A-Z0-9]{10}$/.test(asin) ? asin : ''); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }

  var choices = null;
  if (!sku) {
    if (!/^[A-Z0-9]{10}$/.test(asin)) return { ok: false, error: 'Give a SKU or an ASIN.' };
    var f = limgSkusForAsin_(seller, asin);
    if (!f.ok) return f;
    if (!f.skus.length) return { ok: false, error: 'This brand has no listing on ' + asin + '. Is it the other brand?' };
    choices = f.skus;
    sku = f.skus[0].sku;
  }

  var r = limgSp_('/listings/2021-08-01/items/' + seller + '/' + encodeURIComponent(sku) +
    '?marketplaceIds=' + marketplaceId_() + '&includedData=summaries,attributes,issues', 'get');
  if (r.code >= 300) {
    var bad = limgErr_(r, 'Reading listing ' + sku);
    bad.seller = seller;
    return bad;
  }
  var b = r.body, s = (b.summaries && b.summaries[0]) || {};
  var at = b.attributes || {};
  var listing = {};
  LIMG_SLOTS.forEach(function (slot) {
    var v = at[LIMG_ATTR[slot]];
    if (v && v.length && v[0].media_location) listing[slot] = v[0].media_location;
  });
  asin = s.asin || asin;
  var cat = asin ? limgCatalog_(asin) : { ok: false, error: 'no ASIN on this listing yet' };
  return {
    ok: true, brand: ACTIVE_PREFIX, seller: seller, sku: b.sku || sku, asin: asin,
    productType: s.productType || '', status: s.status || [], title: s.itemName || cat.title || '',
    mainImage: s.mainImage ? s.mainImage.link : '',
    listing: listing, catalog: cat.ok ? cat.slots : {}, catalogError: cat.ok ? '' : cat.error,
    parent: cat.parent || '', color: cat.color || '', size: cat.size || '',
    issues: (b.issues || []).map(function (i) {
      return { severity: i.severity, code: i.code, message: i.message, attrs: i.attributeNames || [] };
    }),
    skuChoices: choices,
  };
}

/**
 * POST {limg:'patch', brand, sku, productType, set:{SLOT:url|''}, apply:true|false}
 * `set` holds ONLY the slots that change; '' removes a slot. Preview first, always.
 */
function limgPatch_(p) {
  setBrand_(p.brand);
  var sku = String(p.sku || '').trim(), pt = String(p.productType || '').trim();
  if (!sku || !pt) return { ok: false, error: 'SKU and product type are both needed.' };
  var set = p.set || {}, mk = marketplaceId_();
  var patches = [];
  var bad = [];
  Object.keys(set).forEach(function (slot) {
    var attr = LIMG_ATTR[slot];
    if (!attr) { bad.push(slot + ' is not a slot'); return; }
    var url = String(set[slot] || '').trim();
    if (!url) {
      patches.push({ op: 'delete', path: '/attributes/' + attr, value: [{ marketplace_id: mk }] });
    } else if (!/^https:\/\//i.test(url)) {
      bad.push(slot + ': the image must be an https:// address Amazon can fetch');
    } else {
      patches.push({ op: 'replace', path: '/attributes/' + attr, value: [{ marketplace_id: mk, media_location: url }] });
    }
  });
  if (bad.length) return { ok: false, error: bad.join('; ') };
  if (!patches.length) return { ok: false, error: 'Nothing changed.' };
  if (set.MAIN === '') return { ok: false, error: 'The MAIN image cannot be removed — replace it instead.' };

  var seller;
  try { seller = limgSeller_(''); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  var path = '/listings/2021-08-01/items/' + seller + '/' + encodeURIComponent(sku) +
    '?marketplaceIds=' + mk + '&includedData=issues';
  var body = { productType: pt, patches: patches };

  var pre = limgSp_(path + '&mode=VALIDATION_PREVIEW', 'patch', body);
  if (pre.code >= 300) return limgErr_(pre, 'Checking the change with Amazon');
  var issues = (pre.body.issues || []).map(function (i) {
    return { severity: i.severity, code: i.code, message: i.message, attrs: i.attributeNames || [] };
  });
  var errors = issues.filter(function (i) { return i.severity === 'ERROR'; });
  if (errors.length || !p.apply) {
    return { ok: !errors.length, previewOnly: true, status: pre.body.status, issues: issues, patches: patches,
      error: errors.length ? 'Amazon would reject this: ' + errors.map(function (i) { return i.message; }).join(' | ') : '' };
  }

  var real = limgSp_(path, 'patch', body);
  if (real.code >= 300) return limgErr_(real, 'Sending the change');
  var out = {
    ok: real.body.status === 'ACCEPTED', status: real.body.status, submissionId: real.body.submissionId,
    issues: (real.body.issues || []).map(function (i) {
      return { severity: i.severity, code: i.code, message: i.message, attrs: i.attributeNames || [] };
    }),
    patches: patches,
  };
  if (!out.ok) out.error = 'Amazon did not accept it (status ' + real.body.status + ').';
  limgLog_({ at: new Date().toISOString(), by: String(p.by || ''), brand: ACTIVE_PREFIX, sku: sku,
    set: set, status: out.status, submissionId: out.submissionId || '' });
  return out;
}

/** Every change sent, newest first, in a Script Property (last 200). Enough to say who changed what. */
function limgLog_(row) {
  var props = PropertiesService.getScriptProperties();
  var list = [];
  try { list = JSON.parse(props.getProperty('LIMG_LOG') || '[]'); } catch (e) { list = []; }
  list.unshift(row);
  var s = JSON.stringify(list.slice(0, 200));
  while (s.length > 8500 && list.length > 1) { list.pop(); s = JSON.stringify(list); }
  props.setProperty('LIMG_LOG', s);
}
function limgHistory_(sku) {
  var list = [];
  try { list = JSON.parse(prop_('LIMG_LOG') || '[]'); } catch (e) { list = []; }
  if (sku) list = list.filter(function (r) { return r.sku === sku; });
  return { ok: true, rows: list };
}

/* ---------- uploads: a public Drive folder Amazon can fetch from ---------- */

function limgFolder_() {
  var id = prop_('LIMG_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* deleted: make a new one */ } }
  var f = DriveApp.createFolder('Sellora - Amazon listing images');
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  PropertiesService.getScriptProperties().setProperty('LIMG_FOLDER_ID', f.getId());
  return f;
}

/** The address Amazon is given: the file's own bytes, not Drive's preview page. */
function limgDriveUrl_(id) {
  return 'https://drive.usercontent.google.com/download?id=' + id + '&export=view';
}

/** POST {limg:'upload', name, mime, b64}  ->  {ok, url, id, bytes} */
function limgUpload_(p) {
  var mime = String(p.mime || '').toLowerCase();
  if (!/^image\/(jpeg|png|tiff|gif)$/.test(mime)) return { ok: false, error: 'Amazon takes JPEG, PNG, TIFF or GIF.' };
  var bytes = Utilities.base64Decode(String(p.b64 || ''));
  if (!bytes.length) return { ok: false, error: 'The file was empty.' };
  if (bytes.length > 10 * 1024 * 1024) return { ok: false, error: 'Amazon refuses images over 10 MB.' };
  var name = String(p.name || 'image').replace(/[^\w.\- ]+/g, '_').slice(0, 80);
  var ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/tiff': '.tif', 'image/gif': '.gif' }[mime];
  if (!/\.\w{3,4}$/.test(name)) name += ext;
  var file = limgFolder_().createFile(Utilities.newBlob(bytes, mime, name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, id: file.getId(), url: limgDriveUrl_(file.getId()), bytes: bytes.length };
}

/* ---------- editor checks ---------- */

/** Run once in the editor so Google grants Drive access to the web app. */
function authorizeDrive() {
  var f = limgFolder_();
  Logger.log('Upload folder: ' + f.getName() + ' — ' + f.getUrl());
}

/** Does the role exist? Reads one real listing per brand and prints Amazon's own answer. */
function limgTest() {
  ['SP', 'CPC'].forEach(function (b) {
    setBrand_(b);
    var m = skuAsinMap_().map || {};
    var ks = Object.keys(m);
    var r = ks.length ? limgGet_({ brand: b, asin: m[ks[0]] }) : { ok: false, error: 'no SKU in the Catalog tab' };
    Logger.log(b + ': ' + JSON.stringify(r).slice(0, 1500));
  });
}

/**
 * GET ?limg=page&brand=&token=&pages=N  — the whole catalogue of this seller, 20 listings a page,
 * with each one's image slots, parent and variation facts. Walks up to `pages` pages per call (time
 * bounded) and hands back the next token, so the browser can drive the full walk.
 */
function limgPage_(p) {
  setBrand_(p.brand);
  var seller;
  try { seller = limgSeller_(''); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  var token = String(p.token || ''), maxPages = Math.min(Number(p.pages) || 10, 40);
  /* AMAZON STOPS A SEARCH AT 1,000 RESULTS (found 9 Oct: both brands came back as exactly 1,000 of
   * 2,677 and 1,715). So the caller walks CREATED-DATE WINDOWS small enough to stay under it;
   * `count=1` asks only how many a window holds. Sorted by SKU so a listing edited mid-walk cannot
   * move between pages. */
  var win = (p.after ? '&createdAfter=' + encodeURIComponent(p.after) : '') +
    (p.before ? '&createdBefore=' + encodeURIComponent(p.before) : '');
  if (p.count) {
    var c = limgSp_('/listings/2021-08-01/items/' + seller + '?marketplaceIds=' + marketplaceId_() +
      '&includedData=summaries&pageSize=1' + win, 'get');
    if (c.code >= 300) return limgErr_(c, 'Counting listings');
    return { ok: true, total: c.body.numberOfResults };
  }
  var t0 = Date.now(), items = [], pages = 0, total = null;
  while (pages < maxPages && Date.now() - t0 < 40000) {
    var path = '/listings/2021-08-01/items/' + seller + '?marketplaceIds=' + marketplaceId_() +
      '&includedData=summaries,attributes&pageSize=20&sortBy=sku&sortOrder=ASC' + win +
      (token ? '&pageToken=' + encodeURIComponent(token) : '');
    var r = limgSp_(path, 'get');
    if (r.code >= 300) { var bad = limgErr_(r, 'Listing page'); bad.items = items; bad.next = token; return bad; }
    if (total == null) total = r.body.numberOfResults;
    var got = (r.body.items || []).map(limgShape_);
    limgLiveAdd_(got);
    items = items.concat(got);
    pages++;
    token = (r.body.pagination && r.body.pagination.nextToken) || '';
    if (!token) break;
  }
  return { ok: true, items: items, next: token, total: total, pages: pages };
}

function limgShape_(it) {
  var s = (it.summaries && it.summaries[0]) || {}, at = it.attributes || {};
  var one = function (k, f) { var v = at[k]; return v && v[0] ? (f ? v[0][f] : v[0].value) : ''; };
  var img = {};
  LIMG_SLOTS.forEach(function (slot) {
    var v = at[LIMG_ATTR[slot]];
    if (v && v[0] && v[0].media_location) img[slot] = v[0].media_location;
  });
  var rel = at.child_parent_sku_relationship && at.child_parent_sku_relationship[0];
  return {
    sku: it.sku, asin: s.asin || '', st: (s.status || []).join(','), pt: s.productType || '',
    t: String(s.itemName || '').slice(0, 160), main: s.mainImage ? s.mainImage.link : '',
    lvl: one('parentage_level'), psku: rel ? (rel.parent_sku || '') : '',
    c: one('color'), z: one('size'), img: img,
  };
}

/**
 * What shoppers actually see, added to each shaped listing as `live` (slot -> url) and `pa` (parent
 * ASIN). The listing's own attributes are what WE submitted; the catalogue can differ (another
 * contributor, a change still processing), and on 9 Oct it did: R-CP-351 submitted one MAIN while
 * Amazon showed a picture shared with another colour. Only the catalogue answers "what is live".
 */
function limgLiveAdd_(list) {
  var asins = [];
  list.forEach(function (x) { if (/^[A-Z0-9]{10}$/.test(x.asin) && asins.indexOf(x.asin) < 0) asins.push(x.asin); });
  if (!asins.length) return;
  var r = limgSp_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() + '&identifiers=' + asins.join(',') +
    '&identifiersType=ASIN&pageSize=20&includedData=images,relationships', 'get');
  if (r.code >= 300) { list.forEach(function (x) { x.liveErr = 'catalogue ' + r.code; }); return; }
  var by = {};
  (r.body.items || []).forEach(function (it) {
    var slots = {}, best = {};
    ((it.images && it.images[0] && it.images[0].images) || []).forEach(function (im) {
      if (!im || !im.variant || !im.link) return;
      var w = Number(im.width) || 0;
      if (!best[im.variant] || w > best[im.variant]) { best[im.variant] = w; slots[im.variant] = im.link; }
    });
    var pa = '';
    ((it.relationships && it.relationships[0] && it.relationships[0].relationships) || []).forEach(function (rel) {
      if (rel.parentAsins && rel.parentAsins.length) pa = rel.parentAsins[0];
    });
    by[it.asin] = { live: slots, pa: pa };
  });
  list.forEach(function (x) {
    var b = by[x.asin];
    if (b) { x.live = b.live; x.pa = b.pa; } else if (x.asin) x.liveErr = 'not in catalogue';
  });
}
