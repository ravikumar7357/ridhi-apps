/* B / F (src/app/listing/listing-bf.js): Backend (Seller Central) and Frontend (what shoppers see) under each problem row of the
 * Workspace parent panel, on each child of "Show all" and beside each error in the child side panel — over the real Listing Rules,
 * Workspace, child component and Fix all, in a stub page.
 *   node tests/bf-test.js
 * The four combinations · the row's line · the layout before B / F is unchanged (only the line and the dots are added: compared with
 * the code of commit 43dec5b) · the counts are unchanged · the 10-minute re-check reads only the B🟢 F🔴 children, two at a time, and
 * a child Amazon now shows leaves its row by itself · after 3 days: no more re-checks, "open a case with Amazon" · the one data door. */
const cp = require('child_process');
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const DAY = 86400000;
const COLORS = ['Blue', 'Red', 'Green', 'Grey', 'Navy', 'Mustard', 'Rust', 'Teal', 'Sage', 'Pink'];
const SIZES = ['18x18', '20x20', '22x22', '16x16'];
const sizeText = s => s.replace('x', ' x ') + ' Inch';
const GOOD = (size, color) => `Ridhi Cloth Napkins 100% Cotton ${sizeText(size)} Block Print - ${color}`;
const LONG = (size, color) => `Ridhi Cloth Napkins 100% Cotton ${sizeText(size)} Block Print Reusable Dinner Napkins for Kitchen Party Wedding - ${color}`;
const BEFORE = '43dec5b';                 // the last commit before B / F: the layout it drew is the layout to keep
const git = file => { try { return cp.execSync(`git show ${BEFORE}:Pricing-App/src/app/listing/${file}`, { cwd: __dirname, maxBuffer: 1e8 }).toString('utf8'); } catch (e) { return null; } };

/* One parent PB of 20 napkins. L0–L9 have a title over 75 letters on the shop page (the catalogue title):
 *   L0–L3, L6, L8, L9: our submitted title is long too          → B🔴 F🔴 Our team (7)
 *   L4, L5:            our submitted title is short (fixed)      → B🟢 F🔴 Amazon's side (2)
 *   L7:                our content never read                    → B ○ → not read yet (1)
 * G10: Amazon reports an ERROR on our listing, but it is buyable  → B🔴 F🟢 (Seller Central wrong). The others are fine. */
function setup(opts) {
  opts = opts || {};
  const limg = { calls: [], now: 0, max: 0, title: {} };
  const saved = [];
  const got = [];
  const baCall = async q => {
    if (q.limg === 'get') {
      limg.calls.push(q.sku);
      limg.now++;
      limg.max = Math.max(limg.max, limg.now);
      await new Promise(r => setTimeout(r, 5));
      limg.now--;
      return { ok: true, title: limg.title[q.sku] || C.LI_WS.live.SP[q.sku].catTitle, catalog: { MAIN: { link: 'https://m.media-amazon.com/images/I/M' + q.sku + '.jpg', w: 1500, h: 1500 } } };
    }
    return {};
  };
  const C = load({ ws: true, sp: true, fa: true, baCall, files: opts.files,
    getDoc: async ref => { got.push(ref.path); return { exists: () => false }; },
    setDoc: async (ref, data) => { saved.push({ path: ref.path, data: JSON.parse(JSON.stringify(data)) }); } });
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.SP.today = new Date(2026, 6, 15);
  C.FA.log = [];
  ['SP', 'CPC'].forEach(b => { C.LI_WS.schema[b].NAPKIN = { at: Date.now(), ok: [], hl: { none: true } }; });
  const now = Date.now();
  const cat = {};
  for (let i = 0; i < 20; i++) {
    const sku = i < 10 ? 'L' + i : 'G' + i;
    const c = { color: COLORS[i % 10], size: SIZES[i % 4] };
    const shown = i < 10 ? LONG(c.size, c.color) : GOOD(c.size, c.color);
    const ours = i === 4 || i === 5 ? GOOD(c.size, c.color) : shown;
    C.HEALTH.SP.rows.push({ brand: 'SP', parent: 'PB', sku, asin: 'B0' + sku, title: shown, qty: 5, price: 12.5, status: 'Active', channel: 'AFN', aplus: true, aplusAt: now, checked: now,
      content: { titleLen: shown.length, images: 8, bullets: 5, descLen: 300, title: shown } });
    cat[sku] = Object.assign({ subcat: 'Napkin Set' }, c);
    const entry = { at: now, pt: 'NAPKIN', catTitle: shown, tAt: now };
    if (i !== 7) Object.assign(entry, { cAt: now, title: ours, titleLen: ours.length, kw: 'cotton', kwBytes: 6, bul: 5, desc: 300 });
    if (i === 10) Object.assign(entry, { gAt: now, st: ['BUYABLE', 'DISCOVERABLE'], iss: [{ s: 'E', c: '90220', m: 'The value for color is not valid', a: ['color'] }], slots: ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07'],
      specs: {} });
    C.LI_WS.live.SP[sku] = entry;
  }
  C.setCat('SP', cat);
  C.LI_WS.liveV++;
  C.reset();
  return { C, limg, saved, got };
}
const idle = async C => { for (let i = 0; i < 400 && (C.LI_WS.inflight || C.LI_WS.q.length || (C.BF && (C.BF.inflight || C.BF.q.length))); i++) await new Promise(r => setTimeout(r, 2)); await new Promise(r => setTimeout(r, 5)); };
const rowOf = (C, test) => C.faGroups('SP', 'PB', C.faKids('SP', 'PB')).find(test);
const kidOf = (C, sku) => C.faKids('SP', 'PB').find(kid => kid.sku === sku);
const hitOf = (kid, det) => kid.found.find(hit => hit.detector === det);

