/* STUCK SCREENS (Ravi, 26 Nov 2026: "I want it to be shown also when the screen is stuck"). A read or save to our
 * database or the Apps Script backend that has waited 1.5 s shows the block-printing cover with "Still working…"; at
 * 30 s the words say what to do; it lifts when the last slow call ends; quick calls and outside services never show
 * it; answers and errors reach the screen untouched. The real file is run with a fake page and a fake clock.
 *   node tests/stuck-screen-test.js
 * Teeth: each part undone in a copy of the code must make the suite fail. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const ORIGINAL = { js: rd('src/app/core/stuck-screen.js'), page: rd('src/index.html'), css: rd('src/styles.css'), order: rd('src/app/ORDER'), testSite: rd('tests/build-test-erp.js') };
const DB = 'https://db.example/app', SCRIPT = 'https://script.example/exec', PRICING = 'https://pricing.example/exec';

/** Runs the real file against a fake page, a fake clock and a fake network. */
function world(js) {
  let now = 0;
  const timers = new Map();
  let id = 0;
  const clock = {
    now: () => now,
    setTimeout: (fn, ms) => { timers.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout: t => timers.delete(t),
    advance: ms => {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].fn();
      }
      now = end;
    },
  };
  const classes = new Set();
  const words = { textContent: '' };
  const screen = { showsLoading: false };
  const heard = {};
  const listen = (type, fn) => { heard[type] = fn; };
  const document = {
    addEventListener: listen,
    body: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } },
    getElementById: id => (id === 'ptStuckWords' ? words : null),
    querySelectorAll: sel => (sel === '.main .ptLoading' && screen.showsLoading ? [{ offsetParent: {} }] : [{ offsetParent: null }]),
  };
  const pending = [];
  const window = {
    addEventListener: listen,
    fetch: url => new Promise((resolve, reject) => pending.push({ url: String(url), resolve, reject })),
  };
  const warns = [];
  new Function('window', 'document', 'setTimeout', 'clearTimeout', 'Date', 'PT_URL', 'API', 'PRAPI', 'console', js)(
    window, document, clock.setTimeout, clock.clearTimeout, { now: () => clock.now() }, DB, { url: SCRIPT }, { url: PRICING }, { warn: (...a) => warns.push(a) });
  /* staff do something (a click, by default), then the screen asks for data */
  const act = (type = 'click') => heard[type] && heard[type]();
  const ask = url => { act(); return window.fetch(url); };
  return { window, clock, classes, words, pending, warns, screen, act, ask, shown: () => classes.has('ptStuck') };
}
const settle = () => new Promise(r => setImmediate(r));

