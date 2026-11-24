/* ==== SHOPIFY ORDERS: THE COPY ON THIS DEVICE (2026-10-15, docs/shopify-fast-orders/PLAN.md phases 0–2) ====
 * Ravi wants the Orders tab to open in about a second, at ₹0. Every open asked Shopify for ten weeks of orders, live,
 * through the Pricing-API script: 20–60 seconds of an empty tab.
 *
 * THREE WAYS TO LOAD, one switch (localStorage soCopyMode, or the "Load from Shopify directly" tick on the toolbar):
 *   direct — today's way: every open asks Shopify. NOTHING is stored on the device. AS SHIPPED.
 *   shadow — today's way on screen; in the background the copy is built and COMPARED with what Shopify just said,
 *            silently, and every difference is logged (soCopyReport() in the console). The copy is trusted only after
 *            days of zero differences — the same discipline as core/delta-sync.js.
 *   copy   — open shows this device's copy at once, then asks Shopify only for what CHANGED since (with five minutes
 *            of overlap, on Shopify's clock), merges it by order id and redraws.
 * SHOPIFY IS THE MASTER. The copy is only ever a copy: when the two disagree, Shopify's version wins on the next sync.
 * Our own notes, bins and status live in Firestore as before and are never touched by any of this.
 *
 * What the copy keeps, and for how long:
 *   - one record per store (SP = Ridhi, CPC) in IndexedDB, plus the photo list;
 *   - a VERSION number: a copy written in another format is thrown away, never read (raise SO_COPY.ver whenever an
 *     order's fields change — tests/shopify-copy-test.js fails until you do);
 *   - shipped and cancelled orders keep NO name, address, phone or email — only what a shipped order is looked up for;
 *   - finished orders older than 90 days are dropped; the whole copy goes after 7 days unused, on Sign out, and the
 *     moment another account signs in on this browser. */
const SO_COPY = {
  ver: 1,
  mode: 'direct',                      // as shipped — see soCopyMode()
  db: 'ridhi-shopify', store: 'copy',
  overlapMs: 5 * 60 * 1000,            // every "changed since" starts five minutes before the last one ended
  pruneDays: 90,                       // finished orders older than this leave the copy
  idleMs: 7 * 24 * 3600 * 1000,        // a copy nobody opened for a week is wiped, customer details and all
  windowDays: 14,                      // the tab opens on the last fortnight, plus the old unfinished orders by id
  idsPerCall: 100,                     // ids in one GET — the address has to stay short
  pidsPerCall: 100,
  maxPages: 10,                        // a "changed since" that keeps saying "more" is followed this far, then refilled
  logMax: 50,                          // shadow lines kept on the device
  /* phase 4 — the safety nets */
  ageWarnMin: 15, ageBadMin: 30,       // "Updated 4 min ago": grey, orange after 15, red after 30
  fallbackMs: 30 * 60 * 1000,          // a copy older than this that cannot be brought up to date → load the old way
  syncLogMax: 100,                     // sync lines kept on the device (localStorage soCopySyncLog)
  countEveryMs: 20 * 3600 * 1000,      // the count check, about once a day per device
  /* phase 3 — the shared copy in Firestore, OFF as shipped (localStorage soCopyShared = '1' on one device) */
  shared: false,
  sharedStaleMs: 2 * 60 * 1000,        // an open whose shared copy is older than this asks the script to sync
  listening: false,
  running: false, persisted: false,
};
const SO_BRANDS = ['SP', 'CPC'];

function soCopyMode() {
  try {
    const m = localStorage.getItem('soCopyMode');
    if (m === 'direct' || m === 'shadow' || m === 'copy') return m;
  } catch (e) { /* no storage: the shipped setting */ }
  return SO_COPY.mode;
}
function soCopySetMode(m) {
  try { localStorage.setItem('soCopyMode', m); } catch (e) { /* this page only */ }
  SO_COPY.mode = m;
}

/* ---------- the rules, as plain functions (tests/shopify-copy-test.js runs these on their own) ---------- */

const soCopyMs = iso => { const t = Date.parse(iso || ''); return isNaN(t) ? 0 : t; };
/** Shipped or cancelled: nobody needs to post anything to this customer again. */
const soCopyDone = o => !!o && (String(o.ff || '').toLowerCase() === 'fulfilled' || !!o.cancelledAt);

/** What the copy may hold of an order. A finished order keeps no name, street, zip, phone or email; the country
 *  and state stay, because the delivery-days and MCF columns read them. Never changes the order it is given. */
function soCopyStrip(o) {
  if (!soCopyDone(o)) return o;
  const s = o.ship || {};
  return Object.assign({}, o, { email: '', ship: { name: '', company: '', a1: '', a2: '', city: '', zip: '', phone: '',
    state: s.state || '', country: s.country || '' } });
}

/** Merge what Shopify sent into the copy, by order id. Returns counts; `map` is changed in place.
 *  - { id, gone } removes the order (a voided one);
 *  - an order is replaced unless the copy already holds a NEWER version of it (an overlap echo);
 *  - an order changed HERE (Fulfil, see soCopyTouch) keeps the change until Shopify sends one at least as new. */
