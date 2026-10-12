/* ================= FINISHED GOODS: PACK & VERIFY (2026-10-12) =================
 *
 * Ravi's 12 Oct hand-over ("Pack & verify"), merged: the desktop board for a hand scanner on Finished Goods. The RULES
 * are the shared ones in pack-core.js (PACK_CORE, packOrderLines, packLedgerWrite) — the same rules Scan to pack on the
 * Packing List tab packs by, so a wrong article is blocked the same way on both screens.
 *
 * THE SESSION IS THE PACKING LIST. There is no second record: a session is a packlist/{id} document with a `scan` block
 * (orders, plan, what is packed per order, wrong-article scans, the ledger ids Finish wrote). Pause and reload lose
 * nothing; "Open sessions" are the lists in progress that were started by scanning; the Packing List tab prints,
 * labels and makes the Amazon file from the very same document.
 *
 * Scan against order — one line per SKU with the master picture, the orders under it, ordered / packed / left. A scan:
 *   good   on an order with pieces left         +1 to that line (oldest order first) and to the open box, green, beep
 *   full   every line packed / store holds none  amber, not added
 *   wrong  known SKU on no order of this list    red, buzzed, listed under Wrong article, NOT added (Ravi: block it)
 *   unknown                                      red, not added
 * Boxes: box 1 is open from the start; Close box (F2) takes L×W×H (last box's by default) and a scale reading; a closed
 * box can be reopened. Finish writes the Send to FBA rows (packLedgerWrite) and saves the list.
 * Scan a piece (F3) — read-only: stock, open orders holding it, boxes here, earlier packs with their FBA Dispatch state.
 *
 * Rapid scanning: a scan never waits on the network — the screen updates at once and the list is saved 3 s after the
 * last change and on every box close. The same code within 1 s is ignored. Focus returns to the scan box after a click.
 * Camera: the phone's own reader where it reads code_128, else ZXing from this site (the Scan to pack loader). */

let PKV = { p: null, box: 1, hist: [], last: { code: '', at: 0 }, tab: 'order', cam: { stream: null, det: null, timer: 0, seen: null, busy: false },
  saveT: 0, dirty: false, saving: false, err: '' };
const PKV_DEBOUNCE_MS = 1000, PKV_SAVE_MS = 3000;

const pkvOpenLists = () => (PK || []).filter(p => p && p.status !== 'done' && p.scan && !(p.scan.ledgerIds || []).length);

