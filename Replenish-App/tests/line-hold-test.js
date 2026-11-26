/* Two screens cannot cut the same pieces (src/app/core/line-hold.js; the cutting form's Save in core/look-alike-skus.js;
 * ptCas in core/history.js). Ravi, 26 Nov: two screens both saw pieces left, both saved. Switch "lineHold" on: the order line is
 * held, the register read again, and a repeated Save writes the same entry. Two pretend screens share one pretend database here.
 * Cases are made up.
 *   node tests/line-hold-test.js      (HOLD_APP=<folder like src/app> tests another copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.HOLD_APP || path.join(__dirname, '..', 'src', 'app');
const src = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
/** From the line that matches to the next closing brace at the margin. */
function cut(file, startRe, end) {
  const s = src(file), i = s.search(startRe);
  if (i < 0) throw new Error(String(startRe) + ' not found in ' + file);
  return s.slice(i, s.indexOf(end || '\n}', i) + (end || '\n}').length);
}
const CODE = [src('core/line-hold.js'),
  /* the one number rule the forms ask before saving (fix 6, 26 Nov) */
  cut('core/helpers.js', /^const PT_NUM_BIG/m, ';'), cut('core/helpers.js', /^function ptNumErr\(/m), cut('core/helpers.js', /^function ptNumBig\(/m),
  cut('core/history.js', /^async function ptCas\(/m), cut('core/history.js', /^async function ptGetFreshWhere\(/m), cut('core/history.js', /^function lineHoldOn\(/m),
  cut('core/look-alike-skus.js', /^function cutGuard\(/m),
  cut('core/look-alike-skus.js', /^const CUT_DRAFT_LIFE_MS/m, ';'), cut('core/look-alike-skus.js', /^const CUT_DRAFTS/m, ';'), cut('core/look-alike-skus.js', /^function cutEntryId\(/m),
  cut('core/look-alike-skus.js', /^async function cutWrite\(/m), cut('orders/order-console-table.js', /^async function spCutReal\(/m),
  cut('core/look-alike-skus.js', /^function cutSaveHeld\(/m), cut('core/look-alike-skus.js', /^function cutFormMsg\(/m, '\n'),
  cut('core/look-alike-skus.js', /^\$\('cwSave'\)\.onclick/m, '\n};')].join('\n');

const MIN = 60 * 1000, HOLD = 'pt_lineHold/cutting/OC-1__MADE-UP';
/** The pretend database: values by path, an ETag per value, and what it refuses. */
function database() {
  const db = { at: {}, refuse: {}, now: () => Date.now() };
  db.get = p => {
    if (p === 'pt_cuttingData') { const out = {}; Object.keys(db.at).filter(k => k.startsWith(p + '/')).forEach(k => { out[k.slice(p.length + 1)] = clone(db.at[k]); }); return out; }
    return clone(db.at[p]);
  };
  db.entries = () => Object.values(db.get('pt_cuttingData'));
  db.holds = () => Object.keys(db.at).filter(k => k.startsWith('pt_lineHold/'));
  db.fetch = async (url, init) => {
    const [p, query] = url.split('.json'), tag = JSON.stringify(db.get(p));
    if (query && query.includes('orderBy')) {
      if (db.refuse.query) return { ok: false, status: 401 };
      const q = new URLSearchParams(query.slice(1)), field = JSON.parse(q.get('orderBy')), want = JSON.parse(q.get('equalTo'));
      return { ok: true, status: 200, json: async () => Object.fromEntries(Object.entries(db.get(p)).filter(([, r]) => r[field] === want)) };
    }
    if (!init || !init.method) {
      if (db.refuse.read) return { ok: false, status: 401, headers: { get: () => null } };
      return { ok: true, status: 200, headers: { get: () => tag }, json: async () => db.get(p) };
    }
    if (db.refuse.write) return { ok: false, status: 401 };
    if (init.headers['if-match'] !== tag) return { ok: false, status: 412 };
    const v = JSON.parse(init.body);
    if (v === null) delete db.at[p]; else db.at[p] = v.at && v.at['.sv'] ? Object.assign({}, v, { at: db.now() }) : v;
    return { ok: true, status: 200 };
  };
  return db;
}

/** One PC at the cutting form. */
function screen(db, o) {
  o = o || {};
  const boxes = {}, log = { told: [], warned: [] };
  const skew = o.skew || 0;
  class PcDate extends Date { static now() { return Date.now() + skew + (o.later || 0); } }
  const box = id => boxes[id] || (boxes[id] = { value: '', textContent: '', className: '', disabled: false, dataset: {} });
  const nothing = () => {}, told = what => () => { log.told.push(what); };
  const up = s => String(s || '').trim().toUpperCase();
  const ctx = {
    console: { warn: m => { log.warned.push(String(m)); }, log: console.log }, Date: PcDate, deltaServerNow: async () => db.now(), $: box, nf: String, obUC: up, ME: { email: 'cutter@test' }, auth: { currentUser: { email: o.email || 'cutter@test' } },
    localStorage: { getItem: k => (k === 'lineHold' && !o.off ? '1' : null) },
    PT_URL: '', ptPath: p => p, ptAuthQuery: async () => '', fetch: async (u, i) => db.fetch(u.replace(/^\//, ''), i), dmJson: undefined,
    ptLiveWrote: nothing, ptSaveFailed: told('refused'), ptMirrorEarly: () => { log.told.push('mirror'); return null; }, ptMirrorFix: nothing,
    ptMirror: told('mirror'), auditLog: told('history'), ptSyncNote: told('sync'), oalAfterSave: told('alert'),
    ptGetFresh: async p => { if (db.refuse.read) throw new Error('read 401'); return db.get(p); },
    ptGet: async p => (o.behind ? {} : db.get(p)), ptList: v => Object.values(v || {}),
    ptPut: async (p, v) => {
      if (o.slow) await new Promise(r => setTimeout(r, 15));
      if (o.lost) { o.lost = false; if (o.arrives) db.at[p] = clone(v); throw new Error('the connection dropped'); }
      db.at[p] = clone(v);
    },
    PT: { cut: [] }, PTG: {}, prOn: () => false, obIsLegacy: () => false, obOrderedQty: () => 4,
    obCutQty: (no, sku) => ctx.PT.cut.filter(r => up(r.orderNo) === up(no) && up(r.sku) === up(sku)).reduce((t, r) => t + r.pieces, 0),
    cutSkuOf: () => ({ articleType: 'Cover' }), validateAgainstMasters: () => [], cutFabrics: () => ['Cotton'], CUT_FROM: '', CUT_OWN_OK: '', CUT_OTHER_CLOTH: {},
    ptCanEdit: () => true, ordLines: () => [{ orderNo: 'OC-1', sku: 'MADE-UP' }, { orderNo: 'OC-2', sku: 'MADE-UP' }], dToday: () => '2026-11-26',
    ptMonthKey: d => d, SP_QUIET: true, renderOrd: nothing,
    cutMonthFrozen: () => false, ptStampDate: d => d, cutFabFields: () => ({}), renderPcut: nothing, renderCutPick: nothing, renderCutForm: nothing, frmRemember: nothing,
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  const fill = pcs => Object.entries({ cwSku: 'made-up', cwOrd: 'OC-1', cwPcs: String(pcs), cwFabric: 'Cotton', cwDate: '2026-11-26' }).forEach(([id, v]) => { box(id).value = v; });
  const order = (pcs, extra, no) => ctx.spCutReal(no || 'OC-1', 'made-up', String(pcs), '2026-11-26', 'Cotton', '', extra || '');
  return { ctx, log, box, fill, order, press: async () => { await box('cwSave').onclick(); return box('cwMsg').textContent; } };
}

(async () => {
  console.log('== two screens, the same pieces ==');
  { const db = database(), a = screen(db, { slow: true }), b = screen(db, { slow: true, email: 'second@test' });
    a.fill(4); b.fill(4);
    const [x, y] = await Promise.all([a.press(), b.press()]);
    ok('pressed together: one entry', db.entries().length === 1, db.entries().length + ' entries');
    ok('…one is told saved, the other that somebody is saving this line', [x, y].filter(s => /^Saved/.test(s)).length === 1 && [x, y].some(s => /somebody else is saving/.test(s)), x + ' | ' + y);
    ok('…and no hold is left behind', db.holds().length === 0, db.holds().join());
    ok('the refused screen can press again', b.box('cwSave').disabled === false); }
  { const db = database(), a = screen(db), b = screen(db);
    a.fill(4); await a.press(); b.fill(1);
    const said = await b.press();
    ok('one after the other: the second screen, still showing nothing cut, is refused on the fresh register', db.entries().length === 1 && /already cut 4/.test(said), said);
    ok('…its filled form is kept', b.box('cwPcs').value === '1');
    ok('…and it lets go of the line', db.holds().length === 0); }

  { const db = database(), a = screen(db), b = screen(db, { behind: true });
    a.fill(4); await a.press(); b.fill(1);
    const said = await b.press();
    ok('the second screen\'s live copy has not received it yet: still refused', db.entries().length === 1 && /already cut 4/.test(said), said); }
  { const db = database(), a = screen(db); db.refuse.query = true; a.fill(1);
    const said = await a.press();
    ok('the order\'s cuts cannot be checked: nothing saved, says why, line let go', db.entries().length === 0 && /could not be checked/.test(said) && db.holds().length === 0, said); }

  console.log('== Save pressed again ==');
  { const db = database(), a = screen(db, { lost: true, arrives: true }); a.fill(4);
    const first = await a.press();
    ok('the save arrived but was reported failed', /Not saved/.test(first) && db.entries().length === 1, first);
    const second = await a.press();
    ok('pressed again: still one entry, and it says saved', db.entries().length === 1 && /^Saved/.test(second), db.entries().length + ' ' + second);
    ok('the screen holds that entry once', a.ctx.PT.cut.length === 1, String(a.ctx.PT.cut.length)); }
  { const db = database(), a = screen(db, { lost: true }); a.fill(2);
    await a.press(); await a.press();
    ok('a save that never arrived is saved by the second press', db.entries().length === 1); }
  { const db = database(), a = screen(db, { lost: true, arrives: true }); a.fill(1);
    await a.press(); a.fill(2); await a.press();
    ok('other figures after a failure are a new entry, not written over the first', db.entries().length === 2 && db.entries().map(e => e.pieces).sort().join() === '1,2', JSON.stringify(db.entries().map(e => e.pieces))); }
  { const db = database(), a = screen(db); a.fill(2); await a.press(); a.fill(2); await a.press();
    ok('the same figures again after a good save are a second cut', db.entries().length === 2, String(db.entries().length)); }

  console.log('== the hold itself ==');
  { const db = database(), a = screen(db); db.at[HOLD] = { by: 'x@test', form: 'other', at: Date.now() - 4 * MIN }; a.fill(1);
    const said = await a.press();
    ok('held by another form: nothing saved, their hold stays', db.entries().length === 0 && db.at[HOLD].form === 'other' && /somebody else/.test(said), said); }
  { const db = database(), a = screen(db); db.at[HOLD] = { by: 'x@test', form: 'other', at: Date.now() - 6 * MIN }; a.fill(1);
    await a.press();
    ok('a hold over 5 minutes old is taken, and gone after the save', db.entries().length === 1 && db.holds().length === 0); }
  { const db = database(), a = screen(db); db.refuse.write = true; db.at[HOLD] = { by: 'x@test', form: 'other', at: Date.now() - 6 * MIN }; a.fill(1);
    const said = await a.press();
    ok('the database refuses to hand over a hold: read as held, nothing saved', db.entries().length === 0 && /somebody else/.test(said), said);
    ok('…not reported as a failed save, and the console says why', a.log.told.length === 0 && a.log.warned.some(w => /refused/.test(w)), a.log.told.join() + a.log.warned.join()); }
  { const db = database(), a = screen(db); db.refuse.write = true; a.fill(1);
    const said = await a.press();
    ok('refused with nobody holding the line: says this account may not, not "somebody else"', /may not hold order lines/.test(said) && !/somebody else/.test(said) && db.entries().length === 0, said); }
  { const db = database(), a = screen(db, { skew: 10 * MIN }); db.at[HOLD] = { by: 'x@test', form: 'other', at: Date.now() - 4 * MIN }; a.fill(1);
    await a.press();
    ok('a PC clock 10 minutes fast does not take a live hold', db.entries().length === 0); }
  { const db = database(), a = screen(db, { skew: -10 * MIN }); db.at[HOLD] = { by: 'x@test', form: 'other', at: Date.now() - 6 * MIN }; a.fill(1);
    await a.press();
    ok('a PC clock 10 minutes slow does not wait on an old hold', db.entries().length === 1); }
  { const db = database(), a = screen(db); db.refuse.read = true; a.fill(1);
    const said = await a.press();
    ok('the hold cannot be read: nothing saved, says why and what to do', db.entries().length === 0 && /could not be held/.test(said) && /401/.test(said) && /press Save again/.test(said), said); }
  { const db = database(), a = screen(db, { lost: true }); a.fill(1); await a.press();
    ok('a failed save lets go of the line', db.holds().length === 0); }
  { const db = database(), a = screen(db); let seen = null;
    const put = a.ctx.ptPut; a.ctx.ptPut = async (p, v) => { seen = clone(db.at[HOLD]); return put(p, v); }; a.fill(1); await a.press();
    ok('while saving, the line is held by this account and this entry, stamped by the database', !!seen && seen.by === 'cutter@test' && seen.form === db.entries()[0].id && typeof seen.at === 'number', JSON.stringify(seen));
    ok('holding and letting go leave no history line, mirror, sync note or alert', a.log.told.length === 0, a.log.told.join()); }
  { const a = screen(database()), key = vm.runInContext('lineHoldKey', a.ctx);
    ok('a key holds no character the database refuses', !/[.#$\[\]\/]/.test(key('PO/12.5', 'A#[1]$')), key('PO/12.5', 'A#[1]$'));
    ok('different lines never share a key', new Set([key('A.1', 'S'), key('A~2e1', 'S'), key('A/1', 'S'), key('A1', 'S')]).size === 4);
    ok('the same line typed in other capitals is the same key', key('oc-1', 'made-up') === key('OC-1', 'MADE-UP')); }

  console.log('== the order screens (a single cut and the Excel upload) ==');
  { const db = database(), a = screen(db), b = screen(db, { behind: true });
    const first = await a.order(4), second = await b.order(1);
    ok('a second screen cannot cut what is already cut', first === '' && /already cut 4/.test(second) && db.entries().length === 1, first + ' | ' + second); }
  { const db = database(), a = screen(db, { slow: true }), b = screen(db);
    a.fill(4); const [x, y] = await Promise.all([a.press(), b.order(4)]);
    ok('the cutting form and an order screen at once: one entry', db.entries().length === 1, x + ' | ' + y); }
  { const db = database(), a = screen(db, { lost: true, arrives: true });
    const first = await a.order(1), other = await a.order(2, '', 'OC-2'), again = await a.order(1);
    ok('an upload run again after a lost answer: that line is not entered twice, though another was saved between', /Not saved/.test(first) && other === '' && again === '' && db.entries().length === 2, db.entries().length + ' ' + first + again); }
  { const opts = { lost: true, arrives: true }, db = database(), a = screen(db, opts);
    await a.order(1); opts.later = 9 * 60 * 1000; await a.order(1);
    ok('the same cut 9 minutes after a lost answer is the retry: one entry', db.entries().length === 1, String(db.entries().length)); }
  { const opts = { lost: true, arrives: true }, db = database(), a = screen(db, opts);
    await a.order(1); opts.later = 11 * 60 * 1000; const said = await a.order(1);
    ok('the same cut 11 minutes after a lost answer is a real second cut: two entries', said === '' && db.entries().length === 2, db.entries().length + ' ' + said); }
  { const db = database(), a = screen(db); await a.order(4);
    const said = await a.order(1, 'damaged piece');
    ok('an extra cut with its reason still passes the ordered quantity', said === '' && db.entries().length === 2, said); }
  { const db = database(), a = screen(db); await a.order(1); await a.order(1);
    ok('the same cut again after a good save is a second cut', db.entries().length === 2); }
  { const db = database(), a = screen(db); db.at['pt_lineHold/cutting/OC-1__MADE-UP'] = { by: 'x@test', form: 'other', at: Date.now() };
    const said = await a.order(1);
    ok('a held line: the order screen says so and writes nothing', /somebody else/.test(said) && db.entries().length === 0, said); }

  console.log('== switch off ==');
  { const db = database(), a = screen(db, { off: true, lost: true, arrives: true });
    await a.order(1); await a.order(1);
    ok('order screen: saved as it always was, a new entry each time', db.entries().length === 2, String(db.entries().length)); }
  { const db = database(), a = screen(db, { off: true, lost: true, arrives: true }); db.at[HOLD] = { by: 'x@test', form: 'other', at: Date.now() };
    a.fill(1); await a.press(); await a.press();
    ok('saved as it always was: no hold asked for, a new entry each press', db.entries().length === 2 && db.at[HOLD].form === 'other', String(db.entries().length)); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
