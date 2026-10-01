/* ================= PLANNER =================
 * Parents down, weeks across, and a cell you fill in yourself — the shape the plan is already made
 * in on paper. The rows are not typed: parent ASIN, name and BSR all come from the BSR snapshot, so
 * a new parent appears by itself and nobody maintains a list by hand.
 *
 * Weeks run MONDAY→SUNDAY here, unlike the rest of the app, because a deal week is submitted that
 * way and this grid exists to be copied into Amazon.
 */
let D_PLAN = {};             // 'PARENT|2026-01-05' → { t: 'PED', v: 15 }
let D_IMG = {};              // parent ASIN → MAIN photo url, fetched once and shared

/**
 * Shrink an Amazon media URL to a real thumbnail.
 *
 * Amazon serves any size from the same URL through an inline token, so this costs one string edit
 * and cuts the download and the decode by roughly the square of the ratio. The grid draws these at
 * 30px; pulling the 500px original for 300 rows is what made the tab crawl after the first fetch.
 */
function dThumb(u) {
  const s = String(u || '');
  const m = s.match(/^(https?:\/\/[^?#]*\/images\/[A-Za-z]\/[^./]+)(\._[A-Za-z0-9,_-]+_)?(\.(?:jpg|jpeg|png|gif|webp))(\?[^#]*)?$/i);
  return m ? `${m[1]}._SL80_${m[3]}${m[4] || ''}` : s;
}
let D_MODE = 'plan';
let D_PLAN_EDIT = null;
let D_IMG_BUSY = false;

/**
 * Fetch the product photo for every parent that has not got one yet.
 *
 * Amazon's catalog is asked 20 ASINs at a time, and the answers are cached in Firestore, so this is
 * a one-off for the account rather than something each person pays for on each visit. Parents that
 * come back without a photo are asked again through one of their CHILD ASINs — a parent record with
 * no image of its own is common and does not mean the product has no picture.
 */
async function dFetchImages() {
  if (D_IMG_BUSY) return;
  D_IMG_BUSY = true;
  $('dImgs').disabled = true; $('dImgs').textContent = 'Fetching…';
  try {
    // Deliberately ignores the brand and plan filters: "Fetch images" means the whole catalogue, and
    // fetching only what happens to be on screen is how CPC ended up with no pictures at all.
    const seen = new Set(), parents = [];
    ['SP', 'CPC'].forEach(b => {
      (HEALTH[b]?.rows || []).forEach(r => {
        const p = String(r.parent || r.asin || '').trim().toUpperCase();
        if (D_ASIN_RE.test(p) && !seen.has(p)) { seen.add(p); if (!D_IMG[p]) parents.push({ parent: p, brand: b }); }
      });
      const weeks = Object.keys(BSR[b] || {}).sort();
      Object.keys((BSR[b] || {})[weeks[weeks.length - 1]] || {}).forEach(p => {
        const k = String(p).trim().toUpperCase();
        if (D_ASIN_RE.test(k) && !seen.has(k)) { seen.add(k); if (!D_IMG[k]) parents.push({ parent: k, brand: b }); }
      });
    });
    if (!parents.length) { dMsg('Every parent already has a photo.'); }
    const byBrand = { SP: [], CPC: [] };
    parents.forEach(r => (byBrand[r.brand] || byBrand.SP).push(r.parent));
    // Children of each parent, so a parent with no picture of its own can borrow one. Built once —
    // searching the health rows per parent turned this into a scan inside a loop.
    const kidsOf = {};
    ['SP', 'CPC'].forEach(b => (HEALTH[b]?.rows || []).forEach(r => {
      const p = String(r.parent || '').trim().toUpperCase(), a = String(r.asin || '').trim().toUpperCase();
      if (!p || !a || p === a) return;
      (kidsOf[p] || (kidsOf[p] = [])).push(a);
    }));

    let got = 0;
    // ASINs the catalog returned NO ITEM for, under any credentials we tried. Kept apart from
    // "returned an item but it has no photo" — the first is a listing this account cannot see, the
    // second is a listing genuinely without a picture, and only the second is worth acting on.
    const notFound = new Set();
    const fails = [], perBrand = { SP: 0, CPC: 0 };
    for (const brand of ['SP', 'CPC']) {
      const list = byBrand[brand];
      for (let i = 0; i < list.length; i += 20) {
        const chunk = list.slice(i, i + 20);
        try {
          const d = await tCall({ imgs: chunk.join(','), brand });
          Object.entries(d.images || {}).forEach(([a, url]) => { D_IMG[a] = url; got++; perBrand[brand]++; });
          // Children Amazon itself reports, merged in ahead of the ones inferred from the health
          // snapshot: a variation parent that is missing from health has no children there at all,
          // and these are the only ones it will ever get.
          Object.entries(d.kids || {}).forEach(([p, list]) => {
            kidsOf[p] = [...new Set([...(list || []), ...(kidsOf[p] || [])])];
          });
          (d.notFound || []).forEach(a => notFound.add(a));
          (d.noImage || []).forEach(a => notFound.delete(a));
          // A parent record with no image of its own is completely normal — Amazon keeps the photos
          // on the children. Ask the first child of each one that came back empty.
          const missing = chunk.filter(a => !D_IMG[a]);
          const kids = missing.map(p => (kidsOf[p] || [])[0] ? { parent: p, asin: kidsOf[p][0] } : null).filter(Boolean);
          if (kids.length) {
            const d2 = await tCall({ imgs: kids.map(k => k.asin).join(','), brand });
            kids.forEach(k => { const u = (d2.images || {})[k.asin]; if (u) { D_IMG[k.parent] = u; got++; perBrand[brand]++; } });
          }
        } catch (e) {
          // Collected, not printed: the progress line on the next statement used to overwrite this
          // immediately, which is exactly why a brand could fail every chunk in silence.
          fails.push(`${BRAND_NAME[brand]} chunk ${Math.floor(i / 20) + 1}: ${e.message || e}`);
        }
        if (!fails.length) dMsg(`Fetching photos — ${BRAND_NAME[brand]}, ${got} of ${parents.length}…`);
      }
    }
    // LAST PASS — anything still without a photo is asked for again under the OTHER brand's
    // credentials. Amazon only returns a seller's own images under that seller's account, so a
    // parent filed against the wrong brand comes back empty and looks like a product with no
    // picture. Trying the other account is cheap and settles that without anyone having to work out
    // which brand a given ASIN belongs to.
    const stillEmpty = parents.filter(r => !D_IMG[r.parent]);
    if (stillEmpty.length) {
      dMsg(`Retrying ${stillEmpty.length} under the other brand's credentials…`);
      for (const brand of ['SP', 'CPC']) {
        const list = stillEmpty.filter(r => r.brand !== brand && !D_IMG[r.parent]).map(r => r.parent);
        for (let i = 0; i < list.length; i += 20) {
          const chunk = list.slice(i, i + 20);
          try {
            const d = await tCall({ imgs: chunk.join(','), brand });
            Object.entries(d.images || {}).forEach(([a, url]) => { if (!D_IMG[a]) { D_IMG[a] = url; got++; perBrand[brand]++; } });
            Object.entries(d.kids || {}).forEach(([p, list]) => {
              kidsOf[p] = [...new Set([...(list || []), ...(kidsOf[p] || [])])];
            });
            // The SAME child fallback the first pass gets. Without it this pass could only ever find
            // parents that carry their own photo — and most do not, which is why running it twice
            // kept turning up more instead of finishing the job.
            const kids = chunk.filter(a => !D_IMG[a])
              .map(p => (kidsOf[p] || [])[0] ? { parent: p, asin: kidsOf[p][0] } : null).filter(Boolean);
            if (kids.length) {
              const d2 = await tCall({ imgs: kids.map(k => k.asin).join(','), brand });
              kids.forEach(k => { const u = (d2.images || {})[k.asin]; if (u) { D_IMG[k.parent] = u; got++; perBrand[brand]++; } });
            }
          } catch (e) { fails.push(`cross-brand ${BRAND_NAME[brand]}: ${e.message || e}`); }
          dMsg(`Retrying under ${BRAND_NAME[brand]} — ${got} found so far…`);
        }
      }
    }

    // DEEP CHILD PASS — for anything still blank, walk further down the children instead of giving
    // up after the first one. A parent's first child is often a colour that was discontinued, or a
    // variant Amazon never got a photo for; the second or third usually has one. Both brands are
    // tried, because whichever account owns the listing is the only one that returns its images.
    // Starts at 0, not 1: the children Amazon just told us about have never been tried at all, and
    // for the parents that were missing from the health snapshot they are the ONLY children there are.
    const KID_DEPTH = 4;
    for (let depth = 0; depth < KID_DEPTH; depth++) {
      const targets = parents.filter(r => !D_IMG[r.parent] && (kidsOf[r.parent] || [])[depth]);
      if (!targets.length) break;
      dMsg(`Looking one variant deeper for ${targets.length}…`);
      for (const brand of ['SP', 'CPC']) {
        const list = targets.filter(r => !D_IMG[r.parent]);
        for (let i = 0; i < list.length; i += 20) {
          const slice = list.slice(i, i + 20);
          try {
            const d = await tCall({ imgs: slice.map(r => kidsOf[r.parent][depth]).join(','), brand });
            slice.forEach(r => {
              const u = (d.images || {})[kidsOf[r.parent][depth]];
              if (u && !D_IMG[r.parent]) { D_IMG[r.parent] = u; got++; perBrand[brand]++; }
            });
          } catch (e) { fails.push(`variant ${depth + 1} ${BRAND_NAME[brand]}: ${e.message || e}`); }
        }
      }
    }

    await saveDeals(false);
    renderPlanner();                       // once, at the end — not after every chunk
    const summary = `Photos — Ridhi ${perBrand.SP}, CPC ${perBrand.CPC} fetched · ${Object.keys(D_IMG).length} stored in total.`;
    // A brand that asked for photos and got none back is reported plainly. Silence there is what
    // made this look like it had worked when half of it had not.
    const leftRows = parents.filter(r => !D_IMG[r.parent]);
    const left = leftRows.length;
    // Split the leftovers by WHY, so the number means something. "No children to try" is a data
    // shape we cannot do anything about; "children tried and none had a photo" usually means the
    // listings really are without images, which is worth knowing on its own.
    const gone = leftRows.filter(r => notFound.has(r.parent)).length;
    const noKids = leftRows.filter(r => !notFound.has(r.parent) && !(kidsOf[r.parent] || []).length).length;
    const note = left
      ? [`${left} still without a photo — ${gone} not in the catalogue at all under either account (dead or another seller's listing), `
        + `${noKids} found but with no photo and no variants, ${left - gone - noKids} whose variants had none either`]
      : [];
    // The credentials message is worth saying once in plain words rather than three times as a raw
    // API error — it is a setup problem, not something retrying will ever fix.
    const credGap = fails.some(f => /credentials missing/i.test(f))
      ? ['CPC has no SP-API credentials in Script Properties, so its own account cannot be asked at all — those photos came from Ridhi\'s credentials instead']
      : [];
    dMsg([summary, ...note, ...credGap, ...fails.filter(f => !/credentials missing/i.test(f)).slice(0, 2)].join(' · '),
      (left || fails.length) > 0);
  } catch (e) {
    dMsg('Could not fetch photos: ' + (e.message || e), true);
  }
  D_IMG_BUSY = false;
  $('dImgs').disabled = false; $('dImgs').textContent = 'Fetch images';
}
$('dImgs').onclick = dFetchImages;

/**
 * The Sunday starting the week containing `ms`.
 *
 * This planner used to run Monday→Sunday while every other week in the app runs Sunday→Saturday, so
 * the same calendar week was labelled 03-Aug here and 02-Aug everywhere else. One product, two
 * weeks, depending on which tab you were looking at.
 */
const dSunday = ms => {
  const d = new Date(ms);
  const u = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(u - new Date(u).getUTCDay() * 86400000).toISOString().slice(0, 10);
};
function dPlanWeeks() {
  const n = Number($('dWeeks').value) || 26;
  const first = new Date(dSunday(Date.now()) + 'T00:00:00Z').getTime();
  const out = [];
  for (let i = 0; i < n; i++) out.push(new Date(first + i * 7 * 86400000).toISOString().slice(0, 10));
  return out;
}
const dShortDate = k => {
  const d = new Date(k + 'T00:00:00Z');
  return String(d.getUTCDate()).padStart(2, '0') + '-' + W_MON[d.getUTCMonth()];
};

/**
 * Every parent, from the LISTING HEALTH snapshot first and the BSR snapshot second.
 *
 * Health is the catalogue — every listing either brand has — so the planner covers both brands even
 * if nobody has taken a BSR snapshot for one of them. Building this list from BSR alone was why CPC
 * came up empty: no snapshot, no rows, and the brand filter then looked broken when it was simply
 * filtering an empty set.
 *
 * BSR still supplies the RANK where a snapshot exists; a missing rank is shown as "—" rather than
 * letting the row disappear.
 */
// A parent has to be a real ASIN. The health snapshot carries literal "N/A" for listings with no
// parent, and letting that through put a row called N/A in the grid AND poisoned the catalog call —
// Amazon rejects a whole batch of 20 if one identifier is malformed, so a single N/A cost every
// photo in its chunk.
const D_ASIN_RE = /^[A-Z0-9]{10}$/;

function dPlanParents() {
  const brand = $('dBrand').value, q = $('dFilter').value.trim().toLowerCase();
  const brands = brand === 'ALL' ? myBrands() : [brand].filter(b => myBrands().includes(b));
  const byKey = new Map();

  brands.forEach(b => {
    (HEALTH[b]?.rows || []).forEach(r => {
      const p = String(r.parent || r.asin || '').trim().toUpperCase();
      if (!D_ASIN_RE.test(p)) return;
      if (!byKey.has(p)) byKey.set(p, { parent: p, brand: b, name: '', rank: 0, kids: 0 });
      byKey.get(p).kids++;
    });
    const weeks = Object.keys(BSR[b] || {}).sort();
    const snap = (BSR[b] || {})[weeks[weeks.length - 1]] || {};
    Object.entries(snap).forEach(([p, v]) => {
      const k = String(p).trim().toUpperCase();
      if (!D_ASIN_RE.test(k)) return;
      if (!byKey.has(k)) byKey.set(k, { parent: k, brand: b, name: '', rank: 0, kids: 0 });
      const o = byKey.get(k);
      o.rank = v?.rank || o.rank;
      o.cat = v?.cat || o.cat;
    });
  });

  let rows = [...byKey.values()];
  rows.forEach(r => { r.name = parentName(r.brand, r.parent, '') || ''; });
  if (q) rows = rows.filter(r => (r.parent + ' ' + r.name).toLowerCase().includes(q));

  const pf = $('dPlanFilter').value;
  if (pf === 'has') rows = rows.filter(r => dPlanTypes(r.parent).size > 0);
  else if (pf === 'none') rows = rows.filter(r => dPlanTypes(r.parent).size === 0);
  else if (pf) rows = rows.filter(r => dPlanTypes(r.parent).has(pf));

  // Best-selling first. Rank 0 means "not ranked", which belongs at the bottom, not the top —
  // sorting it as zero would put every unranked parent above the best seller in the catalogue.
  rows.sort((a, b) => ((a.rank || 1e9) - (b.rank || 1e9)) || String(a.name).localeCompare(String(b.name)));
  return rows;
}

/** The plan types set on a parent anywhere in the visible horizon. */
function dPlanTypes(parent) {
  const out = new Set();
  dPlanWeeks().forEach(w => { const p = D_PLAN[parent + '|' + w]; if (p && p.t) out.add(p.t); });
  return out;
}

const D_PLAN_COLOUR = { PED: '#dbeafe|#1e40af', COUPON: '#dcfce7|#166534', DEAL: '#fef9c3|#854d0e',
  'BEST DEAL': '#fde68a|#92400e', LIGHTNING: '#ffedd5|#9a3412', 'PRICE DISC': '#ede9fe|#5b21b6' };

function renderPlannerKpis(rows, weeks) {
  const nf = v => Math.round(v || 0).toLocaleString('en-US');
  // Counted over EVERY parent, not the filtered view — otherwise filtering to "PED only" would
  // report that every parent has a PED, which is true of the filter and false of the business.
  const all = (() => {
    const m = new Map();
    myBrands().forEach(b => {
      (HEALTH[b]?.rows || []).forEach(r => {
        const p = String(r.parent || r.asin || '').trim().toUpperCase();
        if (p && !m.has(p)) m.set(p, b);
      });
      Object.keys((BSR[b] || {})[Object.keys(BSR[b] || {}).sort().slice(-1)[0]] || {})
        .forEach(p => { const k = String(p).toUpperCase(); if (!m.has(k)) m.set(k, b); });
    });
    return m;
  })();
  const nSP = [...all.values()].filter(b => b === 'SP').length;
  const nCPC = [...all.values()].filter(b => b === 'CPC').length;

  const wset = new Set(weeks);
  const byType = {}; const parentsWith = new Set();
  Object.entries(D_PLAN).forEach(([k, v]) => {
    if (!v || !v.t) return;
    const [p, w] = k.split('|');
    if (!wset.has(w)) return;                 // only what falls inside the horizon on screen
    byType[v.t] = (byType[v.t] || new Set()).add(p);
    parentsWith.add(p);
  });
  const tile = (label, val, colour) => `<div class="metric"><div class="v"${colour ? ` style="color:${colour}"` : ''}>${val}</div><div class="l">${label}</div></div>`;

  $('dKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Deal planner — next ${weeks.length} weeks</span>
      <span class="kpiwhen">${nf(rows.length)} shown of ${nf(all.size)} parents</span></div>
    <div class="metrics">
      ${tile('Ridhi parents', nf(nSP))}
      ${tile('CPC parents', nf(nCPC))}
      ${tile('Parents with a plan', nf(parentsWith.size), parentsWith.size ? '#166534' : '')}
      ${tile('PED', nf((byType.PED || new Set()).size), '#1e40af')}
      ${tile('COUPON', nf((byType.COUPON || new Set()).size), '#166534')}
      ${tile('DEAL', nf(((byType.DEAL || new Set()).size) + ((byType['BEST DEAL'] || new Set()).size) + ((byType.LIGHTNING || new Set()).size)), '#92400e')}
      ${tile('Price disc.', nf((byType['PRICE DISC'] || new Set()).size), '#5b21b6')}
      ${tile('Nothing planned', nf(all.size - parentsWith.size), all.size - parentsWith.size ? 'var(--bad)' : '')}
    </div></div>`;
}

function renderPlanner() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const weeks = dPlanWeeks();
  const rows = dPlanParents();
  renderPlannerKpis(rows, weeks);
  if (!rows.length) {
    $('dPlanTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">No parents yet — take a snapshot on the BSR Audit tab first. The rows here come from it, so nothing has to be typed.</td></tr></tbody>';
    return;
  }

  // Two header rows, exactly like the sheet this replaces: the week's start over its end.
  const head = '<thead>'
    + '<tr class="phead1"><th class="frz pfz" data-pf="0" rowspan="2">Parent ASIN</th>'
    + '<th class="pfz pfz-last" data-pf="1" rowspan="2">Product</th>'
    + '<th rowspan="2">Image</th>'
    + '<th class="num" rowspan="2">BSR</th>'
    + '<th class="num" style="background:#e2e8f0">Start</th>'
    + weeks.map(w => `<th class="num" style="background:#fde4d3">${esc(dShortDate(w))}</th>`).join('') + '</tr>'
    + '<tr class="phead2"><th class="num" style="background:#fef08a">End</th>'
    + weeks.map(w => `<th class="num" style="background:#fde4d3">${esc(dShortDate(new Date(new Date(w + 'T00:00:00Z').getTime() + 6 * 86400000).toISOString().slice(0, 10)))}</th>`).join('')
    + '</tr></thead>';

  const body = rows.slice(0, 300).map(r => {
    // A deal is stored against the week it STARTS in, but a ten-day run does not stop at Saturday.
    // Work out, per week column, whether a deal starts there or is still running from an earlier
    // one, so the calendar shows the deal for as long as it is actually live.
    const runsInto = {};
    weeks.forEach(w => {
      const p = D_PLAN[r.parent + '|' + w];
      if (!p || !p.t) return;
      const span = dPlanSpan(w, p);
      weeks.forEach(w2 => {
        // The columns are whole weeks; a week is touched if the run overlaps any day of it.
        if (w2 > w && w2 <= span.end && sdShift(w2, 6) >= span.start) runsInto[w2] = { p, span, from: w };
      });
    });

    const cells = weeks.map(w => {
      const p = D_PLAN[r.parent + '|' + w];
      const cont = !p || !p.t ? runsInto[w] : null;
      if (!p || !p.t) {
        if (!cont) return `<td class="num dplan" data-dp="${esc(r.parent)}|${esc(w)}" style="cursor:pointer"></td>`;
        // A continuation cell is the SAME colour but hollow, and clicking it opens the week it
        // started in — editing the tail of a deal separately from its head is how you end up with
        // two plans that disagree.
        const [cbg, cfg] = (D_PLAN_COLOUR[cont.p.t] || '#f1f5f9|#334155').split('|');
        return `<td class="num dplan" data-dp="${esc(r.parent)}|${esc(cont.from)}"`
          + ` title="${esc(cont.p.t + ' running ' + cont.span.start + ' → ' + cont.span.end)}"`
          + ` style="cursor:pointer;background:${cbg};color:${cfg};opacity:.55;font-weight:700;font-size:11.5px">`
          + `→ ${esc(cont.p.t)}</td>`;
      }
      const [bg, fg] = (D_PLAN_COLOUR[p.t] || '#f1f5f9|#334155').split('|');
      const span = dPlanSpan(w, p);
      const odd = span.days !== 7 || span.start !== w;
      // The owner is printed under the plan, not hidden in a tooltip — the whole point of recording
      // who runs it is that you can see an unassigned week without opening anything.
      return `<td class="num dplan" data-dp="${esc(r.parent)}|${esc(w)}"`
        + ` title="${esc(span.start + ' → ' + span.end + ' · ' + span.days + ' days · '
            + (p.by ? 'run by ' + p.by : 'nobody assigned'))}"`
        + ` style="cursor:pointer;background:${bg};color:${fg};font-weight:700;font-size:11.5px;line-height:1.2">`
        + `${esc(p.t)}${p.v ? ' ' + p.v + '%' : ''}`
        // Only said when it is not the plain Sunday-to-Saturday week, so the grid stays quiet for
        // the ordinary case and the unusual one is impossible to miss.
        + (odd ? `<div style="font-weight:600;font-size:9.5px;opacity:.8">${esc(dShortDate(span.start))} · ${span.days}d</div>` : '')
        + (p.by ? `<div style="font-weight:600;font-size:9.5px;opacity:.75">${esc(String(p.by).slice(0, 12))}</div>` : '')
        + '</td>';
    }).join('');
    const img = D_IMG[r.parent];
    return `<tr><td class="frz pfz" data-pf="0" style="font-family:ui-monospace,monospace">${esc(r.parent)}</td>`
      + `<td class="pfz pfz-last" data-pf="1" title="${esc(r.name)}">${esc(String(r.name).slice(0, 32)) || '<span class="muted">—</span>'}</td>`
      + `<td style="padding:2px 6px">${img
          ? `<img src="${esc(dThumb(img))}" loading="lazy" decoding="async" style="width:30px;height:30px;object-fit:cover;border-radius:5px;background:#f1f5f9" alt="">`
          : '<span class="muted" style="font-size:11px">—</span>'}</td>`
      + `<td class="num">${r.rank ? r.rank.toLocaleString('en-US') : '<span class="muted">—</span>'}</td>`
      + `<td class="num muted"></td>${cells}</tr>`;
  }).join('');

  $('dPlanTable').innerHTML = head + '<tbody>' + body + '</tbody>';
  dPinLeft();
  dMsg(`${rows.length} parent(s) · ${weeks.length} weeks · click any cell to plan. Rows and names come from the BSR snapshot.`);
}

