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
const P1 = { shown: false, built: false, stage: -1, tile: '', sel: '', lt: 'o', secs: new Set(), all: false, tick: new Set(), loading: false };
const P1_STAGES = [['Orders', 'to plan, or sent back'], ['Requirement', 'fabric and accessories to arrange'], ['Allotment & making', 'printer, cutting, karigars'],
  ['QC', 'with Quality Control'], ['Shipping', 'to hand over or accept']];
const P1_OF = { ppc: 0, back: 0, demand: 1, vendor: 2, fabric: 2, emb: 2, cut: 2, raw: 2, wip: 2, out: 2, qcb: 3, ship: 4, fgin: 4 };
const P1_SAYS = { ppc: 'to plan', back: 'sent back to sales', vendor: 'print order to give', fabric: 'with the printer', emb: 'at embroidery', cut: 'to cut',
  raw: 'to issue to a karigar', wip: 'with karigars', out: 'made outside', qcb: 'with QC', ship: 'to hand to shipping', fgin: 'Finished Goods to accept' };
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

/* ---------- the page: the layout Ravi chose (ppc-one-page-mock-v4.html, 24 Oct: "its nothing same on the test site") ----------
 * Four boxes and the five stages across the top; on the left the orders (with Materials, Stock and Activity beside them);
 * on the right the chosen order: its next step, each SKU, then the five stages, each opening to what is known about it. */
const P1_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p1Day = d => d ? (+String(d).slice(8, 10)) + ' ' + P1_MON[+String(d).slice(5, 7) - 1] : '';
const p1Who = v => String(v || '').split('@')[0];
const p1Ini = v => (p1Who(v) || 'R1').slice(0, 2).toUpperCase();
const p1Route = s => s.route ? ((FLOW_ROUTES.find(r => r[0] === s.route) || [])[2] || s.route) : '';
function p1Cover() { try { return flowRfdCover(); } catch (e) { return { fab: {}, line: {} }; } }
function p1Acc() { try { return flowAccFree(); } catch (e) { return {}; } }
/** Material for an order: in stock (planned and nothing short), short (RFD or accessories short), or not planned yet. */
function p1Mat(o, rc, acc) {
  if (!o.lines.some(x => x.s.plan)) return ['a-exp', 'Not planned'];
  const short = o.lines.some(x => (rc.line[x.s.key] && rc.line[x.s.key].short > 0)
    || (x.s.needAcc && ((x.s.plan && x.s.plan.acc) || []).some(a => { const f = acc[typeof accCode === 'function' ? accCode(a.code) : a.code]; return f && +a.qty > Math.max(0, f.free); })));
  return short ? ['a-na', 'Material short'] : ['a-in', 'Material ok'];
}
function p1Bar(st) { return P1_STAGES.map((s, i) => `<i class="${i < st ? 'd' : i === st ? 'c' : ''}"></i>`).join(''); }
function p1Flags(o) {
  return (o.isNew ? '<span class="flag f-new">NEW</span>' : '') + (o.late ? '<span class="flag f-late">LATE</span>' : '')
    + (o.lines.some(x => x.s.bucket === 'back') ? '<span class="flag f-risk">SENT BACK</span>' : '');
}

