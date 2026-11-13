/* ================= LIVE MIRROR · every save also goes to the new database (Ravi, 12 Nov 2026) =================
 *
 * Firebase saves first, exactly as before, and the screen waits only for that. AFTER a save has worked, the same change
 * (the path and the value, as written) is queued here and sent to the new database (Supabase, project ERP TEST, door
 * core.mirror) about a second later, many saves together. It is never waited for, never throws and never stops a save.
 *
 * Not sent (no network, Supabase asleep) → kept in this browser (localStorage) and sent again: every 30 s, after the next
 * save, and when the ERP is opened again. Anything still missed is found by the nightly check against the backup.
 *
 * Who: the person signed in. Supabase checks their Firebase sign-in itself and takes it only from an ERP person; a vendor
 * login is not one, so a vendor's saves are not sent (the nightly check brings them over).
 *
 * ON: the test ERP and localhost now. The real ERP only once MIR_LIVE is true (Ravi + sir, step 4).
 * Where it is called: core/history.js (ptPut, ptCas, ptPatch, ptDelete — every save to the production database) and the
 * Firestore saves of the lists already moved (Amazon POs, packing lists).
 * Remove this file, its line in ORDER and the one-line calls, and nothing of it is left.
 */
const MIR_LIVE = false;
const MIR = {
  on: typeof window !== 'undefined' && (MIR_LIVE || !!window.__TEST_ERP || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)),
  url: 'https://eaklutqgopejtnxacamd.supabase.co',          // ERP TEST in Mumbai
  key: 'sb_publishable_ybYG7Y1iAZerulnwWREWaw_EzubVDPT',   // its publishable key (made for browsers; opens only the doors)
  store: 'r1.mirror.queue', q: [], busy: false, timer: null, refused: false, sent: 0, lastError: '',
};
/* Lists that are bookkeeping, not data: never sent. The log (pt_audit) and the recycle bin (pt_trash) ARE sent (13 Nov):
 * they are data — Supabase keeps them in schema history. */
const MIR_SKIP = /^pt_(sync|syncAudit|dataMeter|flowRev)(\/|$)/;

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
function mirSoon(ms) { if (MIR.timer) return; MIR.timer = setTimeout(() => { MIR.timer = null; mirFlush(); }, ms == null ? 1000 : ms); }

/** Called after a production-database save worked. kind: put · patch · delete; updates: { path: value written }. */
function ptMirror(kind, updates) {
  try {
    if (!MIR.on || MIR.refused) return;
    const t = new Date().toISOString();
    for (const p of Object.keys(updates || {})) {
      const path = String(p).replace(/^\/+|\/+$/g, '');
      if (!path || MIR_SKIP.test(path)) continue;
      const v = updates[p];
      MIR.q.push({ k: kind === 'delete' || v === null ? (kind === 'patch' ? 'patch' : 'delete') : kind, p: path, v: v === undefined ? null : v, t });
    }
    mirSave(); mirSoon();
  } catch (e) { /* never in the way of the save */ }
}
/** Called after a Firestore save of a moved list worked. kind: put · merge · delete; path: "po/<id>". */
function fsMirror(kind, path, data) {
  try {
    if (!MIR.on || MIR.refused) return;
    const base = 'fs/' + String(path || '').replace(/^\/+/, ''), t = new Date().toISOString();
    if (kind === 'delete') MIR.q.push({ k: 'delete', p: base, v: null, t });
    else if (kind === 'merge') {
      /* setDoc(…, { merge: true }): only the fields given change — each top-level field as its own change */
      const d = mirPlain(data) || {};
      for (const f of Object.keys(d)) MIR.q.push({ k: 'patch', p: base + '/' + f, v: d[f], t });
    } else MIR.q.push({ k: 'put', p: base, v: mirPlain(data), t });
    mirSave(); mirSoon();
  } catch (e) { /* never in the way of the save */ }
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
        body: JSON.stringify({ p_changes: MIR.q.slice(0, n), p_screen: (typeof TAB_NOW !== 'undefined' && TAB_NOW) || '' }),
      });
      if (r.ok) { MIR.q.splice(0, n); MIR.sent += n; mirSave(); continue; }
      const txt = await r.text();
      if (/not an ERP sign-in/.test(txt)) { MIR.refused = true; MIR.q = []; mirSave(); break; }   // a vendor login: not sent at all
      throw new Error(r.status + ' ' + txt.slice(0, 120));
    }
    MIR.lastError = '';
  } catch (e) {
    MIR.lastError = String((e && e.message) || e);
    mirSoon(30000);                                          // asked again in 30 s; the queue is kept in this browser
  } finally { MIR.busy = false; }
}
/* What was not sent last time (the tab was closed, no network) goes out once someone is signed in. */
if (MIR.on) {
  try { const old = JSON.parse(localStorage.getItem(MIR.store) || '[]'); if (Array.isArray(old) && old.length) { MIR.q = old.concat(MIR.q); mirSoon(8000); } } catch (e) { /* nothing kept */ }
}
/* ================= END LIVE MIRROR ================= */
