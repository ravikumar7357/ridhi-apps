/* ================= DEAL CALENDAR =================
 * Two sources, because Amazon only offers one of them.
 *
 *   RECOMMENDATIONS — imported from Amazon's own Deal Recommendations file. These are suggestions,
 *   not commitments: what Amazon thinks you should run, at what price, in which event window.
 *
 *   ENTRIES — typed by you. There is no API and no export for what is ACTUALLY running (coupons,
 *   Prime Exclusive Discounts and deals all live only in the Seller Central UI), so the calendar
 *   cannot discover them. What it can do is take the dates and work out the effect itself.
 *
 * The two are kept visibly apart. A recommendation drawn like a live deal would have somebody
 * believing a discount is running when nobody ever submitted it.
 */
const D_CHUNK = 300;
let DEALS = { recs: [], at: '' };
let D_ENTRIES = [];          // what is actually set up
let D_EVENTS = {};           // named event → { start, end }, for schedules Amazon leaves as "NA"
let D_EDIT = null;
// HDA — heavy discounts recorded by hand, at ASIN level. Its own list rather than more keys in
// D_PLAN: the planner is a grid of PARENT × WEEK, and a child ASIN discounted for nine days across
// two weeks has no cell to live in. Kept in the same document, so it loads and saves with the rest.
let D_HDA = [];              // [{ id, asin, parent, brand, t, v, s, e, by, note, at }]
let D_HDA_MIN = 30;          // the discount at which a PLANNER deal is considered high

