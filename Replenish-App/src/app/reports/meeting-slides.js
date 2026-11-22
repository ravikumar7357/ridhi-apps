/* ================= PRODUCTION MEETING — PRESENT AS SLIDES =================
 * Ravi, 18 Nov 2026: "ok make a meeting screen refine this is like PPT" — the agenda set in the meeting:
 *   1. Production report card — FBA, B2B, Shopify: overall production, orders delayed, pending orders; status (printing, fabric,
 *      stitching, QC, press, touching, spotting); challenges; initiative
 *   2. People — top 3 performers to recognise, bottom 3 to highlight (average up / down), critical vacancies with HR, people
 *      requirement not yet with HR
 *   3. Machines and tools — stitching, pillow, embroidery machines, cutting
 *   4. IT team — feedback, projects
 * Every figure is read from the same registers the meeting report reads (ordLines, the QC register, shpbStages for the stage counts);
 * what no register knows — challenges, initiatives, HR status, machines, IT — is typed on the slide and saved for the week in
 * pt_meeting/<week>/notes (the same store the report's own notes use). Nothing new is written anywhere else.
 * Opens from "Present" on the meeting report; ← → or the buttons move between slides, Esc closes. */

const MTS_CH = [
  { k: 'FBA', name: 'FBA — Amazon', test: c => c === 'AMZ', color: '#B45309' },
  { k: 'B2B', name: 'B2B', test: c => c === 'B' || c === 'B2B', color: '#2F6FE0' },   // B2B-… order numbers (mtgChan keeps 'B2B')
  { k: 'SHOP', name: 'Shopify', test: c => c === 'SHP' || c === 'ONL' || c === 'SPY', color: '#15803D' },
];
let MTS = { i: 0, slides: [], wk: '' };

/** One channel's card: QC passed this week (and last), orders delayed, pending, and where the open pieces wait. */
function mtsChannel(ch, wk) {
  const from = mtgMs(wk), to = from + 7 * 864e5, today = repWkIso(new Date());
  const ofCh = no => ch.test(mtgChan(no));
  let qc = 0, qcPrev = 0;
  repQcRows().forEach(r => {
    if (!r || !ofCh(r.orderNo || r.order || '')) return;
    const ms = ptDtMs(r.date); if (!ms) return;
    if (ms >= from && ms < to) qc += ptNum(r.ok); else if (ms >= from - 7 * 864e5 && ms < from) qcPrev += ptNum(r.ok);
  });
  const dueIx = (typeof SOX !== 'undefined' && SOX.rows) ? ordDueIndex() : new Map();
  const open = ordLines().filter(l => l.open && ofCh(l.orderNo));
  /* open = every order with a line still open (made pieces not yet handed over too); pending = those with pieces still to make */
  const orders = new Set(), pendOrders = new Set(), lateOrders = new Set(); let pend = 0, latePcs = 0, openPcs = 0;
  open.forEach(l => {
    orders.add(l.orderNo); pend += l.pendingMake || 0; openPcs += +l.qty || 0;
    if ((l.pendingMake || 0) > 0) pendOrders.add(l.orderNo);
    const due = l.mto ? l.mtoDue : (dueIx.get(l.orderNo + '|' + l.sku) || '');
    if (due && due < today && (l.pendingMake || 0) > 0) { lateOrders.add(l.orderNo); latePcs += l.pendingMake; }
  });
  let st = null; try { st = mtsStages(open, l => { const due = l.mto ? l.mtoDue : (dueIx.get(l.orderNo + '|' + l.sku) || ''); return !!(due && due < today); }); } catch (e) { st = null; }
  let spot = 0, touch = 0;
  try { qcDeptRows().forEach(x => { if (!x.left || !ofCh(x.c.orderNo || x.c.order || '')) return; if (/spot/i.test(x.dept)) spot += x.left; else if (/touch/i.test(x.dept)) touch += x.left; }); } catch (e) { /* QC not read */ }
  const stages = st ? [['To plan', st.plan], ['At printer', st.printer], ['Printed, to cut', st.toCut], ['Cut, to issue', st.toIssue], ['Stitching (with karigars)', st.karigar],
    ['Waiting for QC', st.qc], ['Spotting', spot], ['Touching', touch], ['Press (QC passed, not pressed)', st.press]].concat(st.other ? [['On no step yet', st.other]] : []) : [];
  return { qc, qcPrev, orders: orders.size, openPcs, pendOrders: pendOrders.size, pend, late: lateOrders.size, latePcs, stages, byPrinter: st ? st.byPrinter : {} };
}

/* WHERE EACH PIECE IS — ONE PLACE ONLY (18 Nov, first look at the slides: the board's own counts overlap — a piece counted at the
 * printer was counted again at QC — so FBA's stages added up to 2.2 lakh against 1.18 lakh pending). Each line's pieces not yet made
 * are put at the furthest step they have NOT passed: to plan · at the printer · printed but not cut · cut but not issued · with
 * karigars · back but not QC-checked. Press counts only on a line where pressing is recorded at all (Amazon lines are not pressed). */
/* PRINTING, PRINTER BY PRINTER (Ravi, 22 Nov: "kis printer ke pas kitna mal pending% h wo kese pata chalega"): the "Printing" pieces of a
 * line go to its printer (the PPC plan's printer); a line with no plan yet goes to "PPC — not planned". Late = the line is past its due date. */
