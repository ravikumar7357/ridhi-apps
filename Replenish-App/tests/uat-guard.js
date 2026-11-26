/* ================= UAT GUARD (Ravi, 21 Nov 2026) =================
 * "a test page which I use for UAT and fetches all the live data but any change in it does not go on live or any other
 *  platform … a reset … on an instance or from that particular time or date"
 *
 * Added by Replenish-App/tests/build-test-erp.js to the UAT copy of the factory ERP (_site/uat/) only — never to the real ERP,
 * never to the test link. It runs right after the TEST ERP GUARD's flag line and before the guard itself, so the guard can hand
 * it every database request.
 *
 * WHAT A TESTER SEES = LIVE AS IT IS NOW + THEIR CHANGES.
 *   - Every read of the factory registers goes to live Firebase, as the real ERP reads it.
 *   - Every save made on this page is kept in THIS BROWSER ("your changes", IndexedDB uat-journal), one line per value
 *     changed, with its time (UTC), who was signed in and the screen — and laid on top of every later read.
 *   - Every open tab of this browser sees them (Ravi, 26 Nov: the two-screen checks), as two PCs see one database.
 *   - Nothing is written to Firebase, Supabase, Apps Script, Shopify, mail or WhatsApp. The guard stops those.
 *   - Reset throws away all of your changes, or those after a date-time, or those after a named restore point; the
 *     screens then fall back to live.
 * The page's own browser storage (the app's copies, the sign-in) is kept under "uat-" names, so it never mixes with the
 * test link, which lives on the same github.io address.
 *
 * ERRORS (one rule): a save that cannot be kept in this browser FAILS LOUDLY — the screen gets an error and the tester a red
 * message; it is never sent on anywhere. A read that live refuses is handed to the screen exactly as live answered it.
 * Clearing the app's copies on a reset is best effort: a failure is logged and the page still reloads.
 *
 * The first part (UAT_CORE) is plain functions with no browser in them — tests/uat-guard-test.js runs them in node. */
