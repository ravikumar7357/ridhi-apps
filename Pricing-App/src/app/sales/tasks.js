/* ================= SALES · ACTION TRACKER: sales tasks and "did it work?" (Sales card #6, 25 Nov 2026) =================
 * Screen: Sales → Check & alerts → "Action Tracker" (tab 'atrack', #paneAtrack / #tkPane, its drawer #tkDr). Not on the Dashboard.
 * "+ Task" buttons (tkBtnHtml) on: Sales Alerts' cards and rows, Forecast's ⛔ / 🔴 rows, cards and drawer, the Sales Dashboard's
 * "This week, explained" movers. They open ONE small form (tkFormOpen), pre-filled with the product, brand, problem and the page.
 * Does:
 *   tasks      one document per task in Sellora's shared history collection (history/task_<id>, kind 'task'): product (family key
 *              brand|parent, or a SKU in it), problem, action, who, due date, note, status To do / In progress / Done, its history
 *              (created / moved / done — by whom, when) and short comments. An open task for the same product + problem is shown
 *              instead of a second one. Only the assignee or the creator moves / closes it (an "extra name" — not on Sellora — only
 *              the creator); anyone comments; only the creator deletes, with Undo for a minute (kept, marked deleted).
 *   names      "Assign to" lists every Sellora user with access: their name (their own, else the one Sellora reads from the e-mail,
 *              as Listing History does — sqName), "Me" first, then A–Z, with a search. Non-admins cannot read the access list, so the
 *              names live in history/tasknames: an admin's (or access viewer's) visit copies the access list's people there; each person
 *              adds themself on their visit. "+ Add a name…" adds someone not on Sellora (the same document, removable by who added it);
 *              their tasks say "(not on Sellora)", ring no bell, and follow the real person once a Sellora user has the same name.
 *   verdict    READ ONLY. Baseline = the average week of the 4 finished weeks (US Pacific, Sunday–Saturday) before the task was made,
 *              out-of-stock / suppressed weeks skipped (the Forecast's weeks: the Sales Alerts families, the same skip rules). After
 *              Done: units a week over the days after the done day (the nightly per-product days; else whole weeks): from 7 days an
 *              "Early check: +X%", from 14 days the verdict: ✅ Worked (≥ +15 %, or Sales Alerts no longer flags it), ➖ No change
 *              (−15 % … +15 %), ❌ Didn't work (worse). A reorder task (from the Forecast): ✅ as soon as the family is no longer ⛔ / 🔴.
 *              Weeks missing (Amazon is 1–2 days late) → "Not enough data yet". The final verdict is kept on the task once worked out.
 *   bell       the 🔔 (listing/fix-status.js) gains "My tasks": new tasks given to me, my overdue tasks, verdicts on tasks I made; seen per
 *              person (history/taskseen_<id>). It shows for ANY signed-in Sellora user with tasks; Listing users see all three sections.
 * ROADMAP CARD (25 Nov 2026): every task has "Open listing" (Listing Health, that SKU or family) and "Amazon ↗"; its history also shows,
 *   automatically and READ ONLY, what Sellora recorded for its SKUs after it was made — Listing History sends ("Price changed $24.99 →
 *   $27.99 (Sellora, by Vishesh)") and Fix status changes; "What worked" (top of the board): per action type, the tasks done in the last
 *   30 / 90 days · ✅ · ➖ · ❌ · the average change; the creator may set the review window per task: 7 or 14 days (14 unless chosen).
 * WRITES only task records, the names document and the person's own "seen" marks — never on the test site (tasks are kept in this
 *   visit only there). No sales / listing / stock data is changed; no Amazon call.
 * Main functions: tkVerdict (pure), tkLoad, tkCreate, tkUpdate, tkRender, tkFormOpen, tkBtnHtml, tkBellItems, taskCheck (console).
 *   Every name starts with tk / TK. Tests: tests/tasks-test.js. */

const TK_DOC_NAMES = ['history', 'tasknames'];
const TK_ST = { todo: 'To do', doing: 'In progress', done: 'Done' };
const TK_PICKS = [['ads', 'Restart / raise ads'], ['listing', 'Fix listing'], ['stock', 'Reorder stock'], ['price', 'Change price'], ['comp', 'Check competitor'], ['other', 'Other']];
const TK_V = { worked: ['✅', 'Worked'], nochange: ['➖', 'No change'], didnt: ['❌', 'Didn\'t work'] };
const TK_SRC = { alert: 'Sales Alerts', forecast: 'Forecast', insight: 'This week, explained' };
const TK_M = { baseWeeks: 4, early: 7, final: 14, up: 0.15, down: -0.15, dueDays: 3, undoMs: 60000, bellMs: 5 * 60000 };
const TK_WIN = [7, 14];                                  // the review window a creator may choose (days after Done)
const TK = { ww: { days: 30, open: true }, lh: null, lhBusy: null, tasks: {}, loaded: false, busy: null, dir: { users: {}, extra: {} }, msg: '', brand: 'ALL', who: 'me', q: '', chip: '', tab: 'todo', dr: null, drFrom: null,
  seen: new Set(), bell: false, bellTimer: 0, form: null, started: false, undo: {}, err: '' };

