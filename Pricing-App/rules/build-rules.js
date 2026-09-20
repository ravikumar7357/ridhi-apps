/* WRITES ../database.rules.next.json FROM NAMED PIECES.
 *
 * The rules are long strings that differ by one word, repeated a dozen times — exactly the shape a
 * slip hides in. The first hand-written draft left the owner out of every one of them. Here each idea
 * is said once (who an admin is, what holding a right means) and the file is assembled from those.
 *
 *   node build-rules.js        → writes the draft; deploy it with rules-tool.js, never by hand
 */
const fs = require('fs'), pathm = require('path');

const OWNER = 'ravi@thefabricrush.com';
const VKEY = "auth.token.email.replace('.', ',')";                       // as pt_vendorByEmail has always been keyed
const KEY = "auth.token.email.toLowerCase().replace('.', ',')";
const ME = `root.child('pt_perms').child(${KEY})`;
const NOT_VENDOR = `!root.child('pt_vendorByEmail').child(${VKEY}).exists()`;

/* STAFF MEANS SOMEBODY WHOSE RIGHTS ARE ON RECORD — NOT MERELY SOMEBODY SIGNED IN.
 *
 * Self sign-up is open on this project (the app itself creates PIN logins through it), so "signed in"
 * is something a stranger can do for themselves with the public web key, in one request, with no
 * password of anybody's. While staff meant "signed in and not a vendor", that stranger could read the
 * whole production database — payroll, rates, every order — and write most of it. Found 2026-09-19 by
 * knocking on every door with no credentials: this was the only one that opened.
 *
 * Nobody holding rights is affected: the 44 accounts with rights all have a pt_perms entry, and the
 * owner is named. The four logins with none (two of Vimal's, two unused PIN accounts) saw nothing in the
 * app already. */
const KNOWN = `(auth.token.email.toLowerCase() === '${OWNER}' || ${ME}.exists())`;
const STAFF = `auth != null && ${KNOWN} && ${NOT_VENDOR}`;
const ADMIN = `(auth.token.email.toLowerCase() === '${OWNER}' || ${ME}.child('admin').val() === true)`;
const right = r => `${ME}.child('r').child('${r}').val() === true`;
const tab = t => `${ME}.child('t').child('${t}').val() === true`;
const any = (...xs) => `auth != null && (${xs.join(' || ')})`;
const OWN_BRANCH = `auth != null && root.child('pt_vendorByEmail').child(${VKEY}).child('code').val() === $code`;
const OWN_ROW = `auth != null && $emailKey === ${VKEY}`;
const PENDING = "(!data.exists() || data.child('status').val() === 'Pending') && (!newData.exists() || newData.child('status').val() === 'Pending')";

const staffIndexed = ix => ({ '.write': STAFF, '.indexOn': ix });

/* PHASE 4 — READING IS GRANTED NODE BY NODE, BY THE TABS SOMEBODY HOLDS.
 *
 * Until this, any of the 44 staff accounts could read the whole database — the employee list, every
 * rate, every advance — whatever screens they had been given, because the root granted read and a
 * grant at a parent cannot be narrowed below it. So the root grants NOTHING now, and each node says who
 * may read it: an admin, or somebody holding a tab whose code reads that node (read-model.js, derived
 * from the app's call graph by read-audit.js), or — for Change SKU — the right that needs it.
 * A vendor is never staff here; their own branch and their own rows are granted where they always were.
 * A node nobody has named is readable by admins only: the app reads no such node. */
const { readersOf, NODES } = require('./read-model');
const readExpr = node => { const r = readersOf(node);
  return `auth != null && ${NOT_VENDOR} && (${[ADMIN].concat(r.tabs.map(tab), r.rights.map(right)).join(' || ')})`; };

