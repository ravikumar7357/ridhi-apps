/* ================= PRODUCTION TRACKER (Master DB · Base Data · Cutting) =================
 *
 * The factory's own data — what a SKU is made of, what has been issued to which worker and how much
 * has come back, and what has been cut — read straight from the production tracker's database.
 *
 * ONE COPY, READ LIVE. Nothing is imported or mirrored into this project. The old tool keeps writing
 * to the same database and these screens read it as it stands, so the two can never disagree. That
 * is also why this is read-only for now: a second thing writing production records, carrying its own
 * half of the validation rules, is exactly how two versions of the truth get created.
 *
 * The URL is a single constant on purpose, and that is now the whole of the move: the data has been
 * copied into this project's own database (25 nodes, 27,834 records, read back and compared record
 * for record), the rules there are live, and every read and write here already carries the sign-in
 * those rules ask for. Changing this line moves the app.
 *
 * Moved on the day the old tool was switched off. The database it used is locked: its rules deny
 * everything, so nothing can be written there by accident and nobody can read it off the internet
 * without an account, which for eight years anybody could.
 */
const PT_URL = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';

/* MAY THIS ACCOUNT CHANGE AN ENTRY SOMEBODY HAS ALREADY MADE? Making one is open to everyone who can
 * reach the register; correcting one is granted per account (perms.prodEdit), because an edit moves
 * the order balance, the cutting cap, the weekly report and a worker's pay at once, and leaves no
 * trace of what the row said before. Deleting is stricter still and stays admin-only. */
const ptCanEdit = () => !!(ME.admin || ME.prodEdit);
const PT_NO_EDIT = 'Changing an entry needs permission. Ask an admin to switch on '
  + '"Can edit production entries" for your account — you can still add new entries.';

/**
 * Three things that moved stock or money with nothing in front of them: having the tab WAS the
 * permission. Each follows the shape already on the access page.
 */
/* Accepting what a printer sent creates fabric stock and settles what they are paid for it. */
const vlogCanAccept = () => !spIsVendor() && !!(ME.admin || ME.vlogAccept);
const VLOG_NO_ACCEPT = 'Accepting a delivery needs permission. Ask an admin to switch on '
  + '"Can accept printer deliveries" for your account.';
/* Approving a customer's order puts it on the floor; returning one takes it off again. */
const soCanApprove = () => !spIsVendor() && !!(ME.admin || ME.soApprove);
const SO_NO_APPROVE = 'Approving a sales order needs permission. Ask an admin to switch on '
  + '"Can approve sales orders" for your account.';
/* Adding a SKU is how the catalogue grows; Change SKU rewrites a code across every record. */
const mdbCanEdit = () => !spIsVendor() && !!(ME.admin || ME.mdbEdit);
const MDB_NO_EDIT = 'Changing the master database needs permission. Ask an admin to switch on '
  + '"Can edit the master database" for your account.';

let PT = {
  mdb: null, base: null, cut: null,          // null = never loaded; [] = loaded and empty
  err: { mdb: '', base: '', cut: '' },
  at:  { mdb: '', base: '', cut: '' },
  busy: { mdb: false, base: false, cut: false },
};

/**
 * A database path, spelled for the REST API.
 *
 * PER SEGMENT. Running encodeURIComponent over the whole path turns every "/" into %2F, which stops
 * being a separator and becomes part of a key name — so "pt_vendorByEmail/someone@x,com" asked for
 * one root-level key with a slash in its name. Against a database with no rules that answered null
 * and the caller fell back to a wider read; against one with rules it is a read at the root, and the
 * root is exactly what a vendor may not read. Hence a printer being refused their own orders.
 *
 * Callers pass the plain path. Anything already encoded is left alone rather than encoded twice,
 * because %40 encoded again is %2540 and that is a different key.
 */
const ptPath = node => String(node == null ? '' : node).split('/')
  .filter(s => s !== '')
  .map(s => encodeURIComponent(/%[0-9A-Fa-f]{2}/.test(s) ? decodeURIComponent(s) : s))
  .join('/');

/* ==== LIVE COPIES OF THE REGISTERS ====
 * (2026-09-27, Ravi: "storage ka problem sahi kro".) What was running out was not storage — the data is 11 MB of the
 * free 1 GB — but DOWNLOAD: the free plan allows 10 GB a month and September had used 19.4 GB by the 27th. Every read
 * fetched a whole register again; the eight a factory screen opens together are 7 MB, fetched again on every reopen.
 *
 * Now the first read of a register opens a live copy (the database's own listener). It downloads the register once;
 * after that only what somebody changes in it arrives. A screen opened again reads the copy — nothing is downloaded,
 * and it is never older than the last change, so it is also fresher than the 10-minute rule it sits under.
 *
 * THE PLAIN READ (what every read was before) is used whenever the copy cannot be trusted:
 *  - a vendor account, which may read only its own branch, or a path below a register;
 *  - the live connection is down, did not come up in 5 seconds, or was refused;
 *  - this page wrote to that register and the change has not come back on the connection yet (up to 5 s) —
 *    otherwise a screen redrawn right after "Saved" could be missing the row just saved.
 * Each read gets a fresh object, so a screen that changes what it read cannot change the copy. */
const PT_LIVE = new Map();
const PT_LIVE_UP_MS = 5000, PT_LIVE_WAIT_MS = 45000, PT_LIVE_SETTLE_MS = 5000;
const PT_LIVE_NO = { none: true };
let PT_LIVE_DB = null, PT_LIVE_UP = false, PT_LIVE_UID = '', PT_LIVE_SEQ = 0, PT_LIVE_UPW = [];
function ptLiveDb() {
  if (!PT_LIVE_DB) PT_LIVE_DB = import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js').then(m => {
    const db = m.getDatabase(app, PT_URL);
    m.onValue(m.ref(db, '.info/connected'), s => {
      PT_LIVE_UP = !!s.val();
      if (PT_LIVE_UP) { PT_LIVE_UPW.forEach(f => f(true)); PT_LIVE_UPW = []; }
    });
    return { m, db };
  });
  return PT_LIVE_DB;
}
/* A network that blocks the live connection must not hold a screen for long: 5 s to connect, else the plain read. */
const ptLiveUpWait = ms => PT_LIVE_UP ? Promise.resolve(true)
  : new Promise(r => { PT_LIVE_UPW.push(r); setTimeout(() => r(false), ms); });