/* ---- opening ---- */
async function pkvOpen() {
  if (!fgiCanEntry()) { $('fgMsg').className = 'err'; $('fgMsg').textContent = FGI_NO_ENTRY; return; }
  $('fgMsg').className = 'muted'; $('fgMsg').textContent = 'Opening Pack & verify…';
  try {
    await Promise.all([fnLoad(), loadPkWt().catch(() => {}), PK_LOADED ? null : loadPk(), typeof ptImgShared === 'function' ? ptImgShared().catch(() => {}) : null]);
  } catch (e) { $('fgMsg').className = 'err'; $('fgMsg').textContent = 'Could not open Pack & verify: ' + (e.message || e); return; }
  const why = await packDataReady();
  if (why) { $('fgMsg').className = 'err'; $('fgMsg').textContent = 'Could not read the ledger: ' + why; return; }
  $('fgMsg').textContent = '';
  const open = pkvOpenLists();
  ptOpenDialog({
    title: 'Pack & verify',
    subtitle: 'Scan each piece against the orders. A wrong article is blocked. Finish writes the Send to FBA rows and the packing list from the same scans.',
    wide: true,
    html: `
      <div class="pkvhead">
        <label>FBA account<select id="pkvAcc">${FGI_FBA_ACCOUNTS.map(a => `<option>${esc(a)}</option>`).join('')}</select></label>
        <label>Invoice #<input id="pkvInv" placeholder="optional"></label>
        <label>Handover to<input id="pkvHand" placeholder="name, optional"></label>
        <label>Order Console orders<input id="pkvOrds" placeholder="order numbers, comma separated" style="min-width:220px"></label>
        <label>Amazon shipment plan<button type="button" id="pkvPlanBtn" class="ghost">Paste plan…</button></label>
        ${open.length ? `<label>Open sessions<select id="pkvResume"><option value="">— new session —</option>${open.map(s => `<option value="${esc(s.id)}">${esc(s.title || s.id)} · ${esc(s.account || '')} · ${esc(s.date || '')} · ${esc(s.by || s.updatedBy || '')}</option>`).join('')}</select></label>` : ''}
        <button type="button" id="pkvStart" class="primary">Start</button>
      </div>
      <div id="pkvWork" class="hide">
        <div class="pkvscan">
          <input id="pkvCode" placeholder="Scan here" autocomplete="off" autocapitalize="characters" spellcheck="false">
          <button type="button" id="pkvCamBtn" class="ghost">Use camera</button>
          <span class="muted" style="font-size:12px"><b id="pkvN">0</b> scans · <b id="pkvSaved">saved</b></span>
        </div>
        <div id="pkvCam" class="pkvcam hide"><video id="pkvVideo" playsinline muted></video><div class="roi"></div></div>
        <div class="pkvfb" id="pkvFb"><div class="img" id="pkvFbImg"></div><div><div class="msg" id="pkvFbMsg">Waiting for a scan…</div><div class="sub" id="pkvFbSub">Each scan is one piece.</div></div></div>
        <div class="pkvtabs"><button type="button" id="pkvTabOrder" class="on">Scan against order</button><button type="button" id="pkvTabPiece">Scan a piece (F3)</button></div>
        <div id="pkvPaneOrder" class="pkvgrid">
          <div><table class="pkvlines"><thead><tr><th>Article</th><th>Orders</th><th class="num">Ordered</th><th class="num">Packed</th><th class="num">Left</th></tr></thead><tbody id="pkvLines"></tbody></table></div>
          <div>
            <div id="pkvBoxes"></div>
            <div class="row" style="gap:8px;margin-top:8px"><button type="button" id="pkvCloseBox" class="ghost">Close box (F2)</button><button type="button" id="pkvUndo" class="ghost">Undo last scan</button><button type="button" id="pkvFinish" class="primary">Finish</button></div>
            <div style="margin-top:12px"><b>Wrong article</b> <span id="pkvWrongN" class="pill pill-out">0</span><ul id="pkvWrong" class="pkvwrong"></ul></div>
          </div>
        </div>
        <div id="pkvPanePiece" class="hide"><div id="pkvPiece" class="muted">Scan any label. Nothing is changed.</div></div>
      </div>
      <div id="pkvMsg" class="muted" style="margin-top:8px"></div>`,
  });
  $('pkvStart').onclick = () => pkvStart().catch(e => { $('pkvMsg').textContent = 'Could not start: ' + (e.message || e); });
  $('pkvPlanBtn').onclick = pkvPlanAsk;
  const r = $('pkvResume'); if (r) r.onchange = () => { const s = open.find(x => x.id === r.value); if (s) pkvResume(s); };
}
function pkvPlanAsk() {
  if ($('pkvPlanTa')) { $('pkvPlanTa').focus(); return; }
  const ta = document.createElement('textarea'); ta.id = 'pkvPlanTa'; ta.rows = 6; ta.placeholder = 'Merchant SKU\tFNSKU\tQuantity\nRTC327-6060\tX00…\t4'; ta.style.width = '100%'; ta.style.marginTop = '8px';
  $('pkvWork').parentNode.insertBefore(ta, $('pkvWork'));
  $('pkvMsg').textContent = 'Paste the plan, then press Start.';
  ta.focus();
}
async function pkvStart() {
  const inv = $('pkvInv').value.trim(), account = $('pkvAcc').value;
  const ords = $('pkvOrds').value.split(/[,;\s]+/).map(obUC).filter(Boolean);
  const bad = packOrdersUnknown(ords);
  if (bad.length) { $('pkvMsg').textContent = `Not in the Order Console: ${bad.join(', ')}`; return; }
  let plan = [], planNo = '';
  const ta = $('pkvPlanTa');
  if (ta && ta.value.trim()) {
    const pp = PACK_CORE.planParse(ta.value);
    if (!pp.lines.length) { $('pkvMsg').textContent = pp.why; return; }
    const unk = pp.lines.filter(l => !pksResolve(l.sku).sku).map(l => l.sku);
    if (unk.length) { $('pkvMsg').textContent = `Not a SKU this app knows: ${unk.join(', ')} — take them out of the plan, or add them to the master first.`; return; }
    plan = pp.lines; planNo = 'FBA-PLAN-' + (inv || Date.now().toString(36).toUpperCase());
  }
  if (!ords.length && !plan.length) { $('pkvMsg').textContent = 'Give at least one Order Console order or paste a shipment plan.'; return; }
  const p = { id: pkId(), date: pkToday(), invoice: inv, title: 'Scan ' + pkToday() + (inv ? ' · ' + inv : ''), account, status: 'progress',
    pkgWt: PK_DEF.pkgWt, volDiv: PK_DEF.volDiv, boxes: [], by: ME.email || '', src: 'scan', scan: packScanNew(ords, plan, planNo, $('pkvHand').value.trim()) };
  await savePkOne(p);
  pkvLoad(p);
}
function pkvResume(s) {
  $('pkvAcc').value = s.account || FGI_FBA_ACCOUNTS[0]; $('pkvInv').value = s.invoice || ''; $('pkvHand').value = (s.scan && s.scan.handoverTo) || '';
  $('pkvOrds').value = ((s.scan && s.scan.orders) || []).join(', ');
  pkvLoad(JSON.parse(JSON.stringify(s)));
}
function pkvLoad(p) {
  PKV.p = p; PKV.hist = []; PKV.dirty = false; PKV.err = ''; PKV.tab = 'order';
  /* Carry on in the last box that has something in it — that is where the packer stopped. */
  const used = (p.boxes || []).filter(b => (b.items || []).length).map(b => +b.n);
  PKV.box = used.length ? Math.max(...used) : 1;
  pksBoxOf(p, PKV.box);
  pkvShowWork();
}
function pkvShowWork() {
  $('pkvWork').classList.remove('hide'); $('pkvMsg').textContent = '';
  ['pkvAcc', 'pkvInv', 'pkvHand', 'pkvOrds', 'pkvPlanBtn', 'pkvResume', 'pkvStart'].forEach(id => { if ($(id)) $(id).disabled = true; });
  const ta = $('pkvPlanTa'); if (ta) ta.remove();
  const box = $('pkvCode');
  box.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const v = box.value; box.value = ''; pkvOnCode(v, 'typed'); } };
  $('pkvCamBtn').onclick = pkvCamToggle;
  $('pkvCloseBox').onclick = pkvCloseBox;
  $('pkvUndo').onclick = pkvUndo;
  $('pkvFinish').onclick = pkvFinish;
  $('pkvTabOrder').onclick = () => pkvTab('order');
  $('pkvTabPiece').onclick = () => pkvTab('piece');
  $('pkvBoxes').onclick = e => { const r = e.target && e.target.closest ? e.target.closest('[data-pkvreopen]') : null; if (!r) return; pkvReopen(+r.getAttribute('data-pkvreopen')); };
  const body = $('ptDlgBody');
  body.onclick = e => { if (!(e.target && e.target.closest && e.target.closest('input,select,textarea,button,a'))) box.focus({ preventScroll: true }); };
  body.onkeydown = e => { if (e.key === 'F2') { e.preventDefault(); pkvCloseBox(); } if (e.key === 'F3') { e.preventDefault(); pkvTab(PKV.tab === 'order' ? 'piece' : 'order'); } };
  pkvRender(); box.focus();
}
function pkvTab(t) {
  PKV.tab = t;
  $('pkvTabOrder').classList.toggle('on', t === 'order'); $('pkvTabPiece').classList.toggle('on', t === 'piece');
  $('pkvPaneOrder').classList.toggle('hide', t !== 'order'); $('pkvPanePiece').classList.toggle('hide', t !== 'piece');
  $('pkvCode').focus();
}

