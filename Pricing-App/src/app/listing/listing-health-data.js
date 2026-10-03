/* ----- Firestore cache ----- */
// Rows are stored in CHUNK DOCS, not in one document. A single doc had to be capped at 1,500 rows to
// stay under Firestore's 1 MB limit, which silently dropped 549 of Ridhi's 2,049 listings — so the
// tab showed the full set right after a refresh and a truncated one after every reload. That is what
// looked like "the data resets". `health/{brand}` now holds only metadata plus a chunk count.
const H_CHUNK = 900;
const unpackRow = r => ({
  sku: r.s, asin: r.i, parent: r.p, title: r.n,
  price: r.pr === null ? null : (r.pr || 0),
  qty: r.q === null ? null : (r.q || 0),           // null must survive the round trip: it means
  status: r.st || '', channel: r.ch || '',          // "unknown", and 0 means a real stockout
  opened: r.od || '', tried: !!r.t, titleFull: r.nf === 1,
  aplus: r.ap === 1 ? true : (r.ap === 0 ? false : undefined),   // undefined = never checked, and
  content: r.c ? { titleLen: r.c[0], images: r.c[1], bullets: r.c[2], descLen: r.c[3], title: r.c[4] || '' } : null,
  checked: r.ca || 0,                                            // when the content was last read (ms); 0 = before this was kept
  aplusAt: r.apa || 0,                                           // when A+ was last asked (ms)
});                                                              // that is NOT the same as "missing"
const packRow = r => ({
  s: r.sku, i: r.asin || '', p: r.parent || '', n: (r.title || '').slice(0, 200), nf: 1,
  pr: r.price == null ? null : r.price, q: r.qty == null ? null : r.qty,
  st: r.status || '', ch: r.channel || '', od: r.opened || '', t: r.tried ? 1 : 0,
  ap: r.aplus === true ? 1 : (r.aplus === false ? 0 : null),
  c: r.content ? [r.content.titleLen || 0, r.content.images || 0, r.content.bullets || 0, r.content.descLen || 0,
    String(r.content.title || '').slice(0, 200)] : null,
  ca: r.checked || 0,
  apa: r.aplusAt || 0,
});

async function loadHealthCache() {
  for (const b of ['SP', 'CPC']) {
    try {
      const snap = await getDoc(doc(db, 'health', b));
      if (!snap.exists()) continue;
      const d = snap.data();
      const chunks = d.chunks || 0;
      let rows = [];
      if (chunks) {
        const got = await Promise.all(Array.from({ length: chunks }, (_, i) =>
          getDoc(doc(db, 'healthrows', `${b}_${i}`))));
        got.forEach(s => { if (s.exists()) rows = rows.concat((s.data().r || []).map(unpackRow)); });
      } else {
        rows = (d.rows || []).map(unpackRow);        // documents written by the old single-doc version
      }
      HEALTH[b] = {
        at: d.at && d.at.toDate ? d.at.toDate() : null,
        contentAt: d.contentAt && d.contentAt.toDate ? d.contentAt.toDate() : null,
        scope: d.scope || null, parentNames: d.parentNames || {}, rows,
      };
    } catch (e) {
      // Do NOT swallow this. A failed load is exactly what "my data disappeared" looks like, and it
      // used to happen in silence.
      hMsg(`Could not load the saved ${BRAND_NAME[b]} snapshot: ${e.message || e}`, true);
    }
  }
  H_LOADED = true;
}

async function saveHealthCache(brand) {
  const h = HEALTH[brand];
  if (!h) return;
  const chunks = Math.ceil(h.rows.length / H_CHUNK) || 1;
  for (let i = 0; i < chunks; i++) {
    await setDoc(doc(db, 'healthrows', `${brand}_${i}`),
      { r: h.rows.slice(i * H_CHUNK, (i + 1) * H_CHUNK).map(packRow) });
  }
  await setDoc(doc(db, 'health', brand), {
    chunks, n: h.rows.length,
    rows: null,                                      // clear the old single-doc payload if present
    scope: h.scope || null,
    parentNames: h.parentNames || null,              // ~800 entries; kept so they aren't re-fetched

    at: serverTimestamp(),
    contentAt: h.contentAt ? serverTimestamp() : null,
  });
}
async function ensureHealth() {
  await loadParentNames();
  if (!LR) await lrLoad();
  /* The catalogue is slow to read the first time; the table draws without it and again once it lands. */
  if (!LR_CAT.SP || !LR_CAT.CPC) lrLoadCatalog().then(() => { H_CTX = null; if (!$('paneHealth').classList.contains('hide')) renderHealth(); });
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
  const c = await baCall(createParams);
  if (!c.reportId) throw new Error(c.error || 'could not create report');
  for (let i = 0; i < 32; i++) {                                   // ~8 min ceiling
    await new Promise(r => setTimeout(r, i === 0 ? 8000 : 15000));
    const d = await baCall({ ...pollParams, id: c.reportId });
    if (d.status === 'done') return d;
    if (onTick) onTick(`(${Math.round((i * 15 + 8) / 6) / 10} min)`);
  }
  throw new Error('report took too long');
}

