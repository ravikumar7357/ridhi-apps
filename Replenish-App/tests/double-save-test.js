/* DOUBLE SAVING AND BAD FILE ROWS (28 Nov 2026, order-to-shipping test): one packing list finished on two screens wrote the stock
 * out twice; a double click made two purchase orders; the same packing file went in twice; minus figures and a blank box number
 * were accepted from a file.
 *   node tests/double-save-test.js      (APP_DIR=<a broken or older copy of src/app> for the teeth check) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : path.join(__dirname, '..', 'src', 'app');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
/* from the start of `a` to the end of the next `b` */
const cut = (src, a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('not found: ' + a); return src.slice(i, src.indexOf(b, i) + b.length); };

/* one database shared by two screens */
function screen(db, o = {}) {
  const src = read('replenishment/pack-core.js');
  const code = src.slice(0, src.indexOf('if (typeof module')) + src.slice(src.indexOf('function packScanNew('), src.indexOf('function packOrderLines('))
    + src.slice(src.indexOf('function packMarkDone('));
  const ctx = { ME: { email: o.who || 'a@test' }, FGI: { rows: [] }, FGI_FBA_ACCOUNTS: ['Ridhi FBA'], FGI_NO_ENTRY: 'no',
    fgiCanEntry: () => true, packDataReady: async () => '', fgiStockReread: async () => '', fgiOutAlloc: () => ({ orders: [] }),
    fgiOutCheck: () => '', fgiOf: () => ({ current: 100 }), fbaBadge() {}, fgiOverBadge() {}, lstAlertFor: async () => '',
    ptGet: async p => { if (o.offline) throw new Error('offline'); return db[p] || null; },
    ptPatch: async patch => { Object.assign(db, patch); db.writes = (db.writes || 0) + 1; }, console,
    shpHoldKey: k => String(k).toUpperCase().replace(/[.#$\[\]\/]/g, '_'), fapIdOf: (id, sku) => 'FBAR-' + id + '-' + sku,
    fapOn: () => !!o.approved, fapReread: async () => '', fapApproved: (id, sku) => sku === o.approved,
    fapGate: async rows => ({ send: rows.filter(r => r.sku !== o.approved), extra: {}, held: [], written: rows.filter(r => r.sku === o.approved).map(r => ({ _id: 'FBAR-PK1-' + r.sku })) }),
    db: 0, doc: () => 0, getDoc: async () => ({ exists: () => !!o.saved, data: () => o.saved }) };
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.finish = packLedgerWrite;', ctx);
  return ctx;
}
const list = (qty = 3) => ({ id: 'PK1', date: '2026-11-28', account: 'Ridhi FBA', boxes: [{ n: 1, items: [{ sku: 'AB.C/1', qty }] }], scan: { orders: [], plan: [], planNo: '', packed: {} } });
const rowsIn = db => Object.keys(db).filter(k => k.startsWith('pt_fgiLedger/'));

(async () => {
  console.log('== one packing list, two screens ==');
  { const db = {}, a = screen(db), b = screen(db, { who: 'b@test' });
    await a.finish(list(), '');
    const second = list(), r = await b.finish(second, '');
    ok('the second Finish writes nothing', db.writes === 1 && rowsIn(db).length === 1, JSON.stringify(Object.keys(db)));
    ok('the same list is marked finished there too', r.already === true && second.scan.done && second.scan.ledgerIds.length === 1, JSON.stringify(r));
    const other = list(5), r2 = await b.finish(other, '');
    ok('other quantities are refused and say who finished it', /already finished by a@test/.test(r2.err || '') && !other.scan.done && db.writes === 1, JSON.stringify(r2)); }
  { const db = {}, a = screen(db), b = screen(db, { saved: { scan: { ledgerIds: ['x'] } } });
    await a.finish(list(), '');
    const old = list(), r = await b.finish(old, '');
    ok('a list another screen saved as finished is not covered by an older copy', /finished on another screen/.test(r.err || '') && !old.scan.done, JSON.stringify(r)); }
  { const db = {}, two = () => { const l = list(); l.boxes[0].items.push({ sku: 'DONE-1', qty: 1 }); return l; };
    await screen(db, { approved: 'DONE-1' }).finish(two(), '');
    const again = two(); await screen(db, { approved: 'DONE-1' }).finish(again, '');
    ok('finished again with an approved SKU: each is remembered under its own row', again.scan.ledgerIds.join() === 'FBA-PK1-AB_C_1,FBAR-PK1-DONE-1', String(again.scan.ledgerIds)); }
  { const db = {}, a = screen(db), b = screen(db);
    await Promise.all([a.finish(list(), ''), b.finish(list(), '')]);
    ok('even at the very same moment there is one row', rowsIn(db).length === 1, JSON.stringify(rowsIn(db)));
    ok('the row\'s name is safe for the database', !/[.#$\[\]]/.test(rowsIn(db)[0].split('/')[1]) && rowsIn(db)[0].split('/').length === 2); }
  { const db = {}, a = screen(db, { offline: true }), r = await a.finish(list(), '');
    ok('when the check cannot be read, nothing is saved and it says so', /could not check/.test(r.err || '') && !db.writes); }

  console.log('== bad rows in a packing file ==');
  { const ctx = {}; vm.createContext(ctx);
    vm.runInContext(cut(read('replenishment/packing-list-labels.js'), 'function pkRowWrong(', '\n}\n') + 'this.w = pkRowWrong;', ctx);
    ok('minus quantity, part pieces, blank box and minus sizes are named', /below 0/.test(ctx.w(-5, '1', [])) && /whole/.test(ctx.w(2.5, '1', []))
      && ctx.w(2, '', []) === 'no box number' && ctx.w(2, '1', ['L', 'gross']) === 'L, gross below 0');
    ok('a good row passes', ctx.w(2, '1', []) === ''); }

  console.log('== the same file twice ==');
  { const src = read('replenishment/fba-box-template.js');
    const run = async (saved, answer) => { const asked = [];
      const ctx = { PK: saved, confirm: t => { asked.push(t); return answer; }, ptNumBig: n => (n > 1500 ? 'big ' + n : '') };
      vm.createContext(ctx); vm.runInContext(cut(src, 'async function pkSaveWanted(', '\n}\n') + 'this.f = pkSaveWanted;', ctx);
      return { yes: await ctx.f({ source: 'a.xlsx', invoice: 'INV1', boxes: [{ items: [{ qty: 2, sku: 'A' }] }] }), asked }; };
    const dup = await run([{ source: 'a.xlsx', invoice: 'INV1', title: 'a', date: '2026-11-28' }], false);
    ok('the same file and invoice asks, and Cancel saves nothing', dup.yes === false && /already saved/.test(dup.asked[0] || ''));
    const fresh = await run([{ source: 'a.xlsx', invoice: 'OTHER' }], false);
    ok('another invoice saves without a question', fresh.yes === true && !fresh.asked.length);
    { const asked = [], ctx = { PK: [], confirm: x => { asked.push(x); return false; }, ptNumBig: n => (n > 1500 ? 'big ' + n : '') };
      vm.createContext(ctx); vm.runInContext(cut(src, 'async function pkSaveWanted(', '\n}\n') + 'this.f = pkSaveWanted;', ctx);
      ok('a very large line asks, and Cancel saves nothing', await ctx.f({ source: 'b', invoice: '', boxes: [{ items: [{ qty: 2000, sku: 'A' }] }] }) === false && asked[0] === 'big 2000'); }
    ok('the question comes before anything is written', /if \(!\(await pkSaveWanted\(p\)\)\)[\s\S]*savePkWt\(learn\)[\s\S]*await savePkOne\(p\)/.test(src)); }

  console.log('== purchase orders ==');
  { const src = read('replenishment/purchase-orders.js');
    const run = async fields => { const seen = { added: 0, off: [] }, els = {};
      const el = id => els[id] || (els[id] = { value: fields[id] || '', textContent: '', classList: { add() {}, remove() {} }, set disabled(v) { seen.off.push(v); } });
      let release; const slow = new Promise(r => { release = r; });
      const ctx = { $: el, PM_LINES: [{ sku: 'A' }], PO_EDIT: null, ME: {}, db: 0, serverTimestamp() {}, lAir: () => 1, lSea: () => 0, lTot: () => 1, collection() {},
        addDoc: async () => { seen.added++; await slow; return {}; }, ensurePo: async () => {}, poMsg() {}, setTimeout() {}, PO_LOADED: true,
        ptDateOrderErr: s => (s[1][1] && s[1][1] < s[0][1] ? 'Delivery before order' : '') };
      vm.createContext(ctx); vm.runInContext(cut(src, "$('pmSave').onclick", '\n};\n'), ctx);
      const done = els.pmSave.onclick(); release(); await done;
      return { seen, err: el('pmErr').textContent }; };
    const good = await run({ pmSupplier: 'S', pmOrderDate: '2026-11-28', pmEta: '2026-12-01' });
    ok('Save is switched off while saving, and on again after', good.seen.added === 1 && good.seen.off.join() === 'true,false', JSON.stringify(good.seen));
    const late = await run({ pmSupplier: 'S', pmOrderDate: '2026-11-28', pmEta: '2026-11-01' });
    ok('a delivery date before the order date is refused', late.seen.added === 0 && /before/.test(late.err));
    const add = (sku, air, sea, answer) => { const seen = { popped: 0, asked: 0 }, els = { pmAddSku: { value: sku }, pmAddAir: { value: air }, pmAddSea: { value: sea }, pmBrand: { value: 'SP' } };
      const ctx = { $: id => els[id] || (els[id] = {}), PM_LINES: [], REPL: { SP: { rows: [{ sku: 'LISTED' }] } }, obUC: x => String(x).toUpperCase(), mdbOf: () => null, mdbIndex: () => new Map([[1, 1]]),
        wpShow: () => { seen.popped++; }, confirm: () => { seen.asked++; return answer; }, skuInfo: () => ({}), renderPmLines() {}, console };
      vm.createContext(ctx); vm.runInContext(cut(src, "$('pmAddLine').onclick", '\n};\n') + cut(src, 'function poSkuWanted(', '\n}\n'), ctx);
      els.pmAddLine.onclick(); return Object.assign(seen, { lines: ctx.PM_LINES.length }); };
    const minus = add('LISTED', '-5', '0'), mixed = add('LISTED', '-5', '10'), listed = add('LISTED', '1', '0'), no = add('NEW', '1', '0', false), yes = add('NEW', '1', '0', true);
    ok('a minus line is refused with a message, alone or beside a good figure', minus.popped === 1 && !minus.lines && mixed.popped === 1 && !mixed.lines);
    ok('a listed SKU is added without a question', listed.lines === 1 && !listed.asked);
    ok('an unknown SKU asks: Cancel adds nothing, OK adds it', no.asked === 1 && !no.lines && yes.lines === 1); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
