/* ================= PRODUCTION: WRITING, NOT JUST READING =================
 *
 * The first action moved out of the old tool and into this app: recording a cutting entry.
 *
 * THE GATES ARE THE POINT, not the form. An entry that skips them is worse than no entry at all —
 * it quietly breaks the order cap that stops the factory cutting 300 pieces against a 200-piece
 * order, and everything downstream (what may be issued, what may be pressed) is measured against
 * these same numbers. So all four are ported as they stand in the old tool, with the same
 * arithmetic and the same refusal messages:
 *
 *   1. the SKU must be in the master database
 *   2. an Order ID is compulsory, and ordered − already-cut is a hard cap
 *      (already-cut is NET: pieces cut minus pieces rejected after cutting, so a rejection
 *       re-opens the allowance exactly as it does there)
 *   3. the month must not be frozen
 *   4. article / subtype / colour / size must be known to the masters
 *
 * Written to the SAME database the old tool writes to, in the same shape, with the same id scheme
 * (`cut_<ms>_<rand>`) and the same addedBy/addedAt. Both tools can therefore run side by side while
 * the rest is moved across — there is one set of records, not two.
 */

/* The signed-in user's token rides along on every write. The database this points at today ignores
 * it (its rules are still open); the one in THIS project requires it. Sending it either way is what
 * lets the move be a one-line change rather than a rewrite. */
async function ptAuthQuery() {
  try {
    const u = auth.currentUser;
    if (!u) return '';
    return '?auth=' + encodeURIComponent(await u.getIdToken());
  } catch (e) { return ''; }
}

/* ================= WHO CHANGED WHAT, AND A RECYCLE BIN (2026-10-01) =================
 *
 * Ravi: "industry-level ERP ... kuch mitaye bina". Every write to the production database already goes through
 * ptPut / ptPatch / ptDelete, so the history is kept HERE, once, and no screen changes how it works:
 *   - pt_audit/<YYYY-MM>/<id>  one line per save: who, when, which screen, which paths, and the value written
 *                              (a row's value; a big list only by its size). A row's history is its lines in order.
 *   - pt_trash/<id>            before anything is deleted (a ptDelete, or a ptPatch path set to null), the record as
 *                              it was, with who and when — so a delete can be undone (auditRestore, admins).
 * Never in the way of the save itself: the history line is written after the save and its failure is swallowed
 * (a vendor login, which the rules keep out of these nodes, simply leaves no line). Only the copy-before-delete is
 * awaited, because once the record is gone there is nothing left to copy.
 * Both nodes fall under the rules' "$other": any staff login writes, only admins read. Neither is read at sign-in. */