/* ----- small helpers ----- */
const tkEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const tkMe = () => String((typeof ME !== 'undefined' && ME && ME.email) || '').toLowerCase();
const tkHash = s => { let h = 2166136261; const t = String(s || '').toLowerCase(); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
const tkTest = () => typeof sqIsTest === 'function' && sqIsTest();
const tkWritable = () => !tkTest();
const TK_PT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
const TK_ISTD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
const TK_IST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const tkPt = ms => TK_PT.format(new Date(ms));                                       // the US Pacific day of a moment (sales weeks)
const tkIstDay = ms => TK_ISTD.format(new Date(ms));                                 // the India day (due dates, "this month")
const tkWhen = ms => (ms ? TK_IST.format(new Date(ms)).replace(',', '') + ' IST' : '—');
const tkAdd = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const tkSun = k => tkAdd(k, -new Date(k + 'T00:00:00Z').getUTCDay());
const TK_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const tkDay = k => (k ? `${+k.slice(8, 10)} ${TK_MON[+k.slice(5, 7) - 1]}` : '—');
const tkN = v => (v == null || !isFinite(v) ? '—' : new Intl.NumberFormat('en-US').format(Math.round(v)));
const tkPctTxt = p => (p == null ? '—' : (p > 0 ? '+' : p < 0 ? '−' : '') + Math.round(Math.abs(p) * 100) + '%');
const tkNameOfEmail = e => (typeof sqName === 'function' ? sqName(e) : String(e || '').split('@')[0]);
const tkBrandName = b => ({ SP: 'Ridhi', CPC: 'CPC', ALL: 'Both' }[b] || b);

/* ----- people: the names list (history/tasknames) ----- */
/** Every Sellora user the names document holds, plus me and everyone on a task: [{ email, name }], "Me" first then A–Z. */
function tkPeople(dir, me, tasks) {
  const m = new Map();
  const add = (email, name) => { const e = String(email || '').toLowerCase(); if (!e) return; const was = m.get(e); m.set(e, { email: e, name: name || (was && was.name) || tkNameOfEmail(e) }); };
  Object.values((dir && dir.users) || {}).forEach(u => add(u.email, u.name));
  Object.values(tasks || {}).forEach(t => { add(t.by); if (t.to && t.to.email) add(t.to.email); });
  if (me) add(me, (tkUserOf(me) || {}).name);
  return [...m.values()].sort((a, b) => (a.email === me ? -1 : b.email === me ? 1 : a.name.localeCompare(b.name)));
}
// a person's entry in the names list: the one with a name first (their own key, else any entry for the same e-mail)
const tkUserOf = email => { const e = String(email || '').toLowerCase(), own = TK.dir.users[tkHash(e)]; if (own && own.name) return own; return Object.values(TK.dir.users || {}).find(x => x && x.name && String(x.email || '').toLowerCase() === e) || own || Object.values(TK.dir.users || {}).find(x => x && String(x.email || '').toLowerCase() === e) || null; };
const tkNameOf = email => { const u = tkUserOf(email); return (u && u.name) || tkNameOfEmail(String(email || '').toLowerCase()); };
const tkInitials = name => String(name || '?').split(/\s+/).filter(w => /^[\p{L}\d]/u.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
/** Who a task is for: { email (null for an extra name), name, ext } — an extra name follows a Sellora user who has the same name. */
function tkWho(t, dir) {
  const to = t.to || {};
  if (to.email) return { email: String(to.email).toLowerCase(), name: tkNameOf(to.email), ext: false };
  const name = String(to.name || '').trim();
  const hit = Object.values((dir || TK.dir).users || {}).find(u => (u.name || tkNameOfEmail(u.email)).toLowerCase() === name.toLowerCase());
  return hit ? { email: hit.email.toLowerCase(), name: hit.name || tkNameOfEmail(hit.email), ext: false, linked: true } : { email: null, name, ext: true };
}
async function tkNamesLoad() {
  try {
    const snap = await getDoc(doc(db, TK_DOC_NAMES[0], TK_DOC_NAMES[1]));
    const d = snap.exists() ? snap.data() || {} : {};
    TK.dir = { users: d.users || {}, extra: d.extra || {} };
  } catch (e) { TK.dir = { users: {}, extra: {} }; }
  const me = tkMe();
  if (!me) return;
  const patch = {};
  // an admin / access viewer brings the access list's people over (Sellora users: a Sellora tab, or admin)
  if (typeof ME !== 'undefined' && ME && (ME.admin || ME.accessView)) {
    try {
      const snap = await getDocs(collection(db, 'perms'));
      snap.forEach(p => {
        const d = p.data() || {}, e = String(p.id || '').toLowerCase();
        if (!e || !(d.admin || (Array.isArray(d.tabs) && d.tabs.length))) return;
        const h = tkHash(e), was = TK.dir.users[h];
        if (!was) patch[h] = { email: e, name: String(d.name || '').trim() };
      });
    } catch (e) { /* not allowed to read the access list after all */ }
  }
  if (!tkUserOf(me)) patch[tkHash(me)] = { email: me, name: '' };
  if (Object.keys(patch).length) {
    Object.assign(TK.dir.users, patch);
    if (tkWritable()) { try { await setDoc(doc(db, TK_DOC_NAMES[0], TK_DOC_NAMES[1]), { users: patch }, { merge: true }); } catch (e) { /* the names stay this visit's */ } }
  }
}
async function tkNamesSave(patch) {
  if (patch.extra) Object.assign(TK.dir.extra, patch.extra);
  if (patch.users) Object.keys(patch.users).forEach(h => { TK.dir.users[h] = Object.assign({}, TK.dir.users[h], patch.users[h]); });
  if (!tkWritable()) return;
  try { await setDoc(doc(db, TK_DOC_NAMES[0], TK_DOC_NAMES[1]), patch, { merge: true }); } catch (e) { TK.msg = 'The names list could not be saved (' + ((e && e.code) || 'no access') + ').'; }
}
const tkExtraList = () => Object.entries(TK.dir.extra || {}).filter(([, x]) => x && !x.del).map(([id, x]) => ({ id, name: x.name, by: x.by }))
  .sort((a, b) => a.name.localeCompare(b.name));

/* ----- the tasks: read, make, change ----- */
async function tkLoad(force) {
  if (TK.busy) return TK.busy;
  if (TK.loaded && !force) return TK.tasks;
  TK.busy = (async () => {
    const jobs = [tkNamesLoad(), tkSeenLoad()];
    if (tkWritable()) jobs.push((async () => {
      try {
        const snap = await getDocs(query(collection(db, 'history'), where('kind', '==', 'task')));
        const out = {};
        snap.forEach(d => { const t = d.data(); if (t && t.id) out[t.id] = t; });
        TK.tasks = out; TK.err = '';
      } catch (e) { TK.err = 'The tasks could not be read (' + ((e && e.code) || (e && e.message) || 'no access') + ').'; }
    })());
    await Promise.all(jobs);
    TK.loaded = true;
    return TK.tasks;
  })().finally(() => { TK.busy = null; });
  return TK.busy;
}
const tkLive = t => t && !t.del;
const tkOpen = t => tkLive(t) && t.status !== 'done';
/** The open task already there for this product + problem (same family / SKU, same source and kind), or null. */
function tkDup(o, tasks) {
  return Object.values(tasks || TK.tasks).find(t => tkOpen(t) && t.key === o.key && (t.sku || '') === (o.sku || '') && t.src === o.src && tkKind(t) === (o.kind || '')) || null;
}
/** The record for a new task, from the form's values. */
function tkNewRecord(o, me, now) {
  const id = 'task_' + tkIstDay(now).replace(/-/g, '') + '_' + Math.random().toString(36).slice(2, 8);
  return { kind: 'task', id, v: 1, brand: o.brand, key: o.key, parent: o.parent || '', sku: o.sku || '', asin: o.asin || '', name: o.name || o.key, problem: o.problem || '',
    src: o.src, kind2: o.kind || '', ref: o.ref || '', action: o.action || '', pick: o.pick || '', to: o.to || { email: me }, due: o.due || '', note: o.note || '',
    win: TK_WIN.includes(Number(o.win)) ? Number(o.win) : TK_M.final, status: 'todo', by: me, at: now, upd: now, doneAt: 0, doneBy: '', hist: [{ a: 'created', by: me, at: now }], comments: [], base: o.base || null, verdict: null, del: null };
}
// The task's own kind (drop / stock / week) is kept in kind2: `kind` is always 'task' (the query reads it).
const tkKind = t => t.kind2 || '';
async function tkCreate(o) {
  const me = tkMe(), now = Date.now();
  const dup = tkDup({ key: o.key, sku: o.sku, src: o.src, kind: o.kind });
  if (dup) return { dup };
  const t = tkNewRecord(o, me, now);
  TK.tasks[t.id] = t;
  if (tkWritable()) {
    try { await setDoc(doc(db, 'history', t.id), t); }
    catch (e) { delete TK.tasks[t.id]; return { err: 'The task could not be saved (' + ((e && e.code) || 'no access') + ').' }; }
  }
  return { t };
}
/** Change one task: read it fresh, apply fn (null = nothing to do), write it back — in one transaction (two people never overwrite each other). */
async function tkUpdate(id, fn) {
  if (!tkWritable()) { const t = TK.tasks[id]; if (!t) return null; const n = fn(JSON.parse(JSON.stringify(t))); if (n) TK.tasks[id] = n; return n; }
  const ref = doc(db, 'history', id);
  const out = await runTransaction(db, async tx => {
    const s = await tx.get(ref);
    if (!s.exists()) throw new Error('This task is no longer there.');
    const n = fn(s.data());
    if (!n) return null;
    tx.set(ref, n);
    return n;
  });
  if (out) TK.tasks[id] = out;
  return out;
}
/** May I move / close it? The assignee or the creator; a task for someone not on Sellora: the creator. */
function tkMayMove(t, me) {
  const m = String(me || tkMe()).toLowerCase(), w = tkWho(t);
  return !!m && (t.by === m || (!w.ext && w.email === m));
}
const tkMayDelete = (t, me) => String(t.by) === String(me || tkMe()).toLowerCase();
function tkMoveFn(to, me, now) {
  return t => {
    if (!tkMayMove(t, me) || t.status === to || t.del) return null;
    t.hist = (t.hist || []).concat([{ a: to === 'done' ? 'done' : t.status === 'done' ? 'reopened' : 'moved', to, by: me, at: now }]);
    t.status = to; t.upd = now;
    if (to === 'done') { t.doneAt = now; t.doneBy = me; t.verdict = null; } else if (t.doneAt) { t.doneAt = 0; t.doneBy = ''; t.verdict = null; }
    return t;
  };
}
async function tkMove(id, to) {
  try { const n = await tkUpdate(id, tkMoveFn(to, tkMe(), Date.now())); if (!n) TK.msg = 'Only the person it is for, or who made it, can move it.'; }
  catch (e) { TK.msg = 'Not moved: ' + ((e && e.message) || e); }
  tkRepaint();
}
async function tkSetWin(id, win) {
  const me = tkMe(), now = Date.now(), n = Number(win);
  if (!TK_WIN.includes(n)) return;
  try { const r = await tkUpdate(id, x => (x.by !== me || tkWin(x) === n || (x.verdict && x.verdict.v) ? null : Object.assign(x, { win: n, upd: now, hist: (x.hist || []).concat([{ a: 'window', to: String(n), by: me, at: now }]) }))); if (!r) TK.msg = 'Only who made it can change when it is checked (before the verdict).'; }
  catch (e) { TK.msg = 'Not changed: ' + ((e && e.message) || e); }
  TK_VMEMO.clear(); tkRepaint();
}
async function tkComment(id, text) {
  const t = String(text || '').trim().slice(0, 500);
  if (!t) return;
  const me = tkMe(), now = Date.now();
  try { await tkUpdate(id, x => { x.comments = (x.comments || []).concat([{ by: me, at: now, t }]); x.upd = now; return x; }); }
  catch (e) { TK.msg = 'The comment was not saved: ' + ((e && e.message) || e); }
  tkRepaint();
}
async function tkDelete(id, undo) {
  const me = tkMe(), now = Date.now();
  try {
    await tkUpdate(id, x => {
      if (!tkMayDelete(x, me)) return null;
      if (undo) { if (!x.del || now - x.del.at > TK_M.undoMs) return null; x.del = null; x.hist = (x.hist || []).concat([{ a: 'restored', by: me, at: now }]); return x; }
      x.del = { by: me, at: now }; x.hist = (x.hist || []).concat([{ a: 'deleted', by: me, at: now }]); return x;
    });
    if (!undo) { TK.undo = { id, at: now }; if (TK.dr === id) tkDrawerClose(); TK.msg = 'Task deleted.'; }
    else { TK.undo = {}; TK.msg = 'Task back.'; }
  } catch (e) { TK.msg = 'Not deleted: ' + ((e && e.message) || e); }
  tkRepaint();
}

/* ----- "did it work?" (pure) ----- */
/** The task's review window: the days after Done the verdict waits for (7 or 14; 14 unless the creator chose 7). */
const tkWin = t => (TK_WIN.includes(Number(t && t.win)) ? Number(t.win) : TK_M.final);
/** ctx = { fam: { s: [{wk, u, r, skip}], asins: [..], status } | null, days: { d: asin→day→[units, sales], from, upTo } | null,
 *          weekly: asin→{ weeks: wk→{u, rev} } | null, alertOn: bool | null (Sales Alerts still flags it), now }.
 *  → { stage: 'open' | 'wait' | 'early' | 'final', v, pct, base, after, line }. */
function tkBase(t, ctx) {
  if (t.base && t.base.u != null) return t.base;
  const f = ctx.fam;
  if (!f || !f.s) return null;
  const wc = tkSun(tkPt(t.at));
  const want = [4, 3, 2, 1].map(i => tkAdd(wc, -7 * i));
  const rows = want.map(wk => f.s.find(x => x.wk === wk) || { wk, skip: 'missing' });
  const use = rows.filter(x => !x.skip);
  if (use.length < 2) return null;
  const rev = wk => (f.asins || []).reduce((s, a) => s + (Number((((ctx.weekly || {})[a] || {}).weeks || {})[wk] && ctx.weekly[a].weeks[wk].rev) || 0), 0);
  return { u: use.reduce((s, x) => s + x.r, 0) / use.length, rev: use.reduce((s, x) => s + rev(x.wk), 0) / use.length, weeks: use.map(x => x.wk), skipped: rows.length - use.length, from: want[0], to: tkAdd(want[3], 6) };
}
function tkAfter(t, ctx, n) {
  const D = tkPt(t.doneAt), a = tkAdd(D, 1), z = tkAdd(D, n);
  const dd = ctx.days, asins = (ctx.fam && ctx.fam.asins) || [];
  if (dd && dd.d && dd.from && dd.upTo && dd.from <= a && dd.upTo >= z) {
    let u = 0, rev = 0;
    for (let d = a; d <= z; d = tkAdd(d, 1)) asins.forEach(x => { const v = (dd.d[x] || {})[d]; if (v) { u += Number(v[0]) || 0; rev += Number(v[1]) || 0; } });
    return { u: u / n * 7, rev: rev / n * 7, days: n, from: a, to: z, src: 'days' };
  }
  // the per-day figures do not reach back that far: whole weeks after the done day (the weekly store)
  const f = ctx.fam;
  if (!f || !f.s) return null;
  const weeks = f.s.filter(x => x.wk > D && !x.skip).slice(0, Math.round(n / 7));
  if (weeks.length < Math.round(n / 7)) return null;
  const rev = wk => asins.reduce((s, x) => s + (Number((((ctx.weekly || {})[x] || {}).weeks || {})[wk] && ctx.weekly[x].weeks[wk].rev) || 0), 0);
  return { u: weeks.reduce((s, x) => s + x.r, 0) / weeks.length, rev: weeks.reduce((s, x) => s + rev(x.wk), 0) / weeks.length, days: weeks.length * 7, from: weeks[0].wk, to: tkAdd(weeks[weeks.length - 1].wk, 6), src: 'weeks' };
}
function tkVerdict(t, ctx) {
  if (t.status !== 'done' || !t.doneAt) return { stage: 'open', line: '' };
  if (t.verdict && t.verdict.v) return Object.assign({ stage: 'final', kept: true }, t.verdict);
  // a reorder from the Forecast: worked as soon as the family is no longer ⛔ / 🔴
  if (tkKind(t) === 'stock') {
    const st = ctx.fam && ctx.fam.status;
    if (!st) return { stage: 'wait', line: 'Not enough data yet — the Forecast has not read this family' };
    if (!['oos', 'oosin', 'red'].includes(st)) return { stage: 'final', v: 'worked', line: `Stock is back — the Forecast now says ${st === 'amber' ? '🟡 Reorder soon' : st === 'green' ? '🟢 OK' : st} — ✅ Worked` };
    return { stage: 'wait', line: `Still ${st === 'red' ? '🔴 Reorder now' : '⛔ Out of stock'} — the verdict comes when the stock is back` };
  }
  const base = tkBase(t, ctx);
  if (!base) return { stage: 'wait', line: 'Not enough data yet — fewer than 2 normal weeks before the task' };
  const win = tkWin(t);
  const fin = tkAfter(t, ctx, win), early = fin || win <= TK_M.early ? null : tkAfter(t, ctx, TK_M.early);
  const a = fin || early;
  if (!a) return { stage: 'wait', base, line: `Not enough data yet — the first ${Math.min(win, TK_M.early)} days after ${tkDay(tkPt(t.doneAt))} are not in (Amazon is 1–2 days late)` };
  const pct = base.u > 0 ? a.u / base.u - 1 : a.u > 0 ? 1 : 0;
  const words = `Sales ${tkN(base.u)} → ${tkN(a.u)}/week (${tkPctTxt(pct)})`;
  if (!fin) return { stage: 'early', base, after: a, pct, line: `Early check: ${tkPctTxt(pct)} — ${words}` };
  let v = pct >= TK_M.up ? 'worked' : pct <= TK_M.down ? 'didnt' : 'nochange';
  let why = '';
  if (v !== 'worked' && t.src === 'alert' && ctx.alertOn === false && pct > TK_M.down) { v = 'worked'; why = ' · back to expected in Sales Alerts'; }
  return { stage: 'final', v, base, after: a, pct, line: `${words} — ${TK_V[v][0]} ${TK_V[v][1]}${why}` };
}

/* ----- the data the verdict reads (the Forecast's families: its weeks with stock-outs skipped, Sales Alerts' result) ----- */
function tkCtx(t) {
  const ctx = { fam: null, days: null, weekly: null, alertOn: null, now: Date.now() };
  try {
    if (typeof VI !== 'undefined' && VI.data) { ctx.days = VI.data.days || null; ctx.weekly = (VI.data.weekly && VI.data.weekly.rows) || null; }
    const r = typeof foFor === 'function' ? foFor(t.brand) : null;
    const f = r && r.ok ? r.fams.find(x => x.key === t.key) : null;
    if (f) {
      const k = t.asin ? f.kids.find(x => x.asin === t.asin) : null;
      ctx.fam = k ? { s: k.s, asins: [k.asin], status: k.status } : { s: f.s, asins: f.kids.map(x => x.asin), status: f.status };
    }
    if (typeof alFor === 'function' && typeof AL !== 'undefined' && AL.data) {
      const ar = alFor(t.brand);
      if (ar && ar.ok) ctx.alertOn = [].concat(ar.alerts, ar.review, ar.waiting).some(a => a.key === t.key);
    }
  } catch (e) { /* the verdict waits */ }
  return ctx;
}
const TK_VMEMO = new Map();
function tkVerdictOf(t) {
  const k = t.id + '|' + t.upd + '|' + (typeof FO !== 'undefined' ? FO.v : '') + '|' + (typeof AL !== 'undefined' ? AL.v : '') + '|' + (typeof VI !== 'undefined' ? VI.v : '');
  if (TK_VMEMO.has(k)) return TK_VMEMO.get(k);
  const v = tkVerdict(t, tkCtx(t));
  TK_VMEMO.set(k, v);
  // the final verdict is kept on the task (once): the bell reads it, and it never changes when old weeks leave the store
  if (v.stage === 'final' && !v.kept && !t.verdict && tkWritable() && !TK.saving[t.id]) {
    TK.saving[t.id] = true;
    const keep = { v: v.v, pct: v.pct == null ? null : Math.round(v.pct * 1000) / 1000, line: v.line, at: Date.now(), base: v.base ? { u: v.base.u, rev: v.base.rev } : null };
    tkUpdate(t.id, x => (x.verdict ? null : Object.assign(x, { verdict: keep }))).catch(() => {}).finally(() => { TK.saving[t.id] = false; });
  }
  return v;
}
TK.saving = {};

/* ----- "Open listing" (Listing Health: the SKU, or the family by its parent ASIN) and "Amazon ↗" ----- */
const tkMayListing = () => (typeof TAB_OK === 'function' ? !!TAB_OK('health') : false);
function tkLinksHtml(t, cls) {
  const asin = t.asin || t.parent || '';
  const open = tkMayListing() ? `<button type="button" class="tk-lnk" data-tk-listing="${tkEsc(t.id)}">Open listing</button>` : '';
  const amz = /^B0[0-9A-Z]{8}$/i.test(asin) ? `<a class="tk-lnk" href="https://www.amazon.com/dp/${tkEsc(asin)}" target="_blank" rel="noopener" title="The product page on Amazon">Amazon ↗</a>` : '';
  return open || amz ? `<span class="tk-links ${cls || ''}">${open}${amz}</span>` : '';
}
function tkOpenListing(t) {
  if (!t || typeof showTab !== 'function') return;
  if (TK.dr) tkDrawerClose();
  if (t.sku && typeof fsOpenListing === 'function') return fsOpenListing(t.brand, t.sku);
  // a family: Listing Health on the parents, searched to its parent ASIN
  if ($('hBrandView')) $('hBrandView').value = t.brand;
  if ($('hIssueView')) $('hIssueView').value = 'ALL';
  if ($('hFilter')) $('hFilter').value = t.parent || String(t.key || '').split('|')[1] || '';
  if (typeof H_VIEW !== 'undefined') { try { H_VIEW = 'parent'; } catch (e) { /* the page's own */ } }
  showTab('health');
  setTimeout(() => { try { if (typeof renderHealth === 'function' && typeof H_LOADED !== 'undefined' && H_LOADED) renderHealth(); } catch (e) { /* the search shows it */ } }, 300);
}

/* ----- the task's own history, plus what Sellora recorded for its SKUs since (READ ONLY: Listing History, Fix status) ----- */
/** The SKUs and ASINs a task covers: its SKU, else its family's (the Forecast's family, Listing Health's rows of the parent). */
function tkSkusOf(t) {
  const skus = new Set(), asins = new Set();
  if (t.sku) skus.add(t.sku);
  if (t.asin) asins.add(t.asin);
  if (!t.sku) {
    try {
      const r = typeof foFor === 'function' ? foFor(t.brand) : null;
      const f = r && r.ok ? r.fams.find(x => x.key === t.key) : null;
      if (f) f.kids.forEach(k => { asins.add(k.asin); (k.skus || []).forEach(s => skus.add(s)); });
    } catch (e) { /* Listing Health's rows below */ }
    const rows = (typeof HEALTH !== 'undefined' && HEALTH[t.brand] && HEALTH[t.brand].rows) || [];
    rows.forEach(r => { if (r && r.parent && r.parent === t.parent) { skus.add(r.sku); if (r.asin) asins.add(r.asin); } });
    if (t.parent) asins.add(t.parent);
  }
  return { skus, asins };
}
const TK_WD = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });
const tkCut = (v, n) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
/** The auto entries (pure): rows = Listing History rows, fixes = Fix status records; only this task's SKUs, after it was made. */
function tkAutoLog(t, rows, fixes, cover) {
  const { skus, asins } = cover || tkSkusOf(t);
  const mine = r => r && r.brand === t.brand && (skus.has(r.sku) || (r.asin && asins.has(r.asin))) && Number(r.at) >= Number(t.at);
  const out = [];
  (rows || []).filter(mine).forEach(r => {
    const what = String(r.field || 'Listing').replace(/^./, c => c.toUpperCase());
    const change = r.pic ? 'changed' : r.old != null || r.new != null ? `changed ${tkCut(r.old, 40) || '(empty)'} → ${tkCut(r.new, 40) || '(empty)'}` : 'changed';
    const res = { accepted: ' · ✅ accepted', rejected: ' · ❌ rejected', working: ' · ⏳ Amazon working', sent: ' · ⏳ Amazon working' }[r.result] || '';
    out.push({ auto: 'lh', at: Number(r.at), sku: r.sku, text: `${what} ${change}${skus.size > 1 ? ' · ' + r.sku : ''} (Sellora, by ${r.name || tkNameOf(r.by)})${res}` });
  });
  (fixes || []).filter(r => mine(Object.assign({}, r, { at: r.confirmedAt || r.at }))).forEach(r => {
    const st = (typeof FS_STATES !== 'undefined' && FS_STATES[r.state]) || r.state;
    out.push({ auto: 'fs', at: Number(r.confirmedAt || r.at), sku: r.sku, text: `Fix status: ${st} — ${tkCut(r.issue || r.field || '', 70)}${skus.size > 1 ? ' · ' + r.sku : ''}` });
  });
  return out.sort((a, b) => a.at - b.at);
}
/** Listing History's rows (its own reader — read only), once per visit; the drawer draws again when they arrive. */
function tkLhRows() {
  if (typeof LH !== 'undefined' && Array.isArray(LH.rows) && !LH.loading && !LH.err) return LH.rows;
  if (TK.lh) return TK.lh;
  if (!TK.lhBusy && typeof nlLoadLh === 'function') {
    TK.lhBusy = Promise.resolve(nlLoadLh()).then(r => { TK.lh = Array.isArray(r) ? r : []; if (TK.dr) tkDrawerPaint(); }).catch(() => { TK.lh = []; });
  }
  return [];
}
const tkFixRecs = () => (typeof FS !== 'undefined' && Array.isArray(FS.recs) ? FS.recs : []);

