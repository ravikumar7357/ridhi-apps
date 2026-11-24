/* ================= LISTING · FIX STATUS: "Still not fixed on Amazon" — the bell 🔔 and Listing History's "Fix status" (24 Nov 2026, MD task #4) =================
 * Screens: the bell in the top menu bar (#fsBell, beside ✨ / 🌙 — Listing users only) and its panel (#fsPanel); Listing → Listing History
 *          → "Fix status" (#fsPage); one line in Listing Health's listing panel (listing-kid.js lkHtml → fsKidLine).
 * Does: remembers what every Sellora fix was meant to fix, and says whether Amazon shows it fixed — AMAZON IS ONLY READ, never sent to.
 *   THE FIX RECORD = the Listing History row every send already writes (listing-send-check.js sqLogRows → lhistAdd, the shared /history
 *     collection — one place, every user sees the same), with two more fields taken BEFORE the send (sqSendWithCheck → fsJobInfo):
 *     fi = the Amazon issues on that listing about the field being changed (code, message, attributes) — what the fix was meant to fix;
 *     e0 = every Amazon ERROR on the listing then (to see a new one after). SKU, brand, field / attribute, time and who are on the row.
 *   CHECKED AGAIN with the reads Sellora already makes: the ListingMatch cache (the backend's auto refresh, every ~15 min) with a newer
 *     live read laid over it (Check now, the Listing Sync cycle) — fsFresh. No new Amazon call. Each fix is judged on the newest read made
 *     AFTER it was sent (the ~1 h read, then the ~24 h one, and so on — always the latest):
 *     ✅ Fixed — that issue is gone (no issue known: the field now holds the new value; not comparable: no error on that field);
 *     ⏳ Checking — under 24 h and still showing, or not read again yet; ⚠️ Still on Amazon — still showing 24 h after the send;
 *     ❌ New error after fix — an ERROR the listing did not have when it was sent. A later fix of the same field replaces an earlier one.
 *     Still on Amazon for 3+ days: "Likely stale on Amazon — re-submit once, or open a Seller Central case" (the Ounce 90244 case).
 *   FIXED IN SELLER CENTRAL: the errors Sellora knows per listing are kept in one shared document (history/fixwatch: each error and when it
 *     was first seen). An error gone from a newer read, with no Sellora send for that listing since it was first seen → "Fixed on Amazon
 *     (Seller Central) ✅" (kept 30 days).
 *   DONE IN SELLER CENTRAL (24 Nov 2026, later the same day): "I fixed this in Seller Central" on each Amazon error row (Listing Errors,
 *     Listing Health's listing panel) saves a record in the shared history/fixsc { recs: { id: { brand, sku, fi, at, by, name, how } } } —
 *     NOTHING is sent to Amazon; Undo for 1 minute (the same person). AUTO-DETECTED: a listing with an open error whose read VALUES
 *     (title, search words, bullets / description sizes, highlights, colour, pictures) changed with no Sellora send since → a record
 *     how 'auto' (fsWatchStep, from the reads Sellora already makes). Both are judged like a Sellora fix: ✅ when a read after it no longer
 *     shows those issues; ⚠️ when still showing 24 h after; the stale hint from 3 days.
 *   THE BELL "Not accepted by Amazon": ONLY ⚠️ / ❌ not marked as seen by THIS user (history/fixseen_<user>, remembered across
 *     computers; this browser's copy as a fallback), in two sections that open with their arrow — ▸ Done in Sellora (N) · ▸ Done in
 *     Seller Central (N) — closed at first, remembered per user. ✅ and ⏳ are only in Listing History → Fix status. Red count = the same.
 *   THE DAILY EMAIL (optional, Pricing-API/FixStatus.gs, not deployed) reads history/fixstatus — the ⚠️ / ❌ list this page keeps.
 *   Nothing is written on the test site (sqIsTest): there it shows only what is there.
 *   STARTS once the account's rights are APPLIED (core/access.js applyPerms replaces TAB_OK — the placeholder in core/nav.js is a
 *     function from page load, so "a function" is not enough), checks again for 2 minutes, and a click on the bell starts it too.
 * Main functions: fsJobInfo, fsFresh, fsCompute, fsWatchStep, fsStart, fsRefresh, fsBellDraw, fsPanelHtml, fsPageHtml, fsKidLine,
 *   fsScMark, fsScUndo, fsScBtnHtml. */

const FS_DAY = 86400000;
const FS_STILL_MS = 24 * 3600000;          // "Still on Amazon" from 24 h after the send
const FS_STALE_MS = 3 * FS_DAY;             // the stale hint from 3 days
const FS_LIST_DAYS = 30;                    // the fixes looked at: sent in the last 30 days
const FS_SC_KEEP = 30 * FS_DAY;             // a Seller Central fix stays listed 30 days
const FS_WATCH_MS = 10 * 60000;             // the shared watch / summary are brought up to date at most every 10 minutes
const FS_STALE_HINT = 'Likely stale on Amazon — re-submit once, or open a Seller Central case';
const FS_STATES = { fixed: '✅ Fixed', checking: '⏳ Checking', still: '⚠️ Still on Amazon', newerr: '❌ New error after fix', scfixed: '✅ Fixed in Seller Central' };
const FS_UNDO_MS = 60000;                   // "I fixed this in Seller Central" can be undone for 1 minute
const FS = { on: false, rows: null, recs: [], sig: null, seen: new Set(), seenLoaded: false, watch: null, watchAt: 0, sumSig: '', sumAt: 0, timer: 0,
  open: false, f: { brand: '', state: '', who: '', range: '30', done: '' }, busy: false, err: '',
  sec: { sellora: false, sc: false },        // the bell's two sections: open (▾) or closed (▸), per user
  marks: {}, marksV: 0 };                    // the Seller Central records (history/fixsc), by id
const fsEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const fsIsErr = i => /^E/i.test(String((i && (i.s || i.severity)) || ''));
const fsAttrs = i => (i.a || i.attrs || i.attributeNames || []).map(String);
// One issue as a key: its code and the attributes it names ("90244|unit_count").
const fsKey = i => String(i.c || i.code || '') + '|' + fsAttrs(i).slice().sort().join(',');
// Is Amazon's issue `i` the one the fix was meant to fix (`t`)? The same code, and the same attribute when both name one.
const fsHit = (t, i) => String(i.c || i.code || '') === String(t.c || '') && (!(t.a || []).length || !fsAttrs(i).length || (t.a || []).some(a => fsAttrs(i).includes(a)));
const fsPicId = url => { const m = String(url || '').match(/\/images\/I\/([^./?]+)/); return m ? m[1] : String(url || ''); };
const fsNorm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
const fsBrandName = b => (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[b]) || (b === 'SP' ? 'Ridhi' : b);
const fsHours = ms => { const h = Math.max(0, Math.round(ms / 3600000)); return h < 48 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.round(h / 24)} days`; };
const fsDate = ms => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const fsWhen = ms => (ms ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/* ----- what Sellora last read from Amazon for a listing ----- */
/** The freshest read of one listing: the ListingMatch cache's record with a newer live read laid over it (listing-match.js lmLiveOf) —
 *  { iss: [{ s, c, m, a }], gAt (issues read), cAt (content read), at, title, kw, hl, hlAt } — or null when nothing is held. */
function fsFresh(brand, sku) {
  let ws = null;
  try {
    const live = typeof liWsLiveMap === 'function' ? liWsLiveMap().live : null;
    ws = live && live[brand] ? live[brand][sku] || null : null;
  } catch (e) { ws = null; }
  try { if (typeof lmLiveOf === 'function' && typeof lmOk === 'function' && lmOk(brand)) return lmLiveOf(brand, sku, ws); } catch (e) { /* the live read alone */ }
  return ws;
}
// The listing's own submitted pictures (the cache's record): { slot: url } and when they were read.
function fsPics(brand, sku) {
  try { const m = typeof lmGet === 'function' ? lmGet(sku, brand) : null; return m ? { img: m.img || {}, at: m.gAt || 0 } : null; } catch (e) { return null; }
}

/* ----- 1. remembering every fix: taken before the send (sqSendWithCheck), written on each Listing History row (sqLogRows) ----- */
/** For one send job: { e0 (every ERROR on the listing now, as keys), r0 (when that was read), byAttr: { attr: [the issues about it] } }. */
function fsJobInfo(job) {
  if (!job || !job.brand || !job.sku) return null;
  const e = fsFresh(job.brand, job.sku);
  const iss = (e && e.iss) || [];
  const slotOf = a => (typeof imAttrSlot === 'function' ? imAttrSlot(a) : '');
  const byAttr = {};
  (job.changes || []).forEach(c => {
    const attr = String(c.attr || '');
    if (!attr || byAttr[attr]) return;
    const slot = /^(MAIN|PT0[1-8]|SWCH)$/.test(attr) ? attr : '';
    const about = i => fsAttrs(i).some(a => a === attr || (slot && slotOf(a) === slot)) || (!!slot && new RegExp('\\b' + slot + '\\b').test(String(i.m || i.message || '')));
    byAttr[attr] = iss.filter(about).slice(0, 4).map(i => ({ c: String(i.c || i.code || ''), s: String(i.s || i.severity || '').charAt(0).toUpperCase(), m: String(i.m || i.message || '').slice(0, 240), a: fsAttrs(i).slice(0, 4) }));
  });
  return { e0: iss.filter(fsIsErr).map(fsKey).slice(0, 40), r0: e ? e.at || e.gAt || 0 : 0, byAttr };
}

/* ----- 2. checking Amazon again: the state of every fix ----- */
// Does the field now hold the new value? true / false / null (cannot be compared from what is read).
function fsFieldNow(r, e, pics) {
  const want = String(r.new || '');
  if (!want || want === '(removed)' || want === '(none)') return null;
  const same = now => { const a = fsNorm(now), b = fsNorm(want).replace(/…$/, ''); const n = Math.min(200, b.length); return a.slice(0, n) === b.slice(0, n); };
  if (r.api === 'limg' || r.pic) {
    const url = pics && pics.img ? pics.img[r.attr] : '';
    return url && pics.at > r.at ? fsPicId(url) === fsPicId(want) : null;
  }
  if (!e) return null;
  if (r.attr === 'item_name' && e.cAt > r.at && e.title) return same(e.title);
  if (r.attr === 'generic_keyword' && e.cAt > r.at) return same(e.kw || '');
  if (r.attr === 'title_differentiation' && (e.hlAt || e.gAt) > r.at && Array.isArray(e.hl)) return same(e.hl.join(' '));
  return null;
}
/** Amazon's issues (any level) about the field a fix changed: an attribute it names is that one (or the same name with more after it,
 *  "unit_count" ↔ "unit_count_type"); a picture slot by its attribute or "PT03" in the words; an issue naming no attribute, by the field's
 *  own name in Amazon's words ("Unit count" in "The value for Ounce / Unit Count is missing"). */
function fsFieldIssues(r, iss) {
  const attr = String(r.attr || '').toLowerCase();
  const slot = /^(main|pt0[1-8]|swch)$/.test(attr) ? attr.toUpperCase() : '';
  const plain = s => fsNorm(s).replace(/[^a-z0-9]+/g, ' ').trim();
  const words = plain(String(r.field || '').replace(/^spec:\s*/i, '')) || plain(attr.replace(/_/g, ' '));
  return (iss || []).filter(i => {
    const as = fsAttrs(i).map(a => a.toLowerCase());
    if (slot) return as.some(a => typeof imAttrSlot === 'function' && imAttrSlot(a) === slot) || new RegExp('\\b' + slot + '\\b').test(String(i.m || i.message || ''));
    if (as.length) return as.some(a => a === attr || a.startsWith(attr + '_') || attr.startsWith(a + '_'));
    return words.length >= 4 && (' ' + plain(i.m || i.message || '') + ' ').includes(' ' + words + ' ');
  });
}
/** Every fix of the last FS_LIST_DAYS days, judged — plus the Seller Central fixes. rows: Listing History rows; o: { fresh(brand, sku),
 *  pics(brand, sku), sc: { key: { brand, sku, k, c, m, seen, gone } }, marks: { id: { brand, sku, fi, at, by, name, how, del } }, now }.
 *  → [{ id, key, brand, sku, asin, label, field, issue, code, who, at, readAt, state, hint, newErr, by: 'sellora' | 'sc',
 *  how ('mark' | 'auto' | 'gone' for 'sc'), confirmedAt }] newest first. A later fix of the same field replaces one. */
function fsCompute(rows, o) {
  const now = (o && o.now) || Date.now();
  const from = now - FS_LIST_DAYS * FS_DAY;
  const sent = (rows || []).filter(r => r && r.sku && r.brand && r.attr && r.at >= from && ['accepted', 'working', 'sent'].includes(r.result))
    .sort((a, b) => b.at - a.at || String(a.id).localeCompare(String(b.id)));
  const done = new Set();
  const out = [];
  sent.forEach(r => {
    const key = r.brand + '|' + r.sku + '|' + r.attr;
    if (done.has(key)) return;                               // a later fix of the same field is the one that counts
    done.add(key);
    const e = o.fresh ? o.fresh(r.brand, r.sku) : null;
    const iss = (e && e.iss) || [];
    const readAt = e ? Math.max(e.gAt || 0, e.cAt || 0, e.at || 0) : 0;
    const after = readAt > r.at;
    const fi = Array.isArray(r.fi) ? r.fi : [];
    const still = fi.filter(t => iss.some(i => fsHit(t, i)));
    const val = fsFieldNow(r, e, o.pics ? o.pics(r.brand, r.sku) : null);
    const e0 = new Set(Array.isArray(r.e0) ? r.e0 : []);
    const newErr = after && Array.isArray(r.e0) ? iss.filter(i => fsIsErr(i) && !e0.has(fsKey(i)) && !fi.some(t => fsHit(t, i))) : [];
    // A fix with no issue on record (sent before the bell, or no Amazon issue then): ✅ only when the field is right AND Amazon shows no
    // issue about that same field now (any level — the Ounce 90244 case is shown on the very field that was fixed).
    const onField = fi.length ? [] : fsFieldIssues(r, iss);
    const age = now - r.at;
    let state;
    if (!after) state = 'checking';
    else if (newErr.length) state = 'newerr';
    else if (fi.length ? !still.length : val !== false && !onField.length) state = 'fixed';
    else state = age < FS_STILL_MS ? 'checking' : 'still';
    const hint = state === 'still' && age >= FS_STALE_MS ? FS_STALE_HINT
      : state === 'checking' && !after && age >= FS_STILL_MS ? 'Not read from Amazon since the fix — Check now in Listing Health reads it' : '';
    out.push({ id: r.id, key, brand: r.brand, sku: r.sku, asin: r.asin || '', label: r.label || r.sku, field: r.field || r.attr, attr: r.attr,
      issue: fi[0] ? fi[0].m : onField[0] ? String(onField[0].m || onField[0].message || '') : (r.field || r.attr),
      code: fi[0] ? fi[0].c : onField[0] ? String(onField[0].c || onField[0].code || '') : '', who: r.name || '', at: r.at, readAt: after ? readAt : 0, state, hint,
      newErr: newErr[0] ? { c: String(newErr[0].c || ''), m: String(newErr[0].m || '') } : null, by: 'sellora', confirmedAt: state === 'fixed' ? readAt : 0, run: r.run || '' });
  });
  // Done in Seller Central — marked by a person, or auto-detected: judged like a Sellora fix, on the issues it was about (fi)
  const marked = [];
  Object.keys((o && o.marks) || {}).forEach(id => {
    const m = o.marks[id];
    if (!m || m.del || !m.brand || !m.sku || !(m.at >= from)) return;
    const fi = Array.isArray(m.fi) ? m.fi : [];
    const e = o.fresh ? o.fresh(m.brand, m.sku) : null;
    const iss = (e && e.iss) || [];
    const readAt = e ? Math.max(e.gAt || 0, e.at || 0) : 0;
    const after = readAt > m.at;
    const still = fi.filter(t => iss.some(i => fsHit(t, i)));
    const age = now - m.at;
    const state = !after ? 'checking' : !still.length ? 'fixed' : age < FS_STILL_MS ? 'checking' : 'still';
    const hint = state === 'still' && age >= FS_STALE_MS ? FS_STALE_HINT
      : state === 'checking' && !after && age >= FS_STILL_MS ? 'Not read from Amazon since it was marked — Check now in Listing Health reads it' : '';
    const t = still[0] || fi[0] || {};
    marked.push({ brand: m.brand, sku: m.sku, keys: new Set(fi.map(fsKey)) });
    out.push({ id: 'm:' + id, key: 'm:' + id, mark: id, brand: m.brand, sku: m.sku, asin: '', label: m.sku, field: '', attr: '', issue: t.m || ('Amazon error ' + (t.c || '')),
      code: t.c || '', who: m.how === 'auto' ? '' : (m.name || ''), whoBy: m.by || '', at: m.at, readAt: after ? readAt : 0, state, hint, newErr: null, by: 'sc', how: m.how === 'auto' ? 'auto' : 'mark',
      confirmedAt: state === 'fixed' ? readAt : 0, n: fi.length });
  });
  Object.keys((o && o.sc) || {}).forEach(k => {
    const s = o.sc[k];
    if (!s || now - s.gone > FS_SC_KEEP) return;
    if (marked.some(m => m.brand === s.brand && m.sku === s.sku && m.keys.has(s.k))) return;     // that one is already followed as a record
    out.push({ id: 'sc:' + k, key: 'sc:' + k, brand: s.brand, sku: s.sku, asin: '', label: s.sku, field: '', attr: '', issue: s.m || ('Amazon error ' + s.c), code: s.c || '',
      who: '', at: s.gone, readAt: s.gone, state: 'scfixed', hint: '', newErr: null, by: 'sc', how: 'gone', confirmedAt: s.gone, seen: s.seen });
  });
  return out.sort((a, b) => b.at - a.at);
}
// The items the bell counts: ⚠️ and ❌ — one ❌ per listing and send (a send that changed three fields is one new error).
function fsAlerts(recs) {
  const seenRun = new Set();
  return (recs || []).filter(r => {
    if (r.state === 'still') return true;
    if (r.state !== 'newerr') return false;
    const k = r.brand + '|' + r.sku + '|' + (r.run || r.at);
    if (seenRun.has(k)) return false;
    seenRun.add(k);
    return true;
  });
}

/* ----- fixed in Seller Central: the shared watch of the errors Sellora knows ----- */
/** One step of the watch: saved = { at, e: { 'brand|sku': { 'code|attrs': { s: first seen, m } } }, sc }; cur = Map 'brand|sku' → { at (its
 *  read), errs: [{ k, m }] } for the listings read; rows = Listing History rows (Sellora's sends). An error in the saved watch that a NEWER
 *  read no longer shows, with no Sellora send for that listing since it was first seen → a Seller Central fix.
 *  AUTO-DETECTED: cur's `h` (the listing's read values as one short code, fsValSig) and `vAt` (when read) — kept in v for each listing
 *  with an open error. The values changed in a newer read, the listing had an open error before, at least one of those errors still
 *  shows, no Sellora send since and no Seller Central record since (marks) → one record { brand, sku, fi (the errors it had), at, how:
 *  'auto' } in `auto` (written to history/fixsc by fsShare, not kept in the watch). → the new { at, e, sc, v, auto }. */
function fsWatchStep(saved, cur, rows, now, marks) {
  const s = saved || {};
  const e = {};
  const v = {};
  const auto = [];
  const sc = Object.assign({}, s.sc || {});
  const sentSince = (brand, sku, t) => (rows || []).some(r => r && r.brand === brand && r.sku === sku && r.at >= t - 60000 && r.result !== 'notsent');
  const markedSince = (brand, sku, t) => Object.keys(marks || {}).some(id => { const m = marks[id]; return m && !m.del && m.brand === brand && m.sku === sku && m.at >= t; });
  cur.forEach((c, k) => {
    const was = (s.e || {})[k] || {};
    const keep = {};
    c.errs.forEach(x => { keep[x.k] = { s: was[x.k] ? was[x.k].s : c.at, m: String(x.m || '').slice(0, 160) }; });
    if (Object.keys(keep).length) e[k] = keep;
    const cut = k.indexOf('|');
    const brand = k.slice(0, cut), sku = k.slice(cut + 1);
    // the values: kept for a listing with an open error (before or now); a change while an error stays → auto-detected
    const vWas = (s.v || {})[k];
    if (c.h && (Object.keys(keep).length || Object.keys(was).length)) v[k] = { h: c.h, at: c.vAt || c.at };
    if (c.h && vWas && vWas.h && vWas.h !== c.h && (c.vAt || c.at) > vWas.at && Object.keys(was).length
      && Object.keys(was).some(ek => keep[ek]) && !sentSince(brand, sku, vWas.at) && !markedSince(brand, sku, vWas.at)) {
      auto.push({ brand, sku, at: c.vAt || c.at, since: vWas.at, how: 'auto', by: '', name: '',
        fi: Object.keys(was).slice(0, 8).map(ek => { const [code, attrs] = ek.split('|'); return { c: code, s: 'E', m: was[ek].m || '', a: String(attrs || '').split(',').filter(Boolean) }; }) });
    }
    if (!s.at || !(c.at > s.at)) return;
    Object.keys(was).forEach(ek => {
      if (keep[ek] || sentSince(brand, sku, was[ek].s)) return;
      sc[k + '|' + ek] = { brand, sku, k: ek, c: ek.split('|')[0], m: was[ek].m || '', seen: was[ek].s, gone: c.at };
    });
  });
  Object.keys(s.e || {}).forEach(k => { if (!cur.has(k)) e[k] = s.e[k]; });      // not read now: kept as it was
  Object.keys(s.v || {}).forEach(k => { if (!cur.has(k) && s.e && s.e[k]) v[k] = s.v[k]; });
  Object.keys(sc).forEach(k => { if (now - sc[k].gone > FS_SC_KEEP) delete sc[k]; });
  return { at: now, e, sc, v, auto };
}
// A listing's read values as one short code: the title, search words, bullet / description sizes, highlights, colour and pictures.
function fsValSig(e, pics) {
  if (!e || !e.cAt || !e.gAt) return '';
  const img = pics && pics.img ? Object.keys(pics.img).sort().map(k => k + '=' + fsPicId((pics.img[k] && pics.img[k].u) || pics.img[k])).join(',') : '';
  const text = [e.title || '', e.kw || '', e.bul || 0, e.desc || 0, (e.hl || []).join('|'), e.color || '', img].join('\u0001');
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}
// The errors of every listing read now: Map 'brand|sku' → { at, errs }.
function fsWatchNow() {
  const cur = new Map();
  ['SP', 'CPC'].forEach(b => ((typeof HEALTH !== 'undefined' && HEALTH[b] && HEALTH[b].rows) || []).forEach(row => {
    const e = fsFresh(b, row.sku);
    if (!e || !e.gAt || e.lmStale) return;
    const pics = fsPics(b, row.sku);
    cur.set(b + '|' + row.sku, { at: e.gAt, errs: (e.iss || []).filter(fsIsErr).map(i => ({ k: fsKey(i), m: i.m || i.message || '' })),
      h: fsValSig(e, pics), vAt: Math.max(e.cAt || 0, e.gAt || 0) });
  }));
  return cur;
}

/* ----- the data: Listing History (shared), the watch (shared), this user's "seen" marks ----- */
const fsTest = () => typeof sqIsTest === 'function' && sqIsTest();
/** A test site or a copy on this computer: fixes are not sent to Amazon there, so the bell has nothing to track (no count, its own words). */
function fsLocal() {
  if (fsTest()) return true;
  try {
    const h = String(location.hostname || '');
    return location.protocol === 'file:' || !h || h === 'localhost' || h === '0.0.0.0' || /^127\./.test(h);
  } catch (e) { return false; }
}
// The user's own marks document (an id from the e-mail, never the e-mail itself).
function fsSeenId() {
  const email = String((typeof ME !== 'undefined' && ME && ME.email) || '').toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < email.length; i++) { h ^= email.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return 'fixseen_' + h.toString(36);
}
async function fsSeenLoad() {
  try { JSON.parse(localStorage.getItem('sellora.' + fsSeenId()) || '[]').forEach(k => FS.seen.add(k)); } catch (e) { /* none kept here */ }
  try { const o = JSON.parse(localStorage.getItem('sellora.fsopen.' + fsSeenId()) || 'null'); if (o) FS.sec = { sellora: !!o.sellora, sc: !!o.sc }; } catch (e) { /* closed */ }
  try {
    const snap = await getDoc(doc(db, 'history', fsSeenId()));
    const d = snap.exists() ? snap.data() || {} : {};
    Object.keys(d.seen || {}).forEach(k => FS.seen.add(k));
    if (d.open && typeof d.open === 'object') FS.sec = { sellora: !!d.open.sellora, sc: !!d.open.sc };
  } catch (e) { /* this browser's copy */ }
  FS.seenLoaded = true;
}
/** Open or close one of the bell's sections (▸ / ▾) — remembered for this user (their own document, this browser's copy too). */
function fsSecToggle(k) {
  if (!(k in FS.sec)) return;
  FS.sec = Object.assign({}, FS.sec, { [k]: !FS.sec[k] });
  try { localStorage.setItem('sellora.fsopen.' + fsSeenId(), JSON.stringify(FS.sec)); } catch (e) { /* private window */ }
  if (FS.open) fsPanelDraw();
  if (!fsTest()) { try { setDoc(doc(db, 'history', fsSeenId()), { open: FS.sec, at: serverTimestamp() }, { merge: true }).catch(() => {}); } catch (e) { /* kept in this browser */ } }
}

/* ----- done in Seller Central: "I fixed this in Seller Central" (and the auto-detected ones) — history/fixsc, nothing sent to Amazon ----- */
// Amazon's issues on a listing now (any level, with a code): the newest read, else Listing Errors' snapshot.
function fsScIssues(brand, sku) {
  const e = fsFresh(brand, sku);
  let iss = (e && e.iss) || [];
  if (!iss.length && typeof IML !== 'undefined' && IML[brand] && Array.isArray(IML[brand].items)) {
    const x = IML[brand].items.find(it => it.sku === sku);
    iss = (x && x.iss) || [];
  }
  return iss.filter(i => String(i.c || i.code || '')).slice(0, 8).map(i => ({ c: String(i.c || i.code || ''), s: String(i.s || i.severity || '').charAt(0).toUpperCase(),
    m: String(i.m || i.message || '').slice(0, 240), a: fsAttrs(i).slice(0, 4) }));
}
const fsMarkId = (brand, sku, at) => `${at}-${brand}-${sku}`.replace(/[.\/~*\[\]`]/g, '_');
// The newest Seller Central record still followed for a listing (not undone, not yet ✅), or null.
function fsScOpen(brand, sku) {
  const r = FS.recs.find(x => x.by === 'sc' && x.mark && x.brand === brand && x.sku === sku);
  return r && r.state !== 'fixed' ? r : null;
}
/** "I fixed this in Seller Central": a record of the issues Amazon shows now on that listing, who and when — Sellora follows it like
 *  its own fix. Nothing is sent to Amazon. → the record's id, or '' (no issue known to follow). */
