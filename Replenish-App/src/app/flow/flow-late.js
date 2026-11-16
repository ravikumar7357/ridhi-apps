/* ================= PRODUCTION FLOW · LATE AT PRINTERS — cloth with a printer past its days =================
 * MIS meeting (Ravi, 16 Nov): "if any item has been pending with a printer for more than 10 days … build a track record for
 * each printer". Ravi chose (16 Nov): no new page — the challans already listed in Demand history → By challan turn RED when
 * a line on them is late, and a "Late at printers" Excel can be downloaded from there at any time (no Monday email).
 *
 * THE RULE. A line is with the printer from the day it went out until all of it is back. It is expected back
 *   10 days after it went out, or
 *    2 days after for a CUSTOM order: a custom SKU (made from a sales order, not in the master), an order line with
 *      Customization details, or a sales order line of type "New dev". An Amazon order (AMZ-) is never custom: 10 days.
 * Part-received lines still count from the day they went out (Ravi, 16 Nov). Days late = today − expected date.
 *
 * WHAT IS COUNTED.
 *   Challans    every open challan of the Production flow (pt_flowChallans): sent − received, per line.
 *   Old RFD     cloth the store sent from Vendors → RFD on the older printer orders (pt_rfdDecisions sends, dated). What
 *               the printer delivered back on that order clears the oldest send first; only the sends are counted, not
 *               what the printer said it already had. In the Excel only — they are not challans, so they have no row here.
 *
 * ERRORS. Display only: nothing here writes. A read that fails (vendor orders, RFD sends, sales orders) is named on the
 * screen and the sheet is still made from what could be read — it never quietly leaves a part out. */
const FLOW_LATE_DAYS = 10;
const FLOW_LATE_CUSTOM_DAYS = 2;
const flowLateNo = v => /^\s*no\s*$/i.test(String(v || '')) || !String(v || '').trim();
/** Why an order line is a custom order ('' when it is not): the custom SKU, its Customization, or its New dev type. */
function flowLateCustomWhy(orderNo, sku) {
  const no = obUC(orderNo), s = obUC(sku);
  /* AN AMAZON ORDER ALWAYS HAS ITS 10 DAYS (Ravi, 16 Nov: "dont include the amazon … they have 10 days buffer") — even a New dev
   * line, and even on a challan it shares with custom orders. */
  if (/^AMZ-/.test(no)) return '';
  let m = null; try { m = typeof cutSkuOf === 'function' ? cutSkuOf(s) : null; } catch (e) { m = null; }
  if (m && m.isCustom === true) return 'custom SKU';
  const ob = (typeof PTG !== 'undefined' && PTG.ob) || [];
  if (no && ob.some(r => r && obUC(r.orderNo) === no && obUC(r.sku) === s && !flowLateNo(r.customization))) return 'customization';
  const so = no && typeof SOX !== 'undefined' && SOX.rows ? SOX.rows.find(o => o && obUC(o._id) === no) : null;
  if (so) {
    const ls = Array.isArray(so.lines) ? so.lines : Object.values(so.lines || {});
    const l = ls.find(x => x && obUC(x.sku) === s);
    if ((l && l.orderTypeKey === 'newdev') || (!l && so.orderTypeKey === 'newdev')) return 'new dev';
  }
  return '';
}
/** Day arithmetic on ISO days, at noon so no clock change can move a day. */
const flowLateAdd = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const flowLateGap = (a, b) => Math.round((Date.parse(String(b).slice(0, 10) + 'T12:00:00') - Date.parse(String(a).slice(0, 10) + 'T12:00:00')) / 864e5);
/** One line with a printer: its expected day and how late it is (0 when not late, or when its send day is not known). */
function flowLateOf(sentIso, why, today) {
  const days = why ? FLOW_LATE_CUSTOM_DAYS : FLOW_LATE_DAYS;
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(sentIso || ''))) return { days, expected: '', late: 0 };
  const expected = flowLateAdd(sentIso, days);
  return { days, expected, late: Math.max(0, flowLateGap(expected, today)) };
}

