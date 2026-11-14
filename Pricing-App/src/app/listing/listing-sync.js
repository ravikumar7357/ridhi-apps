/* ================= LISTING · SELLORA SYNC: Seller Central (B), the shop page (F) and Sellora kept in step while Sellora is open =================
 * Screens: a small grey status line at the top of Listing Health (Parent ASINs, Child listings and the Workspace):
 *          "Synced 4 min ago · 12 listings changed since 9 AM · next sync in 11 min" [Sync now]; a click on the line opens
 *          "What changed": SKU · error fixed / new error / now showing to shoppers / suppressed · when.
 * ONE LEADER: of all the Sellora browsers open, only one syncs. It holds a small lock (history/lsync_state.lock = { tab, who, beat })
 *   and beats it every LY_BEAT_MS; a lock not beaten for LY_STALE_MS is free, so when that browser closes another takes over within
 *   2 minutes. A browser that claims the lock reads it back before it counts itself the leader (two claiming at once: one wins). A
 *   leader whose tab is hidden for more than 30 minutes lets go. Test site / local (saving off): this browser syncs for itself only.
 * THE CYCLE, every LY_CYCLE_MS (or [Sync now]): about LY_PER_CYCLE listings, in this order — a) B🟢 F🔴 false errors (has Amazon shown
 *   our fix?), b) Error / Amazon-error listings, c) the oldest reads, so the whole catalogue cycles through in a day. Each listing gets
 *   the existing backend reads (?lfix=content 20 SKUs a call, ?lfix=get, ?limg=get — no backend change), LY_INFLIGHT calls at a time,
 *   through the Workspace's queue. Never while a send popup is open; paused while the tab is hidden for more than 30 minutes.
 * EACH READ updates B and F together (the live entry every rule reads), the shared saved copy (lcache, listing-saved.js) and the
 *   shop-side copy (history/lsync_<brand>_<0..19>: status, Amazon's issues, our picture slots and specs, the catalogue's pictures and
 *   title). The leader then bumps lsync_state.v / .shards; every other open Sellora sees the new version at its next beat and merges only
 *   those documents (only newer reads), and its Listing Health / Workspace rows and counts redraw where they are — no reload, no
 *   scroll jump. Both screens judge the same live entries, so their numbers keep matching.
 * WHAT CHANGED: per listing read, before → after: Error gone (error fixed), Error new (new error), shop page now buyable / a false
 *   error now shown (now showing to shoppers), shop page newly not buyable (suppressed). Kept for the day in lsync_state.changes.
 * DATA: only through lsGet / lsSave (listing-bf.js) — the one data door, so this can move to a server timer on another database later
 *   without touching the screens. /history is canAny: no rule change. No `day` field: Listing History never lists these documents.
 * Main functions: lyStart, lyBeat, lyCycle, lyPick, lyPull, lyFlush, lyLineHtml, lyLineDraw.
 * Pricing-App/tests/sync-test.js runs two (and three) browsers over one stub database. */
