/* Listing Health (Parent ASINs / Child listings) and the Workspace show the SAME numbers (12 Nov 2026): the same listings, the same
 * freshest data through healthOf, the same rules, the same levels — over the sample in listing-rules-test.js.
 *   node tests/numbers-match-test.js */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const draw = (C, brand, mode, card) => {
  C.el('hBrandView').value = brand;
  C.LI_WS.on = true; C.LI_WS.mode = mode || 'all'; C.LI_WS.card = card || ''; C.LI_WS.chip = 'all'; C.LI_WS.sweep = null;
  C.liWsRender();
  return C.el('liWs').innerHTML;
};
// Listing Health's own counts for a brand: healthOf over every listing of the snapshot, as renderHealth / renderHealthKpis count them.
const healthCards = (C, brand) => {
  const n = C.counts(brand);
  return { critical: n.critical, attention: n.action + n.review, healthy: n.healthy + n.monitor, unchecked: n.unchecked,
    total: C.rows.filter(r => r.brand === brand).length };
};
const worstOf = html => {
  const m = strip(html).match(/By worst problem: Error ([\d,]+) · check again ([\d,]+) · Needs attention ([\d,]+) · No problem ([\d,]+)(?: · not checked yet ([\d,]+))? = Listing Health \(([\d,]+) listings?\)/);
  if (!m) return null;
  const v = i => +(m[i] || '0').replace(/,/g, '');
  return { err: v(1), chk: v(2), att: v(3), ok: v(4), unk: v(5), n: v(6) };
};

console.log('== the worst-problem line equals Listing Health ==');
{
  const C = load({ ws: true });
  // one listing with stock but Inactive (an Error that is not live), one inactive with no stock (Not live / inbound)
  const inact = C.rows.find(r => r.sku === 'R6'); inact.status = 'Inactive'; inact.qty = 3;
  const gone = C.rows.find(r => r.sku === 'R9'); gone.status = 'Inactive'; gone.qty = 0;
  C.reset();
  ['SP', 'CPC'].forEach(brand => ['all', 'live', 'off'].forEach(mode => {
    const w = worstOf(draw(C, brand, mode));
    const h = healthCards(C, brand);
    ok(`${brand}, ${mode} mode: Error + check again = Critical, Needs attention = Needs Action + Needs Review, No problem = Healthy, total = listings`,
      w && w.err + w.chk === h.critical && w.att === h.attention && w.ok === h.healthy && w.unk === h.unchecked && w.n === h.total, JSON.stringify({ w, h }));
  }));
  const both = worstOf(draw(C, 'ALL', 'all'));
  const hs = healthCards(C, 'SP'), hc = healthCards(C, 'CPC');
  ok('both brands: the sum of the two', both && both.err + both.chk === hs.critical + hc.critical && both.n === hs.total + hc.total, JSON.stringify(both));

  console.log('== stock but Inactive is an Error, not "Not live / inbound" ==');
  const kids = C.liWsParents(['SP']).flatMap(p => p.kids);
  const k6 = kids.find(k => k.sku === 'R6'), k9 = kids.find(k => k.sku === 'R9');
  ok('R6 (3 in stock, Inactive): Critical in Listing Health', C.healthOf(inact, C.hCtx()).bucket === 'critical' && C.healthOf(inact, C.hCtx()).found.some(h => h.detector === 'inactive_with_stock'));
  ok('…not live, but counted: in the red "Error: fix first" card', !k6.live && k6.urgent && k6.counted && k6.cards.err === true, JSON.stringify({ live: k6.live, urgent: k6.urgent, cards: k6.cards }));
  ok('R9 (no stock, Inactive): stays in "Not live / inbound", counted nowhere', !k9.counted && !k9.cards.err && !k9.cards.att && !k9.cards.ok);
  const html = draw(C, 'SP', 'live');
  const box = k => strip((html.match(new RegExp(`data-li-ws-card="${k}"[^]*?</button>`)) || [''])[0]);
  ok('the Error card counts it and says "1 not live"', /Error: fix first \d+/.test(box('err')) && /1 not live/.test(box('err')), box('err'));
  ok('"Not live / inbound" counts only R9 (the listing with no stock)', /Not live \/ inbound 1 /.test(box('off')), box('off'));
  draw(C, 'SP', 'live', 'err');
  ok('its parent shows under the Error filter', C.LI_WS.rows.some(p => p.key === 'SP|P1'), C.LI_WS.rows.map(p => p.key).join());
  ok('…and the child line says why it counts', /not live, but counted as an Error: fix this first/.test(C.liWsDetail(k6, 8)));
  ok('the child sidebar says so too', /Not live, but counted as an Error: fix this first/.test(C.lkHtml(k6, {})));
  draw(C, 'SP', 'off');
  ok('Not live mode lists R9, not R6', C.LI_WS.rows.every(p => p.inMode.every(k => k.sku !== 'R6')) && C.LI_WS.rows.some(p => p.inMode.some(k => k.sku === 'R9')));

  console.log('== the Parents card follows the active card ==');
  const all = draw(C, 'SP', 'live');
  const parentsBox = h => strip((h.match(/<div class="ls-box"[^>]*><span class="ls-l">Parents[^]*?<\/div>/) || [''])[0]);
  const nParents = C.liWsParents(['SP']).length;
  ok(`no card on: every parent, "In total" (${nParents})`, new RegExp(`Parents ${nParents} In total`).test(parentsBox(all)), parentsBox(all));
  const att = draw(C, 'SP', 'live', 'att');
  const attN = C.LI_WS.rows.length;
  ok(`Needs attention on: that card's parents, "In view" (${attN})`, new RegExp(`Parents ${attN} In view`).test(parentsBox(att)) && attN < nParents, parentsBox(att));
  const attCardP = +((strip(att).match(/Needs attention \d+ Not urgent, worth fixing in (\d+) parents?/) || [])[1] || -1);
  ok('…the same number the card itself names ("in N parents")', attCardP === attN, attCardP + ' vs ' + attN);
  const err = draw(C, 'SP', 'live', 'err');
  ok('Error on: its parents, "In view"', new RegExp(`Parents ${C.LI_WS.rows.length} In view`).test(parentsBox(err)), parentsBox(err));
  const off = draw(C, 'SP', 'off');
  ok('Not live / inbound on: its parents, "In view"', new RegExp(`Parents ${C.LI_WS.rows.length} In view`).test(parentsBox(off)), parentsBox(off));
}

