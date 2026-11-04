/* ================= ACCESS BY ROLE — Ravi's design (3 Nov: "mujhe wahi design chahiye jo maine bheja tha") =================
 * The page from the artifact "Access by role" (4VNW4HhNPajPwL7qPWtyKx), as it is, inside the Access tab: its CSS under .acx,
 * its ids acx-*. IT SAVES FOR REAL (3 Nov: "edit access wali cheez bhi sahi karke do"): a person's access is their perms/<email> record
 * and its production-database copy (permMirror), written the way Save access always wrote them; which role they are in is the
 * record's accessRole ('__special' = kept apart); the roles themselves — their boxes, and roles added here — are config/accessRoles.
 * Every change that touches somebody's access asks first. The people are today's real records (perms/*), each placed in the role of the role plan
 * ("Access role plan - check.xlsx", 3 Nov) — each role carries exactly the boxes its people hold, and a person lands in the role whose boxes are theirs; what is done on the page stays on the
 * screen (this browser) — nothing is written. The Grant or update form below it is unchanged and saves as before. */
const ACX_ROLEDEFS = [
 {
  "key": "corporate",
  "name": "Corporate",
  "groups": [
   {
    "name": "Management",
    "roles": [
     {
      "key": "owneradmin",
      "name": "Owner / Director (Admin)",
      "limit": "Full Admin: pay, rates and granting access",
      "boxes": {
       "admin": true
      }
     }
    ]
   },
   {
    "name": "IT & master data",
    "roles": [
     {
      "key": "itall",
      "name": "IT — every screen, not Admin",
      "cannot": "Grant access",
      "boxes": {
       "tabs": [
        "age",
        "audit",
        "basket",
        "bsr",
        "carousel",
        "deals",
        "health",
        "img",
        "lerr",
        "lrules",
        "new",
        "opt",
        "plaudit",
        "plc",
        "pr",
        "profit",
        "sa",
        "sales",
        "st",
        "tiktok",
        "trends",
        "weekly"
       ],
       "replTabs": [
        "acc",
        "adj",
        "article",
        "att",
        "fab",
        "fba",
        "fgi",
        "flacc",
        "flchl",
        "flcut",
        "fldem",
        "flppc",
        "flraw",
        "flwip",
        "gdappr",
        "gdesk",
        "gdled",
        "gdledit",
        "hr",
        "ka",
        "mst",
        "ord",
        "pa",
        "pack",
        "palloc",
        "pbase",
        "pcut",
        "pmdb",
        "ppress",
        "qc",
        "qcalt",
        "qcret",
        "rep",
        "repl",
        "rfd",
        "shop",
        "shopify",
        "shopprod",
        "so",
        "target",
        "top",
        "vend",
        "vlog",
        "vord",
        "vreq"
       ],
       "rights": []
      }
     },
     {
      "key": "accessviewer",
      "name": "Access viewer (view only)",
      "limit": "Sees everybody’s access; cannot change any of it",
      "cannot": "Give, change or remove access",
      "boxes": {
       "tabs": [],
       "replTabs": [],
       "rights": [
        "accessView"
       ]
      }
     }
    ]
   },
   {
    "name": "HR & accounts",
    "roles": [
     {
      "key": "accounts",
      "name": "Accounts",
      "boxes": {
       "tabs": [
        "adj",
        "age",
        "profit",
        "sales",
        "shop",
        "trends"
       ],
       "replTabs": [
        "acc",
        "adj",
        "article",
        "fab",
        "fba",
        "fgi",
        "gdappr",
        "gdesk",
        "gdled",
        "gdledit",
        "mst",
        "ord",
        "pack",
        "palloc",
        "pbase",
        "pcut",
        "pmdb",
        "ppress",
        "qc",
        "qcalt",
        "qcret",
        "repl",
        "rfd",
        "shop",
        "shopify",
        "shopprod",
        "shopret",
        "so",
        "target",
        "top",
        "vend",
        "vlog",
        "vord",
        "vreq"
       ],
       "rights": [
        "replProj",
        "soApprove"
       ]
      }
     }
    ]
   },
   {
    "name": "Amazon",
    "roles": [
     {
      "key": "amzops",
      "name": "Amazon & operations manager",
      "boxes": {
       "tabs": [
        "adj",
        "age",
        "audit",
        "bsr",
        "deals",
        "health",
        "plaudit",
        "pr",
        "sales",
        "shop"
       ],
       "replTabs": [
        "adj",
        "fab",
        "fba",
        "fgi",
        "ord",
        "pmdb",
        "repl",
        "shop",
        "shopify",
        "shopprod",
        "so",
        "vord",
        "vreq"
       ],
       "rights": [
        "soApprove",
        "mdbEdit"
       ]
      }
     },
     {
      "key": "amzexec",
      "name": "Amazon executive",
      "boxes": {
       "tabs": [
        "age",
        "audit",
        "bsr",
        "deals",
        "health",
        "img",
        "lerr"
       ],
       "replTabs": [
        "article",
        "fgi",
        "ord",
        "repl",
        "top"
       ],
       "rights": []
      }
     },
     {
      "key": "adslist",
      "name": "Ads & listing executive (Ridhi only)",
      "limit": "One brand: Ridhi (SP)",
      "boxes": {
       "tabs": [
        "age",
        "audit",
        "basket",
        "bsr",
        "deals",
        "health",
        "img",
        "lerr",
        "lrules",
        "opt",
        "plc",
        "st",
        "trends",
        "weekly"
       ],
       "replTabs": [
        "fgi",
        "repl"
       ],
       "rights": []
      }
     },
     {
      "key": "amzintern",
      "name": "Amazon intern (replenishment)",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "article",
        "follow",
        "india",
        "prod",
        "repl",
        "shopify",
        "target",
        "top"
       ],
       "rights": []
      }
     },
     {
      "key": "amzstock",
      "name": "Amazon stock & finished goods",
      "boxes": {
       "tabs": [
        "age"
       ],
       "replTabs": [
        "fba",
        "fgi",
        "pack",
        "pmdb",
        "repl"
       ],
       "rights": [
        "fgiEntry",
        "fgiEdit",
        "mdbEdit"
       ]
      }
     },
     {
      "key": "listing",
      "name": "Listing executive",
      "boxes": {
       "tabs": [
        "audit",
        "basket",
        "bsr",
        "health",
        "img",
        "lerr",
        "lrules",
        "opt"
       ],
       "replTabs": [],
       "rights": []
      }
     },
     {
      "key": "lhealth",
      "name": "Listing health checker",
      "boxes": {
       "tabs": [
        "health",
        "lrules"
       ],
       "replTabs": [],
       "rights": []
      }
     }
    ]
   },
   {
    "name": "Shopify / website",
    "roles": [
     {
      "key": "shpplan",
      "name": "Shopify production planner",
      "boxes": {
       "tabs": [
        "adj",
        "shop"
       ],
       "replTabs": [
        "adj",
        "flppc",
        "ord",
        "pmdb",
        "ppress",
        "shop",
        "shopify",
        "shopprod",
        "shopret",
        "so",
        "vlog",
        "vreq"
       ],
       "rights": [
        "shopAssign",
        "b2bAssign",
        "prodEdit"
       ]
      }
     },
     {
      "key": "shpexec",
      "name": "Shopify executive",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "adj",
        "mst",
        "ord",
        "pmdb",
        "shop",
        "shopprod",
        "vreq"
       ],
       "rights": [
        "shopAssign"
       ]
      }
     },
     {
      "key": "shpsellora",
      "name": "Shopify orders (Sellora only)",
      "boxes": {
       "tabs": [
        "adj",
        "shop"
       ],
       "replTabs": [],
       "rights": []
      }
     },
     {
      "key": "returns",
      "name": "Returns executive",
      "cannot": "See the orders table or production",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "shop",
        "shopret"
       ],
       "rights": []
      }
     }
    ]
   },
   {
    "name": "Sales / B2B",
    "roles": [
     {
      "key": "sodesk",
      "name": "Sales order desk",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "pmdb",
        "so"
       ],
       "rights": []
      }
     },
     {
      "key": "sofg",
      "name": "Sales order desk + finished goods",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "fgi",
        "pmdb",
        "so"
       ],
       "rights": []
      }
     }
    ]
   }
  ]
 },
 {
  "key": "production",
  "name": "Production",
  "groups": [
   {
    "name": "Planning (PPC)",
    "roles": [
     {
      "key": "ppchead",
      "name": "Production planner (PPC head)",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "fab",
        "flacc",
        "flchl",
        "flcut",
        "fldem",
        "flppc",
        "flraw",
        "flwip",
        "ord",
        "palloc",
        "pbase",
        "pcut",
        "qc",
        "qcalt",
        "qcret",
        "rep",
        "rfd",
        "so",
        "vend",
        "vlog",
        "vord"
       ],
       "rights": [
        "soApprove",
        "vreqApprove",
        "vlogAccept",
        "b2bAssign",
        "prodEdit"
       ]
      }
     },
     {
      "key": "shpprod",
      "name": "Shopify production in-charge",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "flcut",
        "flraw",
        "flwip",
        "ord",
        "shop",
        "shopprod"
       ],
       "rights": [
        "shopAssign",
        "b2bAssign",
        "prodEdit"
       ]
      }
     }
    ]
   },
   {
    "name": "Shop floor",
    "roles": [
     {
      "key": "prodmgr",
      "name": "Production manager",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "acc",
        "att",
        "fab",
        "fgi",
        "flacc",
        "flchl",
        "flcut",
        "fldem",
        "flppc",
        "flraw",
        "flwip",
        "hr",
        "mst",
        "ord",
        "pbase",
        "pcut",
        "pmdb",
        "vlog",
        "vord",
        "vreq"
       ],
       "rights": [
        "vlogAccept",
        "shopAssign",
        "b2bAssign",
        "prodEdit",
        "attendMark",
        "accEntry",
        "accEdit"
       ]
      }
     },
     {
      "key": "floor",
      "name": "Floor supervisor",
      "cannot": "See pay or rates",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "acc",
        "flcut",
        "flraw",
        "flwip",
        "ord",
        "pbase",
        "pcut",
        "vlog"
       ],
       "rights": [
        "vlogAccept",
        "prodEdit",
        "accEntry",
        "accEdit"
       ]
      }
     },
     {
      "key": "followup",
      "name": "Order follow-up",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "ord"
       ],
       "rights": [
        "prodEdit"
       ]
      }
     },
     {
      "key": "cutting",
      "name": "Cutting master",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "flcut",
        "ord",
        "pcut",
        "shopprod"
       ],
       "rights": []
      }
     },
     {
      "key": "qc",
      "name": "QC checker",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "qc",
        "qcalt",
        "qcret"
       ],
       "rights": [
        "prodEdit"
       ]
      }
     }
    ]
   },
   {
    "name": "Store",
    "roles": [
     {
      "key": "rfdstore",
      "name": "RFD fabric store",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "fab",
        "flchl",
        "fldem",
        "rfd"
       ],
       "rights": [
        "rfdSend",
        "prodEdit"
       ]
      }
     },
     {
      "key": "greige",
      "name": "Greige store",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "fab",
        "flchl",
        "fldem",
        "gdesk",
        "gdled",
        "gdledit"
       ],
       "rights": [
        "fgiEntry"
       ]
      }
     },
     {
      "key": "pfin",
      "name": "Printed fabric receiving",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "flchl",
        "vlog",
        "vord"
       ],
       "rights": [
        "vlogAccept"
       ]
      }
     }
    ]
   },
   {
    "name": "Vendors & printers",
    "roles": [
     {
      "key": "vreqmst",
      "name": "Vendor request raiser + master",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "pmdb",
        "vreq"
       ],
       "rights": []
      }
     },
     {
      "key": "vreq",
      "name": "Vendor request raiser",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "vreq"
       ],
       "rights": []
      }
     }
    ]
   }
  ]
 },
 {
  "key": "shipping",
  "name": "Shipping",
  "groups": [
   {
    "name": "Shipping",
    "roles": [
     {
      "key": "shipping",
      "name": "Shipping team",
      "boxes": {
       "tabs": [
        "adj",
        "shop"
       ],
       "replTabs": [
        "adj",
        "fgi",
        "shop",
        "shopify",
        "shopprod",
        "shpacc"
       ],
       "rights": []
      }
     }
    ]
   },
   {
    "name": "Finished goods & FBA",
    "roles": [
     {
      "key": "fgstore",
      "name": "Finished goods store",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "fba",
        "fgacc",
        "fgi"
       ],
       "rights": [
        "fgiEntry"
       ]
      }
     }
    ]
   }
  ]
 },
 {
  "key": "other",
  "name": "Other",
  "groups": [
   {
    "name": "Outside partners",
    "roles": [
     {
      "key": "vendor",
      "name": "Printer / vendor",
      "limit": "Own orders only",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "vend"
       ],
       "rights": []
      }
     },
     {
      "key": "vendacc",
      "name": "Printer who also accepts deliveries",
      "boxes": {
       "tabs": [],
       "replTabs": [
        "vend",
        "vlog"
       ],
       "rights": [
        "vlogAccept"
       ]
      }
     }
    ]
   }
  ]
 }
];
let ACX_DEPTS = [];
let ACX_SET = null;
let ACX_ROLES_DOC = null;   // config/accessRoles as last read
/** The departments for the page: the role plan's roles, each carrying the boxes its people hold today (no emails in the code — the
 *  repository is public; a person lands in the role whose boxes are exactly theirs). */