$('hGo').onclick = async () => {
  const btn = $('hGo');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>…';
  const failed = [], notes = [];

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
      let stock = null, stockSrc = '';
      const readStockDoc = async () => {
        const snap = await getDoc(doc(db, 'stock', brand));
        if (!snap.exists()) return null;
        const d = snap.data();
        const at = d.at && d.at.toDate ? d.at.toDate() : null;
        return { map: d.m || {}, at, ageHrs: at ? (Date.now() - at.getTime()) / 36e5 : Infinity };
      };
      const pullStock = async () => {
        hMsg(`${BRAND_NAME[brand]}: reading FBA stock…`);
        const sd = await pollReport({ age: 'create', brand }, { age: 'poll', brand },
          m => hMsg(`${BRAND_NAME[brand]}: FBA stock report building… ${m}`));
        const map = {};
        (sd.rows || []).forEach(r => { if (r.sku) map[r.sku] = r.available || 0; });
        await saveStockDoc(brand, map);
        return map;
      };
      try {
        const cached = await readStockDoc();
        if (cached && cached.ageHrs < 24) { stock = cached.map; stockSrc = 'cache'; }
        else { stock = await pullStock(); stockSrc = 'live'; }
      } catch (e) {
        // Quota spent or report failed → fall back to whatever snapshot exists, however old, rather
        // than reverting to the merchant quantity, which would resurrect the false "out of stock".
        try {
          const cached = await readStockDoc();
          if (cached) { stock = cached.map; stockSrc = 'stale cache'; }
        } catch (e2) { /* no stock doc either */ }
        if (!stock) notes.push(`${BRAND_NAME[brand]}: no FBA stock available (${e.message || e}) — quantities left unknown`);
      }

      // (b) The listings report — status and fulfilment channel.
      hMsg(`${BRAND_NAME[brand]}: asking Amazon to build the listings report…`);
      const done = await pollReport({ lh: 'create', brand }, { lh: 'poll', brand },
        m => hMsg(`${BRAND_NAME[brand]}: listings report building… ${m}`));

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
      all.forEach(r => { if (r.asin && r.title) pNames[r.asin] = String(r.title).slice(0, 80); });

      const mfn = all.filter(r => !H_FBA_RE.test(r.channel || '')).length;
      const fbaRows = all.filter(r => H_FBA_RE.test(r.channel || ''));
      const bundles = fbaRows.filter(r => H_BUNDLE_RE.test(r.sku || '')).length;
      let rows = fbaRows.filter(r => !H_BUNDLE_RE.test(r.sku || ''));

      // (d) Join real stock in by SKU.
      let matched = 0;
      rows.forEach(r => {
        if (stock && stock[r.sku] !== undefined) { r.qty = stock[r.sku]; matched++; }
        else if (stock) r.qty = null;            // FBA listing absent from the stock report = unknown
      });

      // Keep any content we already have for these ASINs — the sweep below refreshes it, but if the
      // sweep is interrupted the old content is better than none.
      // The date it was read comes with it, or every refresh would forget which listings it had just re-read.
      // A+ comes along too (2026-10-03): it used to be dropped here, so every refresh started A+ from nothing and the
      // listings past the first 1,500 were left "unknown" after each one.
      const prev = {}, prevAt = {}, prevAp = {};
      (HEALTH[brand]?.rows || []).forEach(r => {
        if (r.content) { prev[r.asin] = r.content; prevAt[r.asin] = r.checked || 0; }
        if (r.aplus !== undefined) prevAp[r.asin] = { v: r.aplus, at: r.aplusAt || 0 };
      });
      rows = rows.map(r => ({ ...r, content: prev[r.asin] || null, checked: prevAt[r.asin] || 0,
        aplus: prevAp[r.asin] ? prevAp[r.asin].v : undefined, aplusAt: prevAp[r.asin] ? prevAp[r.asin].at : 0 }));

      HEALTH[brand] = { rows, at: new Date(), contentAt: HEALTH[brand]?.contentAt || null,
        parentNames: pNames,                    // must survive this reassignment
        scope: { total: all.length, mfn, bundles, kept: rows.length, matched, stockSrc },
        schema: { headers: done.headers || [], sample: done.sample || {},
          withPrice: done.withPrice || 0, withQty: done.withQty || 0, n: done.total || all.length } };
      notes.push(`${BRAND_NAME[brand]}: ${rows.length} FBA listings (removed ${mfn} MFN, ${bundles} bundles)`
        + (stock ? ` · stock matched ${matched}/${rows.length} (${stockSrc})` : ''));
      await saveHealthCache(brand);
      renderHealth();
    } catch (e) { failed.push(`${BRAND_NAME[brand]}: ${e.message || e}`); }
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
    const seen = new Set(), fresh = { SP: [], CPC: [] }, empty = { SP: [], CPC: [] }, suspect = { SP: [], CPC: [] }, stale = { SP: [], CPC: [] };
    const readAt = {};
    ['SP', 'CPC'].forEach(b => (HEALTH[b]?.rows || []).forEach(r => {
      if (!r.asin || seen.has(r.asin)) return;
      seen.add(r.asin);
      readAt[r.asin] = r.checked || 0;
      (r.content ? (r.content.images ? stale : suspect) : (r.tried ? empty : fresh))[b].push(r.asin);
    }));
    ['SP', 'CPC'].forEach(b => stale[b].sort((x, y) => readAt[x] - readAt[y]));
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
    const CHUNK = 20;
    const cut = b => {
      const list = work.filter(w => w.brand === b).map(w => w.asin), out = [];
      for (let i = 0; i < list.length; i += CHUNK) out.push({ brand: b, asins: list.slice(i, i + CHUNK) });
      return out;
    };
    const bSP = cut('SP'), bCPC = cut('CPC'), batches = [];
    for (let i = 0; i < Math.max(bSP.length, bCPC.length); i++) {
      if (bSP[i]) batches.push(bSP[i]);
      if (bCPC[i]) batches.push(bCPC[i]);
    }

    let swept = 0;
    for (let i = 0; i < batches.length; i += H_SWEEP_PAR) {
      const grp = batches.slice(i, i + H_SWEEP_PAR);
      swept += grp.reduce((s, b) => s + b.asins.length, 0);
      hMsg(`Checking listing content… ${swept} / ${work.length} ASINs`);
      /* A batch that fails (Amazon's 429 under three calls at once) is tried ONCE more on its own (2026-10-03): it was
       * simply skipped, which is how RTME-S-001-1420 kept "no image" through a refresh while Amazon had one. */
      const ask = b => baCall({ lh: 'content', brand: b.brand, asins: b.asins.join(',') }).catch(() => null);
      const results = await Promise.all(grp.map(ask));
      for (let k = 0; k < grp.length; k++) {
        if (results[k] && results[k].ok !== false) continue;
        await new Promise(res => setTimeout(res, 1500));
        results[k] = await ask(grp[k]);
      }
      const got = Object.assign({}, ...results.filter(Boolean).map(d => d.content || {}));
      // Mark everything in this group as ATTEMPTED, whether or not Amazon had data for it. An ASIN
      // the catalog knows nothing about is a different thing from one that was never looked at, and
      // conflating them is why the tab could claim "every ASIN has now been checked" while still
      // reporting hundreds as unchecked.
      const asked = new Set(grp.flatMap(b => b.asins));
      ['SP', 'CPC'].forEach(b => (HEALTH[b]?.rows || []).forEach(r => {
        if (got[r.asin]) { r.content = got[r.asin]; r.checked = Date.now(); }
        if (asked.has(r.asin)) r.tried = true;
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
        const want = [...new Set(rows.map(r => r.parent).filter(p => p && !names[p]))];
        for (let i = 0; i < want.length; i += 20 * H_SWEEP_PAR) {
          const grp = [];
          for (let j = i; j < Math.min(i + 20 * H_SWEEP_PAR, want.length); j += 20) grp.push(want.slice(j, j + 20));
          hMsg(`${BRAND_NAME[brand]}: reading parent names… ${Math.min(i + 20 * H_SWEEP_PAR, want.length)} / ${want.length}`);
          const res = await Promise.all(grp.map(b =>
            baCall({ lh: 'content', brand, asins: b.join(',') }).catch(() => null)));
          res.filter(Boolean).forEach(d => Object.entries(d.content || {}).forEach(([asin, c]) => {
            if (c && c.title) names[asin] = String(c.title).slice(0, 80);
          }));
        }
      }
    } catch (e) { notes.push('parent names: ' + (e.message || e)); }

    // Phase 3 — A+ content, asked per ASIN via publish records (the authoritative answer).
    try {
      for (const brand of ['SP', 'CPC']) {
        if (!HEALTH[brand]?.rows?.length) continue;
        /* A+ IS ASKED AGAIN (2026-10-03, Ravi: "A+ wala bhi theek kar do"). An answer used to be final: once a listing
         * read "A+ missing" it stayed missing after the A+ went live. Now: never asked first, then the ones that read
         * MISSING (oldest answer first — those are the ones on a fix-it list), then the ones that have it, oldest first.
         * A lookup that fails keeps the last answer instead of going back to unknown. */
        const seenA = new Set(), never = [], missing = [], present = [], askedAt = {};
        HEALTH[brand].rows.forEach(r => {
          if (!r.asin || seenA.has(r.asin)) return;
          seenA.add(r.asin);
          askedAt[r.asin] = r.aplusAt || 0;
          (r.aplus === undefined ? never : r.aplus === false ? missing : present).push(r.asin);
        });
        const byAge = (x, y) => askedAt[x] - askedAt[y];
        const uniq = [...never, ...missing.sort(byAge), ...present.sort(byAge)];
        if (!uniq.length) continue;

        const work = uniq.slice(0, H_APLUS_MAX);
        // Index once. Scanning every row per answered ASIN would be ~3M comparisons on this catalogue.
        const byAsin = {};
        HEALTH[brand].rows.forEach(r => { (byAsin[r.asin] = byAsin[r.asin] || []).push(r); });
        const CH = 10, errs = [];
        let done = 0, roleMissing = false, answered = 0;
        for (let i = 0; i < work.length; i += CH * H_SWEEP_PAR) {
          const grp = [];
          for (let j = i; j < Math.min(i + CH * H_SWEEP_PAR, work.length); j += CH) grp.push(work.slice(j, j + CH));
          hMsg(`${BRAND_NAME[brand]}: checking A+ content… ${Math.min(i + CH * H_SWEEP_PAR, work.length)} / ${work.length}`);
          const res = await Promise.all(grp.map(b =>
            baCall({ lh: 'aplusasin', brand, asins: b.join(',') }).catch(() => null)));
          res.filter(Boolean).forEach(d => {
            if (d.roleMissing) roleMissing = true;
            (d.errors || []).forEach(e => { if (errs.length < 3) errs.push(e); });
            Object.entries(d.map || {}).forEach(([asin, has]) => {
              answered++;
              (byAsin[asin] || []).forEach(r => { r.aplus = has; r.aplusAt = Date.now(); });
            });
          });
          done += grp.reduce((s, b) => s + b.length, 0);
        }

        // An ASIN we could not read stays undefined — "could not tell" must never harden into
        // "missing", which is what would put a perfectly good listing on a fix-it list.
        const withA = HEALTH[brand].rows.filter(r => r.aplus === true).length;
        const without = HEALTH[brand].rows.filter(r => r.aplus === false).length;
        const unknown = HEALTH[brand].rows.filter(r => r.aplus === undefined).length;
        if (roleMissing && !answered) {
          notes.push(`${BRAND_NAME[brand]}: A+ could not be read — the SP-API app does not have the A+ Content role. Left as unknown.`);
        } else {
          HEALTH[brand].aplusChecked = true;
          notes.push(`${BRAND_NAME[brand]}: A+ present on ${withA}, missing on ${without}, unknown ${unknown}`
            + (uniq.length > work.length ? ` — ${uniq.length - work.length} not re-asked this time; the next refresh starts with them` : '')
            + (errs.length ? ` · errors: ${errs.join(' | ')}` : ''));
        }
      }
    } catch (e) { notes.push('A+ check: ' + (e.message || e)); }

    ['SP', 'CPC'].forEach(b => { if (HEALTH[b]) HEALTH[b].contentAt = new Date(); });
    for (const b of ['SP', 'CPC']) if (HEALTH[b]) await saveHealthCache(b);
    // A cap is information, not a failure — it used to be pushed in with the errors and turned the
    // whole message red, making a successful run look broken.
    if (capped) notes.push(`content checked for ${H_CONTENT_MAX} of ${queue.length} ASINs`
      + (neverChecked > H_CONTENT_MAX ? ` — ${neverChecked - H_CONTENT_MAX} still never checked; refresh again and it resumes from those`
                                      : ' — every ASIN has now been checked at least once'));
  } catch (e) { failed.push('content sweep: ' + (e.message || e)); }

  renderHealth();
  // Only PROBLEMS stay on screen. The per-brand counts are informational and used to sit there as a
  // permanent wall of text — they're kept under "Raw fields" instead.
  H_LAST_RUN = notes;
  const quota = failed.some(f => /429|QuotaExceeded/i.test(f));
  hMsg(quota
    ? 'Amazon’s report quota is used up (it allows about one report a minute). Wait ~10 minutes and refresh again — the snapshot below is the last successful pull.'
    : failed.join('  ·  '), failed.length > 0);
  btn.disabled = false; btn.textContent = 'Refresh both brands';
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
$('hViewParent').onclick = () => { H_FOCUS = null; H_VIEW = 'parent'; H_SORT = { k: 'critical', dir: -1 }; renderHealth(); };
$('hViewChild').onclick = () => { H_FOCUS = null; H_VIEW = 'child'; H_SORT = { k: 'score', dir: 1 }; renderHealth(); };

/* ONE PARENT, ON THE PAGE (Ravi, 15 Sept): clicking a Parent ASIN no longer opens a pop-up. It opens the
 * child table itself, holding only that parent's children, with a bar naming the parent and a way back. */
let H_FOCUS = null;           // { brand, parent } while one parent's children are open
function hFocusOpen(brand, parent) {
  H_FOCUS = { brand, parent };
  H_VIEW = 'child';
  H_SORT = { k: 'sevRank', dir: -1 };
  $('hIssueView').value = 'ALL';
  $('hFilter').value = '';
  renderHealth();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function hFocusBar(brands) {
  const bar = $('hFocus');
  if (!H_FOCUS || H_VIEW !== 'child' || !brands.includes(H_FOCUS.brand)) { bar.classList.add('hide'); bar.innerHTML = ''; return; }
  const kids = ((HEALTH[H_FOCUS.brand] && HEALTH[H_FOCUS.brand].rows) || [])
    .filter(r => (r.parent || r.asin || r.sku) === H_FOCUS.parent).map(r => Object.assign({}, r, { brand: H_FOCUS.brand }));
  const hc = hCtx(), t = { critical: 0, action: 0, review: 0, healthy: 0, monitor: 0, unchecked: 0 };
  kids.forEach(r => { t[healthOf(r, hc).bucket]++; });
  const name = parentName(H_FOCUS.brand, H_FOCUS.parent, kids[0] && kids[0].title);
  bar.classList.remove('hide');
  bar.innerHTML = `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <button id="hFocusBack" class="ghost">← All parents</button>
      <div style="flex:1 1 280px;min-width:0">
        <div style="font-weight:700;font-size:16px">${lrEsc(name || H_FOCUS.parent)}</div>
        <div class="muted" style="font-size:12.5px"><span style="font-family:ui-monospace,monospace">${lrEsc(H_FOCUS.parent)}</span> · ${lrEsc(BRAND_NAME[H_FOCUS.brand] || H_FOCUS.brand)} · ${kids.length} children
          · <span class="sev sev-c"></span>${t.critical} critical · <span class="sev sev-a"></span>${t.action} attention · <span class="sev sev-r"></span>${t.review} review
          · <span class="sev sev-g"></span>${t.healthy + t.monitor} healthy${t.unchecked ? ` · ${t.unchecked} not checked` : ''}</div>
      </div>
      <button id="hFocusOpt" class="ghost">Title optimiser ↗</button>
    </div>`;
  $('hFocusBack').onclick = () => { H_FOCUS = null; H_VIEW = 'parent'; H_SORT = { k: 'critical', dir: -1 }; renderHealth(); };
  $('hFocusOpt').onclick = () => window.open(H_OPTIMISER_URL, '_blank', 'noopener');
}

function renderHealth() {
  $('hViewParent').classList.toggle('on', H_VIEW === 'parent');
  $('hViewChild').classList.toggle('on', H_VIEW === 'child');
  const pick = $('hBrandView').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]).filter(b => HEALTH[b]);
  if (!brands.length) {
    $('hResult').classList.remove('hide');
    $('hKpis').innerHTML = '<div class="kpi"><div class="kpiname">No snapshot yet</div>'
      + '<div class="muted" style="margin-top:6px">Hit “Refresh both brands” to pull your listings from Amazon.</div></div>';
    $('hTable').innerHTML = '';
    return;
  }
  const multiBrand = brands.length > 1;
  hFocusBar(brands);
  let rows = brands.flatMap(b => HEALTH[b].rows.map(r => ({ ...r, brand: b })));
  const hc = hCtx();
  rows.forEach(r => { const h = healthOf(r, hc); r._h = h; r.score = h.score; r.grade = h.grade; });

  // "Inactive" contains the substring "active", so the active test must exclude it explicitly —
  // the same trap healthOf has to avoid.
  const isActive = r => /active/i.test(r.status || '') && !/inactive/i.test(r.status || '');
  const view = $('hIssueView').value;
  // One predicate, used two ways: in child view it picks ROWS, in parent view it picks which
  // PARENTS to show (any parent with at least one matching child) while the counts still describe
  // all of that parent's children.
  const PRED = {
    critical: r => r._h.bucket === 'critical',
    action: r => r._h.bucket === 'action',
    review: r => r._h.bucket === 'review',
    healthy: r => r._h.bucket === 'healthy',
    monitor: r => r._h.bucket === 'monitor',
    unchecked: r => r._h.bucket === 'unchecked',
    active: isActive,
    inactive: r => !isActive(r),
    // These three ask about a KNOWN fact, so rows that were never checked are excluded rather than
    // swept in as if they were missing.
    noimg: r => r.content && !r.content.images,
    fewimg: r => r.content && r.content.images < H_RULES.minImages,
    noaplus: r => r.aplus === false,
  }[view] || null;

  const q = $('hFilter').value.trim().toLowerCase();
  const textOf = r => ((r.sku || '') + ' ' + (r.asin || '') + ' ' + (r.parent || '') + ' ' + (r.title || '')).toLowerCase();
  const reasonText = r => {
    const h = r._h;
    return [...h.critical, ...h.action, ...h.review].join(' · ') || (r.content ? 'Nothing found' : 'Content not checked');
  };

  const defs = [];

  if (H_VIEW === 'parent') {
    // Roll children up under their parent. A listing with no parent ASIN is its own group rather
    // than being dropped or lumped into one giant "no parent" bucket.
    const g = {};
    rows.forEach(r => {
      const key = (r.parent || r.asin || r.sku) + '|' + r.brand;
      const o = g[key] || (g[key] = { parent: r.parent || r.asin || '—', brand: r.brand,
        title: r.title, kids: [], standalone: !r.parent });
      o.kids.push(r);
    });
    // A name the user typed wins over Amazon's; then the seller's own listing name; then a child's
    // title marked "~". parentName() holds that order for all three tabs.
    Object.values(g).forEach(o => { o.title = parentName(o.brand, o.parent, o.title); });
    let groups = Object.values(g).map(o => {
      const k = o.kids;
      const n = b => k.filter(x => x._h.bucket === b).length;
      const checked = k.filter(x => x._h.bucket !== 'unchecked');
      return Object.assign(o, {
        children: k.length,
        critical: n('critical'), action: n('action'), review: n('review'), healthy: n('healthy') + n('monitor'), unchecked: n('unchecked'),
        // Averaged over the children that were checked: an unread listing has no health to average in.
        score: checked.length ? Math.round(checked.reduce((s, x) => s + x.score, 0) / checked.length) : null,
      });
    });
    // The filter selects PARENTS via their children; the counts above stay whole.
    if (PRED) groups = groups.filter(o => o.kids.some(PRED));
    if (q) groups = groups.filter(o => (o.parent || '').toLowerCase().includes(q)
      || (o.title || '').toLowerCase().includes(q) || o.kids.some(x => textOf(x).includes(q)));
    rows = groups;

    defs.push({ k: 'title', t: 'Parent', trunc: 38,
      cell: r => parentNameCell(r.brand, r.parent, r.title, 38),
      tip: "Click a name to set your own — once saved, refreshes never change it. Otherwise the seller's own listing name, or a child's title marked ~." });
    if (multiBrand) defs.push({ k: 'brand', t: 'Brand', map: r => BRAND_NAME[r.brand] });
    defs.push({ k: 'children', t: 'Children', num: 1,
      tip: 'Child listings under this parent. Critical + Needs Action + Needs Review + Healthy = the children that were checked; the rest are "not checked yet".' });
    /* IN COLOUR (2026-10-03, Ravi: "parent wale data ko bhi colorful kar dena"): each count carries its bucket's dot,
     * a zero stays grey, Health is green / amber / red, and the same five areas as the child table show the worst
     * colour among the children with how many children it hits. */
    const cnt = cls => r => {
      const v = r[cls.k];
      return v ? `<span class="sev ${cls.c}"></span><b>${Number(v).toLocaleString('en-US')}</b>` : '<span class="muted">0</span>';
    };
    defs.push({ k: 'critical', t: 'Critical', num: 1, cell: cnt({ k: 'critical', c: 'sev-c' }),
      tip: 'Cannot be bought or is fundamentally wrong: stock at Amazon but Inactive, no price, or no main image.' });
    defs.push({ k: 'action', t: 'Needs Action', num: 1, cell: cnt({ k: 'action', c: 'sev-a' }),
      tip: 'A+ missing, under 6 images, under 5 bullets, or a size in the title not written "14 x 36 Inch" / written larger-first.' });
    defs.push({ k: 'review', t: 'Needs Review', num: 1, cell: cnt({ k: 'review', c: 'sev-r' }),
      tip: '6–7 images when 8 is ideal, a thin or missing description, or a title outside 80–200 characters.' });
    defs.push({ k: 'healthy', t: 'Healthy', num: 1, cell: cnt({ k: 'healthy', c: 'sev-g' }), tip: 'Checked, and none of the checks found anything.' });
    ['Title', 'Size', 'Variation', 'Images', 'Content'].forEach(a => defs.push({ k: 'parea' + a, t: a, noTotal: 1,
      map: r => r.kids.reduce((m, x) => { const f = hAreaSev(x._h, a); return Math.max(m, f ? LR_SEV[f.sev].rank : 0); }, 0),
      cell: r => {
        let worst = null, hit = 0;
        r.kids.forEach(x => {
          const f = hAreaSev(x._h, a);
          if (!f) return;
          hit++;
          if (!worst || LR_SEV[f.sev].rank > LR_SEV[worst].rank) worst = f.sev;
        });
        if (!worst) return r.kids.some(x => x._h.bucket !== 'unchecked') ? '<span class="sev-ok">✓</span>' : '<span class="muted">—</span>';
        return `<span class="sev ${LR_SEV[worst].cls}" title="${hit} of ${r.kids.length} children have a ${a.toLowerCase()} issue; the worst is ${LR_SEV[worst].label}"></span>`
          + `<span class="muted" style="font-size:12px">${hit}</span>`;
      },
      tip: `The worst ${a.toLowerCase()} issue among the children, and how many children have one. ✓ = none of the checked children has one.` }));
    defs.push({ k: 'score', t: 'Health', num: 1, noTotal: 1,
      cell: r => r.score == null ? '<span class="muted">—</span>'
        : `<b style="color:${r.score >= 80 ? '#15803D' : r.score >= 50 ? '#B45309' : 'var(--bad,#b91c1c)'}">${r.score}</b>`,
      tip: 'Average health of the checked children: 100 − 40 per critical issue − 10 per action − 3 per review. Green 80+, amber 50–79, red under 50.' });
    defs.push({ k: 'parent', t: 'Parent ASIN', mono: 1, noTotal: 1,
      cell: r => `<span data-hkid="${String(r.brand).replace(/"/g, '')}|${String(r.parent).replace(/[<>&"]/g, '')}" style="font-family:ui-monospace,monospace;cursor:pointer;text-decoration:underline dotted" title="Open this parent's children">${String(r.parent).replace(/[<>&"]/g, '')}</span>`,
      tip: 'Click a Parent ASIN to open all of its child listings — what each one fails and passes.' });
  } else {
    if (H_FOCUS && brands.includes(H_FOCUS.brand))
      rows = rows.filter(r => r.brand === H_FOCUS.brand && (r.parent || r.asin || r.sku) === H_FOCUS.parent);
    if (PRED) rows = rows.filter(PRED);
    if (q) rows = rows.filter(r => textOf(r).includes(q));

    /* SKU / ASIN · Status · Severity · Issues · Inventory · Title · Size · Variation · Images — Ravi's drawing —
     * then Content (A+, bullets, description), Health, the reasons, and a suggested title where one applies.
     * A coloured dot is the worst issue in that area; ✓ is judged and fine; — could not be judged. */
    defs.push({ k: 'sku', t: 'SKU / ASIN', frz: 1,
      cell: r => `<div style="font-family:ui-monospace,monospace">${lrEsc(r.sku)}</div><div class="muted" style="font-family:ui-monospace,monospace;font-size:11px">${lrEsc(r.asin || '')}</div>` });
    if (multiBrand) defs.push({ k: 'brand', t: 'Brand', map: r => BRAND_NAME[r.brand] });
    defs.push({ k: 'lstatus', t: 'Status', noTotal: 1,
      map: r => r.qty === 0 ? 'OOS' : (/inactive/i.test(r.status || '') ? 'Inactive' : (/active/i.test(r.status || '') ? 'Active' : (r.status || '—'))) });
    defs.push({ k: 'sevRank', t: 'Severity', noTotal: 1,
      map: r => ({ critical: 5, action: 4, review: 3, unchecked: 2, monitor: 1, healthy: 0 })[r._h.bucket], cell: r => hSevCell(r._h.bucket) });
    defs.push({ k: 'issueCount', t: 'Issues', num: 1, map: r => r._h.found.length });
    defs.push({ k: 'qty', t: 'Inventory', num: 1 });
    ['Title', 'Size', 'Variation', 'Images', 'Content'].forEach(a => defs.push({ k: 'area' + a, t: a, noTotal: 1,
      map: r => { const f = hAreaSev(r._h, a); return f ? LR_SEV[f.sev].rank : 0; }, cell: r => hAreaCell(r, a) }));
    defs.push({ k: 'score', t: 'Health', num: 1, bold: 1, noTotal: 1 });
    defs.push({ k: 'title', t: 'Title text', trunc: 38 });
    defs.push({ k: 'issues', t: 'Why', map: reasonText, trunc: 60 });
    defs.push({ k: 'suggest', t: '', noTotal: 1, map: () => '',
      cell: r => (r._h.found.some(f => f.area === 'Title' || f.area === 'Size' || f.area === 'Variation') && lrTemplateFor(r, LR || LR_DEFAULT))
        ? `<button class="ghost" data-hsug="${lrEsc(r.brand)}|${lrEsc(r.sku)}" style="padding:2px 8px;font-size:12px;white-space:nowrap">Suggest title</button>` : '' });
  }

  const val = (r, d) => (d.map ? d.map(r) : r[d.k]);
  // Parent view leads with the parents that need the most work; child view with the worst listings.
  const sd = defs.find(d => d.k === H_SORT.k)
    || defs.find(d => d.k === (H_VIEW === 'parent' ? 'critical' : 'score'));
  rows.sort((a, b) => {
    const x = val(a, sd), y = val(b, sd);
    const c = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x || '').localeCompare(String(y || ''));
    return c * H_SORT.dir;
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

  const n = v => (v == null || v === '' ? '<span class="muted">—</span>' : Number(v).toLocaleString('en-US'));
  const money = v => (v ? '$' + Number(v).toFixed(2) : '<span class="muted">—</span>');
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const arrow = d => d.k === H_SORT.k ? (H_SORT.dir < 0 ? ' ↓' : ' ↑') : '';
  const gradeCls = g => g === 'Good' ? 'gd-good' : g === 'Needs work' ? 'gd-warn' : 'gd-bad';

  const head = '<thead><tr>' + defs.map(d =>
    `<th data-k="${esc(d.k)}" class="${d.frz ? 'frz ' : ''}${d.num ? 'num' : ''}"${
      d.tip ? ` title="${esc(d.tip)}"` : ''}>${esc(d.t)}${arrow(d)}</th>`).join('') + '</tr></thead>';

  const body = shown.map(r => '<tr>' + defs.map(d => {
    const v = val(r, d);
    const cls = (d.frz ? 'frz ' : '') + (d.num ? 'num' : '');
    if (d.cell) return `<td class="${cls}">${d.cell(r)}</td>`;
    if (d.k === 'grade') return `<td class="${cls}">${esc(v)}</td>`;
    if (d.num && d.bold) return `<td class="${cls}" style="font-weight:700">${n(v)}</td>`;
    if (d.k === 'score') return `<td class="${cls}" style="font-weight:700">${n(v)}</td>`;
    if (d.money) return `<td class="${cls}">${money(v)}</td>`;
    if (d.num) return `<td class="${cls}">${n(v)}</td>`;
    if (d.trunc) return `<td class="${cls}" title="${esc(v)}">${esc(String(v || '').slice(0, d.trunc))}</td>`;
    return `<td class="${cls}" style="${d.mono ? 'font-family:ui-monospace,monospace' : ''}">${esc(v) || '<span class="muted">—</span>'}</td>`;
  }).join('') + '</tr>').join('');

  // Only quantities are meaningful to add up — a summed score or price would be nonsense, so those
  // columns are marked noTotal and left blank in the footer.
  const foot = rows.length ? '<tfoot><tr>' + defs.map((d, i) => {
    if (i === 0) return `<td class="frz">TOTAL · ${rows.length}</td>`;
    if (!d.num || d.noTotal) return '<td></td>';
    const sum = rows.reduce((s, r) => s + (Number(val(r, d)) || 0), 0);
    return `<td class="num">${n(sum)}</td>`;
  }).join('') + '</tr></tfoot>' : '';

  $('hTable').innerHTML = head + '<tbody>' + (body ||
    `<tr><td colspan="${defs.length}" class="muted">No rows.</td></tr>`) + '</tbody>' + foot;

  // The scope and truncation detail moved into "Raw fields" — it was two paragraphs of standing text
  // above every view. The TOTAL row still carries the real count, so the table can't be mistaken for
  // the whole set, and H_SCOPE_NOTE keeps the full explanation one click away.
  H_SCOPE_NOTE = (() => {
    const out = [];
    if (rows.length > shown.length) {
      out.push(`Table shows the top ${shown.length} of ${rows.length.toLocaleString('en-US')} rows (sorted by ${sd.t}); `
        + `totals, cards and Export cover all ${rows.length.toLocaleString('en-US')}.`);
    }
    const scoped = brands.map(b => HEALTH[b]?.scope).filter(Boolean);
    if (scoped.length) {
      const sum = scoped.reduce((a, s) => ({ mfn: a.mfn + s.mfn, bundles: a.bundles + s.bundles,
        matched: a.matched + s.matched, kept: a.kept + s.kept }), { mfn: 0, bundles: 0, matched: 0, kept: 0 });
      out.push(`FBA only — excluded ${sum.mfn.toLocaleString('en-US')} merchant-fulfilled and `
        + `${sum.bundles.toLocaleString('en-US')} bundle SKUs (SKU starting “RB”). `
        + `Quantity from FBA inventory: matched ${sum.matched.toLocaleString('en-US')}/${sum.kept.toLocaleString('en-US')}`
        + (sum.kept > sum.matched ? `; the other ${(sum.kept - sum.matched).toLocaleString('en-US')} show “—”, not a guessed zero.` : '.'));
    }
    return out;
  })();

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
    el.onclick = () => { const v = el.dataset.hsug, i = v.indexOf('|'); hSugOpen(v.slice(0, i), v.slice(i + 1)); };
  });
  if (H_VIEW === 'parent') {
    $('hTable').querySelectorAll('[data-hkid]').forEach(el => {
      el.onclick = () => { const v = el.dataset.hkid, i = v.indexOf('|'); hFocusOpen(v.slice(0, i), v.slice(i + 1)); };
    });
  }
}

