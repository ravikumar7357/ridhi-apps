/* PENDING BADGES (Step 1, badges part, of docs/data-reduction/PLAN.md) — core/pending-badges.js, the real sign-in block of
 * core/auth.js and the four badge functions, run against a fake database that answers orderBy/equalTo like the real one.
 *   node tests/pending-badges-test.js            (PB_SRC=<file> to test another copy of pending-badges.js; the last part does)
 * What must hold: the switch order (0 beats the flag, 1 is on, else the flag; never for vendors or harnesses); with the
 * switch off the sign-in makes exactly today's whole-list reads; with it on each badge equals the count from the whole list
 * and no screen list is filled; a screen's own list wins once loaded; a refused or failed question falls back to the
 * whole read and still counts right; the RFD read is skipped only while the vendor orders are not loaded; and a filter
 * that asks for the wrong rows, or a missing fallback, makes this suite fail. */
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const SRC_PB = rd(process.env.PB_SRC || path.join(APP, 'core', 'pending-badges.js'));
const AUTH = rd(path.join(APP, 'core', 'auth.js'));
const FILES = { vrq: rd(path.join(APP, 'vendors/orders/vendor-order-requests.js')), odr: rd(path.join(APP, 'orders/delete-requests.js')),
  fgc: rd(path.join(APP, 'inventory/fg-corrections.js')), jwc: rd(path.join(APP, 'production/job-work-corrections.js')) };
const DBR = rd(path.join(APP, 'core', 'database-read.js'));
const cut = (src, name) => { let i = src.indexOf('async function ' + name + '('); if (i < 0) i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return src.slice(i, src.indexOf('\n}', i) + 2); };
const line = (src, head) => { const i = src.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return src.slice(i, src.indexOf('\n', i)) + '\n'; };
const A0 = "if (ME.tabs.includes('vreq') && vrqCanApprove())", A1 = "if (ME.tabs.includes('fgi')) ptGet('pt_amzListings')";
const LOGIN = AUTH.slice(AUTH.indexOf(A0), AUTH.indexOf(A1));
const PARTS = [cut(DBR, 'ptList'), cut(FILES.vrq, 'vrqBadge'), cut(FILES.odr, 'odrLoad'), cut(FILES.odr, 'odrBadge'), line(FILES.odr, 'const odrPending ='),
  cut(FILES.fgc, 'fgiCorrLoad'), cut(FILES.fgc, 'fgiCorrBadge'), line(FILES.fgc, 'const fgiCorrPending ='),
  cut(FILES.jwc, 'jwCorrLoad'), cut(FILES.jwc, 'jwCorrBadge'), line(FILES.jwc, 'const jwCorrPending =')].join('\n');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const tick = (n = 12) => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : setImmediate(f)); setImmediate(f); });

/* the four lists, with rows that are pending, other statuses, no status at all, no id, and a stray value */
const DATA = () => ({
  pt_vendorOrderReqs: { r1: { id: 'r1', status: 'pending' }, r2: { id: 'r2', status: 'approved' }, r3: { id: 'r3' }, r4: { status: 'pending' }, r5: { id: 'r5', status: 'pending' }, r6: { id: 'r6', status: 'rejected' } },
  pt_obDeleteReqs: { d1: { id: 'd1', status: 'pending' }, d2: { id: 'd2', status: 'deleted' }, d3: { id: 'd3' }, d4: { id: 'd4', status: 'pending' }, d5: { id: 'd5', status: 'pending' }, d6: { id: 'd6', status: 'kept' } },
  pt_fgiCorrReqs: { a: { status: 'pending' }, b: { status: 'closed' }, c: {}, d: { status: 'pending' }, e: 'stray', f: { status: 'approved' } },
  pt_jwCorrReqs: { a: { status: 'pending', rowId: 'x' }, b: { status: 'rejected' }, c: { rowId: 'y' }, d: { status: 'pending' }, e: { status: 'pending' }, f: 'stray' },
  pt_rfdDecisions: { q: { stage: 'pending' } },
});
const WANT = { vreqBadge: '2', soDelBadge: '3', fgiCorrBadge: '2', jwCorrBadge: '3' };

