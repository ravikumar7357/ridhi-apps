/* Pricing-API / InvSync.gs — the FabriCrush Inventory app's backend (added 2026-10-24).
 *
 * Replaces the four inventory workbooks (Ridhi main, CPC main, Ridhi Order, CPC Orders) with
 * Firestore in the SEPARATE Firebase project `fabricrush-inventory`. Amazon is called from here
 * because the SP-API keys live in this script's properties; nothing is written to any sheet.
 *
 * Same rules as the sheets (Repl-API/Code.js), plus Ravi's four changes of 24 Oct:
 *   1. the Catalog's hand-typed values are copied from the sheets ONCE (invSeed_), and a value
 *      already held always wins over Amazon's, exactly like the sheet's preserve();
 *   2. a Checked In shipment is counted once: its units already in inbound_receiving are not
 *      added to the monthly Rec. again;
 *   3. a failed FBA inventory page is retried, and if it still fails the run stops and the old
 *      figures stay — never a page of zeros;
 *   4. a shipment whose name has no date takes its created date (AWD) or the date we first saw it.
 *
 * Everything runs as small resumable STEPS (Apps Script stops a run at 6 minutes):
 *   ord  — rolling orders: last 20 days, block-replaced, Order ID + SKU de-duplicated
 *   hist — full order history from 2025-01-01, 29 days per Amazon report
 *   ship — inbound shipments (classic v0, last 5 months) + AWD STAR-* shipments
 *   inv  — FBA + AWD inventory, sales buckets, monthly Rec., Air/Sea plan
 *   cat  — listings + FNSKU + catalogue details for listings we do not know yet
 * A job is a list of steps kept in work/job; invTick runs them until the soft deadline and
 * schedules itself again. The app writes nothing here: it calls ?inv=run and watches meta/status.
 *
 * Firestore layout (every document = { json: <string>, at: <ms> }):
 *   inv/<B>_<i>  ship/<B>_<i>  cat/<B>_<i>  ord/<B>_<YYYY-MM>_<i>   chunked rows
 *   idx/<name>   chunk count + columns + built time for each chunked set (the app listens here)
 *   catedit/<B>  hand edits from the app (sku → {field: value}), applied on top of cat
 *   meta/status  meta/settings  meta/shipseen_<B>   work/job   config/backend   users/<email>
 */

var INV = {
  proj: 'fabricrush-inventory',
  softMs: 4.5 * 60 * 1000,                 // stop starting new work after this
  docBytes: 700000,                        // a chunk is cut at about this many characters
  commitBytes: 6000000,                    // one :commit request stays under this
  ordStart: '2025-01-01',
  ordSyncDays: 20,
  pt: 'America/Los_Angeles',
  shipMonths: 5,
  catNewDays: 90,
  brands: {
    SP:  { key: 'ridhi', label: 'Ridhi', sheet: '1QPTz69Q128OWAm2ewe13jkciXOC9CUfkmVEJMA-iKKo', catTab: 'Catalog' },
    CPC: { key: 'cpc',   label: 'CPC',   sheet: '1UHHVMqUu3Q2vfLQRKvbOnesjvjL_YdKg2KCh-G084fg', catTab: 'CPC Catalog' },
  },
  // Auto schedule (Asia/Kolkata): orders every 6 h; shipments + inventory + the Replenish snapshot every 3 hours (Ravi,
  // 25 Oct: "har 3 ghante" — the old sheets' rhythm); catalogue at 6:00.
  ordEveryMs: 6 * 3600 * 1000,
  invSlots: [0, 3, 6, 9, 12, 15, 18, 21],
  catSlot: 6,
};
var INV_SHIP_KEEP = { WORKING: 'Working', READY_TO_SHIP: 'Ready to Ship', SHIPPED: 'Shipped', IN_TRANSIT: 'In Transit', CHECKED_IN: 'Checked In' };
var INV_AWD_KEEP = { CREATED: 'Created', SHIPPED: 'Shipped' };
var INV_ORD_COLS = ['Order ID', 'Purchase Date/Time', 'Date', 'SKU', 'ASIN', 'Units', 'Revenue', 'Order Status', 'Sales Channel', 'MCF'];
var INV_SHIP_COLS = ['Ship Date', 'ETA', 'Selling Month', 'FBA ID', 'SKU', 'Qty', 'Mode', 'Status', 'Transit Days', 'Shipment Name', 'Date From'];
var INV_CAT_COLS = ['SKU', 'ASIN', 'FNSKU', 'ParentASIN', 'Title', 'Brand', 'ImageURL', 'Color', 'Size', 'Sub Category', 'UpdatedAt', 'Listing Type', 'Parent Title'];
var INV_STEP_LABEL = { ord: 'Orders (last 20 days)', hist: 'Order history', ship: 'Shipments', inv: 'Inventory', cat: 'Catalog' };

/* ===================== Firestore over REST (as the script owner) ===================== */

function invBase_() { return 'https://firestore.googleapis.com/v1/projects/' + INV.proj + '/databases/(default)/documents'; }
function invName_(path) { return 'projects/' + INV.proj + '/databases/(default)/documents/' + path; }
function invFetch_(url, opt) {
  opt = opt || {};
  opt.muteHttpExceptions = true;
  opt.headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  for (var a = 0; a < 3; a++) {
    var r = UrlFetchApp.fetch(url, opt), code = r.getResponseCode();
    if (code < 500 && code !== 429) return r;
    Utilities.sleep(1500 * (a + 1));
  }
  return r;
}
/** One document's json, parsed — null when it does not exist. */
function invGet_(path) {
  var r = invFetch_(invBase_() + '/' + path), code = r.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('Firestore ' + code + ' reading ' + path + ': ' + r.getContentText().slice(0, 200));
  var f = JSON.parse(r.getContentText() || '{}').fields || {};
  return f.json && f.json.stringValue ? JSON.parse(f.json.stringValue) : null;
}
/** Several documents at once → { path: parsed json | null }. */
function invGetMany_(paths) {
  var out = {};
  for (var i = 0; i < paths.length; i += 50) {
    var part = paths.slice(i, i + 50);
    var r = invFetch_(invBase_() + ':batchGet', { method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ documents: part.map(invName_) }) });
    if (r.getResponseCode() >= 300) throw new Error('Firestore ' + r.getResponseCode() + ' batchGet: ' + r.getContentText().slice(0, 200));
    JSON.parse(r.getContentText() || '[]').forEach(function (x) {
      if (x.found) {
        var p = x.found.name.split('/documents/')[1], f = x.found.fields || {};
        out[p] = f.json && f.json.stringValue ? JSON.parse(f.json.stringValue) : null;
      } else if (x.missing) out[x.missing.split('/documents/')[1]] = null;
    });
  }
  return out;
}
function invPutW_(path, obj) {
  var s = JSON.stringify(obj);
  if (s.length > 1040000) throw new Error(path + ' is ' + s.length + ' characters — too big for one document');
  return { update: { name: invName_(path), fields: { json: { stringValue: s }, at: { integerValue: String(Date.now()) } } } };
}
function invDelW_(path) { return { 'delete': invName_(path) }; }
/** Writes in as few requests as fit; each request is all-or-nothing. */
function invCommit_(writes) {
  var batch = [], bytes = 0;
  function flush() {
    if (!batch.length) return;
    var r = invFetch_(invBase_() + ':commit', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ writes: batch }) });
    if (r.getResponseCode() >= 300) throw new Error('Firestore ' + r.getResponseCode() + ' writing: ' + r.getContentText().slice(0, 300));
    batch = []; bytes = 0;
  }
  writes.forEach(function (w) {
    var n = JSON.stringify(w).length;
    if (batch.length >= 400 || bytes + n > INV.commitBytes) flush();
    batch.push(w); bytes += n;
  });
  flush();
  return writes.length;
}
function invPut_(path, obj) { return invCommit_([invPutW_(path, obj)]); }

