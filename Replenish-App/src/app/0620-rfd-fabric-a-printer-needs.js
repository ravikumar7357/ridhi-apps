/* ================= RFD FABRIC A PRINTER NEEDS =================
 *
 * Ravi, 2026-09-18: "printer vendor ko me printing order dalta hu to uske RFD fabric ka requirement
 * rhta h to wo apne order ke according requirement raise kar sakte hai (printer vendor) jo ki mujhe
 * dikhe or me apne rdf bando ko uska access de dunga ki kis printer ko kya mal chahiye — yadi order
 * ke according h to auto approve yadi kuch advance requirement h to approval needed."
 *
 * ---- WHERE IT LIVES, AND WHY IT IS SPLIT IN TWO ----
 *
 * The database rules grant a printer exactly one branch — pt_vendorOrders/<their own code> — and
 * refuse them the root. That is not a detail to design around; it is the whole reason printers cannot
 * read each other's prices. So a printer's ASK is written inside the order it belongs to:
 *
 *     pt_vendorOrders/<code>/<orderId>/rfdReqs/<reqId>
 *
 * which needs no change to the rules and keeps the requirement attached to the order that justifies
 * it. A new top-level node would have been unreadable and unwritable by the very people who have to
 * raise these.
 *
 * But a printer can write ANYTHING into their own branch, including the word "approved". So the
 * DECISION is kept somewhere they cannot reach:
 *
 *     pt_rfdDecisions/<reqId>          — staff only, under the root grant that excludes vendors
 *
 * Nothing in here ever reads a decision out of the vendor's branch. After staff answer, a copy is
 * mirrored back into the printer's own record so they can see the outcome on their screen — display
 * only, never read back by this end. A printer editing that mirror changes what they themselves see
 * and nothing else.
 *
 * ---- THE CEILING ----
 *
 * "Order ke according" is a number this app can work out, so it does, rather than asking anybody to
 * type it. A RUNNING line already says its own cloth and its own metres. A CUT line says a SKU and a
 * count of pieces, and the master database turns that into cloth: consumption is metres of that
 * fabric per piece. Live data, 18 Sep: 1,032 of 1,043 printing lines (99%) can be worked out this way.
 *
 * The ceiling is never stored. Orders get edited, lines get cancelled, and a figure frozen at the
 * moment somebody asked would quietly stop matching the order it claims to be "according to".
 *
 * Wastage is deliberately NOT allowed for. Ravi's rule is that anything beyond what the order needs
 * is an advance requirement and goes to a person — so a printer asking for the extra table length
 * gets an approval queue, which is exactly what he asked for.
 */

let RFD = { decisions: null, err: '', busy: false, at: '', shown: [], stock: {} };

/* ---- who may do what ----
 *
 * Seeing is the tab. Answering and handing cloth over are separate rights, the way they are on every
 * other screen since the permissions audit — having a screen has not been the permission anywhere
 * else in this app for a week, and this is not the place to start again.
 */
const rfdCanSee = () => !spIsVendor() && !!(ME.admin || (ME.tabs || []).indexOf('rfd') >= 0 || ME.rfdApprove || ME.rfdSend);
const rfdCanApprove = () => !spIsVendor() && !!(ME.admin || ME.rfdApprove);
const rfdCanSend = () => !spIsVendor() && !!(ME.admin || ME.rfdSend);
const RFD_NO_APPROVE = 'Answering an RFD requirement needs permission. Ask an admin to switch on '
  + '"Can approve RFD requirements" for your account.';
const RFD_NO_SEND = 'Marking RFD fabric as sent needs permission. Ask an admin to switch on '
  + '"Can mark RFD fabric sent" for your account.';

/* ---- how much cloth an order comes to ---- */

/**
 * The cloth one printing line needs, in metres of one named fabric.
 *
 * Returns { fabric, metres, how } — and how is the reason when it comes to nothing, because a line
 * that cannot be worked out has to be SAID rather than silently counted as zero. A zero here would
 * mean "this order allows no cloth at all", which would send a perfectly ordinary request to an
 * approver with no explanation.
 */
