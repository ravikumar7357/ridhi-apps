/* ================= PRINTER ALLOCATION BY COLOUR =================
 *
 * Ravi, 16 Sep 2026: "printer allocation by color … brand wise color lene h all and unka sale volume
 * add krna h … wo color total sale me kitna contribute krta h … agate green h to us same green color
 * me kitni design h unko 1 family group me add krna h … wo color mujhe kitne vendor me allocate krna
 * chahiye against sales volume me printer ki capacity … us printer ke pas kitne blocks h or kitne
 * blocks required rahenge and kitne tables h uske pas".
 *
 * WHAT IS COMPUTED, AND WHAT IS FED IN. The work is computed: a design's pieces still to make is the
 * Order Console's own `pendingMake`, summed over every open line of that colour — so this screen and
 * the order book cannot disagree about how much there is to print. Who prints it today is read the
 * same way, off the line. Sales are the replenishment snapshot's units, shown only as a share, and
 * only for a brand whose snapshot has been read this session.
 *
 * Four things nobody can compute, so they are fed here and kept: a printer's capacity in pieces a
 * month and how many tables they have (`pt_printers`), which group a design belongs to
 * (`pt_colorGroups`), how many blocks one design takes (`pt_blockNeed`), and which blocks a printer
 * already holds (`pt_blockHave`).
 *
 * THE GROUP IS NOT ALWAYS THE COLOUR, which is why it is editable. The name usually says it —
 * "Agate Green", "Emerald Green" and "Olive Green" are one green to a printer — and that guess is
 * offered for all 348 of the 416 designs it fits. The rest are Ravi's own buckets ("Ocean Vine" is
 * blue, "Autumn Vine" is brown, and a "Gadd" group cuts across colours), and no rule finds those.
 */

let PAL = {
  groups: null,        // { at, by, map: { 'CPC|Agate Green': 'CPC Green' } }
  printers: null,      // [{ key, name, tables, pcsMonth, active, note }]
  need: null,          // { at, by, map: { designKey: blocks one printer needs } }
  have: null,          // { printerKey: { designKey: blocks held } }
  view: 'design', brand: '', q: '', busy: false, at: '', err: '', shown: [],
};

const PAL_NO_EDIT = 'You can look, not change — printers, groups and blocks need the production edit right.';
const palCanEdit = () => !spIsVendor() && !!(ME.admin || ME.prodEdit);
const palNum = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
/** Ridhi is RBP everywhere else in the factory; one spelling here keeps the groups from splitting. */
const palBrandOf = b => obUC(b).replace('RIDHI', 'RBP') || '?';
const palKey = (brand, color) => palBrandOf(brand) + '|' + String(color || '').trim();

/** The colour a design name says it is. A guess, offered until somebody says otherwise. */
const PAL_FAMILIES = [
  [/\b(blue|indigo|navy|denim|cobalt|sapphire|azure|cerulean|aqua|turquoise|teal|columbia|steel)\b/i, 'Blue'],
  [/\b(green|olive|sage|mint|basil|asparagus|emerald|jade|fern|moss|pista|lime)\b/i, 'Green'],
  [/\b(pink|rose|blush|fuchsia|magenta|flamingo|salmon|coral|peach)\b/i, 'Pink'],
  [/\b(red|maroon|wine|burgundy|cherry|scarlet|crimson|cosmos)\b/i, 'Red'],
  [/\b(yellow|gold|goldenrod|mustard|citrine|amber|ochre|ocher)\b/i, 'Yellow'],
  [/\b(brown|coffee|chocolate|oak|walnut|rust|terracotta|tan|camel|taupe|khaki|beige|sand)\b/i, 'Brown'],
  [/\b(orange|apricot|marigold|tangerine|papaya)\b/i, 'Orange'],
  [/\b(purple|violet|lavender|lilac|plum|mauve|orchid)\b/i, 'Purple'],
  [/\b(grey|gray|charcoal|slate|smoke)\b/i, 'Grey'],
  [/\b(black|onyx|jet)\b/i, 'Black'],
  [/\b(white|ivory|cream|off.?white|pearl)\b/i, 'White'],
];
function palFamily(color) {
  const c = String(color || '');
  for (const [re, f] of PAL_FAMILIES) if (re.test(c)) return f;
  return '';
}
/**
 * The group a design is in — what was DECIDED, and nothing else.
 *
 * Ravi, 2026-09-23: "delete this data i will fill manualy — brand design group, then uske bad tum
 * auto fill krna data".
 *
 * It used to guess from the colour's name: "Agate Green" became "CPC Green", "Light Steel Blue"
 * became "RBP Blue". Nothing was ever saved — pt_colorGroups was empty — so every group on that
 * screen was a guess wearing the clothes of a decision, and a guess is the one thing a printer
 * allocation cannot be built on. Which colours print together is a judgement about blocks and
 * shades that only somebody who prints them can make.
 *
 * So the column starts empty and waits. Everything to the right of it — SKUs, ordered, to make,
 * share, sold in 90 days, who is printing it now — fills itself from the order book as it always
 * did, grouped or not.
 */