/** Cut rows into documents of about INV.docBytes characters each. */
function invChunk_(rows) {
  var out = [], cur = [], size = 2;
  rows.forEach(function (r) {
    var n = JSON.stringify(r).length + 1;
    if (cur.length && size + n > INV.docBytes) { out.push(cur); cur = []; size = 2; }
    cur.push(r); size += n;
  });
  if (cur.length || !out.length) out.push(cur);
  return out;
}
/** Replace a chunked set: <coll>/<base>_<i> + idx/<idxName>. Old extra chunks are deleted; idx is written LAST. */
function invWriteSet_(coll, base, idxName, rows, meta) {
  var old = invGet_('idx/' + idxName) || {};
  var chunks = invChunk_(rows), writes = [];
  chunks.forEach(function (c, i) { writes.push(invPutW_(coll + '/' + base + '_' + i, c)); });
  for (var j = chunks.length; j < (old.n || 0); j++) writes.push(invDelW_(coll + '/' + base + '_' + j));
  invCommit_(writes);
  var idx = { n: chunks.length, count: rows.length, at: Date.now() };
  Object.keys(meta || {}).forEach(function (k) { idx[k] = meta[k]; });
  invPut_('idx/' + idxName, idx);
  return idx;
}
/** Read a chunked set back as one array of rows (and its idx). */
function invReadSet_(coll, base, idxName) {
  var idx = invGet_('idx/' + idxName);
  if (!idx || !idx.n) return { idx: idx, rows: [] };
  var paths = [];
  for (var i = 0; i < idx.n; i++) paths.push(coll + '/' + base + '_' + i);
  var got = invGetMany_(paths), rows = [];
  paths.forEach(function (p) { (got[p] || []).forEach(function (r) { rows.push(r); }); });
  return { idx: idx, rows: rows };
}

/* ===================== Status, jobs, schedule ===================== */

function invStatus_() { return invGet_('meta/status') || { last: {}, errors: {} }; }
function invSetStatus_(patch) {
  var s = invStatus_();
  Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
  s.at = Date.now();
  invPut_('meta/status', s);
  return s;
}
function invSettings_() {
  var s = invGet_('meta/settings') || {};
  function n(k, d) { var v = Number(s[k]); return isNaN(v) || s[k] === '' || s[k] == null ? d : v; }
  return { air: n('air', 15), sea: n('sea', 80), awd: n('awd', 7), cutoff: n('cutoff', 20), safety: n('safety', 30), growth: n('growth', 0) };
}

/** Steps for a named job. brand: 'SP' | 'CPC' | 'all'. */
function invStepsFor_(what, brand) {
  var bs = (brand === 'SP' || brand === 'CPC') ? [brand] : ['SP', 'CPC'];
  /* every job that rebuilds inventory ends with the Replenish app's snapshot (ReplSnap.gs) — nothing is pressed by hand */
  var fns = { refresh: ['ord', 'ship', 'inv', 'repl'], orders: ['ord'], shipments: ['ship', 'inv', 'repl'], inventory: ['inv', 'repl'],
              catalog: ['cat'], history: ['hist', 'inv', 'repl'], stockday: ['ship', 'inv', 'repl'], repl: ['repl'] }[what];
  if (!fns) throw new Error('Unknown job "' + what + '"');
  var steps = [];
  fns.forEach(function (fn) { bs.forEach(function (b) { steps.push({ fn: fn, b: b, st: {} }); }); });
  return steps;
}
/** A button press. It never waits for the lock (a running step can hold it for minutes): the request
 *  goes into its own Script Property and invTick folds it into the job before its next step. */
function invRequest_(steps, by) {
  PropertiesService.getScriptProperties().setProperty('INV_REQ_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
    JSON.stringify({ steps: steps, by: by || '' }));
}
/** Fold waiting requests into `job` (or start one). A step already waiting is not added twice. Lock held. */
function invAbsorb_(job) {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties();
  var keys = Object.keys(all).filter(function (k) { return k.indexOf('INV_REQ_') === 0; }).sort();
  if (!keys.length) return job;
  keys.forEach(function (k) {
    var req = {}; try { req = JSON.parse(all[k]); } catch (e) {}
    if (!job || job.done) job = { id: Date.now(), by: req.by || '', steps: [], i: 0, started: Date.now(), log: [] };
    (req.steps || []).forEach(function (s) {
      var dup = job.steps.some(function (x, n) { return n >= job.i && x.fn === s.fn && x.b === s.b; });
      if (!dup) job.steps.push(s);
    });
    job.done = false;
    props.deleteProperty(k);
  });
  invPut_('work/job', job);
  return job;
}
function invJobView_(job) {
  return { id: job.id, by: job.by, i: job.i, done: !!job.done, started: job.started,
    steps: job.steps.map(function (s) { return { fn: s.fn, b: s.b, label: INV_STEP_LABEL[s.fn] + ' · ' + INV.brands[s.b].label, msg: s.msg || '', ok: s.ok, err: s.err || '' }; }) };
}

/** A one-off trigger so the job starts within seconds. Old one-offs are removed first. */
function invKickSoon_(ms) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'invKick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('invKick').timeBased().after(ms || 1000).create();
}
function invKick() { invTick(); }

/** Recurring trigger (every 10 min) + kicks: run the job; when idle, start what the schedule says is due. */
function invTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  var deadline = Date.now() + INV.softMs;
  var job;
  try {
    job = invAbsorb_(invGet_('work/job'));
    if (!job || job.done) { invScheduleDue_(); job = invGet_('work/job'); }
    if (!job || job.done) return;
    while (job.i < job.steps.length && Date.now() < deadline - 20000) {
      if (job.i > 0) job = invAbsorb_(job);
      var s = job.steps[job.i];
      ACTIVE_PREFIX = s.b;
      invSetStatus_({ running: true, job: invJobView_(job) });
      var res;
      try { res = INV_STEPS[s.fn](s.b, s.st || {}, deadline); }
      catch (e) { res = { done: true, err: String(e.message || e) }; }
      s.st = res.st || s.st;
      s.msg = res.msg || s.msg || '';
      if (res.done) {
        s.ok = !res.err; s.err = res.err || ''; s.st = {};
        job.log.push({ fn: s.fn, b: s.b, at: Date.now(), ok: s.ok, msg: s.msg, err: s.err });
        var st = invStatus_(); st.last = st.last || {}; st.errors = st.errors || {};
        if (s.ok) { st.last[s.fn + '_' + s.b] = Date.now(); delete st.errors[s.fn + '_' + s.b]; }
        else st.errors[s.fn + '_' + s.b] = { at: Date.now(), err: s.err };
        invPut_('meta/status', st);
        job.i++;
      }
      invPut_('work/job', job);
      if (!res.done) break;                        // the step needs another run (report still cooking, etc.)
    }
    job = invAbsorb_(job);                         // a press during the last step must not wait for the 10-minute tick
    if (job.i >= job.steps.length) {
      job.done = true; job.ended = Date.now();
      if (job.log.length > 60) job.log = job.log.slice(-60);
      invPut_('work/job', job);
      invSetStatus_({ running: false, job: invJobView_(job) });
    } else {
      invSetStatus_({ running: true, job: invJobView_(job) });
      invKickSoon_(60 * 1000);
    }
  } finally { ACTIVE_PREFIX = 'SP'; lock.releaseLock(); }
}