function acxDepts() {
  return ACX_ROLEDEFS.map(d => ({ key: d.key, name: d.name, groups: d.groups.map(g => ({ name: g.name, roles: g.roles.map(r => {
    const x = Object.assign({}, r), b = r.boxes; delete x.boxes;
    if (b && b.admin) x.admin = true;
    else if (b) x.accessRec = Object.assign({ tabs: b.tabs, replTabs: b.replTabs }, Object.fromEntries(b.rights.map(k => [k, true])));
    return x;
  }) })) }));
}
function acxMount(rows) {
  if (!document.getElementById('acx-root')) return;
  if (!ACX_SET) ACX_SET = acxBoot();
  ACX_SET(rows || []);
}
function acxBoot() {


/* ==== ACCESS MODEL ====
 * The screens, rights and roles of the two apps, copied from Sellora's Access screen
 * (Pricing-App/src/app/core/admin-access.js, 2 Nov 2026) so this page speaks the same keys:
 * `tabs` are Sellora screens, `replTabs` are Fabricrush (ERP) screens, `rights` are the extra powers.
 * This page changes nobody's real access. */

const OWNER_EMAIL = 'ravi@thefabricrush.com';

/* Sellora screens, in the groups its menu uses. Hidden tabs (By Amazon Link, Keywords, Analytics) are left out:
 * they are not in the menu, so ticking them grants nothing anybody can see. */
const SELLORA_GROUPS = [
  { name: 'Research', items: [['new', 'New Product'], ['pr', 'Product Research']] },
  { name: 'Sales', items: [['sales', 'Sales Dashboard'], ['profit', 'Profit & Margin'], ['sa', 'Sales Analysis'], ['plaudit', 'Parent Listing Review'], ['shop', 'Shopify Orders'], ['adj', 'Adjustments']] },
  { name: 'Listing', items: [['opt', 'Listing Optimiser'], ['img', 'Image Manager'], ['lerr', 'Listing Errors'], ['basket', 'Bought Together'], ['health', 'Listing Health'], ['lrules', 'Listing Rules'], ['audit', 'Listing Audit'], ['bsr', 'BSR Audit']] },
  { name: 'Advertising', items: [['trends', 'Ad Console'], ['weekly', 'PPC & Organic'], ['st', 'Search Terms'], ['plc', 'Placement'], ['deals', 'Deal Calendar']] },
  { name: 'Inventory & social', items: [['age', 'Inventory Age'], ['tiktok', 'TikTok Toolkit'], ['carousel', 'Carousel Builder']] },
];
const SELLORA_HIDDEN = ['link', 'kw', 'ba'];

/* Fabricrush screens, in the groups of its sidebar. */
const ERP_GROUPS = [
  { name: 'Shopify', items: [['shop', 'Shopify Orders'], ['adj', 'Adjustments'], ['shopify', 'Shopify Stock'], ['shopprod', 'Order Console — Shopify only'], ['shopret', 'Shopify returns team']] },
  { name: 'Replenishment & planning', items: [['repl', 'Replenishment'], ['article', 'Article Review'], ['target', 'Revenue Target'], ['top', 'Top ASIN Status'], ['pack', 'Packing List']] },
  { name: 'Orders', items: [['so', 'Sales Orders'], ['ord', 'Order Console — every order'], ['shpacc', 'Order Console — Shipping to accept'], ['cx', 'Customer orders']] },
  { name: 'Production flow', items: [['flppc', 'PPC and PPC completed'], ['fldem', 'Demand: RFD fabric out'], ['flacc', 'Demand: accessories'], ['flchl', 'Printed fabric in · history'], ['flcut', 'To cut'], ['flraw', 'Raw cutting in store'], ['flwip', 'WIP with karigars']] },
  { name: 'Making', items: [['pcut', 'Cutting Data'], ['pbase', 'Job Work Register'], ['ppress', 'Press Inventory'], ['qc', 'Quality Control — checks'], ['qcalt', 'QC — issue for alteration'], ['qcret', 'QC — receive back']] },
  { name: 'Finished & dispatch', items: [['fgi', 'Finished Goods'], ['fgacc', 'Finished Goods — From QC, to accept'], ['fba', 'FBA Dispatch']] },
  { name: 'Materials', items: [['fab', 'Fabric Inventory'], ['acc', 'Accessories'], ['gdesk', 'Greige Desk — open'], ['gdled', 'Greige Desk — fabric ledger'], ['gdledit', 'Greige Desk — correct ledger'], ['gdappr', 'Greige Desk — approve shrinkage >5%']] },
  { name: 'Setup', items: [['pmdb', 'Master Database'], ['mst', 'Masters']] },
  { name: 'Vendors & printers', items: [['vreq', 'Vendor Order Requests'], ['vord', 'Vendor Orders'], ['rfd', 'RFD Requirements'], ['vend', 'Vendor Portal'], ['vlog', 'History'], ['palloc', 'Printer Allocation'], ['vpview', "Printer's portal (view only)"]] },
  /* boxes some records still hold for screens that no longer exist — shown so nothing is hidden; they open nothing */
  { name: 'Old screens (no longer in the app)', items: [['ptapp', 'Old Production App'], ['follow', 'Follow-ups (removed)'], ['india', 'India Stock (removed)'], ['prod', 'In Production (removed)']] },
  { name: 'People & pay', items: [['att', 'Attendance'], ['hr', 'Finance & HR']] },
  { name: 'Reports', items: [['rep', 'Reports'], ['pa', 'Production Analysis'], ['ka', 'Karigar Analysis']] },
];

/* The extra powers, beyond opening a screen. Same keys as the access record. */
const RIGHTS = [
  ['approve', 'Sellora approvals'],
  ['replProj', 'Change monthly projections'],
  ['soApprove', 'Approve sales orders'],
  ['vreqApprove', 'Approve vendor order requests'],
  ['rateApprove', 'Approve vendor rates'],
  ['rfdApprove', 'Approve extra RFD cloth'],
  ['rfdSend', 'Mark RFD fabric sent'],
  ['vlogAccept', 'Accept printer deliveries'],
  ['shopAssign', 'Give Shopify lines to printers'],
  ['b2bAssign', 'Give B2B lines to printers'],
  ['prodEdit', 'Correct production entries'],
  ['attendMark', 'Mark attendance'],
  ['empEdit', 'Add, change, remove employees'],
  ['fgiEntry', 'Add finished-goods entries'],
  ['fgiEdit', 'Edit and delete finished goods'],
  ['accEntry', 'Add accessory movements'],
  ['accEdit', 'Edit the accessories record'],
  ['mdbEdit', 'Change the Master Database'],
  /* ACCESS VIEWER (3 Nov): sees this page — everybody's access — and changes nothing */
  ['accessView', 'See the Access page (view only)'],
  /* THE BOARDS' BUTTONS (4 Nov): given any of these, a person does exactly these steps on the SHP / AMZ / B2B / SPY boards */
  ['bdCut', 'Board — Cut'], ['bdIssue', 'Board — Issue'], ['bdRecv', 'Board — Receive'], ['bdQc', 'Board — QC pass'], ['bdPress', 'Board — Press'],
];

/* TWO PAGES, ONE CODE (Ravi, 4 Nov: "sellora access ko replenish app me shift — sellora me sirf amazon ke access rahe"). This file is the same
 * in both apps (Replenish-App/src/app/core/access-design.js is a copy, and a test keeps them equal); ACX_SIDE, set by the app before it,
 * says which half this page shows and changes: 'sellora' = Sellora's screens and its own rights, 'erp' = the ERP's screens and rights.
 * A person has a role on each side (accessRole = ERP, selloraRole = Sellora), matched on that side's boxes only; saving here never
 * touches the other half. Admin is given and taken only on the ERP side; deleting a login altogether too. */
const SIDE = (typeof ACX_SIDE !== 'undefined' && ACX_SIDE === 'erp') ? 'erp' : 'sellora';
const SELLORA_RIGHTS = ['approve', 'accessView'];
const SIDE_RIGHT = k => SIDE === 'sellora' ? SELLORA_RIGHTS.includes(k) : (k !== 'approve');
const SIDE_NAME = SIDE === 'erp' ? 'the ERP' : 'Sellora';
const ROLE_TAG = SIDE === 'erp' ? 'accessRole' : 'selloraRole';
const ALL_SELLORA = SELLORA_GROUPS.flatMap(g => g.items.map(i => i[0]));
const ALL_ERP = ERP_GROUPS.flatMap(g => g.items.map(i => i[0]));

/* The roles, as Ravi's role chart (v2, 2 Nov 2026) and the Sellora presets built from it.
 * `limit` is shown on the card; it is not something the boxes can enforce. */
const DEPARTMENTS = ACX_DEPTS;

/* What a role grants, as plain lists. */
function roleAccess(role) {
  const sv = ACX_ROLES_DOC && ACX_ROLES_DOC.roles && ACX_ROLES_DOC.roles[role.key];
  if (sv && sv.access) return JSON.parse(JSON.stringify(sv.access));
  if (role.access) return JSON.parse(JSON.stringify(role.access));
  if (role.admin) return { admin: true, sellora: ALL_SELLORA.slice(), erp: ALL_ERP.slice(), rights: RIGHTS.map(r => r[0]) };
  const sellora = role.sellora === 'all' ? ALL_SELLORA.slice() : (role.sellora || []).slice();
  const erp = role.erp === 'director' ? ALL_ERP.filter(k => !['shopprod', 'shopret', 'vend', 'gdappr'].includes(k)) : (role.erp || []).slice();
  return { admin: false, sellora, erp, rights: (role.rights || []).slice() };
}

/* A person's access record (perms/<email>) as the same plain lists. An old record with the whole ERP ticked
 * (repl: true and no sections chosen) is read the way the ERP reads it: every section. */
function personAccess(p) {
  if (p.admin || (p.email || '').toLowerCase() === OWNER_EMAIL) return { admin: true, sellora: ALL_SELLORA.slice(), erp: ALL_ERP.slice(), rights: RIGHTS.map(r => r[0]) };
  const sellora = (Array.isArray(p.tabs) ? p.tabs : []).filter(t => !SELLORA_HIDDEN.includes(t) && ALL_SELLORA.includes(t));
  let erp = (Array.isArray(p.replTabs) ? p.replTabs : []).filter(t => ALL_ERP.includes(t));
  if (!erp.length && p.repl === true) erp = ALL_ERP.filter(k => !['shopprod', 'shopret'].includes(k));
  const rights = RIGHTS.map(r => r[0]).filter(k => p[k] === true);
  return { admin: false, sellora, erp, rights };
}

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
const sideOf = a => ({ admin: !!a.admin, sellora: SIDE === 'sellora' ? a.sellora : [], erp: SIDE === 'erp' ? a.erp : [], rights: a.rights.filter(SIDE_RIGHT) });
/** These boxes on this side, the other side's from base — what a role keeps when one page edits its half. */
const withOther = (next, base) => ({ admin: !!next.admin, sellora: SIDE === 'sellora' ? next.sellora : (base ? base.sellora : []), erp: SIDE === 'erp' ? next.erp : (base ? base.erp : []),
  rights: next.rights.filter(SIDE_RIGHT).concat(base ? base.rights.filter(k => !SIDE_RIGHT(k)) : []) });
function sameAccess(a, b) {
  if (a.admin || b.admin) return !!a.admin === !!b.admin;
  a = sideOf(a); b = sideOf(b);
  return sameSet(a.sellora, b.sellora) && sameSet(a.erp, b.erp) && sameSet(a.rights, b.rights);
}
/* What a person has beyond a role (+) and what the role has that they lack (−). */
function accessDiff(person, role) {
  person = sideOf(person); role = sideOf(role);
  const plus = [], minus = [];
  [['sellora', person.sellora, role.sellora], ['erp', person.erp, role.erp], ['rights', person.rights, role.rights]].forEach(([kind, mine, theirs]) => {
    mine.forEach(k => { if (!theirs.includes(k)) plus.push([kind, k]); });
    theirs.forEach(k => { if (!mine.includes(k)) minus.push([kind, k]); });
  });
  return { plus, minus };
}

/* ==== ACCESS BY ROLE — the page ====
 * Departments → roles → the people in each role, with Special cases kept apart.
 * Everything is kept in this browser (localStorage); nothing is written to Sellora or Fabricrush. */

const STORE_KEY = 'selloraAccessRolesPreview.v1';
const $ = id => document.getElementById('acx-' + id);
const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const plural = (n, w) => n + ' ' + (n === 1 ? w : w === 'person' ? 'people' : w === 'match' ? 'matches' : w + 's');

/* Small line icons, drawn inline so the page works with no internet. */
const IC = {
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  production: '<svg viewBox="0 0 24 24"><path d="M3 21V9l6 4V9l6 4V5l6 4v12z"/><path d="M3 21h18"/></svg>',
  corporate: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/></svg>',
  shipping: '<svg viewBox="0 0 24 24"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
  other: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  ban: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
};

/* Every role with where it sits, flattened once. */
let ROLES = [];
/* The groups of a department: the built-in ones, then any made on this page. */
function deptGroups(d) {
  const names = d.groups.map(g => g.name);
  ((S && S.customRoles) || []).forEach(r => { if (r.dept === d.key && !names.includes(r.group)) names.push(r.group); });
  return names;
}
/* Built-in roles and roles added on this page, group by group, so each group's roles sit together. */
function buildRoles() {
  const custom = (S && S.customRoles) || [];
  ROLES = DEPARTMENTS.flatMap(d => deptGroups(d).flatMap(gname => {
    const g = d.groups.find(x => x.name === gname);
    return (g ? g.roles : []).map(r => ({ ...r, dept: d.key, deptName: d.name, group: gname }))
      .concat(custom.filter(r => r.dept === d.key && r.group === gname).map(r => ({ ...r, deptName: d.name, custom: true })));
  }));
}
const roleByKey = k => ROLES.find(r => r.key === k);
const LABEL = { sellora: {}, erp: {}, rights: {} };
SELLORA_GROUPS.forEach(g => g.items.forEach(([k, l]) => { LABEL.sellora[k] = l; }));
ERP_GROUPS.forEach(g => g.items.forEach(([k, l]) => { LABEL.erp[k] = l; }));
RIGHTS.forEach(([k, l]) => { LABEL.rights[k] = l; });
const APPS = [
  SIDE === 'sellora' ? { kind: 'sellora', name: 'Sellora', groups: SELLORA_GROUPS } : { kind: 'erp', name: 'Fabricrush (ERP)', groups: ERP_GROUPS },
  { kind: 'rights', name: 'Extra rights', groups: [{ name: 'Can also', items: RIGHTS.filter(r => SIDE_RIGHT(r[0]) && !/^bd/.test(r[0])) },
    { name: 'SHP / AMZ / B2B / SPY boards — only these buttons', items: RIGHTS.filter(r => SIDE_RIGHT(r[0]) && /^bd/.test(r[0])) }].filter(g => g.items.length) },
];

const DATA = { source: 'live', readAt: '', people: [] };
let DATA_STAMP = '';

let S = null;
let VIEW = { page: 'overview', dept: null };
let D = null;   // the open side panel: { kind: 'role'|'person', key|email, tab, editing, onlyGranted }

/* ---------- starting point: today's access, each person put in the role that matches it exactly ---------- */
function freshState() {
  buildRoles();
  const roles = {};
  ROLES.forEach(r => { roles[r.key] = roleAccess(r); });
  /* this page lists who has something on its side — and, on the ERP side, logins with nothing at all, so they can be cleaned away */
  const here = rec => { const a = personAccess(rec); return a.admin || !isEmptyAccess(a) || (SIDE === 'erp' && !a.sellora.length && !a.erp.length && !a.rights.length); };
  const people = DATA.people.filter(here).map(rec => {
    const email = String(rec.email || '').toLowerCase();
    if (email === OWNER_EMAIL) return { email, role: 'owner', special: null };
    const acc = personAccess(rec), tag = String(rec[ROLE_TAG] || (SIDE === 'sellora' ? rec.accessRole : '') || '');
    if (tag === '__special') return { email, role: null, special: acc };
    if (tag && roles[tag] && (roles[tag].admin ? acc.admin : sameAccess(acc, roles[tag]))) return { email, role: tag, special: null };
    if (acc.admin) return { email, role: 'owneradmin', special: null };
    const match = ROLES.find(r => !r.admin && sameAccess(acc, roles[r.key]));
    return match ? { email, role: match.key, special: null } : { email, role: null, special: acc };
  });
  return { roles, people, customRoles: [], dataStamp: DATA_STAMP };
}
/* A copy kept from an earlier visit may not know a role added since; such a role starts with its listed access. */
function load() {
  /* the roles as saved (config/accessRoles): their boxes (roleAccess reads them) and roles added on this page */
  const saved = (ACX_ROLES_DOC && ACX_ROLES_DOC.roles) || {};
  const custom = Object.entries(saved).filter(([, v]) => v && v.custom).map(([key, v]) => Object.assign({ key }, v.custom));
  S = { customRoles: custom };
  const st = freshState();
  st.customRoles = custom;
  ROLES.forEach(r => { const v = saved[r.key]; if (v && v.access) st.roles[r.key] = v.access; });
  return st;
}
function save() { /* nothing is kept in the browser: every change is written (acxDo) */ }

/* ---------- SAVING: every change here is a real change ---------- */
const acxOld = email => DATA.people.find(p => p.email === email) || null;
/** The perms record for these boxes, built the way Save access builds it. Boxes this page has no row for (hidden Sellora tabs, brands,
 *  the old production app flag) are kept from the old record, so nothing anybody has is dropped by accident. */
function acxRecord(old, a, roleKey) {
  old = old || {};
  const keepS = (old.tabs || []).filter(t => !ALL_SELLORA.includes(t)), keepE = (old.replTabs || []).filter(t => !ALL_ERP.includes(t));
  /* admin is the ERP side's to give or take */
  const rec = { admin: SIDE === 'erp' ? !!a.admin : old.admin === true, brands: old.brands || [], prod: !!old.prod };
  if (rec.admin) { rec.tabs = old.tabs || []; rec.replTabs = old.replTabs || []; rec.repl = !!old.repl; RIGHTS.forEach(([k]) => { rec[k] = old[k] === true; }); }
  else {
    /* the other side's half stays exactly as it was */
    rec.tabs = SIDE === 'sellora' ? [...new Set(a.sellora.concat(keepS))] : (old.tabs || []);
    if (SIDE === 'erp') {
      rec.replTabs = [...new Set(a.erp.concat(keepE))];
      /* only a section that reads Firestore turns repl on (Save access's rule); the old "whole app" flag stays only while no section is ticked */
      rec.repl = (old.repl === true && !(old.replTabs || []).length && !a.erp.length) || rec.replTabs.some(t => !FACTORY_SECTIONS.includes(t));
    } else { rec.replTabs = old.replTabs || []; rec.repl = old.repl === true; }
    RIGHTS.forEach(([k]) => { rec[k] = SIDE_RIGHT(k) ? a.rights.includes(k) : old[k] === true; });
  }
  rec.accessRole = SIDE === 'erp' ? (roleKey || '') : String(old.accessRole || '');
  rec.selloraRole = SIDE === 'sellora' ? (roleKey || '') : String(old.selloraRole || '');
  return rec;
}
/** Nothing left anywhere: no screen in either app, no right, not admin. */
const acxBare = rec => !rec.admin && !(rec.tabs || []).length && !(rec.replTabs || []).length && !rec.repl && !RIGHTS.some(([k]) => rec[k] === true);
const acxCanEdit = () => !!(ME && ME.admin);
async function acxWrite(email, a, roleKey) {
  if (!acxCanEdit()) throw new Error('view only — only an admin can change access');
  if (SIDE === 'erp' && email === String(ME.email || '').toLowerCase() && !a.admin) throw new Error('you cannot take away your own admin rights');
  const rec = acxRecord(acxOld(email), a, roleKey);
  await setDoc(doc(db, 'perms', email), Object.assign({}, rec, { at: serverTimestamp(), by: ME.email }));
  try { await permMirror(email, rec); } catch (e) { throw new Error('saved, but NOT in the production database copy (' + (e.message || e) + ') — do it again'); }
}
/** Remove: this side's half only. When nothing is left anywhere, the record goes too. */
async function acxRemoveSide(email) {
  if (!acxCanEdit()) throw new Error('view only — only an admin can change access');
  if (email === String(ME.email || '').toLowerCase()) throw new Error('you cannot remove your own access');
  const old = acxOld(email) || {};
  if (old.admin === true && SIDE !== 'erp') throw new Error(email + ' is an admin — that is changed in the ERP Access page');
  const rec = acxRecord(old, { admin: false, sellora: [], erp: [], rights: [] }, '');
  if (acxBare(rec)) return acxDel(email);
  await setDoc(doc(db, 'perms', email), Object.assign({}, rec, { at: serverTimestamp(), by: ME.email }));
  try { await permMirror(email, rec); } catch (e) { throw new Error('saved, but NOT in the production database copy (' + (e.message || e) + ') — do it again'); }
}
async function acxDel(email) {
  if (!acxCanEdit()) throw new Error('view only — only an admin can change access');
  if (email === String(ME.email || '').toLowerCase()) throw new Error('you cannot remove your own access');
  await deleteDoc(doc(db, 'perms', email));
  try { await permMirror(email, null); } catch (e) { throw new Error('removed, but their copy in the production database is still there (' + (e.message || e) + ') — remove again'); }
}
/** The roles as they stand — their boxes, and roles added here — into config/accessRoles. */
async function acxSaveRoles() {
  if (!acxCanEdit()) throw new Error('view only — only an admin can change access');
  const out = {};
  ROLES.forEach(r => { out[r.key] = { access: S.roles[r.key] }; });
  (S.customRoles || []).forEach(r => { out[r.key] = Object.assign({}, out[r.key], { custom: { name: r.name, dept: r.dept, group: r.group, limit: r.limit || '', cannot: r.cannot || '' } }); });
  await setDoc(doc(db, 'config', 'accessRoles'), { roles: out, at: serverTimestamp(), by: ME.email });
}
/** Ask, do it, say so, read the list again. */
async function acxDo(ask, fn, ok) {
  if (ask && typeof confirm === 'function' && !confirm(ask)) return false;
  try { await fn(); } catch (e) { toast('Not saved: ' + (e.message || e)); await loadAccessList(); return false; }
  toast(ok); await loadAccessList(); return true;
}
const acxRoleName = k => k === '__special' ? 'Special cases' : (roleByKey(k) || {}).name || k;
const membersOf = key => S.people.filter(p => p.role === key);
const specials = () => S.people.filter(p => !p.role);
const personBy = email => S.people.find(p => p.email === email);
const accessOf = p => p.role === 'owner' ? personAccess({ email: OWNER_EMAIL }) : p.role ? S.roles[p.role] : p.special;
const isEmptyAccess = a => { if (a.admin) return false; const m = sideOf(a); return !m.sellora.length && !m.erp.length && !m.rights.length; };
/* A role is shown on this side when it gives something here, is Admin, or somebody is in it. */
const shown = r => !!r && (r.admin || !isEmptyAccess(S.roles[r.key] || { sellora: [], erp: [], rights: [] }) || membersOf(r.key).length > 0);
const shownRoles = () => ROLES.filter(shown);
/* The Sellora side never makes anybody admin: the admin roles are not offered there. */
const pickable = r => shown(r) && !(SIDE !== 'erp' && r.admin);
const placeOf = p => p.role === 'owner' ? { dept: 'Owner', role: 'Owner / Admin' } : p.role ? { dept: roleByKey(p.role).deptName, role: roleByKey(p.role).name } : { dept: 'Special cases', role: 'Own boxes' };
function countPills(a) {
  if (a.admin) return '<span class="pill admin">Everything · Admin</span>';
  if (isEmptyAccess(a)) return '<span class="pill grey">Nothing granted</span>';
  a = sideOf(a);
  const p = [];
  /* the page is one app's already, so the pill says how many screens, not which app (Ravi, 4 Nov: "45 access points") */
  const pts = a.sellora.length + a.erp.length;
  if (pts) p.push(`<span class="pill grey">${plural(pts, 'access point')}</span>`);
  if (a.rights.length) p.push(`<span class="pill grey">${plural(a.rights.length, 'right')}</span>`);
  return '<span class="counts">' + p.join('') + '</span>';
}
function summaryText(a) {
  if (a.admin) return 'Everything in both apps';
  if (isEmptyAccess(a)) return 'Nothing granted in ' + SIDE_NAME;
  a = sideOf(a);
  const pages = a.sellora.length + a.erp.length;
  return plural(pages, 'access point') + (a.rights.length ? ' · ' + plural(a.rights.length, 'right') : '');
}
function closestRole(a) {
  let best = null;
  ROLES.filter(r => !r.admin && shown(r)).forEach(r => {
    const d = accessDiff(a, S.roles[r.key]);
    const n = d.plus.length + d.minus.length;
    if (!best || n < best.n) best = { role: r, diff: d, n };
  });
  return best;
}

/* Initials and a steady colour per person. */
function initials(email) {
  const local = email.split('@')[0].replace(/[^a-z0-9.]/gi, ' ');
  const parts = local.split(/[.\s_-]+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2);
  return s.toUpperCase();
}
const avColour = email => 'c' + ([...email].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 6);
const avatar = (email, cls = '') => `<span class="av ${avColour(email)} ${cls}" title="${esc(email)}">${esc(initials(email))}</span>`;
function avatarStack(list, max = 4) {
  if (!list.length) return '<span class="zero">No one</span>';
  return '<span class="avatars">' + list.slice(0, max).map(p => avatar(p.email)).join('')
    + (list.length > max ? `<span class="av more">+${list.length - max}</span>` : '') + '</span>';
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ---------- left menu ---------- */
function renderNav() {
  const item = (page, dept, icon, label, n, cls = '') => {
    const on = VIEW.page === page && (page !== 'dept' || VIEW.dept === dept);
    return `<button class="nav-item ${cls} ${on ? 'on' : ''}" type="button" data-nav="${page}" ${dept ? `data-dept="${dept}"` : ''}>${icon}<span>${esc(label)}</span><span class="n">${n}</span></button>`;
  };
  const deptCount = d => ROLES.filter(r => r.dept === d.key).reduce((n, r) => n + membersOf(r.key).length, 0);
  const depts = DEPARTMENTS.filter(d => shownRoles().some(r => r.dept === d.key));
  $('sidenav').innerHTML = item('overview', null, IC.grid, 'Overview', S.people.length)
    + '<div class="nav-label">Departments</div>'
    + depts.map(d => item('dept', d.key, IC[d.key], d.name, deptCount(d))).join('')
    + '<div class="nav-sep"></div>'
    + item('special', null, IC.star, 'Special cases', specials().length, 'special-nav')
    + item('people', null, IC.people, 'All people', S.people.length)
    + (acxCanEdit() ? '<p class="nav-note">Changes here are real: they change what people can open in ' + SIDE_NAME + '. ' + (SIDE === 'erp' ? 'Sellora screens are given in Sellora → Access.' : 'ERP screens, admins and deleting a login are in the ERP → Access.') + ' Each one asks first.</p>'
      : '<p class="nav-note">View only. You can see who can open what; changing it needs an admin.</p>');
}

/* ---------- main area ---------- */
function roleTable(roles, q) {
  let lastGroup = '';
  return `<table class="t"><thead><tr><th>Role</th><th class="hide-sm">Access</th><th>Members</th><th class="chev"></th></tr></thead><tbody>`
    + roles.map(r => {
      const m = membersOf(r.key);
      const head = r.group !== lastGroup ? `<tr class="grp"><td colspan="4">${esc(r.group)}</td></tr>` : '';
      lastGroup = r.group;
      const hit = q && (m.some(p => p.email.includes(q)) || roleHit(r, q) || accessHit(S.roles[r.key], q));
      return head + `<tr class="row ${hit ? 'hit' : ''}" data-open-role="${r.key}" tabindex="0">
        <td><div class="cell-title">${esc(r.name)} ${r.admin ? '<span class="pill admin">Admin</span>' : ''} ${r.limit ? '<span class="pill limit">Limit</span>' : ''} ${r.custom ? '<span class="pill grey">Added here</span>' : ''}</div></td>
        <td class="hide-sm">${countPills(S.roles[r.key])}</td>
        <td><button class="btn ghost sm" type="button" data-open-members="${r.key}">${m.length ? avatarStack(m) + " <span>" + m.length + "</span>" : "<span class=\"zero\">No one</span>"}</button></td>
        <td class="chev">${IC.chev}</td>
      </tr>`;
    }).join('') + '</tbody></table>';
}

/* SEARCH BY ROLE TOO (Ravi, 3 Nov: "also add search by role in search button"): a word finds people by their email, their role's name,
 * its group or department — "cutting" lists the Cutting master's people, "amazon" everyone in the Amazon group. */
const roleHit = (r, q) => !!r && [r.name, r.group, r.deptName].some(x => String(x || '').toLowerCase().includes(q));
/* SEARCH BY AN ACCESS TOO (Ravi, 4 Nov: "access ka naam dala jaise sales dashboard toh voh saare users ke mails dikha de"): a word that
 * names a screen or a right on this side finds everybody who holds it. */
function accessHit(a, q) {
  if (!a || !q) return false;
  if (a.admin) return false;
  const m = sideOf(a);
  return m.sellora.some(k => String(LABEL.sellora[k] || k).toLowerCase().includes(q)) || m.erp.some(k => String(LABEL.erp[k] || k).toLowerCase().includes(q))
    || m.rights.some(k => String(LABEL.rights[k] || k).toLowerCase().includes(q));
}
/** The screens and rights of this side whose name has the word in it. */
const accessNamed = q => !q ? [] : [].concat(SIDE === 'sellora' ? SELLORA_GROUPS : ERP_GROUPS).flatMap(g => g.items).concat(RIGHTS.filter(r => SIDE_RIGHT(r[0])))
  .filter(([k, l]) => String(l).toLowerCase().includes(q)).map(x => x[1]);
function personHit(p, q) {
  if (p.email.includes(q)) return true;
  if (accessHit(accessOf(p), q)) return true;
  const pl = placeOf(p);
  return [pl.role, pl.dept].some(x => String(x || '').toLowerCase().includes(q)) || roleHit(p.role && p.role !== 'owner' ? roleByKey(p.role) : null, q);
}
function renderMain() {
  const q = $('search').value.trim().toLowerCase();
  const c = $('content');
  const sp = specials();
  if (VIEW.page === 'overview') {
    const used = ROLES.filter(r => membersOf(r.key).length).length, roleN = shownRoles().length;
    const admins = S.people.filter(p => p.role === 'owner' || !!(roleByKey(p.role) || {}).admin).length;
    c.innerHTML = `<div class="page-head"><div><h1>Overview</h1><p class="muted">Every person sits in one role, or in Special cases. Click a role to see its access.</p></div>
      <button class="btn" type="button" data-add-role="">${IC.plus} Add role</button></div>
      <div class="stats">
        <button class="stat" type="button" data-nav="people"><div class="v">${S.people.length}</div><div class="l">People with ${SIDE === 'erp' ? 'ERP' : 'Sellora'} access</div></button>
        <div class="stat"><div class="v">${used}<span class="muted" style="font-size:15px"> / ${roleN}</span></div><div class="l">Roles in use</div></div>
        <button class="stat special" type="button" data-nav="special"><div class="v">${sp.length}</div><div class="l">Special cases</div></button>
        <div class="stat"><div class="v">${admins}</div><div class="l">Admins</div></div>
      </div>
      <div class="dept-grid">` + DEPARTMENTS.filter(d => shownRoles().some(r => r.dept === d.key)).map(d => {
        const roles = shownRoles().filter(r => r.dept === d.key);
        const n = roles.reduce((s, r) => s + membersOf(r.key).length, 0);
        return `<section class="card"><div class="card-head"><div><h2>${esc(d.name)}</h2><p class="muted">${plural(roles.length, 'role')} · ${plural(n, 'person')}</p></div>
          <button class="btn sm" type="button" data-nav="dept" data-dept="${d.key}">Open ${IC.chev}</button></div>
          <table class="t small-list"><tbody>` + roles.map(r => {
            const m = membersOf(r.key);
            return `<tr class="row" data-open-role="${r.key}" tabindex="0"><td><div class="cell-title">${esc(r.name)}</div><div class="cell-sub">${esc(r.group)}</div></td>
              <td class="num">${m.length ? avatarStack(m, 3) : '<span class="zero">No one</span>'}</td></tr>`;
          }).join('') + '</tbody></table></section>';
      }).join('') + '</div>';
    return;
  }
  if (VIEW.page === 'dept') {
    const d = DEPARTMENTS.find(x => x.key === VIEW.dept);
    const roles = shownRoles().filter(r => r.dept === d.key);
    const n = roles.reduce((s, r) => s + membersOf(r.key).length, 0);
    c.innerHTML = `<div class="page-head"><div><h1>${esc(d.name)}</h1><p class="muted">${deptGroups(d).map(esc).join(' · ')} — ${plural(roles.length, 'role')}, ${plural(n, 'person')}</p></div>
      <div class="top-actions"><button class="btn" type="button" data-add-role="${d.key}">${IC.plus} Add role</button><button class="btn" type="button" data-add-in="${d.key}">${IC.plus} Add person</button></div></div>
      <section class="card">${roleTable(roles, q)}</section>`;
    return;
  }
  if (VIEW.page === 'special') {
    c.innerHTML = `<div class="page-head"><div><h1>Special cases</h1><p class="muted">Kept apart from the main users. Their access fits no role, so the admin sets their boxes one by one.</p></div>
      <button class="btn" type="button" data-add-in="__special">${IC.plus} Add a special case</button></div>
      <div class="callout special">${IC.info}<div>Each person is compared with the role closest to them. Small differences usually mean the person belongs in that role — open them and use <b>Move to a role</b>.</div></div>
      <section class="card">` + (sp.length ? `<table class="t"><thead><tr><th>Person</th><th class="hide-sm">Access</th><th>Closest role</th><th class="chev"></th></tr></thead><tbody>`
        + sp.map(p => {
          const near = isEmptyAccess(p.special) ? null : closestRole(p.special);
          const hit = q && personHit(p, q);
          return `<tr class="row ${hit ? 'hit' : ''}" data-open-person="${esc(p.email)}" tabindex="0">
            <td><div style="display:flex;gap:10px;align-items:center">${avatar(p.email, 'lg')}<div><div class="cell-title">${esc(p.email)}</div></div></div></td>
            <td class="hide-sm">${countPills(p.special)}</td>
            <td>${near ? `<div class="cell-title">${esc(near.role.name)}</div><div class="counts">${near.diff.plus.length ? `<span class="pill plus">+${near.diff.plus.length} extra</span>` : ""}${near.diff.minus.length ? `<span class="pill minus">−${near.diff.minus.length} missing</span>` : ""}</div>` : '<span class="zero">No access at all</span>'}</td>
            <td class="chev">${IC.chev}</td></tr>`;
        }).join('') + '</tbody></table>'
        : `<div class="empty-state">${IC.check}<div>Nobody — everyone fits a role.</div></div>`) + '</section>';
    return;
  }
  /* All people */
  const list = S.people.filter(p => !q || personHit(p, q)).sort((a, b) => a.email.localeCompare(b.email));
  const named = accessNamed(q);
  c.innerHTML = `<div class="page-head"><div><h1>All people</h1><p class="muted">${q ? plural(list.length, 'match') + ' for “' + esc(q) + '”'
      + (named.length ? ' — including everybody who can open ' + named.slice(0, 4).map(n => '<b>' + esc(n) + '</b>').join(', ') + (named.length > 4 ? ' and ' + (named.length - 4) + ' more' : '') : '')
      : plural(S.people.length, 'person') + ' with ' + (SIDE === 'erp' ? 'ERP' : 'Sellora') + ' access'}</p></div></div>
    <section class="card">` + (list.length ? `<table class="t"><thead><tr><th>Person</th><th class="hide-sm">Department</th><th>Role</th><th class="hide-sm">Access</th><th class="chev"></th></tr></thead><tbody>`
      + list.map(p => {
        const pl = placeOf(p);
        const rolePill = p.role === 'owner' ? '<span class="pill admin">Owner</span>' : p.role ? `<span class="pill role">${esc(pl.role)}</span>` : '<span class="pill special">Special case</span>';
        return `<tr class="row" data-open-person="${esc(p.email)}" tabindex="0">
          <td><div style="display:flex;gap:10px;align-items:center">${avatar(p.email, 'lg')}<span class="cell-title" style="word-break:break-all">${esc(p.email)}</span></div></td>
          <td class="hide-sm">${esc(pl.dept)}</td><td>${rolePill}</td><td class="hide-sm cell-sub">${esc(summaryText(accessOf(p)))}</td><td class="chev">${IC.chev}</td></tr>`;
      }).join('') + '</tbody></table>'
      : `<div class="empty-state">${IC.search}<div>No one matches “${esc(q)}”.</div></div>`) + '</section>';
}

function renderSource() {
  $('source').textContent = ('Today’s access, read ' + DATA.readAt)
    + ' · ' + plural(S.people.length, 'person');
}
function render() { renderSource(); renderNav(); renderMain(); if (D) renderDrawer(); }

/* ---------- access list: every page of each app, ticked or not ---------- */
function accessBlocks(a, { editing = false, onlyGranted = true, base = null } = {}) {
  if (a.admin) return `<div class="callout limit">${IC.lock}<div><b>Everything.</b> Every page in Sellora and Fabricrush, every right, pay and rates, and the Access page itself.</div></div>`;
  if (!editing && isEmptyAccess(a)) return `<div class="callout info">${IC.info}<div>Nothing granted in ${SIDE_NAME}.</div></div>`;
  return APPS.map(app => {
    const keys = a[app.kind];
    const total = app.groups.reduce((n, g) => n + g.items.length, 0);
    const secs = app.groups.map(g => {
      const on = g.items.filter(([k]) => keys.includes(k));
      if (!editing && onlyGranted && !on.length) return '';
      const items = g.items.filter(([k]) => editing || !onlyGranted || keys.includes(k));
      return `<div class="sec"><div class="sec-name"><span>${esc(g.name)}</span><span class="all">${on.length} / ${g.items.length}</span></div><div class="pages">`
        + items.map(([k, l]) => {
          const has = keys.includes(k);
          if (editing) {
            const changed = base && base[app.kind].includes(k) !== has;
            return `<label class="page ${changed ? 'changed' : ''}"><input type="checkbox" data-kind="${app.kind}" value="${k}" ${has ? 'checked' : ''}><span>${esc(l)}</span></label>`;
          }
          return `<div class="page ${has ? 'on' : 'off'}"><span class="mk">${has ? IC.check : ''}</span><span>${esc(l)}</span></div>`;
        }).join('') + '</div></div>';
    }).join('');
    if (!editing && onlyGranted && !keys.length) return '';
    return `<div class="app-block"><div class="app-block-head"><b>${app.name}</b><span class="of">${keys.length} of ${total}</span></div>${secs || '<div class="sec muted">None</div>'}</div>`;
  }).join('') || `<div class="callout info">${IC.info}<div>No pages in ${SIDE_NAME}.</div></div>`;
}
function readBoxes() {
  const a = { admin: false, sellora: [], erp: [], rights: [] };
  $('drawerBody').querySelectorAll('input[data-kind]:checked').forEach(c => a[c.dataset.kind].push(c.value));
  return a;
}
function roleNotes(r) {
  return (r.limit ? `<div class="callout limit">${IC.info}<div><b>Limit:</b> ${esc(r.limit)}</div></div>` : '')
    + (r.cannot ? `<div class="callout cannot">${IC.ban}<div><b>Cannot:</b> ${esc(r.cannot)}</div></div>` : '');
}
const roleOptions = (current, withSpecial) => DEPARTMENTS.filter(d => ROLES.some(r => r.dept === d.key && (pickable(r) || r.key === current))).map(d => `<optgroup label="${esc(d.name)}">` + ROLES.filter(r => r.dept === d.key && (pickable(r) || r.key === current))
  .map(r => `<option value="${r.key}" ${r.key === current ? 'selected' : ''}>${esc(r.name)}</option>`).join('') + '</optgroup>').join('')
  + (withSpecial ? `<option value="__special" ${current === '__special' ? 'selected' : ''}>Special case (own boxes)</option>` : '');

/* ---------- side panel ---------- */
function openDrawer(d) {
  D = { tab: 'access', editing: false, onlyGranted: true, ...d };
  renderDrawer();
  $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); $('scrim').hidden = false;
}
function closeDrawer() {
  D = null;
  $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); $('scrim').hidden = true;
  render();
}
$('scrim').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && D && !$('modal').open) closeDrawer(); });

