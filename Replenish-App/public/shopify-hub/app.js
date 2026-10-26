/* =====================================================================================
 * Shopify section — the screens, working against the local hub (server.js).
 *
 * The look and the pages are the approved design (matched to the live ERP's Shopify screens): a blue band with
 * the day's figures, a line of filters, then plain tables; an order opens over the list. What the design did not
 * have — DHL CSB, Setup, creating the FedEx shipment — is drawn the same way.
 *
 * The hub owns the data: this page asks for it (/api/state), draws it, and sends every button press to
 * /api/action. Where a part is comes from journey.js (window.J), the same file the hub uses.
 * Live tracking: the page asks the hub every few seconds whether anything changed (/api/ver, one number) and
 * fetches the orders only when it did, so a new scan shows up by itself and the row that changed lights up.
 * ===================================================================================== */
(function () {
'use strict';

/* ============================== HELPERS ============================== */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => '$' + Number(n || 0).toFixed(2);
const usd = n => '$' + Math.round(n || 0).toLocaleString('en-US');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = ms => { const d = new Date(ms); return d.getDate() + ' ' + MON[d.getMonth()] + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const day = ms => { const d = new Date(ms); return d.getDate() + ' ' + MON[d.getMonth()]; };
const isoDay = ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const days1 = n => n < 0.1 ? 'just now' : (Math.round(n * 10) / 10) + (n >= 1.05 ? ' days' : ' day');
const DAY = J.DAY;
const { STAGES, STAGE_BTN, TARGET, CAUSES, RSTEPS, CARRIERS } = J;
const COLOR = { Indigo: '#2f4a7a', Rust: '#a8532f', Sage: '#7d8f69', Ivory: '#cdbf9f', Mustard: '#c99a2e', Rose: '#c9757b', Blue: '#2f4a7a', Red: '#a8532f', Green: '#7d8f69', Pink: '#c9757b', Yellow: '#c99a2e', White: '#cdbf9f' };
const ICON = {
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h4"/></svg>',
  ret: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8l9 5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
  csb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  setup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
};
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };

/* ============================== TALKING TO THE HUB ============================== */
let S = null, fetchedAt = 0;
const now = () => S ? S.now + (Date.now() - fetchedAt) : Date.now();
async function call(path, body) {
  document.body.classList.add('busy');
  try {
    const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'The hub said no');
    if (d.orders) took(d, false);
    return d;
  } catch (e) {
    if (e instanceof TypeError) throw new Error('The local hub is not answering — is it running? (start-hub.cmd)');
    throw e;
  } finally { document.body.classList.remove('busy'); }
}
async function act(type, payload) {
  try { const d = await call('/api/action', Object.assign({ type }, payload)); close(); render(); if (d.msg) toast(d.msg); return true; }
  catch (e) { toast(e.message, true); return false; }
}
async function post(path, body) {
  try { const d = await call(path, body || {}); render(); if (d.msg) toast(d.msg); return d; }
  catch (e) { toast(e.message, true); return null; }
}
function toast(t, bad) { const d = document.createElement('div'); d.className = 's-toast' + (bad ? ' bad' : ''); d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), bad ? 6000 : 3000); }

/* ============================== LIVE TRACKING ==============================
 * The hub checks Amazon and the carriers every 30 minutes (and right away on "Check tracking now"). This page
 * asks the hub every 4 seconds for one number that goes up on every change; only when it moved are the orders
 * fetched again. A parcel that moved lights up its row, and the Live button says what happened last. */
let LIVE = store('hub.live') !== '0', LAST = null, FLASH = new Set();
const sig = o => o.pkgs.map(p => p.pos + ':' + (p.late ? 1 : 0) + ':' + ((p.last || {}).at || '')).join('|');
/* `flash`: this came in by itself (live or on returning to the page) — not as the answer to a button just pressed. */
function took(d, flash) {
  const before = S && flash ? new Map(S.orders.map(o => [o.no, sig(o)])) : null;
  S = d; fetchedAt = Date.now();
  if (!before) return;
  d.orders.forEach(o => {
    const b = before.get(o.no);
    if (b != null && b !== sig(o)) {
      FLASH.add(o.no);
      const pk = o.pkgs.slice().sort((x, y) => ((y.last || {}).at || y.ts[y.pos - 1] || 0) - ((x.last || {}).at || x.ts[x.pos - 1] || 0))[0];
      if (pk) LAST = { t: Date.now(), m: `#${o.no} ${J.phaseOf(pk) === 4 ? 'delivered' : stText(pk).toLowerCase()} · ${J.carName(pk)}` };
    }
  });
}
const typing = () => { const a = document.activeElement; return !!(a && a.closest && a.closest('#page,#dlg') && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)); };
async function liveTick() {
  if (!LIVE || !S || document.hidden || $('dlg').innerHTML || typing()) return;
  try {
    const v = await fetch('/api/ver').then(r => r.json());
    if (v.ok && v.v !== S.v) { const d = await fetch('/api/state').then(r => r.json()); if (d.ok) { took(d, true); render(); FLASH.clear(); } }
  } catch (e) {}
}
setInterval(liveTick, 4000);
function liveLabel() {
  const b = $('liveBtn'); if (!b) return;
  b.classList.toggle('on', LIVE);
  b.innerHTML = LIVE ? `<i></i>Live tracking${LAST ? ` · ${esc(LAST.m)} · ${fmt(LAST.t).split(', ')[1]}` : ' · on'}` : '<i></i>Live tracking off';
  b.title = LIVE ? 'Carrier updates show up by themselves. Click to pause.' : 'Click to turn live tracking back on.';
}
$('liveBtn').addEventListener('click', () => { LIVE = !LIVE; store('hub.live', LIVE ? '1' : '0'); liveLabel(); toast(LIVE ? 'Live tracking on' : 'Live tracking paused'); if (LIVE) liveTick(); });

/* ============================== THE JOURNEY, ON SCREEN ============================== */
const isMcf = J.isMcf, off = J.off, carName = J.carName, phaseOf = J.phaseOf, actionOf = J.actionOf, prodLen = J.prodLen;
const inStage = pk => J.inStage(pk, now());
const isLateStage = pk => J.isLateStage(pk, now());
const flagOf = pk => J.flagOf(pk, now());
const undecided = o => J.undecided(o);
const etaText = pk => (pk.late ? 'Was due ' : 'Expected ') + pk.eta;
const itemsText = (o, pk) => pk.items.map(i => o.items[i].t).join(' + ');
const linesOf = n => n + ' line' + (n === 1 ? '' : 's');
const addrText = o => { const a = o.addr || {}; return [a.a1, a.a2, [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), a.country].filter(Boolean).join(', '); };
const orderVal = o => o.items.reduce((s, i) => s + i.price * i.q, 0) + o.ship;
const units = o => o.items.reduce((s, i) => s + i.q, 0);
const ageOf = o => Math.floor((now() - o.at) / DAY);
const testTag = o => o.source === 'test' ? ' <span class="st st-draft" title="A temp test order — nothing is sent to Shopify">TEST</span>' : '';
const CARRIER_URL = { 'DHL Express': t => 'https://www.dhl.com/in-en/home/tracking/tracking-express.html?submit=1&tracking-id=' + t,
  FedEx: t => 'https://www.fedex.com/fedextrack/?trknbr=' + t, UPS: t => 'https://www.ups.com/track?tracknum=' + t, 'Amazon MCF': t => 'https://track.amazon.com/tracking/' + t };

/* Live status chips: .st-rejected red (needs something), .st-pending amber (under way), .st-approved green (done), .st-draft grey. */
const st = (t, c, tip) => `<span class="st st-${c || 'draft'}"${tip ? ` title="${esc(tip)}"` : ''}>${esc(t)}</span>`;
const stText = pk => pk.block ? 'On hold' : flagOf(pk) ? J.FLAGS[flagOf(pk)] : J.statusOf(pk);
const tone = pk => phaseOf(pk) === 4 ? 'approved' : pk.block || flagOf(pk) ? 'rejected' : 'pending';
const stPill = pk => st(stText(pk), tone(pk));
const pill = (t, cls) => st(t, { ok: 'approved', low: 'pending', out: 'rejected', info: 'pending', mute: 'draft' }[cls] || 'draft');
const sub = h => `<span class="sub">${h}</span>`;
const sw = it => { const k = Object.keys(COLOR).find(c => (String(it.v) + ' ' + String(it.t)).includes(c)); return `<i class="sw" style="background:${k ? COLOR[k] : '#98A1AE'}" title="${esc(it.v)}"></i>`; };
const prodCell = (it, s) => `<div class="s-prod">${sw(it)}<div><div class="n">${esc(it.t)}</div>${sub(esc(s == null ? [it.v, it.sku].filter(Boolean).join(' · ') : s))}</div></div>`;
const srcName = pk => pk.rep ? 'Replacement' : pk.src === 'make' ? 'Production' : pk.src === 'fba' ? 'FBA stock' : 'India stock';
const card = (title, right, body, id, cls) => `<section class="s-card ${cls || ''}"${id ? ` id="${id}"` : ''}><header class="s-ch"><h3>${title}</h3>${right ? `<div class="r">${right}</div>` : ''}</header>${body}</section>`;
const table = (heads, rows, empty, id, cls) => `<div class="s-scroll"><table class="s-tbl ${cls || ''}"${id ? ` id="${id}"` : ''}><thead><tr>${heads.map(h => `<th${h[1] ? ` class="${h[1]}"` : ''}>${h[0]}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${heads.length}" class="s-empty">${empty || 'Nothing matches.'}</td></tr>`}</tbody></table></div>`;
const metrics = (title, list, right) => `<section class="s-card s-metrics"><div class="hd"><b>${title}</b>${right ? `<span class="s-faint s-sm">${right}</span>` : ''}</div>
  <div class="row">${list.map(m => `<div class="metric"><div class="v ${m[2] || ''}">${m[0]}</div><div class="l">${m[1]}</div></div>`).join('')}</div></section>`;
const stockWord = (have, need) => have <= 0 ? '<b class="no">No stock</b>' : have < need ? '<b class="part">Partly</b>' : '<b class="ok">In stock</b>';

/* ============================== SHELL ============================== */
let STORE = '', Q = '', FILTER = '', RFILTER = '', KFILTER = '', SEL = new Set();
/* Picked, not sent yet: { orderNo: { lineIndex: 'mcf' | 'make' | 'india' } }. A line that has been sent drops out
 * by itself (linesCard keeps only undecided lines), so the other lines keep their picks: MCF, then production, then India. */
const CHOICE = {};
const vis = () => S.orders.filter(o => !STORE || o.store === STORE);
const allPk = () => vis().flatMap(o => o.pkgs.map(pk => ({ o, pk })));
const allRet = () => vis().flatMap(o => o.rets.map((r, n) => ({ o, r, n })));
const daysLeft = s => s.sold ? Math.floor(s.shop / (s.sold / 30)) : 999;
const lowStock = () => S.stock.filter(s => (!STORE || s.store === STORE) && daysLeft(s) < 14);
/* No Production or Shipments page (Ravi, 24 Oct: "move this into every order page, like Shopify does"): where a part
 * is in production and where its parcel is are shown on its order; the Orders filters list them across orders. */
