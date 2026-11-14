/* Image Manager (src/app/listing/image-quality.js + image-manager.js): the picture rules, the number cards, the tiles' B / F and size dot,
 * the clipboard (ticked slots only), the "Paste into…" quick picks, the preview before the Amazon check, the editor in a side panel.
 *   node tests/image-manager-test.js
 * Runs the real files in a stub page (the loader of listing-rules-test.js, opts.im). */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const MB = 1024 * 1024;
const A = id => 'https://m.media-amazon.com/images/I/' + id + '.jpg';
// A W × H RGBA picture: white, with a product box (x0..x1, y0..y1) in grey; `edge` paints the outer border that colour.
function picture(W, H, box, edge) {
  const d = new Uint8ClampedArray(W * H * 4).fill(255);
  const put = (x, y, v) => { const i = (y * W + x) * 4; d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; };
  for (let y = box[1]; y <= box[3]; y++) for (let x = box[0]; x <= box[2]; x++) put(x, y, [90, 90, 90]);
  if (edge) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) put(x, y, edge);
  return d;
}

(async () => {
  const C = load({ im: true, sq: true });
  console.log('== the picture rules (one function: tiles, editor, upload, paste) ==');
  {
    ok('size: 2000 × 2000 = green, 1500 × 1500 = yellow, 800 × 900 = red, unknown = ""', C.imqSize(2000, 2000) === 'g' && C.imqSize(3000, 2400) === 'g'
      && C.imqSize(1500, 1500) === 'y' && C.imqSize(2500, 1999) === 'y' && C.imqSize(800, 900) === 'r' && C.imqSize(0, 0) === '');
    const y = C.imqCheck({ slot: 'PT01', w: 1500, h: 1500 });
    ok('1500 × 1500: "below 2000 — company minimum", a warning (not refused when it is already on Amazon)', y.size === 'y' && y.level === 'warn' && !y.block
      && y.chips.some(c => /below 2000 — company minimum/.test(c.t)));
    ok('800 × 800: red "no zoom"', C.imqCheck({ slot: 'PT02', w: 800, h: 800 }).chips.some(c => c.lv === 'bad' && /no zoom/.test(c.t)));
    const up = C.imqCheck({ slot: 'PT01', upload: true, w: 1800, h: 2400, bytes: 3 * MB, type: 'image/jpeg' });
    ok('UPLOAD under 2000 on the shortest side is refused: "Company rule: at least 2000 × 2000"', /^Company rule: at least 2000 × 2000/.test(up.block) && up.level === 'bad', up.block);
    const big = C.imqCheck({ slot: 'PT01', upload: true, w: 3000, h: 3000, bytes: 11 * MB, type: 'image/jpeg' });
    ok('UPLOAD over 10 MB is refused (Amazon)', /Over 10 MB .*Amazon refuses it/.test(big.block), big.block);
    const ten = C.imqCheck({ slot: 'PT01', upload: true, w: 3000, h: 3000, bytes: 10 * MB, type: 'image/jpeg' });
    ok('…exactly 10 MB is taken', !ten.block);
    const small = C.imqCheck({ slot: 'PT01', upload: true, w: 2000, h: 2000, bytes: 1.2 * MB, type: 'image/png' });
    ok('UPLOAD under 2 MB: a warning only, "small file — check it is sharp"', !small.block && small.level === 'warn' && small.chips.some(c => /Small file — check it is sharp/.test(c.t)));
    ok('UPLOAD types: JPEG / PNG / TIFF / GIF taken, WebP refused', !C.imqCheck({ upload: true, type: 'image/tiff', w: 2000, h: 2000, bytes: 3 * MB }).block
      && !C.imqCheck({ upload: true, type: 'image/gif', w: 2000, h: 2000, bytes: 3 * MB }).block && /JPEG, PNG, TIFF or GIF/.test(C.imqCheck({ upload: true, type: 'image/webp', bytes: 3 * MB }).block));
    ok('shape: 2000 × 2400 (0.83) "Not square"; 2000 × 2150 (0.93) fine', C.imqCheck({ slot: 'PT01', w: 2000, h: 2400 }).chips.some(c => c.t === 'Not square')
      && !C.imqCheck({ slot: 'PT01', w: 2000, h: 2150 }).chips.some(c => c.t === 'Not square'));
    ok('the swatch is a colour sample: no 2000 rule, no shape rule, never refused for its size', C.imqCheck({ slot: 'SWCH', upload: true, w: 60, h: 40, bytes: 3 * MB, type: 'image/jpeg' }).level === 'ok');
    ok('same picture twice in one stack → "Same picture as PT01" (the size part of the name is ignored; the swatch may repeat a stack picture)', JSON.stringify(C.imqDups({ MAIN: A('m'), PT01: A('a'), PT03: A('a._SL1500_'), SWCH: A('m') })) === '{"PT03":"PT01"}'
      && C.imqCheck({ slot: 'PT03', w: 2000, h: 2000, dup: 'PT01' }).chips.some(c => c.t === 'Same picture as PT01'));
  }

  console.log('== the main picture on upload: white border, how much the product fills ==');
  {
    const W = 100, H = 100;
    const good = C.imqPixels(picture(W, H, [8, 8, 91, 91]), W, H);
    ok('white picture, product 84 × 84 of 100 → "white", fills 84%', good.white === true && good.fill === 0.84, JSON.stringify(good));
    const grey = C.imqPixels(picture(W, H, [8, 8, 91, 91], [235, 235, 235]), W, H);
    ok('a light-grey border (235) → not white', grey.white === false, JSON.stringify(grey));
    const nearly = C.imqPixels(picture(W, H, [20, 30, 79, 69], [251, 252, 250]), W, H);
    ok('a border of 251, 252, 250 is still white (every channel ≥ 250); a product 60 × 40 fills 60%', nearly.white === true && nearly.fill === 0.6, JSON.stringify(nearly));
    const edgeToEdge = C.imqPixels(picture(W, H, [0, 10, 99, 89]), W, H);
    ok('a product touching the sides → border not white', edgeToEdge.white === false);
    const okChip = C.imqCheck({ slot: 'MAIN', upload: true, w: 2400, h: 2400, bytes: 4 * MB, type: 'image/jpeg', white: true, fill: 0.86 });
    ok('chips: "Background looks white ✓", "Product fills about 86%"', okChip.level === 'ok' && okChip.chips.some(c => c.t === 'Background looks white ✓') && okChip.chips.some(c => c.t === 'Product fills about 86%'));
    const bad = C.imqCheck({ slot: 'MAIN', upload: true, w: 2400, h: 2400, bytes: 4 * MB, type: 'image/jpeg', white: false, fill: 0.6 });
    ok('chips: "Background not pure white ✗ — Amazon may suppress", "Product fills about 60% — aim for about 85%" (a warning, still uploads)', !bad.block && bad.level === 'bad'
      && bad.chips.some(c => c.t === 'Background not pure white ✗ — Amazon may suppress') && bad.chips.some(c => c.t === 'Product fills about 60% — aim for about 85%'));
    ok('white / fill are judged on MAIN only', !C.imqCheck({ slot: 'PT01', w: 2400, h: 2400, white: false, fill: 0.2 }).chips.some(c => /Background|fills/.test(c.t)));
  }

  console.log('== the page: sidebar Show + families, filter chips, the card grid ==');
  const full = (p, n) => Object.fromEntries(['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'].slice(0, n || 9).map(s => [s, A(p + s)]));
  const ITEMS = () => [
    { sku: 'PAR', lvl: 'parent', asin: 'B0PAR', t: 'Napkins parent', img: { MAIN: A('par') }, live: { MAIN: A('par') } },
    { sku: 'K1', psku: 'PAR', asin: 'B0K1', pt: 'NAPKIN', c: 'Blue', z: '18x18', st: 'BUYABLE,DISCOVERABLE', img: Object.assign(full('k1'), { SWCH: A('k1sw') }), live: full('k1') },
    { sku: 'K2', psku: 'PAR', asin: 'B0K2', pt: 'NAPKIN', c: 'Blue', z: '20x20', st: 'BUYABLE,DISCOVERABLE', img: Object.assign(full('k2'), { MAIN: undefined }), live: full('k2') },
    { sku: 'K3', psku: 'PAR', asin: 'B0K3', pt: 'NAPKIN', c: 'Red', z: '18x18', st: 'BUYABLE,DISCOVERABLE', ie: 2, im: 'Unit Count is missing', img: full('k3', 5), live: full('k3', 5),
      iss: [{ s: 'E', c: '90244', m: 'The value for Ounce / Unit Count is missing', a: ['unit_count'] }, { s: 'E', c: '18320', m: 'The main image is missing or incorrect', a: ['main_product_image_locator'] }] },
    { sku: 'K5', psku: 'PAR', asin: 'B0K5', pt: 'NAPKIN', c: 'Teal', z: '22x22', st: 'BUYABLE,DISCOVERABLE', ie: 1, im: 'The value for Ounce / Unit Count is missing',
      iss: [{ s: 'E', c: '90244', m: 'The value for Ounce / Unit Count is missing', a: ['unit_count'] }], img: Object.assign(full('k5'), { MAIN: undefined }), live: Object.assign(full('k5'), { MAIN: undefined }) },
    { sku: 'K4', psku: 'PAR', asin: 'B0K4', pt: 'NAPKIN', c: 'Red', z: '20x20', st: 'BUYABLE', img: full('k4'), live: Object.assign(full('k4'), { MAIN: A('k1MAIN') }), },
    { sku: 'S1', asin: 'B0S1', pt: 'TABLECLOTH', c: 'Green', z: '60x90', st: 'BUYABLE,DISCOVERABLE', img: full('s1'), live: full('s1') },
  ];
  {
    const P = load({ im: true, sq: true, pc: true });
    P.el('imBrand').value = 'SP';
    P.el('imFilter').value = 'all';
    P.IML.SP = { at: new Date(), items: ITEMS() };
    P.PC.marks.SP = { k2MAIN: { v: 'bad' }, k3MAIN: { v: 'ok' } };
    P.IMQ.dims = new Map([['k3PT01', [1500, 1500]], ['k1MAIN', [2400, 2400]]]);
    P.imListRender();
    const cards = Object.fromEntries(P.imCardsData(P.IML.SP.items).map(c => [c.k, c.n]));
    ok('the problem counts (one rule each): No main 1 (K5) · family\'s main 1 (K2) · Main not OK 1 (K2) · Too small 1 (K3 PT01 1500) · Fewer than 7 1 (K3) · Amazon picture error 1 (K3 18320; K5 has only 90244) · suppressed 1 (K4) · another SKU 1 (K4) · no swatch 5',
      cards.nomain === 1 && cards.noown === 1 && cards.pcbad === 1 && cards.small === 1 && cards.few === 1 && cards.amzerr === 1 && cards.sup === 1 && cards.other === 1 && cards.noswatch === 5, JSON.stringify(cards));
    P.imListRender();
    const side = P.el('imShow').innerHTML;
    const showN = k => +((side.match(new RegExp(`data-im-show="${k}"[^>]*><span>[^<]*</span><b>(\\d+)</b>`)) || [])[1]);
    ok('sidebar Show with counts: All listings 6 · Needs fixing 5 · Below 2000 px 1 · All good 1 (K1)', showN('all') === 6 && showN('need') === 5 && showN('small') === 1 && showN('good') === 1,
      ['all', 'need', 'small', 'good'].map(k => k + '=' + showN(k)).join(' '));
    const fams = P.el('imFams').innerHTML;
    ok('FAMILIES: "All families", then each family with its picture, name, "N listings" and a problem badge (red: a red problem)', /data-im-fam=""[^>]*aria-pressed="true"/.test(fams)
      && /data-im-fam="PAR".*Napkins parent.*5 listings.*imx-badge is-bad[^>]*>4</s.test(fams) && /data-im-fam="solo:S1"/.test(fams));
    const html = P.el('imList').innerHTML;
    const chip = k => +((html.match(new RegExp(`data-im-chip="${k}"[^>]*>[^<]*<b>(\\d+)</b>`)) || [])[1]);
    ok('filter chips with counts: All 6 · No main 1 · Amazon picture error 1 · Below 2000 1 · Fewer than 7 1 · Shows another SKU\'s 1', chip('all') === 6 && chip('nomain') === 1 && chip('amzerr') === 1
      && chip('small') === 1 && chip('few') === 1 && chip('other') === 1, ['all', 'nomain', 'amzerr', 'small', 'few', 'other'].map(k => k + '=' + chip(k)).join(' '));
    ok('cards: one per listing (6), the long summary line and the old number cards are gone', (html.match(/class="imx-card[ "]/g) || []).length === 6 && !/im-box|im-meta|carry another SKU/.test(html));
    ['nomain', 'amzerr', 'small'].forEach(k => {
      P.el('imFilter').value = k;
      P.imListRender();
      ok(`chip "${k}" shows only its card (1), the chip is on`, (P.el('imList').innerHTML.match(/class="imx-card[ "]/g) || []).length === 1 && new RegExp(`data-im-chip="${k}" aria-pressed="true"`).test(P.el('imList').innerHTML));
    });
    P.el('imFilter').value = 'noswatch';
    P.imListRender();
    ok('a filter set elsewhere (Listing Health: No swatch) shows as one more chip, ✕ to clear', /class="imx-chip is-on" data-im-chip="all"[^>]*>No swatch <b>5<\/b> ✕/.test(P.el('imList').innerHTML));
    P.el('imFilter').value = 'all';
  }

  console.log('== picture problems only: Amazon issues that are not about pictures are hidden ==');
  {
    const P = load({ im: true, sq: true });
    ok('ERROR 90244 (Ounce / Unit Count) is not a picture problem; 18320 is (by code, by the picture attribute, by the words)', !P.imIsPicIssue({ s: 'E', c: '90244', m: 'The value for Ounce / Unit Count is missing', a: ['unit_count'] })
      && P.imIsPicIssue({ s: 'E', c: '18320', m: 'x', a: [] }) && P.imIsPicIssue({ s: 'E', c: '1', m: 'x', a: ['other_product_image_locator_3'] })
      && P.imIsPicIssue({ severity: 'ERROR', code: '5', message: 'The swatch could not be downloaded', attrs: [] }) && !P.imIsPicIssue({ s: 'E', c: '8541', m: 'Title too long', a: ['item_name'] }));
    P.el('imBrand').value = 'SP';
    P.el('imFilter').value = 'all';
    P.IML.SP = { at: new Date(), items: ITEMS() };
    P.imListRender();
    const html = P.el('imList').innerHTML;
    ok('cards: K3 shows "picture error" with the 18320 words; no card shows the 90244 words', /title="18320: The main image is missing or incorrect">picture error/.test(html) && !/Unit Count/.test(html));
    P.setIM({ brand: 'SP', sku: 'K3', listing: {}, catalog: {}, issues: [{ severity: 'ERROR', code: '90244', message: 'The value for Ounce / Unit Count is missing', attrs: ['unit_count'] },
      { severity: 'ERROR', code: '18320', message: 'The main image is missing or incorrect', attrs: ['main_product_image_locator'] }] }, {}, {});
    try { P.imRender(); } catch (e) { /* the stub page has no layout: only the HTML matters */ }
    const body = P.el('imBody').innerHTML;
    ok('editor issue box: "Amazon\'s open picture issues" with 18320 only', /open picture issues/.test(body) && /main image is missing/.test(body) && !/Unit Count/.test(body));
  }

  console.log('== tiles: B / F instead of the orange ring, the size dot, Copy this picture ==');
  {
    const P = load({ im: true, sq: true });
    P.el('imBrand').value = 'SP';
    const bf = (l, m) => { const x = P.imBfOf(l, m); return x.b + x.f + (x.differs ? '!' : ''); };
    ok('B / F: same picture gg · shoppers see another gr! · not live yet gu! · not ours ng! · none nn', bf(A('a'), A('a')) === 'gg' && bf(A('b'), A('a')) === 'gr!'
      && bf('', A('a')) === 'gu!' && bf(A('a'), '') === 'ng!' && bf('', '') === 'nn');
    P.IMQ.dims = new Map([['a', [2400, 2400]], ['b', [1200, 1200]]]);
    const same = P.imTile('PT01', A('a'), A('a'), false, 'K1');
    const diff = P.imTile('MAIN', A('b'), A('a'), false, 'K1');
    ok('same picture: B / F only on hover (no is-diff), green dot "2400 × 2400"', /class="im-bf"/.test(same) && /imq-dot is-g/.test(same) && /2400 × 2400/.test(same));
    ok('shoppers see another: "B● F●" always shown (is-diff), the old .im-diff class still there underneath', /class="im-bf is-diff"/.test(diff) && /im-th im-diff/.test(diff)
      && /fa-bfd is-g.*fa-bfd is-r/.test(diff));
    P.IMQ.dims = new Map();
    const unknown = P.imTile('PT02', A('c'), A('c'), false, 'K1');
    ok('size not known: the dot waits to be measured when on screen (data-imq-url, the full picture)', new RegExp(`data-imq-url="${A('c').replace(/[.?]/g, '\\$&')}"`).test(unknown));
    ok('the swatch has no B / F and no size dot (Amazon\'s catalogue never returns a swatch)', !/im-bf|imq-dot/.test(P.imTile('SWCH', '', A('sw'), true, 'K1')));
    ok('every tile with a picture carries "Copy" for that one picture', /data-copy1="K1" data-slot="PT01"/.test(same) && !/data-copy1/.test(P.imTile('PT03', '', '', false, 'K1')));
    P.setClip(null);
    P.imClipTake({ brand: 'SP', sku: 'K1', c: 'Blue', own: { MAIN: A('k1m'), PT01: A('k1a') }, live: { MAIN: A('k1live'), PT02: A('k1b') } });
    ok('Copy all: our own first, a slot we never sent takes what shoppers see; each slot ticked and named from K1', P.getClip().slots.MAIN === A('k1m') && P.getClip().slots.PT02 === A('k1b')
      && P.getClip().tick.MAIN && P.getClip().from.PT02 === 'K1' && P.getClip().n === 3);
    P.imClipTake({ brand: 'SP', sku: 'K1', own: { MAIN: A('k1m') }, live: { MAIN: A('k1live') }, prefer: 'live' });
    ok('Copy live: what shoppers see first', P.getClip().slots.MAIN === A('k1live') && P.getClip().shop === true);
    P.imClipCopyOne({ brand: 'SP', sku: 'K2', slot: 'PT03', url: A('k2c') });
    ok('Copy this picture: added at its own slot, ticked, from K2 — the rest of the clipboard stays', P.getClip().slots.MAIN === A('k1live') && P.getClip().slots.PT03 === A('k2c')
      && P.getClip().from.PT03 === 'K2' && P.getClip().tick.PT03 === true && P.getClip().n === 2);
    P.imClipCopyOne({ brand: 'CPC', sku: 'C9', slot: 'PT01', url: A('c9') });
    ok('…a picture from the other brand starts a new clipboard', P.getClip().brand === 'CPC' && Object.keys(P.getClip().slots).join() === 'PT01');
  }

  console.log('== Copy all → the clipboard bar; tick cards → Paste all into N selected → the preview → the Amazon check ==');
  {
    const sent = [];
    const modal = { html: '' };
    const P = load({ im: true, ctx: { sqSendWithCheck: async (jobs, opts) => { sent.push({ jobs, opts }); }, sqField: s => s, sqSummaryText: () => '', spModal: h => { modal.html = h || ''; } } });
    P.el('imBrand').value = 'SP';
    P.el('imFilter').value = 'all';
    P.IML.SP = { at: new Date(), items: ITEMS() };
    const k1 = P.IML.SP.items.find(i => i.sku === 'K1');
    P.imCopyAll('K1');
    let html = P.el('imList').innerHTML;
    ok('Copy all on K1: all 9 pictures AND the swatch are in the clipboard (the swatch ticked)', P.getClip().sku === 'K1' && P.getClip().n === 9 && P.getClip().tick.SWCH === true && P.imClipWithSw());
    ok('…the K1 card says "COPIED ✓" (green border)', /class="imx-card is-copied" data-sku="K1"/.test(html) && /COPIED ✓/.test(html));
    ok('…the clipboard bar: "Copied all 9 pictures + swatch from K1", 10 pictures, the mode, Clear, "Paste all into 0 selected →" (off)', /Copied all 9 pictures \+ swatch from <span class="im-mono">K1<\/span>/.test(html)
      && (html.match(/data-clip-slot="/g) || []).length === 10 && /id="imClipMode"/.test(html) && /id="imClipClear"/.test(html) && /id="imPasteSel" disabled>Paste all into 0 selected →/.test(html));
    ok('…the other cards offer "Paste all here"', /data-paste1="K2"/.test(html) && !/data-paste1="K1"/.test(html));
    P.getClip().tick.PT08 = false;
    P.imListRender();
    html = P.el('imList').innerHTML;
    ok('click a picture in the bar to leave it out: PT08 off → "Copied 8 of 9 pictures"', /data-clip-slot="PT08" aria-pressed="false"/.test(html) && /Copied 8 of 9 pictures/.test(html));
    const plan = P.imPastePlan(['S1'], { withSw: P.imClipWithSw() });
    ok('a paste puts in only what is on: MAIN, 01–07 and the swatch (PT08 left out)', Object.keys(plan.jobs[0].body.set).join() === 'MAIN,PT01,PT02,PT03,PT04,PT05,PT06,PT07,SWCH');
    // tick 4 cards
    ['K2', 'K3', 'K4', 'S1'].forEach(s => P.IM_SEL.add(s));
    P.IMQ.dims = new Map([[P.imqId(k1.img.PT01), [1500, 1500]], [P.imqId(k1.img.MAIN), [2400, 2400]]]);
    P.imListRender();
    html = P.el('imList').innerHTML;
    ok('tick 4 cards → "Paste all into 4 selected →"', /id="imPasteSel" >Paste all into 4 selected →/.test(html));
    const pv = sku => (html.match(new RegExp(`data-sku="${sku}"[\\s\\S]*?imx-pv[^"]*">([^<]*)<`)) || [])[1];
    ok('…every ticked card shows what will change: K2 "9 will change · 1 quality warning" (PT01 1500 px), S1 the same', pv('K2') === '9 will change · 1 quality warning' && pv('S1') === '9 will change · 1 quality warning', pv('K2') + ' / ' + pv('S1'));
    P.getClip().slots = Object.assign({}, k1.img);           // the clipboard = exactly K1's own pictures
    P.IML.SP.items.find(i => i.sku === 'K4').img = Object.assign({}, k1.img);
    P.imListRender();
    ok('…a card already holding those pictures says "already the same"', /data-sku="K4"[\s\S]*?imx-pv[^"]*">already the same</.test(P.el('imList').innerHTML));
    P.IML.SP.items.find(i => i.sku === 'K4').img = full('k4');
    // only empty slots
    P.el('imClipMode').value = 'gaps';
    const gaps = P.imPastePlan(['K3'], { mode: 'gaps', withSw: true });
    ok('mode "Only empty slots": K3 holds MAIN–PT04 → only 05, 06, 07 and the swatch are filled; nothing it holds is touched or emptied', Object.keys(gaps.jobs[0].body.set).join() === 'PT05,PT06,PT07,SWCH'
      && Object.values(gaps.jobs[0].body.set).every(Boolean));
    const full9 = P.imPastePlan(['K4'], { mode: 'gaps' });
    ok('…a listing with every slot filled is skipped: "no empty slot to fill"', !full9.jobs.length && full9.held[0].why === 'no empty slot to fill');
    ok('no paste plan ever empties a slot (any mode, any listing)', ['replace', 'gaps'].every(mode => P.imPastePlan(['K2', 'K3', 'K4', 'K5', 'S1'], { mode, withSw: true }).jobs
      .every(j => Object.values(j.body.set).every(Boolean))));
    // the preview
    P.IM_SEL.clear();
    ['K2', 'S1', 'NOPE'].forEach(s => P.IM_SEL.add(s));
    P.imPastePreview([...P.IM_SEL]);
    const h = modal.html;
    ok('Paste all → PREVIEW before sending: per listing the slots that change, old → new picture', /im-pv-l/.test(h) && (h.match(/class="im-pv-l"/g) || []).length === 2 && /K2.*S1/s.test(h)
      && (h.match(/im-pv-arrow/g) || []).length === 18 && sent.length === 0, (h.match(/im-pv-arrow/g) || []).length);
    ok('…a picture failing the rules (PT01 1500 × 1500) is marked, left out, and needs its own "Include anyway" tick', (h.match(/data-pv-inc=/g) || []).length === 2
      && /1500 × 1500 · below 2000 — company minimum/.test(h) && /2 left out/.test(h) && /16 picture\(s\) go in/.test(h));
    ok('…listings that will not change are named (NOPE — not in this snapshot)', /NOPE<\/span> — not in this snapshot/.test(h));
    P.getPV().inc.add('K2|PT01');
    await P.imPreviewGo();
    const s1 = sent[0];
    ok('Continue → the Amazon check popup (sqSendWithCheck) with what the preview kept: K2 with PT01 (ticked in), S1 without it', sent.length === 1
      && 'PT01' in s1.jobs.find(j => j.sku === 'K2').body.set && !('PT01' in s1.jobs.find(j => j.sku === 'S1').body.set)
      && s1.jobs.find(j => j.sku === 'S1').changes.every(c => c.attr !== 'PT01') && s1.opts.screen === 'Image Manager · paste' && s1.opts.held.some(x => x.sku === 'NOPE'));
    Object.keys(P.getClip().tick).forEach(s => { P.getClip().tick[s] = s === 'PT01'; });
    P.imPastePreview(['S1']);
    await P.imPreviewGo();
    ok('…a listing whose every picture was left out is not sent', !sent[1].jobs.length && sent[1].opts.held[0].why === 'every picture was left out in the preview (picture rules)');
    // Clear
    P.setClip(null);
    P.imListRender();
    ok('Clear: no bar, no COPIED, no "Paste all here"', !/imx-clip|COPIED|data-paste1/.test(P.el('imList').innerHTML));
  }

  console.log('== the edit drawer: the cards stay, 10 slots with ⋯, Copy all / Paste all / Fill empty only / Ours ⇄ Shoppers see, changes ready ==');
  {
    const cl = init => { const s = new Set(init || []); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
      toggle: (c, on) => ((on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c)) }; };
    const scrolled = [];
    const asked = [];
    const sent = [];
    const P = load({ im: true, lh: true, window: { scrollTo: (x, y) => scrolled.push([x, y]) },
      baCall: async q => { asked.push(q); return q.limg === 'get' ? { brand: 'SP', sku: q.sku, asin: 'B0K2', title: 'Napkins K2', color: 'Blue', size: '20x20', productType: 'NAPKIN', status: ['BUYABLE'],
        listing: { MAIN: A('k2m'), PT01: A('k2a'), PT02: A('k2a') }, catalog: { MAIN: { link: A('k2live'), w: 2400, h: 2400 }, PT03: { link: A('k2c') } }, issues: [] } : { rows: [] }; },
      ctx: { sqSendWithCheck: async (jobs, opts) => { sent.push({ jobs, opts }); }, sqField: s => s, sqSummaryText: () => '', Image: class { set src(v) {} },
        document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ click() {} }) } } });
    P.el('imBrand').value = 'SP';
    P.el('imFilter').value = 'all';
    P.el('imQ').value = '';
    P.el('imEditWrap').classList = cl(['hide']);
    P.el('imListWrap').classList = cl();
    P.IML.SP = { at: new Date(), items: ITEMS() };
    P.imListRender();
    await P.imEditOpen('K2');
    ok('Edit (a card click) opens the drawer: the cards are not hidden, the drawer is', !P.el('imListWrap').classList.contains('hide') && !P.el('imEditWrap').classList.contains('hide'));
    ok('…no scroll jump and the search box is left alone', !scrolled.length && P.el('imQ').value === '');
    ok('…the listing read is the one clicked (?limg=get sku=K2)', asked.some(q => q.limg === 'get' && q.sku === 'K2'));
    let body = P.el('imBody').innerHTML;
    ok('header: SKU · colour · size, ASIN, Open on Amazon', /<b class="im-mono">K2<\/b><span class="muted">Blue · 20x20<\/span>/.test(body) && /ASIN <b>B0K2<\/b>/.test(body) && /amazon\.com\/dp\/B0K2/.test(body));
    ok('buttons: Copy all, Ours ⇄ Shoppers see (Paste all only with a clipboard)', /id="imCopy"[^>]*>Copy all/.test(body) && /data-edv="ours" class="is-on"/.test(body) && /data-edv="shop"/.test(body) && !/id="imPaste"/.test(body));
    ok('10 slot tiles (MAIN, 01–08, swatch); empty ones say "drop file" (6: 03 comes from the catalogue); each has a ⋯ menu (view big, replace, URL, remove, move)', (body.match(/class="im-card imx-slot/g) || []).length === 10
      && (body.match(/drop file/g) || []).length === 6 && /data-act="view" data-slot="PT01"/.test(body) && /data-act="file" data-slot="PT01"/.test(body) && /data-act="url"/.test(body)
      && /data-act="del" data-slot="PT01"/.test(body) && /data-act="left" data-slot="PT01"/.test(body) && /data-act="right" data-slot="PT01"/.test(body) && !/data-act="del" data-slot="MAIN"/.test(body));
    ok('…a big drop zone for files (several fill the empty slots in order)', /id="imDrop"/.test(body) && /several fill the empty slots in order/.test(body) && /id="imFiles"[^>]*multiple/.test(body));
    ok('…the picture rules under a tile: PT02 is the same picture as PT01; B / F where shoppers see another main', /imq-chip is-warn"[^>]*>Same picture as PT01/.test(body) && /data-slot="MAIN"[\s\S]*?im-bf is-diff/.test(body));
    ok('footer: Discard (off), History, "Check with Amazon" (off: no changes)', /id="imReset"[^>]*disabled/.test(body) && /id="imHistLink"[^>]*>History/.test(body) && /id="imApply"[^>]*disabled>Check with Amazon</.test(body) && /No changes yet/.test(body));
    // a clipboard from K1 → Paste all (K1) / Fill empty only; the changes-ready list names where each came from
    P.setClip({ brand: 'SP', sku: 'K1', slots: { MAIN: A('k1m'), PT03: A('k1c'), PT05: A('k1e') }, from: { MAIN: 'K1', PT03: 'K1', PT05: 'K1' }, tick: { MAIN: true, PT03: true, PT05: true }, n: 3 });
    P.imRender();
    body = P.el('imBody').innerHTML;
    ok('with a clipboard: "Paste all (K1)" and "Fill empty only"', /id="imPaste"[^>]*>Paste all \(K1\)/.test(body) && /id="imPasteGaps"[^>]*>Fill empty only/.test(body));
    const st = P.getIM();
    P.setIM(st.IM, st.IM_START, Object.assign({}, st.IM_START, { MAIN: A('k1m'), PT05: A('k1e'), PT02: A('k2a') === st.IM_START.PT02 ? A('k2a') : A('k2a') }));
    const st2 = P.getIM();
    st2.IM_NOW.PT04 = st2.IM_START.PT01;      // moved 01 → 04
    P.imRender();
    body = P.el('imBody').innerHTML;
    ok('"3 changes ready": MAIN ← K1, 04 ← moved from 01, 05 ← K1; the button "Check with Amazon (3 changes)"', /3 changes ready/.test(body) && /<b>MAIN<\/b> ← K1/.test(body)
      && /<b>PT04<\/b> ← moved from 01/.test(body) && /<b>PT05<\/b> ← K1/.test(body) && /id="imApply"[^>]*>Check with Amazon \(3 changes\)/.test(body));
    await P.imSend(true);
    ok('Check with Amazon → sqSendWithCheck (the Amazon check popup) with the 3 changed slots', sent.length === 1 && Object.keys(sent[0].jobs[0].body.set).sort().join() === 'MAIN,PT04,PT05' && sent[0].opts.screen === 'Image Manager');
    P.setEdv('shop');
    P.imRender();
    body = P.el('imBody').innerHTML;
    ok('"Shoppers see": the catalogue\'s pictures, read only (no ⋯ menus, no drop zone)', /data-edv="shop" class="is-on"/.test(body) && new RegExp(A('k2live').replace(/[.?]/g, '\\$&')).test(body)
      && !/imx-menu/.test(body) && !/id="imDrop"/.test(body) && /What shoppers see now/.test(body));
    P.setEdv('ours');
    P.imHistLink('K2');
    ok('History opens Listing History, every date, searched for K2', P.calls.some(c => c.tab === 'lhist') && P.LH.f.q === 'K2' && P.LH.f.range === 'all' && P.LH.built === false);
    P.imShowEditor(false);
    ok('Close: the drawer goes, the cards are still there', P.el('imEditWrap').classList.contains('hide') && !P.el('imListWrap').classList.contains('hide'));
  }

  console.log('== cards: status pill, strip rings, chips; grouping Colour / Family / None (remembered); Shift-range; keys ==');
  const cl = init => { const s = new Set(init || []); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
    toggle: (c, on) => ((on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c)) }; };
  {
    const store = {};
    const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    const P = load({ im: true, ctx: { localStorage: ls, sqSendWithCheck: async () => {}, sqField: s => s, sqSummaryText: () => '' } });
    P.el('imBrand').value = 'SP';
    P.el('imFilter').value = 'all';
    P.IML.SP = { at: new Date(), items: ITEMS() };
    const it = sku => P.IML.SP.items.find(i => i.sku === sku);
    ok('the worst picture problem of a listing: K3 "Amazon picture error", K5 "No main at all", K2 "Using the family\'s main", K4 "Search suppressed", K1 "Buyable"',
      P.imKidChip(it('K3')).t === 'Amazon picture error' && P.imKidChip(it('K5')).t === 'No main at all' && P.imKidChip(it('K2')).t === 'Using the family\'s main'
      && P.imKidChip(it('K4')).t === 'Search suppressed' && P.imKidChip(it('K1')).t === 'Buyable');
    P.IMQ.dims = new Map([['k3MAIN', [1500, 1500]], ['k3PT01', [800, 800]]]);
    const card = sku => P.imCardHtml(it(sku));
    ok('K3 card: big main (_SL400_), tick, "Buyable" pill, 9-slot strip (4 empty = dashed), yellow ring on MAIN (1500), red on 01 (800) and a red error ring on MAIN',
      /_SL400_\.jpg/.test(card('K3')) && /class="im-sel" data-sku="K3"/.test(card('K3')) && /imx-pill is-ok">Buyable/.test(card('K3')) && (card('K3').match(/class="imx-ms/g) || []).length === 9
      && (card('K3').match(/imx-ms is-empty/g) || []).length === 4 && /imx-ms is-err" data-view="K3" data-slot="MAIN"[^>]*>.*?imq-dot is-y/.test(card('K3')) && /data-slot="PT01"[^>]*>.*?imq-dot is-r/.test(card('K3')));
    ok('…chips: "5/9" · "2 below 2000" · "picture error"', /imx-c">5\/9/.test(card('K3')) && /2 below 2000/.test(card('K3')) && />picture error</.test(card('K3')));
    ok('K5 (no main at all): a red "No main picture" box and a "No main" chip', /imx-nomain"><b>No main picture/.test(card('K5')) && /imx-c is-bad">No main/.test(card('K5')));
    ok('K4: "Suppressed" pill; K2 "Family\'s main"; hover buttons Copy all / Edit on every card', /imx-pill is-bad"[^>]*>Suppressed/.test(card('K4')) && /Family's main/.test(card('K2'))
      && /data-copy="K1"[^>]*>Copy all/.test(card('K1')) && /data-edit="K1"[^>]*>Edit/.test(card('K1')));
    // grouping
    P.setFam('PAR');
    P.imListRender();
    let html = P.el('imList').innerHTML;
    ok('Group = Colour (the default): headings "Blue · 2 sizes", "Red · 2 sizes", "Teal · 1 listing"; the family title and parent SKU on top', P.getGroup() === 'colour'
      && /<h3 class="imx-sec-h">Blue · 2 sizes<\/h3>/.test(html) && /Red · 2 sizes/.test(html) && /Teal · 1 listing/.test(html) && /<h2>Napkins parent<\/h2>/.test(html) && /Parent <span class="im-mono">PAR<\/span> · B0PAR/.test(html));
    ok('…cards in a colour by size: K1 (18x18) before K2 (20x20)', html.indexOf('data-sku="K1"') < html.indexOf('data-sku="K2"') && P.getShown().join() === 'K1,K2,K3,K4,K5');
    P.imGroupSet('none');
    html = P.el('imList').innerHTML;
    ok('Group = None: one grid, no headings; remembered in this browser', !/imx-sec-h/.test(html) && (html.match(/class="imx-card[ "]/g) || []).length === 5 && store['sellora.imggroup'] === 'none');
    P.setFam('');
    P.imGroupSet('family');
    html = P.el('imList').innerHTML;
    ok('Group = Family (All families): one heading per family', /Napkins parent · 5 listings/.test(html) && /imx-sec-h">[^<]*· 1 listing/.test(html));
    const P2 = load({ im: true, ctx: { localStorage: ls } });
    ok('…the next visit starts on the group chosen', P2.getGroup() === 'family');
    P.imGroupSet('colour');
    // Shift-range
    ok('Shift+click ticks a range in screen order (either direction); the first tick off-screen → just this one', P.imRangeSel(['a', 'b', 'c', 'd', 'e'], 'b', 'd').join() === 'b,c,d'
      && P.imRangeSel(['a', 'b', 'c', 'd', 'e'], 'e', 'c').join() === 'c,d,e' && P.imRangeSel(['a', 'b'], 'zz', 'b').join() === 'b');
    // keys
    P.el('spModal').classList = cl(['hide']);
    let focused = 0;
    P.el('imQ').focus = () => { focused++; };
    ok('"/" focuses the search; letters typed into a box are left alone', P.imKey({ key: '/', target: { tagName: 'BODY' } }) === true && focused === 1
      && P.imKey({ key: 'e', target: { tagName: 'INPUT' } }) === false && P.imKey({ key: 'v', target: { tagName: 'BODY' }, ctrlKey: true }) === false);
    P.setHover({ sku: 'K1', slot: 'PT02' });
    P.setClip(null);
    P.imKey({ key: 'c', target: { tagName: 'BODY' } });
    ok('"C" over one picture of a strip copies that picture', P.getClip() && P.getClip().slots.PT02 === A('k1PT02') && Object.keys(P.getClip().slots).length === 1);
    P.setHover({ sku: 'K2', slot: '' });
    P.imKey({ key: 'C', target: { tagName: 'BODY' } });
    ok('"C" over a card copies all its pictures', P.getClip().sku === 'K2' && P.getClip().n === 9);
  }

  console.log('== the picture viewer ==');
  {
    const P = load({ im: true, ctx: { sqSendWithCheck: async () => {}, sqField: s => s, sqSummaryText: () => '' } });
    P.el('imBrand').value = 'SP';
    P.el('imFilter').value = 'all';
    P.IML.SP = { at: new Date(), items: ITEMS() };
    P.IMQ.dims = new Map([['k1MAIN', [2400, 2400]]]);
    P.imViewOpen('K1', 'MAIN');
    let v = P.el('imViewer');
    ok('a tile opens the viewer: the picture big (the full picture, not the thumbnail), slot name, "1 of 10", size and the picture rules', P.getVW().slot === 'MAIN' && v.hidden === false
      && new RegExp(`<img src="${A('k1MAIN').replace(/[.?]/g, '\\$&')}"`).test(v.innerHTML) && /Main <span class="muted">\(1 of 10\)/.test(v.innerHTML) && /2400 × 2400 px/.test(v.innerHTML));
    ok('…buttons: Copy · Replace in editor · Open on Amazon (amazon.com/dp/ASIN)', /data-vw="copy"/.test(v.innerHTML) && /data-vw="repl"/.test(v.innerHTML) && /amazon\.com\/dp\/B0K1/.test(v.innerHTML));
    P.imKey({ key: 'ArrowRight', target: { tagName: 'BODY' } });
    ok('→ moves to PT01', P.getVW().slot === 'PT01' && /PT01 <span class="muted">\(2 of 10\)/.test(P.el('imViewer').innerHTML));
    P.imKey({ key: 'ArrowLeft', target: { tagName: 'BODY' } });
    P.imKey({ key: 'ArrowLeft', target: { tagName: 'BODY' } });
    ok('← ← goes back past Main to the swatch (MAIN … PT08, swatch, round)', P.getVW().slot === 'SWCH');
    P.imViewOpen('K3', 'PT04');
    P.imViewMove(1);
    ok('…a listing with 5 pictures: PT04 → back to Main (empty slots are skipped)', P.getVW().slot === 'MAIN');
    P.imKey({ key: 'Escape', target: { tagName: 'BODY' } });
    ok('Esc closes it', P.getVW() === null && P.el('imViewer').hidden === true);
    P.imViewOpen('K4', 'MAIN');
    v = P.el('imViewer');
    ok('when ours and what shoppers see differ: "Ours vs What shoppers see"', /data-vw="both"/.test(v.innerHTML) && /Ours vs What shoppers see/.test(v.innerHTML));
    P.imViewAct('both');
    ok('…side by side: ours (B) and what shoppers see (F)', /is-both/.test(P.el('imViewer').innerHTML) && /Ours — the picture we sent \(B\)/.test(P.el('imViewer').innerHTML)
      && /What shoppers see \(F\)/.test(P.el('imViewer').innerHTML) && new RegExp(A('k1MAIN').replace(/[.?]/g, '\\$&')).test(P.el('imViewer').innerHTML));
    P.setClip(null);
    P.imViewAct('copy');
    ok('Copy in the viewer copies that picture', P.getClip().slots.MAIN === A('k4MAIN'));
    P.imViewOpen('K1', 'MAIN');
    ok('…the same picture both sides: no toggle, "the same picture"', !/data-vw="both"/.test(P.el('imViewer').innerHTML) && /are the same picture/.test(P.el('imViewer').innerHTML));
    P.imViewClose();
  }

  console.log('== the editor: drop files from the computer (same picture rules), the picture rules line ==');
  {
    const posts = [];
    const DIMS = { 'big.jpg': 3000, 'small.jpg': 1500, 'ok1.jpg': 2400, 'ok2.png': 2200 };
    const P = load({ im: true, ctx: {
      API: { url: 'https://backend.stub/exec' }, API_ERR: '', auth: { currentUser: null },
      fetch: async (url, init) => { const b = JSON.parse(init.body); posts.push(b); return { text: async () => JSON.stringify({ ok: true, url: 'https://drive.stub/' + b.name }) }; },
      FileReader: class { readAsDataURL() { setTimeout(() => { this.result = 'data:image/jpeg;base64,AAAA'; this.onload(); }); } },
      URL: { createObjectURL: f => 'blob:' + (f && f.name), revokeObjectURL() {} },
      Image: class { set src(v) { const n = DIMS[String(v).replace('blob:', '')]; if (n) { this.naturalWidth = n; this.naturalHeight = n; setTimeout(() => this.onload && this.onload()); } } },
      document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ click() {} }) },
      sqSendWithCheck: async () => {}, sqField: s => s, sqSummaryText: () => '' } });
    P.el('imBrand').value = 'SP';
    const filled = { MAIN: A('m'), PT01: A('a'), PT02: A('b'), PT03: A('c'), PT04: A('d'), PT05: A('e') };
    P.setIM({ brand: 'SP', sku: 'K1', listing: {}, catalog: {}, issues: [] }, Object.assign({}, filled), Object.assign({}, filled));
    ok('several files fill the empty slots in order (PT06, PT07, PT08), never the swatch', P.imDropSlots(3, filled).join() === 'PT06,PT07,PT08' && P.imDropSlots(9, filled).length === 3);
    const MB = 1024 * 1024;
    const f = (name, size, type) => ({ name, size, type: type || 'image/jpeg' });
    await P.imUploadMany([f('big.jpg', 11 * MB), f('small.jpg', 3 * MB), f('ok1.jpg', 3 * MB), f('ok2.png', 4 * MB, 'image/png')]);
    const now = P.getIM().IM_NOW;
    ok('the same checks as one upload: 11 MB refused, 1500 × 1500 refused ("Company rule"), the next files take those slots: PT06 ← ok1, PT07 ← ok2',
      posts.length === 2 && posts.every(p => p.limg === 'upload') && /ok1\.jpg$/.test(now.PT06) && /ok2\.png$/.test(now.PT07) && !now.PT08, JSON.stringify(now));
    await P.imUploadMany([f('ok1.jpg', 3 * MB), f('ok2.png', 3 * MB)]);
    ok('…more files than empty slots: the rest are named, not uploaded', /No empty slot left: 1 file\(s\) not uploaded \(ok2\.png\)/.test(P.el('imMsg').textContent) && posts.length === 3);
    ok('a single file dropped on a slot still goes through imUpload\'s rules (11 MB refused)', (await P.imUpload('PT01', f('big.jpg', 11 * MB)), posts.length === 3 && /10 MB/.test(P.el('imMsg').textContent)));
    ok('"Picture rules" line: Main pure white, ~85%, 2000 × 2000, JPEG/PNG, 2–10 MB (one line, opens for more)', /<details class="im-rules"><summary><b>Picture rules:<\/b> Main pure white, product fills ~85%, at least 2000 × 2000, JPEG\/PNG, 2–10 MB<\/summary>/.test(P.imRulesHtml()));
  }

  console.log('== families in the sidebar, Show, search (filters families and cards), a big family, Select all ==');
  {
    const P = load({ im: true, ctx: { sqSendWithCheck: async () => {}, sqField: s => s, sqSummaryText: () => '' } });
    P.el('imBrand').value = 'SP';
    P.el('imFilter').value = 'all';
    P.el('imQ').value = '';
    const big = [{ sku: 'BIG', lvl: 'parent', asin: 'B0BIG', t: 'Big family', img: { MAIN: A('bigm') }, live: { MAIN: A('bigm') } }]
      .concat(Array.from({ length: 195 }, (_, i) => ({ sku: 'B' + i, psku: 'BIG', asin: 'B0B' + i, pt: 'NAPKIN', c: 'C' + (i % 7), z: '18x18', st: 'BUYABLE,DISCOVERABLE', img: full('b' + i, 3), live: full('b' + i, 3) })));
    P.IML.SP = { at: new Date(), items: ITEMS().concat(big) };
    P.imListRender();
    let fams = P.el('imFams').innerHTML;
    ok('families sorted by listings to fix: Big family (195) first, then Napkins parent (4)', fams.indexOf('data-im-fam="BIG"') < fams.indexOf('data-im-fam="PAR"') && /Big family.*195 listings.*is-att[^>]*>195</s.test(fams));
    P.setFam('BIG');
    P.imListRender();
    let html = P.el('imList').innerHTML;
    ok('click a family → the main area shows it: ALL 195 cards (drawn in blocks on a real page), 7 colour headings', (html.match(/class="imx-card[ "]/g) || []).length === 195
      && (html.match(/imx-sec-h/g) || []).length === 7 && /<h2>Big family<\/h2>/.test(html) && /aria-pressed="true"[^>]*title="Big family"|data-im-fam="BIG" aria-pressed="true"/.test(P.el('imFams').innerHTML));
    P.setFam('');
    P.el('imQ').value = 'k3';
    P.imListAgain();
    html = P.el('imList').innerHTML;
    fams = P.el('imFams').innerHTML;
    ok('search "k3": only the families with a match in the sidebar, only the matching card in the main area', /data-im-fam="PAR"/.test(fams) && !/data-im-fam="BIG"/.test(fams) && !/data-im-fam="solo:S1"/.test(fams)
      && (html.match(/class="imx-card[ "]/g) || []).length === 1 && /data-sku="K3"/.test(html));
    P.el('imQ').value = 'napkins parent';
    P.imListAgain();
    ok('a search that names the PARENT keeps its whole family (5 cards)', (P.el('imList').innerHTML.match(/class="imx-card[ "]/g) || []).length === 5);
    P.el('imQ').value = 'zzz';
    P.imListAgain();
    ok('nothing matches: "No listings match the search" and a Show everything button', /No listings match the search “zzz”/.test(P.el('imList').innerHTML) && /id="imClearFilter"/.test(P.el('imList').innerHTML)
      && /No family matches/.test(P.el('imFams').innerHTML));
    P.el('imQ').value = '';
    P.setShow('good');
    P.imListAgain();
    ok('Show "All good": only K1 and the Big family\'s fine listings — none of the ones needing work', !/data-sku="K3"/.test(P.el('imList').innerHTML) && /data-sku="K1"/.test(P.el('imList').innerHTML));
    P.setShow('all');
    P.setFam('PAR');
    P.imListAgain();
    P.IM_SEL.clear();
    P.getShown().forEach(s => P.IM_SEL.add(s));
    ok('Select all ticks every card on the page (the 5 of the family)', P.IM_SEL.size === 5 && P.getShown().join() === 'K1,K2,K3,K4,K5');
    P.imListRender();
    ok('…the button then says "Untick all"', /data-im-selall="1"[^>]*>Untick all/.test(P.el('imList').innerHTML));
    P.imUploadPick();
    ok('Upload pictures with 5 ticked and nothing open: asks to tick one card (or open one)', /Tick one card \(or open one\)/.test(P.el('imMsg').textContent));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