function soCopyMerge(map, incoming) {
  const out = { added: 0, changed: 0, removed: 0, kept: 0 };
  (incoming || []).forEach(o => {
    if (!o || !o.id) return;
    const id = String(o.id), had = map[id];
    if (o.gone) { if (had) { delete map[id]; out.removed++; } return; }
    if (had) {
      const a = soCopyMs(had.upd), b = soCopyMs(o.upd);
      if (b < a || (had.mine && b <= a)) { out.kept++; return; }
      out.changed++;
    } else out.added++;
    map[id] = soCopyStrip(o);
  });
  return out;
}

/** Where the next "changed since" starts: five minutes before the cursor, so nothing slips between two runs. */
function soCopyAskFrom(cursor) {
  const t = soCopyMs(cursor);
  return t ? new Date(t - SO_COPY.overlapMs).toISOString() : '';
}

/** Finished orders placed more than 90 days ago leave the copy. Open ones stay, however old. */
function soCopyPrune(map, nowMs) {
  const floor = new Date((nowMs || Date.now()) - SO_COPY.pruneDays * 86400000).toISOString().slice(0, 10);
  let n = 0;
  Object.keys(map).forEach(id => { const o = map[id]; if (soCopyDone(o) && String(o.at || '') < floor) { delete map[id]; n++; } });
  return n;
}

/** Why this record cannot be used ('' when it can). */
function soCopyStale(rec, uid, nowMs) {
  if (!rec) return 'no copy';
  if (rec.ver !== SO_COPY.ver) return 'copy written in an older format';
  if (!uid || rec.uid !== uid) return "another account's copy";
  if ((nowMs || Date.now()) - (rec.usedAt || 0) > SO_COPY.idleMs) return 'copy unused for 7 days';
  if (!rec.cursor || !rec.orders) return 'copy incomplete';
  return '';
}

/** Does the record hold everything this window needs? */
const soCopyCovers = (rec, want) => !!rec && !!rec.from && rec.from <= want.start && (rec.all || want.open === '1');

/** The orders the tab shows, out of the copy: placed inside the window, or one of the old unfinished ones by id. */
function soCopyView(map, want, ids) {
  const old = ids instanceof Set ? ids : new Set(ids || []);
  const out = [];
  Object.keys(map).forEach(id => {
    const o = map[id];
    if (!o) return;
    const inWin = o.at >= want.start && o.at <= want.end;
    if (!inWin && !old.has(id)) return;
    if (want.open === '1' && String(o.ff || '').toLowerCase() === 'fulfilled') return;
    out.push(o);
  });
  return out.sort(soCopyNewestFirst);
}
const soCopyNewestFirst = (a, b) => (String(b.id).length - String(a.id).length) || (String(b.id) < String(a.id) ? -1 : String(b.id) > String(a.id) ? 1 : 0);

/** The same order said in a different key order is the same order. Photos and our own marks are not Shopify's word. */
const soCopyCanon = o => JSON.stringify(soCopyStrip(o), (k, x) => {
  if (k === 'img' || k === 'mine') return undefined;
  return (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((r, k2) => { r[k2] = x[k2]; return r; }, {}) : x;
});

/** Live against copy, order by order. An order Shopify changed after the live read began is a race, not a fault. */
function soCopyDiff(live, copy, liveAtMs, copyAtMs) {
  const L = new Map((live || []).map(o => [String(o.id), o])), C = new Map((copy || []).map(o => [String(o.id), o]));
  const missing = [], extra = [], changed = [];
  let race = 0, behind = 0;
  /* copyAtMs (the shared copy's cursor): an order Shopify changed AFTER the copy's last sync is the copy being up to
   * five minutes behind, as designed — counted as `behind`, not as a fault. */
  const late = o => copyAtMs && soCopyMs(o.upd) > copyAtMs;
  L.forEach((o, id) => {
    const c = C.get(id);
    if (!c) { if (late(o)) behind++; else missing.push(o.no || id); return; }
    if (soCopyCanon(o) !== soCopyCanon(c)) {
      if (liveAtMs && soCopyMs(c.upd) > liveAtMs) race++; else if (late(o)) behind++; else changed.push(o.no || id);
    }
  });
  C.forEach((c, id) => {
    if (L.has(id)) return;
    if (liveAtMs && soCopyMs(c.upd) > liveAtMs) race++; else extra.push(c.no || id);
  });
  return { live: L.size, copy: C.size, mismatch: missing.length + extra.length + changed.length, race, behind,
    missing: missing.slice(0, 10), extra: extra.slice(0, 10), changed: changed.slice(0, 10) };
}

/* ---------- IndexedDB ---------- */

function soCopyIdb() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('no IndexedDB')); return; }
    const r = indexedDB.open(SO_COPY.db, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(SO_COPY.store)) r.result.createObjectStore(SO_COPY.store); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('indexedDB'));
  });
}
async function soCopyTx(mode, fn) {
  const db = await soCopyIdb();
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction(SO_COPY.store, mode), q = fn(tx.objectStore(SO_COPY.store));
      tx.oncomplete = () => res(q && 'result' in q ? q.result : undefined);
      tx.onerror = () => rej(tx.error || new Error('indexedDB'));
      tx.onabort = () => rej(tx.error || new Error('indexedDB aborted'));
    });
  } finally { try { db.close(); } catch (e) { /* closed */ } }
}
const soCopyGet = key => soCopyTx('readonly', st => st.get(key));
const soCopyDel = key => soCopyTx('readwrite', st => st.delete(key));
function soCopyPut(key, v) {
  /* Ask the browser, once, not to clear this when the disk runs short. It may say no; the copy still works. */
  if (!SO_COPY.persisted) {
    SO_COPY.persisted = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* not offered */ }
  }
  return soCopyTx('readwrite', st => st.put(v, key));
}

