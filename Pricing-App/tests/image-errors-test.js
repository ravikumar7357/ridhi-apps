/* Image Manager ⬇ Download errors (src/app/listing/image-manager.js imDlRows / imDlCsv / imDlDownload) in the stub page (opts.im).
 *   node tests/image-errors-test.js
 * Mock lists of both brands and a stub Amazon. Checks: which rows (stock > 0, buyable, a problem), every check column, the file (BOM,
 * headers on row 1, escaping, name, order), FAST — built from the screen's own data, only the CRITICAL rows (No main picture, Main
 * rejected by Amazon, Search suppressed) read live before saving, Stop — and SCREEN = SHEET: each card's count (stock > 0) equals its
 * column's "Yes" count, and every row's problems equal the chips the screen draws for it. Then the same at full size (4,400 listings). */
const { load } = require('./listing-rules-test.js');
const { performance } = require('perf_hooks');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const A = id => 'https://m.media-amazon.com/images/I/' + id + '.jpg';
const full = (p, n) => Object.fromEntries(['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'].slice(0, n || 9).map(s => [s, A(p + s)]));
const COLS = ['Brand', 'Family name', 'Parent ASIN', 'SKU', 'ASIN', 'Colour', 'Size', 'Stock (units)', 'Amazon link', 'Problems', 'What to do',
  'No main picture', 'Main not OK', 'Too small (under 2000)', 'Fewer than 7 pictures', 'Amazon picture error', 'Search suppressed', "Using the family's main",
  'Number of pictures', 'Smallest picture size', "Amazon's picture error message", 'Data time', 'Verified at'];