/** Idle: queue whatever the auto schedule says is due. Runs inside invTick (lock held). */
function invScheduleDue_() {
  var st = invStatus_(), last = st.last || {}, sched = st.sched || {};
  if (sched.off || !st.seeded) return;            // nothing runs by itself before the one-time copy from the sheets
  var now = new Date(), steps = [];
  var tz = 'Asia/Kolkata', today = Utilities.formatDate(now, tz, 'yyyy-MM-dd'), hour = Number(Utilities.formatDate(now, tz, 'H'));
  function slotMs(h) { return new Date(today + 'T' + ('0' + h).slice(-2) + ':00:00+05:30').getTime(); }
  ['SP', 'CPC'].forEach(function (b) {
    if (!last['ord_' + b] || Date.now() - last['ord_' + b] >= INV.ordEveryMs) steps.push({ fn: 'ord', b: b, st: {} });
  });
  var invDue = INV.invSlots.some(function (h) { return hour >= h && (last['inv_SP'] || 0) < slotMs(h); });
  if (invDue) ['ship', 'inv', 'repl'].forEach(function (fn) { ['SP', 'CPC'].forEach(function (b) { steps.push({ fn: fn, b: b, st: {} }); }); });
  if (hour >= INV.catSlot && (last['cat_SP'] || 0) < slotMs(INV.catSlot)) ['SP', 'CPC'].forEach(function (b) { steps.push({ fn: 'cat', b: b, st: {} }); });
  if (!steps.length) return;
  var job = { id: Date.now(), by: 'schedule', steps: steps, i: 0, started: Date.now(), log: [] };
  invPut_('work/job', job);
}

/* ===================== Amazon reports (resumable) ===================== */

/** Create (once) and poll a report. Returns its text, or null when it is still being made. */
function invReport_(st, body, deadline) {
  if (!st.rid) {
    st.rid = sp_('/reports/2021-06-30/reports', 'post', body).reportId;
    st.ridAt = Date.now();
  }
  while (Date.now() < deadline - 25000) {
    Utilities.sleep(15000);
    var r = spRetry_('/reports/2021-06-30/reports/' + st.rid, 'get');
    if (r.processingStatus === 'DONE') {
      var doc = spRetry_('/reports/2021-06-30/documents/' + r.reportDocumentId, 'get');
      var blob = UrlFetchApp.fetch(doc.url, { muteHttpExceptions: true }).getBlob();
      if (doc.compressionAlgorithm === 'GZIP') blob = Utilities.ungzip(blob.setContentType('application/x-gzip'));
      delete st.rid; delete st.ridAt;
      return blob.getDataAsString('UTF-8');
    }
    if (r.processingStatus === 'FATAL' || r.processingStatus === 'CANCELLED') {
      delete st.rid; delete st.ridAt;
      // An orders report with no orders in the window can end FATAL/CANCELLED — that is an empty window, not a fault.
      if (body.reportType === 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL' && r.processingStatus === 'CANCELLED') return '';
      throw new Error(body.reportType + ' ended ' + r.processingStatus);
    }
  }
  if (Date.now() - st.ridAt > 45 * 60 * 1000) { delete st.rid; delete st.ridAt; throw new Error(body.reportType + ' not ready after 45 minutes'); }
  return null;
}
function invTsv_(text) {
  var lines = String(text || '').split(/\r?\n/);
  if (lines.length < 2) return [];
  var h = lines[0].split('\t').map(function (x) { return x.trim().toLowerCase(); }), out = [];
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    var c = lines[i].split('\t'), o = {};
    for (var j = 0; j < h.length; j++) o[h[j]] = c[j];
    out.push(o);
  }
  return out;
}
function invPick_(o, names) { for (var i = 0; i < names.length; i++) if (o[names[i]] !== undefined && o[names[i]] !== '') return o[names[i]]; return ''; }

/* ===================== Orders ===================== */

/** Report window [start, end] (PT dates) as the orders report wants it. */
function invOrdBody_(startStr, endStr) {
  function laISO(d, hms) {
    var off = Utilities.formatDate(new Date(d + 'T12:00:00Z'), INV.pt, 'Z');
    return d + 'T' + hms + off.slice(0, 3) + ':' + off.slice(3);
  }
  var start = new Date(laISO(startStr, '00:00:00')), end = new Date(laISO(endStr, '23:59:59'));
  if (end > new Date()) end = new Date(Date.now() - 3 * 60 * 1000);
  if (start.getTime() >= end.getTime()) return null;
  return { reportType: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL', marketplaceIds: [marketplaceId_()],
    dataStartTime: start.toISOString(), dataEndTime: end.toISOString() };
}
/** Same 10 fields as the sheet; MCF = 1 when the sales channel is Non-Amazon; Date = PT purchase date. */
function invOrdParse_(tsv) {
  var lines = String(tsv || '').split(/\r?\n/);
  if (lines.length < 2) return [];
  var H = {}; lines[0].split('\t').forEach(function (h, i) { H[h.trim().toLowerCase()] = i; });
  var out = [];
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    var c = lines[i].split('\t'), purch = c[H['purchase-date']] || '', chan = c[H['sales-channel']] || '';
    var pd = new Date(purch);
    var dateStr = isNaN(pd.getTime()) ? String(purch).slice(0, 10) : Utilities.formatDate(pd, INV.pt, 'yyyy-MM-dd');
    out.push([c[H['amazon-order-id']] || '', purch, dateStr, c[H['sku']] || '', c[H['asin']] || '',
      num_(c[H['quantity']]), num_(c[H['item-price']]), c[H['order-status']] || '', chan, /non-amazon/i.test(chan) ? 1 : 0]);
  }
  return out;
}
/** Block-replace orders dated [startStr, endStr] with `rows`, month by month, then de-duplicate
 *  Order ID + SKU keeping the freshest copy (the new rows win). Older months are never touched. */
function invOrdMerge_(b, startStr, endStr, rows) {
  var months = {}, d = new Date(startStr.slice(0, 7) + '-01T00:00:00Z');
  while (Utilities.formatDate(d, 'UTC', 'yyyy-MM') <= endStr.slice(0, 7)) { months[Utilities.formatDate(d, 'UTC', 'yyyy-MM')] = []; d.setUTCMonth(d.getUTCMonth() + 1); }
  rows.forEach(function (r) { var ym = String(r[2]).slice(0, 7); (months[ym] = months[ym] || []).push(r); });
  var summary = invGet_('idx/ord_' + b) || { months: {} };
  Object.keys(months).forEach(function (ym) {
    var base = b + '_' + ym, old = invReadSet_('ord', base, 'ord_' + base).rows;
    var keep = old.filter(function (r) { return !(r[2] >= startStr && r[2] <= endStr); }).concat(months[ym]);
    var last = {};
    keep.forEach(function (r, i) { if (r[0]) last[r[0] + '|' + r[3]] = i; });
    keep = keep.filter(function (r, i) { return !r[0] || last[r[0] + '|' + r[3]] === i; });
    keep.sort(function (x, y) { return x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0; });
    invWriteSet_('ord', base, 'ord_' + base, keep, { cols: INV_ORD_COLS, brand: b, month: ym });
    summary.months[ym] = keep.length;
  });
  summary.at = Date.now(); summary.cols = INV_ORD_COLS;
  invPut_('idx/ord_' + b, summary);
}
function invPtToday_() { return Utilities.formatDate(new Date(), INV.pt, 'yyyy-MM-dd'); }
function invAddDaysStr_(s, n) { return Utilities.formatDate(new Date(new Date(s + 'T00:00:00Z').getTime() + n * 86400000), 'UTC', 'yyyy-MM-dd'); }

var INV_STEPS = {};