function palGroupOf(brand, color) {
  const saved = ((PAL.groups || {}).map || {})[palKey(brand, color)];
  return saved != null && String(saved).trim() ? String(saved).trim() : '';
}

/** Blocks one printer needs to print this design, as fed in. */
const palBlocksNeed = key => palNum(((PAL.need || {}).map || {})[key]);
/** What Ravi feeds per design beside it: { cur: blocks made so far, status, printer: vendor code or name }. */
const palInfoOf = key => (((PAL.need || {}).info || {})[key]) || {};
/** The printers a design can be assigned to: the vendor master's printers, then any on this tab's list without one. */
function palAssignable() {
  const out = [], seen = new Set();
  voAllVendors().filter(v => /print/i.test(String(v.category || ''))).forEach(v => {
    const code = String(v.code || '').toUpperCase(); if (!code || seen.has(code)) return;
    seen.add(code); out.push([code, (v.desc || v.name || code) + ' · ' + code]);
  });
  (PAL.printers || []).forEach(p => { const c = palVendorOf(p); const k = c || String(p.name || '').trim();
    if (k && !seen.has(k.toUpperCase())) { seen.add(k.toUpperCase()); out.push([k, p.name || k]); } });
  return out;
}
/** A printer as typed on a sheet — a code or a name — to the value the dropdown keeps. '' when nobody matches. */
function palAssignPick(text) {
  const t = String(text || '').trim(); if (!t) return '';
  const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hit = palAssignable().find(([v, l]) => norm(v) === norm(t) || norm(l) === norm(t) || norm(String(l).split(' · ')[0]) === norm(t));
  return hit ? hit[0] : null;
}
const palAssignName = v => { const h = palAssignable().find(x => x[0] === v); return h ? String(h[1]).split(' · ')[0] : (v || ''); };
/** The status words offered; anything else typed is kept as typed. */
const PAL_STATUS = ['Blocks ready', 'Blocks to make', 'Blocks with printer', 'Sampling', 'Approved', 'Printing', 'On hold'];
/** Blocks a printer already holds for one design. */
const palBlocksHave = (printerKey, designKey) => palNum(((PAL.have || {})[printerKey] || {})[designKey]);

/** The replenishment snapshot for a brand, if this session has read one. It is declared far above
 *  this block, so it is reached for carefully rather than assumed to exist. */
const palSnap = b => { try { return (REPL[b] && REPL[b].rows) || []; } catch (e) { return []; } };