const rules = {

  pt_perms: { '.write': any(ADMIN) },
  pt_payoutFreezes: { '.write': any(ADMIN) },

  /* PHASE 2 — a rate is a row, and the row's own words decide who may write it. */
  pt_printerRates: {
    '.write': any(ADMIN, right('rateApprove')),
    $id: { '.write': `auth != null && ${tab('hr')} && ${PENDING}` },
  },
  pt_rateList: { '.write': any(ADMIN, tab('hr')) },
  pt_advances: { '.write': any(ADMIN, tab('hr')) },
  pt_empList: { '.write': any(ADMIN, tab('hr'), right('empEdit')) },

  pt_masterDB: { '.write': any(ADMIN, right('mdbEdit'), right('prodEdit')), '.indexOn': ['sku', 'brand', 'articleType', 'color'] },

  /* PHASE 2 — the master lists, each by the right the app already asks for before writing it. */
  pt_masters: {
    accessories: { '.write': any(ADMIN, right('accEdit')) },
    ruffleRule: { '.write': any(ADMIN, right('prodEdit')) },
    printRule: { '.write': any(ADMIN, right('prodEdit')) },
    recipe: { '.write': any(ADMIN, right('mdbEdit')) },
    $list: { '.write': any(ADMIN) },
  },

  /* PHASE 2 — who is a vendor, and which vendor. Deleting a row here used to promote a vendor to staff. */
  pt_vendorByEmail: { '.write': any(ADMIN), $emailKey: { '.read': OWN_ROW } },
  pt_loginDir: { '.write': any(ADMIN) },
  pt_vendorMap: { '.write': any(ADMIN, right('vreqApprove')) },
  pt_vendorPin: {
    '.write': any(ADMIN),
    $emailKey: { '.read': OWN_ROW, '.write': `${OWN_ROW} && newData.hasChildren(['changedAt'])` },
  },

  pt_vendorOrders: { '.write': STAFF, $code: { '.read': OWN_BRANCH, '.write': OWN_BRANCH } },

  /* WHAT A PRINTER SAYS IS ALREADY ON THEIR FLOOR, per size, so the factory stops sending cloth they
   * have. Their own branch and nobody else's, exactly as their orders are — one printer must not be
   * able to read, still less edit, what another one is holding. It comes off what gets sent, so it
   * is a claim the office has to be able to see: staff read and write the lot. */
  pt_rfdStock: { '.write': STAFF, $code: { '.read': OWN_BRANCH, '.write': OWN_BRANCH } },

  pt_baseData: staffIndexed(['sku', 'empName', 'issueDate', 'frozen']),
  pt_cuttingData: staffIndexed(['sku', 'orderNo', 'cutDate']),
  pt_pressInventory: staffIndexed(['sku', 'orderNo', 'entryDate']),
  pt_orderBook: staffIndexed(['sku', 'orderNo', 'orderDate']),
  pt_customSkus: staffIndexed(['sku', 'brand', 'articleType']),
  pt_fabInvLedger: staffIndexed(['orderNo', 'date', 'fabricType']),
  pt_qcChecks: staffIndexed(['sku', 'date']),
  pt_qcIssuance: staffIndexed(['sku', 'date', 'employee']),
  pt_extraHours: staffIndexed(['date', 'empName', 'status']),
  pt_salesOrders: staffIndexed(['orderNo', 'orderDate', 'channel']),

  $other: { '.read': any(ADMIN), '.write': STAFF },
};

/* Every node the app reads is NAMED, so that it can say who reads it. Naming a node takes it out from
 * under "$other", so one that had no entry above is given the staff write it had there. */
NODES.forEach(n => { if (!rules[n]) rules[n] = { '.write': STAFF }; rules[n] = Object.assign({ '.read': readExpr(n) }, rules[n]); });
['pt_perms', 'pt_loginDir'].forEach(n => { rules[n] = Object.assign({ '.read': any(ADMIN) }, rules[n]); });   // read by nothing in the app

const HEAD = `{
  // ── THE DATABASE ENFORCES WHO MAY WRITE WHAT ─────────────────────────────────────────────────────
  //
  // GENERATED by rules/build-rules.js — change that, not this. Deploy with rules/rules-tool.js, which
  // plays every account against the new rules and puts the old ones back by itself if one answer is
  // not the expected one.
  //
  // Until 2026-09-19 every right in the app — approve a rate, freeze a payout, edit the master
  // database — was a button the app chose to show or hide; the database let any signed-in member of
  // staff write anything. 177 (account, node) pairs could write what they should not.
  //
  // READING IS BY TAB (phase 4). The root grants nothing; each node names who may read it — an admin, or
  // a holder of a tab whose code reads it (rules/read-model.js, from the app's call graph). Before this,
  // any staff account could read the employee list, every rate and every advance.
  //
  // THE ROOT GRANTS NOTHING. A grant given at a parent cannot be taken back lower down, so while the
  // root said "any staff may write" no stricter rule beneath it could mean anything. Write is granted
  // node by node, and EVERYTHING NOT NAMED stays staff-writable through "$other" — a node nobody
  // thought of is what it was yesterday, not locked.
  //
  // A NODE NAMED HERE IS NOT COVERED BY "$other" — the indexed nodes each repeat the staff grant.
  //
  // THE APP PATCHES AT THE ROOT with keys like "pt_masters/recipe/x"; that is judged key by key
  // (proven on the live database with a simulated vendor before the root grant was removed).
  //
  // STAFF MEANS SOMEBODY WHOSE RIGHTS ARE ON RECORD, not merely somebody signed in: self sign-up is open
  // on this project, so a stranger can sign THEMSELVES in with the public web key. A login with no
  // pt_perms entry reads nothing and writes nothing here.
  //
  // THE OWNER IS ALWAYS AN ADMIN, by email, as firestore.rules (OWNER_EMAIL) and the app both have it.
  //
  // THE RIGHTS live in Firestore, which these rules cannot read. pt_perms/<email, dots as commas> is
  // the copy they can: { admin, r: {right: true}, t: {tab: true} }. Sellora's Access screen writes
  // both; only an admin may write pt_perms; rules-tool.js "drift" says when the two differ.
  //
  // A RATE IS A ROW (phase 2). Whoever holds Finance & HR may write a row that is, and stays, Pending.
  // Only an approver may write one that is Approved — and a row with no status at all IS approved,
  // which is why the test is "=== 'Pending'" and never "!== 'Approved'".
  "rules": `;

const body = JSON.stringify(rules, null, 2).split('\n').map((l, i) => (i ? '  ' + l : l)).join('\n');
const out = pathm.join(__dirname, '..', 'database.rules.next.json');
fs.writeFileSync(out, HEAD + body + '\n}\n');
console.log('written', out, '—', Object.keys(rules).filter(k => k[0] !== '.').length, 'nodes named');
