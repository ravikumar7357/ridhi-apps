/* The Season planner (src/app/listing/season-planner.js) — the season rules of 13 Nov 2026 — over the real Listing Rules, Workspace
 * and child component, in a stub page.
 *   node tests/season-planner-test.js
 * ONLY seasons; the seasons on now come from the calendar by date (running now or starting soon; several at once; never a sale day);
 * two places only — Item Highlights and the hidden search words — the title is never changed; the word is added only where it is
 * missing, within 125 / 249; no room → expired season words out first, else "Fix by hand"; one row per season in the parent panel;
 * badges, rows and the child panel agree; ONE fix function; the season dates worked out every year.
 * Days are fixed (SP.today / spCompute(today)), so the answers do not drift with the calendar.
 * (Replaces the tests of the old title behaviour, and season-where-test.js / item-highlights-test.js.) */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const D = (y, m, d) => new Date(y, m - 1, d);
const NOV = D(2026, 11, 13);             // "today" in the spec: Thanksgiving (26 Nov) and Christmas (25 Dec) are on
const ymd = date => date.toISOString().slice(0, 10);

function setup(opts) {
  opts = opts || {};
  const posts = [];
  const C = load({ ws: true, sp: true, window: opts.window, post: body => { posts.push(body); return { ok: true, status: 'ACCEPTED', submissionId: 'sub-' + body.sku }; } });
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.SP.today = opts.today || NOV;
  // napkins and tablecloths: Item Highlights are one text of up to 125 letters
  ['SP', 'CPC'].forEach(b => ['NAPKIN', 'TABLECLOTH'].forEach(pt => { C.LI_WS.schema[b][pt] = { at: Date.now(), ok: [], hl: { items: 1, max: 125, bytes: 0 } }; }));
  C.LI_WS.schema.SP.NOHL = { at: Date.now(), ok: [], hl: { none: true } };
  const cat = {};
  const put = (sku, title, opt) => {
    opt = opt || {};
    const row = { brand: 'SP', parent: opt.parent || 'PS', sku, asin: 'B0' + sku, title, qty: 5, price: 12.5, status: 'Active', channel: 'AFN', aplus: true, aplusAt: Date.now(), checked: Date.now(),
      content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } };
    C.HEALTH.SP.rows.push(row);
    cat[sku] = Object.assign({ color: 'Blue', size: '18x18', subcat: 'Napkin Set' }, opt.cat || {});
    if (opt.kw !== undefined || opt.hl !== undefined) {
      const now = Date.now();
      C.LI_WS.live.SP[sku] = Object.assign({ at: now, cAt: now, pt: opt.pt || 'NAPKIN', title, titleLen: title.length, catTitle: title, tAt: now },
        opt.kw !== undefined ? { kw: opt.kw, kwBytes: C.lrKwBytes(opt.kw) } : { cAt: 0 }, opt.hl !== undefined ? { hl: opt.hl, hlAt: now } : {});
    }
    return row;
  };
  const done = () => { C.setCat('SP', cat); C.LI_WS.liveV++; C.reset(); C.SP.itemsKey = ''; };
  return { C, put, done, posts };
}
const byId = list => Object.fromEntries(list.map(item => [item.sku, item]));
const TITLE = color => `Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print - ${color}`;   // 63–66 letters