/**
 * Give every frozen column its `left`, measured from the first body row.
 *
 * The columns size themselves to their content — a long product name or a missing photo changes the
 * widths — so the offsets cannot be written into the CSS. Measured inside rAF because reading a
 * width right after setting innerHTML forces the browser to lay out the whole grid there and then.
 */
function dPinLeft() {
  requestAnimationFrame(() => {
    const tbl = $('dPlanTable');
    const first = tbl.querySelector('tbody tr');
    if (!first) return;
    // Frozen columns: parent ASIN and product only. Their widths follow their content, so the
    // offsets are measured rather than written into the CSS.
    const lefts = []; let x = 0;
    for (let i = 0; i < 2; i++) {
      const td = first.querySelector(`[data-pf="${i}"]`);
      lefts.push(x);
      x += td ? td.getBoundingClientRect().width : 0;
    }
    tbl.querySelectorAll('[data-pf]').forEach(el => { el.style.left = lefts[Number(el.dataset.pf)] + 'px'; });
    // The SECOND header row has to be pushed down by the height of the first, or the two pin on top
    // of each other and the End dates vanish under the Start dates.
    const h1 = tbl.querySelector('thead tr.phead1 th:last-child');
    const top = h1 ? Math.round(h1.getBoundingClientRect().height) : 0;
    tbl.querySelectorAll('thead tr.phead2 th').forEach(th => { th.style.top = top + 'px'; });
    // The two rowspan=2 headers span both rows, so they stay at the very top.
    tbl.querySelectorAll('thead tr.phead1 th').forEach(th => { th.style.top = '0px'; });
  });
}

