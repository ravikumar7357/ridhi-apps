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
  let st = null; try { st = mtsStages(open); } catch (e) { st = null; }
  let spot = 0, touch = 0;
  try { qcDeptRows().forEach(x => { if (!x.left || !ofCh(x.c.orderNo || x.c.order || '')) return; if (/spot/i.test(x.dept)) spot += x.left; else if (/touch/i.test(x.dept)) touch += x.left; }); } catch (e) { /* QC not read */ }
  const stages = st ? [['To plan', st.plan], ['At printer', st.printer], ['Printed, to cut', st.toCut], ['Cut, to issue', st.toIssue], ['Stitching (with karigars)', st.karigar],
    ['Waiting for QC', st.qc], ['Spotting', spot], ['Touching', touch], ['Press (QC passed, not pressed)', st.press]].concat(st.other ? [['On no step yet', st.other]] : []) : [];
  return { qc, qcPrev, orders: orders.size, openPcs, pendOrders: pendOrders.size, pend, late: lateOrders.size, latePcs, stages };
}

/* WHERE EACH PIECE IS — ONE PLACE ONLY (18 Nov, first look at the slides: the board's own counts overlap — a piece counted at the
 * printer was counted again at QC — so FBA's stages added up to 2.2 lakh against 1.18 lakh pending). Each line's pieces not yet made
 * are put at the furthest step they have NOT passed: to plan · at the printer · printed but not cut · cut but not issued · with
 * karigars · back but not QC-checked. Press counts only on a line where pressing is recorded at all (Amazon lines are not pressed). */
