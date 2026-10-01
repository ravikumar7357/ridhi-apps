/* ================= MULTI-SELECT FILTER =================
 *
 * Excel-style: a button that opens a searchable checklist. Several values at once, and "none ticked"
 * means "all" — so the filter starts out of the way and only ever narrows.
 *
 * Built rather than using <select multiple>, which needs ctrl-click to add a second value and shows
 * a fixed handful of rows. With three hundred sub-categories that is not a filter, it is a puzzle.
 */
const MS = {};

function msInit(id, label, opts) {
  MS[id] = { label, opts: opts || [], sel: new Set(), open: false };
  const el = $(id);
  el.innerHTML = '<button type="button" class="ms-btn"></button>'
    + '<div class="ms-panel hide">'
    + '<input class="ms-search" placeholder="Search…">'
    + '<div class="ms-acts"><button type="button" class="ghost ms-all">All</button>'
    + '<button type="button" class="ghost ms-none">None</button></div>'
    + '<div class="ms-list"></div></div>';
  el.querySelector('.ms-btn').onclick = e => { e.stopPropagation(); msToggle(id); };
  el.querySelector('.ms-search').oninput = () => msPaint(id);
  el.querySelector('.ms-all').onclick = () => { MS[id].sel = new Set(); msPaint(id); msChanged(id); };
  el.querySelector('.ms-none').onclick = () => { MS[id].sel = new Set(MS[id].opts); msPaint(id); msChanged(id); };
  // Clicks inside the panel must not reach the document handler that closes it.
  el.querySelector('.ms-panel').onclick = e => e.stopPropagation();
  msPaint(id);
}

function msToggle(id, force) {
  const open = force != null ? force : !MS[id].open;
  // One open at a time — two panels overlapping is unreadable, and closing them by hand is a chore.
  Object.keys(MS).forEach(k => { MS[k].open = false; $(k).querySelector('.ms-panel').classList.add('hide'); });
  MS[id].open = open;
  $(id).querySelector('.ms-panel').classList.toggle('hide', !open);
  if (open) { const q = $(id).querySelector('.ms-search'); q.value = ''; msPaint(id); q.focus(); }
}
document.addEventListener('click', () => Object.keys(MS).forEach(k => {
  if (MS[k].open) { MS[k].open = false; $(k).querySelector('.ms-panel').classList.add('hide'); }
}));

function msPaint(id) {
  const m = MS[id], el = $(id);
  const n = m.sel.size;
  const btn = el.querySelector('.ms-btn');
  // The button says what is chosen, not just "3 selected" — one pick is the common case and its
  // name fits, so read the toolbar and you know what you are looking at.
  btn.textContent = !n ? `All ${m.label}` : n === 1 ? [...m.sel][0] : `${n} of ${m.opts.length} ${m.label}`;
  btn.classList.toggle('on', !!n);
  btn.title = n ? [...m.sel].sort().join(', ') : `All ${m.label}`;
  const q = (el.querySelector('.ms-search').value || '').trim().toLowerCase();
  const list = m.opts.filter(o => !q || o.toLowerCase().includes(q));
  el.querySelector('.ms-list').innerHTML = list.length
    ? list.map(o => '<label class="ms-opt"><input type="checkbox" data-v="' + esc(o) + '"'
        + (m.sel.has(o) ? ' checked' : '') + '><span>' + esc(o) + '</span></label>').join('')
    : '<div class="muted" style="padding:6px">Nothing matches.</div>';
  el.querySelectorAll('.ms-list input').forEach(cb => {
    cb.onchange = () => { cb.checked ? m.sel.add(cb.dataset.v) : m.sel.delete(cb.dataset.v); msPaint(id); msChanged(id); };
  });
}