function fsScMark(brand, sku) {
  const fi = fsScIssues(brand, sku);
  if (!brand || !sku || !fi.length) return '';
  const at = Date.now();
  const id = fsMarkId(brand, sku, at);
  const by = typeof sqBy === 'function' ? sqBy() : String((ME && ME.email) || '');
  const rec = { brand, sku, fi, at, by, name: typeof sqName === 'function' ? sqName(by) : by, how: 'mark' };
  FS.marks = Object.assign({}, FS.marks, { [id]: rec });
  FS.marksV++;
  FS.sig = null;
  fsRefresh();
  fsScRedraw();
  setTimeout(fsScRedraw, FS_UNDO_MS + 500);                       // the Undo goes after a minute
  if (!fsTest()) { try { setDoc(doc(db, 'history', 'fixsc'), { recs: { [id]: rec }, at: at }, { merge: true }).catch(e => { FS.err = String((e && e.message) || e); }); } catch (e) { /* kept here */ } }
  return id;
}
// May this person still undo that record? Their own, within a minute.
function fsScMayUndo(id) {
  const m = FS.marks[id];
  const me = typeof sqBy === 'function' ? sqBy() : String((ME && ME.email) || '');
  return !!(m && !m.del && m.how === 'mark' && m.by === me && Date.now() - m.at < FS_UNDO_MS);
}
/** Undo (1 minute, the same person): the record is dropped — kept as undone in the shared document. */
function fsScUndo(id) {
  if (!fsScMayUndo(id)) return false;
  const delAt = Date.now();
  FS.marks = Object.assign({}, FS.marks, { [id]: Object.assign({}, FS.marks[id], { del: true, delAt }) });
  FS.marksV++;
  FS.sig = null;
  fsRefresh();
  fsScRedraw();
  if (!fsTest()) { try { setDoc(doc(db, 'history', 'fixsc'), { recs: { [id]: { del: true, delAt } }, at: delAt }, { merge: true }).catch(() => {}); } catch (e) { /* kept here */ } }
  return true;
}
// The other people's records (and the auto-detected ones): the shared document, laid over what this browser holds.
async function fsScLoad() {
  try {
    const snap = await getDoc(doc(db, 'history', 'fixsc'));
    const recs = snap.exists() ? (snap.data() || {}).recs || {} : {};
    const next = Object.assign({}, FS.marks);
    Object.keys(recs).forEach(id => { next[id] = Object.assign({}, next[id] || {}, recs[id]); });
    FS.marks = next;
    FS.marksV++;
  } catch (e) { /* none yet */ }
}
/** The button on an Amazon error row (Listing Errors, Listing Health's listing panel): "I fixed this in Seller Central"; once marked,
 *  "✓ Marked as fixed in Seller Central" (+ Undo for a minute). '' for someone who is not a Listing user, or no Amazon issue known. */