/* ----- "What worked": per action type, the tasks done in the last 30 / 90 days ----- */
const tkPickOf = t => t.pick || (TK_PICKS.find(([, label]) => String(t.action || '').trim().toLowerCase() === label.toLowerCase()) || ['other'])[0];
/** rows: [{ pick, label, done, worked, nochange, didnt, waiting, avg }] — the tasks of the brand on view Done in the window. */
function tkWorked(tasks, brand, days, now, verdictOf) {
  const from = now - days * 864e5;
  const by = {};
  Object.values(tasks || {}).filter(t => tkLive(t) && t.status === 'done' && t.doneAt >= from && (brand === 'ALL' || t.brand === brand)).forEach(t => {
    const k = tkPickOf(t), v = verdictOf(t);
    const r = by[k] || (by[k] = { pick: k, label: (TK_PICKS.find(p => p[0] === k) || [k, 'Other'])[1], done: 0, worked: 0, nochange: 0, didnt: 0, waiting: 0, pcts: [] });
    r.done++;
    if (v.stage === 'final' && v.v) { r[v.v]++; if (v.pct != null && isFinite(v.pct)) r.pcts.push(v.pct); } else r.waiting++;
  });
  return Object.values(by).map(r => Object.assign(r, { avg: r.pcts.length ? r.pcts.reduce((s, p) => s + p, 0) / r.pcts.length : null }))
    .sort((a, b) => b.done - a.done || a.label.localeCompare(b.label));
}
function tkWorkedHtml() {
  const rows = tkWorked(TK.tasks, TK.brand, TK.ww.days, Date.now(), tkVerdictOf);
  const seg = `<span class="tk-seg tk-wwseg" role="group" aria-label="Done in the last">${[30, 90].map(n => `<button type="button" data-tk-ww="${n}" aria-pressed="${TK.ww.days === n}">${n} days</button>`).join('')}</span>`;
  const line = r => `${r.label}: ${r.done} done · ${r.worked} worked${r.avg != null ? ' · avg ' + tkPctTxt(r.avg) : ''}`;
  // the action that worked most often (then the higher share, then the higher average)
  const best = rows.filter(r => r.worked).sort((a, b) => b.worked - a.worked || b.worked / b.done - a.worked / a.done || (b.avg || 0) - (a.avg || 0))[0];
  const body = rows.length ? `<table class="tk-ww-t"><thead><tr><th scope="col">Action</th><th scope="col" class="num">Done</th><th scope="col" class="num">✅ Worked</th><th scope="col" class="num">➖ No change</th><th scope="col" class="num">❌ Didn't work</th><th scope="col" class="num">⏳ Waiting</th><th scope="col" class="num">Avg change</th></tr></thead>`
      + `<tbody>${rows.map(r => `<tr title="${tkEsc(line(r))}"><th scope="row">${tkEsc(r.label)}</th><td class="num">${r.done}</td><td class="num">${r.worked}</td><td class="num">${r.nochange}</td><td class="num">${r.didnt}</td><td class="num">${r.waiting}</td>`
      + `<td class="num${r.avg > 0 ? ' is-up' : r.avg < 0 ? ' is-dn' : ''}">${r.avg == null ? '—' : tkPctTxt(r.avg)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="tk-empty">No task was marked Done in the last ${TK.ww.days} days${TK.brand === 'ALL' ? '' : ' for ' + tkBrandName(TK.brand)}.</p>`;
  return `<details class="tk-ww"${TK.ww.open ? ' open' : ''} data-tk-wwbox><summary><b>What worked</b><span class="muted">${best ? 'Best: ' + tkEsc(line(best)) : 'per action type · done tasks and their verdicts'}</span></summary>`
    + `<div class="tk-ww-b"><div class="tk-ww-h"><span class="muted">${tkBrandName(TK.brand)} · tasks marked Done in the last ${TK.ww.days} days · avg change = the verdict's sales change (reorder tasks have none)</span>${seg}</div>${body}</div></details>`;
}

/* ----- the board ----- */
const tkOverdue = (t, today) => tkOpen(t) && t.due && t.due < (today || tkIstDay(Date.now()));
function tkShown() {
  const me = tkMe(), q = TK.q.trim().toLowerCase();
  return Object.values(TK.tasks).filter(t => tkLive(t) && (TK.brand === 'ALL' || t.brand === TK.brand)
    && (TK.who === 'all' || (TK.who === 'me' ? (t.by === me || tkWho(t).email === me) : TK.who.startsWith('x:') ? tkWho(t).ext && tkWho(t).name.toLowerCase() === TK.who.slice(2).toLowerCase() : tkWho(t).email === TK.who))
    && (!q || [t.name, t.problem, t.action, t.sku, t.parent, tkWho(t).name, t.note].join(' ').toLowerCase().includes(q)));
}
function tkChipOk(t, chip, today) {
  if (!chip) return true;
  if (chip === 'overdue') return tkOverdue(t, today);
  if (TK_ST[chip]) return t.status === chip;
  const v = tkVerdictOf(t);
  return v.stage === 'final' && v.v === chip;
}
function tkSummary(list, today) {
  const open = list.filter(tkOpen).length, late = list.filter(t => tkOverdue(t, today)).length;
  const month = today.slice(0, 7);
  const worked = list.filter(t => t.status === 'done' && tkIstDay(t.doneAt).slice(0, 7) === month && tkVerdictOf(t).v === 'worked').length;
  return `${open} open task${open === 1 ? '' : 's'} · ${late} overdue · ${worked} worked this month`;
}
function tkBarHtml() {
  const b = (v, t) => `<button type="button" data-tk-brand="${v}" aria-pressed="${TK.brand === v}">${t}</button>`;
  const people = tkPeople(TK.dir, tkMe(), TK.tasks);
  const opt = (v, t) => `<option value="${tkEsc(v)}"${TK.who === v ? ' selected' : ''}>${tkEsc(t)}</option>`;
  const extras = [...new Set(Object.values(TK.tasks).filter(tkLive).map(t => tkWho(t)).filter(w => w.ext).map(w => w.name))].sort();
  return `<header class="tk-bar"><h2 class="tk-title">Action Tracker</h2><div class="tk-seg" role="group" aria-label="Brand">${b('SP', 'Ridhi')}${b('CPC', 'CPC')}${b('ALL', 'Both')}</div>`
    + `<label class="tk-sel"><span class="tk-sr">Person</span><select data-tk-who aria-label="Whose tasks">${opt('me', 'Me')}${opt('all', 'Everyone')}`
    + people.filter(p => p.email !== tkMe()).map(p => opt(p.email, p.name)).join('') + extras.map(n => opt('x:' + n, n + ' (not on Sellora)')).join('') + '</select></label>'
    + `<input type="search" class="tk-q" data-tk-q placeholder="Search tasks" aria-label="Search tasks" value="${tkEsc(TK.q)}">`
    + `<span id="tkMsg" class="muted" role="status">${tkEsc(TK.msg)}${TK.undo.id && Date.now() - TK.undo.at < TK_M.undoMs ? ' <button type="button" class="tk-link" data-tk-act="undo">Undo</button>' : ''}</span>`
    + `<div class="tk-bar-r"><button type="button" class="tk-btn" data-tk-act="myname">My name</button><button type="button" class="tk-btn" data-tk-act="csv">⬇ CSV</button>`
    + `<button type="button" class="tk-btn" data-tk-act="refresh"${TK.busy ? ' disabled' : ''}>${TK.busy ? 'Reading…' : 'Refresh'}</button></div></header>`;
}
function tkCardHtml(t, today) {
  const w = tkWho(t), v = tkVerdictOf(t), late = tkOverdue(t, today);
  const badge = v.stage === 'final' ? `<span class="tk-v is-${v.v}" title="${tkEsc(v.line)}">${TK_V[v.v][0]} ${TK_V[v.v][1]}</span>` : v.stage === 'early' ? `<span class="tk-v is-early" title="${tkEsc(v.line)}">Early ${tkPctTxt(v.pct)}</span>` : '';
  const next = t.status === 'todo' ? ['doing', 'Start'] : t.status === 'doing' ? ['done', 'Done'] : null;
  const may = tkMayMove(t);
  return `<article class="tk-card${late ? ' is-late' : ''}" data-tk-card="${tkEsc(t.id)}" tabindex="0" draggable="${may}" aria-label="${tkEsc(t.name + ': ' + t.problem)}">`
    + `<div class="tk-card-h"><b class="tk-card-n" title="${tkEsc(t.name)}">${tkEsc(t.name)}</b>${badge}</div>`
    + `<div class="tk-card-p">${tkEsc(t.problem)}</div>${t.action ? `<div class="tk-card-a">→ ${tkEsc(t.action)}</div>` : ''}${tkLinksHtml(t, 'is-card')}`
    + `<div class="tk-card-f"><span class="tk-av${w.ext ? ' is-ext' : ''}" title="${tkEsc(w.name + (w.ext ? ' (not on Sellora)' : ''))}">${tkEsc(tkInitials(w.name))}</span>`
    + `<span class="tk-due${late ? ' is-late' : ''}">${t.due ? (late ? 'Late · ' : 'Due ') + tkDay(t.due) : 'No due date'}</span><span class="tk-src">${tkEsc(TK_SRC[t.src] || t.src)} · ${tkBrandName(t.brand)}</span>`
    + (next && may ? `<button type="button" class="tk-mini" data-tk-move="${tkEsc(t.id)}|${next[0]}">${next[1]} →</button>` : '') + '</div></article>';
}
function tkRender() {
  const root = typeof document !== 'undefined' && document.getElementById ? document.getElementById('tkPane') : null;
  if (!root) return;
  tkStart();
  const today = tkIstDay(Date.now());
  let body;
  if (!TK.loaded) body = `<section class="tk-sum" aria-busy="true"><span class="tk-sk" style="width:340px"></span></section><div class="tk-cols">${[0, 1, 2].map(() => '<div class="tk-col"><span class="tk-sk" style="height:120px"></span><span class="tk-sk" style="height:120px"></span></div>').join('')}</div>`;
  else {
    const list = tkShown();
    const n = k => list.filter(t => tkChipOk(t, k, today)).length;
    const chip = (k, t) => `<button type="button" class="tk-chip is-${k}" data-tk-chip="${k}" aria-pressed="${TK.chip === k}">${t} <b class="num">${n(k)}</b></button>`;
    const shown = list.filter(t => tkChipOk(t, TK.chip, today));
    const col = s => {
      const cards = shown.filter(t => t.status === s).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.upd - a.upd);
      return `<section class="tk-col${TK.tab === s ? ' is-tab' : ''}" data-tk-col="${s}" aria-label="${TK_ST[s]}"><h3 class="tk-col-h">${TK_ST[s]} <span class="muted num">${cards.length}</span></h3>`
        + (cards.length ? cards.map(t => tkCardHtml(t, today)).join('') : `<p class="tk-empty">${s === 'todo' ? 'Nothing to do.' : s === 'doing' ? 'Nothing in progress.' : 'Nothing done yet.'}</p>`) + '</section>';
    };
    body = (tkTest() ? '<p class="tk-note">Test site — tasks made here are kept in this visit only, never saved.</p>' : '') + (TK.err ? `<p class="tk-note is-err">${tkEsc(TK.err)}</p>` : '')
      + `<section class="tk-sum"><h2 class="tk-hl">${tkEsc(tkSummary(list, today))}</h2></section>${tkWorkedHtml()}`
      + `<div class="tk-chips" role="group" aria-label="Filter">${chip('todo', 'To do')}${chip('doing', 'In progress')}${chip('done', 'Done')}${chip('overdue', 'Overdue 🔴')}`
      + `<span class="tk-chips-sep" aria-hidden="true"></span>${chip('worked', '✅ Worked')}${chip('nochange', '➖ No change')}${chip('didnt', '❌ Didn\'t work')}</div>`
      + `<div class="tk-tabs" role="tablist">${Object.keys(TK_ST).map(s => `<button type="button" role="tab" data-tk-tab="${s}" aria-selected="${TK.tab === s}">${TK_ST[s]} <b>${shown.filter(t => t.status === s).length}</b></button>`).join('')}</div>`
      + `<div class="tk-cols">${col('todo')}${col('doing')}${col('done')}</div>`
      + `<p class="tk-how">Tasks come from the "+ Task" buttons on Sales Alerts, the Forecast and "This week, explained". After Done, Sellora checks the product's sales: an early check from day ${TK_M.early}, the verdict from day ${TK_M.final} (or day ${TK_M.early} when the task's maker chose 7) — against its 4 normal weeks before the task (out-of-stock weeks skipped). Sales weeks are US Pacific; times are IST. <code>taskCheck('name')</code> in the console shows every number.</p>`;
  }
  root.innerHTML = `<div class="tk">${tkBarHtml()}${body}</div>`;
  try {                                                                  // the bar sticks under the app's menu bar when that one is sticky
    const side = document.querySelector('.side'), pane = document.getElementById('paneAtrack');
    if (pane && pane.style && typeof getComputedStyle === 'function') pane.style.setProperty('--tk-top', (side && getComputedStyle(side).position === 'sticky' ? side.offsetHeight : 0) + 'px');
  } catch (e) { /* the bar sits at the top */ }
  if (TK.dr) tkDrawerPaint();
}
const tkShownTab = () => { const p = typeof document !== 'undefined' && document.getElementById ? document.getElementById('paneAtrack') : null; return !!p && !p.classList.contains('hide'); };
function tkRepaint() {
  if (tkShownTab()) tkRender();
  if (typeof fsBellDraw === 'function') fsBellDraw();
  if (typeof FS !== 'undefined' && FS.open && typeof fsPanelDraw === 'function') fsPanelDraw();
}
/** The tab opened (core/nav.js showTab): the tasks, then the sales data the verdicts read (the Forecast's and Sales Alerts' own loaders). */
async function ensureAtrack() {
  tkRender();
  await tkLoad();
  tkRender();
  const jobs = [];
  if (typeof foLoad === 'function') jobs.push(foLoad().catch(() => {}));
  if (typeof alLoad === 'function' && typeof alMay === 'function' && alMay('salert')) jobs.push(alLoad().catch(() => {}));
  await Promise.all(jobs);
  TK_VMEMO.clear();
  if (tkShownTab()) tkRender();
}

