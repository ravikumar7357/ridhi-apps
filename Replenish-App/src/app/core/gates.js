
/* ---- the data the gates are measured against ---- */
let PTG = { masters: null, mdb: null, ob: null, press: null, freeze: null, err: '', busy: false, at: 0 };

/** How long a read of somebody else's work stays worth trusting on a screen you have just opened. */
/* TEN MINUTES, NOT TWO (2026-09-27). The project is on the free Spark plan — 10 GB a month of database downloads — and
 * the month had already used 19.4 GB, 1.5 to 3.4 GB a day, most of it these eight registers (7.1 MB) read again every
 * time somebody came back to a factory screen after two minutes. The master database and the masters (2.2 MB of it)
 * change rarely and are re-read on a background refresh only every half hour; Master DB's own Refresh reads them at once. */
const PTG_STALE_MS = 10 * 60 * 1000;
const PTG_MDB_STALE_MS = 30 * 60 * 1000;

/* ---- PAGE REGISTERS (Step 3 of docs/data-reduction/PLAN.md; plan in STEP3-PLAN.md) ----
 * A screen asks for the registers it needs by SET: the master set (masters + master database, ~2.2 MB) or the whole set
 * (all nine, ~11 MB). Every screen asks for the whole set for now, so the switch changes nothing yet.
 *   - Switch: localStorage pageRegisters '0' = off on this device whatever the flag says, '1' = on, otherwise the last
 *     answer of the Firestore flag config/flags.pageRegisters (read in the same single read core/auth.js already makes,
 *     kept in prFlagLast for the NEXT page load). Off by default. Always off for vendors.
 *   - Switch OFF: ptNeed is ptLoadGates exactly as before — the same nine reads in the same order. */
const PTG_REGS = ['masters', 'mdb', 'ob', 'press', 'freeze', 'cut', 'base', 'shopProd', 'qc'];
const PTG_MASTER = ['masters', 'mdb'];
const PTG_ALL = PTG_REGS.slice();
/* When each register was read. Written by the loader below and nowhere else. */
const PTG_AT = {};
/* The read of each register that is under way — a second ask for the same register waits for it instead of reading again. */
const PTG_FLY = {};
/* Switch on: what went wrong with each register's last read, kept apart so one screen's failed read is not wiped by another
 * screen's ask. PTG.err (what screens test) is set from the registers of the set a screen asked for. */
const PTG_ERR = {};
let PTG_IMG_DONE = false;

/** On or off. Cheap: a couple of storage reads, no network. */
function prOn() {
  try {
    const s = localStorage.getItem('pageRegisters');
    if (s === '0') return false;
    if (typeof AUDIT === 'undefined' || !AUDIT.on) return false;
    if (typeof spIsVendor === 'function' && spIsVendor()) return false;
    if (s === '1') return true;
    return localStorage.getItem('prFlagLast') === '1';
  } catch (e) { return false; }
}
/** Does this device ask for the page registers at all? Storage only, so it is safe at page load. (prOn also asks who is signed in,
 *  and the vendor portal's VP is not declared yet while this file loads: asking it there threw, was swallowed as "off", and the
 *  guard below was never installed on the real page. The guard's getters ask prOn() again each time they are read.) */
function prWanted() {
  /* A vendor, where that is already known, never gets it; at page load it is not known yet (the call throws) and the getters decide later. */
  try { if (typeof spIsVendor === 'function' && spIsVendor()) return false; } catch (e) { /* not known yet */ }
  try { const s = localStorage.getItem('pageRegisters'); return s === '1' || (s !== '0' && localStorage.getItem('prFlagLast') === '1'); } catch (e) { return false; }
}
/** Keep the flag's last answer for the next page load. */
function prSaveFlag(on) {
  try { if (on) localStorage.setItem('prFlagLast', '1'); else localStorage.removeItem('prFlagLast'); } catch (e) { /* no storage: stays off */ }
}

/** Where a register's value lives: Job Work + cutting and the base data sit on PT, the rest on PTG. Reads the value without
 *  raising the undeclared-read guard below (the loader and every "is it there?" check use this). */
const ptRegVal = r => ptPeek(r);
const ptPeek = r => (r === 'cut' ? PT.cut : r === 'base' ? PT.base : PR_GUARDED ? PR_VAL[r] : PTG[r]);
/** A register counts as loaded when the loader stamped it AND its value is still there (Master DB Refresh clears values). */
const ptRegLoaded = r => !!PTG_AT[r] && ptRegVal(r) != null;
const ptRegLimit = (r, light) => (light && (r === 'masters' || r === 'mdb') ? PTG_MDB_STALE_MS : PTG_STALE_MS);

