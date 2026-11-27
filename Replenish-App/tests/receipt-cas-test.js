/* Job Work · a karigar receipt is written only if the row is still as it was read (src/app/production/whatsapp.js — bdSaveRow;
 * src/app/core/history.js — lineHoldOn, ptCas).
 * Ravi, 26 Nov, after the PPC test run on two screens saving at once: a second screen must be told, never write over the first.
 * The row was already read again just before the write (1 Oct); the instant between that read and the write was open. With the
 * switch "lineHold" on, the write is a compare-and-set (the database's ETag) on the row that was just read. Cases are made up.
 *   node tests/receipt-cas-test.js      (WHATSAPP=<file> to test another copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.env.WHATSAPP || path.join(__dirname, '..', 'src', 'app', 'production', 'whatsapp.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

const src = fs.readFileSync(FILE, 'utf8');
const a = src.indexOf('const BD_COUNTED'), b = src.indexOf('/* ---- Job Work: the parts of a row');
if (a < 0 || b < 0 || b < a) throw new Error('bdSaveRow block not found in whatsapp.js');
const BLOCK = src.slice(a, b);

/** A small database that answers like Firebase: a compare-and-set succeeds only if nothing was written since it was read. */
function world(o) {
  o = o || {};
  const db = { 'pt_baseData/r1': o.row || { id: 'r1', issuePieces: 10, receivedPieces: 0, rejectionPieces: 0, pendingPieces: 10, frozen: false } };
  const log = { cas: 0, put: 0, shown: 0, casArgs: null };
  const ctx = {
    PT: { base: [Object.assign({ _key: 'r1' }, db['pt_baseData/r1'])] }, BASE: { on: !!o.apart }, SP_QUIET: false, console, JSON, Object, String, Math,
    baseRoutePath: () => (o.apart ? { path: 'pt_baseDone/r1' } : null),
    lineHoldOn: () => !!o.on, nf: n => String(n), ptNum: v => +v || 0, renderPbase: () => { log.shown++; },
    ptGet: async p => JSON.parse(JSON.stringify(db[p] == null ? null : db[p])),
    ptGetFresh: async p => { if (o.readFails) throw new Error('read 500'); return JSON.parse(JSON.stringify(db[p] == null ? null : db[p])); },
    ptCas: async (p, expect, next) => {
      log.cas++; log.casArgs = { p, expect, next };
      if (o.race) { const r = o.race; o.race = null; r(db); }          // somebody else saves in the instant between our read and our write
      if (JSON.stringify(db[p]) !== JSON.stringify(expect)) return 'changed';
      db[p] = JSON.parse(JSON.stringify(next)); return '';
    },
    ptPut: async (p, v) => { log.put++; db[p] = JSON.parse(JSON.stringify(v)); },
  };
  vm.createContext(ctx);
  vm.runInContext(BLOCK + '\n;this.__t = { bdSaveRow, BdChangedError };', ctx);
  return { ctx, db, log, T: ctx.__t };
}
const rowOf = (o, extra) => Object.assign({ id: 'r1', _key: 'r1', issuePieces: 10, receivedPieces: 0, rejectionPieces: 0, pendingPieces: 10, frozen: false }, o, extra);
const recv = (n) => rowOf({ receivedPieces: n, pendingPieces: 10 - n });
const fails = async f => { try { await f(); return null; } catch (e) { return e; } };

(async () => {
  { const W = world({ on: false });
    await W.T.bdSaveRow(recv(4));
    ok('switch off: the receipt is written the old way (plain write, no compare-and-set)', W.log.put === 1 && W.log.cas === 0 && W.db['pt_baseData/r1'].receivedPieces === 4); }

  { const W = world({ on: true });
    await W.T.bdSaveRow(recv(4));
    ok('switch on, nobody else saving: written by compare-and-set against the row as just read', W.log.cas === 1 && W.log.put === 0 && W.db['pt_baseData/r1'].receivedPieces === 4
      && W.log.casArgs.expect.receivedPieces === 0 && !('_key' in W.log.casArgs.next)); }

  { const W = world({ on: true, race: db => { db['pt_baseData/r1'] = rowOf({ receivedPieces: 6, pendingPieces: 4 }); delete db['pt_baseData/r1']._key; } });
    const e = await fails(() => W.T.bdSaveRow(recv(4)));
    ok('two screens receive 4 and 6 in the same instant: the second is refused with the BdChangedError the screen already knows', e instanceof W.T.BdChangedError, String(e));
    ok('…the first screen\'s 6 stands in the database, nothing of ours was written', W.db['pt_baseData/r1'].receivedPieces === 6 && W.log.put === 0);
    ok('…the screen is shown their row (6 received) and says so', W.ctx.PT.base[0].receivedPieces === 6 && W.log.shown === 1 && /received is now 6/.test(e.message)); }

  { const W = world({ on: true, row: rowOf({ receivedPieces: 6, pendingPieces: 4 }) });
    W.ctx.PT.base = [rowOf()];                                           // this screen still shows 0 received
    const e = await fails(() => W.T.bdSaveRow(rowOf({ receivedPieces: 4, pendingPieces: 6 })));
    ok('a screen that is behind (saw 0, the row is at 6): refused before any write, as it always was', e instanceof W.T.BdChangedError && W.log.cas === 0 && W.log.put === 0); }

  { const W = world({ on: true, apart: true });
    await W.T.bdSaveRow(recv(4));
    ok('a completed row lives apart and keeps the plain path (its month\'s version moves with it)', W.log.put === 1 && W.log.cas === 0); }

  { const W = world({ on: true, readFails: true });
    await W.T.bdSaveRow(recv(4));
    ok('the read fails: the save is not blocked, it keeps the old plain write (it never stops a save on its own)', W.log.put === 1 && W.log.cas === 0 && W.db['pt_baseData/r1'].receivedPieces === 4); }

  { const W = world({ on: true });
    await W.T.bdSaveRow(recv(4));
    W.ctx.PT.base = [rowOf()];                                           // the answer was lost: the screen still shows 0 received
    const e = await fails(() => W.T.bdSaveRow(recv(4)));
    ok('the answer was lost and Save is pressed again: refused (the row already holds the 4), so no second receipt', e instanceof W.T.BdChangedError && W.db['pt_baseData/r1'].receivedPieces === 4 && W.log.cas === 1); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