const palPrinters = () => (PAL.printers || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
const palPrinterOf = key => (PAL.printers || []).find(p => p.key === key) || null;

/** Every print design in the master, with the work it owes, who prints it now, and what it sells. */
function palDesigns() {
  const out = new Map();
  const touch = (brand, color) => {
    const k = palKey(brand, color);
    if (!out.has(k)) out.set(k, { key: k, brand: palBrandOf(brand), color: String(color || '').trim(),
      skus: 0, ordered: 0, toMake: 0, l90: 0, l30: 0, now: new Map() });
    return out.get(k);
  };
  (PTG.mdb || []).forEach(r => { const c = String(r.color || '').trim(); if (c) touch(r.brand, c).skus++; });

  ordLines().forEach(l => {
    const m = mdbOf(l.sku) || {};
    const color = String(m.color || l.color || '').trim();
    if (!color) return;
    const e = touch(m.brand || '?', color);
    e.ordered += palNum(l.qty);
    const left = palNum(l.pendingMake);
    e.toMake += left;
    /* Who is printing this colour today, weighted by the pieces still open on their lines — a printer
     * who already has the blocks is the cheapest place to put more of the same colour. */
    if (l.printer && left > 0) e.now.set(l.printer, (e.now.get(l.printer) || 0) + left);
  });

  /* Sales are a nice-to-have here: the snapshot is read per brand, on demand, and a brand nobody has
   * refreshed this session simply shows no units rather than a wrong zero dressed up as a fact. */
  ['SP', 'CPC'].forEach(b => {
    palSnap(b).forEach(r => {
      const m = mdbOf(r.sku) || {};
      const color = String(m.color || r.color || '').trim();
      if (!color) return;
      const e = touch(m.brand || (b === 'CPC' ? 'CPC' : 'RBP'), color);
      e.l90 += palNum(r.last90);
      e.l30 += palNum(r.last30);
    });
  });

  return [...out.values()].map(d => {
    /* A DESIGN NOBODY IS CONTINUING STOPS BEING WORK, BUT DOES NOT STOP BEING A ROW. Its outstanding
     * pieces are kept as an open figure — somebody will ask how much was still on order when it was stopped,
     * and a row that vanished cannot answer. */
    const live = palLiveOf(d.key);
    return Object.assign(d, {
      live, open: d.toMake, toMake: live ? d.toMake : 0,
      group: palGroupOf(d.brand, d.color),
      blocks: palBlocksNeed(d.key),
    });
  }).sort((a, b) => b.toMake - a.toMake || b.skus - a.skus);
}

/** The designs gathered into the buckets a printer is actually given. */
/** Every colour group there is, for the printer form to offer. */
/**
 * The group names to offer while typing — every one that has been DECIDED, on a design or on a
 * printer.
 *
 * Nothing is guessed from a colour's name any more, so on a fresh start this list is short and the
 * box simply takes what is typed. A name a printer was given counts: somebody wrote it there, and
 * having to retype it exactly is how one group becomes two.
 */
function palGroupNames() {
  const names = new Set();
  palGroups().forEach(g => { if (g.grouped) names.add(g.name); });
  (PAL.printers || []).forEach(p => (p.groups || []).forEach(n => {
    const v = String(n || '').trim();
    if (v && !/ — ungrouped$/.test(v)) names.add(v);
  }));
  return [...names].sort((a, b) => a.localeCompare(b));
}

function palGroups(designs) {
  const g = new Map();
  (designs || palDesigns()).forEach(d => {
    const name = d.group || `${d.brand} — ungrouped`;
    if (!g.has(name)) g.set(name, { name, brand: d.brand, grouped: !!d.group, designs: [],
      skus: 0, ordered: 0, toMake: 0, l90: 0, blocks: 0, now: new Map() });
    const e = g.get(name);
    if (e.brand !== d.brand) e.brand = 'mixed';
    e.designs.push(d);
    e.skus += d.skus; e.ordered += d.ordered; e.toMake += d.toMake; e.l90 += d.l90;
    e.blocks += d.blocks;
    d.now.forEach((pcs, who) => e.now.set(who, (e.now.get(who) || 0) + pcs));
  });
  return [...g.values()].sort((a, b) => b.toMake - a.toMake);
}

/** Blocks this printer holds towards one group, and what the group takes in all. */
function palGroupBlocks(printerKey, group) {
  let have = 0;
  group.designs.forEach(d => { have += palBlocksHave(printerKey, d.key); });
  return { need: group.blocks, have };
}

/** A printer already printing the colour, or already holding its blocks, is the cheapest to load. */
