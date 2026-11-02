/* ================= MEERA HELPS FILL THE FORM (2026-10-22) =================
 *
 * Ravi: "can it also help in filling the live ERP if the user is unable to". In a task guide (guide-ask.js) she can:
 *   - show a drop-down's choices, or a name list's names, as big buttons in her bubble — one tap fills the real box
 *   - fill a drop-down that has only one choice, and say so
 *   - "Same as last time": the karigar, order and item from this person's last entry that really saved (kept on this
 *     device only, guideLast:<email>:<task>; numbers and dates are never repeated)
 *   - fill from a sentence: "Ramesh ko order 1234 ka 50 piece" → each part into its box
 * Every fill goes through the box's own change event, exactly as if the person had chosen it, so the form loads what
 * depends on it (the karigar list after the worker type, the sizes after the article).
 *
 * WHAT SHE NEVER DOES: press Save, Issue or any button that writes. The person checks the form and presses it — what goes
 * into the live registers is always looked at by a person, and the ERP's history keeps that person's name on it. */

const GF_MAX = 12;   // more choices than this: a find box over the buttons
/* Buttons she will never press, whatever a guide says: anything that writes, sends or prints is the person's. */
const GF_NEVER = /\b(save|issue|submit|delete|remove|send|approve|reject|export|print|confirm|accept|ship|post|raise|pay)\b/i;
const gfWait = ms => new Promise(r => setTimeout(r, ms));

/** The choices a box offers: a drop-down's options, or a name box's list. */
function gfOptions(el) {
  if (!el) return [];
  if (el.tagName === 'SELECT') return [...el.options].filter(o => o.value && !o.disabled).map(o => ({ v: o.value, t: (o.textContent || o.value).trim() }));
  const id = el.getAttribute('list'), dl = id && document.getElementById(id);
  return dl ? [...dl.options].filter(o => o.value).map(o => ({ v: o.value, t: (o.label || o.textContent || o.value).trim() || o.value })) : [];
}
/** Fill a box the way a person would: the value, then the box's own events. */
function gfSet(el, v) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return String(el.value) === String(v);
}
/** What a box shows: a drop-down's chosen text (the order number, not "— 50 pcs open"), or what was typed. */
function gfShown(el) {
  if (el.tagName === 'SELECT') { const o = el.options[el.selectedIndex]; return o ? o.textContent.split(' — ')[0].trim() : ''; }
  return String(el.value || '').trim();
}

/* ---------- the choices of one box, as buttons ---------- */
function guideFillOffer(s, el, task) {
  const box = $('gdPick'); if (!box) return;
  box.innerHTML = '';
  box.classList.add('hide');
  if (!task) return;
  const hi = guideLang() === 'hi', t = GUIDE.tour;
  /* the first step of a job she can fill: "Same as last time" and "type it in one line" */
  if (GUIDE.i === 0 && t && t.steps.some(st => st.wait === 'value')) { gfQuickDraw(box, t, hi); return; }
  if (!el || s.wait !== 'value') return;
  const opts = gfOptions(el);
  if (!opts.length) {
    /* the list is still being read (on the live site the order book takes a few seconds): offer it once it is there,
     * if the person is still on this step */
    const tour = GUIDE.tour, at = GUIDE.i, since = Date.now();
    const again = () => {
      if (GUIDE.tour !== tour || GUIDE.i !== at || !el.isConnected || Date.now() - since > 30000) return;
      if (gfOptions(el).length) guideFillOffer(s, el, task); else setTimeout(again, 600);
    };
    setTimeout(again, 600);
    return;
  }
  if (el.tagName === 'SELECT' && opts.length === 1 && !el.value) {
    gfSet(el, opts[0].v);
    box.innerHTML = `<div class="gd-pickhead">${hi ? 'एक ही विकल्प था — मैंने भर दिया:' : 'There was only one choice — I filled it:'} <b>${esc(opts[0].t)}</b></div>`;
    box.classList.remove('hide');
    return;
  }
  box.innerHTML = `<div class="gd-pickhead">${hi ? 'चुनने के लिए दबाएँ:' : 'Tap to choose:'}</div>`
    + (opts.length > GF_MAX ? `<input type="text" class="gd-optq" placeholder="${hi ? 'नाम या नंबर लिखकर ढूँढें…' : 'Type a name or number to find…'}">` : '')
    + '<div class="gd-opts"></div>';
  const list = box.querySelector('.gd-opts'), q = box.querySelector('.gd-optq');
  const draw = () => {
    const f = q ? q.value.trim().toLowerCase() : '';
    const show = opts.filter(o => !f || o.t.toLowerCase().includes(f) || String(o.v).toLowerCase().includes(f));
    list.innerHTML = show.slice(0, GF_MAX).map(o => `<button type="button" class="gd-opt" data-v="${esc(o.v)}">${esc(o.t)}</button>`).join('')
      + (show.length > GF_MAX ? `<span class="gd-more">+${show.length - GF_MAX} ${hi ? 'और — लिखकर ढूँढें' : 'more — type to find'}</span>` : '')
      + (!show.length ? `<span class="gd-more">${hi ? 'कुछ नहीं मिला' : 'Nothing matches'}</span>` : '');
  };
  draw();
  if (q) q.addEventListener('input', draw);
  list.addEventListener('click', e => { const b = e.target.closest('.gd-opt'); if (b) gfSet(el, b.dataset.v); });
  box.classList.remove('hide');
}

