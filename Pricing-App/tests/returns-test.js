/* Return spikes (src/app/sales/returns.js, Sales card #3 add-on): reading Amazon's FBA Customer Returns report, upload + re-upload
 * (no double count), the return-rate maths, spike vs normal, low volume filtered, the reasons breakdown, the comments, the no-data note,
 * the test site writing nothing, Ridhi / CPC, the nightly cache first, the Sales Alerts wiring, the Action Tracker's return task.
 *   node tests/returns-test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 600) : '')); } };
const SRC = p => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
const FILES = ['app/sales/sales-alerts.js', 'app/reimb/reimb-core.js', 'app/sales/tasks.js', 'app/sales/returns.js'];
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()), apply: () => stub() });
const STUBS = [];

function world(opt) {
  opt = opt || {};
  for (let tries = 0; tries < 200; tries++) {
    const store = {}, writes = [], clone = x => JSON.parse(JSON.stringify(x));
    const src = p => (opt.files && opt.files[p] != null ? opt.files[p] : SRC(p));   // opt.files: a file as an earlier commit had it
    const el = () => ({ addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, style: { setProperty() {} }, appendChild() {}, querySelector: () => null, setAttribute() {} });
    const base = {
      console: { log() {}, table() {}, warn() {}, error() {}, info() {} }, Intl, Math, JSON, Number, String, Object, Array, Set, Map, WeakMap, Promise, Date, isFinite, Error, RegExp, Symbol, Proxy, parseFloat, parseInt,
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el() },
      addEventListener() {}, $: () => null, ME: { email: 'asha@ridhihome.com', admin: false, tabs: ['sales', 'salert', 'atrack', 'health'] }, TAB_OK: t => ['sales', 'salert', 'atrack', 'health'].includes(t),
      sqIsTest: () => !!opt.test, sqName: e => String(e || '').split('@')[0].replace(/^./, c => c.toUpperCase()), auth: {}, onAuthStateChanged() {},
      db: {}, doc: (d, c, id) => ({ path: c + '/' + id }), collection: (d, c) => ({ c }), where: (f, o, v) => ({ f, v }), query: (c, w) => ({ c: c.c, w }),
      getDoc: async r => ({ exists: () => r.path in store, data: () => clone(store[r.path]) }),
      setDoc: async (r, d) => { writes.push(r.path); store[r.path] = clone(d); }, deleteDoc: async r => { writes.push('del:' + r.path); delete store[r.path]; },
      getDocs: async q => { const ds = Object.entries(store).filter(([p, d]) => p.startsWith(q.c + '/') && (!q.w || d[q.w.f] === q.w.v)).map(([p, d]) => ({ id: p.slice(q.c.length + 1), data: () => clone(d) })); return { docs: ds, forEach: fn => ds.forEach(fn) }; },
      runTransaction: async (d, fn) => fn({ get: async r => ({ exists: () => r.path in store, data: () => clone(store[r.path]) }), set: (r, x) => { writes.push(r.path); store[r.path] = clone(x); } }),
      API: { url: 'x' }, baCall: async () => (opt.cache ? { data: opt.cache } : { ok: false }), SD: { at: '', d: {} }, sdToday: () => '2026-11-25',
      foFor: b => ({ ok: true, fams: (opt.fams || []).filter(f => f.brand === b) }), foLoad: async () => {}, FO: { v: 1 },
    };
    STUBS.forEach(n => { if (!(n in base)) base[n] = stub(); });
    const ctx = vm.createContext(base);
    try {
      vm.runInContext(FILES.map(src).join('\n;\n') + '\n;this.__x = { RS, RS_M, rsParse, rsMerge, rsUpload, rsLoad, rsCompute, rsIsSpike, rsFor, rsData, rsSectionHtml, rsChipHtml, rsBarBtn, rsDetailHtml, rsWeek, returnsCheck, tkVerdict, AL, alBarHtml, alRender: typeof alRender === "function" ? alRender : null, rsWeeks: typeof rsWeeks === "function" ? rsWeeks : null, rsJob: typeof rsJob === "function" ? rsJob : null, rsPeek: typeof rsPeek === "function" ? rsPeek : null, rsSpikeOn, rsChartSvg };', ctx);
      return Object.assign(ctx.__x, { ctx, store, writes });
    } catch (e) {
      const m = /^(\w+) is not defined/.exec(e.message);
      if (m && !STUBS.includes(m[1])) { STUBS.push(m[1]); continue; }
      throw e;
    }
  }
  throw new Error('sandbox');
}

/* ---- the fixture: weeks 30 Aug … 15 Nov 2026 (US Pacific); the judged week 15–21 Nov ---- */
const add = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const WEEKS = []; for (let w = '2026-08-30'; w <= '2026-11-15'; w = add(w, 7)) WEEKS.push(w);
const kid = (asin, sku, perWeek) => ({ asin, skus: [sku], label: sku, s: WEEKS.map(wk => ({ wk, u: typeof perWeek === 'function' ? perWeek(wk) : perWeek })) });
const FAMS = [
  { key: 'SP|PA', brand: 'SP', parent: 'B0PARENTAA', name: 'Block Print Tablecloth', kids: [kid('B0AAAAAAA1', 'TC-6090', 60), kid('B0AAAAAAA2', 'TC-60120', 40)] },
  { key: 'SP|PB', brand: 'SP', parent: 'B0PARENTBB', name: 'Cotton Napkins', kids: [kid('B0BBBBBBB1', 'NP-RED', 100)] },
  { key: 'SP|PC', brand: 'SP', parent: 'B0PARENTCC', name: 'Small Apron', kids: [kid('B0CCCCCCC1', 'AP-1', 20)] },
  { key: 'CPC|PW', brand: 'CPC', parent: 'B0PARENTWW', name: 'Whimsical Pillow Insert', kids: [kid('B0WWWWWWW1', 'WCI-1818', 80)] },
];
const HEAD = 'return-date\torder-id\tsku\tasin\tfnsku\tproduct-name\tquantity\tfulfillment-center-id\tdetailed-disposition\treason\tstatus\tlicense-plate-number\tcustomer-comments';
let lpn = 0;
const line = (date, sku, asin, q, reason, comment) => [date + 'T18:00:00+00:00', '111-' + (++lpn), sku, asin, 'X0', 'Name', q, 'FC1', 'CUSTOMER_DAMAGED', reason, 'Unit returned to inventory', 'LPN' + lpn, comment || ''].join('\t');
function fileSP(extra) {
  lpn = 0;                                                 // the same file → the same orders and licence plates (the keys)
  const L = [HEAD];
  // 8 normal weeks + the judged week: Tablecloth 3 a week (3 % of 100 sold), Napkins 4 a week, Apron 0
  WEEKS.slice(1).forEach(wk => {
    const d = add(wk, 2);
    if (wk < '2026-11-15') { L.push(line(d, 'TC-6090', 'B0AAAAAAA1', 3, 'UNWANTED_ITEM')); L.push(line(d, 'NP-RED', 'B0BBBBBBB1', 4, 'DEFECTIVE')); }
  });
  // the judged week 15–21 Nov: Tablecloth 11 (6 not as described, 3 defective, 2 unwanted), Napkins 5, Apron 4 (20 % of 20 — but only 4 units)
  [['2026-11-16', 'TC-6090', 'B0AAAAAAA1', 3, 'NOT_AS_DESCRIBED', 'Colour is much darker than the photo'], ['2026-11-17', 'TC-60120', 'B0AAAAAAA2', 3, 'NOT_AS_DESCRIBED', 'Not the blue in the picture'],
    ['2026-11-18', 'TC-6090', 'B0AAAAAAA1', 3, 'DEFECTIVE', 'Seam came apart'], ['2026-11-19', 'TC-6090', 'B0AAAAAAA1', 2, 'UNWANTED_ITEM', ''],
    ['2026-11-19', 'NP-RED', 'B0BBBBBBB1', 5, 'DEFECTIVE', ''], ['2026-11-20', 'AP-1', 'B0CCCCCCC1', 4, 'APPAREL_TOO_SMALL', 'Too short'],
    ['2026-11-21', 'NP-RED', 'B0BBBBBBB1', 0, 'DEFECTIVE', ''], ['2026-11-21', 'ZZ-OTHER', 'B0ZZZZZZZ1', 1, 'DEFECTIVE', '']].forEach(r => L.push(line(...r)));
  (extra || []).forEach(r => L.push(r));
  return L.join('\n');
}

