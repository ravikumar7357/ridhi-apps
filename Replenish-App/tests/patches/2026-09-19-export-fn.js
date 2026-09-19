/* The book export's rows become a function, so that what goes into the file can be asked about — the
 * stub DOM only ever hears the file's NAME. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const A = "  /* Two columns here, not the one the table stacks: a spreadsheet is sorted and filtered on them\n   * separately. */\n  const lines = [['Order No', 'Shopify Order', 'Adjustment', 'Date', 'SKU', 'Priority', 'Article', 'Subtype', 'Color', 'Size', 'Ordered', 'Cut',";
const B = "  ptDownload('order-console', lines);";
const i = s.indexOf(A), j = s.indexOf(B, i);
if (i < 0 || j < 0 || s.indexOf(A, i + 1) >= 0) throw new Error('export block not found exactly once');
const block = s.slice(i, j);
const H = "$('odExport').onclick = () => {";
if (s.split(H).length !== 2) throw new Error('handler anchor');
s = s.slice(0, i) + "  ptDownload('order-console', ordBookCsv(rows));" + s.slice(j + B.length);
s = s.replace(H, () => "/** The order book as CSV lines — a function so that a test can read the file and not only its name. */\nfunction ordBookCsv(rows) {\n" + block + "  return lines;\n}\n\n" + H);
fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('export rows are now ordBookCsv(rows)');
