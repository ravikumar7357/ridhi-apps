/* ================= DAY BY DAY, AND THE MONTHLY TARGET =================
 *
 * Ravi, 2026-09-22: "date wise also, and kis karigar ka work kam hua — like monthly 1 karigar 30000 ka
 * kaam karta h — and kon apne target se bahut peeche h wo bhi track kar saku."
 *
 * DAY BY DAY: one column per day of the month picked, from the same register the weekly study reads —
 * made = pieces received back, by receiving date; issued by issue date; labour value at the rate the
 * row is paid at. Sundays are marked, not dropped: work done on one still counts.
 *
 * THE TARGET is labour value in rupees a month, PER PERSON. A name that is a team (Pradeep Contractor,
 * 25 people) is expected that many times over, unless a figure of its own is set for it. Judged
 * against the PACE, not the month: by the 12th nobody is behind for not having the whole month done,
 * only for being under the share of it the working days so far call for (Monday to Saturday).
 */
const KA_DAY = 86400000;

/** The months to offer: this one and the five before it. */
function kaMonths(nowMs) {
  const d = new Date(nowMs || Date.now()), out = [];
  for (let i = 0; i < 6; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ ym: x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'),
      label: x.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) });
  }
  return out;
}
/** A month as a range of days, local time. */
function kaMonthRange(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  const from = new Date(y, m - 1, 1).getTime(), to = new Date(y, m, 1).getTime();
  const days = [];
  for (let t = from; t < to; t = new Date(new Date(t).getFullYear(), new Date(t).getMonth(), new Date(t).getDate() + 1).getTime()) days.push(t);
  return { from, to, days };
}
const kaWorkDay = ms => new Date(ms).getDay() !== 0;          // Monday to Saturday

/**
 * Every karigar's month, a day at a time. { days, rows:[{ key, name, dept, type, cells:[{received,issued,value}] }] }
 * The same people the weekly study shows: everybody with work in the register, and every piece-rate
 * stitcher on the list even with none.
 */
/** Custom dates are in use: Karigar study with "Custom dates…", or Day by day with "Custom dates…". */
function kaCustom() {
  const g = ($('kaGroup') || {}).value;
  return (g === 'karigar' && ($('kaWeeks') || {}).value === 'custom') || (g === 'daily' && ($('kaMonth') || {}).value === 'custom');
}
/** From one day to another, both included, as a list of days. '' when the dates make no range. */
function kaRange(d1, d2) {
  const p = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0; };
  const a = p(d1), b = p(d2);
  if (!a || !b || b < a) return null;
  const days = [];
  for (let t = a; t <= b; t = new Date(new Date(t).getFullYear(), new Date(t).getMonth(), new Date(t).getDate() + 1).getTime()) days.push(t);
  const last = new Date(b);
  return { from: a, to: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1).getTime(), days };
}
const KA_MAX_DAYS = 93;

function kaDaily(ym, dept, q) {
  /* A month by its key, or custom dates as { d1, d2 }. */
  const { from, to, days } = ym && typeof ym === 'object' ? (kaRange(ym.d1, ym.d2) || { from: 0, to: 0, days: [] }) : kaMonthRange(ym);
  const roster = paRoster();
  const rows = new Map();
  const blank = () => days.map(() => ({ received: 0, issued: 0, value: 0 }));
  const rowOf = (k, raw) => {
    if (!rows.has(k)) {
      const ro = roster.get(k);
      rows.set(k, { key: k, name: ro ? ro.name : String(raw || '').trim(), dept: ro ? ro.dept : '(not on the list)',
        type: ro ? ro.type : '', cells: blank() });
    }
    return rows.get(k);
  };
  [...roster.values()].filter(p => paIsKarigar(p.dept) && !paIsSalaried(p.type)).forEach(p => rowOf(paN(p.name), p.name));
  const dayIx = ms => { for (let i = days.length - 1; i >= 0; i--) if (ms >= days[i]) return i; return -1; };
  (PT.base || []).forEach(r => {
    if (!r || !String(r.empName || '').trim()) return;
    const k = paN(r.empName);
    const im = ptDtMs(r.issueDate), rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0;
    if (im && im >= from && im < to) rowOf(k, r.empName).cells[dayIx(im)].issued += ptNum(r.issuePieces);
    const got = ptNum(r.receivedPieces);
    if (rm && rm >= from && rm < to && got > 0) {
      const row = rowOf(k, r.empName), c = row.cells[dayIx(rm)];
      c.received += got; c.value += paValue(r, got, row.type);
    }
  });
  let list = [...rows.values()];
  if (dept) list = list.filter(r => paN(r.dept) === paN(dept));
  if (q) list = list.filter(r => paN(r.name + ' ' + r.dept + ' ' + r.type).includes(paN(q)));
  return { ym, days, rows: list };
}

