/* The Sellora sync (src/app/listing/listing-sync.js): one leader among the open browsers, a takeover after it closes, the order the
 * listings are read in, every read reaching the other browsers (Listing Health = Workspace numbers there too), the status line and
 * "What changed", the send popup / hidden tab / test site — over the real Listing Rules, Workspace, saved copy and B / F, with two or
 * three browsers sharing ONE stub database.
 *   node tests/sync-test.js */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const MIN = 60000;
const COLORS = ['Blue', 'Red', 'Green', 'Grey', 'Navy', 'Mustard', 'Rust', 'Teal', 'Sage', 'Pink'];
const SIZES = ['18x18', '20x20', '22x22', '16x16'];
const sizeText = s => s.replace('x', ' x ') + ' Inch';
const GOOD = (size, color) => `Ridhi Cloth Napkins 100% Cotton ${sizeText(size)} Block Print - ${color}`;
const LONG = (size, color) => `Ridhi Cloth Napkins 100% Cotton ${sizeText(size)} Block Print Reusable Dinner Napkins for Kitchen Party Wedding - ${color}`;
const SLOTS = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07'];

// ONE database for every browser: setDoc with merge merges maps (as Firestore does), arrays and values are replaced.
function makeDb() {
  const store = {};
  const clone = v => JSON.parse(JSON.stringify(v));
  const merge = (a, b) => { Object.keys(b).forEach(k => { a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], b[k]) : b[k]; }); return a; };
  const writes = [];
  return {
    store, writes,
    getDoc: async ref => { await null; const v = store[ref.path]; return { exists: () => v != null, data: () => clone(v) }; },
    setDoc: async (ref, data, opts) => { await null; writes.push(ref.path); store[ref.path] = opts && opts.merge && store[ref.path] ? merge(store[ref.path], clone(data)) : clone(data); },
  };
}
const NINE = new Date(2026, 10, 14, 9, 0).getTime();
let T = NINE;                                        // the shared clock: 14 Nov 2026, from 9 AM

/* One browser on Sellora. Parent PB of 20 napkins (as bf-test): L0–L9 show a title over 75 letters; L4 / L5 have ours fixed (B🟢 F🔴);
 * G10 has an Amazon ERROR on a buyable listing. Reads age: Gxx read 1 h ago … older by SKU number. `amazon`: what the next reads say. */