/* AUDIT_OFF is never set in the browser; the test harnesses set it so call-counting tests see only the save itself. */
const AUDIT = { on: typeof AUDIT_OFF === 'undefined' || !AUDIT_OFF, maxVal: 20000, maxTrashReads: 50 };
const AUDIT_SKIP = /^pt_(audit|trash)(\/|$)/;
const auditId = () => Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
const auditYm = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
function auditWho() {
  try { return { by: (typeof ME !== 'undefined' && ME && ME.email) || '', tab: (typeof TAB_NOW !== 'undefined' && TAB_NOW) || '' }; }
  catch (e) { return { by: '', tab: '' }; }
}
/** The value as it is kept in a history line: itself when small, else just how big it was. */
function auditVal(v) {
  if (v === undefined) return null;
  let j = ''; try { j = JSON.stringify(v); } catch (e) { return { _unstorable: true }; }
  return j.length <= AUDIT.maxVal ? v : { _bytes: j.length };
}
/** One history line, written after the save; never throws and is never awaited by the save. */
function auditLog(kind, changes) {
  if (!AUDIT.on) return;
  const keep = Object.keys(changes).filter(k => !AUDIT_SKIP.test(k));
  if (!keep.length) return;
  const w = auditWho();
  /* The paths cannot be keys (they hold "/"), so the values go in a list beside them, in the same order. */
  const rec = { at: new Date().toISOString(), by: w.by, tab: w.tab, kind, n: keep.length, paths: keep.slice(0, 50),
    vals: keep.slice(0, 50).map(k => auditVal(changes[k])) };
  ptAuditWrite({ ['pt_audit/' + auditYm() + '/' + auditId()]: rec }).catch(() => {});
}
/** What is about to be deleted, copied to the recycle bin first. Returns how many records were kept. */
async function auditTrash(paths, why) {
  if (!AUDIT.on) return 0;
  const want = paths.filter(p => !AUDIT_SKIP.test(p) && /^pt_/.test(p)).slice(0, AUDIT.maxTrashReads);
  if (!want.length) return 0;
  const w = auditWho(), at = new Date().toISOString(), patch = {};
  for (const p of want) {
    let v = null;
    try { v = await ptGetFresh(p); } catch (e) { continue; }
    if (v === null || v === undefined || (typeof v === 'object' && !Object.keys(v).length)) continue;
    patch['pt_trash/' + auditId()] = { path: p, value: v, at, by: w.by, tab: w.tab, why: why || 'delete' };
  }
  if (!Object.keys(patch).length) return 0;
  try { await ptAuditWrite(patch); } catch (e) { return 0; }
  return Object.keys(patch).length;
}
/** A plain REST read of one path — not the live listener, which may be a moment behind a write just made. */
async function ptGetFresh(path) {
  const r = await fetch(`${PT_URL}/${ptPath(path)}.json` + await ptAuthQuery());
  if (!r.ok) throw new Error('read ' + r.status);
  return r.json();
}
/** The history's own write: a root PATCH that is never itself logged. */
async function ptAuditWrite(updates) {
  const r = await fetch(`${PT_URL}/.json` + await ptAuthQuery(), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates),
  });
  if (!r.ok) throw new Error('audit ' + r.status);
  return true;
}
/** Put a record from the recycle bin back where it was — only if nothing has been written there since. Admins. */
async function auditRestore(trashId) {
  if (!(ME && ME.admin)) return 'Only an admin can restore a deleted record.';
  let t = null;
  try { t = await ptGetFresh('pt_trash/' + trashId); } catch (e) { return 'Could not read the recycle bin: ' + (e.message || e); }
  if (!t || !t.path) return 'That entry is not in the recycle bin.';
  if (t.restoredAt) return `Already restored on ${String(t.restoredAt).slice(0, 10)} by ${t.restoredBy || 'someone'}.`;
  let now = null;
  try { now = await ptGetFresh(t.path); } catch (e) { return 'Could not check the place it goes back to: ' + (e.message || e); }
  if (now !== null && !(typeof now === 'object' && !Object.keys(now).length))
    return 'Something has been written at ' + t.path + ' since it was deleted — not restored, so nothing is overwritten.';
  await ptPut(t.path, t.value);
  try { await ptAuditWrite({ ['pt_trash/' + trashId + '/restoredAt']: new Date().toISOString(), ['pt_trash/' + trashId + '/restoredBy']: ME.email }); }
  catch (e) { /* restored all the same */ }
  return '';
}

