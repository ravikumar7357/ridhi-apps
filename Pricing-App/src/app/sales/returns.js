/* ================= SALES · RETURN SPIKES: inside Sales Alerts (Sales card #3 add-on, 25 Nov 2026) =================
 * Screen: Sales → Sales Alerts — the "↩ Returns data" button (upload), the chip "↩ Return spikes N", the section "↩ Return spikes"
 *   (cards for the critical ones, a row per spike that opens to its details). No page of its own.
 * Data, in this order (rsLoad): 1. the backend cache "returns" (Pricing-API/Returns.gs — written, NOT deployed yet: once it runs
 *   nightly Sellora reads it on its own); 2. the uploads: Amazon's "FBA Customer Returns" report (Seller Central → Reports →
 *   Fulfillment → Customer Returns, .txt / .csv), per brand, kept in the shared history collection as history/returns_<brand>_<n>
 *   (kind 'returns'), chunked like Reimbursement's uploads: chunk 0 holds how many there are, when and who uploaded (the trail).
 *   A re-upload REPLACES the rows it shares a key with (order, SKU, licence plate, date, quantity, reason) — never counted twice.
 *   3. nothing: a small note "Upload the Customer Returns report to see return spikes" — never a made-up number.
 * Does — per family (the Sales Alerts families, through the Forecast's weeks) and per SKU, per Sunday–Saturday week (US Pacific):
 *   return rate  = units returned that week ÷ units sold a week, averaged over that week and the week before (returns come later)
 *   baseline     = the 8 weeks before, pooled (Σ returned ÷ Σ sold), only weeks the returns data covers (at least 4)
 *   SPIKE        = the last week the data covers: rate ≥ 2 × baseline AND ≥ baseline + 3 points AND ≥ 5 units returned
 *   severity     = 🔴 Critical when ≥ 3 × baseline or ≥ 15 %; else 🟡 Watch
 *   each spike   "Returns 3% → 11% in 15–21 Nov (9 units) · top reason: Not as described (6)"; its weekly rate (12 weeks), its reasons,
 *                the latest customer comments (5), the SKUs / sizes it hit, "+ Task" (Action Tracker), "Open listing", Amazon ↗.
 * WRITES only the uploaded rows (history/returns_*) — never on the test site. Reads the sales through the Forecast's loader.
 * Main functions: rsParse, rsMerge, rsCompute (pure), rsLoad, rsSave, rsFor, rsSectionHtml, returnsCheck (console). Names rs / RS.
 * Tests: tests/returns-test.js. */

const RS_CHUNK = 1500;                                       // rows per history/returns_<brand>_<n> document
const RS_M = { base: 8, minBase: 4, times: 2, pts: 0.03, units: 5, critTimes: 3, critRate: 0.15, chart: 12, comments: 5 };
const RS_NEED = ['return-date', 'sku', 'quantity', 'reason'];
const RS_OPT = ['asin', 'customer-comments', 'detailed-disposition', 'order-id', 'license-plate-number', 'fnsku', 'product-name', 'status'];
const RS_REASON = { NOT_AS_DESCRIBED: 'Not as described', DEFECTIVE: 'Defective', QUALITY_UNACCEPTABLE: 'Quality not acceptable', DAMAGED_BY_CARRIER: 'Damaged in transit',
  DAMAGED_BY_FC: 'Damaged at Amazon', UNWANTED_ITEM: 'No longer wanted', ORDERED_WRONG_ITEM: 'Ordered the wrong item', SWITCHEROO: 'Wrong item returned', MISSED_ESTIMATED_DELIVERY: 'Arrived late',
  FOUND_BETTER_PRICE: 'Found a better price', NOT_COMPATIBLE: 'Not compatible', MISSING_PARTS: 'Missing parts', EXTRA_ITEM: 'Extra item', UNDELIVERABLE_UNKNOWN: 'Undeliverable',
  APPAREL_TOO_LARGE: 'Too large', APPAREL_TOO_SMALL: 'Too small', APPAREL_STYLE: 'Style not as expected', NO_REASON_GIVEN: 'No reason given', UNAUTHORIZED_PURCHASE: 'Unauthorised purchase' };
