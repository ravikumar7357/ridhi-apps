/* Pricing-API / ReplSnap.gs — the Replenish app's snapshot, built from FabriCrush Inventory (added 2026-10-25).
 *
 * Ravi, 25 Oct: "abhi jo inventory google sheet se aati h usase data na lekar is firebase app se lena h and sab jagah auto
 * karna h manual kuch nahi". Until now the Replenish app pressed "Refresh from sheet": the Ridhi sheet's script
 * (Repl-API/Code.js replReadInv_) read the Inventory / India Stock / Shipments / Catalog tabs and the _hist_ year history,
 * worked out the replenishment figures, and the BROWSER saved them. Now the same figures are worked out HERE, from what
 * InvSync.gs keeps in the fabricrush-inventory project (inv / ship / cat / ord sets), and written straight into the
 * Replenish app's Firestore (price-research-48ff3) in the very shape the browser wrote — repl + replrows (full),
 * replslim + replslimrows, replshop + replshoprows — after every inventory refresh (step `repl`, InvSync's schedule).
 *
 * The maths is replReadInv_'s, line for line (category, out-of-stock correction, 90/120/150 keep-level ladder netted by a
 * forward projection, AWD transfer flag, inflow summary). Two inputs differ:
 *   - the India listing status is no longer read here: it lives in the Master Database (Ravi, 25 Oct: "master data base me
 *     set karenge") and the app applies it, as it already applies the manual status override. Only the "listed on Amazon,
 *     not stocked in India" sub-categories are stopped here, as before;
 *   - the year history is built from the stored orders (ord/<B>_<YYYY-MM>) instead of the _hist_ tab, kept a day in
 *     work/replhist_<B>.
 */

var REPL_SNAP = {
  proj: 'price-research-48ff3',
  chunk: 700, slimChunk: 2500, shopChunk: 1500,
  slimFields: ['sku', 'category', 'subcat', 'color', 'size', 'totalStock', 'awdAvail', 'awdTransit', 'last90', 'last30', 'asin', 'parent'],
  shopFields: ['sku', 'image', 'asin', 'parent', 'color', 'size', 'subcat', 'status', 'warehouse', 'fulfillable'],
  histMaxMs: 20 * 3600 * 1000,
  awdFallbackDays: 80,
};
var REPL_SNAP_STOP_SUBCATS = /^\s*(women|dress(es)?)\s*$/i;

/* ---------- Firestore of the Replenish app, typed values (the browser reads these as plain objects) ---------- */
function rsBase_() { return 'https://firestore.googleapis.com/v1/projects/' + REPL_SNAP.proj + '/databases/(default)/documents'; }
function rsName_(path) { return 'projects/' + REPL_SNAP.proj + '/databases/(default)/documents/' + path; }
function rsVal_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!isFinite(v)) return { nullValue: null };
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(rsVal_) } };
  if (v && v.__ts) return { timestampValue: new Date(v.__ts).toISOString() };
  var f = {};
  Object.keys(v).forEach(function (k) { if (v[k] !== undefined) f[k] = rsVal_(v[k]); });
  return { mapValue: { fields: f } };
}
function rsPutW_(path, obj) {
  var f = {};
  Object.keys(obj).forEach(function (k) { if (obj[k] !== undefined) f[k] = rsVal_(obj[k]); });
  return { update: { name: rsName_(path), fields: f } };
}
function rsCommit_(writes) {
  var batch = [], bytes = 0;
  function flush() {
    if (!batch.length) return;
    var r = invFetch_(rsBase_() + ':commit', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ writes: batch }) });
    if (r.getResponseCode() >= 300) throw new Error('Replenish Firestore ' + r.getResponseCode() + ' writing: ' + r.getContentText().slice(0, 300));
    batch = []; bytes = 0;
  }
  writes.forEach(function (w) {
    var n = JSON.stringify(w).length;
    if (batch.length >= 400 || bytes + n > 8000000) flush();
    batch.push(w); bytes += n;
  });
  flush();
}
/** The chunk count a header document holds now (to delete the chunks a smaller snapshot no longer uses). */
function rsChunksNow_(path) {
  var r = invFetch_(rsBase_() + '/' + path);
  if (r.getResponseCode() !== 200) return 0;
  var f = (JSON.parse(r.getContentText() || '{}').fields || {}).chunks;
  return f ? Number(f.integerValue || f.doubleValue || 0) : 0;
}

