/* ================= GREIGE DESK INSIDE THE REPLENISH APP (TEST, preview link only) =================
 * Ravi, 13 Oct: "is wale part ko bhi jaise humne PPC test flow me run kiya hua h aise hi run kardo" -- the Greige Desk
 * joined to the PPC flow. Everything it writes goes to its own test node (pt_gdTest); the real Greige POs and the real
 * fabric ledger are never touched. Its masters start as a copy of the app's own (fabric pairs, suppliers, RFD
 * processors, company); the rights come from the person signed in. */
var GD_NODE = 'pt_gdTest', GD_SNAP = null, GD_READY = null;
function gdKeyed(list) { var o = {}; (list || []).forEach(function (x) { if (x && x.id) o[x.id] = JSON.stringify(x); }); return o; }
function gdSnap() {
  return { gpo: gdKeyed(DB.gpo), fab: gdKeyed(DB.fab), mst: JSON.stringify(DB.mst || []), ven: JSON.stringify(DB.ven || []), co: JSON.stringify(DB.co || {}) };
}
/* WHAT CHANGED IS WHAT IS WRITTEN: one PO or one ledger row at a time, so two people working at once do not
 * overwrite each other's rows. */
function lmSaveDb() {
  if (!DB) return;
  var now = gdSnap(), was = GD_SNAP || { gpo: {}, fab: {}, mst: '', ven: '', co: '' }, patch = {};
  ['gpo', 'fab'].forEach(function (k) {
    Object.keys(now[k]).forEach(function (id) { if (was[k][id] !== now[k][id]) patch[GD_NODE + '/' + k + '/' + id] = JSON.parse(now[k][id]); });
    Object.keys(was[k]).forEach(function (id) { if (!(id in now[k])) patch[GD_NODE + '/' + k + '/' + id] = null; });
  });
  ['mst', 'ven', 'co'].forEach(function (k) { if (was[k] !== now[k]) patch[GD_NODE + '/' + k] = JSON.parse(now[k]); });
  GD_SNAP = now;
  if (Object.keys(patch).length) Promise.resolve(ptPatch(patch)).catch(function (e) { lmSay('err', 'Not saved to the test records: ' + (e && e.message || e)); });
}
function gdFromStore(v) {
  var list = function (o) { return Object.keys(o || {}).map(function (k) { var x = o[k]; if (x && !x.id) x.id = k; return x; }).filter(Boolean); };
  var arr = function (a) { return Array.isArray(a) ? a.filter(Boolean) : list(a); };
  return { gpo: list(v.gpo), fab: list(v.fab), mst: arr(v.mst), ven: arr(v.ven), co: v.co || {}, users: [], me: '' };
}
function gdCoName() {
  try { var s = (typeof GPO !== 'undefined' && GPO.settings) || {}; return s.company || s.name || (typeof FLOW_COMPANY !== 'undefined' ? FLOW_COMPANY : 'Ridhi Home & Living'); }
  catch (e) { return 'Ridhi Home & Living'; }
}
/* THE MASTERS, COPIED FROM THE APP: fabric types with a greige name, the suppliers on real greige POs and in the vendor
 * master, the RFD processors the real ledger has sent cloth to. Typed over here, they change only the test copy. */
