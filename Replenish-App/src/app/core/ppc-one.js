/* ================= PPC ON ONE PAGE (R-one add-on, 24 Oct) =================
 *
 * Ravi, 24 Oct: "orders and its progress … when a new order is received the PPC page has a notification … after which
 * comes the requirement … then the allotment and PR … then QC … then the shipment phase … with minimum page changing, best
 * in a single page" — and, of the design, "haan, yeh sahi lag raha hai, aage badho".
 *
 * Every order in PPC on one page, by stage, each with the button for its next step. It is built on the Production flow's
 * own figures and buttons — nothing new is stored:
 *   - the lines and where each is: flowRows() / flowState() (flow-core.js), the same the PPC screen reads;
 *   - the five stages are the flow's buckets put together: Orders = ppc + back, Requirement = demand, Allotment & making
 *     = vendor, fabric, emb, cut, raw, wip, out, QC = qcb, Shipping = ship + fgin;
 *   - Plan opens the PPC plan form (flowPpcOpen), Send back the flow's own box (flowBackOpen); the other steps open the
 *     screen where that work is entered (Demand, Cutting Data, Job Work, QC, Finished Goods, Order Console);
 *   - Requirement shows the plan's fabric against the RFD cover (flowRfdCover) and its accessories against the shelf
 *     (flowAccFree); the side card adds up what the waiting lines need (flowRfdCover / flowAccCover);
 *   - Journey opens the order's own journey (ordJourney).
 * Not here yet (each needs new records, so Ravi decides first): an "Accept into PPC" step, purchase requisitions, an
 * owner per step, a change history with old → new values, and "in transit".
 * THE ONLY PPC IN THE MENU (Ravi, 24 Oct: "remove the old ppc from the new one"): today's PPC link (#tabFlow) is hidden
 * (ppc-one.css) and this page takes its place as "PPC". The old screen and its code stay: the buttons here still open its
 * Demand tabs (RFD fabric, accessories, printed fabric in, embroidery), where that work is entered. */
const P1 = { shown: false, built: false, stage: -1, tile: '', open: '', tab: 'req', tick: new Set(), loading: false, more: new Set() };
const P1_STAGES = [['Orders', 'to plan, or sent back'], ['Requirement', 'fabric and accessories to arrange'], ['Allotment & making', 'printer, cutting, karigars'],
  ['QC', 'with Quality Control'], ['Shipping', 'to hand over or accept']];
const P1_OF = { ppc: 0, back: 0, demand: 1, vendor: 2, fabric: 2, emb: 2, cut: 2, raw: 2, wip: 2, out: 2, qcb: 3, ship: 4, fgin: 4 };
const P1_SAYS = { ppc: 'to plan', back: 'sent back to sales', vendor: 'print order to give', fabric: 'with the printer', emb: 'at embroidery', cut: 'to cut',
  raw: 'to issue to a karigar', wip: 'with karigars', out: 'made outside', qcb: 'with QC', ship: 'to hand to shipping', fgin: 'Finished Goods to accept' };
const P1_SHOW = 12;   // orders drawn per stage before "Show all"
const p1N = v => (+v || 0).toLocaleString('en-IN');
const p1Today = () => new Date().toISOString().slice(0, 10);
const p1May = () => !!(ME && (ME.admin || (typeof flowScreenAllowed === 'function' && flowScreenAllowed().length)));

/** One line's words: where it is, what it waits for. */
function p1Says(s) {
  if (s.bucket === 'demand') return s.needFab && s.needAcc ? 'RFD fabric to send, accessories to reserve' : s.needFab ? 'RFD fabric to send' : 'accessories to reserve';
  return P1_SAYS[s.bucket] || s.bucket;
}
/** The day a line is due: the plan's ready date, or a made-to-order line's five working days. */
const p1Due = x => String((x.s.plan && x.s.plan.dates && x.s.plan.dates.ready) || x.r.mtoDue || '');