const LY_CYCLE_MS = 15 * 60 * 1000;       // a sync every 15 minutes
const LY_BEAT_MS = 30 * 1000;             // the leader's heartbeat — and how often every other browser looks for new data
const LY_STALE_MS = 90 * 1000;            // a lock not beaten for this long is free: a takeover within 2 minutes
const LY_HIDDEN_MS = 30 * 60 * 1000;      // a tab hidden this long pauses (a leader lets go)
const LY_PER_CYCLE = 200;                 // listings read per cycle
const LY_INFLIGHT = 2;                    // calls out at a time
const LY_BATCH = 20;                      // SKUs per ?lfix=content call
const LY_SHARDS = 20;                     // shop-side copy documents per brand
const LY_STATE = 'lsync_state';
const LY_KEEP_CHANGES = 300;              // "What changed" entries kept for the day
const LY = {
  tab: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
  on: false,
  leader: false,
  local: false,            // test site / local: syncs for itself, writes nothing
  state: {},               // the last lsync_state read or written: { lock, v, shards, last, changes, day, dayAt, want }
  seen: {},                // document id → the version merged here
  run: null,               // the cycle in progress: { at, n, done, left: Map, before: Map }
  q: [],                   // its reads waiting
  inflight: 0,
  dirty: {},               // shop-side document id → { brand, items }
  touched: new Set(),      // documents (lcache_… and lsync_…) written since the last version bump
  hiddenAt: 0,
  beatT: 0,
  wakeT: 0,
  confirmMs: 1500,         // a claim is read back after this long
  open: false,             // "What changed" showing
  asked: 0,                // [Sync now] pressed here (a follower asks the leader)
  now: () => Date.now(),
};
const lyShard = sku => { let h = 0; for (const ch of String(sku)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % LY_SHARDS; };
const lyDocId = (brand, sku) => `lsync_${brand}_${lyShard(sku)}`;
const lyDay = t => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const lySendOpen = () => typeof sqIsOpen === 'function' && sqIsOpen();
const lyHidden = now => !!(LY.hiddenAt && now - LY.hiddenAt > LY_HIDDEN_MS);
const lyRows = brand => ((typeof HEALTH !== 'undefined' && HEALTH[brand] && HEALTH[brand].rows) || []);
const lyReadAt = entry => (entry ? Math.min(entry.cAt || 0, entry.gAt || 0, entry.iAt || 0) : 0);

/* ----- the leader ----- */
/** Start the sync in this browser (once, after sign-in): the first beat now, then every LY_BEAT_MS. */
async function lyStart() {
  if (LY.on) return;
  LY.on = true;
  LY.local = lsOff();
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      LY.hiddenAt = document.visibilityState === 'hidden' ? LY.now() : 0;
      if (!LY.hiddenAt) { lyPump(); lyBeat(); }
    });
    document.addEventListener('click', lyClick);
  }
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('pagehide', () => { if (LY.leader && !LY.local) lsSave(BF_COLL, LY_STATE, { lock: { tab: LY.tab, beat: 0 } }).catch(() => {}); });
  if (typeof LI_WS !== 'undefined' && !LI_WS.stored && typeof liWsStoreLoad === 'function') liWsStoreLoad();
  if (typeof svLoad === 'function') await svLoad();
  await lyBeat();
  LY.beatT = setInterval(() => { lyBeat(); }, LY_BEAT_MS);
  if (LY.beatT && typeof LY.beatT.unref === 'function') LY.beatT.unref();
}
/** One beat: hold or claim the lock (or stay a follower), take in what the leader wrote, start a cycle when one is due. */
async function lyBeat() {
  const now = LY.now();
  LY.local = LY.local || lsOff();                 // the test site / local: this browser syncs for itself
  try {
    if (LY.local) LY.leader = true;
    else if (lyHidden(now)) {
      if (LY.leader) { LY.leader = false; LY.q = []; await lsSave(BF_COLL, LY_STATE, { lock: { tab: LY.tab, beat: 0 } }); }
      return;
    } else {
      const st = (await lsGet(BF_COLL, LY_STATE)) || {};
      LY.state = st;
      const lock = st.lock || null;
      const mine = !!(lock && lock.tab === LY.tab);
      const free = !lock || !lock.beat || now - lock.beat > LY_STALE_MS;
      if (mine || free) {
        await lsSave(BF_COLL, LY_STATE, { kind: 'lsync', lock: { tab: LY.tab, who: (typeof ME !== 'undefined' && ME.email) || '', beat: now } });
        if (!mine) {                                  // a claim: read it back — of two claiming at once, the last write wins
          if (LY.confirmMs) await new Promise(r => setTimeout(r, LY.confirmMs));
          const again = (await lsGet(BF_COLL, LY_STATE)) || {};
          LY.state = again;
          LY.leader = !!(again.lock && again.lock.tab === LY.tab);
        } else LY.leader = true;
        if (LY.state.lock && LY.state.lock.tab === LY.tab) LY.state.lock.beat = now;
      } else {
        if (LY.leader) LY.q = [];                     // the lock went to another browser: its reads stop here
        LY.leader = false;
      }
      if (!LY.leader) await lyPull(LY.state);
    }
    if (LY.leader) {
      if (LY.run) await lyFlush();                   // mid-cycle: what is read so far reaches the others within a minute
      const last = (LY.state.last && LY.state.last.at) || 0;
      if (!LY.run && (now - last >= LY_CYCLE_MS || (LY.state.want || 0) > last || LY.asked > last)) lyCycle();
    }
  } catch (e) {
    LY.err = String((e && e.message) || e);
  } finally {
    lyLineDraw();
  }
}

