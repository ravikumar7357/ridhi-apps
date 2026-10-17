/* ================= THE PRODUCTION BUCKET (Ravi, 2026-09-26) =================
 *
 * Every Shopify line that needs making and has no production order yet — and, apart, every line the stock says it
 * can fill, for when the stock is not really there. Worked out from the fetched orders and the order book each time;
 * nothing is stored, so nothing can go stale or be counted twice. "Already open" is by Shopify order id and SKU. */
/** What the stock holds for one line of one order: FBA (the account the order ships from) and India (on the shelf). */
function shpStockOf(o, sku) {
  let fba = null, india = null;
  try { const k = String(soAmzSku(sku) || '').toUpperCase(); if (k) fba = soOrdFba(o, k); } catch (e) { /* not known */ }
  try {
    /* WHAT IS ON THE SHELF, not this order's share of it — "kitne h". The share is in the Why text. */
    const ind = soIndiaOf(sku);
    india = ind ? Number(ind[0]) || 0 : null;
  } catch (e) { /* not known */ }
  return { fba, india };
}
/* THE PENDING SHEET DECIDES THE OLD ORDERS (Ravi, 17 Oct: "production bucket me bahut sare order aise h jo ki hamari side se
 * bhej diye but fir bhi production bucket me h … production bucket me cpc shopify ke ye hi order chahiye or aage se production
 * bucket me sirf … new order aay jo real production se required h"). Shopify still calls many old orders unfulfilled although
 * they went out. Per store, from the team's pending sheet: an order up to the sheet's last number reaches the bucket only if
 * the sheet lists it; every order after it comes in as before (make / stock-covered, the usual judgement). A name that is not
 * a number is judged by the sheet's list, else by its date against the sheet's. A store with no sheet is not touched.
 * Ridhi's sheet is still to come (Ravi will send it). */
