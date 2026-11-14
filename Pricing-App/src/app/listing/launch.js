/* ================= LISTING · LAUNCH: the Listing Audit screen — every parent's documents, owners, approvals, launch details and first-month review =================
 * Screens: Listing Audit (tab 'audit'). The document types and page state it reads are in listing-audit.js.
 * Does: loads and saves the attachment index (audit/{brand}), the hand-typed parents (auditmanual/{brand}) and the launch
 *       details (auditlaunch/{brand}); pulls last-30-day sales and PPC figures through the backend and caches them for
 *       everyone (audit/sales30, audit/ppc30); auditParents merges the Listing Health parents, the manual ones and any
 *       with documents into one list; renderAudit draws the grid with its KPI cards; the dialogs add document versions
 *       (approve / reject, email the approvers), assign an owner, edit launch details, add a parent; Export / Import move
 *       the index as JSON.
 * Main functions: etaOf, loadAuditCache, saveAuditCache, loadLaunch, saveLaunch, ensureAudit, pullPpc30, pullSales30,
 *                 reviewFlag, auditParents, renderAudit, wireAuditTable, renderAuditKpis, openAuditEditor, renderVersions,
 *                 versionAction, notifyApprovers, addVersion, openLaunchEditor, launchHint, and the toolbar handlers. */
/* ---------- the launch side of a parent: shipment, then everything switched on at launch ----------
 *
 * The documents above answer "is the listing built right". These answer "did we actually launch it" —
 * a separate question with a separate life, so it lives in its own Firestore document rather than
 * being wedged into the attachment index (which is sized around staying under 1 MB).
 *
 *   LAUNCH[brand][parent] = { mode, ship, eta, vine, infl, cc, ppc, meta, mlink, launch, note }
 *
 *   mode   'air' | 'sea'   ship  yyyy-MM-dd dispatch date
 *   eta    yyyy-MM-dd      — ONLY when someone overrides the automatic one (see etaOf)
 *   vine   bool            infl  how many influencers the product was shipped to
 *   cc     bool  Creator Connections started      ppc  bool  PPC campaigns started
 *   meta   bool  Meta ads started                 mlink  affiliate link used to read Meta conversions
 *   launch yyyy-MM-dd      — when the listing went live; starts the one-month review clock
 */
let LAUNCH = { SP: {}, CPC: {} };
let LAUNCH_EDIT = null;               // { brand, parent } while the launch dialog is open

// Transit days per lane, used to work the tentative arrival date out from the dispatch date. Same
// defaults as the replenishment app; kept per browser so a change here never surprises anyone else.
let SHIP_LEAD = { air: 15, sea: 80 };
// Read this browser's transit days, if someone changed them.
function loadShipLead() {
  try {
    const saved = JSON.parse(localStorage.getItem('auditShipLead') || 'null');
    if (saved && saved.air > 0 && saved.sea > 0) SHIP_LEAD = { air: +saved.air, sea: +saved.sea };
  } catch (e) { /* keep the defaults */ }
}
// Keep this browser's transit days.
const saveShipLead = () => {
  try {
    localStorage.setItem('auditShipLead', JSON.stringify(SHIP_LEAD));
  } catch (e) {}
};

const DAY_MS = 86400000;    // one day in milliseconds
// ms → "yyyy-MM-dd" (UTC), and back; dayMs gives 0 for anything that is not a date in that form.
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const dayMs = str => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
  return match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) : 0;
};

/**
 * The tentative arrival date. A hand-typed `eta` always wins — someone with the booking in front of
 * them knows more than an average lead time. Otherwise it is dispatch + the lane's transit days, and
 * the caller is told which of the two it got so the grid can mark an estimate as an estimate.
 */
function etaOf(details) {
  if (!details) return null;
  if (details.eta) return { date: details.eta, auto: false };
  const ms = dayMs(details.ship);
  if (!ms || !details.mode) return null;
  return { date: isoDay(ms + (SHIP_LEAD[details.mode] || 0) * DAY_MS), auto: true };
}

/* A launch is reviewed one month in, and $6,000 in its first 30 days is the bar it has to clear. */
const LAUNCH_REVIEW_MIN = 6000;
const LAUNCH_REVIEW_DAYS = 30;

/**
 * Last-30-day units + revenue per ASIN, pulled from the Orders workbooks by the backend and cached
 * in Firestore so every user gets the same figures without re-running the scan. Shape mirrors the
 * backend's: { ASIN: [units, revenue] }.
 */
let SALES30 = { asins: {}, at: '' };

/**
 * Sponsored Products, per ASIN, straight from the Amazon Ads API:
 *   { ASIN: [impressions, clicks, spend, orders, adSales] }
 *
 * Kept separate from SALES30 because it answers a different question and comes from a different
 * place — SALES30 is TOTAL revenue out of the seller's own Orders workbooks, this is only what the
 * ads did. Overlaying them would make ad sales look like extra sales; they are a subset.
 */
let PPC30 = { asins: {}, at: '', start: '', end: '' };

// Status line under the toolbar: red for an error, grey otherwise.
function aMsg(text, bad) {
  const msg = $('aMsg');
  msg.textContent = text || '';
  msg.className = bad ? 'err' : 'muted';
}

/* Owners are usually work emails; the part before the @ is what people actually call each other,
   and it is the only part that fits in a grid cell. A typed-in name is left exactly as written —
   including the designation after it, which is why only a BARE email is shortened. Cutting at the
   first @ regardless would have turned "priya@x.com — Listing Specialist" into just "priya". */
const ownerShort = raw => {
  const text = String(raw || '').trim();
  return /^[^@\s]+@[^@\s]+$/.test(text) ? text.split('@')[0] : text;
};

/**
 * Documents saved before versioning existed are `{url, name, at}`. They are lifted into a single
 * version marked **draft**, not "approved" — nobody approved them, and saying otherwise would put a
 * false sign-off in the record.
 */
function migrateAuditSlot(slot) {
  if (!slot) return null;
  if (Array.isArray(slot.v)) return slot;
  if (slot.url) return { v: [{ url: slot.url, name: slot.name || '', date: slot.at || '', status: 'draft', by: '' }] };
  return null;
}
// The newest version of a document slot, or null.
const latestVersion = slot => (slot?.v?.length ? slot.v[slot.v.length - 1] : null);

// Read both brands' attachment index into AUDIT, lifting pre-versioning slots on the way.
async function loadAuditCache() {
  for (const brand of ['SP', 'CPC']) {
    try {
      const snap = await getDoc(doc(db, 'audit', brand));
      const raw = snap.exists() ? (snap.data().docs || {}) : {};
      const out = {};
      Object.entries(raw).forEach(([parent, slots]) => {
        const migrated = {};
        Object.entries(slots || {}).forEach(([key, slot]) => {
          const fixed = migrateAuditSlot(slot);
          if (fixed) migrated[key] = fixed;
        });
        if (Object.keys(migrated).length) out[parent] = migrated;
      });
      AUDIT[brand] = out;
    } catch (e) {
      // Surfaced, never swallowed — a silent read failure is indistinguishable from "nothing saved",
      // which is exactly how the health tab's disappearing data hid for three rounds.
      aMsg(`Could not load saved ${BRAND_NAME[brand]} attachments: ${e.message || e}`, true);
    }
  }
  AUDIT_LOADED = true;
}
// Write one brand's attachment index: only the slots that hold a version or an owner.
async function saveAuditCache(brand) {
  // Only parents that actually have an attachment are stored, so the document stays small however
  // many parents exist.
  const docs = {};
  Object.entries(AUDIT[brand] || {}).forEach(([parent, slots]) => {
    const keep = {};
    // A slot is worth storing if it holds a version OR if somebody has been assigned to it. Keeping
    // only the ones with files would have thrown away every assignment the moment it was saved.
    Object.entries(slots || {}).forEach(([key, slot]) => { if (slot?.v?.length || slot?.own) keep[key] = slot; });
    if (Object.keys(keep).length) docs[parent] = keep;
  });
  const size = JSON.stringify(docs).length;
  if (size > 800000) {
    aMsg(`Attachment index for ${BRAND_NAME[brand]} is ${Math.round(size / 1024)} KB — close to Firestore's 1 MB limit. Export a backup and tell me; it needs splitting across documents.`, true);
  }
  await fsSetDoc(doc(db, 'audit', brand), { docs, n: Object.keys(docs).length, at: serverTimestamp() });
}
// The hand-typed parents (products not on Amazon yet), per brand.
async function loadManualParents() {
  for (const brand of ['SP', 'CPC']) {
    try {
      const snap = await getDoc(doc(db, 'auditmanual', brand));
      AUDIT_MANUAL[brand] = snap.exists() ? (snap.data().p || {}) : {};
    } catch (e) {
      aMsg(`Could not load ${BRAND_NAME[brand]} manual parents: ${e.message || e}`, true);
    }
  }
}
async function saveManualParents(brand) {
  await fsSetDoc(doc(db, 'auditmanual', brand), { p: AUDIT_MANUAL[brand] || {}, at: serverTimestamp() });
}
// The launch details, per brand.
async function loadLaunch() {
  for (const brand of ['SP', 'CPC']) {
    try {
      const snap = await getDoc(doc(db, 'auditlaunch', brand));
      LAUNCH[brand] = snap.exists() ? (snap.data().p || {}) : {};
    } catch (e) {
      aMsg(`Could not load ${BRAND_NAME[brand]} launch details: ${e.message || e}`, true);
    }
  }
}
// Write one brand's launch details, dropping parents whose form is still blank.
async function saveLaunch(brand) {
  // Rows where every field is still blank are dropped rather than stored — an untouched parent is
  // not a fact about the launch, and keeping thousands of empty objects is what would eventually
  // push this document towards Firestore's 1 MB limit. `by`/`at` are stamped on every save, so they
  // are excluded from the test: counting them would make an empty form look filled in.
  const FIELDS = ['mode', 'ship', 'eta', 'launch', 'vine', 'infl', 'cc', 'ppc', 'meta', 'mlink', 'note'];
  const p = {};
  Object.entries(LAUNCH[brand] || {}).forEach(([parent, details]) => {
    if (details && FIELDS.some(field => details[field] !== '' && details[field] != null && details[field] !== false && details[field] !== 0)) p[parent] = details;
  });
  LAUNCH[brand] = p;
  await fsSetDoc(doc(db, 'auditlaunch', brand), { p, n: Object.keys(p).length, at: serverTimestamp() });
}
/** The cached sales figures. Missing/unreadable is normal (nobody has pulled yet) — never an error. */
async function loadSales30() {
  try {
    const snap = await getDoc(doc(db, 'audit', 'sales30'));
    if (snap.exists()) SALES30 = { asins: snap.data().asins || {}, at: snap.data().at || '' };
  } catch (e) { /* no cache yet, or no read access — the grid just shows no sales */ }
}
/** Same for the PPC figures. */
async function loadPpc30() {
  try {
    const snap = await getDoc(doc(db, 'audit', 'ppc30'));
    if (snap.exists()) {
      const data = snap.data();
      PPC30 = { asins: data.asins || {}, at: data.at || '', start: data.start || '', end: data.end || '' };
    }
  } catch (e) { /* no cache yet — the PPC columns just stay on the manual tick */ }
}
// First visit to the tab: parent names, the listings snapshot, then everything this screen keeps, then draw.
async function ensureAudit() {
  await loadParentNames();
  if (!H_LOADED) await loadHealthCache();      // parents come from the health snapshot
  if (!AUDIT_LOADED) {
    aMsg('Loading…');
    await Promise.all([loadAuditCache(), loadManualParents(), loadLaunch(), loadSales30(), loadPpc30()]);
    AUDIT_LOADED = true;
    aMsg('');
  }
  renderAudit();
}

