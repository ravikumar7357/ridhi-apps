/* The open parent's fixes first, then the rest of the brand (fix-all.js faWork, title-fix.js ttFamilyStep / ttRowsStep), on the
 * full-size mock catalogue (tests/smooth-bench.js: ~4,400 listings, the biggest parent "TM" with 490 children, every one with a title fix).
 *   node tests/fix-order-test.js
 * A parent panel opens → "Working out the fixes for 490 children of Parent TM…" (each child once) → that parent only, in slices → its
 * block with the Fix all buttons → THEN the brand's title list and every other parent in the background, the biggest first → the next
 * parent opens at once. A parent opened meanwhile goes first. The plans are the very ones a draw without slices makes; the page is never
 * held long. */
const { bigPage } = require('./smooth-bench.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < (ms || 60000)) await sleep(2); return cond(); };

// A browser-like page (requestAnimationFrame, document.body): the block works out its fixes in slices. Every listing's Amazon facts held.
function page(browser) {
  const doc = { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ click() {} }), body: {} };
  const C = bigPage(browser ? { load: { ctx: { requestAnimationFrame: () => 0, document: doc } } } : {});
  const now = Date.now();
  ['SP', 'CPC'].forEach(b => Object.entries(C._cat[b]).forEach(([sku, c]) => C.TT.read.set(b + '|' + sku, { va: { color: c.color, size: c.size, material: 'Cotton', item_shape: 'Rectangle' }, pt: 'TABLECLOTH', at: now })));
  C.TT.readV++;
  return C;
}
// The longest time the page was held between two turns, while `fn` runs (a ticker every turn).
function holdMeter() {
  let last = performance.now(), max = 0, on = true;
  const tick = () => { const t = performance.now(); max = Math.max(max, t - last); last = t; if (on) setTimeout(tick, 0); };
  setTimeout(tick, 0);
  return { stop: () => { on = false; return Math.round(max); } };
}
const famKeys = C => [...C.TT.fam.keys()].filter(k => k.startsWith('SP|'));
const plansText = (C, brand, parent) => JSON.stringify([...C.ttFamily(brand, parent).values()].map(p => [p.sku, p.ok, p.after, p.why, p.fixes]));

