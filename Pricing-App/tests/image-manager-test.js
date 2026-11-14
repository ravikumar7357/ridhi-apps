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

  console.log('== the number cards (they set the filter picker) ==');
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
    const html = P.el('imList').innerHTML;
    const n = k => { const m = html.match(new RegExp(`data-im-card="${k}"[^>]*>.*?<b>(\\d+)</b>`)); return m ? +m[1] : null; };
    ok('9 cards: No main at all · Using the family\'s main · Main not OK · Too small · Fewer than 7 · Amazon picture error · Search suppressed · Another SKU\'s pictures · No swatch',
      (html.match(/data-im-card="(\w+)"/g) || []).map(s => s.slice(14, -1)).join(',') === 'nomain,noown,pcbad,small,few,amzerr,sup,other,noswatch' && /Amazon picture error/.test(html) && /No main at all/.test(html));
    ok('numbers: No main at all 1 (K5) · family\'s main 1 (K2) · Main not OK 1 (K2) · Too small 1 (K3 PT01 1500) · Fewer than 7 1 (K3) · Amazon picture error 1 (K3 18320; K5 has only 90244: not counted) · suppressed 1 (K4) · another SKU 1 (K4) · no swatch 5',
      n('nomain') === 1 && n('noown') === 1 && n('pcbad') === 1 && n('small') === 1 && n('few') === 1 && n('amzerr') === 1 && n('sup') === 1 && n('other') === 1 && n('noswatch') === 5,
      ['nomain', 'noown', 'pcbad', 'small', 'few', 'amzerr', 'sup', 'other', 'noswatch'].map(k => k + '=' + n(k)).join(' '));
    ok('"Too small" says how many are measured so far: "2 of 6 measured"', /under 2000 · 2 of 6 measured/.test(html));
    ok('the long grey summary line is gone (no "carry another SKU\'s pictures" text)', !/carry another SKU/.test(html) && /im-meta/.test(html));
    ok('the dropdown has the same filters: Main missing / Main not OK / Too small filter the list too', ['nomain', 'noown', 'pcbad', 'small', 'amzerr'].every(k => {
      P.el('imFilter').value = k; P.imListRender(); return (P.el('imList').innerHTML.match(/class="im-kid"/g) || []).length === 1 && new RegExp(`data-im-card="${k}" aria-pressed="true"`).test(P.el('imList').innerHTML);
    }));
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
    ok('rows: K3 shows "1 picture error" with the 18320 words; no row shows the 90244 words', /The main image is missing or incorrect/.test(html) && !/Unit Count/.test(html));
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

  console.log('== the clipboard bar: paste only the ticked slots, the quick picks, the mode, the preview ==');
  {
    const sent = [];
    const modal = { html: '' };
    const P = load({ im: true, ctx: { sqSendWithCheck: async (jobs, opts) => { sent.push({ jobs, opts }); }, sqField: s => s, sqSummaryText: () => '', spModal: h => { modal.html = h || ''; } } });
    P.el('imBrand').value = 'SP';
    P.el('imFilter').value = 'all';
    P.IML.SP = { at: new Date(), items: ITEMS() };
    const k1 = P.IML.SP.items.find(i => i.sku === 'K1');
    P.imClipTake({ brand: 'SP', sku: 'K1', c: 'Blue', z: '18x18', psku: 'PAR', own: k1.img, live: k1.live });
    P.getClip().tick.PT08 = false;
    P.imListRender();
    const bar = P.el('imList').innerHTML;
    ok('the bar: one cell per slot (Main, 01–08, Swatch) with a tick; the swatch tick is today\'s "also the swatch", off at first', (bar.match(/class="im-cs[ "]/g) || []).length === 10
      && /id="imClipSw"(?! checked)/.test(bar) && /data-clip-tick="PT08"(?! checked)/.test(bar) && /data-clip-tick="MAIN" checked/.test(bar) && /position|im-clip/.test(bar));
    const plan = P.imPastePlan(['S1'], {});
    ok('paste only the ticked slots: PT08 unticked and the swatch off → MAIN, PT01–PT07 only', Object.keys(plan.jobs[0].body.set).join() === 'MAIN,PT01,PT02,PT03,PT04,PT05,PT06,PT07');
    ok('…with the swatch ticked: the swatch too', Object.keys(P.imPastePlan(['S1'], { withSw: true }).jobs[0].body.set).includes('SWCH'));
    const gaps = P.imPastePlan(['K3'], { mode: 'gaps' });
    ok('mode "Only fill empty slots": K3 holds MAIN–PT04 → only PT05, PT06, PT07 (PT08 unticked)', Object.keys(gaps.jobs[0].body.set).join() === 'PT05,PT06,PT07');
    const full9 = P.imPastePlan(['K4'], { mode: 'gaps' });
    ok('…a listing with every slot filled: not changed, "no empty slot to fill"', !full9.jobs.length && full9.held[0].why === 'no empty slot to fill');
    const picks = Object.fromEntries(P.imPicks().map(p => [p.k, p]));
    ok('quick picks: all children of PAR = K2, K3, K4, K5 (never the copied K1)', picks.kids && picks.kids.skus.slice().sort().join() === 'K2,K3,K4,K5' && /All children of PAR/.test(picks.kids.label));
    ok('…same colour (Blue) in this parent = K2; same size (18x18) = K3', picks.colour.skus.join() === 'K2' && /Same colour \(Blue\) in this parent/.test(picks.colour.label) && picks.size.skus.join() === 'K3');
    ok('…everything in the current filter (All) = K2, K3, K4, K5, S1', picks.filter.skus.slice().sort().join() === 'K2,K3,K4,K5,S1');
    P.el('imFilter').value = 'few';
    ok('…with the filter "Fewer than 7": only K3', P.imPicks().find(p => p.k === 'filter').skus.join() === 'K3');
    P.el('imFilter').value = 'all';
    ok('…"This listing" only while the editor is open', !picks.this);
    P.el('imPick').value = 'colour';
    // the select's change handler is wired in imListRender; call what it does
    P.IM_SEL.clear(); picks.colour.skus.forEach(s => P.IM_SEL.add(s));
    P.imListRender();
    ok('a pick ticks those listings in the list: K2 ticked, the button says "Preview · paste into 1 ticked listing(s)"', /data-sku="K2" checked/.test(P.el('imList').innerHTML)
      && /Preview · paste into 1 ticked listing\(s\)/.test(P.el('imList').innerHTML));

    // --- the preview ---
    P.IMQ.dims = new Map([[P.imqId(k1.img.PT01), [1500, 1500]], [P.imqId(k1.img.MAIN), [2400, 2400]]]);
    P.imPastePreview(['K2', 'S1', 'NOPE']);
    const h = modal.html;
    ok('PREVIEW before sending: per listing the slots that change, old → new picture', /im-pv-l/.test(h) && (h.match(/class="im-pv-l"/g) || []).length === 2 && /K2.*S1/s.test(h)
      && (h.match(/im-pv-arrow/g) || []).length === 16 && sent.length === 0);
    ok('…a picture failing the rules (PT01 1500 × 1500) is marked, left out, and needs its own "Include anyway" tick', (h.match(/data-pv-inc=/g) || []).length === 2
      && /1500 × 1500 · below 2000 — company minimum/.test(h) && /2 left out/.test(h) && /14 picture\(s\) go in/.test(h));
    ok('…a picture that passes says so (2400 × 2400), one not measured says "Size not known"', /imq-chip is-ok"[^>]*>2400 × 2400/.test(h) && /Size not known/.test(h));
    ok('…listings that will not change are named (NOPE — not in this snapshot)', /NOPE<\/span> — not in this snapshot/.test(h));
    P.getPV().inc.add('K2|PT01');
    await P.imPreviewGo();
    const s1 = sent[0];
    ok('Continue → the Amazon check popup (#10) with what the preview kept: K2 with PT01 (ticked in), S1 without it', sent.length === 1
      && 'PT01' in s1.jobs.find(j => j.sku === 'K2').body.set && !('PT01' in s1.jobs.find(j => j.sku === 'S1').body.set)
      && s1.jobs.find(j => j.sku === 'S1').changes.every(c => c.attr !== 'PT01') && s1.opts.screen === 'Image Manager · paste' && s1.opts.held.some(x => x.sku === 'NOPE'));
    // a listing with only failing pictures left
    Object.keys(P.getClip().tick).forEach(s => { P.getClip().tick[s] = s === 'PT01'; });
    P.imPastePreview(['S1']);
    await P.imPreviewGo();
    ok('…a listing whose every picture was left out is not sent: "every picture was left out in the preview"', !sent[1].jobs.length
      && sent[1].opts.held[0].why === 'every picture was left out in the preview (picture rules)');
  }

  console.log('== the editor in a side panel: the list stays, chips under each picture, Listing History link ==');
  {
    const cl = init => { const s = new Set(init || []); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
      toggle: (c, on) => ((on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c)) }; };
    const scrolled = [];
    const asked = [];
    const P = load({ im: true, lh: true, window: { scrollTo: (x, y) => scrolled.push([x, y]) },
      baCall: async q => { asked.push(q); return q.limg === 'get' ? { brand: 'SP', sku: q.sku, asin: 'B0K2', title: 'Napkins K2', productType: 'NAPKIN', status: ['BUYABLE'],
        listing: { MAIN: A('k2m'), PT01: A('k2a'), PT02: A('k2a') }, catalog: { MAIN: { link: A('k2m'), w: 2400, h: 2400 } }, issues: [] } : { rows: [] }; },
      ctx: { sqSendWithCheck: async () => {}, sqField: s => s, sqSummaryText: () => '', Image: class { set src(v) {} }, document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ click() {} }) } } });
    P.el('imBrand').value = 'SP';
    P.el('imFilter').value = 'all';
    P.el('imQ').value = '';
    P.el('imEditWrap').classList = cl(['hide']);
    P.el('imListWrap').classList = cl();
    P.IML.SP = { at: new Date(), items: ITEMS() };
    const btn = { dataset: { edit: 'K2' }, closest: () => ({ classList: cl() }) };
    P.el('imList').querySelectorAll = sel => (sel === '[data-edit]' ? [btn] : []);
    P.imListRender();
    await btn.onclick();
    ok('Edit opens the editor beside the list: the list is not hidden, the panel is', !P.el('imListWrap').classList.contains('hide') && !P.el('imEditWrap').classList.contains('hide'));
    ok('…no scroll jump and the search box is left alone (it used to be set to the SKU, which filtered the list)', !scrolled.length && P.el('imQ').value === '');
    ok('…the listing read is the one clicked (?limg=get sku=K2)', asked.some(q => q.limg === 'get' && q.sku === 'K2'));
    const body = P.el('imBody').innerHTML;
    ok('today\'s editor unchanged inside it: Live on Amazon now, Your stack, Check with Amazon / Apply / Discard', /Live on Amazon now/.test(body) && /Your stack/.test(body)
      && /id="imCheck"/.test(body) && /id="imApply"/.test(body) && /id="imReset"/.test(body) && /data-act="file"/.test(body) && /data-act="url"/.test(body));
    ok('quality chips under each picture: PT02 is the same picture as PT01', /imq-chip is-warn"[^>]*>Same picture as PT01/.test(body));
    ok('the old "Changes sent for this SKU" list → a link to Listing History', /id="imHistLink"/.test(body) && /See them in Listing History/.test(body) && !/id="imHist"/.test(body));
    P.imHistLink('K2');
    ok('…the link opens Listing History, every date, searched for K2', P.calls.some(c => c.tab === 'lhist') && P.LH.f.q === 'K2' && P.LH.f.range === 'all' && P.LH.built === false);
    P.imShowEditor(false);
    ok('Close: the panel goes, the list is still there', P.el('imEditWrap').classList.contains('hide') && !P.el('imListWrap').classList.contains('hide'));
  }

  console.log('== the cleaner list: one status chip, quality summary, families, density, Shift-range, keys ==');
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
    ok('ONE status chip, the worst picture problem first: K3 "Amazon picture error", K5 "No main at all", K2 "Using the family\'s main", K4 "Search suppressed", K1 "Buyable"',
      P.imKidChip(it('K3')).t === 'Amazon picture error' && P.imKidChip(it('K5')).t === 'No main at all' && P.imKidChip(it('K2')).t === 'Using the family\'s main'
      && P.imKidChip(it('K4')).t === 'Search suppressed' && P.imKidChip(it('K1')).t === 'Buyable');
    P.IMQ.dims = new Map([['k3MAIN', [1500, 1500]], ['k3PT01', [800, 800]]]);
    ok('quality summary: K3 "5/9 pictures · 2 below 2000 · no swatch"; K1 "9/9 pictures"', P.imKidSummary(it('K3')).replace(/<[^>]+>/g, '') === '5/9 pictures · 2 below 2000 · no swatch'
      && P.imKidSummary(it('K1')) === '9/9 pictures');
    P.imListRender();
    let html = P.el('imList').innerHTML;
    ok('family card: "4 children · 4 need pictures", Copy main of this family, Select all children, Expand / Collapse all', /5 children · <b class="is-need">4 need pictures<\/b>/.test(html)
      && /data-fammain="PAR"/.test(html) && /data-famsel="PAR"/.test(html) && /data-foldall="1"/.test(html), (html.match(/\d+ children[^<]*<b[^>]*>[^<]*/) || [''])[0]);
    ok('tiles: 160 px thumbnails for Amazon pictures (_SL160_), hover View · Copy · Replace', /_SL160_\.jpg/.test(html) && /data-view="K1" data-slot="PT01"/.test(html) && /data-repl="K1" data-slot="PT01"/.test(html) && /data-copy1="K1"/.test(html));
    P.IM_FOLD.add('PAR');
    P.imListRender();
    html = P.el('imList').innerHTML;
    ok('a folded family shows only its header (no child rows), ▸ to open', !/data-sku="K1"/.test(html.replace(/data-fold[^>]*/g, '')) && /im-grp is-folded/.test(html) && /aria-expanded="false"/.test(html) && /data-sku="S1"/.test(html));
    P.IM_FOLD.clear();
    // density
    P.el('paneImg').classList = cl();
    P.imDensity('compact');
    ok('density: Compact is applied (im-compact on the page) and remembered in this browser', P.el('paneImg').classList.contains('im-compact') && store['sellora.imgdensity'] === 'compact');
    const P2 = load({ im: true, ctx: { localStorage: ls } });
    ok('…a new visit starts Compact', P2.getDense() === 'compact');
    P.imDensity('comfortable');
    ok('…back to Comfortable', !P.el('paneImg').classList.contains('im-compact') && store['sellora.imgdensity'] === 'comfortable');
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
    ok('"C" over a tile copies that picture', P.getClip() && P.getClip().slots.PT02 === A('k1PT02') && Object.keys(P.getClip().slots).length === 1);
    P.setHover({ sku: 'K2', slot: '' });
    P.imKey({ key: 'C', target: { tagName: 'BODY' } });
    ok('"C" over a row copies all its pictures', P.getClip().sku === 'K2' && P.getClip().n === 9);
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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
