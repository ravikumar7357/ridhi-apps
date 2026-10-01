/* ================= THE SAME COLOUR, GIVEN TWICE =================
 *
 * Ravi, 2026-09-22: "printer ko running me printing program diya, but same programme pahle de chuka
 * hu — to same color me yadi again koi program du to mujhe pahle pop up aaye."
 *
 * Every OPEN running order (not received, not cancelled) is looked at, across every printer, for a
 * line in the same colour that still has metres to come. Found, the person is asked before the line
 * goes on — they may well mean it (a second fabric, a top-up), so it is a question, not a refusal.
 */
/** Same cloth: the fabric matches, and so does the print direction wherever both lines say one. */
const voSameCloth = (l, fabric, dir) => {
  const lo = v => String(v || '').trim().toLowerCase();
  if (fabric != null && lo(fabric) && lo(l.fabricType) !== lo(fabric)) return false;
  if (dir != null && lo(dir) && lo(l.printDirection) && lo(l.printDirection) !== lo(dir)) return false;
  return true;
};
function voRunningOpenOf(colour, fabric, dir) {
  const k = String(colour || '').trim().toLowerCase();
  if (!k) return [];
  const out = [];
  (VO.rows || []).forEach(o => {
    if (!o || !voRunning(o) || ['Received', 'Cancelled'].indexOf(o.status || 'Placed') >= 0) return;
    voLines(o).forEach(l => {
      if (!l || l.cancelled || String(l.color || '').trim().toLowerCase() !== k) return;
      /* THE SAME FABRIC SKU ONLY (Ravi, 2026-09-25): Apatite Blue on cambric is not Apatite Blue on sheeting 92. */
      if (!voSameCloth(l, fabric, dir)) return;
      const qty = voQty(o, l), left = Math.max(0, qty - (parseFloat(voDone(l)) || 0));
      if (left > 0) out.push({ orderNo: o.orderNo || o.id, vendor: o.vendorName || voName(o.vendorCode) || o.vendorCode || '',
        fabric: l.fabricType || '', dir: l.printDirection || '', qty, left, date: o.orderDate || '' });
    });
  });
  return out;
}
/** The question, in words: which orders, which printer, how much is still to come. */
function voDupQuestion(colour, hits, draftHits) {
  const lines = hits.slice(0, 6).map(h => `• ${h.orderNo} · ${h.vendor} · ${h.fabric}${h.dir ? ' ' + h.dir : ''} · ${nf(h.qty)} m ordered, ${nf(Math.round(h.left))} m still to come${h.date ? ' (placed ' + h.date + ')' : ''}`);
  if (hits.length > 6) lines.push(`• …and ${nf(hits.length - 6)} more`);
  if (draftHits) lines.push(`• already ${nf(draftHits)} line(s) of it in this order`);
  return `${colour} is already given for printing:\n\n${lines.join('\n')}\n\nGive it again?`;
}
/** The same question, naming the cloth it is about. */
const voDupWhat = (colour, fabric, dir) => [colour, fabric, dir].map(x => String(x || '').trim()).filter(Boolean).join(' · ');
/**
 * Ask once per fabric SKU per order being built — colour, fabric and print direction; true = go ahead.
 * A "go ahead" for a colour and fabric with no direction (the Give button, before one is picked) covers both ways.
 */
function voDupAsk(colour, draftLines, fabric, dir) {
  const lo = v => String(v || '').trim().toLowerCase();
  const k = lo(colour);
  VOF.dupOk = VOF.dupOk || {};
  if (!k) return true;
  const k3 = k + '|' + lo(fabric) + '|' + lo(dir), k2 = k + '|' + lo(fabric) + '|';
  if (VOF.dupOk[k3] || VOF.dupOk[k2] || (!lo(fabric) && VOF.dupOk[k])) return true;
  const hits = voRunningOpenOf(colour, fabric, dir);
  const inDraft = (draftLines || []).filter(l => l && voKind(l) === 'running' && lo(l.color) === k && voSameCloth(l, fabric, dir)).length;
  if (!hits.length && !inDraft) return true;
  if (!confirm(voDupQuestion(voDupWhat(colour, fabric, dir), hits, inDraft))) return false;
  VOF.dupOk[k3] = true;
  return true;
}

