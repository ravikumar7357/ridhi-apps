/* THE TEST ERP: the same two apps, built from the same files, served from GitHub Pages — with saving switched off.
 *
 *   node Replenish-App/tests/build-test-erp.js        → _site/  (GitHub Actions publishes it; see .github/workflows/test-erp.yml)
 *
 * It is the code on the dev branch, as it is: Replenish-App/public and Pricing-App/public are copied whole. Nothing in
 * src/ or public/ is edited — only the copy in _site/ is changed, in four ways:
 *
 *   1. A "TEST ERP" label on every screen, with the commit it was built from, so nobody takes it for the real ERP.
 *   2. SAVING IS OFF. The test ERP reads the LIVE data (same Firebase project) so it can be compared screen for screen
 *      with the real ERP — so it must never write. Every way the apps write is stopped before it leaves the browser:
 *        - the factory registers: any request to the Realtime Database that is not a read (PUT/PATCH/POST/DELETE)
 *        - settings and access: the Firestore write functions setDoc / addDoc / deleteDoc
 *        - logins: creating an account, changing a password or PIN, sending a reset mail (identity service)
 *        - the backends: every POST (MCF parcels, Shopify fulfilment, listing changes, PO mail), and the few GET
 *          requests that send mail, start jobs or change triggers
 *      A stopped save shows "Saving is off in the TEST ERP — nothing was saved" and fails, so no screen pretends it saved.
 *   3. Paths that assumed the site's root ("/logo.png") are made relative, because the test ERP lives in a sub-folder.
 *   4. The offline service worker is not installed, so a phone never keeps an old test version.
 *   5. A speed log (the "⏱ Speed" button): how long each screen took to open in this browser, and how much it downloaded.
 *   6. UAT (Ravi, 21 Nov): a second copy of the factory ERP in uat/ that reads LIVE and keeps every save in the tester's own
 *      browser, with a Reset button (all, after a time, back to a restore point). How it works: tests/uat-guard.js.
 *
 * The build stops with an error if any of these cannot be applied exactly — a test ERP that might write is worse than
 * no test ERP. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
/* TEST_ERP_OUT: the tests build into a folder of their own, never over a real _site/. */
const OUT = process.env.TEST_ERP_OUT ? path.resolve(process.env.TEST_ERP_OUT) : path.join(ROOT, '_site');
const SHA = (process.env.GITHUB_SHA || 'local').slice(0, 7);
const BRANCH = process.env.GITHUB_REF_NAME || 'local';
const WHEN = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
/* THE ONE WRITE THE TEST ERP MAY BE ALLOWED (Ravi, 26 Oct: everything tracked by Shopify). The Shopify hub (test) marks
 * order lines shipped with their tracking numbers through the Pricing API (POST shopify=fulfilLines), so Shopify can track
 * the parcels. That is a real change to a live store and a shipping e-mail to the customer. OFF until the stores' Shopify
 * tokens have the fulfilment permissions and Ravi says to switch it on; then true, and only that one POST goes through —
 * every other write stays stopped. */
const HUB_SHOPIFY_WRITES = false;
/* THE TEST SAVE SWITCH (Ravi, 24 Nov: "get the test save switch off first"). Since the switch to Supabase (main:
 * shared/erp-data/mode.json = "supabase") the LIVE ERP reads and saves the same ERP data project the test link saved into —
 * so a test save was a live save. OFF: the factory ERP and Sellora on the test link only READ ERP data; every save (registers,
 * Firestore documents, compare-and-set) is stopped with "Saving is off", any other write to Supabase is stopped, and the
 * Firestore copier page is not built. UAT is not affected (its saves stay in the tester's browser). Turn it back on only
 * when the test link has an ERP data project of its own. */
const TEST_SAVES = false;
/* Supabase calls that only READ (the doors the test link loads through); any other write to Supabase is stopped */
const SB_READ_DOORS = ['rt_get', 'rt_get_text', 'rt_get_json', 'rt_changes', 'rt_list_upto', 'rt_live_upto', 'fs_get', 'fs_list'];
/* THE FACTORY ERP LOADS FROM SUPABASE (Ravi, 14 Nov: "the test link loads from ERP data … remove these badges"). Its data
 * comes from ERP data (Supabase project R-one MAIN), not Firebase: every read of the factory registers is answered by the
 * door core.rt_get, every Firestore document by core.fs_get / fs_list — the same data in the same shape (proven record for
 * record: migration/rt-proof.md, fs-proof.md). Only a Firestore config document that holds an API key is still read from
 * Firebase (keys are never copied into Supabase). Sign-in stays the ERP login (Supabase checks it).
 * SAVES (Ravi, 16 Nov): the factory ERP's saves go to ERP data ONLY (door core.rt_save) — never to Firebase, so point 2 below
 * still holds for the real ERP: nothing here can change it. Sellora, logins and the backends stay refused as before. Tester
 * data is wiped on switch day (ERP data is reloaded fresh from Firebase).
 * The live Firebase connection (live copies, delta sync, data meter) is not opened. The check badges are off. */
const SB_DATA = { url: 'https://xkpktnsdmpkwaingvdbd.supabase.co', key: 'sb_publishable_niq2DDjeCaqJl3_ccv0vtQ_BS8bqQ2Q' };   // ERP data — publishable key, made for browsers

