/* ================= PRIORITY =================
 *
 * How soon this SKU needs attention, from its days of cover — and then softened by whatever is
 * already on the way, because a SKU with three weeks left and a container landing next month is not
 * the same emergency as one with three weeks left and nothing behind it.
 *
 *   P1   under 20 days of cover
 *   P2   20 – 40
 *   P3   40 – 60
 *   P4   over 60
 *   Excess  over 120
 *
 * THE TRANSIT RULE: every full 30 days of cover the incoming stock adds moves the priority one step
 * down — 30 days of transit turns a P1 into a P2, 60 days into a P3, and so on. Never past P4, and
 * Excess is left alone (more stock cannot make an overstock more urgent).
 *
 * The 30-day step is the one Ravi gave for P1→P2, applied evenly. He said the fuller mapping is
 * coming, so every number here sits in PRIO_CFG — change it in one place and the column, the
 * filter and the export all follow.
 *
 * WHAT COUNTS AS TRANSIT: `coverDos` ALREADY includes AWD stock and AWD transit, so counting those
 * again would move a SKU down twice for the same units. Only what is not yet in the cover figure is
 * used: this month's FBA receiving plus the future arrivals the backend lists.
 */
const PRIO_CFG = {
  bands: [
    { p: 'P1', upto: 20 },
    { p: 'P2', upto: 40 },
    { p: 'P3', upto: 60 },
    { p: 'P4', upto: 120 },
  ],
  excess: 120,          // more cover than this is overstock, not a priority
  transitStepDays: 30,  // each of these, in transit cover, moves the priority one step down
};
const PRIO_ORDER = ['P1', 'P2', 'P3', 'P4'];

/** Units on the way that the cover figure does NOT already contain. */
function transitUnits(r) {
  const inf = r.inflow || {};
  const fut = (inf.fut || []).reduce((s, f) => s + (Number(f.q) || 0), 0);
  return (Number(inf.m) || 0) + fut;
}

/**
 * { p, base, cover, transitDays, why } — the label plus everything needed to explain it on hover.
 * A priority nobody can question is a priority nobody trusts.
 */
function priorityOf(r) {
  // A typed priority wins outright. Nothing here can know that a SKU is going into a promotion
  // next week, so when somebody says P1 it is P1 — and the tooltip says it was set by hand.
  const ovr = PRIO_OVR[skuKey(r.sku)];
  if (ovr) return { p: ovr, why: `Set by hand to ${ovr}. Clear the box to go back to the worked-out one.` };
  const cover = r.coverDos;
  if (r.stopped) return { p: '—', why: 'Discontinued — never reordered, so no priority.' };
  const avg = Number(r.avgSale) || 0;
  if (!(avg > 0)) return { p: '—', why: 'No run rate, so days of cover cannot be worked out.' };
  if (cover == null) return { p: '—', why: 'No cover figure from the snapshot.' };

  if (cover > PRIO_CFG.excess) {
    return { p: 'Excess', cover, why: `${nf(cover)} days of cover — over ${PRIO_CFG.excess}, so this is overstock.` };
  }
  const band = PRIO_CFG.bands.find(b => cover <= b.upto) || PRIO_CFG.bands[PRIO_CFG.bands.length - 1];
  const base = band.p;

  const units = transitUnits(r);
  const transitDays = units > 0 ? Math.round(units / avg) : 0;
  const steps = Math.floor(transitDays / PRIO_CFG.transitStepDays);
  const idx = Math.min(PRIO_ORDER.indexOf(base) + steps, PRIO_ORDER.length - 1);
  const p = PRIO_ORDER[idx];

  const why = `${nf(cover)} days of cover → ${base}`
    + (units > 0
        ? `. ${nf(units)} units on the way cover about ${nf(transitDays)} more days`
          + (steps ? `, which moves it ${steps} step${steps > 1 ? 's' : ''} down to ${p}.` : ' — under a full step, so the priority stands.')
        : '. Nothing on the way.');
  return { p, base, cover, transitDays, why };
}