/**
 * Pull the last 30 days of Sponsored Products figures for both brands and cache them for everyone.
 *
 * Amazon builds these reports asynchronously — asking is instant, the answer takes a few minutes —
 * so this asks for both brands FIRST and then waits on them together. Waiting for Ridhi to finish
 * before even asking for CPC would double the wall-clock for no reason.
 *
 * A brand that fails is reported and skipped, not fatal: one brand's credentials being wrong should
 * not throw away the other brand's numbers.
 */
const PPC_POLL_MS = 15000;
const PPC_POLL_MAX = 40;        // ~10 minutes; Amazon's own guidance is "usually under 5"

// Pull PPC: ask Amazon for both brands' Sponsored Products reports, poll until they are ready, merge, save for everyone.
async function pullPpc30() {
  const btn = $('aPpc');
  btn.disabled = true;
  btn.textContent = 'Pulling…';
  const merged = {};
  const failed = [];
  let window_ = '';
  try {
    // --- ask for both reports first ---
    const jobs = [];
    for (const brandKey of ['SP', 'CPC']) {
      try {
        const reply = await baCall({ ads: 'ppcCreate', brand: brandKey, days: 30 });
        if (!reply.reportId) throw new Error('Amazon did not return a report id.');
        jobs.push({ brand: brandKey, id: reply.reportId });
        window_ = window_ || `${reply.start} → ${reply.end}`;
      } catch (e) {
        failed.push(`${BRAND_NAME[brandKey]}: ${e.message || e}`);
      }
    }
    if (!jobs.length) throw new Error(failed.join(' · ') || 'Neither brand could request a report.');

    // --- poll both until ready, fetching each as it lands ---
    const pending = new Map(jobs.map(job => [job.brand, job.id]));
    for (let tick = 0; tick < PPC_POLL_MAX && pending.size; tick++) {
      for (const [brand, id] of [...pending]) {
        let status;
        try {
          status = await baCall({ ads: 'ppcStatus', brand, id });
        } catch (e) {
          failed.push(`${BRAND_NAME[brand]}: ${e.message || e}`);
          pending.delete(brand);
          continue;
        }
        if (/fail|cancel/i.test(status.status || '')) {
          failed.push(`${BRAND_NAME[brand]}: report ${status.status}${status.error ? ' — ' + status.error : ''}`);
          pending.delete(brand);
          continue;
        }
        if (!status.ready) continue;
        pending.delete(brand);
        try {
          const fetched = await baCall({ ads: 'ppcFetch', brand, id });
          Object.entries(fetched.asins || {}).forEach(([asin, figures]) => {
            // An ASIN can only belong to one brand, so this is a merge, not a sum across brands.
            merged[asin] = figures;
          });
        } catch (e) {
          failed.push(`${BRAND_NAME[brand]}: ${e.message || e}`);
        }
      }
      if (!pending.size) break;
      aMsg(`Amazon is building the PPC report${pending.size > 1 ? 's' : ''} for ${[...pending.keys()].map(brand => BRAND_NAME[brand]).join(' and ')} — waiting (${tick + 1}/${PPC_POLL_MAX})…`);
      await new Promise(resolve => setTimeout(resolve, PPC_POLL_MS));
    }
    if (pending.size) failed.push(`${[...pending.keys()].map(brand => BRAND_NAME[brand]).join(', ')}: still not ready after ${Math.round(PPC_POLL_MAX * PPC_POLL_MS / 60000)} minutes.`);

    const n = Object.keys(merged).length;
    if (!n) throw new Error(failed.join(' · ') || 'No PPC rows came back.');

    // --- keep, draw, save for everyone ---
    const [start, end] = window_.split(' → ');
    PPC30 = { asins: merged, at: new Date().toISOString().slice(0, 16).replace('T', ' '), start: start || '', end: end || '' };
    renderAudit();
    try {
      await fsSetDoc(doc(db, 'audit', 'ppc30'), { asins: merged, at: PPC30.at, start: PPC30.start, end: PPC30.end, n, by: ME.email, saved: serverTimestamp() });
      aMsg(`PPC updated — ${n.toLocaleString('en-US')} advertised ASINs, ${window_}.`
        + (failed.length ? ` (${failed.join(' · ')})` : ''), failed.length > 0);
    } catch (e) {
      aMsg(`PPC pulled, but could not be saved for others: ${e.message || e}`, true);
    }
  } catch (e) {
    aMsg('Could not pull PPC: ' + (e.message || e), true);
  }
  btn.disabled = false;
  btn.textContent = 'Pull PPC';
}

/**
 * Re-run the backend's 30-day Orders scan and cache the result for everyone.
 *
 * WALKED IN CHUNKS, one bounded slice of one workbook per request. Asking the backend for the whole
 * scan in one go was what produced "Failed to fetch": the request outlived what the browser will
 * wait for and died as a bare network error, which reads like a broken endpoint rather than a slow
 * one. Each slice now returns in seconds, the row counter shows it is alive, and a workbook of any
 * size just means more slices.
 *
 * It stays a manual button rather than something the grid does on open — even chunked, a full walk
 * is a minute of work, and the figures only move once a day.
 */
const SALES30_CHUNK = 20000;
const SALES30_MAX_CHUNKS = 400;    // ~8M rows; a backstop against a `next` that never terminates

// Pull sales: walk the Orders workbooks slice by slice through the backend, sum units and revenue per ASIN, save for everyone.
async function pullSales30() {
  const btn = $('aSales');
  btn.disabled = true;
  btn.textContent = 'Pulling…';
  const merged = {};
  let at = '';
  let chunks = 0;
  try {
    // Book 0 is walked to its end, then book 1. `books` comes back with the first reply, so adding a
    // third Orders workbook on the backend needs no change here.
    let book = 0;
    let books = 1;
    while (book < books) {
      let start = 2;
      for (;;) {
        const reply = await baCall({ sales30: 'chunk', book, start, n: SALES30_CHUNK });
        books = reply.books || books;
        at = reply.at || at;
        Object.entries(reply.asins || {}).forEach(([asin, figures]) => {
          const cur = merged[asin] || (merged[asin] = [0, 0]);
          cur[0] += figures[0];
          cur[1] += figures[1];
        });
        const done = Math.min(start + (reply.read || 0) - 1, reply.lastRow || 0);
        aMsg(`Reading orders — workbook ${book + 1} of ${books}, row ${done.toLocaleString('en-US')} of ${(reply.lastRow || 0).toLocaleString('en-US')}…`);
        if (reply.done || !reply.next) break;
        start = reply.next;
        if (++chunks > SALES30_MAX_CHUNKS) throw new Error('Stopped after ' + SALES30_MAX_CHUNKS + ' slices — the backend is not reporting the end of the sheet.');
      }
      book++;
    }
    // Rounded once, at the end: each slice carried a partial sum, and rounding those as they came in
    // would have drifted by up to half a cent per slice.
    Object.keys(merged).forEach(asin => { merged[asin][1] = Math.round(merged[asin][1] * 100) / 100; });
    SALES30 = { asins: merged, at: at || new Date().toISOString().slice(0, 16).replace('T', ' ') };
    const n = Object.keys(merged).length;
    renderAudit();
    try {
      await fsSetDoc(doc(db, 'audit', 'sales30'), { asins: merged, at: SALES30.at, n, by: ME.email, saved: serverTimestamp() });
      aMsg(`Sales updated — ${n.toLocaleString('en-US')} ASINs, as at ${SALES30.at}.`);
    } catch (e) {
      // The numbers are already on screen and usable; only sharing them with everyone else failed.
      aMsg(`Sales pulled, but could not be saved for others: ${e.message || e}`, true);
    }
  } catch (e) {
    const msg = String(e.message || e);
    aMsg('Could not pull sales: ' + msg
      + (/failed to fetch|networkerror/i.test(msg) ? ' — the backend did not answer. Check that Settings → the API URL points at the current Apps Script deployment.' : ''), true);
  }
  btn.disabled = false;
  btn.textContent = 'Pull sales';
}

