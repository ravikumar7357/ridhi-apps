/* The "a newer version is live" bar, run for real: the script is cut out of index.html between its two
 * markers and evaluated against a stub browser whose ETag this file controls. */
const fs = require('fs');
const html = fs.readFileSync('C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html', 'utf8');
const a = html.indexOf('/* ==== APP VERSION'), b = html.indexOf('/* ==== END APP VERSION ==== */');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); } };
ok('the version script is in the page, between its markers', a > 0 && b > a);
ok('…in a script of its own, BEFORE the module, so a fault in the module cannot switch it off',
   a < html.indexOf('<script type="module">') && html.lastIndexOf('<script>', a) > html.lastIndexOf('</script>', a));
ok('the bar is outside appView, so the sign-in screen shows it too', html.indexOf('id="appvBar"') < html.indexOf('<div id="appView"') && html.indexOf('id="appvBar"') > 0);
const code = html.slice(a, b);

(async () => {
  let etag = '"build-1"', online = true, hidden = false, reloaded = 0;
  const bar = { style: { display: 'none' } }, btn = {}, listeners = {}, timers = [];
  const env = {
    window: {}, location: { pathname: '/index.html', reload: () => { reloaded++; } },
    document: { getElementById: id => (id === 'appvBar' ? bar : (id === 'appvReload' ? btn : null)), get hidden() { return hidden; },
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

  /* Coming back to the tab asks at once — that is when somebody is about to read a figure. */
  const before = V.checks; hidden = false; (listeners.visibilitychange || []).forEach(fn => fn());
  await new Promise(r => setTimeout(r, 5));
  ok('coming back to the tab asks again at once', V.checks === before + 1, V.checks + ' vs ' + before);
  const b2 = V.checks; hidden = true; (listeners.visibilitychange || []).forEach(fn => fn());
  await new Promise(r => setTimeout(r, 5));
  ok('…and going AWAY from it does not', V.checks === b2);

  ok('the two-answers rule on its own', V.isStale('a', 'b') && !V.isStale('a', 'a') && !V.isStale('', 'b') && !V.isStale('a', ''));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
