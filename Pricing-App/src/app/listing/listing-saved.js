/* ============================================================================================================================
 * THE SAVED COPY of the live reads (13 Nov 2026) — one copy in Sellora's database, shared by every user, so the Season planner and
 * the Workspace open INSTANTLY from it and never wait for Amazon to show the screen.
 *
 * WHERE: the existing collection /history (firestore.rules: `match /history/{doc} { allow read, write: if canAny(); }` — every listing
 * user and the Listing Optimiser can already read and write it; NO rule change). Documents `history/lcache_<brand>_<0..9>`, kind
 * "lcache", one map `items` → SKU → its record; a SKU always lands in the same document (a hash of the SKU). They have no `day` field,
 * so Listing History (which lists /history by `day`) never sees them.
 * WHAT, per SKU (only what the planner and the Workspace's content checks read): the content read — title, its length, the hidden search
 * words and their count, the product type, bullets (how many), description (how long), which rule words the text holds, Amazon's brand,
 * and when (c) — and Item Highlights with when they were read (h). About 0.6 KB a SKU: ~0.6 MB per 1,000 SKUs, spread over 10 documents
 * a brand (each well under Firestore's 1 MB).
 * WHEN: written a few seconds after a read lands (svNote), and at once after Amazon accepts a send (svFromSend) — never a second read.
 * Read once when a screen opens (svLoad); a record only ever replaces an OLDER one, so a fresher read in this browser always wins.
 * TEST SITE / LOCAL (saving off) or no access: the browser's own copy (the Workspace's localStorage, 24 h) does the same job.
 * ============================================================================================================================ */
