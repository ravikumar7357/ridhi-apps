/* ================= CONTENT CREATORS — gift orders for creators, sent to Amazon MCF (16 Nov 2026) =================
 *
 * Gifts for Instagram creators. Most orders arrive from Creator Setu (creator-growth-engine.netlify.app) already filled
 * in: the creator picked the product and typed the address on Creator Setu's gift link, and the team pressed "Create
 * order in ERP" there. Creator Setu's server posts the order to the Pricing API (Pricing-API/CreatorOrders.gs,
 * ?creator=order), which saves it in Firestore creatorOrders/{reference}. The rest are typed here with "+ Create order".
 *
 * The team opens a New order, checks the product (the SKU can be changed), presses "Checked ✓", then sends it to Amazon
 * MCF — the SAME backend call as Shopify Orders and Returns (Pricing-API Mcf.gs, apiPost({ mcf: 'create' })), from the
 * order's own brand's FBA. The backend makes the fulfilment id from the reference ("SHOP-CGE12AB34CD"), so a second send
 * of the same gift is refused by Amazon as a duplicate, not shipped twice. The id sent with it is not a Shopify id
 * ("CC-…"), so the backend leaves Shopify alone — exactly as a replacement does (returns.js srSendRep).
 *
 * WHERE IT LIVES: Firestore creatorOrders/{reference}, one document per gift. Rights: whoever holds Shopify Orders
 * ('shop'), and admins (Pricing-App/firestore.rules, match /creatorOrders). Nothing of the Shopify Orders screen is
 * written or read for its orders: SHOP_META, audit/shoporders and the Shopify order list are not touched. Only the
 * stock figures (FBA fulfillable, India Finished Goods, the Amazon SKU mapping) are READ, with the same functions.
 *
 * SELF-CONTAINED, like shopify-hub-local.js: the menu item and the page are made here and showTab is wrapped for this
 * page only. Remove this file and its line in ORDER and nothing of it is left.
 *
 * Address: #creators, and #creators?ref=CGE-12AB34CD opens that order (the link Creator Setu opens after it sends one).
 */
const CRO_COL = 'creatorOrders';
const CRO_STATUSES = ['New', 'Checked', 'Sent to Amazon', 'Shipped', 'Delivered', 'Problem', 'Cancelled'];
const CRO_PILL = { 'New': 'st-draft', 'Checked': 'st-pending', 'Sent to Amazon': 'st-pending', 'Shipped': 'st-pending',
  'Delivered': 'st-approved', 'Problem': 'st-rejected', 'Cancelled': 'st-rejected' };
/* What may still be changed: once a parcel is with Amazon, the product and the address are what went. */
const CRO_EDITABLE = s => s === 'New' || s === 'Checked' || s === 'Problem';
const CRO_BRANDS = { ridhi: 'Ridhi', 'cotton-print-club': 'CPC' };
/** The Amazon account a gift ships from: CPC's for a CPC gift, Ridhi's for every other. */
const croAcct = o => (o && o.brand === 'cotton-print-club' ? 'CPC' : 'SP');
const croStore = o => (o && o.brand === 'cotton-print-club' ? 'CPC' : 'Ridhi');
const CRO_CAP_STEP = 100;
/* The address the page was opened at — read before the first showTab rewrites it. */
const CRO_START = (() => { try { return String(location.hash || ''); } catch (e) { return ''; } })();
let CRO = { list: [], loaded: false, loading: null, err: '', store: '', q: '', status: '', src: '', from: '', to: '',
  cap: CRO_CAP_STEP, picked: new Set(), want: '', busy: false, msg: '', bad: false, lane: '' };

