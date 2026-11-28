/* ================= FBA DISPATCH: LISTS FIRST, ACCEPT ALL, PHONE CARDS =================
 * Business rule (28 Nov, Ravi): on FBA Dispatch the FBA team starts with the FBA lists waiting to be packed and shipped, as big
 * cards; the older dispatches (thousands accepted and never marked shipped) sit below them.
 *   - Waiting lists: account, Air / Sea / AWD, SKUs, pieces, how much is packed, who made it and when, with Scan to pack, Ship
 *     and Cancel. Lists shipped in the past 30 days are folded below, each with Undo ship.
 *   - One main button, "Accept all N waiting": every waiting dispatch the filters leave (status, dates, search, brand, account,
 *     age), not only the lines the table draws. Accept ticked, Ship ticked, Ship from Excel, Return ticked, Pack a list and
 *     Export sit under "More"; Refresh stays beside it.
 *   - Under 760px (a phone) the dispatches are cards, not the wide table.
 *
 * ACCEPT ALL SAVES IN BATCHES of FBR_ACCEPT_BATCH, each through the ordinary accept (fbaAcceptStep): every dispatch is read
 * again first and one already accepted, shipped or returned is left alone, so pressing twice, or again after a dropped
 * connection, never accepts anything twice.
 *
 * WHEN SOMETHING GOES WRONG:
 *   loud, to the user — a batch that cannot be saved stops the run; the box says how many were accepted before it stopped and that
 *   the rest are still waiting; the same button carries on. The reason is also written to the console.
 *   There is no quiet fallback here.
 *
 * BEHIND SWITCH storeAlloc (fg-store-alloc.js). Off: none of this shows and the screen is as it was. */
const FBR_ACCEPT_BATCH = 100;   // dispatches read and saved at a time by Accept all
const FBR_PHONE_QUERY = '(max-width:760px)';
const FBR_SKUS_SHOWN = 6;       // SKU codes named on a list's card; the rest are counted
const FBR_LANE_PILL = { air: 'pill-air', sea: 'pill-sea', awd: 'pill-low' };
/** The buttons that sit under "More" while the redesign is on. Refresh stays out. */
const FBR_MOVED = ['fbaPackBtn', 'fbaAccept', 'fbaShip', 'fbaShipXl', 'fbaShipFile', 'fbaReturn', 'fbaExport'];

let FBR = { shippedOpen: false, accepting: false, under: false };

const fbrNarrow = () => (typeof mobOn === 'function' && mobOn())
  || (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(FBR_PHONE_QUERY).matches);

/* ---- the FBA lists, as cards ---- */
const fbrPieces = (list, of) => Object.values(list.lines || {}).reduce((t, l) => t + fgiNum(l[of]), 0);
const fbrLanePill = lane => `<span class="pill ${FBR_LANE_PILL[lane] || ''}">${esc(FBLV_LANE_NAMES[lane] || lane)}</span>`;
const fbrMain = (action, id, label) => `<button type="button" data-fbl="${action}" data-fbl-id="${esc(id)}">${label}</button>`;

/** How far a waiting list is packed: { cls: the badge colour, text }. */
function fbrPackState(list) {
  const qty = fbrPieces(list, 'qty'), packed = fbrPieces(list, 'packed');
  if (list.status === 'shipping') return { cls: 'fbr-acc', text: 'Being shipped now' };
  if (list.status === 'packed') return { cls: 'pill-ok', text: `Packed · ${nf(packed)} of ${nf(qty)}` };
  if (packed > 0) return { cls: 'pill-low', text: `Packing · ${nf(packed)} of ${nf(qty)}` };
  return { cls: 'fbr-grey', text: 'Not packed yet' };
}

/** The SKU codes of a list, the first few with their pieces and a count of the rest. */
function fbrSkuText(lines) {
  const named = lines.slice(0, FBR_SKUS_SHOWN).map(l => `${esc(l.sku)} ×${nf(l.qty)}`).join(', ');
  return named + (lines.length > FBR_SKUS_SHOWN ? ` … +${nf(lines.length - FBR_SKUS_SHOWN)} more` : '');
}

/** Scan to pack is the main button until the list is packed, then Ship is. */
function fbrWaitingButtons(id, list) {
  if (!fbaCan()) return '';
  const pack = fblvPackable(list) && packFbaMayPack(), ship = fblvShippable(list);
  return (pack ? (ship ? fblvButton('pack', id, 'Scan to pack') : fbrMain('pack', id, 'Scan to pack')) : '')
    + (ship ? fbrMain('ship', id, 'Ship') : '')
    + (fblvMayCancel(list) ? fblvButton('cancel', id, 'Cancel list') : '');
}

