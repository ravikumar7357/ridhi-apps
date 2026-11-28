/* Fix all search terms (src/app/listing/kw-fix.js) over the real Listing Rules, Workspace, Fix all block and send path, in a stub page.
 *   node tests/kw-fix-test.js
 * One parent PK of 6 napkins: K1 over the limit with repeats, its important words (product, material, colour — kept though the title says
 * them), stop words, punctuation, brand names and an ASIN (19 Nov 2026: the one suggestion-words rule, lrSuggestWords — then one word
 * from the end); K2 over by unique words (cut from the end); K3 short; K4 exactly 249 bytes; K5 250 bytes; K6 whose kept text is cut
 * (read whole from Amazon when the preview opens). The row, the preview (bytes, struck words, ticks, search, edits), the send through the
 * Amazon check popup, Listing History and the change log (Put back), the test site, a rejection, and the Listing Errors card. */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const bytes = s => Buffer.byteLength(String(s).replace(/[\s;,.]+/g, ''), 'utf8');
const COLORS = ['Blue', 'Red', 'Green', 'Grey', 'Navy', 'Teal'];
const TITLE = c => `Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print - ${c}`;
const words = (pre, n, w) => Array.from({ length: n }, (_, i) => pre + String(i).padStart(w, '0'));
// K1: 22 unique 9-byte words (198) + "napkins cotton dinner party wedding table linen kitchen Blue" (52) = 250 once brands, ASIN, "&", the
// repeat and the stop words are out — still one over, so the last other word goes (alpha0021): 241. Before 19 Nov the title words went
// words, "&", the brands (ours, two words), an ASIN
const K1 = 'napkins cotton dinner, dinner party; the wedding & table for linen kitchen CPC Whimsical Corner B0ABCDEFGH Blue '
  + words('alpha', 22, 4).join(' ');
const K2 = words('word', 40, 3).join(' ');            // 40 × 7 = 280 bytes, nothing to take out but the end
const K4 = 'y'.repeat(249);
const K5 = words('w', 50, 4).join(' ');               // 50 × 5 = 250 bytes: one over
const K6 = words('long', 40, 5).join(' ');            // 40 × 9 = 360 bytes, 399 letters: Sellora keeps 300 of them
const KW = { K1, K2, K3: 'cotton napkins', K4, K5, K6 };
const idle = async C => { for (let i = 0; i < 400 && (C.LI_WS.inflight || C.LI_WS.q.length); i++) await new Promise(r => setTimeout(r, 2)); await new Promise(r => setTimeout(r, 2)); };

function setup(opts) {
  opts = opts || {};
  const saved = [];
  let C;
  const amazon = opts.amazon || {};
  const sentKw = sku => { const p = C.calls.filter(c => c.lfix === 'patch' && c.apply && c.sku === sku).slice(-1)[0]; const t = p && p.patches.find(x => x.path === '/attributes/generic_keyword'); return t ? t.value[0].value : null; };
  const kwNow = sku => (sentKw(sku) != null && sku !== amazon.rej ? sentKw(sku) : KW[sku]);
  const baCall = async q => {
    if (q.lfix === 'content') {
      const items = {};
      q.skus.split(',').forEach(sku => { items[sku] = { productType: 'NAPKIN', item_name: [{ value: TITLE('Blue') }], bullet_point: [1, 2, 3, 4, 5].map(n => ({ value: 'b' + n })), product_description: [{ value: 'd'.repeat(300) }], generic_keyword: [{ value: kwNow(sku) }] }; });
      return { items };
    }
    if (q.lfix === 'get') {
      C.reads = (C.reads || []).concat(q.sku);
      return { productType: 'NAPKIN', status: ['BUYABLE', 'DISCOVERABLE'], attributes: { generic_keyword: [{ value: kwNow(q.sku), language_tag: 'en_US' }] },
        issues: q.sku === amazon.rej && sentKw(q.sku) != null ? [{ severity: 'ERROR', message: 'The value for generic_keyword is not valid', attrs: ['generic_keyword'] }] : [] };
    }
    return {};
  };
  C = load({ ws: true, sp: true, fa: true, baCall, window: opts.window, setDoc: async (ref, data) => { saved.push({ path: ref.path, data: JSON.parse(JSON.stringify(data)) }); },
    ctx: { leOnly() {}, leShow() {}, leListEnsure() {}, imOnly() {}, imListRender() {} } });
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.SP.today = new Date(2026, 6, 15);
  C.FA.log = [];
  ['SP', 'CPC'].forEach(b => { C.LI_WS.schema[b].NAPKIN = { at: Date.now(), ok: [], hl: { none: true } }; });
  const now = Date.now();
  const cat = {};
  Object.keys(KW).forEach((sku, i) => {
    const title = TITLE(COLORS[i]);
    C.HEALTH.SP.rows.push({ brand: 'SP', parent: 'PK', sku, asin: 'B0' + sku + 'XXXXX', title, qty: 5, price: 12.5, status: 'Active', channel: 'AFN', aplus: true, aplusAt: now, checked: now,
      content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } });
    cat[sku] = { subcat: 'Napkin Set', color: COLORS[i], size: '18x18' };
    const kw = KW[sku];
    C.LI_WS.live.SP[sku] = { at: now, cAt: now, pt: 'NAPKIN', title, titleLen: title.length, catTitle: title, tAt: now, kw: kw.slice(0, 300), kwBytes: bytes(kw), bul: 5, desc: 300 };
  });
  C.setCat('SP', cat);
  C.LI_WS.liveV++;
  C.reset();
  return { C, saved };
}
const patchCalls = (C, apply) => C.calls.filter(c => c.lfix === 'patch' && c.apply === apply);
const pop = C => C.el('spModalBox').innerHTML;
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 1)); };