function browser(db, amazon, opts) {
  opts = opts || {};
  const calls = { n: 0, max: 0, now: 0, list: [] };
  let C;
  const reply = async q => {
    calls.n++; calls.now++; calls.max = Math.max(calls.max, calls.now); calls.list.push((q.limg ? 'limg' : q.lfix) + ':' + (q.sku || q.skus));
    await new Promise(r => setTimeout(r, 2));
    calls.now--;
    const live = sku => C.LI_WS.live.SP[sku] || {};
    const shown = sku => (amazon.title && amazon.title[sku]) || live(sku).catTitle || (C.HEALTH.SP.rows.find(r => r.sku === sku) || {}).title || '';
    if (q.lfix === 'content') {
      const items = {};
      q.skus.split(',').forEach(sku => { const t = live(sku).title || shown(sku); items[sku] = { productType: 'NAPKIN', item_name: [{ value: t }], bullet_point: [1, 2, 3, 4, 5].map(n => ({ value: 'b' + n })), product_description: [{ value: 'd'.repeat(300) }], generic_keyword: [{ value: 'cotton' }] }; });
      return { items };
    }
    if (q.lfix === 'get') {
      const a = (amazon.get && amazon.get[q.sku]) || {};
      return { productType: 'NAPKIN', status: a.status || ['BUYABLE', 'DISCOVERABLE'], issues: a.issues || [], title: shown(q.sku),
        attributes: Object.fromEntries(SLOTS.map(s => [s === 'MAIN' ? 'main_product_image_locator' : 'other_product_image_locator_' + s.slice(3), [{ media_location: 'x' }]])) };
    }
    if (q.limg === 'get') return { ok: true, title: shown(q.sku), catalog: Object.fromEntries(SLOTS.map(s => [s, { link: `https://m.media-amazon.com/images/I/${q.sku}${s}.jpg`, w: 1500, h: 1500 }])) };
    return {};
  };
  C = load({ ws: true, sp: true, baCall: reply, getDoc: db.getDoc, setDoc: db.setDoc, window: opts.window });
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.LY.confirmMs = 0;
  C.LY.now = () => T;
  ['SP', 'CPC'].forEach(b => { C.LI_WS.schema[b].NAPKIN = { at: T, ok: [], hl: { none: true } }; });
  const cat = {};
  for (let i = 0; i < 20; i++) {
    const sku = i < 10 ? 'L' + i : 'G' + i;
    const c = { color: COLORS[i % 10], size: SIZES[i % 4] };
    const shown = i < 10 ? LONG(c.size, c.color) : GOOD(c.size, c.color);
    const ours = i === 4 || i === 5 ? GOOD(c.size, c.color) : shown;
    const at = T - (60 + i) * MIN;
    C.HEALTH.SP.rows.push({ brand: 'SP', parent: 'PB', sku, asin: 'B0' + sku, title: shown, qty: 5, price: 12.5, status: 'Active', channel: 'AFN', aplus: true, aplusAt: T, checked: T,
      content: { titleLen: shown.length, images: 8, bullets: 5, descLen: 300, title: shown } });
    cat[sku] = Object.assign({ subcat: 'Napkin Set' }, c);
    C.LI_WS.live.SP[sku] = { at, cAt: at, pt: 'NAPKIN', title: ours, titleLen: ours.length, kw: 'cotton', kwBytes: 6, bul: 5, desc: 300, catTitle: shown, tAt: at,
      gAt: at, st: ['BUYABLE', 'DISCOVERABLE'], iss: i === 10 ? [{ s: 'E', c: '90220', m: 'The value for color is not valid', a: ['color'] }] : [], slots: SLOTS, specs: {},
      iAt: at, cat: SLOTS, catPic: Object.fromEntries(SLOTS.map(s => [s, [sku + s, 1500, 1500]])) };
  }
  C.setCat('SP', cat);
  C.LI_WS.liveV++;
  C.reset();
  return { C, calls };
}
const idle = async (...Cs) => {
  for (let i = 0; i < 2000; i++) {
    if (Cs.every(C => !C.LY.run && !C.LY.inflight && !C.LY.q.length && !C.LI_WS.inflight && !C.LI_WS.q.length)) break;
    await new Promise(r => setTimeout(r, 2));
  }
  await new Promise(r => setTimeout(r, 5));
};
const leaders = list => list.filter(b => b.C.LY.leader).length;
// a database where a sync just ran (so a beat starts no cycle by itself)
const seeded = () => { const db = makeDb(); db.store['history/lsync_state'] = { kind: 'lsync', last: { at: T, n: 0, done: true, end: T }, day: '2026-11-14', dayAt: NINE, changes: [] }; return db; };

