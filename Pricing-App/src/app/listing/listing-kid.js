/* ================= LISTING · ONE CHILD LISTING AS A SIDEBAR: the same component on Child listings and in the Workspace panel =================
 * Screens: Listing Health → Child listings: a click (or Enter) on a row opens that child in a 460px sidebar on the right (#lsKid;
 *          the whole screen on a phone, with "← Back"), one at a time; ↑ / ↓ move to the previous / next row, Esc closes.
 *          Parent ASINs still opens a parent ON THE PAGE (Ravi's rule) — nothing here touches that.
 *          The Workspace side panel's Listings tab draws the very same component inside the panel (listing-workspace.js calls lkHtml).
 * Does: one child listing — header (picture, SKU, ASIN, parent name, status, stock, ×, Check now), its problems grouped
 *       "Error: fix first" / "Needs attention" / "Good to fill" (each a lrRecHtml row: dot, the problem in words, how to fix, the tag,
 *       Fix), "Show passed checks (N)", and a footer with the sources and how old each is. DISPLAY ONLY: every judgement is
 *       healthOf's (listing-rules.js) through the Workspace's liWsChild — the same record the table and the Workspace show.
 * Main functions: lkKid (the child record of a Health row), lkHtml (the component), lkOpen / lkClose / lkMove / lkRender / lkSync /
 *       lkRowMark (the Child listings sidebar).
 */
const LK = {
  key: '',                 // "brand|sku" open in the Child listings sidebar; '' when closed
  pass: new Set(),         // "brand|sku" whose passed checks are showing (both screens)
  scrollAt: 0,             // when the sidebar was last scrolled: a redraw for landed data waits LK_SCROLL_MS after it
  timer: 0,                // that waiting redraw
  drawn: null,             // the child record the sidebar last drew (liWsChildKept gives the same object while nothing changed)
  drawnChk: false,         // …and whether its Check now was running then
};
const LK_SCROLL_MS = 400;

// The child record (liWsChild's checks, findings and live read) of one listing in the Health snapshot; null when it is not there.
function lkKid(brand, sku) {
  const row = ((HEALTH[brand] && HEALTH[brand].rows) || []).find(each => each.sku === sku);
  if (!row || typeof liWsChildKept !== 'function') return null;
  return liWsChildKept(row, brand, hCtx(), liWsImlIndex(brand), Date.now());
}
// A date that may be a Date, a Firestore Timestamp or milliseconds, as milliseconds (0 when none).
const lkMs = value => (!value ? 0 : value.getTime ? value.getTime() : value.toDate ? value.toDate().getTime() : +value || 0);

/** The component: one child listing as header + body + footer (the .ls-panel-h / .ls-panel-b / .ls-panel-f parts of a side panel).
 *  `opts`: { back, backLabel, backAlways, close } — `back` / `close` are the attributes their buttons carry, so each screen handles
 *  its own (Child listings: data-lk-close; the Workspace panel: data-li-ws-pback / data-li-ws-pclose). */
