/* PAGE REGISTERS (Step 3, Part A of docs/data-reduction/STEP3-PLAN.md) — core/gates.js run on a fake page.
 *   node tests/page-registers-test.js            (GATES_SRC=<file> to test another copy of gates.js; the last part does)
 * What must hold: with the switch OFF the gates make the same nine reads, in the same order, and leave the same values
 * as the gates at git HEAD; with the switch ON a screen asking for the master set reads only the masters and the master
 * database, two screens asking at once share one read, a register that fails stays unloaded while the others land, and
 * each register goes stale on its own clock; no screen outside core/gates.js tests "is it loaded" and then loads, and
 * nothing outside the loader stamps PTG_AT; and a broken copy of the gates makes this suite fail.
 * Part B adds: per-register errors, the runtime guard (undeclared reads), and the full call-graph check (every screen's entries,
 * followed across every file, against its declared set; tests/page-registers-graph.js). */
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), { spawnSync } = require('child_process');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const GATES_FILE = path.join(APP, 'core', 'gates.js');
const SRC = rd(process.env.GATES_SRC || GATES_FILE);

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const tick = () => new Promise(r => setImmediate(r));
const MIN = 60 * 1000;

const DATA = {
  pt_masters: { colour: { a: { name: 'Red' } } }, pt_masterDB: { m1: { sku: 'A' }, m2: { sku: 'B' } }, pt_orderBook: [{ orderNo: 'O1' }],
  pt_pressInventory: [{ id: 'p1' }], pt_cuttingFreezes: { '2026-08': { by: 'x' } }, pt_cuttingData: [{ id: 'c1' }],
  pt_baseData: [{ id: 'b1' }], pt_shopProd: { s1: 1 }, pt_qcChecks: [{ id: 'q1' }],
};
const NODE_OF = { masters: 'pt_masters', mdb: 'pt_masterDB', ob: 'pt_orderBook', press: 'pt_pressInventory', freeze: 'pt_cuttingFreezes', cut: 'pt_cuttingData', base: 'pt_baseData', shopProd: 'pt_shopProd', qc: 'pt_qcChecks' };
const MASTER_NODES = ['pt_masters', 'pt_masterDB'];
const ALL_NODES = Object.values(NODE_OF);
const OTHER_NODES = ALL_NODES.filter(n => !MASTER_NODES.includes(n));
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** A fake page around one copy of gates.js. */
function boot(src, o) {
  o = o || {};
  const LS = new Map(Object.entries(o.ls || {}));
  const localStorage = { getItem: k => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => LS.set(k, String(v)), removeItem: k => { LS.delete(k); } };
  const st = { reads: [], clock: 1.8e12, img: 0, sync: 0, delta: 0, fail: new Set(), hold: false, held: [], warns: [], shown: [], dm: [] };
  const ctx = {
    localStorage, AUDIT: { on: o.audit !== false }, PT: { at: {}, cut: null, base: null }, TAB_NOW: 't',
    Date: { now: () => st.clock },
    ptGet: node => {
      st.reads.push(node);
      if (st.fail.has(node)) return Promise.reject(new Error('refused ' + node));
      const v = DATA[node];
      return st.hold ? new Promise(res => st.held.push(() => res(v))) : Promise.resolve(v);
    },
    ptList: v => (Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? Object.values(v) : []),
    mdbYnFix: r => Object.assign({}, r, { fixed: 1 }), ptStamp: () => 'stamp',
    ptImgShared: async () => { st.img++; }, replMasterSync: () => { st.sync++; }, deltaShadowSoon: () => { st.delta++; },
    /* what the runtime guard talks to: the console, the screen redraw, the data meter's counting hook */
    console: { warn: (...a) => st.warns.push(a.join(' ')) }, showTab: t => { st.shown.push(t); }, dmCount: (...a) => { st.dm.push(a); },
  };
  if (o.vendor) ctx.spIsVendor = () => true;
  vm.createContext(ctx);
  const names = ['PTG', 'PT', 'ptLoadGates', 'ptGatesStale', 'ptGatesFresh', 'ptOpenFresh', 'ptNeed', 'ptHas', 'PTG_ALL', 'PTG_MASTER', 'PTG_REGS', 'PTG_AT', 'PTG_FLY', 'prOn', 'prSaveFlag', 'ptLack', 'ptStillReading', 'ptPeek', 'PTG_ERR', 'PR_UNDECLARED', 'ptNeedRun'];
  vm.runInContext(src + '\n;this.__t = {' + names.map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(', ') + '};', ctx);
  return Object.assign({ t: ctx.__t, st, LS, ctx }, {
    snap: () => JSON.stringify({ PTG: Object.assign({}, ctx.__t.PTG, { loading: undefined }), PT: ctx.__t.PT }),
    take: () => st.reads.splice(0),
  });
}
const ON = { ls: { pageRegisters: '1' } };

