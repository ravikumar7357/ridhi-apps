/* ================= WHAT WENT WRONG, AND HOW SLOW (2026-10-17) =================
 *
 * Ravi: "break logs, console error, page unresponsive". About 190 catch blocks in this app swallow their error, so a
 * screen that failed to read looks like a screen with nothing in it, and nobody finds out. This file writes down, from
 * every browser that opens the app:
 *   error    an uncaught error or a promise nobody caught (window 'error' / 'unhandledrejection')
 *   console  anything written with console.error — a karigar's phone has no console anyone reads
 *   freeze   the page stopped answering: the heartbeat timer fired late by more than MON.freezeMs
 *   long     a single task blocked the page for more than MON.longMs (the browser's own long-task timer)
 *   save     a write the production database refused or did not answer (core/history.js reports these)
 *   net      a request that failed outright, or came back 5xx (or 4xx from our own backends)
 *   screen   how long a screen took to settle after it was opened: no request running for MON.quietMs
 * Lines go to pt_monitor/<YYYY-MM-DD>/<id>, a few at a time, after the page has had its say — never on the way of a
 * save. The node falls under the rules' "$other": any staff login writes, only admins read. A vendor login cannot
 * write there and simply leaves no line. Off in the test harnesses (AUDIT_OFF), and with localStorage monOff = '1'.
 * Read back by Backup-Script/Code.gs dailyHealth(), which mails the summary each morning. */
const MON = { on: false, queue: [], seen: new Map(), sent: 0, maxPerSession: 300, maxSame: 5, flushMs: 15000,
  freezeMs: 3000, longMs: 200, beatMs: 1000, quietMs: 800, inflight: 0, tab: null, timer: null };
const monDay = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const monText = (x, n) => String(x == null ? '' : (x && x.stack) || (x && x.message) || x).slice(0, n || 600);

/** One line in the log. Never throws. The same message is kept at most MON.maxSame times a session. */
function monLog(kind, msg, extra) {
  if (!MON.on) return;
  try {
    const key = kind + '|' + String(msg).slice(0, 160);
    const n = (MON.seen.get(key) || 0) + 1;
    MON.seen.set(key, n);
    if (n > MON.maxSame || MON.sent + MON.queue.length >= MON.maxPerSession) return;
    const w = (typeof auditWho === 'function') ? auditWho() : { by: '', tab: '' };
    MON.queue.push(Object.assign({ at: new Date().toISOString(), kind, msg: monText(msg), by: w.by, tab: w.tab,
      ua: (navigator.userAgent || '').slice(0, 120), w: window.innerWidth || 0 }, extra || {}));
    if (!MON.timer) MON.timer = setTimeout(monFlush, kind === 'save' || kind === 'error' ? 2000 : MON.flushMs);
  } catch (e) { /* the log must never break the page */ }
}
/** Send what is queued. A failed send is dropped: the log is best effort, the work is not. */
async function monFlush() {
  MON.timer = null;
  if (!MON.queue.length) return;
  const batch = MON.queue.splice(0, 40), patch = {}, day = monDay();
  batch.forEach(x => { patch['pt_monitor/' + day + '/' + auditId()] = x; });
  MON.sent += batch.length;
  try { await ptAuditWrite(patch); } catch (e) { /* signed out, a vendor, or offline */ }
  if (MON.queue.length && !MON.timer) MON.timer = setTimeout(monFlush, MON.flushMs);
}

/** core/nav.js showTab calls this: the clock for "how long did this screen take to settle" starts here. */
function monScreen(tab) {
  if (!MON.on) return;
  MON.tab = { tab, t0: performance.now(), quietSince: MON.inflight ? 0 : performance.now() };
}
function monScreenCheck() {
  const s = MON.tab;
  if (!s) return;
  const now = performance.now();
  if (MON.inflight > 0) { s.quietSince = 0; return; }
  if (!s.quietSince) { s.quietSince = now; return; }
  if (now - s.quietSince >= MON.quietMs) {
    const ms = Math.round(s.quietSince - s.t0);
    MON.tab = null;
    monLog('screen', s.tab + ' ' + Math.round(ms / 100) / 10 + ' s', { ms, screen: s.tab });
  }
}

/** Requests: count them (for "settled") and note the ones that failed. Only in the browser, only when on. */
function monWrapFetch() {
  const orig = window.fetch;
  if (typeof orig !== 'function' || orig.__mon) return;
  const wrapped = async function (input, init) {
    MON.inflight++;
    const url = String((input && input.url) || input || '');
    const short = url.replace(/[?#].*$/, '').replace(/^https?:\/\//, '').slice(0, 140);
    try {
      const r = await orig.apply(this, arguments);
      if (r && (r.status >= 500 || ((r.status === 401 || r.status === 403) && /firebasedatabase|script\.google/.test(url))))
        monLog('net', r.status + ' ' + short, { status: r.status });
      return r;
    } catch (e) {
      if (!(e && e.name === 'AbortError')) monLog('net', 'failed ' + short + ': ' + monText(e, 120));
      throw e;
    } finally { MON.inflight = Math.max(0, MON.inflight - 1); }
  };
  wrapped.__mon = true;
  window.fetch = wrapped;
}

function monStart() {
  try { if (localStorage.getItem('monOff') === '1') return; } catch (e) { /* storage blocked: stay on */ }
  if (typeof AUDIT !== 'undefined' && !AUDIT.on) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  MON.on = true;
  window.addEventListener('error', ev => {
    if (ev && ev.target && ev.target !== window && (ev.target.src || ev.target.href))
      monLog('error', 'could not load ' + String(ev.target.src || ev.target.href).slice(0, 160));
    else monLog('error', (ev && ev.error) || (ev && ev.message) || 'error', { src: ev && ev.filename ? String(ev.filename).slice(-80) + ':' + ev.lineno : '' });
  }, true);
  window.addEventListener('unhandledrejection', ev => monLog('error', 'unhandled: ' + monText(ev && ev.reason)));
  const ce = console.error;
  console.error = function () {
    try { monLog('console', Array.from(arguments).map(a => monText(a, 300)).join(' ')); } catch (e) { /* ignore */ }
    return ce.apply(console, arguments);
  };
  try {
    new PerformanceObserver(list => list.getEntries().forEach(e => {
      if (e.duration >= MON.longMs) monLog('long', Math.round(e.duration) + ' ms task', { ms: Math.round(e.duration) });
    })).observe({ type: 'longtask', buffered: true });
  } catch (e) { /* not every browser has the long-task timer */ }
  /* The heartbeat: a timer set for 1 s that fires 3 s late means the page was frozen for those seconds. A hidden tab
   * is throttled by the browser on purpose, so only a visible page counts. */
  let last = performance.now();
  setInterval(() => {
    const now = performance.now(), late = now - last - MON.beatMs;
    last = now;
    if (late > MON.freezeMs && document.visibilityState === 'visible') monLog('freeze', 'page did not answer for ' + Math.round(late / 100) / 10 + ' s', { ms: Math.round(late) });
    monScreenCheck();
  }, MON.beatMs);
  monWrapFetch();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') monFlush(); });
}
monStart();