/* ---- what runs first on every page of the test ERP ---- */
const GUARD = `<script>/* TEST ERP GUARD — added by Replenish-App/tests/build-test-erp.js; not in the real ERP. */
(function () {
  var MSG = 'Saving is off in the TEST ERP \\u2014 nothing was saved.';
  window.__TEST_ERP = { sha: ${JSON.stringify(SHA)}, branch: ${JSON.stringify(BRANCH)}, built: ${JSON.stringify(WHEN)}, blocked: 0, hubShopifyWrites: ${HUB_SHOPIFY_WRITES}, testSaves: ${TEST_SAVES},
    sb: ${JSON.stringify(SB_DATA)}, sbReads: 0, sbOn: !!window.__TEST_ERP_SB_PAGE };
  /* A read of the factory registers (Firebase Realtime Database REST: <path>.json?auth=<sign-in>&orderBy=…) answered by ERP data's
   * door core.rt_get with the same sign-in — same data, same shape. Only pages that turn it on (the factory ERP) use it. */
  /* one call to an ERP data door with the person's sign-in; the answer, or an error that says why */
  function sbRpc(fn, body, tok, origFetch) {
    var sb = window.__TEST_ERP.sb;
    return origFetch(sb.url + '/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(body),
      headers: { apikey: sb.key, Authorization: 'Bearer ' + (tok || sb.key), 'Content-Type': 'application/json', 'Content-Profile': 'core', 'Accept-Profile': 'core' } })
      .then(function (r) { return r.text().then(function (t) {
        if (r.ok) return t ? JSON.parse(t) : null;
        var why = t; try { var j = JSON.parse(t); why = [j.message, j.hint].filter(Boolean).join(' · ') || t; } catch (e) {}
        throw new Error('ERP data ' + r.status + ': ' + why);
      }); });
  }
  /* THIS BROWSER'S COPY of each whole list (IndexedDB, kept across reloads), with the inbox number it is complete up to.
   * A list is downloaded whole only the first time (or after 6 hours); after that only the records saved since arrive —
   * a few KB instead of 22 MB a page. If anything looks off, the whole list is fetched again. */
  var SBDB = null;
  function sbIdb() {
    if (!SBDB) SBDB = new Promise(function (res) {
      try { var r = indexedDB.open('r1-erpdata-copies-2', 1);   /* -2 (16 Nov): copies from before the job-work fix are not used */ r.onupgradeneeded = function () { r.result.createObjectStore('lists'); };
        r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(null); }; } catch (e) { res(null); }
    });
    return SBDB;
  }
  function sbCopy(k, v) {
    return sbIdb().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try { var st = db.transaction('lists', v === undefined ? 'readonly' : 'readwrite').objectStore('lists');
          var q = v === undefined ? st.get(k) : st.put(v, k); q.onsuccess = function () { res(v === undefined ? (q.result || null) : true); }; q.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    });
  }
  function sbSet(o, segs, val) {    /* one record into the copy (null = gone; an emptied group goes too, as in Firebase) */
    var path = [o], cur = o;
    for (var i = 0; i < segs.length - 1; i++) { if (!cur[segs[i]] || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {}; cur = cur[segs[i]]; path.push(cur); }
    if (val == null) delete cur[segs[segs.length - 1]]; else cur[segs[segs.length - 1]] = val;
    for (var j = segs.length - 2; j >= 0; j--) { if (Object.keys(path[j + 1]).length === 0) delete path[j][segs[j]]; else break; }
  }
  /* FAST (Ravi, 14 Nov: "more fast"): the copy is kept as ready JSON TEXT (in this page's memory + IndexedDB), so it is never
   * converted back and forth on an open; a screen gets it AT ONCE, and "what changed since" is asked in the background right
   * after (one at a time per list) — the next open has the changes. Only a list never seen here waits for ERP data. */
  var SBMEM = {}, SBBUSY = {};
  function sbStore(key, m) { SBMEM[key] = m; sbCopy(key, { text: m.text, upto: m.upto, at: m.at }); }
  /* a whole list, downloaded: first the tiny "up to which save" number, then the list itself as it is (16 Nov: packing the
   * list and its number into one answer made ERP data rebuild 5–7 MB per read). The number first: a copy can only be newer. */
  /* C (16 Nov): ERP data also keeps each whole list as a FILE in its file storage; manifest.json says up to which save each file
   * is complete (only confirmed uploads are listed). A first load downloads the file — the database does no work — and the
   * changes since come from rt_changes in the background as usual. No file yet / not allowed / any trouble: the database. */
  var SBMAN = null;
  function sbStorageGet(path, tok, origFetch) {
    var sb = window.__TEST_ERP.sb;
    return origFetch(sb.url + '/storage/v1/object/authenticated/erp-lists/' + path, { headers: { apikey: sb.key, Authorization: 'Bearer ' + (tok || sb.key) }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; });
  }
  function sbManifest(tok, origFetch) {
    if (!SBMAN) SBMAN = sbStorageGet('manifest.json?t=' + Date.now(), tok, origFetch).then(function (t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } });
    return SBMAN;
  }
  function sbFull(key, p, tok, origFetch) {
    return sbManifest(tok, origFetch).then(function (man) {
      var e = man && man[p];
      /* 20 Nov (UAT check 25): a list with no file comes from the database's ready copy, which can be a few seconds behind a
       * save just made — so the saves since are added BEFORE it is shown, exactly as for a file */
      if (!e || e.upto == null) return sbFullDb(key, p, tok, origFetch).then(function (m) {
        return sbRefresh(key, p, tok, origFetch, true).then(function (x) { var n = x || SBMEM[key] || m; if (!n.from) n.from = 'database'; return n; });
      });
      return sbStorageGet(p + '.json?v=' + e.upto, tok, origFetch).then(function (t) {
        if (!t) return sbFullDb(key, p, tok, origFetch);
        var m = { text: t, upto: e.upto, at: Date.now(), from: 'file' }; sbStore(key, m);
        /* a file can be up to 30 minutes behind (16 Nov): the saves since are added BEFORE it is shown — one small answer */
        return sbRefresh(key, p, tok, origFetch, true).then(function (x) { var n = x || SBMEM[key] || m; if (!n.from) n.from = 'file'; return n; });
      });
    });
  }
  /* B (16 Nov): from the database the list comes as plain text ("Accept: text/plain") — handed over as it is, no checking step */
  function sbFullDb(key, p, tok, origFetch) {
    var sb = window.__TEST_ERP.sb;
    return sbRpc('rt_list_upto', { p_reg: p }, tok, origFetch).then(function (upto) {
      return origFetch(sb.url + '/rest/v1/rpc/rt_get_text', { method: 'POST', body: JSON.stringify({ p_path: p }),
        headers: { apikey: sb.key, Authorization: 'Bearer ' + (tok || sb.key), 'Content-Type': 'application/json', Accept: 'text/plain', 'Content-Profile': 'core', 'Accept-Profile': 'core' } })
        .then(function (r) { return r.text().then(function (t) {
          if (r.status === 406) return sbFullJson(key, p, upto, tok, origFetch);     /* plain text refused: the JSON answer instead */
          if (!r.ok) { var why = t; try { var j = JSON.parse(t); why = [j.message, j.hint].filter(Boolean).join(' · ') || t; } catch (e) {} throw new Error('ERP data ' + r.status + ': ' + why); }
          var m = { text: t || 'null', upto: upto, at: Date.now(), from: 'database' }; sbStore(key, m); return m;   /* the answer's own text: never parsed and written again */
        }); });
    });
  }
  function sbFullJson(key, p, upto, tok, origFetch) {
    var sb = window.__TEST_ERP.sb;
    return origFetch(sb.url + '/rest/v1/rpc/rt_get_json', { method: 'POST', body: JSON.stringify({ p_path: p }),
      headers: { apikey: sb.key, Authorization: 'Bearer ' + (tok || sb.key), 'Content-Type': 'application/json', 'Content-Profile': 'core', 'Accept-Profile': 'core' } })
      .then(function (r) { return r.text().then(function (t) {
        if (!r.ok) { var why = t; try { var j = JSON.parse(t); why = [j.message, j.hint].filter(Boolean).join(' · ') || t; } catch (e) {} throw new Error('ERP data ' + r.status + ': ' + why); }
        var m = { text: t || 'null', upto: upto, at: Date.now(), from: 'database' }; sbStore(key, m); return m;
      }); });
  }
  function sbRefresh(key, p, tok, origFetch, afterFile) {
    if (SBBUSY[key]) return SBBUSY[key];
    var m = SBMEM[key];
    var job = sbRpc('rt_changes', { p_reg: p, p_upto: m.upto }, tok, origFetch).then(function (r) {
      if (!r || r.full) return afterFile ? sbFullDb(key, p, tok, origFetch) : sbFull(key, p, tok, origFetch);   /* never file → file again */
      var ks = Object.keys(r.ch || {});
      if (!ks.length) { if (r.upto !== m.upto) sbStore(key, { text: m.text, upto: r.upto, at: m.at }); return SBMEM[key]; }
      var v = JSON.parse(m.text);
      if (Array.isArray(v) || v == null || typeof v !== 'object') return afterFile ? sbFullDb(key, p, tok, origFetch) : sbFull(key, p, tok, origFetch);
      ks.forEach(function (k) { sbSet(v, k.split('/'), r.ch[k]); });
      var n = { text: JSON.stringify(v), upto: r.upto, at: m.at }; sbStore(key, n); return n;
    }).catch(function (e) { try { console.warn('[TEST ERP] could not ask ERP data for changes of ' + p + ': ' + e.message); } catch (x) {} return SBMEM[key]; })
      .then(function (x) { delete SBBUSY[key]; return x; });
    SBBUSY[key] = job;
    return job;
  }
  /* LIVE COPIES (16 Nov), as the live ERP keeps its open lists fresh through Firebase's live connection: every 5 s (while the
   * page is in front) one tiny question — the newest save ERP data has applied (core.rt_live_upto). Only when it moved are the
   * lists this page holds brought up to date, one at a time, so reopening a screen shows the newest data at once. */
  var SBLIVE = { upto: null, busy: false, used: {}, tok: '', ok: true };
  function sbLiveTick() {
    if (SBLIVE.busy || !SBLIVE.ok || !SBLIVE.tok || document.visibilityState === 'hidden' || !Object.keys(SBLIVE.used).length) return;
    SBLIVE.busy = true;
    var of = window.__TEST_ERP.origFetch;
    sbRpc('rt_live_upto', {}, SBLIVE.tok, of).then(function (u) {
      if (SBLIVE.upto !== null && u === SBLIVE.upto) return;
      var first = SBLIVE.upto === null; SBLIVE.upto = u;
      if (first) return;
      window.__TEST_ERP.sbMemo = {};                                   /* short-lived reads are asked again */
      return Object.keys(SBLIVE.used).reduce(function (chain, key) {
        return chain.then(function () { var m = SBMEM[key]; if (!m || m.upto == null || m.upto >= u) return;
          return sbRefresh(key, SBLIVE.used[key], SBLIVE.tok, of); });
      }, Promise.resolve());
    }).catch(function (e) { if (/404|not find the function/.test(String(e && e.message))) SBLIVE.ok = false; })   /* the door is not there yet: plain behaviour */
      .then(function () { SBLIVE.busy = false; });
  }
  setInterval(sbLiveTick, 5000);
  window.__TEST_ERP.sbLive = SBLIVE;
  function sbWhole(p, tok, origFetch) {
    var key = window.__TEST_ERP.sb.url + '|' + p;
    SBLIVE.used[key] = p; if (tok) SBLIVE.tok = tok;
    var fromMem = SBMEM[key] ? Promise.resolve(SBMEM[key]) : sbCopy(key).then(function (c) { if (c && typeof c.text === 'string' && c.upto != null) SBMEM[key] = c; return SBMEM[key] || null; });
    return fromMem.then(function (m) {
      if (!m || Date.now() - (m.at || 0) > 6 * 3600000) return sbFull(key, p, tok, origFetch).then(function (x) { return x.text; });
      if (SBSTALE[key]) {                                /* saved here since: wait for the changes (after any check already on its way) */
        delete SBSTALE[key];
        return (SBBUSY[key] || Promise.resolve()).then(function () { return sbRefresh(key, p, tok, origFetch); }).then(function (x) { return (x || SBMEM[key]).text; });
      }
      /* 18 Nov (UAT): the copy is brought up to date BEFORE it is shown — showing it first and refreshing in the background
       * put old numbers on screen (Sales Orders 3,642 while ERP data had 3,833). One small question; the copy if it fails. */
      return sbRefresh(key, p, tok, origFetch).then(function (x) { return (x || SBMEM[key] || m).text; }, function () { return m.text; });
    });
  }
  /* a part of a list from the page's parsed copy (parsed once per version of the copy) */
  function sbPart(key, text, segs) {
    var m = SBMEM[key]; if (!m) return null;
    if (m.objText !== text) { m.obj = JSON.parse(text); m.objText = text; }
    var v = m.obj; for (var i = 0; i < segs.length; i++) { if (v == null || typeof v !== 'object') return null; v = v[segs[i]]; }
    return v === undefined ? null : v;
  }
  /* THE SPEED LOG of ERP data reads (16 Nov): in the console, __TEST_ERP.sbReport() shows every read — what, how it was
   * answered (copy = from this browser · whole = downloaded · read = asked · part of copy), how long, how big. */
  window.__TEST_ERP.sbLog = [];
  function sbNote(p, how, ms, chars, err) {
    var L = window.__TEST_ERP.sbLog; L.push({ at: new Date().toTimeString().slice(0, 8), screen: String(location.hash || '').slice(1, 30), what: p.slice(0, 60), how: how, ms: ms, kb: Math.round(chars / 1024), error: err || '' });
    if (L.length > 500) L.shift();
  }
  window.__TEST_ERP.sbReport = function () {
    var L = window.__TEST_ERP.sbLog.slice().sort(function (a, b) { return b.ms - a.ms; });
    try { console.table(L.slice(0, 60)); } catch (e) {}
    var by = {}; window.__TEST_ERP.sbLog.forEach(function (r) { var k = r.how; by[k] = by[k] || { reads: 0, ms: 0, kb: 0 }; by[k].reads++; by[k].ms += r.ms; by[k].kb += r.kb; });
    try { console.table(by); } catch (e) {}
    return 'ERP data reads: ' + window.__TEST_ERP.sbLog.length + ' · slowest: ' + L.slice(0, 8).map(function (r) { return r.what + ' ' + r.how + ' ' + r.ms + 'ms ' + r.kb + 'KB' + (r.error ? ' ERR ' + r.error : ''); }).join(' | ');
  };
  function sbRtdb(url, origFetch) {
    var u = new URL(url), q = u.searchParams, tok = q.get('auth') || '';
    var p = decodeURIComponent(u.pathname.replace(/\\.json$/, '').replace(/^\\/+/, ''));
    var body = { p_path: p, p_order_by: null, p_equal_to: null, p_limit_last: null };
    try { if (q.get('orderBy')) body.p_order_by = JSON.parse(q.get('orderBy')); if (q.get('equalTo')) body.p_equal_to = JSON.parse(q.get('equalTo')); } catch (e) {}
    if (q.get('limitToLast')) body.p_limit_last = Number(q.get('limitToLast'));
    var sb = window.__TEST_ERP.sb;
    /* What was loaded is kept 2 minutes (like the live copy the ERP keeps of Firebase), and screens asking for the same thing
     * at the same moment share one request — so reopening a screen asks ERP data nothing. (Saving is off here: nothing this
     * page does can make the copy wrong.) */
    var memoKey = JSON.stringify(body) + (q.get('shallow') || '');
    var M = window.__TEST_ERP.sbMemo || (window.__TEST_ERP.sbMemo = {});
    var hit = M[memoKey];
    var isWhole = p && p.indexOf('/') < 0 && !body.p_order_by && !q.get('shallow');   /* whole lists have their own copy (sbWhole) */
    if (!isWhole && hit && Date.now() - hit.t < 20000) return hit.p.then(function (x) { return new Response(x.text, { status: x.status, statusText: x.statusText, headers: { 'Content-Type': 'application/json', ETag: 'sb' } }); });
    window.__TEST_ERP.sbReads++;
    /* a WHOLE list (the big reads every page makes): from this browser's own copy + only the records saved since */
    var whole = p && p.indexOf('/') < 0 && !body.p_order_by && !q.get('shallow');
    /* a part of completed job work (pt_baseDone/<day>, /_ver, /_auto — the job-work screens read ~70 days ONE AFTER ANOTHER):
     * answered from this browser's one copy of the whole list, at once (16 Nov) */
    var part = !whole && !body.p_order_by && !q.get('shallow') && /^pt_baseDone\\/[^/]+$/.test(p);
    var t0 = Date.now(), how = whole ? (SBMEM[window.__TEST_ERP.sb.url + '|' + p] ? 'copy' : 'whole') : part ? 'part of copy' : 'read';
    var vp = whole ? sbWhole(p, tok, origFetch)
      : part ? sbWhole('pt_baseDone', tok, origFetch).then(function (t) { return sbPart(window.__TEST_ERP.sb.url + '|pt_baseDone', t, p.split('/').slice(1)); })
      : sbRpc('rt_get', body, tok, origFetch);
    vp.then(function (v) { var mm = whole ? SBMEM[window.__TEST_ERP.sb.url + '|' + p] : null;
                           sbNote(p, how === 'whole' && mm && mm.from ? 'whole from ' + mm.from : how, Date.now() - t0, typeof v === 'string' ? v.length : JSON.stringify(v === undefined ? null : v).length, ''); },
            function (e) { sbNote(p, how, Date.now() - t0, 0, e.message); });
    var p0 = vp.then(function (v) {
      if (typeof v === 'string') return new Response(v, { status: 200, headers: { 'Content-Type': 'application/json', ETag: 'sb' } });   /* a whole list: its ready text */
      if (q.get('shallow') === 'true' && v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = true; }); v = o; }
      return new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json', ETag: 'sb' } });
    }, function (e) {   /* the real reason goes into the message the screen shows ("…answered 503 ERP data 500: <why>") */
      try { console.warn('[TEST ERP] ERP data refused the read of ' + p + ': ' + e.message); } catch (x) {}
      return new Response(JSON.stringify({ error: e.message }), { status: /not an ERP sign-in|permission denied/.test(String(e.message)) ? 401 : 503, statusText: String(e.message).replace(/[^\\x20-\\x7e]/g, ' ').slice(0, 180), headers: { 'Content-Type': 'application/json' } });
    });
    /* kept only when it worked: a refused or failed read is asked again next time */
    var keep = isWhole ? null : p0.then(function (r) { return r.clone().text().then(function (t) { if (!r.ok) delete M[memoKey]; return { text: t, status: r.status, statusText: r.statusText }; }); });
    if (keep) keep.catch(function () { delete M[memoKey]; });
    if (!isWhole) M[memoKey] = { t: Date.now(), p: keep };
    return p0;
  }
  function tell(what) {
    window.__TEST_ERP.blocked++;
    try { console.warn('[TEST ERP] blocked: ' + what); } catch (e) {}
    try {
      var t = document.getElementById('testErpToast');
      if (!t) { t = document.createElement('div'); t.id = 'testErpToast'; document.body.appendChild(t); }
      t.textContent = MSG; t.style.display = 'block';
      clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 4000);
    } catch (e) {}
  }
  window.__testErpBlock = function (what) { tell(what); return Promise.reject(new Error(MSG)); };
  /* SAVES ON THE TEST LINK (Ravi, 16 Nov: "saves in test ERP saves on the data"). On the factory ERP a save to the registers
   * goes to ERP data ONLY — through its door core.rt_save, applied at once — and never to Firebase, so the live ERP is never
   * touched. The answer is shaped as Firebase's (PUT/PATCH echo what was written, DELETE null, POST { name }), and a
   * compare-and-set (if-match) goes through core.rt_cas. The lists it touched are asked for their changes before their next
   * open, so the screen shows the save. Tester data is wiped on switch day (ERP data is reloaded fresh from Firebase). */
  var SBETAG = {}, SBETN = 0, SBSTALE = {};
  window.__TEST_ERP.saves = 0;
  function hdrGet(init, name) {
    var h = init && init.headers; if (!h) return null;
    if (typeof h.get === 'function') return h.get(name);
    var ln = name.toLowerCase(); for (var k in h) if (String(k).toLowerCase() === ln) return h[k];
    return null;
  }
  function told(text) {
    try {
      var t = document.getElementById('testErpSaved');
      if (!t) { t = document.createElement('div'); t.id = 'testErpSaved'; document.body.appendChild(t); }
      t.textContent = text; t.style.display = 'block';
      clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 2500);
    } catch (e) {}
  }
  function sbPushId() {    /* a Firebase-style push id: time first, so new records sort last */
    var c = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz', t = Date.now(), s = '';
    for (var i = 0; i < 8; i++) { s = c.charAt(t % 64) + s; t = Math.floor(t / 64); }
    for (var j = 0; j < 12; j++) s += c.charAt(Math.floor(Math.random() * 64));
    return s;
  }
  /* the lists a save touched: their copy is brought up to date before it is shown again; short-lived reads are forgotten */
  function sbTouched(paths) {
    window.__TEST_ERP.sbMemo = {};
    paths.forEach(function (p) { var reg = String(p).split('/')[0]; if (reg) SBSTALE[window.__TEST_ERP.sb.url + '|' + (reg.indexOf('fs') === 0 ? 'fs' : reg)] = 1; });
  }
  window.__TEST_ERP.sbSave = function (changes, screen, tok, origFetch) {
    if (!window.__TEST_ERP.testSaves) return window.__testErpBlock('save to ERP data (test saves are off)');
    return sbRpc('rt_save', { p_changes: changes, p_screen: screen || String(location.hash || '').slice(1, 40) }, tok, origFetch || window.__TEST_ERP.origFetch)
      .then(function (n) { sbTouched(changes.map(function (c) { return c.p; })); window.__TEST_ERP.saves += changes.length; told('Saved to ERP data (test link \\u2014 not the real ERP)'); return n; });
  };
  function sbWrite(url, method, init, origFetch) {
    var u = new URL(url), tok = u.searchParams.get('auth') || '';
    var trimS = function (s) { return String(s).replace(/^\\/+|\\/+$/g, ''); };
    var base = trimS(decodeURIComponent(u.pathname.replace(/\\.json$/, '')));
    var join = function (a, b) { return [a, b].filter(function (x) { return x !== ''; }).join('/'); };
    var body = null;
    try { body = init && init.body != null && init.body !== '' ? JSON.parse(String(init.body)) : null; }
    catch (e) { return Promise.resolve(new Response(JSON.stringify({ error: 'Invalid data; could not parse JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } })); }
    var t = new Date().toISOString(), ch = [], answer = null;
    if (method === 'PUT') { if (base) ch.push({ k: body === null ? 'delete' : 'put', p: base, v: body, t: t }); answer = body; }
    else if (method === 'PATCH') { Object.keys(body || {}).forEach(function (k) { var p = join(base, trimS(k)), v = body[k]; if (p) ch.push({ k: 'patch', p: p, v: v === undefined ? null : v, t: t }); }); answer = body; }
    else if (method === 'DELETE') { if (base) ch.push({ k: 'delete', p: base, v: null, t: t }); answer = null; }
    else if (method === 'POST') { var id = sbPushId(); ch.push({ k: 'put', p: join(base, id), v: body, t: t }); answer = { name: id }; }
    /* bookkeeping, not data (as the live mirror skips them): answered, not saved — ERP data keeps its own "what changed" */
    ch = ch.filter(function (c) { return !/^pt_(sync|syncAudit|dataMeter)(\\/|$)/.test(c.p); });
    var ok = function () { return new Response(JSON.stringify(answer === undefined ? null : answer), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
    var fail = function (e) {
      var m = String((e && e.message) || e), st = /not an ERP sign-in|only an admin|API keys|permission denied/.test(m) ? 403 : 503;
      try { console.warn('[TEST ERP] ERP data did not take the save of ' + base + ': ' + m); } catch (x) {}
      return new Response(JSON.stringify({ error: m }), { status: st, statusText: m.replace(/[^\\x20-\\x7e]/g, ' ').slice(0, 180), headers: { 'Content-Type': 'application/json' } });
    };
    var tag = hdrGet(init, 'if-match');
    if (tag && method === 'PUT') {   /* compare-and-set: written only if the path still holds what was read with this tag */
      if (!(tag in SBETAG)) return Promise.resolve(new Response('{"error":"stale tag"}', { status: 412, headers: { 'Content-Type': 'application/json' } }));
      return sbRpc('rt_cas', { p_path: base, p_expect: SBETAG[tag], p_next: body }, tok, origFetch).then(function (r) {
        if (r === 'changed') return new Response('{"error":"ETag mismatch"}', { status: 412, headers: { 'Content-Type': 'application/json' } });
        delete SBETAG[tag]; sbTouched([base]); window.__TEST_ERP.saves++; told('Saved to ERP data (test link \\u2014 not the real ERP)'); return ok();
      }, fail);
    }
    if (!ch.length) return Promise.resolve(ok());
    return window.__TEST_ERP.sbSave(ch, null, tok, origFetch).then(ok, fail);
  }
  /* Backend GET requests that change something rather than read it. */
  var BACKEND_GET_WRITES = /[?&](notify|shopSkuBuild|adState)=|[?&]repl=(primeSetup|primeStop|primeLiveSetup|primeTest|histbuild)(&|$)/;
  /* UAT: the only sends allowed out — signing in, keeping the sign-in fresh, and Firestore reading (never its save channel) */
  var UAT_MAY_SEND = /identitytoolkit\\.googleapis\\.com\\/v1\\/accounts:(signInWithPassword|signInWithCustomToken|lookup)\\b|securetoken\\.googleapis\\.com\\/|firestore\\.googleapis\\.com\\/(?!.*(\\/Write\\/|:commit|:batchWrite))/;
  var SB_READ_RE = new RegExp('/rest/v1/rpc/(' + ${JSON.stringify(SB_READ_DOORS.join('|'))} + ')$');
  var origFetch = window.fetch;
  window.__TEST_ERP.origFetch = origFetch;
  window.fetch = function (input, init) {
    var url = String((input && input.url) || input || '');
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var write = false, what = '';
    if (/firebasedatabase\\.app|firebaseio\\.com/.test(url) && method !== 'GET' && method !== 'HEAD') { write = true; what = 'database ' + method; }
    else if (/identitytoolkit\\.googleapis\\.com\\/v1\\/accounts:(signUp|update|delete|sendOobCode|setAccountInfo)/.test(url)) { write = true; what = 'login change'; }
    else if (/script\\.google(usercontent)?\\.com/.test(url) && (method !== 'GET' || BACKEND_GET_WRITES.test(url))) { write = true; what = 'backend ' + method; }
    /* The Shopify hub's "mark these lines shipped" (only when HUB_SHOPIFY_WRITES is on), and its two Amazon MCF READS —
     * fees (mcf preview) and status — which change nothing on Amazon. Nothing else; an MCF parcel stays stopped. */
    if (write && method === 'POST' && /script\\.google\\.com/.test(url)) {
      try {
        var b = JSON.parse(String((init && init.body) || '')), only = function (re) { return Object.keys(b).every(function (k) { return re.test(k); }); };
        if (b && window.__TEST_ERP.hubShopifyWrites && b.shopify === 'fulfilLines' && only(/^(shopify|shop|orderId|lines|company|numbers|notify|key|idToken)$/)) write = false;
        if (b && (b.mcf === 'preview' || b.mcf === 'status') && only(/^(mcf|order|mcfId|brand|key|idToken)$/)) write = false;
      } catch (e) { /* not that request: stays stopped */ }
    }
    /* NO LIVE SHOPIFY on the test link (17 Nov, QA review: "too many 429s", 20+ errors every ~45 s). The Pricing API's Shopify
     * reads (?shopify=…) use the SAME store rate limit as the live ERP, so every test-link call takes from the live ERP's share.
     * They get a quiet answer instead; the Shopify screens show the shared copy (shopify_cache, from ERP data) as it is. */
    if (!write && method === 'GET' && /script\\.google(usercontent)?\\.com/.test(url) && /[?&]shopify=/.test(url)) {
      if (!window.__TEST_ERP.shopOffSaid) { window.__TEST_ERP.shopOffSaid = true; try { console.info('[TEST ERP] live Shopify calls are off on the test link (they share the live ERP\\'s Shopify limit)'); } catch (e) {} }
      return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'Live Shopify is off on the test link' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    /* THE UAT PAGE (Ravi, 21 Nov — tests/uat-guard.js): the registers are read from live with the tester's changes laid on
     * top, and a save is kept in this browser only. Any other send to any other service is stopped, except signing in and
     * Firestore's reading channel (its saves never reach the network here: the page's Firestore save functions are replaced). */
    if (window.__UAT && /firebasedatabase\\.app|firebaseio\\.com/.test(url) && method !== 'HEAD') {
      return write ? window.__UAT.write(url, method, init, origFetch) : window.__UAT.read(url, init, origFetch);
    }
    if (window.__UAT && !write && method !== 'GET' && method !== 'HEAD' && !/script\\.google\\.com/.test(url) && !UAT_MAY_SEND.test(url)) { write = true; what = 'send ' + method; }
    /* TEST SAVES OFF: a write to Supabase that is not one of the read doors is stopped (the guard's own reads bypass this) */
    if (!write && !window.__TEST_ERP.testSaves && /\\.supabase\\.co\\//.test(url) && method !== 'GET' && method !== 'HEAD'
        && !SB_READ_RE.test(url.replace(/[?#].*$/, ''))) { write = true; what = 'Supabase ' + method; }
    if (write && window.__TEST_ERP.sbOn && window.__TEST_ERP.testSaves && what.indexOf('database ') === 0) return sbWrite(url, method, init, origFetch);   // only with test saves on: the factory ERP saves to ERP data
    if (write) return window.__testErpBlock(what + ' ' + url.replace(/[?#].*$/, '').slice(0, 120));
    if (window.__TEST_ERP.sbOn && /firebasedatabase\\.app|firebaseio\\.com/.test(url) && method === 'GET') {   // the factory ERP loads from ERP data
      if (!hdrGet(init, 'X-Firebase-ETag')) return sbRtdb(url, origFetch);
      return sbRtdb(url, origFetch).then(function (r) { return r.text().then(function (t) {   /* a read for compare-and-set: its own tag */
        var tg = 'sb' + (++SBETN); try { SBETAG[tg] = JSON.parse(t); } catch (e) {}
        return new Response(t, { status: r.status, statusText: r.statusText, headers: { 'Content-Type': 'application/json', ETag: tg } });
      }); });
    }
    if (url.indexOf('accounts:signInWithPassword') >= 0) slStart('sign-in');
    /* Firestore's listen / write channels stay open for good: not waited for, or no screen would ever be "done". */
    var held = url.indexOf('/channel') < 0;
    if (held) SL.inflight++;
    slAct();
    var p = origFetch.apply(this, arguments);
    if (held) p.then(function () { SL.inflight--; slAct(); }, function () { SL.inflight--; slAct(); });
    return p;
  };

  /* ---- R1 SPEED LOG (test ERP only) ----
   * How long each screen takes to open, measured in this browser: from the click (or the sign-in) to the moment the
   * network goes quiet for a second — the last answer in, and the drawing after it (a busy page shows as a gap in the
   * clock below). Counts what came in: the live database (its WebSocket) and every ordinary request. "first" = the
   * first open of that screen since the page was loaded; "again" = it had its data already. Kept in this browser. */
  var SL = { cur: null, last: Date.now(), inflight: 0, ws: 0, http: 0, reqs: 0, seen: {}, tick: Date.now(), res: [] };
  /* A request, in a few words: which service, and what was asked. */
  function slName(u) {
    try {
      var x = new URL(u, location.href), h = x.hostname, k = '';
      if (h.indexOf('firebasedatabase') >= 0 || h.indexOf('firebaseio') >= 0) k = 'database ' + x.pathname.replace('.json', '').slice(1);
      else if (h.indexOf('firestore') >= 0) k = 'firestore';
      else if (h.indexOf('script.google') >= 0) { var q = []; x.searchParams.forEach(function (v, n) { if (n !== 'key' && q.length < 2) q.push(n + '=' + v.slice(0, 20)); }); k = 'backend ' + q.join(' '); }
      else if (h.indexOf('identitytoolkit') >= 0 || h.indexOf('securetoken') >= 0) k = 'sign-in';
      else k = h.replace('www.', '') + x.pathname.slice(0, 30);
      return k;
    } catch (e) { return String(u).slice(0, 40); }
  }
  var SL_KEY = 'r1SpeedLog';
  function slAct() { SL.last = Date.now(); }
  function slRows() { try { return JSON.parse(localStorage.getItem(SL_KEY) || '[]'); } catch (e) { return []; } }
  function slSave(rows) { try { localStorage.setItem(SL_KEY, JSON.stringify(rows.slice(-300))); } catch (e) {} }
  function slStart(name) {
    if (SL.cur && (SL.cur.name === 'sign-in' || SL.cur.name === 'page load') && name !== 'sign-in' && !SL.cur.hashed) { SL.cur.hashed = true; return; }
    if (SL.cur) slEnd(true);
    SL.cur = { name: name, t0: Date.now(), ws0: SL.ws, http0: SL.http, req0: SL.reqs, busy: 0 };
    slAct();
  }
  function slEnd(cut) {
    var c = SL.cur; if (!c) return; SL.cur = null;
    var title = ''; try { title = String((document.getElementById('pageTitle') || {}).textContent || '').trim(); } catch (e) {}
    var key = c.name === 'sign-in' || c.name === 'page load' ? c.name : (title || c.name);
    var again = !!SL.seen[key]; SL.seen[key] = 1;
    var rows = slRows();
    /* The three slowest requests of this open — where the wait was, when it was the network. */
    var slow = SL.res.filter(function (r) { return r.s >= c.t0 - 50; }).sort(function (a, b) { return b.d - a.d; }).slice(0, 3)
      .map(function (r) { return r.n + ' ' + (Math.round(r.d / 100) / 10) + 's'; }).join(' \\u00b7 ');
    rows.push({ busy: Math.round(c.busy / 100) / 10, slow: slow, at: new Date().toTimeString().slice(0, 8), what: c.name === 'sign-in' ? 'Sign-in \\u2192 ' + (title || 'first screen')
        : c.name === 'page load' ? 'Page load \\u2192 ' + (title || 'first screen') : (title || c.name),
      open: again ? 'again' : 'first', s: Math.round(Math.max(0, SL.last - c.t0) / 100) / 10,
      mb: Math.round((SL.ws - c.ws0 + SL.http - c.http0) / 1e5) / 10, reqs: SL.reqs - c.req0, cut: !!cut,
      build: window.__TEST_ERP.sha });
    slSave(rows);
    slDraw();
  }
  setInterval(function () {
    var now = Date.now();
    if (now - SL.tick > 400) { SL.last = now; if (SL.cur) SL.cur.busy += now - SL.tick; }   // the page was busy (drawing): part of the wait
    SL.tick = now;
    var c = SL.cur;
    if (c && ((SL.inflight <= 0 && now - SL.last > 1000 && now - c.t0 > 300) || now - c.t0 > 180000)) slEnd(false);
  }, 100);
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        SL.http += e.transferSize || e.encodedBodySize || 0; SL.reqs++;
        if (e.name.indexOf('/channel') < 0) SL.res.push({ n: slName(e.name), d: e.duration, s: performance.timeOrigin + e.startTime });
      });
      if (SL.res.length > 800) SL.res = SL.res.slice(-500);
      slAct();
    }).observe({ type: 'resource', buffered: false });
  } catch (e) {}
  try {
    var OWS = window.WebSocket;
    if (OWS) {
      var W = function (u, p) {
        var s = p === undefined ? new OWS(u) : new OWS(u, p);
        s.addEventListener('message', function (ev) { var d = ev.data; SL.ws += typeof d === 'string' ? d.length : ((d && (d.byteLength || d.size)) || 0); slAct(); });
        return s;
      };
      W.prototype = OWS.prototype; W.CONNECTING = 0; W.OPEN = 1; W.CLOSING = 2; W.CLOSED = 3;
      window.WebSocket = W;
    }
  } catch (e) {}
  try {
    var oSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () { this.addEventListener('progress', slAct); this.addEventListener('loadend', slAct); slAct(); return oSend.apply(this, arguments); };
  } catch (e) {}
  window.addEventListener('hashchange', function () { slStart(String(location.hash || '').slice(1) || 'home'); });
  slStart('page load');
  try { SL.cur.t0 = Math.round(performance.timeOrigin); } catch (e) {}   // from the moment the browser asked for the page
  function esc(s) { return String(s == null ? '' : s).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;'); }
  function slDraw() {
    var b = document.getElementById('r1SpeedPanel'); if (!b || b.style.display === 'none') return;
    var rows = slRows().slice().reverse();
    var firsts = {};
    rows.forEach(function (r) { if (r.open === 'first' && !r.cut) (firsts[r.what] = firsts[r.what] || []).push(r.s); });
    var sum = Object.keys(firsts).map(function (k) { var a = firsts[k].slice().sort(function (x, y) { return x - y; }); return [k, a[Math.floor(a.length / 2)], a.length]; })
      .sort(function (x, y) { return y[1] - x[1]; });
    var h = '<div class="r1h"><b>R1 speed log</b> <span>first opens, slowest first (middle of your tries)</span>'
      + '<button id="r1SpCopy">Copy</button><button id="r1SpClear">Clear</button><button id="r1SpClose">Close</button></div>'
      + '<table><tr><th>Screen</th><th>s</th><th>tries</th></tr>'
      + sum.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td class="n">' + x[1] + '</td><td class="n">' + x[2] + '</td></tr>'; }).join('')
      + '</table><div class="r1h"><b>Every open</b> <span>newest first \\u00b7 again = data already loaded</span></div>'
      + '<table><tr><th>Time</th><th>Screen</th><th>Open</th><th>s</th><th title="seconds the page was busy drawing or working out figures">draw s</th><th>MB</th><th>Req</th></tr>'
      + rows.slice(0, 120).map(function (r) { return '<tr><td>' + esc(r.at) + '</td><td>' + esc(r.what) + (r.cut ? ' <i>(left early)</i>' : '')
        + (r.slow ? '<div style="color:#5d636b;font-size:11px">slowest: ' + esc(r.slow) + '</div>' : '') + '</td><td>' + esc(r.open)
        + '</td><td class="n">' + r.s + '</td><td class="n">' + (r.busy == null ? '' : r.busy) + '</td><td class="n">' + r.mb + '</td><td class="n">' + r.reqs + '</td></tr>'; }).join('') + '</table>';
    b.innerHTML = h;
    document.getElementById('r1SpClose').onclick = function () { b.style.display = 'none'; };
    document.getElementById('r1SpClear').onclick = function () { slSave([]); SL.seen = {}; slDraw(); };
    document.getElementById('r1SpCopy').onclick = function () {
      var t = ['time\\tscreen\\topen\\tseconds\\tdraw s\\tMB\\trequests\\tbuild\\tslowest requests'].concat(slRows().map(function (r) {
        return [r.at, r.what + (r.cut ? ' (left early)' : ''), r.open, r.s, r.busy == null ? '' : r.busy, r.mb, r.reqs, r.build, r.slow || ''].join('\\t'); })).join('\\n');
      try { navigator.clipboard.writeText(t); this.textContent = 'Copied'; } catch (e) { window.prompt('Copy this', t); }
    };
  }
  var css = '#testErpLabel{position:fixed;left:10px;bottom:10px;z-index:2147483647;background:#b45309;color:#fff;'
    + 'font:600 12px/1.3 system-ui,sans-serif;padding:6px 10px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);pointer-events:none}'
    + '#testErpToast{display:none;position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#7f1d1d;color:#fff;'
    + 'font:600 14px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3)}'
    + '#testErpSaved{display:none;position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#166534;color:#fff;'
    + 'font:600 13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3);pointer-events:none}'
    + '#r1SpeedBtn{position:fixed;right:10px;bottom:10px;z-index:2147483647;background:#14161a;color:#fff;border:0;'
    + 'font:600 12px/1.3 system-ui,sans-serif;padding:7px 11px;border-radius:8px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}'
    + '#r1SpeedPanel{display:none;position:fixed;right:10px;bottom:48px;z-index:2147483647;width:min(560px,calc(100vw - 20px));max-height:70vh;overflow:auto;'
    + 'background:#fff;color:#15171a;border:1px solid #d6d9de;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);font:12.5px/1.4 system-ui,sans-serif;padding:10px}'
    + '#r1SpeedPanel table{width:100%;border-collapse:collapse;margin:4px 0 10px}#r1SpeedPanel th,#r1SpeedPanel td{text-align:left;padding:3px 6px;border-bottom:1px solid #eceef1}'
    + '#r1SpeedPanel td.n{text-align:right;font-variant-numeric:tabular-nums}#r1SpeedPanel .r1h{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:2px 0}'
    + '#r1SpeedPanel .r1h span{color:#5d636b;flex:1}#r1SpeedPanel button{all:revert;font:600 12px system-ui,sans-serif;color:#15171a;padding:3px 9px;border:1px solid #c9ccd2;border-radius:6px;background:#f6f7f9;cursor:pointer}';
  document.addEventListener('DOMContentLoaded', function () {
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    var l = document.createElement('div'); l.id = 'testErpLabel';
    l.textContent = 'R1 \\u00b7 ' + (window.__UAT ? 'UAT'   /* the UAT bar beside it says the rest */
      : 'test ERP \\u00b7 ' + (window.__TEST_ERP.sbOn ? (window.__TEST_ERP.testSaves ? 'ERP data \\u00b7 saves go to ERP data only' : 'ERP data \\u00b7 saving off') : 'live data, saving off')) + ' \\u00b7 ' + window.__TEST_ERP.branch + ' @ ' + window.__TEST_ERP.sha;
    document.body.appendChild(l);
    var pb = document.createElement('div'); pb.id = 'r1SpeedPanel'; document.body.appendChild(pb);
    var sb = document.createElement('button'); sb.id = 'r1SpeedBtn'; sb.type = 'button'; sb.textContent = '\\u23f1 Speed';
    sb.onclick = function () { pb.style.display = pb.style.display === 'block' ? 'none' : 'block'; slDraw(); };
    document.body.appendChild(sb);
  });
})();
</script>`;

