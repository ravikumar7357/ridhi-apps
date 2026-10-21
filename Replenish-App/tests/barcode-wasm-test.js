/* The better barcode reader of Scan to pack (public/vendor/zxing-wasm-reader.js + zxing_reader.wasm: zxing-wasm 3.1.5,
 * zxing-cpp built for the browser, MIT) against the old one (public/vendor/zxing.min.js) on camera-like pictures:
 * an FNSKU label drawn by the app's own pkBarcode, set on cloth — plain, striped across, striped along — lying across,
 * stuck on upright (Ravi's 21 Oct photo of X0055RALOT that would not scan), tilted, small, blurred, noisy.
 * The new reader must read every picture a packer could aim at, never a wrong code, and do at least what the old did.
 *   node tests/barcode-wasm-test.js */
const fs = require('fs'), path = require('path');
const VENDOR = path.join(__dirname, '..', 'public', 'vendor');
const ZXingWASM = new Function(fs.readFileSync(path.join(VENDOR, 'zxing-wasm-reader.js'), 'utf8') + '\nreturn ZXingWASM;')();
const ZXing = require(path.join(VENDOR, 'zxing.min.js'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'replenishment', 'fba-box-template.js'), 'utf8').replace(/\r\n/g, '\n');
const C128 = SRC.match(/const PK_C128 = [\s\S]*?\];/);
const pkBarcode = new Function((C128 ? C128[0] : '') + '\n' + SRC.match(/function pkBarcode[\s\S]*?\n}\n/)[0] + '\nreturn pkBarcode;')();
/* the options pack-scan.js reads with */
const PS = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'replenishment', 'pack-scan.js'), 'utf8');
const OPT = new Function('return ' + PS.match(/const PKS_WZ_OPT = (\{[^\n]*\});/)[1])();
const TURN = new Function('return ' + PS.match(/const PKS_WZ_TURN = (\[[^\n]*\]);/)[1])();
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

/** A camera picture W×H: cloth (`bg`: plain / across = stripes running left-right / along = top-bottom), a white label
 * with the barcode, `px` pixels a bar, turned `deg`, centred at (cx, cy); then `blur` passes and `noise`. RGBA + grey. */
function scene(text, o) {
  const { W = 900, H = 700, px = 2.4, deg = 0, bg = 'plain', blur = 1, noise = 24, cx = W / 2, cy = H / 2 } = o;
  const svg = pkBarcode(text, 40), total = +svg.match(/viewBox="0 0 (\d+)/)[1];
  const bars = [...svg.matchAll(/x="(\d+)" y="0" width="(\d+)"/g)].map(m => [+m[1], +m[2]]);
  const mod = new Uint8Array(total); bars.forEach(([x, w]) => mod.fill(1, x, x + w));
  const lw = total * px + 24 * px, lh = 34 * px + 30 * px;     // label: quiet zone each side, text space under
  const a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  let g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - cx, dy = y - cy, u = cs * dx + sn * dy + lw / 2, v = -sn * dx + cs * dy + lh / 2;   // into label space
    let val;
    if (u >= 0 && u < lw && v >= 0 && v < lh) {
      const m = Math.floor((u - 12 * px) / px), inBars = v >= 6 * px && v < 6 * px + 34 * px;
      val = inBars && m >= 0 && m < total && mod[m] ? 25 : 240;
    } else if (bg === 'across') val = Math.floor(y / 9) % 2 ? 70 : 190;
    else if (bg === 'along') val = Math.floor(x / 9) % 2 ? 70 : 190;
    else val = 150;
    g[y * W + x] = val;
  }
  for (let b = 0; b < blur; b++) {
    const r = g.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; g[i] = (r[i] * 4 + r[i - 1] + r[i + 1] + r[i - W] + r[i + W]) / 8;
    }
  }
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const lum = new Uint8ClampedArray(W * H), rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = Math.max(0, Math.min(255, g[i] + (rnd() - 0.5) * noise));
    lum[i] = v; rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
  }
  return { W, H, lum, img: { data: rgba, width: W, height: H } };
}
/** The picture turned `deg` the way pksWzRead draws it on its canvas (setTransform(cs, sn, -sn, cs, cw/2, ch/2)), grey
 * where the turned picture leaves the canvas bare. */