/* ----- the drawer ----- */
function tkChartSvg(t, v) {
  const ctx = tkCtx(t), f = ctx.fam;
  if (!f || !f.s) return '<p class="tk-empty">No weekly sales to draw yet.</p>';
  if (!v.base) v = Object.assign({}, v, { base: tkBase(t, ctx) });
  const created = tkSun(tkPt(t.at)), from = tkAdd(created, -42);
  const pts = f.s.filter(x => x.wk >= from);
  if (pts.length < 2) return '<p class="tk-empty">No weekly sales to draw yet.</p>';
  const W = 480, H = 140, l = 30, r = 8, top = 12, b = 22, max = Math.max(1, ...pts.map(x => x.u), v.base ? v.base.u : 0, v.after ? v.after.u : 0) * 1.1;
  const X = i => l + i / (pts.length - 1) * (W - l - r), Y = val => H - b - val / max * (H - top - b);
  const line = pts.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x.u).toFixed(1)}`).join('');
  const ix = wk => { const i = pts.findIndex(x => x.wk === tkSun(wk)); return i; };
  const mark = (wk, cls, label) => { const i = ix(wk); return i < 0 ? '' : `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${top}" y2="${H - b}" class="${cls}"/><text x="${(X(i) + 3).toFixed(1)}" y="${top + 8}" class="tk-cx">${label}</text>`; };
  const hl = (val, cls, label) => (val == null ? '' : `<line x1="${l}" x2="${W - r}" y1="${Y(val).toFixed(1)}" y2="${Y(val).toFixed(1)}" class="${cls}"/><text x="${W - r}" y="${(Y(val) - 3).toFixed(1)}" text-anchor="end" class="tk-cx">${label}</text>`);
  const skip = pts.map((x, i) => (x.skip === 'oos' ? `<circle cx="${X(i).toFixed(1)}" cy="${Y(x.u).toFixed(1)}" r="3.5" class="tk-cskip"/>` : '')).join('');
  return `<svg class="tk-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Units a week before and after the task">`
    + `<line x1="${l}" x2="${W - r}" y1="${H - b}" y2="${H - b}" class="tk-cg"/><text x="2" y="${top + 4}" class="tk-cx">${tkN(max)}</text>`
    + hl(v.base && v.base.u, 'tk-cb', `normal ${tkN(v.base && v.base.u)}/wk`) + hl(v.after && v.after.u, 'tk-ca', `after ${tkN(v.after && v.after.u)}/wk`)
    + `<path d="${line}" class="tk-cl"/>${skip}${mark(tkPt(t.at), 'tk-cm', 'task')}${t.doneAt ? mark(tkPt(t.doneAt), 'tk-cd', 'done') : ''}`
    + `<text x="${l}" y="${H - 6}" class="tk-cx">${tkDay(pts[0].wk)}</text><text x="${W - r}" y="${H - 6}" text-anchor="end" class="tk-cx">${tkDay(pts[pts.length - 1].wk)}</text></svg>`;
}
const TK_HIST = { window: 'set the check to', created: 'made it', moved: 'moved it to', done: 'marked it done', reopened: 'reopened it to', deleted: 'deleted it', restored: 'brought it back' };
function tkDrawerHtml(t) {
  const w = tkWho(t), v = tkVerdictOf(t), may = tkMayMove(t), today = tkIstDay(Date.now());
  const btn = (to, label) => `<button type="button" class="tk-btn${to === 'done' ? ' is-main' : ''}" data-tk-move="${tkEsc(t.id)}|${to}"${may ? '' : ' disabled title="Only the person it is for, or who made it, can move it"'}>${label}</button>`;
  const moves = Object.keys(TK_ST).filter(s => s !== t.status).map(s => btn(s, s === 'done' ? 'Mark done' : 'Move to ' + TK_ST[s])).join('');
  const verdict = t.status !== 'done' ? '<p class="tk-vline muted">The check starts when it is marked Done.</p>'
    : `<p class="tk-vline${v.stage === 'final' ? ' is-' + v.v : ''}">${tkEsc(v.line || '')}</p>`;
  const src = t.src === 'alert' ? `<button type="button" class="tk-btn" data-tk-go="salert|${tkEsc(t.brand)}">Open in Sales Alerts →</button>`
    : t.src === 'forecast' ? `<button type="button" class="tk-btn" data-tk-go="fcast|${tkEsc(t.key + (t.asin ? '#' + t.asin : ''))}|${tkEsc(t.brand)}">Open in Forecast →</button>`
      : `<button type="button" class="tk-btn" data-tk-go="sales|${tkEsc(t.brand)}">Open the Sales Dashboard →</button>`;
  // its own history, and — automatically, read only — what Sellora recorded for its SKUs since (Listing History sends, Fix status)
  const own = (t.hist || []).map(h => ({ at: h.at, html: `<b>${tkEsc(tkNameOf(h.by))}</b> ${TK_HIST[h.a] || h.a}${h.a === 'window' ? ` ${h.to} days` : h.to && h.a !== 'done' ? ' ' + TK_ST[h.to] : ''} <span class="muted">· ${tkWhen(h.at)}</span>` }));
  const auto = tkAutoLog(t, tkLhRows(), tkFixRecs()).map(a => ({ at: a.at, auto: true, html: `<span class="tk-auto" title="Recorded by Sellora — added here automatically">${a.auto === 'fs' ? '🔧' : '🔄'}</span> <b>${tkEsc(TK_WD.format(new Date(a.at)).replace(',', ''))}</b> · ${tkEsc(a.text)}` }));
  const hist = own.concat(auto).sort((a, b) => b.at - a.at).map(h => `<li${h.auto ? ' class="is-auto"' : ''}>${h.html}</li>`).join('');
  const com = (t.comments || []).map(c => `<li><b>${tkEsc(tkNameOf(c.by))}</b> <span class="muted">· ${tkWhen(c.at)}</span><p>${tkEsc(c.t)}</p></li>`).join('');
  return `<div class="tk-dr-grip" aria-hidden="true"></div><header class="tk-dr-h"><div class="tk-dr-t"><h3 id="tkDrTitle">${tkEsc(t.name)}</h3>`
    + `<p class="muted">${tkBrandName(t.brand)} · ${tkEsc(t.sku || t.parent || t.key)} · from ${tkEsc(TK_SRC[t.src] || t.src)}</p>${tkLinksHtml(t)}</div><button type="button" class="tk-x" data-tk-act="close" aria-label="Close">×</button></header>`
    + `<div class="tk-dr-b"><p class="tk-prob">${tkEsc(t.problem)}</p>`
    + `<dl class="tk-dl"><dt>What to do</dt><dd>${tkEsc(t.action || '—')}</dd><dt>Assigned to</dt><dd>${tkEsc(w.name)}${w.ext ? ' <span class="muted">(not on Sellora)</span>' : w.linked ? ' <span class="muted">(linked by name)</span>' : ''}</dd>`
    + `<dt>Due</dt><dd${tkOverdue(t, today) ? ' class="is-late"' : ''}>${t.due ? tkDay(t.due) + (tkOverdue(t, today) ? ' — overdue' : '') : '—'}</dd><dt>Status</dt><dd>${TK_ST[t.status]}${t.doneAt ? ' · ' + tkWhen(t.doneAt) : ''}</dd>`
    + `<dt>Checked</dt><dd>${tkMayDelete(t) && !(t.verdict && t.verdict.v) ? `<span class="tk-winseg" role="group" aria-label="Review window">${TK_WIN.map(n => `<button type="button" data-tk-setwin="${tkEsc(t.id)}|${n}" aria-pressed="${tkWin(t) === n}">${n} days</button>`).join('')}</span> after Done` : `${tkWin(t)} days after Done`}</dd>`
    + `<dt>Made by</dt><dd>${tkEsc(tkNameOf(t.by))} · ${tkWhen(t.at)}</dd>${t.note ? `<dt>Note</dt><dd>${tkEsc(t.note)}</dd>` : ''}</dl>`
    + `<div class="tk-btns">${moves}${tkMayDelete(t) ? `<button type="button" class="tk-btn is-del" data-tk-del="${tkEsc(t.id)}">Delete</button>` : ''}</div>`
    + `<section class="tk-dr-sec"><h4>Did it work?</h4>${verdict}${tkChartSvg(t, v)}</section>`
    + `<section class="tk-dr-sec"><h4>Comments</h4>${com ? `<ul class="tk-com">${com}</ul>` : '<p class="tk-empty">No comments yet.</p>'}`
    + `<form class="tk-cform" data-tk-cform="${tkEsc(t.id)}"><input type="text" maxlength="500" placeholder="Add a short note" aria-label="Add a comment" data-tk-ctext><button type="submit" class="tk-btn">Add</button></form></section>`
    + `<section class="tk-dr-sec"><h4>History</h4><ul class="tk-hist">${hist}</ul></section><div class="tk-btns">${src}</div></div>`;
}
function tkDrawerEl() {
  let el = document.getElementById('tkDr');
  if (!el) {
    const pane = document.getElementById('paneAtrack');
    if (!pane) return null;
    const bg = document.createElement('div'); bg.className = 'tk-dr-bg'; bg.id = 'tkDrBg'; bg.hidden = true; bg.setAttribute('data-tk-act', 'close');
    el = document.createElement('aside'); el.className = 'tk-dr'; el.id = 'tkDr'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'tkDrTitle'); el.tabIndex = -1;
    pane.appendChild(bg); pane.appendChild(el);
  }
  return el;
}
function tkDrawerOpen(id) {
  if (!TK.tasks[id]) return;
  if (!TK.dr) TK.drFrom = document.activeElement;
  TK.dr = id;
  tkDrawerPaint();
  const x = document.querySelector('#tkDr .tk-x'); if (x) x.focus();
}
function tkDrawerPaint() {
  const el = tkDrawerEl(), t = TK.tasks[TK.dr];
  if (!el) return;
  if (!t || !tkLive(t)) { tkDrawerClose(); return; }
  el.innerHTML = tkDrawerHtml(t);
  el.hidden = false; document.getElementById('tkDrBg').hidden = false;
  document.querySelectorAll('#tkPane .tk-card.is-sel').forEach(c => c.classList.remove('is-sel'));
  const c = document.querySelector(`#tkPane [data-tk-card="${CSS.escape(t.id)}"]`); if (c) c.classList.add('is-sel');
}
function tkDrawerClose() {
  const el = document.getElementById('tkDr'), bg = document.getElementById('tkDrBg');
  TK.dr = null;
  if (el) { el.hidden = true; el.innerHTML = ''; el.style.removeProperty('transform'); }
  if (bg) bg.hidden = true;
  document.querySelectorAll('#tkPane .tk-card.is-sel').forEach(c => c.classList.remove('is-sel'));
  const back = TK.drFrom; TK.drFrom = null;
  if (back && back.isConnected && back.focus) back.focus();
}

