/* Pricing-API / SkuPictures.gs — pictures for a SKU (?imgsku=).
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== Pictures for a SKU =====================
 *
 * Orders that arrive by IMPORT (CPC Shopify, the Etsy shops) carry no product ids, so the Shopify
 * image lookup cannot help them — and the photo is the thing a packer actually reads. So the picture
 * is found from the SKU instead: SKU -> ASIN out of the seller's own Catalog tab, then ASIN -> image
 * from the catalogue API, the same call the deal planner already uses.
 *
 * Resolved ONCE, at import, and stored on the line. Doing it per render would mean twenty catalogue
 * calls every time somebody opened the tab.
 */
function skuAsinMap_() {
  var out = {}, diag = [];
  ['SP', 'CPC'].forEach(function (brand) {
    var id = (brand === 'CPC') ? CPC_SHEET_ID : RIDHI_SHEET_ID;
    var tab = (brand === 'CPC') ? 'CPC Catalog' : 'Catalog';
    var note = { brand: brand, tab: tab, n: 0 };
    diag.push(note);
    try {
      var ss = SpreadsheetApp.openById(id);
      var sh = ss.getSheetByName(tab);
      if (!sh) {
        note.error = 'no tab named "' + tab + '"';
        note.tabsSeen = ss.getSheets().map(function (x) { return x.getName(); }).slice(0, 25);
        return;
      }
      if (sh.getLastRow() < 2) { note.error = 'that tab is empty'; return; }
      var rows = sh.getRange(1, 1, sh.getLastRow(), Math.min(sh.getLastColumn(), 12)).getValues();
      // BY NAME, not by position. This sheet is maintained by hand and a column inserted in front of
      // ASIN would otherwise start returning the wrong identifier — which fails silently, because a
      // wrong ASIN just yields no picture rather than an error.
      //
      // And the header row is FOUND, not assumed to be row 1. The India workbook taught that one:
      // it opens with a totals strip, and reading row 1 as the header there gave an empty map that
      // was indistinguishable from real emptiness. A hand-kept Catalog tab can do the same.
      var scan = Math.min(rows.length, 10), hr = -1, iSku = -1, iAsin = -1;
      for (var h = 0; h < scan; h++) {
        var head = rows[h].map(function (c) { return String(c).trim().toLowerCase(); });
        var hs = head.indexOf('sku'), ha = head.indexOf('asin');
        if (hs >= 0 && ha >= 0) { hr = h; iSku = hs; iAsin = ha; break; }
      }
      if (hr < 0) {
        note.error = 'no row in the first ' + scan + ' carries both a "SKU" and an "ASIN" column';
        note.row1 = rows[0].map(function (c) { return String(c).slice(0, 20); });
        return;
      }
      note.headerRow = hr + 1;
      var noAsin = 0;
      for (var r = hr + 1; r < rows.length; r++) {
        var sku = String(rows[r][iSku] || '').trim().toUpperCase();
        if (!sku) continue;
        var asin = String(rows[r][iAsin] || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{10}$/.test(asin)) { noAsin++; continue; }
        if (!out[sku]) { out[sku] = asin; note.n++; }
      }
      if (noAsin) note.noAsin = noAsin;
    } catch (e) {
      // Still not fatal — the other brand may answer — but it is now SAID, not swallowed.
      note.error = 'cannot open that workbook: ' + (e.message || e);
    }
  });
  return { map: out, diag: diag };
}

/** sku -> image URL, for as many of the given SKUs as the catalogue can answer for. */
function skuImages_(skusCsv) {
  var want = String(skusCsv || '').split(',').map(function (x) { return x.trim().toUpperCase(); })
    .filter(Boolean);
  if (!want.length) return { ok: true, n: 0, asked: 0, d: {} };
  var cat = skuAsinMap_(), map = cat.map;
  var asinOf = {}, asins = [], miss = [];
  want.forEach(function (sku) {
    var a = map[sku];
    if (a) { asinOf[sku] = a; if (asins.indexOf(a) < 0) asins.push(a); }
    else miss.push(sku);
  });
  var imgOf = {}, hurt = 0;
  // Twenty at a time: the catalogue call rejects the whole batch past that.
  for (var i = 0; i < asins.length; i += 20) {
    var chunk = asins.slice(i, i + 20);
    try {
      var r = lhImages_(chunk.join(','));
      var got = (r && (r.d || r.imgs || r.images)) || {};
      Object.keys(got).forEach(function (a) { if (got[a]) imgOf[a] = got[a]; });
    } catch (e) { hurt++; /* one bad chunk must not cost the rest — but it is counted */ }
    if (i + 20 < asins.length) Utilities.sleep(300);
  }
  var out = {};
  want.forEach(function (sku) { var a = asinOf[sku]; if (a && imgOf[a]) out[sku] = imgOf[a]; });
  var res = { ok: true, n: Object.keys(out).length, asked: want.length, d: out, diag: cat.diag };
  // A picture that does not arrive is an empty box, and an empty box reads as "this product has no
  // photo" — not as "the lookup never worked". So anything short of a full answer says why.
  if (res.n < want.length) res.why = skuImgWhy_(cat.diag, miss, asins.length, Object.keys(imgOf).length, hurt);
  return res;
}

