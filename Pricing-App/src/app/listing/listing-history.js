/* ================= LISTING · LISTING HISTORY: every change Sellora sent to Amazon (#10 stage 5) =================
 * Screens: Listing → Listing History (tab 'lhist', #paneLhist). Like Amazon Ads' "Change history".
 * Does: reads the send log the ONE send path writes (listing-send-check.js, lhistAdd) — the existing /history collection, documents
 *       history/listing_<date>_<run>-<n>, kind "listing" — and lists it newest first: one row = one field of one listing — date and time ·
 *       who (the name from the e-mail, never the e-mail) · the listing (name · SKU · ASIN · Open listing) · what changed · the change (only
 *       the words that change, "› Show full text") · from which screen · approved by · Amazon's answer. A Fix all is one group row
 *       ("Fix all · Christmas · 14 children · ✅ 13 ❌ 1") that opens to its rows. ⏳ rows: [Check again] (the listing read again). Every row:
 *       [Put back] — the OLD value through sqSendWithCheck (the Amazon check popup → approve), never directly; it is logged as its own row.
 *       Filters: when (today / this week / this month / everything / from–to), who, what changed, from screen, result, a search on SKU,
 *       ASIN or name; "Results: N"; 50 per page; Download (CSV for Excel, the full before and after).
 * Who sees it: the menu entry is for Listing users — Listing Health (TAB_INHERIT in nav.js) and, here, Image Manager, Listing Errors and
 *       Listing Rules too. The data is guarded by the /history rule (canAny) — see the report for the one line that would narrow it.
 * Main functions: lhLoad, lhFiltered, lhItems, lhDraw, lhCheckAgain, lhPutBack, lhCsv, lhMenuAccess. */

const LH_PER = 50;                                         // items (a group counts once) per page
const LH_DOCS = 800;                                       // log documents read, newest day first (each up to 200 rows: 160 000 rows)
const LH_LISTING_TABS = ['img', 'lerr', 'health', 'lrules'];
// The screen a change came from, in the words people know it by.
const LH_SCREEN = { 'Season planner': 'Season planner', 'Listing Errors': 'Listing Errors', 'Listing Content upload': 'Content upload', 'Listing Health': 'Workspace',
  'Listing Health · Put back': 'Workspace · Put back', 'Image Manager': 'Image Manager', 'Image Manager · paste': 'Image Manager · paste', 'Listing History · Put back': 'Listing History · Put back' };
const LH_RESULT = { accepted: '✅ Accepted', rejected: '❌ Rejected', working: '⏳ Amazon working', notsent: 'Test site — not sent', sent: '⏳ Amazon working' };
let LH = { rows: null, loading: false, err: '', built: false, page: 0, open: new Set(), busy: new Set(),
  f: { range: 'week', from: '', to: '', user: '', what: '', screen: '', result: '', q: '' } };
const lhEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const lhNf = n => Number(n || 0).toLocaleString('en-US');

/* ----- reading the log ----- */
// Every listing log row, newest first: the documents whose day field is set (the log's own), newest day first; each row knows its document.
async function lhLoad(force) {
  if (LH.loading || (LH.rows && !force)) return LH.rows;
  LH.loading = true;
  LH.err = '';
  lhDraw();
  try {
    const snap = await getDocs(query(collection(db, 'history'), orderBy('day', 'desc'), limit(LH_DOCS)));
    const rows = [];
    snap.forEach(d => {
      const data = d.data() || {};
      if (!/^listing_/.test(d.id) || data.kind !== 'listing') return;
      Object.values(data.rows || {}).forEach(row => { if (row && row.kind === 'listing') rows.push(Object.assign({}, row, { doc: d.id })); });
    });
    LH.rows = rows.sort((a, b) => (b.at - a.at) || String(a.id).localeCompare(String(b.id)));
  } catch (e) {
    LH.rows = LH.rows || [];
    LH.err = String((e && e.message) || e);
  }
  LH.loading = false;
  lhBuild(true);
  lhDraw();
  return LH.rows;
}

