/* ================= LISTING · BSR AUDIT: weekly best-seller-rank snapshots per parent, compared week on week =================
 * Screens: BSR Audit (tab 'bsr'): Compare 2 weeks (number cards as filters, one row per parent, a side panel per parent with its
 *          children, a chart and the facts) and Full history (many weeks as columns); Export writes what is on screen to CSV.
 * Does: "Take snapshot" reads every child's rank from the backend (baCall lh=bsr) and files the best child per parent under the ISO
 *       week (append-only, one Firestore doc per brand per week) — now with every child's rank, the price and the stock of that week.
 *       A daily snapshot is taken in the background by one browser of a BSR user (bsrDaily); a week with 3+ daily snapshots is judged
 *       on their average. Compare decides on the SUB-CATEGORY rank, filters noise, ranks by money at stake, and explains each action
 *       from real facts (units, price, deals, ad spend, Buy Box share, stock, status, our own changes) — never from a guess.
 * Main functions: isoWeek, loadBsrCache, loadBsrWeek, ensureBsr, bsrCollect / bsrBest (the snapshot), bsrUsed, bsrMove, bsrDecide,
 *                 bsrAtRisk, bsrPriority, bsrCatTrend (the decision), bsrFacts (the facts), bsrDaily / bsrWeekEntries (daily + average),
 *                 bsrActsRemember / bsrFollow (action follow-up), renderBsr, renderBsrKpis, bsrPanelOpen / bsrPanelDraw / bsrChartSvg,
 *                 renderBsrHistory, the bCsv handler. */
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
let BSR = { SP: {}, CPC: {} };             // brand → { week → { parent: {rank, cat, sub, subCat, n, k, p, q} } }
let BSR_WEEKS = { SP: [], CPC: [] };       // brand → the weeks stored, oldest first
let BSR_META = {};                         // "brand__week" → { takenOn, backdated }
let BSR_LOADED = false;
let BSR_SORT = { k: 'risk', dir: -1 };     // Compare table sort: 'risk' (money at stake, the default) or a column key; -1 = biggest first
let BSR_RENDER = { rows: [], defs: [], val: () => '', all: [] };   // what the table shows now — Export and the side panel read it

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
// First visit to the tab: parent names, the listings snapshot, the stored weeks, the remembered actions, then draw; the other screens'
// data (units, deals, ad spend, status, our changes) is read in the background and the table is drawn again when it lands.
async function ensureBsr() {
  await loadParentNames();
  if (!H_LOADED) await loadHealthCache();
  if (!BSR_LOADED) {
    bMsg('Loading history…');
    await loadBsrCache();
    bMsg('');
  }
  fillWeekPickers();
  await Promise.all([bsrActsLoad(), pickWeeks()]);
  renderBsr();
  bsrLoadSources();
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
/* ONE COLLECTION, two uses: "Take snapshot" (weekly, filed under the ISO week) and the daily background snapshot (filed under the day).
 * For each brand: every child's rank (baCall lh=bsr, 20 ASINs a call), the best child per parent (main rank, its category, its
 * sub rank and sub-category — as before), and now also, per parent, what the decision needs later and was never kept:
 *   k: { childAsin: [mainRank, subRank] } — every child, for the child view ("which child is falling");
 *   p: the average price of the children with a known price, q: stock summed over the children with a known quantity (null = not known).
 * Older snapshots have none of these: their values show "not known". */
async function bsrCollect(brand, say) {
  const rows = (HEALTH[brand] && HEALTH[brand].rows) || [];
  if (!rows.length) return { err: `${BRAND_NAME[brand]}: no listings loaded — run Listing health first` };
  // --- rank every child, 20 ASINs a call, H_SWEEP_PAR calls at a time ---
  const asins = [...new Set(rows.map(row => row.asin).filter(Boolean))].slice(0, BSR_SNAP_MAX);
  const got = {};
  let firstErr = '';
  for (let i = 0; i < asins.length; i += 20 * H_SWEEP_PAR) {
    const grp = [];
    for (let j = i; j < Math.min(i + 20 * H_SWEEP_PAR, asins.length); j += 20) grp.push(asins.slice(j, j + 20));
    if (say) say(`${BRAND_NAME[brand]}: reading BSR… ${Math.min(i + 20 * H_SWEEP_PAR, asins.length)} / ${asins.length}`);
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
  return { byParent: bsrBest(rows, got), firstErr };
}
/** The best child per parent from the children's ranks (`got`: asin → { rank, cat, sub, subCat }), with every child's ranks, the
 *  average price and the stock. The family is represented by its BEST-PLACED CHILD BY MAIN RANK, and that child's sub rank travels
 *  with it — taking the best main from one child and the best sub from another would describe a listing that does not exist. */
function bsrBest(rows, got) {
  const byParent = {};
  const money = {};
  rows.forEach(row => {
    const key = row.parent || row.asin;
    const m = money[key] || (money[key] = { p: 0, pn: 0, q: 0, qn: 0 });
    if (row.price > 0) { m.p += row.price; m.pn++; }
    if (row.qty != null) { m.q += row.qty; m.qn++; }
    const child = got[row.asin];
    if (!child || !(child.rank > 0)) return;         // no MAIN rank returned is NOT rank zero
    const best = byParent[key] || (byParent[key] = { rank: child.rank, cat: child.cat, sub: child.sub || 0, subCat: child.subCat || '', n: 0, k: {} });
    best.n++;
    best.k[row.asin] = [child.rank, child.sub || 0];
    if (child.rank < best.rank) {
      best.rank = child.rank;
      best.cat = child.cat;
      best.sub = child.sub || 0;
      best.subCat = child.subCat || '';
    }
  });
  Object.entries(byParent).forEach(([key, best]) => {
    const m = money[key];
    best.p = m && m.pn ? Math.round(m.p / m.pn * 100) / 100 : null;
    best.q = m && m.qn ? m.q : null;
  });
  return byParent;
}

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
      const res = await bsrCollect(brand, bMsg);
      if (res.err) {
        failed.push(res.err);
        continue;
      }
      const byParent = res.byParent;
      if (!Object.keys(byParent).length) {
        failed.push(`${BRAND_NAME[brand]}: no ranks came back — nothing saved`
          + (res.firstErr ? ` (${res.firstErr})` : ''));
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

/* ================= THE DECISION (pure functions — tests/bsr-test.js runs them on their own) =================
 * NEVER GUESS: a fact that is not known is `null`, shows "not known", and decides nothing.
 * 1. The rank used: the SUB-CATEGORY rank (e.g. #1,020 in Bath Towels); the main category is a grey reference. A parent with no
 *    sub-category rank in either week falls back to the main rank, and the row says so.
 * 2. Noise: main rank above 300,000 or sub rank above 20,000 = a low seller — rank moves are noise: action "Watch", never
 *    "Deal / price check"; its % is greyed. A move counts only with BOTH ≥ 10% AND a real distance (50 places in a sub-category,
 *    500 in a main category).
 * 3. Priority = money at stake: units last week × price × how much worse (the % moved, capped at 100%).
 * 4. Why: the facts that exist for the two weeks, strongest first; the action comes from the strongest.
 * 5. Category trend: ≥ 70% of our parents in one sub-category (at least 3) moved the same way → "Whole category moved (seasonal)",
 *    priority one step lower. */
const BSR_NOISE_MAIN = 300000;
const BSR_NOISE_SUB = 20000;
const BSR_MIN_PCT = 0.10;
const BSR_MIN_DIST = { sub: 50, main: 500 };
const BSR_CAT_SHARE = 0.70;
const BSR_CAT_MIN = 3;
const BSR_PRIO = { high: 100, medium: 25 };      // weekly revenue at risk, in the listing's currency: High ≥ 100, Medium ≥ 25
const BSR_CALM = ['Stable', 'Working — hold', 'Baseline', 'Watch', 'No rank'];

/** The rank a row is judged on, for one week's entry: { v, kind: 'sub' | 'main', cat }. */
function bsrUsed(entryA, entryB) {
  const subBoth = !!(entryA && entryA.sub > 0 && entryB && entryB.sub > 0);
  const subAny = !!((entryA && entryA.sub > 0) || (entryB && entryB.sub > 0));
  // Sub when both weeks have one (or only one week exists and it has one); else the main rank.
  const kind = subBoth || (subAny && !(entryA && entryB)) ? 'sub' : 'main';
  const pick = entry => (entry ? (kind === 'sub' ? entry.sub || 0 : entry.rank || 0) : 0);
  return { kind, a: pick(entryA), b: pick(entryB), cat: kind === 'sub' ? ((entryA && entryA.subCat) || (entryB && entryB.subCat) || '') : ((entryA && entryA.cat) || (entryB && entryB.cat) || '') };
}
/** Low seller: rank moves are noise. */
const bsrNoise = (main, sub) => (main > BSR_NOISE_MAIN) || (sub > BSR_NOISE_SUB);
/** The move from week B (before) to week A (now) on the rank used: 'worse' | 'better' | 'stable' | null (not comparable). */
function bsrMove(a, b, kind) {
  if (!(a > 0) || !(b > 0)) return null;
  const pct = (a - b) / b;
  const dist = Math.abs(a - b);
  if (Math.abs(pct) >= BSR_MIN_PCT && dist >= BSR_MIN_DIST[kind || 'sub']) return pct > 0 ? 'worse' : 'better';
  return 'stable';
}
const bsrPctTxt = p => Math.round(Math.abs(p) * 100) + '%';
const bsrMoney = v => (v == null ? 'not known' : '$' + Math.round(v).toLocaleString('en-US'));

/* THE FACTS of one parent for weeks B → A. Each is null when not known (and then never used):
 *   units {a, b} · price {a, b} · deal {ended: [names], started: [names]} · ads {a, b} (spend) · qty (stock now or in week A) ·
 *   status {sup, nobuy} · buybox {lost} · reviews {a, b} · changes [{ at, who, what, sku }] (our changes sent in those weeks) ·
 *   gaps (content gaps, from Listing Health's rules). */
/** The facts as sentences (with numbers) and the action they point to, strongest first: [{ k, txt, act }]. */
function bsrFactList(f, worse) {
  const out = [];
  const pct = (a, b) => (b ? (a - b) / b : null);
  if (f.qty === 0) out.push({ k: 'oos', txt: 'Out of stock now', act: 'Restock first' });
  else if (f.qty != null && f.qty > 0 && f.qty < 10) out.push({ k: 'low', txt: `Low stock: ${f.qty} left`, act: '' });
  if (f.status && f.status.sup) out.push({ k: 'sup', txt: `Suppressed from search: ${f.status.sup} of ${f.status.n} children (Amazon)`, act: 'Fix the listing' });
  else if (f.status && f.status.nobuy) out.push({ k: 'nobuy', txt: 'Not buyable on Amazon (no child can be bought)', act: 'Fix the listing' });
  if (f.buybox && f.buybox.lost) out.push({ k: 'bb', txt: `Buy Box lost: share of page views ${f.buybox.b}% → ${f.buybox.a}%`, act: 'Deal / price check' });
  if (f.deal && f.deal.ended && f.deal.ended.length) out.push({ k: 'dealend', txt: `Deal ended: ${f.deal.ended.join(', ')}`, act: 'Deal / price check' });
  if (f.price && f.price.a > 0 && f.price.b > 0 && Math.abs(pct(f.price.a, f.price.b)) >= 0.03) {
    const p = pct(f.price.a, f.price.b);
    out.push({ k: p > 0 ? 'priceup' : 'pricedown', txt: `Price ${p > 0 ? 'up' : 'down'} ${bsrPctTxt(p)} ($${f.price.b.toFixed(2)} → $${f.price.a.toFixed(2)})`, act: p > 0 ? 'Deal / price check' : '' });
  }
  if (f.ads && f.ads.b > 0 && f.ads.a != null) {
    const p = pct(f.ads.a, f.ads.b);
    if (p <= -0.20) out.push({ k: 'adsdown', txt: `Ad spend fell ${bsrPctTxt(p)} ($${Math.round(f.ads.b)} → $${Math.round(f.ads.a)})`, act: 'Review PPC' });
    else if (p >= 0.20) out.push({ k: 'adsup', txt: `Ad spend up ${bsrPctTxt(p)} ($${Math.round(f.ads.b)} → $${Math.round(f.ads.a)})`, act: '' });
  }
  if (f.changes && f.changes.length) {
    const c = f.changes[0];
    const more = f.changes.length > 1 ? ` (+${f.changes.length - 1} more)` : '';
    out.push({ k: 'ours', txt: `Our change: ${c.what} ${bsrDay(c.at)}${c.who ? ' by ' + c.who : ''}${more}`, act: worse ? 'Check our change' : '' });
  }
  if (f.gaps) out.push({ k: 'gaps', txt: `Content gaps on ${f.gaps} child${f.gaps === 1 ? '' : 'ren'} (no main picture or no A+)`, act: 'Fix the listing' });
  if (f.deal && f.deal.started && f.deal.started.length) out.push({ k: 'dealstart', txt: `Deal started: ${f.deal.started.join(', ')}`, act: '' });
  if (f.units && f.units.a != null && f.units.b != null) {
    const p = pct(f.units.a, f.units.b);
    out.push({ k: 'units', txt: `Units sold ${f.units.b} → ${f.units.a}${p == null ? '' : ` (${p > 0 ? '+' : p < 0 ? '−' : ''}${bsrPctTxt(p)})`}`, act: '' });
  }
  if (f.reviews && f.reviews.a != null && f.reviews.b != null && f.reviews.a !== f.reviews.b) out.push({ k: 'rev', txt: `Rating ${f.reviews.b} → ${f.reviews.a}`, act: '' });
  return out;
}
const bsrDay = at => (at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

/** The decision for one parent row: { action, short, why, facts, noise, kind }. `row`: { a, b, kind, main, sub, catChanged, facts }. */
function bsrDecide(row) {
  const f = row.facts || {};
  if (!row.b) return { action: 'Baseline', short: 'First snapshot — nothing to compare yet', facts: [] };
  if (!row.a) return { action: 'No rank', short: 'Amazon returned no rank this week (often no recent sales, or inactive)', facts: [] };
  if (row.catChanged) return { action: 'Check category', short: 'The category changed between the two weeks — the numbers are not comparable', facts: [] };
  const move = bsrMove(row.a, row.b, row.kind);
  const pct = (row.a - row.b) / row.b;
  const noise = bsrNoise(row.main, row.sub);
  const worse = move === 'worse';
  const facts = bsrFactList(f, worse);
  // The strongest fact that names an action.
  const lead = worse ? facts.find(x => x.act) : null;
  let action;
  let short;
  if (move === 'better') {
    action = 'Working — hold';
    short = `Improved ${bsrPctTxt(pct)} — whatever is running is working`;
  } else if (move === 'stable') {
    action = 'Stable';
    short = `Within ${Math.round(BSR_MIN_PCT * 100)}% or under ${BSR_MIN_DIST[row.kind]} places — no action`;
  } else if (lead) {
    action = lead.act;
    short = lead.txt;
  } else {
    // Nothing known explains it: only a gradual 10–30% slide points at visibility.
    action = pct <= 0.30 ? 'Review PPC' : 'Watch';
    short = pct <= 0.30 ? `Gradual slide of ${bsrPctTxt(pct)} — nothing known explains it; slow erosion is more often visibility` : `Worse by ${bsrPctTxt(pct)} — nothing known explains it`;
  }
  // A low seller's moves are noise: never "Deal / price check" (stock and a broken listing still matter).
  if (noise && worse && !['Restock first', 'Fix the listing'].includes(action)) {
    action = 'Watch';
    short = 'Low seller — rank moves are noise';
  }
  return { action, short, facts, noise, move, pct };
}

/** Money at stake per week: units last week × price × how much worse (0–1). null when units or price are not known. */
function bsrAtRisk(row) {
  const f = row.facts || {};
  if (row.move !== 'worse') return 0;
  const units = f.units ? f.units.a : null;
  const price = f.price ? (f.price.a || f.price.b) : null;
  if (units == null || !(price > 0)) return null;
  return units * price * Math.min(1, Math.max(0, row.pct));
}
/** Priority: High / Medium / Low from the money at stake; unknown money → by the % on the rank used (and it says so). */
function bsrPriority(row) {
  if (row.move !== 'worse' || BSR_CALM.includes(row.action) && row.action !== 'Watch') return { p: 'Low', by: 'calm' };
  let p;
  let by;
  if (row.noise) { p = 'Low'; by = 'noise'; }
  else if (row.risk != null) { p = row.risk >= BSR_PRIO.high ? 'High' : row.risk >= BSR_PRIO.medium ? 'Medium' : 'Low'; by = 'money'; }
  else { p = row.pct >= 0.30 ? 'High' : row.pct >= 0.15 ? 'Medium' : 'Low'; by = 'pct'; }
  if (row.catMoved && p !== 'Low') { p = p === 'High' ? 'Medium' : 'Low'; by += '+cat'; }
  return { p, by };
}
/** Category trend: mark rows whose sub-category moved together (≥ 70% of at least 3 of our parents, the same way). */
function bsrCatTrend(rows) {
  const by = new Map();
  rows.forEach(row => {
    if (row.kind !== 'sub' || !row.cat || !row.move) return;
    const list = by.get(row.cat) || [];
    list.push(row);
    by.set(row.cat, list);
  });
  by.forEach(list => {
    if (list.length < BSR_CAT_MIN) return;
    ['worse', 'better'].forEach(way => {
      const same = list.filter(row => row.move === way);
      if (same.length / list.length >= BSR_CAT_SHARE) same.forEach(row => { row.catMoved = way; });
    });
  });
  return rows;
}
/** Sort: money at stake first (biggest), then rows with unknown money by the % on the rank used, then low sellers (noise), then the rest. */
function bsrSortRisk(a, b) {
  const g = row => (row.move !== 'worse' ? 3 : row.noise ? 2 : row.risk != null ? 0 : 1);
  if (g(a) !== g(b)) return g(a) - g(b);
  // Known money: the priority first (a whole category that moved is one step lower), then the money.
  const pn = row => ({ High: 3, Medium: 2, Low: 1 }[row.prio && row.prio.p] || 0);
  if (g(a) === 0 && pn(a) !== pn(b)) return pn(b) - pn(a);
  if (g(a) === 0 || (g(a) === 2 && a.risk != null && b.risk != null)) return b.risk - a.risk;
  return (b.pct || 0) - (a.pct || 0);
}

/* ================= THE FACTS — from the other screens' data, read only =================
 * Sources (each loaded in the background when BSR Audit opens; one that cannot be read is simply "not known"):
 *   units, average price (sales ÷ units), ad spend, Buy Box share of page views — WEEKLY (Advertising, ads/ppc-organic.js loadWeekly),
 *     per child ASIN per SALES week (Sunday start). An ISO week Mon–Sun is matched with the sales week starting the Sunday before
 *     its Monday: 6 of its 7 days.
 *   deals — the Deal Calendar's typed deals (D_HDA, child ASIN + start / end) and planned deals (D_PLAN, parent + week; loadDeals).
 *     What Amazon actually ran is not available anywhere — these are the deals entered in Sellora.
 *   stock and suppressed / not buyable — NOW only (Listing Health's rows, the Image Manager snapshot via amzEnsure): used only when
 *     week A is the latest snapshot. Snapshots from now on keep the stock (q) and the price (p) of their own week.
 *   our changes — Listing History (lhLoad): what was sent for the parent's children between week B's Monday and week A's Sunday.
 *   content gaps — Listing Health's own rules (no main picture, no A+), now only, like stock.
 *   Buy Box owner, ratings and reviews — not available anywhere: always "not known". */
const BSR_SRC = { weekly: '', deals: '', amz: '', lh: '' };     // '' not read yet · 'ok' · 'no' (could not be read)
const BSR_DAY = 86400000;
/** The Monday (UTC) of an ISO week like 2026-W45. */
function bsrMonday(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(week || ''));
  if (!m) return null;
  const jan4 = new Date(Date.UTC(+m[1], 0, 4));
  const day = jan4.getUTCDay() || 7;
  return new Date(jan4.getTime() - (day - 1) * BSR_DAY + (+m[2] - 1) * 7 * BSR_DAY);
}
const bsrIso = d => d.toISOString().slice(0, 10);
/** The sales week (Sunday start, WEEKLY's key) matched with an ISO week. */
const bsrSalesWeek = week => (bsrMonday(week) ? bsrIso(new Date(bsrMonday(week).getTime() - BSR_DAY)) : '');
/** Whole weeks from ISO week `from` to `to` (to − from). */
const bsrWeeksApart = (from, to) => (bsrMonday(from) && bsrMonday(to) ? Math.round((bsrMonday(to) - bsrMonday(from)) / (7 * BSR_DAY)) : null);

// Read the other screens' data once, in the background; each source says whether it could be read.
let BSR_SRC_BUSY = null;
function bsrLoadSources() {
  if (BSR_SRC_BUSY) return BSR_SRC_BUSY;
  const one = async (k, fn) => {
    try {
      await fn();
      BSR_SRC[k] = 'ok';
    } catch (e) { BSR_SRC[k] = 'no'; }
  };
  BSR_SRC_BUSY = Promise.all([
    one('weekly', async () => {
      if (typeof loadWeekly !== 'function') throw new Error('no WEEKLY');
      if (!(typeof WEEKLY !== 'undefined' && WEEKLY.rows && Object.keys(WEEKLY.rows).length)) await loadWeekly();
      if (!(WEEKLY.rows && Object.keys(WEEKLY.rows).length)) throw new Error('empty');
    }),
    one('deals', async () => {
      if (typeof loadDeals !== 'function') throw new Error('no deals');
      await loadDeals();
    }),
    one('amz', async () => {
      if (typeof amzEnsure !== 'function') throw new Error('no amz');
      await amzEnsure();
      if (!AMZ.map) throw new Error('empty');
    }),
    one('lh', async () => {
      if (typeof lhLoad !== 'function') throw new Error('no history');
      await lhLoad(false);
      if (LH.err) throw new Error(LH.err);
    }),
  ]).then(() => { if ($('paneBsr') && !$('paneBsr').classList.contains('hide') && BSR_MODE === 'compare') renderBsr(); });
  return BSR_SRC_BUSY;
}

/** Sum one WEEKLY field over a parent's children for one sales week: a number, or null when no child has that week. */
function bsrWeeklySum(asins, wk, field) {
  if (BSR_SRC.weekly !== 'ok' || !wk) return null;
  let sum = 0;
  let seen = false;
  asins.forEach(asin => {
    const cell = WEEKLY.rows[asin] && WEEKLY.rows[asin].weeks && WEEKLY.rows[asin].weeks[wk];
    if (cell && cell[field] != null) { sum += Number(cell[field]) || 0; seen = true; }
  });
  return seen ? sum : null;
}
/** Every fact of one parent for weeks B → A (null = not known). `ctx`: { entryA, entryB, latest (week A is the newest snapshot), gaps }. */
function bsrFacts(brand, parent, wA, wB, ctx) {
  const c = ctx || {};
  const kids = ((HEALTH[brand] && HEALTH[brand].rows) || []).filter(row => (row.parent || row.asin) === parent);
  const asins = [...new Set(kids.map(row => row.asin).filter(Boolean))];
  const skus = new Set(kids.map(row => row.sku).filter(Boolean));
  const sA = bsrSalesWeek(wA);
  const sB = bsrSalesWeek(wB);
  const f = { units: null, price: null, ads: null, buybox: null, deal: null, qty: null, status: null, changes: null, gaps: null, reviews: null,
    salesWeeks: { a: sA, b: sB } };
  // --- units, average price, ad spend, Buy Box (WEEKLY) ---
  const uA = bsrWeeklySum(asins, sA, 'u');
  const uB = bsrWeeklySum(asins, sB, 'u');
  if (uA != null && uB != null) f.units = { a: uA, b: uB };
  const rA = bsrWeeklySum(asins, sA, 'rev');
  const rB = bsrWeeklySum(asins, sB, 'rev');
  const asp = (rev, u) => (rev != null && u > 0 ? Math.round(rev / u * 100) / 100 : null);
  const pA = asp(rA, uA) != null ? asp(rA, uA) : (c.entryA && c.entryA.p > 0 ? c.entryA.p : null);
  const pB = asp(rB, uB) != null ? asp(rB, uB) : (c.entryB && c.entryB.p > 0 ? c.entryB.p : null);
  if (pA != null || pB != null) f.price = { a: pA, b: pB };
  const adA = bsrWeeklySum(asins, sA, 'spend');
  const adB = bsrWeeklySum(asins, sB, 'spend');
  if (adA != null && adB != null) f.ads = { a: adA, b: adB };
  const bbA = bsrWeeklySum(asins, sA, 'bbv');
  const bbB = bsrWeeklySum(asins, sB, 'bbv');
  const pvA = bsrWeeklySum(asins, sA, 'pv');
  const pvB = bsrWeeklySum(asins, sB, 'pv');
  if (bbA != null && bbB != null && pvA > 0 && pvB > 0) {
    const a = Math.round(bbA / pvA * 100);
    const b = Math.round(bbB / pvB * 100);
    f.buybox = { a, b, lost: b - a >= 15 };
  }
  // --- deals: covered week B but not week A = ended; the other way = started ---
  const monA = bsrMonday(wA);
  const monB = bsrMonday(wB);
  if (BSR_SRC.deals === 'ok' && monA && monB) {
    const span = mon => [bsrIso(mon), bsrIso(new Date(mon.getTime() + 6 * BSR_DAY))];
    const [a0, a1] = span(monA);
    const [b0, b1] = span(monB);
    const covers = (s, e, w0, w1) => s <= w1 && e >= w0;
    const ended = [];
    const started = [];
    const add = (s, e, name) => {
      const inA = covers(s, e, a0, a1);
      const inB = covers(s, e, b0, b1);
      if (inB && !inA) ended.push(`${name} (to ${e})`);
      if (inA && !inB) started.push(`${name} (from ${s})`);
    };
    (typeof D_HDA !== 'undefined' ? D_HDA : []).forEach(h => {
      if (h && h.s && h.e && (asins.includes(h.asin) || h.parent === parent)) add(h.s, h.e, `${h.t || 'Deal'} ${h.v ? h.v + '%' : ''}`.trim());
    });
    Object.entries(typeof D_PLAN !== 'undefined' ? D_PLAN : {}).forEach(([key, p]) => {
      const [par, week] = key.split('|');
      if (par !== parent || !p || !p.t) return;
      const sp = typeof dPlanSpan === 'function' ? dPlanSpan(week, p) : { start: week, end: bsrIso(new Date(new Date(week + 'T00:00:00Z').getTime() + 6 * BSR_DAY)) };
      add(sp.start, sp.end, `${p.t} ${p.v ? p.v + '%' : ''} (planned)`.trim());
    });
    f.deal = { ended: [...new Set(ended)], started: [...new Set(started)] };
  }
  // --- stock: the snapshot's own (q), else NOW when week A is the latest snapshot ---
  if (c.entryA && c.entryA.q != null) f.qty = c.entryA.q;
  else if (c.latest) {
    const known = kids.filter(row => row.qty != null);
    if (known.length) f.qty = known.reduce((sum, row) => sum + row.qty, 0);
  }
  // --- suppressed / not buyable: NOW (Image Manager snapshot), only when week A is the latest ---
  if (c.latest && BSR_SRC.amz === 'ok') {
    const states = kids.map(row => AMZ.map.get(brand + '|' + row.sku)).filter(Boolean).map(x => String(x.st || '').toUpperCase());
    if (states.length) {
      const sup = states.filter(st => st.includes('BUYABLE') && !st.includes('DISCOVERABLE')).length;
      const buyable = states.filter(st => st.includes('BUYABLE')).length;
      // The family is "not buyable" only when none of its children can be bought; suppressed when any of them is.
      f.status = { sup: sup > 0 ? sup : 0, nobuy: buyable === 0, n: states.length };
    }
  }
  // --- our own changes sent in these weeks (Listing History), newest first ---
  if (BSR_SRC.lh === 'ok' && monA && monB) {
    const from = Math.min(monA.getTime(), monB.getTime());
    const to = Math.max(monA.getTime(), monB.getTime()) + 7 * BSR_DAY;
    f.changes = (LH.rows || []).filter(row => skus.has(row.sku) && row.at >= from && row.at < to && !['rejected', 'notsent'].includes(row.result))
      .map(row => ({ at: row.at, who: row.name || '', what: (typeof lhWhat === 'function' ? lhWhat(row) : row.field || 'a change').toLowerCase() + ' changed', sku: row.sku }));
  }
  // --- content gaps (Listing Health's rules), now: only when week A is the latest ---
  if (c.latest && c.gaps != null) f.gaps = c.gaps;
  return f;
}
/** The facts that are not known, by name (shown in the panel as "not known"). */
function bsrUnknown(f) {
  const names = [];
  if (!f) return names;
  if (!f.units) names.push('Units sold');
  if (!f.price || f.price.a == null || f.price.b == null) names.push('Price change');
  if (!f.deal) names.push('Deals / coupons');
  if (!f.ads) names.push('Ad spend');
  if (f.qty == null) names.push('Stock');
  if (!f.status) names.push('Suppressed / not buyable');
  if (!f.buybox) names.push('Buy Box');
  names.push('Rating / reviews');
  if (!f.changes) names.push('Our listing changes');
  return names;
}

/* ================= DAILY SNAPSHOT (until the server timer exists) =================
 * When someone with BSR access opens Sellora and today has no snapshot yet, ONE browser takes it in the background — the same
 * collection as "Take snapshot" (bsrCollect) — and files it under the day: bsrweeks/{brand}__D2026-11-14 (the BSR collection that
 * already holds the weekly snapshots; the Firestore rules let BSR users write any document there and delete none — no new place, no
 * rule change). The list of days and the one-browser lock live in bsrweeks/__days = { SP: [days], CPC: [days], lock: { day, by, at } }.
 * Weekly snapshots are not touched. A compared week with 3 or more daily snapshots is judged on their AVERAGE rank (bsrWeekEntries). */
const BSR_TAB = Math.random().toString(36).slice(2, 10);   // this browser tab, for the lock
let BSR_DAYS = null;                                       // { SP: [...], CPC: [...] } once read
const BSR_DAYDOC = {};                                     // 'SP__2026-11-14' → { parent: entry }
let BSR_DAILY_DONE = false;
const bsrToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function bsrDaysLoad() {
  if (BSR_DAYS) return BSR_DAYS;
  try {
    const snap = await getDoc(doc(db, 'bsrweeks', '__days'));
    const d = snap.exists() ? snap.data() : {};
    BSR_DAYS = { SP: (d.SP || []).slice().sort(), CPC: (d.CPC || []).slice().sort(), lock: d.lock || null };
  } catch (e) { BSR_DAYS = { SP: [], CPC: [], lock: null }; }
  return BSR_DAYS;
}
/** May this browser take today's daily snapshot? Today not done for some brand, and no other browser holds a fresh lock. */
function bsrDailyDue(days, today, now, me) {
  if (!days) return false;
  if (['SP', 'CPC'].every(brand => (days[brand] || []).includes(today))) return false;
  const lock = days.lock;
  if (lock && lock.day === today && lock.by !== me && now - (lock.at || 0) < 15 * 60000) return false;
  return true;
}
async function bsrDaily() {
  if (BSR_DAILY_DONE) return;
  BSR_DAILY_DONE = true;
  const today = bsrToday();
  const days = await bsrDaysLoad();
  if (!bsrDailyDue(days, today, Date.now(), BSR_TAB)) return;
  // --- the lock: claim, wait, read back (two browsers at once: one wins) ---
  try {
    await setDoc(doc(db, 'bsrweeks', '__days'), { lock: { day: today, by: BSR_TAB, at: Date.now() } }, { merge: true });
    await new Promise(r => setTimeout(r, 2500));
    const back = await getDoc(doc(db, 'bsrweeks', '__days'));
    if (!back.exists() || !back.data().lock || back.data().lock.by !== BSR_TAB) return;
  } catch (e) { return; }
  if (!H_LOADED) await loadHealthCache();
  for (const brand of ['SP', 'CPC']) {
    if ((BSR_DAYS[brand] || []).includes(today)) continue;
    try {
      const res = await bsrCollect(brand, null);
      if (res.err || !res.byParent || !Object.keys(res.byParent).length) continue;
      await setDoc(doc(db, 'bsrweeks', `${brand}__D${today}`), { r: res.byParent, at: serverTimestamp(), takenOn: today, daily: true });
      BSR_DAYDOC[`${brand}__${today}`] = res.byParent;
      BSR_DAYS[brand] = [...new Set([...(BSR_DAYS[brand] || []), today])].sort();
      await setDoc(doc(db, 'bsrweeks', '__days'), { [brand]: BSR_DAYS[brand] }, { merge: true });
    } catch (e) { /* tomorrow again; the manual snapshot still works */ }
  }
}
// Started once after sign-in, for BSR users only, when the backend address is known (never on the test site).
(function bsrDailyStart() {
  if (typeof window === 'undefined' || window.__TEST_ERP) return;
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    const me = typeof ME !== 'undefined' ? ME : null;
    const ready = me && me.email && (typeof API !== 'undefined' && API && API.url);
    if (ready && (me.admin || (me.tabs || []).includes('bsr'))) {
      clearInterval(t);
      bsrDaily();
    } else if (tries > 40) clearInterval(t);                  // 20 minutes without a BSR sign-in: stop asking
  }, 30000);
})();

/** The days (yyyy-mm-dd) of an ISO week that have a daily snapshot. */
function bsrDaysOf(brand, week) {
  const mon = bsrMonday(week);
  if (!mon || !BSR_DAYS) return [];
  const from = bsrIso(mon);
  const to = bsrIso(new Date(mon.getTime() + 6 * BSR_DAY));
  return (BSR_DAYS[brand] || []).filter(day => day >= from && day <= to);
}
async function bsrLoadDays(brand, week) {
  await bsrDaysLoad();
  const days = bsrDaysOf(brand, week);
  if (days.length < 3) return;
  await Promise.all(days.filter(day => !BSR_DAYDOC[`${brand}__${day}`]).map(async day => {
    try {
      const snap = await getDoc(doc(db, 'bsrweeks', `${brand}__D${day}`));
      BSR_DAYDOC[`${brand}__${day}`] = snap.exists() ? (snap.data().r || {}) : {};
    } catch (e) { BSR_DAYDOC[`${brand}__${day}`] = {}; }
  }));
}
/** The average of several days' entries for one parent: rank and sub averaged over the days that have them; the category, the
 *  children and price / stock from the newest day. `avg` = how many days. */
function bsrAvgEntry(list) {
  const got = list.filter(Boolean);
  if (!got.length) return null;
  const mean = key => {
    const vals = got.map(e => e[key]).filter(v => v > 0);
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
  };
  const last = got[got.length - 1];
  return Object.assign({}, last, { rank: mean('rank'), sub: mean('sub'), avg: got.length });
}
/** What a week is judged on: the 7-day average when 3 or more daily snapshots exist in that week, else the weekly snapshot. */
function bsrWeekEntries(brand, week) {
  const days = bsrDaysOf(brand, week).filter(day => BSR_DAYDOC[`${brand}__${day}`]);
  if (days.length >= 3) {
    const parents = new Set();
    days.forEach(day => Object.keys(BSR_DAYDOC[`${brand}__${day}`]).forEach(p => parents.add(p)));
    const out = {};
    parents.forEach(p => { out[p] = bsrAvgEntry(days.map(day => BSR_DAYDOC[`${brand}__${day}`][p])); });
    return { r: out, days: days.length };
  }
  return { r: BSR[brand][week] || {}, days: 0 };
}

/* ================= ACTION FOLLOW-UP =================
 * Each suggested action (not the calm ones) is remembered with its week and the rank it was suggested at, in bsrweeks/__acts =
 * { SP: { parent: [{ w, a, v, kind }] }, CPC: … } — the same BSR collection. Two or more weeks later the row says what happened:
 * "Last action: Deal / price check (W44) → rank recovered 35%" / "→ rank worse 20%" / "→ no change". */
let BSR_ACTS = null;
let BSR_ACTS_T = 0;
const BSR_ACTS_NEW = { SP: {}, CPC: {} };
async function bsrActsLoad() {
  if (BSR_ACTS) return BSR_ACTS;
  try {
    const snap = await getDoc(doc(db, 'bsrweeks', '__acts'));
    const d = snap.exists() ? snap.data() : {};
    BSR_ACTS = { SP: d.SP || {}, CPC: d.CPC || {} };
  } catch (e) { BSR_ACTS = { SP: {}, CPC: {} }; }
  return BSR_ACTS;
}
/** Remember this week's actions (week A = the newest snapshot only), once per parent per week; written a moment later, merged. */
function bsrActsRemember(rows, wA) {
  if (!BSR_ACTS) return;
  let changed = false;
  rows.forEach(row => {
    if (BSR_CALM.includes(row.action) || row.action === 'Check category' || !row.a) return;
    if (!BSR_WEEKS[row.brand] || BSR_WEEKS[row.brand][BSR_WEEKS[row.brand].length - 1] !== wA) return;
    const list = BSR_ACTS[row.brand][row.parent] || (BSR_ACTS[row.brand][row.parent] = []);
    if (list.some(x => x.w === wA)) return;
    list.push({ w: wA, a: row.action, v: row.a, kind: row.kind });
    BSR_ACTS_NEW[row.brand][row.parent] = list;
    changed = true;
  });
  if (!changed) return;
  clearTimeout(BSR_ACTS_T);
  BSR_ACTS_T = setTimeout(async () => {
    const out = {};
    ['SP', 'CPC'].forEach(brand => { if (Object.keys(BSR_ACTS_NEW[brand]).length) out[brand] = Object.assign({}, BSR_ACTS_NEW[brand]); });
    BSR_ACTS_NEW.SP = {};
    BSR_ACTS_NEW.CPC = {};
    try { await setDoc(doc(db, 'bsrweeks', '__acts'), out, { merge: true }); } catch (e) { /* kept for this visit */ }
  }, 1500);
}
/** The follow-up of a row: the newest action taken 2 or more weeks before week A, and what the rank did since. */
function bsrFollow(list, wA, a, kind) {
  const old = (list || []).filter(x => bsrWeeksApart(x.w, wA) >= 2 && x.kind === kind).sort((x, y) => (x.w < y.w ? 1 : -1))[0];
  if (!old || !(old.v > 0) || !(a > 0)) return null;
  const move = bsrMove(a, old.v, kind);
  const pct = Math.abs(a - old.v) / old.v;
  const res = move === 'better' ? `rank recovered ${bsrPctTxt(pct)}` : move === 'worse' ? `rank worse ${bsrPctTxt(pct)}` : 'no change';
  return { a: old.a, w: old.w.replace(/^\d{4}-/, ''), res };
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
  if (mode !== 'compare') bsrPanelClose();      // the side panel belongs to Compare
  $('bModeCompare').classList.toggle('on', mode === 'compare');
  $('bModeHistory').classList.toggle('on', mode === 'history');
  // The comparison controls and the reference-only week pickers only make sense in Compare mode; the
  // "how many weeks" picker only in History. Toggle them rather than leaving dead controls on screen.
  document.querySelectorAll('#paneBsr .cmpOnly').forEach(el => el.classList.toggle('hide', mode !== 'compare'));
  document.querySelectorAll('#paneBsr .histOnly').forEach(el => el.classList.toggle('hide', mode !== 'history'));
  renderBsr();
}

// A number card: that filter (again = all). A row: the side panel. The panel's buttons. Esc closes the panel.
$('bKpis').addEventListener('click', e => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-bs-card]') : null;
  if (!btn) return;
  BSR_CARD = BSR_CARD === btn.dataset.bsCard ? '' : btn.dataset.bsCard;
  renderBsr();
});
$('bTable').addEventListener('click', e => {
  const t = e.target;
  if (!t || !t.closest || t.closest('thead,[data-pname],a,button,input')) return;
  const tr = t.closest('tr.bs-row');
  if (!tr || BSR_MODE !== 'compare') return;
  const key = tr.dataset.bsKey;
  const cut = key.indexOf('|');
  bsrPanelOpen(key.slice(0, cut), key.slice(cut + 1));
});
$('bPanel').addEventListener('click', e => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-bs]') : null;
  if (!btn) return;
  if (btn.dataset.bs === 'close') bsrPanelClose();
  else bsrPanelLink(btn.dataset.bs);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && BSR_PANEL && $('paneBsr') && !$('paneBsr').classList.contains('hide')) bsrPanelClose();
});