/**
 * Is this line handed to the printer as CLOTH or as CUT PIECES?
 *
 * The printing rules answer it, and they are the same rules the printer allocation and the cloth
 * forecast already run on — so there is one place where "Tablecloth goes out cut" is written down.
 *
 * A running LINE is always cloth whatever any rule says: it is metres of a named fabric and there
 * are no pieces to count. Where no rule exists, a cut line is treated as pieces, because the line
 * itself is in pieces — that is read off the order rather than guessed about the article — and the
 * card says the rule is missing so somebody can set it.
 */
function rfdIssueAs(o, l) {
  if (!l) return 'running';
  if (voKind(l) === 'running' || (o && o.orderType === 'running')) return 'running';
  const rule = ptPrintIssueAs(mdbOf(l.sku));
  if (rule === 'cut' || rule === 'running') return rule;
  return 'cut';
}
/** Is there a rule behind that answer, or is it the fallback? */
const rfdIssueRuled = (o, l) => (!l || voKind(l) === 'running' || (o && o.orderType === 'running'))
  ? true : ['cut', 'running'].indexOf(ptPrintIssueAs(mdbOf(l.sku))) >= 0;

function rfdLineNeed(o, l) {
  if (!o || !l || l.cancelled) return { fabric: '', metres: 0, how: 'cancelled' };
  if (voKind(l) === 'running' || o.orderType === 'running') {
    const fabric = String(l.fabricType || '').trim();
    const m = parseFloat(l.meters) || 0;
    if (!fabric) return { fabric: '', metres: 0, how: 'the line does not say which fabric' };
    return { fabric, metres: m, how: 'the line says so' };
  }
  const m = mdbOf(l.sku);
  if (!m) return { fabric: '', metres: 0, how: 'SKU ' + (l.sku || '?') + ' is not in the master database' };
  const fabric = String(m.fabric || '').trim();
  if (!fabric) return { fabric: '', metres: 0, how: 'the master database has no fabric for ' + (l.sku || '?') };
  const cons = parseFloat(m.consumption) || 0;
  if (!(cons > 0)) return { fabric, metres: 0, how: 'the master database has no consumption for ' + (l.sku || '?') };
  return { fabric, metres: (parseFloat(l.qty) || 0) * cons, how: 'pieces x consumption' };
}

/**
 * What a whole order comes to, fabric by fabric.
 *
 * { byFab: Map(fabric -> metres), unknown: [reason…] } — the unresolved lines travel with it so a
 * screen can say "and 3 lines we could not work out" instead of quietly showing a smaller ceiling.
 */
function rfdOrderNeed(o) {
  return o ? rfdMemoOf('need', o, '', () => rfdOrderNeedBuild(o)) : rfdOrderNeedBuild(o);
}
function rfdOrderNeedBuild(o) {
  const byFab = new Map(), unknown = [];
  voLines(o || {}).forEach(l => {
    /* Cancelled lines are refused by rfdLineNeed, which says so as its reason, and the line below
     * already drops what it refuses. A second check here read well and meant that neither copy could
     * be shown to do anything: break one and the other carried on. One rule, in one place. */
    /* CLOTH ONLY. A line that leaves here already cut is thirty pieces, not the 48 metres they came
     * off — putting it in this total as well would be the same cloth counted twice, and a printer
     * could then ask for both. Those lines are counted in pieces by rfdPieceLines instead. */
    if (rfdIssueAs(o, l) === 'cut') return;
    const n = rfdLineNeed(o, l);
    if (n.fabric && n.metres > 0) byFab.set(n.fabric, (byFab.get(n.fabric) || 0) + n.metres);
    else if (n.how !== 'cancelled') unknown.push(n.how);
  });
  return { byFab, unknown };
}
const rfdRound = m => Math.round((parseFloat(m) || 0) * 10) / 10;
/**
 * The unit a requirement is in, and the quantity that matters in it.
 *
 * Everything downstream — the ceiling, what has been sent, whether it is finished — asks these two
 * rather than reaching for metres. A piece requirement's metres are an estimate of the cloth it will
 * take to cut; they are never what was asked for and never what goes out.
 */
