/* Fix all titles (src/app/listing/title-fix.js) over the real Listing Rules, Workspace, Fix all, send path and Listing History, in a stub page.
 *   node tests/title-fix-test.js
 * Mock data: parent PB of napkins — good siblings that say "Block Print", one child per title problem (template, size format, dimension
 * order, under-optimized, too long, keyword missing), one child with ALL of them, one whose Amazon facts have no material, one whose
 * Amazon colour is not the catalogue's, one whose colour is so long the required parts pass 75; parent PC (no Block Print in the family)
 * with a child whose print goes to fit 75. Every new title is judged again by every rule; edits are judged live; the test site sends
 * nothing; each send is in the change log (History, Put back) and Listing History ("Titles · Fix all"); fixed children leave the rows. */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const JUL = new Date(2026, 6, 15);
const wait = async (cond, n) => { for (let i = 0; i < (n || 400) && !cond(); i++) await new Promise(r => setTimeout(r, 1)); };
const GOOD = (size, color) => `Ridhi Cloth Napkins 100% Cotton ${size.replace('x', ' x ')} Inch Block Print - ${color}`;

/* The family. title: the title Amazon shows; cat: the catalogue's { color, size }; amz: what Amazon's attributes hold (?lfix=get) — by
 * default the catalogue's colour and size and "Cotton". */
