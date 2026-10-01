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
  /* A completed Job Work entry is written where it now lives — through ptPatch, which also moves that month's _ver. */
  if (BASE.on && /^pt_baseData\//.test(String(path))) {
    await baseEnsureWhere([path]);
    if (baseRoutePath(path)) return ptPatch({ [path]: value });
  }
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

/** A single update touching many paths at once. RTDB applies it all or not at all. */
async function ptPatch(updates, opts) {
  opts = opts || {};
  /* Completed Job Work entries are written where they now live, and their month's _ver moves (core/job-work-split.js). */
  let baseMonths = [];
  if (BASE.on && !opts.noRoute) {
    await baseEnsureWhere(Object.keys(updates || {}));
    const rt = baseRouteUpdates(updates);
    updates = rt.updates; baseMonths = rt.months;
  }
  /* A path set to null is a delete: a whole record (pt_x/<id>, or a completed entry pt_baseDone/<month>/<id>) or more is
   * copied to the recycle bin first. A single field cleared deeper down is only a history line. A move (noTrash) is not
   * a delete. (A completed entry's path is pt_baseDone/<day>/<id>.) */
  const gone = opts.noTrash ? [] : Object.keys(updates || {}).filter(k => updates[k] === null
    && (k.split('/').filter(Boolean).length <= 2 || /^pt_baseDone\/\d{4}-\d{2}-\d{2}\/[^/]+$/.test(k)));
  if (gone.length) await auditTrash(gone, 'patch');
  ptLiveWrote(Object.keys(updates || {}));
  const r = await fetch(`${PT_URL}/.json` + await ptAuthQuery(), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates),
  });
  ptLiveWrote(Object.keys(updates || {}));
  if (r.status === 401 || r.status === 403)
    throw new Error('The production database refused the change — this account does not hold the right '
      + 'it needs. If the right was only just given, sign out and in again; otherwise ask an admin.');
  if (!r.ok) throw new Error(`The production database answered ${r.status} ${r.statusText || ''}`.trim());
  const out = await r.json();
  auditLog('patch', updates || {});
  if (baseMonths.length) await baseForget(baseMonths);
  return out;
}

/** One path removed. The record is copied to the recycle bin first (see auditTrash). */
async function ptDelete(path) {
  /* A completed Job Work entry is removed where it lives — through ptPatch, which copies it to the recycle bin first. */
  if (BASE.on && /^pt_baseData\//.test(String(path))) {
    await baseEnsureWhere([path]);
    if (baseRoutePath(path)) { await ptPatch({ [path]: null }); return true; }
  }
  await auditTrash([path], 'delete');
  ptLiveWrote([path]);
  const r = await fetch(`${PT_URL}/${ptPath(path)}.json` + await ptAuthQuery(), { method: 'DELETE' });
  ptLiveWrote([path]);
  if (!r.ok) throw new Error(`The production database answered ${r.status} ${r.statusText || ''}`.trim());
  auditLog('delete', { [path]: null });
  return true;
}
