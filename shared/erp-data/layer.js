/* R-ONE ON ERP DATA (Supabase) — the layer that makes the ERP and Sellora read and save ERP data instead of Firebase.
 *
 * Put at the very top of each page by shared/erp-data/build.js (only when shared/erp-data/mode.json says "supabase").
 * Before it runs, the build sets  window.__R1_DATA = { url, key, mode: 'live' | 'preview', app, sha }.
 *
 * What it does — the same code the test link proved (13/13 screens identical, saves 8/8, 20 Nov):
 *   READS   a read of the factory registers (Firebase Realtime Database REST, <path>.json?auth=…) is answered by ERP data
 *           (core.rt_get, the list files in storage + core.rt_changes) — same data, same shape, with the person's own sign-in.
 *   SAVES   a PUT / PATCH / POST / DELETE to the registers goes to ERP data (core.rt_save; compare-and-set: core.rt_cas).
 *           Nothing is written to Firebase by the page; the way back (Supabase → Firebase) is done by the server.
 *   LIVE    every 5 s one tiny question (core.rt_live_upto); when something changed, the lists this page holds catch up.
 *   Sign-in stays Firebase Auth (ERP data checks the same sign-in). Firestore is handled in the page's import (build.js).
 *
 * mode 'preview' (a preview/… test link): the same, PLUS everything that changes the outside world is stopped —
 *   backend POSTs (MCF parcels, Shopify fulfilment, PO mails), login changes, and live Shopify reads (they share the live
 *   ERP's Shopify limit). A tester can never send a parcel or a mail from a test link.
 * mode 'live' (main, after the switch): nothing is stopped. */
