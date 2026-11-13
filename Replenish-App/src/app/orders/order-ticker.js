/* ===================== ORDER TICKER (Ravi, 31 Oct 2026) =====================
 * "mujhe app me aisa chalti hui line chahiye jisme pending orders critical orders show hote rahe": a running strip under
 * the page title, like the offer strip on the Ridhi website. It reads the Order Console's own open lines (ordLines), so
 * it says nothing the console does not.
 *   Critical   an open line past its due date, or due today / tomorrow. Due = the sales order's delivery date, or for a
 *              Shopify / online line 5 working days from when it opened (the console's mtoDue).
 *   Pending    open lines and the pieces still owed, per channel.
 * A click on an order opens the Order Console searched to it; hovering stops the strip so it can be read. */
const OTK = { at: 0, sig: '', asked: false, list: { state: 'new', map: null, at: 0, busy: false, stop: false, said: '' }, own: new Map() };
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
/* ALERT LIST (Stage 2 of the alert list, docs/data-reduction/ALERT-LIST-PLAN.md). With the switch alertList on, the strip reads
 * its lines from the small list pt_orderAlerts (built by orders/order-alerts.js) through a live copy, instead of downloading the
 * registers (about 11 MB). The strip looks and behaves exactly as before, with one more small item: when the list was last checked.
 *   Switch: localStorage alertList '0' = off on this device whatever the flag says, '1' = on, otherwise the last answer of the
 *   Firestore flag config/flags.alertList (read in core/auth.js's single flags read, kept in alListFlagLast for the NEXT page load).
 *   Off by default. Always off for vendors and in the test harnesses. Switch OFF: nothing here runs and the strip is as it was.
 *   If the list is missing, cannot be read (the rule is not deployed yet), has no version, is of an older rule version, or was
 *   never checked, the strip falls back to what it does with the switch off: it loads the registers and draws from them. It never
 *   shows the still line (OTK_PLAIN) while this switch is on. */
const OTK_LIST_NODE = 'pt_orderAlerts', OTK_OWN_MS = 20000;
function otkListOn() {
  try {
    const s = localStorage.getItem('alertList');
    if (s === '0') return false;
    if (typeof AUDIT === 'undefined' || !AUDIT.on) return false;
    if (typeof spIsVendor === 'function' && spIsVendor()) return false;
    if (typeof NAV_IS_VENDOR !== 'undefined' && NAV_IS_VENDOR) return false;
    if (s === '1') return true;
    return localStorage.getItem('alListFlagLast') === '1';
  } catch (e) { return false; }
}
/** Keep the flag's last answer for the next page load. */
function otkListSaveFlag(on) {
  try { if (on) localStorage.setItem('alListFlagLast', '1'); else localStorage.removeItem('alListFlagLast'); } catch (e) { /* no storage: stays off */ }
}
/** Read the list (from the live copy: one listener, then only small changes arrive). ok:false says why not; stop = do not ask again. */
async function otkListRead() {
  let raw;
  try { raw = await ptGet(OTK_LIST_NODE); }
  catch (e) { const m = String((e && e.message) || e); return { ok: false, why: 'the list cannot be read (' + m.slice(0, 100) + ')', stop: /refused the read|permission|\b40[13]\b/i.test(m) }; }
  if (!raw || typeof raw !== 'object') return { ok: false, why: 'the list is not there yet' };
  if (raw.v == null) return { ok: false, why: 'the list has no version yet' };
  if (typeof OAL_V !== 'undefined' && raw.v !== OAL_V) return { ok: false, why: 'the list is of another rule version (' + raw.v + ')' };
  const at = +raw.at;
  if (!(at > 0)) return { ok: false, why: 'the list has never been checked' };
  const l = raw.l || {}, map = new Map();
  Object.keys(l).forEach(k => { if (l[k] && typeof l[k] === 'object') map.set(k, l[k]); });
  return { ok: true, map, at };
}
/** This page's own just-written changes to the list (called by orders/order-alerts.js after its write), so this page's strip moves at once. */
function otkOwnWrite(updates) {
  if (!otkListOn()) return;
  try {
    const t = Date.now(), pre = OTK_LIST_NODE + '/l/';
    Object.keys(updates || {}).forEach(p => { if (p.indexOf(pre) === 0) OTK.own.set(p.slice(pre.length), { e: updates[p] || null, t }); });
    if (OTK.list.state === 'ready' && otkListOn()) { const box = $('ordTicker'); if (box && otkAllowed()) { otkDraw(box, otkListItems()); box.classList.remove('hide'); } }   // list only: never the registers path
  } catch (e) { /* the strip is never in the way of a save */ }
}
/** The list's entries as the strip sees them: the live copy, with this page's own writes of the last 20 seconds laid over it. */
function otkListEntries() {
  const m = new Map(OTK.list.map), now = Date.now();
  OTK.own.forEach((o, k) => { if (now - o.t > OTK_OWN_MS) OTK.own.delete(k); else if (o.e) m.set(k, o.e); else m.delete(k); });
  return [...m.values()];
}
/** The strip's items from the list, plus the small "checked at" item. */
function otkListItems() {
  const items = otkItemsFrom(otkListEntries(), dToday()), d = new Date(OTK.list.at), p = n => String(n).padStart(2, '0');
  const day = d.toDateString() === new Date().toDateString() ? '' : d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ';
  items.push({ kind: 'stamp', txt: 'checked at ' + day + p(d.getHours()) + ':' + p(d.getMinutes()) });
  return items;
}
/** Ask for the registers the way the strip does with the switch off (once), when the list cannot be used. */
function otkAskRegisters() {
  if (otkAllowed() && !ptHas(PTG_ALL) && !OTK.asked && typeof ptNeed === 'function') { OTK.asked = true; ptNeed(PTG_ALL, { light: true, why: 'order strip' }).then(otkRender, () => {}); }
}
function otkListTick() {
  const L = OTK.list;
  if (L.busy) return;
  if (L.state === 'bad' && L.stop) { otkAskRegisters(); otkRender(); return; }
  L.busy = true;
  otkListRead().then(r => {
    L.busy = false;
    if (r.ok) { L.state = 'ready'; L.map = r.map; L.at = r.at; L.said = ''; }
    else {
      if (L.said !== r.why) { L.said = r.why; try { console.warn('[order strip] ' + r.why + ' - using the registers as before'); } catch (e) { /* no console */ } }
      if (L.state !== 'ready') { L.state = 'bad'; L.stop = !!r.stop; }   // a list that was good keeps showing through a failed read
    }
    if (L.state !== 'ready') otkAskRegisters();
    otkRender();
  }, () => { L.busy = false; });
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
  if (x.kind === 'stamp') return `<span class="otk-it otk-sum otk-stamp"><b>${esc(x.txt)}</b></span>`;
  if (x.kind === 'sum') return `<span class="otk-it otk-sum"><b>${esc(x.txt)}</b>${x.sub ? ` <span>${esc(x.sub)}</span>` : ''}</span>`;
  return `<button type="button" class="otk-it otk-${x.kind}" data-otkno="${esc(x.no)}" title="Open ${esc(x.no)} in the Order Console"><em>${esc(x.tag)}</em>${esc(x.txt)}</button>`;
}

