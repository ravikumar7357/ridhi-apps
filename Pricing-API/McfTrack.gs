/* Pricing-API / McfTrack.gs — MCF tracking for the team: every MCF order, every parcel, every night. READ ONLY (17 Nov 2026).
 * LIVE since 17 Nov 2026 (installed by hand in the editor; this copy is what runs). Test: node Pricing-App/tests/mcf-track-test.js
 *
 * WHAT IT DOES. Every night (MCF_HOURS, India time) it:
 *   1. FINDS every MCF order Amazon has for both brands (Ridhi = SP, CPC) that is new or changed since the last run —
 *      Sellora's SHOP-RBP… orders, Content Creators' gifts, ones typed in Seller Central, ones from other apps: all of them.
 *   2. CHECKS every order that is not finished yet: Amazon's order status, its parcels, and each parcel's tracking
 *      (carrier, tracking number, where it is now, every scan, estimated arrival, delivered).
 *   3. WRITES one row per parcel to its own spreadsheet, "Sellora MCF Tracking", problems first, for the team to open.
 * A finished order (delivered, cancelled, Amazon cannot ship, or 30+ days old) is never asked about again, so the
 * calls stay small (~2 per open order per night) however many orders there are.
 *
 * It changes NOTHING at Amazon or Shopify: GET calls only. Own file, own timers (mcfStart once a night, then a 10-minute
 * mcfTick that switches itself off when the night's run is done), own lease, own spreadsheet. Nightly.gs, the cache
 * sheet and every other file are untouched.
 *
 * THE FLAGS (column A), worst first:
 *   Problem: <Amazon's state>  returned, undeliverable, damaged, lost, delivery attempted, waiting at a pickup point …
 *   Amazon cannot ship         the order is Unfulfillable / Invalid at Amazon
 *   Late                       past its "arrives by" date and not delivered
 *   Stuck                      in transit with no new scan for 3 days
 *   Not shipped after 2 days   received by Amazon 2+ days ago, no parcel yet
 *   Tracking not available     Amazon gave a parcel but its tracking could not be read (tried again next night)
 *   No tracking number yet     a parcel without a number yet
 *   Waiting to ship            received, under 2 days, no parcel yet
 *   On the way                 moving normally
 *   Delivered / Cancelled      finished — kept 90 days, then removed from the sheet
 *   Check by hand (30+ days)   still not finished a month after Amazon received it; no longer checked
 * One order shipped in several parcels = one row per parcel. An order with no parcel yet = one row with the parcel blank.
 *
 * RUN FROM THE EDITOR:
 *   mcfSetup()        once: creates "Sellora MCF Tracking", installs the nightly start, and starts a first run now
 *   mcfStatus()       what the last run did, any errors, the counts per flag, the spreadsheet link
 *   mcfRunNow()       start a run now instead of waiting for the night
 *   mcfStop()         removes the timers (the spreadsheet stays)
 *   mcfTrackTest()    one order in full (MCF_TEST_ID / MCF_TEST_BRAND) — to check against Seller Central and the carrier
 *   mcfListTest()     the MCF orders of the last 3 days, with their ids
 *
 * ROUTE (Code.gs → doPost, one line beside ?mcf=status):  { mcf: 'track', mcfId, brand }  →  mcfTrack_(mcfId, brand)
 */

var MCF_TEST_ID = 'SHOP-RBP8633';   // one real MCF order: its id, or the order number (RBP8633). mcfListTest() lists them.
var MCF_TEST_BRAND = 'SP';          // 'SP' (Ridhi) or 'CPC'

var MCF_HOURS = [3];                // India time: before the 5 AM nightly, so the two never compete for the call limit
var MCF_BRANDS = ['SP', 'CPC'];
var MCF_FIRST_DAYS = 90;            // the very first run looks this far back (Amazon keeps at least 90 days of MCF orders)
var MCF_GIVEUP_DAYS = 30;           // an order still open this long after Amazon received it: "Check by hand", no more checks
                                    // (an older order found on the first run is still checked ONCE, so it shows its real state)
