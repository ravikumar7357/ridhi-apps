/* ================= LISTING · PICTURE CHECK: the main pictures a person must judge (white background, no text or logo) =================
 * Screens: Image Manager (tab 'img') → the "Picture check (N)" chip in its toolbar (#imPcChip) opens #imPcWrap in place of the list.
 *          Listing Health's check lines link here ("◐ A person needs to look — Open in Image Manager", data-pc-open).
 * Does: lists each brand's main pictures from the Image Manager snapshot (IML), one card per PICTURE (a picture used on several
 *       listings is judged once): the picture big, the question in plain words, [✓ Looks OK] [✕ Not OK] and an optional note; after a
 *       click "Checked by <name> · <date>". A mark is kept per picture id, so it holds until the picture changes (a new picture has a
 *       new id and is asked again). "Not OK" becomes a normal problem through the Listing Rule "Main picture marked Not OK"
 *       (listing-rules.js, main_photo_check); not marked yet is "◐ A person needs to look" there — never an error, counted nowhere.
 * Saved in imgsnap/piccheck — the Image Manager's own collection, which firestore.rules already lets Image Manager users write
 *       (match /imgsnap/{brand}). If that write is refused the marks are kept in this browser (localStorage) and the page says so;
 *       on the test site they last for the visit only ("not saved here").
 * Main functions: pcLoad, pcMark, pcPictures, pcRender, pcOn / pcOff, pcOpenFor. State: PC (marks per brand → picture id → mark).
 */
const PC_STORE = 'selloraPicCheck';       // localStorage: the marks kept in this browser when the shared place could not be written
const PC_PAGE = 24;                       // cards shown at once
let PC = {
  marks: { SP: {}, CPC: {} },             // brand → picture id → { v: 'ok' | 'bad', at, by, name, note, sku }
  v: 0,                                   // bumps on every change: hCtx (listing-rules.js) judges again
  loaded: false,
  loading: null,
  where: '',                              // 'shared' | 'browser' | 'visit' — where the marks are kept
  err: '',                                // why the shared place could not be read or written
  on: false,                              // the Picture check view is showing in Image Manager
  show: 'todo',                           // 'todo' (not checked yet) | 'done' (checked)
  shown: PC_PAGE,
  focus: '',                              // a picture id to put first (opened from Listing Health)
  busy: new Set(),                        // picture ids being saved
};
const pcIsTest = () => typeof window !== 'undefined' && !!window.__TEST_ERP;
// The person's name as the card says it: the part of the e-mail before the @ (and before a dot), capitalised.
const pcName = () => { const s = String((typeof ME !== 'undefined' && ME.email) || '').split(/[@._-]/)[0]; return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Someone'; };
const pcDate = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const pcEsc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));

/* ----- the marks: read once, saved on every click ----- */
async function pcLoad() {
  if (PC.loaded) return;
  if (PC.loading) return PC.loading;
  PC.loading = (async () => {
    let shared = {};
    try {
      const snap = await getDoc(doc(db, 'imgsnap', 'piccheck'));
      shared = snap.exists() ? snap.data() : {};
      PC.where = 'shared';
    } catch (e) {
      PC.where = 'browser';
      PC.err = String((e && e.message) || e);
    }
    let local = {};
    try { local = JSON.parse(localStorage.getItem(PC_STORE) || '{}') || {}; } catch (e) { /* no storage */ }
    // The newer of the shared mark and this browser's own, per picture.
    ['SP', 'CPC'].forEach(brand => {
      const out = Object.assign({}, (shared && shared[brand]) || {});
      Object.entries(local[brand] || {}).forEach(([id, mark]) => { if (!out[id] || (mark && mark.at > (out[id].at || 0))) out[id] = mark; });
      PC.marks[brand] = out;
    });
    if (pcIsTest()) PC.where = 'visit';
    PC.loaded = true;
    pcChanged();
  })();
  return PC.loading;
}
// A mark changed: every screen judges again (Listing Health through hCtx's key), and the Image Manager view redraws.
function pcChanged() {
  PC.v++;
  if (typeof H_CTX !== 'undefined') H_CTX = null;
  pcChip();
  if (PC.on) pcRender();
  const health = $('paneHealth');
  if (health && health.classList && !health.classList.contains('hide')) {
    if (typeof LI_WS !== 'undefined' && LI_WS.on && typeof liWsSchedule === 'function') liWsSchedule();
    else if (typeof hRedraw === 'function') hRedraw();
  }
}
// Mark one picture Looks OK ('ok') or Not OK ('bad'), with an optional note; saved for everyone where the app may write.
async function pcMark(brand, id, v, note, sku) {
  const mark = { v, at: Date.now(), by: (typeof ME !== 'undefined' && ME.email) || '', name: pcName(), note: String(note || '').trim().slice(0, 200), sku: sku || '' };
  PC.marks[brand] = PC.marks[brand] || {};
  PC.marks[brand][id] = mark;
  PC.busy.add(id);
  pcChanged();
  if (pcIsTest()) PC.where = 'visit';
  else {
    try {
      await setDoc(doc(db, 'imgsnap', 'piccheck'), { [brand]: { [id]: mark } }, { merge: true });
      PC.where = 'shared';
      PC.err = '';
    } catch (e) {
      // Refused (no right to write there, or offline): kept in this browser, and the page says so.
      try {
        const local = JSON.parse(localStorage.getItem(PC_STORE) || '{}') || {};
        local[brand] = Object.assign({}, local[brand] || {}, { [id]: mark });
        localStorage.setItem(PC_STORE, JSON.stringify(local));
      } catch (x) { /* no storage either: this visit only */ }
      PC.where = 'browser';
      PC.err = String((e && e.message) || e);
    }
  }
  PC.busy.delete(id);
  pcChanged();
}

