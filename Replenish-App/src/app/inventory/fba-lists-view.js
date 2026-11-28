/* ================= INDIA STORE: FBA LISTS ON SCREEN =================
 * The screens of the FBA lists (the rules are in fba-lists.js, switch fbaList): ticking SKUs on Finished Goods and making a
 * list there; packing, shipping, cancelling and undoing a list on FBA Dispatch. Switch off: nothing here is shown.
 *
 * WHEN SOMETHING GOES WRONG:
 *   loud, to the user — a form that cannot read the stock or the lists does not open and says why; a refused save stays on
 *   the form with the reason; a refusal from a button shows on the screen's message line.
 *   There is no quiet fallback here. */
const FBLV_RECENT_DAYS = 30;   // a shipped list is shown, with Undo ship, for this long
const FBLV_LANE_NAMES = { air: 'Air', sea: 'Sea', awd: 'AWD' };

const fblvMayList = () => fblOn() && fbaCan();
const fblvTitle = l => `${FBLV_LANE_NAMES[l.lane]} · ${l.account}`;
const fblvWho = email => String(email || '').split('@')[0];
function fblvSay(lineId, text, bad) {
  $(lineId).className = bad ? 'err' : 'muted';
  $(lineId).textContent = text;
}

/** Read the stock and the open lists as they are now. '' when read, else the sentence to show. */
async function fblvReread() {
  try {
    const unread = await fgiStockReread();
    if (unread) return unread;
    fblKeepAll((await ptGetFresh(FBL_PATH)) || {});
    return '';
  } catch (e) { return `The FBA lists could not be read: ${e.message || e} — check the connection and try again.`; }
}

/* ---- making a list, on Finished Goods ---- */
/** The "Make FBA list" button follows the ticks on the stock list. */
function fblvPickCount() {
  const button = $('fgFbaList'); if (!button) return;
  const n = FGI_PICK.stock.size;
  button.classList.toggle('hide', !(fblvMayList() && $('fgView').value === 'stock'));
  button.disabled = !n;
  button.textContent = n ? `Make FBA list (${nf(n)})` : 'Make FBA list';
}

/** The most pieces of a SKU a new list of this account and lane may take: the limit fblCapWhy (fba-lists.js) refuses above. */
function fblvCap(sku, account, lane, book) {
  const kept = (fblAllotted(fblLists())[shpHoldKey(sku)] || {}).total || 0;
  const unlisted = fgiOf(sku).current - kept;
  const allowed = fblShare({ sku, store: FGA_STORE_OF[account], lane }, book) + fgiReleased(sku);
  return Math.max(0, Math.min(unlisted, allowed));
}

/** The notice on a SKU that went to FBA lately, or ''. */
function fblvRepeatNote(sku) {
  if (!fapRecent(sku).length) return '';
  return `Sent to FBA in the past ${FAP_DAYS} days: ${fapSentText(fapRequest({ sku }, '').recent)}. ` + (fapMayApprove()
    ? 'Making the list counts as your approval, and is recorded.'
    : 'Only the FBA repeat approver or an admin can list it — put 0 to leave it off.');
}

function fblvMakeHtml(skus) {
  const options = list => list.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
  return `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <label>FBA account<select id="fblvAccount">${options(Object.keys(FGA_STORE_OF).map(a => [a, a]))}</select></label>
      <label>Lane<select id="fblvLane">${options(FBL_LANES.map(l => [l, FBLV_LANE_NAMES[l]]))}</select></label>
    </div>`
    + skus.map((sku, i) => {
      const notes = [fblvRepeatNote(sku), fgaNewDevWhy(sku)].filter(Boolean);
      return `<div style="margin-top:10px"><label style="display:block"><b>${esc(sku)}</b> — pieces <span id="fblvMax${i}" class="muted"></span>
        <input id="fblvQty${i}" type="number" min="0" step="1" inputmode="numeric"></label>
        ${notes.map(note => `<div class="err" style="font-size:12px">${esc(note)}</div>`).join('')}</div>`;
    }).join('');
}

/** Put each SKU's most for the picked account and lane into its box. */
function fblvFillCaps(skus) {
  const book = fgaBook();
  skus.forEach((sku, i) => {
    const cap = fblvCap(sku, $('fblvAccount').value, $('fblvLane').value, book);
    $('fblvQty' + i).value = String(cap);
    $('fblvQty' + i).max = String(cap);
    $('fblvMax' + i).textContent = `(up to ${nf(cap)})`;
  });
}

async function fblvMakeOpen() {
  const skus = [...FGI_PICK.stock].sort();
  if (!fblvMayList() || !skus.length) return;
  const unread = await fblvReread();
  if (unread) return fblvSay('fgMsg', unread, true);
  const id = fgiNewId('FBL');   // once per form, so a second press saves nothing new
  ptOpenDialog({
    title: 'Make FBA list',
    subtitle: `${nf(skus.length)} SKU(s)`,
    note: 'The pieces are kept for this list. Nothing leaves the store until it is shipped on FBA Dispatch. Put 0 to leave a SKU off.',
    html: fblvMakeHtml(skus),
    msg: fgiFbaAgeWhy(),
    saveLabel: 'Make the list',
    onSave: () => fblvMakeSave(id, skus),
  });
  $('fblvAccount').value = Object.keys(FGA_STORE_OF)[0];
  $('fblvLane').value = FBL_LANES[0];
  ['fblvAccount', 'fblvLane'].forEach(box => { $(box).onchange = () => fblvFillCaps(skus); });
  fblvFillCaps(skus);
}

