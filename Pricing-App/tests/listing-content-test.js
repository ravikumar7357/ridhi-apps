/* Listing content (src/app/listing/listing-content.js) with the real Listing Rules (listing-rules.js) behind it.
 *   node tests/listing-content-test.js */
const fs = require('fs'), path = require('path');
const L = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', f), 'utf8');
const SRC = L('listing-rules.js') + '\n' + L('listing-content.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

function load(opts) {
  opts = opts || {};
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: id === 'leBrand' ? 'SP' : '', innerHTML: '', textContent: '', disabled: false, files: [] });
  const calls = [];
  const ctx = {
    $: el, document: { querySelectorAll: () => [], createElement: () => ({ click() {} }) }, URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} }, Blob: class { constructor(p) { this.p = p; } },
    BRAND_NAME: { SP: 'Ridhi', CPC: 'Cotton Print Club' }, getDoc: async () => ({ exists: () => false }), setDoc: async () => {}, doc: () => ({}), db: {}, serverTimestamp: () => 0,
    baCall: async p => { calls.push(p); if (p.lfix === 'content') return { ok: true, items: Object.fromEntries(p.skus.split(',').filter(s => opts.content && opts.content[s]).map(s => [s, opts.content[s]])) }; if (p.sales === 'cat') return { map: opts.cat || {} }; return {}; },
    imPost: async b => { calls.push(b); return opts.post ? opts.post(b) : { ok: true, previewOnly: !b.apply, status: 'VALID', submissionId: 'sub123456789' }; },
    ME: { email: 't' }, LE: null, LE_EDIT: {}, leEsc: s => String(s == null ? '' : s), leMsg: () => {}, leRows: () => opts.rows || [], confirm: () => true, setTimeout,
    TextEncoder, TextDecoder, DecompressionStream, Response, Uint8Array, DataView,
  };
  const api = new Function(...Object.keys(ctx), SRC + '\n;LR = JSON.parse(JSON.stringify(LR_DEFAULT)); LR_CAT.SP = ' + JSON.stringify(opts.cat || {}) + '; LR_CAT.CPC = {};'
    + '\n;return { lcCheck, lcTemplateTitle, lcSuggestKeywords, lcColumns, lcXlsx, lcReadXlsx, lcCsv, lcBytes, lcUpload, lcUpSend, getUp: () => LC_UP, LR_DEFAULT };')(...Object.values(ctx));
  return Object.assign(api, { els, el, calls });
}
const has = (list, re) => list.some(f => re.test(f.msg));

