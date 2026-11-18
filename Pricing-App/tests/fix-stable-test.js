/* The Fix all buttons stay (fix-all.js / title-fix.js, 18 Nov 2026 — the "Tablecloth Main" bug: the buttons showed for ~2 s, then
 * "Working out the fixes for 469 children…" came back, again and again).
 *   node tests/fix-stable-test.js
 * On the full-size mock catalogue (tests/smooth-bench.js; the biggest parent TM, 490 children, every one with a title fix), in a
 * browser-like page (the block works out its fixes in slices):
 *   - what used to throw every plan away changes nothing now: a read landing for a listing of ANOTHER family (LI_WS.liveV), a spec
 *     value read elsewhere (FA.valsV), a ListingMatch record noted (LM.ov), the minute ticking (the Workspace makes new child records);
 *   - a child of the family that really changed is worked out again ALONE (every other plan the very same object), and the console says
 *     which child and why; the block stays drawn — never "Working out the fixes…" again, its buttons always there (no flashing);
 *   - many children changing at once: the old block (with its buttons) stays while they are redone, with one quiet "Updating" line;
 *   - opening a parent or expanding it reads nothing from Amazon (no A+ one by one either: "not checked yet"); "Read from Amazon now"
 *     (Read again) does. */
const { bigPage } = require('./smooth-bench.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < (ms || 60000)) await sleep(2); return cond(); };

function page() {
  const doc = { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ click() {} }), body: {} };
  const C = bigPage({ load: { ctx: { requestAnimationFrame: () => 0, document: doc } } });
  const now = Date.now();
  ['SP', 'CPC'].forEach(b => Object.entries(C._cat[b]).forEach(([sku, c]) => C.TT.read.set(b + '|' + sku, { va: { color: c.color, size: c.size, material: 'Cotton', item_shape: 'Rectangle' }, pt: 'TABLECLOTH', at: now })));
  C.TT.readV++;
  return C;
}
// The console's "[Fix all] …" lines while fn runs.
async function told(fn) {
  const was = console.info, out = [];
  console.info = (...a) => out.push(a.join(' '));
  try { await fn(); } finally { console.info = was; }
  return out;
}
const plansOf = C => new Map(C.ttFamily('SP', 'TM'));
// A live read landing for one listing: its entry changed in place (as liWsJob does), the shared counter bumped (as liWsPump does).
function liveRead(C, sku, change) {
  const e = C.LI_WS.live.SP[sku];
  Object.assign(e, { at: Date.now() + 1, cAt: Date.now() + 1 }, change || {});
  C.LI_WS.liveV++;
}
const busy = html => /Working out the fixes/.test(html);