const PRIO_STYLE = {
  P1: 'background:#fee2e2;color:#991b1b',
  P2: 'background:#ffedd5;color:#9a3412',
  P3: 'background:#dcfce7;color:#166534',
  P4: 'background:#e2e8f0;color:#334155',
  Excess: 'background:#ede9fe;color:#5b21b6',
};
function prioPillHtml(pr, esc) {
  if (pr.p === '—') return `<span class="muted" title="${esc(pr.why)}">—</span>`;
  return `<span title="${esc(pr.why)}" style="${PRIO_STYLE[pr.p] || ''};font-weight:700;`
    + `padding:2px 8px;border-radius:6px;font-size:11.5px;white-space:nowrap">${pr.p}</span>`;
}

/* ---------- SKUs this tool should pretend do not exist ---------- */
const skuKey = v => String(v == null ? '' : v).trim().toUpperCase();
function isHiddenSku(sku) { return !!HIDDEN[skuKey(sku)]; }

/* ---------- which SKUs are actually ON THE US MARKETPLACE ----------
 *
 * The sheet these rows come from carries Canada and Mexico SKUs beside the US ones, and NOTHING in a
 * row says which marketplace a SKU belongs to — there is no country column, and the ASIN does not
 * tell you either. Reading it off the SKU text ("ends in -CA") was the obvious move and is exactly
 * the move this project has been burned by: `RCNB355-12`'s suffix is a PACK SIZE, not a marketplace.
 * So nothing here is guessed from the name.
 *
 * The answer comes from Amazon. Listing Health in the Price Research app is built from
 * GET_MERCHANT_LISTINGS_ALL_DATA requested for ONE marketplace — the US — and it covers every
 * listing, active and inactive. Both apps share this Firestore, so that snapshot is read straight
 * out of `health/{brand}` + `healthrows/{brand}_{i}` (read-only; this app never writes it).
 *
 * TWO THINGS THIS IS NOT ALLOWED TO DO:
 *
 *   1. Hide anything when the snapshot is missing, empty or unreadable. No snapshot means no
 *      evidence, and hiding a catalogue on no evidence is far worse than showing a few foreign SKUs.
 *
 *   2. Hide a SKU that has US STOCK or US SALES against it. The health snapshot deliberately drops
 *      merchant-fulfilled listings and RB* bundles, so absence from it is NOT proof of absence from
 *      the US — but stock sitting in a US warehouse, or a sale in the US orders, IS proof of
 *      presence. Proof beats absence, every time.
 */
let US_SKUS = new Set();          // SKUs Amazon lists on the US marketplace, per the health snapshot
let US_LOADED = false, US_AT = null, US_ERR = '';
let US_PROMISE = null;
let US_HIDDEN = 0;                // how many rows the last pass held back, for the message line
// Default ON: Ravi's instruction, 2026-08-25 — only US SKUs are to be fetched into this view.
let US_ONLY = localStorage.getItem('repl_us_only') !== '0';

function loadUsSkus() {
  if (US_LOADED) return Promise.resolve();
  if (!US_PROMISE) US_PROMISE = (async () => {
    const found = new Set();
    for (const b of ['SP', 'CPC']) {
      try {
        const meta = await getDoc(doc(db, 'health', b));
        if (!meta.exists()) continue;
        const d = meta.data();
        if (d.at && d.at.toDate) { const t = d.at.toDate(); if (!US_AT || t > US_AT) US_AT = t; }
        const chunks = d.chunks || 0;
        if (chunks) {
          const got = await Promise.all(Array.from({ length: chunks }, (_, i) =>
            getDoc(doc(db, 'healthrows', `${b}_${i}`))));
          // Only the SKU is wanted, so the packed rows are read as they are — `s` is the SKU. No
          // unpacking, no second copy of a shape that belongs to the other app.
          got.forEach(s => { if (s.exists()) (s.data().r || []).forEach(x => { if (x && x.s) found.add(skuKey(x.s)); }); });
        } else {
          (d.rows || []).forEach(x => { if (x && x.s) found.add(skuKey(x.s)); });
        }
      } catch (e) {
        // Named, never swallowed. A silent failure here would hide nothing and look identical to
        // "there are no foreign SKUs" — the toolbar has to be able to say which one it is.
        US_ERR = e.message || String(e);
      }
    }
    US_SKUS = found;
  })().finally(() => { US_LOADED = true; });
  return US_PROMISE;
}

