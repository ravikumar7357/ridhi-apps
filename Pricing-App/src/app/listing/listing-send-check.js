/* ================= LISTING · SEND WITH AMAZON'S CHECK (#10, "Safe SP-API Approval & Verification Loop", small version) =================
 * The ONE path every listing change in Sellora goes to Amazon by — the Season planner's Fix / Fix all / Fix all seasons, Listing Errors'
 * Apply, Listing Content's upload Apply all, Listing Health's Workspace Fix all / Put back, and the Image Manager's Apply and paste.
 * No new screen: the existing confirm window (#spModal) becomes the "Amazon check" popup, in the same look.
 *   1 Checking with Amazon… — POST lfix=patch / limg=patch with apply:false (Amazon's VALIDATION_PREVIEW: nothing changes on Amazon)
 *   2 Amazon's answer — one listing: "✓ Amazon will accept" + before → after [Approve & send] [Cancel], or "✗ Amazon says no: <reason in
 *     plain words>" + how to fix [Edit] [Close]; several: "138 Amazon will accept · 6 Amazon says no" [Approve & send 138] [Cancel], the 6
 *     listed with their reason (the list scrolls inside the popup)
 *   3 Approve & send — the same POST with apply:true (the backend checks again first), one listing at a time, with a progress bar
 *   4 the listing is read again (?lfix=get through the Workspace's read, or ?limg=get) — ✅ Amazon accepted / ❌ Amazon rejected: <reason> /
 *     ⏳ Amazon is still working [Check again]; for several "✅ 136 accepted · ❌ 2 rejected (reasons) · ⏳ 0"
 *   5 Close — the caller redraws its own screen (onDone), as it did before.
 * The test site sends NOTHING: its guard blocks every backend POST, so Amazon's check cannot run there and the popup says so; Approve says
 * "Test site — not sent to Amazon".
 * Every send (accepted or rejected) is written down by ONE function, lhistAdd: date, who (the name from the signed-in e-mail), the listing
 * (SKU, ASIN), the field, old → new, the screen and the result — in the existing /history collection (its rule lets every listing user
 * write: Listing Health, Listing Rules, Image Manager, Listing Errors), as documents of their own, kind "listing":
 * history/listing_<YYYY-MM-DD>_<run>-<n>, at most SQ_LOG_ROWS rows each (a Fix all of 246 listings is a few small documents, never near
 * Firestore's 1 MB). A run writes only its own documents, so two people sending at once never overwrite each other. The Listing History
 * page reads them later.
 * No backend change: the existing POST lfix=patch / limg=patch (imPost) and ?lfix=get / ?limg=get.
 * Main functions: sqSendWithCheck (the one entry point), sqPost, sqCheckAll, sqApprove, sqVerify, sqClose, sqPlain, sqHow, lhistAdd. */

const SQ_LOG_COLL = 'history';      // the existing collection every listing user may write (firestore.rules: canAny())
const SQ_LOG_ROWS = 200;            // rows per log document: ~1 KB a row at most (values cut at SQ_CUT) → ~200 KB, far under 1 MB
const SQ_CUT = 300;                 // a value kept in the log is cut here
let SQ = { run: null };             // the popup's run: { jobs, opts, step: check|review|send|verify|done|test, done, total, cancel, resolve }

