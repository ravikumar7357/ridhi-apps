/* ================= PRODUCTION FLOW · THE FACTORY'S OWN ENTRIES, OPENED FOR THE LINE =================
 * Ravi, 10 Oct: the lines move to Cutting by themselves, "then wahan se cutting ki entry ho jise hum abhi individual kar
 * rahe h (abhi ki cutting flow par impact na ho)", the Job Work issue / receive from Raw cutting in store showing the store
 * balance, then QC — then ready for India stock. So each bucket opens THE SAME entry form the factory uses today, filled
 * in for the line (SKU, order, pieces), and the entry is made and saved there exactly as now: same register, same checks,
 * same caps. Nothing here writes a register. A test order has no real entry — it keeps its Simulate buttons.
 * The forms are filled the way the Fabric tab's stage buttons fill theirs (fabEntryOpen): open the tab and the box, set
 * the SKU as typed, draw, set the order, draw again, then the pieces. */

/** Can this account open that screen at all? */
const flowMay = tab => !!(ME.admin || (ME.tabs || []).includes(tab));
/** Open a "+ New …" box on its screen if it is shut (its toggle loads what the form needs). */
async function flowOpenBox(boxId, toggleId) {
  const box = $(boxId), t = $(toggleId);
  if (box && box.classList.contains('hide') && t && typeof t.onclick === 'function') await t.onclick();
}
const flowSay = (t, bad) => { if ($('flMsg')) { $('flMsg').className = bad ? 'err' : 'muted'; $('flMsg').textContent = t; } };

/** Cutting Data → a new cutting entry for the line: SKU, order, the pieces still to cut, the plan's fabric. */
async function flowCutEntry(r, s) {
  if (!flowMay('pcut')) return flowSay('Cutting Data is not open to this account — ask for the Cutting right.', true);
  try {
    showTab('pcut'); await flowOpenBox('cwBox', 'cwToggle'); if (typeof ensureCutForm === 'function') await ensureCutForm();
    $('cwSku').value = obUC(r.sku); cutSkuTyped(); renderCutForm();
    $('cwOrd').value = r.orderNo; renderCutForm();
    $('cwPcs').value = Math.max(0, (+r.qty || 0) - (s.cut || 0));
    const fab = s.plan && s.plan.fabric && s.plan.fabric.name, sel = $('cwFabric');
    if (fab && sel && [...sel.options].some(o => o.value === fab)) sel.value = fab;
    if (typeof renderCutFab === 'function') renderCutFab();
    if ($('cwBox').scrollIntoView) $('cwBox').scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (e) { flowSay('Cutting Data is open — the form could not be filled in by itself (' + (e.message || e) + '); type the line in.', true); }
}
/** Job Work Register → a new issue to a karigar for the line: SKU, order, the pieces to issue. The karigar is picked there. */
async function flowIssueEntry(r, s) {
  if (!flowMay('pbase')) return flowSay('The Job Work Register is not open to this account.', true);
  try {
    showTab('pbase'); await flowOpenBox('bwBox', 'bwToggle'); if (typeof ensureBdForm === 'function') await ensureBdForm();
    $('bwSku').value = obUC(r.sku); bdSkuTyped(); renderBdForm();
    $('bwOrd').value = r.orderNo; renderBdForm();
    $('bwPcs').value = Math.max(0, flowIssuable(r, s));
    if (typeof bdMatFill === 'function') bdMatFill();
    if ($('bwBox').scrollIntoView) $('bwBox').scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (e) { flowSay('The Job Work Register is open — the issue could not be filled in by itself (' + (e.message || e) + '); type it in.', true); }
}
/** What can go to a karigar now: what is cut (or back from the printer as pieces) less what is issued. */
const flowIssuable = (r, s) => Math.max(0, (r.cutReq ? s.cut : (s.printed ? s.back : +r.qty || 0)) - (s.issuedNet != null ? s.issuedNet : (s.issued || 0)));
/** The Job Work rows of this line still out with a karigar. */
const flowOpenIssues = r => (PT.base || []).filter(b => b && obUC(b.sku) === obUC(r.sku) && obUC(b.orderNo) === obUC(r.orderNo) && !b.frozen
  && (+b.issuePieces || 0) - (+b.receivedPieces || 0) - (+b.rejectionPieces || 0) > 0);
/** Job Work → receive pieces back: the karigar's issue for this line (picked when there is more than one). */
function flowRecvEntry(r) {
  if (!flowMay('pbase')) return flowSay('The Job Work Register is not open to this account.', true);
  const open = flowOpenIssues(r);
  if (!open.length) return flowSay(`Nothing of ${obUC(r.sku)} on ${r.orderNo} is out with a karigar.`, true);
  const go = id => { jwRecvOpen(id); flowAfterDialog(); };
  if (open.length === 1) return go(open[0].id);
  ptOpenDialog({
    title: `Receive — ${r.orderNo} · ${obUC(r.sku)}`, subtitle: 'Which karigar\'s issue came back?',
    html: open.map(b => `<button class="ghost" data-flrb="${esc(b.id)}" style="display:block;width:100%;text-align:left;margin:4px 0;padding:8px 10px">${esc(b.empName || '?')} · issued ${nf(b.issuePieces)} on ${esc(String(b.issueDate || '').slice(0, 10))} · ${nf((+b.issuePieces || 0) - (+b.receivedPieces || 0) - (+b.rejectionPieces || 0))} still out</button>`).join(''),
    saveLabel: 'Close', onSave: () => '',
  });
  document.querySelectorAll('[data-flrb]').forEach(b => { b.onclick = () => { ptDlgClose(); go(b.dataset.flrb); }; });
}
/** When a dialog opened from here closes, the lines are worked out again — a receipt changes a row in place. */
function flowAfterDialog() {
  const d = $('ptDlg'); if (!d || typeof MutationObserver === 'undefined') return;
  const mo = new MutationObserver(() => { if (d.classList.contains('hide')) { mo.disconnect(); try { ORD_IX.rows = null; } catch (e) { /* the cache is rebuilt anyway */ } renderFlow(); } });
  mo.observe(d, { attributes: true, attributeFilter: ['class'] });
}
/** The store's balance of a SKU's cut pieces (Store Stock Balance, P|SKU); null while the store is not read. */
const flowStorePcs = sku => flowPrintedStock({ kind: 'sku', code: obUC(sku) }, '');
