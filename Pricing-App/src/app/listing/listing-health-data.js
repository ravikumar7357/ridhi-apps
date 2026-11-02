/* ================= LISTING · LISTING HEALTH DATA: the Listing Health screen itself — loading, refreshing and drawing it =================
 * Screens: Listing Health (tab 'health'). The rules, limits and page state it reads are in listing-health.js; the scoring
 *          (healthOf) in listing-rules.js; the children dialog, KPI cards, Raw fields and CSV buttons in parent-check.js.
 * Does: keeps the per-brand snapshot (HEALTH) in Firestore chunk docs (loadHealthCache / saveHealthCache); "Refresh both
 *       brands" (the hGo handler) pulls FBA stock and the listings report through pollReport, joins them, then sweeps the
 *       catalogue for content, parent names and A+ in priority order; renderHealth draws the table in child or parent view,
 *       with sorting, filters, the issue picker and the one-parent focus bar (hFocusOpen / hFocusBar).
 * Main functions: unpackRow / packRow, loadHealthCache, saveHealthCache, ensureHealth, pollReport, the hGo handler,
 *                 hFocusOpen, hFocusBar, renderHealth. */
/* ----- Firestore cache ----- */
// Rows are stored in CHUNK DOCS, not in one document. A single doc had to be capped at 1,500 rows to
// stay under Firestore's 1 MB limit, which silently dropped 549 of Ridhi's 2,049 listings — so the
// tab showed the full set right after a refresh and a truncated one after every reload. That is what
// looked like "the data resets". `health/{brand}` now holds only metadata plus a chunk count.
const H_CHUNK = 900;    // rows per chunk doc
// A stored row (short keys) → the row the screen works with.
const unpackRow = packed => ({
  sku: packed.s, asin: packed.i, parent: packed.p, title: packed.n,
  price: packed.pr === null ? null : (packed.pr || 0),
  qty: packed.q === null ? null : (packed.q || 0),           // null must survive the round trip: it means
  status: packed.st || '', channel: packed.ch || '',          // "unknown", and 0 means a real stockout
  opened: packed.od || '', tried: !!packed.t, titleFull: packed.nf === 1,
  aplus: packed.ap === 1 ? true : (packed.ap === 0 ? false : undefined),   // undefined = never checked, and
  content: packed.c ? { titleLen: packed.c[0], images: packed.c[1], bullets: packed.c[2], descLen: packed.c[3], title: packed.c[4] || '' } : null,
  checked: packed.ca || 0,                                                 // when the content was last read (ms); 0 = before this was kept
  aplusAt: packed.apa || 0,                                                // when A+ was last asked (ms)
});                                                                        // that is NOT the same as "missing"
// The reverse: a screen row → the short-keyed record that is stored.
const packRow = row => ({
  s: row.sku, i: row.asin || '', p: row.parent || '', n: (row.title || '').slice(0, 200), nf: 1,
  pr: row.price == null ? null : row.price, q: row.qty == null ? null : row.qty,
  st: row.status || '', ch: row.channel || '', od: row.opened || '', t: row.tried ? 1 : 0,
  ap: row.aplus === true ? 1 : (row.aplus === false ? 0 : null),
  c: row.content ? [row.content.titleLen || 0, row.content.images || 0, row.content.bullets || 0, row.content.descLen || 0,
    String(row.content.title || '').slice(0, 200)] : null,
  ca: row.checked || 0,
  apa: row.aplusAt || 0,
});

// Read both brands' snapshots from Firestore into HEALTH: the metadata doc, then its chunk docs.
async function loadHealthCache() {
  for (const brand of ['SP', 'CPC']) {
    try {
      const snap = await getDoc(doc(db, 'health', brand));
      if (!snap.exists()) continue;
      const data = snap.data();
      const chunks = data.chunks || 0;
      let rows = [];
      if (chunks) {
        const got = await Promise.all(Array.from({ length: chunks }, (_, i) =>
          getDoc(doc(db, 'healthrows', `${brand}_${i}`))));
        got.forEach(chunk => {
          if (chunk.exists()) rows = rows.concat((chunk.data().r || []).map(unpackRow));
        });
      } else {
        rows = (data.rows || []).map(unpackRow);     // documents written by the old single-doc version
      }
      HEALTH[brand] = {
        at: data.at && data.at.toDate ? data.at.toDate() : null,
        contentAt: data.contentAt && data.contentAt.toDate ? data.contentAt.toDate() : null,
        scope: data.scope || null, parentNames: data.parentNames || {}, rows,
      };
    } catch (e) {
      // Do NOT swallow this. A failed load is exactly what "my data disappeared" looks like, and it
      // used to happen in silence.
      hMsg(`Could not load the saved ${BRAND_NAME[brand]} snapshot: ${e.message || e}`, true);
    }
  }
  H_LOADED = true;
}

// Write one brand's snapshot: the rows in chunk docs of H_CHUNK, then the metadata doc.
async function saveHealthCache(brand) {
  const health = HEALTH[brand];
  if (!health) return;
  const chunks = Math.ceil(health.rows.length / H_CHUNK) || 1;
  for (let i = 0; i < chunks; i++) {
    await setDoc(doc(db, 'healthrows', `${brand}_${i}`),
      { r: health.rows.slice(i * H_CHUNK, (i + 1) * H_CHUNK).map(packRow) });
  }
  await setDoc(doc(db, 'health', brand), {
    chunks, n: health.rows.length,
    rows: null,                                      // clear the old single-doc payload if present
    scope: health.scope || null,
    parentNames: health.parentNames || null,         // ~800 entries; kept so they aren't re-fetched

    at: serverTimestamp(),
    contentAt: health.contentAt ? serverTimestamp() : null,
  });
}
// First visit to the tab: parent names, the rules, the catalogue and Amazon's status (both in the background), the snapshot, then draw.
async function ensureHealth() {
  await loadParentNames();
  if (!LR) await lrLoad();
  /* The catalogue is slow to read the first time; the table draws without it and again once it lands. */
  if (!LR_CAT.SP || !LR_CAT.CPC) lrLoadCatalog().then(() => {
    H_CTX = null;
    if (!$('paneHealth').classList.contains('hide')) renderHealth();
  });
  /* Amazon's own status and errors, from the Image Manager snapshot. Loaded beside the catalog so the
   * two Amazon rules can run; until it arrives they find nothing rather than guessing. */
  if (!AMZ.map) amzEnsure().then(() => {
    if (!$('paneHealth').classList.contains('hide')) renderHealth();
  });
  if (H_LOADED) return renderHealth();
  hMsg('Loading the last snapshot…');
  await loadHealthCache();
  hMsg('');
  renderHealth();
}

