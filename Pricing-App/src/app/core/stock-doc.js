/* ================= AMAZON STOCK, SAVED FOR THE REPLENISH APP =================
 * Listing Health's and Parent Listing Review's refresh save the Amazon stock per SKU to Firestore stock/{brand}; the
 * Replenish app's Shopify screen reads it. Kept here when the hidden Shopify Orders code left Sellora (2026-10-01). */
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
