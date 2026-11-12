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
  const put = (sku, title, extra) => {
    const row = Object.assign({ brand: 'SP', parent: 'PS', sku, asin: 'B0' + sku, title, qty: 5, price: 12.5, status: 'Active', channel: 'AFN', aplus: true, aplusAt: Date.now(), checked: Date.now(),
      content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } }, extra || {});
    C.HEALTH.SP.rows.push(row);
    return row;
  };
  // a live read for a SKU: the title Amazon shows, its hidden search words, and the product kind (needed to send)
  const live = (sku, title, kw) => { const now = Date.now(); C.LI_WS.live.SP[sku] = { at: now, cAt: now, pt: 'NAPKIN', title, titleLen: title.length, kw, kwBytes: C.lrKwBytes(kw) }; C.LI_WS.liveV++; };
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
    ok('"Spring" in November → Remove old season words: the word goes, nothing else changes (the in-season adds go to the search words)', by.S1 && by.S1.remove.some(e => e.ev.id === 'sp_spring') && /Thanksgiving/.test(by.S1.kwAfter)
      && by.S1.after === 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Dinner - Blue' && by.S1.status === 'ready', by.S1 && (by.S1.after + ' | ' + by.S1.status + ' ' + by.S1.why));
    ok('a short tablecloth title in November → Add: the nearest occasion goes into the title before " - Colour", never over 75, the rest to the search words',
      by.S2 && by.S2.kind === 'add' && by.S2.after === 'Ridhi Tablecloth 100% Cotton 60 x 90 Inch Block Print Thanksgiving - Red' && /Black Friday/.test(by.S2.kwAfter) && by.S2.status === 'ready', by.S2 && (by.S2.after + ' | ' + by.S2.kwAfter + ' | ' + by.S2.status + ' ' + by.S2.why));
    ok('…Christmas is added only inside its window: in November it is one of them', by.S2 && by.S2.add.some(e => e.ev.id === 'christmas') && /Christmas/.test(by.S2.kwAfter));
    ok('a full 75-letter title not read from Amazon yet: Reading (the words need the hidden search words)', by.S3 && by.S3.kind === 'add' && by.S3.after === by.S3.title && by.S3.status === 'reading', by.S3 && by.S3.status);
    ok('"Easter" in November → removed, and the in-season word put in its place', by.S4 && !/Easter/.test(by.S4.after) && by.S4.after === 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Thanksgiving - Green', by.S4 && by.S4.after);
    ok('a product that IS the occasion (Halloween napkins) keeps its word after Halloween', by.S5 && by.S5.remove.length === 0 && !/Halloween/.test(by.S5.add.map(e => e.ev.id).join()));
    ok('a title already naming an in-season occasion gets the next one, not that one twice', by.S6 && by.S6.after === 'Ridhi Napkins Cotton 18 x 18 Inch Print Thanksgiving Black Friday - Blue' && (by.S6.after.match(/Thanksgiving/g) || []).length === 1, by.S6 && by.S6.after);
    ok('a listing with no template (not in the catalogue) is never asked to add a season word', by.S7 && by.S7.kind === 'none', by.S7 && by.S7.kind);
    ok('brand, size and colour are never lost in any suggestion', items.filter(item => /^S\d$/.test(item.sku) && item.after !== item.title).every(item => /^Ridhi/.test(item.after) && /18 x 18 Inch|60 x 90 Inch/.test(item.after) && / - (Blue|Red|Green|Orange)$/.test(item.after)));
    ok('no suggested title is over 75 letters (one that already was is never made longer)', items.every(item => item.after.length <= Math.max(75, item.title.length)));
    ok('in July nothing is on: nothing to add', C.spCompute(JUL).filter(item => item.kind === 'add').length === 0, C.spCompute(JUL).filter(item => item.kind === 'add').map(i => i.sku + ':' + i.why).join());
    const soon = C.spCompute(JUL2).find(item => item.sku === 'S2');
    ok('a season coming within 30 days shows as "can be added from …", nothing to send yet', soon && soon.kind === 'add' && soon.status === 'look' && /Labor Day can be added from 17 Aug/.test(soon.why), soon && (soon.status + ' ' + soon.why));
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
    ok('a full title moves the words to the hidden search words, within their limit, words only, and the card says so', by.F1 && by.F1.after === full && /Thanksgiving/.test(by.F1.kwAfter) && C.lrKwBytes(by.F1.kwAfter) <= 249
      && /The title is full, so we added .* to the hidden search words instead \(the safest place\)/.test(by.F1.note) && by.F1.status === 'ready', by.F1 && (by.F1.kwAfter + ' | ' + by.F1.note + ' | ' + by.F1.status + ' ' + by.F1.why));
    ok('…what is sent then: the title and the hidden search words', by.F1 && C.spPatches(by.F1, by.F1.after).map(p => p.path).join() === '/attributes/item_name,/attributes/generic_keyword');
    ok("a full title with full search words: ✕ Can't do safely, with the reason", by.F2 && by.F2.status === 'no' && /full too/.test(by.F2.why), by.F2 && by.F2.why);
    ok('the words already in the search words: Up to date', by.F3 && by.F3.kind === 'ok', by.F3 && by.F3.kind);
    ok("a listing Amazon could not read: ✕ with Amazon's reason, not stuck on Reading", by.F4 && by.F4.status === 'no' && /could not be read/.test(by.F4.why), by.F4 && (by.F4.status + ' ' + by.F4.why));
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
    ok('the card: Approve is disabled while a check fails, the reason is beside it; Edit, Copy and Not now are there', (() => {
      C.SP.edits.set('SP|F1', full + ' Extra');
      const h = C.spCardHtml(by.F1, 'page');
      C.SP.edits.delete('SP|F1');
      return /data-sp-act="approve" data-sp-key="SP\|F1" disabled/.test(h) && /sp-reason">the title is too long by 6 letters/.test(h) && /data-sp-act="skip"/.test(h) && /data-sp-act="edit"/.test(h) && /data-sp-act="copy"/.test(h);
    })());
    ok('…and enabled once they all pass; the card shows picture, name, SKU / ASIN small, Now on Amazon, Suggested, the letter count, ✓ Ready', (h => !/data-sp-act="approve" data-sp-key="SP\|F1" disabled/.test(h) && /class="ls-pic/.test(h) && /sp-card-t"><b/.test(h) && /ui-mono">F1</.test(h) && /Now on Amazon/.test(h) && /75 of 75/.test(h) && /<i>✓<\/i>Ready/.test(h))(C.spCardHtml(by.F1, 'page')), C.spCardHtml(by.F1, 'page').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
    ok('the changed words are marked: added green, removed red', C.spDiffHtml('Ridhi Napkins Spring Dinner - Blue', 'Ridhi Napkins Christmas Dinner - Blue') === 'Ridhi Napkins <del>Spring</del> <ins>Christmas</ins> Dinner - Blue', C.spDiffHtml('Ridhi Napkins Spring Dinner - Blue', 'Ridhi Napkins Christmas Dinner - Blue'));
    ok("no code words on the screen: no 'bytes', 'attribute', 'detector', 'API' or 'VALIDATION'", !/bytes|attribute|detector|\bAPI\b|VALIDATION|generic_keyword|item_name/.test(C.spCardHtml(by.F1, 'page') + C.spCardHtml(by.F2, 'page')));
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
    ok('a record without the old title says so plainly, and cannot be sent', j2 && j2.kind === 'restore' && j2.status === 'no' && /old title was not kept/.test(j2.why), j2 && j2.why);
    ok('…and such a listing is not also in the Remove list', j1 && j1.remove.length === 0 && j2 && j2.remove.length === 0);
    C.SP.on = true;
    C.spApprove(['SP|R1']);
    const modal = C.el('spModalBox').innerHTML;
    ok('Approve opens the confirm window in plain words: [Send 1 title] [Cancel], Amazon checks first, the old title can be put back',
      /You are about to change 1 title on Amazon/.test(modal) && /Amazon checks each one first/.test(modal) && /You can put the old titles back after the season/.test(modal) && /id="spSendBtn">Send 1 title</.test(modal) && /id="spCancelBtn">Cancel</.test(modal), modal.slice(0, 300));
    await C.spSendAll([{ item: j1, after: j1.after, patches: C.spPatches(j1, j1.after) }]);
    ok('the send goes through the existing path (POST lfix=patch, apply, the product kind, by the signed-in person): Amazon checks first', posts.length === 1 && posts[0].lfix === 'patch' && posts[0].apply === true && posts[0].productType === 'NAPKIN' && posts[0].patches[0].value[0].value === before && posts[0].by === 'test@example.com', JSON.stringify(posts[0] || {}).slice(0, 200));
    ok('…the result says it in plain words', C.SP.result && C.SP.result.results[0].ok && /1 title sent\. Amazon usually shows them within a few hours/.test((C.spRender(), C.el('spPane').innerHTML)), C.el('spPane').innerHTML.slice(0, 200));
    ok('…what was sent is recorded with the old title (kind: restore), and the title every screen now judges is the new one', C.SP.log[0].kind === 'restore' && C.SP.log[0].before.title === after && C.SP.log[0].after.title === before && C.LI_WS.live.SP.R1.title === before);
    const item2 = C.spCompute(JAN).find(item => item.sku === 'R2');
    await C.spSendAll([{ item: item2, after: item2.title + ' X', patches: C.spPatches(item2, item2.title + ' X') }]);
    ok("a title Amazon refuses is never silent: ✕ with Amazon's reason in plain words and what to do", C.SP.result && !C.SP.result.results[0].ok && /longer than Amazon allows/.test(C.SP.result.results[0].why) && /shorten the title/.test(C.SP.result.results[0].todo), JSON.stringify(C.SP.result));
    C.LI_WS.on = true; C.liWsRender();
    const p = C.LI_WS.byKey.get('SP|P1');
    ok("the Workspace panel's Season tab draws the same cards for one parent", p && /sp-root sp-in-panel/.test(C.spPanelHtml(p)) && typeof C.spPanelCount(p) === 'number');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
