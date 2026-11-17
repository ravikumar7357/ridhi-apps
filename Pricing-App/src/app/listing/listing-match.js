/* ================= LISTING · LISTING MATCH: Amazon's listing data from the backend's ListingMatch cache, for every Listing screen =================
 * Screens: none of its own. Listing Health, the Workspace, the Image Manager, the Listing Optimiser (its review of one ASIN and the
 *          Season planner), Listing Audit, Family check, BSR Audit and Listing Errors read Amazon's data through THIS file only; the small "Amazon data: 16 Nov 18:30 · next refresh ~13:00" line at the top of
 *          each of those screens is drawn here too (lmAgeDraw).
 * Does: ListingMatch.gs (Pricing-API) reads every listing twice a day (13:00 / 18:00 IST, light passes in between) into its own
 *       spreadsheet: lmMeta, then lmListings_<brand>_<P>_<i> (one record per SKU: status, issues, title, bullets, description, Item
 *       Highlights, search terms, our pictures, stock, the Suppressed report) and lmCatalog_<brand>_<P>_<i> (one record per ASIN: the
 *       title and pictures shoppers see, parent / children, theme values, browse path, sales ranks). lmEnsure reads this browser's
 *       saved copy first (IndexedDB — the screens never wait for the network when it exists), then asks the backend in the background
 *       (?cache=lmMeta, and the brand tabs it names, all at once) and keeps the newer copy.
 *       The ONE read door: lmGet(sku, brand) / lmGetAsin(asin, brand). Nothing else reads the cache tabs, so a later move to another
 *       store (Supabase) changes this file only. Each screen's own data shapes are filled from it here, so the screens' rules, layout and
 *       logic stay exactly as they were:
 *         lmLiveOf     the Workspace's live-read shape (healthOf / lrFresh / lrAmz / lrPictures, the Workspace, the Season planner, B / F)
 *         lmImlApply   the Image Manager list IML (Image Manager, Listing Errors, Family check, the picture rules' fallback)
 *         lmAmzApply   Amazon's status map AMZ (Listing Health's fallback, BSR Audit's family status)
 *         lmHealthApply the Listing Health rows' report facts (status, stock, price, channel) when the cache's report is newer
 *         LR_FYP       Amazon's Suppressed listings report (rule c of the one Suppressed rule, lrShopOf — the rule is unchanged)
 *         lmFcCat      Family check's catalog records (parent, children, theme, values)
 *         lmRanks      BSR Audit's sales ranks
 *         lmParentNamesApply the parents' own names (Listing Audit and every screen that names a parent)
 *         lmReviewFacts the Listing Optimiser's review of one ASIN (the backend judges these facts instead of reading the catalog)
 *       FALLBACK: no cache, a failed read, or a cache older than 24 hours → lmOk is false and every screen uses its own reads (the
 *       snapshots and live reads) exactly as before — never an empty screen, never an error because the cache is missing.
 *       REAL TIME: a live read (a send through sqSendWithCheck, Check now, Read again) is newer than the cache's record, so it is what the
 *       screens show (per part: content, status / issues, pictures, title), until the next ListingMatch pass is newer again.
 *       STALE: a record ListingMatch could not read again in its last pass keeps its old read (stale: 1) — shown as usual, with a small
 *       grey "old data" mark (lmOldHtml).
 * Main functions: lmEnsure, lmRefresh, lmGet, lmGetAsin, lmOk, lmLiveOf, lmImlApply, lmAmzApply, lmHealthApply, lmFcCat, lmRanks,
 *                 lmNoteLive, lmAgeHtml / lmAgeDraw, lmOldHtml, lmStatus (console). Every name starts with lm / LM. */

const LM_MAX_AGE = 24 * 3600000;        // a cache older than this is not used (the age line turns amber)
const LM_PAR = 6;                       // cache tabs read at once
const LM_CHECK_MS = 15 * 60000;         // while the page is open and seen: is there a newer pass?
const LM_FULL_AT = [13, 18];            // ListingMatch's full passes, IST (the "next refresh" in the age line)
const LM_IST_MS = 5.5 * 3600000;        // ListingMatch writes its times in IST ('yyyy-MM-dd HH:mm')
const LM_SLOTS = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'];
const LM_PANES = ['paneHealth', 'paneImg', 'paneOpt', 'paneFam', 'paneBsr', 'paneLerr', 'paneAudit'];   // the screens with the age line
// The spec attributes the Workspace checks (listing-workspace.js LI_WS_SPECS; ListingMatch.gs LM_SPEC_ATTRS keeps the same list)
const LM_SPECS = () => (typeof LI_WS_SPECS !== 'undefined' ? LI_WS_SPECS : ['material', 'color', 'size', 'pattern', 'style', 'item_shape', 'number_of_items', 'theme',
  'care_instructions', 'special_feature', 'item_type_name', 'fabric_type']);
// Listing Health's scope (listing-health.js), read when used
const LM_FBA_RE = () => (typeof H_FBA_RE !== 'undefined' ? H_FBA_RE : /amazon|afn/i);
const LM_BUNDLE_RE = () => (typeof H_BUNDLE_RE !== 'undefined' ? H_BUNDLE_RE : /^RB/i);
const LM_IDB = { name: 'selloraListingMatch', store: 'copy', key: 'v1' };
// state: none (not started) | loading | saved (the browser copy, the backend not answered yet) | ok (the backend's copy) | empty | err
let LM = { meta: null, list: { SP: null, CPC: null }, cat: { SP: null, CPC: null }, v: 0, state: 'none', err: '', from: '',
  ready: null, busy: null, checkedAt: 0, over: { SP: new Map(), CPC: new Map() }, timer: 0, soonT: 0, loadMs: 0, fyp: { SP: false, CPC: false },
  whole: { SP: false, CPC: false } };       // every listings tab of the brand was read in the copy held (lmListOk)
const LM_GOT = new WeakMap();           // raw record → { over, cat, m } (lmGet's merged record, made once)
const LM_ENTRY = new WeakMap();         // merged record → its live-read shape
const LM_LIVE = new Map();              // "brand|sku" → { sig, e } (lmLiveOf, kept until the record or the live read changes)
const LM_FC = new WeakMap();            // catalog record → Family check's shape

