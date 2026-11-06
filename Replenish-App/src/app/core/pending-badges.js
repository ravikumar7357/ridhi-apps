/* PENDING BADGES (Step 1, badges part, of docs/data-reduction/PLAN.md).
 * At sign-in the app used to read four whole lists only to put a red number on a menu item: the vendor order requests,
 * the Sales Orders deletion requests, the Finished Goods corrections and the Job Work corrections. With the switch on
 * it asks the database for the PENDING rows of each list only, and counts those.
 *   - Switch: localStorage pendingBadges '0' = off on this device whatever the flag says, '1' = on, otherwise the last
 *     answer of the Firestore flag config/flags.pendingBadges (read in the same single read core/auth.js already makes
 *     for the data meter, and kept here in pbFlagLast for the NEXT page load). Off by default. Always off for vendors.
 *   - The count goes into PB.counts, apart from every screen's own list (VRQ.rows, ODR.rows, FGC.rows, JWC.rows stay null
 *     until that screen is opened and reads its whole list as before). Once a screen has its list, its own count wins.
 *   - If the question fails or is refused (for example the database index is not published yet) that one list is read
 *     whole, the way it always was. The reason goes to the console only; a failed question never shows 0.
 *   - Reading the RFD decisions at sign-in is skipped while the vendor orders are not loaded: the RFD count is built
 *     from the vendor orders, so it showed 0 anyway, and the RFD screen reads its own decisions when it is opened. */
const PB = { counts: {} };
const PB_NODES = { vrq: 'pt_vendorOrderReqs', odr: 'pt_obDeleteReqs', fgc: 'pt_fgiCorrReqs', jwc: 'pt_jwCorrReqs' };
/* A row only counts when it has an id where the full read also needs one (requests and deletion requests). */
const PB_NEEDS_ID = { vrq: true, odr: true };

/** On or off. Cheap: a couple of storage reads, no network. */
function pbOn() {
  try {
    const s = localStorage.getItem('pendingBadges');
    if (s === '0') return false;
    if (typeof AUDIT === 'undefined' || !AUDIT.on) return false;
    if (typeof spIsVendor === 'function' && spIsVendor()) return false;
    if (s === '1') return true;
    return localStorage.getItem('pbFlagLast') === '1';
  } catch (e) { return false; }
}
/** Keep the flag's last answer for the next page load. */
function pbSaveFlag(on) {
  try { if (on) localStorage.setItem('pbFlagLast', '1'); else localStorage.removeItem('pbFlagLast'); } catch (e) { /* no storage: stays off */ }
}
const pbCount = key => PB.counts[key] || 0;
/** Sign-in skips the RFD decisions only when the switch is on and the vendor orders are not loaded yet. */
const pbSkipRfdRead = () => pbOn() && typeof VO !== 'undefined' && VO.rows === null;

/** The pending rows of one list, straight from the database. Throws on anything but a clean answer. */
async function pbAskPending(node) {
  const q = await ptAuthQuery();
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), 30000) : null;
  try {
    const r = await fetch(`${PT_URL}/${ptPath(node)}.json?orderBy=%22status%22&equalTo=%22pending%22` + (q ? '&' + q.slice(1) : ''), ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error('the database answered ' + r.status);
    const v = await (typeof dmJson === 'function' ? dmJson(r, node, 'plain') : r.json());
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.error === 'string') throw new Error(v.error);
    return v;
  } finally { if (t) clearTimeout(t); }
}
/** How many of the rows the database sent are pending (counted again here, so a stray row never inflates it). */
function pbCountRows(key, v) {
  return ptList(v).filter(r => r && r.status === 'pending' && (!PB_NEEDS_ID[key] || r.id)).length;
}

/** The sign-in badge for one list. onCount redraws the badge; full is today's whole-list read (switch off, or fallback). */
async function pbLogin(key, onCount, full) {
  if (!pbOn()) return full();
  let v;
  try { v = await pbAskPending(PB_NODES[key]); }
  catch (e) { console.warn('[pending badges] ' + key + ': reading the whole list instead (' + ((e && e.message) || e) + ')'); return full(); }
  PB.counts[key] = pbCountRows(key, v);
  onCount();
}