/* ----- the words ----- */
// What changed: Title / Item Highlights / Hidden search words / Bullets / Description / Pictures / Spec: <name>.
function lhWhat(row) {
  const f = String(row.field || '');
  if (row.pic || /^(main picture|picture \d|swatch)$/i.test(f)) return 'Pictures';
  if (/^(title|item highlights|hidden search words|description)$/i.test(f)) return f.charAt(0).toUpperCase() + f.slice(1);
  if (/^bullet/i.test(f)) return f.replace(/^bullets?/i, 'Bullet').replace(/^Bullet$/, 'Bullets');
  if (/search terms?/i.test(f)) return 'Hidden search words';
  return 'Spec: ' + f;
}
// From which screen: the screen's name, "· Fix all" when it sent several listings at once.
const lhScreen = row => (LH_SCREEN[row.screen] || row.screen || '—') + (row.runN > 1 && !/Put back|paste/.test(row.screen || '') ? ' · Fix all' : '');
// Amazon's answer, with the reason for a rejected one.
const lhResultText = row => (LH_RESULT[row.result] || row.result || '') + (row.result === 'rejected' && row.why ? ': ' + row.why : '');

/* ----- the filters ----- */
// The time span of a date choice: [from, to] in ms (to excluded); today / this week (from Monday) / this month / everything / from–to.
function lhRange(f, now) {
  const d = new Date(now);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (f.range === 'today') return [day, Infinity];
  if (f.range === 'week') return [day - ((d.getDay() + 6) % 7) * 86400000, Infinity];
  if (f.range === 'month') return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), Infinity];
  if (f.range === 'custom') {
    const a = f.from ? new Date(f.from + 'T00:00:00').getTime() : -Infinity;
    const b = f.to ? new Date(f.to + 'T00:00:00').getTime() + 86400000 : Infinity;
    return [a, b];
  }
  return [-Infinity, Infinity];
}
// The rows the filters keep (each row on its own; a group is drawn from the rows it keeps).
function lhFiltered(rows, f, now) {
  const [from, to] = lhRange(f, now || Date.now());
  const q = String(f.q || '').trim().toLowerCase();
  return (rows || []).filter(row => row.at >= from && row.at < to
    && (!f.user || row.name === f.user) && (!f.what || lhWhat(row) === f.what) && (!f.screen || (LH_SCREEN[row.screen] || row.screen) === f.screen)
    && (!f.result || row.result === f.result || (f.result === 'working' && row.result === 'sent'))
    && (!q || [row.sku, row.asin, row.label].join(' ').toLowerCase().includes(q)));
}
// The page's items, newest first: a row, or a group — the rows of ONE Fix all (one run that sent several listings).
function lhItems(rows) {
  const out = [];
  const groups = new Map();
  rows.forEach(row => {
    if (!(row.runN > 1) || !row.run) return out.push({ kind: 'row', row, at: row.at });
    const key = row.run + '|' + row.screen + '|' + (row.name || '');   // the name, never the e-mail: the key is in the page
    let g = groups.get(key);
    if (!g) { g = { kind: 'group', key, rows: [], at: row.at }; groups.set(key, g); out.push(g); }
    g.rows.push(row);
    g.at = Math.max(g.at, row.at);
  });
  return out.sort((a, b) => b.at - a.at);
}
// A group's line: "Fix all · Christmas · 14 children · ✅ 13 ❌ 1" — each listing counted once, by its worst answer.
function lhGroupLine(g) {
  const by = new Map();
  const rank = { rejected: 3, working: 2, sent: 2, notsent: 1, accepted: 0 };
  g.rows.forEach(row => { const k = row.brand + '|' + row.sku; if (!by.has(k) || rank[row.result] > rank[by.get(k)]) by.set(k, row.result); });
  const n = s => [...by.values()].filter(v => v === s || (s === 'working' && v === 'sent')).length;
  const r0 = g.rows[0];
  const title = String(r0.runTitle || '').replace(/^Fix all:\s*/, '').replace(/^Season planner · /, '') || (LH_SCREEN[r0.screen] || r0.screen);
  return `Fix all · ${title} · ${lhNf(by.size)} ${by.size === 1 ? 'child' : 'children'} · ✅ ${lhNf(n('accepted'))} ❌ ${lhNf(n('rejected'))}${n('working') ? ` ⏳ ${lhNf(n('working'))}` : ''}${n('notsent') ? ` · ${lhNf(n('notsent'))} not sent` : ''}`;
}

