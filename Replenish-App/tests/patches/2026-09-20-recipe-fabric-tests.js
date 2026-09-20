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

one('pdIso, ordDueIndex, ordProdRows,', 'pdIso, ordDueIndex, ordProdRows, RECIPE_FAB, recipeEdit, recipeXlsx, recipeSheetHead,', 'exports');

one(`  const list = A.cutFabrics();`,
`  /* ================= THE CLOTH IS PART OF THE RECIPE =================
   *
   * 212 of 321 combinations use one fabric across every colour, and those were being retyped for each
   * new colour. 46 use two or more — those must not be guessed at, and are not. */
  {
    const wasM2 = A.PTG().masters, wasMdb2 = A.PTG().mdb;
    const masters = f => Object.assign({}, wasM2, {
      fabricType: { a: { code: 'SHEETING 62', desc: 'Sheeting 62', active: true },
        b: { code: 'SHEETING 82', desc: 'Sheeting 82', active: true },
        c: { code: 'CHAMBRAY', desc: 'Chambray', active: true } },
      recipe: f });
    /* One combination, two colours, ONE cloth — the 212 case. */
    const SK = [
      { sku: 'RF-1', articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60x60', color: 'Blue',
        fabric: 'Sheeting 62', packOf: 1, consumption: 1.6, cuttingRequired: true },
      { sku: 'RF-2', articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60x60', color: 'Red',
        fabric: 'Sheeting 62', packOf: 1, consumption: 1.6, cuttingRequired: true },
    ];
    A.setPTG(Object.assign({}, A.PTG(), { mdb: SK, masters: masters({}) }));

    ok('Fabric is one of the fields a recipe holds',
       A.RECIPE_FIELDS.some(f => f[0] === 'fabric'), A.RECIPE_FIELDS.map(f => f[0]).join(','));
    ok('…and it is a picked one, not a typed one', A.RECIPE_FAB.indexOf('fabric') >= 0, A.RECIPE_FAB.join(','));
    ok('…and the ruffle cloth is picked the same way', A.RECIPE_FAB.indexOf('ruffleFabric') >= 0, A.RECIPE_FAB.join(','));
    ok('…and the template has a column for it', A.recipeSheetHead().indexOf('Fabric') >= 0,
       A.recipeSheetHead().slice(0, 8).join(' | '));
    ok('…with its read-only twin beside the rest',
       A.recipeSheetHead().indexOf('SKUs say: Fabric') > A.recipeSheetHead().indexOf('Fabric'),
       A.recipeSheetHead().join(' | ').slice(0, 200));

    /* ---- SEEDING: agreement is filled, disagreement is a question ---- */
    let plan = A.recipeSeedPlan();
    ok('a combination whose colours all use one cloth is filled in from them',
       (plan.rows[0] || {}).rec.fabric === 'Sheeting 62', JSON.stringify((plan.rows[0] || {}).rec));
    ok('…and nothing about it is skipped',
       !plan.skipped.some(x => x.field === 'fabric'), JSON.stringify(plan.skipped));

    /* THE 46 CASE. Piping pillow covers 20x20 are Chambray on some colours and Sheeting 82 on others.
     * Forty-two against one is not a majority to this — it is a question for Ravi. */
    A.setPTG(Object.assign({}, A.PTG(), { mdb: [
      Object.assign({}, SK[0], { sku: 'RF-3', fabric: 'Chambray' }),
      Object.assign({}, SK[1], { sku: 'RF-4', fabric: 'Sheeting 82' }),
      Object.assign({}, SK[1], { sku: 'RF-5', color: 'Green', fabric: 'Sheeting 82' })] }));
    plan = A.recipeSeedPlan();
    ok('a combination whose colours use different cloth is NOT decided for you',
       !plan.rows.some(r => r.rec.fabric), JSON.stringify(plan.rows.map(r => r.rec.fabric)));
    ok('…it is put on the list of things to answer',
       plan.skipped.some(x => x.field === 'fabric'), JSON.stringify(plan.skipped.map(x => x.field)));
    ok('…with both spellings and how many SKUs say each',
       (plan.skipped.find(x => x.field === 'fabric') || { values: [] }).values.map(v => v.value).sort().join(',')
         === 'Chambray,Sheeting 82',
       JSON.stringify((plan.skipped.find(x => x.field === 'fabric') || {}).values));

    /* ---- A RECIPE IS A DEFAULT, NEVER AN OVERRIDE ---- */
    A.setPTG(Object.assign({}, A.PTG(), { mdb: SK, masters: masters({
      r1: { articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60x60', fabric: 'Sheeting 62' } }) }));
    ok('a new colour of that combination inherits the cloth',
       A.recipeFill({ sku: 'RF-9', articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60x60',
         color: 'Green' }).rec.fabric === 'Sheeting 62',
       JSON.stringify(A.recipeFill({ sku: 'RF-9', articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60x60' }).rec));
    ok('…and the screen says the cloth came from the recipe',
       A.recipeFill({ sku: 'RF-9', articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60x60' }).from.indexOf('fabric') >= 0,
       A.recipeFill({ sku: 'RF-9', articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60x60' }).from.join(','));
    /* THIS IS THE ONE THAT MATTERS for the 46: somebody who names the cloth keeps it. */
    ok('but a SKU that names its own cloth keeps it',
       A.recipeFill({ sku: 'RF-9', articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60x60',
         fabric: 'Chambray' }).rec.fabric === 'Chambray',
       A.recipeFill({ sku: 'RF-9', articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60x60', fabric: 'Chambray' }).rec.fabric);
    ok('…and recipeValue answers with the SKU, not the recipe',
       A.recipeValue({ articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60x60', fabric: 'Chambray' }, 'fabric') === 'Chambray'
       && A.recipeValue({ articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '60x60' }, 'fabric') === 'Sheeting 62');

    /* ---- AND NOTHING CAN INVENT A FABRIC THROUGH THE SHEET ---- */
    const up = v => A.recipeUploadPlan([{ articleType: 'Tablecloth', subtype: 'Square Tablecloth',
      size: '60x60', row: 2, vals: { fabric: v } }]);
    ok('a spelling the Fabric Type master does not have is refused',
       up('Sheeitng 112').skip.length === 1 && /not in the Fabric Type master/.test(up('Sheeitng 112').skip[0].why),
       JSON.stringify(up('Sheeitng 112').skip));
    ok('…and nothing is written for that row',
       !up('Sheeitng 112').set.length && !up('Sheeitng 112').change.length);
    ok('a fabric the master does have is accepted',
       up('Chambray').change.length === 1 && up('Chambray').change[0].to === 'Chambray',
       JSON.stringify(up('Chambray')));
    /* …AND THE MASTER'S OWN SPELLING IS WHAT LANDS, not whatever case the sheet was typed in. */
    ok('…in the master\\u2019s spelling, whatever case the sheet used',
       up('chambray').change.length === 1 && up('chambray').change[0].to === 'Chambray',
       JSON.stringify(up('chambray').change));

    /* ---- the workbook ---- */
    const xl = A.recipeXlsx(A.recipeSheetRows());
    ok('the workbook is written and is not empty', xl && xl.length > 500, String(xl && xl.length));

    A.setPTG(Object.assign({}, A.PTG(), { masters: wasM2, mdb: wasMdb2 }));
  }

  const list = A.cutFabrics();`, 'the recipe-fabric tests');

fs.writeFileSync(T, t);
console.log('written');
