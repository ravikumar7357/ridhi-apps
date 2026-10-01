/* ================= WHAT EACH PRINTER CHARGES =================
 *
 * One rate per printer and per thing they do. Running work is priced by the metre and varies by
 * fabric and print direction; cut work is priced by the piece and varies by article, subtype and
 * size. That is not a guess — it is the shape the live vendor orders take.
 *
 * Objects, not positional rows. The employee rate list next door is an array of arrays because the
 * old tool wrote it that way; this node is new, and two different shapes packed into one array by
 * position is unreadable six months on.
 */
/* ---- the vendor rates, a row at a time ----
 *
 * One path per rate, so that the database can tell a proposal from an approval — it judges a write by
 * its path, and while the list was written whole they were the same write. It also means two people
 * editing different rates no longer collide: only the rows that changed are sent.
 */
/** The rows as the database last held them, by key — what a save is compared against. */
let PR_SNAP = {};
const prBare = r => { const o = Object.assign({}, r); delete o._key; return o; };
function prSnapTake(rows) {
  PR_SNAP = {};
  (rows || []).forEach(r => { if (r && r._key != null) PR_SNAP[r._key] = hrCanon(prBare(r)); });
}
/**
 * The list out of whatever shape the node is in. It was an array for as long as it was written whole,
 * and an array's rows are already addressable — row 5 is pt_printerRates/5 — so nothing has to be
 * migrated: each keeps its index as its key, and new rows get a name of their own beside them.
 */
function prRowsOf(raw) {
  const rows = Array.isArray(raw)
    ? raw.map((v, i) => (v && typeof v === 'object' ? Object.assign({ _key: String(i) }, v) : null))
    : ptList(raw);
  return rows.filter(x => x && x.vendor);
}
const prNewKey = i => 'pr_' + Date.now().toString(36) + '_' + String(i).padStart(3, '0') + '_' + Math.random().toString(36).slice(2, 7);

async function hrSavePrRate() {
  const rows = HR.prate || [];
  /* A row with no key is new. The index is in the name because an upload makes a hundred of these in
   * one millisecond. */
  rows.forEach((r, i) => { if (r._key == null) r._key = prNewKey(i); });
  const now = {}, patch = {};
  rows.forEach(r => { now[r._key] = hrCanon(prBare(r));
    if (PR_SNAP[r._key] !== now[r._key]) patch['pt_printerRates/' + r._key] = prBare(r); });
  Object.keys(PR_SNAP).forEach(k => { if (!(k in now)) patch['pt_printerRates/' + k] = null; });
  if (!Object.keys(patch).length) return;

  /* ONLY THE ROWS BEING TOUCHED have to be what this page last saw. Somebody else's change to a
   * different rate is none of this save's business — which is the difference from the whole-list
   * guard, where any change anywhere refused everybody. */
  const stored = await ptGet('pt_printerRates');
  const storedOf = k => { const v = stored == null ? undefined : stored[k]; return v == null ? undefined : hrCanon(v); };
  const clash = Object.keys(patch).map(p => p.slice('pt_printerRates/'.length)).filter(k => storedOf(k) !== PR_SNAP[k]);
  if (clash.length) {
    HR.emp = null;
    try { await ensureHr(); } catch (e) { /* the reload reports itself through HR.err */ }
    renderHr();
    throw new Error('Somebody else changed ' + (clash.length === 1 ? 'that rate' : 'those rates')
      + ' while you had the list open, so nothing was saved — saving yours would have undone theirs. '
      + 'The list has been reloaded from the database. Check it, then make your change again.');
  }
  await ptPatch(patch);
  PR_SNAP = now;
}

/**
 * The services this factory buys, and what each is priced on.
 *
 * A service belongs to the WORK, not to the firm — the fabricator cuts and also stitches, two prices
 * from one vendor. `by` is the unit; `fill` says whether the filler and its weight are part of what
 * makes the rate unique.
 */
const PR_SERVICES = [
  /* PRINTING IS BOUGHT BOTH WAYS and the live orders prove it: running Voil 92 by the metre from
   * VND001, cut tablecloths by the piece from VND002 — both block printing. */
  { key: 'Block print', kinds: ['running', 'cut'] },
  { key: 'Digital print', kinds: ['running', 'cut'] },
  { key: 'Screen print', kinds: ['running', 'cut'] },
  { key: 'Marble print', kinds: ['running', 'cut'] },
  { key: 'Embroidery', kinds: ['cut'] },
  { key: 'Cutting', kinds: ['cut'] },
  { key: 'Stitching', kinds: ['cut'] },
  { key: 'Filling', kinds: ['cut'], fill: true },
];
const prSvc = k => PR_SERVICES.find(s => hrN(s.key) === hrN(k)) || null;

/* ---- proposed, approved, refused ----
 *
 * A rate is what the factory PAYS. Proposing one is open to anyone who can reach this screen;
 * approving one is granted (perms.rateApprove, and an admin always has it). Only an approved rate
 * prices an order line.
 *
 * A ROW WITH NO STATUS IS APPROVED. The rates already in the list are pricing live orders today, and
 * treating them as unapproved would silently un-price the whole book until somebody clicked through
 * every one of them.
 */
const prCanApprove = () => !!(ME.admin || ME.rateApprove);
const PR_STATUSES = ['Approved', 'Pending', 'Refused'];
const prStatus = r => {
  const s = String((r && r.status) || '').trim().toLowerCase();
  return s === 'pending' ? 'Pending' : (s === 'refused' || s === 'rejected' ? 'Refused' : 'Approved');
};
const prApproved = r => prStatus(r) === 'Approved';
/* The stamp a rate carries when it is written. An approver's own rate is approved as it is saved —
 * making them approve it a second time is a click that decides nothing. */
const prStamp = () => (prCanApprove()
  ? { status: 'Approved', approvedBy: ME.email, approvedAt: new Date().toISOString() }
  : { status: 'Pending', approvedBy: '', approvedAt: '' });

/**
 * The vendor KINDS that mean exactly one kind of WORK.
 *
 * The two lists overlap by half — Embroidery and Filling are spelled the same in both — so writing a
 * firm's kind in the Work column works until it is "Printer" or "Fabricator", and then the file is
 * refused for no reason a person can see. What a printer does is print, so the kind is read as the
 * work. The spellings the old rate cards used are here too.
 */
const PR_SVC_ALIAS = {
  'printer': 'Block print', 'block printer': 'Block print', 'hand block printer': 'Block print',
  'block printing': 'Block print', 'printing': 'Block print',
  'digital printer': 'Digital print', 'digital printing': 'Digital print',
  'screen printer': 'Screen print', 'screen printing': 'Screen print',
  'marble printer': 'Marble print', 'marble printing': 'Marble print',
};
/**
 * And the kinds that mean more than one, with what they could mean.
 *
 * A FABRICATOR BOTH CUTS AND STITCHES, at two different rates. Guessing one would file a stitching
 * price under cutting, where nobody would ever look for it — so the row is refused and told which
 * two words it is choosing between.
 */
const PR_SVC_AMBIGUOUS = { 'fabricator': ['Cutting', 'Stitching'], 'fabrication': ['Cutting', 'Stitching'] };
/* KINDS THAT ARE NOT JOB WORK AT ALL. A mill sells greige and a processor turns it into RFD; neither is
 * paid off the rate list, so neither has a job to name. */
const PR_NOT_JOBWORK = ['mill', 'processor'];
/** What a typed word means, '' when nothing. The real name first, then a kind that means one job. */
const prSvcKey = t => { const s = prSvc(t); return s ? s.key : (PR_SVC_ALIAS[hrN(t)] || ''); };
/**
 * Metres or pieces. The row's own field where the service allows both, and the service's only unit
 * where it has one — nobody should be asked a question with a single possible answer.
 */
function prIsRunning(r) {
  const s = prSvc(r && r.service);
  if (s && s.kinds.length === 1) return s.kinds[0] === 'running';
  return String(r && r.kind) === 'running';
}
/** Only filling work has a filler and a weight — nothing else is priced on what is inside it. */
const prIsFill = r => { const s = prSvc(r && r.service); return !!(s && s.fill); };
/**
 * Is this work printing? Only printing is priced by how many colours are in the design — every colour
 * is another block, another pass. Block, digital, screen and marble printing all are; filling,
 * cutting and stitching are not.
 */
const prIsPrinting = svc => /print$/i.test(String((prSvc(svc) || {}).key || svc || '').trim());

/**
 * SPELLINGS THAT ARE ONE WORD.
 *
 * Not a stemmer and not a guess: both halves of each pair are in Ravi's own data for the same cloth,
 * the rate list saying one and the master database the other. Kept as a named list so that adding a
 * pair is a decision somebody makes on purpose, in one visible place.
 */
const PR_SPELL = [['rectangular', 'rectangle']];

/** Lower case, one space, no quote marks, one kind of times sign. */
function prNorm(v) {
  return hrN(v).replace(new RegExp(String.fromCharCode(0x2033) + '|"|' + String.fromCharCode(0x2032) + "|'", 'g'), '')
    .replace(/\binch(es)?\b/g, '')
    .replace(new RegExp(String.fromCharCode(0x00D7) + '|\\*', 'g'), 'x')
    .replace(/\s+/g, ' ').trim();
}

