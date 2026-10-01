/* ================= FABRIC INVENTORY =================
 *
 * A ledger, and the balance that falls out of it. Every movement is a row; the stock is never stored
 * anywhere, it is always the sum of the rows — so a wrong balance can always be traced to a
 * transaction rather than argued about.
 *
 * THE SIGNS ARE THE WHOLE THING. Opening and every kind of receipt add; every kind of issue or send
 * subtracts; an adjustment carries its own sign, so a correction of −20 must be entered as −20 and
 * is not silently flipped. `CUT_WHITE` moves cloth between locations without changing how much there
 * is, so it counts as zero here.
 *
 * WHAT IS NOT PORTED, AND WHY: the old tool also tracks WHERE fabric is — RFD store, fabric store,
 * cut vs running, and what is out with a printer against an open send. Not one row in this data uses
 * any of it: all 511 are form RUNNING, state PRINTED, factory MU, and only three transaction types
 * appear. Building that model on no data would be building a guess, so the balance here is by fabric
 * and colour, and this says so rather than showing empty location columns.
 */
const FAB_SIGN = {
  OPENING: 1, RECEIVE_WHITE: 1, RECEIVE_PRINTED: 1, RECEIVE_FROM_FABRICATOR: 1,
  SEND_TO_PRINTER: -1, ISSUE_TO_CUTTING: -1, ISSUE_TO_STITCHERS: -1, SEND_TO_FABRICATOR: -1,
  CUT_WHITE: 0,          // a move between locations, not a change in how much cloth exists
  ADJUST: 1,             // carries its own sign in the quantity
  /* ---- the cloth's earlier lives ----
   * Greige in from the mill, out to the processing house, and back as RFD. The two halves of that
   * round trip are separate movements on purpose: what is with the processor is neither greige stock
   * nor RFD stock, and a factory that cannot see that number cannot chase it. */
  RECEIVE_GREIGE: 1, ISSUE_TO_RFD: -1, RECEIVE_RFD: 1,
  /* RFD ALREADY ON THE FLOOR the day this started (Ravi, 2026-09-22). It opens a lot of its own, so it
   * can be issued to cutting like any other, and it is kept apart from "RFD back" so it never looks
   * like cloth that came back from a processor — which would make up a processing loss. */
  OPENING_RFD: 1,
  /* RFD BOUGHT READY — from a vendor, not processed from our own greige. A lot of its own, like the
   * opening stock, and never counted as "back from the processor". */
  PURCHASE_RFD: 1,
  /* WORKED OUT, NEVER TYPED (Ravi, 2026-09-22: "auto minus hona chahiye"). A cutting entry takes the
   * cloth its pieces need; an RFD requirement handed over in metres takes those metres. These rows are
   * built fresh from the cutting register and the RFD office every time — see fabAutoRows. */
  RFD_TO_PRINTER: -1,
};
const FAB_LABEL = {
  OPENING: 'Opening', RECEIVE_WHITE: 'Receive white', RECEIVE_PRINTED: 'Receive from printer',
  RECEIVE_FROM_FABRICATOR: 'Receive from fabricator', SEND_TO_PRINTER: 'Send to printer',
  ISSUE_TO_CUTTING: 'RFD to cutting', ISSUE_TO_STITCHERS: 'Issue to stitchers',
  SEND_TO_FABRICATOR: 'Send to fabricator', CUT_WHITE: 'Cut white', ADJUST: 'Adjust',
  RECEIVE_GREIGE: 'Greige received', ISSUE_TO_RFD: 'Greige sent for RFD', RECEIVE_RFD: 'RFD received',
  OPENING_RFD: 'RFD opening stock', PURCHASE_RFD: 'RFD bought (received ready)',
  RFD_TO_PRINTER: 'Handed to a printer (RFD requirement)',
};

/* ---- what the cloth IS at each point ----
 *
 * The state travels on the row. Rows written before any of this say PRINTED, which is what they were.
 */
const FAB_STATES = ['GREIGE', 'RFD', 'PRINTED'];
const FAB_STATE_LABEL = { GREIGE: 'Greige', RFD: 'RFD', PRINTED: 'Printed', WHITE: 'White' };
/** The state a movement leaves the cloth in — a receipt of RFD makes RFD, whatever the row says. */
const FAB_TXN_STATE = { RECEIVE_GREIGE: 'GREIGE', ISSUE_TO_RFD: 'GREIGE', RECEIVE_RFD: 'RFD', OPENING_RFD: 'RFD',
  PURCHASE_RFD: 'RFD', RFD_TO_PRINTER: 'RFD' };
const fabState = r => String((r && (FAB_TXN_STATE[r.txnType] || r.state)) || 'PRINTED').trim().toUpperCase();
const fabSign = tt => (FAB_SIGN[tt] === undefined ? 0 : FAB_SIGN[tt]);
/** An unknown transaction type moves nothing until somebody decides what it means. */
const fabKnown = tt => FAB_SIGN[tt] !== undefined;

let FAB = { rows: null, err: '', busy: false, at: '', shown: [] };

async function ensureFab() {
  if (FAB.rows === null) {
    FAB.busy = true; renderFab();
    try { FAB.rows = ptList(await ptGet('pt_fabInvLedger')); FAB.err = ''; }
    catch (e) { FAB.err = e.message || String(e); FAB.rows = FAB.rows || []; }
    await fabAutoLoad();
    FAB.at = ptStamp(); FAB.busy = false;
  }
  renderFab();
}

const fabQty = r => { const n = parseFloat(r && r.qty); return isFinite(n) ? n : 0; };

