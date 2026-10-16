/* Pricing-API / ShopifyCache.gs — THE SHARED COPY OF THE SHOPIFY ORDERS (2026-10-15, docs/shopify-fast-orders/PLAN.md
 * phase 3). Built and tested locally; NOT installed. Nothing here runs until somebody runs shopCacheInstall().
 *
 * Every five minutes, 8 AM to 10 PM IST, this asks each store "what CHANGED since?" (Shopify.gs, since mode) and writes
 * the changed orders into Firestore, one document per store per DAY PLACED, then the contents page LAST — so a screen
 * that reads the contents page never sees half a save. Screens listen to the contents page only and re-read the days
 * whose time moved (src/app/shopify/shopify-copy.js).
 *
 *   shopify_cache/meta            the contents page: { json: { v, stores: { SP|CPC: { cursor, syncedAt, filledFrom,
 *                                 days: { 'YYYY-MM-DD': ms } } }, log: [...], writes: { day, n }, prunedDay } }
 *   shopify_cache_days/SP_<day>   one day's orders: { json: { store, day, orders: { id: order } } }
 *
 * HOW IT REACHES FIRESTORE: with the script owner's own token (ScriptApp.getOAuthToken + the datastore scope in
 * appsscript.json) — no key file. The owner (ravi@thefabricrush.com) is an owner of the Firebase project, and an IAM
 * token is not subject to the security rules; the rules (Pricing-App/firestore.rules) only let the Shopify team READ.
 *
 * SHOPIFY IS THE MASTER, here as everywhere: a sync only ever copies what Shopify says.
 * Measured 15 Oct before building (PLAN.md phase 3 checks): Firestore reads ~5k/day (peak ~9k) of 50k; nightlyTick
 * uses ~160 min/day of trigger time — over the free-Gmail 90, so the account runs under the 6 h limit. This job adds
 * about 168 short runs a day. */

var SC = {
  ver: 1,                         // = SO_COPY.ver in shopify-copy.js; tests/shopify-copy-test.js holds them together
  proj: 'price-research-48ff3',
  startH: 8, endH: 22,            // working hours, IST (the script's own zone)
  overlapMs: 5 * 60 * 1000,       // every "changed since" starts five minutes before the last one ended
  fillDays: 30,                   // a store with no copy yet is filled with this many days
  keepDays: 90,                   // finished orders older than this leave the shared copy
  stripDays: 60,                  // customer details leave every order older than this
  budget: 5000,                   // writes a day before the job slows to every 30 minutes
  slowEvery: 30,
  alertAfter: 3,                  // failed syncs in a row before one email
  deadlineMs: 4 * 60 * 1000,
  logMax: 20,
  maxDocBytes: 900000,            // Firestore holds 1 MB a document; a day this big is refused, loudly
};
var SC_BRANDS = ['SP', 'CPC'];

/* ---------- Firestore over REST, as the script's owner ---------- */

function scBase_() { return 'https://firestore.googleapis.com/v1/projects/' + SC.proj + '/databases/(default)/documents'; }
function scName_(path) { return 'projects/' + SC.proj + '/databases/(default)/documents/' + path; }

