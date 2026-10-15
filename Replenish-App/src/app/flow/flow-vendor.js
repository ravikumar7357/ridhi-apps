/* ================= PRODUCTION FLOW · WHAT THE PRINTER SEES =================
 * Ravi, 11 Oct: "yahan dikha raha h sent to printer but na to ye vendor screen me show ho raha h na hi vendor ke pas; and
 * going forward hum sirf vendor ko order dikhayenge, aur sari entry hum apne bande se karenge — kya order diya humne aur
 * humne unse kya receive kar liya. Abhi jo running order h unko aise hi close karenge, aur isko sirf abhi test flow me hi
 * rakhna h, main jagah nahi."
 *
 *   A TEST print order shows as the Vendor Order(s) it would be — on the Vendor Orders screen and in the printer's portal —
 *   built on the fly from pt_flowPrintOrders, NEVER written into pt_vendorOrders: that register is read by the live app
 *   (portal, payouts, printer capacity, karigar analysis), and a test must not reach any of them.
 *   A flow order (test, or placed by PPC) is VIEW ONLY for the printer: no Acknowledge, no Start, no "I sent", no promise
 *   dates, no RFD asking. Ridhi Home & Living's own people record what was given (the RFD challans) and what came back (receive
 *   on the challan, Demand history). The orders already running keep the old way.
 *   An admin can look at the portal AS a printer, on the preview only ("View as printer") — view only throughout.
 * All of it is switched on with the flow (FLOW_ON); the live app is untouched. */

/* EVERY ORDER IS VIEW ONLY (Ravi, 15 Oct: "vendor sirf order dekh paye aur order ke against me usko fabric ya cut piece mila
 * h ya nahi wo dekh paye aur usne kya bhej diya wo dekh paye; usko entry nahi krni h, n hi order acknowledge krna h, n hi
 * production me order lena h; jese hi order place karu direct usko pas show ho jay"). With the flow on, a printer sees
 * its orders and nothing to press: no Acknowledge, no Start production, no "I am sending", no dates, no RFD asking — old
 * orders included. What was given and what came back is the office's entry, shown on the order (flowProg). */
/** vpEntry = '1' on one computer brings the old entries back (read each time, so a test can switch it). */
const vpViewAll = () => { try { if (localStorage.getItem('vpEntry') === '1') return false; } catch (e) { /* storage blocked */ } return !!FLOW_ON; };
/** View only in the portal: every order while the flow is on (and anything while an admin is looking as a printer). */
const flowVpViewOnly = o => !!(o && (vpViewAll() || (FLOW_ON && (o.test || o.demandSource === 'ppc' || (typeof VP !== 'undefined' && VP.viewAs)))));
const flowDmy = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || ''); };

/** The test print orders as Vendor Orders — built on the fly, never stored. */
function flowTestVos() {
  if (!FLOW_ON || !flowTestsOn()) return [];   // the live app never sees a test vendor order, nor the preview with tests off
  const out = [];
  Object.values(FLOW.po || {}).forEach(o => {
    if (!o || !o.test || o.cancelled || !o.printer || !o.printer.code) return;
    let want; try { want = flowVoLines(o, k => (FLOW.ppc || {})[k]); } catch (e) { return; }
    let prog = []; try { prog = flowPoProgress(o); } catch (e) { prog = []; }
    const sent = prog.reduce((a, x) => a + (+x.sent || 0), 0), back = prog.reduce((a, x) => a + (+x.back || 0), 0);
    ['running', 'cut'].forEach(kind => {
      const lines = want[kind] || []; if (!lines.length) return;
      out.push({ id: 'tvpo_' + o.no + '_' + kind, orderNo: String(o.no).replace(/^TPRN-/, 'TVPO-') + (kind === 'cut' ? '-C' : '-R'),
        vendorCode: o.printer.code, vendorName: o.printer.name, service: 'Block print', ...(want.channel ? { channel: want.channel } : {}),
        orderType: kind, orderDate: flowDmy(o.date), status: 'Placed',
        notes: `TEST — from the PPC plan, ${o.orderNo} (${o.no}). View only: ${FLOW_COMPANY} records the cloth sent and the printed cloth received`
          + ` (so far: sent ${nf(flowR2(sent))}, back ${nf(flowR2(back))}).`,
        lines: lines.map((l, i) => Object.assign({ lineId: 'tl_' + kind + '_' + i }, l)), createdBy: o.by || '', createdAt: o.at || '',
        demandSource: 'ppc', flowPrintOrder: o.no, test: true, virtual: true, flowProg: flowVoProgOf(o, kind) });
    });
  });
  return out;
}