function renderDrawer() {
  $('drawerBody').onchange = null;
  if (D.kind === 'role') return renderRoleDrawer();
  return renderPersonDrawer();
}
const closeBtn = '<button class="icon-btn" type="button" data-close-drawer aria-label="Close">' + IC.x + '</button>';
function tabs(list) {
  $('drawerTabs').innerHTML = list.map(([k, l, n]) => `<button class="tab ${D.tab === k ? 'on' : ''}" type="button" data-tab="${k}">${esc(l)}${n != null ? `<span class="n">${n}</span>` : ''}</button>`).join('');
  $('drawerTabs').querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { D.tab = b.dataset.tab; D.editing = false; renderDrawer(); }; });
}

function renderRoleDrawer() {
  const r = roleByKey(D.key), m = membersOf(D.key), a = S.roles[D.key];
  $('drawerHead').innerHTML = `<div class="grow"><div class="crumb">${esc(r.deptName)} › ${esc(r.group)}</div><h2 id="acx-drawerTitle">${esc(r.name)}</h2>
    <div class="head-meta">${countPills(a)} <span class="pill grey">${plural(m.length, 'member')}</span></div></div>${closeBtn}`;
  tabs([['access', 'Access'], ['members', 'Members', m.length]]);
  const body = $('drawerBody'), foot = $('drawerFoot');

  if (D.tab === 'members') {
    body.innerHTML = `<div class="add-member"><input type="email" id="acx-memberAdd" placeholder="name@thefabricrush.com" aria-label="Email to add to ${esc(r.name)}"><button class="btn primary" type="button" id="acx-memberAddBtn">${IC.plus} Add</button></div><div class="err" id="acx-memberErr"></div>`
      + (m.length ? m.map(p => `<div class="member" data-email="${esc(p.email)}">${avatar(p.email, 'lg')}
          <div class="who"><div class="email">${esc(p.email)}</div><div class="sub">${esc(r.name)}</div></div>
          <select class="sm" data-move aria-label="Role for ${esc(p.email)}">${roleOptions(D.key, true)}</select>
          <button class="btn sm danger" type="button" data-remove>Remove</button></div>`).join('')
        : `<div class="empty-state">${IC.people}<div>Nobody in this role yet.</div></div>`);
    foot.innerHTML = '';
    body.querySelectorAll('.member').forEach(row => {
      const p = personBy(row.dataset.email);
      row.querySelector('[data-move]').onchange = e => {
        const to = e.target.value;
        const go = to === '__special' ? () => acxWrite(p.email, S.roles[D.key], '__special') : () => acxWrite(p.email, S.roles[to], to);
        acxDo(to === '__special' ? `Keep ${p.email} apart in Special cases? Their boxes stay as they are.` : `Give ${p.email} exactly what ${roleByKey(to).name} has? Their access changes now.`,
          go, p.email + ' moved to ' + acxRoleName(to)).then(done => { if (!done) e.target.value = D.key; });
      };
      const rm = row.querySelector('[data-remove]');
      rm.onclick = () => {
        if (rm.dataset.sure) { acxDo('', () => acxRemoveSide(p.email), p.email + ' — ' + SIDE_NAME + ' access removed'); return; }
        rm.dataset.sure = '1'; rm.textContent = 'Sure?';
      };
    });
    const add = () => {
      const email = $('memberAdd').value.trim().toLowerCase();
      const err = whyNotEmail(email);
      if (err) { $('memberErr').textContent = err; return; }
      acxDo(`Give ${email} exactly what ${r.name} has?`, () => acxWrite(email, S.roles[D.key], D.key), email + ' added to ' + r.name);
    };
    $('memberAddBtn').onclick = add;
    $('memberAdd').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    $('memberAdd').addEventListener('input', () => { $('memberErr').textContent = ''; });
    return;
  }

  if (D.editing) {
    body.innerHTML = accessBlocks(a, { editing: true, base: a }) + roleNotes(r);
    const update = () => {
      const next = readBoxes(), d = accessDiff(next, a);
      body.querySelectorAll('label.page').forEach(l => {
        const i = l.querySelector('input');
        l.classList.toggle('changed', a[i.dataset.kind].includes(i.value) !== i.checked);
      });
      foot.querySelector('.left').innerHTML = d.plus.length || d.minus.length
        ? `<b>+${d.plus.length} / −${d.minus.length}</b> · applies to ${plural(m.length, 'member')}`
        : 'No changes yet';
      foot.querySelector('[data-save]').disabled = !(d.plus.length || d.minus.length);
    };
    foot.innerHTML = `<span class="left"></span><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-save>Save role</button>`;
    body.onchange = update;
    update();
    foot.querySelector('[data-cancel]').onclick = () => { D.editing = false; renderDrawer(); };
    foot.querySelector('[data-save]').onclick = () => {
      const next = withOther(readBoxes(), a), d = accessDiff(next, a), key = D.key, was = S.roles[key];
      acxDo(m.length ? `Save ${r.name}: +${d.plus.length} / −${d.minus.length}. This changes the access of ${m.length === 1 ? '1 person' : m.length + ' people'} now:\n` + m.map(p => p.email).join('\n') : `Save ${r.name}?`,
        async () => { S.roles[key] = next; try { await acxSaveRoles(); } catch (e) { S.roles[key] = was; throw e; }
          const bad = []; for (const p of m) { try { await acxWrite(p.email, next, key); } catch (e) { bad.push(p.email + ': ' + (e.message || e)); } }
          if (bad.length) throw new Error('the role is saved, but ' + bad.length + ' of its people are not — ' + bad.join('; ')); },
        `${r.name} saved: +${d.plus.length} / −${d.minus.length} · ${m.length === 1 ? '1 member follows' : m.length + ' members follow'} it`).then(done => { if (done && D) D.editing = false; if (D) renderDrawer(); });
    };
    return;
  }

  body.innerHTML = (r.admin ? '' : `<label class="only-toggle"><input type="checkbox" id="acx-onlyGranted" ${D.onlyGranted ? 'checked' : ''}> Show only what this role has</label>`)
    + accessBlocks(a, { onlyGranted: D.onlyGranted }) + roleNotes(r);
  if (!r.admin) $('onlyGranted').onchange = e => { D.onlyGranted = e.target.checked; renderDrawer(); };
  foot.innerHTML = r.admin
    ? `<span class="left">IT admin is full Admin; its access cannot be narrowed here.</span>`
    : (r.custom ? `<button class="btn sm danger" type="button" data-delete-role>Delete role</button>` : '')
      + `<span class="left">${m.length === 1 ? "Changes apply to its 1 member" : m.length ? "Changes apply to all " + m.length + " members" : "No members yet"}</span><button class="btn primary" type="button" data-edit>${IC.edit} Edit access</button>`;
  if (!r.admin) foot.querySelector('[data-edit]').onclick = () => { D.editing = true; renderDrawer(); };
  /* Only a role made on this page can be deleted, and only once nobody is in it. */
  const del = foot.querySelector('[data-delete-role]');
  if (del) del.onclick = () => {
    if (m.length) { toast('Move its ' + plural(m.length, 'member') + ' to another role first'); return; }
    if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'Sure? Delete'; return; }
    const keepC = S.customRoles, keepR = S.roles[r.key];
    S.customRoles = S.customRoles.filter(x => x.key !== r.key); delete S.roles[r.key]; buildRoles();
    acxDo('', async () => { try { await acxSaveRoles(); } catch (e) { S.customRoles = keepC; S.roles[r.key] = keepR; buildRoles(); throw e; } }, r.name + ' deleted').then(() => closeDrawer());
  };
}