/** The orders, each with its lines, its stage (the earliest of its open lines) and its due day (the earliest). */
function p1Orders() {
  let rc = null; try { rc = flowRfdCover(); } catch (e) { rc = null; }
  const by = new Map();
  flowRows().forEach(x => {
    const st = P1_OF[x.s.bucket]; if (st == null || x.r.__t) return;
    const o = by.get(x.r.orderNo) || { no: x.r.orderNo, lines: [], stage: 9, due: '', isNew: false, short: false, pcs: 0 };
    o.lines.push(x); o.stage = Math.min(o.stage, st); o.pcs += +x.r.qty || 0;
    if (x.s.bucket === 'ppc' && x.recent) o.isNew = true;
    const d = p1Due(x); if (d && (!o.due || d < o.due)) o.due = d;
    if (rc && rc.line[x.s.key] && rc.line[x.s.key].short > 0) o.short = true;
    by.set(x.r.orderNo, o);
  });
  const today = p1Today();
  return [...by.values()].map(o => Object.assign(o, { late: !!(o.due && o.due < today), buyer: p1Buyer(o) }))
    .sort((a, b) => (a.stage - b.stage) || String(a.due || '9').localeCompare(String(b.due || '9')) || String(a.no).localeCompare(String(b.no)));
}
function p1Buyer(o) {
  const r = o.lines[0].r;
  const so = typeof SOX !== 'undefined' && SOX.rows ? SOX.rows.find(x => x && (x._id || x.id) === o.no) : null;
  return (so && (so.buyerName || so.buyerEmail)) || (r.shopOrderNo ? 'Shopify ' + r.shopOrderNo : '') || r.src || '';
}

const P1_TILES = [['new', '🔔', 'var(--brand-bg)', 'New orders', 'reached PPC this week', o => o.isNew],
  ['plan', '📋', 'var(--chip)', 'To plan', 'or sent back to sales', o => o.stage === 0],
  ['short', '🧵', 'var(--warn-bg)', 'Short of RFD fabric', 'after earlier plans', o => o.short],
  ['late', '⏰', 'var(--bad-bg)', 'Past their ready date', 'need a push today', o => o.late]];

/** The button for an order's next step, and where it goes. */
function p1Next(o) {
  const ls = o.lines.filter(x => P1_OF[x.s.bucket] === o.stage), bk = ls[0].s.bucket;
  const go = (tab, view) => () => { p1Hide(); if (view) FLOW_VIEW = view; showTab(tab); };
  if (o.stage === 0) return ls.some(x => x.s.bucket === 'ppc') && flowCanBack() ? ['Plan', 'blue', () => flowPpcOpen(o.no)] : ['Open Sales Orders', '', go('so')];
  if (o.stage === 1) return ls.some(x => x.s.needFab) ? ['Send RFD fabric', '', go('flow', 'drfd')] : ['Reserve accessories', '', go('flow', 'dacc')];
  if (o.stage === 2) return { vendor: ['Give to printer', '', go('flow', 'dhist')], fabric: ['Receive printed', '', go('flow', 'dhist')], emb: ['Open Embroidery', '', go('flow', 'demb')],
    cut: ['Open Cutting', '', go('pcut')], raw: ['Issue to karigar', '', go('pbase')], wip: ['Open Job Work', '', go('pbase')], out: ['Open Finished Goods', '', go('fgi')] }[bk] || ['Open PPC', '', go('flow')];
  if (o.stage === 3) return ['Open QC', 'blue', go('qc')];
  return ls.some(x => x.s.bucket === 'ship') ? ['Hand to shipping', '', go('ord')] : ['Accept in Finished Goods', '', go('fgi')];
}