const MTS_NOPLAN = 'PPC — not planned yet';
function mtsStages(lines, lateOf) {
  const s = { plan: 0, printer: 0, toCut: 0, toIssue: 0, karigar: 0, qc: 0, press: 0, other: 0, byPrinter: {} };
  const P = (name, k, n, late) => { if (!(n > 0)) return; const e = s.byPrinter[name] || (s.byPrinter[name] = { plan: 0, printer: 0, late: 0, lines: 0 }); e[k] += n; e.lines++; if (late) e.late += n; };
  lines.forEach(r => {
    const q = Math.max(0, (+r.qty || 0) - (typeof shpbStockOf === 'function' ? shpbStockOf(r) : 0)), cap = n => Math.max(0, Math.min(q, +n || 0));
    const iss = cap((+r.issued || 0) - (+r.rejected || 0)), rec = cap(r.received), qc = cap(r.pressed), cut = r.cutReq ? cap(r.cut) : null;
    const fl = typeof shpbFlowOf === 'function' ? shpbFlowOf(r) : null, past = Math.max(cut || 0, iss, rec, qc);
    const back = fl ? Math.min(q, Math.max(+fl.back || 0, past)) : q;
    /* THE LINE'S OWN "STILL TO MAKE" IS THE TOTAL (second look, 18 Nov: FBA still summed to 1.5 lakh against 1.18 lakh pending — old
     * lines carry receipts and printer figures from before the flow). The pieces still to make are placed from the furthest step back:
     * waiting for QC first, then with karigars, cut to issue, printed to cut, at the printer, to plan — each taking no more than is left. */
    let left = Math.max(0, +r.pendingMake || 0);
    const take = (k, v) => { const t = Math.min(left, Math.max(0, v)); s[k] += t; left -= t; };
    const isLate = typeof lateOf === 'function' && lateOf(r);
    if (typeof shpbGated === 'function' && shpbGated(r)) { const a = left; take('plan', q - qc); P(MTS_NOPLAN, 'plan', a - left, isLate); return; }
    const cutDone = cut == null ? back : Math.max(cut, iss);
    take('qc', rec - qc);
    take('karigar', iss - Math.max(rec, qc));
    take('toIssue', cutDone - Math.max(iss, rec, qc));
    take('toCut', back - cutDone);
    { const a = left; take('printer', q - back); P((typeof shpbPrinterOf === 'function' && shpbPrinterOf(r)) || '(printer not named on the plan)', 'printer', a - left, isLate); }
    s.other += left;                                  // still to make, but on no step the registers show
    const prsBy = ((typeof SHPB !== 'undefined' && SHPB.pressBy) || {})[typeof shpbKey === 'function' ? shpbKey(r.orderNo, r.sku) : ''] || {};
    if (+prsBy.pcs > 0) s.press += Math.max(0, qc - Math.min(qc, +prsBy.pcs));
  });
  return s;
}

/** Karigars by QC-passed pieces this week, with their average of the four weeks before (up / down). */
/* WHO IS TOP, WHO IS BOTTOM — FAIRLY (Ravi, 18 Nov: "top 3 performer kis base par … kya isne sabhi article banay h, quality product banay h,
 * kanhi 2 logo ne milkar kam to nahi kya … bottom 3 ke liye check karna ki kanhi wo last week me off par to nahi the"; rule picked: 5%).
 *   · only piece-rate karigars (empType "Company Contractor"): the contractor's team, embroidery vendors and salaried staff are not ranked
 *   · work = QC-passed pieces × that article's job work rate (₹) — a quilt is not one napkin
 *   · quality = (rejected + for alteration) ÷ checked
 *   · active days = days with a Job Work issue or receipt in the week (attendance is not kept, so this stands in for "was he in")
 *   Top 3: 3+ active days, quality 5% or better, most work a day. Bottom 3: 3+ active days, least work a day. Average = the four weeks before. */
/* quality limit for the top 3 — OFF (Ravi, 22 Nov: "quality ki seema 5% live mat karna abhi"); put 5 back to turn it on */
const MTS_BAD_MAX = null, MTS_MIN_DAYS = 3;
let MTS_RATES = null;
async function mtsRatesLoad() {
  if (MTS_RATES) return;
  try { MTS_RATES = ptList(await ptGet('pt_rateList')).map(r => (Array.isArray(r) ? r : (r && Array.isArray(r.value) ? r.value : []))).filter(x => x.length && x[1]); }
  catch (e) { MTS_RATES = []; }
}
function mtsRate(at, sub, size) {
  const N = x => String(x == null ? '' : x).trim().toLowerCase(), L = MTS_RATES || [], ap = 'company contractor';
  const r = L.find(x => N(x[0]) === N(at) && N(x[1]) === N(sub) && N(x[2]) === N(size) && N(x[3]) === ap)
    || L.find(x => N(x[1]) === N(sub) && N(x[2]) === N(size) && N(x[3]) === ap) || L.find(x => N(x[1]) === N(sub) && N(x[3]) === ap);
  return r ? (parseFloat(r[4]) || 0) : 0;
}
/* KARIGARS WHO WORK TOGETHER (Ravi, 22 Nov: "koi koi karegar group me kam karte h like hareram and shriram mujhe inke liye option do").
 * Kept beside the meeting's notes: pt_meeting/_groups/<id> = { name, members: [names], at, by } (a list ERP data already knows).
 * A group is ranked as ONE line: its members' QC-passed work added up, divided by ALL its members' active days — two people
 * whose work is entered under one name are no longer a "top performer" doing two people's work. */
const mtsGroups = () => Object.entries(((MTG.meet || {})._groups) || {}).filter(([, g]) => g && Array.isArray(g.members) && g.members.length)
  .map(([id, g]) => ({ id, name: String(g.name || '').trim(), members: g.members.map(m => String(m).trim()).filter(Boolean) }));