const rfdUnit = r => (r && r.unit === 'pcs') ? 'pcs' : 'm';
const rfdWant = r => rfdRound(rfdUnit(r) === 'pcs' ? (r && r.pieces) : (r && r.metres));
/** "30 pcs" or "62.4 m" — said the way it was asked, wherever it is shown. */
const rfdQtyTxt = r => nf(rfdWant(r)) + ' ' + rfdUnit(r);
/** Every fabric an order needs, most cloth first — the list a printer picks from. */
const rfdFabrics = o => [...rfdOrderNeed(o).byFab].sort((a, b) => b[1] - a[1])
  .map(([fabric, metres]) => ({ fabric, metres: rfdRound(metres) }));

/**
 * The CUT lines of an order gathered by SKU — the sizes a printer actually thinks in.
 *
 * One entry per SKU, not per line: an order that names 60X60 twice is 49 pieces of one thing to the
 * person printing it, and two rows would give it two separate ceilings that each look generous.
 *
 * Only SKUs whose cloth can be worked out. A size we cannot turn into metres cannot be asked for in
 * pieces either, and offering it would produce a requirement worth nothing that somebody has to
 * chase down later.
 */
/* Kept for the draw (2026-09-26): every size, every order walk asked for this again, and each line asked the print rule. */
function rfdPieceLines(o) {
  return o ? rfdMemoOf('pieces', o, '', () => rfdPieceLinesBuild(o)) : rfdPieceLinesBuild(o);
}
function rfdPieceLinesBuild(o) {
  const by = new Map();
  voLines(o || {}).forEach(l => {
    if (!l) return;
    /* A RUNNING LINE IS NOT A SIZE, even when it carries a SKU — and 20 of the 80 running lines on
     * record do. Its quantity is metres of cloth, not pieces of anything, so letting one through
     * here would offer it as a size and divide metres by metres to get "what one piece takes". */
    if (voKind(l) === 'running' || (o && o.orderType === 'running')) return;
    /* ONLY WHAT LEAVES HERE ALREADY CUT. A Pillow Cover on a cut order is still handed over as
     * running cloth — the printer cuts it — so it belongs in the fabric table, not in this one. */
    if (rfdIssueAs(o, l) !== 'cut') return;
    /* THE CANCELLED CHECK IS BACK, AND NOW IT IS THE ONLY ONE. It used to be redundant because this
     * list would only take a line whose cloth could be worked out, and rfdLineNeed refuses a cancelled
     * line by giving it no cloth. A size can be asked for in pieces without its cloth being known, so
     * that gate is gone — and with it went the only thing keeping cancelled lines out. A struck-off
     * line of 100 pieces was being offered as a size to ask for. */
    if (l.cancelled) return;
    const sku = String(l.sku || '').trim();
    if (!sku) return;
    const pieces = parseFloat(l.qty) || 0;
    if (!(pieces > 0)) return;
    /* The cloth behind the pieces, where it can be worked out. It is NOT what is asked for or sent —
     * that is the pieces — but the store still has to cut them out of something, so it is carried
     * along and shown. A size we cannot price in cloth is still a size that can be asked for. */
    const n = rfdLineNeed(o, l);
    const k = obUC(sku);
    if (!by.has(k)) by.set(k, { sku, size: String(l.size || '').trim(), colour: String(l.color || '').trim(),
      what: String(l.articleSubtype || l.articleType || '').trim(), fabric: n.fabric || '',
      ruled: rfdIssueRuled(o, l), pieces: 0, metres: 0 });
    const e = by.get(k);
    e.pieces += pieces;
    e.metres += n.metres || 0;
    if (!e.fabric && n.fabric) e.fabric = n.fabric;
    if (!rfdIssueRuled(o, l)) e.ruled = false;
  });
  /* Metres per piece, read back off the two totals rather than off the master row again — so the
   * figure a printer is shown is arithmetically the one their ask will be converted with. */
  return [...by.values()].map(e => Object.assign(e, {
    metres: rfdRound(e.metres), per: e.pieces ? e.metres / e.pieces : 0 }))
    .sort((a, b) => b.pieces - a.pieces);
}
const rfdPieceOf = (o, sku) => rfdPieceLines(o).find(x => obUC(x.sku) === obUC(sku)) || null;

