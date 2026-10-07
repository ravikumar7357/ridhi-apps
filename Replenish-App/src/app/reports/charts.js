/* ================= THE CHARTS =================
 *
 * Three forms, one hue and a grey. Every number that appears on a chart also appears in the table
 * below it, so nothing is only ever readable as a picture.
 */
const REP_INK = '#4f46e5';        // the week being reported on
const REP_DIM = '#94a3b8';        // the weeks it is being compared against
const REP_RULE = '#e5e8ee';       // one step off the surface, hairline, solid

/** Round to something a person would say: 0, 500, 1,000, 5,000. */
function repNice(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= v) || 10 * p;
}

/**
 * THE WEEKS, AS COLUMNS — the emphasis form. Last week carries the accent; the weeks before it are
 * the grey it is being measured against. One series, so no legend: the heading says what is plotted.
 *
 * Only the last column is labelled. A number on every mark is chaos and goes unread; the rest are
 * carried by the axis under them and by the table below.
 */
function repTrendSvg(weeks, totals, labels) {
  const W = 420, H = 150, padL = 44, padR = 10, padT = 16, padB = 26;
  const n = totals.length;
  if (!n) return '';
  const top = repNice(Math.max(...totals, 1));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const band = plotW / n;
  /* Capped at 24, and the leftover of the band is left as air rather than filled. */
  const bw = Math.min(24, band - 10);
  const y = v => padT + plotH - (v / top) * plotH;
  const grid = [0, top / 2, top].map(v =>
    '<line x1="' + padL + '" y1="' + y(v).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(v).toFixed(1)
    + '" stroke="' + REP_RULE + '" stroke-width="1"/>'
    + '<text x="' + (padL - 7) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end" font-size="9.5" fill="#94a3b8">'
    + esc(nf(Math.round(v))) + '</text>').join('');
  const bars = totals.map((v, i) => {
    const cx = padL + band * i + band / 2;
    const h = Math.max(v > 0 ? 2 : 0, plotH - (y(v) - padT));
    const last = i === n - 1;
    return '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + (padT + plotH - h).toFixed(1) + '" width="' + bw.toFixed(1)
      + '" height="' + h.toFixed(1) + '" rx="4" fill="' + (last ? REP_INK : REP_DIM) + '">'
      + '<title>' + esc(labels[i] + ': ' + nf(Math.round(v)) + ' pieces') + '</title></rect>'
      /* The cap label, on the one column the report is about. */
      + (last && v > 0 ? '<text x="' + cx.toFixed(1) + '" y="' + (padT + plotH - h - 5).toFixed(1)
        + '" text-anchor="middle" font-size="11" font-weight="700" fill="#0f172a">' + esc(nf(Math.round(v))) + '</text>' : '')
      + '<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="9.5" fill="'
      + (last ? '#0f172a' : '#94a3b8') + '"' + (last ? ' font-weight="700"' : '') + '>' + esc(labels[i]) + '</text>';
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" '
    + 'aria-label="Pieces received each week" style="display:block;font-family:inherit">'
    + grid + bars + '</svg>';
}

/**
 * THE ARTICLES, AS BARS. Same colour on every bar: they are categories, not a scale, and shading
 * them by length would say the length twice.
 *
 * Eight, then "Other" — past about seven classes a chart stops being read, and every one of them is
 * in the table below anyway.
 */
function repShareSvg(rows) {
  const keep = rows.filter(r => r.prod > 0).slice(0, 8);
  if (!keep.length) return '';
  const rest = rows.filter(r => r.prod > 0).slice(8).reduce((a, r) => a + r.prod, 0);
  const items = keep.map(r => ({ name: r.art, v: r.prod }))
    .concat(rest > 0 ? [{ name: 'Other', v: rest, other: true }] : []);
  const rowH = 22, padT = 8, padL = 132, padR = 52, W = 420;
  const H = padT * 2 + items.length * rowH;
  const top = Math.max(...items.map(x => x.v), 1);
  const plotW = W - padL - padR;
  const body = items.map((x, i) => {
    const yTop = padT + i * rowH;
    const w = Math.max(2, (x.v / top) * plotW);
    const name = x.name.length > 20 ? x.name.slice(0, 19) + '…' : x.name;
    /* Text wears a text token, never the data colour — identity comes from the mark beside it. */
    return '<text x="' + (padL - 8) + '" y="' + (yTop + 13.5) + '" text-anchor="end" font-size="11" fill="'
      + (x.other ? '#64748b' : '#334155') + '">' + esc(name) + '<title>' + esc(x.name) + '</title></text>'
      + '<rect x="' + padL + '" y="' + (yTop + 4) + '" width="' + w.toFixed(1) + '" height="14" rx="4" fill="'
      + (x.other ? REP_DIM : REP_INK) + '"><title>' + esc(x.name + ': ' + nf(Math.round(x.v)) + ' pieces') + '</title></rect>'
      /* The value at the tip, outside the bar, where it can never be clipped by its own mark. */
      + '<text x="' + (padL + w + 7).toFixed(1) + '" y="' + (yTop + 15) + '" font-size="10.5" fill="#475569" font-weight="600">'
      + esc(nf(Math.round(x.v))) + '</text>';
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" '
    + 'aria-label="Pieces received last week by article type" style="display:block;font-family:inherit">'
    + body + '</svg>';
}

/**
 * ONE ROW'S FOUR WEEKS, as a shape. No axis and no labels — the figures are in the columns beside
 * it, and this is here for the thing a column of numbers cannot show.
 */
function repSparkSvg(hist, labels) {
  const n = (hist || []).length;
  if (!n) return '';
  const W = 62, H = 20, top = Math.max(...hist, 1);
  const band = W / n, bw = Math.min(7, band - 2);
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" style="display:block">'
    + hist.map((v, i) => {
      const h = v > 0 ? Math.max(2, (v / top) * (H - 3)) : 0;
      if (!h) return '';
      return '<rect x="' + (band * i + (band - bw) / 2).toFixed(1) + '" y="' + (H - h).toFixed(1)
        + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" fill="'
        + (i === n - 1 ? REP_INK : REP_DIM) + '"><title>' + esc((labels && labels[i] ? labels[i] + ': ' : '')
        + nf(Math.round(v))) + '</title></rect>';
    }).join('') + '</svg>';
}

/** How a change is written: a percentage where there is one, and the truth where there is not. */
function repPctCell(r) {
  if (r.pct === null) return r.prod > 0
    ? '<span class="pill pill-low" title="Nothing of this was pressed the week before, so there is no percentage to give.">new</span>'
    : '<span class="muted">—</span>';
  const up = r.pct > 0, flat = Math.abs(r.pct) < 0.05;
  if (flat) return '<span class="muted">no change</span>';
  return `<span style="font-weight:700;color:${up ? '#166534' : 'var(--bad)'}">`
    + `${up ? '▲' : '▼'} ${Math.abs(r.pct).toFixed(1)}%</span>`;
}

/** The running week: what has come back so far, and how that stands against the same days before. */
/* Every view that is not the week-on-week one clears the panel rather than leaving last week's
 * charts sitting above a different table. */
function repChartsOff() { const el = $('repCharts'); if (el) { el.innerHTML = ''; el.classList.add('hide'); } }

function repRenderLive() {
  const brand = $('repBrand').value;
  const L = repLive(brand, false);
  const days = L.days;
  const dayWord = days === 1 ? 'day' : 'days';
  const from = new Date(L.start), to = new Date();
  const span = from.getDate() + ' ' + REP_MON[from.getMonth()] + ' – ' + to.getDate() + ' ' + REP_MON[to.getMonth()];

  const sum = f => L.rows.reduce((n, r) => n + f(r), 0);
  const prod = sum(r => r.prod), prevProd = sum(r => r.prevProd), cust = sum(r => r.cust);
  const pct = prevProd > 0 ? ((prod - prevProd) / prevProd) * 100 : null;
  const up = L.rows.filter(r => r.delta > 0).length, down = L.rows.filter(r => r.delta < 0).length;

  $('repMsg').className = 'muted';
  $('repMsg').innerHTML = `<b>${nf(days)} ${dayWord}</b> into the week, counted Sunday to now.
    The comparison is the SAME ${nf(days)} ${dayWord} of last week (${nf(Math.round(prevProd))} pcs),
    not the whole of it (${nf(Math.round(L.fullPrevProd))} pcs) — a part week against a finished one
    reads as a collapse that never happened.
    ${REP_UNDATED ? '<br>A receiving date is stamped when a row is FULLY received, so work part-received today '
      + 'is not in this figure yet. Every week lags that way; this one carries all of it at once.' : ''}`;

  /* OPEN OR CLOSED HERE TOO (Ravi, 2026-10-02: "this week me bhi open close add karo"): the same switch as Last week
   * (remembered in this browser, one for both views); open, the production tiles are THIS week's, so far. */
  const repOpen = (() => { try { return localStorage.getItem('repTopOpen') !== '0'; } catch (e) { return true; } })();
  const thisWeek = repWkIso(repWeekStart(Date.now()));
  if (!repOpen) {
    $('repKpis').innerHTML = `<div class="kpi" style="flex-basis:100%;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <span class="kpiname">This week so far — ${esc(span)}</span>
      <span style="font-weight:700">${nf(Math.round(prod))} pcs</span>
      <span style="font-weight:700;color:${pct === null ? 'var(--muted)' : (pct >= 0 ? '#166534' : 'var(--bad)')}">${pct === null ? '' : (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(1) + '%'}</span>
      <span class="muted" style="font-size:12px">against the same ${nf(days)} ${dayWord} last week</span>
      <span style="flex:1"></span><button type="button" class="ghost" data-reptoggle="1" style="height:32px;padding:0 14px">Open ▼</button></div>`;
  } else
  $('repKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">This week so far — ${esc(span)}</span>
      <span class="kpiwhen">${nf(days)} ${dayWord} in · against the same ${nf(days)} ${dayWord} last week · what came back, from Job Work Register</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(Math.round(prod))}</div><div class="l">Pieces received</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(Math.round(cust))}</div><div class="l">Customer-facing pieces</div></div>
      <div class="metric"><div class="v">${nf(Math.round(prevProd))}</div><div class="l">Same days last week</div></div>
      <div class="metric"><div class="v" style="color:${pct === null ? 'var(--muted)' : (pct >= 0 ? '#166534' : 'var(--bad)')}">`
        + `${pct === null ? '—' : (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(1) + '%'}</div><div class="l">Same days, week on week</div></div>
      <div class="metric"><div class="v" style="color:var(--muted)">${nf(Math.round(L.fullPrevProd))}</div><div class="l">All of last week</div></div>
      <div class="metric"><div class="v"><span style="color:#166534">${nf(up)}</span> / <span style="color:var(--bad)">${nf(down)}</span></div><div class="l">Up / down</div></div>
    </div></div>` + repManpowerCard(thisWeek, brand);

  if (!L.rows.length) { ptEmpty('repTable', 'Nothing has come back yet this week.'); REP.live = L; return; }

  const head = '<thead><tr><th class="frz">Article type</th>'
    + `<th class="num">This week so far</th><th class="num">Customer</th>`
    + `<th class="num">Same days last week</th><th class="num">Change</th><th>Week on week</th></tr></thead>`;
  const body = L.rows.map(r => '<tr>'
    + `<td class="frz" style="text-align:left;font-weight:600">${esc(r.art)}</td>`
    + `<td class="num" style="font-weight:700">${nf(Math.round(r.prod))}</td>`
    + `<td class="num">${nf(Math.round(r.cust))}</td>`
    + `<td class="num muted">${r.prevProd ? nf(Math.round(r.prevProd)) : '<span class="muted">·</span>'}</td>`
    + `<td class="num" style="color:${r.delta > 0 ? '#166534' : (r.delta < 0 ? 'var(--bad)' : 'var(--muted)')};font-weight:600">`
      + `${r.delta > 0 ? '+' : ''}${nf(Math.round(r.delta))}</td>`
    + `<td>${repPctCell(r)}</td></tr>`).join('');
  $('repTable').innerHTML = head + '<tbody>' + body + '</tbody>';
  REP.live = L;
}

/* THE WEEKLY TARGET (Ravi, 2026-09-29: "target mera 20000 pcs ka h"), saved at pt_contractorHeads/_settings/target. */
const REP_TARGET = 20000;
const repTarget = () => Number(((REP_HEADS || {})._settings || {}).target) || REP_TARGET;
/** Square metres of printed cloth in one piece made this week, on average over everything made (pillow insert apart) —
 * what turns a piece target into a printing target. Pieces whose m² cannot be worked out are left out of the average. */
function repM2PerPiece(week, brand) {
  const wp = String(week).split('-').map(Number), from = new Date(wp[0], wp[1] - 1, wp[2]).getTime(), to = from + 7 * 864e5;
  let m2 = 0, pcs = 0, unknown = 0;
  (PT.base || []).forEach(r => {
    if (!r || repIsInsert(r) || (brand && repBrand(r.sku) !== brand)) return;
    const got = repRecvParts(r).filter(x => x.ms && x.ms >= from && x.ms < to).reduce((a, x) => a + x.pcs, 0);   // this week's receipts (2026-10-02)
    if (!(got > 0)) return;
    const m = mdbOf(r.sku);
    if (m && !ptPrintNeeded(m)) { pcs += got; return; }      // made, and never printed
    const a = voSqm({ sku: r.sku }, got);
    if (a == null) { unknown += got; return; }
    m2 += a; pcs += got;
  });
  return { m2, pcs, unknown, per: pcs ? m2 / pcs : 0 };
}
/** What the printers delivered this week, in m² — null while the vendor orders are not read. */
function repPrinterM2(week) {
  if (!Array.isArray(VO.rows)) return null;
  const wp = String(week).split('-').map(Number), from = new Date(wp[0], wp[1] - 1, wp[2]).getTime(), to = from + 7 * 864e5;
  let m2 = 0;
  voLogRows().forEach(r => {
    if (!r.printing) return;
    const ms = ptDtMs(r.day) || ptDtMs(r.raw);
    if (!ms || ms < from || ms >= to) return;
    m2 += voSqm({ run: r.run, fabric: r.fabric, sku: r.sku }, vlInHand(r)) || 0;
  });
  return m2;
}

/** Tablecloths, border napkins and table runners that came CUT from printers this week — accepted, or as the printer
 * says until then. null while the vendor orders are not read. */
function repPrinterCut(week, brand) {
  if (!Array.isArray(VO.rows)) return null;
  const wp = String(week).split('-').map(Number), from = new Date(wp[0], wp[1] - 1, wp[2]).getTime(), to = from + 7 * 864e5;
  let pcs = 0;
  voLogRows().forEach(r => {
    if (r.run || !r.sku) return;
    const ms = ptDtMs(r.day) || ptDtMs(r.raw);
    if (!ms || ms < from || ms >= to) return;
    if (repNeedsCutting({ sku: r.sku }) || (brand && repBrand(r.sku) !== brand)) return;
    pcs += vlInHand(r) || 0;
  });
  return pcs;
}

/** The gap panel: what could have been made, what was, and why the rest was not — no work, or speed. */
function repGapPanel(week, brand, box) {
  const g = repGap(week, brand);
  if (!g.karigars) return '';
  const pct = v => g.possible ? Math.max(0, Math.min(100, v / g.possible * 100)) : 0;
  const madeP = pct(g.made), noP = pct(g.noWork), spP = pct(g.speed);
  const main = !g.short ? 'none' : (g.noWork >= g.speed ? 'work' : 'speed');
  const verdict = main === 'none'
    ? `<b style="color:#15803D">No gap</b> — the karigars made ${nf(g.made)}, at or above ${nf(g.perDay)} a day.`
    : main === 'work'
      ? `<b style="color:var(--bad)">The gap is WORK, not the karigars.</b> ${nf(g.emptyDays)} of ${nf(g.karigarDays)} karigar-days had no work in hand — about <b>${nf(g.noWork)} pcs</b> never had the chance to be made. Cut and give out more.`
      : `<b style="color:#B45309">The gap is SPEED.</b> The karigars had work most days, and still made <b>${nf(g.speed)} pcs</b> less than ${nf(g.perDay)} a day. Check attendance and who is slow.`;
  const supplyShort = g.available < g.possible;
  const step = (v, l, sub, col) => `<div style="flex:1 1 130px;min-width:0;padding:10px 12px;border-radius:12px;background:var(--soft)">
      <div style="font-size:22px;font-weight:800;color:${col || 'var(--ink)'}">${nf(v)}</div><div style="font-size:12.5px;font-weight:600">${l}</div>
      <div style="font-size:11.5px;color:var(--muted)">${sub}</div></div>`;
  const arrow = '<div style="align-self:center;color:var(--muted);font-size:18px">→</div>';
  return `<div style="margin-bottom:12px;background:#fff;border:1px solid var(--line);border-left:6px solid ${main === 'work' ? 'var(--bad)' : main === 'speed' ? '#B45309' : '#15803D'};border-radius:16px;padding:14px 16px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <div style="font-weight:800;font-size:16px">Where is the gap?</div>
      <label style="display:flex;align-items:center;gap:8px;margin:0;font-size:13px;font-weight:600">One karigar can make ${box('perDay', g.perDay, '50', 64).replace('data-rephead="' + esc(week) + '|perDay"', 'data-rephead="_settings|perDay"')} pcs a day</label>
    </div>
    <div style="font-size:14px;margin:6px 0 10px">${verdict}</div>
    <div style="display:flex;height:26px;border-radius:8px;overflow:hidden;background:var(--chip)">
      <div title="Made" style="width:${madeP}%;background:#15803D"></div>
      <div title="Lost — no work in hand" style="width:${noP}%;background:#DC2626"></div>
      <div title="Lost — slower than ${nf(g.perDay)} a day" style="width:${spP}%;background:#F59E0B"></div></div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;margin-top:6px">
      <span><b style="color:#15803D">■</b> Made <b>${nf(g.made)}</b></span>
      <span><b style="color:#DC2626">■</b> Lost — no work in hand <b>${nf(g.noWork)}</b></span>
      <span><b style="color:#F59E0B">■</b> Lost — slower than ${nf(g.perDay)}/day <b>${nf(g.speed)}</b></span>
      <span style="color:var(--muted)">could have made <b style="color:var(--ink)">${nf(g.possible)}</b> = ${nf(g.karigars)} karigars × ${nf(g.perDay)} × ${nf(g.days)} days</span></div>
    <div style="font-weight:700;font-size:13px;margin:14px 0 6px">Did the work reach them?</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:stretch">
      ${step(g.held, 'In hand at the start', 'issued before, not back yet')}
      <div style="align-self:center;color:var(--muted);font-size:18px">+</div>
      ${step(g.issuedCut, 'Given — from our cutting', `cut this week: <b style="color:${g.cut < g.issuedCut ? 'var(--bad)' : 'var(--ink)'}">${nf(g.cut)}</b>`)}
      <div style="align-self:center;color:var(--muted);font-size:18px">+</div>
      ${step(g.issuedReady, 'Given — came cut from printers', 'tablecloth, border napkin, runner')}
      <div style="align-self:center;color:var(--muted);font-size:18px">=</div>
      ${step(g.available, 'Work they had', supplyShort ? `<span style="color:var(--bad);font-weight:700">${nf(g.possible - g.available)} short of ${nf(g.possible)}</span>` : `enough for ${nf(g.possible)}`, supplyShort ? 'var(--bad)' : '#15803D')}${arrow}
      ${step(g.made, 'Made', Math.round(g.made / Math.max(1, g.karigars * g.days)) + ' a karigar a day')}
    </div>
    <div style="font-size:12.5px;color:var(--muted);margin-top:8px">${g.available < g.possible
      ? `To keep every karigar busy at ${nf(g.perDay)} a day they needed <b style="color:var(--ink)">${nf(g.possible)}</b>; they had ${nf(g.available)} — <b style="color:var(--bad)">${nf(g.possible - g.available)} pcs more</b> had to come from our cutting or cut pieces from the printers.`
      : `There was work enough for every karigar at ${nf(g.perDay)} a day.`}
      Ruffle and piping-scallop tablecloths go through our cutting; plain tablecloths, border napkins and table runners come cut from the printer.</div>
    ${g.empty.length ? `<div style="font-weight:700;font-size:13px;margin:14px 0 6px">Karigars who sat without work <span style="font-weight:400;color:var(--muted)">— days this week with nothing in hand</span></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${g.empty.slice(0, 14).map(e => `<span style="border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:12.5px">${esc(e.name)} · <b style="color:var(--bad)">${nf(e.days)} day${e.days > 1 ? 's' : ''}</b></span>`).join('')}${g.empty.length > 14 ? `<span style="font-size:12.5px;color:var(--muted);padding:3px 4px">and ${nf(g.empty.length - 14)} more</span>` : ''}</div>` : ''}
  </div>`;
}

/** MANPOWER, the week's: who made it and what one person makes — pillow insert apart, each contractor on his own. */
function repManpowerCard(week, brand) {
  const m = repManpower(week, brand), p = repManpower(repWkShift(week, -1), brand);
  const g = repGap(week, brand), gp = repGap(repWkShift(week, -1), brand);
  const canEdit = !!(ME.admin || ptCanEdit());
  const r0 = v => nf(Math.round(v));
  const box = (key, val, ph, w, wk) => canEdit
    ? `<input type="number" min="0" step="1" data-rephead="${esc(wk || week)}|${esc(key)}" value="${val || ''}" placeholder="${ph}" style="width:${w || 70}px;height:30px;font-size:14px;font-weight:700;text-align:center;border:1.5px solid #6E90B5;border-radius:8px;background:#fff">`
    : `<b>${val ? nf(val) : '—'}</b>`;
  const T = g.perDay;
  /* One tile: a label, the figure, a line under it. The figure is 22px — Ravi: "font bahut bade h". */
  const tile = (label, v, sub, col, bg) => `<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;min-width:0;background:${bg || '#fff'}">
      <div style="font-size:12px;color:var(--muted);font-weight:600">${label}</div>
      <div style="font-size:22px;font-weight:800;line-height:1.25;color:${col || 'var(--ink)'};font-variant-numeric:tabular-nums">${v}</div>
      <div style="font-size:11.5px;color:var(--muted);line-height:1.35">${sub}</div></div>`;
  const vs = (now, was, unit) => !was ? '' : `<span style="font-weight:700;color:${now >= was ? '#15803D' : 'var(--bad)'}">${now >= was ? '▲' : '▼'} ${r0(was)}${unit || ''} the week before</span>`;
  const aim = v => v >= T ? '#15803D' : (v >= T * 0.8 ? '#B45309' : 'var(--bad)');
  const days = g.dayMs.map((d, i) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d).getDay()]} ${g.dayCounts[i]}`).join(' · ');

  const con = m.contractors[0] || null;
  const conPcs = m.contractors.reduce((t, c) => t + c.pcs, 0);
  const pcut = repPrinterCut(week, brand);
  const cutTot = g.cut + (pcut || 0);
  /* AGAINST THE TARGET (Ravi, 2026-10-03: "ye cutting mujhe target ke according dekhni h kam h ya jyada, same printing
   * fabric bhi"). The weekly target, split between our cutting and cut pieces from printers as this week's work was
   * given out; printing fabric is the target × the m² in a piece this week. Each figure says how far over or short. */
  const tgtAll = repTarget(), shareAll = g.issued ? g.issuedCut / g.issued : 0;
  const cutNeedT = Math.round(tgtAll * shareAll), prnNeedT = tgtAll - cutNeedT;
  const mpT = repM2PerPiece(week, brand), m2NeedT = tgtAll * mpT.per, m2GotT = repPrinterM2(week);
  const vsT = (have, need, unit) => have == null ? '<span class="muted">…</span>'
    : have >= need ? `<b style="color:#15803D">${nf(Math.round(have - need))}${unit || ''} over</b>`
    : `<b style="color:var(--bad)">${nf(Math.round(need - have))}${unit || ''} short</b>`;
  const okCol = (have, need) => have == null ? 'var(--muted)' : (have >= need ? '#15803D' : 'var(--bad)');
  const pctCut = Math.round(shareAll * 100);
  const total = g.made + conPcs, totalWas = gp.made + p.contractors.reduce((t, c) => t + c.pcs, 0);

  /* A tile that is a little sheet: the figure on top, then label | value rows, like Excel. */
  const sheet = (label, v, col, rows) => `<div style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;min-width:0">
      <div style="font-size:12px;color:var(--muted);font-weight:600">${label}</div>
      <div style="font-size:22px;font-weight:800;line-height:1.25;color:${col};font-variant-numeric:tabular-nums">${v}</div>
      <table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:12px">${rows.map(([k, x]) =>
        `<tr><td style="text-align:left;color:var(--muted);padding:4px 6px 4px 0;border-top:1px solid var(--line)">${k}</td>`
        + `<td style="text-align:right;font-weight:700;padding:4px 0;border-top:1px solid var(--line);font-variant-numeric:tabular-nums;white-space:nowrap">${x}</td></tr>`).join('')}</table></div>`;
  const row = (title, tiles) => `<div style="font-size:12px;font-weight:800;letter-spacing:.04em;color:var(--muted);margin:12px 0 6px">${title}</div>
    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px">${tiles}</div>`;

  return `<div class="kpi" style="flex-basis:100%;margin-top:10px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div class="kpiname" style="font-size:15px">Production — ${esc(repWkRange(week))}</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;font-weight:600;align-items:center">
        <label style="display:flex;align-items:center;gap:6px;margin:0">Working days ${box('_days', m.days, '6', 56)}</label>
        <label style="display:flex;align-items:center;gap:6px;margin:0">One person can make ${box('perDay', T, '50', 60, '_settings')} a day</label>
        <!-- CLOSE sits on this line (Ravi, 2026-09-29: "close button line ki jagah hona chahiye"). -->
        <button type="button" class="ghost" data-reptoggle="1" style="height:30px;padding:0 12px;font-size:12.5px">Close ▲</button>
      </div></div>
    ${row('MADE', tile('Total pcs made', nf(total), `ours ${nf(g.made)} + Pradeep ${nf(conPcs)} · ${vs(total, totalWas)}`)
      + sheet('Our karigars made', nf(g.made), '#1D4ED8', [
          ['People in the week', nf(g.karigars) + (gp.karigars ? ` <span class="muted">(${nf(gp.karigars)} before)</span>` : '')],
          ['People a day, average', g.days ? (Math.round(g.perDayPeople * 10) / 10) : '—'],
          ['One person a day', g.personDays ? `<span style="color:${aim(g.perPersonDay)}">${r0(g.perPersonDay)}</span> <span class="muted">/ ${nf(T)}</span>` : '—'],
          ['One person in the week', g.karigars ? r0(g.made / g.karigars) : '—'],
          ['Short of ' + nf(T) + ' a day', g.short ? `<span style="color:var(--bad)">${nf(g.short)}</span>` : '<span style="color:#15803D">none</span>']])
      + (con ? sheet('Pradeep made', nf(con.pcs), '#7C3AED', [
          ['Attendance in the week', box(con.name, con.heads, 'total', 64)],
          ['People a day, average', con.perDayPeople == null ? '—' : (Math.round(con.perDayPeople * 10) / 10) + ` <span class="muted">(÷ ${nf(m.days)} days)</span>`],
          ['One person a day', con.perDay == null ? '<span class="muted">enter the attendance</span>' : `<span style="color:${aim(con.perDay)}">${r0(con.perDay)}</span> <span class="muted">/ ${nf(T)}</span>`],
          ['One person in the week', con.per == null ? '—' : r0(con.per)]])
        : tile('Pradeep made', '—', 'nothing received this week'))
      + tile('Pillow insert (apart)', nf(m.insert), `not in any figure here${p.insert ? ' · ' + nf(p.insert) + ' the week before' : ''}`, '#B45309'))}
    ${(() => {
      /* TO REACH THE TARGET: Pradeep is taken to make what he made; the rest is ours. Cutting and cut pieces from
       * printers are split as this week's work was given out; printing is the target × the m² in a piece this week. */
      const tgt = repTarget(), short = Math.max(0, tgt - total);
      const ours = Math.max(0, tgt - conPcs);
      const needPeople = g.days ? ours / (T * g.days) : 0, morePeople = Math.max(0, Math.ceil(needPeople - g.perDayPeople));
      const eachNow = g.perDayPeople && g.days ? ours / (g.perDayPeople * g.days) : 0;
      const share = g.issued ? g.issuedCut / g.issued : 0;
      const cutNeed = Math.round(tgt * share), prnNeed = tgt - cutNeed;
      const mp = repM2PerPiece(week, brand), m2Need = tgt * mp.per, m2Got = repPrinterM2(week);
      const gap = (need, have) => have == null ? '<span class="muted">…</span>' : (need > have ? `<span style="color:var(--bad)">${nf(Math.round(need - have))} short</span>` : '<span style="color:#15803D">enough</span>');
      return row('TO REACH ' + nf(tgt) + ' A WEEK',
        sheet('Short of the target', nf(short), short ? 'var(--bad)' : '#15803D', [
          ['Target a week', box('target', tgt, '20000', 84, '_settings')],
          ['Made this week', nf(total)],
          ['Pradeep made (kept as is)', nf(conPcs)],
          ['Our karigars must make', nf(ours)]])
        + sheet('Karigars needed a day', g.days ? nf(Math.ceil(needPeople)) : '—', '#1D4ED8', [
          ['Must make a day', g.days ? nf(Math.round(ours / g.days)) : '—'],
          ['Working a day now', Math.round(g.perDayPeople * 10) / 10],
          ['More people a day', morePeople ? `<span style="color:var(--bad)">+${nf(morePeople)}</span>` : '<span style="color:#15803D">none</span>'],
          ['Or each makes a day, same people', eachNow ? r0(eachNow) : '—']])
        + sheet('Cutting needed a week', nf(tgt), '#1D4ED8', [
          ['Our cutting', nf(cutNeed)],
          ['…this week ' + nf(g.cut), gap(cutNeed, g.cut)],
          ['Cut pieces from printers', nf(prnNeed)],
          ['…this week ' + (pcut == null ? '…' : nf(pcut)), gap(prnNeed, pcut)],
          ['Split, as given out this week', g.issued ? Math.round(share * 100) + '% / ' + (100 - Math.round(share * 100)) + '%' : '—']])
        + sheet('Printing fabric a week', mp.per ? nf(Math.round(m2Need)) + ' m²' : '—', '#7C3AED', [
          ['m² in one piece this week', mp.per ? (Math.round(mp.per * 100) / 100) + ' m²' : '—'],
          ['Printers delivered this week', m2Got == null ? '…' : nf(Math.round(m2Got)) + ' m²'],
          ['Against the need', mp.per ? gap(m2Need, m2Got) : '—']]));
    })()}
    ${row('CUTTING & PRINTING THIS WEEK — AGAINST THE ' + nf(tgtAll) + ' TARGET',
      tile('Cutting — total', nf(cutTot), pcut == null ? 'reading the vendor deliveries…'
        : `target ${nf(tgtAll)} · ${vsT(cutTot, tgtAll)}<br>ours ${nf(g.cut)} + cut from printers ${nf(pcut)} · ${nf(g.held)} cut pieces were already with karigars when the week began`,
        okCol(pcut == null ? null : cutTot, tgtAll), '#EEF5FF')
      + tile('Our cutting', nf(g.cut), `target ${nf(cutNeedT)} (${pctCut}% of the work) · ${vsT(g.cut, cutNeedT)}<br>Cutting Data · ruffle & piping-scallop tablecloths are cut here`,
        okCol(g.cut, cutNeedT))
      + tile('Came cut from printers', pcut == null ? '…' : nf(pcut), `target ${nf(prnNeedT)} (${100 - pctCut}% of the work) · ${vsT(pcut, prnNeedT)}<br>tablecloth, border napkin, table runner delivered this week`,
        okCol(pcut, prnNeedT))
      + tile('Printing fabric delivered', m2GotT == null ? '…' : nf(Math.round(m2GotT)) + ' m²', mpT.per
        ? `target ${nf(Math.round(m2NeedT))} m² (${Math.round(mpT.per * 100) / 100} m² a piece × ${nf(tgtAll)}) · ${vsT(m2GotT, m2NeedT, ' m²')}<br>what the printers delivered this week`
        : 'no m² is known yet for this week\'s pieces', mpT.per ? okCol(m2GotT, m2NeedT) : 'var(--muted)', '#F5F3FF'))}
  </div>`;
}
if ($('repMsg')) $('repMsg').addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-repundated]')) repUndatedCsv(); });
if ($('repKpis')) $('repKpis').addEventListener('click', e => {
  if (!(e.target.closest && e.target.closest('[data-reptoggle]'))) return;
  try { localStorage.setItem('repTopOpen', localStorage.getItem('repTopOpen') === '0' ? '1' : '0'); } catch (er) { /* stays as it is */ }
  renderRep();
});
if ($('repKpis')) $('repKpis').addEventListener('change', async e => {
  const t = e.target.closest && e.target.closest('[data-rephead]'); if (!t) return;
  const [week, name] = String(t.getAttribute('data-rephead')).split('|');
  let n = Math.max(0, Math.round(Number(t.value) || 0));
  if (name === '_days') n = Math.min(7, n) || REP_DAYS;
  if (week === '_settings' && name === 'perDay') n = n || REP_PER_DAY;
  if (week === '_settings' && name === 'target') n = n || REP_TARGET;
  try { await ptPut('pt_contractorHeads/' + week + '/' + repHeadKey(name), n); }
  catch (er) { $('repMsg').className = 'err'; $('repMsg').textContent = 'Headcount not saved: ' + (er.message || er); return; }
  REP_HEADS = REP_HEADS || {}; REP_HEADS[week] = Object.assign({}, REP_HEADS[week], { [repHeadKey(name)]: n });
  renderRep();
});

function repRenderWow() {
  const week = ($('repWk') || {}).value || repLastFullWeek();
  const brand = $('repBrand').value;
  const { prevWeek, weeks, rows } = repWow(week, brand, false);

  if (!rows.length) {
    repChartsOff();
    ptEmpty('repTable', 'Nothing came back in any of those weeks.');
    $('repKpis').innerHTML = '';
    $('repMsg').className = 'muted';
    $('repMsg').textContent = `Nothing was received in ${repWkRange(week)} or the weeks before it.`;
    return;
  }

  const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
  const prod = sum(r => r.prod), prevProd = sum(r => r.prevProd), cust = sum(r => r.cust);
  const pct = prevProd > 0 ? ((prod - prevProd) / prevProd) * 100 : null;
  const up = rows.filter(r => r.delta > 0).length, down = rows.filter(r => r.delta < 0).length;

  /* OPEN OR CLOSED (Ravi, 2026-09-29: "ek open close ka option de dena"): closed, the week's figures and the production
   * tiles fold to one line. Remembered in this browser. */
  const repOpen = (() => { try { return localStorage.getItem('repTopOpen') !== '0'; } catch (e) { return true; } })();
  if (!repOpen) {
    $('repKpis').innerHTML = `<div class="kpi" style="flex-basis:100%;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <span class="kpiname">Week of ${esc(repWkRange(week))}</span>
      <span style="font-weight:700">${nf(Math.round(prod))} pcs</span>
      <span style="font-weight:700;color:${pct === null ? 'var(--muted)' : (pct >= 0 ? '#166534' : 'var(--bad)')}">${pct === null ? '' : (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(1) + '%'}</span>
      <span style="flex:1"></span><button type="button" class="ghost" data-reptoggle="1" style="height:32px;padding:0 14px">Open ▼</button></div>`;
  } else
  $('repKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Week of ${esc(repWkRange(week))}</span>
      <span class="kpiwhen">${nf(weeks.length)} weeks shown · against ${esc(repWkRange(prevWeek))} · what came back, from Job Work Register</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(Math.round(prod))}</div><div class="l">Pieces received</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(Math.round(cust))}</div><div class="l">Customer-facing pieces</div></div>
      <div class="metric"><div class="v">${nf(Math.round(prevProd))}</div><div class="l">The week before</div></div>
      <div class="metric"><div class="v" style="color:${pct === null ? 'var(--muted)' : (pct >= 0 ? '#166534' : 'var(--bad)')}">`
        + `${pct === null ? '—' : (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(1) + '%'}</div><div class="l">Week on week</div></div>
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Article types</div></div>
      <div class="metric"><div class="v"><span style="color:#166534">${nf(up)}</span> / <span style="color:var(--bad)">${nf(down)}</span></div><div class="l">Up / down</div></div>
    </div></div>` + repManpowerCard(week, brand);

  /* ---- THE CHARTS. Every figure on them is in the table below, so nothing is only a picture. ---- */
  const wkLabel = w => repWkRange(w).split(' – ')[0];
  const totals = weeks.map((w, i) => rows.reduce((n2, r) => n2 + (r.hist[i] || 0), 0));
  $('repCharts').classList.remove('hide');
  $('repCharts').innerHTML =
    '<div class="card repchart"><div class="repchart-h">Pieces received each week'
      + '<span class="repchart-s">' + esc(wkLabel(weeks[0])) + ' to ' + esc(repWkRange(week)) + '</span></div>'
      + repTrendSvg(weeks, totals, weeks.map(wkLabel)) + '</div>'
    + '<div class="card repchart"><div class="repchart-h">What came back last week'
      + '<span class="repchart-s">by article type &middot; the rest are in the table below</span></div>'
      + repShareSvg(rows) + '</div>';

  /* The three earlier weeks, then last week, then what changed. The last column of the trend IS
   * last week, so the eye lands on it right before the change it caused. */
  const older = weeks.slice(0, -1);
  const head = '<thead><tr>'
    + '<th class="frz">Article type</th>'
    + older.map(w => `<th class="num muted" style="font-weight:600">${esc(repWkRange(w).split(' – ')[0])}</th>`).join('')
    + `<th class="num">Last week</th><th class="num">Customer</th>`
    + `<th class="num">Change</th><th>Week on week</th><th>Trend</th>`
    + '</tr></thead>';

  const body = rows.map(r => '<tr>'
    + `<td class="frz" style="text-align:left;font-weight:600">${esc(r.art)}</td>`
    + r.hist.slice(0, -1).map(v => `<td class="num muted">${v ? nf(v) : '·'}</td>`).join('')
    + `<td class="num" style="font-weight:700">${nf(r.prod)}</td>`
    + `<td class="num">${nf(Math.round(r.cust))}</td>`
    + `<td class="num"${r.delta ? ` style="font-weight:700;color:${r.delta > 0 ? '#166534' : 'var(--bad)'}"` : ''}>`
    + `${r.delta ? (r.delta > 0 ? '+' : '') + nf(r.delta) : '<span class="muted">—</span>'}</td>`
    + `<td>${repPctCell(r)}</td>`
    /* THE SHAPE OF ITS WEEKS. The figures are already in the columns to the left — this is for the
     * one thing a row of numbers cannot show, which is whether it is climbing or falling. */
    + `<td style="padding:4px 10px">${repSparkSvg(r.hist, weeks.map(wkLabel))}</td></tr>`).join('');

  const foot = '<tfoot><tr>'
    + '<td class="frz" style="text-align:left;font-weight:700">All articles</td>'
    + older.map((w, i) => `<td class="num" style="font-weight:700">${nf(rows.reduce((n2, r) => n2 + r.hist[i], 0))}</td>`).join('')
    + `<td class="num" style="font-weight:700">${nf(prod)}</td>`
    + `<td class="num" style="font-weight:700">${nf(Math.round(cust))}</td>`
    + `<td class="num" style="font-weight:700">${prod - prevProd ? (prod - prevProd > 0 ? '+' : '') + nf(prod - prevProd) : '—'}</td>`
    + `<td>${repPctCell({ pct, prod, delta: prod - prevProd })}</td>`
    + `<td style="padding:4px 10px">${repSparkSvg(totals, weeks.map(wkLabel))}</td></tr></tfoot>`;

  $('repTable').innerHTML = head + '<tbody>' + body + '</tbody>' + foot;
  REP.wow = { week, prevWeek, rows };
  $('repMsg').className = 'muted';
  /* When the earlier weeks are all empty, say WHY rather than leaving a wall of zeroes to be read as
   * a collapse in production. */
  const emptyBefore = prevProd === 0 && rows.every(r => r.hist.slice(0, -1).every(v => !v));
  /* Short (Ravi struck the long explanation through, 29 Sep): only what needs him, and a way to find those rows. */
  const nUnd = REP_UNDATED ? repUndatedRows(brand).length : 0;
  $('repMsg').className = emptyBefore ? 'err' : 'muted';
  $('repMsg').innerHTML = (emptyBefore
    ? `Nothing came back in the ${nf(weeks.length - 1)} weeks before this one, so there is nothing to compare against yet. `
    : '')
    + (REP_UNDATED
      ? `<b>${nf(REP_UNDATED)} piece(s) have come back but carry no receiving date</b> — ${nf(nUnd)} Job Work row(s) only part-received, `
        + `so they are in no week yet. <button type="button" class="ghost" data-repundated="1" style="height:28px;padding:0 12px;margin-left:6px">Download these rows</button>`
      : '');
}

/** The weeks the picker offers: the last twelve that have finished, newest first. */
function repFillWeeks() {
  const el = $('repWk'); if (!el) return;
  const last = repLastFullWeek();
  const opts = [];
  for (let i = 0; i < 12; i++) opts.push(repWkShift(last, -i));
  const keep = el.value;
  el.innerHTML = opts.map(w => `<option value="${w}">${esc(repWkRange(w))}</option>`).join('');
  el.value = opts.indexOf(keep) >= 0 ? keep : last;
}

function repRenderWeekly(inhouseOnly) {
  const ym = $('repMonth').value;
  if (!ym) { ptEmpty('repTable', 'Pick a month.'); $('repMsg').textContent = ''; $('repKpis').innerHTML = ''; return; }
  const yr = +ym.split('-')[0], mo = +ym.split('-')[1];
  const brand = $('repBrand').value;
  const { weeks, byWeek, arts } = repWeekly(yr, mo, brand, inhouseOnly);
  if (!weeks.length) {
    ptEmpty('repTable', 'No press entries in a week that starts in that month.');
    $('repKpis').innerHTML = ''; $('repMsg').className = 'muted';
    $('repMsg').textContent = 'A week belongs to the month its Sunday falls in, so the first days of a month can sit in the month before.';
    return;
  }
  const cell = (w, a, f) => ((byWeek[w] && byWeek[w][a]) || { cust: 0, prod: 0 })[f];
  const rowTot = (a, f) => weeks.reduce((s, w) => s + cell(w, a, f), 0);
  const colTot = (w, f) => arts.reduce((s, a) => s + cell(w, a, f), 0);
  const grand = f => arts.reduce((s, a) => s + rowTot(a, f), 0);
  const n = v => (Math.round(v) ? nf(Math.round(v)) : '<span class="muted">—</span>');

  $('repKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">${inhouseOnly ? 'Inhouse production' : 'Weekly production'}
      · ${esc(ym)}${brand ? ' · ' + esc(brand) : ''}</span>
      <span class="kpiwhen">from press inventory${REP.at ? ' · ' + esc(REP.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(weeks.length)}</div><div class="l">Weeks</div></div>
      <div class="metric"><div class="v">${nf(Math.round(grand('prod')))}</div><div class="l">Production-facing pieces</div></div>
      <div class="metric"><div class="v" style="color:var(--accent)">${nf(Math.round(grand('cust')))}</div><div class="l">Customer-facing pieces</div></div>
      <div class="metric"><div class="v">${nf(arts.length)}</div><div class="l">Article types</div></div>
    </div></div>`;

  $('repTable').innerHTML = '<thead><tr>'
    + '<th class="frz" rowspan="2">Article type</th>'
    + weeks.map(w => `<th colspan="2">week of ${esc(repWeekLabel(w))}</th>`).join('')
    + '<th colspan="2">Month</th></tr><tr>'
    + weeks.concat(['tot']).map(() => '<th class="num" style="font-size:11px">Customer</th><th class="num" style="font-size:11px">Production</th>').join('')
    + '</tr></thead><tbody>'
    + arts.map(a => '<tr>'
      + `<td class="frz" style="text-align:left;font-weight:600">${esc(a)}</td>`
      + weeks.map(w => `<td class="num">${n(cell(w, a, 'cust'))}</td><td class="num">${n(cell(w, a, 'prod'))}</td>`).join('')
      + `<td class="num" style="font-weight:700">${n(rowTot(a, 'cust'))}</td>`
      + `<td class="num" style="font-weight:700">${n(rowTot(a, 'prod'))}</td></tr>`).join('')
    + '<tr style="background:var(--hover)">'
    + '<td class="frz" style="text-align:left;font-weight:800">Total</td>'
    + weeks.map(w => `<td class="num" style="font-weight:800">${n(colTot(w, 'cust'))}</td><td class="num" style="font-weight:800">${n(colTot(w, 'prod'))}</td>`).join('')
    + `<td class="num" style="font-weight:800">${n(grand('cust'))}</td><td class="num" style="font-weight:800">${n(grand('prod'))}</td></tr>`
    + '</tbody>';

  $('repMsg').className = 'muted';
  $('repMsg').textContent = 'Weeks run Sunday to Saturday and belong to the month their Sunday falls in. '
    + 'Customer-facing divides by the pack size; production-facing is pieces off the press. '
    + 'Opening-balance rows are left out — they are stock carried in, not work done.'
    + (inhouseOnly ? ' Only SKUs the factory makes itself: cutting required, or a custom SKU, or a tablecloth or table runner.' : '');
}

/* ---- what the finished-goods store is worth ---- */
function repRenderFgVal() {
  const stock = fgiStock();
  const brand = $('repBrand').value;
  const rows = [];
  stock.forEach(b => {
    if (b.current <= 0) return;                              // only what is actually there
    const m = (PTG.mdb || []).find(r => r && obUC(r.sku) === obUC(b.sku)) || {};
    if (brand && String(m.brand || '').trim() !== brand) return;
    const price = parseFloat(m.inventoryValuationPrice);
    const pack = repPack(b.sku);
    rows.push({ sku: b.sku, brand: String(m.brand || '').trim() || '—',
      articleType: String(m.articleType || '').trim() || '(unknown)', subtype: String(m.subtype || '').trim(),
      pieces: b.current, cust: b.current / pack, pack,
      price: isFinite(price) ? price : null, value: isFinite(price) ? b.current * price : 0 });
  });
  rows.sort((a, b) => b.value - a.value || b.pieces - a.pieces);
  REP.shown = rows;
  const sum = f => rows.reduce((s, r) => s + f(r), 0);
  const noPrice = rows.filter(r => r.price === null);

  $('repKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Finished goods valuation${brand ? ' · ' + esc(brand) : ''}</span>
      <span class="kpiwhen">stock in the store × the price on the master database</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">SKUs in stock</div></div>
      <div class="metric"><div class="v">${nf(Math.round(sum(r => r.pieces)))}</div><div class="l">Production-facing pieces</div></div>
      <div class="metric"><div class="v">${nf(Math.round(sum(r => r.cust)))}</div><div class="l">Customer-facing pieces</div></div>
      <div class="metric"><div class="v" style="color:var(--accent)">${nf(Math.round(sum(r => r.value)))}</div><div class="l">Value, rupees</div></div>
      <div class="metric"><div class="v"${noPrice.length ? ' style="color:var(--bad)"' : ''}>${nf(noPrice.length)}</div><div class="l">SKUs with no price</div></div>
    </div></div>`;

  $('repTable').innerHTML = '<thead><tr>' + ['SKU', 'Image', 'Brand', 'Article', 'Subtype', 'Pack', 'Pieces', 'Customer-facing', 'Price', 'Value']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 5 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead><tbody>'
    + (rows.length ? rows.slice(0, 600).map(r => '<tr>'
      + `<td class="frz" style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
      + ptImgCell(r.sku)
      + `<td>${esc(r.brand)}</td><td>${esc(r.articleType)}</td><td>${esc(r.subtype)}</td>`
      + `<td class="num">${nf(r.pack)}</td><td class="num" style="font-weight:700">${nf(r.pieces)}</td>`
      + `<td class="num">${nf(Math.round(r.cust))}</td>`
      /* A missing price is shown as missing. A zero would quietly value the stock at nothing. */
      + `<td class="num">${r.price === null ? '<span class="pill pill-out">no price</span>' : nf(r.price)}</td>`
      + `<td class="num" style="font-weight:700">${r.price === null ? '<span class="muted">—</span>' : nf(Math.round(r.value))}</td></tr>`).join('')
      : '<tr><td colspan="10" class="muted" style="padding:16px">Nothing is in the finished-goods store yet.</td></tr>')
    + '</tbody>';

  const priced = (PTG.mdb || []).filter(r => isFinite(parseFloat(r.inventoryValuationPrice))).length;
  $('repMsg').className = noPrice.length ? 'err' : 'muted';
  $('repMsg').textContent = `${nf(rows.length)} SKU(s) in stock`
    + (noPrice.length ? ` · ${nf(noPrice.length)} of them have no valuation price on the master database, so they are counted in the pieces and NOT in the value` : '')
    + ` · only ${nf(priced)} of ${nf((PTG.mdb || []).length)} SKUs in the whole catalogue carry a price at all`;
  ptImgFill(rows.slice(0, 600).map(r => r.sku), false, ptImgPatch);
}

/* ---- surplus: anything made beyond what the order asked for ---- */
function repSurplus(weeksN, brand) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const lastSat = new Date(today); lastSat.setDate(today.getDate() + (6 - today.getDay())); lastSat.setHours(23, 59, 59, 999);
  const ends = [];
  for (let i = weeksN; i >= 0; i--) { const e = new Date(lastSat); e.setDate(lastSat.getDate() - i * 7); e.setHours(23, 59, 59, 999); ends.push(e); }

  const ok = sku => !brand || repBrand(sku) === brand;
  /* Ordered, per ORDER LINE — the same key the caps measure against. */
  const ordered = new Map();
  (PTG.ob || []).forEach(l => { if (!l || !l.orderNo || !l.sku || !ok(l.sku)) return;
    const k = obUC(l.orderNo) + '|' + obUC(l.sku);
    ordered.set(k, (ordered.get(k) || 0) + obPieces(l)); });

  const events = (rows, dateField, qtyOf) => {
    const base = new Map(), live = [];
    (rows || []).forEach(r => {
      if (!r || !r.orderNo || !ok(r.sku)) return;
      const k = obUC(r.orderNo) + '|' + obUC(r.sku);
      if (!ordered.has(k)) return;
      if (r.legacy === true || r.legOpening === true) { base.set(k, (base.get(k) || 0) + qtyOf(r)); return; }
      const ms = ptDtMs(r[dateField] || r.addedAt); if (!ms) return;
      live.push({ k, sku: obUC(r.sku), qty: qtyOf(r), ms });
    });
    return { base, live };
  };
  const P = events(PTG.press, 'entryDate', r => parseInt(r.pieces, 10) || 0);
  const C = events(PT.cut, 'cutDate', r => (r.rejected === true ? -(parseInt(r.rejPieces, 10) || 0) : (parseInt(r.pieces, 10) || 0)));

  /* Surplus AT a point in time: cumulative made, less what was ordered, never below nothing. */
  const snap = (E, ev) => {
    const cum = new Map(ev.base);
    ev.live.forEach(x => { if (x.ms <= E.getTime()) cum.set(x.k, (cum.get(x.k) || 0) + x.qty); });
    let total = 0; const byAt = new Map();
    ordered.forEach((q, k) => {
      const over = Math.max(0, (cum.get(k) || 0) - q);
      if (!over) return;
      total += over;
      const at = repAt(k.split('|')[1]);
      byAt.set(at, (byAt.get(at) || 0) + over);
    });
    return { total, byAt };
  };
  const snaps = ends.map(E => ({ press: snap(E, P), cut: snap(E, C) }));

  const madeIn = (ev, from, to) => ev.live.reduce((s, x) => s + ((x.ms >= from && x.ms <= to) ? x.qty : 0), 0);
  const series = [];
  for (let i = 1; i < ends.length; i++) {
    const E = ends[i], ws = new Date(E); ws.setDate(E.getDate() - 6); ws.setHours(0, 0, 0, 0);
    series.push({
      end: E,
      overPress: snaps[i].press.total - snaps[i - 1].press.total,
      overCut: snaps[i].cut.total - snaps[i - 1].cut.total,
      madePress: madeIn(P, ws.getTime(), E.getTime()),
      madeCut: madeIn(C, ws.getTime(), E.getTime()),
    });
  }
  return { series, standing: snaps[snaps.length - 1] };
}

