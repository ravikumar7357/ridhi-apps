/* ==== FORM MEMORY: MY PREVIOUS ENTRY IN GREY ====
 *
 * Ravi, 26 Nov 2026: on every entry form, each box shows in grey what I typed in it on my previous entry of that form;
 * Tab in an empty box fills it and moves on, and Enter moves to the next box. The form itself looks as it did.
 * Remembered on this PC only (Ravi's choice): a different PC or browser starts with no grey values.
 *
 * Each form names itself and calls frmWire when it opens and frmRemember after a save that worked. Dates are never
 * remembered (a new entry is dated today), and a box somebody typed in is never changed.
 *
 * Error handling: this only helps typing. It never throws and never stops a save. When the browser's storage cannot
 * be read or written (private window, storage full) the form works as before and a console line says why. */

const FRM_STORE = 'formMemory:';

/** The boxes of a form that can be remembered: typed or picked, visible or not, never a date or a button. */
function frmBoxes(root) {
  if (!root || !root.querySelectorAll) return [];
  return [...root.querySelectorAll('input,select,textarea')].filter(el => el.id
    && !/^(date|datetime-local|time|month|file|checkbox|radio|hidden|button|submit|password)$/i.test(el.type || ''));
}

/** What I typed in each box on my previous saved entry of this form, as { boxId: value }. */
function frmRead(form) {
  try { return JSON.parse(localStorage.getItem(FRM_STORE + form) || '{}') || {}; }
  catch (e) { console.info('Form memory: could not read ' + form + ' (' + (e.message || e) + '), no grey values.'); return {}; }
}

/** After a save that worked: keep what was in each box, for the next entry. Empty boxes are kept empty. */
function frmRemember(form, root) {
  const vals = {};
  frmBoxes(root).forEach(el => { vals[el.id] = String(el.value == null ? '' : el.value).trim(); });
  try { localStorage.setItem(FRM_STORE + form, JSON.stringify(vals)); }
  catch (e) { console.info('Form memory: could not keep ' + form + ' (' + (e.message || e) + '), next entry has no grey values.'); }
}

/**
 * Show the previous entry in grey in each empty box, and get Tab and Enter going. Call each time the form opens.
 * A shared box (the app's dialog) is wired with '' for a form that does not take part: Tab and Enter then do what they did.
 */
function frmWire(form, root) {
  if (!root) return;
  root.dataset.frmForm = form || '';
  if (!form) return;
  const prev = frmRead(form);
  frmBoxes(root).forEach(el => {
    const v = prev[el.id];
    /* a form that stays on the page keeps its own example text aside, for a box the newest entry left empty */
    if (el.dataset.frmExample == null) el.dataset.frmExample = el.placeholder || '';
    if (!v) {
      if (el.getAttribute('data-frm') != null) { el.removeAttribute('data-frm'); if (el.tagName !== 'SELECT') el.placeholder = el.dataset.frmExample; }
      return;
    }
    el.setAttribute('data-frm', v);
    /* a list box has no grey text; Tab still picks the previous choice */
    if (el.tagName !== 'SELECT') el.placeholder = v;
  });
  if (root.dataset.frmWired) return;            // a form that stays on the page is opened many times
  root.dataset.frmWired = '1';
  root.addEventListener('keydown', ev => frmKey(ev, root));
}

/** The value Tab would put in this box now: the previous entry's, when the box is empty, else ''. */
function frmFillOf(el) {
  if (!el || !el.getAttribute || el.readOnly || el.disabled || String(el.value || '') !== '') return '';
  const v = el.getAttribute('data-frm') || '';
  if (v && el.tagName === 'SELECT' && ![...(el.options || [])].some(o => o.value === v)) return '';   // that choice is gone
  return v;
}

/** The box after this one that can be typed in now (hidden ones skipped), or null after the last. */
function frmNextBox(boxes, from) {
  const open = (boxes || []).filter(b => !b.disabled && !b.readOnly && !(b.closest && b.closest('.hide,[hidden]')) && b.offsetParent !== null);
  const i = open.indexOf(from);
  return i >= 0 && i < open.length - 1 ? open[i + 1] : null;
}

function frmKey(ev, root) {
  if (!root.dataset.frmForm) return;
  const el = ev.target;
  if (ev.key === 'Tab' && !ev.shiftKey) {
    const v = frmFillOf(el);
    /* the value goes in and Tab still moves on; input and change tell whatever follows the box (lists, totals) */
    if (v) { el.value = v; ['input', 'change'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true }))); }
    return;
  }
  if (ev.key !== 'Enter' || !/^(INPUT|SELECT)$/.test(el.tagName || '')) return;
  const next = frmNextBox([...root.querySelectorAll('input,select,textarea')], el);
  if (!next) return;                           // the last box: Enter does what it always did
  /* A box with the browser's own list uses Enter to pick from it: let the pick happen, then move on. */
  if (el.getAttribute && el.getAttribute('list')) { setTimeout(() => next.focus(), 0); return; }
  ev.preventDefault();
  next.focus();
}
