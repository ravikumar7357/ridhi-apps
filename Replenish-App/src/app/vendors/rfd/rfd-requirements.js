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