/* ---- R1, the test ERP's mark ---- */
const R1_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#14161a"/>
<text x="32" y="43" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="30" font-weight="700" fill="#ffffff">R1</text>
<rect x="14" y="51" width="36" height="4" rx="2" fill="#d97706"/></svg>`;
/** The sign-in logo: R1, and under it what this copy is ("TEST ERP" or "UAT"). */
const r1Logo = word => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 228" width="560" height="228">
<text x="280" y="150" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="150" letter-spacing="14" fill="#14161a">R1</text>
<text x="280" y="204" text-anchor="middle" font-family="'Segoe UI',Arial,sans-serif" font-size="26" font-weight="600" letter-spacing="12" fill="#b45309">${word}</text></svg>`;

/** Replace exactly `count` occurrences of `find` (string or regex) — or stop the build. */
function must(text, find, repl, count, label) {
  let n = 0;
  /* A string replacement keeps its $1, $2 … meaning (a callback would otherwise insert them literally). */
  const out = text.replace(find instanceof RegExp ? find : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), (...m) => {
    n++;
    return typeof repl === 'function' ? repl(...m) : repl.replace(/\$(\d)/g, (_, i) => (m[Number(i)] == null ? '' : m[Number(i)]));
  });
  if (count != null && n !== count) throw new Error(`${label}: expected ${count} change(s), made ${n}. The source changed — update build-test-erp.js before publishing.`);
  return out;
}

