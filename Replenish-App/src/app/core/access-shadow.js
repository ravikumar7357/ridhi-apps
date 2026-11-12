/* ================= ACCESS · SHADOW TEST (Ravi, 10 Nov 2026) =================
 *
 * ONLY ON THE TEST ERP AND THE LOCAL PAGE. On the real ERP this file does nothing at all.
 *
 * The ERP keeps deciding access from Firebase, exactly as before. This file only ASKS the new database (Supabase, project
 * "ERP TEST") the same question — "which boxes does this person have?" — compares the two answers and the two times, shows a
 * small line at the bottom of the screen, and records the result in ERP TEST (core.shadow_log) so the access check page can
 * show everybody's results. Nothing in the ERP depends on the answer.
 *
 * The person is the one signed in to the ERP: Supabase checks their Firebase sign-in itself (no second password), and
 * core.my_access() answers for that person only. The key below is ERP TEST's PUBLISHABLE key — the kind meant for browsers;
 * it opens nothing but those two functions.
 *
 * Remove this file (and its line in ORDER, and the 3 lines in core/auth.js) and nothing of it is left.
 */
const ASH = {
  on: typeof window !== 'undefined' && (!!window.__TEST_ERP || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)),
  url: 'https://eaklutqgopejtnxacamd.supabase.co',          // ERP TEST in MUMBAI (10 Nov; the Singapore one was koxcyzwwbrptauplblpe)
  key: 'sb_publishable_ybYG7Y1iAZerulnwWREWaw_EzubVDPT',   // its publishable key (made for browsers; opens only the shadow doors)
};
/* The 19 extra rights, as the Access page names them (same keys as the perms record). */
const ASH_RIGHTS = ['approve', 'replProj', 'soApprove', 'vreqApprove', 'rateApprove', 'rfdApprove', 'rfdSend', 'vlogAccept', 'shopAssign',
  'b2bAssign', 'prodEdit', 'attendMark', 'empEdit', 'fgiEntry', 'fgiEdit', 'accEntry', 'accEdit', 'mdbEdit', 'accessView'];
/* ERP screens the new database does not carry on purpose: the admins' own dashboard (admins get everything anyway). */
const ASH_NOT_CARRIED = ['dash'];

/** Firebase's answer, as boxes: the same reading the sign-in above makes (perms.replTabs, the old "whole ERP" switch, the rights). */
function ashFirebaseBoxes(d, email) {
  if (email === 'ravi@thefabricrush.com' || (d && d.admin === true)) return { admin: true, boxes: [] };
  if (!d) return { admin: false, boxes: [] };
  let rt = Array.isArray(d.replTabs) ? d.replTabs.filter(t => REPL_TABS.includes(t)) : [];
  if (!rt.length && d.repl === true) rt = REPL_TABS.filter(k => !['shopprod', 'shopret'].includes(k));
  rt = rt.filter(t => !ASH_NOT_CARRIED.includes(t));
  const boxes = [...rt.map(t => 'erp:' + t), ...ASH_RIGHTS.filter(k => d[k] === true).map(k => 'right:' + k)];
  return { admin: false, boxes: [...new Set(boxes)].sort() };
}

