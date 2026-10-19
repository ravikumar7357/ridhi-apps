/* THE GREIGE DESK NEVER WRITES OVER ITSELF AFTER A FAILED READ (16 Oct 2026).
 * gdLoad used to take a failed read of pt_gdTest as an empty desk and PUT the empty desk over the whole node.
 *   node tests/greige-load-test.js */
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..', 'tools', 'greige-desk');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' — ' + info : '')); } };

function desk(read) {
  const puts = [], patches = [];
  const ctx = { console, Date, JSON, Math, String, Number, Object, Array, isNaN, parseFloat, parseInt, RegExp, Error, Promise,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    window: {}, localStorage: { getItem: () => null, setItem() {} }, PTG: { masters: {} }, ME: { admin: true, tabs: [] },
    ptGet: async () => read(), ptPut: async (p, v) => { puts.push([p, v]); }, ptPatch: async p => { patches.push(p); },
    mstRows: () => [], ptList: x => Object.values(x || {}), lmSay: () => {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'core.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'app-layer.js'), 'utf8')
    + '\n;this.__ = { gdLoad, lmSaveDb, st: () => GD_STATE, db: () => DB, setDB: v => { DB = v; }, ready: () => GD_READY, shelf: n => gdRfdShelf(n) };', ctx);
  return Object.assign(ctx.__, { puts, patches });
}

(async () => {
  console.log('== a failed read writes nothing ==');
  {
    const D = desk(() => { throw new Error('The production database did not answer within 45 seconds.'); });
    await D.gdLoad();
    ok('nothing is written when the read failed', D.puts.length === 0 && D.patches.length === 0, JSON.stringify(D.puts.map(x => x[0])));
    ok('…the desk says it could not read', /^err: /.test(D.st()) && D.db() === null, D.st());
    ok('…and the next open asks again', D.ready() === null);
    D.setDB({ gpo: [], fab: [], mst: [], ven: [], co: {} }); D.lmSaveDb();
    ok('a save from a desk that was never read is refused', D.patches.length === 0);
  }
  console.log('== a read that answered ==');
  {
    const store = { co: { poPrefix: 'RIDHI/PO/GREIG/' }, mst: [], ven: [], fab: { f1: { id: 'f1', date: '2026-10-15', lot: 'LOT-007', fabricType: 'Voil 92', txnType: 'OPENING_RFD', qty: 8183 } } };
    const D = desk(() => store);
    await D.gdLoad();
    ok('the desk is what the database holds, and nothing is written on the way in', D.st() === 'ok' && D.shelf('Voil 92') === 8183 && D.puts.length === 0, D.st() + ' ' + D.shelf('Voil 92'));
  }
  {
    const D = desk(() => null);
    await D.gdLoad();
    ok('a database that answered "nothing here" is seeded and saved once', D.st() === 'ok' && D.puts.length === 1 && D.puts[0][0] === 'pt_gdTest');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
