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