/** An article, subtype or filler name, with the spellings above folded together. */
function prNameKey(v) {
  let t = prNorm(v);
  PR_SPELL.forEach(([a, b]) => { t = t.split(a).join(b); });
  return t;
}

/**
 * A SIZE IS THE SAME SIZE WRITTEN EITHER WAY ROUND.
 *
 * 90x60 on the rate and 60X90 on the order line are one rectangular cloth. Sixteen of Ravi's rates
 * matched nothing for this reason alone. The two numbers are put in order so that neither way of
 * writing it is the right one.
 *
 * AND A ROUND CLOTH SAYS IT TWICE. The rate list writes "90 Round" where the order book writes "90",
 * and the subtype has already said Round Tablecloth on both — so the word is dropped from the size.
 * Two sizes can only meet here when their subtypes agree, and two round tablecloths of 90 inches are
 * one cloth. A misspelling is not folded: "72 Roundd" still matches nothing, which is the truth
 * about it until somebody corrects the row.
 */
function prSizeKey(v) {
  const t = prNorm(v).replace(/\s*\b(round|rd)$/, '').trim();
  const p = t.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/);
  if (p) return [parseFloat(p[1]), parseFloat(p[2])].sort((a, b) => a - b).join('x');
  return t;
}

/**
 * WHAT WORK AN ORDER LINE IS, read from the firm it was placed with.
 *
 * A printing rate is not the only kind of rate an order line reaches — that was a comment of mine,
 * and the order book disproves it: fifteen live quilt lines sit with a filling firm. A firm whose
 * kind means one job answers with that job; a fabricator both cuts and stitches, so it answers with
 * both; a firm with no kind written down gates nothing, because a gate that cannot see its data and
 * answers no is the same mistake in the other direction.
 */
function prLineServices(vendorCode, o) {
  /* THE ORDER ITSELF SAYS, when it was raised with the form that asks. Older orders carry nothing
   * and are read from the firm's kind, as before. */
  if (o && o.service && prSvc(o.service)) return [prSvc(o.service).key];
  const cat = voCatOf(vendorCode);
  const amb = PR_SVC_AMBIGUOUS[hrN(cat)];
  if (amb) return amb.slice();
  const one = prSvcKey(cat);
  return one ? [one] : PR_SERVICES.map(x => x.key);
}

/** Is this order filling work? The order's own word first, the firm's kind where it has none. */
const voIsFilling = o => !!o && prLineServices(o.vendorCode, o).some(k => { const x = prSvc(k); return !!(x && x.fill); })
  && prLineServices(o.vendorCode, o).length === 1;

/** The filler an order line is to be stuffed with — the line's own word, else the order's. */
const prLineFiller = (o, l) => String((l && l.filler) || (o && o.filler) || '').trim();

/** What one order line asks for, in the shape a rate is written in. */
function prLineWant(vendorCode, o, l) {
  const run = voRunning(o) || l.kind === 'running';
  const m = run ? null : mdbOf(l.sku);
  return run
    ? { vendor: vendorCode, kind: 'running', fabric: l.fabricType || '', print: l.printDirection || '' }
    : { vendor: vendorCode, kind: 'cut',
        articleType: l.articleType || (m && m.articleType) || '',
        subtype: l.articleSubtype || (m && m.subtype) || '',
        size: l.size || (m && m.size) || '' };
}

/**
 * Would this rate be reached by this line? Colours are deliberately not asked here: a rate for five
 * or more colours still prices this cloth when the design has five, and which of several colour
 * bands wins is prRateFor's question, not this one.
 */
function prLineMatches(r, o, l, vendorCode) {
  if (!r || !o || !l) return false;
  const code = vendorCode == null ? o.vendorCode : vendorCode;
  if (String(code) !== String(r.vendor)) return false;
  if (!prLineServices(code, o).some(k => hrN(k) === hrN(r.service))) return false;
  /* A FILLING RATE IS FOR ONE FILLER. Where the order says which, a rate for the other is not this
   * rate. Where it says nothing, both still match here — and prRateRowFor refuses to choose. */
  if (prIsFill(r)) {
    const f = prLineFiller(o, l);
    if (f && prNameKey(f) !== prNameKey(r.filler)) return false;
  }
  const want = prLineWant(code, o, l);
  if (want.kind !== (prIsRunning(r) ? 'running' : 'cut')) return false;
  return want.kind === 'running'
    ? prNameKey(want.fabric) === prNameKey(r.fabric) && prNameKey(want.print) === prNameKey(r.print)
    : prNameKey(want.articleType) === prNameKey(r.articleType)
      && prNameKey(want.subtype) === prNameKey(r.subtype)
      && prSizeKey(want.size) === prSizeKey(r.size);
}

/** What one rate is FOR, in words — the same string on the row and in the duplicate check. */
function prWhat(r) {
  const what = prIsRunning(r)
    ? [r.fabric, r.print].filter(Boolean).join(' · ')
    : [r.articleType, r.subtype, r.size].filter(Boolean).join(' · ');
  /* The filler and the weight are what tell two otherwise identical quilt rates apart, so they are
   * part of what the rate is called, not a note beside it. The colour count does the same job for
   * printing: 60X60 in two colours and 60X60 in three are two rates, not one written twice. */
  if (prIsFill(r)) return [what, r.filler, (r.weight ? r.weight + ' kg' : '')].filter(Boolean).join(' · ');
  const c = prCols(r);
  return c ? what + ' · ' + c + ' colour' + (c === '1' ? '' : 's') : what;
}
const prUnit = r => (prIsRunning(r) ? 'per m' : 'per pc');
/** Two rates are the same rate when they would be reached by the same line. */
/**
 * The colour range a printing rate is for, read from however somebody wrote it.
 *
 * "1 to 4", "1-4", "5 or more", "5+", "3", blank — all of them are said out loud by the people who
 * agree these rates, and all of them arrive in the column. Blank is "any number", which is what every
 * rate said before colour-wise pricing existed.
 */
function prColSpec(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  /* "5 or more", "5+", "5 and above", "5 up" — open at the top. */
  if (/^(\d+)\s*(\+|or more|or above|and above|and more|up|onwards|\u2013|-)?\s*(more|above)?$/.test(s)
      && /(\+|more|above|up|onwards)/.test(s)) {
    const n = parseInt(s, 10);
    return isFinite(n) && n > 0 ? { from: n, to: Infinity } : null;
  }
  /* "1 to 4", "1-4", "1 \u2013 4", "1 4". */
  const m = s.match(/^(\d+)\s*(?:to|-|\u2013|\u2014|\s)\s*(\d+)$/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (a > 0 && b >= a) return { from: a, to: b };
    return null;
  }
  const one = s.match(/^(\d+)$/);
  if (one) { const n = parseInt(one[1], 10); return n > 0 ? { from: n, to: n } : null; }
  return null;
}

/**
 * A Colours value that is not a count or a range — "Gadd", "With fabric", whatever the trade calls
 * it. Kept verbatim so it reads back the way it was written, and normalised for comparing.
 *
 * It is not a colour count and is never treated as one. It is here because two rates for the same
 * cloth have to be told apart somehow, and this is the column Ravi has been writing it in.
 */
/** The words that mean "any number of colours" — the same thing as leaving the column blank. */
const PR_COL_ANY = ['all', 'any', 'all colours', 'all colors', 'any colours', 'any colors', 'na', 'n/a', '-'];
const prColLabel = v => {
  const t = String(v == null ? '' : v).trim();
  /* "ALL" IS NOT A LABEL. It has no digit, so it read as one — the "Gadd" mechanism, a rate told
   * apart by a word — and a labelled rate is recorded, never matched. Fifty-one of Ravi's rates say
   * "All", meaning what a blank means, and every one of them priced nothing. */
  if (PR_COL_ANY.indexOf(t.toLowerCase()) >= 0) return '';
  /* A LABEL HAS NO DIGITS IN IT. Anything with a number is somebody writing a count — "3 colors",
   * "1 to 4 colours", a range, or a plain 0 — and a count that cannot be read must be refused rather
   * than quietly turned into the name of a rate that prices nothing. Every count and range prColSpec
   * knows has a digit in it, so this one test answers them all. */
  return (!t || /\d/.test(t)) ? '' : t;
};
/** Is this rate distinguished by a label rather than by a colour count? */
const prColIsLabel = r => !!prColLabel(r && r.colours);

/** The range written the one way, so the same rule never appears twice spelled differently. */
const prCols = r => {
  const sp = prColSpec(r && r.colours);
  /* A LABEL IS PART OF WHAT THE RATE IS. Without it "Sheeting 72" and "Sheeting 72 Gadd" are one
   * rate, and the second is refused as a repetition of the first. */
  if (!sp) return hrN(prColLabel(r && r.colours));
  if (sp.to === Infinity) return sp.from + '+';
  return sp.from === sp.to ? String(sp.from) : sp.from + '-' + sp.to;
};
/** Does this rate's range cover a design of n colours? A rate with no range covers everything. */
function prColCovers(r, n) {
  /* A LABELLED RATE COVERS NOTHING BY COUNT. "Gadd" is not "any number of colours" — an order line
   * has no way to ask for it, so letting it answer here would price ordinary work at the Gadd rate. */
  if (prColIsLabel(r)) return false;
  const sp = prColSpec(r && r.colours);
  if (!sp) return true;
  const k = parseInt(n, 10);
  if (!isFinite(k) || k <= 0) return false;      // a range was set; a line that says nothing is not it
  return k >= sp.from && k <= sp.to;
}
/** How wide a range is — the narrowest one wins, because whoever wrote it meant it. */
function prColWidth(r) {
  const sp = prColSpec(r && r.colours);
  if (!sp) return Infinity;
  return sp.to === Infinity ? 1e6 : (sp.to - sp.from + 1);
}
/** Two ranges that both answer the same design are a clash, not two rates. */
function prColOverlap(a, b) {
  /* TWO DIFFERENT LABELS ARE TWO DIFFERENT RATES, not a clash — that is the whole point of writing
   * one. The same label twice IS a clash, and so is a label against a plain rate: both would answer
   * for the same work with nothing to tell them apart. */
  const la = prColLabel(a && a.colours), lb = prColLabel(b && b.colours);
  if (la || lb) return hrN(la) === hrN(lb);
  const x = prColSpec(a && a.colours), y = prColSpec(b && b.colours);
  if (!x || !y) return true;                     // "any" overlaps everything, including itself
  return x.from <= y.to && y.from <= x.to;
}

