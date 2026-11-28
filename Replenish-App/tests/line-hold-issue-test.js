/* Two screens cannot issue the same cut pieces to karigars (Job Work's issue form, src/app/production/job-work-entry.js —
 * bdSaveHeld, bdWrite and the Save button; the Order Console's issue, orders/order-console-table.js spIssueReal; the SHP
 * board's issue to an embroidery vendor, orders/shp-board.js shpbIssueVendorSave; the hold in core/line-hold.js). Ravi, 26 Nov: two screens both saw cut pieces waiting, both
 * issued them. Switch "lineHold" on: the order line is held, this SKU's issues read from the database, the limits checked
 * again, and a repeated Save writes the same entry. Two pretend screens share one pretend database. Cases are made up.
 *   node tests/line-hold-issue-test.js      (HOLD_APP=<folder like src/app> tests another copy) */
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
const J = 'production/job-work-entry.js';
/* what the two caps ask about rejected pieces (27 Nov) */
const SCRAP_COUNT = [cut('core/lookups.js', /^const obQcRows/m, '\n'), cut('core/lookups.js', /^function obRowScrap\(/m), cut('core/lookups.js', /^const obQcScrapOf/m, '\n'),
  cut('core/lookups.js', /^let QCREJ_IX/m, ';'), cut('core/lookups.js', /^function obQcRejIndex\(/m), cut('core/lookups.js', /^function obQcScrapQty\(/m), cut('core/lookups.js', /^function flowRejOf\(/m)];
const CODE = [src('core/line-hold.js'),
  /* the one number rule the forms ask before saving (fix 6, 26 Nov) */
  cut('core/helpers.js', /^const PT_NUM_BIG/m, ';'), cut('core/helpers.js', /^function ptNumErr\(/m), cut('core/helpers.js', /^function ptNumBig\(/m),
  cut('core/history.js', /^async function ptCas\(/m), cut('core/history.js', /^async function ptGetFreshWhere\(/m), cut('core/history.js', /^function lineHoldOn\(/m),
  cut('core/lookups.js', /^let BASE_IX/m, ';'), cut('core/lookups.js', /^function obBaseIndex\(/m), ...SCRAP_COUNT,
  cut(J, /^function obIssueSums\(/m), cut(J, /^function obIssueOfOrder\(/m), cut(J, /^function obIssueOfCut\(/m), cut(J, /^function bdPrintedBackErr\(/m), cut(J, /^function bdGuard\(/m), cut(J, /^function bdTwinOf\(/m), cut(J, /^function bdFormMsg\(/m, '\n'),
  cut(J, /^const BD_DRAFTS/m, ';'), cut(J, /^function bdSaveHeld\(/m), cut(J, /^async function bdWrite\(/m),
  cut('orders/order-console-table.js', /^async function spIssueReal\(/m), cut('orders/shp-board.js', /^async function shpbIssueVendorSave\(/m), cut(J, /^\$\('bwSave'\)\.onclick/m, '\n};')].join('\n');

/* the one date rule the forms ask before saving (fix 7, 26 Nov) */
const DATE_RULE = [cut('core/helpers.js', /^const dDiff = /m, ';'), cut('core/helpers.js', /^const PT_DATE_BACK_DAYS/m, ';'),
  cut('core/helpers.js', /^const dTodayIndia = /m, ';'), cut('core/helpers.js', /^const ptDayWords = /m, ';'),
  cut('core/helpers.js', /^function ptDateErr\(/m), cut('core/helpers.js', /^function ptDateOrderErr\(/m)].join('\n');
const MIN = 60 * 1000, SKU = 'MADE-UP', HOLD = 'pt_lineHold/issue/OC-1__MADE-UP';
function database() {
  const db = { at: {}, refuse: {} };
  const reg = p => { const out = {}; Object.keys(db.at).filter(k => k.startsWith(p + '/')).forEach(k => { out[k.slice(p.length + 1)] = clone(db.at[k]); }); return out; };
  db.get = p => (p === 'pt_baseData' ? reg(p) : clone(db.at[p]));
  db.entries = () => Object.values(reg('pt_baseData'));
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

/** One PC at Job Work's issue form. o: { off, slow, lost, arrives, behind, later } */
function screen(db, o) {
  o = o || {};
  const boxes = {}, sent = { wa: 0, zip: 0 };
  const box = id => boxes[id] || (boxes[id] = { value: '', textContent: '', className: '', disabled: false, dataset: {}, checked: false });
  const nothing = () => {}, up = s => String(s || '').trim().toUpperCase();
  class PcDate extends Date { static now() { return Date.now() + (o.later || 0); } }
  const ctx = {
    console: { warn: nothing, log: console.log }, Date: PcDate, deltaServerNow: async () => Date.now(), $: box, nf: String, obUC: up,
    ME: { email: 'issuer@test' }, auth: { currentUser: { email: 'issuer@test' } }, confirm: () => true,
    localStorage: { getItem: k => (k === 'lineHold' && !o.off ? '1' : null) },
    PT_URL: '', ptPath: p => p, ptAuthQuery: async () => '', fetch: async (u, i) => db.fetch(u.replace(/^\//, ''), i),
    ptLiveWrote: nothing, ptSaveFailed: nothing, ptMirrorEarly: () => null, ptMirrorFix: nothing, ptMirror: nothing, auditLog: nothing, ptSyncNote: nothing, oalAfterSave: undefined,
    ptGetFresh: async p => db.get(p), ptList: raw => Object.keys(raw || {}).map(k => Object.assign({ _key: k }, raw[k])),
    ptPut: async (p, v) => {
      if (o.slow) await new Promise(r => setTimeout(r, 15));
      if (o.lost) { o.lost = false; if (o.arrives) db.at[p] = clone(v); throw new Error('the connection dropped'); }
      db.at[p] = clone(v);
    },
    PT: { base: o.behind ? [] : null, cut: [] }, PTG: { qc: [] }, ptNum: v => Number(v) || 0, obKeyOf: (a, b) => up(a) + '|' + up(b),
    prOn: () => false, obIsLegacy: () => false, obOrderedQty: () => 4, obCutQty: () => o.cut || 4, obPressQty: () => 0, cutSkuOf: () => ({ articleType: 'Cover' }),
    frmRemember: () => {}, bdIsCustom: () => false, ptEmpsOfType: () => [['', 'Made-up Karigar']], bdIssueDay: () => '2026-11-26', mdbOf: () => ({}), ptCustomOf: () => null,
    stPrinterSku: () => false, validateAgainstMasters: () => [], ptZipCheck: () => '', bdZipTyped: () => '', bdMatEntry: () => ({}), ptStampDate: d => d,
    waPreOpen: () => null, waPreClose: nothing, waAfterIssue: async () => { sent.wa++; return ''; },
    ptCanEdit: () => true, ordLines: () => [{ orderNo: 'OC-1', sku: SKU }], dToday: () => '2026-11-26', SP_QUIET: true, SP_WA_NOTE: '', MDBX: { custom: [] },
    shpbEmbVendors: () => [{ code: 'V1', desc: 'Made-up Embroidery' }], shpbEmbName: x => x.desc, shpbStages: () => ({ issW: 4 }), SHPB_EMB_TYPE: 'Embroidery vendor', shpbToday: () => '2026-11-26',
    ptConsumeZippers: async () => { sent.zip++; return ''; }, ptConsumeRuffle: async () => '', bdCustomMaster: async () => '', bdClearForm: nothing, renderPbase: nothing,
  };
  vm.createContext(ctx);
  vm.runInContext(DATE_RULE + '\n' + CODE, ctx);
  if (!o.behind) ctx.PT.base = ctx.ptList(db.get('pt_baseData'));
  const fill = pcs => Object.entries({ bwType: 'Karigar', bwEmp: 'Made-up Karigar', bwSku: SKU, bwOrd: 'OC-1', bwPcs: String(pcs), bwAt: 'Cover', bwSub: 'Plain', bwCol: 'Red', bwSz: '16x16', bwRemarks: '' })
    .forEach(([id, v]) => { box(id).value = v; });
  const orderConsole = (pcs, extra) => ctx.spIssueReal('OC-1', SKU, 'Karigar', 'Made-up Karigar', String(pcs), '2026-11-26', '', extra || '');
  const vendor = pcs => ctx.shpbIssueVendorSave({ orderNo: 'OC-1', sku: SKU }, { ven: 'Made-up Embroidery', pcs: String(pcs) });
  return { ctx, sent, box, fill, orderConsole, vendor, press: async () => { await box('bwSave').onclick(); return box('bwMsg').textContent; } };
}

(async () => {
  console.log('== two screens, the same cut pieces ==');
  { const db = database(), a = screen(db, { slow: true }), b = screen(db, { slow: true });
    a.fill(4); b.fill(4);
    const [x, y] = await Promise.all([a.press(), b.press()]);
    ok('pressed together: one issue', db.entries().length === 1, db.entries().length + ' issues');
    ok('…one is told issued, the other that somebody is saving this line', [x, y].filter(s => /^Issued/.test(s)).length === 1 && [x, y].some(s => /somebody else is saving/.test(s)), x + ' | ' + y);
    ok('…no hold left behind, and the refused screen can press again', db.holds().length === 0 && b.box('bwSave').disabled === false); }
  { const db = database(), a = screen(db), b = screen(db, { behind: true });
    a.fill(4); await a.press(); b.fill(1);
    const said = await b.press();
    ok('the second screen has not received the first issue yet: refused on what the database holds', db.entries().length === 1 && /already issued 4/.test(said), said);
    ok('…no WhatsApp and no zippers for the refused issue', b.sent.wa === 0 && b.sent.zip === 0); }
  { const db = database(), a = screen(db); db.refuse.query = true; a.fill(1);
    const said = await a.press();
    ok('the issues cannot be checked: nothing saved, says why, line let go', db.entries().length === 0 && /could not be checked/.test(said) && db.holds().length === 0, said); }
  { const db = database(), a = screen(db); db.at[HOLD] = { by: 'x@test', form: 'other', at: Date.now() - MIN }; a.fill(1);
    const said = await a.press();
    ok('a line held by another screen: nothing saved, their hold stays', db.entries().length === 0 && db.at[HOLD].form === 'other' && /somebody else/.test(said), said); }

  console.log('== Save pressed again ==');
  { const db = database(), a = screen(db, { lost: true, arrives: true }); a.fill(4);   // all 4 cut pieces: the order is full after the first
    const first = await a.press(), second = await a.press();
    ok('the issue arrived but was reported failed; pressed again: told issued, still one issue (not refused as over the limit)', /Not saved/.test(first) && /^Issued/.test(second) && db.entries().length === 1, db.entries().length + ' ' + first + ' | ' + second);
    ok('…WhatsApp and zippers once, for the press that was told issued', a.sent.wa === 1 && a.sent.zip === 1, JSON.stringify(a.sent)); }
  { const opts = { lost: true, arrives: true }, db = database(), a = screen(db, opts); a.fill(1);
    await a.press(); opts.later = 11 * MIN; await a.press();
    ok('the same figures 11 minutes later are a second issue', db.entries().length === 2, String(db.entries().length)); }
  { const db = database(), a = screen(db); a.fill(1); await a.press(); a.fill(1); await a.press();
    ok('the same figures again after a good save are a second issue', db.entries().length === 2); }

  console.log('== the order screens: Order Console issue and SHP board issue to an embroidery vendor ==');
  { const db = database(), a = screen(db), b = screen(db, { behind: true }), c = screen(db, { behind: true });
    const first = await a.orderConsole(4), second = await b.orderConsole(1), third = await c.vendor(1);
    ok('a second screen, not yet told of the first issue, is refused on what the database holds', first === '' && /already issued 4/.test(second) && /already issued 4/.test(third) && db.entries().length === 1, [first, second, third].join(' | ')); }
  { const db = database(), a = screen(db, { slow: true }), b = screen(db);
    a.fill(4); const [x, y] = await Promise.all([a.press(), b.vendor(4)]);
    ok('the issue form and the SHP board at once: one issue', db.entries().length === 1, x + ' | ' + y); }
  { const db = database(), a = screen(db, { lost: true, arrives: true });
    const first = await a.orderConsole(4), again = await a.orderConsole(4);
    ok('an Order Console issue retried after a lost answer: one issue, told saved', /Not saved/.test(first) && again === '' && db.entries().length === 1, db.entries().length + ' ' + first + ' | ' + again); }
  { const db = database(), a = screen(db, { lost: true, arrives: true });
    await a.vendor(2); const again = await a.vendor(2);
    ok('an SHP board vendor issue retried after a lost answer: one issue', again === '' && db.entries().length === 1, String(db.entries().length)); }
  { const db = database(), a = screen(db, { cut: 8 }); await a.orderConsole(4);   // 8 cut for an order of 4
    const said = await a.orderConsole(1, 'damaged piece');
    ok('an extra issue with its reason still passes the ordered quantity under the hold', said === '' && db.entries().length === 2, said); }
  { const db = database(), a = screen(db); db.at[HOLD] = { by: 'x@test', form: 'other', at: Date.now() };
    const said = await a.vendor(1);
    ok('a held line: the SHP board says so and writes nothing', /somebody else/.test(said) && db.entries().length === 0, said); }

  console.log('== switch off ==');
  { const db = database(), a = screen(db, { off: true, lost: true, arrives: true });
    await a.orderConsole(1); await a.orderConsole(1); await a.vendor(1); await a.vendor(1);
    ok('order screens: saved as they always were, a new entry each time', db.entries().length === 4, String(db.entries().length)); }
  { const db = database(), a = screen(db, { off: true, lost: true, arrives: true }); db.at[HOLD] = { by: 'x@test', form: 'other', at: Date.now() };
    a.fill(1); await a.press(); await a.press();
    ok('saved as it always was: no hold asked for, a new entry each press', db.entries().length === 2, String(db.entries().length)); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
