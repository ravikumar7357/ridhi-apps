/* ---------- editable fee tables (New product tab only) ---------- */
function catRow(c) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input class="c-name" value="${c.name}"></td>
    <td><input class="c-pct" type="number" step="0.1" value="${c.pct}"></td>
    <td><button class="xbtn">✕</button></td>`;
  tr.querySelector('button').onclick = () => { tr.remove(); syncCatSelect(); };
  tr.querySelector('.c-name').addEventListener('input', syncCatSelect);
  return tr;
}
function drawCats(cats) { $('catRows').innerHTML = ''; cats.forEach(c => $('catRows').appendChild(catRow(c))); syncCatSelect(); }
function readCats() {
  return [...$('catRows').querySelectorAll('tr')].map(tr => ({
    name: tr.querySelector('.c-name').value.trim(),
    pct: parseFloat(tr.querySelector('.c-pct').value) || 0,
  })).filter(c => c.name);
}
$('addCat').onclick = () => { $('catRows').appendChild(catRow({ name: '', pct: 15 })); syncCatSelect(); };

function tierRow(t) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input class="t-name" value="${t.name}"></td>
    <td><input class="t-maxL" type="number" step="0.1" value="${t.maxL}"></td>
    <td><input class="t-maxW" type="number" step="0.1" value="${t.maxW}"></td>
    <td><input class="t-maxH" type="number" step="0.1" value="${t.maxH}"></td>
    <td><input class="t-maxWt" type="number" step="0.01" value="${t.maxWt}"></td>
    <td><input class="t-fee" type="number" step="0.01" value="${t.fee}"></td>
    <td><button class="xbtn">✕</button></td>`;
  tr.querySelector('button').onclick = () => tr.remove();
  return tr;
}
function drawTiers(tiers) { $('tierRows').innerHTML = ''; tiers.forEach(t => $('tierRows').appendChild(tierRow(t))); }
function readTiers() {
  return [...$('tierRows').querySelectorAll('tr')].map(tr => ({
    name: tr.querySelector('.t-name').value.trim(),
    maxL: parseFloat(tr.querySelector('.t-maxL').value) || 0,
    maxW: parseFloat(tr.querySelector('.t-maxW').value) || 0,
    maxH: parseFloat(tr.querySelector('.t-maxH').value) || 0,
    maxWt: parseFloat(tr.querySelector('.t-maxWt').value) || 0,
    fee: parseFloat(tr.querySelector('.t-fee').value) || 0,
  })).filter(t => t.name);
}
$('addTier').onclick = () => $('tierRows').appendChild(tierRow({ name: '', maxL: 0, maxW: 0, maxH: 0, maxWt: 0, fee: 0 }));

/**
 * Keep the New-product category dropdown in step with the Settings table. When a reference product
 * has been fetched we prepend an "Auto" option carrying Amazon's OWN referral rate for it — derived
 * from the fee Amazon actually quoted, so it needs no category-name matching and can't go stale.
 */
function syncCatSelect() {
  const cur = $('n_cat').value;
  const opts = readCats().map(c => `<option value="${c.pct}">${c.name} — ${c.pct}%</option>`);
  if (NREF && NREF.refPct != null) {
    opts.unshift(`<option value="${NREF.refPct}">🔄 Auto — ${NREF.category || 'reference ASIN'} · ${NREF.refPct.toFixed(1)}%</option>`);
  }
  $('n_cat').innerHTML = opts.join('');
  if (cur && [...$('n_cat').options].some(o => o.value === cur)) $('n_cat').value = cur;
}

/**
 * First tier (top to bottom) the product fits inside. Amazon bills on the LONGEST/MEDIAN/SHORTEST
 * side, not on which one you called length — so sort the three dimensions before comparing.
 */
function fbaTierFor(tiers, wt, dims) {
  const [a, b, c] = dims.slice().sort((x, y) => y - x);
  return tiers.find(t => wt <= t.maxWt && a <= t.maxL && b <= t.maxW && c <= t.maxH) || null;
}
function noteMult() {
  const s = readSettings();
  $('multNote').textContent =
    `Landed = product cost × ${landedMult(s).toFixed(6)}  ·  shipping ${s.ship}% of product cost, duty ${s.duty}% of base cost (≈${(s.duty / baseDivisor(s)).toFixed(2)}% of product cost at P.M ${s.pm}).`;
}
KEYS.forEach(k => $('s_' + k).addEventListener('input', noteMult));

$('saveSettings').onclick = async () => {
  SET = readSettings();
  try {
    await setDoc(doc(db, 'settings', 'default'), SET);
    $('setMsg').textContent = 'Saved ✅';
  } catch (e) { $('setMsg').textContent = 'Save failed: ' + e.message; }
  setTimeout(() => $('setMsg').textContent = '', 2500);
};

