/* ---------- Listing health ---------- */
/*
 * Two questions, deliberately kept apart because they need different fixes:
 *   BLOCKING  — the listing is not selling right now (inactive, no stock, no price).
 *   CONTENT   — the listing sells but is built thin (short title, few images/bullets, no description).
 * A listing can be perfect on content and still be dead, so the score never lets a good content
 * score hide a blocking fault: any blocking issue caps the grade at "Poor".
 *
 * The rules live HERE, in the browser, not in the backend — the backend is version-pinned, so a
 * scoring tweak there would cost a Manage-deployments round trip every time.
 */
const H_RULES = { minTitle: 80, maxTitle: 200, minBullets: 5, minImages: 6, minDesc: 200 };
// Virtual bundles carry no FBA stock of their own and would permanently read as "out of stock", so
// they are excluded. Identified by SKU prefix per the seller (RB01, RB02, RBD240 …). CHANGE THIS ONE
// REGEX if the convention changes — and the refresh always REPORTS how many rows it removed, so a
// rule that starts eating real listings shows up as a number instead of a silent disappearance.
const H_BUNDLE_RE = /^RB/i;
// Merchant-fulfilled listings are out of scope: their stock and pricing live outside FBA entirely.
const H_FBA_RE = /amazon|afn/i;
const H_CONTENT_MAX = 1500;                   // unique ASINs the content sweep will walk in one run
// Rows put in the DOM at once. NOT a cap on the data — totals, KPI cards and the CSV export all run
// over every filtered row. See the comment in renderHealth for why this exists.
const H_PAGE = 300;
// Catalog calls in flight during the content sweep. 3 roughly triples the sweep without pushing
// SP-API hard enough to sit in permanent 429 back-off.
const H_SWEEP_PAR = 3;
// A+ is one call PER ASIN, so a run is bounded and resumes next refresh. 1,500 ≈ 2 minutes.
const H_APLUS_MAX = 1500;
let HEALTH = { SP: null, CPC: null };
let H_LOADED = false;
let H_SORT = { k: 'score', dir: 1 };          // worst first by default
let H_RENDER = { rows: [], defs: [], val: () => '' };
let H_VIEW = 'child';         // 'child' = one row per listing, 'parent' = rolled up by parent ASIN
let H_SCOPE_NOTE = [];        // what was excluded / truncated — surfaced under "Raw fields"
let H_LAST_RUN = [];          // the last refresh's informational notes, same place

function hMsg(t, bad) { const m = $('hMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

/**
 * Score one listing. Returns { score, grade, blocking[], content[] }.
 * `c` (content) may be missing — a listing whose catalog data hasn't been fetched is scored on the
 * blocking side only and reported as "content not checked", NOT as a listing with zero images.
 */