(async () => {
  const C = page();
  console.log('== the block of the biggest parent, worked out once ==');
  C.faBlockHtml('SP', 'TM');
  await until(() => !C.FA_W.pri);
  const B1 = C.faBlockHtml('SP', 'TM');
  const P1 = plansOf(C);
  ok('its Fix all buttons are there', !busy(B1) && /Fix all 490 children/.test(B1), strip(B1).slice(0, 200));
  await until(() => !C.FA_W.running && !C.FA_W.bg.length, 120000);      // the background done too: nothing else is moving

  console.log('== unrelated changes: nothing is thrown away ==');
  {
    const other = C.HEALTH.SP.rows.find(r => r.parent !== 'TM').sku;
    let html = '';
    const lines = await told(() => {
      liveRead(C, other, { catTitle: C.LI_WS.live.SP[other].catTitle + ' Extra' });   // a read for a listing of ANOTHER family
      C.FA.valsV++;                                                                     // a spec value read elsewhere
      C.LM = C.LM || null;
      html = C.faBlockHtml('SP', 'TM');
    });
    const P2 = plansOf(C);
    ok(`a read for ${other} (another family) and a spec value read elsewhere: the block is the very same, at once — no "Working out", no "Updating"`, html === B1, strip(html).slice(0, 160));
    ok('…every one of the 490 plans is the very same object (nothing worked out again)', [...P1].every(([sku, p]) => P2.get(sku) === p));
    ok('…and the console says nothing about this family', !lines.some(l => /Parent TM/.test(l)), lines.join(' | '));
    // the minute ticks: the Workspace makes a new record for every child (its "read N min ago" texts) — the plans do not care
    const realNow = Date.now;
    Date.now = () => realNow() + 61000;
    let h2;
    try { h2 = C.faBlockHtml('SP', 'TM'); } finally { Date.now = realNow; }
    ok('a minute later (a new child record for each of the 490): the same block at once', h2 === B1 && !C.FA_W.pri && [...P1].every(([sku, p]) => plansOf(C).get(sku) === p));
  }

  console.log('== one child of the family really changed: it alone is worked out again ==');
  {
    const kid = 'SP-00007';
    const before = P1.get(kid);
    let html = '';
    const lines = await told(() => {
      liveRead(C, kid, { catTitle: C.LI_WS.live.SP[kid].catTitle + ' Holiday' });
      html = C.faBlockHtml('SP', 'TM');
    });
    const P3 = plansOf(C);
    ok('the block is drawn at once (redone in the draw itself): no "Working out", no "Updating", its buttons there', !busy(html) && !/Updating the fixes/.test(html) && /Fix all 490 children/.test(html) && !C.FA_W.pri);
    ok(`${kid} has a new plan; the other 489 are the very same objects`, P3.get(kid) !== before && [...P1].filter(([sku]) => sku !== kid).every(([sku, p]) => P3.get(sku) === p),
      [...P1].filter(([sku, p]) => sku !== kid && P3.get(sku) !== p).length + ' others changed');
    ok('…its new plan follows its new title (the current title in the plan)', /Holiday$/.test(P3.get(kid).before), P3.get(kid).before);
    ok('the console names the trigger: "[Fix all] Parent TM: 1 of 490 children changed — SP-00007 (a live Amazon read landed) — only they are worked out again"',
      lines.some(l => l === '[Fix all] Parent TM: 1 of 490 children changed — SP-00007 (a live Amazon read landed) — only they are worked out again'), lines.join(' | '));
    ok('…once: drawn again, it says nothing more', (await told(() => { C.faBlockHtml('SP', 'TM'); })).length === 0);
  }

  console.log('== many children changed at once: the old block stays while they are redone ==');
  {
    const kids = C.HEALTH.SP.rows.filter(r => r.parent === 'TM').slice(100, 220).map(r => r.sku);
    const P4 = plansOf(C);
    const B2 = C.faBlockHtml('SP', 'TM');
    kids.forEach(sku => { const e = C.LI_WS.live.SP[sku]; Object.assign(e, { at: Date.now() + 2, cAt: Date.now() + 2, catTitle: e.catTitle + ' Sale' }); });
    C.LI_WS.liveV++;
    // the reads of 120 children landed: drawn again and again while it works — every draw has the buttons, none says "Working out"
    const draws = [];
    const lines = await told(async () => {
      draws.push(C.faBlockHtml('SP', 'TM'));
      while (C.FA_W.pri) { draws.push(C.faBlockHtml('SP', 'TM')); await sleep(5); }
      draws.push(C.faBlockHtml('SP', 'TM'));
    });
    ok(`every draw while it works (${draws.length}) shows the Fix all buttons; none says "Working out the fixes…" (no flashing)`, draws.every(h => /Fix all \d+ children/.test(h) && !busy(h)));
    ok('…the ones while it works are the last block with one quiet line at its end', draws.length >= 2 && draws.slice(0, -1).every(h => /Updating the fixes that changed…/.test(h) && h.startsWith(B2.slice(0, -'</section>'.length))),
      strip(draws[0]).slice(-120));
    ok('…and the last is the full block again, without that line', !/Updating the fixes/.test(draws[draws.length - 1]) && /Fix all 490 children/.test(draws[draws.length - 1]));
    const P5 = plansOf(C);
    const kept = [...P4].filter(([sku, p]) => !kids.includes(sku) && P5.get(sku) === p).length;
    ok(`the 120 changed children redone; the other ${490 - 120} kept as they were`, kept === 490 - 120 && kids.every(sku => P5.get(sku) !== P4.get(sku)), `${kept} kept`);
    ok('the console: "120 of 490 children changed"', lines.some(l => /\[Fix all\] Parent TM: 120 of 490 children changed — SP-00100 \(a live Amazon read landed\)/.test(l)), lines.join(' | '));
  }

  console.log('== opening or showing a parent reads nothing from Amazon ==');
  {
    C.el('hBrandView').value = 'SP';
    C.LI_WS.on = true; C.LI_WS.mode = 'all'; C.LI_WS.card = ''; C.LI_WS.chip = 'all';
    C.liWsRender();
    const q0 = C.LI_WS.q.length, in0 = C.LI_WS.inflight;
    const p = C.LI_WS.byKey.get('SP|TM');
    // the kids have reads older than a day — opening used to queue content, status and picture reads for each, and A+ one by one
    p.kids.forEach(kid => { const e = C.LI_WS.live.SP[kid.sku]; if (e) Object.assign(e, { cAt: 1, gAt: 1, iAt: 1 }); });
    C.liWsPanelOpen('SP|TM');
    ok('opening the panel of a parent whose reads are old: nothing queued, nothing in flight', C.LI_WS.q.length === q0 && C.LI_WS.inflight === in0 && !C.LI_WS.prog['SP|TM'], `${C.LI_WS.q.length} queued`);
    ok('no A+ read one by one on its own (the daily A+ read not deployed / not fresh) — only when a person asks', C.liWsAplusJobs('SP', 'TM', p.kids, 'SP|TM', false) === 0 && C.LI_WS.q.length === q0);
    const row = Object.assign({}, C.HEALTH.SP.rows[0]);
    delete row.aplus; delete row.aplusAt;
    ok('…A+ there says "not checked yet" (not an error)', C.healthOf(row, C.hCtx()).aplus.why === 'A+ not checked yet' && !C.healthOf(row, C.hCtx()).found.some(h => h.detector === 'aplus_missing'));
    C.liWsPanelClose(false);
    C.liWsReadParentFn(p, true, true);
    ok('"Read from Amazon now" / Read again reads (force): the children and A+ queued', !!C.LI_WS.prog['SP|TM'] && C.LI_WS.prog['SP|TM'].total >= 490 * 4, String(C.LI_WS.prog['SP|TM'] && C.LI_WS.prog['SP|TM'].total));
    C.LI_WS.q.length = 0;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50);
})();
