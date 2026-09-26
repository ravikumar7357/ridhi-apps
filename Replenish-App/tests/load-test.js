/* WHAT SIGN-IN READS, and what a Replenishment screen reads later — the snapshot loaders cut out of the page and run
 * against a counting Firestore. Ravi, 2026-09-26: "data bahut heavy ho gya h" — an admin's sign-in awaited the full
 * 8 MB snapshot and the 2.6 MB health read before the first screen. Run: node tests/load-test.js */
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..', 'public', 'index.html');
const src = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n');
const cut = name => {
  const m = src.match(new RegExp('^(async )?function ' + name + '\\(', 'm'));
  if (!m) throw new Error(name + ' is not in the page');
  const end = src.indexOf('\n}', m.index);
  return src.slice(m.index, end + 2);
};
const line = re => { const m = src.match(re); if (!m) throw new Error(re + ' is not in the page'); return m[0]; };
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); } };

/* the fake Firestore: every read counted by collection */
const READS = [];
const doc = (_db, col, id) => ({ col, id });
const DOCS = {
  'repl/SP': { chunks: 2, at: null, recCols: ['a'], catalogSkus: ['X'] }, 'replrows/SP_0': { r: [{ sku: 'A1', last90: 5, monthlyAmt: 3, rec: {} }] }, 'replrows/SP_1': { r: [{ sku: 'A2', last90: 1 }] },
  'repl/CPC': { chunks: 1 }, 'replrows/CPC_0': { r: [{ sku: 'C1', last90: 2 }] },
  'replslim/SP': { chunks: 1, catalogSkus: ['X'] }, 'replslimrows/SP_0': { r: [{ sku: 'A1', totalStock: 4 }, { sku: 'A2' }] },
  'replslim/CPC': { chunks: 1 }, 'replslimrows/CPC_0': { r: [{ sku: 'C1' }] },
  'repl/prodstatus': { prodlog: {} },
  'health/SP': { chunks: 1 }, 'healthrows/SP_0': { r: [{ s: 'A1' }] }, 'health/CPC': { chunks: 0, rows: [] },
};
/* The slim rows answer SLOWER than the full ones here — the race that put slim rows on screen on 26 Sep. */
const getDoc = async d => { READS.push(d.col + '/' + d.id); if (d.col === 'replslimrows') await new Promise(r => setTimeout(r, 25)); const v = DOCS[d.col + '/' + d.id]; return { exists: () => !!v, data: () => v }; };
const reads = () => READS.map(r => r.split('/')[0]).filter((v, i, a) => a.indexOf(v) === i).join(',');

const body = [
  'let REPL = { SP: null, CPC: null }; let ACCESS_ERR = ""; let ME = { admin: true, tabs: [], email: "t@x" };',
  'let PROD = {}, PROD_LOADED = false, PROD_PROMISE = null, US_SKUS = new Set(), US_LOADED = false, US_PROMISE = null, US_AT = null, US_ERR = "";',
  'const skuKey = s => String(s || "").trim().toUpperCase(); const rMsg = () => {}; const renderRepl = () => { RENDERS++; }; let RENDERS = 0;',
  'const loadIndiaStock = async () => {}; const db = {}; const $ = () => null;',
  line(/^const REPL_FULL_TABS = .*$/m), line(/^const REPL_SLIM_FIELDS = .*$/m), line(/^const replFull = .*$/m), line(/^const replSlimRow = .*$/m),
  line(/^let REPL_MODE = .*$/m), cut('loadReplCache'), cut('loadReplCacheRun'), line(/^let REPL_LOADED = .*$/m),
  cut('ensureReplSlim'), cut('ensureReplData'), cut('ensureRepl'), cut('loadProd'), cut('fetchProd'), cut('loadUsSkus'),
].join('\n');
const make = () => new Function('doc', 'getDoc', body + '\n;return { ensureReplSlim, ensureReplData, ensureRepl, loadReplCache, REPL: () => REPL, mode: () => REPL_MODE, renders: () => RENDERS, ME: () => ME, slim: replSlimRow };')(doc, getDoc);

