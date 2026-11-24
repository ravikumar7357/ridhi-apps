/* ================= REIMBURSEMENT · WHERE THE DATA COMES FROM: rbLoad, the uploads, the unit costs (24 Nov 2026) =================
 * rbLoad() is the ONLY way the module gets its data. No made-up numbers by default; in this order:
 *   1. the backend caches reimbPaid / reimbLedger / reimbInbound, through the same ?cache= call every Ads screen uses (baCall),
 *      once the backend team writes them (their shapes: THE DATA CONTRACT in reimb-core.js);
 *   2. for a report the backend does not give yet, the reports a person uploaded (Upload Amazon reports, on the page);
 *   3. nothing: source 'none', and the page shows "Connect Amazon's data" with the upload buttons instead of empty boxes.
 * The sample (reimb-sample.js) only with ?sample=1 in the address — and then always with the yellow banner.
 * INBOUND SHORTAGES need the units SHIPPED per shipment, which no report a person can download holds: until reimbInbound exists
 * there are no inbound rows, and the pages say so (there is no manual upload for it). When the cache has no received count,
 * the uploaded ledger's Receipts give it (rbItems). LOST AND DAMAGED need both the ledger and the Reimbursements report of
 * the brand (have.ledgerBrands / payoutBrands): without the payouts Sellora cannot tell what Amazon already paid.
 *
 * THE UPLOADS are kept in Firestore reimbData/{brand}_{report}_{n}, chunked like the Deal Calendar's import: chunk 0 also holds
 * how many there are (of), when (uploadedAt) and who uploaded it (trail, PPC History's step). An upload REPLACES the rows it
 * shares a key with (rbMerge in reimb-core.js), never adds them twice. Until the rule is deployed (firestore.rules reimbData) a
 * read is refused, and the uploads are kept in this browser (IndexedDB) — the page says so in the same note as the review list.
 * UNIT COSTS come from Profit & Margin (audit/costs) and only for an account that may read it (the Profit & Margin right, or
 * Audit); that cost is the LANDED cost, so every value from it shows as "≈ landed". Without the right: units, no $.
 * Main functions: rbLoad, rbUploadsLoad, rbUploadSave, rbCostsLoad, rbKnownBrands, rbDataNote. */

const RB_CHUNK = 1500;          // rows per reimbData document (a row is a few hundred bytes: well inside Firestore's 1 MB)
const RB_IDB = { name: 'selloraReimb', store: 'uploads' };
// The uploads: key 'SP_payouts' → { key, brand, report, rows, uploadedAt, of, trail, meta }; where they are kept ('fs' the
// shared copy, 'local' this browser until the rule is deployed, 'mem' this visit only when the browser refuses too).
const RBX = { uploads: {}, where: '', err: '' };
const rbSampleAsked = () => { try { return /[?&]sample=1(&|$)/.test(location.search || ''); } catch (e) { return false; } };

async function rbLoad() {
  if (rbSampleAsked()) return rbSampleData();
  const out = { sample: false, source: 'none', asOf: '', inbound: [], payouts: [], ledger: [], costs: {}, costNote: '',
    have: { inbound: false, payouts: false, ledger: false }, from: {} };
  // --- 1. the backend caches (a cache not written yet answers "nothing cached": skipped, not an error) ---
  const grab = async n => { try { const r = await baCall({ cache: n }); return (r && r.data && r.data.d) ? r.data : null; } catch (e) { return null; } };
  const rowsOf = c => Object.keys(c.d).flatMap(b => (Array.isArray(c.d[b]) ? c.d[b] : (c.d[b] && c.d[b].rows) || []).map(x => Object.assign({ brand: b }, x)));
  const [paid, ledger, inbound] = await Promise.all(['reimbPaid', 'reimbLedger', 'reimbInbound'].map(grab));
  [[paid, 'payouts'], [ledger, 'ledger'], [inbound, 'inbound']].forEach(([c, k]) => {
    if (!c) return;
    out[k] = rowsOf(c);
    out.have[k] = true;
    out.from[k] = 'backend ' + (c.at || '');
  });
  // --- 2. the uploads, for the reports the backend did not give ---
  await rbUploadsLoad();
  ['payouts', 'ledger'].forEach(k => {
    if (out.have[k]) return;
    const ups = Object.values(RBX.uploads).filter(u => u.report === k);
    if (!ups.length) return;
    out[k] = ups.flatMap(u => u.rows || []);
    out.have[k] = true;
    out.from[k] = 'upload';
    if (k === 'ledger') out.have.ledgerBrands = ups.map(u => u.brand);   // a reversal, lost or damaged item of a brand with no ledger is not judged
    if (k === 'payouts') out.have.payoutBrands = ups.map(u => u.brand);  // nor a lost or damaged one without its payouts (what Amazon already paid)
  });
  out.source = Object.values(out.from).some(v => /^backend/.test(v)) ? 'backend' : Object.keys(out.from).length ? 'upload' : 'none';
  // The data's day: the newest row of what was read.
  const last = [].concat(out.payouts.map(p => p.date), out.ledger.map(l => l.date)).filter(Boolean).sort().pop();
  out.asOf = last || '';
  await rbCostsLoad(out);
  return out;
}

/* ---------- unit costs: Profit & Margin's, only with its right ---------- */
async function rbCostsLoad(out) {
  const me = (typeof ME !== 'undefined' && ME) || { tabs: [] };
  if (!(me.admin || (me.tabs || []).includes('profit') || (me.tabs || []).includes('audit'))) { out.costNote = 'Costs need the Profit & Margin right'; return; }
  try { if (typeof loadCosts === 'function') await loadCosts(); } catch (e) { /* read as none below */ }
  const c = (typeof COST !== 'undefined' && COST) || {};
  // Profit & Margin's cost is the landed cost: never a sourcing cost (Underpaid needs that; nobody has entered it yet).
  Object.keys(c).forEach(a => { const v = Number(c[a] && c[a].c); if (v > 0) out.costs[a] = { sourcing: null, landed: v }; });
  if (!Object.keys(out.costs).length) out.costNote = 'No unit costs in Profit & Margin yet';
}

