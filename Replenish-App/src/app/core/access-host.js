/* ================= CORE · ACCESS (the ERP's half) =================
 * Screen: People & pay → Access — admins, and Access viewers (perms.accessView) who see it and change nothing.
 * Ravi, 4 Nov: "sellora access ko replenish app me shift karna h — sellora me sirf amazon ke access rahe". The page itself is
 * core/access-design.js, the SAME file Sellora runs (a test keeps the two copies equal); ACX_SIDE = 'erp' makes it show and
 * change the ERP's screens, the ERP's rights and Admin, and leave each person's Sellora half exactly as it is.
 * This file gives it what Sellora's own files give it there: the rights mirror (pt_perms, read by the database rules),
 * which ERP sections need nothing from Firestore, and the list of access records.
 * Main functions: ensureAccess, loadAccessList, permMirror. */
const ACX_SIDE = 'erp';

/* The factory sections read the production database over REST and need nothing from Firestore, so ticking only these
 * never turns perms.repl on (canRepl in the Firestore rules: read of config/api and the snapshot). Same list as Sellora's
 * admin-access.js FACTORY_SECTIONS — change one, change both. */
const FACTORY_SECTIONS = ['pmdb', 'mst', 'pbase', 'pcut', 'ppress', 'qc', 'qcalt', 'qcret', 'ord', 'so', 'vord', 'vreq', 'rfd', 'att',
  'hr', 'vend', 'vlog', 'cx', 'palloc', 'fgi', 'fgacc', 'fba', 'fab', 'acc', 'rep', 'pa', 'ka', 'shpacc', 'vpview',
  'flppc', 'fldem', 'flacc', 'flchl', 'flcut', 'flraw', 'flwip', 'gdesk', 'gdled', 'gdledit', 'gdappr'];

/* ---- the production database's own copy of the rights: pt_perms/<email, dots as commas> = { admin, r: {right: true}, t: {tab: true} }.
 * The same shape Sellora's rights-mirror.js writes and Pricing-App/rules/rules-tool.js compares against. */
const ACX_RTDB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const permKey = e => String(e || '').toLowerCase().split('.').join(',');
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
  const res = await fetch(`${ACX_RTDB}/pt_perms/${encodeURIComponent(permKey(email))}.json?auth=${tok}`, {
    method: d ? 'PUT' : 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: d ? JSON.stringify(Object.assign(permMirrorOf(d), { at: new Date().toISOString(), by: ME.email })) : undefined
  });
  if (!res.ok) throw new Error('the production database answered ' + res.status + ' for its copy of these rights');
}

/** Every access record, from the server only (a cache read once showed "nobody has access" while 50 people had it). */
async function loadAccessList() {
  if (!ME.admin && !ME.accessView) return;
  const src = $('acx-source');
  try {
    const snap = await getDocsFromServer(collection(db, 'perms'));
    const rows = [];
    snap.forEach(d => rows.push(Object.assign({ email: d.id }, d.data())));
    rows.sort((a, b) => a.email.localeCompare(b.email));
    if (typeof acxMount === 'function') acxMount(rows);
  } catch (e) {
    if (src) src.textContent = 'Could not read the access list, so nothing is shown and nobody\'s access has changed — Firestore may be out of reach from this network; try again in a moment. ('
      + String(e && (e.code || e.message) || e) + ')';
  }
}
let ACX_LOADED = false;
/** The Access screen opened: read the list (once per visit to the screen is enough; every change reads it again). */
function ensureAccess() {
  if (!ME.admin && !ME.accessView) return;
  if (ACX_LOADED) return;
  ACX_LOADED = true;
  loadAccessList().finally(() => { ACX_LOADED = false; });
}