/* ----- the pictures to judge: one per main picture of the brand ----- */
// [{ id, url, title, skus: [...], asin, mark }] from the Image Manager snapshot's live (catalogue) main pictures.
function pcPictures(brand) {
  const data = typeof IML !== 'undefined' ? IML[brand] : null;
  if (!data) return null;
  const by = new Map();
  (data.items || []).forEach(item => {
    if (!item || item.lvl === 'parent' || !item.live || !item.live.MAIN) return;
    const id = lrPicId(item.live.MAIN);
    const pic = by.get(id) || { id, url: item.live.MAIN, title: item.t || '', asin: item.asin || '', skus: [] };
    pic.skus.push(item.sku);
    by.set(id, pic);
  });
  const marks = PC.marks[brand] || {};
  return [...by.values()].map(pic => Object.assign(pic, { mark: marks[pic.id] || null }));
}
// The chip: "Picture check (N)" — N = main pictures of the brand nobody has looked at yet.
function pcChip() {
  const chip = $('imPcChip');
  if (!chip) return;
  const pics = pcPictures($('imBrand') ? $('imBrand').value : 'SP');
  const n = pics ? pics.filter(pic => !pic.mark).length : null;
  chip.innerHTML = `◐ Picture check <span class="sp-n">${n == null ? '…' : Number(n).toLocaleString('en-US')}</span>`;
  chip.classList.toggle('is-on', PC.on);
  chip.setAttribute('aria-pressed', String(PC.on));
}

