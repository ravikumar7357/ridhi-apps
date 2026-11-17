/* Image Manager ⬇ Download errors (src/app/listing/image-manager.js imDlRows / imDlCsv / imDlDownload) in the stub page (opts.im).
 *   node tests/image-errors-test.js
 * Mock lists of both brands: listings with and without picture problems, stock 0, not buyable, a solo listing, a colour with commas,
 * quotes, Hindi and ₹. Checks: which rows (stock > 0, buyable, a problem), every check column, the counts = the cards' for stock > 0,
 * both brands, the filter option, the menu, the file (BOM, headers on row 1, escaping, name, order) and the note after it. */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const A = id => 'https://m.media-amazon.com/images/I/' + id + '.jpg';
const full = (p, n) => Object.fromEntries(['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'].slice(0, n || 9).map(s => [s, A(p + s)]));
const COLS = ['Brand', 'Family name', 'Parent ASIN', 'SKU', 'ASIN', 'Colour', 'Size', 'Stock (units)', 'Amazon link', 'Problems', 'What to do',
  'No main picture', 'Main not OK', 'Too small (under 2000)', 'Fewer than 7 pictures', 'Amazon picture error', 'Search suppressed', "Shows another SKU's pictures", 'No swatch', "Using the family's main",
  'Number of pictures', 'Smallest picture size', "Amazon's picture error message", 'Data time'];
