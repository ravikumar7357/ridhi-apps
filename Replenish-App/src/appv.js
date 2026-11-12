/* ==== APP VERSION — does this tab still run the build that is live? ==== */
(function () {
  var APPV = window.__APPV = { base: '', now: '', stale: false, checks: 0, staleAt: 0, hiddenAt: 0 };
  /** Two answers that are both known and differ. An answer that could not be read says nothing. */
  APPV.isStale = function (base, now) { return !!base && !!now && base !== now; };
  APPV.read = function () {
    return fetch(location.pathname + '?appv=' + Date.now(), { method: 'HEAD', cache: 'no-store' })
      .then(function (r) { return (r && r.ok && r.headers && (r.headers.get('etag') || r.headers.get('last-modified'))) || ''; })
      .catch(function () { return ''; });
  };
  APPV.show = function () { var b = document.getElementById('appvBar'); if (b) b.style.display = 'block'; };
  APPV.tick = function () {
    return APPV.read().then(function (now) {
      APPV.checks++;
      /* An answer that could not be read (offline, no ETag) is '' — and isStale treats '' as no opinion, so it
       * needs no guard of its own here. Two guards for one fact is how they come to disagree. */
      if (!APPV.base) { APPV.base = now; return; }   // the first answer is the build this tab was loaded with
      APPV.now = now;
      if (APPV.isStale(APPV.base, now) && !APPV.stale) { APPV.stale = true; APPV.staleAt = Date.now(); APPV.show(); }
    });
  };
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('appvReload'); if (btn) btn.onclick = function () { APPV.tag('bar'); location.reload(); };
  });
  APPV.tick();
  setInterval(APPV.tick, 5 * 60 * 1000);
  /* NEW VERSION, TAKEN IN BY ITSELF — BATCHED, ABOUT ONCE A DAY. Ravi 16 Oct wanted every tab to update the moment he
   * brought a new version; Ravi 12 Nov changed that to "batch + once a day", because every deploy reloaded every open tab of every
   * person (about 11 MB each) and that was most of the database download. Now the red bar still appears within five minutes and
   * anyone can click it to update at once. The app reloads BY ITSELF only when nothing is open (no dialog, no form being typed in,
   * no scan) AND one of these holds: the tab comes back to the front after being away 45 minutes or more (lunch, overnight);
   * or it has known about the newer build for over 20 hours (nobody stays on an old version for days). Never more than once
   * per tab in 6 hours, so a tab can never loop. A device that wants the old instant behaviour sets localStorage appvInstant = 1.
   * Before any reload by the app or the bar, sessionStorage appvAuto says which, so the data meter can tell it from F5. */
  var AWAY_MS = 45 * 60 * 1000, OLD_MS = 20 * 60 * 60 * 1000, GAP_MS = 6 * 60 * 60 * 1000;
  APPV.tag = function (why) { try { sessionStorage.setItem('appvAuto', why); } catch (e) { /* no session storage */ } };
  APPV.instant = function () { try { return localStorage.getItem('appvInstant') === '1'; } catch (e) { return false; } };
  /** Should this safe return to the front reload now? (the 45-minute, 20-hour and 6-hour rules) */
  APPV.due = function () {
    if (APPV.instant()) return true;
    var t = Date.now();
    var away = APPV.hiddenAt && t - APPV.hiddenAt >= AWAY_MS;
    var old = APPV.staleAt && t - APPV.staleAt > OLD_MS;
    if (!away && !old) return false;
    try { var last = Number(sessionStorage.getItem('appvAutoAt')) || 0; if (last && t - last < GAP_MS) return false; } catch (e) { /* no session storage: no cap to read */ }
    return true;
  };
  APPV.safe = function () {
    try {
      var d = document; if (typeof d.querySelector !== 'function') return false;
      if (d.querySelector('#ptDlg:not(.hide), .modal:not(.hide), .ptmodal:not(.hide), #mobMoreModal:not(.hide)')) return false;
      /* never in the middle of a scan (21 Oct): a reload tore the session down and lost the "kept aside" stop */
      if (d.querySelector('#pksOv, .pkvcam')) return false;
      var ae = d.activeElement; if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || '')) return false;
      return true;
    } catch (e) { return false; }
  };
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { APPV.hiddenAt = Date.now(); return; }
    APPV.tick().then(function () {
      if (!(APPV.stale && APPV.safe() && APPV.due())) return;
      if (!APPV.instant()) { try { sessionStorage.setItem('appvAutoAt', String(Date.now())); } catch (e) { /* no session storage */ } }
      APPV.tag('auto'); location.reload();
    });
  });
})();
/* ==== END APP VERSION ==== */
