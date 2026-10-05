
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
    /* NINE: the QC checks joined on 2026-10-05 — a QC pass is what "made" means now. Its own catch: an account that may
     * not read them still gets the other eight, and made falls back to the old press entries. */
    const [masters, mdb, ob, press, freeze, cut, base, shopProd, qcChecks] = await Promise.all([
      keepMdb ? Promise.resolve(PTG.masters) : ptGet('pt_masters'), keepMdb ? Promise.resolve(null) : ptGet('pt_masterDB'), ptGet('pt_orderBook'),
      ptGet('pt_pressInventory'), ptGet('pt_cuttingFreezes'), ptGet('pt_cuttingData'), ptGet('pt_baseData'),
      ptGet('pt_shopProd'), ptGet('pt_qcChecks').catch(() => null),
    ]);
    PTG.shopProd = shopProd || {};
    PTG.qc = qcChecks ? ptList(qcChecks) : (PTG.qc || []);
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