const KEYS = ['nomain', 'pcbad', 'small', 'few', 'amzerr', 'sup', 'noown'];      // the check columns' order
const HINDI = 'Rust, "Deep" रंग ₹499';
const SP_ITEMS = () => [
  { sku: 'PAR', lvl: 'parent', asin: 'B0PAR', t: 'Napkins, "Cotton" parent', img: { MAIN: A('par') }, live: { MAIN: A('par') }, iss: [] },
  { sku: 'K1', psku: 'PAR', pa: 'B0PAR', asin: 'B0K1', c: 'Blue', z: '18x18', st: 'BUYABLE,DISCOVERABLE', iss: [], img: Object.assign(full('k1'), { SWCH: A('k1sw') }), live: full('k1') },            // no problem
  { sku: 'K2', psku: 'PAR', pa: 'B0PAR', asin: 'B0K2', c: 'Blue', z: '20x20', st: 'BUYABLE,DISCOVERABLE', iss: [], img: Object.assign(full('k2'), { MAIN: undefined }), live: full('k2') },     // family's main + Main not OK
  { sku: 'K3', psku: 'PAR', pa: 'B0PAR', asin: 'B0K3', c: 'Red', z: '18x18', st: 'BUYABLE,DISCOVERABLE', img: full('k3', 5), live: full('k3', 5),                                              // few, small, Amazon error ON THE MAIN (critical)
    iss: [{ s: 'E', c: '90244', m: 'The value for Ounce / Unit Count is missing', a: ['unit_count'] }, { s: 'E', c: '18320', m: 'The main image is missing or incorrect', a: ['main_product_image_locator'] }] },
  { sku: 'K4', psku: 'PAR', pa: 'B0PAR', asin: 'B0K4', c: 'Red', z: '20x20', st: 'BUYABLE', iss: [], img: full('k4'), live: Object.assign(full('k4'), { MAIN: A('k1MAIN') }) },               // suppressed (critical)
  { sku: 'K5', psku: 'PAR', pa: 'B0PAR', asin: 'B0K5', c: 'Teal', z: '22x22', st: 'BUYABLE,DISCOVERABLE', iss: [], img: Object.assign(full('k5'), { MAIN: undefined }), live: Object.assign(full('k5'), { MAIN: undefined }) },   // no main, STOCK 0
  { sku: 'K6', psku: 'PAR', pa: 'B0PAR', asin: 'B0K6', c: 'Sage', z: '22x22', st: 'DISCOVERABLE', iss: [], img: Object.assign(full('k6'), { MAIN: undefined }), live: Object.assign(full('k6'), { MAIN: undefined }) },          // no main, NOT BUYABLE
  { sku: 'K7', psku: 'PAR', pa: 'B0PAR', asin: 'B0K7', c: HINDI, z: '16x16', st: 'BUYABLE,DISCOVERABLE', iss: [], img: full('k7', 6), live: full('k7', 6) },                                     // fewer than 7 only
  { sku: 'K8', psku: 'PAR', pa: 'B0PAR', asin: 'B0K8', c: 'Ivory', z: '16x16', st: 'BUYABLE,DISCOVERABLE', iss: [], img: full('k8'), live: full('k8') },                                         // no swatch anywhere: NO problem now
  { sku: 'S1', asin: 'B0S1', c: 'Green', z: '60x90', st: 'BUYABLE,DISCOVERABLE', iss: [], img: full('s1', 4), live: full('s1', 4) },                                                            // solo, fewer than 7
];
const CPC_ITEMS = () => [
  { sku: 'C1', asin: 'B0C1', c: 'Black', z: '', st: 'BUYABLE,DISCOVERABLE', img: Object.assign(full('c1'), { MAIN: undefined }), live: Object.assign(full('c1'), { MAIN: undefined }), iss: [] },   // no main, stock 3 (critical)
  { sku: 'C2', asin: 'B0C2', c: 'White', z: '', st: 'BUYABLE,DISCOVERABLE', iss: [], img: full('c2', 3), live: full('c2', 3) },                                                               // few, STOCK 0
];
const QTY = { K1: 5, K2: 5, K3: 3, K4: 2, K5: 0, K6: 7, K7: 1, K8: 6, S1: 4, C1: 3, C2: 0 };
// The stub page; `amz`: what Amazon answers NOW per SKU (a changed record, { fail: true }, or nothing = exactly what the list holds).
function page(amz, wait) {
  amz = amz || {};
  let P;
  const calls = [];
  const baCall = async q => {
    calls.push(q);
    if (wait) await new Promise(r => setTimeout(r, wait));
    const it = amz[q.sku] || SP_ITEMS().concat(CPC_ITEMS()).find(i => i.sku === q.sku);
    if (!it || it.fail) throw new Error('Amazon throttled the request');
    const issues = (it.iss || []).map(i => ({ severity: i.s === 'E' ? 'ERROR' : 'WARNING', code: i.c, message: i.m, attrs: i.a || [], acts: i.e || [] }));
    if (q.lfix === 'get') return { ok: true, sku: q.sku, status: String(it.st || '').split(',').filter(Boolean), issues, attributes: {} };
    if (q.limg === 'get') return { ok: true, sku: q.sku, asin: it.asin, status: String(it.st || '').split(',').filter(Boolean), listing: Object.fromEntries(Object.entries(it.img || {}).filter(([, u]) => u)),
      catalog: it.liveErr ? {} : Object.fromEntries(Object.entries(it.live || {}).filter(([, u]) => u).map(([s, u]) => [s, { link: u, w: (P.IMQ.dims.get(P.imqId(u)) || [0, 0])[0], h: (P.IMQ.dims.get(P.imqId(u)) || [0, 0])[1] }])),
      catalogError: it.liveErr || '', issues };
    return {};
  };
  P = load({ im: true, sq: true, pc: true, baCall });
  P.el('imBrand').value = 'SP';
  P.el('imFilter').value = 'all';
  P.IML.SP = { at: new Date(2026, 10, 17, 13, 14), items: SP_ITEMS() };
  P.IML.CPC = { at: new Date(2026, 10, 17, 12, 0), items: CPC_ITEMS() };
  P.HEALTH.SP.rows = Object.keys(QTY).filter(s => !/^C/.test(s)).map(sku => ({ sku, asin: 'B0' + sku, parent: 'B0PAR', title: 't', qty: QTY[sku], status: 'Active', channel: 'AFN' }));
  P.HEALTH.CPC.rows = ['C1', 'C2'].map(sku => ({ sku, asin: 'B0' + sku, parent: '', title: 't', qty: QTY[sku], status: 'Active', channel: 'AFN' }));
  P.PC.marks.SP = { k2MAIN: { v: 'bad' } };
  P.PC.loaded = true;
  // the sizes Amazon gives: every served picture 2000 × 2000, but K3's PT01 1500 × 1500
  P.IMQ.dims = new Map();
  SP_ITEMS().concat(CPC_ITEMS()).forEach(i => Object.values(i.live || {}).forEach(u => { if (u) P.IMQ.dims.set(P.imqId(u), [2000, 2000]); }));
  P.IMQ.dims.set('k3PT01', [1500, 1500]);
  P.liveCalls = calls;
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
const sheetRows = sheet => sheet.text.replace(/^\uFEFF/, '').split('\r\n').slice(1).filter(Boolean).map(l => Object.fromEntries(cells(l).map((v, i) => [COLS[i], v])));
// SCREEN = SHEET over one page: the cards' numbers (for the listings with stock) against the sheet's columns, and every row's problems
// against the chips the screen draws for that listing. → { cards: { col: [screen, sheet] }, rowsOk, bad: [...] }
function screenVsSheet(P, brands, sheet) {
  const out = { cards: {}, rowsOk: true, bad: [] };
  const rows = sheetRows(sheet);
  const NAME = Object.fromEntries(P.IM_DL_CHECKS.map(c => [c.k, c.col]));
  brands.forEach(brand => {
    P.el('imBrand').value = brand;
    P.el('imFilter').value = 'all';
    const items = P.IML[brand].items;
    // the cards, counted over the listings the sheet is about (stock > 0, buyable): the card's own function, nothing else
    const live = items.filter(i => i.lvl !== 'parent' && P.imDlLive(i, brand));
    KEYS.forEach(k => {
      const screen = live.filter(i => P.imKidMatch(i, k, '')).length;
      const inSheet = rows.filter(r => r.Brand === ((P.BRAND_NAME || {})[brand] || (brand === 'SP' ? 'Ridhi' : brand)) && r[NAME[k]] === 'Yes').length;
      const key = brand + ' · ' + NAME[k];
      out.cards[key] = [screen, inSheet];
    });
    // every listing's chips as the screen draws them (the row's HTML), against its row in the sheet
    P.IM_OPEN.clear();
    items.forEach(i => { if (i.lvl === 'parent') P.IM_OPEN.add(i.sku); else P.IM_OPEN.add('solo:' + i.sku); });
    P.imListRender();
    const html = P.el('imList').innerHTML;
    live.forEach(i => {
      const block = (html.split(`<div class="im-kid" data-sku="${i.sku}">`)[1] || html.split(`<div class="im-kid is-open" data-sku="${i.sku}">`)[1] || '').split('<div class="im-strip">')[0];
      const chips = [...block.matchAll(/data-im-prob="(\w+)"/g)].map(m => m[1]).filter(k => KEYS.includes(k)).map(k => NAME[k]).sort();
      const r = rows.find(x => x.SKU === i.sku);
      const probs = r ? r.Problems.split(' | ').filter(Boolean).sort() : [];
      if (chips.join('|') !== probs.join('|')) { out.rowsOk = false; out.bad.push(`${i.sku}: chips [${chips}] / sheet [${probs}]`); }
    });
  });
  P.el('imBrand').value = 'SP';
  return out;
}

(async () => {
  console.log('== which rows: stock > 0, buyable, at least one picture problem ==');
  const P = page();
  P.imListRender();
  const rows = P.imDlRows(['SP'], '');
  const sku = rows.map(r => r.sku);
  ok('Ridhi: K2, K3, K4, K7, S1 — not K1 (no problem), K5 (stock 0), K6 (not buyable), K8 (no swatch anywhere: no longer a problem)', sku.slice().sort().join() === 'K2,K3,K4,K7,S1', sku.join());
  const row = s => { const r = rows.find(x => x.sku === s); return r ? Object.fromEntries(COLS.map((c, i) => [c, r.cells[i]])) : null; };
  const yes = s => KEYS.filter((k, i) => row(s)[COLS[11 + i]] === 'Yes').join(',');
  ok('each check column "Yes" where it applies: K2 Main not OK + family\'s main · K3 Too small, Fewer than 7, Amazon picture error · K4 Search suppressed · K7, S1 Fewer than 7',
    yes('K2') === 'pcbad,noown' && yes('K3') === 'small,few,amzerr' && yes('K4') === 'sup' && yes('K7') === 'few' && yes('S1') === 'few', ['K2', 'K3', 'K4', 'K7', 'S1'].map(s => s + ':' + yes(s)).join(' '));
  ok('no "No swatch" and no "another SKU" column; the columns are the asked ones, in order', P.IM_DL_COLS.join('|') === COLS.join('|'));
  const k3 = row('K3');
  ok('K3: brand, family, parent ASIN, ASIN, colour, size, stock (a number), link, Problems with " | ", one What to do per problem',
    k3.Brand === 'Ridhi' && k3['Family name'] === 'Napkins, "Cotton" parent' && k3['Parent ASIN'] === 'B0PAR' && k3.ASIN === 'B0K3' && k3['Stock (units)'] === 3 && k3['Amazon link'] === 'https://www.amazon.com/dp/B0K3'
    && k3.Problems === 'Too small (under 2000) | Fewer than 7 pictures | Amazon picture error' && k3['What to do'].split(' | ').length === 3, JSON.stringify(k3).slice(0, 300));
  ok('…Number of pictures 5, Smallest picture size 1500×1500 (Amazon\'s size of a served picture), Amazon\'s picture message in full (not ERROR 90244)',
    k3['Number of pictures'] === 5 && k3['Smallest picture size'] === '1500×1500' && k3["Amazon's picture error message"] === 'ERROR 18320: The main image is missing or incorrect');
  ok('…Data time: when the data was read (the snapshot here); Verified at empty until a live read', /^Snapshot 17\/11\/2026, 13:14/.test(k3['Data time']) && k3['Verified at'] === '');
  ok('which rows are CRITICAL (checked live before saving): K3 (Amazon\'s error names the main picture), K4 (Search suppressed) — not K2, K7, S1', rows.filter(r => P.imCritical(r.item, 'SP')).map(r => r.sku).join() === 'K3,K4');

  console.log('== the file: Excel-clean ==');
  const sheet = P.imDlCsv(rows, 'Ridhi', new Date(2026, 10, 17, 14, 9));
  const lines = sheet.text.replace(/^\uFEFF/, '').split('\r\n');
  ok('UTF-8 with a BOM, the headers on row 1 (nothing above)', sheet.text.charCodeAt(0) === 0xFEFF && cells(lines[0]).join('|') === COLS.join('|'));
  ok('one row per listing, Windows line ends, a final line end', lines.length === rows.length + 2 && lines[lines.length - 1] === '' && !/[^\r]\n/.test(sheet.text));
  const k7line = lines.find(l => l.includes('"K7"'));
  ok('commas, quotes, Hindi and ₹ escaped and kept: "Rust, ""Deep"" रंग ₹499"', k7line.includes('"Rust, ""Deep"" रंग ₹499"') && cells(k7line)[5] === HINDI && Buffer.from(sheet.text, 'utf8').includes(Buffer.from('₹499', 'utf8')));
  ok('the file name: image-errors_Ridhi_2026-11-17_1409.csv; sorted by family (most problems first), then SKU', sheet.name === 'image-errors_Ridhi_2026-11-17_1409.csv' && sku.join() === 'K2,K3,K4,K7,S1', sku.join());

  console.log('== FAST: from the screen\'s data; only the critical rows are read live ==');
  {
    // since the last refresh: K4 is back in search; K3's error on the main is gone (its other problems stay); C1 cannot be read
    const k4 = SP_ITEMS().find(i => i.sku === 'K4'), k3n = SP_ITEMS().find(i => i.sku === 'K3');
    const V = page({ K4: Object.assign({}, k4, { st: 'BUYABLE,DISCOVERABLE' }), K3: Object.assign({}, k3n, { iss: [] }), C1: { fail: true } });
    V.imListRender();
    const got = await V.imDlDownload(true, '');
    const out = sheetRows(got);
    const read = [...new Set(V.liveCalls.filter(c => c.limg === 'get').map(c => c.sku))].sort();
    ok('only the critical rows are read live — K3, K4 (Ridhi) and C1 (CPC); no other row; nothing sent to Amazon', read.join() === 'C1,K3,K4'
      && !V.liveCalls.some(c => c.lfix === 'patch' || c.limg === 'patch') && got.critical === 3, read.join());
    ok('K4 (back in search) is left out; K3 stays with its other problems — its Amazon error is gone from Problems, its column and the message',
      !out.some(r => r.SKU === 'K4') && out.find(r => r.SKU === 'K3').Problems === 'Too small (under 2000) | Fewer than 7 pictures' && out.find(r => r.SKU === 'K3')["Amazon's picture error message"] === '' && got.fixed === 2, JSON.stringify(out.map(r => [r.SKU, r.Problems])));
    ok('"Verified at": the time of the live read for K3; "not confirmed: Amazon could not be read" for C1 (kept: the screen still shows it); empty for the rows from the auto refresh',
      /^\d{1,2} [A-Z][a-z]{2} \d\d:\d\d$/.test(out.find(r => r.SKU === 'K3')['Verified at']) && out.find(r => r.SKU === 'C1')['Verified at'] === 'not confirmed: Amazon could not be read'
      && ['K2', 'K7', 'S1'].every(s => out.find(r => r.SKU === s)['Verified at'] === ''), out.map(r => r.SKU + '=' + r['Verified at']).join(' '));
    ok('the note: "Downloaded 5 listings with picture problems (stock > 0) · 3 critical checked live with Amazon (2 no longer critical) (1 could not be read) · the rest from the auto refresh"',
      V.el('imMsg').textContent === 'Downloaded 5 listings with picture problems (stock > 0) · 3 critical checked live with Amazon (2 no longer critical) (1 could not be read) · the rest from the auto refresh', V.el('imMsg').textContent);
    const same = screenVsSheet(V, ['SP', 'CPC'], got);
    ok('SCREEN = SHEET after the live check: each card\'s count (stock > 0) = its column\'s "Yes" count', Object.values(same.cards).every(([a, b]) => a === b), JSON.stringify(same.cards));
    ok('…and every row\'s problems = the chips the screen draws for it', same.rowsOk, same.bad.join(' · '));
  }
  {
    const V = page({}, 80);
    const p = V.imDlDownload(true, '');
    await new Promise(r => setTimeout(r, 25));
    const during = V.el('imDl').textContent;
    V.el('imDl').onclick();                             // the same button stops it
    const got = await p;
    ok('while the critical rows are checked the button says "Stop · checking with Amazon N of 3"; pressing it stops, and no file is saved', /^Stop · checking with Amazon \d of 3$/.test(during) && got === null
      && V.el('imMsg').textContent === 'Stopped — no file was saved.' && V.el('imDl').textContent === '⬇ Download errors', during + ' / ' + V.el('imMsg').textContent);
  }
  {
    const V = page();
    V.IML.SP.items = V.IML.SP.items.filter(i => !['K3', 'K4'].includes(i.sku));
    const got = await V.imDlDownload(false, '');
    ok('no critical row: no live read at all, the file at once', !V.liveCalls.some(c => c.limg === 'get') && got.critical === 0 && got.rows === 3);
  }

  console.log('== both brands, the filter option, the menu ==');
  const both = P.imDlRows(['SP', 'CPC'], '');
  ok('Both brands: CPC\'s C1 (no main, stock 3) is in, C2 (stock 0) is not', both.some(r => r.sku === 'C1' && r.cells[0] === 'CPC' && r.cells[11] === 'Yes') && !both.some(r => r.sku === 'C2') && both.length === 6, both.map(r => r.sku).join());
  ok('Only this filter ("Too small"): only K3', P.imDlRows(['SP'], 'small').map(r => r.sku).join() === 'K3');
  P.el('imFilter').value = 'small';
  const menu = P.imDlMenuHtml();
  ok('the menu with a card\'s filter on: This brand / Both brands, and "Only this filter: Too small (under 2000)" / "All picture problems"', /This brand \(Ridhi\)/.test(menu) && /Both brands/.test(menu)
    && /value="filter" checked> Only this filter: Too small \(under 2000\)/.test(menu) && /value="all"> All picture problems/.test(menu));
  P.el('imFilter').value = 'all';
  ok('…no filter on, or a picker filter that is not a card: no Rows question', !/Only this filter/.test(P.imDlMenuHtml()) && (() => { P.el('imFilter').value = 'diff'; const m = P.imDlMenuHtml(); P.el('imFilter').value = 'all'; return !/Only this filter/.test(m); })());
  const one = await P.imDlDownload(true, 'small');
  ok('Download (both brands, only "Too small"): Both in the name, 1 listing (K3, read live: critical)', /^image-errors_Both_\d{4}-\d{2}-\d{2}_\d{4}\.csv$/.test(one.name) && one.rows === 1 && one.critical === 1, one.name);

  console.log('== FULL SIZE: both brands, ~4,400 listings — seconds, and screen = sheet ==');
  {
    const big = (b, n) => Array.from({ length: n }, (_, i) => {
      const sku = `${b}-${i}`;
      const nPics = i % 9 === 0 ? 5 : 9;
      const it = { sku, psku: `${b}P${Math.floor(i / 12)}`, pa: `B0${b}P${Math.floor(i / 12)}`, asin: `B0${b}${String(i).padStart(6, '0')}`, c: 'Red', z: '60x90',
        st: i % 97 === 0 ? 'BUYABLE' : 'BUYABLE,DISCOVERABLE', iss: i % 61 === 0 ? [{ s: 'E', c: '18320', m: 'The main image is missing or incorrect', a: ['main_product_image_locator'] }] : [],
        img: full(sku, nPics), live: full(sku, nPics) };
      if (i % 53 === 0) { delete it.img.MAIN; delete it.live.MAIN; }
      if (i % 41 === 0) delete it.img.MAIN;
      return it;
    });
    const V = page({}, 30);
    const parents = (b, n) => Array.from({ length: Math.ceil(n / 12) }, (_, p) => ({ sku: `${b}P${p}`, lvl: 'parent', asin: `B0${b}P${p}`, t: `Family ${b} ${p}`, img: {}, live: {}, iss: [] }));
    V.IML.SP = { at: new Date(), items: parents('SP', 2680).concat(big('SP', 2680)) };
    V.IML.CPC = { at: new Date(), items: parents('CPC', 1720).concat(big('CPC', 1720)) };
    ['SP', 'CPC'].forEach(b => { V.HEALTH[b].rows = V.IML[b].items.filter(i => i.lvl !== 'parent').map((i, k) => ({ sku: i.sku, asin: i.asin, parent: i.pa, title: 't', qty: k % 7 === 0 ? 0 : 4, status: 'Active', channel: 'AFN' })); });
    V.IML.SP.items.concat(V.IML.CPC.items).forEach(i => Object.values(i.live || {}).forEach(u => { if (u) V.IMQ.dims.set(V.imqId(u), [i.sku.endsWith('3') ? 1500 : 2000, i.sku.endsWith('3') ? 1500 : 2000]); }));
    // Amazon answers each live read in 30 ms (four at a time), like the backend on a quiet day
    const t0 = performance.now();
    const got = await V.imDlDownload(true, '');
    const ms = Math.round(performance.now() - t0);
    const liveReads = new Set(V.liveCalls.filter(c => c.limg === 'get').map(c => c.sku)).size;
    console.log(`    both brands: ${got.rows} rows of ${V.IML.SP.items.length + V.IML.CPC.items.length} listings · ${got.critical} critical read live (30 ms each, 4 at a time): ${got.liveMs} ms · the sheet itself ${got.ms - got.liveMs} ms · ${ms} ms in all`);
    ok('the sheet for ~4,400 listings is built in under 2 seconds, without any live read but the critical rows', got.ms - got.liveMs < 2000 && liveReads === got.critical && got.critical < got.rows / 4, `${got.ms - got.liveMs} ms, ${liveReads} live of ${got.rows}`);
    const same = screenVsSheet(V, ['SP', 'CPC'], got);
    ok('SCREEN = SHEET at full size: every card (both brands) = its column', Object.values(same.cards).every(([a, b]) => a === b), JSON.stringify(same.cards));
    ok('…and every row\'s problems = its chips', same.rowsOk, same.bad.slice(0, 5).join(' · '));
    console.log('    per check, screen (stock > 0) = sheet:');
    Object.entries(same.cards).forEach(([k, [a, b]]) => console.log(`      ${k.padEnd(34)} ${String(a).padStart(4)}  ${String(b).padStart(4)}`));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
