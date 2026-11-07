/* PAGE REGISTERS (Step 3, Part A of docs/data-reduction/STEP3-PLAN.md) — core/gates.js run on a fake page.
 *   node tests/page-registers-test.js            (GATES_SRC=<file> to test another copy of gates.js; the last part does)
 * What must hold: with the switch OFF the gates make the same nine reads, in the same order, and leave the same values
 * as the gates at git HEAD; with the switch ON a screen asking for the master set reads only the masters and the master
 * database, two screens asking at once share one read, a register that fails stays unloaded while the others land, and
 * each register goes stale on its own clock; no screen outside core/gates.js tests "is it loaded" and then loads, and
 * nothing outside the loader stamps PTG_AT; and a broken copy of the gates makes this suite fail.
 * Part B adds the full call-graph check (every screen's entry against its declared set). */
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
  const st = { reads: [], clock: 1.8e12, img: 0, sync: 0, delta: 0, fail: new Set(), hold: false, held: [] };
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
  };
  if (o.vendor) ctx.spIsVendor = () => true;
  vm.createContext(ctx);
  const names = ['PTG', 'PT', 'ptLoadGates', 'ptGatesStale', 'ptGatesFresh', 'ptOpenFresh', 'ptNeed', 'ptHas', 'PTG_ALL', 'PTG_MASTER', 'PTG_REGS', 'PTG_AT', 'PTG_FLY', 'prOn', 'prSaveFlag', 'ptLack', 'ptStillReading'];
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
    ok('…and nothing else is loaded', !p.t.PTG.ob && !p.t.PTG.press && !p.t.PT.cut && !p.t.PT.base && !p.t.PTG.shopProd);
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
    ok('a register that fails stays unloaded while the others land', p.t.PTG.ob == null && p.t.PTG.press.length === 1 && p.t.PTG.mdb.length === 2 && p.t.PT.base.length === 1);
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
      ['a failed register stops the others', real.replace('e => { PTG.err = e.message || String(e); }', 'e => { throw e; }')],
      ['a light refresh ignores the master clock', real.replace("(light && (r === 'masters' || r === 'mdb') ? PTG_MDB_STALE_MS : PTG_STALE_MS)", 'PTG_STALE_MS')],
      ['delta sync starts on a partial load', real.replace('if (!PTG.err && PTG.at && typeof deltaShadowSoon', "if (typeof deltaShadowSoon")],
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
