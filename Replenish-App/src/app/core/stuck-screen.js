/* ================= STUCK SCREENS (26 Nov 2026) =================
 *
 * Ravi: "I want it to be shown also when the screen is stuck". When a read or a save to our own database or to the
 * Apps Script backend has been waiting 3 seconds, the block-printing picture (core/database-read.js, ptLoadingArt)
 * covers the screen with "Still working…". After 30 seconds the words say what to do. The cover lifts the moment the
 * last slow call ends, and it takes no clicks.
 *
 * It watches requests where they leave the page (the same way core/monitor.js counts them), so the screens and the
 * shared helpers stay as they are. Not covered: Firestore (its own connection, not these requests), and a page that
 * is frozen — nothing on a page can be drawn while it is frozen.
 *
 * Errors: quiet by design. The watcher only counts and shows the picture; every request, its answer and its error go
 * back to the screen untouched, exactly as before. If the cover cannot be found it leaves a console line and skips. */
const PT_STUCK = { afterMs: 3000, longMs: 30000, slow: 0, verySlow: 0 };
const PT_STUCK_WORDS = {
  slow: 'Still working…',
  verySlow: 'Still waiting for data. Check the internet, then press Refresh.',
};

/** Only our own data: the database and the Apps Script backend. Pictures, Meera and outside services do not count. */
function ptStuckIsDataCall(input) {
  const url = String((input && input.url) || input || '');
  if (typeof PT_URL === 'string' && url.startsWith(PT_URL)) return true;
  return !!(typeof API !== 'undefined' && API && API.url && url.startsWith(API.url));
}

/** Counts one request as slow after 3 s and very slow after 30 s, for as long as it is still waiting. */
function ptStuckWatch(call) {
  const passed = [];
  const after = (level, ms) => setTimeout(() => { passed.push(level); PT_STUCK[level]++; ptStuckShow(); }, ms);
  const timers = [after('slow', PT_STUCK.afterMs), after('verySlow', PT_STUCK.longMs)];
  return call.finally(() => {
    timers.forEach(clearTimeout);
    passed.forEach(level => { PT_STUCK[level]--; });
    ptStuckShow();
  });
}

function ptStuckShow() {
  const level = PT_STUCK.verySlow > 0 ? 'verySlow' : PT_STUCK.slow > 0 ? 'slow' : '';
  document.body.classList.toggle('ptStuck', !!level);
  if (!level) return;
  const words = document.getElementById('ptStuckWords');
  if (!words) { console.warn('[stuck screen] the cover is missing from the page; no picture shown'); return; }
  words.textContent = PT_STUCK_WORDS[level];
}

function ptStuckStart() {
  const plain = window.fetch;
  if (typeof plain !== 'function' || plain.__stuck) return;
  const watched = function (input, init) {
    const call = plain.apply(this, arguments);
    return ptStuckIsDataCall(input) ? ptStuckWatch(call) : call;
  };
  watched.__stuck = true;
  window.fetch = watched;
}

if (typeof window !== 'undefined') ptStuckStart();
