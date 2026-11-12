/* ================= LISTING · BSR AUDIT: weekly best-seller-rank snapshots per parent, compared week on week =================
 * Screens: BSR Audit (tab 'bsr').
 * Does: "Take snapshot" reads every child's rank from the backend (baCall lh=bsr) and files the best child rank per parent
 *       under the ISO week (append-only, one Firestore doc per brand per week); Compare mode sets week A against week B with
 *       a suggested action per parent (a heuristic from stock, content gaps and the size of the move); History mode shows
 *       many weeks as columns; Export writes what is on screen to CSV.
 * Main functions: isoWeek, loadBsrCache, loadBsrWeek, ensureBsr, fillWeekPickers, the bSnap handler, bsrAction, setBsrMode,
 *                 pickWeeks, renderBsr, renderBsrKpis, renderBsrHistory, the bCsv handler. */
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
let BSR_WEEKS = { SP: [], CPC: [] };       // brand → the weeks stored, oldest first
let BSR_META = {};                         // "brand__week" → { takenOn, backdated }
let BSR_LOADED = false;
let BSR_SORT = { k: 'delta', dir: -1 };    // Compare table sort: column key and direction (-1 = biggest first)
let BSR_RENDER = { rows: [], defs: [], val: () => '' };   // what the table shows now — Export reads it

// Status line under the toolbar: red for an error, grey otherwise.
function bMsg(text, bad) {
  const msg = $('bMsg');
  msg.textContent = text || '';
  msg.className = bad ? 'err' : 'muted';
}