/* ---- saving: batched, never between two scans; the empty box at the end is never saved ---- */
function pkvMark() { PKV.dirty = true; clearTimeout(PKV.saveT); PKV.saveT = setTimeout(pkvSaveNow, PKV_SAVE_MS); pkvSavedSay('pending'); }
async function pkvSaveNow() {
  clearTimeout(PKV.saveT);
  if (!PKV.p || PKV.saving || !PKV.dirty) return;
  PKV.saving = true; PKV.dirty = false;
  const p = Object.assign({}, PKV.p, { boxes: (PKV.p.boxes || []).filter(b => (b.items || []).length || +b.n < PKV.box) });
  try { await savePkOne(p); PKV.err = ''; pkvSavedSay('saved'); }
  catch (e) { PKV.err = e.message || String(e); PKV.dirty = true; pkvSavedSay('not saved — ' + PKV.err); }
  PKV.saving = false;
  if (PKV.dirty && !PKV.err) pkvMark();
}
function pkvSavedSay(t) { const el = $('pkvSaved'); if (el) { el.textContent = t; el.style.color = /not saved/.test(t) ? 'var(--bad)' : ''; } }

/* ---- a scan ---- */
function pkvOnCode(raw, via) {
  const code = obUC(raw); if (!code || !PKV.p) return;
  const now = Date.now();
  if (via === 'typed' && code === PKV.last.code && now - PKV.last.at < PKV_DEBOUNCE_MS) return;
  PKV.last = { code, at: now };
  const hit = pksResolve(code);
  if (PKV.tab === 'piece') return pkvPieceRender(code, hit);
  const p = PKV.p;
  if (p.scan && (p.scan.ledgerIds || []).length) return pkvSay('full', 'This list is finished', 'Its Send to FBA rows are written. Start another session to pack more.');
  const res = PACK_CORE.apply(hit, packOrderLines(p.scan), p.scan.packed, 1);
  p.scan.scans = (p.scan.scans || 0) + 1;
  const m = hit.sku ? (mdbOf(hit.sku) || {}) : {};
  const what = hit.sku ? `${esc(m.subcat || m.articleType || '')} · ${esc(m.color || '')} · ${esc(m.size || '')}` : '';
  if (res.kind === 'unknown') pkvSay('bad', `NOT KNOWN: ${esc(code)}`, 'Not a SKU and not an FNSKU in the list. Nothing added.');
  else if (res.kind === 'wrong') { p.scan.wrong.push({ at: new Date().toISOString(), code, sku: hit.sku, by: ME.email || '' }); pkvSay('bad', `WRONG ARTICLE: ${esc(hit.sku)}`, `${what} — not on any order of this list. Blocked.`, hit.sku); }
  else if (res.kind === 'full') pkvSay('full', `${res.why === 'store' ? 'NO STOCK LEFT' : 'ORDER FULL'}: ${esc(hit.sku)}`, res.why === 'store' ? 'The India Store holds no more of it for these orders — receive it in Finished Goods first.' : 'Every order line for this SKU is already packed.', hit.sku);
  else {
    const b = pksBoxOf(p, PKV.box);
    PACK_CORE.addToBox(b, hit.sku, 1, pkLookupSku(hit.sku) || {});
    PKV.hist.push({ box: b.n, sku: hit.sku, n: 1, parts: res.parts, code, at: now });
    pkvSay('good', `${esc(hit.sku)} +1 → box ${b.n}`, `${what} · for ${esc(res.orderNo)} · ${nf(res.left)} left on the orders${hit.how === 'fnsku' ? ' · from FNSKU ' + esc(code) : ''}`, hit.sku);
  }
  pksBeep(res.kind === 'good');
  pkvMark(); pkvRender();
}
function pkvUndo() {
  const h = PKV.hist.pop(), p = PKV.p; if (!h || !p) { pkvSay('full', 'Nothing to undo', 'Only scans made in this sitting can be undone here.'); return; }
  PACK_CORE.takeFromBox(pksBoxOf(p, h.box), h.sku, h.n);
  PACK_CORE.untake(p.scan.packed, h.sku, h.parts);
  pkvSay('full', `Undone: −${h.n} ${esc(h.sku)} (box ${h.box})`, '', h.sku);
  pkvMark(); pkvRender(); $('pkvCode').focus();
}
function pkvSay(kind, msg, sub, sku) {
  const fb = $('pkvFb'); if (!fb) return;
  fb.className = 'pkvfb ' + kind;
  const img = sku ? pksImg(sku) : '';
  $('pkvFbImg').innerHTML = img ? `<img src="${esc(img)}" alt="">` : '';
  $('pkvFbMsg').innerHTML = msg; $('pkvFbSub').innerHTML = sub || '';
}