/**
 * "A month after launch, flag it for review if it is doing less than $6,000 a month."
 *
 * Three things have to be true before this says anything, and each silence is deliberate:
 *   · a launch date is set          — without one there is no clock, so nothing is due
 *   · that date is 30+ days old     — judging a launch in week two is judging noise
 *   · the sales figures are loaded  — an empty cache is "not measured", never "sold nothing"
 * Returns null when it has nothing to say, so the caller can treat any object as a real verdict.
 */
// Returns { k: young | nodata | review | ok, age, why } for one parent row, or null when there is no launch date.
function reviewFlag(row) {
  const ms = dayMs(row.L?.launch);
  if (!ms) return null;
  const age = Math.floor((Date.now() - ms) / DAY_MS);
  if (age < LAUNCH_REVIEW_DAYS) return { k: 'young', age, why: `Launched ${age} day${age === 1 ? '' : 's'} ago — reviewed at ${LAUNCH_REVIEW_DAYS} days.` };
  if (!SALES30.at || row.sale30 == null) return { k: 'nodata', age, why: `${age} days since launch, but no sales figures are loaded. Hit “Pull sales”.` };
  if (row.sale30 < LAUNCH_REVIEW_MIN) {
    return { k: 'review', age, why: `$${Math.round(row.sale30).toLocaleString('en-US')} in the last 30 days, against a $${LAUNCH_REVIEW_MIN.toLocaleString('en-US')} bar — ${age} days after launch. Needs a review.` };
  }
  return { k: 'ok', age, why: `$${Math.round(row.sale30).toLocaleString('en-US')} in the last 30 days — past the $${LAUNCH_REVIEW_MIN.toLocaleString('en-US')} bar.` };
}

/**
 * Parent rows for the audit grid. Three sources, merged by key so none can shadow another:
 *   1. the listing-health snapshot (real Amazon parents — the live truth, never copied)
 *   2. manually-added parents (a product not on Amazon yet)
 *   3. any parent that already has documents but is in neither of the above (so an off-Amazon parent
 *      whose listing was later removed never loses its attached work)
 */
// Returns one row per parent for the brand picker's brands: counts, documents, owners, launch details, sales, PPC, the review flag.
function auditParents() {
  const pick = $('aBrandView').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]);
  const out = [];
  brands.forEach(brandKey => {
    // --- 1. the Listing Health parents, with each child's sales and PPC added up ---
    const byKey = {};
    (HEALTH[brandKey]?.rows || []).forEach(row => {
      const key = row.parent || row.asin || row.sku;
      if (!key) return;
      const group = byKey[key] || (byKey[key] = { parent: key, brand: brandKey, children: 0, childTitle: '', manualName: '', manual: false, sale30: null });
      group.children++;
      if (!group.childTitle && row.title) group.childTitle = row.title;
      // Sales are recorded per CHILD ASIN; the launch is judged per parent, so they add up here.
      // null (never touched) and 0 (sold nothing) are kept apart — "no data" and "no sales" are
      // different answers, and only the second one deserves a flag.
      const sales = row.asin ? SALES30.asins[String(row.asin).toUpperCase()] : null;
      if (sales) group.sale30 = (group.sale30 || 0) + (Number(sales[1]) || 0);
      else if (row.asin && SALES30.at) group.sale30 = group.sale30 || 0;
      // PPC, same shape: recorded per advertised child ASIN, judged per parent.
      // [impressions, clicks, spend, orders, adSales]
      const ads = row.asin ? PPC30.asins[String(row.asin).toUpperCase()] : null;
      if (ads) {
        group.ppcClicks = (group.ppcClicks || 0) + (Number(ads[1]) || 0);
        group.ppcSpend = (group.ppcSpend || 0) + (Number(ads[2]) || 0);
        group.ppcOrders = (group.ppcOrders || 0) + (Number(ads[3]) || 0);
        group.ppcSales = (group.ppcSales || 0) + (Number(ads[4]) || 0);
      } else if (row.asin && PPC30.at) {
        // Pulled, but this ASIN was not advertised — that is a real zero, not a missing figure.
        group.ppcSpend = group.ppcSpend || 0;
      }
    });
    // --- 2. the hand-typed parents, 3. parents that only have documents ---
    Object.entries(AUDIT_MANUAL[brandKey] || {}).forEach(([id, manual]) => {
      const group = byKey[id] || (byKey[id] = { parent: id, brand: brandKey, children: 0, childTitle: '', manualName: '', manual: true });
      group.manual = group.children === 0;    // if Amazon later has this ASIN, it stops being "manual"
      group.manualName = manual?.name || '';
    });
    Object.keys(AUDIT[brandKey] || {}).forEach(id => {
      if (!byKey[id]) byKey[id] = { parent: id, brand: brandKey, children: 0, childTitle: '', manualName: '', manual: true };
    });
    // --- the name, the document counts, the owners, the launch side ---
    Object.values(byKey).forEach(group => {
      // Name priority: hand-typed → Amazon's own listing name → the manual name (its OWN name, NO
      // "~") → a child's title marked "~". A manual name is the parent's real name, never borrowed.
      group.title = PNAME[brandKey]?.[group.parent]?.v || HEALTH[brandKey]?.parentNames?.[group.parent]
        || group.manualName || (group.childTitle ? '~ ' + group.childTitle : '');
      group.docs = (AUDIT[brandKey] || {})[group.parent] || {};
      group.have = AUDIT_DOCS.filter(def => latestVersion(group.docs[def.k])).length;
      group.missing = AUDIT_DOCS.length - group.have;
      group.pending = AUDIT_DOCS.filter(def => latestVersion(group.docs[def.k])?.status === 'pending').length;
      group.approved = AUDIT_DOCS.filter(def => latestVersion(group.docs[def.k])?.status === 'approved').length;
      // Distinct owners across the newest version of each slot. Distinct because one person usually
      // owns all six, and repeating their name six times in a grid cell says nothing extra.
      group.owners = [...new Set(AUDIT_DOCS
        .map(def => {
          const slot = group.docs[def.k];
          const version = latestVersion(slot);
          // The version's own owner first, then whoever the slot is assigned to, then whoever
          // uploaded it — most specific answer to "whose is this" that exists.
          return ownerShort((version && version.owner) || (slot && slot.own) || (version && version.by) || '');
        })
        .filter(Boolean))].join(', ');
      group.L = (LAUNCH[brandKey] || {})[group.parent] || null;
      group.eta = etaOf(group.L);
      // How much of the launch checklist is switched on. Influencers count once any were shipped to.
      group.launched = group.L ? ['vine', 'cc', 'ppc', 'meta'].filter(flag => group.L[flag]).length + (group.L.infl > 0 ? 1 : 0) : 0;
      group.review = reviewFlag(group);
      out.push(group);
    });
  });
  return out;
}