/** ISO week key, e.g. 2026-W29. Weeks start Monday, so a Sunday snapshot lands in the week just ended. */
function isoWeek(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;                    // Mon=1 … Sun=7
  utc.setUTCDate(utc.getUTCDate() + 4 - day);          // move to the Thursday of this week
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Read each brand's list of stored weeks and the two most recent weeks' snapshots.
async function loadBsrCache() {
  for (const brand of ['SP', 'CPC']) {
    try {
      const idx = await getDoc(doc(db, 'bsr', brand));
      const weeks = idx.exists() ? (idx.data().weeks || []) : [];
      BSR_WEEKS[brand] = weeks.slice().sort();
      BSR[brand] = {};
      // Only the two most recent weeks are needed to draw the comparison; older weeks stay on disk
      // and are fetched on demand when picked. Loading a year of history up front would be waste.
      const need = BSR_WEEKS[brand].slice(-2);
      await Promise.all(need.map(async week => {
        const snap = await getDoc(doc(db, 'bsrweeks', `${brand}__${week}`));
        if (!snap.exists()) return;
        const data = snap.data();
        BSR[brand][week] = data.r || {};
        BSR_META[`${brand}__${week}`] = { takenOn: data.takenOn || '', backdated: !!data.backdated };
      }));
    } catch (e) {
      bMsg(`Could not load ${BRAND_NAME[brand]} BSR history: ${e.message || e}`, true);
    }
  }
  BSR_LOADED = true;
}
// Read one brand's snapshot for one week, if it is not in memory yet.
async function loadBsrWeek(brand, week) {
  if (BSR[brand][week]) return;
  const snap = await getDoc(doc(db, 'bsrweeks', `${brand}__${week}`));
  if (!snap.exists()) {
    BSR[brand][week] = {};
    return;
  }
  const data = snap.data();
  BSR[brand][week] = data.r || {};
  BSR_META[`${brand}__${week}`] = { takenOn: data.takenOn || '', backdated: !!data.backdated };
}
// First visit to the tab: parent names, the listings snapshot, the stored weeks, then draw.
async function ensureBsr() {
  await loadParentNames();
  if (!H_LOADED) await loadHealthCache();
  if (!BSR_LOADED) {
    bMsg('Loading history…');
    await loadBsrCache();
    bMsg('');
  }
  fillWeekPickers();
  renderBsr();
}

// Every week stored for either brand, oldest first.
function allWeeks() {
  return [...new Set([...BSR_WEEKS.SP, ...BSR_WEEKS.CPC])].sort();
}
// Fill the two week pickers and preselect the latest week against the one before.
function fillWeekPickers() {
  const weeks = allWeeks();
  const opts = weeks.map(week => `<option value="${week}">${week}</option>`).join('');
  $('bWeekA').innerHTML = opts;
  $('bWeekB').innerHTML = opts;
  if (weeks.length) {
    $('bWeekA').value = weeks[weeks.length - 1];                            // this week
    $('bWeekB').value = weeks[weeks.length - 2] || weeks[weeks.length - 1];  // the week before
  }
}

/* ----- take a snapshot ----- */
// Take snapshot: rank every child of both brands, keep the best per parent, file it under this week (or last week).
$('bSnap').onclick = async () => {
  const btn = $('bSnap');
  const today = new Date();
  // The week this snapshot is FILED under. Normally the current week, but it can be filed as last
  // week so a baseline exists immediately instead of waiting seven days for a first comparison.
  const back = $('bSaveAs').value === 'last';
  const week = isoWeek(back ? new Date(today.getTime() - 7 * 86400000) : today);
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>…';
  // Nothing may claim success unless a document was actually written. The first cut printed
  // "Snapshot saved" after the loop unconditionally — so a run where every brand failed still
  // reported success, and the real error was overwritten by it.
  const saved = [];
  const failed = [];
  try {
    for (const brand of ['SP', 'CPC']) {
      const rows = HEALTH[brand]?.rows || [];
      if (!rows.length) {
        failed.push(`${BRAND_NAME[brand]}: no listings loaded — run Listing health first`);
        continue;
      }

      // --- rank every child, 20 ASINs a call, H_SWEEP_PAR calls at a time ---
      // Rank every child, then keep the best per parent.
      const asins = [...new Set(rows.map(row => row.asin).filter(Boolean))].slice(0, BSR_SNAP_MAX);
      const got = {};
      let firstErr = '';
      for (let i = 0; i < asins.length; i += 20 * H_SWEEP_PAR) {
        const grp = [];
        for (let j = i; j < Math.min(i + 20 * H_SWEEP_PAR, asins.length); j += 20) grp.push(asins.slice(j, j + 20));
        bMsg(`${BRAND_NAME[brand]}: reading BSR… ${Math.min(i + 20 * H_SWEEP_PAR, asins.length)} / ${asins.length}`);
        // Keep the FIRST real error. Swallowing them all meant a backend endpoint that isn't live
        // looked exactly like "Amazon has no ranks", which is a completely different problem.
        const res = await Promise.all(grp.map(chunk =>
          baCall({ lh: 'bsr', brand, asins: chunk.join(',') }).catch(e => ({ _err: e.message || String(e) }))));
        res.forEach(reply => {
          if (reply && reply._err) {
            if (!firstErr) firstErr = reply._err;
            return;
          }
          if (reply) Object.assign(got, reply.map || {});
        });
      }

      // --- the best child per parent ---
      // The family is represented by its BEST-PLACED CHILD BY MAIN RANK, and that child's sub rank
      // travels with it. Taking the best main from one child and the best sub from another would
      // describe a listing that does not exist.
      const byParent = {};
      rows.forEach(row => {
        const child = got[row.asin];
        if (!child || !(child.rank > 0)) return;         // no MAIN rank returned is NOT rank zero
        const key = row.parent || row.asin;
        const best = byParent[key] || (byParent[key] = { rank: child.rank, cat: child.cat, sub: child.sub || 0, subCat: child.subCat || '', n: 0 });
        best.n++;
        if (child.rank < best.rank) {
          best.rank = child.rank;
          best.cat = child.cat;
          best.sub = child.sub || 0;
          best.subCat = child.subCat || '';
        }
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
      BSR_WEEKS[brand] = weeks;
      BSR[brand][week] = byParent;
      BSR_META[`${brand}__${week}`] = { takenOn: today.toISOString().slice(0, 10), backdated: back };
      saved.push(`${BRAND_NAME[brand]} ${Object.keys(byParent).length} parents`);
    }
    fillWeekPickers();
    renderBsr();
    bMsg(saved.length
      ? `Saved into ${week}${back ? ' (filed as last week — actually captured today)' : ''}: ${saved.join(' · ')}.`
        + (failed.length ? `  ·  ${failed.join('  ·  ')}` : ' Earlier weeks are untouched.')
      : `Nothing saved. ${failed.join('  ·  ')}`, !saved.length);
  } catch (e) {
    bMsg('Snapshot failed: ' + (e.message || e), true);
  }
  btn.disabled = false;
  btn.textContent = 'Take snapshot';
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
// The suggested action for one Compare row: { a: short label, why: the sentence shown in the Why column }.
function bsrAction(row) {
  const { rank, prev, health } = row;
  if (!prev) return { a: 'Baseline', why: 'First snapshot for this parent — nothing to compare yet.' };
  if (!rank) return { a: 'No rank', why: 'Amazon returned no rank this week (often means no recent sales, or the listing is inactive).' };
  if (row.catChanged) return { a: 'Check category', why: 'The rank category changed between the two weeks, so the numbers are not comparable.' };

  const pct = (rank - prev) / prev;              // positive = rank got bigger = worse
  const info = health || {};                     // { qty, gaps, noImage } from the listings snapshot
  if (info.qty === 0) return { a: 'Restock first',
    why: 'Out of stock. Rank falls while unavailable and a deal or extra spend would push traffic at a listing that cannot convert.' };

  if (pct > 0.30) {
    if (info.noImage || info.gaps) return { a: 'Fix the listing',
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
let BSR_T = 0;                              // debounce timer for the search box
// The toolbar: search (a quarter second after typing stops), brand and movement filters, the week pickers, the mode buttons.
$('bFilter').addEventListener('input', () => {
  clearTimeout(BSR_T);
  BSR_T = setTimeout(renderBsr, 250);
});
$('bBrandView').addEventListener('change', renderBsr);
$('bMoveView').addEventListener('change', renderBsr);
$('bWeekA').addEventListener('change', async () => {
  await pickWeeks();
  renderBsr();
});
$('bWeekB').addEventListener('change', async () => {
  await pickWeeks();
  renderBsr();
});
$('bHistWeeks').addEventListener('change', () => renderBsr());
$('bModeCompare').onclick = () => setBsrMode('compare');
$('bModeHistory').onclick = () => setBsrMode('history');

// Switch between Compare and History: the mode buttons, the controls each mode uses, then redraw.
function setBsrMode(mode) {
  BSR_MODE = mode;
  $('bModeCompare').classList.toggle('on', mode === 'compare');
  $('bModeHistory').classList.toggle('on', mode === 'history');
  // The comparison controls and the reference-only week pickers only make sense in Compare mode; the
  // "how many weeks" picker only in History. Toggle them rather than leaving dead controls on screen.
  document.querySelectorAll('#paneBsr .cmpOnly').forEach(el => el.classList.toggle('hide', mode !== 'compare'));
  document.querySelectorAll('#paneBsr .histOnly').forEach(el => el.classList.toggle('hide', mode !== 'history'));
  renderBsr();
}

// Make sure both picked weeks are in memory for both brands.
async function pickWeeks() {
  const weekA = $('bWeekA').value;
  const weekB = $('bWeekB').value;
  for (const brand of ['SP', 'CPC']) {
    if (BSR_WEEKS[brand].includes(weekA)) await loadBsrWeek(brand, weekA);
    if (BSR_WEEKS[brand].includes(weekB)) await loadBsrWeek(brand, weekB);
  }
}

// Draw the Compare table: week A against week B per parent, with the change, the suggested action, the KPI card and the rules text.
function renderBsr() {
  if (BSR_MODE === 'history') return renderBsrHistory();
  $('bRules').closest('.card').classList.remove('hide');
  const pick = $('bBrandView').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]);
  const wA = $('bWeekA').value;
  const wB = $('bWeekB').value;

  if (!allWeeks().length) {
    $('bKpis').innerHTML = '<div class="kpi"><div class="kpiname">No snapshots yet</div>'
      + '<div class="muted" style="margin-top:6px">Hit “Take this week’s snapshot”. Run it every weekend — each week is stored separately and nothing is ever overwritten.</div></div>';
    $('bTable').innerHTML = '';
    $('bRules').innerHTML = '';
    return;
  }

  // --- stock and content facts per parent, for the action heuristic ---
  // Health facts feed the action heuristic, so it can tell "out of stock" from "losing visibility".
  const healthBy = {};
  brands.forEach(brand => (HEALTH[brand]?.rows || []).forEach(row => {
    const key = (row.parent || row.asin) + '|' + brand;
    const facts = healthBy[key] || (healthBy[key] = { qty: null, gaps: 0, noImage: 0 });
    if (row.qty != null) facts.qty = (facts.qty || 0) + row.qty;
    if (row.content && !row.content.images) facts.noImage++;
    if (row.aplus === false) facts.gaps++;
  }));

  // --- one row per parent present in either week ---
  let rows = [];
  brands.forEach(brandKey => {
    const now = BSR[brandKey][wA] || {};
    const before = BSR[brandKey][wB] || {};
    const keys = new Set([...Object.keys(now), ...Object.keys(before)]);
    keys.forEach(parentAsin => {
      const entryA = now[parentAsin];
      const entryB = before[parentAsin];
      const rank = entryA?.rank || 0;
      const prev = entryB?.rank || 0;
      const health = healthBy[parentAsin + '|' + brandKey] || {};
      const row = { parent: parentAsin, brand: brandKey, rank, prev, cat: entryA?.cat || entryB?.cat || '',
        // Sub-category rank is carried FOR REFERENCE ONLY — nothing below decides anything from it.
        sub: entryA?.sub || 0, subPrev: entryB?.sub || 0, subCat: entryA?.subCat || entryB?.subCat || '',
        children: entryA?.n || entryB?.n || 0, health,
        catChanged: !!(entryA?.cat && entryB?.cat && entryA.cat !== entryB.cat),
        title: parentName(brandKey, parentAsin, '') };
      row.subDelta = (row.sub && row.subPrev) ? row.sub - row.subPrev : null;
      // Lower rank = better, so an improvement is a NEGATIVE delta. `moved` keeps the sign explicit
      // rather than leaving "up" and "down" to mean whatever the reader assumes.
      row.delta = (rank && prev) ? rank - prev : null;
      row.pct = (rank && prev) ? Math.round(((rank - prev) / prev) * 100) : null;
      const act = bsrAction(row);
      row.action = act.a;
      row.why = act.why;
      rows.push(row);
    });
  });

  // --- the movement filter and the search box ---
  const view = $('bMoveView').value;
  if (view === 'worse') rows = rows.filter(row => row.delta > 0);
  else if (view === 'better') rows = rows.filter(row => row.delta < 0);
  else if (view === 'action') rows = rows.filter(row => !['Stable', 'Working — hold', 'Baseline'].includes(row.action));

  const search = $('bFilter').value.trim().toLowerCase();
  if (search) rows = rows.filter(row => (row.parent + ' ' + (row.title || '')).toLowerCase().includes(search));

  // --- the columns ---
  const multiBrand = new Set(rows.map(row => row.brand)).size > 1;
  const defs = [{ k: 'parent', t: 'Parent ASIN', frz: 1, mono: 1 }];
  if (multiBrand) defs.push({ k: 'brand', t: 'Brand', map: row => BRAND_NAME[row.brand] });
  defs.push({ k: 'title', t: 'Parent name', trunc: 30,
    cell: row => parentNameCell(row.brand, row.parent, row.title, 30) });
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

  // --- sort, then draw (the first H_PAGE rows; totals and Export use them all) ---
  const val = (row, def) => (def.map ? def.map(row) : row[def.k]);
  const sortDef = defs.find(def => def.k === BSR_SORT.k) || defs.find(def => def.k === 'delta');
  rows.sort((a, b) => {
    const x = val(a, sortDef);
    const y = val(b, sortDef);
    if (x == null) return 1;
    if (y == null) return -1;
    const cmp = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x || '').localeCompare(String(y || ''));
    return cmp * BSR_SORT.dir;
  });

  BSR_RENDER = { rows, defs, val };
  const shown = rows.slice(0, H_PAGE);
  const esc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const dash = '<span class="muted">—</span>';
  const arrow = def => def.k === BSR_SORT.k ? (BSR_SORT.dir < 0 ? ' ↓' : ' ↑') : '';

  const head = '<thead><tr>' + defs.map(def =>
    `<th data-k="${esc(def.k)}" class="${def.frz ? 'frz ' : ''}${def.num ? 'num' : ''}"${
      def.tip ? ` title="${esc(def.tip)}"` : ''}>${esc(def.t)}${arrow(def)}</th>`).join('') + '</tr></thead>';

  const body = shown.map(row => '<tr>' + defs.map(def => {
    const value = val(row, def);
    const cls = (def.frz ? 'frz ' : '') + (def.num ? 'num' : '');
    if (def.cell) return `<td class="${cls}">${def.cell(row)}</td>`;
    if (def.signed) {
      if (value == null) return `<td class="${cls}">${dash}</td>`;
      const txt = (value > 0 ? '+' : '') + Number(value).toLocaleString('en-US') + (def.pct ? '%' : '');
      // Reference columns stay grey. Only the number the action is based on gets to shout.
      if (def.muted) return `<td class="${cls}"><span class="muted">${txt}</span></td>`;
      // Colour follows MEANING, not sign: improvement (negative) is green.
      const good = value < 0;
      return `<td class="${cls}" style="font-weight:600;color:${good ? 'var(--accent-ink)' : (value > 0 ? 'var(--bad-ink)' : 'inherit')}">${txt}</td>`;
    }
    if (def.num) return `<td class="${cls}">${value ? Number(value).toLocaleString('en-US') : dash}</td>`;
    if (def.trunc) return `<td class="${cls}" title="${esc(value)}">${esc(String(value || '').slice(0, def.trunc)) || dash}</td>`;
    return `<td class="${cls}" style="${def.mono ? 'font-family:ui-monospace,monospace' : ''}">${esc(value) || dash}</td>`;
  }).join('') + '</tr>').join('');

  $('bTable').innerHTML = head + '<tbody>' + (body ||
    `<tr><td colspan="${defs.length}" class="muted">No parents match.</td></tr>`)
    + '</tbody>' + (rows.length ? `<tfoot><tr><td class="frz">TOTAL · ${rows.length}</td>${
      defs.slice(1).map(() => '<td></td>').join('')}</tr></tfoot>` : '');

  // --- a heading click sorts by that column (again: the other way) ---
  $('bTable').querySelectorAll('thead th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k;
      BSR_SORT = { k, dir: BSR_SORT.k === k ? -BSR_SORT.dir : -1 };
      renderBsr();
    };
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

// The KPI card above the Compare table: how many got worse, improved, need action, and how many weeks are stored.
function renderBsrKpis(rows, wA, wB) {
  const nf = value => Number(value || 0).toLocaleString('en-US');
  const worse = rows.filter(row => row.delta > 0).length;
  const better = rows.filter(row => row.delta < 0).length;
  const act = rows.filter(row => !['Stable', 'Working — hold', 'Baseline'].includes(row.action)).length;
  // A week that was filed rather than captured in that week must say so wherever it is compared —
  // otherwise a backdated baseline silently reads as a genuine reading from that week.
  const mark = week => {
    const meta = ['SP', 'CPC'].map(brand => BSR_META[`${brand}__${week}`]).find(each => each && each.backdated);
    return meta ? ` <span class="muted">(captured ${meta.takenOn})</span>` : '';
  };
  $('bKpis').innerHTML = `<div class="kpi">
    <div class="kpihead"><span class="kpiname">${wA}${mark(wA)} vs ${wB}${mark(wB)}</span>
      <span class="kpiwhen">${nf(rows.length)} parents compared</span></div>
    <div class="metrics">
      <div class="metric"><div class="v" style="color:var(--bad-ink)">${nf(worse)}</div><div class="l">Rank got worse</div></div>
      <div class="metric"><div class="v" style="color:var(--accent-ink)">${nf(better)}</div><div class="l">Improved</div></div>
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
// Draw the History table: one column per stored week in the window, one row per parent, each cell coloured against the week before.
async function renderBsrHistory() {
  $('bRules').closest('.card').classList.add('hide');   // the action rules belong to Compare mode
  const pick = $('bBrandView').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]);

  if (!allWeeks().length) {
    $('bKpis').innerHTML = '<div class="kpi"><div class="kpiname">No snapshots yet</div>'
      + '<div class="muted" style="margin-top:6px">Take a snapshot each weekend — the history builds up here, one column per week.</div></div>';
    $('bTable').innerHTML = '';
    return;
  }

  // --- the window: the last N stored weeks, loaded on demand ---
  const want = Math.max(2, +$('bHistWeeks').value || 6);
  const weeks = allWeeks().slice(-want);                 // oldest → newest

  // Pull every week this window needs that isn't already in memory.
  $('bMsg').textContent = 'Loading history…';
  for (const brand of brands) {
    for (const week of weeks) {
      if (BSR_WEEKS[brand].includes(week)) await loadBsrWeek(brand, week);
    }
  }
  $('bMsg').textContent = '';

  // --- one row per parent: its rank in each week of the window ---
  const multiBrand = brands.length > 1;
  const byKey = {};
  brands.forEach(brandKey => weeks.forEach(week => {
    Object.entries(BSR[brandKey][week] || {}).forEach(([parentAsin, entry]) => {
      const key = parentAsin + '|' + brandKey;
      const item = byKey[key] || (byKey[key] = { parent: parentAsin, brand: brandKey, title: parentName(brandKey, parentAsin, ''),
        cat: '', ranks: {} });
      if (entry.rank > 0) {
        item.ranks[week] = entry.rank;
        item.cat = entry.cat || item.cat;
      }
    });
  }));
  let rows = Object.values(byKey);

  const search = $('bFilter').value.trim().toLowerCase();
  if (search) rows = rows.filter(row => (row.parent + ' ' + (row.title || '')).toLowerCase().includes(search));

  // First→last change across the shown window (only where both ends exist), and the latest rank for
  // sorting. Lower rank is better, so improvement is negative.
  const latest = weeks[weeks.length - 1];
  const earliest = weeks[0];
  rows.forEach(row => {
    row.latest = row.ranks[latest] || null;
    const latestRank = row.ranks[latest];
    const earliestRank = row.ranks[earliest];
    row.trend = (latestRank && earliestRank) ? latestRank - earliestRank : null;
  });
  rows.sort((x, y) => (x.latest == null ? 1 : y.latest == null ? -1 : x.latest - y.latest));

  // --- the columns: parent, (brand), name, one per week, the change over the window ---
  const defs = [{ k: 'parent', t: 'Parent ASIN', frz: 1, mono: 1 }];
  if (multiBrand) defs.push({ k: 'brand', t: 'Brand', map: row => BRAND_NAME[row.brand] });
  defs.push({ k: 'title', t: 'Parent name', trunc: 26, cell: row => parentNameCell(row.brand, row.parent, row.title, 26) });
  weeks.forEach(wk => defs.push({ k: 'w_' + wk, t: wk, num: 1, week: wk,
    tip: `Main-category rank in ${wk}. Lower is better.` }));
  defs.push({ k: 'trend', t: `Δ ${weeks.length}w`, num: 1, signed: 1,
    tip: `Change from ${earliest} to ${latest}. Negative = improved.` });

  // --- draw ---
  const esc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const dash = '<span class="muted">—</span>';
  const val = (row, def) => def.week ? (row.ranks[def.week] || null) : (def.map ? def.map(row) : row[def.k]);
  BSR_RENDER = { rows, defs, val };                     // Export uses this too
  const shown = rows.slice(0, H_PAGE);

  const head = '<thead><tr>' + defs.map(def =>
    `<th class="${def.frz ? 'frz ' : ''}${def.num ? 'num' : ''}"${def.tip ? ` title="${esc(def.tip)}"` : ''}>${esc(def.t)}</th>`).join('') + '</tr></thead>';

  const body = shown.map(row => '<tr>' + defs.map((def, ci) => {
    const cls = (def.frz ? 'frz ' : '') + (def.num ? 'num' : '');
    if (def.cell) return `<td class="${cls}">${def.cell(row)}</td>`;
    if (def.week) {
      const rank = row.ranks[def.week];
      if (!rank) return `<td class="${cls}">${dash}</td>`;
      // Colour vs the previous SHOWN week for this parent. Missing weeks are skipped, not treated as
      // a jump — a week you didn't snapshot is unknown, not a rank of zero.
      let prev = null;
      for (let j = weeks.indexOf(def.week) - 1; j >= 0; j--) {
        if (row.ranks[weeks[j]]) {
          prev = row.ranks[weeks[j]];
          break;
        }
      }
      const col = prev == null ? 'inherit' : (rank < prev ? 'var(--accent-ink)' : rank > prev ? 'var(--bad-ink)' : 'inherit');
      return `<td class="${cls}" style="color:${col}">${rank.toLocaleString('en-US')}</td>`;
    }
    if (def.signed) {
      const value = val(row, def);
      if (value == null) return `<td class="${cls}">${dash}</td>`;
      const good = value < 0;
      return `<td class="${cls}" style="font-weight:600;color:${good ? 'var(--accent-ink)' : value > 0 ? 'var(--bad-ink)' : 'inherit'}">${(value > 0 ? '+' : '') + value.toLocaleString('en-US')}</td>`;
    }
    const value = val(row, def);
    return `<td class="${cls}" style="${def.mono ? 'font-family:ui-monospace,monospace' : ''}">${esc(value) || dash}</td>`;
  }).join('') + '</tr>').join('');

  $('bTable').innerHTML = head + '<tbody>' + (body ||
    `<tr><td colspan="${defs.length}" class="muted">No parents match.</td></tr>`)
    + '</tbody>' + (rows.length ? `<tfoot><tr><td class="frz">TOTAL · ${rows.length}</td>${
      defs.slice(1).map(() => '<td></td>').join('')}</tr></tfoot>` : '');

  // --- the KPI card ---
  const improved = rows.filter(row => row.trend < 0).length;
  const worsened = rows.filter(row => row.trend > 0).length;
  $('bKpis').innerHTML = `<div class="kpi">
    <div class="kpihead"><span class="kpiname">History · ${weeks.length} weeks (${earliest} → ${latest})</span>
      <span class="kpiwhen">${rows.length.toLocaleString('en-US')} parents</span></div>
    <div class="metrics">
      <div class="metric"><div class="v" style="color:var(--accent-ink)">${improved.toLocaleString('en-US')}</div><div class="l">Improved over window</div></div>
      <div class="metric"><div class="v" style="color:var(--bad-ink)">${worsened.toLocaleString('en-US')}</div><div class="l">Worse over window</div></div>
      <div class="metric"><div class="v" style="font-size:15px">${allWeeks().length}</div><div class="l">Weeks stored</div></div>
      <div class="metric"><div class="v" style="font-size:15px">${weeks.length}</div><div class="l">Weeks shown</div></div>
    </div></div>`;
}

// Export: the table as shown (Compare or History) to CSV, with the same columns and cell values.
$('bCsv').onclick = () => {
  if (!BSR_RENDER.rows.length) return;
  const { rows, defs, val } = BSR_RENDER;
  const cell = value => {
    const str = String(value == null ? '' : value);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const lines = [defs.map(col => cell(col.t)).join(',')];
  rows.forEach(row => lines.push(defs.map(col => cell(val(row, col))).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `bsr-audit-${$('bWeekA').value}-vs-${$('bWeekB').value}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};