async function suite(S, loud) {
  const fails = [];
  let pass = 0;
  const ok = (name, cond) => { if (cond) { pass++; if (loud) console.log('  PASS ' + name); } else { fails.push(name); if (loud) console.log('  FAIL ' + name); } };

  {
    const w = world(S.js);
    const call = w.ask(DB + '/pt_orders.json');
    w.clock.advance(1400);
    ok('a read under 1.5 seconds shows nothing', !w.shown());
    w.clock.advance(200);
    ok('a read waiting 1.5 seconds shows the block printing', w.shown());
    ok('…saying "Still working…"', w.words.textContent === 'Still working…');
    w.clock.advance(28500);
    ok('after 30 seconds the words say what to do', /Check the internet, then press Refresh/.test(w.words.textContent));
    w.pending[0].resolve('the orders');
    ok('the screen still gets its answer', (await call) === 'the orders');
    await settle();
    ok('the cover lifts when the slow read ends', !w.shown());
  }
  {
    const w = world(S.js);
    const call = w.ask(SCRIPT + '?action=x');
    w.clock.advance(1600);
    ok('a slow Apps Script call counts too', w.shown());
    w.pending[0].reject(new Error('backend down'));
    let err = null;
    try { await call; } catch (e) { err = e; }
    ok('a failed call still fails for the screen, unchanged', err && err.message === 'backend down');
    await settle();
    ok('…and the cover lifts after a failure', !w.shown());
  }
  {
    const w = world(S.js);
    w.ask(PRICING + '?cache=shopSku');
    w.clock.advance(1600);
    ok('a slow read of the Shopify figures (pricing backend) counts too', w.shown());
  }
  {
    const w = world(S.js);
    w.screen.showsLoading = true;                 // Finished Goods: the table already shows the block printing
    w.ask(DB + '/pt_fgi.json');
    w.clock.advance(1600);
    ok('no second picture over a screen that already shows its own', !w.shown());
    w.clock.advance(28500);
    ok('…but after 30 seconds the cover still says what to do', w.shown() && /Check the internet/.test(w.words.textContent));
  }
  {
    const w = world(S.js);
    w.window.fetch(DB + '/pt_orderAlerts.json');   // a background check: nobody clicked
    w.clock.advance(31000);
    ok('a slow background check never brings the cover up', !w.shown());
  }
  {
    const w = world(S.js);
    w.act(); w.clock.advance(3000);
    w.window.fetch(DB + '/pt_ticker.json');         // started 3 s after the click: not what staff wait for
    w.clock.advance(5000);
    ok('a read long after the last click does not count', !w.shown());
  }
  {
    const w = world(S.js);
    w.act('hashchange'); w.window.fetch(DB + '/pt_fgi.json');
    w.clock.advance(1600);
    ok('opening a tab counts as staff waiting', w.shown());
  }
  {
    const w = world(S.js);
    w.ask('https://cdn.example/picture.png');
    w.clock.advance(60000);
    ok('outside services never show the cover', !w.shown());
  }
  {
    const w = world(S.js);
    const a = w.ask(DB + '/a.json'); const b = w.ask(DB + '/b.json');
    w.clock.advance(1600);
    w.pending[0].resolve(1); await a; await settle();
    ok('two slow reads: the cover stays until both end', w.shown());
    w.pending[1].resolve(2); await b; await settle();
    ok('…and lifts when the last one ends', !w.shown());
  }
  {
    const w = world(S.js);
    const quick = w.ask(DB + '/q.json');
    w.pending[0].resolve(1); await quick; await settle();
    w.clock.advance(60000);
    ok('a quick read leaves no timer behind', !w.shown());
  }

  ok('the cover is on the page with the picture and its words', /<div id="ptStuckCover"[^>]*>[\s\S]*?src="\/loading-print\.svg"[\s\S]*?id="ptStuckWords"/.test(S.page));
  ok('the cover takes no clicks', /#ptStuckCover\{[^}]*pointer-events:none/.test(S.css));
  ok('the Refresh cover and the access check win over it', S.css.includes('body.ptStuck:not(.ptBusy):not(.gating) #ptStuckCover{display:flex}'));
  ok('the file is part of the page', /\ncore\/stuck-screen\.js\n/.test(S.order));
  ok('the test site finds the picture beside its page', S.testSite.includes('loading-print\\.svg'));

  if (loud) console.log(`\n${pass} passed, ${fails.length} failed`);
  return fails;
}

(async () => {
  if ((await suite(ORIGINAL, true)).length) process.exit(1);
  /* TEETH: each part undone must be caught. */
  const breaks = [
    ['shows at once, not after 1.5 seconds', 'js', 'afterMs: 1500', 'afterMs: 0'],
    ['waits 3 seconds again', 'js', 'afterMs: 1500', 'afterMs: 3000'],
    ['draws a second picture over the screen\'s own', 'js', "(level === 'slow' && !ptStuckScreenShowsLoading())", "level === 'slow'"],
    ['hides the 30-second words too', 'js', "level === 'verySlow' || ", ''],
    ['background checks show the cover again', 'js', 'return ptStuckStaffWaiting() && ptStuckIsDataCall(input)', 'return ptStuckIsDataCall(input)'],
    ['opening a tab does not count', 'js', "  window.addEventListener('hashchange', acted);\n", ''],
    ['never shows', 'js', "document.body.classList.toggle('ptStuck', show);", ''],
    ['never says what to do', 'js', "PT_STUCK.verySlow > 0 ? 'verySlow' :", ''],
    ['never lifts', 'js', 'passed.forEach(level => { PT_STUCK[level]--; });', ''],
    ['quick calls leave timers behind', 'js', 'timers.forEach(clearTimeout);', ''],
    ['counts every request', 'js', 'return ptStuckStaffWaiting() && ptStuckIsDataCall(input) ? ptStuckWatch(call) : call;', 'return ptStuckWatch(call);'],
    ['forgets the backend', 'js', "(typeof API !== 'undefined' && ours(API)) || ", ''],
    ['forgets the pricing backend', 'js', " || (typeof PRAPI !== 'undefined' && ours(PRAPI))", ''],
    ['the cover swallows clicks', 'css', 'z-index:70;pointer-events:none}\n  body.ptStuck', 'z-index:70}\n  body.ptStuck'],
    ['the file is left out of the page', 'order', 'core/stuck-screen.js\n', ''],
    ['the test site picture is broken again', 'testSite', 'loading-print\\.svg|', ''],
  ];
  let missed = 0;
  for (const [name, file, from, to] of breaks) {
    if (!ORIGINAL[file].includes(from)) { console.log('  COULD NOT BREAK IT (anchor missing): ' + name); missed++; continue; }
    const S = Object.assign({}, ORIGINAL, { [file]: ORIGINAL[file].replace(from, to) });
    let caught;
    try { caught = (await suite(S, false)).length > 0; } catch (e) { caught = true; }
    console.log((caught ? '  BITES  ' : '  MISSED ') + name);
    if (!caught) missed++;
  }
  console.log(missed ? `\n${missed} break(s) not caught` : '\nevery break was caught');
  process.exit(missed ? 1 : 0);
})();
