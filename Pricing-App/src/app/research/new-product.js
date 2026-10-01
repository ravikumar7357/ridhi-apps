/* ---------- New product tab ---------- */
// Same reverse costing as the link tab — the only difference is WHERE the two Amazon fees come from.
// There is no ASIN here, and Amazon's Fees API only quotes against an ASIN/SKU, so referral comes
// from the category table and FBA from the size-tier table (both maintained in Settings).

let NREF = null;   // reference product fetched from Amazon: { asin, title, category, weight, dims, fba, refPct }

function fillNewDefaults() {
  $('n_margin').value = SET.profit; $('n_sal').value = SET.salary; $('n_ret').value = SET.return;
  $('n_ship').value = SET.ship; $('n_duty').value = SET.duty;
  $('n_tacos').value = String(SET.tacos);
  $('n_oh').value = String(SET.oh);
  $('n_pm').value = String(SET.pm);
  freightHints();
}
// The little grey hint after each freight label follows its % / $ mode.
function freightHints() {
  $('n_shipHint').textContent = $('n_shipMode').value === 'usd' ? '($ per unit)' : '(% of product cost)';
  $('n_dutyHint').textContent = $('n_dutyMode').value === 'usd' ? '($ per unit)' : '(% of base cost)';
}
$('n_shipMode').addEventListener('change', freightHints);
$('n_dutyMode').addEventListener('change', freightHints);

/**
 * Pull the reference product from Amazon and fill the form from it: category (as Amazon's OWN
 * referral rate, not a table lookup), weight, and the exact FBA fee. Quoted AT the target price,
 * because the referral fee — and some FBA weight/price bands — move with the price.
 */
$('n_fetch').onclick = async () => {
  const v = $('n_ref').value.trim();
  const info = $('n_refInfo');
  const price = parseFloat($('n_price').value);   // may be blank → we auto-fill it from the product's live price
  if (!v) { info.className = 'err'; info.classList.remove('hide'); info.textContent = 'Paste a reference ASIN or Amazon link first.'; return; }

  $('n_fetch').disabled = true;
  $('n_fetch').innerHTML = '<span class="spin" style="border-top-color:currentColor"></span>…';
  info.classList.remove('hide'); info.className = 'muted'; info.textContent = 'Asking Amazon…';
  try {
    const d = await callApi(v, price);          // price>0 → quote at it; blank → backend quotes at buyBox
    const r2 = x => Math.round(x * 100) / 100;  // Amazon's catalog dims carry float junk (15.15999998…) — clamp to 2dp
    // Auto-fill the target price from the product's own live price when the field is blank. It stays a
    // normal input, so the user can overwrite it (Calculate re-checks the fees at the final price).
    if (!(price > 0) && d.price > 0) $('n_price').value = r2(d.price);
    NREF = {
      asin: d.asin, title: d.title, category: d.category, weight: d.weight, dims: d.dims || null, fba: d.fba,
      atPrice: d.price,                    // the price the fees were actually quoted at (buyBox if none was given)
      refPct: d.price > 0 && d.referral > 0 ? (d.referral / d.price) * 100 : null,
    };
    if (d.weight > 0) $('n_wt').value = r2(d.weight);
    // Package size — for the seller's reference only (with a ref ASIN the fee comes from Amazon, so the
    // tier table is skipped). Fill L/W/H so the numbers show where dimensions live.
    if (d.dims && d.dims.l > 0) { $('n_l').value = r2(d.dims.l); $('n_w').value = r2(d.dims.w); $('n_h').value = r2(d.dims.h); }
    syncCatSelect();                       // adds + selects the Auto option
    if (NREF.refPct != null) $('n_cat').selectedIndex = 0;
    const dimTxt = d.dims && d.dims.l > 0
      ? `${r2(d.dims.l)}×${r2(d.dims.w)}×${r2(d.dims.h)} ${d.dims.unit || 'in'}` : 'size unknown';
    info.className = 'ok';
    info.innerHTML = `✅ <b>${(d.title || d.asin).slice(0, 70)}</b><br>` +
      `${d.price > 0 ? 'priced ' + money(d.price) + ' &nbsp;·&nbsp; ' : ''}` +
      `${d.category || 'category unknown'} &nbsp;·&nbsp; referral ${NREF.refPct != null ? NREF.refPct.toFixed(1) + '%' : '—'} ` +
      `&nbsp;·&nbsp; FBA ${money(d.fba)} &nbsp;·&nbsp; ${d.weight ? d.weight + ' lb' : 'weight unknown'} ` +
      `&nbsp;·&nbsp; pkg ${dimTxt}`;
  } catch (e) {
    NREF = null; syncCatSelect();
    info.className = 'err'; info.textContent = String(e.message || e);
  }
  $('n_fetch').disabled = false;
  $('n_fetch').textContent = 'Fetch details';
};
// Editing the ASIN invalidates whatever was fetched for the old one.
$('n_ref').addEventListener('input', () => {
  if (NREF && $('n_ref').value.trim().toUpperCase().indexOf(NREF.asin) < 0) {
    NREF = null; syncCatSelect(); $('n_refInfo').classList.add('hide');
  }
});
// Changing the price makes the fetched fees stale (referral scales, FBA can cross a price band).
// Say so rather than quietly costing on the old numbers — Calculate re-fetches anyway.
$('n_price').addEventListener('input', () => {
  if (!NREF) return;
  const p = parseFloat($('n_price').value);
  const stale = NREF.atPrice !== p;
  $('n_refInfo').className = stale ? 'warn' : 'ok';
  if (stale) $('n_refInfo').textContent =
    `⚠️ Fees above were quoted at ${money(NREF.atPrice)} — Calculate will re-check them at the new price.`;
});

