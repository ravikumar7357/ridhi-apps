/* A SPREAD THAT CAPS ITSELF DROPS PIECES SILENTLY.
 *
 * rfdSpread stopped at the room available, so a printer asking for 200 pieces of a size whose order
 * covers 60 would have had 60 written and 140 vanish — on a screen that says in as many words that
 * anything beyond the order goes to The Fabric Rush to approve. The ceiling is the caller's business,
 * not the arithmetic's: this now always adds up to exactly what was asked for.
 *
 * And when there is no room left anywhere and somebody is asking anyway, the extra is shared evenly
 * rather than divided by a total of nothing and lost.
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

one(`function rfdSpread(total, rooms) {
  const w = (rooms || []).map(x => Math.max(0, Math.floor(parseFloat(x) || 0)));
  const out = w.map(() => 0);
  const room = w.reduce((a, b) => a + b, 0);
  let left = Math.min(Math.max(0, Math.round(parseFloat(total) || 0)), room);
  if (!left) return out;
  const exact = w.map(x => (x / room) * left);
  exact.forEach((v, i) => { out[i] = Math.min(w[i], Math.floor(v)); });
  left -= out.reduce((a, b) => a + b, 0);
  w.map((x, i) => ({ i, rem: exact[i] - Math.floor(exact[i]) }))
    .sort((a, b) => b.rem - a.rem || w[b.i] - w[a.i] || a.i - b.i)
    .forEach(x => { if (left > 0 && out[x.i] < w[x.i]) { out[x.i]++; left--; } });
  /* A second pass: a part already at its own ceiling could not take its share, and those pieces
   * belong to somebody rather than to nobody. */
  while (left > 0) {
    let moved = false;
    for (let i = 0; i < out.length && left > 0; i++) if (out[i] < w[i]) { out[i]++; left--; moved = true; }
    if (!moved) break;
  }
  return out;
}`,
`function rfdSpread(total, weights) {
  const t = Math.max(0, Math.round(parseFloat(total) || 0));
  let w = (weights || []).map(x => Math.max(0, parseFloat(x) || 0));
  const out = w.map(() => 0);
  if (!t || !w.length) return out;
  /* NOTHING LEFT ANYWHERE AND STILL ASKING. Asking beyond what the order covers is allowed — it goes
   * to the office to approve — so dividing by a total of nothing must share the extra out, not throw
   * it away. */
  let sum = w.reduce((a, b) => a + b, 0);
  if (!sum) { w = w.map(() => 1); sum = w.length; }
  const exact = w.map(x => (x / sum) * t);
  exact.forEach((v, i) => { out[i] = Math.floor(v); });
  let left = t - out.reduce((a, b) => a + b, 0);
  /* The pieces the fractions leave over go to the largest remainders first, so the result adds up to
   * exactly what was asked for. Thirteen colours each rounded down lose thirteen pieces. */
  w.map((x, i) => ({ i, rem: exact[i] - Math.floor(exact[i]) }))
    .sort((a, b) => b.rem - a.rem || w[b.i] - w[a.i] || a.i - b.i)
    .forEach(x => { if (left > 0) { out[x.i]++; left--; } });
  return out;
}`, 'the spread always adds up');

one(`  const rooms = g.skus.map(x => Math.max(0, x.pieces - rfdUsedPcs(o, x.sku) - rfdStockForSku(o, x.sku)));
  const total = rooms.reduce((a, b) => a + b, 0);
  const share = rfdSpread(want, total >= want ? rooms : g.skus.map(x => x.pieces));`,
`  const rooms = g.skus.map(x => Math.max(0, x.pieces - rfdUsedPcs(o, x.sku) - rfdStockForSku(o, x.sku)));
  /* SHARED OUT BY WHAT EACH COLOUR STILL NEEDS — or, when none of them needs anything and the
   * printer is asking beyond the order anyway, by how big each colour is. */
  const share = rfdSpread(want, rooms.some(x => x > 0) ? rooms : g.skus.map(x => x.pieces));`, 'and the submit chooses its weights');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