/* ================= A SIZE, NOT A SIZE PER COLOUR =================
 *
 * A printer asks for blank cloth cut to a size; the colour is what they are about to print on it.
 * Listing 60X60 Square Tablecloth once per colour asked somebody to do thirteen sums to answer one
 * question. These collapse the order to one row per size. The stored request is still per SKU.
 */
const rfdSizeKey = x => [String((x && x.what) || ''), String((x && x.size) || '')]
  .map(v => v.trim().toLowerCase()).join(' | ');
/** The same group as a key a database will take: no dots, slashes, brackets or hashes. */
const rfdKeySafe = v => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'X';
/* P__ for a size in pieces, M__ for a cloth in metres. Apart, so a fabric named like a size cannot
 * land on the same row, and so the unit is readable in the key. */
const rfdStockKey = x => 'P__' + rfdKeySafe(rfdSizeKey(x));
const rfdFabKey = f => 'M__' + rfdKeySafe(f);
const rfdKeyUnit = k => (String(k || '').indexOf('M__') === 0 ? 'm' : 'pcs');

/**
 * The order's pieces by size — BEFORE the declared pile is counted.
 *
 * The pile is allocated across orders by looking at what each one still needs, which is worked out
 * from here, so this one has to be answerable without it.
 */
/* ---- the draw-long memo (2026-09-26) ---- */
let RFD_MEMO = null;
function rfdMemo() {
  const sig = [RFD, RFD && RFD.stock, RFD && RFD.decisions, VO && VO.rows, VP && VP.rows, VP && VP.code];
  if (RFD_MEMO && RFD_MEMO.sig.every((x, i) => x === sig[i])) return RFD_MEMO.m;
  RFD_MEMO = { sig, m: new Map() };
  const mine = RFD_MEMO;
  Promise.resolve().then(() => { if (RFD_MEMO === mine) RFD_MEMO = null; });
  return RFD_MEMO.m;
}
/** Remember f's answer for this key until the draw is over. Keyed by the order object and its requests' identity. */
function rfdMemoOf(kind, o, key, f) {
  const m = rfdMemo();
  let per = m.get(o);
  if (!per || per.reqs !== (o && o.rfdReqs)) { per = { reqs: o && o.rfdReqs, v: new Map() }; m.set(o, per); }
  const k = kind + '|' + (key || '');
  if (!per.v.has(k)) per.v.set(k, f());
  return per.v.get(k);
}

function rfdSizeRaw(o) {
  return rfdMemoOf('raw', o, '', () => rfdSizeRawBuild(o));
}
function rfdSizeRawBuild(o) {
  const by = new Map();
  rfdPieceLines(o).forEach(x => {
    const k = rfdSizeKey(x);
    if (!by.has(k)) by.set(k, { key: k, stockKey: rfdStockKey(x), what: x.what, size: x.size,
      skus: [], pieces: 0, fabrics: [], colours: [], ruled: true });
    const g = by.get(k);
    g.skus.push(x); g.pieces += x.pieces;
    if (!x.ruled) g.ruled = false;
    if (x.fabric && g.fabrics.indexOf(x.fabric) < 0) g.fabrics.push(x.fabric);
    if (x.colour && g.colours.indexOf(x.colour) < 0) g.colours.push(x.colour);
  });
  return [...by.values()].map(g => Object.assign(g, {
    pieces: rfdRound(g.pieces),
    used: rfdRound(g.skus.reduce((a, x) => a + rfdUsedPcs(o, x.sku), 0)),
    sent: rfdRound(g.skus.reduce((a, x) => a + rfdSentPcsFor(o, x.sku), 0)),
  })).sort((a, b) => b.pieces - a.pieces);
}