function lkHtml(kid, opts) {
  const key = kid.brand + '|' + kid.sku;
  const row = kid.row;
  const now = Date.now();
  const checking = !!(LI_WS.checking && LI_WS.checking.has(key));
  const parent = row.parent ? (typeof parentName === 'function' ? parentName(kid.brand, row.parent, row.title) : row.parent) : '';
  // --- header: back (a phone, or always in the Workspace panel), picture, SKU, ASIN, parent, status, stock, ×; then Check now ---
  const top = opts.back ? `<div class="lk-top${opts.backAlways ? ' is-always' : ''}"><button type="button" class="lk-back" ${opts.back}>${lrEsc(opts.backLabel || '← Back')}</button></div>` : '';
  const status = String(row.status || '').trim();
  const stock = row.qty == null ? 'Stock not known' : `${liWsNf(row.qty)} unit${row.qty === 1 ? '' : 's'} in stock`;
  const head = top + `<div class="ls-panel-h lk-h">${liWsPicHtml(liWsPicUrl(kid.brand, kid.sku), true)}<div class="ls-panel-t">`
    + `<b class="lk-sku" title="${lrEsc(kid.sku)}">${lrEsc(kid.sku)}</b>`
    + `<span><span class="ui-mono">${lrEsc(kid.asin || '—')}</span>${parent ? ` · <span title="${lrEsc(parent)}">${lrEsc(parent)}</span>` : ''}</span>`
    + `<span><span class="lk-st${kid.live ? ' is-live' : ''}">${lrEsc(kid.why)}</span>${status && status.toLowerCase() !== kid.why.toLowerCase() ? ' · ' + lrEsc(status) : ''} · ${lrEsc(stock)}</span></div>`
    + `<button type="button" class="ls-x" ${opts.close} aria-label="Close">×</button></div>`
    + `<div class="ls-panel-a"><button type="button" class="ls-btn" data-lr-check="${lrEsc(key)}"${checking ? ' disabled' : ''} title="Reads this one listing from Amazon now: status, Amazon's issues, the catalogue's pictures, content and A+">${checking ? 'Checking…' : 'Check now'}</button></div>`;
  // --- body: the problems in three groups, worst first; each one row: dot · in words · how to fix · tag · Fix ---
  const found = lrProblemsSort(kid.found);
  const ageOf = hit => (hit.at > 0 ? Math.round((now - hit.at) / LR_DAY) + ' days old' : 'with no date');
  const rec = (hit, fill) => lrRecHtml({ sev: hit.sev, stale: hit.stale, fill, bare: true, name: hit.what || hit.name,
    sub: [hit.what ? '' : hit.detail, hit.sev === 'critical' && hit.stale ? `from data ${ageOf(hit)} — Check now reads it again` : ''].filter(Boolean).join(' · '),
    fix: hit.fix, tag: hit.tag, kind: hit.kind, detector: hit.detector,
    bfHtml: typeof bfKidHtml === 'function' ? bfKidHtml(fill ? bfSpec(kid, '') : bfOf(kid, hit, hCtx())) : '',   // B / F dots (listing-bf.js)
    attrs: fill ? ((kid.c.spec && kid.c.spec.attrs) || []) : ((kid.c[liWsColOf(hit)] || {}).attrs || []) }, { brand: kid.brand, sku: kid.sku });
  const group = (cls, title, items) => (items.length ? `<div class="ls-kidhead lk-gh ${cls}">${lrEsc(title)}<span class="ls-n">${liWsNf(items.length)}</span></div><div class="ls-recs">${items.join('')}</div>` : '');
  const errs = found.filter(hit => hit.sev === 'critical').map(hit => rec(hit, false));
  const atts = found.filter(hit => hit.sev !== 'critical').map(hit => rec(hit, false));
  const fills = ((kid.c.spec && kid.c.spec.hits) || []).map(hit => rec(hit, true));
  const checks = LI_WS_CHECKS.map(check => Object.assign({ k: check.k, t: check.w || check.t }, kid.c[check.k]));
  const unknown = checks.filter(c => c.pass === null && !c.na);
  const looks = checks.filter(c => c.pass === true && c.look);       // ◐ a person needs to look — not an error, counted nowhere
  const where = { brand: kid.brand, sku: kid.sku };
  const bangs = [...new Set(checks.map(c => c.bang).filter(Boolean))];
  const none = !errs.length && !atts.length && !fills.length
    ? `<div class="ls-empty lk-none">${unknown.length || looks.length ? '<b>No problem found so far.</b><br>Some checks have no answer yet — see below.' : '<b>No problem on this listing.</b><br>Every Listing Rule passes.'}</div>` : '';
  const info = (kid.live ? '' : kid.urgent ? '<div class="lk-info">Not live, but counted as an Error: fix this first.</div>'
    : '<div class="lk-info">This listing is not live, so its problems are not counted anywhere.</div>')
    + (checking ? '<div class="lk-info">Reading this listing from Amazon now…</div>' : '')
    + (kid.notes && kid.notes.length ? `<div class="lk-info">${lrNotesHtml(kid.notes)}</div>` : '')
    + (unknown.length || looks.length ? `<div class="lk-info">${looks.concat(unknown).map(c => lrAnswerHtml(c.t, c, where, '')).join('')}</div>` : '')
    + (bangs.length ? `<div class="lk-info li-ws-err">Could not read from Amazon: ${bangs.map(lrEsc).join(' · ')}</div>` : '');
  const passed = checks.filter(c => (c.pass === true && !c.look) || c.na);
  const open = LK.pass.has(key);
  const srcOf = c => [c.src && c.src.s, c.src && c.src.when].filter(Boolean).join(' · ');
  const pass = passed.length ? `<div class="ls-panel-tog lk-passtog"><button type="button" class="ls-more" data-lk-pass="${lrEsc(key)}" aria-expanded="${open}">${open ? 'Hide' : 'Show'} passed checks (${liWsNf(passed.length)})</button></div>`
    + (open ? `<div class="lk-passed">${passed.map(c => lrAnswerHtml(c.t, c, where, srcOf(c))).join('')}</div>` : '') : '';
  const body = group('is-c', lrLevel('critical').word, errs) + group('is-a', lrLevel('action').word, atts) + group('is-f', 'Good to fill', fills) + none + info + pass;
  // --- footer: where the answers come from, and how old each source is ---
  const healthAt = lkMs(HEALTH[kid.brand] && HEALTH[kid.brand].at);
  const imlAt = lkMs(typeof IML !== 'undefined' && IML[kid.brand] && IML[kid.brand].at);
  const lr = kid.lr;
  const foot = `<div class="ls-panel-f">Amazon: ${lr && lr.at ? 'read ' + liWsAgoWords(now - lr.at) : 'not read from Amazon yet'}`
    + ` · Full refresh: ${healthAt ? liWsAgoWords(now - healthAt) : 'none yet'}`
    + ` · Image Manager: ${imlAt ? liWsAgoWords(now - imlAt) : 'not loaded'}`
    + ` · Listing Rules: ${typeof LR_SAVED_AT !== 'undefined' && LR_SAVED_AT ? 'saved ' + liWsDate(lkMs(LR_SAVED_AT)) : 'built-in defaults'}</div>`;
  return head + `<div class="ls-panel-b lk-b" role="region" aria-label="Problems of ${lrEsc(kid.sku)}">${body}</div>` + foot;
}