INV_STEPS.ord = function (b, st, deadline) {
  // The history pull owns these dates until it finishes, exactly like the sheet's guard.
  var job = invGet_('work/job');
  var histBusy = job && !job.done && job.steps.some(function (s, k) { return k > job.i && s.fn === 'hist' && s.b === b; });
  if (histBusy) return { done: true, msg: 'skipped — the history pull will bring these dates' };
  var today = invPtToday_(), start = st.start || invAddDaysStr_(today, -(INV.ordSyncDays - 1));
  st.start = start; st.end = st.end || today;
  var body = invOrdBody_(st.start, st.end);
  var text = body ? invReport_(st, body, deadline) : '';
  if (text === null) return { done: false, st: st, msg: 'Amazon is preparing the report…' };
  var rows = invOrdParse_(text);
  invOrdMerge_(b, st.start, st.end, rows);
  return { done: true, msg: rows.length + ' order lines, ' + st.start + ' → ' + st.end };
};

INV_STEPS.hist = function (b, st, deadline) {
  var today = invPtToday_();
  st.cursor = st.cursor || INV.ordStart;
  st.lines = st.lines || 0;
  while (st.cursor <= today && Date.now() < deadline - 60000) {
    var end = invAddDaysStr_(st.cursor, 29); if (end > today) end = today;
    var body = invOrdBody_(st.cursor, end);
    var text = body ? invReport_(st, body, deadline) : '';
    if (text === null) return { done: false, st: st, msg: 'history at ' + st.cursor + ' — Amazon is preparing the report…' };
    var rows = invOrdParse_(text);
    invOrdMerge_(b, st.cursor, end, rows);
    st.lines += rows.length;
    st.cursor = invAddDaysStr_(end, 1);
  }
  if (st.cursor <= today) return { done: false, st: st, msg: 'history through ' + invAddDaysStr_(st.cursor, -1) + ' (' + st.lines + ' lines so far)' };
  return { done: true, msg: st.lines + ' order lines, ' + INV.ordStart + ' → ' + today };
};

/** Sales buckets per SKU from the stored orders — MCF and Cancelled skipped, PT dates (same as the sheet). */
function invSalesBuckets_(b) {
  var today = invPtToday_(), DAY = 86400000, tMs = new Date(today + 'T00:00:00Z').getTime();
  var from = Utilities.formatDate(new Date(tMs - 90 * DAY), 'UTC', 'yyyy-MM-dd'), monthStart = today.slice(0, 7) + '-01';
  var yStr = Utilities.formatDate(new Date(tMs - DAY), 'UTC', 'yyyy-MM-dd');
  var cut = { l7: invAddDaysStr_(today, -7), l14: invAddDaysStr_(today, -14), l30: invAddDaysStr_(today, -30), l90: from };
  var out = {}, summary = invGet_('idx/ord_' + b) || { months: {} };
  Object.keys(summary.months).filter(function (ym) { return ym >= from.slice(0, 7); }).forEach(function (ym) {
    invReadSet_('ord', b + '_' + ym, 'ord_' + b + '_' + ym).rows.forEach(function (r) {
      var sku = String(r[3] || '').trim(), units = Number(r[5]) || 0, d = String(r[2] || '');
      if (!sku || !units || r[9] === 1 || String(r[7]).toLowerCase() === 'cancelled' || d < from) return;
      var s = out[sku] || (out[sku] = { y: 0, t: 0, l7: 0, l14: 0, l30: 0, l90: 0, l90amt: 0, tm: 0 });
      if (d === today) s.t += units;
      if (d === yStr) s.y += units;
      if (d >= cut.l7) s.l7 += units;
      if (d >= cut.l14) s.l14 += units;
      if (d >= cut.l30) s.l30 += units;
      if (d >= cut.l90) { s.l90 += units; s.l90amt += Number(r[6]) || 0; }
      if (d >= monthStart) s.tm += units;
    });
  });
  return { buckets: out, ordersAt: summary.at || 0 };
}

/* ===================== Shipments ===================== */

function invShipDateFromName_(name) {
  var m = String(name || '').match(/\((\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\)/);
  return m ? new Date(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0)).getTime() : 0;
}
function invModeFromName_(name) {
  var n = String(name || '').toLowerCase();
  if (n.indexOf('ocean') !== -1 || /\bsea\b/.test(n)) return 'Sea';
  if (/\bair\b/.test(n)) return 'Air';
  return 'AWD';
}
function invTransit_(mode, s) { return mode === 'Air' ? s.air : mode === 'AWD' ? s.awd : s.sea; }
/** ETA day > cutoff → next month. Returns 'YYYY-MM' (Asia/Kolkata calendar). */
function invSellMonth_(etaMs, cutoff) {
  var d = Utilities.formatDate(new Date(etaMs), 'Asia/Kolkata', 'yyyy-MM-dd').split('-');
  var y = +d[0], m = +d[1];
  if (+d[2] > cutoff) { m++; if (m > 12) { m = 1; y++; } }
  return y + '-' + ('0' + m).slice(-2);
}