function fsScBtnHtml(brand, sku) {
  if (!FS.on || !brand || !sku) return '';
  const open = fsScOpen(brand, sku);
  if (open) {
    const undo = fsScMayUndo(open.mark) ? ` <button type="button" class="ghost fs-scb fs-undo" data-fs-undo="${fsEsc(open.mark)}">Undo</button>` : '';
    return `<span class="fs-scdone" title="Marked by ${fsEsc(open.who || 'auto-detection')} ${fsEsc(fsWhen(open.at))} — Sellora follows it until Amazon no longer shows it">✓ Marked as fixed in Seller Central</span>${undo}`;
  }
  if (!fsScIssues(brand, sku).length) return '';
  return `<button type="button" class="ghost fs-scb" data-fs-sc="${fsEsc(brand + '|' + sku)}" title="Saves that you fixed it in Seller Central — nothing is sent to Amazon. Sellora follows it: ✅ when Amazon no longer shows it.">I fixed this in Seller Central</button>`;
}
// Redraw the screens that show the button.
function fsScRedraw() {
  try { if (typeof leRender === 'function' && $('leList') && !($('paneLerr') && $('paneLerr').classList.contains('hide'))) leRender(); } catch (e) { /* drawn next time */ }
  try { if (typeof LK !== 'undefined' && LK.key && typeof lkRender === 'function') lkRender(true); } catch (e) { /* drawn next time */ }
}
/** Mark one item as seen, for this user: it leaves the bell's count and panel, and stays in the full list. */
async function fsMarkSeen(id) {
  if (!id || FS.seen.has(id)) return;
  FS.seen.add(id);
  try { localStorage.setItem('sellora.' + fsSeenId(), JSON.stringify([...FS.seen].slice(-2000))); } catch (e) { /* private window */ }
  fsBellDraw();
  if (FS.open) fsPanelDraw();
  if (fsTest()) return;
  try { await setDoc(doc(db, 'history', fsSeenId()), { seen: { [id]: Date.now() }, at: serverTimestamp() }, { merge: true }); } catch (e) { /* kept in this browser */ }
}
// The fixes: the Listing History rows (LH.rows when that page has read them, else the newest documents — new-listings.js nlLoadLh).
async function fsLoadRows(force) {
  if (typeof LH !== 'undefined' && Array.isArray(LH.rows) && !LH.loading && !LH.err && !force) return (FS.rows = LH.rows);
  if (force && typeof NL !== 'undefined') NL.lh = null;
  if (typeof nlLoadLh === 'function') { try { FS.rows = await nlLoadLh(); } catch (e) { FS.err = String((e && e.message) || e); } }
  return FS.rows;
}
/** A send just logged (lhistAdd): its rows count at once, before the next read of the history. */
function fsNoteSent(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const have = new Set((FS.rows || []).map(r => r.id));
  FS.rows = rows.filter(r => !have.has(r.id)).map(r => Object.assign({ kind: 'listing' }, r)).concat(FS.rows || []);
  FS.sig = null;
  fsRefresh();
}

