/* ORDER ALERT LIST, STAGE 1 "SHADOW WEEK" (docs/data-reduction/ALERT-LIST-PLAN.md, section 9). Nobody sees the list yet.
 * The order strip (orders/order-ticker.js) is worked out on every page from the Order Console's open lines, which means
 * downloading about 11 MB of registers. The plan is a small list of the open lines, pt_orderAlerts, that pages can read
 * instead. This file only BUILDS and CHECKS that list in the background; the strip still reads the registers.
 *   pt_orderAlerts/l/<order no>__<SKU>   one entry per open line (oalEntry): what the strip needs and nothing more
 *   pt_orderAlerts/v, /at                rule version (a new version rebuilds the whole list), time of the last full check
 *   pt_orderAlerts/lease                 which page does the 15-minute check (taken with compare-and-set)
 *   pt_orderAlertsLog/<day>/<id>         what each check found, a few small lines (capped)
 * How it stays up to date:
 *   - after any successful save (the hook in core/history.js calls oalAfterSave) the lines that save touched are worked
 *     out again about 3 seconds later, on a page that holds the registers and the Sales Orders; only lines that changed
 *     are written, in ONE update;
 *   - a write that fails (offline) goes on a small retry list and is tried again;
 *   - every 15 minutes ONE page (the one that holds the lease) works out every line, compares it with the list, writes
 *     what differs and logs the differences, and compares the strip's items from the list with today's strip.
 * The due date is ALWAYS the sales order's delivery date when there is one (Ravi's decision 1, 6 Nov), else 5 working days
 * from when the line opened. A page that has not opened Sales Orders does not build or check anything: it never reads the
 * registers or Sales Orders just for this.
 *   Switch: localStorage alertListBuild '0' = off on this device whatever the flag says, '1' = on, otherwise the last
 *   answer of the Firestore flag config/flags.alertListBuild (read in core/auth.js's single flags read, kept in alFlagLast
 *   for the NEXT page load). Off by default. Always off for vendors and in the test harnesses.
 *   Switch OFF: every function here returns at once - no timer, no read, no write. */
const OAL_V = 1;                          // rule version: change it when the entry's rule changes, and every entry is rebuilt
const OAL_NODE = 'pt_orderAlerts';
const OAL_LOG_NODE = 'pt_orderAlertsLog';
const OAL_DELAY_MS = 3000;                // a save is worked out this long after it
const OAL_CHECK_MS = 15 * 60 * 1000;      // the full check, and how long one page keeps the lease
const OAL_RETRY_CAP = 300;                // lines kept for another try
const OAL_CHUNK = 400;                    // lines per update when a check has many to fix
const OAL_LOG_CAP = 120;                  // log lines one page writes in a day
const OAL = { dirty: new Set(), timer: 0, retry: {}, retryTimer: 0, retryWait: 30000, last: new Map(), busy: false, skipped: 0, noRead: false,   // noRead: this login may not read the list (before Stage 2's rule), so it never checks
  me: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), logDay: '', logN: 0, okAt: 0 };
/* The registers whose saves can move an order line, and the sales orders (their delivery date). */
const OAL_WATCH = new Set(['pt_orderBook', 'pt_pressInventory', 'pt_qcChecks', 'pt_shopProd', 'pt_baseData', 'pt_baseDone', 'pt_salesOrders']);

/** On or off. Cheap: a couple of storage reads, no network. */
function oalOn() {
  try {
    const s = localStorage.getItem('alertListBuild');
    if (s === '0') return false;
    if (typeof AUDIT === 'undefined' || !AUDIT.on) return false;
    if (typeof spIsVendor === 'function' && spIsVendor()) return false;
    if (typeof NAV_IS_VENDOR !== 'undefined' && NAV_IS_VENDOR) return false;
    if (s === '1') return true;
    return localStorage.getItem('alFlagLast') === '1';
  } catch (e) { return false; }
}
/** Keep the flag's last answer for the next page load. */
function oalSaveFlag(on) {
  try { if (on) localStorage.setItem('alFlagLast', '1'); else localStorage.removeItem('alFlagLast'); } catch (e) { /* no storage: stays off */ }
}