INV_STEPS.ship = function (b, st, deadline) {
  var set = invSettings_();
  if (!st.list) {
    var ALL = 'WORKING,READY_TO_SHIP,SHIPPED,RECEIVING,IN_TRANSIT,DELIVERED,CHECKED_IN,CANCELLED,DELETED,CLOSED,ERROR';
    var after = new Date(Date.now() - INV.shipMonths * 30 * 86400000).toISOString(), before = new Date().toISOString();
    var list = [], next = null, guard = 0, seen = {};
    do {
      var path = next
        ? '/fba/inbound/v0/shipments?MarketplaceId=' + marketplaceId_() + '&QueryType=NEXT_TOKEN&NextToken=' + encodeURIComponent(next)
        : '/fba/inbound/v0/shipments?MarketplaceId=' + marketplaceId_() + '&QueryType=DATE_RANGE&ShipmentStatusList=' + ALL +
          '&LastUpdatedAfter=' + encodeURIComponent(after) + '&LastUpdatedBefore=' + encodeURIComponent(before);
      var p = spRetry_(path, 'get').payload || {};
      (p.ShipmentData || []).forEach(function (s) {
        var stt = String(s.ShipmentStatus || '').toUpperCase();
        if (INV_SHIP_KEEP[stt]) list.push({ id: s.ShipmentId || '', name: s.ShipmentName || '', status: INV_SHIP_KEEP[stt] });
      });
      var nt = p.NextToken || null; next = (nt && !seen[nt]) ? nt : null; if (next) seen[next] = 1;
      Utilities.sleep(600);
    } while (next && ++guard < 200);
    var awd = [], tok = null, g2 = 0;
    try {
      do {
        var ap = '/awd/2024-05-09/inboundShipments?maxResults=200&sortBy=UPDATED_AT&sortOrder=DESCENDING' + (tok ? '&nextToken=' + encodeURIComponent(tok) : '');
        var ar = spRetry_(ap, 'get');
        (ar.shipments || []).forEach(function (s) { var a = String(s.shipmentStatus || '').toUpperCase(); if (INV_AWD_KEEP[a]) awd.push({ id: s.shipmentId, status: INV_AWD_KEEP[a], createdAt: s.createdAt || '' }); });
        tok = ar.nextToken || null; if (tok) Utilities.sleep(400);
      } while (tok && ++g2 < 100);
    } catch (e) { st.awdErr = String(e.message || e).slice(0, 200); }
    st.list = list; st.awd = awd; st.i = 0; st.ai = 0; st.rows = [];
  }
  var seenDoc = invGet_('meta/shipseen_' + b) || {};          // rule 4: first-seen date for names with no date
  while (st.i < st.list.length && Date.now() < deadline - 30000) {
    var s = st.list[st.i], items = [], nx = null, g = 0, sn = {};
    do {
      var ip = nx ? '/fba/inbound/v0/shipmentItems?MarketplaceId=' + marketplaceId_() + '&QueryType=NEXT_TOKEN&NextToken=' + encodeURIComponent(nx)
                  : '/fba/inbound/v0/shipments/' + encodeURIComponent(s.id) + '/items?MarketplaceId=' + marketplaceId_();
      var pr;
      try { pr = spRetry_(ip, 'get').payload || {}; } catch (e) { pr = {}; }
      (pr.ItemData || []).forEach(function (it) { items.push(it); });
      var t2 = pr.NextToken || null; nx = (t2 && !sn[t2]) ? t2 : null; if (nx) sn[nx] = 1;
      Utilities.sleep(300);
    } while (nx && ++g < 50);
    var mode = invModeFromName_(s.name), days = invTransit_(mode, set);
    var shipMs = invShipDateFromName_(s.name), from = 'name';
    if (!shipMs) { shipMs = seenDoc[s.id] || Date.now(); seenDoc[s.id] = shipMs; from = 'first seen'; }
    var eta = shipMs + days * 86400000, ym = invSellMonth_(eta, set.cutoff);
    items.forEach(function (it) {
      var q = num_(it.QuantityShipped);
      if (it.SellerSKU && q > 0) st.rows.push([shipMs, eta, ym, s.id, it.SellerSKU, q, mode, s.status, days, s.name, from]);
    });
    st.i++;
  }
  while (st.i >= st.list.length && st.ai < st.awd.length && Date.now() < deadline - 30000) {
    var a = st.awd[st.ai], det;
    try { det = spRetry_('/awd/2024-05-09/inboundShipments/' + encodeURIComponent(a.id) + '?skuQuantities=SHOW', 'get'); } catch (e) { det = {}; }
    var cMs = Date.parse(det.createdAt || a.createdAt || '') || 0, aFrom = 'created';
    if (!cMs) { cMs = seenDoc[a.id] || Date.now(); seenDoc[a.id] = cMs; aFrom = 'first seen'; }
    var aEta = cMs + set.sea * 86400000, aYm = invSellMonth_(aEta, set.cutoff);
    var units = {};
    (det.shipmentContainerQuantities || []).forEach(function (cq) {
      var cnt = cq.count || 0, prods = (cq.distributionPackage && cq.distributionPackage.contents && cq.distributionPackage.contents.products) || [];
      prods.forEach(function (p) { if (p.sku) units[p.sku] = (units[p.sku] || 0) + cnt * (p.quantity || 0); });
    });
    var sl = det.shipmentSkuQuantities || [];
    if (sl.length) sl.forEach(function (q) {
      var qty = units[q.sku] || (q.expectedQuantity && q.expectedQuantity.quantity) || 0;
      if (q.sku && qty > 0) st.rows.push([cMs, aEta, aYm, a.id, q.sku, qty, 'AWD', a.status, set.sea, a.id, aFrom]);
    });
    else Object.keys(units).forEach(function (k) { if (units[k] > 0) st.rows.push([cMs, aEta, aYm, a.id, k, units[k], 'AWD', a.status, set.sea, a.id, aFrom]); });
    st.ai++;
    Utilities.sleep(200);
  }
  invPut_('meta/shipseen_' + b, seenDoc);
  if (st.i < st.list.length || st.ai < st.awd.length)
    return { done: false, st: st, msg: 'shipment ' + st.i + '/' + st.list.length + ', AWD ' + st.ai + '/' + st.awd.length };
  invWriteSet_('ship', b, 'ship_' + b, st.rows, { cols: INV_SHIP_COLS, brand: b, shipments: st.list.length, awd: st.awd.length, awdErr: st.awdErr || '' });
  return { done: true, msg: st.rows.length + ' lines from ' + st.list.length + ' shipments + ' + st.awd.length + ' AWD' + (st.awdErr ? ' (AWD error: ' + st.awdErr + ')' : '') };
};

/* ===================== Inventory ===================== */

/** Air/Sea plan, same maths as the sheet's computePlan_ (90-day target, sea 80, safety 10).
 *  India columns are left out: India stock now lives in the factory app's Finished Goods. */
function invPlan_(ads, imm, pipe, arrivals, set) {
  var TARGET = 90, SEA = set.sea || 80, SAFETY = 10;
  var airDoS = ads > 0 ? Math.round(imm / ads) : '', seaDoS = ads > 0 ? Math.round(pipe / ads) : '';
  var airQty = 0, seaQty = 0;
  if (ads > 0) {
    var ev = arrivals.filter(function (x) { return x.day > 0 && x.day <= TARGET; }).sort(function (x, y) { return x.day - y.day; });
    var on = imm, day = 0, min = imm;
    ev.forEach(function (e) { on -= ads * (e.day - day); if (on < min) min = on; on += e.qty; day = e.day; });
    on -= ads * (TARGET - day); if (on < min) min = on;
    if (min < 0) airQty = Math.round(-min);
    var dos = pipe / ads;
    seaQty = dos <= TARGET ? Math.max(0, Math.round(TARGET * ads)) : Math.max(0, Math.round((TARGET + SEA + SAFETY - dos) * ads));
  }
  return [airDoS, airQty, seaDoS, seaQty];
}
function invCatalogMap_(b) {
  var cat = invReadSet_('cat', b, 'cat_' + b).rows, edits = invGet_('catedit/' + b) || {}, map = {};
  cat.forEach(function (r) { map[r[0]] = { asin: r[1], parent: r[3], image: r[6], color: r[7], size: r[8], subcat: r[9] }; });
  Object.keys(edits).forEach(function (sku) {
    var e = edits[sku] || {}, m = map[sku] || (map[sku] = {});
    if (e.parent) m.parent = e.parent; if (e.image) m.image = e.image; if (e.color) m.color = e.color; if (e.size) m.size = e.size; if (e.subcat) m.subcat = e.subcat;
  });
  return map;
}

