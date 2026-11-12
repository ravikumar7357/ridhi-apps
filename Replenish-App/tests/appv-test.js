/* The "a newer version is live" bar, run for real: the script is cut out of index.html between its two
 * markers and evaluated against a stub browser whose ETag this file controls. */
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');   // here, not C:/… (GitHub runs it too)
const a = html.indexOf('/* ==== APP VERSION'), b = html.indexOf('/* ==== END APP VERSION ==== */');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); } };
ok('the version script is in the page, between its markers', a > 0 && b > a);
ok('…in a script of its own, BEFORE the module, so a fault in the module cannot switch it off',
   a < html.indexOf('<script type="module">') && html.lastIndexOf('<script>', a) > html.lastIndexOf('</script>', a));
ok('the bar is outside appView, so the sign-in screen shows it too', html.indexOf('id="appvBar"') < html.indexOf('<div id="appView"') && html.indexOf('id="appvBar"') > 0);
const code = html.slice(a, b);

(async () => {
  let clock = 1.8e12, SS = {}, LS = {}, etag = '"build-1"', online = true, hidden = false, reloaded = 0, openDlg = null, active = null;
  const bar = { style: { display: 'none' } }, btn = {}, listeners = {}, timers = [];
  const env = {
    Date: { now: () => clock },
    sessionStorage: { getItem: k => (k in SS ? SS[k] : null), setItem: (k, v) => { SS[k] = String(v); } },
    localStorage: { getItem: k => (k in LS ? LS[k] : null) },
    window: {}, location: { pathname: '/index.html', reload: () => { reloaded++; } },
    document: { getElementById: id => (id === 'appvBar' ? bar : (id === 'appvReload' ? btn : null)), get hidden() { return hidden; },
      querySelector: () => openDlg, get activeElement() { return active; },
      addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); } },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return 1; },
    fetch: async (url, opts) => { if (!online) throw new Error('offline');
      return { ok: true, headers: { get: h => (h === 'etag' ? etag : null) }, _url: url, _opts: opts }; },
  };
  new Function(...Object.keys(env), code)(...Object.values(env));
  const V = env.window.__APPV;
  await new Promise(r => setTimeout(r, 5));

  ok('the first answer is remembered as the build this tab was loaded with', V.base === '"build-1"' && V.stale === false, JSON.stringify(V.base));
  ok('…and the bar stays hidden', bar.style.display === 'none');
  ok('it asks again every five minutes', timers.length === 1 && timers[0].ms === 5 * 60 * 1000, JSON.stringify(timers.map(t => t.ms)));

  await timers[0].fn();
  ok('the same build again changes nothing', V.stale === false && bar.style.display === 'none');

  /* A reading that could not be taken is NOT a new build — a flaky line must not tell the floor to reload. */
  online = false; await timers[0].fn();
  ok('being offline says nothing', V.stale === false && bar.style.display === 'none');
  online = true; etag = ''; await timers[0].fn();
  ok('…nor does an answer with no ETag on it', V.stale === false && bar.style.display === 'none');

  etag = '"build-2"'; await timers[0].fn();
  ok('a different build shows the bar', V.stale === true && bar.style.display === 'block');
  ok('…and the page is NOT reloaded by itself — somebody may be half way through an entry', reloaded === 0);

  (listeners.DOMContentLoaded || []).forEach(fn => fn());
  ok('the Reload button is what reloads', typeof btn.onclick === 'function' && (btn.onclick(), reloaded === 1), String(reloaded));
  ok('…and tags it as the bar, so the data meter can tell it from F5', SS.appvAuto === 'bar', String(SS.appvAuto));
  delete SS.appvAuto;

  /* Coming back to the tab asks at once — that is when somebody is about to read a figure. */
  const before = V.checks; hidden = false; (listeners.visibilitychange || []).forEach(fn => fn());
  await new Promise(r => setTimeout(r, 5));
  ok('coming back to the tab asks again at once', V.checks === before + 1, V.checks + ' vs ' + before);
  const b2 = V.checks; hidden = true; (listeners.visibilitychange || []).forEach(fn => fn());
  await new Promise(r => setTimeout(r, 5));
  ok('…and going AWAY from it does not', V.checks === b2);

  /* A NEW VERSION IS TAKEN IN BY ITSELF — BATCHED (Ravi 12 Nov: "batch + once a day"): only after the tab was away 45 minutes,
   * or has known about the new build 20 hours; never with something open; once per 6 hours; appvInstant=1 keeps the old way. */
  const MIN = 60000, HR = 60 * MIN, fire = () => (listeners.visibilitychange || []).forEach(fn => fn()), wait = () => new Promise(r => setTimeout(r, 5));
  const back = async away => { hidden = true; fire(); clock += away; hidden = false; fire(); await wait(); };
  { let r0 = reloaded;
    await back(10 * MIN);
    ok('away only 10 minutes → no reload, the bar stays', reloaded === r0 && bar.style.display === 'block');
    await back(44 * MIN);
    ok('…44 minutes is still not enough', reloaded === r0);
    openDlg = { id: 'ptDlg' }; await back(2 * HR);
    ok('away 2 hours but a dialog is open → never', reloaded === r0 && !('appvAutoAt' in SS));
    openDlg = null; active = { tagName: 'INPUT' }; await back(2 * HR);
    ok('…nor while a box is being typed in', reloaded === r0);
    active = null; await back(45 * MIN);
    ok('away 45 minutes, newer build, nothing open → reloads by itself', reloaded === r0 + 1, String(reloaded - r0));
    ok('…tagged as automatic, with the time stamped', SS.appvAuto === 'auto' && Number(SS.appvAutoAt) === clock, JSON.stringify(SS));
    r0 = reloaded; await back(3 * HR);
    ok('a second long absence within 6 hours → no second reload (a tab cannot loop)', reloaded === r0);
    await back(2 * HR);
    ok('…still inside the 6 hours', reloaded === r0);
    await back(2 * HR);
    ok('…after 6 hours it may reload again', reloaded === r0 + 1, String(reloaded - r0));
    /* known about the build for over 20 hours: a normal quick return also reloads */
    r0 = reloaded; delete SS.appvAutoAt; V.staleAt = clock - 21 * HR;
    await back(1 * MIN);
    ok('known about the new build 21 hours → a normal safe return reloads', reloaded === r0 + 1, String(reloaded - r0));
    r0 = reloaded; delete SS.appvAutoAt; V.staleAt = clock - 19 * HR;
    await back(1 * MIN);
    ok('…but 19 hours is not yet', reloaded === r0);
    V.staleAt = clock - 21 * HR; openDlg = { id: 'ptDlg' }; await back(1 * MIN); openDlg = null;
    ok('…and the old build with something open still waits', reloaded === r0);
    /* the device override */
    LS.appvInstant = '1'; delete SS.appvAuto; V.staleAt = clock; SS.appvAutoAt = String(clock);
    await back(1000);
    ok('appvInstant=1 → reloads on every safe return at once, as before', reloaded === r0 + 1 && SS.appvAuto === 'auto', String(reloaded - r0));
    openDlg = { id: 'ptDlg' }; await back(1000); openDlg = null;
    ok('…still never with a dialog open', reloaded === r0 + 1);
    LS.appvInstant = '0'; }
  ok('the two-answers rule on its own', V.isStale('a', 'b') && !V.isStale('a', 'a') && !V.isStale('', 'b') && !V.isStale('a', ''));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