/* ---------- + Add role: name, department, group, then the boxes ---------- */
function openAddRole(deptKey, w) {
  w = w || { dept: deptKey || DEPARTMENTS[0].key, group: '', newGroup: '', name: '', limit: '', cannot: '', copy: '', access: { admin: false, sellora: [], erp: [], rights: [] } };
  const d = DEPARTMENTS.find(x => x.key === w.dept);
  const groups = deptGroups(d);
  if (!w.group) w.group = groups[0];
  openModal('Add a role', 'Name it, place it, and tick what it can open. Everyone you put in it gets exactly this.',
    `<div class="role-form">
      <div class="field"><label for="acx-arName">Role name</label><input type="text" id="acx-arName" value="${esc(w.name)}" placeholder="e.g. Cutting master" autocomplete="off"></div>
      <div class="form-row">
        <div class="field"><label for="acx-arDept">Department</label><select id="acx-arDept">${DEPARTMENTS.map(x => `<option value="${x.key}" ${x.key === w.dept ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="acx-arGroup">Group</label><select id="acx-arGroup">${groups.map(g => `<option value="${esc(g)}" ${g === w.group ? 'selected' : ''}>${esc(g)}</option>`).join('')}<option value="__new" ${w.group === '__new' ? 'selected' : ''}>New group…</option></select></div>
      </div>
      ${w.group === '__new' ? `<div class="field"><label for="acx-arNewGroup">New group name</label><input type="text" id="acx-arNewGroup" value="${esc(w.newGroup)}" placeholder="e.g. Cutting" autocomplete="off"></div>` : ''}
      <div class="field"><label for="acx-arCopy">Start from</label><select id="acx-arCopy"><option value="">Nothing ticked</option>${shownRoles().filter(r => !r.admin).map(r => `<option value="${r.key}" ${r.key === w.copy ? 'selected' : ''}>${esc(r.deptName)} · ${esc(r.name)}</option>`).join('')}</select>
        <p class="muted">Copies that role's boxes below, so you only change what differs.</p></div>
      <div class="form-row">
        <div class="field"><label for="acx-arLimit">Limit <span class="muted">(optional)</span></label><input type="text" id="acx-arLimit" value="${esc(w.limit)}" placeholder="e.g. Own department only" autocomplete="off"></div>
        <div class="field"><label for="acx-arCannot">Cannot <span class="muted">(optional)</span></label><input type="text" id="acx-arCannot" value="${esc(w.cannot)}" placeholder="e.g. See pay or rates" autocomplete="off"></div>
      </div>
      <h3>What this role can open and do</h3>
      <div id="acx-arBoxes">${accessBlocks(w.access, { editing: true })}</div>
    </div>`,
    `<span class="left" id="acx-arCount"></span><span class="err" id="acx-arErr"></span><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-save>Add role</button>`);
  const read = () => {
    const a = { admin: false, sellora: [], erp: [], rights: [] };
    $('arBoxes').querySelectorAll('input[data-kind]:checked').forEach(c => a[c.dataset.kind].push(c.value));
    return { ...w, name: $('arName').value, group: $('arGroup').value, newGroup: $('arNewGroup') ? $('arNewGroup').value : w.newGroup,
      limit: $('arLimit').value, cannot: $('arCannot').value, copy: $('arCopy').value, access: a };
  };
  const count = () => { const a = read().access; $('arCount').textContent = isEmptyAccess(a) ? 'Nothing ticked yet' : summaryText(a) + ' ticked'; $('arErr').textContent = ''; };
  count();
  $('arBoxes').onchange = count;
  $('arName').oninput = () => { $('arErr').textContent = ''; };
  $('arDept').onchange = e => openAddRole(null, { ...read(), dept: e.target.value, group: '' });
  $('arGroup').onchange = () => openAddRole(null, read());
  $('arCopy').onchange = e => {
    const src = e.target.value;
    openAddRole(null, { ...read(), access: src ? JSON.parse(JSON.stringify(S.roles[src])) : { admin: false, sellora: [], erp: [], rights: [] } });
  };
  $('modalFoot').querySelector('[data-cancel]').onclick = () => modal.close();
  $('modalFoot').querySelector('[data-save]').onclick = () => {
    const f = read(), name = f.name.trim(), err = m => { $('arCount').textContent = ''; $('arErr').textContent = m; };
    if (!name) { err('Give the role a name.'); $('arName').focus(); return; }
    const same = ROLES.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (same) { err('There is already a ' + same.name + ' role, in ' + same.deptName + '. Pick another name.'); return; }
    const group = f.group === '__new' ? f.newGroup.trim() : f.group;
    if (!group) { err('Name the new group.'); return; }
    if (isEmptyAccess(f.access)) { err('Tick at least one page or right.'); return; }
    const key = 'r' + Date.now().toString(36);
    S.customRoles.push({ key, name, dept: f.dept, group, limit: f.limit.trim(), cannot: f.cannot.trim() });
    S.roles[key] = f.access;
    buildRoles(); modal.close();
    acxDo('', async () => { try { await acxSaveRoles(); } catch (e) { S.customRoles = S.customRoles.filter(x => x.key !== key); delete S.roles[key]; buildRoles(); throw e; } },
      name + ' added to ' + d.name + ' › ' + group).then(done => { if (!done) return; VIEW = { page: 'dept', dept: f.dept }; render(); openDrawer({ kind: 'role', key }); });
  };
  setTimeout(() => { if (!w.name) $('arName').focus(); }, 30);
}

function renderPersonDrawer() {
  const p = personBy(D.email);
  if (!p) { closeDrawer(); return; }
  const pl = placeOf(p), a = accessOf(p);
  const tag = p.role === 'owner' ? '<span class="pill admin">Owner</span>' : p.role ? `<span class="pill role">${esc(pl.role)}</span>` : '<span class="pill special">Special case</span>';
  $('drawerHead').innerHTML = `${avatar(p.email, 'lg')}<div class="grow"><div class="crumb">${esc(pl.dept)}</div><h2 id="acx-drawerTitle">${esc(p.email)}</h2>
    <div class="head-meta">${tag} ${countPills(a)}</div></div>${closeBtn}`;
  $('drawerTabs').innerHTML = '';
  const body = $('drawerBody'), foot = $('drawerFoot');

  if (p.role) {
    const r = p.role === 'owner' ? null : roleByKey(p.role);
    body.innerHTML = `<div class="callout info">${IC.info}<div>${p.role === 'owner' ? 'The owner always has everything.' : `This person gets exactly what <b>${esc(r.name)}</b> has. To change it for everyone in the role, edit the role; to give only this person something different, move them to Special cases.`}</div></div><div style="height:12px"></div>`
      + accessBlocks(a) + (r ? roleNotes(r) : '');
    foot.innerHTML = p.role === 'owner' ? '' : `<select class="sm" id="acx-pMove" aria-label="Change role">${roleOptions(p.role, true)}</select><button class="btn sm" type="button" data-move>Change</button>
      <span class="left"></span><button class="btn sm ghost" type="button" data-role>Open role</button><button class="btn sm danger" type="button" data-remove>Remove</button>`;
    if (p.role !== 'owner') {
      foot.querySelector('[data-role]').onclick = () => openDrawer({ kind: 'role', key: p.role });
      foot.querySelector('[data-move]').onclick = () => {
        const to = $('pMove').value;
        if (to === p.role) { toast('Already in ' + r.name); return; }
        const from = p.role;
        acxDo(to === '__special' ? `Keep ${p.email} apart in Special cases? Their boxes stay as they are.` : `Give ${p.email} exactly what ${roleByKey(to).name} has? Their access changes now.`,
          () => (to === '__special' ? acxWrite(p.email, S.roles[from], '__special') : acxWrite(p.email, S.roles[to], to)), p.email + ' moved to ' + acxRoleName(to));
      };
      wireRemove(foot.querySelector('[data-remove]'), p);
    }
    return;
  }

  const near = isEmptyAccess(p.special) ? null : closestRole(p.special);
  if (D.editing) {
    body.innerHTML = accessBlocks(p.special, { editing: true, base: p.special });
    foot.innerHTML = `<span class="left">Only this person gets these boxes</span><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-save>Save</button>`;
    body.onchange = () => body.querySelectorAll('label.page').forEach(l => {
      const i = l.querySelector('input'); l.classList.toggle('changed', p.special[i.dataset.kind].includes(i.value) !== i.checked);
    });
    foot.querySelector('[data-cancel]').onclick = () => { D.editing = false; renderDrawer(); };
    foot.querySelector('[data-save]').onclick = () => {
      const nb = readBoxes(), match = ROLES.find(r => !r.admin && sameAccess(nb, S.roles[r.key]));
      acxDo(`Save ${p.email}'s own boxes? Their access changes now.`, () => acxWrite(p.email, nb, '__special'),
        match ? 'Saved — these boxes are exactly ' + match.name + '. Move them into that role below.' : 'Saved').then(done => { if (done && D) { D.editing = false; renderDrawer(); } });
    };
    return;
  }
  const chip = (cls, [k, key], sign) => `<span class="pill ${cls}">${sign} ${esc(LABEL[k][key])}</span>`;
  body.innerHTML = accessBlocks(p.special)
    + (near ? `<div class="compare"><h3>Compared with ${esc(near.role.name)}</h3>
        ${near.diff.plus.length ? '<p class="muted" style="margin:4px 0 6px">Has, but the role does not</p><div class="diff-row">' + near.diff.plus.map(x => chip('plus', x, '+')).join('') + '</div>' : ''}
        ${near.diff.minus.length ? '<p class="muted" style="margin:10px 0 6px">The role has, but this person does not</p><div class="diff-row">' + near.diff.minus.map(x => chip('minus', x, '−')).join('') + '</div>' : ''}
      </div>` : '')
    + `<div class="move-box"><select id="acx-pMove" aria-label="Move to a role"><option value="">Move to a role…</option>${roleOptions('', false)}</select><button class="btn" type="button" data-move>Move</button></div>`;
  if (near) $('pMove').value = near.role.key;
  foot.innerHTML = `<button class="btn sm danger" type="button" data-remove>Remove</button><span class="left"></span><button class="btn primary" type="button" data-edit>${IC.edit} Edit boxes</button>`;
  body.querySelector('[data-move]').onclick = () => {
    const to = $('pMove').value;
    if (!to) { toast('Pick a role first'); return; }
    acxDo(`Give ${p.email} exactly what ${roleByKey(to).name} has? Their access changes now.`, () => acxWrite(p.email, S.roles[to], to), p.email + ' moved to ' + roleByKey(to).name);
  };
  foot.querySelector('[data-edit]').onclick = () => { D.editing = true; renderDrawer(); };
  wireRemove(foot.querySelector('[data-remove]'), p);
}
function wireRemove(btn, p) {
  btn.textContent = 'Remove ' + (SIDE === 'erp' ? 'ERP' : 'Sellora') + ' access';
  btn.title = 'Takes away what this person has in ' + SIDE_NAME + ' only' + (SIDE === 'erp' ? '' : ' — their ERP access stays');
  btn.onclick = () => {
    if (btn.dataset.sure) { acxDo('', () => acxRemoveSide(p.email), p.email + ' — ' + SIDE_NAME + ' access removed').then(() => closeDrawer()); return; }
    btn.dataset.sure = '1'; btn.textContent = 'Sure? Remove';
  };
  /* deleting the login's whole access record (both apps) is the ERP side's */
  if (SIDE !== 'erp' || !btn.parentNode) return;
  const del = document.createElement('button');
  del.type = 'button'; del.className = 'btn sm danger'; del.setAttribute('data-remove', ''); del.textContent = 'Delete login'; del.title = 'Removes everything this person has, in the ERP and in Sellora';
  btn.insertAdjacentElement('afterend', del);
  del.onclick = () => {
    if (del.dataset.sure) { acxDo('', () => acxDel(p.email), p.email + ' deleted — no access in either app').then(() => closeDrawer()); return; }
    del.dataset.sure = '1'; del.textContent = 'Sure? Delete in both apps';
  };
}
function whyNotEmail(email) {
  if (!email) return 'Type an email address first.';
  if (!EMAIL_RE.test(email)) return 'That does not look like an email address.';
  const there = personBy(email);
  if (there) return email + ' is already here, in ' + placeOf(there).role + '. Change their role from there.';
  return '';
}