/** SIGN OUT WIPES IT — called from the Sign out button before the account goes. Never throws. */
async function soCopyWipe() {
  try {
    await new Promise(res => {
      if (typeof indexedDB === 'undefined') { res(); return; }
      const r = indexedDB.deleteDatabase(SO_COPY.db);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  } catch (e) { /* nothing to wipe */ }
}

const soCopyUid = () => { try { return (auth && auth.currentUser && auth.currentUser.uid) || ''; } catch (e) { return ''; } };

/** This store's record, or null with the reason. A record that must not be used is deleted on the spot. */
async function soCopyRead(brand) {
  let rec = null;
  try { rec = await soCopyGet(brand); } catch (e) { return { rec: null, why: 'no IndexedDB' }; }
  const why = soCopyStale(rec, soCopyUid(), Date.now());
  if (why && rec) soCopyDel(brand).catch(() => {});
  return { rec: why ? null : rec, why };
}

/* ---------- asking Shopify ---------- */

/** Every order this window needs that is older than its first day: the open production lines and the open
 *  adjustments — the same list core sync (shpUnseen) works from. `reach` is the oldest date of one that has no
 *  Shopify id, which can only be found by stretching the dates back to it (the old way). */
function soOldOpen(start) {
  const ids = new Set();
  let reach = '';
  const floor = sdShift(sdToday(), -SHP_REACH_MAX_DAYS);
  const note = (id, d) => {
    id = String(id || ''); d = String(d || '').slice(0, 10);
    if (/^REPL-/.test(id)) return;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (d >= start || d < floor)) return;   // inside the window, or past the cap
    if (/^\d+$/.test(id)) ids.add(id);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!reach || d < reach)) reach = d;
  };
  (PTG.ob || []).forEach(r => { if (r && String(r.src || '') === 'SHP') note(r.shopOrderId, r.orderDate); });
  Object.keys(SHOP_META || {}).forEach(id => {
    const lines = (SHOP_META[id] || {}).lines || {};
    Object.keys(lines).forEach(k => { const ln = lines[k]; if (ln && ln.adj && adjOpen(ln)) note(id, ln.adjOrderDate || ln.adjAt); });
  });
  return { ids, reach };
}

/** One store's orders for a window: by date, plus the old unfinished ones by id, photos left for later.
 *  A script not yet updated (no `mode` in its answer, or an error on ids=) is met the old way: the dates are
 *  stretched back to the oldest of those orders. */
/* lim: prGet's options (a time limit) for every call made here; none means wait as long as Apps Script does. */
async function soAskStore(brand, want, ids, lim) {
  const shop = brand === 'CPC' ? { shop: 'CPC' } : {};
  const dated = prGet({ shopify: 'orders', ...shop, start: want.start, end: want.end, open: want.open, nophoto: '1' }, lim);
  const list = [...ids];
  const parts = [];
  for (let i = 0; i < list.length; i += SO_COPY.idsPerCall) {
    parts.push(prGet({ shopify: 'orders', ...shop, ids: list.slice(i, i + SO_COPY.idsPerCall).join(','), open: want.open, nophoto: '1' }, lim));
  }
  const r = await dated;
  let olds = [];
  try { olds = await Promise.all(parts); } catch (e) { olds = null; }
  const byId = new Map((r.orders || []).map(o => [String(o.id), o]));
  let cursor = r.cursor || '', more = !!r.more, from = want.start;
  if (!r.mode || (olds && olds.some(x => x.mode !== 'ids'))) olds = null;
  if (olds) {
    olds.forEach(x => {
      (x.orders || []).forEach(o => { if (!byId.has(String(o.id))) byId.set(String(o.id), o); });
      if (x.cursor && (!cursor || soCopyMs(x.cursor) < soCopyMs(cursor))) cursor = x.cursor;
      more = more || !!x.more;
    });
  } else if (list.length) {
    /* The old way, for as long as the script has not learnt ids=: the whole range back to the oldest. */
    const oldest = soOldestOf(list) || sdShift(sdToday(), -SHP_REACH_MAX_DAYS);
    const w = await prGet({ shopify: 'orders', ...shop, start: oldest, end: want.end, open: want.open }, lim);
    (w.orders || []).forEach(o => { if (!byId.has(String(o.id))) byId.set(String(o.id), o); });
    more = more || !!w.more; cursor = ''; from = oldest;
  }
  const chan = brand === 'CPC' ? 'CPC Shopify' : null;
  const orders = [...byId.values()].map(o => Object.assign(o, { shopBrand: brand, channel: chan || o.channel || 'Shopify' }));
  return { orders, tz: r.tz || '', from, to: r.to || want.end, more, cursor: r.mode ? cursor : '' };
}
/** The oldest order date among these ids, read off the production lines and adjustments. */
function soOldestOf(ids) {
  const want = new Set(ids);
  let d0 = '';
  const see = (id, d) => { d = String(d || '').slice(0, 10); if (want.has(String(id)) && /^\d{4}-/.test(d) && (!d0 || d < d0)) d0 = d; };
  (PTG.ob || []).forEach(r => { if (r && r.src === 'SHP') see(r.shopOrderId, r.orderDate); });
  Object.keys(SHOP_META || {}).forEach(id => Object.values((SHOP_META[id] || {}).lines || {}).forEach(ln => { if (ln && ln.adj) see(id, ln.adjOrderDate || ln.adjAt); }));
  return d0;
}

