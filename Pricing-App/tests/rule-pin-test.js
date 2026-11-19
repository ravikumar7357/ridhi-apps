/* THE RULE RESULTS ARE PINNED (18 Nov 2026): Fix all (fix-all.js, kw-fix.js, title-fix.js) only adds buttons — it must never change what
 * a Listing Rules rule finds. On one mixed mock catalogue (1,000 listings in 100 families: napkins, tablecloths, runners, pillows; good
 * titles, sizes without a unit, "Inches", reversed dimensions, no Block Print, too long, the brand after the product, too short; a live
 * read whose title is not the snapshot's, Block Print in the bullets, search terms over the limit, nothing in stock):
 *   1. every rule's count, Listing Health's levels, the Workspace's failing check columns and the Fix all block's rows are the numbers
 *      written below (PINNED — worked out with the code of origin/dev, before Fix all titles);
 *   2. every listing's findings are the very ones the code of commit 6cb5e48 (the commit before) finds — listing by listing (when git
 *      can show that commit here).
 *   node tests/rule-pin-test.js            → the test
 *   node tests/rule-pin-test.js --print    → the counts with the code now (to write new pins after a rule change that is MEANT)
 * Exports mixedPage(files) and ruleCounts(C) for comparing revisions. */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { load } = require('./listing-rules-test.js');