/* ---------- + Add user: email → department → role ---------- */
const modal = $('modal');
$('modalClose').onclick = () => modal.close();
modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });
function openModal(title, sub, body, foot) {
  $('modalTitle').textContent = title; $('modalSub').innerHTML = sub || '';
  $('modalBody').innerHTML = body; $('modalFoot').innerHTML = foot || '';
  if (!modal.open) modal.showModal();
}
function stepper(n) {
  return '<div class="stepper">' + ['Email', 'Department', 'Role'].map((s, i) =>
    (i ? '<span class="st-line"></span>' : '') + `<span class="st ${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}"><span class="dot">${i + 1 < n ? '✓' : i + 1}</span>${s}</span>`).join('') + '</div>';
}
function openAdd(w = { step: 1, email: '', dept: '', role: '' }) {
  if (w.step === 1) {
    openModal('Add a user', 'The role you pick already carries the access — nothing to tick.',
      stepper(1) + `<div class="field"><label for="acx-addEmail">Sign-in email</label><input type="email" id="acx-addEmail" placeholder="name@thefabricrush.com" value="${esc(w.email)}" autocomplete="off">
        <p class="muted">The address they use to sign in to Sellora and Fabricrush. This gives them ${SIDE_NAME} screens; anything they have in the other app stays.</p><div class="err" id="acx-addErr"></div></div>`,
      `<button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-next>Next ${IC.chev}</button>`);
    const next = () => {
      const email = $('addEmail').value.trim().toLowerCase();
      const err = whyNotEmail(email);
      if (err) { $('addErr').textContent = err; return; }
      openAdd({ ...w, email, step: w.dept ? 3 : 2 });
    };
    $('modalFoot').querySelector('[data-cancel]').onclick = () => modal.close();
    $('modalFoot').querySelector('[data-next]').onclick = next;
    $('addEmail').addEventListener('keydown', e => { if (e.key === 'Enter') next(); });
    $('addEmail').addEventListener('input', () => { $('addErr').textContent = ''; });
    setTimeout(() => $('addEmail').focus(), 30);
    return;
  }
  if (w.step === 2) {
    openModal('Add a user', esc(w.email),
      stepper(2) + '<div class="choice-grid">' + DEPARTMENTS.filter(d => ROLES.some(r => r.dept === d.key && pickable(r))).map(d => {
        const n = ROLES.filter(r => r.dept === d.key && pickable(r)).length;
        return `<button class="choice" type="button" data-dept="${d.key}"><span class="ic">${IC[d.key]}</span><span><span class="t">${esc(d.name)}</span><span class="s">${deptGroups(d).map(esc).join(', ')}</span><span class="s">${plural(n, 'role')}</span></span></button>`;
      }).join('') + `<button class="choice special-choice" type="button" data-dept="__special"><span class="ic">${IC.star}</span><span><span class="t">Special case</span><span class="s">Fits no role. Kept apart; you tick their boxes one by one.</span></span></button></div>`,
      `<button class="btn ghost" type="button" data-back>Back</button>`);
    $('modalBody').querySelectorAll('[data-dept]').forEach(b => { b.onclick = () => openAdd({ ...w, dept: b.dataset.dept, role: w.dept === b.dataset.dept ? w.role : '', step: 3 }); });
    $('modalFoot').querySelector('[data-back]').onclick = () => openAdd({ ...w, step: 1 });
    return;
  }
  if (w.dept === '__special') {
    openModal('Add a user', esc(w.email) + ' · Special case', stepper(3)
      + `<div class="callout special">${IC.star}<div>Tick only what this one person needs. They stay in Special cases, apart from the roles.</div></div>`
      + '<div id="acx-addBoxes">' + accessBlocks({ sellora: [], erp: [], rights: [] }, { editing: true }) + '</div><div class="err" id="acx-addErr"></div>',
      `<button class="btn ghost" type="button" data-back>Back</button><button class="btn primary" type="button" data-save>Add special case</button>`);
    $('modalFoot').querySelector('[data-back]').onclick = () => openAdd({ ...w, step: 2 });
    $('modalFoot').querySelector('[data-save]').onclick = () => {
      const a = { admin: false, sellora: [], erp: [], rights: [] };
      $('addBoxes').querySelectorAll('input[data-kind]:checked').forEach(c => a[c.dataset.kind].push(c.value));
      if (isEmptyAccess(a)) { $('addErr').textContent = 'Tick at least one page or right.'; return; }
      modal.close();
      acxDo('', () => acxWrite(w.email, a, '__special'), w.email + ' added to Special cases');
    };
    return;
  }
  const d = DEPARTMENTS.find(x => x.key === w.dept);
  const picked = w.role ? roleByKey(w.role) : null;
  openModal('Add a user', esc(w.email) + ' · ' + esc(d.name), stepper(3)
    + `<div class="pick-layout"><div class="role-list">` + deptGroups(d).map(gn => `<div class="g">${esc(gn)}</div>` + ROLES.filter(r => r.dept === d.key && r.group === gn && pickable(r)).map(r =>
      `<button class="role-opt ${w.role === r.key ? 'on' : ''}" type="button" data-pick="${r.key}"><span class="t">${esc(r.name)}</span><span class="s">${esc(summaryText(S.roles[r.key]))} · ${plural(membersOf(r.key).length, 'member')}</span></button>`).join('')).join('')
    + `</div><div class="role-preview">` + (picked
      ? `<h2>${esc(picked.name)}</h2><p class="muted">${esc(picked.group)} · ${esc(w.email)} will get exactly this</p>${accessBlocks(S.roles[picked.key])}${roleNotes(picked)}`
      : `<div class="ph"><div>${IC.chev}<div>Pick a role on the left to see the access it carries.</div></div></div>`) + '</div></div>',
    `<button class="btn ghost" type="button" data-back>Back</button><button class="btn primary" type="button" data-save ${picked ? '' : 'disabled'}>Add as ${picked ? esc(picked.name) : '…'}</button>`);
  $('modalBody').querySelectorAll('[data-pick]').forEach(b => { b.onclick = () => openAdd({ ...w, role: b.dataset.pick }); });
  $('modalFoot').querySelector('[data-back]').onclick = () => openAdd({ ...w, step: 2 });
  $('modalFoot').querySelector('[data-save]').onclick = () => {
    modal.close();
    acxDo('', () => acxWrite(w.email, S.roles[w.role], w.role), w.email + ' added as ' + picked.name);
  };
}

