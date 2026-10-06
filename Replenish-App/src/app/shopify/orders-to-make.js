/* ================= SHOPIFY ORDERS THAT HAVE TO BE MADE =================
 *
 * A Shopify order neither Amazon nor India can fill has to be MADE, and until now that fact lived
 * only on this screen. Somebody read it, raised a Sales Order by hand, typed the SKUs again, and
 * remembered which customer it was for. Now the order opens itself in the Order Console, under the
 * Shopify order's own number, and stays there until the pieces exist.
 *
 * Ravi, 2026-09-06: "shopify orders jo ki production se required rahenge unka auto order open krna h
 * order console me shopify orders ke name se and unki tracking ho".
 *
 * THE NUMBER IS THE SHOPIFY ORDER. #4876 becomes `SHP-4876`. `SHP` is added to the reserved order
 * prefixes, so no channel can ever be created that collides with it, and the Order Console can be
 * filtered and searched by the customer's own order number — which is what "tracking" means here:
 * you follow #4876 through cut, issue and press without translating it into anything.
 *
 * WHAT GOES ON THE ORDER, per LINE and not per order. An order with one line in FBA and one that
 * has to be made puts only the second on it — 210 of the orders on that screen today are exactly
 * that shape ("partly"), and ordering the whole thing would make pieces that are already on a shelf
 * in Amazon. Adjustments raised against the same Shopify order join the SAME order rather than
 * opening a second one: one Shopify order is one production order, whatever caused it.
 *
 * WHAT IT REFUSES TO DO, and this is the one that matters most:
 *
 *   IT WILL NOT RUN UNTIL BOTH STOCK FIGURES HAVE BEEN READ. "Need from production" means neither
 *   Amazon nor India can fill it — and before those two maps load, NEITHER CAN, so every order on
 *   the screen reads as pending. Running then would open a production order for all 574 of them.
 *   The guard is the whole reason this is safe to do automatically.
 *
 *   IT WILL NOT REMOVE A LINE PRODUCTION HAS WORKED AGAINST. Once something is cut, issued,
 *   received or pressed, taking the row away would leave that work counted against nothing — the
 *   "1,225 rows carry NO Order ID" state the Order Console already warns about in red.
 *
 *   IT WILL NOT JUDGE AN ORDER IT CANNOT SEE. Opening the Adjustments tab without fetching orders
 *   means SO_ALL_ROWS is empty; that is not evidence that nothing is pending, and treating it as
 *   such would withdraw every order it had ever opened. Orders that were not evaluated are added to
 *   and never removed from.
 *
 * REBUILT, NOT APPENDED. Each run works out what each order SHOULD be and writes only the
 * difference, at a fixed key. Raising, re-sizing, filling from stock later and withdrawing are all
 * one path, and a second run with nothing changed writes nothing at all.
 */