const RS = { uploads: { SP: null, CPC: null }, cache: null, src: '', loaded: false, busy: null, err: '', open: false, upBrand: 'SP', msg: '', memo: {} };
const rsTest = () => typeof sqIsTest === 'function' && sqIsTest();
const rsEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const RS_PT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
const RS_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const rsAdd = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const rsSun = k => rsAdd(k, -new Date(k + 'T00:00:00Z').getUTCDay());
const rsDay = k => (k ? `${+k.slice(8, 10)} ${RS_MON[+k.slice(5, 7) - 1]}` : '—');
/** "15–21 Nov" (or "29 Nov–5 Dec"). */
function rsWeek(wk) { const e = rsAdd(wk, 6); return wk.slice(5, 7) === e.slice(5, 7) ? `${+wk.slice(8, 10)}–${rsDay(e)}` : `${rsDay(wk)}–${rsDay(e)}`; }
const rsPct = v => (v == null || !isFinite(v) ? '—' : v > 0 && v < 0.01 ? (v * 100).toFixed(1) + '%' : Math.round(v * 100) + '%');
const rsReason = r => { const k = String(r || '').trim().toUpperCase().replace(/[\s-]+/g, '_'); return RS_REASON[k] || (k ? k.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : 'No reason given'); };

/* ----- reading the report (pure) ----- */
// A return date → its US Pacific day: a timestamp ("2026-11-17T07:35:12+00:00") is turned into the PT day; a bare date is kept.
function rsDate(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) { const t = Date.parse(s); if (isFinite(t)) return RS_PT.format(new Date(t)); }
  return typeof rbParseDate === 'function' ? rbParseDate(s) : (s.match(/^\d{4}-\d{2}-\d{2}/) || [''])[0];
}
const rsKey = x => [x.o, x.s, x.l, x.d, x.q, x.r].join('|');
/** One uploaded file → { ok, rows: [{ d, s, a, q, r, c, x, o, l }], read, skipped, from, to } or { ok: false, err, missing } — a needed column missing:
 *  refused, naming it (never guessed). */
function rsParse(text, brand) {
  if (brand !== 'SP' && brand !== 'CPC') return { ok: false, err: 'Pick the brand first' };
  const T = typeof rbParseTable === 'function' ? rbParseTable(text) : { head: [], rows: [] };
  if (!T.head.length) return { ok: false, err: 'The file is empty' };
  const head = h => String(h || '').toLowerCase().replace(/[\s_\-]+/g, '');
  const col = {};
  RS_NEED.concat(RS_OPT).forEach(n => { const i = T.head.findIndex(h => head(h) === head(n)); if (i >= 0) col[n] = i; });
  const missing = RS_NEED.filter(n => !(n in col));
  if (missing.length) return { ok: false, missing, err: `Not read: this file has no ${missing.map(n => `"${n}"`).join(', ')} column${missing.length === 1 ? '' : 's'}, so it is not the FBA Customer Returns report. Download it again: Seller Central → Reports → Fulfillment → Customer Returns (.txt).` };
  const g = (r, n) => (n in col ? String(r[col[n]] == null ? '' : r[col[n]]).trim() : '');
  const m = new Map();
  let skipped = 0, from = '', to = '';
  T.rows.forEach(r => {
    const d = rsDate(g(r, 'return-date')), s = g(r, 'sku'), q = Math.round(Number(g(r, 'quantity')) || 0);
    if (!d || !s || q <= 0) { skipped++; return; }
    const x = { d, s, a: g(r, 'asin').toUpperCase(), q, r: g(r, 'reason'), c: g(r, 'customer-comments').slice(0, 300), x: g(r, 'detailed-disposition'), o: g(r, 'order-id'), l: g(r, 'license-plate-number') };
    m.set(rsKey(x), x);
    if (!from || d < from) from = d;
    if (!to || d > to) to = d;
  });
  return { ok: true, rows: [...m.values()], read: T.rows.length, skipped, from, to };
}
/** Kept rows + a new upload → { rows, added, replaced } (a row with the same key is replaced, never added twice). */
function rsMerge(old, fresh) {
  const m = new Map((old || []).map(x => [rsKey(x), x]));
  let replaced = 0;
  (fresh || []).forEach(x => { const k = rsKey(x); if (m.has(k)) replaced++; m.set(k, x); });
  return { rows: [...m.values()].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)), added: (fresh || []).length - replaced, replaced };
}