/* ----- the cycle ----- */
/** The listings this cycle reads, in order: a) B🟢 F🔴, b) Error / Amazon error, c) the oldest reads. { brand, sku, why }. */
function lyPick(now, max) {
  now = now || LY.now();
  max = max || LY_PER_CYCLE;
  const out = [];
  const seen = new Set();
  const add = (brand, sku, why) => {
    const key = brand + '|' + sku;
    if (seen.has(key) || out.length >= max) return;
    seen.add(key);
    out.push({ brand, sku, why });
  };
  if (typeof bfDue === 'function') bfDue(now).forEach(d => add(d.brand, d.sku, 'false error'));
  const ctx = hCtx();
  const all = [];
  ['SP', 'CPC'].forEach(brand => lyRows(brand).forEach(row => all.push({ brand, row, at: lyReadAt(LI_WS.live[brand] && LI_WS.live[brand][row.sku]) })));
  all.sort((a, b) => a.at - b.at);                   // oldest read first (never read: first of all)
  all.forEach(({ brand, row }) => {
    const kid = liWsChildKept(row, brand, ctx, liWsImlIndex(brand), now);
    if (kid && (kid.bucket === 'critical' || kid.found.some(hit => hit.detector === 'amazon_error' || hit.detector === 'amazon_suppressed'))) add(brand, row.sku, 'error');
  });
  all.forEach(({ brand, row }) => add(brand, row.sku, 'oldest read'));
  return out;
}
// What a listing looks like now, for "What changed": Error or not, the shop page buyable or not, a false error waiting or not.
function lyLook(brand, sku, now) {
  const row = lyRows(brand).find(each => each.sku === sku);
  if (!row) return null;
  const ctx = hCtx();
  const kid = liWsChildKept(row, brand, ctx, liWsImlIndex(brand), now);
  if (!kid) return null;
  const facts = lrFactsOf(lrFresh(Object.assign({}, row, { brand }), ctx), ctx);
  return { err: kid.bucket === 'critical', shop: bfShop(facts.amz), late: kid.found.some(hit => bfOf(kid, hit, ctx, now).who === 'amazon') };
}
function lyChanged(was, now) {
  if (!was || !now) return [];
  const out = [];
  if (was.err && !now.err) out.push('error fixed');
  if (!was.err && now.err) out.push('new error');
  if (was.shop !== 'r' && now.shop === 'r') out.push('suppressed');
  else if ((was.shop === 'r' && now.shop === 'g') || (was.late && !now.late)) out.push('now showing to shoppers');
  return out;
}
/** Start a cycle now (the leader): pick, then queue each listing's reads. */
async function lyCycle() {
  if (LY.run || !LY.leader || lySendOpen()) return false;
  const now = LY.now();
  LY.run = { at: now, n: 0, done: 0, left: new Map(), before: new Map() };
  try { await lyPrep(); } catch (e) { LY.err = String((e && e.message) || e); }
  const items = lyPick(now);
  const run = LY.run;
  run.n = items.length;
  const st = LY.state;
  if (st.day !== lyDay(now)) Object.assign(st, { day: lyDay(now), dayAt: now, changes: [] });   // a new day: "changed since" starts again
  st.last = { at: now, n: items.length, done: false, end: (st.last && st.last.end) || 0 };
  if (!LY.local) await lsSave(BF_COLL, LY_STATE, { last: st.last, day: st.day, dayAt: st.dayAt, changes: st.changes || [] });
  if (!items.length) return lyEnd();
  items.forEach(item => {
    run.before.set(item.brand + '|' + item.sku, lyLook(item.brand, item.sku, now));
    run.left.set(item.brand + '|' + item.sku, 2);    // get + limg; content adds one below
  });
  ['SP', 'CPC'].forEach(brand => {
    const skus = items.filter(item => item.brand === brand).map(item => item.sku);
    for (let i = 0; i < skus.length; i += LY_BATCH) {
      const chunk = skus.slice(i, i + LY_BATCH);
      chunk.forEach(sku => run.left.set(brand + '|' + sku, run.left.get(brand + '|' + sku) + 1));
      LY.q.push({ t: 'content', brand, skus: chunk });
    }
  });
  items.forEach(item => {
    LY.q.push({ t: 'get', brand: item.brand, sku: item.sku });
    LY.q.push({ t: 'limg', brand: item.brand, sku: item.sku });
  });
  lyPump();
  lyLineDraw();
  return true;
}
// What a leader needs before it can judge: the rules, the Listing Health snapshot and the reads already saved.
async function lyPrep() {
  if (typeof LR !== 'undefined' && !LR && typeof lrLoad === 'function') await lrLoad();
  if (typeof H_LOADED !== 'undefined' && !H_LOADED && typeof loadHealthCache === 'function') await loadHealthCache();
  if (typeof LI_WS !== 'undefined' && !LI_WS.stored && typeof liWsStoreLoad === 'function') liWsStoreLoad();
}
// The cycle's reads, LY_INFLIGHT at a time; held while a send popup is open or the tab has been hidden too long.
function lyPump() {
  clearTimeout(LY.wakeT);
  if (!LY.q.length) return;
  if (lySendOpen() || lyHidden(LY.now()) || !LY.leader) {
    if (LY.leader) LY.wakeT = setTimeout(lyPump, 5000);
    return;
  }
  while (LY.inflight < LY_INFLIGHT && LY.q.length) {
    const job = LY.q.shift();
    LY.inflight++;
    const skus = job.skus || [job.sku];
    liWsQueue(Object.assign({ pk: '', units: skus.length }, job, { done: () => {
      LY.inflight--;
      skus.forEach(sku => lyOneDone(job.brand, sku));
      lyPump();
      if (LY.run && !LY.q.length && !LY.inflight) lyEnd();
    } }));
  }
}
// One of a listing's reads landed; with its last one: what changed, and its shop-side record into the copy.
function lyOneDone(brand, sku) {
  const run = LY.run;
  if (!run) return;
  const key = brand + '|' + sku;
  const left = (run.left.get(key) || 1) - 1;
  run.left.set(key, left);
  if (left) return;
  run.done++;
  const now = LY.now();
  const what = lyChanged(run.before.get(key), lyLook(brand, sku, now));
  if (what.length) {
    const list = LY.state.changes || (LY.state.changes = []);
    what.forEach(w => list.unshift({ b: brand, s: sku, w, at: now }));
    if (list.length > LY_KEEP_CHANGES) list.length = LY_KEEP_CHANGES;
  }
  lyNote(brand, sku);
  lyLineSoon();
}
async function lyEnd() {
  const run = LY.run;
  if (!run) return;
  LY.run = null;
  const now = LY.now();
  LY.state.last = { at: run.at, n: run.n, done: true, end: now };
  await lyFlush();
  if (!LY.local) await lsSave(BF_COLL, LY_STATE, { last: LY.state.last, changes: LY.state.changes || [] });
  lyLineDraw();
}