INV_STEPS.inv = function (b, st, deadline) {
  // 1) FBA summaries, page by page. A page is retried; if it still fails the step stops and the
  //    previous inventory stays as it is (rule 3 — the sheet wrote zeros for every SKU after it).
  st.rows = st.rows || {}; st.pages = st.pages || 0;
  // Amazon's nextToken does not survive the pause between two runs (24 Oct: page 16 answered 400 after
  // a one-minute gap), so the whole list is read inside ONE run: start only with 3+ minutes in hand.
  if (!st.fbaDone && !st.token && deadline - Date.now() < 3 * 60 * 1000) return { done: false, st: st, msg: 'waiting for a fresh run to read the FBA list in one go' };
  if (!st.fbaDone) {
    while (Date.now() < deadline - 40000) {
      var path = '/fba/inventory/v1/summaries?details=true&granularityType=Marketplace&granularityId=' + marketplaceId_() + '&marketplaceIds=' + marketplaceId_() +
        (st.token ? '&nextToken=' + encodeURIComponent(st.token) : '');
      var res = null, lastErr = '';
      for (var a = 0; a < 4 && !res; a++) {
        try { res = spRetry_(path, 'get'); } catch (e) { lastErr = String(e.message || e); Utilities.sleep(3000 * (a + 1)); }
      }
      if (!res && st.token && / 400 /.test(lastErr) && !st.restarted) {   // expired page token → read the list again from page 1
        st.rows = {}; st.pages = 0; st.token = null; st.restarted = true;
        return { done: false, st: st, msg: 'Amazon page token expired — reading the FBA list again from the start' };
      }
      if (!res) throw new Error('FBA inventory page ' + (st.pages + 1) + ' failed 4 times — old inventory kept. ' + lastErr.slice(0, 200));
      ((res.payload && res.payload.inventorySummaries) || []).forEach(function (it) {
        if (!it.sellerSku) return;
        var d = it.inventoryDetails || {}, rsv = d.reservedQuantity || {}, unf = d.unfulfillableQuantity || {}, rsh = d.researchingQuantity || {};
        st.rows[it.sellerSku] = [it.asin || '', it.totalQuantity || 0, d.fulfillableQuantity || 0, unf.totalUnfulfillableQuantity || 0,
          rsv.totalReservedQuantity || 0, rsv.pendingCustomerOrderQuantity || 0, d.inboundWorkingQuantity || 0, d.inboundShippedQuantity || 0,
          d.inboundReceivingQuantity || 0, rsh.totalResearchingQuantity || 0];
      });
      st.pages++;
      st.token = (res.pagination && res.pagination.nextToken) || null;
      if (!st.token) { st.fbaDone = true; break; }
      Utilities.sleep(1000);
    }
    if (!st.fbaDone) return { done: false, st: st, msg: 'FBA inventory page ' + st.pages + ' (' + Object.keys(st.rows).length + ' SKUs)' };
  }
  // 2) AWD (empty when the AWD role is not granted — same as the sheet).
  var awd = {}, awdErr = '';
  try {
    var tok = null, g = 0;
    do {
      var ar = spRetry_('/awd/2024-05-09/inventory?details=SHOW&maxResults=200' + (tok ? '&nextToken=' + encodeURIComponent(tok) : ''), 'get');
      (ar.inventory || []).forEach(function (it) { if (it.sku) awd[it.sku] = { avail: it.totalOnhandQuantity || 0, transit: it.totalInboundQuantity || 0 }; });
      tok = ar.nextToken || null; if (tok) Utilities.sleep(600);
    } while (tok && ++g < 200);
  } catch (e) { awdErr = String(e.message || e).slice(0, 200); }

  // 3) Everything else comes from what is already stored.
  var set = invSettings_(), cat = invCatalogMap_(b), sb = invSalesBuckets_(b), sales = sb.buckets;
  var ships = invReadSet_('ship', b, 'ship_' + b).rows;
  var curYM = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM'), now = Date.now(), DAY = 86400000;
  var recv = {}, chk = {}, awdArr = {};
  ships.forEach(function (r) {
    var sku = String(r[4] || '').trim(), qty = Number(r[5]) || 0;
    if (!sku || !qty) return;
    if (/^\s*STAR-/i.test(r[9]) || /^\s*STAR-/i.test(r[3])) {           // my warehouse → AWD: timing for AWD Transit only
      var day = Math.max(0, Math.round(((r[1] || (r[0] + set.sea * DAY)) - now) / DAY));
      (awdArr[sku] = awdArr[sku] || []).push({ day: day, qty: qty });
      return;
    }
    var ym = r[2] || (r[1] ? invSellMonth_(r[1], set.cutoff) : '');
    if (!ym) return;
    var tgt = r[7] === 'Checked In' ? chk : recv;
    (tgt[sku] = tgt[sku] || {})[ym] = (tgt[sku][ym] || 0) + qty;
  });
  // Rule 2: a Checked In shipment's units already counted in inbound_receiving are not counted again.
  var chkTrim = 0;
  Object.keys(chk).forEach(function (sku) {
    var inRecv = (st.rows[sku] || [])[8] || 0;
    Object.keys(chk[sku]).sort().forEach(function (ym) {
      var q = chk[sku][ym], take = Math.min(q, inRecv);
      inRecv -= take; chkTrim += take;
      if (q - take > 0) (recv[sku] = recv[sku] || {})[ym] = (recv[sku][ym] || 0) + (q - take);
    });
  });
  Object.keys(awdArr).forEach(function (s) { awdArr[s].sort(function (x, y) { return x.day - y.day; }); });
  var monthSet = {};
  Object.keys(recv).forEach(function (s) { Object.keys(recv[s]).forEach(function (k) { monthSet[k] = 1; }); });
  var months = Object.keys(monthSet).sort();
  var ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var cols = ['SKU', 'Image', 'ASIN', 'Parent ASIN', 'Color', 'Size', 'Sub-Category', 'Total Stock', 'warehouse', 'fulfillable', 'Unsellable', 'reserved']
    .concat(months.map(function (k) { return ABBR[+k.slice(5) - 1] + " '" + k.slice(2, 4) + ' Rec.'; }))
    .concat(['inbound_working', 'inbound_shipped', 'inbound_receiving', 'reserved_orders', 'AWD Available', 'AWD Transit',
             'Yesterday', 'Today', 'Last 7 Days', 'Last 14 Days', 'Last 30 Days', 'Last 90 Days', 'Last 90 Days $', 'This Month',
             'Air DoS', 'Air Qty', 'Sea DoS', 'Sea Qty']);
  var skuSet = {};
  [st.rows, cat, recv].forEach(function (o) { Object.keys(o).forEach(function (s) { skuSet[s] = 1; }); });
  var Z = ['', 0, 0, 0, 0, 0, 0, 0, 0, 0], ZS = { y: 0, t: 0, l7: 0, l14: 0, l30: 0, l90: 0, l90amt: 0, tm: 0 };
  var list = Object.keys(skuSet).filter(function (s) { return String(s).toLowerCase().indexOf('amzn') !== 0; })
    .sort(function (x, y) { return ((sales[y] || ZS).l30) - ((sales[x] || ZS).l30); });
  var out = list.map(function (sku) {
    var r = st.rows[sku] || Z, a = awd[sku] || { avail: 0, transit: 0 }, c = cat[sku] || {}, s = sales[sku] || ZS, rc = recv[sku] || {};
    var warehouse = r[2] + r[4] + r[9] - r[5];
    var arrivals = [];
    Object.keys(rc).forEach(function (ym) {
      if (ym > curYM && rc[ym]) arrivals.push({ day: Math.round((Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1, 1) - now) / DAY), qty: rc[ym] });
    });
    if (a.transit > 0) {
      var left = a.transit;
      (awdArr[sku] || []).forEach(function (x) { if (left <= 0) return; var q = Math.min(x.qty, left); arrivals.push({ day: x.day, qty: q }); left -= q; });
      if (left > 0) arrivals.push({ day: set.sea, qty: left });
    }
    var ads = (s.l90 === s.l30) ? (s.l30 / 30) : (s.l90 / 90);
    var plan = invPlan_(ads, warehouse + r[8] + (rc[curYM] || 0) + a.avail, r[1] + a.avail + a.transit, arrivals, set);
    return [sku, c.image || '', r[0] || c.asin || '', c.parent || '', c.color || '', c.size || '', c.subcat || '', r[1], warehouse, r[2], r[3], r[4]]
      .concat(months.map(function (k) { return rc[k] || 0; }))
      .concat([r[6], r[7], r[8], r[5], a.avail, a.transit, s.y, s.t, s.l7, s.l14, s.l30, s.l90, Math.round(s.l90amt * 100) / 100, s.tm])
      .concat(plan);
  });
  invWriteSet_('inv', b, 'inv_' + b, out, { cols: cols, brand: b, months: months, fbaSkus: Object.keys(st.rows).length, pages: st.pages,
    awdErr: awdErr, ordersAt: sb.ordersAt, checkedInTrimmed: chkTrim });
  return { done: true, msg: out.length + ' SKUs (' + st.pages + ' FBA pages' + (awdErr ? ', AWD error: ' + awdErr : '') + ')' };
};

/* ===================== Catalog ===================== */

