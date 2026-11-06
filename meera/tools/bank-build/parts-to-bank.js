/* Every part of the app (button, column, box, option, hover note) with the line a writer gave it → one Meera answer each,
 * with its ways of asking made from its own label. Also the coverage check: parts in the app now that have no line yet.
 *   node tools/parts-to-bank.js <catalog folder> [<Replenish-App folder for the check>]
 * writes ../parts.js (an area file merge.js reads) and prints the coverage. */
const fs = require('fs'), path = require('path');
const CAT = process.argv[2];
const BANK = path.join(__dirname, '..');
if (!CAT) { console.log('usage: node tools/parts-to-bank.js <catalog folder> [<Replenish-App>]'); process.exit(1); }
const parts = require(path.join(CAT, 'parts.json'));
const lines = new Map();
for (const f of fs.readdirSync(CAT).filter(f => /^done-.*-parts\.json$/.test(f)))
  for (const x of JSON.parse(fs.readFileSync(path.join(CAT, f), 'utf8'))) lines.set(x.key, x);

const SCREEN = { shop: 'Shopify Orders', ord: 'Order Console', pack: 'Packing List', fgi: 'Finished Goods', pbase: 'Job Work Register', flow: 'Production flow', qc: 'Quality Control', fba: 'FBA Dispatch', pmdb: 'Master Database', att: 'Attendance', rep: 'Reports', so: 'Sales Orders', cx: 'Customer Orders', top: 'Top ASIN Status', fab: 'Fabric Inventory', repl: 'Replenishment', dash: 'Dashboard', pcut: 'Cutting Data', hr: 'Finance & HR', vord: 'Vendor Orders', acc: 'Accessories', adj: 'Adjustments', shopify: 'Shopify Stock', india: 'India Stock', article: 'Article Review', target: 'Revenue Target', follow: 'Ongoing Purchase Order', prod: 'In Production', ppress: 'Press Inventory', mst: 'Masters', vreq: 'Vendor Order Requests', rfd: 'RFD Requirements', vend: 'Vendor Portal', vlog: 'History', palloc: 'Printer Allocation', pa: 'Production Analysis', ka: 'Karigar Analysis', gdesk: 'Greige Desk' };
const KIND = { button: ['button', 'बटन', 'button'], column: ['column', 'कॉलम', 'column'], box: ['box', 'बॉक्स', 'box'], option: ['option', 'विकल्प', 'option'], note: ['note', 'जानकारी', 'note'] };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const out = [];
parts.forEach((p, i) => {
  const x = lines.get('p' + i);
  if (!x || x.skip || !x.en) return;
  const L = p.label.replace(/[…:]+$/, '').trim(), k = KIND[p.kind] || KIND.button, scr = SCREEN[p.tab];
  if (L.length < 2) return;
  const where = (lang) => (scr ? (lang === 'hi' ? ` — ${scr} पर ${k[1]}` : lang === 'hg' ? ` — ${scr} par ${k[2]}` : ` — ${k[0]} on ${scr}`) : '');
  out.push({
    id: 'c-' + (p.tab || 'any') + '-' + i, tab: p.tab || '', kind: 'part',
    q: {
      en: [L, `what is ${L}`, `what does ${L} do`, `${L} meaning`, `${L} ${k[0]}`],
      hi: [`${L} क्या है`, `${L} का मतलब`, `${L} क्या करता है`],
      hg: [`${L} kya hai`, `${L} kya karta hai`, `${L} ka matlab`, `${L} ${k[2]}`],
    },
    a: { en: `<b>${esc(L)}</b>${esc(where('en'))}: ${esc(x.en)}`, hi: `<b>${esc(L)}</b>${esc(where('hi'))}: ${esc(x.hi || x.en)}`, hg: `<b>${esc(L)}</b>${esc(where('hg'))}: ${esc(x.hg || x.en)}` },
    ...(p.id && p.kind !== 'note' ? { sel: '#' + p.id } : {}),
    part: [L, p.kind, x.en, x.hi || x.en, x.hg || x.en].concat(p.id && p.kind !== 'note' ? ['#' + p.id] : []),
    src: p.at,
  });
});
fs.writeFileSync(path.join(BANK, 'parts.js'), 'module.exports = ' + JSON.stringify(out, null, 1) + ';\n');
const done = [...lines.values()].filter(x => !x.skip).length, skipped = [...lines.values()].filter(x => x.skip).length;
console.log(`parts: ${parts.length} in the app · ${done} explained · ${skipped} not worth a line · ${parts.length - done - skipped} still without a line → ${out.length} answers in parts.js`);

/* the check: what the app has NOW that the catalog has not seen (a new button, a renamed column) */
if (process.argv[3]) {
  const { execFileSync } = require('child_process');
  const tmp = path.join(CAT, 'parts-now.json');
  execFileSync(process.execPath, [path.join(CAT, 'extract.js'), process.argv[3], tmp], { cwd: CAT });
  const now = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  const known = new Set(parts.map(p => p.kind + '|' + p.tab + '|' + p.label.toLowerCase()));
  const fresh = now.filter(p => !known.has(p.kind + '|' + p.tab + '|' + p.label.toLowerCase()));
  console.log(`new in the app since the catalog: ${fresh.length}` + (fresh.length ? '\n' + fresh.slice(0, 40).map(p => `  ${p.tab || '-'} · ${p.kind} · ${p.label}  (${p.at})`).join('\n') : ''));
}