/* ----- Refresh (both brands) ----- */
/**
 * Create an Amazon report and poll it to completion. Both reports this tab needs (the FBA ageing
 * snapshot and the merchant listings report) follow the identical async shape, so they share this.
 * Throws on failure — the caller decides whether that's fatal or falls back.
 */
async function pollReport(createParams, pollParams, onTick) {
  const created = await baCall(createParams);
  if (!created.reportId) throw new Error(created.error || 'could not create report');
  for (let i = 0; i < 32; i++) {                                   // ~8 min ceiling
    await new Promise(resolve => setTimeout(resolve, i === 0 ? 8000 : 15000));
    const polled = await baCall({ ...pollParams, id: created.reportId });
    if (polled.status === 'done') return polled;
    if (onTick) onTick(`(${Math.round((i * 15 + 8) / 6) / 10} min)`);
  }
  throw new Error('report took too long');
}

// Refresh both brands: phase 1 stock + listings report per brand, phase 2 the content sweep, 2b parent names, 3 A+.
$('hGo').onclick = async () => {
  const btn = $('hGo');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>…';
  const failed = [];
  const notes = [];

  // Phase 1 — per brand: the FBA stock map, then the listings report, then filter and join.
  for (const brand of ['SP', 'CPC']) {
    try {
      // (a) REAL stock. The merchant listings report's `quantity` is the merchant-fulfilled figure
      //     and is blank on every FBA listing, so stock comes from the FBA ageing report instead —
      //     the very same report the Inventory age tab runs, so no new backend endpoint is needed.
      //     Stock lives in its OWN doc, not the Inventory-age snapshot. That snapshot carries a full
      //     row per SKU (name, every age bucket, storage cost) so it has to be capped at 1,500 rows
      //     to fit Firestore's 1 MB limit — and reading stock from it left 1,338 of 3,225 listings
      //     unmatched. `stock/{brand}` stores nothing but sku → quantity, so the whole catalogue fits
      //     in a fraction of the space. Under 24h old it is reused; otherwise the report is pulled.
      let stock = null;
      let stockSrc = '';
      const readStockDoc = async () => {
        const snap = await getDoc(doc(db, 'stock', brand));
        if (!snap.exists()) return null;
        const data = snap.data();
        const at = data.at && data.at.toDate ? data.at.toDate() : null;
        return { map: data.m || {}, at, ageHrs: at ? (Date.now() - at.getTime()) / 36e5 : Infinity };
      };
      const pullStock = async () => {
        hMsg(`${BRAND_NAME[brand]}: reading FBA stock…`);
        const report = await pollReport({ age: 'create', brand }, { age: 'poll', brand },
          progress => hMsg(`${BRAND_NAME[brand]}: FBA stock report building… ${progress}`));
        const map = {};
        (report.rows || []).forEach(row => {
          if (row.sku) map[row.sku] = row.available || 0;
        });
        await saveStockDoc(brand, map);
        return map;
      };
      try {
        const cached = await readStockDoc();
        if (cached && cached.ageHrs < 24) {
          stock = cached.map;
          stockSrc = 'cache';
        } else {
          stock = await pullStock();
          stockSrc = 'live';
        }
      } catch (e) {
        // Quota spent or report failed → fall back to whatever snapshot exists, however old, rather
        // than reverting to the merchant quantity, which would resurrect the false "out of stock".
        try {
          const cached = await readStockDoc();
          if (cached) {
            stock = cached.map;
            stockSrc = 'stale cache';
          }
        } catch (e2) { /* no stock doc either */ }
        if (!stock) notes.push(`${BRAND_NAME[brand]}: no FBA stock available (${e.message || e}) — quantities left unknown`);
      }

      // (b) The listings report — status and fulfilment channel.
      hMsg(`${BRAND_NAME[brand]}: asking Amazon to build the listings report…`);
      const done = await pollReport({ lh: 'create', brand }, { lh: 'poll', brand },
        progress => hMsg(`${BRAND_NAME[brand]}: listings report building… ${progress}`));

      // (c) Scope: FBA only, no virtual bundles. Counted, never silent — if the bundle rule ever
      //     starts removing real listings, it shows up here as a number.
      const all = done.rows || [];

      // Parent names come from the SELLER'S OWN listing names, taken from the FULL report before any
      // filtering. A variation parent carries no stock and no fulfilment channel, so it is dropped by
      // the FBA filter below — but its row is the only place the seller's own name for it ("Ridhi
      // Tablecloth Main") appears. The catalog's public product title is a different string and was
      // the wrong source; this one costs nothing extra and is what the seller actually recognises.
      HEALTH[brand] = HEALTH[brand] || {};
      const pNames = HEALTH[brand].parentNames || (HEALTH[brand].parentNames = {});
      all.forEach(row => {
        if (row.asin && row.title) pNames[row.asin] = String(row.title).slice(0, 80);
      });

      const mfn = all.filter(row => !H_FBA_RE.test(row.channel || '')).length;
      const fbaRows = all.filter(row => H_FBA_RE.test(row.channel || ''));
      const bundles = fbaRows.filter(row => H_BUNDLE_RE.test(row.sku || '')).length;
      let rows = fbaRows.filter(row => !H_BUNDLE_RE.test(row.sku || ''));

      // (d) Join real stock in by SKU.
      let matched = 0;
      rows.forEach(row => {
        if (stock && stock[row.sku] !== undefined) {
          row.qty = stock[row.sku];
          matched++;
        } else if (stock) row.qty = null;        // FBA listing absent from the stock report = unknown
      });

      // Keep any content we already have for these ASINs — the sweep below refreshes it, but if the
      // sweep is interrupted the old content is better than none.
      // The date it was read comes with it, or every refresh would forget which listings it had just re-read.
      // A+ comes along too (2026-10-03): it used to be dropped here, so every refresh started A+ from nothing and the
      // listings past the first 1,500 were left "unknown" after each one.
      const prev = {};        // asin → content already held
      const prevAt = {};      // asin → when it was read
      const prevAp = {};      // asin → { v: A+ answer, at: when asked }
      (HEALTH[brand]?.rows || []).forEach(row => {
        if (row.content) {
          prev[row.asin] = row.content;
          prevAt[row.asin] = row.checked || 0;
        }
        if (row.aplus !== undefined) prevAp[row.asin] = { v: row.aplus, at: row.aplusAt || 0 };
      });
      rows = rows.map(row => ({ ...row, content: prev[row.asin] || null, checked: prevAt[row.asin] || 0,
        aplus: prevAp[row.asin] ? prevAp[row.asin].v : undefined, aplusAt: prevAp[row.asin] ? prevAp[row.asin].at : 0 }));

      HEALTH[brand] = { rows, at: new Date(), contentAt: HEALTH[brand]?.contentAt || null,
        parentNames: pNames,                    // must survive this reassignment
        scope: { total: all.length, mfn, bundles, kept: rows.length, matched, stockSrc },
        schema: { headers: done.headers || [], sample: done.sample || {},
          withPrice: done.withPrice || 0, withQty: done.withQty || 0, n: done.total || all.length } };
      notes.push(`${BRAND_NAME[brand]}: ${rows.length} FBA listings (removed ${mfn} MFN, ${bundles} bundles)`
        + (stock ? ` · stock matched ${matched}/${rows.length} (${stockSrc})` : ''));
      await saveHealthCache(brand);
      renderHealth();
    } catch (e) {
      failed.push(`${BRAND_NAME[brand]}: ${e.message || e}`);
    }
  }
  H_LOADED = true;

  // Phase 2 — the content sweep. One catalog call per 20 ASINs, so this is the slow part; it renders
  // progressively and the table stays usable throughout.
  try {
    // NOT-YET-CHECKED FIRST. The queue used to be rebuilt in the same order every run, so with more
    // ASINs than the cap the same first 1,500 were re-checked forever and the tail was NEVER swept —
    // "refresh again to continue" simply did not continue. Unchecked ASINs now go to the front, so
    // each refresh genuinely picks up where the last one stopped.
    //
    // Each ASIN also carries its OWN brand: content was previously fetched for every ASIN using
    // Ridhi's credentials, and a seller's own attributes/images only come back under that seller's
    // credentials — which is why CPC listings showed blank images.
    // Three priority bands: never attempted → attempted but Amazon returned nothing → already has
    // content. Without the middle band, ASINs the catalog has no data for would sit at the front
    // forever and block the genuinely unchecked ones from ever being reached.
    /* STALE CONTENT WAS NEVER READ AGAIN (2026-10-03, Ravi: "jisme image h usme me show kar rha h ki image nahi h").
     * With every ASIN already holding content, the queue was the same first 1,500 in row order on every refresh, so a
     * listing read while it was new — no images uploaded yet, an older title — kept that snapshot for good: 170 rows
     * said "no image" while Amazon showed 9 (RTC327-60102). Now a listing whose content says 0 images is read again
     * first (a buyable listing with none is far more likely a stale read than a real one), and the rest go oldest
     * read first, so every refresh moves on to the ones not looked at longest. */
    // --- the queue, in priority bands: never tried → tried but empty → says 0 images → has content (oldest read first) ---
    const seen = new Set();
    const fresh = { SP: [], CPC: [] };      // never attempted
    const empty = { SP: [], CPC: [] };      // attempted, Amazon returned nothing
    const suspect = { SP: [], CPC: [] };    // has content that says 0 images — probably a stale read
    const stale = { SP: [], CPC: [] };      // has content
    const readAt = {};
    ['SP', 'CPC'].forEach(brand => (HEALTH[brand]?.rows || []).forEach(row => {
      if (!row.asin || seen.has(row.asin)) return;
      seen.add(row.asin);
      readAt[row.asin] = row.checked || 0;
      (row.content ? (row.content.images ? stale : suspect) : (row.tried ? empty : fresh))[brand].push(row.asin);
    }));
    ['SP', 'CPC'].forEach(brand => stale[brand].sort((x, y) => readAt[x] - readAt[y]));
    // Interleave the brands within each priority band so a cap costs both the same proportion.
    const weave = src => {
      const out = [];
      for (let i = 0; i < Math.max(src.SP.length, src.CPC.length); i++) {
        if (src.SP[i]) out.push({ asin: src.SP[i], brand: 'SP' });
        if (src.CPC[i]) out.push({ asin: src.CPC[i], brand: 'CPC' });
      }
      return out;
    };
    const queue = [...weave(fresh), ...weave(empty), ...weave(suspect), ...weave(stale)];
    const capped = queue.length > H_CONTENT_MAX;
    const work = queue.slice(0, H_CONTENT_MAX);
    const neverChecked = fresh.SP.length + fresh.CPC.length;
    // Catalog allows 20 ASINs per call, so the only way to go faster is more calls in flight.
    // H_SWEEP_PAR at a time — a bad chunk resolves to null instead of killing the whole sweep, and
    // spRetry_ on the backend absorbs the occasional 429 that concurrency provokes.
    // A batch is 20 ASINs of ONE brand, because the call runs under that brand's credentials.
    // Batches are then interleaved so both brands advance together.
    // --- batches of 20 per brand, interleaved, then H_SWEEP_PAR calls at a time ---
    const CHUNK = 20;
    const cut = brandKey => {
      const list = work.filter(item => item.brand === brandKey).map(item => item.asin);
      const out = [];
      for (let i = 0; i < list.length; i += CHUNK) out.push({ brand: brandKey, asins: list.slice(i, i + CHUNK) });
      return out;
    };
    const bSP = cut('SP');
    const bCPC = cut('CPC');
    const batches = [];
    for (let i = 0; i < Math.max(bSP.length, bCPC.length); i++) {
      if (bSP[i]) batches.push(bSP[i]);
      if (bCPC[i]) batches.push(bCPC[i]);
    }

    let swept = 0;
    for (let i = 0; i < batches.length; i += H_SWEEP_PAR) {
      const grp = batches.slice(i, i + H_SWEEP_PAR);
      swept += grp.reduce((sum, batch) => sum + batch.asins.length, 0);
      hMsg(`Checking listing content… ${swept} / ${work.length} ASINs`);
      /* A batch that fails (Amazon's 429 under three calls at once) is tried ONCE more on its own (2026-10-03): it was
       * simply skipped, which is how RTME-S-001-1420 kept "no image" through a refresh while Amazon had one. */
      const ask = batch => baCall({ lh: 'content', brand: batch.brand, asins: batch.asins.join(',') }).catch(() => null);
      const results = await Promise.all(grp.map(ask));
      for (let k = 0; k < grp.length; k++) {
        if (results[k] && results[k].ok !== false) continue;
        await new Promise(res => setTimeout(res, 1500));
        results[k] = await ask(grp[k]);
      }
      const got = Object.assign({}, ...results.filter(Boolean).map(reply => reply.content || {}));
      // Mark everything in this group as ATTEMPTED, whether or not Amazon had data for it. An ASIN
      // the catalog knows nothing about is a different thing from one that was never looked at, and
      // conflating them is why the tab could claim "every ASIN has now been checked" while still
      // reporting hundreds as unchecked.
      const asked = new Set(grp.flatMap(batch => batch.asins));
      ['SP', 'CPC'].forEach(brand => (HEALTH[brand]?.rows || []).forEach(row => {
        if (got[row.asin]) {
          row.content = got[row.asin];
          row.checked = Date.now();
        }
        if (asked.has(row.asin)) row.tried = true;
      }));
      if (i % (H_SWEEP_PAR * 5) === 0) renderHealth();           // periodic repaint, not every group
    }
    // Phase 2b — the PARENT ASINs' own titles, so the parent view can show a real product name
    // instead of borrowing one of the children's. Same catalog endpoint, and resumable: only parents
    // whose name we don't already hold are fetched (a few hundred, so ~15 seconds).
    try {
      for (const brand of ['SP', 'CPC']) {
        const rows = HEALTH[brand]?.rows || [];
        if (!rows.length) continue;
        const names = HEALTH[brand].parentNames || (HEALTH[brand].parentNames = {});
        const want = [...new Set(rows.map(row => row.parent).filter(parent => parent && !names[parent]))];
        for (let i = 0; i < want.length; i += 20 * H_SWEEP_PAR) {
          const grp = [];
          for (let j = i; j < Math.min(i + 20 * H_SWEEP_PAR, want.length); j += 20) grp.push(want.slice(j, j + 20));
          hMsg(`${BRAND_NAME[brand]}: reading parent names… ${Math.min(i + 20 * H_SWEEP_PAR, want.length)} / ${want.length}`);
          const res = await Promise.all(grp.map(chunk =>
            baCall({ lh: 'content', brand, asins: chunk.join(',') }).catch(() => null)));
          res.filter(Boolean).forEach(reply => Object.entries(reply.content || {}).forEach(([asin, content]) => {
            if (content && content.title) names[asin] = String(content.title).slice(0, 80);
          }));
        }
      }
    } catch (e) {
      notes.push('parent names: ' + (e.message || e));
    }

    // Phase 3 — A+ content, asked per ASIN via publish records (the authoritative answer).
    try {
      for (const brand of ['SP', 'CPC']) {
        if (!HEALTH[brand]?.rows?.length) continue;
        /* A+ IS ASKED AGAIN (2026-10-03, Ravi: "A+ wala bhi theek kar do"). An answer used to be final: once a listing
         * read "A+ missing" it stayed missing after the A+ went live. Now: never asked first, then the ones that read
         * MISSING (oldest answer first — those are the ones on a fix-it list), then the ones that have it, oldest first.
         * A lookup that fails keeps the last answer instead of going back to unknown. */
        const seenA = new Set();
        const never = [];           // never asked
        const missing = [];         // last answer: no A+
        const present = [];         // last answer: has A+
        const askedAt = {};
        HEALTH[brand].rows.forEach(row => {
          if (!row.asin || seenA.has(row.asin)) return;
          seenA.add(row.asin);
          askedAt[row.asin] = row.aplusAt || 0;
          (row.aplus === undefined ? never : row.aplus === false ? missing : present).push(row.asin);
        });
        const byAge = (x, y) => askedAt[x] - askedAt[y];
        const uniq = [...never, ...missing.sort(byAge), ...present.sort(byAge)];
        if (!uniq.length) continue;

        const work = uniq.slice(0, H_APLUS_MAX);
        // Index once. Scanning every row per answered ASIN would be ~3M comparisons on this catalogue.
        const byAsin = {};
        HEALTH[brand].rows.forEach(row => { (byAsin[row.asin] = byAsin[row.asin] || []).push(row); });
        const CH = 10;              // ASINs per A+ call
        const errs = [];
        let done = 0;
        let roleMissing = false;
        let answered = 0;
        for (let i = 0; i < work.length; i += CH * H_SWEEP_PAR) {
          const grp = [];
          for (let j = i; j < Math.min(i + CH * H_SWEEP_PAR, work.length); j += CH) grp.push(work.slice(j, j + CH));
          hMsg(`${BRAND_NAME[brand]}: checking A+ content… ${Math.min(i + CH * H_SWEEP_PAR, work.length)} / ${work.length}`);
          const res = await Promise.all(grp.map(chunk =>
            baCall({ lh: 'aplusasin', brand, asins: chunk.join(',') }).catch(() => null)));
          res.filter(Boolean).forEach(reply => {
            if (reply.roleMissing) roleMissing = true;
            (reply.errors || []).forEach(e => { if (errs.length < 3) errs.push(e); });
            Object.entries(reply.map || {}).forEach(([asin, has]) => {
              answered++;
              (byAsin[asin] || []).forEach(row => {
                row.aplus = has;
                row.aplusAt = Date.now();
              });
            });
          });
          done += grp.reduce((sum, chunk) => sum + chunk.length, 0);
        }

        // An ASIN we could not read stays undefined — "could not tell" must never harden into
        // "missing", which is what would put a perfectly good listing on a fix-it list.
        const withA = HEALTH[brand].rows.filter(row => row.aplus === true).length;
        const without = HEALTH[brand].rows.filter(row => row.aplus === false).length;
        const unknown = HEALTH[brand].rows.filter(row => row.aplus === undefined).length;
        if (roleMissing && !answered) {
          notes.push(`${BRAND_NAME[brand]}: A+ could not be read — the SP-API app does not have the A+ Content role. Left as unknown.`);
        } else {
          HEALTH[brand].aplusChecked = true;
          notes.push(`${BRAND_NAME[brand]}: A+ present on ${withA}, missing on ${without}, unknown ${unknown}`
            + (uniq.length > work.length ? ` — ${uniq.length - work.length} not re-asked this time; the next refresh starts with them` : '')
            + (errs.length ? ` · errors: ${errs.join(' | ')}` : ''));
        }
      }
    } catch (e) {
      notes.push('A+ check: ' + (e.message || e));
    }

    // --- save both brands, then the notes about the cap ---
    ['SP', 'CPC'].forEach(brand => { if (HEALTH[brand]) HEALTH[brand].contentAt = new Date(); });
    for (const brand of ['SP', 'CPC']) if (HEALTH[brand]) await saveHealthCache(brand);
    // A cap is information, not a failure — it used to be pushed in with the errors and turned the
    // whole message red, making a successful run look broken.
    if (capped) notes.push(`content checked for ${H_CONTENT_MAX} of ${queue.length} ASINs`
      + (neverChecked > H_CONTENT_MAX ? ` — ${neverChecked - H_CONTENT_MAX} still never checked; refresh again and it resumes from those`
                                      : ' — every ASIN has now been checked at least once'));
  } catch (e) {
    failed.push('content sweep: ' + (e.message || e));
  }

  renderHealth();
  // Only PROBLEMS stay on screen. The per-brand counts are informational and used to sit there as a
  // permanent wall of text — they're kept under "Raw fields" instead.
  H_LAST_RUN = notes;
  const quota = failed.some(failure => /429|QuotaExceeded/i.test(failure));
  hMsg(quota
    ? 'Amazon’s report quota is used up (it allows about one report a minute). Wait ~10 minutes and refresh again — the snapshot below is the last successful pull.'
    : failed.join('  ·  '), failed.length > 0);
  btn.disabled = false;
  btn.textContent = 'Refresh both brands';
};

