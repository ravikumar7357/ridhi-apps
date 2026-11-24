/* Image Manager — the MD's task #5 (24 Nov 2026): "Stock > 0 only", the family picture order (one red dot under a picture out of its
 * family's order), and "Using the family's main" removed. In the stub page (listing-rules-test.js load, opts.im).
 *   node tests/image-order-test.js
 * Covers: every child in order → no dot · a size chart in PT03 while siblings have it in PT02 → ONE dot, under that picture only (also
 * when PT02 is left empty or holds an own photo) · an empty slot where siblings have a picture · an own photo out of the family's
 * pattern · a tie and a single child → no check · the same picture at another size is the same picture · a 0-stock child: not listed
 * and no dot when ON, listed plainly (no marks) when OFF · counts count children with stock only · the box remembered · the stock on
 * the row · the dots are in nothing else (no chip, card, sheet, family header) · "Using the family's main" gone everywhere. */
const fs = require('fs'), path = require('path');
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const SRC = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const A = (id, size) => `https://m.media-amazon.com/images/I/${id}${size ? '._SL' + size + '_' : ''}.jpg`;
// A child: its own photos ('own1', 'own2' … become <sku>own1 …) and shared pictures by their id, slot by slot (MAIN, PT01 …).
const SLOTS = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'];
function kid(sku, slots, extra) {
  const img = {};
  slots.forEach((p, i) => { if (p) img[SLOTS[i]] = A(/^own/.test(p) ? sku + p : p); });
  return Object.assign({ sku, psku: 'PAR', asin: 'B0' + sku, c: sku, z: '18x18', st: 'BUYABLE,DISCOVERABLE', iss: [], img, live: Object.assign({}, img) }, extra || {});
}
const dotsOf = (P, kids) => { const m = P.imSeqFamily(kids); return Object.fromEntries([...m].map(([sku, d]) => [sku, d])); };

console.log('== the family order: which picture is out of place ==');
{
  const P = load({ im: true, sq: true });
  // the family: own photos in MAIN, PT01; the shared size chart in PT02; an own photo in PT03
  const std = sku => kid(sku, ['own1', 'own2', 'chart', 'own3']);
  eq('every child in the family order → no dot at all', dotsOf(P, [std('A'), std('B'), std('C')]), {});
  eq('C has the size chart in PT03 (its own photo in PT02) while A and B have it in PT02 → ONE dot, under C\'s PT03 only',
    dotsOf(P, [std('A'), std('B'), kid('C', ['own1', 'own2', 'own3', 'chart'])]), { C: { PT03: 'Out of sequence — siblings have this in PT02' } });
  eq('…the same when C left PT02 empty: the empty slot the chart belongs in is not marked again',
    dotsOf(P, [std('A'), std('B'), kid('C', ['own1', 'own2', '', 'chart'])]), { C: { PT03: 'Out of sequence — siblings have this in PT02' } });
  eq('an empty slot where siblings have a picture → a dot under that empty slot: "Siblings have an image here"',
    dotsOf(P, [std('A'), std('B'), kid('C', ['own1', 'own2', 'chart', ''])]), { C: { PT03: 'Siblings have an image here' } });
  // own photos follow the position pattern: the family's own-photo slots are MAIN, PT01, PT02 (the chart in PT03)
  const fam2 = sku => kid(sku, ['own1', 'own2', 'own3', 'chart']);
  eq('own photos by the pattern most siblings follow: C\'s PT01 empty, its 3rd own photo in PT04 → "Siblings have an image here" + "siblings have this in PT02"',
    dotsOf(P, [fam2('A'), fam2('B'), kid('C', ['own1', '', 'own2', 'chart', 'own3'])]), { C: { PT01: 'Siblings have an image here', PT04: 'Out of sequence — siblings have this in PT02' } });
  eq('an extra own photo after the pattern ends (siblings have 4 pictures, C has 5) → no dot', dotsOf(P, [fam2('A'), fam2('B'), kid('C', ['own1', 'own2', 'own3', 'chart', 'own4'])]), {});
  eq('a shared lifestyle photo and a care guide: each has its own normal slot (the slot most children use)',
    dotsOf(P, [kid('A', ['own1', 'life', 'care']), kid('B', ['own1', 'life', 'care']), kid('C', ['own1', 'life', 'care']), kid('D', ['own1', 'care', 'life'])]),
    { D: { PT01: 'Out of sequence — siblings have this in PT02', PT02: 'Out of sequence — siblings have this in PT01' } });
  eq('two children that differ: a tie — nobody can be called out of order → no dot', dotsOf(P, [kid('A', ['own1', 'chart']), kid('B', ['own1', '', 'chart'])]), {});
  eq('a single-child family → no check', dotsOf(P, [kid('A', ['own1', '', '', 'chart'])]), {});
  // same picture = the same Amazon image id, whatever size the link asks for
  const big = kid('B', ['own1', 'own2', 'chart', 'own3']);
  big.img.PT02 = A('chart', 1500);
  const small = kid('C', ['own1', 'own2', 'own3', 'chart']);
  small.img.PT03 = A('chart', 500);
  eq('the same picture at another size (…/I/chart._SL1500_ and ._SL500_) is the same picture (its id)', dotsOf(P, [std('A'), big, small]), { C: { PT03: 'Out of sequence — siblings have this in PT02' } });
  ok('…the id is the part after /images/I/ (imqId)', P.imqId(A('chart', 1500)) === 'chart' && P.imqId(A('chart')) === 'chart');
  // which picture: ours, else what Amazon serves
  const liveOnly = kid('C', ['own1', 'own2', '', 'own3']);
  liveOnly.live.PT02 = A('chart');
  eq('a slot we left empty but Amazon fills with the chart counts as the chart (the tile shows it) → in order', dotsOf(P, [std('A'), std('B'), liveOnly]), {});
}