var MCF_KEEP_DAYS = 90;             // finished orders stay on the sheet this long
var MCF_NOT_SHIPPED_DAYS = 2;
var MCF_STUCK_DAYS = 3;
var MCF_BUDGET_MS = 4 * 60000;      // work per 10-minute tick; reading and rewriting a 3,000-row sheet needs the rest of the 6 minutes
var MCF_PASS_MAX_H = 6;             // a run still going after this stops; the next night starts fresh
var MCF_GAP_MS = 250;               // pause between Amazon calls (Amazon allows ~2 a second on these)
var MCF_BOOK = 'Sellora MCF Tracking';
var MCF_TAB = 'Tracking';
// What the team sees (1–19), then three working columns the run needs (key, pass, last scan as ISO).
var MCF_COLS = ['Flag', 'Brand', 'Order', 'MCF id', 'Order status', 'Received', 'Speed', 'Parcel', 'Carrier', 'Tracking',
  'Shipped', 'Arrives by', 'Now', 'Last scan', 'Last scan at (IST)', 'Where', 'Delivered (IST)', 'Checked (IST)', 'Link',
  '_key', '_pass', '_lastIso'];
var MCF_C = {};
MCF_COLS.forEach(function (c, i) { MCF_C[c] = i; });
// An id Amazon refuses to look up (typed by hand with & or / in it): shown once, then left for a person.
var MCF_NO_LOOKUP_FLAG = 'Check in Seller Central (id has & or /)';
var MCF_RANK = ['Problem', 'Amazon cannot ship', 'Late', 'Stuck', 'Not shipped after 2 days', 'Tracking not available',
  'No tracking number yet', 'Check by hand (30+ days)', 'Check in Seller Central', 'Waiting to ship', 'On the way', 'Delivered', 'Cancelled'];
var MCF_FINISHED = { 'Delivered': 1, 'Cancelled': 1, 'Amazon cannot ship': 1, 'Check by hand (30+ days)': 1 };
MCF_FINISHED[MCF_NO_LOOKUP_FLAG] = 1;

/* ============================== one order ============================== */

/** One MCF order with every parcel's tracking. Accepts the MCF id or the customer's order number. */
function mcfTrack_(mcfId, brand) {
  var asked = String(mcfId || '').trim();
  if (!asked) return { ok: false, error: 'Give the MCF order id (for example SHOP-RBP8633) or the order number (RBP8633).' };
  setBrand_(brand || 'SP');
  var id = mcfFindId_(asked);
  if (!id) return { ok: false, error: 'No MCF order "' + asked + '" in ' + ACTIVE_PREFIX + ' (tried ' + asked + ', ' + mcfIdOf_(asked)
    + ' and the last 14 days). Is it the other brand, or older? Run mcfListTest() to see the ids Amazon has.' };
  return mcfTrackById_(id);
}

/**
 * One MCF order by its exact id (active brand). `skip` = { parcelNumber: true } for parcels already delivered, which
 * are not asked about again. A parcel whose tracking read fails keeps its row with `error`. A rate or quota refusal
 * is NOT swallowed: it is thrown, so the nightly run stops and carries on later instead of marking everything failed.
 */
