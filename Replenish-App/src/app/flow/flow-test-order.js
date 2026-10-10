/* ================= PRODUCTION FLOW · TEST ORDER — walk one order end to end without touching the registers =================
 * Ravi, 10 Oct: "mujhe test sales order add krna h to know how to flow this end to end". A real sales order would go
 * into the order book, the vendor demand and every register, and walking it would mean real cutting, Job Work and QC
 * entries (which pay people and move stock). So a TEST order lives only in the flow:
 *   pt_flowTest/<orderNo> = { orderNo, src, orderDate, lines: { SKU: { qty, given, back, cut, issued, received, qc, fgIn } }, at, by }
 * PPC, Demand (fabric ready, reserve, challan) are the real screens and write their real nodes under the TEST order's
 * key. Every step after that is a "Simulate" button standing in for the entry the factory would make on its own
 * screen. "Delete test" removes the order and everything written for it. */

const flowIsTest = no => /^TEST-/.test(String(no || ''));
/* ONLY TEST ORDERS (Ravi, 10 Oct: "abhi mujhe yahan sirf test order related hi entry show ho, jisase me order end to end
 * track kar saku"). On, every bucket, count and challan list holds the TEST orders alone. Remembered on this computer;
 * on by itself the first time there is a test order to follow. */
function flowTestOnly() {
  let v = null; try { v = localStorage.getItem('flowTestOnly'); } catch (e) { v = null; }
  if (v === '1') return true; if (v === '0') return false;
  return Object.keys(FLOW.test || {}).length > 0;
}
function flowTestOnlySet(on) { try { localStorage.setItem('flowTestOnly', on ? '1' : '0'); } catch (e) { /* storage blocked: this visit only */ } FLOW.testOnly = on; }
let FLOW_TC = { src: null, rows: [] };
/** The test orders as order lines, shaped like ordLines(), carrying their simulated figures in __t. */
function flowTestLines() {
  if (FLOW_TC.src === FLOW.test) return FLOW_TC.rows;
  const rows = [];
  Object.values(FLOW.test || {}).forEach(o => Object.entries(o.lines || {}).forEach(([sku, t]) => {
    const m = cutSkuOf(sku) || {}, qty = +t.qty || 0;
    let cutReq = true; try { cutReq = ordCutReq(sku); } catch (e) { cutReq = m.cuttingRequired !== false; }
    rows.push({ orderNo: o.orderNo, sku: obUC(sku), qty, orderDate: o.orderDate, src: o.src || 'TEST',
      articleType: m.articleType || '', articleSubtype: m.articleSubtype || '', color: m.color || m.colour || '', size: m.size || '',
      cutReq, cut: +t.cut || 0, issued: +t.issued || 0, received: +t.received || 0, pressed: 0, printer: '', printed: 0,
      open: true, handedAt: '', shopDoneAt: '', __t: t });
  }));
  FLOW_TC = { src: FLOW.test, rows };
  return rows;
}

/** What each Simulate button stands in for, and what it sets. */
const FLOW_SIM = {
  vendor: ['Simulate: vendor order placed', 'Vendor Orders → place the order on a printer', t => ({ given: t.qty })],
  fabric: ['Simulate: printed fabric accepted', 'History → accept what the printer sent', t => ({ given: t.qty, back: t.qty })],
  cut: ['Simulate: cutting entry', 'Cutting Data → the cutting entry', t => ({ cut: t.qty })],
  raw: ['Simulate: issued to karigar', 'Job Work Register → issue', t => ({ issued: t.qty })],
  out: ['Simulate: received in Finished Goods', 'Finished Goods → receive (from the outsource vendor)', t => ({ fgIn: t.qty })],
};
async function flowSimulate(orderNo, sku, view) {
  const o = (FLOW.test || {})[orderNo], t = o && o.lines && o.lines[sku], sim = FLOW_SIM[view];
  if (!t || !sim) return 'That test line is gone — press Refresh.';
  const set = sim[2](t), patch = {};
  Object.entries(set).forEach(([k, v]) => { patch[`pt_flowTest/${orderNo}/lines/${sku}/${k}`] = v; });
  try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
  const nt = Object.assign({}, t, set);
  FLOW.test = Object.assign({}, FLOW.test, { [orderNo]: Object.assign({}, o, { lines: Object.assign({}, o.lines, { [sku]: nt }) }) });
  return '';
}