function fbrWaitingCard(id, list) {
  const lines = Object.values(list.lines || {}), pack = fbrPackState(list);
  return `<div class="fbr-list">
    <div class="fbr-list-top">${fbrLanePill(list.lane)}<b class="fbr-acct">${esc(list.account)}</b><span class="pill ${pack.cls}">${esc(pack.text)}</span></div>
    <div class="fbr-list-figs"><div><b>${nf(fbrPieces(list, 'qty'))}</b><small>pieces</small></div><div><b>${nf(lines.length)}</b><small>SKU(s)</small></div></div>
    <div class="fbr-list-skus">${fbrSkuText(lines)}</div>
    <div class="fbr-list-who muted">Made by ${esc(fblvWho(list.by))} · ${esc(ptDayWords(list.at))}</div>
    <div class="fbr-list-acts">${fbrWaitingButtons(id, list)}</div></div>`;
}

function fbrShippedCard(id, list) {
  const lines = Object.values(list.lines || {});
  return `<div class="fbr-list">
    <div class="fbr-list-top">${fbrLanePill(list.lane)}<b class="fbr-acct">${esc(list.account)}</b><span class="pill pill-ok">Shipped · ${esc(list.shipment)}</span></div>
    <div class="fbr-list-figs"><div><b>${nf(fbrPieces(list, 'shipped'))}</b><small>pieces shipped</small></div><div><b>${nf(lines.length)}</b><small>SKU(s)</small></div></div>
    <div class="fbr-list-who muted">Shipped ${esc(list.shipDate)} by ${esc(fblvWho(list.shippedBy))}</div>
    <div class="fbr-list-acts">${fbaCan() ? fblvButton('undo', id, 'Undo ship') : ''}</div></div>`;
}

function fbrShippedSection(shipped) {
  const open = FBR.shippedOpen;
  return `<div class="fbr-done"><button type="button" class="ghost" data-fbr-fold aria-expanded="${open}">${open ? '▾' : '▸'} `
    + `Shipped in the past ${FBLV_RECENT_DAYS} days (${nf(shipped.length)})</button>`
    + (open ? `<div class="fbr-lists">${shipped.map(([id, l]) => fbrShippedCard(id, l)).join('')}</div>` : '') + '</div>';
}

/** The whole "FBA lists" panel: waiting lists first, shipped ones folded below. waiting: [id, list] pairs. */
function fbrListsPanel(waiting) {
  const shipped = fblvRecentlyShipped();
  return `<div class="fbr-h"><h3>FBA lists waiting</h3><span class="pill ${waiting.length ? 'pill-low' : 'fbr-grey'}">${nf(waiting.length)}</span></div>`
    + fblvNoRightHtml(waiting)
    + (waiting.length ? `<div class="fbr-lists">${waiting.map(([id, l]) => fbrWaitingCard(id, l)).join('')}</div>`
      : '<div class="muted" style="margin-top:8px">No list is waiting. Tick SKUs on Finished Goods and press Make FBA list.</div>')
    + (shipped.length ? fbrShippedSection(shipped) : '');
}

function fbrListsClick(e) {
  if (!e.target.closest('[data-fbr-fold]')) return;
  FBR.shippedOpen = !FBR.shippedOpen;
  fblvRender();
}

/* ---- the top of the screen ---- */
/** The waiting dispatches the filters leave: all of them, not only the lines the table draws. */
const fbrWaiting = () => (FBA.shown || []).filter(x => x.s.st === 'waiting');

/** Called by renderFba while the redesign is on: the buttons under More, and the main button. view: { can }. */
function fbrToolbar(view) {
  $('paneFba').classList.add('fbr-on');
  if (!FBR.under) { FBR_MOVED.forEach(id => $('fbrMoreBody').appendChild($(id))); FBR.under = true; }
  const waiting = fbrWaiting();
  $('fbaBreak').classList.remove('hide');
  $('fbrMore').classList.remove('hide');
  $('fbrMoreLabel').textContent = FBA_PICK.size ? `More · ${nf(FBA_PICK.size)} ticked` : 'More';
  $('fbaAcceptAll').classList.toggle('hide', !(view.can && waiting.length));
  $('fbaAcceptAll').disabled = FBR.accepting;
  $('fbaAcceptAll').textContent = `Accept all ${nf(waiting.length)} waiting`;
}