/* ----- working it out, and keeping the shared watch and summary up to date ----- */
function fsRefresh() {
  if (!FS.on) return;
  const sig = [FS.rows, FS.watch, typeof lmVersion === 'function' ? lmVersion() : 0, typeof LM !== 'undefined' ? LM.ov : 0,
    typeof LI_WS !== 'undefined' ? LI_WS.liveV : 0, FS.seen.size, FS.marksV, Math.floor(Date.now() / 600000)];
  if (FS.sig && FS.sig.length === sig.length && FS.sig.every((x, i) => x === sig[i])) return;
  FS.sig = sig;
  FS.recs = fsCompute(FS.rows || [], { fresh: fsFresh, pics: fsPics, sc: (FS.watch && FS.watch.sc) || {}, marks: FS.marks, now: Date.now() });
  fsBellDraw();
  if (FS.open) fsPanelDraw();
  fsPageDraw();
  fsKidRedraw();
  fsShare();
}
// The watch (Seller Central fixes) and the summary the daily email reads — at most every 10 minutes, never on the test site.
async function fsShare() {
  if (fsTest() || FS.busy || Date.now() - FS.watchAt < FS_WATCH_MS || typeof HEALTH === 'undefined') return;
  const cur = fsWatchNow();
  if (!cur.size) return;
  FS.busy = true;
  FS.watchAt = Date.now();
  try {
    await fsScLoad();                                              // the other people's Seller Central records first
    const snap = await getDoc(doc(db, 'history', 'fixwatch'));
    const saved = snap.exists() ? snap.data() || {} : {};
    const next = fsWatchStep(saved, cur, FS.rows || [], Date.now(), FS.marks);
    // written only when what it knows changed (an error came or went, a value changed) — not every 10 minutes by every Listing user
    if (JSON.stringify([next.e, next.sc, next.v]) !== JSON.stringify([saved.e || {}, saved.sc || {}, saved.v || {}]) || !saved.at) await setDoc(doc(db, 'history', 'fixwatch'), { at: next.at, e: next.e, sc: next.sc, v: next.v });
    else next.at = saved.at;
    // auto-detected (a value changed in Seller Central while an error stays): one record each, followed like a person's mark
    if (next.auto.length) {
      const add = {};
      next.auto.forEach(a => { const id = 'auto-' + fsMarkId(a.brand, a.sku, a.at); if (!FS.marks[id]) add[id] = a; });
      if (Object.keys(add).length) {
        FS.marks = Object.assign({}, FS.marks, add);
        FS.marksV++;
        await setDoc(doc(db, 'history', 'fixsc'), { recs: add, at: Date.now() }, { merge: true });
      }
    }
    delete next.auto;
    FS.watch = next;
    const alerts = fsAlerts(FS.recs).slice(0, 200).map(r => ({ brand: r.brand, sku: r.sku, state: r.state, issue: String(r.issue || '').slice(0, 200),
      at: r.at, who: r.who, hint: r.hint || '', err: r.newErr ? r.newErr.m.slice(0, 200) : '', done: fsDoneWords(r) }));
    const sumSig = JSON.stringify(alerts.map(a => [a.brand, a.sku, a.state, a.issue, a.at]));
    if (sumSig !== FS.sumSig) {
      FS.sumSig = sumSig;
      await setDoc(doc(db, 'history', 'fixstatus'), { at: Date.now(), items: alerts, fixedToday: fsFixedToday() });
    }
  } catch (e) { FS.err = String((e && e.message) || e); }
  FS.busy = false;
  FS.sig = null;
  fsRefresh();
}
const fsFixedToday = () => { const d = new Date(); const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); return FS.recs.filter(r => (r.state === 'fixed' || r.state === 'scfixed') && r.confirmedAt >= day).length; };