/** Nearest .99 price point to the target — the price you'd actually list at (34.99, not 35.00). */
function suggestPrice(p) {
  const cands = [Math.floor(p) - 1 + 0.99, Math.floor(p) + 0.99].filter(x => x >= 0.99);
  if (!cands.length) return 0.99;
  return cands.reduce((best, x) => Math.abs(x - p) < Math.abs(best - p) ? x : best);
}

$('nGo').onclick = async () => {
  const price = parseFloat($('n_price').value);
  const wt = parseFloat($('n_wt').value);
  const dims = [parseFloat($('n_l').value), parseFloat($('n_w').value), parseFloat($('n_h').value)];
  const refAsin = $('n_ref').value.trim();
  const nm = t => { const m = $('nMsg'); m.textContent = t; m.className = 'err'; };
  if (!(price > 0)) return nm('Enter a target selling price.');

  const s = { ...readSettings() };
  s.pm = parseFloat($('n_pm').value) || s.pm;
  const refPct = parseFloat($('n_cat').value);
  if (!(refPct >= 0)) return nm('Pick a category (add one in Settings if the list is empty).');

  // FBA fee — two sources, reference ASIN wins. A reference ASIN is EXACT (it's Amazon's own quote
  // for a product of that size, surcharges and all), so it beats any hand-maintained rate table.
  // The tier table is the offline fallback for when there's no comparable product to point at.
  let fba, fbaSrc;
  $('nGo').disabled = true;
  try {
    if (refAsin) {
      // Reuse what "Fetch details" already pulled — but ONLY if it was quoted at the price we're
      // costing at now. FBA fees have price bands, so a fee fetched at $20 can be wrong at $60.
      let d = (NREF && NREF.atPrice === price) ? NREF : null;
      if (!d) {
        $('nMsg').textContent = 'Asking Amazon for the fee…'; $('nMsg').className = 'muted';
        $('nGo').innerHTML = '<span class="spin"></span>…';
        try { d = await callApi(refAsin, price); }
        catch (e) { return nm('Reference ASIN: ' + (e.message || e)); }
      }
      fba = d.fba;
      fbaSrc = `Amazon, via ${d.asin}`;
      if (!(fba > 0)) return nm(`Amazon returned no FBA fee for ${d.asin} — is it an FBA product? Try another reference ASIN.`);
    } else {
      if (!(wt > 0)) return nm('Enter the weight, or give a reference ASIN.');
      if (dims.some(d => !(d > 0))) return nm('Enter all three package dimensions, or give a reference ASIN.');
      const tier = fbaTierFor(s.tiers, wt, dims);
      if (!tier) return nm(`No size tier fits ${dims.join('×')}" at ${wt} lb — add a bigger tier in Settings.`);
      if (!(tier.fee > 0)) return nm(`The "${tier.name}" tier has no fee yet — either fill it in from Amazon's rate card (Settings), or give a reference ASIN above and skip the table entirely.`);
      fba = tier.fee;
      fbaSrc = `tier: ${tier.name}`;
    }
  } finally { $('nGo').disabled = false; $('nGo').textContent = 'Calculate'; }

  // Referral always comes from the category YOU picked — not from the reference product, which may
  // well sit in a different category.
  const referral = price * refPct / 100;
  const tacos = price * (parseFloat($('n_tacos').value) || 0) / 100;
  const oh = price * (parseFloat($('n_oh').value) || 0) / 100;
  const sal = price * (parseFloat($('n_sal').value) || 0) / 100;
  const profit = price * (parseFloat($('n_margin').value) || 0) / 100;
  const retPct = parseFloat($('n_ret').value) || 0;

  // Return loss is charged on the LANDED cost (the goods you actually risk on a return), not on the
  // selling price. That's a loop — landed = base − ret and ret = landed·retPct — so solve it:
  //   landed = base / (1 + retPct/100),  ret = landed·retPct/100.
  const otherExp = referral + fba + tacos + oh + sal;   // every expense EXCEPT return loss
  const base = price - otherExp - profit;               // what's left before charging return loss
  const landed = base / (1 + retPct / 100);             // all that's left for goods + freight + duty
  const ret = landed * retPct / 100;
  const totalExp = otherExp + ret;
  const bd = baseDivisor(s);

  // Shipping & duty can each be a % (rides on the product cost, folded into the multiplier) OR a
  // flat $/unit (a fixed subtraction). Solve landed = productUsd × mult + fixed for productUsd.
  const shipMode = $('n_shipMode').value, dutyMode = $('n_dutyMode').value;
  const shipVal = parseFloat($('n_ship').value) || 0, dutyVal = parseFloat($('n_duty').value) || 0;
  const mult = 1 + (shipMode === 'pct' ? shipVal / 100 : 0) + (dutyMode === 'pct' ? (dutyVal / 100) / bd : 0);
  const fixed = (shipMode === 'usd' ? shipVal : 0) + (dutyMode === 'usd' ? dutyVal : 0);
  const productUsd = (landed - fixed) / mult;
  const shipping = shipMode === 'usd' ? shipVal : productUsd * shipVal / 100;
  const duty = dutyMode === 'usd' ? dutyVal : productUsd * (dutyVal / 100) / bd;
  const productInr = productUsd * s.fx;

  $('nMsg').textContent = ''; $('nMsg').className = 'muted';
  $('nResult').classList.remove('hide');
  const viable = productUsd > 0;
  $('nHero').className = 'hero' + (viable ? '' : ' bad');
  $('nHeroInr').textContent = viable ? money(productInr, '₹') : 'Not viable';
  $('nHeroUsd').textContent = viable
    ? `= ${money(productUsd)} landed-ready · max factory quote ${money(productInr / bd, '₹')}`
    : `At ${money(price)} this cannot carry the fees + ${$('n_margin').value}% profit.`;

  $('n_r_sugg').textContent = money(suggestPrice(price));
  $('n_r_ref').textContent = money(referral);
  $('n_r_refpct').textContent = `(${refPct}%)`;
  $('n_r_fba').textContent = money(fba);
  $('n_r_tier').textContent = `(${fbaSrc})`;
  $('n_r_prod').textContent = money(productUsd) + ' · ' + money(productInr, '₹');
  $('n_r_fact').textContent = money(productInr / bd, '₹');

  $('n_r_price').textContent = money(price);
  $('n_r_ref2').textContent = money(referral);
  $('n_r_fba2').textContent = money(fba);
  $('n_r_tacos').textContent = money(tacos);
  $('n_r_ret').textContent = money(ret);
  $('n_r_oh').textContent = money(oh);
  $('n_r_sal').textContent = money(sal);
  $('n_r_exp').textContent = money(totalExp);
  $('n_r_profit').textContent = money(profit);
  $('n_r_mar').textContent = `(${$('n_margin').value}%)`;
  $('n_r_landed').textContent = money(landed);
  $('n_r_ship').textContent = money(shipping);
  $('n_r_duty').textContent = money(duty);
  $('n_r_roi').textContent = landed > 0 ? pct(profit / landed) : '—';
};

