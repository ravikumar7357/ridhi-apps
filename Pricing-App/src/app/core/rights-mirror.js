/* ================= CORE · RIGHTS MIRROR, plus the helpers and defaults the whole app shares =================
 * Screens: Settings → Access (the mirror); every other screen uses the shared pieces below.
 * Does, in two parts:
 *   1. The rights mirror: every access right saved in Firestore is copied to the factory's Realtime
 *      Database as pt_perms/<email>, because that database's rules cannot read Firestore.
 *   2. Shared pieces that happen to live here: the Firestore handle `db`, the DOM helper `$`, the
 *      formatters `money` and `pct`, the costing defaults (DEFAULTS, KEYS, DEF_CATS, DEF_TIERS) and the
 *      three holders filled after sign-in: SET (settings), API (backend address and key), API_ERR.
 * Main functions: permKey, permMirrorOf, permMirror; helpers $, money, pct. */

/* ---- the production database's own copy of the rights ----
 *
 * The factory's data is in the Realtime Database, and its rules decide who may write the rate lists,
 * the payout freezes and the master database. Those rules cannot read Firestore — so every right
 * saved here is written there too, as pt_perms/<email, dots as commas> = { admin, r: {right: true},
 * t: {tab: true} }. Only an admin may write that node, so nobody can grant themselves anything.
 *
 * The shape is the one rules/rules-tool.js (beside this app) builds from Firestore and compares against:
 * every field that is exactly true becomes a right, replTabs become tabs. Change one, change both. */
const PT_RTDB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
// The node name for one person: the email in lower case with every dot turned into a comma (a key may not hold a dot).
const permKey = e => String(e || '').toLowerCase().split('.').join(',');
// One perms document in the mirror's shape: { admin, r: {right: true, …}, t: {tab: true, …} } — r and t only when not empty.
function permMirrorOf(d) {
  const m = { admin: d.admin === true }, r = {}, t = {};
  Object.keys(d).forEach(k => { if (k !== 'admin' && d[k] === true) r[k] = true; });
  (d.replTabs || []).forEach(x => { if (x) t[x] = true; });
  if (Object.keys(r).length) m.r = r;
  if (Object.keys(t).length) m.t = t;
  return m;
}
/** Write one person's copy, or remove it when d is null. Throws when the database does not take it. */
async function permMirror(email, d) {
  const tok = await auth.currentUser.getIdToken();
  const res = await fetch(`${PT_RTDB}/pt_perms/${encodeURIComponent(permKey(email))}.json?auth=${tok}`, {
    method: d ? 'PUT' : 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: d ? JSON.stringify(Object.assign(permMirrorOf(d), { at: new Date().toISOString(), by: ME.email })) : undefined
  });
  if (!res.ok) throw new Error('the production database answered ' + res.status + ' for its copy of these rights');
}

/* ---------- shared helpers: the Firestore handle, DOM lookup, number formats ---------- */
const db = getFirestore(app);

// The element with this id, or null when there is none.
const $ = id => document.getElementById(id);
// A money string: sign, then the currency mark (default $), then the amount with two decimals in Indian
// digit groups (en-IN: 1,23,456.00).
const money = (n, c = '$') => (n < 0 ? '-' : '') + c
  + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// A ratio as a percentage with one decimal: 0.1234 → "12.3%".
const pct = n => (n * 100).toFixed(1) + '%';

/* ---------- costing defaults: edited on the Settings screen, used by research/costing-maths.js ---------- */
// Defaults mirror the user's costing sheet ("Need Selling Price…xlsx").
// The keys are the Settings fields (input id s_<key>): profit = Target Profit %, tacos = TACOS %, return = Return
// Loss %, oh = Amazon OH %, salary = Emp. Salary %, ship = Shipping % of product cost, duty = Duty & Tax % of base
// cost, fx = USD → INR, factoh = Factory Overhead %, pm = P.M (markup ×; see baseDivisor in costing-maths.js).
const DEFAULTS = { profit: 20, tacos: 16, return: 3, oh: 10, salary: 10, ship: 30, duty: 15, fx: 90, factoh: 10, pm: 1.25 };
const KEYS = Object.keys(DEFAULTS);

// Referral % per category — a starting list, EDITABLE in Settings. Verify against Amazon: some
// categories differ, and several have a lower rate below a price threshold.
const DEF_CATS = [
  { name: 'Home & Kitchen', pct: 15 },
  { name: 'Furniture', pct: 15 },
  { name: 'Bedding / Bath', pct: 15 },
  { name: 'Toys & Games', pct: 15 },
  { name: 'Clothing & Accessories', pct: 17 },
  { name: 'Everything else', pct: 15 },
];
// FBA size tiers. Sizes are a starting point; FEES ARE DELIBERATELY 0 — the user fills them from
// Amazon's current rate card. Guessing a fee here would silently corrupt every sourcing decision,
// and a 0 fee is loud (the tool refuses to price until it's filled in).
const DEF_TIERS = [
  { name: 'Small standard', maxL: 15, maxW: 12, maxH: 0.75, maxWt: 1, fee: 0 },
  { name: 'Large standard', maxL: 18, maxW: 14, maxH: 8, maxWt: 20, fee: 0 },
  { name: 'Large bulky', maxL: 59, maxW: 33, maxH: 33, maxWt: 50, fee: 0 },
  { name: 'Extra-large', maxL: 108, maxW: 33, maxH: 33, maxWt: 150, fee: 0 },
];

/* ---------- filled in after sign-in (core/auth.js) ---------- */
// The saved settings over the defaults — loadSettings() in core/settings.js fills it.
let SET = { ...DEFAULTS };
let API = null;          // { url, key } — read from Firestore AFTER sign-in, never in this source
let API_ERR = '';        // why that read failed, carried to whichever tab reports it