const BEFORE = '6cb5e48';   // devA before Fix all titles (and the merge base with origin/dev)
const PRODUCTS = [
  { sub: 'Napkin Set', sizes: ['18x18', '20x20', '14x20'], good: (b, s, c) => `${b} Cloth Napkins 100% Cotton ${s} Inch Block Print - ${c}`, word: 'Cloth Napkins' },
  { sub: 'Rectangle Tablecloth', sizes: ['60x90', '60x120', '70x70'], good: (b, s, c) => `${b} Tablecloth Rectangle 100% Cotton ${s} Inch Block Print - ${c}`, word: 'Tablecloth' },
  { sub: 'Table Runner', sizes: ['14x72', '14x90', '13x108'], good: (b, s, c) => `${b} Table Runner 100% Cotton ${s} Inch Block Print - ${c}`, word: 'Table Runner' },
  { sub: 'Pillow Cover', sizes: ['18x18', '20x20', '12x20'], good: (b, s, c) => `${b} ${c} Block Print Throw Pillow Cover ${s} Inch`, word: 'Throw Pillow Cover' },
];
const COLORS = ['Blue', 'Red', 'Sage Green', 'Mustard', 'Navy', 'Rust', 'Off White', 'Teal', 'Pink', 'Grey', 'Indigo Blue and Rust Orange'];
const sz = s => s.replace('x', ' x ');
// The title of listing i: one of twelve kinds (0–4 good, then each problem in turn).
function titleOf(i, b, p, s, c) {
  const [w, h] = s.split('x');
  switch (i % 12) {
    case 5: return p.good(b, sz(s), c).replace(`${sz(s)} Inch`, s);                                   // no unit, no spaces
    case 6: return p.good(b, sz(s), c).replace(`${sz(s)} Inch`, `${sz(s)} Inches`);                   // "Inches"
    case 7: return p.good(b, sz(s), c).replace(`${sz(s)} Inch`, `${h} x ${w} Inch`);                  // reversed (a square stays the same)
    case 8: return p.good(b, sz(s), c).replace(' Block Print', '');                                   // no Block Print
    case 9: return p.good(b, sz(s), c).replace(' Block Print', ' Block Print Reusable for Kitchen Party Wedding Holiday Dining');   // too long
    case 10: return p.good(b, sz(s), c).replace(`${b} ${p.word}`, `${p.word} by ${b}`);               // the brand after the product
    case 11: return `${b} ${p.word} ${sz(s)} - ${c}`;                                                  // too short, parts missing
    default: return p.good(b, sz(s), c);
  }
}
/** A stub page (the rules, the Workspace, the planner, Fix all) over the mixed catalogue. `files`: another revision's listing files. */
function mixedPage(files, extra) {
  const C = load(Object.assign({ ws: true, sp: true, fa: true, files }, extra || {}));
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.SP.today = new Date(2026, 6, 15);           // no occasion on: no season word in the way
  C.FA.log = [];
  const now = Date.now();
  ['SP', 'CPC'].forEach(brand => {
    C.HEALTH[brand].rows.length = 0;
    const cat = {};
    const n = brand === 'SP' ? 600 : 400;
    const name = brand === 'SP' ? 'Ridhi' : 'Whimsical Corner';
    for (let i = 0; i < n; i++) {
      const fam = Math.floor(i / 10);
      const p = PRODUCTS[fam % PRODUCTS.length];
      const s = p.sizes[i % p.sizes.length], c = COLORS[(i * 7 + fam) % COLORS.length];
      const sku = `${brand}-M${String(i).padStart(4, '0')}`;
      const title = titleOf(i + fam, name, p, s, c);
      C.HEALTH[brand].rows.push({ brand, parent: `${brand}F${fam}`, sku, asin: 'B0' + brand + String(i).padStart(6, '0'), title, qty: i % 13 === 0 ? 0 : 6, price: 20, status: 'Active', channel: 'AFN',
        aplus: i % 5 !== 0, aplusAt: now, checked: now, content: { titleLen: title.length, images: i % 17 === 0 ? 4 : 8, bullets: 5, descLen: 300, title } });
      cat[sku] = { color: c, size: s, subcat: p.sub };
      const kw = i % 9 === 0 ? Array.from({ length: 45 }, (_, k) => 'word' + k).join(' ') : 'cotton dining';
      const live = { at: now, cAt: now, pt: 'NAPKIN', title, titleLen: title.length, catTitle: title, tAt: now, kw, kwBytes: Buffer.byteLength(kw.replace(/[\s;,.]+/g, '')), bul: 5, desc: 300 };
      if (i % 7 === 0) live.catTitle = p.good(name, sz(s), c);                           // what shoppers see is not our snapshot's title
      if (i % 11 === 0) live.words = { bp: true };                                        // Block Print in its bullets
      C.LI_WS.live[brand][sku] = live;
    }
    C.setCat(brand, cat);
  });
  C.LI_WS.liveV++;
  C.reset();
  return C;
}
// OUR TITLE FORMAT (20 Nov 2026, the manager's decision): the only checks it changes — their counts are re-pinned below, nothing else
const TITLE_FORMAT_DETS = ['title_template', 'size_format'];
const TITLE_FORMAT_KEYS = ['Title mistake', 'Title doesn\'t follow template', 'Size formatting inconsistent', 'tpl'];
/** Every count the screens show: per rule (Listing Health's findings), per level, the Workspace's failing columns, Fix all's rows. */
function ruleCounts(C) {
  const out = { rules: {}, levels: {}, workspace: {}, fixAllRows: {}, perListing: [], perLevel: [] };
  const hc = C.hCtx();
  ['SP', 'CPC'].forEach(brand => {
    const rows = C.HEALTH[brand].rows;
    rows.forEach(row => {
      const h = C.healthOf(Object.assign({}, row, { brand }), hc);
      out.levels[h.bucket] = (out.levels[h.bucket] || 0) + 1;
      h.found.forEach(hit => { out.rules[hit.name] = (out.rules[hit.name] || 0) + 1; });
      // the title-format checks (title_template, size_format) apart: perListing = every other finding, perLevel = the level and theirs
      const tf = h.found.filter(hit => TITLE_FORMAT_DETS.includes(hit.detector));
      out.perListing.push(brand + '|' + row.sku + ': ' + h.found.filter(hit => !TITLE_FORMAT_DETS.includes(hit.detector)).map(hit => `${hit.id}/${hit.sev}/${hit.detail}`).join(' | '));
      out.perLevel.push({ k: brand + '|' + row.sku, bucket: h.bucket, title: tf.map(hit => hit.sev).sort().join() });
      const kid = C.liWsChildKept(row, brand, hc, new Map(), Date.now());
      Object.entries(kid.c || {}).forEach(([k, c]) => { if (c && c.pass === false) out.workspace[k] = (out.workspace[k] || 0) + 1; });
    });
    // the Fix all block: each row's children (the number its row shows), summed over the families
    [...new Set(rows.map(r => r.parent))].forEach(parent => {
      C.faGroups(brand, parent, C.faKids(brand, parent)).forEach(g => { out.fixAllRows[g.name] = (out.fixAllRows[g.name] || 0) + g.kids.length; });
    });
  });
  return out;
}

/* ---- the pins: worked out with the code of origin/dev (before Fix all titles), 18 Nov 2026 ---- */
const PINNED = {"rules":{"Secondary images missing":60,"Search terms over the limit":112,"Title slightly under-optimized":497,"Size formatting inconsistent":203,"Variation naming inconsistent":138,"Important title keyword missing":127,"Title doesn't follow template":119,"Dimension order inconsistent":48,"Amazon shows a different title from yours — yours is not live":78},"levels":{"action":476,"healthy":227,"review":220,"monitor":22,"critical":55},"workspace":{"stock":78,"img":60,"kw":112,"title":578,"other":251,"tpl":119},"fixAllRows":{"Search terms over the limit":112,"Size formatting inconsistent":203,"Title too long":276,"Important title keyword missing":127,"Secondary images missing":60,"Title slightly under-optimized":221,"Variation naming inconsistent":138,"Dimension order inconsistent":48,"Title doesn't follow template":119,"Amazon shows a different title from yours — yours is not live":78}};
/* OUR TITLE FORMAT (20 Nov 2026): only the title-format checks re-pinned — "Title doesn't follow template" (119) is now "Title mistake"
 * (211: real mistakes only — spelling, a shape the size contradicts, a missing part incl. "Inch", a repeat), "Size formatting
 * inconsistent" 203 → 65 ("Missing Inch" moved to Title mistake; "54x54 Inch" is our format); the levels move with them. Every other
 * number stays the pin above. */