async function fblvMakeSave(id, skus) {
  const lines = skus.map((sku, i) => ({ sku, qty: String($('fblvQty' + i).value).trim() }))
    .filter(l => l.qty !== '' && Number(l.qty) !== 0);
  if (!lines.length) return 'Put in the pieces for at least one SKU.';
  const refused = await fblMake({ id, account: $('fblvAccount').value, lane: $('fblvLane').value, lines });
  if (refused) return refused;
  FGI_PICK.stock = new Set();
  renderFgi();
  fblvSay('fgMsg', `FBA list made: ${nf(lines.length)} SKU(s). Pack and ship it on FBA Dispatch.`);
  return '';
}

/* ---- the lists, on FBA Dispatch ---- */
const fblvPackable = l => l.status === 'open' || l.status === 'packed';
const fblvShippable = l => l.status === 'packed' || (l.status === 'shipping' && !fblClaimLive(l));
const fblvMayCancel = l => !!(ME.admin || l.by === ME.email) && (l.status !== 'shipping' || !fblClaimLive(l));
/** Lists as [id, list], the newest first by the time named. */
const fblvNewestFirst = (lists, when) => Object.entries(lists).filter(([, l]) => l)
  .sort((a, b) => String(b[1][when]).localeCompare(String(a[1][when])));
const fblvWaiting = () => fblvNewestFirst(fblLists(), 'at').filter(([, l]) => FBL_ALLOTTING.includes(l.status));
function fblvRecentlyShipped() {
  const since = Date.now() - FBLV_RECENT_DAYS * 864e5;
  return fblvNewestFirst(fblDone(), 'shippedAt').filter(([, l]) => l.status === 'shipped' && Date.parse(l.shippedAt) >= since);
}

function fblvButton(action, id, label) {
  const tone = action === 'cancel' ? ' style="color:var(--bad)"' : '';
  return `<button type="button" class="ghost" data-fbl="${action}" data-fbl-id="${esc(id)}"${tone}>${label}</button>`;
}
function fblvCard(list, buttons) {
  const shipped = list.status === 'shipped';
  const head = shipped
    ? `shipped as ${list.shipment} on ${list.shipDate} by ${fblvWho(list.shippedBy)}`
    : `${list.status} · made by ${fblvWho(list.by)} on ${ptDayWords(list.at)}`;
  const lines = Object.values(list.lines).map(l => `<div><b style="font-family:ui-monospace,monospace">${esc(l.sku)}</b> — ${nf(l.qty)} on the list, `
    + (shipped ? `${nf(l.shipped)} shipped` : `${nf(l.packed)} packed`) + '</div>').join('');
  return `<div style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:8px">
    <div><b>${esc(fblvTitle(list))}</b> <span class="muted">${esc(head)}</span></div>
    <div style="font-size:12.5px;margin:6px 0">${lines}</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${buttons}</div></div>`;
}
function fblvWaitingButtons(id, list) {
  if (!fbaCan()) return '';
  return (fblvPackable(list) && packFbaMayPack() ? fblvButton('pack', id, 'Pack') : '')
    + (fblvShippable(list) ? fblvButton('ship', id, 'Ship') : '')
    + (fblvMayCancel(list) ? fblvButton('cancel', id, 'Cancel list') : '');
}
function fblvPanelHtml(waiting) {
  const shipped = fblvRecentlyShipped();
  const noRight = fbaCan() && !packFbaMayPack() && waiting.some(([, l]) => fblvPackable(l));
  return '<h3 style="margin:0">FBA lists</h3>'
    + (noRight ? `<div class="err" style="margin-top:6px">${esc(PACK_NO_RIGHT)}</div>` : '')
    + (waiting.length ? waiting.map(([id, l]) => fblvCard(l, fblvWaitingButtons(id, l))).join('')
      : '<div class="muted">No list is waiting. Tick SKUs on Finished Goods and press Make FBA list.</div>')
    + (shipped.length ? `<h4 style="margin:12px 0 0">Shipped in the past ${FBLV_RECENT_DAYS} days</h4>`
      + shipped.map(([id, l]) => fblvCard(l, fbaCan() ? fblvButton('undo', id, 'Undo ship') : '')).join('') : '');
}

/** The "FBA lists" panel, and the "Pack a list" button above it. */
function fblvRender() {
  const panel = $('fbaLists'); if (!panel) return;
  const on = fblOn() && !FGI.busy && !FGI.err, waiting = on ? fblvWaiting() : [];
  panel.classList.toggle('hide', !on);
  $('fbaPackBtn').classList.toggle('hide', !(fblvMayList() && packFbaMayPack() && waiting.some(([, l]) => fblvPackable(l))));
  panel.innerHTML = on ? fblvPanelHtml(waiting) : '';
}

