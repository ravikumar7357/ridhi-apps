/* ================= CORE · STOCK DOC: the Amazon stock figures saved for the Replenish app =================
 * Screens: none of its own — Listing Health and Parent Listing Review call it from their refresh buttons.
 * Does: writes one brand's Amazon stock per SKU to Firestore stock/{brand}, and refuses an empty report.
 * Main functions: saveStockDoc(brand, map, inMap) → the number of SKUs saved; stockInMap(rows) → the units on the way. */

/* ================= AMAZON STOCK, SAVED FOR THE REPLENISH APP =================
 * Listing Health's and Parent Listing Review's refresh save the Amazon stock per SKU to Firestore stock/{brand}; the
 * Replenish app's Shopify screen reads it. Kept here when the hidden Shopify Orders code left Sellora (2026-10-01). */
// Save { sku: quantity } for one brand as stock/{brand} = { m: the map, n: how many SKUs, at: when }. Throws when
// the map is empty, so a report that came back blank never wipes the quantities already saved.
// STOCK ON THE WAY (25 Nov 2026): `inMap` (from stockInMap below) is saved as one EXTRA field, in = { sku: [working,
// shipped, receiving] }. m, n and at are written exactly as before, and the Replenish app reads only those. With no
// inMap (a backend that does not send inbound yet) the field is left out, so the Forecast says "Inbound: unknown".
async function saveStockDoc(brand, map, inMap) {
  const n = Object.keys(map || {}).length;
  if (!n) {
    throw new Error(`Amazon's stock report for ${BRAND_NAME[brand] || brand} came back with no rows, `
      + 'so nothing was saved — the quantities you already had are untouched. '
      + 'Amazon is usually still building the report; try again in a few minutes.');
  }
  const data = { m: map, n, at: serverTimestamp() };
  if (inMap && typeof inMap === 'object') data.in = inMap;
  await setDoc(doc(db, 'stock', brand), data);
  return n;
}

// The report's rows → { sku: [working, shipped, receiving] } for the SKUs with units on the way (a SKU left out has
// none: that is how the Forecast reads it). null when the report carried no inbound at all — unknown, never 0.
function stockInMap(rows) {
  const list = rows || [];
  if (!list.some(row => Array.isArray(row.inb))) return null;
  const out = {};
  list.forEach(row => {
    if (!row.sku || !Array.isArray(row.inb)) return;
    const p = [0, 1, 2].map(j => Math.max(0, Number(row.inb[j]) || 0));
    if (p[0] + p[1] + p[2] > 0) out[row.sku] = p;
  });
  return out;
}
