/* THE APP'S PARTS, from its code: every button, column, box, option and hover note, with the screen it belongs to and
 * where it is (file:line). The skeleton writers fill in ("what it does / shows"), and the check that finds new parts.
 *   node extract.js <Replenish-App folder> [out.json] → parts.json (and a count per screen) */
const fs = require('fs'), path = require('path');
const ROOT = process.argv[2] || 'C:/Users/User/AppData/Local/Temp/claude/C--AMAZON/ed699ac6-3b39-4920-a5f4-bfdb7eb0cd75/scratchpad/wt2/Replenish-App';
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]);
const clean = s => s.replace(/<[^>]+>/g, ' ').replace(/\$\{[^}]*\}/g, '…').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();

/* the screen of a file in src/app, by its folder and name; index.html by the pane it sits in */
const FILE_TAB = [
  [/shopify[\\/](returns|shopify-orders|shopify-copy|orders-to-make|production-bucket|bucket-excel|delivery-days|returns-team|production-to-make)/, 'shop'],
  [/@shared[\\/](adjustments)/, 'adj'], [/@shared[\\/](courier|imported)/, 'shop'], [/shopify[\\/]imported/, 'shop'], [/shopify[\\/]bulk-entry/, 'ord'],
  [/orders[\\/](sales-orders|raise-sales-order|quantity-sheet|reserve|delete-requests)/, 'so'], [/orders[\\/]customer-orders/, 'cx'], [/orders[\\/]/, 'ord'],
  [/production[\\/](job-work|whatsapp)/, 'pbase'], [/production[\\/]press/, 'ppress'], [/production[\\/]quality/, 'qc'], [/production[\\/]attendance/, 'att'],
  [/flow[\\/]greige-desk/, 'gdesk'], [/flow[\\/]/, 'flow'],
  [/inventory[\\/](fba-|amazon-listing)/, 'fba'], [/inventory[\\/](fabric|store)/, 'fab'], [/inventory[\\/]accessories/, 'acc'], [/inventory[\\/]/, 'fgi'],
  [/replenishment[\\/](pack-|packing-list|fba-box)/, 'pack'], [/replenishment[\\/]article-review/, 'article'], [/replenishment[\\/]revenue-target/, 'target'],
  [/replenishment[\\/](follow-ups|purchase-orders)/, 'follow'], [/replenishment[\\/]top-asin/, 'top'], [/replenishment[\\/]india-/, 'india'],
  [/replenishment[\\/]shopify-stock/, 'shopify'], [/replenishment[\\/]in-production/, 'prod'], [/replenishment[\\/]/, 'repl'],
  [/dashboard[\\/]/, 'dash'], [/reports[\\/]production-karigar/, 'ka'], [/reports[\\/]/, 'rep'],
  [/people-pay[\\/]/, 'hr'], [/masters[\\/](master-database|asin-from)/, 'pmdb'], [/masters[\\/]/, 'mst'],
  [/vendors[\\/]portal/, 'vend'], [/vendors[\\/]printing[\\/](printer-allocation|printer-capacity|design-sheet)/, 'palloc'], [/vendors[\\/]rfd/, 'rfd'],
  [/vendors[\\/]orders[\\/]vendor-order-requests/, 'vreq'], [/vendors[\\/]orders[\\/]history/, 'vlog'], [/vendors[\\/]/, 'vord'],
  [/core[\\/]/, ''],
];
const tabOfFile = f => { for (const [re, t] of FILE_TAB) if (re.test(f)) return t; return ''; };
const PANE = { Repl: 'repl', Article: 'article', Target: 'target', Follow: 'follow', Top: 'top', India: 'india', Shopify: 'shopify', Prod: 'prod', Pack: 'pack', Att: 'att', Pmdb: 'pmdb', Mst: 'mst', Pbase: 'pbase', Pcut: 'pcut', Ppress: 'ppress', Qc: 'qc', Ord: 'ord', So: 'so', Vord: 'vord', Vreq: 'vreq', Rfd: 'rfd', Vend: 'vend', Vlog: 'vlog', Cx: 'cx', Palloc: 'palloc', Fgi: 'fgi', Fba: 'fba', Fab: 'fab', Acc: 'acc', Rep: 'rep', Pa: 'pa', Ka: 'ka', Hr: 'hr', Shop: 'shop', Adj: 'adj', Flow: 'flow', Gdesk: 'gdesk', Dash: 'dash' };

const parts = [];
const seen = new Set();
function add(kind, label, tab, file, line, id) {
  label = clean(label).slice(0, 90);
  if (label.length < 2 || !/[a-z\u0900-\u097f]/i.test(label)) return;
  const k = kind + '|' + tab + '|' + label.toLowerCase();
  if (seen.has(k)) return;
  seen.add(k);
  parts.push({ kind, label, tab, id: id || '', at: file + ':' + line });
}
const files = [path.join(ROOT, 'src/index.html'), ...walk(path.join(ROOT, 'src/app')).filter(f => f.endsWith('.js') && !/core[\\/]guide/.test(f))];
for (const f of files) {
  const rel = path.relative(path.join(ROOT, 'src'), f).replace(/\\/g, '/');
  const text = fs.readFileSync(f, 'utf8'), lines = text.split(/\r?\n/);
  const isHtml = f.endsWith('.html');
  let pane = '';
  lines.forEach((ln, i) => {
    if (isHtml) { const m = ln.match(/id="pane([A-Z][a-z]+)"/); if (m && PANE[m[1]]) pane = PANE[m[1]]; }
    const tab = isHtml ? pane : tabOfFile(rel);
    const idOf = s => (s.match(/\bid="([\w-]+)"/) || [])[1];
    for (const m of ln.matchAll(/<button\b([^>]*)>([^]*?)<\/button>/g)) add('button', m[2], tab, rel, i + 1, idOf(m[1]));
    for (const m of ln.matchAll(/<th\b[^>]*>([^]*?)<\/th>/g)) add('column', m[1], tab, rel, i + 1);
    for (const m of ln.matchAll(/<(input|textarea|select)\b([^>]*)>/g)) { const ph = (m[2].match(/placeholder="([^"]+)"/) || [])[1]; if (ph) add('box', ph, tab, rel, i + 1, idOf(m[2])); }
    for (const m of ln.matchAll(/<label\b[^>]*>([^]*?)<\/label>/g)) add('box', m[1], tab, rel, i + 1);
    for (const m of ln.matchAll(/<option\b[^>]*>([^<]{2,70})<\/option>/g)) add('option', m[1], tab, rel, i + 1);
    for (const m of ln.matchAll(/\btitle="([^"]{6,140})"/g)) add('note', m[1], tab, rel, i + 1);
  });
}
fs.writeFileSync(process.argv[3] || path.join(__dirname, 'parts.json'), JSON.stringify(parts, null, 1));
const by = {};
parts.forEach(p => { const t = p.tab || '(general)'; by[t] = (by[t] || 0) + 1; });
console.log('parts:', parts.length, '\n' + Object.entries(by).sort((a, b) => b[1] - a[1]).map(([t, n]) => t + ' ' + n).join(' · '));
