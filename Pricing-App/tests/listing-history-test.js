/* Listing History (src/app/listing/listing-history.js, #10 stage 5) and the send log it reads (listing-send-check.js, lhistAdd), over the
 * real files in a stub page.
 *   node tests/listing-history-test.js
 * The log in /history, small documents (split by rows AND bytes); the page: one row per field, a Fix all as one group row that opens,
 * filters, "Results: N", 50 per page, fast with 10,000+ rows, the CSV download with the full before/after, Check again, Put back through
 * sqSendWithCheck (logged as its own row), the empty page, who sees the menu entry. */
const fs = require('fs'), path = require('path');
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const NOV = new Date(2026, 10, 13);
const TITLE = c => `Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print - ${c}`;

// A stub page: the real files; Firestore's /history kept in memory (setDoc merge writes into it, getDocs reads it).
function setup(opts) {
  opts = opts || {};
  const store = {};                       // "history/<id>" → data
  const posts = [];
  const amazon = {};
  const merge = (a, b) => { Object.keys(b).forEach(k => { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') merge(a[k], b[k]); else a[k] = b[k]; }); return a; };
  const post = b => { posts.push(b); if (b.apply) amazon[b.sku] = Object.assign(amazon[b.sku] || {}, Object.fromEntries((b.patches || []).map(p => [p.path.replace('/attributes/', ''), p.value]))); return b.apply ? { ok: true, submissionId: 's' } : { ok: true, previewOnly: true, issues: [] }; };
  const ctx = {
    getDocs: async () => ({ forEach: fn => Object.keys(store).filter(k => k.startsWith('history/') && store[k].day).sort().reverse().forEach(k => fn({ id: k.slice(8), data: () => JSON.parse(JSON.stringify(store[k])) })) }),
    query: (...a) => a, collection: (d, name) => ({ name }), orderBy: () => ({}), limit: () => ({}),
    ME: Object.assign({ email: 'vishesh.gyanchandani@example.com', admin: false, tabs: ['health'] }, opts.me || {}),
  };
  const C = load({ ws: true, sp: true, lh: true, window: opts.window, post, ctx,
    baCall: opts.baCall || (async q => (q.lfix === 'get' ? { productType: 'NAPKIN', attributes: amazon[q.sku] || {}, issues: [] } : {})),
    setDoc: async (ref, data, o) => { const k = ref.path; store[k] = o && o.merge && store[k] ? merge(store[k], JSON.parse(JSON.stringify(data))) : JSON.parse(JSON.stringify(data)); } });
  C.setHealthLoaded(true); C.LI_WS.stored = true; C.SP.log = []; C.SP.today = NOV;
  C.LI_WS.schema.SP.NAPKIN = { at: Date.now(), ok: [], hl: { items: 1, max: 125, bytes: 0 } };
  ['SP', 'CPC'].forEach(b => C.HEALTH[b].rows.splice(0));
  const cat = {};
  const now = Date.now();
  const put = (sku, parent, kw, hl) => {
    const title = TITLE('Blue');
    C.HEALTH.SP.rows.push({ brand: 'SP', parent, sku, asin: 'B0' + sku, title, qty: 5, price: 12, status: 'Active', channel: 'AFN', aplus: true, aplusAt: now, checked: now, content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } });
    cat[sku] = { color: 'Blue', size: '18x18', subcat: 'Napkin Set' };
    C.LI_WS.live.SP[sku] = { at: now, cAt: now, pt: 'NAPKIN', title, titleLen: title.length, catTitle: title, tAt: now, kw, kwBytes: C.lrKwBytes(kw), hl, hlAt: now };
  };
  const done = () => { C.setCat('SP', cat); C.LI_WS.liveV++; C.reset(); C.SP.itemsKey = ''; C.SP.on = true; };
  return { C, store, posts, put, done, amazon };
}
// one popup run, all the way: Amazon's check, approve, read again, close
const runAll = async (C, r) => { await C.SQ.run.checked; await C.sqApprove(); C.sqClose(); await r; };

(async () => {
  console.log('== the empty page ==');
  {
    const { C } = setup();
    await C.lhLoad(true);
    ok('no rows: "No changes yet — on live Sellora every send to Amazon appears here."', /No changes yet<\/b> — on live Sellora every send to Amazon appears here\./.test(C.el('lhList').innerHTML), C.el('lhList').innerHTML);
  }

  console.log('== a Fix all and a single fix, as the page shows them ==');
  const A = setup();
  {
    const { C, store, put, done } = A;
    for (let i = 0; i < 14; i++) put('X' + i, 'PX', 'cotton napkins summer', ['Soft cotton']);
    put('S1', 'PS', 'cotton', ['Thanksgiving and Christmas table decor']);
    done();
    await runAll(C, C.spFixSeasons(C.spGroupOf('SP|PX').todo.map(i => i.key), 'christmas'));
    await runAll(C, C.spApprove(['SP|S1']));
    const docs = Object.keys(store).filter(k => k.startsWith('history/listing_'));
    ok('the log is in /history (listing_<date>_<run>-<n>, kind "listing"); nothing in listingrules', docs.length === 2 && docs.every(k => store[k].kind === 'listing') && !Object.keys(store).some(k => /listingrules\/sendlog/.test(k)), docs.join());
    const rows = await C.lhLoad(true);
    ok('the page reads them: 14 × 2 fields + 1 = 29 rows, newest first', rows.length === 29 && rows.every((r, i) => !i || rows[i - 1].at >= r.at));
    C.LH.f.range = 'all';
    C.lhBuild(true);
    C.lhDraw();
    const list = C.el('lhList').innerHTML;
    const items = C.lhItems(C.lhFiltered(rows, C.LH.f));
    ok('the Fix all is ONE group line: "Fix all · Christmas · 14 children · ✅ 14 ❌ 0"; the single fix its own rows', items.length === 2 && items.filter(i => i.kind === 'group').length === 1
      && /Fix all · Christmas · 14 children · ✅ 14 ❌ 0/.test(strip(list)), strip(list).slice(0, 400));
    ok('"Results: 29"', /Results: 29/.test(C.el('lhCount').textContent), C.el('lhCount').textContent);
    const g = items.find(i => i.kind === 'group');
    C.lhClick({ dataset: { lh: 'group', lhV: g.key } });
    const opened = C.el('lhList').innerHTML;
    ok('the group opens to its 28 rows (one per field per child)', (opened.match(/class="lh-row is-child/g) || []).length === 28);
    const row = rows.find(r => r.sku === 'X0' && r.field === 'Hidden search words');
    const tr = (opened.match(new RegExp(`<tr class="lh-row is-child is-accepted" data-lh-row="${row.id.replace(/[|.]/g, '\\$&')}">[^]*?</tr>`)) || [''])[0];
    ok('a row: date and time · the name (never the e-mail) · the listing (name · SKU · ASIN · Open listing) · What changed · only the changed words + Show full text · From screen · Approved by · Result',
      /Vishesh Gyanchandani/.test(tr) && !/@/.test(opened) && /<b>Blue · 18 x 18 Inch<\/b><small>X0 · B0X0<\/small><a href="https:\/\/www\.amazon\.com\/dp\/B0X0"[^>]*>Open listing ↗/.test(tr)
      && /<td>Hidden search words<\/td>/.test(tr) && /<span class="sq-add">\+ christmas<\/span>/.test(tr) && /› Show full text/.test(tr) && /<td>Season planner · Fix all<\/td>/.test(tr) && /✅ Accepted/.test(tr), strip(tr));
    ok('What changed in words: Title, Item Highlights, Hidden search words, Pictures, Spec: <name>', C.lhWhat({ field: 'Title' }) === 'Title' && C.lhWhat({ field: 'Item Highlights' }) === 'Item Highlights'
      && C.lhWhat({ field: 'Main picture', pic: true }) === 'Pictures' && C.lhWhat({ field: 'material' }) === 'Spec: material' && C.lhWhat({ field: 'Search terms' }) === 'Hidden search words');
  }

  console.log('== filters, paging, speed with 10,000+ rows ==');
  {
    const { C, store } = setup();
    const now = Date.now();
    const users = ['Ravi K', 'Vansh T', 'Vishesh G'];
    const fields = ['Title', 'Item Highlights', 'Hidden search words', 'material', 'Main picture'];
    const screens = ['Season planner', 'Listing Errors', 'Image Manager', 'Listing Content upload'];
    const results = ['accepted', 'accepted', 'accepted', 'rejected', 'working'];
    let doc = 0;
    for (let i = 0; i < 12000; i++) {
      if (i % 200 === 0) doc++;
      const at = now - i * 60000;                                  // one a minute: 12 000 minutes ≈ 8 days back
      const id = `${at}-SP-K${i}-0`;
      const k = `history/listing_${new Date(at).toISOString().slice(0, 10)}_${doc}-1`;
      store[k] = store[k] || { kind: 'listing', day: new Date(at).toISOString().slice(0, 10), rows: {} };
      store[k].rows[id] = { id, kind: 'listing', at, by: 'x@y.com', name: users[i % 3], approvedBy: users[i % 3], brand: 'SP', sku: 'K' + i, asin: 'B0K' + i, label: 'Napkin ' + i, field: fields[i % 5], pic: fields[i % 5] === 'Main picture',
        old: 'cotton summer', new: 'cotton christmas', attr: 'generic_keyword', api: 'lfix', pt: 'NAPKIN', oldV: [{ value: 'cotton summer' }], screen: screens[i % 4], run: at, runN: 1, result: results[i % 5], why: results[i % 5] === 'rejected' ? 'Value too long — max 249' : '' };
    }
    const rows = await C.lhLoad(true);
    C.LH.f.range = 'all';
    let t0 = Date.now();
    C.lhDraw();
    const ms = Date.now() - t0;
    ok(`12,000 rows read; a page of 50 drawn in ${ms} ms`, rows.length === 12000 && (C.el('lhList').innerHTML.match(/class="lh-row /g) || []).length === 50 && ms < 1500, ms + ' ms');
    ok('"Results: 12,000" and "Page 1 of 240"', /Results: 12,000/.test(C.el('lhCount').textContent) && /Page 1 of 240/.test(C.el('lhList').innerHTML));
    C.lhClick({ dataset: { lh: 'page', lhV: '1' } });
    ok('Older ▶: page 2, the next 50 (older)', /Page 2 of 240/.test(C.el('lhList').innerHTML) && C.el('lhList').innerHTML.includes('K50<'));
    const f = Object.assign({}, C.LH.f);
    const n = o => C.lhFiltered(rows, Object.assign({}, f, o)).length;
    ok('Who: one person\'s changes only', n({ user: 'Vansh T' }) === 4000);
    ok('What changed: "Pictures" only', n({ what: 'Pictures' }) === 2400);
    ok('From screen: "Image Manager" only', n({ screen: 'Image Manager' }) === 3000);
    ok('Result: ❌ Rejected only / ⏳ Amazon working only', n({ result: 'rejected' }) === 2400 && n({ result: 'working' }) === 2400);
    ok('Search on SKU, ASIN or name', n({ q: 'K1234' }) === 1 && n({ q: 'b0k11999' }) === 1 && n({ q: 'Napkin 42' }) === 111);
    ok('When: today / this week / this month / from–to (one a minute back from now)', n({ range: 'today' }) > 0 && n({ range: 'today' }) <= 1440 && n({ range: 'week' }) >= n({ range: 'today' })
      && n({ range: 'custom', from: new Date(now).toISOString().slice(0, 10), to: new Date(now).toISOString().slice(0, 10) }) >= 1);
    t0 = Date.now();
    for (let i = 0; i < 20; i++) C.lhFiltered(rows, Object.assign({}, f, { q: 'K' + i }));
    ok(`filtering 12,000 rows is quick (${Math.round((Date.now() - t0) / 20)} ms a filter)`, (Date.now() - t0) / 20 < 100);
    const csv = C.lhCsv(C.lhFiltered(rows, Object.assign({}, f, { result: 'rejected' })));
    const lines = csv.trim().split('\r\n');
    ok('Download (CSV, opens in Excel): the filtered rows, full From and To, the reason', lines.length === 2401 && lines[0].replace('\uFEFF', '') === C.LH_CSV_COLS.join(',')
      && /cotton summer,cotton christmas/.test(lines[1]) && /Value too long — max 249/.test(lines[1]) && csv.charCodeAt(0) === 0xFEFF);
  }

  console.log('== ⏳ Check again; Put back through the Amazon check popup ==');
  {
    const { C, store, posts, amazon, put, done } = A;
    // one row Amazon had not finished: still the old value on Amazon
    const rows = C.LH.rows;
    const r = rows.find(x => x.sku === 'S1' && x.field === 'Hidden search words');
    r.result = 'working';
    const keep = amazon.S1.generic_keyword;
    amazon.S1.generic_keyword = [{ value: 'cotton' }];
    C.lhDraw();
    ok('a ⏳ row has [Check again]', new RegExp(`data-lh="again" data-lh-id="${r.id}"`).test(C.el('lhList').innerHTML));
    await C.lhCheckAgain(r.id);
    ok('Check again while Amazon is still working: still ⏳', r.result === 'working');
    amazon.S1.generic_keyword = keep;
    await C.lhCheckAgain(r.id);
    ok('Check again once Amazon has it: ✅ Accepted — and the row is updated in its own log document', r.result === 'accepted' && store['history/' + r.doc].rows[r.id].result === 'accepted');
    // Put back
    const before = posts.length;
    const pb = C.lhPutBack(r.id);
    ok('Put back goes through sqSendWithCheck: the Amazon check popup, nothing sent yet', C.SQ.screens.slice(-1)[0] === 'Listing History · Put back' && C.sqIsOpen());
    await C.SQ.run.checked;
    const check = posts.slice(before)[0];
    ok('…Amazon checks the OLD value (as Amazon held it) — apply false', check.apply === false && check.patches[0].path === '/attributes/generic_keyword' && check.patches[0].value[0].value === 'cotton');
    await C.sqApprove();
    C.sqClose();
    await pb;
    await new Promise(res => setTimeout(res, 20));
    const back = (C.LH.rows || []).find(x => x.screen === 'Listing History · Put back');
    ok('…approved and sent, then logged as its OWN row ("Listing History · Put back"), old and new the other way round', posts.slice(before).filter(p => p.apply).length === 1 && back && back.old === r.new && back.new === r.old && back.result === 'accepted',
      back && JSON.stringify([back.old, back.new, back.result]));
  }

  console.log('== the log splits before a document gets large ==');
  {
    const { C, store } = setup();
    const big = 'x '.repeat(900);                                  // 1,800 letters before and after: ~4 KB a row
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: `1-SP-B${i}-0`, kind: 'listing', at: Date.now(), sku: 'B' + i, field: 'Description', old: big, new: big + 'y' }));
    const run = { at: 777, jobs: [] };
    await C.lhistAdd(rows, run);
    const docs = Object.keys(store).filter(k => k.startsWith('history/listing_'));
    const sizes = docs.map(k => JSON.stringify(store[k]).length);
    ok(`300 rows of ~4 KB → ${docs.length} documents, each under 0.45 MB (Firestore's limit is 1 MB)`, docs.length >= 3 && sizes.every(s => s < 450000) && docs.reduce((n, k) => n + Object.keys(store[k].rows).length, 0) === 300, sizes.join());
  }

  console.log('== who sees the menu entry ==');
  {
    const nav = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'core', 'nav.js'), 'utf8');
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    ok('nav.js: one tab "lhist", "Listing History", given with Listing Health (TAB_INHERIT)', /'basket', 'lhist'\]/.test(nav) && /lhist: 'Listing History'/.test(nav) && /lhist: 'health'/.test(nav));
    ok('index.html: the menu entry LAST in the Listing menu (after BSR Audit), and its page', /data-tabs="opt,img,lerr,basket,health,lrules,audit,bsr,lhist"/.test(html)
      && /<button id="tabBsr" class="nav">BSR Audit<\/button>\r\n\s*<button id="tabLhist" class="nav">Listing History<\/button>\r\n\s*<\/div><\/div>/.test(html) && /<div id="paneLhist" class="hide"><div id="lhPane"><\/div><\/div>/.test(html));
    const cases = [[['img'], true], [['lerr'], true], [['lrules'], true], [['health'], true], [['weekly', 'trends'], false], [['sales'], false]];
    const res = cases.map(([tabs, want]) => {
      const { C } = setup({ me: { tabs } });
      const btn = C.el('tabLhist');
      btn.classList = { _h: true, contains() { return this._h; }, remove() { this._h = false; }, add() { this._h = true; }, toggle() {} };
      return C.lhMenuAccess() === want && btn.classList._h === !want;
    });
    ok('the entry shows for Image Manager, Listing Errors, Listing Rules and Listing Health users; not for PPC- or Sales-only users', res.every(Boolean), JSON.stringify(res));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