const TABS = [['orders', 'Orders', 'orders'], ['csb', 'Dispatch', 'csb'], ['returns', 'Returns', 'ret'], ['stock', 'Stock', 'stock'], ['setup', 'Setup', 'setup']];
function counts() {
  return {
    orders: vis().filter(o => needsAction(o)).length,
    returns: allRet().filter(x => J.retAction(x.r)).length,
    stock: lowStock().length,
    csb: allPk().filter(x => x.pk.booked && !x.pk.route).length || CD.ships.length,
    setup: S.queue.filter(q => q.status === 'failed').length,
  };
}
let SHOWN = { n: 0 };
function figures() {
  const t0 = new Date(now()); t0.setHours(0, 0, 0, 0);
  const a = t0.getTime(), y = a - DAY;
  const on = (p, q) => vis().filter(o => o.at >= p && o.at < q);
  const tod = on(a, a + DAY), yes = on(y, a);
  const u = l => l.reduce((s, o) => s + units(o), 0);
  const waiting = allPk().filter(x => x.pk.src === 'make' && phaseOf(x.pk) === 0).reduce((s, x) => s + x.pk.items.length, 0);
  return [[usd(tod.reduce((s, o) => s + orderVal(o), 0)), `Today · ${tod.length} orders · ${u(tod)} units`],
    [usd(yes.reduce((s, o) => s + orderVal(o), 0)), `Yesterday · ${yes.length} orders · ${u(yes)} units`],
    [waiting, 'waiting on production'], [SHOWN.n, `of ${vis().length} orders shown`]];
}
function shell(active) {
  const c = counts();
  document.body.dataset.page = active;
  const tab = (t, ic) => `<a href="#${t[0]}" class="${active === t[0] ? 'on' : ''}">${ic ? ICON[t[2]] : ''}${t[1]}${c[t[0]] ? `<b>${c[t[0]]}</b>` : ''}</a>`;
  $('tabs').innerHTML = TABS.map(t => tab(t)).join('');
  $('bottom').innerHTML = TABS.filter(t => t[0] !== 'setup').map(t => tab(t, 1)).join('');
  $('ptitle').textContent = (TABS.find(t => t[0] === active) || TABS[0])[1];
  const seg = [['', 'Both'], ['Ridhi', 'Ridhi'], ['CPC', 'CPC']].map(s => `<button class="segbtn ${STORE === s[0] ? 'on' : ''}" type="button" data-s="${s[0]}">${s[1]}</button>`).join('');
  $('storeBand').innerHTML = seg; $('storeBar').innerHTML = seg;
  $('bucketN').textContent = vis().reduce((s, o) => s + undecided(o).length, 0);
  $('bulkN').textContent = readyOrders().length;
  $('figs').innerHTML = figures().map(f => `<div class="s-fig"><b>${f[0]}</b><span>${f[1]}</span></div>`).join('');
  $('trackAt').textContent = S.lastTrack ? `Tracking checked ${fmt(S.lastTrack.at)}${S.lastTrack.simulate ? ' (simulated)' : ''}` : 'Tracking not checked yet';
  const live = Object.keys(S.connections).filter(k => S.connections[k] === 'live');
  const bar = $('modeBar');
  bar.className = 's-proto' + (live.length ? ' live' : '');
  bar.innerHTML = S.settings.web ? `TEST SITE · Shopify read through the ERP's Pricing API${live.length ? '' : ' (open this from the ERP)'} · kept in this browser only · marking orders shipped in Shopify ${S.settings.writes ? '<b>ON</b>' : 'off'} · Amazon and carriers simulated`
    : live.length ? `Local hub · live: ${esc(live.join(', '))} · sending to Shopify ${S.settings.writes ? '<b>ON</b>' : 'off'} · real MCF ${S.settings.realMcf ? '<b>ON</b>' : 'off'}${S.settings.fedexShip.on ? ' · FedEx labels ' + (S.settings.fedexShip.sandbox ? 'sandbox' : '<b>REAL</b>') : ''} · <a href="#setup">Setup</a>`
    : 'TEST MODE · temp orders, simulated MCF and tracking · nothing is sent anywhere · fill your keys on <a href="#setup">Setup</a>';
  liveLabel();
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-s]'); if (!b || !b.closest('#storeBand,#storeBar')) return;
  STORE = b.dataset.s; render();
});
$('q').addEventListener('input', () => { Q = $('q').value.trim().toLowerCase(); if (location.hash && !/^#(orders|order\/)/.test(location.hash)) location.hash = 'orders'; else render(); });
$('bucketBtn').addEventListener('click', () => { FILTER = FILTER === 'decide' ? '' : 'decide'; if (location.hash !== '#orders') location.hash = 'orders'; else render(); });
/* Inside the ERP page (test ERP, or the local one), Shopify is read with the ERP's own Pricing API access: the ERP says
 * hello when the frame loads, then answers "want orders" with both stores' orders, which go to the hub here. Messages are
 * taken only from the page this one sits in, and only from the ERP's addresses. Opened on its own, the hub reads Shopify
 * with its own tokens, as before. */
const ERP_ORIGIN = /^(https:\/\/ravikumar7357\.github\.io|http:\/\/(localhost|127\.0\.0\.1):\d+)$/;
let ERP_OK = false;
window.addEventListener('message', e => {
  if (window.parent === window || e.source !== window.parent || !ERP_ORIGIN.test(e.origin) || !e.data || typeof e.data !== 'object') return;
  if (e.data.type === 'shub-erp') ERP_OK = true;
  if (e.data.type === 'shub-orders' && e.data.got && typeof e.data.got === 'object') post('/api/shopify/import-pr', { got: e.data.got });
});
function fetchOrders() {
  if (!ERP_OK && S.settings.web) return toast('Open this from the ERP (Shopify → Shopify hub (test)) — it reads Shopify through the ERP\'s Pricing API.', true);
  if (!ERP_OK) return post('/api/shopify/import');
  toast('Reading Shopify through the ERP…');
  window.parent.postMessage({ type: 'shub-want-orders' }, '*');
}
$('fetchBtn').addEventListener('click', fetchOrders);
$('bulkBtn').addEventListener('click', () => bulkShipDlg(readyOrders(), 'Bulk order'));

/* ============================== ORDER COLUMNS ============================== */
/* Ship from, in the live column's words: one answer for the order, with MCF and India stock under it. */
function shipFrom(o) {
  const u = undecided(o), P = o.pkgs;
  /* What the stock left for this order covers, after older orders (allocOf) — waiting lines only; others by their figures. */
  const A = allocOf(o), lines = o.items.length;
  const fba = o.items.filter((it, i) => A[i] ? A[i].fba >= A[i].need : it.fba >= it.q).length, ind = o.items.filter((it, i) => A[i] ? A[i].india >= A[i].need : it.india >= it.q).length;
  const stock = `MCF ${stockWord(fba, lines)} · India ${stockWord(ind, lines)}`;
  const made = P.filter(p => p.src === 'make'), madeDone = made.filter(p => phaseOf(p) > 0);
  let main;
  if (u.length) main = st(`Needs routing · ${linesOf(u.length)}`, 'rejected', 'Choose MCF, production or India for each line');
  else if (made.some(p => phaseOf(p) === 0)) {
    const ln = made.reduce((s, p) => s + p.items.length, 0), dn = madeDone.reduce((s, p) => s + p.items.length, 0);
    main = st(`In production · ${dn} of ${ln} line(s) done`, made.some(p => p.block) ? 'rejected' : 'pending');
  } else if (P.length && P.every(p => isMcf(p))) main = st(P.every(p => off(p) >= 3) ? 'MCF done' : 'MCF ready', P.every(p => off(p) >= 3) ? 'approved' : 'pending');
  else if (P.some(p => p.src === 'india')) main = st('Ship from India', P.every(p => off(p) >= 1) ? 'approved' : 'pending');
  else main = st(made.length ? 'Made' : 'MCF done', 'approved');
  return main + sub(stock);
}
/* Shopify: what Shopify itself is told has shipped, tracking under it. */
function shopifyCol(o) {
  const out = o.pkgs.filter(p => p.route && off(p) >= (isMcf(p) ? 3 : 1));
  const all = !undecided(o).length && o.pkgs.length && out.length === o.pkgs.length;
  const trk = out.flatMap(p => p.trk)[0];
  return st(all ? 'Shipped' : out.length ? 'Part shipped' : 'Not shipped', all ? 'approved' : out.length ? 'pending' : 'draft') + sub(trk ? `<span class="s-trk">${esc(trk)}</span>` : '<span class="s-faint">—</span>');
}
function statusCol(o) {
  const b = o.pkgs.find(p => p.block), f = o.pkgs.find(p => flagOf(p)), r = o.rets.find(x => x.pos < 3);
  if (b) return st('On hold', 'rejected', b.block.why) + sub(esc(b.block.why));
  if (f) return st(J.FLAGS[flagOf(f)], 'rejected') + sub(f.chased ? 'Followed up ' + fmt(f.chased) : esc(carName(f)) + (f.eta ? ' · was due ' + esc(f.eta) : ''));
  if (r) return st('Return open', 'pending') + sub(esc(RSTEPS[r.pos]));
  if (o.pkgs.length && !undecided(o).length && o.pkgs.every(p => phaseOf(p) === 4)) return st('Done', 'approved') + sub('Delivered ' + day(Math.max(...o.pkgs.map(p => p.ts[p.pos - 1]))));
  const c = o.pkgs.find(p => p.route);
  return '<span class="s-faint">—</span>' + (c ? sub(esc(carName(c))) : '');
}
/* Where it is now: for each part, its last scan, the place and when — so the list answers "where is it"
 * without opening the order. The carrier's own words when the hub has a scan; the step name otherwise. */
function whereNow(o) {
  const one = (pk, n) => {
    const tag = o.pkgs.length > 1 ? `<span class="s-pn">${n + 1}</span>` : '';
    if (phaseOf(pk) === 0) {
      if (pk.block) return `${tag}<b class="s-bad">On hold</b> · ${STAGES[pk.pos]}${sub('Ridhi factory, Jaipur · since ' + day(pk.block.at))}`;
      return `${tag}<b>${pk.pos === 0 ? 'Waiting to start' : 'In ' + STAGES[pk.pos]}</b> · production${sub('Ridhi factory, Jaipur · ' + days1(inStage(pk)))}`;
    }
    if (off(pk) === 0) return `${tag}<b>Ready to ship</b>${sub(esc(pk.ev[pk.pos - 1] || (pk.src === 'make' ? 'Ridhi factory, Jaipur' : pk.src === 'fba' ? 'Amazon FBA' : 'India stock')))}`;
    if (pk.booked && !pk.route) return `${tag}<b>Packed</b> · ${esc(pk.booked.car)}${sub(`waiting for the tracking number · ${esc(pk.booked.id)}`)}`;
    const f = flagOf(pk), L = pk.last;
    const what = phaseOf(pk) === 4 ? 'Delivered' : f && f !== 'stale' ? J.FLAGS[f] : L && L.text ? L.text : off(pk) === 5 ? 'Out for delivery' : J.steps(pk).flat()[pk.pos - 1];
    const place = L ? L.place : pk.ev[pk.pos - 1] || '', at = L ? L.at : pk.ts[pk.pos - 1];
    return `${tag}<b class="${phaseOf(pk) === 4 ? 's-ok' : f ? 's-bad' : ''}">${esc(what)}</b> · ${esc(carName(pk))}${sub(esc(place) + (at ? (place ? ' · ' : '') + fmt(at) : '') + (f === 'stale' ? ' · <b class="no">no scan for 3 days</b>' : pk.late && pk.eta ? ' · was due ' + esc(pk.eta) : ''))}`;
  };
  const rows = o.pkgs.map((pk, n) => `<div class="s-where">${one(pk, n)}</div>`);
  const u = undecided(o).length;
  if (u) rows.push(`<div class="s-where"><span class="s-faint">${linesOf(u)} not routed yet</span></div>`);
  return rows.join('');
}
/* THE ONE THING TO DO NEXT on an order, most urgent first. `n` is the part (or return) it is about. */
const chasedSince = pk => pk.chased && pk.chased > ((pk.last || {}).at || 0);
function nextAction(o) {
  const P = o.pkgs, find = f => P.findIndex(f);
  if (undecided(o).length) return { k: 'route', label: 'Route lines', urg: 5, why: `${linesOf(undecided(o).length)} not routed` };
  let n = find(p => p.block); if (n >= 0) return { k: 'unhold', n, label: 'Resolve hold', urg: 4, bad: 1, why: P[n].block.why };
  n = find(p => flagOf(p) && !chasedSince(p)); if (n >= 0) return { k: 'chase', n, label: 'Chase carrier', urg: 4, bad: 1, why: J.FLAGS[flagOf(P[n])] };
  n = find(p => p.booked && !p.route); if (n >= 0) return { k: 'awb', n, label: 'Enter tracking no.', urg: 3, why: `${P[n].booked.car} · ${P[n].booked.id}` };
  n = find(p => actionOf(p) && actionOf(p).k === 'ship'); if (n >= 0) return { k: 'ship', n, label: 'Ship', urg: 3, why: 'Ready to ship' };
  const r = o.rets.findIndex(x => J.retAction(x)); if (r >= 0) return { k: 'ret', n: r, label: J.retAction(o.rets[r]).b, urg: 2, why: 'Return open' };
  n = find(p => phaseOf(p) === 0 && isLateStage(p)); if (n >= 0) return { k: 'stage', n, label: STAGE_BTN[P[n].pos], urg: 2, why: 'Over target in ' + STAGES[P[n].pos] };
  n = find(p => phaseOf(p) === 0); if (n >= 0) return { k: 'stage', n, label: STAGE_BTN[P[n].pos], urg: 0, ghost: 1 };
  n = find(p => flagOf(p)); if (n >= 0) return { k: 'track', label: 'Track', urg: 0, ghost: 1, why: 'Followed up ' + day(P[n].chased) };
  if (P.some(p => p.route && phaseOf(p) < 4)) return { k: 'track', label: 'Track', urg: 0, ghost: 1 };
  return null;
}
const needsAction = o => { const a = nextAction(o); return !!(a && a.urg > 0); };

/* ============================== 1 · ORDERS ============================== */
const BUCKETS = [
  ['act', 'Needs action', null],
  ['decide', 'Needs routing', null],
  ['make', 'In production', pk => phaseOf(pk) === 0],
  ['ready', 'Ready to ship', pk => phaseOf(pk) === 1 && off(pk) === 0],
  ['carrier', 'In transit', pk => (phaseOf(pk) === 1 && off(pk) > 0) || phaseOf(pk) === 2 || phaseOf(pk) === 3],
  ['late', 'On hold / delayed', pk => !!(flagOf(pk) || pk.block)],
  ['done', 'Delivered', pk => phaseOf(pk) === 4],
];
const inBucket = (o, b) => b[0] === 'act' ? needsAction(o) : b[0] === 'decide' ? undecided(o).length > 0 : o.pkgs.some(b[2]);
function pageOrders() {
  const match = o => !Q || [o.no, o.cust.n, o.cust.e, ...o.items.map(i => i.sku + ' ' + i.t), ...o.pkgs.flatMap(p => p.trk)].join(' ').toLowerCase().includes(Q);
  const b = BUCKETS.find(x => x[0] === FILTER);
  const urg = o => (nextAction(o) || { urg: -1 }).urg;
  const rows = vis().filter(match).filter(o => !b || inBucket(o, b)).sort((x, y) => (FILTER === 'act' ? urg(y) - urg(x) : 0) || y.at - x.at);
  SHOWN.n = rows.length;
  SEL = new Set([...SEL].filter(no => rows.some(o => o.no === no)));
  const cnt = x => vis().filter(o => inBucket(o, x)).length;
  const steps = `<div class="s-steps" id="pipe"><button class="s-st ${!FILTER ? 'on' : ''}" type="button" data-f="">All <b>${vis().length}</b></button>${BUCKETS.map(x => { const n = cnt(x); return `<button class="s-st ${n ? '' : 'zero'} ${x[0] === 'act' && n ? 'act' : ''} ${FILTER === x[0] ? 'on' : ''}" type="button" data-f="${x[0]}">${x[1]} <b>${n}</b></button>`; }).join('')}
    ${FILTER || Q ? `<span class="s-kept">Showing ${esc([b && b[1], Q && '“' + Q + '”'].filter(Boolean).join(' · '))} <button type="button" data-showall>Show all</button></span>` : ''}</div>`;
  /* With orders ticked, the things done to many at once. Every one does real work. */
  const bulk = SEL.size ? `<div class="s-bulk" id="bulk"><b>${SEL.size} selected</b>
      <button class="s-btn" type="button" data-bulk="ship">Ship selected (DHL / FedEx files)</button>
      <button class="s-btn ghost" type="button" data-bulk="check">Check tracking now</button>
      <button class="s-btn ghost" type="button" data-bulk="print">Print pick sheets</button>
      ${S.settings.fedexShip.on ? '<button class="s-btn ghost" type="button" data-bulk="fedex">FedEx labels (API)</button>' : ''}
      <button class="s-btn ghost" type="button" data-bulk="note">Add a note</button>
      <button class="s-link" type="button" data-bulk="clear">Clear</button></div>` : '';
  const tr = rows.map(o => {
    const a = nextAction(o);
    const btn = !a ? '<span class="s-faint">—</span>' : a.k === 'track'
      ? `<a class="s-btn ghost" href="#order/${esc(o.no)}">Track</a>${a.why ? sub(esc(a.why)) : ''}`
      : `<button class="s-btn ${a.ghost ? 'ghost' : a.bad ? 'bad' : ''}" type="button" data-act="${a.k}|${esc(o.no)}|${a.n == null ? '' : a.n}">${esc(a.label)}</button>${a.why ? sub(esc(a.why)) : ''}`;
    return `<tr data-row="${esc(o.no)}" tabindex="0" class="click ${FLASH.has(o.no) ? 's-flash' : ''} ${SEL.has(o.no) ? 'sel' : ''}">
      <td class="s-ck"><input type="checkbox" data-sel="${esc(o.no)}" ${SEL.has(o.no) ? 'checked' : ''} aria-label="Select order ${esc(o.no)}"></td>
      <td class="tl b">#${esc(o.no)}${testTag(o)}${sub(`${isoDay(o.at)} <span class="so-age" title="${ageOf(o)} days since it was placed">${ageOf(o)}d</span>`)}</td>
      <td class="tl" title="${esc(addrText(o))}">${esc(o.cust.n)}${sub(`${esc([o.addr.state, o.addr.country].filter(Boolean).join(', '))} · ${units(o)} unit${units(o) > 1 ? 's' : ''}`)}</td>
      <td class="num">${usd(orderVal(o))}</td>
      <td class="tl">${shipFrom(o)}</td><td class="tl">${shopifyCol(o)}</td><td class="tl s-wherecol">${whereNow(o)}</td><td class="tl">${statusCol(o)}</td>
      <td><span class="s-muted">${esc(o.store)}</span></td><td class="tl wrap">${o.items.map(i => esc(i.sku || i.t) + ' × ' + i.q).join('<br>')}</td>
      <td class="s-actcol">${btn}</td></tr>`;
  });
  const all = rows.length && rows.every(o => SEL.has(o.no));
  return `${steps}${FILTER === 'make' || FILTER === 'late' ? bottleneck() : ''}${bulk}<section class="s-card">${table([[`<input type="checkbox" data-selall ${all ? 'checked' : ''} aria-label="Select every order shown">`, 's-ck'], ['Order'], ['Ship to'], ['Value', 'num'], ['Ship from'], ['Shopify'], ['Where it is now', 'tl'], ['Status'], ['Shop'], ['Items'], ['Next step', 's-actcol']], tr,
    Q ? `No order matches “${esc(Q)}”.` : 'Nothing matches.', 'otbl', 'dense')}</section>`;
}

/* ============================== ONE ORDER (opens over the list, as live) ============================== */
/* HOW THIS ORDER SHIPS (Ravi, 26 Oct: "the order can divide itself into sections — what needs MCF goes to the MCF
 * section by itself — and we accept it"). Every line not yet on its way is put in a section from the stock:
 * Amazon FBA has it → MCF; else India has it → India stock (shipped by DHL / FedEx from Bulk order); else Production.
 * Any line can be moved to another section it has stock for; "Accept" does every section at once. */
/* STOCK, SHARED OLDEST ORDER FIRST (journey.js allocate, as the ERP's soAllocIndia): what each waiting line can have from
 * FBA and from India after the older orders, worked out once per state from the hub. `a` below is one line's share:
 * { need (its send quantity), fba, india (left for it), fbaHeld, indiaHeld (held by older orders), takes }. */
let ALLOC_OF = null, ALLOC = {};
const allocOf = o => { if (ALLOC_OF !== S) { ALLOC_OF = S; ALLOC = J.allocate(S.orders, S.stock); } return ALLOC[o.no] || {}; };
const held = n => n ? ` · ${n} held by older orders` : '';
const SECTIONS = [
  { k: 'mcf', name: 'MCF', how: 'Amazon FBA has it · ships from the US', foot: 'Amazon ships in 4–5 days · the fee shows before you send', go: 'Send to MCF',
    can: (it, a) => !it.oos && a.fba >= a.need, stock: (it, a) => `FBA ${a.fba}`, tip: a => `${a.fba} left in FBA for this order${held(a.fbaHeld)}` },
  { k: 'india', name: 'India', how: 'India stock has it · DHL or FedEx', foot: 'Goes in the next DHL / FedEx file', go: 'Add to Bulk order',
    can: (it, a) => !it.oos && a.india >= a.need, stock: (it, a) => `India ${a.india}`, tip: a => `${a.india} left in India for this order${held(a.indiaHeld)}` },
  { k: 'make', name: 'Production', how: 'no stock for it · to be made', foot: 'Cut, print, press, QC · about 6 days', go: 'Send to production',
    can: () => true, stock: it => it.oos ? 'marked out of stock' : 'to make', tip: a => `FBA ${a.fba}${held(a.fbaHeld)} · India ${a.india}${held(a.indiaHeld)}` },
];
const qtyText = it => J.sendQty(it) < it.q ? `× ${J.sendQty(it)} of ${it.q}` : `× ${it.q}`;
const suggest = (it, a) => a && a.takes && a.takes !== 'skip' ? a.takes : 'make';
/** Each undecided line's section: the person's move if the stock left for it allows, else the suggestion. */
function planOf(o) {
  const ch = CHOICE[o.no] || (CHOICE[o.no] = {}), u = undecided(o), out = {}, A = allocOf(o);
  Object.keys(ch).forEach(k => { if (!u.includes(+k)) delete ch[k]; });
  u.forEach(i => { const it = o.items[i], a = A[i] || { need: J.sendQty(it), fba: 0, india: 0 }, mine = SECTIONS.find(s => s.k === ch[i]); out[i] = mine && mine.can(it, a) ? mine.k : suggest(it, a); });
  return out;
}
/* One card per way out, as Shopify shows an order's fulfilments: a coloured badge with the count, the items, and one
 * button at the bottom. An item moves with its quiet "Move…" menu. With more than one card, "Accept all" sits on top
 * and is the only filled button; the cards' own buttons stay plain. */
const thumb = it => { const k = Object.keys(COLOR).find(c => (String(it.v) + ' ' + String(it.t)).includes(c)); return `<span class="od-th" style="background:${k ? COLOR[k] : '#98A1AE'}" aria-hidden="true"></span>`; };
const itemRow = (it, chip, end, tip) => `<div class="od-row">${thumb(it)}<div class="od-it"><div class="n">${esc(it.t)}</div><div class="s-sm s-muted">${esc([it.v, it.sku].filter(Boolean).join(' · '))}</div></div>
  ${chip ? `<span class="od-chip ${it.oos ? 'oos' : ''}"${tip ? ` title="${esc(tip)}"` : ''}>${chip}</span>` : '<span></span>'}<span class="od-q">${qtyText(it)}</span>${end || '<span></span>'}</div>`;
/* The item's quiet menu: move it to another card (only where the stock left for it allows), the ERP's out-of-stock
 * mark, its send quantity, or not sending it at all. */
const itemMenu = (o, i, s, a) => { const it = o.items[i], to = SECTIONS.filter(x => x.k !== s.k && x.can(it, a));
  return `<select class="od-move" data-move="${i}" aria-label="Change ${esc(it.t)}"><option value="">Change…</option>
    ${to.map(x => `<option value="to:${x.k}">Move to ${x.name}</option>`).join('')}
    <option value="oos:${it.oos ? 0 : 1}">${it.oos ? 'Clear out of stock' : 'Mark out of stock'}</option>
    ${it.q > 1 ? '<option value="sq">Send quantity…</option>' : ''}<option value="sq:0">Don't send this item</option></select>`; };
function linesCard(o) {
  const u = undecided(o), off0 = o.items.map((it, i) => i).filter(i => o.items[i].pk == null && !J.sendQty(o.items[i]));
  if (!u.length && !off0.length) return '';
  const A = allocOf(o), P = planOf(o), secs = SECTIONS.map(s => ({ s, lines: u.filter(i => P[i] === s.k) })).filter(x => x.lines.length), many = secs.length > 1;
  const auto = !!(S.prefs && S.prefs.autoMcf), a = i => A[i] || { need: J.sendQty(o.items[i]), fba: 0, india: 0, fbaHeld: 0, indiaHeld: 0 };
  const heldNote = u.some(i => a(i).fbaHeld || a(i).indiaHeld) ? ' · older orders get the stock first' : '';
  return `<div id="lines" class="od-plan">
    ${many ? `<div class="od-acc" id="decide-bar"><span class="s-muted s-sm">Sorted by stock${heldNote} — change an item if you want</span><button class="s-btn" type="button" data-plan="accept">Accept all ${secs.length}</button></div>` : ''}
    ${secs.map(({ s, lines }) => `<section class="od-card" id="pl-${s.k}">
      <header class="od-h"><span class="od-badge b-${s.k}">${s.name} · ${lines.length}</span><span class="s-muted s-sm">${s.how}</span>
        ${s.k === 'mcf' ? `<label class="od-auto s-sm" title="New orders whose items Amazon FBA has go to MCF by themselves"><input type="checkbox" data-automcf ${auto ? 'checked' : ''}> Auto-send</label>` : ''}</header>
      ${lines.map(i => itemRow(o.items[i], s.stock(o.items[i], a(i)), itemMenu(o, i, s, a(i)), s.tip(a(i)))).join('')}
      <footer class="od-f"><span class="s-muted s-sm">${s.foot}</span><button class="s-btn ${many ? 'ghost' : ''}" type="button" data-go="${s.k}">${s.go}</button></footer></section>`).join('')}
    ${off0.length ? `<section class="od-card od-off" id="pl-off"><header class="od-h"><span class="od-badge">Not being sent · ${off0.length}</span><span class="s-muted s-sm">send quantity 0 — stays on the order, nothing goes out</span></header>
      ${off0.map(i => itemRow(o.items[i], '', `<button class="s-link" type="button" data-sendagain="${i}">Send it again</button>`)).join('')}</section>` : ''}</div>`;
}
/* Accept: one window with what each section will do (MCF speed and fee, production priority), then everything at once. */
async function planDlg(o) {
  const P = planOf(o), by = k => undecided(o).filter(i => P[i] === k), mcf = by('mcf'), make = by('make'), india = by('india');
  let opts = [], k = 0, rush = false;
  if (mcf.length) {
    try { opts = (await call('/api/mcf-preview', { no: o.no, lines: mcf })).options.filter(x => x.ok); } catch (e) { return toast(e.message, true); }
    if (!opts.length) return toast('Amazon cannot ship the MCF items — move them to India or Production.', true);
  }
  const names = l => esc(l.map(i => o.items[i].t + (o.items[i].q > 1 || J.sendQty(o.items[i]) < o.items[i].q ? ' ' + qtyText(o.items[i]) : '')).join(', '));
  const draw = () => dialog(`Accept · #${o.no}`, `<div class="pl-acc">
      ${mcf.length ? `<div class="pl-a pl-mcf"><div><b>MCF</b> · ${names(mcf)}</div>
        <div class="s-route">${opts.map((s, i) => `<button class="s-ro ${k === i ? 'on' : ''}" type="button" data-sp="${i}"><b>${esc(s.speed)}</b><span>${esc(s.by)} · ${money(s.fee)}</span></button>`).join('')}</div>
        <span class="s-sm s-muted">${live(o) && S.settings.realMcf ? '<b class="s-bad">Places a REAL Amazon order and costs the fee.</b>' : 'Simulated — no real Amazon order is placed.'}</span></div>` : ''}
      ${make.length ? `<div class="pl-a pl-make"><div><b>Production</b> · ${names(make)}</div>
        <label class="s-check"><input type="checkbox" id="plRush" ${rush ? 'checked' : ''}> Rush — the customer is waiting</label></div>` : ''}
      ${india.length ? `<div class="pl-a pl-india"><div><b>India</b> · ${names(india)}</div><span class="s-sm s-muted">Picked now; ships from <b>Bulk order</b> with DHL or FedEx.</span></div>` : ''}
      <span class="s-sm s-muted">${live(o) ? 'Shopify is told as each part moves (split for MCF, "In production" tag, then the tracking number).' : 'Temp test order — nothing is sent to Shopify.'}</span></div>`,
    `<button class="s-btn" type="button" id="go">Accept${mcf.length ? ' · MCF ' + money(opts[k].fee) : ''}</button>`, () => {
      document.querySelectorAll('#dlg [data-sp]').forEach(b => b.addEventListener('click', () => { k = +b.dataset.sp; draw(); }));
      if ($('plRush')) $('plRush').addEventListener('change', e => { rush = e.target.checked; });
      $('go').addEventListener('click', () => act('plan', { no: o.no, mcf, make, india, speed: mcf.length ? opts[k].speed : '', rush }));
    });
  draw();
}
/* A part at a glance: Being made → Packing → On its way → Out for delivery → Delivered (no "Being made" for stock). */
const STRIP = ['Being made', 'Packing', 'On its way', 'Out for delivery', 'Delivered'];
const strip = (pk, f) => { const ph = phaseOf(pk); return `<ol class="pp-strip">${STRIP.map((t, i) => i === 0 && pk.src !== 'make' ? '' :
  `<li class="${i < ph || ph === 4 ? 'd' : i === ph ? (f || pk.block ? 'c bad' : 'c') : ''}">${t}</li>`).join('')}</ol>`; };
const fxDocs = f => `${f.label ? `<a class="s-btn" href="/${esc(f.label)}" target="_blank" rel="noopener">Print label</a>` : ''}${f.invoice ? ` <a class="s-btn ghost" href="/${esc(f.invoice)}" target="_blank" rel="noopener">Invoice</a>` : ''}`;
/* One part of the order, the way Shopify shows a fulfilment on its order: every step with its place and time —
 * production stages with how long each took against its target — the carrier and tracking, the carrier's own scans,
 * and the one thing to do next. This is what the Production and Shipments pages used to show, kept with its order. */
function partPanel(o, pk, n) {
  const a = actionOf(pk), isProd = phaseOf(pk) === 0, f = flagOf(pk);
  const btn = [];
  if (isProd && pk.block) btn.push(`<button class="s-btn ghost" type="button" data-do="unblock" data-pk="${n}">Resolve hold</button>`);
  else if (a) { if (isProd) btn.push(`<button class="s-link" type="button" data-do="block" data-pk="${n}">Put on hold</button>`); btn.push(`<button class="s-btn ghost" type="button" data-do="${a.k}" data-pk="${n}">${esc(a.b.replace('…', ''))}</button>`); }
  if (pk.booked && !pk.route) btn.push(`<button class="s-btn ghost" type="button" data-do="awb" data-pk="${n}">Enter tracking number</button>`);
  if (f) btn.push(`<button class="s-btn ${chasedSince(pk) ? 'ghost' : 'bad'}" type="button" data-do="chase" data-pk="${n}">${chasedSince(pk) ? 'Chase again' : 'Chase carrier'}</button>`);
  if (pk.fedex) { btn.push(fxDocs(pk.fedex)); if (off(pk) <= 2) btn.push(`<button class="s-link" type="button" data-do="fxcancel" data-pk="${n}">Cancel label</button>`); }
  const rows = [];
  J.steps(pk).flat().forEach((name, i) => {
    const done = i < pk.pos, cur = i === pk.pos && !f;
    const lab = name + (i === prodLen(pk) + 1 && pk.trk.length && !isMcf(pk) ? ` · ${pk.car} ${pk.trk[0]}` : '');
    let note = '';
    if (pk.src === 'make' && i < prodLen(pk) && (done || cur)) {
      const took = done ? (pk.ts[i] - (i ? pk.ts[i - 1] : pk.req)) / DAY : inStage(pk);
      note = `${done ? 'took' : 'for'} ${days1(took)} · target ${TARGET[i]} d${took > TARGET[i] ? ' · <span class="s-bad">over</span>' : ''}`;
    }
    if (cur) note = (pk.block && isProd ? `<span class="s-bad">On hold: ${esc(pk.block.why)} since ${day(pk.block.at)}</span>` : isProd ? '<b>Now</b>' : 'Next step') + (note ? ' · ' + note : '');
    rows.push(`<tr class="${done ? 'd' : cur ? 'c' : 'f'}"><td class="s-dotc"><i></i></td><td class="tl">${esc(lab)}${note ? `<div class="s-sm">${note}</div>` : ''}</td><td class="s-muted">${done && pk.ev[i] ? esc(pk.ev[i]) : ''}</td><td class="s-nowrap s-muted">${done && pk.ts[i] ? fmt(pk.ts[i]) : ''}</td></tr>`);
    if (i === pk.pos - 1 && f) rows.push(`<tr class="c bad"><td class="s-dotc"><i></i></td><td class="tl"><span class="s-bad">${esc(J.FLAGS[f])}</span>${pk.last && pk.last.text ? `<div class="s-sm s-muted">${esc(pk.last.text)}</div>` : ''}</td><td class="s-muted">${esc((pk.last || {}).place || '')}</td><td class="s-nowrap s-muted">${pk.last && pk.last.at ? fmt(pk.last.at) : ''}</td></tr>`);
  });
  const cust = phaseOf(pk) === 4 ? 'Delivered' : f ? 'Running late' : phaseOf(pk) === 3 ? 'Out for delivery' : phaseOf(pk) === 2 ? 'On its way' + (pk.eta ? ', arriving ' + pk.eta : '') : pk.src === 'make' && isProd ? 'Being made' : 'Preparing to ship';
  /* Who follows this parcel: the carrier's own key, else Shopify (a real order, once Shopify has the number), else nobody —
   * then the steps are marked by hand, and Shopify is still told each one. */
  const byCarrier = isMcf(pk) ? S.connections['Amazon ' + o.store] === 'live' && pk.mcfReal : S.connections[pk.car] === 'live';
  const realOrder = !isMcf(pk) && o.source === 'shopify' && S.connections['Shopify ' + o.store] === 'live';
  const inShopify = pk.fromShopify || pk.trackedBy === 'Shopify' || S.queue.some(q => q.orderNo === o.no && q.kind === 'fulfil' && q.data && q.data.part === n && q.status === 'sent');
  const byShopify = realOrder && inShopify;
  const live = byCarrier || byShopify;
  const marks = [[3, isMcf(pk) ? 'Shipped by Amazon' : 'Picked up'], [4, 'In transit'], [5, 'Out for delivery'], [6, 'Delivered']].filter(m => m[0] > off(pk));
  const url = CARRIER_URL[carName(pk)];
  const scans = (pk.scans || []).map(s => `<tr><td class="s-nowrap s-muted">${fmt(s.at)}</td><td class="tl">${esc(s.text)}</td><td class="s-muted">${esc(s.place)}</td></tr>`);
  /* The card's badge says what this part is now, in one or two words, in its section's colour. */
  const done = phaseOf(pk) === 4, badge = isProd ? (pk.block ? ['Production · on hold', 'bad'] : ['Production', 'make']) : isMcf(pk) ? ['MCF', 'mcf']
    : !pk.route ? [pk.src === 'make' ? 'Production · made' : 'India', pk.src === 'make' ? 'make' : 'india'] : [done ? 'Delivered' : 'Shipped · ' + carName(pk), f ? 'bad' : 'done'];
  const facts = [
    pk.trk.length ? pk.trk.map(t => `<span class="s-trk">${esc(t)}</span> <button class="s-link" type="button" data-copy="${esc(t)}">Copy</button>${url ? ` <a class="s-link" href="${esc(url(t))}" target="_blank" rel="noopener">Open ↗</a>` : ''}`).join(' ') : '',
    pk.mcfId ? `${esc(pk.mcfId)}${pk.mcfReal ? '' : ' (simulated)'}` : '',
    done ? 'Delivered ' + esc(day(pk.ts[pk.pos - 1])) : pk.eta && pk.route ? `<span class="${pk.late ? 's-bad' : ''}">${pk.late ? 'Was due' : 'Expected'} ${esc(pk.eta)}</span>` : '',
    `Customer sees: ${cust}`,
    pk.fedex ? `FedEx ${esc(pk.fedex.service)} · invoice ${esc(pk.fedex.inv)}${pk.fedex.sandbox ? ' · sandbox' : ''}` : '',
  ].filter(Boolean);
  return `<section class="od-card s-part ${FLASH.has(o.no) ? 's-flash' : ''}" id="pk${n}">
    <header class="od-h"><span class="od-badge b-${badge[1]}">${esc(badge[0])}</span><span class="s-muted s-sm">${esc(stText(pk))}${pk.rush ? ' · rush' : ''}</span><span class="r">${btn.join('')}</span></header>
    ${pk.items.map(i => itemRow(o.items[i], '')).join('')}
    ${strip(pk, f)}
    <details class="pp-steps" ${pk.block || f || isLateStage(pk) ? 'open' : ''}><summary>All steps</summary>${table([[''], ['Step', 'tl'], ['Place'], ['Date']], rows)}</details>
    <footer class="od-f od-facts"><span class="s-sm">${facts.join(' · ')}</span></footer>
    ${pk.booked && !pk.route ? `<footer class="od-f"><span class="s-muted s-sm">Packed · in ${esc(pk.booked.id)} · upload the file, then enter the ${esc(pk.booked.car)} tracking number</span></footer>`
      : off(pk) >= 1 && off(pk) <= 5 && pk.route ? `<footer class="od-f c-track"><span class="s-muted s-sm">${byCarrier ? `Tracked by ${esc(carName(pk))}` : byShopify ? 'Tracked by Shopify' : realOrder ? 'Shopify tracks it once it has the tracking number — until then, mark by hand' : o.source === 'test' ? 'Test order — mark the steps by hand' : 'Not tracked — mark the steps by hand'}${pk.checkedAt ? ' · checked ' + fmt(pk.checkedAt) : ''}</span>
        <span class="c-marks">${live ? `<button class="s-btn ghost" type="button" data-upd="${n}" data-live="1">Check for updates</button>` : '<span class="s-sm s-muted">Mark:</span>'}${marks.map(m => `<button class="s-link" type="button" data-mark="${n}|${m[0]}">${esc(m[1])}</button>`).join('')}</span></footer>` : ''}
    ${scans.length ? `<details class="s-scans"><summary>Carrier scans · ${scans.length}</summary>${table([['Date'], ['Scan', 'tl'], ['Place']], scans)}</details>` : ''}</section>`;
}
function returnRow(o, r, n) {
  const a = J.retAction(r);
  return `<tr id="ret${n}"><td class="tl">${r.items.map(i => esc(o.items[i].t)).join('<br>')}</td><td>${esc(r.why)}</td>
    <td>${r.what === 'both' ? 'Return + replacement' : r.what === 'replace' ? 'Replacement only' : 'Refund'}</td>
    <td>${st(RSTEPS[r.pos], r.pos === 3 ? 'approved' : a ? 'rejected' : 'pending')}</td><td>${r.trk ? `${esc(r.car)} <span class="s-trk">${esc(r.trk)}</span>` : '—'}</td>
    <td class="s-nowrap">${day(r.at)}</td><td class="act">${a ? `<button class="s-btn" type="button" data-do="${a.k}" data-r="${n}">${esc(a.b)}</button>` : ''}</td></tr>`;
}
const activity = o => o.tl.slice().sort((a, b) => b.t - a.t);
function pageOrder(no) {
  const o = S.orders.find(x => x.no === no); if (!o) return '';
  const sum = o.items.reduce((s, i) => s + i.price * i.q, 0);
  const out = o.pkgs.filter(p => p.route && off(p) >= (isMcf(p) ? 3 : 1)), trk = o.pkgs.flatMap(p => p.trk);
  const all = !undecided(o).length && o.pkgs.length && out.length === o.pkgs.length;
  const tags = [...new Set([...o.pkgs.filter(p => p.route === 'mcf').map(() => 'MCF'), ...o.pkgs.filter(p => phaseOf(p) === 0).map(() => 'In production'), ...o.pkgs.filter(p => p.src === 'make' && off(p) === 0).map(() => 'Ready to ship')])];
  const qn = S.queue.filter(q => q.orderNo === o.no), qc = k => qn.filter(q => q.status === k).length;
  return `<div class="s-omodal" id="omodal"><div class="s-odlg" role="dialog" aria-modal="true" aria-label="Order #${esc(o.no)}">
    <div class="s-ohead" id="o-head"><div class="t"><h2>Order #${esc(o.no)}</h2>${testTag(o)}${st(all ? 'Shipped' : out.length ? 'Part shipped' : 'Not shipped', all ? 'approved' : out.length ? 'pending' : 'draft')}
        ${st(trk.length ? 'Tracking ' + trk[0] : 'No tracking yet', 'draft')}<a class="s-x" href="#orders" aria-label="Close">×</a></div>
      <div class="m">${esc(o.cust.n)} · ${esc(addrText(o))} · ${isoDay(o.at)} · ${esc(o.store)}</div></div>
    <div class="s-obody od-grid">
      <div class="od-main">
        ${linesCard(o)}
        ${o.pkgs.map((pk, n) => partPanel(o, pk, n)).join('')}
        ${o.rets.length ? `<div class="s-panel" id="rets"><div class="s-ph">Returns</div>${table([['Lines'], ['Reason'], ['Outcome'], ['Status'], ['Return tracking'], ['Opened'], ['', 'act']], o.rets.map((r, n) => returnRow(o, r, n)))}</div>` : ''}
      </div>
      <aside class="od-side">
        ${o.note ? `<div class="od-card od-box od-note"><b>Note from Shopify</b><p>${esc(o.note)}</p></div>` : ''}
        <div class="od-card od-box"><b>Customer</b><p>${esc(o.cust.n)}<span class="s-muted"> · ${o.cust.k > 1 ? o.cust.k + ' orders' : 'first order'}</span><br><span class="s-muted">${esc(o.cust.e || '')}${o.cust.e ? '<br>' : ''}${esc(o.cust.ph || o.addr.phone || '')}</span></p>
          <b>Ship to</b><p class="s-muted">${esc(addrText(o))}</p></div>
        <div class="od-card od-box"><div class="od-sum"><span class="s-muted">Items</span><span>${money(sum)}</span><span class="s-muted">Shipping</span><span>${money(o.ship)}</span><b>Paid</b><b>${money(sum + o.ship)}</b></div></div>
        <div class="od-card od-box"><b>Shopify</b><p class="s-sm">${tags.length ? tags.map(t => `<span class="s-tag">${t}</span>`).join(' ') + '<br>' : ''}<span class="s-muted">${o.source === 'test' ? `Test order — nothing is sent (${qn.length} would be)` : qn.length ? `${qc('sent')} sent · ${qc('waiting')} waiting · ${qc('held')} held${qc('failed') ? ` · <span class="s-bad">${qc('failed')} failed</span>` : ''}` : 'Nothing sent yet'}</span></p></div>
        <div class="od-card od-box"><b>History</b><div class="s-cmt"><input id="cmt" placeholder="Add a note" aria-label="Note"><button class="s-btn ghost" type="button" data-do="cmt">Add</button></div>
          <ul class="od-hist">${activity(o).slice(0, 8).map(e => `<li><span class="s-muted s-sm">${fmt(e.t)}</span>${e.who === 'BLOCKED' ? '<span class="s-bad"> hold</span>' : ''} ${esc(e.m)}</li>`).join('')}</ul></div>
      </aside>
    </div>
    <div class="s-ofoot"><span class="s-muted">${linesOf(o.items.length)} · ${units(o)} pc${units(o) > 1 ? 's' : ''}</span>
      <a class="s-btn ghost" href="#orders">Close</a><button class="s-btn ghost" type="button" data-do="ret">Start return</button></div>
  </div></div>`;
}

/* The production bottleneck, read across all orders: shown above the Orders table on "In production" and
 * "On hold / delayed", where the Production page used to show it. */
function bottleneck() {
  const prod = allPk().filter(x => x.pk.src === 'make' && phaseOf(x.pk) === 0);
  const stat = STAGES.map((s, i) => {
    const l = prod.filter(x => x.pk.pos === i), d = l.map(x => inStage(x.pk));
    return { i, s, l, n: l.length, avg: d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0, lost: l.reduce((a, x) => a + Math.max(0, inStage(x.pk) - TARGET[i]), 0) };
  });
  const hot = stat.slice().sort((a, b) => b.lost - a.lost)[0];
  if (!hot || hot.lost <= 0) return '';
  const m = {}; hot.l.filter(x => x.pk.block).forEach(x => { m[x.pk.block.why] = (m[x.pk.block.why] || 0) + 1; });
  const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
  const held = prod.filter(x => x.pk.block).length, over = prod.filter(x => isLateStage(x.pk)).length;
  return `<div class="s-alert" id="major"><b>Bottleneck: ${esc(hot.s === 'Requested' ? 'Not started' : hot.s)}.</b> ${hot.n} item${hot.n > 1 ? 's' : ''}, average ${days1(hot.avg)} against a target of ${TARGET[hot.i]} day${TARGET[hot.i] > 1 ? 's' : ''}.${top ? ` Main cause: ${esc(top[0].toLowerCase())} (${top[1]} of ${hot.n}).` : ''}
    <span class="s-muted">${prod.length} in production · ${held} on hold · ${over} over target · ${Math.round(stat.reduce((a, x) => a + x.lost, 0) * 10) / 10} days lost.</span></div>`;
}
function chips(F, cur, attr, count) {
  return `<div class="s-steps">${F.map(f => { const n = count ? count(f[0]) : null; return `<button class="s-st ${cur === f[0] ? 'on' : ''} ${f[0] === 'late' && n ? 'bad' : ''}" type="button" ${attr}="${f[0]}">${f[1]}${n != null ? ` <b>${n}</b>` : ''}</button>`; }).join('')}</div>`;
}

/* ============================== 4 · RETURNS ============================== */
function pageReturns() {
  const F = [['', 'All'], ['open', 'Open'], ['rep', 'Replacement due'], ['closed', 'Closed']];
  const keep = (r, f) => !f || (f === 'open' && r.pos < 3) || (f === 'closed' && r.pos === 3) || (f === 'rep' && r.what !== 'return' && r.rep == null);
  const A = allRet(), rows = A.filter(({ r }) => keep(r, RFILTER));
  return `${metrics('Returns', [[A.filter(x => x.r.pos < 3).length, 'Open'], [A.filter(x => J.retAction(x.r)).length, 'Action needed', 'amber'], [A.filter(x => x.r.what !== 'return' && x.r.rep == null).length, 'Replacements due', 'red'], [A.filter(x => x.r.pos === 3).length, 'Closed', 'green']], 'Returns are raised inside an order')}
    <div class="s-bar2">${chips(F, RFILTER, 'data-rf', f => A.filter(x => keep(x.r, f)).length)}</div>
    <section class="s-card" id="rlist">${table([['Order'], ['Customer'], ['Item'], ['Reason'], ['Outcome'], ['Status'], ['Return tracking'], ['', 'act']], rows.map(({ o, r, n }) => {
      const a = J.retAction(r);
      return `<tr data-ropen="${esc(o.no)}|ret${n}" tabindex="0" class="click"><td><a class="s-ono" href="#order/${esc(o.no)}">#${esc(o.no)}</a></td><td>${esc(o.cust.n)}</td>
        <td>${esc(r.items.map(i => o.items[i].t).join(', '))}</td><td>${esc(r.why)}</td><td>${r.what === 'both' ? 'Return + replacement' : r.what === 'replace' ? 'Replacement only' : 'Refund'}</td>
        <td>${pill(RSTEPS[r.pos], r.pos === 3 ? 'ok' : a ? 'low' : 'info')}</td><td>${r.trk ? `${esc(r.car)} <span class="s-trk">${esc(r.trk)}</span>` : '—'}</td>
        <td class="act">${a ? `<button class="s-btn ghost" type="button" data-rq="${esc(o.no)}|${n}">${esc(a.b)}</button>` : ''}</td></tr>`;
    }), 'No returns.')}</section>`;
}

/* ============================== 5 · STOCK ============================== */
const stockRows = () => {
  const all = S.stock.filter(s => !STORE || s.store === STORE);
  return { all, rows: all.filter(s => !KFILTER || (KFILTER === 'low' ? daysLeft(s) < 14 : KFILTER === 'out' ? s.shop === 0 : daysLeft(s) >= 14)).sort((a, b) => b.sold - a.sold) };
};
const need = s => Math.max(0, Math.ceil(s.sold / 30 * 60) - s.shop);
function pageStock() {
  const { all, rows } = stockRows();
  const top = new Set(all.slice().sort((a, b) => b.sold - a.sold).slice(0, Math.ceil(all.length * 0.3)).map(s => s.sku));
  const u = all.reduce((t, s) => t + need(s), 0);
  return `<div class="s-card s-filterbar">
      <div class="seg">${[['', 'All'], ['low', 'Needs reorder'], ['out', 'Out of stock'], ['ok', 'OK']].map(f => `<button class="segbtn ${KFILTER === f[0] ? 'on' : ''}" type="button" data-kf="${f[0]}">${f[1]}</button>`).join('')}</div>
      <span class="s-muted s-sm">Cover target 60 days · last 30 days of sales</span>
      <span class="sp"></span><button class="s-btn ghost" type="button" data-make="export">Export</button></div>
    <div class="s-summary"><b>${STORE || 'Both stores'}</b> · ${all.length} SKU(s) · <b>${u}</b> units to reach 60 days of cover · example stock in the hub (data/db.json → stock) until the nightly Shopify stock is connected</div>
    <section class="s-card" id="stk">${table([['SKU'], ['Article'], ['Colour'], ['Store'], ['On Shopify', 'num'], ['FBA', 'num'], ['India', 'num'], ['30d units', 'num'], ['Per day', 'num'], ['Days left', 'num'], ['Send', 'num']], rows.map(s => {
      const d = daysLeft(s);
      return `<tr><td class="b">${esc(s.sku)}${top.has(s.sku) ? ' <span class="s-top" title="In the top sellers">TOP</span>' : ''}</td><td>${esc(s.t)}</td><td>${sw(s)} ${esc(s.v)}</td><td>${esc(s.store)}</td>
        <td class="num">${s.shop}</td><td class="num">${s.fba}</td><td class="num">${s.india}</td><td class="num">${s.sold}</td><td class="num">${(s.sold / 30).toFixed(2)}</td>
        <td class="num ${d < 7 ? 's-bad' : ''}">${d > 365 ? '—' : d}</td><td class="num b">${need(s) || '—'}</td></tr>`;
    }), 'Nothing matches.', '', 'centred')}</section>`;
}
function exportStock() {
  const { rows } = stockRows();
  const csv = [['SKU', 'Article', 'Colour', 'Store', 'On Shopify', 'FBA', 'India', '30d units', 'Days left', 'Send']].concat(rows.map(s => [s.sku, s.t, s.v, s.store, s.shop, s.fba, s.india, s.sold, daysLeft(s) > 365 ? '' : daysLeft(s), need(s)]))
    .map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
  download(new Blob([csv], { type: 'text/csv' }), `shopify-stock-${isoDay(now())}.csv`);
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

/* ============================== 6 · DISPATCH ==============================
 * What can go in a box today, across orders: tick the ready lines (a line still in production or not routed says
 * why it cannot), choose DHL or FedEx per order, weigh the box, make the files — DHL's CSB-V and FedEx's upload
 * workbook, filled in. After the upload, type or paste each tracking number: the order ships, Shopify is told and
 * follows the parcel itself. No carrier API anywhere. The hub builds the rows (lib/csb.js); this page writes them
 * into the carriers' own .xls files. */
const CD_KEY = 'hub.csbDraft';
const CD = (() => { try { const d = JSON.parse(store(CD_KEY)); if (d && Array.isArray(d.ships)) return d; } catch (e) {} return { cur: 'USD', tax: 'Against Bond or Undertaking', ships: [] }; })();
const saveCD = () => store(CD_KEY, JSON.stringify(CD));
let CSB = null, CREP = null, CQ = '', csbTimer = null;
async function loadCsb(then) { try { CSB = await call('/api/csb'); } catch (e) { toast(e.message, true); CSB = { candidates: [], batches: [], taxOptions: [], currencies: [], carriers: [], packaging: [], sku: {} }; } if (then) then(); render(); }
/* An order into the next file: its ready lines ticked (or only `only`, from the order's Ship button), the carrier chosen. */
function csbAdd(no, car, only) {
  const c = CSB.candidates.find(x => x.no === no); if (!c) return false;
  const have = CD.ships.find(s => s.no === no);
  if (have) { if (car) have.car = car; if (only) have.lines.forEach(l => { l.on = only.includes(l.i); }); saveCD(); return true; }
  const mem = sku => (CSB.sku || {})[sku] || {};
  CD.ships.push({ no, car: car || 'DHL Express', pack: '', phone: '', contents: '', inv: '', invDate: '', boxes: [{ kg: '', l: 10, w: 10, h: 10 }],
    lines: c.lines.filter(l => l.ok).map(l => ({ i: l.i, on: !only || only.includes(l.i), desc: mem(l.sku).desc || [l.t, l.v].filter(Boolean).join(' '), hs: mem(l.sku).hs || CSB.hsDefault, rate: l.price, box: 0 })) });
  saveCD(); return true;
}
const waitingAwb = () => (CSB ? CSB.batches : []).flatMap(b => b.ships.filter(s => !s.awb).map(s => Object.assign({ id: b.id }, s)));
function csbCheckSoon() { clearTimeout(csbTimer); csbTimer = setTimeout(csbCheck, 250); }
async function csbCheck() {
  if (!CD.ships.length) { CREP = null; return csbPaint(); }
  try { const r = await fetch('/api/csb/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: CD }) }).then(x => x.json()); if (r.ok) CREP = r; } catch (e) {}
  csbPaint();
}
/* Only the problem lists and the totals are redrawn while typing, so the box being typed in keeps focus. */
function csbPaint() {
  const rep = no => CREP && CREP.report.find(r => r.no === no);
  CD.ships.forEach(s => { const el = $('crep-' + s.no), r = rep(s.no); if (!el) return;
    el.innerHTML = !r ? '' : r.bad.map(t => `<div class="c-bad">${esc(t)}</div>`).join('') + r.warn.map(t => `<div class="c-warn">${esc(t)}</div>`).join('')
      + (r.bad.length ? '' : `<div class="c-ok">Ready for ${esc(r.car || 'DHL Express')}${(r.info || []).length ? ' · ' + esc(r.info.join(' · ')) : ''}</div>`);
    const v = $('cval-' + s.no); if (v && r) v.textContent = `${r.units || 0} unit${r.units === 1 ? '' : 's'} · ${(r.cur || '')} ${Number(r.value || 0).toFixed(2)}`; });
  const f = $('csbFoot'); if (!f) return;
  const bad = CREP ? CREP.report.filter(r => r.bad.length).length : 0;
  const n = c => CD.ships.filter(s => (s.car || 'DHL Express') === c).length;
  f.innerHTML = `<span class="s-muted"><b>${CD.ships.length}</b> shipment${CD.ships.length === 1 ? '' : 's'} · ${n('DHL Express')} DHL · ${n('FedEx')} FedEx${bad ? ` · <span class="s-bad">${bad} need fixing</span>` : CD.ships.length ? ' · <span class="c-okt">all ready</span>' : ''}</span>
    <button class="s-btn" type="button" data-cmake ${!CD.ships.length || bad || !CREP ? 'disabled' : ''}>Make the files${n('DHL Express') && n('FedEx') ? ' (DHL + FedEx)' : n('FedEx') ? ' (FedEx)' : ' (DHL CSB)'}</button>`;
  f.querySelector('[data-cmake]').addEventListener('click', csbMake);
}
function pageCsb() {
  if (!CSB) { loadCsb(); return '<div class="s-card s-empty">Loading…</div>'; }
  const inDraft = no => CD.ships.some(s => s.no === no);
  const cands = CSB.candidates.filter(c => !CQ || [c.no, c.cust, ...c.lines.map(l => l.sku + ' ' + l.t)].join(' ').toLowerCase().includes(CQ)).filter(c => !STORE || c.store === STORE);
  const order = no => S.orders.find(o => o.no === no);
  const cand = no => CSB.candidates.find(c => c.no === no) || { lines: [] };
  const opt = (list, v) => list.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const waiting = waitingAwb();
  return `${metrics('Dispatch', [[CSB.candidates.length, 'Orders with something ready'], [CD.ships.length, 'In the next file'], [waiting.length, 'Waiting for a tracking number', waiting.length ? 'amber' : ''], [CSB.batches.length, 'Files made']], 'DHL CSB-V and FedEx upload files, filled in — no carrier API needed')}
    <div class="s-card s-filterbar c-set">
      <label>Next GST invoice no<input id="cNext" value="${esc(CSB.nextInv || '')}" placeholder="e.g. 262721950"></label>
      <label>Currency<select id="cCur">${opt(CSB.currencies, CD.cur)}</select></label>
      <label>Tax payment<select id="cTax">${opt(CSB.taxOptions, CD.tax)}</select></label>
      <span class="sp"></span><span class="s-muted s-sm">1 · tick what is ready → 2 · make the files → 3 · upload them → 4 · type the tracking numbers below</span>
      <button class="s-btn" type="button" id="cBulk" title="Every ready order in one window: tick, weigh, make the files">Bulk order · ${readyOrders().length} ready</button></div>
    ${waiting.length ? card(`Waiting for tracking numbers · ${waiting.length}`, '<span class="s-muted s-sm">From the carrier, after you upload the file. Saving one ships the order and tells Shopify.</span>',
      table([['File', 'tl'], ['Order', 'tl'], ['Carrier'], ['Items', 'tl'], ['Invoice'], ['Tracking number', 'tl'], ['', 'act']], waiting.map(w => `<tr><td class="tl s-sm">${esc(w.id)}</td><td class="tl"><a href="#order/${esc(w.no)}">#${esc(w.no)}</a></td><td>${esc(w.car)}</td>
        <td class="tl s-sm">${esc(w.items.join(', '))}</td><td class="s-sm">${esc(w.inv)}</td><td class="tl"><input class="c-awb" data-awbin="${esc(w.id)}|${esc(w.no)}" placeholder="${w.car === 'FedEx' ? 'e.g. 794896720962' : 'e.g. 4417802211'}" aria-label="Tracking number for #${esc(w.no)}"></td>
        <td class="act"><button class="s-btn" type="button" data-awb="${esc(w.id)}|${esc(w.no)}">Save</button></td></tr>`))
      + `<div class="c-in c-paste"><label>Or paste many at once — one per line: order number, then tracking number<textarea id="awbPaste" rows="3" placeholder="8020  4417802211&#10;8037  794896720962"></textarea></label><button class="s-btn ghost" type="button" id="awbPasteGo">Save pasted</button></div>`, 'awbCard') : ''}
    <div class="c-grid">
      ${card('Ready to ship', '', `<div class="c-ph"><input id="cQ" value="${esc(CQ)}" placeholder="Order, customer or SKU" aria-label="Search orders"></div>
        <div class="c-list">${cands.map(c => { const all = c.lines.filter(l => l.k !== 'mcf' && l.k !== 'shipped').length;
          return `<button type="button" class="c-cand ${inDraft(c.no) ? 'on' : ''}" data-cadd="${esc(c.no)}" ${inDraft(c.no) ? 'disabled' : ''}>
            <span><b>#${esc(c.no)}</b>${c.source === 'test' ? ' <span class="st st-draft">TEST</span>' : ''} <span class="s-faint s-sm">· ${esc(c.store)} · ${esc(c.country)}</span>${sub(esc(c.cust))}</span>
            <span class="s-sm ${c.ready < all ? 'c-part' : 's-muted'}">${c.ready} of ${all} ready</span><span class="c-plus">${inDraft(c.no) ? '✓' : '+'}</span></button>`; }).join('') || '<div class="s-empty s-sm">Nothing is ready to ship. Lines show up here when production finishes them, or when India has the stock.</div>'}</div>`, '', 'c-pick')}
      <div class="c-ships">${CD.ships.map((s, si) => { const o = order(s.no), c = cand(s.no); if (!o) return '';
        const a = o.addr || {}, multi = s.boxes.length > 1, car = s.car || 'DHL Express';
        const notReady = c.lines.filter(l => !l.ok && l.k !== 'mcf' && l.k !== 'shipped');
        return card(`#${esc(o.no)} · ${esc(o.cust.n)} <span class="s-faint s-sm">· ${esc([a.city, a.state, a.country].filter(Boolean).join(', '))}</span>`,
          `<div class="seg">${(CSB.carriers || ['DHL Express', 'FedEx']).map(x => `<button class="segbtn ${car === x ? 'on' : ''}" type="button" data-ccar="${si}|${esc(x)}">${x === 'DHL Express' ? 'DHL' : esc(x)}</button>`).join('')}</div>
           <span class="s-sm s-muted" id="cval-${esc(s.no)}"></span><button class="s-link" type="button" data-cdel="${si}">Remove</button>`,
          `${table([['', 's-ck'], ['Item', 'tl'], ['State', 'tl'], ['Description for customs', 'tl'], ['HS code'], ['Rate']].concat(multi ? [['Box']] : []), s.lines.map((l, li) => {
              const cl = c.lines.find(x => x.i === l.i) || {}, it = o.items[l.i] || {};
              return `<tr class="${l.on === false ? 'c-off' : ''}"><td class="s-ck"><input type="checkbox" data-con="${si}|${li}" ${l.on === false ? '' : 'checked'} aria-label="Ship ${esc(it.t)} now"></td>
                <td class="tl">${prodCell(it, `${it.sku || ''} · × ${it.q}`)}</td><td class="tl s-sm">${st(cl.why || 'Ready', 'approved')}</td>
                <td class="tl" data-l="Description for customs"><input value="${esc(l.desc)}" data-cl="${si}|${li}|desc" aria-label="Description for customs"></td>
                <td data-l="HS code"><input class="c-hs" value="${esc(l.hs)}" inputmode="numeric" maxlength="8" data-cl="${si}|${li}|hs" aria-label="HS code"></td>
                <td data-l="Rate"><input class="c-n" type="number" min="0" step="0.01" value="${esc(l.rate)}" data-cl="${si}|${li}|rate" aria-label="Invoice rate per unit"></td>
                ${multi ? `<td data-l="Box"><select data-cl="${si}|${li}|box" aria-label="Which box">${s.boxes.map((b, k) => `<option value="${k}" ${+l.box === k ? 'selected' : ''}>${k + 1}</option>`).join('')}</select></td>` : ''}</tr>`; })
              /* The lines of this order that cannot go yet, and why — they stay on the order for a later box. */
              .concat(notReady.map(l => `<tr class="c-off"><td class="s-ck"><input type="checkbox" disabled aria-label="Not ready"></td><td class="tl">${prodCell(o.items[l.i], `${l.sku || ''} · × ${l.q}`)}</td>
                <td class="tl s-sm" colspan="${multi ? 5 : 4}">${st('Not ready', 'pending')} ${esc(l.why)}</td></tr>`)), '', '', 'c-lines')}
          <div class="c-in"><div class="c-box">${s.boxes.map((b, k) => `<div class="c-b"><span class="s-sm"><b>${multi ? 'Box ' + (k + 1) : 'Box'}</b></span>
              <label>kg<input class="c-n" type="number" min="0" step="0.01" value="${esc(b.kg)}" data-cb="${si}|${k}|kg" placeholder="weigh"></label>
              <label>L<input class="c-n" type="number" min="1" value="${esc(b.l)}" data-cb="${si}|${k}|l"></label>
              <label>W<input class="c-n" type="number" min="1" value="${esc(b.w)}" data-cb="${si}|${k}|w"></label>
              <label>H<input class="c-n" type="number" min="1" value="${esc(b.h)}" data-cb="${si}|${k}|h"></label>
              ${multi ? `<button class="s-link" type="button" data-cbdel="${si}|${k}">✕</button>` : ''}</div>`).join('')}
            <button class="s-link" type="button" data-cbadd="${si}">+ Another box</button></div>
          <div class="c-more">
            <label>Phone<input value="${esc(s.phone)}" data-cs="${si}|phone" placeholder="${esc(a.phone || o.cust.ph || 'mandatory')}"></label>
            <label>Contents<input value="${esc(s.contents)}" data-cs="${si}|contents" maxlength="35" placeholder="from the items"></label>
            <label>GST invoice no<input value="${esc(s.inv)}" data-cs="${si}|inv" placeholder="${esc(CSB.nextInv ? 'auto' : 'type it')}"></label>
            <label>Invoice date<input type="date" value="${esc(s.invDate || CSB.today)}" data-cs="${si}|invDate"></label>
            ${car === 'FedEx' ? `<label>FedEx packaging<select data-cs="${si}|pack"><option value="">By weight</option>${(CSB.packaging || []).map(p => `<option ${s.pack === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>` : ''}</div>
          <div class="c-rep" id="crep-${esc(s.no)}"></div></div>`, '', 'c-ship'); }).join('') || '<div class="s-card s-empty">Add orders from "Ready to ship" — each one becomes a shipment in the next file. Or tick orders on the Orders page and press "Add to Dispatch", or use Ship on an order.</div>'}
        <div class="s-card c-foot s-cf" id="csbFoot"></div></div>
    </div>
    ${card('Files made', '<span class="s-muted s-sm">Copies are kept in shopify-hub\\csb-files</span>', table([['File', 'tl'], ['Made'], ['Shipments · carrier · invoice · tracking', 'tl'], ['', 'act']],
      CSB.batches.map(b => `<tr><td class="tl"><b>${esc(b.id)}</b></td><td class="s-nowrap">${fmt(b.at)}</td><td class="tl s-sm">${b.ships.map(s => `<a href="#order/${esc(s.no)}">#${esc(s.no)}</a> · ${esc(s.car)} · ${esc(s.inv)} · ${s.awb ? `<span class="s-trk">${esc(s.awb)}</span>` : '<span class="s-bad">waiting for tracking no.</span>'}`).join('<br>')}</td>
        <td class="act"><button class="s-btn ghost" type="button" data-cagain="${esc(b.id)}">Download again</button>${b.ships.some(s => s.awb) ? '' : `<button class="s-link" type="button" data-cforget="${esc(b.id)}">Take back</button>`}</td></tr>`), 'None yet.'))}`;
}
function wireCsb(page) {
  const on = (sel, ev, fn) => page.querySelectorAll(sel).forEach(el => el.addEventListener(ev, e => fn(el, e)));
  const changed = () => { saveCD(); csbCheckSoon(); };
  on('#cQ', 'input', el => { CQ = el.value.trim().toLowerCase(); const pos = el.selectionStart; render(); const q = $('cQ'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } });
  on('#cCur', 'change', el => { CD.cur = el.value; changed(); });
  on('#cTax', 'change', el => { CD.tax = el.value; changed(); });
  on('#cNext', 'change', el => post('/api/csb/next', { nextInv: el.value.trim() }).then(d => { if (d) { CSB = Object.assign(CSB, d); render(); toast(d.nextInv ? 'Next GST invoice no: ' + d.nextInv : 'Invoice numbering cleared'); } }));
  on('#cBulk', 'click', () => bulkShipDlg(readyOrders(), 'Bulk order'));
  on('[data-cadd]', 'click', el => { csbAdd(el.dataset.cadd); render(); });
  on('[data-cdel]', 'click', el => { CD.ships.splice(+el.dataset.cdel, 1); saveCD(); render(); });
  on('[data-cbadd]', 'click', el => { const s = CD.ships[+el.dataset.cbadd], b = s.boxes[s.boxes.length - 1]; s.boxes.push({ kg: '', l: b.l, w: b.w, h: b.h }); saveCD(); render(); });
  on('[data-cbdel]', 'click', el => { const [si, k] = el.dataset.cbdel.split('|').map(Number), s = CD.ships[si]; s.boxes.splice(k, 1); s.lines.forEach(l => { if (+l.box >= s.boxes.length) l.box = s.boxes.length - 1; }); saveCD(); render(); });
  on('[data-cl]', 'input', el => { const [si, li, f] = el.dataset.cl.split('|'); CD.ships[+si].lines[+li][f] = f === 'box' ? +el.value : el.value; changed(); });
  on('[data-cb]', 'input', el => { const [si, k, f] = el.dataset.cb.split('|'); CD.ships[+si].boxes[+k][f] = el.value; changed(); });
  on('[data-cs]', 'input', el => { const [si, f] = el.dataset.cs.split('|'); CD.ships[+si][f] = el.value; changed(); });
  on('[data-ccar]', 'click', el => { const [si, c] = el.dataset.ccar.split('|'); CD.ships[+si].car = c; saveCD(); render(); });
  on('[data-con]', 'change', el => { const [si, li] = el.dataset.con.split('|'); CD.ships[+si].lines[+li].on = el.checked; saveCD(); render(); });
  on('[data-cagain]', 'click', el => csbAgain(el.dataset.cagain));
  on('[data-cforget]', 'click', el => dialog('Take this file back?', `<span>Use this when ${esc(el.dataset.cforget)} was not uploaded, or was made wrong: its orders go back to <b>ready to ship</b>. If it was already uploaded, cancel those shipments on the carrier's site too.</span>`,
    '<button class="s-btn" type="button" id="go">Take back</button>', () => $('go').addEventListener('click', () => { close(); post('/api/csb/forget', { id: el.dataset.cforget }).then(d => { if (d) { CSB = d; render(); } }); })));
  /* Tracking numbers: one at a time (Save, or Enter in the box), or pasted as "order number  tracking number" lines. */
  const saveAwb = (id, no) => { const inp = page.querySelector(`[data-awbin="${id}|${no}"]`), trk = inp ? inp.value.trim() : '';
    if (!trk) return toast('Type the tracking number', true);
    post('/api/csb/awb', { id, no, trk }).then(d => { if (d) { CSB = d; render(); } }); };
  on('[data-awb]', 'click', el => { const [id, no] = el.dataset.awb.split('|'); saveAwb(id, no); });
  on('[data-awbin]', 'keydown', (el, e) => { if (e.key === 'Enter') { const [id, no] = el.dataset.awbin.split('|'); saveAwb(id, no); } });
  on('#awbPasteGo', 'click', () => { const t = $('awbPaste').value.trim(); if (!t) return toast('Paste the lines first', true); post('/api/csb/awb', { text: t }).then(d => { if (d) { CSB = d; render(); } }); });
  csbCheck();
}
/* ---- writing the carriers' .xls files (SheetJS, loaded only when a file is made) ---- */
function sheetjs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => ok(window.XLSX); s.onerror = () => no(new Error('Could not load the Excel writer from cdnjs — is the internet on?')); document.head.appendChild(s); });
}
const xlSerial = iso => { const [y, m, d] = String(iso).split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };
const TEMPLATE = { dhl: ['/csb/template.xls', 'DHL'], fedex: ['/fedex/template.xls', 'FedEx'] };
/* The carrier's own workbook with our rows in its sheets; every other sheet (lookups, user guide) kept as it is.
 * If the carrier ever changes a sheet's headings, stop rather than upload columns in the wrong place. */
async function fillWorkbook(kind, sheets) {
  const X = await sheetjs(), [url, who] = TEMPLATE[kind];
  const wb = X.read(await (await fetch(url)).arrayBuffer(), { type: 'array' });
  const norm = h => String(h).replace(/\s+/g, ' ').trim();
  sheets.forEach(sh => {
    const name = sh.name || wb.SheetNames[0], old = wb.Sheets[name];
    if (!old) throw new Error(`${who}'s template has no sheet "${name}" any more — get a fresh template from ${who}`);
    const theirs = (X.utils.sheet_to_json(old, { header: 1 })[0] || []).map(norm), mine = sh.head.map(norm);
    const diff = mine.findIndex((h, i) => h !== theirs[i]);
    if (diff >= 0 || theirs.length !== mine.length) throw new Error(`${who}'s template does not match column ${diff + 1} of "${name}" ("${theirs[diff] || ''}" vs "${mine[diff] || ''}") — get a fresh template from ${who}`);
    const ws = X.utils.aoa_to_sheet([sh.head].concat(sh.rows.map(row => row.map(v => v && typeof v === 'object' && v.date ? xlSerial(v.date) : v))));
    sh.rows.forEach((row, ri) => row.forEach((v, ci) => { if (v && typeof v === 'object' && v.date) ws[X.utils.encode_cell({ r: ri + 1, c: ci })].z = 'dd-mm-yyyy'; }));
    ws['!cols'] = sh.head.map(h => ({ wch: Math.min(40, Math.max(10, String(h).length + 2)) }));
    wb.Sheets[name] = ws;
  });
  return new Uint8Array(X.write(wb, { bookType: 'biff8', type: 'array' }));
}
const fedexSheets = f => [{ name: 'Recipient and Invoice Data', head: f.head, rows: f.rows }, { name: 'MPS Dimension', head: f.mpsHead, rows: f.mps }];
/* Download each file the batch has (DHL CSB, FedEx), and keep a copy in shopify-hub/csb-files. */
async function csbDeliver(id, r) {
  const out = [];
  if (r.dhl) out.push(['dhl', `${id}-DHL-CSB.xls`, await fillWorkbook('dhl', [{ head: r.dhl.head, rows: r.dhl.rows }])]);
  if (r.fedex) out.push(['fedex', `${id}-FedEx.xls`, await fillWorkbook('fedex', fedexSheets(r.fedex))]);
  for (const [kind, name, bytes] of out) {
    download(new Blob([bytes], { type: 'application/vnd.ms-excel' }), name);
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    await fetch('/api/csb/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, kind, b64: btoa(bin) }) }).catch(() => {});
  }
  return out.map(x => x[1]);
}
async function csbMake() {
  try {
    /* Before anything is booked or an invoice number used up: the Excel writer loads and both templates still match. */
    const cars = new Set(CD.ships.map(s => s.car || 'DHL Express'));
    if (cars.has('DHL Express')) await fillWorkbook('dhl', [{ head: CREP.head, rows: [] }]);
    if (cars.has('FedEx')) await fillWorkbook('fedex', fedexSheets(Object.assign({}, CREP.fx, { rows: [], mps: [] })));
    const d = await call('/api/csb/make', { draft: Object.assign({}, CD, { nextInv: CSB.nextInv }) });
    const names = await csbDeliver(d.batch.id, d);
    CD.ships = []; saveCD(); CSB = d; CREP = null;
    render(); toast(`${names.join(' + ')} downloaded — upload ${names.length > 1 ? 'them' : 'it'} on the carrier's site, then type the tracking numbers here`);
  } catch (e) { toast(e.message, true); }
}
async function csbAgain(id) {
  try { const d = await call('/api/csb/again', { id }); const names = await csbDeliver(id, d); toast(names.join(' + ') + ' downloaded again'); }
  catch (e) { toast(e.message, true); }
}

/* ============================== 7 · SETUP ============================== */
function pageSetup() {
  const C = S.connections, H = S.health || {};
  const rows = Object.keys(C).map(k => { const live = C[k] === 'live', h = H[k];
    return `<tr><td class="tl"><b>${esc(k)}</b></td><td>${live ? (h ? st(h.ok ? 'Working' : 'Problem', h.ok ? 'approved' : 'rejected') : st('Keys filled', 'pending')) : st('Test mode', 'draft')}</td>
      <td class="tl s-sm s-muted">${h ? esc(h.note) + ' · checked ' + fmt(h.at) : live ? 'Press "Check connections"' : 'No keys yet — simulated'}</td></tr>`; });
  const cnt = k => S.queue.filter(q => q.status === k).length;
  const qs = S.queue.slice(0, 80).map(q => `<tr><td class="s-nowrap">${fmt(q.at)}</td><td><a href="#order/${esc(q.orderNo)}">#${esc(q.orderNo)}</a></td><td class="tl">${esc(q.desc)}${q.last ? sub(esc(q.last)) : ''}${q.preview ? `<span class="sub ${q.preview.ok ? 'c-okt' : 's-bad'}">Shopify check (read only, ${fmt(q.preview.at)}): ${esc(q.preview.note)}</span>` : ''}</td>
    <td>${st(q.status, q.status === 'sent' ? 'approved' : q.status === 'failed' ? 'rejected' : q.status === 'waiting' || q.status === 'held' ? 'pending' : 'draft')}</td></tr>`);
  return `${metrics('Setup', [[Object.values(C).filter(v => v === 'live').length + ' of ' + Object.keys(C).length, 'Connections with keys'], [S.settings.writes ? 'ON' : 'off', 'Sending to Shopify', S.settings.writes ? 'green' : ''], [S.settings.realMcf ? 'ON' : 'off', 'Real Amazon MCF', S.settings.realMcf ? 'red' : ''], [S.settings.fedexShip.on ? (S.settings.fedexShip.sandbox ? 'sandbox' : 'REAL') : 'off', 'FedEx labels', S.settings.fedexShip.on && !S.settings.fedexShip.sandbox ? 'red' : ''], [cnt('failed'), 'Failed to Shopify', cnt('failed') ? 'red' : '']], 'Keys live in shopify-hub\\config.local.json — restart the hub after editing')}
    <div class="s-two2">
      ${card('Connections', '<button class="s-btn ghost" type="button" data-h="check">Check connections</button>', table([['Connection', 'tl'], ['State'], ['What it says', 'tl']], rows))}
      ${card('Test it', '', `<div class="h-btns">
          <button class="s-btn" type="button" data-h="simulate">Simulate the next update for every parcel</button>
          <button class="s-btn ghost" type="button" data-h="track">Check live tracking now</button>
          <button class="s-btn ghost" type="button" data-h="import">Pull orders from Shopify</button>
          <button class="s-btn ghost" type="button" data-h="queue">Send the Shopify queue now (incl. held)</button>
          <button class="s-btn ghost" type="button" data-h="discard">Discard held changes</button>
          <button class="s-btn ghost" type="button" data-h="testorder" data-store="Ridhi">Make a test order in Shopify (Ridhi)</button>
          <button class="s-btn ghost" type="button" data-h="testorder" data-store="CPC">… (CPC)</button>
          <button class="s-link" type="button" data-h="reset">Reset temp orders</button></div>
        <ol class="h-steps"><li>Open a <b>TEST</b> order with lines to route (#T4876), pick MCF / Make / India, send.</li>
          <li>Production: on the order, press the stage buttons, or "Put on hold" — Orders → "In production" shows the bottleneck.</li>
          <li>Ship: FedEx makes the label here (sandbox), or type any carrier's tracking number.</li>
          <li>"Simulate the next update" moves every parcel one step, the way Amazon or a carrier would — watch the Orders rows light up.</li></ol>`, '', 'h-test')}
    </div>
    ${card('To Shopify', `<button class="s-btn ghost" type="button" data-h="preview" title="Reads Shopify only — sends nothing">Check with Shopify (read only)</button><span class="s-muted s-sm">${cnt('sent')} sent · ${cnt('waiting')} waiting · ${cnt('held')} held · ${cnt('failed')} failed · ${cnt('test')} test only${cnt('discarded') ? ' · ' + cnt('discarded') + ' discarded' : ''}</span>`,
      table([['When'], ['Order'], ['What', 'tl'], ['Status']], qs, 'Nothing yet — route a line on an order.'))}`;
}

/* ============================== DIALOGS ============================== */
let opener = null;
function close() {
  if (!$('dlg').innerHTML) return;
  $('dlg').innerHTML = '';
  if (opener && document.contains(opener)) opener.focus();
  opener = null;
}
function dialog(title, body, foot, wire, cancel) {
  if (!$('dlg').innerHTML) opener = document.activeElement;
  $('dlg').innerHTML = `<div class="s-scrim" id="scrim"><div class="s-dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dh">${esc(title)}<button class="s-x" type="button" data-x aria-label="Close">×</button></div>
    <div class="db">${body}</div><div class="df"><button class="s-btn ghost" type="button" data-x>${cancel || 'Cancel'}</button>${foot}</div></div></div>`;
  $('scrim').addEventListener('click', e => { if (e.target.id === 'scrim' || e.target.closest('[data-x]')) close(); });
  if (wire) wire();
  const first = $('dlg').querySelector('.db input:not([type=checkbox]),.db select') || $('go');
  if (first) first.focus({ preventScroll: true });
}
const focusables = el => [...el.querySelectorAll('button:not(:disabled),input,select,textarea,a[href]')];
document.addEventListener('keydown', e => {
  const inField = e.target.closest && e.target.closest('input,select,textarea');
  if (e.key === 'Escape') {
    if ($('dlg').innerHTML) close();
    else if ($('omodal')) location.hash = 'orders';
    else if (e.target.id === 'q' && Q) { $('q').value = ''; Q = ''; render(); }
    return;
  }
  if (e.key === 'Tab' && $('dlg').innerHTML) {
    const f = focusables($('dlg')); if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
    return;
  }
  if (e.key === '/' && !inField && !$('dlg').innerHTML) { e.preventDefault(); $('q').focus(); $('q').select(); }
});
const live = o => o.source === 'shopify';
const lineList = (o, items) => `<table class="s-tbl s-mini"><thead><tr><th class="tl">Product</th><th>SKU</th><th>Qty</th><th class="num">Price</th></tr></thead><tbody>${items.map(i => `<tr><td class="tl">${prodCell(o.items[i], o.items[i].v)}</td><td>${esc(o.items[i].sku)}</td><td>× ${o.items[i].q}</td><td class="num">${money(o.items[i].price)}</td></tr>`).join('')}</tbody></table>`;

async function mcfDlg(o, lines) {
  let p;
  try { p = await call('/api/mcf-preview', { no: o.no, lines }); } catch (e) { return toast(e.message, true); }
  const opts = p.options.filter(x => x.ok);
  if (!opts.length) return toast('Amazon cannot ship these lines by MCF.', true);
  let k = 0;
  const realNote = live(o) && S.settings.realMcf ? '<b class="s-bad">This places a REAL Amazon shipment and costs the fee.</b>' : 'Simulated — no real Amazon order is placed.';
  const draw = () => dialog(`Send by Amazon MCF · #${o.no}`, `${lineList(o, lines)}<div class="lab">Speed${p.real ? '' : ' · example fees'}</div>
    <div class="s-route">${opts.map((s, i) => `<button class="s-ro ${k === i ? 'on' : ''}" type="button" data-sp="${i}"><b>${esc(s.speed)}</b><span>${esc(s.by)} · ${money(s.fee)}</span></button>`).join('')}</div>
    <div class="s-will"><b>On confirm</b><ul><li>Place Amazon order SHOP-${esc(o.no)}-${o.pkgs.length + 1} (${money(opts[k].fee)}) — ${realNote}</li>
      <li>${live(o) ? `Split the order in Shopify, mark these lines in progress, add the note "MCF done for ${esc(lines.map(i => o.items[i].sku).join(', '))}", tag MCF` : 'Temp test order: show what would go to Shopify, send nothing'}</li></ul></div>`,
    `<button class="s-btn" type="button" id="go">Send by MCF · ${money(opts[k].fee)}</button>`, () => {
      document.querySelectorAll('[data-sp]').forEach(b => b.addEventListener('click', () => { k = +b.dataset.sp; draw(); }));
      $('go').addEventListener('click', () => act('decide', { no: o.no, route: 'mcf', lines, speed: opts[k].speed }));
    });
  draw();
}
function prodDlg(o, lines) {
  dialog(`Request production · #${o.no}`, `${lineList(o, lines)}
    <div><label for="prio">Priority</label><select id="prio"><option value="">Normal</option><option value="rush">Rush — the customer is waiting</option></select></div>
    <div><label for="pnote">Note for the factory</label><input id="pnote" placeholder="Optional"></div>
    <div class="s-will"><b>On confirm</b><ul><li>Create production order SHP-${esc(o.no)} at Requested</li><li>${live(o) ? 'Tag the Shopify order "In production"' : 'Temp test order: nothing is sent to Shopify'}</li></ul></div>`,
    `<button class="s-btn" type="button" id="go">Request production</button>`,
    () => $('go').addEventListener('click', () => act('decide', { no: o.no, route: 'make', lines, rush: $('prio').value === 'rush', note: $('pnote').value.trim() })));
}
/* Courier: either India lines being routed now (lines) or a part that is ready (part).
 * FedEx, when its shipping keys are in: the hub creates the shipment itself — label and tracking number come back.
 * Every other carrier (or "I already have a tracking number"): the number is typed in. */
function courierDlg(o, opt, preset) {
  const fx = S.settings.fedexShip || {};
  let pick = (preset && preset.pick) || (fx.on ? 'FedEx' : 'DHL Express'), mode = (preset && preset.mode) || (fx.on ? 'create' : 'manual');
  const items = opt.lines || o.pkgs[opt.part].items;
  const mem = sku => (S.customs || {})[sku] || {};
  const F = { trk: '', notify: true, kg: '', l: 30, w: 25, h: 8, inv: '', rates: null, service: '',
    customs: Object.fromEntries(items.map(i => [i, { desc: mem(o.items[i].sku).desc || [o.items[i].t, o.items[i].v].filter(Boolean).join(' '), hs: mem(o.items[i].sku).hs || S.hsDefault, rate: o.items[i].price }])) };
  const creating = () => pick === 'FedEx' && fx.on && mode === 'create';
  const val = (k, v) => `value="${esc(v)}" data-f="${k}"`;
  const createBody = () => `<div class="lab">What is in the box · for customs</div>
    <div class="fx-lines">${items.map(i => { const it = o.items[i], c = F.customs[i]; return `<div class="fx-ln">${prodCell(it, `${it.sku} · × ${it.q}`)}
      <div class="fx-box"><label class="fx-d">Description<input ${val('desc|' + i, c.desc)}></label><label>HS code<input class="c-hs" maxlength="8" inputmode="numeric" ${val('hs|' + i, c.hs)}></label><label>Value / unit (USD)<input class="c-n" type="number" min="0" step="0.01" ${val('rate|' + i, c.rate)}></label></div></div>`; }).join('')}</div>
    <div class="lab">Box</div>
    <div class="fx-box"><label>Weight kg<input class="c-n" type="number" min="0" step="0.01" placeholder="weigh it" ${val('kg', F.kg)}></label>
      <label>L cm<input class="c-n" type="number" min="1" ${val('l', F.l)}></label><label>W cm<input class="c-n" type="number" min="1" ${val('w', F.w)}></label><label>H cm<input class="c-n" type="number" min="1" ${val('h', F.h)}></label>
      <button class="s-btn ghost" type="button" id="fxRates">${F.rates ? 'Prices again' : 'Get prices'}</button></div>
    ${F.rates ? `<div class="s-route fx-svc">${F.rates.map(r => `<button class="s-ro ${F.service === r.type ? 'on' : ''}" type="button" data-svc="${esc(r.type)}"><b>${esc(r.name)}</b><span>${r.amount != null ? esc(r.currency + ' ' + Number(r.amount).toFixed(2)) : ''}${r.by ? ' · by ' + esc(r.by) : ''}</span></button>`).join('') || '<span class="s-muted s-sm">FedEx offered no service for this.</span>'}</div>` : ''}
    <div class="fx-box"><label>GST invoice no<input ${val('inv', F.inv)} placeholder="${esc(fx.sandbox ? 'TEST-' + o.no + ' (sandbox)' : S.nextInv ? 'auto: ' + S.nextInv : 'type it')}"></label></div>
    <label class="s-check"><input type="checkbox" data-f="notify" ${F.notify ? 'checked' : ''}> Email the customer their tracking link</label>
    <button class="s-link" type="button" id="fxManual" style="align-self:flex-start">I already have a FedEx tracking number</button>
    <div class="s-will"><b>On confirm</b><ul><li>${fx.sandbox ? '<b>FedEx SANDBOX</b>: a test label, no parcel, no charge' : '<b class="s-bad">Book a REAL FedEx shipment on your account</b>'} — the tracking number and label come back by themselves</li>
      <li>${live(o) ? 'Mark these lines fulfilled in Shopify with the FedEx tracking number' : 'Temp test order: show what would go to Shopify, send nothing'}</li><li>Follow the parcel until it is delivered</li></ul></div>`;
  const manualBody = () => `${lineList(o, items)}<div><label for="trk">Tracking number</label><input id="trk" ${val('trk', F.trk)} placeholder="${pick === 'FedEx' ? 'e.g. 779044210110' : pick === 'UPS' ? 'e.g. 1Z9W43E80312345678' : 'e.g. 4417802366'}"></div>
    ${pick === 'FedEx' && fx.on ? '<button class="s-link" type="button" id="fxCreate" style="align-self:flex-start">Create the shipment with FedEx instead</button>' : ''}
    <label class="s-check"><input type="checkbox" data-f="notify" ${F.notify ? 'checked' : ''}> Email the customer their tracking link</label>
    <div class="s-will"><b>On confirm</b><ul><li>${live(o) ? `Fulfil these lines in Shopify with the ${esc(pick)} tracking number` : 'Temp test order: show what would go to Shopify, send nothing'}</li><li>Follow the parcel until it is delivered</li></ul></div>`;
  const payload = () => ({ no: o.no, lines: opt.lines, part: opt.part, box: { kg: F.kg, l: F.l, w: F.w, h: F.h }, inv: F.inv.trim(), notify: F.notify, service: F.service,
    customs: items.map(i => Object.assign({ i }, F.customs[i])) });
  const draw = () => dialog(`Ship · #${o.no}`, `<button class="s-link sh-back" type="button" id="shBack">← Other ways to ship (DHL CSB file, FedEx upload file)</button>
    <div class="lab">Carrier</div>
    <div class="s-route">${CARRIERS.map(c => `<button class="s-ro ${pick === c ? 'on' : ''}" type="button" data-c="${c}"><b>${c}</b><span>${c === 'FedEx' && fx.on ? 'Label made here · live tracking' : S.connections[c] === 'live' ? 'Live tracking' : 'Tracking simulated (no keys)'}</span></button>`).join('')}</div>
    ${creating() ? createBody() : manualBody()}`,
    creating() ? `<button class="s-btn" type="button" id="go" ${F.service ? '' : 'disabled'}>${F.service ? 'Create FedEx shipment' : 'Get prices, pick a service'}</button>` : `<button class="s-btn" type="button" id="go">Mark as shipped</button>`, () => {
      document.querySelectorAll('#dlg [data-f]').forEach(el => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        const [k, i] = el.dataset.f.split('|');
        if (i != null) F.customs[i][k] = el.value; else F[k] = el.type === 'checkbox' ? el.checked : el.value;
        if ((['kg', 'l', 'w', 'h'].includes(k) || i != null) && F.rates) { F.rates = null; F.service = ''; draw(); const e = document.querySelector(`#dlg [data-f="${el.dataset.f}"]`); if (e) { e.focus(); const v = e.value; e.value = ''; e.value = v; } }
      }));
      document.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => { pick = b.dataset.c; draw(); }));
      $('shBack').addEventListener('click', () => shipDlg(o, opt));
      document.querySelectorAll('[data-svc]').forEach(b => b.addEventListener('click', () => { F.service = b.dataset.svc; draw(); }));
      if ($('fxManual')) $('fxManual').addEventListener('click', () => { mode = 'manual'; draw(); });
      if ($('fxCreate')) $('fxCreate').addEventListener('click', () => { mode = 'create'; draw(); });
      if ($('fxRates')) $('fxRates').addEventListener('click', async () => {
        try { const d = await call('/api/fedex/rates', payload()); F.rates = d.options; if (!F.rates.some(r => r.type === F.service)) F.service = (F.rates.find(r => r.type === 'FEDEX_INTERNATIONAL_PRIORITY') || F.rates[0] || {}).type || ''; draw(); }
        catch (e) { toast(e.message, true); }
      });
      $('go').addEventListener('click', async () => {
        if (creating()) {
          try {
            const d = await call('/api/action', Object.assign({ type: 'fedexShip' }, payload()));
            render(); toast(d.msg);
            const o2 = S.orders.find(x => x.no === o.no), pk = o2 && o2.pkgs.filter(p => p.fedex).sort((a, b) => b.fedex.at - a.fedex.at)[0];
            if (pk) fedexDoneDlg(o2, pk);
          } catch (e) { toast(e.message, true); }
          return;
        }
        const trk = F.trk.trim();
        if (!trk) return toast('Type the tracking number', true);
        if (opt.lines) act('decide', { no: o.no, route: 'india', lines: opt.lines, car: pick, trk, notify: F.notify });
        else act('ship', { no: o.no, part: opt.part, car: pick, trk, notify: F.notify });
      });
    });
  draw();
}
/* Right after FedEx booked it: the tracking number, and the label to print. */
function fedexDoneDlg(o, pk) {
  const f = pk.fedex;
  dialog(`FedEx shipment created · #${o.no}`, `<dl class="s-kv s-kv-dlg"><dt>Tracking</dt><dd><span class="s-trk fx-trk">${esc(f.trk)}</span></dd>
      <dt>Service</dt><dd>${esc(f.service)}</dd><dt>GST invoice</dt><dd>${esc(f.inv)}</dd>${f.sandbox ? '<dt>Mode</dt><dd><b>SANDBOX test label — do not ship</b></dd>' : ''}</dl>
    <div class="h-btns">${fxDocs(f)}</div>
    ${f.etd ? '<span class="s-ok">FedEx has the invoice electronically.</span>' : '<span class="s-sm" style="color:var(--warn-ink)">FedEx did not take the electronic invoice — print the invoice and put it in the pouch with the label.</span>'}
    ${(f.alerts || []).length ? `<span class="s-faint s-sm">FedEx notes: ${esc(f.alerts.join(' · '))}</span>` : ''}`, '', null, 'Done');
}
function blockDlg(o, n) {
  const pk = o.pkgs[n]; let why = CAUSES[0];
  dialog(`Put on hold · #${o.no}`, `${lineList(o, pk.items)}<div class="lab">Reason · at ${STAGES[pk.pos]}</div>
    <div class="s-route">${CAUSES.map((c, i) => `<button class="s-ro ${i ? '' : 'on'}" type="button" data-why="${esc(c)}"><b>${esc(c)}</b></button>`).join('')}</div>
    <div class="s-muted s-sm">Stays on hold until someone selects Resolve.</div>`,
    `<button class="s-btn" type="button" id="go">Put on hold</button>`, () => {
      document.querySelectorAll('[data-why]').forEach(b => b.addEventListener('click', () => { why = b.dataset.why; document.querySelectorAll('[data-why]').forEach(x => x.classList.toggle('on', x === b)); }));
      $('go').addEventListener('click', () => act('block', { no: o.no, part: n, why }));
    });
}
function retTrkDlg(o, n) {
  dialog(`Return tracking · #${o.no}`, `<div><label for="rcar">Carrier</label><select id="rcar"><option>USPS</option><option>UPS</option><option>FedEx</option></select></div>
    <div><label for="rtrk">Tracking number</label><input id="rtrk"></div>`, `<button class="s-btn" type="button" id="go">Save</button>`,
    () => $('go').addEventListener('click', () => act('returnStep', { no: o.no, ret: n, kind: 'rtrk', car: $('rcar').value, trk: $('rtrk').value.trim() })));
}
function startRetDlg(o) {
  dialog(`Start a return · #${o.no}`, `<div class="lab">Items</div>${o.items.map((it, i) => `<label class="s-check"><input type="checkbox" data-ri="${i}" ${i ? '' : 'checked'}>${sw(it)}<span><b>${esc(it.t)}</b> · ${esc(it.v)} · ${esc(it.sku)}</span></label>`).join('')}
    <div><label for="rwhy">Reason</label><select id="rwhy"><option>Arrived damaged</option><option>Wrong item</option><option>Wrong size</option><option>Did not like it</option></select></div>
    <div><label for="rwhat">Outcome</label><select id="rwhat"><option value="return">Refund — item returned</option><option value="both">Replacement — item returned</option><option value="replace">Replacement — customer keeps item</option></select></div>`,
    `<button class="s-btn" type="button" id="go">Start return</button>`,
    () => $('go').addEventListener('click', () => {
      const items = [...document.querySelectorAll('[data-ri]')].filter(c => c.checked).map(c => +c.dataset.ri);
      if (!items.length) return toast('Select at least one item', true);
      act('returnStart', { no: o.no, items, why: $('rwhy').value, what: $('rwhat').value });
    }));
}
/* CHASE A LATE PARCEL: everything needed on one screen — the number to quote, the carrier's own page, the last scan,
 * a message for the customer — and a record that it was done, so the row stops asking. */
function chaseDlg(o, n) {
  const pk = o.pkgs[n], t = pk.trk[0] || pk.mcfId || '', url = CARRIER_URL[carName(pk)], f = flagOf(pk), L = pk.last || {};
  const why = { late: 'is running late', customs: 'is held at customs in the US', returned: 'is on its way back to us', failed: 'could not be delivered', stale: 'has not been scanned for a few days' }[f] || 'is delayed';
  const msg = `Hi ${String(o.cust.n).split(' ')[0]}, your order #${o.no} is with ${carName(pk)} and ${why}. We have asked ${carName(pk)} about it and will email you as soon as it moves. Tracking: ${t}`;
  dialog(`Chase carrier · #${o.no}`, `<dl class="s-kv s-kv-dlg"><dt>Carrier</dt><dd><b>${esc(carName(pk))}</b></dd>
      <dt>Tracking</dt><dd><span class="s-trk">${esc(t)}</span> <button class="s-link" type="button" id="cpy">Copy</button>${url && t ? ` · <a class="s-link" href="${esc(url(t))}" target="_blank" rel="noopener">Open on ${esc(carName(pk))} ↗</a>` : ''}</dd>
      <dt>Last scan</dt><dd><span class="s-bad">${esc(L.text || J.FLAGS[f] || stText(pk))}</span>${L.place ? ' · ' + esc(L.place) : ''}${L.at ? ' · ' + fmt(L.at) : ''}</dd>
      ${pk.eta ? `<dt>Was due</dt><dd>${esc(pk.eta)}</dd>` : ''}</dl>
    <div><label for="cmsg">Message to the customer</label><textarea id="cmsg" rows="4">${esc(msg)}</textarea></div>
    <div><label for="cnote">What the carrier said (kept on the order)</label><input id="cnote" placeholder="e.g. Case 4471, release expected 25 Oct"></div>`,
    `${o.cust.e ? '<button class="s-btn ghost" type="button" id="send">Email customer</button>' : ''}<button class="s-btn" type="button" id="go">Mark followed up</button>`, () => {
      $('cpy').addEventListener('click', () => (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('Tracking number copied'), () => toast(t)));
      /* Opens your own mail program with the message filled in; you press send there. */
      if ($('send')) $('send').addEventListener('click', () => { location.href = `mailto:${encodeURIComponent(o.cust.e)}?subject=${encodeURIComponent('Your order #' + o.no)}&body=${encodeURIComponent($('cmsg').value)}`; });
      $('go').addEventListener('click', () => act('chase', { no: o.no, part: n, said: $('cnote').value.trim() }));
    });
}
/* The carrier's tracking number for a part waiting in a Dispatch file. */
function awbDlg(o, n) {
  const pk = o.pkgs[n], b = pk.booked;
  dialog(`${b.car} tracking number · #${o.no}`, `<div class="s-muted s-sm">From ${esc(b.car)}, after you uploaded ${esc(b.id)}. Saving it ships this part: Shopify is told (lines fulfilled, customer e-mailed) and follows the parcel.</div>
    ${lineList(o, pk.items)}<div><label for="awbOne">Tracking number</label><input id="awbOne" placeholder="${b.car === 'FedEx' ? 'e.g. 794896720962' : 'e.g. 4417802211'}"></div>`,
    '<button class="s-btn" type="button" id="go">Save and ship</button>', () => {
      const go = () => { const t = $('awbOne').value.trim(); if (!t) return toast('Type the tracking number', true); close(); post('/api/csb/awb', { id: b.id, no: o.no, trk: t }).then(d => { if (d) { CSB = d; render(); } }); };
      $('go').addEventListener('click', go); $('awbOne').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    });
}
/* A part ready to ship goes by courier (FBA parts went by MCF when they were routed). */
const shipPart = (o, n) => shipDlg(o, { part: n });

/* ============================== SHIPPING IN 2–3 CLICKS ==============================
 * One order: Ship → (DHL CSB file is already chosen) → type the weight → Make the file. It downloads; the same window
 * then asks for the carrier's tracking number. Many orders: tick them → Ship selected → weights → Make files → numbers.
 * Both build the same draft the Dispatch page uses (lib/csb.js does the checking and the files). */
const memOf = sku => (S.customs || {})[sku] || {};
/** What of this order can go in a box today, and what cannot (with why) — the same rules as the hub (csb.lineState). */
function readyOf(o, only) {
  const ok = [], not = [];
  o.items.forEach((it, i) => {
    const pk = it.pk == null ? null : o.pkgs[it.pk];
    if (pk && isMcf(pk)) return;
    let why = '';
    if (!pk) {
      /* Not decided yet: it goes in a box only when India's stock, after older orders, covers it and FBA does not. */
      const a = allocOf(o)[i] || {};
      if (a.takes === 'skip') return;
      why = a.takes === 'india' ? '' : it.oos ? 'marked out of stock' : a.takes === 'mcf' ? 'goes by MCF' : a.indiaHeld ? 'India stock held by older orders' : 'not in stock';
    }
    else if (pk.booked && !pk.route) why = `waiting for its ${pk.booked.car} tracking number`;
    else if (phaseOf(pk) === 0) why = pk.block ? `on hold: ${pk.block.why}` : `in production (${pk.pos === 0 ? 'not started' : STAGES[pk.pos]})`;
    else if (off(pk) > 0 || pk.src === 'fba') return;
    if (why) not.push({ i, why }); else if (!only || only.includes(i)) ok.push(i);
  });
  return { ok, not };
}
const shipOf = (o, items, car, box, extra) => Object.assign({ no: o.no, car, pack: '', phone: '', contents: '', inv: '', invDate: '',
  boxes: [{ kg: box.kg, l: box.l, w: box.w, h: box.h }],
  lines: items.map(i => { const it = o.items[i], m = memOf(it.sku), c = (extra && extra.customs && extra.customs[i]) || {};
    return { i, on: true, desc: c.desc || m.desc || [it.t, it.v].filter(Boolean).join(' '), hs: c.hs || m.hs || S.hsDefault, rate: c.rate != null ? c.rate : it.price, box: 0 }; }) },
  extra && extra.phone ? { phone: extra.phone } : {});
/** Check, then make the files for these shipments and download them. Returns the batch, or throws with what to fix. */
async function makeFiles(ships, firstInv) {
  if (firstInv && firstInv !== S.nextInv) { const d = await call('/api/csb/next', { nextInv: firstInv }); S.nextInv = d.nextInv; }
  const draft = { cur: CD.cur || 'USD', tax: CD.tax || 'Against Bond or Undertaking', ships, nextInv: S.nextInv };
  const chk = await call('/api/csb/check', { draft });
  const bad = chk.report.filter(r => r.bad.length);
  if (bad.length) { const e = new Error('Fix first: ' + bad.map(r => `#${r.no}: ${r.bad.join('; ')}`).join(' · ')); e.report = chk.report; throw e; }
  const cars = new Set(ships.map(s => s.car));
  if (cars.has('DHL Express')) await fillWorkbook('dhl', [{ head: chk.head, rows: [] }]);            // templates still match, before anything is booked
  if (cars.has('FedEx')) await fillWorkbook('fedex', fedexSheets(Object.assign({}, chk.fx, { rows: [], mps: [] })));
  const d = await call('/api/csb/make', { draft });
  const names = await csbDeliver(d.batch.id, d);
  CSB = null; S.nextInv = d.nextInv;
  return { batch: d.batch, names };
}
const sendAwb = (id, no, trk) => call('/api/csb/awb', { id, no, trk });

function shipDlg(o, opt) {
  const fx = S.settings.fedexShip || {};
  const r = readyOf(o, opt.lines || (opt.part != null ? o.pkgs[opt.part].items : null));
  const items = r.ok;
  if (!items.length) return toast('Nothing on this order is ready to ship yet.', true);
  const WAYS = [['dhl', 'DHL', 'CSB file to upload'], ['fxfile', 'FedEx', 'upload file']].concat(fx.on ? [['fxapi', 'FedEx', 'label made here (API)']] : []).concat([['trk', 'Tracking no.', 'already shipped']]);
  const F = { way: 'dhl', kg: '', l: 30, w: 25, h: 8, inv: '', open: false, phone: '', customs: {}, err: '', done: null };
  const a = o.addr || {}, needPhone = !(a.phone || o.cust.ph);
  const val = (k, v) => `value="${esc(v)}" data-sf="${k}"`;
  const body = () => F.done ? `<div class="sh-done"><b>✓ ${esc(F.done.names.join(' + '))}</b> downloaded <span class="s-muted s-sm">· ${esc(F.done.batch.id)}</span></div>
      <div class="sh-step"><span class="sh-n">2</span> Upload it on the ${F.way === 'dhl' ? 'DHL' : 'FedEx'} site.</div>
      <div class="sh-step"><span class="sh-n">3</span> Type the tracking number they give you:</div>
      <div class="sh-row"><input id="shTrk" placeholder="${F.way === 'dhl' ? 'e.g. 4417802211' : 'e.g. 794896720962'}" aria-label="Tracking number"><button class="s-btn" type="button" id="shTrkGo">Save &amp; ship</button></div>
      <span class="s-muted s-sm">No number yet? Close this — the order waits on Dispatch and on the order itself until you add it.</span>`
    : `<div class="sh-items">${items.map(i => `<span class="sh-it">${sw(o.items[i])}${esc(o.items[i].t)} × ${o.items[i].q}</span>`).join('')}
        ${r.not.length ? `<span class="sh-not">Not ready, stays for later: ${r.not.map(n => `${esc(o.items[n.i].t)} (${esc(n.why)})`).join(', ')}</span>` : ''}</div>
      <div class="sh-ways">${WAYS.map(w => `<button class="sh-way ${F.way === w[0] ? 'on' : ''}" type="button" data-way="${w[0]}"><b>${w[1]}</b><span>${w[2]}</span></button>`).join('')}</div>
      ${F.way === 'dhl' || F.way === 'fxfile' ? `<div class="sh-row sh-box"><label>Weight<span class="sh-u"><input class="sh-kg" type="number" min="0" step="0.01" ${val('kg', F.kg)} placeholder="kg" aria-label="Weight in kg"> kg</span></label>
          <label>Box<span class="sh-u"><input class="c-n" type="number" min="1" ${val('l', F.l)} aria-label="Length cm"> × <input class="c-n" type="number" min="1" ${val('w', F.w)} aria-label="Width cm"> × <input class="c-n" type="number" min="1" ${val('h', F.h)} aria-label="Height cm"> cm</span></label>
          ${o.source === 'test' ? `<span class="s-muted s-sm sh-inv">Test order — invoice TEST-${esc(o.no)} (real series not used)</span>` : S.nextInv ? `<span class="s-muted s-sm sh-inv">GST invoice ${esc(S.nextInv)} (next)</span>` : `<label>First GST invoice no<input ${val('inv', F.inv)} placeholder="e.g. 262721950"></label>`}
          ${needPhone ? `<label>Customer phone<input ${val('phone', F.phone)} placeholder="the carrier needs it"></label>` : ''}</div>
        <details class="sh-more" ${F.open ? 'open' : ''}><summary>Customs details — filled in from last time</summary>
          ${items.map(i => { const it = o.items[i], m = memOf(it.sku), c = F.customs[i] || {}; return `<div class="fx-box"><label class="fx-d">${esc(it.t)}<input value="${esc(c.desc != null ? c.desc : m.desc || [it.t, it.v].filter(Boolean).join(' '))}" data-cu="${i}|desc"></label>
            <label>HS code<input class="c-hs" maxlength="8" value="${esc(c.hs || m.hs || S.hsDefault)}" data-cu="${i}|hs"></label><label>Value USD<input class="c-n" type="number" step="0.01" value="${esc(c.rate != null ? c.rate : it.price)}" data-cu="${i}|rate"></label></div>`; }).join('')}</details>`
      : `<span class="s-muted s-sm">${F.way === 'fxapi' ? 'FedEx makes the label and the tracking number here (sandbox while testing).' : 'For a parcel already booked anywhere: pick the carrier and type its number.'}</span>`}
      ${F.err ? `<div class="c-bad">${esc(F.err)}</div>` : ''}`;
  const foot = () => F.done ? '' : F.way === 'dhl' || F.way === 'fxfile' ? `<button class="s-btn" type="button" id="go">Make ${F.way === 'dhl' ? 'DHL CSB' : 'FedEx'} file</button>` : '<button class="s-btn" type="button" id="go">Next</button>';
  const draw = () => dialog(F.done ? `Ship · #${o.no} · file made` : `Ship · #${o.no} · ${o.cust.n} · ${[a.city, a.state, a.country].filter(Boolean).join(', ')}`, body(), foot(), () => {
    document.querySelectorAll('#dlg [data-way]').forEach(b => b.addEventListener('click', () => { F.way = b.dataset.way; F.err = ''; draw(); }));
    document.querySelectorAll('#dlg [data-sf]').forEach(el => el.addEventListener('input', () => { F[el.dataset.sf] = el.value; }));
    document.querySelectorAll('#dlg [data-cu]').forEach(el => el.addEventListener('input', () => { const [i, k] = el.dataset.cu.split('|'); (F.customs[i] = F.customs[i] || {})[k] = el.value; F.open = true; }));
    if ($('go')) $('go').addEventListener('click', async () => {
      if (F.way === 'fxapi') return courierDlg(o, opt, { pick: 'FedEx', mode: 'create' });
      if (F.way === 'trk') return courierDlg(o, opt, { pick: 'DHL Express', mode: 'manual' });
      if (!(Number(F.kg) > 0)) { F.err = 'Weigh the box and type the weight (kg).'; return draw(); }
      try {
        F.done = await makeFiles([shipOf(o, items, F.way === 'dhl' ? 'DHL Express' : 'FedEx', F, { customs: F.customs, phone: F.phone })], F.inv.trim());
        F.err = ''; render(); draw();
      } catch (e) { F.err = e.message; draw(); }
    });
    if ($('shTrkGo')) {
      const go = async () => { const t = $('shTrk').value.trim(); if (!t) return toast('Type the tracking number', true);
        try { const d = await sendAwb(F.done.batch.id, o.no, t); close(); render(); toast(d.msg); } catch (e) { toast(e.message, true); } };
      $('shTrkGo').addEventListener('click', go); $('shTrk').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    }
    const k = $('dlg').querySelector('.sh-kg'); if (k && !F.kg) k.focus();
  }, F.done ? 'Close' : 'Cancel');
  draw();
}

/* BULK ORDER: everything that can go in a box today, across orders — made in production or in India stock — with every
 * order's not-ready items shown (and left for a later box). Untick an order or an item to leave it, choose DHL or
 * FedEx, type the weights, make all the files in one press, then type or paste the tracking numbers.
 * Opened from "Bulk order" (all ready orders) or from "Ship selected" (only the ticked ones). */
function readyOrders() { return vis().filter(o => readyOf(o).ok.length).sort((a, b) => a.at - b.at); }
function bulkShipDlg(list, title) {
  const R = list.map(o => { const r = readyOf(o); return { o, r, on: true, lines: r.ok.map(i => ({ i, on: true })), car: 'DHL Express', kg: '', l: 30, w: 25, h: 8, err: '', trk: '' }; }).filter(x => x.r.ok.length);
  const skipped = list.filter(o => !R.some(x => x.o === o));
  if (!R.length) return toast(title ? 'Nothing is ready to ship yet — lines show up here when production finishes them, or when India has the stock.' : 'Nothing on the ticked orders is ready to ship yet.', true);
  let done = null, err = '', inv = '';
  const going = () => R.filter(x => x.on && x.lines.some(l => l.on));
  const n = c => going().filter(x => x.car === c).length;
  const items = () => going().reduce((s, x) => s + x.lines.filter(l => l.on).length, 0);
  const allTest = R.every(x => x.o.source === 'test');
  const draw = () => dialog(done ? `Files made · ${done.batch.id}` : `${title || 'Ship selected'} · ${going().length} of ${R.length} order${R.length > 1 ? 's' : ''} · ${items()} item${items() === 1 ? '' : 's'}`, done
    ? `<div class="sh-done"><b>✓ ${esc(done.names.join(' + '))}</b> downloaded. Upload ${done.names.length > 1 ? 'them' : 'it'}, then type each tracking number (or paste them all below).</div>
      <table class="s-tbl s-mini"><thead><tr><th class="tl">Order</th><th>Carrier</th><th class="tl">Tracking number</th></tr></thead><tbody>${R.map((x, k) => !x.sent ? '' : `<tr><td class="tl"><b>#${esc(x.o.no)}</b>${sub(esc(x.o.cust.n))}</td><td>${x.car === 'FedEx' ? 'FedEx' : 'DHL'}</td>
        <td class="tl">${x.trk ? `<span class="s-trk">${esc(x.trk)}</span> ✓` : `<input class="c-awb" data-bt="${k}" placeholder="tracking no.">`}</td></tr>`).join('')}</tbody></table>
      <label class="s-sm">Or paste — one per line: order number, then tracking number<textarea id="bPaste" rows="3"></textarea></label>`
    : `<div class="sh-bar"><label class="s-check"><input type="checkbox" id="bAll" ${R.every(x => x.on) ? 'checked' : ''}> All orders</label>
        <span class="s-muted s-sm">Carrier for all:</span><button class="s-btn ghost" type="button" data-ball="DHL Express">DHL</button><button class="s-btn ghost" type="button" data-ball="FedEx">FedEx</button>
        <span class="s-muted s-sm sh-r">${allTest ? 'Test orders — real invoice series not used' : S.nextInv ? 'GST invoices from ' + esc(S.nextInv) : ''}</span></div>
      <table class="s-tbl s-mini sh-bulk"><thead><tr><th class="s-ck"></th><th class="tl">Order · tick what goes in the box</th><th>Carrier</th><th>Weight kg</th><th>Box cm</th></tr></thead><tbody>${R.map((x, k) => `<tr class="${x.on ? '' : 'c-off'}">
        <td class="s-ck"><input type="checkbox" data-bon="${k}" ${x.on ? 'checked' : ''} aria-label="Ship #${esc(x.o.no)}"></td>
        <td class="tl"><b>#${esc(x.o.no)}</b> ${esc(x.o.cust.n)} <span class="s-faint s-sm">· ${esc(x.o.store)} · ${day(x.o.at)}</span>
          <div class="sh-lines">${x.lines.map((l, j) => `<label class="sh-li"><input type="checkbox" data-bl="${k}|${j}" ${l.on ? 'checked' : ''} ${x.on ? '' : 'disabled'}>${esc(x.o.items[l.i].t)} × ${x.o.items[l.i].q}</label>`).join('')}
            ${x.r.not.map(nr => `<span class="sh-li no" title="Stays on the order for a later box">${esc(x.o.items[nr.i].t)} — not ready: ${esc(nr.why)}</span>`).join('')}</div>
          ${x.err ? `<div class="c-bad s-sm">${esc(x.err)}</div>` : ''}</td>
        <td><div class="seg">${['DHL Express', 'FedEx'].map(c => `<button class="segbtn ${x.car === c ? 'on' : ''}" type="button" data-bc="${k}|${c}">${c === 'FedEx' ? 'FedEx' : 'DHL'}</button>`).join('')}</div></td>
        <td><input class="sh-kg" type="number" min="0" step="0.01" value="${esc(x.kg)}" data-bk="${k}|kg" placeholder="kg" ${x.on ? '' : 'disabled'}></td>
        <td class="s-nowrap"><input class="c-n sh-dim" type="number" value="${esc(x.l)}" data-bk="${k}|l">×<input class="c-n sh-dim" type="number" value="${esc(x.w)}" data-bk="${k}|w">×<input class="c-n sh-dim" type="number" value="${esc(x.h)}" data-bk="${k}|h"></td></tr>`).join('')}</tbody></table>
      ${skipped.length ? `<span class="s-muted s-sm">Nothing ready on: ${skipped.map(o => '#' + esc(o.no)).join(', ')} — left out.</span>` : ''}
      ${!allTest && !S.nextInv ? `<label class="s-sm">First GST invoice no<input id="bInv" value="${esc(inv)}" placeholder="e.g. 262721950"></label>` : ''}
      ${err ? `<div class="c-bad">${esc(err)}</div>` : ''}`,
    done ? (R.every(x => !x.sent || x.trk) ? '' : '<button class="s-btn" type="button" id="go">Save tracking numbers</button>')
      : `<button class="s-btn" type="button" id="go" ${going().length ? '' : 'disabled'}>Make files · ${n('DHL Express')} DHL${n('FedEx') ? ' · ' + n('FedEx') + ' FedEx' : ''}</button>`, () => {
      document.querySelectorAll('#dlg [data-bc]').forEach(b => b.addEventListener('click', () => { const [k, c] = b.dataset.bc.split('|'); R[+k].car = c; draw(); }));
      document.querySelectorAll('#dlg [data-ball]').forEach(b => b.addEventListener('click', () => { R.forEach(x => { x.car = b.dataset.ball; }); draw(); }));
      document.querySelectorAll('#dlg [data-bon]').forEach(c => c.addEventListener('change', () => { R[+c.dataset.bon].on = c.checked; draw(); }));
      document.querySelectorAll('#dlg [data-bl]').forEach(c => c.addEventListener('change', () => { const [k, j] = c.dataset.bl.split('|'); R[+k].lines[+j].on = c.checked; draw(); }));
      if ($('bAll')) $('bAll').addEventListener('change', e => { R.forEach(x => { x.on = e.target.checked; }); draw(); });
      document.querySelectorAll('#dlg [data-bk]').forEach(el => el.addEventListener('input', () => { const [k, f] = el.dataset.bk.split('|'); R[+k][f] = el.value; }));
      if ($('bInv')) $('bInv').addEventListener('input', e => { inv = e.target.value; });
      if (!$('go')) return;
      $('go').addEventListener('click', async () => {
        if (!done) {
          const G = going();
          R.forEach(x => { x.err = ''; }); G.forEach(x => { x.err = Number(x.kg) > 0 ? '' : 'Type the weight'; });
          if (G.some(x => x.err)) return draw();
          try { done = await makeFiles(G.map(x => shipOf(x.o, x.lines.filter(l => l.on).map(l => l.i), x.car, x)), inv.trim()); G.forEach(x => { x.sent = true; }); err = ''; render(); }
          catch (e) { err = e.message; (e.report || []).forEach(rp => { const x = R.find(y => y.o.no === rp.no); if (x) x.err = rp.bad.join('; '); }); }
          return draw();
        }
        const typed = R.map((x, k) => { const el = document.querySelector(`[data-bt="${k}"]`); return el && el.value.trim() ? [x, el.value.trim()] : null; }).filter(Boolean);
        const paste = $('bPaste').value.trim();
        try {
          for (const [x, t] of typed) { await sendAwb(done.batch.id, x.o.no, t); x.trk = t; }
          if (paste) { const d = await call('/api/csb/awb', { text: paste }); toast(d.msg); }
          const s = await call('/api/state'); R.forEach(x => { if (!x.sent) return; const pk = s.orders.find(o => o.no === x.o.no).pkgs.find(p => p.booked && p.booked.id === done.batch.id && p.trk.length); if (pk) x.trk = pk.trk[0]; });
          render(); draw(); if (typed.length) toast(`${typed.length} order(s) shipped`);
        } catch (e) { toast(e.message, true); }
      });
    }, done ? 'Close' : 'Cancel');
  draw();
}

/* ---------------- what is done to ticked orders ---------------- */
function pickSheets(list) {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print the pick sheets', true);
  const rows = list.map(o => `<section><h2>#${esc(o.no)} <small>${esc(o.store)} · ${isoDay(o.at)}</small></h2>
    <p><b>${esc(o.cust.n)}</b> · ${esc(addrText(o))}${o.cust.ph ? ' · ' + esc(o.cust.ph) : ''}</p>${o.note ? `<p class="n">Customer note: ${esc(o.note)}</p>` : ''}
    <table><tr><th>✓</th><th>SKU</th><th>Item</th><th>Qty</th><th>From</th></tr>${o.items.map(it => { const pk = it.pk != null ? o.pkgs[it.pk] : null;
      return `<tr><td>☐</td><td>${esc(it.sku)}</td><td>${esc(it.t)}${it.v ? ' · ' + esc(it.v) : ''}</td><td>${it.q}</td><td>${pk ? (isMcf(pk) ? 'Amazon MCF — do not pack' : srcName(pk)) : 'not routed'}</td></tr>`; }).join('')}</table>
    <p class="w">Weight ______ kg &nbsp; Box ____ × ____ × ____ cm &nbsp; Packed by __________</p></section>`).join('');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Pick sheets · ${list.length} orders</title><style>body{font:13px system-ui,sans-serif;margin:24px;color:#111}section{page-break-after:always;margin-bottom:24px}h2{margin:0 0 4px;font-size:18px}h2 small{font-weight:400;color:#555;font-size:12px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #999;padding:6px 8px;text-align:left}th{background:#eee}.n{color:#8a5a12}.w{margin-top:14px}</style>${rows}<script>window.print()<\/script>`);
  w.document.close();
}
function bulkFedex(list) {
  const R = [];
  list.forEach(o => o.pkgs.forEach((pk, n) => { if (actionOf(pk) && actionOf(pk).k === 'ship' && pk.src !== 'fba') R.push({ o, n, pk, kg: '', l: 30, w: 25, h: 8, res: null }); }));
  if (!R.length) return toast('None of the ticked orders has a part ready to ship from India. Route the lines first (India or Make).', true);
  const SV = [['FEDEX_INTERNATIONAL_PRIORITY', 'International Priority'], ['INTERNATIONAL_ECONOMY', 'International Economy'], ['FEDEX_INTERNATIONAL_CONNECT_PLUS', 'International Connect Plus'], ['FEDEX_INTERNATIONAL_PRIORITY_EXPRESS', 'International Priority Express']];
  let service = SV[0][0], busy = false;
  const draw = () => dialog(`Create FedEx labels · ${R.length} part${R.length > 1 ? 's' : ''}`, `<div class="s-muted s-sm">Customs descriptions, HS codes and values come from what each SKU last shipped with (or the Shopify title and price). ${S.settings.fedexShip.sandbox ? '<b>SANDBOX</b>: test labels, no charge.' : '<b class="s-bad">REAL shipments on your FedEx account.</b>'}</div>
    <div><label for="bsv">Service for all</label><select id="bsv">${SV.map(s => `<option value="${s[0]}" ${s[0] === service ? 'selected' : ''}>${s[1]}</option>`).join('')}</select></div>
    <table class="s-tbl s-mini"><thead><tr><th class="tl">Order · items</th><th>kg</th><th>L</th><th>W</th><th>H</th><th class="tl">Result</th></tr></thead><tbody>${R.map((x, k) => `<tr><td class="tl"><b>#${esc(x.o.no)}</b>${sub(esc(itemsText(x.o, x.pk)))}</td>
      ${['kg', 'l', 'w', 'h'].map(f => `<td><input class="c-n" type="number" min="0" step="${f === 'kg' ? '0.01' : '1'}" value="${esc(x[f])}" data-bx="${k}|${f}" ${x.res && x.res.ok ? 'disabled' : ''}></td>`).join('')}
      <td class="tl s-sm">${!x.res ? '<span class="s-faint">—</span>' : x.res.ok ? `<span class="s-trk">${esc(x.res.trk)}</span> ${x.res.label ? `<a class="s-link" href="/${esc(x.res.label)}" target="_blank" rel="noopener">Label</a>` : ''}` : `<span class="s-bad">${esc(x.res.err)}</span>`}</td></tr>`).join('')}</tbody></table>`,
    R.every(x => x.res && x.res.ok) ? '' : `<button class="s-btn" type="button" id="go" ${busy ? 'disabled' : ''}>${busy ? 'Creating…' : 'Create labels'}</button>`, () => {
      $('bsv').addEventListener('change', e => { service = e.target.value; });
      document.querySelectorAll('[data-bx]').forEach(el => el.addEventListener('input', () => { const [k, f] = el.dataset.bx.split('|'); R[+k][f] = el.value; }));
      if ($('go')) $('go').addEventListener('click', async () => {
        busy = true; draw();
        for (const x of R) {
          if (x.res && x.res.ok) continue;
          try {
            await call('/api/action', { type: 'fedexShip', no: x.o.no, part: x.n, box: { kg: x.kg, l: x.l, w: x.w, h: x.h }, service, notify: true });
            const pk = S.orders.find(y => y.no === x.o.no).pkgs[x.n];
            x.res = { ok: true, trk: pk.fedex.trk, label: pk.fedex.label };
          } catch (e) { x.res = { ok: false, err: e.message }; }
          draw();
        }
        busy = false; draw(); render();
        const done = R.filter(x => x.res && x.res.ok).length;
        toast(`${done} of ${R.length} FedEx label${R.length > 1 ? 's' : ''} created${done < R.length ? ' — fix the red ones and press again' : ''}`, done < R.length);
      });
    }, 'Close');
  draw();
}
async function bulkCsb(list) {
  if (!CSB) await loadCsb();
  let n = 0; list.forEach(o => { if (csbAdd(o.no)) n++; });
  location.hash = 'csb';
  toast(n ? `${n} order(s) added to Dispatch — choose DHL or FedEx, weigh each box` : 'Nothing ready to ship in those orders yet', !n);
}

/* ============================== PRESENT MODE ==============================
 * The whole flow, played on the real screens with a demo order (#D1001, a TEST order: nothing reaches Shopify, no real
 * invoice number is used). Each step does what a person would — clicks, types — then shows a caption, and reads it
 * aloud if the voice is on. Play runs it by itself (record it with Win + Alt + R for a video); Next / Back step by hand. */
let TI = -1, TPLAY = false, TVOICE = store('hub.voice') === '1', TTIMER = null, TBUSY = false, TSPOT = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DEMO = 'D1001';
const el = s => document.querySelector(s);
async function typeInto(sel, text) {
  const e = el(sel); if (!e) return;
  e.focus(); e.value = '';
  const s = String(text);
  for (let n = 1; n <= s.length; n++) {
    const p = s.slice(0, n);
    if (e.type === 'number' && /\.$/.test(p)) continue;                   // a number box would drop "2." while typing 2.6
    e.value = p; e.dispatchEvent(new Event('input', { bubbles: true })); await sleep(70);
  }
}
async function clickOn(sel) { const e = el(sel); if (!e) throw new Error('Present: could not find ' + sel); e.click(); await sleep(500); }
const partOf = test => { const o = S.orders.find(x => x.no === DEMO); return o ? o.pkgs.findIndex(test) : -1; };
const makePart = () => partOf(p => p.src === 'make'), indiaPart = () => partOf(p => p.src === 'india');
async function stages(n) { for (let k = 0; k < n; k++) { await act('stage', { no: DEMO, part: makePart() }); await sleep(1100); } }
async function walk(part, to) { for (let x = 3; x <= to; x++) { await act('markStep', { no: DEMO, part, to: x }); await sleep(1300); } }

const TOUR = [
  { k: 'The Shopify section', go: 'orders', spot: '.s-head',
    say: 'This is the Shopify section of our ERP. Every Shopify order is handled here: which way each item goes, production, shipping and tracking. Shopify itself is only used to look at, because everything we do here updates Shopify by itself.' },
  { k: 'Orders', go: 'orders', spot: '#pipe',
    say: 'The blue band shows today\'s and yesterday\'s sales. These filters sort every order by where it is: needs routing, in production, ready to ship, in transit, on hold or delayed, and delivered.' },
  { k: 'A new order', go: 'orders', spot: `[data-row="${DEMO}"]`,
    run: async () => { FILTER = ''; Q = ''; $('q').value = ''; await post('/api/demo/start'); await sleep(300); },
    say: 'A new Shopify order has just come in: D1001, from Sarah in Austin. A kantha quilt, a cushion cover set and a block print throw. Its row tells us what to do next: route the lines.' },
  { k: 'The order', go: 'order/' + DEMO, spot: '#lines',
    say: 'Opening the order. Like Shopify, the items are grouped in cards by how they leave: Amazon MCF when FBA has it, ship from India when India has it, and production when nobody has it. The app sorts them by the stock; we can move any item, and nothing happens until we accept.' },
  { k: 'Half now, half in production', go: 'order/' + DEMO, spot: '#lines',
    run: async () => { const c = CHOICE[DEMO] || (CHOICE[DEMO] = {}); c[0] = 'india'; c[1] = 'india'; c[2] = 'make'; render(); await sleep(500); },
    say: 'The quilt and the cushion covers ship now from India stock. The throw is not in stock anywhere, so it is in the production card.' },
  { k: 'Production', go: 'order/' + DEMO, spot: () => '#pk' + makePart(),
    run: async () => { await clickOn('[data-go="make"]'); await sleep(600); await clickOn('#go'); await sleep(400); },
    say: 'One click sends the throw to production. The factory gets the request, and the Shopify order is tagged: in production.' },
  { k: 'Stage by stage', go: 'order/' + DEMO, spot: () => '#pk' + makePart(),
    run: async () => { await stages(2); },
    say: 'The factory marks each stage as it is done: cut, print, press, quality check. Every stage shows how long it took against its target, so a delay is seen at once.' },
  { k: 'On hold, and why', go: 'order/' + DEMO, spot: () => '#pk' + makePart(),
    run: async () => { await act('block', { no: DEMO, part: makePart(), why: 'Waiting for fabric' }); },
    say: 'If something holds it up, it goes on hold with the reason. Here: waiting for fabric. It shows in red on the order, and the Orders page shows the main bottleneck across all orders.' },
  { k: 'Ship the ready half', go: 'order/' + DEMO, spot: '#dlg .s-dlg',
    run: async () => { await act('unblock', { no: DEMO, part: makePart() }); await sleep(400); await clickOn('[data-go="india"]'); await sleep(600); await clickOn(`[data-do="ship"][data-pk="${indiaPart()}"]`); await sleep(500); await typeInto('#dlg .sh-kg', '2.6'); },
    say: 'Now the half that is ready. Add to Bulk order picks it, and Ship opens one simple window: what goes in the box, DHL already chosen, and the weight of the box. We have no DHL API, and we do not need one.' },
  { k: 'The DHL CSB file', go: null, spot: '#dlg .s-dlg',
    run: async () => { await clickOn('#go'); for (let k = 0; k < 20 && !el('#shTrk'); k++) await sleep(300); },
    say: 'One click makes DHL\'s own CSB-V file, already filled in: the customer, the invoice, the HS codes and the weight. It downloads, and we upload it on the DHL website exactly as it is.' },
  { k: 'The tracking number', go: null, spot: '#shTrk',
    run: async () => { await typeInto('#shTrk', '4417812345'); },
    say: 'After the upload, DHL gives us the tracking number. We type it in here.' },
  { k: 'Shipped — Shopify told', go: 'order/' + DEMO, spot: () => '#pk' + indiaPart(),
    run: async () => { await clickOn('#shTrkGo'); await sleep(800); },
    say: 'Saved, and the parcel is shipped. Shopify gets the tracking number, marks those two items fulfilled and emails the customer. From now on Shopify follows the DHL parcel by itself, and the hub reads it every thirty minutes.' },
  { k: 'Tracking', go: 'order/' + DEMO, spot: () => '#pk' + indiaPart(),
    run: async () => { await walk(indiaPart(), 6); },
    say: 'Here is the tracking, sped up: picked up by DHL, in transit, out for delivery, delivered. Every step with its place and time. On the Orders list, the row lights up when news comes in.' },
  { k: 'Production finished', go: 'order/' + DEMO, spot: () => '#pk' + makePart(),
    run: async () => { await stages(3); },
    say: 'Meanwhile the factory finishes the throw: press, then quality check. It is ready to ship.' },
  { k: 'Many orders at once', go: 'orders', spot: '#dlg .s-dlg',
    run: async () => { const c = el(`[data-sel="${DEMO}"]`); c.checked = true; c.dispatchEvent(new Event('change')); await sleep(500); await clickOn('[data-bulk="ship"]'); await sleep(400); await clickOn('[data-bc="0|FedEx"]'); await typeInto('[data-bk="0|kg"]', '0.9'); },
    say: 'Many orders can ship together. Tick them on Orders and press Ship selected: one row per order, DHL or FedEx, and the weight. This time the throw goes by FedEx.' },
  { k: 'FedEx file, then numbers', go: null, spot: '#dlg .s-dlg',
    run: async () => { await clickOn('#go'); for (let k = 0; k < 20 && !el('[data-bt="0"]'); k++) await sleep(300); await typeInto('[data-bt="0"]', '794812345678'); await sleep(300); await clickOn('#go'); await sleep(900); },
    say: 'Make files downloads FedEx\'s own upload file. After uploading it, we type or paste the tracking numbers, and every one of those orders is shipped.' },
  { k: 'Whole order, two parcels', go: 'order/' + DEMO, spot: '#omodal .s-obody',
    run: async () => { close(); SEL.clear(); await act('markStep', { no: DEMO, part: makePart(), to: 4 }); },
    say: 'The order is fully shipped in two parcels: one by DHL, one by FedEx. Each has its own tracking, both are on one order, and all of it is already in Shopify.' },
  { k: 'Dispatch', go: 'csb', spot: '#page',
    say: 'Dispatch shows every file made, what is still waiting for a tracking number, and lets us download a file again, or take it back if it was not uploaded.' },
  { k: 'Returns', go: 'returns', spot: '#rlist',
    say: 'Returns and replacements are handled from the order too, each with its own tracking.' },
  { k: 'Safe to test', go: 'setup', spot: '#page',
    say: 'Setup shows every connection. While we test, sending to Shopify stays off, and a read only check shows exactly what Shopify would receive before we switch it on.' },
  { k: 'That is the flow', go: 'orders', spot: '.s-head',
    say: 'That is the whole flow. An order comes in, we choose how each item goes, production is tracked stage by stage, DHL and FedEx files are made without any API, and every parcel is tracked to delivery, with Shopify updated by itself.' },
];
const voices = () => (window.speechSynthesis ? speechSynthesis.getVoices() : []);
/* Letters the voice should spell rather than read as a word. */
const SPELL = [[/\bDHL\b/g, 'D H L'], [/\bAPI\b/g, 'A P I'], [/\bMCF\b/g, 'M C F'], [/\bCSB-V\b/g, 'C S B 5'], [/\bHS\b/g, 'H S'], [/\bD1001\b/g, 'D 1001'], [/\bFBA\b/g, 'F B A']];
function speak(text, done) {
  if (!TVOICE || !window.speechSynthesis) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(SPELL.reduce((t, [re, w]) => t.replace(re, w), text)), v = voices();
  u.voice = v.find(x => /en-IN/i.test(x.lang)) || v.find(x => /en-GB/i.test(x.lang)) || v.find(x => /^en/i.test(x.lang)) || null;
  u.rate = 0.98; u.onend = done; speechSynthesis.speak(u);
  return true;
}
function applySpot(scroll) {
  document.querySelectorAll('.s-spot').forEach(e => e.classList.remove('s-spot'));
  if (TI < 0 || !TSPOT) return;
  const e = el(TSPOT); if (!e) return;
  e.classList.add('s-spot');
  if (scroll !== false) e.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function tourPanel() {
  const host = $('tourHost'); if (TI < 0) { host.innerHTML = ''; return; }
  const t = TOUR[TI];
  host.innerHTML = `<div class="s-tour" role="dialog" aria-label="Presentation"><div class="k">${TI + 1} / ${TOUR.length} · ${esc(t.k)}${TBUSY ? ' · <i>doing it…</i>' : ''}</div>
    <p>${esc(t.say)}</p>
    <div class="nv"><div class="dots">${TOUR.map((x, i) => `<i class="${i <= TI ? 'on' : ''}"></i>`).join('')}</div>
      <button type="button" id="tVoice" title="Read the captions aloud">${TVOICE ? '🔊 Voice on' : '🔈 Voice off'}</button>
      <button type="button" id="tBack" ${TI === 0 || TBUSY ? 'disabled' : ''}>Back</button>
      <button class="go" type="button" id="tPlay">${TPLAY ? '❚❚ Pause' : '▶ Play'}</button>
      <button type="button" id="tNext" ${TBUSY ? 'disabled' : ''}>${TI === TOUR.length - 1 ? 'Finish' : 'Next'}</button>
      <button class="x" type="button" id="tClose" aria-label="Stop presenting">Close</button></div></div>`;
  $('tVoice').onclick = () => { TVOICE = !TVOICE; store('hub.voice', TVOICE ? '1' : '0'); if (!TVOICE && window.speechSynthesis) speechSynthesis.cancel(); tourPanel(); };
  $('tBack').onclick = () => tourGo(TI - 1, true);
  $('tNext').onclick = () => { TPLAY = false; TI === TOUR.length - 1 ? tourEnd() : tourGo(TI + 1); };
  $('tPlay').onclick = () => { TPLAY = !TPLAY; if (TPLAY && !TBUSY) next(); tourPanel(); };
  $('tClose').onclick = tourEnd;
}
function next() { clearTimeout(TTIMER); if (TI < TOUR.length - 1) tourGo(TI + 1); else { TPLAY = false; tourPanel(); } }
/* Step `i`: go to its page, do what it does (unless only stepping back), then show and say it. */
async function tourGo(i, back) {
  if (i < 0 || i >= TOUR.length) return;
  clearTimeout(TTIMER); if (window.speechSynthesis) speechSynthesis.cancel();
  TI = i; const t = TOUR[i];
  TBUSY = !back && !!t.run; TSPOT = ''; tourPanel(); applySpot();
  if (t.go && location.hash !== '#' + t.go) { if (!$('dlg').innerHTML || /^order|^orders/.test(t.go)) location.hash = t.go; await sleep(500); }
  if (!back && t.run) { try { await t.run(); } catch (e) { toast(e.message, true); } }
  TSPOT = typeof t.spot === 'function' ? t.spot() : t.spot;
  TBUSY = false; tourPanel(); applySpot();
  const wait = () => { if (TPLAY && TI === i) TTIMER = setTimeout(next, 1400); };
  if (!speak(t.say, wait) && TPLAY) TTIMER = setTimeout(next, Math.max(6000, t.say.split(/\s+/).length * 380));
}
function tourEnd() { TPLAY = false; clearTimeout(TTIMER); if (window.speechSynthesis) speechSynthesis.cancel(); TI = -1; TSPOT = ''; applySpot(); tourPanel(); close(); }
$('present').addEventListener('click', () => { TPLAY = false; tourGo(0); });
document.addEventListener('keydown', e => {
  if (TI < 0 || TBUSY || (e.target.closest && e.target.closest('input,select,textarea'))) return;
  if (e.key === 'ArrowRight') { TPLAY = false; next(); }
  if (e.key === 'ArrowLeft' && TI > 0) tourGo(TI - 1, true);
});

/* ============================== ROUTER ============================== */
/* #orders · #order/<no> · #returns · #stock · #csb · #setup
 * Old links still land: #track/<no> opens the order, #production and #shipments open Orders filtered. */
function render() {
  if (!S) return;
  const h = (location.hash || '#orders').slice(1), [r, a] = h.split('/').map(decodeURIComponent);
  if (r === 'track') return location.replace('#order/' + encodeURIComponent(a));
  if (r === 'production' || r === 'shipments') { FILTER = r === 'production' ? 'make' : 'carrier'; return location.replace('#orders'); }
  let html, tab = r;
  if (r === 'order') { html = pageOrders() + pageOrder(a); tab = 'orders'; }   // as live: the order opens over the list
  else if (r === 'returns') html = pageReturns();
  else if (r === 'stock') html = pageStock();
  else if (r === 'csb') html = pageCsb();
  else if (r === 'setup') html = pageSetup();
  else { html = pageOrders(); tab = 'orders'; }
  const page = $('page'); page.innerHTML = html; shell(tab);

  const on = (sel, fn) => page.querySelectorAll(sel).forEach(el => el.addEventListener('click', e => fn(el, e)));
  const find = no => S.orders.find(x => x.no === no);
  const openOnEnter = el => el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) el.click(); });
  if (r === 'csb' && CSB) wireCsb(page);

  on('[data-f]', b => { FILTER = FILTER === b.dataset.f ? '' : b.dataset.f; render(); });
  on('[data-showall]', () => { FILTER = ''; Q = ''; $('q').value = ''; render(); });
  on('[data-rf]', b => { RFILTER = b.dataset.rf; render(); });
  on('[data-kf]', b => { KFILTER = b.dataset.kf; render(); });
  on('[data-make]', () => exportStock());
  const om = $('omodal'); if (om) om.addEventListener('click', e => { if (e.target === om) location.hash = 'orders'; });
  page.querySelectorAll('[data-row]').forEach(row => {
    row.addEventListener('click', e => { if (!e.target.closest('button,a,input,.s-ck')) location.hash = 'order/' + row.dataset.row; });
    openOnEnter(row);
  });
  page.querySelectorAll('[data-ropen]').forEach(row => {
    const [no, id] = row.dataset.ropen.split('|');
    row.addEventListener('click', e => {
      if (e.target.closest('button,a')) return;
      location.hash = 'order/' + no;
      setTimeout(() => { const el = $(id); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('s-fresh'); } }, 40);
    });
    openOnEnter(row);
  });
  /* the row's next-step button */
  on('[data-act]', (b, e) => {
    e.stopPropagation();
    const [k, no, ns] = b.dataset.act.split('|'), o = find(no), n = +ns;
    if (k === 'route') location.hash = 'order/' + no;
    else if (k === 'unhold') act('unblock', { no, part: n });
    else if (k === 'chase') chaseDlg(o, n);
    else if (k === 'awb') awbDlg(o, n);
    else if (k === 'ship') shipPart(o, n);
    else if (k === 'stage') act('stage', { no, part: n });
    else if (k === 'ret') { const rt = o.rets[n], ac = J.retAction(rt); if (ac.k === 'rtrk') retTrkDlg(o, n); else act('returnStep', { no, ret: n, kind: ac.k }); }
  });
  /* ticking orders, and what is done to the ticked ones */
  page.querySelectorAll('[data-sel]').forEach(c => c.addEventListener('change', () => { c.checked ? SEL.add(c.dataset.sel) : SEL.delete(c.dataset.sel); render(); }));
  page.querySelectorAll('[data-selall]').forEach(c => c.addEventListener('change', () => {
    page.querySelectorAll('[data-sel]').forEach(x => { c.checked ? SEL.add(x.dataset.sel) : SEL.delete(x.dataset.sel); }); render();
  }));
  on('[data-bulk]', b => {
    const k = b.dataset.bulk, list = [...SEL].map(find).filter(Boolean), many = `${list.length} order${list.length > 1 ? 's' : ''}`;
    if (k === 'clear') { SEL.clear(); render(); return; }
    if (k === 'check') return post('/api/track', { nos: list.map(o => o.no) });
    if (k === 'print') return pickSheets(list);
    if (k === 'ship') return bulkShipDlg(list);
    if (k === 'csb') return bulkCsb(list);
    if (k === 'fedex') return bulkFedex(list);
    if (k === 'note') dialog(`Add a note · ${many}`, `<div class="s-muted s-sm">${list.map(o => '#' + esc(o.no)).join(', ')}</div><div><label for="bnote">Note</label><input id="bnote" placeholder="e.g. Customer asked to hold until Monday"></div>`,
      `<button class="s-btn" type="button" id="go">Add note</button>`, () => $('go').addEventListener('click', () => {
        const v = $('bnote').value.trim(); if (!v) return toast('Type the note', true);
        act('bulkNote', { nos: list.map(o => o.no), text: v });
      }));
  });
  on('[data-rq]', (b, e) => {
    e.stopPropagation();
    const [no, n] = b.dataset.rq.split('|'), o = find(no), rt = o.rets[+n], ac = J.retAction(rt);
    if (ac.k === 'rtrk') retTrkDlg(o, +n); else act('returnStep', { no, ret: +n, kind: ac.k });
  });
  on('[data-h]', b => {
    const k = b.dataset.h;
    if (k === 'check') post('/api/check');
    if (k === 'simulate') post('/api/simulate');
    if (k === 'track') post('/api/track');
    if (k === 'queue') dialog('Send to Shopify now?', `<span>This sends every waiting <b>and held</b> change to Shopify — including ones made while sending was off. Sending is <b>${S.settings.writes ? 'ON' : 'off'}</b>${S.settings.writes ? '' : ', so nothing will actually go yet'}.</span>`,
      '<button class="s-btn" type="button" id="go">Send</button>', () => $('go').addEventListener('click', () => { close(); post('/api/queue/run'); }));
    if (k === 'discard') post('/api/queue/discard');
    if (k === 'preview') post('/api/queue/preview');
    if (k === 'import') fetchOrders();
    if (k === 'testorder') post('/api/shopify/test-order', { store: b.dataset.store });
    if (k === 'reset') dialog('Reset temp orders?', '<span>All TEST orders go back to how they started. Orders pulled from Shopify are kept.</span>', '<button class="s-btn" type="button" id="go">Reset</button>',
      () => $('go').addEventListener('click', () => { close(); Object.keys(CHOICE).forEach(x => delete CHOICE[x]); post('/api/reset'); }));
  });

  if (r === 'order') {
    const o = find(a);
    if (o) {
      on('[data-pick]', b => { const [i, k] = b.dataset.pick.split('|'), ch = CHOICE[o.no] || (CHOICE[o.no] = {}); ch[i] = k; render(); });
      on('[data-plan]', () => planDlg(o));
      on('[data-go]', b => {
        const k = b.dataset.go, P = planOf(o), lines = undecided(o).filter(i => P[i] === k);
        /* India items: picked now, and they wait in Bulk order for the next DHL / FedEx file. */
        if (k === 'mcf') mcfDlg(o, lines); else if (k === 'make') prodDlg(o, lines); else act('plan', { no: o.no, india: lines });
      });
      page.querySelectorAll('[data-move]').forEach(sel => sel.addEventListener('change', () => {
        const v = sel.value, i = +sel.dataset.move, it = o.items[i]; if (!v) return;
        if (v.startsWith('to:')) { (CHOICE[o.no] || (CHOICE[o.no] = {}))[i] = v.slice(3); return render(); }
        if (v.startsWith('oos:')) return act('lineSet', { no: o.no, i, oos: v === 'oos:1' });
        if (v === 'sq:0') return act('lineSet', { no: o.no, i, sq: 0 });
        sel.value = '';
        dialog(`Send quantity · ${it.t}`, `<label>How many of the ${it.q} ordered go out<input id="sqN" type="number" min="1" max="${it.q}" step="1" value="${J.sendQty(it)}"></label>
          <span class="s-sm s-muted">The rest stay on the order and are not sent. Stock and the carrier files use this number.</span>`,
          '<button class="s-btn" type="button" id="go">Save</button>', () => $('go').addEventListener('click', () => act('lineSet', { no: o.no, i, sq: +$('sqN').value })));
      }));
      on('[data-sendagain]', b => act('lineSet', { no: o.no, i: +b.dataset.sendagain, sq: o.items[+b.dataset.sendagain].q }));
      page.querySelectorAll('[data-automcf]').forEach(c => c.addEventListener('change', () => {
        const on = c.checked; c.checked = !on;
        dialog(on ? 'Turn on Auto-send to MCF?' : 'Turn off Auto-send?', on
          ? `<span>From now on, when a new order comes in, the items Amazon FBA has go to MCF by themselves (standard speed). Orders already here are not touched. ${S.settings.realMcf ? '<b class="s-bad">Real MCF is on: each one is a real Amazon order with its fee.</b>' : 'MCF is simulated here — no real Amazon order is placed.'}</span>`
          : '<span>New orders wait for you again before anything goes to MCF.</span>',
          `<button class="s-btn" type="button" id="go">${on ? 'Turn on' : 'Turn off'}</button>`, () => $('go').addEventListener('click', () => act('prefs', { autoMcf: on })));
      }));
      on('[data-do]', b => {
        const k = b.dataset.do, n = +b.dataset.pk, rn = +b.dataset.r;
        if (k === 'ship') shipPart(o, n);
        else if (k === 'stage') act('stage', { no: o.no, part: n });
        else if (k === 'block') blockDlg(o, n);
        else if (k === 'unblock') act('unblock', { no: o.no, part: n });
        else if (k === 'cmt') { const v = $('cmt').value.trim(); if (v) act('comment', { no: o.no, text: v }); }
        else if (k === 'ret') startRetDlg(o);
        else if (k === 'rtrk') retTrkDlg(o, rn);
        else if (k === 'chase') chaseDlg(o, n);
        else if (k === 'awb') awbDlg(o, n);
        else if (k === 'fxcancel') dialog('Cancel the FedEx shipment?', `<span>FedEx ${esc(o.pkgs[n].fedex.trk)} is cancelled with FedEx and the part goes back to <b>ready to ship</b>. Throw the printed label away.${o.pkgs[n].fulfilId ? ' Shopify already has this tracking number, so the fulfilment there is cancelled too.' : ''}</span>`,
          '<button class="s-btn bad" type="button" id="go">Cancel shipment</button>', () => $('go').addEventListener('click', () => act('fedexCancel', { no: o.no, part: n })), 'Keep it');
        else act('returnStep', { no: o.no, ret: rn, kind: k });
      });
      on('[data-upd]', b => b.dataset.live === '1' ? post('/api/track', { nos: [o.no] }) : post('/api/simulate', { no: o.no, part: +b.dataset.upd }));
      on('[data-mark]', b => { const [n, to] = b.dataset.mark.split('|'); act('markStep', { no: o.no, part: +n, to: +to }); });
    }
  }
  on('[data-copy]', b => { (navigator.clipboard ? navigator.clipboard.writeText(b.dataset.copy) : Promise.reject()).then(() => toast('Copied'), () => toast(b.dataset.copy)); });
  document.title = (r === 'order' ? '#' + a : (TABS.find(t => t[0] === tab) || TABS[0])[1]) + ' · Shopify · Ridhi Home & Living';
  if (TI >= 0 && TSPOT) setTimeout(() => applySpot(false), 30);           // a redraw during Present keeps the highlight
}
let last = location.hash;
window.addEventListener('hashchange', () => { const moved = last !== location.hash; const wasOrder = /^#order\//.test(last); last = location.hash; if (moved && location.hash === '#csb') CSB = null; render(); if (moved && !wasOrder && !/^#order\//.test(location.hash)) window.scrollTo(0, 0); });
window.addEventListener('focus', () => { if (!$('dlg').innerHTML && !typing()) fetch('/api/state').then(r => r.json()).then(d => { if (d.ok) { took(d, true); render(); FLASH.clear(); } }).catch(() => {}); });
call('/api/state').then(render).catch(e => { $('page').innerHTML = `<div class="s-card s-empty">${esc(e.message)}</div>`; });
})();