/* ----- the shared copy: history/returns_<brand>_<n> ----- */
async function rsUploadsLoad() {
  RS.uploads = { SP: RS.uploads.SP && RS.uploads.SP.mem ? RS.uploads.SP : null, CPC: RS.uploads.CPC && RS.uploads.CPC.mem ? RS.uploads.CPC : null };
  try {
    const snap = await getDocs(query(collection(db, 'history'), where('kind', '==', 'returns')));
    const by = { SP: [], CPC: [] };
    snap.forEach(d => { const v = d.data() || {}; if (by[v.brand]) by[v.brand].push(v); });
    ['SP', 'CPC'].forEach(b => {
      const head = by[b].find(p => p.n === 0);
      if (!head) return;
      const parts = by[b].filter(p => p.uploadedAt === head.uploadedAt && p.n < head.of).sort((a, z) => a.n - z.n);
      if (parts.length !== head.of) return;               // an upload still being written: the last whole one next time
      RS.uploads[b] = { brand: b, uploadedAt: head.uploadedAt, of: head.of, trail: head.trail || [], meta: head.meta || {}, rows: parts.flatMap(p => p.rows || []) };
    });
    RS.err = '';
  } catch (e) { RS.err = 'The uploaded returns could not be read (' + ((e && e.code) || (e && e.message) || 'no access') + ').'; }
}
/** Save one brand's rows (already merged): the chunks, then any chunk left from a longer upload is removed. Nothing on the test site. */
async function rsSave(brand, rows, meta) {
  const prev = RS.uploads[brand], at = Date.now(), me = (typeof ME !== 'undefined' && ME && ME.email) || '';
  const trail = ((prev && prev.trail) || []).concat([{ at, by: me, name: typeof sqName === 'function' ? sqName(me) : me, rows: rows.length, file: meta.file || '', added: meta.added, replaced: meta.replaced }]).slice(-20);
  const of = Math.max(1, Math.ceil(rows.length / RS_CHUNK));
  const m = { from: rows.length ? rows[0].d : '', to: rows.length ? rows[rows.length - 1].d : '' };
  const rec = { brand, uploadedAt: at, of, trail, meta: m, rows, mem: rsTest() };
  if (!rsTest()) {
    for (let i = 0; i < of; i++) {
      await setDoc(doc(db, 'history', `returns_${brand}_${i}`), Object.assign({ kind: 'returns', brand, n: i, of, uploadedAt: at, rows: rows.slice(i * RS_CHUNK, (i + 1) * RS_CHUNK) }, i === 0 ? { trail, meta: m } : {}));
    }
    for (let i = of; i < ((prev && prev.of) || 0); i++) { try { await deleteDoc(doc(db, 'history', `returns_${brand}_${i}`)); } catch (e) { /* chunk 0 says how many */ } }
  }
  RS.uploads[brand] = rec;
  RS.memo = {};
  return rec;
}
/** An upload: read → merge with what is kept → save. Returns the words for the page. */
async function rsUpload(brand, text, file) {
  const p = rsParse(text, brand);
  if (!p.ok) return p.err;
  if (!p.rows.length) return 'No returns read from this file (every row lacked a date, SKU or quantity).';
  const kept = (RS.uploads[brand] && RS.uploads[brand].rows) || [];
  const mg = rsMerge(kept, p.rows);
  try { await rsSave(brand, mg.rows, { file, added: mg.added, replaced: mg.replaced }); }
  catch (e) { return 'Not saved: ' + ((e && (e.code || e.message)) || e); }
  return `${({ SP: 'Ridhi', CPC: 'CPC' })[brand]}: ${p.rows.length} returns read (${rsDay(p.from)}–${rsDay(p.to)}) · ${mg.added} new, ${mg.replaced} already there${mg.replaced ? ' (replaced, not counted twice)' : ''}${p.skipped ? ` · ${p.skipped} rows without a date / SKU / quantity skipped` : ''}${rsTest() ? ' · test site: kept in this visit only' : ''}.`;
}
/** The returns rows per brand and how far they reach: the backend cache when it exists, else the uploads. */
function rsData() {
  if (RS.cache) return RS.cache;
  const out = { src: 'upload', d: {}, cover: {} };
  ['SP', 'CPC'].forEach(b => { const u = RS.uploads[b]; if (u && u.rows.length) { out.d[b] = u.rows; out.cover[b] = { from: u.meta.from || u.rows[0].d, to: u.meta.to || u.rows[u.rows.length - 1].d, at: u.uploadedAt, by: (u.trail[u.trail.length - 1] || {}).name || '' }; } });
  return out;
}
async function rsLoad(force) {
  if (RS.busy) return RS.busy;
  if (RS.loaded && !force) return null;
  RS.busy = (async () => {
    const jobs = [rsUploadsLoad()];
    jobs.push((async () => {                                 // 1. the backend cache "returns" (not written until Returns.gs runs)
      try {
        if (typeof alApiReady === 'function') await alApiReady();
        const r = typeof baCall === 'function' ? await baCall({ cache: 'returns' }) : null;
        const c = r && r.data && r.data.d;
        if (c && Object.values(c).some(v => Array.isArray(v) && v.length)) {
          const d = {}, cover = {};
          Object.keys(c).forEach(b => {
            d[b] = (c[b] || []).map(v => (Array.isArray(v) ? { d: v[0], s: v[1], a: v[2], q: Number(v[3]) || 0, r: v[4], c: v[5] || '', x: v[6] || '', o: v[7] || '', l: v[8] || '' } : v)).filter(x => x.d && x.s && x.q > 0);
            const ds = d[b].map(x => x.d).sort();
            cover[b] = { from: r.data.from || ds[0] || '', to: r.data.to || ds[ds.length - 1] || '', at: r.data.at || '', by: 'nightly' };
          });
          RS.cache = { src: 'backend', d, cover };
        } else RS.cache = null;
      } catch (e) { RS.cache = null; }
    })());
    if (typeof foLoad === 'function') jobs.push(foLoad().catch(() => {}));   // the weekly units per family / SKU (the Forecast's weeks)
    await Promise.all(jobs);
    RS.loaded = true;
    RS.memo = {};
  })().finally(() => { RS.busy = null; });
  return RS.busy;
}

