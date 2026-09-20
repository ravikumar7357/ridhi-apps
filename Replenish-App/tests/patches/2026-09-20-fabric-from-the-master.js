/* THE CLOTH A SKU IS MADE FROM IS PICKED, NOT TYPED.
 *
 * "kaun sa fabric use ho raha hai wo kahan feed karunga" — on the SKU row, because the recipe is
 * keyed by article + subtype + size and knows nothing about colour, and the cloth changes with the
 * colour: 46 of 321 combinations use two different fabrics across their colours (piping pillow cover
 * 20x20 is Chambray on some colours and Sheeting 82 on others). So the field stays on the SKU.
 *
 * BUT IT WAS A FREE TEXT BOX, and one live SKU says "Sheeitng 112" — a fabric that exists nowhere,
 * has no width, and matches nothing. Cutting has never allowed this: it picks from the Fabric Type
 * master and refuses a spelling the master does not have. The master database was the one place a
 * new fabric could be invented by a typo. It now picks from the same list, by the same rule
 * (cutFabrics: active entries, description before code), so the two can never disagree about what a
 * fabric is called.
 *
 * WHATEVER THE ROW ALREADY SAYS IS KEPT AS AN OPTION. Editing a SKU to change its zip must not
 * silently change its cloth because the spelling is not in the master — the bad spelling stays
 * visible, and stays fixable, instead of being quietly swapped for something nobody chose.
 *
 * The ruffle cloth gets the same treatment: ptConsumeRuffle writes it straight onto the fabric
 * ledger as `fabricType`, so a typo there posts a deduction against a fabric that does not exist.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- the body cloth ---- */
one(`    { key: 'fabric', label: 'Fabric', value: m('fabric', '') },`,
`    /* FROM THE FABRIC TYPE MASTER — the same list, by the same rule, that Cutting picks from. A
     * spelling typed here used to become a fabric nobody had agreed to, with no width and no ledger.
     * The row's own spelling is kept at the top of the list so an edit can never change its cloth. */
    { key: 'fabric', label: 'Fabric', type: 'select', value: m('fabric', ''),
      options: [''].concat(fabListOr(m('fabric', ''))) },`, 'the Fabric field picks from the master');

/* ---- the ruffle cloth ---- */
one(`    { key: 'ruffleFabric', label: 'Ruffle fabric', value: m('ruffleFabric', '') },`,
`    /* The ruffle cloth is written onto the fabric ledger as it stands, so it is picked too. */
    { key: 'ruffleFabric', label: 'Ruffle fabric', type: 'select', value: m('ruffleFabric', ''),
      options: [''].concat(fabListOr(m('ruffleFabric', ''))) },`, 'the Ruffle fabric field too');

/* ---- the one list both of them use ---- */
one(`const YESNO = ['yes', 'no'];`,
`const YESNO = ['yes', 'no'];
/** The Fabric Type master, with whatever this row already says kept at the top of it. */
const fabListOr = cur => [...new Set([String(cur || '').trim()].filter(Boolean).concat(cutFabrics()))];`,
  'the shared list');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
