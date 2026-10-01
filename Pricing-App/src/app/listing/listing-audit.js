/* ---------- Listing audit ---------- */
/*
 * Supporting documents per PARENT ASIN. The files themselves stay in the user's own Dropbox — this
 * only holds the INDEX (which document, of which type, for which parent). That is deliberate:
 *   · the files keep Dropbox's own versioning and deleted-file recovery as their backup;
 *   · nothing large ever travels through Firestore, so the grid stays as light as the health tab;
 *   · Export writes the whole index to a JSON file, so the index has a portable backup too.
 *
 * ADDING A DOCUMENT TYPE LATER IS ONE LINE in AUDIT_DOCS — the grid, the status maths, the KPI cards
 * and the CSV all read from it, so nothing else has to change.
 */
/*
 * ORDER IS THE PROCESS ORDER, left to right: the spec sheet is written first, everything else is
 * built from it. Reading the grid left to right therefore reads as "how far has this parent got".
 * The KEYS are frozen — they are what the saved documents are filed under, so renaming a key would
 * orphan every attachment already on the record. Only the labels and the order are free to change.
 */
const AUDIT_DOCS = [
  { k: 'spec',  t: 'Specification sheet' },
  { k: 'tmpl',  t: 'Listing template' },
  { k: 'fmt',   t: 'Listing standard format' },
  { k: 'kw',    t: 'Keyword research' },
  { k: 'imgcp', t: 'Image comparison', tip: 'Image comparison done on Intellivy against the top 2 competitors.' },
  { k: 'kwidx', t: 'KW indexing matrix', tip: 'Routing-matrix format used to check keyword indexing.' },
];
/*
 * Each document type holds a LIST of dated versions, not one file — "date wise template add kar
 * saku". Approval happens per VERSION, which is the only way it means anything: v1 approved on the
 * 10th and v2 pending from the 19th are different facts about the same slot.
 *
 *   AUDIT[brand][parent][docKey] = { v: [ { url, name, date, status, by, owner, appr, at, note } … ] }
 *
 * status: draft → pending → approved | rejected. A rejected version stays in the list; deleting the
 * evidence of a rejection would hide why the next one was made.
 *
 * `by` and `owner` are different facts and both are kept: `by` is whoever pasted the link, `owner`
 * is who that step BELONGS to. Usually the same person, which is why owner defaults to `by` — but
 * when someone files a document on a colleague's behalf, only `owner` answers "who do I chase".
 */
const AUDIT_STATUS = { draft: 'Draft', pending: 'Pending approval', approved: 'Approved', rejected: 'Rejected' };
let AUDIT = { SP: {}, CPC: {} };      // brand → { parentAsin: { kw:{v:[…]}, … } }
// Parents typed in by hand — for products NOT yet on Amazon (planning a listing before it exists).
// Kept separate from the Amazon-derived list so the two never fight; merged at render time.
let AUDIT_MANUAL = { SP: {}, CPC: {} };  // brand → { id: { name, at, by } }
let AUDIT_LOADED = false;
let AUDIT_SORT = { k: 'have', dir: 1 };
let AUDIT_RENDER = { rows: [], defs: [], val: () => '' };
let AUDIT_EDIT = null;                // { brand, parent, docKey } while the dialog is open