const KEYS = ['nomain', 'pcbad', 'small', 'few', 'amzerr', 'sup', 'other', 'noswatch', 'noown'];
const HINDI = 'Rust, "Deep" रंग ₹499';
const SP_ITEMS = () => [
  { sku: 'PAR', lvl: 'parent', asin: 'B0PAR', t: 'Napkins, "Cotton" parent', img: { MAIN: A('par') }, live: { MAIN: A('par') } },
  { sku: 'K1', psku: 'PAR', pa: 'B0PAR', asin: 'B0K1', c: 'Blue', z: '18x18', st: 'BUYABLE,DISCOVERABLE', img: Object.assign(full('k1'), { SWCH: A('k1sw') }), live: full('k1') },            // no problem
  { sku: 'K2', psku: 'PAR', pa: 'B0PAR', asin: 'B0K2', c: 'Blue', z: '20x20', st: 'BUYABLE,DISCOVERABLE', img: Object.assign(full('k2'), { MAIN: undefined, SWCH: A('k2sw') }), live: full('k2') },   // family's main + Main not OK
  { sku: 'K3', psku: 'PAR', pa: 'B0PAR', asin: 'B0K3', c: 'Red', z: '18x18', st: 'BUYABLE,DISCOVERABLE', img: full('k3', 5), live: full('k3', 5),                                              // few, small, Amazon error, no swatch
    iss: [{ s: 'E', c: '90244', m: 'The value for Ounce / Unit Count is missing', a: ['unit_count'] }, { s: 'E', c: '18320', m: 'The main image is missing or incorrect', a: ['main_product_image_locator'] }] },
  { sku: 'K4', psku: 'PAR', pa: 'B0PAR', asin: 'B0K4', c: 'Red', z: '20x20', st: 'BUYABLE', img: Object.assign(full('k4'), { SWCH: A('k4sw') }), live: Object.assign(full('k4'), { MAIN: A('k1MAIN') }) },   // suppressed + another SKU's
  { sku: 'K5', psku: 'PAR', pa: 'B0PAR', asin: 'B0K5', c: 'Teal', z: '22x22', st: 'BUYABLE,DISCOVERABLE', img: Object.assign(full('k5'), { MAIN: undefined }), live: Object.assign(full('k5'), { MAIN: undefined }) },   // no main, STOCK 0
  { sku: 'K6', psku: 'PAR', pa: 'B0PAR', asin: 'B0K6', c: 'Sage', z: '22x22', st: 'DISCOVERABLE', img: Object.assign(full('k6'), { MAIN: undefined }), live: Object.assign(full('k6'), { MAIN: undefined }) },          // no main, NOT BUYABLE
  { sku: 'K7', psku: 'PAR', pa: 'B0PAR', asin: 'B0K7', c: HINDI, z: '16x16', st: 'BUYABLE,DISCOVERABLE', img: full('k7'), live: full('k7') },                                                  // no swatch only
  { sku: 'S1', asin: 'B0S1', c: 'Green', z: '60x90', st: 'BUYABLE,DISCOVERABLE', img: full('s1'), live: full('s1') },                                                                         // solo, no swatch
];
const CPC_ITEMS = () => [
  { sku: 'C1', asin: 'B0C1', c: 'Black', z: '', st: 'BUYABLE,DISCOVERABLE', img: Object.assign(full('c1'), { MAIN: undefined }), live: Object.assign(full('c1'), { MAIN: undefined }), iss: [] },   // no main, stock 3
  { sku: 'C2', asin: 'B0C2', c: 'White', z: '', st: 'BUYABLE,DISCOVERABLE', img: full('c2'), live: full('c2') },                                                                              // no swatch, STOCK 0
];
const QTY = { K1: 5, K2: 5, K3: 3, K4: 2, K5: 0, K6: 7, K7: 1, S1: 4, C1: 3, C2: 0 };
function page() {
  const P = load({ im: true, sq: true, pc: true });
  P.el('imBrand').value = 'SP';
  P.el('imFilter').value = 'all';
  P.IML.SP = { at: new Date(2026, 10, 17, 13, 14), items: SP_ITEMS() };
  P.IML.CPC = { at: new Date(2026, 10, 17, 12, 0), items: CPC_ITEMS() };
  P.HEALTH.SP.rows = Object.keys(QTY).filter(s => !/^C/.test(s)).map(sku => ({ sku, asin: 'B0' + sku, parent: 'B0PAR', title: 't', qty: QTY[sku], status: 'Active', channel: 'AFN' }));
  P.HEALTH.CPC.rows = ['C1', 'C2'].map(sku => ({ sku, asin: 'B0' + sku, parent: '', title: 't', qty: QTY[sku], status: 'Active', channel: 'AFN' }));
  P.PC.marks.SP = { k2MAIN: { v: 'bad' } };
  P.IMQ.dims = new Map([['k3PT01', [1500, 1500]], ['k3MAIN', [2400, 2000]], ['k1MAIN', [2400, 2400]]]);
  return P;
}
// A CSV line split into its cells (quoted cells, "" for a quote).
function cells(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

(async () => {
  console.log('== which rows: stock > 0, buyable, at least one picture problem ==');
  const P = page();
  P.imListRender();                                   // the screen drawn first, as when the button is pressed
  const rows = P.imDlRows(['SP'], '');
  const sku = rows.map(r => r.sku);
  ok('Ridhi: K2, K3, K4, K7 and S1 — not K1 (no problem), not K5 (stock 0), not K6 (not buyable), not the parent', sku.slice().sort().join() === 'K2,K3,K4,K7,S1', sku.join());
  const row = s => { const r = rows.find(x => x.sku === s); return r ? Object.fromEntries(COLS.map((c, i) => [c, r.cells[i]])) : null; };
  const yes = s => KEYS.filter((k, i) => row(s)[COLS[11 + i]] === 'Yes').join(',');
  ok('each check column says "Yes" where it applies, empty elsewhere: K2 Main not OK + family\'s main', yes('K2') === 'pcbad,noown', yes('K2'));
  ok('…K3: Too small, Fewer than 7, Amazon picture error, No swatch', yes('K3') === 'small,few,amzerr,noswatch', yes('K3'));
  ok('…K4: Search suppressed (still buyable by a direct link) + Shows another SKU\'s pictures', yes('K4') === 'sup,other', yes('K4'));
  ok('…K7 and S1: No swatch', yes('K7') === 'noswatch' && yes('S1') === 'noswatch');
  ok('every check column only "Yes" or empty', rows.every(r => r.cells.slice(11, 20).every(v => v === 'Yes' || v === '')));
  const k3 = row('K3');
  ok('K3\'s other columns: brand, family, parent ASIN, ASIN, colour, size, stock as a number, the Amazon link',
    k3.Brand === 'Ridhi' && k3['Family name'] === 'Napkins, "Cotton" parent' && k3['Parent ASIN'] === 'B0PAR' && k3.ASIN === 'B0K3' && k3.Colour === 'Red' && k3.Size === '18x18'
    && k3['Stock (units)'] === 3 && k3['Amazon link'] === 'https://www.amazon.com/dp/B0K3', JSON.stringify(k3).slice(0, 300));
  ok('…Problems in plain words with " | ", What to do one line per problem in the same order', k3.Problems === 'Too small (under 2000) | Fewer than 7 pictures | Amazon picture error | No swatch'
    && k3['What to do'].split(' | ').length === 4 && /2000 × 2000/.test(k3['What to do'].split(' | ')[0]), k3['What to do']);
  ok('…Number of pictures 5, Smallest picture size 1500×1500, Amazon\'s picture error message in full (only the picture one, not ERROR 90244)',
    k3['Number of pictures'] === 5 && k3['Smallest picture size'] === '1500×1500' && k3["Amazon's picture error message"] === 'ERROR 18320: The main image is missing or incorrect', k3['Smallest picture size']);
  ok('…Data time: the snapshot\'s time (no ListingMatch data in this page)', /^Snapshot 17\/11\/2026, 13:14/.test(k3['Data time']), k3['Data time']);
  ok('a solo listing: family "No variation parent"', row('S1')['Family name'] === 'No variation parent' && row('S1')['Parent ASIN'] === '');

  console.log('== the numbers match the screen\'s cards for the listings with stock ==');
  const live = P.IML.SP.items.filter(i => i.lvl !== 'parent' && P.imDlLive(i, 'SP'));
  const fromCards = KEYS.map(k => live.filter(i => P.imKidMatch(i, k, '')).length);
  const fromFile = KEYS.map((k, i) => rows.filter(r => r.cells[11 + i] === 'Yes').length);
  ok('each column\'s "Yes" count = the card\'s own test (imKidMatch) over the live listings with stock', fromCards.join() === fromFile.join(), fromCards.join() + ' / ' + fromFile.join());
  const cards = Object.fromEntries(P.imCardsData(P.IML.SP.items).map(c => [c.k, c.n]));
  ok('…the cards on screen count every listing (No main at all 2: K5 stock 0 and K6 not buyable); the file has none of them', cards.nomain === 2 && fromFile[0] === 0, JSON.stringify(cards));

  console.log('== the file: Excel-clean ==');
  const sheet = P.imDlCsv(rows, 'Ridhi', new Date(2026, 10, 17, 14, 9));
  const lines = sheet.text.replace(/^﻿/, '').split('\r\n');
  ok('UTF-8 with a BOM, the headers on row 1 (nothing above), in the asked order', sheet.text.charCodeAt(0) === 0xFEFF && cells(lines[0]).join('|') === COLS.join('|'), lines[0].slice(0, 200));
  ok('one row per listing, Windows line ends, a final line end', lines.length === rows.length + 2 && lines[lines.length - 1] === '' && !/[^\r]\n/.test(sheet.text));
  const k7line = lines.find(l => l.includes('"K7"'));
  ok('commas, quotes, Hindi and ₹ escaped and kept: "Rust, ""Deep"" रंग ₹499"', k7line.includes('"Rust, ""Deep"" रंग ₹499"') && cells(k7line)[5] === HINDI && Buffer.from(sheet.text, 'utf8').includes(Buffer.from('₹499', 'utf8')));
  ok('the family name with a comma and quotes in one cell', cells(k7line)[1] === 'Napkins, "Cotton" parent');
  ok('the file name: image-errors_Ridhi_2026-11-17_1409.csv', sheet.name === 'image-errors_Ridhi_2026-11-17_1409.csv', sheet.name);
  ok('sorted by family (most problems first: the napkins family, 11, before the solo S1, 1), then SKU', sku.join() === 'K2,K3,K4,K7,S1', sku.join());

  console.log('== both brands, the filter option, the menu, the note ==');
  const both = P.imDlRows(['SP', 'CPC'], '');
  ok('Both brands: CPC\'s C1 (no main, stock 3) is in, C2 (stock 0) is not; Brand says CPC', both.some(r => r.sku === 'C1' && r.cells[0] === 'CPC' && r.cells[11] === 'Yes') && !both.some(r => r.sku === 'C2') && both.length === 6, both.map(r => r.sku).join());
  ok('…"Another SKU\'s pictures" is judged within each brand\'s own list (K4 still Yes)', both.find(r => r.sku === 'K4').cells[17] === 'Yes');
  ok('Only this filter ("Too small"): only K3', P.imDlRows(['SP'], 'small').map(r => r.sku).join() === 'K3');
  P.el('imFilter').value = 'small';
  const menu = P.imDlMenuHtml();
  ok('the menu with a card\'s filter on: This brand (Ridhi) / Both brands, and "Only this filter: Too small (under 2000)" / "All picture problems"', /This brand \(Ridhi\)/.test(menu) && /Both brands/.test(menu)
    && /value="filter" checked> Only this filter: Too small \(under 2000\)/.test(menu) && /value="all"> All picture problems/.test(menu), menu.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  P.el('imFilter').value = 'all';
  ok('…no filter on: no Rows question', !/Only this filter/.test(P.imDlMenuHtml()));
  P.el('imFilter').value = 'diff';
  ok('…a picker filter that is not a card ("Live image differs"): no Rows question either', !/Only this filter/.test(P.imDlMenuHtml()));
  P.el('imFilter').value = 'all';
  const got = await P.imDlDownload(true, 'small');
  ok('Download (both brands, only "Too small"): the file name says Both, 1 listing', /^image-errors_Both_\d{4}-\d{2}-\d{2}_\d{4}\.csv$/.test(got.name) && got.rows === 1, got.name);
  ok('…and the note: "Downloaded 1 listing with picture problems (stock > 0) — only “Too small (under 2000)”"', P.el('imMsg').textContent === 'Downloaded 1 listing with picture problems (stock > 0) — only “Too small (under 2000)”', P.el('imMsg').textContent);
  const all = await P.imDlDownload(false, '');
  ok('…this brand, all problems: "Downloaded 5 listings with picture problems (stock > 0)"', all.rows === 5 && P.el('imMsg').textContent === 'Downloaded 5 listings with picture problems (stock > 0)', P.el('imMsg').textContent);
  ok('the screen is untouched: the picker, the brand and the cards are as they were', P.el('imFilter').value === 'all' && P.el('imBrand').value === 'SP'
    && JSON.stringify(Object.fromEntries(P.imCardsData(P.IML.SP.items).map(c => [c.k, c.n]))) === JSON.stringify(cards));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