/* The same reading as prLineMatches, so that two rates which would be reached by the same line are
 * one rate here too: Rectangle 90x60 and Rectangular 60X90 are not two prices to choose between. */
const prKey = r => [r.vendor, hrN(r.service), prIsRunning(r) ? 'running' : 'piece',
  prNameKey(r.fabric), prNameKey(r.print), prNameKey(r.articleType), prNameKey(r.subtype),
  prSizeKey(r.size), prNameKey(r.filler), hrN(r.weight), prCols(r)].join('|');

/**
 * The rate that applies to one order line — exact match only, and the ROW, not just the number.
 *
 * No fallback ladder here, unlike the employee rates. Those fall back to subtype because the old tool
 * did and its figures depend on it; a printer's price for a 60X60 is not a safe stand-in for a
 * 70X108, and a wrong rate on a purchase order is money.
 *
 * The row rather than the figure, because a payout has to be able to say which rate it used: "Rs.31"
 * on a bill is not something anybody can check, and "Rs.31, block print, 1-4 colours, approved by
 * so-and-so" is.
 */
function prRateRowFor(vendorCode, o, l) {
  const run = voRunning(o) || l.kind === 'running';
  const m = run ? null : mdbOf(l.sku);
  /* WHAT WORK THIS LINE IS is read from the firm it was placed with rather than assumed — it used to
   * be assumed to be block printing, and the filling firm's fifteen live quilt lines were priced at
   * nothing because of it. prLineMatches below asks that question, and the column on the rate screen
   * asks it through the same function, so what is counted and what is paid cannot drift apart. */
  /* HOW MANY COLOURS ARE IN THIS DESIGN. From the line if it says, from the master row if that does.
   * A rate set for that many colours wins; a rate that names no colour count answers for any number,
   * which is what every rate written before colour-wise pricing does. */
  /* The design's own colour count — a number, not a range: a cloth is printed in three colours, it is
   * not printed in "one to four". */
  const colsRaw = (l && l.colours) != null && l.colours !== '' ? l.colours : (m && m.printColours);
  const colsN = parseInt(colsRaw, 10);
  const cols = isFinite(colsN) && colsN > 0 ? colsN : 0;
  /* ONLY AN APPROVED RATE PRICES A LINE. This is the whole substance of the approval — without it,
   * approving would be a badge on a screen and a proposed rate would be paying vendors. */
  /* Everything that matches but for the colours, then the narrowest range that covers this design.
   * A rate with no range covers any number, so it is the fallback without being a special case. */
  const cand = (HR.prate || [])
    .filter(r => prApproved(r) && prLineMatches(r, o, l, vendorCode))
    /* A labelled rate is recorded, not matched: nothing on an order line says "Gadd", so picking one
     * here would be guessing with somebody's money. */
    .filter(r => !prColIsLabel(r));
  let hits = cand.filter(r => (cols ? prColCovers(r, cols) : !prColSpec(r.colours)))
    .sort((a, b) => prColWidth(a) - prColWidth(b));
  /* NO COLOUR COUNT, BUT EVERY BAND SAYS THE SAME PRICE — then there is nothing to choose, and the
   * missing number cannot change the answer. One printer's whole card is written that way, and not
   * one tablecloth in the master carries a count. Where the bands DISAGREE this does not apply: that
   * is a real choice, and it is refused below for want of the number that would make it. */
  if (!hits.length && !cols && cand.length
      && new Set(cand.map(r => String(parseFloat(r.rate) || 0))).size === 1
      && new Set(cand.map(r => prNameKey(r.filler))).size === 1)
    hits = [Object.assign({}, cand[0], { colours: '', anyBand: true })];
  /* TWO FILLERS, NO WORD ON WHICH — NO RATE. Surgical cotton and cotton are Rs.100 apart on the same
   * quilt, and [0] was whichever had been saved first. A price nobody can say the reason for is
   * not a price; it is a guess with somebody's money, and this says so instead. */
  if (hits.length > 1 && hits.some(prIsFill)
      && new Set(hits.map(r => prNameKey(r.filler))).size > 1) return null;
  return hits[0] || null;
}

/**
 * Why a line has no rate, in words — for the payout to print beside the "no rate" it shows.
 * '' when it has one.
 */
function prRateWhy(vendorCode, o, l) {
  if (prRateRowFor(vendorCode, o, l)) return '';
  const all = (HR.prate || []).filter(r => prLineMatches(r, o, l, vendorCode));
  if (!all.length) return 'no rate in the Vendor rate list reaches this work';
  const ok = all.filter(prApproved);
  if (!ok.length) return all.length + ' rate(s) match but none is approved yet';
  const fillers = [...new Set(ok.filter(prIsFill).map(r => String(r.filler || '').trim()).filter(Boolean))];
  if (fillers.length > 1) return 'two fillers are priced — ' + fillers.join(' and ')
    + ' — and neither the order nor the line says which one this is. Open the order in Vendor Orders '
    + 'and set its filler';
  const m = l && l.kind !== 'running' ? mdbOf(l.sku) : null;
  const colsRaw = (l && l.colours) != null && l.colours !== '' ? l.colours : (m && m.printColours);
  const n = parseInt(colsRaw, 10);
  if (n > 0) return 'the design has ' + n + ' colours and no approved rate covers that count';
  const prices = [...new Set(ok.filter(r => !prColIsLabel(r)).map(r => 'Rs.' + (parseFloat(r.rate) || 0)))];
  if (prices.length > 1) return 'the colour bands charge different prices (' + prices.join(', ')
    + ') and this design has no colour count written — put one on the SKU in the master database';
  return 'no approved rate covers a design with no colour count written';
}

/** What that line is worth, in rupees per its own unit. Null when no approved rate reaches it. */
function prRateFor(vendorCode, o, l) {
  const hit = prRateRowFor(vendorCode, o, l);
  return hit ? (parseFloat(hit.rate) || 0) : null;
}

/**
 * Where a rate stands, and the way to move it.
 *
 * An approver sees two buttons on a proposal and nothing on the rest — a rate already approved needs
 * no confirming. Everybody else sees the state and who settled it, which is what they came to find
 * out after proposing one.
 */
function prRateCell(r, i) {
  const st = prStatus(r);
  const who = st === 'Approved' ? (r.approvedBy || '') : (st === 'Refused' ? (r.refusedBy || '') : '');
  const when = st === 'Approved' ? (r.approvedAt || '') : (st === 'Refused' ? (r.refusedAt || '') : '');
  const tip = st === 'Pending'
    ? 'Proposed by ' + esc(r.by || 'somebody') + '. It prices nothing until it is approved.'
    : (who ? esc(st + ' by ' + who + (when ? ' on ' + ptIsoDate(when) : '')) : esc(st));
  const pill = st === 'Approved' ? '<span class="pill pill-ok">approved</span>'
    : (st === 'Pending' ? '<span class="pill pill-low">waiting</span>'
      : `<span class="pill pill-out">refused</span>${r.refusedWhy ? ` <span class="muted" style="font-size:11px">${esc(r.refusedWhy)}</span>` : ''}`);
  if (st !== 'Pending' || !prCanApprove()) return `<span title="${tip}">${pill}</span>`;
  return `<button class="ghost" data-pr-ok="${i}" style="padding:2px 9px;font-size:12px" title="${tip}">Approve</button>`
    + ` <button class="ghost" data-pr-no="${i}" style="padding:2px 9px;font-size:12px">Refuse</button>`;
}

/** How many live order lines a rate would actually be reached by. */
function prUsage(r) {
  let n = 0;
  (VO.rows || []).forEach(o => {
    if (!o || o.status === 'Cancelled') return;
    voLines(o).forEach(l => { if (l && !l.cancelled && prLineMatches(r, o, l)) n++; });
  });
  return n;
}

/**
 * What the pickers offer.
 *
 * The vendor orders first — what printers have actually been given — and then the MASTER DATABASE,
 * because a rate has to be settable for work nobody has ordered yet. Quilts are the case that showed
 * this: 160 quilt SKUs in the master, not one on any vendor order, so Quilt and Queen Quilt and every
 * quilt size were missing from a list that had no business excluding them. A rate typed blind and
 * spelled slightly differently matches nothing, silently.
 */
