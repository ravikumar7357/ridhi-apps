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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
