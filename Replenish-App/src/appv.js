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
  document.addEventListener('visibilitychange', function () { if (!document.hidden) APPV.tick(); });
})();
/* ==== END APP VERSION ==== */
