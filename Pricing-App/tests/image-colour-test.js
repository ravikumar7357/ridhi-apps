/* Image Manager · By colour, Copy to similar, Guided copy (src/app/listing/image-colour.js).
 *   node tests/image-colour-test.js
 * Runs the real files in a stub page (the loader of listing-rules-test.js, opts.im + opts.imc). */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const A = id => 'https://m.media-amazon.com/images/I/' + id + '.jpg';
const OKST = 'BUYABLE,DISCOVERABLE';
/* One family (PAR) of napkins:
 *   Blue 18x18 / 20x20 / 24x24 ('blue ', another spelling) share MAIN a, 01 b1, 02 c, swatch sw; Blue 22x22 has its own MAIN x, 02 c2, no swatch.
 *   06 is the size chart: a different picture on every size.
 *   Red 18x18 (Buyable, 2 pictures) and Red 20x20 (not Buyable, 3 pictures): a tie on every slot → the Buyable one wins.
 *   Green 18x18 has no main at all; N1 has no colour; NOPT has no product type. S1 is another family (a tablecloth, no parent). */
const ITEMS = () => [
  { sku: 'PAR', lvl: 'parent', asin: 'B0PAR', t: 'Napkins', img: { MAIN: A('par') }, live: { MAIN: A('par') } },
  { sku: 'B1', psku: 'PAR', asin: 'B0B1', pt: 'NAPKIN', c: 'Blue', z: '18x18', st: OKST, img: { MAIN: A('a'), PT01: A('b1'), PT02: A('c'), PT06: A('ch18'), SWCH: A('sw') }, live: { MAIN: A('a'), PT01: A('b1'), PT02: A('c'), PT06: A('ch18') } },
  { sku: 'B2', psku: 'PAR', asin: 'B0B2', pt: 'NAPKIN', c: 'Blue', z: '20x20', st: OKST, img: { MAIN: A('a'), PT01: A('b1'), PT02: A('c'), PT06: A('ch20'), SWCH: A('sw') }, live: { MAIN: A('a'), PT01: A('b1'), PT02: A('c'), PT06: A('ch20') } },
  { sku: 'B3', psku: 'PAR', asin: 'B0B3', pt: 'NAPKIN', c: 'Blue', z: '22x22', st: OKST, img: { MAIN: A('x'), PT01: A('b1'), PT02: A('c2'), PT06: A('ch22') }, live: { MAIN: A('x'), PT01: A('b1'), PT02: A('c2'), PT06: A('ch22') } },
  { sku: 'B4', psku: 'PAR', asin: 'B0B4', pt: 'NAPKIN', c: 'blue ', z: '24x24', st: OKST, img: { MAIN: A('a'), PT01: A('b1'), PT02: A('c'), PT06: A('ch18'), SWCH: A('sw') }, live: { MAIN: A('a'), PT01: A('b1'), PT02: A('c'), PT06: A('ch18') } },
  { sku: 'R1', psku: 'PAR', asin: 'B0R1', pt: 'NAPKIN', c: 'Red', z: '18x18', st: OKST, img: { MAIN: A('r1'), PT01: A('r1a') }, live: { MAIN: A('r1'), PT01: A('r1a') } },
  { sku: 'R2', psku: 'PAR', asin: 'B0R2', pt: 'NAPKIN', c: 'Red', z: '20x20', st: 'DISCOVERABLE', img: { MAIN: A('r2'), PT01: A('r2a'), PT02: A('r2b') }, live: { MAIN: A('r2'), PT01: A('r2a'), PT02: A('r2b') } },
  { sku: 'G1', psku: 'PAR', asin: 'B0G1', pt: 'NAPKIN', c: 'Green', z: '18x18', st: OKST, img: { PT01: A('g1') }, live: { PT01: A('g1') } },
  { sku: 'N1', psku: 'PAR', asin: 'B0N1', pt: 'NAPKIN', c: '', z: '18x18', st: OKST, img: { MAIN: A('n1') }, live: { MAIN: A('n1') } },
  { sku: 'NOPT', psku: 'PAR', asin: 'B0NOPT', c: 'Blue', z: '30x30', st: OKST, img: { MAIN: A('a') }, live: { MAIN: A('a') } },
  { sku: 'S1', asin: 'B0S1', pt: 'TABLECLOTH', c: 'Blue', z: '18x18', st: OKST, img: { MAIN: A('s1') }, live: { MAIN: A('s1') } },
];
const SQ = () => ({ sent: [], modal: { html: '' } });
function page(extra) {
  const box = SQ();
  const store = {};
  const P = load(Object.assign({ im: true, imc: true, sq: false, ctx: Object.assign({
    sqSendWithCheck: async (jobs, opts) => { box.sent.push({ jobs, opts }); }, sqField: s => s, sqSummaryText: () => '',
    spModal: h => { box.modal.html = h || ''; },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  }, (extra && extra.ctx) || {}) }, extra && extra.opts));
  P.el('imBrand').value = 'SP';
  P.el('imFilter').value = 'all';
  P.el('imQ').value = '';
  P.IML.SP = { at: new Date(), items: ITEMS() };
  if (!P.IMQ.dims) P.IMQ.dims = new Map();
  return Object.assign(P, { box, store });
}
const kids = P => P.IML.SP.items.filter(i => i.lvl !== 'parent' && i.psku === 'PAR');