Object.assign(PINNED.rules, { 'Title mistake': 211, "Title doesn't follow template": 0, 'Size formatting inconsistent': 65 });
Object.assign(PINNED.fixAllRows, { 'Title mistake': 211, "Title doesn't follow template": 0, 'Size formatting inconsistent': 65 });
Object.assign(PINNED.workspace, { tpl: 211 });
Object.assign(PINNED.levels, { action: 483, healthy: 225, review: 217, monitor: 20 });   // was 476 / 227 / 220 / 22 (critical 55 the same)

if (require.main === module) {
  const C = mixedPage();
  const now = ruleCounts(C);
  if (process.argv.includes('--print')) {
    const { perListing, perLevel, ...counts } = now;
    console.log(JSON.stringify(counts));
    process.exit(0);
  }
  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
  const diff = (a, b) => [...new Set(Object.keys(a).concat(Object.keys(b)))].filter(k => (a[k] || 0) !== (b[k] || 0)).map(k => `${k}: ${b[k] || 0} pinned → ${a[k] || 0} now`).join(' · ');
  console.log('== the counts are the pinned ones (origin/dev, before Fix all titles) ==');
  ok(`every rule's count (${Object.keys(PINNED.rules).length} rules)`, !diff(now.rules, PINNED.rules), diff(now.rules, PINNED.rules));
  ok('Listing Health\'s levels', !diff(now.levels, PINNED.levels), diff(now.levels, PINNED.levels));
  ok('the Workspace\'s failing check columns', !diff(now.workspace, PINNED.workspace), diff(now.workspace, PINNED.workspace));
  ok('the Fix all block\'s rows (children per problem row, all families)', !diff(now.fixAllRows, PINNED.fixAllRows), diff(now.fixAllRows, PINNED.fixAllRows));
  console.log('== every listing\'s findings = the code of ' + BEFORE + ' (before) ==');
  const DIR = path.join(__dirname, '..', 'src', 'app', 'listing');
  let old = null;
  try {
    old = {};
    fs.readdirSync(DIR).filter(f => f.endsWith('.js')).forEach(f => {
      try { old[f] = cp.execSync(`git show ${BEFORE}:Pricing-App/src/app/listing/${f}`, { cwd: path.join(__dirname, '..', '..'), maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); }
      catch (e) { old[f] = ''; }               // a file that commit did not have (title-fix.js, aplus-audit.js…)
    });
    if (!old['listing-rules.js']) old = null;
  } catch (e) { old = null; }
  if (!old) ok('(git cannot show commit ' + BEFORE + ' here — the pinned numbers above stand alone)', true);
  else {
    const was = ruleCounts(mixedPage(old));
    // OUR TITLE FORMAT (20 Nov 2026): the two title checks it changed (title_template, size_format) are set aside; every OTHER finding of
    // every listing must be the same, and the level too wherever its title findings' levels are the same
    const bad = now.perListing.filter((line, i) => line !== was.perListing[i]);
    ok(`all ${now.perListing.length} listings: the same findings (rule, level, detail) — the title-format checks set aside`, !bad.length && now.perListing.length === was.perListing.length, bad.slice(0, 3).join(' ‖ ') + ' ‖ was: ' + was.perListing.find(l => bad[0] && l.startsWith(bad[0].split(':')[0])));
    const lvl = now.perLevel.filter((x, i) => x.title === was.perLevel[i].title && x.bucket !== was.perLevel[i].bucket);
    ok('…and the same level wherever its title-format findings are the same', !lvl.length, lvl.slice(0, 3).map(x => x.k + ': ' + x.bucket).join(' ‖ '));
    const notTitle = o => Object.fromEntries(Object.entries(o).filter(([k]) => !TITLE_FORMAT_KEYS.includes(k)));
    ok('…and the same counts everywhere else (rules, Workspace columns, Fix all rows — the title-format ones set aside)', JSON.stringify([now.rules, now.workspace, now.fixAllRows].map(notTitle)) === JSON.stringify([was.rules, was.workspace, was.fixAllRows].map(notTitle)));
    console.log('  (title-format counts, before → after: ' + TITLE_FORMAT_KEYS.map(k => [now.rules, now.workspace].map(o => o[k]).some(v => v !== undefined) || was.rules[k] !== undefined || was.workspace[k] !== undefined
      ? `${k} ${(was.rules[k] || was.workspace[k] || 0)} → ${(now.rules[k] || now.workspace[k] || 0)}` : '').filter(Boolean).join(' · ') + ' · levels ' + JSON.stringify(was.levels) + ' → ' + JSON.stringify(now.levels) + ')');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
module.exports = { mixedPage, ruleCounts, PINNED };
