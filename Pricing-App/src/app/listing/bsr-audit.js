/* ---------- BSR audit ---------- */
/*
 * Weekly sales-rank snapshots per PARENT, kept forever, compared week on week.
 *
 * BSR belongs to a CHILD ASIN — a variation parent is not buyable and has no rank of its own — so a
 * parent's rank here is the BEST (lowest) rank among its children, i.e. how well the family is
 * placed. The category is carried with it, because a rank without its category is meaningless: 5,000
 * in Home & Kitchen and 5,000 in Bedding are not the same thing, and a listing can be recategorised
 * between weeks. When that happens the comparison is flagged rather than silently reported as a swing.
 *
 * LOWER IS BETTER. Everywhere below, a rank going DOWN is an improvement.
 *
 * Snapshots are APPEND-ONLY: one document per brand per ISO week, never overwritten, never deleted.
 */
const BSR_SNAP_MAX = 1200;                 // child ASINs ranked per run; resumes next run
let BSR = { SP: {}, CPC: {} };             // brand → { week → { parent: {rank, cat, n} } }
let BSR_WEEKS = { SP: [], CPC: [] };
let BSR_META = {};                         // "brand__week" → { takenOn, backdated }
let BSR_LOADED = false;
let BSR_SORT = { k: 'delta', dir: -1 };
let BSR_RENDER = { rows: [], defs: [], val: () => '' };

