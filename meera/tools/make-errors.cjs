/* EVERY ERROR THE ERP CAN SHOW, FOR MEERA — meera/client/src/legacy/guide-errors.ts, made from the screens' own code
 * (v2 rebuild, Phase 6, 2 Nov 2026; first made 22 Oct by handoff/guide-tools/extract-errors.js + make-errors.js, joined
 * here and pointed at this repository).
 *
 *   node meera/tools/make-errors.cjs           writes guide-errors.ts
 *   node meera/tools/make-errors.cjs --check   only says whether it is up to date (exit 1 if not) — run on every push
 *
 * Read off Replenish-App/src/app: calls like xxMsg('text', true) / ptDlgMsg(`text`, true) / pksSay("text", true), and
 * `return 'text'` in the guards forms show in red. Each message is kept as its longest fixed piece (whatever SKU, order or
 * number went into it), lower case, with the screen it belongs to (by the file's name). */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'Replenish-App', 'src', 'app');
const OUT = path.join(ROOT, 'meera', 'client', 'src', 'legacy', 'guide-errors.ts');

function extract() {
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) files.push(p); } })(APP);
  files.sort();
  const out = [];
  const clean = s => s.replace(/\$\{[^}]*\}/g, '{…}').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\s+/g, ' ').trim();
  for (const f of files) {
    if (/guide|meera-bridge/.test(f)) continue;
    const rel = path.relative(APP, f).replace(/\\/g, '/');
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(ln => {
      const re = /\b([a-zA-Z]*(?:Msg|Say|Err))\(\s*(['"`])((?:\\.|(?!\2).)*)\2\s*(?:\+[^,]*)?,\s*(true|1)\s*\)/g;
      let m;
      while ((m = re.exec(ln))) out.push({ file: rel, text: clean(m[3]) });
      const g = /\breturn\s+(['"`])((?:\\.|(?!\1).){12,})\1\s*;/.exec(ln);
      if (g && /^[A-Z"“{]/.test(g[2]) && !/^(https?:|\/|#|<|[a-z]+\/)/.test(g[2]) && /\s/.test(g[2])) out.push({ file: rel, text: clean(g[2]) });
    });
  }
  const seen = new Set();
  return out.filter(r => { const k = r.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
const TAB = [
  [/job-work|look-alike/, 'pbase'], [/quality-control|flow-qcfg/, 'qc'], [/attendance/, 'att'], [/press/, 'ppress'],
  [/pack-scan|packing-list|fba-box/, 'pack'], [/finished-goods|fg-|store\.js|pack-verify/, 'fgi'], [/fba-ship|fba-dispatch/, 'fba'],
  [/shopify-orders|returns|shopify-copy|bulk-entry|bucket-excel|production-to-make|imported-orders/, 'shop'],
  [/raise-sales-order|sales-orders|quantity-changes|delete-requests|reserve/, 'so'], [/customer-orders/, 'cx'],
  [/order-console|orders-one-line|close-lines|production-to-shipping|custom-order/, 'ord'],
  [/fabric-flow|greige-po|accessories|fabric\.js/, 'fab'], [/greige-desk/, 'gdesk'], [/flow-/, 'flow'],
  [/master-database|sku-codes|asin/, 'pmdb'], [/fabric-master|masters/, 'mst'], [/printer-rates|payouts|vendor-payout|finance/, 'hr'],
  [/vendors\/orders|place-vendor/, 'vord'], [/vendors\/rfd|order-driven-rfd|ask-for-now/, 'rfd'], [/vendor-portal|phone-pin|vendor-master/, 'vend'],
  [/printer-capacity|design-sheet|fabric-catalogue/, 'palloc'], [/replenishment\.js|purchase-orders|revenue-target/, 'repl'], [/top-asin/, 'top'],
  [/shopify-stock/, 'shopify'], [/reports|meeting|day-by-day|karigar-analysis|charts/, 'rep'], [/amazon-listing/, 'fgi'],
];
const tabOf = f => (TAB.find(([re]) => re.test(f)) || [null, ''])[1];

function make() {
  const data = [], seen = new Set();
  for (const r of extract()) {
    const parts = r.text.split('{…}').map(p => p.replace(/^[\s:—–\-,.]+|[\s:—–\-,]+$/g, '').trim()).filter(Boolean);
    const best = parts.sort((a, b) => b.length - a.length)[0] || '';
    if (best.length < 10) continue;
    const key = best.toLowerCase().slice(0, 90);
    if (seen.has(key)) continue;
    seen.add(key);
    data.push([key, tabOf(r.file)]);
  }
  const head = `/* EVERY ERROR THE ERP CAN SHOW, for Meera: [the message's longest fixed piece, lower case; the screen it belongs to].
 * Read off the screens' own code (every red message line, and every rule a form checks before it saves), so when
 * someone pastes or asks about a message, Meera knows which screen it is from and why it happens (gaWhy in
 * guide-ask.ts). ${data.length} messages. MADE BY meera/tools/make-errors.cjs — do not edit; when screens change, it is
 * made again (her gate says so on every push). */
const GUIDE_ERRS = [
`;
  return (head + data.map(([k, t]) => '  [' + JSON.stringify(k) + ', ' + JSON.stringify(t) + ']').join(',\n') + '\n];\n').replace(/\n/g, '\r\n');
}

const now = make();
if (process.argv.includes('--check')) {
  const was = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (was !== now) { console.log('meera/client/src/legacy/guide-errors.ts is NOT up to date with the screens — run node meera/tools/make-errors.cjs, then her gate'); process.exit(1); }
  console.log('guide-errors.ts is up to date with the screens');
} else {
  fs.writeFileSync(OUT, now);
  console.log('wrote guide-errors.ts: ' + (now.match(/\r\n  \["/g) || []).length + ' messages');
}
