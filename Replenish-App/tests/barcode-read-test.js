/* The barcode reader used by Scan to pack (public/vendor/zxing.min.js, @zxing/library 0.23.0, Apache-2.0) reads the
 * Code 128 that FNSKU labels carry. The barcode is drawn by the app's own pkBarcode, rasterised the way a camera frame
 * arrives (luminance, scaled, blurred, noisy), and must come back as the same text.
 *   node tests/barcode-read-test.js */
const fs = require('fs'), path = require('path');
const ZXing = require(path.join(__dirname, '..', 'public', 'vendor', 'zxing.min.js'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'replenishment', 'fba-box-template.js'), 'utf8').replace(/\r\n/g, '\n');
const C128 = SRC.match(/const PK_C128 = [\s\S]*?\];/);
const pkBarcode = new Function((C128 ? C128[0] : '') + '\n' + SRC.match(/function pkBarcode[\s\S]*?\n}\n/)[0] + '\nreturn pkBarcode;')();
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

/** The SVG's bars as a grey image: `px` pixels a module, a margin, optional blur and noise. */
function raster(text, px, blur, noise) {
  const svg = pkBarcode(text, 40);
  const total = +svg.match(/viewBox="0 0 (\d+)/)[1];
  const bars = [...svg.matchAll(/x="(\d+)" y="0" width="(\d+)"/g)].map(m => [+m[1], +m[2]]);
  const W = Math.round(total * px) + 40, H = 80;
  let row = new Float32Array(W).fill(255);
  bars.forEach(([x, w]) => { for (let i = Math.round(x * px) + 20; i < Math.round((x + w) * px) + 20; i++) row[i] = 0; });
  for (let b = 0; b < blur; b++) { const r = row.slice(); for (let i = 1; i < W - 1; i++) row[i] = (r[i - 1] + r[i] + r[i + 1]) / 3; }
  const lum = new Uint8ClampedArray(W * H);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) lum[y * W + x] = Math.max(0, Math.min(255, row[x] + (rnd() - 0.5) * noise));
  return { lum, W, H };
}
/* Code 128 only, through its own reader: what Scan to pack uses (src/app/replenishment/pack-scan.js pkScanZxRead). */
function read({ lum, W, H }) {
  const hints = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
  try { return new ZXing.Code128Reader().decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(lum, W, H))), hints).getText(); }
  catch (e) { return null; }
}
console.log('== FNSKU labels, as the app draws them ==');
for (const code of ['X0045G8P3B', 'X003ZK2Q9L', 'B0H367KBV4', 'RTC136060']) {
  ok(`${code}: clean`, read(raster(code, 3, 0, 0)) === code);
  ok(`${code}: soft and noisy, like a phone camera (2 px a bar, blurred, noise)`, read(raster(code, 2, 1, 50)) === code, String(read(raster(code, 2, 1, 50))));
  ok(`${code}: small in the frame (1.5 px a bar)`, read(raster(code, 1.5, 0, 20)) === code, String(read(raster(code, 1.5, 0, 20))));
}
/* How bad it may get before nothing reads — never a WRONG read, only none. */
let wrong = 0, none = 0, right = 0;
for (const code of ['X0045G8P3B', 'X003ZK2Q9L', 'X00ABCDEF1', 'X009Z8Y7W6']) for (const px of [1.2, 1.6, 2, 2.6, 3.2]) for (const blur of [0, 1, 2, 3]) for (const noise of [0, 40, 80]) {
  const got = read(raster(code, px, blur, noise));
  if (got === code) right++; else if (got === null) none++; else wrong++;
}
console.log(`  (stress: ${right} read right, ${none} read nothing, ${wrong} read WRONG of ${right + none + wrong})`);
ok('under stress it reads right or reads nothing — never a wrong code', wrong === 0, wrong + ' wrong');
ok('a frame with no barcode reads as nothing, not as a guess', read({ lum: new Uint8ClampedArray(400 * 80).fill(200), W: 400, H: 80 }) === null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