function bMsg(t, bad) { const m = $('bMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

/** ISO week key, e.g. 2026-W29. Weeks start Monday, so a Sunday snapshot lands in the week just ended. */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;                    // Mon=1 … Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day);            // move to the Thursday of this week
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function loadBsrCache() {
  for (const b of ['SP', 'CPC']) {
    try {
      const idx = await getDoc(doc(db, 'bsr', b));
      const weeks = idx.exists() ? (idx.data().weeks || []) : [];
      BSR_WEEKS[b] = weeks.slice().sort();
      BSR[b] = {};
      // Only the two most recent weeks are needed to draw the comparison; older weeks stay on disk
      // and are fetched on demand when picked. Loading a year of history up front would be waste.
      const need = BSR_WEEKS[b].slice(-2);
      await Promise.all(need.map(async w => {
        const s = await getDoc(doc(db, 'bsrweeks', `${b}__${w}`));
        if (!s.exists()) return;
        const d = s.data();
        BSR[b][w] = d.r || {};
        BSR_META[`${b}__${w}`] = { takenOn: d.takenOn || '', backdated: !!d.backdated };
      }));
    } catch (e) { bMsg(`Could not load ${BRAND_NAME[b]} BSR history: ${e.message || e}`, true); }
  }
  BSR_LOADED = true;
}
async function loadBsrWeek(brand, week) {
  if (BSR[brand][week]) return;
  const s = await getDoc(doc(db, 'bsrweeks', `${brand}__${week}`));
  if (!s.exists()) { BSR[brand][week] = {}; return; }
  const d = s.data();
  BSR[brand][week] = d.r || {};
  BSR_META[`${brand}__${week}`] = { takenOn: d.takenOn || '', backdated: !!d.backdated };
}
async function ensureBsr() {
  await loadParentNames();
  if (!H_LOADED) await loadHealthCache();
  if (!BSR_LOADED) { bMsg('Loading history…'); await loadBsrCache(); bMsg(''); }
  fillWeekPickers();
  renderBsr();
}

function allWeeks() {
  return [...new Set([...BSR_WEEKS.SP, ...BSR_WEEKS.CPC])].sort();
}
function fillWeekPickers() {
  const ws = allWeeks();
  const opts = ws.map(w => `<option value="${w}">${w}</option>`).join('');
  $('bWeekA').innerHTML = opts; $('bWeekB').innerHTML = opts;
  if (ws.length) {
    $('bWeekA').value = ws[ws.length - 1];                      // this week
    $('bWeekB').value = ws[ws.length - 2] || ws[ws.length - 1];  // the week before
  }
}

/* ----- take a snapshot ----- */
$('bSnap').onclick = async () => {
  const btn = $('bSnap');
  const today = new Date();
  // The week this snapshot is FILED under. Normally the current week, but it can be filed as last
  // week so a baseline exists immediately instead of waiting seven days for a first comparison.
  const back = $('bSaveAs').value === 'last';
  const week = isoWeek(back ? new Date(today.getTime() - 7 * 86400000) : today);
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>…';
  // Nothing may claim success unless a document was actually written. The first cut printed
  // "Snapshot saved" after the loop unconditionally — so a run where every brand failed still
  // reported success, and the real error was overwritten by it.
  const saved = [], failed = [];
  try {
    for (const brand of ['SP', 'CPC']) {
      const rows = HEALTH[brand]?.rows || [];
      if (!rows.length) { failed.push(`${BRAND_NAME[brand]}: no listings loaded — run Listing health first`); continue; }

      // Rank every child, then keep the best per parent.
      const asins = [...new Set(rows.map(r => r.asin).filter(Boolean))].slice(0, BSR_SNAP_MAX);
      const got = {};
      let firstErr = '';
      for (let i = 0; i < asins.length; i += 20 * H_SWEEP_PAR) {
        const grp = [];
        for (let j = i; j < Math.min(i + 20 * H_SWEEP_PAR, asins.length); j += 20) grp.push(asins.slice(j, j + 20));
        bMsg(`${BRAND_NAME[brand]}: reading BSR… ${Math.min(i + 20 * H_SWEEP_PAR, asins.length)} / ${asins.length}`);
        // Keep the FIRST real error. Swallowing them all meant a backend endpoint that isn't live
        // looked exactly like "Amazon has no ranks", which is a completely different problem.
        const res = await Promise.all(grp.map(b =>
          baCall({ lh: 'bsr', brand, asins: b.join(',') }).catch(e => ({ _err: e.message || String(e) }))));
        res.forEach(d => {
          if (d && d._err) { if (!firstErr) firstErr = d._err; return; }
          if (d) Object.assign(got, d.map || {});
        });
      }

      // The family is represented by its BEST-PLACED CHILD BY MAIN RANK, and that child's sub rank
      // travels with it. Taking the best main from one child and the best sub from another would
      // describe a listing that does not exist.
      const byParent = {};
      rows.forEach(r => {
        const g = got[r.asin];
        if (!g || !(g.rank > 0)) return;                 // no MAIN rank returned is NOT rank zero
        const key = r.parent || r.asin;
        const o = byParent[key] || (byParent[key] = { rank: g.rank, cat: g.cat, sub: g.sub || 0, subCat: g.subCat || '', n: 0 });
        o.n++;
        if (g.rank < o.rank) { o.rank = g.rank; o.cat = g.cat; o.sub = g.sub || 0; o.subCat = g.subCat || ''; }
      });
      if (!Object.keys(byParent).length) {
        failed.push(`${BRAND_NAME[brand]}: no ranks came back — nothing saved`
          + (firstErr ? ` (${firstErr})` : ''));
        continue;
      }

      // Append-only: one document per brand per week. An existing week is overwritten only if you
      // snapshot twice into the same week; previous weeks are never touched.
      // `takenOn` records the REAL capture date, so a backdated snapshot can never be mistaken for a
      // genuine reading from that week.
      await setDoc(doc(db, 'bsrweeks', `${brand}__${week}`), {
        r: byParent, at: serverTimestamp(),
        takenOn: today.toISOString().slice(0, 10), backdated: back,
      });
      const weeks = [...new Set([...(BSR_WEEKS[brand] || []), week])].sort();
      await setDoc(doc(db, 'bsr', brand), { weeks, at: serverTimestamp() });
      BSR_WEEKS[brand] = weeks; BSR[brand][week] = byParent;
      BSR_META[`${brand}__${week}`] = { takenOn: today.toISOString().slice(0, 10), backdated: back };
      saved.push(`${BRAND_NAME[brand]} ${Object.keys(byParent).length} parents`);
    }
    fillWeekPickers();
    renderBsr();
    bMsg(saved.length
      ? `Saved into ${week}${back ? ' (filed as last week — actually captured today)' : ''}: ${saved.join(' · ')}.`
        + (failed.length ? `  ·  ${failed.join('  ·  ')}` : ' Earlier weeks are untouched.')
      : `Nothing saved. ${failed.join('  ·  ')}`, !saved.length);
  } catch (e) { bMsg('Snapshot failed: ' + (e.message || e), true); }
  btn.disabled = false; btn.textContent = 'Take snapshot';
};

/*
 * The suggested action. THIS IS A HEURISTIC, NOT A MEASUREMENT — it is spelled out on screen so it
 * can be judged rather than trusted blindly.
 *
 * The honest limit: this app has no advertising data, so nothing here can actually SEE whether PPC is
 * underperforming. What it can do is use what it does know — stock, listing content, and the SHAPE of
 * the rank move — to say which lever is worth looking at first, and to stop money being spent on a
 * listing that cannot convert anyway.
 */
function bsrAction(row) {
  const { rank, prev, health } = row;
  if (!prev) return { a: 'Baseline', why: 'First snapshot for this parent — nothing to compare yet.' };
  if (!rank) return { a: 'No rank', why: 'Amazon returned no rank this week (often means no recent sales, or the listing is inactive).' };
  if (row.catChanged) return { a: 'Check category', why: 'The rank category changed between the two weeks, so the numbers are not comparable.' };

  const pct = (rank - prev) / prev;              // positive = rank got bigger = worse
  const h = health || {};
  if (h.qty === 0) return { a: 'Restock first',
    why: 'Out of stock. Rank falls while unavailable and a deal or extra spend would push traffic at a listing that cannot convert.' };

  if (pct > 0.30) {
    if (h.noImage || h.gaps) return { a: 'Fix the listing',
      why: `Rank worsened ${Math.round(pct * 100)}% and the listing has content gaps. Fix images/A+ before paying for traffic.` };
    return { a: 'Deal / price check',
      why: `Sharp drop of ${Math.round(pct * 100)}%. A fall this fast is usually price or competition, not visibility — compare against competitors and consider a coupon or deal.` };
  }
  if (pct > 0.10) return { a: 'Review PPC',
    why: `Gradual slide of ${Math.round(pct * 100)}%. Slow erosion is more often visibility than price — review keywords, bids and impression share.` };
  if (pct < -0.10) return { a: 'Working — hold',
    why: `Improved ${Math.round(-pct * 100)}%. Whatever is running is working; leave it alone.` };
  return { a: 'Stable', why: 'Within 10% of last week — no action.' };
}

let BSR_MODE = 'compare';                   // 'compare' = A vs B · 'history' = many weeks in columns
let BSR_T = 0;
$('bFilter').addEventListener('input', () => { clearTimeout(BSR_T); BSR_T = setTimeout(renderBsr, 250); });
$('bBrandView').addEventListener('change', renderBsr);
$('bMoveView').addEventListener('change', renderBsr);
$('bWeekA').addEventListener('change', async () => { await pickWeeks(); renderBsr(); });
$('bWeekB').addEventListener('change', async () => { await pickWeeks(); renderBsr(); });
$('bHistWeeks').addEventListener('change', () => renderBsr());
$('bModeCompare').onclick = () => setBsrMode('compare');
$('bModeHistory').onclick = () => setBsrMode('history');

function setBsrMode(m) {
  BSR_MODE = m;
  $('bModeCompare').classList.toggle('on', m === 'compare');
  $('bModeHistory').classList.toggle('on', m === 'history');
  // The comparison controls and the reference-only week pickers only make sense in Compare mode; the
  // "how many weeks" picker only in History. Toggle them rather than leaving dead controls on screen.
  document.querySelectorAll('#paneBsr .cmpOnly').forEach(el => el.classList.toggle('hide', m !== 'compare'));
  document.querySelectorAll('#paneBsr .histOnly').forEach(el => el.classList.toggle('hide', m !== 'history'));
  renderBsr();
}

async function pickWeeks() {
  const a = $('bWeekA').value, b = $('bWeekB').value;
  for (const br of ['SP', 'CPC']) {
    if (BSR_WEEKS[br].includes(a)) await loadBsrWeek(br, a);
    if (BSR_WEEKS[br].includes(b)) await loadBsrWeek(br, b);
  }
}

function renderBsr() {
  if (BSR_MODE === 'history') return renderBsrHistory();
  $('bRules').closest('.card').classList.remove('hide');
  const pick = $('bBrandView').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]);
  const wA = $('bWeekA').value, wB = $('bWeekB').value;

  if (!allWeeks().length) {
    $('bKpis').innerHTML = '<div class="kpi"><div class="kpiname">No snapshots yet</div>'
      + '<div class="muted" style="margin-top:6px">Hit “Take this week’s snapshot”. Run it every weekend — each week is stored separately and nothing is ever overwritten.</div></div>';
    $('bTable').innerHTML = ''; $('bRules').innerHTML = ''; return;
  }

  // Health facts feed the action heuristic, so it can tell "out of stock" from "losing visibility".
  const healthBy = {};
  brands.forEach(b => (HEALTH[b]?.rows || []).forEach(r => {
    const k = (r.parent || r.asin) + '|' + b;
    const o = healthBy[k] || (healthBy[k] = { qty: null, gaps: 0, noImage: 0 });
    if (r.qty != null) o.qty = (o.qty || 0) + r.qty;
    if (r.content && !r.content.images) o.noImage++;
    if (r.aplus === false) o.gaps++;
  }));

  let rows = [];
  brands.forEach(b => {
    const now = BSR[b][wA] || {}, before = BSR[b][wB] || {};
    const keys = new Set([...Object.keys(now), ...Object.keys(before)]);
    keys.forEach(p => {
      const n = now[p], o = before[p];
      const rank = n?.rank || 0, prev = o?.rank || 0;
      const health = healthBy[p + '|' + b] || {};
      const row = { parent: p, brand: b, rank, prev, cat: n?.cat || o?.cat || '',
        // Sub-category rank is carried FOR REFERENCE ONLY — nothing below decides anything from it.
        sub: n?.sub || 0, subPrev: o?.sub || 0, subCat: n?.subCat || o?.subCat || '',
        children: n?.n || o?.n || 0, health,
        catChanged: !!(n?.cat && o?.cat && n.cat !== o.cat),
        title: parentName(b, p, '') };
      row.subDelta = (row.sub && row.subPrev) ? row.sub - row.subPrev : null;
      // Lower rank = better, so an improvement is a NEGATIVE delta. `moved` keeps the sign explicit
      // rather than leaving "up" and "down" to mean whatever the reader assumes.
      row.delta = (rank && prev) ? rank - prev : null;
      row.pct = (rank && prev) ? Math.round(((rank - prev) / prev) * 100) : null;
      const act = bsrAction(row);
      row.action = act.a; row.why = act.why;
      rows.push(row);
    });
  });

  const view = $('bMoveView').value;
  if (view === 'worse') rows = rows.filter(r => r.delta > 0);
  else if (view === 'better') rows = rows.filter(r => r.delta < 0);
  else if (view === 'action') rows = rows.filter(r => !['Stable', 'Working — hold', 'Baseline'].includes(r.action));

  const q = $('bFilter').value.trim().toLowerCase();
  if (q) rows = rows.filter(r => (r.parent + ' ' + (r.title || '')).toLowerCase().includes(q));

  const multiBrand = new Set(rows.map(r => r.brand)).size > 1;
  const defs = [{ k: 'parent', t: 'Parent ASIN', frz: 1, mono: 1 }];
  if (multiBrand) defs.push({ k: 'brand', t: 'Brand', map: r => BRAND_NAME[r.brand] });
  defs.push({ k: 'title', t: 'Parent name', trunc: 30,
    cell: r => parentNameCell(r.brand, r.parent, r.title, 30) });
  defs.push({ k: 'cat', t: 'Main cat.', trunc: 20,
    tip: 'The broad department rank, e.g. "Home & Kitchen". Everything below — the change, the % and the suggested action — is based on THIS rank.' });
  defs.push({ k: 'prev', t: `Main ${wB}`, num: 1, noTotal: 1, tip: 'Main-category rank that week. Lower is better.' });
  defs.push({ k: 'rank', t: `Main ${wA}`, num: 1, noTotal: 1, bold: 1, tip: 'Main-category rank that week. Lower is better.' });
  defs.push({ k: 'delta', t: 'Change', num: 1, noTotal: 1, signed: 1,
    tip: 'Main-category rank difference. NEGATIVE is an improvement, because a smaller rank is better.' });
  defs.push({ k: 'pct', t: '%', num: 1, noTotal: 1, signed: 1, pct: 1 });
  // Sub-category is reference only, and says so — it is not what the comparison or the action uses.
  defs.push({ k: 'subCat', t: 'Sub cat.', trunc: 20, tip: 'Reference only — not used for the comparison or the suggested action.' });
  defs.push({ k: 'sub', t: `Sub ${wA}`, num: 1, noTotal: 1, tip: 'Sub-category rank this week. Reference only.' });
  defs.push({ k: 'subDelta', t: 'Sub chg', num: 1, noTotal: 1, signed: 1, muted: 1,
    tip: 'Sub-category movement, shown for context. The suggested action ignores it.' });
  defs.push({ k: 'action', t: 'Suggested action', tip: 'A heuristic, not a measurement — the rules are printed below the table.' });
  defs.push({ k: 'why', t: 'Why', trunc: 60 });

  const val = (r, d) => (d.map ? d.map(r) : r[d.k]);
  const sd = defs.find(d => d.k === BSR_SORT.k) || defs.find(d => d.k === 'delta');
  rows.sort((a, b) => {
    const x = val(a, sd), y = val(b, sd);
    if (x == null) return 1; if (y == null) return -1;
    const c = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x || '').localeCompare(String(y || ''));
    return c * BSR_SORT.dir;
  });

  BSR_RENDER = { rows, defs, val };
  const shown = rows.slice(0, H_PAGE);
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const dash = '<span class="muted">—</span>';
  const arrow = d => d.k === BSR_SORT.k ? (BSR_SORT.dir < 0 ? ' ↓' : ' ↑') : '';

  const head = '<thead><tr>' + defs.map(d =>
    `<th data-k="${esc(d.k)}" class="${d.frz ? 'frz ' : ''}${d.num ? 'num' : ''}"${
      d.tip ? ` title="${esc(d.tip)}"` : ''}>${esc(d.t)}${arrow(d)}</th>`).join('') + '</tr></thead>';

  const body = shown.map(r => '<tr>' + defs.map(d => {
    const v = val(r, d);
    const cls = (d.frz ? 'frz ' : '') + (d.num ? 'num' : '');
    if (d.cell) return `<td class="${cls}">${d.cell(r)}</td>`;
    if (d.signed) {
      if (v == null) return `<td class="${cls}">${dash}</td>`;
      const txt = (v > 0 ? '+' : '') + Number(v).toLocaleString('en-US') + (d.pct ? '%' : '');
      // Reference columns stay grey. Only the number the action is based on gets to shout.
      if (d.muted) return `<td class="${cls}"><span class="muted">${txt}</span></td>`;
      // Colour follows MEANING, not sign: improvement (negative) is green.
      const good = v < 0;
      return `<td class="${cls}" style="font-weight:600;color:${good ? 'var(--accent)' : (v > 0 ? 'var(--bad)' : 'inherit')}">${txt}</td>`;
    }
    if (d.num) return `<td class="${cls}">${v ? Number(v).toLocaleString('en-US') : dash}</td>`;
    if (d.trunc) return `<td class="${cls}" title="${esc(v)}">${esc(String(v || '').slice(0, d.trunc)) || dash}</td>`;
    return `<td class="${cls}" style="${d.mono ? 'font-family:ui-monospace,monospace' : ''}">${esc(v) || dash}</td>`;
  }).join('') + '</tr>').join('');

  $('bTable').innerHTML = head + '<tbody>' + (body ||
    `<tr><td colspan="${defs.length}" class="muted">No parents match.</td></tr>`)
    + '</tbody>' + (rows.length ? `<tfoot><tr><td class="frz">TOTAL · ${rows.length}</td>${
      defs.slice(1).map(() => '<td></td>').join('')}</tr></tfoot>` : '');

  $('bTable').querySelectorAll('thead th').forEach(th => {
    th.onclick = () => { const k = th.dataset.k; BSR_SORT = { k, dir: BSR_SORT.k === k ? -BSR_SORT.dir : -1 }; renderBsr(); };
  });
  wireParentNameCells('bTable', renderBsr);

  renderBsrKpis(rows, wA, wB);
  $('bRules').innerHTML = `
    <b>Everything here is based on the MAIN category rank</b> (e.g. #13,206 in Home &amp; Kitchen).
    The sub-category rank (e.g. #109 in Throw Pillow Covers) is shown for reference and is never used
    for the change, the % or the action — the two are different scales and cannot be compared.<br>
    <b>Lower BSR is better</b>, so a negative Change is an improvement.<br><br>
    <b>Out of stock</b> → <i>Restock first.</i> Rank falls while unavailable; spend would push traffic at a listing that cannot convert.<br>
    <b>Worse by more than 30%</b> → <i>Fix the listing</i> if it has content gaps or no images, otherwise <i>Deal / price check</i> — a fall that fast is usually price or competition, not visibility.<br>
    <b>Worse by 10–30%</b> → <i>Review PPC.</i> Slow erosion is more often visibility than price.<br>
    <b>Better by more than 10%</b> → <i>Working — hold.</i><br>
    <b>Within 10%</b> → <i>Stable.</i><br><br>
    <b>The limit of this:</b> the app holds no advertising data, so nothing here can actually see whether
    your PPC is underperforming — it infers which lever to look at first from stock, listing content and
    the shape of the move. To make the PPC half real, the Amazon Ads API would have to be connected.`;
}