/* ----- the Child listings sidebar ----- */
// Open a child (a click or Enter on its row, ↑ / ↓ from another): the row is marked without redrawing the table, the sidebar draws.
function lkOpen(key) {
  const sep = key.indexOf('|');
  if (!lkKid(key.slice(0, sep), key.slice(sep + 1))) return;
  const same = LK.key === key;
  LK.key = key;
  lkRowMark();
  const box = $('lsKid');
  if (!box) return;
  box.hidden = false;
  if (box.setAttribute) box.setAttribute('tabindex', '-1');
  lkRender(same);
  if (!same && box.focus) box.focus({ preventScroll: true });
}
// Close it: ×, ← Back, Esc, a press outside, another view. Focus goes back to the child's row when asked.
function lkClose(returnFocus) {
  if (!LK.key) return;
  const key = LK.key;
  LK.key = '';
  LK.drawn = null;
  clearTimeout(LK.timer);
  const box = $('lsKid');
  if (box) {
    box.hidden = true;
    box.innerHTML = '';
  }
  lkRowMark();
  if (returnFocus) {
    const row = lkRowEl(key);
    if (row && row.focus) row.focus({ preventScroll: true });
  }
}
const lkRowEl = key => ($('hTable') && $('hTable').querySelector ? $('hTable').querySelector(`tr[data-lk-row="${CSS.escape(key)}"]`) : null);
// Mark the open child's row (no redraw): the selected row is highlighted, every other one is not.
function lkRowMark() {
  const table = $('hTable');
  if (!table || !table.querySelectorAll) return;
  table.querySelectorAll('tr[data-lk-row]').forEach(row => {
    const on = row.dataset.lkRow === LK.key;
    row.classList.toggle('is-open', on);
    row.setAttribute('aria-selected', String(on));
  });
}
// ↑ / ↓: the row before / after the open one, in the order the table shows; the sidebar follows and the row scrolls into view.
function lkMove(dir) {
  const table = $('hTable');
  if (!LK.key || !table || !table.querySelectorAll) return;
  const rows = [...table.querySelectorAll('tr[data-lk-row]')];
  const at = rows.findIndex(row => row.dataset.lkRow === LK.key);
  const next = at < 0 ? rows[0] : rows[at + dir];
  if (!next) return;
  lkOpen(next.dataset.lkRow);
  if (next.scrollIntoView) next.scrollIntoView({ block: 'nearest' });
}
// Draw the sidebar. `keep`: the same child again — its scroll and the keyboard's place stay (liWsPanelPlace / PlaceBack).
function lkRender(keep) {
  const box = $('lsKid');
  if (!box || !LK.key) return;
  const sep = LK.key.indexOf('|');
  const kid = lkKid(LK.key.slice(0, sep), LK.key.slice(sep + 1));
  if (!kid) return lkClose(false);
  clearTimeout(LK.timer);
  const place = keep && box.querySelector ? liWsPanelPlace(box) : null;
  LK.drawn = kid;
  LK.drawnChk = !!(LI_WS.checking && LI_WS.checking.has(LK.key));
  box.innerHTML = lkHtml(kid, { close: 'data-lk-close="1"', back: 'data-lk-close="1"', backLabel: '← Back' });
  if (place) liWsPanelPlaceBack(box, place);
}
// After the table drew (data landed, a filter, a sort): another view → close; the child's record changed → draw again, but never
// while the sidebar is being scrolled (it waits until LK_SCROLL_MS after the last scroll).
function lkSync() {
  if (!LK.key) return;
  if (typeof H_VIEW !== 'undefined' && H_VIEW !== 'child') return lkClose(false);
  lkRowMark();
  const sep = LK.key.indexOf('|');
  const kid = lkKid(LK.key.slice(0, sep), LK.key.slice(sep + 1));
  if (!kid) return lkClose(false);
  if (kid === LK.drawn && LK.drawnChk === !!(LI_WS.checking && LI_WS.checking.has(LK.key))) return;
  const wait = LK_SCROLL_MS - (Date.now() - LK.scrollAt);
  clearTimeout(LK.timer);
  if (wait > 0) LK.timer = setTimeout(lkSync, wait);
  else lkRender(true);
}