/* A Firestore save as plain changes, in the shape the live mirror sends — fs/<collection>/<id>, a merge leaf by leaf (Firestore
 * merges maps inside maps), server time → now. The test link sends them to ERP data; UAT keeps them in the browser. */
const FS_CHANGE_HELPERS = `/* TEST ERP: a Firestore save as plain changes (build-test-erp.js) */
const __sbFsPlain = v => { if (v === null || v === undefined) return null; if (v instanceof Date) return v.toISOString(); if (Array.isArray(v)) return v.map(__sbFsPlain);
  if (typeof v === 'object') { if (typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch (e) { return null; } }
    if (v._methodName === 'deleteField') return null;
    const n = v.constructor && v.constructor.name; if (v._methodName || (n && n !== 'Object')) return new Date().toISOString();
    const o = {}; for (const k of Object.keys(v)) o[k] = __sbFsPlain(v[k]); return o; }
  return v; };
const __sbFsLeaves = (o, pre, out, t) => { for (const k of Object.keys(o)) { const v = o[k], p = pre + '/' + k;
  if (v && typeof v === 'object' && !Array.isArray(v) && !v._methodName && !(v.constructor && v.constructor.name !== 'Object') && Object.keys(v).length) __sbFsLeaves(v, p, out, t);
  else out.push({ k: 'patch', p, v: __sbFsPlain(v), t }); } return out; };
const __sbFsNewRef = col => { const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 12); return { id, path: String(col.path || col.id) + '/' + id, parent: col }; };`;
/* The test link: a Firestore save goes to ERP data only; a settings document (API keys) is refused. */
const SB_FS_SAVE = `async function __sbFsSave(path, changes) {
  if (String(path || '').split('/')[0] === 'config') return window.__testErpBlock('Firestore settings (API keys stay in Firebase)');
  const tok = (typeof auth !== 'undefined' && auth && auth.currentUser) ? await auth.currentUser.getIdToken() : '';
  await window.__TEST_ERP.sbSave(changes, null, tok).catch(e => { if (/permission denied|not an ERP sign-in|only an admin/.test(String(e && e.message))) e.code = 'permission-denied'; throw e; });
}`;
/* UAT: a Firestore save is kept in this browser (tests/uat-guard.js) — a settings document too, since it never leaves the PC. */
const UAT_FS_SAVE = `async function __uatFsSave(path, changes) {
  const who = (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser.email : '';
  await window.__UAT.fsKeep(changes.map(c => ({ k: c.k === 'delete' || c.v === null ? 'delete' : 'put', p: c.p, v: c.v })), 'Firestore ' + path, who);
}`;
/** One Firestore save function, written to hand its changes to `save` (__sbFsSave on the test link, __uatFsSave on UAT). */
function firestoreWrite(n, hasDoc, save) {
  const now = 'new Date().toISOString()';
  if (n === 'setDoc') return `const setDoc = async (ref, data, opts) => { const t = ${now}, b = 'fs/' + ref.path;
  await ${save}(ref.path, opts && opts.merge ? __sbFsLeaves(data || {}, b, [], t) : [{ k: 'put', p: b, v: __sbFsPlain(data), t }]); };`;
  if (n === 'addDoc') return `const addDoc = async (col, data) => { const ref = ${hasDoc ? 'doc(col)' : '__sbFsNewRef(col)'};
  await ${save}(ref.path, [{ k: 'put', p: 'fs/' + ref.path, v: __sbFsPlain(data), t: ${now} }]); return ref; };`;
  if (n === 'deleteDoc') return `const deleteDoc = async ref => ${save}(ref.path, [{ k: 'delete', p: 'fs/' + ref.path, v: null, t: ${now} }]);`;
  if (n === 'updateDoc') return `const updateDoc = async (ref, data) => { const t = ${now};
  await ${save}(ref.path, Object.keys(data || {}).map(k => ({ k: 'patch', p: 'fs/' + ref.path + '/' + k.split('.').join('/'), v: __sbFsPlain(data[k]), t }))); };`;
  throw new Error('firestoreWrite: ' + n);
}
/* UAT: Firestore reads come from live, with this browser's changes laid on (tests/uat-guard.js). */
function uatFirestoreReads(names) {
  const has = n => names.includes(n);
  return `/* UAT: Firestore reads are live + your changes (build-test-erp.js) */
${has('getDoc') ? 'const getDoc = async ref => { const s = await __real_getDoc(ref); await window.__UAT.ready; return window.__UAT.fsDoc(ref, s); };' : ''}
${has('getDocs') ? 'const getDocs = async q => { const s = await __real_getDocs(q); await window.__UAT.ready; return window.__UAT.fsDocs(q, s); };' : ''}
${has('getDocsFromServer') ? 'const getDocsFromServer = async q => { const s = await __real_getDocsFromServer(q); await window.__UAT.ready; return window.__UAT.fsDocs(q, s); };' : ''}
${has('onSnapshot') ? 'const onSnapshot = (ref, next, err) => window.__UAT.fsWatch(ref, next, err, __real_onSnapshot);' : ''}`;
}