// Draw the audit grid: filter the parent rows, build the column definitions, sort, draw the table, footer and KPI cards.
function renderAudit() {
  const _t0 = performance.now();   // perf probe — see the "[audit] … rows … ms" console line
  // --- the status picker and the search box ---
  let rows = auditParents();
  const view = $('aStatusView').value;
  if (view === 'incomplete') rows = rows.filter(row => row.missing > 0);
  else if (view === 'complete') rows = rows.filter(row => row.missing === 0);
  else if (view === 'empty') rows = rows.filter(row => row.have === 0);
  else if (view === 'pending') rows = rows.filter(row => row.pending > 0);
  else if (view === 'rejected') rows = rows.filter(row =>
    AUDIT_DOCS.some(def => latestVersion(row.docs[def.k])?.status === 'rejected'));
  else if (view === 'review') rows = rows.filter(row => row.review?.k === 'review');
  else if (view === 'shipping') rows = rows.filter(row => row.eta && dayMs(row.eta.date) >= Date.now() - DAY_MS);

  const search = $('aFilter').value.trim().toLowerCase();
  if (search) rows = rows.filter(row => (row.parent + ' ' + (row.title || '')).toLowerCase().includes(search));

  // --- the columns: parent, name, children, one per document type, owners and the counts ---
  const multiBrand = new Set(rows.map(row => row.brand)).size > 1;
  const esc0 = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const defs = [{ k: 'parent', t: 'Parent ASIN', frz: 1, mono: 1,
    // A manual parent gets a quiet "manual" tag and a remove control; a real Amazon one doesn't.
    cell: row => `${esc0(row.parent)}` + (row.manual
      ? ` <span class="st st-draft" title="Added manually — not on Amazon yet">manual</span>`
        + ` <span class="docadd" data-delparent="${esc0(row.brand)}|${esc0(row.parent)}" title="Remove this manual parent">✕</span>`
      : '') }];
  if (multiBrand) defs.push({ k: 'brand', t: 'Brand', map: row => BRAND_NAME[row.brand] });
  defs.push({ k: 'title', t: 'Parent name', trunc: 34,
    cell: row => parentNameCell(row.brand, row.parent, row.title, 34) });
  defs.push({ k: 'children', t: 'Children', num: 1, map: row => row.manual ? null : row.children });
  AUDIT_DOCS.forEach(def => defs.push({ k: def.k, t: def.t, docCol: def.k, noTotal: 1, tip: def.tip,
    map: row => latestVersion(row.docs[def.k])?.name || '' }));
  // Who to chase, without opening six dialogs to find out. Owner is recorded per VERSION, so a
  // parent can legitimately have several — they are listed, newest slot first, rather than picking
  // one and hiding the rest.
  defs.push({ k: 'owners', t: 'Owner', trunc: 22,
    tip: 'Whoever each uploaded document belongs to. Set it on any version — it defaults to whoever added the link.' });
  defs.push({ k: 'have', t: 'Have', num: 1, bold: 1, tip: `Slots with at least one version, out of ${AUDIT_DOCS.length}.` });
  defs.push({ k: 'pending', t: 'Pending', num: 1, tip: 'Slots whose newest version is waiting for approval.' });
  defs.push({ k: 'approved', t: 'Approved', num: 1, tip: 'Slots whose newest version is approved.' });
  defs.push({ k: 'missing', t: 'Missing', num: 1 });

  /* ---- the launch side: shipment, then what was switched on, then how it did ----
     Every one of these cells opens the same dialog, because they are all one decision about one
     parent — hunting for the single editable cell is exactly the kind of thing that gets skipped. */
  const edit = row => `data-launch="${esc0(row.brand)}|${esc0(row.parent)}" style="cursor:pointer"`;
  const yes = (on, label, tip) => on
    ? `<span class="st st-approved" title="${esc0(tip)}">${esc0(label)}</span>`
    : `<span class="muted" title="${esc0(tip)}">—</span>`;

  defs.push({ k: 'ship', t: 'Shipment', noTotal: 1, map: row => row.L?.ship || '',
    tip: 'Dispatch date and lane (air or sea). Click any launch cell to edit them.',
    cell: row => {
      if (!row.L?.ship && !row.L?.mode) return `<span class="docadd" ${edit(row)}>+ Add</span>`;
      const lane = row.L.mode
        ? `<span class="st st-${row.L.mode === 'air' ? 'pending' : 'draft'}">${row.L.mode === 'air' ? 'Air' : 'Sea'}</span> `
        : '';
      return `<span ${edit(row)}>${lane}${esc0(row.L.ship || '—')}</span>`;
    } });
  defs.push({ k: 'eta', t: 'Tentative arrival', noTotal: 1, map: row => row.eta?.date || '',
    tip: `Worked out from the dispatch date and the lane: air +${SHIP_LEAD.air} days, sea +${SHIP_LEAD.sea} days (both editable in the toolbar). Type a date in the dialog to override it.`,
    cell: row => {
      if (!row.eta) return '<span class="muted">—</span>';
      return `<span ${edit(row)} title="${row.eta.auto ? `Estimated: ${esc0(row.L.ship)} + ${SHIP_LEAD[row.L.mode]} days by ${row.L.mode}` : 'Set by hand'}">${
        esc0(row.eta.date)}${row.eta.auto ? ' <span class="muted" style="font-size:10px">est</span>' : ''}</span>`;
    } });
  defs.push({ k: 'vine', t: 'Vine', noTotal: 1, map: row => (row.L?.vine ? 'Yes' : ''),
    tip: 'Was the product enrolled in Amazon Vine?',
    cell: row => `<span ${edit(row)}>${yes(row.L?.vine, 'Yes', 'Enrolled in Vine')}</span>` });
  defs.push({ k: 'infl', t: 'Influencers', num: 1, map: row => (row.L?.infl || null),
    tip: 'How many influencers the product was shipped to.',
    cell: row => `<span ${edit(row)}>${row.L?.infl > 0 ? Number(row.L.infl).toLocaleString('en-US') : '<span class="muted">—</span>'}</span>` });
  defs.push({ k: 'cc', t: 'Creator Connections', noTotal: 1, map: row => (row.L?.cc ? 'Yes' : ''),
    tip: 'Has a Creator Connections campaign been started on this parent?',
    cell: row => `<span ${edit(row)}>${yes(row.L?.cc, 'Started', 'Creator Connections running')}</span>` });
  // PPC is no longer a tick: once "Pull PPC" has run, the spend itself says whether campaigns are
  // live, and it says it more honestly than a checkbox somebody forgot to update. The manual flag is
  // still the answer for a parent Amazon reports nothing for (never advertised, or not pulled yet).
  defs.push({ k: 'ppc', t: 'PPC spend', num: 1, map: row => (row.ppcSpend == null ? null : row.ppcSpend),
    tip: `Sponsored Products spend on this parent's children over the pulled window${
      PPC30.start ? ` (${PPC30.start} → ${PPC30.end})` : ' — hit “Pull PPC”'}. Live from the Amazon Ads API.`,
    cell: row => {
      if (row.ppcSpend == null) return `<span ${edit(row)}>${yes(row.L?.ppc, 'Started', 'Marked as running by hand — no Ads figures pulled for this parent')}</span>`;
      if (!row.ppcSpend) return `<span class="muted" title="Pulled, and Amazon reports no Sponsored Products spend on this parent">$0</span>`;
      return `<span title="${row.ppcClicks ? Number(row.ppcClicks).toLocaleString('en-US') + ' clicks · ' : ''}${
        Number(row.ppcOrders || 0).toLocaleString('en-US')} ad orders">$${Math.round(row.ppcSpend).toLocaleString('en-US')}</span>`;
    } });
  defs.push({ k: 'ppcSales', t: 'PPC sales', num: 1, map: row => (row.ppcSales == null ? null : row.ppcSales),
    tip: 'Sales Amazon attributes to those ads over the same window.',
    cell: row => (row.ppcSales ? `$${Math.round(row.ppcSales).toLocaleString('en-US')}` : '<span class="muted">—</span>') });
  defs.push({ k: 'acos', t: 'ACOS', noTotal: 1,
    map: row => (row.ppcSpend && row.ppcSales ? Math.round(row.ppcSpend / row.ppcSales * 100) : null),
    tip: 'Spend ÷ ad sales. Blank when there was no spend, or spend with nothing attributed back.',
    cell: row => {
      if (!row.ppcSpend) return '<span class="muted">—</span>';
      if (!row.ppcSales) return `<span class="gd gd-bad" title="$${Math.round(row.ppcSpend).toLocaleString('en-US')} spent with no attributed sales">no sales</span>`;
      const ratio = Math.round(row.ppcSpend / row.ppcSales * 100);
      // 30% is the usual "is this paying for itself" line; over 60% it is clearly not.
      const cls = ratio <= 30 ? 'gd-good' : ratio <= 60 ? 'gd-warn' : 'gd-bad';
      return `<span class="gd ${cls}">${ratio}%</span>`;
    } });
  // TACOS sits next to ACOS because they disagree in a useful way. ACOS only sees the sales the ads
  // themselves claimed, so it can look fine while the ads quietly carry the whole listing. TACOS
  // divides the same spend by TOTAL sales, so it only comes down when organic sales grow — which is
  // the thing a launch is actually trying to achieve.
  defs.push({ k: 'tacos', t: 'TACOS', noTotal: 1,
    map: row => (row.ppcSpend && row.sale30 ? Math.round(row.ppcSpend / row.sale30 * 100) : null),
    tip: 'Ad spend ÷ TOTAL 30-day sales, not just the sales the ads claimed. Needs both “Pull PPC” and “Pull sales”.',
    cell: row => {
      if (!row.ppcSpend) return '<span class="muted">—</span>';
      if (row.sale30 == null) return '<span class="muted" title="Ad spend is known, but total sales are not — hit “Pull sales”">—</span>';
      if (!row.sale30) return `<span class="gd gd-bad" title="$${Math.round(row.ppcSpend).toLocaleString('en-US')} of ad spend and no sales at all in 30 days">no sales</span>`;
      const ratio = Math.round(row.ppcSpend / row.sale30 * 100);
      const cls = ratio <= 10 ? 'gd-good' : ratio <= 20 ? 'gd-warn' : 'gd-bad';
      return `<span class="gd ${cls}" title="$${Math.round(row.ppcSpend).toLocaleString('en-US')} spend ÷ $${
        Math.round(row.sale30).toLocaleString('en-US')} total sales">${ratio}%</span>`;
    } });
  defs.push({ k: 'meta', t: 'Meta ads', noTotal: 1, map: row => (row.L?.meta ? 'Yes' : ''),
    tip: 'Meta ads: $100 over 5 days per launch, kept on if it performs. The affiliate link is what makes the conversions readable.',
    cell: row => {
      const on = `<span ${edit(row)}>${yes(row.L?.meta, 'Started', 'Meta ads running')}</span>`;
      if (!row.L?.mlink) return on;
      return `${on} <a class="doc" href="${esc0(row.L.mlink)}" target="_blank" rel="noopener" title="Affiliate link — conversions">link</a>`;
    } });
  defs.push({ k: 'launch', t: 'Launched on', noTotal: 1, map: row => row.L?.launch || '',
    tip: `The date the listing went live. It starts the ${LAUNCH_REVIEW_DAYS}-day clock for the sales review.`,
    cell: row => `<span ${edit(row)}>${row.L?.launch ? esc0(row.L.launch) : '<span class="muted">—</span>'}</span>` });
  defs.push({ k: 'sale30', t: '30-day sales', num: 1, money: 1, map: row => row.sale30,
    tip: 'Real revenue over the last 30 days from your own Orders data, summed across the parent\'s children. Hit “Pull sales” to refresh.' });
  defs.push({ k: 'review', t: 'Review', noTotal: 1, map: row => (row.review?.k === 'review' ? 'Review' : ''),
    tip: `Flagged when a parent is ${LAUNCH_REVIEW_DAYS}+ days past launch and did under $${LAUNCH_REVIEW_MIN.toLocaleString('en-US')} in the last 30 days.`,
    cell: row => {
      const flag = row.review;
      if (!flag) return '<span class="muted">—</span>';
      if (flag.k === 'review') return `<span class="st st-rejected" title="${esc0(flag.why)}">⚑ Review</span>`;
      if (flag.k === 'ok') return `<span class="st st-approved" title="${esc0(flag.why)}">On track</span>`;
      if (flag.k === 'nodata') return `<span class="st st-pending" title="${esc0(flag.why)}">No sales data</span>`;
      return `<span class="muted" title="${esc0(flag.why)}">${flag.age}d</span>`;
    } });

  // --- sort, then draw (the first H_PAGE rows; totals, cards and Export use them all) ---
  const _tDefs = performance.now();
  const val = (row, def) => (def.map ? def.map(row) : row[def.k]);
  const sortDef = defs.find(def => def.k === AUDIT_SORT.k) || defs.find(def => def.k === 'have');
  rows.sort((a, b) => {
    const x = val(a, sortDef);
    const y = val(b, sortDef);
    const cmp = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x || '').localeCompare(String(y || ''));
    return cmp * AUDIT_SORT.dir;
  });

  AUDIT_RENDER = { rows, defs, val };
  const shown = rows.slice(0, H_PAGE);       // same DOM cap as the health grid, same reason

  const esc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const fmtNum = value => (value == null || value === '' ? '<span class="muted">—</span>' : Number(value).toLocaleString('en-US'));
  const arrow = def => def.k === AUDIT_SORT.k ? (AUDIT_SORT.dir < 0 ? ' ↓' : ' ↑') : '';

  const head = '<thead><tr>' + defs.map(def =>
    `<th data-k="${esc(def.k)}" class="${def.frz ? 'frz ' : ''}${def.num ? 'num' : ''}"${
      def.tip ? ` title="${esc(def.tip)}"` : ''}>${esc(def.t)}${arrow(def)}</th>`).join('') + '</tr></thead>';

  const body = shown.map(row => '<tr>' + defs.map(def => {
    const cls = (def.frz ? 'frz ' : '') + (def.num ? 'num' : '');
    if (def.cell) return `<td class="${cls}">${def.cell(row)}</td>`;
    if (def.docCol) {
      // --- a document column: the newest version's link and status pill, the owner under it ---
      const slot = row.docs[def.docCol];
      const last = latestVersion(slot);
      const open = `<span class="docadd" data-edit="${esc(row.brand)}|${esc(row.parent)}|${esc(def.docCol)}"`;
      // Whose job this is, printed even with nothing attached — an empty cell with a name on it is
      // work outstanding, an empty cell without one is work nobody has been asked to do, and the
      // difference is the whole point of the grid.
      const assigned = slot?.own
        ? `<div class="muted" style="font-size:10.5px;margin-top:2px" title="Assigned to">${esc(slot.own)}</div>`
        : '';
      if (!last) return `<td class="${cls}">${open}>+ Add</span>${assigned}</td>`;
      const nVersions = slot.v.length;
      // No icon: the status pill IS the click target for versions and approval, so the cell gains
      // nothing visually beyond what it already needs to show.
      const cell = `<a class="doc" href="${esc(last.url)}" target="_blank" rel="noopener"
            title="${esc(last.name || last.url)}${last.date ? ' · ' + esc(last.date) : ''}">${esc(last.name || 'Attached')}</a>`
        + ` ${open} title="Versions and approval" style="cursor:pointer"><span class="st st-${last.status}">${
            esc(AUDIT_STATUS[last.status] || last.status)}${nVersions > 1 ? ` · v${nVersions}` : ''}</span></span>`
        // Whose step this is, under the link. The point of recording an owner is that you can see it
        // without opening anything, so it is printed rather than hidden in a tooltip.
        + (last.owner || slot.own || last.by
            ? `<div class="muted" style="font-size:10.5px;margin-top:2px" title="Owner of this step">${esc(ownerShort(last.owner || slot.own || last.by))}</div>`
            : '');
      return `<td class="${cls}">${cell}</td>`;
    }
    const value = val(row, def);
    if (def.money) return `<td class="${cls}">${value == null || value === '' ? '<span class="muted">—</span>' : '$' + Math.round(value).toLocaleString('en-US')}</td>`;
    if (def.num) return `<td class="${cls}">${fmtNum(value)}</td>`;
    if (def.trunc) return `<td class="${cls}" title="${esc(value)}">${esc(String(value || '').slice(0, def.trunc))}</td>`;
    return `<td class="${cls}" style="${def.mono ? 'font-family:ui-monospace,monospace' : ''}">${esc(value) || '<span class="muted">—</span>'}</td>`;
  }).join('') + '</tr>').join('');

  // Only counts and money are added up; the rest of the footer stays blank.
  const foot = rows.length ? '<tfoot><tr>' + defs.map((def, i) => {
    if (i === 0) return `<td class="frz">TOTAL · ${rows.length}</td>`;
    if (!def.num || def.noTotal) return '<td></td>';
    const sum = rows.reduce((acc, row) => acc + (Number(val(row, def)) || 0), 0);
    return `<td class="num">${def.money ? '$' + Math.round(sum).toLocaleString('en-US') : fmtNum(sum)}</td>`;
  }).join('') + '</tr></tfoot>' : '';

  const _tHtml = performance.now();
  $('aTable').innerHTML = head + '<tbody>' + (body ||
    `<tr><td colspan="${defs.length}" class="muted">${HEALTH.SP || HEALTH.CPC
      ? 'No parents match.' : 'Run “Refresh both brands” on Listing health first — the parent list comes from there.'}</td></tr>`)
    + '</tbody>' + foot;
  const _tDom = performance.now();

  renderAuditKpis(rows);
  wireAuditTable();
  // Broken down on purpose: "slow" has four different cures depending on WHICH of these is big.
  // rows = walking the health snapshot · html = building the strings · dom = the browser parsing
  // and laying out the table (the one that points at the table being too wide, not too slow).
  const ms = value => Math.round(value);
  console.info(`[audit] ${shown.length}/${rows.length} rows · ${defs.length} cols · total ${ms(performance.now() - _t0)}ms`
    + ` (rows ${ms(_tDefs - _t0)} · html ${ms(_tHtml - _tDefs)} · dom ${ms(_tDom - _tHtml)})`);
}

