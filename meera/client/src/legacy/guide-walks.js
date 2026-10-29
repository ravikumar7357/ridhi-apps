/* ================= A WALK-THROUGH FOR EVERY JOB, FROM ANY STEP (2026-10-26) =================
 *
 * Ravi: "can meera also teach those 251 jobs in any pattern and even when if the user is stuck in between the process".
 *
 * THE WALKS: /guide/meera-walks.json, fetched with the answer bank (never with the page). Each is a task guide like the
 * eight in GUIDE_TASKS — a screen, the box or button to light, what to wait for — and names the bank answers it belongs
 * to, so that answer offers it. Three ways to learn one job:
 *   - Just tell me     the answer's own steps, as text (gaBankAnswer)
 *   - Show me          she lights each box in turn and says what goes in it; nothing is waited for and nothing is saved
 *                      (only the button that opens a form must be pressed, to see the form)
 *   - Do it with me    the task guide: she waits for each box, and watches the Save for a red line
 * FROM THE MIDDLE: a form half filled in is read for which job it is and how far it has got (gaWalkHere); the walk
 * starts at the first box still empty, passing over what is done.
 * STUCK: the same red line twice, or a half-filled form left alone for a while, brings one quiet offer above her button
 * ("Stuck? I can take you through the rest") — once per form, never during a walk, never with the helper off, and not at
 * all after three "No thanks".
 */