/**
 * The days a planned deal actually covers.
 *
 * An entry written before deals had a length has neither `s` nor `d`, and means what it always
 * meant: the whole of its own week. Reading the default here rather than migrating the stored
 * documents keeps every old plan exactly as it was.
 */
function dPlanSpan(week, p) {
  const start = (p && p.s) || week;
  const days = Math.max(1, Number(p && p.d) || 7);
  return { start, days, end: sdShift(start, days - 1) };
}

function dPlanOpen(key) {
  D_PLAN_EDIT = key;
  const [parent, week] = key.split('|');
  const cur = D_PLAN[key] || {};
  const end = new Date(new Date(week + 'T00:00:00Z').getTime() + 6 * 86400000).toISOString().slice(0, 10);
  $('dpTitle').textContent = parent;
  $('dpWhen').textContent = `${week} → ${end}`;
  $('dpType').value = cur.t || '';
  $('dpVal').value = cur.v || '';
  $('dpBy').value = cur.by || '';
  $('dpRepeat').value = '1';
  const span = dPlanSpan(week, cur);
  $('dpStart').value = span.start;
  $('dpDays').value = span.days;
  // The week the cell belongs to is the earliest a deal in it can start, and the picker says so
  // rather than silently accepting a date that would file the deal under a different week.
  $('dpStart').min = week;
  $('dpStart').max = sdShift(week, 6);
  dPlanSpanNote();
  // Names already used become suggestions, so the same person is not spelt three ways.
  const names = [...new Set(Object.values(D_PLAN).map(p => p && p.by).filter(Boolean))].sort();
  $('dpByList').innerHTML = names.map(n => `<option value="${String(n).replace(/"/g, '&quot;')}">`).join('');
  $('dpModal').classList.remove('hide');
  $('dpType').focus();
}
/** Say in words what the dates on screen add up to, so a 10-day run is not a surprise later. */
function dPlanSpanNote() {
  const days = Math.max(1, Number($('dpDays').value) || 7);
  const start = $('dpStart').value;
  if (!start) { $('dpSpan').textContent = ''; return; }
  const end = sdShift(start, days - 1);
  const weeks = wKeyOfDate(start) === wKeyOfDate(end) ? 1 : 2;
  $('dpSpan').textContent = `${start} → ${end}`
    + (weeks > 1 ? ' · runs into the following week, and shows in both columns' : '')
    + (days !== 7 ? ' · repeat is ignored for a run that is not a whole week' : '');
}
['dpStart', 'dpDays'].forEach(id => $(id).addEventListener('input', dPlanSpanNote));