function repRenderSurplus() {
  const n = parseInt($('repWeeks').value, 10) || 12;
  const { series, standing } = repSurplus(n, $('repBrand').value);
  const totalOver = standing.press.total, totalOverCut = standing.cut.total;
  $('repKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Surplus</span>
      <span class="kpiwhen">made beyond what the order line asked for</span></div>
    <div class="metrics">
      <div class="metric"><div class="v"${totalOver ? ' style="color:var(--bad)"' : ''}>${nf(Math.round(totalOver))}</div><div class="l">Pressed over, standing</div></div>
      <div class="metric"><div class="v"${totalOverCut ? ' style="color:var(--bad)"' : ''}>${nf(Math.round(totalOverCut))}</div><div class="l">Cut over, standing</div></div>
      <div class="metric"><div class="v">${nf(Math.round(series.reduce((s, x) => s + x.madePress, 0)))}</div><div class="l">Pressed in these weeks</div></div>
      <div class="metric"><div class="v">${nf(Math.round(series.reduce((s, x) => s + x.madeCut, 0)))}</div><div class="l">Cut in these weeks</div></div>
    </div></div>`;

  const wk = d => { const s = new Date(d); s.setDate(d.getDate() - 6);
    return String(s.getDate()).padStart(2, '0') + '–' + String(d.getDate()).padStart(2, '0') + ' '
      + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]; };
  const pc = (a, b) => (b > 0 ? Math.round(a / b * 100) + '%' : '<span class="muted">—</span>');
  $('repTable').innerHTML = '<thead><tr>'
    + ['Week (Sun–Sat)', 'Pressed', 'Over', '% over', 'Cut', 'Over', '% over']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : ' class="num"'}>${h}</th>`).join('') + '</tr></thead><tbody>'
    + series.slice().reverse().map(s => '<tr>'
      + `<td class="frz" style="text-align:left">${esc(wk(s.end))} <span class="muted">${s.end.getFullYear()}</span></td>`
      + `<td class="num" style="font-weight:700">${nf(Math.round(s.madePress))}</td>`
      + `<td class="num"${s.overPress ? ' style="color:var(--bad);font-weight:700"' : ''}>${s.overPress ? nf(Math.round(s.overPress)) : '<span class="muted">—</span>'}</td>`
      + `<td class="num">${pc(s.overPress, s.madePress)}</td>`
      + `<td class="num" style="font-weight:700">${nf(Math.round(s.madeCut))}</td>`
      + `<td class="num"${s.overCut ? ' style="color:var(--bad);font-weight:700"' : ''}>${s.overCut ? nf(Math.round(s.overCut)) : '<span class="muted">—</span>'}</td>`
      + `<td class="num">${pc(s.overCut, s.madeCut)}</td></tr>`).join('')
    + '</tbody>';

  /* With the caps live, over-production cannot be entered. So a figure here is not a busy week —
   * it is data that got in before the caps, or around them, and it is worth going and looking at. */
  $('repMsg').className = (totalOver || totalOverCut) ? 'err' : 'muted';
  $('repMsg').textContent = (totalOver || totalOverCut)
    ? `Something has been made beyond its order line. The caps refuse that on entry, so these pieces `
      + `either predate the caps or were entered without an Order ID and later matched. Worth looking at: `
      + [...standing.press.byAt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([a, v]) => `${a} ${nf(Math.round(v))}`).join(', ')
    : 'Nothing has been made beyond what its order line asked for. That is what the caps are there to ensure.';
}

