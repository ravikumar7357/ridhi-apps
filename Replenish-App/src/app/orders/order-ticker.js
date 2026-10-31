/* ===================== ORDER TICKER (Ravi, 31 Oct 2026) =====================
 * "mujhe app me aisa chalti hui line chahiye jisme pending orders critical orders show hote rahe": a running strip under
 * the page title, like the offer strip on the Ridhi website. It reads the Order Console's own open lines (ordLines), so
 * it says nothing the console does not.
 *   Critical   an open line past its due date, or due today / tomorrow. Due = the sales order's delivery date, or for a
 *              Shopify / online line 5 working days from when it opened (the console's mtoDue).
 *   Pending    open lines and the pieces still owed, per channel.
 * A click on an order opens the Order Console searched to it; hovering stops the strip so it can be read. */
const OTK = { at: 0, sig: '', asked: false };
const OTK_CHANNEL = { AMZ: 'Amazon', SHP: 'Shopify', ONL: 'Online', B2B: 'B2B', LEG: 'Legacy' };

/** Who sees it: office people who may open the Order Console — never a printer on the vendor portal. */
function otkAllowed() {
  if (typeof ME === 'undefined' || !ME || !ME.email) return false;
  if (typeof NAV_IS_VENDOR !== 'undefined' && NAV_IS_VENDOR) return false;
  return !!(ME.admin || (ME.tabs && (ME.tabs.includes('ord') || ME.tabs.includes('shopprod') || ME.tabs.includes('so'))));
}
const otkDays = (a, b) => { const p = s => { const q = String(s).split('-').map(Number); return Date.UTC(q[0], q[1] - 1, q[2]); }; return Math.round((p(b) - p(a)) / 864e5); };

/** The strip's items: critical lines first (most late first), then the pending totals. */
function otkItems() {
  const today = dToday(), soDue = typeof SOX !== 'undefined' && SOX.rows ? ordDueIndex() : null;
  const open = ordLines().filter(l => l.open && !(typeof shpInsertProduct === 'function' && shpInsertProduct(l.sku)));
  const crit = [], per = new Map();
  let pcs = 0;
  open.forEach(l => {
    const owe = Math.max(0, (+l.qty || 0) - (+l.pressed || 0) - (+l.fromStock || 0));
    const ch = OTK_CHANNEL[String(l.orderNo).split('-')[0]] || 'Other';
    const e = per.get(ch) || per.set(ch, { lines: 0, pcs: 0 }).get(ch); e.lines++; e.pcs += owe; pcs += owe;
    const due = (soDue && soDue.get(l.orderNo + '|' + l.sku)) || l.mtoDue || '';
    if (!due) return;
    const d = otkDays(due, today);   // + late, 0 today, -1 tomorrow
    if (d < -1) return;
    crit.push({ no: l.orderNo, d, what: [l.articleSubtype || l.itemName || l.articleType, l.color].filter(Boolean).join(' · ') || l.sku, qty: l.qty });
  });
  crit.sort((a, b) => b.d - a.d || a.no.localeCompare(b.no));
  const out = [{ kind: 'sum', txt: `Pending: ${nf(open.length)} lines · ${nf(pcs)} pcs`, sub: [...per.entries()].sort((a, b) => b[1].lines - a[1].lines).map(([k, v]) => `${k} ${nf(v.lines)}`).join(' · ') }];
  const late = crit.filter(c => c.d > 0).length;
  if (crit.length) out.push({ kind: 'sum', txt: `Critical: ${nf(late)} late · ${nf(crit.length - late)} due today / tomorrow` });
  crit.slice(0, 40).forEach(c => out.push({ kind: c.d > 0 ? 'late' : 'due', no: c.no,
    tag: c.d > 0 ? `LATE ${c.d} day${c.d > 1 ? 's' : ''}` : c.d === 0 ? 'DUE TODAY' : 'DUE TOMORROW', txt: `${c.no} · ${c.what} · ${nf(c.qty)} pcs` }));
  if (crit.length > 40) out.push({ kind: 'sum', txt: `+ ${nf(crit.length - 40)} more critical lines in the Order Console` });
  return out;
}
function otkItemHtml(x) {
  if (x.kind === 'sum') return `<span class="otk-it otk-sum"><b>${esc(x.txt)}</b>${x.sub ? ` <span>${esc(x.sub)}</span>` : ''}</span>`;
  return `<button type="button" class="otk-it otk-${x.kind}" data-otkno="${esc(x.no)}" title="Open ${esc(x.no)} in the Order Console"><em>${esc(x.tag)}</em>${esc(x.txt)}</button>`;
}

/** Draw (or hide) the strip. Redrawn only when what it says changes, so the scroll does not jump back. */
function otkRender() {
  const box = $('ordTicker');
  if (!box) return;
  if (!otkAllowed() || !PTG.ob) { box.classList.add('hide'); return; }
  let items;
  try { items = otkItems(); } catch (e) { box.classList.add('hide'); return; }
  const one = items.map(otkItemHtml).join('<span class="otk-dot" aria-hidden="true"></span>') + '<span class="otk-dot" aria-hidden="true"></span>';
  if (one === OTK.sig) { box.classList.remove('hide'); return; }
  OTK.sig = one;
  /* Two copies side by side, moved left by one copy's width — the loop has no seam. Speed follows the length. */
  box.innerHTML = `<div class="otk-run" style="animation-duration:${Math.max(30, Math.round(items.length * 4.5))}s"><div class="otk-set">${one}</div><div class="otk-set" aria-hidden="true">${one}</div></div>`;
  box.classList.remove('hide');
}
function otkTick() {
  if (otkAllowed() && !PTG.ob && !OTK.asked && typeof ptLoadGates === 'function') { OTK.asked = true; ptLoadGates(false, true).then(otkRender, () => {}); }
  otkRender();
}
/* Not in the test harnesses, which have no real page. */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && typeof setInterval === 'function') {
  setTimeout(otkTick, 4000); setInterval(otkTick, 60000);
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-otkno]');
    if (!b) return;
    const no = b.dataset.otkno;
    showTab('ord');
    setTimeout(() => { const q = $('odQ'); if (q) { q.value = no; q.dispatchEvent(new Event('input', { bubbles: true })); } }, 300);
  });
}
