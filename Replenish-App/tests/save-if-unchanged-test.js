/* A whole record is saved only if nobody changed it since the screen read it
 * (src/app/core/history.js — ptSaveIfUnchanged; src/app/vendors/greige/greige-po.js — gpoSave, gpoCancel;
 *  src/app/orders/reserve.js — voSetStatus).
 * Ravi, 26 Nov, "two users, one record": a whole-record save by a second person wrote over the first, including what a printer or a
 * receipt had added meanwhile. Switch "lineHold" on: the record is read from the database, refused if it is not what the screen holds,
 * and written by compare-and-set. Off, nothing changes. Cases are made up.
 *   node tests/save-if-unchanged-test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.join(__dirname, '..', 'src', 'app');
const HISTORY = process.env.HISTORY_FILE || path.join(APP, 'core', 'history.js');
const GREIGE = process.env.GREIGE_FILE || path.join(APP, 'vendors', 'greige', 'greige-po.js');
const RESERVE = process.env.RESERVE_FILE || path.join(APP, 'orders', 'reserve.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
/** The source of one function (or the one-line switch), cut out of a file as it stands. */
function cut(file, startRe, endMarker) {
  const s = fs.readFileSync(file, 'utf8'), i = s.search(startRe);
  if (i < 0) throw new Error(String(startRe) + ' not found in ' + path.basename(file));
  const j = s.indexOf(endMarker, i);
  if (j < 0) throw new Error(endMarker + ' not found after ' + String(startRe));
  return s.slice(i, j);
}
const HELPERS = cut(HISTORY, /function lineHoldOn\(\)/, '/** A single update touching many paths at once.');
const GPO = cut(GREIGE, /async function gpoSave\(v\)/, '/* ---- the document ---- */');
const VOS = cut(RESERVE, /async function voSetStatus\(key, status\)/, 'const voMoveLog =');

function world(o) {
  const db = { 'pt_greigePOs/g1': { id: 'g1', poNo: 'RHL-PO-001', status: 'open', received: 0, lines: [{ q: 100 }] }, 'pt_vendorOrders/V1/o1': { id: 'o1', orderNo: 'PO1', status: 'Placed', sent: 0 } };
  const log = { put: 0, cas: 0, patch: [] };
  const ctx = {
    console, JSON, Object, String, Date, Array, Promise,
    lineHoldOn: () => !!o.on, ptCanEdit: () => true, PT_NO_EDIT: 'no', ME: { email: 'a@x', admin: true }, nf: String,
    GPO: { rows: [Object.assign({ _key: 'g1' }, clone(db['pt_greigePOs/g1']))] }, VO: { rows: [Object.assign({ vendorCode: 'V1' }, clone(db['pt_vendorOrders/V1/o1']))] }, $: () => ({ className: '', textContent: '', title: '' }), renderVo() {},
    gpoPlan: v => ({ po: Object.assign({}, ctx.GPO.rows[0], v) }), gpoProgress: p => ({ received: p.received || 0 }),
    ptGetFresh: async p => { if (o.readFails) throw new Error('read 500'); return clone(db[p]); },
    ptPut: async (p, v) => { log.put++; db[p] = clone(v); },
    ptCas: async (p, expect, next) => { log.cas++; if (o.race) { const r = o.race; o.race = null; r(db); } if (JSON.stringify(db[p]) !== JSON.stringify(expect)) return 'changed'; db[p] = clone(next); return ''; },
    ptPatch: async u => { log.patch.push(u); Object.keys(u).forEach(k => { const [p, f] = [k.slice(0, k.lastIndexOf('/')), k.slice(k.lastIndexOf('/') + 1)]; db[p] = Object.assign({}, db[p], { [f]: u[k] }); }); },
  };
  vm.createContext(ctx);
  ctx.__on = !!o.on;
  vm.runInContext(HELPERS + '\n' + GPO + '\n' + VOS + '\nlineHoldOn = () => __on;   /* the test decides the switch, not storage */\n;this.__t = { ptSaveIfUnchanged, gpoSave, gpoCancel, voSetStatus };', ctx);
  return { ctx, db, log, T: ctx.__t };
}
const rec = (db, p) => clone(db[p]);