async function dPlanSave(clear) {
  if (!D_PLAN_EDIT) return;
  const [parent, week] = D_PLAN_EDIT.split('|');
  const t = clear ? '' : $('dpType').value;
  const v = clear ? 0 : (Number($('dpVal').value) || 0);
  const by = clear ? '' : $('dpBy').value.trim();
  const days = clear ? 7 : Math.max(1, Number($('dpDays').value) || 7);
  // Clamped into its own week: the entry is keyed by that week, so a start outside it would file the
  // deal somewhere the cell you clicked cannot show.
  let start = clear ? week : ($('dpStart').value || week);
  if (start < week) start = week;
  if (start > sdShift(week, 6)) start = sdShift(week, 6);
  // Repeat steps a week at a time, so it only makes sense for a seven-day run. A 10-day deal
  // repeated weekly would overlap itself, which is never what anybody meant.
  const n = (clear || days !== 7) ? 1 : (Number($('dpRepeat').value) || 1);
  const base = new Date(week + 'T00:00:00Z').getTime();
  for (let i = 0; i < n; i++) {
    const wk = new Date(base + i * 7 * 86400000).toISOString().slice(0, 10);
    const key = parent + '|' + wk;
    if (!t) { delete D_PLAN[key]; continue; }
    const e = { t, v };
    if (by) e.by = by;
    // Only written when they say something the default does not, so ordinary weekly plans stay the
    // small documents they have always been.
    const s = i === 0 ? start : sdShift(start, i * 7);
    if (s !== wk) e.s = s;
    if (days !== 7) e.d = days;
    D_PLAN[key] = e;
  }
  $('dpModal').classList.add('hide'); D_PLAN_EDIT = null;
  // Whichever view is open, not always the planner — a deal edited from Completed must redraw there.
  renderDealsAny();
  try { await saveDeals(false); dMsg('Saved.'); }
  catch (e) { dMsg('Could not save: ' + (e.message || e), true); }
}
$('dpSave').onclick = () => dPlanSave(false);
$('dpClear').onclick = () => dPlanSave(true);
$('dpCancel').onclick = () => { $('dpModal').classList.add('hide'); D_PLAN_EDIT = null; };
$('dPlanTable').addEventListener('click', e => {
  const td = e.target.closest('[data-dp]'); if (!td) return;
  dPlanOpen(td.dataset.dp);
});
$('dWeeks').addEventListener('change', renderPlanner);