/* ----- the page ----- */
// The shell, once (the filters keep their focus while the list redraws); the choices of the dropdowns come from the rows.
function lhBuild(force) {
  const box = $('lhPane');
  if (!box || (LH.built && !force)) return;
  const rows = LH.rows || [];
  const opts = (key, all, list) => `<select data-lh-f="${key}" aria-label="${all}"><option value="">${all}</option>${list.map(v => `<option value="${lhEsc(v)}"${LH.f[key] === v ? ' selected' : ''}>${lhEsc(v)}</option>`).join('')}</select>`;
  const uniq = fn => [...new Set(rows.map(fn).filter(Boolean))].sort();
  const seg = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'Everything'], ['custom', 'From – to']]
    .map(([v, t]) => `<button type="button" class="segbtn${LH.f.range === v ? ' on' : ''}" data-lh="range" data-lh-v="${v}" aria-pressed="${LH.f.range === v}">${t}</button>`).join('');
  box.innerHTML = `<div class="card lh-tb"><div class="toolbar"><div class="seg" role="group" aria-label="When">${seg}</div>`
    + `<span class="lh-custom${LH.f.range === 'custom' ? '' : ' hide'}"><input type="date" data-lh-f="from" value="${lhEsc(LH.f.from)}" aria-label="From"> – <input type="date" data-lh-f="to" value="${lhEsc(LH.f.to)}" aria-label="To"></span>`
    + opts('user', 'Everyone', uniq(r => r.name)) + opts('what', 'Any change', uniq(lhWhat)) + opts('screen', 'Any screen', uniq(r => LH_SCREEN[r.screen] || r.screen))
    + `<select data-lh-f="result" aria-label="Result"><option value="">Any result</option>${[['accepted', '✅ Accepted'], ['rejected', '❌ Rejected'], ['working', '⏳ Amazon working'], ['notsent', 'Test site — not sent']].map(([v, t]) => `<option value="${v}"${LH.f.result === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`
    + `<input type="search" data-lh-f="q" value="${lhEsc(LH.f.q)}" placeholder="Search SKU, ASIN or name" aria-label="Search">`
    + '<span style="flex:1"></span><button type="button" class="ghost" data-lh="reload">Refresh</button><button type="button" class="ghost" data-lh="download">Download (CSV)</button></div>'
    + '<div class="lh-count muted" id="lhCount"></div></div><div id="lhList"></div>';
  LH.built = true;
}
// The list: "Results: N", the page of items, the pager. Only this part redraws.
function lhDraw() {
  const list = $('lhList');
  if (!list) return;
  const count = $('lhCount');
  if (LH.loading && !LH.rows) { list.innerHTML = '<div class="card lh-empty muted">Reading the history…</div>'; return; }
  if (LH.err && !(LH.rows || []).length) { list.innerHTML = `<div class="card lh-empty err">Could not read the history: ${lhEsc(LH.err)}</div>`; if (count) count.textContent = ''; return; }
  if (!(LH.rows || []).length) {
    if (count) count.textContent = 'Results: 0';
    list.innerHTML = '<div class="card lh-empty"><b>No changes yet</b> — on live Sellora every send to Amazon appears here.</div>';
    return;
  }
  const rows = lhFiltered(LH.rows, LH.f);
  const items = lhItems(rows);
  const pages = Math.max(1, Math.ceil(items.length / LH_PER));
  if (LH.page >= pages) LH.page = pages - 1;
  const page = items.slice(LH.page * LH_PER, (LH.page + 1) * LH_PER);
  if (count) count.textContent = `Results: ${lhNf(rows.length)}${items.length !== rows.length ? ` (${lhNf(items.length)} lines, a Fix all is one)` : ''}`;
  const pager = pages > 1 ? `<div class="lh-pager"><button type="button" class="ghost" data-lh="page" data-lh-v="-1"${LH.page ? '' : ' disabled'}>◀ Newer</button><span class="muted">Page ${lhNf(LH.page + 1)} of ${lhNf(pages)}</span>`
    + `<button type="button" class="ghost" data-lh="page" data-lh-v="1"${LH.page < pages - 1 ? '' : ' disabled'}>Older ▶</button></div>` : '';
  const head = '<thead><tr><th>Date and time</th><th>User</th><th>Listing</th><th>What changed</th><th>Change</th><th>From screen</th><th>Approved by</th><th>Result</th><th></th></tr></thead>';
  const body = page.map(it => (it.kind === 'row' ? lhRowHtml(it.row, false) : lhGroupHtml(it))).join('');
  list.innerHTML = rows.length ? `<div class="card xlwrap lh-wrap"><table class="xl lh-tbl">${head}<tbody>${body}</tbody></table></div>${pager}`
    : '<div class="card lh-empty muted">Nothing matches these filters.</div>';
}
const lhWhen = at => new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
// One row: one field of one listing.
function lhRowHtml(row, child) {
  const asin = row.asin ? `<a href="https://www.amazon.com/dp/${lhEsc(row.asin)}" target="_blank" rel="noopener">Open listing ↗</a>` : '';
  const change = typeof sqChangeLine === 'function' ? sqChangeLine({ field: '', old: row.old, new: row.new, pic: row.pic }) : lhEsc(row.old) + ' → ' + lhEsc(row.new);
  const busy = LH.busy.has(row.id);
  const canBack = row.oldV != null && row.attr && (row.api === 'limg' || row.pt) && row.result !== 'notsent';
  const acts = (row.result === 'working' || row.result === 'sent' ? `<button type="button" class="ghost lh-b" data-lh="again" data-lh-id="${lhEsc(row.id)}"${busy ? ' disabled' : ''}>${busy ? 'Reading…' : 'Check again'}</button>` : '')
    + `<button type="button" class="ghost lh-b" data-lh="back" data-lh-id="${lhEsc(row.id)}"${canBack ? '' : ' disabled title="The old value was not kept for this change"'}>Put back</button>`;
  return `<tr class="lh-row${child ? ' is-child' : ''} is-${lhEsc(row.result)}" data-lh-row="${lhEsc(row.id)}"><td class="lh-when">${lhWhen(row.at)}</td><td>${lhEsc(row.name)}</td>`
    + `<td class="lh-listing"><b>${lhEsc(row.label || row.sku)}</b><small>${lhEsc(row.sku)}${row.asin ? ' · ' + lhEsc(row.asin) : ''}</small>${asin}</td>`
    + `<td>${lhEsc(lhWhat(row))}</td><td class="lh-change">${change}</td><td>${lhEsc(lhScreen(row))}</td><td>${lhEsc(row.approvedBy || row.name)}</td>`
    + `<td class="lh-result">${lhEsc(lhResultText(row))}</td><td class="lh-acts">${acts}</td></tr>`;
}
// A Fix all: one line that opens to its rows.
function lhGroupHtml(g) {
  const open = LH.open.has(g.key);
  const r0 = g.rows[0];
  return `<tr class="lh-group" data-lh="group" data-lh-v="${lhEsc(g.key)}" tabindex="0" aria-expanded="${open}"><td class="lh-when">${lhWhen(g.at)}</td><td>${lhEsc(r0.name)}</td>`
    + `<td colspan="5"><b>${open ? '▾' : '▸'} ${lhEsc(lhGroupLine(g))}</b> <small class="muted">${lhNf(g.rows.length)} change${g.rows.length === 1 ? '' : 's'} · ${lhEsc(LH_SCREEN[r0.screen] || r0.screen)}</small></td>`
    + `<td colspan="2"></td></tr>` + (open ? g.rows.map(row => lhRowHtml(row, true)).join('') : '');
}

/* ----- Download: every row the filters keep, the full before and after (CSV, Excel opens it) ----- */
const LH_CSV_COLS = ['Date', 'Time', 'User', 'Brand', 'SKU', 'ASIN', 'Listing', 'What changed', 'From', 'To', 'From screen', 'Approved by', 'Result', 'Reason'];
function lhCsv(rows) {
  const q = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const two = n => String(n).padStart(2, '0');
  const line = row => { const d = new Date(row.at); return [`${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`, `${two(d.getHours())}:${two(d.getMinutes())}`, row.name, row.brand, row.sku, row.asin,
    row.label, lhWhat(row), row.old, row.new, lhScreen(row), row.approvedBy || row.name, LH_RESULT[row.result] || row.result, row.why || ''].map(q).join(','); };
  return '﻿' + [LH_CSV_COLS.join(',')].concat(rows.map(line)).join('\r\n') + '\r\n';
}
function lhDownload() {
  const rows = lhFiltered(LH.rows || [], LH.f);
  const text = lhCsv(rows);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = `Sellora-listing-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return { rows: rows.length, text };
}

/* ----- Check again and Put back ----- */
// ⏳ Check again: the listing read again — accepted when it holds the new value, rejected on an ERROR on that field, else still working;
// the row is updated in its own log document (merged in).
async function lhCheckAgain(id) {
  const row = (LH.rows || []).find(r => r.id === id);
  if (!row || LH.busy.has(id)) return null;
  LH.busy.add(id);
  lhDraw();
  try {
    const pic = row.api === 'limg';
    const reply = await baCall(pic ? { limg: 'get', brand: row.brand, sku: row.sku } : { lfix: 'get', brand: row.brand, sku: row.sku });
    const err = ((reply && reply.issues) || []).find(issue => /ERROR|^E$/i.test(String(issue.severity || issue.s || '')) && (issue.attrs || issue.a || []).includes(row.attr));
    const now = pic ? String(((reply && reply.listing) || {})[row.attr] || '') : (typeof sqValText === 'function' ? sqValText(((reply && reply.attributes) || {})[row.attr]) : '');
    const want = String(row.new || '');
    const same = pic ? now === want : (want.endsWith('…') ? now.startsWith(want.slice(0, -1)) : now === want) || (want === '(removed)' && !now);
    row.result = err ? 'rejected' : same ? 'accepted' : 'working';
    row.why = err ? String(err.message || err.m || '') : '';
    const copy = Object.assign({}, row);
    delete copy.doc;
    await setDoc(doc(db, 'history', row.doc), { rows: { [row.id]: copy } }, { merge: true });
  } catch (e) {
    row.note = String((e && e.message) || e);
  }
  LH.busy.delete(id);
  lhDraw();
  return row.result;
}
// Put back: the OLD value through THE ONE SEND PATH (the Amazon check popup → approve → sent → read again), logged as its own row.
function lhPutBack(id) {
  const row = (LH.rows || []).find(r => r.id === id);
  if (!row || row.oldV == null || !row.attr || typeof sqSendWithCheck !== 'function') return null;
  const pic = row.api === 'limg';
  const body = pic ? { limg: 'patch', brand: row.brand, sku: row.sku, productType: row.pt, set: { [row.attr]: row.oldV || '' } }
    : { lfix: 'patch', brand: row.brand, sku: row.sku, productType: row.pt,
      patches: [Array.isArray(row.oldV) && row.oldV.length ? { op: 'replace', path: '/attributes/' + row.attr, value: row.oldV } : { op: 'delete', path: '/attributes/' + row.attr }] };
  return sqSendWithCheck([{ brand: row.brand, sku: row.sku, asin: row.asin, label: row.label || row.sku, body,
    changes: [{ field: row.field, old: row.new, new: row.old || '(removed)', pic: row.pic, attr: row.attr, oldV: null }] }], {
    screen: 'Listing History · Put back', title: 'Put back: ' + (row.label || row.sku),
    onDone: sum => { if (sum.step === 'done') lhLoad(true); } });
}

/* ----- the events ----- */
function lhClick(el) {
  const act = el.dataset.lh;
  const v = el.dataset.lhV;
  if (act === 'range') { LH.f.range = v; LH.page = 0; lhBuild(true); return lhDraw(); }
  if (act === 'page') { LH.page = Math.max(0, LH.page + Number(v)); lhDraw(); const top = $('lhList'); if (top && top.scrollIntoView) top.scrollIntoView({ block: 'start' }); return; }
  if (act === 'group') { if (LH.open.has(v)) LH.open.delete(v); else LH.open.add(v); return lhDraw(); }
  if (act === 'again') return lhCheckAgain(el.dataset.lhId);
  if (act === 'back') return lhPutBack(el.dataset.lhId);
  if (act === 'download') return lhDownload();
  if (act === 'reload') return lhLoad(true);
}
// A filter changed: the list redraws from page 1 (the search a moment after typing stops).
let LH_T = 0;
function lhFilter(el) {
  LH.f[el.dataset.lhF] = el.value;
  LH.page = 0;
  clearTimeout(LH_T);
  if (el.dataset.lhF === 'q') LH_T = setTimeout(lhDraw, 200);
  else lhDraw();
}
// Opening the page: build it and read the log (once; Refresh reads it again).
function lhOpen() {
  lhBuild(false);
  lhDraw();
  lhLoad(false);
}
/* The menu entry is for Listing users. Core gives it to Listing Health (TAB_INHERIT lhist: 'health' in nav.js); Image Manager, Listing Errors
 * and Listing Rules get it here — the button shows whenever the signed-in account holds one of those (Core's own hide is undone only then). */
function lhMenuAccess() {
  const btn = $('tabLhist');
  if (!btn || typeof ME === 'undefined' || !ME || !Array.isArray(ME.tabs)) return false;
  const ok = !!ME.admin || LH_LISTING_TABS.some(t => ME.tabs.includes(t));
  if (ok && btn.classList.contains('hide')) btn.classList.remove('hide');
  return ok;
}
if (typeof document !== 'undefined' && document.addEventListener && $('lhPane')) {
  $('lhPane').addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-lh]') : null;
    if (el && !el.disabled) lhClick(el);
  });
  $('lhPane').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.dataset && e.target.dataset.lh === 'group') { e.preventDefault(); lhClick(e.target); } });
  $('lhPane').addEventListener('change', e => { if (e.target && e.target.dataset && e.target.dataset.lhF) lhFilter(e.target); });
  $('lhPane').addEventListener('input', e => { if (e.target && e.target.dataset && e.target.dataset.lhF === 'q') lhFilter(e.target); });
  const pane = $('paneLhist');
  if (pane && typeof MutationObserver === 'function') new MutationObserver(() => { if (!pane.classList.contains('hide')) lhOpen(); }).observe(pane, { attributes: true, attributeFilter: ['class'] });
  const tab = $('tabLhist');
  if (tab && typeof MutationObserver === 'function') new MutationObserver(lhMenuAccess).observe(tab, { attributes: true, attributeFilter: ['class'] });
}
