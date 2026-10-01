/* ---------- the reverse costing maths (mirrors the Apps Script / their sheet) ---------- */
// Shipping is a % of PRODUCT cost, but duty is a % of BASE cost (before ×factory-OH and ×P.M),
// so duty must be re-expressed against product cost before the two can be added. With their
// defaults this gives 1 + .30 + .15/1.375 = 1.409091 — the exact multiplier in their own sheet.
function baseDivisor(s) { const d = (s.pm || 1) * (1 + s.factoh / 100); return d > 0 ? d : 1; }
function landedMult(s) { return 1 + s.ship / 100 + (s.duty / 100) / baseDivisor(s); }

function computeTarget(price, referral, fba, s) {
  const tacos = price * s.tacos / 100;
  const ret = price * s.return / 100;
  const oh = price * s.oh / 100;
  const sal = price * s.salary / 100;
  const profit = price * s.profit / 100;
  const totalExp = referral + fba + tacos + ret + oh + sal;
  const landed = price - totalExp - profit;
  const bd = baseDivisor(s);
  const productUsd = landed / landedMult(s);
  return {
    tacos, ret, oh, sal, profit, totalExp, landed,
    shipping: productUsd * s.ship / 100,
    duty: productUsd * (s.duty / 100) / bd,
    productUsd, productInr: productUsd * s.fx,
    factoryInr: (productUsd * s.fx) / bd,
    marginPct: price > 0 ? profit / price : 0,
    roiPct: landed > 0 ? profit / landed : 0,
  };
}