/* ---- the board ---- */
function pkvArt(sku) {
  const m = mdbOf(sku) || {}, img = pksImg(sku);
  return `<div class="pkvart">${img ? `<img src="${esc(img)}" alt="">` : '<span class="noimg"></span>'}<div><b>${esc(m.subcat || m.articleType || sku)}</b><span>${esc(sku)} · ${esc(m.color || '')} · ${esc(m.size || '')}</span></div></div>`;
}
function pkvRender() {
  const p = PKV.p; if (!p || !$('pkvLines')) return;
  $('pkvN').textContent = nf(p.scan.scans || 0);
  const ls = PACK_CORE.lines(packOrderLines(p.scan), p.scan.packed);
  const rows = [...ls.entries()].map(([sku, l]) => ({ sku, l, qty: l.reduce((s, x) => s + x.qty, 0), got: l.reduce((s, x) => s + x.got, 0), left: l.reduce((s, x) => s + x.left, 0) })).sort((a, b) => (b.left > 0) - (a.left > 0));
  $('pkvLines').innerHTML = rows.length ? rows.map(r => `<tr class="${r.left ? '' : 'done'}"><td>${pkvArt(r.sku)}</td><td class="mono">${r.l.map(x => `${esc(x.orderNo)} ${nf(x.got)}/${nf(x.qty)}${x.store < x.qty ? ` <span class="muted" title="pieces of this order in the India Store">(${nf(x.store)} in store)</span>` : ''}`).join('<br>')}</td><td class="num">${nf(r.qty)}</td><td class="num">${nf(r.got)}</td><td class="num"><b>${nf(r.left)}</b></td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No open lines — the orders have no pieces of their SKUs in the India Store. Receive them in Finished Goods first.</td></tr>';
  const boxes = (p.boxes || []).filter(b => (b.items || []).length || +b.n === PKV.box);
  $('pkvBoxes').innerHTML = boxes.map(b => {
    const open = +b.n === PKV.box, w = PACK_CORE.boxWeights(b, s => packWtOf(s).wt, p.pkgWt || PK_DEF.pkgWt, p.volDiv || PK_DEF.volDiv), n = PACK_CORE.boxQty(b);
    return `<div class="pkvbox ${open ? 'open' : ''}"><div class="bh"><b>Box ${b.n}</b> <span class="pill ${open ? 'pill-ok' : 'muted'}">${open ? 'open' : 'closed'}</span><span class="muted">${nf(n)} pcs · net ${w.net.toFixed(2)} kg · gross ${w.gross.toFixed(2)} kg${pkNum(b.grossWtOverride) > 0 ? ' (scale)' : ''}${b.L ? ` · ${b.L}×${b.W}×${b.H} cm` : ''}</span>${open ? '' : `<button type="button" class="ghost" data-pkvreopen="${b.n}" style="padding:2px 8px;font-size:12px">Reopen</button>`}</div><ul>${(b.items || []).length ? b.items.map(it => { const wt = packWtOf(it.sku); return `<li><span>${esc(it.sku)}${wt.approx ? ` <span class="pill pill-low" title="${esc(wt.how)}">${wt.wt ? 'approx' : 'no weight'}</span>` : ''}</span><span>${nf(it.qty)}</span></li>`; }).join('') : '<li class="muted">empty</li>'}</ul></div>`;
  }).join('');
  $('pkvWrongN').textContent = nf((p.scan.wrong || []).length);
  $('pkvWrong').innerHTML = (p.scan.wrong || []).length ? p.scan.wrong.slice().reverse().map(w => { const m = mdbOf(w.sku) || {}; return `<li><span><b>${esc(w.sku)}</b> <span class="muted">${esc(m.subcat || '')} ${esc(m.color || '')} ${esc(m.size || '')}</span></span><span class="muted">${esc(String(w.at).slice(11, 19))}</span></li>`; }).join('') : '<li class="muted">Nothing blocked yet.</li>';
}
function pkvReopen(n) {
  const p = PKV.p; if (!p || !(p.boxes || []).some(b => +b.n === n)) return;
  /* The box that was open and still empty goes; the reopened box takes the scans from here on. */
  p.boxes = (p.boxes || []).filter(b => (b.items || []).length || +b.n === n);
  PKV.box = n;
  pkvMark(); pkvRender(); pkvSay('full', `Box ${n} reopened`, 'Scans go into it now.'); $('pkvCode').focus();
}
function pkvCloseBox() {
  const p = PKV.p; if (!p) return;
  const b = pksBoxOf(p, PKV.box);
  if (!(b.items || []).length) return pkvSay('full', `Box ${b.n} is empty`, 'Scan something into it before closing.');
  if ($('pkvCloseForm')) { $('pkvL').focus(); return; }
  const prev = (p.boxes || []).filter(x => +x.n !== b.n && (x.items || []).length).slice(-1)[0] || PK_DEF;
  const w = PACK_CORE.boxWeights(b, s => packWtOf(s).wt, p.pkgWt || PK_DEF.pkgWt, p.volDiv || PK_DEF.volDiv);
  const host = document.createElement('div'); host.className = 'pkvclose'; host.id = 'pkvCloseForm';
  host.innerHTML = `<b>Close box ${b.n}</b><div class="ptgrid"><label>L cm<input id="pkvL" type="number" value="${esc(String(b.L || prev.L || ''))}"></label><label>W cm<input id="pkvW" type="number" value="${esc(String(b.W || prev.W || ''))}"></label><label>H cm<input id="pkvH" type="number" value="${esc(String(b.H || prev.H || ''))}"></label>
    <label>Net, calculated<input value="${w.net.toFixed(2)} kg" readonly></label><label>Gross, calculated<input value="${(w.net + pkNum(p.pkgWt || PK_DEF.pkgWt)).toFixed(2)} kg" readonly></label><label>Gross from the scale (optional)<input id="pkvScale" type="number" step="0.01" placeholder="kg" value="${pkNum(b.grossWtOverride) > 0 ? esc(String(b.grossWtOverride)) : ''}"></label></div>
    <div class="row" style="gap:8px;margin-top:8px"><button type="button" id="pkvCloseOk" class="primary">Close box</button><button type="button" id="pkvCloseNo" class="ghost">Cancel</button></div>`;
  $('pkvBoxes').prepend(host);
  $('pkvCloseOk').onclick = () => {
    ['L', 'W', 'H'].forEach(k => { const v = $('pkv' + k).value; if (v !== '') b[k] = pkNum(v); });
    const g = $('pkvScale').value; if (g !== '' && pkNum(g) > 0) b.grossWtOverride = pkNum(g); else delete b.grossWtOverride;
    PKV.box = Math.max(...(p.boxes || []).map(x => +x.n), PKV.box) + 1;
    pksBoxOf(p, PKV.box);
    pkvMark(); pkvRender(); pkvSaveNow();
    pkvSay('good', `Box ${b.n} closed · box ${PKV.box} open`, ''); $('pkvCode').focus();
  };
  $('pkvCloseNo').onclick = () => { host.remove(); $('pkvCode').focus(); };
  $('pkvL').focus();
}

/* ---- Scan a piece: read-only ---- */
function pkvPieceRender(code, hit) {
  const out = $('pkvPiece'); if (!out) return;
  if (!hit.sku) { out.innerHTML = `<b class="err">NOT KNOWN: ${esc(code)}</b> — not a SKU and not an FNSKU in the list.`; pksBeep(false); return; }
  const p = PKV.p, cands = fgiOutOrders(hit.sku, 'FBA');
  const here = p ? (p.boxes || []).filter(b => PACK_CORE.itemOf(b, hit.sku)).map(b => `box ${b.n} (${nf(PACK_CORE.itemOf(b, hit.sku).qty)} pcs${+b.n === PKV.box ? ', open' : ', closed'})`) : [];
  const gone = (FGI.rows || []).filter(r => r && r.txnType === 'FBA' && obUC(r.sku) === hit.sku && r.packId).slice(-5).map(r => { const st = fbaState(r); return `${esc(r.packId)} · ${nf(r.qty)} pcs · ${esc(st.st || '')}${r.fbaShipmentId ? ' · ' + esc(r.fbaShipmentId) : ''} · ${esc(r.date)}`; });
  const w = packWtOf(hit.sku);
  out.innerHTML = `${pkvArt(hit.sku)}<dl class="pkvkv"><dt>In the store</dt><dd>${nf(fgiOf(hit.sku).current)} pcs</dd>
    <dt>Open orders</dt><dd>${cands.length ? cands.map(c => `${esc(c.orderNo)}: ${nf(c.store)} pcs in the store for it`).join('<br>') : '<span class="err">no open order holds pieces of it</span>'}</dd>
    <dt>In this list</dt><dd>${here.length ? here.join('<br>') : 'not packed in this list'}</dd>
    <dt>Earlier packs</dt><dd>${gone.length ? gone.join('<br>') : '—'}</dd>
    <dt>Weight</dt><dd>${w.wt ? `${w.wt.toFixed(3)} kg per piece${w.approx ? ` <span class="pill pill-low">approx · ${esc(w.how)}</span>` : ''}` : 'no figure anywhere — type it on the Packing List tab'}</dd></dl>`;
  pkvSay(cands.length ? 'good' : 'full', `${esc(hit.sku)} · ${cands.length ? 'on ' + cands.map(c => esc(c.orderNo)).join(', ') : 'not on any open order'}`, 'Lookup only. Nothing changed.', hit.sku);
  pksBeep(!!cands.length);
}

/* ---- Finish: the Send to FBA rows (once), approximate weights learned where the master is empty, the list saved ---- */
async function pkvFinish() {
  const p = PKV.p; if (!p) return;
  const live = (p.boxes || []).filter(b => (b.items || []).length);
  if (!live.length) return pkvSay('full', 'Nothing packed yet', 'Scan at least one piece before finishing.');
  $('pkvFinish').disabled = true;
  try {
    const res = await packLedgerWrite(p, $('pkvHand') ? $('pkvHand').value : undefined);
    if (res.err) { pkvSay('bad', 'Not finished: ' + esc(res.err), (p.scan.ledgerIds || []).length ? '' : 'Nothing was written.'); return; }
    /* Approximate weights are learned into the master only where it holds nothing, as a file import does. */
    const learn = {};
    live.forEach(b => (b.items || []).forEach(it => { const w = packWtOf(it.sku); if (!pkNum(it.perPcsWt) && w.wt) it.perPcsWt = w.wt; if (w.approx && w.wt && !pkNum(PK_WT[obUC(it.sku)])) learn[obUC(it.sku)] = w.wt; }));
    if (Object.keys(learn).length) { try { await savePkWt(learn); } catch (e) { /* the list still saves */ } }
    PKV.dirty = true; await pkvSaveNow();
    if (PKV.err) { pkvSay('bad', 'The rows are written, but the list did not save: ' + esc(PKV.err), 'Press Finish again — nothing is written twice.'); return; }
    pkvCamStop();
    try { renderFgi(); } catch (e) { /* the list is saved */ }
    if (typeof renderPack === 'function' && PK_LOADED) { try { renderPack(); } catch (e) { /* not on that tab */ } }
    pkvSay('good', res.already ? 'Packing list saved' : 'Packing list built', `${nf(live.length)} box(es) · ${nf((p.scan.ledgerIds || []).length)} Send to FBA row(s) · pack ${esc(p.id)}. The FBA Dispatch tab has the rows; the Packing List tab has the sheet, labels and the Amazon file.`);
    $('pkvMsg').innerHTML = `Done. <button type="button" id="pkvAgain" class="ghost">Start another session</button>`;
    $('pkvAgain').onclick = () => { PKV.p = null; ptDlgClose(); pkvOpen(); };
  } finally { $('pkvFinish').disabled = false; }
}

/* ---- camera: the phone's own reader where it reads code_128, else ZXing (Scan to pack's loader); the middle strip only ---- */
async function pkvCamToggle() {
  if (PKV.cam.stream) return pkvCamStop();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return pkvSay('full', 'Camera not available', 'The page must be on https. A keyboard-mode scanner works everywhere.');
  try {
    PKV.cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const v = $('pkvVideo'); v.srcObject = PKV.cam.stream; v.setAttribute('playsinline', ''); v.muted = true;
    try { await v.play(); } catch (e) { /* iOS starts it on the next tap */ }
    PKV.cam.det = null;
    try { if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('code_128')) PKV.cam.det = new BarcodeDetector({ formats: ['code_128'] }); } catch (e) { PKV.cam.det = null; }
    if (!PKV.cam.det) await pksZxLoad();
    $('pkvCam').classList.remove('hide'); $('pkvCamBtn').textContent = 'Stop camera';
    try { await PKV.cam.stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { /* not every camera */ }
    PKV.cam.seen = null;
    pkvCamLoop();
  } catch (e) { pkvSay('full', 'Camera refused', esc(String(e && (e.name || e.message) || e)) + ' — allow the camera for this site, or use a keyboard-mode scanner.'); pkvCamStop(); }
}
function pkvCamStop() {
  clearTimeout(PKV.cam.timer); PKV.cam.timer = 0;
  if (PKV.cam.stream) { PKV.cam.stream.getTracks().forEach(t => t.stop()); PKV.cam.stream = null; }
  const c = $('pkvCam'); if (c) c.classList.add('hide');
  const b = $('pkvCamBtn'); if (b) b.textContent = 'Use camera';
}
async function pkvCamLoop() {
  if (!PKV.cam.stream) return;
  const v = $('pkvVideo'); let code = null;
  try {
    if (!v || v.readyState < 2) code = null;
    else if (PKV.cam.det) { const got = await PKV.cam.det.detect(v), h = v.videoHeight || 1; const c = got.find(x => { const cy = x.boundingBox.y + x.boundingBox.height / 2; return cy > h * 0.3 && cy < h * 0.7 && x.rawValue; }); code = c ? c.rawValue : null; }
    else code = pksZxRead(v);
  } catch (e) { code = null; }
  if (code && pksFrame(obUC(code), Date.now(), PKV.cam)) pkvOnCode(code, 'camera');
  PKV.cam.timer = setTimeout(pkvCamLoop, PKV.cam.det ? 90 : 140);
}

/* The button beside Scan in / out; shown with the same "Can add stock entries" right (renderFgi). */
$('fgPack').onclick = () => pkvOpen().catch(e => { $('fgMsg').className = 'err'; $('fgMsg').textContent = 'Pack & verify could not open: ' + (e.message || e); });