/** The production order number for a Shopify order. */
const shpOrderNo = shopNo => 'SHP-' + String(shopNo || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();

/**
 * WHICH NUMBER THIS SHOPIFY ORDER GETS, AND NOBODY ELSE.
 *
 * Every shop numbers its own orders from 1, and this screen reads fetched orders and imported ones
 * as a single list — so #1001 can genuinely be two different customers at two different shops. Both
 * clean to SHP-1001, and sharing a production order between them would put one customer's pieces on
 * the other's job.
 *
 * The first one to claim a number KEEPS it, and the claim is read back out of the order book, so it
 * survives a reload and cannot drift between runs. A later order that wants the same number gets a
 * suffix taken from its own Shopify id — its own, so it is the same suffix every time, whatever
 * else happens to be loaded.
 */
function shpAssignNo(o, taken) {
  const base = shpOrderNo(o && o.no);
  if (base === 'SHP-') return '';
  const id = String((o && o.id) || '');
  const owner = taken.get(base);
  if (owner === undefined || owner === '' || owner === id) { taken.set(base, id); return base; }
  const tail = ((id.replace(/[^A-Za-z0-9]+/g, '').slice(-4)) || 'X').toUpperCase();
  let alt = base + '-' + tail, n = 2;
  while (taken.has(alt) && taken.get(alt) !== id) { alt = base + '-' + tail + n; n++; }
  taken.set(alt, id);
  return alt;
}

/** Who already owns each SHP- number, read out of the order book. */
function shpTakenNumbers() {
  const taken = new Map();
  (PTG.ob || []).forEach(r => {
    if (!r || String(r.orderNo || '').indexOf('SHP-') !== 0) return;
    const n = obUC(r.orderNo);
    if (!taken.has(n)) taken.set(n, String(r.shopOrderId || ''));
  });
  return taken;
}

/* A key with any of these in it cannot be written to that database at all — better refused here,
 * by name, than as a failed write halfway through the order book. */
const shpKeySafe = s => !/[.$#\[\]\/]/.test(String(s || ''));

/** An adjustment production has already given back is not something still to make. */
const adjOpen = ln => (ln && ln.adjState || 'raised') !== 'received';

/** The order an adjustment belongs to, from the adjustment's OWN snapshot — the Adjustments tab
 *  lists jobs raised six weeks ago and those orders are long outside the fetched window. */
function shpOrderOf(shopId) {
  const live = (SO_ALL_ROWS || []).find(x => x && x.id === shopId)
    || (SHOP.orders || []).find(x => x && x.id === shopId);
  if (live && live.no) return { id: live.id, no: live.no, at: live.at || '', items: live.items, live: true };
  const lines = (SHOP_META[shopId] || {}).lines || {};
  for (const k of Object.keys(lines)) {
    const ln = lines[k] || {};
    if (ln.adj && ln.adjOrder) return { id: shopId, no: ln.adjOrder, at: ln.adjOrderDate || ln.adjAt || '', items: null, live: false };
  }
  return null;
}

/** How much production has already happened against one order line. */
function shpWorkDone(orderNo, sku) {
  let n = 0;
  /* SHOPIFY WORK IS RECORDED IN pt_shopProd, not in Base Data — Ravi's choice, and this is what it
   * costs if nobody tells the rest of the code. Without this line the sync could delete a row with
   * eight pieces cut against it and leave that record pointing at an order line that no longer
   * exists. */
  try { const sp = spOf(orderNo, sku);
    if (sp) n += spNum(sp.cut) + spNum(sp.issued) + spNum(sp.received) + spNum(sp.pressed);
  } catch (e) { /* the Shopify record is not read on every screen */ }
  try { n += obCutQty(orderNo, sku) || 0; } catch (e) { /* cutting data not read */ }
  try { n += obPressQty(orderNo, sku) || 0; } catch (e) { /* press data not read */ }
  (PT.base || []).forEach(r => {
    if (!r || obUC(r.orderNo) !== obUC(orderNo) || obUC(r.sku) !== obUC(sku)) return;
    n += ptNum(r.issuePieces) + ptNum(r.receivedPieces);
  });
  return n;
}

/**
 * What one Shopify order needs made, by SKU.
 *
 * Two sources, deliberately added together rather than one overriding the other: a line nothing can
 * fill has never been sent, and an adjustment is a replacement for something sent wrong. In practice
 * they do not both apply to the same SKU — a line that was fulfilled is not pending — so the sum is
 * the honest total, and the remarks name both reasons where they do meet.
 */
/**
 * Has this line itself gone out?
 *
 * Shopify marks fulfilment per LINE as well as per order — ffl on the item, which soLive already
 * reads. On a partly fulfilled order that is the only thing that can tell the shipped half from the
 * half still being made, and #3289 is exactly that: one line in transit with a FedEx number on it,
 * one still in progress, and the app asking production to make the first.
 */
const shpLineShipped = i => /^ful/i.test(String((i && i.ffl) || ''));

/**
 * What an order needs made.
 *
 * `noSku`, when passed, collects the lines that are owed something and have NO CODE on the Shopify
 * variant. They cannot become a production order — there is nothing to make them against — and
 * guessing one would be worse than none. They are collected so the screen can name them.
 */
/**
 * Shopify's words and the master's, reduced to the same thing: inch marks and quotes dropped, any
 * kind of × between two numbers made a plain x, everything else to single spaces. Dots are kept —
 * a tissue box is 5x4.5x5.
 */
const shpWords = v => String(v == null ? '' : v).toLowerCase()
  .replace(/[\u2032\u2033\u201c\u201d\u2018\u2019"']/g, '')
  .replace(/(\d)\s*[x×*]\s*(\d)/g, '$1x$2')
  .replace(/[^a-z0-9.]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
/** Is this whole phrase in that text — as words, so "green" does not match "greengage". */
const shpHasPhrase = (hay, needle) => !!needle && (' ' + hay + ' ').indexOf(' ' + needle + ' ') >= 0;
/** The same, forgiving one plural: the shop writes "Napkins", the master writes "Napkin". */
const shpHasWord = (hay, w) => !!w && (shpHasPhrase(hay, w) || shpHasPhrase(hay, w + 's') || shpHasPhrase(hay, w + 'es')
  || (/s$/.test(w) && shpHasPhrase(hay, w.slice(0, -1))));
/* The shop leaves these out because the size already says which it is; nothing else may be missing. */
const SHP_SHAPE_WORDS = ['rectangular', 'rectangle', 'square', 'round', 'oval'];
/**
 * Every subtype the catalogue has, as a set of its words, indexed by word — learned from the
 * catalogue, never listed here, so a subtype added next year counts without anybody remembering
 * this line.
 */
let SHP_KIND = null, SHP_KIND_SRC = null;
function shpKinds() {
  const src = PTG.mdb || PT_NONE;
  if (SHP_KIND_SRC === src && SHP_KIND) return SHP_KIND;
  const subs = new Map();
  src.forEach(m => {
    const s = shpWords(m && m.subtype);
    if (s && !subs.has(s)) subs.set(s, new Set(s.split(' ').filter(Boolean)));
  });
  const byWord = new Map();
  subs.forEach(set => set.forEach(w => {
    if (w.length < 3 || SHP_SHAPE_WORDS.indexOf(w) >= 0) return;
    if (!byWord.has(w)) byWord.set(w, []);
    byWord.get(w).push(set);
  }));
  SHP_KIND_SRC = src; SHP_KIND = byWord;
  return byWord;
}
/**
 * Does this word in the title name a DIFFERENT product OF THE SAME KIND as the candidate?
 *
 * Tied to a real alternative on purpose. "Ruffle" objects to a plain Square Tablecloth because the
 * catalogue has Ruffle Square Tablecloths — same kind of thing, different product. "Set", which one
 * subtype somewhere happens to use (an oven mitt and pot holder set), objects to nothing when the
 * candidate is a napkin: no napkin subtype uses it, so "Set of 12" in a variant is a pack size and
 * not a claim about what the product is. That distinction is what stopped three real napkin orders
 * from opening.
 */
function shpOtherKind(word, mine) {
  const subs = shpKinds().get(word);
  if (!subs) return false;
  return subs.some(other => [...mine].some(w =>
    SHP_SHAPE_WORDS.indexOf(w) < 0 && w.length >= 3 && other.has(w)));
}

/**
 * The master row a codeless line is for, or null.
 *
 * Colour and size must BOTH be there in full; the product type's words then choose between the
 * rows that share them. Two rows equally good is not a match — it is a question, and the row says
 * so rather than opening a production order for the wrong thing.
 */
function shpSkuFromTitle(name, variant) {
  const title = shpWords(String(name || '') + ' ' + String(variant || ''));
  const size = shpWords(variant);
  if (!title) return null;
  let best = null, bestScore = 0, tied = false;
  (PTG.mdb || []).forEach(m => {
    if (!m || !m.sku || !m.color || !m.size) return;
    if (!shpHasPhrase(title, shpWords(m.color))) return;
    const sz = shpWords(m.size);
    if (!(sz === size || shpHasPhrase(title, sz))) return;
    /* WHAT IT IS HAS TO AGREE IN FULL, BOTH WAYS.
     *
     * Outward: every word of the master's subtype must be in the title, shape words excepted — a
     * colour and a size alone would match a bed pillow insert to a ruffle pillow cover, and did.
     *
     * Inward: the title must not say something about the product that this row does not have.
     * "Ruffle Tablecloth" matched a plain Square Tablecloth on the word "tablecloth" alone, and
     * production would have made the wrong thing. */
    const words = shpWords(m.subtype || m.articleType).split(' ').filter(Boolean);
    if (!words.length) return;
    let score = 0;
    for (const w of words) {
      if (shpHasWord(title, w)) { score++; continue; }
      if (SHP_SHAPE_WORDS.indexOf(w) >= 0) continue;        // the size says which shape it is
      return;                                                // anything else missing: not this product
    }
    if (!score) return;                                      // agreed on nothing but its shape
    /* The colour's own words are not claims about the product — "Rosette Vine" must not be read as
     * a kind of thing — so they come out before the title is asked what else it says. */
    const said = new Set(words);
    const colWords = new Set(shpWords(m.color).split(' '));
    for (const w of title.split(' ')) {
      if (!w || said.has(w) || colWords.has(w)) continue;
      if (shpOtherKind(w, said)) return;                     // the title names a product this is not
    }
    if (score > bestScore) { best = m; bestScore = score; tied = false; }
    else if (score === bestScore && String(m.sku) !== String(best && best.sku)) tied = true;
  });
  return best && !tied ? best : null;
}

/*
 * A LINE SHOPIFY SENT WITHOUT A SKU, made as a SKU somebody typed on the order (2026-10-06, Ravi on #7568: "i am unable to
 * open order as such orders"). Kept on the order, per line by its title — SHOP_META[id].mk[key] — never on a product, and
 * read before the title match: a person's answer beats a guess.
 */
const shpNoSkuKey = i => (String((i && i.name) || '') + ' · ' + String((i && i.variant) || '')).replace(/[^A-Za-z0-9]+/g, '_').slice(0, 90);
function shpTypedCode(orderId, i) {
  const mk = ((typeof SHOP_META === 'object' && SHOP_META && SHOP_META[orderId]) || {}).mk || {};
  return obUC(mk[shpNoSkuKey(i)] || '');
}
/**
 * THE TYPED CODE IS THE LINE'S CODE, everywhere (2026-10-06, Ravi: "SKU ADD KRKE HUM CHECK KAR PAY KI KYA MCF HO SAKTA H
 * OF YES USKO KAR SAKE"). Put on the item itself — i.sku, marked skuTyped — so FBA, MCF, India, the route and the MCF order
 * read it exactly as they read a code Shopify sent. Cleared, the line goes back to having none.
 */
function soApplyTypedSkus(orders) {
  (orders || []).forEach(o => (o && o.items || []).forEach(i => {
    if (!i || (!i.skuTyped && obUC(i.sku))) return;          // Shopify's own code: never touched
    const t = shpTypedCode(o.id, i);
    if (t) { i.sku = t; i.skuTyped = true; }
    else if (i.skuTyped) { i.sku = ''; i.skuTyped = false; }
  }));
}
/** The code a line is made as: Shopify's, else the one typed on the order, else the title's match. */
function shpLineCode(orderId, i) {
  const s = obUC(i && i.sku);
  if (s) return { sku: s, via: i.skuTyped ? 'SKU typed on the order' : '' };
  const t = shpTypedCode(orderId, i);
  if (t) return { sku: t, via: 'SKU typed on the order' };
  const m = shpSkuFromTitle(i && i.name, i && i.variant);
  return m ? { sku: obUC(m.sku), via: 'matched to the master database by its title' } : { sku: '', via: '' };
}
function shpNeeds(r, noSku, opts) {
  const out = new Map();
  const add = (sku, qty, why, adjId, name, img, pcs, sets, viaTitle) => {
    const s = obUC(sku);
    /* TWO DIFFERENT FACTS, and they used to share one silent return. Nothing owed is nothing to do.
     * A product with no code is money taken for something production will never hear about. */
    if (!s) {
      /* `name` already reads "Product · Variant" — the caller builds it that way, which is exactly
       * what somebody needs to find the thing in Shopify. */
      if (noSku && qty > 0) noSku.push({ name: String(name || '').trim(), qty });
      return;
    }
    if (!(qty > 0)) return;
    let e = out.get(s);
    if (!e) { e = { sku: s, qty: 0, why: [], adjId: '', name: '', img: '', pcs: 0, shopQty: 0, viaTitle: false }; out.set(s, e); }
    e.qty += qty;
    /* PIECES, whatever unit `qty` is in: said by the caller where it knows, the pack rule otherwise. */
    e.pcs += pcs > 0 ? pcs : qty * obPcsPerPack(s);
    e.shopQty += sets > 0 ? sets : qty;
    if (why && e.why.indexOf(why) < 0) e.why.push(why);
    if (adjId && !e.adjId) e.adjId = adjId;
    if (viaTitle) e.viaTitle = true;
    // Carried only so a SKU nobody has catalogued yet arrives on the Custom SKUs list with the
    // product's own name and picture attached, instead of as a bare code.
    if (name && !e.name) e.name = name;
    if (img && !e.img) e.img = img;
  };

  /* The lines neither Amazon nor India can fill. Judged per LINE — soLineState already accounts for
   * refunds, buyer removals, a quantity typed down to 0, and pack splits. */
  /* An order somebody has written DONE on opens nothing. An ADJUSTMENT raised against it still
   * does, below: that is a person deliberately asking for a piece to be made, and a note about the
   * original shipment does not withdraw it. */
  /* AND AN ORDER THAT HAS SHIPPED NEEDS NOTHING MADE. The sync has always claimed to close an order
   * "when the stock arrives or the order ships"; it did the first and never the second, which is why
   * orders from July were still sitting in the production queue. */
  /* A variant with no SKU is not the end of it: the title carries subtype, colour and size, and
   * the master database can be asked. What is found is marked, never silently pretended. */
  const codeOf = i => shpLineCode(r.id, i);
  /* evenHandled (2026-09-28): the bucket and an opening from it look past a "done / ready" note — a person decides
   * there, with the note in front of them. #3873 said "READY TO SHIP" with three pieces never made. */
  if (r.items && !r.cancelled && (!r.handled || (opts && opts.evenHandled)) && !r.shipped) {
    r.items.forEach(i => {
      /* THIS LINE HAS GONE. Whether the order calls itself partial or fulfilled does not matter —
       * what is in transit is not waiting to be made. */
      if (shpLineShipped(i)) return;
      let st;
      try { st = soLineState(r, i); } catch (e) { return; }
      if (!st || st.v !== 'make') return;
      /* The send quantity is in AMAZON packs when the SKU is a split (a set of 8 sent as 2 × a pack
       * of 4): pieces are those packs × the Amazon pack. Otherwise it is the customer's own sets. */
      const code = codeOf(i);
      const send = soSendQty(r.id, i.sku, soLive(i));
      const fit = soPackFit(code.sku);
      const split = !!(fit && fit.ok);
      add(code.sku, send, 'neither Amazon nor India can fill it' + (code.via ? ' · ' + code.via : ''), '',
        String(i.name || '') + (i.variant ? ' · ' + i.variant : ''), i.img || i.image || '',
        split ? send * fit.pack : 0, split ? Math.round(send / fit.factor) : 0, !!code.via);
    });
  }

  /* And anything raised as an adjustment against the same order — unless that order has shipped.
   *
   * Ravi's rule, chosen knowingly: "unka real #2923 order number yadi fulfill ho to wo bhi auto
   * production se remove ho jana chahiye."
   *
   * The order-level test cannot be narrower than that: Shopify gives a fulfilment status and no
   * fulfilment DATE, so there is no way to ask whether the order shipped before the adjustment was
   * raised — the replacement still owed — or after it. What it CAN do is ask the line above, which
   * is per-SKU and answers the partly-fulfilled case exactly.
   *
   * Nothing is destroyed by this. The adjustment keeps its own state on the order and stays on the
   * Adjustments tab; only the production row goes. A replacement that really is still owed is
   * visible there and can be raised again. */
  const lines = (SHOP_META[r.id] || {}).lines || {};
  Object.keys(lines).forEach(k => {
    const ln = lines[k] || {};
    if (!ln.adj || !adjOpen(ln)) return;
    /* The same question, asked of the line the adjustment is against rather than of the whole order:
     * on a partly fulfilled order only one of its SKUs may have gone. */
    if (r.shipped) return;
    const own = (r.items || []).find(i => obUC(i && i.sku) === obUC(k));
    if (own && shpLineShipped(own)) return;
    add(k, Math.round(Number(ln.adjQty) || 0),
      'adjustment' + (ln.adjReason ? ': ' + ln.adjReason : ''), ln.adj,
      String(ln.adjName || ''), String(ln.adjImg || ''));
  });

  return [...out.values()];
}

/**
 * WORK OUT the production order for one Shopify order. Writes nothing.
 *
 * `full` says whether the live order was actually seen. When it was not — the Adjustments tab
 * opened without a fetch — nothing is removed, because "I cannot see it" is not "it is no longer
 * needed", and acting on that difference would withdraw work the floor is holding.
 */
/**
 * WHY A SHOPIFY ORDER LINE IS OVER, from Shopify's side: '' while it is still owed. (2026-09-26)
 */
function shpDoneWhy(o, sku) {
  if (!o) return '';
  if (o.cancelled) return 'cancelled';
  if (o.shipped) return 'fulfilled';
  if (o.handled) return 'marked done';
  const s = obUC(sku);
  const it = (o.items || []).find(i => (obUC(i && i.sku) || obUC((shpSkuFromTitle(i && i.name, i && i.variant) || {}).sku)) === s);
  if (!it) return '';
  if (shpLineShipped(it)) return 'fulfilled';
  if ((Number(it.qty) || 0) > 0 && soLive(it) === 0) return 'refunded';
  return '';
}

/* opts (2026-09-26):
 *   maintain — the automatic run. Opens nothing, withdraws nothing; completes an open line Shopify has closed.
 *   only     — a Set of SKUs: open just these (from the bucket). Nothing else of the order is touched.
 *   force    — Map sku → { qty, pcs, shopQty, why, name, img }: open a line the stock says it can fill. */
/**
 * The order book grouped by order number, kept until the book is replaced or grows. It holds POSITIONS, not rows: a
 * save swaps a row in place (PTG.ob[i] = row), and a row held here would be yesterday's copy of it.
 */
let SHP_OB_BY = { src: null, n: -1, map: null };
function shpObOf(no) {
  const src = PTG.ob || null;
  if (SHP_OB_BY.src !== src || SHP_OB_BY.n !== (src ? src.length : -1) || !SHP_OB_BY.map) {
    const m = new Map();
    (src || []).forEach((x, i) => { if (!x) return; const k = obUC(x.orderNo); if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
    SHP_OB_BY = { src, n: src ? src.length : -1, map: m };
  }
  return (SHP_OB_BY.map.get(obUC(no)) || []).map(i => src[i]);
}
let SHP_MDB_BY = { src: null, map: null };
function shpMdbBy() {
  const src = PTG.mdb || null;
  if (SHP_MDB_BY.src !== src || !SHP_MDB_BY.map) SHP_MDB_BY = { src, map: new Map((src || []).map(x => [obUC(x.sku), x])) };
  return SHP_MDB_BY.map;
}
function shpPlanOrder(o, full, assigned, opts) {
  const O = opts || {};
  const out = { no: '', patch: {}, rows: [], drop: '', written: 0, removed: 0, dupes: 0, kept: [], skipped: [], needSku: [], err: '', isNew: false, done: 0 };
  if (typeof o === 'string') o = shpOrderOf(o);
  if (!o || !o.no) { out.err = 'This order has no Shopify order number, so there is nothing to raise against.'; return out; }
  if (full === undefined) full = !!o.items;
  const no = assigned || shpAssignNo(o, shpTakenNumbers());
  if (!no || no === 'SHP-') { out.err = `Shopify order "${o.no}" has no letters or digits in its number.`; return out; }
  out.no = no;

  const obKey = sku => 'ob_shp_' + no + '_' + sku;
  const noSku = [];
  let want = shpNeeds(o, noSku, O.only ? { evenHandled: true } : undefined);
  if (O.only) want = want.filter(w => O.only.has(w.sku));
  if (O.force) O.force.forEach((f, sku) => {
    if (want.some(w => w.sku === sku)) return;
    want.push({ sku, qty: f.qty, pcs: f.pcs || f.qty * obPcsPerPack(sku), shopQty: f.shopQty || f.qty, why: [f.why || 'opened by hand'],
      adjId: '', name: f.name || '', img: f.img || '', viaTitle: false });
  });
  /* Named, not counted: "three lines could not be ordered" sends nobody anywhere, and the fix is on
   * one particular variant in Shopify. */
  noSku.forEach(n => out.skipped.push({ sku: '(no code)',
    why: `"${n.name || 'a line with no product name'}" has no SKU on its Shopify variant — set it in Shopify and this will open by itself` }));

  /* NOT BEING IN THE MASTER DATABASE NO LONGER REFUSES THE ORDER.
   *
   * It used to: without a master row there is no article, colour or size, and every gate downstream
   * measures against those — so 17 of 66 adjusted lines were named and left out. Ravi, 2026-09-06:
   * "yadi sku master data base me nahi h but uska order open ho jana chahiye and uska sku custum sku
   * me open ho jana chahiye and m custom sku me data sahi krke final masterdata base me add kardu".
   *
   * So the order opens with the SKU exactly as Shopify spells it, and the code is put on the CUSTOM
   * SKUs list — a separate node, pt_customSkus, which the Master Database tab already shows as its
   * own view because one-off items must never quietly amend the real catalogue. It arrives with the
   * product's name and picture and blank article/colour/size, which is the work left to do.
   *
   * The only thing still refused is a SKU the database cannot make a key out of. */
  /* ONCE PER MASTER, not once per order (2026-09-26): built fresh here it walked 5,035 rows for each of 2,649 orders
   * on every sync — 0.3 s of the 0.65 s the sync took. */
  const mdbBy = shpMdbBy();
  const good = [];
  want.forEach(w => {
    if (!shpKeySafe(w.sku)) { out.skipped.push({ sku: w.sku, why: 'the production database cannot use one of those characters in a key' }); return; }
    if (!mdbBy.has(w.sku)) { w.needsSku = true; out.needSku.push(w); }
    good.push(w);
  });

  const keep = new Set(good.map(g => g.sku));
  const now = new Date().toISOString();
  const date = String(o.at || '').slice(0, 10) || soStoreDay(0);
  /* ONE ROW PER ORDER AND SKU, ENFORCED.
   *
   * ordLines() adds rows together by order and SKU, so a second row for the same pair does not
   * appear as a duplicate — it appears as double the quantity, and nothing on any screen says so.
   * Whatever wrote it (an older key prefix, a half-finished migration, two tabs racing), the
   * canonical key wins and the rest are deleted with the same batch. */
  const had = new Map();
  const strays = [];
  /* THIS ORDER'S ROWS FROM AN INDEX, not a walk of the whole book for each of 2,600 orders (2026-09-26). */
  shpObOf(no).forEach(x => {
    if (!x || obUC(x.orderNo) !== no) return;
    const s = obUC(x.sku);
    const key = String(x.id || x._key || '');
    const prev = had.get(s);
    if (!prev) { had.set(s, x); return; }
    // Keep whichever sits at the key this code writes to; the other is the stray.
    if (key === obKey(s)) { strays.push(prev); had.set(s, x); } else { strays.push(x); }
  });
  strays.forEach(x => {
    const key = String(x.id || x._key || '');
    if (!key) return;
    out.patch['pt_orderBook/' + key] = null;
    out.dupes++;
  });
  out.isNew = !had.size;

  /* THE AUTOMATIC RUN: nothing opens, nothing is withdrawn — and NOTHING CLOSES (Ravi, 2026-10-05: "ek bar jo order
   * production me open ho jay wo jab tak production se close nahi ho wo kabhi bhi close nahi hona chahiye").
   * A line ends only when production hands it to shipping. What Shopify says — fulfilled, cancelled, refunded, a
   * DONE / READY note — is written on the line as shopSays, so the floor sees it and decides; it closes nothing.
   * (Until today it closed the line: 26 Sep for fulfilled/cancelled/refunded, and a note until earlier today.)
   * Lines Shopify closed before this stay closed (shopDoneAt) — Ravi: "jaisi hain waisi rehne do". */
  if (O.maintain) {
    if (full) had.forEach((x, sk) => {
      if (x.shopDoneAt) return;
      const why = shpDoneWhy(o, sk) || '';
      if (String(x.shopSays || '') === why) return;
      const key = x.id || x._key || obKey(sk);
      out.patch['pt_orderBook/' + key + '/shopSays'] = why || null;
      out.patch['pt_orderBook/' + key + '/shopSaysAt'] = why ? now : null;
      out.rows.push(Object.assign({}, x, { shopSays: why, shopSaysAt: why ? now : '' }));
      if (why) out.done++;
    });
    return out;
  }

  if (full) {
    had.forEach((x, s) => {
      if (keep.has(s)) return;
      if (shpWorkDone(no, s) > 0) { out.kept.push(s); return; }
      out.patch['pt_orderBook/' + (x.id || obKey(s))] = null;
      out.removed++;
    });
  }

  good.forEach(g => {
    const m = mdbBy.get(g.sku) || {};
    const was = had.get(g.sku);
    const row = {
      id: obKey(g.sku), orderNo: no, orderDate: date, sku: g.sku,
      articleType: String(m.articleType || ''), articleSubtype: String(m.subtype || ''),
      color: String(m.color || ''), size: String(m.size || ''), qty: g.qty,
      /* What the quantity means in pieces, and in the customer's own sets. `qty` can be in Amazon
       * packs; these cannot be misread. */
      pcs: g.pcs || 0, shopQty: g.shopQty || 0,
      remarks: 'Shopify ' + o.no + (g.adjId ? ' · ' + g.adjId : '')
        + (g.why.length ? ' · ' + g.why.join(' + ') : '')
        + (g.needsSku ? ' · SKU not catalogued yet — on the Custom SKUs list' : ''),
      src: 'SHP', needsSku: !!g.needsSku,
      /* The code was worked out from the title, not sent by Shopify. Kept on the row so anybody
       * can check it against the product, and so the screens can say so. */
      titleMatch: !!g.viaTitle,
      // Both ids on the row itself, so the floor can see what it is making and for whom without
      // opening anything else, and without this app being able to reach Shopify again.
      shopOrderNo: String(o.no || ''), shopOrderId: String(o.id || ''), adjId: g.adjId || '',
      /* THE PHOTO THE ORDER WAS PLACED AGAINST — the variant's where Shopify has one. The master
       * database's picture is a different photo of a different listing, and on a SKU nobody has
       * catalogued yet there is none at all. */
      shopImg: String(g.img || ''),
      uploadedBy: ME.email, uploadedAt: was ? (was.uploadedAt || now) : now,
    };
    /* WHO OPENED IT, AND WHETHER THE STOCK SAID NOT TO (2026-09-26). */
    if (!was && (O.only || O.force)) {
      row.openedBy = ME.email; row.openedAt = now; row.openedFrom = 'bucket';
      if (o.handled) row.openedPastNote = String(o.handledWhy || 'marked done');
    }
    if (!was && O.force && O.force.has(g.sku)) { row.forced = true; row.forcedWhy = String(O.force.get(g.sku).why || ''); }
    if (was) ['openedBy', 'openedAt', 'openedFrom', 'forced', 'forcedWhy', 'openedPastNote'].forEach(f => { if (was[f] !== undefined) row[f] = was[f]; });
    /* Unchanged rows are not rewritten — this runs after every fetch, and `uploadedAt` alone would
     * make six hundred untouched rows look new. */
    const same = was && was.qty === row.qty && was.adjId === row.adjId && was.remarks === row.remarks
      && (parseInt(was.pcs, 10) || 0) === row.pcs && (parseInt(was.shopQty, 10) || 0) === row.shopQty
      && !!was.needsSku === !!row.needsSku && !!was.titleMatch === !!row.titleMatch
      && was.shopOrderNo === row.shopOrderNo && was.shopOrderId === row.shopOrderId
      && String(was.shopImg || '') === row.shopImg
      && was.articleType === row.articleType && was.color === row.color
      && was.size === row.size && was.orderDate === row.orderDate;
    if (!same) { out.patch['pt_orderBook/' + obKey(g.sku)] = row; out.written++; }
    out.rows.push(row);
  });

  /* The sales order the Sales Orders tab shows. Approved, because nobody is going to approve six
   * hundred of them and the decision was made by the stock figures, not by a person. NO delivery
   * date is invented: Shopify does not promise production a date, and a made-up one reads as a
   * commitment. */
  const prev = (Array.isArray(SOX.rows) ? SOX.rows : []).find(x => x && x._id === no) || null;
  if (good.length) {
    const rec = {
      _id: no, channel: 'SPY', orderDate: date,
      legacyOrderId: String(o.no || ''), shopOrderId: String(o.id || ''),
      orderTypeKey: 'regular', deliveryMode: 'complete', deliveryDate: '',
      /* Opened from the bucket a few lines at a time: the lines already on the sales order stay on it. */
      lines: (ln => (O.only || O.force) && prev ? (prev.lines || []).filter(x => x && !ln.some(y => y.sku === obUC(x.sku))).concat(ln) : ln)(
        good.map(g => ({ sku: g.sku, qty: g.qty, deliveryDate: '', orderTypeKey: 'regular', priority: '', adjId: g.adjId || '' }))),
      buyerEmail: prev ? prev.buyerEmail : ME.email,
      buyerName: prev ? prev.buyerName : (ME.email || '').split('@')[0],
      status: 'approved', src: 'SHP', autoFrom: 'shopify',
      saRemarks: 'Opened automatically from Shopify ' + o.no + ' — no delivery date is promised.',
      createdAt: prev ? prev.createdAt : now, createdBy: prev ? prev.createdBy : ME.email,
      approvedAt: prev ? (prev.approvedAt || now) : now, approvedBy: prev ? (prev.approvedBy || ME.email) : ME.email,
      updatedAt: now,
    };
    const sameSo = prev && JSON.stringify(prev.lines || []) === JSON.stringify(rec.lines)
      && prev.legacyOrderId === rec.legacyOrderId && prev.shopOrderId === rec.shopOrderId;
    if (!sameSo) out.patch['pt_salesOrders/' + no] = rec;
    out.rec = rec;
  } else if (full && !out.kept.length && (prev || had.size)) {
    /* Nothing left to make and nothing worked against — the order goes. This is what closes an
     * order once Amazon restocks or the pieces are shipped. */
    out.patch['pt_salesOrders/' + no] = null;
    out.drop = no;
  }
  return out;
}

/**
 * EVERY Shopify order that has something to make, reconciled into the order book.
 *
 * Planned first and written in batches: six hundred orders one at a time is twelve hundred round
 * trips, and when nothing has changed it writes nothing at all.
 */
async function shpPlanAll(opts) {
  const M = !!(opts && opts.maintain);
  const tot = { looked: 0, orders: 0, newOrders: 0, written: 0, removed: 0, dupes: 0, pieces: 0, done: 0,
    kept: [], skipped: [], custom: [], plans: [], patch: {}, err: '' };
  const needing = new Map();

  /* THE GUARD. Before both stock maps are read, nothing can fill anything, so every order on the
   * screen reads as "needs making". Opening six hundred production orders because a workbook was
   * still loading is the failure this exists to prevent. */
  if (!SHOP_STOCK_LOADED) { tot.err = 'Amazon stock has not been read yet — until it is, every order looks as though it has to be made. Nothing was sent to production.'; return tot; }
  if (!SHOP_INDIA_LOADED || SHOP_INDIA_ERR) {
    tot.err = 'India stock has not been read yet' + (SHOP_INDIA_ERR ? ' (' + SHOP_INDIA_ERR + ')' : '')
      + ' — until it is, every order looks as though it has to be made. Nothing was sent to production.';
    return tot;
  }

  await ptLoadGates();
  if (PTG.err) { tot.err = 'Could not read the production database: ' + PTG.err; return tot; }

  /* Every order actually seen, plus any order carrying an open adjustment even if it is outside the
   * fetched window. The first set may be judged in full; the second may only be added to. */
  /* The Custom SKUs list, read once, so a code already waiting there is not written again. */
  if (SHP_CUSTOM === null) {
    try { SHP_CUSTOM = ptList(await ptGet('pt_customSkus')); }
    catch (e) { SHP_CUSTOM = []; }
  }

  const seen = new Set();
  const jobs = [];
  (SO_ALL_ROWS || []).forEach(r => { if (r && r.id) { seen.add(r.id); jobs.push({ o: r, full: true }); } });
  Object.keys(SHOP_META).forEach(id => {
    if (seen.has(id)) return;
    const lines = (SHOP_META[id] || {}).lines || {};
    if (!Object.keys(lines).some(k => lines[k] && lines[k].adj && adjOpen(lines[k]))) return;
    const o = shpOrderOf(id);
    if (o) jobs.push({ o, full: false });
  });
  tot.looked = jobs.length;

  /* Numbers are handed out ONCE for the whole run. Planning the same number twice would have the
   * second plan read an order book the first has not been written to yet — and decide to delete the
   * rows the first just made. */
  const taken = shpTakenNumbers();
  const planned = new Set();

  jobs.forEach(({ o, full }) => {
    const no = shpAssignNo(o, taken);
    if (!no) { tot.skipped.push({ sku: (o && o.no) || '?', why: 'that order number has no letters or digits in it' }); return; }
    if (planned.has(no)) { tot.skipped.push({ sku: no, why: 'planned twice in one run — the second was ignored' }); return; }
    planned.add(no);
    const p = shpPlanOrder(o, full, no, M ? { maintain: true } : undefined);
    if (p.err) { tot.skipped.push({ sku: p.no || (o && o.no) || '?', why: p.err }); return; }
    tot.done += p.done || 0;
    /* Kept and skipped lines are an outcome too. Filtering on "did it write anything" threw away
     * the plan whose only news was that a line was left standing because the floor is holding it. */
    if (!Object.keys(p.patch).length && !p.rows.length && !p.kept.length && !p.skipped.length) return;
    tot.plans.push(p);
    Object.assign(tot.patch, p.patch);
    tot.written += p.written; tot.removed += p.removed; tot.dupes += p.dupes || 0;
    tot.kept = tot.kept.concat(p.kept);
    tot.skipped = tot.skipped.concat(p.skipped);
    if (p.written) { tot.orders++; if (p.isNew) tot.newOrders++; }
    p.rows.forEach(x => { tot.pieces += x.qty; });
    p.needSku.forEach(w => { if (!needing.has(w.sku)) needing.set(w.sku, w); });
  });

  /* Anything not catalogued goes onto the Custom SKUs list, once, with what Shopify knows about it.
   * Written into the SAME batch as the order lines: the order and the code it names have to arrive
   * together or the Master Database will not be able to explain a row somebody is already cutting. */
  const have = new Set((SHP_CUSTOM || []).map(r => obUC(r && r.sku)).concat((PTG.mdb || []).map(r => obUC(r && r.sku))));
  const nowIso = new Date().toISOString();
  needing.forEach((w, sku) => {
    if (have.has(sku)) return;
    const rec = shpCustomRec(w, sku, nowIso);
    tot.patch['pt_customSkus/' + sku] = rec;
    tot.custom.push(sku);
    SHP_CUSTOM.push(rec);
  });
  return tot;
}
/** A code not in the Master Database, put on the Custom SKUs list with what Shopify knows about it. */
function shpCustomRec(w, sku, nowIso) {
    return {
      sku, articleType: '', subtype: '', color: '', size: '',
      brand: '', packOf: '', fabric: '', cuttingRequired: true, consumption: 0,
      isZip: false, chainLength: null, zipQty: null,
      isRuffle: false, ruffleMeters: null, ruffleFabric: '',
      fillerFabricRequired: false, standardFillingQty: null,
      inventoryValuationPrice: 0, imageUrl: String(w.img || ''),
      isCustom: true,
      // Where it came from, so nobody has to guess what this code is before completing it.
      fromShopify: true, shopName: String(w.name || ''),
      addedBy: ME.email, addedAt: nowIso,
    };
}