function voAddLine() {
  const qty = parseFloat(($('vof_qty') || {}).value) || 0;
  const deliv = ($('vof_deliv') || {}).value || '';
  const priRaw = String(($('vof_pri') || {}).value || '').toUpperCase();
  const priority = /^P[1-4]$/.test(priRaw) ? priRaw : '';
  const notes = String(($('vof_lnotes') || {}).value || '').trim();
  const id = 'ln_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const say = m => { $('vof_info').className = 'err'; $('vof_info').textContent = m; };

  if (VOF.kind === 'running') {
    const fab = ($('vof_fab') || {}).value || '', col = ($('vof_col') || {}).value || '', pd = ($('vof_pd') || {}).value || '';
    const fskuTyped = String(($('vof_fsku') || {}).value || '').trim().toUpperCase();
    const fr = fskuTyped ? voFabricCatalogue().get(fskuTyped) : null;
    if (fskuTyped && !fr) return say(`${fskuTyped} is not a fabric SKU in the catalogue.`);
    if (!fab) return say('Pick the fabric type.');
    if (!col) return say('Pick the colour.');
    if (!pd) return say('Pick the print direction.');
    /* The SKU and the fields must describe the same cloth — a SKU that says 82 on a line that says 92
     * sends the printer two different instructions. */
    if (fr && (String(fr.fabric).toLowerCase() !== String(fab).toLowerCase() || String(fr.colour).toLowerCase() !== String(col).toLowerCase()
      || (fr.width && fr.dir !== pd))) return say(`${fr.sku} is ${fr.colour} · ${fr.fabric}${fr.width ? ' · ' + fr.dir : ''}, but the line says ${col} · ${fab} · ${pd}. Pick the SKU again or clear it.`);
    if (qty <= 0) return say('Enter how many metres.');
    if (VOF.mode !== 'request' || VO.rows) {
      if (!voDupAsk(col, VOF.lines, fab, pd)) return say(`Not added — ${voDupWhat(col, fab, pd)} is already given for printing on an open order.`);
    }
    VOF.lines.push(Object.assign({ lineId: id, kind: 'running', fabricType: fab, color: col, printDirection: pd,
      meters: qty, deliveryDate: deliv, priority, notes, dispatchedQty: 0 },
      fr ? { sku: fr.sku, img: fr.imageUrl || '', brand: fr.brandName || '' } : {}));
    ['vof_qty', 'vof_lnotes', 'vof_fsku'].forEach(i => { if ($(i)) $(i).value = ''; });
    $('vof_info').className = 'muted'; $('vof_info').textContent = '';
  } else {
    const m = voSkuInfo();
    if (!m) return;                                  // voSkuInfo has already said why
    if (qty < 1) return say('Enter how many pieces.');
    const sku = obUC(m.sku);
    /* The cap is checked as the line is added, counting the lines already in this draft — otherwise
     * three lines of 40 could each look fine and only the placed order would be over. */
      /* The cap is printing's. A filling or stitching line is not measured against it. */
    if (voDraftPrinting() && !voForShopify()) {
      const bad = voValidateCut(VOF.lines.filter(l => voKind(l) === 'cut').map(l => ({ sku: l.sku, qty: l.qty }))
        .concat([{ sku, qty }]));
      const mine = bad.find(v => v.sku === sku);
      if (mine) return say(voCapMsg(mine));
    }
    VOF.lines.push(Object.assign({ lineId: id, kind: 'cut', sku, articleType: m.articleType || '', articleSubtype: m.subtype || '',
      color: m.color || '', size: m.size || '', brand: m.brand || '', qty, deliveryDate: deliv, priority, notes, dispatchedQty: 0 },
      m.isCustomNew ? { customNew: true } : {}));
    ['vof_sku', 'vof_qty', 'vof_lnotes'].forEach(i => { $(i).value = ''; });
    $('vof_info').className = 'muted'; $('vof_info').textContent = '';
  }
  voDraft();
}

/* ---- a channel's open orders into the lines (Ravi, 2026-09-29) ----
 * Every OPEN order line of the channel, less what is already made and less what a vendor already holds for it
 * (ordVendorOf — stamped or shared — or a printer assigned on the line itself), added up per SKU. Printed items
 * that go as running fabric are added up per fabric and colour instead, in metres (pieces × consumption).
 * Nothing is stored here: the lines are added to the draft, and placing the order stamps them onto these same
 * orders (voStampOrders), oldest first. */