/**
 * ONE click listener for the whole grid, attached once.
 *
 * Wiring each cell by hand meant a querySelectorAll sweep plus a closure per clickable element on
 * EVERY render — at 300 rows × 6 document columns + 8 launch columns + the parent name, that is
 * ~4,500 handlers re-created for each sort, filter and keystroke, which is what made this tab crawl.
 * Delegation costs one listener no matter how large the grid gets, and it keeps working for rows
 * that did not exist when it was attached.
 */
let AUDIT_WIRED = false;              // true once the grid's click listener is attached
// Attach the grid's single click listener (first render only) and route each click to the right dialog or sort.
function wireAuditTable() {
  if (AUDIT_WIRED) return;
  AUDIT_WIRED = true;
  $('aTable').addEventListener('click', e => {
    const target = e.target.closest('[data-edit],[data-launch],[data-pname],[data-delparent],th[data-k]');
    if (!target) return;
    // closest() already picked the innermost match, so these branches are simply "which kind is it".
    if (target.dataset.delparent) return removeManualParent(...target.dataset.delparent.split('|'));
    if (target.dataset.edit) return openAuditEditor(...target.dataset.edit.split('|'));
    if (target.dataset.launch) return openLaunchEditor(...target.dataset.launch.split('|'));
    if (target.dataset.pname) return openParentNameEditor(...target.dataset.pname.split('|'), renderAudit);
    if (target.dataset.k) {
      // a header cell: sort by that column, or flip the direction if it is already the sort key
      AUDIT_SORT = { k: target.dataset.k, dir: AUDIT_SORT.k === target.dataset.k ? -AUDIT_SORT.dir : -1 };
      renderAudit();
    }
  });
}

// Row "×": drop a hand-typed parent (after a confirm); its attached documents stay in the record.
async function removeManualParent(brand, id) {
  const hasDocs = Object.keys((AUDIT[brand] || {})[id] || {}).length;
  if (hasDocs && !confirm(`${id} has documents attached. Remove the parent anyway? The documents stay in the record but the row disappears.`)) return;
  if (!hasDocs && !confirm(`Remove manual parent ${id}?`)) return;
  if (AUDIT_MANUAL[brand]) delete AUDIT_MANUAL[brand][id];
  renderAudit();
  try {
    await saveManualParents(brand);
    aMsg(`Removed ${id}.`);
  } catch (e) {
    aMsg('Could not save: ' + (e.message || e), true);
  }
}

