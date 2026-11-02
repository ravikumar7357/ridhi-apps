/* ================= RESEARCH · COSTING MATHS: the reverse costing the costing screens share =================
 * Screens: New Product (Calculate) and Settings (the "Landed = product cost × …" note under the fee tables)
 * use baseDivisor and landedMult. No screen calls computeTarget at the moment — New Product has its own
 * version of it, which also allows a flat $ per unit for shipping and duty.
 * Does: turns the Settings percentages into the two multipliers of the reverse costing — baseDivisor
 * (product cost ÷ it = base cost, i.e. P.M × factory overhead) and landedMult (product cost × it = landed
 * cost, i.e. shipping and duty) — and holds the original one-shot costing, computeTarget: from a selling
 * price, the two Amazon fees and the settings to every expense, the landed cost and the product and
 * factory costs.
 * Main functions: baseDivisor, landedMult, computeTarget. */

/* ---------- the reverse costing maths (mirrors the Apps Script / their sheet) ---------- */
// Shipping is a % of PRODUCT cost, but duty is a % of BASE cost (before ×factory-OH and ×P.M),
// so duty must be re-expressed against product cost before the two can be added. With their
// defaults this gives 1 + .30 + .15/1.375 = 1.409091 — the exact multiplier in their own sheet.
// Divide the product cost by this to get the base (factory) cost: P.M (markup ×, 1 when blank) × (1 + factory
// overhead %). 1 when that is not a positive number.
function baseDivisor(settings) {
  const divisor = (settings.pm || 1) * (1 + settings.factoh / 100);
  return divisor > 0 ? divisor : 1;
}
// Multiply the product cost by this to get the landed cost: 1 + shipping % + duty % (duty re-expressed
// against the product cost, see the note above).
function landedMult(settings) {
  return 1 + settings.ship / 100 + (settings.duty / 100) / baseDivisor(settings);
}

// The original one-shot reverse costing: the selling price, Amazon's referral and FBA fees and the settings
// in; every expense, the landed cost and the product and factory costs out. Every % here is a % of the
// selling price (New Product charges the return loss on the landed cost instead), and shipping and duty are
// the Settings percentages only. Not called by any screen today.
function computeTarget(price, referral, fba, settings) {
  // --- the expenses that are a % of the selling price ---
  const tacos = price * settings.tacos / 100;     // advertising (TACoS)
  const ret = price * settings.return / 100;      // return loss
  const oh = price * settings.oh / 100;           // Amazon OH (overheads)
  const sal = price * settings.salary / 100;      // employee salaries
  const profit = price * settings.profit / 100;   // the profit wanted
  // --- what is left for the goods ---
  const totalExp = referral + fba + tacos + ret + oh + sal;
  const landed = price - totalExp - profit;
  const bd = baseDivisor(settings);
  const productUsd = landed / landedMult(settings);
  return {
    tacos, ret, oh, sal, profit, totalExp, landed,
    shipping: productUsd * settings.ship / 100,      // shipping, a % of the product cost
    duty: productUsd * (settings.duty / 100) / bd,   // duty & tax, a % of the base cost
    productUsd,
    productInr: productUsd * settings.fx,            // the product cost in rupees
    factoryInr: (productUsd * settings.fx) / bd,     // the base (factory) cost in rupees
    marginPct: price > 0 ? profit / price : 0,
    roiPct: landed > 0 ? profit / landed : 0,
  };
}