/** The signed-in person may use this page: admins, and whoever holds Shopify Orders. */
function croMay() {
  if (typeof ME === 'undefined' || !ME || !ME.email) return false;
  if (ME.admin) return true;
  return !!(ME.tabs && (!ME.tabs.length || ME.tabs.includes('shop')));
}
/** 'YYYY-MM-DD' in the store's day (Pacific), like every date on the Shopify screens. */
function croDay(iso) {
  const t = Date.parse(String(iso || ''));
  if (isNaN(t)) return String(iso || '').slice(0, 10);
  const d = sdPT(t), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const croAge = o => { const a = Date.parse(croDay(o.createdAt)), b = Date.parse(sdToday()); return isNaN(a) || isNaN(b) ? 0 : Math.max(0, Math.round((b - a) / 864e5)); };
const croUnits = o => (o.lines || []).reduce((n, l) => n + (parseInt(l.quantity, 10) || 0), 0);
const croValue = o => (o.lines || []).reduce((n, l) => n + (Number(l.priceUsd) || 0) * (parseInt(l.quantity, 10) || 0), 0);
const croHandle = h => { h = String(h || '').trim().replace(/^@+/, ''); return h ? '@' + h : ''; };
const croMoney = v => '$' + (Math.round((v || 0) * 100) / 100).toLocaleString('en-US');
function croMsg(t, bad) { CRO.msg = t || ''; CRO.bad = !!bad; const m = $('croMsg'); if (m) { m.textContent = CRO.msg; m.className = bad ? 'err' : 'muted'; } }

/* ---------------- reading and writing ---------------- */
/** A Firestore save: through the live mirror's fsSetDoc where this ERP has one (core/mirror.js on dev), else Firestore's
 *  own setDoc — the same call, the same answer. typeof on a name that is not declared is safe. */
function croSetDoc(ref, data, opt) {
  const f = typeof fsSetDoc === 'function' ? fsSetDoc : setDoc;
  return opt ? f(ref, data, opt) : f(ref, data);
}
async function croLoad(force) {
  if (CRO.loading && !force) return CRO.loading;
  CRO.loading = (async () => {
    try {
      const snap = await getDocs(collection(db, CRO_COL));
      const out = [];
      snap.forEach(s => { const d = s.data() || {}; out.push(Object.assign({}, d, { reference: d.reference || s.id })); });
      CRO.list = out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      CRO.loaded = true; CRO.err = '';
    } catch (e) {
      CRO.err = /permission|insufficient/i.test(String(e && (e.code || e.message)))
        ? 'This account may not read the creator orders. An admin gives it Shopify Orders (Sellora → Access).'
        : 'Could not read the creator orders: ' + (e.message || e);
    } finally { CRO.loading = null; }
  })();
  return CRO.loading;
}
const croOf = ref => CRO.list.find(o => String(o.reference) === String(ref)) || null;
/** Save one order: what changed, who, and a line in its log. Returns '' or why not. */
async function croSave(ref, patch, what) {
  const o = croOf(ref);
  if (!o) return 'That order is not loaded — press Refresh.';
  const now = new Date().toISOString();
  const next = Object.assign({}, o, patch, { updAt: now, updBy: ME.email,
    log: (o.log || []).concat(what ? [{ at: now, by: ME.email, what: String(what).slice(0, 300) }] : []).slice(-60) });
  /* MERGED, and never with "setu": that field is the backend's record of what Creator Setu has been told, and this page's
   * copy of it may be older than the backend's. */
  const write = Object.assign({}, next); delete write.setu;
  try { await croSetDoc(doc(db, CRO_COL, String(ref)), write, { merge: true }); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  CRO.list[CRO.list.indexOf(o)] = next;
  if (next.status !== o.status) croReportSoon(ref);
  return '';
}

/* ---------------- REPORT-BACK: Creator Setu is told when a gift is sent, shipped, delivered or cancelled ----------------
 * Through the Pricing API (Pricing-API/CreatorOrders.gs, apiPost({ creator: 'report' })), which holds the shared key —
 * never this page. The page says only WHICH order changed, with the signed-in person's sign-in; the backend reads the order
 * from Firestore itself, tells Creator Setu, and writes what it told on the order (field "setu"), so each status is told
 * once, with reportedStatus / reportedAt / lastReportError (Khushi, 18 Nov). The backend tries once more after a few
 * seconds when Creator Setu does not answer; a refusal (401, 404, 400, 409) or a second failure is shown on the order as
 * "Report-back failed" with its time and a "Retry report-back" button, and is never asked again by itself. A status the
 * page changed but could not even send (the tab closed, no network) is sent the next time this page is opened.
 * Only from the real ERP, and only Creator Setu's own gifts (source creator-setu, a CGE- reference). */
const CRO_SETU = { 'Sent to Amazon': 'sent_to_amazon', 'Shipped': 'shipped', 'Delivered': 'delivered', 'Cancelled': 'cancelled' };
const croReportOn = () => typeof location !== 'undefined' && /^fabricrush-replenish\.(web\.app|firebaseapp\.com)$/.test(location.hostname);
const croIsSetuGift = o => !!o && o.source === 'creator-setu' && /^CGE-/i.test(String(o.reference || ''));
/** Does Creator Setu still have to hear about this order's status — and has nobody tried yet? A failed try waits for a person. */
function croNeedsReport(o) {
  const want = croIsSetuGift(o) ? CRO_SETU[o.status] : '';
  if (!want) return false;
  const s = o.setu || {};
  if (s.status === want && !s.error) return false;
  if (s.error && s.tried === want) return false;      // tried and refused or failed: "Retry report-back" only
  return true;
}
/** Ask the backend to tell Creator Setu about one order. retry = the person pressed "Retry report-back". '' or why not. */
async function croReport(ref, retry) {
  if (!croReportOn()) return 'Creator Setu is told only from the real ERP.';
  const o = croOf(ref);
  if (!o || !croIsSetuGift(o) || !CRO_SETU[o.status]) return '';
  if (!retry && !croNeedsReport(o)) return '';
  let d;
  try { d = await apiPost({ creator: 'report', reference: String(ref) }); }
  catch (e) {
    /* apiPost keeps only the message of a refusal; the backend has written the same on the order (lastReportError). */
    const c = croOf(ref), err = String(e.message || e), at = new Date().toISOString();
    if (c) CRO.list[CRO.list.indexOf(c)] = Object.assign({}, c, { lastReportError: err, reportFailedAt: at,
      setu: { status: ((c.setu || {}).status) || '', tried: CRO_SETU[c.status], error: err, at } });
    return 'Report-back failed: ' + err;
  }
  const cur = croOf(ref);
  if (d && d.setu && cur) CRO.list[CRO.list.indexOf(cur)] = Object.assign({}, cur, { setu: d.setu, lastReportError: '',
    reportedStatus: d.reportedStatus || d.setu.status, reportedAt: d.reportedAt || d.setu.at });
  return '';
}
function croReportSoon(ref) { croReport(ref).then(err => { if (err && croReportOn()) croMsg(ref + ': ' + err, true); croRender(); }).catch(() => {}); }
/** Everything not yet told, one at a time, in the background — at most 25 a visit. */
let CRO_REPORTING = false;
async function croReportPending() {
  if (CRO_REPORTING || !croReportOn()) return;
  CRO_REPORTING = true;
  try { for (const o of CRO.list.filter(croNeedsReport).slice(0, 25)) await croReport(o.reference); }
  finally { CRO_REPORTING = false; croRender(); }
}
/** When, in the reader's own clock: "18 Nov, 14:05". */
const croWhen = iso => { const t = Date.parse(String(iso || '')); return isNaN(t) ? '' : new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
/** The order window's report-back line: what Creator Setu knows, or "Report-back failed" with the time and a Retry button. */
function croSetuLine(o) {
  if (!croIsSetuGift(o)) return '';
  const s = o.setu || {}, words = { sent_to_amazon: 'sent to Amazon', shipped: 'shipped', delivered: 'delivered', cancelled: 'cancelled' };
  const err = o.lastReportError || s.error || '';
  const known = o.reportedStatus || (s.error ? '' : s.status) || s.status || '';
  const knowsLine = known ? `Creator Setu knows: <b>${esc(words[known] || known)}</b>${(o.reportedAt || s.at) && !s.error ? ' · ' + esc(croWhen(o.reportedAt || s.at)) : ''}` : '';
  if (err && CRO_SETU[o.status]) {
    return `<div style="margin-top:8px;padding:8px 10px;border-radius:10px;background:var(--bad-bg,#fde7ea)">`
      + `<div class="err" style="font-size:12.5px;font-weight:700">Report-back failed${o.reportFailedAt || s.at ? ' · ' + esc(croWhen(o.reportFailedAt || s.at)) : ''}</div>`
      + `<div style="font-size:12px;margin-top:2px">${esc(err)}</div>`
      + (knowsLine ? `<div class="muted" style="font-size:11.5px;margin-top:2px">${knowsLine}</div>` : '')
      + `<button type="button" class="ghost" id="croRetryReport" style="margin-top:6px;padding:4px 12px;font-size:12px">Retry report-back</button></div>`;
  }
  if (knowsLine) return `<div class="muted" style="font-size:12px;margin-top:6px">${knowsLine}</div>`;
  return CRO_SETU[o.status] ? '<div class="muted" style="font-size:12px;margin-top:6px">Creator Setu has not been told yet.</div>' : '';
}

/* ---------------- stock: the Shopify screens' own figures, read only ---------------- */
let CRO_STOCK_ASKED = false;
async function croStockLoad() {
  if (CRO_STOCK_ASKED) return;
  CRO_STOCK_ASKED = true;
  await Promise.all([
    typeof loadShopStock === 'function' && !SHOP_STOCK_LOADED ? loadShopStock().catch(() => {}) : null,
    typeof loadShopIndia === 'function' ? loadShopIndia().catch(() => {}) : null,
    typeof loadShopSku === 'function' && !Object.keys(SHOP_SKU || {}).length ? loadShopSku().catch(() => {}) : null,
  ]);
}
/** One line against its brand's FBA: the Amazon code, what is there, what is needed. */
function croLineStock(o, l) {
  const acct = croAcct(o), need = parseInt(l.quantity, 10) || 0;
  const key = soAmzKey(l.sku);
  const have = key ? soFbaIn(acct, key) : null;
  const amz = (key && (SHOP_STOCK_CASE_BY[acct] || {})[key]) || soAmzSku(l.sku) || String(l.sku || '').trim();
  let india = null; try { const i = soIndiaOf(l.sku); india = i ? Number(i[0]) || 0 : null; } catch (e) { /* not read */ }
  return { acct, need, have, amz, india, ok: have != null && have >= need && need > 0 };
}
/** Can this gift go to Amazon as it stands? Every line, whole — a gift is not sent in halves. */
function croPlan(o) {
  const lines = (o.lines || []).filter(l => String(l.sku || '').trim() && (parseInt(l.quantity, 10) || 0) > 0);
  const st = lines.map(l => Object.assign({ l }, croLineStock(o, l)));
  const short = st.filter(x => !x.ok);
  return { acct: croAcct(o), lines: st, short, ok: !!st.length && !short.length && SHOP_STOCK_LOADED };
}
/** The Ship from cell: the same words as Shopify Orders (MCF done / MCF ready / MCF no stock), India under it. */
function croShipFrom(o) {
  const sub = t => (t ? '<span class="sub">' + t + '</span>' : '');
  if (o.amazon && o.amazon.orderId) return '<span class="st st-approved" style="font-weight:700">MCF done</span>' + sub(esc(o.amazon.orderId));
  if (!SHOP_STOCK_LOADED) return '<span class="muted">SKU ?</span>' + sub('stock not read yet');
  const p = croPlan(o);
  const india = p.lines.filter(x => x.india != null).map(x => nf(x.india));
  const fba = p.lines.map(x => (x.have == null ? 'not in FBA' : nf(x.have))).join(' · ');
  if (p.ok) return '<span class="st st-approved">MCF ready</span>' + sub(esc(soAcctName(p.acct)) + ' FBA ' + fba);
  return '<span class="st st-rejected">MCF no stock</span>' + sub((india.length ? 'India ' + india.join(' · ') + ' · ' : '') + esc(soAcctName(p.acct)) + ' FBA ' + fba);
}

/* ---------------- tracking: the carrier's own page for a number ---------------- */
/** The carrier's tracking page for one number, or '' when the carrier is not known (then the number is shown plain). */
function croTrackUrl(carrier, num) {
  const n = String(num || '').trim(), c = String(carrier || '').toUpperCase(), e = encodeURIComponent(n);
  if (!n) return '';
  if (/^TBA/i.test(n) || /AMZ|AMAZON/.test(c)) return 'https://track.amazon.com/tracking/' + e;
  if (/^1Z/i.test(n) || /UPS/.test(c)) return 'https://www.ups.com/track?tracknum=' + e;
  if (/USPS/.test(c)) return 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + e;
  if (/FEDEX|FDX/.test(c)) return 'https://www.fedex.com/fedextrack/?trknbr=' + e;
  if (/DHL/.test(c)) return 'https://www.dhl.com/us-en/home/tracking.html?tracking-id=' + e;
  if (/ONTRAC/.test(c)) return 'https://www.ontrac.com/tracking/?number=' + e;
  return '';
}
/** "UPS 1Z999… ↗" as links — one per number Amazon gave (a gift can go in more than one parcel). */
function croTrackHtml(a, small) {
  const nums = String((a && a.tracking) || '').split(/[,\s]+/).filter(Boolean);
  if (!nums.length) return '';
  const carrier = (a && a.carrier) || '';
  return nums.map(n => { const u = croTrackUrl(carrier, n), label = esc((carrier ? carrier + ' ' : '') + n);
    return u ? `<a class="cro-trk${small ? ' sm' : ''}" href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="Open the carrier's tracking page">${label} ↗</a>`
      : `<span class="cro-trk${small ? ' sm' : ''}">${label}</span>`; }).join(' ');
}

/* ---------------- the steps: one button per stage of a gift, as Shopify Orders has ---------------- */
const CRO_LANES = [
  { k: 'check', t: 'To check', tip: 'New — check the product and the address, then Checked ✓', f: o => o.status === 'New' },
  { k: 'send', t: 'Ready to send', tip: 'Checked — send to Amazon', f: o => o.status === 'Checked' },
  { k: 'amazon', t: 'With Amazon', tip: 'Sent — waiting for Amazon to ship', f: o => o.status === 'Sent to Amazon' },
  { k: 'shipped', t: 'Shipped', tip: 'On its way — mark Delivered when it arrives', f: o => o.status === 'Shipped' },
  { k: 'delivered', t: 'Delivered', tip: 'Arrived', f: o => o.status === 'Delivered' },
  { k: 'attention', t: 'Needs attention', tip: 'Problem, Cancelled, or Creator Setu was not told', f: o => o.status === 'Problem' || o.status === 'Cancelled' || !!(o.lastReportError || (o.setu && o.setu.error)) },
];
/** What the team does next with one order — the "Next step" column. */
function croNext(o) {
  const a = o.amazon || {}, sub = t => (t ? '<span class="sub">' + t + '</span>' : '');
  const asked = a.checkedAt ? 'asked Amazon ' + esc(croWhen(a.checkedAt)) : 'not asked Amazon yet';
  switch (o.status) {
    case 'New': return '<b>Check product &amp; address</b>' + sub('then press Checked ✓');
    case 'Checked': return SHOP_STOCK_LOADED && !croPlan(o).ok ? '<b style="color:var(--bad)">FBA cannot ship it</b>' + sub('change the SKU, or set Problem') : '<b>Send to Amazon</b>' + sub('Check speeds &amp; cost');
    case 'Sent to Amazon': return '<span>Waiting for Amazon to ship</span>' + sub(asked);
    case 'Shipped': return (croTrackHtml(a, true) || '<span>Shipped</span>') + sub('mark Delivered when it arrives');
    case 'Delivered': return '<span class="muted">Delivered</span>' + sub(a.deliveredAt ? esc(croDay(a.deliveredAt)) : '');
    case 'Problem': return '<b style="color:var(--bad)">Needs a person</b>' + sub(esc(String(o.notes || '').slice(0, 40)));
    case 'Cancelled': return '<span class="muted">Cancelled</span>';
    default: return '';
  }
}

/* ---------------- the page ---------------- */
function croRows(anyLane) {
  const q = CRO.q.trim().toLowerCase();
  const lane = anyLane ? null : CRO_LANES.find(l => l.k === CRO.lane);
  return CRO.list.filter(o => {
    if (lane && !lane.f(o)) return false;
    if (CRO.store && croStore(o) !== CRO.store) return false;
    if (CRO.status && o.status !== CRO.status) return false;
    if (CRO.src && (o.source || '') !== CRO.src) return false;
    const day = croDay(o.createdAt);
    if (CRO.from && day < CRO.from) return false;
    if (CRO.to && day > CRO.to) return false;
    if (!q) return true;
    const c = o.creator || {};
    return [o.reference, c.name, c.instagram, croHandle(c.instagram), o.campaign, (o.shipTo || {}).name]
      .concat((o.lines || []).map(l => [l.sku, l.title, l.color, l.size].join(' '))).join(' ').toLowerCase().includes(q);
  });
}
function croFigures(pool) {
  const wk = Date.now() - 7 * 864e5, inWeek = iso => { const t = Date.parse(String(iso || '')); return !isNaN(t) && t >= wk; };
  const fig = (big, small, tip) => `<div class="so-fig" title="${esc(tip)}"><b>${nf(big)}</b><span>${small}</span></div>`;
  return fig(pool.filter(o => o.status === 'New').length, 'to check', 'New orders nobody has checked yet')
    + fig(pool.filter(o => o.amazon && inWeek(o.amazon.sentAt)).length, 'sent to Amazon this week', 'Sent to Amazon MCF in the last 7 days')
    + fig(pool.filter(o => o.status === 'Sent to Amazon' || o.status === 'Shipped').length, 'in transit', 'With Amazon, not delivered yet')
    + fig(pool.filter(o => o.status === 'Delivered' && inWeek((o.amazon || {}).deliveredAt || o.updAt)).length, 'delivered this week', 'Marked delivered in the last 7 days');
}
function croRender() {
  const pane = $('paneCreators'); if (!pane || pane.classList.contains('hide')) return;
  if ($('croStoreSeg')) $('croStoreSeg').querySelectorAll('[data-crostore]').forEach(b => b.classList.toggle('on', (b.getAttribute('data-crostore') || '') === CRO.store));
  const brandPool = CRO.list.filter(o => !CRO.store || croStore(o) === CRO.store);
  if ($('croKpis')) $('croKpis').innerHTML = croFigures(brandPool);
  if ($('croStockAt')) $('croStockAt').innerHTML = typeof soStockStamp === 'function' ? soStockStamp() : '';
  if ($('croLanes')) {
    const pool = croRows(true);
    $('croLanes').innerHTML = [{ k: '', t: 'All', tip: 'Every order', f: () => true }].concat(CRO_LANES).map(l => {
      const n = pool.filter(l.f).length;
      return `<button type="button" class="so-st${CRO.lane === l.k ? ' on' : ''}${n ? '' : ' zero'}${l.k === 'attention' && n ? ' warn' : ''}" data-crolane="${l.k}" title="${esc(l.tip)}">${esc(l.t)} <b>${nf(n)}</b></button>`;
    }).join('');
  }
  const tbl = $('croTable'); if (!tbl) return;
  if (CRO.err) { tbl.innerHTML = `<tbody><tr><td class="err" style="padding:14px">${esc(CRO.err)}</td></tr></tbody>`; return; }
  if (!CRO.loaded) { tbl.innerHTML = '<tbody><tr><td class="muted" style="padding:14px">Reading the creator orders…</td></tr></tbody>'; return; }
  const rows = croRows();
  const head = '<thead><tr><th style="width:28px"><input type="checkbox" id="croAll" title="Tick every order on screen"></th>'
    + ['Order', 'Creator', 'Product', 'Value', 'Ship from', 'Status', 'Next step', 'Campaign'].map((t, i) => `<th class="${i === 0 ? 'frz' : ''}${t === 'Value' ? ' num' : ''}">${t}</th>`).join('') + '</tr></thead>';
  const sub = t => (t ? '<span class="sub">' + t + '</span>' : '');
  const drawn = rows.slice(0, CRO.cap);
  const body = drawn.map(o => {
    const c = o.creator || {}, s = o.shipTo || {}, age = croAge(o), n = croUnits(o);
    const done = o.status === 'Delivered' || o.status === 'Cancelled';
    const warn = o.lastReportError || (o.setu && o.setu.error) ? '<span class="sub" style="color:var(--bad)">Creator Setu not told</span>' : '';
    return `<tr data-cro="${esc(o.reference)}" style="cursor:pointer">`
      + `<td><input type="checkbox" class="croPick" data-ref="${esc(o.reference)}"${CRO.picked.has(o.reference) ? ' checked' : ''}></td>`
      + `<td class="frz tl" style="font-weight:600">${esc(o.reference)}${sub(esc(croDay(o.createdAt)) + (done ? '' : ` <span class="so-age${age >= 7 ? ' old' : ''}" title="${nf(age)} day(s) since it came in">${nf(age)}d</span>`))}</td>`
      + `<td class="tl"><b>${esc(c.name || s.name || '—')}</b>${sub(esc([croHandle(c.instagram), [s.state, s.country].filter(Boolean).join(', '), n + ' unit' + (n === 1 ? '' : 's')].filter(Boolean).join(' · ')))}</td>`
      + `<td class="tl wrap">${(o.lines || []).map(l => { const d = croLineDesc(l);
          return `<div><span style="white-space:nowrap;font-family:ui-monospace,monospace;font-weight:600">${esc(l.sku || '—')}</span>`
            + ` <span>${d ? esc(d) + ' ' : ''}× ${nf(l.quantity)}</span></div>`; }).join('')}</td>`
      + `<td class="num">${croMoney(croValue(o))}</td>`
      + `<td class="tl">${croShipFrom(o)}</td>`
      + `<td class="tl"><span class="st ${CRO_PILL[o.status] || 'st-draft'}">${esc(o.status || 'New')}</span>${warn}</td>`
      + `<td class="tl cro-next">${croNext(o)}</td>`
      + `<td class="tl">${esc(o.campaign || '—')}${sub(o.source === 'team' ? 'Entered by team' : 'Creator Setu')}</td></tr>`;
  }).join('');
  const more = rows.length > drawn.length ? `<tr><td colspan="9" style="padding:10px 14px;text-align:left"><span class="muted">Showing ${nf(drawn.length)} of ${nf(rows.length)} — search, or </span><button type="button" class="ghost" id="croMore" style="padding:4px 12px;font-size:12px">show ${nf(Math.min(CRO_CAP_STEP, rows.length - drawn.length))} more</button></td></tr>` : '';
  tbl.innerHTML = head + '<tbody>' + (body || `<tr><td colspan="9" class="muted" style="padding:14px">${CRO.list.length ? 'Nothing matches these filters.' : 'No creator order yet. They arrive from Creator Setu, or press + Create order.'}</td></tr>`) + more + '</tbody>';
  if ($('croAll')) $('croAll').checked = drawn.length > 0 && drawn.every(o => CRO.picked.has(o.reference));
  if ($('croCount')) $('croCount').textContent = `${nf(rows.length)} shown of ${nf(CRO.list.length)}` + (CRO.picked.size ? ` · ${nf(CRO.picked.size)} ticked` : '');
  croMsg(CRO.msg, CRO.bad);
}

/* ---------------- the order (the shared dialog, as Returns opens its cases) ---------------- */
let CRO_SKUS = null;
/** Every SKU the master knows, for the product search — the master database the Shopify screens use. */
function croSkuList() {
  if (CRO_SKUS && CRO_SKUS.length) return CRO_SKUS;
  const seen = new Set(), out = [];
  (PTG.mdb || []).forEach(r => { const k = obUC(r && r.sku); if (k && !seen.has(k)) { seen.add(k); out.push([k, croLineDesc(croFactsOf(r))]); } });
  Object.keys(SHOP_STOCK || {}).forEach(k => { if (!seen.has(k)) { seen.add(k); out.push([SHOP_STOCK_CASE[k] || k, 'in FBA']); } });
  CRO_SKUS = out.sort((a, b) => a[0].localeCompare(b[0]));
  return CRO_SKUS;
}
const croSkuDatalist = id => `<datalist id="${id}">${croSkuList().slice(0, 6000).map(([k, d]) => `<option value="${esc(k)}">${esc(d)}</option>`).join('')}</datalist>`;
/** A part of a line's name, or '' — an empty size (some products have none) shows nothing, never a dash. */
function croPart(v) {
  const s = String(v == null ? '' : v).trim();
  return /^(-+|—|–|null|undefined|n\/?a)$/i.test(s) ? '' : s;
}
/** "Tablecloth · Ruby Red · 60" x 60"" — title, colour and size, whichever of them there are (Khushi, 17 Nov). */
const croLineDesc = l => [l && l.title, l && l.color, l && l.size].map(croPart).filter(Boolean).join(' · ');
/** What the master says a SKU is: the article as the title (Creator Setu sends "Tablecloth", the article), colour, size. */
function croFactsOf(m) {
  return m ? { title: croPart(m.articleType || m.subtype), color: croPart(m.color), size: croPart(m.size) } : null;
}
function croSkuFacts(sku) { return croFactsOf(typeof mdbOf === 'function' ? mdbOf(sku) : null); }
/** The same, asking the database for that one SKU when this page's copy of the master does not have it (yet). */
async function croSkuFactsNow(sku) {
  const f = croSkuFacts(sku);
  if (f || !String(sku || '').trim() || typeof mdbFetchSku !== 'function') return f;
  try { return croFactsOf(await mdbFetchSku(sku)); } catch (e) { return null; }
}

/** New → Checked → Sent to Amazon → Shipped → Delivered across the top of the order, each with the day it happened. */
function croProgress(o) {
  const a = o.amazon || {};
  const steps = [['New', o.createdAt], ['Checked', o.checkedAt], ['Sent to Amazon', a.sentAt], ['Shipped', a.shippedAt], ['Delivered', a.deliveredAt]];
  const at = steps.findIndex(s => s[0] === o.status);
  const reached = at >= 0 ? at : Math.max(0, ...steps.map((s, i) => (s[1] ? i : 0)));
  const off = o.status === 'Problem' || o.status === 'Cancelled';
  const bar = steps.map(([t, when], i) => {
    const cls = i < reached || (i === reached && !off && o.status === 'Delivered') ? 'done' : i === reached && !off ? 'now' : '';
    return `<div class="cro-step ${cls}"><i>${i < reached || o.status === 'Delivered' ? '✓' : i + 1}</i><b>${esc(t)}</b><span>${when && i <= reached ? esc(croDay(when)) : '&nbsp;'}</span></div>`;
  }).join('');
  const banner = off ? `<div class="cro-off">${o.status === 'Problem' ? 'Problem — needs a person' : 'Cancelled'}${o.notes ? ': ' + esc(String(o.notes).slice(0, 120)) : ''}</div>` : '';
  return `<div class="cro-steps">${bar}</div>${banner}`;
}

function croOpen(ref) {
  const o = croOf(ref);
  if (!o) { croMsg('Order ' + ref + ' not found.', true); return; }
  try { history.replaceState(null, '', '#creators?ref=' + encodeURIComponent(ref)); } catch (e) { /* only the address */ }
  const s = o.shipTo || {}, c = o.creator || {}, a = o.amazon || {};
  const edit = CRO_EDITABLE(o.status);
  const p = croPlan(o);
  const to = [s.name, s.line1, s.line2, s.city, [s.state, s.zip].filter(Boolean).join(' '), s.country].filter(Boolean).join(', ');
  const lineRows = (o.lines || []).map((l, i) => {
    const st = croLineStock(o, l), ordered = l.ordered != null ? l.ordered : l.quantity;
    return `<tr>
      <td>${edit ? `<input data-cro-sku="${i}" list="croSkuDl" value="${esc(l.sku || '')}" style="font-family:ui-monospace,monospace;min-width:150px" autocomplete="off">` : `<span style="font-family:ui-monospace,monospace">${esc(l.sku || '—')}</span>`}</td>
      <td style="text-align:left" data-cro-name="${i}">${esc(croLineDesc(l))}</td>
      <td class="num">${nf(ordered)}</td>
      <td class="num">${edit ? `<input type="number" min="1" max="20" step="1" data-cro-qty="${i}" value="${esc(l.quantity)}" style="width:64px">` : nf(l.quantity)}</td>
      <td class="num">${!SHOP_STOCK_LOADED ? '<span class="muted">?</span>' : st.have == null ? '<span class="muted">not in FBA</span>' : `<b style="color:${st.ok ? 'var(--accent)' : 'var(--bad)'}">${nf(st.have)}</b>`}</td>
      <td>${a.orderId ? '<span class="st st-approved">MCF done</span>' : !SHOP_STOCK_LOADED ? '<span class="muted">—</span>' : st.ok ? '<span class="st st-approved">FBA ready</span>' : `<span class="st st-rejected">${st.india ? 'India ' + nf(st.india) : 'no stock'}</span>`}</td>
    </tr>`;
  }).join('');
  const mcfBox = a.orderId
    ? `<div><span class="st st-approved">Sent to Amazon</span> <span class="muted">${esc(a.orderId)}${a.sentAt ? ' · ' + esc(croDay(a.sentAt)) : ''}${a.speed ? ' · ' + esc(a.speed) : ''}</span></div>`
      + (a.status ? `<div class="muted" style="margin-top:4px">Amazon: ${esc(a.status)}</div>` : '')
      + (a.tracking ? `<div style="margin-top:6px">Tracking: ${croTrackHtml(a)}</div>` : '<div class="muted" style="margin-top:4px">No tracking yet — Amazon gives it once the parcel leaves the warehouse</div>')
      + (a.checkedAt ? `<div class="muted" style="font-size:11.5px;margin-top:4px">Last asked Amazon ${esc(croWhen(a.checkedAt))}</div>` : '')
      + '<div style="margin-top:8px"><button type="button" class="ghost" id="croMcfStatus" style="padding:4px 12px;font-size:12px">Check status with Amazon</button></div>'
    : `<div class="mcf-plan"><div class="mcf-h ${p.ok ? 'ok' : 'bad'}">${!SHOP_STOCK_LOADED ? 'Amazon stock has not been read yet'
        : p.ok ? esc(soAcctName(p.acct)) + ' FBA can ship ' + nf(p.lines.length) + ' of ' + nf(p.lines.length) + ' line' + (p.lines.length === 1 ? '' : 's')
        : esc(soAcctName(p.acct)) + ' FBA cannot ship all of it: ' + esc(p.short.map(x => (x.l.sku || '?') + (x.have == null ? ' (not in FBA)' : ' (only ' + x.have + ')')).join(', '))}</div></div>`
      + `<div class="muted" style="font-size:11.5px;margin-top:6px">Amazon order id: <b>${esc(String(o.reference))}</b> — Amazon refuses a second order for the same gift.</div>`
      + (o.status === 'Checked' && p.ok
        ? '<div style="margin-top:8px"><button type="button" class="jw-btn jw-primary" id="croMcfPreview" style="padding:5px 12px;font-size:12.5px">Check speeds &amp; cost</button></div><div id="croMcfPrev" style="margin-top:8px"></div>'
        : `<div class="muted" style="font-size:12px;margin-top:8px">${o.status === 'New' ? 'Check the product first, then press Checked ✓.' : o.status === 'Checked' ? 'Change the SKU or the quantity so FBA can ship every line, or set the status to Problem.' : 'Set the status back to Checked to send it.'}</div>`);
  ptOpenDialog({
    title: 'Order # ' + o.reference, wide: true,
    subtitle: [croStore(o), o.source === 'team' ? 'Entered by team' : 'Creator Setu', o.campaign].filter(Boolean).join(' · '),
    titleExtra: `<span class="st ${CRO_PILL[o.status] || 'st-draft'}" style="margin-left:8px">${esc(o.status || 'New')}</span>`
      + (a.tracking ? '' : ' <span class="muted" style="font-size:12px;margin-left:6px">No tracking yet</span>'),
    html: `${croProgress(o)}<div style="font-size:13px;margin:-2px 0 10px">${esc(to || 'No address')}${s.phone ? ' · ' + esc(s.phone) : ''}${c.instagram ? ' · ' + esc(croHandle(c.instagram)) : ''}${c.email ? ' · ' + esc(c.email) : ''}</div>
      <div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:14px" class="cro-grid">
        <div class="card" style="padding:10px 12px;margin:0">
          <div class="muted" style="font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Product · recheck before sending</div>
          <div class="xlwrap"><table class="xl" style="font-size:12.5px;width:100%"><thead><tr><th>SKU</th><th>Product</th><th class="num">Ordered</th><th class="num">Send qty</th><th class="num">FBA stock</th><th>Route</th></tr></thead><tbody>${lineRows}</tbody></table></div>
          ${edit ? croSkuDatalist('croSkuDl') : ''}
          <div class="muted" style="font-size:12px;margin-top:6px">${o.source === 'team' ? 'Typed by ' + esc(o.createdBy || 'the team') + '.' : 'The creator chose this product on the Creator Setu gift link.'} Change the SKU only if it is wrong.</div>
          ${o.status === 'New' ? '<div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="jw-btn jw-primary" id="croChecked" style="padding:5px 12px;font-size:12.5px">Checked ✓</button><span class="muted" style="font-size:12px">Saves the lines and moves the order from New to Checked</span></div>' : ''}
          ${o.checkedBy ? `<div class="muted" style="font-size:11.5px;margin-top:6px">Checked by ${esc(o.checkedBy)}${o.checkedAt ? ' · ' + esc(croDay(o.checkedAt)) : ''}</div>` : ''}
        </div>
        <div class="card" style="padding:10px 12px;margin:0">
          <div class="muted" style="font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Send to Amazon (MCF)</div>
          ${mcfBox}
          ${croSetuLine(o)}
          <label style="margin-top:10px;display:block">Order status<select id="croStatus">${CRO_STATUSES.map(x => `<option${x === (o.status || 'New') ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
          <label style="margin-top:8px;display:block">Notes<textarea id="croNotes" rows="3" style="width:100%">${esc(o.notes || '')}</textarea></label>
        </div>
      </div>
      ${(o.log || []).length ? `<details style="margin-top:10px;font-size:12px"><summary class="muted">History (${nf(o.log.length)})</summary>${o.log.slice().reverse().map(x => `<div class="muted">${esc(croDay(x.at))} · ${esc(x.by || '')} — ${esc(x.what || '')}</div>`).join('')}</details>` : ''}`,
    saveLabel: 'Save',
    /* DELETE (Ravi, 19 Nov: "a delete button for every order") — the dialog's own Delete button and its confirm box,
     * for every order that has not gone to Amazon. One that has is a real parcel: it is not deleted, it is set Cancelled. */
    ...(a.orderId ? {} : { onDelete: () => croDelete(o.reference), deleteAllowed: true,
      deleteWhat: `Order ${o.reference} · ${(o.creator || {}).name || s.name || ''} · ${(o.lines || []).map(l => (l.sku || '') + ' × ' + l.quantity).join(', ')}`
        + (croIsSetuGift(o) ? '\n\nCreator Setu is NOT told. To tell them, set the status to Cancelled instead.' : '') }),
    onCancel: () => { try { history.replaceState(null, '', '#creators'); } catch (e) { /* only the address */ } croRender(); },
    onSave: async () => {
      const err = await croSaveDrawer(o.reference, false);
      if (!err) { try { history.replaceState(null, '', '#creators'); } catch (e) { /* only the address */ } setTimeout(croRender, 0); }
      return err;
    },
  });
  /* THE NAME, COLOUR AND SIZE FOLLOW THE SKU TYPED (Khushi, 17 Nov: "so they recheck the right piece"), from the product
   * list — asked of the database for that one SKU when this page's copy does not have it. A SKU typed back to the
   * order's own shows the order's own words again. */
  document.querySelectorAll('[data-cro-sku]').forEach(inp => { inp.onchange = async () => {
    const i = +inp.getAttribute('data-cro-sku'), cell = document.querySelector('[data-cro-name="' + i + '"]');
    const line = (o.lines || [])[i] || {}, typed = String(inp.value || '').trim();
    if (!cell) return;
    if (obUC(typed) === obUC(line.sku)) { cell.textContent = croLineDesc(line); return; }
    cell.textContent = 'Looking it up…';
    const f = await croSkuFactsNow(typed);
    if (String(inp.value || '').trim() !== typed) return;            // typed again meanwhile: that answer is the one shown
    cell.textContent = f ? (croLineDesc(f) || '(no name, colour or size in the product list)')
      : (obUC(typed) in (SHOP_STOCK || {}) ? 'in FBA, not in the product list — colour and size unknown' : 'not in the product list');
    cell.style.color = f ? '' : 'var(--bad)';
  }; });
  if ($('croChecked')) $('croChecked').onclick = async () => {
    $('croChecked').disabled = true;
    const err = await croSaveDrawer(o.reference, true);
    if (err) { ptDlgMsg(err, true); $('croChecked').disabled = false; return; }
    croOpen(o.reference); croRender();
  };
  if ($('croMcfPreview')) $('croMcfPreview').onclick = () => croPreview(o.reference);
  if ($('croRetryReport')) $('croRetryReport').onclick = async () => {
    $('croRetryReport').disabled = true; $('croRetryReport').textContent = 'Telling Creator Setu…';
    const err = await croReport(o.reference, true);
    croOpen(o.reference); croRender();
    if (err) ptDlgMsg(err, true); else ptDlgMsg('Creator Setu was told.');
  };
  if ($('croMcfStatus')) $('croMcfStatus').onclick = async () => {
    $('croMcfStatus').disabled = true; $('croMcfStatus').textContent = 'Asking Amazon…';
    const err = await croStatusOne(o.reference);
    if (err) { ptDlgMsg(err, true); $('croMcfStatus').disabled = false; $('croMcfStatus').textContent = 'Check status with Amazon'; return; }
    croOpen(o.reference); croRender();
  };
}
/** Delete one order for good (the dialog has already asked). Never one Amazon has: that is a real parcel. '' or why not. */
async function croDelete(ref) {
  const o = croOf(ref); if (!o) return 'That order is gone — press Refresh.';
  if (o.amazon && o.amazon.orderId) return ref + ' is with Amazon as ' + o.amazon.orderId + ' — it cannot be deleted. Set it to Cancelled instead.';
  const f = typeof fsDeleteDoc === 'function' ? fsDeleteDoc : deleteDoc;    // the live mirror's where this ERP has one
  try { await f(doc(db, CRO_COL, String(ref))); }
  catch (e) {
    return /permission|insufficient/i.test(String(e && (e.code || e.message)))
      ? 'Not deleted: the database does not allow it yet — the Firestore rule for creator orders needs its delete line.'
      : 'Not deleted: ' + (e.message || e);
  }
  CRO.list = CRO.list.filter(x => x !== o);
  CRO.picked.delete(ref);
  try { history.replaceState(null, '', '#creators'); } catch (e) { /* only the address */ }
  croMsg(ref + ' deleted.');
  setTimeout(croRender, 0);
  return '';
}
/** The drawer's lines, status and notes, saved. checked = the Checked ✓ button (New → Checked). Returns '' or why not. */
async function croSaveDrawer(ref, checked) {
  const o = croOf(ref); if (!o) return 'That order is gone — press Refresh.';
  const patch = {}, said = [];
  if (CRO_EDITABLE(o.status)) {
    const lines = [];
    for (let i = 0; i < (o.lines || []).length; i++) {
      const l = o.lines[i];
      const skuIn = document.querySelector('[data-cro-sku="' + i + '"]'), qtyIn = document.querySelector('[data-cro-qty="' + i + '"]');
      const sku = skuIn ? String(skuIn.value || '').trim() : l.sku, qty = qtyIn ? parseInt(qtyIn.value, 10) || 0 : l.quantity;
      const out = Object.assign({}, l);
      if (sku && obUC(sku) !== obUC(l.sku)) {
        /* A changed SKU takes the product list's name, colour and size — never the old piece's. A SKU the list does not
         * know is refused unless Amazon stocks it (then its colour and size are simply unknown). */
        const f = await croSkuFactsNow(sku);
        if (!f && !(obUC(sku) in (SHOP_STOCK || {}))) return sku + ' is not in the product list — pick it from the list.';
        said.push(`SKU ${l.sku || '—'} → ${sku}${f && croLineDesc(f) ? ' (' + croLineDesc(f) + ')' : ''}`);
        Object.assign(out, { sku, title: (f && f.title) || '', color: (f && f.color) || '', size: (f && f.size) || '', asin: '', skuWas: l.skuWas || l.sku });
      }
      if (qty !== (parseInt(l.quantity, 10) || 0)) { said.push(`${sku}: qty ${l.quantity} → ${qty}`); if (out.ordered == null) out.ordered = l.quantity; out.quantity = qty; }
      lines.push(out);
    }
    if (lines.some(l => !String(l.sku || '').trim())) return 'Every line needs a SKU.';
    if (lines.some(l => !(l.quantity >= 1 && l.quantity <= 20))) return 'Send qty is 1 to 20 on every line.';
    if (said.length) patch.lines = lines;
  }
  let status = ($('croStatus') || {}).value || o.status;
  if (checked) {
    if (o.status !== 'New') return 'Only a New order is checked.';
    status = 'Checked'; patch.checkedBy = ME.email; patch.checkedAt = new Date().toISOString();
  }
  if (status !== o.status) {
    /* What went to Amazon stays with Amazon: an order is not put back before "Sent" by hand once it has an Amazon id. */
    if (o.amazon && o.amazon.orderId && CRO_EDITABLE(status) && status !== 'Problem') return 'This gift is already with Amazon as ' + o.amazon.orderId + ' — it cannot go back to ' + status + '.';
    if (!o.amazon || !o.amazon.orderId) { if (status === 'Sent to Amazon' || status === 'Shipped') return 'Use Send to Amazon — the status follows by itself.'; }
    patch.status = status; said.push('status ' + (o.status || 'New') + ' → ' + status);
    if (status === 'Delivered') patch.amazon = Object.assign({}, o.amazon || {}, { deliveredAt: (o.amazon || {}).deliveredAt || new Date().toISOString() });
  }
  const notes = $('croNotes') ? String($('croNotes').value || '').slice(0, 2000) : o.notes;
  if ((notes || '') !== (o.notes || '')) { patch.notes = notes; said.push('notes'); }
  if (!said.length) return '';
  return croSave(ref, patch, said.join(' · '));
}

/* ---------------- MCF: the same backend calls as Shopify Orders ---------------- */
function croMcfPayload(o, speed) {
  const s = o.shipTo || {}, p = croPlan(o);
  return { no: String(o.reference), id: 'CC-' + String(o.reference), at: croDay(o.approvedAt || o.createdAt) || sdToday(),
    ship: { name: s.name || (o.creator || {}).name || '', a1: s.line1 || '', a2: s.line2 || '', city: s.city || '', state: s.state || '', zip: s.zip || '', country: s.country || 'US', phone: s.phone || '' },
    brand: p.acct, shop: '', items: p.lines.map(x => ({ sku: x.amz, qty: x.need })), speed: speed || 'Standard',
    comment: 'A gift from ' + (croAcct(o) === 'CPC' ? 'Cotton Print Club' : 'Ridhi Home & Living') + '. Enjoy!' };
}
/* A TEST copy only. The R1 data layer (shared/erp-data/layer.js) sets window.__TEST_ERP on the REAL site too since the 22 Nov Supabase switch — with mode 'live' —
 * so that flag alone made every real "Send to Amazon" say "not sent from the test ERP" (27 Nov, Ravi, order CGE-0983CANYGP on fabricrush-replenish.web.app). */
const croTestErp = () => !!(typeof window !== 'undefined' && window.__TEST_ERP && window.__TEST_ERP.mode !== 'live' && !window.__TEST_ERP.hubMcfWrites);
async function croPreview(ref) {
  const o = croOf(ref); if (!o) return;
  const btn = $('croMcfPreview'), box = $('croMcfPrev'); if (!btn || !box) return;
  btn.disabled = true; btn.textContent = 'Asking Amazon…';
  try {
    const d = await apiPost({ mcf: 'preview', order: croMcfPayload(o) });
    const rows = (d.previews || []).map(p => `<tr><td style="padding:4px 8px"><b>${esc(p.speed)}</b></td>`
      + `<td class="num">${p.ok ? '$' + Number(p.fee || 0).toFixed(2) : '<span class="muted">—</span>'}</td>`
      + `<td>${p.arriveBy ? 'by ' + esc(p.arriveBy) : '<span class="muted">—</span>'}</td>`
      + `<td>${p.ok ? `<button type="button" class="ghost" data-cro-send="${esc(p.speed)}" data-fee="${esc('$' + Number(p.fee || 0).toFixed(2))}" style="padding:3px 10px;font-size:12px">Send to Amazon</button>` : `<span class="fu fu-amber" title="${esc((p.unfulfillable || []).join(' · '))}">can't ship</span>`}</td></tr>`).join('');
    box.innerHTML = rows ? `<table class="xl" style="font-size:12px;width:100%"><tbody>${rows}</tbody></table><div class="muted" style="font-size:11.5px;margin-top:6px">Fees are Amazon's estimate. Sending places a real shipment on <b>${esc(soAcctName(croAcct(o)))}</b> FBA — it cannot be undone from here.</div>`
      : '<span class="fu fu-amber">Amazon offered no shipping option for this order.</span>';
    box.querySelectorAll('[data-cro-send]').forEach(b => { b.onclick = async () => {
      b.disabled = true;
      const err = await croSend(ref, b.getAttribute('data-cro-send'), b.getAttribute('data-fee'), true);
      if (err) { box.innerHTML = '<div class="err">' + err + '</div>'; return; }
      croOpen(ref); croRender();
    }; });
  } catch (e) {
    box.innerHTML = '<div class="err">' + mcfErr(e, 'Could not check speeds', { acct: soAcctName(croAcct(o)), skus: croPlan(o).lines.map(x => x.amz) }) + '</div>';
  }
  btn.disabled = false; btn.textContent = 'Check speeds & cost';
}
/**
 * SEND ONE GIFT TO AMAZON. Returns '' or why not (html). ask = show the last gate (one order); the bulk send asks once
 * for all of them. Only a Checked order whose every line its brand's FBA holds is sent — whole, never in halves.
 */
async function croSend(ref, speed, fee, ask) {
  const o = croOf(ref); if (!o) return 'That order is gone — press Refresh.';
  if (o.amazon && o.amazon.orderId) return '';
  if (o.status !== 'Checked') return esc(ref) + ' is ' + esc(o.status) + ' — only a Checked order is sent.';
  const p = croPlan(o);
  if (!p.ok) return esc(ref) + ': ' + esc(soAcctName(p.acct)) + ' FBA cannot ship every line.';
  if (croTestErp()) return 'Real MCF parcels are not sent from the test ERP — send it from the real ERP.';
  const s = o.shipTo || {};
  if (ask && !confirm(`Ship gift ${ref} from ${soAcctName(p.acct)} FBA?\n\n${speed || 'Standard'}${fee ? ' · ' + fee : ''}\n`
    + `To: ${[s.name, s.line1, s.line2, s.city, s.state, s.zip, s.country].filter(Boolean).join(', ')}\n`
    + p.lines.map(x => `${x.amz}${obUC(x.amz) !== obUC(x.l.sku) ? ' (ERP: ' + x.l.sku + ')' : ''} x${x.need}`).join('\n')
    + '\n\nAmazon will pick, pack and ship this. It cannot be cancelled from this app.')) return 'Not sent.';
  let d;
  try { d = await apiPost({ mcf: 'create', order: croMcfPayload(o, speed) }); }
  catch (e) { return mcfErr(e, 'Could not send ' + ref, { acct: soAcctName(p.acct), skus: p.lines.map(x => x.amz) }); }
  const now = new Date().toISOString();
  const err = await croSave(ref, { status: 'Sent to Amazon',
    amazon: Object.assign({}, o.amazon || {}, { orderId: d.mcfId, sentAt: now, sentBy: ME.email, speed: speed || 'Standard', brand: p.acct }) },
    (d.already ? 'was already with Amazon as ' : 'sent to Amazon as ') + d.mcfId + ' (' + (speed || 'Standard') + ')');
  if (err) return esc(ref) + ' was sent to Amazon as ' + esc(d.mcfId) + ', but the ERP could not save it: ' + esc(err) + ' — do NOT press Send again; tell an admin.';
  croMsg(d.already ? `${ref} was already with Amazon as ${d.mcfId} — nothing was sent twice.` : `${ref} sent to Amazon as ${d.mcfId}. Check status later for the tracking number.`);
  return '';
}
/** What Amazon has done with one gift: its state and the tracking. Returns '' or why not. */
async function croStatusOne(ref) {
  const o = croOf(ref); const a = (o && o.amazon) || {};
  if (!a.orderId) return '';
  let d;
  try { d = await apiPost({ mcf: 'status', mcfId: a.orderId, brand: a.brand || croAcct(o) }); }
  catch (e) { return 'Could not ask Amazon: ' + String(e.message || e).slice(0, 200); }
  const trk = (d.trk || []).join(', '), st = String(d.status || '');
  const patch = { amazon: Object.assign({}, a, { status: st, tracking: trk || a.tracking || '', carrier: d.trkCo || a.carrier || '', shippedAt: d.shippedAt || a.shippedAt || '', checkedAt: new Date().toISOString() }) };
  let what = 'Amazon: ' + (st || '?') + (trk ? ' · ' + trk : '');
  if (o.status === 'Sent to Amazon' && (trk || /^COMPLETE/i.test(st))) { patch.status = 'Shipped'; what += ' · status → Shipped'; }
  if (/^(UNFULFILLABLE|INVALID)$/i.test(st) && o.status !== 'Problem') { patch.status = 'Problem'; what += ' · status → Problem'; }
  if (/^CANCELLED$/i.test(st) && o.status !== 'Cancelled') { patch.status = 'Cancelled'; what += ' · status → Cancelled'; }
  if (st === a.status && (trk || a.tracking || '') === (a.tracking || '') && !patch.status) {
    CRO.list[CRO.list.indexOf(o)] = Object.assign({}, o, patch);   // nothing new to write
    return '';
  }
  return croSave(ref, patch, what);
}
/** Send every ticked Checked gift that FBA can ship, Standard speed, after one look at the list. */
async function croSendTicked() {
  const picked = [...CRO.picked].map(croOf).filter(Boolean);
  if (!picked.length) { croMsg('Tick the orders to send first.', true); return; }
  const go = picked.filter(o => o.status === 'Checked' && !(o.amazon && o.amazon.orderId) && croPlan(o).ok);
  const skip = picked.filter(o => !go.includes(o));
  if (!go.length) { croMsg('None of the ticked orders can go: an order is sent once it is Checked and its brand\'s FBA holds every line.', true); return; }
  if (croTestErp()) { croMsg('Real MCF parcels are not sent from the test ERP.', true); return; }
  if (!confirm(`Send ${go.length} gift${go.length === 1 ? '' : 's'} to Amazon MCF, Standard speed?\n\n`
    + go.map(o => `${o.reference} · ${(o.shipTo || {}).name || ''} · ${soAcctName(croAcct(o))} FBA · ${(o.lines || []).map(l => l.sku + ' x' + l.quantity).join(', ')}`).join('\n')
    + (skip.length ? `\n\nNot sent (not Checked, already sent, or not in FBA): ${skip.map(o => o.reference).join(', ')}` : '')
    + '\n\nAmazon will pick, pack and ship these. They cannot be cancelled from this app.')) return;
  CRO.busy = true; let sent = 0; const bad = [];
  for (const o of go) {
    croMsg(`Sending ${o.reference} (${sent + bad.length + 1} of ${go.length})…`);
    const err = await croSend(o.reference, 'Standard', '', false);
    if (err) bad.push(o.reference + ': ' + String(err).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()); else { sent++; CRO.picked.delete(o.reference); }
  }
  CRO.busy = false;
  croMsg(`${nf(sent)} sent to Amazon.` + (bad.length ? ' Not sent: ' + bad.join(' · ') : ''), !!bad.length);
  croRender();
}
/** Ask Amazon about every gift it has and has not delivered yet. */
async function croStatusAll() {
  const list = CRO.list.filter(o => o.amazon && o.amazon.orderId && (o.status === 'Sent to Amazon' || o.status === 'Shipped' && !(o.amazon || {}).tracking)).slice(0, 40);
  if (!list.length) { croMsg('Nothing with Amazon is waiting for news.'); return; }
  let n = 0; const bad = [];
  for (const o of list) {
    croMsg(`Asking Amazon about ${o.reference} (${n + bad.length + 1} of ${list.length})…`);
    const err = await croStatusOne(o.reference);
    if (err) bad.push(o.reference); else n++;
  }
  croMsg(`${nf(n)} checked with Amazon.` + (bad.length ? ' Could not check: ' + bad.join(', ') : ''), !!bad.length);
  croRender();
}
/* AUTOMATIC TRACKING (Ravi, 24 Nov: "get the tracking"): when the page opens on the real ERP, ask Amazon — quietly, one
 * order at a time — about every gift it has not shipped yet (or shipped without a number), unless someone asked in the
 * last 30 minutes. A new tracking number moves the order to Shipped and tells Creator Setu, the same as the button. */
const CRO_ASKED = new Set();
const CRO_AUTO_GAP = 30 * 60e3, CRO_AUTO_MAX = 15;
function croTrackDue(o, now) {
  const a = o.amazon || {};
  if (!a.orderId || CRO_ASKED.has(o.reference)) return false;
  if (!(o.status === 'Sent to Amazon' || (o.status === 'Shipped' && !a.tracking))) return false;
  const t = Date.parse(String(a.checkedAt || ''));
  return isNaN(t) || (now || Date.now()) - t >= CRO_AUTO_GAP;
}
async function croTrackAuto() {
  if (CRO.busy || !croReportOn()) return 0;
  const due = CRO.list.filter(o => croTrackDue(o)).slice(0, CRO_AUTO_MAX);
  let moved = 0;
  for (const o of due) {
    CRO_ASKED.add(o.reference);
    const was = o.status, err = await croStatusOne(o.reference);
    const now = croOf(o.reference);
    if (!err && now && now.status !== was) moved++;
  }
  if (due.length) { if (moved) croMsg(`Amazon update: ${nf(moved)} order${moved === 1 ? '' : 's'} moved on (tracking added).`); croRender(); }
  return due.length;
}

/* ---------------- + Create order (for a creator who never filled the gift link) ---------------- */
async function croNextRef() {
  const used = CRO.list.map(o => /^ERP-CC-(\d+)$/.exec(String(o.reference || ''))).filter(Boolean).map(m => parseInt(m[1], 10));
  let n = (used.length ? Math.max(...used) : 0) + 1;
  for (let tries = 0; tries < 20; tries++, n++) {
    const ref = 'ERP-CC-' + String(n).padStart(4, '0');
    try { const s = await getDoc(doc(db, CRO_COL, ref)); if (!s.exists()) return ref; } catch (e) { return ref; }
  }
  return 'ERP-CC-' + Date.now().toString(36).toUpperCase();
}
/** The same checks as the backend makes on a Creator Setu order (CreatorOrders.gs). '' or what is missing. */
function croCheckNew(v) {
  if (!v.name) return 'Type the creator\'s name.';
  if (!v.line1) return 'Street line 1 is missing.';
  if (!v.city) return 'City is missing.';
  if (!/^[A-Za-z]{2}$/.test(v.country)) return 'Country is two letters (US).';
  if (v.country.toUpperCase() === 'US' && !/^[A-Za-z]{2}$/.test(v.state)) return 'State is two letters (OR, TX…).';
  if (!v.zip) return 'ZIP is missing.';
  if (v.country.toUpperCase() === 'US' && !/^\d{5}(-\d{4})?$/.test(v.zip)) return 'A US ZIP is 5 digits (or 5+4).';
  if (!v.sku) return 'Pick the SKU.';
  if (!(v.qty >= 1 && v.qty <= 20)) return 'Quantity is 1 to 20.';
  return '';
}
function croNewOpen() {
  ptOpenDialog({
    title: '+ Create creator order', subtitle: 'For a creator who did not fill the Creator Setu gift link', wide: true,
    fields: [
      { key: 'brand', label: 'Brand', type: 'select', options: [['ridhi', 'Ridhi'], ['cotton-print-club', 'CPC']], value: CRO.store === 'CPC' ? 'cotton-print-club' : 'ridhi' },
      { key: 'campaign', label: 'Campaign', value: '', list: [...new Set(CRO.list.map(o => o.campaign).filter(Boolean))] },
      { key: 'name', label: 'Creator name', value: '' },
      { key: 'instagram', label: 'Instagram @handle', value: '' },
      { key: 'line1', label: 'Street line 1', value: '', span: true },
      { key: 'line2', label: 'Street line 2', value: '', span: true },
      { key: 'city', label: 'City', value: '' },
      { key: 'state', label: 'State (2 letters)', value: '' },
      { key: 'zip', label: 'ZIP', value: '' },
      { key: 'country', label: 'Country', value: 'US' },
      { key: 'phone', label: 'Phone', value: '' },
      { key: 'email', label: 'Email (optional)', value: '' },
      { key: 'sku', label: 'SKU (search the product list)', value: '', list: croSkuList().map(x => x[0]) },
      { key: 'qty', label: 'Quantity', type: 'number', min: 1, step: 1, value: 1 },
    ],
    saveLabel: 'Create order', onCancel: () => croRender(),
    onSave: async raw => {
      const t = k => String(raw[k] == null ? '' : raw[k]).trim();
      const v = { brand: CRO_BRANDS[t('brand')] ? t('brand') : 'ridhi', campaign: t('campaign'), name: t('name'), instagram: t('instagram').replace(/^@+/, ''),
        line1: t('line1'), line2: t('line2'), city: t('city'), state: t('state').toUpperCase(), zip: t('zip'), country: (t('country') || 'US').toUpperCase(),
        phone: t('phone'), email: t('email'), sku: t('sku'), qty: parseInt(t('qty'), 10) || 0 };
      const bad = croCheckNew(v); if (bad) return bad;
      const f = await croSkuFactsNow(v.sku);
      if (!f && !(obUC(v.sku) in (SHOP_STOCK || {}))) return v.sku + ' is not in the master database or in FBA — pick it from the list.';
      const ref = await croNextRef(), now = new Date().toISOString();
      const rec = { reference: ref, brand: v.brand, campaign: v.campaign,
        creator: { name: v.name, instagram: v.instagram, email: v.email },
        shipTo: { name: v.name, line1: v.line1, line2: v.line2 || null, city: v.city, state: v.state, zip: v.zip, country: v.country, phone: v.phone },
        lines: [{ sku: v.sku, asin: '', title: (f && f.title) || '', color: (f && f.color) || '', size: (f && f.size) || '', quantity: v.qty, priceUsd: 0 }],
        status: 'New', source: 'team', approvedAt: now, createdAt: now, createdBy: ME.email, notes: '',
        log: [{ at: now, by: ME.email, what: 'typed by the team' }] };
      try { await croSetDoc(doc(db, CRO_COL, ref), rec); } catch (e) { return 'Not saved: ' + (e.message || e); }
      CRO.list.unshift(rec);
      croMsg(ref + ' created — check it and send it.');
      setTimeout(() => { croRender(); croOpen(ref); }, 0);
      return '';
    },
  });
}

/* ---------------- the menu item, the page, and the address ---------------- */
/* Only on a real page: the tests' stub DOM has the two elements but no createElement / after, and must load as before. */
if ($('secShopify') && $('paneShop') && typeof $('paneShop').after === 'function'
    && typeof document !== 'undefined' && typeof document.createElement === 'function') {
  const link = document.createElement('a');
  link.id = 'tabCreators'; link.className = 'nav'; link.href = '#creators'; link.textContent = 'Content Creators';
  link.style.display = 'none';
  /* Next to Shopify Orders, as the design asks. */
  if ($('tabShop') && $('tabShop').nextSibling) $('secShopify').insertBefore(link, $('tabShop').nextSibling); else $('secShopify').appendChild(link);

  const pane = document.createElement('div');
  pane.id = 'paneCreators'; pane.className = 'hide';
  const d30 = sdShift(sdToday(), -30);
  CRO.from = d30; CRO.to = sdToday();
  pane.innerHTML = `<div class="card so-card" style="padding:12px 14px">
      <div class="so-band">
        <div class="so-title"><span>CONTENT CREATORS</span><b>Orders</b></div>
        <div class="seg" id="croStoreSeg" title="Show Ridhi's gifts, CPC's gifts, or both.">
          <button type="button" class="segbtn on" data-crostore="">Both</button>
          <button type="button" class="segbtn" data-crostore="Ridhi">Ridhi</button>
          <button type="button" class="segbtn" data-crostore="CPC">CPC</button>
        </div>
        <div id="croKpis" class="so-figs"></div>
      </div>
      <div class="toolbar so-find">
        <input id="croFrom" type="date" style="flex:0 0 150px" value="${d30}">
        <span class="muted" style="font-size:13px">to</span>
        <input id="croTo" type="date" style="flex:0 0 150px" value="${sdToday()}">
        <select id="croStatusF" style="flex:0 0 160px" title="Status"><option value="">Any status</option>${CRO_STATUSES.map(s => `<option>${s}</option>`).join('')}</select>
        <select id="croSrcF" style="flex:0 0 160px" title="Where the order came from"><option value="">Any source</option><option value="creator-setu">Creator Setu</option><option value="team">Entered by team</option></select>
        <input id="croQ" style="flex:1 1 220px;min-width:140px" placeholder="Filter order / SKU / creator / @handle">
        <span id="croStockAt" class="so-stock"></span>
        <button type="button" class="ghost" id="croRefresh" title="Read the creator orders again">Refresh</button>
        <button type="button" class="ghost" id="croTrack" title="Ask Amazon about every gift it has that is not delivered yet">Update from Amazon</button>
        <button type="button" class="ghost" id="croSendMany" title="Send every ticked Checked order to Amazon MCF, Standard speed">Send ticked to Amazon (MCF)</button>
        <button type="button" id="croNew">+ Create order</button>
      </div>
      <div id="croLanes" class="so-steps cro-lanes" title="Where each gift is — press one to see only those"></div>
      <div id="croMsg" class="muted" style="margin-top:8px;font-size:13px"></div>
      <div id="croCount" class="muted" style="margin-top:4px;font-size:12px"></div>
    </div>
    <div class="card" style="padding:0;overflow:auto;max-height:70vh;margin-top:12px">
      <table id="croTable" class="xl xl-dense"></table>
    </div>`;
  $('paneShop').after(pane);

  $('croStoreSeg').onclick = e => { const b = e.target.closest('[data-crostore]'); if (!b) return; CRO.store = b.getAttribute('data-crostore') || ''; CRO.cap = CRO_CAP_STEP; croRender(); };
  $('croFrom').onchange = () => { CRO.from = $('croFrom').value; CRO.cap = CRO_CAP_STEP; croRender(); };
  $('croTo').onchange = () => { CRO.to = $('croTo').value; CRO.cap = CRO_CAP_STEP; croRender(); };
  $('croStatusF').onchange = () => { CRO.status = $('croStatusF').value; CRO.cap = CRO_CAP_STEP; croRender(); };
  $('croSrcF').onchange = () => { CRO.src = $('croSrcF').value; CRO.cap = CRO_CAP_STEP; croRender(); };
  let croT = null;
  $('croQ').oninput = () => { clearTimeout(croT); croT = setTimeout(() => { CRO.q = $('croQ').value; CRO.cap = CRO_CAP_STEP; croRender(); }, 180); };
  $('croRefresh').onclick = async () => { croMsg('Reading…'); await croLoad(true); croMsg(''); croRender(); };
  $('croTrack').onclick = () => { if (!CRO.busy) croStatusAll(); };
  $('croSendMany').onclick = () => { if (!CRO.busy) croSendTicked(); };
  $('croNew').onclick = () => croNewOpen();
  $('croLanes').onclick = e => { const b = e.target.closest('[data-crolane]'); if (!b) return; CRO.lane = b.getAttribute('data-crolane') || ''; CRO.cap = CRO_CAP_STEP; croRender(); };
  $('croTable').addEventListener('click', e => {
    if (e.target.closest('a[href]')) { e.stopPropagation(); return; }   // a tracking link opens the carrier, not the order
    if (e.target.closest('#croMore')) { e.stopPropagation(); CRO.cap += CRO_CAP_STEP; croRender(); return; }
    const all = e.target.closest('#croAll');
    if (all) { croRows().slice(0, CRO.cap).forEach(o => { if (all.checked) CRO.picked.add(o.reference); else CRO.picked.delete(o.reference); }); croRender(); return; }
    const pick = e.target.closest('.croPick');
    if (pick) { const r = pick.getAttribute('data-ref'); if (pick.checked) CRO.picked.add(r); else CRO.picked.delete(r); if ($('croCount')) croRender(); return; }
    const tr = e.target.closest('[data-cro]');
    if (tr) croOpen(tr.getAttribute('data-cro'));
  });

  /** The ref in "#creators?ref=CGE-…", or ''. */
  const croRefIn = h => { const m = /^#creators\?(?:.*&)?ref=([^&]+)/.exec(String(h || '')); return m ? decodeURIComponent(m[1]) : ''; };
  const croIsMine = h => /^#creators(\?|$)/.test(String(h || ''));
  /** The page opened: read the orders (and the stock, once), draw, and open the order the link names. */
  async function croShow(ref) {
    if (ref) CRO.want = ref;
    croRender();
    const ptReady = typeof ptNeed === 'function' && typeof PTG_ALL !== 'undefined' ? ptNeed(PTG_ALL, { why: 'creators', has: 'mdb' }).catch(() => {}) : null;
    await Promise.all([croLoad(false), croStockLoad().then(() => { CRO_SKUS = null; croRender(); })]);
    croRender();
    if (CRO.want) {
      const r = CRO.want; CRO.want = '';
      if (croOf(r)) croOpen(r); else croMsg('Order ' + r + ' not found.', true);
    }
    if (ptReady) ptReady.then(() => { CRO_SKUS = null; });
    croReportPending();
    croTrackAuto().catch(() => {});
  }

  const croShowTabReal = showTab;
  let croBooted = false;
  showTab = function (which) {
    link.style.display = croMay() ? '' : 'none';
    /* THE FIRST SCREEN AFTER SIGN-IN: a link to #creators (the one Creator Setu opens) lands here, not on the default. */
    if (!croBooted && typeof ME !== 'undefined' && ME && ME.email) {
      croBooted = true;
      if (croIsMine(CRO_START) && croMay() && which !== 'creators') { which = 'creators'; CRO.want = croRefIn(CRO_START); }
    }
    if (which !== 'creators' || !croMay()) {
      pane.classList.add('hide'); link.classList.remove('on');
      return croShowTabReal(which === 'creators' ? 'shop' : which);
    }
    document.querySelectorAll('[id^="pane"]').forEach(el => el.classList.toggle('hide', el !== pane));
    document.querySelectorAll('.side a.nav.on, #secShopify a.nav.on').forEach(el => el.classList.remove('on'));
    link.classList.add('on');
    if (TAB_NOW && TAB_NOW !== 'creators' && typeof tabShed === 'function') tabShed(TAB_NOW);
    TAB_NOW = 'creators';
    $('pageTitle').textContent = 'Content Creators';
    try {
      document.title = 'Content Creators · R-one';
      if (!croIsMine(location.hash)) history.pushState(null, '', '#creators' + (CRO.want ? '?ref=' + encodeURIComponent(CRO.want) : ''));
    } catch (e) { /* only the address */ }
    if (typeof navOpenFor === 'function') navOpenFor('shop');
    if (typeof topbarSync === 'function') topbarSync();
    if (typeof mobSync === 'function') { try { mobSync('shop'); } catch (e) { /* the phone bar only */ } }
    croShow('');
  };
  link.onclick = e => { e.preventDefault(); showTab('creators'); };
  /* Back / Forward, or a link pasted into this tab: nav.js does not know #creators. */
  window.addEventListener('hashchange', () => {
    if (!croIsMine(location.hash) || typeof ME === 'undefined' || !ME || !ME.email) return;
    const ref = croRefIn(location.hash);
    if (TAB_NOW !== 'creators') { CRO.want = ref; showTab('creators'); }
    else if (ref && !(PTD && /^Order # /.test(PTD.title || '') && PTD.title === 'Order # ' + ref)) { CRO.want = ref; croShow(''); }
  });
}