/** The Firestore import: the save functions are renamed and replaced, and so are the reads.
 *  `mode` 'sb' (the test link): saves and reads go to ERP data. 'uat': reads are live + your changes, saves stay in the browser.
 *  A batch or a transaction is refused in both. */
function blockFirestoreWrites(html, label, mode) {
  const WRITES = ['setDoc', 'addDoc', 'deleteDoc', 'updateDoc', 'writeBatch', 'runTransaction'];
  const SAVES = ['setDoc', 'addDoc', 'deleteDoc', 'updateDoc'];
  /* query / orderBy / limit / where become plain descriptions that the ERP data getDocs below answers (Sellora reads its
   * lists as query(collection, orderBy(…), limit(…))). UAT keeps live's own query functions. */
  const READS = mode === 'uat' ? ['getDoc', 'getDocs', 'getDocsFromServer', 'onSnapshot']
    : ['getDoc', 'getDocs', 'getDocsFromServer', 'onSnapshot', 'query', 'orderBy', 'limit', 'where'];
  const save = mode === 'uat' ? '__uatFsSave' : '__sbFsSave';
  return must(html, /import\s*\{([^}]*)\}\s*from\s*"(https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-firestore\.js)";/g, (all, names, url) => {
    const list = names.split(',').map(s => s.trim()).filter(Boolean);
    const blocked = list.filter(n => WRITES.includes(n));
    const read = list.filter(n => READS.includes(n));
    const kept = list.map(n => (WRITES.includes(n) || READS.includes(n) ? `${n} as __real_${n}` : n));
    const stubs = blocked.map(n => SAVES.includes(n) ? firestoreWrite(n, list.includes('doc'), save)
      : `const ${n} = (...a) => window.__testErpBlock('Firestore ${n}');`).join('\n')
      + (blocked.some(n => SAVES.includes(n)) ? '\n' + FS_CHANGE_HELPERS + '\n' + (mode === 'uat' ? UAT_FS_SAVE : SB_FS_SAVE) : '');
    const reads = !read.length ? '' : '\n' + (mode === 'uat' ? uatFirestoreReads(read) : sbFirestoreReads(read));
    return `import { ${kept.join(', ')} }\n  from "${url}";\n/* TEST ERP: Firestore writes are refused (build-test-erp.js). */\n${stubs}` + reads;
  }, 1, label + ' Firestore import');
}
/* TEST ERP: Firestore READS answered by ERP data (core.fs_get / fs_list) with the person's own sign-in — the same documents.
 * A config document is read from Firebase (only it may hold an API key, and keys are never in Supabase). The time fields
 * Firestore keeps as timestamps (at, dataAt, saved, updatedAt) come back as timestamps, so "last updated" still shows. */