let GA_WALK_OF = new Map(), GA_WALKS_P = null;
/* a button that starts a job (its walk's first press, e.g. #acNewItem): its own one-line answer offers the walk too */
const GA_WALK_SEL = new Map();
function gaWalksLoad() {
  if (!GA_WALKS_P) GA_WALKS_P = fetch('/guide/meera-walks.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : [])).catch(() => [])
    .then(list => {
      (Array.isArray(list) ? list : []).forEach(w => {
        if (!w || !w.id) return;
        /* a walk that takes the place of one of the eight keeps that one's id, so answers that name it get the new steps */
        const old = w.replaces && GUIDE_TASKS.find(t => t.id === w.replaces);
        if (old && Array.isArray(w.steps) && w.steps.length) { old.steps = w.steps; if (w.title) old.title = w.title; }
        const id = old ? old.id : w.existing && GUIDE_TASKS.some(t => t.id === w.existing) ? w.existing : w.id;
        if (id === w.id && Array.isArray(w.steps) && w.steps.length && !GUIDE_TASKS.some(t => t.id === w.id))
          GUIDE_TASKS.push({ id: w.id, k: [], need: ['-'], title: w.title, steps: w.steps, admin: !!w.admin, walk: true });
        (w.from || []).forEach(b => { if (!GA_WALK_OF.has(b)) GA_WALK_OF.set(b, id); });
        const go = (w.steps || []).find(s => s.sel && s.wait === 'click');
        if (go && /^#[\w-]+$/.test(go.sel) && !GA_WALK_SEL.has(go.sel)) GA_WALK_SEL.set(go.sel, id);
      });
      return GA_WALK_OF;
    });
  return GA_WALKS_P;
}
/** The walk for a bank answer, if it has one this account can follow. */
function gaWalkFor(e) {
  const id = (e.task && GUIDE_TASKS.some(t => t.id === e.task)) ? e.task : GA_WALK_OF.get(e.id) || (e.sel && GA_WALK_SEL.get(e.sel));
  const t = id && GUIDE_TASKS.find(x => x.id === id);
  if (!t || (t.admin && !ERP_MEERA.user().admin)) return null;
  return t.steps.some(s => s.tab && !guideMayOpen(s.tab)) ? null : t;
}
/** A step's box as it is now: there, and filled or not. */
const gaStepEl = s => (s.sel ? guideTarget(s) : null);
const gaFilled = el => !!el && String(el.value || '').trim() !== '';
/** Which job the open form is, and how far it has got: the walk on this screen with the most of its boxes showing,
 * at least one of them filled. null when no form is half done. */
function gaWalkHere() {
  const tab = gaHere();
  let best = null;
  for (const t of GUIDE_TASKS) {
    if (!t.steps.some(s => s.tab === tab)) continue;
    const boxes = t.steps.filter(s => s.wait === 'value' && (!s.tab || s.tab === tab)).map(s => ({ s, el: gaStepEl(s) })).filter(x => x.el);
    const done = boxes.filter(x => gaFilled(x.el)).length;
    if (boxes.length < 2 || !done) continue;
    if (!best || boxes.length > best.shown || (boxes.length === best.shown && done > best.done)) {
      const next = boxes.find(x => !gaFilled(x.el));
      best = { t, shown: boxes.length, done, next: next ? next.s : null, total: t.steps.filter(s => s.wait === 'value').length };
    }
  }
  return best;
}
/** Where a walk picks up: the first box on screen still empty, else its Save; the start when nothing is open. */
function gaWalkStartAt(t) {
  const i = t.steps.findIndex(s => (s.wait === 'value' && gaStepEl(s) && !gaFilled(gaStepEl(s))) || (s.save && gaStepEl(s)));
  return i < 0 ? 0 : i;
}
/** "Show me": the same steps, nothing waited for. A press that only opens a form or a view, Meera makes herself on Next;
 * a press that saves, sends, deletes or asks to confirm is only pointed at (live, 26 Oct: Start, Cancel, Approve waited). */
const GA_SHOW_NOT_OPEN = /for real|saves|असली|delete|cancel|approve|reject|send|start|ask sales|fixed|strike|हटा|कैंसल/i;
function gaShowSteps(t) {
  return t.steps.map(s => {
    const c = Object.assign({}, s);
    if (c.save) {
      delete c.wait; delete c.save;
      c.en = 'When you do it for real, you press this — it saves. Not now: this is only a look round. ' + (s.en || '');
      c.hi = 'असली में करते समय यह दबाना है — इससे सेव होता है। अभी नहीं: यह सिर्फ़ दिखाने के लिए है। ' + (s.hi || s.en || '');
    } else {
      if (c.wait === 'click' && !GA_SHOW_NOT_OPEN.test(s.en || '')) c.open = true;   // pressed by Meera only if the button itself reads as an opener (guideGo)
      else if (c.wait === 'click') {
        c.en = 'In the real job you press this. Not now: this is only a look round. ' + (s.en || '');
        c.hi = 'असली काम में यह दबाना है। अभी नहीं: यह सिर्फ़ दिखाने के लिए है। ' + (s.hi || s.en || '');
      }
      delete c.wait;
    }
    return c;
  });
}
/** The walk's first button is not on this person's screen (live, 26 Oct: Finished Goods' Scan in / out is hidden without
 * the entry right): say so, rather than pass over the steps that need it. A button on a line: there is no line yet. */
function gaWalkMissing(t) {
  const first = t.steps.find(x => x.sel && x.wait === 'click');
  if (!first || (first.tab && gaHere() !== first.tab)) return null;
  return guideTarget(first) || (first.skip && guideTarget({ sel: first.skip })) ? null : first;
}
function gaWalkSayMissing(first) {
  const name = ((first.en || '').match(/<b>(.*?)<\/b>/) || [])[1] || '', hi = guideLang() === 'hi', row = /\[data-/.test(first.sel);
  guideAskOpen();
  gaSay(row ? (hi ? `यहाँ अभी कोई लाइन नहीं है जिस पर यह काम हो — <b>${name}</b> लाइन पर तभी दिखता है जब कोई लाइन हो।` : `There is no line here to do this on yet — <b>${name}</b> shows on a line once there is one.`)
    : (hi ? `आपकी स्क्रीन पर <b>${name}</b> नहीं दिख रहा। यह सिर्फ़ उन लोगों को दिखता है जिनके पास इस काम का अधिकार है — ज़रूरत हो तो एडमिन से कहें।` : `I can't see <b>${name}</b> on your screen. It shows only for people with the right for this job — ask your admin if you need it.`), []);
}
/** On the walk's screen already: asked before it starts. Opened by the walk: looked at once the screen is up — the walk
 * may have passed over every step and closed by then, so a walk of its own still running is the only thing that stops it. */
function gaWalkCheck(t) {
  const tour = GUIDE.tour;
  setTimeout(() => {
    if (GUIDE.tour && GUIDE.tour !== tour) return;   // the person started something else
    const first = gaWalkMissing(t); if (!first) return;
    if (GUIDE.tour === tour) guideClose();
    gaWalkSayMissing(first);
  }, 1600);
}
/** Start a job's walk: 'do' (with me, from the start), 'show' (a look round), 'resume' (from where the form has got to). */
function gaWalkStart(id, mode, q) {
  const t = GUIDE_TASKS.find(x => x.id === id); if (!t) return;
  if (mode !== 'resume') { const miss = gaWalkMissing(t); if (miss) { gaWalkSayMissing(miss); return; } }   // its first button is not on this screen
  guideAskClose();
  if (mode === 'show') {
    guideBuild();
    guideRingOff(); GUIDE.paused = null; if ($('gdResume')) $('gdResume').classList.add('hide');
    GUIDE.tour = { kind: 'task', id, title: t.title, steps: gaShowSteps(t), show: true };
    GUIDE.i = 0; GUIDE.dir = 1;
    guideShow();
    gaWalkCheck(t);
    return;
  }
  guideTaskStart(id, q);
  if (mode === 'do') gaWalkCheck(t);
  if (mode === 'resume' && GUIDE.tour && GUIDE.tour.id === id) {
    const at = gaWalkStartAt(GUIDE.tour);
    if (at > 0) {
      const hi = guideLang() === 'hi';
      GUIDE.note = hi ? 'आपने जितना भरा है, वह रहने दिया — यहाँ से आगे चलते हैं।' : 'What you have filled in stays — we carry on from here.';
      GUIDE.noteOk = true;
      GUIDE.fast = true;
      GUIDE.i = at; guideShow();
    }
  }
}
/** The buttons a job's answer gets: Show me, and Do it with me (or Carry on, when its form is half done already). */
function gaWalkActs(t, L) {
  if (!t) return [];
  const here = gaWalkHere();
  const acts = [];
  if (here && here.t.id === t.id) acts.push({ t: 'wresume', id: t.id, label: L('Carry on from where I am', 'जहाँ हूँ वहाँ से आगे करवाएँ', 'Jahan hoon wahan se aage karwaiye') });
  else acts.push({ t: 'wdo', id: t.id, label: L('Do it with me', 'मेरे साथ करें', 'Mere saath kijiye') });
  acts.push({ t: 'wshow', id: t.id, label: L('Show me how', 'करके दिखाएँ', 'Karke dikhaiye') });
  return acts;
}
/** "ab kya karu", "what next", "atak gaya": the form on screen read for the next box. null when none is half done. */
const GA_NEXT_RE = /\b(what next|what now|next step|now what|stuck|ab kya|aage kya|iske baad|uske baad|kya karu ab|ab kya karu|atak|atka|atki|phas|fas gaya)\b|आगे क्या|अब क्या|अटक|फँस|इसके बाद/i;
function gaWalkNext(lang, L) {
  const h = gaWalkHere(); if (!h) return null;
  const title = lang === 'hi' ? h.t.title.hi : lang === 'hg' ? (h.t.title.hg || h.t.title.en) : h.t.title.en;
  const nx = h.next ? (lang === 'hi' ? h.next.hi : h.next.en) : '';
  return { html: L(`You are doing <b>${esc(title)}</b> — ${h.done} of ${h.shown} boxes filled.`, `आप <b>${esc(title)}</b> कर रहे हैं — ${h.shown} में से ${h.done} बॉक्स भरे हैं।`, `Aap <b>${esc(title)}</b> kar rahe hain — ${h.shown} me se ${h.done} box bhare hain.`)
      + (nx ? `<div class="ga-do"><b>${L('Next', 'अगला', 'Agla')}</b>${nx}</div>` : `<div class="ga-do">${L('Every box is filled — check them and save.', 'सब बॉक्स भरे हैं — चेक करके सेव करें।', 'Sab box bhare hain — check karke save kijiye.')}</div>`),
    acts: [{ t: 'wresume', id: h.t.id, label: L('Carry on with me', 'मेरे साथ आगे करें', 'Mere saath aage kijiye') }] };
}

/* ---------- the quiet offer when someone is stuck ---------- */
const GA_NUDGE = { told: new Set(), red: new Map(), lastAct: Date.now(), shown: false };
const GA_NUDGE_IDLE_MS = 75000;
function gaNudgeOff() { return (+guideGet('guideNudgeNo', '0') || 0) >= 3; }
function gaNudgeShow(key, why) {
  if (GA_NUDGE.shown || GA_NUDGE.told.has(key) || gaNudgeOff() || !guideIsOn() || GUIDE.tour) return;
  if ($('gdAsk') && !$('gdAsk').classList.contains('hide')) return;
  GA_NUDGE.told.add(key); GA_NUDGE.shown = true;
  const hi = guideLang() === 'hi';
  let n = $('gdNudge');
  if (!n) { n = document.createElement('div'); n.id = 'gdNudge'; n.setAttribute('role', 'status'); document.body.appendChild(n); }
  n.innerHTML = `<span>${why === 'red' ? (hi ? 'यह फिर रुक गया? मैं वजह बता सकती हूँ।' : 'Stopped again? I can tell you why.') : (hi ? 'अटक गए? बाकी मैं साथ में करवा सकती हूँ।' : 'Stuck? I can take you through the rest.')}</span>`
    + `<button type="button" data-n="yes">${hi ? 'हाँ, मदद करें' : 'Yes, help me'}</button><button type="button" class="ghost" data-n="no">${hi ? 'नहीं, धन्यवाद' : 'No thanks'}</button>`;
  n.classList.remove('hide');
  n.onclick = e => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    n.classList.add('hide'); GA_NUDGE.shown = false;
    if (b.dataset.n === 'no') { guideSet('guideNudgeNo', String(Math.min(9, (+guideGet('guideNudgeNo', '0') || 0) + 1))); return; }
    guideSet('guideNudgeNo', '0');
    if (why === 'red') { guideAskOpen(hi ? 'यह सेव क्यों नहीं हो रहा?' : 'Why isn\'t this working?'); return; }
    const h = gaWalkHere();
    if (h) gaWalkStart(h.t.id, 'resume'); else guideAskOpen();
  };
}
function gaNudgeHide() { const n = $('gdNudge'); if (n) n.classList.add('hide'); GA_NUDGE.shown = false; }
/** Watching quietly: a press or a key resets the idle clock; every few seconds the screen is glanced at. */
function gaNudgeWatch() {
  const acted = e => { if (e.isTrusted) GA_NUDGE.lastAct = Date.now(); };
  document.addEventListener('pointerdown', acted, true);
  document.addEventListener('keydown', acted, true);
  const iv = setInterval(() => {
    if (document.hidden || GUIDE.tour || !guideIsOn() || gaNudgeOff()) { if (GUIDE.tour) gaNudgeHide(); return; }
    /* the same red line come back after a fresh press: the second time, an offer */
    const red = typeof gaRedLines === 'function' ? gaRedLines()[0] : null;
    if (red) {
      const seen = GUIDE.seenErr.get(red.id), k = red.id + ':' + guideNorm(red.textContent || '');
      if (seen) {
        const r = GA_NUDGE.red.get(k) || { n: 0, at: 0 };
        if (seen.at !== r.at) { r.n++; r.at = seen.at; GA_NUDGE.red.set(k, r); }
        if (r.n >= 2) gaNudgeShow('red:' + k, 'red');
      }
    }
    /* a half-filled form, left alone */
    if (Date.now() - GA_NUDGE.lastAct > GA_NUDGE_IDLE_MS && GUIDE_TASKS.length && typeof gaHere === 'function') {
      const h = gaWalkHere();
      if (h && h.next) gaNudgeShow('idle:' + h.t.id + ':' + gaHere(), 'idle');
    }
  }, 4000);
  if (iv && iv.unref) iv.unref();   // a test run of the page in node is not kept open by it
}
/* started here, not from guideBuild (guide.js runs first, before this file's own values exist) */
gaNudgeWatch();

/* ---------- loaded early (Ravi, 27 Oct: "make meera a bit fast in loading") ----------
 * Her answers, walk-throughs and meaning file (about 2 MB in all) were fetched only when Ask Meera first opened, so the
 * first answer waited for them. Now they are downloaded in the background a few seconds after someone is signed in, when
 * the browser is idle — downloaded only, into the browser's cache: nothing is read or worked out on the page until Ask
 * Meera opens (building her search index takes about a second, more on a phone, and must not slow anyone's work). Not
 * for a printer's sign-in, nor on a phone saving data. On later visits the browser only asks whether they changed. */
const gaLater = (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); };   // never keeps a test run open
function gaPreload(tries) {
  let signedIn = false;
  try { signedIn = ERP_MEERA.signedIn(); } catch (e) { /* not signed in yet */ }
  if (!signedIn) { if (tries < 30) gaLater(() => gaPreload(tries + 1), 10000); return; }   // waits for the sign-in (up to 5 min)
  try { if (ERP_MEERA.user().vendor) return; } catch (e) { /* not known: go on */ }
  try { if (navigator.connection && navigator.connection.saveData) return; } catch (e) { /* not known: go on */ }
  const go = () => ['/guide/meera-bank.json', '/guide/meera-walks.json', '/guide/meera-words.bin']
    .forEach(u => fetch(u, { cache: 'no-cache' }).then(r => r.arrayBuffer()).catch(() => null));
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 8000 }); else gaLater(go, 1000);
}
gaLater(() => gaPreload(0), 4000);