/** Vendor Orders screen: the test ones in VO.rows (preview only), fresh each time the screen is drawn from ensureVo. */
async function flowVoExtra() {
  if (!FLOW_ON || typeof VO === 'undefined' || !Array.isArray(VO.rows)) return;
  try { await flowLoad(); } catch (e) { /* without the flow there is nothing to add */ }
  VO.rows = VO.rows.filter(o => !(o && o.virtual)).concat(flowTestVos());
}

/* ---- the portal ---- */
let FLOW_VP_AS = null;   // { code, name } while an admin looks as a printer
/** After the portal read its printer's branch: the view-as printer instead, and the test orders for that printer. */
async function flowVpAfterLoad() {
  if (!FLOW_ON || typeof VP === 'undefined') return;
  VP.viewAs = false;
  if (FLOW_VP_AS && ME.admin) {
    VP.code = FLOW_VP_AS.code; VP.name = FLOW_VP_AS.name; VP.viewAs = true;
    try { VP.rows = ptList(await ptGet('pt_vendorOrders/' + VP.code)); } catch (e) { VP.rows = []; }
  }
  if (!VP.code) return;
  /* A PRINTER'S OWN SIGN-IN NEVER SEES A TEST ORDER (14 Oct: the flow is on the live app now, where real printers sign in).
   * Test orders reach the portal only when an admin looks at it "as printer". */
  if (!VP.viewAs) { VP.rows = (VP.rows || []).filter(o => !(o && o.virtual)); return; }
  try { await flowLoad(); } catch (e) { return; }
  VP.rows = (VP.rows || []).filter(o => !(o && o.virtual)).concat(flowTestVos().filter(v => obUC(v.vendorCode) === obUC(VP.code)));
}
/** The "View as printer" picker above the portal — an admin, on the preview only. */
async function flowVpBar() {
  if (!FLOW_ON || !ME.admin || !$('vpBody') || $('flVpAs')) return;
  $('vpBody').insertAdjacentHTML('beforebegin', `<div class="card" style="padding:8px 12px;margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px dashed #7c3aed">
    <span style="color:#7c3aed;font-weight:600;font-size:12.5px">TEST VIEW</span>
    <label style="display:flex;gap:6px;align-items:center;margin:0;font-size:12.5px">See the portal as printer
      <select id="flVpAs" style="width:auto;min-width:220px"><option value="">— my own sign-in —</option></select></label>
    <span class="muted" style="font-size:12px">what that printer sees, view only — nothing can be changed from here</span></div>`);
  let map = {}; try { map = (await ptGet('pt_vendorMap')) || {}; } catch (e) { map = {}; }
  const sel = $('flVpAs'); if (!sel) return;
  sel.innerHTML += Object.entries(map).filter(([, v]) => v).sort((a, b) => String(a[1].name || a[0]).localeCompare(String(b[1].name || b[0])))
    .map(([code, v]) => `<option value="${esc(code)}">${esc(v.name || code)} (${esc(code)})</option>`).join('');
  sel.onchange = async () => {
    const code = sel.value; FLOW_VP_AS = code ? { code, name: (map[code] && map[code].name) || code } : null;
    VP.rows = null; if (typeof ensureVp === 'function') await ensureVp();
  };
}

/* History never changes a receipt made on a flow challan: it is changed on the challan itself (Demand history). */
if (FLOW_ON && typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', e => {
  const t = e.target && e.target.closest && e.target.closest('[data-vl-ok],[data-vl-no],[data-vl-pick]');
  if (!t || ![...t.attributes].some(a => /^data-vl-/.test(a.name) && /^flow\//.test(a.value))) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const m = $('vlMsg'); if (m) { m.className = 'err'; m.textContent = 'This was received on a Production flow challan — change it on the challan in Production flow → Demand history (undo the receipt there).'; }
}, true);
/* The staff screens never change a test vendor order: it is not in the register, and its entries are the flow's. */
if (FLOW_ON && typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', e => {
  const t = e.target && e.target.closest && e.target.closest('[data-vo-open],[data-vo-recv],[data-vo-move],[data-vo-cxl],[data-vo-pick],[data-vopick],[data-vocancel],[data-vorestore],[data-voqtysave],[data-voqty]');
  if (!t || ![...t.attributes].some(a => /^data-vo/.test(a.name) && /tvpo_/.test(a.value))) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const m = $('voMsg'); if (m) { m.className = 'err'; m.textContent = 'This is a TEST vendor order from the Production flow — it is not in the register. The cloth sent and the printed cloth received are entered in Production flow → Demand history.'; }
}, true);