function gdSeedMasters() {
  var mst = [], ven = [], seen = {};
  try {
    mstRows('fabricType').forEach(function (r) {
      var rfd = String(r.desc || r.code || '').trim(), greige = String(r.greige || '').trim();
      if (!rfd || !greige) return;
      mst.push({ rfd: rfd, greige: greige, warp: r.warp || '', weft: r.weft || '', epi: r.epi || '', ppi: r.ppi || '',
        greigeWidth: r.greigeWidth || '', rfdWidth: r.rfdWidth || '', active: r.active !== false });
    });
  } catch (e) { /* no fabric master read yet */ }
  var addVen = function (name, kind, extra) {
    var n = String(name || '').trim(), k = n.toLowerCase(); if (!n || seen[k]) return; seen[k] = 1;
    ven.push(Object.assign({ name: n, kind: kind, phone: '', email: '', addr: '', city: '', gstin: '', active: true }, extra || {}));
  };
  try { ((typeof GPO !== 'undefined' && GPO.rows) || []).forEach(function (p) { addVen(p.mill, 'Supplier'); }); } catch (e) { /* none */ }
  try {
    ptList((PTG.masters || {}).vendor).forEach(function (v) {
      var cat = String(v.category || '');
      var kind = /mill|supplier|weav|greige/i.test(cat) ? 'Supplier' : /process|rfd|bleach|dye/i.test(cat) ? 'RFD Processor' : '';
      if (kind) addVen(v.desc || v.name || v.code, kind, { phone: v.phone || '', email: v.email || '', city: v.city || '', gstin: v.gstin || '' });
    });
  } catch (e) { /* none */ }
  try { ((typeof FAB !== 'undefined' && FAB.rows) || []).forEach(function (r) { if (r.txnType === 'ISSUE_TO_RFD') addVen(r.party, 'RFD Processor'); }); } catch (e) { /* none */ }
  return { mst: mst, ven: ven, co: { name: gdCoName(), addr: '', email: '', gstin: '', iec: '', pan: '', jurisdiction: 'Jaipur',
    poPrefix: 'TEST/PO/GREIG/', poNext: 1, rfdPrefix: 'TEST/RFD/' } };
}
function gdSaveAll() {
  var store = { gpo: {}, fab: {}, mst: DB.mst || [], ven: DB.ven || [], co: DB.co || {} };
  (DB.gpo || []).forEach(function (x) { store.gpo[x.id] = x; });
  (DB.fab || []).forEach(function (x) { store.fab[x.id] = x; });
  GD_SNAP = gdSnap();
  return Promise.resolve(ptPut(GD_NODE, JSON.parse(JSON.stringify(store)))).catch(function (e) { lmSay('err', 'Not saved to the test records: ' + (e && e.message || e)); });
}
function gdLoad() {
  if (GD_READY) return GD_READY;
  GD_READY = (async function () {
    try { if (typeof ptLoadGates === 'function' && !PTG.masters) await ptLoadGates(); } catch (e) { /* masters wait */ }
    try { if (typeof ensureGpo === 'function' && typeof GPO !== 'undefined' && GPO.rows == null) await ensureGpo(); } catch (e) { /* real POs wait */ }
    var v = null;
    try { v = await ptGet(GD_NODE); } catch (e) { v = null; }
    if (v && (v.mst || v.gpo || v.fab)) { DB = gdFromStore(v); lmMigrate(); GD_SNAP = gdSnap(); }
    else { var m = gdSeedMasters(); DB = { gpo: [], fab: [], mst: m.mst, ven: m.ven, co: m.co, users: [], me: '' }; lmMigrate(); await gdSaveAll(); }
  })();
  return GD_READY;
}
function lmLoad() { if (!DB) DB = { gpo: [], fab: [], mst: [], ven: [], co: {}, users: [], me: '' }; lmMigrate(); }
/* "Load sample data" -- the model's sample, under TEST numbers, the company's own name on it. */
function lmResetSample() { var s = lmSample(); s.co.name = gdCoName(); s.users = []; s.me = ''; DB = s; lmMigrate(); gdSaveAll(); }
function gdClearAll() { DB.gpo = []; DB.fab = []; gdSaveAll(); }

/* ---- WHO IS WORKING: the person signed in to the app, and the rights they hold ---- *
 * gdesk opens the desk; gdled shows the fabric ledger; gdledit lets them add and correct it; gdappr approves an RFD
 * receipt that shrank more than 5%. An admin holds all four. */