/** "What changed since?" for one store, following `next` until Shopify has said everything. null = not usable
 *  (the script is older, or it kept saying "more"): the caller fills the copy the full way instead. */
async function soAskChanged(brand, since) {
  const shop = brand === 'CPC' ? { shop: 'CPC' } : {};
  let next = '', cursor = '', got = [];
  for (let p = 0; p < SO_COPY.maxPages; p++) {
    const r = await prGet({ shopify: 'orders', ...shop, since, nophoto: '1', ...(next ? { next } : {}) });
    if (r.mode !== 'since') return null;
    if (!p) cursor = r.cursor || '';
    const chan = brand === 'CPC' ? 'CPC Shopify' : null;
    got = got.concat((r.orders || []).map(o => o.gone ? o : Object.assign(o, { shopBrand: brand, channel: chan || o.channel || 'Shopify' })));
    if (!r.next) return { orders: got, cursor };
    next = r.next;
  }
  return null;
}

/** The ids the window needs that the copy does not have yet, asked for by id. */
async function soAskMissing(brand, rec, ids, want) {
  const miss = [...ids].filter(id => !rec.orders[id]);
  if (!miss.length) return [];
  const shop = brand === 'CPC' ? { shop: 'CPC' } : {};
  const chan = brand === 'CPC' ? 'CPC Shopify' : null;
  let out = [];
  for (let i = 0; i < miss.length; i += SO_COPY.idsPerCall) {
    const r = await prGet({ shopify: 'orders', ...shop, ids: miss.slice(i, i + SO_COPY.idsPerCall).join(','), open: '0', nophoto: '1' });
    if (r.mode !== 'ids') return out;
    out = out.concat((r.orders || []).map(o => Object.assign(o, { shopBrand: brand, channel: chan || o.channel || 'Shopify' })));
  }
  return out;
}

/** A copy record made from a full answer — the copy is REPLACED, never merged into, so its cursor is honest for
 *  every order it holds. */
function soCopyRecord(brand, res, want) {
  const orders = {};
  soCopyMerge(orders, res.orders);
  const now = Date.now();
  return { ver: SO_COPY.ver, uid: soCopyUid(), brand, cursor: res.cursor || '', from: res.from || want.start,
    all: want.open !== '1', tz: res.tz || '', at: now, usedAt: now, syncedAt: now, orders };
}

/** Bring one store's record up to date: changed since, the missing old ones, the 90-day clean-up. Returns the
 *  record, or null when it has to be filled the full way. */
async function soCopyCatchUp(brand, rec, ids, want) {
  const ch = await soAskChanged(brand, soCopyAskFrom(rec.cursor));
  if (!ch) return null;
  const r = Object.assign({}, rec, { orders: Object.assign({}, rec.orders) });
  const m = soCopyMerge(r.orders, ch.orders);
  if (ch.cursor) r.cursor = ch.cursor;
  soCopyMerge(r.orders, await soAskMissing(brand, r, ids, want));
  soCopyPrune(r.orders, Date.now());
  r.usedAt = r.syncedAt = Date.now();
  r.last = m;
  return r;
}

/* ---------- photos, after the orders are on screen ---------- */

const SO_PHOTOS = { SP: { v: {}, p: {}, asked: new Set() }, CPC: { v: {}, p: {}, asked: new Set() }, loaded: false };

function soPhotosApply(orders) {
  let n = 0;
  (orders || []).forEach(o => {
    const P = SO_PHOTOS[o.shopBrand === 'CPC' ? 'CPC' : 'SP'];
    (o.items || []).forEach(it => {
      if (it.img) return;
      const src = (it.vid && P.v[it.vid]) || (it.pid && P.p[it.pid]) || '';
      if (src) { it.img = src; n++; }
    });
  });
  return n;
}

/** The SKU → photo list, asked for once the orders show. Kept on the device in copy and shadow mode. */
async function soPhotosLoad() {
  const keep = soCopyMode() !== 'direct';
  if (keep && !SO_PHOTOS.loaded) {
    SO_PHOTOS.loaded = true;
    try {
      const rec = await soCopyGet('photos');
      if (rec && rec.ver === SO_COPY.ver && rec.uid === soCopyUid()) SO_BRANDS.forEach(b => { Object.assign(SO_PHOTOS[b].v, (rec[b] || {}).v || {}); Object.assign(SO_PHOTOS[b].p, (rec[b] || {}).p || {}); });
    } catch (e) { /* asked for again below */ }
  }
  soPhotosApply(SHOP.orders);
  let got = 0;
  await Promise.all(SO_BRANDS.map(async b => {
    const P = SO_PHOTOS[b], want = [];
    SHOP.orders.forEach(o => {
      if ((o.shopBrand === 'CPC' ? 'CPC' : 'SP') !== b) return;
      (o.items || []).forEach(it => { if (!it.img && it.pid && !P.asked.has(it.pid)) { P.asked.add(it.pid); want.push(it.pid); } });
    });
    for (let i = 0; i < want.length; i += SO_COPY.pidsPerCall) {
      try {
        const r = await prGet({ shopify: 'photos', ...(b === 'CPC' ? { shop: 'CPC' } : {}), pids: want.slice(i, i + SO_COPY.pidsPerCall).join(',') });
        Object.assign(P.v, r.v || {}); Object.assign(P.p, r.p || {});
        got++;
      } catch (e) { /* photos are a nicety — an order still ships without one */ }
    }
  }));
  soPhotosApply(SHOP.orders);
  if (got && keep) {
    const rec = { ver: SO_COPY.ver, uid: soCopyUid(), at: Date.now() };
    SO_BRANDS.forEach(b => { rec[b] = { v: SO_PHOTOS[b].v, p: SO_PHOTOS[b].p }; });
    soCopyPut('photos', rec).catch(() => {});
  }
}