/** One sentence a person can act on, built out of what the lookup actually met on the way. */
function skuImgWhy_(diag, miss, nAsin, nImg, hurt) {
  var say = [], broken = [], pairs = 0;
  diag.forEach(function (d) {
    pairs += d.n;
    if (d.error) broken.push(d.tab + ': ' + d.error);
  });
  if (!pairs) {
    say.push('The Catalog tabs gave no SKU \u2192 ASIN pairs at all' +
      (broken.length ? ' \u2014 ' + broken.join('; ') : '') + '.');
  } else {
    if (broken.length) say.push(broken.join('; ') + '.');
    if (miss.length) say.push(miss.length + ' SKU(s) are not in the Catalog tabs (e.g. ' + miss.slice(0, 5).join(', ') + ').');
    if (nAsin && !nImg) say.push('The catalogue returned no image for any of the ' + nAsin + ' ASIN(s) that were found.');
    else if (nAsin && nImg < nAsin) say.push('The catalogue had no image for ' + (nAsin - nImg) + ' of ' + nAsin + ' ASIN(s).');
  }
  if (hurt) say.push(hurt + ' catalogue batch(es) errored.');
  return say.join(' ');
}

/** Editor check: does the Catalog tab give ASINs, and do those ASINs give pictures? */
function skuImgTest() {
  var cat = skuAsinMap_(), map = cat.map;
  cat.diag.forEach(function (d) {
    Logger.log('tab "' + d.tab + '" (' + d.brand + '): ' + d.n + ' pair(s)' +
      (d.headerRow ? ', header on row ' + d.headerRow : '') +
      (d.noAsin ? ', ' + d.noAsin + ' row(s) with a SKU but no valid ASIN' : '') +
      (d.error ? '  \u2192 ' + d.error : ''));
    if (d.tabsSeen) Logger.log('    tabs in that workbook: ' + d.tabsSeen.join(' | '));
    if (d.row1) Logger.log('    row 1 reads: ' + d.row1.join(' | '));
  });
  var keys = Object.keys(map);
  Logger.log(keys.length + ' SKU -> ASIN pair(s) in total');
  if (!keys.length) return;
  var sample = keys.slice(0, 5);
  Logger.log('  e.g. ' + sample.map(function (k) { return k + ' -> ' + map[k]; }).join(' \u00b7 '));
  var r = skuImages_(sample.join(','));
  Logger.log('pictures: ' + r.n + ' of ' + r.asked + (r.why ? '  \u2192 ' + r.why : ''));
  Object.keys(r.d).forEach(function (k) { Logger.log('   ' + k + ': ' + String(r.d[k]).slice(0, 90)); });
}

/* ===================== A share page → the picture on it (19 Oct 2026) =====================
 *
 * A B2B order sheet came with kommodo.ai/i/<id> links. Those open a web page with the picture on it, and a page cannot
 * be drawn as a picture; the browser cannot read the page either (no CORS). So the page is read here and the picture's
 * own address handed back. Only the hosts named below are fetched — this is not a general fetcher.
 *   ?piclinks=url1|url2|…   (at most 60)   →   { d: { url: pictureUrl }, n }
 * kommodo: the page carries https://<x>.komododecks.com/<YYYYMM>/<DD>/<id>/image.jpg (its og:image is the site's own logo,
 * so it is not used). imgur / ibb: the page's og:image is the picture.
 */
function pictureLinks_(list) {
  var urls = String(list || '').split('|').map(function (s) { return s.trim(); })
    .filter(function (s) { return /^https:\/\/(www\.)?(kommodo\.ai\/i\/|imgur\.com\/|ibb\.co\/)/i.test(s); }).slice(0, 60);
  var out = {};
  if (!urls.length) return { d: out, n: 0 };
  var res = UrlFetchApp.fetchAll(urls.map(function (u) {
    return { url: u, muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0' } };
  }));
  res.forEach(function (r, i) {
    var u = urls[i], html = '';
    try { html = r.getResponseCode() === 200 ? r.getContentText() : ''; } catch (e) { html = ''; }
    if (!html) return;
    var id = (u.match(/kommodo\.ai\/i\/([A-Za-z0-9_-]+)/i) || [])[1], pic = '';
    if (id) {
      var m = html.match(new RegExp('https://[a-z0-9-]+\\.komododecks\\.com/\\d{6}/\\d{2}/' + id + '/image\\.(?:jpg|jpeg|png|webp)'));
      pic = m ? m[0] : '';
    } else {
      var og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      pic = og ? og[1] : '';
    }
    if (/^https:\/\//i.test(pic)) out[u] = pic;
  });
  return { d: out, n: Object.keys(out).length };
}