console.log('== on the page: one red dot under that picture, nothing else; "Stock > 0 only" ==');
const PAR = { sku: 'PAR', lvl: 'parent', asin: 'B0PAR', t: 'Napkins parent', img: { MAIN: A('par') }, live: { MAIN: A('par') } };
const ITEMS = () => [PAR,
  kid('A', ['own1', 'own2', 'chart', 'own3', 'own4', 'own5', 'own6']),
  kid('B', ['own1', 'own2', 'chart', 'own3', 'own4', 'own5', 'own6']),
  kid('C', ['own1', 'own2', 'own3', 'chart', 'own4', 'own5', 'own6']),                // chart in PT03: out of order
  kid('Z', ['own1', 'own2', 'own3', 'chart']),                                         // NO STOCK: chart in PT03 too, and fewer than 7 pictures
  kid('S1', ['own1', '', 'chart'], { psku: '' }),                                      // a family of one
];
const QTY = { A: 5, B: 3, C: 1, Z: 0, S1: 2 };
function page(store) {
  const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const P = load({ im: true, sq: true, ctx: { localStorage: ls } });
  P.el('imBrand').value = 'SP';
  P.el('imFilter').value = 'all';
  P.el('imQ').value = '';
  P.IML.SP = { at: new Date(), items: ITEMS() };
  P.HEALTH.SP = Object.assign(P.HEALTH.SP || {}, { rows: Object.keys(QTY).map(sku => ({ sku, qty: QTY[sku], status: 'Active', channel: 'AFN' })) });
  P.IM_OPEN.add('PAR'); P.IM_OPEN.add('solo:S1');
  return P;
}
const rowOf = (html, sku) => (html.split(new RegExp(`<div class="im-kid[^"]*" data-sku="${sku}">`))[1] || '').split(/<div class="im-kid[ "]/)[0];
{
  const store = {};
  const P = page(store);
  ok('"Stock > 0 only" is ON by default', P.el('imStock').checked === true && !(P.IM_STOCK_KEY in store));
  P.imListRender();
  let html = P.el('imList').innerHTML;
  const c = rowOf(html, 'C');
  ok('C\'s row: ONE red dot, right under its PT03 tile, its words on hover', (c.match(/class="im-seq"/g) || []).length === 1
    && /data-slot="PT03">[\s\S]*?<i class="im-seq" role="img" aria-label="Out of sequence — siblings have this in PT02" title="Out of sequence — siblings have this in PT02"><\/i><\/span>/.test(c), c.slice(0, 300));
  ok('A and B (in order): no dot; the single-child family: no check', !/im-seq/.test(rowOf(html, 'A')) && !/im-seq/.test(rowOf(html, 'B')) && !/im-seq/.test(rowOf(html, 'S1')));
  ok('nothing else: no error row, no chip, no count — C\'s chip is its status ("Buyable"); no "out of sequence" in the cards, the family header or the meta line',
    /class="im-chip is-ok"[^>]*>Buyable</.test(c) && !/im-kid-err/.test(c) && (html.match(/Out of sequence/g) || []).length === 2 && !/sequence|order/i.test(P.imCardsData(P.IML.SP.items).map(x => x.t + x.note).join(' ')));
  ok('…and not in the Download errors sheet (its rows are the picture problems only)', !P.imDlRows(['SP'], '').some(r => /sequence|order/i.test(r.cells.join(' '))));
  ok('the legend at the top: "● red dot = image out of family order"', /<span class="im-seq-key"><i class="im-seq" aria-hidden="true"><\/i> red dot = image out of family order<\/span>/.test(html));
  ok('each child shows its FBA stock: A "5 units", C "1 unit"', /<span class="im-stock"[^>]*>5 units<\/span>/.test(rowOf(html, 'A')) && /<span class="im-stock"[^>]*>1 unit<\/span>/.test(c));
  ok('ON: the 0-stock child Z is not listed (and carries no dot)', !/data-sku="Z"/.test(html.replace(/data-(copy1|view|repl)="Z"/g, '')) && !P.IM_SEQ.has('Z'));
  ok('ON: the family counts its children with stock: "3 children"', /3 children/.test(html), (html.match(/\d+ children?/) || [''])[0]);
  const cardsOn = P.imCardsData(P.IML.SP.items).map(x => x.k + '=' + x.n).join(' ');
  ok('counts: Z (0 stock, fewer than 7 pictures) is in no card — "Fewer than 7" counts S1 only', /few=1/.test(cardsOn), cardsOn);
  // OFF
  P.imStockSet(false);
  ok('OFF → remembered ("0") and the box unticked', store[P.IM_STOCK_KEY] === '0' && P.el('imStock').checked === false);
  html = P.el('imList').innerHTML;
  const z = rowOf(html, 'Z');
  ok('OFF: Z is listed again — "0 units", chip "No stock", no problem chip, no dot, no "not checked" words', !!z && /<span class="im-stock is-zero"[^>]*>0 units<\/span>/.test(z)
    && />No stock</.test(z) && !/data-im-prob=/.test(z) && !/im-seq/.test(z) && !/not checked/.test(z), z.slice(0, 400));
  ok('OFF: C keeps its dot; the counts are the same as ON (children with stock only)', /im-seq/.test(rowOf(html, 'C')) && P.imCardsData(P.IML.SP.items).map(x => x.k + '=' + x.n).join(' ') === cardsOn);
  ok('OFF: the family lists all 4 children; "N need pictures" still counts only those with stock', /4 children/.test(html) && !/need pictures/.test(html.split('data-grp="PAR"')[1].split('im-kid')[0]));
  ok('OFF: a filter shows children with stock only ("Fewer than 7" never shows Z)', (() => { P.el('imFilter').value = 'few'; P.imListRender(); const h = P.el('imList').innerHTML; P.el('imFilter').value = 'all'; return !/data-sku="Z"/.test(h) && /data-sku="S1"/.test(h); })());
  // remembered across a new visit
  const again = page(store);
  ok('the choice is remembered: a new page starts with the box OFF', again.el('imStock').checked === false && (again.imListRender(), /data-sku="Z"/.test(again.el('imList').innerHTML)));
  again.imStockSet(true);
  ok('…and ON again is remembered too ("1")', store[again.IM_STOCK_KEY] === '1' && again.el('imStock').checked === true);
  // the stock not held yet: nothing hidden, every child marked as before
  const cold = page({});
  cold.HEALTH.SP = undefined;
  cold.imListRender();
  ok('Listing Health\'s snapshot not held: nothing is hidden ("stock not loaded yet"), Z is listed and checked like the others', /data-sku="Z"/.test(cold.el('imList').innerHTML) && /stock not loaded yet/.test(cold.el('imList').innerHTML) && cold.imStockOk({ sku: 'Z' }) === true);
  // the toolbar box: the A+ Content / IP Guard look
  const html2 = SRC('index.html');
  ok('the toolbar has the "Stock > 0 only" box (checked), with the same look as A+ Content\'s', /<label class="im-tog"[^>]*><input type="checkbox" id="imStock" checked> Stock &gt; 0 only<\/label>/.test(html2)
    && /#paneImg \.im-tog\{display:inline-flex;align-items:center;gap:6px;font-size:12\.5px;font-weight:600;color:var\(--muted\);white-space:nowrap;cursor:pointer\}/.test(SRC('styles.css'))
    && /#paneAplus \.apc-tog\{display:inline-flex;align-items:center;gap:6px;font-size:12\.5px;font-weight:600;color:var\(--muted\);white-space:nowrap;cursor:pointer\}/.test(SRC('styles.css')));
}

console.log('== "Using the family\'s main" is gone everywhere ==');
{
  const P = load({ im: true, sq: true });
  const code = SRC('app/listing/image-manager.js');
  const live = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('the code: no noown check, no imNoOwnMain, no "family\'s main" words', !/noown|imNoOwnMain|family's main|family\\'s main/.test(live));
  ok('no card, no check, no sheet column, no "not checked" name', !P.IM_CARDS.some(c => c.k === 'noown') && !('noown' in P.IM_CHECKS) && !P.IM_DL_CHECKS.some(c => c.k === 'noown')
    && !P.IM_DL_COLS.some(c => /family's main/.test(c)) && P.IM_CARDS.map(c => c.k).join() === 'nomain,pcbad,few,amzerr,sup');
  ok('the filter picker has no option for it', !/value="noown"|family's main/.test((SRC('index.html').match(/<select id="imFilter"[\s\S]*?<\/select>/) || [''])[0]));
  const k2 = kid('K2', ['', 'own2', 'own3', 'own4', 'own5', 'own6', 'own7']);
  k2.live.MAIN = A('parentmain');                                  // shoppers see the family's main
  P.el('imBrand').value = 'SP';
  P.HEALTH.SP = Object.assign(P.HEALTH.SP || {}, { rows: [{ sku: 'K2', qty: 4 }] });
  ok('a listing with no main of its own (Amazon serves the family\'s): no chip, no problem, not "needs pictures"', P.imKidChip(k2).t === 'Buyable' && P.imProblems(k2, 'SP').length === 0 && P.imNeeds(k2) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