function renderBsrKpis(rows, wA, wB) {
  const nf = v => Number(v || 0).toLocaleString('en-US');
  const worse = rows.filter(r => r.delta > 0).length;
  const better = rows.filter(r => r.delta < 0).length;
  const act = rows.filter(r => !['Stable', 'Working — hold', 'Baseline'].includes(r.action)).length;
  // A week that was filed rather than captured in that week must say so wherever it is compared —
  // otherwise a backdated baseline silently reads as a genuine reading from that week.
  const mark = w => {
    const m = ['SP', 'CPC'].map(b => BSR_META[`${b}__${w}`]).find(x => x && x.backdated);
    return m ? ` <span class="muted">(captured ${m.takenOn})</span>` : '';
  };
  $('bKpis').innerHTML = `<div class="kpi">
    <div class="kpihead"><span class="kpiname">${wA}${mark(wA)} vs ${wB}${mark(wB)}</span>
      <span class="kpiwhen">${nf(rows.length)} parents compared</span></div>
    <div class="metrics">
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(worse)}</div><div class="l">Rank got worse</div></div>
      <div class="metric"><div class="v" style="color:var(--accent)">${nf(better)}</div><div class="l">Improved</div></div>
      <div class="metric"><div class="v" style="font-size:15px">${nf(act)}</div><div class="l">Need action</div></div>
      <div class="metric"><div class="v" style="font-size:15px">${nf(allWeeks().length)}</div><div class="l">Weeks stored</div></div>
    </div></div>`;
}