/* ---------- the three modes, as the tab calls them ---------- */

/** COPY MODE, on the way in: show this device's copy at once if it covers the window. true = shown. */
async function soCopyOpen(want) {
  const recs = await Promise.all(SO_BRANDS.map(soCopyRead));
  if (!recs.every(x => x.rec && soCopyCovers(x.rec, want))) return false;
  const { ids } = soOldOpen(want.start);
  soCopyShow(recs.map(x => x.rec), want, ids, 'copy');
  return true;
}

/** Put the records on screen, as SHOP. */
function soCopyShow(recs, want, ids, from) {
  const orders = [];
  recs.forEach(rec => soCopyView(rec.orders, want, ids).forEach(o => orders.push(o)));
  const at = Math.min(...recs.map(r => r.at || Date.now()));
  const syncedAt = Math.min(...recs.map(r => r.syncedAt || r.at || 0));
  SHOP = { orders, from: want.start, to: want.end, tz: (recs[0] && recs[0].tz) || '', at: soStamp(), cpcErr: '',
    copy: { from, at, syncedAt, cursor: recs.map(r => r.cursor) } };
  soPhotosApply(SHOP.orders);
  soCopyAgeShow();
}

/** COPY MODE, in the background: what changed since, merged, saved, redrawn. A store that cannot be caught up is
 *  filled the full way. Never throws. */
async function soCopyRefresh(want, opts) {
  if (SO_COPY.running) return;
  SO_COPY.running = true;
  const { ids } = soOldOpen(want.start);
  const said = [];
  let fallback = false;
  try {
    /* PHASE 3, when it is on: the shared copy in Firestore first. The Refresh button (opts.now) asks the script to sync
     * it before it is read; an open whose shared copy is over two minutes old starts a sync and does not wait. */
    let meta = null;
    if (soCopySharedOn()) {
      if (opts && opts.now) { try { await prGet({ shopify: 'cacheSync' }); } catch (e) { /* read what is there */ } }
      meta = await soSharedMeta();
      if (meta && !(opts && opts.now) && SO_BRANDS.some(b => Date.now() - (((meta.stores || {})[b] || {}).syncedAt || 0) > SO_COPY.sharedStaleMs)) {
        prGet({ shopify: 'cacheSync' }).catch(() => {});
      }
      soSharedListen();
    }
    const recs = await Promise.all(SO_BRANDS.map(async b => {
      const { rec } = await soCopyRead(b);
      const t0 = Date.now();
      try {
        let r = meta ? await soCopyFromShared(b, rec, want, ids, meta) : null;
        let how = 'shared copy';
        if (!r) {
          r = rec && soCopyCovers(rec, want) ? await soCopyCatchUp(b, rec, ids, want) : null;
          how = r ? 'changed since' : 'full';
        }
        if (!r) r = soCopyRecord(b, await soAskStore(b, want, ids), want);
        await soCopyPut(b, r).catch(() => {});
        soCopySyncLog({ store: b, how, ms: Date.now() - t0, n: Object.keys(r.orders).length, last: r.last || null });
        return r;
      } catch (e) {
        soCopySyncLog({ store: b, how: 'failed', ms: Date.now() - t0, err: String((e && e.message) || e).slice(0, 160) });
        /* AUTO FALL-BACK (phase 4): a copy this old that cannot be brought up to date is not shown as if it were
         * current — the tab loads the old way instead, and says why. */
        if (!rec || Date.now() - (rec.syncedAt || rec.at || 0) > SO_COPY.fallbackMs) fallback = true;
        said.push(`${b === 'CPC' ? 'CPC' : 'Ridhi'}: Shopify could not be reached (${e.message || e}) — showing this device's copy`);
        return rec;
      }
    }));
    if (recs.every(Boolean)) {
      soCopyShow(recs, want, ids, said.length ? 'copy-old' : 'copy+changes');
      if (!said.length) SHOP_FETCHED_AT = Date.now();
    }
    soMsg(said.join(' · '), !!said.length);
    renderShop();
    if (!said.length) soCopyCountSoon(want);
    soPhotosLoad().then(() => renderShop()).catch(() => {});
    shpSyncSoon();
  } catch (e) {
    soMsg('The copy on this device could not be brought up to date: ' + (e.message || e), true);
  } finally { SO_COPY.running = false; }
  if (fallback) {
    soMsg('This device\'s copy is more than 30 minutes old and could not be brought up to date — loading from Shopify directly…', true);
    await fetchShopOrders({ live: true });
  }
}

