
/* ================= "FILTER BY" — one button instead of a row of drop-downs =================
 *
 * Ravi, 2026-09-22, on the Job Work toolbar: "itne sare option ki jagah filter by then choose kar sakte
 * h … ye filter option every action par applicable hona chahiye".
 *
 * EVERY TOOLBAR WITH THREE OR MORE FILTER DROP-DOWNS — a select whose first option is "All …", "Any …"
 * or "Every …" with an empty value — gets a "Filters" button. The drop-downs are MOVED into its panel,
 * not copied: every screen keeps reading the same elements by the same ids, so its filtering, Clear,
 * Export and the code that refills their options all work exactly as before. What is chosen shows as
 * chips under the toolbar, each with a ✕.
 */
const FT_MIN = 3;
const ftIsFilter = el => el && el.tagName === 'SELECT' && el.options && el.options.length
  && el.options[0].value === '' && /^(all|any|every|anyone)\b/i.test(String(el.options[0].text || '').trim());
/** "All employees" → "Employee", "Anyone's entry" → "Entered by", "Any status" → "Status". */
function ftLabel(el) {
  const t = String((el.options[0] || {}).text || '').trim();
  if (/^anyone'?s entry/i.test(t)) return 'Entered by';
  let x = t.replace(/^(all|any|every)\s+/i, '').replace(/[—-].*$/, '').trim();
  if (/ies$/i.test(x)) x = x.replace(/ies$/i, 'y'); else if (/(ss|us)$/i.test(x)) { /* keep */ } else x = x.replace(/s$/i, '');
  return x ? x.charAt(0).toUpperCase() + x.slice(1) : 'Filter';
}
const FT_BARS = [];

function ftEnhance(bar) {
  if (!bar || bar.dataset.ft) return;
  const sels = [...bar.children].filter(ftIsFilter);
  if (sels.length < FT_MIN) return;
  bar.dataset.ft = '1';
  const wrap = document.createElement('span');
  wrap.className = 'ftwrap';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'ghost ftbtn';
  btn.innerHTML = '<span aria-hidden="true">⚲</span> Filters <b class="ftn hide"></b>';
  const pop = document.createElement('div');
  pop.className = 'ftpop hide';
  const grid = document.createElement('div');
  grid.className = 'ftgrid';
  sels.forEach(sel => {
    const lab = document.createElement('label');
    lab.className = 'ftlab';
    const cap = document.createElement('span');
    cap.textContent = ftLabel(sel);
    sel.style.flex = ''; sel.style.width = '100%';
    bar.insertBefore(wrap, bar.children[[...bar.children].indexOf(sel)] || null);
    lab.appendChild(cap); lab.appendChild(sel);
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
  const close = () => pop.classList.add('hide');
  btn.onclick = e => { e.stopPropagation(); const open = pop.classList.contains('hide'); FT_BARS.forEach(r => r.pop.classList.add('hide')); pop.classList.toggle('hide', !open); };
  done.onclick = close;
  pop.addEventListener('click', e => e.stopPropagation());
  /* Clearing sets each one back to "All" and tells the screen, the same way picking it by hand would. */
  const reset = sel => { if (sel.value !== '') { sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true })); } };
  clear.onclick = () => { sels.forEach(reset); ftSync(rec); };
  chips.addEventListener('click', e => {
    const x = e.target.closest('[data-ftx]'); if (!x) return;
    const sel = sels[+x.getAttribute('data-ftx')]; if (sel) reset(sel);
    ftSync(rec);
  });
  pop.addEventListener('change', () => ftSync(rec));
  ftSync(rec);
}

/** Count, chips, and which drop-downs are even offered (a screen may hide one). Cheap: runs on change and on a timer. */
function ftSync(rec) {
  const on = rec.sels.map((sel, i) => ({ sel, i })).filter(x => x.sel.value !== '' && !x.sel.classList.contains('hide'));
  const sig = on.map(x => x.i + '=' + x.sel.value).join('|') + '#' + rec.sels.map(s => s.classList.contains('hide') ? 1 : 0).join('');
  if (sig === rec.sig) return;
  rec.sig = sig;
  rec.sels.forEach(sel => { const lab = sel.parentNode; if (lab && lab.classList.contains('ftlab')) lab.classList.toggle('hide', sel.classList.contains('hide')); });
  const n = rec.btn.querySelector('.ftn');
  n.textContent = on.length ? String(on.length) : '';
  n.classList.toggle('hide', !on.length);
  rec.btn.classList.toggle('ft-on', on.length > 0);
  rec.chips.innerHTML = on.map(x => {
    const opt = x.sel.options[x.sel.selectedIndex];
    return `<span class="ftchip">${esc(ftLabel(x.sel))}: <b>${esc(opt ? opt.text : x.sel.value)}</b>`
      + `<button type="button" data-ftx="${x.i}" title="Remove this filter" aria-label="Remove">✕</button></span>`;
  }).join('');
  rec.chips.classList.toggle('hide', !on.length);
}

(() => {
  try {
    if (!document.querySelectorAll) return;
    document.querySelectorAll('[id^="pane"] .toolbar').forEach(ftEnhance);
    document.addEventListener('click', () => FT_BARS.forEach(r => r.pop.classList.add('hide')));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') FT_BARS.forEach(r => r.pop.classList.add('hide')); });
    /* A screen's own Clear, a KPI click or a reload sets the drop-downs in code, with no change event —
     * the chips catch up here. Only toolbars on screen are looked at. */
    setInterval(() => FT_BARS.forEach(r => { if (r.bar.offsetParent) ftSync(r); }), 700);
  } catch (e) { console.warn('[filters] not applied:', e); }
})();