(async () => {
  console.log('== the season dates, worked out every year ==');
  {
    const { C } = setup();
    const ev = id => C.getLR().events.find(e => e.id === id);
    ok('Easter 2027 = 28 Mar, Easter 2028 = 16 Apr (the computus)', ymd(C.lrEventDate(ev('easter'), 2027)) === '2027-03-28' && ymd(C.lrEventDate(ev('easter'), 2028)) === '2028-04-16');
    ok('Thanksgiving 2026 = 26 Nov (4th Thursday of November)', ymd(C.lrEventDate(ev('thanksgiving'), 2026)) === '2026-11-26');
    ok("Mother's Day 2027 = 9 May (2nd Sunday of May), Father's Day 2027 = 20 Jun (3rd Sunday of June)", ymd(C.lrEventDate(ev('mother'), 2027)) === '2027-05-09' && ymd(C.lrEventDate(ev('father'), 2027)) === '2027-06-20');
    ok('Memorial Day 2027 = 31 May (last Monday of May), Labor Day 2027 = 6 Sep (1st Monday of September)', ymd(C.lrEventDate(ev('memorial'), 2027)) === '2027-05-31' && ymd(C.lrEventDate(ev('labor'), 2027)) === '2027-09-06');
    ok('fixed days: Christmas 25 Dec, New Year 1 Jan, Valentine\'s 14 Feb, St Patrick\'s 17 Mar, 4th of July, Halloween 31 Oct',
      [['christmas', '2026-12-25'], ['newyear', '2027-01-01'], ['valentine', '2027-02-14'], ['patrick', '2027-03-17'], ['july4', '2027-07-04'], ['halloween', '2026-10-31']].every(([id, d]) => ymd(C.lrEventDate(ev(id), +d.slice(0, 4))) === d));
    const easter = ev('easter');
    easter.on = { 2027: '2027-04-01' };
    ok('a date typed in the calendar wins for its year; the other years are still worked out', ymd(C.lrEventDate(easter, 2027)) === '2027-04-01' && ymd(C.lrEventDate(easter, 2028)) === '2028-04-16');
    delete easter.on;
  }

  console.log('== which seasons: running now or starting soon, several at once, never a sale day; they change by themselves ==');
  {
    const { C } = setup();
    const ids = day => C.spActive(C.getLR(), day).map(e => e.ev.id).join(',');
    ok('13 Nov 2026: Thanksgiving and Christmas, nearest first', ids(NOV) === 'thanksgiving,christmas', ids(NOV));
    ok('26 Nov: Thanksgiving is still on (its day)', ids(D(2026, 11, 26)).includes('thanksgiving'));
    ok('27 Nov (after 26 Nov): Thanksgiving is no longer on', !ids(D(2026, 11, 27)).includes('thanksgiving') && ids(D(2026, 11, 27)).includes('christmas'), ids(D(2026, 11, 27)));
    ok('25 Dec: Christmas on; 26 Dec (after 25 Dec): Christmas is no longer on, New Year\'s is', ids(D(2026, 12, 25)).includes('christmas') && !ids(D(2026, 12, 26)).includes('christmas') && ids(D(2026, 12, 26)).includes('newyear'), ids(D(2026, 12, 26)));
    ok('Black Friday and Cyber Monday are never a season to add, even on their own day', !/blackfriday|cybermonday/.test(ids(D(2026, 11, 27)) + ids(D(2026, 11, 30))));
    ok('a season starts showing its lead days before (Christmas: 75 days → from 11 Oct)', ids(D(2026, 10, 11)).includes('christmas') && !ids(D(2026, 10, 10)).includes('christmas'));
    C.SP.today = NOV;
    const line = strip(C.spNowHtml());
    ok('the top line: "Now: 🦃 Thanksgiving (26 Nov), 🎄 Christmas (25 Dec) · Next: 🎆 New Year\'s"', /Now: 🦃 Thanksgiving \(26 Nov\), 🎄 Christmas \(25 Dec\) · Next: 🎆 New Year's/.test(line), line);
  }

  console.log('== two places only — the title is never changed; added only where missing ==');
  const A = setup();
  {
    const { C, put, done } = A;
    put('N1', TITLE('Blue'), { kw: 'cotton dinner napkins', hl: ['Hand block printed cotton'] });                                // both missing in both places
    put('N2', TITLE('Red'), { kw: 'cotton napkins christmas', hl: ['Christmas table decor, soft cotton'] });                      // Christmas in both: Thanksgiving only
    put('N3', TITLE('Green'), { kw: 'cotton napkins thanksgiving christmas', hl: ['Soft cotton'] });                           // only Item Highlights miss them
    put('N4', TITLE('Grey'), { kw: 'cotton napkins thanksgiving christmas', hl: ['Thanksgiving and Christmas table decor'] });  // ready for the season
    put('N5', 'Ridhi Linen Summer Dress Floral Midi Length Women Clothing', { kw: 'dress', hl: [], cat: { subcat: 'Dress' } });     // clothing: no season applies
    put('N6', TITLE('Teal'), { kw: 'cotton napkins thanksgiving christmas', hl: ['Thanksgiving table decor, soft cotton'] });     // one season's phrase there already
    done();
    const by = byId(C.spCompute(NOV));
    ok('N6: "Thanksgiving table decor" + Christmas → one natural phrase: "Thanksgiving and Christmas table decor, soft cotton"', by.N6.hlAfter[0] === 'Thanksgiving and Christmas table decor, soft cotton', JSON.stringify(by.N6.hlAfter));
    ok('every listing\'s title stays exactly as it is', Object.values(by).every(item => item.after === item.title));
    ok('N1: both seasons missing in both places → Item Highlights get "Thanksgiving and Christmas table decor" in front, the search words "thanksgiving christmas"',
      by.N1.status === 'ready' && by.N1.hlAfter[0] === 'Thanksgiving and Christmas table decor, hand block printed cotton' && by.N1.kwAfter === 'cotton dinner napkins thanksgiving christmas',
      JSON.stringify([by.N1.status, by.N1.why, by.N1.hlAfter, by.N1.kwAfter]));
    ok('N2: Christmas already in both → only Thanksgiving is added, joining the phrase ("Christmas and Thanksgiving table decor"); Christmas keeps its capital',
      by.N2.seasons.join() === 'thanksgiving' && by.N2.hlAfter[0] === 'Christmas and Thanksgiving table decor, soft cotton' && by.N2.kwAfter === 'cotton napkins christmas thanksgiving', JSON.stringify([by.N2.hlAfter, by.N2.kwAfter]));
    ok('N3: the search words have both → they stay as they are; only Item Highlights change', by.N3.kwAfter === by.N3.kw && by.N3.hlAfter[0] === 'Thanksgiving and Christmas table decor, soft cotton', JSON.stringify([by.N3.kwAfter, by.N3.hlAfter]));
    ok('N4: both seasons in both places → Ready for the season, nothing to send', by.N4.kind === 'ok' && by.N4.status === 'ok' && !C.spChanges(by.N4));
    ok('N5: clothing → no season applies, nothing judged', by.N5.kind === 'none' && !by.N5.active.length);
    const all = Object.values(by).filter(item => item.status === 'ready');
    ok('the patches never name the title: only generic_keyword and title_differentiation', all.length === 4 && all.every(item => C.spPatches(item).every(p => /generic_keyword|title_differentiation/.test(p.path))), JSON.stringify(all.map(i => C.spPatches(i).map(p => p.path))));
    ok('the checks say so: "The title stays the same", within the limits, only the season words added', by.N1.checks.some(c => c.k === 'title' && c.ok === true) && by.N1.checks.every(c => c.ok !== false)
      && by.N1.checks.some(c => c.k === 'hl' && /within their limit \(65 of 125\)/.test(c.t)) && by.N1.checks.some(c => c.k === 'kw' && c.ok === true), JSON.stringify(by.N1.checks.map(c => c.t)));
  }

  console.log('== limits: 125 and 249; expired season words out first; else "Fix by hand" ==');
  {
    const { C, put, done } = setup();
    const pad = (text, n) => (text + ', machine washable, set of four, soft and absorbent, everyday dining').slice(0, n).replace(/[\s,]+$/, '');
    const hlOld = pad('Spring and Easter table decor, hand block printed cotton', 110);
    put('M1', TITLE('Blue'), { kw: 'cotton', hl: [hlOld] });                                                          // full with old words: they go
    put('M2', TITLE('Red'), { kw: 'cotton', hl: [pad('Hand block printed cotton napkins, soft cotton, machine washable, set of four, absorbent', 112)] });   // full, no old words
    // search words of about N bytes (Amazon counts the letters only, not the spaces)
    const WORDS = 'cotton napkin cloth dinner kitchen table linen reusable washable soft handmade printed block floral pattern blue red green rustic farmhouse wedding party brunch picnic buffet restaurant hotel cafe'.split(' ');
    const fill = (start, n) => { let t = start; for (let i = 0; C.lrKwBytes(t) < n; i++) t = (t + ' ' + WORDS[i % WORDS.length] + (i >= WORDS.length ? i : '')).trim(); return t; };
    put('M3', TITLE('Green'), { kw: fill('spring easter', 235), hl: ['Thanksgiving and Christmas table decor'] });          // full with old words: 235 + 21 > 249, without them it fits
    put('M4', TITLE('Grey'), { kw: fill('', 240), hl: ['Thanksgiving and Christmas table decor'] });                       // full, nothing old
    put('M5', 'Ridhi Spring Floral Tablecloth Cotton 60 x 90 Inch Block Print - Blue', { kw: fill('spring floral', 232), hl: ['Thanksgiving and Christmas table decor'], cat: { subcat: 'Rectangle Tablecloth', size: '60x90' }, pt: 'TABLECLOTH' });   // without “spring” it would fit (232 − 6 + 21 ≤ 249): it stays all the same
    done();
    const by = byId(C.spCompute(NOV));
    ok(`M1: Item Highlights (${hlOld.length}) have no room → "Spring" and "Easter" (over) come out first, then it fits, within 125`,
      by.M1.status === 'ready' && by.M1.removed.hl.includes('Spring') && by.M1.removed.hl.includes('Easter') && !/spring|easter/i.test(by.M1.hlAfter[0]) && /^Thanksgiving and Christmas table decor, hand block printed cotton/.test(by.M1.hlAfter[0]) && by.M1.hlAfter[0].length <= 125,
      JSON.stringify([by.M1.status, by.M1.why, by.M1.hlAfter]));
    ok('M2: Item Highlights full and no old season word → "Fix by hand" with the reason', by.M2.status === 'fix' && /no room in Item Highlights/.test(by.M2.why), by.M2.status + ' ' + by.M2.why);
    ok(`M3: hidden search words full (${C.lrKwBytes(by.M3.kw)}) → "spring" and "easter" out, the two names in, within 249`, by.M3.status === 'ready' && by.M3.removed.kw.length === 2 && /thanksgiving christmas$/.test(by.M3.kwAfter) && C.lrKwBytes(by.M3.kwAfter) <= 249,
      JSON.stringify([by.M3.status, by.M3.why, C.lrKwBytes(by.M3.kwAfter)]));
    ok('M4: search words full and nothing old in them → "Fix by hand": "the hidden search words are full"', by.M4.status === 'fix' && /hidden search words are full/.test(by.M4.why), by.M4.why);
    ok('M5: "Spring" describes the product (Spring Floral Tablecloth) → never taken out, even when that leaves no room', by.M5.status === 'fix' && /spring floral/.test(by.M5.kw) && !by.M5.removed.kw.length, by.M5.status + ' ' + by.M5.why);
  }

  console.log('== title over 75: Item Highlights still added, with the note ==');
  {
    const { C, put, done } = setup();
    const long = 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Reusable Dinner Napkins for Kitchen - Blue';
    put('T1', long, { kw: 'cotton thanksgiving christmas', hl: [] });
    done();
    const t = C.spCompute(NOV).find(item => item.sku === 'T1');
    ok('a title of ' + long.length + ' letters: Item Highlights get the seasons all the same, the title stays', t.status === 'ready' && t.hlAfter[0] === 'Thanksgiving and Christmas table decor' && t.after === long, JSON.stringify([t.status, t.why, t.hlAfter]));
    ok('…with the small note "Amazon shows Item Highlights only when the title is 75 letters or less" (never blocking)', /Amazon shows Item Highlights only when the title is 75 letters or less/.test(t.note) && t.checks.some(c => c.k === 'hl75' && c.pre)
      && /Amazon shows Item Highlights only when the title is 75 letters or less/.test(C.spKidHtml(t, null)));
  }

  console.log('== the parents list: badges, chips, Ready ==');
  {
    const { C, put, done } = setup();
    for (let i = 0; i < 14; i++) put('X' + i, TITLE('Blue'), { parent: 'PX', kw: i < 6 ? 'cotton thanksgiving christmas' : 'cotton thanksgiving', hl: i < 4 ? ['Thanksgiving and Christmas table decor'] : ['Thanksgiving table decor'] });
    for (let i = 0; i < 5; i++) put('Y' + i, TITLE('Red'), { parent: 'PY', kw: 'cotton thanksgiving christmas', hl: ['Thanksgiving and Christmas table decor'] });
    for (let i = 0; i < 3; i++) put('Z' + i, TITLE('Green'), { parent: 'PZ', kw: 'cotton', hl: ['Soft cotton'] });
    done();
    C.SP.on = true; C.SP.brand = 'SP'; C.SP.list = 'all';
    C.spRender();
    const page = C.el('spPane').innerHTML;
    const card = key => strip((page.match(new RegExp(`data-sp-group="SP\\|${key}"[^]*?Open ›`)) || [''])[0]);
    ok('PX: "🎄 Christmas missing · 10" (Thanksgiving is in all of them, so no Thanksgiving badge)', /🎄 Christmas missing · 10/.test(card('PX')) && !/Thanksgiving missing/.test(card('PX')), card('PX'));
    ok('PZ: "🦃 Thanksgiving missing · 3   🎄 Christmas missing · 3"', /🦃 Thanksgiving missing · 3 🎄 Christmas missing · 3/.test(card('PZ')), card('PZ'));
    ok('PY: no season problem → "✓ Ready for the season"', /✓ Ready for the season/.test(card('PY')), card('PY'));
    const chips = strip((page.match(/<div class="sp-chips">[^]*?<\/div>/) || [''])[0]);
    ok('the chips: All · 🦃 Thanksgiving missing · 🎄 Christmas missing · ✓ Ready, each with its parents', /All \d+ 🦃 Thanksgiving missing 1 🎄 Christmas missing 2 ✓ Ready \d+/.test(chips), chips);
    C.SP.list = 'miss:christmas'; C.spRender();
    ok('"Christmas missing" shows PX and PZ only', /SP\|PX/.test(C.el('spPane').innerHTML) && /SP\|PZ/.test(C.el('spPane').innerHTML) && !/SP\|PY/.test(C.el('spPane').innerHTML));
    C.SP.list = 'ready'; C.spRender();
    ok('"Ready" shows PY (and no parent with a season missing)', /SP\|PY/.test(C.el('spPane').innerHTML) && !/SP\|PX"/.test(C.el('spPane').innerHTML) && !/SP\|PZ"/.test(C.el('spPane').innerHTML));
    C.SP.list = 'all';

    console.log('== the parent panel: one row per season; the counts agree everywhere ==');
    C.spOpenParent('SP|PX');
    const P = C.el('spPanel').innerHTML;
    ok('PX: one row "🎄 Christmas missing — Item Highlights 10 · Search words 8 — 10 children [Fix all 10]"',
      /🎄 Christmas missing<\/b><small>Item Highlights 10 · Search words 8<\/small>/.test(P) && /fa-n">10 children</.test(P) && />Fix all 10</.test(P) && !/Thanksgiving missing/.test(P), strip(P).slice(0, 500));
    ok('then "4 children ready for the season", then the children list as it was', /4 children ready for the season/.test(strip(P)) && P.indexOf('sp-readyl') < P.indexOf('class="sp-rows"'));
    C.spCloseParent(false);
    C.spOpenParent('SP|PZ');
    const Z = C.el('spPanel').innerHTML;
    ok('PZ (Christmas + Thanksgiving both on): TWO rows, Thanksgiving first', (Z.match(/class="fa-row is-att"/g) || []).length === 2 && Z.indexOf('🦃 Thanksgiving missing') < Z.indexOf('🎄 Christmas missing'));
    C.SP.panel.open = new Set(['christmas']); C.spPanelsRender();
    const Zo = strip(C.el('spPanel').innerHTML);
    ok('"› Show all 3" lists the children: name · SKU · where missing → what the fix writes (Christmas only)', /Blue · 18 x 18 Inch Z0 Missing in Item Highlights and search words → Item Highlights: “Christmas table decor, soft cotton” · Search words: \+ christmas/.test(Zo), Zo.slice(0, 700));
    const g = C.spGroupOf('SP|PX');
    const rows = C.spSeasonRows(g);
    const xmas = rows.find(r => r.e.ev.id === 'christmas');
    const kidsX = g.all.filter(item => /✕ Item Highlights|✕ Hidden search words/.test(strip(C.spWhereHtml(item)).replace(/Where “Thanksgiving”[^W]*/, '')));
    ok('badge (10) = row (10) = children whose panel shows ✕ for Christmas (10)', xmas.kids.length === 10 && kidsX.length === 10, `${xmas.kids.length} / ${kidsX.length}`);

    console.log('== the child panel: only the two places, per season ==');
    const z0 = C.spCompute().find(item => item.sku === 'Z0');
    const kid = C.spKidHtml(z0, C.spGroupOf('SP|PZ'));
    ok('"Where “Thanksgiving” is" and "Where “Christmas” is": Item Highlights ✕ and Hidden search words ✕ — no title line', /Where “Thanksgiving” is/.test(kid) && /Where “Christmas” is/.test(kid)
      && /✕ Item Highlights: Christmas missing/.test(kid) && /✕ Hidden search words: Christmas missing/.test(kid) && !/data-sp-where="title"/.test(kid) && !/✓ Title|✕ Title/.test(kid));
    ok('"What changes": Item Highlights and the hidden search words before → after; "The title stays the same"', /Item Highlights before/.test(kid) && /Hidden search words before/.test(kid) && /The title stays the same/.test(kid) && !/Title before/.test(kid));
    ok('…one main button "Fix — send to Amazon" and "Not now" (no title Edit box)', /data-sp-act="approve"[^>]*>Fix — send to Amazon</.test(kid) && /Not now/.test(kid) && !/data-sp-act="edit"/.test(kid));
    const x9 = C.spCompute().find(item => item.sku === 'X9');
    ok('X9 (Thanksgiving in both, Christmas in neither): ✓ for Thanksgiving, ✕ for Christmas', /✓ Item Highlights: “Thanksgiving” found/.test(C.spKidHtml(x9, g)) && /✕ Item Highlights: Christmas missing/.test(C.spKidHtml(x9, g)));

    console.log('== ONE fix function: confirm window, the same checks, "N fixed · M need your OK" ==');
    C.SP.on = true;
    const r = C.spFixSeasons(xmas.kids.map(item => item.key), 'christmas');
    const modal = C.el('spModalBox').innerHTML;
    ok('Fix all 10 (Christmas): the confirm window lists the 10, says the title never changes', r.todo.length === 10 && /You are about to change 10 listings on Amazon \(Christmas\)/.test(modal) && /never the title/.test(modal) && /id="spSendBtn">Send 10 listings</.test(modal));
    ok('…each with only Christmas added (Thanksgiving is already there)', r.todo.every(t => t.item.hlAdd && /^Christmas/.test(t.item.hlAdd) && !/thanksgiving/i.test(t.item.kwAdd.join(' '))), JSON.stringify(r.todo[0].item.hlAfter));
  }

  console.log('== sending: the existing path; never the title; records; the result ==');
  {
    const { C, put, done, posts } = setup();
    put('S1', TITLE('Blue'), { parent: 'PQ', kw: 'cotton', hl: ['Soft cotton'] });
    put('S2', TITLE('Red'), { parent: 'PQ', kw: 'cotton', hl: [('Hand block printed cotton napkins, soft cotton, machine washable, set of four, absorbent, everyday dining table linen').slice(0, 118)] });
    done();
    C.SP.on = true;
    const g = C.spGroupOf('SP|PQ');
    const xmas = C.spSeasonRows(g).find(r => r.e.ev.id === 'christmas');
    const r = C.spFixSeasons(xmas.kids.map(item => item.key), 'christmas');
    await C.spSendAll(r.todo, r.held);
    ok('one listing sent through POST lfix=patch (apply), only search words and Item Highlights — never item_name', posts.length === 1 && posts[0].apply === true && posts[0].productType === 'NAPKIN'
      && posts[0].patches.every(p => p.path !== '/attributes/item_name') && posts[0].patches.some(p => p.path === '/attributes/generic_keyword' && p.value[0].value === 'cotton christmas'), JSON.stringify(posts[0] && posts[0].patches));
    C.SP.panel = null; C.spRender();
    const res = strip(C.el('spPane').innerHTML);
    ok('the result: "✓ 1 fixed · 1 need your OK (no room in Item Highlights …)"', /✓ 1 fixed · 1 need your OK \(no room in Item Highlights/.test(res), res.slice(0, 400));
    ok('…recorded with the old values (listingrules/seasonlog); the title the same before and after', C.SP.log.length === 1 && C.SP.log[0].before.kw === 'cotton' && C.SP.log[0].after.kw === 'cotton christmas' && C.SP.log[0].before.title === C.SP.log[0].after.title);
    const s1 = C.spCompute().find(item => item.sku === 'S1');
    ok('…and every screen now sees Christmas in the search words (the live entry); Thanksgiving is still missing', s1.miss.christmas.kw === 'found' && s1.miss.thanksgiving.kw === 'missing', JSON.stringify(s1.miss));
  }
  {
    const { C, put, done, posts } = setup({ window: { __TEST_ERP: true } });
    put('S1', TITLE('Blue'), { parent: 'PQ', kw: 'cotton', hl: ['Soft cotton'] });
    done();
    C.SP.on = true;
    C.spApprove(['SP|S1']);
    ok('the test site: the window says "Test site — not sent to Amazon"', /Test site — not sent to Amazon/.test(C.el('spModalBox').innerHTML));
    C.el('spSendBtn').onclick();
    C.SP.panel = null; C.spRender();
    ok('…Close: nothing sent; "Test site — not sent to Amazon. 1 would be fixed"', posts.length === 0 && /Test site — not sent to Amazon\. 1 would be fixed/.test(strip(C.el('spPane').innerHTML)));
  }

  console.log('== matching: whole words, any case, the other spellings; not read yet is never "missing" ==');
  {
    const { C, put, done } = setup();
    put('W1', TITLE('Blue'), { kw: 'xmas napkins thanksgiving', hl: ['CHRISTMAS-themed table decor'] });
    put('W2', TITLE('Red'), { kw: 'christmastree thanksgivings', hl: ['Soft cotton'] });
    put('W3', TITLE('Green'));                                                                                      // never read
    done();
    const by = byId(C.spCompute(NOV));
    ok('"Xmas" counts as Christmas; "CHRISTMAS-themed" too', by.W1.miss.christmas.kw === 'found' && by.W1.miss.christmas.hl === 'found');
    ok('"christmastree" is not the word Christmas (whole words only)', by.W2.miss.christmas.kw === 'missing');
    ok('a listing never read: "not read yet" — not missing, not ready, and counted nowhere', by.W3.kind === 'check' && by.W3.status === 'reading' && !C.spMissing(by.W3, 'christmas'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