/** Every challan line still with a printer, late or not — one row each. */
function flowLateChRows(today) {
  const out = [];
  Object.values(FLOW.ch || {}).forEach(c => {
    if (!c || c.cancelled || c.closed) return;
    const recv = flowChRecv(c), sentIso = ptIsoDate(c.date || c.at);
    (c.lines || []).forEach(l => {
      if (flowChMoved(c, l)) return;
      const unit = flowChUnit(l), sent = flowR2(flowChSent(l)), back = flowR2(recv[l.key] || 0), left = flowR2(sent - back);
      if (!(left > 0.001)) return;
      const orderNo = l.orderNo || String(l.key || '').split('__')[0] || c.orderNo || '';
      const why = flowLateCustomWhy(orderNo, l.sku);
      out.push(Object.assign({ src: 'Challan', no: c.no, printer: (c.vendor && c.vendor.name) || '', orderNo, sku: obUC(l.sku),
        unit, sent, back, left, sentIso, why, test: flowIsTest(c.orderNo) }, flowLateParts(l), flowLateOf(sentIso, why, today)));
    });
  });
  return out;
}
/* WHAT IT IS, EACH IN ITS OWN COLUMN (Ravi, 16 Nov: "article details aren't properly shown, separate it properly"): the article,
 * size and colour from the master (else the words saved on the challan line), the printed fabric SKU the printer prints, and the
 * cloth. A line printed on the SKU itself has no printed fabric SKU. */
function flowLateParts(l) {
  let m = {}; try { m = (typeof cutSkuOf === 'function' && cutSkuOf(l.sku)) || {}; } catch (e) { m = {}; }
  const saved = String(l.item || '').split(' · '), p = l.print || {};
  const printed = l.ruffleOnly ? (l.extras || []).map(x => x.code).filter(Boolean).join(' + ')
    : p.kind === 'fabric' ? (p.sides && p.sides.length ? p.sides.map(sd => sd.side + ' ' + sd.code).join(' + ') : (p.code || '')) : '';
  const printedColour = p.kind === 'fabric' ? String(p.label || '').split(' · ')[0] : '';
  /* running cloth with no printed fabric SKU: a challan made before challans kept it (early Oct) — said, not left blank */
  const missing = !printed && flowChUnit(l) === 'm' ? 'not on the challan' : '';
  return { article: String(m.subtype || m.articleType || saved[0] || '').trim() + (l.ruffleOnly ? ' (ruffle)' : ''),
    size: String(m.size || saved[2] || '').trim(), colour: String(printedColour || m.color || saved[1] || '').trim(),
    printed: printed || missing, fabric: String(l.fabric || m.fabric || '').trim() };
}
/** The challans with a line late today — the red rows of By challan. */
const flowLateNos = today => new Set(flowLateChRows(today).filter(x => x.late > 0).map(x => x.no));

/** Every old-RFD send still with a printer: the oldest sends are the ones the printer's deliveries cleared. */
function flowLateRfdRows(today) {
  if (typeof rfdOrderRows !== 'function' || typeof VO === 'undefined' || !VO.rows) return [];
  const out = [];
  rfdOrderRows().forEach(x => {
    const lots = [];
    (x.reqs || []).forEach(r => rfdSends(rfdDecisionOf(r.id)).forEach(s => lots.push({ iso: ptIsoDate(s.date || s.at), qty: +s.qty || 0, sku: r.sku })));
    lots.sort((a, b) => String(a.iso).localeCompare(String(b.iso)));
    let used = +(rfdOrderUsed(x._order).get(x.key) || 0);
    lots.forEach(lot => {
      const clear = Math.min(used, lot.qty); used -= clear;
      const left = flowR2(lot.qty - clear); if (!(left > 0.001)) return;
      const why = (x.reqs || []).map(r => flowLateCustomWhy('', r.sku)).find(Boolean) || '';
      /* cut pieces of a size are that SKU's own article; running cloth is the cloth alone */
      const parts = x.unit === 'pcs' ? flowLateParts({ sku: lot.sku, print: { kind: 'sku' } }) : { article: x.item || 'Running cloth', size: '', colour: '', printed: '', fabric: x.what || '' };
      out.push(Object.assign({ src: 'Old RFD send', no: x.orderNo, printer: x.vendorName || x.vendorCode || '', orderNo: x.orderNo,
        sku: x.unit === 'pcs' ? obUC(lot.sku) : '', unit: x.unit, sent: flowR2(lot.qty), back: flowR2(clear), left,
        sentIso: lot.iso, why, test: false }, parts, flowLateOf(lot.iso, why, today)));
    });
  });
  return out;
}