/* ---- the target ---- */

/** A name's target for the month: its own if one is set, or the per-person figure times its people. */
function kaTargetOf(key, ms) {
  const t = KA.targets || {};
  const own = t.by && t.by[key];
  if (own != null && own !== '' && isFinite(+own)) return +own;
  const per = +t.perPerson || 0;
  return per ? per * paTeamSize(key, ms || Date.now()) : 0;
}

/**
 * The month against its targets, one row per name.
 *   expected = target × (working days gone ÷ working days in the month)
 *   pace     = done ÷ expected;  on track ≥ 100%, behind 80–100%, far behind under 80%
 */
function kaTargetRows(ym, dept, q, nowMs) {
  const now = nowMs || Date.now();
  const d = kaDaily(ym, dept, q);
  const work = d.days.filter(kaWorkDay);
  const endOfToday = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + 1).getTime();
  const gone = work.filter(ms => ms < endOfToday).length, total = work.length, left = Math.max(0, total - gone);
  const rows = d.rows.map(r => {
    const done = Math.round(r.cells.reduce((a, c) => a + c.value, 0));
    const made = r.cells.reduce((a, c) => a + c.received, 0);
    const target = Math.round(kaTargetOf(r.key, d.days[0]));
    const expected = total ? Math.round(target * gone / total) : 0;
    const pace = expected > 0 ? done / expected : (target ? null : null);
    const status = !target ? 'none' : !gone ? 'future' : pace >= 1 ? 'ok' : pace >= 0.8 ? 'behind' : 'far';
    return Object.assign({}, r, { done, made, target, expected, pace, status,
      short: Math.max(0, expected - done),
      needPerDay: target && left ? Math.max(0, Math.round((target - done) / left)) : 0,
      projected: gone ? Math.round(done / gone * total) : 0,
      daysWorked: r.cells.filter(c => c.received || c.issued).length });
  }).filter(r => r.target || r.done);
  const rank = { far: 0, behind: 1, ok: 2, future: 3, none: 4 };
  rows.sort((a, b) => rank[a.status] - rank[b.status] || (a.pace == null ? 1 : 0) - (b.pace == null ? 1 : 0)
    || (a.pace || 0) - (b.pace || 0) || b.target - a.target || a.name.localeCompare(b.name));
  return { ym, gone, total, left, rows };
}
const KA_TGT_STATUS = { ok: ['On track', 'pill-ok'], behind: ['Behind', 'pill-low'], far: ['Far behind', 'pill-out'],
  future: ['Not started', 'pill-low'], none: ['No target', 'pill-low'] };