INV_STEPS.cat = function (b, st, deadline) {
  // Before the one-time copy the hand-typed values are only in the sheets; a catalogue built now would lose them.
  if (!invStatus_().seeded) return { done: true, err: 'Copy Catalog + Settings from the sheets first (Settings tab) — the hand-typed values are still only there.' };
  var body = function (t) { return { reportType: t, marketplaceIds: [marketplaceId_()] }; };
  if (!st.listings) {
    st.r1 = st.r1 || {};
    var t1 = invReport_(st.r1, body('GET_MERCHANT_LISTINGS_ALL_DATA'), deadline);
    if (t1 === null) return { done: false, st: st, msg: 'Amazon is preparing the listings report…' };
    st.listings = invTsv_(t1).map(function (r) {
      return [invPick_(r, ['seller-sku', 'sku']), invPick_(r, ['asin1', 'asin']), invPick_(r, ['item-name']), String(invPick_(r, ['open-date']) || '')];
    }).filter(function (r) { return r[0]; });
  }
  if (!st.fnDone) {
    st.r2 = st.r2 || {};
    try {
      var t2 = invReport_(st.r2, body('GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA'), deadline);
      if (t2 === null) return { done: false, st: st, msg: 'Amazon is preparing the FNSKU report…' };
      st.fn = {};
      invTsv_(t2).forEach(function (r) { var s = invPick_(r, ['sku', 'seller-sku']); if (s) st.fn[s] = invPick_(r, ['fnsku']); });
    } catch (e) { st.fn = null; st.fnErr = String(e.message || e).slice(0, 200); }   // unavailable → existing FNSKUs kept
    st.fnDone = true;
  }
  var prev = {};
  invReadSet_('cat', b, 'cat_' + b).rows.forEach(function (r) { prev[r[0]] = r; });
  // Only listings we know nothing useful about are looked up (the sheet re-fetched all ~3,000 every time).
  if (!st.pending) {
    var need = {};
    st.listings.forEach(function (l) { var p = prev[l[0]]; if (l[1] && (!p || !p[6] || !p[3])) need[l[1]] = 1; });
    st.pending = Object.keys(need); st.info = {};
  }
  while (st.pending.length && Date.now() < deadline - 30000) {
    var batch = st.pending.splice(0, 8), res = null;
    try {
      res = spRetry_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
        '&identifiersType=ASIN&includedData=summaries,images,relationships,productTypes,attributes&identifiers=' + batch.join(','), 'get');
    } catch (e) { res = null; }
    (res && res.items || []).forEach(function (it) {
      var sum = (it.summaries || [])[0] || {}, img = '', ig = (it.images || [])[0], parent = '';
      if (ig) { (ig.images || []).some(function (x) { if (x.variant === 'MAIN') { img = x.link; return true; } }); if (!img && (ig.images || []).length) img = ig.images[0].link; }
      (it.relationships || []).forEach(function (g) { (g.relationships || []).forEach(function (r) { if (!parent && (r.parentAsins || []).length) parent = r.parentAsins[0]; }); });
      var cat = (sum.browseClassification && sum.browseClassification.displayName) || ((it.productTypes || [])[0] || {}).productType || '';
      st.info[it.asin] = [sum.itemName || '', sum.brand || '', img, parent, sum.color || '', sum.size || '', cat];
    });
    Utilities.sleep(400);
  }
  if (st.pending.length) return { done: false, st: st, msg: 'catalogue details, ' + st.pending.length + ' ASINs left' };
  function keep(old, api) { var m = String(old == null ? '' : old).trim(); return m ? m : String(api == null ? '' : api).trim(); }
  var now = Date.now(), rows = st.listings.map(function (l) {
    var p = prev[l[0]] || [], inf = st.info[l[1]] || [], type = '', m = l[3].match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) type = (now - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000 <= INV.catNewDays ? 'New' : 'Old';
    var fn = st.fn ? (st.fn[l[0]] || '') : (p[2] || '');
    return [l[0], l[1], fn || p[2] || '', keep(p[3], inf[3]), keep(p[4], inf[0] || l[2]), keep(p[5], inf[1]), keep(p[6], inf[2]),
      keep(p[7], inf[4]), keep(p[8], inf[5]), keep(p[9], inf[6]), now, type, p[12] || ''];
  }).sort(function (x, y) { return x[0] < y[0] ? -1 : 1; });
  invWriteSet_('cat', b, 'cat_' + b, rows, { cols: INV_CAT_COLS, brand: b, fnErr: st.fnErr || '' });
  return { done: true, msg: rows.length + ' listings' + (st.fnErr ? ' (FNSKU report unavailable — old FNSKUs kept)' : '') };
};

/* ===================== One-time seed from the sheets (rule 1) ===================== */

/** Copies each brand's Catalog tab (with every hand-typed value) and the Settings tab, and writes
 *  config/backend so the app knows where to call. Safe to repeat; it never touches the sheets. */
function invSeed_() {
  var done = [];
  Object.keys(INV.brands).forEach(function (b) {
    var B = INV.brands[b], sh = SpreadsheetApp.openById(B.sheet).getSheetByName(B.catTab);
    if (!sh || sh.getLastRow() < 2) { done.push(b + ': no ' + B.catTab + ' tab'); return; }
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 13).getValues().map(function (r) {
      return r.map(function (v, i) { return i === 10 ? (v instanceof Date ? v.getTime() : 0) : String(v == null ? '' : v).trim(); });
    }).filter(function (r) { return r[0]; });
    invWriteSet_('cat', b, 'cat_' + b, vals, { cols: INV_CAT_COLS, brand: b, seededFromSheet: Date.now() });
    done.push(b + ': ' + vals.length + ' catalog rows');
  });
  var s = SpreadsheetApp.openById(INV.brands.SP.sheet).getSheetByName('Settings'), raw = {};
  if (s && s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0] !== '') raw[String(r[0]).trim()] = r[1]; });
  function n(k, d) { var v = Number(raw[k]); return raw[k] === '' || raw[k] == null || isNaN(v) ? d : v; }
  invPut_('meta/settings', { air: n('Air Transit Days', 15), sea: n('Sea Transit Days', 80), awd: n('AWD Transit Days', 7),
    cutoff: n('Month Cutoff Day', 20), safety: n('Safety Stock Days', 30), growth: n('YoY Growth %', 0), from: 'sheet ' + new Date().toISOString() });
  invPut_('config/backend', { url: ScriptApp.getService().getUrl(), key: prop_('API_KEY') });
  invSetStatus_({ seeded: Date.now() });
  return done;
}

/** Install the recurring 10-minute tick (once). */
function invInstall() {
  // Google's granular consent can leave a scope ungranted without asking again (24 Oct: the token had
  // Drive/Sheets but never datastore). This makes the editor show the consent screen for whatever is missing.
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ['https://www.googleapis.com/auth/datastore']);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'invTick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('invTick').timeBased().everyMinutes(10).create();
  return 'invTick every 10 minutes';
}

/* ===================== Check against the old sheets (read-only) ===================== */

