/* ================= GREIGE DESK INSIDE THE REPLENISH APP (real working since 15 Oct) =================
 * Ravi, 13 Oct: "is wale part ko bhi jaise humne PPC test flow me run kiya hua h aise hi run kardo" -- the Greige Desk
 * joined to the PPC flow. Everything it writes goes to its own node, pt_gdTest (named in its test days; since 15 Oct, Ravi:
 * "griege ka bhi test window hatao", it holds the real greige POs and movements, RIDHI/PO/GREIG/001 on); the older Greige POs and the
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
  if (Object.keys(patch).length) Promise.resolve(ptPatch(patch)).catch(function (e) { lmSay('err', 'Not saved: ' + (e && e.message || e)); });
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
    poPrefix: 'RIDHI/PO/GREIG/', poNext: 1, rfdPrefix: 'RIDHI/RFD/' } };
}
function gdSaveAll() {
  var store = { gpo: {}, fab: {}, mst: DB.mst || [], ven: DB.ven || [], co: DB.co || {} };
  (DB.gpo || []).forEach(function (x) { store.gpo[x.id] = x; });
  (DB.fab || []).forEach(function (x) { store.fab[x.id] = x; });
  GD_SNAP = gdSnap();
  return Promise.resolve(ptPut(GD_NODE, JSON.parse(JSON.stringify(store)))).catch(function (e) { lmSay('err', 'Not saved: ' + (e && e.message || e)); });
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
/* The model's sample (no button for it in the app since 15 Oct), the company's own name on it. */
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
  /* NO MASTER DATA TAB IN THE APP (Ravi, 15 Oct: "remove the master data from here, it will come from setup"): the fabrics and
   * the suppliers / RFD processors are Setup -> Master Database's own (gdLinkMasters). */
  [].forEach.call(document.querySelectorAll('.navgrp[data-tab="mst"]'), function (b) { b.hidden = gdLinked(); });
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
var GD_FLOW_ASKED = false;
/* PPC DEMAND ON THE INVENTORY (Ravi, 15 Oct: "Greige for PPC — jo demand aayega ppc se wo greige order se pahle dikhe
 * jisase hum 1 jagah se hi perform kar sake"). The Greige for PPC figures, fabric by fabric, for the Inventory's first
 * column: what PPC needs, what is short after the free RFD, and the greige to order (with what is on its way taken off).
 * null when the flow is not here; { __loading: true } while the plans are being read. */
function gdPpcMap() {
  if (typeof flowRfdCover !== 'function') return null;
  if (!gdFlowReady()) {
    if (typeof flowEnsureData === 'function' && !GD_FLOW_ASKED) { GD_FLOW_ASKED = true; flowEnsureData().then(function () { if (UI.tab === 'inv') render(); }, function () { /* the column says so */ }); }
    return { __loading: true };
  }
  var cov = flowRfdCover(), out = {};
  Object.keys(cov.fab).forEach(function (k) {
    var f = cov.fab[k]; if (!(f.need > 0.05)) return;
    var pipe = gdPipeline(f.name), toOrder = Math.max(0, f.short - (pipe.order + pipe.greige + pipe.proc));
    out[String(f.name).toUpperCase()] = { name: f.name, need: f.need, lines: f.lines, free: Math.max(0, f.free), short: f.short,
      desk: gdRfdShelf(f.name), onWay: pipe.order + pipe.greige + pipe.proc, greigeM: toOrder > 0.05 ? Math.ceil(toOrder / (1 - GD_LOSS)) : 0, greige: fabGreigeOf(f.name) };
  });
  return out;
}
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

/* ---- THE MASTER DATA IS ONE (Ravi, 15 Oct: "greige ka and masterdata ka interlink hona chahiye") ----
 * In the app the desk's fabrics and its suppliers / RFD processors are Setup -> Master Database's own: Greige & RFD
 * fabric (pt_masters/greigeRfd) and the greige and RFD vendors of Vendors (pt_masters/vendorBook). They are read fresh on
 * every open, shown read-only on the desk's Master data, and changed in the Master Data. What the desk alone knows about a
 * fabric (warp / weft typed here before) is kept where the Master Data says nothing. A supplier the test records name but
 * the Master Data does not have is kept too, marked, so an old test PO still finds it. */