function flowTestOpen() {
  const plats = [['AMZ', 'Amazon'], ['SHP', 'Shopify'], ['ONL', 'Online'], ['B2B', 'B2B']];
  const row = i => `<div style="display:flex;gap:8px;margin-top:6px"><input data-tsku="${i}" placeholder="SKU ${i + 1}" style="flex:2"><input data-tqty="${i}" type="number" min="1" placeholder="Qty" style="flex:1"></div>`;
  ptOpenDialog({
    title: 'Test order — walk it through the flow',
    subtitle: 'Lives only in the production flow: not in Sales Orders, the order book or any register. Use real SKUs so PPC can work out fabric and accessories. Delete it when you are done.',
    html: `<label>Platform<select id="fltSrc">${plats.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <div class="muted" style="margin-top:10px;font-size:12px">Lines (SKU and quantity) — fill as many as you want</div>${[0, 1, 2, 3, 4].map(row).join('')}`,
    saveLabel: 'Add the test order',
    onSave: async () => {
      const src = $('fltSrc').value || 'AMZ', lines = {}, bad = [];
      [0, 1, 2, 3, 4].forEach(i => {
        const sku = obUC(((document.querySelector(`[data-tsku="${i}"]`) || {}).value || '')), qty = Math.round(+((document.querySelector(`[data-tqty="${i}"]`) || {}).value || 0));
        if (!sku) return;
        if (!cutSkuOf(sku)) { bad.push(sku + ' is not in the master'); return; }
        if (!(qty > 0)) { bad.push(sku + ': how many?'); return; }
        lines[sku] = { qty: (lines[sku] ? lines[sku].qty : 0) + qty };
      });
      if (bad.length) return bad.join(' · ');
      if (!Object.keys(lines).length) return 'Type at least one SKU and its quantity.';
      const d = dToday(), tag = d.slice(8, 10) + d.slice(5, 7) + d.slice(0, 4);
      const used = Object.keys(FLOW.test || {}).filter(k => k.startsWith(`TEST-${src}-${tag}-`)).length;
      const orderNo = `TEST-${src}-${tag}-${String(used + 1).padStart(2, '0')}`;
      const rec = { orderNo, src, orderDate: d, lines, at: new Date().toISOString(), by: ME.email || '' };
      try { await ptPatch({ ['pt_flowTest/' + orderNo]: rec }); } catch (e) { return 'Could not save: ' + (e.message || e); }
      FLOW.test = Object.assign({}, FLOW.test, { [orderNo]: rec });
      FLOW_VIEW = flowBucketsAllowed().some(b => b[0] === 'ppc') ? 'ppc' : FLOW_VIEW;
      $('flQ').value = orderNo;
      renderFlow();
      return '';
    },
  });
}