(async () => {
  console.log('== the four combinations ==');
  {
    ok('B🟢 F🟢 = fixed and showing · B🟢 F🔴 = Amazon\'s side · B🔴 F🔴 = our team · B🔴 F🟢 = Seller Central wrong; ○ = not read yet',
      [['g', 'g', 'done'], ['g', 'r', 'amazon'], ['r', 'r', 'team'], ['r', 'g', 'scwrong'], ['u', 'r', 'unread'], ['g', 'u', 'unread'], ['n', 'r', 'team'], ['r', 'n', 'team'], ['n', 'n', 'none']]
        .every(([b, f, who]) => load({ ws: true }).bfWho(b, f) === who));
    const { C } = setup();
    await idle(C);
    const ctx = C.hCtx();
    const bfOf = (sku, det) => { const kid = kidOf(C, sku); return C.bfOf(kid, hitOf(kid, det), ctx); };
    const t0 = bfOf('L0', 'title_length'), t4 = bfOf('L4', 'title_length'), t7 = bfOf('L7', 'title_length'), e10 = bfOf('G10', 'amazon_error');
    ok('L0: our title and the shop page\'s both too long → B🔴 F🔴 Our team', t0.b === 'r' && t0.f === 'r' && t0.who === 'team', JSON.stringify(t0));
    ok('L4: our title fixed, the shop page still shows the long one → B🟢 F🔴 Amazon\'s side', t4.b === 'g' && t4.f === 'r' && t4.who === 'amazon', JSON.stringify(t4));
    ok('G10: Amazon reports an ERROR on our listing, shoppers can buy it → B🔴 F🟢', e10.b === 'r' && e10.f === 'g' && e10.who === 'scwrong', JSON.stringify(e10));
    ok('L7: our content never read → B ○ "not read yet" (never a guess)', t7.b === 'u' && t7.who === 'unread', JSON.stringify(t7));
    const html = C.bfKidHtml(t7);
    ok('…drawn as a grey hollow dot with "not read yet"', /fa-bfd is-u/.test(html) && /not read yet/.test(strip(html)), html);
  }

  console.log('== suppressed / not buyable → F🔴 automatically; ○ only when not known ==');
  {
    const shop = (st, iss) => { const { C } = setup(); const e = C.LI_WS.live.SP.G10; e.st = st; if (iss) e.iss = iss; C.LI_WS.liveV++; C.reset();
      const kid = kidOf(C, 'G10'); return C.bfOf(kid, hitOf(kid, 'amazon_error'), C.hCtx()); };
    const e18320 = [{ s: 'E', c: '18320', m: 'Missing information: the listing is suppressed', a: [] }];
    const a = shop(['BUYABLE', 'DISCOVERABLE'], e18320), b = shop(['DISCOVERABLE']), c = shop(['BUYABLE']), d = shop(['BUYABLE', 'DISCOVERABLE']), u = shop([]);
    ok('ERROR 18320 while the status still says BUYABLE → F🔴 (B🔴 F🔴 Our team)', a.f === 'r' && a.who === 'team', JSON.stringify(a));
    ok('status not BUYABLE → F🔴', b.f === 'r', JSON.stringify(b));
    ok('BUYABLE but not DISCOVERABLE (not in search) → F🔴', c.f === 'r', JSON.stringify(c));
    ok('buyable and in search, an ordinary error → F🟢 (Our team — shoppers not affected yet)', d.f === 'g' && d.who === 'scwrong' && /Our team — shoppers not affected yet/.test(load({ ws: true }).bfKidHtml(d)), JSON.stringify(d));
    ok('no status known → grey ○', u.f === 'u', JSON.stringify(u));
  }

  console.log('== the row\'s line: the right split ==');
  {
    const { C } = setup();
    await idle(C);
    const title = rowOf(C, g => g.key === 'title');
    const err = rowOf(C, g => g.detector === 'amazon_error');
    const ht = C.bfLineHtml(title.kids, title.bf);
    ok('"Title too long": "B F Our team 7 · B F Amazon’s side 2 · not read yet 1" — in that order, nothing else', strip(ht) === 'B F Our team 7 · B F Amazon’s side 2 · not read yet 1'
      && /is-r[^]*is-r[^]*Our team[^]*is-g[^]*is-r[^]*Amazon/.test(ht), strip(ht));
    const he = C.bfLineHtml(err.kids, err.bf);
    ok('Amazon error row: "B🔴F🟢 Our team — shoppers not affected yet 1" (hover: Seller Central has a wrong value…)', strip(he) === 'B F Our team — shoppers not affected yet 1' && /is-r[^]*is-g/.test(he)
      && /Seller Central has a wrong value; the page looks fine, but Amazon can suppress it later/.test(he), he);
    C.el('hBrandView').value = 'SP';
    C.LI_WS.on = true; C.LI_WS.mode = 'all'; C.LI_WS.card = ''; C.LI_WS.chip = 'all';
    C.liWsRender();
    const block = C.faBlockHtml('SP', 'PB');
    const at = block.indexOf('<b>Title too long</b>');
    ok('the line sits under the row\'s text: title · what we will do · the B / F line · › Show all', at > 0 && block.indexOf('<small>', at) < block.indexOf('class="fa-bf"', at)
      && block.indexOf('class="fa-bf"', at) < block.indexOf('data-fa-act="more"', at), block.slice(at, at + 400));
    C.FA.open.add('SP|PB|title');
    const open = C.faBlockHtml('SP', 'PB');
    const kidLine = sku => (open.match(new RegExp(`<div class="fa-kid">(?:(?!<div class="fa-kid">).)*?<small>${sku}</small>.*?</button>`, 's')) || [''])[0];
    ok('"Show all": each child line gets "B ● F ● Our team" / "Amazon’s side"', /fa-bfk[^]*Our team/.test(kidLine('L0')) && /fa-bfk[^]*Amazon’s side/.test(kidLine('L4')), kidLine('L4'));
  }

  console.log('== the layout before B / F is unchanged: only the line and the dots are added ==');
  {
    const files = {};
    ['fix-all.js', 'listing-kid.js', 'listing-rules.js'].forEach(f => { files[f] = git(f); });
    files['listing-bf.js'] = 'const BF = null, bfOf = null, bfSpec = null, bfWho = null, bfCalc = null, bfLineHtml = null, bfKidHtml = null, bfDue = null, bfTick = null, bfPump = null, bfFirstLoad = null, bfSave = null, lsGet = null, lsSave = null;';   // the names the test loader hands back; the old code never calls them
    if (Object.values(files).some(t => t === null)) ok('commit ' + BEFORE + ' readable with git', false);
    else {
      const now = setup(), was = setup({ files });
      await idle(now.C); await idle(was.C);
      const draw = C => {
        C.el('hBrandView').value = 'SP';
        C.LI_WS.on = true; C.LI_WS.mode = 'all'; C.LI_WS.card = ''; C.LI_WS.chip = 'all';
        C.liWsRender();
        C.FA.open.add('SP|PB|title');
        C.FA.more.add('SP|PB|title');
        return C.faBlockHtml('SP', 'PB');
      };
      const cut = html => html.replace(/<div class="fa-bf">.*?<\/div>/g, '').replace(/<span class="fa-bfk[^"]*" title="[^"]*">.*?<\/span>(?=[^<]*<span class="fa-(was|new|why)"|<\/span><\/button>|<\/b>|[^<])/g, '')
        .replace(/<span class="fa-bfk[^"]*" title="[^"]*">B(?:<i[^>]*><\/i>|<span class="fa-bfn"[^>]*>–<\/span>) F(?:<i[^>]*><\/i>|<span class="fa-bfn"[^>]*>–<\/span>) [^<]*<\/span>/g, '');
      const a = draw(now.C), b = draw(was.C);
      ok('the Fix all block: the same HTML as before, once the B / F line and dots are taken out', cut(a) === b, (() => { let i = 0; const x = cut(a); while (i < x.length && x[i] === b[i]) i++; return x.slice(i - 80, i + 120) + ' ‖ ' + b.slice(i - 80, i + 120); })());
      ok('…and something was added (7 rows\' worth of dots, the lines)', a.length > b.length && (a.match(/class="fa-bf"/g) || []).length >= 2 && (a.match(/class="fa-bfk/g) || []).length >= 10);
      const kidA = now.C.lkHtml(kidOf(now.C, 'L4'), { close: 'data-x' }), kidB = was.C.lkHtml(kidOf(was.C, 'L4'), { close: 'data-x' });
      ok('the child side panel: the same HTML as before, once the dots beside each error are taken out', cut(kidA) === kidB && /fa-bfk[^]*Amazon’s side/.test(kidA));
      console.log('== the counts are unchanged ==');
      const cards = C => C.faCards(C.faKids('SP', 'PB'));
      const buckets = C => C.faKids('SP', 'PB').map(kid => kid.sku + ':' + kid.bucket + ':' + kid.found.map(h => h.id + h.sev).join(',')).join(' ');
      ok('Fix all cards (Listing Health\'s numbers) and every child\'s level: the same as before B / F', JSON.stringify(cards(now.C)) === JSON.stringify(cards(was.C)) && buckets(now.C) === buckets(was.C), JSON.stringify(cards(now.C)));
      const rowsN = C => C.faGroups('SP', 'PB', C.faKids('SP', 'PB')).map(g => g.key + '=' + g.kids.length).join(' ');
      ok('every problem row: the same children as before (none fixed-and-showing here)', rowsN(now.C) === rowsN(was.C), rowsN(now.C) + ' vs ' + rowsN(was.C));
    }
  }

  console.log('== the 10-minute re-check: only B🟢 F🔴, two at a time; Amazon shows it → the child leaves the row ==');
  {
    const { C, limg } = setup();
    await idle(C);
    const due = C.bfDue();
    ok('due: only the Amazon\'s-side children L4, L5 (one catalogue read each)', due.map(d => d.sku + ':' + d.t).sort().join(' ') === 'L4:limg L5:limg', due.map(d => d.sku + ':' + d.t).join(' '));
    // three more B🟢 F🔴 children, so the "two at a time" shows
    ['L0', 'L1', 'L2'].forEach(sku => { const e = C.LI_WS.live.SP[sku]; e.title = GOOD('18x18', 'Blue'); e.titleLen = e.title.length; });
    C.LI_WS.liveV++; C.reset();
    limg.title.L4 = GOOD('16x16', 'Mustard');          // Amazon now shows L4's fixed title
    C.bfTick();
    C.bfTick();                                        // a second tick before the first is done queues nothing twice
    await idle(C);
    ok('5 children read once each, never more than 2 calls at a time', limg.calls.slice().sort().join(' ') === 'L0 L1 L2 L4 L5' && limg.max === 2, limg.calls.join(' ') + ' max ' + limg.max);
    ok('nothing else read: our team\'s / not-read children are not re-checked', !limg.calls.some(sku => ['L3', 'L6', 'L7', 'L8', 'L9', 'G10'].includes(sku)));
    const title = rowOf(C, g => g.key === 'title');
    ok('L4 now shown fixed → it left "Title too long" by itself; L5 still waits on Amazon\'s side', !title.kids.some(kid => kid.sku === 'L4') && title.bf.get('SP|L5').who === 'amazon',
      title.kids.map(kid => kid.sku).join(' '));
  }

  console.log('== after 3 days: no more re-checks, "open a case with Amazon" ==');
  {
    const { C, limg } = setup();
    await idle(C);
    await C.bfFirstLoad('SP');                         // the saved dates are in (until then nothing is trusted or written)
    const kid = kidOf(C, 'L5');
    const hit = hitOf(kid, 'title_length');
    kid.found.forEach(h => { C.BF.first.SP['L5|' + h.detector + ':' + h.id] = { a: Date.now() - 4 * DAY, l: Date.now() }; });   // each of its problems (title too long, title not 60–75)
    const bf = C.bfOf(kid, hit, C.hCtx());
    ok('L5 B🟢 F🔴 first seen 4 days ago → over 3 days', bf.who === 'amazon' && bf.over);
    ok('…the re-check leaves it alone (only L4 is due)', C.bfDue().map(d => d.sku).join(' ') === 'L4');
    ok('…its child line says "Amazon still not showing after 3 days — open a case with Amazon"', /Amazon still not showing after 3 days — open a case with Amazon/.test(C.bfKidHtml(bf)));
    const title = rowOf(C, g => g.key === 'title');
    ok('…the row\'s line says "(1 over 3 days — open a case)"', /Amazon’s side 2 \(1 over 3 days — open a case\)/.test(strip(C.bfLineHtml(title.kids, title.bf))), strip(C.bfLineHtml(title.kids, title.bf)));
    C.bfTick();
    await idle(C);
    ok('a tick reads L4 only', limg.calls.join(' ') === 'L4', limg.calls.join(' '));
  }

  console.log('== the one data door: lsGet / lsSave ==');
  {
    const { C, saved, got } = setup();
    await idle(C);
    C.bfOf(kidOf(C, 'L4'), hitOf(kidOf(C, 'L4'), 'title_length'), C.hCtx());
    await new Promise(r => setTimeout(r, 5));
    ok('the first-seen dates are read once per brand through lsGet (history/bfwait_<brand>)', got.filter(p => /^history\/bfwait_/.test(p)).sort().join(' ') === 'history/bfwait_CPC history/bfwait_SP', got.join(' '));
    C.bfOf(kidOf(C, 'L4'), hitOf(kidOf(C, 'L4'), 'title_length'), C.hCtx());
    await C.bfSave();
    const w = saved.find(s => s.path === 'history/bfwait_SP');
    ok('…and written through lsSave: kind "bfwait", no "day" (Listing History never lists it), L4\'s first-seen date', w && w.data.kind === 'bfwait' && !('day' in w.data) && Object.keys(w.data.items).some(k => /^L4\|title_length/.test(k)), JSON.stringify(w));
    ok('no other database call in the new code (lsGet / lsSave are the only door)', !/getDoc|setDoc|getDocs|doc\(db/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app', 'listing', 'listing-bf.js'), 'utf8')
      .replace(/async function lsGet[^]*?\n}\r?\n/, '').replace(/async function lsSave[^]*?\n}\r?\n/, '').replace(/\/\*[^]*?\*\//g, '')));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