function gdLinked() {
  var m = (typeof PTG !== 'undefined' && PTG && PTG.masters) || {};
  return !!(m.greigeRfd && Object.keys(m.greigeRfd).some(function (k) { return k.charAt(0) !== '_'; }));
}
function gdYarns(count) {
  var y = function (s) { s = String(s || '').trim().replace(/'s$/i, 's'); return /^\d/.test(s) ? (/s$/i.test(s) ? s : s + 's') : ''; };
  var p = String(count || '').split(/\s*x\s*/i);
  return p.length === 2 ? [y(p[0]), y(p[1])] : [y(count), y(count)];
}
function gdLinkMasters() {
  if (!DB || !gdLinked() || typeof fmList !== 'function') return;
  var key = function (s) { return String(s || '').trim().toLowerCase(); };
  var old = {}; (DB.mst || []).forEach(function (m) { old[key(m.greige)] = m; });
  DB.mst = fmList('greigeRfd').filter(function (r) { return String(r.greige || '').trim(); }).map(function (r) {
    var o = old[key(r.greige)] || {}, yarn = gdYarns(r.count), pc = String(r.constr || '').match(/^\s*(\d+)\s*x\s*(\d+)\s*$/i);
    var num = function (v, was) { return v === '' || v == null ? (was || '') : v; };
    /* The RFD is called by the app's own fabric name (Sheeting 62, Cambric): that is the name PPC, the flow's Demand and this
     * desk's ledger rows all match on. The Master Data's full name rides along as the title. */
    var app = (Array.isArray(r.fabrics) ? r.fabrics : ptList(r.fabrics))[0];
    return { rfd: String(app || r.rfd || '').trim(), title: String(r.rfd || '').trim(), greige: String(r.greige).trim(), warp: o.warp || yarn[0], weft: o.weft || yarn[1],
      epi: pc ? +pc[1] : (o.epi || ''), ppi: pc ? +pc[2] : (o.ppi || ''), greigeWidth: num(r.gw, o.greigeWidth), rfdWidth: num(r.rw, o.rfdWidth),
      active: true, md: r.id };
  });
  var was = DB.ven || [], names = {};
  var ven = fmList('vendorBook').filter(function (v) { return v.type === 'greige' || v.type === 'rfd'; }).map(function (v) {
    names[key(v.name)] = 1;
    var o = was.filter(function (x) { return key(x.name) === key(v.name); })[0] || {};
    return { name: String(v.name || '').trim(), kind: v.type === 'greige' ? 'Supplier' : 'RFD Processor', phone: v.phone || o.phone || '',
      email: o.email || '', addr: v.address || o.addr || '', city: v.city || o.city || '', gstin: v.gstin || o.gstin || '', pan: v.pan || '', active: true, md: v.id };
  });
  was.forEach(function (v) { if (v && v.name && !names[key(v.name)] && venUsed(v.name) > 0) ven.push(Object.assign({}, v, { deskOnly: true })); });
  DB.ven = ven;
  /* The company on the PO: the app's own Greige PO settings (no Company page on the desk in the app). The numbering stays the desk's. */
  var s = (typeof GPO !== 'undefined' && GPO && GPO.settings) || null;
  if (s) DB.co = Object.assign({}, DB.co || {}, { name: s.company || (DB.co || {}).name || gdCoName(), addr: s.address || (DB.co || {}).addr || '',
    gstin: s.gstin || (DB.co || {}).gstin || '', email: s.email || (DB.co || {}).email || '', pan: s.pan || (DB.co || {}).pan || '' });
}
/** Over to Setup -> Master Database, at its Greige & RFD fabric or its Vendors. */
function gdOpenMasterData(view) {
  if (typeof showTab !== 'function') return;
  showTab('pmdb');
  try { if (typeof fmSetView === 'function') fmSetView(view === 'vendors' ? 'vendors' : 'fabric'); } catch (e) { /* the page opens where it was */ }
}