function sbFirestoreReads(names) {
  const has = n => names.includes(n);
  return `/* TEST ERP: Firestore reads come from ERP data (build-test-erp.js) */
const __sbTs = s => { const d = new Date(s); return { toDate: () => new Date(d), toMillis: () => d.getTime(), seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toJSON: () => s, toString: () => s, valueOf: () => d.getTime() }; };
const __sbDoc = (ref, v) => { const out = v == null ? undefined : JSON.parse(JSON.stringify(v));
  if (out && typeof out === 'object') for (const f of ['at', 'dataAt', 'saved', 'updatedAt']) if (typeof out[f] === 'string' && /^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(\\.\\d+)?Z$/.test(out[f])) out[f] = __sbTs(out[f]);
  return { id: ref.id, ref, exists: () => v != null, data: () => out, get: f => (out || {})[f] }; };
async function __sbRpc(fn, body) {
  const sb = window.__TEST_ERP.sb, tok = (typeof auth !== 'undefined' && auth && auth.currentUser) ? await auth.currentUser.getIdToken() : '';
  const r = await fetch(sb.url + '/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(body),
    headers: { apikey: sb.key, Authorization: 'Bearer ' + (tok || sb.key), 'Content-Type': 'application/json', 'Content-Profile': 'core', 'Accept-Profile': 'core' } });
  const t = await r.text();
  if (!r.ok) { const er = new Error('ERP data: ' + t.slice(0, 200)); if (/permission denied|not an ERP sign-in/.test(t)) er.code = 'permission-denied'; throw er; }   /* as Firestore says it */
  window.__TEST_ERP.sbReads++; return t ? JSON.parse(t) : null;
}
const __sbIsKeyDoc = ref => String(ref && ref.path || '').split('/')[0] === 'config';
${has('getDoc') ? `const getDoc = async ref => __sbIsKeyDoc(ref) ? __real_getDoc(ref) : __sbDoc(ref, await __sbRpc('fs_get', { p_coll: ref.parent.id, p_id: ref.id }));` : ''}
${has('query') ? 'const query = (col, ...cs) => ({ __sbq: true, col, cs, type: "query" });' : ''}
${has('orderBy') ? 'const orderBy = (f, dir) => ({ __ob: String(f), dir: dir === "desc" ? -1 : 1 });' : ''}
${has('limit') ? 'const limit = n => ({ __lim: Number(n) });' : ''}
${has('where') ? 'const where = (f, op, v) => ({ __wf: String(f), op, v });' : ''}
${has('getDocs') || has('getDocsFromServer') ? `const __sbField = (o, f) => String(f).split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const __sbCmp = (a, b) => { const v = x => (x && typeof x.toMillis === 'function') ? x.toMillis() : x; a = v(a); b = v(b); return a === b ? 0 : a === undefined || a === null ? -1 : b === undefined || b === null ? 1 : a < b ? -1 : 1; };
const __sbGetDocs = async q => { const col = q && q.__sbq ? q.col : q, cs = (q && q.__sbq ? q.cs : []) || [];
  const coll = String(col.path || col.id); const list = await __sbRpc('fs_list', { p_coll: coll }) || [];
  let docs = list.map(x => __sbDoc({ id: x.id, path: coll + '/' + x.id, parent: col }, x.data));
  for (const c of cs) if (c && c.__wf) docs = docs.filter(d => { const a = __sbField(d.data(), c.__wf), b = c.v;
    switch (c.op) { case '==': return __sbCmp(a, b) === 0; case '!=': return __sbCmp(a, b) !== 0; case '<': return __sbCmp(a, b) < 0; case '<=': return __sbCmp(a, b) <= 0;
      case '>': return __sbCmp(a, b) > 0; case '>=': return __sbCmp(a, b) >= 0; case 'in': return (b || []).some(x => __sbCmp(a, x) === 0);
      case 'array-contains': return Array.isArray(a) && a.some(x => __sbCmp(x, b) === 0); default: return true; } });
  const obs = cs.filter(c => c && c.__ob);
  if (obs.length) docs.sort((x, y) => { for (const o of obs) { const r = o.__ob === '__name__' ? __sbCmp(x.id, y.id) : __sbCmp(__sbField(x.data(), o.__ob), __sbField(y.data(), o.__ob)); if (r) return r * o.dir; } return 0; });
  const lim = cs.find(c => c && c.__lim); if (lim) docs = docs.slice(0, lim.__lim);
  return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) }; };` : ''}
${has('getDocs') ? 'const getDocs = __sbGetDocs;' : ''}
${has('getDocsFromServer') ? 'const getDocsFromServer = __sbGetDocs;' : ''}
${has('onSnapshot') ? `const onSnapshot = (ref, next, err) => { let off = false; const run = () => getDoc(ref).then(s => { if (!off) next(s); }).catch(e => { if (!off && typeof err === 'function') err(e); });
  run(); const t = setInterval(run, 15000); return () => { off = true; clearInterval(t); }; };   /* asked again every 15 s (no live channel) */` : ''}`;
}

/* The guard goes just before the page's first <title>, which is the real top of the page in both apps (the factory
 * ERP has no <head> tag of its own, and a "<head>" further down is text inside the code). It must be the first
 * script that runs, and it must never land inside a script. */
function guardPage(html, label) {
  const at = html.search(/<title[\s>]/i);
  if (at < 0 || at > 20000) throw new Error(`${label}: no <title> near the top of the page — the guard has nowhere safe to go.`);
  if (/<script\b/i.test(html.slice(0, at))) throw new Error(`${label}: a script runs before <title>; the guard must run first.`);
  return html.slice(0, at) + GUARD + '\n' + html.slice(at);
}

function copyDir(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    if (f.startsWith('.') || (skip && skip.includes(f))) continue;
    const a = path.join(from, f), b = path.join(to, f);
    fs.statSync(a).isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}

/* ---- build ---- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

/* The factory ERP, built twice from the same page:
 *   replenish/  the test link: loads from and saves to ERP data (Supabase)
 *   uat/        UAT (Ravi, 21 Nov): loads from live Firebase, keeps every save in the tester's browser (tests/uat-guard.js)
 * Both: the live Firebase connection is not opened (its library is not loaded — every screen then reads plainly, which the
 * guard answers), the check badges and the live mirror are off, and the paths work from a sub-folder. */
