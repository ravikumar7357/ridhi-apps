
/* ================= "FILTER BY" — one button instead of a row of drop-downs =================
 *
 * Ravi, 2026-09-22, on the Job Work toolbar: "itne sare option ki jagah filter by then choose kar sakte
 * h … ye filter option every action par applicable hona chahiye" — and then on Replenishment: "apply
 * here filter by option as well".
 *
 * PER CARD, across all its toolbars: a card with three or more filters gets one "Filters" button in its
 * first toolbar. A filter is
 *   - a <select> whose first option is "All …", "Any …", "Every …" or "Anyone's …" with an empty value;
 *   - a <select> marked data-ftf="Label" (its first option is its "all" state, whatever its value);
 *   - one of the Excel-style multi-select boxes (.ms), whose picks live in MS[id].
 * They are MOVED into the panel, not copied: every screen keeps reading the same elements by the same
 * ids, so its filtering, Clear and Export work exactly as before. What is chosen shows as chips with ✕.
 */
const FT_MIN = 3;
const ftIsSelectFilter = el => el && el.tagName === 'SELECT' && el.options && el.options.length
  && (el.hasAttribute('data-ftf') || (el.options[0].value === '' && /^(all|any|every|anyone)\b/i.test(String(el.options[0].text || '').trim())));
