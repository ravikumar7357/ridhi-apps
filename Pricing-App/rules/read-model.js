/* WHO MAY READ EACH NODE — one model, used by build-rules.js to write the rules and by rules-tool.js to
 * say what every account should be able to read. Two copies of this would be two chances to disagree.
 *
 * The tabs come from read-map.json, which read-audit.js derives from the app's own call graph. What
 * that cannot see is added BY HAND below, each line with the reason — a reader reached from a button
 * rather than from opening a tab, or a node name passed as a variable.
 */
const fs = require('fs'), pathm = require('path');
const MAP = JSON.parse(fs.readFileSync(pathm.join(__dirname, 'read-map.json'), 'utf8'));

const BY_HAND = {
  /* CHANGE SKU (mdbRenameLoadAll) reads every register that carries a SKU, and SWALLOWS a refused read —
   * so a holder of "Can edit the master database" who could not read one of these would rename a SKU
   * in some registers and not in others. They are granted by the RIGHT, wherever the person's tabs are. */
  pt_qcChecks: { rights: ['mdbEdit'], tabs: ['rep'] },          // rep: the report's own Refresh and view switch
  pt_qcIssuance: { rights: ['mdbEdit'] },
  pt_fgiLedger: { rights: ['mdbEdit'] },
  pt_accLedger: { rights: ['mdbEdit'] },
  pt_skuPriority: { rights: ['mdbEdit'] },
  pt_customSkus: { rights: ['mdbEdit'], tabs: ['so', 'pmdb'] }, // soFormSave; the master database's view switch
  /* Vendor Orders' "Reserve" and "+ New order" read the sales orders; approving a request does too. */
  pt_salesOrders: { rights: ['mdbEdit'], tabs: ['vord', 'vreq'] },
  /* Assigning a Shopify line to a printer (spMirror) reads that printer's order from the Order Console. */
  pt_vendorOrders: { rights: ['mdbEdit'], tabs: ['ord', 'shopprod'] },
  /* KEPT, NOT DERIVED. These four could read the approval requests while the audit still followed the tab
   * switcher into every tab; with that fixed the call graph no longer reaches it from them. Taking a read
   * AWAY is the direction that breaks a screen, and a list of pending approvals is not a secret — so the
   * grant stays until somebody has watched those four screens work without it. */
  pt_approvals: { tabs: ['ka', 'pa', 'palloc', 'shop'] },
};

/* "CAN ADD AND DELETE EMPLOYEES" OPENS FINANCE & HR WITHOUT THE TAB (hrEmpOnly): the employee list, the extra
 * hours that count where a name is used, and the shared plumbing every factory screen loads. ensureHr
 * deliberately SKIPS the rest for such an account — so the right is given every node the hr tab reaches
 * EXCEPT these, which are exactly the ones that account must not see. */
const EMP_ONLY_NEVER = ['pt_rateList', 'pt_printerRates', 'pt_ehFreezes', 'pt_payoutFreezes', 'pt_advances', 'pt_vendorOrders', 'pt_vendorMap'];

/** { tabs: [...], rights: [...] } for one node — empty lists mean admins only. */
function readersOf(node) {
  /* JOB WORK'S COMPLETED ENTRIES (2026-10-01) are the same register kept in two places: whoever may read
   * pt_baseData may read pt_baseDone, and nobody else. The app reads it through a variable, so the call graph cannot see it. */
  if (node === 'pt_baseDone') return readersOf('pt_baseData');
  const a = (MAP.nodes[node] || {}).tabs || [], h = BY_HAND[node] || {};
  const rights = (h.rights || []).slice();
  if (a.indexOf('hr') >= 0 && EMP_ONLY_NEVER.indexOf(node) < 0) rights.push('empEdit');
  return { tabs: [...new Set(a.concat(h.tabs || []))].sort(), rights: [...new Set(rights)].sort() };
}
/** Every node the app reads, plus the ones named only in the rules. */
const NODES = [...new Set(Object.keys(MAP.nodes).concat(Object.keys(BY_HAND), ['pt_baseDone']))].sort();

/** May this person (as Firestore describes them) read this node? Vendors and strangers never do here. */
function mayRead(p, node) {
  if (!p) return false;
  if (p.admin) return true;
  const r = readersOf(node);
  return r.tabs.some(t => p.t && p.t[t]) || r.rights.some(x => p.r && p.r[x]);
}
module.exports = { readersOf, NODES, mayRead, BY_HAND };
