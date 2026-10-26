/* ================= THE GUIDE CHARACTER (2026-10-21) =================
 *
 * Ravi: a helper "like in Clash of Clans" — a character in the corner who teaches each page the first time it is
 * opened, a button to switch it off, and when somebody gets the same thing wrong three times, the screen goes dim
 * except the thing they are getting wrong and the character pops up and explains it.
 *
 * WHAT IT DOES
 *   - FIRST VISIT: the first time a person opens a screen, Meera walks them round it, one box at a time. The rest
 *     of the page is dimmed; the box being talked about is lit, with an arrow on it. Next / Back / Skip. It is shown
 *     once per screen per person (localStorage guideSeen:<email>); "Show me" in the top bar plays it again.
 *   - THREE STRIKES: every screen already says what went wrong the same way — a message line (soMsg, pkMsg, bwMsg…)
 *     given the class 'err'. The guide watches for that, so no screen had to change. The same mistake three times
 *     (GUIDE_STRIKES) inside GUIDE_WINDOW_MS, and the screen dims round the box the person was working in, and
 *     Meera says what the message means and how to put it right (GUIDE_FIX; a plain fallback for the rest).
 *     Scan to pack's red line (pksSay with bad) and a box the browser refuses (the 'invalid' event) count the same way.
 *   - THE SWITCH: "Helper On/Off" in the top bar, and "Turn off" in every bubble. Off means no first-visit walks and
 *     no three-strikes lessons; "Show me" still works when asked. Kept per person (guideOff:<email>).
 *   - English or Hindi: the EN · हिं switch in the bubble (guideLang), the same two languages as /guide/.
 *
 * WHAT IT NEVER DOES: press a button, change a box, or save anything. It only dims, points and talks. While it is
 * open, clicks on the page are held back so a walk-round cannot set anything off by accident. */

const GUIDE_STRIKES = 3;                    // the same mistake this many times → the lesson
const GUIDE_WINDOW_MS = 15 * 60 * 1000;     // …inside this long; older strikes are forgotten
const GUIDE_FOOT = 300;                    // the bottom of the screen Meera and her bubble stand in
const GUIDE_ACT_MS = 8000;                  // a red line this soon after a click or key is the person's doing
const GUIDE_TYPE_MS = 12;                  // the bubble's words appear a few letters at a time, like a game…
const GUIDE_TYPE_STEP = 4;                 // …four a tick: a long sentence is out in about half a second
const GUIDE = { tour: null, i: 0, typing: 0, miss: {}, field: null, btn: null, seenErr: new Map(), built: false };

/** Kept per person, so two people sharing a computer each get their own walk-rounds. */
function guideKey(k) { return k + ':' + ((typeof ME !== 'undefined' && ME && ME.email) || 'anon'); }
function guideGet(k, d) { try { const v = localStorage.getItem(guideKey(k)); return v == null ? d : v; } catch (e) { return d; } }
function guideSet(k, v) { try { localStorage.setItem(guideKey(k), v); } catch (e) { /* private window: it still works this visit */ } }
const guideIsOn = () => guideGet('guideOff', '') !== '1';
const guideLang = () => { try { return localStorage.getItem('guideLang') === 'hi' ? 'hi' : 'en'; } catch (e) { return 'en'; } };
function guideSeen() { try { return JSON.parse(guideGet('guideSeen', '[]')) || []; } catch (e) { return []; } }
function guideMarkSeen(tab) { const s = guideSeen(); if (!s.includes(tab)) { s.push(tab); guideSet('guideSeen', JSON.stringify(s)); } }

/* MEERA — the assistant, our own character (22 Oct): GUIDE_IMG, guide-art.js. She stands free in the
 * bottom corner while she talks; her face, cropped round, is the small icon on "Show me" and the Continue pill. */
const GUIDE_ART = `<img class="gd-pic" src="${GUIDE_IMG}" alt="" draggable="false">`;
const GUIDE_FACE = `<span class="gd-face" style="background-image:url(${GUIDE_IMG})" aria-hidden="true"></span>`;