/* ---------------------------------------------------------------- (a) switch off = today */
/* The gates as they were before page registers, kept as a fixture so this check outlives the commit. */
function headSource() {
  const fx = path.join(__dirname, 'fixtures', 'gates-before-page-registers.js');
  return fs.existsSync(fx) ? rd(fx) : null;
}
function gitHeadSource() {
  const r = spawnSync('git', ['show', 'HEAD:./src/app/core/gates.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 1 << 24 });
  return r.status === 0 ? r.stdout.replace(/\r\n/g, '\n') : null;
}
async function offRun(src, how) {
  const p = boot(src);
  const call = (force, light) => (how === 'need' ? p.t.ptNeed(p.t.PTG_ALL, { force, light }) : p.t.ptLoadGates(force, light));
  const out = [];
  await call(); out.push(p.snap(), p.take());
  await call(); out.push('second open reads nothing: ' + p.take().length);
  p.st.clock += 11 * MIN; await call(true, true); out.push(p.snap(), p.take());
  p.st.clock += 31 * MIN; await call(true, true); out.push(p.snap(), p.take());
  await call(true); out.push(p.snap(), p.take());
  out.push([p.st.img, p.st.sync, p.st.delta]);
  return JSON.stringify(out);
}
(async () => {
  console.log('Switch OFF: the same reads and values as the gates at git HEAD');
  const head = headSource();
  ok('the before-page-registers copy of core/gates.js (tests/fixtures) is found', !!head, 'tests/fixtures/gates-before-page-registers.js missing');
  if (head) {
    const was = await offRun(head, 'load');
    const nowLoad = await offRun(SRC, 'load');
    const nowNeed = await offRun(SRC, 'need');
    ok('ptLoadGates: nine reads, same order, same PTG/PT, same pictures/sync/delta calls as before page registers', was === nowLoad);
    ok('ptNeed(PTG_ALL) with the switch off: identical to ptLoadGates at HEAD', was === nowNeed);
    const firstReads = JSON.parse(was)[1];
    { const g = gitHeadSource(); if (g && g === head) ok('(extra) the fixture still equals git HEAD', true); }
    ok('(sanity) HEAD itself makes the nine reads', Array.isArray(firstReads) && firstReads.length === 9, JSON.stringify(firstReads));
  }
  {
    const p = boot(SRC);
    ok('off: prOn() is false by default', p.t.prOn() === false);
    ok('off: ptHas is "the order book is there"', p.t.ptHas(p.t.PTG_ALL) === false);
    await p.t.ptNeed(p.t.PTG_ALL, {}); p.take();
    ok('off: ptHas true once loaded', p.t.ptHas(p.t.PTG_ALL) === true);
    p.t.PTG.ob = null;
    ok('off: ptHas follows the order book', p.t.ptHas(p.t.PTG_MASTER) === false);
    p.t.PTG.ob = [{}];
    p.t.PTG.mdb = null;
    ok('off: ptHas is true with the order book set and the master database cleared (Masters Refresh, Dispatch Go)', p.t.ptHas(p.t.PTG_ALL) === true);
    p.t.PTG.mdb = [{}];
    await p.t.ptNeed(p.t.PTG_ALL, { has: 'mdb' });
    ok('off: ptNeed with has: nothing read when the field is there', p.take().length === 0);
    p.t.PTG.press = null;
    await p.t.ptNeed(p.t.PTG_ALL, { has: 'press' });
    ok('off: has "press" missing but the master database there: ptLoadGates itself finds nothing to read (as today)', p.take().length === 0);
    const q = boot(SRC); let noted = 0;
    await q.t.ptNeed(q.t.PTG_ALL, { has: 'mdb', note: () => noted++ }); q.take();
    await q.t.ptNeed(q.t.PTG_ALL, { has: 'mdb', note: () => noted++ });
    ok('off: the "reading…" note is shown only when a read happens', noted === 1, String(noted));
  }

  /* ------------------------------------------------------------ the switch itself */
  console.log('\nSwitch order');
  ok("device '1' → on", boot(SRC, ON).t.prOn() === true);
  ok('flag on → on', boot(SRC, { ls: { prFlagLast: '1' } }).t.prOn() === true);
  ok("device '0' beats the flag", boot(SRC, { ls: { pageRegisters: '0', prFlagLast: '1' } }).t.prOn() === false);
  ok('audit off (a harness) → off', boot(SRC, { ls: { pageRegisters: '1' }, audit: false }).t.prOn() === false);
  ok('vendors → off', boot(SRC, { ls: { pageRegisters: '1' }, vendor: true }).t.prOn() === false);
  { const p = boot(SRC); p.t.prSaveFlag(true); const a = p.LS.get('prFlagLast'); p.t.prSaveFlag(false);
    ok('the flag answer is kept for the next page, and cleared', a === '1' && !p.LS.has('prFlagLast')); }
  { const auth = rd(path.join(APP, 'core', 'auth.js'));
    ok('auth.js saves the flag in its one config/flags read, and clears it in the catch',
      /prSaveFlag\(!!d && \(d\.pageRegisters === true/.test(auth) && /\.catch\(\(\) => \{[^\n]*prSaveFlag\(false\)/.test(auth)); }

  /* ------------------------------------------------------------ (b) switch on */
  console.log('\nSwitch ON: sets, sharing, failures, staleness');
  {
    const p = boot(SRC, ON);
    await p.t.ptNeed(p.t.PTG_MASTER, {});
    const r = p.take();
    ok('the master set reads only the masters and the master database', same(r, MASTER_NODES), JSON.stringify(r));
    ok('…and nothing else is loaded', !p.t.ptPeek('ob') && !p.t.ptPeek('press') && !p.t.ptPeek('cut') && !p.t.ptPeek('base') && !p.t.ptPeek('shopProd'));
    ok('ptHas: master set yes, whole set no', p.t.ptHas(p.t.PTG_MASTER) === true && p.t.ptHas(p.t.PTG_ALL) === false);
    ok('the master database is stored as today (mdbYnFix applied), pictures read once, master synced to Replenishment', p.t.PTG.mdb.length === 2 && p.t.PTG.mdb[0].fixed === 1 && p.st.img === 1 && p.st.sync >= 1);
    ok('PTG.at stays 0 and delta sync stays quiet until all nine are in', p.t.PTG.at === 0 && p.st.delta === 0);
    p.st.clock += 5 * MIN;
    await p.t.ptNeed(p.t.PTG_ALL, {});
    const r2 = p.take();
    ok('then the whole set reads only what is missing (the other seven)', same(r2, OTHER_NODES), JSON.stringify(r2));
    ok('pictures still read once; PTG.at is the oldest register time; delta sync starts once', p.st.img === 1 && p.t.PTG.at === 1.8e12 && p.st.delta === 1, JSON.stringify([p.st.img, p.t.PTG.at, p.st.delta]));
    ok('every register stored where today stores it', p.t.PT.cut.length === 1 && p.t.PT.base.length === 1 && p.t.PTG.freeze['2026-08'] && p.t.PTG.qc.length === 1 && p.t.PTG.shopProd.s1 === 1 && p.t.PTG.ob.length === 1 && p.t.PTG.press.length === 1 && p.t.PTG.masters.colour);
    await p.t.ptNeed(p.t.PTG_ALL, {});
    ok('a second ask for the same set reads nothing', p.take().length === 0);
  }
  { const p = boot(SRC, ON); await p.t.ptNeed(['ob'], {});
    ok('the order book alone does not read the master database or the pictures', same(p.take(), ['pt_orderBook']) && p.st.img === 0); }
  {
    const p = boot(SRC, ON); p.st.hold = true;
    const a = p.t.ptNeed(p.t.PTG_ALL, {}), b = p.t.ptLoadGates(), c = p.t.ptNeed(p.t.PTG_MASTER, {});
    await tick();
    const r = p.take();
    ok('three asks at once share one read per register (nine reads, not more)', r.length === 9 && same(r, ALL_NODES), JSON.stringify(r));
    p.st.hold = false; p.st.held.splice(0).forEach(f => f());
    await Promise.all([a, b, c]);
    ok('…and all three asks are answered with everything in', p.t.ptHas(p.t.PTG_ALL) && p.take().length === 0);
  }
  {
    const p = boot(SRC, ON); p.st.fail.add('pt_orderBook');
    await p.t.ptNeed(p.t.PTG_ALL, {});
    p.take();
    ok('a register that fails stays unloaded while the others land', p.t.ptPeek('ob') == null && p.t.PTG.press.length === 1 && p.t.PTG.mdb.length === 2 && p.t.PT.base.length === 1);
    ok('…the error is kept for the screen, and the set is not "has"', /orderBook/.test(p.t.PTG.err) && p.t.ptHas(p.t.PTG_ALL) === false && p.t.ptHas(p.t.PTG_MASTER) === true);
    ok('…and no delta sync starts on a partial load', p.st.delta === 0);
    p.st.fail.clear();
    await p.t.ptNeed(p.t.PTG_ALL, {});
    ok('the next ask reads just the one that failed', same(p.take(), ['pt_orderBook']) && p.t.ptHas(p.t.PTG_ALL) && p.t.PTG.err === '');
  }
  {
    const p = boot(SRC, ON); p.st.fail.add('pt_qcChecks');
    await p.t.ptNeed(p.t.PTG_ALL, {});
    ok('QC checks keep their own catch: refused → the rest still lands and made falls back (PTG.qc is an empty list)', p.t.ptHas(p.t.PTG_ALL) === true && Array.isArray(p.t.PTG.qc) && p.t.PTG.qc.length === 0 && p.t.PTG.err === '');
  }
  {
    const p = boot(SRC, ON); await p.t.ptNeed(p.t.PTG_ALL, {}); p.take();
    p.st.clock += 11 * MIN;
    await p.t.ptNeed(p.t.PTG_ALL, {});
    ok('after ten minutes a plain ask still reads nothing (it only fills what is missing)', p.take().length === 0);
    ok('…but the set now counts as stale; the master set does not on a light refresh', p.t.ptGatesStale(p.t.PTG_ALL, true) === true && p.t.ptGatesStale(p.t.PTG_MASTER, true) === false && p.t.ptGatesStale(p.t.PTG_MASTER, false) === true);
    await p.t.ptNeed(p.t.PTG_ALL, { force: true, light: true });
    const r = p.take();
    ok('light refresh at 11 minutes: the seven other registers, not the master (kept under half an hour)', same(r, OTHER_NODES), JSON.stringify(r));
    p.st.clock += 31 * MIN;
    await p.t.ptNeed(p.t.PTG_ALL, { force: true, light: true });
    ok('light refresh at 31 minutes: the master and the masters as well', same(p.take(), ALL_NODES));
    await p.t.ptNeed(p.t.PTG_ALL, { force: true });
    ok('a forced refresh (not light) reads all nine at once', same(p.take(), ALL_NODES));
    await p.t.ptNeed(p.t.PTG_MASTER, { force: true });
    ok('a forced refresh of the master set reads just those two', same(p.take(), MASTER_NODES));
    p.t.PTG.masters = null; p.t.PTG.mdb = null;
    ok('Master DB Refresh clears values: the set no longer counts as loaded', p.t.ptHas(p.t.PTG_MASTER) === false);
    await p.t.ptLoadGates();
    ok('…and the next ask reads them again', same(p.take(), MASTER_NODES));
  }
  {
    const p = boot(SRC, ON);
    let drawn = 0; await p.t.ptNeed(p.t.PTG_MASTER, {}); p.take();
    p.t.ptOpenFresh('t', () => { drawn++; });
    ok('ptOpenFresh with no set means the whole set: not all there → just draws, reads nothing itself', drawn === 1 && p.take().length === 0);
    await p.t.ptNeed(p.t.PTG_ALL, {}); p.take();
    p.t.ptOpenFresh('t', () => { drawn++; });
    ok('fresh data: draws at once, reads nothing', drawn === 2 && p.take().length === 0);
    p.st.clock += 11 * MIN;
    p.t.ptOpenFresh('t', () => { drawn++; });
    ok('stale data: draws at once, refreshes behind it, and draws again', drawn === 3);
    await tick(); await tick(); await tick();
    ok('…the refresh read the seven stale registers and the screen was redrawn', drawn === 4 && same(p.take(), OTHER_NODES), JSON.stringify([drawn]));
  }
  {
    const p = boot(SRC, ON); let msgs = 0;
    p.t.ptNeed(p.t.PTG_ALL, { note: () => msgs++ }); p.take();
    ok('note callback runs when a read is needed (on)', msgs === 1);
    ok('save protection: with the switch on and the registers not in, the refusal text is given', /Still reading the order book, try again in a moment/.test(p.t.ptStillReading()));
    await tick();
    ok('…and it is empty once everything is in', p.t.ptStillReading() === '');
    ok('…and always empty with the switch off', boot(SRC).t.ptStillReading() === '');
  }

  /* ------------------------------------------------------------ (c) static scan */
  console.log('\nNo "is it loaded, then load" check and no PTG_AT writer outside core/gates.js');
  const tree = {};
  (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(p, r); else if (e.name.endsWith('.js')) tree[r] = rd(p);
  } })(APP, '');
  const presence = files => {
    const bad = [];
    Object.entries(files).forEach(([f, text]) => {
      if (f === 'core/gates.js') return;
      const L = text.split('\n');
      L.forEach((line, i) => {
        if (/!\s*PTG\.(mdb|ob|press|masters)\b/.test(line) && /ptLoadGates\s*\(|ptNeed\s*\(/.test(L.slice(i, i + 5).join('\n'))) bad.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 80));
        else if (/ptLoadGates\s*\(/.test(line) && /!\s*\(?\s*PTG\.(mdb|ob|press|masters)\b|PTG\.(mdb|ob|press|masters)\s*&&/.test(line)) bad.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 80));
      });
    });
    return bad;
  };
  const atWrite = /PTG_AT\s*(\[[^\]]*\]|\.\w+)\s*=(?!=)|delete\s+PTG_AT|Object\.assign\(\s*PTG_AT|(?<!const\s)\bPTG_AT\s*=(?!=)/g;
  const atWriters = files => {
    const bad = [];
    Object.entries(files).forEach(([f, text]) => {
      if (f === 'core/gates.js') return;
      text.split('\n').forEach((line, i) => { atWrite.lastIndex = 0; if (atWrite.test(line)) bad.push(f + ':' + (i + 1)); });
    });
    return bad;
  };
  const gatesText = process.env.GATES_SRC ? SRC : tree['core/gates.js'];
  const runFn = (() => { const a = gatesText.indexOf('function ptNeedRun('); if (a < 0) return null; const b = gatesText.indexOf('\n}\n', a); return [a, b < 0 ? gatesText.length : b]; })();
  const loaderWrites = (() => { const out = []; let m; atWrite.lastIndex = 0; while ((m = atWrite.exec(gatesText))) out.push(m.index); return out; })();
  const v1 = presence(tree);
  ok('no presence check guarding a load is left outside core/gates.js', v1.length === 0, v1.join(' | '));
  const v2 = atWriters(tree);
  ok('nothing outside core/gates.js writes PTG_AT', v2.length === 0, v2.join(' | '));
  ok('inside core/gates.js, PTG_AT is written in the loader (ptNeedRun) and nowhere else', !!runFn && loaderWrites.length >= 1 && loaderWrites.every(i => i > runFn[0] && i < runFn[1]), JSON.stringify([runFn, loaderWrites]));
  ok('the set names and switch exist', /const PTG_MASTER = \['masters', 'mdb'\]/.test(gatesText) && /const PTG_REGS = \[/.test(gatesText) && /function prOn\(/.test(gatesText));
  ok('the ten-minute and thirty-minute comments are kept word for word', /TEN MINUTES, NOT TWO \(2026-09-27\)/.test(gatesText) && /re-read on a background refresh only every half hour/.test(gatesText));
  /* The scan has teeth of its own. */
  const planted1 = Object.assign({}, tree, { 'zz/planted.js': 'async function x() {\n  if (!PTG.ob) await ptLoadGates();\n}\n' });
  ok('teeth: a presence check left in a screen is caught', presence(planted1).length === 1);
  const planted2 = Object.assign({}, tree, { 'zz/planted.js': 'async function x() {\n  if (!PTG.mdb) {\n    busy();\n    await ptNeed(PTG_ALL);\n  }\n}\n' });
  ok('teeth: a multi-line presence check is caught too', presence(planted2).length === 1);
  ok('teeth: a PTG_AT write in a screen is caught', atWriters(Object.assign({}, tree, { 'zz/planted.js': 'PTG_AT.ob = Date.now();\n' })).length === 1 && atWriters(Object.assign({}, tree, { 'zz/planted.js': "PTG_AT['mdb'] = 1;\n" })).length === 1);

  /* ------------------------------------------------------------ (b2) Part B: per-register errors, the runtime guard */
  console.log('\nPer-register errors (switch on)');
  {
    const p = boot(SRC, ON); p.st.fail.add('pt_orderBook'); p.st.hold = true;
    const a = p.t.ptNeed(['ob'], {}), b = p.t.ptNeed(['press'], {});
    await tick();
    p.st.hold = false; p.st.held.splice(0).forEach(f => f());
    await Promise.all([a, b]);
    ok('a failed order-book read is kept under its own register', /orderBook/.test(p.t.PTG_ERR.ob || '') && !p.t.PTG_ERR.press);
    const c = p.t.ptNeed(['press', 'mdb'], {}); await c;
    ok('another screen\'s later ask (a different register) does not wipe it', /orderBook/.test(p.t.PTG_ERR.ob || ''));
    ok('…and that other screen sees no failure in what it asked for', p.t.PTG.err === '');
    await p.t.ptNeed(['ob'], {});
    ok('a screen asking again for the failed register sees the failure in PTG.err', /orderBook/.test(p.t.PTG.err));
    p.st.fail.clear();
    await p.t.ptNeed(['ob'], {});
    ok('a successful read clears that register\'s error and PTG.err', !p.t.PTG_ERR.ob && p.t.PTG.err === '');
  }
  {
    const p = boot(SRC, ON); p.st.fail.add('pt_masterDB');
    await p.t.ptNeed(p.t.PTG_ALL, {});
    ok('PTG.err for a whole-set ask names the failed register of that set', /masterDB/.test(p.t.PTG.err));
    const q = boot(SRC); q.st.fail.add('pt_masterDB'); await q.t.ptNeed(q.t.PTG_ALL, {});
    ok('switch off: PTG.err is set as before (no per-register table is used)', /masterDB/.test(q.t.PTG.err) && Object.keys(q.t.PTG_ERR).length === 0);
  }

  console.log('\nRuntime guard (switch on): an undeclared read');
  {
    const p = boot(SRC, ON);
    await p.t.ptNeed(p.t.PTG_MASTER, {}); p.take();
    ok('on: the fields are guarded (getters)', typeof Object.getOwnPropertyDescriptor(p.t.PTG, 'ob').get === 'function');
    { const q = boot(SRC, ON); await q.t.ptNeed(q.t.PTG_ALL, {}); q.take(); q.t.PTG.ob = null; q.t.PTG.mdb = null; q.t.PTG.masters = null;
      ok('presence checks on a register a screen cleared (Master DB Refresh) never fire it', (q.t.ptHas(q.t.PTG_ALL), q.t.ptLack(q.t.PTG_MASTER, 'mdb'), q.t.ptGatesStale(q.t.PTG_ALL), q.t.ptStillReading(), q.st.warns.length === 0 && q.take().length === 0)); }
    ok('presence checks never fire it: ptHas, ptLack, ptPeek, ptStillReading, ptGatesStale', (() => {
      p.t.ptHas(p.t.PTG_ALL); p.t.ptLack(p.t.PTG_ALL, 'mdb'); p.t.ptPeek('ob'); p.t.ptPeek('cut'); p.t.ptStillReading(); p.t.ptGatesStale(p.t.PTG_ALL, true);
      return p.st.warns.length === 0 && p.take().length === 0; })());
    const seen = p.t.PTG.ob;
    ok('reading an unloaded register returns what it held (nothing) and says so once, in plain words', seen == null && p.st.warns.length === 1 && /"t" screen read the order book before it was loaded/.test(p.st.warns[0]), p.st.warns[0]);
    ok('…the tally the data meter reads has one line for the page and register', p.t.PR_UNDECLARED['t|ob'] === 1 && p.st.dm.length === 1 && p.st.dm[0][0] === 'undeclared_ob' && p.st.dm[0][2] === 'undeclared');
    void p.t.PTG.ob; void p.t.PTG.ob;
    ok('…reading it again while it loads is counted but not logged or counted by the meter again, and starts no second read', p.st.warns.length === 1 && p.t.PR_UNDECLARED['t|ob'] === 3 && p.st.dm.length === 1 && same(p.take(), OTHER_NODES));
    await tick(); await tick();
    ok('…it is read in the background, lands, and the screen is drawn again once', p.t.ptHas(['ob']) && p.t.PTG.ob.length === 1 && p.st.shown.length === 1 && p.st.shown[0] === 't');
    ok('…and a loaded register no longer fires', p.st.warns.length === 1);
    p.t.PTG.press = null; void p.t.PTG.press;
    ok('another register on the same page is a second line', p.st.warns.length === 2 && p.t.PR_UNDECLARED['t|press'] === 1);
    await tick(); await tick();
  }
  {
    const p = boot(SRC, ON); await p.t.ptNeed(p.t.PTG_MASTER, {}); p.take(); p.st.hold = true;
    void p.t.PTG.ob; await tick();
    p.st.held.shift()(); await tick(); await tick();
    ok('the screen is not redrawn while only the order book has landed', p.st.shown.length === 0 && !p.t.ptHas(p.t.PTG_ALL));
    p.st.hold = false; p.st.held.splice(0).forEach(f => f()); await tick(); await tick();
    ok('…it is redrawn once all seven have', p.st.shown.length === 1 && p.t.ptHas(p.t.PTG_ALL));
  }
  {
    const p = boot(SRC, ON); await p.t.ptNeed(p.t.PTG_MASTER, {}); p.take();
    void p.t.PTG.ob; p.ctx.TAB_NOW = 'elsewhere';
    await tick(); await tick();
    ok('if the person has moved to another screen before it lands, nothing is redrawn', p.t.ptHas(['ob']) && p.st.shown.length === 0);
    p.t.PTG.press = null; void p.t.PTG.ob; void p.t.PTG.press;
    ok('a different page logs its own line for a register', p.st.warns.length === 2 && p.t.PR_UNDECLARED['elsewhere|press'] === 1 && p.t.PR_UNDECLARED['elsewhere|ob'] === undefined);
  }
  {
    const p = boot(SRC, ON);
    p.t.PTG.ob = [{ orderNo: 'X' }];
    ok('the setter stores exactly what it is given', p.t.PTG.ob.length === 1 && p.t.PTG.ob[0].orderNo === 'X' && p.st.warns.length === 0);
    ok('…and does NOT mark the register loaded (only the loader stamps PTG_AT)', p.t.ptHas(['ob']) === false && p.t.PTG_AT.ob === undefined);
    p.t.PTG.ob = null;
    ok('…a screen can clear a register (Master DB Refresh) and it reads as unloaded', p.t.ptPeek('ob') === null);
  }
  {
    const p = boot(SRC, ON); p.st.fail.add('pt_qcChecks');
    await p.t.ptNeed(['qc'], {});
    ok('the loader\'s own reads do not fire it (QC keeps its own catch and falls back to an empty list)', p.st.warns.length === 0 && Array.isArray(p.t.ptPeek('qc')));
    const q = boot(SRC, ON); await q.t.ptNeed(['masters'], {});
    ok('landing the masters alone does not read the master database to sync Replenishment', q.st.warns.length === 0 && q.st.sync === 0);
    await q.t.ptNeed(['mdb'], {});
    ok('…it syncs once both halves are in', q.st.sync >= 1 && q.st.warns.length === 0);
  }
  {
    const p = boot(SRC);
    const d = Object.getOwnPropertyDescriptor(p.t.PTG, 'ob');
    ok('off: the fields are the plain fields they always were (no getters installed)', d && 'value' in d && !d.get);
    void p.t.PTG.ob; void p.t.PTG.mdb;
    ok('off: reading an unloaded register logs nothing and reads nothing', p.st.warns.length === 0 && p.take().length === 0 && p.st.dm.length === 0);
    const v = boot(SRC, { ls: { pageRegisters: '1' }, vendor: true });
    ok('vendors: off, nothing installed', !Object.getOwnPropertyDescriptor(v.t.PTG, 'ob').get);
    const w = boot(SRC, ON); w.ctx.spIsVendor = () => true; void w.t.PTG.ob;
    ok('a page that turned out to be a vendor after the guard was installed: no log, no read', w.st.warns.length === 0 && w.take().length === 0);
  }

  console.log('\nPart B groups: the Master set on a fresh page');
  {
    const p = boot(SRC, ON);
    /* what ensurePmdb / ensureAcc / vmOpen / voSync do on a fresh page */
    if (p.t.ptLack(p.t.PTG_MASTER, 'mdb')) await p.t.ptNeed(p.t.PTG_MASTER, { why: 'pmdb', has: 'mdb' });
    ok('Master DB opens on a fresh page: only pt_masters and pt_masterDB are read', same(p.take(), MASTER_NODES));
    ok('…and a second screen of the group (Accessories, vendor master) reads nothing more', (await p.t.ptNeed(p.t.PTG_MASTER, { why: 'accessories', has: 'masters' }), p.take().length === 0));
    await p.t.ptNeed(p.t.PTG_MASTER, { force: true });
    ok('the Refresh button (acGo) force-reads the master set again, and only that', same(p.take(), MASTER_NODES));
    ok('…and the page stayed free of undeclared reads', p.st.warns.length === 0);
    const q = boot(SRC);
    await q.t.ptNeed(q.t.PTG_MASTER, { force: true });
    ok('switch off: the same button is ptLoadGates(true) — all nine reads, as today', q.take().length === 9);
  }

  /* ------------------------------------------------------------ (c2) every screen's whole reach, against its declared set */
  if (!process.env.GATES_SRC) {
    console.log('\nScreen check: what each screen can reach, following calls across every file');
    const G = require('./page-registers-graph.js');
    const g = G.build(tree);
    const MASTER = ['masters', 'mdb'];
    /* group B screens (narrowed to the master set) and a few whole-set screens as controls */
    const PR_SCREENS = [
      { name: 'Master Database (all its views, buttons, exports and saves)', set: MASTER,
        entries: ['ensurePmdb', 'renderPmdb', 'pmdbRefresh', /\$\('ptm\w+'\)/, { file: 'masters/master-database.js' }, { file: 'masters/sku-codes.js' }, 'renderSkuCode'], asks: ['ensurePmdb', 'renderSkuCode'] },
      { name: 'Accessories', set: MASTER, entries: ['ensureAcc', { file: 'inventory/accessories.js' }, /\$\('ac\w+'\)/], asks: ['ensureAcc'] },
      { name: 'Vendor master', set: MASTER, entries: ['vmOpen', { file: 'vendors/portal/vendor-master.js' }], asks: ['vmOpen'] },
      { name: 'Vendor sync (admin)', set: MASTER, entries: [/\$\('voSync'\)/, 'voSyncAccess'], asks: [] },
      /* Part C (vendors) and Part D (desks and lists). Each reaches nothing but the master set, plus the one register it loads itself (HR: Job Work). */
      { name: 'Vendor order requests (list, answer, approve, copy)', set: MASTER, entries: ['ensureVrq', 'renderVrq', { file: 'vendors/orders/vendor-order-requests.js' }], asks: ['ensureVrq'] },
      { name: 'RFD (order-driven)', set: MASTER, entries: ['ensureRfd', { file: 'vendors/rfd/order-driven-rfd.js' }], asks: ['ensureRfd'] },
      { name: 'RFD stock dialog', set: MASTER, entries: ['fabAutoLoad', { file: 'vendors/rfd/rfd-stock-auto.js' }], asks: ['fabAutoLoad'] },
      { name: 'Vendor log (list and its buttons; accepting waits for the whole set)', set: MASTER, entries: ['ensureVlog', 'renderVlog', 'vlNoOne', 'vlAcceptPicked', /\$\('vl\w+'\)/], asks: ['ensureVlog'] },
      { name: 'Greige Desk', set: MASTER, entries: [{ file: 'flow/greige-desk.js' }], asks: ['gdLoad'] },
      { name: 'HR / pay (+ its own Job Work read)', set: MASTER.concat(['base']), entries: ['ensureHr', { file: 'people-pay/finance-hr.js' }], asks: ['ensureHr'] },
      { name: 'Shopify stock', set: MASTER, entries: ['ensureShopify', { file: 'replenishment/shopify-stock.js' }], asks: ['ensureShopify'] },
      { name: 'Customer orders', set: MASTER, entries: ['ensureCx', { file: 'orders/customer-orders.js' }], asks: ['ensureCx'] },
      { name: 'control: Order Console', set: G.ALL, entries: ['ensureOrd'], mustReach: ['ob', 'base', 'cut', 'press', 'qc', 'shopProd', 'mdb'] },
      { name: 'control: Press', set: G.ALL, entries: ['ensurePpress'], mustReach: ['press'] },
      { name: 'control: Quality Control', set: G.ALL, entries: ['ensureQc'], mustReach: ['base', 'cut'] },
    ];
    const check = (scr, graph) => {
      const r = G.reach(graph || g, scr.entries);
      const extra = [...r.regs].filter(x => scr.set.indexOf(x) < 0);
      return { r, extra, why: extra.map(x => x + ' <= ' + (r.via.get(x) || []).join(' > ')).join(' | ') };
    };
    PR_SCREENS.forEach(scr => {
      const c = check(scr);
      ok('screen "' + scr.name + '" finds its entry points', c.r.start.length >= 1);
      ok('screen "' + scr.name + '" reaches only ' + scr.set.join(' + '), c.extra.length === 0, c.why);
      if (scr.mustReach) ok('screen "' + scr.name + '" (control) really reaches ' + scr.mustReach.join(', '), scr.mustReach.every(x => c.r.regs.has(x)), [...c.r.regs].join(','));
      (scr.asks || []).forEach(fn => {
        const piece = (g.byName.get(fn) || [])[0];
        ok('"' + fn + '" asks for the master set, not the whole set', !!piece && /ptNeed\(\s*PTG_MASTER\b/.test(piece.text) && !/ptNeed\(\s*PTG_ALL\b|ptLoadGates\(/.test(piece.text), piece && piece.file);
      });
    });
    /* The narrowed screens' saves that need order data wait for the whole set first. */
    ['mdbEdit', 'custFixOpen'].forEach(fn => { const pc = (g.byName.get(fn) || [])[0]; ok('"' + fn + '" waits for the whole set before it uses order data', !!pc && pc.gate === true, pc && pc.file); });
    { const pc = G.reach(g, [/\$\('ptmRename'\)/]); ok('Change SKU (rename) waits for the whole set', pc.start.length === 1 && pc.start[0].gate === true && pc.regs.size === 0); }
    { const pc = (g.byName.get('skuFillOpen') || [])[0]; ok('"skuFillOpen" (look-alike fill) waits for the whole set', !!pc && pc.gate === true); }
    { const pc = (g.byName.get('flowVoExtra') || [])[0]; ok('"flowVoExtra" (test print orders) reads the whole set first when they are on', !!pc && pc.gate === true); }
    /* Part C / D: the saves and sub-views that need order data wait for the whole set first (with the switch on), and the real ask each
     * narrowed screen makes, run on a fresh page, reads only the two master nodes. */
    ['vrqApprove', 'vrqCopy', 'vlAcceptWrite', 'vlAcceptOne', 'shOpenSo', 'gdPpcMap', 'gdFlowReady', 'ensureFab'].forEach(fn => {
      const pc = (g.byName.get(fn) || [])[0];
      ok('"' + fn + '" waits for the whole set before it uses order data', !!pc && pc.gate === true && /ptNeed\(\s*PTG_ALL|ptHas\(\s*PTG_ALL/.test(pc.text), pc && pc.file);
    });
    ['vrqApprove', 'vrqCopy', 'vlAcceptWrite'].forEach(fn => { const pc = (g.byName.get(fn) || [])[0]; ok('"' + fn + '" only waits when the switch is on (switch off: today\'s code path)', !!pc && /prOn\(\)/.test(pc.text)); });
    /* what the narrowed screens ask for, taken from their own code and run on a fresh page */
    for (const fn of ['ensureVrq', 'ensureRfd', 'fabAutoLoad', 'ensureVlog', 'gdLoad', 'ensureHr', 'ensureShopify', 'ensureCx']) {
      const pc = (g.byName.get(fn) || [])[0];
      const m = pc && /ptNeed\(\s*(PTG_MASTER|PTG_ALL)/.exec(pc.text);
      const p = boot(SRC, ON);
      if (m) await p.t.ptNeed(p.t[m[1]], { why: fn });
      ok('"' + fn + '" on a fresh page reads only pt_masters and pt_masterDB', !!m && m[1] === 'PTG_MASTER' && same(p.take(), MASTER_NODES), m && m[1]);
    }
    { const p = boot(SRC, ON); await p.t.ptNeed(p.t.PTG_MASTER, {}); p.take(); await p.t.ptNeed(p.t.PTG_ALL, { why: 'a save' });
      ok('a save that waits for the whole set on a master-only page reads the other seven nodes, and nothing is read twice', same(p.take(), OTHER_NODES) && p.t.ptHas(p.t.PTG_ALL)); }
    { const pc = (g.byName.get('ensureFab') || [])[0]; ok('the Fabric tab (it holds the Store) asks for the whole set itself, since the RFD stock dialog no longer does', !!pc && /ptNeed\(\s*PTG_ALL/.test(pc.text)); }
    /* The kept-whole screens stay whole: In production (its rows come from the order book) and Fabric flow / Reserve (the Store and the demand map read it). */
    ['loadInProd'].forEach(fn => { const pc = (g.byName.get(fn) || [])[0]; ok('"' + fn + '" still asks for the whole set', !!pc && /ptNeed\(\s*PTG_ALL/.test(pc.text)); });
    for (const [name, entries] of [['Fabric flow', [{ file: 'vendors/greige/fabric-flow.js' }]], ['In production', ['loadInProd']], ['Reserve', [{ file: 'orders/reserve.js' }]]]) {
      const r = G.reach(g, entries); ok('control: "' + name + '" really reaches order registers, so it keeps the whole set', ['ob', 'cut', 'base', 'press'].some(x => r.regs.has(x)), [...r.regs].join(','));
    }
    /* Teeth: take a guard away from the real code and the check must fail. */
    const without = (file, needle) => { const t2 = Object.assign({}, tree); if (t2[file].indexOf(needle) < 0) return null; t2[file] = t2[file].replace(needle, ''); return G.build(t2); };
    {
      const vrq = PR_SCREENS.find(x => x.name.indexOf('Vendor order requests') === 0), vlog = PR_SCREENS.find(x => x.name.indexOf('Vendor log') === 0), gd = PR_SCREENS.find(x => x.name === 'Greige Desk');
      const g1 = without('vendors/orders/vendor-order-requests.js', "if (prOn()) await ptNeed(PTG_ALL, { why: 'vendor-order-requests copy' });");
      ok('teeth: take the whole-set wait out of "Copy and send again" and the Vendor requests screen fails', !!g1 && check(vrq, g1).extra.indexOf('ob') >= 0);
      const g2 = without('vendors/orders/accept-delivery.js', "if (prOn()) { await ptNeed(PTG_ALL, { why: 'accept delivery' }); const wait = ptStillReading(); if (wait) return wait; }");
      ok('teeth: take the whole-set wait out of the accept-delivery save and the Vendor log screen fails', !!g2 && check(vlog, g2).extra.indexOf('ob') >= 0);
      const g3 = without('flow/greige-desk.js', "(typeof prOn === 'function' && prOn() && !ptHas(PTG_ALL))");
      ok('teeth: take the whole-set wait out of the Greige Desk\'s PPC column and the Greige Desk fails', !!g3 && check(gd, g3).extra.indexOf('ob') >= 0);
    }
    /* The check has teeth of its own. */
    const planted = (text, extraNames) => G.build(tree, [{ file: 'zz/planted.js', text }]);
    {
      const fake = { name: 'fake master screen', set: MASTER, entries: ['fakeMasterScreen'] };
      const g1 = planted('async function fakeMasterScreen() {\n  await ptNeed(PTG_MASTER, {});\n  return (PT.base || []).length;\n}\n');
      ok('teeth: a Master screen that reads Job Work (PT.base) fails', check(fake, g1).extra.join() === 'base', check(fake, g1).why);
      const g2 = planted('async function fakeMasterScreen() {\n  await ptNeed(PTG_MASTER, {});\n  return fakeHelper();\n}\nfunction fakeHelper() {\n  return fakeDeeper();\n}\nfunction fakeDeeper() {\n  return (PTG.ob || []).length;\n}\n');
      ok('teeth: a read two calls down (through a helper) is followed and fails', check(fake, g2).extra.join() === 'ob');
      const g3 = planted('const fakeMasterScreen = async () => {\n  await ptNeed(PTG_MASTER, {});\n  return ordLines();\n};\n');
      ok('teeth: the Order Console line builder counts as the whole set', check(fake, g3).extra.length >= 6);
      const g4 = planted('async function fakeMasterScreen() {\n  $(\'x\').onclick = () => fakeSave();\n}\nasync function fakeSave() {\n  await ptNeed(PTG_ALL, {});\n  return (PTG.ob || []).length;\n}\n');
      ok('teeth: a save that waits for the whole set before it reads is not charged to the screen', check(fake, g4).extra.length === 0);
      const g5 = planted('async function fakeMasterScreen() {\n  await ptNeed(PTG_MASTER, {});\n  return fakeSave();\n}\nasync function fakeSave() {\n  const n = (PTG.ob || []).length;\n  await ptNeed(PTG_ALL, {});\n  return n;\n}\n');
      ok('teeth: a save that reads BEFORE it waits is charged', check(fake, g5).extra.join() === 'ob');
      const g6 = planted('async function fakeMasterScreen() {\n  await ptNeed(PTG_MASTER, {});\n  const ob = typeof ptPeek === \'function\' ? ptPeek(\'ob\') : PTG.ob;\n  return (ob || []).length;\n}\n');
      ok('teeth: an "if it is there, use it" read through ptPeek is not a read of the screen', check(fake, g6).extra.length === 0);
      const g7 = planted('async function fakeMasterScreen() {\n  const x = `${(PT.cut || []).length}`;\n  return x;\n}\n');
      ok('teeth: a register named inside a template ${ } is seen', check(fake, g7).extra.join() === 'cut');
      const g8 = planted('async function fakeMasterScreen() {\n  const m = "PTG.ob is only text here"; // PTG.press in a comment\n  return m;\n}\n');
      ok('teeth: a register named in a string or a comment is not a read', check(fake, g8).extra.length === 0);
    }
    {
      const ctl = PR_SCREENS.find(x => x.name === 'control: Order Console');
      const without = Object.assign({}, ctl, { set: ctl.set.filter(x => x !== 'ob') });
      ok('teeth: take "ob" out of the Order Console\'s declared set and the check fails', check(without).extra.indexOf('ob') >= 0);
      const m = PR_SCREENS[0];
      ok('teeth: take "mdb" out of the Master Database\'s declared set and the check fails', check(Object.assign({}, m, { set: ['masters'] })).extra.indexOf('mdb') >= 0);
    }
  }

  /* ------------------------------------------------------------ (c2) the real page's load order */
  /* The real page is ONE script. gates.js runs at load, before vendor-portal.js declares `let VP`, and spIsVendor (orders/order-console.js)
   * reads VP: asking prOn() at load threw, was swallowed as "off", and the runtime guard was never installed on the live page. */
  {
    console.log('\nThe guard installs on the real page (load order: spIsVendor first, VP declared after gates.js)');
    const run = ls => {
      const warns = [];
      const ctx = { localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem() {}, removeItem() {} }, AUDIT: { on: true }, ME: { email: 'a@b', admin: false },
        console: { warn: (...a) => warns.push(a.join(' ')) }, dmCount() {}, showTab() {}, ptGet: () => new Promise(() => {}), ptList: v => v || [] };
      vm.createContext(ctx);
      vm.runInContext('const spIsVendor = () => !!(!ME.admin && VP && VP.code);\n' + SRC + '\nlet VP = { code: null };\n;this.__g = { guarded: PR_GUARDED, on: prOn(), PTG, setVendor: () => { VP.code = "V1"; } };', ctx);
      return { g: ctx.__g, ctx, warns, PTG: ctx.__g.PTG };
    };
    const a = run({ pageRegisters: '1' });
    ok('switch on at load: the guard is installed even though VP is not declared yet', a.g.guarded === true);
    ok('...and the switch reads on once the page is up', a.g.on === true);
    ok('switch off at load: not installed', run({}).g.guarded === false);
    ok("device '0' beats the flag at load", run({ pageRegisters: '0', prFlagLast: '1' }).g.guarded === false);
    ok('the flag answer alone installs it', run({ prFlagLast: '1' }).g.guarded === true);
    const v = run({ pageRegisters: '1' }); v.g.setVendor(); void v.PTG.ob;
    ok('a vendor (known only after load) gets plain fields: no warning, no read started', v.warns.length === 0);
    const u = run({ pageRegisters: '1' }); void u.PTG.ob;
    ok('an office login reading an unloaded register is warned (the guard works)', u.warns.length === 1);
  }

  /* ------------------------------------------------------------ (d) teeth */
  if (!process.env.GATES_SRC) {
    console.log('\nTeeth: a broken copy of core/gates.js must fail this suite');
    const real = rd(GATES_FILE);
    const BROKEN = [
      ['the switch-off path skips the freeze read', real.replace(`ptGet('pt_pressInventory'), ptGet('pt_cuttingFreezes'),`, `ptGet('pt_pressInventory'), Promise.resolve(null),`)],
      ['the switch-off path reads the order book under the wrong name', real.replace(`ptGet('pt_orderBook'),\n      ptGet('pt_pressInventory')`, `ptGet('pt_pressInventory'),\n      ptGet('pt_pressInventory')`)],
      ['ptHas ignores the order book', real.replace('return (set || PTG_ALL).every(ptRegLoaded);', "return (set || PTG_ALL).filter(r => r !== 'ob').every(ptRegLoaded);")],
      ['the master set loads the whole set', real.replace('const due = set.filter(', 'const due = PTG_ALL.filter(')],
      ['two asks for one register read it twice', real.replace('if (PTG_FLY[r]) return PTG_FLY[r];', '')],
      ['a failed register stops the others', real.replace('e => { PTG_ERR[r] = e.message || String(e); }', 'e => { throw e; }')],
      ['a light refresh ignores the master clock', real.replace("(light && (r === 'masters' || r === 'mdb') ? PTG_MDB_STALE_MS : PTG_STALE_MS)", 'PTG_STALE_MS')],
      ['delta sync starts on a partial load', real.replace('if (!PTG.err && PTG.at && typeof deltaShadowSoon', "if (typeof deltaShadowSoon")],
      ['one ask wipes every register error', real.replace('    delete PTG_ERR[r];\n    const p', '    Object.keys(PTG_ERR).forEach(k => delete PTG_ERR[k]);\n    const p')],
      ['PTG.err is not set from the registers the screen asked for', real.replace("PTG.err = set.map(r => PTG_ERR[r]).find(Boolean) || '';", "PTG.err = '';")],
      ['the guard setter marks the register loaded', real.replace('set(v) { PR_VAL[reg] = v; } });', 'set(v) { PR_VAL[reg] = v; PTG_AT[reg] = Date.now(); } });')],
      ['ptHas / ptLack trip the guard', real.replace('const ptRegVal = r => ptPeek(r);', "const ptRegVal = r => (r === 'cut' ? PT.cut : r === 'base' ? PT.base : PTG[r]);")],
      ['the guard logs every read instead of one per page and register', real.replace('if (PR_UNDECLARED[key] > 1) return;', '')],
      ['the guard is installed with the switch off', real.replace("if (prWanted() && typeof AUDIT !== 'undefined' && AUDIT.on) prGuardInstall();", 'prGuardInstall();')],
      ['the guard is decided by asking who is signed in at load (VP not declared yet)', real.replace("if (prWanted() && typeof AUDIT !== 'undefined' && AUDIT.on) prGuardInstall();", 'if (prOn()) prGuardInstall();')],
      ['the guard never starts the background read', real.replace("ptNeed(want, { why: 'undeclared ' + page })", "Promise.resolve()")],
      ['the guard loads one order register alone', real.replace('const want = PTG_MASTER.indexOf(reg) >= 0 ? PTG_MASTER : PTG_ALL;', 'const want = [reg];')],
      ['the pictures are read with every register', real.replace("case 'ob': PTG.ob = ptList(await ptGet('pt_orderBook'));", "case 'ob': PTG.ob = ptList(await ptGet('pt_orderBook')); try { await ptImgShared(); } catch (e) { /* x */ }")],
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prg-'));
    BROKEN.forEach(([name, src], k) => {
      if (src === real) { ok('teeth: ' + name + ' (mutation applied)', false, 'the text to break was not found'); return; }
      const f = path.join(dir, 'b' + k + '.js'); fs.writeFileSync(f, src);
      const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { GATES_SRC: f }), encoding: 'utf8' });
      ok('teeth: ' + name, r.status !== 0);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL the suite itself threw — ' + (e && e.stack || e)); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
