/* ================= RESEARCH · FEE TABLES: the category and size-tier tables, and the Save settings button =================
 * Screens: Settings (the two editable tables, the "Landed = product cost × …" note and the Save settings
 * button) and New Product (its category dropdown is filled from the category table; the tier lookup gives
 * its FBA fee when there is no reference ASIN).
 * Does: draws and reads back the referral-% per category table (catRow, drawCats, readCats) and the FBA
 * size-tier table (tierRow, drawTiers, readTiers), and adds a blank row on + Add; keeps New Product's
 * category dropdown in step with the table (syncCatSelect); finds the first tier a product fits inside
 * (fbaTierFor); shows the landed-cost multiplier under the tables (noteMult); and saves the Settings fields
 * and tables to Firestore settings/default (the saveSettings handler). loadSettings in core/settings.js
 * draws both tables after sign-in.
 * Main functions: catRow, drawCats, readCats, tierRow, drawTiers, readTiers, syncCatSelect, fbaTierFor,
 * noteMult. */

/* ---------- editable fee tables (New product tab only) ---------- */

/* ---- referral % by category ---- */
// One row of the category table: name, referral %, and a ✕ that removes the row. Every edit refreshes
// New Product's category dropdown.
function catRow(cat) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input class="c-name" value="${cat.name}"></td>
    <td><input class="c-pct" type="number" step="0.1" value="${cat.pct}"></td>
    <td><button class="xbtn">✕</button></td>`;
  tr.querySelector('button').onclick = () => {
    tr.remove();
    syncCatSelect();
  };
  tr.querySelector('.c-name').addEventListener('input', syncCatSelect);
  return tr;
}
// Redraw the category table from a list of { name, pct }, then refresh New Product's dropdown.
function drawCats(cats) {
  $('catRows').innerHTML = '';
  cats.forEach(cat => $('catRows').appendChild(catRow(cat)));
  syncCatSelect();
}
// The category table as drawn → [{ name, pct }]; rows without a name are skipped.
function readCats() {
  return [...$('catRows').querySelectorAll('tr')].map(tr => ({
    name: tr.querySelector('.c-name').value.trim(),
    pct: parseFloat(tr.querySelector('.c-pct').value) || 0,
  })).filter(cat => cat.name);
}
// + Add category: a blank row at 15 %.
$('addCat').onclick = () => {
  $('catRows').appendChild(catRow({ name: '', pct: 15 }));
  syncCatSelect();
};

/* ---- FBA fee by size tier ---- */
// One row of the size-tier table: name, max length / width / height (inches), max weight (lb), FBA fee ($),
// and a ✕ that removes the row.
function tierRow(tier) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input class="t-name" value="${tier.name}"></td>
    <td><input class="t-maxL" type="number" step="0.1" value="${tier.maxL}"></td>
    <td><input class="t-maxW" type="number" step="0.1" value="${tier.maxW}"></td>
    <td><input class="t-maxH" type="number" step="0.1" value="${tier.maxH}"></td>
    <td><input class="t-maxWt" type="number" step="0.01" value="${tier.maxWt}"></td>
    <td><input class="t-fee" type="number" step="0.01" value="${tier.fee}"></td>
    <td><button class="xbtn">✕</button></td>`;
  tr.querySelector('button').onclick = () => tr.remove();
  return tr;
}
// Redraw the size-tier table from a list of tiers.
function drawTiers(tiers) {
  $('tierRows').innerHTML = '';
  tiers.forEach(tier => $('tierRows').appendChild(tierRow(tier)));
}
// The size-tier table as drawn → [{ name, maxL, maxW, maxH, maxWt, fee }]; rows without a name are skipped.
function readTiers() {
  return [...$('tierRows').querySelectorAll('tr')].map(tr => ({
    name: tr.querySelector('.t-name').value.trim(),
    maxL: parseFloat(tr.querySelector('.t-maxL').value) || 0,
    maxW: parseFloat(tr.querySelector('.t-maxW').value) || 0,
    maxH: parseFloat(tr.querySelector('.t-maxH').value) || 0,
    maxWt: parseFloat(tr.querySelector('.t-maxWt').value) || 0,
    fee: parseFloat(tr.querySelector('.t-fee').value) || 0,
  })).filter(tier => tier.name);
}
// + Add tier: a blank row, every number 0.
$('addTier').onclick = () =>
  $('tierRows').appendChild(tierRow({ name: '', maxL: 0, maxW: 0, maxH: 0, maxWt: 0, fee: 0 }));

/* ---- what New Product takes from the tables ---- */

/**
 * Keep the New-product category dropdown in step with the Settings table. When a reference product
 * has been fetched we prepend an "Auto" option carrying Amazon's OWN referral rate for it — derived
 * from the fee Amazon actually quoted, so it needs no category-name matching and can't go stale.
 */
function syncCatSelect() {
  const cur = $('n_cat').value;
  const opts = readCats().map(cat => `<option value="${cat.pct}">${cat.name} — ${cat.pct}%</option>`);
  if (NREF && NREF.refPct != null) {
    opts.unshift(`<option value="${NREF.refPct}">🔄 Auto — ${NREF.category || 'reference ASIN'}`
      + ` · ${NREF.refPct.toFixed(1)}%</option>`);
  }
  $('n_cat').innerHTML = opts.join('');
  // keep what was selected when that option still exists
  if (cur && [...$('n_cat').options].some(opt => opt.value === cur)) $('n_cat').value = cur;
}

/**
 * First tier (top to bottom) the product fits inside. Amazon bills on the LONGEST/MEDIAN/SHORTEST
 * side, not on which one you called length — so sort the three dimensions before comparing.
 */
function fbaTierFor(tiers, wt, dims) {
  const [longest, median, shortest] = dims.slice().sort((x, y) => y - x);
  return tiers.find(tier =>
    wt <= tier.maxWt && longest <= tier.maxL && median <= tier.maxW && shortest <= tier.maxH) || null;
}

/* ---- the multiplier note and the Save button (Settings screen) ---- */
// The grey note under the tables: the landed-cost multiplier the Settings fields give right now, and how
// the duty % is re-expressed against the product cost.
function noteMult() {
  const settings = readSettings();
  $('multNote').textContent =
    `Landed = product cost × ${landedMult(settings).toFixed(6)}  ·  shipping ${settings.ship}% of product cost, `
    + `duty ${settings.duty}% of base cost (≈${(settings.duty / baseDivisor(settings)).toFixed(2)}% of product cost `
    + `at P.M ${settings.pm}).`;
}
// Every Settings field refreshes the note as it is typed in.
KEYS.forEach(k => $('s_' + k).addEventListener('input', noteMult));

// Save settings: read the fields and both tables into SET, write them to Firestore settings/default, and show
// "Saved" (or why it failed) for 2.5 seconds.
$('saveSettings').onclick = async () => {
  SET = readSettings();
  try {
    await setDoc(doc(db, 'settings', 'default'), SET);
    $('setMsg').textContent = 'Saved ✅';
  } catch (e) {
    $('setMsg').textContent = 'Save failed: ' + e.message;
  }
  setTimeout(() => $('setMsg').textContent = '', 2500);
};