console.log('== 1d: five titles with the edge cases, through both paths ==');
{
  const C = load({ ws: true });
  C.LI_WS.mode = 'all';
  const cases = [
    ['R1', '75 characters, "18x18 Inc" (short forms allowed from 74)'],
    ['R5', '"18 x 18 Inc" read as inch'],
    ['C1b', 'our brand words: "The Whimsical Corner" on CPC'],
    ['R7', 'White = embroidery: no Block Print asked'],
    ['R8', 'Block Print proof: 2 siblings say it'],
  ];
  const kids = C.liWsParents(['SP', 'CPC']).flatMap(p => p.kids);
  const ids = list => list.map(h => h.id + ':' + h.sev).sort().join(',');
  cases.forEach(([sku, what]) => {
    const row = C.rows.find(r => r.sku === sku);
    const health = C.healthOf(Object.assign({}, row, { brand: row.brand }), C.hCtx());   // Listing Health's path (renderHealth)
    const kid = kids.find(k => k.sku === sku);                                           // the Workspace's path (liWsChild)
    ok(`${sku} — ${what}: the same level and the same findings (${health.bucket}${health.found.length ? ': ' + ids(health.found) : ''})`,
      kid && kid.bucket === health.bucket && ids(kid.found) === ids(health.found), JSON.stringify({ ws: kid && [kid.bucket, ids(kid.found)], lh: [health.bucket, ids(health.found)] }));
  });
  ok('R8 is the only one of the five with a Block Print finding', kids.filter(k => ['R1', 'R5', 'C1b', 'R7', 'R8'].includes(k.sku) && k.found.some(h => h.detector === 'title_keyword')).map(k => k.sku).join() === 'R8');
}

console.log('== the numbers check (liWsReconcile) ==');
{
  const C = load({ ws: true });
  const inact = C.rows.find(r => r.sku === 'R6'); inact.status = 'Inactive'; inact.qty = 3;
  C.reset();
  const R = C.liWsReconcile();
  ok('both brands match: Error + check again = Critical, attention, no problem, listings', R.SP.match && R.CPC.match, JSON.stringify({ SP: [R.SP.health, R.SP.workspace], CPC: [R.CPC.health, R.CPC.workspace] }));
  ok('1a: Critical by rule names the rule with its count and examples', R.SP.criticalByRule['Inventory/content mismatch'] && R.SP.criticalByRule['Inventory/content mismatch'].examples.includes('R6'), JSON.stringify(R.SP.criticalByRule));
  ok('1b: before this change R6 was under "Not live / inbound"; now it is under "Error: fix first"',
    R.SP.criticalWhereBefore['Not live / inbound (not counted)'].examples.includes('R6') && R.SP.criticalWhereNow['Error: fix first'].examples.includes('R6'), JSON.stringify([R.SP.criticalWhereBefore, R.SP.criticalWhereNow]));
  ok('1c: nobody is in one list and not the other', !R.SP.sets['in Listing Health, not in the Workspace list'] && !R.CPC.sets['in Listing Health, not in the Workspace list'], JSON.stringify(R.SP.sets));
  ok('1d: no listing judged differently by the two paths', !R.SP.judgedDifferently.length && !R.CPC.judgedDifferently.length);
  // a listing with no parent, no ASIN, no SKU: Listing Health counts it, and now so does the Workspace
  C.HEALTH.SP.rows.push({ brand: 'SP', parent: '', sku: '', asin: '', title: 'x', qty: 1, price: 1, status: 'Active', channel: 'AFN', content: null });
  C.reset();
  const R2 = C.liWsReconcile(['SP']);
  ok('a listing with no id at all is in both lists ("—")', R2.SP.workspace.listings === R2.SP.health.listings && R2.SP.match, JSON.stringify([R2.SP.health, R2.SP.workspace]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