/** The order's sizes with the pile counted in — what the screen shows. */
function rfdSizeGroups(o) {
  return rfdMemoOf('groups', o, '', () => rfdSizeRaw(o).map(g => Object.assign({}, g)).map(g => {
    const stock = rfdStockHere(o, g.stockKey);
    return Object.assign(g, { stock, pool: rfdStockOf(rfdVendorOf(o), g.stockKey, o),
      own: rfdStockOwn(o, g.stockKey) > 0,
      left: rfdRound(Math.max(0, g.pieces - g.used - stock)) });
  }));
}
const rfdSizeOf = (o, key) => rfdSizeGroups(o).find(g => g.key === key || g.stockKey === key) || null;

const rfdVendorOf = o => obUC((o && o.vendorCode) || VP.code || '');
/** One count as a number. Half a tablecloth is not a thing; half a metre of cloth is. */
const rfdStockNum = (r, stockKey) => {
  const n = r ? parseFloat(r.pcs) : 0;
  if (!(isFinite(n) && n > 0)) return 0;
  return rfdKeyUnit(stockKey) === 'm' ? rfdRound(n) : Math.round(n);
};
/**
 * Every count a printer has given for one size or cloth, with the order it belongs to.
 *
 * Saved today and after: key <stockKey>@<orderId>. Saved before: key <stockKey>, with an orderId on
 * the row once it has been tagged, and none — shared, the old way — until then.
 */
const rfdStockEnts = (code, stockKey) => Object.entries((RFD.stock || {})[obUC(code)] || {})
  .filter(([k, r]) => r && typeof r === 'object' && (k === stockKey || k.indexOf(stockKey + '@') === 0))
  .map(([k, r]) => ({ k, r, oid: String(r.orderId || (k.indexOf('@') > 0 ? k.slice(k.indexOf('@') + 1) : '')) }));
const rfdStockOwn = (o, stockKey) => (!o ? 0 : rfdStockEnts(rfdVendorOf(o), stockKey)
  .filter(e => e.oid === o.id).reduce((a, e) => a + rfdStockNum(e.r, stockKey), 0));
const rfdStockShared = (code, stockKey) => rfdStockEnts(code, stockKey)
  .filter(e => !e.oid).reduce((a, e) => a + rfdStockNum(e.r, stockKey), 0);
/**
 * What the printer has said is with them. Given an order: that order's own count, or — if it has
 * none — the old shared one. Given none: everything they have said about it.
 */
const rfdStockOf = (code, stockKey, o) => {
  if (o) {
    const mine = rfdStockEnts(code, stockKey).filter(e => e.oid === o.id);
    if (mine.length) return mine.reduce((a, e) => a + rfdStockNum(e.r, stockKey), 0);
    return rfdStockShared(code, stockKey);
  }
  return rfdStockEnts(code, stockKey).reduce((a, e) => a + rfdStockNum(e.r, stockKey), 0);
};
const rfdStockRow = (code, stockKey, o) => {
  const ents = rfdStockEnts(code, stockKey);
  const e = (o && ents.find(x => x.oid === o.id)) || ents.find(x => !x.oid);
  return e ? e.r : null;
};

/** The orders of one printer that can be asked against, oldest first — the order the pile is shared in. */
const rfdStockOrders = code => {
  const src = (VP.code && obUC(VP.code) === obUC(code) && VP.rows)
    ? VP.rows : (VO.rows || []).filter(o => o && obUC(o.vendorCode) === obUC(code));
  return (src || []).filter(o => o && ['Received', 'Cancelled'].indexOf(o.status || 'Placed') < 0)
    .slice().sort((a, b) => String(a.orderNo || a.id).localeCompare(String(b.orderNo || b.id)));
};

/**
 * HOW MUCH OF THE PILE THIS ORDER MAY COUNT.
 *
 * 39 size groups sit on two or three open orders of the same printer. One declaration counted
 * against each of them would be the same cloth counted three times, and the factory would stop
 * sending against requirements that are not in fact met. So the orders take from it oldest first,
 * each up to what it still needs, and what is left over goes to the next one.
 */