/* ----- 3. the bell ----- */
/** Listing users only: the same rule as Listing History's menu entry (an admin, or Image Manager / Listing Errors / Listing Health /
 *  Listing Rules / Listing Optimiser). */
function fsMay() {
  if (typeof ME === 'undefined' || !ME) return false;
  if (ME.admin) return true;
  const tabs = typeof LH_LISTING_TABS !== 'undefined' ? LH_LISTING_TABS : ['img', 'lerr', 'health', 'lrules', 'opt'];
  return Array.isArray(ME.tabs) && tabs.some(t => ME.tabs.includes(t));
}
const fsUnseen = () => fsAlerts(FS.recs).filter(r => !FS.seen.has(r.id));
function fsBellDraw() {
  const btn = $('fsBell');
  if (!btn) return;
  btn.hidden = !FS.on;
  const n = FS.on && !fsLocal() ? fsUnseen().length : 0;          // no red count at 0, nor on a test / local copy
  const badge = btn.querySelector ? btn.querySelector('.fs-badge') : null;
  if (badge) { badge.hidden = !n; badge.textContent = n > 99 ? '99+' : String(n); }
  btn.setAttribute('aria-label', n ? `Fix status: ${n} not accepted by Amazon` : 'Fix status: nothing waiting');
  btn.title = n ? `${n} fix${n === 1 ? '' : 'es'} not accepted by Amazon` : 'Fix status — nothing rejected by Amazon';
  btn.classList.toggle('has-n', !!n);
}
// Where a fix was done, in words: "Sellora" / "Seller Central (marked by Asha K)" / "Seller Central (auto-detected)" / "Seller Central".
const fsDoneWords = r => (r.by !== 'sc' ? 'Sellora' : r.how === 'mark' ? `Seller Central (marked by ${r.who || 'someone'})` : r.how === 'auto' ? 'Seller Central (auto-detected)' : 'Seller Central');
// What an item says: "fixed 26 hours ago — Amazon still shows it" / "New error after fix: …".
function fsItemWords(r, now) {
  if (r.state === 'newerr') return `New error after fix${r.newErr && r.newErr.m ? ': ' + r.newErr.m : ''}`;
  if (r.state === 'still') return `fixed ${fsHours(now - r.at)} ago — Amazon still shows it`;
  if (r.state === 'checking') return `fixed ${fsHours(now - r.at)} ago — checking`;
  if (r.state === 'scfixed') return `fixed in Seller Central ${fsDate(r.at)}`;
  return `fixed — confirmed ${fsDate(r.confirmedAt)}`;
}
const fsIssueWords = r => String(r.issue || r.field || '').replace(/\s+/g, ' ').slice(0, 140) + (r.code ? ` (${r.code})` : '');
// One item in the bell: SKU · the issue in plain words · "fixed 26 hours ago — Amazon still shows it" · Open listing · Mark as seen.
const fsItemHtml = (r, t) => `<li class="fs-it is-${r.state}"><div class="fs-it-h"><span class="fs-st" aria-hidden="true">${r.state === 'newerr' ? '❌' : '⚠️'}</span>`
  + `<b class="fs-sku">${fsEsc(r.sku)}</b><span class="muted">${fsEsc(fsBrandName(r.brand))}${r.by === 'sc' && r.how === 'mark' && r.who ? ' · marked by ' + fsEsc(r.who) : r.how === 'auto' ? ' · auto-detected' : ''}</span></div>`
  + `<div class="fs-it-i">${fsEsc(fsIssueWords(r))}</div><div class="fs-it-w">${fsEsc(fsItemWords(r, t))}</div>${r.hint ? `<div class="fs-it-hint">${fsEsc(r.hint)}</div>` : ''}`
  + `<div class="fs-it-a"><button type="button" class="ghost fs-b" data-fs-open="${fsEsc(r.brand + '|' + r.sku)}">Open listing</button>`
  + `<button type="button" class="ghost fs-b" data-fs-seen="${fsEsc(r.id)}">Mark as seen</button></div></li>`;
