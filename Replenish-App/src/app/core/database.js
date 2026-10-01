/* ================= PRODUCTION TRACKER (Master DB · Base Data · Cutting) =================
 *
 * The factory's own data — what a SKU is made of, what has been issued to which worker and how much
 * has come back, and what has been cut — read straight from the production tracker's database.
 *
 * ONE COPY, READ LIVE. Nothing is imported or mirrored into this project. The old tool keeps writing
 * to the same database and these screens read it as it stands, so the two can never disagree. That
 * is also why this is read-only for now: a second thing writing production records, carrying its own
 * half of the validation rules, is exactly how two versions of the truth get created.
 *
 * The URL is a single constant on purpose, and that is now the whole of the move: the data has been
 * copied into this project's own database (25 nodes, 27,834 records, read back and compared record
 * for record), the rules there are live, and every read and write here already carries the sign-in
 * those rules ask for. Changing this line moves the app.
 *
 * Moved on the day the old tool was switched off. The database it used is locked: its rules deny
 * everything, so nothing can be written there by accident and nobody can read it off the internet
 * without an account, which for eight years anybody could.
 */
const PT_URL = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';

/* MAY THIS ACCOUNT CHANGE AN ENTRY SOMEBODY HAS ALREADY MADE? Making one is open to everyone who can
 * reach the register; correcting one is granted per account (perms.prodEdit), because an edit moves
 * the order balance, the cutting cap, the weekly report and a worker's pay at once, and leaves no
 * trace of what the row said before. Deleting is stricter still and stays admin-only. */
const ptCanEdit = () => !!(ME.admin || ME.prodEdit);
const PT_NO_EDIT = 'Changing an entry needs permission. Ask an admin to switch on '
  + '"Can edit production entries" for your account — you can still add new entries.';

/**
 * Three things that moved stock or money with nothing in front of them: having the tab WAS the
 * permission. Each follows the shape already on the access page.
 */
/* Accepting what a printer sent creates fabric stock and settles what they are paid for it. */
const vlogCanAccept = () => !spIsVendor() && !!(ME.admin || ME.vlogAccept);
const VLOG_NO_ACCEPT = 'Accepting a delivery needs permission. Ask an admin to switch on '
  + '"Can accept printer deliveries" for your account.';
/* Approving a customer's order puts it on the floor; returning one takes it off again. */
const soCanApprove = () => !spIsVendor() && !!(ME.admin || ME.soApprove);
const SO_NO_APPROVE = 'Approving a sales order needs permission. Ask an admin to switch on '
  + '"Can approve sales orders" for your account.';
/* Adding a SKU is how the catalogue grows; Change SKU rewrites a code across every record. */
const mdbCanEdit = () => !spIsVendor() && !!(ME.admin || ME.mdbEdit);
const MDB_NO_EDIT = 'Changing the master database needs permission. Ask an admin to switch on '
  + '"Can edit the master database" for your account.';

let PT = {
  mdb: null, base: null, cut: null,          // null = never loaded; [] = loaded and empty
  err: { mdb: '', base: '', cut: '' },
  at:  { mdb: '', base: '', cut: '' },
  busy: { mdb: false, base: false, cut: false },
};

/**
 * A database path, spelled for the REST API.
 *
 * PER SEGMENT. Running encodeURIComponent over the whole path turns every "/" into %2F, which stops
 * being a separator and becomes part of a key name — so "pt_vendorByEmail/someone@x,com" asked for
 * one root-level key with a slash in its name. Against a database with no rules that answered null
 * and the caller fell back to a wider read; against one with rules it is a read at the root, and the
 * root is exactly what a vendor may not read. Hence a printer being refused their own orders.
 *
 * Callers pass the plain path. Anything already encoded is left alone rather than encoded twice,
 * because %40 encoded again is %2540 and that is a different key.
 */
const ptPath = node => String(node == null ? '' : node).split('/')
  .filter(s => s !== '')
  .map(s => encodeURIComponent(/%[0-9A-Fa-f]{2}/.test(s) ? decodeURIComponent(s) : s))
  .join('/');