/** The list's key for a line: order number and SKU, with the few characters the database cannot hold in a key made safe. */
const oalKey = (orderNo, sku) => (String(orderNo == null ? '' : orderNo).trim().toUpperCase() + '__' + String(sku == null ? '' : sku).trim().toUpperCase()).replace(/[.#$\[\]\/]/g, '_');

/** Which screen shows the line, and what stage it is at. */
const oalTabOf = l => (l.mto ? 'shopprod' : 'ord');
const oalStageOf = l => (l.pendingCut > 0 ? 'cut' : l.pendingMake > 0 ? 'make' : l.madeToPress > 0 ? 'press' : l.pendingPrint > 0 ? 'print' : 'ship');

/**
 * THE ONE RULE for a line of the strip (today's ticker works it out per line exactly like this, and so does the list).
 * soDue = Order + SKU -> sales order delivery date (ordDueIndex), or null when Sales Orders are not loaded.
 * Returns null for a line that is not open and for a pillow-insert product, which the strip leaves out.
 *   no / sku / ch   order number, SKU, channel code (the order number up to its first dash)
 *   what            name and colour, as the strip prints it
 *   qty / pr / fs   pieces ordered (pack size worked in), pieces pressed or QC'd (a quilt's own counters and pieces taken
 *                   from stock worked in), pieces completed from ready stock
 *   due / dh        due date, and where it came from: 'so' (sales order), 'mto' (5 working days), '' (none)
 *   st / tab / id   stage, the screen that shows the line, the record to open there
 */
function oalEntry(l, soDue) {
  if (!l || !l.open) return null;
  if (typeof shpInsertProduct === 'function' && shpInsertProduct(l.sku)) return null;
  const so = (soDue && soDue.get(l.orderNo + '|' + l.sku)) || '';
  const due = so || l.mtoDue || '';
  return { no: l.orderNo, sku: l.sku, ch: String(l.orderNo).split('-')[0],
    what: [l.articleSubtype || l.itemName || l.articleType, l.color].filter(Boolean).join(' · ') || l.sku,
    qty: +l.qty || 0, pr: +l.pressed || 0, fs: +l.fromStock || 0,
    due, dh: so ? 'so' : l.mtoDue ? 'mto' : '', st: oalStageOf(l), tab: oalTabOf(l), id: oalKey(l.orderNo, l.sku) };
}
/** What makes two entries "the same": every field but the time it was written. */
const oalFp = e => (e ? [e.no, e.sku, e.ch, e.what, e.qty, e.pr, e.fs, e.due, e.dh, e.st, e.tab, e.id].join('|') : '');

/** Every open line as an entry, keyed for the list (this page's copy of the registers and Sales Orders). Never loads anything:
 *  a page that does not already hold the registers gets an empty answer. */
function oalAllEntries() {
  if (typeof ptHas !== 'function' || !ptHas(PTG_ALL)) return new Map();
  const soDue = typeof SOX !== 'undefined' && SOX.rows ? ordDueIndex() : null, out = new Map();
  ordLines().forEach(l => { const e = oalEntry(l, soDue); if (e) out.set(oalKey(e.no, e.sku), e); });
  return out;
}
/** Can this page work lines out? Only when it already holds the registers AND Sales Orders and may read the list. */
function oalReady() {
  if (typeof ptHas !== 'function' || typeof PTG_ALL === 'undefined' || !ptHas(PTG_ALL)) return false;
  if (typeof SOX === 'undefined' || !SOX.rows) return false;
  return typeof otkAllowed !== 'function' || otkAllowed();
}

/* ---- the hook: called by core/history.js after a SUCCESSFUL save. Never throws, never waits, changes nothing. ---- */
function oalRowKey(node, id) {
  const reg = node === 'pt_orderBook' ? 'ob' : node === 'pt_pressInventory' ? 'press' : node === 'pt_qcChecks' ? 'qc' : node === 'pt_baseData' ? 'base' : '';
  if (!reg || typeof ptPeek !== 'function') return '';
  const rows = ptPeek(reg) || [];
  for (let i = 0; i < rows.length; i++) { const r = rows[i]; if (r && r._key === id && r.orderNo && r.sku) return oalKey(r.orderNo, r.sku); }
  return '';
}
/** The list keys of the lines a save touched. A save whose line cannot be told is left to the 15-minute check. */
function oalKeysFor(path, value, kind) {
  const keys = new Set(), pairs = kind === 'patch' ? Object.keys(value || {}).map(k => [k, value[k]]) : [[path, value]];
  pairs.forEach(([p, v]) => {
    const seg = String(p == null ? '' : p).split('/').filter(Boolean), node = seg[0];
    if (!OAL_WATCH.has(node) || seg.length < 2) return;
    if (node === 'pt_salesOrders') {
      if (v && typeof v === 'object' && typeof soLines === 'function') soLines(v).forEach(l => { if (l && l.sku) keys.add(oalKey(seg[1], l.sku)); });
      return;
    }
    if (v && typeof v === 'object' && v.orderNo && v.sku) { keys.add(oalKey(v.orderNo, v.sku)); return; }
    if (node === 'pt_shopProd') { keys.add(oalKey(seg[1].split('__')[0], seg[1].split('__').slice(1).join('__'))); return; }
    const k = oalRowKey(node, seg[1]);
    if (k) keys.add(k);
  });
  return keys;
}
function oalAfterSave(path, value, kind) {
  try {
    if (!oalOn()) return;
    oalKeysFor(path, value, kind).forEach(k => OAL.dirty.add(k));
    if (OAL.dirty.size && !OAL.timer && typeof setTimeout === 'function') OAL.timer = setTimeout(oalFlush, OAL_DELAY_MS);
  } catch (e) { /* a save is never held up, or failed, by the alert list */ }
}

/* ---- writing ---- */
/** The list's own write: a root update that is never itself logged (the same door the change history uses). */
async function oalWrite(updates) {
  const keys = Object.keys(updates);
  for (let i = 0; i < keys.length; i += OAL_CHUNK) {
    const part = {};
    keys.slice(i, i + OAL_CHUNK).forEach(k => { part[k] = updates[k]; });
    await ptAuditWrite(part);
  }
}
const oalPutEntry = e => (e ? Object.assign({}, e, { at: Date.now() }) : null);
/** Lines a write could not carry, kept for another try. */
function oalKeep(updates) {
  Object.keys(updates).forEach(p => { if (p.indexOf(OAL_NODE + '/l/') === 0) OAL.retry[p] = updates[p]; });
  const ks = Object.keys(OAL.retry);
  if (ks.length > OAL_RETRY_CAP) ks.slice(0, ks.length - OAL_RETRY_CAP).forEach(k => { delete OAL.retry[k]; });   // the check repairs what is dropped
  try { localStorage.setItem('oalRetry', JSON.stringify(OAL.retry)); } catch (e) { /* kept in memory only */ }
  if (!OAL.retryTimer && typeof setTimeout === 'function') OAL.retryTimer = setTimeout(oalRetryNow, OAL.retryWait);
}
function oalKept() {
  const had = OAL.retry; OAL.retry = {};
  try { localStorage.removeItem('oalRetry'); } catch (e) { /* nothing to clear */ }
  return had;
}
async function oalRetryNow() {
  OAL.retryTimer = 0;
  if (!oalOn() || !Object.keys(OAL.retry).length) return;
  const up = oalKept(), wait = OAL.retryWait;
  try { await oalWrite(up); OAL.retryWait = 30000; }
  catch (e) { OAL.retryWait = Math.min(wait * 2, 5 * 60 * 1000); oalKeep(up); }
}

/** About 3 seconds after a save: work the touched lines out again and write only those that changed, in ONE update. */
async function oalFlush() {
  OAL.timer = 0;
  const keys = [...OAL.dirty]; OAL.dirty.clear();
  if (!oalOn()) return;
  const up = {};
  try {
    if (keys.length) {
      if (!oalReady()) OAL.skipped += keys.length;       // the 15-minute check on a page that holds everything sets it right
      else {
        const all = oalAllEntries();
        keys.forEach(k => {
          const e = all.get(k) || null, fp = oalFp(e);
          if (OAL.last.has(k) && OAL.last.get(k) === fp) return;
          up[OAL_NODE + '/l/' + k] = oalPutEntry(e);
        });
      }
    }
    Object.assign(up, oalKept());                          // lines that could not be written before go in the same update
    if (!Object.keys(up).length) return;
  } catch (e) { return; }
  try {
    await oalWrite(up);
    OAL.retryWait = 30000;
    Object.keys(up).forEach(p => { const k = p.slice((OAL_NODE + '/l/').length); OAL.last.set(k, oalFp(up[p])); });
    if (typeof otkOwnWrite === 'function') otkOwnWrite(up);   // this page's own strip moves at once, without waiting for the live copy
  } catch (e) { oalKeep(up); }
}

/* ---- the log: a few small lines, capped ---- */
function oalLog(rec) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    if (OAL.logDay !== day) { OAL.logDay = day; OAL.logN = 0; }
    if (OAL.logN >= OAL_LOG_CAP) return;
    OAL.logN++;
    const who = (typeof ME !== 'undefined' && ME && ME.email) || '';
    ptAuditWrite({ [OAL_LOG_NODE + '/' + day + '/' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)]:
      Object.assign({ at: new Date().toISOString(), by: String(who).split('@')[0], page: OAL.me, v: OAL_V }, rec) }).catch(() => {});
  } catch (e) { /* the log is never in the way */ }
}

