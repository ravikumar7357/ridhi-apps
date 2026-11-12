/* Season planner: WHERE the season word is (12 Nov 2026) — the title, Item Highlights and the hidden search words, for every listing,
 * "Up to date" ones too; the matching; the optional "Add to Item Highlights" tip.
 *   node tests/season-where-test.js */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const NOV = new Date(2026, 10, 12);
const FULL = 'Ridhi Rectangle Tablecloth 60 x 90 Inch Dining Table Cover Ref No 001 - Red';   // 75: Christmas does not fit
const LONG = 'Ridhi Rectangle Tablecloth 60 x 90 Inch Dining Table Cover Ref No 001 Linen - Red';   // 81: over 75
const cloth = { color: 'Red', size: '60x90', subcat: 'Rectangle Tablecloth' };

function setup() {
  const C = load({ ws: true, sp: true });
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  ['SP', 'CPC'].forEach(b => {
    C.LI_WS.schema[b].TC_HL = { at: Date.now(), ok: [], hl: { items: 1, max: 125, bytes: 0 } };
    C.LI_WS.schema[b].TC_NONE = { at: Date.now(), ok: [], hl: { none: true } };
  });
  const put = (sku, title, parent) => {
    C.HEALTH.SP.rows.push({ brand: 'SP', parent: parent || 'PW', sku, asin: 'B0' + sku, title, qty: 5, price: 30, status: 'Active', channel: 'AFN', aplus: true, aplusAt: Date.now(), checked: Date.now(),
      content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } });
    C.setCat('SP', { [sku]: cloth });
  };
  const live = (sku, title, kw, pt, hl) => {
    const now = Date.now();
    C.LI_WS.live.SP[sku] = Object.assign({ at: now, cAt: now, pt, title, titleLen: title.length, catTitle: title, tAt: now, kw, kwBytes: kw == null ? 0 : C.lrKwBytes(kw) }, kw == null ? { cAt: 0 } : {},
      hl ? { gAt: now, hl, hlAt: now } : {});
    if (kw == null) delete C.LI_WS.live.SP[sku].kw;
    C.LI_WS.liveV++;
  };
  return { C, put, live };
}
const planOf = (C, sku) => { C.reset(); C.SP.itemsKey = ''; return C.spCompute(NOV).find(item => item.sku === sku); };
const text = rows => rows.map(r => r.text).join(' | ');