var GD_RIGHTS = [['gdesk', 'Open the Greige Desk'], ['gdled', 'See the fabric ledger'], ['gdledit', 'Add to and correct the fabric ledger'], ['gdappr', 'Approve an RFD receipt that shrank more than 5%']];
function gdHas(k) {
  var me = (typeof ME !== 'undefined' && ME) || {}, tabs = me.tabs || [];
  return !!me.admin || !tabs.length || tabs.indexOf(k) >= 0;
}
function meUser() {
  var me = (typeof ME !== 'undefined' && ME) || {};
  return { id: me.email || '', name: me.name || me.email || 'You', role: me.admin ? 'Admin' : 'User',
    ledger: gdHas('gdledit') ? 'edit' : (gdHas('gdled') ? 'view' : 'none'), approve: gdHas('gdappr'), active: true };
}
function meFill() {
  var n = $('meName'); if (n) n.textContent = meUser().name + ' · ledger: ' + LEDGER_LABEL[meUser().ledger].toLowerCase() + (meUser().approve ? ' · approves' : '');
  [].forEach.call(document.querySelectorAll('.navgrp[data-tab="ledger"]'), function (b) { b.hidden = !canLedger(); });
  var adm = !!((typeof ME !== 'undefined' && ME) || {}).admin;
  ['gdSample', 'gdClear'].forEach(function (id) { var b = $(id); if (b) b.hidden = !adm; });
}
function renderMstUsers() {
  var u = meUser();
  return '<div class="card"><div class="ff-cap">On the Greige Desk, rights come from each person’s own login. They are given in Sellora → Access, '
    + 'like every other screen. An admin holds all four.</div><div class="ff-grid"><table class="xl xl-dense"><thead><tr><th class="frz">Right</th><th>What it allows</th><th>' + esc(u.name) + '</th></tr></thead><tbody>'
    + GD_RIGHTS.map(function (r) { return '<tr><td class="frz mono" style="text-align:left">' + r[0] + '</td><td style="text-align:left">' + esc(r[1]) + '</td><td>' + (gdHas(r[0]) ? '<span class="pill pill-ok">yes</span>' : '<span class="pill pill-mute">no</span>') + '</td></tr>'; }).join('')
    + '</tbody></table></div></div>';
}
function usersSafe() { return true; }

/* ---- GREIGE FOR PPC: what the plans need, and the greige to buy for it ---- *
 * PPC's plans need RFD for printing (the flow's Demand → RFD). Against that: the RFD in the real register and on this
 * desk's shelf, less what earlier lines hold, and on this desk what is already on its way -- greige on order, greige in
 * the store, cloth at an RFD processor. What is still short is the greige to order, with 5% added for what the
 * processor takes. */