function msChanged(id) { if (MS[id].onChange) MS[id].onChange(); }
function msFill(id, vals, label) {
  const m = MS[id];
  m.opts = [...new Set(vals.map(v => (v == null ? '' : String(v).trim())).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  // A value that no longer exists in the data is dropped, so a stale tick cannot silently filter
  // everything away.
  m.sel = new Set([...m.sel].filter(v => m.opts.includes(v)));
  m.sig = null;                 // the list was replaced wholesale — let msRefine draw it again
  if (label) m.label = label;
  msPaint(id);
}
/**
 * Narrow a picker's list to the values still REACHABLE under the other filters.
 *
 * Two things it deliberately does NOT do, both of which msFill does:
 *
 *   It never prunes the selection. Here a value going missing means "the rest of the filters exclude
 *   it right now", not "it has left the data" — dropping the tick would change what is on screen as
 *   a side effect of redrawing a dropdown.
 *
 *   It keeps every TICKED value in the list even when nothing reachable carries it, because a tick
 *   that cannot be seen cannot be undone, and the filter would be stuck with no way back.
 *
 * Repaints only when the list actually changed. This runs on every render, and rebuilding three
 * hundred checkboxes each time is the exact cost that msFill's signature check exists to avoid.
 */
function msRefine(id, vals) {
  const m = MS[id];
  if (!m) return;
  const opts = [...new Set(vals.map(v => (v == null ? '' : String(v).trim())).filter(Boolean).concat([...m.sel]))]
    .sort((a, b) => a.localeCompare(b));
  // Joined on a control character no sub-category can contain: on a comma, ["a,b"] and
  // ["a","b"] would look like the same list and the repaint would be skipped.
  const sig = opts.join("\u0001");
  if (sig === m.sig) return;
  m.sig = sig; m.opts = opts;
  msPaint(id);
}
/** Chosen values. EMPTY MEANS ALL — the caller never has to special-case "nothing ticked". */
const msVals = id => (MS[id] ? [...MS[id].sel] : []);
const msHas = (id, v) => { const m = MS[id]; return !m || !m.sel.size || m.sel.has(String(v || '')); };
function msSet(id, arr) { if (MS[id]) { MS[id].sel = new Set((arr || []).filter(Boolean)); msPaint(id); } }
function msClearAll() { Object.keys(MS).forEach(k => { MS[k].sel = new Set(); msPaint(k); }); }

msInit('rCat', 'categories', ['A', 'B', 'C', 'D']);
msInit('rSubcat', 'sub-categories', []);
msInit('rColor', 'colors', []);
msInit('rStatus', 'statuses', []);
msInit('rSend', 'send modes', ['Air+Sea', 'Air', 'Sea', 'AWD', 'OK', 'Stopped']);
msInit('arSub', 'articles', []);
MS['arSub'].onChange = () => renderArticle();
['rCat', 'rSubcat', 'rColor', 'rStatus', 'rSend'].forEach(id => { MS[id].onChange = () => renderRepl(); });

function fillReplFilters(brands) {
  const rows = brands.flatMap(b => REPL[b]?.rows || []);
  // The option lists only change when the data/brand changes — skip the (DOM-rebuilding) work on a
  // plain re-render (sort, status edit, India-stock load), which is most renders.
  const sig = brands.join(',') + ':' + rows.length;
  if (sig === FILTERS_SIG) return;
  FILTERS_SIG = sig;
  msFill('rSubcat', rows.map(r => r.subcat));
  msFill('rColor', rows.map(r => r.color));
  msFill('rStatus', rows.map(r => r.status));
}

/* ---------- rolling month-by-month forecast (On Hand → Proj → Excess) ---------- */
// Rolling forecast from the CURRENT month onward, exactly as the user works it by hand:
//
//   CURRENT month On Hand = Warehouse + Inbound Receiving + this month's "Rec." + AWD Available
//   LATER   month On Hand = max(0, previous month's Excess) + that month's "Rec."
//                           + AWD Transit, but ONLY in the month it is due to land
//   Proj   = Avg/day × days           (current month = the days still LEFT in it; later = whole month)
//   Excess = On Hand − Proj           (negative = you run out during that month)
//
// AWD Transit is deliberately NOT part of the current month's on-hand — it is not in the warehouse yet;
// it is credited to whichever month its ETA falls in (inflow.awdDay = days until it arrives).
const FC_DEFAULT_MONTHS = 9;   // Jul '26 → Mar '27; the user picks the horizon in the toolbar
const fcMonths = () => Number(($('rHorizon') || {}).value) || FC_DEFAULT_MONTHS;
const MON_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
let FC_PLAN = [];
// The forecast is the same for a SKU until the snapshot, the horizon or a manual projection changes —
// so it is cached across renders. Without this, every sort / filter / status edit recomputed
// 4.7k rows × N months (~140ms of the render). PROJ_VER is bumped whenever an override is written.
let FC_CACHE = new Map(), FC_CACHE_SIG = '', PROJ_VER = 0;
/* Bumped by hand wherever something the row walk reads is edited in place — a priority, a Req. Qty.
 * Counting the keys of those maps would miss a value being CHANGED, which is the common case. */
let R_VER = 0;
/* The finished rows, and the signature of everything they were worked out from. */
let R_ROWS_CACHE = { sig: '', rows: null, usHidden: 0 };
function fcFor(r) {
  const k = String(r.sku || '').trim().toUpperCase();
  let v = FC_CACHE.get(k);
  if (v === undefined) { v = replForecast(r, FC_PLAN); FC_CACHE.set(k, v); }
  return v;
}
// The sheet's monthly "Rec." headers are free text ("Jul '26", "Jul-26", "July 2026"…) — parse them to
// {m,y} so a forecast month finds its receipts column whatever the sheet happens to call it.
function parseMonthLabel(s) {
  const t = String(s || '').toLowerCase();
  const m = MON_ABBR.findIndex(a => t.includes(a));
  if (m < 0) return null;
  const ym = t.match(/'?(\d{2,4})\b/);
  let y = ym ? Number(ym[1]) : null;
  if (y != null && y < 100) y += 2000;
  return { m, y };
}
function buildFcPlan(recCols) {
  const now = new Date(), plan = [];
  const parsed = (recCols || []).map(c => ({ c, p: parseMonthLabel(c) }));
  for (let i = 0, n = fcMonths(); i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const y = d.getFullYear(), m = d.getMonth();
    const dim = new Date(y, m + 1, 0).getDate();
    const days = i === 0 ? Math.max(0, dim - now.getDate() + 1) : dim;   // current month → days left
    const hit = parsed.find(x => x.p && x.p.m === m && (x.p.y == null || x.p.y === y));
    plan.push({ y, m, days, dim, partial: i === 0, recCol: hit ? hit.c : null,
      key: y + '-' + String(m + 1).padStart(2, '0'),          // 'YYYY-MM' — the manual-override key
      label: MON_ABBR[m].charAt(0).toUpperCase() + MON_ABBR[m].slice(1) + " '" + String(y).slice(2) });
  }
  return plan;
}
// Which forecast month an AWD-transit shipment lands in: today + inflow.awdDay. Unknown ETA → the
// next month (it is in transit, so it is certainly not sellable this month). -1 = lands outside the
// horizon, so it is never credited.
function awdArrivalIdx(r, plan) {
  const qty = r.awdTransit || 0;
  if (qty <= 0 || !plan.length) return -1;
  const day = r.inflow ? r.inflow.awdDay : null;
  if (day == null) return Math.min(1, plan.length - 1);
  const arr = new Date(); arr.setDate(arr.getDate() + Number(day));
  const i = plan.findIndex(p => p.y === arr.getFullYear() && p.m === arr.getMonth());
  if (i >= 0) return i;
  // ETA already passed (or before the horizon starts) → treat as landing now.
  return (arr.getFullYear() < plan[0].y || (arr.getFullYear() === plan[0].y && arr.getMonth() < plan[0].m)) ? 0 : -1;
}
// A manually-typed Proj for one SKU in one month, or null. Overrides live in repl/prodstatus
// .projOverride keyed "SKU|YYYY-MM", so they are independent of the sheet snapshot and survive
// "Refresh from sheet" — they only change when the user edits or clears them.
function projOvrOf(sku, monthKey) {
  const v = PROJ_OVR[String(sku).trim().toUpperCase() + '|' + monthKey];
  return (v == null || v === '') ? null : Number(v);
}
function replForecast(r, plan) {
  // A Discontinued / Use-In-Mix SKU is not being sold on any more, so it gets NO forward projection —
  // the same rule replReq() and the "Stopped" Send pill already follow. Its stock simply sits, so On
  // Hand carries forward untouched and Excess = On Hand. Determined with isStopped() (not r.stopped)
  // so it is identical whether the caller passes a raw snapshot row or one applyStatus() has processed —
  // both share the FC_CACHE. A MANUAL projection still wins: an explicit number beats the rule.
  const ads = isStopped(r) ? 0 : (r.avgSale || 0);
  const rec = m => (m && r.rec ? (Number(r.rec[m]) || 0) : 0);
  const awdIdx = awdArrivalIdx(r, plan), awdQty = r.awdTransit || 0;
  let carry = 0;
  return plan.map((p, i) => {
    // Current month starts from what is actually in hand + what lands this month; later months start
    // from whatever survived the previous month.
    let inc = i === 0
      ? (r.warehouse || 0) + (r.inbReceiving || 0) + rec(p.recCol) + (r.awdAvail || 0)
      : rec(p.recCol);
    if (i === awdIdx) inc += awdQty;                 // AWD transit counts only in its arrival month
    const oh = Math.max(0, carry) + inc;             // a shortage does not carry a negative forward
    // A manual Proj wins over the calculated one — and because Excess and every later month are
    // carried from it, one override re-flows the whole rest of the forecast for that SKU.
    const ovr = projOvrOf(r.sku, p.key);
    const auto = Math.round(ads * p.days);
    const proj = ovr != null && isFinite(ovr) ? ovr : auto;
    const exc = oh - proj;
    carry = exc;
    return { oh, proj, exc, inc, auto, manual: ovr != null && isFinite(ovr), awd: i === awdIdx ? awdQty : 0 };
  });
}

/**
 * Where each month's shortfall is actually going to come from.
 *
 * The per-month Excess columns say HOW SHORT you are. They do not say whether that shortage is a
 * problem, because the answer usually already exists: units sitting in India, or a batch a factory
 * is halfway through. This walks the horizon once and settles each month's gap in the order the
 * money was already spent —
 *   1. India stock   (paid for, sitting there — nothing should be made while it exists)
 *   2. In production (committed; the money goes whether the units turn out to be needed or not)
 *   3. Fresh production (the only figure on the row that is still a DECISION)
 *
 * Both balances CARRY between months, which is exactly what the Excess columns cannot express:
 * stock left over in August is still there in September.
 */
let R_PMAP = {};                     // in-production units per SKU — rebuilt once per render
let SUPPLY_COLS = true;              // the toolbar toggle, read once per render
function supplyPlan(r) {
  const key = String(r.sku || '').trim().toUpperCase();
  const p = R_PMAP[key] || { qty: 0, ready: '' };
  const arrival = inProdArrivalMonth(p.ready);
  let india = indiaNum(key), prod = 0;
  const m = [];
  for (let i = 0; i < FC_PLAN.length; i++) {
    if (i === arrival) prod += p.qty;            // the batch can be sold from this month on
    const need = Math.max(0, -((r._fc[i] || {}).exc || 0));
    const fromIndia = Math.min(need, india); india -= fromIndia;
    let rem = need - fromIndia;
    const needProd = rem;                        // what PRODUCTION has to supply, after India stock
    const fromProd = Math.min(rem, prod); prod -= fromProd; rem -= fromProd;
    /* SHORT BECAUSE NOTHING IS BEING MADE, or short because what IS being made lands too late?
     *
     * These are different problems with different answers, and the column used to give the same one
     * to both: "produce this much". Telling somebody to open an order for 85 units while 2,483 of the
     * same SKU sit on a machine is how the same goods get paid for twice — and the real fix, chasing
     * that batch or flying part of it, never gets considered.
     *
     * So a shortfall that a batch STILL TO ARRIVE could cover is counted as LATE, not as new
     * production. Only what no existing batch can ever cover is a new order. */
    const comingLater = (arrival < 0 || arrival > i) ? p.qty : 0;
    const late = Math.min(rem, comingLater);
    rem -= late;
    /* Three different questions, kept apart:
     *   needProd  what this month needs OUT OF PRODUCTION at all (shortfall minus India stock)
     *   covered   how much of that a batch already on a machine will cover
     *   fresh     what is left, and therefore what somebody has to start making
     * India stock and existing batches are both RUNNING BALANCES down the months — whatever a month
     * does not use stays available to the next one, which is the carry-forward. */
    m.push({ india: fromIndia, needProd: needProd, prod: fromProd, late: late, fresh: rem });
  }
  return { m, indiaLeft: india, prodLeft: prod, prodQty: p.qty, ready: p.ready, arrival };
}

/* ================= MOM — minutes of meeting =================
 *
 * A running note per SKU, added to during a meeting and never overwritten. Same shape and the same
 * document as the Production log this app already keeps, so there is one way to write a dated note
 * here and one way to read it back.
 *
 * APPEND ONLY, on purpose. The value of a meeting note is the trail: what was decided in June still
 * explains what happened in August. Editing in place would leave the row looking decided and the
 * reasoning gone.
 */
const momLog = sku => MOM[skuKey(sku)] || [];
const momLatest = sku => { const l = momLog(sku); return l.length ? l[0] : null; };

function momCellHtml(sku, esc) {
  const e = momLatest(sku);
  const n = momLog(sku).length;
  return (e
    ? `<div class="prodlog-date">${esc(e.d)}${e.by ? ' · ' + esc(String(e.by).split('@')[0]) : ''}</div>`
      + `<div class="prodlog-latest">${esc(e.note)}</div>`
      + (n > 1 ? `<div class="muted" style="font-size:10px">+${n - 1} earlier</div>` : '')
    : '<span class="muted" style="font-size:12px">—</span>')
    + `<br><button class="mom-add" data-sku="${esc(sku)}">${e ? '+ Note' : '+ MOM'}</button>`;
}

let MOM_SKU = null;
function openMomModal(sku) {
  MOM_SKU = skuKey(sku);
  $('momModalSku').textContent = sku;
  $('momInput').value = '';
  renderMomLog();
  $('momModal').classList.remove('hide');
  $('momInput').focus();
}
function renderMomLog() {
  const log = momLog(MOM_SKU);
  $('momLogList').innerHTML = log.length
    ? log.map(e => `<div class="log-entry"><div class="ld">${esc(e.d)}`
        + `${e.by ? ' · ' + esc(e.by) : ''}</div>${esc(e.note)}</div>`).join('')
    : '<div class="muted" style="font-size:13px;padding:4px">No notes yet.</div>';
}
function closeMomModal() { $('momModal').classList.add('hide'); MOM_SKU = null; }
$('momCancel').onclick = closeMomModal;
$('momModal').addEventListener('click', e => { if (e.target === $('momModal')) closeMomModal(); });
$('momSave').onclick = async () => {
  const note = $('momInput').value.trim().slice(0, 600);
  if (!note || !MOM_SKU) return;
  const sku = MOM_SKU;
  // Date AND time: two notes from the same meeting are common, and a date alone puts them in no
  // order at all. Who wrote it matters as much as when — a decision is somebody's.
  const now = new Date();
  const stamp = now.toLocaleDateString('en-CA') + ' ' + now.toTimeString().slice(0, 5);
  (MOM[sku] || (MOM[sku] = [])).unshift({ d: stamp, note, by: ME.email });
  $('momInput').value = '';
  renderMomLog();
  // Repaint just this cell — a full re-render would close the modal under the person using it.
  const cell = $('arTable').querySelector(`.mom-cell[data-sku="${CSS.escape(sku)}"]`)
    || [...$('arTable').querySelectorAll('.mom-cell')].find(c => skuKey(c.dataset.sku) === sku);
  if (cell) cell.innerHTML = momCellHtml(cell.dataset.sku, esc);
  try { await setDoc(doc(db, 'repl', 'prodstatus'), { momlog: { [sku]: MOM[sku] } }, { merge: true }); }
  catch (err) { $('arMsg').textContent = 'Save failed: ' + (err.message || err); }
};
$('arTable').addEventListener('click', e => {
  const btn = e.target.closest('.mom-add'); if (!btn) return;
  openMomModal(btn.dataset.sku);
});