/** Take a test order out — and every plan, demand, reservation and challan written for it. */
async function flowTestDelete(orderNo) {
  const o = (FLOW.test || {})[orderNo]; if (!o) return '';
  if (!confirm(`Delete test order ${orderNo} and everything made for it — plan, fabric ready, reservations, challans, print orders, and its TEST entries in Cutting Data, the Job Work Register, Quality Control and Finished Goods (India store)?`)) return '';
  const patch = { ['pt_flowTest/' + orderNo]: null };
  Object.keys(o.lines || {}).forEach(sku => { const k = flowKey(orderNo, sku);
    patch['pt_ppc/' + k] = null; patch['pt_flowDemand/' + k] = null; patch['pt_accReserve/' + k] = null; });
  Object.values(FLOW.ch || {}).filter(c => (c.orders || [c.orderNo]).includes(orderNo)).forEach(c => { patch['pt_flowChallans/' + c.no] = null; });
  Object.values(FLOW.po || {}).filter(o => o && o.orderNo === orderNo).forEach(o => { patch['pt_flowPrintOrders/' + o.no] = null; });
  Object.entries(FLOW.fg || {}).filter(([, h]) => h && h.orderNo === orderNo).forEach(([id, h]) => { patch['pt_flowFgSend/' + id] = null; if (h.fgId) patch['pt_fgiLedger/' + h.fgId] = null; });
  if (typeof FGI !== 'undefined' && Array.isArray(FGI.rows)) FGI.rows.filter(r => r && r._id && obUC(r.orderNo) === obUC(orderNo)).forEach(r => { patch['pt_fgiLedger/' + r._id] = null; });
  /* …and its TEST rows in Cutting Data, the Job Work Register and Quality Control — by what the test order recorded, and
   * by order no in whatever the screens have read, so nothing written for it is left behind. */
  const regs = { pt_cuttingData: new Set(), pt_baseData: new Set(), pt_qcChecks: new Set() };
  Object.values(o.lines || {}).forEach(t => { Object.values(t.cutLog || {}).forEach(c => c && c.reg && regs.pt_cuttingData.add(c.reg));
    Object.values(t.issues || {}).forEach(c => c && c.reg && regs.pt_baseData.add(c.reg)); Object.values(t.qcLog || {}).forEach(c => c && c.reg && regs.pt_qcChecks.add(c.reg)); });
  const mine = r => r && obUC(r.orderNo) === obUC(orderNo);
  (PT.cut || []).filter(mine).forEach(r => regs.pt_cuttingData.add(r.id)); (PT.base || []).filter(mine).forEach(r => regs.pt_baseData.add(r.id));
  if (typeof QC !== 'undefined' && Array.isArray(QC.checks)) QC.checks.filter(mine).forEach(r => regs.pt_qcChecks.add(r.id));
  Object.entries(regs).forEach(([node, ids]) => ids.forEach(id => { if (id) patch[node + '/' + id] = null; }));
  try { await ptPatch(patch); } catch (e) { return 'Could not delete: ' + (e.message || e); }
  const drop = (obj, pre) => { const n = Object.assign({}, obj); Object.keys(patch).filter(p => p.startsWith(pre)).forEach(p => { delete n[p.slice(pre.length)]; }); return n; };
  FLOW.test = drop(FLOW.test, 'pt_flowTest/'); FLOW.ppc = drop(FLOW.ppc, 'pt_ppc/'); FLOW.dem = drop(FLOW.dem, 'pt_flowDemand/');
  FLOW.res = drop(FLOW.res, 'pt_accReserve/'); FLOW.ch = drop(FLOW.ch, 'pt_flowChallans/'); FLOW.po = drop(FLOW.po, 'pt_flowPrintOrders/'); FLOW.fg = drop(FLOW.fg, 'pt_flowFgSend/');
  const gone = node => new Set(Object.keys(patch).filter(k => k.startsWith(node + '/')).map(k => k.slice(node.length + 1)));
  const gc = gone('pt_cuttingData'), gb = gone('pt_baseData'), gq = gone('pt_qcChecks');
  if (gc.size) PT.cut = (PT.cut || []).filter(r => !(r && gc.has(r.id)));
  if (gb.size) PT.base = (PT.base || []).filter(r => !(r && gb.has(r.id)));
  if (gq.size && typeof QC !== 'undefined' && Array.isArray(QC.checks)) QC.checks = QC.checks.filter(r => !(r && gq.has(r.id)));
  const gf = gone('pt_fgiLedger');
  if (gf.size && typeof FGI !== 'undefined' && Array.isArray(FGI.rows)) FGI.rows = FGI.rows.filter(r => !(r && gf.has(r._id)));
  return '';
}

/* ---- A TEST ORDER GOES THROUGH THE SAME QUESTIONS (Ravi, 10 Oct: "cutting par click kiya ye direct raw cutting store
 * me move hua, jabki mujhe dalna padega ki isme ye fabric use hua and itna wastage nikla; issue kar raha hu to kis karigar
 * ko issue kiya wo kuch bhi perform nahi hua"). Cutting, issue, receive and QC on a test order ask what the factory's
 * forms ask — pieces, fabric, fabric used, waste, waste width; the karigar from the employee list; received and rejected;
 * checked, passed, alteration, rejected — and keep the answers ON THE TEST ORDER (pt_flowTest), never in a register.
 * The line moves on from what was entered. ---- */
const flowTestRec = (no, sku) => { const o = (FLOW.test || {})[no]; return o && o.lines && o.lines[sku] ? { o, t: o.lines[sku] } : null; };
/* IN THE REAL SCREENS TOO (Ravi, 10 Oct: "har action ka individual history ho — cutting ka Cutting me, karigar issue/receive
 * ka Job Work me, QC ka Quality Control me; test entry mujhe sabhi jagah se nikalna h"). A test entry is ALSO written into
 * the register the factory's screen reads — pt_cuttingData, pt_baseData, pt_qcChecks — in the very shape that screen
 * saves, order no TEST-…, remarks "[TEST] …", test: true; "delete test" takes every one of them out again. A test issue
 * does not take zippers or ruffle cloth off the real stock. Until it is deleted it counts where the register counts. */