(async () => {
  console.log('== 1. reading the Customer Returns report ==');
  {
    const W = world({ fams: FAMS });
    const p = W.rsParse(fileSP(), 'SP');
    ok('every row read: date, SKU, ASIN, quantity, reason, comment, disposition (a 0-unit row skipped)', p.ok && p.rows.length === 2 * 10 + 7 && p.skipped === 1 && p.rows.some(x => x.c === 'Seam came apart' && x.x === 'CUSTOMER_DAMAGED' && x.r === 'DEFECTIVE'), JSON.stringify(p).slice(0, 200));
    ok('a return timestamp counts on its US Pacific day (18:00 UTC 16 Nov = 16 Nov PT; 05:00 UTC 17 Nov = 16 Nov PT)', p.rows.some(x => x.d === '2026-11-16') && W.rsParse(HEAD + '\n' + ['2026-11-17T05:00:00+00:00', 'o', 'S', 'B0X', '', '', 1, '', '', 'DEFECTIVE', '', 'L1', ''].join('\t'), 'SP').rows[0].d === '2026-11-16');
    const bad = W.rsParse('date\tsku\tqty\nx\ty\t1', 'SP');
    ok('a file without the report\'s columns is refused, naming them', !bad.ok && /no "return-date", "quantity", "reason" columns/.test(bad.err), bad.err);
    ok('…and the brand must be chosen', !W.rsParse(fileSP(), '').ok);
  }

  console.log('== 2. upload, re-upload: never counted twice ==');
  {
    const W = world({ fams: FAMS });
    await W.rsLoad();
    const m1 = await W.rsUpload('SP', fileSP(), 'returns-nov.txt');
    ok('the first upload: 27 returns read, saved in the shared history (history/returns_SP_0, kind returns)', /27 returns read/.test(m1) && W.store['history/returns_SP_0'] && W.store['history/returns_SP_0'].kind === 'returns' && W.store['history/returns_SP_0'].rows.length === 27, m1);
    ok('…with who and when (the trail)', W.store['history/returns_SP_0'].trail[0].by === 'asha@ridhihome.com' && W.store['history/returns_SP_0'].trail[0].rows === 27);
    lpn = 0;                                               // the same file again: the same order / SKU / licence plate / date → the same keys
    const again = fileSP([line('2026-11-21', 'TC-6090', 'B0AAAAAAA1', 1, 'DEFECTIVE', 'One more')]);
    const m2 = await W.rsUpload('SP', again, 'returns-nov-2.txt');
    ok('the same report again + 1 new row: 1 new, 27 replaced — 28 kept, not 55', /1 new, 27 already there/.test(m2) && W.RS.uploads.SP.rows.length === 28 && W.store['history/returns_SP_0'].rows.length === 28, m2);
    const W2 = world({ fams: FAMS });
    Object.assign(W2.store, JSON.parse(JSON.stringify(W.store)));
    await W2.rsLoad();
    ok('read back by someone else: the same 28 rows, its dates', W2.RS.uploads.SP.rows.length === 28 && W2.RS.uploads.SP.meta.from === '2026-09-08' && W2.RS.uploads.SP.meta.to === '2026-11-21', JSON.stringify(W2.RS.uploads.SP.meta));
  }

  console.log('== 3. the rate, spike vs normal, low volume, reasons, comments ==');
  const W = world({ fams: FAMS });
  await W.rsLoad();
  lpn = 0; await W.rsUpload('SP', fileSP(), 'f.txt');
  const r = W.rsFor('SP');
  const A = r.rows.find(x => x.key === 'SP|PA'), B = r.rows.find(x => x.key === 'SP|PB'), C = r.rows.find(x => x.key === 'SP|PC');
  ok('the judged week: 15–21 Nov (the last week the returns data covers whole)', A.week === '2026-11-15' && W.rsWeek('2026-11-15') === '15–21 Nov');
  ok('rate = returned ÷ sold a week (the average of the week and the one before): 11 ÷ 100 = 11 %', A.q === 11 && A.sold === 100 && Math.abs(A.now - 0.11) < 1e-9, `${A.q} / ${A.sold}`);
  ok('baseline = the 8 weeks before, pooled: 24 ÷ 800 = 3 %', Math.abs(A.base - 0.03) < 1e-9 && A.baseWeeks === 8, A.base + ' / ' + A.baseWeeks);
  ok('Tablecloth: 3 % → 11 % (≥ 2×, +8 points, 11 units) → a spike, 🔴 Critical (≥ 3×)', A.spike && A.sev === 'critical');
  ok('…"Returns 3% → 11% in 15–21 Nov (11 units) · top reason: Not as described (6)"', A.head === 'Returns 3% → 11% in 15–21 Nov (11 units) · top reason: Not as described (6)', A.head);
  ok('reasons breakdown: Not as described 6 · Defective 3 · No longer wanted 2', A.reasons.map(x => x.t + ' ' + x.n).join(' · ') === 'Not as described 6 · Defective 3 · No longer wanted 2', JSON.stringify(A.reasons));
  ok('the latest comments, newest first (up to 5)', A.comments.length === 3 && A.comments[0].t === 'Seam came apart' && A.comments[2].t === 'Colour is much darker than the photo', JSON.stringify(A.comments));
  ok('the sizes it hit: TC-6090 8, TC-60120 3', A.kids.map(k => k.sku + ' ' + k.q).join(' · ') === 'TC-6090 8 · TC-60120 3');
  ok('Napkins: 4 % → 5 % — normal, not a spike', B && !B.spike && Math.abs(B.now - 0.05) < 1e-9);
  ok('Apron: 0 % → 20 % but only 4 units — filtered as low volume', C && !C.spike && C.q === 4 && W.rsIsSpike({ q: 5, rate: 0.2 }, 0) === true);
  ok('Watch, not Critical: 5 % → 10.5 % (2.1×, +5.5 points, 7 units)', W.rsIsSpike({ q: 7, rate: 0.105 }, 0.05) && (() => { const x = W.rsCompute({ brand: 'SP', fams: [{ key: 'SP|W', brand: 'SP', parent: 'P', name: 'W', kids: [kid('B0W1', 'W1', 100)] }], data: { d: { SP: WEEKS.slice(1).flatMap(wk => (wk < '2026-11-15' ? [{ d: add(wk, 1), s: 'W1', a: 'B0W1', q: 5, r: 'DEFECTIVE' }] : [{ d: add(wk, 1), s: 'W1', a: 'B0W1', q: 11, r: 'DEFECTIVE' }])) }, cover: { SP: { from: '2026-09-06', to: '2026-11-21' } } } }); return x.items[0] && x.items[0].sev === 'watch'; })());
  ok('only spikes are listed, the worst first', r.items.map(x => x.key).join() === 'SP|PA');

  console.log('== 4. on Sales Alerts: the chip, the section, the details, the no-data note ==');
  {
    W.AL.filter = '';
    ok('the bar: "↩ Returns data"', /data-rs-act="panel"[^>]*>↩ Returns data</.test(W.alBarHtml()));
    ok('the chip: "↩ Return spikes 1"', /data-al-filter="returns"[^>]*><span aria-hidden="true">↩<\/span> Return spikes <b>1<\/b>/.test(W.rsChipHtml('SP')));
    const sec = W.rsSectionHtml('SP');
    ok('the section: a card and a row, the same look as the drops; "returns data up to 21 Nov"', /<article class="al-card is-critical rs-card"/.test(sec) && /<details class="al-row is-critical rs-row"/.test(sec) && /Ridhi returns data up to 21 Nov \(uploaded by Asha\)/.test(sec), sec.slice(0, 300));
    const det = W.rsDetailHtml(A);
    ok('the details: the weekly rate chart, reasons as bars, comments, SKUs, "+ Task" and "Open listing"', /<svg class="rs-chart"/.test(det) && /<ul class="rs-rs">/.test(det) && /<ul class="rs-com">/.test(det) && /<table class="rs-kids">/.test(det)
      && /data-tk-new=/.test(det) && /&quot;kind&quot;:&quot;returns&quot;/.test(det) && /data-rs-open="SP\|\|B0PARENTAA">Open listing/.test(det));
    const E = world({ fams: FAMS }); await E.rsLoad();
    ok('no returns data: the note, never a number', /No Ridhi returns uploaded yet — choose the Ridhi Customer Returns file above to see Ridhi return spikes\./.test(E.rsSectionHtml('SP')) && /Return spikes <b>0<\/b>/.test(E.rsChipHtml('SP')));
    ok('Sales Alerts draws the section after "Fix these first"; the chip shows it alone', /rsSectionHtml\(AL\.brand, AL\.filter === 'returns'\)/.test(SRC('app/sales/sales-alerts.js')) && /\(AL\.filter === 'returns' \? rs : rs \+ alListHtml\(r\)/.test(SRC('app/sales/sales-alerts.js')));
  }

  console.log('== 5. Ridhi / CPC, the nightly cache first, the test site ==');
  {
    const cpcFile = [HEAD].concat(WEEKS.slice(1).map(wk => line(add(wk, 1), 'WCI-1818', 'B0WWWWWWW1', wk < '2026-11-15' ? 2 : 12, 'NOT_AS_DESCRIBED')), [line('2026-11-21', 'ZZ-CPC', 'B0ZZZZZZZ2', 1, 'DEFECTIVE')]).join('\n');
    await W.rsUpload('CPC', cpcFile, 'cpc.txt');
    ok('a CPC upload is CPC\'s own: Ridhi\'s spikes unchanged, CPC\'s family judged', W.rsFor('SP').items.length === 1 && W.rsFor('CPC').items.map(x => x.key).join() === 'CPC|PW' && W.store['history/returns_CPC_0'].brand === 'CPC');
    ok('All: both brands', W.rsFor('ALL').items.length === 2);
    const C2 = world({ fams: FAMS, cache: { at: '2026-11-25 06:10', from: '2026-08-27', to: '2026-11-21', d: { SP: [['2026-11-17', 'NP-RED', 'B0BBBBBBB1', 1, 'DEFECTIVE', '', '', 'o', 'l']] } } });
    await C2.rsLoad();
    ok('the nightly cache, when there, is used (not the uploads)', C2.RS.cache && C2.rsData().src === 'backend' && C2.rsData().d.SP.length === 1 && /returns data up to 21 Nov \(nightly\)/.test(C2.rsSectionHtml('SP')));
    const T = world({ fams: FAMS, test: true });
    await T.rsLoad();
    lpn = 0;
    const m = await T.rsUpload('SP', fileSP(), 'f.txt');
    ok('the test site: read and shown, never written', T.writes.length === 0 && T.RS.uploads.SP.rows.length === 27 && /test site: kept in this visit only/.test(m) && T.rsFor('SP').items.length === 1);
  }

  console.log('== 6. the Action Tracker\'s return task, returnsCheck, the rule book, the backend ==');
  {
    const t = { status: 'done', doneAt: Date.parse('2026-11-10T00:00:00Z'), at: Date.parse('2026-11-05T00:00:00Z'), kind2: 'returns', src: 'alert', win: 14 };
    ok('a return-spike task: ✅ once the family is no longer a return spike', W.tkVerdict(t, { returnOn: false }).v === 'worked');
    ok('…still one at the end of its window → ❌; before → it waits; no returns read → "Not enough data yet"', W.tkVerdict(t, { returnOn: true, now: Date.parse('2026-11-25T00:00:00Z') }).v === 'didnt'
      && W.tkVerdict(t, { returnOn: true, now: Date.parse('2026-11-15T00:00:00Z') }).stage === 'wait' && /^Not enough data yet/.test(W.tkVerdict(t, { returnOn: null }).line));
    const c = await W.returnsCheck('tablecloth', 'SP');
    ok('returnsCheck(\'tablecloth\'): the weeks, the rate, the baseline, the rule', c.length === 1 && c[0].rateNow === '11%' && c[0].baseline === '3%' && c[0].spike && c[0].weeks.length >= 9 && /2× baseline/.test(c[0].rule));
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sales-metrics.md'), 'utf8');
    ok('docs/sales-metrics.md and the Numbers Check list: Return rate, Return spike', /### Return rate\n/.test(doc) && /### Return spike\n/.test(doc) && /name: 'Return spike'/.test(SRC('app/sales/sales-check.js')));
    const gs = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'Returns.gs'), 'utf8');
    ok('the backend for later: Returns.gs asks GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA and writes the cache "returns" (not deployed)', /GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA/.test(gs) && /cacheWrite_\('returns'/.test(gs) && /NOT DEPLOYED/.test(gs));
    ok('writes only history/returns_* (no sales, listing or stock document); no Amazon call from the page', !/setDoc\(doc\(db, '(stock|health|age|perms|reimbData)'/.test(SRC('app/sales/returns.js')) && !/spCall|adsPost/.test(SRC('app/sales/returns.js')) && /ORDER/.test('ORDER') && /sales\/tasks\.js\r?\nsales\/returns\.js/.test(SRC('app/ORDER')));
  }

  console.log('== 7. (28 Nov 2026) at once: the upload card and the heading — the spikes fill in after; the Week dropdown ==');
  {
    const tick = async n => { for (let i = 0; i < (n || 30); i++) await new Promise(r => setImmediate(r)); };
    // the sales are still being read (the Forecast's loader not done: foFor null)
    const S = world({ fams: FAMS });
    S.ctx.foFor = () => null;
    const first = S.rsSectionHtml('SP');
    ok('before anything is read: the upload card (Ridhi / CPC, "Choose the file…", its line) and the heading with "Checking returns…"', S.RS.open === true && /id="rsUp"/.test(first) && /data-rs-brand="SP"/.test(first) && /data-rs-brand="CPC"/.test(first)
      && /Choose the file…<input type="file"/.test(first) && /Ridhi: reading…/.test(first) && /<h3>↩ Return spikes<\/h3>/.test(first) && /Checking returns…/.test(first), first.slice(0, 600));
    const root = { innerHTML: '' };
    S.ctx.document.getElementById = id => (id === 'alPane' ? root : null);
    S.alRender();
    ok('Sales Alerts while its sales are read: the bar, "Reading…" — and the returns box with the card and the heading, at once', /<div id="rsBox">/.test(root.innerHTML) && /id="rsUp"/.test(root.innerHTML) && /↩ Return spikes/.test(root.innerHTML) && /data-al-brand="SP"/.test(root.innerHTML), root.innerHTML.slice(0, 400));
    await S.rsLoad();
    lpn = 0; await S.rsUpload('SP', fileSP(), 'f.txt');
    const mid = S.rsSectionHtml('SP');
    ok('the returns read, the sales not yet: "uploaded by Asha", the Week dropdown — the spikes still a skeleton, nothing worked out', /uploaded by Asha/.test(mid) && /data-rs-week/.test(mid) && /Checking returns…/.test(mid) && !/rs-row/.test(mid) && !S.RS.warm && /Return spikes <b>…<\/b>/.test(S.rsChipHtml('SP')), mid.slice(0, 900));
    // the sales arrive
    S.ctx.FO = { v: 2, data: {} }; S.ctx.VI = { data: {} }; S.ctx.foFor = b => ({ ok: true, fams: FAMS.filter(f => f.brand === b) });
    S.ctx.setTimeout = fn => { Promise.resolve().then(fn); return 0; };
    const sk = S.rsSectionHtml('SP');
    ok('the sales read: this moment still the skeleton — the spikes are worked out in idle time …', /Checking returns…/.test(sk) && !!S.RS.warm);
    await tick();
    const full = S.rsSectionHtml('SP');
    ok('… then filled in: the Tablecloth spike, the chip "1"', !S.RS.warm && /data-rs-row="rs\|SP\|PA\|2026-11-15"/.test(full) && /Return spikes <b>1<\/b>/.test(S.rsChipHtml('SP')), full.slice(0, 300));
    const famsSP = FAMS.filter(f => f.brand === 'SP');
    const j = S.rsJob({ fams: famsSP, data: S.rsData(), brand: 'SP', week: '' });
    let n = 0; while (!j.step(0)) n++;
    ok('worked out in small pieces = all at once, to the number', n > 2 && JSON.stringify(j.out) === JSON.stringify(S.rsCompute({ fams: famsSP, data: S.rsData(), brand: 'SP' })), n);
    // the latest week, exactly as before this change (dc67ba4e)
    let old = null;
    try { old = require('child_process').execSync('git show dc67ba4e:Pricing-App/src/app/sales/returns.js', { cwd: path.join(__dirname, '..', '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); } catch (e) { old = null; }
    if (!old) ok('(the returns file before this change is not in this checkout — skipped)', true);
    else {
      const O = world({ fams: FAMS, files: { 'app/sales/returns.js': old } });
      await O.rsLoad(); lpn = 0; await O.rsUpload('SP', fileSP(), 'f.txt'); await O.rsUpload('CPC', [HEAD, line('2026-11-17', 'WCI-1818', 'B0WWWWWWW1', 2, 'DEFECTIVE')].join('\n'), 'c.txt');
      await S.rsUpload('CPC', [HEAD, line('2026-11-17', 'WCI-1818', 'B0WWWWWWW1', 2, 'DEFECTIVE')].join('\n'), 'c.txt');
      const strip = r => JSON.stringify(r, (k, v) => (['after', 'picked', 'salesTo'].includes(k) ? undefined : v));
      ok('the latest week (the default): every family, rate, baseline, spike, reason and comment the same as before this change', ['SP', 'CPC', 'ALL'].every(b => strip(S.rsFor(b)) === strip(O.rsFor(b))));
    }
  }
  {
    const D = world({ fams: FAMS });
    await D.rsLoad();
    lpn = 0;
    // an older spike: Napkins 18–24 Oct, 12 more units (not as described) — 4 % → 16 %
    await D.rsUpload('SP', fileSP([line('2026-10-20', 'NP-RED', 'B0BBBBBBB1', 12, 'NOT_AS_DESCRIBED', 'Faded after one wash')]), 'f.txt');
    ok('the Week choices: every complete week with at least 4 complete weeks before it, newest first — 13 Sep – 4 Oct are not offered', D.rsWeeks('SP').join() === '2026-11-15,2026-11-08,2026-11-01,2026-10-25,2026-10-18,2026-10-11', D.rsWeeks('SP').join());
    const latest = D.rsFor('SP');
    const pick0 = D.rsSectionHtml('SP');
    ok('default = the latest complete week: "15–21 Nov (latest)" selected, no "Back to latest week"; the Tablecloth judged in 15–21 Nov', /<option value="" selected>15–21 Nov \(latest\)<\/option>/.test(pick0) && !/Back to latest week/.test(pick0)
      && latest.rows.every(x => x.week === '2026-11-15') && latest.items.map(x => x.key).join() === 'SP|PA', pick0.match(/<select[\s\S]*?<\/select>/));
    const o = D.rsFor('SP', '2026-10-18');
    const nb = o.items.find(x => x.key === 'SP|PB'), tc = o.rows.find(x => x.key === 'SP|PA');
    ok('an older week (18–24 Oct) judged with ITS OWN baseline — the weeks before it only: Napkins 4 % → 16 %, 🔴 Critical', nb && nb.week === '2026-10-18' && nb.series.every(w => w.wk <= '2026-10-18') && nb.baseWeeks === 5 && Math.abs(nb.base - 0.04) < 1e-9 && Math.abs(nb.now - 0.16) < 1e-9 && nb.sev === 'critical'
      && nb.head === 'Returns 4% → 16% in 18–24 Oct (16 units) · top reason: Not as described (12)' && tc && !tc.spike && tc.week === '2026-10-18', nb && JSON.stringify([nb.head, nb.base, nb.baseWeeks]));
    ok('…the same rules: in 15–21 Nov the Napkins are no spike (5 %), and that week\'s normal now holds the 18–24 Oct week', !latest.items.some(x => x.key === 'SP|PB') && latest.rows.find(x => x.key === 'SP|PB').base > 0.04);
    ok('…its comments are those of that time (up to 24 Oct)', nb.comments[0].t === 'Faded after one wash' && nb.comments.every(c => c.d <= '2026-10-24'));
    D.RS.week = '2026-10-18';
    D.ctx.FO.data = {}; D.ctx.VI = { data: {} };
    const sec = D.rsSectionHtml('SP');
    ok('picked: the dropdown shows it, "Back to latest week", the card and the row of THAT week (rs|SP|PB|2026-10-18)', /<option value="2026-10-18" selected>18–24 Oct<\/option>/.test(sec) && /data-rs-act="latest">Back to latest week/.test(sec)
      && /data-rs-card="rs\|SP\|PB\|2026-10-18"/.test(sec) && /data-rs-row="rs\|SP\|PB\|2026-10-18"/.test(sec) && !/rs\|SP\|PA\|/.test(sec), sec.slice(0, 200));
    ok('…the chip follows: "↩ Return spikes 1 · 18–24 Oct"', /Return spikes <b>1<\/b><small class="rs-chip-wk"> · 18–24 Oct<\/small>/.test(D.rsChipHtml('SP')), D.rsChipHtml('SP'));
    const det = D.rsDetailHtml(nb);
    ok('…the drawer: reasons and sizes of 18–24 Oct; its chart marks 18–24 Oct (with the 4 weeks after it drawn)', /Reasons, 18–24 Oct/.test(det) && /Sizes \/ SKUs returned, 18–24 Oct/.test(det) && /class="rs-cj"/.test(det) && /class="rs-cx rs-cjt">18–24 Oct</.test(det) && nb.after.length === 4 && /\(the week judged\)/.test(det));
    ok('the Action Tracker still asks about the latest week, whatever is picked', D.rsSpikeOn('SP', 'SP|PB') === false && D.rsSpikeOn('SP', 'SP|PA') === true);
    D.RS.week = '';
    ok('"Back to latest week": the latest again (chip 1, no week shown)', /Return spikes <b>1<\/b><\/button>/.test(D.rsChipHtml('SP')) && !/Back to latest week/.test(D.rsSectionHtml('SP')));
    D.RS.week = '2026-10-04';
    ok('a week that is not a choice (fewer than 4 weeks before it) is never judged: the latest is shown', /Return spikes <b>1<\/b><\/button>/.test(D.rsChipHtml('SP')) && /<option value="" selected>/.test(D.rsSectionHtml('SP')));
    D.RS.week = '';
    const sa = SRC('app/sales/sales-alerts.js');
    ok('the sales drops are not touched by the dropdown: Sales Alerts\' maths never reads RS.week', !/RS\.week/.test(sa) && !/rsWeek/.test(sa));
  }

  console.log('== 8. (28 Nov 2026) the card\'s [Ridhi | CPC] switch decides the whole returns section ==');
  {
    const B = world({ fams: FAMS });
    await B.rsLoad();
    lpn = 0; await B.rsUpload('SP', fileSP(), 'f.txt');
    B.rsFor('SP');
    B.AL.brand = 'CPC';                                     // the Sales Alerts view: CPC — the switch still says Ridhi
    const sp = B.rsSectionHtml(B.AL.brand);
    ok('Ridhi picked: Ridhi\'s upload line and Ridhi\'s spikes (the Tablecloth), the chip "1" — whatever the Sales Alerts brand', B.RS.upBrand === 'SP' && /Ridhi: 27 returns/.test(sp) && !/CPC: /.test(sp)
      && /data-rs-row="rs\|SP\|PA\|2026-11-15"/.test(sp) && /Ridhi returns data up to 21 Nov/.test(sp) && /Return spikes <b>1<\/b>/.test(B.rsChipHtml(B.AL.brand)), sp.slice(0, 900));
    B.RS.upBrand = 'CPC';
    const none = B.rsSectionHtml(B.AL.brand);
    ok('CPC picked, no CPC file: one clear message — no spike card or row, no Ridhi data, no Week dropdown; the chip "0"', none.includes('No CPC returns uploaded yet — choose the CPC Customer Returns file above to see CPC return spikes.')
      && /CPC: nothing uploaded/.test(none) && !/Ridhi: /.test(none) && !/rs-row|rs-card|data-rs-week|Ridhi returns data|B0PARENTAA|Tablecloth/.test(none) && /Return spikes <b>0<\/b><\/button>/.test(B.rsChipHtml('SP')), none);
    B.RS.open = false;
    ok('…the card folded away: the same message with an "Upload" button that opens it', /No CPC returns uploaded yet/.test(B.rsSectionHtml('SP')) && /data-rs-act="panel">Upload</.test(B.rsSectionHtml('SP')));
    B.RS.open = true;
    // (a row on 21 Nov: the data covers the week 15–21 Nov whole)
    const cpcFile = [HEAD].concat(WEEKS.slice(1).map(wk => line(add(wk, 1), 'WCI-1818', 'B0WWWWWWW1', wk < '2026-11-15' ? 2 : 12, 'NOT_AS_DESCRIBED')), [line('2026-11-21', 'ZZ-CPC', 'B0ZZZZZZZ2', 1, 'DEFECTIVE')]).join('\n');
    await B.rsUpload('CPC', cpcFile, 'cpc.txt');
    B.rsFor('CPC');
    const cpc = B.rsSectionHtml('SP');
    ok('CPC picked, with a CPC file: CPC\'s upload line and CPC\'s spike (the Pillow Insert) — never Ridhi\'s', /CPC: \d+ returns/.test(cpc) && !/Ridhi: /.test(cpc) && /data-rs-row="rs\|CPC\|PW\|2026-11-15"/.test(cpc)
      && !/rs\|SP\|/.test(cpc) && /CPC returns data up to 21 Nov/.test(cpc) && !/Ridhi returns data/.test(cpc), cpc.slice(0, 900));
    ok('…the chip follows it ("↩ Return spikes 1" = CPC\'s), and the Week choices are CPC\'s', /Return spikes <b>1<\/b>/.test(B.rsChipHtml('SP')) && /data-rs-week/.test(cpc) && B.rsWeeks('CPC').length > 0);
    B.RS.week = '2026-10-18';
    B.rsFor('CPC', '2026-10-18');
    const cw = B.rsSectionHtml('SP');
    ok('…a week picked: CPC\'s spikes of that week (none — its normal 2 a week), the chip "0 · 18–24 Oct"', /<option value="2026-10-18" selected>18–24 Oct<\/option>/.test(cw) && /No return spikes in 18–24 Oct/.test(cw) && /Return spikes <b>0<\/b><small class="rs-chip-wk"> · 18–24 Oct/.test(B.rsChipHtml('SP')));
    B.RS.week = ''; B.RS.upBrand = 'SP';
    B.rsFor('SP');                                         // (the CPC upload changed the data: on the page this is worked out in idle time)
    ok('back to Ridhi: Ridhi\'s spikes again', /data-rs-row="rs\|SP\|PA\|2026-11-15"/.test(B.rsSectionHtml('CPC')) && !/rs\|CPC\|/.test(B.rsSectionHtml('CPC')));
    const sa = SRC('app/sales/sales-alerts.js');
    ok('the sales drops are not touched by the switch: Sales Alerts\' maths and its brand never read it (RS.upBrand / rsBrand)', !/RS\.upBrand|rsBrand/.test(sa) && B.AL.brand === 'CPC');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