function prKnown(field) {
  const out = new Set();
  (VO.rows || []).forEach(o => voLines(o).forEach(l => {
    if (!l) return;
    const m = mdbOf(l.sku);
    if (field === 'fabric' && l.fabricType) out.add(l.fabricType);
    if (field === 'print' && l.printDirection) out.add(l.printDirection);
    if (field === 'articleType') { const v = l.articleType || (m && m.articleType); if (v) out.add(v); }
    if (field === 'subtype') { const v = l.articleSubtype || (m && m.subtype); if (v) out.add(v); }
    if (field === 'size') { const v = l.size || (m && m.size); if (v) out.add(v); }
  }));
  /* The fillers already named on a rate, so the second quilt rate offers what the first one used. */
  if (field === 'filler') {
    (HR.prate || []).forEach(r => { if (r && r.filler) out.add(r.filler); });
    ['Surgical Cotton', 'Cotton', 'Recron'].forEach(x => out.add(x));
  }
  /* Everything the factory makes, ordered from a printer or not. */
  (PTG.mdb || []).forEach(r => {
    if (!r) return;
    if (field === 'fabric' && r.fabric) out.add(r.fabric);
    if (field === 'articleType' && r.articleType) out.add(r.articleType);
    if (field === 'subtype' && r.subtype) out.add(r.subtype);
    if (field === 'size' && r.size) out.add(r.size);
  });
  /* Plus whatever the masters and the rates already name, the way the employee rates do. */
  (HR.prate || []).forEach(r => { if (r[field]) out.add(r[field]); });
  return [...out].map(String).filter(Boolean).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function prFields(r) {
  /* EVERY vendor, not only the block printers — a filling firm and a fabricator have rates too. */
  const vends = voAllVendors();
  return [
    /* The name, not the code. VND002 is how the database keys them; nobody here says it out loud.
     *
     * A NEW rate may be set for several printers at once — the same quilt price across four of them
     * is one decision, not four. Editing stays single, because a row IS one printer's rate. */
    r
      ? { key: 'vendor', label: 'Printer', type: 'select', value: r.vendor,
          options: [['', '— pick a printer —']].concat(vends.map(v => [v.code, (v.desc || v.name || v.code)])) }
      : { key: 'vendor', label: 'Printers — tick every one this rate is for', type: 'multi', value: [],
          options: vends.map(v => [v.code, (v.desc || v.name || v.code)]), span: true },
    /* The service decides everything else: what unit it is bought in, and whether the filler and its
     * weight are part of the price. */
    { key: 'service', label: 'What the work is', type: 'select', value: r ? (r.service || 'Block print') : 'Block print',
      options: PR_SERVICES.map(s => [s.key, s.key + (s.kinds.length === 1 ? ' — per piece' : ' — metres or pieces')]) },
    /* Only printing is bought both ways; for everything else this is ignored and the piece wins. */
    { key: 'kind', label: 'Priced by — printing only', type: 'select', value: r ? (r.kind || 'cut') : 'cut',
      options: [['cut', 'the piece'], ['running', 'the metre']] },
    { key: 'fabric', label: 'Fabric — printing only', value: r ? (r.fabric || '') : '', list: prKnown('fabric') },
    { key: 'print', label: 'Print direction — printing only', value: r ? (r.print || '') : '', list: prKnown('print') },
    { key: 'at', label: 'Article type — everything but printing', value: r ? (r.articleType || '') : '', list: prKnown('articleType') },
    { key: 'sub', label: 'Subtype', value: r ? (r.subtype || '') : '', list: prKnown('subtype') },
    { key: 'size', label: 'Size', value: r ? (r.size || '') : '', list: prKnown('size') },
    /* HOW MANY COLOURS THE DESIGN IS PRINTED IN. Each colour is another block and another pass, so
     * a 60X60 at two colours and the same cloth at three are two rates, not one. */
    { key: 'colours', label: 'Colours — printing only. "1-4", "5+" or a single number',
      value: r ? (r.colours || '') : '', list: ['1-4', '5+', '1', '2', '3', '4', '5'] },
    { key: 'filler', label: 'Filler material — filling only', value: r ? (r.filler || '') : '', list: prKnown('filler') },
    { key: 'weight', label: 'Weight in kg — filling only', type: 'number', step: '0.01', value: r ? (r.weight || '') : '' },
    { key: 'rate', label: 'Rate (Rs.)', type: 'number', step: '0.01', value: r ? r.rate : '' },
    { key: 'notes', label: 'Notes', value: r ? (r.notes || '') : '', span: true },
  ];
}
const prRec = v => {
  const svc = prSvc(v.service) || PR_SERVICES[0];
  /* The row's unit where the service allows a choice; its only one where it does not. */
  const run = svc.kinds.length === 1 ? svc.kinds[0] === 'running' : String(v.kind) === 'running';
  return { vendor: String(v.vendor).trim(), service: svc.key, kind: run ? 'running' : 'cut',
    fabric: run ? String(v.fabric || '').trim() : '',
    print: run ? String(v.print || '').trim() : '',
    articleType: run ? '' : String(v.at || '').trim(),
    subtype: run ? '' : String(v.sub || '').trim(),
    size: run ? '' : String(v.size || '').trim(),
    /* Carried only where they mean something, so a stitching rate never sits there with an empty
     * filler that somebody has to wonder about. */
    filler: svc.fill ? String(v.filler || '').trim() : '',
    weight: svc.fill ? String(v.weight || '').trim() : '',
    /* Only printing is priced by the colour count — a filling rate has no colours in it. A label is
     * kept as it was written, because it is read by people, not parsed. */
    colours: prIsPrinting(svc.key)
      ? (prColLabel(v.colours) || prCols({ colours: v.colours })) : '',
    rate: parseFloat(v.rate) || 0, notes: String(v.notes || '').trim(),
    at: new Date().toISOString(), by: ME.email,
    /* Written every time, so EDITING an approved rate sends it back for approval: a rate that has
     * been changed is not the rate that was approved. An approver's edit is approved as it is saved,
     * which is the same thing in one step. */
    ...prStamp() };
};

function prCheck(v, skipIndex) {
  /* PROPOSING IS OPEN, APPROVING IS NOT. Reaching this screen at all is the gate on proposing; a
   * proposed rate prices nothing until somebody with the right approves it. */
  if (Array.isArray(v.vendor)) return v.vendor.length ? '' : 'Tick at least one vendor.';
  if (!String(v.vendor || '').trim()) return 'Pick the vendor.';
  const svc = prSvc(v.service);
  if (!svc) return 'Pick what the work is — ' + PR_SERVICES.map(s => s.key).join(', ') + '.';
  const isRun = svc.kinds.length === 1 ? svc.kinds[0] === 'running' : String(v.kind) === 'running';
  if (isRun) {
    if (!String(v.fabric || '').trim()) return svc.key + ' is priced by fabric — name it.';
    if (!String(v.print || '').trim()) return 'Name the print direction.';
  } else {
    if (!String(v.at || '').trim()) return svc.key + ' is priced by article type — name it.';
    if (!String(v.sub || '').trim()) return 'Name the subtype.';
    if (!String(v.size || '').trim()) return 'Name the size — a 60X60 rate is not a 70X108 rate.';
  }
  if (svc.fill) {
    /* His own sheet prices the same quilt twice, at Rs.550 on surgical cotton and Rs.450 on cotton.
     * Without the filler there is no telling the two rates apart. */
    if (!String(v.filler || '').trim()) return 'Filling is priced by what goes inside — name the filler material.';
    if (!(parseFloat(v.weight) > 0)) return 'Name the weight in kg — 1 kg of cotton is not 1.75 kg of it.';
  }
  /* A colour count is never ROUNDED to the first digit in it — "1 to 4" read as 1 is how a
   * four-colour tablecloth gets a one-colour price. A value with NO number in it is not a count at
   * all but a label ("Gadd"), and that is allowed: it is how two rates for one cloth are told apart.
   * Anything with a digit that still cannot be read is a count somebody wrote wrong. */
  if (String(v.colours || '').trim() && !prColSpec(v.colours) && !prColLabel(v.colours)
      && PR_COL_ANY.indexOf(String(v.colours).trim().toLowerCase()) < 0)
    return `"${String(v.colours).trim()}" is not a number of colours. Write 1-4, or 5+, or a single `
      + 'number — or a name with no digits in it, like Gadd, to tell two rates for the same cloth apart.';
  if (!(parseFloat(v.rate) > 0)) return 'The rate must be more than zero.';
  /* A second rate for the same combination is never reached — prRateFor takes the first match — so it
   * would sit there looking authoritative and pricing nothing. */
  const k = prKey(prRec(v));
  /* A REFUSED ROW IS NOT A DUPLICATE. It is the record of a rate that was turned down, kept so the
   * person who proposed it can see what happened — it must not stand in the way of proposing again. */
  /* THE SAME RATE, OR ONE WHOSE COLOUR RANGE OVERLAPS THIS ONE. 1-4 and 3-6 both answer a
   * three-colour design and which one wins would be an accident of order. */
  const bare = prKey(Object.assign({}, prRec(v), { colours: '' }));
  const dup = (HR.prate || []).findIndex((x, j) => j !== skipIndex && prStatus(x) !== 'Refused'
    && prKey(Object.assign({}, x, { colours: '' })) === bare
    && prColOverlap(x, prRec(v)));
  if (dup >= 0) {
    const other = HR.prate[dup];
    return `${voName(v.vendor)} already has a${prStatus(other) === 'Pending' ? ' proposed' : 'n approved'} `
      + `rate for ${prWhat(prRec(v))}.`;
  }
  return '';
}

/** A printer named the way a person would name one: by name, or by code if that is what was written. */
function prVendorCode(txt) {
  const s = String(txt == null ? '' : txt).trim();
  if (!s) return '';
  /* EVERY vendor, not only the block printers — a filling firm on a quilt sheet has to be findable
   * by name, and looking only among printers refused all four of them. */
  const vends = voAllVendors();
  const byCode = vends.find(v => hrN(v.code) === hrN(s));
  if (byCode) return byCode.code;
  const byName = vends.find(v => hrN(v.desc || v.name) === hrN(s));
  return byName ? byName.code : '';
}

/** The columns a rate file has, and the order the template writes them in. */
const PR_COLS = ['Vendor', 'Work', 'Fabric', 'Print direction', 'Article type', 'Subtype', 'Size',
  'Colours', 'Filler material', 'Weight kg', 'Rate', 'Notes'];

function prTemplate() {
  /* One example of each shape the list holds: printing by the metre, plain piecework, and filling —
   * which is the one that needs the filler and the weight to tell two rates apart. */
  ptDownload('vendor-rate-template', [PR_COLS.join(','),
    'RBP-Bagru,Block print,Voil 92,Vertical,,,,,,14',   // a fabric means metres
    'Choudhary Hand Block,Block print,,,Tablecloth,Square Tablecloth,60X60,,,22',
    'Alisha Garmnets,Filling,,,Quilt,Twin Quilt,60x90,Surgical Cotton,1,550',
    'Alisha Garmnets,Filling,,,Quilt,Twin Quilt,60x90,Cotton,1,450',
    'Yakum Ansari,Filling,,,Seat Pad,Seat Pad,16x16,Recron,0.65,80',
    /* A fabricator is TWO rates, not one — cutting and stitching are separate jobs at separate
     * prices, so the template shows them as separate rows rather than one "Fabricator". */
    'Jatin Singh,Cutting,,,Napkin,Border Napkin,20x20,,,3',
    'Jatin Singh,Stitching,,,Napkin,Border Napkin,20x20,,,6']);
}

/** Rows out of a file, in the shape prCheck and prRec already understand. */
function prFromRows(rows) {
  let h = -1;
  for (let i = 0; i < Math.min(12, rows.length); i++) {
    const low = (rows[i] || []).map(x => hrN(x));
    if (low.some(x => x === 'vendor' || x === 'vendor name' || x === 'printer')) { h = i; break; }
  }
  if (h < 0) return { err: 'That file has no "Vendor" column. Download the template to see the shape.' };
  const low = rows[h].map(x => hrN(x));
  const at = names => { for (const n of names) { const i = low.indexOf(n); if (i >= 0) return i; } return -1; };
  const c = { vendor: at(['vendor', 'vendor name', 'printer', 'printer name']),
    service: at(['work', 'service', 'priced by', 'kind', 'type']),
    fabric: at(['fabric', 'fabric type']), print: at(['print direction', 'print', 'direction']),
    at: at(['article type', 'article']), sub: at(['subtype', 'article subtype']),
    size: at(['size']),
    /* "Colours", or whatever somebody wrote on the column that means it. */
    colours: at(['colours', 'colors', 'colour', 'color', 'no of colours', 'no of colors', 'colour count']),
    filler: at(['filler material', 'filler', 'filling']),
    weight: at(['weight kg', 'weight', 'kg']),
    rate: at(['rate', 'rate (rs.)', 'rs']), notes: at(['notes', 'remarks']) };
  if (c.rate < 0) return { err: 'That file has no "Rate" column.' };
  const out = [];
  rows.slice(h + 1).forEach((r, n) => {
    const g = i => (i >= 0 ? String(r[i] == null ? '' : r[i]).trim() : '');
    const vendorTxt = g(c.vendor), rate = g(c.rate);
    if (!vendorTxt && !rate && !g(c.at) && !g(c.fabric)) return;      // a blank row is not an error
    /* Ravi's own sheet has a vendor name on a row with nothing else — a heading for the rows that
     * follow. It is not a rate, and refusing the file over it would be pedantry. */
    if (vendorTxt && !rate && !g(c.at) && !g(c.fabric) && !g(c.filler)) return;
    /* The old files said "cut" or "running" where this one says what the work is. Both are read, so
     * a rate card written last week still uploads. */
    const svcTxt = g(c.service), low = hrN(svcTxt);
    const service = (low === 'running' || low === 'metre' || low === 'meter') ? 'Block print'
      : (low === 'cut' || low === 'piece' || low === '') ? 'Block print'
      : (prSvcKey(svcTxt) || svcTxt);
    /* An older file wrote the unit where this one writes the work, so both still read. A file that
     * names a real service and no unit is priced by the piece unless a fabric says otherwise. */
    const kind = (low === 'running' || low === 'metre' || low === 'meter') ? 'running'
      : (g(c.fabric) ? 'running' : 'cut');
    out.push({ row: n + h + 2, vendorTxt, serviceTxt: svcTxt,
      vendor: prVendorCode(vendorTxt), service,
      kind,
      fabric: g(c.fabric), print: g(c.print), at: g(c.at), sub: g(c.sub), size: g(c.size),
      filler: g(c.filler), weight: g(c.weight), colours: g(c.colours),
      rate, notes: g(c.notes) });
  });
  return { rows: out };
}

/**
 * Check a whole file against the existing rates AND against itself, and return every problem rather
 * than the first — a hundred-row rate card should fail once, with the full list.
 */
function prPlan(list) {
  const errs = [], warns = [], seen = new Map(), clean = [];
  (list || []).forEach(v => {
    const at = 'Row ' + v.row + ': ';
    if (!v.vendor) {
      errs.push(at + (v.vendorTxt ? `"${v.vendorTxt}" is not in the vendor master.` : 'no vendor named.'));
      return;
    }
    if (!prSvc(v.service)) {
      /* A fabricator both cuts and stitches. Listing all eight words does not help somebody who has
       * just read "Fabricator" off the vendor screen next door — naming the two does. */
      const amb = PR_SVC_AMBIGUOUS[hrN(v.serviceTxt || v.service)];
      errs.push(at + (amb
        ? `"${v.serviceTxt || v.service}" is what the FIRM is, not what the work is — they both `
          + `${amb[0].toLowerCase()} and ${amb[1].toLowerCase()}, at different rates. Write `
          + `${amb.join(' or ')} in the Work column, one row each.`
        : `"${v.serviceTxt || v.service}" is not a kind of work — use one of: `
          + PR_SERVICES.map(s => s.key).join(', ') + '.'));
      return;
    }
    const why = prCheck(v, -1);
    if (why) { errs.push(at + why); return; }
    /* TWICE IN ONE FILE — and it matters whether the two agree.
     *
     * The same rate written twice is a repetition: a sheet grouped by vendor, or the same line
     * pasted again. Nothing is lost by taking one, and refusing the whole row over it sent people
     * back to edit a file that was not wrong.
     *
     * Two DIFFERENT rates on one key is not a repetition. Which one wins would be an accident of
     * which line came first, and the answer is what a printer gets paid — so that is still refused,
     * by row number, with both figures named. */
    const k = prKey(prRec(v));
    const had = seen.get(k);
    if (had) {
      const same = (parseFloat(had.rate) || 0) === (parseFloat(v.rate) || 0);
      if (!same) {
        errs.push(`${at}this is the same rate as row ${had.row}, but for ${nf(had.rate)} there and `
          + `${nf(v.rate)} here. Which one is right? Leave one of the two in the file.`);
        return;
      }
      warns.push(`Row ${v.row} repeats row ${had.row} — same rate, ${nf(v.rate)}. Taken once.`);
      return;
    }
    seen.set(k, v);
    clean.push(v);
  });
  return { rows: clean, errs, warns };
}

let PRU = { rows: null, name: '' };

$('hrPrTmpl').onclick = prTemplate;
$('hrPrStatus').onchange = renderHr;
$('hrPrUp').onclick = () => $('hrPrFile').click();
$('hrPrFile').onchange = async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const say = (m, bad) => { $('hrMsg').className = bad ? 'err' : 'muted'; $('hrMsg').textContent = m; };
  if (!ME.admin) return say('Only an admin can change a printer rate.', true);
  say('Reading ' + f.name + '…');
  let rows;
  try { rows = await pkReadFile(f); }
  catch (err) { return say('Could not read that file: ' + (err.message || err), true); }
  const got = prFromRows(rows);
  if (got.err) return say(got.err, true);
  if (!got.rows.length) return say('That file has no rows under the header.', true);
  const plan = prPlan(got.rows);
  /* ONE BAD ROW REFUSES THE FILE. Half a rate card prices some work and silently prices none of the
   * rest, and there is no way to tell which is which by looking at it. */
  if (plan.errs.length) {
    return say('Nothing was loaded. ' + plan.errs.slice(0, 5).join(' ')
      + (plan.errs.length > 5 ? ` …and ${nf(plan.errs.length - 5)} more.` : ''), true);
  }
  PRU = { rows: plan.rows, name: f.name };
  const printers = new Set(plan.rows.map(r => r.vendor)).size;
  /* REPEATED ROWS ARE SAID OUT LOUD, and then the upload goes ahead. They are not an error — the
   * same rate written twice costs nothing to take once — but somebody should know the file did
   * it, in case the repetition was meant to be a second, different rate. */
  const warnTxt = (plan.warns || []).length
    ? '\n\n' + nf(plan.warns.length) + ' repeated row(s), taken once:\n'
      + plan.warns.slice(0, 6).join('\n')
      + (plan.warns.length > 6 ? `\n…and ${nf(plan.warns.length - 6)} more.` : '')
    : '';
  if (!confirm(`${nf(plan.rows.length)} rate(s) across ${nf(printers)} printer(s) from ${f.name}.`
    + warnTxt + '\n\n'
    + (prCanApprove()
      ? 'These are added to the rate list, approved in your name. Nothing already there is changed or removed.'
      : 'These are added as PROPOSALS. They price nothing until somebody who can approve rates does. '
        + 'Nothing already there is changed or removed.')
    + '\n\nOK adds them.')) {
    PRU = { rows: null, name: '' };
    return say('');
  }
  HR.prate = (HR.prate || []).concat(plan.rows.map(prRec));
  try { await hrSavePrRate(); }
  catch (err) { return say('Not saved: ' + (err.message || err), true); }
  PRU = { rows: null, name: '' };
  renderHr();
  say(`${nf(plan.rows.length)} rate(s) added from ${f.name}${prCanApprove() ? '' : ', waiting for approval'}.`
    + ((plan.warns || []).length ? ` ${nf(plan.warns.length)} repeated row(s) were taken once.` : ''));
};