async function flowTestSave(no, sku, set, said, regs, after) {
  const x = flowTestRec(no, sku); if (!x) return 'That test line is gone — press Refresh.';
  const patch = Object.assign({}, regs || {}); Object.entries(set).forEach(([k, v]) => { patch[`pt_flowTest/${no}/lines/${sku}/${k}`] = v; });
  try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
  if (after) { try { after(); } catch (e) { /* the screens read it again when opened */ } }
  const nt = Object.assign({}, x.t);
  Object.entries(set).forEach(([k, v]) => { const [a, b] = k.split('/'); if (b) nt[a] = Object.assign({}, nt[a], { [b]: v }); else nt[a] = v; });
  FLOW.test = Object.assign({}, FLOW.test, { [no]: Object.assign({}, x.o, { lines: Object.assign({}, x.o.lines, { [sku]: nt }) }) });
  renderFlow(); if (said) flowSay(said);
  return '';
}
const flowTid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/** Cutting (test): pieces, fabric, fabric used, waste, waste width, date, remarks — as Cutting Data asks. */
function flowTestCutOpen(no, sku) {
  const x = flowTestRec(no, sku); if (!x) return;
  const row = flowRows().find(y => y.r.orderNo === no && obUC(y.r.sku) === sku), p = (row && row.s.plan) || {};
  const left = Math.max(0, (+x.t.qty || 0) - (+x.t.cut || 0)), per = +(p.fabric && p.fabric.perPc) || 0;
  let fabs = []; try { fabs = cutFabrics(); } catch (e) { fabs = []; }
  const want = String((p.fabric && p.fabric.name) || '');
  if (want && !fabs.some(f => f.toLowerCase() === want.toLowerCase())) fabs.unshift(want);
  ptOpenDialog({
    title: `Cutting entry (TEST) — ${no} · ${sku}`, subtitle: `${nf(left)} of ${nf(x.t.qty)} pieces still to cut. Saved as a TEST entry in Cutting Data too — "delete test" removes it.`,
    html: `<div class="ptgrid" style="grid-template-columns:repeat(3,1fr)">
      <label>Pieces<input id="fltcP" type="number" min="1" value="${left}"></label>
      <label>Fabric<select id="fltcF"><option value="">— Fabric —</option>${fabs.map(f => `<option${f === want ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
      <label>Fabric used (m)<input id="fltcU" type="number" step="0.01" value="${per ? flowR2(per * left) : ''}"></label>
      <label>Waste (m)<input id="fltcW" type="number" step="0.01"></label>
      <label>Waste width (in)<input id="fltcWW" type="number" step="0.1"></label>
      <label>Date<input id="fltcD" type="date" value="${esc(dToday())}"></label>
      <label style="grid-column:1/-1">Remarks (optional)<input id="fltcR"></label></div>`,
    saveLabel: 'Save the cutting entry',
    onSave: async () => {
      const pcs = Math.round(+$('fltcP').value || 0), fab = $('fltcF').value, used = +$('fltcU').value || 0, waste = +$('fltcW').value || 0, ww = +$('fltcWW').value || 0;
      if (!(pcs > 0)) return 'How many pieces were cut?';
      if (pcs > left) return `Only ${nf(left)} pieces are left to cut on this line.`;
      if (!fab) return 'Which fabric was it cut from?';
      if (!(used > 0)) return 'How many metres of fabric were used?';
      if (waste < 0 || ww < 0) return 'Waste cannot be below zero.';
      if (waste > 0 && !(ww > 0)) return 'Waste width (in) — the cutting entry asks it whenever there is waste.';
      const id = flowTid('c'), m = cutSkuOf(sku) || {}, date = $('fltcD').value || dToday(), now = new Date().toISOString();
      const reg = { id: 'cut_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), sku, articleType: m.articleType || '', articleSubtype: m.subtype || m.articleSubtype || '',
        color: m.color || '', size: m.size || '', pieces: pcs, cutDate: ptStampDate(date), fabricWidth: fab, fabricUsed: flowR2(used),
        ...(waste > 0 ? { fabricWaste: flowR2(waste), fabricWasteWidth: ww } : {}), orderNo: no, remarks: ('[TEST] ' + $('fltcR').value.trim()).trim(), test: true, addedBy: ME.email || '', addedAt: now };
      return flowTestSave(no, sku, { cut: (+x.t.cut || 0) + pcs, [`cutLog/${id}`]: { pcs, fabric: fab, used: flowR2(used), waste: flowR2(waste), wasteWidth: ww,
        date, remarks: $('fltcR').value.trim(), at: now, by: ME.email || '', reg: reg.id } },
        `${nf(pcs)} pieces cut from ${fab} (${nf(used)} m, waste ${nf(waste)} m) — in Cutting Data as a TEST entry.`,
        { ['pt_cuttingData/' + reg.id]: reg }, () => { PT.cut = (PT.cut || []).concat([Object.assign({ _key: reg.id }, reg)]); });
    },
  });
}
/** Issue to a karigar (test): employment type, karigar from the employee list, pieces, date — as Job Work asks. */
async function flowTestIssueOpen(no, sku) {
  const x = flowTestRec(no, sku); if (!x) return;
  try { if (typeof ptLoadEmp === 'function') await ptLoadEmp(); } catch (e) { /* the name can still be typed */ }
  const row = flowRows().find(y => y.r.orderNo === no && obUC(y.r.sku) === sku);
  const can = row ? flowIssuable(row.r, row.s) : 0;
  let types = []; try { types = ptEmpTypes(); } catch (e) { types = []; }
  ptOpenDialog({
    title: `Issue to karigar (TEST) — ${no} · ${sku}`, subtitle: `${nf(can)} pieces cut and not yet issued. Saved as a TEST entry in the Job Work Register too — "delete test" removes it.`,
    html: `<div class="ptgrid" style="grid-template-columns:repeat(2,1fr)">
      <label>Employment type<select id="fltiT"><option value="">Employment type…</option>${types.map(t => `<option>${esc(t)}</option>`).join('')}</select></label>
      <label>Karigar<input id="fltiK" list="fltiKL" placeholder="name"><datalist id="fltiKL"></datalist></label>
      <label>Pieces<input id="fltiP" type="number" min="1" value="${can}"></label>
      <label>Issue date<input id="fltiD" type="date" value="${esc(dToday())}"></label>
      <label style="grid-column:1/-1">Remarks (optional)<input id="fltiR"></label></div>`,
    saveLabel: 'Issue',
    onSave: async () => {
      const type = $('fltiT').value, k = $('fltiK').value.trim(), pcs = Math.round(+$('fltiP').value || 0);
      if (!type) return 'Pick the employment type.';
      if (!k) return 'Which karigar is it issued to?';
      let known = []; try { known = ptEmpsOfType(type).map(e => String(e[1]).trim().toLowerCase()); } catch (e) { known = []; }
      if (known.length && !known.includes(k.toLowerCase())) return `${k} is not a ${type} karigar in the employee list — pick from the list.`;
      if (!(pcs > 0)) return 'How many pieces are issued?';
      if (pcs > can) return `Only ${nf(can)} pieces are cut and not yet issued.`;
      const id = flowTid('i'), m = cutSkuOf(sku) || {}, date = $('fltiD').value || dToday(), now = new Date().toISOString();
      const name = (ptEmpsOfType(type).find(e => String(e[1]).trim().toLowerCase() === k.toLowerCase()) || [, k])[1];
      const reg = { id: 'bd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), empType: type, empName: name, sku,
        articleType: m.articleType || '', articleSubtype: m.subtype || m.articleSubtype || '', color: m.color || '', size: m.size || '', orderNo: no,
        issuePieces: pcs, issueDate: ptStampDate(date), receivedPieces: 0, rejectionPieces: 0, receivingDate: '', pendingPieces: pcs,
        remarks: ('[TEST] ' + $('fltiR').value.trim()).trim(), frozen: false, test: true, addedBy: ME.email || '', addedAt: now };
      return flowTestSave(no, sku, { issued: (+x.t.issued || 0) + pcs, [`issues/${id}`]: { karigar: name, type, pcs, received: 0, rejected: 0,
        date, remarks: $('fltiR').value.trim(), at: now, by: ME.email || '', reg: reg.id } },
        `${nf(pcs)} pieces issued to ${name} — in the Job Work Register as a TEST entry (no zipper or ruffle taken off the stock).`,
        { ['pt_baseData/' + reg.id]: reg }, () => { PT.base = (PT.base || []).concat([Object.assign({ _key: reg.id }, reg)]); });
    },
  });
  const fill = () => { let l = []; try { l = ptEmpsOfType($('fltiT').value); } catch (e) { l = []; }
    if ($('fltiKL')) $('fltiKL').innerHTML = l.map(e => `<option value="${esc(e[1])}">`).join(''); };
  if ($('fltiT')) { $('fltiT').onchange = fill; fill(); }
}
/** Receive from a karigar (test): which issue, pieces back, rejected — as the Job Work receive asks. */
function flowTestRecvOpen(no, sku) {
  const x = flowTestRec(no, sku); if (!x) return;
  const open = Object.entries(x.t.issues || {}).filter(([, e]) => e && (+e.pcs || 0) - (+e.received || 0) - (+e.rejected || 0) > 0);
  if (!open.length) return flowSay('Nothing of this test line is out with a karigar.', true);
  ptOpenDialog({
    title: `Receive from karigar (TEST) — ${no} · ${sku}`, subtitle: 'Updates its TEST row in the Job Work Register — "delete test" removes it.',
    html: `<div class="ptgrid" style="grid-template-columns:repeat(3,1fr)">
      <label style="grid-column:1/-1">Issue<select id="fltrI">${open.map(([id, e]) => `<option value="${esc(id)}">${esc(e.karigar)} · issued ${nf(e.pcs)} on ${esc(e.date)} · ${nf(e.pcs - (e.received || 0) - (e.rejected || 0))} out</option>`).join('')}</select></label>
      <label>Received now<input id="fltrP" type="number" min="0"></label><label>Rejected<input id="fltrX" type="number" min="0" value="0"></label>
      <label>Date<input id="fltrD" type="date" value="${esc(dToday())}"></label></div>`,
    saveLabel: 'Received',
    onSave: async () => {
      const id = $('fltrI').value, e = (x.t.issues || {})[id]; if (!e) return 'Pick the issue.';
      const got = Math.round(+$('fltrP').value || 0), rej = Math.round(+$('fltrX').value || 0), out = (+e.pcs || 0) - (+e.received || 0) - (+e.rejected || 0);
      if (!(got > 0) && !(rej > 0)) return 'How many came back?';
      if (got + rej > out) return `Only ${nf(out)} are out with ${e.karigar}.`;
      /* The same Job Work row gets the receipt, the way the register's own Receive writes it. */
      let regs = {}, after = null;
      const row = e.reg && (PT.base || []).find(b => b && b.id === e.reg);
      if (row) {
        let nx = row;
        if (got > 0) { const a = bdApplyRecv(nx, got, ptNow()); if (a.err) return a.err; nx = a.row; }
        if (rej > 0) { const b = bdApplyRej(nx, (+nx.rejectionPieces || 0) + rej); if (b.err) return b.err; nx = b.row; }
        const clean = Object.assign({}, nx); delete clean._key;
        regs = { ['pt_baseData/' + row.id]: clean };
        after = () => { PT.base = (PT.base || []).map(b => (b && b.id === row.id ? Object.assign({ _key: row.id }, clean) : b)); };
      }
      return flowTestSave(no, sku, { received: (+x.t.received || 0) + got,
        [`issues/${id}`]: Object.assign({}, e, { received: (+e.received || 0) + got, rejected: (+e.rejected || 0) + rej, lastBack: $('fltrD').value || dToday() }) },
        `${nf(got)} back from ${e.karigar}${rej ? `, ${nf(rej)} rejected` : ''}${row ? ' — on its TEST row in the Job Work Register' : ''}.`, regs, after);
    },
  });
}
/** What a test line's entries say, under its buttons. */
function flowTestNote(x, view) {
  const t = x.r.__t || {};
  if (view === 'cut') return Object.values(t.cutLog || {}).map(c => `cut ${nf(c.pcs)} · ${esc(c.fabric)} ${nf(c.used)} m, waste ${nf(c.waste)} m`).join('<br>');
  return Object.values(t.issues || {}).map(e => `${esc(e.karigar)}: ${nf(e.pcs)} issued, ${nf(e.received || 0)} back${e.rejected ? `, ${nf(e.rejected)} rejected` : ''}`).join('<br>')
    + (() => { const q = flowQcLine(x.r); return q.checked || q.ok ? `<br>QC: ${nf(q.checked)} checked, ${nf(q.ok)} passed${q.rej ? `, ${nf(q.rej)} rejected` : ''}` : ''; })();
}