/* ---- the screen for it: Dashboard → Change history (admins; the rules let only admins read these nodes) ---- */
let AUD = { rows: null, bin: null, ym: '', busy: false };
const AUD_CAP = 300;
/** The newest entries of one node, by key (keys start with the time, so key order is time order). */
async function audRead(node, n) {
  const q = await ptAuthQuery();
  const r = await fetch(`${PT_URL}/${ptPath(node)}.json?orderBy=%22%24key%22&limitToLast=${n}` + (q ? '&' + q.slice(1) : ''));
  if (r.status === 401 || r.status === 403) throw new Error('only an admin can read the change history');
  if (!r.ok) throw new Error('the database answered ' + r.status);
  const v = await r.json();
  return Object.entries(v || {}).map(([id, x]) => Object.assign({ _id: id }, x)).filter(x => x && x.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
/** "Cutting · cut_17… · RTC516-60108 · 12 pcs · Ikram Khan" — what a path and its value were, in a line. */
function audWhat(path, val) {
  const seg = String(path || '').split('/'), reg = (seg[0] || '').replace(/^pt_/, '');
  const bits = [reg, seg.slice(1).join('/')].filter(Boolean);
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    if (val._bytes) bits.push(nf(Math.round(val._bytes / 1024)) + ' KB written');
    else {
      const pcs = ['pieces', 'qty', 'issuePieces', 'receivedPieces', 'pendingPieces'].filter(k => val[k] != null).map(k => k + ' ' + val[k]);
      bits.push(...[val.sku, val.orderNo, val.empName, val.articleSubtype || val.subtype].filter(Boolean).map(String), ...pcs.slice(0, 3));
    }
  } else if (val === null) bits.push('deleted');
  else if (Array.isArray(val)) bits.push(nf(val.length) + ' rows');
  else bits[bits.length - 1] += ' = ' + String(val).slice(0, 60);
  return bits.join(' · ');
}
async function audLoad() {
  if (!ME.admin) { $('audMsg').className = 'err'; $('audMsg').textContent = 'Only an admin can read the change history.'; return; }
  if (AUD.busy) return;
  const ym = $('audMonth').value || dToday().slice(0, 7);
  $('audMonth').value = ym;
  AUD.busy = true; $('audMsg').className = 'muted'; $('audMsg').textContent = 'Reading…';
  try {
    if ($('audView').value === 'bin') AUD.bin = await audRead('pt_trash', AUD_CAP);
    else { AUD.rows = await audRead('pt_audit/' + ym, AUD_CAP); AUD.ym = ym; }
  } catch (e) { $('audMsg').className = 'err'; $('audMsg').textContent = 'Could not read it: ' + (e.message || e); AUD.busy = false; return; }
  AUD.busy = false;
  audRender();
}
function audRender() {
  const bin = $('audView').value === 'bin';
  const list = bin ? AUD.bin : AUD.rows;
  $('audMonth').classList.toggle('hide', bin);
  if (!list) { $('audBody').innerHTML = ''; $('audMsg').className = 'muted'; $('audMsg').textContent = 'Press Show to read it.'; return; }
  const q = String($('audQ').value || '').trim().toLowerCase();
  const who = x => String(x.by || '').split('@')[0];
  const when = x => { const d = new Date(x.at); return isNaN(d) ? String(x.at) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  let rows;
  if (bin) {
    rows = list.map(x => ({ x, text: audWhat(x.path, x.value) }));
  } else {
    rows = list.map(x => ({ x, text: (x.paths || []).slice(0, 3).map((p, i) => audWhat(p, (x.vals || [])[i])).join('  |  ')
      + ((x.n || 0) > 3 ? `  |  +${nf(x.n - 3)} more` : '') }));
  }
  if (q) rows = rows.filter(r => (r.text + ' ' + (r.x.by || '') + ' ' + (r.x.tab || '')).toLowerCase().includes(q));
  const head = '<thead><tr>' + (bin ? ['Deleted', 'By', 'Screen', 'What it was', ''] : ['When', 'By', 'Screen', 'Kind', 'What changed'])
    .map(h => `<th style="text-align:left">${h}</th>`).join('') + '</tr></thead>';
  const body = rows.map(({ x, text }) => '<tr>'
    + `<td style="white-space:nowrap">${esc(when(x))}</td><td>${esc(who(x))}</td><td>${esc(x.tab || '—')}</td>`
    + (bin
      ? `<td style="text-align:left;white-space:normal">${esc(text)}</td><td>${x.restoredAt
          ? `<span class="muted">restored ${esc(String(x.restoredAt).slice(0, 10))}</span>`
          : `<button class="ghost" data-aud-restore="${esc(x._id)}" style="padding:3px 10px;font-size:12px">Restore</button>`}</td>`
      : `<td>${esc(x.kind || '')}</td><td style="text-align:left;white-space:normal">${esc(text)}</td>`)
    + '</tr>').join('');
  $('audBody').innerHTML = rows.length ? `<table>${head}<tbody>${body}</tbody></table>` : '<div class="muted">Nothing matches.</div>';
  $('audMsg').className = 'muted';
  $('audMsg').textContent = bin
    ? `${nf(rows.length)} deleted record(s), newest first — the last ${nf(AUD_CAP)} are read. Restore puts one back only where nothing has been saved since.`
    : `${nf(rows.length)} change(s) in ${AUD.ym}, newest first — the last ${nf(AUD_CAP)} of the month are read.`;
}

async function ptPut(path, value) {
  ptLiveWrote([path]);
  const r = await fetch(`${PT_URL}/${ptPath(path)}.json` + await ptAuthQuery(), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  ptLiveWrote([path]);
  if (r.status === 401 || r.status === 403)
    throw new Error('The production database refused the write (permission denied). Sign out and '
      + 'sign in again; if it keeps happening, this account is not allowed to change production data.');
  if (!r.ok) throw new Error(`The production database answered ${r.status} ${r.statusText || ''}`.trim());
  const out = await r.json();
  auditLog('put', { [path]: value });
  return out;
}

/* ---- the data the gates are measured against ---- */
let PTG = { masters: null, mdb: null, ob: null, press: null, freeze: null, err: '', busy: false, at: 0 };

/** How long a read of somebody else's work stays worth trusting on a screen you have just opened. */
/* TEN MINUTES, NOT TWO (2026-09-27). The project is on the free Spark plan — 10 GB a month of database downloads — and
 * the month had already used 19.4 GB, 1.5 to 3.4 GB a day, most of it these eight registers (7.1 MB) read again every
 * time somebody came back to a factory screen after two minutes. The master database and the masters (2.2 MB of it)
 * change rarely and are re-read on a background refresh only every half hour; Master DB's own Refresh reads them at once. */
const PTG_STALE_MS = 10 * 60 * 1000;
const PTG_MDB_STALE_MS = 30 * 60 * 1000;
const ptGatesStale = () => !PTG.at || Date.now() - PTG.at > PTG_STALE_MS;

/** Re-read the order book, master and registers if they are old. Opening a screen is the moment to
 *  find out what the rest of the floor has done. */
async function ptGatesFresh() {
  if (ptGatesStale()) await ptLoadGates(true, true);
}
/**
 * OPEN A SCREEN AT ONCE, REFRESH BEHIND IT (Ravi, 2026-09-26: "system lag ho rha h ek window se dusri window par jane
 * me"). Waiting for the eight registers — 7 MB — before drawing made every return to a factory screen after two
 * minutes sit blank for seconds. The screen draws from what is in memory; when the fresh copy lands it redraws, and
 * only if it is still the screen being looked at. The very first open still waits, because there is nothing to draw.
 */
function ptOpenFresh(tab, ensure) {
  const stale = ptGatesStale();
  if (!PTG.mdb || !stale) return ensure();
  ensure();
  ptLoadGates(true, true).then(() => { if (TAB_NOW === tab) ensure(); }).catch(() => { /* the screen already shows what it had */ });
}

/* A READ ALREADY UNDER WAY IS WAITED FOR, not skipped (2026-09-25). Returning at once let the Master Database —
 * and any screen that awaited this — carry on with nothing loaded yet and say the database was empty. */
function ptLoadGates(force, light) {
  if (PTG.busy && PTG.loading) return PTG.loading;
  if (PTG.mdb && !force) return Promise.resolve();
  PTG.loading = ptLoadGatesRun(light);
  return PTG.loading;
}
async function ptLoadGatesRun(light) {
  PTG.busy = true; PTG.err = '';
  /* A BACKGROUND REFRESH keeps the master and the masters it already has while they are under half an hour old. */
  const keepMdb = !!light && !!PTG.mdb && !!PTG.masters && Date.now() - (PTG.mdbAt || 0) < PTG_MDB_STALE_MS;
  try {
    /* EIGHT READS, EIGHT NAMES. One short here would hand every later list the value of the one
     * before it, and nothing on screen would look wrong until a figure did. */
    const [masters, mdb, ob, press, freeze, cut, base, shopProd] = await Promise.all([
      keepMdb ? Promise.resolve(PTG.masters) : ptGet('pt_masters'), keepMdb ? Promise.resolve(null) : ptGet('pt_masterDB'), ptGet('pt_orderBook'),
      ptGet('pt_pressInventory'), ptGet('pt_cuttingFreezes'), ptGet('pt_cuttingData'), ptGet('pt_baseData'),
      ptGet('pt_shopProd'),
    ]);
    PTG.shopProd = shopProd || {};
    if (!keepMdb) {
      PTG.masters = masters || {};
      PTG.recipeAt = Date.now();
      PTG.mdb = ptList(mdb).map(mdbYnFix);
      PTG.mdbAt = Date.now();
    }
    PTG.ob = ptList(ob);
    PTG.press = ptList(press);
    PTG.freeze = freeze || {};
    PT.cut = ptList(cut); PT.at.cut = ptStamp();
    /* The pictures already looked up. Read here so EVERY screen starts knowing them — it was read
     * by the Vendor Portal alone, which is why every other screen asked Amazon again from scratch. */
    try { await ptImgShared(); } catch (e) { /* pictures are a nicety, never a blocker */ }
    PT.base = ptList(base); PT.at.base = ptStamp();
  } catch (e) {
    PTG.err = e.message || String(e);
  }
  PTG.busy = false;
  /* When this data was true. Screens opened later decide from it whether to read again. */
  PTG.at = Date.now();
}

const obUC = s => String(s == null ? '' : s).trim().toUpperCase();

/* ================= LOOKUPS THAT DO NOT WALK THE WHOLE LIST =================
 *
 * The app was scanning a 4,706-row master database once per row rendered, and the three production
 * registers once per order line. Measured on the live data, one pass over every screen took SIX
 * SECONDS on a fast machine — several times that on the laptops the floor actually uses, which is
 * what Ravi's team were sitting through.
 *
 * Nothing below changes a single figure. Every index is built from the same rows the scan walked,
 * and the functions that had extra rules keep them.
 *
 * INVALIDATION IS BY ARRAY IDENTITY, not by a flag somebody has to remember to set. Every place that
 * changes these lists REPLACES the array (PTG.mdb = PTG.mdb.map(…), = …concat(…), = …filter(…)) or
 * reloads it wholesale, so a different array object means the data moved and the index is rebuilt.
 * The length is checked too, which catches a push. A stale index here would be worse than a slow
 * one: it would answer confidently with yesterday's master row.
 */

/** SKU → its master row. Built once per version of the master list. */
let MDB_IX = { src: null, n: -1, map: null };
function mdbIndex() {
  const rows = PTG.mdb || [];
  if (MDB_IX.src === rows && MDB_IX.n === rows.length) return MDB_IX.map;
  const m = new Map();
  rows.forEach(r => { if (r && r.sku) { const k = obUC(r.sku); if (!m.has(k)) m.set(k, r); } });
  MDB_IX = { src: rows, n: rows.length, map: m };
  return m;
}
/** The master row for a SKU, or undefined. Replaces (PTG.mdb||[]).find(…) in the hot paths. */
const mdbOf = sku => mdbIndex().get(obUC(sku));
/**
 * A SKU this page's copy of the master does not have, asked of the database itself (2026-10-01). The copy is re-read
 * only every 30 minutes (PTG_MDB_STALE_MS), so a SKU added to the master a minute ago was refused as "not in the master
 * database" — Ravi added RCN148 and could not move a Job Work row onto it. pt_masterDB is indexed on sku, so this reads
 * one row, not 2 MB. A row found is added to the copy, so every screen knows it from then on. A failed read is null.
 */
async function mdbFetchSku(sku) {
  const want = String(sku || '').trim();
  if (!want) return null;
  const q = await ptAuthQuery();
  for (const v of [...new Set([want, obUC(want)])]) {
    let got = null;
    try {
      const r = await fetch(`${PT_URL}/pt_masterDB.json?orderBy=%22sku%22&equalTo=${encodeURIComponent(JSON.stringify(v))}` + (q ? '&' + q.slice(1) : ''));
      if (!r.ok) continue;
      got = await r.json();
    } catch (e) { continue; }
    const rows = Object.entries(got || {}).map(([k, x]) => (x && typeof x === 'object' ? Object.assign({ _key: k }, x) : null))
      .filter(x => x && x.sku && !x.mergedInto && obUC(x.sku) === obUC(want));
    if (!rows.length) continue;
    const rec = typeof mdbYnFix === 'function' ? mdbYnFix(rows[0]) : rows[0];
    if (!mdbOf(rec.sku)) {
      /* ONE ARRAY, TWO NAMES, as ensurePmdb and pmdbRefresh keep them. */
      const next = (PTG.mdb || []).concat([rec]);
      PTG.mdb = next; if (PT && PT.mdb) PT.mdb = next;
    }
    return mdbOf(rec.sku) || rec;
  }
  return null;
}

/* ---- the production registers, keyed by order and SKU ---- */
const obKeyOf = (orderNo, sku) => obUC(orderNo) + '|' + obUC(sku);

let CUT_IX = { src: null, n: -1, map: null };
function obCutIndex() {
  const rows = PT.cut || [];
  if (CUT_IX.src === rows && CUT_IX.n === rows.length) return CUT_IX.map;
  const m = new Map();
  rows.forEach(r => {
    if (!r) return;
    const k = obKeyOf(r.orderNo, r.sku);
    let e = m.get(k); if (!e) { e = { gross: 0, rej: 0 }; m.set(k, e); }
    e.gross += parseInt(r.pieces, 10) || 0;
    if (r.rejected === true) e.rej += parseInt(r.rejPieces, 10) || 0;
  });
  CUT_IX = { src: rows, n: rows.length, map: m };
  return m;
}

let PRESS_IX = { src: null, n: -1, map: null };
function obPressIndex() {
  const rows = PTG.press || [];
  if (PRESS_IX.src === rows && PRESS_IX.n === rows.length) return PRESS_IX.map;
  const m = new Map();
  rows.forEach(r => {
    if (!r) return;
    const k = obKeyOf(r.orderNo, r.sku);
    m.set(k, (m.get(k) || 0) + (parseInt(r.pieces, 10) || 0));
  });
  PRESS_IX = { src: rows, n: rows.length, map: m };
  return m;
}

/** Issued and received per order and SKU, out of Base Data. */
let BASE_IX = { src: null, n: -1, map: null };
function obBaseIndex() {
  const rows = PT.base || [];
  if (BASE_IX.src === rows && BASE_IX.n === rows.length) return BASE_IX.map;
  const m = new Map();
  rows.forEach(r => {
    if (!r) return;
    const k = obKeyOf(r.orderNo, r.sku);
    let e = m.get(k); if (!e) { e = { issued: 0, received: 0 }; m.set(k, e); }
    e.issued += ptNum(r.issuePieces);
    e.received += ptNum(r.receivedPieces);
  });
  BASE_IX = { src: rows, n: rows.length, map: m };
  return m;
}


/**
 * How many pieces one unit of an order-book line is.
 *
 * A Shopify line carries the customer's quantity — packs, sets — and the factory cuts, issues and
 * pays by the piece. Everything else in the book is already in pieces, so it is 1.
 */
const obIsShop = r => !!r && (String(r.src || '') === 'SHP' || obUC(r.orderNo).indexOf('SHP-') === 0);
let OB_PACK_IX = { src: null, n: -1, sib: null };
/**
 * ONE empty list, shared by every index below that caches on the identity of its source.
 *
 * A fresh `[]` each call is a fresh identity each call, so a cache guarded by `src === IX.src` can
 * never hit while the real list is still null — and it rebuilds instead, once per row. That is what
 * made the Order Console take a second and a half to redraw before Finished Goods had loaded.
 * Frozen, so nothing can push into the stand-in for "not read yet".
 */
const PT_NONE = Object.freeze([]);

function obPackSiblings() {
  const src = PTG.mdb || PT_NONE;
  if (OB_PACK_IX.sib && OB_PACK_IX.src === src && OB_PACK_IX.n === src.length) return OB_PACK_IX.sib;
  /* Same product letters, same last segment (the size) — the other colours of one product. */
  const votes = new Map();
  src.forEach(m => {
    const p = parseInt(String((m && m.packOf) || '').replace(/[^0-9]/g, ''), 10);
    const k = obPackFamily(m && m.sku);
    if (!k || !(p > 0)) return;
    /* And every pillow cover of that size, whoever makes it: a 12x20 or 14x36 is a single lumbar
     * cover in every brand, a 16x16 a pair. */
    const keys = [k].concat(obIsPillowSku(m.sku) ? ['PC|' + k.split('|')[1]] : []);
    keys.forEach(key => {
      const v = votes.get(key) || new Map();
      v.set(p, (v.get(p) || 0) + 1);
      votes.set(key, v);
    });
  });
  const sib = new Map();
  votes.forEach((v, k) => sib.set(k, [...v.entries()].sort((a, b) => b[1] - a[1])[0][0]));
  OB_PACK_IX = { src, n: src.length, sib };
  return sib;
}
/* RPC… and CPCC… are pillow covers; RCN…, RCCN… and CPCN… napkins; RTME… table mats. */
const obIsPillowSku = sku => /^(RPC|CPCC)/.test(obUC(sku));
function obPackFamily(sku) {
  const s = obUC(sku);
  const m = s.match(/^([A-Z]+)[^-]*-(.+)$/);
  return m ? m[1] + '|' + m[2].split('-').pop() : '';
}
function obPcsPerPack(sku, articleType, articleSubtype) {
  const s = obUC(sku);
  const m = mdbOf(s);
  const p = m ? parseInt(String(m.packOf || '').replace(/[^0-9]/g, ''), 10) : 0;
  if (p > 0) return p;
  const hay = [articleType, articleSubtype].join(' ');
  /* A SET WRITES ITS SIZE INTO THE SKU. RCNB374-12 is twelve napkins; RTME-147-8 eight mats. */
  if (/napkin|placemat|place mat|table ?mat/i.test(hay) || /^(RCN|RCCN|CPCN|RTME)/.test(s)) {
    const n = s.match(/-(\d{1,2})$/);
    if (n && +n[1] >= 1 && +n[1] <= 48) return +n[1];
  }
  const fam = obPackFamily(s);
  const sib = obPackSiblings().get(fam);
  if (sib > 0) return sib;
  const pillow = /pillow/i.test(hay) || obIsPillowSku(s);
  const sameSize = pillow && fam ? obPackSiblings().get('PC|' + fam.split('|')[1]) : 0;
  if (sameSize > 0) return sameSize;
  if (pillow) return 2;
  return 1;
}
/** An order-book row's quantity in PIECES. */
function obPieces(r) {
  const q = parseInt(r && r.qty, 10) || 0;
  if (!obIsShop(r)) return q;
  /* THE SYNC SAYS HOW MANY PIECES IT MEANT. Its quantity can be in Amazon packs (a set of 8 napkins
   * sent as 2 packs of 4), which no rule reading the SKU can know. */
  const pcs = parseInt(r.pcs, 10);
  if (pcs > 0) return pcs;
  return q * obPcsPerPack(r.sku, r.articleType, r.articleSubtype);
}
/** How many sets or packs the customer ordered on a Shopify row. */
function obShopUnits(r) {
  const s = parseInt(r && r.shopQty, 10);
  return s > 0 ? s : (parseInt(r && r.qty, 10) || 0);
}

/** Every order line the gate recognises. Only the uploaded Order Book exists in this data today —
 *  the CX production/adjustment nodes the old tool also reads have never been written. */
/* Rebuilt on every call before — 2,019 rows, and obOrderedQty called it once per order line. */
let OBL_IX = { src: null, n: -1, rows: null, byKey: null };
/**
 * What a SKU is — article, subtype, colour, size — from the MASTER, which is where it is kept right.
 * An order line carries a copy made the day the order was placed; a rename in the master since (Ruffle
 * Tablecloth → Ruffle Square Tablecloth, and 262 more) left those copies behind, and the Order Console
 * showed the old name beside the right SKU. The copy is used only for a SKU the master does not have.
 */
/**
 * WHAT "Fill from look-alikes" WOULD WRITE — only into empty boxes, never over a value somebody typed.
 *   custom  — pt_customSkus/<key>/{articleType, subtype, color, size}
 *   lines   — pt_vendorOrders/<vendor>/<order>/lines/<k>/{articleType, articleSubtype, color, size}: a printer reads
 *             only their own orders, never the master, so the line has to carry it
 * Each written line also gets lookalikeFrom, so where the words came from stays on record.
 */
function skuFillPlan(custom, orders) {
  const out = { custom: [], lines: [], noGuess: new Set() };
  const fill = (have, g, map) => { const w = {}; Object.keys(map).forEach(f => { const v = g[map[f]]; if (!String(have[f] == null ? '' : have[f]).trim() && v) w[f] = v; }); return w; };
  (custom || []).forEach(r => {
    if (!r || !r.sku || (r.articleType && r.color && r.size)) return;
    const g = skuLookalike(r.sku);
    if (!g) { out.noGuess.add(obUC(r.sku)); return; }
    const w = fill(r, g, { articleType: 'articleType', subtype: 'subtype', color: 'color', size: 'size' });
    if (Object.keys(w).length) out.custom.push({ key: r._key || obUC(r.sku), sku: obUC(r.sku), w, from: g.basis });
  });
  (orders || []).forEach(o => {
    if (!o || !o.vendorCode || !o.id || voRunning(o)) return;
    const raw = o.lines;
    const ents = Array.isArray(raw) ? raw.map((l, i) => [i, l]) : Object.entries(raw || {});
    ents.forEach(([k, l]) => {
      if (!l || !l.sku || l.kind === 'running' || (l.articleType && l.color && l.size)) return;
      /* In the master: its own words (a line placed before the SKU was added carries none). Else its look-alikes. */
      const m = mdbOf(l.sku);
      const g = m ? { articleType: m.articleType || '', subtype: m.subtype || '', color: m.color || '', size: m.size || '', basis: 'master database' } : skuLookalike(l.sku);
      if (!g) { out.noGuess.add(obUC(l.sku)); return; }
      const w = fill(l, g, { articleType: 'articleType', articleSubtype: 'subtype', color: 'color', size: 'size' });
      if (Object.keys(w).length) out.lines.push({ path: 'pt_vendorOrders/' + o.vendorCode + '/' + o.id + '/lines/' + k, o, l, sku: obUC(l.sku), w, from: g.basis });
    });
  });
  return out;
}
function skuFillPatch(plan) {
  const upd = {};
  plan.custom.forEach(x => Object.keys(x.w).forEach(f => { upd['pt_customSkus/' + x.key + '/' + f] = x.w[f]; }));
  plan.lines.forEach(x => { Object.keys(x.w).forEach(f => { upd[x.path + '/' + f] = x.w[f]; }); upd[x.path + '/lookalikeFrom'] = x.from; });
  return upd;
}
async function skuFillOpen() {
  if (!mdbCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = MDB_NO_EDIT; return; }
  $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = 'Reading the Custom SKUs and the vendor orders…';
  try {
    if (!PTG.mdb) await ptLoadGates();
    MDBX.custom = ptList(await ptGet('pt_customSkus'));
    VO.rows = null; await ensureVo();
  } catch (e) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'Could not read them: ' + (e.message || e); return; }
  $('ptmMsg').textContent = '';
  const plan = skuFillPlan(MDBX.custom, VO.rows);
  const n = plan.custom.length + plan.lines.length;
  const row = (sku, w, from, where) => `<tr><td style="text-align:left;font-family:ui-monospace,monospace;font-size:12px">${esc(sku)}</td>`
    + `<td style="text-align:left">${esc([w.articleType, w.subtype || w.articleSubtype, w.color, w.size].filter(Boolean).join(' · '))}</td>`
    + `<td style="text-align:left" class="muted">${esc(where)}</td><td style="text-align:left;font-size:11.5px" class="muted">${esc(from)}</td></tr>`;
  const shown = plan.lines.slice(0, 150).map(x => row(x.sku, x.w, x.from, voName(x.o.vendorCode) + ' · ' + (x.o.orderNo || x.o.id)))
    .concat(plan.custom.slice(0, 150).map(x => row(x.sku, x.w, x.from, 'Custom SKUs list')));
  ptOpenDialog({
    title: n ? 'Fill these from their look-alikes?' : 'Nothing to fill',
    subtitle: `${nf(plan.lines.length)} vendor-order line(s) · ${nf(plan.custom.length)} Custom SKU(s)`
      + (plan.noGuess.size ? ` · ${nf(plan.noGuess.size)} SKU(s) look like nothing in the master and stay as they are` : ''),
    note: 'Only empty boxes are filled — a value somebody typed is never replaced. Article and size come from the same code in '
      + 'other colours, the colour from the same colour code in other sizes, and only where four in five of them agree. '
      + 'Printers then see the article, size and colour, and the line joins its colour group.',
    html: n ? `<div class="xlwrap" style="max-height:46vh;border:1px solid var(--line);border-radius:10px"><table class="xl" style="font-size:12.5px">
      <thead><tr><th style="text-align:left">SKU</th><th style="text-align:left">Filled with</th><th style="text-align:left">Where</th><th style="text-align:left">Read from</th></tr></thead>
      <tbody>${shown.join('')}</tbody></table></div>` + (n > shown.length ? `<div class="muted" style="margin-top:6px;font-size:12px">…and ${nf(n - shown.length)} more.</div>` : '') : '',
    fields: [],
    saveLabel: n ? 'Fill ' + nf(n) : '',
    onSave: n ? async () => {
      const upd = skuFillPatch(plan);
      try { await ptPatch(upd); } catch (e) { return 'Not written: ' + (e.message || e) + ' — nothing changed.'; }
      plan.custom.forEach(x => { const r = (MDBX.custom || []).find(c => c && (c._key || obUC(c.sku)) === x.key); if (r) Object.assign(r, x.w); });
      plan.lines.forEach(x => { Object.assign(x.l, x.w, { lookalikeFrom: x.from }); });
      renderPmdb();
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = `Filled ${nf(plan.lines.length)} vendor-order line(s) and ${nf(plan.custom.length)} Custom SKU(s) from their look-alikes.`;
      return '';
    } : null,
  });
}
if ($('ptmLookalike')) $('ptmLookalike').onclick = () => skuFillOpen();