/* ---- pack ---- */
/** Pack & verify for one list (pack-verify.js). */
async function fblvPack(id) {
  try { await pkvOpenFbaList(id); }
  catch (e) { fblvSay('fbaMsg', 'Pack & verify could not open: ' + (e.message || e), true); }
}
/** "Pack a list": straight in when only one list can be packed. */
function fblvPackPress() {
  const packable = fblvWaiting().filter(([, l]) => fblvPackable(l));
  if (packable.length === 1) return fblvPack(packable[0][0]);
  fblvSay('fbaMsg', packable.length ? 'Press Pack on the FBA list you are packing.' : 'No FBA list is waiting to be packed — press Refresh.', !packable.length);
}

/* ---- ship, cancel, undo ---- */
/** After a change to a list. A refusal stays on the form. Success, and "done, but released pieces were not given back"
 *  (it starts with doneStart), close the form and are said on the screen. */
function fblvAfter(said, doneStart, success) {
  if (said && !said.startsWith(doneStart)) return said;
  renderFba();
  fblvSay('fbaMsg', said || success, !!said);
  return '';
}

/** The list as it is now, or null after saying why it cannot be had. gone: what to say when it is nowhere. */
async function fblvFresh(id, gone = 'That FBA list is gone — press Refresh.') {
  try {
    const { open, done } = await fblReadOne(id);
    if (open || done) return open || done;
    fblvSay('fbaMsg', gone, true);
  } catch (e) { fblvSay('fbaMsg', `The FBA list could not be read: ${e.message || e} — try again.`, true); }
  return null;
}

/** What the Ship box says about sending fewer than are packed. */
const fblvFewerNote = () => 'Ship sends exactly the packed pieces; pieces on the list that are not packed are freed for the store. '
  + 'To ship fewer, close this box, press Pack on the list, take the pieces out of the boxes and press Finish.'
  + (packFbaMayPack() ? '' : ' ' + PACK_NO_RIGHT);
function fblvShipHtml(lines) {
  return `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <label>Shipment id<input id="fblvShipment" type="text" placeholder="FBA15…" style="font-family:ui-monospace,monospace"></label>
      <label>Ship date<input id="fblvDate" type="date" value="${esc(dTodayIndia())}"></label>
    </div>
    <div style="margin-top:10px">${lines.map(l => `<div><b style="font-family:ui-monospace,monospace">${esc(l.sku)}</b> — `
      + `${nf(l.packed)} shipping (${nf(l.qty)} on the list)</div>`).join('')}</div>`;
}
async function fblvShipOpen(id) {
  if (!fblvMayList()) return;
  const list = await fblvFresh(id);
  if (!list) return;
  if (!fblvShippable(list)) {
    renderFba();
    return fblvSay('fbaMsg', 'This FBA list cannot be shipped just now — pack it first, or press Refresh.', true);
  }
  const lines = Object.values(list.lines);
  ptOpenDialog({
    title: 'Ship FBA list',
    subtitle: fblvTitle(list),
    note: 'Put in the Amazon shipment id. ' + fblvFewerNote(),
    html: fblvShipHtml(lines),
    saveLabel: 'Ship',
    onSave: () => fblvShipSave(id, lines),
  });
}
async function fblvShipSave(id, lines) {
  const packed = {};
  lines.forEach(l => { packed[l.sku] = l.packed; });
  const said = await fblShip(id, { shipment: $('fblvShipment').value, date: $('fblvDate').value, packed });
  return fblvAfter(said, 'Shipped.', 'FBA list shipped.');
}

/** Ask before cancelling or undoing. ask: { title, note, run }. */
async function fblvConfirm(id, ask) {
  const list = await fblvFresh(id, ask.gone);
  if (!list) return;
  ptOpenDialog({ title: ask.title, subtitle: fblvTitle(list), note: ask.note, saveLabel: ask.title, onSave: ask.run });
}
const fblvCancelAsk = id => fblvConfirm(id, { title: 'Cancel this FBA list',
  note: 'Its pieces are free for the store again. To keep the list, close this box.',
  run: async () => fblvAfter(await fblCancel(id), 'Cancelled.', 'FBA list cancelled.') });
const fblvUndoAsk = id => fblvConfirm(id, { title: 'Undo ship', gone: FBL_RECORD_GONE,
  note: 'The whole shipment is taken back: its movements are deleted and the list is packed again, with the pieces that were shipped.',
  run: async () => fblvAfter(await fblUndoShip(id), 'Undone.', 'Shipment undone — the list is packed again.') });

const FBLV_ACTIONS = { pack: fblvPack, ship: fblvShipOpen, cancel: fblvCancelAsk, undo: fblvUndoAsk };
if ($('fbaLists')) $('fbaLists').onclick = e => {
  const b = e.target.closest('[data-fbl]');
  if (b) FBLV_ACTIONS[b.getAttribute('data-fbl')](b.getAttribute('data-fbl-id'));
};
if ($('fbaPackBtn')) $('fbaPackBtn').onclick = () => fblvPackPress();
if ($('fgFbaList')) $('fgFbaList').onclick = () => fblvMakeOpen();
