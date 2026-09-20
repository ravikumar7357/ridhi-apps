/* AN OPEN TAB FINDS OUT THAT IT IS OLD.
 *
 * The page is never served stale — a reload always gets the new build — but nothing makes anybody
 * reload. The factory keeps this tab open all day, and the app's own Refresh button re-reads the DATA,
 * not the code. On 2026-09-20 Ravi reported "QC data still not showing" minutes after the fix was live:
 * the deployed code computed 85 for his line, and his tab, loaded before the deploy, drew a dash.
 *
 * So the tab remembers the ETag it was loaded with, asks again every five minutes and whenever it comes
 * back into view, and shows a bar when the answer changes. IT NEVER RELOADS BY ITSELF — somebody may be
 * half way through an entry.
 *
 * In a plain script of its own, not the module: a fault anywhere in 37,000 lines of module must not be
 * able to switch off the one thing that tells people to get the fix for it.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

one(`<div id="appView" class="shell hide">`,
`<!-- A NEWER BUILD IS LIVE. Outside appView so it shows on the sign-in screen too; see the script just
     before the module for why it exists and why it never reloads the page itself. -->
<div id="appvBar" style="display:none;position:fixed;top:0;left:0;right:0;z-index:9999;background:#7f1d1d;color:#fff;
  padding:9px 14px;font-size:13.5px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)">
  <b>A newer version of this app is live.</b> This tab is still running the old one, so some figures may be
  wrong or missing. Finish what you are typing, then
  <button id="appvReload" style="margin-left:8px;padding:3px 12px;border-radius:7px;border:0;background:#fff;color:#7f1d1d;font-weight:700;cursor:pointer">Reload</button>
</div>
<div id="appView" class="shell hide">`, 'the bar');

one(`<script type="module">
import { initializeApp }`,
`<script>
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
      if (!now) return;                          // offline, or the header was not sent: no opinion
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
</script>
<script type="module">
import { initializeApp }`, 'the script');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