(async () => {
  console.log('== only one leader ==');
  {
    const db = seeded();
    const A = browser(db, {}), B = browser(db, {}), C3 = browser(db, {});
    await A.C.lyBeat();
    await B.C.lyBeat();
    await C3.C.lyBeat();
    ok('three browsers open: exactly one syncs (the first to find the lock free)', leaders([A, B, C3]) === 1 && A.C.LY.leader, [A, B, C3].map(b => b.C.LY.leader).join());
    ok('the lock in the database names it, with its heartbeat', db.store['history/lsync_state'].lock.tab === A.C.LY.tab && db.store['history/lsync_state'].lock.beat === T);
    const db2 = seeded();
    const D = browser(db2, {}), E = browser(db2, {});
    await Promise.all([D.C.lyBeat(), E.C.lyBeat()]);
    ok('two claiming at the same moment: still exactly one leader (each reads its claim back)', leaders([D, E]) === 1, [D, E].map(b => b.C.LY.leader).join());
    T += 30000;
    await A.C.lyBeat(); await B.C.lyBeat(); await C3.C.lyBeat();
    ok('the next beats: the same one leader', leaders([A, B, C3]) === 1 && A.C.LY.leader);
  }

  console.log('== takeover after the leader closes ==');
  {
    const db = seeded();
    const A = browser(db, {}), B = browser(db, {});
    await A.C.lyBeat(); await B.C.lyBeat();
    // A closes: it never beats again
    T += 60000;
    await B.C.lyBeat();
    ok('1 min after the leader\'s last beat: the other waits (the lock is still held)', !B.C.LY.leader);
    T += 40000;
    await B.C.lyBeat();
    ok('100 s after: the other browser takes over (within 2 minutes)', B.C.LY.leader && db.store['history/lsync_state'].lock.tab === B.C.LY.tab);
    await A.C.lyBeat();
    ok('the old leader, back again, finds the lock taken and stays a follower', !A.C.LY.leader && leaders([A, B]) === 1);
    // a leader hidden for more than 30 minutes lets go at once
    B.C.LY.hiddenAt = T - 31 * MIN;
    await B.C.lyBeat();
    await A.C.lyBeat();
    ok('a leader hidden for more than 30 minutes lets go; a visible browser takes over at its next beat', !B.C.LY.leader && A.C.LY.leader);
    B.C.LY.hiddenAt = 0;
    T += 30000;
  }

  console.log('== the order: a) B🟢 F🔴 false errors, b) Error / Amazon-error listings, c) the oldest reads ==');
  {
    const { C } = browser(seeded(), {});
    const pick = C.lyPick(T);
    const why = pick.map(p => p.why);
    ok('a) first: the false errors L4, L5', pick.slice(0, 2).map(p => p.sku).sort().join() === 'L4,L5' && why[0] === 'false error' && why[1] === 'false error', pick.slice(0, 4).map(p => p.sku + ':' + p.why).join(' '));
    const firstOld = why.indexOf('oldest read'), lastErr = why.lastIndexOf('error');
    ok('b) then every Error / Amazon-error listing (G10 among them), before any other', lastErr > 1 && firstOld > lastErr && pick.some(p => p.sku === 'G10' && p.why === 'error'), why.join(' '));
    const at = p => { const e = C.LI_WS.live[p.brand] && C.LI_WS.live[p.brand][p.sku]; return e ? Math.min(e.cAt || 0, e.gAt || 0, e.iAt || 0) : 0; };
    const olds = pick.filter(p => p.why === 'oldest read').map(at);
    ok('c) then the rest, oldest read first (never read before anything read)', olds.every((v, i) => !i || v >= olds[i - 1]) && olds.length > 0, olds.slice(0, 6).join(' '));
    ok('every listing once; about 200 a cycle (here all of them, capped when asked for 5)', new Set(pick.map(p => p.brand + p.sku)).size === pick.length && C.lyPick(T, 5).length === 5);
  }

  console.log('== a cycle: B and F read together, max 2 calls at a time, 20 SKUs a content call ==');
  const db = seeded();
  const amazon = { title: { L4: GOOD('18x18', 'Navy') }, get: { G10: { status: ['DISCOVERABLE'], issues: [{ severity: 'ERROR', code: '18320', message: 'Missing information: the listing is suppressed' }] } } };
  const A = browser(db, amazon), B = browser(db, {});
  await A.C.lyBeat(); await B.C.lyBeat();
  {
    const n = A.C.HEALTH.SP.rows.length + A.C.HEALTH.CPC.rows.length;
    A.C.SQ.run = { closed: false };
    ok('never while a send popup is open: no cycle starts', (await A.C.lyCycle()) === false && !A.C.LY.run);
    A.C.SQ.run = null;
    ok('Sync now (the leader): a cycle starts', (await A.C.lyCycle()) === true);
    await idle(A.C);
    const content = A.calls.list.filter(c => c.startsWith('content:'));
    ok(`every listing read: content in calls of up to 20 SKUs, get and limg for each (${n} listings)`, content.every(c => c.split(',').length <= 20) && content.reduce((s, c) => s + c.split(',').length, 0) === n
      && A.calls.list.filter(c => c.startsWith('get:')).length === n && A.calls.list.filter(c => c.startsWith('limg:')).length === n, content.join(' | ').slice(0, 200));
    ok('never more than 2 calls out at a time', A.calls.max === 2, String(A.calls.max));
  }

  console.log('== every other browser: the same rows and counts within a minute; Listing Health = Workspace there too ==');
  {
    ok('before its beat, the follower still has the old G10 (buyable)', B.C.LI_WS.live.SP.G10.st.includes('BUYABLE'));
    T += 30000;
    await B.C.lyBeat();
    ok('at its next beat (30 s): the follower took in the leader\'s reads — G10 not buyable, Amazon\'s error 18320, L4\'s new shop title', !B.C.LI_WS.live.SP.G10.st.includes('BUYABLE')
      && B.C.LI_WS.live.SP.G10.iss.some(i => i.c === '18320') && B.C.LI_WS.live.SP.L4.catTitle === GOOD('18x18', 'Navy'), JSON.stringify(B.C.LI_WS.live.SP.G10.st));
    const ctxA = A.C.hCtx(), ctxB = B.C.hCtx();
    const verdict = (C, ctx) => C.HEALTH.SP.rows.map(r => r.sku + ':' + C.healthOf(Object.assign({}, r), ctx).bucket).join(' ');
    ok('…so it judges every listing exactly as the leader does', verdict(A.C, ctxA) === verdict(B.C, ctxB));
    const g10 = (() => { const row = B.C.HEALTH.SP.rows.find(r => r.sku === 'G10'); return B.C.liWsChildKept(row, 'SP', ctxB, new Map(), T); })();
    ok('…and G10 is F🔴 there too (suppressed / not buyable)', B.C.bfOf(g10, g10.found.find(h => h.detector === 'amazon_error'), ctxB).f === 'r');
    // Listing Health's numbers = the Workspace's, in the follower (the numbers-match test's own comparison)
    const worstOf = html => { const m = strip(html).match(/By worst problem: Error ([\d,]+) · check again ([\d,]+) · Needs attention ([\d,]+) · No problem ([\d,]+)(?: · not checked yet ([\d,]+))? = Listing Health \(([\d,]+) listings?\)/);
      if (!m) return null; const v = i => +(m[i] || '0').replace(/,/g, ''); return { err: v(1), chk: v(2), att: v(3), ok: v(4), unk: v(5), n: v(6) }; };
    const C = B.C;
    C.el('hBrandView').value = 'SP';
    C.LI_WS.on = true; C.LI_WS.mode = 'all'; C.LI_WS.card = ''; C.LI_WS.chip = 'all'; C.LI_WS.sweep = null;
    C.liWsRender();
    const w = worstOf(C.el('liWs').innerHTML);
    const h = { critical: 0, action: 0, review: 0, healthy: 0, monitor: 0 };
    C.HEALTH.SP.rows.forEach(r => { const b = C.healthOf(Object.assign({}, r), ctxB).bucket; if (b in h) h[b]++; });   // Listing Health's own count, over every row
    ok('the follower\'s Workspace = its Listing Health: Error, Needs attention, No problem, total', w && w.err + w.chk === h.critical && w.att === h.action + h.review && w.ok === h.healthy + h.monitor
      && w.n === C.HEALTH.SP.rows.length, JSON.stringify({ w, h }));
    ok('the shared saved copy (lcache) and the shop-side copy (lsync) were written', Object.keys(db.store).some(k => /^history\/lcache_SP_/.test(k)) && Object.keys(db.store).some(k => /^history\/lsync_SP_/.test(k)));
  }

  console.log('== the status line and "What changed" ==');
  {
    T += 4 * MIN;
    const line = strip(A.C.lyLineHtml(T));
    ok('"Synced 4 min ago · N listings changed since 9 AM · next sync ~11 AM" + Sync now', /^Synced 4 min ago · \d+ listings? changed since 9 AM · next sync ~11(:0\d)? AM Sync now$/.test(line), line);
    const changes = db.store['history/lsync_state'].changes;
    const has = (sku, w) => changes.some(c => c.s === sku && c.w === w);
    // G10 has stock and no BUYABLE: "not buyable" (THE ONE RULE, 16 Nov) — no longer called "suppressed"
    ok('What changed: G10 not buyable, L4 now showing to shoppers (Amazon shows our fixed title)', has('G10', 'not buyable') && !has('G10', 'suppressed') && has('L4', 'now showing to shoppers'), JSON.stringify(changes));
    const ctx = A.C.hCtx();
    const real = c => { const row = A.C.HEALTH[c.b].rows.find(r => r.sku === c.s); const kid = A.C.liWsChildKept(row, c.b, ctx, new Map(), T);
      const shop = A.C.bfShop(A.C.lyRec ? { st: (A.C.LI_WS.live[c.b][c.s].st || []).join(','), errs: (A.C.LI_WS.live[c.b][c.s].iss || []).filter(i => i.s === 'E'), im: '' } : null, Object.assign({}, row, { brand: c.b }));
      return c.w === 'error fixed' ? kid.bucket !== 'critical' : c.w === 'new error' ? kid.bucket === 'critical' : c.w === 'suppressed' || c.w === 'not buyable' ? shop === 'r' : !kid.found.some(h => A.C.bfOf(kid, h, ctx, T).who === 'amazon'); };
    ok('…nothing invented: every change listed is true of the listing now', changes.length && changes.every(real), changes.map(c => c.s + ':' + c.w).join(' '));
    A.C.LY.open = true;
    const list = A.C.lyLineHtml(T);
    ok('a click on the line opens the list: SKU · what changed · when', /<b>G10<\/b><span class="ly-w is-supp">not buyable<\/span><time>9(:\d\d)? AM<\/time>/.test(list) && /<b>L4<\/b><span class="ly-w is-shown">now showing to shoppers<\/span>/.test(list), list.slice(0, 400));
    A.C.LY.open = false;
    T += 30000;
    await A.C.lyBeat();
    await B.C.lyBeat();
    const lineB = strip(B.C.lyLineHtml(T));
    ok('the other browser shows the same line (from the database)', lineB === strip(A.C.lyLineHtml(T)) && /^Synced 5 min ago · \d+ listings? changed since 9 AM · next sync ~11(:0\d)? AM Sync now$/.test(lineB), lineB + ' ‖ A: ' + strip(A.C.lyLineHtml(T)));
    await B.C.lySyncNow();
    ok('Sync now in a follower asks the leader (want in the database) and says so', db.store['history/lsync_state'].want === T && /asked — the syncing browser starts within a minute/.test(strip(B.C.lyLineHtml(T))));
    A.calls.list.length = 0;
    await A.C.lyBeat();
    ok('…the leader starts a cycle at its next beat', !!A.C.LY.run || A.calls.list.length > 0);
    await idle(A.C);
    ok('…which reads B🟢 F🔴 first: L5 (L4 is now shown fixed)', /^(get|limg):L5$/.test(A.calls.list.find(c => !c.startsWith('content:')) || ''), A.calls.list.slice(0, 6).join(' '));
  }

  console.log('== every 2 hours, only 9 AM – 7 PM (17 Nov 2026) ==');
  {
    const keepT = T;
    const at = (d, h, m) => new Date(2026, 10, d, h, m || 0).getTime();
    const db2 = makeDb();
    db2.store['history/lsync_state'] = { kind: 'lsync', last: { at: at(15, 10), n: 0, done: true, end: at(15, 10) }, day: '2026-11-15', dayAt: at(15, 9), changes: [] };
    const X = browser(db2, {});
    T = at(15, 11, 59); await X.C.lyBeat(); await idle(X.C);
    ok('1 h 59 min after the last sync: no automatic sync', X.calls.n === 0, String(X.calls.n));
    T = at(15, 12, 1); await X.C.lyBeat(); await idle(X.C);
    ok('2 hours after: an automatic sync runs', X.calls.n > 0, String(X.calls.n));
    const db3 = makeDb();
    db3.store['history/lsync_state'] = { kind: 'lsync', last: { at: at(15, 16), n: 0, done: true, end: at(15, 16) }, day: '2026-11-15', dayAt: at(15, 9), changes: [] };
    const Y = browser(db3, {});
    T = at(15, 19, 30); await Y.C.lyBeat(); await idle(Y.C);
    ok('7:30 PM, 3 h after the last: no sync after 7 PM', Y.calls.n === 0, String(Y.calls.n));
    ok('…and the line says the next one is tomorrow at 9 AM', /next sync tomorrow ~9 AM/.test(strip(Y.C.lyLineHtml(T))), strip(Y.C.lyLineHtml(T)));
    T = at(16, 3); await Y.C.lyBeat(); await idle(Y.C);
    ok('3 AM: no sync at night', Y.calls.n === 0, String(Y.calls.n));
    T = at(16, 9, 1); await Y.C.lyBeat(); await idle(Y.C);
    ok('9:01 AM next day: the first sync of the day runs', Y.calls.n > 0, String(Y.calls.n));
    const db4 = makeDb();
    db4.store['history/lsync_state'] = { kind: 'lsync', last: { at: at(15, 16), n: 0, done: true, end: at(15, 16) }, day: '2026-11-15', dayAt: at(15, 9), changes: [] };
    const Z = browser(db4, {});
    T = at(15, 21); await Z.C.lyBeat();
    await Z.C.lySyncNow(); await Z.C.lyBeat(); await idle(Z.C);
    ok('Sync now still works outside the hours (9 PM)', Z.calls.n > 0, String(Z.calls.n));
    T = keepT;
  }

  console.log('== the test site (saving off): this browser syncs for itself only ==');
  {
    const local = makeDb();
    const L = browser(local, {}, { window: { __TEST_ERP: true } });
    await L.C.lyBeat();
    await idle(L.C);
    ok('it is its own leader and wrote nothing to the database', L.C.LY.leader && L.C.LY.local && !local.writes.length, local.writes.join(' '));
    ok('…and still read and judged (the line says it synced)', /^Synced just now/.test(strip(L.C.lyLineHtml(T))), strip(L.C.lyLineHtml(T)));
  }

  console.log('== a reload never starts again from 0: the next page continues the cycle (23 Nov 2026) ==');
  {
    const keepT = T;
    T = new Date(2026, 10, 17, 11, 0).getTime();
    // the page "reloads" mid-cycle: its last beat saved the progress (lyFlush), pagehide lets the lock go, then this page is gone
    const reload = async (P, db) => {
      await P.C.lyFlush();
      await P.C.lsSave('history', 'lsync_state', { lock: { tab: P.C.LY.tab, beat: 0 } });
      P.C.LY.q = []; P.C.LY.run = null; P.C.LY.leader = false;
      await new Promise(r => setTimeout(r, 20));          // its reads still out land on nothing
      return JSON.parse(JSON.stringify(db.store['history/lsync_state']));
    };
    const runTill = async (P, n) => { for (let i = 0; i < 2000 && !(P.C.LY.run && P.C.LY.run.done >= n); i++) await new Promise(r => setTimeout(r, 1)); };
    const skusRead = P => new Set(P.calls.list.filter(x => /^get:/.test(x)).map(x => x.slice(4)));
    for (const site of [{ name: 'live', window: undefined }, { name: 'the test site (its saves go to ERP data)', window: { __TEST_ERP: { sbOn: true } } }]) {
      const db = makeDb();
      const A = browser(db, {}, { window: site.window });
      await A.C.lyBeat();
      for (let i = 0; i < 200 && !((db.store['history/lsync_state'] || {}).todo || {}).items; i++) await new Promise(r => setTimeout(r, 0));   // the cycle saves its list as it starts
      ok(`${site.name}: a cycle starts and saves its list of listings to read`, !!A.C.LY.run && (((db.store['history/lsync_state'] || {}).todo || {}).items || []).length === A.C.LY.run.n,
        JSON.stringify(((db.store['history/lsync_state'] || {}).todo || {}).items || []).slice(0, 80));
      await runTill(A, 6);
      const st = await reload(A, db);
      const got = st.last.got, n = st.last.n, left = st.todo.items.map(c => c.split('|')[1]);
      ok(`${site.name}: at the reload the progress is kept — ${got} of ${n} read, ${left.length} still to read`, got >= 6 && got + left.length === n && !st.last.done, JSON.stringify(st.last));
      const B = browser(db, {}, { window: site.window });
      await B.C.lyBeat();
      await new Promise(r => setTimeout(r, 0));
      ok(`${site.name}: the next page CONTINUES that cycle (same start, its count goes on) — not 0 of 200`, B.C.LY.run && B.C.LY.run.at === st.last.at && B.C.LY.run.n === n && B.C.LY.run.done >= got,
        B.C.LY.run && JSON.stringify({ at: B.C.LY.run.at === st.last.at, n: B.C.LY.run.n, done: B.C.LY.run.done }));
      ok(`${site.name}: …its line says so ("Syncing… ${got} of ${n}")`, new RegExp(`^Syncing… \\d+ of ${n}`).test(strip(B.C.lyLineHtml(T))) && B.C.LY.run.done >= got, strip(B.C.lyLineHtml(T)));
      await idle(B.C);
      const readB = skusRead(B);
      ok(`${site.name}: it reads only the listings still to read — none read again`, [...readB].every(s => left.includes(s)) && left.every(s => readB.has(s)), [...readB].filter(s => !left.includes(s)).join() + ' | ' + left.filter(s => !readB.has(s)).join());
      const end = db.store['history/lsync_state'];
      ok(`${site.name}: then the cycle ends once (done, nothing left to read)`, end.last.done && end.last.n === n && end.last.at === st.last.at && end.todo === null, JSON.stringify(end.last));
      T += 31000;
      B.calls.list.length = 0;
      await B.C.lyBeat(); await idle(B.C);
      ok(`${site.name}: the next beat starts nothing (synced; next sync in 2 hours)`, !B.C.LY.run && !B.calls.list.length, B.calls.list.slice(0, 3).join());
    }
    // a cycle cut short more than 2 hours ago is not continued: the due sync picks again
    {
      const db = makeDb();
      db.store['history/lsync_state'] = { kind: 'lsync', last: { at: T - 3 * 60 * MIN, n: 200, got: 50, done: false, end: 0 }, todo: { at: T - 3 * 60 * MIN, items: ['SP|L1|o', 'SP|L2|o'] }, day: '2026-11-17', dayAt: T - 3 * 60 * MIN, changes: [] };
      const P = browser(db, {});
      ok('a cycle begun more than 2 hours ago is not continued', P.C.lyResumable(T) === null || !P.C.lyResumable(T));
      P.C.LY.state = db.store['history/lsync_state'];
      ok('…one begun 1 hour ago is', !!(Object.assign(P.C.LY.state.last, { at: T - 60 * MIN }), P.C.LY.state.todo.at = T - 60 * MIN, P.C.lyResumable(T)));
    }
    // the test site, ERP data refusing the save (no right): this browser syncs for itself, and keeps its progress here
    {
      const db = makeDb();
      const refuse = { getDoc: db.getDoc, setDoc: async () => { throw Object.assign(new Error('ERP data: permission denied'), { code: 'permission-denied' }); }, store: db.store, writes: db.writes };
      const R = browser(refuse, {}, { window: { __TEST_ERP: { sbOn: true } } });
      await R.C.lyBeat(); await R.C.lyBeat();
      await runTill(R, 3);
      ok('test site, save refused: this browser syncs for itself (no lock, nothing in the database)', R.C.LY.local && R.C.LY.leader && R.C.LS.refused && !db.writes.length, JSON.stringify({ local: R.C.LY.local, leader: R.C.LY.leader, refused: R.C.LS.refused }));
      T += 31000; await R.C.lyBeat();
      const kept = R.C.lsLocalGet('history', 'lsync_state') || {};
      ok('…and its progress is kept in this browser (a reload continues it)', kept.last && kept.last.n > 0 && kept.todo && kept.todo.items.length === kept.last.n - kept.last.got, JSON.stringify(kept.last));
      await idle(R.C);
    }
    T = keepT;
  }

  console.log('== the one data door ==');
  {
    const db = makeDb();
    db.store['listingrules/famok_SP'] = { kind: 'famok', items: { x: 1 } };
    db.store['history/lsync_SP_3'] = { kind: 'lsync', items: {} };
    const P = browser(db, {}, { window: { __TEST_ERP: { sbOn: true } } });
    const other = await P.C.lsGet('listingrules', 'famok_SP'), mine = await P.C.lsGet('history', 'lsync_SP_3');
    const saved = await P.C.lsSave('listingrules', 'famok_SP', { items: { y: 2 } });
    ok('test site: only the sync\'s documents (lsync_…, lcache_…) are read and saved in ERP data — any other stays as before (nothing)', !other && !!mine && saved === false && !db.writes.includes('listingrules/famok_SP'), JSON.stringify({ other, mine: !!mine, saved }));
    const Q = browser(makeDb(), {}, { window: { __TEST_ERP: true } });
    ok('a test build that cannot save: the sync is this browser\'s own (lsOff)', Q.C.lsOff() && !P.C.lsOff());
  }
  {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app', 'listing', 'listing-sync.js'), 'utf8').replace(/\/\*[^]*?\*\//g, '');
    const saved = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'app', 'listing', 'listing-saved.js'), 'utf8').replace(/\/\*[^]*?\*\//g, '');
    ok('the sync and the saved copy read and write only through lsGet / lsSave', !/getDoc|setDoc|getDocs|doc\(db/.test(src) && !/getDoc|setDoc|getDocs|doc\(db/.test(saved));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