/* ---------- inputs ---------- */
function rsNum_(v) { var f = parseFloat(String(v == null ? '' : v).replace(/[, ]/g, '')); return isNaN(f) ? 0 : f; }
function rsRecYM_(label) {
  var m = String(label).match(/([A-Za-z]{3})\s*'?(\d{2})/);
  if (!m) return null;
  var ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var mi = ABBR.indexOf(m[1].toLowerCase());
  if (mi < 0) return null;
  return (2000 + parseInt(m[2], 10)) + '-' + (mi + 1 < 10 ? '0' : '') + (mi + 1);
}
function rsDaysToMonth_(ym, nowMs) { var p = ym.split('-'); return Math.round((Date.UTC(Number(p[0]), Number(p[1]) - 1, 1) - nowMs) / 86400000); }
function rsProjShort_(immediate, ads, arrivals, target) {
  if (!(ads > 0)) return 0;
  var evts = (arrivals || []).filter(function (x) { return x.day > 0 && x.day <= target; }).sort(function (a, b) { return a.day - b.day; });
  var onHand = immediate, day = 0, minOnHand = immediate;
  for (var k = 0; k < evts.length; k++) {
    onHand -= ads * (evts[k].day - day);
    if (onHand < minOnHand) minOnHand = onHand;
    onHand += evts[k].qty;
    day = evts[k].day;
  }
  onHand -= ads * (target - day);
  if (onHand < minOnHand) minOnHand = onHand;
  return minOnHand < 0 ? Math.round(-minOnHand) : 0;
}

/** The year history per SKU from the stored orders — { sku: {flat, recon, months, lastMs} } — cached a day. */
function rsHist_(b, force) {
  var cached = invGet_('work/replhist_' + b);
  if (!force && cached && cached.at && Date.now() - cached.at < REPL_SNAP.histMaxMs && cached.map) return { map: cached.map, diag: cached.diag || {} };
  var summary = invGet_('idx/ord_' + b) || { months: {} }, yearAgo = Date.now() - 365 * 86400000;
  var fromYM = Utilities.formatDate(new Date(yearAgo), 'UTC', 'yyyy-MM');
  var total = {}, byMonth = {}, lastMs = {}, scanned = 0;
  Object.keys(summary.months || {}).filter(function (ym) { return ym >= fromYM; }).sort().forEach(function (ym) {
    invReadSet_('ord', b + '_' + ym, 'ord_' + b + '_' + ym).rows.forEach(function (r) {
      scanned++;
      var sku = String(r[3] || '').trim(); if (!sku) return;
      if (r[9] === 1 || String(r[9]).toUpperCase() === 'MCF') return;            // MCF is 1 here ('MCF' in the old sheet)
      if (String(r[7] || '').toLowerCase() === 'cancelled') return;
      var units = Number(r[5]) || 0; if (!units) return;
      var dMs = Date.parse(r[1]) || Date.parse(String(r[2] || '') + 'T12:00:00Z') || 0;
      if (!dMs || dMs < yearAgo) return;
      total[sku] = (total[sku] || 0) + units;
      if (!lastMs[sku] || dMs > lastMs[sku]) lastMs[sku] = dMs;
      var mk = String(r[2] || '').slice(0, 7) || Utilities.formatDate(new Date(dMs), 'Asia/Kolkata', 'yyyy-MM');
      (byMonth[sku] = byMonth[sku] || {})[mk] = 1;
    });
  });
  var map = {};
  Object.keys(total).forEach(function (s) {
    var months = Object.keys(byMonth[s] || {}).length;
    map[s] = { flat: total[s] / 365, recon: months > 0 ? total[s] / (months * 30.4) : 0, months: months, lastMs: lastMs[s] || 0 };
  });
  var diag = { cached: false, builtAt: new Date().toISOString(), scanned: scanned, skus: Object.keys(map).length, ordersAt: summary.at || 0 };
  try { invPut_('work/replhist_' + b, { at: Date.now(), map: map, diag: diag }); } catch (e) { /* the next run builds it again */ }
  return { map: map, diag: diag };
}

/** One brand's replenishment rows — replReadInv_'s result, from the stored sets. */
function replSnapRows_(b, debugSku) {
  var inv = invReadSet_('inv', b, 'inv_' + b);
  if (!inv.idx || !inv.rows.length) throw new Error('no inventory stored for ' + b + ' yet');
  var cols = inv.idx.cols || [], ix = {};
  cols.forEach(function (h, i) { ix[String(h).toLowerCase()] = i; });
  function get(row, names) { for (var i = 0; i < names.length; i++) { var k = names[i].toLowerCase(); if (ix[k] !== undefined) return row[ix[k]]; } return ''; }
  var recCols = cols.filter(function (h) { return /rec\.?\s*$/i.test(String(h).trim()) && !/^rec/i.test(String(h).trim()); });
  var set = invSettings_(), now = Date.now(), DAY = 86400000;
  var dbg = debugSku ? String(debugSku).trim().toUpperCase() : '';

  var out = [];
  inv.rows.forEach(function (row) {
    var sku = String(get(row, ['sku'])).trim();
    if (!sku || sku.toUpperCase() === 'TOTAL' || sku.toLowerCase().indexOf('amzn') === 0) return;
    var rec = {};
    recCols.forEach(function (h) { rec[h] = rsNum_(row[ix[h.toLowerCase()]]); });
    var subcatV = String(get(row, ['sub-category', 'sub category'])).trim();
    var stopSub = REPL_SNAP_STOP_SUBCATS.test(subcatV);
    out.push({
      sku: sku, image: String(get(row, ['image']) || ''),
      status: stopSub ? 'Discontinued' : '', stopped: stopSub, stopReason: stopSub ? ('"' + subcatV + '" is listed on Amazon but not stocked in India') : '',
      asin: String(get(row, ['asin'])).trim(), parent: String(get(row, ['parent asin'])).trim(),
      color: String(get(row, ['color'])).trim(), size: String(get(row, ['size'])).trim(), subcat: subcatV,
      totalStock: rsNum_(get(row, ['total stock'])), warehouse: rsNum_(get(row, ['warehouse'])), fulfillable: rsNum_(get(row, ['fulfillable'])),
      unsellable: rsNum_(get(row, ['unsellable'])), resOrders: rsNum_(get(row, ['reserved_orders', 'reserved orders'])),
      inbReceiving: rsNum_(get(row, ['inbound_receiving', 'inbound receiving'])),
      awdAvail: rsNum_(get(row, ['awd available'])), awdTransit: rsNum_(get(row, ['awd transit'])),
      rec: rec,
      last30: rsNum_(get(row, ['last 30 days'])), last90: rsNum_(get(row, ['last 90 days'])), l90amt: rsNum_(get(row, ['last 90 days $'])),
      airDos: rsNum_(get(row, ['air dos'])), airQty: rsNum_(get(row, ['air qty'])), airIndia: 0,
      seaDos: rsNum_(get(row, ['sea dos'])), seaQty: rsNum_(get(row, ['sea qty'])), seaIndia: 0,
    });
  });

  var H0 = rsHist_(b), hist = H0.map, histEnd = 0;
  Object.keys(hist).forEach(function (k) { if (hist[k] && hist[k].lastMs > histEnd) histEnd = hist[k].lastMs; });
  var histCurrent = histEnd > 0 && (now - histEnd) <= 3 * DAY;
  var histDiag = Object.assign({}, H0.diag, { histEnd: histEnd ? new Date(histEnd).toISOString() : '', histCurrent: histCurrent, source: 'fabricrush-inventory orders' });
  var curYM = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM');

  // AWD transit arrivals with their real days, from the STAR-* shipments (InvSync keeps ETA / ship date as ms)
  var awdArr = {};
  invReadSet_('ship', b, 'ship_' + b).rows.forEach(function (r) {
    var sku = String(r[4] || '').trim(), qty = Number(r[5]) || 0;
    if (!sku || !qty) return;
    if (!/^\s*STAR-/i.test(String(r[9] || '')) && !/^\s*STAR-/i.test(String(r[3] || ''))) return;
    var eta = Number(r[1]) || (Number(r[0]) ? Number(r[0]) + REPL_SNAP.awdFallbackDays * DAY : 0);
    if (!eta) return;
    (awdArr[sku] = awdArr[sku] || []).push({ day: Math.max(0, Math.round((eta - now) / DAY)), qty: qty });
  });
  Object.keys(awdArr).forEach(function (s) { awdArr[s].sort(function (x, y) { return x.day - y.day; }); });

  out.forEach(function (o) {
    var ads30 = (o.last30 || 0) / 30, ads90 = (o.last90 || 0) / 90;
    var price = (o.last90 || 0) > 0 ? (o.l90amt || 0) / o.last90 : 0;
    var monthlyAmt = Math.max((o.last30 || 0) * price, (o.l90amt || 0) / 3);
    var cat, a, H = hist[o.sku] || { flat: 0, recon: 0, months: 0 };
    o.avgHist = false; o.oosLong = false;
    if (ads30 <= 0 && ads90 <= 0) { cat = 'D'; a = Math.max(H.recon, H.flat); o.avgHist = true; }
    else if (monthlyAmt >= 3000) { cat = 'A'; a = Math.max(ads30, ads90); }
    else if (monthlyAmt >= 1500) { cat = 'B'; a = Math.max(ads30, ads90); }
    else { cat = 'C'; a = ads90; }
    var oosNow = !(o.totalStock > 0) && !(o.awdAvail > 0);
    o.inStockDays = null; o.oosYear = false;
    if (oosNow) {
      var daysSince = histCurrent && H.lastMs ? Math.floor((now - H.lastMs) / DAY) : null;
      var longOut = ads30 <= 0 && (daysSince === null || daysSince >= 30);
      if (longOut) {
        if (H.months > 0 && H.recon > 0) {
          a = H.recon; o.avgHist = true; o.oosLong = true; o.oosYear = true;
          o.yrUnits = Math.round((H.flat || 0) * 365); o.yrMonths = H.months;
          if (daysSince !== null) o.oosDays = daysSince;
        }
      } else if (daysSince !== null && daysSince < 30 && (o.last90 || 0) > 0) {
        var inDays = 90 - daysSince, vel = o.last90 / inDays;
        if (vel > a) { a = vel; o.avgHist = true; o.oosLong = true; o.inStockDays = inDays; o.oosDays = daysSince; }
      }
    }
    o.category = cat; o.monthlyAmt = Math.round(monthlyAmt); o.avgSale = Math.round(a * 100) / 100;

    var pipe = (o.totalStock || 0) + (o.awdAvail || 0) + (o.awdTransit || 0) - (o.unsellable || 0) - (o.resOrders || 0);
    var run = o.avgSale || 0, dos = run > 0 ? pipe / run : null;
    var excluded = /lamp ?shade|quilt|chair ?pad|seat ?cushion|insert/i.test(String(o.subcat || ''));
    var imm = (o.warehouse || 0) + (o.inbReceiving || 0) + (o.awdAvail || 0), arr = [], recThisMonth = 0, futureRec = [];
    Object.keys(o.rec || {}).forEach(function (label) {
      var q = o.rec[label]; if (!q) return;
      var ym = rsRecYM_(label); if (!ym) return;
      if (ym === curYM) { imm += q; recThisMonth += q; }
      else if (ym > curYM) {
        var day = rsDaysToMonth_(ym, now);
        arr.push({ day: day, qty: q });
        if (day <= 150) futureRec.push({ l: String(label).replace(/\s*rec\.?\s*$/i, '').trim(), q: q, d: day });
      }
    });
    var tLeft = o.awdTransit || 0, awdSoonDay = null;
    if (tLeft > 0) {
      (awdArr[o.sku] || []).forEach(function (s) {
        if (tLeft <= 0) return;
        var q = Math.min(s.qty, tLeft);
        arr.push({ day: s.day, qty: q });
        if (awdSoonDay === null) awdSoonDay = s.day;
        tLeft -= q;
      });
      if (tLeft > 0) { arr.push({ day: REPL_SNAP.awdFallbackDays, qty: tLeft }); if (awdSoonDay === null) awdSoonDay = REPL_SNAP.awdFallbackDays; }
    }
    var month = Math.round(30 * run);
    var s90 = rsProjShort_(imm, run, arr, 90), s120 = rsProjShort_(imm, run, arr, 120), s150 = rsProjShort_(imm, run, arr, 150);
    var airReq = 0, seaReq = 0, awdReq = 0;
    if (dos !== null && dos < 150) {
      if (dos < 90) {
        if (excluded) { seaReq = s120; }
        else { airReq = s90; seaReq = Math.min(Math.max(0, s120 - s90), month); }
      } else if (dos < 120) { seaReq = Math.min(s120, month); }
      else { awdReq = Math.min(s150, month); }
    }
    o.decision = airReq > 0 && seaReq > 0 ? 'Air+Sea' : airReq > 0 ? 'Air' : seaReq > 0 ? 'Sea' : awdReq > 0 ? 'AWD' : 'OK';
    var fbaSide = (o.warehouse || 0) + (o.inbReceiving || 0);
    o.awdTransfer = (o.awdAvail || 0) > 0 && run > 0 && fbaSide < 30 * run;
    o.coverDos = dos === null ? null : Math.round(dos);
    o.airExcluded = excluded;
    o.airReq = airReq; o.seaReq = seaReq; o.awdReq = awdReq;
    o.inflow = { m: recThisMonth, awd: o.awdTransit || 0, awdDay: awdSoonDay, fut: futureRec };
    if (dbg && String(o.sku).toUpperCase() === dbg) o._dbg = { ads: run, pipe: pipe, coverDos: o.coverDos, immediate: imm, arrivals: arr, s90: s90, s120: s120, s150: s150, month: month, excluded: excluded };
  });

  var catalogSkus = [], seen = {};
  invReadSet_('cat', b, 'cat_' + b).rows.forEach(function (r) { var s = String(r[0] || '').trim().toUpperCase(); if (s && !seen[s]) { seen[s] = 1; catalogSkus.push(s); } });
  return { rows: out, recCols: recCols, catalogSkus: catalogSkus, histDiag: histDiag, invAt: inv.idx.at || 0,
    stoppedN: out.filter(function (o) { return o.stopped; }).length };
}

/** Write the three copies into the Replenish app's Firestore, the way saveReplCache / saveReplSlim / saveReplShop did. */
function replSnapWrite_(b, d) {
  var rows = d.rows, at = { __ts: Date.now() }, dataAt = { __ts: d.invAt || Date.now() }, writes = [];
  function chunked(coll, list, size, oldN) {
    var n = Math.ceil(list.length / size) || 1;
    for (var i = 0; i < n; i++) writes.push(rsPutW_(coll + '/' + b + '_' + i, { r: list.slice(i * size, (i + 1) * size) }));
    for (var j = n; j < oldN; j++) writes.push({ 'delete': rsName_(coll + '/' + b + '_' + j) });
    return n;
  }
  var pick = function (fields) { return function (r) { var o = {}; fields.forEach(function (k) { if (r[k] != null && r[k] !== '') o[k] = r[k]; }); return o; }; };
  var slim = rows.map(function (r) { var o = {}; REPL_SNAP.slimFields.forEach(function (k) { if (r[k] != null) o[k] = r[k]; }); return o; });
  var shop = rows.map(pick(REPL_SNAP.shopFields)), ful = {};
  shop.forEach(function (r) { if (r.sku) ful[r.sku] = Number(r.fulfillable) || 0; });
  var nFull = chunked('replrows', rows, REPL_SNAP.chunk, rsChunksNow_('repl/' + b));
  var nSlim = chunked('replslimrows', slim, REPL_SNAP.slimChunk, rsChunksNow_('replslim/' + b));
  var nShop = chunked('replshoprows', shop, REPL_SNAP.shopChunk, rsChunksNow_('replshop/' + b));
  rsCommit_(writes);                                   // the rows first, the headers after — a reader never sees a header ahead of its rows
  rsCommit_([
    rsPutW_('repl/' + b, { chunks: nFull, n: rows.length, recCols: d.recCols || [], catalogSkus: d.catalogSkus || [], rows: null, at: at,
      source: 'fabricrush-inventory', histDiag: d.histDiag || {} }),
    rsPutW_('replslim/' + b, { chunks: nSlim, n: slim.length, catalogSkus: d.catalogSkus || [], at: at }),
    rsPutW_('replshop/' + b, { chunks: nShop, n: shop.length, at: at, dataAt: dataAt, ful: ful }),
  ]);
  return { full: nFull, slim: nSlim, shop: nShop };
}

/** Step `repl` of an InvSync job: one brand's snapshot, built and written. */
INV_STEPS.repl = function (b, st, deadline) {
  var d = replSnapRows_(b);
  var w = replSnapWrite_(b, d);
  return { done: true, msg: d.rows.length + ' SKUs to the Replenish app (' + w.full + ' + ' + w.slim + ' + ' + w.shop + ' docs)'
    + (d.histDiag.histCurrent === false ? ' · year history ends ' + String(d.histDiag.histEnd || '?').slice(0, 10) : '') };
};
INV_STEP_LABEL.repl = 'Replenish snapshot';

/** Editor helper: build one brand without writing, and log a few rows — to compare with the sheet's figures. */
function replSnapDryRun() {
  ['SP', 'CPC'].forEach(function (b) {
    var d = replSnapRows_(b);
    Logger.log(b + ': ' + d.rows.length + ' rows, ' + d.catalogSkus.length + ' catalogue SKUs, history ' + JSON.stringify(d.histDiag));
    Logger.log(JSON.stringify(d.rows.slice(0, 3)));
  });
}