/** Draw (or hide) the strip. Redrawn only when what it says changes, so the scroll does not jump back. */
function otkRender() {
  const box = $('ordTicker');
  if (!box) return;
  if (!otkAllowed()) { box.classList.add('hide'); return; }
  if (otkListOn()) {
    /* The list switch is on: the list when it is good; while it is still being asked, leave the strip as it is; when it is no
       good, today's strip from the registers (and never the still line). */
    if (OTK.list.state === 'ready') { try { otkDraw(box, otkListItems()); } catch (e) { box.classList.add('hide'); } return; }
    if (OTK.list.state !== 'bad') return;
    if (!ptHas(PTG_ALL)) { box.classList.add('hide'); return; }
  } else if (!ptHas(PTG_ALL)) {
    if (!otkPlainOn()) { box.classList.add('hide'); return; }
    if (OTK.sig !== OTK_PLAIN) { OTK.sig = OTK_PLAIN; box.innerHTML = OTK_PLAIN; }
    box.classList.remove('hide');
    return;
  }
  let items;
  try { items = otkItems(); } catch (e) { box.classList.add('hide'); return; }
  otkDraw(box, items);
}
/** Put the items in the strip. */
function otkDraw(box, items) {
  const dot = '<span class="otk-dot" aria-hidden="true"></span>', stamp = items.find(x => x.kind === 'stamp');
  const one = items.map(otkItemHtml).join(dot) + dot;
  /* The 'checked at' time is kept out of what decides a redraw: when only it changes, its text is changed in place and the strip keeps running. */
  const sig = items.filter(x => x.kind !== 'stamp').map(otkItemHtml).join(dot) + dot;
  if (sig === OTK.sig) {
    if (stamp && box.querySelectorAll) box.querySelectorAll('.otk-stamp b').forEach(b => { b.textContent = stamp.txt; });
    box.classList.remove('hide'); return;
  }
  OTK.sig = sig;
  /* Two copies side by side, moved left by one copy's width — the loop has no seam. Speed follows the length. */
  box.innerHTML = `<div class="otk-run" style="animation-duration:${Math.max(70, Math.round(items.length * 10))}s"><div class="otk-set">${one}</div><div class="otk-set" aria-hidden="true">${one}</div></div>`;
  box.classList.remove('hide');
}
function otkTick() {
  if (otkListOn() && otkAllowed()) { otkListTick(); return; }
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