(async () => {
  console.log('== grouping by colour, the colour stack, ≠ chips ==');
  {
    const P = page();
    const cols = P.imcColours(kids(P), ['PT06']);
    ok('children grouped by colour: Blue (4 sizes — "blue " is the same colour), Green, Red, No colour last', cols.map(c => c.name + ':' + c.kids.length).join(',') === 'Blue:5,Green:1,Red:2,No colour:1',
      cols.map(c => c.name + ':' + c.kids.length).join(','));
    const blue = cols[0];
    ok('Blue: the colour stack is the majority per slot (MAIN a 4 of 5, 02 c, swatch sw)', blue.stack.MAIN === A('a') && blue.stack.PT01 === A('b1') && blue.stack.PT02 === A('c') && blue.stack.SWCH === A('sw'), JSON.stringify(blue.stack));
    ok('…a slot most sizes leave empty stays empty (03 – 08)', ['PT03', 'PT04', 'PT05', 'PT07', 'PT08'].every(s => blue.stack[s] === ''));
    const red = cols.find(c => c.name === 'Red');
    ok('Red: a tie on every slot goes to the Buyable size (R1: MAIN r1, 01 r1a)', red.stack.MAIN === A('r1') && red.stack.PT01 === A('r1a'), JSON.stringify(red.stack));
    ok('…02: R1 is empty there, so it does not vote — the stack takes R2\'s picture (the only non-empty one)', red.stack.PT02 === A('r2b'));
    ok('…R1 "≠ missing 02": the stack has a picture where R1 is empty', red.sizes.find(s => s.kid.sku === 'R1').diff.join() === 'PT02');
    const P2 = page();
    P2.IML.SP.items.find(i => i.sku === 'R2').st = OKST;
    const red2 = P2.imcColours(kids(P2), ['PT06']).find(c => c.name === 'Red');
    ok('…both Buyable: the size with most pictures wins (R2: MAIN r2)', red2.stack.MAIN === A('r2'), red2.stack.MAIN);
    const diff = Object.fromEntries(blue.sizes.map(s => [s.kid.sku, s.diff.join(',')]));
    ok('≠: B3 differs in MAIN, 02 and the swatch; B1, B2, B4 match; NOPT (only a main) differs in 01, 02, swatch', diff.B3 === 'MAIN,PT02,SWCH' && diff.B1 === '' && diff.B2 === '' && diff.B4 === ''
      && diff.NOPT === 'PT01,PT02,SWCH', JSON.stringify(diff));
    ok('…06 (per size) never counts as a difference, though every size has its own size chart', !Object.values(diff).some(d => d.includes('PT06')));
    ok('…Red 20x20 has an 02 the stack does not: not a difference (Sync never removes a picture)', red.sizes.find(s => s.kid.sku === 'R2').diff.join(',') === 'MAIN,PT01', red.sizes.find(s => s.kid.sku === 'R2').diff.join(','));
    const html = P.imcRowHtml(Object.assign(blue, { fam: 'PAR' }));
    ok('the row: ✓ chips for matching sizes, ≠ for B3 with its slots named on hover', /class="imc-sz is-same[^"]*" data-imc-size="B1"/.test(html) && /class="imc-sz is-diff[^"]*" data-imc-size="B3" title="differs in Main, 02 · missing Swatch/.test(html));
    ok('…a slot empty in all sizes says so on the stack ("empty in all sizes")', /03<small>empty in all sizes<\/small>/.test(html));
    ok('…"Sync 2 sizes" (B3 and NOPT), Edit stack, Copy to another colour', />Sync 2 sizes</.test(html) && />Edit stack</.test(html) && />Copy to another colour</.test(html));
    ok('…the stack tiles: 06 says "per size"', /06<small>per size<\/small>/.test(html));
    const allSame = P.imcRowHtml(Object.assign(cols.find(c => c.name === 'Green'), { fam: 'PAR' }));
    ok('a colour whose sizes all match: "All sizes match", the button off', /disabled[^>]*>All sizes match</.test(allSame));
    // the worst mark on a chip and on a tile
    const P3 = page();
    const b3 = P3.IML.SP.items.find(i => i.sku === 'B3');
    b3.iss = [{ s: 'E', c: '18320', m: 'The main image is missing or incorrect', a: ['main_product_image_locator'] }];
    b3.live.PT01 = A('other');
    const blue3 = Object.assign(P3.imcColours(kids(P3), ['PT06'])[0], { fam: 'PAR' });
    ok('a size with an Amazon picture error: red mark (worst wins over "shoppers see another picture")', P3.imcKidMark(b3).lv === 'r' && /Amazon picture error/.test(P3.imcKidMark(b3).why[0]));
    ok('…the stack tile MAIN carries the error mark; 01 shows F red (shoppers see another picture on B3)', /data-slot="MAIN">.*?<i class="imc-err"/.test(P3.imcRowHtml(blue3).replace(/\n/g, ''))
      && /data-slot="PT01">.*?is-diff.*?F<i class="fa-bfd is-r"/.test(P3.imcRowHtml(blue3).replace(/\n/g, '')));
  }

  console.log('== the view: switch, remembered, List view unchanged ==');
  {
    const P0 = load({ im: true, ctx: { sqSendWithCheck: async () => {}, sqField: s => s, sqSummaryText: () => '' } });
    P0.el('imBrand').value = 'SP'; P0.el('imFilter').value = 'all'; P0.el('imQ').value = '';
    P0.IML.SP = { at: new Date(), items: ITEMS() };
    P0.IM_OPEN.add('PAR');
    P0.imListRender();
    const before = P0.el('imList').innerHTML;
    const P = page();
    ok('By colour is the default view', P.getLayout() === 'colour');
    P.imcLayout('list');
    ok('List chosen → remembered in this browser (sellora.imglayout)', P.store['sellora.imglayout'] === 'list' && P.getLayout() === 'list');
    P.IM_OPEN.add('PAR');
    P.imListRender();
    ok('List view: exactly the same page as without the colour file', P.el('imList').innerHTML === before);
    P.imcLayout('colour');
    const html = P.el('imList').innerHTML;
    ok('By colour: the open family shows one row per colour (4) and its bar, no listing rows', (html.match(/class="imc-row"/g) || []).length === 4 && !/class="im-kid[ "]/.test(html)
      && /2 colours have sizes that don't match/.test(html), (html.match(/class="imc-row"/g) || []).length);
    ok('…families still fold: closed families show their header only', /data-grp="solo:S1"/.test(html) && /is-folded" data-grp="solo:S1"/.test(html));
    P.el('imFilter').value = 'nomain';
    P.imListAgain();
    const only = P.el('imList').innerHTML;
    ok('a filter shows the colours holding a matching size (No main at all → Green only), the matching chip outlined', (only.match(/class="imc-row"/g) || []).length === 1 && /data-imc-col="green"/.test(only) && /is-hit" data-imc-size="G1"/.test(only));
    P.imcPerSize(['PT06', 'PT03']);
    ok('per-size slots saved in this browser (sellora.imgpersize)', P.store['sellora.imgpersize'] === '["PT03","PT06"]' && P.getPerSize().join() === 'PT03,PT06');
    const P2 = page({ ctx: { localStorage: { getItem: k => ({ 'sellora.imglayout': 'list', 'sellora.imgpersize': '["PT05"]' }[k] || null), setItem() {} } } });
    ok('…both read back on the next visit', P2.getLayout() === 'list' && P2.getPerSize().join() === 'PT05');
  }

  console.log('== Sync N sizes: the right changes, per-size slots never touched, quality warnings respected ==');
  {
    const P = page();
    P.IMQ.dims = new Map(); P.IMQ.dims.set(P.imqId(A('c')), [1500, 1500]);       // 02 of the Blue stack is below 2000
    P.IMQ.dims.set(P.imqId(A('a')), [2400, 2400]);
    P.imcSyncOpen('PAR', 'blue');
    const cp = P.getCP();
    ok('Sync opens the copy popup on the Blue stack, tab "Same colour", the differing sizes ticked (B3; NOPT changes but has no product type)', cp.src.kind === 'colour' && cp.tab === 'colour' && [...cp.picked].join() === 'B3',
      JSON.stringify([cp.tab, [...cp.picked]]));
    ok('…the source never offers 06 (per size)', !('PT06' in cp.src.slots) && /06<\/span><small>per size<\/small>/.test(P.box.modal.html));
    const plans = P.imcTabPlans(cp, P.imcTargets(cp.src, P.IML.SP.items, P.IM_SEL, '').colour);
    const b3 = plans.find(p => p.sku === 'B3');
    ok('B3: only the slots that differ (MAIN, 02, swatch) — never 06', Object.keys(b3.set).join() === 'MAIN,PT02,SWCH' && b3.set.MAIN === A('a'), JSON.stringify(b3.set));
    ok('B1 / B2 / B4: "already the same (skipped)"', ['B1', 'B2', 'B4'].every(sku => plans.find(p => p.sku === sku).state === 'same') && /already the same \(skipped\)/.test(P.box.modal.html));
    ok('NOPT: no product type — named, never ticked', plans.find(p => p.sku === 'NOPT').state === 'nopt' && !cp.picked.has('NOPT'));
    ok('02 is below 2000: "quality warning" and left out unless "Include anyway"', b3.per.PT02.fail && /quality warning/.test(P.box.modal.html) && /data-imc-inc="B3\|PT02"/.test(P.box.modal.html));
    ok('footer: "1 listing will change · 2 pictures" → "Check with Amazon (1)"', /<b>1<\/b> listing will change · <b>2<\/b> pictures/.test(P.box.modal.html) && />Check with Amazon \(1\)</.test(P.box.modal.html));
    await P.imcSend();
    const sent = P.box.sent[0];
    ok('Check with Amazon → sqSendWithCheck (the one send path) with B3: MAIN + swatch, 02 left out', P.box.sent.length === 1 && sent.jobs.length === 1 && sent.jobs[0].sku === 'B3'
      && JSON.stringify(sent.jobs[0].body.set) === JSON.stringify({ MAIN: A('a'), SWCH: A('sw') }) && sent.jobs[0].body.productType === 'NAPKIN' && sent.jobs[0].body.limg === 'patch');
    ok('…old → new for the check popup and Listing History', sent.jobs[0].changes.map(c => c.attr + ':' + c.oldV.split('/').pop() + '>' + c.new.split('/').pop()).join() === 'MAIN:x.jpg>a.jpg,SWCH:>sw.jpg', sent.jobs[0].changes.map(c => c.attr + ':' + c.oldV + '>' + c.new).join());
    // "Include anyway"
    const Q = page();
    Q.IMQ.dims = new Map(); Q.IMQ.dims.set(Q.imqId(A('c')), [1500, 1500]);
    Q.imcSyncOpen('PAR', 'blue');
    Q.getCP().inc.add('B3|PT02');
    await Q.imcSend();
    ok('"Include anyway" ticked → 02 goes too', Object.keys(Q.box.sent[0].jobs[0].body.set).join() === 'MAIN,PT02,SWCH');
    // with no per-size slot, 06 becomes part of the stack and is synced
    const R = page();
    R.imcPerSize([], true);
    const blue = R.imcColours(kids(R), R.getPerSize())[0];
    ok('per-size slots off: 06 joins the stack (ch18, 2 of 5) and B2 / B3 differ in it', blue.stack.PT06 === A('ch18') && blue.sizes.find(s => s.kid.sku === 'B2').diff.includes('PT06'));
    R.imcPerSize(['PT06'], true);
    R.imcSyncOpen('PAR', 'blue');
    await R.imcSend();
    ok('…back on: no send ever carries 06', R.box.sent.every(s => s.jobs.every(j => !('PT06' in j.body.set))));
  }

  console.log('== Copy to similar: the suggested targets ==');
  {
    const P = page();
    const src = P.imcSrcListing(P.IML.SP.items.find(i => i.sku === 'B1'), 'SP');
    const t = P.imcTargets(src, P.IML.SP.items, new Set(['S1']), '');
    ok('Same colour (other sizes): B2, B3, B4, NOPT — never B1 itself', t.colour.map(i => i.sku).join() === 'B2,B3,B4,NOPT');
    ok('Same size (other colours): R1, G1, N1 (18x18) — not S1 (another family)', t.size.map(i => i.sku).join() === 'R1,G1,N1');
    ok('Whole family: every child of PAR but B1', t.family.map(i => i.sku).join() === 'B2,B3,B4,R1,R2,G1,N1,NOPT');
    ok('Listings with no main: G1', t.nomain.map(i => i.sku).join() === 'G1');
    ok('Ticked in the list: the ticks, even outside the family (S1)', t.ticked.map(i => i.sku).join() === 'S1');
    ok('Search: the whole brand, at least 2 letters', P.imcTargets(src, P.IML.SP.items, new Set(), 's1').search.map(i => i.sku).join() === 'S1' && !P.imcTargets(src, P.IML.SP.items, new Set(), 's').search.length);
    ok('the source ticks: every slot with a picture but 06 (per size) and the swatch', Object.keys(src.tick).filter(s => src.tick[s]).join() === 'MAIN,PT01,PT02' && !src.withSw);
    const g1 = P.imcPlanRow(src, P.IML.SP.items.find(i => i.sku === 'G1'), 'replace');
    ok('G1: "fixes No main"', g1.state === 'change' && g1.fixesMain && g1.set.MAIN === A('a'));
    ok('B2: same pictures → "already the same (skipped)"', P.imcPlanRow(src, P.IML.SP.items.find(i => i.sku === 'B2'), 'replace').state === 'same');
    ok('Only fill empty slots: B3 (no empty ticked slot) → "no empty slot to fill"', P.imcPlanRow(src, P.IML.SP.items.find(i => i.sku === 'B3'), 'gaps').state === 'nogap');
    const r1 = P.imcPlanRow(src, P.IML.SP.items.find(i => i.sku === 'R1'), 'gaps');
    ok('…R1: only 02 (empty) is filled', Object.keys(r1.set).join() === 'PT02');
    // a Copy all / Copy this picture anywhere opens the popup on the clipboard
    const item = P.IML.SP.items.find(i => i.sku === 'B3');
    P.imClipTake({ brand: 'SP', sku: item.sku, asin: item.asin, c: item.c, z: item.z, psku: item.psku, own: item.img, live: item.live });
    P.imcFromClip('');
    let cp = P.getCP();
    ok('Copy all → the popup on B3 (the clipboard kept as always), tab "Same colour"', P.getClip().sku === 'B3' && cp.src.sku === 'B3' && cp.tab === 'colour' && /Copy to similar listings/.test(P.box.modal.html));
    P.imClipCopyOne({ brand: 'SP', sku: 'B1', slot: 'PT02', url: A('c') });
    P.imcFromClip('PT02');
    cp = P.getCP();
    ok('Copy this picture → only that slot ticked', Object.keys(cp.src.tick).filter(s => cp.src.tick[s]).join() === 'PT02');
    // the tabs in the popup, a tab click
    P.imcClick({ target: { closest: sel => (sel === '.im-cp' ? {} : sel === '[data-imc-tab]' ? { dataset: { imcTab: 'nomain' } } : null) } });
    ok('a tab click shows that tab; its listings that change are ticked', P.getCP().tab === 'nomain' && [...P.getCP().picked].join() === 'G1');
    ok('the tabs carry counts', /Same colour \(other sizes\) <span>4<\/span>/.test(P.box.modal.html) && /Listings with no main <span>1<\/span>/.test(P.box.modal.html));
    // Copy to another colour: the colour stack, "Other colours"
    P.imcCopyColour('PAR', 'red');
    cp = P.getCP();
    ok('Copy to another colour: source = the Red stack, tab "Other colours" (every other colour of the family)', cp.src.kind === 'colour' && cp.tab === 'size' && /Other colours/.test(P.box.modal.html)
      && P.imcTargets(cp.src, P.IML.SP.items, new Set(), '').size.map(i => i.sku).join() === 'B1,B2,B3,B4,G1,N1,NOPT');
    // Set slot XX for all colours
    P.imcSetAll('PAR', 'PT01');
    cp = P.getCP();
    ok('Set slot 01 for all colours: the family\'s most common 01 (b1), tab Whole family', cp.src.kind === 'slot' && cp.src.slots.PT01 === A('b1') && cp.tab === 'family' && !('colour' in cp.src.tick));
  }

  console.log('== Guided copy: 4 steps, the same functions ==');
  {
    const P = page();
    P.imcCpOpen(null, { guided: true });
    ok('step 1 "Copy from": Next is off until a listing is chosen', /<li class="is-on"><span>1<\/span>Copy from/.test(P.box.modal.html) && /data-imc="next" disabled/.test(P.box.modal.html));
    const click = attrs => P.imcClick({ target: { closest: sel => (sel === '.im-cp' ? {} : attrs[sel] || null) } });
    click({ '[data-imc-from]': { dataset: { imcFrom: 'B1' } } });
    ok('pick B1 → step 2 "Which pictures" (the source and its ticks)', P.getCP().guided === 2 && /data-imc-tick="MAIN"/.test(P.box.modal.html));
    click({ '[data-imc]': { dataset: { imc: 'next' } } });
    ok('step 3 "Paste into": the groups as cards, "Recommended" on Same colour', P.getCP().guided === 3 && /imc-gcard is-rec" data-imc-gtab="colour"/.test(P.box.modal.html) && />Recommended</.test(P.box.modal.html));
    click({ '[data-imc-gtab]': { dataset: { imcGtab: 'colour' } } });
    ok('a card → step 4 "Check & send": the listings and Check with Amazon', P.getCP().guided === 4 && P.getCP().tab === 'colour' && /Check with Amazon \(1\)/.test(P.box.modal.html), (P.box.modal.html.match(/Check with Amazon \(\d+\)/) || [''])[0]);
    click({ '[data-imc]': { dataset: { imc: 'back' } } });
    ok('Back goes one step back', P.getCP().guided === 3);
    click({ '[data-imc]': { dataset: { imc: 'next' } } });
    click({ '[data-imc]': { dataset: { imc: 'send' } } });
    await new Promise(r => setTimeout(r, 0));
    ok('…sends through sqSendWithCheck: only B3 (B2 / B4 already the same, NOPT has no product type)', P.box.sent.length === 1 && P.box.sent[0].jobs.map(j => j.sku).join() === 'B3', JSON.stringify(P.box.sent.map(s => s.jobs.map(j => j.sku))));
  }

  console.log('== Safety: Sync never empties a slot, never reduces a size ==');
  {
    const P = page();
    // Pink: most sizes have 03 EMPTY (2 of 3) — the old "empty wins" rule would have emptied E1's 03. 05 is empty in all sizes.
    P.IML.SP.items.push(
      { sku: 'E1', psku: 'PAR', asin: 'B0E1', pt: 'NAPKIN', c: 'Pink', z: '18x18', st: OKST, img: { MAIN: A('pm'), PT01: A('pp'), PT03: A('pq') }, live: {} },
      { sku: 'E2', psku: 'PAR', asin: 'B0E2', pt: 'NAPKIN', c: 'Pink', z: '20x20', st: OKST, img: { MAIN: A('pm'), PT01: A('pp') }, live: {} },
      { sku: 'E3', psku: 'PAR', asin: 'B0E3', pt: 'NAPKIN', c: 'Pink', z: '22x22', st: OKST, img: { MAIN: A('pm2'), PT01: A('pp'), PT04: A('px') }, live: {} });
    const pink = P.imcColours(kids(P), ['PT06']).find(c => c.name === 'Pink');
    ok('stack = the most common NON-EMPTY picture: 03 = pq (1 size has it, 2 are empty), 04 = px, MAIN pm (2 of 3)', pink.stack.PT03 === A('pq') && pink.stack.PT04 === A('px') && pink.stack.MAIN === A('pm'));
    ok('…a slot no size fills stays empty ("empty in all sizes")', pink.stack.PT05 === '' && /05<small>empty in all sizes<\/small>/.test(P.imcRowHtml(Object.assign(pink, { fam: 'PAR' }))));
    const d = Object.fromEntries(pink.sizes.map(s => [s.kid.sku, P.imcDiff(s.kid, pink.stack, ['PT06']).join()]));
    ok('≠ rule: E1 missing 04; E2 missing 03, 04; E3 differs in MAIN, missing 03', d.E1 === 'PT04' && d.E2 === 'PT03,PT04' && d.E3 === 'MAIN,PT03', JSON.stringify(d));
    const html = P.imcRowHtml(Object.assign(pink, { fam: 'PAR' }));
    ok('hover words: "differs in Main · missing 03" (E3), "missing 03, 04" (E2)', /data-imc-size="E3" title="differs in Main · missing 03/.test(html) && /data-imc-size="E2" title="missing 03, 04/.test(html));
    P.imcSyncOpen('PAR', 'pink');
    const cp = P.getCP();
    const plans = P.imcTabPlans(cp, P.imcTargets(cp.src, P.IML.SP.items, P.IM_SEL, '').colour);
    ok('Sync ticks all three; nothing in any plan is empty', [...cp.picked].sort().join() === 'E1,E2,E3' && plans.every(p => Object.values(p.set).every(Boolean)));
    const e3 = plans.find(p => p.sku === 'E3');
    ok('E3 (more pictures in 04 than most): MAIN replaced, 03 filled, its own 01 and 04 kept — nothing removed', e3.replaced.join() === 'MAIN' && e3.filled.join() === 'PT03' && e3.kept.join() === 'PT01,PT04');
    ok('the preview says replaced / filled / kept per size — never "removed"', /1 replaced · 1 filled · 2 kept/.test(P.box.modal.html) && /<small class="imc-fate">filled<\/small>/.test(P.box.modal.html)
      && /<small class="imc-fate">replaced<\/small>/.test(P.box.modal.html) && !/removed/i.test(P.box.modal.html));
    await P.imcSend();
    const after = Object.fromEntries(P.box.sent[0].jobs.map(j => [j.sku, Object.assign({}, j.row.img, j.body.set)]));
    ok('after the send no size has fewer pictures than before, and no value sent is empty', ['E1', 'E2', 'E3'].every(sku => {
      const before = P.IML.SP.items.find(i => i.sku === sku).img;
      return Object.keys(before).every(slot => !before[slot] || (after[sku] || before)[slot]);
    }) && P.box.sent[0].jobs.every(j => Object.values(j.body.set).every(Boolean) && !('PT05' in j.body.set)));
  }

  console.log('== Edit stack: a change goes to every size of the colour, per-size slots excluded ==');
  {
    const P = page();
    const items = P.IML.SP.items;
    const im = { brand: 'SP', sku: 'B1', asin: 'B0B1', title: 'Blue', productType: 'NAPKIN' };
    const start = { MAIN: A('a'), PT01: A('b1'), PT02: A('c'), PT06: A('ch18'), SWCH: A('sw') };
    const { jobs, held } = P.imcEditJobs({ skus: ['B1', 'B2', 'B3', 'B4', 'NOPT'] }, im, start, { PT01: A('new1'), PT06: A('newch'), PT02: '' }, items);
    const by = Object.fromEntries(jobs.map(j => [j.sku, j.body.set]));
    ok('the open size (B1) gets every real picture, 06 included — the emptied 02 is NOT sent', JSON.stringify(by.B1) === JSON.stringify({ PT01: A('new1'), PT06: A('newch') }));
    ok('the other sizes get 01 only: never 06, never an emptied slot', ['B2', 'B3', 'B4'].every(sku => JSON.stringify(by[sku]) === JSON.stringify({ PT01: A('new1') })));
    ok('NO send ever carries an empty slot; no change line says "removed"', jobs.every(j => Object.values(j.body.set).every(Boolean) && j.changes.every(c => c.new && c.new !== '(removed)')));
    ok('the emptied slot is named ("use Edit only B1"); a size with no product type is named, not sent', held.map(h => h.sku).join() === 'B1,NOPT' && /emptying 02 is not sent from Edit stack/.test(held[0].why) && !by.NOPT);
    const onlyEmpty = P.imcEditJobs({ skus: ['B1', 'B2'] }, im, start, { PT02: '' }, items);
    ok('an edit that only empties a slot sends nothing', !onlyEmpty.jobs.length && onlyEmpty.held.length === 1);
    // through the editor's own Apply (imSend → imcEditSend), one Amazon check popup
    const Pe = page({ ctx: { Image: class { set src(v) {} }, document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ click() {} }) } },
      opts: { baCall: async q => ({ brand: 'SP', sku: q.sku, asin: 'B0' + q.sku, title: 't', productType: 'NAPKIN', listing: ITEMS().find(i => i.sku === q.sku).img, catalog: {}, issues: [] }) } });
    await Pe.imcEditStack('PAR', 'blue');
    ok('Edit stack opens the editor on a size that matches the stack (B1), with the banner', Pe.getIM().IM.sku === 'B1' && Pe.getEdit().skus.length === 5 && /Editing the colour stack of Blue/.test(Pe.el('imBody').innerHTML));
    const st = Pe.getIM();
    Pe.setIM(st.IM, st.IM_START, Object.assign({}, st.IM_START, { PT01: A('new1') }));
    await Pe.imSend(true);
    ok('Apply → ONE sqSendWithCheck with every size of Blue that changes (B1, B2, B3, B4; NOPT held)', Pe.box.sent.length === 1 && Pe.box.sent[0].jobs.map(j => j.sku).join() === 'B1,B2,B3,B4'
      && Pe.box.sent[0].opts.held.map(h => h.sku).join() === 'NOPT', JSON.stringify(Pe.box.sent.map(s => s.jobs.map(j => j.sku))));
    await Pe.imcEditStack('PAR', 'blue');
    Pe.imEditOpen ? null : null;
    Pe.imcClick({ target: { closest: sel => (sel === '[data-imc-editoff]' ? {} : null) } });
    const st2 = Pe.getIM();
    Pe.setIM(st2.IM, st2.IM_START, Object.assign({}, st2.IM_START, { PT01: A('new2') }));
    await Pe.imSend(true);
    ok('"Edit only B1" → Apply sends B1 alone (the editor as always)', Pe.box.sent.length === 2 && Pe.box.sent[1].jobs.map(j => j.sku).join() === 'B1');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