(async () => {
  /* the helper */
  { const W = world({ on: false });
    const r = await W.T.ptSaveIfUnchanged('pt_greigePOs/g1', { stale: true }, { id: 'g1', n: 1 });
    ok('switch off: a plain write, whatever the screen held', r === '' && W.log.put === 1 && W.log.cas === 0 && W.db['pt_greigePOs/g1'].n === 1); }
  { const W = world({ on: true }), seen = Object.assign({ _key: 'g1' }, rec(W.db, 'pt_greigePOs/g1'));
    const r = await W.T.ptSaveIfUnchanged('pt_greigePOs/g1', seen, { id: 'g1', n: 2 });
    ok('switch on, record as the screen holds it: written by compare-and-set (a screen\'s _key does not count)', r === '' && W.log.cas === 1 && W.log.put === 0 && W.db['pt_greigePOs/g1'].n === 2); }
  { const W = world({ on: true }), seen = rec(W.db, 'pt_greigePOs/g1'); W.db['pt_greigePOs/g1'].received = 40;
    const r = await W.T.ptSaveIfUnchanged('pt_greigePOs/g1', seen, { id: 'g1', n: 3 });
    ok('the record changed since the screen read it (40 received): refused, nothing written', r === 'changed' && W.log.cas === 0 && W.db['pt_greigePOs/g1'].received === 40 && !W.db['pt_greigePOs/g1'].n); }
  { const W = world({ on: true, race: db => { db['pt_greigePOs/g1'].received = 40; } }), seen = rec(W.db, 'pt_greigePOs/g1');
    const r = await W.T.ptSaveIfUnchanged('pt_greigePOs/g1', seen, { id: 'g1', n: 4 });
    ok('somebody saves in the instant between the read and the write: refused by the database, theirs stands', r === 'changed' && W.db['pt_greigePOs/g1'].received === 40 && !W.db['pt_greigePOs/g1'].n); }
  { const W = world({ on: true, readFails: true });
    const r = await W.T.ptSaveIfUnchanged('pt_greigePOs/g1', {}, { id: 'g1', n: 5 });
    ok('the read fails: the plain write, a save is never blocked by it', r === '' && W.log.put === 1 && W.db['pt_greigePOs/g1'].n === 5); }

  /* Greige PO */
  { const W = world({ on: true }); W.db['pt_greigePOs/g1'].received = 40;      // cloth came in on another PC
    const m = await W.T.gpoCancel('g1', 'not needed');
    ok('cancelling a PO that cloth has come in against on another PC: refused with a sentence, the PO stands', /changed by somebody else/.test(m) && W.db['pt_greigePOs/g1'].status === 'open', m); }
  { const W = world({ on: true });
    const m = await W.T.gpoCancel('g1', 'not needed');
    ok('cancelling an untouched PO works', m === '' && W.db['pt_greigePOs/g1'].status === 'cancelled'); }
  { const W = world({ on: true }); W.db['pt_greigePOs/g1'].terms = 'edited elsewhere';
    const m = await W.T.gpoSave({ id: 'g1', terms: 'mine' });
    ok('editing a PO somebody else edited: refused, theirs stands', /changed by somebody else/.test(m) && W.db['pt_greigePOs/g1'].terms === 'edited elsewhere', m); }
  { const W = world({ on: false }); W.db['pt_greigePOs/g1'].terms = 'edited elsewhere';
    const m = await W.T.gpoSave({ id: 'g1', terms: 'mine' });
    ok('switch off: as before, the edit is written', m === '' && W.db['pt_greigePOs/g1'].terms === 'mine'); }

  /* vendor order status */
  { const W = world({ on: true }); W.db['pt_vendorOrders/V1/o1'].sent = 60;       // the printer entered 60 on the portal
    const m = await W.T.voSetStatus('V1/o1', 'Cancelled');
    ok('changing a vendor order\'s status writes the status only — what the printer entered (sent 60) stays', m === '' && W.db['pt_vendorOrders/V1/o1'].status === 'Cancelled' && W.db['pt_vendorOrders/V1/o1'].sent === 60 && W.log.put === 0, m); }
  { const W = world({ on: false }); W.db['pt_vendorOrders/V1/o1'].sent = 60;
    await W.T.voSetStatus('V1/o1', 'Cancelled');
    ok('switch off: the whole order is written back as before (this is what wiped the printer\'s figures)', W.log.put === 1 && W.db['pt_vendorOrders/V1/o1'].sent === 0); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