/**
 * Full history: every stored week as a column, one row per parent, MAIN rank in each cell.
 *
 * Older weeks are loaded on demand here — the tab only pre-loads the latest two for speed, so this
 * fetches whatever else the chosen window needs. Each cell is coloured against the PREVIOUS week's
 * value for that same parent (improvement green, worse red), so the trend reads straight across.
 */
async function renderBsrHistory() {
  $('bRules').closest('.card').classList.add('hide');   // the action rules belong to Compare mode
  const pick = $('bBrandView').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]);

  if (!allWeeks().length) {
    $('bKpis').innerHTML = '<div class="kpi"><div class="kpiname">No snapshots yet</div>'
      + '<div class="muted" style="margin-top:6px">Take a snapshot each weekend — the history builds up here, one column per week.</div></div>';
    $('bTable').innerHTML = ''; return;
  }

  const want = Math.max(2, +$('bHistWeeks').value || 6);
  const weeks = allWeeks().slice(-want);                 // oldest → newest

  // Pull every week this window needs that isn't already in memory.
  $('bMsg').textContent = 'Loading history…';
  for (const b of brands) for (const w of weeks) {
    if (BSR_WEEKS[b].includes(w)) await loadBsrWeek(b, w);
  }
  $('bMsg').textContent = '';

  const multiBrand = brands.length > 1;
  const byKey = {};
  brands.forEach(b => weeks.forEach(w => {
    Object.entries(BSR[b][w] || {}).forEach(([p, v]) => {
      const k = p + '|' + b;
      const o = byKey[k] || (byKey[k] = { parent: p, brand: b, title: parentName(b, p, ''),
        cat: '', ranks: {} });
      if (v.rank > 0) { o.ranks[w] = v.rank; o.cat = v.cat || o.cat; }
    });
  }));
  let rows = Object.values(byKey);

  const q = $('bFilter').value.trim().toLowerCase();
  if (q) rows = rows.filter(r => (r.parent + ' ' + (r.title || '')).toLowerCase().includes(q));

  // First→last change across the shown window (only where both ends exist), and the latest rank for
  // sorting. Lower rank is better, so improvement is negative.
  const latest = weeks[weeks.length - 1], earliest = weeks[0];
  rows.forEach(r => {
    r.latest = r.ranks[latest] || null;
    const a = r.ranks[latest], z = r.ranks[earliest];
    r.trend = (a && z) ? a - z : null;
  });
  rows.sort((x, y) => (x.latest == null ? 1 : y.latest == null ? -1 : x.latest - y.latest));

  const defs = [{ k: 'parent', t: 'Parent ASIN', frz: 1, mono: 1 }];
  if (multiBrand) defs.push({ k: 'brand', t: 'Brand', map: r => BRAND_NAME[r.brand] });
  defs.push({ k: 'title', t: 'Parent name', trunc: 26, cell: r => parentNameCell(r.brand, r.parent, r.title, 26) });
  weeks.forEach(w => defs.push({ k: 'w_' + w, t: w, num: 1, week: w,
    tip: `Main-category rank in ${w}. Lower is better.` }));
  defs.push({ k: 'trend', t: `Δ ${weeks.length}w`, num: 1, signed: 1,
    tip: `Change from ${earliest} to ${latest}. Negative = improved.` });

  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const dash = '<span class="muted">—</span>';
  const val = (r, d) => d.week ? (r.ranks[d.week] || null) : (d.map ? d.map(r) : r[d.k]);
  BSR_RENDER = { rows, defs, val };                     // Export uses this too
  const shown = rows.slice(0, H_PAGE);

  const head = '<thead><tr>' + defs.map(d =>
    `<th class="${d.frz ? 'frz ' : ''}${d.num ? 'num' : ''}"${d.tip ? ` title="${esc(d.tip)}"` : ''}>${esc(d.t)}</th>`).join('') + '</tr></thead>';

  const body = shown.map(r => '<tr>' + defs.map((d, ci) => {
    const cls = (d.frz ? 'frz ' : '') + (d.num ? 'num' : '');
    if (d.cell) return `<td class="${cls}">${d.cell(r)}</td>`;
    if (d.week) {
      const v = r.ranks[d.week];
      if (!v) return `<td class="${cls}">${dash}</td>`;
      // Colour vs the previous SHOWN week for this parent. Missing weeks are skipped, not treated as
      // a jump — a week you didn't snapshot is unknown, not a rank of zero.
      let prev = null;
      for (let k = weeks.indexOf(d.week) - 1; k >= 0; k--) { if (r.ranks[weeks[k]]) { prev = r.ranks[weeks[k]]; break; } }
      const col = prev == null ? 'inherit' : (v < prev ? 'var(--accent)' : v > prev ? 'var(--bad)' : 'inherit');
      return `<td class="${cls}" style="color:${col}">${v.toLocaleString('en-US')}</td>`;
    }
    if (d.signed) {
      const v = val(r, d);
      if (v == null) return `<td class="${cls}">${dash}</td>`;
      const good = v < 0;
      return `<td class="${cls}" style="font-weight:600;color:${good ? 'var(--accent)' : v > 0 ? 'var(--bad)' : 'inherit'}">${(v > 0 ? '+' : '') + v.toLocaleString('en-US')}</td>`;
    }
    const v = val(r, d);
    return `<td class="${cls}" style="${d.mono ? 'font-family:ui-monospace,monospace' : ''}">${esc(v) || dash}</td>`;
  }).join('') + '</tr>').join('');

  $('bTable').innerHTML = head + '<tbody>' + (body ||
    `<tr><td colspan="${defs.length}" class="muted">No parents match.</td></tr>`)
    + '</tbody>' + (rows.length ? `<tfoot><tr><td class="frz">TOTAL · ${rows.length}</td>${
      defs.slice(1).map(() => '<td></td>').join('')}</tr></tfoot>` : '');

  const improved = rows.filter(r => r.trend < 0).length, worsened = rows.filter(r => r.trend > 0).length;
  $('bKpis').innerHTML = `<div class="kpi">
    <div class="kpihead"><span class="kpiname">History · ${weeks.length} weeks (${earliest} → ${latest})</span>
      <span class="kpiwhen">${rows.length.toLocaleString('en-US')} parents</span></div>
    <div class="metrics">
      <div class="metric"><div class="v" style="color:var(--accent)">${improved.toLocaleString('en-US')}</div><div class="l">Improved over window</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${worsened.toLocaleString('en-US')}</div><div class="l">Worse over window</div></div>
      <div class="metric"><div class="v" style="font-size:15px">${allWeeks().length}</div><div class="l">Weeks stored</div></div>
      <div class="metric"><div class="v" style="font-size:15px">${weeks.length}</div><div class="l">Weeks shown</div></div>
    </div></div>`;
}

$('bCsv').onclick = () => {
  if (!BSR_RENDER.rows.length) return;
  const { rows, defs, val } = BSR_RENDER;
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [defs.map(d => cell(d.t)).join(',')];
  rows.forEach(r => lines.push(defs.map(d => cell(val(r, d))).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bsr-audit-${$('bWeekA').value}-vs-${$('bWeekB').value}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

