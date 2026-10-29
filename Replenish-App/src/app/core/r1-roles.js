/* ================= R-ONE ROLES: READY-MADE ACCESS (2026-10-22) =================
 *
 * Ravi: "jo r-one ke access hain unpe hi kaam karo" — the roles are made from R-one's OWN access, nothing else:
 *   - its screen switches (perms.replTabs — the keys of REPL_TABS, core/setup.js), grouped as R-one's own menu groups
 *     them (core/nav.js: Shopify, Replenishment & planning, Orders, Production, Store, Vendors, People & pay, Setup,
 *     Reports & analysis; the Dashboard is the admins');
 *   - its 17 permissions (core/auth.js → ME.prodEdit, ME.fgiEntry…), each placed with the group whose screens it acts on.
 * Every group gives two roles: "view & entry" (the group's screens) and "in charge" (the same screens, the group's
 * in-charge screens, and every permission that acts on them). Plus Admin, which is everything.
 *
 * Left out of every role: approving vendor order requests, approving RFD, marking RFD fabric sent, accepting printer
 * deliveries — their screens (Vendor Order Requests, Vendor Orders, RFD Requirements, History · printed in) have been
 * off R-one's menu since 15 Oct (nav.js: PPC does that work now). Shopify returns (shopret) and the old Shopify
 * production view (shopprod) are single-purpose accounts, set by hand. */
const R1_GROUPS = [
  { key: 'shopify', name: 'Shopify', hi: 'शॉपिफ़ाई', tabs: ['shop', 'adj', 'shopify'], lead: [], perms: ['shopAssign'],
    job: 'Shopify Orders, Adjustments and Shopify Stock.' },
  { key: 'plan', name: 'Replenishment & planning', hi: 'प्लानिंग', tabs: ['repl', 'article', 'target', 'top', 'pack'], lead: [], perms: ['replProj'],
    job: 'Replenishment (with purchase orders and India stock), Article Review, Revenue Target, Top ASIN, Packing List.' },
  { key: 'orders', name: 'Orders', hi: 'ऑर्डर', tabs: ['so', 'ord'], lead: [], perms: ['soApprove', 'b2bAssign'],
    job: 'Sales Orders and the Order Console.' },
  { key: 'prod', name: 'Production', hi: 'प्रोडक्शन', tabs: ['flppc', 'fldem', 'flacc', 'flchl', 'flcut', 'flraw', 'flwip', 'palloc', 'pcut', 'pbase', 'ppress', 'qc'],
    lead: ['qcalt', 'qcret'], perms: ['prodEdit'],
    job: 'PPC and the production flow, Printer Allocation, Cutting, Job Work, Press, Quality Control.' },
  { key: 'store', name: 'Store', hi: 'स्टोर', tabs: ['fab', 'gdesk', 'gdled', 'acc', 'fgi', 'fba'], lead: ['gdledit', 'gdappr'],
    perms: ['accEntry', 'accEdit', 'fgiEntry', 'fgiEdit'],
    job: 'Fabric, Greige Desk, Accessories, Finished Goods, FBA Dispatch.' },
  { key: 'people', name: 'People & pay', hi: 'लोग और भुगतान', tabs: ['att', 'hr'], lead: [], perms: ['attendMark', 'empEdit', 'rateApprove'],
    job: 'Attendance and Finance & HR (payouts, rates, salary slips).' },
  { key: 'setup', name: 'Setup', hi: 'सेटअप', tabs: ['pmdb', 'mst'], lead: [], perms: ['mdbEdit'],
    job: 'Master Database and Masters.' },
  { key: 'reports', name: 'Reports & analysis', hi: 'रिपोर्ट', tabs: ['rep', 'pa', 'ka'], lead: [], perms: [],
    job: 'Reports, Production Analysis, Karigar Analysis.' }
];
const R1_ROLES = [{ key: 'admin', name: 'Admin', hi: 'एडमिन', job: 'Everything in R-one.', admin: true, tabs: [], perms: [] }]
  .concat(...R1_GROUPS.map(g => {
    const view = { key: g.key + ':view', group: g.key, name: `${g.name} — view & entry`, hi: `${g.hi} — देखना और भरना`,
      job: g.job + ' Opens them and adds entries; changing others\' entries stays with the person in charge.', tabs: g.tabs.slice(), perms: [] };
    const lead = { key: g.key + ':lead', group: g.key, name: `${g.name} — in charge`, hi: `${g.hi} — इंचार्ज`,
      job: g.job + ' Everything the group can do in R-one.', tabs: g.tabs.concat(g.lead), perms: g.perms.slice() };
    return g.perms.length || g.lead.length ? [view, lead] : [Object.assign(view, { name: g.name, hi: g.hi, job: g.job })];
  }))
  .concat([{ key: 'vendors:view', group: 'vendors', name: 'Vendors — printer portal', hi: 'वेंडर — प्रिंटर पोर्टल',
    job: 'A printer\'s own portal: its orders, what it holds, what it has sent.', tabs: ['vend'], perms: [],
    note: 'The printer must also be linked to its vendor code (Vendor access); the tick alone does not do that.' }]);
/* R-one's 17 permissions, in R-one's words (core/auth.js). The four for the screens off the menu are kept here only so
 * a person who still holds one is named right. */
const R1_PERM_BOX = {
  replProj: ['', 'edits projections'], prodEdit: ['', 'edits production entries'], fgiEdit: ['', 'edits finished goods'],
  fgiEntry: ['', 'adds stock entries'], rateApprove: ['', 'approves rates'], shopAssign: ['', 'assigns printers (Shopify)'],
  b2bAssign: ['', 'assigns printers (order book)'], accEntry: ['', 'records accessory movements'], accEdit: ['', 'edits accessories'],
  mdbEdit: ['', 'edits the master database'], soApprove: ['', 'approves sales orders'], attendMark: ['', 'marks attendance'],
  empEdit: ['', 'adds and deletes employees'],
  vlogAccept: ['', 'accepts printer deliveries (screen off the menu)'], vreqApprove: ['', 'approves vendor requests (screen off the menu)'],
  rfdApprove: ['', 'approves RFD (screen off the menu)'], rfdSend: ['', 'marks RFD fabric sent (screen off the menu)']
};