/* ---------- the quick ways in, at the start of a job ---------- */
function gfKey(id) { return guideKey('guideLast') + ':' + id; }
function gfLastOf(id) { try { return JSON.parse(localStorage.getItem(gfKey(id)) || 'null'); } catch (e) { return null; } }
/** After a save that really went through: what was chosen, for next time. Numbers and dates are never kept. */
function guideFillRemember(t) {
  if (!t || !t.id) return;
  const vals = [];
  t.steps.forEach(st => {
    if (st.wait !== 'value' || !st.sel) return;
    const el = guideTarget(st);
    if (!el || /^(number|date)$/i.test(el.type || '')) return;
    const v = String(el.value || '').trim();
    if (v) vals.push([st.sel, v, gfShown(el)]);
  });
  if (vals.length) try { localStorage.setItem(gfKey(t.id), JSON.stringify(vals)); } catch (e) { /* this device keeps nothing: fine */ }
}
function gfQuickDraw(box, t, hi) {
  const last = gfLastOf(t.id);
  box.innerHTML = `<div class="gd-pickhead">${hi ? 'जल्दी भरें:' : 'Fill it quickly:'}</div>`
    + (last && last.length ? `<button type="button" class="gd-opt gd-last">${hi ? 'पिछली बार जैसा' : 'Same as last time'}: ${esc(last.map(x => x[2]).join(' · '))}</button>` : '')
    + `<div class="gd-say"><input type="text" class="gd-optq" placeholder="${hi ? 'एक लाइन में लिखें, जैसे: रमेश को ऑर्डर 1234 का 50 पीस' : 'Or type it in one line, e.g. Ramesh ko order 1234 ka 50 piece'}">`
    + `<button type="button" class="gd-opt gd-fillsay">${hi ? 'भरो' : 'Fill'}</button></div>`;
  box.classList.remove('hide');
  const lastBtn = box.querySelector('.gd-last');
  if (lastBtn) lastBtn.onclick = () => gfRun(t, gfFromLast(last));
  const inp = box.querySelector('.gd-optq');
  const go = () => { const v = inp.value.trim(); if (v) gfRun(t, gfFromSentence(v)); };
  box.querySelector('.gd-fillsay').onclick = go;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}
const gfFromLast = last => (st, el) => { const x = (last || []).find(r => r[0] === st.sel); return x ? x[1] : null; };

/** "Ramesh ko order 1234 ka 50 piece": for each box, the choice the sentence names. A drop-down's choice is found by its
 * name or by a number in it (order 1234 → "ORD-1234"); pieces need a word for pieces after the number. */
