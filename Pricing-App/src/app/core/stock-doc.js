/* ================= CORE · STOCK DOC: the Amazon stock figures saved for the Replenish app =================
 * Screens: none of its own — Listing Health and Parent Listing Review call it from their refresh buttons.
 * Does: writes one brand's Amazon stock per SKU to Firestore stock/{brand}, and refuses an empty report.
 * Main function: saveStockDoc(brand, map) → the number of SKUs saved. */

/* ================= AMAZON STOCK, SAVED FOR THE REPLENISH APP =================
 * Listing Health's and Parent Listing Review's refresh save the Amazon stock per SKU to Firestore stock/{brand}; the
 * Replenish app's Shopify screen reads it. Kept here when the hidden Shopify Orders code left Sellora (2026-10-01). */
// Save { sku: quantity } for one brand as stock/{brand} = { m: the map, n: how many SKUs, at: when }. Throws when
// the map is empty, so a report that came back blank never wipes the quantities already saved.
async function saveStockDoc(brand, map) {
  const n = Object.keys(map || {}).length;
  if (!n) {
    throw new Error(`Amazon's stock report for ${BRAND_NAME[brand] || brand} came back with no rows, `
      + 'so nothing was saved — the quantities you already had are untouched. '
      + 'Amazon is usually still building the report; try again in a few minutes.');
  }
  await setDoc(doc(db, 'stock', brand), { m: map, n, at: serverTimestamp() });
  return n;
}
