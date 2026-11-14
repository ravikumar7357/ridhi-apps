/* ================= LIVE MIRROR · every Sellora save also goes to the new database (Ravi, 14 Nov 2026) =================
 *
 * The same live mirror the factory ERP has (Replenish-App core/mirror.js), for Sellora's Firestore saves: each save goes to
 * Firestore AND to the new database (Supabase, project ERP TEST, door core.mirror) at the same moment. The door applies it
 * at once, so the Supabase tables are right a fraction of a second after the save. The screen still waits only for
 * Firestore; the mirror is never waited for, never throws and never stops a save.
 *
 * Firestore says no (no right, no network): the mirror already has the change, so it is put right at once with the
 * document as Firestore really holds it (fsMirrorFix). Not sent (no network, Supabase asleep) → kept in this browser
 * (localStorage) and sent again every 30 s, after the next save, and when Sellora is opened again. Anything still missed is
 * found by the nightly check against the backup.
 *
 * Who: the person signed in. Supabase checks their Firebase sign-in itself and takes it only from an R-one person.
 *
 * ON: localhost and Sellora's test links (price-research-48ff3--<name>.web.app) now; the real Sellora only once MIR_LIVE is
 * true (Ravi's yes). The test ERP (saving off) sends nothing early.
 * Used by every Sellora screen that saves to Firestore: fsSetDoc / fsDeleteDoc in place of setDoc / deleteDoc.
 * Remove this file, its line in ORDER, and turn fsSetDoc / fsDeleteDoc back into setDoc / deleteDoc: nothing of it is left.
 */
const MIR_LIVE = false;
const MIR = {
  on: typeof window !== 'undefined' && (MIR_LIVE || !!window.__TEST_ERP || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
      || /^price-research-48ff3--[a-z0-9-]+\.web\.app$/.test(location.hostname)),
  early: typeof window !== 'undefined' && !window.__TEST_ERP,      // sent with the save itself (not on the test ERP: saving is off there)
  url: 'https://eaklutqgopejtnxacamd.supabase.co',          // ERP TEST in Mumbai
  key: 'sb_publishable_ybYG7Y1iAZerulnwWREWaw_EzubVDPT',   // its publishable key (made for browsers; opens only the doors)
  store: 'r1.sellora.mirror.queue', q: [], busy: false, timer: null, refused: false, sent: 0, lastError: '',
};

/** A Firestore value as plain JSON: server time → now, a date → its ISO text. */
function mirPlain(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(mirPlain);
  if (typeof v === 'object') {
    const n = v.constructor && v.constructor.name;
    if (typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch (e) { return null; } }   // a Firestore Timestamp
    if (n && n !== 'Object') return v._methodName || /Timestamp|FieldValue|Sentinel/i.test(n) ? new Date().toISOString() : String(v);   // serverTimestamp()
    const o = {}; for (const k of Object.keys(v)) o[k] = mirPlain(v[k]); return o;
  }
  return v;
}
function mirSave() { try { localStorage.setItem(MIR.store, JSON.stringify(MIR.q)); } catch (e) { /* too big or no storage: kept in memory only */ } }
/* Sent almost at once: 25 ms, so the writes of one click travel together. */
function mirSoon(ms) { if (MIR.timer) return; MIR.timer = setTimeout(() => { MIR.timer = null; mirFlush(); }, ms == null ? 25 : ms); }