/** Save the targets. One record: the per-person figure and the names that have their own. Admin only. */
async function kaTargetsSave(perPerson, by) {
  if (!ME.admin) return 'Only an admin sets the targets.';
  const per = String(perPerson == null ? '' : perPerson).trim();
  if (per && !(+per >= 0)) return 'The per-person target is rupees a month — a number, or leave it empty.';
  const clean = {};
  for (const [k, v] of Object.entries(by || {})) {
    const t = String(v == null ? '' : v).trim();
    if (!t) continue;
    if (!(+t >= 0)) return `"${t}" is not an amount in rupees.`;
    clean[k] = Math.round(+t);
  }
  const rec = { perPerson: per ? Math.round(+per) : 0, by: clean, at: new Date().toISOString(), setBy: ME.email };
  try { await ptPut('pt_kaTargets', rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  KA.targets = rec;
  return '';
}

function kaTargetsOpen() {
  const t = KA.targets || {};
  const people = [...paRoster().values()].filter(p => paIsKarigar(p.dept) && !paIsSalaried(p.type))
    .sort((a, b) => a.name.localeCompare(b.name));
  ptOpenDialog({
    title: 'Monthly targets',
    subtitle: 'Labour value in ₹ a month. A team is expected its number of people times the per-person figure, unless it has its own.',
    html: `<label>Per person, every month (₹)<input id="kaTgtPer" type="number" min="0" step="500" value="${esc(t.perPerson || '')}" placeholder="e.g. 30000"></label>
      <div class="muted" style="font-size:12px;margin:10px 0 6px">A name's own target — leave empty to use the per-person figure × its people.</div>
      <div class="xlwrap" style="max-height:48vh;border:1px solid var(--line);border-radius:10px"><table class="xl"><thead><tr>
        <th style="text-align:left">Karigar</th><th>Department</th><th class="num">People</th><th class="num">Own target ₹</th></tr></thead><tbody>
        ${people.map(p => { const k = paN(p.name); return `<tr><td style="text-align:left">${esc(p.name)}</td><td class="muted">${esc(p.dept)}</td>`
          + `<td class="num">${nf(paTeamSize(k, Date.now()))}</td>`
          + `<td><input data-katgt="${esc(k)}" type="number" min="0" step="500" value="${esc(t.by && t.by[k] != null ? t.by[k] : '')}" style="width:110px"></td></tr>`; }).join('')}
      </tbody></table></div>`,
    saveLabel: 'Save targets',
    onSave: async () => {
      const by = {};
      document.querySelectorAll('[data-katgt]').forEach(el => { by[el.getAttribute('data-katgt')] = el.value; });
      const err = await kaTargetsSave(($('kaTgtPer') || {}).value, by);
      if (!err) renderKa();
      return err;
    },
  });
}

/* ---- drawing them ---- */

function renderKaDaily() {
  const tbl = $('kaTable');
  const metric = ['recv', 'issued', 'value'].indexOf($('kaMetric').value) >= 0 ? $('kaMetric').value : 'recv';
  const of = c => (metric === 'issued' ? c.issued : metric === 'value' ? Math.round(c.value) : c.received);
  const custom = kaCustom();
  if (custom) {
    const rg = kaRange($('kaD1').value, $('kaD2').value);
    if (!rg) { $('kaMsg').className = 'err'; $('kaMsg').textContent = 'Pick a From date and a To date on or after it.'; ptEmpty('kaTable', 'Nothing to show.'); return; }
    if (rg.days.length > KA_MAX_DAYS) { $('kaMsg').className = 'err'; $('kaMsg').textContent = `That is ${nf(rg.days.length)} days — pick ${KA_MAX_DAYS} or fewer, or use the weeks.`; ptEmpty('kaTable', 'Nothing to show.'); return; }
  }
  const d = kaDaily(custom ? { d1: $('kaD1').value, d2: $('kaD2').value } : $('kaMonth').value, $('kaDept').value, $('kaQ').value.trim());
  d.ym = custom ? $('kaD1').value + '_to_' + $('kaD2').value : d.ym;
  const rows = d.rows.map(r => Object.assign(r, { vals: r.cells.map(of), total: r.cells.reduce((a, c) => a + of(c), 0),
    worked: r.cells.filter(c => c.received || c.issued).length })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  KA.daily = { d, rows, metric };
  /* THE SAME COLOURS AS THE WEEKS: green is the top quarter of that day, red is under half its median. */
  const med = d.days.map((_, i) => paMedian(rows.map(r => r.vals[i]).filter(v => v > 0)));
  const p75 = d.days.map((_, i) => paQuant(rows.map(r => r.vals[i]).filter(v => v > 0), 0.75));
  const cls = (v, i) => {
    const sun = !kaWorkDay(d.days[i]) ? ' ka-sun' : '';
    if (!v) return ' class="num ka-zero' + sun + '"';
    if (v >= p75[i] && p75[i] > 0) return ' class="num ka-high' + sun + '"';
    if (v < med[i] / 2) return ' class="num ka-low' + sun + '"';
    return ' class="num' + sun + '"';
  };
  const colTot = d.days.map((_, i) => rows.reduce((a, r) => a + r.vals[i], 0));
  const money = metric === 'value';
  const f = v => (v ? (money ? '₹' : '') + nf(v) : '—');
  tbl.innerHTML = '<thead><tr><th class="frz" style="text-align:left">Karigar</th><th style="text-align:left">Department</th>'
    + d.days.map(ms => { const x = new Date(ms); return `<th class="num${kaWorkDay(ms) ? '' : ' ka-sun'}" title="${esc(x.toDateString())}">${x.getDate()}<div class="muted" style="font-size:10px;font-weight:500">${esc(x.toLocaleDateString('en-GB', { weekday: 'short' }))}</div></th>`; }).join('')
    + '<th class="num">Total</th><th class="num">Days worked</th></tr></thead><tbody>'
    + rows.map(r => `<tr data-ka="${esc(r.key)}" class="ka-row${KA.pick === r.key ? ' pa-on' : ''}"><td class="frz" style="text-align:left;font-weight:600">${esc(r.name)}</td>`
      + `<td style="text-align:left" class="muted">${esc(r.dept)}</td>`
      + r.vals.map((v, i) => `<td${cls(v, i)}>${f(v)}</td>`).join('')
      + `<td class="num"><b>${f(r.total)}</b></td><td class="num">${nf(r.worked)}</td></tr>`).join('')
    + '</tbody><tfoot><tr><td class="frz" style="text-align:left">All</td><td></td>'
    + colTot.map((v, i) => `<td class="num${kaWorkDay(d.days[i]) ? '' : ' ka-sun'}">${f(v)}</td>`).join('')
    + `<td class="num">${f(colTot.reduce((a, v) => a + v, 0))}</td><td></td></tr></tfoot>`;
  $('kaMsg').className = 'muted';
  $('kaMsg').textContent = `${nf(rows.length)} karigar(s) · ${({ recv: 'Pieces made', issued: 'Pieces issued', value: 'Labour value ₹' })[metric]} a day · `
    + 'green is the top quarter of that day, red is under half its median · Sundays shaded'
    + (['recv', 'issued', 'value'].indexOf($('kaMetric').value) < 0 ? ' · a day shows pieces made, issued or labour value only' : '');
  kaRenderDetail();
}

function renderKaTarget() {
  const tbl = $('kaTable');
  const t = kaTargetRows($('kaMonth').value, $('kaDept').value, $('kaQ').value.trim());
  KA.target = t;
  const has = (KA.targets && (KA.targets.perPerson || Object.keys(KA.targets.by || {}).length));
  const r0 = n => '₹' + nf(Math.round(n || 0));
  const bar = r => {
    if (r.pace == null) return '<span class="muted">—</span>';
    const pc = Math.round(r.pace * 100), w = Math.min(100, pc);
    const col = r.status === 'ok' ? '#16a34a' : r.status === 'behind' ? '#ca8a04' : '#dc2626';
    return `<div style="display:flex;align-items:center;gap:6px;min-width:120px"><span style="flex:1;height:8px;background:#eef0f4;border-radius:4px;overflow:hidden">`
      + `<i style="display:block;height:100%;width:${w}%;background:${col}"></i></span><b style="min-width:40px;text-align:right">${nf(pc)}%</b></div>`;
  };
  tbl.innerHTML = '<thead><tr><th class="frz" style="text-align:left">Karigar</th><th style="text-align:left">Department</th><th class="num">People</th>'
    + '<th class="num">Month target</th><th class="num">Done so far</th><th class="num">Should be by today</th><th>Of the pace</th>'
    + '<th class="num">Short by</th><th class="num">Needed a day to catch up</th><th class="num">Month end at this pace</th><th class="num">Days worked</th><th>Stage</th></tr></thead><tbody>'
    + (t.rows.length ? t.rows.map(r => `<tr data-ka="${esc(r.key)}" class="ka-row${KA.pick === r.key ? ' pa-on' : ''}"><td class="frz" style="text-align:left;font-weight:600">${esc(r.name)}</td>`
      + `<td style="text-align:left" class="muted">${esc(r.dept)}</td><td class="num">${nf(paTeamSize(r.key, Date.now()))}</td>`
      + `<td class="num">${r.target ? r0(r.target) : '<span class="muted">—</span>'}</td><td class="num"><b>${r0(r.done)}</b></td>`
      + `<td class="num">${r.target ? r0(r.expected) : '—'}</td><td>${bar(r)}</td>`
      + `<td class="num"${r.short ? ' style="color:var(--bad);font-weight:700"' : ''}>${r.short ? r0(r.short) : '—'}</td>`
      + `<td class="num">${r.needPerDay ? r0(r.needPerDay) : '—'}</td><td class="num">${r.target ? r0(r.projected) : '—'}</td>`
      + `<td class="num">${nf(r.daysWorked)}</td>`
      + `<td><span class="pill ${KA_TGT_STATUS[r.status][1]}">${KA_TGT_STATUS[r.status][0]}</span></td></tr>`).join('')
      : `<tr><td colspan="12" class="muted" style="padding:16px">${has ? 'Nobody in this month and department.' : 'No target set yet — press "Set targets".'}</td></tr>`)
    + '</tbody>';
  const far = t.rows.filter(r => r.status === 'far').length, behind = t.rows.filter(r => r.status === 'behind').length;
  const ok = t.rows.filter(r => r.status === 'ok').length;
  $('kaMsg').className = far ? 'err' : 'muted';
  $('kaMsg').textContent = `${nf(t.gone)} of ${nf(t.total)} working days gone · ${nf(far)} far behind, ${nf(behind)} behind, ${nf(ok)} on track`
    + ' · target = labour value ₹ a month; "should be by today" is the target × working days gone ÷ working days in the month'
    + (has ? '' : ' · no target set yet');
  kaRenderDetail();
}

/* ---------- ARTICLE MIX: who makes the easy articles, who makes the hard ones ----------
 *
 * Ravi, 2026-09-15: "article wise kis karigar ne kitne pcs banaye, kaun easy article bana raha hai,
 * kaun hard, and uska % chahiye." And then: "not just mark easy — I will tell you which is easy or hard."
 *
 * SO THE LEVEL IS RAVI'S, set per article (article type + subtype) in "Set easy / hard" and stored in
 * pt_articleLevel. Nothing is inferred: an article nobody has given a level shows as "Not set", and
 * the screen says how many pieces that is, so the percentages are never quietly built on a guess.
 * The piece rate is still shown beside each article when setting levels — as a reference, not a rule.
 *
 * Pieces made = pieces received back in the Job Work Register, by receiving date — the same figure as
 * every other study on this screen, so the totals agree.
 */
const KA_LEVELS = [
  { k: 'easy', t: 'Easy', bg: '#dcfce7', fg: '#166534' },
  { k: 'mid', t: 'Medium', bg: '#fef08a', fg: '#854d0e' },
  { k: 'hard', t: 'Hard', bg: '#fee2e2', fg: '#991b1b' },
  { k: 'none', t: 'Not set', bg: '#e5e7eb', fg: '#4b5563' },
];
/** The database key for one article. The characters the database refuses are replaced. */
const kaLevelKey = (at, sub) => (paN(at) + '__' + paN(sub)).replace(/[.$#\[\]\/]/g, '_') || '__';
/** The level Ravi gave this article: 'easy' | 'mid' | 'hard', or 'none' when nobody has. */
function kaLevelOf(at, sub) {
  const v = (KA.levels || {})[kaLevelKey(at, sub)];
  const l = v && (typeof v === 'object' ? v.level : v);
  return l === 'easy' || l === 'mid' || l === 'hard' ? l : 'none';
}
const kaLevelMeta = k => KA_LEVELS.find(l => l.k === k) || KA_LEVELS[3];

/** Every article the registers know — made in the Job Work Register or listed in the master. */
function kaArticles(weeksN) {
  const weeks = paWeeks().slice(-(weeksN || 26));
  const from = paWkStartMs(weeks[0]);
  const m = new Map();
  const add = (at, sub) => {
    at = String(at || '').trim(); sub = String(sub || '').trim();
    if (!at && !sub) return null;
    const k = kaLevelKey(at, sub);
    return m.get(k) || m.set(k, { key: k, at, sub, pcs: 0, value: 0, rated: 0 }).get(k);
  };
  (PTG.mdb || []).forEach(r => r && add(r.articleType, r.subtype));
  (PT.base || []).forEach(r => {
    if (!r) return;
    const rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0, got = ptNum(r.receivedPieces);
    const a = add(r.articleType, r.articleSubtype); if (!a || !rm || rm < from || !(got > 0)) return;
    const rate = rateFor(r.articleType, r.articleSubtype, r.size, r.empType || 'Company Contractor') || 0;
    a.pcs += got; if (rate) { a.value += got * rate; a.rated += got; }
  });
  return [...m.values()].map(a => Object.assign(a, { level: kaLevelOf(a.at, a.sub), avgRate: a.rated ? a.value / a.rated : 0 }))
    .sort((x, y) => y.pcs - x.pcs || (x.at + x.sub).localeCompare(y.at + y.sub));
}

/**
 * Save levels. `picks` is { key: 'easy'|'mid'|'hard'|'' } — '' takes a level off. Only what changed
 * is written, in one update.
 */
async function kaLevelsSave(picks) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const arts = new Map(kaArticles(26).map(a => [a.key, a]));
  const now = new Date().toISOString(), upd = {};
  let n = 0;
  Object.entries(picks || {}).forEach(([k, lv]) => {
    const want = lv === 'easy' || lv === 'mid' || lv === 'hard' ? lv : '';
    const a = arts.get(k); if (!a) return;
    const had = a.level === 'none' ? '' : a.level;
    if (want === had) return;
    upd['pt_articleLevel/' + k] = want ? { articleType: a.at, subtype: a.sub, level: want, by: ME.email, at: now } : null;
    n++;
  });
  if (!n) return '';
  try { await ptPatch(upd); } catch (e) { return 'Not saved: ' + (e.message || e); }
  KA.levels = Object.assign({}, KA.levels || {});
  Object.entries(upd).forEach(([p, v]) => { const k = p.slice('pt_articleLevel/'.length); if (v) KA.levels[k] = v; else delete KA.levels[k]; });
  renderKa();
  return '';
}

function kaLevelsOpen() {
  const arts = kaArticles(26);
  const can = ptCanEdit();
  const opt = (v, cur) => `<option value="${v}"${cur === v ? ' selected' : ''}>${v === '' ? '— not set —' : kaLevelMeta(v).t}</option>`;
  ptOpenDialog({
    title: 'Easy, medium or hard — per article',
    subtitle: `${nf(arts.filter(a => a.level !== 'none').length)} of ${nf(arts.length)} article(s) have a level`,
    note: 'You decide each article\'s level. Pieces are the last 26 weeks from the Job Work Register; the rate is what the rate list pays, shown only to help you decide. An article with no level shows as "Not set" in the mix.',
    html: `<div class="xlwrap" style="max-height:58vh"><table class="xl"><thead><tr>
        <th style="text-align:left">Article</th><th style="text-align:left">Subtype</th><th class="num">Pieces (26 wk)</th><th class="num">Avg rate ₹</th><th>Level</th>
      </tr></thead><tbody>${arts.map(a => `<tr>
        <td style="text-align:left">${esc(a.at) || '<span class="muted">—</span>'}</td><td style="text-align:left">${esc(a.sub) || '<span class="muted">—</span>'}</td>
        <td class="num">${a.pcs ? nf(a.pcs) : '<span class="muted">—</span>'}</td>
        <td class="num">${a.avgRate ? a.avgRate.toFixed(1) : '<span class="muted">—</span>'}</td>
        <td><select data-lvkey="${esc(a.key)}"${can ? '' : ' disabled'} style="min-width:120px">${['', 'easy', 'mid', 'hard'].map(v => opt(v, a.level === 'none' ? '' : a.level)).join('')}</select></td>
      </tr>`).join('')}</tbody></table></div>`,
    onSave: can ? () => {
      const picks = {};
      $('ptDlgBody').querySelectorAll('[data-lvkey]').forEach(s => { picks[s.getAttribute('data-lvkey')] = s.value; });
      return kaLevelsSave(picks);
    } : null,
    saveLabel: 'Save levels',
  });
}

/** Every karigar's pieces over the weeks shown, split by level and by article type. */
function kaMix(weeksN, dept, q) {
  const weeks = paWeeks().slice(-weeksN);
  const from = paWkStartMs(weeks[0]), to = paWkStartMs(weeks[weeks.length - 1]) + 7 * PA_DAY;
  const roster = paRoster();
  const people = new Map();
  const blank = (key, name, dept0, type) => ({ key, name, dept: dept0, type, pcs: 0, value: 0, rated: 0, pd: 0,
    lv: { easy: 0, mid: 0, hard: 0, none: 0 }, byType: {} });
  const all = blank('', 'All karigars', '', '');
  const typeTot = {};
  (PT.base || []).forEach(r => {
    if (!r) return;
    const rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0, got = ptNum(r.receivedPieces);
    if (!rm || rm < from || rm >= to || !(got > 0)) return;
    const k = paN(r.empName), ro = roster.get(k);
    /* Salaried stitchers' work is not what this measures, and a pressman who received a row is not a
     * karigar. Somebody not on the list at all is kept — their pieces are real — under that label. */
    if (ro && (paIsSalaried(ro.type) || !paIsKarigar(ro.dept))) return;
    const type = r.empType || (ro ? ro.type : '');
    const rate = rateFor(r.articleType, r.articleSubtype, r.size, type) || 0;
    const lv = kaLevelOf(r.articleType, r.articleSubtype);
    const at = String(r.articleType || '').trim() || '(no article)';
    const p = people.get(k) || people.set(k, blank(k, ro ? ro.name : String(r.empName || '').trim(), ro ? ro.dept : '(not on the list)', type)).get(k);
    [p, all].forEach(o => {
      o.pcs += got; o.lv[lv] += got; o.byType[at] = (o.byType[at] || 0) + got;
      if (rate) { o.value += got * rate; o.rated += got; }
    });
    typeTot[at] = (typeTot[at] || 0) + got;
  });
  /* Person-days, from the same weekly facts the other studies use. */
  weeks.forEach(w => paWeekFacts(w).people.forEach(x => { const p = people.get(x.key); if (p) { p.pd += x.personDays || 0; all.pd += x.personDays || 0; } }));
  let rows = [...people.values()];
  if (dept) rows = rows.filter(r => paN(r.dept) === paN(dept));
  if (q) rows = rows.filter(r => paN(r.name + ' ' + r.dept + ' ' + r.type).includes(paN(q)));
  const pct = (n, d) => d ? n / d * 100 : 0;
  const finish = r => {
    r.easyPct = pct(r.lv.easy, r.pcs); r.midPct = pct(r.lv.mid, r.pcs); r.hardPct = pct(r.lv.hard, r.pcs); r.nonePct = pct(r.lv.none, r.pcs);
    r.avgRate = r.rated ? r.value / r.rated : 0;
    r.perDay = r.pd ? r.pcs / r.pd : 0;
  };
  rows.forEach(finish); finish(all);
  const types = Object.entries(typeTot).sort((a, c) => c[1] - a[1]).map(([t]) => t);
  const sortKey = (KA.mixSort && KA.mixSort.k) || 'pcs', dir = (KA.mixSort && KA.mixSort.dir) || -1;
  const sv = r => sortKey === 'name' ? r.name.toLowerCase() : sortKey.indexOf('type:') === 0 ? (r.byType[sortKey.slice(5)] || 0) : (r[sortKey] || 0);
  rows.sort((a, c) => { const x = sv(a), y = sv(c); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir || c.pcs - a.pcs; });
  return { weeks, rows, all, types };
}

function kaMixBar(r) {
  return `<div class="ka-mixbar" title="Easy ${r.easyPct.toFixed(0)}% · Medium ${r.midPct.toFixed(0)}% · Hard ${r.hardPct.toFixed(0)}%${r.lv.none ? ` · Not set ${r.nonePct.toFixed(0)}%` : ''}">`
    + KA_LEVELS.map(l => { const w = r[l.k + 'Pct']; return w > 0 ? `<span style="width:${w}%;background:${l.fg}"></span>` : ''; }).join('') + '</div>';
}

function renderKaMix() {
  const weeksN = parseInt($('kaWeeks').value, 10) || 8;
  const t = kaMix(weeksN, $('kaDept').value, $('kaQ').value.trim());
  KA.mix = t;
  const pc = v => v ? Math.round(v) + '%' : '<span class="muted">—</span>';
  const arrow = k => KA.mixSort && KA.mixSort.k === k ? (KA.mixSort.dir < 0 ? ' ↓' : ' ↑') : '';
  const th = (k, label, left) => `<th data-kmsort="${esc(k)}" class="${left ? 'frz' : 'num'}" style="cursor:pointer${left ? ';text-align:left' : ''}">${label}${arrow(k)}</th>`;
  const lvCell = (r, k) => {
    const l = kaLevelMeta(k), n = r.lv[k], p = r[k + 'Pct'];
    return `<td class="num" title="${nf(n)} piece(s)"${p >= 50 && k !== 'none' ? ` style="background:${l.bg};color:${l.fg};font-weight:700"` : ''}>${pc(p)}<div class="muted" style="font-size:10.5px">${n ? nf(n) : ''}</div></td>`;
  };
  const row = (r, isAll) => `<tr${isAll ? ' class="ka-all"' : ` data-ka="${esc(r.key)}" class="ka-row${KA.pick === r.key ? ' pa-on' : ''}"`}>`
    + `<td class="frz" style="text-align:left;font-weight:${isAll ? 800 : 600}">${esc(r.name)}${isAll ? '' : `<div class="muted" style="font-size:11px;font-weight:400">${esc(r.dept)}</div>`}</td>`
    + `<td class="num"><b>${nf(r.pcs)}</b></td>`
    + `<td style="min-width:120px">${kaMixBar(r)}</td>`
    + lvCell(r, 'easy') + lvCell(r, 'mid') + lvCell(r, 'hard') + lvCell(r, 'none')
    + `<td class="num">${r.avgRate ? '₹' + r.avgRate.toFixed(1) : '<span class="muted">—</span>'}</td>`
    + `<td class="num">₹${nf(Math.round(r.value))}</td>`
    + `<td class="num">${r.perDay ? r.perDay.toFixed(1) : '<span class="muted">—</span>'}</td>`
    + t.types.map(at => { const n = r.byType[at] || 0; return `<td class="num"${n ? '' : ' style="color:var(--muted)"'}>${n ? nf(n) + `<div class="muted" style="font-size:10.5px">${Math.round(n / r.pcs * 100)}%</div>` : '—'}</td>`; }).join('')
    + '</tr>';
  $('kaTable').innerHTML = '<thead><tr>'
    + th('name', 'Karigar', true) + th('pcs', 'Pieces made') + '<th>Mix</th>'
    + th('easyPct', 'Easy') + th('midPct', 'Medium') + th('hardPct', 'Hard') + th('nonePct', 'Not set')
    + th('avgRate', 'Avg ₹ / piece') + th('value', 'Labour value') + th('perDay', 'Pcs / person / day')
    + t.types.map(at => th('type:' + at, esc(at))).join('')
    + '</tr></thead><tbody>'
    + (t.rows.length ? row(t.all, true) : '')
    + t.rows.map(r => row(r, false)).join('')
    + (t.rows.length ? '' : `<tr><td colspan="${10 + t.types.length}" class="muted" style="padding:14px;text-align:left">No pieces received in these weeks.</td></tr>`)
    + '</tbody>';
  const none = t.all.lv.none;
  $('kaMsg').className = none ? 'err' : 'muted';
  $('kaMsg').textContent = `${nf(t.rows.length)} karigar(s) · ${nf(t.all.pcs)} pieces made in the last ${weeksN} weeks · `
    + `Easy / Medium / Hard are the levels you set per article · % is of each karigar's own pieces · click a karigar for every article`
    + (none ? ` · ${nf(none)} piece(s) are of articles with no level yet — press "Set easy / hard"` : '');
  kaRenderDetail();
}