function mcfTrackById_(id, skip) {
  var p;
  try {
    p = sp_('/fba/outbound/2020-07-01/fulfillmentOrders/' + encodeURIComponent(id), 'get').payload || {};
  } catch (e0) {
    // An id typed by hand with characters like & or / ("Stella & Meredy5"): Amazon refuses it encoded (400).
    // Try once with only the spaces encoded; if that fails too, say so plainly so the run stops asking every night.
    var m0 = String(e0.message || e0);
    if (mcfIsLimit_(m0) || !/SP-API 400/.test(m0) || !/[^A-Za-z0-9 _.-]/.test(id)) throw e0;
    try { p = sp_('/fba/outbound/2020-07-01/fulfillmentOrders/' + String(id).replace(/ /g, '%20'), 'get').payload || {}; }
    catch (e1) {
      if (mcfIsLimit_(e1.message)) throw e1;
      throw new Error('MCF_NO_LOOKUP Amazon will not look up this id (it has characters like & in it): ' + id);
    }
  }
  var fo = p.fulfillmentOrder || {};
  var seen = {}, pkgs = [];
  (p.fulfillmentShipments || []).forEach(function (s) {
    (s.fulfillmentShipmentPackage || []).forEach(function (k) {
      var n = k.packageNumber;
      if (n == null || seen[n]) return;
      seen[n] = 1;
      pkgs.push({ pkg: n, trk: String(k.trackingNumber || '').trim(), carrier: String(k.carrierCode || ''),
        shipDate: String(s.shippingDate || '').slice(0, 10),
        eta: String(k.estimatedArrivalDate || s.estimatedArrivalDate || '').slice(0, 10) });
    });
  });
  pkgs.forEach(function (x) {
    if (skip && skip[x.pkg]) { x.skipped = true; return; }
    try {
      if (MCF_GAP_MS) Utilities.sleep(MCF_GAP_MS);
      var t = (sp_('/fba/outbound/2020-07-01/tracking?packageNumber=' + encodeURIComponent(x.pkg), 'get').payload) || {};
      var where = function (a) { a = a || {}; return [a.city, a.state, a.country].filter(Boolean).join(', '); };
      var events = (t.trackingEvents || []).map(function (ev) {
        return { at: String(ev.eventDate || ''), where: where(ev.eventAddress), code: String(ev.eventCode || ''),
          what: String(ev.eventDescription || ev.eventCode || '') };
      }).sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });   // newest first
      x.trk = x.trk || String(t.trackingNumber || '');
      x.carrier = x.carrier || String(t.carrierCode || '');
      x.shipDate = x.shipDate || String(t.shipDate || '').slice(0, 10);
      x.eta = String(t.estimatedArrivalDate || x.eta || '').slice(0, 10);
      x.state = String(t.currentStatus || '');
      x.stateText = String(t.currentStatusDescription || '');
      x.signedBy = String(t.signedForBy || '');
      x.link = String(t.customerTrackingLink || t.carrierURL || '');
      x.deliveredAt = /DELIVERED/i.test(x.state) && events.length ? events[0].at : '';
      x.last = events[0] || null;
      x.events = events;
    } catch (e) {
      var m = String(e.message || e);
      if (mcfIsLimit_(m)) throw e;
      x.error = m.slice(0, 300);
    }
  });
  return { ok: true, mcfId: id, brand: ACTIVE_PREFIX, status: String(fo.fulfillmentOrderStatus || ''),
    received: String(fo.receivedDate || '').slice(0, 10), speed: String(fo.shippingSpeedCategory || ''),
    shown: String(fo.displayableOrderId || ''), packages: pkgs };
}

/** A refusal that means "come back later", not "this order is broken". */
function mcfIsLimit_(m) { return /SP-API 429|QuotaExceeded|too many times|rate exceeded|throttl/i.test(String(m || '')); }

/** Does Amazon have this exact MCF id (active brand)? */
function mcfExists_(id) {
  try { sp_('/fba/outbound/2020-07-01/fulfillmentOrders/' + encodeURIComponent(id), 'get'); return true; }
  catch (e) { if (/SP-API 4\d\d/.test(String(e.message || e)) && !mcfIsLimit_(e.message)) return false; throw e; }
}

/** MCF orders (active brand) created or changed since `fromIso`, newest first. */
function mcfListSince_(fromIso) {
  var out = [], token = '', guard = 0;
  do {
    var path = '/fba/outbound/2020-07-01/fulfillmentOrders?queryStartDate=' + encodeURIComponent(fromIso)
      + (token ? '&nextToken=' + encodeURIComponent(token) : '');
    var p = sp_(path, 'get').payload || {};
    out = out.concat(p.fulfillmentOrders || []);
    token = p.nextToken || '';
    if (token && MCF_GAP_MS) Utilities.sleep(MCF_GAP_MS);
  } while (token && ++guard < 200);
  if (token) Logger.log('mcfListSince_: stopped after 200 pages (' + out.length + ' orders) — the list is cut short.');
  return out.sort(function (a, b) { return String(b.receivedDate || '') < String(a.receivedDate || '') ? -1 : 1; });
}
function mcfList_(days) { return mcfListSince_(new Date(Date.now() - (days || 3) * 86400000).toISOString()); }