/* ---- accept all ---- */
function fbrAcceptAllAsk() {
  if (!fbaCan()) return fblvSay('fbaMsg', 'Only the FBA team (the FBA Dispatch tab) can accept a dispatch.', true);
  const rows = fbrWaiting().map(x => x.r);
  if (!rows.length) return fblvSay('fbaMsg', 'No waiting dispatch matches the filters.', true);
  ptOpenDialog({
    title: 'Accept all waiting',
    subtitle: `${nf(rows.length)} dispatch(es) · ${nf(fbvSum(rows, r => fbaState(r).open))} piece(s)`,
    note: 'Every waiting dispatch the filters on the screen leave is accepted, including those below the lines drawn. Each is read again first; '
      + 'one somebody else has already accepted, shipped or returned is left alone. It is safe to press again if the connection drops.',
    saveLabel: `Accept ${nf(rows.length)}`,
    onSave: () => fbrAcceptRun(rows),
  });
}

/** The sentence after a run that stopped part-way. */
const fbrStoppedText = (saved, total, e) => `Accepted ${nf(saved)} of ${nf(total)} dispatch(es) before it stopped: ${e.message || e}. `
  + 'The rest are still waiting — press Accept again to carry on.';

/** Accept the dispatches in batches. Answers '' when done, else the sentence the box shows. */
async function fbrAcceptRun(rows) {
  if (!fbaCan()) return 'Only the FBA team (the FBA Dispatch tab) can accept a dispatch.';
  if (FBR.accepting) return 'Accepting is already running — wait for it to finish.';
  const waiting = rows.filter(r => fbaState(r).st === 'waiting');   // a second press leaves out what the first one saved
  const total = { saved: 0, pieces: 0, skipped: [] };
  let stopped = '';
  FBR.accepting = true;
  $('fbaAcceptAll').disabled = true;
  try {
    for (let i = 0; i < waiting.length; i += FBR_ACCEPT_BATCH) {
      const { done, skipped } = await fbaAcceptStep(waiting.slice(i, i + FBR_ACCEPT_BATCH).map(fgiRowId));
      total.saved += done.length;
      total.pieces += fbvSum(done, r => fbaState(r).open);
      total.skipped.push(...skipped);
      ptDlgMsg(`Accepting… ${nf(total.saved)} of ${nf(waiting.length)} done`);
    }
  } catch (e) {
    console.error('FBA Dispatch, Accept all stopped after ' + total.saved + ' of ' + waiting.length, e);
    stopped = fbrStoppedText(total.saved, waiting.length, e);
  }
  FBR.accepting = false;
  renderFba();
  if (stopped) return stopped;
  fblvSay('fbaMsg', `${nf(total.saved)} dispatch(es) accepted · ${nf(total.pieces)} piece(s)` + fbaSkipText(total.skipped) + '.', !total.saved);
  return '';
}

/* ---- the dispatches as cards ---- */
/** The small facts under a dispatch card's name, as spans. */
function fbrDispatchFacts(r, s) {
  const id = fgiRowId(r), days = fbaStale(r);
  return [
    `Sent ${esc(r.date || String(r.createdAt || '').slice(0, 10))} by ${fbaWho(r.createdBy)}`,
    r.issuedFor ? esc(r.issuedFor) : '',
    r.fbaAcceptedAt ? `Accepted ${esc(String(r.fbaAcceptedAt).slice(0, 10))} by ${fbaWho(r.fbaAcceptedBy)}` : '',
    r.fbaShippedAt ? `Shipped as <b>${esc(r.fbaShipment || '')}</b>` : '',
    s.returned ? `Returned ${fbvDispatchFigure('returned', id, s.returned)}` : '',
    days >= FBA_STALE_DAYS ? `<span style="color:var(--bad)">${nf(days)} days, not shipped</span>` : '',
  ].filter(Boolean).map(t => `<span>${t}</span>`).join('');
}