// The three KPI cards above the grid (documents, launch, PPC) for the rows on screen, plus the sidebar badge.
function renderAuditKpis(rows) {
  const nf = value => Number(value || 0).toLocaleString('en-US');
  const escK = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));

  // --- documents: coverage and the approval queue ---
  const total = rows.length;
  const complete = rows.filter(row => row.missing === 0).length;
  const attached = rows.reduce((acc, row) => acc + row.have, 0);
  const pending = rows.reduce((acc, row) => acc + row.pending, 0);
  const approved = rows.reduce((acc, row) => acc + row.approved, 0);
  const slots = total * AUDIT_DOCS.length;
  // Approvers get told what is waiting ON THEM, not just that something is pending somewhere.
  const mine = ME.approve ? pending : 0;

  // --- launch: live, flagged, in transit, first-month sales ---
  const launched = rows.filter(row => row.L?.launch).length;
  const flagged = rows.filter(row => row.review?.k === 'review').length;
  const inTransit = rows.filter(row => row.eta && dayMs(row.eta.date) >= Date.now() - DAY_MS).length;
  const money = value => '$' + Math.round(value || 0).toLocaleString('en-US');
  // Only launched parents are averaged — folding in every parent that was never launched would drag
  // the figure towards zero and say nothing about how the launches are actually doing.
  const launchedRows = rows.filter(row => row.L?.launch && row.sale30 != null);
  const sales = launchedRows.reduce((acc, row) => acc + row.sale30, 0);

  // --- PPC: spend, ad sales, ACOS, TACOS ---
  // PPC totals cover the whole filtered view, not just launched parents — ad spend is a running cost
  // on the entire catalogue, and hiding the older parents' share of it would flatter the number.
  const ppcSpend = rows.reduce((acc, row) => acc + (row.ppcSpend || 0), 0);
  const ppcSales = rows.reduce((acc, row) => acc + (row.ppcSales || 0), 0);
  const advertised = rows.filter(row => row.ppcSpend > 0).length;
  const acos = ppcSpend && ppcSales ? Math.round(ppcSpend / ppcSales * 100) : null;
  // TACOS is only meaningful over parents we know the TOTAL sales of, so the spend side is narrowed
  // to match. Dividing all spend by a partial sales figure would invent a number nobody can act on.
  const tacosRows = rows.filter(row => row.sale30 != null);
  const tacosSpend = tacosRows.reduce((acc, row) => acc + (row.ppcSpend || 0), 0);
  const tacosSales = tacosRows.reduce((acc, row) => acc + (row.sale30 || 0), 0);
  const tacos = tacosSpend && tacosSales ? Math.round(tacosSpend / tacosSales * 100) : null;

  // --- the three cards ---
  $('aKpis').innerHTML = `<div class="kpi">
    <div class="kpihead"><span class="kpiname">Document coverage</span>
      <span class="kpiwhen">${slots ? Math.round((attached / slots) * 100) : 0}% of all slots filled</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(complete)}</div><div class="l">Complete parents</div></div>
      <div class="metric"><div class="v" style="color:${pending ? 'var(--bad-ink)' : 'inherit'}">${nf(pending)}</div>
        <div class="l">${mine ? 'Waiting on you' : 'Awaiting approval'}</div></div>
      <div class="metric"><div class="v" style="font-size:15px">${nf(approved)}</div><div class="l">Approved</div></div>
      <div class="metric"><div class="v" style="font-size:15px">${nf(attached)} / ${nf(slots)}</div><div class="l">Documents attached</div></div>
    </div></div>
    <div class="kpi">
    <div class="kpihead"><span class="kpiname">Launch</span>
      <span class="kpiwhen">${SALES30.at ? 'sales as at ' + escK(SALES30.at) : 'no sales pulled yet — hit “Pull sales”'}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(launched)}</div><div class="l">Launched parents</div></div>
      <div class="metric"><div class="v">${nf(inTransit)}</div><div class="l">Arriving / in transit</div></div>
      <div class="metric"><div class="v" style="color:${flagged ? 'var(--bad-ink)' : 'inherit'}">${nf(flagged)}</div>
        <div class="l">⚑ Under $${nf(LAUNCH_REVIEW_MIN)} at ${LAUNCH_REVIEW_DAYS}d</div></div>
      <div class="metric"><div class="v" style="font-size:15px">${money(sales)}</div>
        <div class="l">30-day sales, launched parents</div></div>
    </div></div>
    <div class="kpi">
    <div class="kpihead"><span class="kpiname">PPC</span>
      <span class="kpiwhen">${PPC30.at ? escK(PPC30.start + ' → ' + PPC30.end) : 'not pulled yet — hit “Pull PPC”'}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v" style="font-size:15px">${money(ppcSpend)}</div><div class="l">Ad spend</div></div>
      <div class="metric"><div class="v" style="font-size:15px">${money(ppcSales)}</div><div class="l">Ad sales</div></div>
      <div class="metric"><div class="v" style="color:${acos != null && acos > 60 ? 'var(--bad-ink)' : 'inherit'}">${
        acos == null ? '—' : acos + '%'}</div><div class="l">ACOS</div></div>
      <div class="metric" title="Ad spend ÷ total sales across these parents. Only counts parents whose total sales are known."><div class="v" style="color:${
        tacos != null && tacos > 20 ? 'var(--bad-ink)' : 'inherit'}">${tacos == null ? '—' : tacos + '%'}</div><div class="l">TACOS</div></div>
      <div class="metric"><div class="v">${nf(advertised)}</div><div class="l">Parents advertised</div></div>
    </div></div>`;

  // --- sidebar badge ---
  // A badge on the sidebar so a pending item is visible without opening the tab.
  const btn = $('tabAudit');
  btn.textContent = 'Listing Audit' + (ME.approve && pending ? `  (${pending})` : '');
}

/** Every owner string already in use, for the suggestion list. Kept distinct and sorted. */
function auditOwnerNames() {
  const out = new Set();
  ['SP', 'CPC'].forEach(brand => Object.values(AUDIT[brand] || {}).forEach(parent => {
    Object.values(parent || {}).forEach(slot => {
      if (!slot) return;
      if (slot.own) out.add(slot.own);
      (slot.v || []).forEach(version => { if (version.owner) out.add(version.owner); });
    });
  }));
  return [...out].sort();
}

/**
 * Save who a slot belongs to, with no file attached.
 *
 * Kept on the SLOT rather than on a version because it answers a different question. A version's
 * owner is "who produced this file"; the slot's is "whose job this is" — which exists from the
 * moment the work is handed out, and is the only thing that can be shown in an empty cell.
 */
async function saveSlotOwner() {
  if (!AUDIT_EDIT) return;
  const { brand, parent, docKey } = AUDIT_EDIT;
  const own = $('aSlotOwner').value.trim();
  const byParent = AUDIT[brand] || (AUDIT[brand] = {});
  const slots = byParent[parent] || (byParent[parent] = {});
  const slot = slots[docKey] || (slots[docKey] = {});
  if (own) slot.own = own;
  else delete slot.own;
  try {
    await saveAuditCache(brand);
    aMsg(own ? `Assigned to ${own}.` : 'Owner cleared.');
    renderAudit();
  } catch (e) {
    $('aModalErr').textContent = 'Could not save: ' + (e.message || e);
    $('aModalErr').classList.remove('hide');
  }
}

/* ----- the attachment editor ----- */
// Open the document dialog for one slot: title, blank link fields, owner suggestions, version history.
function openAuditEditor(brand, parent, docKey) {
  AUDIT_EDIT = { brand, parent, docKey };
  const label = AUDIT_DOCS.find(docType => docType.k === docKey)?.t || docKey;
  $('aModalTitle').textContent = label;
  $('aModalSub').textContent = parent + ' · ' + (parentName(brand, parent, '') || '—') + ' · ' + BRAND_NAME[brand];
  $('aUrl').value = '';
  $('aName').value = '';
  $('aDate').value = new Date().toISOString().slice(0, 10);
  // Pre-filled with whoever owns the step today, so a follow-up version stays with the same person
  // unless someone deliberately hands it over. New slot → yourself.
  const slot0 = (AUDIT[brand] || {})[parent]?.[docKey];
  $('aOwner').value = latestVersion(slot0)?.owner || slot0?.own || ME.email;
  $('aSlotOwner').value = slot0?.own || '';
  // Names already used anywhere become suggestions, so the same person with the same designation is
  // not typed three slightly different ways across six slots and two hundred parents.
  $('aOwnerList').innerHTML = auditOwnerNames()
    .map(name => `<option value="${String(name).replace(/"/g, '&quot;')}">`).join('');
  $('aModalErr').classList.add('hide');
  renderVersions();
  $('aModal').classList.remove('hide');
  $('aUrl').focus();
}

/** The version history for the slot being edited, newest last, with the actions each one allows. */
function renderVersions() {
  if (!AUDIT_EDIT) return;
  const { brand, parent, docKey } = AUDIT_EDIT;
  const slot = (AUDIT[brand] || {})[parent]?.[docKey];
  const esc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  if (!slot?.v?.length) {
    $('aVersions').innerHTML = '<div class="muted" style="font-size:13px">No versions yet.</div>';
    return;
  }
  // --- one row per version: link, date, status, the buttons its status allows ---
  $('aVersions').innerHTML = slot.v.map((version, idx) => {
    const acts = [];
    if (version.status === 'draft' || version.status === 'rejected') acts.push(`<button class="xbtn" data-vsend="${idx}">Send for approval</button>`);
    // Only an approver may decide, and never on their own submission — a sign-off you gave yourself
    // is not an approval.
    if (version.status === 'pending' && ME.approve && version.by !== ME.email) {
      acts.push(`<button class="xbtn" data-vok="${idx}">Approve</button>`);
      acts.push(`<button class="xbtn" data-vno="${idx}">Reject</button>`);
    } else if (version.status === 'pending' && ME.approve && version.by === ME.email) {
      acts.push('<span class="muted" style="font-size:11px">your own submission</span>');
    }
    acts.push(`<button class="xbtn" data-vown="${idx}">Owner</button>`);
    acts.push(`<button class="xbtn" data-vdel="${idx}">Remove</button>`);
    return `<div class="vrow">
      <span class="muted" style="flex:0 0 26px">v${idx + 1}</span>
      <a class="doc" href="${esc(version.url)}" target="_blank" rel="noopener" style="flex:1;max-width:none">${esc(version.name || version.url)}</a>
      <span class="muted" style="flex:0 0 86px">${esc(version.date || '')}</span>
      <span class="st st-${version.status}" style="flex:0 0 auto">${esc(AUDIT_STATUS[version.status] || version.status)}</span>
      <span style="display:flex;gap:4px">${acts.join('')}</span>
    </div>`
      // the decision line (who approved / rejected, when, why) — only once a decision exists
      + (version.appr ? `<div class="muted" style="font-size:11px;margin:-4px 0 6px 34px">${
          version.status === 'approved' ? 'Approved' : 'Rejected'} by ${esc(version.appr)}${version.at ? ' on ' + esc(version.at) : ''}${
          version.note ? ' — ' + esc(version.note) : ''}</div>` : '')
      // Owner first: it is the live fact (who to chase), where "added by" is history.
      + `<div class="muted" style="font-size:11px;margin:-4px 0 6px 34px">Owner: ${
          esc(version.owner || version.by || '—')}${version.by ? ` · added by ${esc(version.by)}` : ''}</div>`;
  }).join('');

  // --- wire the buttons; each carries its version's index ---
  const slotRef = () => AUDIT[brand][parent][docKey];
  $('aVersions').querySelectorAll('[data-vsend]').forEach(btn => btn.onclick = () => versionAction(+btn.dataset.vsend, 'send'));
  $('aVersions').querySelectorAll('[data-vok]').forEach(btn => btn.onclick = () => versionAction(+btn.dataset.vok, 'approve'));
  $('aVersions').querySelectorAll('[data-vno]').forEach(btn => btn.onclick = () => versionAction(+btn.dataset.vno, 'reject'));
  $('aVersions').querySelectorAll('[data-vown]').forEach(btn => btn.onclick = () => versionAction(+btn.dataset.vown, 'owner'));
  $('aVersions').querySelectorAll('[data-vdel]').forEach(btn => btn.onclick = () => versionAction(+btn.dataset.vdel, 'remove'));
}

