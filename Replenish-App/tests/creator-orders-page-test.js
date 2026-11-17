/* Content Creators page (src/app/shopify/creator-orders.js): how a line's name, colour and size are shown, and where they
 * come from when the SKU is changed (Khushi, 17 Nov). The real file, run in Node with the page's surroundings faked.
 *   node Replenish-App/tests/creator-orders-page-test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'shopify', 'creator-orders.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const MDB = {
  'RTC130-6060': { sku: 'RTC130-6060', articleType: 'Tablecloth', subtype: 'Square', color: 'Ruby Red', size: '60" x 60"' },
  'RTR14-14108': { sku: 'RTR14-14108', articleType: 'Table Runner', subtype: '', color: 'Sage', size: '' },
  'NOSIZE-1': { sku: 'NOSIZE-1', articleType: 'Napkin', color: 'Indigo', size: '-' },
};
const FETCHED = { 'NEW-SKU-9': { sku: 'NEW-SKU-9', articleType: 'Pillow Cover', color: 'Sea Blue', size: '20" x 20"' } };
const asked = [];
const ctx = {
  console, location: { hash: '' },
  $: () => null,                                     // no page: the menu item and pane are not made
  obUC: s => String(s == null ? '' : s).trim().toUpperCase(),
  mdbOf: s => MDB[String(s || '').trim().toUpperCase()],
  mdbFetchSku: async s => { asked.push(s); return FETCHED[String(s).toUpperCase()] || null; },
  SHOP_STOCK: { 'AMZ-ONLY': 3 },
};
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const run = js => vm.runInContext(js, ctx);

(async () => {
  console.log('== a line is shown as name · colour · size ==');
  ok(run(`croLineDesc({ title: 'Tablecloth', color: 'Ruby Red', size: '60" x 60"' })`) === 'Tablecloth · Ruby Red · 60" x 60"', 'Khushi\'s example: Tablecloth · Ruby Red · 60" x 60"');
  ok(run(`croLineDesc({ title: 'Table Runner', color: 'Sage', size: '' })`) === 'Table Runner · Sage', 'an empty size shows nothing — no dash, no trailing dot');
  ok(run(`croLineDesc({ title: 'Napkin', color: 'Indigo', size: '-' })`) === 'Napkin · Indigo', 'a size of "-" counts as empty too');
  ok(run(`croLineDesc({ title: 'Napkin', color: 'Indigo', size: '  ' })`) === 'Napkin · Indigo', 'spaces only count as empty');
  ok(run(`croLineDesc({ title: '', color: '', size: '' })`) === '', 'nothing at all is an empty string, not a dash');
  ok(run(`croLineDesc(null)`) === '', 'no line at all does not throw');

  console.log('== the product list fills a changed SKU ==');
  const f = run(`croSkuFacts('rtc130-6060')`);
  ok(f && f.title === 'Tablecloth' && f.color === 'Ruby Red' && f.size === '60" x 60"', 'the master\'s article, colour and size (any letter case)');
  ok(run(`croLineDesc(croSkuFacts('RTR14-14108'))`) === 'Table Runner · Sage', 'a product with no size in the master shows none');
  const g = await run(`croSkuFactsNow('NEW-SKU-9')`);
  ok(g && g.color === 'Sea Blue' && g.size === '20" x 20"' && asked.includes('NEW-SKU-9'), 'a SKU not in this page\'s copy is asked of the database, one row');
  asked.length = 0;
  await run(`croSkuFactsNow('RTC130-6060')`);
  ok(asked.length === 0, 'a SKU the page already knows is not asked again');
  ok((await run(`croSkuFactsNow('NOPE-1')`)) === null, 'a SKU nobody knows answers null');

  console.log('== the screens use it ==');
  ok(/croLineDesc\(l\)/.test(SRC.slice(SRC.indexOf('function croRender'), SRC.indexOf('function croOpen'))), 'the table\'s Product cell uses croLineDesc');
  ok(/data-cro-name="\$\{i\}">\$\{esc\(croLineDesc\(l\)\)\}/.test(SRC), 'the drawer\'s Product cell uses croLineDesc, with no dash fallback');
  const save = SRC.slice(SRC.indexOf('async function croSaveDrawer'), SRC.indexOf('/* ---------------- MCF'));
  ok(/await croSkuFactsNow\(sku\)/.test(save) && /color: \(f && f\.color\)/.test(save) && /size: \(f && f\.size\)/.test(save), 'saving a changed SKU takes colour and size from the product list');
  ok(/is not in the product list — pick it from the list/.test(save), 'a SKU the list does not know (and FBA does not stock) is refused');
  const open = SRC.slice(SRC.indexOf('function croOpen'), SRC.indexOf('async function croSaveDrawer'));
  ok(/await croSkuFactsNow\(typed\)/.test(open), 'typing a SKU in the drawer shows its colour and size at once');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