/* ----- THE MATHS (pure) ----- */
/** o = { fams: [{ key, brand, parent, name, kids: [{ asin, skus, label, s: [{ wk, u }] }] }], data: { d: brand→rows, cover: brand→{from, to} }, brand }.
 *  → { ok, items (spikes, worst first), rows (every family judged), noData, upTo, week } */
function rsCompute(o) {
  const brands = o.brand === 'ALL' ? ['SP', 'CPC'] : [o.brand];
  const data = o.data || { d: {}, cover: {} };
  const has = brands.filter(b => (data.d[b] || []).length);
  if (!has.length) return { ok: true, noData: true, items: [], rows: [], brands };
  const out = { ok: true, noData: false, items: [], rows: [], brands, upTo: {}, week: {} };
  has.forEach(b => { out.upTo[b] = data.cover[b].to; });
  // returns by brand → asin (a SKU → its ASIN through the families' children) → week
  const famsB = (o.fams || []).filter(f => has.includes(f.brand));
  const skuAsin = {};
  famsB.forEach(f => f.kids.forEach(k => (k.skus || []).forEach(s => { skuAsin[f.brand + '|' + s] = k.asin; })));
  const ret = {};                                            // brand|asin → wk → { q, rows: [] }
  has.forEach(b => (data.d[b] || []).forEach(x => {
    const a = (x.a || skuAsin[b + '|' + x.s] || '').toUpperCase();
    if (!a) return;
    const wk = rsSun(x.d), c = ((ret[b + '|' + a] || (ret[b + '|' + a] = {}))[wk] || (ret[b + '|' + a][wk] = { q: 0, rows: [] }));
    c.q += x.q; c.rows.push(x);
  }));
  famsB.forEach(f => {
    const cv = data.cover[f.brand];
    const weeks = (f.kids[0] && f.kids[0].s ? f.kids[0].s.map(x => x.wk) : []);
    if (!weeks.length) return;
    const covered = wk => wk >= rsSun(cv.from) && rsAdd(wk, 6) <= cv.to && (wk > rsSun(cv.from) || cv.from === wk);
    // the week judged: the last week both the sales and the returns data hold whole
    const J = weeks.filter(covered).pop();
    if (!J) return;
    out.week[f.brand] = out.week[f.brand] && out.week[f.brand] > J ? out.week[f.brand] : J;
    const one = kids => {
      const sold = wk => kids.reduce((s, k) => s + ((k.s.find(x => x.wk === wk) || {}).u || 0), 0);
      const back = wk => kids.reduce((s, k) => s + ((ret[f.brand + '|' + k.asin] || {})[wk] || { q: 0 }).q, 0);
      const den = wk => (sold(wk) + sold(rsAdd(wk, -7))) / 2;
      const series = weeks.filter(wk => wk <= J && covered(wk)).map(wk => ({ wk, sold: sold(wk), den: den(wk), q: back(wk), rate: den(wk) > 0 ? back(wk) / den(wk) : null }));
      const now = series[series.length - 1];
      const baseW = series.slice(0, -1).slice(-RS_M.base).filter(w => w.den > 0);
      const bq = baseW.reduce((s, w) => s + w.q, 0), bd = baseW.reduce((s, w) => s + w.den, 0);
      const base = baseW.length >= RS_M.minBase && bd > 0 ? bq / bd : null;
      return { series, now, base, baseWeeks: baseW.length };
    };
    const fam = one(f.kids);
    if (!fam.now) return;
    const rowsJ = f.kids.flatMap(k => (((ret[f.brand + '|' + k.asin] || {})[J] || { rows: [] }).rows));
    const reasons = {};
    rowsJ.forEach(x => { const r = rsReason(x.r); reasons[r] = (reasons[r] || 0) + x.q; });
    const rs = Object.entries(reasons).map(([t, n]) => ({ t, n })).sort((a, b) => b.n - a.n || a.t.localeCompare(b.t));
    const allRows = f.kids.flatMap(k => Object.values(ret[f.brand + '|' + k.asin] || {}).flatMap(c => c.rows));
    const comments = allRows.filter(x => x.c && x.d <= cv.to).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0)).slice(0, RS_M.comments).map(x => ({ d: x.d, s: x.s, t: x.c, r: rsReason(x.r) }));
    const kidsOut = f.kids.map(k => { const r = one([k]); return { asin: k.asin, sku: (k.skus || [])[0] || k.asin, label: k.label || (k.skus || [])[0] || k.asin, q: r.now ? r.now.q : 0, rate: r.now ? r.now.rate : null, base: r.base,
      spike: rsIsSpike(r.now, r.base) }; }).filter(k => k.q > 0).sort((a, b) => b.q - a.q);
    const spike = rsIsSpike(fam.now, fam.base);
    const row = { key: f.key, brand: f.brand, parent: f.parent, name: f.name, week: J, now: fam.now.rate, q: fam.now.q, sold: fam.now.den, base: fam.base, baseWeeks: fam.baseWeeks, series: fam.series.slice(-RS_M.chart),
      reasons: rs, comments, kids: kidsOut, spike, why: fam.base == null ? `fewer than ${RS_M.minBase} weeks of returns data before ${rsWeek(J)}` : '' };
    out.rows.push(row);
    if (!spike) return;
    row.sev = fam.now.rate >= RS_M.critRate || (fam.base > 0 && fam.now.rate >= RS_M.critTimes * fam.base) ? 'critical' : 'watch';
    row.id = `rs|${f.key}|${J}`;
    row.head = `Returns ${rsPct(fam.base)} → ${rsPct(fam.now.rate)} in ${rsWeek(J)} (${fam.now.q} unit${fam.now.q === 1 ? '' : 's'})${rs[0] ? ` · top reason: ${rs[0].t} (${rs[0].n})` : ''}`;
    out.items.push(row);
  });
  out.items.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'critical' ? -1 : 1) || (b.now - b.base) - (a.now - a.base) || b.q - a.q);
  out.rows.sort((a, b) => b.q - a.q);
  return out;
}
/** A spike: ≥ 2 × the baseline, ≥ 3 points above it, ≥ 5 units returned (and a baseline to judge against). */
function rsIsSpike(now, base) {
  return !!now && base != null && now.rate != null && now.q >= RS_M.units && now.rate >= RS_M.times * base && now.rate - base >= RS_M.pts;
}
/** The result for a view (SP, CPC, ALL), worked out once per data version. */
function rsFor(brand) {
  if (!RS.loaded) return null;
  const k = brand + '@' + (typeof FO !== 'undefined' ? FO.v : '') + '@' + (RS.cache ? 'c' : 'u') + '@' + ['SP', 'CPC'].map(b => (RS.uploads[b] || {}).uploadedAt || 0).join(',');
  if (RS.memo[brand] && RS.memo[brand].k === k) return RS.memo[brand].r;
  let r;
  try {
    const fams = [];
    (brand === 'ALL' ? ['SP', 'CPC'] : [brand]).forEach(b => { const f = typeof foFor === 'function' ? foFor(b) : null; if (f && f.ok) fams.push(...f.fams); });
    r = rsCompute({ fams, data: rsData(), brand });
  } catch (e) { r = { ok: false, why: 'Return spikes could not be worked out: ' + ((e && e.message) || e), items: [] }; }
  RS.memo[brand] = { k, r };
  return r;
}
/** For the Action Tracker: is the family still a return spike? (null when the returns are not read) */
function rsSpikeOn(brand, key) {
  const r = rsFor(brand);
  return r && r.ok && !r.noData ? r.items.some(x => x.key === key) : null;
}