const ptLiveable = node => typeof app !== 'undefined' && !!app && /^pt_[A-Za-z0-9_]+$/.test(String(node || ''))
  && typeof auth !== 'undefined' && !!(auth && auth.currentUser && auth.currentUser.uid) && !spIsVendor();
function ptLiveOpen(node) {
  const L = { snap: null, dead: false, wroteAt: 0, wroteSeq: 0, evSeq: 0, off: null };
  L.first = ptLiveDb().then(({ m, db }) => new Promise(res => {
    L.off = m.onValue(m.ref(db, node), sn => { L.snap = sn; L.evSeq = ++PT_LIVE_SEQ; res(true); },
      () => { L.dead = true; L.snap = null; res(false); });
  })).catch(() => { L.dead = true; return false; });
  return L;
}
async function ptLiveRead(node) {
  /* Another account signed in on this page: the copies were read as the last one. */
  const uid = auth.currentUser.uid;
  if (uid !== PT_LIVE_UID) {
    PT_LIVE.forEach(L => { try { if (L.off) L.off(); } catch (e) { /* already closed */ } });
    PT_LIVE.clear(); PT_LIVE_UID = uid;
  }
  let L = PT_LIVE.get(node);
  if (!L) { L = ptLiveOpen(node); PT_LIVE.set(node, L); }
  if (L.dead) return PT_LIVE_NO;
  if (!L.snap) {
    await ptLiveDb();
    if (!await ptLiveUpWait(PT_LIVE_UP_MS)) return PT_LIVE_NO;
    const ok = await Promise.race([L.first, new Promise(r => setTimeout(() => r(false), PT_LIVE_WAIT_MS))]);
    if (!ok || !L.snap) return PT_LIVE_NO;
  } else if (!PT_LIVE_UP) return PT_LIVE_NO;
  /* In ORDER, not by the clock: a change that comes back in the same millisecond as the write still counts. */
  if (L.wroteSeq && L.evSeq < L.wroteSeq && Date.now() - L.wroteAt < PT_LIVE_SETTLE_MS) return PT_LIVE_NO;
  return L.snap.val();
}
/** This page is writing to these paths: their registers are read plainly until the change comes back. */
function ptLiveWrote(paths) {
  if (!PT_LIVE.size) return;
  const t = Date.now();
  (paths || []).forEach(p => { const L = PT_LIVE.get(String(p || '').split('/').filter(Boolean)[0]); if (L) { L.wroteAt = t; L.wroteSeq = ++PT_LIVE_SEQ; } });
}
/* ==== END LIVE COPIES ==== */

/* A failed read and an empty node look identical if the error is swallowed, and only one of them is
 * something anyone can act on. So: a real timeout, one retry, and the reason kept and shown. */
async function ptGet(node) {
  if (ptLiveable(node)) {
    try { const v = await ptLiveRead(node); if (v !== PT_LIVE_NO) return v; } catch (e) { /* the plain read below */ }
  }
  /* The token goes on the READ as well as the write. Where the data sits now, nothing is readable
   * without one — the rules are "signed in, and not a vendor", and a vendor is refused at the root
   * and granted only their own branch. */
  const url = `${PT_URL}/${ptPath(node)}.json` + await ptAuthQuery();
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (r.status === 401 || r.status === 403)
        throw new Error('The production database refused the read (permission denied). Sign out and '
          + 'sign in again; if it keeps happening, this account is not allowed to read production data.');
      if (!r.ok) throw new Error(`The production database answered ${r.status} ${r.statusText || ''}`.trim());
      return await r.json();
    } catch (e) {
      clearTimeout(t);
      lastErr = (e && e.name === 'AbortError')
        ? new Error('The production database did not answer within 45 seconds.')
        : e;
      if (attempt === 0) continue;
    }
  }
  throw lastErr || new Error('Could not read the production database.');
}

/** RTDB hands back an object keyed by record id (or an array). Either way we want a plain list. */
function ptList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(v => v != null);
  return Object.keys(raw).map(k => {
    const v = raw[k];
    return (v && typeof v === 'object' && !Array.isArray(v)) ? Object.assign({ _key: k }, v) : { _key: k, value: v };
  });
}

/* Dates arrive as "26/08/2026, 15:20" — day first. Date.parse reads that as MONTH first wherever it
 * parses it at all, which silently reorders the register and quietly breaks every date filter.
 * Parsed by hand. */
function ptDtMs(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
  const d = new Date(String(s));
  return isNaN(d) ? 0 : d.getTime();
}
const ptDate = s => { const ms = ptDtMs(s); return ms ? new Date(ms) : null; };
/**
 * Is this record's date inside the two boxes? Either box may be empty, and an empty one is no limit.
 *
 * A row whose date cannot be read is OUT once a limit is set and IN when none is — the same rule the
 * six screens that already have a range use. Dropping an undated row from an unfiltered list would
 * hide it for no reason; keeping it in a filtered one would answer a question about a date with a
 * row that has none.
 */
function ptInRange(when, d1, d2) {
  if (!d1 && !d2) return true;
  const d = ptDate(when);
  if (!d) return false;
  if (d1 && d < new Date(d1 + 'T00:00:00')) return false;
  if (d2 && d > new Date(d2 + 'T23:59:59')) return false;
  return true;
}
/** The two boxes of a screen, read together. Missing boxes read as empty, which is no limit. */
const ptRangeOf = (a, b) => [(($(a) || {}).value || ''), (($(b) || {}).value || '')];
const ptNum = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const ptCi = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();