/** True when every register in the set is loaded. Switch off: the order book is there, as before. */
function ptHas(set) {
  if (!prOn()) return !!PTG.ob;
  return (set || PTG_ALL).every(ptRegLoaded);
}
/** True when something in the set is missing. Switch off, "missing" means the fields the caller used to test (has: 'mdb' or
 *  ['mdb', 'press', 'base']), so a screen that tested one field still tests that one. */
function ptLack(set, has) {
  if (prOn()) return !ptHas(set);
  return !(Array.isArray(has) ? has : [has || 'mdb']).every(h => !!ptRegVal(h));
}
/** The refusal a save gives when the registers it reads from are not all in yet (switch on only); '' otherwise. */
const ptStillReading = () => (prOn() && !ptHas(PTG_ALL) ? 'Still reading the order book, try again in a moment.' : '');

function ptGatesStale(set, light) {
  if (!prOn()) return !PTG.at || Date.now() - PTG.at > PTG_STALE_MS;
  return (set || PTG_ALL).some(r => !ptRegLoaded(r) || Date.now() - PTG_AT[r] > ptRegLimit(r, light));
}

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
function ptOpenFresh(tab, ensure, set) {
  if (prOn()) {
    /* A screen that names no set wants the whole set. */
    const want = set || PTG_ALL;
    if (!ptHas(want) || !ptGatesStale(want, true)) return ensure();
    ensure();
    ptNeed(want, { force: true, light: true, why: tab }).then(() => { if (TAB_NOW === tab) ensure(); }).catch(() => { /* the screen already shows what it had */ });
    return;
  }
  const stale = ptGatesStale();
  if (!PTG.mdb || !stale) return ensure();
  ensure();
  ptLoadGates(true, true).then(() => { if (TAB_NOW === tab) ensure(); }).catch(() => { /* the screen already shows what it had */ });
}

/* A READ ALREADY UNDER WAY IS WAITED FOR, not skipped (2026-09-25). Returning at once let the Master Database —
 * and any screen that awaited this — carry on with nothing loaded yet and say the database was empty. */
function ptLoadGates(force, light) {
  /* Switch on: any caller that has not been given a set yet still gets everything. */
  if (prOn()) return ptNeedRun(PTG_ALL, !!force, !!light);
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
    /* NINE: the QC checks joined on 2026-10-05 — a QC pass is what "made" means now. Its own catch: an account that may
     * not read them still gets the other eight, and made falls back to the old press entries. */
    const [masters, mdb, ob, press, freeze, cut, base, shopProd, qcChecks] = await Promise.all([
      keepMdb ? Promise.resolve(PTG.masters) : ptGet('pt_masters'), keepMdb ? Promise.resolve(null) : ptGet('pt_masterDB'), ptGet('pt_orderBook'),
      ptGet('pt_pressInventory'), ptGet('pt_cuttingFreezes'), ptGet('pt_cuttingData'), ptGet('pt_baseData'),
      ptGet('pt_shopProd'), ptGet('pt_qcChecks').catch(() => null),
      /* The pictures already looked up, read with the rest instead of after them. Read here so EVERY screen starts
       * knowing them — it was read by the Vendor Portal alone, which is why every other screen asked Amazon again
       * from scratch. A nicety, never a blocker: its failure is swallowed. */
      ptImgShared().catch(() => {}),
    ]);
    PTG.shopProd = shopProd || {};
    PTG.qc = qcChecks ? ptList(qcChecks) : (PTG.qc || []);
    if (!keepMdb) {
      PTG.masters = masters || {};
      PTG.recipeAt = Date.now();
      PTG.mdb = ptList(mdb).map(mdbYnFix);
      PTG.mdbAt = Date.now();
      /* Replenishment shows the master's product details (18 Oct): a fresh master is put on its rows at once. */
      if (typeof replMasterSync === 'function') { try { replMasterSync(); } catch (e) { /* the snapshot's details stay */ } }
    }
    PTG.ob = ptList(ob);
    PTG.press = ptList(press);
    PTG.freeze = freeze || {};
    PT.cut = ptList(cut); PT.at.cut = ptStamp();
    PT.base = ptList(base); PT.at.base = ptStamp();
  } catch (e) {
    PTG.err = e.message || String(e);
  }
  PTG.busy = false;
  /* When this data was true. Screens opened later decide from it whether to read again. */
  PTG.at = Date.now();
  /* Delta sync, phase 2: once a page session, the background comparison (core/delta-sync.js). Changes nothing here. */
  if (!PTG.err && typeof deltaShadowSoon === 'function') deltaShadowSoon();
}