/** One document's `json` field, parsed — or null when there is no such document. */
function scRead_(path) {
  var r = UrlFetchApp.fetch(scBase_() + '/' + path, { muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
  var code = r.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('Firestore ' + code + ' reading ' + path + ': ' + r.getContentText().slice(0, 200));
  var f = (JSON.parse(r.getContentText() || '{}').fields || {});
  return f.json && f.json.stringValue ? JSON.parse(f.json.stringValue) : null;
}

/** A write that puts `obj` at `path` (whole document). */
function scPut_(path, obj) {
  var s = JSON.stringify(obj);
  if (s.length > SC.maxDocBytes) throw new Error(path + ' is ' + s.length + ' bytes — over what one document holds');
  return { update: { name: scName_(path), fields: { json: { stringValue: s }, at: { integerValue: String(Date.now()) } } } };
}
function scDel_(path) { return { 'delete': scName_(path) }; }

/** Several writes, all or none. Returns how many. */
function scCommit_(writes) {
  if (!writes.length) return 0;
  for (var i = 0; i < writes.length; i += 400) {
    var r = UrlFetchApp.fetch(scBase_() + ':commit', { method: 'post', muteHttpExceptions: true, contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, payload: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
    if (r.getResponseCode() >= 300) throw new Error('Firestore ' + r.getResponseCode() + ' writing: ' + r.getContentText().slice(0, 200));
  }
  return writes.length;
}

/* ---------- the same rules as the device copy (shopify-copy.js), in this script's dialect ---------- */

function scMs_(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? 0 : t; }
function scDone_(o) { return !!o && (String(o.ff || '').toLowerCase() === 'fulfilled' || !!o.cancelledAt); }
function scDayIso_(ms) { return Utilities.formatDate(new Date(ms), 'Asia/Kolkata', 'yyyy-MM-dd'); }

/** No name, street, zip, phone or email on a finished order, nor on any order older than 60 days. */
function scStrip_(o, nowMs) {
  var old = String(o.at || '') < scDayIso_((nowMs || Date.now()) - SC.stripDays * 86400000);
  if (!scDone_(o) && !old) return o;
  var s = o.ship || {}, c = JSON.parse(JSON.stringify(o));
  c.email = '';
  c.ship = { name: '', company: '', a1: '', a2: '', city: '', zip: '', phone: '', state: s.state || '', country: s.country || '' };
  return c;
}

/** Merge into one day's orders by id: a removal drops it, an older version never replaces a newer one. */
function scMerge_(map, incoming, nowMs) {
  var n = 0;
  (incoming || []).forEach(function (o) {
    if (!o || !o.id) return;
    var id = String(o.id), had = map[id];
    if (o.gone) { if (had) { delete map[id]; n++; } return; }
    if (had && scMs_(o.upd) < scMs_(had.upd)) return;
    map[id] = scStrip_(o, nowMs);
    n++;
  });
  return n;
}

/* ---------- the sync ---------- */

function scProps_() { return PropertiesService.getScriptProperties(); }

/**
 * One sync of both stores. opts.force: outside working hours too (the Refresh button), waiting a little for the lock.
 * Returns { ok, skipped?, stores: { SP: {...}, CPC: {...} }, writes }.
 */
function shopCacheSync_(opts) {
  opts = opts || {};
  var now = Date.now();
  var hour = Number(Utilities.formatDate(new Date(now), 'Asia/Kolkata', 'H'));
  var minute = Number(Utilities.formatDate(new Date(now), 'Asia/Kolkata', 'm'));
  if (!opts.force && (hour < SC.startH || hour >= SC.endH)) return { ok: true, skipped: 'outside working hours' };
  /* NOT WHILE THE NIGHTLY RUN IS WORKING. nightlyTick holds the script lock while it runs; this waits for nothing. */
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(opts.force ? 10000 : 0)) return { ok: true, skipped: 'the nightly run is working' };
  var out = { ok: true, stores: {}, writes: 0 };
  try {
    var meta = scRead_('shopify_cache/meta') || {};
    if (meta.v !== SC.ver) meta = { v: SC.ver, stores: {}, log: [] };    // another format: start again
    meta.stores = meta.stores || {};
    var today = scDayIso_(now);
    if (!meta.writes || meta.writes.day !== today) meta.writes = { day: today, n: 0 };
    /* BUDGET GUARD: near the day's ceiling it runs every 30 minutes instead of every 5, rather than eat the quota. */
    if (!opts.force && meta.writes.n > SC.budget && minute % SC.slowEvery >= 5) return { ok: true, skipped: 'over the day\'s write budget — slowed' };
    var deadline = now + SC.deadlineMs;
    SC_BRANDS.forEach(function (b) {
      var t0 = Date.now(), r = { store: b };
      try {
        var st = meta.stores[b] || { days: {} };
        st.days = st.days || {};
        var res = scSyncStore_(b, st, deadline, now);
        r.mode = res.mode; r.orders = res.orders; r.days = res.days; r.partial = res.partial || false;
        out.writes += scCommit_(res.writes);      // the days first…
        meta.stores[b] = st;
      } catch (e) { r.err = String(e.message || e).slice(0, 200); out.ok = false; }
      r.ms = Date.now() - t0;
      out.stores[b] = r;
    });
    out.writes += scPrune_(meta, now);
    if (Date.now() < deadline) {
      try { out.writes += scCountCheck_(meta, now, deadline, out); }
      catch (e) { out.count = { err: String(e.message || e).slice(0, 200) }; }
    }
    meta.writes.n += out.writes + 1;
    meta.log = (meta.log || []).concat([{ at: new Date(now).toISOString(), ok: out.ok, writes: out.writes, stores: out.stores,
      count: out.count || null }]).slice(-SC.logMax);
    scCommit_([scPut_('shopify_cache/meta', meta)]);   // …the contents page LAST
    Logger.log('shopify cache: ' + JSON.stringify(out));
    return out;
  } finally { lock.releaseLock(); }
}

/** One store: a fill (no cursor yet) or "changed since". Changes `st`; returns the day writes, not yet sent. */
function scSyncStore_(b, st, deadline, now) {
  setShopBrand_(b === 'CPC' ? 'CPC' : '');
  var got = [], cursor = '', mode, partial = false, complete = false;
  if (!st.cursor) {
    mode = 'fill';
    var from = scDayIso_(now - SC.fillDays * 86400000), to = scDayIso_(now + 86400000);
    var f = shopifyOrders_(from, to, false, deadline, { photos: false });
    if (f.more) throw new Error('the first fill did not fit in one run — nothing written');
    got = f.orders; cursor = f.cursor; st.filledFrom = from; complete = true;
  } else {
    mode = 'since';
    var since = new Date(scMs_(st.cursor) - SC.overlapMs).toISOString(), next = '';
    for (var p = 0; p < 20; p++) {
      var r = shopifyOrders_(null, null, false, deadline, { since: since, next: next, photos: false });
      if (!p) cursor = r.cursor;
      got = got.concat(r.orders || []);
      if (!r.next) break;
      next = r.next;
      if (Date.now() > deadline) { partial = true; break; }
    }
  }
  /* By day placed. A day inside the filled range is complete, so a fill REPLACES it; a "changed since" merges. */
  var byDay = {};
  got.forEach(function (o) { var d = String(o.at || ''); if (d) (byDay[d] = byDay[d] || []).push(o); });
  var writes = [];
  Object.keys(byDay).forEach(function (d) {
    var path = 'shopify_cache_days/' + b + '_' + d;
    var doc = complete ? null : scRead_(path);
    var map = (doc && doc.orders) || {};
    scMerge_(map, byDay[d], now);
    writes.push(scPut_(path, { store: b, day: d, orders: map }));
    st.days[d] = now;
  });
  /* The cursor moves only when Shopify has said everything; a partial run is asked again from the same place. */
  if (!partial && cursor) st.cursor = cursor;
  if (!partial) st.syncedAt = now;
  return { mode: mode, orders: got.length, days: Object.keys(byDay).length, writes: writes, partial: partial };
}

/** Once a day: days older than 90 leave (their unfinished orders stay, in the same document), and the day that has
 *  just turned 60 loses its customer details. Returns the writes made. */
function scPrune_(meta, now) {
  var today = scDayIso_(now);
  if (meta.prunedDay === today) return 0;
  meta.prunedDay = today;
  var keep = scDayIso_(now - SC.keepDays * 86400000), strip = scDayIso_(now - (SC.stripDays + 1) * 86400000);
  var writes = [];
  SC_BRANDS.forEach(function (b) {
    var st = meta.stores[b];
    if (!st || !st.days) return;
    Object.keys(st.days).forEach(function (d) {
      if (d >= keep && d !== strip) return;
      var path = 'shopify_cache_days/' + b + '_' + d, doc = scRead_(path);
      if (!doc) { delete st.days[d]; return; }
      var map = {};
      Object.keys(doc.orders || {}).forEach(function (id) {
        var o = doc.orders[id];
        if (d < keep && scDone_(o)) return;
        map[id] = scStrip_(o, now);
      });
      if (!Object.keys(map).length) { writes.push(scDel_(path)); delete st.days[d]; }
      else { writes.push(scPut_(path, { store: b, day: d, orders: map })); st.days[d] = now; }
    });
  });
  return scCommit_(writes);
}

/** THE COUNT CHECK (phase 4), once a day: Shopify's order ids per day (shopifyOrderIds_) against the shared copy's,
 *  over the days the copy holds whole. A day that does not match is loaded again whole — the only way an order
 *  DELETED on Shopify leaves the copy, since "changed since" never reports one. Returns the writes made. */
function scCountCheck_(meta, now, deadline, out) {
  var today = scDayIso_(now);
  if (meta.countedDay === today) return 0;
  meta.countedDay = today;
  var writes = [], rep = {};
  SC_BRANDS.forEach(function (b) {
    var st = meta.stores[b];
    if (!st || !st.filledFrom || !st.cursor) return;
    setShopBrand_(b === 'CPC' ? 'CPC' : '');
    var from = st.filledFrom > scDayIso_(now - SC.fillDays * 86400000) ? st.filledFrom : scDayIso_(now - SC.fillDays * 86400000);
    var to = scDayIso_(now);
    var ids = shopifyOrderIds_(from, to, deadline);
    if (ids.more) { rep[b] = 'too many to count in one run'; return; }
    var bad = [];
    var days = {};
    Object.keys(ids.days || {}).concat(Object.keys(st.days || {})).forEach(function (d) { if (d >= from && d <= to) days[d] = 1; });
    Object.keys(days).forEach(function (d) {
      var doc = st.days[d] ? scRead_('shopify_cache_days/' + b + '_' + d) : null;
      var mine = Object.keys((doc && doc.orders) || {}).sort().join(), theirs = (ids.days[d] || []).slice().sort().join();
      if (mine !== theirs) bad.push(d);
    });
    bad.sort();
    if (bad.length) {
      var f = shopifyOrders_(bad[0], bad[bad.length - 1], false, deadline, { photos: false });
      if (f.more) { rep[b] = 'mismatched days too many to reload in one run: ' + bad.join(', '); return; }
      bad.forEach(function (d) {
        var map = {};
        scMerge_(map, (f.orders || []).filter(function (o) { return o.at === d; }), now);
        var path = 'shopify_cache_days/' + b + '_' + d;
        if (Object.keys(map).length) { writes.push(scPut_(path, { store: b, day: d, orders: map })); st.days[d] = now; }
        else { writes.push(scDel_(path)); delete st.days[d]; }
      });
    }
    rep[b] = { days: Object.keys(days).length, reloaded: bad };
  });
  if (out) out.count = rep;
  return scCommit_(writes);
}

/* ---------- the timer, the alert, the Refresh button ---------- */

/** The five-minute trigger. Counts failures; the third in a row sends ONE email. */
function shopCacheTick() {
  var props = scProps_(), res;
  try { res = shopCacheSync_({}); }
  catch (e) { res = { ok: false, err: String(e.message || e).slice(0, 300) }; }
  if (res.skipped) return res;
  var fails = res.ok ? 0 : Number(props.getProperty('SHOP_CACHE_FAILS') || 0) + 1;
  props.setProperty('SHOP_CACHE_FAILS', String(fails));
  if (fails === SC.alertAfter) {
    var to = props.getProperty('SHOP_CACHE_ALERT_TO') || Session.getEffectiveUser().getEmail();
    try {
      MailApp.sendEmail(to, 'Shopify orders copy: ' + SC.alertAfter + ' syncs in a row failed',
        'The shared copy of the Shopify orders has not been brought up to date for the last ' + SC.alertAfter + ' runs.\n\n'
        + 'Last answer: ' + JSON.stringify(res) + '\n\nThe Orders tab falls back to asking Shopify directly once the copy is '
        + '30 minutes old, so nothing is shown wrong — it is only slower. Pricing-API → Executions has the details.');
    } catch (e) { Logger.log('alert email failed: ' + e); }
  }
  return res;
}

/** ?shopify=cacheSync — the Refresh button: sync now, outside working hours too. */
function shopCacheNow_() {
  var r = shopCacheSync_({ force: true });
  return { ok: true, sync: r };
}

/** RUN BY HAND, ONCE, when Ravi says go: the five-minute trigger. Not run by the 15 Oct build. */
function shopCacheInstall() {
  shopCacheRemove();
  ScriptApp.newTrigger('shopCacheTick').timeBased().everyMinutes(5).create();
  Logger.log('shopCacheTick now runs every 5 minutes (it does nothing outside ' + SC.startH + ':00–' + SC.endH + ':00 IST).');
}
function shopCacheRemove() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'shopCacheTick') ScriptApp.deleteTrigger(t); });
}