const SHP_BUCKET_SHEETS = {
  CPC: { file: 'SHEET NEW ALL PENDING ORDERS WORK 2 (1).xlsx', upto: 7887, at: '2026-10-16T09:46:08', keep: [
    '5575 6169 6364 6546 6557 6574 6581 6600 6617 6640 6691 6742 6771 6775 6783 6787 6808 6845 6866 6869 6880 6881',
    '6884 6889 6894 6897 6899 6903 6912 6935 6941 6943 6948 6949 6951 6962 6965 6969 6991 6995 7000 7003 7005 7013',
    '7018 7026 7028 7030 7033 7035 7040 7045 7049 7051 7059 7060 7061 7066 7069 7071 7075 7078 7083 7089 7098 7101',
    '7102 7106 7107 7108 7109 7115 7121 7131 7134 7137 7141 7145 7146 7153 7154 7157 7165 7166 7171 7174 7179 7189',
    '7190 7194 7195 7202 7210 7215 7216 7217 7222 7228 7243 7244 7246 7259 7261 7263 7264 7267 7269 7272 7277 7280',
    '7281 7291 7297 7300 7301 7306 7307 7310 7316 7319 7322 7324 7333 7335 7337 7345 7352 7355 7356 7359 7361 7362',
    '7365 7367 7370 7371 7373 7375 7376 7381 7384 7390 7404 7406 7410 7411 7412 7413 7415 7419 7425 7426 7427 7428',
    '7430 7432 7435 7436 7440 7441 7443 7445 7449 7451 7453 7454 7455 7458 7462 7465 7467 7468 7469 7470 7472 7475',
    '7476 7477 7478 7479 7481 7484 7488 7490 7491 7492 7495 7499 7500 7505 7506 7507 7508 7510 7511 7517 7518 7519',
    '7521 7538 7543 7545 7546 7548 7549 7554 7555 7568 7570 7571 7576 7577 7580 7582 7583 7586 7589 7593 7594 7598',
    '7599 7601 7604 7606 7607 7617 7620 7621 7622 7623 7624 7626 7628 7630 7632 7633 7635 7638 7640 7642 7644 7649',
    '7650 7651 7652 7653 7656 7660 7661 7662 7663 7664 7665 7666 7674 7676 7679 7682 7683 7684 7686 7687 7688 7689',
    '7693 7694 7695 7697 7699 7701 7705 7707 7711 7713 7715 7717 7718 7719 7722 7724 7725 7727 7728 7730 7731 7735',
    '7739 7740 7743 7744 7745 7748 7752 7753 7755 7761 7764 7765 7766 7768 7769 7774 7775 7777 7779 7780 7781 7784',
    '7785 7787 7788 7790 7792 7793 7796 7799 7800 7805 7806 7807 7809 7814 7815 7816 7820 7821 7822 7826 7833 7835',
    '7836 7837 7840 7841 7842 7846 7847 7849 7853 7856 7858 7863 7864 7866 7867 7869 7870 7872 7873 7874 7876 7877',
    '7878 7879 7884 7886 7887 X7JZ3NFBBP',
  ].join(' ') },
};
const SHP_SHEET_SETS = {};
/** Whether an order may reach the Production bucket, by its store's pending sheet. */
function shpSheetAllows(o) {
  const st = soStoreOf(o), r = SHP_BUCKET_SHEETS[st]; if (!r) return true;
  const keep = SHP_SHEET_SETS[st] || (SHP_SHEET_SETS[st] = new Set(r.keep.split(/\s+/).filter(Boolean)));
  const name = String((o && o.no) || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
  if (keep.has(name)) return true;
  if (/^\d+$/.test(name)) return +name > r.upto;
  return String((o && o.at) || '') > r.at;
}
let SHP_BUCKET_IX = { sig: null, list: null };
function shpBucket() {
  const sig = [SO_ALL_ROWS, (SO_ALL_ROWS || []).length, PTG.ob, (PTG.ob || []).length, SHOP_STOCK_LOADED, SHOP_INDIA_LOADED, SHOP_INDIA_ERR, SO_INDIA_TAKEN, SHOP_META];
  if (SHP_BUCKET_IX.list && SHP_BUCKET_IX.sig.every((x, i) => x === sig[i])) return SHP_BUCKET_IX.list;
  const list = shpBucketBuild();
  SHP_BUCKET_IX = { sig, list };
  return list;
}
const SHOP_STOCK_DENIED_TXT = 'This account is not allowed to read the Amazon stock, so nothing can be judged — ask an admin to tick "Shopify" for it in Sellora → Access.';
/** The "needs production" half only, from the orders already routed to production — cheap enough for every draw. */
function shpBucketMake() {
  if (!SHOP_STOCK_LOADED || !SHOP_INDIA_LOADED || SHOP_INDIA_ERR) return [];
  const opened = new Set((PTG.ob || []).filter(x => x && x.shopOrderId).map(x => String(x.shopOrderId) + '|' + obUC(x.sku)));
  const out = [];
  (SO_ALL_ROWS || []).forEach(o => {
    if (!o || !o.id || o.cancelled || o.shipped || !(o.handled || soIsPending(o)) || !shpSheetAllows(o)) return;
    shpNeeds(o, undefined, { evenHandled: true }).forEach(w => { if (!opened.has(String(o.id) + '|' + w.sku)) out.push({ id: String(o.id), sku: w.sku, kind: 'make' }); });
  });
  return out;
}
function shpBucketBuild() {
  const out = [];
  if (!SHOP_STOCK_LOADED || !SHOP_INDIA_LOADED || SHOP_INDIA_ERR) return out;
  const opened = new Set((PTG.ob || []).filter(x => x && x.shopOrderId).map(x => String(x.shopOrderId) + '|' + obUC(x.sku)));
  (SO_ALL_ROWS || []).forEach(o => {
    if (!o || !o.id || o.cancelled || o.shipped || !shpSheetAllows(o)) return;
    const id = String(o.id), isOpen = sku => opened.has(id + '|' + sku);
    const mine = new Set();
    const noted = o.handled ? ' · the order is marked done (' + (o.handledWhy || 'a note says so') + ') — check it is not already made before opening' : '';
    shpNeeds(o, undefined, { evenHandled: true }).forEach(w => {
      mine.add(w.sku);
      if (!isOpen(w.sku)) out.push(Object.assign({ o, id, key: id + '|' + w.sku, sku: w.sku, qty: w.qty, pcs: w.pcs, shopQty: w.shopQty, kind: 'make',
        why: (w.why || []).join(' + ') + noted, noted: !!noted, name: w.name || '', img: w.img || '', adj: w.adjId || '' }, shpStockOf(o, w.sku)));
    });
    /* A marked-done order's stock-covered lines are the shipping team's business, not production's. */
    if (o.handled) return;
    (o.items || []).forEach(i => {
      if (shpLineShipped(i)) return;
      const sku = obUC(i && i.sku);
      if (!sku || mine.has(sku) || isOpen(sku)) return;
      let st; try { st = soLineState(o, i); } catch (e) { return; }
      if (!st || (st.v !== 'india' && st.v !== 'fba')) return;
      const qty = soSendQty(o.id, i.sku, soLive(i));
      if (!(qty > 0)) return;
      const fit = soPackFit(sku), split = !!(fit && fit.ok);
      mine.add(sku);
      out.push(Object.assign({ o, id, key: id + '|' + sku, sku, qty, pcs: split ? qty * fit.pack : qty * obPcsPerPack(sku), shopQty: split ? Math.round(qty / fit.factor) : qty,
        kind: 'covered', from: st.v, why: st.label + ' — ' + st.why, name: String(i.name || '') + (i.variant ? ' · ' + i.variant : ''), img: i.img || i.image || '' }, shpStockOf(o, sku)));
    });
  });
  return out.sort((a, b) => String(a.o.at || '').localeCompare(String(b.o.at || '')) || a.key.localeCompare(b.key));
}

/**
 * OPEN THE TICKED LINES. Each is checked against the database before it is written — an order and SKU already open
 * is skipped by name, so two people pressing at once cannot open it twice. keys: ['<shopify id>|<SKU>'].
 */
async function shpBucketRun(keys, reason) {
  if (!SHOP_STOCK_LOADED || !SHOP_INDIA_LOADED || SHOP_INDIA_ERR) return 'Stock has not been read yet — press Fetch orders, then open the bucket again.';
  const by = new Map(shpBucket().map(x => [x.key, x]));
  const picks = [...new Set(keys || [])].map(k => by.get(k)).filter(Boolean);
  if (!picks.length) return 'Tick at least one line.';
  /* One reason for all (the dialog), or one per line (the Excel): Map key → reason. */
  const whyOf = k => String((reason instanceof Map ? reason.get(k) : reason) || '').trim();
  const noWhy = picks.filter(x => x.kind === 'covered' && !whyOf(x.key));
  if (noWhy.length) return 'Some ticked lines are covered by stock — say why they have to be made anyway (e.g. India stock is not really there)'
    + (reason instanceof Map ? ': ' + noWhy.slice(0, 5).map(x => x.o.no + ' ' + x.sku).join(', ') + (noWhy.length > 5 ? ' and ' + nf(noWhy.length - 5) + ' more' : '') : '') + '.';
  await ptLoadGates();
  if (PTG.err) return 'Could not read the production database: ' + PTG.err;
  const taken = shpTakenNumbers(), groups = new Map();
  picks.forEach(x => { if (!groups.has(x.id)) groups.set(x.id, []); groups.get(x.id).push(x); });
  const patch = {}, plans = [], skipped = [], nowIso = new Date().toISOString();
  if (SHP_CUSTOM === null) { try { SHP_CUSTOM = ptList(await ptGet('pt_customSkus')); } catch (e) { SHP_CUSTOM = []; } }
  const haveSku = new Set((SHP_CUSTOM || []).map(r => obUC(r && r.sku)).concat((PTG.mdb || []).map(r => obUC(r && r.sku))));
  for (const [, ps] of groups) {
    const o = ps[0].o, no = shpAssignNo(o, taken);
    if (!no) { skipped.push(o.no + ': no usable order number'); continue; }
    /* THE DUPLICATE GUARD, READ FROM THE DATABASE — not from this screen, which may be minutes old. */
    const fresh = await Promise.all(ps.map(x => ptGet('pt_orderBook/ob_shp_' + no + '_' + x.sku).catch(() => null)));
    const ok = ps.filter((x, i) => { if (fresh[i]) { skipped.push(x.sku + ' on ' + o.no + ' is already open'); return false; } return true; });
    if (!ok.length) continue;
    const only = new Set(ok.filter(x => x.kind === 'make').map(x => x.sku));
    const force = new Map(ok.filter(x => x.kind === 'covered').map(x => [x.sku, { qty: x.qty, pcs: x.pcs, shopQty: x.shopQty,
      why: 'opened by hand although stock said it could be filled — ' + whyOf(x.key), name: x.name, img: x.img }]));
    const p = shpPlanOrder(o, false, no, { only, force });
    if (p.err) { skipped.push(o.no + ': ' + p.err); continue; }
    Object.assign(patch, p.patch);
    plans.push(p);
    p.needSku.forEach(w => { if (haveSku.has(w.sku)) return; haveSku.add(w.sku); const rec = shpCustomRec(w, w.sku, nowIso); patch['pt_customSkus/' + w.sku] = rec; SHP_CUSTOM.push(rec); });
  }
  if (!plans.length) return 'Nothing was opened' + (skipped.length ? ': ' + skipped.join(' · ') : '.');
  try { await ptPatch(patch); } catch (e) { return 'Not opened: ' + (e.message || e) + ' — nothing changed.'; }
  plans.forEach(p => {
    p.rows.forEach(row => { const i = (PTG.ob || []).findIndex(x => x && x.id === row.id); if (i >= 0) PTG.ob[i] = row; else PTG.ob.push(row); });
    if (Array.isArray(SOX.rows)) { SOX.rows = SOX.rows.filter(x => !(x && x._id === p.no)); if (p.rec) SOX.rows.push(p.rec); }
  });
  PTG.ob = (PTG.ob || []).slice();
  SHP_BUCKET_LAST = { orders: plans.length, lines: plans.reduce((t, p) => t + p.rows.length, 0), pcs: plans.reduce((t, p) => t + p.rows.reduce((u, r) => u + (Number(r.qty) || 0), 0), 0), skipped };
  return '';
}
let SHP_BUCKET_LAST = null;

/* ================= OPEN PRODUCTION FROM THE ORDER ITSELF =================
 *
 * Ravi, 2026-10-06: "m yaha se bhi production order open kar saku". The order's own lines that are in the Production
 * bucket — to make, and covered by stock — with a tick each, and the same shpBucketRun the bucket uses: the duplicate
 * guard read from the database, a reason for a stock-covered line, nothing else of the order touched. What is already
 * in production is said, from the same status the Shopify table shows.
 */
/*
 * THE TICK IS ON THE LINE (2026-10-06, Ravi: "production open wala tick adjustment ki side me chahiye and chah mcf ho chah
 * india stock chah production se required ho sab me production me order krna ka option ho and jiska already order open ho
 * wo dikhay ki already open"). Every line of the order that the bucket holds — to make, or one MCF / India stock could
 * fill — gets a tick in its own row; one already open names its production order. The box under the lines keeps the
 * status, the reason a stock-covered line needs, and the button.
 */
function soProdBucketOf(o) {
  const stockOk = SHOP_STOCK_LOADED && SHOP_INDIA_LOADED && !SHOP_INDIA_ERR;
  return stockOk ? shpBucket().filter(b => b.id === String(o && o.id)) : null;
}
/** The line's bucket entry or open production row, by the Shopify code or the Amazon one. */
function soProdLineOf(o, i, mine) {
  const sku = shpLineCode(o.id, i).sku;
  let amz = ''; try { amz = obUC(soAmzSku(sku)); } catch (e) { /* no mapping */ }
  const ks = [sku, amz].filter(Boolean);
  const b = (mine || []).find(x => ks.includes(x.sku)) || null;
  const open = (PTG.ob || []).find(r => r && String(r.shopOrderId || '') === String(o.id) && ks.includes(obUC(r.sku))) || null;
  return { b, open };
}
function soProdCellFor(o) {
  const esc2 = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const mine = soProdBucketOf(o);
  return i => {
    if (!shpLineCode(o.id, i).sku) return '<span class="muted" title="Shopify sent no SKU and the title matched nothing — type the SKU to make in the Product box">type the SKU ←</span>';
    const { b, open } = soProdLineOf(o, i, mine);
    if (open) return `<span class="pill pill-ok" title="Production is already open for this line">Already open · ${esc2(open.orderNo || open.id || '')}</span>`
      + (typeof ordCanClose === 'function' && ordCanClose() && open.orderNo ? ` <a href="#" data-ordclose="${esc2(obUC(open.orderNo) + '|' + obUC(open.sku))}" style="font-size:11.5px" title="Close this production line with a reason — shipped from stock, cancelled…">close</a>` : '');
    if (mine === null) return '<span class="muted" title="Stock has not been read yet — press Fetch orders">after Fetch</span>';
    if (!b) return '<span class="muted" title="Nothing left to make on this line — sent, shipped, refunded or set to 0">—</span>';
    const from = b.kind === 'make' ? 'To make' : (b.from === 'fba' ? 'MCF can fill' : 'India can fill');
    return `<label style="display:inline-flex;gap:5px;align-items:center;cursor:pointer" title="${esc2(b.why || '')}">`
      + `<input type="checkbox" data-sopk="${esc2(b.key)}"${b.kind === 'make' ? ' checked' : ''}>`
      + `<span class="pill ${b.kind === 'make' ? 'pill-out' : 'pill-low'}">${from}</span></label>`;
  };
}
function soRenderProdBox(o) {
  const box = $('soProdBox'); if (!box) return;
  const esc2 = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const st = typeof soProdStatus === 'function' ? soProdStatus(o) : null;
  const mine = soProdBucketOf(o);
  if (!st && !(mine && mine.length)) {
    box.innerHTML = mine ? '' : '<div class="so-lb">Production</div><div class="muted" style="font-size:12.5px">Stock has not been read yet — press Fetch orders to open production from here.</div>';
    box.classList.toggle('hide', !!mine);
    return;
  }
  box.classList.remove('hide');
  /* A bucket line no row of the order matches (a code changed under it) is still offered, here. */
  const onLines = new Set((o.items || []).map(i => (soProdLineOf(o, i, mine).b || {}).key).filter(Boolean));
  const loose = (mine || []).filter(b => !onLines.has(b.key));
  const cov = (mine || []).some(b => b.kind === 'covered');
  box.innerHTML = '<div class="so-lb">Production</div>'
    + (st ? `<div style="font-size:12.5px;margin-bottom:${(mine && mine.length) ? 8 : 0}px"><b>${esc2(st.txt)}</b></div>` : '')
    + (loose.length ? '<div style="font-size:12.5px;margin-bottom:8px">' + loose.map(b => `<label style="margin-right:12px"><input type="checkbox" data-sopk="${esc2(b.key)}"${b.kind === 'make' ? ' checked' : ''}> ${esc2(b.sku)} × ${nf(b.qty)}</label>`).join('') + '</div>' : '')
    + ((mine && mine.length) ? '<div class="muted" style="font-size:12px;margin-bottom:6px">Tick the lines above (Production column), then press Open production.</div>'
      + (cov ? '<input id="soProdWhy" placeholder="Why make a line MCF or India could fill — needed only when you tick one" style="width:100%;margin-bottom:8px">' : '')
      + '<div style="display:flex;gap:8px;align-items:center"><button id="soProdGo">Open production</button><span id="soProdMsg" class="muted" style="font-size:12.5px"></span></div>' : '');
  const go = $('soProdGo');
  if (!go) return;
  go.onclick = async () => {
    const keys = [...new Set([...($('soItems') ? $('soItems').querySelectorAll('[data-sopk]') : []), ...box.querySelectorAll('[data-sopk]')]
      .filter(c => c.checked).map(c => c.getAttribute('data-sopk')))];
    const msg = $('soProdMsg');
    if (!keys.length) { msg.className = 'err'; msg.textContent = 'Tick at least one line.'; return; }
    go.disabled = true; msg.className = 'muted'; msg.textContent = 'Opening…';
    let err = '';
    try { err = await shpBucketRun(keys, ($('soProdWhy') || {}).value); } catch (e) { err = 'Not opened: ' + (e.message || e); }
    go.disabled = false;
    if (err) { msg.className = 'err'; msg.textContent = err; return; }
    const L = SHP_BUCKET_LAST || {};
    try { if (SHOP_EDIT === String(o.id) || SHOP_EDIT === o.id) openShopOrder(o.id); else soRenderProdBox(o); } catch (e) { soRenderProdBox(o); }
    const m2 = $('soProdMsg');
    const said = `Opened ${nf(L.lines || 0)} line(s) · ${nf(L.pcs || 0)} pc(s) — they are in the Order Console.` + ((L.skipped || []).length ? ' Skipped: ' + L.skipped.join(' · ') : '');
    if (m2) { m2.className = 'muted'; m2.textContent = said; } else { box.insertAdjacentHTML('beforeend', `<div class="muted" style="font-size:12.5px">${esc2(said)}</div>`); }
    try { renderShop(); } catch (e) { /* not on that tab */ }
  };
}