$('hrPrNew').onclick = () => ptOpenDialog({
  title: 'New rate',
  note: 'One rate per vendor and per thing they do — a fabricator who cuts AND stitches has two. '
    + 'Printing is priced by the METRE and varies by fabric and print direction; embroidery, cutting, '
    + 'stitching and filling are priced by the PIECE and vary by article, subtype and size. Filling '
    + 'also carries the filler and its weight, because the same quilt costs differently in surgical '
    + 'cotton and in cotton. Fill in the boxes the work needs — the others are ignored. There is no '
    + 'fallback: a rate is used only where it matches exactly.',
  fields: prFields(null),
  onSave: async v => {
    const picked = Array.isArray(v.vendor) ? v.vendor : [v.vendor].filter(Boolean);
    if (!picked.length) return 'Tick at least one printer.';
    /* Checked per printer, because a rate can be new for one and a duplicate for another — and a
     * refusal has to name which. */
    const bad = [], add = [];
    picked.forEach(code => {
      const one = Object.assign({}, v, { vendor: code });
      const why = prCheck(one, -1);
      if (why) { bad.push(voName(code) + ': ' + why); return; }
      /* Against the others in this same save, not only against what is stored. */
      const k = prKey(prRec(one));
      if (add.some(x => prKey(x) === k)) return;
      add.push(prRec(one));
    });
    if (bad.length) return bad.slice(0, 4).join(' ') + (bad.length > 4 ? ` …and ${nf(bad.length - 4)} more.` : '');
    HR.prate = (HR.prate || []).concat(add);
    await hrSavePrRate();
    renderHr();
    $('hrMsg').className = 'muted';
    const tail = prCanApprove() ? '' : ' It prices nothing until somebody who can approve rates does.';
    $('hrMsg').textContent = (add.length === 1
      ? `Rate ${prCanApprove() ? 'added' : 'proposed'} for ${voName(add[0].vendor)}.`
      : `The same rate ${prCanApprove() ? 'added' : 'proposed'} for ${nf(add.length)} vendors: ${add.map(x => voName(x.vendor)).join(', ')}.`)
      + tail;
    return '';
  },
});