// One button on a version row: send / approve / reject / owner / remove, then save and (for send) tell the approvers.
async function versionAction(idx, what) {
  const { brand, parent, docKey } = AUDIT_EDIT;
  const slot = AUDIT[brand]?.[parent]?.[docKey];
  const version = slot?.v?.[idx];
  if (!version) return;
  const today = new Date().toISOString().slice(0, 10);

  // --- apply the action to the version ---
  if (what === 'send') {
    version.status = 'pending';
    version.by = version.by || ME.email;
    version.at = '';
    version.appr = '';
    version.note = '';
  } else if (what === 'approve') {
    version.status = 'approved';
    version.appr = ME.email;
    version.at = today;
  } else if (what === 'reject') {
    const note = prompt('Why is it rejected? (optional, but it saves the next person guessing)') || '';
    version.status = 'rejected';
    version.appr = ME.email;
    version.at = today;
    version.note = note.slice(0, 140);
  } else if (what === 'owner') {
    // Handing a step over does NOT touch its approval state — who owns the work and whether the
    // document passed are separate facts, and resetting one because the other changed loses a sign-off.
    const who = prompt('Who owns this step?', version.owner || version.by || ME.email);
    if (who == null) return;
    version.owner = who.trim().slice(0, 60);
  } else if (what === 'remove') {
    slot.v.splice(idx, 1);
    // the last version gone → drop the empty slot, and the parent too if it has no slots left
    if (!slot.v.length) {
      delete AUDIT[brand][parent][docKey];
      if (!Object.keys(AUDIT[brand][parent]).length) delete AUDIT[brand][parent];
    }
  }

  // --- redraw, then save ---
  renderVersions();
  renderAudit();
  try {
    await saveAuditCache(brand);
    if (what === 'send') await notifyApprovers(brand, parent, docKey, version);
  } catch (e) {
    aMsg('Could not save: ' + (e.message || e), true);
  }
}

/**
 * Tell the approvers something is waiting.
 *
 * In-app always works: the tab shows a pending count for anyone who can approve. Email is attempted
 * through the backend and is BEST EFFORT — it needs the mail scope on the Apps Script project, and
 * if that isn't granted the queue is still correct, so a failed email must never look like a failed
 * submission.
 */
async function notifyApprovers(brand, parent, docKey, version) {
  const label = AUDIT_DOCS.find(docType => docType.k === docKey)?.t || docKey;
  const pname = parentName(brand, parent, '') || parent;
  try {
    // --- who can approve (everyone with the flag, except the sender) ---
    const snap = await getDocs(collection(db, 'perms'));
    const to = [];
    snap.forEach(perm => { if (perm.data()?.approve === true && perm.id !== ME.email) to.push(perm.id); });
    if (!to.length) {
      aMsg('Sent for approval. No approver is set up yet — tick "Can approve" for someone under Settings → Access.');
      return;
    }
    aMsg(`Sent for approval to ${to.join(', ')}.`);
    // --- the email, best effort ---
    try {
      await baCall({ notify: 'approval', to: to.join(','),
        subj: `Approval pending: ${label} — ${pname}`,
        body: `${ME.email} sent a document for your approval.\n\n`
          + `Brand: ${BRAND_NAME[brand]}\nParent: ${parent} (${pname})\nDocument: ${label}\n`
          + `Version: ${version.name || '(no label)'} dated ${version.date || 'n/a'}\nLink: ${version.url}\n\n`
          + `Open the Listing audit tab to approve or reject.` });
    } catch (e) {
      // The queue is right either way; only the email failed.
      aMsg(`Sent for approval to ${to.join(', ')}. (Email could not be sent: ${e.message || e})`);
    }
  } catch (e) {
    aMsg('Sent for approval, but the approver list could not be read: ' + (e.message || e), true);
  }
}
// Close the document dialog.
function closeAuditEditor() {
  $('aModal').classList.add('hide');
  AUDIT_EDIT = null;
}
$('aCancel').onclick = closeAuditEditor;
$('aSlotSave').onclick = saveSlotOwner;
$('aModal').onclick = e => { if (e.target === $('aModal')) closeAuditEditor(); };    // click on the backdrop closes

// "Add version" / "Add and send": append the typed link as a new version (draft, or straight to pending).
async function addVersion(send) {
  if (!AUDIT_EDIT) return;
  const { brand, parent, docKey } = AUDIT_EDIT;
  const url = $('aUrl').value.trim();
  // A link that isn't a link is worse than an empty slot — it reads as "done" and fails only when
  // someone needs the file.
  if (!/^https?:\/\/\S+$/i.test(url)) {
    $('aModalErr').textContent = 'That is not a URL. Paste the Dropbox share link (it should start with https://).';
    $('aModalErr').classList.remove('hide');
    return;
  }
  $('aModalErr').classList.add('hide');
  AUDIT[brand] = AUDIT[brand] || {};
  AUDIT[brand][parent] = AUDIT[brand][parent] || {};
  const slot = AUDIT[brand][parent][docKey] = AUDIT[brand][parent][docKey] || { v: [] };
  const version = { url, name: $('aName').value.trim().slice(0, 60),
    date: $('aDate').value || new Date().toISOString().slice(0, 10),
    status: send ? 'pending' : 'draft', by: ME.email,
    owner: $('aOwner').value.trim().slice(0, 60) || ME.email };
  slot.v.push(version);
  // Versions are appended, never replaced — an older template stays on the record with its own date
  // and its own approval, which is the whole point of keeping them dated.
  $('aUrl').value = '';
  $('aName').value = '';
  renderVersions();
  renderAudit();
  try {
    await saveAuditCache(brand);
    if (send) await notifyApprovers(brand, parent, docKey, version);
    else {
      aMsg('Version added.');
      setTimeout(() => aMsg(''), 1500);
    }
  } catch (e) {
    aMsg('Could not save: ' + (e.message || e), true);
  }
}
$('aSave').onclick = () => addVersion(false);
$('aSaveSend').onclick = () => addVersion(true);

/* ----- the launch editor ----- */
// Open the launch dialog for one parent with whatever is recorded so far.
function openLaunchEditor(brand, parent) {
  LAUNCH_EDIT = { brand, parent };
  const details = (LAUNCH[brand] || {})[parent] || {};
  $('alSub').textContent = parent + ' · ' + (parentName(brand, parent, '') || '—') + ' · ' + BRAND_NAME[brand];
  $('alMode').value = details.mode || '';
  $('alShip').value = details.ship || '';
  $('alEta').value = details.eta || '';
  $('alLaunch').value = details.launch || '';
  $('alVine').checked = !!details.vine;
  $('alInfl').value = details.infl || '';
  $('alCc').checked = !!details.cc;
  $('alPpc').checked = !!details.ppc;
  $('alMeta').checked = !!details.meta;
  $('alLink').value = details.mlink || '';
  $('alNote').value = details.note || '';
  $('alErr').classList.add('hide');
  launchHint();
  $('alModal').classList.remove('hide');
  $('alMode').focus();
}
/**
 * The two lines under the dates: what the tentative arrival works out to, and where the parent
 * stands against the one-month sales review. Both are recomputed as the form is typed into, so the
 * consequence of picking "sea" instead of "air" is visible before anything is saved.
 */
function launchHint() {
  // --- arrival line ---
  const draft = { mode: $('alMode').value, ship: $('alShip').value, eta: $('alEta').value };
  const arrival = etaOf(draft);
  $('alEtaHint').textContent = !arrival
    ? 'Pick a mode and a dispatch date and the tentative arrival works itself out.'
    : arrival.auto
      ? `Tentative arrival ${arrival.date} — ${draft.ship} plus ${SHIP_LEAD[draft.mode]} days by ${draft.mode}. Type a date above to override it.`
      : `Arrival set by hand to ${arrival.date}. Clear that box to go back to the automatic ${
          etaOf({ mode: draft.mode, ship: draft.ship })?.date || 'estimate'}.`;

  // --- review line: the typed launch date against the row's 30-day sales ---
  const { brand, parent } = LAUNCH_EDIT || {};
  const row = AUDIT_RENDER.rows.find(r => r.brand === brand && r.parent === parent);
  const flag = reviewFlag({ L: { launch: $('alLaunch').value }, sale30: row ? row.sale30 : null });
  $('alReview').textContent = flag ? flag.why
    : `No launch date set, so the ${LAUNCH_REVIEW_DAYS}-day $${LAUNCH_REVIEW_MIN.toLocaleString('en-US')} review never fires for this parent.`;
}
['alMode', 'alShip', 'alEta', 'alLaunch'].forEach(id => $(id).addEventListener('change', launchHint));