/** After a full fetch (shadow and copy modes): compare it with what the copy would have shown (shadow), then keep it
 *  as the copy for next time. `byBrand` is { SP: soAskStore result, CPC: … }; `liveAt` is when the fetch began.
 *  Never throws, never changes what is on screen. */
async function soCopyAfterFetch(byBrand, want, liveAt) {
  const mode = soCopyMode();
  if (mode === 'direct') return;
  const { ids } = soOldOpen(want.start);
  const line = { at: new Date().toISOString(), by: (() => { try { return ME.email || ''; } catch (e) { return ''; } })(), mode, stores: {} };
  const t0 = Date.now();
  for (const b of SO_BRANDS) {
    const res = byBrand[b];
    const r = {};
    try {
      if (!res || res.err) { r.mode = 'no live answer'; line.stores[b] = r; continue; }
      if (mode === 'shadow') {
        const { rec, why } = await soCopyRead(b);
        if (!rec) r.mode = why;
        else if (!soCopyCovers(rec, want)) r.mode = 'copy does not cover this window';
        else {
          const up = await soCopyCatchUp(b, rec, ids, want);
          if (!up) r.mode = 'changed-since not usable';
          else {
            r.mode = 'delta'; r.delta = up.last;
            /* A race is judged on SHOPIFY's clock — the live answer's cursor — not on this device's. */
            Object.assign(r, soCopyDiff(soCopyView(soCopyRecord(b, res, want).orders, want, ids), soCopyView(up.orders, want, ids),
              soCopyMs(res.cursor) || liveAt));
          }
        }
        /* PHASE 5: with the shared copy on, it is compared too — built afresh from Firestore, exactly as a new device
         * would, against what Shopify just said. Up to five minutes behind is the design, and is counted apart. */
        if (soCopySharedOn()) {
          const meta = await soSharedMeta();
          const st = meta && (meta.stores || {})[b];
          const sh = meta ? await soCopyFromShared(b, null, want, new Set(), meta) : null;
          r.shared = sh ? soCopyDiff(soCopyView(soCopyRecord(b, res, want).orders, want, new Set()),
            soCopyView(sh.orders, want, new Set()), soCopyMs(res.cursor) || liveAt, soCopyMs(st && st.cursor))
            : { mode: meta ? 'shared copy not usable for this window' : 'no shared copy' };
        }
      }
      if (res.cursor) await soCopyPut(b, soCopyRecord(b, res, want));
      else r.kept = 'no cursor — the script is older; nothing kept';
    } catch (e) { r.err = String((e && e.message) || e).slice(0, 160); }
    line.stores[b] = r;
  }
  line.ms = Date.now() - t0;
  if (mode === 'shadow') soCopyLog(line);
}

/* ---------- phase 3: the shared copy in Firestore (Pricing-API/ShopifyCache.gs writes it) ----------
 * OFF as shipped (SO_COPY.shared); one device can try it with localStorage soCopyShared = '1' (and copy mode).
 * The contents page shopify_cache/meta says, per store, the cursor, when it last synced, and when each DAY's
 * document last changed; a device reads only the days whose time moved since it last looked. A shared copy that is
 * missing, in another format, older than 30 minutes, or that does not reach back to the window's first day is not
 * used: the device asks Shopify itself, exactly as in phase 2. */

function soCopySharedOn() {
  try {
    const s = localStorage.getItem('soCopyShared');
    if (s === '1') return true;
    if (s === '0') return false;
  } catch (e) { /* the shipped setting */ }
  return !!SO_COPY.shared;
}

/** The contents page, or null when there is none this app can use. */
async function soSharedMeta() {
  try {
    const s = await getDoc(doc(db, 'shopify_cache', 'meta'));
    if (!s.exists()) return null;
    const m = JSON.parse(s.data().json || 'null');
    return m && m.v === SO_COPY.ver ? m : null;
  } catch (e) { return null; }
}
async function soSharedDay(b, d) {
  const s = await getDoc(doc(db, 'shopify_cache_days', b + '_' + d));
  return s.exists() ? (JSON.parse(s.data().json || '{}').orders || {}) : {};
}

/** Which days to read: those whose time on the contents page is not the one this device last read. */
function soSharedDaysToRead(st, dayAt, from) {
  return Object.keys((st && st.days) || {}).filter(d => d >= from && st.days[d] !== (dayAt || {})[d]).sort();
}
/** One day's document into the device's orders. A day the shared copy holds WHOLE (from its first fill on) replaces
 *  that day — which is how an order removed there leaves here; an older day only merges. */
function soSharedApplyDay(orders, d, dayOrders, whole) {
  if (whole) Object.keys(orders).forEach(id => { if (orders[id] && orders[id].at === d) delete orders[id]; });
  soCopyMerge(orders, Object.values(dayOrders || {}));
}

