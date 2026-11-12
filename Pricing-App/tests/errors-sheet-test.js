/* Download errors (12 Nov 2026): the Workspace's "⬇ Download errors (N)" sheet — the listings the Error card and its "check again"
 * link count, one row per Error-level problem — over the sample in listing-rules-test.js.
 *   node tests/errors-sheet-test.js */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const DAY = 86400000;
const ymd = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// A CSV line into its cells (quoted cells, "" inside them).
const cellsOf = line => {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inQ = false; else cur += ch; }
    else if (ch === '"') inQ = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
};
const MSG = 'The value provided for “material” is not valid for this product type. Use one of the valid values listed in the style guide.';

const C = load({ ws: true });
const now = Date.now();
C.LI_WS.stored = true;
// R6: 3 in stock but Inactive (an Error, not live) · R2: Amazon reports an error, with its message (live read) · R13: 4 pictures,
// an Error from a content read 10 days old (check again) · C1c on CPC: Inactive with stock.
Object.assign(C.rows.find(r => r.sku === 'R6'), { status: 'Inactive', qty: 3 });
C.LI_WS.live.SP.R2 = { at: now, gAt: now, st: ['BUYABLE', 'DISCOVERABLE'], iss: [{ s: 'E', c: '8541', m: MSG }] };
C.rows.find(r => r.sku === 'R13').checked = now - 10 * DAY;
Object.assign(C.rows.find(r => r.sku === 'C1c'), { status: 'Inactive', qty: 7 });
C.LI_WS.liveV++; C.reset();

const view = (brand, search) => {
  C.el('hBrandView').value = brand; C.el('hFilter').value = search || '';
  C.LI_WS.on = true; C.LI_WS.mode = 'live'; C.LI_WS.card = ''; C.LI_WS.chip = 'all'; C.LI_WS.sweep = null;
  C.liWsRender();
  const html = C.el('liWs').innerHTML;
  const brands = brand === 'ALL' ? ['SP', 'CPC'] : [brand];
  const scoped = C.liWsSearch(C.liWsParents(brands));
  const sheet = C.liWsErrorsCsv(scoped, brand, now);
  const lines = sheet.text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
  const btnN = +(((html.match(/data-li-ws-dl="1"[^>]*>⬇ Download errors \(([\d,]+)\)/) || [])[1]) || '-1').replace(/,/g, '');
  const cardN = scoped.reduce((s, p) => s + p.cardN.err + p.cardN.chk, 0);
  return { html, sheet, head: cellsOf(lines[0]), rows: lines.slice(1).map(cellsOf), btnN, cardN };
};

console.log('== the button ==');
const A = view('ALL');
ok('"⬇ Download errors (N)" sits in the bar beside Sort again / Check live listings on Amazon, as a ghost button',
  /<div class="li-ws-barr">[^]*class="ghost li-ws-sweep"[^]*<button type="button" class="ghost li-ws-dl" data-li-ws-dl="1"[^>]*>⬇ Download errors \(\d+\)<\/button><\/div><\/div>/.test(A.html));
ok(`N = the Error card's listings + its "check again" ones (${A.cardN})`, A.btnN === A.cardN && A.btnN > 0, A.btnN + ' vs ' + A.cardN);

console.log('== the file ==');
ok('name Sellora-errors-Both-YYYY-MM-DD.csv (today)', A.sheet.name === `Sellora-errors-Both-${ymd(now)}.csv`, A.sheet.name);
ok('UTF-8 with a BOM, Windows line ends, every text cell quoted', A.sheet.text.startsWith('﻿"Brand","Parent name"') && /\r\n/.test(A.sheet.text) && !/[^\r]\n/.test(A.sheet.text));
ok('the headers, in order', A.head.join('|') === 'Brand|Parent name|Parent ASIN|SKU|ASIN|Product|Live?|Stock (units)|Error|Details|How to fix|Status|Checked on|Errors on this listing|Amazon link', A.head.join('|'));
const col = name => A.head.indexOf(name);
const skus = new Set(A.rows.map(r => r[col('Brand')] + '|' + r[col('SKU')]));
ok('distinct SKUs in the file = N on the button', skus.size === A.btnN && A.sheet.skus === A.btnN, skus.size + ' vs ' + A.btnN);
const kids = C.liWsParents(['SP', 'CPC']).flatMap(p => p.kids).filter(k => k.cards.err || k.cards.chk);
ok('one row per error: rows = the Error-level problems of those listings', A.rows.length === kids.reduce((s, k) => s + k.found.filter(h => h.sev === 'critical').length, 0), A.rows.length);
ok('…and "Errors on this listing" counts them', A.rows.every(r => +r[col('Errors on this listing')] === A.rows.filter(x => x[col('SKU')] === r[col('SKU')] && x[col('Brand')] === r[col('Brand')]).length));
ok('only Error-level problems: no Needs attention row (R2\'s size rule is not in it)', !A.rows.some(r => /Size formatting/.test(r[col('Error')])) && A.rows.every(r => kids.some(k => k.sku === r[col('SKU')])));
const sorted = A.rows.map(r => [r[0], r[1], r[2], r[3]]);
const cmp = (a, b) => { for (let i = 0; i < 4; i++) { const c = a[i].localeCompare(b[i]); if (c) return c; } return 0; };
ok('sorted by brand → parent → SKU', sorted.every((v, i) => !i || cmp(sorted[i - 1], v) <= 0), sorted.map(v => v.join('/')).join(' ; '));
const r6 = A.rows.find(r => r[col('SKU')] === 'R6');
ok('R6: "Stock but Inactive", Live? "Not live — has stock", 3 units, Confirmed, the fix line, the Amazon link',
  r6 && r6[col('Error')] === 'Stock but Inactive' && r6[col('Live?')] === 'Not live — has stock' && r6[col('Stock (units)')] === '3' && r6[col('Status')] === 'Confirmed'
  && r6[col('How to fix')] === 'It has stock but is Inactive. Open Listing Errors to see why.' && r6[col('Amazon link')] === 'https://www.amazon.com/dp/' + r6[col('ASIN')], JSON.stringify(r6));