/* ----- the browser's saved copy (IndexedDB): one object, read once, written after each newer copy ----- */
// LM_STORE.get() → the saved copy or null; LM_STORE.put(copy). Tests put their own in (lmStoreUse).
let LM_STORE = {
  open() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
      const req = indexedDB.open(LM_IDB.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(LM_IDB.store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async get() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(LM_IDB.store, 'readonly').objectStore(LM_IDB.store).get(LM_IDB.key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async put(copy) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LM_IDB.store, 'readwrite');
      tx.objectStore(LM_IDB.store).put(copy, LM_IDB.key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },
};
const lmStoreUse = store => { LM_STORE = store; };

/* ----- times ----- */
// 'yyyy-MM-dd HH:mm' (IST, as ListingMatch writes it) → ms; 0 when not a time.
function lmTime(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - LM_IST_MS : 0;
}
// When the cache's data was last read: the last pass's end (full or light).
const lmPassAt = () => (LM.meta ? lmTime(LM.meta.finishedAt) || lmTime(LM.meta.lastFull && LM.meta.lastFull.finishedAt) : 0);
const LM_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2026-11-16 18:30' → '16 Nov 18:30' (IST, as written).
function lmFmt(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${+m[3]} ${LM_MON[+m[2] - 1]} ${m[4]}:${m[5]}` : '';
}
// The next full pass, IST: '13:00' or '18:00'.
function lmNextFull(now) {
  const ist = new Date((now || Date.now()) + LM_IST_MS);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const h = LM_FULL_AT.find(hour => hour * 60 > mins);
  return String(h == null ? LM_FULL_AT[0] : h).padStart(2, '0') + ':00';
}

/* ----- is the cache usable? ----- */
/** True when the cache holds this brand and its last pass is at most 24 hours old (without a brand: either brand). */
function lmOk(brand) {
  if (!brand) return lmOk('SP') || lmOk('CPC');
  const list = LM.list[brand];
  const at = lmPassAt();
  return !!(list && list.size && at && Date.now() - at <= LM_MAX_AGE);
}
const lmVersion = () => LM.v;
/** When the cache's data was read, as '16 Nov 18:30' ('' without a cache) — the sync line's "Synced … from the Amazon auto refresh". */
const lmPassWhen = () => (LM.meta ? lmFmt(LM.meta.finishedAt) : '');
/** The saved copy read and, when a backend read is on its way, that read landed: what the background sync waits for before it decides. */
async function lmSettled() {
  await lmEnsure();
  if (LM.busy) await LM.busy;
}

/* ----- loading: the saved copy at once, the backend in the background ----- */
/** Start once (every Listing screen's loader calls it). Resolves as soon as this browser's saved copy is read — never waits for the
 *  network; the backend's newer copy lands later and the screens redraw (lmApply). */
function lmEnsure() {
  if (LM.ready) return LM.ready;
  LM.state = 'loading';
  lmAgeDraw();
  const t0 = Date.now();
  LM.ready = (async () => {
    try {
      const copy = await LM_STORE.get();
      if (copy && copy.meta && copy.list) {
        lmTake(copy.meta, copy.list, copy.cat || {}, 'saved');
        LM.whole = { SP: !!(copy.whole && copy.whole.SP), CPC: !!(copy.whole && copy.whole.CPC) };
        (copy.over || []).forEach(([key, o]) => { const [b, sku] = key.split('|'); if (LM.over[b]) LM.over[b].set(sku, o); });
        LM.state = 'saved';
      }
    } catch (e) { /* no saved copy here (private window, no IndexedDB): the backend's copy comes next */ }
    LM.loadMs = Date.now() - t0;
    if (LM.meta) lmApply();
    else lmAgeDraw();
  })();
  LM.ready.then(() => {
    lmRefresh();
    if (!LM.timer && typeof setInterval === 'function') {
      LM.timer = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') lmRefresh(); }, LM_CHECK_MS);
      if (LM.timer && LM.timer.unref) LM.timer.unref();
    }
  });
  return LM.ready;
}
// The records of one copy into memory: Maps per brand.
function lmTake(meta, list, cat, from) {
  LM.meta = meta;
  ['SP', 'CPC'].forEach(b => {
    LM.list[b] = list[b] ? (list[b] instanceof Map ? list[b] : new Map(Object.entries(list[b]))) : null;
    LM.cat[b] = cat[b] ? (cat[b] instanceof Map ? cat[b] : new Map(Object.entries(cat[b]))) : null;
  });
  LM.from = from;
  LM.v++;
}
// Same pass as the copy held? (then the tabs are not read again)
const lmSameMeta = (a, b) => !!(a && b && a.finishedAt === b.finishedAt && a.kind === b.kind && JSON.stringify(a.parts) === JSON.stringify(b.parts));
// Read tabs LM_PAR at a time: [{ tab, ok, data }].
async function lmReadTabs(tabs) {
  const out = new Array(tabs.length);
  let next = 0;
  const one = async () => {
    while (next < tabs.length) {
      const i = next++;
      try {
        const r = await baCall({ cache: tabs[i] });
        out[i] = { tab: tabs[i], ok: !!(r && r.data && r.data.items), data: r && r.data };
      } catch (e) { out[i] = { tab: tabs[i], ok: false, err: String((e && e.message) || e) }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LM_PAR, tabs.length) }, one));
  return out;
}
/** Ask the backend for a newer pass. A failed or empty answer keeps the copy held (and says so on the age line), never empties it. */
function lmRefresh() {
  if (LM.busy) return LM.busy;
  LM.busy = (async () => {
    try {
      let reply;
      try { reply = await baCall({ cache: 'lmMeta' }); }
      catch (e) { throw Object.assign(new Error(String((e && e.message) || e)), { empty: /nothing cached/i.test(String((e && e.message) || e)) }); }
      const meta = reply && reply.data;
      if (!meta || !meta.parts) throw Object.assign(new Error('the listing cache is empty'), { empty: true });
      LM.checkedAt = Date.now();
      if (LM.meta && LM.from && lmSameMeta(LM.meta, meta)) { LM.state = 'ok'; LM.err = ''; lmAgeDraw(); return false; }
      const jobs = [];
      ['SP', 'CPC'].forEach(b => {
        ((meta.parts.listings || {})[b] || []).forEach(tab => jobs.push({ b, k: 'list', tab }));
        ((meta.parts.catalog || {})[b] || []).forEach(tab => jobs.push({ b, k: 'cat', tab }));
      });
      const got = await lmReadTabs(jobs.map(j => j.tab));
      const list = {}, cat = {}, whole = { SP: false, CPC: false };
      let bad = 0;
      ['SP', 'CPC'].forEach(b => ['list', 'cat'].forEach(k => {
        const mine = jobs.map((j, i) => ({ j, r: got[i] })).filter(x => x.j.b === b && x.j.k === k);
        const into = k === 'list' ? list : cat;
        const old = LM[k][b];
        if (!mine.length) { if (old) into[b] = old; return; }
        const okAll = mine.every(x => x.r.ok);
        if (k === 'list') whole[b] = okAll;
        bad += mine.filter(x => !x.r.ok).length;
        // every tab read: this brand's records are the new pass's; some failed: the old records stay, the read ones replace theirs
        const map = okAll || !old ? new Map() : new Map(old);
        mine.forEach(x => { if (x.r.ok) Object.entries(x.r.data.items).forEach(([key, rec]) => map.set(key, rec)); });
        if (map.size) into[b] = map;
      }));
      if (!Object.keys(list).length) throw new Error('none of the cache tabs could be read');
      lmTake(meta, list, cat, 'net');
      LM.whole = whole;
      lmOverPrune();
      LM.state = 'ok';
      LM.err = bad ? `${bad} of ${jobs.length} cache parts could not be read — their listings keep the last copy` : '';
      lmSave();
      lmApply();
      return true;
    } catch (e) {
      // no cache yet, a failed read: what is held stays; without anything held the screens use their own reads (lmOk is false)
      LM.state = LM.meta ? LM.state === 'loading' ? 'saved' : LM.state : e.empty ? 'empty' : 'err';
      LM.err = String((e && e.message) || e);
      lmAgeDraw();
      return false;
    } finally { LM.busy = null; }
  })();
  return LM.busy;
}
// The copy into this browser (a quota or a private window: the copy in memory still works for this visit).
function lmSave() {
  const obj = m => (m ? Object.fromEntries(m) : null);
  const over = [];
  ['SP', 'CPC'].forEach(b => LM.over[b].forEach((o, sku) => over.push([b + '|' + sku, o])));
  try {
    const p = LM_STORE.put({ v: 1, at: Date.now(), meta: LM.meta, list: { SP: obj(LM.list.SP), CPC: obj(LM.list.CPC) },
      cat: { SP: obj(LM.cat.SP), CPC: obj(LM.cat.CPC) }, over, whole: LM.whole });
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* no storage */ }
}

/* ----- THE READ DOOR ----- */
// Amazon's issue in one shape: s = 'E' | 'W' (as the snapshot and the live reads keep it), c, m, a, e (enforcement actions).
const lmIss = list => (list || []).map(i => Object.assign({ s: String(i.s || i.severity || '').charAt(0).toUpperCase(), c: String(i.c || i.code || ''),
  m: String(i.m || i.message || ''), a: (i.a || i.attrs || i.attributeNames || []).slice(0, 4) }, (i.e || []).length ? { e: i.e.slice() } : {}));
/** One listing as the cache has it, with a newer live read laid over it: { brand, sku, asin, as (status), rs / qty / fba / price / ch
 *  (the reports), t, bl, d, hl, kw, img, va, pt, lvl, psku, iss, inSupReport, fyp, sup, stale, noRead, readAt, cAt / gAt / iAt / tAt
 *  (when each part was read), cat (its catalog record) }. Null when the cache is not usable for the brand or has no such SKU. */
function lmGet(sku, brand) {
  for (const b of brand ? [brand] : ['SP', 'CPC']) {
    if (!lmOk(b)) continue;
    const raw = LM.list[b].get(sku);
    if (raw) return lmMerged(b, raw);
  }
  return null;
}
/** One ASIN's catalog record (what shoppers see): { t, img: { slot: { u, w, h } }, pa, kids, theme, tattrs, vals, bc, rk, brand, readAt }. */
function lmGetAsin(asin, brand) {
  for (const b of brand ? [brand] : ['SP', 'CPC']) {
    if (!lmOk(b) || !LM.cat[b]) continue;
    const rec = LM.cat[b].get(asin);
    if (rec) return rec;
  }
  return null;
}
function lmMerged(b, raw) {
  const over = LM.over[b].get(raw.sku) || null;
  const cat0 = raw.asin && LM.cat[b] ? LM.cat[b].get(raw.asin) || null : null;
  const kept = LM_GOT.get(raw);
  if (kept && kept.over === over && kept.cat === cat0) return kept.m;
  const read = raw.noRead ? 0 : raw.readAt || 0;
  const m = Object.assign({}, raw, { brand: b, iss: lmIss(raw.iss), cAt: read, gAt: read, iAt: cat0 ? cat0.readAt || 0 : 0, tAt: cat0 && cat0.t ? cat0.readAt || 0 : 0, cat: cat0, live: false });
  if (over) {
    // the live read is newer than the cache's: its parts replace the cache's on screen until a newer pass
    if (over.g && over.g.at > m.gAt) Object.assign(m, { as: over.g.as, iss: lmIss(over.g.iss), gAt: over.g.at, stale: 0, live: true }, over.g.hl ? { hl: over.g.hl } : {});
    if (over.i && over.i.at > m.iAt) {
      if (over.i.img) m.img = over.i.img;
      if (over.i.catImg) m.cat = Object.assign({}, m.cat || { asin: raw.asin, pa: [], kids: [], vals: {} }, { img: over.i.catImg });
      m.iAt = over.i.at;
      m.live = true;
    }
    if (over.t && over.t.at > m.tAt) { m.cat = Object.assign({}, m.cat || { asin: raw.asin, pa: [], kids: [], vals: {}, img: {} }, { t: over.t.t }); m.tAt = over.t.at; }
  }
  LM_GOT.set(raw, { over, cat: cat0, m });
  return m;
}
/** A live read landed (Check now, Read again, a send's re-read): it is kept beside the cache's record and wins while it is newer.
 *  kind 'get' = ?lfix=get (status, issues, Item Highlights, the catalog title); 'limg' = ?limg=get (our pictures, the catalog's). */
function lmNoteLive(brand, sku, kind, reply) {
  if (!LM.over[brand] || !reply) return;
  const now = Date.now();
  const o = Object.assign({}, LM.over[brand].get(sku) || {});
  if (kind === 'get') {
    const at = reply.attributes || {};
    o.g = { at: now, as: (reply.status || []).join(','),
      iss: (reply.issues || []).map(issue => { const x = lmIss([issue])[0]; const acts = lrIssueActs(issue); if (acts.length) x.e = acts; else delete x.e; return x; }),
      hl: at.title_differentiation ? at.title_differentiation.map(v => String((v && v.value) || '')).filter(Boolean) : null };
  } else if (kind === 'limg') {
    // the catalogue did not answer (catalogError): what Amazon serves is not known — never an empty "serves nothing"
    const cat = !reply.catalogError && reply.catalog && typeof reply.catalog === 'object' ? reply.catalog : null;
    o.i = { at: now, img: reply.listing && typeof reply.listing === 'object' ? Object.fromEntries(Object.entries(reply.listing).filter(([, u]) => u)) : null,
      catImg: cat ? Object.fromEntries(Object.entries(cat).filter(([, v]) => v && v.link).map(([slot, v]) => [slot, { u: v.link, w: Number(v.w) || 0, h: Number(v.h) || 0 }])) : null };
  }
  if (reply.title) o.t = { at: now, t: String(reply.title).slice(0, 300) };
  LM.over[brand].set(sku, o);
  if (!lmOk(brand)) return;
  lmImlPatch(brand, sku);
  lmAmzPatch(brand, sku);
  lmSoon();
}
// A newer pass read the listing again: its live read is no longer newer, so it goes.
function lmOverPrune() {
  ['SP', 'CPC'].forEach(b => LM.over[b].forEach((o, sku) => {
    const raw = LM.list[b] && LM.list[b].get(sku);
    if (!raw) return;
    const cat = raw.asin && LM.cat[b] ? LM.cat[b].get(raw.asin) : null;
    const newest = Math.max(o.g ? o.g.at : 0, o.i ? o.i.at : 0, o.t ? o.t.at : 0);
    if (newest <= Math.min(raw.readAt || 0, cat ? cat.readAt || Infinity : Infinity)) LM.over[b].delete(sku);
  }));
}

/* ----- the Workspace's live-read shape (healthOf and every screen that judges a listing read it through lrLiveOf) ----- */
// The cache's record as a live read: content (cAt), status / issues / our slots / Item Highlights (gAt), the catalog's pictures (iAt),
// the catalog's title (tAt) — the same fields liWsJob writes, so the rules read it unchanged.
function lmEntryOf(m) {
  if (LM_ENTRY.has(m)) return LM_ENTRY.get(m);
  const e = { lm: 1, lmStale: !!m.stale, at: 0 };
  const title = String(m.t || '');
  if (m.cAt) {
    const text = lrNorm([title].concat(m.bl || [], [m.d || '']).join(' '));
    Object.assign(e, { cAt: m.cAt, pt: m.pt || '', title: title.slice(0, 220), titleLen: title.length, bul: (m.bl || []).length, desc: String(m.d || '').length,
      kw: String(m.kw || '').slice(0, 300), kwBytes: lrKwBytes(String(m.kw || '')),
      words: { emb: /embroider/.test(text), bp: text.includes('block print'), hb: text.includes('hand block') } });
  }
  if (m.gAt) {
    Object.assign(e, { gAt: m.gAt, pt: m.pt || e.pt || '', st: String(m.as || '').split(',').map(s => s.trim()).filter(Boolean),
      iss: m.iss.map(i => Object.assign({}, i, { m: lrWholeCut(i.m, i.s === 'E' ? 1000 : 220) })), slots: LM_SLOTS.filter(slot => m.img && m.img[slot]),
      color: String((m.va && m.va.color) || '').slice(0, 40), hl: (m.hl || []).map(v => String(v).slice(0, 300)), hlAt: m.gAt });
    // the Workspace's Specs check: which spec attributes are filled (`sp`, written by ListingMatch since 17 Nov); none kept → not read
    if (Array.isArray(m.sp)) e.specs = Object.fromEntries(LM_SPECS().map(name => [name, m.sp.includes(name)]));
  }
  const cat = m.cat;
  if (cat && m.iAt && cat.img) {
    const slots = Object.keys(cat.img).filter(slot => cat.img[slot] && cat.img[slot].u);
    Object.assign(e, { iAt: m.iAt, cat: slots, catMain: cat.img.MAIN ? String(cat.img.MAIN.u).slice(0, 200) : '',
      catPic: Object.fromEntries(slots.map(slot => [slot, [lrPicId(cat.img[slot].u), Number(cat.img[slot].w) || 0, Number(cat.img[slot].h) || 0]])) });
  }
  if (cat && cat.t && m.tAt) Object.assign(e, { catTitle: String(cat.t).slice(0, 250), tAt: m.tAt });
  if (cat && cat.brand) e.brand = String(cat.brand).slice(0, 60);
  e.at = Math.max(e.cAt || 0, e.gAt || 0, e.iAt || 0);
  LM_ENTRY.set(m, e);
  return e;
}
// The parts of a live read, each with the time it was read and the fields it fills.
const LM_PARTS = [
  ['cAt', ['cAt', 'title', 'titleLen', 'bul', 'desc', 'kw', 'kwBytes', 'words'], 'cErr'],
  ['gAt', ['gAt', 'st', 'iss', 'slots', 'color', 'hl', 'hlAt', 'specs'], 'err'],
  ['iAt', ['iAt', 'cat', 'catMain', 'catPic'], 'iErr'],
  ['tAt', ['catTitle', 'tAt'], ''],
];
/** One listing's freshest Amazon read, part by part: this browser's live read (ws) where it is newer, the cache's record otherwise.
 *  The cache not usable, or no record: the live read exactly as before (or null). */
function lmLiveOf(brand, sku, ws) {
  const m = lmGet(sku, brand);
  if (!m) return ws || null;
  const key = brand + '|' + sku;
  const sig = [m, ws, ws && ws.at, ws && ws.cAt, ws && ws.gAt, ws && ws.iAt, ws && ws.tAt, ws && ws.hlAt, ws && ws.err, ws && ws.cErr, ws && ws.iErr];
  const kept = LM_LIVE.get(key);
  if (kept && kept.sig.every((part, i) => part === sig[i])) return kept.e;
  const base = lmEntryOf(m);
  let e = base;
  if (ws) {
    e = Object.assign({}, ws, { lm: 1, lmStale: false });
    LM_PARTS.forEach(([atKey, keys, errKey]) => {
      if (!((base[atKey] || 0) > (ws[atKey] || 0))) return;
      keys.forEach(k => { if (base[k] !== undefined) e[k] = base[k]; });
      // the cache read this part after the live read failed: no error to show for it (a content failure sets err and cErr alike)
      if (errKey) e[errKey] = '';
      if (errKey === 'cErr' && ws.err && ws.err === ws.cErr) e.err = '';
      if (base.lmStale) e.lmStale = true;
    });
    if (!e.pt && base.pt) e.pt = base.pt;
    if (!e.brand && base.brand) e.brand = base.brand;
    e.at = Math.max(ws.at || 0, base.at || 0);
  }
  LM_LIVE.set(key, { sig, e });
  return e;
}
/** The small grey "old data" mark for a record ListingMatch kept from an earlier pass ('' otherwise). */
function lmOldHtml(brand, sku) {
  const m = sku ? lmGet(sku, brand) : null;
  if (!m || !m.stale || m.live) return '';
  const when = m.readAt ? new Date(m.readAt + LM_IST_MS).toISOString().replace(/^(\d{4})-(\d\d)-(\d\d)T(\d\d:\d\d).*$/, '$1-$2-$3 $4') : '';
  return `<span class="lm-old" title="Amazon could not be read for this listing in the last ListingMatch pass — this is its earlier read${when ? ' (' + lmFmt(when) + ')' : ''}">old data</span>`;
}

/* ----- the Image Manager list (IML): Image Manager, Listing Errors, Family check, the picture rules' fallback ----- */
// One IML item from the cache's record (the shape ?limg=page answers, image-manager.js), `old` = the saved snapshot's item, if any.
function lmImlItem(m, old) {
  const errs = m.iss.filter(i => i.s === 'E');
  const cat = m.cat;
  const item = Object.assign({}, old || {}, { sku: m.sku, asin: m.asin || (old && old.asin) || '', st: String(m.as || ''), pt: m.pt || (old && old.pt) || '',
    t: String(m.t || (old && old.t) || '').slice(0, 160), lvl: m.lvl || '', psku: m.psku || '', c: String((m.va && m.va.color) || ''), z: String((m.va && m.va.size) || ''),
    img: Object.assign({}, m.img || {}), ie: errs.length, iw: m.iss.filter(i => i.s === 'W').length, im: errs.length ? String(errs[0].m).slice(0, 140) : '',
    iss: m.iss.slice(0, 12).map(i => Object.assign({}, i, { m: String(i.m).slice(0, i.s === 'E' ? 1000 : 220) })), lm: 1, lmStale: !!(m.stale && !m.live) });
  if (cat && cat.img) {
    item.live = Object.fromEntries(Object.entries(cat.img).filter(([, v]) => v && v.u).map(([slot, v]) => [slot, v.u]));
    item.pa = (cat.pa || [])[0] || '';
    delete item.liveErr;
  } else if (!(old && old.live) && item.asin) item.liveErr = 'not in catalogue';
  delete item.main;
  return item;
}
/** IML[brand] from the cache: the saved snapshot's items with the cache's newer records laid over them, the cache's other listings
 *  added, and the parents its listings name (from the catalog) when the snapshot has none. The cache not usable: the snapshot as it was. */
function lmImlApply(brand) {
  if (typeof IML === 'undefined') return;
  const cur = IML[brand];
  const base = cur && cur.lm ? cur.base : cur;
  if (!lmOk(brand)) { if (cur && cur.lm) IML[brand] = base || null; return; }
  const snapAt = base && base.at ? base.at.getTime() : 0;
  const items = [];
  const seen = new Set();
  ((base && base.items) || []).forEach(item => {
    const m = item && item.lvl !== 'parent' ? lmGet(item.sku, brand) : null;
    items.push(m && !m.noRead && Math.max(m.gAt, m.iAt) > snapAt ? lmImlItem(m, item) : item);
    if (item) seen.add(item.sku);
  });
  LM.list[brand].forEach((raw, sku) => {
    if (seen.has(sku) || raw.noRead) return;
    items.push(lmImlItem(lmGet(sku, brand), null));
    seen.add(sku);
  });
  // parents named by a listing and not in the list: their SKU, their ASIN and title from the catalog
  const kidOf = new Map();
  items.forEach(item => { if (item.psku && !seen.has(item.psku) && !kidOf.has(item.psku)) kidOf.set(item.psku, item); });
  kidOf.forEach((kid, psku) => {
    const pa = kid.pa || '';
    const pc = pa && LM.cat[brand] ? LM.cat[brand].get(pa) : null;
    items.push({ sku: psku, asin: pa, st: '', pt: kid.pt || '', t: String((pc && pc.t) || '').slice(0, 160), lvl: 'parent', psku: '', c: '', z: '', img: {},
      live: pc && pc.img ? Object.fromEntries(Object.entries(pc.img).filter(([, v]) => v && v.u).map(([slot, v]) => [slot, v.u])) : {}, ie: 0, iw: 0, im: '', iss: [], lm: 1 });
    seen.add(psku);
  });
  IML[brand] = { at: new Date(Math.max(lmPassAt(), snapAt)), items, lm: true, base: base || null };
}
// One live read landed: that one item follows at once (the list object stays the same, so nothing else is judged again).
function lmImlPatch(brand, sku) {
  if (typeof IML === 'undefined' || !IML[brand] || !IML[brand].lm) return;
  const items = IML[brand].items;
  const i = items.findIndex(item => item && item.sku === sku);
  const m = lmGet(sku, brand);
  if (i >= 0 && m && !m.noRead) items[i] = lmImlItem(m, items[i]);
}
/** imListLoad's fast way (image-manager.js): with the cache usable, IML[brand] is drawn from it at once and the saved snapshot is read
 *  under it in the background (`loadSnap`). Returns true when it answered. */
function lmImlFast(brand, loadSnap) {
  if (!lmOk(brand) || typeof IML === 'undefined') return false;
  if (!(brand in IML) || !IML[brand]) IML[brand] = null;
  lmImlApply(brand);
  Promise.resolve().then(loadSnap).then(() => { lmImlApply(brand); lmSoon(); }).catch(() => {});
  return true;
}

/* ----- Amazon's status map (AMZ, listing-rules.js) ----- */
const lmAmzRec = m => {
  const errs = m.iss.filter(i => i.s === 'E');
  const iss = m.iss.slice(0, 8).map(i => Object.assign({}, i, { m: lrWholeCut(String(i.m), 220) }));
  return { st: String(m.as || ''), ie: errs.length, iw: m.iss.filter(i => i.s === 'W').length, im: errs.length ? String(errs[0].m).slice(0, 140) : '', iss,
    em: iss.filter(i => i.s === 'E').map(i => (i.c ? `ERROR ${i.c}: ` : '') + i.m), lm: 1 };
};
/** The brands the cache answers for (amzEnsure reads the Image Manager snapshot only for the others). */
const lmAmzBrands = () => ['SP', 'CPC'].filter(b => lmOk(b));
/** Fill `map` ("brand|sku" → status) from the cache for the brands it answers; their snapshot dates become the pass's. */
function lmAmzApply(map) {
  if (typeof AMZ === 'undefined') return;
  const brands = lmAmzBrands();
  if (!brands.length) return;
  const into = map || AMZ.map || new Map();
  brands.forEach(b => {
    LM.list[b].forEach((raw, sku) => { if (!raw.noRead) into.set(b + '|' + sku, lmAmzRec(lmGet(sku, b))); });
    AMZ.snapAt[b] = lmPassAt();
  });
  if (!map) { AMZ.map = into; AMZ.at = Date.now(); }
}
function lmAmzPatch(brand, sku) {
  if (typeof AMZ === 'undefined' || !AMZ.map) return;
  const m = lmGet(sku, brand);
  if (m && !m.noRead) AMZ.map.set(brand + '|' + sku, lmAmzRec(m));
}

/* ----- Listing Health's rows: the report facts (status, stock, price, channel) and the listing list from the cache's newer reports ----- */
/** May Listing Health follow the cache's LIST of listings for this brand (add the new ones, drop the removed ones)? Only when the cache is
 *  usable, ListingMatch's last full pass read this brand (not given up) less than 24 hours ago, and every listings tab of the brand was
 *  read here — a brand whose read failed or is stale is never added to or cut. */
function lmListOk(brand) {
  if (!lmOk(brand) || !LM.whole[brand]) return false;
  const full = LM.meta && LM.meta.lastFull;
  if (!full || !(full.brands || []).includes(brand) || (full.gaveUp || []).includes(brand)) return false;
  const at = lmTime(full.finishedAt);
  return !!at && Date.now() - at <= LM_MAX_AGE;
}
// One Listing Health row from the cache's record (a listing the snapshot does not have).
function lmRowOf(b, sku, raw) {
  const cat = raw.asin && LM.cat[b] ? LM.cat[b].get(raw.asin) : null;
  return { sku, asin: raw.asin || '', parent: (cat && (cat.pa || [])[0]) || '', title: String(raw.t || '').slice(0, 200), price: raw.price == null ? null : raw.price,
    qty: raw.fba === undefined ? null : raw.fba, status: raw.rs || '', channel: raw.ch || '', opened: '', tried: false, titleFull: true, content: null, checked: 0, aplusAt: 0,
    lmAt: raw.rAt || 0, lmAdded: true };
}
// Listing Health's own scope (the snapshot's): FBA, no virtual bundles.
const lmInScope = (sku, raw) => LM_FBA_RE().test(raw.ch || '') && !LM_BUNDLE_RE().test(sku);
/** HEALTH[brand].rows with the cache's report facts where its All Listings report is newer than the snapshot, and — when the cache's
 *  full pass is newer than the snapshot and lmListOk — its list of listings: a listing Amazon added is a new row, one gone from Amazon's
 *  All Listings report is dropped. The snapshot rows are kept under it (lmBase) and come back when the cache is not usable. A brand with
 *  no snapshot at all gets its rows from the cache. */
function lmHealthApply() {
  if (typeof HEALTH === 'undefined') return;
  ['SP', 'CPC'].forEach(b => {
    const h = HEALTH[b];
    const ours = !!(h && h.rows && h.rows === h.lmRows);
    const base = ours ? h.lmBase : (h && h.rows) || null;
    if (!lmOk(b)) {
      if (ours) { h.rows = h.lmBase; h.lmRows = null; }
      return;
    }
    const list = LM.list[b];
    const snapAt = h && h.at && h.at.getTime ? h.at.getTime() : 0;
    let rows;
    if (!base || !base.length) {
      rows = [];
      list.forEach((raw, sku) => { if (lmInScope(sku, raw)) rows.push(lmRowOf(b, sku, raw)); });
      if (!rows.length) return;
      if (!HEALTH[b]) HEALTH[b] = { at: null, contentAt: null, scope: null, parentNames: {}, rows: [], parentAplus: {}, parentAplusAt: 0 };
    } else {
      const follow = lmListOk(b) && lmTime(LM.meta.lastFull.finishedAt) > snapAt;
      let changed = 0;
      rows = [];
      base.forEach(row => {
        const raw = list.get(row.sku);
        if (!raw) {
          if (follow) { changed++; return; }                                  // gone from Amazon's All Listings report
          rows.push(row);
          return;
        }
        if (!(raw.rAt > snapAt)) { rows.push(row); return; }
        const patch = {};
        if (raw.rs && raw.rs !== row.status) patch.status = raw.rs;
        if (raw.fba !== undefined && raw.fba !== row.qty) patch.qty = raw.fba;
        if (raw.price != null && raw.price !== row.price) patch.price = raw.price;
        if (raw.ch && raw.ch !== row.channel) patch.channel = raw.ch;
        if (!Object.keys(patch).length) { rows.push(row); return; }
        changed++;
        rows.push(Object.assign({}, row, patch, { lmAt: raw.rAt }));
      });
      if (follow) {
        const have = new Set(base.map(row => row.sku));
        list.forEach((raw, sku) => {
          if (have.has(sku) || !lmInScope(sku, raw)) return;                   // a listing Amazon has that the snapshot does not
          rows.push(lmRowOf(b, sku, raw));
          changed++;
        });
      }
      if (!changed) { if (ours) { h.rows = base; h.lmRows = null; } return; }
    }
    HEALTH[b].lmBase = base || [];
    HEALTH[b].rows = rows;
    HEALTH[b].lmRows = rows;
  });
  lmParentNamesApply();                                                     // and the parents' own names
}

/** When the stock on the page was read, for a brand whose stock is the cache's: the time of ListingMatch's newest report for it (0 when the
 *  Listing Health snapshot is the newer one, or the cache is not usable) — Family check's "stock saved …" label. */
const LM_STOCK_AT = new WeakMap();
function lmStockAt(brand) {
  if (!lmOk(brand) || typeof HEALTH === 'undefined') return 0;
  const list = LM.list[brand];
  let at = LM_STOCK_AT.get(list);
  if (at === undefined) {
    at = 0;
    list.forEach(raw => { if (raw.fba !== undefined && raw.rAt > at) at = raw.rAt; });
    LM_STOCK_AT.set(list, at);
  }
  const h = HEALTH[brand];
  const snapAt = h && h.at && h.at.getTime ? h.at.getTime() : 0;
  return at > snapAt ? at : 0;
}

/* ----- the parents' own names (Listing Audit, Listing Health, every screen that names a parent) ----- */
/** HEALTH[brand].parentNames with the names the cache's parent listings carry (their item name: the seller's own name for the parent,
 *  the same field the listings report's parent row gives "Refresh both brands"). The snapshot's names stay under it (lmNamesBase). */
function lmParentNamesApply() {
  if (typeof HEALTH === 'undefined') return;
  ['SP', 'CPC'].forEach(b => {
    const h = HEALTH[b];
    if (!h) return;
    const ours = !!(h.parentNames && h.parentNames === h.lmNames);
    const base = ours ? h.lmNamesBase || {} : h.parentNames || {};
    if (!lmOk(b)) {
      if (ours) { h.parentNames = base; h.lmNames = null; }
      return;
    }
    const names = {};
    LM.list[b].forEach(raw => { if (raw.lvl === 'parent' && raw.asin && raw.t) names[raw.asin] = String(raw.t).slice(0, 80); });
    if (!Object.keys(names).length) return;
    h.lmNamesBase = base;
    h.parentNames = Object.assign({}, base, names);
    h.lmNames = h.parentNames;
  });
}

/* ----- the Listing Optimiser's review of one ASIN (listing-optimiser.js): its facts from the cache ----- */
// The SKU of ours on an ASIN (several SKUs on one ASIN: the one with the most stock), per brand, made once per copy.
const LM_ASIN_IX = new WeakMap();
function lmSkuOfAsin(brand, asin) {
  const list = LM.list[brand];
  if (!list) return '';
  let ix = LM_ASIN_IX.get(list);
  if (!ix) {
    ix = new Map();
    list.forEach((raw, sku) => {
      if (!raw.asin || raw.noRead) return;
      const have = ix.get(raw.asin);
      if (!have || (Number(raw.fba) || 0) > (Number(list.get(have).fba) || 0)) ix.set(raw.asin, sku);
    });
    LM_ASIN_IX.set(list, ix);
  }
  return ix.get(asin) || '';
}
/** What the review judges, from the cache: the title, pictures (with sizes), browse category and rank shoppers see (the catalog), our
 *  bullets, description and product word (the listing). Null when the cache is not usable or does not hold this ASIN as one of ours
 *  — the review then reads Amazon live, as before. */
function lmReviewFacts(asin, brand) {
  if (!lmOk(brand)) return null;
  const cat = lmGetAsin(asin, brand);
  const sku = cat ? lmSkuOfAsin(brand, asin) : '';
  const m = sku ? lmGet(sku, brand) : null;
  if (!cat || !m) return null;
  const c = m.cat || cat;
  const vals = c.vals || {}, va = m.va || {};
  const rk = (c.rk && (c.rk.sub || c.rk.main)) || null;
  return {
    title: c.t || m.t || '', brand: c.brand || '', category: String(c.bc || '').split(' › ').pop(),
    bullets: (m.bl || []).slice(), bulletsKnown: true, description: m.d || '', descriptionKnown: true,
    itemType: m.itk || '', size: vals.size || va.size || '', color: vals.color || va.color || '', material: vals.material || va.material || '',
    images: Object.fromEntries(Object.entries(c.img || {}).filter(([, v]) => v && v.u).map(([slot, v]) => [slot, { link: v.u, w: Number(v.w) || 0, h: Number(v.h) || 0 }])),
    rank: rk && rk.r > 0 ? { title: rk.c || '', value: rk.r } : null,
    readAt: Math.max(m.cAt || 0, m.iAt || 0), sku,
  };
}

/* ----- Family check's catalog records (family-check.js fcCatOf) ----- */
/** { at, pa, kids?, theme?, tattrs?, vals? } — the shape ?lfix=cat answers are kept in — from the cache's catalog record; null when none. */
function lmFcCat(brand, asin) {
  const cat = asin ? lmGetAsin(asin, brand) : null;
  if (!cat) return null;
  if (LM_FC.has(cat)) return LM_FC.get(cat);
  const rec = { at: cat.readAt || 0, pa: (cat.pa || [])[0] || '', lm: 1 };
  if ((cat.kids || []).length) Object.assign(rec, { kids: cat.kids.slice(), theme: cat.theme || '', tattrs: (cat.tattrs || []).slice() });
  else {
    const par = rec.pa ? lmGetAsin(rec.pa, brand) : null;
    const tattrs = par && (par.tattrs || []).length ? par.tattrs : (cat.tattrs || []);
    if (tattrs.length) rec.vals = Object.fromEntries(tattrs.map(a => [a, String((cat.vals || {})[a] || '').slice(0, 80)]));
  }
  LM_FC.set(cat, rec);
  return rec;
}

/* ----- BSR Audit's ranks (bsr-audit.js bsrCollect) ----- */
/** { asin: { rank, cat, sub, subCat } } from the cache's catalog, for the ASINs read in the last 24 hours (the rest are asked live). */
function lmRanks(brand, asins) {
  const out = {};
  (asins || []).forEach(asin => {
    const c = lmGetAsin(asin, brand);
    if (!c || !c.rk || !(Date.now() - (c.readAt || 0) <= LM_MAX_AGE)) return;
    const main = c.rk.main, sub = c.rk.sub;
    if (!(main && main.r > 0) && !(sub && sub.r > 0)) return;
    out[asin] = { rank: main && main.r > 0 ? main.r : 0, cat: main ? String(main.c || '').slice(0, 60) : '', sub: sub && sub.r > 0 ? sub.r : 0, subCat: sub ? String(sub.c || '').slice(0, 60) : '' };
  });
  return out;
}
/** The catalog pictures' sizes ([id, w, h]) for one brand — image-quality.js's size dots. */
function lmPicSizes(brand) {
  const out = [];
  if (!lmOk(brand) || !LM.cat[brand]) return out;
  LM.cat[brand].forEach(c => Object.values(c.img || {}).forEach(v => { if (v && v.u && v.w && v.h) out.push([lrPicId(v.u), v.w, v.h]); }));
  return out;
}

/* ----- after a newer copy: every shape the screens read, then the screens showing ----- */
function lmApply() {
  LM_LIVE.clear();
  ['SP', 'CPC'].forEach(b => {
    // Amazon's Suppressed listings report (rule c of lrShopOf): from the cache's records while it is usable
    if (typeof LR_FYP === 'undefined') return;
    if (lmOk(b)) {
      const fyp = new Map();
      LM.list[b].forEach((raw, sku) => { if (raw.inSupReport) fyp.set(sku, String((raw.fyp && raw.fyp.r) || 'suppressed')); });
      LR_FYP[b] = fyp;
      LM.fyp[b] = true;
    } else if (LM.fyp[b]) { LR_FYP[b] = null; LM.fyp[b] = false; }
  });
  lmHealthApply();
  if (typeof IML !== 'undefined') ['SP', 'CPC'].forEach(b => { if (b in IML) lmImlApply(b); });
  if (typeof AMZ !== 'undefined' && AMZ.map) lmAmzApply();
  if (typeof H_CTX !== 'undefined') H_CTX = null;
  lmAgeDraw();
  try { if (typeof LY !== 'undefined' && LY.on && typeof lyLineDraw === 'function') lyLineDraw(); } catch (e) { /* the sync line draws on its next beat */ }
  lmRedraw();
}
// Debounced redraw after live reads landed (lmNoteLive).
function lmSoon() {
  if (LM.soonT) return;
  LM.soonT = setTimeout(() => { LM.soonT = 0; lmRedraw(); }, 1500);
}
// The Listing screen showing redraws with the newer data (each through its own redraw; a hidden one draws when it is opened).
function lmRedraw() {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const shown = id => { const el = document.getElementById(id); return !!(el && el.classList && !el.classList.contains('hide')); };
  try {
    if (shown('paneHealth') && typeof H_LOADED !== 'undefined' && H_LOADED) {
      if (typeof LI_WS !== 'undefined' && LI_WS.on && typeof liWsSchedule === 'function') liWsSchedule();
      else if (typeof hRedraw === 'function') hRedraw();
    }
    if (shown('paneImg') && typeof imListRender === 'function') imListRender();
    if (shown('paneOpt') && typeof SP !== 'undefined' && SP.on && typeof spAfterRead === 'function') spAfterRead();
    if (shown('paneFam') && typeof FC !== 'undefined' && typeof fcSchedule === 'function') { FC.view = null; fcSchedule(); }
    if (shown('paneBsr') && typeof BSR_MODE !== 'undefined' && BSR_MODE === 'compare' && typeof renderBsr === 'function' && typeof BSR_LOADED !== 'undefined' && BSR_LOADED) renderBsr();
    if (shown('paneLerr') && typeof leRender === 'function') leRender();
    if (shown('paneAudit') && typeof AUDIT_LOADED !== 'undefined' && AUDIT_LOADED && typeof renderAudit === 'function') renderAudit();
  } catch (e) { /* a screen draws itself again on its next draw */ }
}

/* ----- the age line at the top of each Listing screen ----- */
/** "Amazon data: 16 Nov 18:30 · next refresh ~13:00" — amber when older than 24 hours (then the screens use their own reads). */
function lmAgeHtml() {
  const at = lmPassAt();
  if (!LM.meta || !at) {
    const why = LM.state === 'loading' || LM.state === 'none' ? 'reading the listing cache…' : "this screen's own reads (the listing cache is not ready yet)";
    return `<span class="lm-age-t">Amazon data: ${why}</span>`;
  }
  const old = Date.now() - at > LM_MAX_AGE;
  const tip = old ? 'Older than 24 hours — this screen uses its own reads until the next ListingMatch pass.'
    : `Read from Amazon by ListingMatch (${LM.meta.kind === 'light' ? 'the changed listings' : 'every listing'}). A live read on this page (a send, Check now, Read again) shows until a newer pass.`;
  return `<span class="lm-age-t${old ? ' is-old' : ''}" title="${tip}">Amazon data: ${lmFmt(LM.meta.finishedAt)} · next refresh ~${lmNextFull()}</span>`;
}
/* ----- THE ONE "WHEN WAS THIS READ" LABEL (17 Nov 2026): every Listing screen's data-age label comes from lmDataLabel ----- */
// ms → '17 Nov 13:14' (IST, as ListingMatch writes its times); day false → '13:14'.
function lmClock(ms, day) {
  const d = new Date(ms + LM_IST_MS);
  const hm = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  return day === false ? hm : `${d.getUTCDate()} ${LM_MON[d.getUTCMonth()]} ${hm}`;
}
const lmIstDay = ms => Math.floor((ms + LM_IST_MS) / 864e5);
/** One brand's times from lmMeta: full = the last full pass that read it (lastFull.finishedAt; 0 when that pass gave the brand up),
 *  update = the newest pass that read it (lastLight.finishedAt when the light pass read this brand, else the full one). */
function lmBrandTimes(brand) {
  const m = LM.meta || {};
  const lf = m.lastFull || (m.kind === 'full' ? { finishedAt: m.finishedAt } : {});
  const ll = m.lastLight || (m.kind === 'light' ? { finishedAt: m.finishedAt } : {});
  const inFull = !lf.brands || (lf.brands.includes(brand) && !(lf.gaveUp || []).includes(brand));
  const full = inFull ? lmTime(lf.finishedAt) : 0;
  const light = ll.brands && typeof ll.brands === 'object' && !ll.brands[brand] ? 0 : lmTime(ll.finishedAt);
  return { full, update: Math.max(full, light) };
}
/** THE LABEL. When the ListingMatch data is fresh for every brand given (lmOk: its last pass at most 24 hours old):
 *    { lm: true, fullAt, updateAt, text: 'Full refresh: 17 Nov 13:14 · last update 13:30' }
 *  per brand when the brands' times differ ('Full refresh: Ridhi 17 Nov 13:14 · last update 13:30; CPC 16 Nov 18:20 · last update 13:30').
 *  fullAt / updateAt: the oldest across the brands (0 when one is not known). NULL when the data is missing or older than 24 hours:
 *  only then does a screen show its old label (the Listing Health snapshot, the Image Manager snapshot, a manual refresh). */
function lmDataLabel(brands) {
  brands = brands && brands.length ? brands : ['SP', 'CPC'];
  if (!LM.meta || !brands.every(b => lmOk(b))) return null;
  const t = brands.map(b => Object.assign({ b }, lmBrandTimes(b)));
  const one = x => (x.full ? lmClock(x.full) : 'not in the last full pass')
    + (x.update ? ' · last update ' + lmClock(x.update, x.full && lmIstDay(x.update) === lmIstDay(x.full) ? false : true) : '');
  const same = t.every(x => x.full === t[0].full && x.update === t[0].update);
  const name = b => (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[b]) || b;
  const text = 'Full refresh: ' + (same ? one(t[0]) : t.map(x => name(x.b) + ' ' + one(x)).join('; '));
  const oldest = k => (t.every(x => x[k]) ? Math.min(...t.map(x => x[k])) : 0);
  return { lm: true, fullAt: oldest('full'), updateAt: oldest('update'), text };
}
function lmAgeDraw() {
  try {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const html = lmAgeHtml();
    LM_PANES.forEach(id => {
      const pane = document.getElementById(id);
      if (!pane) return;
      let el = document.getElementById(id + 'LmAge');
      if (!el) {
        el = document.createElement('div');
        el.id = id + 'LmAge';
        el.className = 'lm-age';
        pane.insertBefore(el, pane.firstChild);
      }
      if (el.innerHTML !== html) el.innerHTML = html;
    });
  } catch (e) { /* the line is a convenience: never in the way of the screen */ }
}
// Every minute: the age line's text, and — when the cache has just passed 24 hours (the page left open) — every screen back on its own reads.
let LM_OK_WAS = '';
function lmMinute() {
  if (!LM.meta) return;
  const now = String(lmOk('SP')) + lmOk('CPC');
  if (LM_OK_WAS && now !== LM_OK_WAS) lmApply();
  else lmAgeDraw();
  LM_OK_WAS = now;
}
if (typeof setInterval === 'function') { const t = setInterval(lmMinute, 60000); if (t && t.unref) t.unref(); }

/** CONSOLE: `lmStatus()` in a signed-in Sellora tab — what the cache holds, how old it is, how fast the saved copy opened. */
function lmStatus() {
  const out = { state: LM.state, from: LM.from, pass: LM.meta ? `${LM.meta.kind} ${LM.meta.finishedAt}` : 'none', usable: { SP: lmOk('SP'), CPC: lmOk('CPC') },
    savedCopyOpenedMs: LM.loadMs, error: LM.err || '' };
  ['SP', 'CPC'].forEach(b => {
    const list = LM.list[b];
    let stale = 0, noRead = 0, sup = 0;
    if (list) list.forEach(r => { if (r.stale) stale++; if (r.noRead) noRead++; if (r.sup) sup++; });
    out[b] = { skus: list ? list.size : 0, asins: LM.cat[b] ? LM.cat[b].size : 0, stale, notRead: noRead, suppressed: sup, liveOverlays: LM.over[b].size };
  });
  if (typeof console !== 'undefined' && console.log) console.log(out);
  return out;
}
if (typeof window !== 'undefined') window.lmStatus = lmStatus;
