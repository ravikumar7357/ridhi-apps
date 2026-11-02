/* ================= COMPLETE A SALES-TEAM ORDER LINE FROM READY STOCK =================
 *
 * Ravi, 29 Oct: "koi inventory production store me already ready h to usko jo sales team se order aaya h usko direct production store se fulfil kar
 * saku ... manually order complete kar saku". An open line of a sales / B2B / Amazon order (not a Shopify or Online one — the SHP board does the
 * same for those) can be completed by hand, in full or in part, from pieces already made and held in the India store (Finished Goods):
 *   - the store gives them up: an ISSUE row in pt_fgiLedger naming the order,
 *   - the line is credited: stockDone (+ stockLog) on its order-book row, so the pieces count as made AND pressed and the line stops asking
 *     the floor for them. Both go in ONE write.
 * Cut, issued, received, QC and press registers are never touched. */
const ordStockCan = () => !spIsVendor() && !!(ME.admin || (ME.tabs || []).indexOf('ord') >= 0);
const ordStockRows = (orderNo, sku) => (PTG.ob || []).filter(r => r && obUC(r.orderNo) === obUC(orderNo) && obUC(r.sku) === obUC(sku));
/** What the store could still give this line: never more than the line still owes. */
const ordStockOwed = l => Math.max(0, (+l.qty || 0) - Math.max(+l.made || 0, +l.pressed || 0));   // made and pressed already include what came from stock

async function ordStockSave(l, v) {
  if (!ordStockCan()) return 'Completing a line from stock needs the Order Console.';
  if (ordIsMto(l.orderNo)) return 'Shopify and Online lines are completed from the SHP board or by shipping.';
  const pcs = parseInt(v.pcs, 10);
  if (!(pcs > 0)) return 'Type how many pieces come from stock.';
  const owed = ordStockOwed(l);
  if (pcs > owed) return `Only ${nf(owed)} piece(s) of this line are still owed.`;
  const short = fgiOutCheck(obUC(l.sku), pcs, 'ISSUE', 0); if (short) return short;
  const rows = ordStockRows(l.orderNo, l.sku), row = rows[0], key = row && (row.id || row._key);
  if (!key) return 'Its order-book row is gone — press Refresh.';
  const now = new Date().toISOString(), d = new Date(), p2 = x => String(x).padStart(2, '0');
  const issue = { _id: fgiNewId('ISS'), txnType: 'ISSUE', sku: obUC(l.sku), qty: pcs, date: p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear(),
    issuedFor: 'Order ' + l.orderNo, reason: 'Order Console — completed from ready stock', remarks: String(v.note || '').trim(), stockForOrder: l.orderNo, createdAt: now, createdBy: ME.email };
  const done = (parseInt(row.stockDone, 10) || 0) + pcs;
  const log = (Array.isArray(row.stockLog) ? row.stockLog.slice(-19) : []).concat([{ qty: pcs, at: now, by: ME.email, fgi: issue._id, note: issue.remarks }]);
  try { await ptPatch({ ['pt_fgiLedger/' + issue._id]: issue, ['pt_orderBook/' + key + '/stockDone']: done, ['pt_orderBook/' + key + '/stockLog']: log }); }
  catch (x) { return 'Not saved: ' + (x.message || x); }
  FGI.rows = (FGI.rows || []).concat(issue);
  PTG.ob = (PTG.ob || []).map(r => (r && (r.id || r._key) === key ? Object.assign({}, r, { stockDone: done, stockLog: log }) : r));
  if (typeof renderOrd === 'function') { try { renderOrd(); } catch (e) { /* the next draw shows it */ } }
  return '';
}
async function ordStockOpen(key) {
  const [no, sku] = String(key).split('|'), l = ordLines().find(x => x.orderNo === obUC(no) && x.sku === obUC(sku));
  if (!l) return;
  const msg = t => { if ($('odMsg')) { $('odMsg').className = 'err'; $('odMsg').textContent = t; } };
  if (!ordStockCan()) return msg('Completing a line from stock needs the Order Console.');
  try { if (!Array.isArray(FGI.rows)) FGI.rows = ptList(await ptGet('pt_fgiLedger')); } catch (e) { return msg('Could not read the India store: ' + (e.message || e)); }
  const have = Math.max(0, Math.floor(fgiOf(l.sku).current)), owed = ordStockOwed(l), top = Math.min(have, owed), who = l.orderNo + ' · ' + l.sku;
  if (!(top > 0)) return ptOpenDialog({ title: 'From stock — ' + who, subtitle: have > 0 ? 'Nothing more of this line is owed.' : `${l.sku} has no pieces in the India store, so nothing can be completed from stock.` });
  ptOpenDialog({ title: 'Complete from ready stock — ' + who, subtitle: `${nf(have)} piece(s) of ${l.sku} in the India store · this line is still owed ${nf(owed)}. The store gives the pieces up and the line counts them as made.`,
    fields: [{ key: 'pcs', label: 'Pieces from stock', type: 'number', min: 1, max: top, value: top }, { key: 'note', label: 'Note (optional)', value: '' }],
    saveLabel: 'Complete from stock', onSave: v => ordStockSave(l, v) });
}
if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('[data-ordstock]'); if (!a) return;
  e.preventDefault(); e.stopPropagation(); ordStockOpen(a.getAttribute('data-ordstock'));
}, true);