/**
 * ASK FOR A SET OF REGISTERS. opt: { force, light, why, has, note }.
 *   Switch off: exactly ptLoadGates(force, light) — has (the field a caller used to test, or a list of them) keeps the old
 *   "only when it is not there" test, note (a message shown while reading) is shown only when a read is going to happen.
 *   Switch on: reads only the registers of the set that are missing (force: those over ten minutes old, or over thirty
 *   for the master on a light refresh; force without light: all of them), in parallel, one read per register at a time.
 * Never rejects: a register that fails stays unloaded, the others still land, PTG.err says what went wrong.
 */
function ptNeed(set, opt) {
  const o = typeof opt === 'string' ? { why: opt } : (opt || {});
  if (!prOn()) {
    if (!o.force && o.has !== undefined && !ptLack(set, o.has)) return Promise.resolve();
    if (typeof o.note === 'function') o.note();
    return ptLoadGates(o.force, o.light);
  }
  const want = set || PTG_ALL;
  if (typeof o.note === 'function' && (o.force || !ptHas(want))) o.note();
  return ptNeedRun(want, !!o.force, !!o.light);
}

/** One register's read, stored the way ptLoadGatesRun stores it. */
async function ptReadReg(r) {
  switch (r) {
    case 'masters': PTG.masters = (await ptGet('pt_masters')) || {}; PTG.recipeAt = Date.now(); ptMasterLanded(); break;
    case 'mdb':
      PTG.mdb = ptList(await ptGet('pt_masterDB')).map(mdbYnFix); PTG.mdbAt = Date.now(); ptMasterLanded();
      /* The pictures already looked up: read once, with the first load that includes the master database. */
      if (!PTG_IMG_DONE) { PTG_IMG_DONE = true; try { await ptImgShared(); } catch (e) { /* pictures are a nicety, never a blocker */ } }
      break;
    case 'ob': PTG.ob = ptList(await ptGet('pt_orderBook')); break;
    case 'press': PTG.press = ptList(await ptGet('pt_pressInventory')); break;
    case 'freeze': PTG.freeze = (await ptGet('pt_cuttingFreezes')) || {}; break;
    case 'cut': PT.cut = ptList(await ptGet('pt_cuttingData')); PT.at.cut = ptStamp(); break;
    case 'base': PT.base = ptList(await ptGet('pt_baseData')); PT.at.base = ptStamp(); break;
    case 'shopProd': PTG.shopProd = (await ptGet('pt_shopProd')) || {}; break;
    /* QC checks have their own catch: an account that may not read them still gets the rest, and made falls back to the old press entries. */
    case 'qc': { const q = await ptGet('pt_qcChecks').catch(() => null); PTG.qc = q ? ptList(q) : (ptPeek('qc') || []); break; }
  }
}
/** Replenishment shows the master's product details: put a fresh master on its rows once both halves are in. */
function ptMasterLanded() {
  if (ptPeek('masters') && ptPeek('mdb') && typeof replMasterSync === 'function') { try { replMasterSync(); } catch (e) { /* the snapshot's details stay */ } }
}
function ptNeedRun(set, force, light) {
  const due = set.filter(r => !ptRegLoaded(r) || (force && (!light || Date.now() - PTG_AT[r] > ptRegLimit(r, true))));
  if (!due.length) return Promise.resolve();
  PTG.busy = true;
  const jobs = due.map(r => {
    if (PTG_FLY[r]) return PTG_FLY[r];
    delete PTG_ERR[r];
    const p = ptReadReg(r).then(() => { PTG_AT[r] = Date.now(); delete PTG_ERR[r]; }, e => { PTG_ERR[r] = e.message || String(e); }).then(() => { delete PTG_FLY[r]; });
    PTG_FLY[r] = p;
    return p;
  });
  return Promise.all(jobs).then(() => {
    /* What a screen sees in PTG.err is the failure of a register IT asked for. Another screen's read going wrong stays in
     * PTG_ERR under its own register and is not wiped by this ask. */
    PTG.err = set.map(r => PTG_ERR[r]).find(Boolean) || '';
    PTG.busy = Object.keys(PTG_FLY).length > 0;
    /* PTG.at: when the oldest register was read, once all nine are in. */
    PTG.at = PTG_REGS.every(ptRegLoaded) ? Math.min(...PTG_REGS.map(r => PTG_AT[r])) : 0;
    /* Delta sync, phase 2: only once everything is loaded (core/delta-sync.js). Changes nothing here. */
    if (!PTG.err && PTG.at && typeof deltaShadowSoon === 'function') deltaShadowSoon();
  });
}