function mtsPeople(wk) {
  const from = mtgMs(wk), to = from + 7 * 864e5, b4 = from - 28 * 864e5;
  const type = new Map(), days = new Map();
  (PT.base || []).forEach(r => {
    if (!r || !r.empName) return;
    type.set(r.empName, r.empType || '');
    const add = ms => { if (ms >= from && ms < to) { const d = new Date(ms).toDateString(); (days.get(r.empName) || days.set(r.empName, new Set()).get(r.empName)).add(d); } };
    add(ptDtMs(r.issueDate));
    (typeof repRecvParts === 'function' ? repRecvParts(r) : []).forEach(x => add(x.ms));
  });
  const now = new Map(), before = new Map();
  repQcRows().forEach(r => {
    if (!r || !r.karigar || qaApart(r)) return;
    const ms = ptDtMs(r.date); if (!ms || ms < b4 || ms >= to) return;
    const ok = ptNum(r.ok), val = ok * mtsRate(r.articleType, r.subtype, r.size);
    if (ms < from) { before.set(r.karigar, (before.get(r.karigar) || 0) + val); return; }
    const e = now.get(r.karigar) || { k: r.karigar, pcs: 0, val: 0, bad: 0, chk: 0, arts: new Set() };
    e.pcs += ok; e.val += val; e.bad += ptNum(r.rejected) + ptNum(r.forAlteration);
    e.chk += ptNum(r.checked) || (ok + ptNum(r.rejected) + ptNum(r.forAlteration)); e.arts.add(r.subtype || r.articleType || '');
    now.set(r.karigar, e);
  });
  /* one line per group: work and quality added up, days = every member's active days (person-days) */
  const N = x => String(x || '').trim().toLowerCase(), groupOf = new Map();
  mtsGroups().forEach(g => g.members.forEach(m => groupOf.set(N(m), g)));
  const merged = new Map();
  [...now.values()].forEach(e => {
    const g = groupOf.get(N(e.k)); if (!g) { merged.set('k:' + e.k, e); return; }
    const key = 'g:' + g.id, m = merged.get(key) || { k: g.name || g.members.join(' + '), group: g, pcs: 0, val: 0, bad: 0, chk: 0, arts: new Set() };
    m.pcs += e.pcs; m.val += e.val; m.bad += e.bad; m.chk += e.chk; e.arts.forEach(a => m.arts.add(a)); merged.set(key, m);
  });
  const isCC = e => e.group ? true : /company contractor/i.test(type.get(e.k) || '');
  const daysOf = e => e.group ? e.group.members.reduce((t, n) => t + (days.get(n) || new Set()).size, 0) : (days.get(e.k) || new Set()).size;
  const beforeOf = e => e.group ? e.group.members.reduce((t, n) => t + (before.get(n) || 0), 0) : (before.get(e.k) || 0);
  const rows = [...merged.values()].filter(isCC).map(e => {
    const d = daysOf(e);
    return Object.assign(e, { days: d, perDay: d ? e.val / d : 0, badPct: e.chk ? Math.round(e.bad / e.chk * 1000) / 10 : 0, avg: Math.round(beforeOf(e) / 4), arts: e.arts.size,
      dayTxt: e.group ? e.group.members.map(n => (days.get(n) || new Set()).size).join(' + ') : '' });
  });
  const active = rows.filter(r => r.days >= MTS_MIN_DAYS);
  /* both ends by work A DAY (18 Nov, first look: ranked by the week's total, a 4-day karigar below the team a day sat in the top 3) */
  const top = active.filter(r => MTS_BAD_MAX == null || r.badPct <= MTS_BAD_MAX).sort((a, b) => b.perDay - a.perDay).slice(0, 3);
  const bottom = active.filter(r => !top.includes(r)).sort((a, b) => a.perDay - b.perDay).slice(0, 3);
  /* THE TEAM AVERAGE BESIDE EACH NAME (Ravi, 18 Nov: "top 3 top me h to kyo h — unka data dikhana chahiye ki ave logo se inhone itne jyada
   * pcs banay h and inka quality score bhi sahi h ya galat h, same for bottom 3"): per active day, over every karigar who was active 3+ days. */
  const n = active.length || 1, sum = k => active.reduce((t, r) => t + k(r), 0);
  const team = { n: active.length, pcsDay: sum(r => r.pcs / r.days) / n, valDay: sum(r => r.perDay) / n,
    badPct: (() => { const c = sum(r => r.chk); return c ? Math.round(sum(r => r.bad) / c * 1000) / 10 : 0; })() };
  /* EVERY KARIGAR, for the slide where groups are made (Ravi chose design C, 22 Nov): a group row carries each member's own figures */
  const nowN = new Map([...now.values()].map(e => [N(e.k), e])), artsN = a => typeof a === 'number' ? a : (a ? a.size : 0);
  rows.forEach(r => { if (r.group) r.parts = r.group.members.map(n => { const e = nowN.get(N(n)); return { k: n, pcs: e ? e.pcs : 0, days: (days.get(n) || new Set()).size, arts: e ? artsN(e.arts) : 0 }; }); });
  const all = rows.slice().sort((a, b) => b.pcs - a.pcs);
  return { top, bottom, team, all, n: rows.length, left: rows.filter(r => r.days < MTS_MIN_DAYS).length, noRate: !(MTS_RATES || []).length };
}
/* who can be put in a group: piece-rate (Company Contractor) karigars with a Job Work issue in the last 8 weeks — this includes a partner
 * like Shriram whose pieces are entered under someone else's name, so he has no QC line of his own */