/** This store's device record, brought up to date from the shared copy — or null to ask Shopify instead. */
async function soCopyFromShared(b, rec, want, ids, meta) {
  const st = (meta.stores || {})[b];
  if (!st || !st.cursor || !st.filledFrom || st.filledFrom > want.start) return null;
  if (Date.now() - (st.syncedAt || 0) > SO_COPY.fallbackMs) return null;     // phase 4: too old to show as current
  const base = rec && rec.src === 'shared' && soCopyCovers(rec, want) ? rec : null;
  const now = Date.now();
  const r = base ? Object.assign({}, base, { orders: Object.assign({}, base.orders), dayAt: Object.assign({}, base.dayAt) })
    : { ver: SO_COPY.ver, uid: soCopyUid(), brand: b, src: 'shared', from: want.start, all: true, tz: (rec && rec.tz) || '',
      at: now, orders: {}, dayAt: {} };
  /* A new device reads the window's days only; the older days are marked as seen, and read when they next change. */
  if (!base) Object.keys(st.days || {}).forEach(d => { if (d < want.start) r.dayAt[d] = st.days[d]; });
  const days = soSharedDaysToRead(st, r.dayAt, base ? '' : want.start);
  for (let i = 0; i < days.length; i += 10) {
    const part = await Promise.all(days.slice(i, i + 10).map(d => soSharedDay(b, d)));
    part.forEach((orders, j) => {
      const d = days[i + j];
      soSharedApplyDay(r.orders, d, orders, d >= st.filledFrom);
      r.dayAt[d] = st.days[d];
    });
  }
  Object.keys(r.dayAt).forEach(d => { if (!(d in (st.days || {}))) delete r.dayAt[d]; });
  r.cursor = st.cursor; r.syncedAt = st.syncedAt; r.usedAt = now;
  soCopyMerge(r.orders, await soAskMissing(b, r, ids, want));
  soCopyPrune(r.orders, now);
  r.last = { days: days.length };
  return r;
}

/** While the tab is open, the contents page is LISTENED to (one read per change, not a poll), and a change redraws. */
function soSharedListen() {
  if (SO_COPY.listening || typeof onSnapshot !== 'function') return;
  SO_COPY.listening = true;
  let first = true, t = null;
  try {
    onSnapshot(doc(db, 'shopify_cache', 'meta'), () => {
      if (first) { first = false; return; }
      clearTimeout(t);
      t = setTimeout(() => {
        if (soCopyMode() === 'copy' && soCopySharedOn() && SHOP && SHOP.copy) soCopyRefresh(soWant()).catch(() => {});
      }, 1500);
    }, () => { SO_COPY.listening = false; });
  } catch (e) { SO_COPY.listening = false; }
}

/* ---------- phase 4: the safety nets ---------- */

/** How old the copy on screen is, and what colour that is: grey, orange after 15 minutes, red after 30. */
function soCopyAge(syncedAt, nowMs) {
  const min = Math.max(0, Math.floor(((nowMs || Date.now()) - (syncedAt || 0)) / 60000));
  const tone = min >= SO_COPY.ageBadMin ? 'bad' : min >= SO_COPY.ageWarnMin ? 'warn' : 'ok';
  const txt = !syncedAt ? 'Not synced yet' : min < 1 ? 'Updated just now' : min < 60 ? `Updated ${min} min ago`
    : `Updated ${Math.floor(min / 60)} h ${min % 60} min ago`;
  return { min, tone, txt };
}
const SO_AGE_INK = { ok: 'var(--muted,#6b7280)', warn: 'var(--warn-ink,#B45309)', bad: 'var(--bad,#B91C1C)' };
/** The age on the toolbar, in copy mode only. Redrawn every half minute. */
function soCopyAgeShow() {
  try {
    const el = typeof $ === 'function' ? $('soAge') : null;
    if (!el) return;
    const c = SHOP && SHOP.copy;
    if (soCopyMode() !== 'copy' || !c || !c.syncedAt) { el.textContent = ''; return; }
    const a = soCopyAge(c.syncedAt);
    el.textContent = a.txt;
    el.style.color = SO_AGE_INK[a.tone];
    el.style.fontWeight = a.tone === 'ok' ? '' : '600';
    el.title = 'When this device last heard from Shopify. Orange after 15 minutes, red after 30; press Fetch orders to ask now.';
  } catch (e) { /* never in the way */ }
}
try { setInterval(soCopyAgeShow, 30000); } catch (e) { /* not a browser */ }

/** SYNC LOG: every catch-up, fill and failure, newest last (localStorage soCopySyncLog). */
function soCopySyncLog(line) {
  try {
    let all = [];
    try { all = JSON.parse(localStorage.getItem('soCopySyncLog') || '[]'); } catch (e) { all = []; }
    all.push(Object.assign({ at: new Date().toISOString() }, line));
    localStorage.setItem('soCopySyncLog', JSON.stringify(all.slice(-SO_COPY.syncLogMax)));
  } catch (e) { /* never in the way */ }
}

/** THE COUNT CHECK: the order ids Shopify has per day against the copy's. A day that does not match is loaded again
 *  whole — which is how an order DELETED on Shopify (no "changed since" ever reports one) leaves the copy. Returns
 *  the days that did not match. `days` is { 'YYYY-MM-DD': [id, …] } from ?shopify=orderIds. */