/* ----- on Sales Alerts ----- */
const RS_SEV = { critical: ['🔴', 'Critical'], watch: ['🟡', 'Watch'] };
function rsBarBtn() { return `<button type="button" class="al-btn" data-rs-act="panel" aria-expanded="${RS.open}">↩ Returns data</button>`; }
function rsChipHtml(brand) {
  const r = rsFor(brand);
  const n = r && r.ok ? r.items.length : 0;
  return `<button type="button" class="al-chip is-returns" data-al-filter="returns" aria-pressed="${typeof AL !== 'undefined' && AL.filter === 'returns'}"><span aria-hidden="true">↩</span> Return spikes <b>${n}</b></button>`;
}
function rsUpTo(r) {
  const c = rsData().cover;
  return r.brands.filter(b => c[b]).map(b => `${({ SP: 'Ridhi', CPC: 'CPC' })[b]} returns data up to ${rsDay(c[b].to)}${RS.cache ? ' (nightly)' : c[b].by ? ` (uploaded by ${c[b].by})` : ''}`).join(' · ');
}
function rsPanelHtml() {
  const b = (v, t) => `<button type="button" data-rs-brand="${v}" aria-pressed="${RS.upBrand === v}">${t}</button>`;
  const last = ['SP', 'CPC'].map(x => { const u = RS.uploads[x], t = u && u.trail[u.trail.length - 1]; return `${({ SP: 'Ridhi', CPC: 'CPC' })[x]}: ${u ? `${u.rows.length} returns, ${rsDay(u.meta.from)}–${rsDay(u.meta.to)}${t ? ` · uploaded by ${rsEsc(t.name || t.by)} ${new Date(t.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}` : 'nothing uploaded'}`; }).join(' · ');
  return `<div class="rs-up" id="rsUp"><div class="rs-up-h"><b>Customer Returns report</b><span class="muted">Seller Central → Reports → Fulfillment → Customer Returns → download (.txt). One file per brand; a new upload replaces the rows it shares, never counts them twice.</span></div>`
    + `<div class="rs-up-r"><span class="al-seg" role="group" aria-label="Brand of the file">${b('SP', 'Ridhi')}${b('CPC', 'CPC')}</span>`
    + `<label class="al-btn rs-file">Choose the file…<input type="file" accept=".txt,.csv,.tsv,text/plain,text/csv" data-rs-file hidden></label>`
    + `${RS.cache ? '<span class="muted">The nightly returns cache is on: uploads are kept but not used.</span>' : ''}</div>`
    + `${RS.msg ? `<p class="rs-msg" role="status">${rsEsc(RS.msg)}</p>` : ''}<p class="al-asof">${last}${rsTest() ? ' · test site: uploads stay in this visit only' : ''}</p></div>`;
}
/** The weekly return rate, 8–12 weeks, against the baseline (plain SVG). */
function rsChartSvg(it) {
  const pts = it.series.filter(w => w.rate != null);
  if (pts.length < 2) return '<p class="muted al-empty">Not enough weeks to draw yet.</p>';
  const W = 520, H = 150, l = 36, r = 8, t = 12, b = 22, max = Math.max(0.02, ...pts.map(w => w.rate), it.base || 0) * 1.15;
  const X = i => l + i / (pts.length - 1) * (W - l - r), Y = v => H - b - v / max * (H - t - b);
  const line = pts.map((w, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(w.rate).toFixed(1)}`).join('');
  return `<svg class="rs-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Return rate a week, the last ${pts.length} weeks, against the normal ${rsPct(it.base)}">`
    + `<line x1="${l}" x2="${W - r}" y1="${H - b}" y2="${H - b}" class="rs-cg"/><text x="2" y="${t + 4}" class="rs-cx">${rsPct(max)}</text>`
    + (it.base != null ? `<line x1="${l}" x2="${W - r}" y1="${Y(it.base).toFixed(1)}" y2="${Y(it.base).toFixed(1)}" class="rs-cb"/><text x="${W - r}" y="${(Y(it.base) - 4).toFixed(1)}" text-anchor="end" class="rs-cx">normal ${rsPct(it.base)}</text>` : '')
    + `<path d="${line}" class="rs-cl"/>${pts.map((w, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(w.rate).toFixed(1)}" r="${i === pts.length - 1 ? 4.5 : 2.5}" class="${i === pts.length - 1 ? 'rs-cn' : 'rs-cp'}"><title>${rsWeek(w.wk)}: ${w.q} returned of ~${Math.round(w.den)} sold a week · ${rsPct(w.rate)}</title></circle>`).join('')}`
    + `<text x="${l}" y="${H - 6}" class="rs-cx">${rsDay(pts[0].wk)}</text><text x="${W - r}" y="${H - 6}" text-anchor="end" class="rs-cx">${rsDay(pts[pts.length - 1].wk)}</text></svg>`;
}
function rsDetailHtml(it) {
  const max = Math.max(1, ...it.reasons.map(r => r.n));
  const reasons = it.reasons.length ? `<ul class="rs-rs">${it.reasons.slice(0, 6).map(r => `<li><span>${rsEsc(r.t)}</span><span class="rs-bar" aria-hidden="true"><i style="width:${Math.round(r.n / max * 100)}%"></i></span><b class="num">${r.n}</b></li>`).join('')}</ul>` : '<p class="muted al-empty">No reason given.</p>';
  const com = it.comments.length ? `<ul class="rs-com">${it.comments.map(c => `<li><q>${rsEsc(c.t)}</q><small>${rsDay(c.d)} · ${rsEsc(c.s)} · ${rsEsc(c.r)}</small></li>`).join('')}</ul>` : '<p class="muted al-empty">No customer comments.</p>';
  const kids = it.kids.length ? `<table class="rs-kids"><thead><tr><th scope="col">SKU / size</th><th scope="col" class="num">Returned</th><th scope="col" class="num">Rate</th><th scope="col" class="num">Normal</th></tr></thead><tbody>`
    + it.kids.map(k => `<tr${k.spike ? ' class="is-spike"' : ''}><td>${rsEsc(k.label)}${k.spike ? ' <span class="rs-flag">spike</span>' : ''}</td><td class="num">${k.q}</td><td class="num">${rsPct(k.rate)}</td><td class="num">${rsPct(k.base)}</td></tr>`).join('') + '</tbody></table>' : '';
  const top = it.kids[0];
  const task = typeof tkBtnHtml === 'function' ? tkBtnHtml({ src: 'alert', brand: it.brand, key: it.key, parent: it.parent, name: it.name, problem: it.head, kind: 'returns', ref: it.id, pick: 'listing' }, 'al-btn', '+ Task') : '';
  const open = typeof TAB_OK === 'function' && TAB_OK('health') ? `<button type="button" class="al-btn" data-rs-open="${rsEsc(it.brand + '|' + (it.kids.length === 1 && top ? top.sku : ''))}|${rsEsc(it.parent)}">Open listing</button>` : '';
  const amz = /^B0[0-9A-Z]{8}$/i.test(it.parent) ? `<a class="al-btn" href="https://www.amazon.com/dp/${rsEsc(it.parent)}" target="_blank" rel="noopener">Amazon ↗</a>` : '';
  return `<div class="rs-det"><div class="rs-col"><h5>Return rate a week</h5>${rsChartSvg(it)}</div><div class="rs-col"><h5>Reasons, ${rsWeek(it.week)}</h5>${reasons}</div>`
    + `<div class="rs-col"><h5>Latest customer comments</h5>${com}</div><div class="rs-col"><h5>Sizes / SKUs returned, ${rsWeek(it.week)}</h5>${kids}</div></div>`
    + `<div class="al-btns">${task}${open}${amz}</div>`
    + `<p class="al-asof">Returned ${it.q} of ~${Math.round(it.sold)} sold a week (the average of ${rsWeek(it.week)} and the week before) · normal = ${it.baseWeeks} weeks before, pooled</p>`;
}
function rsCardHtml(it) {
  return `<article class="al-card is-${it.sev} rs-card" data-rs-card="${rsEsc(it.id)}"><div class="al-card-h"><span class="al-sev is-${it.sev}">${RS_SEV[it.sev][0]} ${RS_SEV[it.sev][1]}</span><span class="al-state">↩ Return spike · ${({ SP: 'Ridhi', CPC: 'CPC' })[it.brand]}</span></div>`
    + `<h4 class="al-head">${rsEsc(it.name)}</h4><div class="al-big num">${rsPct(it.now)}<small> returned · was ${rsPct(it.base)}</small></div><p class="al-do">${rsEsc(it.head)}</p></article>`;
}
function rsRowHtml(it, open) {
  return `<details class="al-row is-${it.sev} rs-row" data-rs-row="${rsEsc(it.id)}"${open ? ' open' : ''}><summary><i class="al-dot is-${it.sev}" aria-hidden="true"></i>`
    + `<span class="al-row-n">${rsEsc(it.name)}<small>${rsEsc(it.head)} · ${rsEsc(it.parent)}</small></span><span class="al-row-c">↩ Return spike</span>`
    + `<span class="al-row-p num">+${Math.round((it.now - (it.base || 0)) * 100)} pts</span><span class="al-row-m num">${it.q} units</span><span class="al-row-s">${RS_SEV[it.sev][1]}</span></summary><div class="al-det">${rsDetailHtml(it)}</div></details>`;
}
/** The section on Sales Alerts: the upload panel (when open), then the spikes — or the note when no returns are read. */
function rsSectionHtml(brand, only) {
  const panel = RS.open ? rsPanelHtml() : '';
  if (!RS.loaded) return panel + (only ? '<section class="al-sec"><p class="muted al-empty">Reading the returns…</p></section>' : '');
  const r = rsFor(brand);
  if (!r || !r.ok) return panel + (r ? `<p class="al-note">${rsEsc(r.why)}</p>` : '');
  if (r.noData) return panel + `<p class="rs-none">↩ Upload the Customer Returns report to see return spikes <button type="button" class="al-btn" data-rs-act="panel">Upload</button></p>`;
  const top = r.items.filter(it => it.sev === 'critical').slice(0, 3);
  const head = `<div class="al-sec-h"><h3>↩ Return spikes <span class="muted">${r.items.length}</span></h3><span class="muted">${rsEsc(rsUpTo(r))}</span></div>`;
  if (!r.items.length) return panel + `<section class="al-sec rs-sec">${head}<p class="muted al-empty">No return spikes — every family's returns are within 2× its normal (or under 5 units).</p></section>`;
  return panel + `<section class="al-sec rs-sec" id="rsList">${head}${top.length ? `<div class="al-top">${top.map(rsCardHtml).join('')}</div>` : ''}`
    + `<div class="al-rows">${r.items.map(it => rsRowHtml(it, false)).join('')}</div></section>`;
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', async e => {
    const on = s => (e.target && e.target.closest ? e.target.closest(s) : null);
    const t = on('#paneSalert [data-rs-act], #paneSalert [data-rs-brand], #paneSalert [data-rs-open], #paneSalert [data-rs-card]');
    if (!t) return;
    if (t.dataset.rsAct === 'panel') { RS.open = !RS.open; RS.msg = ''; if (typeof alRender === 'function') alRender(); return; }
    if (t.dataset.rsBrand) { RS.upBrand = t.dataset.rsBrand; if (typeof alRender === 'function') alRender(); return; }
    if (t.dataset.rsOpen != null) {
      const [b, sku, parent] = t.dataset.rsOpen.split('|');
      if (sku && typeof fsOpenListing === 'function') return fsOpenListing(b, sku);
      if (typeof tkOpenListing === 'function') return tkOpenListing({ brand: b, parent, key: b + '|' + parent });
      return undefined;
    }
    if (t.dataset.rsCard) { const row = document.querySelector(`#paneSalert [data-rs-row="${CSS.escape(t.dataset.rsCard)}"]`); if (row) { row.open = true; if (row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
    return undefined;
  });
  document.addEventListener('change', async e => {
    const inp = e.target && e.target.matches && e.target.matches('#paneSalert [data-rs-file]') ? e.target : null;
    if (!inp || !inp.files || !inp.files[0]) return;
    const f = inp.files[0];
    RS.msg = `Reading ${f.name}…`;
    if (typeof alRender === 'function') alRender();
    const text = await f.text();
    RS.msg = await rsUpload(RS.upBrand, text, f.name);
    RS.memo = {};
    if (typeof alRender === 'function') alRender();
  });
}

