/* Pricing-API/KeywordScout.gs (28 Nov 2026, not deployed yet) in a sandbox: fake Apps Script services and a fake Catalog Items API.
 *   node tests/kw-scout-test.js
 * The Bestseller keyword scout: only GET catalogue searches, the top 25 by Best Seller Rank that are not ours, words mined from their
 * titles + bullets (brands, ASINs, numbers, joining words out), kept at ≥ 30 %, weekly + Run now, a failed search keeps the last words. */
const fs = require('fs'), path = require('path');
const { TC, NP, scoutWorld, scoutTab } = require('./kw-scout-sample.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); } };

console.log('== word mining (kwsMine_, pure) ==');
{
  const W = scoutWorld();
  const m = W.api.kwsMine_;
  const items = [
    { b: 'Lahome', t: 'Lahome Farmhouse Tablecloth, Wrinkle Free, 60 x 120 Inch', bl: ['Wrinkle free and machine washable', 'Fits B0ABCDEFGH tables'], r: 100 },
    { b: 'Utopia Home', t: 'Utopia Home Farmhouse Tablecloth for the Table', bl: ['Great gift, wrinkle free'], r: 300 },
    { b: 'Etopia', t: 'Etopia Boho Tablecloth 100% Cotton', bl: ['Boho look'], r: 200 },
    { b: 'Maison', t: 'Maison Round Tablecloth', bl: ['Like Lahome, boho'], r: 400 },
  ];
  const w = m(items, { min: 0.5 });
  const ws = w.map(x => x.w);
  ok('words and 2–3 word phrases used by ≥ the share (here 50 %): "tablecloth" 4, "farmhouse" 2, "wrinkle free" 2, "boho" 2, "farmhouse tablecloth" 2',
    ['tablecloth', 'farmhouse', 'wrinkle free', 'boho', 'farmhouse tablecloth', 'wrinkle', 'free'].every(x => ws.includes(x)) && w.find(x => x.w === 'tablecloth').n === 4, ws.join(' | '));
  ok('counted once per bestseller (wrinkle free in title and bullet = 1), best rank kept', w.find(x => x.w === 'wrinkle free').n === 2 && w.find(x => x.w === 'wrinkle free').r === 100 && w.find(x => x.w === 'boho').r === 200 && w.find(x => x.w === 'boho').n === 2);
  ok('every brand of the results out — also inside another item\'s text ("Like Lahome") and multi-word ("Utopia Home"); our brands too', !ws.some(x => /lahome|utopia|etopia|maison|ridhi|cpc/.test(x)), ws.join(' | '));
  ok('ASINs, numbers ("60", "120", "100%"), words under 3 letters and joining words out — a phrase never begins or ends with one', !ws.some(x => /b0abcdefgh|\d/.test(x)) && !ws.some(x => /^(for|the|and|of|x) | (for|the|and|of|x)$/.test(x)) && !ws.includes('the'), ws.join(' | '));
  ok('a joining word never inside a phrase ("tablecloth for the table" gives no "tablecloth for" / "for the table" / "tablecloth for the")', !ws.some(x => / (for|the|and) /.test(' ' + x + ' ') && x.includes(' ')));
  ok('low-value words alone out (great, gift, look)', !ws.some(x => /^(great|gift|look|great gift)$/.test(x)));
  ok('a phrase never crosses a comma: "tablecloth wrinkle" (title "Tablecloth, Wrinkle Free") is not a phrase', !ws.includes('tablecloth wrinkle') && !ws.includes('tablecloth wrinkle free'));
  ok('the ≥ 30 % threshold (the default): with 4 items a word needs 2 — "round" (1 of 4) is not kept, "boho" (2) is', !m(items).some(x => x.w === 'round') && m(items).some(x => x.w === 'boho'));
  const ten = Array.from({ length: 10 }, (_, i) => ({ b: 'B' + i, t: (i < 3 ? 'Scalloped ' : '') + (i < 2 ? 'Fringe ' : '') + 'Placemat', bl: [], r: i + 1 }));
  ok('…exactly 30 %: 3 of 10 kept ("scalloped"), 2 of 10 not ("fringe")', m(ten).some(x => x.w === 'scalloped' && x.n === 3) && !m(ten).some(x => x.w === 'fringe'));
  ok('most used first, then the shorter', ws[0] === 'tablecloth' && ws.indexOf('farmhouse') < ws.indexOf('farmhouse tablecloth'));
}

console.log('== one run: Amazon read-only, top 25 by rank, ours and other product types left out ==');
const W = scoutWorld();
{
  const st0 = W.api.kwsAsk_('blanket~blanket~BLANKET,tablecloth~tablecloth~TABLECLOTH');
  ok('Run now (?kwscout=run): asks, and starts a one-off trigger within seconds (kwsKick, 1 s)', st0.ok && W.triggers.some(t => t.fn === 'kwsKick' && t.after === 1000));
  W.api.kwsTick();
  const tab = W.tabs.kwScout;
  const gets = W.calls.filter(c => c.p);
  ok('only GET catalogue searches (searchCatalogItems with keywords) — nothing else is ever called', gets.length > 0 && gets.every(c => c.m === 'get' && /^\/catalog\/2022-04-01\/items\?marketplaceIds=ATVPDKIKX0DER&keywords=/.test(c.p)), JSON.stringify(gets.map(c => c.p.slice(0, 80))));
  ok('summaries, attributes (bullets), sales ranks and product types asked for; pages of 20 (the tablecloth search: 2 pages)', gets.every(c => /pageSize=20&includedData=summaries,attributes,salesRanks,productTypes/.test(c.p)) && gets.filter(c => /keywords=tablecloth/.test(c.p)).length === 2);
  ok('a pause between calls (Catalog Items allows 2 a second)', W.calls.filter(c => c.sleep >= 700).length >= gets.length - 1);
  ok('our five product types always, plus the one Sellora found in our listings (blanket) — the duplicate tablecloth once', Object.keys(tab.types).join() === 'tablecloth,napkin,placemat,runner,pillow,blanket', Object.keys(tab.types).join());
  const tc = tab.types.tablecloth;
  ok('tablecloth: the top 25 of 30 results — our 2 (Ridhi, Whimsical Corner) and 2 napkin rings (another product type) left out, the 26th by rank not counted',
    tc.n === 25 && tc.scanned === 30 && tc.ours === 2 && tc.other === 2 && tc.items.length === 25 && !tc.items.some(x => /RIDHI|WHIMS|RING/.test(x.a)) && !tc.items.some(x => x.a === 'B0TA000025'), JSON.stringify([tc.n, tc.scanned, tc.ours, tc.other]));
  ok('…sorted by Best Seller Rank (the display-group rank), best first', tc.items.every((x, i, a) => !i || a[i - 1].r <= x.r) && tc.items[0].r === 120);
  const words = new Map(tc.words.map(x => [x.w, x]));
  ok('mined: "farmhouse" 12 of 25, "boho" 9, "wrinkle free" 10, "christmas buffalo plaid" 9 — never "rustic" (6 = 24 %) nor "lastone" (only the 26th)',
    words.get('farmhouse').n === 12 && words.get('boho').n === 9 && words.get('wrinkle free').n === 10 && words.get('christmas buffalo plaid').n === 9 && !words.has('rustic') && !words.has('lastone'), [...words.keys()].slice(0, 30).join(' | '));
  ok('brands out (Lahome, Utopia Home, Etopia, Maison d\' Hermine, Angry Orange) — the IP Guard names are taken out by Sellora (the backend cannot know "Pottery Barn")', ![...words.keys()].some(k => /lahome|utopia|etopia|maison|hermine|angry|orange|ridhi|whimsical/.test(k)) && words.has('pottery barn'));
  ok('ASINs and numbers out', ![...words.keys()].some(k => /\d|b0/.test(k)));
  ok('a phrase never begins or ends with a low-value word: "pottery barn style" yes, "style look" / "look" no', words.has('pottery barn style') && !words.has('style look') && !words.has('look'));
  const np = tab.types.napkin;
  ok('napkins ("cloth napkins"): 20 counted — farmhouse 10, wedding 8, boho 7, linen 9', np.q === 'cloth napkins' && np.n === 20 && np.words.find(x => x.w === 'farmhouse').n === 10 && np.words.find(x => x.w === 'wedding').n === 8 && np.words.find(x => x.w === 'boho').n === 7);
  ok('the tab: when, how, the share, top — and an empty search is an empty type (placemats: none), never invented', tab.v === 1 && tab.at === '2026-11-28 06:10' && tab.by === 'run now' && tab.top === 25 && tab.min === 0.3 && !tab.partial && tab.types.placemat.n === 0 && !tab.types.placemat.words.length);
  ok('?kwscout=status: done, the last run, the next one in a week', W.api.kwsStatus_().running === false && W.api.kwsStatus_().last.types === 6 && W.api.kwsStatus_().next === '2026-12-05 06:10', JSON.stringify(W.api.kwsStatus_()));
  ok('the catalogue is read with Ridhi\'s credentials (the same for both brands)', W.calls.some(c => c.brand === 'SP'));
}

console.log('== weekly, and failures ==');
{
  W.calls.length = 0;
  W.setNow(W.getNow() + 3 * 864e5);
  W.api.kwsTick();
  ok('3 days later the hourly tick reads nothing (once a week)', !W.calls.some(c => c.p));
  W.setNow(W.getNow() + 4 * 864e5 + 60000);
  W.api.kwsTick();
  ok('a week later it runs again by itself ("weekly") with the types Sellora last sent', W.calls.filter(c => c.p).length > 0 && W.tabs.kwScout.by === 'weekly' && 'blanket' in W.tabs.kwScout.types);
  const F = scoutWorld();
  F.api.kwsAsk_('');
  F.api.kwsTick();
  const before = JSON.stringify(F.tabs.kwScout.types.napkin.words);
  F.setNow(F.getNow() + 8 * 864e5);
  const G = scoutWorld({ fail: ['cloth napkins'] });
  Object.assign(G.tabs, JSON.parse(JSON.stringify(F.tabs)));
  G.setNow(F.getNow());
  G.api.kwsAsk_('');
  for (let i = 0; i < 3; i++) G.api.kwsTick();
  ok('a search that keeps failing (3 tries) keeps the last run\'s words for that type, says why — never invented', JSON.stringify(G.tabs.kwScout.types.napkin.words) === before && /search failed \(500: InternalFailure\).*last run's words kept/.test(G.tabs.kwScout.types.napkin.err) && G.api.kwsStatus_().last.fail === 1, G.tabs.kwScout.types.napkin.err);
  const S = scoutWorld({ slow: ['cloth napkins'] });
  S.api.kwsAsk_('');
  S.api.kwsTick();
  ok('Amazon says slow down (429): the run stops there and goes on at the next tick (the types read so far are saved)', S.api.kwsStatus_().running && S.api.kwsStatus_().progress.done === 1 && S.tabs.kwScout.partial && S.tabs.kwScout.types.tablecloth.n === 25 && /slow down/.test(S.api.kwsStatus_().progress.note));
  const I = scoutWorld();
  I.api.kwsInstall();
  ok('kwsInstall: one hourly trigger', I.triggers.length === 1 && I.triggers[0].fn === 'kwsTick' && I.triggers[0].every === 1);
  ok('scoutTab() (the sample every Sellora test reads) is the tab of one run', scoutTab().types.tablecloth.n === 25);
}

console.log('== Code.gs routes ==');
{
  const code = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'Code.gs'), 'utf8');
  ok('?kwscout=run and ?kwscout=status — and the words are read through the existing ?cache= route (cacheRead_, no change there)', /if \(p\.kwscout === 'run'\) return json_\(kwsAsk_\(p\.types\)\);/.test(code) && /if \(p\.kwscout === 'status'\) return json_\(kwsStatus_\(\)\);/.test(code)
    && /: cacheRead_\(String\(p\.cache\)\);/.test(code));
  const gs = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'KeywordScout.gs'), 'utf8');
  ok('KeywordScout.gs: read-only on Amazon — no POST / PUT / PATCH / DELETE, no listings or feeds call', !/'(post|put|patch|delete)'/i.test(gs) && !/listings\/2021|feeds\/|\/reports\//.test(gs));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
void TC; void NP;