(async () => {
  console.log('== the shortening: only words taken out, in the order asked ==');
  {
    const { C } = setup();
    const brands = ['ridhi', 'cpc', 'whimsical corner'];
    const facts = C.lrSwFacts({ brand: 'SP', sku: 'K1' }, null, null, { title: TITLE('Blue'), pt: 'NAPKIN' });
    const s = C.kfShorten(K1, { title: TITLE('Blue'), brands, facts });
    const why = w => (s.removed.find(r => r.w.replace(/[^\w]/g, '').toLowerCase() === w.toLowerCase()) || {}).why;
    ok('1 repeats out (the first one stays): the second "dinner"', why('dinner') === 'repeated' && s.after.split(' ').filter(w => w === 'dinner').length === 1, s.after);
    ok('2 its important words stay the first time though the title says them: napkins (its product), cotton (its material), Blue (its colour)', !why('napkins') && !why('cotton') && !why('Blue')
      && /^napkins cotton dinner party/.test(s.after) && / Blue /.test(s.after), s.after);
    ok('3 punctuation and stop words out: "&", the, for — and "party;" kept as "party"', why('the') === 'stop word' && why('for') === 'stop word' && s.removed.some(r => r.w === '&' && r.why === 'punctuation') && / party /.test(' ' + s.after + ' '));
    // OUR WORD RULES (27 Nov 2026): our brand names STAY once (they were taken out before) — ASINs still go
    ok('4 our brand names KEPT once (CPC, "Whimsical Corner" — protected like the important words); the ASIN out', !why('CPC') && !why('Whimsical') && !why('Corner') && why('B0ABCDEFGH') === 'ASIN'
      && / CPC Whimsical Corner Blue /.test(s.after), s.after);
    ok('…268 bytes after those (our brands stay): the last other words go ("cut to fit": alpha0019–0021) → 241, every important word and brand kept', s.cut && s.fits && s.bytesAfter === 241 && why('alpha0021') === 'cut to fit' && why('alpha0019') === 'cut to fit'
      && s.after === 'napkins cotton dinner party wedding table linen kitchen CPC Whimsical Corner Blue ' + words('alpha', 19, 4).join(' '), s.bytesAfter + ' ' + s.after);
    const s2 = C.kfShorten(K2, { title: TITLE('Blue'), brands });
    ok('5 still over: words cut from the END until it fits (the start stays): 280 → 245, word035…word039 out', s2.cut && s2.bytesAfter === 245 && s2.after === words('word', 35, 3).join(' ')
      && s2.removed.map(r => r.w).join() === 'word035,word036,word037,word038,word039' && s2.removed.every(r => r.why === 'cut to fit'));
    const s5 = C.kfShorten(K5, { title: '', brands });
    ok('the 249 edge: 250 bytes is over → one word off (245); 249 bytes is not over', s5.over && s5.bytesAfter === 245 && !C.kfShorten(K4, {}).over);
    const all = [K1, K2, K5, K6].map(k => [k, C.kfShorten(k, { title: TITLE('Blue'), brands })]);
    ok('never a new word: every word after is a word before, in the same order', all.every(([k, r]) => { const b = k.split(/[\s,;|]+/).map(w => w.replace(/^[^\w]+|[^\w]+$/g, '')); let i = 0; return r.after.split(' ').every(w => { while (i < b.length && b[i] !== w) i++; return i++ < b.length; }); }));
    ok('…and every one fits the shared rule (lrKwCheck, 249)', all.every(([, r]) => r.fits && !C.lrKwCheck(r.after, 249).over));
  }

  console.log('== the Workspace row: "Search terms over the limit" → Fix all N children ==');
  {
    const { C } = setup();
    const g = C.faGroups('SP', 'PK', C.faKids('SP', 'PK')).find(x => x.kind === 'kw');
    ok('one row, kind kw: K1, K2, K5, K6 (not K3 short, not K4 at exactly 249)', g && g.kids.map(k => k.sku).sort().join() === 'K1,K2,K5,K6', g && g.kids.map(k => k.sku).join());
    const html = C.faBlockHtml('SP', 'PK');
    ok('the block: what we will do, and ONE button "Fix all 4 children" (K6 counts: read whole when the preview opens)', /Shorten to 249 bytes — repeats, other brands' names and ASINs out; winning words added when they fit; then a wrong shape or colour, low-value words, the weakest added word and other words until it fits; our brands and important words kept once/.test(html)
      && />Fix all 4 children</.test(html), strip(html).slice(0, 500));
    C.FA.open.add('SP|PK|' + g.key);
    const open = C.faBlockHtml('SP', 'PK');
    ok('"› Show all" lists each child with bytes before → after ("250 bytes → 245 bytes"; K1, K2, K6 — kept cut at 300 letters — "read whole when you press Fix all")', /fa-was">250 bytes<\/span> → <span class="fa-new">245 bytes</.test(open) && (open.match(/<span class="fa-new">read whole when you press Fix all/g) || []).length === 3, strip(open).slice(0, 800));
  }

  console.log('== the preview: one popup for the family — reads K6 whole first ==');
  const A = setup({ amazon: { rej: 'K5' } });
  {
    const { C } = A;
    const g = C.faGroups('SP', 'PK', C.faKids('SP', 'PK')).find(x => x.kind === 'kw');
    C.reads = [];
    const p = C.faStart('SP|PK|' + g.key);
    await settle();
    ok('the children whose kept text is cut (K1, K2, K6: Sellora keeps 300 letters) are read whole from Amazon (?lfix=get) — not K5', (C.reads || []).join() === 'K1,K2,K6', (C.reads || []).join());
    const run = C.KF.run;
    const html = pop(C);
    ok('the total on top: "4 children · all will be ≤ 249 bytes"', /4 children · all will be ≤ 249 bytes/.test(strip(html)), strip(html).slice(0, 200));
    ok('a row per child: SKU, colour · size, bytes before → after (K1 291 → 241, K6 360 → 243)', /<b>K1<\/b><small>Blue · 18 x 18 Inch<\/small>/.test(html)
      && /data-kf-key="SP\|K1"[\s\S]*?<span class="err">291<\/span> → <span class="ok" data-kf-n="SP\|K1">241<\/span> bytes/.test(html) && /<span class="err">360<\/span> → <span class="ok" data-kf-n="SP\|K6">243<\/span>/.test(html), strip(html).slice(0, 600));
    ok('the removed words struck through, with the reason after them (duplicate · limit); our brand kept 🔒', /<s class="kf-cut" title="duplicate">dinner<\/s><small class="kf-why">duplicate<\/small>/.test(html) && /<s class="kf-cut" title="limit">word035<\/s>/.test(html)
      && !/<s class="kf-cut"[^>]*>CPC<\/s>/.test(html) && /<span class="kf-lock" title="protected: our brand">🔒CPC<\/span>/.test(html), html.slice(html.indexOf('SP|K1'), html.indexOf('SP|K1') + 600));
    // (28 Nov 2026) the Brand Analytics uploads are gone: the bestseller scout is the 2nd source — not run here, so it says so
    ok('no winning-word data here: the popup says so ("Bestseller scout hasn\'t run yet — skipped") — nothing is added', /Bestseller scout hasn't run yet — skipped/.test(html.replace(/&#39;/g, "'")) && !/No winning-keyword data/.test(html) && !/kf-add/.test(html), strip(html).slice(0, 400));
    ok('a search box, Select all (on), a tick per child (on), the new text to edit', /data-kf-q/.test(html) && /data-kf-all checked/.test(html) && (html.match(/data-kf-tick="[^"]+" checked/g) || []).length === 4 && (html.match(/<textarea data-kf-edit=/g) || []).length === 4);
    ok('…and nothing sent yet: no patch at all', !C.calls.some(c => c.lfix === 'patch'));
    // search: the rows that do not match are hidden (in place in the page; drawn hidden here), the ticks stay as they were
    C.kfInput({ dataset: { kfQ: '' }, value: 'Teal' });
    C.kfDraw();
    const rowsShown = (pop(C).match(/class="sp-m-row sq-row kf-row"/g) || []).length;
    ok('the search box: "Teal" shows only K6 (its colour), the other rows hidden; nothing unticked', rowsShown === 1 && (pop(C).match(/kf-row hide"/g) || []).length === 3 && run.sel.size === 4, rowsShown);
    C.kfInput({ dataset: { kfQ: '' }, value: '' });
    C.kfDraw();
    C.kfInput({ dataset: { kfTick: 'SP|K2' }, checked: false });
    ok('a tick off: "3 ticked", the button "Check with Amazon & send 3"', /4 children · all will be ≤ 249 bytes · 3 ticked/.test(strip(pop(C))) && /Check with Amazon &amp; send 3/.test(pop(C)), strip(pop(C)).slice(0, 200));
    C.kfInput({ dataset: { kfEdit: 'SP|K1' }, value: 'dinner party wedding' });
    ok('an edit of K1: its new text is the person\'s', run.edit.get('SP|K1') === 'dinner party wedding');
    C.kfGo();
    await C.SQ.run.checked;
    const sq = C.SQ.run;
    ok('Check with Amazon & send → THE ONE SEND PATH: Amazon checks the 3 ticked first (apply false), screen "Search terms · Fix all"', patchCalls(C, false).length === 3 && sq.jobs.map(j => j.sku).sort().join() === 'K1,K5,K6'
      && C.SQ.screens.slice(-1)[0] === 'Search terms · Fix all', sq.jobs.map(j => j.sku).join());
    ok('…each patch is that child\'s own generic_keyword (K1 the edit, K6 from its whole text)', patchCalls(C, false).every(c => c.patches.length === 1 && c.patches[0].path === '/attributes/generic_keyword')
      && patchCalls(C, false).find(c => c.sku === 'K1').patches[0].value[0].value === 'dinner party wedding' && patchCalls(C, false).find(c => c.sku === 'K6').patches[0].value[0].value === words('long', 27, 5).join(' '));
    ok('…the Amazon check popup shows the words out and the bytes of the new text', /Hidden search words:<\/small> <span class="sq-rem">− /.test(pop(C)) && /\(243 of 249\)/.test(pop(C)), strip(pop(C)).slice(0, 300));
    await C.sqApprove();
    await idle(C);
    ok('Approve & send: the 3 sent (apply true), each read again', patchCalls(C, true).length === 3 && sq.step === 'done');
    ok('the result: "2 accepted · 1 rejected (reason)"', /✅ 2 accepted · ❌ 1 rejected \(The value for generic_keyword is not valid\)/.test(strip(pop(C))), strip(pop(C)).slice(0, 200));
    const hist = A.saved.filter(s => /^history\/listing_/.test(s.path)).flatMap(s => Object.values(s.data.rows));
    ok('Listing History: a row per child sent, kind listing, screen "Search terms · Fix all", old → new, with the OLD value for Put back', hist.length === 3 && hist.every(r => r.kind === 'listing' && r.screen === 'Search terms · Fix all' && r.attr === 'generic_keyword' && r.oldV && r.oldV[0].value === r.old)
      && hist.find(r => r.sku === 'K1').old === K1 && hist.find(r => r.sku === 'K1').new === 'dinner party wedding' && hist.find(r => r.sku === 'K5').result === 'rejected', JSON.stringify(hist.map(r => [r.sku, r.result])));
    C.SQ.run && C.sqClose();
    await settle();
    ok('the change log (the block\'s History, Put back): K1, K5, K6 with the old search terms', C.FA.log.length === 3 && C.FA.log.find(r => r.sku === 'K1').before.kw === K1 && C.FA.log.find(r => r.sku === 'K1').after.kw === 'dinner party wedding');
    const back = C.faBackPatches(C.FA.log.find(r => r.sku === 'K6'));
    ok('…Put back sends the old search terms again', back.length === 1 && back[0].path === '/attributes/generic_keyword' && back[0].value[0].value === K6);
    C.reset();
    const g2 = C.faGroups('SP', 'PK', C.faKids('SP', 'PK')).find(x => x.kind === 'kw');
    ok('after: K1 and K6 leave "Search terms over the limit"; K2 (not ticked) stays; K5 (rejected) comes back', g2 && g2.kids.map(k => k.sku).sort().join() === 'K2,K5', g2 && g2.kids.map(k => k.sku).join());
    ok('…the row says what the last Fix all did', C.KF.last.get('SP') === '✅ 2 accepted · ❌ 1 rejected · ⏳ 0', C.KF.last.get('SP'));
    await p;
  }

  console.log('== an edit over the limit is held back; Cancel sends nothing ==');
  {
    const { C } = setup();
    const g = C.faGroups('SP', 'PK', C.faKids('SP', 'PK')).find(x => x.kind === 'kw');
    C.faStart('SP|PK|' + g.key, 'K2');
    await settle();
    ok('one child alone (its own Fix): the preview with only K2', C.KF.run.plans.length === 1 && C.KF.run.plans[0].sku === 'K2');
    C.kfInput({ dataset: { kfEdit: 'SP|K2' }, value: K2 });
    ok('the edit back over 249: red, "0 will be ≤ 249 bytes · 1 edited over the limit", nothing to send', /1 child · 0 will be ≤ 249 bytes · 1 edited over the limit/.test(strip(pop(C))) && /send 0/.test(pop(C)) && C.kfGo() === null, strip(pop(C)).slice(0, 200));
    C.kfInput({ dataset: { kfEdit: 'SP|K2' }, value: '' });
    ok('…an empty edit is not sent either', C.kfGo() === null);
    const run = C.KF.run;
    C.kfClick({ dataset: { kf: 'cancel' } });
    ok('Cancel: the popup goes, nothing sent', run.closed && C.el('spModalBox').innerHTML === '' && !C.calls.some(c => c.lfix === 'patch'));
  }

  console.log('== the test site: everything but the send ==');
  {
    const { C, saved } = setup({ window: { __TEST_ERP: true } });
    const g = C.faGroups('SP', 'PK', C.faKids('SP', 'PK')).find(x => x.kind === 'kw');
    C.faStart('SP|PK|' + g.key);
    await settle();
    ok('the preview works there too (4 children)', /4 children · all will be ≤ 249 bytes/.test(strip(pop(C))));
    C.kfGo();
    await C.SQ.run.checked;
    await C.sqApprove();
    ok('"Test site — not sent to Amazon": no patch, no history, no change log', /Test site — not sent to Amazon/.test(pop(C)) && !C.calls.some(c => c.lfix === 'patch') && !saved.some(s => /^history\//.test(s.path)), strip(pop(C)).slice(0, 200));
  }

  console.log('== Listing Errors: the card, per family and Select all ==');
  {
    const { C } = setup();
    const card = C.kfLeCardHtml('SP', null);
    ok('the card: "Search terms over the limit: 4 listings in 1 family", Select all · Fix all 4, and the family with "Fix all 4 children"', /Search terms over the limit: 4 listings in 1 family/.test(strip(card))
      && /data-kf-le="all"[^>]*>Select all · Fix all 4</.test(card) && /data-kf-le="fam"[^>]*data-kf-parent="PK"[^>]*>Fix all 4 children</.test(card), strip(card));
    ok('…picked listings only (opened from Listing Health for K2 and K3): 1 listing', /1 listing in 1 family/.test(strip(C.kfLeCardHtml('SP', new Set(['K2', 'K3'])))));
    C.kfLeStart('SP', 'PK', null);
    await settle();
    ok('Fix all for the family: the same preview (4 children)', C.KF.run && C.KF.run.plans.filter(p => p.ok).length === 4 && /Fix all search terms — /.test(pop(C)));
    ok('the console report: children and families it would fix, and one SKU before → after', (() => { const r = C.kfReport('K2'); return r.Ridhi.childrenOver === 4 && r.Ridhi.families === 1 && r.example.bytes === '280 → 245'; })());
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