const ftIsMs = el => el && el.classList && el.classList.contains('ms') && el.id && typeof MS !== 'undefined' && MS[el.id];
const ftIsFilter = el => ftIsSelectFilter(el) || ftIsMs(el);
/** "All employees" → "Employee", "Anyone's entry" → "Entered by", "Any status" → "Status". */
function ftLabel(el) {
  if (el.getAttribute && el.getAttribute('data-ftf')) return el.getAttribute('data-ftf');
  const t = ftIsMs(el) ? String(MS[el.id].label || '') : String((el.options[0] || {}).text || '').trim();
  if (/^anyone'?s entry/i.test(t)) return 'Entered by';
  /* A dash explains a select's first option ("All — every size"); in a picker's own name it is part of it. */
  let x = t.replace(/^(all|any|every)\s+/i, '');
  if (!ftIsMs(el)) x = x.replace(/\s[—-]\s.*$/, '');
  x = x.trim();
  if (/ies$/i.test(x)) x = x.replace(/ies$/i, 'y');
  else if (/(ss|us)$/i.test(x)) { /* keep: status, class */ }
  else if (/(s|x|ch|sh)es$/i.test(x)) x = x.replace(/es$/i, '');
  else x = x.replace(/s$/i, '');
  return x ? x.charAt(0).toUpperCase() + x.slice(1) : 'Filter';
}
/** Is it narrowing anything, and what does it say. */
const ftOn = el => (ftIsMs(el) ? MS[el.id].sel.size > 0 : el.value !== el.options[0].value);
function ftSays(el) {
  if (ftIsMs(el)) { const v = [...MS[el.id].sel]; return v.length <= 2 ? v.join(', ') : v.slice(0, 2).join(', ') + ' +' + (v.length - 2); }
  const o = el.options[el.selectedIndex]; return o ? o.text : el.value;
}
/** Back to "all", telling the screen the same way picking it by hand would. */
function ftReset(el) {
  if (!ftOn(el)) return;
  if (ftIsMs(el)) { MS[el.id].sel = new Set(); msPaint(el.id); msChanged(el.id); return; }
  el.value = el.options[0].value; el.dispatchEvent(new Event('change', { bubbles: true }));
}
const FT_BARS = [];

function ftEnhance(card) {
  if (!card || card.dataset.ft) return;
  const bars = [...card.children].filter(c => c.classList && c.classList.contains('toolbar'));
  if (!bars.length) return;
  const sels = bars.flatMap(b => [...b.children].filter(ftIsFilter));
  if (sels.length < FT_MIN) return;
  card.dataset.ft = '1';
  const bar = bars[0];
  const wrap = document.createElement('span');
  wrap.className = 'ftwrap';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'ghost ftbtn';
  btn.innerHTML = '<span aria-hidden="true">⚲</span> Filters <b class="ftn hide"></b>';
  const pop = document.createElement('div');
  pop.className = 'ftpop hide';
  const grid = document.createElement('div');
  grid.className = 'ftgrid';
  /* The button takes the place of the first filter in the first toolbar, or leads it. */
  const firstHere = [...bar.children].find(ftIsFilter);
  bar.insertBefore(wrap, firstHere || bar.firstChild);
  sels.forEach(el => {
    const lab = document.createElement('label');
    lab.className = 'ftlab';
    const cap = document.createElement('span');
    cap.textContent = ftLabel(el);
    el.style.flex = ''; el.style.width = '100%';
    lab.appendChild(cap); lab.appendChild(el);
    grid.appendChild(lab);
  });
  const foot = document.createElement('div');
  foot.className = 'ftfoot';
  const clear = document.createElement('button');
  clear.type = 'button'; clear.className = 'ghost'; clear.textContent = 'Clear these filters';
  const done = document.createElement('button');
  done.type = 'button'; done.textContent = 'Done';
  foot.appendChild(clear); foot.appendChild(done);
  pop.appendChild(grid); pop.appendChild(foot);
  wrap.appendChild(btn); wrap.appendChild(pop);
  const chips = document.createElement('div');
  chips.className = 'ftchips hide';
  bar.parentNode.insertBefore(chips, bar.nextSibling);
  const rec = { bar, sels, btn, pop, chips, sig: '' };
  FT_BARS.push(rec);
  btn.onclick = e => { e.stopPropagation(); const open = pop.classList.contains('hide'); FT_BARS.forEach(r => r.pop.classList.add('hide')); pop.classList.toggle('hide', !open); };
  done.onclick = () => pop.classList.add('hide');
  pop.addEventListener('click', e => e.stopPropagation());
  clear.onclick = () => { sels.forEach(ftReset); ftSync(rec); };
  chips.addEventListener('click', e => {
    const x = e.target.closest('[data-ftx]'); if (!x) return;
    const el = sels[+x.getAttribute('data-ftx')]; if (el) ftReset(el);
    ftSync(rec);
  });
  pop.addEventListener('change', () => ftSync(rec));
  ftSync(rec);
}

/** Count, chips, and which filters are even offered (a screen may hide one). Runs on change and on a timer. */
function ftSync(rec) {
  const on = rec.sels.map((el, i) => ({ el, i })).filter(x => !x.el.classList.contains('hide') && ftOn(x.el));
  const sig = on.map(x => x.i + '=' + ftSays(x.el)).join('|') + '#' + rec.sels.map(s => s.classList.contains('hide') ? 1 : 0).join('');
  if (sig === rec.sig) return;
  rec.sig = sig;
  rec.sels.forEach(el => { const lab = el.parentNode; if (lab && lab.classList.contains('ftlab')) lab.classList.toggle('hide', el.classList.contains('hide')); });
  const n = rec.btn.querySelector('.ftn');
  n.textContent = on.length ? String(on.length) : '';
  n.classList.toggle('hide', !on.length);
  rec.btn.classList.toggle('ft-on', on.length > 0);
  rec.chips.innerHTML = on.map(x => `<span class="ftchip">${esc(ftLabel(x.el))}: <b>${esc(ftSays(x.el))}</b>`
    + `<button type="button" data-ftx="${x.i}" title="Remove this filter" aria-label="Remove">✕</button></span>`).join('');
  rec.chips.classList.toggle('hide', !on.length);
}

(() => {
  try {
    if (!document.querySelectorAll) return;
    document.querySelectorAll('[id^="pane"] .card').forEach(ftEnhance);
    document.addEventListener('click', () => FT_BARS.forEach(r => r.pop.classList.add('hide')));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') FT_BARS.forEach(r => r.pop.classList.add('hide')); });
    /* A screen's own Clear, a KPI click or a reload sets filters in code, with no change event — the
     * chips catch up here. Only toolbars on screen are looked at. */
    const ftTick = setInterval(() => FT_BARS.forEach(r => { if (r.bar.offsetParent) ftSync(r); }), 700);
    if (ftTick && ftTick.unref) ftTick.unref();       // a test run under Node must still be able to finish
  } catch (e) { console.warn('[filters] not applied:', e); }
})();