/* ---------- the uploads ---------- */
// This browser's copy (IndexedDB): op 'all' → every upload, 'put' → one. Rejects when the browser refuses.
function rbIdb(op, val) {
  return new Promise((res, rej) => {
    try {
      const rq = indexedDB.open(RB_IDB.name, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(RB_IDB.store, { keyPath: 'key' });
      rq.onerror = () => rej(rq.error);
      rq.onsuccess = () => {
        const d = rq.result, tx = d.transaction(RB_IDB.store, op === 'all' ? 'readonly' : 'readwrite'), st = tx.objectStore(RB_IDB.store);
        const r = op === 'all' ? st.getAll() : st.put(val);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        tx.oncomplete = () => d.close();
      };
    } catch (e) { rej(e); }
  });
}
// Every upload: the shared copy (each report's chunks of its newest upload, in order), else this browser's.
async function rbUploadsLoad() {
  const mem = RBX.where === 'mem' ? RBX.uploads : {};   // kept for this visit only: not lost when the page reads again
  RBX.uploads = {};
  try {
    const s = await getDocs(collection(db, 'reimbData'));
    const by = {};
    s.docs.forEach(d => { const v = d.data() || {}; const k = v.brand + '_' + v.report; (by[k] = by[k] || []).push(v); });
    Object.keys(by).forEach(k => {
      const head = by[k].find(p => p.n === 0);
      if (!head) return;
      const parts = by[k].filter(p => p.uploadedAt === head.uploadedAt && p.n < head.of).sort((a, z) => a.n - z.n);
      if (parts.length !== head.of) return;   // an upload still being written, or broken off: the page reads the last whole one next time
      RBX.uploads[k] = { key: k, brand: head.brand, report: head.report, uploadedAt: head.uploadedAt, of: head.of, trail: head.trail || [], meta: head.meta || {},
        rows: parts.flatMap(p => p.rows || []) };
    });
    RBX.where = 'fs';
    RBX.err = '';
  } catch (e) {
    RBX.err = String((e && (e.code || e.message)) || e);
    try {
      (await rbIdb('all') || []).forEach(v => { RBX.uploads[v.key] = v; });
      RBX.where = 'local';
    } catch (x) { RBX.where = 'mem'; RBX.uploads = mem; }
  }
}
// Save one report of one brand (its rows already merged with what was kept): the chunks, then any chunk left over from a
// longer upload is removed. One trail step per upload (who, which device, when, how many rows).
async function rbUploadSave(brand, report, rows, meta) {
  await ppchNeedPerson();
  const key = brand + '_' + report, prev = RBX.uploads[key], at = Date.now();
  const trail = ((prev && prev.trail) || []).concat(ppchEvent('uploaded', { report, rows: rows.length })).slice(-30);
  const of = Math.max(1, Math.ceil(rows.length / RB_CHUNK));
  const clean = JSON.parse(JSON.stringify(rows));
  const rec = { key, brand, report, uploadedAt: at, of, trail, meta: meta || {}, rows: clean };
  if (RBX.where === 'fs') {
    for (let i = 0; i < of; i++) {
      await setDoc(doc(db, 'reimbData', `${key}_${i}`), Object.assign({ brand, report, n: i, of, uploadedAt: at, rows: clean.slice(i * RB_CHUNK, (i + 1) * RB_CHUNK) },
        i === 0 ? { trail, meta: rec.meta } : {}));
    }
    for (let i = of; i < ((prev && prev.of) || 0); i++) { try { await deleteDoc(doc(db, 'reimbData', `${key}_${i}`)); } catch (e) { /* read past: chunk 0 says how many */ } }
  } else if (RBX.where === 'local') await rbIdb('put', rec);
  RBX.uploads[key] = rec;
  return rec;
}
// What Sellora already knows of the brands — the other brand's uploads, the ad groups, Product Performance's products —
// as sku / asin → brand, for the "most of this file belongs to the other brand" warning.
function rbKnownBrands() {
  const m = new Map();
  const put = (k, b) => { if (k && b && !m.has(k)) m.set(k, b); };
  Object.values(RBX.uploads).forEach(u => (u.rows || []).forEach(x => { put(x.sku, u.brand); put(x.asin, u.brand); }));
  try { ['SP', 'CPC'].forEach(b => (((ST.ag || {})[b] || {}).rows || []).forEach(x => { put(x.sku, b); put(x.a, b); })); } catch (e) { /* not loaded */ }
  try { Object.keys(WEEKLY.rows || {}).forEach(a => put(a, WEEKLY.rows[a] && WEEKLY.rows[a].brand)); } catch (e) { /* not loaded */ }
  return m;
}
// Where the uploads are kept, for the bar's small note ('' when shared).
function rbDataNote() {
  if (!Object.keys(RBX.uploads).length) return '';
  if (RBX.where === 'local') return '<span class="sta-bad">The uploaded reports are kept in this browser only.</span> <span>The shared copy needs its database rule (Ravi: reimbData in firestore.rules). Until then nobody else sees them.</span>';
  if (RBX.where === 'mem') return '<span class="sta-bad">The uploaded reports are kept for this visit only</span> <span>(this browser refused to store them, and the shared copy needs its database rule).</span>';
  return '';
}
