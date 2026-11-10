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
/* PLAIN LINE (Stage 0 of the alert list, docs/data-reduction/ALERT-LIST-PLAN.md). With the switch on, the strip never
 * downloads the registers (about 11 MB) by itself. A page that already has them (the Order Console, a factory screen)
 * shows the strip as before; a page without them shows one still line that opens the Order Console.
 *   Switch: localStorage tickerPlain '0' = off on this device whatever the flag says, '1' = on, otherwise the last answer
 *   of the Firestore flag config/flags.tickerPlain (read in core/auth.js's single flags read, kept in tpFlagLast for the
 *   NEXT page load). Off by default. Always off in the test harnesses. */
function otkPlainOn() {
  try {
    const s = localStorage.getItem('tickerPlain');
    if (s === '0') return false;
    if (typeof AUDIT === 'undefined' || !AUDIT.on) return false;
    if (s === '1') return true;
    return localStorage.getItem('tpFlagLast') === '1';
  } catch (e) { return false; }
}
/** Keep the flag's last answer for the next page load. */
function otkSaveFlag(on) {
  try { if (on) localStorage.setItem('tpFlagLast', '1'); else localStorage.removeItem('tpFlagLast'); } catch (e) { /* no storage: stays off */ }
}
const OTK_PLAIN = '<button type="button" class="otk-it otk-sum otk-plain" data-otkplain="1" title="Open the Order Console"><b>Pending and critical orders:</b> <span>open the Order Console</span></button>';
const otkDays =(a, b) => { const p = s => { const q = String(s).split('-').map(Number); return Date.UTC(q[0], q[1] - 1, q[2]); }; return Math.round((p(b) - p(a)) / 864e5); };

/** The strip's items: critical lines first (most late first), then the pending totals. Each open line is an entry of the
 *  one shared rule (oalEntry, orders/order-alerts.js); the items are then worked out from the entries (otkItemsFrom). */
function otkItems() {
  const today = dToday(), soDue = typeof SOX !== 'undefined' && SOX.rows ? ordDueIndex() : null;
  return otkItemsFrom(ordLines().map(l => oalEntry(l, soDue)).filter(Boolean), today);
}
/** The same items from a list of entries (today's lines, or the alert list's). */
function otkItemsFrom(entries, today) {
  const crit = [], per = new Map();
  let pcs = 0;
  entries.forEach(l => {
    const owe = Math.max(0, l.qty - l.pr - l.fs);
    const ch = OTK_CHANNEL[l.ch] || 'Other';
    const e = per.get(ch) || per.set(ch, { lines: 0, pcs: 0 }).get(ch); e.lines++; e.pcs += owe; pcs += owe;
    if (!l.due) return;
    const d = otkDays(l.due, today);   // + late, 0 today, -1 tomorrow
    if (d < -1) return;
    crit.push({ no: l.no, d, what: l.what, qty: l.qty });
  });
  crit.sort((a, b) => b.d - a.d || a.no.localeCompare(b.no));
  const out = [{ kind: 'sum', txt: `Pending: ${nf(entries.length)} lines · ${nf(pcs)} pcs`, sub: [...per.entries()].sort((a, b) => b[1].lines - a[1].lines).map(([k, v]) => `${k} ${nf(v.lines)}`).join(' · ') }];
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
  if (!otkAllowed()) { box.classList.add('hide'); return; }
  if (!ptHas(PTG_ALL)) {
    if (!otkPlainOn()) { box.classList.add('hide'); return; }
    if (OTK.sig !== OTK_PLAIN) { OTK.sig = OTK_PLAIN; box.innerHTML = OTK_PLAIN; }
    box.classList.remove('hide');
    return;
  }
  let items;
  try { items = otkItems(); } catch (e) { box.classList.add('hide'); return; }
  const one = items.map(otkItemHtml).join('<span class="otk-dot" aria-hidden="true"></span>') + '<span class="otk-dot" aria-hidden="true"></span>';
  if (one === OTK.sig) { box.classList.remove('hide'); return; }
  OTK.sig = one;
  /* Two copies side by side, moved left by one copy's width — the loop has no seam. Speed follows the length. */
  box.innerHTML = `<div class="otk-run" style="animation-duration:${Math.max(70, Math.round(items.length * 10))}s"><div class="otk-set">${one}</div><div class="otk-set" aria-hidden="true">${one}</div></div>`;
  box.classList.remove('hide');
}
function otkTick() {
  if (otkAllowed() && !ptHas(PTG_ALL) && !OTK.asked && !otkPlainOn() && typeof ptNeed === 'function') { OTK.asked = true; ptNeed(PTG_ALL, { light: true, why: 'order strip' }).then(otkRender, () => {}); }
  otkRender();
}
/* Not in the test harnesses, which have no real page. */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && typeof setInterval === 'function') {
  setTimeout(otkTick, 4000); setInterval(otkTick, 60000);
  document.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('[data-otkplain]')) { showTab('ord'); return; }
    const b = e.target.closest && e.target.closest('[data-otkno]');
    if (!b) return;
    const no = b.dataset.otkno;
    showTab('ord');
    setTimeout(() => { const q = $('odQ'); if (q) { q.value = no; q.dispatchEvent(new Event('input', { bubbles: true })); } }, 300);
  });
}