function fbrDispatchCard({ r, s }, view, sub) {
  const id = fgiRowId(r), m = fgiMaster(r.sku), lane = view.on ? fbvLanesOf(r, view.sales).join(', ') : '';
  const tick = view.can && fbaActionable({ s }) ? `<input type="checkbox" data-fba-pick="${esc(id)}"${FBA_PICK.has(id) ? ' checked' : ''} aria-label="Tick ${esc(obUC(r.sku))}">` : '<span></span>';
  return `<tr${sub ? ' class="fbr-sub"' : ''}><td class="fbr-dc">${tick}`
    + `<div class="fbr-img" data-img="${esc(obUC(r.sku))}" data-imgpx="56">${ptImgInner(r.sku, 56)}</div>`
    + `<div class="fbr-main"><div class="fbr-sku">${esc(obUC(r.sku))}</div>`
    + `<div class="fbr-what">${esc([m.subtype || m.articleType, m.color, m.size].filter(Boolean).join(' · ')) || '<span class="muted">not in the master DB</span>'}</div>`
    + `<div class="fbr-tags">${fbaStatusPill(r, s)}${lane ? `<span class="pill">${esc(lane)}</span>` : ''}</div></div>`
    + `<div class="fbr-qty">${fbvDispatchFigure('sent', id, s.qty)}<small>pieces</small></div>`
    + `<div class="fbr-figs">${fbrDispatchFacts(r, s)}</div>`
    + (view.can ? `<div class="fbr-acts">${fbaRowActions(r, s, id)}</div>` : '') + '</td></tr>';
}

/** One article's card; opened, its dispatches follow as cards. */
function fbrArticleCard(article, view, columns) {
  const { sku } = article, m = fgiMaster(sku), open = FBV.open.has(sku);
  const figs = columns.filter(([k]) => article[k])
    .map(([k, label]) => `<span>${esc(label)} ${fbvFigureButton(k, `data-fbv-sku="${esc(sku)}"`, article[k])}</span>`).join('');
  const card = '<tr><td class="fbr-dc">' + (view.can ? `<div>${fbvTickBox(article)}</div>` : '<span></span>')
    + `<div class="fbr-img" data-img="${esc(sku)}" data-imgpx="56">${ptImgInner(sku, 56)}</div>`
    + `<div class="fbr-main"><button class="ghost fbr-sku" data-fbv-open="${esc(sku)}" aria-expanded="${open}" title="Show or hide its dispatches">${open ? '▾' : '▸'} ${esc(sku)}</button>`
    + `<div class="fbr-what">${esc([m.brand, m.subtype || m.articleType, m.color, m.size].filter(Boolean).join(' · ')) || '<span class="muted">not in the master DB</span>'}</div>`
    + `<div class="fbr-tags">${esc(fbvArticleLanes(article, view.sales).join(', '))}</div></div><span></span>`
    + `<div class="fbr-figs">${figs}</div></td></tr>`;
  return open ? card + fbvInside(article).map(x => fbrDispatchCard(x, view, true)).join('') : card;
}

/** The dispatches as cards in place of the table. Answers { note: the line above it, skus: whose pictures it shows }. */
function fbrDrawCards(rows, view) {
  const byArticle = fbvByArticle(), articles = byArticle ? fbvArticles(rows) : [], columns = fbvColumns(articles);
  const shown = (byArticle ? articles : rows).slice(0, FBA_LIST_LIMIT);
  const card = x => (byArticle ? fbrArticleCard(x, view, columns) : fbrDispatchCard(x, view, false));
  $('fbaTable').innerHTML = (view.can ? `<thead><tr><th>${fbaTickAll(rows)} Tick every dispatch that can still be acted on</th></tr></thead>` : '')
    + '<tbody>' + (shown.length ? shown.map(card).join('') : fbaNothingRow(1, view.sought)) + '</tbody>';
  return { note: byArticle ? fbvArticleNote(articles, rows, view) : fbaDispatchNote(rows, view),
    skus: shown.map(x => (byArticle ? x.sku : x.r.sku)) };
}

/* ---- wiring ---- */
$('fbaAcceptAll').onclick = () => fbrAcceptAllAsk();
$('fbaLists').addEventListener('click', fbrListsClick);
$('fbrMoreBody').addEventListener('click', e => { if (e.target.closest('button')) $('fbrMore').open = false; });
document.addEventListener('click', e => { if (!e.target.closest('#fbrMore')) $('fbrMore').open = false; });
/* A window dragged across 760px redraws the dispatches as cards or as the table (only once they are read, only while shown). */
if (typeof window.matchMedia === 'function') window.matchMedia(FBR_PHONE_QUERY).addEventListener('change', () => {
  if (FGI.rows && !$('paneFba').classList.contains('hide')) renderFba();
});