/* ----- "+ Task": the button the other pages draw, and the form ----- */
/** o = { src: 'alert'|'forecast'|'insight', brand, key, parent, sku, asin, name, problem, kind: 'drop'|'stock'|'week', ref, pick } → a button. */
function tkBtnHtml(o, cls, label) {
  if (typeof document === 'undefined') return '';
  if (typeof TAB_OK === 'function' && !TAB_OK('atrack') && !(typeof alMay === 'function' && alMay('atrack'))) return '';
  return `<button type="button" class="tk-new ${cls || ''}" data-tk-new="${tkEsc(JSON.stringify(o))}" title="Make a task for this">${label || '+ Task'}</button>`;
}
function tkFormHtml(f) {
  const o = f.o, dup = tkDup({ key: o.key, sku: o.sku, src: o.src, kind: o.kind });
  const ctx = `<div class="tk-ctx"><b>${tkEsc(o.name)}</b><span>${tkBrandName(o.brand)}${o.sku ? ' · ' + tkEsc(o.sku) : ''} · from ${tkEsc(TK_SRC[o.src] || o.src)}</span><span class="tk-prob">${tkEsc(o.problem)}</span></div>`;
  if (dup) {
    return `<header class="tk-f-h"><h3 id="tkFT">A task is already open for this</h3><button type="button" class="tk-x" data-tk-f="close" aria-label="Close">×</button></header>${ctx}`
      + `<div class="tk-dupbox"><p><b>${tkEsc(dup.action || dup.problem)}</b></p><p class="muted">${tkEsc(tkWho(dup).name)} · ${TK_ST[dup.status]}${dup.due ? ' · due ' + tkDay(dup.due) : ''} · made by ${tkEsc(tkNameOf(dup.by))} ${tkWhen(dup.at)}</p></div>`
      + `<footer class="tk-f-f"><button type="button" class="tk-btn" data-tk-f="close">Close</button><button type="button" class="tk-btn is-main" data-tk-f="open" data-tk-id="${tkEsc(dup.id)}">Open the task →</button></footer>`;
  }
  const picks = TK_PICKS.map(([k, t]) => `<button type="button" class="tk-pick" data-tk-pick="${k}" aria-pressed="${f.pick === k}">${t}</button>`).join('');
  return `<header class="tk-f-h"><h3 id="tkFT">New task</h3><button type="button" class="tk-x" data-tk-f="close" aria-label="Close">×</button></header>${ctx}`
    + `<form class="tk-f-b" data-tk-form novalidate><label class="tk-fl">What to do<input type="text" maxlength="200" data-tk-v="action" value="${tkEsc(f.action)}" placeholder="e.g. Raise the bid on the top 3 keywords" required></label>`
    + `<div class="tk-picks" role="group" aria-label="Quick picks">${picks}</div>`
    + `<div class="tk-fl">Assign to${tkPickerHtml(f)}</div>`
    + `<label class="tk-fl">Due date<input type="date" data-tk-v="due" value="${tkEsc(f.due)}"></label>`
    + `<div class="tk-fl">Check if it worked<span class="tk-winseg" role="group" aria-label="Review window">${TK_WIN.map(n => `<button type="button" data-tk-win="${n}" aria-pressed="${f.win === n}">${n} days after Done</button>`).join('')}</span></div>`
    + `<label class="tk-fl">Note<textarea rows="2" maxlength="500" data-tk-v="note" placeholder="Optional">${tkEsc(f.note)}</textarea></label>`
    + `${f.err ? `<p class="tk-ferr" role="alert">${tkEsc(f.err)}</p>` : ''}${tkTest() ? '<p class="tk-note">Test site — this task stays in this visit only.</p>' : ''}`
    + `<footer class="tk-f-f"><button type="button" class="tk-btn" data-tk-f="close">Cancel</button><button type="submit" class="tk-btn is-main">Create task</button></footer></form>`;
}
/** The names dropdown: the chosen person, then (open) a search, "Me" first, A–Z, the extra names, "+ Add a name…". */
function tkPickerHtml(f) {
  const me = tkMe();
  const people = tkPeople(TK.dir, me, TK.tasks), extras = tkExtraList(), q = (f.pq || '').trim().toLowerCase();
  const cur = f.to.email ? (f.to.email === me ? 'Me — ' + tkNameOf(me) : tkNameOf(f.to.email)) : f.to.name ? f.to.name + ' (not on Sellora)' : 'Choose…';
  if (!f.popen) return `<button type="button" class="tk-pickbtn" data-tk-f="pick" aria-haspopup="listbox" aria-expanded="false">${tkEsc(cur)}<span aria-hidden="true">▾</span></button>`;
  const hit = n => !q || n.toLowerCase().includes(q);
  const opts = people.filter(p => hit(p.name) || hit(p.email)).map(p => `<li role="option" aria-selected="${f.to.email === p.email}"><button type="button" data-tk-to="${tkEsc(p.email)}" title="${tkEsc(p.email)}">`
      + `<span class="tk-av">${tkEsc(tkInitials(p.name))}</span><span>${p.email === me ? '<b>Me</b> — ' : ''}${tkEsc(p.name)}</span></button></li>`).join('')
    + extras.filter(x => hit(x.name)).map(x => `<li role="option" aria-selected="${f.to.x === x.id}"><button type="button" data-tk-tox="${tkEsc(x.id)}"><span class="tk-av is-ext">${tkEsc(tkInitials(x.name))}</span><span>${tkEsc(x.name)} <i class="muted">(not on Sellora)</i></span></button>`
      + (x.by === me ? `<button type="button" class="tk-rm" data-tk-rmx="${tkEsc(x.id)}" aria-label="Remove ${tkEsc(x.name)} from the list">×</button>` : '') + '</li>').join('');
  const add = f.adding ? `<div class="tk-addn"><input type="text" maxlength="60" data-tk-v="newname" placeholder="Name of someone not on Sellora" aria-label="New name" value="${tkEsc(f.newname || '')}"><button type="button" class="tk-btn is-main" data-tk-f="addname">Add</button></div>`
    : '<button type="button" class="tk-addbtn" data-tk-f="adding">+ Add a name…</button>';
  return `<div class="tk-picker"><input type="search" data-tk-v="pq" placeholder="Search names" aria-label="Search names" value="${tkEsc(f.pq || '')}" autocomplete="off">`
    + `<ul class="tk-opts" role="listbox" aria-label="People">${opts || '<li class="tk-empty">No one matches.</li>'}</ul>${add}</div>`;
}
function tkFormOpen(o) {
  const pick = o.pick || (tkKind(o) === 'stock' || o.kind === 'stock' ? 'stock' : '');
  const pickText = (TK_PICKS.find(p => p[0] === pick) || [])[1] || '';
  TK.form = { o, pick, action: pick && pick !== 'other' ? pickText : '', to: { email: tkMe() }, due: tkAdd(tkIstDay(Date.now()), TK_M.dueDays), win: TK_M.final, note: '', popen: false, pq: '', adding: false, newname: '', err: '', from: document.activeElement };
  let bg = document.getElementById('tkFBg'), box = document.getElementById('tkF');
  if (!box) {
    bg = document.createElement('div'); bg.id = 'tkFBg'; bg.className = 'tk-fbg'; bg.setAttribute('data-tk-f', 'close');
    box = document.createElement('div'); box.id = 'tkF'; box.className = 'tk-dlg'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'tkFT');
    document.body.appendChild(bg); document.body.appendChild(box);
  }
  bg.hidden = false; box.hidden = false;
  tkFormDraw();
  tkLoad().then(() => { if (TK.form) tkFormDraw(); }).catch(() => {});
  const first = box.querySelector('[data-tk-v="action"]') || box.querySelector('button'); if (first) first.focus();
}
function tkFormDraw(focusSel) {
  const box = document.getElementById('tkF');
  if (!box || !TK.form) return;
  box.innerHTML = tkFormHtml(TK.form);
  if (focusSel) { const el = box.querySelector(focusSel); if (el) { el.focus(); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); } }
}
function tkFormClose() {
  const f = TK.form;
  TK.form = null;
  ['tkF', 'tkFBg'].forEach(id => { const el = document.getElementById(id); if (el) { el.hidden = true; if (id === 'tkF') el.innerHTML = ''; } });
  if (f && f.from && f.from.isConnected && f.from.focus) f.from.focus();
}
// the baseline, worked out at creation when the sales data is in (kept on the task: old weeks leave the store later)
function tkBaseNow(o) {
  try { return tkBase({ at: Date.now() }, tkCtx({ brand: o.brand, key: o.key, asin: o.asin })); } catch (e) { return null; }
}
async function tkFormSubmit() {
  const f = TK.form;
  if (!f) return;
  const box = document.getElementById('tkF');
  ['action', 'due', 'note'].forEach(k => { const el = box && box.querySelector(`[data-tk-v="${k}"]`); if (el) f[k] = el.value; });
  if (!String(f.action).trim()) { f.err = 'Say what to do (or pick one above).'; tkFormDraw('[data-tk-v="action"]'); return; }
  if (!f.to.email && !f.to.name) { f.err = 'Choose who it is for.'; tkFormDraw(); return; }
  const o = Object.assign({}, f.o, { action: String(f.action).trim(), pick: f.pick, to: f.to.email ? { email: f.to.email } : { name: f.to.name, x: f.to.x }, due: f.due, win: f.win, note: String(f.note || '').trim(), base: tkBaseNow(f.o) });
  const r = await tkCreate(o);
  if (r.err) { f.err = r.err; tkFormDraw(); return; }
  if (r.dup) { tkFormDraw(); return; }
  tkFormClose();
  tkToast(`Task made${tkTest() ? ' (test site: not saved)' : ''} — ${o.action}`, r.t.id);
  tkRepaint();
}
function tkToast(text, id) {
  let el = document.getElementById('tkToast');
  if (!el) { el = document.createElement('div'); el.id = 'tkToast'; el.className = 'tk-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = `${tkEsc(text)}${id ? ` <button type="button" class="tk-link" data-tk-openid="${tkEsc(id)}">Open</button>` : ''}`;
  el.hidden = false;
  clearTimeout(TK.toastT); TK.toastT = setTimeout(() => { el.hidden = true; }, 6000);
}

/* ----- the bell: "My tasks" (listing/fix-status.js draws it) ----- */
function tkSeenId() { return 'taskseen_' + tkHash(tkMe()); }
async function tkSeenLoad() {
  try { JSON.parse(localStorage.getItem('sellora.' + tkSeenId()) || '[]').forEach(k => TK.seen.add(k)); } catch (e) { /* none here */ }
  try { const s = await getDoc(doc(db, 'history', tkSeenId())); Object.keys((s.exists() && s.data().seen) || {}).forEach(k => TK.seen.add(k)); } catch (e) { /* this browser's copy */ }
}
async function tkMarkSeen(id) {
  TK.seen.add(id);
  try { localStorage.setItem('sellora.' + tkSeenId(), JSON.stringify([...TK.seen].slice(-400))); } catch (e) { /* this visit */ }
  if (tkWritable()) { try { await setDoc(doc(db, 'history', tkSeenId()), { seen: { [id]: Date.now() } }, { merge: true }); } catch (e) { /* this browser's copy */ } }
  tkRepaint();
}
/** What the bell shows me: new tasks given to me (by someone else), my overdue ones, verdicts on tasks I made — not seen yet. */
function tkBellItems(tasks, me, seen, today) {
  const out = [];
  Object.values(tasks || {}).filter(tkLive).forEach(t => {
    const w = tkWho(t), mine = !w.ext && w.email === me;
    if (mine && tkOpen(t) && t.by !== me) out.push({ id: 'new:' + t.id, t, k: 'new', text: `New task from ${tkNameOf(t.by)}: ${t.action || t.problem}` });
    if (mine && tkOverdue(t, today)) out.push({ id: 'late:' + t.id + ':' + t.due, t, k: 'late', text: `Overdue since ${tkDay(t.due)}: ${t.action || t.problem}` });
    if (t.by === me && t.verdict && t.verdict.v) out.push({ id: 'v:' + t.id, t, k: 'verdict', text: `${t.action || t.problem}: ${t.verdict.line || TK_V[t.verdict.v].join(' ')}` });
  });
  return out.filter(x => !(seen || new Set()).has(x.id));
}
const tkBellOn = () => TK.bell;
const tkBellUnseen = () => (TK.bell ? tkBellItems(TK.tasks, tkMe(), TK.seen, tkIstDay(Date.now())) : []);
/** The bell's "My tasks" section (inside #fsPanel). */
function tkBellSecHtml(solo) {
  const items = tkBellUnseen();
  const li = x => `<li class="fs-it tk-bi is-${x.k}"><div class="fs-it-h"><span class="fs-st" aria-hidden="true">${x.k === 'late' ? '🔴' : x.k === 'verdict' ? '🏁' : '🆕'}</span><b class="fs-sku tk-bn">${tkEsc(x.t.name)}</b><span class="muted">${tkBrandName(x.t.brand)}</span></div>`
    + `<div class="fs-it-i">${tkEsc(x.text)}</div><div class="fs-it-a">${tkMayOpenBoard() ? `<button type="button" class="ghost fs-b" data-tk-bell-open="${tkEsc(x.t.id)}">Open task</button>` : ''}`
    + `<button type="button" class="ghost fs-b" data-tk-seen="${tkEsc(x.id)}">Mark as seen</button></div></li>`;
  return `<div class="fs-sec tk-bsec is-open">${solo ? '' : `<div class="fs-sec-h tk-bsec-h"><span class="fs-sec-t">My tasks (${items.length})</span></div>`}`
    + `<div class="fs-sec-b">${items.length ? `<ul class="fs-list">${items.slice(0, 12).map(li).join('')}</ul>` : '<div class="fs-sec-0">✅ Nothing new on your tasks</div>'}</div></div>`;
}
const tkMayOpenBoard = () => (typeof TAB_OK === 'function' ? !!TAB_OK('atrack') : true);
/** The bell for tasks: any signed-in Sellora user; on when they have tasks (given to them or made by them). */
async function tkBellStart() {
  const me = tkMe();
  if (!me || tkTest()) { TK.bell = false; return; }
  await tkLoad(true);
  TK.bell = Object.values(TK.tasks).some(t => tkLive(t) && (t.by === me || tkWho(t).email === me));
  if (typeof fsBellDraw === 'function') fsBellDraw();
  clearInterval(TK.bellTimer);
  TK.bellTimer = setInterval(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    await tkLoad(true);
    TK.bell = Object.values(TK.tasks).some(t => tkLive(t) && (t.by === tkMe() || tkWho(t).email === tkMe()));
    tkRepaint();
  }, TK_M.bellMs);
}