async function ashCall(fn, token, body) {
  const r = await fetch(ASH.url + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: ASH.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Profile': 'core', 'Accept-Profile': 'core' },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) throw new Error('ERP TEST answered ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/* ================= STEP 7 · ACCESS FROM THE NEW DATABASE (Ravi, 10 Nov) =================
 * On the test ERP, access now COMES FROM Supabase: core/auth.js asks accessFromSupabase() alongside the Firebase read and,
 * when it answers, builds the menu, screens and rights from Supabase's boxes — fed in as the same kind of record Firebase
 * gives, so everything the sign-in works out after that runs unchanged. Firebase is still read, for the comparison.
 * The switch (on the line at the bottom left) flips this browser between Supabase and Firebase. If Supabase cannot be
 * reached, the sign-in uses Firebase and the line says so — nobody is locked out of the test ERP. */
const ASH_SRC_KEY = 'r1.testerp.accessSource';
function ashSource() { try { return localStorage.getItem(ASH_SRC_KEY) === 'firebase' ? 'firebase' : 'supabase'; } catch (e) { return 'supabase'; } }
function ashSetSource(v) { try { localStorage.setItem(ASH_SRC_KEY, v); } catch (e) { /* this browser keeps nothing: stays on the default */ } location.reload(); }
let ASH_SB = null;          // { rows, ms, token } — the new database's answer at this sign-in
let ASH_USED = 'firebase';  // where this sign-in's access actually came from: 'supabase' | 'firebase' | 'firebase (fallback)'

/** Supabase's answer as a perms-like record, or null to use Firebase. Never throws. */
async function accessFromSupabase(user) {
  ASH_SB = null; ASH_USED = 'firebase';
  if (!ASH.on || !ASH.key || !user) return null;
  if (ashSource() !== 'supabase') return null;   // switch on Firebase: Firebase only; Supabase is checked afterwards
  try {
    const token = await user.getIdToken();
    const t0 = performance.now();
    const rows = await ashCall('my_access', token);
    ASH_SB = { rows, ms: Math.round(performance.now() - t0), token };
  } catch (e) {
    ASH_SB = { error: e.message };
    if (ashSource() === 'supabase') ASH_USED = 'firebase (fallback)';
    return null;
  }
  if (ashSource() !== 'supabase') return null;
  ASH_USED = 'supabase';
  const rec = { admin: ASH_SB.rows.some(r => r.is_admin), repl: false, replTabs: [], __from: 'supabase' };
  ASH_SB.rows.forEach(r => {
    if (r.item_key.startsWith('erp:')) rec.replTabs.push(r.item_key.slice(4));
    else if (r.item_key.startsWith('right:')) rec[r.item_key.slice(6)] = true;
  });
  return rec;
}

/** Called once after sign-in by core/auth.js with the perms record Firebase gave and how long that took. Never throws. */
async function accessShadow(user, permsDoc, firebaseMs) {
  if (!ASH.on || !user) return;
  if (!ASH.key) { ashShow({ state: 'off', firebaseMs }); return; }
  const email = String(user.email || '').toLowerCase();
  // Supabase only: the sign-in did not ask Firebase at all — ask it now, after the screens are up, just for the comparison
  if (ASH_USED === 'supabase' && firebaseMs == null) {
    try {
      const t0 = performance.now();
      const s = await getDoc(doc(db, 'perms', email));
      firebaseMs = Math.round(performance.now() - t0);
      permsDoc = s.exists() ? s.data() : null;
    } catch (e) { ashShow({ state: 'error', firebaseMs: null, supabaseMs: ASH_SB && ASH_SB.ms, why: 'Firebase not read for the comparison: ' + e.message }); return; }
  }
  const fb = ashFirebaseBoxes(permsDoc, email);
  let token, rows, supabaseMs = null;
  try {
    if (ASH_SB && ASH_SB.rows) { token = ASH_SB.token; rows = ASH_SB.rows; supabaseMs = ASH_SB.ms; }   // already asked at sign-in
    else if (ASH_SB && ASH_SB.error) throw new Error(ASH_SB.error);
    else {
      token = await user.getIdToken();
      const t0 = performance.now();
      rows = await ashCall('my_access', token);
      supabaseMs = Math.round(performance.now() - t0);
    }
  } catch (e) { ashShow({ state: 'error', firebaseMs, why: e.message }); return; }

  const sbAdmin = rows.some(x => x.is_admin);
  const sb = rows.map(x => x.item_key).filter(k => /^(erp|right):/.test(k)).sort();   // Sellora's screens are not the ERP's
  let missing = [], extra = [];
  if (fb.admin || sbAdmin) { if (fb.admin !== sbAdmin) (fb.admin ? missing : extra).push('admin'); }
  else { missing = fb.boxes.filter(k => !sb.includes(k)); extra = sb.filter(k => !fb.boxes.includes(k)); }
  const matched = !missing.length && !extra.length;
  ashShow({ state: matched ? 'same' : 'differs', firebaseMs, supabaseMs, missing, extra });
  ashCall('shadow_report', token, { p_section: ASH_USED === 'supabase' ? 'access · from Supabase' : 'access', p_matched: matched, p_firebase_ms: firebaseMs, p_supabase_ms: supabaseMs,
    p_missing: missing, p_extra: extra, p_build: (window.__TEST_ERP && window.__TEST_ERP.sha) || 'local' }).catch(e => console.warn('[shadow] report not saved:', e.message));
  console.info('[shadow] access', matched ? 'same' : 'DIFFERS', { firebaseMs, supabaseMs, missing, extra });
  controlShadow(token);   // section 2: the waiting-request counts
  mastersShadow(token);   // section 3: every Masters record
  skusShadow(token);      // section 4: every SKU record (at most once an hour per browser — it reads ~4 MB)
}

/* ================= SKUs · SHADOW TEST (Ravi, 10 Nov) =================
 * Every SKU record in live Firebase (pt_masterDB, pt_customSkus, pt_skuImages, pt_skuPriority, pt_fnskuMap) against the copy in
 * Supabase, record by record, by fingerprint (same way as Masters; core.skus_records()). It reads about 4 MB from Firebase, so it
 * runs at most once an hour in a browser; click the line to run it again now. Keep ashSkusPaths the same as
 * migration/tools/make-skus-data.js (firebasePaths). */
const ASH_SKU_LAST = 'r1.testerp.skusShadowAt';
function ashEnt(v) { return !v ? [] : Array.isArray(v) ? v.map((x, i) => [String(i), x]).filter(([, x]) => x != null) : Object.entries(v).filter(([, x]) => x != null); }
function ashSkusPaths(mdb, cus, img, pri, fn) {
  const out = new Map();
  ashEnt(mdb).forEach(([k, x]) => out.set(`pt_masterDB/${k}`, x));
  ashEnt(cus).forEach(([k, x]) => out.set(`pt_customSkus/${k}`, x));
  ashEnt(img).forEach(([k, x]) => out.set(`pt_skuImages/${k}`, x));
  ashEnt(pri).forEach(([k, x]) => out.set(`pt_skuPriority/${k}`, x));
  Object.entries(fn || {}).forEach(([k, x]) => { if (x != null) out.set(`pt_fnskuMap/${k}`, x); });
  return out;
}
async function skusShadow(token, force) {
  let last = 0; try { last = Number(localStorage.getItem(ASH_SKU_LAST)) || 0; } catch (e) { /* no storage: run */ }
  if (!force && Date.now() - last < 3600e3) { ashShowSkus({ waiting: true, at: last, token }); return; }
  ashShowSkus({ running: true, token });
  try {
    const read = n => (typeof ptGetFresh === 'function' ? ptGetFresh(n) : ptGet(n, true));
    const t0 = performance.now();
    const [mdb, cus, img, pri, fn] = await Promise.all(['pt_masterDB', 'pt_customSkus', 'pt_skuImages', 'pt_skuPriority', 'pt_fnskuMap'].map(read));
    const firebaseMs = Math.round(performance.now() - t0);
    const fb = ashSkusPaths(mdb, cus, img, pri, fn);
    const t1 = performance.now();
    const sb = await ashSectionFp('skus_fp', 'skus_records', token);
    const supabaseMs = Math.round(performance.now() - t1);
    const copyOf = sb.get('#copy_of') || ''; sb.delete('#copy_of');
    const t2 = performance.now();
    const { missing, changed, extra } = await ashCompare(fb, sb);
    const compareMs = Math.round(performance.now() - t2);
    const matched = !missing.length && !changed.length && !extra.length;
    try { localStorage.setItem(ASH_SKU_LAST, String(Date.now())); } catch (e) { /* fine */ }
    ashShowSkus({ matched, total: fb.size, missing, changed, extra, firebaseMs, supabaseMs, compareMs, copyOf, token });
    ashCall('shadow_report', token, { p_section: 'skus · records', p_matched: matched, p_firebase_ms: firebaseMs, p_supabase_ms: supabaseMs,
      p_missing: missing.concat(changed.map(p => p + ' (changed)')).slice(0, 500), p_extra: extra.slice(0, 500), p_build: (window.__TEST_ERP && window.__TEST_ERP.sha) || 'local' }).catch(() => {});
    console.info('[shadow] skus', matched ? 'same' : 'DIFFERS', { total: fb.size, missing: missing.length, changed: changed.length, extra: extra.length, firebaseMs, supabaseMs });
  } catch (e) { ashShowSkus({ error: e.message, token }); }
}
function ashShowSkus(r) {
  let el = document.getElementById('ashSkus');
  if (!el) {
    el = document.createElement('button'); el.id = 'ashSkus'; el.type = 'button';
    el.style.cssText = 'position:fixed;left:calc(12px + env(safe-area-inset-left,0px));bottom:calc(186px + env(safe-area-inset-bottom,0px));z-index:10000;'
      + 'font:12px/1.3 system-ui,sans-serif;padding:7px 11px;border-radius:999px;border:1px solid rgba(0,0,0,.15);cursor:pointer;max-width:calc(100vw - 24px);text-align:left;color:#1b1b1b';
    document.body.appendChild(el);
    el.onclick = () => { const x = el._r || {}; if (x.waiting || x.error) { skusShadow(x.token, true); return; } el.dataset.open = el.dataset.open ? '' : '1'; ashShowSkus(x); };
  }
  el._r = r; el.style.whiteSpace = 'pre-line';
  if (r.running) { el.style.background = '#eef1f7'; el.textContent = 'SKUs · comparing 18,000+ records with Firebase…'; return; }
  if (r.waiting) { el.style.background = '#eef1f7'; el.textContent = 'SKUs · last compared ' + new Date(r.at).toLocaleTimeString('en-IN') + ' · click to compare again now'; return; }
  if (r.error) { el.style.background = '#fff4d6'; el.textContent = '! SKUs · not compared: ' + String(r.error).slice(0, 120) + ' · click to retry'; return; }
  el.style.background = r.matched ? '#e3f4ea' : '#fde4e1';
  const n = r.missing.length + r.changed.length + r.extra.length;
  let t = 'SKUs · ' + r.total.toLocaleString('en-IN') + ' records · ' + (r.matched ? '✓ every one the same as Firebase' : '✗ ' + n.toLocaleString('en-IN') + ' differ (Supabase copy from ' + (r.copyOf || '?') + ')')
    + ' · Firebase ' + r.firebaseMs + ' ms · Supabase ' + r.supabaseMs + ' ms' + (r.compareMs != null ? ' · compare ' + r.compareMs + ' ms' : '');
  const open = !!(el.dataset.open && n);
  if (open) t += '\n' + [...r.changed.map(p => 'changed: ' + p), ...r.missing.map(p => 'new in Firebase: ' + p), ...r.extra.map(p => 'gone from Firebase: ' + p)].join('\n')
    + '\nA difference here usually means a SKU added or edited in the ERP after the copy was made. Click to close.';
  ashShape(el, open);
  el.textContent = t;
}

/* ================= MASTERS · SHADOW TEST (Ravi, 10 Nov) =================
 * Every Masters record in live Firebase (pt_masters, pt_colorGroups, the Greige Desk's fabric pairs + vendors) against the
 * copy in Supabase, record by record: each record is fingerprinted here (sha-256 of the record written the way the database
 * writes it) and compared with the fingerprints core.masters_records() gives — no names leave the database. A third line at the
 * bottom. Supabase's copy is from a backup day (shown), so a difference can simply mean "changed in the ERP since that day".
 * Read only on both sides; never throws. Keep ashMastersPaths / ashJbText the same as migration/tools/make-masters-data.js
 * (firebasePaths) and masters-fingerprint.js (jbText). */
function ashMastersPaths(M, CG, GD) {
  const out = new Map();
  for (const [L, v] of Object.entries(M || {})) {
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (x != null) out.set(`pt_masters/${L}/${k}`, x); }
    else if (v != null) out.set(`pt_masters/${L}`, v);
  }
  for (const [k, v] of Object.entries(CG || {})) {
    if (k === 'map' && v && typeof v === 'object') for (const [l, g] of Object.entries(v)) out.set(`pt_colorGroups/map/${l}`, g);
    else if (v != null) out.set(`pt_colorGroups/${k}`, v);
  }
  for (const part of ['mst', 'ven']) for (const [k, x] of Object.entries((GD || {})[part] || {})) if (x != null) out.set(`pt_gdTest/${part}/${k}`, x);
  return out;
}
const ASH_ENC = new TextEncoder();
function ashKeyCmp(a, b) {
  const x = ASH_ENC.encode(a), y = ASH_ENC.encode(b);
  if (x.length !== y.length) return x.length - y.length;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
function ashJbText(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(ashJbText).join(', ') + ']';
  if (typeof v === 'object') return '{' + Object.keys(v).sort(ashKeyCmp).map(k => JSON.stringify(k) + ': ' + ashJbText(v[k])).join(', ') + '}';
  return JSON.stringify(v);
}
async function ashSha(s) {
  const b = await crypto.subtle.digest('SHA-256', ASH_ENC.encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
/* Supabase's fingerprints of a section in ONE trip (core.masters_fp / core.skus_fp, saved when rows are written).
 * Falls back to the older page-by-page door if the new one is not there yet. Returns a Map path → fingerprint. */
async function ashSectionFp(fn, oldFn, token) {
  try { const j = await ashCall(fn, token); if (j && typeof j === 'object') return new Map(Object.entries(j)); }
  catch (e) { if (!/404|PGRST202|Could not find/.test(e.message)) throw e; }
  const rows = [];
  for (let f = 0; ; f += 1000) { const page = await ashCall(`${oldFn}?order=path&offset=${f}&limit=1000`, token); rows.push(...page); if (page.length < 1000) break; }
  return new Map(rows.map(r => [r.path, r.h]));
}
/* Compare live Firebase records with Supabase's fingerprints; the browser's fingerprints are made in parallel. */
async function ashCompare(fb, sb) {
  const missing = [], changed = [], extra = [];
  const entries = [...fb];
  for (let i = 0; i < entries.length; i += 2000) {
    const part = entries.slice(i, i + 2000);
    const hs = await Promise.all(part.map(([p, rec]) => sb.has(p) ? ashSha(ashJbText(rec)) : null));
    part.forEach(([p], j) => { if (!sb.has(p)) missing.push(p); else if (sb.get(p) !== hs[j]) changed.push(p); });
  }
  for (const p of sb.keys()) if (!fb.has(p)) extra.push(p);
  return { missing, changed, extra };
}
/* A line at the bottom: a pill when closed; a scrolling box when opened (long lists used to turn it into a big circle). */
function ashShape(el, open) {
  el.style.borderRadius = open ? '12px' : '999px';
  el.style.maxHeight = open ? '55vh' : '';
  el.style.overflowY = open ? 'auto' : '';
  el.style.maxWidth = open ? 'min(720px, calc(100vw - 24px))' : 'calc(100vw - 24px)';
}
async function mastersShadow(token) {
  try {
    const read = n => (typeof ptGetFresh === 'function' ? ptGetFresh(n) : ptGet(n, true));
    const t0 = performance.now();
    const [M, CG, GD] = await Promise.all([read('pt_masters'), read('pt_colorGroups'), read('pt_gdTest')]);
    const firebaseMs = Math.round(performance.now() - t0);
    const fb = ashMastersPaths(M, CG, GD);
    const t1 = performance.now();
    const sb = await ashSectionFp('masters_fp', 'masters_records', token);
    const supabaseMs = Math.round(performance.now() - t1);
    const copyOf = sb.get('#copy_of') || ''; sb.delete('#copy_of');
    const { missing, changed, extra } = await ashCompare(fb, sb);
    const matched = !missing.length && !changed.length && !extra.length;
    ashShowMasters({ matched, total: fb.size, missing, changed, extra, firebaseMs, supabaseMs, copyOf });
    ashCall('shadow_report', token, { p_section: 'masters · records', p_matched: matched, p_firebase_ms: firebaseMs, p_supabase_ms: supabaseMs,
      p_missing: missing.concat(changed.map(p => p + ' (changed)')), p_extra: extra, p_build: (window.__TEST_ERP && window.__TEST_ERP.sha) || 'local' }).catch(() => {});
    console.info('[shadow] masters', matched ? 'same' : 'DIFFERS', { total: fb.size, missing, changed, extra, firebaseMs, supabaseMs });
  } catch (e) { ashShowMasters({ error: e.message }); }
}
function ashShowMasters(r) {
  let el = document.getElementById('ashMasters');
  if (!el) {
    el = document.createElement('button'); el.id = 'ashMasters'; el.type = 'button';
    el.style.cssText = 'position:fixed;left:calc(12px + env(safe-area-inset-left,0px));bottom:calc(142px + env(safe-area-inset-bottom,0px));z-index:10000;'
      + 'font:12px/1.3 system-ui,sans-serif;padding:7px 11px;border-radius:999px;border:1px solid rgba(0,0,0,.15);cursor:pointer;max-width:calc(100vw - 24px);text-align:left;color:#1b1b1b';
    document.body.appendChild(el);
    el.onclick = () => { el.dataset.open = el.dataset.open ? '' : '1'; ashShowMasters(el._r); };
  }
  el._r = r;
  if (r.error) { el.style.background = '#fff4d6'; el.textContent = '! Masters · not compared: ' + String(r.error).slice(0, 120); return; }
  el.style.background = r.matched ? '#e3f4ea' : '#fde4e1';
  const n = r.missing.length + r.changed.length + r.extra.length;
  let t = 'Masters · ' + r.total.toLocaleString('en-IN') + ' records · ' + (r.matched ? '✓ every one the same as Firebase' : '✗ ' + n + ' differ (Supabase copy from ' + (r.copyOf || '?') + ')')
    + ' · Firebase ' + r.firebaseMs + ' ms · Supabase ' + r.supabaseMs + ' ms';
  const open = !!(el.dataset.open && n);
  if (open) t += '\n' + [...r.changed.map(p => 'changed: ' + p), ...r.missing.map(p => 'new in Firebase: ' + p), ...r.extra.map(p => 'gone from Firebase: ' + p)].join('\n')
    + '\nA difference here usually means a master entry added or edited in the ERP after the copy was made. Click to close.';
  ashShape(el, open);
  el.textContent = t; el.style.whiteSpace = 'pre-line';
}

/* ================= CONTROL · SHADOW TEST (Ravi, 10 Nov) =================
 * The waiting requests of every kind, counted in Firebase (the registers the badges read) and in Supabase (core.waiting_counts,
 * counts only), side by side on a second line. Supabase's copy is from a backup day (shown), so a difference can simply mean
 * "requests raised since that day" — the line says which day. Never throws; nothing changes in either database. */
const ASH_CONTROL = [
  ['jw_correction', 'job-work', 'pt_jwCorrReqs', x => x.status === 'pending'],
  ['fgi_correction', 'FG', 'pt_fgiCorrReqs', x => x.status === 'pending'],
  ['order_delete', 'order deletes', 'pt_obDeleteReqs', x => x.status === 'pending'],
  ['vendor_order_request', 'vendor-order', 'pt_vendorOrderReqs', x => x.status === 'pending'],
  ['rfd_decision', 'RFD', 'pt_rfdDecisions', x => x.stage === 'pending'],
  ['rate', 'rates', 'pt_printerRates', x => !x.status],
];
async function controlShadow(token) {
  try {
    const t0 = performance.now();
    const fb = {};
    await Promise.all(ASH_CONTROL.map(async ([kind, , reg, isWaiting]) => {
      try { fb[kind] = ptList(await ptGet(reg)).filter(x => x && typeof x === 'object' && isWaiting(x)).length; }
      catch (e) { fb[kind] = null; }   // this login may not read that register in Firebase
    }));
    const firebaseMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    const rows = await ashCall('waiting_counts', token);
    const supabaseMs = Math.round(performance.now() - t1);
    const sb = Object.fromEntries(rows.map(r => [r.kind, r.waiting]));
    const copyOf = (rows[0] && rows[0].copy_of) || '';
    const parts = [], diffs = [];
    ASH_CONTROL.forEach(([kind, label]) => {
      if (fb[kind] == null) { parts.push(label + ' –'); return; }
      parts.push(label + ' ' + fb[kind] + (fb[kind] !== sb[kind] ? '/' + sb[kind] : ''));
      if (fb[kind] !== sb[kind]) diffs.push(`${kind}: Firebase ${fb[kind]} · Supabase ${sb[kind]}`);
    });
    const matched = !diffs.length;
    ashShowControl({ matched, parts, diffs, firebaseMs, supabaseMs, copyOf });
    ashCall('shadow_report', token, { p_section: 'control · waiting', p_matched: matched, p_firebase_ms: firebaseMs, p_supabase_ms: supabaseMs,
      p_missing: diffs, p_extra: [], p_build: (window.__TEST_ERP && window.__TEST_ERP.sha) || 'local' }).catch(() => {});
  } catch (e) { ashShowControl({ error: e.message }); }
}
function ashShowControl(r) {
  let el = document.getElementById('ashControl');
  if (!el) {
    el = document.createElement('button'); el.id = 'ashControl'; el.type = 'button';
    el.style.cssText = 'position:fixed;left:calc(12px + env(safe-area-inset-left,0px));bottom:calc(100px + env(safe-area-inset-bottom,0px));z-index:10000;'
      + 'font:12px/1.3 system-ui,sans-serif;padding:7px 11px;border-radius:999px;border:1px solid rgba(0,0,0,.15);cursor:pointer;max-width:calc(100vw - 24px);text-align:left;color:#1b1b1b';
    document.body.appendChild(el);
    el.onclick = () => { el.dataset.open = el.dataset.open ? '' : '1'; ashShowControl(el._r); };
  }
  el._r = r;
  if (r.error) { el.style.background = '#fff4d6'; el.textContent = '! Waiting requests · Supabase not reached'; return; }
  el.style.background = r.matched ? '#e3f4ea' : '#fde4e1';
  let t = 'Waiting · ' + r.parts.join(' · ') + ' · ' + (r.matched ? '✓ same as Firebase' : '✗ differs (Supabase copy from ' + (r.copyOf || '?') + ')')
    + ' · Firebase ' + r.firebaseMs + ' ms · Supabase ' + r.supabaseMs + ' ms';
  const open = !!(el.dataset.open && r.diffs.length);
  if (open) t += '\n' + r.diffs.join('\n') + '\nA difference here usually means requests raised or answered after the copy was made.';
  ashShape(el, open);
  el.textContent = t; el.style.whiteSpace = 'pre-line';
}

/* ================= CHECK EVERYONE (Ravi, 10 Nov) =================
 * For an admin or an Access viewer (the people Firebase lets read everybody's access): every person's access, read LIVE
 * from Firebase (perms/*), against what the new database gives each of them — one list, all at once, saved to ERP TEST.
 * Read only on both sides. Shown as a second small button beside the access line. */
const ASH_NOT_CARRIED_EMPTY = true;   // people with no real box left (only the old production app) are not carried — shown as such, not as a fault

function ashMayCheckAll() {
  return !!(typeof ME !== 'undefined' && ME && (ME.admin || (ASH_DOC && ASH_DOC.accessView === true)
    || (ASH_SB && ASH_SB.rows && ASH_SB.rows.some(r => r.item_key === 'right:accessView'))));
}

async function ashCheckEveryone() {
  const out = ashPanel('Checking everyone… reading Firebase and the new database');
  try {
    const token = await auth.currentUser.getIdToken();
    const t0 = performance.now();
    const snap = await getDocs(collection(db, 'perms'));
    const firebaseMs = Math.round(performance.now() - t0);
    const fb = {};
    snap.forEach(d => { const email = String(d.id || '').trim().toLowerCase(); if (email.includes('@')) fb[email] = ashFirebaseBoxes(d.data(), email); });

    const t1 = performance.now();
    const rows = await ashCall('access_of_everyone', token);
    const supabaseMs = Math.round(performance.now() - t1);
    const sb = {};
    rows.forEach(r => { const p = sb[r.email] = sb[r.email] || { name: r.name, role: r.role_code, admin: false, boxes: [] };
      if (r.via === 'admin') p.admin = true; else if (/^(erp|right):/.test(r.item_key)) p.boxes.push(r.item_key); });

    const results = [];
    new Set([...Object.keys(fb), ...Object.keys(sb)]).forEach(email => {
      const f = fb[email], s = sb[email];
      let missing = [], extra = [], note = '';
      if (f && !s) {
        if (!f.admin && !f.boxes.length && ASH_NOT_CARRIED_EMPTY) note = 'not carried (no access left)';
        else missing = f.admin ? ['admin'] : f.boxes;
      } else if (!f && s) { note = 'not in Firebase'; extra = s.admin ? ['admin'] : s.boxes; }
      else if (f.admin || s.admin) { if (f.admin !== s.admin) (f.admin ? missing : extra).push('admin'); }
      else { const sbx = s.boxes.sort(); missing = f.boxes.filter(k => !sbx.includes(k)); extra = sbx.filter(k => !f.boxes.includes(k)); }
      results.push({ email, name: s ? s.name : '', role: s ? s.role : '', matched: !missing.length && !extra.length, missing, extra, note });
    });
    results.sort((a, b) => (a.matched - b.matched) || a.email.localeCompare(b.email));

    const bad = results.filter(r => !r.matched).length;
    let saved = '';
    try { const n = await ashCall('shadow_report_everyone', token, { p_results: results.filter(r => !r.note.startsWith('not carried')).map(({ email, matched, missing, extra }) => ({ email, matched, missing, extra })),
      p_firebase_ms: firebaseMs, p_supabase_ms: supabaseMs, p_build: (window.__TEST_ERP && window.__TEST_ERP.sha) || 'local' }); saved = ' · saved ' + n + ' results to ERP TEST'; }
    catch (e) { saved = ' · not saved: ' + e.message; }

    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
    out.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap">
        <b style="font-size:15px">${bad ? '✗ ' + bad + ' of ' + results.length + ' differ' : '✓ All ' + results.length + ' people: the new database gives the same access'}</b>
        <span style="color:#555">Firebase ${firebaseMs} ms (everyone) · Supabase ${supabaseMs} ms (everyone)${esc(saved)}</span></div>
      <div style="max-height:60vh;overflow:auto;margin-top:10px"><table style="border-collapse:collapse;width:100%;font-size:12.5px">
      <thead><tr>${['Person', 'Role in the new database', 'Result'].map(h => `<th style="text-align:left;padding:5px 8px;border-bottom:1px solid #ddd">${h}</th>`).join('')}</tr></thead><tbody>` +
      results.map(r => `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(r.name || '')}<div style="color:#666">${esc(r.email)}</div></td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(r.role || '—')}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;color:${r.matched ? '#1d7a4a' : '#b3261e'}">${r.matched ? '✓ same' + (r.note ? ' · ' + esc(r.note) : '') : '✗ ' + esc([r.note, r.missing.length && 'missing: ' + r.missing.join(', '), r.extra.length && 'extra: ' + r.extra.join(', ')].filter(Boolean).join(' · '))}</td></tr>`).join('') +
      '</tbody></table></div>';
  } catch (e) { out.textContent = '! Could not check everyone: ' + e.message; }
}

/** The results panel (one, reused). */
function ashPanel(msg) {
  let p = document.getElementById('ashPanel');
  if (!p) {
    p = document.createElement('div'); p.id = 'ashPanel';
    p.style.cssText = 'position:fixed;left:calc(12px + env(safe-area-inset-left,0px));right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(102px + env(safe-area-inset-bottom,0px));'
      + 'z-index:9999;background:#fff;color:#1b1b1b;border:1px solid rgba(0,0,0,.15);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:14px 16px;font:13px/1.45 system-ui,sans-serif;max-width:900px';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close';
    close.style.cssText = 'position:absolute;top:8px;right:10px;font:12px system-ui;border:1px solid #ccc;border-radius:6px;background:#fff;padding:3px 8px;cursor:pointer';
    close.onclick = () => p.remove();
    const body = document.createElement('div'); body.id = 'ashPanelBody'; body.style.paddingRight = '56px';
    p.append(close, body); document.body.appendChild(p);
  }
  const body = document.getElementById('ashPanelBody'); body.textContent = msg; return body;
}

/** The small line at the bottom left. Click it to see the details. */
function ashShow(r) {
  let el = document.getElementById('ashLine');
  if (!el) {
    el = document.createElement('button');
    el.id = 'ashLine'; el.type = 'button';
    /* above the test ERP's own "R1 · test ERP" label, which sits in the bottom-left corner */
    el.style.cssText = 'position:fixed;left:calc(12px + env(safe-area-inset-left,0px));bottom:calc(58px + env(safe-area-inset-bottom,0px));z-index:10000;'
      + 'font:12px/1.3 system-ui,sans-serif;padding:7px 11px;border-radius:999px;border:1px solid rgba(0,0,0,.15);cursor:pointer;max-width:calc(100vw - 24px);text-align:left';
    document.body.appendChild(el);
    el.onclick = () => { el.dataset.open = el.dataset.open ? '' : '1'; ashShow(el._r); };
  }
  el._r = r;
  const ms = v => v == null ? '–' : v + ' ms';
  const from = { supabase: 'Access from Supabase only', firebase: 'Access from Firebase only', 'firebase (fallback)': 'Access from Firebase (Supabase not reached)' }[ASH_USED];
  const cmp = { same: '✓ same as Firebase', differs: '✗ differs from Firebase', error: '! Supabase not reached', off: 'shadow test off (no key)' }[r.state];
  el.style.background = r.state === 'same' ? '#e3f4ea' : r.state === 'differs' ? '#fde4e1' : '#fff4d6';
  el.style.color = '#1b1b1b';
  let text = from + ' · ' + cmp + ' · Firebase ' + ms(r.firebaseMs) + (r.state === 'same' || r.state === 'differs' ? ' · Supabase ' + ms(r.supabaseMs) : '');
  if (el.dataset.open) {
    if (r.missing && r.missing.length) text += '\nMissing in Supabase: ' + r.missing.join(', ');
    if (r.extra && r.extra.length) text += '\nExtra in Supabase: ' + r.extra.join(', ');
    if (r.why) text += '\n' + r.why;
  }
  el.textContent = text;
  el.style.whiteSpace = 'pre-line';
  // the switch: which database this browser's test ERP takes access from
  let sw = document.getElementById('ashSwitch');
  if (!sw) {
    sw = document.createElement('button'); sw.id = 'ashSwitch'; sw.type = 'button';
    sw.style.cssText = 'position:fixed;bottom:calc(58px + env(safe-area-inset-bottom,0px));z-index:10000;font:12px/1.3 system-ui,sans-serif;padding:7px 11px;'
      + 'border-radius:999px;border:1px solid rgba(0,0,0,.25);background:#fff;color:#1b1b1b;cursor:pointer';
    document.body.appendChild(sw);
    const place = () => { const rr = el.getBoundingClientRect(); sw.style.left = Math.round(rr.right + 8) + 'px'; const all = document.getElementById('ashAll'); if (all) all.style.left = Math.round(rr.right + 16 + sw.getBoundingClientRect().width) + 'px'; };
    new ResizeObserver(place).observe(el); new ResizeObserver(place).observe(sw); setTimeout(place, 0);
  }
  const other = ashSource() === 'supabase' ? 'firebase' : 'supabase';
  sw.textContent = 'Switch to ' + (other === 'supabase' ? 'Supabase' : 'Firebase');
  sw.onclick = () => ashSetSource(other);
  // the "Check everyone" button, beside the line — only for an admin or an Access viewer
  if (ashMayCheckAll() && !document.getElementById('ashAll')) {
    const b = document.createElement('button');
    b.id = 'ashAll'; b.type = 'button'; b.textContent = 'Shadow check · everyone';
    b.style.cssText = 'position:fixed;bottom:calc(58px + env(safe-area-inset-bottom,0px));z-index:10000;font:12px/1.3 system-ui,sans-serif;padding:7px 11px;'
      + 'border-radius:999px;border:1px solid rgba(0,0,0,.2);background:#1b1b1b;color:#fff;cursor:pointer';
    b.onclick = ashCheckEveryone;
    document.body.appendChild(b);
    const place = () => { const sw2 = document.getElementById('ashSwitch'); const r = (sw2 || el).getBoundingClientRect(); b.style.left = Math.round(r.right + 8) + 'px'; };
    place(); new ResizeObserver(place).observe(el);
  }
}