/** Side by side: the sheet's Inventory totals vs ours, and order lines/units per month. Never writes a sheet. */
function invCompare_(b) {
  var B = INV.brands[b], out = { brand: b, inventory: {}, orders: {} };
  var tab = b === 'CPC' ? 'CPC Inventory' : 'Inventory';
  var sh = SpreadsheetApp.openById(B.sheet).getSheetByName(tab);
  var want = ['Total Stock', 'warehouse', 'fulfillable', 'Unsellable', 'reserved', 'inbound_working', 'inbound_shipped', 'inbound_receiving',
    'reserved_orders', 'AWD Available', 'AWD Transit', 'Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'Last 90 Days $'];
  var mine = invReadSet_('inv', b, 'inv_' + b), cols = (mine.idx || {}).cols || [];
  if (sh && sh.getLastRow() > 2) {
    var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues(), head = vals[0].map(String);
    var upd = head.indexOf('UpdatedAt');
    out.inventory.sheetBuilt = upd >= 0 && vals[2][upd] instanceof Date ? vals[2][upd].getTime() : 0;
    out.inventory.appBuilt = (mine.idx || {}).at || 0;
    out.inventory.skus = { sheet: vals.length - 2, app: mine.rows.length };
    want.forEach(function (h) {
      var i = head.indexOf(h), j = cols.indexOf(h), a = 0, m = 0;
      for (var r = 2; r < vals.length; r++) a += Number(vals[r][i]) || 0;
      mine.rows.forEach(function (row) { m += Number(row[j]) || 0; });
      out.inventory[h] = { sheet: i < 0 ? null : Math.round(a), app: j < 0 ? null : Math.round(m) };
    });
    var recS = head.filter(function (h) { return / Rec\.$/.test(h); }), recA = cols.filter(function (h) { return / Rec\.$/.test(h); });
    out.inventory.recMonths = { sheet: recS, app: recA };
    recS.concat(recA).filter(function (h, k, arr) { return arr.indexOf(h) === k; }).forEach(function (h) {
      var i = head.indexOf(h), j = cols.indexOf(h), a = 0, m = 0;
      if (i >= 0) for (var r = 2; r < vals.length; r++) a += Number(vals[r][i]) || 0;
      if (j >= 0) mine.rows.forEach(function (row) { m += Number(row[j]) || 0; });
      out.inventory[h] = { sheet: i < 0 ? null : a, app: j < 0 ? null : m };
    });
  }
  var osh = SpreadsheetApp.openById(b === 'CPC' ? '1jjDNWNF327mVQTKfmcadioB5AO5A9BP_9M1CC9t4L2o' : '1OLIo0mYIgClBuABrfivPoLG-M1xS_rLwkQpFRAF_0kA')
    .getSheetByName(b === 'CPC' ? 'CPC Orders' : 'Orders');
  if (osh && osh.getLastRow() > 1) {
    var ov = osh.getRange(2, 3, osh.getLastRow() - 1, 4).getValues();            // C Date, D SKU, E ASIN, F Units
    ov.forEach(function (r) {
      var d = r[0] instanceof Date ? Utilities.formatDate(r[0], osh.getParent().getSpreadsheetTimeZone(), 'yyyy-MM') : String(r[0]).slice(0, 7);
      var o = out.orders[d] || (out.orders[d] = { sheetLines: 0, sheetUnits: 0, appLines: 0, appUnits: 0 });
      o.sheetLines++; o.sheetUnits += Number(r[3]) || 0;
    });
  }
  var sum = invGet_('idx/ord_' + b) || { months: {} };
  Object.keys(sum.months).forEach(function (ym) {
    var o = out.orders[ym] || (out.orders[ym] = { sheetLines: 0, sheetUnits: 0, appLines: 0, appUnits: 0 });
    invReadSet_('ord', b + '_' + ym, 'ord_' + b + '_' + ym).rows.forEach(function (r) { o.appLines++; o.appUnits += Number(r[5]) || 0; });
  });
  return out;
}

/** One month, line by line: which Order ID + SKU the sheet has and the app does not, and the reverse.
 *  Also shows raw Date-cell samples from across the sheet, to see how the dates are stored. Read-only. */
function invDiag_(b, ym) {
  var osh = SpreadsheetApp.openById(b === 'CPC' ? '1jjDNWNF327mVQTKfmcadioB5AO5A9BP_9M1CC9t4L2o' : '1OLIo0mYIgClBuABrfivPoLG-M1xS_rLwkQpFRAF_0kA')
    .getSheetByName(b === 'CPC' ? 'CPC Orders' : 'Orders');
  var n = osh.getLastRow(), tz = osh.getParent().getSpreadsheetTimeZone(), out = { lastRow: n, tabs: osh.getParent().getSheets().map(function (x) { return x.getName() + ':' + x.getLastRow(); }), samples: [] };
  [2, 3, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1, n].forEach(function (r) {
    if (r < 2) return;
    var v = osh.getRange(r, 1, 1, 10).getValues()[0];
    out.samples.push({ row: r, raw: v.map(function (x) { return x instanceof Date ? 'DATE:' + Utilities.formatDate(x, tz, 'yyyy-MM-dd HH:mm') : String(x); }) });
  });
  if (ym) {
    var vals = osh.getRange(2, 1, n - 1, 10).getValues(), sheet = {}, app = {};
    vals.forEach(function (r) {
      var d = r[2] instanceof Date ? Utilities.formatDate(r[2], tz, 'yyyy-MM-dd') : String(r[2]).slice(0, 10);
      if (d.slice(0, 7) === ym) { var k = r[0] + '|' + r[3]; sheet[k] = (sheet[k] || 0) + 1; }
    });
    invReadSet_('ord', b + '_' + ym, 'ord_' + b + '_' + ym).rows.forEach(function (r) { var k = r[0] + '|' + r[3]; app[k] = (app[k] || 0) + 1; });
    var onlySheet = Object.keys(sheet).filter(function (k) { return !app[k]; }), onlyApp = Object.keys(app).filter(function (k) { return !sheet[k]; });
    var dupSheet = Object.keys(sheet).filter(function (k) { return sheet[k] > 1; });
    out.month = { ym: ym, sheetKeys: Object.keys(sheet).length, appKeys: Object.keys(app).length, onlySheet: onlySheet.length, onlyApp: onlyApp.length,
      sheetDupKeys: dupSheet.length, onlySheetSample: onlySheet.slice(0, 15), onlyAppSample: onlyApp.slice(0, 15), dupSample: dupSheet.slice(0, 5) };
    var pick = {}; onlySheet.slice(0, 15).forEach(function (k) { pick[k] = 1; });
    out.month.onlySheetRows = vals.filter(function (r) { return pick[r[0] + '|' + r[3]]; }).slice(0, 15).map(function (r) {
      return r.map(function (x) { return x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd HH:mm') : String(x); }); });
  }
  return out;
}

/* ===================== Web route: ?inv=… (behind the API key in doGet) ===================== */

function invRoute_(p) {
  var what = String(p.inv || '');
  if (what === 'scopes') {                      // which scopes the running token really carries (diagnosis)
    var ti = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + ScriptApp.getOAuthToken(), { muteHttpExceptions: true });
    var j = JSON.parse(ti.getContentText() || '{}');
    return { ok: true, scope: j.scope || '', email: j.email || '', err: j.error_description || '',
      triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }) };
  }
  if (what === 'compare') return { ok: true, compare: invCompare_(String(p.brand || 'SP').toUpperCase() === 'CPC' ? 'CPC' : 'SP') };
  if (what === 'diag') return { ok: true, diag: invDiag_(String(p.brand || 'SP').toUpperCase() === 'CPC' ? 'CPC' : 'SP', String(p.month || '')) };
  if (what === 'status') return { ok: true, status: invStatus_(), job: invGet_('work/job') };
  if (what === 'run') {
    var steps = invStepsFor_(String(p.job || 'refresh'), String(p.brand || 'all').toUpperCase());
    invRequest_(steps, String(p.by || ''));
    invKickSoon_(1000);
    return { ok: true, queued: steps.map(function (s) { return INV_STEP_LABEL[s.fn] + ' · ' + INV.brands[s.b].label; }) };
  }
  if (what === 'stop') {
    var j = invGet_('work/job');
    if (j && !j.done) { j.done = true; j.stopped = Date.now(); invPut_('work/job', j); invSetStatus_({ running: false, job: invJobView_(j) }); }
    return { ok: true };
  }
  if (what === 'auto') { var st = invStatus_(); st.sched = { off: p.on === '0' }; invPut_('meta/status', st); return { ok: true, sched: st.sched }; }
  if (what === 'seed') return { ok: true, seeded: invSeed_() };
  if (what === 'install') return { ok: true, installed: invInstall() };
  return { ok: false, error: 'Unknown inv action "' + what + '"' };
}