/**
 * Approve or refuse one proposal.
 *
 * Returns a message, '' when it went through — the same shape every other guarded write on this
 * screen uses, so the caller has one thing to show.
 */
async function prSetOk(i, ok, why) {
  if (!prCanApprove()) return 'Approving a vendor rate is granted separately. Ask an admin for it.';
  const r = (HR.prate || [])[i];
  if (!r) return 'That rate is no longer in the list.';
  /* Checked here as well as on the button: a page left open while somebody else approves the same
   * row still has the old buttons drawn on it. */
  if (prStatus(r) !== 'Pending') return `That rate is already ${prStatus(r).toLowerCase()}.`;
  const now = new Date().toISOString();
  /* The array this change is being made to. A save that clashes reloads the list from the database,
   * and then putting the old row back at slot i would be writing it into somebody else's list. */
  const list = HR.prate;
  HR.prate[i] = Object.assign({}, r, ok
    ? { status: 'Approved', approvedBy: ME.email, approvedAt: now, refusedBy: '', refusedAt: '', refusedWhy: '' }
    : { status: 'Refused', refusedBy: ME.email, refusedAt: now, refusedWhy: String(why || '').trim(),
        approvedBy: '', approvedAt: '' });
  try { await hrSavePrRate(); }
  catch (e) {
    if (HR.prate === list) HR.prate[i] = r;      // not reloaded: the change is ours to undo
    return 'Not saved: ' + (e.message || e);
  }
  renderHr();
  return '';
}

$('hrPrOkAll').onclick = async () => {
  const say = (t, bad) => { $('hrMsg').className = bad ? 'err' : 'muted'; $('hrMsg').textContent = t; };
  if (!prCanApprove()) return say('Approving a vendor rate is granted separately. Ask an admin for it.', true);
  /* What is SHOWN, so the search and the approval filter both narrow it — approving forty rates on
   * a screen showing three would be a surprise. */
  const open = (HR.rows || []).filter(x => x && prStatus(x.r) === 'Pending');
  if (!open.length) return say('Nothing in this view is waiting for approval.');
  const vend = new Set(open.map(x => x.r.vendor)).size;
  /* Named, not "are you sure?" — this is the step that lets these rates price real orders. */
  if (!confirm(`Approve ${nf(open.length)} rate(s) across ${nf(vend)} vendor(s)?\n\n`
    + 'From then on every order line they match is priced by them.\n\nOK approves them.')) return;
  const now = new Date().toISOString();
  const list = HR.prate, before = HR.prate.slice();
  open.forEach(({ i }) => {
    HR.prate[i] = Object.assign({}, HR.prate[i],
      { status: 'Approved', approvedBy: ME.email, approvedAt: now, refusedBy: '', refusedAt: '', refusedWhy: '' });
  });
  try { await hrSavePrRate(); }
  catch (e) {
    /* Only onto the list these approvals were made to. A clash has already replaced it with what the
     * database really holds, and dropping the old array back over that would undo the reload. */
    if (HR.prate === list) HR.prate = before;
    return say('Not saved: ' + (e.message || e), true);
  }
  renderHr();
  say(`${nf(open.length)} rate(s) approved.`);
};

function prEdit(i) {
  const r = (HR.prate || [])[i]; if (!r) return;
  ptOpenDialog({
    title: 'Edit rate',
    subtitle: `${voName(r.vendor)}  ·  ${prWhat(r)}  ·  Rs.${nf(r.rate)} ${prUnit(r)}`,
    fields: prFields(r),
    deleteWhat: `the rate Rs.${nf(r.rate)} ${prUnit(r)} for ${voName(r.vendor)} — ${prWhat(r)}`,
    onSave: async v => {
      const err = prCheck(v, i);
      if (err) return err;
      HR.prate[i] = Object.assign({}, prRec(v), { addedAt: r.addedAt || r.at },
        r._key != null ? { _key: r._key } : {});
      await hrSavePrRate();
      renderHr();
      return '';
    },
    /* Deleting is the approvers', the way it was the admins'. A proposal is refused, not deleted —
     * that is what leaves a record of the decision. */
    onDelete: prCanApprove() ? (async () => {
      HR.prate = HR.prate.filter((_, j) => j !== i);
      await hrSavePrRate();
      renderHr();
      return '';
    }) : null,
  });
}

$('hrEmpNew').onclick = () => ptOpenDialog({
  title: 'New employee',
  fields: [
    { key: 'name', label: 'Name', value: '', span: true },
    { key: 'type', label: 'Employment type', type: 'select', value: '',
      options: [''].concat([...new Set((HR.emp || []).map(e => String(e[0] || '').trim()).filter(Boolean))].sort()) },
    { key: 'dept', label: 'Department', type: 'select', value: '',
      options: [''].concat([...new Set((HR.emp || []).map(e => String(e[2] || '').trim()).filter(Boolean))].sort()) },
    { key: 'phone', label: 'Phone', value: '', span: true },
  ],
  onSave: async v => {
    const name = String(v.name || '').trim();
    if (!name) return 'Enter the name.';
    if (!String(v.type || '').trim()) return 'Select the employment type.';
    if (!String(v.dept || '').trim()) return 'Select the department.';
    // The same name in two departments is real; the same name in the SAME one is a duplicate.
    if ((HR.emp || []).some(e => hrN(e[1]) === hrN(name) && hrN(e[2]) === hrN(v.dept)))
      return `${name} is already listed under ${v.dept}.`;
    HR.emp = (HR.emp || []).concat([[String(v.type).trim(), name, String(v.dept).trim(), String(v.phone || '').trim()]]);
    await hrSaveEmp();
    renderHr();
    return '';
  },
});