/* ---- the lease: one page does the 15-minute check ---- */
async function oalLease() {
  const cur = await ptGetFresh(OAL_NODE + '/lease'), now = Date.now();
  if (cur && cur.until > now && cur.by !== OAL.me) return false;
  return (await ptCas(OAL_NODE + '/lease', cur == null ? null : cur, { by: OAL.me, until: now + OAL_CHECK_MS })) === '';
}

/** The strip's items as comparable text (order of equal lines does not matter). */
const oalItemsText = items => items.map(x => [x.kind, x.tag || '', x.txt, x.sub || ''].join('~')).sort().join('\n');

/** Write the whole list again (a new rule version, or a list that is not there). */
async function oalRebuild(mine) {
  const l = {};
  mine.forEach((e, k) => { l[k] = oalPutEntry(e); });
  await oalWrite({ [OAL_NODE + '/l']: l, [OAL_NODE + '/v']: OAL_V, [OAL_NODE + '/at']: { '.sv': 'timestamp' } });
  OAL.last = new Map([...mine].map(([k, e]) => [k, oalFp(e)]));
  return mine.size;
}

/** The full check. Reads the list (and its version) once; writes only what differs; logs what it found. */
async function oalCheck() {
  if (!oalOn() || OAL.busy || OAL.noRead || !oalReady()) return;
  OAL.busy = true;
  const t0 = Date.now();
  try {
    if (!(await oalLease())) return;
    const mine = oalAllEntries();
    const ver = await ptGetFresh(OAL_NODE + '/v');
    if (ver !== OAL_V) {
      const n = await oalRebuild(mine);
      oalLog({ kind: 'rebuild', lines: n, was: ver == null ? null : ver, ms: Date.now() - t0 });
      return;
    }
    const stored = (await ptGetFresh(OAL_NODE + '/l')) || {};
    let missing = 0, extra = 0, changed = 0;
    const up = {}, sample = [];
    mine.forEach((e, k) => {
      const s = stored[k];
      if (!s) { missing++; if (sample.length < 5) sample.push('+' + k); up[OAL_NODE + '/l/' + k] = oalPutEntry(e); }
      else if (oalFp(s) !== oalFp(e)) { changed++; if (sample.length < 5) sample.push('~' + k); up[OAL_NODE + '/l/' + k] = oalPutEntry(e); }
    });
    Object.keys(stored).forEach(k => { if (!mine.has(k)) { extra++; if (sample.length < 5) sample.push('-' + k); up[OAL_NODE + '/l/' + k] = null; } });
    /* The shadow comparison: the strip worked out from the list as it stood, against today's strip from the registers. */
    const today = dToday();
    const fromRegs = oalItemsText(otkItemsFrom([...mine.values()], today));
    const fromList = oalItemsText(otkItemsFrom(Object.keys(stored).map(k => stored[k]).filter(Boolean), today));
    const same = fromRegs === fromList;
    up[OAL_NODE + '/at'] = { '.sv': 'timestamp' };
    await oalWrite(up);
    mine.forEach((e, k) => { OAL.last.set(k, oalFp(e)); });
    const diff = missing + extra + changed;
    /* Quiet when all is well: a line at most once an hour. A difference is always logged. */
    if (diff || !same || Date.now() - OAL.okAt > 60 * 60 * 1000) {
      OAL.okAt = Date.now();
      oalLog({ kind: 'check', lines: mine.size, missing, extra, changed, same, sample, skipped: OAL.skipped, ms: Date.now() - t0 });
    }
  } catch (e) {
    /* A refused read (a login that may not read the list yet) is not an error worth a log line every 15 minutes: stop checking. */
    if (/\b40[13]\b|refused the read/.test(String((e && e.message) || e))) { OAL.noRead = true; return; }
    oalLog({ kind: 'error', msg: String((e && e.message) || e).slice(0, 120) });
  } finally { OAL.busy = false; }
}

/* Not in the test harnesses, which have no real page; and nothing at all with the switch off. */
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && typeof setInterval === 'function' && oalOn()) {
  try { const r = JSON.parse(localStorage.getItem('oalRetry') || 'null'); if (r && typeof r === 'object') OAL.retry = r; } catch (e) { /* none kept */ }
  setTimeout(oalCheck, 90000); setInterval(oalCheck, OAL_CHECK_MS);
  if (Object.keys(OAL.retry).length) OAL.retryTimer = setTimeout(oalRetryNow, 20000);
}