/* ----- the view ----- */
function pcCardHtml(brand, pic) {
  const m = pic.mark;
  const state = m ? `<p class="pc-state"><span class="sp-chip-s ${m.v === 'ok' ? 'is-ready' : 'pc-bad'}"><i aria-hidden="true">${m.v === 'ok' ? '✓' : '✕'}</i>${m.v === 'ok' ? 'Looks OK' : 'Not OK'}</span>`
    + ` <span class="sp-dim">Checked by ${pcEsc(m.name || m.by || 'someone')} · ${pcDate(m.at)}${m.note ? ' · “' + pcEsc(m.note) + '”' : ''}</span></p>` : '';
  const busy = PC.busy.has(pic.id);
  return `<div class="card pc-card${m ? (m.v === 'ok' ? ' is-ok' : ' is-bad') : ''}${PC.focus === pic.id ? ' is-focus' : ''}" data-pc-id="${pcEsc(pic.id)}">`
    + `<div class="pc-pic"><img src="${pcEsc(pic.url)}" alt="${pcEsc('Main picture of ' + (pic.title || pic.skus[0]))}" loading="lazy" decoding="async"></div>`
    + `<div class="pc-body"><b class="pc-name" title="${pcEsc(pic.title)}">${pcEsc(pic.title || pic.skus[0])}</b>`
    + `<small class="sp-dim">${pcEsc(pic.skus[0])}${pic.skus.length > 1 ? ` · used on ${pic.skus.length} listings` : ''}</small>`
    + '<p class="pc-q">Is the background pure white, with no text or logo on the picture?</p>' + state
    + `<label class="pc-note-l">Note (optional)<input class="pc-note" data-pc-note="${pcEsc(pic.id)}" value="${pcEsc(m && m.note ? m.note : '')}" maxlength="200" placeholder="e.g. grey shadow at the bottom"></label>`
    + `<div class="pc-act"><button type="button" class="sp-main" data-pc-act="ok" data-pc-id="${pcEsc(pic.id)}" data-pc-sku="${pcEsc(pic.skus[0])}"${busy ? ' disabled' : ''}>✓ Looks OK</button>`
    + `<button type="button" class="sp-btn" data-pc-act="bad" data-pc-id="${pcEsc(pic.id)}" data-pc-sku="${pcEsc(pic.skus[0])}"${busy ? ' disabled' : ''}>✕ Not OK</button></div></div></div>`;
}
function pcRender() {
  const box = $('imPcWrap');
  if (!box || !PC.on) return;
  const brand = $('imBrand').value;
  const name = (typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brand]) || brand;
  const pics = pcPictures(brand);
  if (!pics || !PC.loaded) {
    box.innerHTML = '<div class="card pc-head"><b>Picture check</b><span class="sp-dim">Reading your pictures…</span></div><div class="pc-grid">'
      + Array.from({ length: 6 }, () => '<div class="card pc-card"><span class="sp-skel pc-skel-pic"></span><div class="pc-body"><span class="sp-skel is-w"></span><span class="sp-skel is-s"></span></div></div>').join('') + '</div>';
    return;
  }
  const todo = pics.filter(pic => !pic.mark);
  const done = pics.filter(pic => pic.mark);
  let list = PC.show === 'done' ? done.sort((a, b) => b.mark.at - a.mark.at) : todo;
  if (PC.focus) list = list.filter(pic => pic.id === PC.focus).concat(list.filter(pic => pic.id !== PC.focus));
  const page = list.slice(0, PC.shown);
  const where = PC.where === 'visit' ? 'Test site — your answers last for this visit only; they are not saved here.'
    : PC.where === 'browser' ? 'Your answers are kept in this browser only: the shared place could not be written' + (PC.err ? ` (${pcEsc(PC.err)})` : '') + '.'
      : 'Your answers are saved for everyone who uses Sellora.';
  const head = `<div class="card pc-head"><div><b>Picture check · ${pcEsc(name)}</b><p>${todo.length ? `${todo.length.toLocaleString('en-US')} main picture${todo.length === 1 ? '' : 's'} to look at. Look at each one and press <b>Looks OK</b> or <b>Not OK</b>.` : 'Every main picture has been looked at.'} `
    + `“Not OK” shows as a problem in Listing Health (“Replace the main picture”); “Looks OK” is remembered until the picture changes.</p><small class="sp-dim">${where}</small></div>`
    + `<div class="sp-seg" role="group" aria-label="Which pictures"><button type="button" class="${PC.show === 'todo' ? 'on' : ''}" data-pc-show="todo" aria-pressed="${PC.show === 'todo'}">To look at (${todo.length.toLocaleString('en-US')})</button>`
    + `<button type="button" class="${PC.show === 'done' ? 'on' : ''}" data-pc-show="done" aria-pressed="${PC.show === 'done'}">Checked (${done.length.toLocaleString('en-US')})</button></div></div>`;
  const empty = !page.length ? `<div class="card sp-empty"><b>${PC.show === 'done' ? 'No picture checked yet.' : 'Nothing to look at right now.'}</b><br>${PC.show === 'done' ? 'Pictures you mark show here.' : 'When a main picture changes on Amazon it comes back here to be looked at.'}</div>` : '';
  const more = list.length > page.length ? `<div class="sp-foot"><span>${page.length.toLocaleString('en-US')} of ${list.length.toLocaleString('en-US')}</span><button type="button" class="sp-btn" data-pc-more="1">Show ${Math.min(PC_PAGE, list.length - page.length)} more</button></div>` : '';
  box.innerHTML = head + empty + `<div class="pc-grid">${page.map(pic => pcCardHtml(brand, pic)).join('')}</div>` + more;
}
// Open the view (the chip, or a link from Listing Health); the list and the editor step aside.
async function pcOn() {
  PC.on = true;
  $('imListWrap').classList.add('hide');
  $('imEditWrap').classList.add('hide');
  $('imPcWrap').classList.remove('hide');
  pcChip();
  pcRender();
  const brand = $('imBrand').value;
  await Promise.all([pcLoad(), typeof IML !== 'undefined' && !(brand in IML) && typeof imListLoad === 'function' ? imListLoad(brand) : null]);
  pcChip();
  pcRender();
}
function pcOff() {
  if (!PC.on) return;
  PC.on = false;
  PC.focus = '';
  $('imPcWrap').classList.add('hide');
  $('imListWrap').classList.remove('hide');
  pcChip();
}
// From Listing Health's ◐ line: Image Manager, that brand, the Picture check with this listing's main picture first.
async function pcOpenFor(brand, sku) {
  if (typeof showTab === 'function') showTab('img');
  if ($('imBrand').value !== brand) {
    $('imBrand').value = brand;
    if (typeof $('imBrand').onchange === 'function') $('imBrand').onchange();
  }
  if (typeof IML !== 'undefined' && !(brand in IML) && typeof imListLoad === 'function') await imListLoad(brand);
  const item = ((IML[brand] && IML[brand].items) || []).find(each => each.sku === sku);
  PC.focus = item && item.live && item.live.MAIN ? lrPicId(item.live.MAIN) : '';
  const mark = PC.focus ? (PC.marks[brand] || {})[PC.focus] : null;
  PC.show = mark ? 'done' : 'todo';
  PC.shown = PC_PAGE;
  await pcOn();
  const card = PC.focus && $('imPcWrap').querySelector ? $('imPcWrap').querySelector(`[data-pc-id="${CSS.escape(PC.focus)}"] .sp-main`) : null;
  if (card) { card.scrollIntoView({ block: 'center' }); card.focus({ preventScroll: true }); }
}