/* ----- the controls ----- */
function tkStart() {
  if (TK.started || typeof document === 'undefined' || !document.addEventListener) return;
  TK.started = true;
  try { const b = localStorage.getItem('tkBrand'); if (b === 'SP' || b === 'CPC' || b === 'ALL') TK.brand = b; const w = JSON.parse(localStorage.getItem('tkWw') || 'null'); if (w && (w.days === 30 || w.days === 90)) TK.ww = { days: w.days, open: w.open !== false }; } catch (e) { /* Both, 30 days */ }
  document.addEventListener('toggle', e => { const d = e.target; if (d && d.matches && d.matches('#paneAtrack [data-tk-wwbox]')) { TK.ww.open = d.open; try { localStorage.setItem('tkWw', JSON.stringify(TK.ww)); } catch (err) { /* this visit */ } } }, true);
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', async e => {
    const on = sel => (e.target && e.target.closest ? e.target.closest(sel) : null);
    // "+ Task" on any page
    const nb = on('[data-tk-new]');
    if (nb) { e.preventDefault(); e.stopPropagation(); try { tkFormOpen(JSON.parse(nb.dataset.tkNew)); } catch (err) { /* a broken button */ } return; }
    // the form
    const f = TK.form, ff = on('#tkF [data-tk-f], #tkFBg');
    if (f && ff) {
      const a = ff.dataset.tkF || 'close', box = document.getElementById('tkF');
      ['action', 'due', 'note'].forEach(k => { const el = box && box.querySelector(`[data-tk-v="${k}"]`); if (el) f[k] = el.value; });
      if (a === 'close') return tkFormClose();
      if (a === 'open') { const id = ff.dataset.tkId; tkFormClose(); if (typeof showTab === 'function') showTab('atrack'); await tkLoad(); return tkDrawerOpen(id); }
      if (a === 'pick') { f.popen = true; return tkFormDraw('[data-tk-v="pq"]'); }
      if (a === 'adding') { f.adding = true; return tkFormDraw('[data-tk-v="newname"]'); }
      if (a === 'addname') {
        const el = box.querySelector('[data-tk-v="newname"]'), name = String(el ? el.value : '').trim().replace(/\s+/g, ' ');
        if (!name) return;
        const same = tkExtraList().find(x => x.name.toLowerCase() === name.toLowerCase());
        const id = same ? same.id : 'x' + tkHash(name + Date.now());
        if (!same) await tkNamesSave({ extra: { [id]: { name, by: tkMe(), at: Date.now() } } });
        f.to = { name, x: id }; f.popen = false; f.adding = false; f.newname = '';
        return tkFormDraw();
      }
      return undefined;
    }
    if (f && on('#tkF [data-tk-pick]')) {
      const p = on('#tkF [data-tk-pick]').dataset.tkPick, box = document.getElementById('tkF'), el = box.querySelector('[data-tk-v="action"]');
      const was = (TK_PICKS.find(x => x[0] === f.pick) || [])[1];
      f.pick = p; if (el) f.action = el.value;
      if (p !== 'other' && (!f.action || f.action === was)) f.action = (TK_PICKS.find(x => x[0] === p) || [])[1];
      return tkFormDraw('[data-tk-v="action"]');
    }
    if (f && on('#tkF [data-tk-win]')) { const box = document.getElementById('tkF'); ['action', 'due', 'note'].forEach(k => { const el = box.querySelector(`[data-tk-v="${k}"]`); if (el) f[k] = el.value; }); f.win = Number(on('#tkF [data-tk-win]').dataset.tkWin); return tkFormDraw(); }
    if (f && on('#tkF [data-tk-to]')) { f.to = { email: on('#tkF [data-tk-to]').dataset.tkTo }; f.popen = false; return tkFormDraw(); }
    if (f && on('#tkF [data-tk-tox]')) { const x = TK.dir.extra[on('#tkF [data-tk-tox]').dataset.tkTox]; if (x) f.to = { name: x.name, x: on('#tkF [data-tk-tox]').dataset.tkTox }; f.popen = false; return tkFormDraw(); }
    if (f && on('#tkF [data-tk-rmx]')) { const id = on('#tkF [data-tk-rmx]').dataset.tkRmx; const x = TK.dir.extra[id]; if (x && x.by === tkMe()) await tkNamesSave({ extra: { [id]: Object.assign({}, x, { del: Date.now() }) } }); return tkFormDraw(); }
    // the toast / the bell
    const oid = on('[data-tk-openid], [data-tk-bell-open]');
    if (oid) { const id = oid.dataset.tkOpenid || oid.dataset.tkBellOpen; if (typeof fsPanel === 'function') fsPanel(false); if (typeof showTab === 'function') showTab('atrack'); await tkLoad(); return tkDrawerOpen(id); }
    if (on('[data-tk-board]')) { if (typeof fsPanel === 'function') fsPanel(false); if (typeof showTab === 'function') showTab('atrack'); return undefined; }
    const seen = on('[data-tk-seen]');
    if (seen) { e.stopPropagation(); return tkMarkSeen(seen.dataset.tkSeen); }
    // the board
    if (!on('#paneAtrack')) return undefined;
    const lk = on('#paneAtrack [data-tk-listing]');
    if (lk) { e.stopPropagation(); return tkOpenListing(TK.tasks[lk.dataset.tkListing]); }
    if (on('#paneAtrack a.tk-lnk')) { e.stopPropagation(); return undefined; }
    const t = on('[data-tk-brand], [data-tk-chip], [data-tk-tab], [data-tk-act], [data-tk-move], [data-tk-del], [data-tk-go], [data-tk-ww], [data-tk-setwin], [data-tk-card]');
    if (!t || t.disabled) return undefined;
    if (t.dataset.tkBrand) { TK.brand = t.dataset.tkBrand; try { localStorage.setItem('tkBrand', TK.brand); } catch (err) { /* this visit */ } return tkRender(); }
    if (t.dataset.tkWw) { TK.ww.days = Number(t.dataset.tkWw); try { localStorage.setItem('tkWw', JSON.stringify(TK.ww)); } catch (err) { /* this visit */ } return tkRender(); }
    if (t.dataset.tkSetwin) { const [id, n] = t.dataset.tkSetwin.split('|'); return tkSetWin(id, n); }
    if (t.dataset.tkChip != null) { TK.chip = TK.chip === t.dataset.tkChip ? '' : t.dataset.tkChip; return tkRender(); }
    if (t.dataset.tkTab) { TK.tab = t.dataset.tkTab; return tkRender(); }
    if (t.dataset.tkMove) { const [id, to] = t.dataset.tkMove.split('|'); return tkMove(id, to); }
    if (t.dataset.tkDel) return tkDelete(t.dataset.tkDel, false);
    if (t.dataset.tkGo) {
      const [tab, a, b] = t.dataset.tkGo.split('|');
      tkDrawerClose();
      if (tab === 'salert' && typeof AL !== 'undefined') AL.brand = a;
      if (tab === 'sales' && typeof SD_CH !== 'undefined') { try { SD_CH = a; } catch (err) { /* the page's own */ } }
      if (typeof showTab === 'function') showTab(tab);
      if (tab === 'fcast' && typeof foDrawerOpen === 'function') { if (typeof FO !== 'undefined') FO.brand = b; if (typeof foLoad === 'function') await foLoad(); if (typeof foRender === 'function') foRender(); foDrawerOpen(a); }
      return undefined;
    }
    if (t.dataset.tkCard) { if (on('[data-tk-move]')) return undefined; return tkDrawerOpen(t.dataset.tkCard); }
    const act = t.dataset.tkAct;
    if (act === 'close') return tkDrawerClose();
    if (act === 'refresh') { TK.msg = ''; const p = tkLoad(true); tkRender(); await p; TK_VMEMO.clear(); return tkRender(); }
    if (act === 'undo') return tkDelete(TK.undo.id, true);
    if (act === 'csv') return tkCsvDownload();
    if (act === 'myname') {
      const me = tkMe(), now = tkNameOf(me);
      const name = typeof prompt === 'function' ? prompt('Your name on tasks', now) : null;
      if (name && name.trim()) { await tkNamesSave({ users: { [tkHash(me)]: { email: me, name: name.trim().slice(0, 60) } } }); TK.msg = 'Your name is saved.'; tkRender(); }
    }
    return undefined;
  }, true);
  document.addEventListener('submit', e => {
    const fm = e.target && e.target.closest && e.target.closest('#tkF [data-tk-form]');
    if (fm) { e.preventDefault(); tkFormSubmit(); return; }
    const cf = e.target && e.target.closest && e.target.closest('#tkDr [data-tk-cform]');
    if (cf) { e.preventDefault(); const i = cf.querySelector('[data-tk-ctext]'); tkComment(cf.dataset.tkCform, i ? i.value : ''); }
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el && el.matches && el.matches('#tkF [data-tk-v="pq"]') && TK.form) { TK.form.pq = el.value; const pos = el.selectionStart; tkFormDraw('[data-tk-v="pq"]'); const n = document.querySelector('#tkF [data-tk-v="pq"]'); if (n) n.setSelectionRange(pos, pos); }
    if (el && el.matches && el.matches('#tkPane [data-tk-q]')) { TK.q = el.value; clearTimeout(TK.qT); TK.qT = setTimeout(() => { const pos = el.selectionStart; tkRender(); const n = document.querySelector('#tkPane [data-tk-q]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 150); }
  });
  document.addEventListener('change', e => { const el = e.target; if (el && el.matches && el.matches('#tkPane [data-tk-who]')) { TK.who = el.value; tkRender(); } });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (TK.form) { e.preventDefault(); tkFormClose(); } else if (TK.dr && tkShownTab()) { e.preventDefault(); tkDrawerClose(); } }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('#tkPane [data-tk-card]')) { e.preventDefault(); tkDrawerOpen(e.target.dataset.tkCard); }
    if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('#tkF [data-tk-v="newname"]')) { e.preventDefault(); const b = document.querySelector('#tkF [data-tk-f="addname"]'); if (b) b.click(); }
  });
  // drag a card to another column (the move rules hold: only the assignee or the creator)
  document.addEventListener('dragstart', e => { const c = e.target && e.target.closest && e.target.closest('#tkPane [data-tk-card]'); if (c && e.dataTransfer) { e.dataTransfer.setData('text/plain', c.dataset.tkCard); e.dataTransfer.effectAllowed = 'move'; } });
  document.addEventListener('dragover', e => { const col = e.target && e.target.closest && e.target.closest('#tkPane [data-tk-col]'); if (col) { e.preventDefault(); col.classList.add('is-over'); } });
  document.addEventListener('dragleave', e => { const col = e.target && e.target.closest && e.target.closest('#tkPane [data-tk-col]'); if (col) col.classList.remove('is-over'); });
  document.addEventListener('drop', e => {
    const col = e.target && e.target.closest && e.target.closest('#tkPane [data-tk-col]');
    if (!col || !e.dataTransfer) return;
    e.preventDefault(); col.classList.remove('is-over');
    const id = e.dataTransfer.getData('text/plain');
    if (id && TK.tasks[id]) tkMove(id, col.dataset.tkCol);
  });
  // the bell's tasks: start for any Sellora user once their rights are read (as the Fix status bell does)
  try {
    onAuthStateChanged(auth, async user => {
      TK.bell = false; TK.seen = new Set(); TK.loaded = false; TK.tasks = {}; clearInterval(TK.bellTimer);
      if (!user) return;
      const email = String(user.email || '').toLowerCase();
      for (let i = 0; i < 144; i++) {
        if (!auth.currentUser || String(auth.currentUser.email || '').toLowerCase() !== email) return;
        if (typeof ME !== 'undefined' && ME && ME.email === email && (ME.admin || (Array.isArray(ME.tabs) && ME.tabs.length))) { tkBellStart().catch(() => {}); return; }
        await new Promise(r => setTimeout(r, i < 120 ? 250 : 5000));
      }
    });
  } catch (e) { /* no bell for tasks */ }
}

