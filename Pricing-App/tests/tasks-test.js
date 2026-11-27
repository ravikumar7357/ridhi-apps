/* Action Tracker (src/app/sales/tasks.js, Sales card #6): "+ Task" from Sales Alerts / the Forecast / "This week, explained" (pre-filled),
 * the names dropdown (Me first, A–Z, search), "+ Add a name…" (no bell, the creator closes it, linked later by name), duplicates, moving,
 * overdue, the early check and the 14-day verdicts, stock-out weeks skipped, the reorder task, the bell's "My tasks" for a Sales-only user,
 * permissions, delete + undo, the test site writing nothing, and the wiring. Firestore is an in-memory store here: every write is listed.
 *   node tests/tasks-test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 600) : '')); } };
const SRC = p => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
const FILES = ['app/sales/sales-alerts.js', 'app/sales/forecast.js', 'app/listing/fix-status.js', 'app/sales/tasks.js'];

/* ---- a fake page and an in-memory Firestore ---- */
function makeWorld(opt) {
  opt = opt || {};
  const store = JSON.parse(JSON.stringify(opt.store || {})), writes = [];
  const clone = x => JSON.parse(JSON.stringify(x));
  const merge = (a, b) => { const o = Object.assign({}, a); Object.keys(b).forEach(k => { o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object' ? merge(o[k], b[k]) : clone(b[k]); }); return o; };
  const els = {};
  const doc0 = { activeElement: null };
  class El {
    constructor(id) { this.id = id; this.innerHTML = ''; this.hidden = false; this.textContent = ''; this.title = ''; this.attrs = {}; this.isConnected = true; this.dataset = {}; this.kids = [];
      const set = new Set(); this.classList = { toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); }, contains: c => set.has(c), add: c => set.add(c), remove: c => set.delete(c) };
      this.style = { setProperty() {}, removeProperty() {} }; this.badge = null; }
    set className(v) { v.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener() {}
    appendChild(c) { this.kids.push(c); if (c.id) els[c.id] = c; }
    querySelector(sel) { return sel === '.fs-badge' ? this.badge : null; }
    querySelectorAll() { return []; }
    focus() { doc0.activeElement = this; }
    getBoundingClientRect() { return { right: 0, bottom: 0 }; }
  }
  const body = new El('body');
  Object.assign(doc0, { body, getElementById: id => els[id] || null, createElement: () => new El(''), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, visibilityState: 'visible', documentElement: new El('html') });
  els.paneAtrack = new El('paneAtrack'); els.tkPane = new El('tkPane'); els.fsBell = new El('fsBell'); els.fsBell.badge = new El('b'); els.fsPanel = new El('fsPanel');
  const lstore = {};
  const ctx = {
    console: { log() {}, table() {}, warn() {}, error() {}, info() {} }, Intl, Math, JSON, Number, String, Object, Array, Set, Map, WeakMap, Promise, Date, isFinite, setTimeout: () => 0, clearTimeout() {},
    setInterval: () => 0, clearInterval() {}, Error, RegExp, Symbol, Proxy, parseFloat, parseInt,
    localStorage: { getItem: k => (k in lstore ? lstore[k] : null), setItem: (k, v) => { lstore[k] = String(v); }, removeItem: k => { delete lstore[k]; } },
    document: doc0, addEventListener() {}, getComputedStyle: () => ({ position: 'static', getPropertyValue: () => '' }), CSS: { escape: s => s }, matchMedia: () => ({ matches: false }),
    $: id => els[id] || null, ME: Object.assign({ email: 'asha@ridhihome.com', admin: false, tabs: ['sales'], brands: [] }, opt.me || {}),
    sqIsTest: () => !!opt.test, sqName: e => String(e || '').split('@')[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
    TAB_OK: t => (opt.tabs || ['sales', 'salert', 'fcast', 'atrack']).includes(t), auth: { currentUser: null }, onAuthStateChanged() {},
    db: {}, doc: (db, c, id) => ({ path: c + '/' + id, id }), collection: (db, c) => ({ c }), where: (f, op, v) => ({ f, v }), query: (col, w) => ({ c: col.c, w }),
    getDoc: async ref => ({ exists: () => ref.path in store, data: () => clone(store[ref.path]) }),
    setDoc: async (ref, data, o) => { writes.push(ref.path); store[ref.path] = o && o.merge ? merge(store[ref.path] || {}, data) : clone(data); },
    getDocs: async q => { const docs = Object.entries(store).filter(([p, d]) => p.startsWith(q.c + '/') && (!q.w || d[q.w.f] === q.w.v)).map(([p, d]) => ({ id: p.slice(q.c.length + 1), data: () => clone(d) })); return { forEach: fn => docs.forEach(fn) }; },
    runTransaction: async (db, fn) => fn({ get: async ref => ({ exists: () => ref.path in store, data: () => clone(store[ref.path]) }), set: (ref, data) => { writes.push(ref.path); store[ref.path] = clone(data); } }),
    SD: { at: '', d: {} }, sdToday: () => '2026-11-25',
  };
  vm.createContext(ctx);
  vm.runInContext(FILES.map(f => SRC(f)).join('\n;\n') + `
;this.__x = { TK, TK_M, tkCreate, tkUpdate, tkMove, tkMoveFn, tkMayMove, tkMayDelete, tkDelete, tkComment, tkDup, tkWho, tkPeople, tkPickerHtml, tkFormHtml, tkFormOpen, tkBtnHtml,
  tkVerdict, tkBase, tkBellItems, tkBellUnseen, tkBellSecHtml, tkOverdue, tkSummary, tkLoad, tkNamesLoad, tkNamesSave, tkExtraList, tkRender, tkCsvText, tkHash, tkPt, taskCheck,
  tkLinksHtml, tkAutoLog, tkWorked, tkWorkedHtml, tkSetWin, foTaskBtn, alDetailHtml: typeof alDetailHtml === 'function' ? alDetailHtml : null, fsPanelHtml, fsBellDraw, fsMay, FS };`, ctx);
  return Object.assign(ctx.__x, { ctx, store, writes, els });
}
const PEOPLE = { users: {} };
const person = (email, name) => { PEOPLE.users[String(Math.random()).slice(2)] = { email, name }; };
person('asha@ridhihome.com', 'Asha Kapoor'); person('vishesh.g@ridhihome.com', ''); person('bharat@ridhihome.com', 'Bharat Singh'); person('chitra@ridhihome.com', 'Chitra Rao');
const fresh = opt => { const W = makeWorld(Object.assign({ store: { 'history/tasknames': { users: PEOPLE.users, extra: {} } } }, opt)); return W; };

(async () => {
  console.log('== 1. "+ Task" from Sales Alerts, the Forecast and "This week, explained": pre-filled ==');
  {
    const W = fresh();
    await W.tkLoad();
    // Sales Alerts: the card's button (the page's own code builds it)
    const alSrc = SRC('app/sales/sales-alerts.js');
    ok('Sales Alerts: the "Create task — coming soon" placeholder is now "+ Task", pre-filled from the alert', !/Coming soon — with the Action Tracker/.test(alSrc) && /tkBtnHtml\(\{ src: 'alert', brand: a\.brand, key: a\.key, parent: a\.parent, name: a\.name, problem: `Sales −\$\{alPctL\(a\.drop, false\)\} vs expected/.test(alSrc));
    const o = { src: 'alert', brand: 'SP', key: 'SP|PA', parent: 'PA', name: 'Ridhi Round Tablecloth 70 inch', problem: 'Sales −52% vs expected · 6 days', kind: 'drop', ref: 'SP|PA|2026-11-17', pick: 'stock' };
    const btn = W.tkBtnHtml(o, 'al-btn', '+ Task');
    ok('…the button carries the product, brand, problem and page', /class="tk-new al-btn"/.test(btn) && /data-tk-new="\{&quot;src&quot;:&quot;alert&quot;/.test(btn) && />\+ Task<\/button>$/.test(btn));
    W.tkFormOpen(o);
    const form = W.els.tkF.innerHTML;
    ok('…the form: product, brand, problem, "from Sales Alerts"; the cause\'s quick pick chosen; due +3 days; assigned to me', /<b>Ridhi Round Tablecloth 70 inch<\/b><span>Ridhi · from Sales Alerts<\/span><span class="tk-prob">Sales −52% vs expected · 6 days<\/span>/.test(form)
      && /data-tk-pick="stock" aria-pressed="true"/.test(form) && /data-tk-v="action" value="Reorder stock"/.test(form) && /type="date" data-tk-v="due" value="\d{4}-\d{2}-\d{2}"/.test(form) && /Me — Asha Kapoor/.test(form), form.slice(0, 500));
    ok('…every quick pick: Restart / raise ads · Fix listing · Reorder stock · Change price · Check competitor · Other', ['Restart / raise ads', 'Fix listing', 'Reorder stock', 'Change price', 'Check competitor', 'Other'].every(t => form.includes('>' + t + '<')));
    // the Forecast: a 🔴 family and a ⛔ SKU
    const fam = { brand: 'CPC', key: 'CPC|PW', parent: 'PW', name: 'The Whimsical Corner Pillow Insert', lead: 60 };
    const red = Object.assign({}, fam, { status: 'red', cover: { outHigh: '2026-12-09', high: 23 } });
    const fb = W.foTaskBtn(red, red, 'fo-btn');
    ok('Forecast 🔴: "Runs out ~9 Dec (23 days of stock vs 60-day lead time)", kind reorder, "Reorder stock"', /Runs out ~9 Dec \(23 days of stock vs 60-day lead time\)/.test(fb.replace(/&quot;/g, '"')) && /&quot;kind&quot;:&quot;stock&quot;/.test(fb) && /&quot;pick&quot;:&quot;stock&quot;/.test(fb));
    const kid = { status: 'oos', inbound: 0, weekLoss: 45, label: 'RTC165-6090', asin: 'B0K', key: 'CPC|PW#B0K', cover: null };
    ok('Forecast ⛔ SKU: "Out of stock — losing ~45 units/week", the SKU named', /Out of stock — losing ~45 units\/week/.test(W.foTaskBtn(kid, red).replace(/&quot;/g, '"')) && /&quot;sku&quot;:&quot;RTC165-6090&quot;/.test(W.foTaskBtn(kid, red)));
    ok('…never on a 🟢 / 🟡 family', W.foTaskBtn(Object.assign({}, red, { status: 'green' }), red) === '' && W.foTaskBtn(Object.assign({}, red, { status: 'amber' }), red) === '');
    ok('"This week, explained": each drop gets "+ Task" (Sales Nov 15–21 …)', /m\.d < 0 && typeof tkBtnHtml === 'function' \? tkBtnHtml\(\{ src: 'insight', brand: m\.brand, key: m\.key/.test(SRC('app/sales/sales-insight.js')));
    W.tkFormOpen({ src: 'insight', brand: 'SP', key: 'SP|PB', name: 'Block Print Napkins', problem: 'Sales −31% in Nov 15–21 (−$2,140 against Nov 8–14)', kind: 'week' });
    ok('…its form says "from This week, explained"', /from This week, explained/.test(W.els.tkF.innerHTML) && /Sales −31% in Nov 15–21/.test(W.els.tkF.innerHTML));
    ok('no "+ Task" for someone who cannot open the Action Tracker', makeWorld({ tabs: ['sales'] }).tkBtnHtml(o) === '');
  }

  console.log('== 2. "Assign to": every Sellora user by name, Me first, A–Z, search; "+ Add a name…" ==');
  {
    const W = fresh();
    await W.tkLoad();
    const f = { o: {}, to: { email: 'asha@ridhihome.com' }, popen: true, pq: '' };
    const h = W.tkPickerHtml(f);
    const names = [...h.matchAll(/<span class="tk-av">[^<]*<\/span><span>(?:<b>Me<\/b> — )?([^<]+)<\/span>/g)].map(m => m[1]);
    ok('names, not e-mails: Me (Asha Kapoor) first, then A–Z: Bharat Singh, Chitra Rao, Vishesh G (no name kept → Sellora\'s name from the e-mail)', names.join(' | ') === 'Asha Kapoor | Bharat Singh | Chitra Rao | Vishesh G', names.join(' | '));
    ok('…the e-mail only on hover', /title="bharat@ridhihome.com"/.test(h));
    f.pq = 'chi';
    ok('search: "chi" → Chitra Rao only', [...W.tkPickerHtml(f).matchAll(/data-tk-to="([^"]+)"/g)].map(m => m[1]).join() === 'chitra@ridhihome.com');
    ok('"+ Add a name…" at the bottom', /<button type="button" class="tk-addbtn" data-tk-f="adding">\+ Add a name…<\/button>/.test(h));
    // an extra name
    await W.tkNamesSave({ extra: { xdev: { name: 'Deepak (printer)', by: 'asha@ridhihome.com', at: 1 } } });
    ok('the extra name is saved in the shared names list (history/tasknames)', W.store['history/tasknames'].extra.xdev.name === 'Deepak (printer)' && W.writes.includes('history/tasknames'));
    f.pq = '';
    const h2 = W.tkPickerHtml(f);
    ok('…offered next time, marked "(not on Sellora)", removable by who added it', /data-tk-tox="xdev"[\s\S]*?Deepak \(printer\) <i class="muted">\(not on Sellora\)<\/i>/.test(h2) && /data-tk-rmx="xdev"/.test(h2));
    W.ctx.ME.email = 'bharat@ridhihome.com';
    ok('…someone else cannot remove it', !/data-tk-rmx="xdev"/.test(W.tkPickerHtml(f)));
    W.ctx.ME.email = 'asha@ridhihome.com';
    const r = await W.tkCreate({ src: 'alert', brand: 'SP', key: 'SP|PX', name: 'Kantha Quilt', problem: 'Sales −40% vs expected', kind: 'drop', action: 'Check competitor', to: { name: 'Deepak (printer)', x: 'xdev' }, due: '2026-11-28' });
    const t = r.t, who = W.tkWho(t);
    ok('a task for an extra name: "(not on Sellora)"', who.ext && who.name === 'Deepak (printer)' && who.email === null);
    ok('…no bell for anyone about it (no Sellora user to ring)', W.tkBellItems(W.TK.tasks, 'asha@ridhihome.com', new Set(), '2026-12-05').every(x => x.t.id !== t.id || x.k === 'verdict'));
    ok('…the creator can move / close it; nobody else', W.tkMayMove(t, 'asha@ridhihome.com') && !W.tkMayMove(t, 'bharat@ridhihome.com'));
    await W.tkNamesSave({ users: { zz: { email: 'deepak@ridhihome.com', name: 'Deepak (printer)' } } });
    const linked = W.tkWho(t);
    ok('later added to Sellora with the same name → the task follows them (a bell, their move)', linked.email === 'deepak@ridhihome.com' && !linked.ext && linked.linked && W.tkMayMove(t, 'deepak@ridhihome.com'));
    // the access list → the names list (an admin's visit)
    const A = makeWorld({ me: { email: 'ravi@thefabricrush.com', admin: true, tabs: [] }, store: { 'perms/ravi@thefabricrush.com': { admin: true }, 'perms/neha@ridhihome.com': { tabs: ['sales'], name: 'Neha Jain' }, 'perms/store@ridhihome.com': { repl: true, tabs: [] } } });
    await A.tkNamesLoad();
    const us = Object.values(A.store['history/tasknames'].users);
    ok('an admin\'s visit copies the Sellora users of the access list (with their name), not the ERP-only ones', us.some(u => u.email === 'neha@ridhihome.com' && u.name === 'Neha Jain') && !us.some(u => u.email === 'store@ridhihome.com'));
  }

  console.log('== 3. duplicates, moving, overdue, permissions, delete + undo ==');
  {
    const W = fresh();
    await W.tkLoad();
    const o = { src: 'alert', brand: 'SP', key: 'SP|PA', name: 'Round Tablecloth', problem: 'Sales −52% vs expected', kind: 'drop', action: 'Fix listing', to: { email: 'bharat@ridhihome.com' }, due: '2026-11-20' };
    const a = await W.tkCreate(o);
    ok('a task is saved as its own record in the shared history (history/task_…)', /^history\/task_\d{8}_[a-z0-9]+$/.test(W.writes[W.writes.length - 1]) && W.store['history/' + a.t.id].kind === 'task' && W.store['history/' + a.t.id].hist[0].a === 'created');
    const b = await W.tkCreate(o);
    ok('the same product + problem while it is open → the open one is shown, no second task', b.dup && b.dup.id === a.t.id && Object.keys(W.TK.tasks).length === 1);
    W.tkFormOpen(o);
    ok('…the form says so and opens it', /A task is already open for this/.test(W.els.tkF.innerHTML) && new RegExp(`data-tk-f="open" data-tk-id="${a.t.id}"`).test(W.els.tkF.innerHTML));
    ok('another problem on the same product is a new task', !(await W.tkCreate(Object.assign({}, o, { src: 'forecast', kind: 'stock', problem: 'Runs out ~9 Dec' }))).dup);
    ok('overdue: due 20 Nov, still open on 25 Nov', W.tkOverdue(W.TK.tasks[a.t.id], '2026-11-25') && !W.tkOverdue(W.TK.tasks[a.t.id], '2026-11-19'));
    ok('the line: "2 open tasks · 2 overdue · 0 worked this month" (both due 20 Nov)', W.tkSummary(Object.values(W.TK.tasks), '2026-11-25') === '2 open tasks · 2 overdue · 0 worked this month', W.tkSummary(Object.values(W.TK.tasks), '2026-11-25'));
    // permissions: Chitra (neither) cannot move; Bharat (assignee) can
    W.ctx.ME.email = 'chitra@ridhihome.com';
    await W.tkMove(a.t.id, 'done');
    ok('someone who neither made it nor has it cannot move it', W.TK.tasks[a.t.id].status === 'todo' && /Only the person it is for, or who made it/.test(W.TK.msg));
    await W.tkComment(a.t.id, 'Price was raised on Friday');
    ok('…but anyone may comment', W.TK.tasks[a.t.id].comments.length === 1 && W.TK.tasks[a.t.id].comments[0].by === 'chitra@ridhihome.com');
    W.ctx.ME.email = 'bharat@ridhihome.com';
    await W.tkMove(a.t.id, 'doing'); await W.tkMove(a.t.id, 'done');
    const t = W.TK.tasks[a.t.id];
    ok('the assignee moves it To do → In progress → Done; the history says who and when', t.status === 'done' && t.doneBy === 'bharat@ridhihome.com' && t.hist.map(h => h.a).join() === 'created,moved,done' && t.doneAt > 0);
    ok('…a done task is not overdue', !W.tkOverdue(t, '2026-11-25'));
    await W.tkDelete(a.t.id, false);
    ok('only the creator deletes', !W.TK.tasks[a.t.id].del);
    W.ctx.ME.email = 'asha@ridhihome.com';
    await W.tkDelete(a.t.id, false);
    ok('the creator deletes it (kept, marked deleted)', !!W.TK.tasks[a.t.id].del && W.store['history/' + a.t.id].del.by === 'asha@ridhihome.com');
    await W.tkDelete(a.t.id, true);
    ok('…Undo within a minute brings it back', !W.TK.tasks[a.t.id].del && W.TK.tasks[a.t.id].hist.some(h => h.a === 'restored'));
    await W.tkDelete(a.t.id, false);
    await W.tkUpdate(a.t.id, x => { x.del.at -= 61000; return x; });
    await W.tkDelete(a.t.id, true);
    ok('…not after a minute', !!W.TK.tasks[a.t.id].del);
  }

  console.log('== 4. "did it work?": baseline, the early check, the verdicts, stock-outs skipped, the reorder task ==');
  {
    const W = fresh();
    const at = Date.parse('2026-11-10T20:00:00Z'), doneAt = Date.parse('2026-11-12T20:00:00Z');     // US Pacific: made Tue 10 Nov, done Thu 12 Nov
    const s = [['2026-10-11', 40], ['2026-10-18', 44], ['2026-10-25', 36], ['2026-11-01', 40], ['2026-11-08', 38]].map(([wk, u]) => ({ wk, u, r: u, skip: '' }));
    const days = (per, n) => { const d = { A1: {} }; for (let i = 0; i < n; i++) { const day = new Date(Date.parse('2026-11-13T00:00:00Z') + i * 864e5).toISOString().slice(0, 10); d.A1[day] = [per[i % per.length], per[i % per.length] * 20]; } return d; };
    const T = (extra) => Object.assign({ id: 't1', status: 'done', at, doneAt, src: 'alert', kind2: 'drop' }, extra || {});
    const ctx = (per, n, extra) => Object.assign({ fam: { s, asins: ['A1'], status: 'red' }, days: { d: days(per, n), from: '2026-10-11', upTo: new Date(Date.parse('2026-11-13T00:00:00Z') + (n - 1) * 864e5).toISOString().slice(0, 10) }, weekly: null, alertOn: true }, extra || {});
    ok('the baseline: the 4 finished weeks before the week it was made (US Pacific) — 40 units/week', (b => b && b.u === 40 && b.weeks.join() === '2026-10-11,2026-10-18,2026-10-25,2026-11-01')(W.tkBase(T(), ctx([10], 14))), JSON.stringify(W.tkBase(T(), ctx([10], 14))));
    const worked = W.tkVerdict(T(), ctx([10, 10, 10, 10, 10, 10, 12], 14));
    ok('14 days after Done at 72/week: "Sales 40 → 72/week (+80%) — ✅ Worked"', worked.stage === 'final' && worked.v === 'worked' && worked.line === 'Sales 40 → 72/week (+80%) — ✅ Worked', worked.line);
    const early = W.tkVerdict(T(), ctx([10, 10, 10, 10, 10, 10, 12], 9));
    ok('9 days in: "Early check: +80%" (no verdict yet)', early.stage === 'early' && !early.v && /^Early check: \+80% — Sales 40 → 72\/week/.test(early.line), early.line);
    const none = W.tkVerdict(T(), ctx([6, 6, 6, 6, 6, 6, 8], 14));
    ok('44/week (+10%): ➖ No change', none.v === 'nochange' && /— ➖ No change$/.test(none.line), none.line);
    const worse = W.tkVerdict(T(), ctx([3, 3, 3, 4, 4, 4, 4], 14));
    ok('25/week (−38%): ❌ Didn\'t work', worse.v === 'didnt' && /Sales 40 → 25\/week \(−38%\) — ❌ Didn't work/.test(worse.line), worse.line);
    const back = W.tkVerdict(T(), ctx([6, 6, 6, 6, 6, 6, 4], 14, { alertOn: false }));
    ok('+5 % but Sales Alerts no longer flags it: ✅ Worked (back to expected)', back.v === 'worked' && /back to expected in Sales Alerts/.test(back.line), back.line);
    const wait = W.tkVerdict(T(), ctx([10], 5));
    ok('5 days in (Amazon is 1–2 days late): "Not enough data yet"', wait.stage === 'wait' && /^Not enough data yet/.test(wait.line), wait.line);
    ok('before Done: no check yet', W.tkVerdict(T({ status: 'doing', doneAt: 0 }), ctx([10], 14)).stage === 'open');
    // a stock-out week in the baseline is skipped, not counted as low demand
    const s2 = s.map(x => (x.wk === '2026-10-25' ? Object.assign({}, x, { u: 0, r: 0, skip: 'oos' }) : x));
    const b2 = W.tkBase(T(), { fam: { s: s2, asins: ['A1'] } });
    ok('a stock-out week in the 4 is skipped: (40 + 44 + 40) ÷ 3, not ÷ 4 with a 0', Math.abs(b2.u - 124 / 3) < 1e-9 && b2.skipped === 1 && !b2.weeks.includes('2026-10-25'), JSON.stringify(b2));
    ok('fewer than 2 normal weeks → "Not enough data yet"', /^Not enough data yet/.test(W.tkVerdict(T(), { fam: { s: s.map(x => Object.assign({}, x, { skip: 'oos' })), asins: ['A1'] }, days: null }).line));
    // the reorder task from the Forecast
    const ro = T({ src: 'forecast', kind2: 'stock' });
    ok('a reorder task: still 🔴 → it waits (never ❌ for the lead time)', W.tkVerdict(ro, { fam: { s, asins: ['A1'], status: 'red' } }).stage === 'wait');
    const ok2 = W.tkVerdict(ro, { fam: { s, asins: ['A1'], status: 'green' } });
    ok('…no longer ⛔ / 🔴 → ✅ Worked, at once', ok2.stage === 'final' && ok2.v === 'worked' && /Stock is back — the Forecast now says 🟢 OK — ✅ Worked/.test(ok2.line), ok2.line);
    ok('a kept verdict is what shows (old weeks leaving the store never change it)', W.tkVerdict(T({ verdict: { v: 'didnt', line: 'kept line' } }), ctx([10], 14)).line === 'kept line');
  }

  console.log('== 5. the bell: "My tasks" — also for a Sales-only user ==');
  {
    const W = fresh();
    await W.tkLoad();
    W.ctx.ME.email = 'bharat@ridhihome.com';
    const mk = (o) => W.tkCreate(Object.assign({ src: 'alert', brand: 'SP', name: 'P', kind: 'drop', action: 'Do it' }, o));
    await mk({ key: 'SP|A', problem: 'p1', to: { email: 'asha@ridhihome.com' }, due: '2026-11-30' });                 // new for Asha
    await mk({ key: 'SP|B', problem: 'p2', to: { email: 'asha@ridhihome.com' }, due: '2026-11-20' });                 // new + overdue for Asha
    W.ctx.ME.email = 'asha@ridhihome.com';
    const mine = await mk({ key: 'SP|C', problem: 'p3', to: { email: 'bharat@ridhihome.com' } });                     // Asha's own, a verdict later
    await W.tkUpdate(mine.t.id, x => Object.assign(x, { status: 'done', doneAt: 1, verdict: { v: 'worked', line: 'Sales 40 → 72/week (+80%) — ✅ Worked' } }));
    const items = W.tkBellItems(W.TK.tasks, 'asha@ridhihome.com', new Set(), '2026-11-25');
    ok('my tasks: 2 new (given by someone else), 1 overdue, 1 verdict on a task I made', items.filter(x => x.k === 'new').length === 2 && items.filter(x => x.k === 'late').length === 1 && items.filter(x => x.k === 'verdict').length === 1, items.map(x => x.k).join());
    ok('…in plain words', items.some(x => /^New task from Bharat Singh: Do it$/.test(x.text)) && items.some(x => /^Overdue since 20 Nov: Do it$/.test(x.text)) && items.some(x => /^Do it: Sales 40 → 72\/week \(\+80%\) — ✅ Worked$/.test(x.text)));
    ok('a task I gave myself rings no "new"', W.tkBellItems(W.TK.tasks, 'bharat@ridhihome.com', new Set(), '2026-11-25').filter(x => x.k === 'new').length === 0);
    // a Sales-only user: no Listing → no Fix status; the bell shows with "My tasks" only
    W.TK.bell = true;
    ok('Sales-only user: Fix status is off for them …', !W.fsMay() && !W.FS.on);
    W.fsBellDraw();
    ok('…but the bell shows, with the count of their task items', W.els.fsBell.hidden === false && W.els.fsBell.badge.textContent === '4' && /My tasks: 4 on your tasks/.test(W.els.fsBell.attrs['aria-label']), JSON.stringify(W.els.fsBell.attrs));
    const p = W.fsPanelHtml();
    ok('…the panel: "My tasks" only (no Fix status sections)', /<b>My tasks<\/b>/.test(p) && !/My tasks \(4\)/.test(p) && (p.match(/class="fs-it tk-bi/g) || []).length === 4 && !/Done in Sellora|Done in Seller Central|Not accepted by Amazon/.test(p) && /See all tasks →/.test(p));
    // mark as seen: per person
    await (async () => { const id = items[0].id; W.TK.seen.add(id); })();
    ok('mark as seen → one fewer', W.tkBellUnseen().length === 3);
    // a Listing user: all three sections
    const L = fresh({ me: { email: 'asha@ridhihome.com', tabs: ['sales', 'health'] } });
    L.TK.bell = true; L.FS.on = true; L.FS.loaded = true;
    const lp = L.fsPanelHtml();
    ok('a Listing user: Done in Sellora, Done in Seller Central and My tasks', L.fsMay() && /Done in Sellora/.test(lp) && /Done in Seller Central/.test(lp) && /My tasks \(0\)/.test(lp) || /All fixes accepted/.test(lp) && /My tasks/.test(lp), lp.slice(0, 300));
    ok('the seen marks are the person\'s own document (history/taskseen_<id>)', /tkSeenId\(\) \{ return 'taskseen_' \+ tkHash\(tkMe\(\)\); \}/.test(SRC('app/sales/tasks.js')));
  }

  console.log('== 6. the test site writes nothing ==');
  {
    const W = fresh({ test: true });
    await W.tkLoad();
    const n0 = W.writes.length;
    const r = await W.tkCreate({ src: 'alert', brand: 'SP', key: 'SP|A', name: 'P', problem: 'p', kind: 'drop', action: 'x', to: { email: 'asha@ridhihome.com' } });
    await W.tkMove(r.t.id, 'done'); await W.tkComment(r.t.id, 'hi'); await W.tkNamesSave({ extra: { x1: { name: 'N', by: 'asha@ridhihome.com' } } }); await W.tkDelete(r.t.id, false);
    ok('a task made, moved, commented, a name added, deleted — and not one write', W.writes.length === n0 && n0 === 0 && W.TK.tasks[r.t.id] && W.TK.tasks[r.t.id].del, W.writes.join());
    W.tkRender();
    ok('…the board says so', /Test site — tasks made here are kept in this visit only, never saved\./.test(W.els.tkPane.innerHTML));
  }

  console.log('== 7. the board, the CSV, taskCheck, the wiring ==');
  {
    const W = fresh();
    await W.tkLoad();
    await W.tkCreate({ src: 'forecast', brand: 'CPC', key: 'CPC|PW', name: 'The Whimsical Corner Pillow Insert', problem: 'Runs out ~9 Dec', kind: 'stock', action: 'Reorder stock', to: { email: 'asha@ridhihome.com' }, due: '2026-11-20' });
    W.TK.who = 'me';
    W.tkRender();
    const h = W.els.tkPane.innerHTML;
    ok('the board: header (Ridhi | CPC | Both, Me / Everyone / names, search, ⬇ CSV), the line, the chips, three columns', /<h2 class="tk-title">Action Tracker<\/h2>/.test(h) && /data-tk-brand="ALL"[^>]*>Both/.test(h) && /<option value="me" selected>Me<\/option><option value="all">Everyone<\/option>/.test(h)
      && /Bharat Singh/.test(h) && /⬇ CSV/.test(h) && /1 open task · 1 overdue · 0 worked this month/.test(h) && ['To do', 'In progress', 'Done', 'Overdue 🔴', '✅ Worked', '➖ No change', '❌ Didn\'t work'].every(t => h.includes(t))
      && (h.match(/data-tk-col="/g) || []).length === 3);
    ok('a card: product, problem, action, who (initials, the name on hover), due in red when late, the source', /<b class="tk-card-n" title="The Whimsical Corner Pillow Insert">/.test(h) && /→ Reorder stock/.test(h) && /<span class="tk-av" title="Asha Kapoor">AK<\/span>/.test(h) && /tk-due is-late">Late · 20 Nov/.test(h) && /Forecast · CPC/.test(h));
    ok('phone: the columns as tabs', /<div class="tk-tabs" role="tablist">/.test(h));
    ok('CSV: one line per task, the verdict columns', /^Task,Brand,Product,SKU,Problem,What to do,Assigned to,Not on Sellora,Made by,Made \(IST\),Due,Status,Done \(IST\),Source,Checked after \(days\),Baseline units\/week,After units\/week,Change %,Verdict,Verdict line/.test(W.tkCsvText(Object.values(W.TK.tasks))) && W.tkCsvText(Object.values(W.TK.tasks)).split('\r\n').length === 2);
    const tc = await W.taskCheck('whimsical');
    ok('taskCheck(\'whimsical\') finds it and reports every number', tc.length === 1 && tc[0].product === 'The Whimsical Corner Pillow Insert' && 'baseline' in tc[0] && 'stage' in tc[0]);
    const nav = SRC('app/core/nav.js'), html = SRC('index.html'), css = SRC('styles.css'), order = SRC('app/ORDER');
    ok('tab atrack: TABS after fcast, "Action Tracker", comes with the Sales Dashboard, showTab opens it', /'fcast', 'atrack', 'shop'/.test(nav) && /atrack: 'Action Tracker'/.test(nav) && /atrack: 'sales'/.test(nav) && /if \(which === 'atrack'\) ensureAtrack\(\);/.test(nav));
    ok('the Sales menu: Check & alerts → … Forecast, Action Tracker; its pane; not on the Dashboard', /<button id="tabFcast" class="nav">Forecast<\/button>\s*<button id="tabAtrack" class="nav">Action Tracker<\/button><\/div>/.test(html) && /<div id="paneAtrack" class="hide"><div id="tkPane"><\/div><\/div>/.test(html) && !/atrack|tkBtnHtml|tasks\.js/.test(SRC('app/core/dashboard.js')));
    ok('ORDER: tasks.js after forecast.js', /sales\/forecast\.js\r?\nsales\/tasks\.js\r?\n/.test(order));
    ok('the page is as wide as Sales Alerts; light + dark tokens; the phone tabs and bottom sheet', /#paneAtrack \.tk \{ max-width: 1160px; margin: 0 auto;/.test(css) && /:root\[data-theme="dark"\] :is\(#paneAtrack, \.tk-dlg, \.tk-toast\)/.test(css) && /#paneAtrack \.tk-col\.is-tab \{ display: block; \}/.test(css));
    ok('writes only task records, the names list and seen marks — no sales / listing / stock document, no Amazon call', !/baCall\(|saveStockDoc|saveHealthCache|adsPost|setDoc\(doc\(db, '(stock|health|age|perms)'/.test(SRC('app/sales/tasks.js')));
    ok('the verdict rule is in docs/sales-metrics.md and the Numbers Check list', /### Task verdict \("did it work\?"\)/.test(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sales-metrics.md'), 'utf8')) && /name: 'Task verdict \("did it work\?"\)'/.test(SRC('app/sales/sales-check.js')));
  }

  console.log('== 8. the roadmap card: Open listing / Amazon, the auto history, "What worked", the 7 / 14-day window ==');
  {
    const W = fresh({ tabs: ['sales', 'salert', 'fcast', 'atrack', 'health'] });
    await W.tkLoad();
    const at = Date.parse('2026-11-10T06:00:00Z');
    const fam = (await W.tkCreate({ src: 'alert', brand: 'SP', key: 'SP|B0PARENT01', parent: 'B0PARENT01', name: 'Block Print Napkins', problem: 'Sales −40% vs expected', kind: 'drop', action: 'Change price', pick: 'price', to: { email: 'asha@ridhihome.com' } })).t;
    const sku = (await W.tkCreate({ src: 'forecast', brand: 'SP', key: 'SP|B0PARENT01', parent: 'B0PARENT01', sku: 'RNP-18-RED', asin: 'B0CHILD001', name: 'RNP-18-RED (Block Print Napkins)', problem: 'Out of stock', kind: 'stock', action: 'Reorder stock', to: { email: 'asha@ridhihome.com' } })).t;
    W.ctx.TK_TASKS = W.TK.tasks;
    W.TK.tasks[fam.id].at = at; W.TK.tasks[sku.id].at = at;
    W.tkRender();
    const h = W.els.tkPane.innerHTML;
    ok('every card: "Open listing" (Listing Health) and "Amazon ↗" (the product page by ASIN)', new RegExp(`data-tk-listing="${sku.id}">Open listing`).test(h) && /href="https:\/\/www\.amazon\.com\/dp\/B0CHILD001" target="_blank" rel="noopener"[^>]*>Amazon ↗/.test(h)
      && /href="https:\/\/www\.amazon\.com\/dp\/B0PARENT01"/.test(h));
    const N = fresh({ tabs: ['sales', 'atrack'] }); await N.tkLoad();
    ok('…"Open listing" only for someone who can open Listing Health; the Amazon link for everyone', !/Open listing/.test(N.tkLinksHtml(sku)) && /Amazon ↗/.test(N.tkLinksHtml(sku)));
    // the auto history: Listing History rows and Fix status records for the task's SKUs, after it was made
    W.ctx.HEALTH = { SP: { rows: [{ sku: 'RNP-18-RED', asin: 'B0CHILD001', parent: 'B0PARENT01' }, { sku: 'RNP-18-BLU', asin: 'B0CHILD002', parent: 'B0PARENT01' }, { sku: 'OTHER', asin: 'B0OTHER001', parent: 'B0OTHERPAR' }] }, CPC: { rows: [] } };
    const rows = [
      { kind: 'listing', at: Date.parse('2026-11-11T09:00:00Z'), brand: 'SP', sku: 'RNP-18-RED', asin: 'B0CHILD001', field: 'Price', old: '$24.99', new: '$27.99', name: 'Vishesh G', by: 'vishesh.g@ridhihome.com', result: 'accepted' },
      { kind: 'listing', at: Date.parse('2026-11-12T09:00:00Z'), brand: 'SP', sku: 'RNP-18-BLU', asin: 'B0CHILD002', field: 'Title', old: 'Old title', new: 'New title with Christmas', name: 'Asha K', by: 'asha@ridhihome.com', result: 'working' },
      { kind: 'listing', at: Date.parse('2026-11-01T09:00:00Z'), brand: 'SP', sku: 'RNP-18-RED', field: 'Title', old: 'a', new: 'b', name: 'Asha K' },          // before the task: not shown
      { kind: 'listing', at: Date.parse('2026-11-11T09:00:00Z'), brand: 'SP', sku: 'OTHER', field: 'Price', old: '$1', new: '$2', name: 'Asha K' },             // another product: not shown
    ];
    const fixes = [{ brand: 'SP', sku: 'RNP-18-RED', state: 'fixed', at: Date.parse('2026-11-11T10:00:00Z'), confirmedAt: Date.parse('2026-11-12T10:00:00Z'), issue: 'Missing colour' }];
    const a1 = W.tkAutoLog(W.TK.tasks[sku.id], rows, fixes);
    ok('a SKU task: its Listing History sends after it was made — "Price changed $24.99 → $27.99 (Sellora, by Vishesh G) · ✅ accepted"', a1.length === 2 && a1[0].text === 'Price changed $24.99 → $27.99 (Sellora, by Vishesh G) · ✅ accepted', JSON.stringify(a1));
    ok('…and its Fix status changes', a1[1].auto === 'fs' && /^Fix status: .*Missing colour$/.test(a1[1].text), a1[1] && a1[1].text);
    const a2 = W.tkAutoLog(W.TK.tasks[fam.id], rows, fixes);
    ok('a family task: every SKU of the family (named), not other products, nothing from before', a2.length === 3 && a2.filter(x => x.auto === 'lh').map(x => x.sku).join() === 'RNP-18-RED,RNP-18-BLU' && /· RNP-18-BLU \(Sellora, by Asha K\) · ⏳ Amazon working$/.test(a2[1].text), a2.map(x => x.text).join(' | '));
    W.TK.lh = rows; W.FS.recs = fixes;
    W.TK.dr = sku.id; W.tkDrawerOpen = W.ctx.tkDrawerOpen; W.ctx.tkDrawerOpen(sku.id);
    const d = W.els.tkDr.innerHTML;
    ok('the drawer\'s history shows them, marked as added automatically, with the day', /<li class="is-auto"><span class="tk-auto" title="Recorded by Sellora — added here automatically">🔄<\/span> <b>Wed 11 Nov<\/b> · Price changed \$24\.99 → \$27\.99 \(Sellora, by Vishesh G\)/.test(d) && /🔧<\/span> <b>Thu 12 Nov<\/b> · Fix status:/.test(d), (d.match(/<ul class="tk-hist">[\s\S]*?<\/ul>/) || [''])[0].slice(0, 400));
    ok('…read only: nothing written for it', !W.writes.some(p => /listing_|fixwatch|fixsc/.test(p)) && !/setDoc\([^)]*'listing_/.test(SRC('app/sales/tasks.js')));
    // "What worked"
    const now = Date.parse('2026-11-25T06:00:00Z');
    const mk = (pick, v, pct, daysAgo, brand) => ({ id: 'w' + Math.random(), kind: 'task', status: 'done', brand: brand || 'SP', pick, doneAt: now - daysAgo * 864e5, verdict: v ? { v, pct, line: '' } : null });
    const T = {}; [mk('price', 'worked', 0.4, 5), mk('price', 'worked', 0.3, 10), mk('price', 'worked', 0.2, 20), mk('price', 'worked', 0.34, 25), mk('price', 'nochange', 0.05, 28),
      mk('ads', 'didnt', -0.3, 12), mk('ads', null, null, 3), mk('stock', 'worked', null, 8), mk('price', 'worked', 0.5, 60), mk('listing', 'worked', 0.2, 6, 'CPC')].forEach(t => { T[t.id] = t; });
    const vOf = t => (t.verdict ? Object.assign({ stage: 'final' }, t.verdict) : { stage: 'wait' });
    const r30 = W.tkWorked(T, 'SP', 30, now, vOf);
    const price = r30.find(r => r.pick === 'price');
    ok('"Change price: 5 done · 4 worked · avg +26%" (the last 30 days, Ridhi)', price.done === 5 && price.worked === 4 && price.nochange === 1 && Math.round(price.avg * 100) === 26, JSON.stringify(price));
    ok('…ads: 1 ❌, 1 still waiting; reorder: worked with no % (no sales change)', (a => a.didnt === 1 && a.waiting === 1 && a.done === 2)(r30.find(r => r.pick === 'ads')) && r30.find(r => r.pick === 'stock').avg === null);
    ok('…90 days takes the older one too; CPC only its own', W.tkWorked(T, 'SP', 90, now, vOf).find(r => r.pick === 'price').done === 6 && W.tkWorked(T, 'CPC', 30, now, vOf).map(r => r.pick).join() === 'listing' && W.tkWorked(T, 'ALL', 30, now, vOf).length === 4);
    W.TK.tasks = Object.assign({}, W.TK.tasks, T); W.TK.ww = { days: 30, open: true }; W.TK.brand = 'SP';
    W.ctx.tkVerdictOf = vOf;
    const ww = W.tkWorkedHtml(now);      // the same fixed day as the sample (25 Nov 2026) — passes on any day it is run
    ok('the panel: collapsible, 30 / 90 days, a row per action with Done · ✅ · ➖ · ❌ · ⏳ · avg', /<details class="tk-ww" open data-tk-wwbox><summary><b>What worked<\/b>/.test(ww) && /data-tk-ww="30" aria-pressed="true">30 days/.test(ww) && /data-tk-ww="90"/.test(ww)
      && /<th scope="row">Change price<\/th><td class="num">5<\/td><td class="num">4<\/td><td class="num">1<\/td><td class="num">0<\/td><td class="num">0<\/td><td class="num is-up">\+26%<\/td>/.test(ww), ww.slice(0, 600));
    // the review window
    const base = { s: [['2026-10-11', 40], ['2026-10-18', 40], ['2026-10-25', 40], ['2026-11-01', 40]].map(([wk, u]) => ({ wk, u, r: u, skip: '' })), asins: ['A1'] };
    const days = n => { const o = { A1: {} }; for (let i = 0; i < n; i++) o.A1[new Date(Date.parse('2026-11-13T00:00:00Z') + i * 864e5).toISOString().slice(0, 10)] = [8, 160]; return o; };
    const t7 = { status: 'done', at: Date.parse('2026-11-10T20:00:00Z'), doneAt: Date.parse('2026-11-12T20:00:00Z'), src: 'alert', kind2: 'drop', win: 7 };
    const v7 = W.tkVerdict(t7, { fam: base, days: { d: days(8), from: '2026-10-01', upTo: '2026-11-20' } });
    ok('a 7-day window: the verdict on day 7 (56/week, +40% → ✅)', v7.stage === 'final' && v7.v === 'worked' && /Sales 40 → 56\/week \(\+40%\) — ✅ Worked/.test(v7.line), v7.line);
    const v14 = W.tkVerdict(Object.assign({}, t7, { win: undefined }), { fam: base, days: { d: days(8), from: '2026-10-01', upTo: '2026-11-20' } });
    ok('…the default stays 14 days: the same 8 days are only an early check', v14.stage === 'early');
    ok('a new task: 14 days unless the creator picks 7', fam.win === 14 && (await W.tkCreate({ src: 'alert', brand: 'SP', key: 'SP|Z', name: 'Z', problem: 'z', kind: 'drop', action: 'x', win: 7 })).t.win === 7);
    W.tkFormOpen({ src: 'alert', brand: 'SP', key: 'SP|Y', name: 'Y', problem: 'y', kind: 'drop' });
    ok('…the form offers it (14 chosen)', /data-tk-win="7" aria-pressed="false">7 days after Done/.test(W.els.tkF.innerHTML) && /data-tk-win="14" aria-pressed="true">14 days after Done/.test(W.els.tkF.innerHTML));
    W.ctx.ME.email = 'bharat@ridhihome.com';
    await W.tkSetWin(fam.id, 7);
    ok('…only the creator changes it on the task', W.TK.tasks[fam.id].win === 14);
    W.ctx.ME.email = 'asha@ridhihome.com';
    await W.tkSetWin(fam.id, 7);
    ok('…the creator does, and it is in the history', W.TK.tasks[fam.id].win === 7 && W.TK.tasks[fam.id].hist.some(x => x.a === 'window' && x.to === '7'));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