function p1StepsH(st) {
  return '<div class="px-steps">' + P1_STAGES.map((s, i) => `<span class="${i < st ? 'd' : i === st ? 'c' : ''}"><i>${i < st ? '✓' : i + 1}</i>${i === st ? esc(s[0]) : ''}</span>`).join('<em></em>') + '</div>';
}
/** Inside an opened card: the lines, what the plan needs against the store, and what is on record. */
function p1MoreH(o) {
  let rc = null; try { rc = flowRfdCover(); } catch (e) { rc = null; }
  let acc = {}; try { acc = flowAccFree(); } catch (e) { acc = {}; }
  const lines = `<table class="px"><tr><th>SKU</th><th>Pcs</th><th>Where</th><th>Route</th><th>Cut</th><th>Issued</th><th>Back</th><th>QC passed</th><th>Ready by</th></tr>${o.lines.map(x => {
    const s = x.s, rt = s.route ? ((FLOW_ROUTES.find(r => r[0] === s.route) || [])[2] || s.route) : '—';
    return `<tr><td><b>${esc(x.r.sku)}</b></td><td>${p1N(x.r.qty)}</td><td>${esc(p1Says(s))}</td><td>${esc(rt)}</td><td>${p1N(s.cut)}</td><td>${p1N(s.issuedNet)}</td><td>${p1N(s.received)}</td><td>${p1N(s.qc)}</td><td>${esc(p1Due(x) || '—')}</td></tr>`; }).join('')}</table>`;
  const mats = [];
  o.lines.forEach(x => {
    const p = x.s.plan; if (!p) return;
    const f = rc && rc.line[x.s.key];
    if (p.fabric && p.fabric.name) mats.push([x.r.sku, p.fabric.name + ' (RFD)', f ? f.need : +p.fabric.metres || 0, f ? f.avail : null, 'm', f ? f.short : 0]);
    (p.acc || []).filter(a => a.code && +a.qty > 0).forEach(a => { const c = typeof accCode === 'function' ? accCode(a.code) : a.code, fr = acc[c];
      mats.push([x.r.sku, (fr && fr.name) || a.code, +a.qty, fr ? fr.free : null, '', fr ? Math.max(0, +a.qty - Math.max(0, fr.free)) : 0]); });
  });
  const req = mats.length ? `<table class="px"><tr><th>SKU</th><th>Material</th><th>Need</th><th>Free in store</th><th>Cover</th><th></th></tr>${mats.map(m => {
      const f = m[3] == null ? 0 : Math.min(100, Math.max(0, m[3]) / Math.max(1, m[2]) * 100);
      return `<tr><td>${esc(m[0])}</td><td><b>${esc(m[1])}</b></td><td>${p1N(m[2])} ${m[4]}</td><td>${m[3] == null ? '—' : p1N(m[3]) + ' ' + m[4]}</td>
        <td><div class="px-bar"><i style="width:${f}%;background:var(--accent)"></i></div></td><td>${m[5] > 0 ? `<i class="px-tag t-na">short ${p1N(m[5])} ${m[4]}</i>` : m[3] == null ? '' : '<i class="px-tag t-in">enough</i>'}</td></tr>`; }).join('')}</table>
      <div style="font-size:12px;color:var(--muted);margin-top:8px">Free = the store's stock less what earlier plans already hold — the same figures PPC and Demand use.</div>`
    : '<div style="color:var(--muted)">No plan yet — <b>Plan</b> works out the fabric and accessories this order needs and checks them against the store.</div>';
  const rec = [];
  o.lines.forEach(x => {
    const p = x.s.plan, b = x.r.ppcBack;
    if (p && p.at) rec.push([String(p.at), p.by || '', `planned <b>${esc(x.r.sku)}</b> · ${esc((FLOW_ROUTES.find(r => r[0] === x.s.route) || [])[2] || '')}${p.printer ? ' · ' + esc(p.printer) : ''}`]);
    if (b && b.at) rec.push([String(b.at), b.by || '', `sent <b>${esc(x.r.sku)}</b> back to sales${b.note ? ' · “' + esc(b.note) + '”' : ''}`]);
    if (x.r.openIso) rec.push([x.r.openIso, '', `<b>${esc(x.r.sku)}</b> came on the order book`]);
  });
  rec.sort((a, b) => b[0].localeCompare(a[0]));
  const hist = rec.length ? rec.map(h => `<div class="px-fd"><span class="av">${esc((h[1] || 'R1').slice(0, 2).toUpperCase())}</span><div>${h[1] ? '<b>' + esc(String(h[1]).split('@')[0]) + '</b> ' : ''}${h[2]}<small>${esc(h[0].replace('T', ' ').slice(0, 16))}</small></div></div>`).join('')
    : '<div style="color:var(--muted)">Nothing on record yet.</div>';
  const T = { req: ['Lines', lines], mat: ['Requirement', req], hist: ['On record', hist] };
  return `<div class="px-more"><div class="px-tabs">${Object.entries(T).map(([k, v]) => `<button type="button" data-p1t="${k}" class="${P1.tab === k ? 'on' : ''}">${v[0]}</button>`).join('')}
    <span style="flex:1"></span><button type="button" class="px-go" style="height:30px;margin-bottom:4px" data-p1j="${esc(o.no)}">Full journey</button></div>${(T[P1.tab] || T.req)[1]}</div>`;
}
function p1CardH(o, i) {
  const nx = p1Next(o), open = P1.open === o.no;
  const words = [...new Set(o.lines.filter(x => P1_OF[x.s.bucket] === o.stage).map(x => p1Says(x.s)))].join(', ');
  const tags = (o.isNew ? '<i class="px-tag t-new">NEW</i>' : '') + (o.late ? '<i class="px-tag t-late">LATE</i>' : '') + (o.short ? '<i class="px-tag t-na">RFD short</i>' : '')
    + (o.lines.some(x => x.s.bucket === 'back') ? '<i class="px-tag t-risk">sent back</i>' : '');
  return `<div class="px-card${open ? ' open' : ''}${P1.tick.has(o.no) ? ' ticked' : ''}"><div class="px-row">
    <label class="px-tick"><input type="checkbox" data-p1k="${esc(o.no)}"${P1.tick.has(o.no) ? ' checked' : ''}></label>
    <div class="px-body"><div class="px-t"><b>${esc(o.no)}</b>${tags}</div>
      <div class="px-d">${o.buyer ? esc(o.buyer) + ' · ' : ''}${p1N(o.pcs)} pcs · ${o.lines.length} SKU${o.lines.length > 1 ? 's' : ''} · ${esc(words)}</div>${p1StepsH(o.stage)}</div>
    <div class="px-due${o.late ? ' late' : ''}"><b>${esc(o.due ? o.due.slice(8, 10) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+o.due.slice(5, 7) - 1] : '—')}</b>${o.due ? 'ready by' : 'no date yet'}</div>
    <div class="px-acts"><button type="button" class="px-yes ${nx[1]}" data-p1a="${i}">${esc(nx[0])}</button><button type="button" class="px-go" data-p1o="${esc(o.no)}">${open ? 'Close' : 'Details'}</button>${o.stage === 0 && o.lines.some(x => x.s.bucket === 'ppc') && flowCanBack() ? `<button type="button" class="px-later" data-p1b="${i}">Send back</button>` : ''}</div></div>
    ${open ? p1MoreH(o) : ''}</div>`;
}
function p1Side() {
  let fab = [], acc = [];
  try { fab = Object.values(flowRfdCover().fab).filter(f => f.need > 0).sort((a, b) => b.short - a.short || b.need - a.need).slice(0, 6); } catch (e) { fab = []; }
  try { acc = flowAccCover().filter(a => a.need > 0).sort((a, b) => b.short - a.short).slice(0, 5); } catch (e) { acc = []; }
  const row = (name, free, unit, need, short) => `<div class="px-st"><div class="a"><b>${esc(name)}</b><span>${p1N(free)} <small style="color:var(--muted);font-weight:600">${unit} free</small></span></div>
    <div class="c"><span><i class="px-tag ${short > 0 ? 't-na' : 't-in'}" style="margin-right:4px">●</i>need ${p1N(need)}${short > 0 ? ' · short ' + p1N(short) : ' · enough'}</span></div></div>`;
  const plans = Object.entries(FLOW.ppc || {}).filter(([, p]) => p && p.at).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 6);
  return `<div class="px-sc"><h3>RFD fabric for waiting lines <button type="button" data-p1go="drfd">Demand ›</button></h3>${fab.map(f => row(f.name, f.free, 'm', f.need, f.short)).join('') || '<div style="color:var(--muted);font-size:12.5px">No line is waiting for fabric.</div>'}</div>
    <div class="px-sc"><h3>Accessories for waiting lines <button type="button" data-p1go="dacc">Demand ›</button></h3>${acc.map(a => row(a.name || a.code, a.free, '', a.need, a.short)).join('') || '<div style="color:var(--muted);font-size:12.5px">No line is waiting for accessories.</div>'}</div>
    <div class="px-sc"><h3>Latest plans</h3>${plans.map(([k, p]) => `<div class="px-fd"><span class="av">${esc(String(p.by || 'R1').slice(0, 2).toUpperCase())}</span><div><b>${esc(String(p.by || '').split('@')[0])}</b> planned ${esc(k.replace('__', ' · '))}<small>${esc(String(p.at).replace('T', ' ').slice(0, 16))}</small></div></div>`).join('') || '<div style="color:var(--muted);font-size:12.5px">No plans yet.</div>'}</div>`;
}
function p1Draw() {
  const el = $('p1Home'); if (!el || !P1.shown) return;
  if (P1.loading && !P1.built) { el.innerHTML = '<div class="px-head"><div><h1>PPC</h1><div class="px-sub">Reading the order book, plans and store…</div></div></div>'; return; }
  let all = [];
  try { all = p1Orders(); } catch (e) { el.innerHTML = `<div class="px-head"><div><h1>PPC</h1><div class="px-sub" style="color:var(--bad)">Could not read the lines: ${esc(e.message || e)}</div></div></div>`; return; }
  const tile = P1_TILES.find(t => t[0] === P1.tile);
  const list = all.filter(o => (P1.stage < 0 || o.stage === P1.stage) && (!tile || tile[5](o)));
  P1.list = list;
  const groups = P1_STAGES.map((s, i) => [i, list.filter(o => o.stage === i)]).filter(g => g[1].length);
  const ticked = list.filter(o => P1.tick.has(o.no));
  el.innerHTML = `<div class="px-head"><div><h1>PPC</h1><div class="px-sub">${p1N(all.length)} orders in production · ${p1N(all.reduce((s, o) => s + o.pcs, 0))} pcs${all.some(o => o.isNew) ? ' · start with the new orders' : ''}</div>
      <div class="px-when">${P1.loading ? 'Reading…' : 'Last read ' + (P1.at || '—')} · <a href="#" data-p1r style="color:var(--brand-ink);font-weight:600;text-decoration:none">↻ Refresh</a></div></div>
      <div class="px-hr"><input class="px-search" id="p1Q" placeholder="Order or SKU…" value="${esc(P1.q || '')}"></div></div>
    <div class="px-stats">${P1_TILES.map(t => `<button type="button" class="px-stat${P1.tile === t[0] ? ' on' : ''}" data-p1s="${t[0]}"><span class="ic" style="background:${t[2]}">${t[1]}</span><span><b>${p1N(all.filter(t[5]).length)}</b><span>${t[3]} · ${t[4]}</span></span><span class="go">›</span></button>`).join('')}</div>
    <div class="px-stages"><button type="button" class="px-pill${P1.stage < 0 ? ' on' : ''}" data-p1g="-1">All <i>${p1N(all.length)}</i></button>${P1_STAGES.map((s, i) => `<span class="px-arr">${i ? '›' : ''}</span><button type="button" class="px-pill${P1.stage === i ? ' on' : ''}" data-p1g="${i}" title="${esc(s[1])}">${i + 1} · ${esc(s[0])} <i>${p1N(all.filter(o => o.stage === i).length)}</i></button>`).join('')}</div>
    <div class="px-cols"><div>${groups.map(([i, os]) => { const q = (P1.q || '').trim().toUpperCase(), shown0 = q ? os.filter(o => o.no.includes(q) || o.lines.some(x => String(x.r.sku).includes(q))) : os;
        const shown = P1.more.has(i) || q ? shown0 : shown0.slice(0, P1_SHOW);
        return `<div class="px-grp"><div class="px-gh"><label class="px-tick"><input type="checkbox" data-p1ga="${i}"${shown.length && shown.every(o => P1.tick.has(o.no)) ? ' checked' : ''}></label><b>${i + 1} · ${esc(P1_STAGES[i][0])}</b><span class="n">${p1N(os.length)}</span><small>${esc(P1_STAGES[i][1])}</small>${i === 0 && flowCanBack() && os.filter(o => o.lines.some(x => x.s.bucket === 'ppc')).length > 1 ? `<button type="button" class="px-all" data-p1pall>Plan ticked together</button>` : ''}</div>
          ${shown.map(o => p1CardH(o, list.indexOf(o))).join('')}${shown.length < shown0.length ? `<button type="button" class="px-go" style="margin:8px 10px" data-p1m="${i}">Show all ${p1N(shown0.length)}</button>` : ''}</div>`; }).join('') || '<div class="px-grp" style="padding:30px;text-align:center;color:var(--muted)">Nothing here ✓</div>'}
      ${ticked.length ? `<div class="px-tickbar"><b>${ticked.length} ticked</b>${flowCanBack() ? '<button type="button" class="px-yes blue" data-p1tp>Plan together</button><button type="button" class="px-go" data-p1tb>Send back</button>' : ''}<button type="button" class="px-go" data-p1tc>Clear</button></div>` : ''}</div>
      <div class="px-side">${p1Side()}</div></div>`;
  p1Wire(el, list);
}
function p1Wire(el, list) {
  const keysOf = (os, bucket) => [].concat(...os.map(o => o.lines.filter(x => x.s.bucket === bucket).map(x => x.s.key)));
  el.querySelectorAll('[data-p1s]').forEach(b => b.onclick = () => { P1.tile = P1.tile === b.dataset.p1s ? '' : b.dataset.p1s; P1.stage = -1; p1Draw(); });
  el.querySelectorAll('[data-p1g]').forEach(b => b.onclick = () => { P1.stage = +b.dataset.p1g; P1.tile = ''; p1Draw(); });
  el.querySelectorAll('[data-p1o]').forEach(b => b.onclick = () => { P1.open = P1.open === b.dataset.p1o ? '' : b.dataset.p1o; p1Draw(); });
  el.querySelectorAll('[data-p1t]').forEach(b => b.onclick = () => { P1.tab = b.dataset.p1t; p1Draw(); });
  el.querySelectorAll('[data-p1j]').forEach(b => b.onclick = () => ordJourney(b.dataset.p1j));
  el.querySelectorAll('[data-p1a]').forEach(b => b.onclick = () => p1Next(list[+b.dataset.p1a])[2]());
  el.querySelectorAll('[data-p1b]').forEach(b => b.onclick = () => flowBackOpen(keysOf([list[+b.dataset.p1b]], 'ppc')));
  el.querySelectorAll('[data-p1k]').forEach(b => b.onchange = () => { b.checked ? P1.tick.add(b.dataset.p1k) : P1.tick.delete(b.dataset.p1k); p1Draw(); });
  el.querySelectorAll('[data-p1ga]').forEach(b => b.onchange = () => { list.filter(o => o.stage === +b.dataset.p1ga).forEach(o => b.checked ? P1.tick.add(o.no) : P1.tick.delete(o.no)); p1Draw(); });
  el.querySelectorAll('[data-p1m]').forEach(b => b.onclick = () => { P1.more.add(+b.dataset.p1m); p1Draw(); });
  el.querySelectorAll('[data-p1go]').forEach(b => b.onclick = () => { p1Hide(); FLOW_VIEW = b.dataset.p1go; showTab('flow'); });
  const ticked = () => list.filter(o => P1.tick.has(o.no));
  const tp = el.querySelector('[data-p1tp]'); if (tp) tp.onclick = () => { const k = keysOf(ticked(), 'ppc'); if (k.length) flowPpcOpen(null, null, k); else ptOpenDialog({ title: 'Nothing to plan', note: 'None of the ticked orders has a line waiting for a plan.', saveLabel: 'OK', onSave: () => '' }); };
  const pall = el.querySelector('[data-p1pall]'); if (pall) pall.onclick = () => tp ? tp.click() : ptOpenDialog({ title: 'Tick the orders first', note: 'Tick the orders to plan together — lines of the same SKU are combined in one plan.', saveLabel: 'OK', onSave: () => '' });
  const tb = el.querySelector('[data-p1tb]'); if (tb) tb.onclick = () => { const k = keysOf(ticked(), 'ppc'); if (k.length) flowBackOpen(k); };
  const tc = el.querySelector('[data-p1tc]'); if (tc) tc.onclick = () => { P1.tick.clear(); p1Draw(); };
  const r = el.querySelector('[data-p1r]'); if (r) r.onclick = e => { e.preventDefault(); p1Load(true); };
  const q = el.querySelector('#p1Q'); if (q) q.oninput = () => { P1.q = q.value; clearTimeout(P1.qt); P1.qt = setTimeout(() => { p1Draw(); const n = $('p1Q'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); };
}
async function p1Load(force) {
  if (P1.loading) return;
  P1.loading = true; p1Draw();
  try { if (force && typeof flowLoad === 'function') await flowLoad(true); await flowEnsureData(); P1.built = true; P1.at = new Date().toTimeString().slice(0, 5); }
  catch (e) { P1.err = e.message || String(e); }
  finally { P1.loading = false; p1Draw(); }
}
function p1Show() {
  if (!p1May()) return;
  if (typeof frHomeHide === 'function') frHomeHide();
  const main = document.querySelector('main.main'); if (!main) return;
  main.classList.add('p1-on'); P1.shown = true;
  if ($('pageTitle')) $('pageTitle').textContent = 'PPC';
  document.querySelectorAll('.side a.nav.on').forEach(a => a.classList.remove('on'));
  if ($('tabP1')) $('tabP1').classList.add('on');
  window.scrollTo(0, 0);
  p1Draw();
  if (!P1.built) p1Load(false);
}
function p1Hide() {
  if (!P1.shown) return;
  P1.shown = false;
  const main = document.querySelector('main.main'); if (main) main.classList.remove('p1-on');
  if ($('tabP1')) $('tabP1').classList.remove('on');
}
function p1Build() {
  if (P1.wired || !document.querySelector('main.main') || !$('tabFlow')) return;
  P1.wired = true;
  const home = document.createElement('section'); home.id = 'p1Home';
  const top = document.querySelector('main.main > .topbar'); top.parentNode.insertBefore(home, top.nextSibling);
  /* the menu: right under today's PPC, for whoever may open the flow (no address of its own, so the browser's Back
   * and the app's hash routing never meet it) */
  const a = document.createElement('a');
  a.id = 'tabP1'; a.className = 'nav'; a.setAttribute('role', 'button'); a.style.display = 'none'; a.style.cursor = 'pointer';
  a.innerHTML = '<span class="nav-ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg></span><span class="nav-t">PPC</span>';
  $('tabFlow').parentNode.insertBefore(a, $('tabFlow').nextSibling);
  a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); p1Show(); });
  /* every other screen goes through showTab: leaving this page */
  const appShowTab = showTab;
  showTab = function () { p1Hide(); return appShowTab.apply(this, arguments); };
  document.addEventListener('click', e => { const n = P1.shown && e.target.closest && e.target.closest('.side a.nav[href^="#"], #frHomeNav'); if (n) p1Hide(); }, true);
  /* My work today shown from anywhere else (the bell, a pop-up): this page steps aside */
  if (typeof frHomeShow === 'function') { const fh = frHomeShow; frHomeShow = function () { p1Hide(); return fh.apply(this, arguments); }; }
  const may = () => { a.style.display = p1May() ? '' : 'none'; };
  const t = setInterval(() => { if (ME && ME.email) { may(); clearInterval(t); } }, 1000);
}
(function p1Start(n) { if (document.querySelector('main.main') && typeof $ === 'function' && $('tabFlow')) p1Build(); else if (n > 0) setTimeout(() => p1Start(n - 1), 300); })(60);