/* ---- PAGE REGISTERS: THE RUNTIME GUARD (Step 3, Part B; switch on only) ----
 * A screen asks for the registers it needs (ptNeed). If it reads one it did not ask for, the page would quietly show a short
 * list. With the switch on at page start, the registers become fields with a getter: reading one that is NOT loaded writes one
 * warning line per screen and register, counts it for the data meter, starts reading it in the background and, when it lands,
 * draws the screen again if you are still on it. Honest limit: a screen already drawn may show a short list for about a second.
 * What the guard never does: store a value differently (the setter keeps exactly what it is given), mark a register loaded
 * (only the loader in ptNeedRun does), or fire on the loader's own reads and on "is it there?" checks (ptHas, ptLack, ptPeek).
 * Only the PTG fields are guarded. PT.cut and PT.base are not: Job Work, Cutting, the Store and HR test them for "not loaded yet" and read
 * them with their own loader (ptLoad), so a getter there would cry wolf on screens that are doing nothing wrong; the static test in
 * tests/page-registers-test.js is what covers them.
 * With the switch off at page start nothing is installed: PTG stays the plain object it always was. */
const PR_UNDECLARED = {};
const PR_VAL = {};
let PR_GUARDED = false;
const PR_NAMES = { masters: 'the masters', mdb: 'the master database', ob: 'the order book', press: 'the press register', freeze: 'the cutting freezes',
  cut: 'the cutting register', base: 'the Job Work register', shopProd: 'Shopify production', qc: 'the QC checks' };
function prUndeclared(reg) {
  try {
    if (!prOn()) return;
    let page = '(start)';
    try { page = (typeof TAB_NOW !== 'undefined' && TAB_NOW) || '(start)'; } catch (e) { /* the page is still starting up */ }
    const key = page + '|' + reg;
    PR_UNDECLARED[key] = (PR_UNDECLARED[key] || 0) + 1;
    if (PR_UNDECLARED[key] > 1) return;
    console.warn('Page registers: the "' + page + '" screen read ' + (PR_NAMES[reg] || reg) + ' before it was loaded. It is being read now and the screen will be drawn again. '
      + 'Tell the builder so this screen can ask for it when it opens.');
    if (typeof dmCount === 'function') dmCount('undeclared_' + reg, 0, 'undeclared');
    /* The seven order registers only ever load together (the line builders need all of them); the master pair loads on its own. */
    const want = PTG_MASTER.indexOf(reg) >= 0 ? PTG_MASTER : PTG_ALL;
    ptNeed(want, { why: 'undeclared ' + page }).then(() => {
      if (!ptHas(want)) return;
      let still = false;
      try { still = TAB_NOW === page; } catch (e) { /* nothing to redraw */ }
      if (still && typeof showTab === 'function') showTab(page);
    }, () => { /* the next ask for it tries again */ });
  } catch (e) { /* a guard that fails leaves the read exactly as it was */ }
}
function prGuardInstall() {
  if (PR_GUARDED) return;
  const hold = (obj, key, reg) => {
    PR_VAL[reg] = obj[key];
    Object.defineProperty(obj, key, { enumerable: true, configurable: true,
      get() { const v = PR_VAL[reg]; if (v == null) prUndeclared(reg); return v; },
      set(v) { PR_VAL[reg] = v; } });
  };
  ['masters', 'mdb', 'ob', 'press', 'freeze', 'shopProd', 'qc'].forEach(r => hold(PTG, r, r));
  PR_GUARDED = true;
}
if (prWanted() && typeof AUDIT !== 'undefined' && AUDIT.on) prGuardInstall();

const obUC = s => String(s == null ? '' : s).trim().toUpperCase();

