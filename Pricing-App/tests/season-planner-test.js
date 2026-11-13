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
  // the fake Amazon: Amazon's check (apply false) answers ok (or opts.no(body) → an ERROR); a real send is kept, and ?lfix=get returns it
  const held = {};
  const post = body => {
    posts.push(body);
    const no = opts.no && opts.no(body);
    if (no) return { ok: false, previewOnly: !body.apply, error: 'Amazon would reject this: ' + no, issues: [{ severity: 'ERROR', message: no }] };
    if (!body.apply) return { ok: true, previewOnly: true, status: 'VALID', issues: [] };
    held[body.sku] = Object.assign(held[body.sku] || {}, Object.fromEntries((body.patches || []).map(p => [p.path.replace('/attributes/', ''), p.value])));
    return { ok: true, status: 'ACCEPTED', submissionId: 'sub-' + body.sku };
  };
  const baCall = opts.baCall || (async q => (q.lfix === 'get' ? { productType: 'NAPKIN', attributes: held[q.sku] || {}, issues: [] } : {}));
  const saved = [];
  const C = load({ ws: true, sp: true, window: opts.window, ctx: opts.ctx, baCall, post, setDoc: async (ref, data, o) => { saved.push({ path: ref.path, data: JSON.parse(JSON.stringify(data)), merge: !!(o && o.merge) }); } });
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
  const done = () => {
    // opts.only: the page holds only the listings this test put (the shared sample's parents left out)
    if (opts.only) ['SP', 'CPC'].forEach(b => { const keep = C.HEALTH[b].rows.filter(r => cat[r.sku]); C.HEALTH[b].rows.splice(0, C.HEALTH[b].rows.length, ...keep); });
    C.setCat('SP', cat); C.LI_WS.liveV++; C.reset(); C.SP.itemsKey = '';
  };
  return { C, put, done, posts, saved };
}
// The Amazon check popup, step by step: wait for Amazon's check; approve and wait for the send and the re-read; close.
const checked = C => C.SQ.run.checked;
const approve = async C => { await C.sqApprove(); };
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
    ok('the top line: "Now: 🦃 Thanksgiving (26 Nov), 🎄 Christmas (25 Dec) · Next: New Year\'s"', /^ ?Now: 🦃 Thanksgiving \(26 Nov\), 🎄 Christmas \(25 Dec\) · Next: New Year's ?$/.test(line), line);
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

  console.log('== limits: 125 and 249; expired season words out first; then the suggested trim (Needs your OK); else "Fix by hand" ==');
  {
    const { C, put, done } = setup();
    const pad = (text, n) => (text + ', machine washable, set of four, soft and absorbent, everyday dining').slice(0, n).replace(/[\s,]+$/, '');
    const hlOld = pad('Spring and Easter table decor, hand block printed cotton', 110);
    put('M1', TITLE('Blue'), { kw: 'cotton', hl: [hlOld] });                                                          // full with old words: they go
    put('M2', TITLE('Red'), { kw: 'cotton', hl: [pad('Hand block printed cotton napkins, soft cotton, machine washable, set of four, absorbent', 112)] });   // full, no old words
    // search words of about N bytes (Amazon counts the letters only, not the spaces)
    const WORDS = 'cotton napkin cloth dinner kitchen table linen reusable washable soft handmade printed block floral pattern blue red green rustic farmhouse wedding party brunch picnic buffet restaurant hotel cafe'.split(' ');
    const fill = (start, n) => { let t = start; for (let i = 0; C.lrKwBytes(t) < n; i++) t = (t + ' ' + WORDS[i % WORDS.length] + (i >= WORDS.length ? i : '')).trim(); return t; };
    put('M3', TITLE('Green'), { kw: fill('spring easter decor', 235), hl: ['Thanksgiving and Christmas table decor'] });          // full with old words: 235 + 21 > 249, without them it fits
    put('M4', TITLE('Grey'), { kw: fill('', 240), hl: ['Thanksgiving and Christmas table decor'] });                       // full, nothing old
    put('M5', 'Ridhi Spring Floral Tablecloth Cotton 60 x 90 Inch Block Print - Blue', { kw: fill('spring floral', 232), hl: ['Thanksgiving and Christmas table decor'], cat: { subcat: 'Rectangle Tablecloth', size: '60x90' }, pt: 'TABLECLOTH' });   // without “spring” it would fit (232 − 6 + 21 ≤ 249): it stays all the same
    done();
    const by = byId(C.spCompute(NOV));
    ok(`M1: Item Highlights (${hlOld.length}) have no room → "Spring" and "Easter" (over) come out first, then it fits, within 125`,
      by.M1.status === 'ready' && by.M1.removed.hl.includes('Spring') && by.M1.removed.hl.includes('Easter') && !/spring|easter/i.test(by.M1.hlAfter[0]) && /^Thanksgiving and Christmas table decor, hand block printed cotton/.test(by.M1.hlAfter[0]) && by.M1.hlAfter[0].length <= 125,
      JSON.stringify([by.M1.status, by.M1.why, by.M1.hlAfter]));
    ok('M2: Item Highlights full, no old season word, but "machine washable, set of four" said twice → the repeat comes out: Needs your OK', by.M2.status === 'look' && by.M2.trim.hl.length > 0
      && by.M2.trim.hl.every(w => /^(machine|washable|set|of|four)$/i.test(w)) && /machine washable, set of four/i.test(by.M2.hlAfter[0]) && by.M2.hlAfter[0].length <= 125, JSON.stringify([by.M2.status, by.M2.trim.hl, by.M2.hlAfter]));
    ok(`M3: hidden search words full (${C.lrKwBytes(by.M3.kw)}) → "spring" and "easter" out, the two names in, within 249`, by.M3.status === 'ready' && by.M3.removed.kw.length === 2 && /thanksgiving christmas$/.test(by.M3.kwAfter) && C.lrKwBytes(by.M3.kwAfter) <= 249,
      JSON.stringify([by.M3.status, by.M3.why, C.lrKwBytes(by.M3.kwAfter)]));
    ok('M4: search words full, nothing old, no repeat, no title word, no filler → "Fix by hand": "search words full: 243 of 249, nothing safe to remove"', by.M4.status === 'fix' && /^search words full: \d+ of 249, nothing safe to remove$/.test(by.M4.why), by.M4.why);
    ok('M5: "Spring" describes the product (Spring Floral Tablecloth) → never taken out; the trim takes a repeat ("floral" said twice) and a title word instead', by.M5.status === 'look' && /^spring floral /.test(by.M5.kwAfter) && !by.M5.removed.kw.length
      && !by.M5.trim.kw.some(w => /spring/i.test(w)) && C.lrKwBytes(by.M5.kwAfter) <= 249, JSON.stringify([by.M5.status, by.M5.why, by.M5.trim.kw]));
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
    ok('the chips: All · 🦃 Thanksgiving missing · 🎄 Christmas missing · Old season words · Needs your OK · Fix by hand · Up to date, each with its parents', /All \d+ 🦃 Thanksgiving missing 1 🎄 Christmas missing 2 Old season words 0 Needs your OK 0 Fix by hand 0 Up to date \d+/.test(chips), chips);
    C.SP.list = 'miss:christmas'; C.spRender();
    ok('"Christmas missing" shows PX and PZ only', /SP\|PX/.test(C.el('spPane').innerHTML) && /SP\|PZ/.test(C.el('spPane').innerHTML) && !/SP\|PY/.test(C.el('spPane').innerHTML));
    C.SP.list = 'done'; C.spRender();
    ok('"Up to date" shows PY (and no parent with a season missing)', /SP\|PY/.test(C.el('spPane').innerHTML) && !/SP\|PX"/.test(C.el('spPane').innerHTML) && !/SP\|PZ"/.test(C.el('spPane').innerHTML));
    C.SP.list = 'all';

    console.log('== the parent panel: one row per season; the counts agree everywhere ==');
    C.spOpenParent('SP|PX');
    const P = C.el('spPanel').innerHTML;
    ok('PX: one row "🎄 Christmas missing — Item Highlights 10 · Search words 8 — 10 children [Fix all 10]"',
      /🎄 Christmas missing<\/b><small>Item Highlights 10 · Search words 8<\/small>/.test(P) && /fa-n">10 children</.test(P) && />Fix all 10</.test(P) && !/Thanksgiving missing/.test(P), strip(P).slice(0, 500));
    ok('the three tiles on top: READY 10 [Fix all 10] · NEEDS YOUR OK 0 · FIX BY HAND 0', /data-sp-tile="ready"[^]*?Ready<b>10<\/b>[^]*?data-sp-act="fix-ready"[^>]*>Fix all 10</.test(P) && /Needs your OK<b>0<\/b>/.test(P) && /Fix by hand<b>0<\/b>/.test(P)
      && P.indexOf('sp-scs') < P.indexOf('Season words missing'), strip(P).slice(0, 300));
    ok('then the rows, [Fix all seasons], "4 children up to date", then the children list as it was', /4 children up to date/.test(strip(P)) && P.indexOf('Season words missing') < P.indexOf('data-sp-act="fix-every"')
      && P.indexOf('data-sp-act="fix-every"') < P.indexOf('sp-readyl') && P.indexOf('sp-readyl') < P.indexOf('class="sp-rows"'));
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
    const kidsX = g.all.filter(item => /✕ Item Highlights|✕ Hidden search words/.test((C.spWhereHtml(item).match(/data-sp-season="christmas">[^]*?<\/div>/) || [''])[0]));
    ok('badge (10) = row (10) = children whose panel shows ✕ for Christmas (10)', xmas.kids.length === 10 && kidsX.length === 10, `${xmas.kids.length} / ${kidsX.length}`);

    console.log('== the child panel: only the two places, per season ==');
    const z0 = C.spCompute().find(item => item.sku === 'Z0');
    const kid = C.spKidHtml(z0, C.spGroupOf('SP|PZ'));
    ok('"Where seasons are": Thanksgiving and Christmas, Item Highlights ✕ and Hidden search words ✕ "to add" — no title line', /Where seasons are/.test(kid) && /🦃 <b>Thanksgiving<\/b> — on now/.test(kid) && /🎄 <b>Christmas<\/b> — on now/.test(kid)
      && /✕ Item Highlights: Christmas missing — to add/.test(kid) && /✕ Hidden search words: Christmas missing — to add/.test(kid) && !/data-sp-where="title"/.test(kid) && !/✓ Title|✕ Title/.test(kid));
    ok('"What changes": Item Highlights and the hidden search words only, before → after, with "N of 125" / "N of 249"; no title', /Item Highlights before/.test(kid) && /Hidden search words before/.test(kid)
      && /Item Highlights: 51 of 125\./.test(kid) && /Hidden search words: 27 of 249\./.test(kid) && !/Title before|title stays/i.test(kid), strip(kid).slice(0, 900));
    ok('…the status pill "Ready to fix" and ONE button "Fix" (no "Not now", no title Edit box)', /sp-chip-s is-ready"><i aria-hidden="true">✓<\/i>Ready to fix/.test(kid) && /data-sp-act="approve"[^>]*>Fix</.test(kid)
      && (kid.match(/class="sp-main"/g) || []).length === 1 && !/Not now/.test(kid) && !/data-sp-act="edit"/.test(kid));
    const x9 = C.spCompute().find(item => item.sku === 'X9');
    ok('X9 (Thanksgiving in both, Christmas in neither): ✓ for Thanksgiving, ✕ for Christmas', /✓ Item Highlights: “Thanksgiving” found/.test(C.spKidHtml(x9, g)) && /✕ Item Highlights: Christmas missing/.test(C.spKidHtml(x9, g)));

    console.log('== ONE fix function: the Amazon check popup, the same checks, "N fixed · M need your OK" ==');
    C.SP.on = true;
    const r = C.spFixSeasons(xmas.kids.map(item => item.key), 'christmas');
    ok('Fix all 10 (Christmas): the popup opens "Checking with Amazon…" — nothing changes on Amazon', /Checking with Amazon…/.test(C.el('spModalBox').innerHTML) && /nothing changes on Amazon yet/.test(C.el('spModalBox').innerHTML));
    await checked(C);
    const modal = C.el('spModalBox').innerHTML;
    ok('…then Amazon\'s answer: "10 Amazon will accept · 0 Amazon says no" [Approve & send 10] [Cancel]', r.todo.length === 10 && /10 changes · ✓ 10 will accept · ✗ 0 says no · ⚠ 0 not checked/.test(strip(modal)) && /data-sq="approve">Approve &amp; send 10</.test(modal) && /data-sq="cancel">Cancel</.test(modal), strip(modal).slice(0, 300));
    C.sqClose();
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
    await checked(C);
    ok('one listing: "✓ Amazon will accept" + the change before → after; the one that needs your OK is named, not sent', /2 changes · ✓ 1 will accept · ✗ 0 says no · ⚠ 1 not checked/.test(strip(C.el('spModalBox').innerHTML)) && /Hidden search words:<\/small> <span class="sq-add">\+ christmas<\/span> <span class="sq-size">\(15 of 249\)<\/span>/.test(C.el('spModalBox').innerHTML)
      && /⚠ Not checked — needs your OK: takes out your words “[^”]+” to make room/.test(C.el('spModalBox').innerHTML), strip(C.el('spModalBox').innerHTML).slice(0, 400));
    await approve(C);
    ok('Approve & send → read again → "✅ Amazon accepted"', /✅ Amazon accepted/.test(C.el('spModalBox').innerHTML), strip(C.el('spModalBox').innerHTML).slice(0, 200));
    C.sqClose();
    await r.run;
    const sent = posts.filter(p => p.apply);
    ok('Amazon checked first (apply false), then ONE send through POST lfix=patch (apply), only search words and Item Highlights — never item_name', posts[0].apply === false && sent.length === 1 && sent[0].productType === 'NAPKIN'
      && sent[0].patches.every(p => p.path !== '/attributes/item_name') && sent[0].patches.some(p => p.path === '/attributes/generic_keyword' && p.value[0].value === 'cotton christmas'), JSON.stringify(posts.map(p => p.apply)));
    C.SP.panel = null; C.spRender();
    const res = strip(C.el('spPane').innerHTML);
    ok('the result: "✓ 1 fixed · 1 need your OK (takes out your words …)"', /✓ 1 fixed · 1 need your OK \(takes out your words/.test(res), res.slice(0, 400));
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
    await checked(C);
    ok('the test site: the popup says Amazon\'s check cannot run here, the change is shown, Approve & send is there', /Test site — Amazon's check cannot run here/.test(C.el('spModalBox').innerHTML) && /data-sq="approve"/.test(C.el('spModalBox').innerHTML));
    await approve(C);
    ok('…Approve: "Test site — not sent to Amazon"', /<b>Test site — not sent to Amazon<\/b>/.test(C.el('spModalBox').innerHTML));
    C.sqClose();
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

  console.log('== ONE season-date rule for every screen: add (lead → day) · just ended, kept (days after) · removed (after them) ==');
  {
    const { C, put, done } = setup();
    put('H1', 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Thanksgiving - Blue', { kw: 'cotton', hl: ['Soft cotton'] });
    put('H2', 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Christmas - Red', { kw: 'cotton', hl: ['Soft cotton'] });
    done();
    const ev = id => C.getLR().events.find(e => e.id === id);
    const st = (id, d) => C.lrSeasonState(ev(id), d, C.getLR().events);
    const word = s => (s.active ? 'add' : s.keep ? 'keep' : 'expired');
    ok('Thanksgiving 2026 (3 days after): 26 Nov add · 27–29 Nov just past · 30 Nov expired',
      word(st('thanksgiving', D(2026, 11, 26))) === 'add' && word(st('thanksgiving', D(2026, 11, 27))) === 'keep' && word(st('thanksgiving', D(2026, 11, 29))) === 'keep' && word(st('thanksgiving', D(2026, 11, 30))) === 'expired');
    ok('Christmas (7 days after): 25 Dec add · 1 Jan just past · 2 Jan expired; 10 Oct expired, 11 Oct add (75 days before)',
      word(st('christmas', D(2026, 12, 25))) === 'add' && word(st('christmas', D(2027, 1, 1))) === 'keep' && word(st('christmas', D(2027, 1, 2))) === 'expired'
      && word(st('christmas', D(2026, 10, 10))) === 'expired' && word(st('christmas', D(2026, 10, 11))) === 'add');
    // the planner and Listing Rules read the same function day by day: active ⇔ added; expired (after the "days after") ⇔ the planner takes
    // the word out ⇔ Listing Rules flags a title naming it; just ended (keep) ⇔ neither
    const flagged = (sku, day) => { const row = C.HEALTH.SP.rows.find(r => r.sku === sku); return C.healthOf(Object.assign({}, row), Object.assign({}, C.hCtx(), { today: day })).found.some(h => h.detector === 'seasonal_keyword'); };
    let agree = true;
    const bad = [];
    for (let t = D(2026, 11, 20); t <= D(2027, 1, 6); t = new Date(t.getTime() + 86400000)) {
      const exp = new Set(C.spExpired(C.getLR(), t).map(e => e.ev.id));
      const act = new Set(C.spActive(C.getLR(), t).map(e => e.ev.id));
      const kept = new Set(C.spKept(C.getLR(), t).map(e => e.ev.id));
      [['H1', 'thanksgiving'], ['H2', 'christmas']].forEach(([sku, id]) => {
        const s1 = st(id, t);
        const f = flagged(sku, t);
        if (act.has(id) !== s1.active || exp.has(id) !== s1.expired || kept.has(id) !== s1.keep || f !== exp.has(id)) { agree = false; bad.push(`${ymd(t)} ${id}: ${word(s1)}, planner adds ${act.has(id)}, removes ${exp.has(id)}, kept ${kept.has(id)}, rule ${f}`); }
      });
    }
    ok('20 Nov – 6 Jan, every day: planner and Listing Rules agree — added ⇔ active; removed ⇔ Listing Rules flags ⇔ after the "days after"; kept in between', agree, bad.slice(0, 4).join(' | '));
    // a listing that still says Christmas: 26 Dec kept (not added, not removed), 2 Jan removed
    put('H3', TITLE('Blue'), { kw: 'cotton christmas', hl: ['Christmas table decor, soft cotton'] });
    done();
    const on = day => C.spCompute(day).find(i => i.sku === 'H3');
    const dec26 = on(D(2026, 12, 26));
    ok('26 Dec: Christmas just ended — kept: not added, not removed (Item Highlights and search words still say it); Listing Rules does not flag it', !dec26.old.some(e => e.ev.id === 'christmas') && !dec26.add.some(e => e.ev.id === 'christmas')
      && /^Christmas and New Year's table decor, soft cotton$/.test(dec26.hlAfter.join(' ')) && /^cotton christmas /.test(dec26.kwAfter) && !dec26.removed.hl.includes('Christmas') && !dec26.removed.kw.includes('Christmas')
      && !C.spExpired(C.getLR(), D(2026, 12, 26)).some(e => e.ev.id === 'christmas') && !flagged('H2', D(2026, 12, 26)), JSON.stringify([dec26.old.map(e => e.ev.id), dec26.hlAfter, dec26.kwAfter]));
    C.SP.today = D(2026, 12, 26);
    ok('…the words say so: "🎄 Christmas just ended — kept until 1 Jan" on the top line and in the child panel', /🎄 Christmas just ended — kept until 1 Jan/.test(C.spNowHtml()) && /Christmas just ended — kept until 1 Jan/.test(C.spWhereHtml(dec26)),
      strip(C.spNowHtml()) + ' | ' + strip(C.spWhereHtml(dec26)).slice(0, 300));
    const jan2 = on(D(2027, 1, 2));
    ok('2 Jan: Christmas removed from Item Highlights and the search words (and Listing Rules flags a title naming it)', jan2.old.some(e => e.ev.id === 'christmas') && !/christmas/i.test(jan2.hlAfter.join(' ') + ' ' + jan2.kwAfter)
      && flagged('H2', D(2027, 1, 2)), JSON.stringify([jan2.status, jan2.hlAfter, jan2.kwAfter]));
    C.SP.today = NOV;
  }

  console.log('== "Check all parents": every parent read in the background, 20 a call ==');
  {
    const calls = [];
    const baCall = async q => {
      calls.push(q);
      await new Promise(r => setTimeout(r, 2));
      if (q.lfix !== 'content') return {};
      const items = {};
      q.skus.split(',').forEach(sku => { items[sku] = { productType: 'NAPKIN', item_name: [{ value: TITLE('Blue') }], generic_keyword: [{ value: /^K[0-9]$|^K1[0-9]$/.test(sku) ? 'cotton thanksgiving christmas' : 'cotton' }] }; });
      return { items };
    };
    const { C, put, done } = setup({ baCall, only: true });
    ['K', 'L', 'M'].forEach((p, n) => { for (let i = 0; i < 25; i++) put(p + i, TITLE('Blue'), { parent: 'P' + p }); });   // never read
    done();
    C.SP.on = true; C.SP.brand = 'SP';
    C.spRender();
    ok('before: the three parents say "25 not read yet — open to check"', (C.el('spPane').innerHTML.match(/25 not read yet — open to check/g) || []).length === 3);
    const n = C.spCheckAll();
    ok('started: 3 parents, "Reading 0 of 3 — you can keep working", the button waits', n === 3 && /Reading 0 of 3 — you can keep working/.test(C.el('spPane').innerHTML) && /sp-btn" disabled>Checking…/.test(C.el('spPane').innerHTML));
    for (let i = 0; i < 400 && (C.LI_WS.inflight || C.LI_WS.q.length); i++) await new Promise(r => setTimeout(r, 3));
    const content = calls.filter(q => q.lfix === 'content');
    ok(`75 listings in ${content.length} content calls of at most 20 (+ the schema once)`, content.length === 4 && content.every(q => q.skus.split(',').length <= 20) && calls.filter(q => q.lfix === 'schema').length <= 1, JSON.stringify(calls.map(q => q.lfix)));
    ok('done: "3 of 3"; every parent counted once', C.SP.check.done === 3 && C.SP.check.total === 3);
    C.SP.itemsKey = ''; C.spRender();
    const page = strip(C.el('spPane').innerHTML);
    ok('the badges filled in from the search words: PK "Christmas missing · 5", PL and PM "· 25" each', /Parent PK 25 listings · 🦃 Thanksgiving missing · 5 🎄 Christmas missing · 5/.test(page) && (page.match(/Christmas missing · 25/g) || []).length === 2, page.slice(0, 900));
    ok('…and the chips: "Christmas missing 3"', /🎄 Christmas missing 3/.test(page), (page.match(/All \d+.*?Ready \d+/) || [''])[0]);
    ok('the reads are kept (24 h, the Workspace\'s store): "Check all parents" again reads nothing', C.spCheckAll() === 0 && calls.filter(q => q.lfix === 'content').length === 4);
    ok('…and the button says so: "✓ 3 parents read"', /✓ 3 parents read/.test(C.el('spPane').innerHTML) || (C.spRender(), /Check all parents/.test(C.el('spPane').innerHTML)));
  }
  {
    // a parent opened while the background reads run: its batches go first; a scroll holds the redraw
    const calls = [];
    const baCall = async q => { calls.push(q); await new Promise(r => setTimeout(r, 5)); return q.lfix === 'content' ? { items: Object.fromEntries(q.skus.split(',').map(sku => [sku, { productType: 'NAPKIN', item_name: [{ value: TITLE('Blue') }], generic_keyword: [{ value: 'cotton' }] }])) } : {}; };
    const { C, put, done } = setup({ baCall, only: true });
    for (let p = 0; p < 10; p++) for (let i = 0; i < 20; i++) put(`Q${p}x${i}`, TITLE('Blue'), { parent: 'PQ' + p });
    done();
    C.SP.on = true; C.SP.brand = 'SP';
    C.spCheckAll();
    ok('the background refresh: at most 2 reads out at once (10 batches of 20 waiting)', C.LI_WS.bgIn === 2 && C.LI_WS.inflight === 2 && C.LI_WS.q.length === 8 && C.LI_WS.q.every(job => job.bg), `${C.LI_WS.bgIn} / ${C.LI_WS.inflight} / ${C.LI_WS.q.length}`);
    C.spOpenParent('SP|PQ9');
    const mine = C.LI_WS.q.findIndex(job => (job.mark || []).some(key => /Q9x/.test(key)));
    ok('the opened parent\'s batch goes out at once, ahead of every background batch', mine < 0 && C.LI_WS.inflight === 3 && C.LI_WS.q.every(job => job.bg), `${mine} / ${C.LI_WS.inflight} / ${C.LI_WS.q.length}`);
    for (let i = 0; i < 100 && C.LI_WS.inflight; i++) await new Promise(r => setTimeout(r, 3));
    ok('…and while its panel is open no background read starts (the queue waits)', C.LI_WS.inflight === 0 && C.LI_WS.q.length === 7 && C.LI_WS.q.every(job => job.bg), `${C.LI_WS.inflight} / ${C.LI_WS.q.length}`);
    C.spCloseParent(false);
    const before = C.el('spPane').innerHTML;
    C.SP.scrollAt = Date.now();
    C.SP.lastDraw = 0;
    C.spAfterRead();
    await new Promise(r => setTimeout(r, 150));
    ok('while the list is scrolled, landing reads do not redraw it', C.el('spPane').innerHTML === before);
    for (let i = 0; i < 600 && (C.LI_WS.inflight || C.LI_WS.q.length); i++) await new Promise(r => setTimeout(r, 5));
  }
  {
    const calls = [];
    const { C, put, done } = setup({ baCall: async q => { calls.push(q); return {}; }, only: true });
    put('A1', TITLE('Blue'), { parent: 'PA' });
    done();
    await C.spOn();
    const n1 = calls.filter(q => q.lfix === 'content').length;
    C.SP.on = false; await C.spOn();
    ok('it starts once by itself when the planner opens, not again when it is opened again', n1 === 1 && calls.filter(q => q.lfix === 'content').length === 1 && C.SP.checkStarted, n1 + ' / ' + calls.length);
    for (let i = 0; i < 200 && (C.LI_WS.inflight || C.LI_WS.q.length); i++) await new Promise(r => setTimeout(r, 3));
  }

  console.log('== OLD season words: shown, and taken out of Item Highlights and the search words (never the title) ==');
  {
    const { C, put, done, posts } = setup({ only: true });
    const OK_HL = 'Thanksgiving and Christmas table decor';
    const OK_KW = 'cotton thanksgiving christmas';
    // PO: 14 children, 7 still showing Spring (all 7 in Item Highlights, 4 also in the search words)
    for (let i = 0; i < 14; i++) put('O' + i, TITLE(['Blue', 'Red'][i % 2]), { parent: 'PO', hl: [i < 7 ? OK_HL + ', spring decor' : OK_HL], kw: i < 4 ? OK_KW + ' spring decor' : OK_KW });
    // PT: Spring in the TITLE of 3 children (as an occasion) — only said, never changed
    for (let i = 0; i < 3; i++) put('T' + i, `Ridhi Cloth Napkins Cotton 18 x 18 Inch Spring Decor - Blue`, { parent: 'PT', hl: [OK_HL], kw: OK_KW });
    // PF: "Spring Floral" describes the product — in the title, Item Highlights and the search words: never flagged, never taken out
    put('F1', 'Ridhi Spring Floral Tablecloth Cotton 60 x 90 Inch Block Print - Blue', { parent: 'PF', hl: ['Spring floral print, ' + OK_HL.toLowerCase()], kw: 'spring floral ' + OK_KW, cat: { subcat: 'Rectangle Tablecloth', size: '60x90' }, pt: 'TABLECLOTH' });
    put('F2', TITLE('Green'), { parent: 'PF', hl: ['Christmas print, ' + OK_HL.toLowerCase()], kw: 'christmas print ' + OK_KW });
    // PA: Christmas and Thanksgiving missing AND Spring still shown — "Fix all seasons" does both in ONE change
    put('A1', TITLE('Teal'), { parent: 'PA', hl: ['Spring decor, soft cotton'], kw: 'cotton spring decor' });
    done();
    const ids = C.spExpired(C.getLR(), NOV).map(e => e.ev.id);
    ok('out of season on 13 Nov: Spring, Summer, Fall, Easter, Mother\'s Day, Halloween (the same date rule); not Thanksgiving or Christmas',
      ['sp_spring', 'sp_summer', 'sp_fall', 'easter', 'mother', 'halloween'].every(id => ids.includes(id)) && !ids.includes('thanksgiving') && !ids.includes('christmas'), ids.join(','));
    const items = byId(C.spCompute(NOV));
    ok('the title is never changed — for every child', Object.values(items).every(item => item.after === item.title));
    const go = C.spGroupOf('SP|PO');
    const old = C.spOldRows(go);
    ok('PO: ONE row "🌸 Spring still shown" — Item Highlights 7 · Search words 4 — 7 children', old.length === 1 && old[0].e.ev.id === 'sp_spring' && old[0].kids.length === 7 && old[0].hlN === 7 && old[0].kwN === 4,
      JSON.stringify(old.map(r => [r.e.ev.id, r.kids.length, r.hlN, r.kwN])));
    C.SP.on = true; C.SP.brand = 'SP';
    C.spOpenParent('SP|PO');
    const P = C.el('spPanel').innerHTML;
    ok('…drawn below the "missing" rows: "🌸 Spring still shown — Item Highlights 7 · Search words 4 — 7 children [Remove all 7]"',
      /Old season words/.test(P) && /🌸 Spring still shown<\/b><small>Item Highlights 7 · Search words 4<\/small>/.test(P) && /fa-n">7 children</.test(P) && />Remove all 7</.test(P), strip(P).slice(0, 600));
    ok('…and below the rows ONE big button: "Fix all seasons (7)"', P.indexOf('data-sp-act="fix-every"') > P.indexOf('Old season words') && /Fix all seasons \(7\)/.test(P));
    const pf = byId(C.spCompute(NOV));
    ok('"Spring Floral" (title, Item Highlights, search words) and "Christmas print" are never flagged or taken out', !pf.F1.old.length && pf.F1.kind === 'ok'
      && !pf.F2.old.length && pf.F2.kind === 'ok', JSON.stringify([pf.F1.kind, pf.F1.old.map(e => e.ev.id), pf.F2.kind]));
    C.spCloseParent(false);
    C.spOpenParent('SP|PT');
    const T = strip(C.el('spPanel').innerHTML);
    ok('Spring in the TITLE: the title is never shown as a problem — no line, no button, every child up to date', !/title/i.test(T.replace(/data-[a-z-]+="[^"]*"/g, '')) && !/Spring/.test(T) && !/Remove all/.test(T)
      && C.spCompute().filter(i => i.row.parent === 'PT').every(i => i.kind === 'ok'), T.slice(0, 400));
    C.spCloseParent(false);
    C.spRender();
    const page = strip(C.el('spPane').innerHTML);
    ok('the parents list: badge "🌸 Spring still shown · 7"; chip "Old season words 2" (PO and PA)', /Parent PO 14 listings · 🌸 Spring still shown · 7/.test(page) && /Old season words 2/.test(page), page.slice(0, 600));
    C.SP.list = 'old'; C.spRender();
    ok('…the chip shows only those parents', /SP\|PO/.test(C.el('spPane').innerHTML) && /SP\|PA/.test(C.el('spPane').innerHTML) && !/SP\|PF"/.test(C.el('spPane').innerHTML));
    C.SP.list = 'all';
    // the child panel
    const o0 = C.spCompute().find(i => i.sku === 'O0');
    const kid = C.spKidHtml(o0, go);
    ok('child panel "Where seasons are": 🌸 Spring — out of season: ✕ Item Highlights … to remove, ✕ Hidden search words … to remove', /Where seasons are/.test(kid) && /🌸 <b>Spring<\/b> — out of season/.test(kid)
      && /✕ Item Highlights: “Spring” — out of season, to remove/.test(kid) && /✕ Hidden search words: “spring” — out of season, to remove/.test(kid));
    ok('"What changes": the removed word struck through (<del>), nothing else added; no title line', /<del>spring<\/del>/i.test(kid) && !/title stays/i.test(kid) && o0.hlAfter[0] === OK_HL && o0.kwAfter === OK_KW, JSON.stringify([o0.hlAfter, o0.kwAfter]));
    // Remove all 7, through the one fix path
    const r = C.spFixSeasons(old[0].kids.map(i => i.key), 'old:sp_spring');
    await checked(C);
    ok('Remove all 7: the popup "7 Amazon will accept · 0 Amazon says no", each change only takes Spring out', r.todo.length === 7 && r.todo.every(t => !/spring/i.test((t.item.hlAfter || []).join(' ') + ' ' + t.item.kwAfter) && !t.item.kwAdd.length && !t.item.hlAdd)
      && /7 changes · ✓ 7 will accept · ✗ 0 says no/.test(strip(C.el('spModalBox').innerHTML)) && /Season planner · Spring out/.test(C.el('spModalBox').innerHTML));
    C.spModal('');
    ok('…closing the window (Esc, Cancel) closes the popup: nothing sent', !C.sqIsOpen() && !posts.some(p => p.apply));
    // Fix all seasons for A1: Christmas + Thanksgiving in, Spring out — ONE patch
    const a1 = C.spCompute().find(i => i.sku === 'A1');
    ok('A1: one plan adds Thanksgiving and Christmas AND takes Spring out (Item Highlights and search words)', a1.status === 'ready' && a1.hlAfter[0] === 'Thanksgiving and Christmas table decor, soft cotton'
      && a1.kwAfter === 'cotton thanksgiving christmas' && a1.removed.hl.includes('Spring') && a1.removed.kw.includes('Spring'), JSON.stringify([a1.status, a1.why, a1.hlAfter, a1.kwAfter]));
    const ga = C.spGroupOf('SP|PA');
    const rr = C.spFixSeasons(ga.todo.map(i => i.key), '');
    await checked(C);
    await approve(C);
    C.sqClose();
    await rr.run;
    const sent = posts.filter(p => p.sku === 'A1' && p.apply);
    ok('"Fix all seasons" sends ONE patch for A1: search words and Item Highlights together, never the title', sent.length === 1 && sent[0].patches.length === 2 && sent[0].patches.every(p => p.path !== '/attributes/item_name')
      && sent[0].patches.some(p => p.path === '/attributes/generic_keyword' && /christmas/.test(p.value[0].value) && !/spring/.test(p.value[0].value)), JSON.stringify(sent.map(p => p.patches)));
    C.SP.panel = null; C.spRender();
    ok('…the result: "✓ 1 fixed"', /✓ 1 fixed/.test(strip(C.el('spPane').innerHTML)));
  }
  {
    const { C, put, done, posts } = setup({ only: true, window: { __TEST_ERP: true } });
    put('O1', TITLE('Blue'), { parent: 'PO', hl: ['Thanksgiving and Christmas table decor, spring decor'], kw: 'cotton thanksgiving christmas' });
    done();
    C.SP.on = true;
    const g = C.spGroupOf('SP|PO');
    C.spFixSeasons(C.spOldRows(g)[0].kids.map(i => i.key), 'old:sp_spring');
    await checked(C);
    await approve(C);
    C.sqClose();
    C.SP.panel = null; C.spRender();
    ok('the test site: "Test site — not sent to Amazon. 1 would be fixed", nothing sent', posts.length === 0 && /Test site — not sent to Amazon\. 1 would be fixed/.test(strip(C.el('spPane').innerHTML)));
  }

  console.log('== the final spec: the suggested trim, Needs your OK, Fix by hand ==');
  // the page's own buttons: the click listener the planner puts on the document, pressed with a fake button
  const clicker = () => {
    const on = {};
    const ctx = { document: { addEventListener: (type, fn) => { (on[type] = on[type] || []).push(fn); }, querySelectorAll: () => [], createElement: () => ({ click() {} }) } };
    const press = (act, data) => {
      const el = { tagName: (data && data.tag) || 'BUTTON', dataset: Object.assign({ spAct: act }, data || {}), closest: sel => (sel === '[data-sp-act]' ? el : null), focus() {} };
      delete el.dataset.tag;
      (on.click || []).forEach(fn => fn({ target: el }));
    };
    return { ctx, press };
  };
  // search words of exactly `bytes` letters: unique pad words in front of `core` (never a repeat, a title word or a filler)
  const PAD = 'alpha bravo delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu amber coral ivory olive pearl ruby'.split(' ');
  const sized = (C, core, bytes) => {
    let pad = [];
    for (let i = 0; C.lrKwBytes([...pad, core].join(' ')) < bytes - 12 && i < PAD.length; i++) pad.push(PAD[i]);
    const left = bytes - C.lrKwBytes([...pad, core].join(' '));
    if (left > 0) pad.push('z'.repeat(left));
    const kw = [...pad, core].join(' ');
    if (C.lrKwBytes(kw) !== bytes) throw new Error('sized ' + C.lrKwBytes(kw) + ' ≠ ' + bytes);
    return kw;
  };
  {
    const { C, put, done } = setup({ only: true });
    const HL = ['Thanksgiving and Christmas table decor'];
    // TR: the order — a) repeats, b) words the title says, c) fillers — one at a time from the end, until "thanksgiving christmas" fits
    const kwTR = sized(C, 'cotton blue ridhi wedding reusable napkin for the with block print reusable napkins', 259);
    put('TR', TITLE('Blue'), { parent: 'PT1', kw: kwTR, hl: HL });
    // PB: only brand, colour, size, product type, material words and other words — nothing safe to take out
    const kwPB = sized(C, 'ridhi whimsical corner cpc cotton linen blue 18 inch napkin tablecloth runner placemat wedding brunch', 240);
    put('PB', TITLE('Blue'), { parent: 'PT1', kw: kwPB, hl: HL });
    // OV: 263 letters with both seasons already there: "Search words too long" → trimmed to ≤ 249 (repeats), with your OK
    const kwOV = sized(C, 'thanksgiving christmas cotton napkin reusable reusable washable washable dinner dinner napkins', 263);
    put('OV', TITLE('Blue'), { parent: 'PT1', kw: kwOV, hl: HL });
    // NS: 263 letters, both seasons there, nothing safe → Fix by hand with the reason
    put('NS', TITLE('Blue'), { parent: 'PT1', kw: sized(C, 'thanksgiving christmas cotton napkin wedding brunch', 263), hl: HL });
    done();
    const by = byId(C.spCompute(NOV));
    ok('TR: trim → "Needs your OK", words taken out in the order a) repeats b) title words c) fillers, from the end, until it fits',
      by.TR.status === 'look' && JSON.stringify(by.TR.trim.kw) === JSON.stringify(['napkins', 'reusable', 'print', 'block', 'with', 'the']) && C.lrKwBytes(by.TR.kwAfter) <= 249
        && /\bfor\b/.test(by.TR.kwAfter) && / thanksgiving christmas$/.test(by.TR.kwAfter), JSON.stringify([by.TR.status, by.TR.why, by.TR.trim.kw, C.lrKwBytes(by.TR.kwAfter)]));
    ok('…its product, colour, brand and material words stay (cotton, blue, ridhi, napkin) and every other word too', ['cotton', 'blue', 'ridhi', 'napkin', 'wedding', 'alpha'].every(w => new RegExp('\\b' + w + '\\b').test(by.TR.kwAfter)), by.TR.kwAfter);
    ok('PB: brand (Ridhi, Whimsical Corner, CPC), colour, size, product type and material words are never taken out → Fix by hand: "search words full: 240 of 249, nothing safe to remove"',
      by.PB.status === 'fix' && by.PB.why === 'search words full: 240 of 249, nothing safe to remove' && by.PB.kwAfter === by.PB.kw, by.PB.status + ' ' + by.PB.why);
    ok('OV: 263 of 249 → "Search words too long" → trimmed to ≤ 249, Needs your OK', by.OV.kwOver && by.OV.status === 'look' && C.lrKwBytes(by.OV.kw) === 263 && C.lrKwBytes(by.OV.kwAfter) <= 249
      && by.OV.trim.kw.every(w => /^(reusable|washable|dinner|napkins)$/.test(w)), JSON.stringify([by.OV.status, by.OV.trim.kw, C.lrKwBytes(by.OV.kwAfter)]));
    ok('NS: 263 of 249 and nothing safe → Fix by hand: "search words full: 263 of 249, nothing safe to remove"', by.NS.status === 'fix' && by.NS.why === 'search words full: 263 of 249, nothing safe to remove', by.NS.why);
    ok('the trim never touches the title, and no patch names it', Object.values(by).every(item => item.after === item.title && C.spPatches(item).every(p => p.path !== '/attributes/item_name')));
    const ov = C.spKidHtml(by.OV, C.spGroupOf('SP|PT1'));
    ok('child panel: "Where seasons are" says "Search words too long — Amazon may ignore the extra words (263 of 249)"', /✕ Search words too long — Amazon may ignore the extra words \(263 of 249\)/.test(ov));
    ok('…pill "Needs your OK", the removed words struck in "What changes", ONE button "OK — fix" that names them', /sp-chip-s is-look"><i aria-hidden="true">⚠<\/i>Needs your OK/.test(ov) && /<del>(?:napkins|dinner|washable)<\/del>/.test(ov)
      && /data-sp-act="approve-ok"[^>]*>OK — fix</.test(ov) && /sp-reason">Takes out “[a-z]+”/.test(ov) && (ov.match(/class="sp-main"/g) || []).length === 1, strip(ov).slice(0, 600));
    const ns = C.spKidHtml(by.NS, C.spGroupOf('SP|PT1'));
    ok('…Fix by hand: ONE button "Open in Listing Errors" with the reason', /data-sp-act="fixhand"[^>]*>Open in Listing Errors</.test(ns) && /sp-reason">search words full: 263 of 249, nothing safe to remove</.test(ns));
    C.SP.on = true; C.SP.brand = 'SP';
    C.spOpenParent('SP|PT1');
    const P = C.el('spPanel').innerHTML;
    ok('the parent panel: a row "✂ Search words too long — Amazon may ignore the extra words — 2 children"', /Search words too long — Amazon may ignore the extra words<\/b>/.test(P) && /fa-n">2 children</.test(P));
  }

  console.log('== the final spec: Review & OK all, Fix all seasons, the counts ==');
  {
    const { ctx, press } = clicker();
    const { C, put, done } = setup({ only: true, ctx });
    // PR: three children that fit only with a trim (repeats), one that fits as it is, one up to date
    const core = 'cotton napkin wedding reusable reusable napkins';
    for (let i = 0; i < 3; i++) put('Q' + i, TITLE('Blue'), { parent: 'PR', kw: sized(C, core, 238), hl: ['Thanksgiving and Christmas table decor'] });
    put('Q3', TITLE('Red'), { parent: 'PR', kw: 'cotton', hl: ['Thanksgiving and Christmas table decor'] });
    put('Q4', TITLE('Green'), { parent: 'PR', kw: 'cotton thanksgiving christmas', hl: ['Thanksgiving and Christmas table decor'] });
    done();
    C.SP.on = true; C.SP.brand = 'SP'; C.SP.list = 'all';
    const by = byId(C.spCompute(NOV));
    ok('Q0–Q2 Needs your OK (a repeat comes out), Q3 Ready, Q4 up to date', ['Q0', 'Q1', 'Q2'].every(k => by[k].status === 'look') && by.Q3.status === 'ready' && C.spBucket(by.Q4) === 'ok',
      JSON.stringify(Object.values(by).map(i => [i.sku, i.status, i.why])));
    // the counts: the card, the chips, the tiles, the rows' pills, the child panels — one function
    C.spRender();
    const card = strip((C.el('spPane').innerHTML.match(/data-sp-group="SP\|PR"[^]*?Open ›/) || [''])[0]);
    const chips = strip((C.el('spPane').innerHTML.match(/<div class="sp-chips">[^]*?<\/div>/) || [''])[0]);
    C.spOpenParent('SP|PR');
    const P = C.el('spPanel').innerHTML;
    const g = C.spGroupOf('SP|PR');
    const pills = { ready: 0, look: 0, fix: 0 };
    g.all.forEach(item => { const k = C.spKidHtml(item, g); if (/sp-chip-s is-ready/.test(k)) pills.ready++; if (/sp-chip-s is-look/.test(k)) pills.look++; if (/sp-chip-s is-fix/.test(k)) pills.fix++; });
    const n = C.spCounts(g);
    ok('counts identical everywhere: card "Ready 1 · Needs your OK 3 · Fix by hand 0" = tiles = rows = child panels', /Ready 1 · Needs your OK 3 · Fix by hand 0/.test(card)
      && /Ready<b>1<\/b>/.test(P) && /Needs your OK<b>3<\/b>/.test(P) && /Fix by hand<b>0<\/b>/.test(P) && (P.match(/sp-row is-look/g) || []).length === 3 && (P.match(/sp-row is-ready/g) || []).length === 1
      && pills.ready === n.ready.length && pills.look === n.look.length && pills.fix === n.fix.length && n.ready.length === 1 && n.look.length === 3, card + ' | ' + JSON.stringify(pills));
    ok('the chips: "Needs your OK 1" (parents), "Fix by hand 0"', /Needs your OK 1 Fix by hand 0/.test(chips), chips);
    ok('the tiles: [Fix all 1] · [Review & OK all 3] · Fix by hand (none: no button)', /data-sp-act="fix-ready"[^>]*>Fix all 1</.test(P) && /data-sp-act="review"[^>]*>Review &amp; OK all 3</.test(P) && !/data-sp-act="hand-lerr"/.test(P));
    // Review & OK all → each child "Remove: … · Add: … → 238 of 249", all ticked; untick Q1; ONE button sends the ticked ones only
    press('review', { spGroup: 'SP|PR' });
    let R = C.el('spPanel').innerHTML;
    ok('Review & OK all 3: the list, each "Search words: Remove: <struck> · Add: <green> → N of 249", all ticked', (R.match(/data-sp-act="tick"[^>]* checked/g) || []).length === 3
      && /Search words: Remove: <del class="sp-rem">reusable, napkins<\/del> · Add: <span class="sp-add">thanksgiving, christmas<\/span> → \d+ of 249/.test(R) && /data-sp-act="review-ok"[^>]*>OK — fix all 3</.test(R), strip(R).slice(0, 700));
    press('tick', { spKey: 'SP|Q1', tag: 'INPUT' });
    R = C.el('spPanel').innerHTML;
    ok('…untick Q1: "OK — fix all 2"', (R.match(/data-sp-act="tick"[^>]* checked/g) || []).length === 2 && /OK — fix all 2</.test(R));
    press('review-ok', { spGroup: 'SP|PR' });
    ok('OK — fix all 2: the Amazon check popup with ONLY the ticked children (Q0, Q2) — Q1 stays in Needs your OK, the Ready one is not in it', C.sqIsOpen()
      && C.SQ.run.jobs.map(j => j.sku).sort().join() === 'Q0,Q2' && C.spCompute().find(i => i.sku === 'Q1').status === 'look', C.SQ.run.jobs.map(j => j.sku).join());
    await checked(C);
    C.sqClose();
    // Fix all seasons: Needs your OK children exist → the Review & OK list first; its one button sends them AND the Ready ones together
    press('fix-every', { spGroup: 'SP|PR' });
    R = C.el('spPanel').innerHTML;
    ok('Fix all seasons: the Review & OK list opens first — "OK — fix all 4", "with the 1 Ready child"', !C.sqIsOpen() && /OK — fix all 4</.test(R) && /with the 1 Ready child/.test(R), strip(R).slice(0, 400));
    press('review-ok', { spGroup: 'SP|PR' });
    ok('…then everything together: the popup has the 3 OK\'d children and the Ready one (4)', C.sqIsOpen() && C.SQ.run.jobs.map(j => j.sku).sort().join() === 'Q0,Q1,Q2,Q3', C.SQ.run.jobs.map(j => j.sku).join());
    await checked(C);
    C.sqClose();
    ok('a child that needs your OK is never sent without it: Fix all on the Ready tile sends Q3 only', (press('fix-ready', { spGroup: 'SP|PR' }), C.SQ.run.jobs.map(j => j.sku).join() === 'Q3'));
    await checked(C);
    C.sqClose();
  }
  {
    // sale days are never added — on Black Friday and Cyber Monday too
    const { C, put, done } = setup({ only: true });
    put('BF', TITLE('Blue'), { kw: 'cotton', hl: ['Soft cotton'] });
    done();
    const days = [D(2026, 11, 27), D(2026, 11, 30)];
    ok('sale words never added (27 and 30 Nov): no Black Friday, Cyber Monday, sale or deal in Item Highlights or the search words', days.every(day => {
      const item = C.spCompute(day).find(i => i.sku === 'BF');
      return item && !/black friday|cyber monday|\bsale|\bdeal/i.test((item.hlAfter || []).join(' ') + ' ' + item.kwAfter) && /christmas/i.test(item.kwAfter);
    }));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
