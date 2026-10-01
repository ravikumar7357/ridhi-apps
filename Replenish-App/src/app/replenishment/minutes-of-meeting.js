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