/* ----- ⬇ CSV ----- */
function tkCsvText(list) {
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Task', 'Brand', 'Product', 'SKU', 'Problem', 'What to do', 'Assigned to', 'Not on Sellora', 'Made by', 'Made (IST)', 'Due', 'Status', 'Done (IST)', 'Source', 'Checked after (days)', 'Baseline units/week', 'After units/week', 'Change %', 'Verdict', 'Verdict line'];
  const lines = [head.map(q).join(',')];
  list.forEach(t => {
    const w = tkWho(t), v = tkVerdictOf(t);
    lines.push([t.id, tkBrandName(t.brand), t.name, t.sku, t.problem, t.action, w.name, w.ext ? 'yes' : '', tkNameOf(t.by), tkWhen(t.at), t.due, TK_ST[t.status], t.doneAt ? tkWhen(t.doneAt) : '', TK_SRC[t.src] || t.src, tkWin(t),
      v.base ? Math.round(v.base.u * 10) / 10 : '', v.after ? Math.round(v.after.u * 10) / 10 : '', v.pct == null ? '' : Math.round(v.pct * 1000) / 10, v.v ? TK_V[v.v][1] : v.stage === 'early' ? 'Early check' : '', v.line || ''].map(q).join(','));
  });
  return lines.join('\r\n');
}
function tkCsvDownload() {
  const text = tkCsvText(tkShown());
  try {
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `sales-tasks_${tkIstDay(Date.now())}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { TK.msg = 'The download did not start.'; tkRender(); }
}

/* ----- the console: taskCheck('<task id or product>') — every number the verdict used ----- */
async function taskCheck(query) {
  await tkLoad();
  if (typeof foLoad === 'function') await foLoad().catch(() => {});
  const q = String(query == null ? '' : query).toLowerCase();
  const out = [];
  Object.values(TK.tasks).filter(tkLive).filter(t => !q || t.id.toLowerCase() === q || [t.name, t.sku, t.parent, t.key].join(' ').toLowerCase().includes(q)).forEach(t => {
    const ctx = tkCtx(t), v = tkVerdict(Object.assign({}, t, { verdict: null }), ctx);
    const base = v.base || tkBase(t, ctx);
    const r = { id: t.id, product: t.name, brand: tkBrandName(t.brand), problem: t.problem, action: t.action, status: TK_ST[t.status], made: tkWhen(t.at), madeWeekPT: tkSun(tkPt(t.at)),
      done: t.doneAt ? tkWhen(t.doneAt) + ' (US Pacific day ' + tkPt(t.doneAt) + ')' : null, kind: tkKind(t),
      baseline: base ? { unitsPerWeek: Math.round(base.u * 10) / 10, revenuePerWeek: Math.round(base.rev), weeksUsed: base.weeks, skippedWeeks: base.skipped, keptAtCreation: !!(t.base && t.base.u != null) } : null,
      after: v.after ? { unitsPerWeek: Math.round(v.after.u * 10) / 10, revenuePerWeek: Math.round(v.after.rev), from: v.after.from, to: v.after.to, from_: v.after.src } : null,
      change: v.pct == null ? null : tkPctTxt(v.pct), stage: v.stage, verdict: v.v ? TK_V[v.v].join(' ') : null, kept: t.verdict || null, line: v.line,
      salesAlertsStillFlags: ctx.alertOn, forecastStatus: ctx.fam ? ctx.fam.status : null };
    console.log(`%c${t.name} — ${t.problem}`, 'font-weight:bold', '\n' + r.line, r);
    if (ctx.fam && ctx.fam.s) console.table(ctx.fam.s.slice(-10).map(x => ({ week: x.wk, units: x.u, rateUsed: x.skip ? null : Math.round(x.r * 10) / 10, skipped: x.skip || '' })));
    out.push(r);
  });
  if (!out.length) console.log('No task matches "' + query + '".');
  return out;
}
if (typeof window !== 'undefined') window.taskCheck = taskCheck;