/** The MCF id for what was typed: as given, as Sellora makes it (SHOP-…), or found by the customer's order number. */
function mcfFindId_(asked) {
  if (mcfExists_(asked)) return asked;
  var made = mcfIdOf_(asked);
  if (made !== asked && mcfExists_(made)) return made;
  var key = String(asked).replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
  var hit = mcfList_(14).filter(function (o) {
    return [o.sellerFulfillmentOrderId, o.displayableOrderId].some(function (v) {
      return String(v || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase().indexOf(key) >= 0;
    });
  })[0];
  return hit ? String(hit.sellerFulfillmentOrderId) : '';
}

/* ============================== the flags ============================== */

/** The flag for one row (one parcel, or an order with no parcel yet). `now` ms; today's US date for "arrives by". */
function mcfFlag_(r, now) {
  var st = String(r[MCF_C['Order status']] || '');
  var recMs = Date.parse(String(r[MCF_C['Received']] || '') + 'T00:00:00Z') || now;
  var ageDays = (now - recMs) / 86400000;
  if (/cancel/i.test(st)) return 'Cancelled';
  if (/unfulfillable|invalid/i.test(st)) return 'Amazon cannot ship';
  var parcel = String(r[MCF_C['Parcel']] || '');
  var state = String(r[MCF_C['Now']] || '');
  if (parcel && /DELIVERED/i.test(state) && !/UNDELIVER|ATTEMPT/i.test(state)) return 'Delivered';
  if (ageDays > MCF_GIVEUP_DAYS) return 'Check by hand (30+ days)';
  if (!parcel) return ageDays >= MCF_NOT_SHIPPED_DAYS ? 'Not shipped after 2 days' : 'Waiting to ship';
  if (/RETURN|UNDELIVER|REJECT|LOST|DAMAGE|EXCEPTION|ATTEMPT|PICKUP|CUSTOMER_ACTION|DELAY|HOLD|ADDRESS|REFUSED/i.test(state)) {
    return 'Problem: ' + state;
  }
  if (!String(r[MCF_C['Tracking']] || '')) return 'No tracking number yet';
  var todayUs = Utilities.formatDate(new Date(now), ORDERS_PT, 'yyyy-MM-dd');
  var eta = String(r[MCF_C['Arrives by']] || '');
  if (eta && eta < todayUs) return 'Late';
  var lastMs = Date.parse(String(r[MCF_C['_lastIso']] || '')) || 0;
  var shipMs = Date.parse(String(r[MCF_C['Shipped']] || '') + 'T00:00:00Z') || 0;
  if (now - Math.max(lastMs, shipMs) > MCF_STUCK_DAYS * 86400000 && (lastMs || shipMs)) return 'Stuck';
  if (!state && !lastMs) return 'Tracking not available';
  return 'On the way';
}
function mcfRankOf_(flag) {
  var f = String(flag || '');
  for (var i = 0; i < MCF_RANK.length; i++) if (f.indexOf(MCF_RANK[i]) === 0) return i;
  return MCF_RANK.length;
}
function mcfIst_(iso) {
  var t = Date.parse(String(iso || ''));
  return t ? Utilities.formatDate(new Date(t), 'Asia/Kolkata', 'dd MMM HH:mm') : '';
}

/* ============================== the spreadsheet ============================== */

function mcfBook_(create) {
  var id = prop_('MCF_BOOK_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); }
    catch (e1) {
      Utilities.sleep(2000);
      try { return SpreadsheetApp.openById(id); }
      catch (e2) { throw new Error('"' + MCF_BOOK + '" ' + id + ' will not open: ' + (e2.message || e2) + '. Nothing was written.'); }
    }
  }
  if (!create) throw new Error('No "' + MCF_BOOK + '" yet — run mcfSetup() once.');
  var ss = SpreadsheetApp.create(MCF_BOOK);
  PropertiesService.getScriptProperties().setProperty('MCF_BOOK_ID', ss.getId());
  var sh = ss.getSheets()[0];
  sh.setName(MCF_TAB);
  return ss;
}

/** Every row as an array of MCF_COLS.length values (the header left out). */
function mcfRead_() {
  var sh = mcfBook_().getSheetByName(MCF_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  var w = MCF_COLS.length;
  return sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues().map(function (r) {
    return r.map(function (v) { return v instanceof Date ? Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd') : v; });
  });
}

/** Write every row back, worst flag first, finished ones older than MCF_KEEP_DAYS dropped. */
function mcfWrite_(rows, now) {
  var keepFrom = now - MCF_KEEP_DAYS * 86400000;
  rows = rows.filter(function (r) {
    if (!MCF_FINISHED[r[MCF_C['Flag']]]) return true;
    var rec = Date.parse(String(r[MCF_C['Received']] || '') + 'T00:00:00Z') || now;
    return rec >= keepFrom;
  });
  rows.sort(function (a, b) {
    var d = mcfRankOf_(a[0]) - mcfRankOf_(b[0]);
    if (d) return d;
    return String(b[MCF_C['Received']]) < String(a[MCF_C['Received']]) ? -1 : 1;
  });
  var ss = mcfBook_();
  var sh = ss.getSheetByName(MCF_TAB) || ss.insertSheet(MCF_TAB);
  var data = [MCF_COLS].concat(rows.map(function (r) { return r.map(function (v) { return v == null ? '' : v; }); }));
  sh.clear();
  // Plain text, so Sheets never turns a tracking number into 9.36E+21 or an order number into a date.
  sh.getRange(1, 1, data.length, MCF_COLS.length).setNumberFormat('@').setValues(data);
  sh.setFrozenRows(1);
  try {
    sh.getRange(1, 1, 1, MCF_COLS.length).setFontWeight('bold');
    sh.hideColumns(MCF_C['_key'] + 1, 3);
    var maxR = sh.getMaxRows();
    if (maxR > data.length + 50) sh.deleteRows(data.length + 51, maxR - data.length - 50);
  } catch (e) { /* looks only */ }
  return rows;
}

/* ============================== the nightly run ============================== */

function mcfState_() { try { return JSON.parse(prop_('MCF_STATE') || '{}'); } catch (e) { return {}; } }
function mcfSave_(st) {
  var s = JSON.stringify(st);
  while (s.length > 8500 && st.errors && st.errors.length) { st.errors.shift(); s = JSON.stringify(st); }
  PropertiesService.getScriptProperties().setProperty('MCF_STATE', s);
}
function mcfErr_(st, msg) {
  st.errors = (st.errors || []).concat('[' + nowStamp_() + '] ' + String(msg).slice(0, 180)).slice(-10);
}

function mcfSetup() {
  var ss;
  try { ss = mcfBook_(true); } catch (e) { Logger.log('❌ ' + (e.message || e)); return; }
  mcfStop();
  MCF_HOURS.forEach(function (h) { ScriptApp.newTrigger('mcfStart').timeBased().atHour(h).everyDays(1).create(); });
  Logger.log('✓ "' + MCF_BOOK + '": ' + ss.getUrl());
  Logger.log('✓ runs every night at ' + MCF_HOURS.join(':00, ') + ':00 India time. A first run starts now: 90 days of orders, about 2–3 hours in 10-minute steps.');
  Logger.log('  Share the spreadsheet with the team as Viewer (Share button). Do not edit it by hand: each run rewrites it.');
  mcfRunNow();
}

function mcfStop() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'mcfStart' || h === 'mcfTick') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('mcfStop: ' + n + ' timer(s) removed.');
}

function mcfRunNow() { var st = mcfState_(); st.reset = true; mcfSave_(st); mcfStart(); }

/** Look back MCF_FIRST_DAYS (90) days again and add every older order (each checked once). Only between runs. */
function mcfBackfill() {
  var st = mcfState_();
  var lease = Number(prop_('MCF_LEASE') || 0);
  if ((st.phase === 'discover' || st.phase === 'check') || (lease && Date.now() - lease < 7 * 60000)) {
    Logger.log('A run is still going (' + st.phase + '). Wait until mcfStatus says "done", then run mcfBackfill again.');
    return;
  }
  st.since = {};
  st.reset = true;
  mcfSave_(st);
  Logger.log('Backfill: the next run looks back ' + MCF_FIRST_DAYS + ' days. Starting now — it carries on every 10 minutes (about 2 hours).');
  mcfStart();
}

/** The nightly starter: switch the 10-minute tick on and take the first tick now. */
function mcfStart() {
  var on = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'mcfTick'; });
  if (!on) ScriptApp.newTrigger('mcfTick').timeBased().everyMinutes(10).create();
  var st = mcfState_();
  if (st.phase !== 'discover' && st.phase !== 'check') st.reset = true;
  mcfSave_(st);
  mcfTick();
}