function turned(s, deg) {
  if (!deg) return s.img;
  const a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), W = s.W, H = s.H, L = s.lum;
  const cw = Math.ceil(Math.abs(W * cs) + Math.abs(H * sn)), ch = Math.ceil(Math.abs(W * sn) + Math.abs(H * cs)), d = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const dx = x - cw / 2, dy = y - ch / 2, px = cs * dx + sn * dy + W / 2, py = -sn * dx + cs * dy + H / 2, x0 = Math.floor(px), y0 = Math.floor(py);
    let v = 128;
    if (x0 >= 0 && y0 >= 0 && x0 < W - 1 && y0 < H - 1) {
      const fx = px - x0, fy = py - y0;
      v = (L[y0 * W + x0] * (1 - fx) + L[y0 * W + x0 + 1] * fx) * (1 - fy) + (L[(y0 + 1) * W + x0] * (1 - fx) + L[(y0 + 1) * W + x0 + 1] * fx) * fy;
    }
    const i = (y * cw + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return { data: d, width: cw, height: ch };
}
/* the old reader as pack-scan.js used it: the picture as it is, then on its side (it cannot read bars running across) */
function oldRead(s) {
  const hints = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
  const one = (lum, W, H) => { try { return new ZXing.Code128Reader().decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(lum, W, H))), hints).getText(); } catch (e) { return null; } };
  const r = one(s.lum, s.W, s.H); if (r) return r;
  const t = new Uint8ClampedArray(s.W * s.H);
  for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) t[x * s.H + (s.H - 1 - y)] = s.lum[y * s.W + x];
  return one(t, s.H, s.W);
}

