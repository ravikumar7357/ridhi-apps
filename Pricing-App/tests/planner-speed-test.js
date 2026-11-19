/* Season planner SPEED + NO JUMPING (12 Nov 2026): the parent list reads nothing; one open parent reads only its own listings —
 * titles and search words 20 a call, then Item Highlights one by one, 4 at a time — redraws at most every 2 s and never while scrolled,
 * and opening it again reads nothing. A parent of 469 tablecloths ("Tablecloth Main") and a stub Amazon that answers in 20 ms.
 *   node tests/planner-speed-test.js */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const N = 469;
const OTHER = 300;                                    // the rest of the brand: other parents, never read
const T = i => `Ridhi Rectangle Tablecloth 60 x 90 Inch Dining Table Cover Ref No ${String(i).padStart(3, '0')} - Red`;

(async () => {
  const calls = [];
  let inflight = 0, maxInflight = 0;
  const titles = {};
  const baCall = async p => {
    calls.push(p);
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    await sleep(20);
    inflight--;
    if (p.lfix === 'content') return { ok: true, items: Object.fromEntries(p.skus.split(',').map(sku => [sku, { productType: 'TABLECLOTH_X', item_name: [{ value: titles[sku] }], generic_keyword: [{ value: 'dinner party' }], bullet_point: [{ value: 'a' }], product_description: [{ value: 'b' }] }])) };
    if (p.lfix === 'get') return { ok: true, productType: 'TABLECLOTH_X', title: titles[p.sku], status: ['BUYABLE', 'DISCOVERABLE'], issues: [], attributes: { title_differentiation: [{ value: 'Hand block printed cotton' }] } };
    if (p.lfix === 'schema') return { ok: true, attrs: { title_differentiation: { name: 'title_differentiation', fields: [{ field: 'value', maxLength: 125 }], maxItems: 1 } } };
    return {};
  };
  const C = load({ ws: true, sp: true, baCall });
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.SP.today = new Date(2026, 10, 12);
  const cat = {};
  const put = (parent, sku, title) => {
    titles[sku] = title;
    C.HEALTH.SP.rows.push({ brand: 'SP', parent, sku, asin: 'B0' + sku, title, qty: 5, price: 30, status: 'Active', channel: 'AFN', aplus: true, aplusAt: Date.now(), checked: Date.now(),
      content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } });
    cat[sku] = { color: 'Red', size: '60x90', subcat: 'Rectangle Tablecloth' };
  };
  for (let i = 0; i < N; i++) put('TM', 'TM' + i, T(i));
  for (let i = 0; i < OTHER; i++) put('O' + (i % 30), 'OT' + i, T(i));
  C.setCat('SP', cat);
  ok('the sample titles are 75 letters (Christmas does not fit the title)', T(1).length === 75, T(1).length);
  // count the redraws: every write of the list's and the panel's HTML
  const draws = { list: 0, panel: 0 };
  const watch = (id, k) => { const el = C.el(id); let html = ''; Object.defineProperty(el, 'innerHTML', { get: () => html, set: v => { html = v; draws[k]++; } }); };
  watch('spPane', 'list');
  watch('spPanel', 'panel');
  C.SP.on = true;

  console.log('== the parent list: what is held, nothing read ==');
  let t0 = Date.now();
  C.spRender();
  const listMs = Date.now() - t0;
  await sleep(50);
  ok(`the parent list of ${N + OTHER} listings draws in ${listMs} ms and reads nothing from Amazon`, calls.length === 0 && listMs < 3000, calls.length + ' calls');
  ok('…no "being read" on any parent card', !/being read/.test(C.el('spPane').innerHTML));
  // (13 Nov 2026 season rules) nothing is read for the list, so nothing is known about the two places yet: "not read yet", never a count of 0
  ok('…its line shows at once: "469 listings · 469 not read yet — open to check"', /Parent TM<\/b><span>469 listings · <span class="sp-dim">469 not read yet — open to check/.test(C.el('spPane').innerHTML), (C.el('spPane').innerHTML.match(/Parent TM<\/b><span>.{0,160}/) || [''])[0]);

  console.log('== one parent: reads only its own listings ==');
  t0 = Date.now();
  C.spOpenParent('SP|TM');
  const openMs = Date.now() - t0;
  ok(`the panel opens in ${openMs} ms (under a second)`, openMs < 1000);
  ok('…the header says it quietly: "Reading 0 of 469 — you can keep working"', /Reading 0 of 469 — you can keep working/.test(C.el('spPanel').innerHTML), (C.el('spPanel').innerHTML.match(/Reading[^<]*/) || [''])[0]);
  ok('…the panel body has no "Reading … listings" line of its own', !/Reading \d+ listings? from Amazon/.test(C.el('spPanel').innerHTML));
  // reads land; meanwhile I scroll the panel for 1.5 s: no redraw of the panel or the list while scrolling
  const before = { ...draws };
  const scrollStart = Date.now();
  const scroller = setInterval(() => { C.SP.scrollAt = Date.now(); }, 100);
  C.SP.scrollAt = Date.now();
  await sleep(1500);
  clearInterval(scroller);
  const during = { list: draws.list - before.list, panel: draws.panel - before.panel };
  ok('scrolling while reads land: no redraw at all (the panel and the list wait until scrolling stops)', during.list === 0 && during.panel === 0, JSON.stringify(during) + ` over ${Date.now() - scrollStart} ms`);
  // let every read land
  const readStart = Date.now();
  const drawsAt = { ...draws };
  let quiet = 0;
  for (let i = 0, last = -1; i < 1200 && quiet < 3000; i++) { await sleep(100); if (calls.length === last && !C.LI_WS.q.length && !C.LI_WS.inflight) quiet += 100; else { quiet = 0; last = calls.length; } }
  const readMs = Date.now() - readStart - 3000;
  const reads = { content: calls.filter(c => c.lfix === 'content').length, get: calls.filter(c => c.lfix === 'get').length, schema: calls.filter(c => c.lfix === 'schema').length };
  ok(`titles and search words 20 a call: ${reads.content} calls for ${N} listings`, reads.content === Math.ceil(N / 20), JSON.stringify(reads));
  ok(`Item Highlights one by one for this parent only: ${reads.get} reads, the schema once`, reads.get === N && reads.schema === 1, JSON.stringify(reads));
  ok('no listing of another parent was read', !calls.some(c => (c.sku && /^OT/.test(c.sku)) || (c.skus && /OT/.test(c.skus))));
  ok(`at most 4 reads at a time (${maxInflight})`, maxInflight <= 4);
  const redraws = draws.panel - drawsAt.panel;
  ok(`while reads ran (${readMs} ms) the panel redrew at most once every 2 s (${redraws} times)`, redraws <= Math.ceil((readMs + 3000) / 2000) + 1, redraws + ' redraws');
  ok('…the progress is gone once every read is in', !/Reading \d+ of/.test(C.el('spPanel').innerHTML), (C.el('spPanel').innerHTML.match(/Reading[^<]*/) || [''])[0]);
  const g = C.spGroupOf('SP|TM');
  const it = g.all[0];
  ok('…and the plan uses them: both seasons on now at the start of Item Highlights, the title untouched', it.status === 'ready' && it.hlAfter[0] === 'Thanksgiving and Christmas table decor, hand block printed cotton' && it.after === it.title,
    JSON.stringify([it.status, it.hlAfter, it.why]));

  console.log('== opening it again reads nothing ==');
  const n0 = calls.length;
  C.spCloseParent(false);
  C.spOpenParent('SP|TM');
  await sleep(300);
  ok('closed and opened again: no new read (all held for 24 h, the same cache as the Workspace)', calls.length === n0, (calls.length - n0) + ' new calls');
  ok('…and no progress line', !/Reading \d+ of/.test(C.el('spPanel').innerHTML));

  console.log('== Item Highlights not read yet: the row shows at once, "checking…" ==');
  {
    const D = load({ ws: true, sp: true });
    D.setHealthLoaded(true); D.LI_WS.stored = true; D.SP.log = [];
    D.LI_WS.schema.SP.TABLECLOTH_X = { at: Date.now(), ok: [], hl: { items: 1, max: 125, bytes: 0 } };
    const title = T(1);
    D.HEALTH.SP.rows.push({ brand: 'SP', parent: 'TM', sku: 'Z1', asin: 'B0Z1', title, qty: 5, price: 30, status: 'Active', channel: 'AFN', aplus: true, aplusAt: Date.now(), checked: Date.now(), content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } });
    D.setCat('SP', { Z1: { color: 'Red', size: '60x90', subcat: 'Rectangle Tablecloth' } });
    const now = Date.now();
    D.LI_WS.live.SP.Z1 = { at: now, cAt: now, pt: 'TABLECLOTH_X', title, titleLen: title.length, catTitle: title, tAt: now, kw: 'dinner party', kwBytes: 11 };
    D.LI_WS.liveV++; D.reset();
    const z = D.spCompute(new Date(2026, 10, 12)).find(x => x.sku === 'Z1');
    const row = D.spRowHtml(z);
    ok('the row: missing in the search words (known), Item Highlights not read yet → Reading; its button waits', z.status === 'reading' && z.miss.christmas.kw === 'missing' && z.miss.christmas.hl === 'unknown'
      && /Reading this listing from Amazon…/.test(row) && /✕ search words/.test(row) && /disabled>Wait</.test(row), row.slice(0, 500));
    ok('…the child panel says so: Item Highlights "Not read yet", its main button waits', /sp-main" disabled>Reading from Amazon…/.test(D.spKidHtml(z, null)) && /Item Highlights: Not read yet/.test(D.spKidHtml(z, null)));
  }

  console.log(`\n  timings: parent list ${listMs} ms (${N + OTHER} listings, no reads) · open "Tablecloth Main" ${openMs} ms · all ${N} reads in ${readMs} ms with a 20 ms stub`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