(function () {
  var C = window.__R1_DATA || {};
  var PREVIEW = C.mode !== 'live';
  var SB = { url: C.url, key: C.key };
  var R1 = window.__R1 = { mode: C.mode, app: C.app, sha: C.sha, sb: SB, reads: 0, saves: 0, blocked: 0, log: [] };
  /* the test link's checks read window.__TEST_ERP — the same object, so the existing check tools work on this build too */
  window.__TEST_ERP = R1; R1.sbOn = true; R1.sbReads = 0;

  function sbRpc(fn, body, tok, of) {
    return of(SB.url + '/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(body),
      headers: { apikey: SB.key, Authorization: 'Bearer ' + (tok || SB.key), 'Content-Type': 'application/json', 'Content-Profile': 'core', 'Accept-Profile': 'core' } })
      .then(function (r) { return r.text().then(function (t) {
        if (r.ok) return t ? JSON.parse(t) : null;
        var why = t; try { var j = JSON.parse(t); why = [j.message, j.hint].filter(Boolean).join(' · ') || t; } catch (e) {}
        throw new Error('ERP data ' + r.status + ': ' + why);
      }); });
  }
  R1.rpc = sbRpc;

  /* THIS BROWSER'S COPY of each whole list (IndexedDB), with the inbox number it is complete up to */
  var SBDB = null;
  function sbIdb() {
    if (!SBDB) SBDB = new Promise(function (res) {
      try { var r = indexedDB.open('r1-erpdata-live-1', 1); r.onupgradeneeded = function () { r.result.createObjectStore('lists'); };
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
  function sbSet(o, segs, val) {
    var path = [o], cur = o;
    for (var i = 0; i < segs.length - 1; i++) { if (!cur[segs[i]] || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {}; cur = cur[segs[i]]; path.push(cur); }
    if (val == null) delete cur[segs[segs.length - 1]]; else cur[segs[segs.length - 1]] = val;
    for (var j = segs.length - 2; j >= 0; j--) { if (Object.keys(path[j + 1]).length === 0) delete path[j][segs[j]]; else break; }
  }
  var SBMEM = {}, SBBUSY = {}, SBSTALE = {};
  function sbStore(key, m) { SBMEM[key] = m; sbCopy(key, { text: m.text, upto: m.upto, at: m.at }); }
  var SBMAN = null;
  function sbStorageGet(path, tok, of) {
    return of(SB.url + '/storage/v1/object/authenticated/erp-lists/' + path, { headers: { apikey: SB.key, Authorization: 'Bearer ' + (tok || SB.key) }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; });
  }
  function sbManifest(tok, of) {
    if (!SBMAN) SBMAN = sbStorageGet('manifest.json?t=' + Date.now(), tok, of).then(function (t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } });
    return SBMAN;
  }
  function sbFull(key, p, tok, of) {
    return sbManifest(tok, of).then(function (man) {
      var e = man && man[p];
      if (!e || e.upto == null) return sbFullDb(key, p, tok, of).then(function (m) {
        return sbRefresh(key, p, tok, of, true).then(function (x) { return x || SBMEM[key] || m; });
      });
      return sbStorageGet(p + '.json?v=' + e.upto, tok, of).then(function (t) {
        if (!t) return sbFullDb(key, p, tok, of);
        var m = { text: t, upto: e.upto, at: Date.now() }; sbStore(key, m);
        return sbRefresh(key, p, tok, of, true).then(function (x) { return x || SBMEM[key] || m; });
      });
    });
  }
  function sbErr(r, t) { var why = t; try { var j = JSON.parse(t); why = [j.message, j.hint].filter(Boolean).join(' · ') || t; } catch (e) {} return new Error('ERP data ' + r.status + ': ' + why); }
  function sbFullDb(key, p, tok, of) {
    return sbRpc('rt_list_upto', { p_reg: p }, tok, of).then(function (upto) {
      return of(SB.url + '/rest/v1/rpc/rt_get_text', { method: 'POST', body: JSON.stringify({ p_path: p }),
        headers: { apikey: SB.key, Authorization: 'Bearer ' + (tok || SB.key), 'Content-Type': 'application/json', Accept: 'text/plain', 'Content-Profile': 'core', 'Accept-Profile': 'core' } })
        .then(function (r) { return r.text().then(function (t) {
          if (r.status === 406) return sbFullJson(key, p, upto, tok, of);
          if (!r.ok) throw sbErr(r, t);
          var m = { text: t || 'null', upto: upto, at: Date.now() }; sbStore(key, m); return m;
        }); });
    });
  }
  function sbFullJson(key, p, upto, tok, of) {
    return of(SB.url + '/rest/v1/rpc/rt_get_json', { method: 'POST', body: JSON.stringify({ p_path: p }),
      headers: { apikey: SB.key, Authorization: 'Bearer ' + (tok || SB.key), 'Content-Type': 'application/json', 'Content-Profile': 'core', 'Accept-Profile': 'core' } })
      .then(function (r) { return r.text().then(function (t) {
        if (!r.ok) throw sbErr(r, t);
        var m = { text: t || 'null', upto: upto, at: Date.now() }; sbStore(key, m); return m;
      }); });
  }
  function sbRefresh(key, p, tok, of, afterFile) {
    if (SBBUSY[key]) return SBBUSY[key];
    var m = SBMEM[key];
    var job = sbRpc('rt_changes', { p_reg: p, p_upto: m.upto }, tok, of).then(function (r) {
      if (!r || r.full) return afterFile ? sbFullDb(key, p, tok, of) : sbFull(key, p, tok, of);
      var ks = Object.keys(r.ch || {});
      if (!ks.length) { if (r.upto !== m.upto) sbStore(key, { text: m.text, upto: r.upto, at: m.at }); return SBMEM[key]; }
      var v = JSON.parse(m.text);
      if (Array.isArray(v) || v == null || typeof v !== 'object') return afterFile ? sbFullDb(key, p, tok, of) : sbFull(key, p, tok, of);
      ks.forEach(function (k) { sbSet(v, k.split('/'), r.ch[k]); });
      var n = { text: JSON.stringify(v), upto: r.upto, at: m.at }; sbStore(key, n); return n;
    }).catch(function (e) { try { console.warn('[R1] could not ask ERP data for changes of ' + p + ': ' + e.message); } catch (x) {} return SBMEM[key]; })
      .then(function (x) { delete SBBUSY[key]; return x; });
    SBBUSY[key] = job;
    return job;
  }
  /* LIVE: every 5 s (page in front) the newest save ERP data has applied; when it moved, the lists held here catch up */
  var LIVE = { upto: null, busy: false, used: {}, tok: '', ok: true };
  R1.sbLive = LIVE;
  setInterval(function () {
    if (LIVE.busy || !LIVE.ok || !LIVE.tok || document.visibilityState === 'hidden' || !Object.keys(LIVE.used).length) return;
    LIVE.busy = true;
    var of = R1.origFetch;
    sbRpc('rt_live_upto', {}, LIVE.tok, of).then(function (u) {
      if (LIVE.upto !== null && u === LIVE.upto) return;
      var first = LIVE.upto === null; LIVE.upto = u;
      if (first) return;
      R1.memo = {};
      return Object.keys(LIVE.used).reduce(function (chain, key) {
        return chain.then(function () { var m = SBMEM[key]; if (!m || m.upto == null || m.upto >= u) return; return sbRefresh(key, LIVE.used[key], LIVE.tok, of); });
      }, Promise.resolve());
    }).catch(function (e) { if (/404|not find the function/.test(String(e && e.message))) LIVE.ok = false; })
      .then(function () { LIVE.busy = false; });
  }, 5000);
  function sbWhole(p, tok, of) {
    var key = SB.url + '|' + p;
    LIVE.used[key] = p; if (tok) LIVE.tok = tok;
    var fromMem = SBMEM[key] ? Promise.resolve(SBMEM[key]) : sbCopy(key).then(function (c) { if (c && typeof c.text === 'string' && c.upto != null) SBMEM[key] = c; return SBMEM[key] || null; });
    return fromMem.then(function (m) {
      if (!m || Date.now() - (m.at || 0) > 6 * 3600000) return sbFull(key, p, tok, of).then(function (x) { return x.text; });
      if (SBSTALE[key]) {
        delete SBSTALE[key];
        return (SBBUSY[key] || Promise.resolve()).then(function () { return sbRefresh(key, p, tok, of); }).then(function (x) { return (x || SBMEM[key]).text; });
      }
      return sbRefresh(key, p, tok, of).then(function (x) { return (x || SBMEM[key] || m).text; }, function () { return m.text; });
    });
  }
  function sbPart(key, text, segs) {
    var m = SBMEM[key]; if (!m) return null;
    if (m.objText !== text) { m.obj = JSON.parse(text); m.objText = text; }
    var v = m.obj; for (var i = 0; i < segs.length; i++) { if (v == null || typeof v !== 'object') return null; v = v[segs[i]]; }
    return v === undefined ? null : v;
  }
  function note(p, how, ms, err) { var L = R1.log; L.push({ at: new Date().toTimeString().slice(0, 8), what: p.slice(0, 60), how: how, ms: ms, error: err || '' }); if (L.length > 300) L.shift(); }
  function json(v, status, statusText, extra) {
    var h = { 'Content-Type': 'application/json' }; if (extra) for (var k in extra) h[k] = extra[k];
    return new Response(typeof v === 'string' ? v : JSON.stringify(v), { status: status || 200, statusText: statusText || '', headers: h });
  }
  function sbRead(url, of) {
    var u = new URL(url), q = u.searchParams, tok = q.get('auth') || '';
    var p = decodeURIComponent(u.pathname.replace(/\.json$/, '').replace(/^\/+/, ''));
    var body = { p_path: p, p_order_by: null, p_equal_to: null, p_limit_last: null };
    try { if (q.get('orderBy')) body.p_order_by = JSON.parse(q.get('orderBy')); if (q.get('equalTo')) body.p_equal_to = JSON.parse(q.get('equalTo')); } catch (e) {}
    if (q.get('limitToLast')) body.p_limit_last = Number(q.get('limitToLast'));
    var memoKey = JSON.stringify(body) + (q.get('shallow') || '');
    var M = R1.memo || (R1.memo = {});
    var whole = p && p.indexOf('/') < 0 && !body.p_order_by && !q.get('shallow');
    var hit = M[memoKey];
    if (!whole && hit && Date.now() - hit.t < 20000) return hit.p.then(function (x) { return json(x.text, x.status, x.statusText, { ETag: 'sb' }); });
    R1.reads++; R1.sbReads++;
    var part = !whole && !body.p_order_by && !q.get('shallow') && /^pt_baseDone\/[^/]+$/.test(p);
    var t0 = Date.now();
    var vp = whole ? sbWhole(p, tok, of)
      : part ? sbWhole('pt_baseDone', tok, of).then(function (t) { return sbPart(SB.url + '|pt_baseDone', t, p.split('/').slice(1)); })
      : sbRpc('rt_get', body, tok, of);
    vp.then(function () { note(p, whole ? 'whole' : part ? 'part' : 'read', Date.now() - t0); }, function (e) { note(p, 'read', Date.now() - t0, e.message); });
    var p0 = vp.then(function (v) {
      if (typeof v === 'string') return json(v, 200, '', { ETag: 'sb' });
      if (q.get('shallow') === 'true' && v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = true; }); v = o; }
      return json(v === undefined ? null : v, 200, '', { ETag: 'sb' });
    }, function (e) {
      try { console.warn('[R1] ERP data refused the read of ' + p + ': ' + e.message); } catch (x) {}
      return json({ error: e.message }, /not an ERP sign-in|permission denied/.test(String(e.message)) ? 401 : 503, String(e.message).replace(/[^\x20-\x7e]/g, ' ').slice(0, 180));
    });
    if (!whole) {
      var keep = p0.then(function (r) { return r.clone().text().then(function (t) { if (!r.ok) delete M[memoKey]; return { text: t, status: r.status, statusText: r.statusText }; }); });
      keep.catch(function () { delete M[memoKey]; });
      M[memoKey] = { t: Date.now(), p: keep };
    }
    return p0;
  }

  /* ---- SAVES ---- */
  var ETAG = {}, ETN = 0;
  function hdrGet(init, name) {
    var h = init && init.headers; if (!h) return null;
    if (typeof h.get === 'function') return h.get(name);
    var ln = name.toLowerCase(); for (var k in h) if (String(k).toLowerCase() === ln) return h[k];
    return null;
  }
  function pushId() {
    var c = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz', t = Date.now(), s = '';
    for (var i = 0; i < 8; i++) { s = c.charAt(t % 64) + s; t = Math.floor(t / 64); }
    for (var j = 0; j < 12; j++) s += c.charAt(Math.floor(Math.random() * 64));
    return s;
  }
  function touched(paths) {
    R1.memo = {};
    paths.forEach(function (p) { var reg = String(p).split('/')[0]; if (reg) SBSTALE[SB.url + '|' + (reg.indexOf('fs') === 0 ? 'fs' : reg)] = 1; });
  }
  R1.sbSave = function (changes, screen, tok, of) {
    return sbRpc('rt_save', { p_changes: changes, p_screen: screen || (C.app + ' ' + String(location.hash || '').slice(1, 30)) }, tok, of || R1.origFetch)
      .then(function (n) { touched(changes.map(function (c) { return c.p; })); R1.saves += changes.length; return n; });
  };
  function sbWrite(url, method, init, of) {
    var u = new URL(url), tok = u.searchParams.get('auth') || '';
    var trimS = function (s) { return String(s).replace(/^\/+|\/+$/g, ''); };
    var base = trimS(decodeURIComponent(u.pathname.replace(/\.json$/, '')));
    var join = function (a, b) { return [a, b].filter(function (x) { return x !== ''; }).join('/'); };
    var body = null;
    try { body = init && init.body != null && init.body !== '' ? JSON.parse(String(init.body)) : null; }
    catch (e) { return Promise.resolve(json({ error: 'Invalid data; could not parse JSON' }, 400)); }
    var t = new Date().toISOString(), ch = [], answer = null;
    if (method === 'PUT') { if (base) ch.push({ k: body === null ? 'delete' : 'put', p: base, v: body, t: t }); answer = body; }
    else if (method === 'PATCH') { Object.keys(body || {}).forEach(function (k) { var p = join(base, trimS(k)), v = body[k]; if (p) ch.push({ k: 'patch', p: p, v: v === undefined ? null : v, t: t }); }); answer = body; }
    else if (method === 'DELETE') { if (base) ch.push({ k: 'delete', p: base, v: null, t: t }); answer = null; }
    else if (method === 'POST') { var id = pushId(); ch.push({ k: 'put', p: join(base, id), v: body, t: t }); answer = { name: id }; }
    ch = ch.filter(function (c) { return !/^pt_(sync|syncAudit|dataMeter)(\/|$)/.test(c.p); });   /* bookkeeping, not data */
    var ok = function () { return json(answer === undefined ? null : answer); };
    var fail = function (e) {
      var m = String((e && e.message) || e), st = /not an ERP sign-in|only an admin|API keys|permission denied/.test(m) ? 403 : 503;
      try { console.warn('[R1] ERP data did not take the save of ' + base + ': ' + m); } catch (x) {}
      return json({ error: m }, st, m.replace(/[^\x20-\x7e]/g, ' ').slice(0, 180));
    };
    var tag = hdrGet(init, 'if-match');
    if (tag && method === 'PUT') {
      if (!(tag in ETAG)) return Promise.resolve(json('{"error":"stale tag"}', 412));
      return sbRpc('rt_cas', { p_path: base, p_expect: ETAG[tag], p_next: body }, tok, of).then(function (r) {
        if (r === 'changed') return json('{"error":"ETag mismatch"}', 412);
        delete ETAG[tag]; touched([base]); R1.saves++; return ok();
      }, fail);
    }
    if (!ch.length) return Promise.resolve(ok());
    return R1.sbSave(ch, null, tok, of).then(ok, fail);
  }

  /* ---- preview only: nothing that changes the outside world ---- */
  var MSG = 'Test link (ERP data preview): this action is off here — nothing was sent.';
  function block(what) {
    R1.blocked++;
    try { console.warn('[R1 preview] stopped: ' + what); } catch (e) {}
    try {
      var t = document.getElementById('r1Toast');
      if (!t) { t = document.createElement('div'); t.id = 'r1Toast'; t.style.cssText = 'display:none;position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#7f1d1d;color:#fff;font:600 14px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:10px'; document.body.appendChild(t); }
      t.textContent = MSG; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 4000);
    } catch (e) {}
    return Promise.reject(new Error(MSG));
  }
  R1.block = block;
  var BACKEND_GET_WRITES = /[?&](notify|shopSkuBuild|adState)=|[?&]repl=(primeSetup|primeStop|primeLiveSetup|primeTest|histbuild)(&|$)/;
  function previewStops(url, method, init) {
    if (/identitytoolkit\.googleapis\.com\/v1\/accounts:(signUp|update|delete|sendOobCode|setAccountInfo)/.test(url)) return 'login change';
    if (/script\.google(usercontent)?\.com/.test(url)) {
      if (method === 'GET' && /[?&]shopify=/.test(url)) return 'shopify-quiet';
      if (method !== 'GET' || BACKEND_GET_WRITES.test(url)) {
        try { var b = JSON.parse(String((init && init.body) || '')), only = function (re) { return Object.keys(b).every(function (k) { return re.test(k); }); };
          if (b && (b.mcf === 'preview' || b.mcf === 'status') && only(/^(mcf|order|mcfId|brand|key|idToken)$/)) return ''; } catch (e) {}
        return 'backend ' + method;
      }
    }
    return '';
  }

  var of = window.fetch;
  R1.origFetch = of;
  window.fetch = function (input, init) {
    var url = String((input && input.url) || input || '');
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var rtdb = /firebasedatabase\.app|firebaseio\.com/.test(url);
    if (PREVIEW) {
      var stop = previewStops(url, method, init);
      if (stop === 'shopify-quiet') return Promise.resolve(json({ ok: false, error: 'Live Shopify is off on the test link' }));
      if (stop) return block(stop + ' ' + url.replace(/[?#].*$/, '').slice(0, 120));
    }
    if (rtdb && method !== 'GET' && method !== 'HEAD') return sbWrite(url, method, init, of);
    if (rtdb && method === 'GET') {
      if (!hdrGet(init, 'X-Firebase-ETag')) return sbRead(url, of);
      return sbRead(url, of).then(function (r) { return r.text().then(function (t) {
        var tg = 'sb' + (++ETN); try { ETAG[tg] = JSON.parse(t); } catch (e) {}
        return json(t, r.status, r.statusText, { ETag: tg });
      }); });
    }
    return of.apply(this, arguments);
  };

  if (PREVIEW) document.addEventListener('DOMContentLoaded', function () {
    var l = document.createElement('div');
    l.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483647;background:#b45309;color:#fff;font:600 12px/1.3 system-ui,sans-serif;padding:6px 10px;border-radius:8px;pointer-events:none';
    l.textContent = 'TEST LINK · ERP data (Supabase) · saves go to ERP data only · ' + (C.sha || '');
    document.body.appendChild(l);
  });
})();
