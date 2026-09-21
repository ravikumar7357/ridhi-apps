/* VOIL AND CANVAS IN THE PRINTER'S FABRIC CATALOGUE.
 *
 * Ravi, 2026-09-21: "jis type se humne fabric ke sku banaye the aise hi mujhe canvas or voil ke liye
 * banane h", with the reference for 327 Light Steel Blue, Ridhi:
 *   Voil 92  Horizontal  RQL327-T-Front / RQL327-T-Back
 *   Voil 92  Vertical    RQL327-Q-Front / RQL327-Q-Back
 *   Voil 112 Horizontal  RQL327-K-Front / RQL327-K-Back
 *   Canvas   Vertical    RBP-CANVAS-327
 *
 * The voil is quilt cloth, so the letter is the quilt size the cloth is cut for (T, Q, K) and every
 * one comes as a Front and a Back. Only these three width/direction pairs exist — a Voil 112
 * Vertical is not something anybody makes, so it gets no SKU rather than an invented one.
 *
 * Ridhi only, because that is the reference. CPC has no prefix for these yet, and guessing one would
 * put SKUs on the screen nobody uses.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

one(`const FS_DIRS = [['V', 'Vertical'], ['H', 'Horizontal']];`,
`const FS_DIRS = [['V', 'Vertical'], ['H', 'Horizontal']];
/* Voil (quilt cloth) and canvas, by brand. Only the brands listed here have them. */
const FS_QUILT = { RBP: { voil: 'RQL', canvas: 'RBP-CANVAS-' } };
/* The only voil widths and directions made, and the quilt size letter each is cut for. */
const FS_VOIL = [['92', 'Horizontal', 'T'], ['92', 'Vertical', 'Q'], ['112', 'Horizontal', 'K']];
const FS_SIDES = ['Front', 'Back'];`, 'the shapes');

one(`function fsSku(brandKey, code, fabric, dir) {
  const b = FS_BRANDS.find(x => x.key === brandKey);
  if (!b || !code) return '';
  if (String(fabric).toUpperCase() === 'CAMBRIC') return b.cambric + code;`,
`function fsSku(brandKey, code, fabric, dir, side) {
  const b = FS_BRANDS.find(x => x.key === brandKey);
  if (!b || !code) return '';
  if (String(fabric).toUpperCase() === 'CAMBRIC') return b.cambric + code;
  const q = FS_QUILT[brandKey];
  if (/^CANVAS$/i.test(String(fabric).trim())) return q ? q.canvas + code : '';
  if (/^VOIL/i.test(String(fabric).trim())) {
    const w = String(fabric).replace(/[^0-9]/g, '');
    const v = FS_VOIL.find(x => x[0] === w && x[1] === dir);
    const sd = FS_SIDES.find(x => x.toLowerCase() === String(side || '').toLowerCase());
    return q && v && sd ? q.voil + code + '-' + v[2] + '-' + sd : '';
  }`, 'the SKU');

one(`  FS_WIDTHS.forEach(w => FS_DIRS.forEach(([, dir]) => {
    out.push({ fabric: 'Sheeting ' + w, width: w, dir, sku: fsSku(brandKey, code, 'Sheeting ' + w, dir) });
  }));`,
`  FS_WIDTHS.forEach(w => FS_DIRS.forEach(([, dir]) => {
    out.push({ fabric: 'Sheeting ' + w, width: w, dir, sku: fsSku(brandKey, code, 'Sheeting ' + w, dir) });
  }));
  /* Voil comes as a Front and a Back for each quilt size; canvas is one line, printed vertically. */
  if (FS_QUILT[brandKey]) {
    FS_VOIL.forEach(([w, dir]) => FS_SIDES.forEach(side => {
      out.push({ fabric: 'Voil ' + w, width: w, dir, side, sku: fsSku(brandKey, code, 'Voil ' + w, dir, side) });
    }));
    out.push({ fabric: 'Canvas', width: '', dir: 'Vertical', sku: fsSku(brandKey, code, 'Canvas', 'Vertical') });
  }`, 'the lines');

/* The voil SKUs are written as Ravi writes them, Front/Back in mixed case, so a typed SKU is matched
 * without regard to case. */
one(`  return fsRows({ q: want.toLowerCase() }).find(r => r.sku === want) || null;`,
`  return fsRows({ q: want.toLowerCase() }).find(r => r.sku.toUpperCase() === want) || null;`, 'lookup ignores case');
one(`  if (!VOF.fs) VOF.fs = new Map(fsRows({}).map(r => [r.sku, r]));`,
`  /* Keyed in capitals: every lookup here upper-cases what was typed, and RQL327-T-Front is not. */
  if (!VOF.fs) VOF.fs = new Map(fsRows({}).map(r => [r.sku.toUpperCase(), r]));`, 'order form lookup ignores case');
one(`    \`<option value="\${esc(r.sku)}">\${esc([r.brandName, r.colour, r.fabric, r.width ? r.dir : ''].filter(Boolean).join(' · '))}</option>\`).join('');`,
`    \`<option value="\${esc(r.sku)}">\${esc([r.brandName, r.colour, r.fabric, r.width ? r.dir : '', r.side || ''].filter(Boolean).join(' · '))}</option>\`).join('');`, 'order form shows the side');

/* The screen: the side under the fabric, and the message says what is on it. */
one(`    + \`<td style="text-align:left">\${esc(r.fabric)}</td>\``,
`    + \`<td style="text-align:left">\${esc(r.fabric)}\${r.side ? \` <span class="muted" style="font-size:11.5px">· \${esc(r.side)}</span>\` : ''}</td>\``, 'side on screen');
one(`    + 'cambric, and five sheeting widths each way up'`,
`    + 'cambric, five sheeting widths each way up, and for Ridhi voil (front and back) and canvas'`, 'message');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