/* ---------- event windows ---------- */
function renderEvents() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  // Every named schedule Amazon gave no dates for, plus anything already filled in.
  const named = new Set(Object.keys(D_EVENTS));
  DEALS.recs.forEach(r => {
    const s = String(r.schedule || '').trim();
    if (s && !D_DATE_RE.test(s)) named.add(s);
  });
  const list = [...named].sort();
  const head = '<thead><tr><th>Event</th><th>Starts</th><th>Ends</th><th>From the recommendations</th><th></th></tr></thead>';
  const body = list.map(n => {
    const ev = D_EVENTS[n] || {};
    const count = DEALS.recs.filter(r => String(r.schedule || '').trim() === n).length;
    return `<tr><td style="font-weight:600">${esc(n)}</td>`
      + `<td>${ev.start ? esc(ev.start) : '<span class="fu fu-amber">not set</span>'}</td>`
      + `<td>${ev.end ? esc(ev.end) : '<span class="fu fu-amber">not set</span>'}</td>`
      + `<td class="num">${count ? count.toLocaleString('en-US') + ' rows' : '<span class="muted">—</span>'}</td>`
      + `<td><button class="ghost" data-dev="${esc(n)}" style="padding:3px 10px;font-size:12px">Edit</button></td></tr>`;
  }).join('');
  $('dEventsTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="5" class="muted" style="padding:12px">Nothing to date yet — import the recommendations, or add an event below.</td></tr>')
    + '</tbody>';
}
$('dEventsTable').addEventListener('click', e => {
  const b = e.target.closest('[data-dev]'); if (!b) return;
  const n = b.dataset.dev, ev = D_EVENTS[n] || {};
  $('devName').value = n; $('devStart').value = ev.start || ''; $('devEnd').value = ev.end || '';
  $('devName').focus();
});
$('devSave').onclick = async () => {
  const n = $('devName').value.trim(), s = $('devStart').value, e2 = $('devEnd').value;
  if (!n) { $('devMsg').textContent = 'A name is needed.'; return; }
  if (!s || !e2) { $('devMsg').textContent = 'Both dates are needed — that is the whole point of this table.'; return; }
  if (e2 < s) { $('devMsg').textContent = 'The end date is before the start date.'; return; }
  D_EVENTS[n] = { start: s, end: e2 };
  renderEvents();
  try { await saveDeals(false); $('devMsg').textContent = `Saved — ${n} is now ${s} → ${e2}.`; }
  catch (err) { $('devMsg').textContent = 'Could not save: ' + (err.message || err); }
};