function hrEditEmp(i) {
  const e = (HR.emp || [])[i]; if (!e) return;
  const use = hrEmpUsage(e[1]);
  const total = use.base + use.hours + use.qc;
  ptOpenDialog({
    title: 'Edit employee',
    subtitle: `${e[1]}  ·  ${e[2] || '—'}`,
    note: total ? `Named in ${nf(total)} live row(s) — Job Work Register ${nf(use.base)}, extra hours ${nf(use.hours)}, QC alterations ${nf(use.qc)}.`
      : 'Not named in any live row yet.',
    fields: [
      { key: 'name', label: 'Name', value: e[1], span: true },
      { key: 'type', label: 'Employment type', type: 'select', value: e[0],
        options: [...new Set([e[0]].concat((HR.emp || []).map(x => String(x[0] || '').trim())).filter(Boolean))].sort() },
      { key: 'dept', label: 'Department', type: 'select', value: e[2],
        options: [...new Set([e[2]].concat((HR.emp || []).map(x => String(x[2] || '').trim())).filter(Boolean))].sort() },
      { key: 'phone', label: 'Phone', value: e[3] || '', span: true },
    ],
    deleteWhat: `${e[1]} (${e[0]} · ${e[2]})`,
    deleteAllowed: hrCanEmpDelete(),
    onSave: async v => {
      const name = String(v.name || '').trim();
      if (!name) return 'Enter the name.';
      if ((HR.emp || []).some((x, j) => j !== i && hrN(x[1]) === hrN(name) && hrN(x[2]) === hrN(v.dept)))
        return `${name} is already listed under ${v.dept}.`;
      HR.emp[i] = [String(v.type).trim(), name, String(v.dept).trim(), String(v.phone || '').trim()];
      await hrSaveEmp();
      renderHr();
      return '';
    },
    onDelete: async () => {
      if (!hrCanEmpDelete()) return 'Only somebody with "Can add and delete employees" (or an admin) can remove an employee.';
      /* Their work would name somebody the list no longer has, and the payout reading it would
       * simply pass over them. */
      const u = hrEmpUsage(e[1]);
      const n = u.base + u.hours + u.qc;
      if (n) return `${e[1]} cannot be removed — named in ${nf(u.base)} Job Work Register row(s), `
        + `${nf(u.hours)} extra-hours entr${u.hours === 1 ? 'y' : 'ies'} and ${nf(u.qc)} QC alteration(s).`;
      HR.emp = HR.emp.filter((_, j) => j !== i);
      await hrSaveEmp();
      renderHr();
      return '';
    },
  });
}

const RATE_FOR = ['Company Contractor', 'External Contractor'];

/**
 * Every article type / subtype / size this factory actually uses — the Masters lists first, then the
 * master database, then whatever the rate list already names. Three sources because no one of them
 * is complete: a master row can exist with no SKU yet, a SKU can exist before anyone adds the master,
 * and an old rate can name something that predates both.
 */