// Make sure both picked weeks are in memory for both brands (and their daily snapshots, for the 7-day average).
async function pickWeeks() {
  const weekA = $('bWeekA').value;
  const weekB = $('bWeekB').value;
  for (const brand of ['SP', 'CPC']) {
    if (BSR_WEEKS[brand].includes(weekA)) await loadBsrWeek(brand, weekA);
    if (BSR_WEEKS[brand].includes(weekB)) await loadBsrWeek(brand, weekB);
    await bsrLoadDays(brand, weekA);
    await bsrLoadDays(brand, weekB);
  }
}

let BSR_CARD = '';            // the number card on as a filter: '' | worse | better | action | noise | cat | stable
const bsrActCls = a => (a === 'Restock first' || a === 'Fix the listing' || a === 'Deal / price check' ? 'is-bad' : a === 'Review PPC' || a === 'Check our change' || a === 'Check category' ? 'is-att'
  : a === 'Working — hold' ? 'is-ok' : '');
const BSR_CARDS = [
  { k: 'worse', t: 'Got worse', cls: 'is-bad', f: row => row.move === 'worse', tip: 'Worse by 10% or more AND a real distance (50 places in a sub-category, 500 in a main one)' },
  { k: 'better', t: 'Improved', cls: 'is-ok', f: row => row.move === 'better', tip: 'Better by 10% or more AND a real distance' },
  { k: 'action', t: 'Need action', cls: 'is-att', f: row => !BSR_CALM.includes(row.action), tip: 'A suggested action other than Stable, hold, Watch or Baseline' },
  { k: 'noise', t: 'Low seller (noise)', cls: 'is-off', f: row => !!row.decision.noise, tip: 'Main rank above 300,000 or sub rank above 20,000: rank moves are noise' },
  { k: 'cat', t: 'Category moved', cls: 'is-off', f: row => !!row.catMoved, tip: '70% or more of our parents in the same sub-category moved the same way (seasonal)' },
  { k: 'stable', t: 'Stable', cls: 'is-off', f: row => row.move === 'stable', tip: 'Under 10%, or under the minimum distance' },
];