function buildFactory(folder, mode) {
  const uat = mode === 'uat', name = uat ? 'factory ERP (UAT)' : 'factory ERP';
  const src = path.join(ROOT, 'Replenish-App', 'public'), dst = path.join(OUT, folder);
  copyDir(src, dst, ['index.html']);
  let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  html = guardPage(html, name);
  html = blockFirestoreWrites(html, name, mode);
  html = must(html, '<script>/* TEST ERP GUARD', uat
    ? '<script>' + uatGuardScript() + '</script><script>/* TEST ERP GUARD'
    : '<script>/* TEST ERP GUARD (factory ERP: loads from ERP data) */ window.__TEST_ERP_SB_PAGE = true; </script><script>/* TEST ERP GUARD', 1, name + (uat ? ' UAT guard' : ' loads from ERP data'));
  html = must(html, "import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js')", "Promise.reject(new Error('test ERP: no live Firebase connection — every read is a plain read'))", null, name + ' no live Firebase connection');
  html = must(html, /const ASH = \{(\r?\n)(\s*)on: /, 'const ASH = {$1$2on: false && ', 1, name + ' check badges off');
  /* no read first tries the live Firebase connection that is not there (16 Nov: each read failed on it first — wasted work and
   * "[data meter] Error" in the console); every read goes straight to the plain read, which the guard answers */
  html = must(html, 'const ptLiveable = node => typeof app', 'const ptLiveable = node => false && typeof app', 1, name + ' no live-copy attempt');
  /* the live mirror (core/mirror.js) is OFF here: the test link's saves go to ERP data through the guard, UAT's stay in the
   * browser, and neither may be sent to ERP TEST (whose inbox is the live ERP's — the automatic catch-up copies it into ERP data) */
  html = must(html, /(const MIR = \{\r?\n\s*on: )/, '$1false && ', 1, name + ' live mirror off');
  ['logo.png', 'manifest.webmanifest', 'apple-touch-icon.png', 'wordmark.png'].forEach(f => {
    html = must(html, new RegExp(`(href|src)="/${f.replace('.', '\.')}"`, 'g'), `$1="${f}"`, null, name + ' ' + f);
  });
  /* R-one: its wordmark, the barcode reader and the guide are also loaded from the site root */
  html = must(html, /(["'])\/(r-one-wordmark\.png|vendor\/|guide\/)/g, "$1$2", null, name + ' sub-folder paths');
  /* Meera: the page loads her from /meera/ (meera.version.json, then meera.<hash>.js) — at the site root that is GitHub's
   * own root, a 404, so Meera never opened on the test ERP. Her files sit in the test folder's meera/. */
  html = must(html, /(["'])\/meera\//g, '$1meera/', null, name + ' Meera files');
  /* …and Meera's own script asks for her answers, walks and words at /guide/ and /meera/ the same way. Only quoted paths
   * that start a string are changed; her code is otherwise the same file. */
  const MD = path.join(dst, 'meera');
  if (fs.existsSync(MD)) for (const f of fs.readdirSync(MD).filter(n => /\.js$/.test(n))) {
    const p = path.join(MD, f);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/(["'`])\/(meera|guide)\//g, '$1$2/'));
  }
  html = must(html, "navigator.serviceWorker.register('/sw.js')", 'Promise.resolve()', 1, name + ' service worker');
  html = must(html, "fetch('/', { method: 'HEAD'", "fetch('./', { method: 'HEAD'", 1, name + ' version check');
  /* R1: the test ERP's own name and mark, so nobody mistakes it for the real one. Screens only: documents (POs,
   * challans) keep the company name, which is what a vendor must see. */
  const word = uat ? 'UAT' : 'Test ERP';
  html = must(html, '<title>Ridhi Home &amp; Living</title>', `<title>R1${uat ? ' UAT' : ''}</title>`, null, name + ' title');
  html = must(html, '<link rel="icon" href="logo.png">', '<link rel="icon" href="r1-icon.svg" type="image/svg+xml">', null, name + ' tab icon');
  html = must(html, '<link rel="apple-touch-icon" href="apple-touch-icon.png">', '<link rel="apple-touch-icon" href="r1-icon.svg">', null, name + ' phone icon');
  html = must(html, 'src="wordmark.png" alt="Ridhi Home &amp; Living"', `src="r1-logo.svg" alt="R1 ${word}"`, null, name + ' sign-in logo');
  html = must(html, '<span class="brandname">Ridhi<span class="brandsub">Home &amp; Living</span></span>',
    `<span class="brandname">R1<span class="brandsub">${word}</span></span>`, null, name + ' header name');
  html = must(html, "+ 'Ridhi Home & Living'; } catch (e) { /* nothing depends on it */ }",
    `+ 'R1${uat ? ' UAT' : ''}'; } catch (e) { /* nothing depends on it */ }`, null, name + ' tab name');
  /* UAT: the browser tab says so, and the Reset button sits in the bar with Guide · Install app · Sign out (Ravi's screenshot, 21 Nov) */
  if (uat) html = must(html, '<title>R-one</title>', '<title>R-one · UAT</title>', 1, name + ' tab title');
  if (uat) html = must(html, '<button id="logoutBtn" class="nav">Sign out</button>',
    '<button id="uatResetBtn" class="nav" type="button" title="Your test changes on this PC: reset all, undo after a time, restore points">UAT · Reset</button>'
    + '<button id="logoutBtn" class="nav">Sign out</button>', 1, name + ' Reset button');
  fs.writeFileSync(path.join(dst, 'index.html'), html);
  fs.writeFileSync(path.join(dst, 'r1-icon.svg'), R1_ICON);
  fs.writeFileSync(path.join(dst, 'r1-logo.svg'), r1Logo(uat ? 'UAT' : 'TEST ERP'));
  /* the install manifest: relative to its own folder */
  const mf = JSON.parse(fs.readFileSync(path.join(src, 'manifest.webmanifest'), 'utf8'));
  mf.name = uat ? 'R1 UAT' : 'R1 test ERP'; mf.short_name = uat ? 'R1 UAT' : 'R1'; mf.start_url = './?source=app'; mf.scope = './';
  mf.icons = [{ src: 'r1-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }];
  fs.writeFileSync(path.join(dst, 'manifest.webmanifest'), JSON.stringify(mf, null, 2));
}
/** The UAT guard's code, ready to sit inside a <script> tag. */
function uatGuardScript() {
  const code = fs.readFileSync(path.join(__dirname, 'uat-guard.js'), 'utf8');
  if (/<\/script/i.test(code)) throw new Error('uat-guard.js: "</script" inside it would end the page\'s script early.');
  return code;
}
buildFactory('replenish', 'sb');
buildFactory('uat', 'uat');

/* Sellora */
{
  const src = path.join(ROOT, 'Pricing-App', 'public'), dst = path.join(OUT, 'sellora');
  copyDir(src, dst, ['index.html']);
  let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  html = guardPage(html, 'Sellora');
  /* SELLORA ON ERP DATA (Ravi, 16 Nov): its Firestore reads (getDoc / getDocs with query, orderBy, limit) are answered by ERP
   * data, its saves go to ERP data only (fs/<collection>/<id>), as the factory ERP's do; a settings document with an API key is
   * still read from Firebase and never saved. Its few database reads/writes (the rights copy, pt_perms) go to ERP data too. */
  html = must(html, '<script>/* TEST ERP GUARD', '<script>/* TEST ERP GUARD (Sellora: loads from ERP data) */ window.__TEST_ERP_SB_PAGE = true; </script><script>/* TEST ERP GUARD', 1, 'Sellora loads from ERP data');
  html = blockFirestoreWrites(html, 'Sellora', 'sb');
  html = must(html, /(href|src)="\/logo\.png"/g, '$1="logo.png"', null, 'Sellora logo');
  html = must(html, "fetch('/', { method: 'HEAD'", "fetch('./', { method: 'HEAD'", 1, 'Sellora version check');
  fs.writeFileSync(path.join(dst, 'index.html'), html);
}

/* THE FIRESTORE COPIER (Ravi, 16 Nov: "copier tab B"). Some Firestore documents are written by Apps Script (the Pricing API's
 * ReplSnap / ShopifyCache, Sellora's backends), never by a browser, so no save of the test link carries them into ERP data.
 * This page does what the Apps Script reader would: an ADMIN signed in to the test link opens …/copier/ and leaves it open; it
 * reads Firestore with their own sign-in (names + update times first, then only the changed documents) and hands them to ERP
 * data (core.fs_copy_put — admins only). The collections the scripts write: every 5 minutes; every collection the rules name:
 * every hour. It never writes to Firebase; API keys (config/*: key / secret / token / password fields) are never sent.
 * TEST SAVES OFF (24 Nov): not built — it wrote Firebase's copies over ERP data, which is now the live ERP's own data. */
if (TEST_SAVES) {
  const fsrc = fs.readFileSync(path.join(ROOT, 'Replenish-App', 'public', 'index.html'), 'utf8');
  const key = (fsrc.match(/const FB_KEY = "([^"]+)"/) || [])[1];
  const cfgM = fsrc.match(/const firebaseConfig = \{([\s\S]*?)\};/);
  if (!key || !cfgM) throw new Error('copier: the Firebase web settings were not found in the factory ERP');
  const cfg = '{' + cfgM[1].replace('apiKey: FB_KEY', 'apiKey: ' + JSON.stringify(key)) + '}';
  const rules = fs.readFileSync(path.join(ROOT, 'Pricing-App', 'firestore.rules'), 'utf8');
  const colls = [...new Set([...rules.matchAll(/match\s+\/([A-Za-z_]+)\//g)].map(m => m[1]).filter(c => c !== 'databases'))].sort();
  if (colls.length < 20) throw new Error('copier: the collections were not read from firestore.rules');
  const OFTEN = ['repl', 'replrows', 'replslim', 'replslimrows', 'replshop', 'replshoprows', 'shopify_cache', 'shopify_cache_days'].filter(c => colls.includes(c));
  const dst = path.join(OUT, 'copier'); fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(path.join(dst, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>R1 · Firestore copier</title><link rel="icon" href="../replenish/r1-icon.svg" type="image/svg+xml">
<style>body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#15171a;padding:16px}main{max-width:820px;margin:0 auto;display:grid;gap:12px}
h1{margin:0;font-size:22px}.tag{display:inline-block;background:#b45309;color:#fff;font-weight:700;font-size:12px;padding:2px 8px;border-radius:6px}
.card{background:#fff;border:1px solid #e2e4e8;border-radius:12px;padding:12px 14px}table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #eceef1}td.n{text-align:right;font-variant-numeric:tabular-nums}.bad{color:#b91c1c}.ok{color:#166534}
@media(prefers-color-scheme:dark){body{background:#111214;color:#e9eaec}.card{background:#18191c;border-color:#2a2c30}th,td{border-color:#2a2c30}}</style></head>
<body><main><span class="tag">TEST ERP</span><h1>Firestore copier</h1>
<div class="card" id="who">Checking your sign-in…</div>
<div class="card"><b>Keep this tab open while people test.</b> It copies what the Apps Scripts write to Firestore (Sellora, the Replenishment
snapshots, the Shopify cache) into ERP data: the scripts' collections every 5 minutes, all collections every hour. It only <b>reads</b>
Firebase, and never copies API keys.<div id="state" style="margin-top:6px"></div></div>
<div class="card"><table><thead><tr><th>Collection</th><th>Documents</th><th>Copied</th><th>Last looked</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
</main>
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
const app = initializeApp(${cfg});
const auth = getAuth(app);
const SB = ${JSON.stringify(SB_DATA)};
const PROJ = 'price-research-48ff3', BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJ + '/databases/(default)/documents';
const COLLS = ${JSON.stringify(colls)}, OFTEN = ${JSON.stringify(OFTEN)};
const SECRET = /key|secret|token|pass/i, $ = id => document.getElementById(id), esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const ST = {}; let busy = false, user = null;
const tok = () => user.getIdToken();
const dec = v => { if (!v || typeof v !== 'object') return v; if ('stringValue' in v) return v.stringValue; if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue); if ('booleanValue' in v) return v.booleanValue; if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue; if ('referenceValue' in v) return v.referenceValue; if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return v.bytesValue; if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) { const o = {}, f = v.mapValue.fields || {}; for (const k of Object.keys(f)) o[k] = dec(f[k]); return o; } return v; };
const docOf = d => { const o = {}, f = d.fields || {}; for (const k of Object.keys(f)) o[k] = dec(f[k]); return o; };
const safe = (coll, v) => { if (coll !== 'config' || !v || typeof v !== 'object') return v; const o = {}; for (const k of Object.keys(v)) if (!SECRET.test(k)) o[k] = v[k]; return o; };
const idOf = n => String(n).split('/').pop();
const seenGet = c => { try { return JSON.parse(localStorage.getItem('r1copier.seen.' + c) || 'null'); } catch (e) { return null; } };
const seenSet = (c, m) => { try { localStorage.setItem('r1copier.seen.' + c, JSON.stringify(m)); } catch (e) { /* too big: sent again next round */ } };
async function fsReq(url, opt) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, Object.assign({}, opt || {}, { headers: Object.assign({ Authorization: 'Bearer ' + await tok(), 'Content-Type': 'application/json' }, (opt || {}).headers || {}) }));
    if (r.ok) return r.json();
    if (r.status === 403 || r.status === 404) return null;            // not allowed / not there: skipped
    if (r.status !== 429 && r.status < 500) throw new Error('Firestore ' + r.status + ': ' + (await r.text()).slice(0, 200));
    await new Promise(z => setTimeout(z, 1500 * (i + 1)));
  }
  throw new Error('Firestore did not answer');
}
async function list(coll) {
  const out = {}; let pt = '';
  do { const j = await fsReq(BASE + '/' + encodeURIComponent(coll) + '?pageSize=300&mask.fieldPaths=__name__' + (pt ? '&pageToken=' + encodeURIComponent(pt) : ''));
    if (j === null) return null; for (const d of j.documents || []) out[idOf(d.name)] = d.updateTime; pt = j.nextPageToken || ''; } while (pt);
  return out;
}
async function getDocs(coll, ids) {
  const arr = await fsReq(BASE + ':batchGet', { method: 'POST', body: JSON.stringify({ documents: ids.map(id => 'projects/' + PROJ + '/databases/(default)/documents/' + coll + '/' + id) }) }) || [];
  const out = {}; for (const x of arr) if (x.found) out[idOf(x.found.name)] = { v: safe(coll, docOf(x.found)), t: x.found.updateTime }; return out;
}
async function send(docs) {
  let batch = [], size = 0;
  const flush = async () => { if (!batch.length) return;
    const r = await fetch(SB.url + '/rest/v1/rpc/fs_copy_put', { method: 'POST', body: JSON.stringify({ p_docs: batch }),
      headers: { apikey: SB.key, Authorization: 'Bearer ' + await tok(), 'Content-Type': 'application/json', 'Content-Profile': 'core', 'Accept-Profile': 'core' } });
    if (!r.ok) throw new Error('ERP data ' + r.status + ': ' + (await r.text()).slice(0, 200)); batch = []; size = 0; };
  for (const d of docs) { const s = JSON.stringify(d).length; if (batch.length && (size + s > 3000000 || batch.length >= 300)) await flush(); batch.push(d); size += s; }
  await flush();
}
function draw() {
  $('rows').innerHTML = COLLS.map(c => { const s = ST[c] || {}; return '<tr><td>' + esc(c) + (OFTEN.includes(c) ? ' <small>(scripts)</small>' : '') + '</td><td class="n">' + (s.docs == null ? '' : s.docs)
    + '</td><td class="n">' + (s.copied || 0) + '</td><td>' + (s.at ? new Date(s.at).toLocaleTimeString() : '') + '</td><td class="' + (s.err ? 'bad' : 'ok') + '">' + esc(s.err || (s.skip ? 'not readable' : s.at ? 'ok' : '')) + '</td></tr>'; }).join('');
}
async function one(coll) {
  const s = ST[coll] = ST[coll] || {};
  try {
    const now = await list(coll); s.at = Date.now();
    if (now === null) { s.skip = true; s.err = ''; return; }
    s.docs = Object.keys(now).length; s.skip = false;
    const seen = seenGet(coll) || {};
    const changed = Object.keys(now).filter(id => seen[id] !== now[id]), gone = Object.keys(seen).filter(id => !(id in now));
    for (let i = 0; i < changed.length; i += 40) {
      const ids = changed.slice(i, i + 40), got = await getDocs(coll, ids);
      const ch = ids.filter(id => got[id]).map(id => ({ k: 'put', p: coll + '/' + id, v: got[id].v, t: got[id].t })).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
      await send(ch); ids.forEach(id => { if (got[id]) seen[id] = got[id].t; }); seenSet(coll, seen); s.copied = (s.copied || 0) + ch.length; draw();
    }
    if (gone.length) { await send(gone.map(id => ({ k: 'delete', p: coll + '/' + id, v: null, t: new Date().toISOString() }))); gone.forEach(id => delete seen[id]); seenSet(coll, seen); s.copied = (s.copied || 0) + gone.length; }
    s.err = '';
  } catch (e) { s.err = String(e && e.message || e).slice(0, 120); }
}
async function round() {
  if (busy || !user) return; busy = true;
  const last = Number(localStorage.getItem('r1copier.all') || 0), all = Date.now() - last > 59 * 60000;
  $('state').textContent = 'Copying ' + (all ? 'every collection' : 'the scripts\\' collections') + '…';
  for (const c of (all ? COLLS : OFTEN)) { await one(c); draw(); }
  if (all) localStorage.setItem('r1copier.all', String(Date.now()));
  $('state').textContent = 'Last round ' + new Date().toLocaleTimeString() + ' — next in 5 minutes.';
  busy = false;
}
onAuthStateChanged(auth, u => {
  user = u;
  if (!u) { $('who').innerHTML = '<span class="bad">Not signed in.</span> Sign in on the <a href="../replenish/">factory ERP</a> first (with an admin account), then come back here.'; return; }
  $('who').innerHTML = 'Signed in as <b>' + esc(u.email) + '</b>. Only an admin can copy.';
  draw(); round(); setInterval(round, 5 * 60000);
});
</script></body></html>`);
}

/* The front page of the test ERP */
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>R1 · test ERP</title>
<link rel="icon" href="replenish/r1-icon.svg" type="image/svg+xml">
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#15171a;display:grid;place-items:center;min-height:100vh;padding:16px}
main{max-width:520px;width:100%;display:grid;gap:14px}h1{margin:0;font-size:28px}.tag{display:inline-block;background:#b45309;color:#fff;font-weight:700;font-size:12px;padding:3px 8px;border-radius:6px}
a.card{display:block;background:#fff;border:1px solid #e2e4e8;border-radius:12px;padding:16px 18px;text-decoration:none;color:inherit}a.card:hover{border-color:#2b3a8c}
a.card b{display:block;font-size:18px}small,p{color:#5d636b}@media(prefers-color-scheme:dark){body{background:#111214;color:#e9eaec}a.card{background:#18191c;border-color:#2a2c30}small,p{color:#a0a4ab}}</style></head>
<body><main><img src="replenish/r1-logo.svg" alt="R1" width="200" style="justify-self:start"><span class="tag">TEST ERP</span><h1>R1 · the test ERP</h1>
<p>The same apps as the real ERP, built from the <b>${BRANCH}</b> branch on GitHub. ${TEST_SAVES ? 'Both apps read and <b>save to ERP data (Supabase)</b>.' : 'Both apps read ERP data (Supabase), which is the live ERP\'s own data, so <b>saving is off</b>: nothing you do here is saved anywhere. To try saves, use UAT below.'} E-mails, Shopify, Amazon and logins stay switched off.</p>
<a class="card" href="replenish/"><b>Factory ERP</b><small>Replenishment, production, vendors, stock · loads from ERP data (Supabase) · ${TEST_SAVES ? 'saves to ERP data' : 'saving off'}</small></a>
<a class="card" href="sellora/"><b>Sellora</b><small>Research, sales, listings, advertising · loads from ERP data (Supabase) · ${TEST_SAVES ? 'saves to ERP data' : 'saving off'}</small></a>
<a class="card" href="uat/"><b>UAT · factory ERP on live data</b><small>Reads the live ERP; every change you make stays on your own PC and never reaches live or any other service. Reset any time: everything, after a time, or back to a restore point.</small></a>
${TEST_SAVES ? '<a class="card" href="copier/"><b>Firestore copier</b><small>Admins: keep it open while people test — copies what the Apps Scripts write into ERP data</small></a>' : ''}
<small>Built from commit ${SHA} · ${WHEN}</small></main></body></html>`);

console.log(`test ERP built into ${OUT} from ${BRANCH} @ ${SHA}: factory ERP + Sellora (ERP data), UAT (live, changes kept in the browser).`);