const FS_SECS = [['sellora', 'Done in Sellora'], ['sc', 'Done in Seller Central']];
// One section: ▸ Done in Sellora (N) — a click opens it (▾); 0 → "✅ Nothing rejected".
function fsSecHtml(k, title, items, t) {
  const open = !!FS.sec[k];
  const n = items.length;
  const shown = items.slice(0, 12);
  const body = n ? `<ul class="fs-list">${shown.map(r => fsItemHtml(r, t)).join('')}</ul>${n > shown.length ? `<div class="fs-more muted">+ ${n - shown.length} more in Fix status</div>` : ''}`
    : '<div class="fs-sec-0">✅ Nothing rejected</div>';
  return `<div class="fs-sec${open ? ' is-open' : ''}${n ? '' : ' is-0'}"><button type="button" class="fs-sec-h" data-fs-sec="${k}" aria-expanded="${open}">`
    + `<span class="fs-arr" aria-hidden="true">${open ? '▾' : '▸'}</span><span class="fs-sec-t">${fsEsc(title)} (${n})</span>`
    + `${!n && !open ? '<span class="fs-sec-ok">✅ Nothing rejected</span>' : ''}</button>${open ? `<div class="fs-sec-b">${body}</div>` : ''}</div>`;
}
function fsPanelHtml(now) {
  const t = now || Date.now();
  const head = '<div class="fs-p-h"><b>Not accepted by Amazon</b><button type="button" class="fs-x" data-fs-close="1" aria-label="Close">×</button></div>';
  const foot = '<div class="fs-p-f"><span></span><button type="button" class="fs-all" data-fs-all="1">See all fix status →</button></div>';
  // a test site / a local copy: nothing is sent to Amazon from it — its own words first, then what is there
  const local = fsLocal() ? '<div class="fs-empty">Test site — fixes aren\'t sent to Amazon here, so there\'s nothing to track. Real fix status shows on live Sellora.</div>' : '';
  if (!FS.loaded) return head + local + '<div class="fs-empty muted">Checking your fixes against Amazon…</div>' + foot;
  // ONLY what Amazon has not accepted (⚠️ still showing after 24 h, ❌ a new error after the fix) — ✅ / ⏳ are in Fix status only
  const items = fsUnseen();
  const by = k => items.filter(r => (k === 'sc' ? r.by === 'sc' : r.by !== 'sc'));
  if (!items.length && !local) {
    const seen = fsAlerts(FS.recs).length;
    return head + '<div class="fs-empty is-ok">✅ All fixes accepted by Amazon — nothing waiting.</div>'
      + (seen ? `<div class="fs-empty-sub muted">${seen} you marked as seen ${seen === 1 ? 'is' : 'are'} still in Fix status.</div>` : '') + foot;
  }
  return head + local + `<div class="fs-secs">${FS_SECS.map(([k, title]) => fsSecHtml(k, title, by(k), t)).join('')}</div>` + foot;
}
function fsPanelDraw() {
  const box = $('fsPanel');
  if (!box) return;
  box.innerHTML = fsPanelHtml();
}
function fsPanel(open) {
  const box = $('fsPanel');
  const btn = $('fsBell');
  FS.open = !!open && FS.on;                                     // the bell shows only when FS.on: a click on it always opens this
  if (!box) return;
  // the panel lives on the page itself, so nothing in the menu bar can clip or cover it
  if (FS.open && typeof document !== 'undefined' && document.body && box.parentNode && box.parentNode !== document.body && document.body.appendChild) document.body.appendChild(box);
  box.hidden = !FS.open;
  if (btn) btn.setAttribute('aria-expanded', String(FS.open));
  if (!FS.open) return;
  fsPanelDraw();
  try {
    const r = btn.getBoundingClientRect();
    const w = Math.min(380, window.innerWidth - 24);
    box.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w)) + 'px';
    box.style.top = Math.round(r.bottom + 8) + 'px';
  } catch (e) { /* placed by the CSS */ }
}
/** Open listing: Listing Health, Child listings, searched to that SKU, its panel opened. */
function fsOpenListing(brand, sku) {
  fsPanel(false);
  if (typeof showTab !== 'function') return;
  if ($('hBrandView')) $('hBrandView').value = brand;
  if ($('hIssueView')) $('hIssueView').value = 'ALL';
  if ($('hFilter')) $('hFilter').value = sku;
  if (typeof H_VIEW !== 'undefined') H_VIEW = 'child';
  showTab('health');
  setTimeout(() => {
    try { if (typeof renderHealth === 'function' && typeof H_LOADED !== 'undefined' && H_LOADED) renderHealth(); if (typeof lkOpen === 'function') lkOpen(brand + '|' + sku); } catch (e) { /* the search shows it */ }
  }, 300);
}