function gfFromSentence(text) {
  const s = ' ' + String(text).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ') + ' ';
  const nums = s.match(/\d+/g) || [];
  const pcs = (/(\d+)\s*(pcs|pc|piece|pieces|peace|pis|nag|nang|पीस|नग)(?=\s)/.exec(s) || [])[1];
  return (st, el) => {
    if (el.type === 'number') return /pcs|piece|checked|qty/i.test(el.id + ' ' + (el.placeholder || '')) && pcs ? pcs : null;
    const opts = gfOptions(el);
    let best = null, bs = 0, tie = false;
    for (const o of opts) {
      let sc = 0;
      for (const k of [String(o.v), o.t.split(' — ')[0]].map(x => x.toLowerCase().trim()).filter(x => x.length >= 2)) {
        if (s.includes(' ' + k + ' ')) sc = Math.max(sc, 10 + k.length);                       // the whole name
        const runs = k.match(/\d{2,}/g) || [];
        if (runs.some(r => nums.includes(r) && r !== pcs)) sc = Math.max(sc, 8 + runs.join('').length);   // its number
        const first = k.split(/\s+/)[0];
        if (first.length >= 4 && !/^\d+$/.test(first) && s.includes(' ' + first + ' ')) sc = Math.max(sc, 3);   // its first word
      }
      if (sc > bs) { bs = sc; best = o; tie = false; } else if (sc && sc === bs) tie = true;
    }
    return best && !tie ? best.v : null;
  };
}

/** Fill the job's boxes in order — each fill lets the form load what depends on it — then take the person to the first
 * box still empty, or to Save, with a note of what she filled. She stops there: Save is theirs. */
async function gfRun(t, pick) {
  const hi = guideLang() === 'hi';
  const opener = t.steps.find(st => st.skip && st.sel);
  if (opener && !guideTarget({ sel: opener.skip })) { const b = guideTarget(opener); if (b && !GF_NEVER.test(b.textContent || '')) { GUIDE.selfClick = true; try { b.click(); } finally { GUIDE.selfClick = false; } await gfWait(600); } }   // opening the form is hers to do; Save never is
  const filled = [];
  const steps = t.steps.filter(st => st.wait === 'value' && st.sel);
  for (let k = 0; k < steps.length; k++) {
    if (GUIDE.tour !== t) return;
    const st = steps[k], el = guideTarget(st);
    if (!el || String(el.value || '').trim()) continue;
    let v = pick(st, el);
    /* Not named, but the next box's list depends on it ("Ramesh" is only in the Karigar list): try each choice, keep the
     * one that brings up what the sentence names in the next box. */
    if ((v == null || v === '') && el.tagName === 'SELECT' && steps[k + 1]) {
      const opts = gfOptions(el);
      if (opts.length > 1 && opts.length <= 6) {
        for (const o of opts) {
          gfSet(el, o.v); await gfWait(300);
          const nx = guideTarget(steps[k + 1]), w = nx && pick(steps[k + 1], nx);
          if (w != null && w !== '') { v = o.v; break; }
        }
        if (v == null || v === '') { gfSet(el, ''); await gfWait(200); }
      }
    }
    if (v == null || v === '') continue;
    if (gfSet(el, v)) { filled.push(gfShown(el) || v); await gfWait(400); }
  }
  if (GUIDE.tour !== t) return;
  GUIDE.note = filled.length
    ? (hi ? 'मैंने भरा: ' : 'I filled: ') + '<b>' + filled.map(esc).join(' · ') + '</b>. ' + (hi ? 'फ़ॉर्म पर देख लें — बाकी भरें, फिर Save खुद दबाएँ।' : 'Check them on the form — fill the rest, then press Save yourself.')
    : (hi ? 'उस लाइन से मैं कुछ नहीं भर पाई — चलिए एक-एक बॉक्स भरते हैं।' : 'I could not fill anything from that — let\'s go box by box.');
  GUIDE.noteOk = filled.length > 0;   // a note of what she did, not a problem
  GUIDE.fast = filled.length > 0;
  GUIDE.dir = 1;
  const next = t.steps.findIndex((st, i) => i > 0 && ((st.wait === 'value' && st.sel && guideTarget(st) && !String(guideTarget(st).value || '').trim()) || st.save));
  GUIDE.i = next > 0 ? next : 1;
  guideShow();
}
/** A job started from a question that already says what ("Ramesh ko order 1234 ka 50 piece dena hai"): fill from it. */
function guideFillFromQuestion(t, q) {
  if (!q || !/\d/.test(q)) return;
  setTimeout(() => { if (GUIDE.tour === t) gfRun(t, gfFromSentence(q)); }, 1100);
}
