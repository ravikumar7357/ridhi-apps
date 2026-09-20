const fs = require('fs'), pathm = require('path');
const T = pathm.join(__dirname, '..', 'prod-test.js');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let t = fs.readFileSync(T, 'utf8');
const NL = t.indexOf(CR + LF) >= 0 ? CR + LF : LF;
const one = (a, b, n) => {
  const A = a.split(LF).join(NL), B = b.split(LF).join(NL);
  if (t.split(A).length !== 2) throw new Error('anchor not unique (' + (t.split(A).length - 1) + '): ' + n);
  t = t.replace(A, () => B);
  console.log('  ok   ' + n);
};

one('recipeUploadPlan, recipeUploadRun,', 'recipeUploadPlan, recipeUploadRun, mdbFields, fabListOr,', 'exports');

one(`  const list = A.cutFabrics();`,
`  /* ================= THE CLOTH IS PICKED FROM THE MASTER, NOT TYPED =================
   *
   * One live SKU says "Sheeitng 112" — a fabric with no master row, no width and no ledger. Cutting
   * has always refused a spelling the master does not have; the master database was where one could
   * still be invented. */
  {
    const wasM = A.PTG().masters;
    A.setPTG(Object.assign({}, A.PTG(), { masters: Object.assign({}, wasM, {
      fabricType: { a: { code: 'SHEETING 62', desc: 'Sheeting 62', active: true },
        b: { code: 'CAMBRIC', desc: 'Cambric', active: true, widthIn: 42 },
        c: { code: 'RETIRED', desc: 'Retired cloth', active: false } } }) }));
    const fieldOf = (rec, key) => (A.mdbFields(rec) || []).find(f => f.key === key) || {};
    const blank = fieldOf(null, 'fabric');
    ok('a new SKU picks its fabric from a list, it does not type one',
       blank.type === 'select', String(blank.type));
    ok('…and the list is the Fabric Type master',
       (blank.options || []).indexOf('Sheeting 62') > 0 && (blank.options || []).indexOf('Cambric') > 0,
       (blank.options || []).join(','));
    ok('…without the ones somebody switched off',
       (blank.options || []).indexOf('Retired cloth') < 0, (blank.options || []).join(','));
    ok('…and it starts blank rather than on whichever cloth happens to sort first',
       (blank.options || [])[0] === '' && !blank.value, JSON.stringify([blank.options && blank.options[0], blank.value]));
    /* WHAT THE ROW ALREADY SAYS IS NEVER TAKEN AWAY FROM IT. A bad spelling must stay visible and
     * fixable — silently swapping it for a valid one would change what a SKU is made of. */
    const bad = fieldOf({ sku: 'X-1', fabric: 'Sheeitng 112' }, 'fabric');
    ok('a SKU whose spelling is not in the master keeps it',
       bad.value === 'Sheeitng 112' && (bad.options || []).indexOf('Sheeitng 112') >= 0, (bad.options || []).join(','));
    ok('…and the real fabrics are still offered beside it',
       (bad.options || []).indexOf('Sheeting 62') >= 0, (bad.options || []).join(','));
    ok('…and it is not offered twice',
       (A.fabListOr('Sheeting 62') || []).filter(x => x === 'Sheeting 62').length === 1,
       A.fabListOr('Sheeting 62').join(','));
    /* The ruffle cloth is written straight onto the fabric ledger, so it is picked too. */
    const ruf = fieldOf({ sku: 'X-1', ruffleFabric: 'Cambric' }, 'ruffleFabric');
    ok('the ruffle cloth is picked from the same master', ruf.type === 'select' && ruf.value === 'Cambric',
       String(ruf.type) + ' ' + String(ruf.value));
    /* AND THE COLOUR-BEARING FIELDS ARE UNTOUCHED — this changed two fields, not the form. */
    ok('the rest of the form is as it was',
       fieldOf(null, 'consumption').type === 'number' && fieldOf(null, 'cuttingRequired').type === 'select'
       && (A.mdbFields(null) || []).length === 20, String((A.mdbFields(null) || []).length) + ' fields');
    A.setPTG(Object.assign({}, A.PTG(), { masters: wasM }));
  }

  const list = A.cutFabrics();`, 'the fabric-picker tests');

fs.writeFileSync(T, t);
console.log('written');