/* ----- the console: returnsCheck('<family or SKU>') — every week's sold, returned and rate ----- */
async function returnsCheck(query, brand) {
  await rsLoad();
  const q = String(query == null ? '' : query).toLowerCase();
  const out = [];
  (brand ? [brand] : ['SP', 'CPC']).forEach(b => {
    const r = rsFor(b);
    if (!r || !r.ok) { console.warn(r ? r.why : 'Returns not loaded.'); return; }
    if (r.noData) { console.log(`${({ SP: 'Ridhi', CPC: 'CPC' })[b]}: no returns data — upload the Customer Returns report.`); return; }
    r.rows.filter(x => !q || (x.name + ' ' + x.parent + ' ' + x.kids.map(k => k.sku + ' ' + k.asin).join(' ')).toLowerCase().includes(q)).forEach(x => {
      const t = { product: x.name, parent: x.parent, brand: ({ SP: 'Ridhi', CPC: 'CPC' })[b], week: rsWeek(x.week), rateNow: rsPct(x.now), returned: x.q, soldAWeek: Math.round(x.sold), baseline: rsPct(x.base), baselineWeeks: x.baseWeeks,
        spike: x.spike, severity: x.sev || null, rule: `spike = rate ≥ ${RS_M.times}× baseline AND ≥ baseline + ${RS_M.pts * 100} points AND ≥ ${RS_M.units} units; critical = ≥ ${RS_M.critTimes}× or ≥ ${RS_M.critRate * 100}%`,
        reasons: x.reasons, comments: x.comments, skus: x.kids.map(k => ({ sku: k.sku, returned: k.q, rate: rsPct(k.rate), baseline: rsPct(k.base), spike: k.spike })), why: x.why || null,
        weeks: x.series.map(w => ({ week: w.wk, soldThisWeek: w.sold, soldAWeekAvg2: Math.round(w.den * 10) / 10, returned: w.q, rate: rsPct(w.rate) })) };
      console.log(`%c${t.product} (${t.parent}, ${t.brand})`, 'font-weight:bold', `\n${t.week}: ${t.rateNow} returned (${t.returned} units of ~${t.soldAWeek} a week) · normal ${t.baseline} over ${t.baselineWeeks} weeks · ${t.spike ? 'SPIKE ' + t.severity : 'no spike'}${t.why ? ' · ' + t.why : ''}`);
      console.table(t.weeks);
      out.push(t);
    });
  });
  if (!out.length) console.log('No family or SKU matches "' + query + '".');
  return out;
}
if (typeof window !== 'undefined') window.returnsCheck = returnsCheck;
