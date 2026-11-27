/* Two screens cannot pass, check or send for alteration the same pieces (Quality Control, src/app/production/quality-control.js —
 * qcSaveHeld and the saves that use it: the check form, a pass from Waiting for QC, the alteration issue; the hold in
 * core/line-hold.js). Ravi, 26 Nov, PPC test run: two screens passed the same pieces. Switch "lineHold" on: the SKU is held, its
 * checks and alteration issues read from the database, the question asked again, and a repeated Save writes the same records.
 * Two pretend screens share one pretend database. Cases are made up.
 *   node tests/line-hold-qc-test.js      (HOLD_APP=<folder like src/app> tests another copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.HOLD_APP || path.join(__dirname, '..', 'src', 'app');
const src = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
function cut(file, startRe, end) {
  const s = src(file), i = s.search(startRe);
  if (i < 0) throw new Error(String(startRe) + ' not found in ' + file);
  return s.slice(i, s.indexOf(end || '\n}', i) + (end || '\n}').length);
}
const Q = 'production/quality-control.js';
const CODE = [src('core/line-hold.js'),
  /* the one number rule the forms ask before saving (fix 6, 26 Nov) */
  cut('core/helpers.js', /^const PT_NUM_BIG/m, ';'), cut('core/helpers.js', /^function ptNumErr\(/m), cut('core/helpers.js', /^function ptNumBig\(/m),
  cut('core/history.js', /^async function ptCas\(/m), cut('core/history.js', /^async function ptGetFreshWhere\(/m), cut('core/history.js', /^function lineHoldOn\(/m),
  cut(Q, /^const qcIxOf/m, '\n'), cut(Q, /^const qcReceived/m, '\n'), cut(Q, /^const qcChecked/m, '\n'), cut(Q, /^const qcAvailToCheck/m, '\n'),
  cut(Q, /^const qcAltTotal/m, '\n'), cut(Q, /^const qcIssuedTotal/m, '\n'), cut(Q, /^const qcAvailToIssue/m, '\n'),
  cut(Q, /^const QC_DRAFTS/m, ';'), cut(Q, /^const qcDraftId/m, '\n'), cut(Q, /^async function qcFreshSku\(/m), cut(Q, /^async function qcSaveHeld\(/m), cut(Q, /^function qcCheckLeft\(/m),
  cut(Q, /^const qcNewCheckId/m, '\n'), cut(Q, /^const qcPcs/m, '\n'), cut(Q, /^function qcInboxRefusal\(/m), cut(Q, /^function qcCheckRecords\(/m), cut(Q, /^async function qcInboxSave\(/m),
  cut(Q, /^function qcIssueMsg\(/m, '\n'), cut(Q, /^function qcCheckMsg\(/m, '\n'), cut(Q, /^\$\('qcwSave'\)\.onclick/m, '\n};'), cut(Q, /^\$\('qciSave'\)\.onclick/m, '\n};')].join('\n');

const SKU = 'MADE-UP', HOLD = 'pt_lineHold/qc/__MADE-UP';
function database() {
  const db = { at: {}, refuse: {} };
  const reg = p => { const out = {}; Object.keys(db.at).filter(k => k.startsWith(p + '/')).forEach(k => { out[k.slice(p.length + 1)] = clone(db.at[k]); }); return out; };
  db.get = p => (/^pt_qc(Checks|Issuance)$/.test(p) ? reg(p) : clone(db.at[p]));
  db.checks = () => Object.values(reg('pt_qcChecks'));
  db.issues = () => Object.values(reg('pt_qcIssuance'));
  db.holds = () => Object.keys(db.at).filter(k => k.startsWith('pt_lineHold/'));
  db.fetch = async (url, init) => {
    const [p, query] = url.split('.json'), tag = JSON.stringify(db.get(p));
    if (query && query.includes('orderBy')) {
      if (db.refuse.query) return { ok: false, status: 401 };
      const q = new URLSearchParams(query.slice(1)), field = JSON.parse(q.get('orderBy')), want = JSON.parse(q.get('equalTo'));
      return { ok: true, status: 200, json: async () => Object.fromEntries(Object.entries(db.get(p)).filter(([, r]) => r[field] === want)) };
    }
    if (!init || !init.method) return { ok: true, status: 200, headers: { get: () => tag }, json: async () => db.get(p) };
    if (init.headers['if-match'] !== tag) return { ok: false, status: 412 };
    const v = JSON.parse(init.body);
    if (v === null) delete db.at[p]; else db.at[p] = v.at && v.at['.sv'] ? Object.assign({}, v, { at: Date.now() }) : v;
    return { ok: true, status: 200 };
  };
  return db;
}

/** One PC at Quality Control. 4 pieces of the made-up SKU came back from the karigar (Job Work entry b1). */
function screen(db, o) {
  o = o || {};
  const boxes = {};
  const box = id => boxes[id] || (boxes[id] = { value: '', textContent: '', className: '', disabled: false, dataset: {} });
  const nothing = () => {}, up = s => String(s || '').trim().toUpperCase();
  const write = async (p, v) => {
    if (o.slow) await new Promise(r => setTimeout(r, 15));
    if (o.lost) { o.lost = false; if (o.arrives) Object.entries(v).forEach(([k, x]) => { db.at[k] = clone(x); }); throw new Error('the connection dropped'); }
    Object.entries(v).forEach(([k, x]) => { db.at[k] = clone(x); });
  };
  const ctx = {
    console: { warn: nothing, log: console.log }, deltaServerNow: async () => Date.now(), $: box, nf: String, obUC: up, qcNorm: up,
    ME: { email: 'qc@test' }, auth: { currentUser: { email: 'qc@test' } }, localStorage: { getItem: k => (k === 'lineHold' && !o.off ? '1' : null) },
    PT_URL: '', ptPath: p => p, ptAuthQuery: async () => '', fetch: async (u, i) => db.fetch(u.replace(/^\//, ''), i),
    ptLiveWrote: nothing, ptSaveFailed: nothing, ptMirrorEarly: () => null, ptMirrorFix: nothing, ptMirror: nothing, auditLog: nothing, ptSyncNote: nothing,
    ptGetFresh: async p => db.get(p), ptList: raw => Object.keys(raw || {}).map(k => Object.assign({ _key: k }, raw[k])),
    ptPut: (p, v) => write(p, { [p]: v }), ptPatch: v => write('', v), ptNum: v => Number(v) || 0, ptNow: () => new Date().toISOString(), ptStampFrom: (n, d) => d,
    QC_IX: null, QC_SPLIT: ['passed', 'forAlteration', 'rejected', 'spotting', 'touching'], QC_DEPTS: { spotting: 1, touching: 1 },
    qcCheckedOf: e => ['passed', 'forAlteration', 'rejected', 'spotting', 'touching'].reduce((t, k) => t + (parseInt(e[k], 10) || 0), 0),
    qcSendRemark: d => 'sent to ' + d, qcMyName: () => 'qc', qcParts: () => ({ brand: 'Made-up', at: 'Cover', sub: 'Plain', col: 'Red', size: '16x16' }),
    PT: { base: [{ id: 'b1', sku: SKU, orderNo: 'OC-1', receivedPieces: 4, empName: 'Made-up Karigar' }] },
    QC: { checks: o.behind ? [] : null, issue: o.behind ? [] : null },
    cutSkuOf: () => ({}), prOn: () => false, qcOrdersFor: () => [], qcOrderAvail: () => 0,
    frmRemember: nothing, renderQcCheckForm: nothing, renderQc: nothing, renderQcIssueForm: nothing, ptEmpsOfType: () => [['', 'Made-up Tailor']],
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  if (!o.behind) { ctx.QC.checks = ctx.ptList(db.get('pt_qcChecks')); ctx.QC.issue = ctx.ptList(db.get('pt_qcIssuance')); }
  /* Waiting for QC: entry b1 and what is still waiting on it, worked out the way the screen does — from the checks it holds */
  ctx.qcInboxRows = () => [{ r: ctx.PT.base[0], wait: 4 - (ctx.QC.checks || []).filter(c => c.baseId === 'b1').reduce((t, c) => t + c.checked, 0) }];
  const check = async (n, alt) => { Object.entries({ qcwSrc: 'karigar', qcwSku: SKU, qcwBy: 'qc', qcwChecked: String(n), qcwAlt: String(alt || 0), qcwRej: '0', qcwOrd: '', qcwRemarks: '' })
    .forEach(([id, v]) => { box(id).value = v; }); await box('qcwSave').onclick(); return box('qcwMsg').textContent; };
  const alteration = async n => { Object.entries({ qciType: 'Tailor', qciEmp: 'Made-up Tailor', qciSku: SKU, qciPcs: String(n), qciRemarks: '' })
    .forEach(([id, v]) => { box(id).value = v; }); await box('qciSave').onclick(); return box('qciMsg').textContent; };
  const passFromWaiting = n => ctx.qcInboxSave('b1', { passed: n });
  return { ctx, box, check, alteration, passFromWaiting };
}

(async () => {
  console.log('== two screens, the same pieces ==');
  { const db = database(), a = screen(db, { slow: true }), b = screen(db, { slow: true });
    const [x, y] = await Promise.all([a.passFromWaiting(4), b.passFromWaiting(4)]);
    ok('Waiting for QC, passed on two screens at once: one check', db.checks().length === 1, db.checks().length + ' checks');
    ok('…the other is told somebody else is saving, and no hold is left', [x, y].filter(s => s === '').length === 1 && [x, y].some(s => /somebody else is saving/.test(s)) && db.holds().length === 0, x + ' | ' + y); }
  { const db = database(), a = screen(db), b = screen(db, { behind: true });
    await a.passFromWaiting(4); const said = await b.passFromWaiting(1);
    ok('Waiting for QC: a second screen not yet told of the first pass is refused on what the database holds', db.checks().length === 1 && /only 0 piece/.test(said), said); }
  { const db = database(), a = screen(db), b = screen(db, { behind: true });
    const first = await a.check(4), said = await b.check(1);
    ok('the check form: the same', /^Saved/.test(first) && db.checks().length === 1 && /only 0 piece\(s\) of MADE-UP are waiting/.test(said), first + ' | ' + said); }
  { const db = database(), a = screen(db);
    await a.check(4, 3);
    const b = screen(db);   // it has the check with its 3 for alteration…
    await a.alteration(3); const said = await b.alteration(1);   // …but not the issue the first screen has just made
    ok('alteration issue: a second screen cannot issue pieces already issued', db.issues().length === 1 && /only 0 piece\(s\) of MADE-UP are left to issue/.test(said), said); }
  { const db = database(), a = screen(db); db.refuse.query = true;
    const said = await a.check(1);
    ok('the QC cannot be read: nothing saved, says why, SKU let go', db.checks().length === 0 && /could not be checked/.test(said) && db.holds().length === 0, said); }
  { const db = database(), a = screen(db); db.at[HOLD] = { by: 'x@test', form: 'other', at: Date.now() };
    const said = await a.passFromWaiting(1);
    ok('a SKU held by another screen: nothing saved, their hold stays', db.checks().length === 0 && db.at[HOLD].form === 'other' && /somebody else/.test(said), said); }

  console.log('== Save pressed again ==');
  { const db = database(), a = screen(db, { lost: true, arrives: true });
    let first = ''; try { first = await a.passFromWaiting(4); } catch (e) { first = 'Not saved: ' + e.message; }
    const again = await a.passFromWaiting(4);
    ok('a pass that arrived but was reported failed; pressed again: one check, told saved (not "only 0 waiting")', /Not saved/.test(first) && again === '' && db.checks().length === 1, db.checks().length + ' ' + again); }
  { const db = database(), a = screen(db, { lost: true, arrives: true });
    const first = await a.check(4), again = await a.check(4);
    ok('the check form: the same', /Not saved/.test(first) && /^Saved/.test(again) && db.checks().length === 1, db.checks().length + ' ' + again); }
  { const db = database(), a = screen(db); await a.check(1); await a.check(1);
    ok('the same figures again after a good save are a second check', db.checks().length === 2); }
  { const db = database(), a = screen(db, { lost: true, arrives: true });
    try { await a.ctx.qcInboxSave('b1', { spotting: 2 }); } catch (e) { /* reported failed */ }
    const again = await a.ctx.qcInboxSave('b1', { spotting: 2 });
    ok('a send to spotting alone, retried after a lost answer: still one send', again === '' && db.checks().length === 1, again + ' ' + JSON.stringify(db.checks().map(c => c.id))); }

  console.log('== switch off ==');
  { const db = database(), a = screen(db, { off: true }); db.at[HOLD] = { by: 'x@test', form: 'other', at: Date.now() };
    const said = await a.check(1);
    ok('saved as it always was: no hold asked for', /^Saved/.test(said) && db.checks().length === 1 && /^qc_[0-9a-z]+$/.test(db.checks()[0].id), said + ' ' + (db.checks()[0] || {}).id); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