var UAT_CORE = (function () {
  /* Firebase's own bookkeeping, not data (the test link skips the same paths): never kept, never shown as a change. */
  var BOOKKEEPING = /^pt_(sync|syncAudit|dataMeter)(\/|$)/;

  function segs(p) { return String(p == null ? '' : p).split('/').filter(Boolean); }
  function joinPath(a, b) { return segs(a).concat(segs(b)).join('/'); }
  function copy(v) { return v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)); }
  function isGroup(v) { return !!v && typeof v === 'object'; }
  function isEmptyGroup(v) { return isGroup(v) && Object.keys(v).length === 0; }

  /** Is path `a` the same place as `b`, or inside it? ('' is the top of the database.) */
  function isAtOrUnder(a, b) { return b === '' || a === b || a.indexOf(b + '/') === 0; }

  /** The value at `ss` inside `v`, or null when there is nothing there. */
  function valueAt(v, ss) {
    for (var i = 0; i < ss.length; i++) { if (!isGroup(v)) return null; v = v[ss[i]]; }
    return v === undefined ? null : v;
  }

  /** `root` with `val` put at `ss`, as Firebase keeps it: null removes the place, and a group left empty goes too.
   *  Returns a new value; the one handed in is not changed (a screen may still be showing it). */
  function putAt(root, ss, val) {
    if (!ss.length) return isEmptyGroup(val) || val === undefined ? null : val;
    var top = Array.isArray(root) ? root.slice() : isGroup(root) ? Object.assign({}, root) : {};
    var child = putAt(top[ss[0]], ss.slice(1), val);
    if (child === null) delete top[ss[0]]; else top[ss[0]] = child;
    return Object.keys(top).length ? top : null;
  }

  /** The changes that matter to a read of `path`: those at it, inside it, or covering it. */
  function changesFor(path, changes) {
    return changes.filter(function (c) { return isAtOrUnder(c.p, path) || isAtOrUnder(path, c.p); });
  }

  /** What a read of `path` shows: what live answered, with each change laid on in the order it was made. Live's value is
   *  not copied whole (a register can be megabytes): putAt copies only the groups on the way to each change. */
  function overlay(path, live, changes) {
    var at = segs(path), v = live === undefined ? null : live;
    changes.forEach(function (c) {
      var cs = segs(c.p), val = c.k === 'delete' ? null : c.v;
      if (isAtOrUnder(path, c.p)) v = copy(valueAt(val, at.slice(cs.length)));   // the change covers the whole read
      else v = putAt(v, cs.slice(at.length), copy(val));                         // the change is one place inside it
    });
    return v;
  }

  /* ---- the read's question (orderBy / equalTo / startAt / endAt / limitTo… / shallow), answered here ----
   * When the tester has changed something under a read that asks a question, live cannot answer it (live does not have the
   * change), so the whole place is read and the question is answered here, in Firebase's own order. */
  var QUESTION = ['orderBy', 'equalTo', 'startAt', 'endAt', 'limitToFirst', 'limitToLast', 'shallow'];
  function questionOf(params) {
    var q = {};
    ['orderBy', 'equalTo', 'startAt', 'endAt'].forEach(function (k) { if (params.has(k)) q[k] = JSON.parse(params.get(k)); });
    ['limitToFirst', 'limitToLast'].forEach(function (k) { if (params.has(k)) q[k] = Number(params.get(k)); });
    if (params.get('shallow') === 'true') q.shallow = true;
    return q;
  }
  /* Firebase's order of values: nothing, false, true, numbers, text, groups. */
  function kindRank(v) { return v === null || v === undefined ? 0 : v === false ? 1 : v === true ? 2 : typeof v === 'number' ? 3 : typeof v === 'string' ? 4 : 5; }
  function compareValues(a, b) {
    var d = kindRank(a) - kindRank(b);
    if (d) return d;
    return (typeof a === 'number' || typeof a === 'string') && a !== b ? (a < b ? -1 : 1) : 0;
  }
  /* Firebase's order of keys: whole numbers first, by size; then text. */
  var WHOLE = /^-?(0|[1-9]\d{0,9})$/;
  function compareKeys(a, b) {
    var na = WHOLE.test(a), nb = WHOLE.test(b);
    if (na && nb) return Number(a) - Number(b);
    if (na !== nb) return na ? -1 : 1;
    return a === b ? 0 : a < b ? -1 : 1;
  }
  function answerQuestion(v, q) {
    if (q.shallow) {
      if (!isGroup(v)) return v;
      var keys = {}; Object.keys(v).forEach(function (k) { keys[k] = true; }); return keys;
    }
    if (!q.orderBy || !isGroup(v)) return v;
    var byKey = q.orderBy === '$key', cmp = byKey ? compareKeys : compareValues;
    var sortValue = byKey ? function (k) { return k; }
      : q.orderBy === '$value' ? function (k, x) { return x; }
      : function (k, x) { return valueAt(x, segs(q.orderBy)); };
    var rows = Object.keys(v).map(function (k) { return { k: k, x: v[k], s: sortValue(k, v[k]) }; });
    rows.sort(function (a, b) { return cmp(a.s, b.s) || compareKeys(a.k, b.k); });
    if ('equalTo' in q) rows = rows.filter(function (r) { return cmp(r.s, q.equalTo) === 0; });
    if ('startAt' in q) rows = rows.filter(function (r) { return cmp(r.s, q.startAt) >= 0; });
    if ('endAt' in q) rows = rows.filter(function (r) { return cmp(r.s, q.endAt) <= 0; });
    if (q.limitToFirst) rows = rows.slice(0, q.limitToFirst);
    if (q.limitToLast) rows = rows.slice(-q.limitToLast);
    var out = {}; rows.forEach(function (r) { out[r.k] = r.x; }); return out;
  }

  /** One database save, as changes: one line per place written ('put' or 'delete'), and what Firebase would answer.
   *  `newId` gives the id a POST makes. Each change keeps `key`, the name it had in a PATCH, so the answer can be rebuilt. */
  function changesOfSave(method, base, body, newId) {
    var out = [], answer = null;
    if (method === 'PUT') { out.push({ k: body === null ? 'delete' : 'put', p: base, v: body }); answer = body; }
    else if (method === 'DELETE') { out.push({ k: 'delete', p: base, v: null }); }
    else if (method === 'POST') { var id = newId(); out.push({ k: 'put', p: joinPath(base, id), v: body }); answer = { name: id }; }
    else if (method === 'PATCH') {
      Object.keys(body || {}).forEach(function (key) {
        var v = body[key] === undefined ? null : body[key];
        out.push({ k: v === null ? 'delete' : 'put', p: joinPath(base, key), v: v, key: key });
      });
      answer = body;
    }
    return { changes: out.filter(function (c) { return c.p !== '' && !BOOKKEEPING.test(c.p); }), answer: answer };
  }

  /* ---- Firebase's server values: {".sv":"timestamp"} and {".sv":{"increment":n}} ---- */
  function hasServerValue(v) { return isGroup(v) && JSON.stringify(v).indexOf('".sv"') >= 0; }
  function needsCurrent(v) { return isGroup(v) && JSON.stringify(v).indexOf('"increment"') >= 0; }
  /** `v` with each server value worked out: the time now, or the value already there plus the increment. */
  function withServerValues(v, now, current) {
    if (!isGroup(v)) return v;
    if ('.sv' in v) {
      if (v['.sv'] === 'timestamp') return now;
      var inc = v['.sv'] && v['.sv'].increment;
      if (typeof inc === 'number') return (typeof current === 'number' ? current : 0) + inc;
      return v;
    }
    var out = Array.isArray(v) ? [] : {};
    Object.keys(v).forEach(function (k) { out[k] = withServerValues(v[k], now, isGroup(current) ? current[k] : null); });
    return out;
  }

  /** The same data? (A compare-and-set goes through only when nothing changed since it was read.) */
  function sameData(a, b) {
    if (a === b) return true;
    if (!isGroup(a) || !isGroup(b)) return a === b || ((a === null || a === undefined) && (b === null || b === undefined));
    var ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(function (k) { return sameData(a[k], b[k]); });
  }

  /* ---- reset ---- */
  /** The changes kept when everything after `cutIso` is undone (a change made at that very moment stays). */
  function changesUpTo(changes, cutIso) { return changes.filter(function (c) { return c.t <= cutIso; }); }
  /** A date and time typed on the page, read as India time, as UTC — the one zone the business works in. */
  function indiaToUtcIso(local) {
    var m = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d)(:\d\d)?$/.exec(String(local || ''));
    if (!m) return null;
    var d = new Date(m[1] + 'T' + m[2] + (m[3] || ':00') + '+05:30');
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  /** One save's changes shown as one line in the list: newest save first. */
  function savesOf(changes) {
    var by = {}, order = [];
    changes.forEach(function (c) { if (!by[c.g]) { by[c.g] = { g: c.g, t: c.t, who: c.who, screen: c.screen, what: c.what, auto: c.auto, n: 0 }; order.push(c.g); } by[c.g].n++; });
    return order.map(function (g) { return by[g]; }).reverse();
  }

  return { BOOKKEEPING: BOOKKEEPING, QUESTION: QUESTION, segs: segs, isAtOrUnder: isAtOrUnder, valueAt: valueAt, putAt: putAt,
    changesFor: changesFor, overlay: overlay, questionOf: questionOf, answerQuestion: answerQuestion, compareKeys: compareKeys,
    compareValues: compareValues, changesOfSave: changesOfSave, hasServerValue: hasServerValue, needsCurrent: needsCurrent,
    withServerValues: withServerValues, sameData: sameData, changesUpTo: changesUpTo, indiaToUtcIso: indiaToUtcIso, savesOf: savesOf };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = UAT_CORE;