var GD_LOSS = 0.05;
function gdFlowReady() { return typeof FLOW !== 'undefined' && FLOW && FLOW.ppc && typeof flowRfdCover === 'function'; }
function gdRfdShelf(name) {
  if (!DB) return 0;
  var k = String(name || '').trim().toUpperCase(), e = fabFlowRows(DB.fab || []).filter(function (x) { return String(x.fabricType).toUpperCase() === k; })[0];
  return e ? Math.max(0, e.rfdLeft) : 0;
}
function gdPipeline(name) {
  var k = String(name || '').trim().toUpperCase(), e = fabFlowRows(DB.fab || []).filter(function (x) { return String(x.fabricType).toUpperCase() === k; })[0] || {};
  var ord = (invOnOrder()[k] || {}).m || 0;
  return { order: ord, greige: Math.max(0, e.greigeLeft || 0), proc: Math.max(0, e.withProcessor || 0) };
}
function renderPpcLink() {
  if (typeof flowRfdCover !== 'function') return '<div class="card muted">The production flow is not on this link.</div>';
  if (!gdFlowReady()) {
    if (typeof flowEnsureData === 'function' && !GD_FLOW_ASKED) { GD_FLOW_ASKED = true; flowEnsureData().then(function () { if (UI.tab === 'ppc') render(); }, function () { /* told below */ }); }
    return '<div class="card muted">Reading the PPC plans…</div>';
  }
  var cov = flowRfdCover(), rows = Object.keys(cov.fab).map(function (k) { return cov.fab[k]; }).filter(function (f) { return f.need > 0.05; })
    .sort(function (a, b) { return b.short - a.short || a.name.localeCompare(b.name); });
  var body = rows.map(function (f) {
    var gname = fabGreigeOf(f.name), pipe = gdPipeline(f.name), inPipe = pipe.order + pipe.greige + pipe.proc;
    var toOrder = Math.max(0, f.short - inPipe), greigeM = toOrder > 0.05 ? Math.ceil(toOrder / (1 - GD_LOSS)) : 0;
    var desk = gdRfdShelf(f.name);
    return '<tr><td class="frz" style="text-align:left"><b>' + esc(f.name) + '</b><div class="muted" style="font-size:10.5px">' + (gname ? 'bought as ' + esc(gname) : '<span class="err-in">no greige name in Master data</span>') + '</div></td>'
      + '<td class="num">' + nf(f.need) + '<div class="muted" style="font-size:10.5px">' + plural(f.lines, 'line') + '</div></td>'
      + '<td class="num">' + nf(Math.max(0, f.free)) + (desk > 0.05 ? '<div class="muted" style="font-size:10.5px">' + nf(desk) + ' m from this desk</div>' : '') + '</td>'
      + '<td class="num" style="' + (f.short > 0.05 ? 'color:var(--bad);font-weight:700' : '') + '">' + dash(f.short) + '</td>'
      + '<td class="num">' + dash(pipe.order) + '</td><td class="num">' + dash(pipe.greige) + '</td><td class="num" style="color:var(--proc-ink)">' + dash(pipe.proc) + '</td>'
      + '<td class="num" style="font-weight:800">' + (greigeM ? nf(greigeM) + ' m' : '<span class="pill pill-ok">covered</span>') + '</td>'
      + '<td>' + (greigeM && gname ? '<button type="button" class="jw-btn jw-primary" data-ppcpo="' + esc(f.name) + '|' + greigeM + '">Raise greige PO</button>' : '') + '</td></tr>';
  }).join('');
  return '<div class="card"><div class="ff-cap">What the PPC plans need in RFD for printing (the production flow’s Demand → RFD), against the RFD free today '
    + '(the real register and this desk), and what this desk already has on its way. What is still short is the greige to order, with '
    + Math.round(GD_LOSS * 100) + '% added for what the RFD processor takes.</div>'
    + '<div class="row" style="margin-bottom:10px"><button type="button" class="ghost" data-gdflow="drfd">Open the flow’s Demand → RFD</button></div>'
    + '<div class="ff-grid"><table class="xl">'
    + th(['RFD fabric', 'PPC needs', 'RFD free', 'Short', 'Greige on order', 'Greige in store', 'At RFD processor', 'Greige to order', ''], [1, 2, 3, 4, 5, 6, 7])
    + '<tbody>' + (body || emptyRow(9, 'No PPC plan is waiting for RFD right now.')) + '</tbody></table></div></div>';
}
var GD_FLOW_ASKED = false;
/** A greige PO, its line already written from what PPC needs. */
function gdPoFor(rfd, metres) {
  poOpen();
  var greige = fabGreigeOf(rfd);
  PO_DRAFT.lines = [{ rfd: rfd, greige: greige, desc: 'RFD ready: ' + rfd, descAuto: true, due: PO_DRAFT.date, metres: String(metres), rate: '', _rec: 0 }];
  poDraw();
  lmSay('ok', nf(metres) + ' m of ' + greige + ' for PPC is on the PO. Pick the supplier and the rate.');
}
/** Over to the production flow, at one of its Demand tabs. */
function gdToFlow(view) {
  if (typeof showTab !== 'function') return;
  showTab('flow');
  try { FLOW_VIEW = view || 'drfd'; } catch (e) { /* the flow picks its own */ }
  if (typeof ensureFlow === 'function') ensureFlow();
}
