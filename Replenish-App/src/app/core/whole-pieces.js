/* ==== WHOLE PIECES POP-UP ==== */
/* Ravi's team, 28 Nov 2026 (order-to-shipping test): "2.5" typed for pieces was saved as 2 or 3 without a word, on screen after
 * screen. Now every box that takes whole numbers (a number box with step="1") stops it as it is typed: a pop-up says what cannot
 * be saved, the box goes back to what it held before, and Okay puts the cursor in it. Money, metres, kg and cm have other steps
 * and take decimals.
 * Errors: this fails loudly to the person, and nothing is saved: the screen never hears the stopped change, and nothing under the
 * pop-up can be pressed or left while it is open (a tap on Save, or a box that saves when you leave it). Pasted plans and files
 * with part pieces are refused whole by their own imports, never partly saved. A new pieces box only needs step="1". */

/** Is this typed text something other than a whole number? Blank is not: each form says for itself what a blank means.
 *  "2.0" is whole; "2.5" and "1e3" are not. A minus is left to the form's own check. */
const wpBad = v => { const t = String(v == null ? '' : v).trim(); return !!t && !/^-?\d+(\.0+)?$/.test(t); };
const wpBox = el => !!el && el.tagName === 'INPUT' && el.type === 'number' && el.getAttribute('step') === '1';
const WP_WAS = new WeakMap();   // what each box held when the cursor went in

/** The pop-up itself. `back` is where the cursor goes after Okay. One at a time. */
function wpShow(title, text, back) {
  if (document.getElementById('wpPop')) return;
  const make = (tag, cls, words) => { const e = document.createElement(tag); if (cls) e.className = cls; if (words) e.textContent = words; return e; };
  const pop = make('div', 'ptmodal'), box = make('div', 'ptmodal-box'), head = make('div', 'ptmodal-head'), body = make('div', 'ptmodal-body');
  pop.id = 'wpPop'; pop.setAttribute('role', 'alertdialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-label', title);
  pop.style.zIndex = '100000'; box.style.maxWidth = '420px';
  const ok = make('button', '', 'Okay'); ok.type = 'button'; ok.id = 'wpOk'; ok.style.marginTop = '14px';
  ok.onclick = () => { pop.remove(); if (back && back.isConnected) back.focus(); };
  head.appendChild(make('b', '', title));
  body.appendChild(make('div', '', text)); body.appendChild(ok);
  box.appendChild(head); box.appendChild(body); pop.appendChild(box);
  document.body.appendChild(pop);
  ok.focus();
}

/** Stops a part number in a whole-number box: puts the old figure back, lets the screen's totals catch up, and says why.
 *  The old figure, not a blank: several screens read a blank as 0 or as "remove it". True when stopped. */
function wpStop(el) {
  if (!wpBox(el) || !wpBad(el.value)) return false;
  const typed = el.value, was = WP_WAS.get(el);
  el.value = was === undefined || wpBad(was) ? '' : was;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  wpShow(`${typed} cannot be saved`, 'Pieces and counts must be a whole number, with no decimal point. Please type it again.', el);
  return true;
}

/* All caught on the way down, before any screen's own handler. The guard for the open pop-up comes first. */
['click', 'focusout', 'blur', 'change'].forEach(type => document.addEventListener(type, e => {
  const pop = document.getElementById('wpPop');
  if (pop && !pop.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true));
document.addEventListener('focusin', e => { if (wpBox(e.target)) WP_WAS.set(e.target, e.target.value); }, true);
document.addEventListener('change', e => { if (wpStop(e.target)) e.stopImmediatePropagation(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Enter' && wpStop(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
