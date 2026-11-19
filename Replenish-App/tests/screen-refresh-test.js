/* SCREEN REFRESH (18 Nov 2026) — the Refresh buttons of Order Console, QC, Job Work and Finished Goods, and the
 * staff-list read that could leave a screen on "Loading…" for good. Staff pressed F5 15-20 times a day on these
 * screens; every F5 downloads the whole page again (30-40 MB). The functions are cut out of src/ and run with a fake
 * database, so the test checks the real code, not a copy of it.
 *   node tests/screen-refresh-test.js
 * Teeth: each fix undone in a copy of the code must make the suite fail. */
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..', 'src', 'app');
const rd = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
const FILES = {
  dbr: 'core/database-read.js', jwe: 'production/job-work-entry.js', qc: 'production/quality-control.js',
  oc: 'orders/order-console.js', be: 'shopify/bulk-entry.js', fc: 'vendors/printing/fabric-catalogue.js', fg: 'inventory/finished-goods.js',
};
const ORIGINAL = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, rd(f)]));
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

const cut = (src, name) => {
  let i = src.indexOf('async function ' + name + '(');
  if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' not found');
  return src.slice(i, src.indexOf('\n}', i) + 2);
};
const tick = () => new Promise(r => setImmediate(r));

/** Runs every check against the given sources; returns the failures (and prints them when loud). */
async function suite(S, loud) {
  const fails = [];
  let pass = 0;
  const ok = (name, cond, why) => { if (cond) { pass++; if (loud) console.log('  PASS ' + name); } else { fails.push(name); if (loud) console.log('  FAIL ' + name + (why ? ' — ' + why : '')); } };
  const fn = (names, ctx, src) => {
    const code = names.map(n => cut(src, n)).join('\n') + '\nreturn {' + names.join(',') + '};';
    return new Function(...Object.keys(ctx), code)(...Object.values(ctx));
  };
  const quiet = { warn: () => {}, log: () => {} };

  /* ---- the button ---- */
  {
    const btn = { id: 'qcGo', textContent: 'Refresh', disabled: false };
    const warns = [];
    const { ptRefreshButton } = fn(['ptRefreshButton'], { console: { warn: (...a) => warns.push(a) } }, S.dbr);
    let during = null;
    await ptRefreshButton(btn, async () => { during = { t: btn.textContent, d: btn.disabled }; });
    ok('the button says "Refreshing…" and is off while it works', during && during.t === 'Refreshing…' && during.d === true);
    ok('…and comes back as it was', btn.textContent === 'Refresh' && btn.disabled === false);
    await ptRefreshButton(btn, async () => { throw new Error('read failed'); });
    ok('a failure brings the button back too (never stuck)', btn.textContent === 'Refresh' && btn.disabled === false);
    ok('…and the failure goes to the console with the button named', warns.length === 1 && String(warns[0][0]).includes('qcGo'));
  }

  /* ---- the staff list ---- */
  {
    const warns = [];
    const { ptLoadEmpOrSkip } = fn(['ptLoadEmpOrSkip'], { ptLoadEmp: async () => { throw new Error('pt_empList refused'); }, console: { warn: (...a) => warns.push(a) } }, S.jwe);
    let threw = false;
    try { await ptLoadEmpOrSkip('ord'); } catch (e) { threw = true; }
    ok('a failed staff list does not stop the screen', !threw && warns.length === 1 && String(warns[0][0]).includes('ord'));
  }

  /* ---- QC ---- */
  const qcWorld = (o = {}) => {
    const W = { reads: [], renders: 0, regs: [], order: [] };
    W.QC = Object.assign({ checks: null, issue: null, ret: null, err: '', busy: false, at: '' }, o.QC);
    W.PTE = { emp: o.emp === undefined ? [['x', 'Asha']] : o.emp };
    W.ctx = {
      QC: W.QC, PTE: W.PTE, PTG_ALL: {}, ptLack: () => false, ptNeed: async () => {},
      ptLoadEmp: async () => { if (o.empFails) throw new Error('refused'); W.PTE.emp = [['x', 'Asha']]; },
      ptLoadEmpOrSkip: async () => { try { await W.ctx.ptLoadEmp(); } catch (e) { /* skipped */ } },
      ptGet: async n => { W.reads.push(n); W.order.push('get ' + n); return { a: { id: n } }; },
      ptList: v => Object.values(v || {}), ptStamp: () => 'now',
      renderQc: () => { W.renders++; }, renderQcCheckForm: () => {}, renderQcIssueForm: () => {},
      ptReadReg: async r => { W.order.push('reg ' + r); if (o.regFails) throw new Error('base refused'); W.regs.push(r); },
      ptRefreshButton: async (b, work) => work(), $: () => ({}), console: quiet,
    };
    return W;
  };
  {
    let W = qcWorld({ QC: { checks: [{ id: 1 }], issue: [{ id: 2 }], ret: null } });
    await fn(['ensureQc'], W.ctx, S.qc).ensureQc();
    ok('QC: checks filled by another screen but returns missing — all three lists are read', ['pt_qcChecks', 'pt_qcIssuance', 'pt_qcReturns'].every(n => W.reads.includes(n)) && Array.isArray(W.QC.ret));
    W = qcWorld({ QC: { checks: [{ id: 1 }], issue: null, ret: [] } });
    await fn(['ensureQc'], W.ctx, S.qc).ensureQc();
    ok('QC: issued-for-alteration missing — read too', W.reads.includes('pt_qcIssuance') && W.QC.issue.length === 1);
    W = qcWorld({ QC: { checks: [], issue: [], ret: [] } });
    await fn(['ensureQc'], W.ctx, S.qc).ensureQc();
    ok('QC: everything already there — nothing read, just drawn', W.reads.length === 0 && W.renders === 1);
    W = qcWorld({ emp: null, empFails: true });
    await fn(['ensureQc'], W.ctx, S.qc).ensureQc();
    ok('QC: staff list fails — the lists still load and "Loading…" ends', W.QC.busy === false && W.QC.checks.length === 1 && W.renders >= 2);
    W = qcWorld({ QC: { checks: [], issue: [], ret: [] } });
    await fn(['qcRefresh', 'ensureQc'], W.ctx, S.qc).qcRefresh();
    ok('QC Refresh: Job Work is read again (Waiting for QC is built from it)', W.regs.includes('base'));
    ok('…before the lists are drawn', W.order.indexOf('reg base') >= 0 && W.order.indexOf('reg base') < W.order.indexOf('get pt_qcChecks'));
    ok('…and the QC lists are read again', W.reads.includes('pt_qcChecks') && W.reads.includes('pt_qcReturns'));
    W = qcWorld({ QC: { checks: [], issue: [], ret: [] }, regFails: true });
    await fn(['qcRefresh', 'ensureQc'], W.ctx, S.qc).qcRefresh();
    ok('QC Refresh: Job Work unreadable — the QC lists still refresh', W.reads.includes('pt_qcChecks') && W.QC.busy === false);
  }

  /* ---- Order Console ---- */
  {
    const W = { seen: null, gates: null };
    const st = { ORD: { req: {} }, QC: { checks: [] }, FGI: { rows: [] }, VO: { rows: [] }, SOX: { rows: [] }, ODR: { rows: [] } };
    const ctx = Object.assign({}, st, {
      ptLoadGates: async f => { W.gates = f; },
      ensureOrd: async () => { W.seen = { req: st.ORD.req, qc: st.QC.checks, fgi: st.FGI.rows, vo: st.VO.rows, sox: st.SOX.rows, odr: st.ODR.rows }; },
      ptRefreshButton: async (b, work) => work(), $: () => ({}),
    });
    await fn(['odRefresh'], ctx, S.be).odRefresh();
    ok('Order Console Refresh: the order registers are read again', W.gates === true);
    ok('…vendor orders, sales-order changes and delete requests are read again too', W.seen && W.seen.vo === null && W.seen.sox === null && W.seen.odr === null);
    ok('…as before: cutting overrides, QC and the finished-goods ledger', W.seen && W.seen.req === null && W.seen.qc === null && W.seen.fgi === null);

    const R = { drew: 0 };
    const oc = {
      PTG_ALL: {}, ptLack: () => false, ptNeed: async () => {}, PTE: { emp: null, priority: {} },
      ptLoadEmp: async () => { throw new Error('pt_accLedger refused'); },
      ptLoadEmpOrSkip: async () => { try { await oc.ptLoadEmp(); } catch (e) { /* skipped */ } },
      QC: { checks: [] }, ORD: { req: {}, busy: true }, FGI: { rows: [] }, VO: { rows: [] }, MDBX: { custom: [] }, SOX: { rows: [] },
      ptGet: async () => ({}), ptList: v => Object.values(v || {}), fgiLoad: async () => {}, ensureVo: async () => {},
      odrLoad: async () => {}, ordQtyBadge: () => {}, renderOrd: () => { R.drew++; }, ptStamp: () => 'now',
    };
    let threw = false;
    try { await fn(['ensureOrd'], oc, S.oc).ensureOrd(); } catch (e) { threw = true; }
    ok('Order Console: staff list fails — the screen is still drawn ("Loading…" ends)', !threw && R.drew === 1 && oc.ORD.busy === false);
  }

  /* ---- Job Work (Plan base) ---- */
  {
    const W = { drawn: [] };
    const PT = { base: [{ id: 'old' }], err: { base: '' } };
    const ctx = { PT, ptReadReg: async r => { if (r === 'base') PT.base = [{ id: 'new' }]; }, renderPbase: () => { W.drawn.push(PT.base[0].id); }, ptRefreshButton: async (b, w) => w(), $: () => ({}) };
    await fn(['pbRefresh'], ctx, S.fc).pbRefresh();
    ok('Job Work Refresh: drawn once, with the fresh rows (no blank "Loading…" first)', W.drawn.length === 1 && W.drawn[0] === 'new');
    const ctx2 = Object.assign({}, ctx, { ptReadReg: async () => { throw new Error('refused'); } });
    await fn(['pbRefresh'], ctx2, S.fc).pbRefresh();
    ok('…a failed read shows on the screen', PT.err.base === 'refused');
  }

  /* ---- Finished Goods ---- */
  {
    const W = { drawn: [], regs: [] };
    const FGI = { rows: [{ id: 'old' }], err: '', at: '' };
    const box = { pick: null };
    const ctx = {
      FGI, ptGet: async n => (n === 'pt_fgiLedger' ? { a: { id: 'new' } } : null), ptList: v => Object.values(v || {}), ptStamp: () => 'now',
      ptReadReg: async r => { W.regs.push(r); }, renderFgi: () => { W.drawn.push(FGI.rows[0].id); },
      ptRefreshButton: async (b, w) => w(), $: () => ({}),
    };
    const code = cut(S.fg, 'fgiRefresh') + '\nreturn { fgiRefresh, pick: () => FGI_PICK };';
    const api = new Function('FGI_PICK', ...Object.keys(ctx), code)({ stock: new Set(['x']), ledger: new Set() }, ...Object.values(ctx));
    await api.fgiRefresh();
    ok('Finished Goods Refresh: the ledger is read again and drawn once, without a blank', W.drawn.length === 1 && W.drawn[0] === 'new');
    ok('…the press-pending list is read again too', W.regs.includes('press'));
    ok('…ticks are cleared (a ticked row may have changed)', api.pick().stock.size === 0);
    const ctx2 = Object.assign({}, ctx, { ptGet: async () => { throw new Error('ledger refused'); } });
    const api2 = new Function('FGI_PICK', ...Object.keys(ctx2), code)({ stock: new Set(), ledger: new Set() }, ...Object.values(ctx2));
    FGI.rows = [{ id: 'kept' }];
    await api2.fgiRefresh();
    ok('…a failed read keeps the rows and shows the error', FGI.err === 'ledger refused' && FGI.rows[0].id === 'kept');
  }

  /* ---- wiring ---- */
  ok('each Refresh button goes through the "Refreshing…" helper',
    S.qc.includes("$('qcGo').onclick = () => ptRefreshButton($('qcGo'), qcRefresh);")
    && S.be.includes("$('odGo').onclick = () => ptRefreshButton($('odGo'), odRefresh);")
    && S.fc.includes("$('pbGo').onclick = () => ptRefreshButton($('pbGo'), pbRefresh);")
    && S.fg.includes("$('fgRefresh').onclick = () => ptRefreshButton($('fgRefresh'), fgiRefresh);"));
  ok('Finished Goods has its Refresh button on the page', /<button id="fgRefresh"[^>]*>Refresh<\/button>/.test(PAGE));
  ok('Order Console and QC read the staff list without stopping the screen', S.oc.includes("await ptLoadEmpOrSkip('ord')") && S.qc.includes("await ptLoadEmpOrSkip('quality-control')"));

  if (loud) console.log(`\n${pass} passed, ${fails.length} failed`);
  return fails;
}

(async () => {
  const fails = await suite(ORIGINAL, true);
  if (fails.length) process.exit(1);
  /* TEETH: each fix undone must be caught. */
  const breaks = [
    ['QC loads only when the checks are missing', 'qc', 'QC.checks === null || QC.issue === null || QC.ret === null ||', 'QC.checks === null ||'],
    ['QC Refresh forgets Job Work', 'qc', "try { await ptReadReg('base'); } catch (e) { console.warn('[quality-control] Job Work not read again:', e); }", ''],
    ['Order Console Refresh forgets vendor orders', 'be', 'VO.rows = null; SOX.rows = null; ODR.rows = null;', 'SOX.rows = null; ODR.rows = null;'],
    ['the button is not brought back', 'dbr', "finally { btn.disabled = false; btn.textContent = label; }", 'finally { }'],
    ['the staff list stops the Order Console again', 'oc', "await ptLoadEmpOrSkip('ord')", 'await ptLoadEmp()'],
    ['Job Work blanks before reading', 'fc', "async function pbRefresh() {\n  try", "async function pbRefresh() {\n  renderPbase();\n  try"],
    ['Finished Goods forgets the press list', 'fg', "ptReadReg('press')", 'Promise.resolve()'],
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