function p1LeftH(all, list, rc, acc) {
  const T = [['o', 'Orders'], ['m', 'Materials'], ['s', 'Stock'], ['a', 'Activity']];
  const tabs = `<div class="tabs">${T.map(t => `<button type="button" data-p1l="${t[0]}" class="${P1.lt === t[0] ? 'on' : ''}">${t[1]}</button>`).join('')}</div>`;
  if (P1.lt === 'm') {
    const fab = Object.values(rc.fab).filter(f => f.need > 0).sort((a, b) => b.short - a.short || b.need - a.need);
    let ac = []; try { ac = flowAccCover().filter(a => a.need > 0).sort((a, b) => b.short - a.short); } catch (e) { ac = []; }
    const row = (nm, need, free, short, u) => `<tr><td>${esc(nm)}</td><td>${p1N(need)} ${u}</td><td>${p1N(free)} ${u}</td><td>${short > 0 ? `<span class="pill p-short">${p1N(short)} ${u}</span>` : '<span class="pill p-ok">enough</span>'}</td></tr>`;
    return tabs + `<div class="lh" style="color:var(--muted)">What the waiting lines need, added up — against free store stock</div>
      <table class="mat"><tr><th>RFD fabric</th><th>Need</th><th>Free</th><th>Short</th></tr>${fab.map(f => row(f.name, f.need, f.free, f.short, 'm')).join('') || '<tr><td colspan="4" style="color:var(--muted)">No line waits for fabric.</td></tr>'}</table>
      <table class="mat"><tr><th>Accessory</th><th>Need</th><th>Free</th><th>Short</th></tr>${ac.map(a => row(a.name || a.code, a.need, a.free, a.short, '')).join('') || '<tr><td colspan="4" style="color:var(--muted)">No line waits for accessories.</td></tr>'}</table>
      <div class="bulk"><b>${fab.filter(f => f.short > 0).length + ac.filter(a => a.short > 0).length} short</b><button type="button" class="pri" data-p1go="drfd">Open Demand</button></div>`;
  }
  if (P1.lt === 's') {
    const o = all.find(x => x.no === P1.sel), used = new Set();
    if (o) o.lines.forEach(x => { const p = x.s.plan; if (!p) return; if (p.fabric && p.fabric.name) used.add(String(p.fabric.name).toUpperCase()); (p.acc || []).forEach(a => used.add(String(a.code).toUpperCase())); });
    const fab = Object.values(rc.fab).sort((a, b) => a.name.localeCompare(b.name));
    const accs = Object.entries(acc).filter(([, f]) => f && (f.shelf > 0 || f.held > 0)).sort((a, b) => String(a[1].name || a[0]).localeCompare(String(b[1].name || b[0]))).slice(0, 60);
    const it = (nm, key, u, on, held, free) => { const tot = Math.max(1, on); const hl = used.has(String(key).toUpperCase());
      return `<div class="stk${hl ? ' hl' : ''}"><div class="a"><b>${esc(nm)}</b>${hl ? `<span class="flag f-risk">${esc(o.no)}</span>` : ''}<span class="q">${p1N(free)} <small>${u} free</small></span></div>
        <div class="sbar" style="width:100%;margin-top:6px"><i style="width:${Math.max(0, free) / tot * 100}%;background:var(--ok)"></i><i style="width:${Math.min(on, held) / tot * 100}%;background:#F6B93B"></i></div>
        <div class="c"><span>in store <b>${p1N(on)}</b></span><span>held for plans <b>${p1N(held)}</b></span></div></div>`; };
    return tabs + `<div class="lh" style="color:var(--muted)">Store stock${o ? ' · the items ' + esc(o.no) + ' uses are lit' : ''}</div>
      <div class="ol"><div class="sgh">RFD fabric (Greige Desk and store)</div>${fab.map(f => it(f.name, f.name, 'm', f.stock, f.held, f.free)).join('') || '<div class="empty">No RFD fabric is needed by a waiting line.</div>'}
      <div class="sgh">Accessories</div>${accs.map(([c, f]) => it(f.name || c, c, '', f.shelf, f.held, f.free)).join('') || '<div class="empty">No accessories on the shelf.</div>'}</div>
      <div class="legend" style="padding:8px 12px 12px"><span><i style="background:var(--ok)"></i>free</span><span><i style="background:#F6B93B"></i>held for earlier plans</span></div>`;
  }
  if (P1.lt === 'a') {
    const ev = [];
    all.forEach(o => o.lines.forEach(x => {
      const p = x.s.plan, b = x.r.ppcBack;
      if (p && p.at) ev.push([String(p.at), p.by, `planned <b>${esc(x.r.sku)}</b> of ${esc(o.no)}${p1Route(x.s) ? ' · ' + esc(p1Route(x.s)) : ''}`, o.no]);
      if (b && b.at) ev.push([String(b.at), b.by, `sent <b>${esc(x.r.sku)}</b> of ${esc(o.no)} back to sales${b.note ? ' · “' + esc(b.note) + '”' : ''}`, o.no]);
    }));
    ev.sort((a, b) => b[0].localeCompare(a[0]));
    return tabs + '<div class="lh" style="color:var(--muted)">Latest in PPC — plans and send-backs</div><div class="feed">'
      + (ev.slice(0, 60).map(e => `<div class="hi" style="padding:9px 12px;cursor:pointer" data-p1sel="${esc(e[3])}"><span class="dot"><span class="av">${esc(p1Ini(e[1]))}</span></span><p>${e[1] ? '<b>' + esc(p1Who(e[1])) + '</b> ' : ''}${e[2]}<br><small>${esc(e[0].replace('T', ' ').slice(0, 16))}</small></p></div>`).join('') || '<div class="empty">Nothing yet.</div>') + '</div>';
  }
  const q = (P1.q || '').trim().toUpperCase();
  const rows0 = q ? list.filter(o => o.no.includes(q) || o.lines.some(x => String(x.r.sku).includes(q))) : list;
  const rows = P1.all || q ? rows0 : rows0.slice(0, 80);
  const tile = P1_TILES.find(t => t[0] === P1.tile);
  return tabs + `<div class="lh"><input type="search" id="p1Q" placeholder="Order or SKU…" value="${esc(P1.q || '')}"></div>
    ${P1.tile || P1.stage >= 0 ? `<div class="lh" style="font-size:12px;color:var(--muted)">Showing: <b style="color:var(--ink)">${esc(tile ? tile[3] : P1_STAGES[P1.stage][0])}</b> · ${p1N(rows0.length)} <button type="button" class="btn" style="height:24px;margin-left:auto;font-size:11.5px" data-p1clr>Show all</button></div>` : ''}
    <div class="ol">${rows.map(o => { const m = p1Mat(o, rc, acc), by = (o.lines.find(x => x.s.plan && x.s.plan.by) || {}).s;
      return `<div class="ord${o.no === P1.sel ? ' on' : ''}" data-p1sel="${esc(o.no)}"><input type="checkbox" data-p1k="${esc(o.no)}"${P1.tick.has(o.no) ? ' checked' : ''}><div class="bd">
        <div class="r1"><b>${esc(o.no)}</b>${p1Flags(o)}<span class="due" style="${o.late ? 'color:var(--bad);font-weight:700' : ''}">${o.due ? p1Day(o.due) : ''}</span></div>
        <div class="r1"><small>${o.buyer ? esc(o.buyer) + ' · ' : ''}${p1N(o.pcs)} pcs${o.lines.length > 1 ? ' · ' + o.lines.length + ' SKUs' : ''}</small></div>
        <div class="prog">${p1Bar(o.stage)}</div>
        <div class="r3">At <b style="color:var(--ink)">${esc(P1_STAGES[o.stage][0])}</b> · <span class="av-pill ${m[0]}">${m[1]}</span>${by ? `<span class="av" title="planned by ${esc(p1Who(by.plan.by))}">${esc(p1Ini(by.plan.by))}</span>${esc(p1Who(by.plan.by))}` : ''}</div></div></div>`; }).join('') || '<div class="empty">Nothing here ✓</div>'}
    ${rows.length < rows0.length ? `<button type="button" class="more" data-p1all>Show all ${p1N(rows0.length)}</button>` : ''}</div>
    ${P1.tick.size ? `<div class="bulk"><b>${P1.tick.size} ticked</b>${flowCanBack() ? '<button type="button" class="pri" data-p1tp>Plan together</button><button type="button" data-p1tb>Send back</button>' : ''}<button type="button" data-p1tc>Clear</button></div>` : ''}`;
}