/* ================= the page part (browser only) ================= */
if (typeof window !== 'undefined') (function () {
  var C = UAT_CORE;
  var JOURNAL_DB = 'uat-journal';
  /* the app's own stores that survive a reset: the change list itself, the sign-in, and the copies of ERP data (they hold
   * ERP data as it is — your changes are laid on when a screen reads, never written into them) */
  var KEEP_ON_RESET = [JOURNAL_DB, 'uat-firebaseLocalStorageDb', 'uat-r1-erpdata-copies-2'];
  /* UAT MODE (Ravi, 24 Nov: one Test page; "a UAT mode and it will do what our UAT does"). OFF: the Test page reads ERP data and
   * saving is off. ON: everything above — your changes kept on this PC, laid on every read, with Reset. Kept per browser. */
  var MODE_KEY = 'uat:r1UatMode', ON = false;
  try { ON = window.localStorage.getItem(MODE_KEY) === '1'; } catch (e) { /* no storage: UAT mode stays off */ }
  /* a save made this long after the tester last clicked or typed is the app's own upkeep, not tester work */
  var AUTO_AFTER_MS = 4000;
  var STORE_PREFIX = 'uat-', KEY_PREFIX = 'uat:';

  /* ---- 1. THIS PAGE'S OWN BROWSER STORAGE ----
   * The UAT page and the test link share one address (ravikumar7357.github.io), so they would share the app's copies and the
   * sign-in. Every database name and every saved setting on this page gets a "uat-" name, so the two never mix. */
  var IDB = window.IDBFactory && window.IDBFactory.prototype;
  var realOpen = IDB.open, realDelete = IDB.deleteDatabase;
  var uatName = function (n) { n = String(n); return n.indexOf(STORE_PREFIX) === 0 ? n : STORE_PREFIX + n; };
  IDB.open = function (n, v) { return v === undefined ? realOpen.call(this, uatName(n)) : realOpen.call(this, uatName(n), v); };
  IDB.deleteDatabase = function (n) { return realDelete.call(this, uatName(n)); };
  var SP = window.Storage.prototype, realGet = SP.getItem, realSet = SP.setItem, realRemove = SP.removeItem, realKey = SP.key;
  SP.getItem = function (k) { return realGet.call(this, KEY_PREFIX + k); };
  SP.setItem = function (k, v) { return realSet.call(this, KEY_PREFIX + k, v); };
  SP.removeItem = function (k) { return realRemove.call(this, KEY_PREFIX + k); };
  SP.clear = function () {   // only this page's own settings; the test link's stay
    for (var i = this.length - 1; i >= 0; i--) { var k = realKey.call(this, i); if (k && k.indexOf(KEY_PREFIX) === 0) realRemove.call(this, k); }
  };
  /* The app's own fast copies are kept away from UAT: they would be filled with "live + your changes" and outlive a reset. */
  try { localStorage.setItem('deltaUse', '0'); localStorage.setItem('deltaShadowOff', '1'); } catch (e) { /* no storage: the app reads plainly anyway */ }

  var U = window.__UAT = { on: ON, changes: [], points: [], lastTouch: 0, broken: '', watchers: [], tags: {}, tagN: 0 };
  /** UAT mode on or off: remembered in this browser, then the page reloads so every screen reads again in the new mode.
   *  Your changes are kept either way (off only hides them); the app's own copies are cleared, as on a reset. */
  U.setMode = function (on) {
    try { realSet.call(window.localStorage, MODE_KEY, on ? '1' : '0'); } catch (e) { loud('This browser would not remember the mode.'); return; }
    clearCopies().then(function () { location.reload(); });
  };
  document.addEventListener('pointerdown', function () { U.lastTouch = Date.now(); }, true);
  document.addEventListener('keydown', function () { U.lastTouch = Date.now(); }, true);

  /* ---- 2. YOUR CHANGES, kept in this browser ---- */
  function journal() {
    if (!U.db) U.db = new Promise(function (ok, bad) {
      var r = indexedDB.open(JOURNAL_DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('changes', { keyPath: 'n' }); r.result.createObjectStore('points', { keyPath: 'id' }); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { bad(r.error || new Error('the browser refused its storage')); };
    });
    return U.db;
  }
  function readAll(db, store) {
    return new Promise(function (ok, bad) { var q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = function () { ok(q.result || []); }; q.onerror = function () { bad(q.error); }; });
  }
  /** One transaction: `fn` gets the two stores; resolves when the browser has really kept it. */
  function write(fn) {
    return journal().then(function (db) { return new Promise(function (ok, bad) {
      var tx = db.transaction(['changes', 'points'], 'readwrite');
      fn(tx.objectStore('changes'), tx.objectStore('points'));
      tx.oncomplete = function () { ok(); }; tx.onerror = function () { bad(tx.error); }; tx.onabort = function () { bad(tx.error || new Error('the browser did not keep it')); };
    }); });
  }
  /* ONE LIST FOR EVERY OPEN TAB (26 Nov). Each save or reset puts a new mark in the browser's storage; a tab whose mark is
   * old reads the kept changes again before it reads or saves, and as soon as the browser tells it. U.ready = "the list this
   * tab holds is loaded and current". */
  var MARK_KEY = 'uat:r1UatMark', seenMark;
  function markNow() { try { return realGet.call(window.localStorage, MARK_KEY); } catch (e) { return null; /* no storage: markChanged says so */ } }
  function markChanged() {
    try { realSet.call(window.localStorage, MARK_KEY, Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }
    catch (e) { console.warn('[UAT] other open tabs will not notice this change until they are reloaded', e); }
  }
  function rowId(r) { return r.n + ':' + r.g; }
  /** The kept changes and restore points, read from the browser; screens that watch are told what came or went. */
  function load() {
    seenMark = markNow();   // taken first: a save made while this read runs is then read on the next turn
    return journal().then(function (db) { return Promise.all([readAll(db, 'changes'), readAll(db, 'points')]); }).then(function (r) {
      var had = {}, has = {};
      U.changes.forEach(function (c) { had[rowId(c)] = 1; });
      var now = r[0].sort(function (a, b) { return a.n - b.n; });
      now.forEach(function (c) { has[rowId(c)] = 1; });
      var moved = now.filter(function (c) { return !had[rowId(c)]; }).concat(U.changes.filter(function (c) { return !has[rowId(c)]; }));
      U.changes = now;
      U.points = r[1].sort(function (a, b) { return a.t < b.t ? -1 : 1; });
      if (moved.length) U.watchers.forEach(function (w) { try { w(moved); } catch (e) { console.warn('[UAT] a screen could not redraw after a change', e); } });
      drawBar();
    }).catch(function (e) {
      U.broken = String((e && e.message) || e);
      console.error('[UAT] this browser cannot keep test changes (' + U.broken + '); every save on this page will be refused.');
    });
  }
  function reload() { U.ready = U.ready.then(load); return U.ready; }
  /** Resolves when this tab holds every change kept so far, its own and other tabs'. */
  U.catchUp = function () {
    var mark = markNow();
    if (mark === seenMark) return U.ready;
    seenMark = mark;   // one read for one new mark, however many ask while it runs
    return reload();
  };
  window.addEventListener('storage', function (ev) { if (ev.key === MARK_KEY) U.catchUp(); });
  U.ready = load();

  /** Who was signed in, read from the sign-in a request carries (the email only). */
  function whoOf(token) {
    try { var p = JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.email || ''; } catch (e) { return ''; }
  }
  function screenNow() { return String(location.hash || '#').slice(1, 40) || 'home'; }

  /** Keep one save's changes. Fails loudly: a save this browser cannot keep is never reported as saved. */
  U.keep = function (changes, what, who) {
    if (!U.on) return Promise.reject(new Error('Saving is off on the Test page — turn on UAT mode to try saves (they stay on this PC). Nothing was saved.'));
    if (U.broken) return Promise.reject(new Error('UAT could not keep this change in this browser (' + U.broken + '). Nothing was saved.'));
    var t = new Date().toISOString(), g = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var auto = Date.now() - U.lastTouch > AUTO_AFTER_MS;
    var rows = [];
    /* numbered inside the browser's own transaction, after the last one kept: two tabs can never use the same number */
    return write(function (cs) {
      var last = cs.openCursor(null, 'prev');
      last.onsuccess = function () {
        var n = last.result ? last.result.key : 0;
        rows = changes.map(function (c) { return { n: ++n, g: g, k: c.k, p: c.p, v: c.v === undefined ? null : c.v, t: t, who: who || '', screen: screenNow(), what: what, auto: auto }; });
        rows.forEach(function (r) { cs.put(r); });
      };
    }).then(function () {
      markChanged();
      return reload();   // this tab's own save, even where the mark could not be written
    }).then(function () {
      if (!auto) said('Kept in UAT \u2014 on this PC only, not live');
      return rows;
    });
  };

  /* ---- 3. THE FACTORY REGISTERS (Firebase Realtime Database, read over the web) ---- */
  function pathOf(u) { return decodeURIComponent(u.pathname.replace(/\.json$/, '')).replace(/^\/+|\/+$/g, ''); }
  function urlOf(u, path) {
    return u.origin + '/' + C.segs(path).map(encodeURIComponent).join('/') + '.json' + (u.searchParams.get('auth') ? '?auth=' + encodeURIComponent(u.searchParams.get('auth')) : '');
  }
  function json(v, status, extra) { return new Response(JSON.stringify(v === undefined ? null : v), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, extra || {}) }); }
  function header(init, name) {
    var h = init && init.headers; if (!h) return null;
    if (typeof h.get === 'function') return h.get(name);
    var ln = name.toLowerCase(); for (var k in h) if (String(k).toLowerCase() === ln) return h[k];
    return null;
  }
  /** Live as it is now + your changes, at one place (no question asked). */
  function currentAt(u, path, origFetch) {
    return origFetch(urlOf(u, path)).then(function (r) {
      if (!r.ok) throw new Error('live answered ' + r.status + ' for ' + path);
      return r.json();
    }).then(function (live) { return C.overlay(path, live, C.changesFor(path, U.changes)); });
  }

  /** A read. Untouched by your changes: straight to live. Touched: the whole place from live, your changes on it, the
   *  question answered here. A read for compare-and-set gets this page's own tag, remembering what it showed. */
  U.read = function (url, init, origFetch) {
    return U.catchUp().then(function () {
      var u = new URL(url), path = pathOf(u), wantsTag = header(init, 'X-Firebase-ETag');
      var mine = C.changesFor(path, U.changes);
      if (!mine.length && !wantsTag) return origFetch(url, init);
      var plain = new URL(url); C.QUESTION.forEach(function (k) { plain.searchParams.delete(k); });
      return origFetch(plain.toString(), init && init.signal ? { signal: init.signal } : undefined).then(function (r) {
        if (!r.ok) return r;                        // live refused: the screen sees exactly that
        return r.json().then(function (live) {
          var v = C.overlay(path, live, mine);
          var extra = {};
          if (wantsTag) { var tag = 'uat' + (++U.tagN); U.tags[tag] = { path: path, v: v }; extra.ETag = tag; }
          return json(C.answerQuestion(v, C.questionOf(u.searchParams)), 200, extra);
        });
      });
    });
  };

  function newPushId() {   /* a Firebase-style id: time first, so new records sort last */
    var c = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz', t = Date.now(), s = '';
    for (var i = 0; i < 8; i++) { s = c.charAt(t % 64) + s; t = Math.floor(t / 64); }
    for (var j = 0; j < 12; j++) s += c.charAt(Math.floor(Math.random() * 64));
    return s;
  }
  /** A save: kept in this browser as changes, answered the way Firebase answers. Never sent to live. */
  U.write = function (url, method, init, origFetch) {
    if (!U.on) { loud('Saving is off on the Test page — turn on UAT mode to try saves.'); return Promise.resolve(json({ error: 'Saving is off (UAT mode is off)' }, 403)); }
    return U.catchUp().then(function () {
      var u = new URL(url), base = pathOf(u), who = whoOf(u.searchParams.get('auth'));
      var body;
      try { body = init && init.body != null && init.body !== '' ? JSON.parse(String(init.body)) : null; }
      catch (e) { return json({ error: 'Invalid data; could not parse JSON' }, 400); }
      var tag = header(init, 'if-match');
      var check = !tag ? Promise.resolve(true) : (method === 'PUT' && U.tags[tag])
        ? currentAt(u, base, origFetch).then(function (now) { return C.sameData(now, U.tags[tag].v); })
        : Promise.resolve(false);
      return check.then(function (unchanged) {
        if (!unchanged) return json({ error: 'ETag mismatch' }, 412);   // someone changed it since it was read: as live says it
        if (tag) delete U.tags[tag];
        var made = C.changesOfSave(method, base, body, newPushId), now = Date.now();
        return Promise.all(made.changes.map(function (c) {
          if (!C.hasServerValue(c.v)) return c;
          var cur = C.needsCurrent(c.v) ? currentAt(u, c.p, origFetch) : Promise.resolve(null);
          return cur.then(function (v) { return Object.assign({}, c, { v: C.withServerValues(c.v, now, v) }); });
        })).then(function (changes) {
          var answer = method === 'PATCH' ? changes.reduce(function (o, c) { o[c.key] = c.v; return o; }, {})
            : method === 'PUT' && changes.length ? changes[0].v : made.answer;
          if (!changes.length) return json(answer);
          return U.keep(changes.map(function (c) { return { k: c.k, p: c.p, v: c.v }; }), 'database ' + method + ' ' + (base || '(several places)'), who)
            .then(function () { return json(answer); });
        });
      });
    }).catch(function (e) {
      loud(String((e && e.message) || e));
      return json({ error: String((e && e.message) || e) }, 503, {});
    });
  };

  /* ---- 4. SETTINGS AND ACCESS (Firestore). The page's Firestore functions call these (build-test-erp.js, uatFirestore). ---- */
  var TIME_FIELDS = ['at', 'dataAt', 'saved', 'updatedAt'];   /* kept as timestamps by Firestore: shown as timestamps again */
  function asTimestamp(s) { var d = new Date(s); return { toDate: function () { return new Date(d); }, toMillis: function () { return d.getTime(); }, seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toJSON: function () { return s; }, toString: function () { return s; }, valueOf: function () { return d.getTime(); } }; }
  function docLike(ref, v) {
    var out = v == null ? undefined : Object.assign({}, v);
    if (out) TIME_FIELDS.forEach(function (f) { if (typeof out[f] === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(out[f])) out[f] = asTimestamp(out[f]); });
    return { id: ref.id, ref: ref, exists: function () { return out !== undefined; }, data: function () { return out; }, get: function (f) { return (out || {})[f]; } };
  }
  U.fsKeep = function (changes, what, who) { return U.catchUp().then(function () { return U.keep(changes, what, who); }).catch(function (e) { loud(String((e && e.message) || e)); throw e; }); };
  /** One document: live, with your changes on it. */
  U.fsDoc = function (ref, liveSnap) {
    if (!U.on) return liveSnap;
    var at = 'fs/' + ref.path, mine = C.changesFor(at, U.changes);
    if (!mine.length) return liveSnap;
    return docLike(ref, C.overlay(at, liveSnap.exists() ? liveSnap.data() : null, mine));
  };
  /** A whole collection: live's documents with your changes on them, yours added, the ones you removed left out. */
  U.fsDocs = function (col, liveSnap) {
    if (!U.on) return liveSnap;
    var at = 'fs/' + (col.path || col.id), mine = C.changesFor(at, U.changes);
    if (!mine.length) return liveSnap;
    var depth = C.segs(at).length, ids = [], live = {};
    liveSnap.docs.forEach(function (d) { live[d.id] = d; ids.push(d.id); });
    mine.forEach(function (c) { var id = C.segs(c.p)[depth]; if (id && !(id in live) && ids.indexOf(id) < 0) ids.push(id); });
    var docs = ids.map(function (id) {
      var ref = live[id] ? live[id].ref : { id: id, path: at.slice(3) + '/' + id, parent: col };
      var v = C.overlay(at + '/' + id, live[id] ? live[id].data() : null, C.changesFor(at + '/' + id, mine));
      return v == null ? null : docLike(ref, v);
    }).filter(Boolean);
    return { docs: docs, size: docs.length, empty: !docs.length, forEach: function (f) { docs.forEach(f); } };
  };
  /** A live watch on one document: live's updates and your own saves both redraw it. */
  U.fsWatch = function (ref, next, err, realWatch) {
    if (!U.on) return realWatch(ref, next, err);
    var last = null, at = 'fs/' + ref.path;
    var stop = realWatch(ref, function (snap) { last = snap; U.ready.then(function () { next(U.fsDoc(ref, snap)); }); }, err);
    var mineChanged = function (rows) { if (last && rows.some(function (r) { return C.isAtOrUnder(r.p, at) || C.isAtOrUnder(at, r.p); })) next(U.fsDoc(ref, last)); };
    U.watchers.push(mineChanged);
    return function () { stop(); U.watchers = U.watchers.filter(function (w) { return w !== mineChanged; }); };
  };

  /* ---- 5. NOTHING LEAVES FOR ANY OTHER PLATFORM ----
   * The guard stops every other save (Apps Script, Shopify, logins, Supabase…). WhatsApp opens through a link, not a request,
   * so it is stopped here; so is the browser's "beacon" (a send that never waits for an answer). */
  function isWhatsApp(u) { return /(^|\/\/)(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\b|^whatsapp:/i.test(String(u || '')); }
  var realWindowOpen = window.open;
  window.open = function (u) { if (isWhatsApp(u)) { U.stopped('WhatsApp'); return null; } return realWindowOpen.apply(window, arguments); };
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (a && isWhatsApp(a.getAttribute('href'))) { ev.preventDefault(); ev.stopPropagation(); U.stopped('WhatsApp'); }
  }, true);
  if (navigator.sendBeacon) navigator.sendBeacon = function () { U.stopped('a background send'); return false; };
  U.stopped = function (what) { loud('Test page: ' + what + ' is switched off \u2014 nothing was sent.'); console.warn('[UAT] stopped: ' + what); };

  /* ---- 6. RESET ---- */
  /** Undo every change made after `cutIso` (null = all of them), forget restore points after it, clear the app's own copies
   *  (they were filled with the changes) and reload, so every screen reads fresh. */
  U.undoAfter = function (cutIso) {
    /* chosen and deleted in one transaction, so a save another tab makes at this moment cannot slip past the reset */
    function dropIfLater(ev) {
      var at = ev.target.result; if (!at) return;
      if (!C.changesUpTo([at.value], cutIso).length) at.delete();
      at.continue();
    }
    return write(function (cs, ps) {
      if (!cutIso) { cs.clear(); ps.clear(); return; }
      cs.openCursor().onsuccess = dropIfLater;
      ps.openCursor().onsuccess = dropIfLater;   // a restore point has its time too
    }).then(markChanged).then(clearCopies).then(function () { location.reload(); });
  };
  function clearCopies() {
    if (!indexedDB.databases) return Promise.resolve();
    return indexedDB.databases().then(function (list) {
      (list || []).forEach(function (d) {
        if (d.name && d.name.indexOf(STORE_PREFIX) === 0 && KEEP_ON_RESET.indexOf(d.name) < 0) realDelete.call(indexedDB, d.name);
      });
      return new Promise(function (ok) { setTimeout(ok, 600); });   // the open screen still holds them; they go on the reload
    }).catch(function (e) { console.warn('[UAT] could not clear the app\'s own copies before reloading', e); });
  }
  U.savePoint = function (name) {
    var p = { id: 'p' + Date.now().toString(36), name: String(name || '').trim().slice(0, 80) || 'Restore point', t: new Date().toISOString() };
    return write(function (cs, ps) { ps.put(p); }).then(function () { markChanged(); return reload(); });
  };
  U.forgetPoint = function (id) {
    return write(function (cs, ps) { ps.delete(id); }).then(function () { markChanged(); return reload(); });
  };

  /* ---- 7. ON SCREEN: the UAT bar, the Reset button and its panel ---- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function india(iso) { try { return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch (e) { return iso; } }
  function note(id, cls, text, ms) {
    try {
      var t = document.getElementById(id);
      if (!t) { t = document.createElement('div'); t.id = id; t.className = cls; document.body.appendChild(t); }
      t.textContent = text; t.style.display = 'block';
      clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, ms);
    } catch (e) { /* the page is not drawn yet: the console line is enough */ }
  }
  function said(text) { note('uatSaid', 'uat-said', text, 2500); }
  function loud(text) { note('uatLoud', 'uat-loud', text, 6000); }

  function drawBar() {
    var n = C.savesOf(U.changes).length, b = document.getElementById('uatBarCount');
    if (b) b.textContent = n ? n + ' change' + (n === 1 ? '' : 's') : 'no changes yet';
    drawPanel();
  }
  /* A second press within 4 seconds confirms anything that throws work away. */
  function armed(btn, words) {
    if (btn.getAttribute('data-armed') === '1') { btn.removeAttribute('data-armed'); return true; }
    var was = btn.textContent; btn.setAttribute('data-armed', '1'); btn.textContent = words; btn.classList.add('uat-armed');
    setTimeout(function () { if (btn.getAttribute('data-armed') === '1') { btn.removeAttribute('data-armed'); btn.textContent = was; btn.classList.remove('uat-armed'); } }, 4000);
    return false;
  }
  /** "Undo N changes after this" for a chosen moment; until a time is picked it asks for one. */
  function undoButton(cut) {
    var n = cut ? C.savesOf(U.changes.filter(function (c) { return c.t > cut; })).length : 0;
    var words = !cut ? 'Pick a date and time first' : 'Undo ' + n + ' change' + (n === 1 ? '' : 's') + ' after this';
    return '<button type="button" class="uat-btn" id="uatUndoAfter"' + (n ? '' : ' disabled') + '>' + words + '</button>';
  }
  function drawPanel() {
    var box = document.getElementById('uatPanelBody'); if (!box || document.getElementById('uatPanel').hidden) return;
    var saves = C.savesOf(U.changes), cutIn = document.getElementById('uatCut'), cutVal = cutIn ? cutIn.value : '';
    var cut = C.indiaToUtcIso(cutVal);
    var mode = '<div class="uat-sec"><h3>UAT mode <span>' + (U.on ? 'on' : 'off') + '</span></h3><p>'
      + (U.on ? 'Your saves are kept on this PC and laid on top of live data. Turning it off hides them (they are kept) and saving stops.'
              : 'Saving is off: the screens show live data only. Turn UAT mode on to try saves — they stay on this PC.')
      + '</p><button type="button" class="uat-btn" id="uatModeBtn">' + (U.on ? 'Turn UAT mode off' : 'Turn UAT mode on') + '</button></div>';
    if (!U.on) {
      box.innerHTML = '<p class="uat-lead">The Test page shows <b>live data from ERP data</b>, read only. Nothing here reaches the live ERP, ERP data, '
        + 'Firebase, Shopify, mail or WhatsApp.' + (saves.length ? ' You have ' + saves.length + ' change' + (saves.length === 1 ? '' : 's') + ' kept from UAT mode, hidden while it is off.' : '') + '</p>' + mode;
      return;
    }
    box.innerHTML =
      '<p class="uat-lead">What you see is <b>live data as it is now</b>, with <b>your changes</b> on top. Your changes are kept on this PC only: '
      + 'nothing reaches the live ERP, ERP data, Shopify, mail or WhatsApp. If live changes a record you also changed, you keep seeing yours until you reset.</p>'
      + mode
      + '<div class="uat-sec"><h3>Reset everything</h3><p>Throw away ' + (saves.length === 1 ? 'your 1 change' : 'all ' + saves.length + ' changes') + ' and go back to live.</p>'
      + '<button type="button" class="uat-btn uat-danger" id="uatResetAll"' + (saves.length ? '' : ' disabled') + '>Reset everything</button></div>'
      + '<div class="uat-sec"><h3>Undo everything after a time</h3><label for="uatCut">Date and time (India)</label> '
      + '<input type="datetime-local" id="uatCut" value="' + esc(cutVal) + '"> '
      + undoButton(cut) + '</div>'
      + '<div class="uat-sec"><h3>Restore points</h3><p>A named moment to come back to, e.g. "before PO close test".</p>'
      + '<label for="uatPointName">Name</label> <input id="uatPointName" maxlength="80" placeholder="before PO close test"> '
      + '<button type="button" class="uat-btn" id="uatSavePoint">Save a restore point</button>'
      + (U.points.length ? '<table class="uat-t"><thead><tr><th>Name</th><th>When (India)</th><th>Changes after it</th><th></th></tr></thead><tbody>'
        + U.points.slice().reverse().map(function (p) {
          var n = C.savesOf(U.changes.filter(function (c) { return c.t > p.t; })).length;
          return '<tr><td>' + esc(p.name) + '</td><td>' + esc(india(p.t)) + '</td><td class="n">' + n + '</td><td>'
            + '<button type="button" class="uat-btn" data-uat-back="' + esc(p.id) + '"' + (n ? '' : ' disabled') + '>Go back to this</button> '
            + '<button type="button" class="uat-link" data-uat-forget="' + esc(p.id) + '">Remove</button></td></tr>'; }).join('') + '</tbody></table>' : '')
      + '</div>'
      + '<div class="uat-sec"><h3>Your changes <span>' + saves.length + ', newest first</span></h3>'
      + (saves.length ? '<table class="uat-t"><thead><tr><th>When (India)</th><th>Who</th><th>Screen</th><th>What</th><th class="n">Values</th></tr></thead><tbody>'
        + saves.slice(0, 300).map(function (s) {
          return '<tr><td>' + esc(india(s.t)) + '</td><td>' + esc(s.who) + '</td><td>' + esc(s.screen) + '</td><td>' + esc(s.what)
            + (s.auto ? ' <span class="uat-auto" title="Saved by the app on its own, not by a click">automatic</span>' : '') + '</td><td class="n">' + s.n + '</td></tr>'; }).join('')
        + '</tbody></table>' + (saves.length > 300 ? '<p>Showing the newest 300.</p>' : '') : '<p>No changes yet.</p>')
      + '</div>';
  }
  function openPanel() { document.getElementById('uatPanel').hidden = false; drawPanel(); }
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('#uatModeBtn,#uatBarMode,#uatResetBtn,#uatBarBtn,#uatClose,#uatResetAll,#uatUndoAfter,#uatSavePoint,[data-uat-back],[data-uat-forget]') : null;
    if (!t) return;
    if (t.id === 'uatModeBtn' || t.id === 'uatBarMode') { U.setMode(!U.on); return; }
    if (t.id === 'uatResetBtn' || t.id === 'uatBarBtn') { openPanel(); return; }
    if (t.id === 'uatClose') { document.getElementById('uatPanel').hidden = true; return; }
    if (t.id === 'uatResetAll') { if (armed(t, 'Press again to throw away every change')) U.undoAfter(null); return; }
    if (t.id === 'uatUndoAfter') { var cut = C.indiaToUtcIso(document.getElementById('uatCut').value); if (cut && armed(t, 'Press again to undo them')) U.undoAfter(cut); return; }
    if (t.id === 'uatSavePoint') { U.savePoint(document.getElementById('uatPointName').value).catch(function (e) { loud('The restore point was not kept: ' + ((e && e.message) || e)); }); return; }
    if (t.getAttribute('data-uat-back')) {
      var p = U.points.filter(function (x) { return x.id === t.getAttribute('data-uat-back'); })[0];
      if (p && armed(t, 'Press again to go back')) U.undoAfter(p.t);
      return;
    }
    if (t.getAttribute('data-uat-forget')) U.forgetPoint(t.getAttribute('data-uat-forget'));
  });
  /* the undo button says how many changes the chosen time would undo, as the time is typed */
  document.addEventListener('input', function (ev) {
    if (!ev.target || ev.target.id !== 'uatCut') return;
    var btn = document.getElementById('uatUndoAfter'); if (btn) btn.outerHTML = undoButton(C.indiaToUtcIso(ev.target.value));
  });

  /* the bar sits at the bottom, between the test label and the Speed button, so it never covers the app's own top bar */
  var CSS = '#uatBar{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:2147483646;display:flex;gap:10px;align-items:center;'
    + 'background:#fde68a;color:#422006;font:600 12.5px/1.3 system-ui,sans-serif;padding:5px 6px 5px 12px;border-radius:10px;box-shadow:0 3px 10px rgba(0,0,0,.18);max-width:calc(100vw - 16px)}'
    + '#uatBar button{all:revert;font:700 12px system-ui,sans-serif;background:#422006;color:#fff;border:0;border-radius:7px;padding:4px 10px;cursor:pointer}'
    + '#uatPanel{position:fixed;inset:0;z-index:2147483647;background:rgba(15,17,20,.45);display:grid;place-items:center;padding:16px}#uatPanel[hidden]{display:none}'
    + '#uatPanel .uat-box{background:#fff;color:#15171a;width:min(820px,100%);max-height:90vh;overflow:auto;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.3);font:13.5px/1.45 system-ui,sans-serif}'
    + '#uatPanel .uat-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #eceef1;position:sticky;top:0;background:#fff}'
    + '#uatPanel h2{margin:0;font-size:18px}#uatPanel h3{margin:0 0 6px;font-size:14.5px}#uatPanel h3 span{font-weight:400;color:#5d636b;font-size:12.5px}'
    + '#uatPanelBody{padding:6px 18px 18px}.uat-lead{background:#fef9c3;border-radius:8px;padding:9px 11px}.uat-sec{border-top:1px solid #eceef1;padding:12px 0}.uat-sec p{margin:0 0 8px;color:#5d636b}'
    + '#uatPanel label{font-weight:600;font-size:12.5px}#uatPanel input{all:revert;font:13px system-ui,sans-serif;padding:5px 8px;border:1px solid #c9ccd2;border-radius:7px;margin:4px 6px 4px 0}'
    + '.uat-btn{all:revert;font:600 12.5px system-ui,sans-serif;padding:6px 12px;border-radius:8px;border:1px solid #c9ccd2;background:#f6f7f9;color:#15171a;cursor:pointer}'
    + '.uat-btn[disabled]{opacity:.45;cursor:default}.uat-danger{background:#7f1d1d;color:#fff;border-color:#7f1d1d}.uat-armed{background:#b91c1c!important;color:#fff!important;border-color:#b91c1c!important}'
    + '.uat-link{all:revert;background:none;border:0;color:#5d636b;text-decoration:underline;cursor:pointer;font-size:12px}'
    + '.uat-t{width:100%;border-collapse:collapse;margin-top:8px;font-size:12.5px}.uat-t th,.uat-t td{text-align:left;padding:4px 6px;border-bottom:1px solid #eceef1;vertical-align:top}.uat-t .n{text-align:right}'
    + '.uat-auto{background:#e5e7eb;color:#374151;border-radius:5px;padding:0 5px;font-size:11px}'
    + '.uat-said,.uat-loud{display:none;position:fixed;left:50%;top:40px;transform:translateX(-50%);z-index:2147483647;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3);pointer-events:none}'
    + '.uat-said{background:#166534}.uat-loud{background:#7f1d1d}'
    + '@media (prefers-color-scheme:dark){#uatPanel .uat-box,#uatPanel .uat-head{background:#18191c;color:#e9eaec}.uat-lead{background:#3f3a14}.uat-sec,#uatPanel .uat-head,.uat-t th,.uat-t td{border-color:#2a2c30}'
    + '.uat-btn{background:#232529;color:#e9eaec;border-color:#3a3d42}#uatPanel input{background:#232529;color:#e9eaec;border-color:#3a3d42}}';
  document.addEventListener('DOMContentLoaded', function () {
    var s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    var bar = document.createElement('div'); bar.id = 'uatBar'; bar.setAttribute('role', 'status');
    bar.innerHTML = U.on
      ? '<span>UAT mode \u00b7 live data \u00b7 changes stay on this PC \u00b7 <span id="uatBarCount">\u2026</span></span><button type="button" id="uatBarBtn">Reset</button><button type="button" id="uatBarMode">UAT off</button>'
      : '<span>Test \u00b7 live data \u00b7 saving off</span><button type="button" id="uatBarMode">UAT mode on</button>';
    if (!U.on) bar.style.background = '#e0e7ff';
    document.body.appendChild(bar);
    var panel = document.createElement('div'); panel.id = 'uatPanel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'uatTitle');
    panel.innerHTML = '<div class="uat-box"><div class="uat-head"><h2 id="uatTitle">' + (U.on ? 'UAT mode \u2014 your test changes' : 'Test page') + '</h2><button type="button" class="uat-btn" id="uatClose">Close</button></div><div id="uatPanelBody"></div></div>';
    document.body.appendChild(panel);
    U.catchUp().then(drawBar);
  });
})();