/* ---- quality: the week's QC-passed pieces ARE the week's production ----
 *
 * Ravi, 2026-10-07: "weekly production review meeting qc passed pcs par hoga … weekly q.c se jitne pcs pass hokar jayenge
 * wo hi real production count hoga". A week is Sunday to Saturday, the same weeks as "Last week · received" (Ravi,
 * 2026-10-07: "week days ye hi rakho"). A check counts on the day it was recorded; "passed" is every piece QC let through
 * that day — straight passes and pieces back from spotting or touching alike. "All time" keeps the old view: every check,
 * worst SKU first.
 *
 * KEPT APART (Ravi, 2026-10-07: "Q.C pass me pillow insert embroidery napkin ka data apart rkhna h"): pillow inserts —
 * the same rule the production report uses (repIsInsert) — and embroidery napkins are shown in their own box and are not
 * in the week's production, its trend, its articles, its karigars or its SKU table.
 */
const qaWeekStart = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d; };
function qaApart(r) {
  const m = mdbOf(r && r.sku) || {};
  if (repIsInsert(r)) return 'Pillow insert';
  const t = [r && r.articleType, r && r.subtype, m.articleType, m.subtype].join(' ');
  return /embroider/i.test(t) && /napkin/i.test(t) ? 'Embroidery napkin' : '';
}
const qaIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const qaShift = (iso, days) => { const p = iso.split('-').map(Number); const d = new Date(p[0], p[1] - 1, p[2]); d.setDate(d.getDate() + days); return qaIso(d); };
const qaRange = iso => { const f = d => new Date(d.split('-').map(Number)[0], d.split('-').map(Number)[1] - 1, d.split('-').map(Number)[2])
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); return f(iso) + ' – ' + f(qaShift(iso, 6)); };
function qaFillWeeks() {
  const el = $('repQaWk'); if (!el) return '';
  const now = qaIso(qaWeekStart(Date.now()));
  const want = [['', 'All time'], [now, 'This week so far · ' + qaRange(now)]];
  for (let i = 1; i <= 12; i++) { const w = qaShift(now, -7 * i); want.push([w, qaRange(w)]); }
  const sig = want.map(w => w[0]).join(',');
  if (el.dataset.sig !== sig) {
    const keep = el.dataset.sig ? el.value : qaShift(now, -7);          // first time: last full week
    el.innerHTML = want.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
    el.value = want.some(w => w[0] === keep) ? keep : qaShift(now, -7);
    el.dataset.sig = sig;
  }
  return el.value;
}
function repRenderQa() {
  const brand = $('repBrand').value, q = $('repQ').value.trim().toLowerCase();
  /* The Quality Control tab may already have them loaded; if not, this tab fetched its own copy. */
  const rows = (QC && QC.checks && QC.checks.length) ? QC.checks : (REP.qc || []);
  const all = rows.filter(r => r && (!brand || String(r.brand || '').trim() === brand)
    && (!q || [r.sku, r.articleType, r.color, r.size, r.checkedBy, r.karigar].join(' ').toLowerCase().includes(q)));
  const wk = qaFillWeeks();
  const wkOf = r => { const ms = ptDtMs(r.date); return ms ? qaIso(qaWeekStart(ms)) : ''; };
  const base = wk ? all.filter(r => !qaApart(r)) : all, apartAll = wk ? all.filter(r => qaApart(r)) : [];
  const checks = wk ? base.filter(r => wkOf(r) === wk) : all;
  const sum = (list, f) => list.reduce((s, r) => s + (Number(r[f]) || 0), 0);
  const chk = sum(checks, 'checked'), okp = sum(checks, 'ok'), rej = sum(checks, 'rejected'), alt = sum(checks, 'forAlteration');
  const pct = (v, b) => (b > 0 ? (Math.round(v / b * 1000) / 10) + '%' : '—');

  let head = '';
  if (wk) {
    const prevWk = qaShift(wk, -7), prev = sum(base.filter(r => wkOf(r) === prevWk), 'ok'), d = okp - prev;
    const target = typeof paTarget === 'function' ? paTarget() : 20000;
    const thisWeek = wk === qaIso(qaWeekStart(Date.now()));
    const days = [...Array(7)].map((_, i) => { const iso = qaShift(wk, i);
      return { iso, label: new Date(iso.split('-').map(Number)[0], iso.split('-').map(Number)[1] - 1, iso.split('-').map(Number)[2]).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }),
        ok: checks.filter(r => { const ms = ptDtMs(r.date); return ms && qaIso(new Date(ms)) === iso; }).reduce((s, r) => s + (Number(r.ok) || 0), 0) }; });
    const trend = [...Array(8)].map((_, i) => { const w = qaShift(wk, -7 * (7 - i)); return { w, ok: sum(base.filter(r => wkOf(r) === w), 'ok') }; });
    const maxT = Math.max(1, ...trend.map(t => t.ok));
    const group = (f, list) => { const m = new Map(); list.forEach(r => { const k = f(r) || '—'; m.set(k, (m.get(k) || 0) + (Number(r.ok) || 0)); }); return m; };
    const artOf = r => String(r.articleType || (mdbOf(r.sku) || {}).articleType || '').trim();
    const artNow = group(artOf, checks), artPrev = group(artOf, base.filter(r => wkOf(r) === prevWk));
    const arts = [...new Set([...artNow.keys(), ...artPrev.keys()])].map(k => ({ k, now: artNow.get(k) || 0, prev: artPrev.get(k) || 0 }))
      .filter(x2 => x2.now || x2.prev).sort((p, n) => n.now - p.now || n.prev - p.prev);
    const kar = [...group(r => String(r.karigar || '').trim(), checks.filter(r => r.karigar)).entries()].sort((p, n) => n[1] - p[1]);
    const delta = v => v === 0 ? '<span class="muted">±0</span>' : `<span style="color:${v > 0 ? '#166534' : 'var(--bad)'}">${v > 0 ? '+' : '−'}${nf(Math.abs(v))}</span>`;
    const box = (title, html) => `<div class="kpi" style="flex:1 1 280px;min-width:0"><div class="kpihead"><span class="kpiname">${title}</span></div>${html}</div>`;
    const mini = (cols, body) => `<table class="xl" style="font-size:12.5px;width:100%"><thead><tr>${cols.map((c, i) => `<th${i ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
    const apart = ['Pillow insert', 'Embroidery napkin'].map(k => {
      const mine = apartAll.filter(r => qaApart(r) === k), now = mine.filter(r => wkOf(r) === wk);
      return { k, now: sum(now, 'ok'), prev: sum(mine.filter(r => wkOf(r) === prevWk), 'ok'), chk: sum(now, 'checked'), bad: sum(now, 'rejected') + sum(now, 'forAlteration') };
    });
    REP.qaWeek = { wk, days, trend, arts, kar, okp, prev, chk, rej, alt, apart };
    head = `<div class="kpi" style="flex-basis:100%">
      <div class="kpihead"><span class="kpiname">Production = pieces passed by QC · ${esc(qaRange(wk))}${thisWeek ? ' (so far)' : ''}${brand ? ' · ' + esc(brand) : ''}</span>
        <span class="kpiwhen">Sunday to Saturday · ${nf(checks.length)} check(s) · pillow insert and embroidery napkin apart</span></div>
      <div class="metrics">
        <div class="metric"><div class="v" style="color:#166534;font-size:28px">${nf(okp)}</div><div class="l">QC passed — this week's production</div></div>
        <div class="metric"><div class="v">${delta(d)}</div><div class="l">vs last week (${nf(prev)})${prev ? ' · ' + (d >= 0 ? '+' : '') + Math.round(d / prev * 100) + '%' : ''}</div></div>
        <div class="metric"><div class="v">${Math.round(okp / target * 100)}%</div><div class="l">of the ${nf(target)} weekly target</div></div>
        <div class="metric"><div class="v">${nf(chk)}</div><div class="l">Pieces checked</div></div>
        <div class="metric"><div class="v" style="color:var(--bad)">${nf(rej)}</div><div class="l">Rejected · ${pct(rej, chk)}</div></div>
        <div class="metric"><div class="v" style="color:#7f6000">${nf(alt)}</div><div class="l">For alteration · ${pct(alt, chk)}</div></div>
      </div></div>`
      + box('Kept apart — not in the production above', mini(['', 'This week', 'Last week', 'Change'], apart.map(a2 => `<tr><td>${esc(a2.k)}</td><td class="num" style="font-weight:700">${nf(a2.now)}</td><td class="num">${nf(a2.prev)}</td><td class="num">${delta(a2.now - a2.prev)}</td></tr>`).join('')
        + `<tr style="font-weight:700"><td>Together</td><td class="num">${nf(apart.reduce((t, a2) => t + a2.now, 0))}</td><td class="num">${nf(apart.reduce((t, a2) => t + a2.prev, 0))}</td><td></td></tr>`)
        + `<div class="muted" style="font-size:11px;margin-top:4px">QC passed pieces. With them, the week would read ${nf(okp + apart.reduce((t, a2) => t + a2.now, 0))}.</div>`)
      + box('Day by day — QC passed', mini(['Day', 'Passed'], days.map(x2 => `<tr><td>${esc(x2.label)}</td><td class="num"${x2.ok ? ' style="font-weight:700"' : ''}>${x2.ok ? nf(x2.ok) : '<span class="muted">—</span>'}</td></tr>`).join('')
        + `<tr style="font-weight:700"><td>Week</td><td class="num">${nf(okp)}</td></tr>`))
      + box('Last 8 weeks — QC passed', mini(['Week', 'Passed', ''], trend.map(t => `<tr${t.w === wk ? ' style="font-weight:700"' : ''}><td>${esc(qaRange(t.w))}</td><td class="num">${nf(t.ok)}</td>`
        + `<td style="width:40%"><div style="height:8px;background:var(--line);border-radius:4px"><div style="height:8px;width:${Math.round(t.ok / maxT * 100)}%;background:#166534;border-radius:4px"></div></div></td></tr>`).join('')))
      + box('By article — this week vs last', mini(['Article', 'This week', 'Last week', 'Change'], arts.map(x2 => `<tr><td>${esc(x2.k)}</td><td class="num" style="font-weight:700">${nf(x2.now)}</td><td class="num">${nf(x2.prev)}</td><td class="num">${delta(x2.now - x2.prev)}</td></tr>`).join('')
        || '<tr><td colspan="4" class="muted">Nothing passed this week.</td></tr>'))
      + (kar.length ? box('By karigar — QC passed', mini(['Karigar', 'Passed'], kar.slice(0, 25).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${nf(v)}</td></tr>`).join(''))
        + `<div class="muted" style="font-size:11px;margin-top:4px">Only checks taken from "Waiting for QC" (since 5 Oct) name the karigar · ${nf(sum(checks.filter(r => !r.karigar), 'ok'))} passed piece(s) carry no name</div>`) : '');
  } else {
    REP.qaWeek = null;
    head = `<div class="kpi" style="flex-basis:100%">
      <div class="kpihead"><span class="kpiname">Quality · all time${brand ? ' · ' + esc(brand) : ''}</span>
        <span class="kpiwhen">${nf(checks.length)} check(s) recorded</span></div>
      <div class="metrics">
        <div class="metric"><div class="v">${nf(chk)}</div><div class="l">Pieces checked</div></div>
        <div class="metric"><div class="v" style="color:var(--accent)">${nf(okp)}</div><div class="l">Passed · ${pct(okp, chk)}</div></div>
        <div class="metric"><div class="v" style="color:var(--bad)">${nf(rej)}</div><div class="l">Rejected · ${pct(rej, chk)}</div></div>
        <div class="metric"><div class="v" style="color:#7f6000">${nf(alt)}</div><div class="l">For alteration · ${pct(alt, chk)}</div></div>
      </div></div>`;
  }
  $('repKpis').innerHTML = head;

  const by = new Map();
  checks.forEach(r => {
    const k = obUC(r.sku) || '(no sku)';
    const o = by.get(k) || { sku: k, articleType: r.articleType || '', color: r.color || '', size: r.size || '', chk: 0, ok: 0, rej: 0, alt: 0 };
    o.chk += Number(r.checked) || 0; o.ok += Number(r.ok) || 0;
    o.rej += Number(r.rejected) || 0; o.alt += Number(r.forAlteration) || 0;
    by.set(k, o);
  });
  /* A week is read for what it MADE — most passed first. All time is read for what keeps coming back — worst first. */
  const list = [...by.values()].sort(wk
    ? (a2, b2) => b2.ok - a2.ok || b2.chk - a2.chk
    : (a2, b2) => ((b2.rej + b2.alt) / (b2.chk || 1)) - ((a2.rej + a2.alt) / (a2.chk || 1)) || b2.chk - a2.chk);
  REP.shown = list;

  $('repTable').innerHTML = '<thead><tr>' + ['SKU', 'Image', 'Article', 'Colour', 'Size', 'Checked', 'Passed', 'Rejected', 'For alteration', 'Bad']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 5 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead><tbody>'
    + (list.length ? list.slice(0, 600).map(o => {
      const bad = o.chk ? (o.rej + o.alt) / o.chk : 0;
      return '<tr>'
        + `<td class="frz" style="font-family:ui-monospace,monospace;text-align:left">${esc(o.sku)}</td>`
        + ptImgCell(o.sku)
        + `<td>${esc(o.articleType)}</td><td>${esc(o.color)}</td><td>${esc(o.size)}</td>`
        + `<td class="num">${nf(o.chk)}</td>`
        + `<td class="num" style="color:var(--accent);font-weight:${wk ? 700 : 400}">${nf(o.ok)} <span class="muted" style="font-size:11px">${pct(o.ok, o.chk)}</span></td>`
        + `<td class="num" style="color:var(--bad)">${o.rej ? nf(o.rej) : '<span class="muted">—</span>'} <span class="muted" style="font-size:11px">${o.rej ? pct(o.rej, o.chk) : ''}</span></td>`
        + `<td class="num" style="color:#7f6000">${o.alt ? nf(o.alt) : '<span class="muted">—</span>'} <span class="muted" style="font-size:11px">${o.alt ? pct(o.alt, o.chk) : ''}</span></td>`
        + `<td class="num"><div style="font-weight:700;color:${bad > 0.1 ? 'var(--bad)' : 'var(--muted)'}">${pct(o.rej + o.alt, o.chk)}</div>`
        + `<div style="height:4px;background:var(--line);border-radius:3px;margin-top:3px">`
        + `<div style="height:4px;width:${Math.min(100, Math.round(bad * 100))}%;background:var(--bad);border-radius:3px"></div></div></td></tr>`;
    }).join('') : '<tr><td colspan="10" class="muted" style="padding:16px">No quality checks match.</td></tr>')
    + '</tbody>';

  $('repMsg').className = 'muted';
  $('repMsg').textContent = wk
    ? `${nf(list.length)} SKU(s) passed QC in ${qaRange(wk)}, most first · passed = straight passes and pieces back from spotting or touching · "Bad" is rejected plus for-alteration, as a share of what was checked`
    : `${nf(list.length)} SKU(s), worst first · "Bad" is rejected plus for-alteration, as a share of what was checked · a check records what one person looked at on one day, not a whole batch`;
  ptImgFill(list.slice(0, 400).map(o => o.sku), false, ptImgPatch);
}

const REP_VIEWS = { wpr: 'Weekly production', ihp: 'Inhouse production', fgval: 'Finished goods valuation',
  srpl: 'Surplus', qa: 'Quality' };