/** The pieces on the page: the dim, the lit box, the arrow, Meera and her bubble, and the top-bar switch. */
function guideBuild() {
  if (GUIDE.built || typeof document === 'undefined' || !document.body) return;
  GUIDE.built = true;
  const root = document.createElement('div');
  root.id = 'gdRoot';
  root.className = 'hide';
  root.innerHTML = `
    <div id="gdBlock"></div>
    <div id="gdSpot"></div>
    <div id="gdArrow" aria-hidden="true"></div>
    <div id="gdChar">${GUIDE_ART}</div>
    <div id="gdBubble" role="dialog" aria-live="polite" aria-labelledby="gdText">
      <div class="gd-bar"><i id="gdProg"></i></div>
      <div class="gd-top">${GUIDE_FACE}<span class="gd-who"><span><b>Meera</b> <span class="gd-role">· ERP assistant</span></span><span id="gdChip" class="gd-chip"></span></span><span id="gdCount" class="gd-count"></span>
        <span class="gd-lang"><button type="button" data-gd-lang="en">EN</button><button type="button" data-gd-lang="hi">हिं</button></span></div>
      <div id="gdText"></div>
      <div id="gdDo" class="gd-do hide"></div>
      <div id="gdPick" class="gd-pick hide"></div>
      <div class="gd-acts">
        <button type="button" id="gdOff" class="gd-link"></button>
        <span style="flex:1"></span>
        <button type="button" id="gdBack" class="ghost"></button>
        <button type="button" id="gdTry" class="gd-try"></button>
        <button type="button" id="gdNext"></button>
      </div>
    </div>`;
  document.body.appendChild(root);
  /* THE RING: a glow round one box with the page left working — after "Try it" and "Fix it now". And the pill
   * that brings the walk-round back after a "Try it". */
  const ring = document.createElement('div'); ring.id = 'gdRing'; ring.className = 'hide'; document.body.appendChild(ring);
  const pill = document.createElement('button'); pill.id = 'gdResume'; pill.type = 'button'; pill.className = 'hide';
  pill.innerHTML = GUIDE_FACE + '<span></span>'; document.body.appendChild(pill);
  pill.onclick = () => { const r = GUIDE.paused; guideRingOff(); pill.classList.add('hide'); if (r) { GUIDE.tour = r.tour; GUIDE.i = r.i; guideGo(1); } };
  $('gdNext').onclick = () => guideGo(1);
  $('gdBack').onclick = () => guideGo(-1);
  $('gdTry').onclick = () => guideTry();
  $('gdOff').onclick = () => guideGo(1);   // Skip this step (the Helper switch is in her round button's menu)
  $('gdText').onclick = () => guideTypeAll();
  root.querySelectorAll('[data-gd-lang]').forEach(b => b.onclick = () => {
    try { localStorage.setItem('guideLang', b.dataset.gdLang); } catch (e) { /* this visit only */ }
    guideShow();
  });
  /* The walk-round holds the keyboard too: Enter / → on, ← back, Esc closes. */
  document.addEventListener('keydown', e => {
    if (e.key === '?' && !GUIDE.tour && !(e.target.closest && e.target.closest('input, textarea, select, [contenteditable]'))) { e.preventDefault(); guideAskOpen(); return; }
    if (!GUIDE.tour) return;
    if (GUIDE.live) { if (e.key === 'Escape') { e.preventDefault(); guideClose(); } return; }   // the person is typing in the page
    if (e.key === 'Escape') { e.preventDefault(); guideClose(); }
    else if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); guideGo(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); guideGo(-1); }
  }, true);
  window.addEventListener('resize', () => { if (GUIDE.tour) guidePlace(); guideRingPlace(); });
  window.addEventListener('scroll', () => { if (GUIDE.tour) guidePlace(); guideRingPlace(); }, true);

  /* THE SWITCH, in the bar beside the screen's title (on a phone, in the header). */
  const ctl = document.createElement('span');
  ctl.id = 'gdCtl';
  ctl.innerHTML = `<button type="button" id="gdAskBtn" title="Ask Meera anything — English, Hindi or Hinglish (or press ?)"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3"/><path d="M12 16.5h.01"/></svg><span>Ask Meera</span></button>`
    + `<button type="button" id="gdShow" title="Walk me round this screen · इस स्क्रीन को समझाओ">${GUIDE_FACE}<span>Show me</span></button>`
    + `<button type="button" id="gdSwitch" role="switch" title="The helper: first-visit walk-rounds and help after repeated mistakes"><i></i><span></span></button>`;
  const host = $('topActs'), phone = typeof mobOn === 'function' && mobOn() && $('mobHead');
  if (phone) phone.appendChild(ctl);   // a phone hides the top bar; its header is where the switch can be seen
  else if (host && host.parentNode) host.parentNode.insertBefore(ctl, host.nextSibling);
  else document.body.appendChild(ctl);
  /* the page in front: a screen, or a page that is not one (R-one's My work today) — gaHere, guide-ask.js */
  $('gdShow').onclick = () => guideStart(typeof gaHere === 'function' ? gaHere() : typeof TAB_NOW !== 'undefined' ? TAB_NOW : '', true);
  $('gdSwitch').onclick = () => guideSwitch(!guideIsOn());
  $('gdAskBtn').onclick = () => guideAskOpen();
  /* HER ROUND BUTTON, bottom-right ("Ask Meera" on hover), and its menu: Ask Meera, Show me this screen, Helper on/off.
   * The top bar's own buttons give way to it (styles.css); they stay in the page, and the menu presses them. */
  const go = document.createElement('button');
  go.type = 'button';
  go.id = 'gdLaunch';
  go.title = 'Ask Meera — English, Hindi or Hinglish (or press ?)';
  go.setAttribute('aria-label', 'Ask Meera');
  go.innerHTML = `${GUIDE_FACE}<span class="gd-lab">Ask Meera</span>`;
  document.body.appendChild(go);
  const menu = document.createElement('div');
  menu.id = 'gdMenu';
  menu.className = 'hide';
  menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);
  const shut = () => menu.classList.add('hide');
  const draw = () => {
    const hi = guideLang() === 'hi', on = guideIsOn();
    menu.innerHTML = `<button type="button" data-m="ask">💬<span><b>Ask Meera</b><small>${hi ? 'इंग्लिश, हिंदी या हिंग्लिश' : 'English, Hindi or Hinglish'}</small></span></button>`
      + `<button type="button" data-m="show">🧭<span><b>${hi ? 'यह स्क्रीन दिखाओ' : 'Show me this screen'}</b><small>${hi ? 'एक-एक स्टेप, घुमाकर' : 'A walk round, step by step'}</small></span></button>`
      + `<button type="button" data-m="help" role="switch" aria-checked="${on}"><i class="gd-sw${on ? ' on' : ''}"></i><span><b>Helper ${on ? 'on' : 'off'}</b><small>${on ? (hi ? 'नई स्क्रीन पर साथ चलती है' : 'Walks new screens with you') : (hi ? 'सिर्फ़ पूछने पर' : 'Only when you ask')}</small></span></button>`;
  };
  go.onclick = e => { e.stopPropagation(); if (menu.classList.contains('hide')) { draw(); menu.classList.remove('hide'); } else shut(); };
  menu.onclick = e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'help') { guideSwitch(!guideIsOn()); draw(); return; }
    shut();
    if (b.dataset.m === 'ask') guideAskOpen();
    else $('gdShow').click();
  };
  document.addEventListener('click', e => { if (!menu.classList.contains('hide') && !e.target.closest('#gdMenu, #gdLaunch')) shut(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') shut(); });
  /* A click outside her box ends a walk-round (the click itself still does nothing on the page, as before). A "your
   * turn" step keeps its lit box usable, and a lesson or a task guide stays until it is finished or closed. */
  document.addEventListener('click', e => {
    if (!GUIDE.tour || GUIDE.tour.kind !== 'tour' || GUIDE.selfClick || !e.isTrusted) return;
    const t = e.target;
    if (t.closest && t.closest('#gdBubble, #gdAsk, #gdCtl, #gdResume, #gdLaunch, #gdMenu, #ptDlg')) return;
    if (GUIDE.live && GUIDE.el && GUIDE.el.contains(t)) return;
    guideClose();
  }, true);
  guideSwitchDraw();
  guideWatch();
}

function guideSwitchDraw() {
  const b = $('gdSwitch'); if (!b) return;
  const on = guideIsOn();
  b.setAttribute('aria-checked', on ? 'true' : 'false');
  b.classList.toggle('on', on);
  b.querySelector('span').textContent = on ? 'Helper On' : 'Helper Off';
}
function guideSwitch(on) {
  guideSet('guideOff', on ? '' : '1');
  guideSwitchDraw();
  if (!on) GUIDE.miss = {};
}

/* ---------- the walk-round ---------- */

/** Called by showTab (nav.js) every time a screen opens. The walk-round only on a first visit, and only when on. */
function guideScreen(tab) {
  guideBuild();
  guideSwitchDraw();   // drawn before sign-in under no name; now it is this person's own setting
  /* A walk-round waiting in the Continue pill, or a glowing box, belongs to the screen being left. */
  if (GUIDE.paused && GUIDE.paused.tour.tab !== tab) { GUIDE.paused = null; if ($('gdResume')) $('gdResume').classList.add('hide'); }
  if (GUIDE.ring && !guideVisible(GUIDE.ring)) guideRingOff();
  if (GUIDE.tour && GUIDE.tour.kind === 'tour' && GUIDE.tour.tab !== tab) guideClose();
  if (!tab || !guideIsOn() || guideSeen().includes(tab)) return;
  clearTimeout(GUIDE.wait);
  /* Let the screen draw first, and never on top of a window somebody already has open. */
  GUIDE.wait = setTimeout(() => {
    if (typeof TAB_NOW !== 'undefined' && TAB_NOW !== tab) return;
    if (GUIDE.tour || guideBusy()) return;
    guideStart(tab, false);
  }, 400);
}
/** A window, a dialog or the scanner is open: not the time to start talking. */
function guideBusy() {
  return [...document.querySelectorAll('.ptmodal, .modal, .pks')].some(el => !el.classList.contains('hide') && el.offsetParent !== null && el.getBoundingClientRect().width > 0);
}

/** The steps for a screen: its own (GUIDE_TOURS) or, for a screen nobody has written one for yet, a plain one read
 * off the screen itself — the title, the tools, the list, the message line. */
function guideSteps(tab) {
  const pane = guidePane(tab);
  const own = GUIDE_TOURS[tab];
  if (own) {
    const st = own.map(s => Object.assign({}, s));
    /* On a phone many screens are a list of cards instead (core/mobile.js), and most computer steps are not drawn:
     * after the opening line, its search, filters, a line and the way to the computer layout. The list is drawn once its
     * data is in — often after a first-visit tour has started — so these steps are kept ("later") and looked for when
     * their turn comes; one that is still not there is passed over then. */
    if (typeof mobOn === 'function' && mobOn()) st.splice(st[0] && !st[0].sel ? 1 : 0, 0,
      { later: true, sel: `#mobL-${tab} .ml-search`, en: 'Type here to find a line — a name, SKU or order number.', hi: 'कोई लाइन ढूँढने के लिए यहाँ लिखें — नाम, SKU या ऑर्डर नंबर।' },
      { later: true, sel: `#mobL-${tab} .ml-chips`, en: 'These narrow the list. They only change what you see, never the data.', hi: 'इनसे लिस्ट छोटी होती है। ये सिर्फ़ दिखना बदलते हैं, डेटा नहीं।' },
      { later: true, sel: `#mobL-${tab} .ml-row`, en: 'Each card is one line. Tap it to open it.', hi: 'हर कार्ड एक लाइन है। खोलने के लिए उस पर टैप करें।' },
      { later: true, sel: `#mobL-${tab} .ml-full`, en: 'Need the full table and its buttons? This opens the computer layout.', hi: 'पूरी टेबल और उसके बटन चाहिए? यह कंप्यूटर वाला लेआउट खोलता है।' });
    return st;
  }
  const title = ($('pageTitle') && $('pageTitle').textContent.trim()) || 'this screen';
  const st = [{ en: `This is <b>${esc(title)}</b>. Let me show you round it — it takes half a minute.`,
                hi: `यह <b>${esc(title)}</b> है। चलिए, आधे मिनट में यह स्क्रीन समझ लेते हैं।` }];
  if (pane) {
    const tb = pane.querySelector('.toolbar');
    if (tb) st.push({ el: tb, en: 'These are the tools for this screen: the search box, the filters and the buttons. The filters only narrow what you see — they never change anything.',
                      hi: 'ये इस स्क्रीन के टूल हैं: सर्च बॉक्स, फ़िल्टर और बटन। फ़िल्टर सिर्फ़ दिखने वाली लिस्ट छोटी करते हैं, कुछ बदलते नहीं।' });
    const tbl = [...pane.querySelectorAll('table')].find(t => t.offsetParent !== null);
    if (tbl) st.push({ el: tbl, en: 'This is the list itself. Click a column heading to sort by it.',
                       hi: 'यह लिस्ट है। किसी कॉलम के नाम पर क्लिक करें तो लिस्ट उसी से क्रम में लग जाती है।' });
    const msg = [...pane.querySelectorAll('[id$="Msg"]')].find(m => m.offsetParent !== null);
    if (msg) st.push({ el: msg, en: 'Watch this line. When something goes wrong it turns red and says exactly what to fix.',
                       hi: 'इस लाइन पर नज़र रखें। कुछ गलत होने पर यह लाल हो जाती है और बताती है कि क्या ठीक करना है।' });
  }
  st.push({ sel: '#guideBtn', en: 'That is the walk-round. For every step written out, press <b>Guide · गाइड</b> here. And I am always one click away — <b>Show me</b> at the top.',
            hi: 'बस इतना ही। हर काम लिखा हुआ पढ़ना हो तो यहाँ <b>Guide · गाइड</b> दबाएँ। और मैं हमेशा ऊपर <b>Show me</b> पर हूँ।' });
  return st;
}
function guidePane(tab) {
  const p = tab && $('pane' + tab.charAt(0).toUpperCase() + tab.slice(1));
  return p && !p.classList.contains('hide') ? p : null;
}

/** The thing a step talks about, if it is on the screen and can be seen. */
function guideTarget(s) {
  let el = s.el || null;
  if (!el && s.sel) for (const one of s.sel.split('||')) { el = document.querySelector(one.trim()); if (el && guideVisible(el)) break; el = null; }
  return el && guideVisible(el) ? el : null;
}
function guideVisible(el) {
  if (!el || !el.isConnected) return false;
  /* A box inside a closed drop-down (<details>, e.g. Shopify Orders' More ▾) still reports a place on the page, so the
   * lit box would land on empty space: ask the browser whether it is really drawn. */
  if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false;
  if (el.closest('details:not([open])') && !el.closest('summary')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function guideStart(tab, asked) {
  guideBuild();
  guideRingOff(); GUIDE.paused = null; if ($('gdResume')) $('gdResume').classList.add('hide');
  const steps = guideSteps(tab).filter(s => !(s.sel || s.el) || s.later || guideTarget(s));
  if (!steps.length) return;
  GUIDE.tour = { tab, steps, kind: 'tour' };
  GUIDE.i = 0;
  if (!asked) guideMarkSeen(tab);   // seen once it has started: a Skip is an answer too
  guideShow();
}

/** A lesson after the same mistake three times: one step, the box lit, red edge on the bubble. */
function guideLesson(el, msg, fix) {
  guideBuild();
  if (GUIDE.tour && GUIDE.tour.kind === 'lesson') return;
  const q = esc(msg.length > 160 ? msg.slice(0, 157) + '…' : msg);
  GUIDE.tour = { kind: 'lesson', steps: [{
    el,
    en: `This has gone wrong ${GUIDE_STRIKES} times now — let me help.<span class="gd-quote">“${q}”</span>${fix ? fix.en : 'Read the red line slowly — it names what is missing or wrong. Check the box I have lit up, put it right, then press the button again.'}`,
    hi: `यह ${GUIDE_STRIKES} बार गलत हो चुका है — चलिए मैं मदद करती हूँ।<span class="gd-quote">“${q}”</span>${fix ? fix.hi : 'लाल लाइन ध्यान से पढ़ें — उसमें लिखा है कि क्या छूटा है या गलत है। जो बॉक्स मैंने दिखाया है उसे ठीक करें, फिर बटन दोबारा दबाएँ।'}`
  }] };
  GUIDE.i = 0;
  guideShow();
}

function guideGo(d) {
  if (!GUIDE.tour) return;
  const n = GUIDE.i + d;
  if (n < 0) return;
  GUIDE.dir = d < 0 ? -1 : 1;
  if (n >= GUIDE.tour.steps.length) { const t = GUIDE.tour; guideClose(); if (t.kind === 'lesson' && t.steps[0].el && t.steps[0].el.focus) try { t.steps[0].el.focus(); } catch (e) { /* not a box */ } return; }
  GUIDE.i = n;
  guideShow();
}

function guideClose() {
  guideWaitOff();
  GUIDE.fast = false; GUIDE.note = '';
  GUIDE.tour = null;
  clearInterval(GUIDE.typing); GUIDE.typing = 0;
  const r = $('gdRoot'); if (r) { r.classList.add('hide'); r.classList.remove('gd-lesson', 'gd-live'); }
}

/** What kind of box a step is about — the label on the bubble, and whether "Try it" makes sense there. */
function guideKind(el, hi) {
  if (!el) return hi ? 'परिचय' : 'Overview';
  if (/Msg$/.test(el.id || '')) return hi ? 'संदेश' : 'Messages';
  if (el.matches('input[type=search], input[type=text], input:not([type])') && /q$|search|filter/i.test(el.id || '')) return hi ? 'खोजें' : 'Search';
  if (el.matches('input[type=date]')) return hi ? 'तारीख' : 'Dates';
  if (el.matches('select, [role=tablist]') || el.querySelector('button + button')) return hi ? 'फ़िल्टर' : 'Filter';
  if (el.matches('input, textarea')) return hi ? 'भरें' : 'Fill in';
  if (el.matches('button, [role=button], summary')) return hi ? 'काम' : 'Action';
  if (el.matches('table') || el.querySelector('table')) return hi ? 'आपकी लिस्ट' : 'Your list';
  return hi ? 'देखें' : 'Look here';
}
const guideCanTry = el => !!(el && el.matches && el.matches('input, select, textarea, button'));

function guideShow() {
  const t = GUIDE.tour; if (!t) return;
  const s = t.steps[GUIDE.i], hi = guideLang() === 'hi', last = GUIDE.i === t.steps.length - 1, lesson = t.kind === 'lesson', task = t.kind === 'task';
  guideWaitOff();
  if (task) {
    /* A step on another screen: that screen opens first (the menu's own access rule), then the step shows. */
    if (s.tab && typeof TAB_NOW !== 'undefined' && TAB_NOW !== s.tab) {
      if (!guideMayOpen(s.tab)) { guideTaskNoAccess(s.tab); return; }
      if (!s._went) { s._went = true; showTab(s.tab); setTimeout(() => { if (GUIDE.tour === t) guideShow(); }, 650); return; }
    }
    /* Already done on the screen (the form is open), or its box is not there for this account: on to the next one. */
    const filledNow = GUIDE.fast && !GUIDE.note && s.wait === 'value' && guideTarget(s) && String(guideTarget(s).value || '').trim() !== '';
    if (GUIDE.fast && s.save) GUIDE.fast = false;
    if (filledNow || (s.skip && guideTarget({ sel: s.skip })) || (s.sel && !guideTarget(s))) {
      const n = GUIDE.i + (GUIDE.dir || 1);
      if (n >= t.steps.length) { guideClose(); return; }
      if (n >= 0) { GUIDE.i = n; guideShow(); return; }
    }
  } else if (!lesson && (s.sel || s.el) && !guideTarget(s)) {
    /* A walk-round step whose box is not on the screen now (a phone list drawn late, a view changed): passed over,
     * never shown pointing at nothing. */
    const n = GUIDE.i + (GUIDE.dir || 1);
    if (n >= t.steps.length) { guideClose(); return; }
    if (n >= 0) { GUIDE.i = n; guideShow(); return; }
  }
  const root = $('gdRoot');
  root.classList.remove('hide');
  root.classList.toggle('gd-lesson', lesson);
  root.querySelectorAll('[data-gd-lang]').forEach(b => b.classList.toggle('on', (b.dataset.gdLang === 'hi') === hi));
  const el = guideTarget(s);
  $('gdChip').textContent = lesson ? (hi ? 'गलती ठीक करें' : 'Fix this')
    : task ? (hi ? t.title.hi : t.title.en) + ' · ' + (GUIDE.i + 1) + '/' + t.steps.length
    : (hi ? 'स्टेप ' : 'Step ') + (GUIDE.i + 1) + ' · ' + guideKind(el, hi);
  /* A "your turn" step: the lit box works, the rest of the page waits, and the guide goes on once it is done. */
  const live = task && !!s.wait && !!el;
  GUIDE.live = live;
  GUIDE.stepDone = live ? guideWaitOn(s, el) : true;
  root.classList.toggle('gd-live', live);
  $('gdCount').textContent = lesson ? '' : (GUIDE.i + 1) + ' / ' + t.steps.length;
  $('gdProg').style.width = lesson ? '100%' : ((GUIDE.i + 1) / t.steps.length * 100) + '%';
  $('gdBack').textContent = hi ? 'पीछे' : 'Back';
  $('gdBack').classList.toggle('hide', GUIDE.i === 0 || lesson);
  /* The thing to DO: on a lesson, "Fix it now" is the main button; on a walk-round, "Try it" sits beside Next. */
  const tryIt = !task && guideCanTry(el);
  $('gdTry').textContent = lesson ? (hi ? 'अभी ठीक करें' : 'Fix it now') : (hi ? 'खुद करके देखें' : 'Try it');
  $('gdTry').classList.toggle('hide', !tryIt);
  $('gdTry').classList.toggle('gd-main', lesson);
  $('gdNext').textContent = lesson ? (hi ? 'समझ गया' : 'Got it') : last ? (hi ? 'हो गया' : 'Done') : (hi ? 'आगे' : 'Next');
  $('gdNext').classList.toggle('ghost', lesson && tryIt);
  guideDoDraw();
  $('gdOff').textContent = hi ? 'छोड़ें' : 'Skip';
  $('gdOff').title = hi ? 'यह स्टेप छोड़ें' : 'Skip this step';
  if (typeof guideFillOffer === 'function') guideFillOffer(s, el, task);   // the choices as buttons, before the bubble is measured
  $('gdText').innerHTML = (GUIDE.note ? '<div class="gd-note' + (GUIDE.noteOk ? ' gd-ok' : '') + '">' + GUIDE.note + '</div>' : '') + (hi ? s.hi : s.en);   // measured whole; guideType then writes it out again
  $('gdBubble').classList.remove('gd-up');
  /* From the bubble's own height, which an animation in progress or a fast Next cannot change. */
  const foot = Math.max(GUIDE_FOOT, parseFloat(getComputedStyle($('gdBubble')).bottom) + $('gdBubble').offsetHeight + 12);
  GUIDE.foot = foot;
  if (el) {
    let r = el.getBoundingClientRect();
    /* A box taller than the room above the bubble is brought to the top (under the bar or the phone header), not
     * centred, so its own top — the part that names it — is the part on show. */
    if (r.height > innerHeight - foot - 100) { if (r.top < 70 || r.top > 140) { window.scrollBy({ top: r.top - 90, behavior: 'instant' }); r = el.getBoundingClientRect(); } }
    else if (r.top < 70 || r.bottom > innerHeight - 40) { el.scrollIntoView({ block: 'center', behavior: 'instant' }); r = el.getBoundingClientRect(); }
    /* Meera and her bubble take the bottom of the screen: lift a box that sits behind them, as far as the page lets. */
    if (r.bottom > innerHeight - foot && r.top > 90) window.scrollBy({ top: Math.min(r.top - 90, r.bottom - (innerHeight - foot)), behavior: 'instant' });
  }
  GUIDE.el = el;
  guidePlace();
  const say = (GUIDE.note ? '<div class="gd-note' + (GUIDE.noteOk ? ' gd-ok' : '') + '">' + GUIDE.note + '</div>' : '') + (hi ? s.hi : s.en);
  GUIDE.note = ''; GUIDE.noteOk = false;
  guideType(say);
}

/** Wait for the person to do a step: 'click' = press the lit button; 'value' = fill or choose the lit box (a typed
 * box counts once they stop typing for a moment, or leave it). Returns true when it is done already. */
function guideWaitOn(s, el) {
  const done = () => {
    if (GUIDE.stepDone) return;
    GUIDE.stepDone = true;
    guideDoDraw();
    const at = GUIDE.i, tour = GUIDE.tour;
    setTimeout(() => { if (GUIDE.tour === tour && GUIDE.i === at) guideGo(1); }, 750);
  };
  if (s.wait === 'click') {
    /* A Save: wait a moment for the ERP's answer. A red line means it did not save — go and fix that instead. */
    const h = e => {
      if (!el.contains(e.target)) return;
      if (!s.save) { setTimeout(done, 0); return; }
      const at = Date.now(), tour = GUIDE.tour, i = GUIDE.i;
      setTimeout(() => {
        if (GUIDE.tour !== tour || GUIDE.i !== i) return;
        const red = typeof gaRedLines === 'function' && gaRedLines().find(r => ((GUIDE.seenErr.get(r.id) || {}).at || 0) >= at - 50);
        if (red) guideTaskFixUp(red);
        else { if (typeof guideFillRemember === 'function') guideFillRemember(tour); done(); }   // it saved: remembered for "Same as last time"
      }, 1300);
    };
    document.addEventListener('click', h, true);
    GUIDE.waitOff = () => document.removeEventListener('click', h, true);
    return false;
  }
  if (s.wait === 'value') {
    const filled = () => String(el.value || '').trim() !== '';
    let tm = 0;
    const typed = () => { clearTimeout(tm); tm = setTimeout(() => { if (filled()) done(); }, 1400); };
    const chose = () => { clearTimeout(tm); if (filled()) done(); };
    el.addEventListener('input', typed);
    el.addEventListener('change', chose);
    GUIDE.waitOff = () => { clearTimeout(tm); el.removeEventListener('input', typed); el.removeEventListener('change', chose); };
    return filled();
  }
  return true;
}
/** A task's Save came back red: say why, and take the person to the box that needs fixing; after it, the guide walks
 * forward again (boxes already filled are passed over) to Save. */
function guideTaskFixUp(red) {
  const t = GUIDE.tour; if (!t) return;
  const text = red.textContent.trim(), hi = guideLang() === 'hi';
  const why = typeof gaWhy === 'function' ? gaWhy(text) : null;
  const scope = typeof gaFormOf === 'function' ? gaFormOf(red) : null;
  const empty = typeof gaEmptyBoxes === 'function' ? gaEmptyBoxes(scope) : [];
  const fixEl = (why && why.fx && why.fx.sel && guideTarget({ sel: why.fx.sel })) || empty[0] || guideWorkedIn(red);
  const reason = why ? (why.fx ? (hi ? why.fx.hi : why.fx.en) : (hi ? why.kind.hi : why.kind.en)) : '';
  GUIDE.note = (hi ? 'यह सेव नहीं हुआ: ' : 'That did not save: ') + '<span class="gd-quote">“' + esc(text) + '”</span>' + reason;
  let idx = fixEl ? t.steps.findIndex(st => (st.sel && guideTarget(st) === fixEl) || st.el === fixEl) : -1;
  if (idx < 0 && fixEl) {
    t.steps.splice(GUIDE.i, 0, { el: fixEl, wait: 'value', en: 'Fix this box.', hi: 'यह बॉक्स ठीक करें।' });
    idx = GUIDE.i;
  }
  GUIDE.fast = true;   // on the way back to Save, boxes already filled are passed over
  GUIDE.dir = 1;
  if (idx >= 0) GUIDE.i = idx;
  guideShow();
}
function guideWaitOff() {
  if (GUIDE.waitOff) { GUIDE.waitOff(); GUIDE.waitOff = null; }
  GUIDE.live = false;
}
/** The line under a task step, and its button: "Your turn" and Skip while it waits; "Done" and Next after. */
function guideDoDraw() {
  const t = GUIDE.tour, d = $('gdDo'); if (!t || !d) return;
  const hi = guideLang() === 'hi', wait = t.kind === 'task' && GUIDE.live, last = GUIDE.i === t.steps.length - 1;
  d.classList.toggle('hide', !wait);
  d.classList.toggle('gd-done', wait && GUIDE.stepDone);
  d.textContent = !wait ? '' : GUIDE.stepDone ? (hi ? 'हो गया ✓' : 'Done ✓') : (hi ? 'आपकी बारी — ऊपर दिखाया काम स्क्रीन पर करें' : 'Your turn — do this on the screen');
  if (t.kind === 'task') {
    const skip = wait && !GUIDE.stepDone;
    $('gdNext').textContent = skip ? (hi ? 'छोड़ें' : 'Skip') : last ? (hi ? 'हो गया' : 'Finish') : (hi ? 'आगे' : 'Next');
    $('gdNext').classList.toggle('ghost', skip);
  }
}
/** A task needs a screen this account does not have: say so, instead of landing somewhere else. */
function guideTaskNoAccess(tab) {
  const name = typeof gaTabName === 'function' ? gaTabName(tab) : tab;
  GUIDE.tour = { kind: 'tour', tab: typeof TAB_NOW !== 'undefined' ? TAB_NOW : '', steps: [{
    en: 'This guide needs <b>' + esc(name) + '</b>, and your account does not have that screen. Ask your admin to add it.',
    hi: 'इस गाइड के लिए <b>' + esc(name) + '</b> चाहिए, और यह स्क्रीन आपके अकाउंट में नहीं है। एडमिन से जुड़वाएँ।' }] };
  GUIDE.i = 0;
  guideShow();
}

/** "Try it" / "Fix it now": the dim goes, the box keeps a glow and gets the cursor, and the page works again. A
 * walk-round waits in the "Continue" pill; the glow goes once the box is changed. */
function guideTry() {
  const t = GUIDE.tour, el = GUIDE.el; if (!t || !el) return;
  const i = GUIDE.i;
  guideClose();
  guideRingOn(el);
  try { el.focus({ preventScroll: true }); if (el.select && el.matches('input[type=text], input:not([type])')) el.select(); } catch (e) { /* not a box */ }
  if (t.kind !== 'lesson' && i < t.steps.length - 1) {
    GUIDE.paused = { tour: t, i };
    const hi = guideLang() === 'hi', pill = $('gdResume');
    pill.querySelector('span').textContent = (hi ? 'टूर जारी रखें ' : 'Continue tour ') + (i + 2) + '/' + t.steps.length;
    pill.classList.remove('hide');
  }
}
function guideRingOn(el) {
  guideRingOff();
  GUIDE.ring = el;
  $('gdRing').classList.remove('hide');
  guideRingPlace();
  const done = () => guideRingOff();
  el.addEventListener('change', done, { once: true });
  el.addEventListener('input', done, { once: true });
  if (el.matches('button')) el.addEventListener('click', done, { once: true });
  GUIDE.ringT = setTimeout(done, 20000);
}
function guideRingOff() {
  clearTimeout(GUIDE.ringT);
  GUIDE.ring = null;
  if ($('gdRing')) $('gdRing').classList.add('hide');
}
function guideRingPlace() {
  const el = GUIDE.ring, ring = $('gdRing');
  if (!el || !ring) return;
  if (!guideVisible(el)) { ring.classList.add('hide'); return; }
  const r = el.getBoundingClientRect();
  ring.classList.remove('hide');
  Object.assign(ring.style, { top: (r.top - 5) + 'px', left: (r.left - 5) + 'px', width: (r.width + 10) + 'px', height: (r.height + 10) + 'px' });
}

/** The lit box, the arrow and the bubble, put where the step's box is now. */
function guidePlace() {
  const spot = $('gdSpot'), arrow = $('gdArrow'), bub = $('gdBubble'), ch = $('gdChar');
  if (!spot) return;
  const el = GUIDE.el, pad = 6;
  if (el && guideVisible(el)) {
    const r = el.getBoundingClientRect();
    const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
    const w = Math.min(innerWidth - 8 - left, r.width + pad * 2), h = Math.min(innerHeight - 8 - top, r.height + pad * 2);
    Object.assign(spot.style, { top: top + 'px', left: left + 'px', width: w + 'px', height: h + 'px' });
    spot.classList.remove('gd-full');
    /* The arrow points down onto the box from above, or up from below when the box is near the top. */
    const below = top < 90;
    arrow.className = below ? 'gd-up' : 'gd-down';
    arrow.style.left = Math.min(innerWidth - 40, Math.max(8, left + Math.min(w, 260) / 2 - 16)) + 'px';
    arrow.style.top = (below ? top + h + 6 : top - 42) + 'px';
    arrow.classList.remove('hide');
  } else {
    spot.classList.add('gd-full');
    arrow.classList.add('hide');
  }
  /* Meera stands bottom-left, unless the box is there — then bottom-right. */
  const r = el && guideVisible(el) ? el.getBoundingClientRect() : null;
  const right = !!(r && r.left < 460 && r.bottom > innerHeight - 330);
  ch.classList.toggle('gd-right', right);
  bub.classList.toggle('gd-right', right);
  /* Still behind the bubble (the page ends there): the bubble goes up top instead. */
  /* Bubble at the foot or up top: wherever it hides less of the lit box (a short page cannot scroll the box clear). */
  const bh = bub.getBoundingClientRect().height, foot = GUIDE.foot || GUIDE_FOOT;
  const hidBelow = r ? Math.max(0, r.bottom - (innerHeight - foot)) : 0, hidAbove = r ? Math.max(0, (76 + bh + 10) - r.top) : 0;
  bub.classList.toggle('gd-up', !!(r && hidBelow > 0 && hidAbove < hidBelow));
}

/** The words appear a few letters at a time (tags whole), and Meera glows while they do. */
function guideType(html) {
  clearInterval(GUIDE.typing);
  const box = $('gdText'), parts = html.match(/<[^>]+>|&[a-z#0-9]+;|[\s\S]/gi) || [];
  let n = 0;
  GUIDE.full = html;
  box.innerHTML = '';
  $('gdChar').classList.add('gd-talk');
  GUIDE.typing = setInterval(() => {
    for (let k = 0; k < GUIDE_TYPE_STEP && n < parts.length; k++) { while (n < parts.length && parts[n].charAt(0) === '<') n++; n++; }
    box.innerHTML = parts.slice(0, n).join('');
    if (n >= parts.length) guideTypeAll();
  }, GUIDE_TYPE_MS);
}
function guideTypeAll() {
  clearInterval(GUIDE.typing); GUIDE.typing = 0;
  if ($('gdText') && GUIDE.full != null) $('gdText').innerHTML = GUIDE.full;
  if ($('gdChar')) $('gdChar').classList.remove('gd-talk');
}

/* ---------- three strikes ---------- */

/** What the person was working in: the last box they typed in or chose from, and the last button they pressed. */
function guideWatch() {
  const ours = el => el.closest && el.closest('#gdRoot, #gdCtl, #gdResume, #gdAsk');
  const inBox = el => GUIDE.live && GUIDE.el && GUIDE.el.contains(el);
  /* A press outside the lit box does nothing while a "your turn" step waits (the dim no longer catches it). */
  const hold = e => { if (GUIDE.tour && GUIDE.live && !ours(e.target) && !inBox(e.target)) { e.preventDefault(); e.stopPropagation(); } };
  document.addEventListener('pointerdown', hold, true);
  document.addEventListener('mousedown', hold, true);
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (el && el.matches && el.matches('input, select, textarea') && !ours(el)) GUIDE.field = { el, at: Date.now() };
  }, true);
  /* A red line counts only just after the person did something (a click, a key, a hand-scanner read): a load that
   * fails, or a screen retrying by itself, is not their mistake. */
  const acted = e => { if (e.isTrusted && !ours(e.target)) GUIDE.act = Date.now(); };
  document.addEventListener('pointerdown', acted, true);
  document.addEventListener('keydown', acted, true);
  document.addEventListener('click', e => {
    if (GUIDE.tour && !GUIDE.selfClick && !ours(e.target) && !inBox(e.target)) { e.preventDefault(); e.stopPropagation(); return; }   // the walk-round holds the page (not Meera's own press of an Open button)
    const b = e.target.closest && e.target.closest('button, [role=button], input[type=button], input[type=submit]');
    if (b && !ours(b)) GUIDE.btn = { el: b, at: Date.now() };
  }, true);
  /* A box the browser itself refuses (a required box left empty, a number out of range). */
  document.addEventListener('invalid', e => {
    const el = e.target;
    guideStrike('invalid:' + (el.id || el.name || 'box'), el.validationMessage || 'This box is not filled in correctly.', el);
  }, true);
  /* Every screen's message line turning red. Only the line itself is looked at, so a whole table redrawing costs
   * nothing more than a glance at what changed. */
  const mo = new MutationObserver(list => {
    for (const m of list) {
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!el || !el.classList) continue;
      if (el.id && (el.classList.contains('err') || el.classList.contains('pks-say-bad'))) guideSaw(el, el.id, (el.textContent || '').trim());
    }
  });
  mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
}
/** One showing of a red line. A message function sets the text and the class together, which the page reports as
 * two changes in the same moment; inside 120 ms they are the same mistake (a quick second press is a second one). */
function guideSaw(el, id, text) {
  if (!text) return;
  if (!/^pks/.test(id) && !(Date.now() - (GUIDE.act || 0) < GUIDE_ACT_MS)) return;   // the camera scans with no key pressed
  const now = Date.now(), was = GUIDE.seenErr.get(id);
  if (was && was.text === text && now - was.at < 120) return;
  GUIDE.seenErr.set(id, { text, at: now });
  guideStrike(id + ':' + guideNorm(text), text, el);
}
/** The same mistake on a different SKU or order is still the same mistake: numbers and codes are taken out. */
function guideNorm(t) { return String(t).toLowerCase().replace(/[a-z]*\d[\w\-\/.]*/g, '#').replace(/["“”'‘’][^"“”'‘’]*["“”'‘’]/g, '…').replace(/\s+/g, ' ').slice(0, 80); }

function guideStrike(key, text, msgEl) {
  if (!guideIsOn() || (GUIDE.tour && (GUIDE.tour.kind === 'lesson' || GUIDE.tour.kind === 'task'))) return;
  const now = Date.now();
  const m = GUIDE.miss[key] = (GUIDE.miss[key] || []).filter(t => now - t < GUIDE_WINDOW_MS);
  m.push(now);
  if (m.length < GUIDE_STRIKES) return;
  GUIDE.miss[key] = [];
  const fix = GUIDE_FIX.find(f => f.re.test(text));
  const el = (fix && fix.sel && guideTarget({ sel: fix.sel })) || guideWorkedIn(msgEl) || msgEl;
  /* Let the screen finish saying no first, so the lit box is where it will stay. */
  setTimeout(() => guideLesson(el, text, fix), 350);
}
/** The box the person was most likely getting wrong: the last one they were in, if it is near the red line (the same
 * window, form or card) and recent; else the button they kept pressing; else the red line itself. */
function guideWorkedIn(msgEl) {
  const near = el => {
    if (!el || !guideVisible(el)) return false;
    const box = msgEl && msgEl.closest && msgEl.closest('.ptmodal, .modal, form, .card, [id^="pane"]');
    return !box || box.contains(el);
  };
  const now = Date.now();
  if (msgEl && msgEl.matches && msgEl.matches('input, select, textarea')) return msgEl;
  if (GUIDE.field && now - GUIDE.field.at < 120000 && near(GUIDE.field.el)) return GUIDE.field.el;
  if (GUIDE.btn && now - GUIDE.btn.at < 120000 && near(GUIDE.btn.el)) return GUIDE.btn.el;
  return null;
}

guideBuild();