/* ----- small helpers ----- */
const sqEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const sqNf = n => Number(n || 0).toLocaleString('en-US');
const sqIsTest = () => typeof window !== 'undefined' && !!window.__TEST_ERP;
const sqBy = () => (typeof ME !== 'undefined' && ME && ME.email) || '';
// The name a person is known by, from the signed-in e-mail: "vishesh.g@…" → "Vishesh G".
const sqName = email => String(email || '').split('@')[0].split(/[._-]+/).filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const sqCut = (t, n) => { const s = String(t == null ? '' : t); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
// A field in words: the attribute or picture slot a change touches.
const SQ_FIELD = { item_name: 'Title', generic_keyword: 'Hidden search words', title_differentiation: 'Item Highlights', bullet_point: 'Bullets', product_description: 'Description',
  MAIN: 'Main picture', SWCH: 'Swatch' };
const sqField = key => SQ_FIELD[key] || (/^PT0(\d)$/.test(key) ? 'Picture ' + key.slice(3) : String(key || '').replace(/_/g, ' '));
// An attribute's values in words: every value, joined.
function sqValText(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return v.map(sqValText).filter(Boolean).join(' · ');
  if (v.value != null) return sqValText(v.value);
  return Object.keys(v).filter(k => k !== 'marketplace_id' && k !== 'language_tag').map(k => sqValText(v[k])).filter(Boolean).join(' ');
}

/* ----- Amazon's answer in plain words ----- */
// The first ERROR Amazon gave (the backend's error, else the first ERROR issue).
function sqRaw(reply) {
  const errs = ((reply && reply.issues) || []).filter(issue => String(issue.severity || '').toUpperCase() === 'ERROR').map(issue => issue.message);
  return String((reply && reply.error) || errs[0] || 'Amazon did not accept it').replace(/^Amazon would reject this:\s*/i, '');
}
// "Value too long — max 125", "A value Amazon does not accept", … — Amazon's words when no plain ones are known.
function sqPlain(text) {
  const t = String(text || '');
  const max = t.match(/(\d+)\s*(?:characters|bytes)\s*or\s*(?:less|fewer)/i) || t.match(/max(?:imum)?(?:\s*length)?(?:\s*of)?\s*(\d+)/i);
  if (max || /too long|exceeds the maximum/i.test(t)) return 'Value too long' + (max ? ` — max ${max[1]}` : '');
  if (/not a valid value|approved value|is not one of|enumerat/i.test(t)) return 'A value Amazon does not accept';
  if (/different from what's already in the Amazon catalog/i.test(t)) return "Amazon's catalogue holds a different value, so Amazon keeps its own";
  if (/required/i.test(t)) return 'A value Amazon needs is missing';
  if (/Saving is off|TEST ERP/i.test(t)) return 'Test site — not sent to Amazon';
  return sqCut(t, 220);
}
// How to fix it, in one line.
function sqHow(text) {
  const t = String(text || '');
  const max = t.match(/(\d+)\s*(?:characters|bytes)\s*or\s*(?:less|fewer)/i) || t.match(/max(?:imum)?(?:\s*length)?(?:\s*of)?\s*(\d+)/i);
  if (max || /too long/i.test(t)) return `Shorten it${max ? ` to ${max[1]} or less` : ''}, then send again.`;
  if (/not a valid value|approved value|is not one of|enumerat/i.test(t)) return 'Pick one of the values Amazon allows (Listing Errors shows them), then send again.';
  if (/different from what's already in the Amazon catalog/i.test(t)) return 'Ask Seller Support to update the catalogue, or leave it as it is.';
  return 'Open the listing in Listing Errors and do what Amazon asks.';
}

/* ----- the one call to the backend (the existing Listing Errors / Image Manager path) ----- */
// apply false = Amazon's check only (VALIDATION_PREVIEW); true = the real change (the backend checks again first).
async function sqPost(job, apply) {
  try {
    return await imPost(Object.assign({}, job.body, { apply: !!apply, by: sqBy() }));
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
// The changes a job makes, in words: [{ field, old, new }] — the caller's own, else read from its patches / picture slots.
function sqChanges(job) {
  if (job.changes && job.changes.length) return job.changes;
  const b = job.body || {};
  if (b.set) return Object.keys(b.set).map(slot => ({ field: sqField(slot), old: 'a picture', new: b.set[slot] || '(removed)', pic: true }));
  return (b.patches || []).map(p => ({ field: sqField(String(p.path || '').replace('/attributes/', '')), old: '', new: p.op === 'delete' ? '(removed)' : sqValText(p.value) }));
}

/**
 * THE ONE ENTRY POINT. `jobs`: [{ brand, sku, asin, label, body: { lfix: 'patch' | limg: 'patch', brand, sku, productType, patches | set },
 * changes: [{ field, old, new }] }]. `opts`: { screen (for the log), title, held: [{ sku, why }] (named, never sent), onSent(job, reply),
 * onEdit(job), onDone(summary) }. Opens the popup and runs Amazon's check; the rest follows the person's clicks. Returns a promise of the
 * summary when the popup closes: { test, sent, accepted, rejected, working, no, jobs }.
 */
function sqSendWithCheck(jobs, opts) {
  if (SQ.run && !SQ.run.closed) sqClose();
  const run = { jobs: jobs.map(job => Object.assign({ state: 'checking', why: '', how: '' }, job)), opts: opts || {}, step: 'check', done: 0, total: jobs.length, test: sqIsTest(), at: Date.now() };
  SQ.run = run;
  SQ.screens = (SQ.screens || []).concat([run.opts.screen || '']).slice(-50);   // which screens sent through here (the tests read it)
  run.promise = new Promise(resolve => { run.resolve = resolve; });
  run.checked = sqCheckAll(run);
  return run.promise;
}
// 1 → 2: Amazon's check of every change, one by one (nothing changes on Amazon). The test site cannot ask (its guard blocks every POST).
async function sqCheckAll(run) {
  sqDraw();
  for (const job of run.jobs) {
    if (run.cancel || SQ.run !== run) return;
    if (run.test) {
      job.state = 'test';
      job.why = "Amazon's check cannot run on the test site";
    } else {
      const reply = await sqPost(job, false);
      job.state = reply.ok ? 'ok' : 'no';
      job.raw = reply.ok ? '' : sqRaw(reply);
      job.why = reply.ok ? '' : sqPlain(job.raw);
      job.how = reply.ok ? '' : sqHow(job.raw);
    }
    run.done++;
    sqDraw();
  }
  run.step = 'review';
  sqDraw();
}
// 3: Approve & send the ones Amazon will accept; then 4: read each one again.
async function sqApprove() {
  const run = SQ.run;
  if (!run || run.step !== 'review') return;
  if (run.test) {
    run.jobs.forEach(job => { if (job.state === 'test') job.state = 'notsent'; });
    run.step = 'test';
    return sqDraw();
  }
  const go = run.jobs.filter(job => job.state === 'ok');
  if (!go.length) return;
  run.step = 'send';
  run.done = 0;
  run.total = go.length;
  sqDraw();
  for (const job of go) {
    const reply = await sqPost(job, true);
    if (reply.ok && !reply.previewOnly) {
      job.state = 'sent';
      job.sub = reply.submissionId || '';
      job.sentAt = Date.now();
      if (typeof run.opts.onSent === 'function') { try { run.opts.onSent(job, reply); } catch (e) { job.note = String((e && e.message) || e); } }
    } else {
      job.state = 'rejected';
      job.raw = sqRaw(reply);
      job.why = sqPlain(job.raw);
      job.how = sqHow(job.raw);
    }
    run.done++;
    sqDraw();
  }
  run.step = 'verify';
  run.done = 0;
  run.total = go.filter(job => job.state === 'sent').length;
  sqDraw();
  await sqVerifyAll(run, go.filter(job => job.state === 'sent'));
  // every send, accepted or rejected, is written down once
  run.logErr = await lhistAdd(go.flatMap(job => sqLogRows(job, run)), run);
  run.step = 'done';
  sqDraw();
}
// 4: read the listings again and say what Amazon did with each: accepted (it holds what was sent), rejected (an ERROR on a field we
// changed), or still working (neither yet).
async function sqVerifyAll(run, jobs) {
  for (const job of jobs) {
    try { await sqVerify(job); } catch (e) { job.state = 'working'; job.note = String((e && e.message) || e); }
    run.done++;
    sqDraw();
  }
  // the Workspace's own copies follow (title and search words), so every screen shows the new values when the popup closes
  const lfix = jobs.filter(job => job.body.lfix);
  if (typeof liWsQueue === 'function' && typeof LI_WS_BATCH !== 'undefined') {
    ['SP', 'CPC'].forEach(brand => {
      const list = lfix.filter(job => job.brand === brand);
      for (let i = 0; i < list.length; i += LI_WS_BATCH) liWsQueue({ t: 'content', brand, skus: list.slice(i, i + LI_WS_BATCH).map(job => job.sku), units: 0, pk: '' });
    });
  }
}
// One listing read again. Listing changes: ?lfix=get (through the Workspace's read when it is there, so its copy is updated too);
// pictures: ?limg=get (the listing's own slots).
async function sqVerify(job) {
  const b = job.body;
  let reply;
  if (b.limg) reply = await baCall({ limg: 'get', brand: job.brand, sku: job.sku });
  else if (typeof liWsJob === 'function' && typeof LI_WS !== 'undefined') {
    const j = { t: 'get', brand: job.brand, sku: job.sku, units: 0, pk: '' };
    await liWsJob(j);
    reply = j.reply || {};
    LI_WS.liveV++;
    if (typeof liWsStoreSave === 'function') liWsStoreSave();
  } else reply = await baCall({ lfix: 'get', brand: job.brand, sku: job.sku });
  const names = b.limg ? Object.keys(b.set || {}) : (b.patches || []).map(p => String(p.path || '').replace('/attributes/', ''));
  const err = ((reply && reply.issues) || []).find(issue => /ERROR|^E$/i.test(String(issue.severity || issue.s || ''))
    && (b.limg ? /image|media|MAIN|PT0|SWCH/i.test(String(issue.message || '') + ' ' + (issue.attrs || []).join(' ')) : (issue.attrs || []).some(a => names.includes(a))));
  if (err) {
    job.state = 'rejected';
    job.raw = String(err.message || '');
    job.why = sqPlain(job.raw);
    job.how = sqHow(job.raw);
    return job.state;
  }
  let same;
  if (b.limg) same = names.every(slot => String(((reply && reply.listing) || {})[slot] || '') === String(b.set[slot] || ''));
  else {
    const at = (reply && reply.attributes) || {};
    const canon = v => JSON.stringify(sqValText(v));
    same = (b.patches || []).every(p => {
      const name = String(p.path || '').replace('/attributes/', '');
      return p.op === 'delete' ? !(at[name] && at[name].length) : canon(at[name]) === canon(p.value);
    });
  }
  job.state = same ? 'accepted' : 'working';
  return job.state;
}
// "Check again": the ones still working, read once more (and their log rows updated).
async function sqCheckAgain() {
  const run = SQ.run;
  if (!run || run.step !== 'done') return;
  const again = run.jobs.filter(job => job.state === 'working');
  if (!again.length) return;
  run.step = 'verify';
  run.done = 0;
  run.total = again.length;
  sqDraw();
  await sqVerifyAll(run, again);
  run.logErr = await lhistAdd(again.flatMap(job => sqLogRows(job, run)), run);
  run.step = 'done';
  sqDraw();
}
// Close: the popup goes; the caller redraws its screen (onDone) with what happened.
function sqClose() {
  const run = SQ.run;
  if (!run || run.closed) return;
  run.closed = true;
  run.cancel = true;
  if (typeof spModal === 'function') spModal('', true);
  const count = state => run.jobs.filter(job => job.state === state).length;
  const summary = { test: run.test, step: run.step, sent: run.jobs.filter(job => ['sent', 'accepted', 'working'].includes(job.state)).length,
    accepted: count('accepted'), rejected: count('rejected'), working: count('working'), no: run.jobs.filter(job => job.state === 'no'), jobs: run.jobs, logErr: run.logErr || '' };
  if (typeof run.opts.onDone === 'function') { try { run.opts.onDone(summary); } catch (e) { /* the screen redraws on its next draw */ } }
  run.resolve(summary);
}
// Edit (one listing Amazon says no to): the popup closes and the caller opens where it is fixed.
function sqEdit() {
  const run = SQ.run;
  if (!run) return;
  const job = run.jobs[0];
  sqClose();
  if (typeof run.opts.onEdit === 'function') run.opts.onEdit(job);
}
// The outcome in one line, for a screen's own result box after the popup closed: "✅ Amazon accepted", "✅ 7 accepted · ❌ 1 rejected · ⏳ 0".
function sqSummaryText(sum) {
  if (!sum) return '';
  if (sum.test && sum.step === 'test') return 'Test site — not sent to Amazon.';
  if (sum.step !== 'done') return sum.no.length && sum.jobs.length === 1 ? `Amazon says no: ${sum.no[0].why} — ${sum.no[0].how}` : '';
  if (sum.jobs.length === 1) { const job = sum.jobs[0]; return `${SQ_STATE[job.state] || ''}${job.why ? ': ' + job.why : ''}`; }
  return `✅ ${sqNf(sum.accepted)} accepted · ❌ ${sqNf(sum.rejected)} rejected · ⏳ ${sqNf(sum.working)}${sum.no.length ? ` · ✗ ${sqNf(sum.no.length)} Amazon said no` : ''}`;
}
// The popup is waiting on Amazon (a send or a read): Esc and a click outside do not close it then.
const sqBusy = () => !!(SQ.run && !SQ.run.closed && (SQ.run.step === 'send' || SQ.run.step === 'verify'));
const sqIsOpen = () => !!(SQ.run && !SQ.run.closed);

/* ----- the popup (the existing confirm window, #spModal, same look) ----- */
const SQ_STATE = { ok: '✓ Amazon will accept', no: '✗ Amazon says no', test: 'Not checked — test site', notsent: 'Test site — not sent to Amazon', sent: 'Sent',
  accepted: '✅ Amazon accepted', rejected: '❌ Amazon rejected', working: '⏳ Amazon is still working', checking: '… checking' };
// The words that come out and go in, as a person reads them ("summer" out; "thanksgiving christmas" in): each word as often as its count
// changed, in the order the text has it; case aside.
function sqWordDiff(before, after) {
  const tok = t => String(t || '').split(/[\s,;·|]+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'%]+$/gu, '')).filter(Boolean);
  const a = tok(before);
  const b = tok(after);
  const count = list => { const m = new Map(); list.forEach(w => { const k = w.toLowerCase(); m.set(k, (m.get(k) || 0) + 1); }); return m; };
  const ca = count(a);
  const cb = count(b);
  // by count only (very long texts): each word as often as its count changed, the first ones
  const pick = (list, more, less) => { const used = new Map(); return list.filter(w => { const k = w.toLowerCase(); const extra = (more.get(k) || 0) - (less.get(k) || 0); const u = used.get(k) || 0; if (extra > u) { used.set(k, u + 1); return true; } return false; }); };
  if (a.length * b.length > 160000) return { added: pick(b, cb, ca), removed: pick(a, ca, cb) };
  // lined up word by word (the longest common run), so the occurrence that really went is the one named ("Reusable Dinner Napkins"),
  // then a word that only moved (out here, in there) is no change
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i].toLowerCase() === b[j].toLowerCase() ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const keptA = new Set();
  const keptB = new Set();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i].toLowerCase() === b[j].toLowerCase()) { keptA.add(i); keptB.add(j); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  let removed = a.filter((w, i) => !keptA.has(i));
  let added = b.filter((w, j) => !keptB.has(j));
  const moved = new Map();
  removed.forEach(w => { const k = w.toLowerCase(); moved.set(k, (moved.get(k) || 0) + 1); });
  const both = new Map();
  added.forEach(w => { const k = w.toLowerCase(); if (moved.get(k)) { moved.set(k, moved.get(k) - 1); both.set(k, (both.get(k) || 0) + 1); } });
  const drop = list => { const left = new Map(both); return list.filter(w => { const k = w.toLowerCase(); if (left.get(k)) { left.set(k, left.get(k) - 1); return false; } return true; }); };
  removed = drop(removed);
  added = drop(added);
  return { added, removed };
}
// One change in one line — ONLY what changes: "Hidden search words: − summer · + thanksgiving christmas (238 of 249)"; a picture: "Main
// picture: replaced by a new picture" — and "› Show full text" folded under it (before and after in full).
// A change: { field, old, new, pic (a picture slot), size ("41 of 125"), or max + unit ('bytes' | 'letters') to count the new text }.
function sqChangeLine(c) {
  const oldText = c.old == null ? '' : String(c.old);
  const newText = c.new == null ? '' : String(c.new);
  const size = c.size || (c.max ? `${sqNf(c.unit === 'bytes' && typeof lrKwBytes === 'function' ? lrKwBytes(newText) : newText.length)} of ${sqNf(c.max)}` : '');
  let what;
  if (c.pic) what = !oldText || oldText === '(none)' ? '<span class="sq-add">+ a new picture</span>' : newText === '(removed)' ? '<span class="sq-rem">− the picture taken away</span>' : 'replaced by a new picture';
  else if (newText === '(removed)') what = '<span class="sq-rem">− all of it (removed)</span>';
  else {
    const d = sqWordDiff(oldText, newText);
    const parts = [];
    if (d.removed.length) parts.push(`<span class="sq-rem">− ${sqEsc(d.removed.join(' '))}</span>`);
    if (d.added.length) parts.push(`<span class="sq-add">+ ${sqEsc(d.added.join(' '))}</span>`);
    what = parts.join(' · ') || (oldText !== newText ? 'the same words, in a new order' : 'no change');
  }
  const full = `<details class="sq-full"><summary>› Show full text</summary><div><small>Before</small> ${sqEsc(oldText || '(empty)')}</div><div><small>After</small> ${sqEsc(newText || '(empty)')}</div></details>`;
  return `<div class="sp-m-now sq-chg"><small>${sqEsc(c.field)}:</small> ${what}${size ? ` <span class="sq-size">(${size})</span>` : ''}${full}</div>`;
}
function sqChangesHtml(job) {
  return sqChanges(job).map(sqChangeLine).join('');
}
function sqRowHtml(job, withChange) {
  return `<div class="sp-m-row sq-row is-${job.state}"><b>${sqEsc(job.label || job.sku)}</b><small>${sqEsc(job.sku)}${job.asin ? ' · ' + sqEsc(job.asin) : ''}</small>`
    + `<div class="sq-st">${sqEsc(SQ_STATE[job.state] || '')}${job.why ? `: ${sqEsc(job.why)}` : ''}</div>${job.how && (job.state === 'no' || job.state === 'rejected') ? `<div class="sq-how">How to fix: ${sqEsc(job.how)}</div>` : ''}`
    + `${withChange ? sqChangesHtml(job) : ''}</div>`;
}
function sqDraw() {
  const run = SQ.run;
  if (!run || run.closed || typeof spModal !== 'function') return;
  const jobs = run.jobs;
  const n = state => jobs.filter(job => job.state === state).length;
  const one = jobs.length === 1;
  const held = (run.opts.held || []).length ? `<div class="sp-m-row sq-held"><b>${sqNf(run.opts.held.length)} need your OK — not in this send</b>`
    + run.opts.held.slice(0, 50).map(h => `<div class="sq-st">${sqEsc(h.sku)}: ${sqEsc(h.why)}</div>`).join('') + '</div>' : '';
  const bar = (done, total) => `<div class="sp-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width:${total ? Math.round(done * 100 / total) : 0}%"></span></div>`;
  const btn = (act, text, main, disabled) => `<button type="button" class="${main ? 'sp-main' : 'sp-btn'}" data-sq="${act}"${disabled ? ' disabled' : ''}>${text}</button>`;
  let html;
  if (run.step === 'check') {
    html = `<div class="sp-m-h"><b>Checking with Amazon…</b><p>${one ? '' : `${sqNf(run.done)} of ${sqNf(run.total)} · `}Amazon checks each change first — nothing changes on Amazon yet.</p></div>${bar(run.done, run.total)}`
      + `<div class="sp-m-a">${btn('cancel', 'Cancel')}</div>`;
  } else if (run.step === 'review') {
    const ok = n('ok');
    const no = jobs.filter(job => job.state === 'no');
    const test = n('test');
    if (run.test) {
      html = `<div class="sp-m-h"><b>Test site — Amazon's check cannot run here</b><p>The test site blocks every call that could change Amazon. On live Sellora, Amazon checks ${one ? 'this change' : `these ${sqNf(test)} changes`} here first.</p></div>`
        + `<div class="sp-m-list">${jobs.map(job => sqRowHtml(job, true)).join('')}${held}</div><div class="sp-m-a">${btn('approve', one ? 'Approve &amp; send' : `Approve &amp; send ${sqNf(test)}`, true)}${btn('cancel', 'Cancel')}</div>`;
    } else if (one && ok) {
      html = `<div class="sp-m-h"><b>✓ Amazon will accept</b><p>${sqEsc(jobs[0].label || jobs[0].sku)} · ${sqEsc(jobs[0].sku)} — what changes:</p></div>`
        + `<div class="sp-m-list">${sqChangesHtml(jobs[0])}${held}</div><div class="sp-m-a">${btn('approve', 'Approve &amp; send', true)}${btn('cancel', 'Cancel')}</div>`;
    } else if (one) {
      html = `<div class="sp-m-h"><b>✗ Amazon says no: ${sqEsc(jobs[0].why)}</b><p>How to fix: ${sqEsc(jobs[0].how)}</p></div>`
        + `<div class="sp-m-list">${sqChangesHtml(jobs[0])}${held}</div><div class="sp-m-a">${run.opts.onEdit ? btn('edit', 'Edit', true) : ''}${btn('cancel', 'Close')}</div>`;
    } else {
      html = `<div class="sp-m-h"><b>${sqNf(ok)} Amazon will accept · ${sqNf(no.length)} Amazon says no</b><p>${run.opts.title ? sqEsc(run.opts.title) + ' — ' : ''}only the ones Amazon will accept are sent.</p></div>`
        + `<div class="sp-m-list">${no.length ? `<div class="sp-m-row sq-sub"><b>Amazon says no (${sqNf(no.length)})</b></div>${no.map(job => sqRowHtml(job, false)).join('')}` : ''}`
        + `${ok ? `<details class="sq-fold"${no.length ? '' : ' open'}><summary>The ${sqNf(ok)} change${ok === 1 ? '' : 's'} Amazon will accept</summary>${jobs.filter(job => job.state === 'ok').map(job => sqRowHtml(job, true)).join('')}</details>` : ''}${held}</div>`
        + `<div class="sp-m-a">${ok ? btn('approve', `Approve &amp; send ${sqNf(ok)}`, true) : ''}${btn('cancel', ok ? 'Cancel' : 'Close')}</div>`;
    }
  } else if (run.step === 'send') {
    html = `<div class="sp-m-h"><b>Sending ${sqNf(run.done)} of ${sqNf(run.total)}…</b><p>Amazon checks each one again first. Please keep this window open.</p></div>${bar(run.done, run.total)}`;
  } else if (run.step === 'verify') {
    html = `<div class="sp-m-h"><b>Reading ${one ? 'the listing' : 'the listings'} again from Amazon… ${one ? '' : `${sqNf(run.done)} of ${sqNf(run.total)}`}</b><p>To see what Amazon did with ${one ? 'the change' : 'each change'}.</p></div>${bar(run.done, run.total)}`;
  } else if (run.step === 'test') {
    html = `<div class="sp-m-h"><b>Test site — not sent to Amazon</b><p>Nothing was sent. On live Sellora ${one ? 'this change goes' : `these ${sqNf(n('notsent'))} changes go`} to Amazon here.</p></div>`
      + `<div class="sp-m-list">${jobs.map(job => sqRowHtml(job, true)).join('')}</div><div class="sp-m-a">${btn('close', 'Close', true)}</div>`;
  } else {
    const acc = n('accepted');
    const rej = jobs.filter(job => job.state === 'rejected');
    const wk = n('working');
    const head = one ? `${SQ_STATE[jobs[0].state] || ''}${jobs[0].why ? ': ' + sqEsc(jobs[0].why) : ''}`
      : `✅ ${sqNf(acc)} accepted · ❌ ${sqNf(rej.length)} rejected${rej.length ? ` (${sqEsc([...new Set(rej.map(job => job.why))].slice(0, 2).join('; '))})` : ''} · ⏳ ${sqNf(wk)}`;
    const rank = { rejected: 0, working: 1, accepted: 2 };     // what needs a look first: rejected, then still working, then accepted
    const sent = jobs.filter(job => job.state in rank).sort((x, y) => rank[x.state] - rank[y.state]);
    html = `<div class="sp-m-h"><b>${head}</b><p>${wk ? 'Amazon usually finishes within minutes to a few hours — press Check again later.' : 'Every change has an answer from Amazon.'}`
      + `${run.logErr ? ` <span class="sq-warn">The note for Listing History could not be saved (${sqEsc(run.logErr)}).</span>` : ''}</p></div>`
      + `<div class="sp-m-list">${sent.map(job => sqRowHtml(job, true)).join('')}</div>`
      + `<div class="sp-m-a">${wk ? btn('again', 'Check again') : ''}${btn('close', 'Close', true)}</div>`;
  }
  spModal(`<div class="sq-pop" data-sq-step="${run.step}">${html}</div>`, true);
}
// The popup's buttons.
function sqClick(act) {
  if (act === 'approve') return sqApprove();
  if (act === 'again') return sqCheckAgain();
  if (act === 'edit') return sqEdit();
  if (act === 'cancel' || act === 'close') return sqClose();
}
if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', e => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-sq]') : null;
  if (!btn || btn.disabled) return;
  sqClick(btn.dataset.sq);
});

/* ----- the send log: every send, accepted or rejected (Listing History reads it later) ----- */
// One row per changed field of one listing.
function sqLogRows(job, run) {
  const at = job.sentAt || Date.now();
  return sqChanges(job).map((c, i) => ({ id: `${at}-${job.brand}-${job.sku}-${i}`, kind: 'listing', at, by: sqBy(), name: sqName(sqBy()), brand: job.brand, sku: job.sku, asin: job.asin || '',
    field: c.field, old: sqCut(c.old, SQ_CUT), new: sqCut(c.new, SQ_CUT), screen: run.opts.screen || '', result: job.state, why: job.why || '', sub: job.sub || '' }));
}
/** THE ONE LOG FUNCTION. rows: [{ id, kind: 'listing', at, by, name, brand, sku, asin, field, old, new, screen, result, why }]. Written to the
 *  existing /history collection as documents of their own — history/listing_<YYYY-MM-DD>_<run>-<n>, { kind: 'listing', day, rows: { <id>:
 *  row } } — at most SQ_LOG_ROWS rows each, so no document ever nears Firestore's 1 MB. `run` remembers which document each row went to:
 *  a row written again (Check again) updates its own place, merged in, never another person's. Returns '' or why it could not be saved.
 *  Nothing is written on the test site. */
async function lhistAdd(rows, run) {
  if (!rows || !rows.length || sqIsTest()) return '';
  const place = (run && run.logDocs) || new Map();      // row id → its document
  const stamp = (run && run.at) || Date.now();
  const fresh = rows.filter(row => !place.has(row.id));
  const start = new Set(place.values()).size;
  for (let i = 0; i < fresh.length; i += SQ_LOG_ROWS) {
    const day = new Date(fresh[i].at).toISOString().slice(0, 10);
    const id = `listing_${day}_${stamp}-${start + i / SQ_LOG_ROWS + 1}`;
    fresh.slice(i, i + SQ_LOG_ROWS).forEach(row => place.set(row.id, id));
  }
  if (run) run.logDocs = place;
  const byDoc = new Map();
  rows.forEach(row => {
    const id = place.get(row.id);
    if (!byDoc.has(id)) byDoc.set(id, {});
    byDoc.get(id)[row.id] = Object.assign({ kind: 'listing' }, row);
  });
  try {
    for (const [id, map] of byDoc) await setDoc(doc(db, SQ_LOG_COLL, id), { kind: 'listing', day: id.slice(8, 18), rows: map, at: serverTimestamp() }, { merge: true });
    return '';
  } catch (e) {
    return String((e && e.message) || e);
  }
}