const SV_COLL = 'history';
const SV_SHARDS = 10;                    // documents per brand
const SV_FLUSH_MS = 3000;                // reads landing close together are written in one go
const SV_BG = 2;                         // background reads ("Check all parents") out at once
const SV_RETRY_MS = 3600000;             // a read that failed is tried again after an hour
let SV = {
  state: 'idle',                         // idle | loading | ready | off (test site, no access: the browser copy only)
  loading: null,                         // the promise of the one load
  err: '',                               // the last load or save error
  n: 0,                                  // SKUs taken from the saved copy
  dirty: new Map(),                      // document id → { brand, items: { sku: record } } waiting to be written
  flushT: 0,
  writes: 0,                             // documents written (for the tests and the console)
};
const svIsOff = () => SV.state === 'off' || (typeof window !== 'undefined' && !!window.__TEST_ERP);
function svShard(sku) {
  let h = 0;
  for (const ch of String(sku)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % SV_SHARDS;
}
const svDocId = (brand, sku) => `lcache_${brand}_${svShard(sku)}`;
// One SKU's record from the Workspace's live entry; null when nothing of it was read yet.
function svRec(entry) {
  if (!entry || (!entry.cAt && !entry.hlAt)) return null;
  const r = {};
  if (entry.cAt) Object.assign(r, { c: entry.cAt, t: String(entry.title || ''), tl: entry.titleLen || 0, kw: String(entry.kw || ''), kb: entry.kwBytes || 0, pt: entry.pt || '',
    bul: entry.bul || 0, desc: entry.desc || 0, w: entry.words || {}, br: entry.brand || '' });
  if (entry.hlAt) Object.assign(r, { h: entry.hlAt, hl: (entry.hl || []).slice(0, 10) });
  return r;
}
// A saved record into the live entry — only the parts NEWER than what this browser holds. True when something was taken.
function svMerge(brand, sku, rec) {
  if (!rec || typeof LI_WS === 'undefined' || !LI_WS.live[brand]) return false;
  const entry = liWsEntry(brand, sku);
  let took = false;
  if (rec.c && rec.c > (entry.cAt || 0)) {
    Object.assign(entry, { cAt: rec.c, title: rec.t || '', titleLen: rec.tl || String(rec.t || '').length, kw: rec.kw || '', kwBytes: rec.kb != null ? rec.kb : lrKwBytes(rec.kw || ''),
      pt: rec.pt || entry.pt || '', bul: rec.bul || 0, desc: rec.desc || 0, words: rec.w || {}, cErr: '' });
    if (rec.br) entry.brand = rec.br;
    took = true;
  }
  if (rec.h && rec.h > (entry.hlAt || 0)) {
    Object.assign(entry, { hl: (rec.hl || []).map(String), hlAt: rec.h });
    took = true;
  }
  if (took) entry.at = Math.max(entry.at || 0, rec.c || 0, rec.h || 0);
  return took;
}
/** Read the saved copy once (both brands, every document at the same time) into the live reads. Resolves with how many SKUs it gave. */
function svLoad() {
  if (SV.loading) return SV.loading;
  if (typeof LI_WS !== 'undefined' && !LI_WS.stored && typeof liWsStoreLoad === 'function') liWsStoreLoad();   // the browser copy first
  if (svIsOff()) {
    SV.state = 'off';
    SV.loading = Promise.resolve(0);
    return SV.loading;
  }
  SV.state = 'loading';
  SV.loading = (async () => {
    const ids = ['SP', 'CPC'].flatMap(brand => Array.from({ length: SV_SHARDS }, (_, i) => [brand, `lcache_${brand}_${i}`]));
    let fails = 0;
    const snaps = await Promise.all(ids.map(([brand, id]) => getDoc(doc(db, SV_COLL, id)).then(snap => [brand, snap]).catch(e => { fails++; SV.err = String((e && e.message) || e); return [brand, null]; })));
    let n = 0;
    snaps.forEach(([brand, snap]) => {
      if (!snap || !snap.exists()) return;
      Object.entries((snap.data() || {}).items || {}).forEach(([sku, rec]) => { if (svMerge(brand, sku, rec)) n++; });
    });
    SV.n = n;
    SV.state = fails === ids.length ? 'off' : 'ready';      // no access at all: the browser copy only
    if (n && typeof LI_WS !== 'undefined') {
      LI_WS.liveV++;
      if (typeof liWsStoreSave === 'function') liWsStoreSave();
    }
    return n;
  })();
  return SV.loading;
}
/** A read of this SKU landed (listing-workspace.js): its record is written to the saved copy a few seconds later, with the others. */
function svNote(brand, sku) {
  if (svIsOff() || typeof LI_WS === 'undefined') return;
  const rec = svRec(LI_WS.live[brand] && LI_WS.live[brand][sku]);
  if (!rec) return;
  const id = svDocId(brand, sku);
  if (!SV.dirty.has(id)) SV.dirty.set(id, { brand, items: {} });
  SV.dirty.get(id).items[sku] = rec;
  clearTimeout(SV.flushT);
  SV.flushT = setTimeout(svFlush, SV_FLUSH_MS);
}
// Write what is waiting: one merge per document (only the SKUs that changed are touched; other users' SKUs stay).
async function svFlush() {
  clearTimeout(SV.flushT);
  SV.flushT = 0;
  const work = [...SV.dirty.entries()];
  SV.dirty.clear();
  for (const [id, part] of work) {
    try {
      await setDoc(doc(db, SV_COLL, id), { kind: 'lcache', brand: part.brand, items: part.items, at: serverTimestamp() }, { merge: true });
      SV.writes++;
    } catch (e) { SV.err = String((e && e.message) || e); }   // this browser keeps its copy; the next read writes it again
  }
}
/** Amazon ACCEPTED a send (listing-send-check.js): the values sent become the copy at once — no second read. Returns true when every
 *  change was one the copy holds whole (the hidden search words, Item Highlights), so nothing needs reading again. */
function svFromSend(job) {
  const b = job && job.body;
  if (!b || !b.lfix || typeof LI_WS === 'undefined' || !LI_WS.live[job.brand]) return false;
  const entry = liWsEntry(job.brand, job.sku);
  const now = Date.now();
  const text = p => (p.op === 'delete' ? [] : (p.value || []).map(v => (v && v.value != null ? String(v.value) : '')).filter(Boolean));
  let whole = true;
  (b.patches || []).forEach(p => {
    const name = String(p.path || '').replace('/attributes/', '');
    if (name === 'generic_keyword' && entry.cAt) {
      const kw = text(p).join(' ');
      Object.assign(entry, { kw: kw.slice(0, 300), kwBytes: lrKwBytes(kw), cAt: now });
    } else if (name === LI_WS_HL) Object.assign(entry, { hl: text(p).map(v => v.slice(0, 300)), hlAt: now });
    else whole = false;                                       // a title, bullets, a spec…: the content read after the send fills it
  });
  entry.at = now;
  LI_WS.liveV++;
  if (typeof liWsStoreSave === 'function') liWsStoreSave();
  svNote(job.brand, job.sku);
  return whole;
}
// "just now", "12 min ago", "3 h ago", "2 d ago".
function svAgo(ms) {
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return Math.round(ms / 60000) + ' min ago';
  if (ms < 86400000) return Math.round(ms / 3600000) + ' h ago';
  return Math.round(ms / 86400000) + ' d ago';
}
// "checked 3 h ago" — the OLDEST content read among these listings (honest for a parent: every child is at least this fresh), and how
// many were never read; '' when there are none.
function svCheckedText(items) {
  const at = items.map(item => (item.live && item.live.cAt) || 0);
  if (!at.length) return '';
  const read = at.filter(Boolean);
  const unread = at.length - read.length;
  if (!read.length) return 'not read yet';
  return 'checked ' + svAgo(Date.now() - Math.min(...read)) + (unread ? ` · ${unread} not read yet` : '');
}
