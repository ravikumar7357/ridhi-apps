/* Replenishment shows the Master Database's product details (18 Oct): replMasterSync in replenishment.js.
 * Run: node tests/repl-master-test.js */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/app/replenishment/replenishment.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return src.slice(i, j); };
const code = cut('let REPL_MDB_IX', 'async function saveReplCache');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? '   ' + info : '')); } };
function load(mdbRows, replRows, opts) {
  opts = opts || {};
  const ctx = {
    PTG: { mdb: mdbRows }, REPL: { SP: { rows: replRows }, CPC: null }, REPL_SHOP: { SP: null, CPC: null }, REPL_MDB: opts.replMdb || null,
    obUC: s => String(s || '').trim().toUpperCase(),
    mdbOf: s => (mdbRows || []).find(r => String(r.sku).toUpperCase() === String(s).toUpperCase()),
    ptImgOf: s => (opts.img || {})[s] || '',
    REPL_STOP_RE: /discontinu|use ?in ?mix/i,
  };
  const api = new Function(...Object.keys(ctx), code + '\n;return { replMasterSync, replMasterRow };')(...Object.values(ctx));
  return Object.assign(api, { ctx });
}
console.log('== the master is the product detail ==');
{
  const snap = [{ sku: 'RPC72-2020', asin: 'B0D8SZWDH5', parent: 'B0DT6SGFCD', color: 'Asparagus Green', size: '20x20', subcat: 'Piping Flap Pillow Cover', image: 'https://amazon/old.jpg', fulfillable: 1691 },
    { sku: 'NOT-IN-MASTER', asin: 'B0X', color: 'Red', image: 'https://amazon/x.jpg' }];
  const A = load([{ sku: 'RPC72-2020', asin: 'B0D8SZWDH5', parentAsin: 'B0PARENT72', color: 'Asparagus Green Paisley', size: '20x20', subtype: 'Piping Flap Pillow Cover', imageUrl: 'https://master/72.jpg' }], snap);
  ok('a change is reported', A.replMasterSync() === true);
  const r = A.ctx.REPL.SP.rows[0];
  ok('the master wins: Parent ASIN, colour, picture from the Master Database', r.parent === 'B0PARENT72' && r.color === 'Asparagus Green Paisley' && r.image === 'https://master/72.jpg', JSON.stringify(r));
  ok('…the figures stay the snapshot’s (FBA stock untouched)', r.fulfillable === 1691);
  ok('a SKU not in the master keeps the snapshot’s details', A.ctx.REPL.SP.rows[1].color === 'Red' && A.ctx.REPL.SP.rows[1].image === 'https://amazon/x.jpg');
  ok('the snapshot read is not changed (copies on screen, the original kept)', snap[0].parent === 'B0DT6SGFCD' && A.ctx.REPL.SP.rowsSnap === snap);
  ok('a second call with nothing new does nothing', A.replMasterSync() === false);
}
{
  const snap = [{ sku: 'S1', color: 'Blue', size: '18x18', subcat: 'Napkin', image: 'https://amazon/s1.jpg', asin: 'B01', parent: 'P01' }];
  const A = load([{ sku: 'S1', color: '', size: '', asin: '', parentAsin: '' }], snap, { img: { S1: 'https://shared/s1.jpg' } });
  A.replMasterSync();
  const r = A.ctx.REPL.SP.rows[0];
  ok('a field the master leaves blank keeps the snapshot’s (colour, size, ASINs)', r.color === 'Blue' && r.size === '18x18' && r.asin === 'B01' && r.parent === 'P01', JSON.stringify(r));
  ok('no master picture: the app’s own picture look-up for the SKU comes next', r.image === 'https://shared/s1.jpg');
}
{
  const A = load(null, [{ sku: 'S2', color: 'Old' }], { replMdb: [{ sku: 'S2', color: 'New' }] });
  A.replMasterSync();
  ok('an account whose sign-in did not read the master uses the copy this tab read (REPL_MDB)', A.ctx.REPL.SP.rows[0].color === 'New');
}
{ /* 25 Oct ("master data base me set karenge"): the India listing status comes from the master */
  const snap = [{ sku: 'D1', status: '', stopped: false }, { sku: 'L1', status: '', stopped: false }, { sku: 'W1', subcat: 'Women', status: 'Discontinued', stopped: true, stopReason: '"Women" is listed on Amazon but not stocked in India' }, { sku: 'N1' }];
  const A = load([{ sku: 'D1', listingStatus: 'Discontinue' }, { sku: 'L1', listingStatus: 'Listed' }, { sku: 'W1', listingStatus: 'Listed' }, { sku: 'N1' }], snap);
  A.replMasterSync();
  const [d, l, w, n] = A.ctx.REPL.SP.rows;
  ok('Discontinue in the master stops the SKU in Replenishment, saying where it came from', d.status === 'Discontinue' && d.stopped === true && /Master Database/.test(d.stopReason), JSON.stringify(d));
  ok('…Listed shows and does not stop it', l.status === 'Listed' && !l.stopped);
  ok('…a sub-category never stocked in India stays stopped, whatever the status', w.status === 'Listed' && w.stopped === true, JSON.stringify(w));
  ok('…no status in the master leaves the snapshot’s', n.status === undefined && !n.stopped);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