/* ----- the copy every browser reads ----- */
// One listing's shop-side record (what ?lfix=get and ?limg=get brought): kept short — four issues, each message cut.
function lyRec(entry) {
  if (!entry || (!entry.gAt && !entry.iAt && !entry.tAt)) return null;
  const r = {};
  if (entry.gAt) Object.assign(r, { g: entry.gAt, st: (entry.st || []).slice(0, 6), is: (entry.iss || []).slice(0, 4).map(i => ({ s: i.s, c: i.c, m: String(i.m || '').slice(0, 200), a: (i.a || []).slice(0, 4) })),
    sl: entry.slots || [], sp: entry.specs || {}, co: entry.color || '', br: entry.brand || '' });
  if (entry.iAt) Object.assign(r, { i: entry.iAt, cat: entry.cat || [], cp: entry.catPic || {}, cm: entry.catMain || '' });
  if (entry.tAt) Object.assign(r, { ta: entry.tAt, ct: String(entry.catTitle || '').slice(0, 250) });
  return r;
}
/** A shop-side record into this browser's live entry — only the parts NEWER than what it holds. True when something was taken. */
function lyMerge(brand, sku, rec) {
  if (!rec || typeof LI_WS === 'undefined' || !LI_WS.live[brand]) return false;
  const entry = liWsEntry(brand, sku);
  let took = false;
  if (rec.g && rec.g > (entry.gAt || 0)) {
    Object.assign(entry, { gAt: rec.g, st: rec.st || [], iss: rec.is || [], slots: rec.sl || [], specs: rec.sp || {}, color: rec.co || entry.color || '' }, rec.br ? { brand: rec.br } : {});
    took = true;
  }
  if (rec.i && rec.i > (entry.iAt || 0)) {
    Object.assign(entry, { iAt: rec.i, cat: rec.cat || [], catPic: rec.cp || {}, catMain: rec.cm || '', iErr: '' });
    took = true;
  }
  if (rec.ta && rec.ta > (entry.tAt || 0)) {
    Object.assign(entry, { tAt: rec.ta, catTitle: rec.ct || '' });
    took = true;
  }
  if (took) entry.at = Math.max(entry.at || 0, rec.g || 0, rec.i || 0, rec.ta || 0);
  return took;
}
function lyNote(brand, sku) {
  const rec = lyRec(LI_WS.live[brand] && LI_WS.live[brand][sku]);
  if (rec && !LY.local) {
    const id = lyDocId(brand, sku);
    if (!LY.dirty[id]) LY.dirty[id] = { brand, items: {} };
    LY.dirty[id].items[sku] = rec;
  }
  if (typeof svDocId === 'function') LY.touched.add(svDocId(brand, sku));   // its content went to the saved copy (svNote)
}
/** Write what the cycle read so far, then tell every browser: a new version and the documents it touched. */
async function lyFlush() {
  if (LY.local) { LY.touched.clear(); return; }
  const work = Object.entries(LY.dirty);
  LY.dirty = {};
  for (const [id, part] of work) {
    try {
      await lsSave(BF_COLL, id, { kind: 'lsync', brand: part.brand, items: part.items });
      LY.touched.add(id);
    } catch (e) { LY.err = String((e && e.message) || e); }
  }
  if (typeof svFlush === 'function') await svFlush();   // the content reads in the saved copy, before the others are told
  if (!LY.touched.size) return;
  const v = (LY.state.v || 0) + 1;
  const shards = {};
  LY.touched.forEach(id => { shards[id] = v; LY.seen[id] = v; });
  LY.touched.clear();
  LY.state.v = v;
  LY.state.shards = Object.assign({}, LY.state.shards || {}, shards);
  await lsSave(BF_COLL, LY_STATE, { v, shards });
}
/** A follower: merge the documents the leader wrote since this browser last looked, then redraw where the person is. */
async function lyPull(st) {
  const want = Object.entries((st && st.shards) || {}).filter(([id, v]) => v > (LY.seen[id] || 0));
  if (!want.length) return 0;
  let n = 0;
  for (const [id, v] of want) {
    const data = await lsGet(BF_COLL, id).catch(() => null);
    LY.seen[id] = v;
    const brand = (data && data.brand) || id.split('_')[1];
    Object.entries((data && data.items) || {}).forEach(([sku, rec]) => {
      if (id.startsWith('lcache_') ? (typeof svMerge === 'function' && svMerge(brand, sku, rec)) : lyMerge(brand, sku, rec)) n++;
    });
  }
  if (n && typeof LI_WS !== 'undefined') {
    LI_WS.liveV++;
    if (typeof liWsStoreSave === 'function') liWsStoreSave();
    if (typeof liWsAfterRead === 'function') liWsAfterRead();   // Listing Health / the Workspace redraw where they are
  }
  return n;
}