/** The chosen order. */
function p1DetailH(o, rc, acc) {
  if (!o) return '<div class="empty" style="padding:60px 20px">Pick an order on the left.</div>';
  const at = o.stage, nx = p1Next(o), L = o.lines;
  const sec = (i, title, sum, body) => `<div class="sec${P1.secs.has(i) || (i === at && !P1.secs.has(-1 - i)) ? '' : ' shut'}"><button type="button" class="sh ${i < at ? 'd' : i === at ? 'c' : ''}" data-p1sec="${i}"><span class="n">${i < at ? '✓' : i + 1}</span><span><b>${esc(title)}</b><br><span class="st">${sum}</span></span><span class="own">${i < at ? '<span class="tag d">Done</span>' : i === at ? '<span class="tag c">Now</span>' : '<span class="tag w">To come</span>'}</span></button><div class="sb">${body}</div></div>`;
  const plan0 = (L.find(x => x.s.plan) || {}).s;
  const route = plan0 ? plan0.route : '';
  /* 1 Orders */
  const s1 = `<table><tr><th>SKU</th><th>Pcs</th><th>On the book</th><th>Order date</th></tr>${L.map(x => `<tr><td>${esc(x.r.sku)}</td><td>${p1N(x.r.qty)}</td><td>${esc(p1Day(x.r.openIso) || '—')}</td><td>${esc(p1Day(ptIsoDate(x.r.orderDate)) || '—')}</td></tr>`).join('')}</table>
    ${L.some(x => x.r.ppcBack && x.s.bucket === 'back') ? `<div class="foot">Sent back to sales${L.find(x => x.r.ppcBack).r.ppcBack.note ? ': “' + esc(L.find(x => x.r.ppcBack).r.ppcBack.note) + '”' : ''} — it comes back here when sales send it again.</div>` : ''}
    ${at === 0 && L.some(x => x.s.bucket === 'ppc') && flowCanBack() ? '<div class="acts"><button type="button" class="btn pri" data-p1do="plan">Plan</button><button type="button" class="btn" data-p1do="back">Send back to sales</button></div>' : ''}`;
  /* 2 Requirement: the plan's fabric and accessories against free store stock */
  const mats = [];
  L.forEach(x => { const p = x.s.plan; if (!p) return; const f = rc.line[x.s.key];
    if (p.fabric && p.fabric.name) mats.push([x.r.sku, p.fabric.name + ' (RFD)', f ? f.need : +p.fabric.metres || 0, f ? f.avail : null, 'm', f ? f.short : 0, x.s.needFab]);
    (p.acc || []).filter(a => a.code && +a.qty > 0).forEach(a => { const c = typeof accCode === 'function' ? accCode(a.code) : a.code, fr = acc[c];
      mats.push([x.r.sku, (fr && fr.name) || a.code, +a.qty, fr ? fr.free : null, '', x.s.needAcc && fr ? Math.max(0, +a.qty - Math.max(0, fr.free)) : 0, x.s.needAcc]); }); });
  const s2 = `<div class="lab">Route</div><div class="route">${FLOW_ROUTES.map(r => `<span class="${r[0] === route ? 'on' : ''}">${esc(r[2])}</span>`).join('')}</div>
    ${route ? `<div class="path">${(flowPrinted(route) ? ['RFD fabric', 'Printer'] : []).concat(route === 'emb' ? ['Embroidery'] : []).concat(route === 'jobwork' || route === 'outsource' ? [] : ['Cutting']).concat(route === 'outsource' ? ['Made outside'] : ['Karigar']).concat(['QC', 'Finished goods']).map(s => `<b>${s}</b>`).join('›')}</div>` : ''}
    ${mats.length ? `<table><tr><th>SKU</th><th>Material</th><th>Need</th><th>Free in store</th><th>Cover</th><th>Availability</th></tr>${mats.map(m => { const f = m[3] == null ? 0 : Math.min(100, Math.max(0, m[3]) / Math.max(1, m[2]) * 100);
        return `<tr><td>${esc(m[0])}</td><td><b>${esc(m[1])}</b></td><td>${p1N(m[2])} ${m[4]}</td><td>${m[3] == null ? '—' : p1N(m[3]) + ' ' + m[4]}</td><td><div class="sbar"><i style="width:${m[6] ? f : 100}%;background:var(--ok)"></i></div></td>
        <td>${!m[6] ? '<span class="av-pill a-in">arranged</span>' : m[5] > 0 ? `<span class="av-pill a-na">short ${p1N(m[5])} ${m[4]}</span>` : '<span class="av-pill a-in">in stock</span>'}</td></tr>`; }).join('')}</table>
      <div class="foot">Free = store stock less what earlier plans hold — the same figures PPC and Demand use. Arranged = the fabric has gone to the printer / the accessories are reserved.</div>`
      : '<div class="foot">No plan yet — <b>Plan</b> works out the fabric and accessories this order needs and checks them against the store.</div>'}
    ${at <= 1 ? `<div class="acts">${L.some(x => x.s.bucket === 'ppc') && flowCanBack() ? '<button type="button" class="btn pri" data-p1do="plan">Plan</button>' : ''}${plan0 && flowCanBack() ? '<button type="button" class="btn" data-p1do="edit">Edit plan</button>' : ''}${L.some(x => x.s.needFab) ? '<button type="button" class="btn" data-p1go="drfd">Send RFD fabric</button>' : ''}${L.some(x => x.s.needAcc) ? '<button type="button" class="btn" data-p1go="dacc">Reserve accessories</button>' : ''}</div>` : ''}`;
  /* 3 Allotment & making: who has it, and the plan's dates */
  const steps = [];
  L.forEach(x => { const s = x.s, p = s.plan || {}, q = +x.r.qty || 0;
    if (s.printed) steps.push([x.r.sku, 'Printing', p.printer || (s.po && s.po.printer) || '—', s.back >= q ? 'back in full' : s.given > 0 ? `with printer · ${p1N(s.back)} of ${p1N(q)} back` : 'print order to give']);
    if (s.route === 'emb') steps.push([x.r.sku, 'Embroidery', (p.emb && p.emb.name) || 'Embroidery dept', `${p1N(s.embOk || s.embBack || 0)} of ${p1N(q)} back`]);
    if (s.cutReq) steps.push([x.r.sku, 'Cutting', 'Cutting department', `${p1N(s.cut)} of ${p1N(q)} cut`]);
    if (s.route === 'outsource') steps.push([x.r.sku, 'Made outside', p.outVendor || '—', `${p1N(s.india)} of ${p1N(q)} received`]);
    else steps.push([x.r.sku, 'Stitching', 'Karigars', `${p1N(s.issuedNet)} issued · ${p1N(s.received)} back`]); });
  const d0 = plan0 && plan0.plan.at ? String(plan0.plan.at).slice(0, 10) : '', dt = plan0 ? plan0.plan.dates || {} : {};
  let gantt = '';
  if (d0 && dt.ready) {
    const ms = d => Date.parse(d + 'T00:00:00'), a = ms(d0), z = Math.max(ms(dt.ready), Date.now()) + 864e5, span = Math.max(1, z - a), pos = d => Math.max(0, Math.min(100, (ms(d) - a) / span * 100));
    const today = new Date().toISOString().slice(0, 10), bar = (from, to, done) => `<span class="gb ${done ? 'd' : from <= today && today <= to ? 'c' : 'p'}" style="left:${pos(from)}%;width:${Math.max(2, pos(to) - pos(from))}%"></span>`;
    const G = [['Fabric & printing', d0, dt.cut || dt.qc || dt.ready, at > 2 || L.every(x => !x.s.printed || x.s.back >= +x.r.qty)], ['Cutting & stitching', dt.cut || d0, dt.qc || dt.ready, at > 2], ['QC & ready', dt.qc || dt.cut || d0, dt.ready, at > 3]];
    gantt = `<div class="lab">Schedule — from the plan's dates</div><div class="gantt">${G.map(g => `<div class="gl">${g[0]}<small>${p1Day(g[1])} → ${p1Day(g[2])}</small></div><div class="gtrack">${bar(g[1], g[2], g[3])}<span class="today" style="left:${pos(today)}%"></span></div>`).join('')}</div>
      <div class="legend"><span><i style="background:var(--ok)"></i>done</span><span><i style="background:var(--warn)"></i>in progress</span><span><i style="background:#CBD5E1"></i>planned</span><span><i style="background:var(--bad);width:2px"></i>today</span></div>`;
  }
  const s3 = gantt + `<div class="lab">Who has it</div><table><tr><th>SKU</th><th>Step</th><th>Given to</th><th>Where it is</th></tr>${steps.map(r => `<tr><td>${esc(r[0])}</td><td><b>${r[1]}</b></td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('') || '<tr><td colspan="4" style="color:var(--muted)">After the plan.</td></tr>'}</table>
    ${at === 2 ? `<div class="acts"><button type="button" class="btn pri" data-p1do="next">${esc(nx[0])}</button></div>` : ''}`;
  /* 4 QC */
  const s4 = `<table><tr><th>SKU</th><th>Pcs</th><th>Back from karigars</th><th>QC passed</th><th>Rejected</th><th>Left</th></tr>${L.map(x => `<tr><td>${esc(x.r.sku)}</td><td>${p1N(x.r.qty)}</td><td>${p1N(x.s.received)}</td><td>${p1N(x.s.qc)}</td><td>${p1N(x.s.qcRej)}</td><td><b>${p1N(Math.max(0, (+x.r.qty || 0) - x.s.qc))}</b></td></tr>`).join('')}</table>
    ${at === 3 ? '<div class="acts"><button type="button" class="btn pri" data-p1do="next">Open QC</button></div>' : ''}`;
  /* 5 Shipping */
  const s5 = `<table><tr><th>SKU</th><th>Into Finished Goods</th><th>Handed to shipping</th></tr>${L.map(x => `<tr><td>${esc(x.r.sku)}</td><td>${p1N(x.s.india)} of ${p1N(x.r.qty)}</td><td>${x.r.handedAt ? esc(p1Day(ptIsoDate(x.r.handedAt))) + (x.r.handedBy ? ' · ' + esc(p1Who(x.r.handedBy)) : '') : '—'}</td></tr>`).join('')}</table>
    ${at === 4 ? `<div class="acts"><button type="button" class="btn okb" data-p1do="next">${esc(nx[0])}</button></div>` : ''}`;
  const ev = [];
  L.forEach(x => { const p = x.s.plan, b = x.r.ppcBack;
    if (p && p.at) ev.push([String(p.at), p.by, `planned <b>${esc(x.r.sku)}</b>${p1Route(x.s) ? ' · ' + esc(p1Route(x.s)) : ''}${p.printer ? ' · ' + esc(p.printer) : ''}${p.dates && p.dates.ready ? ' · ready by ' + esc(p1Day(p.dates.ready)) : ''}`]);
    if (b && b.at) ev.push([String(b.at), b.by, `sent <b>${esc(x.r.sku)}</b> back to sales${b.note ? ' · “' + esc(b.note) + '”' : ''}`]);
    (b && b.log || []).forEach(l => l && l.at && ev.push([String(l.at), l.by, esc(l.what || l.why || 'sent again')]));
    if (x.r.handedAt) ev.push([String(x.r.handedAt), x.r.handedBy, `handed <b>${esc(x.r.sku)}</b> to shipping`]);
    if (x.r.openIso) ev.push([x.r.openIso, '', `<b>${esc(x.r.sku)}</b> came on the order book`]); });
  ev.sort((a, b) => b[0].localeCompare(a[0]));
  const m = p1Mat(o, rc, acc);
  return `<div class="dh"><h2>${esc(o.no)}</h2>${p1Flags(o)}<span class="av-pill ${m[0]}">${m[1]}</span><span class="meta">${o.buyer ? esc(o.buyer) + ' · ' : ''}${p1N(o.pcs)} pcs${o.due ? ' · ready by ' + esc(p1Day(o.due)) : ''}</span><span class="sp"></span><button type="button" class="btn" data-p1j>Full journey</button></div>
    <div class="next"><span class="t"><small>Next step</small><b>${esc(nx[0])}</b></span><span class="sp"></span><span style="font-size:12px;color:var(--brand-ink)">${esc(P1_STAGES[at][1])}</span><button type="button" class="btn pri" data-p1do="next">${esc(nx[0])}</button></div>
    <div class="lines"><table><tr><th>SKU</th><th>Pcs</th><th>Where this line is</th><th></th><th>Route</th></tr>${L.map(x => { const st = P1_OF[x.s.bucket];
      return `<tr><td>${esc(x.r.sku)}</td><td>${p1N(x.r.qty)}</td><td><div class="mini">${p1Bar(st)}</div></td><td style="color:var(--muted)">${esc(p1Says(x.s))}</td><td style="color:var(--muted)">${esc(p1Route(x.s) || '—')}</td></tr>`; }).join('')}</table></div>
    ${sec(0, 'Orders', at > 0 ? 'Planned' + (plan0 && plan0.plan.by ? ' by ' + esc(p1Who(plan0.plan.by)) : '') : L.some(x => x.s.bucket === 'back') ? 'Sent back to sales' : 'Waiting for a plan', s1)}
    ${sec(1, 'Requirement', at > 1 ? 'Fabric and accessories arranged' : plan0 ? 'Fabric or accessories still to arrange' : 'Stock vs need, and the route', s2)}
    ${sec(2, 'Allotment & making', at > 2 ? 'Made' : at === 2 ? esc([...new Set(L.filter(x => P1_OF[x.s.bucket] === 2).map(x => p1Says(x.s)))].join(', ')) : 'Printer, cutting, karigars', s3)}
    ${sec(3, 'QC', at > 3 ? 'Passed' : at === 3 ? `${p1N(L.reduce((s, x) => s + x.s.qc, 0))} of ${p1N(o.pcs)} passed` : 'After the karigars', s4)}
    ${sec(4, 'Shipping', at === 4 ? esc([...new Set(L.filter(x => P1_OF[x.s.bucket] === 4).map(x => p1Says(x.s)))].join(', ')) : 'After QC', s5)}
    <div class="hist"><div class="lab">On record</div>${ev.map(h => `<div class="hi"><span class="dot"><span class="av">${esc(p1Ini(h[1]))}</span></span><p>${h[1] ? '<b>' + esc(p1Who(h[1])) + '</b> ' : ''}${h[2]} <small>· ${esc(h[0].replace('T', ' ').slice(0, 16))}</small></p></div>`).join('') || '<div class="foot">Nothing on record yet.</div>'}</div>`;
}

function p1Draw() {
  const el = $('p1Home'); if (!el || !P1.shown) return;
  if (P1.loading && !P1.built) { el.innerHTML = '<div class="p1-top"><h1>PPC</h1><span class="sub0">Reading the order book, plans and store…</span></div>'; return; }
  let all = [];
  try { all = p1Orders(); } catch (e) { el.innerHTML = `<div class="p1-top"><h1>PPC</h1><span class="sub0" style="color:var(--bad)">Could not read the lines: ${esc(e.message || e)}</span></div>`; return; }
  const rc = p1Cover(), acc = p1Acc();
  all.forEach(o => { o.short = o.short || p1Mat(o, rc, acc)[0] === 'a-na'; });
  const tile = P1_TILES.find(t => t[0] === P1.tile);
  const list = P1.list = all.filter(o => (P1.stage < 0 || o.stage === P1.stage) && (!tile || tile[5](o)));
  if (!all.some(o => o.no === P1.sel)) P1.sel = list[0] ? list[0].no : '';
  const cur = all.find(o => o.no === P1.sel);
  el.innerHTML = `<div class="p1-top"><h1>PPC</h1><span class="sub0">${p1N(all.length)} orders in production · ${p1N(all.reduce((s, o) => s + o.pcs, 0))} pcs</span>
      <span class="when">${P1.loading ? 'Reading…' : 'Last read ' + (P1.at || '—')} · <a data-p1r>↻ Refresh</a></span></div>
    <div class="now">${P1_TILES.map(t => `<button type="button" class="nc${P1.tile === t[0] ? ' on' : ''}" data-p1s="${t[0]}"><span class="ic" style="background:${t[2]}">${t[1]}</span><span><em>${p1N(all.filter(t[5]).length)}</em><small><b style="color:var(--ink)">${t[3]}</b> · ${t[4]}</small></span><span class="go">See ›</span></button>`).join('')}</div>
    <div class="strip">${P1_STAGES.map((s, i) => { const os = all.filter(o => o.stage === i), lt = os.filter(o => o.late).length;
      return `<button type="button" class="sg${P1.stage === i ? ' on' : ''}" data-p1g="${i}" title="${esc(s[1])}"><span class="n">${i + 1}</span><b>${esc(s[0])}</b>${lt ? `<span class="rk">${lt} late</span>` : ''}<em>${p1N(os.length)}</em></button>`; }).join('')}</div>
    <div class="panes"><div class="box">${p1LeftH(all, list, rc, acc)}</div><div class="box">${p1DetailH(cur, rc, acc)}</div></div>`;
  p1Wire(el, all, cur);
}
function p1Wire(el, all, cur) {
  const keysOf = (os, bucket) => [].concat(...os.map(o => o.lines.filter(x => x.s.bucket === bucket).map(x => x.s.key)));
  const ticked = () => all.filter(o => P1.tick.has(o.no));
  const on = (sel, fn, ev = 'onclick') => el.querySelectorAll(sel).forEach(b => { b[ev] = e => fn(b, e); });
  on('[data-p1s]', b => { P1.tile = P1.tile === b.dataset.p1s ? '' : b.dataset.p1s; P1.stage = -1; P1.lt = 'o'; p1Draw(); });
  on('[data-p1g]', b => { P1.stage = P1.stage === +b.dataset.p1g ? -1 : +b.dataset.p1g; P1.tile = ''; P1.lt = 'o'; p1Draw(); });
  on('[data-p1l]', b => { P1.lt = b.dataset.p1l; p1Draw(); });
  on('[data-p1clr]', () => { P1.tile = ''; P1.stage = -1; p1Draw(); });
  on('[data-p1all]', () => { P1.all = true; p1Draw(); });
  on('[data-p1sel]', (b, e) => { if (e.target.matches('input')) return; P1.sel = b.dataset.p1sel; P1.secs = new Set(); if (P1.lt === 'a') P1.lt = 'o'; p1Draw(); });
  on('[data-p1k]', b => { b.checked ? P1.tick.add(b.dataset.p1k) : P1.tick.delete(b.dataset.p1k); p1Draw(); }, 'onchange');
  on('[data-p1sec]', b => { const i = +b.dataset.p1sec, open = !b.parentNode.classList.contains('shut');
    P1.secs.delete(i); P1.secs.delete(-1 - i); if (open) P1.secs.add(-1 - i); else P1.secs.add(i); b.parentNode.classList.toggle('shut'); });
  on('[data-p1go]', b => { p1Hide(); FLOW_VIEW = b.dataset.p1go; showTab('flow'); });
  on('[data-p1j]', () => cur && ordJourney(cur.no));
  on('[data-p1do]', b => { if (!cur) return; const d = b.dataset.p1do;
    if (d === 'next') p1Next(cur)[2]();
    else if (d === 'plan') flowPpcOpen(cur.no);
    else if (d === 'edit') { const x = cur.lines.find(l => l.s.plan); if (x) flowPpcOpen(cur.no, x.r.sku); }
    else if (d === 'back') flowBackOpen(keysOf([cur], 'ppc')); });
  on('[data-p1tp]', () => { const k = keysOf(ticked(), 'ppc'); if (k.length) flowPpcOpen(null, null, k); else ptOpenDialog({ title: 'Nothing to plan', note: 'None of the ticked orders has a line waiting for a plan.', saveLabel: 'OK', onSave: () => '' }); });
  on('[data-p1tb]', () => { const k = keysOf(ticked(), 'ppc'); if (k.length) flowBackOpen(k); });
  on('[data-p1tc]', () => { P1.tick.clear(); p1Draw(); });
  on('[data-p1r]', (b, e) => { e.preventDefault(); p1Load(true); });
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