function voChannelFetch(channel, printing) {
  const cut = new Map(), run = new Map(), skipped = new Map();
  const shop = /Shopify/.test(String(channel || ''));
  const when = r => ptDtMs(r.orderDate) || 0;
  ordLines().filter(r => r && r.open && voChannelWants(channel, r)).sort((a, b) => when(a) - when(b)).forEach(r => {
    const v = ordVendorOf(r.orderNo, r.sku);
    const held = r.printer ? r.qty : (v ? v.given : 0);
    const left = Math.min(Math.max(0, ptNum(r.pendingMake)), Math.max(0, r.qty - held));
    if (!(left > 0)) return;
    const sku = obUC(r.sku), m = mdbOf(sku) || null;
    const skip = why => { const e = skipped.get(why) || { why, pcs: 0, skus: new Set() }; e.pcs += left; e.skus.add(sku); skipped.set(why, e); };
    if (printing && m && !ptPrintNeeded(m)) return skip((m.subtype || m.articleType || 'this item') + ' is never printed');
    if (!printing || shop || (m && voCutAllowed(m.articleType, m.subtype)) || (!m && shop)) {
      if (!m && !shop) return skip('not in the master database');
      const e = cut.get(sku) || { sku, m, pcs: 0, orders: [] };
      e.pcs += left; e.orders.push(r.orderNo); cut.set(sku, e);
      return;
    }
    if (!m) return skip('not in the master database');
    const fab = ptPrintFabric(m) || String(m.fabric || '').trim(), cons = parseFloat(m.consumption) || 0;
    if (!fab || !(cons > 0)) return skip(!fab ? 'no fabric on the master row' : 'no consumption on the master row');
    const k = obUC(fab) + '|' + obUC(m.color);
    const e = run.get(k) || { fabric: fab, color: m.color || '', m: 0, pcs: 0, skus: new Set(), orders: new Set() };
    e.m += left * cons; e.pcs += left; e.skus.add(sku); e.orders.add(r.orderNo); run.set(k, e);
  });
  return { cut: [...cut.values()].sort((a, b) => b.pcs - a.pcs), run: [...run.values()].sort((a, b) => b.m - a.m),
    skipped: [...skipped.values()].sort((a, b) => b.pcs - a.pcs) };
}
function voFetchLabel() {
  const el = $('vof_fetch'); if (!el) return;
  const ch = String(($('vof_channel') || {}).value || '');
  el.classList.toggle('hide', !ch);
  el.textContent = 'Fetch ' + (ch || '') + ' orders';
}
function voFetchRun() {
  const ch = String(($('vof_channel') || {}).value || ''), info = $('vof_info');
  if (!ch || !info) return;
  const printing = voDraftPrinting(), f = voChannelFetch(ch, printing);
  const skipTxt = f.skipped.length ? ' Left out: ' + f.skipped.slice(0, 4).map(x => `${nf(Math.ceil(x.pcs))} pcs — ${x.why}`).join('; ') + '.' : '';
  if (VOF.kind === 'running') {
    /* Running cloth is ordered by fabric, colour and print direction; the direction is the office's to pick,
     * so each row fills the entry line and waits for it. */
    info.className = 'muted';
    info.innerHTML = !f.run.length
      ? `${esc(ch)}'s open orders need no running fabric that is not already with a vendor.` + esc(skipTxt)
      : `<b>${esc(ch)}'s open orders need, as running fabric</b> — press Use, pick the direction, then Add line:`
        + `<div style="margin-top:6px;max-height:190px;overflow:auto">` + f.run.map((e, i) => `<div style="display:flex;gap:10px;align-items:center;padding:4px 0;border-top:1px dashed var(--line)">
            <span style="flex:1"><b>${esc(e.fabric)} · ${esc(e.color || '—')}</b> <span class="muted">${nf(e.pcs)} pcs · ${nf(e.skus.size)} SKU(s) · ${nf(e.orders.size)} order(s)</span></span>
            <b>${nf(Math.ceil(e.m))} m</b><button type="button" class="ghost" data-vofuse="${i}" style="padding:3px 10px;font-size:12px">Use</button></div>`).join('') + '</div>'
        + (f.cut.length ? `<div style="margin-top:4px">${nf(f.cut.length)} SKU(s) go as cut pieces — switch to Cut · pieces to fetch them.</div>` : '')
        + esc(skipTxt);
    info.querySelectorAll('[data-vofuse]').forEach(bt => bt.onclick = () => {
      const e = f.run[+bt.getAttribute('data-vofuse')];
      const setSel = (id, v) => { const el = $(id); if (!el) return; const o = [...el.options].find(x => String(x.value).toLowerCase() === String(v).toLowerCase()); if (o) el.value = o.value; };
      setSel('vof_fab', e.fabric); setSel('vof_col', e.color);
      if ($('vof_fsku')) $('vof_fsku').value = '';
      if ($('vof_qty')) $('vof_qty').value = Math.ceil(e.m);
      if ($('vof_lnotes')) $('vof_lnotes').value = `${ch} · ${nf(e.orders.size)} order(s)`;
      if ($('vof_pd')) $('vof_pd').focus();
    });
    return;
  }
  const inDraft = new Set(VOF.lines.filter(l => voKind(l) === 'cut').map(l => obUC(l.sku)));
  const capped = printing && !/Shopify/.test(ch);
  const demand = capped ? voDemandMap() : null, existing = capped ? voExistingMap() : null;
  let added = 0, pcs = 0, trimmed = 0, dup = 0;
  f.cut.forEach(e => {
    if (inDraft.has(e.sku)) { dup++; return; }
    let qty = Math.ceil(e.pcs);
    if (capped) {
      const room = Math.floor((demand.get(e.sku) || 0) * 1.1) - (existing.get(e.sku) || 0);
      if (room < qty) { trimmed++; qty = Math.max(0, room); }
    }
    if (!(qty > 0)) return;
    const m = e.m || (voForShopify() ? voCustomLine(e.sku) : null) || {};
    VOF.lines.push(Object.assign({ lineId: 'ln_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), kind: 'cut', sku: e.sku,
      articleType: m.articleType || '', articleSubtype: m.subtype || '', color: m.color || '', size: m.size || '', brand: m.brand || '',
      qty, deliveryDate: '', priority: '', notes: `${ch} · ${nf(new Set(e.orders).size)} order(s)`, dispatchedQty: 0 },
      !e.m ? { customNew: true } : {}));
    added++; pcs += qty;
  });
  voDraft();
  info.className = added ? 'muted' : 'err';
  info.textContent = (added
    ? `${nf(added)} SKU(s), ${nf(pcs)} pcs brought in from ${ch}'s open orders — check the quantities, pick the vendor, then place.`
    : `Nothing to bring in — ${ch}'s open orders need no cut pieces that are not already with a vendor.`)
    + (dup ? ` ${nf(dup)} SKU(s) already in the lines were left as they are.` : '')
    + (trimmed ? ` ${nf(trimmed)} SKU(s) cut down to the printer cap (approved orders + 10%).` : '')
    + (f.run.length ? ` ${nf(f.run.length)} fabric/colour(s) go as running fabric — switch to Running · metres to fetch those.` : '')
    + skipTxt;
}

function voCheckDraft() {
  const cut = VOF.lines.filter(l => voKind(l) === 'cut').map(l => ({ sku: l.sku, qty: l.qty }));
  if (!cut.length) { $('vof_info').className = 'muted'; $('vof_info').textContent = 'No cut lines to check yet.'; return; }
  if (!voDraftPrinting()) {
    $('vof_info').className = 'muted';
    $('vof_info').textContent = `${nf(cut.length)} line(s) of ${VOF.service.toLowerCase()} — the printer cap `
      + 'measures printing against approved demand, and does not apply to job work.';
    return;
  }
  const bad = voValidateCut(cut);
  $('vof_info').className = bad.length ? 'err' : 'muted';
  $('vof_info').textContent = bad.length
    ? `${nf(bad.length)} SKU(s) over the cap. ` + bad.slice(0, 3).map(voCapMsg).join(' ')
    : `All ${nf(cut.length)} cut line(s) are within the cap.`;
}