function dMsg(t, bad) { const m = $('dMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

/** Dates hide inside schedule names — "Mon (2026-08-03 - 2026-08-09)", "Custom - (…)". */
const D_DATE_RE = /(\d{4}-\d{2}-\d{2})\s*[-–]\s*(\d{4}-\d{2}-\d{2})/;
function dWindowOf(rec) {
  const s = String(rec.start || '').trim(), e = String(rec.end || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && /^\d{4}-\d{2}-\d{2}$/.test(e)) return { start: s, end: e, named: '' };
  const m = D_DATE_RE.exec(String(rec.schedule || ''));
  if (m) return { start: m[1], end: m[2], named: '' };
  // "Prime Big Deal Days" and "Black Friday and Cyber Monday" carry no dates anywhere in the file —
  // Amazon has not published them yet. They stay dateless until somebody says when they are, rather
  // than being guessed onto the calendar.
  const named = String(rec.schedule || '').trim();
  const ev = D_EVENTS[named];
  return ev ? { start: ev.start, end: ev.end, named } : { start: '', end: '', named };
}

/* ---------- storage ---------- */
async function loadDeals() {
  try {
    const meta = await getDoc(doc(db, 'audit', 'deals'));
    if (meta.exists()) {
      const d = meta.data();
      DEALS.at = d.at || '';
      D_ENTRIES = d.entries || [];
      D_EVENTS = d.events || {};
      D_PLAN = d.plan || {};
      D_IMG = d.imgs || {};
      D_HDA = Array.isArray(d.hda) ? d.hda : [];
      // A stored 0 means "pull in every discount" and must survive; only a missing value defaults.
      D_HDA_MIN = (d.hdaMin === undefined || d.hdaMin === null) ? 30 : Number(d.hdaMin);
      let recs = [];
      if (d.chunks) {
        const got = await Promise.all(Array.from({ length: d.chunks }, (_, i) => getDoc(doc(db, 'dealrows', String(i)))));
        got.forEach(s => { if (s.exists()) recs = recs.concat(s.data().r || []); });
      }
      DEALS.recs = recs;
    }
  } catch (e) { /* nothing stored yet, or no read access */ }
}
async function saveDeals(withRecs) {
  if (withRecs) {
    const chunks = Math.ceil(DEALS.recs.length / D_CHUNK) || 1;
    for (let i = 0; i < chunks; i++) {
      await setDoc(doc(db, 'dealrows', String(i)), { r: DEALS.recs.slice(i * D_CHUNK, (i + 1) * D_CHUNK) });
    }
    DEALS.chunks = chunks;
  }
  await setDoc(doc(db, 'audit', 'deals'), {
    chunks: DEALS.chunks || Math.ceil(DEALS.recs.length / D_CHUNK) || 1,
    n: DEALS.recs.length, at: DEALS.at, entries: D_ENTRIES, events: D_EVENTS, plan: D_PLAN, imgs: D_IMG,
    hda: D_HDA, hdaMin: D_HDA_MIN,
    by: ME.email, saved: serverTimestamp(),
  });
}
async function ensureDeals() {
  dMsg('Loading…');
  await loadParentNames();
  if (!H_LOADED) await loadHealthCache();          // parent names and brands come from here
  // The planner's rows ARE the BSR snapshot — that is what keeps the list from being maintained by
  // hand. Loading it here means the tab works on its own, without visiting BSR Audit first.
  if (!BSR_LOADED) await loadBsrCache();
  if (!DEALS.recs.length && !D_ENTRIES.length && !DEALS.at) await loadDeals();
  if (!TREND.at && !Object.keys(TREND.d.SP).length) await loadTrends();   // for the effect columns
  dMsg('');
  renderDealsAny();
}

/* ---------- import ---------- */
// A minimal RFC-4180 reader: quoted fields, doubled quotes, embedded commas and newlines. Amazon's
// product names contain all three, and a split(',') would quietly shred every row that has one.
/**
 * Which character actually separates the fields.
 *
 * Not always a comma, even in a file named .csv. Excel writes the LIST SEPARATOR from the machine's
 * regional settings — a semicolon wherever the decimal mark is a comma — and "Save As -> Text (Tab
 * delimited)" leaves tabs inside a name that still ends in .csv. Guess wrong and every line becomes
 * ONE field: the header matches nothing, every row is dropped for having no key column, and the
 * screen blames the file's column names while those names were perfectly correct.
 *
 * That is exactly what happened when a colleague could not upload this app's OWN template back into
 * it (2026-08-24) — the packing list said "Matched: nothing" against a header that plainly read
 * Box, SKU, Qty. His copy had been re-saved tab-delimited.
 *
 * Counted OUTSIDE quotes, over the first few lines only, so one product name with a comma in it
 * cannot out-vote the real separator. A tie goes to the comma: that is what every file these apps
 * write uses, so nothing changes for a file that was always fine.
 */
function csvDelimiter(text) {
  const n = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false, lines = 0;
  for (let i = 0; i < text.length && lines < 5; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') i++; else inQ = false; } continue; }
    if (c === '"') { inQ = true; continue; }
    if (c === '\n') { lines++; continue; }
    if (n[c] != null) n[c]++;
  }
  let best = ',';
  [';', '\t'].forEach(d => { if (n[d] > n[best]) best = d; });
  return best;
}
function dParseCsv(text, delim) {
  const rows = []; let row = [], f = '', q = false;
  // The byte-order mark Excel puts at the front lands inside the FIRST header cell, where it
  // stops "Box" being "Box". Every reader here trims, which hides it — dropped once, here.
  text = String(text).replace(/^\ufeff/, '');
  const D = delim || csvDelimiter(text);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === D) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); f = ''; rows.push(row); row = []; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

$('dImport').onclick = () => $('dFile').click();
$('dFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    dMsg('Reading…');
    const rows = dParseCsv(await file.text());
    // The sheet starts with three banner rows and hides a machine row of "marketplace_id@…" DIRECTLY
    // under the headers. So the header row is found by name, and the row after it is checked and
    // dropped if it is that machine row rather than data.
    let h = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      if (rows[i].some(c => /parent\s*asin/i.test(c)) && rows[i].some(c => /deal\s*type/i.test(c))) { h = i; break; }
    }
    if (h < 0) throw new Error('Could not find the header row — is this the “Deal Recommendation Template” sheet?');
    const head = rows[h].map(c => String(c || '').trim().toLowerCase());
    const ix = names => { for (const n of names) { const i = head.findIndex(x => x === n || x.startsWith(n)); if (i >= 0) return i; } return -1; };
    const C = {
      parent: ix(['parent asin']), asin: ix(['deal asin', 'featured asin']), name: ix(['product name']),
      type: ix(['deal type']), sku: ix(['sku']), part: ix(['participating']), sched: ix(['schedule']),
      start: ix(['start date']), end: ix(['end date']), price: ix(['seller price']), deal: ix(['deal price']),
      units: ix(['committed units']), img: ix(['image url']),
    };
    if (C.parent < 0 || C.sched < 0) throw new Error('That file has no Parent ASIN / Schedule columns.');
    const at = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    const out = [];
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i];
      const parent = at(r, C.parent).toUpperCase();
      if (!parent || /^marketplace_id@/i.test(parent) || parent === 'PARENT_ASIN') continue;
      const num = v => { const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; };
      out.push({
        parent, asin: at(r, C.asin).toUpperCase(), sku: at(r, C.sku), name: at(r, C.name),
        type: at(r, C.type), part: /^y/i.test(at(r, C.part)), schedule: at(r, C.sched),
        start: at(r, C.start), end: at(r, C.end),
        price: num(at(r, C.price)), dealPrice: num(at(r, C.deal)), units: num(at(r, C.units)),
        img: at(r, C.img),
      });
    }
    if (!out.length) throw new Error('No recommendation rows found.');
    if (!confirm(`Replace the recommendations with ${out.length} row(s) from this file?\n\nThis is a full snapshot, not a merge. Your own calendar entries are not touched.`)) { dMsg(''); return; }
    DEALS.recs = out;
    DEALS.at = new Date().toISOString().slice(0, 16).replace('T', ' ');
    dMsg('Saving…');
    await saveDeals(true);
    renderDealsAny();
    dMsg(`Imported ${out.length} recommendation(s) across ${new Set(out.map(r => r.parent)).size} parents. The Events tab now lists every window they belong to.`);
  } catch (err) { dMsg('Import failed: ' + (err.message || err), true); }
};
// Today, as yyyy-MM-dd. Used by the planner export and the events table.
const dToday = () => new Date().toISOString().slice(0, 10);