// Draw the Compare table: week A against week B per parent — the rank used (sub-category), the change, priority, action, short reason.
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

  // --- content gaps per parent (Listing Health's own rules: the catalogue's main picture, A+), now ---
  const gapsBy = {};
  const hc = hCtx();
  brands.forEach(brand => (HEALTH[brand]?.rows || []).forEach(row => {
    const key = (row.parent || row.asin) + '|' + brand;
    const judged = Object.assign({ brand }, row);   // the snapshot rows carry no brand; the lookups key on it
    const pics = lrPictures(judged, hc);
    const aplus = lrAplus(judged, hc);
    if (!(key in gapsBy)) gapsBy[key] = 0;
    if ((pics && !pics.main) || (aplus.v === false && !aplus.stale)) gapsBy[key]++;
  }));

  // --- one row per parent present in either week ---
  let rows = [];
  const avgDays = {};
  brands.forEach(brandKey => {
    const A = bsrWeekEntries(brandKey, wA);
    const B = bsrWeekEntries(brandKey, wB);
    avgDays[brandKey] = { a: A.days, b: B.days };
    const latest = BSR_WEEKS[brandKey][BSR_WEEKS[brandKey].length - 1] === wA;
    const keys = new Set([...Object.keys(A.r), ...Object.keys(B.r)]);
    keys.forEach(parentAsin => {
      const entryA = A.r[parentAsin];
      const entryB = B.r[parentAsin];
      const used = bsrUsed(entryA, entryB);
      const row = { parent: parentAsin, brand: brandKey, entryA, entryB, kind: used.kind, a: used.a, b: used.b, cat: used.cat,
        main: entryA?.rank || 0, mainPrev: entryB?.rank || 0, mainCat: entryA?.cat || entryB?.cat || '',
        sub: entryA?.sub || 0, subPrev: entryB?.sub || 0, subCat: entryA?.subCat || entryB?.subCat || '',
        children: entryA?.n || entryB?.n || 0,
        catChanged: used.kind === 'sub'
          ? !!(entryA?.subCat && entryB?.subCat && entryA.subCat !== entryB.subCat)
          : !!(entryA?.cat && entryB?.cat && entryA.cat !== entryB.cat),
        title: parentName(brandKey, parentAsin, '') };
      row.facts = bsrFacts(brandKey, parentAsin, wA, wB, { entryA, entryB, latest, gaps: gapsBy[parentAsin + '|' + brandKey] });
      // Lower rank = better, so an improvement is a NEGATIVE change.
      row.delta = (row.a && row.b) ? row.a - row.b : null;
      row.pct = (row.a && row.b) ? (row.a - row.b) / row.b : null;
      row.pctShow = row.pct == null ? null : Math.round(row.pct * 100);
      row.decision = bsrDecide(row);
      row.move = row.decision.move || null;
      row.noise = !!row.decision.noise;
      row.action = row.decision.action;
      row.short = row.decision.short;
      rows.push(row);
    });
  });
  // --- the category trend, then the money at stake and the priority ---
  bsrCatTrend(rows);
  rows.forEach(row => {
    row.risk = bsrAtRisk(row);
    row.prio = bsrPriority(row);
    row.prioN = { High: 3, Medium: 2, Low: 1 }[row.prio.p];
    row.follow = BSR_ACTS ? bsrFollow((BSR_ACTS[row.brand] || {})[row.parent], wA, row.a, row.kind) : null;
    row.whyTxt = row.decision.facts.map(x => x.txt).join(' · ');
  });
  if (BSR_ACTS) bsrActsRemember(rows, wA);
  const all = rows.slice();

  // --- the number card filter, the movement picker, the search box ---
  const card = BSR_CARDS.find(c => c.k === BSR_CARD);
  if (card) rows = rows.filter(card.f);
  const view = $('bMoveView').value;
  if (view === 'worse') rows = rows.filter(row => row.move === 'worse');
  else if (view === 'better') rows = rows.filter(row => row.move === 'better');
  else if (view === 'action') rows = rows.filter(row => !BSR_CALM.includes(row.action));
  const search = $('bFilter').value.trim().toLowerCase();
  if (search) rows = rows.filter(row => (row.parent + ' ' + (row.title || '') + ' ' + (row.cat || '')).toLowerCase().includes(search));

  // --- the columns (`text` = what Export writes; `cell` = what the screen shows) ---
  const multiBrand = new Set(all.map(row => row.brand)).size > 1;
  const esc = bsrEsc;
  const dash = '<span class="muted">—</span>';
  const signed = (v, pct, grey) => (v == null ? dash : `<span style="font-weight:600;color:${grey ? 'var(--faint)' : v < 0 ? 'var(--accent-ink)' : v > 0 ? 'var(--bad-ink)' : 'inherit'}">${v > 0 ? '+' : ''}${Number(v).toLocaleString('en-US')}${pct ? '%' : ''}</span>`);
  const defs = [{ k: 'parent', t: 'Parent', frz: 1, text: row => row.parent, cell: row => `<span style="font-family:ui-monospace,monospace">${esc(row.parent)}</span>` }];
  if (multiBrand) defs.push({ k: 'brand', t: 'Brand', text: row => BRAND_NAME[row.brand] });
  defs.push({ k: 'title', t: 'Name', wrap: 1, text: row => row.title || '', cell: row => parentNameCell(row.brand, row.parent, row.title, 999) });
  defs.push({ k: 'cat', t: 'Sub cat.', wrap: 1, tip: 'The category of the rank used. A parent with no sub-category rank is judged on its main category (it says so).',
    text: row => (row.kind === 'sub' ? row.cat : `${row.cat} (main — no sub-category rank)`),
    cell: row => esc(row.cat || '—') + (row.kind === 'main' ? ' <span class="bs-tag" title="No sub-category rank: the main category rank is used">main</span>' : '') });
  defs.push({ k: 'b', t: `Rank ${wB} → ${wA}`, num: 1, tip: 'The rank used (sub-category; main when there is none). Lower is better.',
    text: row => `${row.b || ''} → ${row.a || ''}`, sortv: row => row.a || null,
    cell: row => `${row.b ? '#' + bsrNf(row.b) : dash} → <b>${row.a ? '#' + bsrNf(row.a) : dash}</b>` });
  defs.push({ k: 'delta', t: 'Change', num: 1, tip: 'Places moved on the rank used. NEGATIVE is an improvement.', text: row => row.delta, cell: row => signed(row.delta, false, row.decision.noise) });
  defs.push({ k: 'pctShow', t: '%', num: 1, tip: 'Change on the rank used. Greyed for a low seller (noise).', text: row => row.pctShow, cell: row => signed(row.pctShow, true, row.decision.noise) });
  defs.push({ k: 'main', t: 'Main rank', num: 1, tip: 'Main-category rank this week — reference only.', text: row => row.main || '',
    cell: row => `<span class="bs-grey" title="${esc(row.mainCat)}">${row.main ? '#' + bsrNf(row.main) : '—'}</span>` });
  defs.push({ k: 'prioN', t: 'Priority', tip: 'Money at stake a week: units last week × price × how much worse. Unknown sales: by the % (and it says so).',
    text: row => row.prio.p + (row.prio.by.startsWith('pct') ? ' (by %, sales not known)' : ''),
    cell: row => `<span class="bs-prio is-${row.prio.p}" title="${esc(row.risk == null ? 'Money at stake not known — ranked by the %' : row.risk ? 'About ' + bsrMoney(row.risk) + ' a week at stake' : '')}">${row.prio.p}</span>` });
  defs.push({ k: 'action', t: 'Suggested action', wrap: 1, text: row => row.action,
    cell: row => `<span class="bs-act ${bsrActCls(row.action)}">${esc(row.action)}</span><span class="bs-follow">${esc(row.short)}</span>`
      + `${row.catMoved ? '<span class="bs-tag">Whole category moved (seasonal)</span>' : ''}`
      + `${row.follow ? `<span class="bs-follow">Last action: ${esc(row.follow.a)} (${esc(row.follow.w)}) → ${esc(row.follow.res)}</span>` : ''}` });
  // Export only: the facts behind the action, the money at stake, the main category, the follow-up.
  const exportOnly = [{ k: 'why', t: 'Why (facts)', text: row => row.whyTxt || 'none known' }, { k: 'risk', t: 'Money at stake a week', text: row => (row.risk == null ? 'not known' : Math.round(row.risk)) },
    { k: 'mainCat', t: 'Main cat.', text: row => row.mainCat }, { k: 'follow', t: 'Last action', text: row => (row.follow ? `${row.follow.a} (${row.follow.w}) → ${row.follow.res}` : '') }];

  // --- sort: money at stake first (the default), or by a clicked heading ---
  const sortDef = defs.find(def => def.k === BSR_SORT.k);
  if (!sortDef) rows.sort(bsrSortRisk);
  else {
    const v = row => (sortDef.sortv ? sortDef.sortv(row) : row[sortDef.k]);
    rows.sort((a, b) => {
      const x = v(a);
      const y = v(b);
      if (x == null || x === '') return 1;
      if (y == null || y === '') return -1;
      const cmp = (typeof x === 'number' && typeof y === 'number') ? x - y : String(x).localeCompare(String(y));
      return cmp * BSR_SORT.dir;
    });
  }
  BSR_RENDER = { rows, defs: defs.concat(exportOnly), val: (row, def) => def.text(row), all };
  const shown = rows.slice(0, H_PAGE);
  const arrow = def => (def.k === BSR_SORT.k ? (BSR_SORT.dir < 0 ? ' ↓' : ' ↑') : '');
  const head = '<thead><tr>' + defs.map(def => `<th data-k="${esc(def.k)}" class="${def.frz ? 'frz ' : ''}${def.num ? 'num' : ''}"${def.tip ? ` title="${esc(def.tip)}"` : ''}>${esc(def.t)}${arrow(def)}</th>`).join('') + '</tr></thead>';
  const open = BSR_PANEL ? BSR_PANEL.brand + '|' + BSR_PANEL.parent : '';
  const body = shown.map(row => `<tr class="bs-row${open === row.brand + '|' + row.parent ? ' is-open' : ''}" data-bs-key="${esc(row.brand + '|' + row.parent)}" title="Open: the children, the chart and why">`
    + defs.map(def => `<td class="${def.frz ? 'frz ' : ''}${def.num ? 'num ' : ''}${def.wrap ? 'bs-wrap' : ''}">${def.cell ? def.cell(row) : esc(def.text(row)) || dash}</td>`).join('') + '</tr>').join('');
  $('bTable').innerHTML = head + '<tbody>' + (body || `<tr><td colspan="${defs.length}" class="muted">No parents match.</td></tr>`) + '</tbody>'
    + (rows.length ? `<tfoot><tr><td class="frz">TOTAL · ${rows.length}</td>${defs.slice(1).map(() => '<td></td>').join('')}</tr></tfoot>` : '');
  // --- a heading click sorts by that column (again: the other way); "Priority" first click = money at stake ---
  $('bTable').querySelectorAll('thead th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.k;
      BSR_SORT = k === 'prioN' && BSR_SORT.k !== 'prioN' ? { k: 'risk', dir: -1 } : { k, dir: BSR_SORT.k === k ? -BSR_SORT.dir : -1 };
      renderBsr();
    };
  });
  wireParentNameCells('bTable', renderBsr);
  renderBsrKpis(all, wA, wB, avgDays);
  if (BSR_PANEL) bsrPanelDraw();
  $('bRules').innerHTML = `
    <b>Decided on the SUB-CATEGORY rank</b> (e.g. #1,020 in Bath Towels) — the main category is shown in grey for reference. A parent with no
    sub-category rank is judged on its main rank, and the row says “main”. <b>Lower is better</b>: a negative change is an improvement.<br>
    <b>A move counts</b> only when it is 10% or more AND a real distance (50 places in a sub-category, 500 in a main one).
    <b>Low seller</b> (main rank above 300,000 or sub above 20,000): rank moves are noise — “Watch”, never “Deal / price check”.<br>
    <b>Priority</b> = money at stake a week: units sold last week × price × how much worse. Where sales are not known, by the % (it says so).
    A whole sub-category moving together (70% of at least 3 parents) is marked seasonal and one step lower.<br>
    <b>The action comes from the strongest fact</b> for the two weeks: out of stock → Restock first · suppressed / not buyable → Fix the listing ·
    deal ended / price up / Buy Box lost → Deal / price check · ad spend fell 20%+ → Review PPC · our own change in those weeks → Check our change ·
    content gaps → Fix the listing · nothing known → Review PPC for a gradual 10–30% slide, else Watch.<br>
    <b>Never a guess:</b> a fact that is not known says “not known” and decides nothing. Data used: ${bsrSrcLine()}.`;
}
/** Which sources could be read, in plain words. */
function bsrSrcLine() {
  const s = (k, name) => `${name} ${BSR_SRC[k] === 'ok' ? '✓' : BSR_SRC[k] === 'no' ? '— not known' : '…'}`;
  return [s('weekly', 'units, price, ad spend, Buy Box share (Advertising weekly data)'), s('deals', 'deals (Deal Calendar)'), s('amz', 'suppressed / buyable (Image Manager)'),
    s('lh', 'our changes (Listing History)'), 'ratings / reviews — not known'].join(' · ');
}
// The number cards above the Compare table: each a filter (again = all); the line under them names the weeks and what they rest on.
function renderBsrKpis(rows, wA, wB, avgDays) {
  const nf = value => Number(value || 0).toLocaleString('en-US');
  // A week that was filed rather than captured in that week must say so wherever it is compared —
  // otherwise a backdated baseline silently reads as a genuine reading from that week.
  const mark = week => {
    const meta = ['SP', 'CPC'].map(brand => BSR_META[`${brand}__${week}`]).find(each => each && each.backdated);
    return meta ? ` (captured ${meta.takenOn})` : '';
  };
  const avg = Object.values(avgDays || {}).reduce((m, d) => ({ a: Math.max(m.a, d.a), b: Math.max(m.b, d.b) }), { a: 0, b: 0 });
  const avgTxt = w => (avg[w] ? ` · ${avg[w]}-day average` : '');
  $('bKpis').innerHTML = `<div class="bs-boxes" role="group" aria-label="Filter the parents">${BSR_CARDS.map(c => {
    const n = rows.filter(c.f).length;
    return `<button type="button" class="bs-box ${c.cls}${BSR_CARD === c.k ? ' is-on' : ''}" data-bs-card="${c.k}" aria-pressed="${BSR_CARD === c.k}" title="${bsrEsc(c.tip)} — click to show only these; again to show all">`
      + `<span>${bsrEsc(c.t)}</span><b>${nf(n)}</b><small>${c.k === 'worse' ? nf(rows.filter(r => r.move === 'worse' && r.prio.p === 'High').length) + ' high priority' : ''}</small></button>`;
  }).join('')}</div>
    <div class="bs-meta"><span><b>${bsrEsc(wA)}</b>${bsrEsc(mark(wA))}${avgTxt('a')} vs <b>${bsrEsc(wB)}</b>${bsrEsc(mark(wB))}${avgTxt('b')}</span>
      <span>${nf(rows.length)} parents compared</span><span>${nf(allWeeks().length)} weeks stored</span>
      <span>Sales weeks used: ${bsrEsc(bsrSalesWeek(wB))} and ${bsrEsc(bsrSalesWeek(wA))} (Sunday start, 6 of the 7 days)</span></div>`;
}

