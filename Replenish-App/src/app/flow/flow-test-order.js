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
  wip: ['Simulate: received + QC passed', 'Job Work → receive, then Quality Control → pass', t => ({ received: t.qty, qc: t.qty })],
  ready: ['Simulate: received in Finished Goods', 'Finished Goods → receive', t => ({ fgIn: t.qty })],
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
  if (!confirm(`Delete test order ${orderNo} and everything made for it (plan, fabric ready, reservations, challans)?`)) return '';
  const patch = { ['pt_flowTest/' + orderNo]: null };
  Object.keys(o.lines || {}).forEach(sku => { const k = flowKey(orderNo, sku);
    patch['pt_ppc/' + k] = null; patch['pt_flowDemand/' + k] = null; patch['pt_accReserve/' + k] = null; });
  Object.values(FLOW.ch || {}).filter(c => c.orderNo === orderNo).forEach(c => { patch['pt_flowChallans/' + c.no] = null; });
  try { await ptPatch(patch); } catch (e) { return 'Could not delete: ' + (e.message || e); }
  const drop = (obj, pre) => { const n = Object.assign({}, obj); Object.keys(patch).filter(p => p.startsWith(pre)).forEach(p => { delete n[p.slice(pre.length)]; }); return n; };
  FLOW.test = drop(FLOW.test, 'pt_flowTest/'); FLOW.ppc = drop(FLOW.ppc, 'pt_ppc/'); FLOW.dem = drop(FLOW.dem, 'pt_flowDemand/');
  FLOW.res = drop(FLOW.res, 'pt_accReserve/'); FLOW.ch = drop(FLOW.ch, 'pt_flowChallans/');
  return '';
}
