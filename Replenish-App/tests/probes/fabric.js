/* WHERE "WHICH FABRIC" IS ACTUALLY WRITTEN DOWN, AND WHETHER A RECIPE COULD HOLD IT. Read-only.
 *
 * The recipe sheet has no Fabric column. That is either a hole or a deliberate omission, and the
 * answer is in the data: a recipe is keyed by article + subtype + size and says nothing about colour,
 * so it can only hold a field that is the SAME for every colour of that combination. This asks, of
 * the live master: is `fabric` such a field, or does it change from colour to colour?
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(p + ': ' + d.slice(0, 120))); } }); }).on('error', rej));
  const list = o => (Array.isArray(o) ? o.map((v, i) => (v && typeof v === 'object' ? Object.assign({ _key: String(i) }, v) : v)) : Object.keys(o || {}).map(k => (o[k] && typeof o[k] === 'object' ? Object.assign({ _key: k }, o[k]) : o[k]))).filter(Boolean);
  const N = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
  const said = v => v !== undefined && v !== null && String(v).trim() !== '';
  const key = m => [N(m.articleType), N(m.subtype), N(m.size)].join(' | ');
  const H = t => console.log('\n== ' + t + ' ==');

  const [mdbR, mastersR] = await Promise.all(['pt_masterDB', 'pt_masters'].map(get));
  const mdb = list(mdbR);
  const recipes = list((mastersR || {}).recipe);
  const fabTypes = list((mastersR || {}).fabricType);

  H('1. THE MASTER DATABASE');
  console.log('SKUs                          : ' + mdb.length);
  console.log('…with a Fabric written on them: ' + mdb.filter(r => said(r.fabric)).length);
  console.log('…with Fabric blank            : ' + mdb.filter(r => !said(r.fabric)).length);
  const byFab = {};
  mdb.forEach(r => { const f = said(r.fabric) ? String(r.fabric).trim() : '(blank)'; byFab[f] = (byFab[f] || 0) + 1; });
  console.log('\nDistinct spellings, commonest first:');
  Object.entries(byFab).sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log('   ' + String(n).padStart(5) + '  ' + f));

  H('2. THE FABRIC TYPE MASTER (what Cutting is allowed to pick, and where the WIDTH lives)');
  /* The master row carries `code` and `desc`; fabWidthIn matches on either, folded to lower case. */
  const known = new Map();
  fabTypes.forEach(f => [f.desc, f.code].forEach(x => { if (said(x)) known.set(N(x), f); }));
  console.log(fabTypes.length + ' entr(ies): ' + fabTypes.map(f => f.code).sort().join(' · '));
  const widthed = fabTypes.filter(f => parseFloat(f.widthIn) > 0);
  console.log('\n…that carry a width (widthIn): ' + widthed.length + ' of ' + fabTypes.length
    + '   → ' + (widthed.map(f => f.code + ' = ' + f.widthIn + '"').join(' · ') || 'none'));
  console.log('WITHOUT a width, voSqm() returns null — square metres cannot be worked out for that cloth.');
  const noW = mdb.filter(r => said(r.fabric) && !(parseFloat((known.get(N(r.fabric)) || {}).widthIn) > 0));
  console.log('SKUs whose fabric has no width on the master: ' + noW.length + ' of ' + mdb.filter(r => said(r.fabric)).length);
  const unknown = [...new Set(mdb.filter(r => said(r.fabric)).map(r => String(r.fabric).trim()))].filter(f => !known.has(N(f)));
  console.log('Spellings on SKUs the Fabric Type master does NOT have at all: ' + (unknown.length ? unknown.join(' · ') : 'none'));

  H('3. COULD A RECIPE HOLD THE FABRIC? (recipe = article | subtype | size, no colour)');
  const combos = new Map();
  mdb.forEach(r => { const k = key(r); if (!combos.has(k)) combos.set(k, []); combos.get(k).push(r); });
  let same = 0, varies = 0, silent = 0; const examples = [];
  combos.forEach((rows, k) => {
    const vals = [...new Set(rows.filter(r => said(r.fabric)).map(r => N(r.fabric)))];
    if (!vals.length) { silent++; return; }
    if (vals.length === 1) { same++; return; }
    varies++;
    if (examples.length < 12) examples.push([k, vals, rows.length]);
  });
  console.log('combinations (article|subtype|size)            : ' + combos.size);
  console.log('…where every SKU names the SAME fabric         : ' + same);
  console.log('…where the SKUs name DIFFERENT fabrics         : ' + varies + '   ← a recipe could not hold these');
  console.log('…where no SKU names a fabric at all            : ' + silent);
  if (examples.length) {
    console.log('\nCombinations whose colours use different cloth:');
    examples.forEach(([k, vals, n]) => console.log('   ' + k + '  (' + n + ' SKUs) → ' + vals.join(' / ')));
  }

  H('4. DOES FABRIC FOLLOW THE COLOUR? (same article+subtype+size, one fabric per colour?)');
  let colSame = 0, colVaries = 0; const colEx = [];
  combos.forEach((rows, k) => {
    const byCol = new Map();
    rows.filter(r => said(r.fabric)).forEach(r => { const c = N(r.color); if (!byCol.has(c)) byCol.set(c, new Set()); byCol.get(c).add(N(r.fabric)); });
    byCol.forEach((set, c) => {
      if (set.size === 1) colSame++;
      else { colVaries++; if (colEx.length < 8) colEx.push([k, c, [...set]]); }
    });
  });
  console.log('(combination, colour) pairs where the fabric is settled: ' + colSame);
  console.log('…where even one colour uses two fabrics                : ' + colVaries);
  colEx.forEach(([k, c, v]) => console.log('   ' + k + '  colour "' + c + '" → ' + v.join(' / ')));

  H('5. THE TWO FABRIC FIELDS A RECIPE DOES HOLD');
  console.log('recipes stored                        : ' + recipes.length);
  console.log('…that name a Ruffle fabric            : ' + recipes.filter(r => said(r.ruffleFabric)).length);
  console.log('…that answer Filler fabric yes/no     : ' + recipes.filter(r => said(r.fillerFabricRequired)).length
    + '   (yes: ' + recipes.filter(r => N(r.fillerFabricRequired) === 'yes').length + ')');
  console.log('SKUs that name a Ruffle fabric        : ' + mdb.filter(r => said(r.ruffleFabric)).length);
  console.log('SKUs marked "needs filler fabric"     : ' + mdb.filter(r => r.fillerFabricRequired === true).length
    + '   — and the number that say WHICH filler cloth: ' + mdb.filter(r => said(r.fillerFabric)).length);
  const rufVals = {};
  mdb.filter(r => said(r.ruffleFabric)).forEach(r => { const v = String(r.ruffleFabric).trim(); rufVals[v] = (rufVals[v] || 0) + 1; });
  console.log('Ruffle fabric spellings: ' + (Object.keys(rufVals).length
    ? Object.entries(rufVals).sort((a, b) => b[1] - a[1]).map(([v, n]) => v + ' (' + n + ')').join(' · ') : 'none'));

  H('6. WHICH RECIPE FIELDS ARE FILLED AT ALL');
  ['consumption', 'packOf', 'cuttingRequired', 'isZip', 'zipQty', 'chainLength',
    'isRuffle', 'ruffleMeters', 'ruffleFabric', 'fillerFabricRequired', 'standardFillingQty']
    .forEach(f => console.log('   ' + f.padEnd(22) + String(recipes.filter(r => said(r[f])).length).padStart(4) + ' of ' + recipes.length + ' recipes'));
})().catch(e => { console.error('FAILED: ' + (e.message || e)); process.exit(1); });
