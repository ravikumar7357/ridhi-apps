# Shared by both apps

One copy of code that the Replenish app and Sellora used to carry separately (module plan step 4, 1 Oct 2026).
Both apps list these files in their `src/app/ORDER` as `@shared/<file>`; `Replenish-App/tests/assemble.js` joins them in.
**After editing a file here, assemble BOTH apps** (`tests/src_patch.py` does that when a shared file changed).

- `adjustments.js` - the Adjustments tab. Calls the Replenish Order Console sync only where that app defines it.
- `courier-templates.js` - Courier & MCF upload templates.
- `imported-orders.js`, `imported-orders-export.js` - Imported orders. Replenish joins its bulk-update block
  (`shopify/imported-orders-bulk.js`) between the two; the image lookup calls `prGet` (Replenish) or `baCall` (Sellora).
