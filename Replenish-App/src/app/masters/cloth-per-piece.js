/* ================= HOW MUCH CLOTH ONE PIECE TAKES =================
 *
 * Ravi's method, exactly: two inches of stitching margin each way, then find the roll the cut
 * rectangle comes off with nothing wasted across its width.
 */

/** The two inches. */
const PT_MARGIN_IN = 2;

/**
 * The raw cut, in inches. Null — with a reason — when the size is not a rectangle this can work on.
 *
 * One number is a round: a 90" round tablecloth is cut from a 92" square, because that is what you
 * put under the cutter. Three or four numbers are a box or a pair, and are left alone rather than
 * guessed at.
 */
function ptCutOf(size) {
  const raw = String(size || '').trim();
  if (!raw) return { why: 'no size on the master row' };
  const nums = (raw.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(n => n > 0);
  if (!nums.length) return { why: `size "${raw}" has no measurement in it` };
  if (nums.length === 1) return { w: nums[0] + PT_MARGIN_IN, l: nums[0] + PT_MARGIN_IN, round: true };
  if (nums.length === 2) return { w: nums[0] + PT_MARGIN_IN, l: nums[1] + PT_MARGIN_IN };
  return { why: `size "${raw}" is not a single rectangle — ${nums.length} measurements` };
}

/**
 * Every fabric that can be laid on, with its width in inches — the master's figure, else the number
 * in its name. cutFabrics() already answers "which fabrics are on offer", retired ones dropped; this
 * only adds the width and leaves out the ones that have none, because a roll of unknown width cannot
 * be cut from.
 */
/* Built once per fabric master. It was rebuilt inside ptConsPlan for every SKU the consumption or
 * the printer forecast asked about — the same dozen rolls, sorted again four thousand times. Nothing
 * that is handed this list changes it. */
let PFW_IX = { src: null, rows: null };
function ptFabricWidths() {
  const src = (PTG.masters || {}).fabricType;
  if (PFW_IX.src === src && PFW_IX.rows) return PFW_IX.rows;
  const rows = cutFabrics()
    .map(name => ({ fabric: name, widthIn: Math.round((voFabWidthM(name) / 0.0254) * 100) / 100 }))
    .filter(f => f.widthIn > 0)
    .sort((a, b) => a.widthIn - b.widthIn);
  PFW_IX = { src, rows };
  return rows;
}

/**
 * Which way round a piece may be laid on the cloth.
 *
 * '' — either way, whichever wastes least. 'width' — the product's width lies across the roll, never
 * turned. 'length' — always turned, the product's length across the roll. It is not the same question
 * as the Direction field, which is about which way the design sits.
 */
const PT_LAYS = [['', 'Either way — whichever wastes least'],
  ['width', 'Width across the cloth (never turned)'],
  ['length', 'Length across the cloth (always turned)']];
const ptLayOf = m => {
  const r = ptPrintRuleOf(m);
  const v = String((r && r.lay) || '').trim();
  return (v === 'width' || v === 'length') ? v : '';
};

/** How a cut rectangle lies on one roll, or null when it will not fit across it at all. */
function ptLayOn(cut, widthIn, lay) {
  const both = [[cut.w, cut.l, false], [cut.l, cut.w, true]];
  const allowed = lay === 'width' ? both.slice(0, 1) : lay === 'length' ? both.slice(1) : both;
  const tries = allowed.map(([cw, cl, turned]) => {
    const across = Math.floor(widthIn / cw);
    if (across < 1) return null;
    return { across, cutAcross: cw, cutAlong: cl, turned,
      metres: (cl / across) * 0.0254,
      waste: 1 - (across * cw) / widthIn };
  }).filter(Boolean);
  if (!tries.length) return null;
  /* LEAST CLOTH WINS. On ONE roll the width is fixed, so least run is least cloth. A tie goes to the
   * piece that is not turned — the product's width lies across the cloth's width, which is how it is
   * cut on the table. */
  return tries.sort((a, b) => a.metres - b.metres || (a.turned ? 1 : 0) - (b.turned ? 1 : 0))[0];
}

/* WHICH WAY A QUILT IS PRINTED (Ravi, 2026-09-30). The quilt is laid on the roll the way that takes least cloth; when
 * its LONG side runs across the cloth the design is printed Horizontal, when the short side does, Vertical:
 *   60x90  on Voil 92  → the 92" cut (90 + 2) across the 92" roll → Horizontal
 *   90x96  on Voil 92  → only the 92" side fits across → Vertical
 *   96x106 on Voil 112 → the 108" side across the 112" roll → Horizontal
 * Only quilts, which is what Ravi described; everything else keeps the direction the office picks. */
const ptIsQuilt = m => /quilt/i.test(String((m && m.articleType) || '') + ' ' + String((m && m.subtype) || ''));
function ptPrintDir(m, fab) {
  if (!ptIsQuilt(m)) return '';
  const cut = ptCutOf(m && m.size);
  if (cut.why || cut.round) return '';
  const w = voFabWidthM(fab) / 0.0254;
  if (!(w > 0)) return '';
  const on = ptLayOn(cut, w, ptLayOf(m));
  if (!on) return '';
  return on.cutAcross >= on.cutAlong ? 'Horizontal' : 'Vertical';
}

/**
 * The plan for one master row: which roll, how many across, how much cloth a piece.
 *
 * A printing rule that names a fabric decides the cloth — it is a decision somebody made, not a
 * puzzle to solve — and the search still runs so the screen can say what it would have chosen.
 */
function ptConsPlan(m) {
  const cut = ptCutOf(m && m.size);
  if (cut.why) return { why: cut.why };
  const widths = ptFabricWidths();
  if (!widths.length) return { why: 'no fabric has a width yet — set them under Masters → Fabric type' };

  const lay = ptLayOf(m);
  const all = widths.map(f => {
    const on = ptLayOn(cut, f.widthIn, lay);
    return on ? Object.assign({ fabric: f.fabric, widthIn: f.widthIn }, on) : null;
  }).filter(Boolean);
  if (!all.length) return { why: `nothing is wide enough: the cut is ${cut.w}" × ${cut.l}"`
    + (lay ? ` laid ${lay} across the cloth` : ''), cut };
  /* ACROSS ROLLS, metres are not comparable — a metre of 92" cloth is not a metre of 62" cloth.
   * Waste is, because it is the share of the roll thrown away, so it ranks first. A tie means the
   * same cloth either way, and then the narrower roll wins: it is the cheaper one to buy, and it is
   * the one that keeps the product's width across the cloth's width, which is how it is cut. */
  const best = all.slice().sort((a, b) => a.waste - b.waste || a.widthIn - b.widthIn)[0];

  const r = ptPrintRuleOf(m);
  const ruled = String((r && r.fabric) || '').trim();
  /* "Whichever wastes least" is the absence of a name, deliberately — it is the search, not a roll. */
  const named = ruled === PRINT_BY_WIDTH ? '' : String(ruled || (m && m.fabric) || '').trim();
  const onNamed = named ? all.find(x => obUC(x.fabric) === obUC(named)) : null;
  const chosen = onNamed || best;

  /* A front and a back are two rectangles, not one. The multiple is told, never guessed. */
  const panels = Math.max(1, parseFloat(r && r.panels) || 1);
  return {
    cut, panels, lay,
    fabric: chosen.fabric, widthIn: chosen.widthIn, across: chosen.across, waste: chosen.waste,
    turned: chosen.turned, cutAcross: chosen.cutAcross, cutAlong: chosen.cutAlong,
    metres: Math.round(chosen.metres * panels * 1000) / 1000,
    fromRule: !!onNamed,
    /* What it would have picked left to itself, so a ruled fabric that wastes cloth is visible. */
    best: { fabric: best.fabric, widthIn: best.widthIn, across: best.across, waste: best.waste,
      metres: Math.round(best.metres * panels * 1000) / 1000 },
    /* And the named fabric it could not lay at all. */
    namedUnfit: !!(named && !onNamed),
    /* Every roll it can be laid on, so a cut on a fabric somebody picked is costed on that fabric. */
    options: all.map(x => ({ fabric: x.fabric, metres: Math.round(x.metres * panels * 1000) / 1000 })),
    named,
  };
}

/** The panel. */
function pafCard() {
  const need = pafNeed();
  const hist = pafHistory(($('paFabWeeks') || {}).value || 8);
  const sq = v => nf(Math.round(v));
  const weeksOfWork = hist.perWeek > 0 ? need.sqm / hist.perWeek : null;

  const headline = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Fabric from the printers · square metres</span>
      <span class="kpiwhen">open order book vs what the printers actually deliver</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${sq(need.sqm)}</div><div class="l">m² still needed</div></div>
      <div class="metric"><div class="v">${nf(need.pieces)}</div><div class="l">pieces still to make</div></div>
      <div class="metric"><div class="v" style="color:var(--accent)">${sq(hist.perWeek)}</div><div class="l">m² a week, all printers</div></div>
      <div class="metric"><div class="v"${weeksOfWork != null && weeksOfWork > 4 ? ' style="color:var(--bad)"' : ''}>${
        weeksOfWork == null ? '—' : (Math.round(weeksOfWork * 10) / 10)}</div><div class="l">weeks of printing in hand</div></div>
      <div class="metric"><div class="v">${nf(hist.vendors.length)}</div><div class="l">printers delivering</div></div>
    </div>
    ${need.unknownPcs ? `<div class="err" style="margin-top:8px;font-size:12.5px">${nf(need.unknownPcs)} piece(s) could not be
      turned into cloth — ${need.unknown.slice(0, 4).map(u => esc(u.sku) + ' (' + esc(u.why) + ')').join(', ')}${
      need.unknown.length > 4 ? ` and ${nf(need.unknown.length - 4)} more SKU(s)` : ''}. They are NOT in the figure above.</div>` : ''}
  </div>`;

  const fabRows = need.byFab.slice(0, 12).map(f => `<tr>
      <td style="text-align:left">${esc(f.fabric)}</td>
      <td class="num">${nf(f.pcs)}</td>
      <td class="num"><b>${sq(f.sqm)}</b></td>
      <td class="num">${need.sqm > 0 ? ((f.sqm / need.sqm) * 100).toFixed(0) + '%' : '—'}</td>
    </tr>`).join('');

  const wkHead = hist.keys.map(k => `<th class="num">${esc(String(k).slice(5))}</th>`).join('');
  const vendRows = hist.vendors.map(v => `<tr>
      <td style="text-align:left">${esc(v.name || v.code)}</td>
      ${hist.keys.map(k => `<td class="num">${v.weeks.get(k) ? sq(v.weeks.get(k)) : '<span class="muted">—</span>'}</td>`).join('')}
      <td class="num"><b>${sq(v.avg)}</b><div class="muted" style="font-size:10.5px">${nf(v.ranWeeks)} wk worked</div></td>
      <td class="num">${sq(v.best)}</td>
      ${v.unpriced ? `<td class="num err" title="Delivered, but the cloth could not be worked out">${nf(Math.round(v.unpriced))}</td>` : '<td class="num muted">—</td>'}
    </tr>`).join('');

  const totalRow = `<tr style="font-weight:700;border-top:2px solid var(--line)">
      <td style="text-align:left">All printers</td>
      ${hist.keys.map(k => `<td class="num">${sq(hist.vendors.reduce((s, v) => s + (v.weeks.get(k) || 0), 0))}</td>`).join('')}
      <td class="num">${sq(hist.perWeek)}</td><td class="num">—</td><td class="num">—</td>
    </tr>`;

  return headline
    + `<div style="margin-top:12px">
      <div class="card" style="padding:12px 14px">
        <div class="kpihead"><span class="kpiname">What has to be printed</span>
          <span class="kpiwhen">by fabric · from "to make" on the order book</span></div>
        <div class="xlwrap" style="max-height:320px;margin-top:8px"><table class="xl">
          <thead><tr><th>Fabric</th><th class="num">Pieces</th><th class="num">m²</th><th class="num">Share</th></tr></thead>
          <tbody>${fabRows || '<tr><td colspan="4" class="muted" style="padding:14px">Nothing is waiting to be made.</td></tr>'}</tbody>
        </table></div>
      </div>
        <div class="muted" style="margin-top:8px;font-size:12px">Each printer's own week-by-week
          delivery is on <b>Printer Allocation → Capacity from history</b>, beside the capacity
          they were given by hand.</div>
    </div>`;
}


function renderPa() {
  const box = $('paBody'); if (!box) return;
  if (PA.busy) { $('paMsg').className = 'muted'; $('paMsg').textContent = 'Reading the registers…'; return; }
  if (PA.err) { $('paMsg').className = 'err'; $('paMsg').textContent = 'Could not read: ' + PA.err; return; }
  if (!PT.base) { $('paMsg').textContent = ''; box.innerHTML = ''; return; }
  const weeks = paWeeks();
  const cur = repWkIso(paWeekStart(Date.now()));
  const sel = $('paWk');
  const keep = sel.value;
  sel.innerHTML = weeks.slice().reverse().map(w => `<option value="${w}">${w === cur ? 'This week so far · ' : ''}${esc(paWeekLabel(w))}</option>`).join('');
  sel.value = weeks.includes(keep) ? keep : cur;
  const target = paTarget();
  if (!$('paTarget').value) $('paTarget').value = String(target);

  const f = paWeekFacts(sel.value);
  const base = paAvgBase(f, $('paBasis').value);
  const need = paNeed(f, target, base);
  const pct = target ? Math.round(f.received / target * 100) : 0;
  const gap = Math.max(0, target - f.received);
  const v = paVerdict(f, need, target);
  const pctOf = (x, max) => (max ? Math.max(0, Math.min(100, x / max * 100)) : 0);
  const d1 = x => (Math.round(x * 10) / 10).toFixed(1);

  /* ==== TREND FIRST (Ravi, 2026-09-24, from eight layouts on the canvas: "Trend first") ====
   *
   * The screen opens on the weeks against the target, because one week alone cannot say whether
   * things are getting better. Beside it: this week so far, the best week, the average of the last
   * three full weeks, and the verdict. Then the days of this week and the karigar sum side by side,
   * then the flow and the four small figures. Everything below — every karigar, who made the week,
   * what to look into, the week-on-week table, the cloth — is as it was. */
  const trendFacts = weeks.slice(-8).map(w => (w === f.wk ? f : paWeekFacts(w)));
  const wkShort = w => new Date(paWkStartMs(w)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  /* ---- 1a. THE WEEKS, against the target ---- */
  const wMax = Math.max(target, ...trendFacts.map(t => t.received), 1);
  const weekChart = `<div class="card pa-card pa-wkc"><div class="pa-h"><h3>Weeks against ${nf(target)}</h3>
      <span class="muted">the dashed line is the weekly target</span></div>
    <div class="pa-wkbars" style="grid-template-columns:repeat(${trendFacts.length},minmax(0,1fr))">
      <div class="pa-need" style="bottom:${pctOf(target, wMax)}%"><span>${nf(target)}</span></div>
      ${trendFacts.map(t => `<div class="pa-wkb${t.wk === f.wk ? ' is-on' : ''}${t.received >= target ? ' is-hit' : ''}" title="${esc(paWeekLabel(t.wk))}: ${nf(t.received)} made">
        <b style="bottom:calc(${pctOf(t.received, wMax)}% + 4px)">${nf(t.received)}</b><i style="height:${pctOf(t.received, wMax)}%"></i></div>`).join('')}
    </div>
    <div class="pa-wkls" style="grid-template-columns:repeat(${trendFacts.length},minmax(0,1fr))">${trendFacts.map(t =>
      `<div${t.wk === f.wk ? ' class="is-on"' : ''}>${esc(wkShort(t.wk))}${t.partial ? '<small>so far</small>' : ''}</div>`).join('')}</div></div>`;

  /* ---- 1b. BESIDE IT: this week, the best week, the usual week, and the verdict ---- */
  const full = trendFacts.filter(t => t.wk < f.wk && !t.partial);
  const last3 = full.slice(-3);
  const avg3 = last3.length ? Math.round(last3.reduce((a, t) => a + t.received, 0) / last3.length) : 0;
  const best = trendFacts.reduce((a, t) => (!a || t.received > a.received ? t : a), null);
  const kv = (b, l, s, cls) => `<div class="card pa-kv${cls ? ' ' + cls : ''}"><b>${b}</b><span>${l}</span>${s ? `<em>${s}</em>` : ''}</div>`;
  const side = `<div class="pa-side">
    <div class="card pa-kv pa-now"><div class="pa-eyebrow">${esc(paWeekLabel(f.wk))}${f.partial ? ' · so far' : ''}</div>
      <div class="pa-big"><b>${nf(f.received)}</b><span>of ${nf(target)} pieces made</span></div>
      <div class="pa-meter" title="${pct}% of the weekly target"><span style="width:${pctOf(f.received, target)}%"></span><em>${pct}%</em></div></div>
    ${best ? kv(nf(best.received), best.wk === f.wk ? 'this week is the best of these ' + nf(trendFacts.length) : 'best week of these ' + nf(trendFacts.length) + ' · ' + esc(wkShort(best.wk)),
      (target ? Math.round(best.received / target * 100) : 0) + '% of the target') : ''}
    ${last3.length ? kv(nf(avg3), 'average of the last ' + nf(last3.length) + ' full week' + (last3.length === 1 ? '' : 's'), last3.map(t => esc(wkShort(t.wk))).join(' · ')) : ''}
    <div class="pa-verdict ${gap ? 'is-short' : 'is-ok'}">
      <b>${gap ? nf(gap) + ' short' : 'Target reached'}</b>
      <div><strong>${esc(v.head)}.</strong> ${esc(v.why)}</div>
    </div>
  </div>`;
  const top = `<div class="pa-top">${weekChart}${side}</div>`;

  /* ---- 2. HOW MANY KARIGARS: the sum on one line, its parts under it ---- */
  const extLine = need.ext.length
    ? need.ext.map(x => `${esc(x.name)}: ${nf(x.peopleNext)} people × ${d1(x.per)} × ${need.W}`).join(' · ')
    : 'no external teams this week';
  const diffCls = need.diff > 0 ? 'is-short' : 'is-ok';
  const chip = (b, l, key) => `<span class="pa-fx-c${key ? ' is-key' : ''}"><b>${b}</b><span>${l}</span></span>`;
  const reqCard = `<div class="card pa-card"><div class="pa-h"><h3>How many karigars ${nf(target)} needs</h3>
      <span class="muted">${esc(base.label)}</span></div>
    <div class="pa-fx">
      ${chip(nf(target), 'target')}<i>−</i>${chip(nf(need.extOut), 'external teams')}<i>=</i>
      ${chip(nf(need.fromCC), 'from company contractors')}<i>÷</i>${chip(nf(Math.round(need.perWeek)), 'a karigar a week')}<i>=</i>
      ${chip(nf(need.need), 'karigars needed', true)}
    </div>
    <div class="pa-fx-note"><b>${nf(Math.round(need.perWeek))}</b> a week = <b>${d1(base.avg)}</b> pieces per karigar per day (${nf(base.pcs)} pcs ÷ ${nf(base.personDays)} karigar-days) × ${need.W} working days · ${extLine}</div>
    <div class="pa-gapline ${diffCls}">
      <div><span>Worked this week</span><b>${nf(need.have)}</b></div>
      <div><span>Needed</span><b>${nf(need.need)}</b></div>
      <div class="pa-gapbig"><b>${need.diff > 0 ? '+' + nf(need.diff) : need.diff < 0 ? nf(-need.diff) + ' spare' : 'exactly enough'}</b><span>${need.diff > 0 ? 'more karigars needed' : 'karigars'}</span></div>
      <div><span>Or, with the ${nf(need.have)} you have</span><b>${d1(need.perDayToHit)}</b><em>pieces each per day</em></div>
    </div></div>`;

  /* ---- 2b. THE FLOW AND THE FOUR SMALL FIGURES, on one strip ---- */
  const flow = (n, l) => `<div class="pa-flow-i"><b>${nf(n)}</b><span>${l}</span></div>`;
  const strip = `<div class="card pa-card pa-strip">
    <div class="pa-flow">${flow(f.cut, 'Cut')}<i>→</i>${flow(f.issued, 'Issued')}<i>→</i>${flow(f.received, 'Made')}<i>→</i>${flow(f.pressed, 'Pressed')}</div>
    <div class="pa-minis pa-minis4">
      <div><b>${d1(base.avg)}</b><span>pieces per karigar per day · ${esc(base.label)}</span></div>
      <div><b>${nf(need.have)}</b><span>company contractors worked</span></div>
      <div><b>${nf(f.workDays)}</b><span>working days</span></div>
      <div><b>₹${nf(Math.round(f.value / 1000))}k</b><span>labour value${f.received ? ' · ₹' + (f.value / f.received).toFixed(1) + '/pc' : ''}</span></div>
    </div>
  </div>`;

  /* ---- 3. EVERY KARIGAR, per person per day ---- */
  const ccRows = f.ccList.slice().sort((a, b) => (b.personDays ? b.received / b.personDays : 0) - (a.personDays ? a.received / a.personDays : 0));
  const perMax = Math.max(base.avg * 2, ...ccRows.map(w => (w.personDays ? w.received / w.personDays : 0)), 1);
  const teamBtn = w => `<button class="ghost pa-team" data-team="${esc(w.key)}" title="How many people work under this name">${nf(w.people)}${w.people > 1 ? ' people' : ''}</button>`;
  const kRow = w => {
    const per = w.personDays ? w.received / w.personDays : 0;
    return `<tr><td style="text-align:left;font-weight:600">${esc(w.name)}</td><td class="num">${teamBtn(w)}</td><td class="num">${nf(w.days)}</td><td class="num">${nf(w.received)}</td>
      <td class="num"><b class="${per >= base.avg ? 'pa-up' : 'pa-dn'}">${d1(per)}</b></td>
      <td style="min-width:180px"><div class="pa-kbar"><i class="${per >= base.avg ? 'pa-up' : 'pa-dn'}" style="width:${pctOf(per, perMax)}%"></i><u style="left:${pctOf(base.avg, perMax)}%"></u></div></td></tr>`;
  };
  const karigarCard = `<div class="card pa-card"><div class="pa-h"><h3>Every karigar, per person per day</h3>
      <span class="muted">company contractors this week · the line is the average of ${d1(base.avg)} · click the people count to set a team size</span></div>
    <div class="xlwrap"><table class="xl pa-ktable"><thead><tr><th style="text-align:left">Karigar</th><th class="num">People</th><th class="num">Days with work</th><th class="num">Pieces</th><th class="num">Per person per day</th><th></th></tr></thead><tbody>
      ${ccRows.map(kRow).join('') || '<tr><td colspan="6" class="muted">No company contractor had work this week.</td></tr>'}
      ${f.ext.length ? `<tr class="pa-sep"><td colspan="6">External teams — not in the average above</td></tr>` + f.ext.map(kRow).join('') : ''}
    </tbody></table></div></div>`;

  /* ---- 4. EVERY DAY, against what the target needs ---- */
  const needDay = Math.ceil(target / 6);
  const dMax = Math.max(needDay, ...f.days.map(d => Math.max(d.cut, d.issued, d.received)), 1);
  const wd = f.workDays || 1;
  const chart = `<div class="card pa-card"><div class="pa-h"><h3>Every day against ${nf(needDay)} a day</h3><span class="muted">${nf(target)} over 6 working days</span></div>
    <div class="pa-chart">
      <div class="pa-need" style="bottom:${pctOf(needDay, dMax)}%"><span>${nf(needDay)} needed</span></div>
      ${f.days.map(d => `<div class="pa-bars${(d.cut + d.issued + d.received) ? '' : ' is-off'}">
          <i class="pa-c" style="height:${pctOf(d.cut, dMax)}%" title="Cut ${nf(d.cut)}"></i>
          <i class="pa-i" style="height:${pctOf(d.issued, dMax)}%" title="Issued ${nf(d.issued)}"></i>
          <i class="pa-m" style="height:${pctOf(d.received, dMax)}%" title="Made ${nf(d.received)}"></i>
        </div>`).join('')}
    </div>
    <div class="pa-days">${f.days.map(d => `<div class="pa-day">${new Date(d.ms).toLocaleDateString('en-GB', { weekday: 'short' })}<small>${nf(d.received) || '—'}</small></div>`).join('')}</div>
    <div class="pa-legend"><span><i class="pa-c"></i>Cut</span><span><i class="pa-i"></i>Issued</span><span><i class="pa-m"></i>Made (number under the day)</span></div>
    <div class="pa-perday">
      ${[['Cut', Math.round(f.cut / wd)], ['Issued', Math.round(f.issued / wd)], ['Made', Math.round(f.received / wd)]].map(([l, n]) =>
        `<div><span>${l} a working day</span><b class="${n >= needDay ? 'is-ok' : 'is-short'}">${nf(n)}</b><em>${n >= needDay ? 'enough' : nf(needDay - n) + ' short'}</em></div>`).join('')}
    </div></div>`;

  /* ---- 5. WHO MADE THE WEEK ---- */
  const ranked = f.people.filter(w => w.received > 0).sort((a, b) => b.received - a.received);
  const topMax = ranked.length ? ranked[0].received : 1;
  const leader = `<div class="card pa-card"><div class="pa-h"><h3>Who made the week</h3><span class="muted">top 8 of ${nf(ranked.length)}</span></div>
    <div class="pa-lead-list">${ranked.slice(0, 8).map((w, i) => `<div class="pa-lr"><span class="pa-rank">${i + 1}</span><span class="pa-name">${esc(w.name)}${w.people > 1 ? ` <small class="muted">· ${nf(w.people)} people</small>` : ''}</span>
      <span class="pa-lbar"><i style="width:${pctOf(w.received, topMax)}%"></i></span><b>${nf(w.received)}</b><em>${f.received ? Math.round(w.received / f.received * 100) : 0}%</em></div>`).join('') || '<div class="muted">Nothing came back this week.</div>'}</div></div>`;

  const signals = [];
  const sig = (sev, title, text) => signals.push(`<li class="pa-sig pa-${sev}"><b>${esc(title)}</b><div>${text}</div></li>`);
  if (f.idle.length) sig('bad', `${nf(f.idle.length)} karigar(s) got no work this week`, esc(f.idle.map(p => p.name + (p.also && p.also.length ? ' (also ' + p.also.join(', ') + ')' : '')).join(', ')) + ' — all worked in the four weeks before.');
  if (f.stuck.length) sig('bad', `${nf(f.stuck.length)} karigar(s) sat on work and returned nothing`, esc(f.stuck.map(p => `${p.name} (${nf(p.held)} pcs)`).join(', ')) + '. Not a shortage of work — find out why it is not coming back.');
  if (f.dormant.length) sig('warn', `${nf(f.dormant.length)} contractor(s) on the list have not worked for a month`, esc(f.dormant.map(p => p.name).join(', ')) + '. Still with you? Give them work — if not, take them off the list.');
  if (f.top && f.received && f.top.received / f.received >= 0.2) sig('warn', `${f.top.name} made ${Math.round(f.top.received / f.received * 100)}% of the week`, `${nf(f.top.received)} of ${nf(f.received)} pieces${f.top.people > 1 ? `, with ${nf(f.top.people)} people` : ''}. One absence there moves the whole week.`);
  if (f.emptyBy.length) sig('warn', `${nf(f.emptyDays)} empty-handed karigar-day(s)`, esc(f.emptyBy.slice(0, 10).map(([n, d]) => `${n} (${d})`).join(', ')));
  if (f.issued > f.cut * 1.25) sig('warn', 'More issued than cut', `${nf(f.issued)} issued against ${nf(f.cut)} cut. Some of it came from earlier cutting — or cutting is not all being entered.`);
  if (f.workDays && f.attDays < f.workDays) sig('warn', 'Attendance is not being marked', `Marked on ${nf(f.attDays)} of ${nf(f.workDays)} working day(s). Without it, "no work" and "did not come" look the same, and a karigar-day is only a guess from the work in hand.`);
  if (f.salaried.length) sig('info', `${nf(f.salaried.length)} salaried stitcher(s) are not in these figures`, 'Company Role staff are paid by the month and their pieces are not written into the Job Work Register — ' + esc(f.salaried.map(p => p.name).join(', ')) + '.');
  if (f.wipOld) sig('warn', `${nf(f.wipOld)} piece(s) out more than 3 days`, `Of ${nf(f.wip)} still with karigars at the end of the week.`);
  if (f.received) sig(f.rejected / f.received > 0.02 ? 'warn' : 'ok', `Rejection ${(f.rejected / f.received * 100).toFixed(1)}%`, `${nf(f.rejected)} piece(s) rejected on what came back.`);
  if (f.noRate) sig('warn', `${nf(f.noRate)} piece(s) have no rate`, 'They count as made but add nothing to the labour value. Add their rates in Finance &amp; HR.');
  const sigs = `<div class="card pa-card"><div class="pa-h"><h3>Look into</h3></div><ul class="pa-sigs">${signals.join('')}</ul></div>`;

  /* ---- 6. WEEK ON WEEK ---- */
  /* trendFacts: read once, at the top, for the weeks chart as well. */
  const tMax = Math.max(target, ...trendFacts.map(t => t.received), 1);
  const trend = `<div class="card pa-card"><div class="pa-h"><h3>Week on week</h3></div><div class="xlwrap"><table class="xl"><thead><tr><th style="text-align:left">Week</th><th style="text-align:left;min-width:220px">Made against ${nf(target)}</th><th class="num">Cut</th><th class="num">Issued</th><th class="num">Company contractors</th><th class="num">Per karigar per day</th><th class="num">Days</th></tr></thead><tbody>
    ${trendFacts.slice().reverse().map(t => `<tr${t.wk === f.wk ? ' class="pa-on"' : ''}><td style="text-align:left;white-space:nowrap">${esc(paWeekLabel(t.wk))}${t.partial ? ' · so far' : ''}</td>
      <td style="text-align:left"><div class="pa-tbar"><i style="width:${pctOf(t.received, tMax)}%"></i><u style="left:${pctOf(target, tMax)}%"></u><b>${nf(t.received)}</b></div></td>
      <td class="num">${nf(t.cut)}</td><td class="num">${nf(t.issued)}</td><td class="num">${nf(t.ccPeople)}</td><td class="num"><b>${t.ccPersonDays ? d1(t.ccPcs / t.ccPersonDays) : '—'}</b></td><td class="num">${nf(t.workDays)}</td></tr>`).join('')}
  </tbody></table></div></div>`;

  box.innerHTML = top + `<div class="pa-two">${chart}${reqCard}</div>` + strip + karigarCard
    + `<div class="pa-two">${leader}${sigs}</div>` + trend
    /* Cloth is the other half of "can we make 20,000": karigars above, the printers below. */
    + pafCard();
  const wk = $('paFabWeeks');
  if (wk) wk.onchange = () => renderPa();
  $('paMsg').className = 'muted';
  $('paMsg').textContent = 'Made = pieces received back in the Job Work Register, by receiving date. A karigar-day = one person on a working day with work in hand. Team sizes count every person under a name.'
    + (f.undated ? ` ${nf(f.undated)} piece(s) received on rows still open carry no date yet and are not counted.` : '');
}

/* ---------- KARIGAR ANALYSIS ---------- */
const KA_METRICS = {
  recv: { label: 'Pieces made', of: w => w.received },
  issued: { label: 'Pieces issued', of: w => w.issued },
  value: { label: 'Labour value ₹', of: w => Math.round(w.value) },
  days: { label: 'Days with work', of: w => w.days },
  perDay: { label: 'Pieces per person per day', of: w => (w.pd ? Math.round(w.received / w.pd * 10) / 10 : 0) },
  rej: { label: 'Rejection %', of: w => w.received ? Math.round(w.rejected / w.received * 1000) / 10 : 0, lowGood: true },
};

/** One row per karigar (or article, or department) and one column per week. */
function kaTable(metric, group, weeksN, dept, q) {
  const M = KA_METRICS[metric] || KA_METRICS.recv;
  const weeks = paWeeks().slice(-weeksN);
  const facts = weeks.map(w => paWeekFacts(w));
  const rows = new Map();
  const roster = paRoster();
  if (group === 'karigar') [...roster.values()].filter(p => paIsKarigar(p.dept) && !paIsSalaried(p.type)).forEach(p => rows.set(paN(p.name), { key: paN(p.name), name: p.name, dept: p.dept, type: p.type, cells: weeks.map(() => null) }));
  const agg = () => ({ received: 0, issued: 0, rejected: 0, value: 0, recvDays: new Set(), days: 0, pd: 0 });
  facts.forEach((f, i) => {
    if (group === 'article') {
      Object.entries(f.byArt).forEach(([at, pcs]) => {
        const r = rows.get(at) || rows.set(at, { key: at, name: at, dept: '', type: '', cells: weeks.map(() => null) }).get(at);
        const c = r.cells[i] || (r.cells[i] = agg()); c.received += pcs;
      });
      return;
    }
    f.people.forEach(w => {
      const k = group === 'dept' ? (w.dept || '(not on the list)') : w.key;
      const r = rows.get(k) || rows.set(k, { key: k, name: group === 'dept' ? k : w.name, dept: group === 'dept' ? '' : (w.dept || '(not on the list)'), type: w.type, cells: weeks.map(() => null) }).get(k);
      const c = r.cells[i] || (r.cells[i] = agg());
      c.received += w.received; c.issued += w.issued; c.rejected += w.rejected; c.value += w.value; w.recvDays.forEach(d => c.recvDays.add(d));
      c.days += w.days || 0; c.pd += w.personDays || 0;
    });
  });
  let list = [...rows.values()];
  if (dept && group === 'karigar') list = list.filter(r => paN(r.dept) === paN(dept));
  if (q) list = list.filter(r => paN(r.name + ' ' + r.dept + ' ' + r.type).includes(paN(q)));
  const val = c => c ? M.of(c) : 0;
  list.forEach(r => {
    const tot = r.cells.reduce((a, c) => { if (!c) return a; a.received += c.received; a.issued += c.issued; a.rejected += c.rejected; a.value += c.value; c.recvDays.forEach(d => a.recvDays.add(d)); a.days += c.days; a.pd += c.pd; return a; }, agg());
    r.total = M.of(tot); r.values = r.cells.map(val);
    r.worked = r.cells.filter(c => c && (c.received || c.issued)).length;
  });
  list.sort((a, b) => (M.lowGood ? a.total - b.total : b.total - a.total) || a.name.localeCompare(b.name));
  /* PEERS, NOT THEMSELVES: a karigar's week is judged against the median of everybody who worked that week. */
  const colMed = weeks.map((_, i) => paMedian(list.map(r => r.values[i]).filter(v => v > 0)));
  const colP75 = weeks.map((_, i) => paQuant(list.map(r => r.values[i]).filter(v => v > 0), 0.75));
  return { weeks, rows: list, colMed, colP75, metric: M };
}

function renderKa() {
  const tbl = $('kaTable'); if (!tbl) return;
  if (PA.busy) { $('kaMsg').className = 'muted'; $('kaMsg').textContent = 'Reading the registers…'; return; }
  if (PA.err) { $('kaMsg').className = 'err'; $('kaMsg').textContent = 'Could not read: ' + PA.err; return; }
  if (!PT.base) return;
  const deptSel = $('kaDept'), keepDept = deptSel.value;
  const depts = [...new Set([...paRoster().values()].map(p => p.dept).filter(Boolean))].sort();
  deptSel.innerHTML = '<option value="">All departments</option>' + depts.filter(d => paIsKarigar(d)).map(d => `<option value="${esc(d)}">${esc(d)} only</option>`).join('');
  deptSel.value = keepDept;
  const mix = $('kaGroup').value === 'mix';
  const grp = $('kaGroup').value, byMonth = grp === 'daily' || grp === 'target';
  $('kaMetric').classList.toggle('hide', mix || grp === 'target');   // the target is always labour value
  $('kaBands').classList.toggle('hide', !mix);
  $('kaWeeks').classList.toggle('hide', byMonth);
  $('kaMonth').classList.toggle('hide', !byMonth);
  $('kaTgtBtn').classList.toggle('hide', grp !== 'target' || !ME.admin);
  /* THE MONTH LIST FOLLOWS THE VIEW: Day by day may take any dates; a target is a month, and only a month. */
  if (byMonth && KA.monthFor !== grp) {
    const keep = $('kaMonth').value;
    $('kaMonth').innerHTML = kaMonths().map(m => `<option value="${esc(m.ym)}">${esc(m.label)}</option>`).join('')
      + (grp === 'daily' ? '<option value="custom">Custom dates…</option>' : '');
    if (keep && (keep !== 'custom' || grp === 'daily')) $('kaMonth').value = keep;
    KA.monthFor = grp;
  }
  /* CUSTOM DATES: two boxes, filled with this month so far the first time they appear. */
  const custom = kaCustom();
  ['kaD1', 'kaD2'].forEach(id => $(id).classList.toggle('hide', !custom));
  if (custom && !$('kaD1').value) { const n = new Date(); $('kaD1').value = paDayIso(new Date(n.getFullYear(), n.getMonth(), 1).getTime()); }
  if (custom && !$('kaD2').value) $('kaD2').value = paDayIso(Date.now());
  if (grp === 'daily' || (grp === 'karigar' && custom)) return renderKaDaily();
  if (grp === 'target') return renderKaTarget();
  if (mix) return renderKaMix();
  const t = kaTable($('kaMetric').value, $('kaGroup').value, parseInt($('kaWeeks').value, 10) || 8, deptSel.value, $('kaQ').value.trim());
  KA.last = t;
  const lowGood = !!t.metric.lowGood;
  const cls = (v, i) => {
    if (!v) return ' class="num ka-zero"';
    const med = t.colMed[i], p75 = t.colP75[i];
    if (lowGood) return ' class="num' + (v > Math.max(med * 2, 2) ? ' ka-low' : '') + '"';
    if (v >= p75 && p75 > 0) return ' class="num ka-high"';
    if (v < med / 2) return ' class="num ka-low"';
    return ' class="num"';
  };
  const group = $('kaGroup').value;
  tbl.innerHTML = '<thead><tr><th class="frz" style="text-align:left">' + (group === 'article' ? 'Article' : group === 'dept' ? 'Department' : 'Karigar') + '</th>'
    + (group === 'karigar' ? '<th style="text-align:left">Department</th><th class="num">People</th>' : '')
    + t.weeks.map(w => `<th class="num" title="${esc(paWeekLabel(w))}">${esc(paWeekLabel(w).split(' – ')[0])}</th>`).join('')
    + `<th class="num">Total</th><th class="num">Weeks worked</th></tr></thead><tbody>`
    + t.rows.map(r => `<tr${group === 'karigar' ? ` data-ka="${esc(r.key)}" class="ka-row${KA.pick === r.key ? ' pa-on' : ''}"` : ''}><td class="frz" style="text-align:left;font-weight:600">${esc(r.name)}</td>`
      + (group === 'karigar' ? `<td style="text-align:left" class="muted">${esc(r.dept)}</td><td class="num"><button class="ghost pa-team" data-team="${esc(r.key)}">${nf(paTeamSize(r.key, Date.now()))}</button></td>` : '')
      + r.values.map((v, i) => `<td${cls(v, i)}>${v ? nf(v) : '—'}</td>`).join('')
      + `<td class="num"><b>${nf(r.total)}</b></td><td class="num">${nf(r.worked)} / ${nf(t.weeks.length)}</td></tr>`).join('')
    + '</tbody>';
  $('kaMsg').className = 'muted';
  $('kaMsg').textContent = `${nf(t.rows.length)} row(s) · ${t.metric.label} · green is the top quarter of that week, red is under half its median`
    + (group === 'karigar' ? ' · click a karigar for the detail' : '');
  kaRenderDetail();
}

/** One karigar, over the weeks shown: what they made, of what, what is still with them, and how fast. */
function kaDetail(key, weeksN) {
  const weeks = paWeeks().slice(-weeksN);
  const from = paWkStartMs(weeks[0]);
  const roster = paRoster().get(key) || { name: key, dept: '', type: '' };
  const rows = (PT.base || []).filter(r => r && paN(r.empName) === key);
  const byArt = {};
  let made = 0, value = 0, rej = 0; const turn = [], days = new Set();
  rows.forEach(r => {
    const rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0, got = ptNum(r.receivedPieces);
    if (!rm || rm < from || !got) return;
    const at = [r.articleType, r.articleSubtype].filter(Boolean).join(' · ') || '(unknown)';
    const v = paValue(r, got, roster.type);
    byArt[at] = byArt[at] || { pcs: 0, value: 0, t: r.articleType, s: r.articleSubtype }; byArt[at].pcs += got; byArt[at].value += v;
    made += got; value += v; rej += ptNum(r.rejectionPieces); days.add(paDayIso(rm));
    const im = ptDtMs(r.issueDate); if (im && rm >= im) turn.push((rm - im) / PA_DAY);
  });
  const open = rows.filter(r => !r.frozen && ptNum(r.pendingPieces) > 0)
    .map(r => ({ sku: r.sku, order: r.orderNo, pcs: ptNum(r.pendingPieces), since: r.issueDate, days: Math.floor((Date.now() - ptDtMs(r.issueDate)) / PA_DAY) }))
    .sort((a, b) => b.days - a.days);
  const last = rows.map(r => ptDtMs(r.receivingDate) || ptDtMs(r.issueDate)).filter(Boolean).sort((a, b) => b - a)[0] || 0;
  let pd = 0, workDays = 0;
  weeks.forEach(w => { const p = paWeekFacts(w).people.find(x => x.key === key); if (p) { pd += p.personDays; workDays += p.days; } });
  return { name: roster.name, dept: roster.dept, type: roster.type, made, value, rej, days: days.size, turn: paMedian(turn), pd, workDays, people: paTeamSize(key, Date.now()),
    byArt: Object.entries(byArt).sort((a, b) => b[1].pcs - a[1].pcs), open, last };
}

function kaRenderDetail() {
  const box = $('kaDetail'); if (!box) return;
  if (!KA.pick || ['karigar', 'mix', 'daily', 'target'].indexOf($('kaGroup').value) < 0) { box.innerHTML = ''; box.classList.add('hide'); return; }
  const weeksN = parseInt($('kaWeeks').value, 10) || 8;
  const d = kaDetail(KA.pick, weeksN);
  box.classList.remove('hide');
  box.innerHTML = `<div class="kpihead"><span class="kpiname">${esc(d.name)}</span><span class="kpiwhen">${esc(d.type)}${d.dept ? ' · ' + esc(d.dept) : ''} · last ${weeksN} weeks <button class="ghost" id="kaClose" style="padding:2px 10px;font-size:12px;margin-left:8px">Close</button></span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(d.made)}</div><div class="l">Pieces made</div></div>
      <div class="metric"><div class="v">₹${nf(Math.round(d.value))}</div><div class="l">Labour value</div></div>
      <div class="metric"><div class="v"><button class="ghost pa-team" data-team="${esc(KA.pick)}">${nf(d.people)}</button></div><div class="l">People under this name</div></div>
      <div class="metric"><div class="v">${nf(d.workDays)}</div><div class="l">Days with work</div></div>
      <div class="metric"><div class="v">${d.pd ? (Math.round(d.made / d.pd * 10) / 10).toFixed(1) : '—'}</div><div class="l">Pieces per person per day</div></div>
      <div class="metric"><div class="v">${d.turn.toFixed(1)}</div><div class="l">Days to return (median)</div></div>
      <div class="metric"><div class="v" style="color:${d.made && d.rej / d.made > 0.02 ? 'var(--bad)' : 'inherit'}">${d.made ? (d.rej / d.made * 100).toFixed(1) + '%' : '—'}</div><div class="l">Rejection</div></div>
      <div class="metric"><div class="v">${d.last ? esc(new Date(d.last).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) : '—'}</div><div class="l">Last entry</div></div>
    </div>
    <div class="pa-two" style="margin-top:10px">
      <div><h4 style="margin:4px 0">What they made</h4><table class="xl"><thead><tr><th style="text-align:left">Article</th><th class="num">Pieces</th><th class="num">%</th><th class="num">₹ / piece</th><th>Level</th><th class="num">₹</th></tr></thead><tbody>
        ${d.byArt.map(([a, v]) => { const rate = v.pcs ? v.value / v.pcs : 0, lv = kaLevelMeta(kaLevelOf(v.t, v.s));
          return `<tr><td style="text-align:left">${esc(a)}</td><td class="num">${nf(v.pcs)}</td><td class="num">${d.made ? Math.round(v.pcs / d.made * 100) + '%' : '—'}</td>`
            + `<td class="num">${rate ? '₹' + rate.toFixed(1) : '—'}</td><td><span class="pill" style="background:${lv.bg};color:${lv.fg}">${lv.t}</span></td>`
            + `<td class="num">${nf(Math.round(v.value))}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">Nothing received in these weeks.</td></tr>'}
      </tbody></table></div>
      <div><h4 style="margin:4px 0">Still with them</h4><table class="xl"><thead><tr><th style="text-align:left">SKU</th><th style="text-align:left">Order</th><th class="num">Pieces</th><th class="num">Days out</th></tr></thead><tbody>
        ${d.open.map(o => `<tr><td style="text-align:left;font-family:ui-monospace,monospace">${esc(o.sku)}</td><td style="text-align:left">${esc(o.order)}</td><td class="num">${nf(o.pcs)}</td><td class="num"${o.days > 3 ? ' style="color:var(--bad);font-weight:700"' : ''}>${nf(o.days)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing out with them right now.</td></tr>'}
      </tbody></table></div>
    </div>`;
  const c = $('kaClose'); if (c) c.onclick = () => { KA.pick = ''; renderKa(); };
}

$('paWk').addEventListener('change', renderPa);
$('paBasis').addEventListener('change', renderPa);
$('paBody').addEventListener('click', e => { const b = e.target.closest('[data-team]'); if (b) paTeamOpen(b.getAttribute('data-team')); });
$('kaDetail').addEventListener('click', e => { const b = e.target.closest('[data-team]'); if (b) paTeamOpen(b.getAttribute('data-team')); });
$('paTarget').addEventListener('change', () => {
  const v = parseInt($('paTarget').value, 10);
  if (v > 0) { try { localStorage.setItem(PA_TARGET_KEY, String(v)); } catch (e) { /* this browser only */ } }
  renderPa();
});
$('paGo').onclick = paRefresh;
['kaMetric', 'kaGroup', 'kaWeeks', 'kaDept', 'kaMonth', 'kaD1', 'kaD2'].forEach(id => $(id).addEventListener('change', renderKa));
$('kaQ').addEventListener('input', renderKa);
$('kaGo').onclick = paRefresh;
$('kaTable').addEventListener('click', e => {
  const tb = e.target.closest('[data-team]'); if (tb) return paTeamOpen(tb.getAttribute('data-team'));
  const so = e.target.closest('[data-kmsort]');
  if (so) {
    const k = so.getAttribute('data-kmsort');
    KA.mixSort = { k, dir: KA.mixSort && KA.mixSort.k === k ? -KA.mixSort.dir : (k === 'name' ? 1 : -1) };
    return renderKa();
  }
  const tr = e.target.closest('[data-ka]'); if (!tr) return;
  const k = tr.getAttribute('data-ka');
  KA.pick = KA.pick === k ? '' : k;
  renderKa();
});
$('kaLevelsBtn').onclick = () => kaLevelsOpen();
$('kaTgtBtn').onclick = () => kaTargetsOpen();
$('kaExport').onclick = () => {
  if ($('kaGroup').value === 'daily' || kaCustom()) {
    const x = KA.daily; if (!x || !x.rows.length) return;
    const head = ['Karigar', 'Department'].concat(x.d.days.map(ms => paDayIso(ms)), ['Total', 'Days worked']);
    ptDownload('karigar-day-by-day-' + x.d.ym + '-' + x.metric, [head].concat(x.rows.map(r => [r.name, r.dept].concat(r.vals, [r.total, r.worked]))).map(l => l.map(csvCell).join(',')));
    return;
  }
  if ($('kaGroup').value === 'target') {
    const x = KA.target; if (!x || !x.rows.length) return;
    const head = ['Karigar', 'Department', 'People', 'Month target ₹', 'Done so far ₹', 'Should be by today ₹', 'Of the pace %',
      'Short by ₹', 'Needed a day ₹', 'Month end at this pace ₹', 'Days worked', 'Stage'];
    ptDownload('karigar-targets-' + x.ym, [head].concat(x.rows.map(r => [r.name, r.dept, paTeamSize(r.key, Date.now()), r.target, r.done, r.expected,
      r.pace == null ? '' : Math.round(r.pace * 100), r.short, r.needPerDay, r.projected, r.daysWorked, KA_TGT_STATUS[r.status][0]])).map(l => l.map(csvCell).join(',')));
    return;
  }
  if ($('kaGroup').value === 'mix') {
    const t = KA.mix; if (!t || !t.rows.length) return;
    const head = ['Karigar', 'Department', 'Pieces made', 'Easy pcs', 'Easy %', 'Medium pcs', 'Medium %',
      'Hard pcs', 'Hard %', 'Not set pcs', 'Not set %', 'Avg ₹ per piece', 'Labour value ₹', 'Pieces per person per day'].concat(t.types);
    const line = r => [r.name, r.dept, r.pcs, r.lv.easy, r.easyPct.toFixed(1), r.lv.mid, r.midPct.toFixed(1), r.lv.hard, r.hardPct.toFixed(1),
      r.lv.none, r.nonePct.toFixed(1), r.avgRate.toFixed(2), Math.round(r.value), r.perDay.toFixed(1)].concat(t.types.map(at => r.byType[at] || 0));
    ptDownload('karigar-article-mix', [head].concat([line(t.all)], t.rows.map(line)).map(x => x.map(csvCell).join(',')));
    return;
  }
  const t = KA.last; if (!t || !t.rows.length) return;
  const lines = [['Name', 'Department', 'People'].concat(t.weeks.map(paWeekLabel), ['Total', 'Weeks worked']).map(csvCell).join(',')]
    .concat(t.rows.map(r => [r.name, r.dept, paTeamSize(r.key, Date.now())].concat(r.values, [r.total, r.worked]).map(csvCell).join(',')));
  ptDownload('karigar-analysis', lines);
};



