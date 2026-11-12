/* Item Highlights in the Season planner (12 Nov 2026): Amazon's title_differentiation field — title (75) → Item Highlights (125) →
 * hidden search words (249 bytes). Over the real Listing Rules, Workspace and Season planner, in the stub page.
 *   node tests/item-highlights-test.js */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const NOV = new Date(2026, 10, 12);      // Christmas on; Spring over
const JAN = new Date(2027, 0, 10);       // Christmas over
const FULL = 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Dinner Set - Blue';   // 74: Christmas does not fit
const LONG = 'Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Hand Block Print Dinner Napkins Set - Blue';   // 85: over 75
const napkin = color => ({ color, size: '18x18', subcat: 'Napkin Set' });

function setup(opts) {
  opts = opts || {};
  const C = load({ ws: true, sp: true, baCall: opts.baCall });
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = opts.log || [];
  // NAPKIN_HL: a product type whose schema has Item Highlights as one text of 125; NAPKIN_NONE: one whose schema has none
  ['SP', 'CPC'].forEach(b => {
    C.LI_WS.schema[b].NAPKIN_HL = { at: Date.now(), ok: [], hl: { items: 1, max: 125, bytes: 0 } };
    C.LI_WS.schema[b].NAPKIN_MANY = { at: Date.now(), ok: [], hl: { items: 5, max: 125, bytes: 0 } };
    C.LI_WS.schema[b].NAPKIN_NONE = { at: Date.now(), ok: [], hl: { none: true } };
  });
  const put = (sku, title, color) => {
    C.HEALTH.SP.rows.push({ brand: 'SP', parent: 'PH', sku, asin: 'B0' + sku, title, qty: 5, price: 12.5, status: 'Active', channel: 'AFN', aplus: true, aplusAt: Date.now(), checked: Date.now(),
      content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } });
    C.setCat('SP', { [sku]: napkin(color || 'Blue') });
  };
  // a live read: the title Amazon shows, the hidden search words, the product type, and (hl given) the Item Highlights from ?lfix=get
  const live = (sku, title, kw, pt, hl) => {
    const now = Date.now();
    C.LI_WS.live.SP[sku] = Object.assign({ at: now, cAt: now, pt, title, titleLen: title.length, catTitle: title, tAt: now, kw, kwBytes: C.lrKwBytes(kw) },
      hl ? { gAt: now, hl, hlAt: now } : {});
    C.LI_WS.liveV++;
  };
  return { C, put, live };
}
const planOf = (C, sku, day) => { C.reset(); C.SP.itemsKey = ''; return C.spCompute(day || NOV).find(item => item.sku === sku); };