// Typing must not rebuild the table on every keystroke — at catalogue size each rebuild is a quarter
// of a second, so an 8-letter SKU used to cost eight of them back to back and the box felt frozen.
let H_FILTER_T = 0;
$('hFilter').addEventListener('input', () => {
  clearTimeout(H_FILTER_T);
  H_FILTER_T = setTimeout(renderHealth, 250);
});
$('hBrandView').addEventListener('change', renderHealth);
$('hIssueView').addEventListener('change', renderHealth);
// Each view gets its own sensible default sort; carrying the other view's sort key over would land
// on a column that doesn't exist there.
$('hViewParent').onclick = () => {
  H_FOCUS = null;
  H_VIEW = 'parent';
  H_SORT = { k: 'critical', dir: -1 };
  renderHealth();
};
$('hViewChild').onclick = () => {
  H_FOCUS = null;
  H_VIEW = 'child';
  H_SORT = { k: 'score', dir: 1 };
  renderHealth();
};

/* ONE PARENT, ON THE PAGE (Ravi, 15 Sept): clicking a Parent ASIN no longer opens a pop-up. It opens the
 * child table itself, holding only that parent's children, with a bar naming the parent and a way back. */
let H_FOCUS = null;           // { brand, parent } while one parent's children are open
// A Parent ASIN was clicked: show only that parent's children, worst first, and scroll to the top.
function hFocusOpen(brand, parent) {
  H_FOCUS = { brand, parent };
  H_VIEW = 'child';
  H_SORT = { k: 'sevRank', dir: -1 };
  $('hIssueView').value = 'ALL';
  $('hFilter').value = '';
  renderHealth();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
// The bar above the table while one parent is open: its name, counts per bucket, a way back, the Title optimiser link.
function hFocusBar(brands) {
  const bar = $('hFocus');
  if (!H_FOCUS || H_VIEW !== 'child' || !brands.includes(H_FOCUS.brand)) {
    bar.classList.add('hide');
    bar.innerHTML = '';
    return;
  }
  const kids = ((HEALTH[H_FOCUS.brand] && HEALTH[H_FOCUS.brand].rows) || [])
    .filter(row => (row.parent || row.asin || row.sku) === H_FOCUS.parent).map(row => Object.assign({}, row, { brand: H_FOCUS.brand }));
  const hc = hCtx();
  const counts = { critical: 0, action: 0, review: 0, healthy: 0, monitor: 0, unchecked: 0 };
  kids.forEach(row => { counts[healthOf(row, hc).bucket]++; });
  const name = parentName(H_FOCUS.brand, H_FOCUS.parent, kids[0] && kids[0].title);
  bar.classList.remove('hide');
  bar.innerHTML = `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <button id="hFocusBack" class="ghost">← All parents</button>
      <div style="flex:1 1 280px;min-width:0">
        <div style="font-weight:700;font-size:16px">${lrEsc(name || H_FOCUS.parent)}</div>
        <div class="muted" style="font-size:12.5px"><span style="font-family:ui-monospace,monospace">${lrEsc(H_FOCUS.parent)}</span> · ${lrEsc(BRAND_NAME[H_FOCUS.brand] || H_FOCUS.brand)} · ${kids.length} children
          · <span class="sev sev-c"></span>${counts.critical} critical · <span class="sev sev-a"></span>${counts.action} attention · <span class="sev sev-r"></span>${counts.review} review
          · <span class="sev sev-g"></span>${counts.healthy + counts.monitor} healthy${counts.unchecked ? ` · ${counts.unchecked} not checked` : ''}</div>
      </div>
      <button id="hFocusOpt" class="ghost">Title optimiser ↗</button>
    </div>`;
  $('hFocusBack').onclick = () => {
    H_FOCUS = null;
    H_VIEW = 'parent';
    H_SORT = { k: 'critical', dir: -1 };
    renderHealth();
  };
  $('hFocusOpt').onclick = () => window.open(H_OPTIMISER_URL, '_blank', 'noopener');
}

// Draw the Listing Health table in the current view (parent or child) with the brand, issue and search filters, then the KPI cards.
function renderHealth() {
  $('hViewParent').classList.toggle('on', H_VIEW === 'parent');
  $('hViewChild').classList.toggle('on', H_VIEW === 'child');
  const pick = $('hBrandView').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]).filter(brand => HEALTH[brand]);
  if (!brands.length) {
    $('hResult').classList.remove('hide');
    $('hKpis').innerHTML = '<div class="kpi"><div class="kpiname">No snapshot yet</div>'
      + '<div class="muted" style="margin-top:6px">Hit “Refresh both brands” to pull your listings from Amazon.</div></div>';
    $('hTable').innerHTML = '';
    return;
  }
  const multiBrand = brands.length > 1;
  hFocusBar(brands);
  // --- score every listing ---
  let rows = brands.flatMap(brandKey => HEALTH[brandKey].rows.map(row => ({ ...row, brand: brandKey })));
  const hc = hCtx();
  rows.forEach(row => {
    const health = healthOf(row, hc);
    row._h = health;
    row.score = health.score;
    row.grade = health.grade;
  });

  // --- the issue picker and the search box ---
  // "Inactive" contains the substring "active", so the active test must exclude it explicitly —
  // the same trap healthOf has to avoid.
  const isActive = row => /active/i.test(row.status || '') && !/inactive/i.test(row.status || '');
  const view = $('hIssueView').value;
  // One predicate, used two ways: in child view it picks ROWS, in parent view it picks which
  // PARENTS to show (any parent with at least one matching child) while the counts still describe
  // all of that parent's children.
  const PRED = {
    critical: row => row._h.bucket === 'critical',
    action: row => row._h.bucket === 'action',
    review: row => row._h.bucket === 'review',
    healthy: row => row._h.bucket === 'healthy',
    monitor: row => row._h.bucket === 'monitor',
    unchecked: row => row._h.bucket === 'unchecked',
    active: isActive,
    inactive: row => !isActive(row),
    // These three ask about a KNOWN fact, so rows that were never checked are excluded rather than
    // swept in as if they were missing.
    noimg: row => row.content && !row.content.images,
    fewimg: row => row.content && row.content.images < H_RULES.minImages,
    noaplus: row => row.aplus === false,
  }[view] || null;

  const search = $('hFilter').value.trim().toLowerCase();
  const textOf = row => ((row.sku || '') + ' ' + (row.asin || '') + ' ' + (row.parent || '') + ' ' + (row.title || '')).toLowerCase();
  const reasonText = row => {
    const health = row._h;
    return [...health.critical, ...health.action, ...health.review].join(' · ') || (row.content ? 'Nothing found' : 'Content not checked');
  };

  const defs = [];

  if (H_VIEW === 'parent') {
    // --- parent view: one row per parent, with counts per bucket and the worst issue per area ---
    // Roll children up under their parent. A listing with no parent ASIN is its own group rather
    // than being dropped or lumped into one giant "no parent" bucket.
    const byParent = {};
    rows.forEach(row => {
      const key = (row.parent || row.asin || row.sku) + '|' + row.brand;
      const group = byParent[key] || (byParent[key] = { parent: row.parent || row.asin || '—', brand: row.brand,
        title: row.title, kids: [], standalone: !row.parent });
      group.kids.push(row);
    });
    // A name the user typed wins over Amazon's; then the seller's own listing name; then a child's
    // title marked "~". parentName() holds that order for all three tabs.
    Object.values(byParent).forEach(group => { group.title = parentName(group.brand, group.parent, group.title); });
    let groups = Object.values(byParent).map(group => {
      const kids = group.kids;
      const count = bucket => kids.filter(kid => kid._h.bucket === bucket).length;
      const checked = kids.filter(kid => kid._h.bucket !== 'unchecked');
      return Object.assign(group, {
        children: kids.length,
        critical: count('critical'), action: count('action'), review: count('review'), healthy: count('healthy') + count('monitor'), unchecked: count('unchecked'),
        // Averaged over the children that were checked: an unread listing has no health to average in.
        score: checked.length ? Math.round(checked.reduce((sum, kid) => sum + kid.score, 0) / checked.length) : null,
      });
    });
    // The filter selects PARENTS via their children; the counts above stay whole.
    if (PRED) groups = groups.filter(group => group.kids.some(PRED));
    if (search) groups = groups.filter(group => (group.parent || '').toLowerCase().includes(search)
      || (group.title || '').toLowerCase().includes(search) || group.kids.some(kid => textOf(kid).includes(search)));
    rows = groups;

    defs.push({ k: 'title', t: 'Parent', trunc: 38,
      cell: row => parentNameCell(row.brand, row.parent, row.title, 38),
      tip: "Click a name to set your own — once saved, refreshes never change it. Otherwise the seller's own listing name, or a child's title marked ~." });
    if (multiBrand) defs.push({ k: 'brand', t: 'Brand', map: row => BRAND_NAME[row.brand] });
    defs.push({ k: 'children', t: 'Children', num: 1,
      tip: 'Child listings under this parent. Critical + Needs Action + Needs Review + Healthy = the children that were checked; the rest are "not checked yet".' });
    /* IN COLOUR (2026-10-03, Ravi: "parent wale data ko bhi colorful kar dena"): each count carries its bucket's dot,
     * a zero stays grey, Health is green / amber / red, and the same five areas as the child table show the worst
     * colour among the children with how many children it hits. */
    const cnt = spec => row => {                 // spec: { k: the count's key, c: the dot's CSS class }
      const value = row[spec.k];
      return value ? `<span class="sev ${spec.c}"></span><b>${Number(value).toLocaleString('en-US')}</b>` : '<span class="muted">0</span>';
    };
    defs.push({ k: 'critical', t: 'Critical', num: 1, cell: cnt({ k: 'critical', c: 'sev-c' }),
      tip: 'Cannot be bought or is fundamentally wrong: stock at Amazon but Inactive, no price, or no main image.' });
    defs.push({ k: 'action', t: 'Needs Action', num: 1, cell: cnt({ k: 'action', c: 'sev-a' }),
      tip: 'A+ missing, under 6 images, under 5 bullets, or a size in the title not written "14 x 36 Inch" / written larger-first.' });
    defs.push({ k: 'review', t: 'Needs Review', num: 1, cell: cnt({ k: 'review', c: 'sev-r' }),
      tip: '6–7 images when 8 is ideal, a thin or missing description, or a title outside 80–200 characters.' });
    /* ONE COLUMN, NOT TWO (2026-10-05, Ravi: "healthy or health only 1 column rakho"): the Health score stays; the count
     * of clean children is on the brand card above. */
    ['Amazon', 'Title', 'Size', 'Variation', 'Images', 'Content'].forEach(area => defs.push({ k: 'parea' + area, t: area, noTotal: 1,
      map: row => row.kids.reduce((worstRank, kid) => {
        const found = hAreaSev(kid._h, area);
        return Math.max(worstRank, found ? LR_SEV[found.sev].rank : 0);
      }, 0),
      cell: row => {
        let worst = null;
        let hit = 0;
        row.kids.forEach(kid => {
          const found = hAreaSev(kid._h, area);
          if (!found) return;
          hit++;
          if (!worst || LR_SEV[found.sev].rank > LR_SEV[worst].rank) worst = found.sev;
        });
        if (!worst) return row.kids.some(kid => kid._h.bucket !== 'unchecked') ? '<span class="sev-ok">✓</span>' : '<span class="muted">—</span>';
        return `<span class="sev ${LR_SEV[worst].cls}" title="${hit} of ${row.kids.length} children have a ${area.toLowerCase()} issue; the worst is ${LR_SEV[worst].label}"></span>`
          + `<span class="muted" style="font-size:12px">${hit}</span>`;
      },
      tip: `The worst ${area.toLowerCase()} issue among the children, and how many children have one. ✓ = none of the checked children has one.` }));
    defs.push({ k: 'score', t: 'Health', num: 1, noTotal: 1,
      cell: row => row.score == null ? '<span class="muted">—</span>'
        : `<b style="color:${row.score >= 80 ? '#15803D' : row.score >= 50 ? '#B45309' : 'var(--bad,#b91c1c)'}">${row.score}</b>`,
      tip: 'Average health of the checked children: 100 − 40 per critical issue − 10 per action − 3 per review. Green 80+, amber 50–79, red under 50.' });
    defs.push({ k: 'parent', t: 'Parent ASIN', mono: 1, noTotal: 1,
      cell: row => `<span data-hkid="${String(row.brand).replace(/"/g, '')}|${String(row.parent).replace(/[<>&"]/g, '')}"`
        + ` style="font-family:ui-monospace,monospace;cursor:pointer;text-decoration:underline dotted" title="Open this parent's children">`
        + `${String(row.parent).replace(/[<>&"]/g, '')}</span>`,
      tip: 'Click a Parent ASIN to open all of its child listings — what each one fails and passes.' });
  } else {
    // --- child view: one row per listing, filtered to one parent when a parent is open ---
    if (H_FOCUS && brands.includes(H_FOCUS.brand))
      rows = rows.filter(row => row.brand === H_FOCUS.brand && (row.parent || row.asin || row.sku) === H_FOCUS.parent);
    if (PRED) rows = rows.filter(PRED);
    if (search) rows = rows.filter(row => textOf(row).includes(search));

    /* SKU / ASIN · Status · Severity · Issues · Inventory · Title · Size · Variation · Images — Ravi's drawing —
     * then Content (A+, bullets, description), Health, the reasons, and a suggested title where one applies.
     * A coloured dot is the worst issue in that area; ✓ is judged and fine; — could not be judged. */
    defs.push({ k: 'sku', t: 'SKU / ASIN', frz: 1,
      cell: row => `<div style="font-family:ui-monospace,monospace">${lrEsc(row.sku)}</div>`
        + `<div class="muted" style="font-family:ui-monospace,monospace;font-size:11px">${lrEsc(row.asin || '')}</div>` });
    if (multiBrand) defs.push({ k: 'brand', t: 'Brand', map: row => BRAND_NAME[row.brand] });
    defs.push({ k: 'lstatus', t: 'Status', noTotal: 1,
      map: row => row.qty === 0 ? 'OOS' : (/inactive/i.test(row.status || '') ? 'Inactive' : (/active/i.test(row.status || '') ? 'Active' : (row.status || '—'))) });
    defs.push({ k: 'sevRank', t: 'Severity', noTotal: 1,
      map: row => ({ critical: 5, action: 4, review: 3, unchecked: 2, monitor: 1, healthy: 0 })[row._h.bucket], cell: row => hSevCell(row._h.bucket) });
    defs.push({ k: 'issueCount', t: 'Issues', num: 1, map: row => row._h.found.length });
    defs.push({ k: 'qty', t: 'Inventory', num: 1 });
    ['Amazon', 'Title', 'Size', 'Variation', 'Images', 'Content'].forEach(area => defs.push({ k: 'area' + area, t: area, noTotal: 1,
      map: row => {
        const found = hAreaSev(row._h, area);
        return found ? LR_SEV[found.sev].rank : 0;
      },
      cell: row => hAreaCell(row, area) }));
    defs.push({ k: 'score', t: 'Health', num: 1, bold: 1, noTotal: 1 });
    defs.push({ k: 'title', t: 'Title text', trunc: 38 });
    defs.push({ k: 'issues', t: 'Why', map: reasonText, trunc: 60 });
    defs.push({ k: 'suggest', t: '', noTotal: 1, map: () => '',
      cell: row => (row._h.found.some(found => found.area === 'Title' || found.area === 'Size' || found.area === 'Variation') && lrTemplateFor(row, LR || LR_DEFAULT))
        ? `<button class="ghost" data-hsug="${lrEsc(row.brand)}|${lrEsc(row.sku)}" style="padding:2px 8px;font-size:12px;white-space:nowrap">Suggest title</button>` : '' });
  }

  // --- sort, then draw (the first H_PAGE rows; totals, cards and Export use them all) ---
  const val = (row, def) => (def.map ? def.map(row) : row[def.k]);
  // Parent view leads with the parents that need the most work; child view with the worst listings.
  const sortDef = defs.find(def => def.k === H_SORT.k)
    || defs.find(def => def.k === (H_VIEW === 'parent' ? 'critical' : 'score'));
  rows.sort((a, b) => {
    const x = val(a, sortDef);
    const y = val(b, sortDef);
    const cmp = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x || '').localeCompare(String(y || ''));
    return cmp * H_SORT.dir;
  });

  // Export and the totals below use the FULL filtered set; only the DOM is capped.
  H_RENDER = { rows, defs, val };
  $('hResult').classList.remove('hide');
  // The cards always describe LISTINGS, never parents — in parent view that means the children of
  // whichever parents survived the filter, so the cards still agree with what's on screen.
  renderHealthKpis(H_VIEW === 'parent' ? rows.flatMap(g => g.kids) : rows, brands);

  // Only H_PAGE rows are put in the DOM. At full catalogue size (3,922 listings × 13 columns =
  // ~55,000 cells) a sticky header + sticky first column cost ~88ms of layout PER SCROLL FRAME —
  // about 11fps — which is what made the whole app feel hung. The cap is on rendering only: the
  // TOTAL row, the KPI cards and the CSV export are all computed over every filtered row.
  const shown = rows.slice(0, H_PAGE);

  const fmtNum = value => (value == null || value === '' ? '<span class="muted">—</span>' : Number(value).toLocaleString('en-US'));
  const money = value => (value ? '$' + Number(value).toFixed(2) : '<span class="muted">—</span>');
  const esc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const arrow = def => def.k === H_SORT.k ? (H_SORT.dir < 0 ? ' ↓' : ' ↑') : '';
  const gradeCls = grade => grade === 'Good' ? 'gd-good' : grade === 'Needs work' ? 'gd-warn' : 'gd-bad';

  const head = '<thead><tr>' + defs.map(def =>
    `<th data-k="${esc(def.k)}" class="${def.frz ? 'frz ' : ''}${def.num ? 'num' : ''}"${
      def.tip ? ` title="${esc(def.tip)}"` : ''}>${esc(def.t)}${arrow(def)}</th>`).join('') + '</tr></thead>';

  const body = shown.map(row => '<tr>' + defs.map(def => {
    const value = val(row, def);
    const cls = (def.frz ? 'frz ' : '') + (def.num ? 'num' : '');
    if (def.cell) return `<td class="${cls}">${def.cell(row)}</td>`;
    if (def.k === 'grade') return `<td class="${cls}">${esc(value)}</td>`;
    if (def.num && def.bold) return `<td class="${cls}" style="font-weight:700">${fmtNum(value)}</td>`;
    if (def.k === 'score') return `<td class="${cls}" style="font-weight:700">${fmtNum(value)}</td>`;
    if (def.money) return `<td class="${cls}">${money(value)}</td>`;
    if (def.num) return `<td class="${cls}">${fmtNum(value)}</td>`;
    if (def.trunc) return `<td class="${cls}" title="${esc(value)}">${esc(String(value || '').slice(0, def.trunc))}</td>`;
    return `<td class="${cls}" style="${def.mono ? 'font-family:ui-monospace,monospace' : ''}">${esc(value) || '<span class="muted">—</span>'}</td>`;
  }).join('') + '</tr>').join('');

  // Only quantities are meaningful to add up — a summed score or price would be nonsense, so those
  // columns are marked noTotal and left blank in the footer.
  const foot = rows.length ? '<tfoot><tr>' + defs.map((def, i) => {
    if (i === 0) return `<td class="frz">TOTAL · ${rows.length}</td>`;
    if (!def.num || def.noTotal) return '<td></td>';
    const sum = rows.reduce((acc, row) => acc + (Number(val(row, def)) || 0), 0);
    return `<td class="num">${fmtNum(sum)}</td>`;
  }).join('') + '</tr></tfoot>' : '';

  $('hTable').innerHTML = head + '<tbody>' + (body ||
    `<tr><td colspan="${defs.length}" class="muted">No rows.</td></tr>`) + '</tbody>' + foot;

  // The scope and truncation detail moved into "Raw fields" — it was two paragraphs of standing text
  // above every view. The TOTAL row still carries the real count, so the table can't be mistaken for
  // the whole set, and H_SCOPE_NOTE keeps the full explanation one click away.
  H_SCOPE_NOTE = (() => {
    const out = [];
    if (rows.length > shown.length) {
      out.push(`Table shows the top ${shown.length} of ${rows.length.toLocaleString('en-US')} rows (sorted by ${sortDef.t}); `
        + `totals, cards and Export cover all ${rows.length.toLocaleString('en-US')}.`);
    }
    const scoped = brands.map(brand => HEALTH[brand]?.scope).filter(Boolean);
    if (scoped.length) {
      const sum = scoped.reduce((acc, scope) => ({ mfn: acc.mfn + scope.mfn, bundles: acc.bundles + scope.bundles,
        matched: acc.matched + scope.matched, kept: acc.kept + scope.kept }), { mfn: 0, bundles: 0, matched: 0, kept: 0 });
      out.push(`FBA only — excluded ${sum.mfn.toLocaleString('en-US')} merchant-fulfilled and `
        + `${sum.bundles.toLocaleString('en-US')} bundle SKUs (SKU starting “RB”). `
        + `Quantity from FBA inventory: matched ${sum.matched.toLocaleString('en-US')}/${sum.kept.toLocaleString('en-US')}`
        + (sum.kept > sum.matched ? `; the other ${(sum.kept - sum.matched).toLocaleString('en-US')} show “—”, not a guessed zero.` : '.'));
    }
    return out;
  })();

  // --- wire the table: heading click sorts, parent names open the name editor, Suggest title, Parent ASIN opens the children ---
  $('hTable').querySelectorAll('thead th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k;
      H_SORT = { k, dir: H_SORT.k === k ? -H_SORT.dir : -1 };
      renderHealth();
    };
  });
  if (H_VIEW === 'parent') {
    wireParentNameCells('hTable', renderHealth);
  }
  $('hTable').querySelectorAll('[data-hsug]').forEach(el => {
    el.onclick = () => {
      const pair = el.dataset.hsug;                 // "brand|sku"
      const sep = pair.indexOf('|');
      hSugOpen(pair.slice(0, sep), pair.slice(sep + 1));
    };
  });
  if (H_VIEW === 'parent') {
    $('hTable').querySelectorAll('[data-hkid]').forEach(el => {
      el.onclick = () => {
        const pair = el.dataset.hkid;               // "brand|parent"
        const sep = pair.indexOf('|');
        hFocusOpen(pair.slice(0, sep), pair.slice(sep + 1));
      };
    });
  }
}

