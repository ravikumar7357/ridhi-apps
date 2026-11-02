/* ================= CORE · ACCESS: who is signed in, and which tabs and brands they may see =================
 * Screens: the sidebar menu (which tab buttons show), the "no access" notice (noAccess), and the brand
 * pickers on the four advertising tabs.
 * Does: holds ME, the signed-in account's permissions, read from Firestore perms/{email} by loadMyPerms.
 * applyPerms then shows and hides the tab buttons and menu groups, trims the ad brand pickers and opens
 * the first tab the account may see. myBrands / adBrands answer "which brands?" for the catalogue tabs
 * (always both) and for the advertising tabs (only the ticked ones).
 * Main functions: myBrands, adBrands, applyBrandPicker, loadMyPerms, applyPerms. */

/* ---------- who is signed in, and what may they see ---------- */
/*
 * Access lives in perms/{email} = { admin, tabs: [...] }, and the FIRESTORE RULES are what actually
 * enforce it. What follows only builds the menu — hiding a button stops nobody who knows how to open
 * a console, so the rules gate every collection on the same permissions. Treat this as the polite
 * half of the mechanism, never the whole of it.
 *
 * Default is DENY: an account with no perms doc sees nothing. Adding a user in the Firebase console
 * is no longer the same thing as granting them the whole app.
 */
// The signed-in account: email, admin flag, the approve right, the tabs granted and the ad brands ticked.
let ME = { email: '', admin: false, approve: false, tabs: [], brands: [] };

/**
 * The brands this account may see. Empty means both — the common case, and the safe default when
 * nobody has thought about it.
 *
 * ⚠️ This is a DISPLAY restriction. The stored documents hold both brands together, so anyone who
 *    can read the tab can still read the other brand's figures straight from Firestore. It keeps
 *    the wrong brand off the screen; it is not isolation. Real isolation needs the data split into
 *    per-brand documents, which is a bigger change.
 */
/**
 * The brands this business sells under. BOTH, always.
 *
 * The brand ticks in Access are an ADVERTISING restriction ONLY (Ravi, 2026-08-23) — everything
 * else, the catalogue tabs, Listing Health, BSR, the Deal Calendar, shows both brands to everyone
 * who can open the tab at all. Anything that must honour the restriction calls `adBrands()`.
 */
function myBrands() { return ['SP', 'CPC']; }

/**
 * The brands this account may see ADVERTISING figures for.
 *
 * THE ONLY PLACE `perms.brands` IS HONOURED. A new ad tab that reaches for myBrands() instead will
 * compile, run, and quietly show both brands to an account restricted to one — so the four ad tabs
 * (PPC & Organic, Ad Console, Search Terms, Placement) and their nightly refreshes all come here.
 */
function adBrands() {
  if (ME.admin || !ME.brands.length) return ['SP', 'CPC'];
  return ME.brands.filter(b => b === 'SP' || b === 'CPC');
}
// The same answer under the name the Ad Console and Placement tabs call it by.
const tBrands = () => adBrands();
/** Trim a brand <select> to what this account may see, and lock it when only one is left. */
function applyBrandPicker(id) {
  const el = $(id);
  if (!el) return;
  const allowed = adBrands();
  if (allowed.length === 2) return;
  [...el.options].forEach(opt => { if (opt.value === 'ALL' || !allowed.includes(opt.value)) opt.remove(); });
  if (el.options.length === 1) el.disabled = true;
  el.value = allowed[0];
}

// Read perms/{email} into ME. No document, or one this account may not read, means no access at all.
async function loadMyPerms(user) {
  ME = { email: (user.email || '').toLowerCase(), admin: false, approve: false, tabs: [], brands: [] };
  try {
    const snap = await getDoc(doc(db, 'perms', ME.email));
    if (snap.exists()) {
      const data = snap.data();
      ME.admin = data.admin === true;
      ME.approve = data.approve === true;
      ME.tabs = Array.isArray(data.tabs) ? data.tabs : [];
      ME.brands = Array.isArray(data.brands) ? data.brands : [];
    }
  } catch (e) { /* unreadable perms = no perms; the notice below explains it */ }
  // The owner is always an admin so the account can never lock itself out. Keep this in step with
  // OWNER_EMAIL in firestore.rules — the rules are what actually grant it.
  if (ME.email === 'ravi@thefabricrush.com') ME.admin = true;
  // An admin can always approve; otherwise it is granted explicitly.
  if (ME.admin) {
    ME.tabs = TABS.slice();
    ME.approve = true;
  }
}

// Build the menu from ME: show the granted tab buttons, trim the ad brand pickers, drop menu groups with
// nothing left in them, and open the first tab allowed — or the "no access" notice when there is none.
function applyPerms() {
  // May this account open tab t? An admin may; so may anyone granted it, or granted the tab it comes with.
  const allowed = t => ME.admin || ME.tabs.includes(t) || (!!TAB_INHERIT[t] && ME.tabs.includes(TAB_INHERIT[t]));
  // --- tab buttons ---
  TABS.forEach(t => {
    const hide = HIDDEN_TABS.includes(t) || !allowed(t);
    $('tab' + capId(t)).classList.toggle('hide', hide);
  });
  // --- ad brand pickers ---
  // The brand pickers on the FOUR ADVERTISING TABS, trimmed to what this account may see. Done once
  // here rather than in each tab's render, so an ad tab added later cannot quietly forget it.
  // The other pickers — Deal Calendar, Listing Audit, Listing Health, BSR, Age — are deliberately
  // NOT in this list: the restriction is about ad figures, not about the catalogue.
  ['tBrand', 'wBrand', 'stBrand', 'plcBrand']
    .forEach(id => { try { applyBrandPicker(id); } catch (e) { /* that tab may not exist */ } });
  // --- menu groups, and the tab to open ---
  syncNavGroups(allowed);
  const first = TABS.find(t => !HIDDEN_TABS.includes(t) && allowed(t));
  if (first) {
    $('noAccess').classList.add('hide');
    showTab(first);
  } else {
    // Signed in but granted nothing. Say so plainly instead of showing an empty shell that looks broken.
    TABS.forEach(t => $('pane' + capId(t)).classList.add('hide'));
    $('settingsCard').classList.add('hide');
    $('noAccess').classList.remove('hide');
    $('noAccessWho').textContent = ME.email;
    $('pageTitle').textContent = '';
  }
}