(async () => {
  console.log('== title full, Item Highlights have room → the word goes to Item Highlights ==');
  {
    const { C, put, live } = setup();
    put('H1', FULL);
    live('H1', FULL, 'cotton dinner party', 'NAPKIN_HL', ['Hand block printed cotton, soft and washable']);
    const it = planOf(C, 'H1');
    ok('the suggestion goes to Item Highlights, not the hidden search words; the title stays', it.place === 'hl' && it.after === FULL && it.kwAfter === it.kw
      && it.hlAfter[0] === 'Hand block printed cotton, soft and washable, Christmas table decor' && it.status === 'ready', JSON.stringify([it.place, it.hlAfter, it.status, it.why]));
    ok('the three places in plain words, in order', it.placeLines[0] === 'Title: Christmas missing — title is full (74 of 75)'
      && it.placeLines[1] === 'Item Highlights: Christmas missing — ‘Christmas table decor’ fits (67 of 125)'
      && /^Hidden search words: Christmas missing — it fits \(\d+ of 249\)$/.test(it.placeLines[2]), JSON.stringify(it.placeLines));
    ok('…one suggestion; the other place that fits is "Also possible"', it.alsoPlaces.join() === 'Hidden search words', it.alsoPlaces.join());
    const p = C.spPatches(it, it.after);
    ok('what is sent: the title as it is, and title_differentiation with the new text', p.map(x => x.path).join() === '/attributes/item_name,/attributes/title_differentiation'
      && p[1].op === 'replace' && p[1].value.length === 1 && p[1].value[0].value === it.hlAfter[0], JSON.stringify(p));
    ok('the checks: within 125, no promotion words, nothing the title says, no banned symbols, nothing made up — all pass',
      ['hl', 'hlpromo', 'hltitle', 'hlsym', 'hlfact', 'hlseason'].every(k => it.checks.some(c => c.k === k && c.ok === true)) && !it.checks.some(c => c.ok === false), JSON.stringify(it.checks.filter(c => /^hl/.test(c.k))));
    const g = C.spGroups(C.spCompute(NOV)).find(x => x.key === 'SP|PH');
    const kid = C.spKidHtml(it, g);
    ok('the child panel: "Add “Christmas” to Item Highlights", the three place lines, Also possible', /Add “Christmas” to Item Highlights \(shown under the title\)/.test(kid)
      && /Item Highlights: Christmas missing — ‘Christmas table decor’ fits \(67 of 125\)/.test(kid) && /Also possible: Hidden search words/.test(kid), kid.slice(0, 200));
    ok('…"What changes" shows Item Highlights the way the hidden search words are shown: + Added, the count, the full text folded', /<p class="sp-add">\+ Added to Item Highlights: Christmas, table, decor<\/p>/.test(kid)
      && /Item Highlights: 67 of 125\./.test(kid) && /<summary>Show full Item Highlights<\/summary>/.test(kid), (kid.match(/sp-chg[^]*?<\/div><div class="sp-card2 sp-chk-c/) || [''])[0].slice(0, 600));
    ok('the parent row says it in the same words', /Add “Christmas” to Item Highlights/.test(C.spRowHtml(it)));
  }

  console.log('== Item Highlights full → the hidden search words ==');
  {
    const { C, put, live } = setup();
    put('H2', FULL);
    const big = 'Hand block printed cotton napkins, soft, absorbent and machine washable, made by artisans in Jaipur with natural dyes, 4 pcs';   // 124
    live('H2', FULL, 'cotton dinner party', 'NAPKIN_HL', [big]);
    const it = planOf(C, 'H2');
    ok('no room in Item Highlights (124 of 125): the word goes to the hidden search words, Item Highlights unchanged', big.length === 124 && it.place === 'kw' && /Christmas/.test(it.kwAfter) && it.hlAfter[0] === big
      && it.placeLines[1] === 'Item Highlights: Christmas missing — no room (124 of 125)', JSON.stringify([it.place, it.placeLines]));
    ok('…and only the title and the search words are sent', C.spPatches(it, it.after).map(x => x.path).join() === '/attributes/item_name,/attributes/generic_keyword');
  }

  console.log('== never over 125, no promotion words, no words already in the title ==');
  {
    const { C, put, live } = setup();
    const T3 = 'Ridhi Napkins Cotton 18 x 18 Inch Block Print Dining Table Set of 4 - Blue';   // 74, says "Table"
    put('H3', T3);
    live('H3', T3, 'dinner', 'NAPKIN_HL', []);
    const it = planOf(C, 'H3');
    ok('empty Item Highlights: a short one from the season word and a use the title does not say ("Christmas decor" — "Table" is in the title)', T3.length === 74 && it.place === 'hl' && it.hlAfter.join() === 'Christmas decor', JSON.stringify(it.hlAfter));
    ok('…the "nothing the title already says" check passes', it.checks.some(c => c.k === 'hltitle' && c.ok === true));
    const bad = C.spChecks(T3, T3, C.rows.find(r => r.sku === 'H3') || it.row, C.hCtx(), NOV, { hlBefore: [], hlAfter: ['Best Christmas deal, napkins for your table'], hlMax: 125, hlItems: 1 });
    ok('a typed text with "Best" / "deal" fails "No promotion words"; one repeating the title ("napkins") fails "Nothing the title already says"',
      bad.some(c => c.k === 'hlpromo' && c.ok === false) && bad.some(c => c.k === 'hltitle' && c.ok === false), JSON.stringify(bad.filter(c => c.ok !== true)));
    const over = C.spChecks(T3, T3, it.row, C.hCtx(), NOV, { hlBefore: [], hlAfter: ['x'.repeat(126)], hlMax: 125, hlItems: 1 });
    ok('126 characters fails "within their limit" — never sent', over.some(c => c.k === 'hl' && c.ok === false));
    // an old promotion word already there never blocks the season word (it is "Already there before")
    put('H4', FULL);
    live('H4', FULL, 'dinner', 'NAPKIN_HL', ['Best cotton napkins for every day']);
    const it4 = planOf(C, 'H4');
    ok('"Best" already in Item Highlights: the season word is still added, and "Best" is shown as already there before', it4.place === 'hl' && it4.checks.some(c => c.k === 'hlpromo' && c.ok === 'warn' && c.pre) && it4.status === 'ready', JSON.stringify([it4.place, it4.status, it4.checks.filter(c => c.k === 'hlpromo')]));
    // over many listings and both shapes: never over the limit
    const many = [];
    for (let i = 0; i < 12; i++) {
      const sku = 'M' + i;
      put(sku, FULL);
      live(sku, FULL, 'dinner', i % 2 ? 'NAPKIN_MANY' : 'NAPKIN_HL', i % 2 ? ['a'.repeat(100 + i)] : ['b'.repeat(90 + i * 3)]);
      many.push(sku);
    }
    const plans = many.map(sku => planOf(C, sku));
    ok('never over 125 in any entry, never more entries than the schema allows', plans.every(p => p.hlAfter.every(e => e.length <= 125) && p.hlAfter.length <= p.hlInfo.items), JSON.stringify(plans.map(p => p.hlAfter.map(e => e.length))));
    const multi = planOf(C, 'M1');
    ok('several entries (schema maxItems 5): the season words are a new entry of their own', multi.place === 'hl' && multi.hlAfter.length === 2 && multi.hlAfter[1] === 'Christmas table decor', JSON.stringify(multi.hlAfter));
    ok('sale days never go into Item Highlights', plans.concat([it, it4]).every(p => !/black friday|cyber monday/i.test(p.hlAfter.join(' '))));
  }

  console.log('== "Spring" taken out of Item Highlights in November ==');
  {
    const { C, put, live } = setup();
    const T5 = 'Ridhi Cloth Napkins Cotton 18 x 18 Inch Block Print Dinner Christmas - Blue';   // already says Christmas
    put('H5', T5);
    live('H5', T5, 'dinner', 'NAPKIN_HL', ['Spring table decor, hand block printed cotton']);
    const it = planOf(C, 'H5');
    ok('Remove old season words covers Item Highlights: "Spring" goes, the rest stays', it.remove.some(e => e.ev.id === 'sp_spring') && it.hlAfter[0] === 'table decor, hand block printed cotton, Thanksgiving' && !/spring/i.test(it.hlAfter[0]) && it.after === T5, JSON.stringify([it.kind, it.hlAfter, it.after]));
    ok('…in plain words: "Take “Spring” out of Item Highlights"', /Take “Spring” out of Item Highlights/.test(C.spRowHtml(it)));
    ok('…"− Removed from Item Highlights: Spring (out of season)"', /− Removed from Item Highlights: Spring <span class="sp-dim">\(out of season\)<\/span>/.test(C.spKidHtml(it, null)));
    ok('…a change that makes nothing worse: Ready', it.status === 'ready', it.status + ' ' + it.why);
  }

  console.log('== title over 75: Item Highlights cannot be used ==');
  {
    const { C, put, live } = setup();
    put('H6', LONG);
    live('H6', LONG, 'dinner', 'NAPKIN_HL', []);
    const it = planOf(C, 'H6');
    ok('the line says why, and the suggestion is the hidden search words — never Item Highlights', LONG.length > 75 && it.place === 'kw' && it.hlAfter.length === 0
      && it.placeLines[1] === 'Item Highlights: available only when the title is 75 letters or less — shorten the title first (Amazon error 100476 is about this)' && !it.alsoPlaces.includes('Item Highlights'), JSON.stringify([it.place, it.placeLines]));
    const typed = C.spChecks(FULL, LONG, it.row, C.hCtx(), NOV, { hlBefore: [], hlAfter: ['Christmas decor'], hlMax: 125, hlItems: 1 });
    ok('a title typed over 75 with words added to Item Highlights fails the check (never sent)', typed.some(c => c.k === 'hl75' && c.ok === false));
  }

  console.log('== not in the schema for this product type ==');
  {
    const { C, put, live } = setup();
    put('H7', FULL);
    live('H7', FULL, 'dinner', 'NAPKIN_NONE');
    const it = planOf(C, 'H7');
    ok('"Item Highlights: not available for this product type" and skipped: the hidden search words', it.place === 'kw' && it.placeLines[1] === 'Item Highlights: not available for this product type' && it.hl === null, JSON.stringify([it.place, it.placeLines]));
  }

  console.log('== reading the shape and the value: the schema, then ?lfix=get — only for the listings shown ==');
  {
    const calls = [];
    const { C, put, live } = setup({ baCall: async p => { calls.push(p); return p.lfix === 'schema' ? { ok: true, attrs: { title_differentiation: { name: 'title_differentiation', fields: [{ field: 'value', maxLength: 125 }], maxItems: 1 } } } : { ok: true, attributes: { title_differentiation: [{ value: 'Soft cotton', language_tag: 'en_US' }] }, productType: 'NAPKIN_NEW' }; } });
    put('H8', FULL);
    live('H8', FULL, 'dinner', 'NAPKIN_NEW');
    let it = planOf(C, 'H8');
    ok('not known yet: Reading (the word would go to Item Highlights), and the schema is asked', it.status === 'reading' && /Item Highlights/.test(it.why) && it.hlInfo.need === 'schema', JSON.stringify([it.status, it.why, it.hlInfo]));
    C.spEnsureReads([it]);
    await new Promise(r => setTimeout(r, 30));
    ok('the schema reply gives the shape: one text of 125', JSON.stringify(C.LI_WS.schema.SP.NAPKIN_NEW.hl) === JSON.stringify({ items: 1, max: 125, bytes: 0 }) && calls.some(c => c.lfix === 'schema' && /title_differentiation/.test(c.attrs)), JSON.stringify(C.LI_WS.schema.SP.NAPKIN_NEW));
    it = planOf(C, 'H8');
    ok('…then the listing\'s own value is needed: ?lfix=get', it.hlInfo.need === 'get');
    C.spEnsureReads([it]);
    await new Promise(r => setTimeout(r, 30));
    ok('?lfix=get fills the value', JSON.stringify(C.LI_WS.live.SP.H8.hl) === '["Soft cotton"]' && C.LI_WS.live.SP.H8.hlAt > 0 && calls.some(c => c.lfix === 'get' && c.sku === 'H8'));
    it = planOf(C, 'H8');
    ok('…and the plan goes on: Christmas into Item Highlights', it.place === 'hl' && it.hlAfter[0] === 'Soft cotton, Christmas table decor', JSON.stringify([it.place, it.hlAfter]));
  }

  console.log('== Put old titles back covers Item Highlights ==');
  {
    const before = ['Soft cotton'];
    const after = ['Soft cotton, Christmas table decor'];
    const log = [{ brand: 'SP', sku: 'H9', asin: 'B0H9', kind: 'add', seasons: ['christmas'], at: Date.UTC(2026, 10, 12), by: 'x', before: { title: FULL, kw: 'dinner', hl: before }, after: { title: FULL, kw: 'dinner', hl: after } }];
    const { C, put, live } = setup({ log });
    put('H9', FULL);
    live('H9', FULL, 'dinner', 'NAPKIN_HL', after);
    const it = planOf(C, 'H9', JAN);
    ok('in January: put back — Item Highlights as they were before', it.kind === 'restore' && it.hlAfter.join() === 'Soft cotton' && C.spPatches(it, it.after).some(p => p.path === '/attributes/title_differentiation' && p.value[0].value === 'Soft cotton'), JSON.stringify([it.kind, it.hlAfter, it.status, it.why]));
  }

  console.log('== the counts per brand (spHighlightsCount) ==');
  {
    const { C, put, live } = setup();
    put('K1', FULL); put('K2', LONG); put('K3', FULL);
    live('K1', FULL, 'x', 'NAPKIN_HL', ['Soft cotton']); live('K3', FULL, 'x', 'NAPKIN_HL', []);
    C.reset();
    const n = C.spHighlightsCount().Ridhi;
    ok('titles up to 75 / over 75, and how many read listings already have Item Highlights', n.titleOver75 >= 1 && n.highlightsRead === 2 && n.haveHighlights === 1, JSON.stringify(n));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