/** Proof that a SKU trades in the US, whatever the listings snapshot happens to contain. */
const usHasProof = r => (Number(r.totalStock) || 0) > 0 || (Number(r.fulfillable) || 0) > 0
  || (Number(r.awdAvail) || 0) > 0 || (Number(r.awdTransit) || 0) > 0
  || (Number(r.inbReceiving) || 0) > 0
  || (Number(r.last90) || 0) > 0 || (Number(r.last30) || 0) > 0;

/** True only when Amazon's US listings say nothing about this SKU AND nothing else vouches for it. */
function isNonUsSku(r) {
  if (!US_ONLY || !US_SKUS.size) return false;      // no evidence → hide nothing. Deliberate.
  if (US_SKUS.has(skuKey(r.sku))) return false;
  return !usHasProof(r);
}

/**
 * The one gate every view goes through: hidden by hand, or not on this marketplace.
 *
 * Kept as ONE function because the three places rows enter a view (the Replenishment grid, Article
 * Review, the revenue-target roll-up) must agree — a SKU filtered out of a table but still inside
 * the totals is the bug this app has already had once.
 */
function skuOutOfScope(r) { return isHiddenSku(r.sku) || isNonUsSku(r); }
function dropOutOfScope(rows) {
  const kept = rows.filter(r => !skuOutOfScope(r));
  US_HIDDEN = rows.filter(r => !isHiddenSku(r.sku) && isNonUsSku(r)).length;
  return kept;
}

/** What the toolbar and the message lines say about it. */
function usNote() {
  if (!US_ONLY) return '<span title="Every marketplace is showing. Switch the picker back to “US marketplace only” to hide the rest.">all marketplaces shown</span>';
  if (US_ERR) return `<span style="color:var(--bad)" title="${esc(US_ERR)}">the US listing snapshot could not be read, so nothing is hidden</span>`;
  if (!US_SKUS.size) return '<span style="color:var(--bad)" title="Open Listing Health in the Price Research app and refresh it once. Until then this app has no way to tell a US SKU from a Canadian one, so it hides nothing.">no US listing snapshot yet — nothing hidden</span>';
  if (!US_HIDDEN) return '';
  return `<span title="Not in Amazon's US listings report, and with no US stock, no inbound and no US sales to vouch for them. Snapshot${US_AT ? ' from ' + US_AT.toISOString().slice(0, 10) : ''}. Switch the picker to “All marketplaces” to see them.">${nf(US_HIDDEN)} non-US SKU(s) hidden</span>`;
}

function renderHideList() {
  const keys = Object.keys(HIDDEN).filter(k => HIDDEN[k]).sort();
  $('hideCount').textContent = keys.length ? `· ${keys.length}` : '· none';
  $('hideList').innerHTML = keys.length
    ? keys.map(k => '<div style="display:flex;justify-content:space-between;align-items:center;'
        + 'padding:3px 0;border-bottom:1px solid var(--line)">'
        + '<span style="font-family:ui-monospace,Consolas,monospace">' + esc(k) + '</span>'
        + '<button class="ghost hideDel" data-sku="' + esc(k) + '" style="padding:1px 9px;font-size:11px">Unhide</button>'
        + '</div>').join('')
    : '<div class="muted" style="padding:8px 0">Nothing hidden.</div>';
  $('hideList').querySelectorAll('.hideDel').forEach(b => {
    b.onclick = () => saveHidden({ [b.dataset.sku]: null });
  });
}

/**
 * Write a patch of the hidden list.
 *
 * Merged rather than replaced, and a null clears one key — so two people tidying the list on the
 * same afternoon cannot wipe each other's work by both saving the whole thing.
 */