function hrRateKnown(field) {
  const master = ptList((PTG.masters || {})[field === 'at' ? 'articleType' : field === 'sub' ? 'articleSubtype' : 'size'])
    .filter(x => x && x.active !== false).map(x => x.desc || x.code);
  const mdbField = field === 'at' ? 'articleType' : field === 'sub' ? 'subtype' : 'size';
  const fromMdb = (PTG.mdb || []).map(x => x && x[mdbField]);
  const idx = field === 'at' ? 0 : field === 'sub' ? 1 : 2;
  const fromRates = (HR.rate || []).map(x => x[idx]);
  return [...new Set(master.concat(fromMdb).concat(fromRates)
    .map(x => String(x == null ? '' : x).trim()).filter(Boolean))]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function hrRateFields(r) {
  return [
    /* Type-or-pick, not pick-only. These used to be built from the rate list itself, so a new article
     * could never be given its first rate — the only list it could have come from was the one it was
     * not in yet. */
    { key: 'at', label: 'Article type', value: r ? r[0] : '', list: hrRateKnown('at') },
    { key: 'sub', label: 'Subtype', value: r ? r[1] : '', list: hrRateKnown('sub') },
    { key: 'size', label: 'Size', value: r ? r[2] : '', list: hrRateKnown('size') },
    { key: 'for', label: 'Applicable for', type: 'select', value: r ? r[3] : RATE_FOR[0], options: RATE_FOR },
    { key: 'rate', label: 'Rate (Rs.)', type: 'number', step: '0.01', value: r ? r[4] : '' },
    { key: 'comm', label: 'Commission (a % or blank for none)', value: r && String(r[5]) !== 'NA' ? r[5] : '', span: true },
  ];
}
const hrRateRec = v => [String(v.at).trim(), String(v.sub).trim(), String(v.size).trim(),
  String(v.for).trim(), parseFloat(v.rate) || 0, String(v.comm || '').trim() || 'NA'];

function hrRateCheck(v, skipIndex) {
  if (!String(v.at || '').trim()) return 'Select the article type.';
  if (!String(v.sub || '').trim()) return 'Select the subtype.';
  if (!String(v.size || '').trim()) return 'Enter the size.';
  if (!(parseFloat(v.rate) > 0)) return 'The rate must be more than zero.';
  /* A second rate for the same combination is never used — rateFor takes the first match — so it
   * would sit there looking authoritative and paying nothing. */
  const dup = (HR.rate || []).some((x, j) => j !== skipIndex
    && hrN(x[0]) === hrN(v.at) && hrN(x[1]) === hrN(v.sub) && hrN(x[2]) === hrN(v.size) && hrN(x[3]) === hrN(v.for));
  if (dup) return `A rate already exists for ${v.at} / ${v.sub} / ${v.size} / ${v.for}.`;
  return '';
}

$('hrRateNew').onclick = () => ptOpenDialog({
  title: 'New rate',
  note: 'One rate per article type, subtype, size and employment type. A payout looks up the first match, '
    + 'so a second rate for the same combination would never be used. Article type, subtype and size '
    + 'suggest every name the factory already uses — a new one can simply be typed in. Note that the '
    + 'payout falls back to subtype + size + employment type when nothing matches exactly, so it is '
    + 'the SUBTYPE that has to be right.',
  fields: hrRateFields(null),
  onSave: async v => {
    const err = hrRateCheck(v, -1);
    if (err) return err;
    HR.rate = (HR.rate || []).concat([hrRateRec(v)]);
    await hrSaveRate();
    renderHr();
    return '';
  },
});

function hrEditRate(i) {
  const r = (HR.rate || [])[i]; if (!r) return;
  ptOpenDialog({
    title: 'Edit rate',
    subtitle: `${r[0]} · ${r[1]} · ${r[2]} · ${r[3]}`,
    fields: hrRateFields(r),
    deleteWhat: `the rate Rs.${r[4]} for ${r[0]} / ${r[1]} / ${r[2]} / ${r[3]}`,
    onSave: async v => {
      const err = hrRateCheck(v, i);
      if (err) return err;
      HR.rate[i] = hrRateRec(v);
      await hrSaveRate();
      renderHr();
      return '';
    },
    onDelete: async () => {
      HR.rate = HR.rate.filter((_, j) => j !== i);
      await hrSaveRate();
      renderHr();
      return '';
    },
  });
}

/* ---- extra hours ---- */

$('hrEhNew').onclick = () => {
  const depts = [...new Set((HR.emp || []).map(e => String(e[2] || '').trim()).filter(Boolean))].sort();
  ptOpenDialog({
    title: 'Log extra hours',
    note: 'Hours are worked out from the two times; a shift that runs past midnight counts. It is logged '
      + 'as pending — authorising it is a separate, admin-only step.',
    fields: [
      { key: 'date', label: 'Date', type: 'date', value: dToday() },
      { key: 'dept', label: 'Department', type: 'select', value: '', options: [''].concat(depts) },
      { key: 'name', label: 'Employee', value: '', span: true },
      { key: 'from', label: 'From (HH:MM)', value: '' },
      { key: 'to', label: 'To (HH:MM)', value: '' },
      { key: 'remarks', label: 'Remarks', value: '', span: true },
    ],
    onSave: async v => {
      const date = String(v.date || '').trim(), dept = String(v.dept || '').trim(), name = String(v.name || '').trim();
      if (!date) return 'Enter the date.';
      if (!dept) return 'Select the department.';
      if (!name) return 'Enter the employee.';
      /* Matched on name AND department together: the same name can appear in two departments, and
       * finding by name alone would attach the hours to the wrong one. */
      const rec = (HR.emp || []).find(e => hrN(e[1]) === hrN(name) && hrN(e[2]) === hrN(dept));
      if (!rec) {
        const anywhere = (HR.emp || []).some(e => hrN(e[1]) === hrN(name));
        return anywhere ? `"${name}" is not listed under ${dept}. Pick the right department.`
                        : `"${name}" is not in the employee list. Add them there first.`;
      }
      const hours = ehHours(v.from, v.to);
      if (hours == null) return 'Enter both times as HH:MM.';
      if (hours <= 0) return 'The end time must be after the start time.';
      if (hours > 24) return 'Extra hours cannot be more than 24 in a day.';
      if ((HR.eh || []).some(r => r.date === date && hrN(r.empName) === hrN(name)))
        return `${name} already has an entry on ${date}. Edit that one instead.`;
      if (ehFrozen(date)) return `${ehMonthKey(date)} is frozen — extra hours for that month are locked.`;

      const row = {
        id: 'eh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        date, empName: rec[1], department: rec[2], hours,
        fromTime: String(v.from).trim(), toTime: String(v.to).trim(),
        remarks: String(v.remarks || '').trim(), status: 'pending',
        enteredBy: ME.email, enteredByName: ME.email, enteredAt: new Date().toISOString(),
        authorizedBy: '', authorizedByName: '', authorizedAt: '',
      };
      await ptPut('pt_extraHours/' + row.id, row);
      HR.eh = (HR.eh || []).concat(Object.assign({ _key: row.id }, row));
      renderHr();
      return '';
    },
  });
};

function hrEditEh(id) {
  const r = (HR.eh || []).find(x => x.id === id); if (!r) return;
  const isAuth = (r.status || 'pending') === 'authorized';
  ptOpenDialog({
    title: 'Edit extra hours',
    subtitle: `${r.empName || '—'}  ·  ${r.department || '—'}  ·  ${r.date || ''}`,
    note: isAuth
      ? 'Already authorised. Changing the times re-opens it for authorisation, because the figure that was approved would no longer be the figure on the record.'
      : 'Pending authorisation. Only an admin can authorise it.',
    adminNote: 'Authorising is what lets these hours reach a payout.',
    fields: [
      { key: 'from', label: 'From (HH:MM)', value: r.fromTime || '' },
      { key: 'to', label: 'To (HH:MM)', value: r.toTime || '' },
      { key: 'remarks', label: 'Remarks', value: r.remarks || '', span: true },
      { key: 'status', label: 'Authorisation', type: 'select', value: r.status || 'pending',
        options: ['pending', 'authorized'], admin: true },
      { key: 'date', label: 'Date', type: 'date', value: r.date || '', admin: true },
    ],
    deleteWhat: `${r.hours}h for ${r.empName} on ${r.date}`,
    onSave: async v => {
      const date = String(v.date || r.date).trim();
      if (ehFrozen(date) || ehFrozen(r.date)) return `${ehMonthKey(date)} is frozen — extra hours for that month are locked.`;
      const hours = ehHours(v.from, v.to);
      if (hours == null) return 'Enter both times as HH:MM.';
      if (hours <= 0) return 'The end time must be after the start time.';
      if (hours > 24) return 'Extra hours cannot be more than 24 in a day.';
      if (date !== r.date && (HR.eh || []).some(x => x.id !== r.id && x.date === date && hrN(x.empName) === hrN(r.empName)))
        return `${r.empName} already has an entry on ${date}.`;

      const timesChanged = hours !== ptNum(r.hours);
      let status = ME.admin ? String(v.status || r.status || 'pending') : (r.status || 'pending');
      // A changed figure is not the figure that was approved.
      if (timesChanged && isAuth && status === 'authorized' && !ME.admin) status = 'pending';

      const next = Object.assign({}, r, {
        date, hours, fromTime: String(v.from).trim(), toTime: String(v.to).trim(),
        remarks: String(v.remarks || '').trim(), status,
        editedBy: ME.email, editedAt: new Date().toISOString(),
      });
      if (status === 'authorized' && (r.status || 'pending') !== 'authorized') {
        next.authorizedBy = ME.email; next.authorizedByName = ME.email; next.authorizedAt = new Date().toISOString();
      }
      if (status !== 'authorized') { next.authorizedBy = ''; next.authorizedByName = ''; next.authorizedAt = ''; }
      delete next._key;
      await ptPut('pt_extraHours/' + r.id, next);
      HR.eh = (HR.eh || []).map(x => (x.id === r.id ? Object.assign({ _key: r.id }, next) : x));
      renderHr();
      return '';
    },
    onDelete: async () => {
      if (ehFrozen(r.date)) return `${ehMonthKey(r.date)} is frozen — extra hours for that month are locked.`;
      await ptDelete('pt_extraHours/' + r.id);
      HR.eh = (HR.eh || []).filter(x => x.id !== r.id);
      renderHr();
      return '';
    },
  });
}

$('hrTable').addEventListener('click', async e => {
  const a = e.target.closest('[data-hr-emp]'); if (a) return hrEditEmp(Number(a.getAttribute('data-hr-emp')));
  const p = e.target.closest('[data-hr-prate]');
  if (p) return prEdit(parseInt(p.getAttribute('data-hr-prate'), 10));
  const ok = e.target.closest('[data-pr-ok]');
  if (ok) {
    const err = await prSetOk(parseInt(ok.getAttribute('data-pr-ok'), 10), true);
    $('hrMsg').className = err ? 'err' : 'muted';
    $('hrMsg').textContent = err || 'Approved. Every order line it matches is priced by it from now on.';
    return;
  }
  const no = e.target.closest('[data-pr-no]');
  if (no) {
    const i = parseInt(no.getAttribute('data-pr-no'), 10);
    const r = (HR.prate || [])[i];
    /* WHY is worth asking for. The person who proposed it sees the row again, and "refused" on its
     * own tells them nothing about what to propose instead. */
    const why = prompt(`Refuse ${voName(r && r.vendor)} — ${r ? prWhat(r) : ''} at Rs.${nf(r && r.rate)}?\n\n`
      + 'Say why, so whoever proposed it knows what to change. Leave it blank to refuse without a reason.', '');
    if (why === null) return;                                   // Cancel is not a refusal
    const err = await prSetOk(i, false, why);
    $('hrMsg').className = err ? 'err' : 'muted';
    $('hrMsg').textContent = err || 'Refused. It prices nothing, and the same rate may be proposed again.';
    return;
  }
  const b = e.target.closest('[data-hr-rate]'); if (b) return hrEditRate(Number(b.getAttribute('data-hr-rate')));
  const c = e.target.closest('[data-hr-eh]'); if (c) return hrEditEh(c.getAttribute('data-hr-eh'));
});
['hrView', 'hrEhStatus'].forEach(id => $(id).addEventListener('change', renderHr));
ptDebounce('hrQ', renderHr);
/* Refresh is the only thing that re-reads these lists, which is why a stale snapshot can sit here
 * all day. It clears HR.emp, and ensureHr rewrites HR_SEEN from what it finds. */
/* The vendor payout and the rate list's "on live orders" are built from the vendor orders, so a
 * refresh that left those alone showed a delivery accepted a minute ago as not there. */
$('hrGo').onclick = async () => { HR.emp = null; if (!hrEmpOnly()) { VO.rows = null; VO.err = ''; } await ensureHr(); };
$('hrExport').onclick = () => {
  const view = $('hrView').value, rows = HR.rows || [];
  if (!rows.length) return;
  let head, body;
  if (view === 'cc' || view === 'ec') {
    head = (view === 'cc' ? ['Employee'] : []).concat(['Article', 'Subtype', 'Size', 'Pieces', 'Rate', 'Amount']);
    body = rows.map(r => (view === 'cc' ? [r.empName] : []).concat([r.articleType, r.subtype, r.size, r.recvPcs, r.rate, r.amount]));
  } else if (view === 'vpay') {
    head = ['Vendor', 'Code', 'Work', 'What', 'Received', 'Unit', 'Rate', 'Amount', 'Over', 'Returned'];
    body = rows.map(r => [r.vendor, r.vendorCode, r.service, r.what, r.qty, r.run ? 'm' : 'pcs',
      r.rate == null ? 'no rate' : r.rate, r.amount, r.over || '', r.rej || '']);
  } else if (view === 'adv') {
    head = ['Employee', 'Full-month payout', 'Advance', 'Net payable'];
    body = rows.map(r => [r.name, r.pay, r.adv, r.net]);
  } else if (view === 'slip') {
    head = ['Employee', 'Article type', 'Pieces', 'Amount'];
    body = rows.map(r => [r.name, r.articleType, r.recvPcs, r.amount]);
  } else if (view === 'emp') {
    head = ['Name', 'Employment type', 'Department', 'Phone'];
    body = rows.map(({ e }) => [e[1], e[0], e[2], e[3]]);
  } else if (view === 'prate') {
    /* The same columns the template offers, so an export can be edited and uploaded straight back. */
    const out = [PR_COLS.join(',')];
    (HR.rows || []).forEach(({ r }) => out.push([voName(r.vendor), r.service || 'Block print',
      r.fabric || '', r.print || '', r.articleType || '', r.subtype || '', r.size || '',
      r.filler || '', r.weight || '', r.rate, r.notes || ''].map(csvCell).join(',')));
    return ptDownload('vendor-rate-list', out);
  } else if (view === 'rate') {
    head = ['Article type', 'Subtype', 'Size', 'Applicable for', 'Rate', 'Commission'];
    body = rows.map(({ r }) => [r[0], r[1], r[2], r[3], r[4], r[5]]);
  } else {
    head = ['Date', 'Employee', 'Department', 'From', 'To', 'Hours', 'Status', 'Entered by', 'Remarks'];
    body = rows.map(r => [r.date, r.empName, r.department, r.fromTime, r.toTime, r.hours,
      r.status || 'pending', r.enteredByName || r.enteredBy, r.remarks]);
  }
  ptDownload({ cc: 'cc-payout', ec: 'ec-payout', adv: 'advance-payout', slip: 'salary-slip',
    emp: 'employee-list', rate: 'rate-list', eh: 'extra-hours' }[view] || 'finance',
    [head.map(csvCell).join(',')].concat(body.map(b => b.map(csvCell).join(','))));
};