(async () => {
  console.log('== matching: whole words, any case, the other spellings ==');
  {
    const { C } = setup();
    const ev = C.spEvents(C.getLR(), NOV).find(e => e.ev.id === 'christmas').ev;
    const f = t => C.spFindSeason(t, ev);
    ok('"Christmas", "CHRISTMAS", "christmas"', f('Red Christmas Tablecloth') === 'Christmas' && f('RED CHRISTMAS') === 'CHRISTMAS' && f('red christmas') === 'christmas');
    ok('"Xmas" and "X-mas"', f('Xmas table decor') === 'Xmas' && f('X-mas table decor') === 'X-mas');
    ok('"Christmas-themed" and "Christmastime"', f('Christmas-themed napkins') === 'Christmas' && f('for Christmastime dinners') === 'Christmastime');
    ok('"Christmas\'s"', f("Christmas's table") === "Christmas's");
    ok('never inside another word ("Unchristmaslike", "Xmasx", "Christmasy")', !f('Unchristmaslike gift') && !f('Xmasx') && !f('Christmasy decor'));
  }

  console.log('== every listing shows the three places, "Up to date" ones too ==');
  {
    const { C, put, live } = setup();
    const T1 = 'Ridhi Rectangle Tablecloth 60 x 90 Inch Christmas Dining Table Cover - Red';
    put('W1', T1); live('W1', T1, 'dinner party', 'TC_HL', ['Hand block printed cotton']);
    const it = planOf(C, 'W1');
    const w = C.spWhere(it);
    ok('Christmas in the title: Up to date', it.kind === 'ok' && it.status === 'ok', it.kind);
    ok('…the three rows: ✓ Title “Christmas” found (74 of 75) · ✕ Item Highlights Christmas missing (25 of 125) · ✕ Hidden search words Christmas missing (11 of 249)',
      text(w.rows) === `✓ Title: “Christmas” found (${T1.length} of 75) | ✕ Item Highlights: Christmas missing (25 of 125) | ✕ Hidden search words: Christmas missing (11 of 249)`, text(w.rows));
    const kid = C.spKidHtml(it, null);
    ok('…the Up to date panel shows them, in the "What changes" style (✓ green, ✕ red)', /✓ Up to date/.test(kid) && (kid.match(/data-sp-where=/g) || []).length === 3
      && /<p class="sp-add" data-sp-where="title">✓ Title: “Christmas” found/.test(kid) && /<p class="sp-rem" data-sp-where="hl">✕ Item Highlights/.test(kid) && /class="sp-card2 sp-chg sp-where"/.test(kid), kid.slice(0, 300));
    // a listing with no season for it now (no template): still the three rows, with their counts
    put('W0', 'Ridhi Cotton Throw 50 x 60 Inch Soft Couch Blanket - Grey', 'PX');
    C.setCat('SP', { W0: { color: 'Grey', size: '50x60', subcat: 'Throw Blanket' } });
    live('W0', 'Ridhi Cotton Throw 50 x 60 Inch Soft Couch Blanket - Grey', 'blanket', 'TC_HL', []);
    const none = planOf(C, 'W0');
    ok('a listing with no season now: "Up to date" still shows the three rows', (C.spKidHtml(none, null).match(/data-sp-where=/g) || []).length === 3 && /no season word needed now/.test(C.spKidHtml(none, null)), none.kind);
    // a listing to change: the rows are there too
    put('W2', FULL); live('W2', FULL, 'dinner party', 'TC_HL', ['Hand block printed cotton']);
    const add = planOf(C, 'W2');
    ok('a listing with a change: the three rows too (✕ everywhere now; "What changes" shows where it goes)', add.place === 'hl' && (C.spKidHtml(add, null).match(/data-sp-where=/g) || []).length === 3);
  }

  console.log('== Up to date only in the hidden search words: the optional tip ==');
  {
    const { C, put, live } = setup();
    put('K1', FULL); live('K1', FULL, 'dinner party christmas', 'TC_HL', ['Hand block printed cotton']);
    put('K2', FULL); live('K2', FULL, 'dinner party', 'TC_HL', ['Hand block printed cotton']);   // a real change, for the counts
    let it = planOf(C, 'K1');
    ok('found only in the hidden search words: Up to date (found in one place), not a suggestion', it.kind === 'ok' && it.found.kw === 'christmas' && !it.found.title && !it.found.hl, JSON.stringify([it.kind, it.found]));
    ok('…the rows: ✕ title · ✕ Item Highlights · ✓ search words “christmas” found', /✓ Hidden search words: “christmas” found \(\d+ of 249\)/.test(text(C.spWhere(it).rows)) && /✕ Item Highlights: Christmas missing/.test(text(C.spWhere(it).rows)));
    const kid = C.spKidHtml(it, null);
    ok('…the tip with its button: "Shoppers can\'t see hidden search words — add “Christmas” to Item Highlights so it shows under the title" [Add to Item Highlights]',
      C.spTipOf(it) && /Shoppers can't see hidden search words — add “Christmas” to Item Highlights so it shows under the title\./.test(kid) && /data-sp-act="tip-hl" data-sp-key="SP\|K1">Add to Item Highlights</.test(kid));
    const g = C.spGroupOf('SP|PW');
    ok('the tip counts nowhere: Ready / OK? / By hand only count the real change (K2)', g.ready.length === 1 && g.ready[0].sku === 'K2' && !g.look.length && !g.fix.length && !g.todo.some(x => x.sku === 'K1'), JSON.stringify([g.ready.map(x => x.sku), g.todo.map(x => x.sku)]));
    // pressing it: the change is made for Item Highlights only, at the start, and goes through the same confirm window
    C.SP.tipAdd.add('SP|K1');
    it = planOf(C, 'K1');
    ok('[Add to Item Highlights] pressed: "Christmas table decor, hand block printed cotton", the title and search words unchanged', it.place === 'hl' && it.hlAfter[0] === 'Christmas table decor, hand block printed cotton' && it.after === FULL && it.kwAfter === 'dinner party christmas' && it.status === 'ready', JSON.stringify([it.place, it.hlAfter, it.status]));
    // title over 75: Item Highlights cannot be used — no tip
    put('K3', LONG); live('K3', LONG, 'dinner christmas', 'TC_HL', []);
    const over = planOf(C, 'K3');
    ok('title over 75: "Item Highlights: not available: title over 75", and no tip', over.kind === 'ok' && /· Item Highlights: not available: title over 75/.test(text(C.spWhere(over).rows)) && !C.spTipOf(over), text(C.spWhere(over).rows));
    // a product type without Item Highlights: no tip either
    put('K4', FULL); live('K4', FULL, 'dinner christmas', 'TC_NONE');
    const no = planOf(C, 'K4');
    ok('no Item Highlights for the product type: "not available for this product type", no tip', /Item Highlights: not available for this product type/.test(text(C.spWhere(no).rows)) && !C.spTipOf(no));
  }

  console.log('== not read yet: "checking…" ==');
  {
    const { C, put, live } = setup();
    put('R1', FULL);
    live('R1', FULL, null, 'TC_HL');
    const it = planOf(C, 'R1');
    const t = text(C.spWhere(it).rows);
    ok('Item Highlights and the hidden search words not read yet: "checking…" for both, with no count', /· Item Highlights: checking…/.test(t) && /· Hidden search words: checking…/.test(t), t);
  }

  console.log('== the parent panel: each child row says where ==');
  {
    const { C, put, live } = setup();
    const T1 = 'Ridhi Rectangle Tablecloth 60 x 90 Inch Christmas Dining Table Cover - Red';
    put('P1', T1); live('P1', T1, 'dinner', 'TC_HL', []);
    put('P2', FULL); live('P2', FULL, 'dinner christmas', 'TC_NONE');
    put('P3', FULL); live('P3', FULL, 'dinner', 'TC_HL', ['Christmas table decor, cotton']);
    put('P4', FULL); live('P4', FULL, 'dinner', 'TC_HL', ['Cotton']);
    C.reset(); C.SP.itemsKey = '';
    const g = C.spGroupOf('SP|PW');
    const body = C.spParentBodyHtml(g, false);
    const rowOf = sku => (body.match(new RegExp(`data-sp-key="SP\\|${sku}"[^]*?</div>`)) || [''])[0];
    ok('"✓ in title", "✓ in search words", "✓ in highlights" on the up-to-date rows', /✓ in title/.test(rowOf('P1')) && /✓ in search words/.test(rowOf('P2')) && /✓ in highlights/.test(rowOf('P3')), [rowOf('P1'), rowOf('P2'), rowOf('P3')].map(r => r.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).join(' || '));
    ok('…the up-to-date children are listed under "✓ 3 more listings are up to date." (folded), the one to change above', /<details class="sp-fold sp-uptodate"><summary class="sp-more-ok">✓ 3 more listings are up to date\.<\/summary>/.test(body) && body.indexOf('SP|P4') < body.indexOf('sp-uptodate'));
    ok('…the row to change says nothing found yet (no "✓ in")', !/✓ in /.test(rowOf('P4')));
    const n = C.spWhereCount().Ridhi;
    ok('the count per brand: Up to date 3 — in the title 1, in highlights 1, in search words only 1', n.upToDate === 3 && n.inTitle === 1 && n.inHighlightsNotTitle === 1 && n.inSearchWordsOnly === 1, JSON.stringify(n));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