const KIDS = {
  G0: { title: GOOD('18x18', 'Blue'), cat: { color: 'Blue', size: '18x18' } },
  G1: { title: GOOD('20x20', 'Red'), cat: { color: 'Red', size: '20x20' } },
  G2: { title: GOOD('18x18', 'Green'), cat: { color: 'Green', size: '18x18' } },
  G3: { title: GOOD('20x20', 'Grey'), cat: { color: 'Grey', size: '20x20' } },
  G4: { title: GOOD('18x18', 'Sage'), cat: { color: 'Sage', size: '18x18' } },
  T1: { title: 'Cloth Napkins by Ridhi 100% Cotton 18 x 18 Inch Block Print - Rust', cat: { color: 'Rust', size: '18x18' }, want: ['title_template'] },
  S1: { title: 'Ridhi Cloth Napkins 100% Cotton 20x20 Inches Block Print - Navy', cat: { color: 'Navy', size: '20x20' }, want: ['size_format'] },
  D1: { title: 'Ridhi Cloth Napkins 100% Cotton 20 x 14 Inch Block Print - Teal', cat: { color: 'Teal', size: '14x20' }, want: ['dimension_order'] },
  O1: { title: 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print - Pink', cat: { color: 'Pink', size: '18x18' }, want: ['title_length'] },
  L1: { title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Reusable Dinner Napkins for Kitchen Party - Ivory', cat: { color: 'Ivory', size: '18x18' }, want: ['title_length'] },
  K1: { title: 'Ridhi Cloth Napkins 100% Cotton 20 x 20 Inch Reusable Dinner - Mustard', cat: { color: 'Mustard', size: '20x20' }, want: ['title_keyword'] },
  A1: { title: 'Napkins Ridhi Cotton 20x14 - Plum', cat: { color: 'Plum', size: '14x20' }, want: ['dimension_order', 'size_format', 'title_keyword', 'title_length', 'title_template'] },
  M1: { title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Reusable Dinner Napkins for Party - Olive', cat: { color: 'Olive', size: '18x18' }, amz: { material: '' } },
  C1: { title: 'Ridhi Cloth Napkins 100% Cotton 20 x 20 Inch Block Print Reusable Dinner Napkins Set - Black', cat: { color: 'Black', size: '20x20' }, amz: { color: 'Red' } },
  X1: { title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Reusable Napkins - Indigo Blue and Rust Orange Stripe', cat: { color: 'Indigo Blue and Rust Orange Stripe', size: '18x18' } },
};
// Parent PC: no sibling says Block Print — the print is optional there and goes first (after the uses) to fit 75.
const KIDS_PC = {
  P0: { title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Reusable Dinner Napkins - Lime', cat: { color: 'Lime', size: '18x18' } },
  P1: { title: 'Ridhi Cloth Napkins 100% Cotton 20 x 20 Inch Reusable Dinner Napkins - Gold', cat: { color: 'Gold', size: '20x20' } },
  // P2: Amazon's pattern attribute says Block Print (its title does not, nor any sibling's): the print is a fact, but optional here
  P2: { title: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Reusable Dinner Napkins Set - Dusty Rose Pink Stripe', cat: { color: 'Dusty Rose Pink Stripe', size: '18x18' }, amz: { pattern: 'Block Print' } },
};

function setup(opts) {
  opts = opts || {};
  const saved = [];
  let C;
  const amazon = opts.amazon || {};
  const sentTitle = sku => { const p = C.calls.filter(c => c.lfix === 'patch' && c.apply && c.sku === sku).slice(-1)[0]; const t = p && p.patches.find(x => x.path === '/attributes/item_name'); return t ? t.value[0].value : ''; };
  const all = Object.assign({}, KIDS, KIDS_PC);
  const attrsOf = sku => {
    const k = all[sku] || {};
    const f = Object.assign({ color: k.cat && k.cat.color, size: k.cat && k.cat.size, material: 'Cotton' }, k.amz || {}, (opts.amz || {})[sku] || {});
    const out = {};
    Object.keys(f).forEach(n => { if (f[n]) out[n] = [{ value: f[n], language_tag: 'en_US', marketplace_id: 'ATVPDKIKX0DER' }]; });
    return out;
  };
  const gets = [];
  const baCall = async q => {
    if (q.lfix === 'content') {
      const items = {};
      q.skus.split(',').forEach(sku => {
        const title = sku !== amazon.work && sentTitle(sku) || (C.LI_WS.live.SP[sku] || {}).catTitle;
        items[sku] = { productType: 'NAPKIN', item_name: [{ value: title }], bullet_point: [1, 2, 3, 4, 5].map(n => ({ value: 'b' + n })), product_description: [{ value: 'd'.repeat(300) }], generic_keyword: [{ value: 'cotton' }] };
      });
      return { items };
    }
    if (q.lfix === 'get') {
      gets.push(q.sku);
      return { productType: 'NAPKIN', status: ['BUYABLE', 'DISCOVERABLE'],
        attributes: Object.assign(attrsOf(q.sku), q.sku !== amazon.work && sentTitle(q.sku) ? { item_name: [{ value: sentTitle(q.sku), language_tag: 'en_US' }] } : {}),
        issues: q.sku === amazon.rej ? [{ severity: 'ERROR', message: 'The provided value for item_name is not a valid value', attrs: ['item_name'] }] : [] };
    }
    return {};
  };
  C = load({ ws: true, sp: true, fa: true, lh: true, baCall, post: opts.post, window: opts.window,
    setDoc: async (ref, data) => { saved.push({ path: ref.path, data: JSON.parse(JSON.stringify(data)) }); },
    ctx: { imOnly() {}, leOnly() {}, leShow() {}, leListEnsure() {}, imListRender() {} } });
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.SP.today = JUL;
  C.FA.log = [];
  ['SP', 'CPC'].forEach(b => { C.LI_WS.schema[b].NAPKIN = { at: Date.now(), ok: [], hl: { none: true } }; });
  if (opts.rules) opts.rules(C.getLR());
  const now = Date.now();
  C.HEALTH.SP.rows.length = 0;          // only this mock family (not the rules test's sample rows)
  C.HEALTH.CPC.rows.length = 0;
  const cat = {};
  const put = (parent, sku, k) => {
    const title = k.title;
    C.HEALTH.SP.rows.push({ brand: 'SP', parent, sku, asin: 'B0' + sku, title, qty: 5, price: 12.5, status: 'Active', channel: 'AFN', aplus: true, aplusAt: now, checked: now,
      content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } });
    cat[sku] = Object.assign({ subcat: 'Napkin Set' }, k.cat);
    C.LI_WS.live.SP[sku] = { at: now, cAt: now, pt: 'NAPKIN', title, titleLen: title.length, catTitle: title, tAt: now, kw: 'cotton', kwBytes: 6, bul: 5, desc: 300 };
  };
  Object.entries(KIDS).forEach(([sku, k]) => put('PB', sku, k));
  Object.entries(KIDS_PC).forEach(([sku, k]) => put('PC', sku, k));
  C.setCat('SP', cat);
  // the facts Sellora already holds (as the ListingMatch cache would): only when asked — else the popup reads them from Amazon
  if (opts.facts) Object.keys(cat).forEach(sku => { const a = attrsOf(sku); const va = {}; Object.keys(a).forEach(n => { va[n] = a[n][0].value; }); C.TT.read.set('SP|' + sku, { va, pt: 'NAPKIN', at: now }); });
  C.TT.readV++;
  C.LI_WS.liveV++;
  C.reset();
  return { C, saved, gets };
}
const patchCalls = (C, apply) => C.calls.filter(c => c.lfix === 'patch' && c.apply === apply);
const planOf = (C, sku) => C.TT.run.plans.find(p => p.sku === sku);
// A popup opened (Workspace, Listing Errors, one Fix): wait for its reads and plans.
const ready = C => wait(() => C.TT.run && C.TT.run.plans.length && !C.TT.run.total);

(async () => {
  console.log('== the children with a title problem: each problem found, the good siblings in no row ==');
  {
    const { C } = setup();
    const rows = C.ttRows('SP');
    const by = Object.fromEntries(rows.map(r => [r.row.sku, r.hits.map(h => h.detector).sort()]));
    Object.entries(KIDS).filter(([, k]) => k.want).forEach(([sku, k]) => ok(`${sku}: ${k.want.join(' + ')}`, JSON.stringify(by[sku]) === JSON.stringify(k.want.slice().sort()), JSON.stringify(by[sku])));
    ok('the good siblings (G0–G4, P0, P1) have no title problem', ['G0', 'G1', 'G2', 'G3', 'G4', 'P0', 'P1'].every(s => !by[s]), Object.keys(by).join());
    ok('the six problems are the ones fixed (TT_DETS)', JSON.stringify(C.TT_DETS) === JSON.stringify(['title_template', 'size_format', 'dimension_order', 'title_length', 'title_keyword']));
  }

  console.log('== the Workspace: each title row gets ONE "Fix N titles" — its own count; the popup is the family\'s ==');
  {
    const { C, gets, saved } = setup();
    const kids = C.faKids('SP', 'PB');
    const groups = C.faGroups('SP', 'PB', kids);
    const tt = groups.filter(g => g.kind === 'ttl');
    ok('every title problem is a "ttl" row (one per problem, "Title too long" its own)', tt.length >= 5 && tt.some(g => g.key === 'title' && g.name === 'Title too long') && tt.some(g => g.name === 'Size formatting inconsistent')
      && tt.some(g => g.name === 'Dimension order inconsistent') && tt.some(g => g.name === "Title doesn't follow template") && tt.some(g => g.name === 'Important title keyword missing') && tt.some(g => g.name === 'Title slightly under-optimized'),
      groups.map(g => g.key + ':' + g.kind + ':' + g.kids.length).join(' '));
    const html = C.faBlockHtml('SP', 'PB');
    const n = C.ttRows('SP').filter(r => r.row.parent === 'PB').length;
    const btns = html.match(/>Fix (\d+) titles?</g) || [];
    const own = tt.map(g => C.faPlans(g, C.hCtx()).filter(p => p.ok || p.wait).length);
    const want = own.map(k => `>Fix ${k} title${k === 1 ? '' : 's'}<`);
    ok(`each title row's button shows ITS OWN count ("Fix ${own.join(' / ')} titles"), not the family's ${n}`, btns.length === tt.length && JSON.stringify(btns) === JSON.stringify(want) && own.some(k => k !== n) && !/>Fix all \d+ children</.test(html), btns.join(' ') + ' | want ' + want.join(' '));
    ok('…its tooltip names the family total the popup shows', tt.every(g => new RegExp(`data-fa-row="SP\\|PB\\|${g.key.replace(/[|:]/g, m => '\\' + m)}"[^>]*title="[^"]*the preview shows all ${n} children of this family`).test(html)), html.match(/data-fa-act="fix"[^>]*>/g));
    ok('…what we will do, in plain words', /One new title per child from the title template and its own Amazon facts — every title problem of the family fixed at once/.test(html));
    C.FA.open.add('SP|PB|rule:size_format');
    ok('"› Show all": a child whose facts are not read yet says "read from Amazon when you press Fix all", with its own Fix', /S1[^]*read from Amazon when you press Fix all[^]*data-fa-act="one"[^>]*data-fa-sku="S1"/.test(C.faBlockHtml('SP', 'PB')));
    ok('nothing read from Amazon just by drawing', gets.length === 0, gets.join());

    console.log('== Fix all → the preview reads what Sellora does not hold, then shows every child ==');
    const pr = C.faStart('SP|PB|rule:size_format');
    ok('the popup says it is reading (nothing changes on Amazon)', /Reading the listings' attributes from Amazon… 0 of \d+/.test(C.el('spModalBox').innerHTML), strip(C.el('spModalBox').innerHTML).slice(0, 200));
    await ready(C);
    const run = C.TT.run;
    ok(`each child of the family with a title problem read once (?lfix=get), ${n} in all`, gets.length === n && new Set(gets).size === n, gets.join());
    ok('ONE popup for every title problem of the family (not only this row\'s)', run.plans.length === n && ['T1', 'S1', 'D1', 'O1', 'L1', 'K1', 'A1'].every(s => planOf(C, s)));
    const p = s => planOf(C, s);
    const expect = {
      T1: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print - Rust',
      S1: 'Ridhi Cloth Napkins 100% Cotton 20 x 20 Inch Block Print - Navy',
      D1: 'Ridhi Cloth Napkins 100% Cotton 14 x 20 Inch Block Print - Teal',
      O1: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print - Pink',
      L1: 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print - Ivory',
      K1: 'Ridhi Cloth Napkins 100% Cotton 20 x 20 Inch Block Print - Mustard',
      A1: 'Ridhi Cloth Napkins 100% Cotton 14 x 20 Inch Block Print - Plum',
    };
    Object.entries(expect).forEach(([sku, t]) => ok(`${sku} → "${t}"`, p(sku).ok && p(sku).after === t, p(sku).after + ' · ' + p(sku).why));
    ok('template order: brand, product, material, size, print, colour', Object.keys(expect).every(s => /^Ridhi Cloth Napkins 100% Cotton \d+ x \d+ Inch Block Print - \w+$/.test(p(s).after)));
    ok('the size the rule\'s way ("20 x 20 Inch", not "20x20 Inches"), the smaller number first ("14 x 20", not "20 x 14")', p('S1').after.includes('20 x 20 Inch ') && p('D1').after.includes('14 x 20 Inch') && p('A1').after.includes('14 x 20 Inch'));
    ok('"Block Print" added where the family says it (K1, A1)', /Block Print/.test(p('K1').after) && /Block Print/.test(p('A1').after));
    ok('"Cotton" (Amazon\'s material) written the template\'s way: "100% Cotton" (O1, A1)', p('O1').after.includes('100% Cotton') && p('A1').after.includes('100% Cotton'));
    ok('every new title within 60–75 characters', Object.keys(expect).every(s => p(s).after.length >= 60 && p(s).after.length <= 75));
    ok('A1 — ALL FIVE problems fixed in ONE new title, and it says which', p('A1').fixes.length === 5 && ["Title doesn't follow template", 'Size formatting inconsistent', 'Dimension order inconsistent', 'Title slightly under-optimized', 'Important title keyword missing'].every(x => p('A1').fixes.includes(x)), p('A1').fixes.join(' | '));
    ok('the facts come from Amazon (colour, size, material), the words from Listing Rules', p('A1').src.color === 'Amazon' && p('A1').src.size === 'Amazon' && p('A1').src.material === 'Amazon' && p('A1').src.product === 'Listing Rules');
    // every rule again on each new title, the family as it will be
    const ctx2 = p('A1').ctx2;
    Object.keys(expect).forEach(sku => {
      const row = C.HEALTH.SP.rows.find(r => r.sku === sku);
      const chk = C.ttCheck('SP', row, p(sku).after, C.hCtx(), ctx2);
      if (!chk.pass) ok(`${sku}: every rule passes on the new title`, false, chk.fails.join(' | '));
    });
    ok('every rule again on every new title: no title rule fails, nothing new fails', Object.keys(expect).every(sku => C.ttCheck('SP', C.HEALTH.SP.rows.find(r => r.sku === sku), p(sku).after, C.hCtx(), ctx2).pass));

    console.log('== held back, with the reason — nothing guessed ==');
    ok('M1: Amazon has no material → left out, held back: "check: material missing"', !p('M1').ok && /^check: material missing/.test(p('M1').why) && !/Cotton/.test(p('M1').after), p('M1').why + ' · ' + p('M1').after);
    ok('C1: Amazon says Red, the catalogue Black → held back with both', !p('C1').ok && /check: colour — Amazon says “Red”, the catalogue says “Black”/.test(p('C1').why), p('C1').why);
    ok('X1: even with only the required parts (brand, product, material, size, print the family asks for, colour) it is over 75 → held back, nothing required dropped',
      !p('X1').ok && /even with only the parts the template requires it is \d+ characters \(over 75\)/.test(p('X1').why) && p('X1').after.startsWith('Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print - Indigo Blue and Rust Orange Stripe'), p('X1').why);

    console.log('== the popup ==');
    const pop = C.el('spModalBox').innerHTML;
    const t = strip(pop);
    ok('title, sum line: "N children · every new title passes every title rule · 3 held back"', /Fix all titles — Parent PB/.test(t) && new RegExp(`${n - 3} children · every new title passes every title rule · 3 held back`).test(t), t.slice(0, 300));
    ok('per child: SKU, colour · size, current → new title, characters before → after, what it fixes', /<b>A1<\/b><small>Plum · 14 x 20 Inch<\/small>/.test(pop) && /<small>Now<\/small> /.test(pop) && /<small>New<\/small> /.test(pop)
      && /<span class="">33<\/span> → <span class="ok" data-tt-n="SP\|A1">63<\/span> characters/.test(pop) && /Fixes: Title doesn't follow template · /.test(t.replace(/&#39;/g, "'")), t.slice(0, 900));
    ok('the changes marked: words that go struck through, words that come in highlighted', /<span class="kf-cut">20x14<\/span>/.test(pop) && /<span class="tt-add">100%<\/span>/.test(pop) && /<span class="tt-add">Block<\/span>/.test(pop));
    ok('each one: "✓ Passes every title rule", a tick (ticked), "Edit new title"', (pop.match(/✓ Passes every title rule/g) || []).length === n - 3 && (pop.match(/data-tt-tick="[^"]+" checked/g) || []).length === n - 3 && (pop.match(/Edit new title/g) || []).length === n - 3);
    ok('held-back children listed with the reason (and Edit by hand)', (pop.match(/⚠ Held back: /g) || []).length === 3 && /⚠ Held back: check: material missing/.test(pop) && (pop.match(/data-tt="hand"/g) || []).length === 3);
    ok('Select all, search, and the button "Check with Amazon & send N"', /data-tt-all checked/.test(pop) && /data-tt-q/.test(pop) && new RegExp(`data-tt="go">Check with Amazon &amp; send ${n - 3}<`).test(pop));
    ok('…and where the parts came from', /from Amazon: size, colour, material/.test(t) || /from Amazon: [a-z, ]*material/.test(t), (t.match(/from Amazon[^·]*/) || [''])[0]);

    console.log('== tick, Select all, search, Edit (judged again live) ==');
    C.ttInput({ dataset: { ttTick: 'SP|K1' }, checked: false });
    ok('untick K1 → "… · N ticked", button one less', new RegExp(`Check with Amazon &amp; send ${n - 4}`).test(C.el('spModalBox').innerHTML) || C.TT.run.sel.size === n - 4);
    C.ttInput({ dataset: { ttAll: '' }, checked: true });
    ok('Select all → all ticked again', C.TT.run.sel.size === n - 3);
    C.ttInput({ dataset: { ttQ: '' }, value: 'plum' });
    ok('search "plum" → the search kept (the rows not matching hidden)', C.TT.run.q === 'plum');
    C.ttInput({ dataset: { ttQ: '' }, value: '' });
    C.ttInput({ dataset: { ttEdit: 'SP|S1' }, value: 'Ridhi Cloth Napkins 100% Cotton 20x20 Block Print - Navy' });
    let chk = C.ttRunCheck(C.TT.run, planOf(C, 'S1'));
    ok('an edit that brings a problem back ("20x20") → ✕ with the rule, and it would be held back', !chk.pass && chk.fails.some(f => /still: Size formatting inconsistent/.test(f)), chk.fails.join(' | '));
    C.ttInput({ dataset: { ttEdit: 'SP|S1' }, value: 'Ridhi Cloth Napkins 100% Cotton 20 x 20 Inch Block Print Set - Navy' });
    chk = C.ttRunCheck(C.TT.run, planOf(C, 'S1'));
    ok('…edited again so it passes → ✓', chk.pass, chk.fails.join(' | '));
    C.ttInput({ dataset: { ttEdit: 'SP|D1' }, value: 'Ridhi Cloth Napkins 100% Cotton 20 x 14 Inch Block Print - Teal' });
    ok('D1 edited back to "20 x 14" → ✕ Dimension order', C.ttRunCheck(C.TT.run, planOf(C, 'D1')).fails.some(f => /Dimension order/.test(f)));

    console.log('== Check with Amazon & send → the one send path ==');
    C.ttGo();
    await C.SQ.run.checked;
    const sq = C.SQ.run;
    ok(`Amazon checks the ${n - 4} that pass (D1's failing edit held back with its reason), nothing sent yet`, patchCalls(C, false).length === n - 4 && patchCalls(C, true).length === 0 && sq.jobs.length === n - 4
      && !sq.jobs.some(j => j.sku === 'D1') && sq.opts.held.some(h => h.sku === 'D1' && /the edited title fails: still: Dimension order/.test(h.why)) && C.SQ.screens.slice(-1)[0] === 'Titles · Fix all', sq.opts.held.map(h => h.sku + ': ' + h.why).join(' | '));
    ok('the edited S1 goes as edited; each patch is only that child\'s item_name', patchCalls(C, false).find(c => c.sku === 'S1').patches[0].value[0].value === 'Ridhi Cloth Napkins 100% Cotton 20 x 20 Inch Block Print Set - Navy'
      && patchCalls(C, false).every(c => c.patches.length === 1 && c.patches[0].path === '/attributes/item_name' && c.productType === 'NAPKIN'));
    await C.sqApprove();
    ok('Approve & send: sent for real, one by one', patchCalls(C, true).length === n - 4);
    C.sqClose();
    await pr;
    ok('the result in words: "N accepted · …" (kept for the Listing Errors card)', /accepted/.test(C.TT.last.get('SP') || ''), C.TT.last.get('SP'));
    ok('every send kept with its OLD title (listingrules/fixlog): row "ttl", "Title problems"', C.FA.log.length === n - 4 && C.FA.log.every(r => r.row === 'ttl' && r.name === 'Title problems' && r.before.title && r.after.title && r.before.title !== r.after.title)
      && C.FA.log.find(r => r.sku === 'A1').before.title === KIDS.A1.title, JSON.stringify(C.FA.log[0]));
    const lh = A => A.saved.filter(x => /^history\/listing_/.test(x.path)).flatMap(x => Object.values(x.data.rows || {}));
    const hrows = lh({ saved });
    ok('Listing History rows, screen "Titles · Fix all"', hrows.length >= n - 4 && hrows.every(r => r.screen === 'Titles · Fix all' && r.field === 'Title'), JSON.stringify(hrows[0]));
    ok('…and Listing History names the screen once ("Titles · Fix all", not "… · Fix all · Fix all")', C.lhScreen({ screen: 'Titles · Fix all', runN: 7 }) === 'Titles · Fix all' && C.lhScreen({ screen: 'Listing Health', runN: 7 }) === 'Workspace · Fix all');
    await wait(() => !C.LI_WS.inflight && !C.LI_WS.q.length);
    const left = C.ttRows('SP').map(r => r.row.sku);
    ok('the sent children leave the problem rows (waiting for Amazon); the held ones and D1 stay', ['T1', 'S1', 'O1', 'L1', 'K1', 'A1'].every(s => !left.includes(s)) && ['D1', 'M1', 'C1', 'X1'].every(s => left.includes(s)), left.join());
    const g2 = C.faGroups('SP', 'PB', C.faKids('SP', 'PB'));
    ok('…in the Workspace too: each title row counts them as waiting', g2.filter(g => g.kind === 'ttl').every(g => g.kids.every(k => ['D1', 'M1', 'C1', 'X1'].includes(k.sku))) && g2.some(g => g.waiting.some(w => w.kid.sku === 'A1')),
      g2.filter(g => g.kind === 'ttl').map(g => g.key + ':' + g.kids.map(k => k.sku).join('/') + ' w' + g.waiting.length).join(' '));

    console.log('== Put back ==');
    const rec = C.FA.log.find(r => r.sku === 'A1');
    const pb = C.faPutBack(rec.id);
    await C.SQ.run.checked;
    ok('Put back → Amazon checks the OLD title first', patchCalls(C, false).slice(-1)[0].sku === 'A1' && patchCalls(C, false).slice(-1)[0].patches[0].value[0].value === KIDS.A1.title);
    await C.sqApprove();
    C.sqClose();
    await pb;
    ok('…and sends it; the record says so', patchCalls(C, true).slice(-1)[0].patches[0].value[0].value === KIDS.A1.title && rec.back > 0);
  }

  console.log('== Amazon\'s answers after the re-read: "N accepted · M rejected (reason)" ==');
  {
    const { C, gets } = setup({ facts: true, amazon: { rej: 'K1', work: 'L1' } });
    const read0 = gets.length;
    const pr = C.ttStartFamily('SP', 'PB');
    await ready(C);
    C.ttGo();
    await C.SQ.run.checked;
    await C.sqApprove();
    const st = Object.fromEntries(C.SQ.run.jobs.map(j => [j.sku, j.state]));
    ok('K1 rejected (an ERROR on item_name), L1 still working, the others accepted', st.K1 === 'rejected' && st.L1 === 'working' && Object.entries(st).filter(([s]) => !['K1', 'L1'].includes(s)).every(([, v]) => v === 'accepted'), JSON.stringify(st));
    ok('"✅ 5 accepted · ❌ 1 rejected (A value Amazon does not accept) · ⏳ 1"', /✅ 5 accepted · ❌ 1 rejected \(A value Amazon does not accept\) · ⏳ 1/.test(strip(C.el('spModalBox').innerHTML)), strip(C.el('spModalBox').innerHTML).slice(0, 300));
    C.sqClose();
    await pr;
    ok('with the facts already held (the ListingMatch cache), the popup read nothing from Amazon first', read0 === 0 && C.TT.readV === 1);
    ok('K1 (rejected) is back in the rows; the accepted ones are not', C.ttRows('SP').some(r => r.row.sku === 'K1') && !C.ttRows('SP').some(r => r.row.sku === 'T1'));
  }

  console.log('== one child\'s Fix (any screen): the same popup, that one child, the same new title ==');
  {
    const { C } = setup({ facts: true });
    const html = C.lrProblemHtml(C.healthOf(Object.assign({}, C.HEALTH.SP.rows.find(r => r.sku === 'A1')), C.hCtx()).found.find(h => h.detector === 'size_format'), { brand: 'SP', sku: 'A1' });
    ok('a title problem\'s Fix button carries its rule (data-lr-det) and says what it opens', /data-lr-fix="lerr\|SP\|A1" data-lr-det="size_format" title="Shows the new title for this listing first \(Fix all titles\)">Fix</.test(html), html);
    const other = C.lrProblemHtml({ sev: 'action', name: 'No price', detail: 'no price', detector: 'no_price', kind: 'lerr' }, { brand: 'SP', sku: 'A1' });
    ok('…any other problem\'s Fix is as it was (Opens Listing Errors)', !/data-lr-det/.test(other) && /title="Opens Listing Errors"/.test(other));
    const rec = C.lrRecHtml({ sev: 'action', name: 'Dimension order inconsistent', detector: 'dimension_order', kind: 'lerr' }, { brand: 'SP', sku: 'A1' });
    ok('the Workspace child view\'s rows too (lrRecHtml)', /data-lr-det="dimension_order"/.test(rec));
    C.ttStartOne('SP', 'A1');
    await ready(C);
    ok('ttStartOne → the popup with only A1, the same new title as in Fix all', C.TT.run.plans.length === 1 && planOf(C, 'A1').after === 'Ridhi Cloth Napkins 100% Cotton 14 x 20 Inch Block Print - Plum');
    C.ttClick({ dataset: { tt: 'cancel' } });
    ok('Cancel: closed, nothing sent', C.TT.run.closed && patchCalls(C, false).length === 0);
    ok('a listing with no title problem: no popup (the button goes to Listing Errors as before)', C.ttStartOne('SP', 'G0') === null);
    C.ttStartOne('SP', 'A1');
    await ready(C);
    C.spModal('');                       // closed with Escape / a click beside it: the popup frame alone, the run not told
    C.ttStartOne('SP', 'T1');
    await ready(C);
    ok('closed with Escape → the next Fix still opens its own popup', !C.TT.run.closed && C.TT.run.plans.length === 1 && C.TT.run.plans[0].sku === 'T1' && /Fix all titles — T1/.test(C.el('spModalBox').innerHTML));
    C.ttClick({ dataset: { tt: 'cancel' } });
    C.faStart('SP|PB|rule:size_format', 'S1');
    await ready(C);
    ok('the Workspace\'s own Fix on one child → that one child', C.TT.run.plans.length === 1 && C.TT.run.plans[0].sku === 'S1');
    C.ttClick({ dataset: { tt: 'cancel' } });
  }

  console.log('== the 75-character cap: the optional parts go in the rule\'s order ==');
  {
    const { C } = setup({ facts: true });
    C.ttStartFamily('SP', 'PC');
    await ready(C);
    const p2 = planOf(C, 'P2');
    ok('P2 (no sibling says Block Print): the uses go, then the print — never brand, product, size or colour', p2.ok && p2.after === 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch - Dusty Rose Pink Stripe' && p2.dropped.join() === 'uses,pattern', p2.after + ' · ' + p2.dropped);
    ok('…within 75', p2.after.length <= 75, String(p2.after.length));
    C.ttClick({ dataset: { tt: 'cancel' } });
    const l1 = C.ttPlans('SP', C.ttRows('SP').filter(r => r.row.sku === 'L1'), C.hCtx()).get('L1');
    ok('L1 (the family says Block Print): only the uses go, the print stays', l1.ok && l1.dropped.join() === 'uses' && /Block Print - Ivory$/.test(l1.after), l1.dropped + ' · ' + l1.after);
  }

  console.log('== a long print in the template ("Hand Block Print"): written as the rule\'s own words ("Block Print") to fit 75 ==');
  {
    const { C } = setup({ facts: true });
    const now = Date.now();
    const add = (sku, title, color, size) => {
      C.HEALTH.SP.rows.push({ brand: 'SP', parent: 'TCP', sku, asin: 'B0' + sku, title, qty: 5, price: 40, status: 'Active', channel: 'AFN', aplus: true, aplusAt: now, checked: now, content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } });
      C.setCat('SP', { [sku]: { subcat: 'Rectangle Tablecloth', color, size } });
    };
    add('TC1', 'Ridhi Rectangle Tablecloth 60 x 102 Inch Cotton Dining Table Cover - Mustard', 'Mustard', '60x102');
    add('TC2', 'Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch Hand Block Print - Red', 'Red', '60x90');
    C.reset();
    const tc = (sku, color, size) => C.ttBuild('SP', C.HEALTH.SP.rows.find(r => r.sku === sku), C.hCtx(), { va: { color, size, material: 'Cotton', item_shape: 'Rectangle' } });
    const b1 = tc('TC1', 'Mustard', '60x102');
    ok('TC1 (its sibling says it): the uses go, then "Hand Block Print" is written "Block Print" — 74 characters, every required part kept',
      b1.after === 'Ridhi Tablecloth Rectangle 100% Cotton 60 x 102 Inch Block Print - Mustard' && b1.shortPrint === 'Hand Block Print' && b1.dropped.join() === 'uses' && !b1.why, b1.after + ' · ' + b1.after.length + ' · ' + b1.why);
    const b2 = tc('TC2', 'Red', '60x90');
    ok('…a title that fits keeps the template\'s own words ("Hand Block Print")', b2.after === 'Ridhi Tablecloth Rectangle 100% Cotton 60 x 90 Inch Hand Block Print - Red' && !b2.shortPrint, b2.after);
    C.TT.read.set('SP|TC1', { va: { color: 'Mustard', size: '60x102', material: 'Cotton', item_shape: 'Rectangle' }, pt: 'TABLECLOTH', at: now });
    const p1 = C.ttPlans('SP', C.ttRows('SP').filter(r => r.row.parent === 'TCP'), C.hCtx()).get('TC1');
    ok('…and it passes every rule (the keyword rule reads both as Block Print)', p1 && p1.ok, p1 && p1.why);
  }

  console.log('== the rules re-check holds a new title back ==');
  {
    const { C } = setup({ facts: true, rules: LR => { LR.issues.find(i => i.id === 'title_opt').params = { min: 70, max: 75 }; } });
    const plans = C.ttPlans('SP', C.ttRows('SP'), C.hCtx());
    const a1 = plans.get('A1');
    ok('a title-length rule of 70–75: the 63-character new title still fails it → held back, the rule named', !a1.ok && /still: Title slightly under-optimized — 63 characters/.test(a1.why), a1.why);
    const sizes = C.ttPlans('SP', C.ttRows('SP'), C.hCtx());
    ok('nothing is sent that fails a rule', [...sizes.values()].filter(p => p.ok).every(p => p.after.length >= 70), [...sizes.values()].filter(p => p.ok).map(p => p.sku + ':' + p.after.length).join());
  }

  console.log('== the test site: "not sent to Amazon" ==');
  {
    const { C } = setup({ facts: true, window: { __TEST_ERP: true } });
    const pr = C.ttStartFamily('SP', 'PB');
    await ready(C);
    C.ttGo();
    await C.SQ.run.checked;
    ok('no call to Amazon; the popup says Amazon\'s check cannot run here', patchCalls(C, false).length === 0 && C.SQ.run.jobs.every(j => j.state === 'test') && /Test site — Amazon's check cannot run here/.test(C.el('spModalBox').innerHTML));
    await C.sqApprove();
    ok('…Approve: "Test site — not sent to Amazon"; nothing sent, nothing written', patchCalls(C, true).length === 0 && C.SQ.run.jobs.every(j => j.state === 'notsent') && /Test site — not sent to Amazon/.test(C.el('spModalBox').innerHTML));
    C.sqClose();
    await pr;
    ok('…no change record', C.FA.log.length === 0);
  }

  console.log('== Listing Errors: the card, per family and Select all ==');
  {
    const { C } = setup({ facts: true });
    const card = C.ttLeCardHtml('SP', null);
    const n = C.ttRows('SP').length;
    ok(`the card: "Title problems: ${n} listings in 2 families", Select all · Fix all ${n}, each family with its own Fix all`, new RegExp(`Title problems:</b> ${n} listings in 2 families`).test(card) && new RegExp(`data-tt-le="all"[^>]*>Select all · Fix all ${n}<`).test(card)
      && /data-tt-le="fam"[^>]*data-tt-parent="PB"/.test(card) && /data-tt-le="fam"[^>]*data-tt-parent="PC"/.test(card), strip(card).slice(0, 300));
    ok('…each family with its problems counted', /Important title keyword missing \d/.test(strip(card).replace(/&#39;/g, "'")));
    ok('only the listings picked (LE_ONLY) when Listing Health picked some', /Title problems:<\/b> 2 listings in 1 family/.test(C.ttLeCardHtml('SP', new Set(['A1', 'S1']))));
    C.ttLeStart('SP', '', null);
    await ready(C);
    ok('Select all · Fix all → one popup over every listing with a title problem', C.TT.run.plans.length === n && /every Ridhi listing with a title problem/.test(C.el('spModalBox').innerHTML));
    C.ttClick({ dataset: { tt: 'cancel' } });
    C.ttLeStart('SP', 'PC', null);
    await ready(C);
    ok('a family\'s Fix all → only that family', C.TT.run.plans.length === 1 && C.TT.run.plans[0].sku === 'P2');
    C.ttClick({ dataset: { tt: 'cancel' } });
    ok('…in the Listing Errors page, after the search-terms card (listing-errors.js)', /const ttCard = typeof ttLeCardHtml === 'function' \? ttLeCardHtml\(brand, LE_ONLY \? LE_ONLY\.skus : null\) : '';\s*el\.innerHTML = only \+ kwCard \+ ttCard/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app', 'listing', 'listing-errors.js'), 'utf8')));
  }

  console.log('== the console report ==');
  {
    const { C } = setup({ facts: true });
    const log = console.log, table = console.table;
    console.log = () => {}; console.table = () => {};
    let r;
    try { r = C.ttReport(); } finally { console.log = log; console.table = table; }
    ok('ttReport(): children and families it would fix, held back by reason, 3 examples before → after', r.counts.Ridhi.childrenWithATitleProblem === C.ttRows('SP').length && r.counts.Ridhi.fixedNow === 8 && r.counts.Ridhi.familiesFixed === 2
      && r.counts.Ridhi.heldBack === 3 && r.examples.length === 3 && r.examples.every(x => x.before && x.after && x.before !== x.after) && r.examples.some(x => x.sku === 'A1') && Object.keys(r.heldBackBy).length === 3, JSON.stringify(r));
  }

  console.log('== wired in: ORDER, the styles ==');
  {
    const fs = require('fs'), path = require('path');
    const order = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'ORDER'), 'utf8');
    ok('title-fix.js joined right after kw-fix.js', /listing\/kw-fix\.js\r?\nlisting\/title-fix\.js\r?\n/.test(order));
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
    ok('its styles use the theme\'s tokens only', /\.tt-add\{background:var\(--accent-bg\);color:var\(--accent-ink\)/.test(css) && /\.tt-chk\.is-bad\{color:var\(--bad-ink\)\}/.test(css));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