async function login(o) {
  o = o || {};
  const LS = new Map(Object.entries(o.ls || {}));
  const localStorage = { getItem: k => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => LS.set(k, String(v)), removeItem: k => { LS.delete(k); } };
  const D = DATA(), whole = [], queries = [], warns = [], els = {};
  const $ = id => els[id] || (els[id] = { textContent: '', classList: { toggle() {}, add() {}, remove() {} }, style: {} });
  const fetch = async url => {
    const m = String(url).match(/https:\/\/db\/([^?]*)\.json\?(.*)$/); const node = decodeURIComponent(m[1]); const qs = new URLSearchParams(m[2]);
    queries.push({ node, qs: m[2] });
    if (o.refuse && o.refuse.includes(node)) return { ok: false, status: 400, json: async () => ({ error: 'Index not defined, add ".indexOn": "status"' }) };
    if (o.throws && o.throws.includes(node)) throw new Error('Failed to fetch');
    let v = D[node] || null;
    if (qs.get('orderBy') === '"status"' && v && !o.sloppy) v = Object.fromEntries(Object.entries(v).filter(([, x]) => x && typeof x === 'object' && x.status === JSON.parse(qs.get('equalTo'))));
    const t = JSON.stringify(Object.keys(v || {}).length ? v : null);
    return { ok: true, status: 200, json: async () => JSON.parse(t) };
  };
  const ctx = {
    fetch, localStorage, $, nf: n => String(n), AUDIT: { on: !o.harness }, spIsVendor: () => !!o.vendor,
    PT_URL: 'https://db', ptPath: p => String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/'), ptAuthQuery: async () => '?auth=t',
    ptGet: async n => { whole.push(n); return JSON.parse(JSON.stringify(D[n] === undefined ? null : D[n])); },
    ME: { admin: true, tabs: ['vreq', 'rfd', 'so', 'fgi', 'pbase'], email: 'a@b' },
    vrqCanApprove: () => true, rfdCanApprove: () => true, odrCanAnswer: () => true, fgiCanEdit: () => true, ptCanEdit: () => true, soCanApprove: () => true,
    rfdBadge: () => { ctx.rfdCalls++; }, rfdCalls: 0,
    VRQ: { rows: null }, ODR: { rows: null, pick: new Set() }, FGC: { rows: null }, JWC: { rows: null }, RFD: { decisions: null },
    VO: { rows: o.voLoaded ? [] : null },
  };
  const fakeConsole = { warn: (...a) => warns.push(a.join(' ')), log: () => {}, error: () => {} };
  const body = SRC_PB + '\n' + PARTS + '\n(async () => {\n' + LOGIN + '\n})();\n'
    + 'return { pbOn, pbSaveFlag, pbSkipRfdRead, PB, VRQ, ODR, FGC, JWC, RFD, odrLoad, fgiCorrLoad, jwCorrLoad, vrqBadge, odrBadge, fgiCorrBadge, jwCorrBadge };';
  const names = Object.keys(ctx);
  const api = new Function('console', ...names, body)(fakeConsole, ...names.map(k => ctx[k]));
  await tick();
  const badges = () => ({ vreqBadge: $('vreqBadge').textContent, soDelBadge: $('soDelBadge').textContent, fgiCorrBadge: $('fgiCorrBadge').textContent, jwCorrBadge: $('jwCorrBadge').textContent });
  return Object.assign(api, { LS, whole, queries, warns, badges, ctx, tick });
}
const four = ['pt_vendorOrderReqs', 'pt_obDeleteReqs', 'pt_fgiCorrReqs', 'pt_jwCorrReqs'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  console.log('== switch order: 0 beats the flag, 1 turns it on, otherwise the flag decides ==');
  let W = await login({ ls: { pendingBadges: '0', pbFlagLast: '1' } }); ok("'0' is off even when the flag says on", W.pbOn() === false);
  W = await login({ ls: { pendingBadges: '1' } }); ok("'1' is on", W.pbOn() === true);
  W = await login({ ls: { pbFlagLast: '1' } }); ok('nothing set: the flag on means on', W.pbOn() === true);
  W = await login({ ls: { pbFlagLast: '0' } }); ok('nothing set: any other flag answer means off', W.pbOn() === false);
  W = await login({}); ok('nothing set and no flag: off (the shipped default)', W.pbOn() === false);
  W = await login({ ls: { pendingBadges: '1' }, vendor: true }); ok('never for a vendor, even with 1', W.pbOn() === false);
  W = await login({ ls: { pendingBadges: '1' }, harness: true }); ok('never in the test harnesses, even with 1', W.pbOn() === false);
  W = await login({}); W.pbSaveFlag(true); ok('the flag answer is kept for the next load', W.LS.get('pbFlagLast') === '1'); W.pbSaveFlag(false); ok('…and removed when off', !W.LS.has('pbFlagLast'));

  console.log("== switch off: exactly today's reads, today's numbers ==");
  const off = await login({});
  ok('the four whole lists and the RFD decisions are read, once each', same(off.whole.slice().sort(), [...four, 'pt_rfdDecisions'].sort()), off.whole.join(','));
  ok('no database question is asked', off.queries.length === 0);
  ok('the badges show the count from the whole lists', same(off.badges(), WANT), JSON.stringify(off.badges()));
  ok("the screens' lists are filled as before", off.VRQ.rows && off.ODR.rows && off.FGC.rows && off.JWC.rows && off.RFD.decisions);

  console.log('== switch on: only pending rows are asked for ==');
  const on = await login({ ls: { pendingBadges: '1' } });
  ok('none of the four whole lists is read', !on.whole.some(n => four.includes(n)), on.whole.join(','));
  ok('the RFD decisions are not read while the vendor orders are not loaded', !on.whole.includes('pt_rfdDecisions'));
  ok('four questions, one per list, by status = pending', on.queries.length === 4 && four.every(n => on.queries.some(q => q.node === n && q.qs.includes('orderBy=%22status%22&equalTo=%22pending%22') && q.qs.includes('auth=t'))), JSON.stringify(on.queries));
  ok('each badge equals the count from the whole list', same(on.badges(), WANT), JSON.stringify(on.badges()));
  ok('no screen list is filled by the badge query', on.VRQ.rows === null && on.ODR.rows === null && on.FGC.rows === null && on.JWC.rows === null);
  ok('the counts sit apart, in PB', same(on.PB.counts, { vrq: 2, odr: 3, fgc: 2, jwc: 3 }), JSON.stringify(on.PB.counts));

  console.log('== a screen opened afterwards reads its whole list, and its own count wins ==');
  on.PB.counts.odr = 99; on.PB.counts.vrq = 99; on.PB.counts.fgc = 99; on.PB.counts.jwc = 99;
  await on.odrLoad(); await on.fgiCorrLoad(); await on.jwCorrLoad();
  ok('the deletion-request screen read its whole list', on.whole.includes('pt_obDeleteReqs') && on.ODR.rows.length === 6);
  ok('…and its own count (3) replaced the badge count (99)', on.badges().soDelBadge === '3');
  ok('the corrections screens too', on.badges().fgiCorrBadge === '2' && on.badges().jwCorrBadge === '3' && on.FGC.rows && on.JWC.full === true);
  on.vrqBadge(); ok('the vendor-requests badge with its list still not loaded shows the sign-in count', on.badges().vreqBadge === '99');
  on.VRQ.rows = [{ id: 'a', status: 'pending' }]; on.vrqBadge(); ok('…and its own list wins once loaded', on.badges().vreqBadge === '1');

  console.log('== a refused or failed question reads the whole list instead ==');
  let F = await login({ ls: { pendingBadges: '1' }, refuse: ['pt_obDeleteReqs'] });
  ok('the refused list is read whole; the others are still asked', F.whole.includes('pt_obDeleteReqs') && !F.whole.includes('pt_vendorOrderReqs') && F.queries.length === 4);
  ok('every badge still shows the right number (never 0 from a failed question)', same(F.badges(), WANT), JSON.stringify(F.badges()));
  ok('the reason went to the console', F.warns.some(w => w.includes('odr') && w.includes('400')), F.warns.join('|'));
  F = await login({ ls: { pendingBadges: '1' }, refuse: four });
  ok('all four refused (index not published): all four read whole, all numbers right', four.every(n => F.whole.includes(n)) && same(F.badges(), WANT), JSON.stringify(F.badges()));
  F = await login({ ls: { pendingBadges: '1' }, throws: ['pt_jwCorrReqs', 'pt_fgiCorrReqs'] });
  ok('a network error falls back too', F.whole.includes('pt_jwCorrReqs') && F.whole.includes('pt_fgiCorrReqs') && same(F.badges(), WANT), JSON.stringify(F.badges()));

  F = await login({ ls: { pendingBadges: '1' }, sloppy: true });
  ok('rows of other statuses that come back anyway are not counted', same(F.badges(), WANT), JSON.stringify(F.badges()));

  console.log('== RFD: skipped only while the vendor orders are not loaded ==');
  W = await login({ ls: { pendingBadges: '1' }, voLoaded: true });
  ok('vendor orders loaded: the decisions are read as before', W.whole.includes('pt_rfdDecisions') && W.ctx.rfdCalls === 1);
  W = await login({ ls: { pendingBadges: '1' } });
  ok('vendor orders not loaded: no read, no badge draw', !W.whole.includes('pt_rfdDecisions') && W.ctx.rfdCalls === 0 && W.RFD.decisions === null);
  W = await login({});
  ok('switch off, vendor orders not loaded: read as before', W.whole.includes('pt_rfdDecisions'));

  console.log('== the sign-in wiring ==');
  ok('auth.js asks for the flag in the one Firestore read it already makes', (AUTH.match(/getDoc\(doc\(db, 'config', 'flags'\)\)/g) || []).length === 1 && AUTH.includes('pbSaveFlag('));

  console.log('== Job Work move: never moves an entry while the correction requests have not been read in full ==');
  const JWS = rd(process.env.JWS_SRC || path.join(APP, 'core', 'job-work-split.js'));
  const JWS_PARTS = [line(JWS, 'const BASE = {'), line(JWS, 'const BASE_NODE ='), line(JWS, 'const BASE_MOVE_BATCH'), line(JWS, 'const baseDayOf ='),
    cut(DBR, 'ptDtMs'), cut(JWS, 'baseArchivePlan'), line(JWS, 'const baseOnPreview ='), cut(JWS, 'baseAutoMove')].join('\n');
  const yd = new Date(Date.now() - 86400000), p2 = n => String(n).padStart(2, '0');
  const yesterday = `${p2(yd.getDate())}/${p2(yd.getMonth() + 1)}/${yd.getFullYear()}, 10:00`;
  const jw = (o) => {
    const LS = new Map(Object.entries(o.ls || {})), patches = [];
    const ctx = { localStorage: { getItem: k => (LS.has(k) ? LS.get(k) : null) }, AUDIT: { on: true }, spIsVendor: () => false, ptNum: x => Number(x) || 0,
      PT: { base: [{ id: 'e1', frozen: true, pendingPieces: 0, receivingDate: yesterday }, { id: 'e2', frozen: true, pendingPieces: 0, receivingDate: yesterday }] },
      JWC: { rows: { c1: { status: 'pending', rowId: 'e2' } } }, ME: { email: 'a@b' },
      ptGet: async () => ({ enabled: true }), ptPatch: async u => { patches.push(u); }, baseArchiveRun: async () => ({ moved: 1 }) };
    if (o.full) ctx.JWC.full = true;
    const names = Object.keys(ctx);
    const api = new Function(...names, SRC_PB + '\n' + JWS_PARTS + '\nBASE.openIds = new Set(["e1","e2"]);\nreturn { baseArchivePlan, baseAutoMove };')(...names.map(k => ctx[k]));
    return Object.assign(api, { patches });
  };
  let J = jw({ ls: { pendingBadges: '1' } });
  ok('switch on, corrections not read: the plan moves nothing', J.baseArchivePlan([{ id: 'e1', frozen: true, pendingPieces: 0, receivingDate: yesterday }]).rows.length === 0);
  const jr = await J.baseAutoMove();
  ok("…and the automatic move says 'not ready' and writes nothing to _auto", jr && jr.skipped === 'not ready' && J.patches.length === 0, JSON.stringify(jr) + ' ' + J.patches.length);
  J = jw({ ls: { pendingBadges: '1' }, full: true });
  const planOn = J.baseArchivePlan([{ id: 'e1', frozen: true, pendingPieces: 0, receivingDate: yesterday }, { id: 'e2', frozen: true, pendingPieces: 0, receivingDate: yesterday }]);
  const J0 = jw({ full: true });
  const planOff = J0.baseArchivePlan([{ id: 'e1', frozen: true, pendingPieces: 0, receivingDate: yesterday }, { id: 'e2', frozen: true, pendingPieces: 0, receivingDate: yesterday }]);
  ok('switch on, corrections read: the plan equals the switch-off plan', same(planOn.rows.map(r => r.id), planOff.rows.map(r => r.id)) && planOn.rows.length === 1);
  ok('…and the entry with a correction waiting is still held back', !planOn.rows.some(r => r.id === 'e2') && planOn.rows[0].id === 'e1');
  const jr2 = await J.baseAutoMove();
  ok('…and the automatic move runs and takes its turn', jr2 && jr2.moved === 1 && J.patches.length === 1);
  const J1 = jw({});
  const plan1 = J1.baseArchivePlan([{ id: 'e1', frozen: true, pendingPieces: 0, receivingDate: yesterday }, { id: 'e2', frozen: true, pendingPieces: 0, receivingDate: yesterday }]);
  ok('switch off, corrections never flagged as read: the plan is as before (e1 moves, e2 held)', plan1.rows.length === 1 && plan1.rows[0].id === 'e1');
  const jr3 = await J1.baseAutoMove();
  ok('switch off: the automatic move runs as before', jr3 && jr3.moved === 1);

  if (!process.env.PB_TEETH) {
    console.log('== teeth: a broken copy must fail this suite ==');
    const tmp = path.join(os.tmpdir(), 'pb-teeth-' + process.pid);
    fs.mkdirSync(tmp, { recursive: true });
    const broken = (label, from, to) => {
      if (!SRC_PB.includes(from)) { ok('teeth setup: ' + label, false, 'text to break not found'); return; }
      const f = path.join(tmp, label + '.js'); fs.writeFileSync(f, SRC_PB.replace(from, to));
      const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { PB_SRC: f, PB_TEETH: '1' }), encoding: 'utf8' });
      ok('teeth: ' + label + ' makes the suite fail', r.status !== 0);
    };
    broken('wrong-filter', 'equalTo=%22pending%22', 'equalTo=%22approved%22');
    broken('no-fallback', 'return full(); }\n  PB.counts', 'return; }\n  PB.counts');
    broken('no-recount', "r.status === 'pending' && ", '');
    {
      const g = "pbOn() && !(typeof JWC !== 'undefined' && JWC && JWC.full)";
      const src = rd(path.join(APP, 'core', 'job-work-split.js'));
      if (!src.includes(g)) ok('teeth setup: guard', false, 'guard text not found');
      else {
        const f = path.join(tmp, 'jws-no-guard.js'); fs.writeFileSync(f, src.split(g).join('false'));
        const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { JWS_SRC: f, PB_TEETH: '1' }), encoding: 'utf8' });
        ok('teeth: job-work-split.js with the guard removed makes the suite fail', r.status !== 0);
      }
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp folder stays */ }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed — ' + (e && e.stack || e)); process.exit(1); });