/** The sheet's rows: the late lines only, the latest first. */
function flowLateSheet(today, testOnly) {
  const rows = flowLateChRows(today).concat(flowLateRfdRows(today)).filter(x => x.late > 0 && (!testOnly || x.test))
    .sort((a, b) => b.late - a.late || a.printer.localeCompare(b.printer) || String(a.no).localeCompare(String(b.no)));
  const out = [['Challan / RFD order', 'Source', 'Printer', 'Against order', 'SKU', 'Article', 'Size', 'Colour', 'Printed fabric SKU', 'Fabric',
    'Unit', 'Sent', 'Received back', 'Still with printer', 'Issued on', 'Days allowed', 'Custom order', 'Expected by', 'Days late']];
  rows.forEach(x => out.push([x.no, x.src, x.printer, x.orderNo, x.sku, x.article, x.size, x.colour, x.printed, x.fabric,
    x.unit === 'pcs' ? 'pcs' : 'metres', x.sent, x.back, x.left, x.sentIso, x.days, x.why || 'no', x.expected, x.late]));
  return out;
}
/** Reads what the sheet needs that this screen does not hold already — once each; says what it could not read. */
async function flowLateReads() {
  const missed = [];
  const take = async (what, fn) => { try { await fn(); } catch (e) { missed.push(what + ' (' + (e.message || e) + ')'); } };
  if (typeof VO !== 'undefined' && VO.rows == null && typeof ensureVo === 'function') await take('the older printer orders', () => ensureVo());
  if (typeof RFD !== 'undefined' && RFD.decisions == null) await take('the old RFD sends', async () => { RFD.decisions = (await ptGet('pt_rfdDecisions')) || {}; });
  if (typeof SOX !== 'undefined' && SOX.rows == null) await take('the sales orders (New dev lines)', async () => { SOX.rows = ptList(await ptGet('pt_salesOrders')); });
  return missed;
}
async function flowLateXl(testOnly) {
  const missed = await flowLateReads();
  const out = flowLateSheet(dToday(), testOnly);
  const said = missed.length ? ' Could not read ' + missed.join(', ') + ' — the sheet is without them.' : '';
  if (out.length < 2) return { err: 'Nothing is late at any printer today.' + said };
  const bytes = recipeXlsx(out, { name: 'Late at printers', freeze: 1, cols: {} });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = 'late-at-printers-' + dToday() + '.xlsx';
  a.click(); URL.revokeObjectURL(a.href);
  return { err: '', said: nf(out.length - 1) + ' late line(s) downloaded.' + said, warn: !!missed.length };
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', async e => {
  const t = e.target; if (!t || !t.closest || !t.closest('[data-fllatexl]')) return; e.preventDefault();
  let r;
  try { r = await flowLateXl(FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly()); }
  catch (er) { r = { err: 'The Late at printers sheet could not be made: ' + (er.message || er) }; }   // said, never silent
  $('flMsg').className = r.err || r.warn ? 'err' : 'muted'; $('flMsg').textContent = r.err || r.said;
});