function mtsStages(lines) {
  const s = { plan: 0, printer: 0, toCut: 0, toIssue: 0, karigar: 0, qc: 0, press: 0, other: 0 };
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
    if (typeof shpbGated === 'function' && shpbGated(r)) { take('plan', q - qc); return; }
    const cutDone = cut == null ? back : Math.max(cut, iss);
    take('qc', rec - qc);
    take('karigar', iss - Math.max(rec, qc));
    take('toIssue', cutDone - Math.max(iss, rec, qc));
    take('toCut', back - cutDone);
    take('printer', q - back);
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
const MTS_BAD_MAX = 5, MTS_MIN_DAYS = 3;
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
  const rows = [...now.values()].filter(e => /company contractor/i.test(type.get(e.k) || '')).map(e => {
    const d = (days.get(e.k) || new Set()).size;
    return Object.assign(e, { days: d, perDay: d ? e.val / d : 0, badPct: e.chk ? Math.round(e.bad / e.chk * 1000) / 10 : 0, avg: Math.round((before.get(e.k) || 0) / 4), arts: e.arts.size });
  });
  const active = rows.filter(r => r.days >= MTS_MIN_DAYS);
  /* both ends by work A DAY (18 Nov, first look: ranked by the week's total, a 4-day karigar below the team a day sat in the top 3) */
  const top = active.filter(r => r.badPct <= MTS_BAD_MAX).sort((a, b) => b.perDay - a.perDay).slice(0, 3);
  const bottom = active.filter(r => !top.includes(r)).sort((a, b) => a.perDay - b.perDay).slice(0, 3);
  /* THE TEAM AVERAGE BESIDE EACH NAME (Ravi, 18 Nov: "top 3 top me h to kyo h — unka data dikhana chahiye ki ave logo se inhone itne jyada
   * pcs banay h and inka quality score bhi sahi h ya galat h, same for bottom 3"): per active day, over every karigar who was active 3+ days. */
  const n = active.length || 1, sum = k => active.reduce((t, r) => t + k(r), 0);
  const team = { n: active.length, pcsDay: sum(r => r.pcs / r.days) / n, valDay: sum(r => r.perDay) / n,
    badPct: (() => { const c = sum(r => r.chk); return c ? Math.round(sum(r => r.bad) / c * 1000) / 10 : 0; })() };
  return { top, bottom, team, n: rows.length, left: rows.filter(r => r.days < MTS_MIN_DAYS).length, noRate: !(MTS_RATES || []).length };
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
  /* 2 · People Discussion */
  const P = mtsPeople(wk), rs = v => '₹' + nf(Math.round(v));
  const T = P.team, pct = (v, avg) => avg ? Math.round((v - avg) / avg * 100) : 0;
  const vs = (v, avg, goodHigh) => { const p = pct(v, avg), good = goodHigh ? p >= 0 : p <= 0;
    return `<span style="color:${good ? '#166534' : 'var(--bad)'};font-weight:700">${p >= 0 ? '+' : '−'}${Math.abs(p)}%</span>`; };
  const qVs = b => { const d = Math.round((b - T.badPct) * 10) / 10, good = b <= T.badPct;
    return `<span style="color:${good ? '#166534' : 'var(--bad)'};font-weight:700">${good ? 'better' : 'worse'} by ${Math.abs(d)}</span>`; };
  const ptable = list => list.length ? `<table class="mts-cmp"><thead><tr><th>Karigar</th><th>Pcs a day</th><th>vs team</th><th>Work ₹ a day</th><th>vs team</th><th>Quality (rej + alt)</th><th>vs team</th><th>Days</th><th>Articles</th><th>vs own 4-week avg</th></tr></thead><tbody>`
      + list.map(r => { const pd = r.pcs / r.days, own = r.avg ? pct(r.val, r.avg) : null;
        return `<tr><td><b>${esc(r.k)}</b></td><td>${nf(Math.round(pd))}</td><td>${vs(pd, T.pcsDay, true)}</td><td>${rs(r.perDay)}</td><td>${vs(r.perDay, T.valDay, true)}</td>`
          + `<td>${r.badPct}%</td><td>${qVs(r.badPct)}</td><td>${nf(r.days)}</td><td>${nf(r.arts)}</td><td>${own == null ? '<span class="muted">new</span>' : `<span style="color:${own >= 0 ? '#166534' : 'var(--bad)'}">${own >= 0 ? '▲' : '▼'} ${Math.abs(own)}%</span>`}</td></tr>`; }).join('')
      + `<tr class="mts-team"><td>Team average (${nf(T.n)} karigars)</td><td>${nf(Math.round(T.pcsDay))}</td><td></td><td>${rs(T.valDay)}</td><td></td><td>${T.badPct}%</td><td></td><td colspan="3"></td></tr></tbody></table>`
    : '<span class="muted">Nobody meets the rule this week.</span>';
  out.push({ t: 'People Discussion', html: `<table class="mts-sheet"><tbody>
      <tr><th style="background:#E5F4E4">Top 3 performer for last week that I want to recognize</th><td>${ptable(P.top)}</td></tr>
      <tr><th>Bottom 3 performers that I want to highlight</th><td>${ptable(P.bottom)}<div class="muted" style="font-size:11.5px;margin-top:4px">How chosen: piece-rate karigars only (not the contractor's team, embroidery vendors or salaried staff) · work = QC-passed pcs × job work rate · top = ${MTS_MIN_DAYS}+ days active, quality ${MTS_BAD_MAX}% or better, most work a day · bottom = ${MTS_MIN_DAYS}+ days active, least work a day · active = a Job Work issue or receipt that day (attendance is not kept) · two people sharing one entry cannot be seen${P.left ? ' · ' + nf(P.left) + ' karigar(s) under ' + MTS_MIN_DAYS + ' days left out' : ''}${P.noRate ? ' · <b style="color:var(--bad)">job work rates could not be read</b>' : ''}</div></td></tr>
      <tr><th>Critical vacant position with HR</th><td>${mtsNote(wk, 'hr_vacant', 'Status', 3)}</td></tr>
      <tr><th>People Requirement not yet with HR</th><td>${mtsNote(wk, 'hr_need', 'Status (discuss with Srikant ji, Mukul sir first)', 3)}</td></tr>
    </tbody></table>` });
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
      const n = e.target.closest('[data-mtsnav]'), g = e.target.closest('[data-mtsgo]');
      if (g) { MTS.i = +g.getAttribute('data-mtsgo'); return mtsDraw(); }
      if (!n) return;
      const v = n.getAttribute('data-mtsnav');
      if (v === 'x') return mtsClose();
      if (v === 'fs') { try { if (document.fullscreenElement) document.exitFullscreen(); else box.requestFullscreen(); } catch (er) { /* not allowed */ } return; }
      MTS.i = Math.max(0, Math.min(MTS.slides.length - 1, MTS.i + (+v))); mtsDraw();
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
function mtsClose() {
  const box = document.getElementById('mtsBox'); if (box) box.style.display = 'none';
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* */ }
  if ($('repView') && $('repView').value === 'mtg') renderMtg();
}
document.addEventListener('keydown', e => {
  const box = document.getElementById('mtsBox'); if (!box || box.style.display === 'none') return;
  if (e.target && /TEXTAREA|INPUT/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); MTS.i = Math.min(MTS.slides.length - 1, MTS.i + 1); mtsDraw(); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); MTS.i = Math.max(0, MTS.i - 1); mtsDraw(); }
  else if (e.key === 'Escape') mtsClose();
});