const r2 = A.rows.find(r => r[col('SKU')] === 'R2' && r[col('Error')] === 'Amazon reports an error');
ok('R2: Amazon\'s own message in Details, whole', r2 && r2[col('Details')].includes(MSG) && r2[col('Live?')] === 'Live' && r2[col('How to fix')] === 'Open Listing Errors and do what Amazon asks.', JSON.stringify(r2));
ok('…with the date of that read', r2 && r2[col('Checked on')] === ymd(now));
const r13 = A.rows.find(r => r[col('SKU')] === 'R13');
ok('R13: "Check again — data 10 days old", Checked on the day of that data', r13 && r13[col('Status')] === 'Check again — data 10 days old' && r13[col('Checked on')] === ymd(now - 10 * DAY), JSON.stringify(r13));
ok('Product: colour · size from the catalogue', r6 && r6[col('Product')] === 'Blue · 18x18', r6 && r6[col('Product')]);
ok('the Parent name and Parent ASIN', r6 && r6[col('Parent name')] === 'Parent P1' && r6[col('Parent ASIN')] === 'P1');

console.log('== the brand switch and the search change N and the file the same way ==');
const S = view('SP'), K = view('CPC'), Q = view('ALL', 'R6');
ok('Ridhi only: N and the file\'s SKUs agree, all Ridhi, the name says Ridhi', S.btnN === S.sheet.skus && S.rows.every(r => r[0] === 'Ridhi') && /^Sellora-errors-Ridhi-/.test(S.sheet.name), S.btnN + ' ' + S.sheet.skus);
ok('CPC only: the same, all CPC', K.btnN === K.sheet.skus && K.btnN >= 1 && K.rows.every(r => r[0] === 'CPC') && /^Sellora-errors-CPC-/.test(K.sheet.name), K.btnN + ' ' + K.sheet.skus);
ok('the two brands add up to Both', S.btnN + K.btnN === A.btnN && S.rows.length + K.rows.length === A.rows.length);
// The search box keeps whole parents (as the list does): "R6" keeps parent P1, so its three Error listings (R2, R6, R13).
ok('search "R6": the parent P1 in view — N = 3 and the file holds its 3 Error listings only', Q.btnN === 3 && Q.sheet.skus === 3 && Q.rows.every(r => r[2] === 'P1'), Q.btnN + ' ' + JSON.stringify(Q.rows.map(r => r[3])));
const Q2 = view('ALL', 'C1c');
ok('search "C1c": N = 1 and the file holds C1c only', Q2.btnN === 1 && Q2.sheet.skus === 1 && Q2.rows.every(r => r[3] === 'C1c'), Q2.btnN + ' ' + JSON.stringify(Q2.rows.map(r => r[3])));
const Z = view('ALL', 'no such listing');
ok('nothing in view: "Download errors (0)", disabled', Z.btnN === 0 && /data-li-ws-dl="1" disabled/.test(Z.html));

console.log('== it only reads ==');
const before = C.calls.length;
C.liWsErrorsCsv(C.liWsParents(['SP', 'CPC']), 'ALL', now);
ok('building the sheet calls nothing and saves nothing', C.calls.length === before);

console.log('\n== the first rows of the sample sheet ==');
A.sheet.text.replace(/^﻿/, '').split('\r\n').slice(0, 4).forEach(line => console.log('  ' + line));
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
