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
    ok('not read and nothing on its way: "Not read yet" for both, with no count (never "0 of 249")', /· Item Highlights: Not read yet$|· Item Highlights: Not read yet \|/.test(t) && /· Hidden search words: Not read yet$/.test(t) && !/0 of 249/.test(t), t);
    C.SP.reading.add('SP|R1'); C.SP.reading.add('SP|R1|get');
    const t2 = text(C.spWhere(it).rows);
    ok('…and "checking…" while their reads are on the way', /· Item Highlights: checking…/.test(t2) && /· Hidden search words: checking…/.test(t2), t2);
  }

  console.log('== the four small fixes: one count, clear sizes, no room in title, never 0 for not read ==');
  {
    const { C, put, live } = setup();
    // 4 to change for Christmas (title full, no Item Highlights for the type: search words), 1 that only loses "Spring", 1 up to date
    for (let i = 1; i <= 4; i++) { put('N' + i, FULL); live('N' + i, FULL, 'dinner', 'TC_NONE'); }
    const SPR = 'Ridhi Rectangle Tablecloth 60 x 90 Inch Spring Table Decor Christmas - Red';
    put('N5', SPR); live('N5', SPR, 'dinner', 'TC_NONE');
    put('N6', FULL); live('N6', FULL, 'dinner christmas', 'TC_NONE');
    C.reset(); C.SP.itemsKey = '';
    const g = C.spGroupOf('SP|PW');
    const body = C.spParentBodyHtml(g, false);
    const n = g.ready.length + g.look.length + g.fix.length;
    ok(`ONE count: the sentence says ${n} — Ready + Needs your OK + Fix by hand (the "Spring" one included)`, n === 5 && new RegExp(`${n} of these 6 tablecloths don't mention it yet`).test(body), body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
    // while reading: "So far: … (reading x of y)"
    C.SP.prog = { key: 'SP|PW', items: new Map([['SP|N1', new Set(['SP|N1'])], ['SP|N2', new Set(['SP|N2'])], ['SP|N3', new Set(['SP|N3|get'])]]) };
    C.SP.reading.add('SP|N3|get');
    const reading = C.spParentBodyHtml(C.spGroupOf('SP|PW'), false);
    ok('while reading: "So far: 5 of these 6 tablecloths don\'t mention Christmas (reading 2 of 3)"', /So far: 5 of these 6 tablecloths don't mention Christmas \(reading 2 of 3\)\./.test(reading), reading.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 220));
    C.SP.reading.clear(); C.SP.prog = null;
    // clear sizes: search words empty on Amazon (read): "now 0 of 249, after adding 9 of 249"
    put('N7', FULL); live('N7', FULL, '', 'TC_NONE');
    const e7 = planOf(C, 'N7');
    const kwRow = C.spWhere(e7).rows.find(r => r.k === 'kw').text;
    ok('search words read and empty: "✕ Hidden search words: Christmas missing (now 0 of 249, after adding 9 of 249)"', kwRow === '✕ Hidden search words: Christmas missing (now 0 of 249, after adding 9 of 249)', kwRow);
    const T60 = 'Ridhi Rectangle Tablecloth 60 x 90 Inch Block Print - Red';
    put('N8', T60); live('N8', T60, 'dinner', 'TC_NONE');
    const e8 = planOf(C, 'N8');
    const tRow = C.spWhere(e8).rows.find(r => r.k === 'title').text;
    ok(`the title gets it: "✕ Title: Christmas missing (now ${T60.length} of 75, after adding ${e8.after.length} of 75)"`, e8.place === 'title' && tRow === `✕ Title: Christmas missing (now ${T60.length} of 75, after adding ${e8.after.length} of 75)`, tRow);
    // no room in title, in plain words
    const T69 = 'Ridhi Rectangle Tablecloth 60 x 90 Inch Dining Table Cover Linen - Red';
    put('N9', T69); live('N9', T69, 'dinner', 'TC_NONE');
    const e9 = planOf(C, 'N9');
    ok(`"No room in title: “Christmas” needs 10 letters, only ${75 - T69.length} left (${T69.length} of 75)"`, e9.placeLines[0] === `Title: Christmas missing — no room in title: “Christmas” needs 10 letters, only ${75 - T69.length} left (${T69.length} of 75)`, e9.placeLines[0]);
    // never "0 of 249" for a listing whose content was never read — even after a title was sent for it
    const T10 = 'Ridhi Rectangle Tablecloth 60 x 90 Inch Block Print Cotton - Red';
    put('N10', T10);
    C.LI_WS.live.SP.N10 = { at: Date.now(), gAt: Date.now(), pt: 'TC_NONE', catTitle: T10, tAt: Date.now() };   // a status read only: no content read
    C.LI_WS.liveV++;
    let e10 = planOf(C, 'N10');
    ok('no content read: the search words are "Not read yet", never 0 of 249', e10.kw === null && /· Hidden search words: Not read yet/.test(text(C.spWhere(e10).rows)), text(C.spWhere(e10).rows));
    await C.spSendAll([{ item: e10, after: e10.after, patches: C.spPatches(e10, e10.after) }]);
    e10 = planOf(C, 'N10');
    ok('…a title sent for it does not make it "read": still "Not read yet", not "0 of 249" (and no 0 bullets anywhere)', e10.kw === null && !C.LI_WS.live.SP.N10.cAt && !/0 of 249/.test(text(C.spWhere(e10).rows)), JSON.stringify([e10.kw, C.LI_WS.live.SP.N10.cAt]));
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

  console.log('== Item Highlights with a title over 75: found, but shoppers do not see it ==');
  {
    const { C, put, live } = setup();
    const T190 = 'Ridhi Rectangle Tablecloth 60 x 90 Inch Hand Block Print 100% Cotton Table Cover for Dining Table Kitchen Farmhouse Party Home Decor Washable Linen Look Floral Pattern Spill Proof Everyday Use - Red';
    put('V1', T190); live('V1', T190, 'dinner party', 'TC_HL', ['Christmas table decor, cotton']);
    const it = planOf(C, 'V1');
    const hlRow = C.spWhere(it).rows.find(r => r.k === 'hl');
    ok(`title of ${T190.length}: "Item Highlights: “Christmas” found — but Amazon shows Item Highlights only when the title is 75 letters or less, so shoppers don't see it yet (title is ${T190.length})"`,
      T190.length > 75 && hlRow.text === `· Item Highlights: “Christmas” found — but Amazon shows Item Highlights only when the title is 75 letters or less, so shoppers don't see it yet (title is ${T190.length})`, hlRow.text);
    ok('…not counted as found: the listing needs Christmas, and it goes to the hidden search words', it.kind === 'add' && it.place === 'kw' && /Christmas/.test(it.kwAfter) && !it.found.hl && it.found.hlHidden === 'Christmas', JSON.stringify([it.kind, it.place, it.kwAfter, it.found]));
    ok('…not "✓ in highlights" on its row, and not Up to date in the count', !/✓ in highlights/.test(C.spRowHtml(it)) && C.spWhereCount().Ridhi.upToDate === 0);
    put('V2', T190); live('V2', T190, 'x'.repeat(246), 'TC_HL', ['Christmas table decor, cotton']);
    const full = planOf(C, 'V2');
    ok('…and when the hidden search words are full too: Fix by hand, saying so', full.status === 'fix' && /full too/.test(full.why), full.status + ' ' + full.why);
  }

  console.log('== the "before" marks the words taken out, by position ==');
  {
    const { C, put, live } = setup();
    const before = "Ridhi Cloth Napkins for Dinner Gifts for Spring, Mother's Day - Blue";
    const after = "Ridhi Cloth Napkins for Dinner Gifts, Mother's Day - Blue";
    const html = C.spMarkHtml(before, C.spWordDiff(before, after).removed, 'del', after);
    ok('"Gifts for Spring, Mother\'s Day" → the LAST "for" and "Spring," are marked, never the first "for"', html === "Ridhi Cloth Napkins for Dinner Gifts <del>for</del> <del>Spring,</del> Mother&#39;s Day - Blue".replace('&#39;', "'"), html);
    const ins = C.spDiffHtml('a for b', 'a for b for c');
    ok('"after" too: the new "for" is the second one', ins === 'a for b <ins>for</ins> <ins>c</ins>', ins);
    // Item Highlights and the hidden search words: the full text before, marked by position
    const T = FULL;
    // nearly full search words with "linen" twice: making room takes out the REPEAT — the second "linen", marked there
    const fill = Array.from({ length: 38 }, (_, i) => 'word' + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26))).join(' ');   // 245 bytes in all
    const kwText = 'linen napkins linen ' + fill;
    put('M1', T); live('M1', T, kwText, 'TC_NONE');
    const it = planOf(C, 'M1');
    const kid = C.spKidHtml(it, null);
    ok('search words: "linen napkins linen …" → the repeat taken out is the SECOND "linen", marked there',
      C.lrKwBytes(kwText + ' Christmas') > 249 && /<small>Before<\/small><p>linen napkins <del>linen<\/del> wordaa/.test(kid), C.lrKwBytes(kwText) + ' ' + (kid.match(/<small>Before<\/small><p>[^]*?<\/p>/) || [''])[0].slice(0, 200));
    put('M2', T); live('M2', T, 'dinner christmas', 'TC_HL', ['Gifts for dinner, gifts for Spring table decor']);
    const it2 = planOf(C, 'M2');
    const kid2 = C.spKidHtml(it2, null);
    ok('Item Highlights: "Gifts for dinner, gifts for Spring table decor" → "Spring" marked where it was', /Show full Item Highlights[^]*?<small>Before<\/small><p>Gifts for dinner, gifts for <del>Spring<\/del> table decor<\/p>/.test(kid2), (kid2.match(/Show full Item Highlights[^]*?<\/p>/) || [''])[0]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