/** Fill a <select> with the values still reachable, keeping the current pick if it survives. */
function ptFill(id, values, allLabel) {
  const sel = $(id); if (!sel) return;
  const cur = sel.value;
  const seen = new Set();
  values.forEach(v => { const s = String(v == null ? '' : v).trim(); if (s) seen.add(s); });
  sel.innerHTML = `<option value="">${esc(allLabel)}</option>`
    + [...seen].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  sel.value = cur;
  if (sel.value !== cur) sel.value = '';     // the old pick is no longer reachable
}

function ptDownload(name, lines) {
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${name}-${dToday()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

function ptStamp() { return new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }

/* Shared shape for all three: load once on first open, then only on Refresh. */
async function ptLoad(which, node, after) {
  if (PT.busy[which]) return;
  PT.busy[which] = true; PT.err[which] = '';
  after();
  try {
    PT[which] = ptList(await ptGet(node));
    PT.at[which] = ptStamp();
  } catch (e) {
    PT.err[which] = e.message || String(e);
    PT[which] = PT[which] || [];
  }
  PT.busy[which] = false;
  after();
}

function ptEmpty(tableId, msg) {
  $(tableId).innerHTML = `<tbody><tr><td class="muted" style="padding:14px;text-align:left">${msg}</td></tr></tbody>`;
}

/* ---------------- Master Database ---------------- */

async function ensurePmdb() {
  if (!PTG.mdb) {
    PT.busy.mdb = true; renderPmdb();
    await ptLoadGates();
    PT.busy.mdb = false; PT.err.mdb = PTG.err || ''; PT.at.mdb = ptStamp();
  }
  PT.mdb = PTG.mdb;      // one array, two names — the gates and this tab must never disagree
  renderPmdb();
  /* A recipe copy over a minute old is read again, quietly, and the table redrawn if it changed. */
  if (Date.now() - (PTG.recipeAt || 0) > 60000) {
    try {
      const rec = await ptGet('pt_masters/recipe');
      PTG.recipeAt = Date.now();
      if (rec && JSON.stringify(rec) !== JSON.stringify((PTG.masters || {}).recipe || null)) {
        PTG.masters = Object.assign({}, PTG.masters || {}, { recipe: rec }); RECIPE_IX = { src: null, map: null }; renderPmdb();
      }
    } catch (e) { /* the copy in hand stays */ }
  }
  // Pictures come after the table is on screen: they are a nicety, and the SKUs are what people came for.
  mdbImgFill(false);
}

function pmdbFilters() {
  const v = id => ($(id) || {}).value || '';
  return { brand: v('ptmBrand'), art: v('ptmArt'), sub: v('ptmSub'), col: v('ptmCol'),
    sz: v('ptmSz'), cut: v('ptmCut'), q: v('ptmQ').trim().toLowerCase() };
}

function pmdbApply(rows, f, skip) {
  skip = skip || '';
  return rows.filter(r => {
    if (skip !== 'brand' && f.brand && !ptCi(r.brand, f.brand)) return false;
    if (skip !== 'art' && f.art && !ptCi(r.articleType, f.art)) return false;
    if (skip !== 'sub' && f.sub && !ptCi(r.subtype, f.sub)) return false;
    if (skip !== 'col' && f.col && !ptCi(r.color, f.col)) return false;
    if (skip !== 'sz' && f.sz && !ptCi(r.size, f.sz)) return false;
    if (skip !== 'cut' && f.cut === 'y' && !r.cuttingRequired) return false;
    if (skip !== 'cut' && f.cut === 'n' && r.cuttingRequired) return false;
    if (skip !== 'q' && f.q) {
      const hay = [r.sku, r.articleType, r.subtype, r.color, r.size, r.fabric, r.brand, r.asin, r.parentAsin].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
}

const PMDB_MAX = 600;

/**
 * Every SKU on screen with the cloth its size implies: the cut, the roll it comes off, how many
 * across, what is wasted, and the metres one piece takes — beside whatever is stored today.
 */
function renderMdbCons() {
  const all = PT.mdb || [];
  if (!all.length) { $('ptmMsg').textContent = ''; $('ptmKpis').innerHTML = ''; return ptEmpty('ptmTable', 'The master database is empty.'); }
  const f = pmdbFilters();
  ptFill('ptmBrand', pmdbApply(all, f, 'brand').map(r => r.brand), 'All brands');
  ptFill('ptmArt', pmdbApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('ptmSub', pmdbApply(all, f, 'sub').map(r => r.subtype), 'All subtypes');
  ptFill('ptmCol', pmdbApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('ptmSz', pmdbApply(all, f, 'sz').map(r => r.size), 'All sizes');

  const rows = pmdbApply(all, f).map(r => Object.assign({ row: r, stored: parseFloat(r.consumption) || 0 }, { plan: ptConsPlan(r) }))
    .sort((a, b) => String(a.row.sku || '').localeCompare(String(b.row.sku || '')));
  PT._consRows = rows;

  const done = rows.filter(x => !x.plan.why);
  const blocked = rows.filter(x => x.plan.why);
  const changed = done.filter(x => Math.abs(x.plan.metres - x.stored) > 0.005);
  const blank = done.filter(x => !(x.stored > 0));
  const zeroWaste = done.filter(x => x.plan.waste < 0.005);
  const noPanels = done.filter(x => x.plan.panels === 1 && !ptPrintRuleOf(x.row));

  $('ptmKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Cloth per piece</span>
      <span class="kpiwhen">${PT_MARGIN_IN}" stitching margin, then the roll that wastes least across its width</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">SKUs shown</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(done.length)}</div><div class="l">Worked out</div></div>
      <div class="metric"><div class="v"${blocked.length ? ' style="color:var(--bad)"' : ''}>${nf(blocked.length)}</div><div class="l">Cannot be worked out</div></div>
      <div class="metric"><div class="v">${nf(blank.length)}</div><div class="l">No figure stored yet</div></div>
      <div class="metric"><div class="v">${nf(changed.length)}</div><div class="l">Would change</div></div>
      <div class="metric"><div class="v">${nf(zeroWaste.length)}</div><div class="l">At 0% waste</div></div>
    </div>
    <div class="muted" style="margin-top:8px;font-size:12px">A front and a back are two rectangles, not
      one. Where an article takes more than one panel, put the number on <b>Masters → Printing rule</b>
      — until it is there, the figure below is for a single rectangle${noPanels.length
        ? `, which is what ${nf(noPanels.length)} of these still are` : ''}.</div>
  </div>`;

  const head = '<thead><tr>' + ['SKU', 'Article', 'Size', 'Raw cut', 'Off which roll', 'Across', 'Waste',
    'Panels', 'Cloth a piece', 'Stored now', 'Change'].map((h, i) =>
    `<th${i === 0 ? ' class="frz"' : ([5, 6, 7, 8, 9, 10].indexOf(i) >= 0 ? ' class="num"' : '')}>${esc(h)}</th>`).join('') + '</tr></thead>';

  const m3 = v => (Math.round(v * 1000) / 1000).toFixed(3);
  $('ptmTable').innerHTML = head + '<tbody>' + (rows.length ? rows.slice(0, 600).map(x => {
    const r = x.row, p = x.plan;
    if (p.why) {
      return `<tr><td class="frz" style="text-align:left;font-family:ui-monospace,monospace">${esc(r.sku)}</td>`
        + `<td style="text-align:left">${esc(r.subtype || r.articleType || '—')}</td>`
        + `<td>${esc(r.size) || '<span class="muted">—</span>'}</td>`
        + `<td colspan="7" class="err" style="text-align:left">${esc(p.why)}</td>`
        + `<td class="num">${x.stored > 0 ? m3(x.stored) : '<span class="muted">—</span>'}</td></tr>`;
    }
    const d = p.metres - x.stored;
    const big = x.stored > 0 && Math.abs(d) > 0.25 * x.stored;
    return '<tr>'
      + `<td class="frz" style="text-align:left;font-family:ui-monospace,monospace">${esc(r.sku)}</td>`
      + `<td style="text-align:left">${esc(r.subtype || r.articleType || '—')}</td>`
      + `<td>${esc(r.size)}</td>`
      + `<td>${p.cut.w}" × ${p.cut.l}"${p.cut.round ? '<div class="muted" style="font-size:10.5px">from a round</div>' : ''}</td>`
      + `<td style="text-align:left"><b>${esc(p.fabric)}</b> <span class="muted">${p.widthIn}"</span>${
          p.fromRule ? '' : '<div class="muted" style="font-size:10.5px">chosen — nothing said</div>'}${
          p.fromRule && p.best.fabric !== p.fabric && p.best.waste < p.waste - 0.005
            ? `<div class="muted" style="font-size:10.5px">${esc(p.best.fabric)} would waste ${Math.round(p.best.waste * 100)}%</div>` : ''}${
          p.namedUnfit ? `<div class="err" style="font-size:10.5px">${esc(p.named)} is too narrow for this cut</div>` : ''}</td>`
      + `<td class="num">${p.across}${p.turned ? '<div class="muted" style="font-size:10.5px">turned</div>' : ''}${
          p.lay ? `<div class="muted" style="font-size:10.5px">${p.lay === 'width' ? 'width across' : 'length across'}</div>` : ''}</td>`
      + `<td class="num"${p.waste > 0.15 ? ' style="color:var(--bad)"' : (p.waste < 0.005 ? ' style="color:#166534"' : '')}>${Math.round(p.waste * 100)}%</td>`
      + `<td class="num">${p.panels > 1 ? '×' + p.panels : '<span class="muted">1</span>'}</td>`
      + `<td class="num"><b>${m3(p.metres)}</b> m</td>`
      + `<td class="num">${x.stored > 0 ? m3(x.stored) : '<span class="muted">none</span>'}</td>`
      + `<td class="num"${big ? ' style="color:var(--bad)"' : ''}>${x.stored > 0
          ? (d >= 0 ? '+' : '') + m3(d) : '<span class="muted">—</span>'}</td>`
      + '</tr>';
  }).join('') : `<tr><td colspan="11" class="muted" style="padding:16px">Nothing matches.</td></tr>`) + '</tbody>';

  $('ptmMsg').className = 'muted';
  $('ptmMsg').textContent = rows.length > 600
    ? `Showing the first 600 of ${nf(rows.length)}. Apply works on all ${nf(rows.length)}.` : '';
}

/** Write the worked-out figures onto the SKUs on screen — after saying what that would do. */
async function mdbConsApply() {
  if (!ptCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = PT_NO_EDIT; return; }
  const rows = (PT._consRows || []).filter(x => !x.plan.why);
  const change = rows.filter(x => Math.abs(x.plan.metres - x.stored) > 0.005);
  if (!change.length) { $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = 'Nothing to change — every SKU on screen already carries the worked-out figure.'; return; }
  const blank = change.filter(x => !(x.stored > 0)).length;
  const big = change.filter(x => x.stored > 0 && Math.abs(x.plan.metres - x.stored) > 0.25 * x.stored);

  ptOpenDialog({
    title: 'Write the worked-out cloth onto these SKUs?',
    subtitle: `${nf(change.length)} SKU(s) would change`,
    note: `${nf(blank)} have no figure at all today. ${nf(big.length)} would move by more than a quarter — `
      + (big.length ? big.slice(0, 5).map(x => `${x.row.sku} ${x.stored} → ${x.plan.metres}`).join(', ')
        + (big.length > 5 ? ` and ${nf(big.length - 5)} more` : '') : 'none')
      + '. Everything else on the master row is left exactly as it is.',
    fields: [],
    saveLabel: 'Write them',
    onSave: async () => {
      const upd = {};
      change.forEach(x => { if (x.row._key) upd['pt_masterDB/' + x.row._key + '/consumption'] = mdbM2(x.plan.metres); });
      const missing = change.filter(x => !x.row._key).length;
      if (!Object.keys(upd).length) return 'None of these rows has a key to write to.';
      try { await ptPatch(upd); } catch (e) { return 'Not written: ' + (e.message || e); }
      change.forEach(x => { if (x.row._key) x.row.consumption = mdbM2(x.plan.metres); });
      MDB_IX = { src: null, n: -1, map: null };
      renderPmdb();
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = `${nf(change.length - missing)} SKU(s) updated.`
        + (missing ? ` ${nf(missing)} had no key and were left alone.` : '');
      return '';
    },
  });
}

/**
 * WHAT EACH VIEW CAN DO, and therefore what it shows.
 *
 * Every control on this toolbar, named once per view. Anything missing from a view's list is hidden
 * on it — which is the whole point: the old code toggled a few ids at a time and left the rest
 * wherever the previous view had put them.
 *
 * The buttons that change data appear only for somebody who may change it; the rest are for reading
 * and are always there.
 */
const PMDB_TOOLS = {
  master: ['ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut', 'ptmQ',
    'ptmNew', 'ptmAsin', 'ptmImgs', 'ptmClear', 'ptmTemplate', 'ptmTplShort', 'ptmImport', 'ptmRename', 'ptmCustFix', 'ptmExport', 'ptmGo'],
  /* A one-off item never amends the real catalogue, so Change SKU — which rewrites a code across
   * every register — is not offered from here. */
  custom: ['ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut', 'ptmQ',
    'ptmNew', 'ptmLookalike', 'ptmImgs', 'ptmClear', 'ptmTemplate', 'ptmTplShort', 'ptmImport', 'ptmExport', 'ptmGo'],
  /* The printer's cloth is grouped by fabric and colour; article and size say nothing about it. */
  fabric: ['ptmBrandFs', 'ptmDir', 'ptmCol', 'ptmQ', 'ptmNew', 'ptmTemplate', 'ptmImport', 'ptmClear', 'ptmExport', 'ptmGo'],
  cons: ['ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut', 'ptmQ',
    'ptmConsApply', 'ptmClear', 'ptmExport', 'ptmGo'],
  /* A recipe has no brand, no colour and no picture. Its key is the three boxes that are left. */
  recipe: ['ptmArt', 'ptmSub', 'ptmSz', 'ptmQ', 'ptmRecSeed', 'ptmRecApply',
    'ptmClear', 'ptmTemplate', 'ptmImport', 'ptmExport', 'ptmGo'],
  /* The base codes are per article, subtype and size; the colour is picked on the screen itself. */
  skucode: ['ptmArt', 'ptmSub', 'ptmSz', 'ptmQ', 'ptmClear', 'ptmTemplate', 'ptmImport', 'ptmExport', 'ptmGo'],
};
/** The ones that write, so they are shown only to somebody who may. */
const PMDB_WRITES = ['ptmNew', 'ptmLookalike', 'ptmAsin', 'ptmImport', 'ptmRename', 'ptmCustFix', 'ptmConsApply', 'ptmRecSeed', 'ptmRecApply'];
/* NAMED OUTRIGHT, not gathered from the lists above. Derived from them, a control dropped from
 * every view fell out of this set and so was never hidden — it stayed wherever the last view left
 * it, which is the very thing this function exists to stop. */
const PMDB_ALL = ['ptmTplShort', 'ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut', 'ptmQ',
  'ptmBrandFs', 'ptmDir', 'ptmConsApply', 'ptmRecSeed', 'ptmRecApply', 'ptmNew', 'ptmLookalike', 'ptmCustFix', 'ptmAsin', 'ptmImgs',
  'ptmClear', 'ptmTemplate', 'ptmImport', 'ptmRename', 'ptmExport', 'ptmGo'];

function pmdbTools(view) {
  const on = PMDB_TOOLS[view] || PMDB_TOOLS.master;
  if ($('ptmNew')) $('ptmNew').textContent = view === 'fabric' ? '+ Fabric SKU' : '+ New SKU';
  PMDB_ALL.forEach(id => {
    const el = $(id); if (!el) return;
    const show = on.indexOf(id) >= 0 && !(PMDB_WRITES.indexOf(id) >= 0 && !mdbCanEdit());
    el.classList.toggle('hide', !show);
  });
  /* Template and Import belong to whichever view is open, so they say which one. */
  const rec = view === 'recipe', skc = view === 'skucode';
  if ($('ptmTemplate')) $('ptmTemplate').textContent = rec ? 'Recipe template' : skc ? 'Base code template' : 'Template';
  if ($('ptmImport')) $('ptmImport').textContent = rec ? 'Upload recipes' : skc ? 'Upload base codes' : 'Import';
}

function renderPmdb() {
  if (PT.busy.mdb) { $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = 'Reading the production database…'; ptEmpty('ptmTable', 'Loading…'); return; }
  if (PT.err.mdb) {
    $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'Could not read it: ' + PT.err.mdb;
    ptEmpty('ptmTable', 'Nothing to show.'); $('ptmKpis').innerHTML = ''; return;
  }
  /* The printer's cloth is worked out rather than stored, so it has its own drawing — and the two
   * filters only it needs appear with it and go away again. */
  const view = ($('ptmView') || {}).value || 'master';
  pmdbTools(view);
  if (view === 'recipe') return renderMdbRecipe();
  if (view === 'skucode') return renderSkuCode();
  if (view === 'fabric') return renderMdbFabric();
  if (view === 'cons') return renderMdbCons();

  const custom = $('ptmView') && $('ptmView').value === 'custom';
  if (custom && MDBX.busy) { $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = 'Reading the custom SKUs…'; ptEmpty('ptmTable', 'Loading…'); return; }
  if (custom && MDBX.err) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'Could not read the custom SKUs: ' + MDBX.err; ptEmpty('ptmTable', 'Nothing to show.'); $('ptmKpis').innerHTML = ''; return; }
  const all = (custom ? (MDBX.custom || []) : (PT.mdb || []));
  if (!all.length) { $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = ''; $('ptmKpis').innerHTML = ''; ptEmpty('ptmTable', custom ? 'No custom SKUs.' : 'The master database is empty.'); return; }

  const f = pmdbFilters();
  ptFill('ptmBrand', pmdbApply(all, f, 'brand').map(r => r.brand), 'All brands');
  ptFill('ptmArt', pmdbApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('ptmSub', pmdbApply(all, f, 'sub').map(r => r.subtype), 'All subtypes');
  ptFill('ptmCol', pmdbApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('ptmSz', pmdbApply(all, f, 'sz').map(r => r.size), 'All sizes');

  const rows = pmdbApply(all, f).sort((a, b) => String(a.sku || '').localeCompare(String(b.sku || '')));
  PT._pmdbRows = rows;

  const cnt = p => rows.filter(p).length;
  $('ptmKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Master Database</span>
      <span class="kpiwhen">read live${PT.at.mdb ? ' · ' + esc(PT.at.mdb) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">SKUs shown</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => String(r.articleType || '').trim()).filter(Boolean)).size)}</div><div class="l">Article types</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => String(r.color || '').trim()).filter(Boolean)).size)}</div><div class="l">Colors</div></div>
      <div class="metric"><div class="v">${nf(cnt(r => r.cuttingRequired))}</div><div class="l">Cutting required</div></div>
      <div class="metric"><div class="v">${nf(cnt(r => r.isZip))}</div><div class="l">With zip</div></div>
      <div class="metric"><div class="v">${nf(cnt(r => r.isRuffle))}</div><div class="l">Ruffle</div></div>
      ${(n => n ? `<div class="metric" title="Ruffle SKUs whose metres are neither on the SKU nor in its recipe — fill Ruffle metres and fabric in the Recipe for that article · subtype · size"><div class="v" style="color:var(--bad)">${nf(n)}</div><div class="l">Ruffle, no metres</div></div>` : '')(cnt(r => r.isRuffle && !ptRuffleOf(r)))}
      <div class="metric"><div class="v">${nf(cnt(r => r.fillerFabricRequired))}</div><div class="l">Needs filler</div></div>
      ${(n => `<div class="metric" title="SKUs with no ASIN yet. ASIN from Amazon fills the ones Amazon lists; the rest are not on Amazon."><div class="v"${n ? ' style="color:var(--bad)"' : ''}>${nf(n)}</div><div class="l">No ASIN</div></div>`)(cnt(r => !String(r.asin || '').trim()))}
    </div></div>`;

  const yn = v => v ? '<span class="pill pill-ok">Yes</span>' : '<span class="muted">—</span>';
  const head = '<thead><tr>' + ['SKU', 'Image', 'ASIN', 'Parent ASIN', 'Brand', 'Article', 'Subtype', 'Color', 'Size', 'Fabric', 'Consumption', 'Pack of', 'Cutting', 'Zip', 'Ruffle', 'Piping', 'Filler', 'Edit']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 10 || i === 11 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const asinCell = v => String(v || '').trim() ? `<td style="font-family:ui-monospace,monospace">${esc(v)}</td>` : '<td><span class="muted">—</span></td>';
  const zipCell = r => !r.isZip ? '<span class="muted">—</span>'
    : `<span class="pill pill-ok">Yes</span><div class="muted" style="font-size:11px;margin-top:2px">${nf(mdbZipQty(r))} × ${esc(r.chainLength == null ? '?' : r.chainLength)}"</div>`;
  const pipCell = r => !r.isPiping ? '<span class="muted">—</span>'
    : `<span class="pill pill-ok">Yes</span><div class="muted" style="font-size:11px;margin-top:2px">${r.pipingMeters == null ? '?' : esc(r.pipingMeters)}m dori</div>`;
  /* What the cutting issue and the demand will use — the SKU's own figures, else its recipe — and a word
   * saying which, so a figure that is not typed on the SKU is not mistaken for one that is. */
  const rufCell = r => {
    if (!r.isRuffle) return '<span class="muted">—</span>';
    const u = ptRuffleOf(r);
    const txt = u ? mdbM2Txt(u.meters) + 'm · ' + esc(u.fabric) + (u.from === 'sku' ? '' : ' <span title="Not typed on this SKU — taken from its ' + u.from + '">(' + u.from + ')</span>')
      : '<span style="color:var(--bad)" title="Neither this SKU nor a recipe for ' + esc([r.articleType, r.subtype, r.size].filter(Boolean).join(' · '))
        + ' gives ruffle metres and fabric. Fill them in Recipe.">' + (recipeOf(r) ? 'recipe has no ruffle' : 'no recipe') + '</span>';
    return '<span class="pill pill-ok">Yes</span><div class="muted" style="font-size:11px;margin-top:2px">' + txt + '</div>';
  };
  const body = rows.slice(0, PMDB_MAX).map(r => '<tr>'
    + `<td class="frz" style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
    + ptImgCell(r.sku, 44)
    + asinCell(r.asin) + asinCell(r.parentAsin)
    + `<td>${esc(r.brand)}</td><td>${esc(r.articleType)}</td><td>${esc(r.subtype)}</td>`
    + `<td>${esc(r.color)}</td><td>${esc(r.size)}</td><td>${esc(r.fabric)}</td>`
    + `<td class="num">${mdbM2Txt(r.consumption) === '' ? '<span class="muted">—</span>' : esc(mdbM2Txt(r.consumption))}</td>`
    + `<td class="num">${esc(r.packOf)}</td><td>${yn(r.cuttingRequired)}</td><td>${zipCell(r)}</td>`
    + `<td>${rufCell(r)}</td><td>${pipCell(r)}</td><td>${yn(r.fillerFabricRequired)}</td>`
    + `<td>${custom ? '<span class="muted">—</span>'
      : `<button class="ghost" data-mdb-edit="${esc(r.sku)}" style="padding:3px 10px;font-size:12px">Edit</button>`}</td></tr>`).join('');
  $('ptmTable').innerHTML = head + '<tbody>' + body + '</tbody>';

  $('ptmMsg').className = 'muted';
  $('ptmMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} SKU(s)`
    + (rows.length > PMDB_MAX ? ` · showing the first ${PMDB_MAX} · Export covers all of them` : '')
    + (custom ? ' · custom SKUs, kept apart from the catalogue.' : '')
    + (MDBIMG.msg ? ' · ' + MDBIMG.msg : '');
}

/* ---------------- Base Data (issue → receive register) ---------------- */

let PT_BD_KPI = '';     // '' | 'issued' | 'received' | 'rejected' | 'pending' | 'done' | 'open'
const PT_BD_KPI_LABEL = { issued: 'Issued', received: 'Received', rejected: 'Rejected',
  pending: 'Pending pieces', done: 'Completed', open: 'Open' };

async function ensurePbase() {
  /* The 💬 buttons need the employee list to know who has a number, and the templates to compose
   * with. Kicked off here, not awaited: the register must not wait on a nicety. */
  waLoad().catch(() => {});
  if (PT.base === null) await ptLoad('base', 'pt_baseData', renderPbase); else renderPbase();
}

/**
 * Who touched a row: the person who entered it, and the person who changed it afterwards.
 *
 * ENTERING AND EDITING ARE DIFFERENT ACTS. Entering is open to everyone who can reach the register;
 * editing is granted per account, because it moves figures somebody has already counted on. So the
 * cell names the first plainly and marks the second, with the date in the tooltip.
 */
const whoShort = e => String(e || '').split('@')[0] || '';
const whoTouched = r => [String((r && r.addedBy) || ''), String((r && r.lastEditedBy) || '')]
  .map(s => s.trim().toLowerCase()).filter(Boolean);
function whoCell(r) {
  const by = whoShort(r && r.addedBy);
  const ed = String((r && r.lastEditedBy) || '').trim();
  const when = ptIsoDate((r && r.lastEditedAt) || '') || '';
  return `<td style="text-align:left;font-size:12px">${esc(by) || '<span class="muted">—</span>'}`
    + (ed ? `<div class="muted" style="font-size:10px" title="Changed by ${esc(ed)}${when ? ' on ' + esc(when) : ''}">`
        + `edited · ${esc(whoShort(ed))}${when ? ' · ' + esc(when) : ''}</div>` : '')
    + '</td>';
}
/** The people on these rows, for the picker — whoever entered or changed one. */
const whoList = rows => [...new Set((rows || []).flatMap(whoTouched))].sort();

function pbaseFilters() {
  const v = id => ($(id) || {}).value || '';
  return { type: v('pbType'), emp: v('pbEmp'), art: v('pbArt'), sub: v('pbSub'), col: v('pbCol'),
    sz: v('pbSz'), status: v('pbStatus'), q: v('pbQ').trim().toLowerCase(), d1: v('pbD1'), d2: v('pbD2'),
    dBy: v('pbDBy'), who: v('pbWho') };
}

function pbaseApply(rows, f, skip) {
  skip = skip || '';
  return rows.filter(r => {
    if (skip !== 'type' && f.type && !ptCi(r.empType, f.type)) return false;
    if (skip !== 'emp' && f.emp && !ptCi(r.empName, f.emp)) return false;
    /* Entered by them OR changed by them — "everything this person touched" is the question. */
    if (skip !== 'who' && f.who && whoTouched(r).indexOf(String(f.who).toLowerCase()) < 0) return false;
    if (skip !== 'art' && f.art && !ptCi(r.articleType, f.art)) return false;
    if (skip !== 'sub' && f.sub && !ptCi(r.articleSubtype, f.sub)) return false;
    if (skip !== 'col' && f.col && !ptCi(r.color, f.col)) return false;
    if (skip !== 'sz' && f.sz && !ptCi(r.size, f.sz)) return false;
    if (skip !== 'q' && f.q) {
      const hay = [r.sku, r.articleType, r.articleSubtype, r.color, r.size, r.empName, r.empType, r.orderNo, r.remarks].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    if (skip !== 'status' && f.status === 'open' && r.frozen) return false;
    if (skip !== 'status' && f.status === 'done' && !r.frozen) return false;
    if (skip !== 'status' && f.status === 'pending' && ptNum(r.pendingPieces) < 1) return false;
    if (skip !== 'date' && (f.d1 || f.d2)) {
      /* Issued, received, or either: a row is in the range when the date it is asked about is. A row
       * nothing has come back on yet has no receiving date, and is never "received" in any range. */
      const lo = f.d1 ? new Date(f.d1 + 'T00:00:00') : null, hi = f.d2 ? new Date(f.d2 + 'T23:59:59') : null;
      const inR = v => { const d = v ? ptDate(v) : null; return !!d && (!lo || d >= lo) && (!hi || d <= hi); };
      const recv = ptNum(r.receivedPieces) + ptNum(r.rejectionPieces) > 0 ? r.receivingDate : '';
      const ok = f.dBy === 'issue' ? inR(r.issueDate) : f.dBy === 'recv' ? inR(recv) : (inR(r.issueDate) || inR(recv));
      if (!ok) return false;
    }
    return true;
  });
}

/* HOW MANY ROWS JOB WORK AND CUTTING DRAW (2026-10-01). Cutting drew every entry — 17,238 cells on 30 Sep and
 * more each day — and Job Work 600 rows, 1.2 MB of HTML. 300 first; "Show more" adds 300. Export, the KPI cards and
 * the totals still count every filtered row. */
const PT_CAP_STEP = 300;
let PB_CAP = PT_CAP_STEP, PC_CAP = PT_CAP_STEP;
const ptMoreBtn = (attr, n, cap) => n > cap
  ? ` <button type="button" ${attr} style="padding:3px 10px;font-size:12px;margin-left:6px">Show ${nf(Math.min(PT_CAP_STEP, n - cap))} more</button>` : '';
function renderPbase() {
  /* Read once, then painted on every draw. The read is not awaited: the register is what this screen
   * is for, and it must not wait on a queue that is usually empty. */
  if (APV === null && ME.admin) { APV = []; apvLoad(true).then(apvPaint).catch(() => {}); }
  apvPaint();
  if (JWC.rows === null) { JWC.rows = {}; jwCorrLoad().then(() => { if (PT.base) renderPbase(); }).catch(() => {}); }
  jwCorrBadge();
  $('pbMore').innerHTML = '';
  if (PT.busy.base) { $('pbMsg').className = 'muted'; $('pbMsg').textContent = 'Reading the production database…'; ptEmpty('pbTable', 'Loading…'); return; }
  if (PT.err.base) {
    $('pbMsg').className = 'err'; $('pbMsg').textContent = 'Could not read it: ' + PT.err.base;
    ptEmpty('pbTable', 'Nothing to show.'); $('pbKpis').innerHTML = ''; return;
  }
  const all = PT.base || [];
  if (!all.length) { $('pbMsg').className = 'muted'; $('pbMsg').textContent = ''; $('pbKpis').innerHTML = ''; ptEmpty('pbTable', 'No issue/receive entries.'); return; }

  const f = pbaseFilters();
  ptFill('pbType', pbaseApply(all, f, 'type').map(r => r.empType), 'All types');
  ptFill('pbEmp', pbaseApply(all, f, 'emp').map(r => r.empName), 'All employees');
  ptFill('pbWho', whoList(pbaseApply(all, f, 'who')), "Anyone's entry");
  ptFill('pbArt', pbaseApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('pbSub', pbaseApply(all, f, 'sub').map(r => r.articleSubtype), 'All subtypes');
  ptFill('pbCol', pbaseApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('pbSz', pbaseApply(all, f, 'sz').map(r => r.size), 'All sizes');

  /* The KPI cards count the FILTERED set, not the set after a card has been clicked — otherwise
   * clicking "Pending" would rewrite every other card to match it and the totals would move under
   * your hand. Only the table narrows. */
  const base = pbaseApply(all, f);
  let rows = base;
  if (PT_BD_KPI === 'open') rows = base.filter(r => !r.frozen);
  else if (PT_BD_KPI === 'done') rows = base.filter(r => r.frozen);
  else if (PT_BD_KPI === 'pending') rows = base.filter(r => ptNum(r.pendingPieces) > 0);
  else if (PT_BD_KPI === 'issued') rows = base.filter(r => ptNum(r.issuePieces) > 0);
  else if (PT_BD_KPI === 'received') rows = base.filter(r => ptNum(r.receivedPieces) > 0);
  else if (PT_BD_KPI === 'rejected') rows = base.filter(r => ptNum(r.rejectionPieces) > 0);

  const sum = fn => base.reduce((s, r) => s + ptNum(fn(r)), 0);
  const tI = sum(r => r.issuePieces), tR = sum(r => r.receivedPieces);
  const tRej = sum(r => r.rejectionPieces), tP = sum(r => r.pendingPieces);
  const done = base.filter(r => r.frozen).length, open = base.filter(r => !r.frozen).length;

  const sel = k => (PT_BD_KPI === k ? ' pt-kpi-on' : '') + '" role="button" tabindex="0" title="'
    + (PT_BD_KPI === k ? 'Showing only these entries. Click again to show all.'
      : k === '' ? 'Show every entry.' : 'Show only the entries with ' + PT_BD_KPI_LABEL[k].toLowerCase() + '.');
  $('pbKpis').innerHTML = jwKpiCards({ sel, base, tI, tR, tRej, tP, done, open });

  rows = [...rows].sort((a, b) => {
    const d = ptDtMs(b.issueDate) - ptDtMs(a.issueDate);
    return d || String(b.id || '').localeCompare(String(a.id || ''));
  });
  PT._pbaseRows = rows;

  /* RAVI'S ORDER, IN FEWER COLUMNS (2026-09-22: "attractive, kuch bhi data kam na ho"). Neighbours that
   * describe one thing share a cell — the karigar and their type; the item's picture, SKU, subtype,
   * colour and size; the status and the day it came back. Nothing is dropped and nothing moves. */
  /* 2026-09-22, second pass: the receipt boxes sit UNDER the Received figure they add to, and the
   * WhatsApp buttons join Edit in one Actions cell. Export is untouched — it builds its own columns. */
  /* Third pass (2026-09-22): pending and rejected said twice — once in Status, once in their own
   * columns — so Status alone carries them; who entered it and the remarks go to the end. */
  /* FIFTH PASS (2026-09-22, Ravi's picture): a tick box to pick rows, the karigar with their initials,
   * the item with its picture, both quantities in pieces, a progress ring, a status that says Pending,
   * In Progress or Completed, and one action with the rest behind ⋯. Who entered it stays at the end. */
  const shown = rows.slice(0, PB_CAP);
  const allOn = shown.length > 0 && shown.every(r => JW_PICK.has(r.id));
  const head = '<thead><tr>' + [`<input type="checkbox" class="jw-pickall" title="Pick every row on screen"${allOn ? ' checked' : ''}>`,
    'Issue Date', 'Karigar', 'Item', 'Qty Issued', 'Qty Received', 'Progress', 'Status', 'Actions', 'Entered by']
    .map((h, i) => `<th${i === 0 ? ' class="jw-ck"' : ([4, 5].indexOf(i) >= 0 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const body = shown.map(jwRow).join('');
  $('pbTable').innerHTML = head + '<tbody>' + body + '</tbody>';
  jwBulkShow();

  $('pbMsg').className = 'muted';
  $('pbMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} entr${all.length === 1 ? 'y' : 'ies'}`
    + (rows.length > PB_CAP ? ` · showing the first ${nf(PB_CAP)} · Export covers all of them` : '')
    + (PT_BD_KPI_LABEL[PT_BD_KPI] ? ' · only entries with ' + PT_BD_KPI_LABEL[PT_BD_KPI] + ' — click the figure again to show all' : '');
  $('pbMore').innerHTML = ptMoreBtn('data-pbmore', rows.length, PB_CAP);
  ptImgFill(shown.map(r => r.sku), false, ptIfTab('pbase', renderPbase));
}