function soCopyCountDiff(orders, days, start, end) {
  const mine = {};
  Object.keys(orders).forEach(id => { const o = orders[id]; if (o && o.at >= start && o.at <= end) (mine[o.at] = mine[o.at] || []).push(String(id)); });
  const bad = [];
  new Set(Object.keys(mine).concat(Object.keys(days || {}))).forEach(d => {
    if (d < start || d > end) return;
    const a = (mine[d] || []).slice().sort().join(), b = (days[d] || []).map(String).sort().join();
    if (a !== b) bad.push(d);
  });
  return bad.sort();
}
/** Put the days that did not match back exactly as Shopify has them. `fresh` = every order of those days. */
function soCopyCountFix(orders, badDays, fresh) {
  const bad = new Set(badDays);
  Object.keys(orders).forEach(id => { if (bad.has(orders[id].at)) delete orders[id]; });
  soCopyMerge(orders, (fresh || []).filter(o => bad.has(o.at)));
}
function soCopyCountSoon(want) {
  try {
    if (soCopyMode() !== 'copy') return;
    if (Date.now() - Number(localStorage.getItem('soCopyCountAt') || 0) < SO_COPY.countEveryMs) return;
    localStorage.setItem('soCopyCountAt', String(Date.now()));
  } catch (e) { return; }
  setTimeout(() => soCopyCountRun(want).catch(() => {}), 0);
}
async function soCopyCountRun(want) {
  for (const b of SO_BRANDS) {
    const { rec } = await soCopyRead(b);
    if (!rec || !rec.all) continue;            // a "not yet shipped" copy cannot be counted against every order
    const shop = b === 'CPC' ? { shop: 'CPC' } : {};
    const r = await prGet({ shopify: 'orderIds', ...shop, start: want.start, end: want.end });
    if (r.mode !== 'orderIds' || r.more) continue;
    const bad = soCopyCountDiff(rec.orders, r.days || {}, want.start, want.end);
    if (bad.length) {
      const res = await soAskStore(b, { start: bad[0], end: bad[bad.length - 1], open: '0' }, new Set());
      const cur = (await soCopyRead(b)).rec;
      if (!cur) continue;
      soCopyCountFix(cur.orders, bad, res.orders);
      await soCopyPut(b, cur);
    }
    soCopySyncLog({ store: b, how: 'count check', days: bad.length, bad: bad.slice(0, 10) });
  }
}

/** One line per shadow run, on this device (localStorage soCopyLog, newest last) and in the console. */
function soCopyLog(line) {
  try {
    const bad = SO_BRANDS.reduce((n, b) => n + (((line.stores[b] || {}).mismatch) || 0) + ((((line.stores[b] || {}).shared) || {}).mismatch || 0), 0);
    (bad ? console.warn : console.info)('[shopify copy] shadow', bad ? bad + ' difference(s)' : 'no differences', line);
    let all = [];
    try { all = JSON.parse(localStorage.getItem('soCopyLog') || '[]'); } catch (e) { all = []; }
    all.push(line);
    localStorage.setItem('soCopyLog', JSON.stringify(all.slice(-SO_COPY.logMax)));
  } catch (e) { /* never in the way */ }
}
/** For the console: soCopyReport() — every shadow run kept on this device, and the total of differences. */
function soCopyReport() {
  let all = [];
  try { all = JSON.parse(localStorage.getItem('soCopyLog') || '[]'); } catch (e) { all = []; }
  const runs = all.filter(l => SO_BRANDS.some(b => (l.stores[b] || {}).mode === 'delta'));
  const bad = runs.reduce((n, l) => n + SO_BRANDS.reduce((m, b) => m + (((l.stores[b] || {}).mismatch) || 0), 0), 0);
  const sharedRuns = all.filter(l => SO_BRANDS.some(b => ((l.stores[b] || {}).shared || {}).live !== undefined));
  const sharedBad = sharedRuns.reduce((n, l) => n + SO_BRANDS.reduce((m, b) => m + ((((l.stores[b] || {}).shared) || {}).mismatch || 0), 0), 0);
  let syncs = [];
  try { syncs = JSON.parse(localStorage.getItem('soCopySyncLog') || '[]'); } catch (e) { syncs = []; }
  return { runs: all.length, compared: runs.length, differences: bad, since: all.length ? all[0].at : '', lines: all,
    sharedCompared: sharedRuns.length, sharedDifferences: sharedBad,
    syncs, failedSyncs: syncs.filter(s => s.how === 'failed').length };
}
try { window.soCopyReport = soCopyReport; window.soCopySetMode = soCopySetMode; } catch (e) { /* not a browser */ }

/** OWN ACTIONS: after Fulfil (and anything else this app tells Shopify), the copy changes straight away, so a reopen
 *  before the next sync does not show the old state. Shopify's own version replaces it as soon as it sends one. */
function soCopyTouch(orderId, patch) {
  const mode = soCopyMode();
  if (mode === 'direct') return;
  const id = String(orderId || '');
  const o = (SHOP.orders || []).find(x => x && String(x.id) === id);
  if (!o) return;
  const b = o.shopBrand === 'CPC' ? 'CPC' : 'SP';
  if (mode === 'copy') Object.assign(o, patch);
  soCopyRead(b).then(({ rec }) => {
    if (!rec) return;
    const had = rec.orders[id] || o;
    rec.orders[id] = soCopyStrip(Object.assign({}, had, patch, { mine: Date.now() }));
    return soCopyPut(b, rec);
  }).catch(() => {});
}
/* ==== END SHOPIFY ORDERS DEVICE COPY ==== */