/* ----- wiring ----- */
if (typeof document !== 'undefined' && document.addEventListener && $('imPcChip') && $('imPcChip').addEventListener) {
  $('imPcChip').addEventListener('click', () => (PC.on ? pcOff() : (PC.focus = '', pcOn())));
  // The Image Manager's own controls bring its list back; a brand change redraws whichever view is showing.
  ['imFilter', 'imView'].forEach(id => $(id).addEventListener('change', pcOff));
  $('imGo').addEventListener('click', pcOff);
  $('imBrand').addEventListener('change', () => {
    PC.shown = PC_PAGE;
    PC.focus = '';
    if (PC.on) { $('imListWrap').classList.add('hide'); pcOn(); } else pcChip();
  });
  $('imPcWrap').addEventListener('click', e => {
    const btn = e.target.closest ? e.target.closest('[data-pc-act],[data-pc-show],[data-pc-more]') : null;
    if (!btn) return;
    if (btn.dataset.pcShow) { PC.show = btn.dataset.pcShow; PC.shown = PC_PAGE; PC.focus = ''; pcRender(); return; }
    if (btn.dataset.pcMore) { PC.shown += PC_PAGE; pcRender(); return; }
    const id = btn.dataset.pcId;
    const note = $('imPcWrap').querySelector(`[data-pc-note="${CSS.escape(id)}"]`);
    pcMark($('imBrand').value, id, btn.dataset.pcAct === 'ok' ? 'ok' : 'bad', note ? note.value : '', btn.dataset.pcSku);
  });
  // "◐ A person needs to look — Open in Image Manager" on Listing Health's check lines.
  document.addEventListener('click', e => {
    const link = e.target && e.target.closest ? e.target.closest('[data-pc-open]') : null;
    if (!link) return;
    const sep = link.dataset.pcOpen.indexOf('|');
    pcOpenFor(link.dataset.pcOpen.slice(0, sep), link.dataset.pcOpen.slice(sep + 1));
  });
  // The marks are read when Listing Health or Image Manager first shows (Listing Health judges "Not OK" pictures as problems).
  ['paneHealth', 'paneImg'].forEach(id => {
    const pane = $(id);
    if (pane && typeof MutationObserver === 'function') new MutationObserver(() => { if (!pane.classList.contains('hide')) { pcLoad(); pcChip(); } }).observe(pane, { attributes: true, attributeFilter: ['class'] });
  });
}
