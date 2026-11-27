/* SHOPIFY HUB RELOAD (Ravi, 26 Nov 2026: "the reloading is not working properly"). A Reload while the Shopify read is
 * running is kept and read straight after (it used to be dropped); a stock read that never answers gives up, so later
 * Reloads still work; the hub's settings read has a time limit; the hub's own page shows the block-printing picture
 * while it opens and says when it could not open. The real functions are cut out of the files and run with fakes.
 *   node tests/shopify-hub-reload-test.js
 * Teeth: each part undone in a copy of the code must make the suite fail. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const ORIGINAL = {
  local: rd('src/app/shopify/shopify-hub-local.js'), app: rd('public/shopify-hub/app.js'), page: rd('public/shopify-hub/index.html'),
};

/** Cuts one function out of the file (they sit inside the hub's own block, two spaces in). */
const cut = (src, name) => {
  let i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' not found');
  if (src.slice(i - 6, i) === 'async ') i -= 6;
  return src.slice(i, src.indexOf('\n  }\n', i) + 4);
};
const tick = () => new Promise(r => setTimeout(r, 5));

async function suite(S, loud) {
  const fails = [];
  let pass = 0;
  const ok = (name, cond) => { if (cond) { pass++; if (loud) console.log('  PASS ' + name); } else { fails.push(name); if (loud) console.log('  FAIL ' + name); } };

  /* The ERP side, with a fake Pricing API the test answers by hand and short time limits. */
  const consts = (S.local.match(/const SHUB_SETTINGS_MS = \d+, SHUB_INFO_MS = \d+;/) || [''])[0];
  const flag = (S.local.match(/let shubBusy = [^;]+;/) || [''])[0];
  const code = [consts.replace(/= \d+, SHUB_INFO_MS = \d+/, '= 30, SHUB_INFO_MS = 40'), flag,
    cut(S.local, 'shubWithin'), cut(S.local, 'shubSendOrders'),
    'return { shubSendOrders, shubWithin, busy: () => shubBusy };'].join('\n');
  const reads = [], sent = [];
  let infoHangs = false;
  const line = { textContent: '' };
  const frame = { contentWindow: { postMessage: m => sent.push(m) } };
  const fakes = {
    $: id => (id === 'shubFrame' ? frame : line),
    prGet: () => new Promise(resolve => reads.push(resolve)),
    shubInfo: () => (infoHangs ? new Promise(() => {}) : Promise.resolve({ items: 1 })),
    shubOrigin: () => 'https://hub.example', shubDb: '',
  };
  let hub = null;
  try { hub = new Function(...Object.keys(fakes), code)(...Object.values(fakes)); } catch (e) { hub = null; }
  ok('the Reload code could be run', !!hub);
  if (hub) {
    const answerAll = () => { while (reads.length) reads.shift()({ orders: [{ id: 1 }] }); };
    const first = hub.shubSendOrders({});
    await tick();
    hub.shubSendOrders({ Ridhi: ['7'] });          // Reload while the first read is running
    ok('a Reload during a running read is not started twice at once', reads.length === 2);
    answerAll(); await first; await tick(); await tick();
    ok('the first read reaches the hub', sent.length >= 1);
    ok('…and the Reload is read straight after, not dropped', reads.length === 2);
    /* The kept Reload also asks again for order 7 by number (it was not in the window): answer until it is done. */
    for (let i = 0; i < 6; i++) { answerAll(); await tick(); }
    ok('…and its orders reach the hub too', sent.length === 2 && !hub.busy());

    infoHangs = true;
    const stuck = hub.shubSendOrders({});
    await tick(); answerAll();
    await Promise.race([stuck, new Promise(r => setTimeout(r, 300))]);   // a broken copy would wait for ever
    ok('a stock read that never answers gives up, and the orders still go', sent.length === 3 && /gave no answer/.test(JSON.stringify(sent[2].got.info)));
    ok('…so the next Reload still works', !hub.busy());
    let settings = null;
    try { await Promise.race([hub.shubWithin(new Promise(() => {}), 30, 'the hub settings'), new Promise(r => setTimeout(r, 300))]); } catch (e) { settings = e.message; }
    ok('the hub settings read has a time limit', /the hub settings gave no answer/.test(settings || ''));
  }
  ok('Reload uses that limit for the hub settings', S.local.includes("shubWithin(shosConfig(), SHUB_SETTINGS_MS, 'the hub settings')"));

  /* The hub's own page. */
  ok('the hub shows the block-printing picture while it opens', /<div id="page"><div class="s-card s-empty"><img src="\.\.\/loading-print\.svg"[^>]*>Loading…<\/div><\/div>/.test(S.page));
  ok('opening the hub has a 20-second limit', /const HUB_OPEN_MS = 20000;/.test(S.app) && S.app.includes("Promise.race([call('/api/state'), openLimit])"));
  ok('…and then says it could not open and to press Reload', S.app.includes('Could not open the Shopify hub (${esc(e.message)}). Press Reload.'));

  if (loud) console.log(`\n${pass} passed, ${fails.length} failed`);
  return fails;
}

(async () => {
  if ((await suite(ORIGINAL, true)).length) process.exit(1);
  /* A broken copy may leave a time limit firing with nobody listening; that must not end the run early. */
  process.on('unhandledRejection', () => {});
  /* TEETH: each part undone must be caught. */
  const breaks = [
    ['a Reload during a read is dropped again', 'local', '    if (shubBusy) { shubAgain = want || {}; return; }', '    if (shubBusy) return;'],
    ['the kept Reload is never read', 'local', '      if (shubAgain) { const again = shubAgain; shubAgain = null; shubSendOrders(again); }\n', ''],
    ['a stuck stock read blocks Reload for good', 'local', 'info = await shubWithin(shubInfo({ Ridhi, CPC }), SHUB_INFO_MS, \'the ERP stock\');', 'info = await shubInfo({ Ridhi, CPC });'],
    ['the time limit never fires', 'local', 'return Promise.race([work, limit])', 'return Promise.race([work])'],
    ['the settings read waits for ever', 'local', "shubWithin(shosConfig(), SHUB_SETTINGS_MS, 'the hub settings')", 'shosConfig()'],
    ['the hub opens on plain words', 'page', '<img src="../loading-print.svg" alt="" width="90" height="92" style="display:block;margin:0 auto 6px">', ''],
    ['the hub waits for ever to open', 'app', "Promise.race([call('/api/state'), openLimit])", "call('/api/state')"],
    ['a failed opening says nothing useful', 'app', 'Could not open the Shopify hub (${esc(e.message)}). Press Reload.', '${esc(e.message)}'],
  ];
  let missed = 0;
  for (const [name, file, from, to] of breaks) {
    if (!ORIGINAL[file].includes(from)) { console.log('  COULD NOT BREAK IT (anchor missing): ' + name); missed++; continue; }
    const S = Object.assign({}, ORIGINAL, { [file]: ORIGINAL[file].replace(from, () => to) });
    let caught;
    try { caught = (await suite(S, false)).length > 0; } catch (e) { caught = true; }
    console.log((caught ? '  BITES  ' : '  MISSED ') + name);
    if (!caught) missed++;
  }
  console.log(missed ? `\n${missed} break(s) not caught` : '\nevery break was caught');
  process.exit(missed ? 1 : 0);
})();