/* ----- wiring: listeners are ADDED beside Listing Health's own ----- */
if (typeof document !== 'undefined' && document.addEventListener && $('hTable') && $('hTable').addEventListener) {
  // A click on a child row (not on a button, a link or a name editor in it) opens it; "+n more" in its Why cell does too.
  $('hTable').addEventListener('click', e => {
    const row = e.target && e.target.closest ? e.target.closest('tr[data-lk-row]') : null;
    if (!row) return;
    if (!e.target.closest('[data-lk-more]') && e.target.closest('button,a,input,select,textarea,[data-hkid],[data-pname]')) return;
    lkOpen(row.dataset.lkRow);
  });
  $('hTable').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target && e.target.closest ? e.target.closest('tr[data-lk-row]') : null;
    if (!row || e.target !== row) return;
    e.preventDefault();
    lkOpen(row.dataset.lkRow);
  });
  $('lsKid').addEventListener('click', e => {
    if (e.target.closest && e.target.closest('[data-lk-close]')) lkClose(true);
  });
  $('lsKid').addEventListener('scroll', () => { LK.scrollAt = Date.now(); }, { capture: true, passive: true });
  // "Show passed checks": the same toggle on both screens; the screen it is on redraws, the keyboard stays on the button.
  document.addEventListener('click', e => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-lk-pass]') : null;
    if (!btn) return;
    const key = btn.dataset.lkPass;
    if (LK.pass.has(key)) LK.pass.delete(key);
    else LK.pass.add(key);
    const inKid = !!btn.closest('#lsKid');
    if (inKid) lkRender(true);
    else if (btn.closest('#lsPanel') && typeof liWsPanelRender === 'function') liWsPanelRender();
    const root = inKid ? $('lsKid') : $('lsPanel');
    const again = root && root.querySelector ? root.querySelector(`[data-lk-pass="${CSS.escape(key)}"]`) : null;
    if (again) again.focus({ preventScroll: true });
  });
  // Esc closes the sidebar (focus back on the row); ↑ / ↓ move to the previous / next child. Not while typing in a box.
  document.addEventListener('keydown', e => {
    if (!LK.key || (typeof TAB_NOW !== 'undefined' && TAB_NOW !== 'health') || LI_WS.panel) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      lkClose(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return;
      e.preventDefault();
      lkMove(e.key === 'ArrowDown' ? 1 : -1);
    }
  });
  // A press outside it (on the page, not on a child row, the toolbar or a dialog) closes it — the click itself still lands.
  document.addEventListener('mousedown', e => {
    if (!LK.key || (typeof TAB_NOW !== 'undefined' && TAB_NOW !== 'health') || !e.target || !e.target.closest) return;
    if (e.target.closest('#lsKid,tr[data-lk-row],.modal,.modalbox,#hToolbar')) return;
    lkClose(false);
  });
}
