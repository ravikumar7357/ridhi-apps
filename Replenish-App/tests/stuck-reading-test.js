/* NO SCREEN STAYS ON "READING…" (fix 9 of the PPC flow test, Ravi 26 Nov 2026: Finished Goods stuck on Loading until a page
 * reload; PPC stuck on "Reading the order book…"). Pins, behind switch lineHold: a Finished Goods screen opened while the
 * last small reads of the previous load are still out gets a read of its own; the sign-in token and the live copy give up
 * after 20 seconds; and the PPC table scrolls sideways instead of being cut off.
 *   node tests/stuck-reading-test.js
 *   FG_FILE / READ_FILE / AUTH_FILE / CSS_FILE=<a broken copy>   (the teeth check) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRCDIR = path.join(__dirname, '..', 'src');
const read = (env, rel) => fs.readFileSync(process.env[env] ? path.resolve(process.env[env]) : path.join(SRCDIR, rel), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name); } };
const cut = (s, startRe, end) => { const i = s.search(startRe); if (i < 0) throw new Error(String(startRe) + ' not found');
  return s.slice(i, s.indexOf(end, i) + end.length); };
const tick = () => new Promise(r => setTimeout(r, 5));

const FG = read('FG_FILE', 'app/inventory/finished-goods.js');
const FG_CODE = [cut(FG, /^async function ensureFgi\(/m, '\n}'), cut(FG, /^let FGI_LOADED_MS/m, '\n'),
  cut(FG, /^function fgiLoad\(/m, '\n}'), cut(FG, /^const fgiNeedsNewRead/m, ';\n'), cut(FG, /^async function fgiLoadRun\(/m, '\n}')].join('\n');

/** A Finished Goods screen over a made-up database. The first load's listing read never answers. */
function fgScreen(switchOn, tails) {
  const seen = { ledgerReads: 0, drawn: '' };
  let listingCalls = 0;
  const ctx = { console, lineHoldOn: () => switchOn, FGI: { rows: null, busy: false }, FGI_PICK: {}, PTG_ALL: [], FLOW_ON: false,
    ptNeed: async () => {}, ptGet: async n => { if (n === 'pt_fgiLedger') seen.ledgerReads++; return {}; }, ptList: v => Object.values(v || {}), ptStamp: () => '',
    fbaBadge() {}, fgiOverBadge() {}, fgiCorrLoad: async () => {}, fnLoad: async () => {}, lstMaybeRefresh() {},
    lstLoad: () => { listingCalls++;
      if (tails) return new Promise(done => tails.push(done));   // the test lets each read's tail end when it chooses
      return listingCalls === 1 ? new Promise(() => {}) : Promise.resolve(); } };
  ctx.renderFgi = () => { seen.drawn = ctx.FGI.busy ? 'reading' : 'list'; };
  vm.createContext(ctx);
  vm.runInContext(FG_CODE + '\nglobalThis.__F = { ensureFgi, fgiLoad };', ctx);
  return { ctx, seen, F: ctx.__F };
}

(async () => {
  console.log('== Finished Goods opened again while the last small reads are still out ==');
  for (const on of [true, false]) {
    const { ctx, seen, F } = fgScreen(on);
    F.fgiLoad(true); await tick();                      // the ledger is in; the listing read hangs
    ctx.FGI.rows = null; F.ensureFgi(); await tick();   // the screen is opened again
    if (on) ok('switch on: the list is drawn, not left reading (the ledger is read again)', seen.drawn === 'list' && ctx.FGI.busy === false && seen.ledgerReads === 2);
    else ok('switch off: as before — it stays reading (the fault the test found)', seen.drawn === 'reading' && ctx.FGI.busy === true && seen.ledgerReads === 1);
  }
  { const { ctx, seen, F } = fgScreen(true);
    const a = F.fgiLoad(), b = F.fgiLoad();
    ok('two asks while the ledger is still being read share one read', a === b);
    await tick();
    ok('a later ask with the list already there shares the read in flight too', F.fgiLoad(true) === a && ctx.FGI.rows !== null && seen.ledgerReads === 1); }

  { const tails = [], { ctx, seen, F } = fgScreen(true, tails);
    F.fgiLoad(true); await tick();                      // read A: ledger in, tail still out
    ctx.FGI.rows = null; F.ensureFgi(); await tick();   // read B: ledger in, tail still out
    tails[0](); await tick();                           // A ends late
    ctx.FGI.busy = false;
    const b = F.fgiLoad(true);
    ok('an old read ending late leaves the newer read in place (no third ledger read)', seen.ledgerReads === 2 && tails.length === 2 && typeof b.then === 'function'); }

  console.log('== the two steps before a read give up after 20 seconds ==');
  const DR = read('READ_FILE', 'app/core/database-read.js'), AUTH = read('AUTH_FILE', 'app/core/database-auth.js');
  const steps = (switchOn, hang) => {
    const waits = [];
    const ctx = { console: { warn() {}, log() {} }, lineHoldOn: () => switchOn, clearTimeout,
      setTimeout: (fn, ms) => { waits.push(ms); return setTimeout(fn, 1); },   // 20 s passes at once
      auth: { currentUser: { getIdToken: () => (hang ? new Promise(() => {}) : Promise.resolve('tok')) } },
      ptLiveDb: () => (hang ? new Promise(() => {}) : Promise.resolve({})) };
    vm.createContext(ctx);
    vm.runInContext([cut(DR, /^const PT_STEP_MS/m, '\n'), cut(DR, /^const ptStepLimitOn/m, '\n'), cut(DR, /^function ptWithin\(/m, '\n}'),
      cut(AUTH, /^async function ptAuthQuery\(/m, '\n}'), cut(DR, /^async function ptLiveStarted\(/m, '\n}'),
      'globalThis.__S = { ptAuthQuery, ptLiveStarted };'].join('\n'), ctx);
    return { S: ctx.__S, waits };
  };
  const settled = p => Promise.race([p.then(v => ({ v }), e => ({ e })), new Promise(r => setTimeout(() => r({ hung: true }), 60))]);
  { const { S, waits } = steps(true, true);
    const t = await settled(S.ptAuthQuery());
    ok('a token that never comes fails with what to do next, after 20 s', !!t.e && /No answer for 20 seconds. Check the internet, then try again./.test(t.e.message) && waits[0] === 20000);
    const l = await settled(S.ptLiveStarted());
    ok('a live copy that never starts is given up on, so the register is read the ordinary way', l.v === false); }
  { const { S } = steps(true, false);
    ok('a token and a live copy that answer are used as before', (await settled(S.ptAuthQuery())).v === '?auth=tok' && (await settled(S.ptLiveStarted())).v === true); }
  { const { S, waits } = steps(false, true);
    const t = await settled(S.ptAuthQuery());
    ok('switch off: no time limit, as before', t.hung === true && waits.length === 0); }
  ok('with the switch on, a live read waits only for a live copy that started', DR.includes("const v = typeof ptStepLimitOn === 'function' && ptStepLimitOn() && !(await ptLiveStarted()) ? PT_LIVE_NO : await ptLiveRead(node);"));

  console.log('== the PPC table ==');
  const CSS = read('CSS_FILE', 'styles.css');
  ok('the PPC table box scrolls sideways instead of cutting columns off', /#p1Home \.p1-list\{[^}]*overflow-x:auto[^}]*\}/.test(CSS) && !/#p1Home \.p1-list\{[^}]*overflow:hidden/.test(CSS));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