function mtsGroupNames() {
  const since = Date.now() - 56 * 864e5, names = new Map();
  (PT.base || []).forEach(r => { if (r && r.empName && /company contractor/i.test(r.empType || '') && ptDtMs(r.issueDate) >= since) { const n = String(r.empName).trim(); names.set(n.toLowerCase(), n); } });
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/* ---------- drawing ---------- */
const mtsNum = (v, sub, col) => `<div class="mts-num"><b style="color:${col || 'var(--ink)'}">${v}</b><span>${sub}</span></div>`;
function mtsNote(wk, key, label, rows) {
  const n = (((MTG.meet || {})[wk] || {}).notes || {})[key] || '', can = mtgCanWrite();
  return `<label class="mts-note"><span>${esc(label)}</span><textarea data-mtsnote="${esc(key)}" rows="${rows || 3}" ${can ? '' : 'disabled'} placeholder="${can ? 'Type here — saved for this week' : ''}">${esc(n)}</textarea></label>`;
}
/* AS THE SHEET HAS IT (Ravi, 18 Nov: "mujhe production meeting me ye nahi chahiye — mujhe chahiye jo excel me mene point bheje the as it
 * as"). No cover, no agenda, no action points: the four parts of his sheet, each laid out as the sheet lays it out —
 *   Production Report Card: a row each for FBA, B2B, Shopify · overall production, orders delayed, pending orders · Status (printing,
 *     fabric, stitching, QC, press, touching, spotting) · Challenges (printing issue, fabric issue, people issue) · Initiative
 *   People Discussion: top 3 performers to recognise (average up / down) · bottom 3 to highlight · critical vacant positions with HR —
 *     status · people requirement not yet with HR — status (discuss with Srikant ji, Mukul sir first)
 *   Machine and Tools discussion: stitching machine · pillow machine · embroidery machine · cutting
 *   IT Team: feedback · projects */
function mtsSlides(wk) {
  const out = [];
  /* 1 · Production Report Card — one table, a row per channel */
  const head = ['', 'Open orders · orders delayed · pending orders', 'Status (printing, fabric, stitching, Q.C., press, touching, spotting)', 'Challenges', 'Initiative'];
  const rows = MTS_CH.map(ch => {
    let c = null; try { c = mtsChannel(ch, wk); } catch (e) { c = null; }
    if (!c) return `<tr><th style="color:${ch.color}">${esc(ch.k === 'SHOP' ? 'Shopify' : ch.k)}</th><td colspan="4" class="err">Could not be worked out.</td></tr>`;
    const v = l => { const x = c.stages.find(s => s[0] === l); return x ? x[1] : 0; };
    const status = [['Printing', v('To plan') + v('At printer')], ['Fabric', v('Printed, to cut') + v('Cut, to issue')], ['Stitching', v('Stitching (with karigars)')],
      ['Q.C.', v('Waiting for QC')], ['Press', v('Press (QC passed, not pressed)')], ['Touching', v('Touching')], ['Spotting', v('Spotting')]];
    /* 18 Nov (Ravi): "overall production ko remove karo" — open orders, delayed, pending; no production figure here */
    return `<tr><th style="color:${ch.color}">${esc(ch.k === 'SHOP' ? 'Shopify' : ch.k)}</th>
      <td><div class="mts-kv"><span>Total open orders</span><b>${nf(c.orders)}</b><em>${nf(c.openPcs)} pcs ordered</em></div>
        <div class="mts-kv"><span>Orders delayed</span><b style="color:${c.late ? 'var(--bad)' : '#166534'}">${nf(c.late)}</b><em>${nf(c.latePcs)} pcs</em></div>
        <div class="mts-kv"><span>Pending orders</span><b>${nf(c.pendOrders)}</b><em>${nf(c.pend)} pcs to make</em></div></td>
      <td>${status.map(([l, n]) => `<div class="mts-kv"><span>${l}</span><b>${nf(Math.round(n))}</b></div>`).join('')}</td>
      <td>${mtsNote(wk, 'ch_' + ch.k, ch.k === 'FBA' ? 'printing issue, fabric issue, people issue' : '', 6)}</td>
      <td>${mtsNote(wk, 'in_' + ch.k, '', 6)}</td></tr>`;
  });
  out.push({ t: 'Production Report Card', html: `<table class="mts-sheet"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>
    <div class="muted" style="font-size:12px;margin-top:6px">open orders = a line not yet handed over · pending = pieces still to make · status = those pieces, each at the one step it waits at</div>` });
  /* 1b · Printing, printer by printer — the report card's "Printing" figure split */
  const pr = new Map();
  MTS_CH.forEach(ch => { let c = null; try { c = mtsChannel(ch, wk); } catch (e) { c = null; } if (!c) return;
    Object.entries(c.byPrinter || {}).forEach(([n, e]) => { const x = pr.get(n) || { n, tot: 0, late: 0, lines: 0, ch: {} }; const t = e.plan + e.printer;
      x.tot += t; x.late += e.late; x.lines += e.lines; x.ch[ch.k] = (x.ch[ch.k] || 0) + t; pr.set(n, x); }); });
  /* WHAT THE PRINTER SAYS IT SENT, NOT YET RECEIVED (22 Nov, Ravi compared his Bagru download: 28,272 m after "Vendor sent"): per printer
   * order line, the printer's own sent batches (vpVsSum) less what has come in here (accepted deliveries), turned into pieces with the
   * line's own pieces-per-metre (forOrders); a cut-piece line is in pieces already. */
  const sentNR = new Map(), lo = x => String(x || '').trim().toLowerCase();
  try {
    (VO.rows || []).forEach(o => {
      if (!o || /cancel|received/i.test(o.status || '')) return;
      const run = o.orderType === 'running' || voLines(o).some(l => +l.meters > 0), name = lo(voName(o.vendorCode));
      /* per order: sent (the portal's own sum, line by line) less what came back — the flow's printed-cloth receipts (flowProg.back),
       * else the accepted deliveries; in pieces at the order's own pieces per metre */
      let vs = 0, dels = 0, base = 0, pcsFor = 0;
      voLines(o).forEach(l => { if (!l || l.cancelled) return; vs += vpVsSum(vpVsOf(o, l)); dels += voDels(l).reduce((t, x) => t + (+vlQtyOf(x) || 0), 0);
        const b = run ? +l.meters || 0 : +l.qty || 0; base += b; pcsFor += (l.forOrders || []).reduce((t, x) => t + (+x.qty || 0), 0) || b; });
      const recv = o.flowProg && o.flowProg.back != null ? Math.max(+o.flowProg.back || 0, dels) : dels, gap = Math.max(0, Math.min(base, vs) - recv);
      if (!(gap > 0)) return;
      const pcs = run ? (base ? pcsFor * gap / base : 0) : gap;
      sentNR.set(name, (sentNR.get(name) || 0) + pcs);
    });
  } catch (e) { /* vendor orders not read: the column says — */ }
  const sentOf = n => sentNR.has(lo(n)) ? sentNR.get(lo(n)) : null;
  const prRows = [...pr.values()].sort((a, b) => (a.n === MTS_NOPLAN) - (b.n === MTS_NOPLAN) || b.tot - a.tot);
  const prTot = prRows.reduce((t, x) => t + x.tot, 0) || 1;
  out.push({ t: 'Printing — pending by printer', html: `<table class="mts-cmp" style="font-size:15px"><thead><tr><th>Printer</th><th>FBA</th><th>B2B</th><th>Shopify</th><th>Pieces pending</th><th>% of printing</th><th>Printer says sent, not received</th><th>Still at printer</th><th>Of which late</th><th>Late %</th></tr></thead><tbody>`
    + prRows.map(x => `<tr${x.n === MTS_NOPLAN ? ' style="background:#FFF7EB"' : ''}><td><b>${esc(x.n)}</b></td><td>${nf(Math.round(x.ch.FBA || 0))}</td><td>${nf(Math.round(x.ch.B2B || 0))}</td><td>${nf(Math.round(x.ch.SHOP || 0))}</td>`
      + `<td><b>${nf(Math.round(x.tot))}</b></td><td>${Math.round(x.tot / prTot * 100)}%</td>`
      + (() => { const sn = x.n === MTS_NOPLAN ? null : sentOf(x.n), snr = sn == null ? null : Math.min(x.tot, sn);
          return `<td style="color:#1D4ED8">${snr == null ? '<span class="muted">—</span>' : nf(Math.round(snr))}</td><td>${snr == null ? '<span class="muted">—</span>' : nf(Math.round(x.tot - snr))}</td>`; })()
      + `<td style="color:${x.late ? 'var(--bad)' : 'inherit'}">${nf(Math.round(x.late))}</td><td>${x.tot ? Math.round(x.late / x.tot * 100) : 0}%</td></tr>`).join('')
    + `<tr class="mts-team"><td>Total</td><td colspan="3"></td><td>${nf(Math.round(prTot))}</td><td>100%</td><td></td><td></td><td>${nf(Math.round(prRows.reduce((t, x) => t + x.late, 0)))}</td><td></td></tr></tbody></table>
    <div class="muted" style="font-size:12px;margin-top:6px">pieces still to make whose printed cloth is not back from the printer, by the printer on the PPC plan · "${esc(MTS_NOPLAN)}" = no plan yet, so no printer · "printer says sent, not received" = the printer's own Vendor sent entries not yet received here, in pieces (metres × that line's pieces per metre) — the printer's download minus Vendor sent counts these as done · late = the order line is past its due date · the same figures as "Printing" on the report card</div>`
    + mtsNote(wk, 'printers', 'Printer follow-up', 3) });
  /* 2 · People Discussion */
  const P = mtsPeople(wk), rs = v => '₹' + nf(Math.round(v));
  const T = P.team, pct = (v, avg) => avg ? Math.round((v - avg) / avg * 100) : 0;
  const vs = (v, avg, goodHigh) => { const p = pct(v, avg), good = goodHigh ? p >= 0 : p <= 0;
    return `<span style="color:${good ? '#166534' : 'var(--bad)'};font-weight:700">${p >= 0 ? '+' : '−'}${Math.abs(p)}%</span>`; };
  const qVs = b => { const d = Math.round((b - T.badPct) * 10) / 10, good = b <= T.badPct;
    return `<span style="color:${good ? '#166534' : 'var(--bad)'};font-weight:700">${good ? 'better' : 'worse'} by ${Math.abs(d)}</span>`; };
  /* 22 Nov (Ravi): "Work ₹ a day", its "vs team" and "vs own 4-week avg" taken off the slide. The ranking itself is unchanged (work = pcs ×
   * job work rate, so a quilt and a napkin are not the same piece); a group shows its members and their days. */
  const ptable = list => list.length ? `<table class="mts-cmp"><thead><tr><th>Karigar</th><th>Pcs a day</th><th>vs team</th><th>Quality (rej + alt)</th><th>vs team</th><th>Days</th><th>Articles</th></tr></thead><tbody>`
      + list.map(r => { const pd = r.days ? r.pcs / r.days : 0;
        return `<tr><td><b>${esc(r.k)}</b>${r.group ? `<div class="muted" style="font-size:11px">group · ${esc(r.group.members.join(', '))}</div>` : ''}</td><td>${nf(Math.round(pd))}</td><td>${vs(pd, T.pcsDay, true)}</td>`
          + `<td>${r.badPct}%</td><td>${qVs(r.badPct)}</td><td>${r.group ? esc(r.dayTxt) : nf(r.days)}</td><td>${nf(r.arts)}</td></tr>`; }).join('')
      + `<tr class="mts-team"><td>Team average (${nf(T.n)} karigars)</td><td>${nf(Math.round(T.pcsDay))}</td><td></td><td>${T.badPct}%</td><td></td><td colspan="2"></td></tr></tbody></table>`
    : '<span class="muted">Nobody meets the rule this week.</span>';
  /* A FROZEN WEEK SHOWS WHAT THE MEETING SAW (22 Nov: "last week ka data save kha hoga"): Freeze keeps the two lists (mtgFreeze). */
  const fzP = (((MTG.meet || {})[wk] || {}).frozen || {}).people;
  const tableOf = which => fzP && fzP[which] ? fzP[which] : ptable(P[which]);
  out.push({ t: 'People Discussion', html: `<table class="mts-sheet"><tbody>
      <tr><th style="background:#E5F4E4">Top 3 performer for last week that I want to recognize</th><td>${fzP ? `<div class="muted" style="font-size:11.5px;margin-bottom:4px">as frozen ${esc(fzP.at || '')}</div>` : ''}${tableOf('top')}</td></tr>
      <tr><th>Bottom 3 performers that I want to highlight</th><td>${tableOf('bottom')}<div class="muted" style="font-size:11.5px;margin-top:4px">How chosen: piece-rate karigars only (not the contractor's team, embroidery vendors or salaried staff) · work = QC-passed pcs × job work rate · top = ${MTS_MIN_DAYS}+ days active, ${MTS_BAD_MAX == null ? '' : 'quality ' + MTS_BAD_MAX + '% or better, '}most work a day · bottom = ${MTS_MIN_DAYS}+ days active, least work a day · active = a Job Work issue or receipt that day (attendance is not kept) · karigars who work together: Production meeting → Karigar groups — a group is one line, its days added up${mtsGroups().length ? ' (' + mtsGroups().map(g => esc(g.name || g.members.join(' + '))).join('; ') + ')' : ''}${P.left ? ' · ' + nf(P.left) + ' karigar(s) under ' + MTS_MIN_DAYS + ' days left out' : ''}${P.noRate ? ' · <b style="color:var(--bad)">job work rates could not be read</b>' : ''}</div></td></tr>
      <tr><th>Critical vacant position with HR</th><td>${mtsNote(wk, 'hr_vacant', 'Status', 3)}</td></tr>
      <tr><th>People Requirement not yet with HR</th><td>${mtsNote(wk, 'hr_need', 'Status (discuss with Srikant ji, Mukul sir first)', 3)}</td></tr>
    </tbody></table>` });
  /* 2b · EVERY KARIGAR — groups are made here (design C, 22 Nov): a Group button on each row, a group row shows its members under it */
  const canG = mtgCanWrite(), pdOf = (p, d) => d ? nf(Math.round(p / d)) : '—';
  const grpBtn = r => !canG ? '' : r.group
    ? `<button type="button" class="ghost" data-mtsgedit="${esc(r.group.id)}" style="padding:3px 12px;font-size:12.5px;border-color:#1D4ED8;color:#1D4ED8">Edit group</button>`
    : `<button type="button" class="ghost" data-mtsgnew="${esc(r.k)}" style="padding:3px 12px;font-size:12.5px">Group…</button>`;
  const everyRows = (P.all || []).map(r => r.group
    ? `<tr style="background:#EEF3FE"><td><b>${esc(r.k)}</b> <span style="font-size:11.5px;color:#1D4ED8;background:#DBE5FB;padding:1px 8px;border-radius:99px">group · ${r.group.members.length}</span></td><td><b>${nf(r.pcs)}</b></td><td><b>${esc(r.dayTxt)}</b></td><td><b>${pdOf(r.pcs, r.days)}</b></td><td><b>${nf(r.arts)}</b></td><td>${grpBtn(r)}</td></tr>`
      + (r.parts || []).map(p => `<tr style="background:#F6F8FE;color:#5B6475;font-size:12.5px"><td style="padding-left:26px">${esc(p.k)}</td><td>${p.pcs ? nf(p.pcs) : '0 in own name'}</td><td>${nf(p.days)}</td><td>—</td><td>${p.arts ? nf(p.arts) : '—'}</td><td></td></tr>`).join('')
    : `<tr><td>${esc(r.k)}</td><td>${nf(r.pcs)}</td><td>${nf(r.days)}</td><td>${pdOf(r.pcs, r.days)}</td><td>${nf(r.arts)}</td><td>${grpBtn(r)}</td></tr>`).join('');
  out.push({ t: 'People — every karigar', html: (P.all || []).length
    ? `<table class="mts-cmp"><thead><tr><th>Karigar</th><th>Pcs</th><th>Days</th><th>Pcs a day</th><th>Articles</th><th></th></tr></thead><tbody>${everyRows}</tbody></table>
      <div class="muted" style="font-size:12px;margin-top:6px">piece-rate karigars, QC-passed pcs this week, most first · days = days with a Job Work issue or receipt · karigars who work together: press Group… on one of them and tick the others — the group becomes one line on the People slide, its days added up · a karigar can be in one group only${fzP ? ' · this week is frozen: the People slide keeps what was frozen, a change here shows from the next week or after Freeze again' : ''}</div>`
    : '<span class="muted">No QC-passed work by piece-rate karigars this week.</span>' });
  /* 3 · Machine and Tools discussion */
  out.push({ t: 'Machine and Tools discussion', html: `<table class="mts-sheet"><tbody>${[['m_stitch', 'Stitching machine'], ['m_pillow', 'Pillow machine'], ['m_emb', 'Embroidery machine'], ['m_cut', 'Cutting']]
    .map(([k, l]) => `<tr><th>${l}</th><td>${mtsNote(wk, k, '', 2)}</td></tr>`).join('')}</tbody></table>` });
  /* 4 · IT Team */
  out.push({ t: 'IT Team', html: `<table class="mts-sheet"><thead><tr><th>Feedback</th><th>Projects</th></tr></thead><tbody><tr>
      <td>${mtsNote(wk, 'it_feedback', '', 10)}</td><td>${mtsNote(wk, 'it_projects', '', 10)}</td></tr></tbody></table>` });
  return out;
}

function mtsDraw() {
  const box = document.getElementById('mtsBox'); if (!box) return;
  const n = MTS.slides.length, s = MTS.slides[MTS.i];
  box.querySelector('.mts-slide').innerHTML = `<div class="mts-title"><span>${esc(s.t)}</span><em>${esc(repWkRange(MTS.wk))} · ${MTS.i + 1} / ${n}</em></div><div class="mts-body">${s.html}</div>`;
  box.querySelector('.mts-dots').innerHTML = MTS.slides.map((x, i) => `<button type="button" data-mtsgo="${i}" class="${i === MTS.i ? 'on' : ''}" title="${esc(x.t)}"></button>`).join('');
}
async function mtsOpen() {
  await mtsRatesLoad();
  const wk = $('repWk').value, brand = $('repBrand').value;
  MTS = { i: 0, slides: mtsSlides(wk, brand), wk };
  let box = document.getElementById('mtsBox');
  if (!box) {
    box = document.createElement('div'); box.id = 'mtsBox';
    box.innerHTML = `<style>
      #mtsBox{position:fixed;inset:0;z-index:9999;background:#E9EDF3;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px}
      #mtsBox .mts-slide{width:min(1280px,100%);aspect-ratio:16/9;max-height:calc(100vh - 90px);background:#fff;border-radius:18px;box-shadow:0 10px 40px rgba(23,32,43,.15);padding:30px 40px;overflow:auto;display:flex;flex-direction:column}
      #mtsBox .mts-title{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #E4E7EC;padding-bottom:10px;margin-bottom:18px}
      #mtsBox .mts-title span{font-size:28px;font-weight:800;color:#17202B}#mtsBox .mts-title em{font-style:normal;color:#5B6475;font-size:14px}
      #mtsBox .mts-body{flex:1;min-height:0}
      #mtsBox .mts-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}
      #mtsBox .mts-num{border:1px solid #E4E7EC;border-radius:14px;padding:14px 16px}#mtsBox .mts-num b{display:block;font-size:38px;line-height:1.1;font-variant-numeric:tabular-nums}#mtsBox .mts-num span{color:#5B6475;font-size:14px}
      #mtsBox .mts-two{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px}
      #mtsBox .mts-grid4{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
      #mtsBox .mts-h{font-weight:800;font-size:16px;margin-bottom:8px;color:#17202B}
      #mtsBox .mts-st{display:grid;grid-template-columns:190px 1fr 70px;gap:10px;align-items:center;margin:7px 0;font-size:15px}
      #mtsBox .mts-st i{height:14px;background:#F1F3F6;border-radius:7px;overflow:hidden;display:block}#mtsBox .mts-st em{display:block;height:100%;border-radius:7px}#mtsBox .mts-st b{text-align:right;font-variant-numeric:tabular-nums}
      #mtsBox .mts-note{display:block;margin-bottom:12px}#mtsBox .mts-note span{display:block;font-weight:700;font-size:14px;color:#17202B;margin-bottom:4px}
      #mtsBox .mts-note textarea{width:100%;font:inherit;font-size:15px;border:1px solid #D5DCE5;border-radius:10px;padding:8px 10px;resize:vertical;background:#FBFCFD}
      #mtsBox .mts-p{display:grid;grid-template-columns:34px 1fr auto auto;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #F1F3F6;font-size:16px}
      #mtsBox .mts-p b{color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px}#mtsBox .mts-p em{font-style:normal;color:#5B6475;font-size:13px}
      #mtsBox .mts-cover{display:flex;flex-direction:column;justify-content:center;height:100%}#mtsBox .mts-kick{letter-spacing:.2em;color:#B45309;font-weight:800;font-size:13px}
      #mtsBox .mts-cover h1{font-size:54px;margin:6px 0 2px;color:#17202B}#mtsBox .mts-range{font-size:22px;color:#5B6475;margin-bottom:24px}
      #mtsBox .mts-agenda{font-size:17px;color:#17202B;line-height:1.8;margin:6px 0 0}
      #mtsBox .mts-bar{height:6px;border-radius:3px;margin:-8px 0 16px;width:120px}
      #mtsBox .mts-tbl{width:100%;border-collapse:collapse;font-size:16px}#mtsBox .mts-tbl th{text-align:left;color:#5B6475;font-size:13px;border-bottom:2px solid #E4E7EC;padding:8px}#mtsBox .mts-tbl td{padding:9px 8px;border-bottom:1px solid #F1F3F6}
      #mtsBox .mts-sheet{width:100%;border-collapse:collapse;font-size:15px;table-layout:fixed}
      #mtsBox .mts-sheet th,#mtsBox .mts-sheet td{border:1.5px solid #17202B;padding:10px 12px;vertical-align:top;text-align:left}
      #mtsBox .mts-sheet thead th{background:#F1F3F6;font-size:14px}#mtsBox .mts-sheet tbody th{font-size:17px;width:22%}
      #mtsBox .mts-sheet .mts-note{margin:0}#mtsBox .mts-sheet .mts-note span:empty{display:none}
      #mtsBox .mts-kv{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;padding:2px 0}#mtsBox .mts-kv span{flex:1;min-width:90px}#mtsBox .mts-kv b{font-size:18px;font-variant-numeric:tabular-nums}#mtsBox .mts-kv em{font-style:normal;font-size:12px;color:#5B6475;flex-basis:100%}
      #mtsBox .mts-cmp{width:100%;border-collapse:collapse;font-size:13.5px}#mtsBox .mts-cmp th{font-size:11.5px;color:#5B6475;text-align:right;padding:4px 6px;border-bottom:1px solid #E4E7EC;font-weight:700}
      #mtsBox .mts-cmp td{padding:5px 6px;text-align:right;border-bottom:1px solid #F1F3F6;font-variant-numeric:tabular-nums}#mtsBox .mts-cmp td:first-child,#mtsBox .mts-cmp th:first-child{text-align:left}
      #mtsBox .mts-cmp .mts-team td{background:#F7F8FA;color:#5B6475;font-weight:700}
      #mtsBox .mts-nav{display:flex;gap:10px;align-items:center;margin-top:12px}#mtsBox .mts-nav>button{width:auto;padding:6px 16px}
      #mtsBox .mts-dots{display:flex;gap:6px}#mtsBox .mts-dots button{width:10px;height:10px;padding:0;border-radius:50%;border:0;background:#C7CED8;box-shadow:none}#mtsBox .mts-dots button.on{background:#17202B}
      @media (max-width:800px){#mtsBox .mts-row{grid-template-columns:repeat(2,1fr)}#mtsBox .mts-two,#mtsBox .mts-grid4{grid-template-columns:1fr}#mtsBox .mts-slide{aspect-ratio:auto;padding:18px}}
      </style><div class="mts-slide"></div><div class="mts-nav"><button type="button" class="ghost" data-mtsnav="-1">← Back</button><div class="mts-dots"></div>
      <button type="button" class="ghost" data-mtsnav="1">Next →</button><button type="button" class="ghost" data-mtsnav="fs">Full screen</button><button type="button" class="ghost" data-mtsnav="x">Close (Esc)</button><span id="mtsMsg" class="muted" style="font-size:12px"></span></div>`;
    document.body.appendChild(box);
    box.addEventListener('click', e => {
      if (mtsGroupClick(e)) return;
      const n = e.target.closest('[data-mtsnav]'), g = e.target.closest('[data-mtsgo]');
      if (g) { MTS.i = +g.getAttribute('data-mtsgo'); return mtsDraw(); }
      if (!n) return;
      const v = n.getAttribute('data-mtsnav');
      if (v === 'x') return mtsClose();
      if (v === 'fs') { try { if (document.fullscreenElement) document.exitFullscreen(); else box.requestFullscreen(); } catch (er) { /* not allowed */ } return; }
      MTS.i = Math.max(0, Math.min(MTS.slides.length - 1, MTS.i + (+v))); mtsDraw();
    });
    box.addEventListener('input', e => {
      const t = e.target; if (!t || t.id !== 'mtsGpFind') return;
      const q = t.value.trim().toLowerCase();
      box.querySelectorAll('[data-mtsgpn]').forEach(l => { l.style.display = !q || l.getAttribute('data-mtsgpn').indexOf(q) >= 0 ? '' : 'none'; });
    });
    box.addEventListener('change', async e => {
      const t = e.target; if (!t || t.getAttribute('data-mtsnote') == null) return;
      const err = await mtgSaveNote(MTS.wk, t.getAttribute('data-mtsnote'), t.value).catch(er => 'Not saved: ' + (er.message || er));
      const m = document.getElementById('mtsMsg'); if (m) { m.className = err ? 'err' : 'muted'; m.textContent = err || 'Saved for this week.'; }
    });
  }
  box.style.display = 'flex';
  mtsDraw();
}
/* THE "WORKS WITH…" PANEL (design C): opened from a row's Group… or Edit group button, drawn inside the slides box (a normal dialog sits
 * under the full-screen slides). Saves to pt_meeting/_groups/<id> = { name, members, at, by }. */
function mtsGroupPanel(html) {
  const box = document.getElementById('mtsBox'); if (!box) return;
  let p = document.getElementById('mtsGp');
  if (!p) { p = document.createElement('div'); p.id = 'mtsGp'; box.appendChild(p);
    p.style.cssText = 'position:fixed;right:28px;top:90px;width:380px;max-width:calc(100vw - 32px);max-height:calc(100vh - 120px);overflow:auto;background:#fff;border:1px solid #C4CAD6;border-radius:14px;box-shadow:0 12px 32px rgba(20,30,60,.22);padding:16px;z-index:2;display:flex;flex-direction:column;gap:10px;font-size:14px;color:#17202B'; }
  if (html == null) { p.remove(); return; }
  p.innerHTML = html;
  const f = document.getElementById('mtsGpFind'); if (f) f.focus();
}
function mtsGroupOpen(who, gid) {
  const groups = mtsGroups(), g = gid ? groups.find(x => x.id === gid) : null;
  const L = s => String(s || '').trim().toLowerCase();
  const inOther = new Map(); groups.forEach(x => { if (!g || x.id !== g.id) x.members.forEach(m => inOther.set(L(m), x.name || x.members.join(' + '))); });
  const mine = new Set((g ? g.members : [who]).map(L));
  const names = mtsGroupNames(); (g ? g.members : [who]).forEach(n => { if (!names.some(x => L(x) === L(n))) names.push(n); });
  const rows = names.filter(n => g || L(n) !== L(who)).map(n => { const o = inOther.get(L(n));
    return `<label data-mtsgpn="${esc(L(n))}" style="display:flex;align-items:center;gap:10px;min-height:34px;${o ? 'color:#6B7487' : ''}"><input type="checkbox" data-mtsgpm="${esc(n)}" ${mine.has(L(n)) ? 'checked' : ''} ${o ? 'disabled' : ''} style="width:18px;height:18px;margin:0">`
      + `<span style="flex:1">${esc(n)}</span>${o ? `<span style="font-size:11.5px">in ${esc(o)}</span>` : ''}</label>`; }).join('');
  mtsGroupPanel(`<div style="font-weight:800;font-size:16px">${g ? 'Edit group' : esc(who) + ' works with…'}</div>
    ${g ? '' : `<input type="hidden" id="mtsGpWho" value="${esc(who)}">`}<input type="hidden" id="mtsGpId" value="${esc(g ? g.id : '')}">
    <input id="mtsGpFind" placeholder="Search name" autocomplete="off" style="height:40px;border:1px solid #C4CAD6;border-radius:8px;padding:0 10px;font:inherit">
    <div style="display:flex;flex-direction:column;max-height:300px;overflow:auto;border:1px solid #E4E7EC;border-radius:10px;padding:4px 10px">${rows || '<span class="muted">No other karigars found.</span>'}</div>
    <label style="display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:700">Group name (empty = the names joined)
      <input id="mtsGpName" value="${esc(g ? g.name : '')}" style="height:38px;border:1px solid #C4CAD6;border-radius:8px;padding:0 10px;font:inherit;font-weight:400"></label>
    <div id="mtsGpMsg" class="muted" style="font-size:12.5px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
      ${g ? '<button type="button" class="ghost" data-mtsgp="del" style="color:var(--bad);margin-right:auto">Remove group</button>' : ''}
      <button type="button" class="ghost" data-mtsgp="x">Cancel</button><button type="button" data-mtsgp="save">${g ? 'Save group' : 'Make group'}</button></div>`);
}
async function mtsGroupSave(del) {
  const p = document.getElementById('mtsGp'); if (!p || !mtgCanWrite()) return;
  const say = m => { const x = document.getElementById('mtsGpMsg'); if (x) { x.className = 'err'; x.textContent = m; } };
  const gid = (document.getElementById('mtsGpId') || {}).value || '', whoEl = document.getElementById('mtsGpWho');
  try {
    if (del) {
      await ptDelete('pt_meeting/_groups/' + gid);
      if (MTG.meet && MTG.meet._groups) delete MTG.meet._groups[gid];
    } else {
      const mem = [...new Set([...(whoEl ? [whoEl.value] : []), ...[...p.querySelectorAll('[data-mtsgpm]:checked')].map(c => c.getAttribute('data-mtsgpm'))]
        .map(s => String(s).trim()).filter(Boolean))];
      if (mem.length < 2) return say('Tick at least one more karigar.');
      const taken = new Set(mtsGroups().filter(x => x.id !== gid).flatMap(x => x.members.map(m => m.toLowerCase())));
      const twice = mem.filter(m => taken.has(m.toLowerCase())); if (twice.length) return say(twice.join(', ') + ' is already in a group.');
      const id = gid || 'g_' + Date.now().toString(36), nm = ((document.getElementById('mtsGpName') || {}).value || '').trim();
      const rec = { name: nm || mem.join(' + '), members: mem, at: new Date().toISOString(), by: ME.email };
      await ptPut('pt_meeting/_groups/' + id, rec);
      MTG.meet = MTG.meet || {}; (MTG.meet._groups = MTG.meet._groups || {})[id] = rec;
    }
  } catch (e) { return say('Not saved: ' + (e.message || e)); }
  mtsGroupPanel(null);
  const t = MTS.slides[MTS.i] && MTS.slides[MTS.i].t; MTS.slides = mtsSlides(MTS.wk);
  const back = MTS.slides.findIndex(s => s.t === t); if (back >= 0) MTS.i = back;
  mtsDraw();
  const m = document.getElementById('mtsMsg'); if (m) { m.className = 'muted'; m.textContent = del ? 'Group removed.' : 'Group saved.'; }
}
function mtsGroupClick(e) {
  const a = e.target.closest('[data-mtsgnew],[data-mtsgedit],[data-mtsgp]'); if (!a) return false;
  if (a.hasAttribute('data-mtsgnew')) mtsGroupOpen(a.getAttribute('data-mtsgnew'), '');
  else if (a.hasAttribute('data-mtsgedit')) mtsGroupOpen('', a.getAttribute('data-mtsgedit'));
  else { const v = a.getAttribute('data-mtsgp'); if (v === 'x') mtsGroupPanel(null); else mtsGroupSave(v === 'del'); }
  return true;
}
/* the meeting screen's "Karigar groups" button opens the slides on that page */
async function mtsOpenGroups() {
  await mtsOpen();
  const i = MTS.slides.findIndex(s => s.t === 'People — every karigar'); if (i >= 0) { MTS.i = i; mtsDraw(); }
}
function mtsClose() {
  mtsGroupPanel(null);
  const box = document.getElementById('mtsBox'); if (box) box.style.display = 'none';
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* */ }
  if ($('repView') && $('repView').value === 'mtg') renderMtg();
}
document.addEventListener('keydown', e => {
  const box = document.getElementById('mtsBox'); if (!box || box.style.display === 'none') return;
  if (e.target && /TEXTAREA|INPUT/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
  if (document.getElementById('mtsGp')) { if (e.key === 'Escape') mtsGroupPanel(null); return; }
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); MTS.i = Math.min(MTS.slides.length - 1, MTS.i + 1); mtsDraw(); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); MTS.i = Math.max(0, MTS.i - 1); mtsDraw(); }
  else if (e.key === 'Escape') mtsClose();
});