(async () => {
  const cat = { 'RTC1-6090': { color: 'Indigo Blue', size: '60x90', subcat: 'Rectangle Tablecloth' }, 'RCN1': { color: 'Sage', size: '20x20', subcat: 'Napkin Set' } };
  const A = load({ cat });

  console.log('== the rules on each field ==');
  ok('a 210-character title is refused', A.lcCheck('item_name', ['x'.repeat(210)]).some(f => f.bad && /200/.test(f.msg)));
  ok('a 120-character title is flagged for the 75 rule, not refused', (r => !r.some(f => f.bad) && has(r, /75 or less/))(A.lcCheck('item_name', ['Ridhi Block Print '.repeat(7)])));
  ok('a size written another way is flagged', has(A.lcCheck('item_name', ['Ridhi Tablecloth 60x90 Block Print']), /Size "60x90"/));
  ok('a title missing the required words is flagged', has(A.lcCheck('item_name', ['Ridhi Cotton Tablecloth']), /needs one of "Block Print"/));
  const easterOut = A.lcCheck('item_name', ['Ridhi Block Print Napkins for Easter']);
  ok('an occasion out of season is flagged (Easter, in October)', has(easterOut, /Easter, which is out of season/), JSON.stringify(easterOut));
  ok('three bullets: the rules want five', has(A.lcCheck('bullet_point', ['a', 'b', 'c']), /3 bullet\(s\) — Listing Rules want 5/));
  ok('a 600-character bullet is refused', A.lcCheck('bullet_point', ['x'.repeat(600)]).some(f => f.bad));
  ok('a bullet repeated is flagged', has(A.lcCheck('bullet_point', ['Soft cotton', 'soft cotton ']), /repeats bullet 1/));
  ok('a short description is flagged', has(A.lcCheck('product_description', ['Nice']), /at least 200/));
  ok('search terms over 249 bytes are refused', A.lcCheck('generic_keyword', ['word '.repeat(60)]).some(f => f.bad && /249/.test(f.msg)));
  ok('bytes, not characters: é is two', A.lcBytes('é') === 2);
  ok('search words already in the title are named as wasted', has(A.lcCheck('generic_keyword', ['tablecloth linen'], { title: 'Ridhi Tablecloth' }), /tablecloth/));

  console.log('== suggestions come only from Listing Rules ==');
  const full = A.lcTemplateTitle('SP', 'RTC1-6090', 200), short = A.lcTemplateTitle('SP', 'RTC1-6090', 75);
  ok('the template title for a tablecloth', /^Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch/.test(full) && /- Indigo Blue$/.test(full), full);
  ok('the 75 version fits and keeps brand, product, size and colour', short.length <= 75 && /^Ridhi Tablecloth/.test(short) && /60 x 90 Inch/.test(short) && /Indigo Blue/.test(short), short + ' (' + short.length + ')');
  ok('no template for a SKU the catalogue does not hold', A.lcTemplateTitle('SP', 'UNKNOWN', 200) === '');
  const kw = A.lcSuggestKeywords('SP', 'RTC1-6090', short, 'washable');
  ok('search terms: template words the title lacks, never past 249 bytes', /dining/.test(kw) && !/\btablecloth\b/.test(kw) && A.lcBytes(kw) <= 249 && /washable/.test(kw), kw);

  console.log('== Excel: out and back in ==');
  const head = ['SKU', 'ASIN', 'Title', 'Suggested title (Listing Rules)', 'Bullet 1', 'Bullet 2', 'Description', 'Search terms'];
  const bytes = A.lcXlsx([head, ['RTC1-6090', 'B01', 'New title', 'ignored', 'B one', '', 'A <good> & "fine" description', 'kw1 kw2'], ['RCN1', 'B02', '', '', '', '', '', '']]);
  const back = await A.lcReadXlsx(bytes);
  ok('what is written reads back exactly (escaping included)', back[1][0] === 'RTC1-6090' && back[1][6] === 'A <good> & "fine" description' && back[0][7] === 'Search terms', JSON.stringify(back[1]));
  const c = A.lcColumns(back);
  ok('columns are found by name, suggestions are not read', c.sku === 0 && c.title === 2 && c.desc === 6 && c.kw === 7 && c.bullets.join() === '4,5');
  ok('CSV works too, quotes and commas included', A.lcCsv('SKU,Title\n"X1","A, ""quoted"" title"\n')[1][1] === 'A, "quoted" title');

  console.log('== upload: compared with Amazon now, then sent row by row ==');
  const content = {
    'RTC1-6090': { productType: 'TABLECLOTH', item_name: [{ value: 'Old title', language_tag: 'en_US' }], bullet_point: [{ value: 'B one', language_tag: 'en_US' }],
      product_description: [{ value: 'x'.repeat(300), language_tag: 'en_US' }], generic_keyword: [] },
    'RCN1': { productType: 'CLOTH_NAPKIN', item_name: [{ value: 'Same', language_tag: 'en_US' }], bullet_point: [], product_description: [], generic_keyword: [] },
  };
  const U = load({ cat, content });
  const file = { name: 'c.xlsx', arrayBuffer: async () => U.lcXlsx([head,
    ['RTC1-6090', 'B01', 'Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch Block Print - Indigo Blue', 'x', 'B one', '', '', 'dining kitchen'],
    ['RCN1', 'B02', 'Same', '', '', '', '', ''], ['NOPE', '', 'T', '', '', '', '', '']]).buffer };
  await U.lcUpload(file);
  const up = U.getUp();
  const r1 = up.rows.find(r => r.sku === 'RTC1-6090');
  ok('only what changed becomes a patch (title + search terms; bullet and empty description left alone)',
    r1.patches.map(p => p.path).sort().join() === '/attributes/generic_keyword,/attributes/item_name', JSON.stringify(r1.patches.map(p => p.path)));
  ok('…carrying the language Amazon sent', r1.patches.every(p => p.value.every(v => v.language_tag === 'en_US')));
  ok('…and the product type for the patch', r1.productType === 'TABLECLOTH');
  ok('an unchanged row sends nothing', up.rows.find(r => r.sku === 'RCN1').state === 'same');
  ok('a SKU Amazon does not know is named, not sent', up.rows.find(r => r.sku === 'NOPE').state === 'skip');
  U.el('lcUpCheck'); U.el('lcUpApply'); U.el('lcUpMsg');
  await U.lcUpSend(false);
  const checks = U.calls.filter(c => c.lfix === 'patch');
  ok('Check sends previews only', checks.length === 1 && checks[0].apply === false && r1.state === 'checked');
  await U.lcUpSend(true);
  const applies = U.calls.filter(c => c.lfix === 'patch' && c.apply);
  ok('Apply sends the checked row for real, and nothing else', applies.length === 1 && applies[0].sku === 'RTC1-6090' && r1.state === 'sent');
  const BadRules = load({ cat, content });
  await BadRules.lcUpload({ name: 'b.xlsx', arrayBuffer: async () => BadRules.lcXlsx([head, ['RTC1-6090', '', 'y'.repeat(230), '', '', '', '', '']]).buffer });
  ok('a row the rules refuse (title over 200) is never sent', BadRules.getUp().rows[0].state === 'bad');
  await BadRules.lcUpSend(true);
  ok('…not even on Apply all', !BadRules.calls.some(c => c.lfix === 'patch'));
  const Stops = load({ cat, content: Object.fromEntries([1, 2, 3, 4, 5].map(i => ['S' + i, content['RTC1-6090']])), post: () => ({ ok: false, error: 'nope' }) });
  await Stops.lcUpload({ name: 's.xlsx', arrayBuffer: async () => Stops.lcXlsx([head].concat([1, 2, 3, 4, 5].map(i => ['S' + i, '', 'Title ' + i, '', '', '', '', '']))).buffer });
  await Stops.lcUpSend(true);
  ok('three refusals in a row stop the run', Stops.calls.filter(c => c.lfix === 'patch').length === 3);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