async function saveHidden(patch) {
  Object.entries(patch).forEach(([k, v]) => { if (v) HIDDEN[k] = 1; else delete HIDDEN[k]; });
  R_VER++;
  try {
    await setDoc(doc(db, 'repl', 'prodstatus'), { hidden: patch }, { merge: true });
    renderHideList();
    renderRepl();
  } catch (e) {
    $('hideMsg').textContent = 'Could not save: ' + (e.message || e);
  }
}

$('rHide').onclick = () => { $('hidePaste').value = ''; $('hideMsg').textContent = ''; renderHideList(); $('hideModal').classList.remove('hide'); };
$('hideClose').onclick = () => $('hideModal').classList.add('hide');
$('hideAdd').onclick = async () => {
  const raw = $('hidePaste').value.split(/[\n,;\t]+/).map(x => skuKey(x)).filter(Boolean);
  if (!raw.length) { $('hideMsg').textContent = 'Nothing pasted.'; return; }
  const fresh = [...new Set(raw)].filter(k => !HIDDEN[k]);
  const dupes = raw.length - new Set(raw).size;
  if (!fresh.length) { $('hideMsg').textContent = 'All of those are already hidden.'; return; }
  const patch = {};
  fresh.forEach(k => { patch[k] = 1; });
  await saveHidden(patch);
  $('hidePaste').value = '';
  // Says what it did with the whole paste, not just the happy part — a list that silently swallows
  // repeats leaves you wondering whether the rest went in.
  $('hideMsg').textContent = `Hid ${fresh.length}`
    + (dupes ? ` · ${dupes} repeated in the paste` : '')
    + (raw.length - dupes - fresh.length ? ` · ${raw.length - dupes - fresh.length} already hidden` : '');
};
$('hideClear').onclick = async () => {
  const keys = Object.keys(HIDDEN).filter(k => HIDDEN[k]);
  if (!keys.length) return;
  if (!confirm(`Unhide all ${keys.length} SKUs? They come straight back into every count.`)) return;
  const patch = {};
  keys.forEach(k => { patch[k] = null; });
  await saveHidden(patch);
  $('hideMsg').textContent = 'All unhidden.';
};

/**
 * Flag the SKUs that together earn 60% of their brand's revenue.
 *
 * Computed over the WHOLE brand, before a single filter is applied, and stored on the row. The
 * reorder summary used to work this out from whatever was on screen, which meant "top seller"
 * quietly re-defined itself every time somebody typed in the filter box.
 *
 * Being a top seller is a fact about the SKU, not about the current view. One definition, marked
 * once, used by the summary and the switch alike.
 */
function markTopSellers(rows) {
  const byBrand = {};
  rows.forEach(r => { r._top = false; (byBrand[r.brand] = byBrand[r.brand] || []).push(r); });
  Object.values(byBrand).forEach(rs => {
    const ranked = [...rs].sort((x, y) => (y.monthlyAmt || 0) - (x.monthlyAmt || 0));
    const total = ranked.reduce((sum, r) => sum + (r.monthlyAmt || 0), 0);
    if (!(total > 0)) return;
    let cum = 0;
    for (const r of ranked) {
      r._top = true;
      cum += (r.monthlyAmt || 0);
      if (cum >= total * 0.6) break;
    }
  });
}

/* EVERY SKU LANDS IN EXACTLY ONE BUCKET.
 *
 * These bands used to be cumulative — "30 days" meant everything running out within thirty days,
 * empty shelves included. Defensible on paper, useless on screen: the 15-day bucket read 2,771 of
 * which 2,666 were already empty, so the same SKU was counted in five places and no column told you
 * anything the one before it had not.
 *
 * Exclusive instead. A SKU is empty, or it is in one date range, never both. The buckets add up to
 * the total, which means the numbers can be checked by adding them — and a number nobody can check
 * is a number nobody believes.
 */
function coverBucket(r, sold90) {
  if (r._state === 'out') return sold90(r) ? 'outsell' : 'outdead';
  const d = r.coverDos;
  if (d == null) return 'ok';          // no cover figure — not urgent, and not a date range either
  if (d <= 15) return '15';
  if (d <= 30) return '30';
  if (d <= 45) return '45';
  if (d <= 60) return '60';
  return 'ok';
}