/* ---------- wiring ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-nav],[data-open-role],[data-open-members],[data-open-person],[data-close-drawer],[data-add-in],[data-add-role]');
  if (!t || modal.contains(t) || !$('root').contains(t)) return;
  if (t.dataset.closeDrawer != null) { closeDrawer(); return; }
  if (t.dataset.addRole != null) { openAddRole(t.dataset.addRole); return; }
  if (t.dataset.openMembers) { e.stopPropagation(); openDrawer({ kind: 'role', key: t.dataset.openMembers, tab: 'members' }); return; }
  if (t.dataset.openRole) { openDrawer({ kind: 'role', key: t.dataset.openRole }); return; }
  if (t.dataset.openPerson) { openDrawer({ kind: 'person', email: t.dataset.openPerson }); return; }
  if (t.dataset.addIn) { openAdd({ step: 1, email: '', dept: t.dataset.addIn, role: '' }); return; }
  if (t.dataset.nav) { VIEW = { page: t.dataset.nav, dept: t.dataset.dept || null }; if (D) closeDrawer(); else render(); window.scrollTo(0, 0); }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const t = e.target.closest && e.target.closest('tr[data-open-role],tr[data-open-person]');
  if (t) t.click();
});
$('addBtn').onclick = () => openAdd();
$('search').addEventListener('input', () => {
  if ($('search').value.trim() && VIEW.page !== 'people' && VIEW.page !== 'special' && VIEW.page !== 'dept') VIEW = { page: 'people', dept: null };
  renderNav(); renderMain();
});




  return async rows => {
    try { const snap = await getDoc(doc(db, 'config', 'accessRoles')); ACX_ROLES_DOC = snap.exists() ? snap.data() : null; }
    catch (e) { ACX_ROLES_DOC = null; toast('The saved roles could not be read (' + (e.code || e.message || e) + ') — showing the role plan.'); }
    /* an access viewer sees the page without one button that changes anything (styles .acx.ro) */
    $('root').classList.toggle('ro', !acxCanEdit());
    ACX_DEPTS.length = 0; acxDepts().forEach(d => ACX_DEPTS.push(d));
    DEPARTMENTS.forEach(d => d.groups.forEach(g => g.roles.forEach(r => { if (r.accessRec) { r.access = personAccess(r.accessRec); delete r.accessRec; } })));
    DATA.people = rows.map(r => Object.assign({}, r, { email: String(r.email || '').toLowerCase() }));
    DATA.readAt = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    DATA_STAMP = 'live|' + DATA.people.map(p => p.email).join(',');
    S = load(); render();
  };
}
