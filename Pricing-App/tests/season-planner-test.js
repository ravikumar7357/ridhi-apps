/* The Season planner (src/app/listing/season-planner.js) over the real Listing Rules, Workspace and child component, in a stub page.
 *   node tests/season-planner-test.js
 * Days are fixed (SP.today / spCompute(today)), so the answers do not drift with the calendar. */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const NOV = new Date(2026, 10, 12);      // 12 Nov 2026: Thanksgiving, Black Friday, Cyber Monday, Christmas and Fall are on
const JAN = new Date(2027, 0, 10);       // 10 Jan 2027: Christmas and New Year's are over (Valentine's Day is on from 31 Dec)
const MAY = new Date(2026, 4, 10);       // 10 May 2026: Mother's Day on, Spring on
const JUL = new Date(2026, 6, 15);       // 15 Jul 2026: no occasion on; Labor Day starts on 17 Aug (33 days away: not "coming" yet)
const JUL2 = new Date(2026, 6, 20);      // 20 Jul 2026: Labor Day in 28 days — "coming"

function setup(opts) {
  const C = load(Object.assign({ ws: true, sp: true }, opts || {}));
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = (opts && opts.log) || [];
  // The product types these tests use have no Item Highlights in their schema (title → hidden search words, as before Item Highlights);
  // the Item Highlights tests give their own product type a schema that has them.
  ['SP', 'CPC'].forEach(b => ['NAPKIN', 'TABLECLOTH'].forEach(pt => { C.LI_WS.schema[b][pt] = { at: Date.now(), ok: [], hl: { none: true } }; }));
  const put = (sku, title, extra) => {
    const row = Object.assign({ brand: 'SP', parent: 'PS', sku, asin: 'B0' + sku, title, qty: 5, price: 12.5, status: 'Active', channel: 'AFN', aplus: true, aplusAt: Date.now(), checked: Date.now(),
      content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } }, extra || {});
    C.HEALTH.SP.rows.push(row);
    return row;
  };
  // a live read for a SKU: the title Amazon shows, its hidden search words, and the product kind (needed to send)
  const live = (sku, title, kw) => { const now = Date.now(); C.LI_WS.live.SP[sku] = { at: now, cAt: now, pt: 'NAPKIN', title, titleLen: title.length, catTitle: title, tAt: now, kw, kwBytes: C.lrKwBytes(kw) }; C.LI_WS.liveV++; };
  return { C, put, live };
}
const napkin = color => ({ color, size: '18x18', subcat: 'Napkin Set' });