/** What one order still needs of a size or of a cloth — the share of a pile it can take. */
function rfdRoomFor(o, stockKey) {
  return rfdMemoOf('room', o, stockKey, () => rfdRoomForBuild(o, stockKey));
}
function rfdRoomForBuild(o, stockKey) {
  const g = rfdSizeRaw(o).find(y => y.stockKey === stockKey);
  if (g) return Math.max(0, g.pieces - g.used);
  const f = rfdFabrics(o).find(x => rfdFabKey(x.fabric) === stockKey);
  if (!f) return 0;
  return Math.max(0, f.metres - rfdUsedM(o, f.fabric));
}

function rfdStockHere(o, stockKey) {
  if (!o) return 0;
  return rfdMemoOf('here', o, stockKey, () => rfdStockHereBuild(o, stockKey));
}
function rfdStockHereBuild(o, stockKey) {
  const code = rfdVendorOf(o);
  /* THIS ORDER'S OWN COUNT FIRST, up to what it still needs. */
  const ownTake = x => Math.min(rfdStockOwn(x, stockKey), rfdRoomFor(x, stockKey));
  let mine = ownTake(o);
  /* THEN ANYTHING STILL SHARED THE OLD WAY, oldest order first, into the room each has left. */
  let pool = rfdStockShared(code, stockKey);
  if (pool > 0) {
    rfdStockOrders(code).forEach(x => {
      if (pool <= 0) return;
      const take = Math.min(pool, Math.max(0, rfdRoomFor(x, stockKey) - ownTake(x)));
      pool -= take;
      if (x.id === o.id) mine += take;
    });
  }
  return rfdRound(mine);
}

/**
 * SPLIT A WHOLE NUMBER ACROSS PARTS AND LOSE NOTHING TO ROUNDING.
 *
 * Every part gets its share of the total in proportion to how much room it has, and the pieces that
 * the fractions leave over go to the largest remainders first. The result always adds up to the
 * total — or to the room available, when that is smaller — because half a tablecloth is not
 * something anybody can cut, and thirteen roundings that each lose a piece lose thirteen pieces.
 */
function rfdSpread(total, weights) {
  const t = Math.max(0, Math.round(parseFloat(total) || 0));
  let w = (weights || []).map(x => Math.max(0, parseFloat(x) || 0));
  const out = w.map(() => 0);
  if (!t || !w.length) return out;
  /* NOTHING LEFT ANYWHERE AND STILL ASKING. Asking beyond what the order covers is allowed — it goes
   * to the office to approve — so dividing by a total of nothing must share the extra out, not throw
   * it away. */
  let sum = w.reduce((a, b) => a + b, 0);
  if (!sum) { w = w.map(() => 1); sum = w.length; }
  const exact = w.map(x => (x / sum) * t);
  exact.forEach((v, i) => { out[i] = Math.floor(v); });
  let left = t - out.reduce((a, b) => a + b, 0);
  /* The pieces the fractions leave over go to the largest remainders first, so the result adds up to
   * exactly what was asked for. Thirteen colours each rounded down lose thirteen pieces. */
  w.map((x, i) => ({ i, rem: exact[i] - Math.floor(exact[i]) }))
    .sort((a, b) => b.rem - a.rem || w[b.i] - w[a.i] || a.i - b.i)
    .forEach(x => { if (left > 0) { out[x.i]++; left--; } });
  return out;
}

/** One SKU's share of its size's pile, spread across the colours by what each still needs. */
function rfdStockForSku(o, sku) {
  const line = rfdPieceOf(o, sku);
  if (!line) return 0;
  const key = rfdStockKey(line);
  const here = rfdStockHere(o, key);
  if (!(here > 0)) return 0;
  const g = rfdSizeRaw(o).find(x => x.stockKey === key);
  if (!g) return 0;
  const i = g.skus.findIndex(x => obUC(x.sku) === obUC(sku));
  if (i < 0) return 0;
  return rfdSpread(here, g.skus.map(x => Math.max(0, x.pieces - rfdUsedPcs(o, x.sku))))[i];
}

/**
 * Ask for a whole size at once, spread across its colours.
 *
 * The REQUEST is still one per SKU, with its own colour and its own fabric, because that is what the
 * office approves, sends and counts against. Only the typing is by size.
 */