(async () => {
  await ZXingWASM.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(path.join(VENDOR, 'zxing_reader.wasm')) }, fireImmediately: true });
  /* one round of pictures as the scanner reads them: each turn of PKS_WZ_TURN once */
  const read = async s => {
    const out = new Set();
    for (const t of new Set(TURN)) (await ZXingWASM.readBarcodes(turned(s, t), OPT)).filter(x => x.isValid).forEach(x => out.add(x.text));
    return [...out];
  };
  ok('the vendored .wasm is the one the reader was built for', require('crypto').createHash('sha256').update(fs.readFileSync(path.join(VENDOR, 'zxing_reader.wasm'))).digest('hex') === ZXingWASM.ZXING_WASM_SHA256);
  ok('nothing is fetched from outside: the app points the .wasm at /vendor', /locateFile: \(f, pre\) => \(f\.endsWith\("\.wasm"\) \? "\/vendor\/" \+ f/.test(PS));

  console.log('== Ravi\'s photo, 21 Oct: an FNSKU label stuck on upright, on striped cloth ==');
  for (const [name, o] of [
    ['upright on stripes running across', { deg: 90, bg: 'across' }],
    ['upright on stripes running along', { deg: 90, bg: 'along' }],
    ['upside down on stripes', { deg: 270, bg: 'across' }],
    ['lying across on stripes', { deg: 0, bg: 'across' }],
    ['lying across, stripes along the bars', { deg: 0, bg: 'along' }],
  ]) {
    const s = scene('X0055RALOT', o), got = await read(s);
    ok(`X0055RALOT ${name}: read`, got.length === 1 && got[0] === 'X0055RALOT', JSON.stringify(got) + ' · old reader: ' + oldRead(s));
  }
  console.log('== the hard ones: tilted, small, soft, dark ==');
  let n = 0, newRead = 0, oldGot = 0, wrong = 0;
  for (const code of ['X0055RALOT', 'X0045G8P3B', 'X003ZK2Q9L', 'B0H367KBV4']) {
    for (const o of [
      { deg: 12, bg: 'across' }, { deg: 78, bg: 'across' }, { deg: 100, bg: 'along' }, { deg: 35, bg: 'plain' },
      { px: 1.8, bg: 'across', deg: 90 }, { blur: 3, noise: 40, bg: 'across' }, { blur: 2, deg: 90, bg: 'along', noise: 50 },
    ]) {
      const s = scene(code, o), got = await read(s), old = oldRead(s);
      n++; if (got.includes(code)) newRead++; if (old === code) oldGot++;
      if (got.some(t => t !== code)) wrong++;
      if (old && old !== code) wrong++;
    }
  }
  console.log(`  new reader ${newRead}/${n} · old reader ${oldGot}/${n}`);
  ok('the new reader reads all 28 hard pictures', newRead === n, newRead + '/' + n);
  ok('the new reader reads more than the old', newRead > oldGot, `${newRead} vs ${oldGot}`);
  ok('no picture comes back as a wrong code', wrong === 0, String(wrong));
  console.log('== held at any slant: every 5° of a half turn ==');
  const missed = [];
  for (let deg = 0; deg < 180; deg += 5) if (!(await read(scene('X0055RALOT', { deg, bg: 'across' }))).includes('X0055RALOT')) missed.push(deg);
  ok('no angle is left unread', !missed.length, 'not read at ' + missed.join('°, ') + '°');
  console.log('== where the label is, turned back into the camera picture (pksWzRead) ==');
  for (const t of TURN.filter(x => x)) {
    const s = scene('X0045G8P3B', { cx: 380, cy: 300, deg: (180 - t + 3) % 180 }), img = turned(s, t);
    const hit = (await ZXingWASM.readBarcodes(img, OPT)).find(x => x.isValid);
    const a = t * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), q = hit && hit.position;
    const dx = q ? (q.topLeft.x + q.topRight.x + q.bottomLeft.x + q.bottomRight.x) / 4 - img.width / 2 : 0;
    const dy = q ? (q.topLeft.y + q.topRight.y + q.bottomLeft.y + q.bottomRight.y) / 4 - img.height / 2 : 0;
    const bx = s.W / 2 + cs * dx + sn * dy, by = s.H / 2 - sn * dx + cs * dy;
    ok(`turned ${t}°: the label's middle comes back where it is (380, 300)`, hit && Math.hypot(bx - 380, by - 300) < 25, hit ? `${Math.round(bx)}, ${Math.round(by)}` : 'not read');
  }
  ok('the app turns the middle back with the same sums', PS.includes('x: sx + sw / 2 + cs * dx + sn * dy, y: sy + sh / 2 - sn * dx + cs * dy'));
  console.log('== two labels in view ==');
  const W = 1000, H = 600, a = scene('X0045G8P3B', { W, H, cx: 270, bg: 'across' }), b = scene('X003ZK2Q9L', { W, H, cx: 760, bg: 'across' });
  const both = new Uint8ClampedArray(a.img.data); for (let y = 0; y < H; y++) for (let x = 500; x < W; x++) for (let k = 0; k < 4; k++) both[(y * W + x) * 4 + k] = b.img.data[(y * W + x) * 4 + k];
  const two = await ZXingWASM.readBarcodes({ data: both, width: W, height: H }, OPT);
  ok('both are found, each with where it is (so the one aimed at is chosen)', two.length === 2 && two.every(x => x.position && x.position.topLeft) && two.map(x => x.text).sort().join() === 'X003ZK2Q9L,X0045G8P3B', JSON.stringify(two.map(x => x.text)));
  console.log('== nothing there ==');
  ok('stripes alone read as nothing', (await read(scene('X0055RALOT', { bg: 'across', cx: -999 }))).length === 0);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