(async () => {
  console.log('== what each listing needs, by the calendar ==');
  {
    const { C, put, live } = setup();
    const T = {
      S1: 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Spring Dinner - Blue',     // Spring in November → remove (72 letters: the adds go to the search words)
      S2: 'Ridhi Tablecloth 100% Cotton 60 x 90 Inch Block Print - Red',                 // 59: fits → the nearest occasion goes into the title
      S3: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Dinner Napkin - Blue', // 75, full → search words (not read yet)
      S4: 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Easter - Green',          // Easter in November → removed, then the add fits
      S5: 'Ridhi Halloween Cloth Napkins Cotton 18 x 18 Inch Block Print - Orange',      // the product IS Halloween: keeps the word
      S6: 'Ridhi Napkins Cotton 18 x 18 Inch Print Thanksgiving - Blue',                 // already says Thanksgiving: the next one is added, not that one twice
      S7: 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Dinner - Blue',           // not in the catalogue: no template → nothing to add
    };
    Object.entries(T).forEach(([sku, title]) => put(sku, title));
    ['S1', 'S2', 'S4', 'S5', 'S6'].forEach(sku => live(sku, T[sku], 'cotton dinner party'));
    C.setCat('SP', { S1: napkin('Blue'), S2: { color: 'Red', size: '60x90', subcat: 'Rectangle Tablecloth' }, S3: napkin('Blue'), S4: napkin('Green'), S5: { color: 'Orange', size: '18x18', subcat: 'Halloween Napkin Set' }, S6: napkin('Blue') });
    C.reset();
    const items = C.spCompute(NOV);
    const by = Object.fromEntries(items.map(item => [item.sku, item]));
    ok('"Spring" in November → Remove old season words: the word goes, the one season word (Christmas) takes the room it frees', by.S1 && by.S1.remove.some(e => e.ev.id === 'sp_spring')
      && by.S1.after === 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Dinner Christmas - Blue' && by.S1.status === 'ready', by.S1 && (by.S1.after + ' | ' + by.S1.status + ' ' + by.S1.why));
    ok('a short tablecloth title in November → Add ONE season: Christmas (kept the longest) goes into the title before " - Colour"; Black Friday nowhere',
      by.S2 && by.S2.kind === 'add' && by.S2.after === 'Ridhi Tablecloth 100% Cotton 60 x 90 Inch Block Print Christmas - Red' && !/Black Friday|Thanksgiving/.test(by.S2.kwAfter) && by.S2.status === 'ready', by.S2 && (by.S2.after + ' | ' + by.S2.kwAfter + ' | ' + by.S2.status + ' ' + by.S2.why));
    ok('…Thanksgiving and the rest are offered as "Also possible", not added', by.S2 && by.S2.add.length === 1 && by.S2.alts.some(e => e.ev.id === 'thanksgiving') && !by.S2.alts.some(e => e.ev.id === 'blackfriday'));
    ok('a full 75-letter title not read from Amazon yet: Reading (the words need the hidden search words)', by.S3 && by.S3.kind === 'add' && by.S3.after === by.S3.title && by.S3.status === 'reading', by.S3 && by.S3.status);
    ok('"Easter" in November → removed, and the in-season word put in its place', by.S4 && !/Easter/.test(by.S4.after) && by.S4.after === 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Christmas - Green', by.S4 && by.S4.after);
    ok('a product that IS the occasion (Halloween napkins) keeps its word after Halloween', by.S5 && by.S5.remove.length === 0 && !/Halloween/.test(by.S5.add.map(e => e.ev.id).join()));
    ok('a title already naming an in-season occasion gets the one season word, not that one twice, never a sale day', by.S6 && by.S6.after === 'Ridhi Napkins Cotton 18 x 18 Inch Print Thanksgiving Christmas - Blue' && (by.S6.after.match(/Thanksgiving/g) || []).length === 1, by.S6 && by.S6.after);
    ok('a listing with no template (not in the catalogue) is never asked to add a season word', by.S7 && by.S7.kind === 'none', by.S7 && by.S7.kind);
    ok('brand, size and colour are never lost in any suggestion', items.filter(item => /^S\d$/.test(item.sku) && item.after !== item.title).every(item => /^Ridhi/.test(item.after) && /18 x 18 Inch|60 x 90 Inch/.test(item.after) && / - (Blue|Red|Green|Orange)$/.test(item.after)));
    ok('no suggested title is over 75 letters (one that already was is never made longer)', items.every(item => item.after.length <= Math.max(75, item.title.length)));
    ok('in July nothing is on: nothing to add', C.spCompute(JUL).filter(item => item.kind === 'add').length === 0, C.spCompute(JUL).filter(item => item.kind === 'add').map(i => i.sku + ':' + i.why).join());
    ok('a season coming within 30 days is not a card yet (the timeline says when it starts)', C.spCompute(JUL2).filter(item => item.kind === 'add').length === 0);
    ok('in May "Spring" is in season: nothing to remove', (s => s && s.remove.length === 0)(C.spCompute(MAY).find(item => item.sku === 'S1')));
  }

  console.log('== the hidden search words, the checks, the card ==');
  {
    const { C, put, live } = setup();
    const full = 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Dinner Sets - Blue';   // exactly 75
    ['F1', 'F2', 'F3', 'F4'].forEach(sku => put(sku, full));
    live('F1', full, 'cotton napkins dinner party');
    live('F2', full, 'w'.repeat(245));
    live('F3', full, 'thanksgiving black friday cyber monday christmas');
    C.LI_WS.live.SP.F4 = { at: Date.now(), cErr: 'not found on Amazon by SKU', err: 'not found on Amazon by SKU' };
    C.setCat('SP', { F1: napkin('Blue'), F2: napkin('Blue'), F3: napkin('Blue'), F4: napkin('Blue') });
    C.reset();
    const items = C.spCompute(NOV);
    const by = Object.fromEntries(items.map(item => [item.sku, item]));
    ok('a full title moves the words to the hidden search words, within their limit, words only, and the card says so', by.F1 && by.F1.after === full && /Christmas/.test(by.F1.kwAfter) && !/Thanksgiving/.test(by.F1.kwAfter) && C.lrKwBytes(by.F1.kwAfter) <= 249
      && /The title is full, so we added “Christmas” to the hidden search words instead \(the safest place\)/.test(by.F1.note) && by.F1.status === 'ready' && !/Black Friday/.test(by.F1.kwAfter), by.F1 && (by.F1.kwAfter + ' | ' + by.F1.note + ' | ' + by.F1.status + ' ' + by.F1.why));
    ok('…what is sent then: the title and the hidden search words', by.F1 && C.spPatches(by.F1, by.F1.after).map(p => p.path).join() === '/attributes/item_name,/attributes/generic_keyword');
    ok('a full title with full search words and no word to replace: ✎ Fix by hand, with the reason, a hint and the suggestion kept', by.F2 && by.F2.status === 'fix' && /full too/.test(by.F2.why) && /Shorten the hidden search words by \d+ letters?, then add “Christmas”/.test(by.F2.hint) && /Christmas/.test(by.F2.kwAfter), by.F2 && (by.F2.status + ' ' + by.F2.why + ' | ' + by.F2.hint));
    ok('the words already in the search words: Up to date', by.F3 && by.F3.kind === 'ok', by.F3 && by.F3.kind);
    ok("a listing Amazon could not read: ✎ Fix by hand with Amazon's reason, never stuck on Reading", by.F4 && by.F4.status === 'fix' && /could not be read/.test(by.F4.why) && by.F4.hint, by.F4 && (by.F4.status + ' ' + by.F4.why));
    const row = by.F1.row;
    const ctx = C.hCtx();
    const chk = after => C.spChecks(full, after, row, ctx, NOV, { kwAfter: '', kwMax: 249 });
    const bad = after => chk(after).filter(c => c.ok === false).map(c => c.k);
    ok('banned symbols are rejected ("%" and "&" are fine)', bad('Ridhi Cloth Napkins! 100% Cotton 18 x 18 Inch Block Print Dinner - Blue').includes('sym') && !bad('Ridhi Cloth Napkins 100% Cotton & Linen 18 x 18 Inch Block Print - Blue').includes('sym'));
    ok('a word used 3 times is rejected', bad('Ridhi Cloth Napkins Cotton Cotton Cotton 18 x 18 Inch Block Print - Blue').includes('rep'));
    ok('too long is rejected and says by how much', (c => c && /Too long by 6 letters \(81 of 75\)/.test(c.t))(chk(full + ' Extra').find(c => c.k === 'len')), JSON.stringify(chk(full + ' Extra').find(c => c.k === 'len')));
    const lost = bad('Cloth Napkins 100% Cotton Block Print Dinner Napkins');
    ok('a lost size, colour or brand is rejected', lost.includes('size') && lost.includes('color') && lost.includes('brand'), lost.join());
    ok('an out-of-season word is rejected', bad('Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Easter Dinner - Blue').includes('season'));
    ok('a made-up word is a warning, not a block (the seller must make sure it is true)', (c => c && c.ok === 'warn' && /linen/i.test(c.t))(chk('Ridhi Linen Napkins 100% Cotton 18 x 18 Inch Block Print Dinner - Blue').find(c => c.k === 'fact')));
    const good = chk('Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Christmas - Blue');
    ok('the good suggestion passes every check: 75, 200, size, brand, colour, symbols, 3 times, season, nothing made up, search words', good.every(c => c.ok === true) && good.length === 10, good.filter(c => c.ok !== true).map(c => c.t).join(' | '));
    ok('the child panel: the main button is disabled while a check fails, the reason is beside it; Edit and Not now are there', (() => {
      C.SP.edits.set('SP|F1', full + ' Extra');
      const h = C.spKidHtml(by.F1, null);
      C.SP.edits.delete('SP|F1');
      return /data-sp-act="approve" data-sp-key="SP\|F1" disabled/.test(h) && /class="sp-reason">the title is too long by 6 letters/.test(h) && /data-sp-act="skip"/.test(h) && /data-sp-act="edit"/.test(h);
    })());
    ok('…and enabled once they all pass: picture, Colour · Size · Pack, SKU small, the six cards top to bottom, [Fix — send to Amazon]', (h => !/data-sp-act="approve" data-sp-key="SP\|F1" disabled/.test(h) && /class="ls-pic/.test(h) && /Blue · 18 x 18 Inch/.test(h) && /<small>F1<\/small>/.test(h)
      && /<h4>Problem<\/h4>[\s\S]*<h4>Why it matters<\/h4>[\s\S]*<h4>What we’ll do<\/h4>[\s\S]*<h4>What changes<\/h4>[\s\S]*<h4>Checks<\/h4>/.test(h) && />Fix — send to Amazon</.test(h)
      && /Christmas is (coming|here) and this listing doesn't mention it/.test(h) && /Shoppers searching “christmas napkins” may not find it/.test(h) && /Add “Christmas” to the hidden search words\. The title stays the same/.test(h) && /✓ All 10 checks pass/.test(h))(C.spKidHtml(by.F1, null)),
      C.spKidHtml(by.F1, null).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400));
    ok('…"What changes": + Added: Christmas; nothing removed', (h => /\+ Added: Christmas/.test(h) && !/− Removed/.test(h) && /Show full search words/.test(h))(C.spKidHtml(by.F1, null)));
    ok("no code words on the screen: no 'bytes', 'attribute', 'detector', 'API' or 'VALIDATION'", !/bytes|attribute|detector|\bAPI\b|VALIDATION|generic_keyword|item_name/.test(C.spKidHtml(by.F1, null) + C.spKidHtml(by.F2, null) + C.spRowHtml(by.F1, false)));
  }

  console.log('== no dead ends: sale days, one season, making room, the three states ==');
  {
    const { C, put, live } = setup();
    const T = {
      G1: 'Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch Block Print Dining - Red',   // 76: full; "Rectangle" is what the size already tells
      G2: 'Ridhi Cloth Napkins Cotton Cotton 18 x 18 Inch Block Print Dinner - Blue',        // 71: Christmas does not fit; "Cotton" twice
      G3: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Dinner Sets - Blue',    // 75: full; nothing to replace
      G4: 'Ridhi Tablecloth 100% Cotton 60 x 90 Inch Block Print - Red',                    // short: the word goes in the title
    };
    Object.entries(T).forEach(([sku, title]) => put(sku, title));
    const busy = 'cotton napkins dinner for the and party party tablecloth red blue easter spring kitchen home decor farmhouse ' + 'w'.repeat(150);   // over the limit once Christmas is added, full of waste
    live('G1', T.G1, busy);
    live('G2', T.G2, busy);
    live('G3', T.G3, 'x'.repeat(246));
    live('G4', T.G4, 'cotton');
    C.setCat('SP', { G1: { color: 'Red', size: '60x90', subcat: 'Rectangle Tablecloth' }, G2: napkin('Blue'), G3: napkin('Blue'), G4: { color: 'Red', size: '60x90', subcat: 'Rectangle Tablecloth' } });
    C.reset();
    const items = C.spCompute(NOV);
    const by = Object.fromEntries(items.map(item => [item.sku, item]));
    ok('sale days are never suggested anywhere: not in a title, not in the hidden search words', items.every(item => !/Black Friday|Cyber Monday/.test(item.after) && !/Black Friday|Cyber Monday/.test(item.kwAfter || '')), by.G4 && by.G4.kwAfter);
    ok('one season only: the title gets Christmas, Thanksgiving is "Also possible"', by.G4.after === 'Ridhi Tablecloth 100% Cotton 60 x 90 Inch Block Print Christmas - Red' && by.G4.alts.map(e => e.ev.id).includes('thanksgiving'), by.G4.after);
    C.SP.choice.set('SP|G4', 'thanksgiving');
    const sw = C.spCompute(NOV).find(item => item.sku === 'G4');
    ok('…one click switches the card to the other season', sw.after === 'Ridhi Tablecloth 100% Cotton 60 x 90 Inch Block Print Thanksgiving - Red' && sw.alts.map(e => e.ev.id).includes('christmas'), sw.after);
    C.SP.choice.delete('SP|G4');
    ok('a full title: the hidden search words are cleaned first (repeats, fillers, words the title says, out-of-season) and the card says what was removed',
      by.G1.status === 'look' && /Removed \d+ words \(.*\) from the hidden search words to make room for “Christmas” \(now \d+ of 249\)/.test(by.G1.note) && /Christmas/.test(by.G1.kwAfter) && !/easter|spring/.test(by.G1.kwAfter) && !/\bfor\b|\bthe\b/.test(by.G1.kwAfter)
      && by.G1.changes.some(c => c.what === 'Hidden search words'), by.G1 && (by.G1.status + ' | ' + by.G1.note + ' | ' + by.G1.kwAfter));
    ok('…the search words still fit Amazon\'s limit after the clean-up', C.lrKwBytes(by.G1.kwAfter) <= 249);
    // a title with no room and search words that cannot be cleaned enough: ONE low-value word is replaced, for the person's OK
    live('G2', T.G2, 'x'.repeat(246));
    live('G1', T.G1, 'x'.repeat(246));
    C.reset();
    const items2 = C.spCompute(NOV);
    const b2 = Object.fromEntries(items2.map(item => [item.sku, item]));
    ok('…else ONE low-value word is replaced in the title (a repeated word) — ⚠ Needs your OK, before → after shown', b2.G2.status === 'look' && b2.G2.after === 'Ridhi Cloth Napkins Cotton Christmas 18 x 18 Inch Block Print Dinner - Blue' && b2.G2.changes.some(c => c.what === 'Title' && /twice/.test(c.why)), b2.G2 && (b2.G2.status + ' ' + b2.G2.after + ' ' + b2.G2.why));
    ok('…or a shape the size already tells ("Rectangle" with 60 x 90 Inch) — a 76-letter title is not made longer', b2.G1.status === 'look' && b2.G1.after === 'Ridhi Tablecloth Christmas 100% Cotton 60 x 90 Inch Block Print Dining - Red' && /size already says it/.test(b2.G1.note), b2.G1 && (b2.G1.status + ' ' + b2.G1.after + ' ' + b2.G1.why));
    ok('brand, product, size, colour, material and pattern are never the word replaced', items2.filter(item => /^G\d$/.test(item.sku) && item.after !== item.title).every(item => /^Ridhi/.test(item.after) && /Cotton/.test(item.after) && /Block Print/.test(item.after) && /(60 x 90|18 x 18) Inch/.test(item.after) && / - (Red|Blue)$/.test(item.after)));
    ok('no room anywhere: ✎ Fix by hand with the suggestion filled in (search words with Christmas, over the limit) and a one-line hint', b2.G3.status === 'fix' && /Shorten the hidden search words by \d+ letters?, then add “Christmas”/.test(b2.G3.hint) && /Christmas$/.test(b2.G3.kwAfter), b2.G3 && (b2.G3.status + ' ' + b2.G3.hint));
    ok('every child panel has one main button for its state: Fix — send to Amazon / Approve this change / Open in Listing Errors — and Edit and Not now', [b2.G1, b2.G2, b2.G3, b2.G4].every(item => {
      const h = C.spKidHtml(item, null);
      const main = item.status === 'fix' ? /class="sp-main" data-sp-act="fixhand"[^>]*>Open in Listing Errors</ : item.status === 'look' ? /class="sp-main" data-sp-act="approve"[^>]*>Approve this change</ : /class="sp-main" data-sp-act="approve"[^>]*>Fix — send to Amazon</;
      return main.test(h) && /data-sp-act="edit"/.test(h) && /data-sp-act="skip"/.test(h) && !/Can't do/.test(h) && (h.match(/class="sp-main"/g) || []).length === 1;
    }), [b2.G1, b2.G2, b2.G3, b2.G4].map(i => i.sku + ':' + i.status).join());
    ok('…the By hand child says why and what to do, and Listing Errors opens with the suggestion filled in', (h => /✎<\/i>Fix by hand/.test(h) && /can't change this one safely by ourselves: the title is full/.test(h) && /Shorten the hidden search words by \d+ letters?, then add “Christmas”/.test(h) && /suggestion already filled in/.test(h))(C.spKidHtml(b2.G3, null)));
    ok('…a title change shows ONLY the title before → after, the changed word marked', (h => /Title before<\/small><p>[^<]*<del>Cotton<\/del>/.test(h) && /Title after<\/small><p class="sp-change-after">[^<]*<ins>Christmas<\/ins>/.test(h) && !/\+ Added/.test(h))(C.spKidHtml(b2.G2, null)), C.spKidHtml(b2.G2, null).match(/Title before[\s\S]{0,400}/));
    ok('"Add season words" counts only listings with a real season word to add (the sale days and coming seasons do not count)', items2.filter(item => /^G\d$/.test(item.sku) && item.add.length).length === 4 && items2.every(item => !item.add.some(e => /blackfriday|cybermonday/.test(e.ev.id))));
  }

  console.log('== product words stay, only occasion use is judged; sale days nowhere; home products only ==');
  {
    const { C, put, live } = setup();
    const T = {
      D1: 'Ridhi Women Summer Midi Dress Cotton Block Print Short Sleeve - Blue',          // a dress: clothing, and "Summer" describes the product
      D2: 'Ridhi Women Sundress Cotton Block Print Short Sleeve - Blue',                   // a dress
      H1: 'Ridhi Christmas Tablecloth 100% Cotton 60 x 90 Inch Block Print - Red',        // "Christmas Tablecloth" describes the product
      H2: 'Ridhi Tablecloth 100% Cotton 60 x 90 Inch Block Print for Thanksgiving - Red', // "for Thanksgiving" = occasion use
      H3: 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Spring Decor - Blue',      // "Spring Decor" = occasion use
      H4: 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Spring Floral Block Print - Blue',     // "Spring Floral" is the print
      H5: 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Dinner Easter - Blue',     // "Easter" where the templates put occasions
    };
    Object.entries(T).forEach(([sku, title]) => { put(sku, title); live(sku, title, 'cotton'); });
    C.setCat('SP', { D1: { color: 'Blue', size: 'M', subcat: 'Dress' }, D2: { color: 'Blue', size: 'M', subcat: 'Dress' }, H1: { color: 'Red', size: '60x90', subcat: 'Rectangle Tablecloth' },
      H2: { color: 'Red', size: '60x90', subcat: 'Rectangle Tablecloth' }, H3: napkin('Blue'), H4: napkin('Blue'), H5: napkin('Blue') });
    C.reset();
    const jan = Object.fromEntries(C.spCompute(JAN).map(item => [item.sku, item]));
    const nov = Object.fromEntries(C.spCompute(NOV).map(item => [item.sku, item]));
    ok('a summer dress in January is not touched: ✓ Up to date, no Remove', jan.D1 && jan.D1.kind === 'none' && jan.D1.remove.length === 0 && jan.D2 && jan.D2.kind === 'none', jan.D1 && (jan.D1.kind + ' ' + jan.D1.after));
    ok('a dress is never in "Add season words" (clothing is outside the calendar)', nov.D1 && nov.D1.add.length === 0 && nov.D1.kind === 'none' && nov.D2.kind === 'none', nov.D1 && nov.D1.kind);
    ok('"Christmas Tablecloth" describes the product: not removed in January', jan.H1 && jan.H1.remove.length === 0 && /Christmas Tablecloth/.test(jan.H1.after), jan.H1 && jan.H1.after);
    ok('"for Thanksgiving" is removed after its season', jan.H2 && jan.H2.remove.some(e => e.ev.id === 'thanksgiving') && !/Thanksgiving/.test(jan.H2.after) && !/for\s*-/.test(jan.H2.after), jan.H2 && jan.H2.after);
    ok('"Spring Decor" is an occasion use: removed whole in November, the season word takes its place', nov.H3 && nov.H3.remove.some(e => e.ev.id === 'sp_spring') && nov.H3.after === 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Christmas - Blue', nov.H3 && nov.H3.after);
    ok('"Spring Floral" is the print: left alone', nov.H4 && nov.H4.remove.length === 0 && /Spring Floral/.test(nov.H4.after), nov.H4 && nov.H4.after);
    ok('a season word where the templates put occasions (before " - Colour") is an occasion: "Easter" removed in November', nov.H5 && nov.H5.remove.some(e => e.ev.id === 'easter') && !/Easter/.test(nov.H5.after), nov.H5 && nov.H5.after);
    const all = C.spCompute(NOV).concat(C.spCompute(JAN));
    ok('Black Friday / Cyber Monday never appear in any suggestion, title or search words', all.every(item => !/Black Friday|Cyber Monday|Prime Day/i.test(item.after + ' ' + (item.kwAfter || ''))));
    ok('a season word that describes the product is not flagged by the checks either', C.spChecks('Ridhi Christmas Tablecloth 100% Cotton 60 x 90 Inch Block Print - Red', 'Ridhi Christmas Tablecloth 100% Cotton 60 x 90 Inch Block Print - Red', jan.H1.row, C.hCtx(), JAN, {}).every(c => c.k !== 'season' || c.ok === true));
  }

  console.log('== three levels: parent cards, the parent panel, Fix all, the word difference ==');
  {
    const posts = [];
    const { C, put, live } = setup({ post: body => { posts.push(body); return { ok: true, status: 'ACCEPTED', submissionId: 'sub-' + body.sku }; } });
    // "Embroidery Napkin": 6 napkins under one parent — 4 Ready (the word fits the search words), 1 Needs your OK (a repeat in the title
    // gives way), 1 By hand (no room anywhere); plus 2 up to date (they already say Christmas in the search words).
    const mk = (sku, color, title, kw) => { put(sku, title, { parent: 'PEMB' }); live(sku, title, kw); };
    const t = color => 'Ridhi Embroidery Cloth Napkins Cotton 18 x 18 Inch Set of 4 Dinner - ' + color;   // 72–74: Christmas does not fit in the title
    mk('E1', 'Red', t('Red'), 'cotton');
    mk('E2', 'Blue', t('Blue'), 'cotton');
    mk('E3', 'Gold', t('Gold'), 'cotton');
    mk('E4', 'Ivory', t('Ivory'), 'cotton');
    mk('E5', 'Green', 'Ridhi Embroidery Napkins Cotton Cotton 18 x 18 Inch Set of 4 - Green', 'x'.repeat(246));   // 68: the repeat gives way
    mk('E6', 'Pink', t('Pink'), 'x'.repeat(246));
    mk('E7', 'Teal', t('Teal'), 'christmas napkins');
    mk('E8', 'Navy', t('Navy'), 'christmas');
    C.setCat('SP', Object.fromEntries(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'].map((sku, i) => [sku, napkin(['Red', 'Blue', 'Gold', 'Ivory', 'Green', 'Pink', 'Teal', 'Navy'][i])])));
    C.reset();
    C.SP.today = NOV;
    const g = C.spGroups(C.spCompute(NOV)).find(each => each.key === 'SP|PEMB');
    ok('the parent: 8 listings, 6 to do — 4 Ready, 1 Needs your OK, 1 By hand', g && g.all.length === 8 && g.todo.length === 6 && g.ready.length === 4 && g.look.length === 1 && g.fix.length === 1, g && [g.all.length, g.todo.length, g.ready.length, g.look.length, g.fix.length].join());
    const card = C.spParentCardHtml(g);
    ok('the parent card: picture, name, "8 listings · 🎄 6 need “Christmas” · ⚠ 2 need you", Open ›, the whole card opens it', /8 listings · 🎄 6 need “Christmas” · <span class="sp-you">⚠ 2 need you<\/span>/.test(card) && /class="ls-pic/.test(card) && /Open ›/.test(card) && /role="button" tabindex="0" data-sp-act="open-parent"/.test(card), card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    const body = C.spParentBodyHtml(g, false);
    ok('the parent panel: one sentence, three state cards with their counts and one button each', /Christmas is (coming|here)\.<\/b> 6 of these 8 napkins don't mention it yet\./.test(body)
      && /Ready to fix<\/span><b>4<\/b>[\s\S]*We add “Christmas” safely\. Nothing else changes\.[\s\S]*data-sp-act="fix-all"[^>]*>Fix all 4</.test(body)
      && /Needs your OK<\/span><b>1<\/b>[\s\S]*One word in the title would change\.[\s\S]*>Check them</.test(body)
      && /Fix by hand<\/span><b>1<\/b>[\s\S]*No safe automatic change\.[\s\S]*data-sp-act="fixhand"[^>]*>Open in Listing Errors</.test(body), body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500));
    ok('…the children as rows: Colour · Size · Pack, what we will do, the state chip, one button; 2 more up to date (folded, listed with where the word is)', (body.split('sp-uptodate')[0].match(/class="sp-row /g) || []).length === 6 && (body.match(/class="sp-row /g) || []).length === 8 && /<b>Red · 18 x 18 Inch · Set of 4<\/b><span>Add “Christmas” to hidden search words<\/span>/.test(body)
      && /<i aria-hidden="true">✓<\/i>Ready<\/span><button[^>]*data-sp-act="row-fix"[^>]*>Fix</.test(body) && /<i aria-hidden="true">⚠<\/i>OK\?<\/span><button[^>]*>Check</.test(body) && /2 more listings are up to date/.test(body), body.match(/class="sp-row [\s\S]{0,500}/));
    ok('a state card with 0 is greyed with its button disabled', (h => /sp-sc is-fix is-zero[\s\S]*?disabled/.test(h))(C.spParentBodyHtml(Object.assign({}, g, { fix: [] }), false)));
    // Fix all: ONLY the Ready ones are sent; Needs your OK never without its own approval
    C.SP.on = true;
    C.spApprove(g.ready.map(item => item.key));
    const modal = C.el('spModalBox').innerHTML;
    ok('Fix all → the confirm window lists the 4 Ready listings only, "You are about to change 4 listings on Amazon"', /You are about to change 4 listings on Amazon/.test(modal) && (modal.match(/class="sp-m-row"/g) || []).length === 4 && !/E5|E6/.test(modal), modal.slice(0, 200));
    await C.spSendAll(g.ready.map(item => ({ item, after: item.after, patches: C.spPatches(item, item.after) })));
    ok('…and only those 4 are sent; the one that needs your OK and the by-hand one are not', posts.length === 4 && posts.every(p => ['E1', 'E2', 'E3', 'E4'].includes(p.sku)), posts.map(p => p.sku).join());
    const look = C.spCompute(NOV).find(item => item.sku === 'E5');
    ok('Needs your OK is sent only through its own child panel ([Approve this change])', look.status === 'look' && />Approve this change</.test(C.spKidHtml(look, null)));
    // the word difference: word sets, not positions
    const d1 = C.spWordDiff('picnic red picnic picnic blanket', 'red blanket picnic christmas');
    ok('the word difference: a word that only moved is not shown; never both added and removed; duplicates collapse ("picnic ×2")',
      d1.added.map(x => x.w + 'x' + x.n).join() === 'christmasx1' && d1.removed.map(x => x.w + 'x' + x.n).join() === 'picnicx2' && !d1.added.some(x => d1.removed.some(y => y.k === x.k)), JSON.stringify(d1));
    const d2 = C.spWordDiff('Ridhi Napkins Spring Dinner - Blue', 'Ridhi Napkins Dinner Christmas - Blue');
    ok('…"Dinner" moved: not marked; Spring removed, Christmas added', d2.added.map(x => x.w).join() === 'Christmas' && d2.removed.map(x => x.w).join() === 'Spring' && C.spDiffHtml('Ridhi Napkins Spring Dinner - Blue', 'Ridhi Napkins Dinner Christmas - Blue') === 'Ridhi Napkins Dinner <ins>Christmas</ins> - Blue');
    // a cleaned search-words change lists what went and why, each word once
    const kwItem = Object.assign({}, look, { title: t('Red'), after: t('Red'), kw: 'cloth cloth napkins picnic picnic for spring', kwAfter: 'cloth picnic christmas', kwMax: 249 });
    const ch = C.spKidHtml(kwItem, null);
    ok('…"What changes" for the search words: + Added, − Removed with why (already in the title / repeated / filler / out of season)', /\+ Added: christmas/.test(ch) && /− Removed: napkins <span class="sp-dim">\(already in the title\)/.test(ch) && /− Removed: cloth, picnic <span class="sp-dim">\(repeated\)/.test(ch.replace(/<span class="sp-times">[^<]*<\/span>/g, '').replace(/ ×\d/g, '')) && /\(small filler words\)/.test(ch) && /\(out of season\)/.test(ch), ch.match(/What changes[\s\S]{0,700}/));
    // the panels: open, Esc order (child first), ↑ ↓
    C.spOpenParent('SP|PEMB');
    ok('Open › opens the parent side panel', !C.el('spPanel').hidden && /Ridhi Embroidery|PEMB/.test(C.el('spPanel').innerHTML) && C.SP.panel.key === 'SP|PEMB');
    C.spOpenKid('SP|E5', 'page');
    ok('a row opens the child panel beside it (the parent panel stays open)', !C.el('spKid').hidden && !C.el('spPanel').hidden && C.SP.kid.key === 'SP|E5' && /Back to/.test(C.el('spKid').innerHTML));
    C.spCloseKid(false);
    ok('closing the child leaves the parent open (Esc closes the child first)', C.el('spKid').hidden && !C.el('spPanel').hidden && C.SP.panel && !C.SP.kid);
    C.spCloseParent(false);
    ok('…then the parent', C.el('spPanel').hidden && !C.SP.panel);
  }

  console.log('== Ready when nothing gets worse: problems already there do not block ==');
  {
    const { C, put, live } = setup();
    // CPC "Tablecloth main": Agate Green 60×60 — title already over 75 and its size written another way; Christmas goes to the
    // hidden search words only, the title does not change.
    const T1 = 'Whimsical Corner Tablecloth Square 100% Cotton 60x60 Inches Block Print Dining Table Cover - Agate Green';   // > 75
    const row = { brand: 'CPC', parent: 'CPCTAB', sku: 'CPC-01', asin: 'B0CPC01', title: T1, qty: 5, price: 20, status: 'Active', channel: 'AFN', aplus: true, aplusAt: Date.now(), checked: Date.now(), content: { titleLen: T1.length, images: 8, bullets: 5, descLen: 300, title: T1 } };
    C.HEALTH.CPC.rows.push(row);
    const now = Date.now();
    C.LI_WS.live.CPC['CPC-01'] = { at: now, cAt: now, pt: 'TABLECLOTH', title: T1, titleLen: T1.length, kw: 'cotton table cover square', kwBytes: 1 };
    C.LI_WS.liveV++;
    C.setCat('CPC', { 'CPC-01': { color: 'Agate Green', size: '60x60', subcat: 'Square Tablecloth' } });
    C.reset();
    const item = C.spCompute(NOV).find(each => each.sku === 'CPC-01');
    ok('CPC-01 (Agate Green 60×60): adds "Christmas" to the hidden search words only, the title unchanged → ✓ Ready', item && item.place === 'kw' && item.after === T1 && /Christmas/.test(item.kwAfter) && item.status === 'ready', item && (item.status + ' ' + item.place + ' | ' + item.checks.filter(c => c.ok !== true).map(c => c.t + (c.pre ? ' [pre]' : '')).join(' / ')));
    ok('…the problems that were already there are marked as such: over 75, the size written another way', item.checks.some(c => c.k === 'len' && c.pre) && item.checks.some(c => c.k === 'size' && c.pre) && item.checks.filter(c => c.ok !== true).every(c => c.pre));
    const h = C.spKidHtml(item, null);
    ok('…the child panel: "✓ All N checks pass" for the change itself, and a separate card "Already there before — not caused by this change" with a link to Listing Health',
      /✓ All \d+ checks pass/.test(h) && /<h4>Already there before — not caused by this change<\/h4>/.test(h) && /Longer than 75 letters/.test(h) && /Size written another way/.test(h) && /data-sp-act="to-health"[^>]*>Fix them in Listing Health</.test(h)
      && /class="sp-main" data-sp-act="approve"[^>]*>Fix — send to Amazon</.test(h) && !/data-sp-act="approve"[^>]*disabled/.test(h), h.match(/Checks<\/h4>[\s\S]{0,300}/));
    // a problem the change itself causes still needs the person's OK
    const typed = C.spChecks(T1, T1.replace('Dining', 'Linen'), row, C.hCtx(), NOV, { kwAfter: item.kwAfter, kwBefore: item.kw, kwMax: 249 });
    ok('…but a problem the change itself causes is not "already there": a new word typed in is a warning of its own', typed.some(c => c.k === 'fact' && c.ok === 'warn' && !c.pre));
    const longer = C.spChecks(T1, T1 + ' Christmas', row, C.hCtx(), NOV, {});
    ok('…and making a too-long title longer still blocks it', longer.some(c => c.k === 'len' && c.ok === false && !c.pre));
    const kwSame = C.spChecks(T1, T1 + '', row, C.hCtx(), NOV, { kwAfter: 'x'.repeat(260), kwBefore: 'x'.repeat(260), kwMax: 249 });
    ok('…search words already over their limit and left as they are: already there, not a block', kwSame.some(c => c.k === 'kw' && c.pre && c.ok === 'warn'));
    const g = C.spGroups(C.spCompute(NOV)).find(each => each.key === 'CPC|CPCTAB');
    ok('…and the parent counts it as Ready to fix (1 Ready, 0 Needs your OK)', g && g.ready.length === 1 && g.look.length === 0, g && [g.ready.length, g.look.length, g.fix.length].join());
  }

  console.log('== put old titles back, the confirm window, sending ==');
  {
    const before = 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Dinner - Blue';
    const after = 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Christmas Dinner - Blue';
    const log = [{ brand: 'SP', sku: 'R1', asin: 'B0R1', kind: 'add', seasons: ['christmas'], at: Date.UTC(2026, 10, 12), by: 'x', before: { title: before, kw: 'a b' }, after: { title: after, kw: 'a b' } },
      { brand: 'SP', sku: 'R2', asin: 'B0R2', kind: 'add', seasons: ['christmas'], at: Date.UTC(2026, 10, 12), by: 'x', before: null, after: { title: 'x' } }];
    const posts = [];
    const { C, live } = setup({ log, post: body => { posts.push(body); return body.sku === 'R2' ? { ok: false, error: 'Amazon would reject this: Provide an Item Name that is 75 characters or less' } : { ok: true, status: 'ACCEPTED', submissionId: 'sub-' + body.sku }; } });
    const r2 = C.rows.find(r => r.sku === 'R2');
    live('R1', after, 'a b');
    live('R2', r2.title, '');
    C.reset();
    ok('while Christmas is on, a change we sent is not offered for putting back', (i => i && i.kind !== 'restore')(C.spCompute(NOV).find(item => item.sku === 'R1')));
    C.SP.today = JAN;
    const jan = C.spCompute(JAN);
    const j1 = jan.find(item => item.sku === 'R1');
    const j2 = jan.find(item => item.sku === 'R2');
    ok('after the season: Put old titles back, with the original from the change record, ready to send', j1 && j1.kind === 'restore' && j1.after === before && j1.status === 'ready', j1 && (j1.kind + ' ' + j1.status + ' ' + j1.why));
    ok('a record without the old title says so plainly and offers the next best thing (the season word taken out) for the person\'s OK', j2 && j2.kind === 'restore' && (j2.status === 'look' || j2.status === 'fix') && /old title was not kept/.test(j2.note + j2.why), j2 && (j2.status + ' ' + j2.note + j2.why));
    ok('…and such a listing is not also in the Remove list', j1 && j1.remove.length === 0 && j2 && j2.remove.length === 0);
    C.SP.on = true;
    C.spApprove(['SP|R1']);
    const modal = C.el('spModalBox').innerHTML;
    ok('Approve opens the confirm window in plain words: [Send 1 listing] [Cancel], Amazon checks first, the old words are kept',
      /You are about to change 1 listing on Amazon/.test(modal) && /Amazon checks each one first/.test(modal) && /The old words are kept so you can put them back/.test(modal) && /id="spSendBtn">Send 1 listing</.test(modal) && /id="spCancelBtn">Cancel</.test(modal), modal.slice(0, 300));
    await C.spSendAll([{ item: j1, after: j1.after, patches: C.spPatches(j1, j1.after) }]);
    ok('the send goes through the existing path (POST lfix=patch, apply, the product kind, by the signed-in person): Amazon checks first', posts.length === 1 && posts[0].lfix === 'patch' && posts[0].apply === true && posts[0].productType === 'NAPKIN' && posts[0].patches[0].value[0].value === before && posts[0].by === 'test@example.com', JSON.stringify(posts[0] || {}).slice(0, 200));
    ok('…the result says it in plain words', C.SP.result && C.SP.result.results[0].ok && /✓ 1 sent<\/span>.*Amazon usually shows the changes within a few hours/.test((C.spRender(), C.el('spPane').innerHTML)), C.el('spPane').innerHTML.slice(0, 300));
    ok('…what was sent is recorded with the old title (kind: restore), and the title every screen now judges is the new one', C.SP.log[0].kind === 'restore' && C.SP.log[0].before.title === after && C.SP.log[0].after.title === before && C.LI_WS.live.SP.R1.title === before);
    const item2 = C.spCompute(JAN).find(item => item.sku === 'R2');
    await C.spSendAll([{ item: item2, after: item2.title + ' X', patches: C.spPatches(item2, item2.title + ' X') }]);
    ok("a title Amazon refuses is never silent: ✕ with Amazon's reason in plain words and what to do", C.SP.result && !C.SP.result.results[0].ok && /longer than Amazon allows/.test(C.SP.result.results[0].why) && /shorten the title/.test(C.SP.result.results[0].todo), JSON.stringify(C.SP.result));
    C.LI_WS.on = true; C.liWsRender();
    const p = C.LI_WS.byKey.get('SP|P1');
    C.liWsPanelOpen('SP|P1');
    ok('Listing Health has no Season tab: the Workspace panel shows What to fix, Listings and Audit only', p && !/data-li-ws-ptab="season"/.test(C.el('lsPanel').innerHTML) && /data-li-ws-ptab="audit"/.test(C.el('lsPanel').innerHTML) && !/sp-root|sp-row/.test(C.el('lsPanel').innerHTML));
    C.liWsPanelClose(false);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
