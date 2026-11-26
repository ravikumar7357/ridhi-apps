/* THE GREIGE DESK IS NEVER WRITTEN WHOLE (src/app/flow/greige-desk.js — gdLoad, gdSeed).
 * pt_gdTest holds the real greige POs and movements (since 15 Oct). Ravi, 26 Nov: a screen that wrote its whole copy of the desk
 * could replace what another PC had saved. Now only an empty desk is given its starting lists, checked and written in one step,
 * and the "reset to sample" and "clear all" leftovers are gone. Cases are made up.
 *   node tests/greige-seed-test.js      (GD_FILE=<a copy of greige-desk.js> tests that copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.env.GD_FILE || path.join(__dirname, '..', 'src', 'app', 'flow', 'greige-desk.js');
const SRC = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
function cut(re) { const i = SRC.search(re); if (i < 0) throw new Error(re + ' not found'); return SRC.slice(i, SRC.indexOf('\n}', i) + 2); }
const CODE = ['var GD_NODE = \'pt_gdTest\', GD_SNAP = null, GD_READY = null, GD_STATE = \'\', DB = null;',
  cut(/^async function gdSeed\(/m), cut(/^function gdLoad\(/m), cut(/^function gdFromStore\(/m)].join('\n');
const MASTERS = { mst: [{ name: 'Made-up Voil' }], ven: [{ name: 'Made-up Mill' }], co: { name: 'Made-up Co' } };

/** One PC opening the desk. db: { node, reads: [], otherSeedsFirst, readFails } */
function desk(db) {
  const writes = [];
  const ctx = {
    console, Promise, JSON, Object, Array, String,
    ptGet: async () => { if (db.readFails) throw new Error('read 503'); return db.reads.length ? db.reads.shift() : JSON.parse(JSON.stringify(db.node)); },
    ptCas: async (p, expect, next) => {
      if (db.otherSeedsFirst) { db.node = db.otherSeedsFirst; db.otherSeedsFirst = null; }
      if (JSON.stringify(db.node == null ? null : db.node) !== JSON.stringify(expect)) return 'changed';
      writes.push(['cas', p, next]); db.node = JSON.parse(JSON.stringify(next)); return '';
    },
    ptPut: async (p, v) => { writes.push(['put', p, v]); db.node = v; },
    gdSeedMasters: () => JSON.parse(JSON.stringify(MASTERS)), lmMigrate: () => {}, gdSnap: () => ({}),
  };
  vm.createContext(ctx);
  vm.runInContext(CODE + '\n;this.__ = { gdLoad, st: () => GD_STATE, db: () => DB };', ctx);
  return Object.assign(ctx.__, { writes });
}
const PO = { id: 'po1', poNo: 'RIDHI/PO/GREIG/001' };

(async () => {
  console.log('== an empty desk ==');
  { const db = { node: null, reads: [] }, D = desk(db); await D.gdLoad();
    ok('gets its starting lists, written once and only if still empty', D.st() === 'ok' && D.writes.length === 1 && D.writes[0][0] === 'cas' && D.writes[0][1] === 'pt_gdTest', JSON.stringify(D.writes));
    ok('…and opens on them', D.db().mst[0].name === 'Made-up Voil' && D.db().gpo.length === 0); }
  { const theirs = { mst: [{ name: 'Their Voil' }], gpo: { po1: PO } }, db = { node: null, reads: [null], otherSeedsFirst: theirs }, D = desk(db);
    await D.gdLoad();
    ok('another PC seeded it a moment earlier and saved a PO: nothing is written over it', D.writes.length === 0 && db.node.gpo.po1.poNo === PO.poNo, JSON.stringify(db.node));
    ok('…and this desk opens on what they saved', D.st() === 'ok' && D.db().gpo.length === 1 && D.db().mst[0].name === 'Their Voil'); }
  { const db = { node: { co: { name: 'Made-up Co' } }, reads: [] }, D = desk(db); await D.gdLoad();
    ok('a desk holding only its company details (lists still empty) opens, and nothing is written', D.st() === 'ok' && D.writes.length === 0, D.st()); }

  { const db = { node: null, reads: [null, null], otherSeedsFirst: { co: { name: 'Their Co' } } }, D = desk(db); await D.gdLoad();
    ok('another PC seeded it but its save has not reached this screen yet: nothing written, says to open again', D.writes.length === 0 && /open it again/.test(D.st()), D.st()); }

  console.log('== nothing is ever written whole ==');
  { const db = { node: { gpo: { po1: PO }, fab: {} }, reads: [] }, D = desk(db); await D.gdLoad();
    ok('a desk with POs opens and nothing is written on the way in', D.st() === 'ok' && D.writes.length === 0); }
  { const db = { node: null, reads: [], readFails: true }, D = desk(db); await D.gdLoad();
    ok('a failed read writes nothing and says why', D.writes.length === 0 && /^err: read 503/.test(D.st()), D.st()); }
  { const db = { node: 'not a desk', reads: [] }, D = desk(db); await D.gdLoad();
    ok('something there that is not a desk is never replaced', D.writes.length === 0 && /nothing was written/.test(D.st()), D.st()); }
  ok('no screen can write the whole store any more: no gdSaveAll, reset to sample or clear all', !/function (gdSaveAll|lmResetSample|gdClearAll)\(/.test(SRC) && !/ptPut\(GD_NODE,/.test(SRC));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
