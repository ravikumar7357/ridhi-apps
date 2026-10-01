/* ================= THE RECIPE BUCKET =================
 *
 * One row per article + subtype + size, holding everything about a product that its colour does not
 * change: how much cloth it takes, what it is packed in, whether it is cut, its zip, its ruffle, its
 * filling. 4,730 SKUs live in 319 of these.
 *
 * A NEW SKU INHERITS IT. That is the whole point — "repeat article sub article aate h to again sabka
 * data feed krna padta h". Existing SKUs are left exactly as they are until somebody presses Apply
 * and is shown what would change, because quietly rewriting 4,730 rows is not a feature.
 */