/** A Firestore save. kind: put · merge · delete; path: "audit/deals". */
function fsMirror(kind, path, data) {
  try {
    if (!MIR.on || MIR.refused || !path) return;
    const base = 'fs/' + String(path || '').replace(/^\/+/, ''), t = new Date().toISOString();
    if (kind === 'delete') MIR.q.push({ k: 'delete', p: base, v: null, t });
    else if (kind === 'merge') {
      /* setDoc(…, { merge: true }): Firestore merges maps inside maps too, so each leaf is its own change. A list is one value. */
      const out = [];
      const leaves = (o, pre) => { for (const k of Object.keys(o)) { const v = o[k], p = pre + '/' + k;
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v.constructor && v.constructor.name !== 'Object') && Object.keys(v).length) leaves(v, p);
        else out.push([p, v && v._methodName === 'deleteField' ? null : mirPlain(v)]); } };
      if (data && typeof data === 'object') leaves(data, base);
      for (const [p, v] of out) MIR.q.push({ k: 'patch', p, v, t });
    } else MIR.q.push({ k: 'put', p: base, v: mirPlain(data), t });
    mirSave(); mirSoon();
  } catch (e) { /* never in the way of the save */ }
}
/** Firestore did not take a save the mirror already has: the document as Firestore really holds it goes to the mirror. */
function fsMirrorFix(ref, tries) {
  try {
    if (!ref || !ref.path || !MIR.on || MIR.refused) return;
    getDoc(ref).then(s => {
      const p = 'fs/' + ref.path, t = new Date().toISOString();
      MIR.q.push(s.exists() ? { k: 'put', p, v: mirPlain(s.data()), t } : { k: 'delete', p, v: null, t });
      mirSave(); mirSoon();
    }).catch(() => { if ((tries || 0) < 20) setTimeout(() => fsMirrorFix(ref, (tries || 0) + 1), 30000); });
  } catch (e) { /* never throws */ }
}
/* Firestore saves that also go to the mirror: the same call as Firestore's own (same answer, same errors). */
async function fsSetDoc(ref, data, opts) {
  const kind = opts && opts.merge ? 'merge' : 'put';
  if (MIR.on && MIR.early) {
    fsMirror(kind, ref && ref.path, data);
    try { return opts === undefined ? await setDoc(ref, data) : await setDoc(ref, data, opts); } catch (e) { fsMirrorFix(ref); throw e; }
  }
  const r = opts === undefined ? await setDoc(ref, data) : await setDoc(ref, data, opts);
  fsMirror(kind, ref && ref.path, data);
  return r;
}
async function fsAddDoc(col, data) {
  if (MIR.on && MIR.early) {                  // the new document's id is made here (as addDoc itself does), so it is sent at once
    const ref = doc(col);
    fsMirror('put', ref.path, data);
    try { await setDoc(ref, data); } catch (e) { fsMirrorFix(ref); throw e; }
    return ref;
  }
  const ref = await addDoc(col, data);
  if (ref && ref.path) fsMirror('put', ref.path, data);
  return ref;
}
async function fsDeleteDoc(ref) {
  if (MIR.on && MIR.early) {
    fsMirror('delete', ref && ref.path);
    try { return await deleteDoc(ref); } catch (e) { fsMirrorFix(ref); throw e; }
  }
  const r = await deleteDoc(ref);
  fsMirror('delete', ref && ref.path);
  return r;
}

async function mirFlush() {
  if (MIR.busy || !MIR.q.length || !MIR.on || MIR.refused) return;
  const user = typeof auth !== 'undefined' && auth && auth.currentUser;
  if (!user) return mirSoon(30000);
  MIR.busy = true;
  try {
    const token = await user.getIdToken();
    while (MIR.q.length) {
      let n = 0, size = 0;
      while (n < MIR.q.length && n < 500) { const s = JSON.stringify(MIR.q[n]).length; if (n && size + s > 3e6) break; size += s; n++; }
      const r = await fetch(MIR.url + '/rest/v1/rpc/mirror', {
        method: 'POST',
        headers: { apikey: MIR.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Profile': 'core', 'Accept-Profile': 'core' },
        body: JSON.stringify({ p_changes: MIR.q.slice(0, n), p_screen: 'sellora ' + String((typeof location !== 'undefined' && location.hash) || '').slice(1, 60) }),
      });
      if (r.ok) { MIR.q.splice(0, n); MIR.sent += n; mirSave(); continue; }
      const txt = await r.text();
      if (/not an ERP sign-in/.test(txt)) { MIR.refused = true; MIR.q = []; mirSave(); break; }   // not an R-one person: not sent at all
      throw new Error(r.status + ' ' + txt.slice(0, 120));
    }
    MIR.lastError = '';
  } catch (e) {
    MIR.lastError = String((e && e.message) || e);
    mirSoon(30000);                                          // asked again in 30 s; the queue is kept in this browser
  } finally {
    MIR.busy = false;
    if (MIR.q.length && !MIR.lastError && !MIR.refused) mirSoon();
  }
}
/* What was not sent last time (the tab was closed, no network) goes out once someone is signed in. */
if (MIR.on) {
  try { const old = JSON.parse(localStorage.getItem(MIR.store) || '[]'); if (Array.isArray(old) && old.length) { MIR.q = old.concat(MIR.q); mirSoon(8000); } } catch (e) { /* nothing kept */ }
}
/* ================= END LIVE MIRROR ================= */