function mcfTick() {
  var props = PropertiesService.getScriptProperties();
  var lease = Number(props.getProperty('MCF_LEASE') || 0);
  if (lease && Date.now() - lease < 7 * 60000) { Logger.log('mcfTick: another run is still going — skipped.'); return; }
  props.setProperty('MCF_LEASE', String(Date.now()));
  var saved = ACTIVE_PREFIX;
  try { mcfTick_(); }
  finally { setBrand_(saved); props.deleteProperty('MCF_LEASE'); }
  var st = mcfState_();
  if (st.phase === 'done') {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'mcfTick') ScriptApp.deleteTrigger(t); });
  }
}

function mcfTick_() {
  var t0 = Date.now();
  var left = function () { return MCF_BUDGET_MS - (Date.now() - t0); };
  var st = mcfState_();
  if (st.reset) {
    st = { pass: String(Date.now()), phase: 'discover', startedMs: Date.now(), startedAt: nowStamp_(),
      since: st.since || {}, errors: (st.errors || []).slice(-4), n: { calls: 0, found: 0, checked: 0 } };
    mcfSave_(st);
  }
  if (st.phase !== 'discover' && st.phase !== 'check') return;
  if (Date.now() - (st.startedMs || 0) > MCF_PASS_MAX_H * 3600000) {
    mcfErr_(st, 'run stopped after ' + MCF_PASS_MAX_H + ' h; what was not checked is checked tomorrow night');
    st.phase = 'done'; st.endedAt = nowStamp_(); mcfSave_(st); return;
  }
  var now = Date.now();
  var rows = mcfRead_();
  var byKey = {};
  rows.forEach(function (r) { (byKey[r[MCF_C['_key']]] || (byKey[r[MCF_C['_key']]] = [])).push(r); });
  var blank = function () { return MCF_COLS.map(function () { return ''; }); };
  var stop = false;

  try {
    // 1. FIND: every MCF order new or changed since the last run (one day of overlap), both brands.
    if (st.phase === 'discover') {
      MCF_BRANDS.forEach(function (b) {
        if (stop || (st.found || {})[b]) return;
        setBrand_(b);
        var from = st.since[b] ? new Date(Date.parse(st.since[b]) - 86400000) : new Date(now - MCF_FIRST_DAYS * 86400000);
        var list = mcfListSince_(from.toISOString());
        st.n.calls += Math.max(1, Math.ceil(list.length / 50));
        list.forEach(function (o) {
          var id = String(o.sellerFulfillmentOrderId || '');
          if (!id) return;
          var key = b + '|' + id;
          var have = byKey[key];
          if (!have) {
            var r = blank();
            r[MCF_C['_key']] = key; r[MCF_C['Brand']] = b === 'CPC' ? 'CPC' : 'Ridhi'; r[MCF_C['MCF id']] = id;
            r[MCF_C['Order']] = String(o.displayableOrderId || id).replace(/^#\s*/, '');
            r[MCF_C['Received']] = String(o.receivedDate || '').slice(0, 10);
            r[MCF_C['Speed']] = String(o.shippingSpeedCategory || '');
            r[MCF_C['Order status']] = String(o.fulfillmentOrderStatus || '');
            r[MCF_C['Flag']] = mcfFlag_(r, now);
            rows.push(r); byKey[key] = [r]; st.n.found++;
          } else {
            // A finished order whose status changed at Amazon (say, a return) comes back to life.
            have.forEach(function (r) {
              r[MCF_C['Order status']] = String(o.fulfillmentOrderStatus || r[MCF_C['Order status']]);
              if (MCF_FINISHED[r[MCF_C['Flag']]] && !/cancel|complete/i.test(r[MCF_C['Order status']])) r[MCF_C['Flag']] = '';
            });
          }
        });
        st.found = st.found || {}; st.found[b] = 1;
        st.since[b] = new Date(now).toISOString();
      });
      if (!stop) st.phase = 'check';
      mcfSave_(st);
    }

    // 2. CHECK: every order not finished and not yet checked in this run.
    if (st.phase === 'check') {
      var todo = Object.keys(byKey).filter(function (k) {
        var rs = byKey[k];
        // Never checked yet (found on this run, or the 90-day first run): checked once whatever its age.
        if (rs.every(function (r) { return !r[MCF_C['_pass']]; })) return true;
        if (rs.every(function (r) { return MCF_FINISHED[r[MCF_C['Flag']]]; })) return false;
        return rs.some(function (r) { return String(r[MCF_C['_pass']]) !== st.pass; });
      });
      for (var i = 0; i < todo.length; i++) {
        if (left() < 75000) { stop = true; break; }      // leave time to write the sheet and save the counts
        var key = todo[i], rs = byKey[key], brand = key.split('|')[0], id = key.slice(brand.length + 1);
        setBrand_(brand);
        // Parcels already delivered are not asked about again.
        var skip = {};
        rs.forEach(function (r) { if (r[MCF_C['Flag']] === 'Delivered' && r[MCF_C['Parcel']]) skip[r[MCF_C['Parcel']]] = true; });
        var o;
        try {
          o = mcfTrackById_(id, skip);
        } catch (e) {
          var m = String(e.message || e);
          if (mcfIsLimit_(m)) { mcfErr_(st, 'Amazon asked us to slow down (' + m.slice(0, 80) + '); carrying on in 10 minutes'); stop = true; break; }
          var noLookup = /MCF_NO_LOOKUP/.test(m);
          mcfErr_(st, brand + ' ' + id + ': ' + (noLookup ? 'Amazon will not look up this id (& or / in it) — marked "Check in Seller Central"' : m.slice(0, 140)));
          rs.forEach(function (r) {
            r[MCF_C['_pass']] = st.pass; r[MCF_C['Checked (IST)']] = mcfIst_(new Date().toISOString());
            if (noLookup) r[MCF_C['Flag']] = MCF_NO_LOOKUP_FLAG;   // finished: not asked again every night
          });
          continue;
        }
        st.n.calls += 1 + o.packages.filter(function (x) { return !x.skipped; }).length;
        st.n.checked++;
        var base = rs[0], next = [];
        var fill = function (r) {
          r[MCF_C['_key']] = key; r[MCF_C['Brand']] = base[MCF_C['Brand']]; r[MCF_C['MCF id']] = id;
          r[MCF_C['Order']] = o.shown ? o.shown.replace(/^#\s*/, '') : base[MCF_C['Order']];
          r[MCF_C['Order status']] = o.status; r[MCF_C['Received']] = o.received || base[MCF_C['Received']];
          r[MCF_C['Speed']] = o.speed || base[MCF_C['Speed']];
          r[MCF_C['_pass']] = st.pass; r[MCF_C['Checked (IST)']] = mcfIst_(new Date().toISOString());
          return r;
        };
        if (!o.packages.length) next.push(fill(blank()));
        o.packages.forEach(function (x) {
          var old = rs.filter(function (r) { return String(r[MCF_C['Parcel']]) === String(x.pkg); })[0];
          var r = fill(old ? old.slice() : blank());
          r[MCF_C['Parcel']] = String(x.pkg);
          if (x.skipped) { next.push(r); return; }
          r[MCF_C['Carrier']] = x.carrier; r[MCF_C['Tracking']] = x.trk; r[MCF_C['Shipped']] = x.shipDate; r[MCF_C['Arrives by']] = x.eta;
          if (x.error) {
            r._trkErr = true;
          } else {
            r[MCF_C['Now']] = x.stateText ? x.state + ' — ' + x.stateText : x.state;
            r[MCF_C['Last scan']] = x.last ? x.last.what : '';
            r[MCF_C['Last scan at (IST)']] = x.last ? mcfIst_(x.last.at) : '';
            r[MCF_C['Where']] = x.last ? x.last.where : '';
            r[MCF_C['_lastIso']] = x.last ? x.last.at : '';
            r[MCF_C['Delivered (IST)']] = x.deliveredAt ? mcfIst_(x.deliveredAt) + (x.signedBy ? ' · signed ' + x.signedBy : '') : '';
            r[MCF_C['Link']] = x.link;
          }
          next.push(r);
        });
        next.forEach(function (r) {
          r[MCF_C['Flag']] = mcfFlagRow_(r, now);
          delete r._trkErr;
        });
        // Replace this order's rows.
        rows = rows.filter(function (r) { return r[MCF_C['_key']] !== key; }).concat(next);
        byKey[key] = next;
      }
      if (!stop && i >= todo.length) { st.phase = 'done'; st.endedAt = nowStamp_(); }
    }
  } catch (e) {
    var msg = String(e.message || e);
    mcfErr_(st, (mcfIsLimit_(msg) ? 'Amazon asked us to slow down: ' : 'stopped: ') + msg.slice(0, 160));
  }

  // Every row's flag again (ages move on even for orders not checked tonight), then write.
  rows.forEach(function (r) { if (!MCF_FINISHED[r[MCF_C['Flag']]]) r[MCF_C['Flag']] = mcfFlagRow_(r, now); });
  var written = mcfWrite_(rows, now);
  st.rows = written.length;
  st.flags = {};
  written.forEach(function (r) { var f = String(r[0]).split(':')[0]; st.flags[f] = (st.flags[f] || 0) + 1; });
  mcfSave_(st);
}

/** mcfFlag_ with the "tracking could not be read" mark, which lives on the row only while a run is building it. */
function mcfFlagRow_(r, now) {
  if (r._trkErr) {
    var f = mcfFlag_(r, now);
    return /^(Cancelled|Amazon cannot ship|Check by hand)/.test(f) ? f : 'Tracking not available';
  }
  return mcfFlag_(r, now);
}

function mcfStatus() {
  var st = mcfState_();
  Logger.log('Run of ' + (st.startedAt || '—') + ': ' + (st.phase || 'not started') + (st.endedAt ? ' · ended ' + st.endedAt : '')
    + ' · new orders ' + ((st.n || {}).found || 0) + ' · orders checked ' + ((st.n || {}).checked || 0)
    + ' · Amazon calls ~' + ((st.n || {}).calls || 0));
  Logger.log('Rows on the sheet: ' + (st.rows || 0));
  Object.keys(st.flags || {}).sort(function (a, b) { return mcfRankOf_(a) - mcfRankOf_(b); })
    .forEach(function (f) { Logger.log('   ' + f + ': ' + st.flags[f]); });
  (st.errors || []).forEach(function (e) { Logger.log('  ! ' + e); });
  var hs = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  Logger.log('timers: mcfStart ' + (hs.indexOf('mcfStart') >= 0 ? 'on (' + MCF_HOURS.join(':00, ') + ':00)' : 'MISSING — run mcfSetup()')
    + ' · mcfTick ' + (hs.indexOf('mcfTick') >= 0 ? 'running' : 'off until the night'));
  var id = prop_('MCF_BOOK_ID');
  if (id) Logger.log('sheet https://docs.google.com/spreadsheets/d/' + id + '/edit');
}

/* ============================== editor checks ============================== */

/** One real MCF order's tracking, written out so it can be checked against Seller Central and the carrier. */
function mcfTrackTest() {
  var r = mcfTrack_(MCF_TEST_ID, MCF_TEST_BRAND);
  if (!r.ok) { Logger.log('❌ ' + r.error); return; }
  Logger.log('MCF order ' + r.mcfId + ' (' + r.brand + ') · status ' + r.status + ' · received ' + r.received + ' · ' + r.speed);
  if (!r.packages.length) Logger.log('   no package yet — Amazon has not shipped it.');
  r.packages.forEach(function (x, i) {
    Logger.log('Package ' + (i + 1) + ' · #' + x.pkg + ' · ' + x.carrier + ' ' + x.trk);
    if (x.error) { Logger.log('   tracking read failed: ' + x.error); return; }
    Logger.log('   now: ' + (x.state || '?') + (x.stateText ? ' (' + x.stateText + ')' : '') + ' · shipped ' + (x.shipDate || '?')
      + ' · arrives by ' + (x.eta || '?') + (x.deliveredAt ? ' · DELIVERED ' + x.deliveredAt : '') + (x.signedBy ? ' · signed ' + x.signedBy : ''));
    if (x.link) Logger.log('   tracking link: ' + x.link);
    (x.events || []).slice(0, 8).forEach(function (ev) { Logger.log('   ' + ev.at + '  ' + ev.what + (ev.where ? ' — ' + ev.where : '')); });
    if ((x.events || []).length > 8) Logger.log('   … ' + (x.events.length - 8) + ' older scan(s)');
  });
}

/** The MCF orders of MCF_TEST_BRAND changed in the last 3 days, with both ids. */
function mcfListTest() {
  setBrand_(MCF_TEST_BRAND);
  var list = mcfList_(3);
  Logger.log(list.length + ' MCF order(s) in ' + ACTIVE_PREFIX + ' changed in the last 3 days. Newest 20:');
  list.slice(0, 20).forEach(function (o) {
    Logger.log('  id ' + o.sellerFulfillmentOrderId + '  ·  shown to customer as ' + (o.displayableOrderId || '—')
      + '  ·  ' + String(o.receivedDate || '').slice(0, 10) + '  ·  ' + (o.fulfillmentOrderStatus || ''));
  });
}