/* ================= ONE PARENT: the side panel =================
 * A click on a row opens it on the right (the table stays where it was): the facts behind the action, every child's rank this
 * week and last (the falling child marked), the parent's rank over the last 8–12 stored weeks as a line (lower = better: the best
 * rank is at the TOP of the chart), and links to the Workspace, Image Manager, Listing Errors and Listing History. */
let BSR_PANEL = null;         // { brand, parent } while the panel is open
const bsrEsc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const bsrNf = v => Number(v || 0).toLocaleString('en-US');

/** A line chart of one parent's rank by week (SVG). points: [{ w, v }] oldest first; null v = no snapshot that week (a gap).
 *  Lower is better, so the axis runs from the best rank at the TOP to the worst at the bottom. */
function bsrChartSvg(points, label) {
  const known = points.filter(p => p.v > 0);
  if (known.length < 2) return `<p class="muted" style="font-size:12px;margin:4px 0">Not enough weeks stored for a line yet (${known.length} with a ${bsrEsc(label)}).</p>`;
  const W = 520, H = 190, L = 54, R = 10, T = 12, B = 34;
  const lo = Math.min(...known.map(p => p.v));
  const hi = Math.max(...known.map(p => p.v));
  const span = hi - lo || 1;
  const x = i => L + (points.length === 1 ? 0 : i * (W - L - R) / (points.length - 1));
  const y = v => T + (v - lo) / span * (H - T - B);                 // lo (the best rank) at the top
  let path = '';
  let open = false;
  points.forEach((p, i) => {
    if (!(p.v > 0)) { open = false; return; }
    path += (open ? ' L' : ' M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1);
    open = true;
  });
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  return `<svg class="bs-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${bsrEsc(label)} by week, lower is better">`
    + `<line class="ax" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/><line class="ax" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>`
    + ticks.map(v => `<text x="${L - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${bsrNf(v)}</text>`).join('')
    + `<text x="${L}" y="${H - 4}" text-anchor="start">${bsrEsc(points[0].w)}</text><text x="${W - R}" y="${H - 4}" text-anchor="end">${bsrEsc(points[points.length - 1].w)}</text>`
    + `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">↑ better (lower rank) · ↓ worse</text>`
    + `<path class="ln" d="${path.trim()}"/>`
    + points.map((p, i) => (p.v > 0 ? `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3"><title>${bsrEsc(p.w)}: #${bsrNf(p.v)}</title></circle>` : '')).join('')
    + '</svg>';
}
/** Every child's rank in week A and week B (rank used: sub, else main), the falling ones first. [{ asin, sku, name, a, b, fall }] */
function bsrKids(brand, parent, entryA, entryB, kind) {
  const rows = ((HEALTH[brand] && HEALTH[brand].rows) || []).filter(row => (row.parent || row.asin) === parent);
  const pick = (entry, asin) => {
    const k = entry && entry.k && entry.k[asin];
    return k ? (kind === 'sub' ? k[1] || 0 : k[0] || 0) : null;      // null = this week's snapshot kept no child ranks
  };
  const seen = new Set();
  const out = [];
  rows.forEach(row => {
    if (!row.asin || seen.has(row.asin)) return;
    seen.add(row.asin);
    const a = pick(entryA, row.asin);
    const b = pick(entryB, row.asin);
    out.push({ asin: row.asin, sku: row.sku, name: [row.color, row.size].filter(Boolean).join(' · ') || row.title || '', a, b,
      fall: a > 0 && b > 0 ? bsrMove(a, b, kind) === 'worse' : false, pct: a > 0 && b > 0 ? (a - b) / b : null });
  });
  return out.sort((x, z) => (z.fall - x.fall) || ((z.pct == null ? -9 : z.pct) - (x.pct == null ? -9 : x.pct)));
}
async function bsrPanelOpen(brand, parent) {
  BSR_PANEL = { brand, parent };
  // The panel starts under Sellora's menu bar (measured: it wraps on narrow screens, and is a drawer on phones).
  try {
    const side = document.querySelector('.side');
    const top = side && getComputedStyle(side).position === 'sticky' ? Math.round(side.getBoundingClientRect().height) : 0;
    $('paneBsr').style.setProperty('--bs-top', top + 'px');
  } catch (e) { /* no layout (a test page) */ }
  document.querySelectorAll('#bTable tr.is-open').forEach(tr => tr.classList.remove('is-open'));
  document.querySelectorAll(`#bTable tr[data-bs-key="${CSS.escape(brand + '|' + parent)}"]`).forEach(tr => tr.classList.add('is-open'));
  bsrPanelDraw();
  // The chart's weeks are loaded on demand (only the latest two are kept in memory), then the panel is drawn again.
  const weeks = BSR_WEEKS[brand].slice(-12);
  const need = weeks.filter(week => !BSR[brand][week]);
  if (need.length) {
    for (const week of need) await loadBsrWeek(brand, week);
    if (BSR_PANEL && BSR_PANEL.brand === brand && BSR_PANEL.parent === parent) bsrPanelDraw();
  }
}
function bsrPanelClose() {
  BSR_PANEL = null;
  const box = $('bPanel');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  document.querySelectorAll('#bTable tr.is-open').forEach(tr => tr.classList.remove('is-open'));
}
function bsrPanelDraw() {
  const box = $('bPanel');
  if (!box || !BSR_PANEL) return;
  const { brand, parent } = BSR_PANEL;
  const row = (BSR_RENDER.all || []).find(each => each.brand === brand && each.parent === parent);
  if (!row) return bsrPanelClose();
  const wA = $('bWeekA').value;
  const wB = $('bWeekB').value;
  const label = row.kind === 'sub' ? `sub-category rank${row.cat ? ' in ' + row.cat : ''}` : `main-category rank${row.cat ? ' in ' + row.cat : ''} (no sub-category rank)`;
  // --- the facts: what is known with numbers, then what is not known ---
  const known = row.decision.facts.map(fact => `<li>${bsrEsc(fact.txt)}${fact.act ? ` <span class="bs-tag">→ ${bsrEsc(fact.act)}</span>` : ''}</li>`).join('');
  const unknown = bsrUnknown(row.facts).map(name => `<li class="bs-nk">${bsrEsc(name)}: not known</li>`).join('');
  const kids = bsrKids(brand, parent, row.entryA, row.entryB, row.kind);
  const anyKid = kids.some(kid => kid.a != null || kid.b != null);
  const kidRows = kids.map(kid => `<tr class="${kid.fall ? 'is-fall' : ''}"><td><span class="im-mono" style="font-family:ui-monospace,monospace">${bsrEsc(kid.sku || kid.asin)}</span><br><span class="muted">${bsrEsc(kid.name)}</span></td>`
    + `<td class="num">${kid.b > 0 ? '#' + bsrNf(kid.b) : '<span class="muted">not known</span>'}</td><td class="num">${kid.a > 0 ? '#' + bsrNf(kid.a) : '<span class="muted">not known</span>'}</td>`
    + `<td class="num">${kid.pct == null ? '<span class="muted">—</span>' : `<b style="color:${kid.pct > 0 ? 'var(--bad-ink)' : kid.pct < 0 ? 'var(--accent-ink)' : 'inherit'}">${kid.pct > 0 ? '+' : ''}${Math.round(kid.pct * 100)}%</b>`}</td></tr>`).join('');
  const weeks = BSR_WEEKS[brand].slice(-12);
  const points = weeks.map(week => {
    const entry = (BSR[brand][week] || {})[parent];
    return { w: week, v: entry ? (row.kind === 'sub' ? entry.sub || 0 : entry.rank || 0) : null };
  });
  const follow = row.follow ? `<p style="font-size:12.5px;margin:6px 0 0">Last action: <b>${bsrEsc(row.follow.a)}</b> (${bsrEsc(row.follow.w)}) → ${bsrEsc(row.follow.res)}</p>` : '';
  box.innerHTML = `<div class="bs-ph"><div><b>${bsrEsc(row.title || parent)}</b><span>${bsrEsc(BRAND_NAME[brand])} · Parent <span style="font-family:ui-monospace,monospace">${bsrEsc(parent)}</span> · ${bsrEsc(label)}</span></div>`
    + `<button type="button" class="ghost" data-bs="close" style="width:auto;padding:4px 12px" title="Close (Esc)">✕ Close</button></div>`
    + `<div><span class="bs-act ${bsrActCls(row.action)}">${bsrEsc(row.action)}</span> <span class="bs-prio is-${row.prio.p}">${row.prio.p}</span>`
    + ` <span class="muted" style="font-size:12px">${row.risk == null ? 'money at stake: not known' : row.risk ? 'about ' + bsrMoney(row.risk) + ' a week at stake' : ''}</span>`
    + `${row.catMoved ? ' <span class="bs-tag">Whole category moved (seasonal)</span>' : ''}${row.decision.noise ? ' <span class="bs-tag">Low seller — rank moves are noise</span>' : ''}</div>`
    + `<p style="font-size:13px;margin:8px 0 0">${bsrEsc(row.decision.short)}</p>${follow}`
    + `<div class="bs-sec">Why — ${bsrEsc(wB)} → ${bsrEsc(wA)}</div><ul class="bs-facts">${known || '<li class="bs-nk">No fact known for these weeks.</li>'}${unknown}</ul>`
    + `<div class="bs-sec">Children — rank ${bsrEsc(wB)} → ${bsrEsc(wA)}</div>`
    + (anyKid ? `<table class="bs-kids"><thead><tr><th>Child</th><th class="num">${bsrEsc(wB)}</th><th class="num">${bsrEsc(wA)}</th><th class="num">Change</th></tr></thead><tbody>${kidRows}</tbody></table>`
      : '<p class="muted" style="font-size:12px;margin:4px 0">Not known: these weeks\' snapshots did not keep each child\'s rank (snapshots taken from now on do).</p>')
    + `<div class="bs-sec">${bsrEsc(label.charAt(0).toUpperCase() + label.slice(1))} — last ${points.length} weeks</div>${bsrChartSvg(points, label)}`
    + `<div class="bs-links"><button type="button" class="ghost im-b" data-bs="ws">Open in Workspace</button><button type="button" class="ghost im-b" data-bs="img">Image Manager</button>`
    + `<button type="button" class="ghost im-b" data-bs="lerr">Listing Errors</button><button type="button" class="ghost im-b" data-bs="lhist">Listing History</button></div>`;
  box.hidden = false;
}
// The child SKUs of a parent (for the links that open other screens on them).
const bsrSkus = (brand, parent) => [...new Set(((HEALTH[brand] && HEALTH[brand].rows) || []).filter(row => (row.parent || row.asin) === parent).map(row => row.sku).filter(Boolean))];
// The panel's links: the other screens' own entry points (read-only use of their functions).
function bsrPanelLink(what) {
  if (!BSR_PANEL) return;
  const { brand, parent } = BSR_PANEL;
  const skus = bsrSkus(brand, parent);
  const name = (typeof parentName === 'function' ? parentName(brand, parent, '') : '') || parent;
  if (what === 'img') {
    $('imBrand').value = brand;
    if (typeof imOnly === 'function') imOnly(skus, 'BSR Audit · ' + name);
    showTab('img');
    if (typeof imListRender === 'function') imListRender();
  } else if (what === 'lerr') {
    $('leBrand').value = brand;
    if (typeof leOnly === 'function') leOnly(skus, 'BSR Audit · ' + name);
    showTab('lerr');
    if (typeof leShow === 'function') leShow(false);
    if (typeof leListEnsure === 'function') leListEnsure();
  } else if (what === 'lhist') {
    const row = (BSR_RENDER.all || []).find(each => each.brand === brand && each.parent === parent);
    const change = row && row.facts && row.facts.changes && row.facts.changes[0];
    if (typeof LH !== 'undefined' && LH.f) {
      LH.f = Object.assign({}, LH.f, { range: 'all', q: change ? change.sku : (skus[0] || '') });
      LH.page = 0;
      LH.built = false;
    }
    showTab('lhist');
  } else if (what === 'ws') {
    showTab('health');
    if (typeof liWsOn === 'function' && typeof LI_WS !== 'undefined' && !LI_WS.on) liWsOn();
    // The Workspace draws its parents after it opens; then the parent's panel opens (else Listing Health's child table for it).
    setTimeout(() => {
      if (typeof liWsPanelOpen === 'function' && typeof LI_WS !== 'undefined' && LI_WS.byKey && LI_WS.byKey.has(brand + '|' + parent)) liWsPanelOpen(brand + '|' + parent);
      else if (typeof hFocusOpen === 'function') hFocusOpen(brand, parent);
    }, 400);
  }
  window.scrollTo(0, 0);
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