/* ----- the status line ----- */
function lyTime(t) {
  const d = new Date(t);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
const lyAgo = (now, t) => { const m = Math.floor((now - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`; };
const LY_WHAT_CLS = { 'error fixed': 'is-fixed', 'new error': 'is-new', 'now showing to shoppers': 'is-shown', suppressed: 'is-supp' };
/** The line and, when open, the "What changed" list. */
function lyLineHtml(now) {
  now = now || LY.now();
  const st = LY.state || {};
  const last = st.last || {};
  const today = st.day === lyDay(now) ? (st.changes || []) : [];
  const parts = [];
  if (LY.run) parts.push(`Syncing… ${faNfLy(LY.run.done)} of ${faNfLy(LY.run.n)}`);
  else if (last.at && !last.done && !LY.leader) parts.push('Syncing now…');
  else parts.push(last.end ? `Synced ${lyAgo(now, last.end)}` : 'Not synced yet');
  const n = new Set(today.map(c => c.b + '|' + c.s)).size;
  if (st.dayAt && st.day === lyDay(now)) parts.push(`${faNfLy(n)} listing${n === 1 ? '' : 's'} changed since ${lyTime(st.dayAt)}`);
  if (!LY.run) {
    const next = Math.max(0, Math.ceil(((last.at || now) + LY_CYCLE_MS - now) / 60000));
    parts.push(last.at ? `next sync in ${next} min` : 'first sync within a minute');
  }
  const asked = LY.asked && !LY.leader && LY.asked > (last.at || 0) ? ' · asked — the syncing browser starts within a minute' : '';
  const line = `<button type="button" class="ly-line" data-ly-open aria-expanded="${LY.open}" title="What changed today">${lrEsc(parts.join(' · ') + asked)}</button>`;
  const now$ = `<button type="button" class="ghost ly-now" data-ly-now${LY.run ? ' disabled' : ''}>Sync now</button>`;
  const list = LY.open ? `<div class="ly-list">${today.length ? today.slice(0, 100).map(c => `<div class="ly-item"><b>${lrEsc(c.s)}</b><span class="ly-w ${LY_WHAT_CLS[c.w] || ''}">${lrEsc(c.w)}</span><time>${lrEsc(lyTime(c.at))}</time></div>`).join('')
    : '<div class="ly-item"><span>No listing changed yet today.</span></div>'}</div>` : '';
  return line + now$ + list;
}
const faNfLy = n => Number(n || 0).toLocaleString('en-US');
// Drawn at the top of Listing Health (both views and the Workspace); the element is made here, nothing in index.html changes.
function lyLineDraw() {
  try {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const pane = document.getElementById('paneHealth');
    if (!pane) return;
    let el = document.getElementById('lySync');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lySync';
      el.className = 'ly-sync';
      pane.insertBefore(el, pane.firstChild);
    }
    el.innerHTML = lyLineHtml();
  } catch (e) { /* the line is a convenience: never in the way of the screen */ }
}
function lyLineSoon() {
  if (LY.lineT) return;
  LY.lineT = setTimeout(() => { LY.lineT = 0; lyLineDraw(); }, 1000);
}
async function lyClick(e) {
  const btn = e.target && e.target.closest ? e.target.closest('[data-ly-open],[data-ly-now]') : null;
  if (!btn) return;
  if (btn.hasAttribute('data-ly-open')) { LY.open = !LY.open; return lyLineDraw(); }
  return lySyncNow();
}
/** [Sync now]: the leader starts a cycle; any other browser asks the leader (it starts at its next beat, within a minute). */
async function lySyncNow() {
  LY.asked = LY.now();
  if (LY.leader) await lyCycle();
  else if (!LY.local) await lsSave(BF_COLL, LY_STATE, { want: LY.asked }).catch(() => {});
  lyLineDraw();
}
