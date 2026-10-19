/* ==== APP VERSION — does this tab still run the build that is live? ==== */
(function () {
  var APPV = window.__APPV = { base: '', now: '', stale: false, checks: 0 };
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
      if (APPV.isStale(APPV.base, now) && !APPV.stale) { APPV.stale = true; APPV.show(); }
    });
  };
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('appvReload'); if (btn) btn.onclick = function () { location.reload(); };
  });
  APPV.tick();
  setInterval(APPV.tick, 5 * 60 * 1000);
  /* NEW VERSION, TAKEN IN BY ITSELF (Ravi, 16 Oct: "jaise hi mai koi bhi update laoon … update ho jaye"). When the app comes
   * back to the front and a newer build is live, it reloads — but only with nothing open: no dialog, no form being typed
   * in. Otherwise the bar stays and says so, as before. Never in the middle of an entry. */
  APPV.safe = function () {
    try {
      var d = document; if (typeof d.querySelector !== 'function') return false;
      if (d.querySelector('#ptDlg:not(.hide), .modal:not(.hide), .ptmodal:not(.hide), #mobMoreModal:not(.hide)')) return false;
      var ae = d.activeElement; if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName || '')) return false;
      return true;
    } catch (e) { return false; }
  };
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    APPV.tick().then(function () { if (APPV.stale && APPV.safe()) location.reload(); });
  });
})();
/* ==== END APP VERSION ==== */