(async () => {
  console.log('== the open parent first ==');
  const C = page(true);
  const kids = C.faKids('SP', 'TM');
  const groups = C.faGroups('SP', 'TM', kids);
  const distinct = new Set(groups.flatMap(g => g.kids.map(k => k.sku))).size;
  const rowSum = groups.reduce((s, g) => s + g.kids.length, 0);
  const meter = holdMeter();
  const t0 = performance.now();
  const first = C.faBlockHtml('SP', 'TM');
  ok(`the block says "Working out the fixes for ${distinct} children of Parent TM…" — each child once (the rows hold ${rowSum})`, new RegExp(`⏳ Working out the fixes for ${distinct} children of Parent TM…`).test(strip(first)) && rowSum > distinct, strip(first).slice(-120));
  ok('…the three cards are there at once', /problems to fix first/.test(first) && /need attention/.test(first));
  ok('the open parent\'s job is the one under way; nothing in the background yet', C.FA_W.pri && C.FA_W.pri.key === 'SP|TM' && C.FA_W.bg.length === 0);
  let atDone = null;
  const done0 = C.FA_W.pri.done;
  C.FA_W.pri.done = () => { atDone = { ms: Math.round(performance.now() - t0), fams: famKeys(C), memo: !!(C.TT.memo && C.TT.memo.SP) }; done0(); atDone.bg = C.FA_W.bg.map(j => j.key); };
  await until(() => atDone);
  ok(`its fixes ready in ${atDone.ms} ms, worked out before any other parent's (only its family's titles kept)`, atDone.fams.length === 1 && atDone.fams[0] === 'SP|TM' && !atDone.memo, atDone.fams.join());
  const ready = C.faBlockHtml('SP', 'TM');
  ok('…then the block with its Fix all buttons', !/Working out the fixes/.test(ready) && (ready.match(/>Fix (?:all \d+ children|\d+ titles?)</g) || []).length >= 1, strip(ready).slice(0, 300));
  ok('then the background: the brand\'s title list first, then the other parents, the biggest first, the open one not again', atDone.bg[0] === 'SP|titles' && atDone.bg.length > 100 && !atDone.bg.includes('SP|TM')
    && (() => { const n = new Map(); C.HEALTH.SP.rows.forEach(r => n.set(r.parent, (n.get(r.parent) || 0) + 1)); const sizes = atDone.bg.slice(1).map(k => n.get(k.slice(3))); return sizes.every((s, i) => !i || s <= sizes[i - 1]); })(), atDone.bg.slice(0, 4).join());

  console.log('== a parent opened meanwhile goes first ==');
  await until(() => C.FA_W.bg.length < atDone.bg.length);      // looked at early: the biggest families are worked out first
  // a parent still waiting in the background whose block needs its fixes worked out in slices (OUR TITLE FORMAT, 20 Nov 2026: fewer title
  // problems per child, so the biggest waiting families are tried, biggest first, until one needs slices)
  const size = p => C.HEALTH.SP.rows.filter(r => r.parent === p).length;
  const waiting = C.FA_W.bg.slice(1).map(j => j.key.slice(3)).filter(p => !C.TT.fam.has('SP|' + p)).sort((x, y) => size(y) - size(x));
  const bgLeft = C.FA_W.bg.length;
  let other = null, h2 = '';
  for (const p of waiting) { const h = C.faBlockHtml('SP', p); if (/Working out the fixes/.test(strip(h))) { other = p; h2 = h; break; } }
  ok(`(a parent the background has not reached yet, big enough to need slices: ${other}, ${other && size(other)} children)`, !!other, waiting.slice(0, 5).map(p => p + ':' + size(p)).join(' '));
  let other2 = null;
  if (C.FA_W.pri) { const d = C.FA_W.pri.done; C.FA_W.pri.done = () => { other2 = { bg: C.FA_W.bg.length }; d(); }; }
  ok(`opening it: "Working out the fixes for … of Parent ${other}…", its job first`, /Working out the fixes for \d+ children of Parent /.test(strip(h2)) && C.FA_W.pri && C.FA_W.pri.key === 'SP|' + other, strip(h2).slice(-100));
  await until(() => other2);
  ok('…done while the background still had most of its work left', other2.bg > bgLeft - 5, `${other2.bg} left of ${bgLeft}`);
  ok('…its block ready', !/Working out/.test(C.faBlockHtml('SP', other)));

  console.log('== the rest of the brand, in the background ==');
  await until(() => !C.FA_W.running && !C.FA_W.bg.length, 120000);
  const hold = meter.stop();
  ok('all of it worked out: the brand\'s title list (Listing Errors) and every family with a title problem', C.TT.memo && C.TT.memo.SP
    && [...new Set(C.ttRows('SP').map(r => r.row.parent))].every(p => C.TT.fam.has('SP|' + p)), String(famKeys(C).length));
  ok(`the page was never held long: at most ${hold} ms between two turns (slices of 30 ms, background 12 ms)`, hold < 250, hold + ' ms');
  const big2 = [...new Set(C.HEALTH.SP.rows.map(r => r.parent))].filter(p => p !== 'TM' && p !== other).sort((a, b) => C.HEALTH.SP.rows.filter(r => r.parent === b).length - C.HEALTH.SP.rows.filter(r => r.parent === a).length)[0];
  const t1 = performance.now();
  const h3 = C.faBlockHtml('SP', big2);
  ok(`the next parent (${big2}) opens at once, its Fix all buttons there (${Math.round(performance.now() - t1)} ms)`, !/Working out/.test(h3) && /Fix all/.test(h3) && !C.FA_W.pri);
  ok('…and nothing starts again for the same rules and data', !C.FA_W.running && !C.FA_W.bg.length);

  console.log('== the same plans as a draw without slices ==');
  const D = page(false);
  ok('the biggest parent, the one opened meanwhile, the next one, and the brand\'s title list: the same, word for word',
    ['TM', other, big2].every(p => plansText(C, 'SP', p) === plansText(D, 'SP', p))
    && JSON.stringify(C.ttRows('SP').map(r => [r.row.sku, r.hits.map(h => h.id)])) === JSON.stringify(D.ttRows('SP').map(r => [r.row.sku, r.hits.map(h => h.id)])));
  ok('…and the Fix all block itself', C.faBlockHtml('SP', 'TM') === D.faBlockHtml('SP', 'TM'));
  ok('no page without slices (the tests\' stub pages) starts any background work', !D.FA_W.running && !D.FA_W.pri && !D.FA_W.bg.length && !D.FA_W.bgFor);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50);
})();