/* ----- 4. the full list: Listing History → Fix status ----- */
function fsPageRecs() {
  const f = FS.f;
  const from = f.range === 'all' ? 0 : Date.now() - Number(f.range || 30) * FS_DAY;
  return FS.recs.filter(r => (!f.brand || r.brand === f.brand) && (!f.state || r.state === f.state) && (!f.who || r.who === f.who)
    && (!f.done || (f.done === 'sc' ? r.by === 'sc' : r.by !== 'sc')) && r.at >= from);
}
function fsPageHtml() {
  if (!FS.on) return '<div class="card lh-empty muted">Fix status is for Listing users.</div>';
  const all = FS.recs;
  const n = s => all.filter(r => r.state === s).length;
  const chip = (s, t) => `<button type="button" class="fs-chip is-${s}${FS.f.state === s ? ' on' : ''}" data-fs-f="state" data-fs-v="${s}" aria-pressed="${FS.f.state === s}">${t} <b>${n(s)}</b></button>`;
  const who = [...new Set(all.map(r => r.who).filter(Boolean))].sort();
  const sel = (k, label, list) => `<select data-fs-sel="${k}" aria-label="${label}"><option value="">${label}</option>${list.map(([v, t]) => `<option value="${fsEsc(v)}"${FS.f[k] === v ? ' selected' : ''}>${fsEsc(t)}</option>`).join('')}</select>`;
  const recs = fsPageRecs();
  const now = Date.now();
  const rows = recs.map(r => `<tr class="fs-row is-${r.state}"><td class="ui-mono">${fsEsc(r.sku)}</td><td>${fsEsc(fsBrandName(r.brand))}</td>`
    + `<td class="fs-issue">${fsEsc(fsIssueWords(r))}${r.newErr ? `<small class="fs-new">New error: ${fsEsc(r.newErr.m.slice(0, 160))}</small>` : ''}</td>`
    + `<td>${fsEsc(fsDoneWords(r))}</td><td>${fsEsc(r.who || '—')}</td><td>${fsWhen(r.at)}</td><td>${r.readAt ? fsWhen(r.readAt) : '<span class="muted">not yet</span>'}</td>`
    + `<td class="fs-state"><span class="fs-tag is-${r.state}">${FS_STATES[r.state]}</span>${r.state === 'still' || r.state === 'checking' ? `<small>${fsEsc(fsHours(now - r.at))} since the fix</small>` : ''}</td>`
    + `<td class="fs-hint">${fsEsc(r.hint || '')}</td><td><button type="button" class="ghost lh-b" data-fs-open="${fsEsc(r.brand + '|' + r.sku)}">Open listing</button></td></tr>`).join('');
  return `<div class="fs-chips" role="group" aria-label="State">${chip('fixed', '✅ Fixed')}${chip('checking', '⏳ Checking')}${chip('still', '⚠️ Still on Amazon')}${chip('newerr', '❌ New error')}${chip('scfixed', 'Fixed in Seller Central')}</div>`
    + `<div class="card lh-tb"><div class="toolbar">${sel('brand', 'Both brands', [['SP', 'Ridhi'], ['CPC', 'CPC']])}${sel('state', 'Any state', Object.keys(FS_STATES).map(k => [k, FS_STATES[k]]))}`
    + `${sel('done', 'Done in: anywhere', [['sellora', 'Done in: Sellora'], ['sc', 'Done in: Seller Central']])}`
    + `${sel('who', 'Everyone', who.map(w => [w, w]))}${sel('range', 'Sent in', [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['all', 'Everything held']])}`
    + `<span style="flex:1"></span><button type="button" class="ghost" data-fs-reload="1">Refresh</button><button type="button" class="ghost" data-fs-csv="1">Download (CSV)</button></div>`
    + `<div class="lh-count muted">Results: ${recs.length} · checked against Amazon's newest read of each listing (the auto refresh every ~15 min, and Check now) — nothing is sent to Amazon here${FS.err ? ' · ' + fsEsc(FS.err) : ''}</div></div>`
    + (recs.length ? `<div class="card xlwrap lh-wrap"><table class="xl lh-tbl fs-tbl"><thead><tr><th>SKU</th><th>Brand</th><th>Issue</th><th>Done in</th><th>Who</th><th>Sent at</th><th>Last checked</th><th>State</th><th>Hint</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : fsLocal() && !all.length ? '<div class="card lh-empty"><b>Test site — fixes aren\'t sent to Amazon here, so there\'s nothing to track.</b> Real fix status shows on live Sellora.</div>'
        : `<div class="card lh-empty"><b>No fixes ${FS.rows ? 'match these filters' : 'read yet'}.</b> ${FS.rows ? '' : 'Reading Listing History…'}</div>`);
}
function fsPageDraw() {
  const box = $('fsPage');
  if (box && !box.classList.contains('hide')) box.innerHTML = fsPageHtml();
}
const FS_CSV_COLS = ['SKU', 'Brand', 'Issue', 'Code', 'Done in', 'Who', 'Sent at', 'Last checked', 'State', 'New error', 'Hint'];
function fsCsv(recs) {
  const q = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const iso = ms => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '');
  return '﻿' + [FS_CSV_COLS.join(',')].concat(recs.map(r => [r.sku, fsBrandName(r.brand), r.issue, r.code, fsDoneWords(r), r.who || '',
    iso(r.at), iso(r.readAt), FS_STATES[r.state], r.newErr ? r.newErr.m : '', r.hint].map(q).join(','))).join('\r\n') + '\r\n';
}
function fsDownload() {
  const text = fsCsv(fsPageRecs());
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `Sellora-fix-status-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { /* no download here */ }
  return text;
}

/* ----- 5. Listing Health's listing panel: one line ----- */
/** "Fixed in Sellora on 24 Nov — ⚠️ Amazon still shows it (26 h)" / "✅ Fixed — confirmed 24 Nov" for the newest fix of that listing, or ''. */
function fsKidLine(brand, sku) {
  if (!FS.on) return '';
  const r = FS.recs.find(x => x.brand === brand && x.sku === sku && (x.by === 'sellora' || x.mark));
  if (!r) return '';
  const h = Math.max(0, Math.round((Date.now() - r.at) / 3600000));
  const where = r.by === 'sc' ? (r.how === 'auto' ? 'Changed in Seller Central (auto-detected)' : 'Marked fixed in Seller Central') : 'Fixed in Sellora';
  const text = r.state === 'fixed' ? `✅ Fixed — confirmed ${fsDate(r.confirmedAt)}`
    : r.state === 'still' ? `${where} on ${fsDate(r.at)} — ⚠️ Amazon still shows it (${h} h)`
      : r.state === 'newerr' ? `${where} on ${fsDate(r.at)} — ❌ a new error appeared after the fix`
        : `${where} on ${fsDate(r.at)} — ⏳ checking (${h} h)`;
  return `<div class="lk-info fs-kid is-${r.state}" title="${fsEsc(fsIssueWords(r))}">${fsEsc(text)}${r.hint ? ` · ${fsEsc(r.hint)}` : ''}</div>`;
}
let FS_KID_SIG = '';
function fsKidRedraw() {
  const sig = FS.recs.map(r => r.key + r.state).join();
  if (sig === FS_KID_SIG) return;
  FS_KID_SIG = sig;
  try { if (typeof LK !== 'undefined' && LK.key && typeof lkRender === 'function') lkRender(true); } catch (e) { /* drawn next time */ }
}

/* ----- start: after sign-in, for Listing users ----- */
async function fsStart() {
  if (FS.on) return;
  if (!fsMay()) { fsPanel(false); fsBellDraw(); return; }          // not a Listing user: no bell (also after another account signed in)
  FS.on = true;
  fsBellDraw();
  await Promise.all([fsSeenLoad(), fsLoadRows(false), fsScLoad(), typeof lmEnsure === 'function' ? Promise.resolve(lmEnsure()).catch(() => {}) : null,
    (async () => { try { const s = await getDoc(doc(db, 'history', 'fixwatch')); if (s.exists()) FS.watch = s.data() || null; } catch (e) { /* none yet */ } })()]);
  FS.loaded = true;
  FS.sig = null;
  fsRefresh();
  clearInterval(FS.timer);
  FS.timer = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') fsRefresh(); }, 30000);
}
if (typeof document !== 'undefined' && document.addEventListener) {
  const bell = $('fsBell');
  if (bell) bell.addEventListener('click', e => {
    e.stopPropagation();
    if (!FS.on && fsMay()) fsStart();                              // the rights came after the start-up check: start now (FS.on at once)
    fsPanel(!FS.open);
  });
  document.addEventListener('click', e => {
    const on = sel => (e.target && e.target.closest ? e.target.closest(sel) : null);
    const open = on('[data-fs-open]');
    if (open) { const [b, ...rest] = open.dataset.fsOpen.split('|'); return fsOpenListing(b, rest.join('|')); }
    const seen = on('[data-fs-seen]');
    if (seen) return fsMarkSeen(seen.dataset.fsSeen);
    const sec = on('[data-fs-sec]');
    if (sec) { e.stopPropagation(); return fsSecToggle(sec.dataset.fsSec); }
    const sc = on('[data-fs-sc]');
    if (sc) { e.stopPropagation(); const [b, ...rest] = sc.dataset.fsSc.split('|'); return fsScMark(b, rest.join('|')); }
    const undo = on('[data-fs-undo]');
    if (undo) { e.stopPropagation(); return fsScUndo(undo.dataset.fsUndo); }
    if (on('[data-fs-close]')) return fsPanel(false);
    if (on('[data-fs-all]')) { fsPanel(false); if (typeof lhView === 'function') lhView('fix'); if (typeof showTab === 'function') showTab('lhist'); return; }
    const chip = on('[data-fs-f]');
    if (chip) { FS.f.state = FS.f.state === chip.dataset.fsV ? '' : chip.dataset.fsV; return fsPageDraw(); }
    if (on('[data-fs-csv]')) return fsDownload();
    if (on('[data-fs-reload]')) { FS.sig = null; return fsLoadRows(true).then(() => { FS.sig = null; fsRefresh(); }); }
    if (FS.open && !on('#fsPanel') && !on('#fsBell')) fsPanel(false);
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el && el.dataset && el.dataset.fsSel) { FS.f[el.dataset.fsSel] = el.value; fsPageDraw(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && FS.open) fsPanel(false); });
  try {
    onAuthStateChanged(auth, async user => {
      // a new sign-in starts clean: another person's marks never carry over
      FS.on = false; FS.loaded = false; FS.seen = new Set(); FS.seenLoaded = false; FS.recs = []; FS.sig = null; FS.sec = { sellora: false, sc: false }; fsPanel(false);
      if (!user) { fsBellDraw(); return; }
      const email = String(user.email || '').toLowerCase();
      /* Start once THIS account's rights say Listing: ME is this e-mail and its rights (read by loadMyPerms) include a Listing tab. Asked
         every 250 ms for 30 s, then every 5 s for 2 minutes. NOT "wait for TAB_OK": TAB_OK is a function from page load (core/nav.js's
         placeholder), and applyPerms may run before or after this hook — the bell then started before the rights were known, or waited
         for a change that had already happened, and stayed off: the click did nothing (24 Nov 2026). Not a Listing user: never started. */
      const mine = () => !!auth.currentUser && String(auth.currentUser.email || '').toLowerCase() === email;
      for (let i = 0; i < 144 && !FS.on; i++) {
        if (!mine()) return;                                                                       // another sign-in since
        if (ME && ME.email === email && fsMay()) { fsStart(); break; }
        await new Promise(r => setTimeout(r, i < 120 ? 250 : 5000));
      }
      if (!FS.on && mine()) fsBellDraw();                                                          // not a Listing user: the bell stays hidden
    });
  } catch (e) { /* the bell stays hidden */ }
}