(async () => {
  console.log('== an admin signs in');
  let A = make(); READS.length = 0;
  await A.ensureReplSlim();
  ok('sign-in reads the SLIM snapshot and the production notes — not the full copy, not the health snapshot',
     !READS.some(r => /^replrows|^repl\/(SP|CPC)|^health/.test(r)) && READS.filter(r => r === 'repl/prodstatus').length === 1
     && READS.filter(r => r.startsWith('replslimrows')).length === 2, READS.join(' '));
  ok('…and the rows are there for the production screens', A.REPL().SP.rows.length === 2 && A.REPL().SP.rows[0].totalStock === 4 && A.mode() === 'slim');
  ok('…without drawing the Replenishment table', A.renders() === 0);
  READS.length = 0;
  await A.ensureReplSlim();
  ok('a second sign-in-style call reads nothing', READS.length === 0, READS.join(' '));

  console.log('== then opens a Replenishment screen');
  READS.length = 0;
  await A.ensureReplData();
  ok('the full copy is read now, once', reads() === 'repl,replrows' && READS.filter(r => r.startsWith('replrows')).length === 3, READS.join(' '));
  ok('…and replaces the slim rows', A.mode() === 'full' && A.REPL().SP.rows.length === 2 && A.REPL().SP.rows[0].last90 === 5 && A.REPL().SP.recCols.length === 1);
  READS.length = 0;
  await A.ensureRepl();
  ok('the Replenishment table then reads nothing more (renderRepl fetches the health set itself) and draws', READS.length === 0 && A.renders() === 1, READS.join(' '));
  READS.length = 0;
  await A.loadReplCache(false); await A.loadReplCache(true); await A.ensureReplData();
  ok('nothing is read twice', READS.length === 0, READS.join(' '));

  console.log('== the Replenishment tab straight after sign-in');
  A = make(); await A.ensureReplSlim(); READS.length = 0;
  await A.ensureRepl();
  ok('reads the full copy, then draws once — the health set is left to renderRepl itself', reads().split(',').sort().join(',') === 'repl,replrows' && A.renders() === 1 && A.mode() === 'full', READS.join(' '));

  console.log('== two screens ask at once');
  A = make(); READS.length = 0;
  await Promise.all([A.loadReplCache(true), A.loadReplCache(true), A.ensureReplSlim()]);
  ok('one read of the full copy serves them all', READS.filter(r => r === 'repl/SP').length === 1 && A.mode() === 'full', READS.join(' '));

  console.log('== the Replenishment tab is opened while the sign-in slim read is still in flight');
  A = make(); READS.length = 0;
  const slimP = A.ensureReplSlim();                 // sign-in, not awaited
  await A.ensureRepl();                             // the tab, straight away
  await slimP;
  ok('the full rows are what is on screen — the slower slim read did not land on top of them', A.mode() === 'full' && A.REPL().SP.rows[0].last90 === 5 && A.REPL().SP.mode === 'full', A.mode() + ' ' + JSON.stringify(A.REPL().SP.rows[0]));

  console.log('== a team member who may not see the full copy');
  A = make(); A.ME().admin = false; A.ME().tabs = ['cut', 'fgi']; READS.length = 0;
  await A.ensureReplSlim(); await A.ensureReplData(); await A.ensureRepl();
  ok('asking for the full copy still reads only the slim one, once', !READS.some(r => /^repl\/(SP|CPC)|^replrows/.test(r)) && READS.filter(r => r === 'replslim/SP').length === 1, READS.join(' '));
  ok('a Replenishment-tab account is allowed the full copy', (() => { const B = make(); B.ME().admin = false; B.ME().tabs = ['repl']; return B; })().mode() === '' );

  console.log('== the slim copy carries what the production screens read');
  const s = A.slim({ sku: 'A', color: 'Red', size: '1', totalStock: 3, last90: 9, last30: 2, asin: 'B0X', parent: 'B0P', rec: { x: 1 }, inflow: {}, monthlyAmt: 5 });
  ok('colour, size, FBA stock, sales and the Amazon ids — not the recommendation or the inflow', s.last90 === 9 && s.last30 === 2 && s.asin === 'B0X' && s.parent === 'B0P' && s.totalStock === 3 && !('rec' in s) && !('inflow' in s) && !('monthlyAmt' in s), JSON.stringify(s));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