// Close the launch dialog.
function closeLaunchEditor() {
  $('alModal').classList.add('hide');
  LAUNCH_EDIT = null;
}
$('alCancel').onclick = closeLaunchEditor;
$('alModal').onclick = e => { if (e.target === $('alModal')) closeLaunchEditor(); };    // click on the backdrop closes

// Save: validate the affiliate link, store the whole form as this parent's launch record.
$('alSave').onclick = async () => {
  if (!LAUNCH_EDIT) return;
  const { brand, parent } = LAUNCH_EDIT;
  const link = $('alLink').value.trim();
  // Same rule as the document links: a broken affiliate link reads as "tracked" and only fails when
  // someone goes looking for the conversions.
  if (link && !/^https?:\/\/\S+$/i.test(link)) {
    $('alErr').textContent = 'The affiliate link is not a URL. It should start with https://';
    $('alErr').classList.remove('hide');
    return;
  }
  $('alErr').classList.add('hide');
  LAUNCH[brand] = LAUNCH[brand] || {};
  LAUNCH[brand][parent] = {
    mode: $('alMode').value, ship: $('alShip').value, eta: $('alEta').value,
    launch: $('alLaunch').value, vine: $('alVine').checked,
    infl: Math.max(0, Number($('alInfl').value) || 0),
    cc: $('alCc').checked, ppc: $('alPpc').checked, meta: $('alMeta').checked,
    mlink: link, note: $('alNote').value.trim().slice(0, 140),
    by: ME.email, at: new Date().toISOString().slice(0, 10),
  };
  closeLaunchEditor();
  renderAudit();
  try {
    await saveLaunch(brand);
    aMsg('Launch details saved.');
    setTimeout(() => aMsg(''), 1500);
  } catch (e) {
    aMsg('Could not save: ' + (e.message || e), true);
  }
};
// Clear: forget every launch detail for this parent (after a confirm).
$('alClear').onclick = async () => {
  if (!LAUNCH_EDIT) return;
  const { brand, parent } = LAUNCH_EDIT;
  if (!confirm(`Clear every launch detail for ${parent}? The attached documents are not touched.`)) return;
  if (LAUNCH[brand]) delete LAUNCH[brand][parent];
  closeLaunchEditor();
  renderAudit();
  try {
    await saveLaunch(brand);
    aMsg('Launch details cleared.');
    setTimeout(() => aMsg(''), 1500);
  } catch (e) {
    aMsg('Could not save: ' + (e.message || e), true);
  }
};

/* ----- toolbar: sales pull + the transit days behind the tentative arrival date ----- */
$('aSales').onclick = pullSales30;
$('aPpc').onclick = pullPpc30;
loadShipLead();
// The two transit-day boxes (aLeadAir, aLeadSea): clamp to 1–365, keep, redraw if the tab is open.
['air', 'sea'].forEach(lane => {
  const el = $('aLead' + lane.charAt(0).toUpperCase() + lane.slice(1));
  el.value = SHIP_LEAD[lane];
  el.addEventListener('change', () => {
    const days = Math.max(1, Math.min(365, Number(el.value) || SHIP_LEAD[lane]));
    el.value = days;
    SHIP_LEAD[lane] = days;
    saveShipLead();
    if (!$('paneAudit').classList.contains('hide')) renderAudit();
  });
});

/* ----- backup: export / import the whole index ----- */
// Export: download documents, manual parents and launch details as one JSON file.
$('aExport').onclick = () => {
  // version 2 adds `launch`. A version-1 file still restores — the import simply finds no launch
  // section and leaves what is on screen alone, which is the same rule the rest of it follows.
  const payload = { kind: 'listing-audit', version: 2, exportedAt: new Date().toISOString(),
    docTypes: AUDIT_DOCS, data: AUDIT, manual: AUDIT_MANUAL, launch: LAUNCH };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `listing-audit-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
};

/* ----- add a parent that isn't on Amazon yet ----- */
// Open the add-parent dialog, pre-picking the brand the grid is filtered to.
$('aAddParent').onclick = () => {
  const pick = $('aBrandView').value;
  if (pick !== 'ALL') $('amBrand').value = pick;
  $('amId').value = '';
  $('amName').value = '';
  $('amErr').classList.add('hide');
  $('amModal').classList.remove('hide');
  $('amId').focus();
};
$('amCancel').onclick = () => $('amModal').classList.add('hide');
$('amModal').onclick = e => { if (e.target === $('amModal')) $('amModal').classList.add('hide'); };    // click on the backdrop closes
// Save the new manual parent: needs an identifier that is neither on Amazon nor already added.
$('amSave').onclick = async () => {
  const brand = $('amBrand').value;
  const id = $('amId').value.trim();
  const name = $('amName').value.trim().slice(0, 90);
  const err = message => {
    $('amErr').textContent = message;
    $('amErr').classList.remove('hide');
  };
  if (!id) return err('Give it an identifier — a planned ASIN, or any code you will recognise.');
  // Don't shadow a real Amazon parent, and don't create the same manual one twice.
  const onAmazon = (HEALTH[brand]?.rows || []).some(row => (row.parent || row.asin || row.sku) === id);
  if (onAmazon) return err('That parent already exists on Amazon — it is already in the list. Filter for it instead.');
  if (AUDIT_MANUAL[brand]?.[id]) return err('You have already added that identifier.');
  AUDIT_MANUAL[brand] = AUDIT_MANUAL[brand] || {};
  AUDIT_MANUAL[brand][id] = { name, at: new Date().toISOString().slice(0, 10), by: ME.email };
  $('amModal').classList.add('hide');
  renderAudit();
  try {
    await saveManualParents(brand);
    aMsg(`Added ${id}. Attach its documents from the row.`);
  } catch (e) {
    aMsg('Could not save the parent: ' + (e.message || e), true);
  }
};

// Import: read a backup file and MERGE it into what is on screen, then save all three records for both brands.
$('aImport').onclick = () => $('aFile').click();
$('aFile').onchange = async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';                                    // so re-picking the same file still fires
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.kind !== 'listing-audit' || !parsed.data) throw new Error('not a listing-audit backup file');
    // --- document versions ---
    // MERGE, never replace. An import that wiped attachments the file didn't happen to contain would
    // destroy work silently; anything already on screen survives unless the file has that same slot.
    // Versions are merged BY URL, so re-importing the same backup twice cannot duplicate them, and a
    // file written before versioning existed still restores (migrateAuditSlot lifts it).
    let added = 0;        // versions new to this browser
    let updated = 0;      // versions whose URL was already here (overwritten by the file's copy)
    ['SP', 'CPC'].forEach(brand => {
      Object.entries(parsed.data[brand] || {}).forEach(([parent, docs]) => {
        AUDIT[brand] = AUDIT[brand] || {};
        AUDIT[brand][parent] = AUDIT[brand][parent] || {};
        Object.entries(docs || {}).forEach(([key, raw]) => {
          const inc = migrateAuditSlot(raw);
          if (!inc?.v?.length) return;
          const slot = AUDIT[brand][parent][key] = AUDIT[brand][parent][key] || { v: [] };
          inc.v.forEach(newVersion => {
            if (!newVersion || !newVersion.url) return;
            const pos = slot.v.findIndex(existing => existing.url === newVersion.url);
            if (pos >= 0) {
              slot.v[pos] = newVersion;
              updated++;
            } else {
              slot.v.push(newVersion);
              added++;
            }
          });
          slot.v.sort((first, second) => String(first.date || '').localeCompare(String(second.date || '')));
        });
      });
    });
    // --- manual parents ---
    // Manual parents also merge, never replace — a backup missing one must not delete it.
    let manualAdded = 0;
    ['SP', 'CPC'].forEach(brand => {
      Object.entries((parsed.manual || {})[brand] || {}).forEach(([id, manual]) => {
        AUDIT_MANUAL[brand] = AUDIT_MANUAL[brand] || {};
        if (!AUDIT_MANUAL[brand][id]) {
          AUDIT_MANUAL[brand][id] = manual;
          manualAdded++;
        }
      });
    });
    // --- launch details ---
    // Launch details merge the same way: a parent already filled in on screen is left alone, so an
    // older backup can never roll back a launch someone has since recorded.
    let launchAdded = 0;
    ['SP', 'CPC'].forEach(brand => {
      Object.entries((parsed.launch || {})[brand] || {}).forEach(([id, details]) => {
        LAUNCH[brand] = LAUNCH[brand] || {};
        if (!LAUNCH[brand][id]) {
          LAUNCH[brand][id] = details;
          launchAdded++;
        }
      });
    });
    // --- redraw and save everything ---
    renderAudit();
    for (const brand of ['SP', 'CPC']) {
      await saveAuditCache(brand);
      await saveManualParents(brand);
      await saveLaunch(brand);
    }
    aMsg(`Imported — ${added} new document version(s), ${updated} overwritten, ${manualAdded} manual parent(s), ${launchAdded} launch record(s) added. Nothing else was touched (import merges, it does not replace).`);
  } catch (err) {
    aMsg('Import failed: ' + (err.message || err), true);
  }
};

/* ----- the filter box and the two view pickers redraw the grid ----- */
// Typing is debounced: one redraw 250 ms after the last keystroke.
$('aFilter').addEventListener('input', () => {
  clearTimeout(AUDIT_T);
  AUDIT_T = setTimeout(renderAudit, 250);
});
let AUDIT_T = 0;                      // the pending redraw timer
$('aBrandView').addEventListener('change', renderAudit);
$('aStatusView').addEventListener('change', renderAudit);

