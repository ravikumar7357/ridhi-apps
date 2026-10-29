/* ================= THE DOOR BETWEEN THE ERP AND MEERA (v2 rebuild, 29 Oct 2026) =================
 *
 * Meera used to reach straight into the ERP's own variables (ME, TAB_NOW, showTab, auth, PTE.emp, mobOn, spIsVendor).
 * Now she asks here, and only here — so the ERP can change inside without breaking her, and she can live in her own
 * file (meera.js, plan Phase 1) without knowing how the ERP is built. This file is the ONLY Meera file the ERP keeps.
 *
 *   ERP_MEERA.user()          { email, admin, tabs, vendor }        who is signed in, and what they may open
 *   ERP_MEERA.signedIn()      true once someone is signed in
 *   ERP_MEERA.token()         a promise of their sign-in token (for her router), or null
 *   ERP_MEERA.screen()        the screen open now ('pbase', 'shop' …)
 *   ERP_MEERA.openScreen(t)   open a screen, by the ERP's own rules
 *   ERP_MEERA.people()        the karigars' and staff names (to recognise "Ramesh ko …")
 *   ERP_MEERA.phone()         true on the phone layout
 *   ERP_MEERA.on(event, fn)   'screen' — a screen just opened (the ERP calls meeraBridgeEmit('screen', tab))
 *
 * Every answer here is wrapped: if the ERP is half-loaded or something inside it throws, Meera gets a safe default
 * (nobody signed in, no screen, no names) and carries on — and the ERP never sees her errors.
 */
const MEERA_EVENTS = {};
function meeraSafe(fn, otherwise) {
  try { const v = fn(); return v === undefined ? otherwise : v; } catch (e) { return otherwise; }
}
function meeraBridgeEmit(event, ...args) {
  (MEERA_EVENTS[event] || []).forEach(fn => { try { fn(...args); } catch (e) { try { console.warn('Meera:', e); } catch (x) { /* no console */ } } });
}
/* declared in the page (Meera's files inside the page see it, also where there is no real window, e.g. the test
 * suites), and handed to the window for meera.js, which lives in a file of its own */
const ERP_MEERA = {
  v: 1,
  user: () => meeraSafe(() => ({
    email: (ME && ME.email) || '',
    admin: !!(ME && ME.admin),
    tabs: ME && Array.isArray(ME.tabs) ? ME.tabs.slice() : [],
    vendor: typeof spIsVendor === 'function' && !!spIsVendor(),
  }), { email: '', admin: false, tabs: [], vendor: false }),
  signedIn: () => meeraSafe(() => !!(auth && auth.currentUser), false),
  token: () => { try { return auth && auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } },
  screen: () => meeraSafe(() => TAB_NOW, '') || '',
  openScreen: tab => meeraSafe(() => { showTab(tab); return true; }, false),
  people: () => meeraSafe(() => (PTE.emp || []).map(e => String(e[1] || '').trim()).filter(Boolean), []),
  phone: () => meeraSafe(() => typeof mobOn === 'function' && !!mobOn(), false),
  on: (event, fn) => { (MEERA_EVENTS[event] = MEERA_EVENTS[event] || []).push(fn); },
  switchOn: name => meeraSafe(() => meeraOn(name), false),   // her switches, for meera.js
};
try { window.ERP_MEERA = ERP_MEERA; } catch (e) { /* no window: the page itself still has it */ }

/* ================= MEERA'S SWITCHES (v2 rebuild, 29 Oct 2026) =================
 *
 * Plan section 2, rule 4: every new Meera behaviour ships switched OFF, is turned on for testing, and can be turned
 * off again in a minute. One list, here; nothing in it changes anything until a later phase reads it.
 *
 *   meeraOn('lazy')                         is the switch on for this person?
 *
 * How a switch is turned on, first match wins:
 *   1. this browser only:  localStorage 'meera.<name>' = '1' (or '0' to force it off)   — for testing on one computer
 *   2. this visit only:    the page address ends ?meera=<name>[,<name>…]                  — for the test link
 *   3. everyone:           the default below (change it, push — "live karo" first)
 * Later (plan Phase 5) the router can hold the defaults, so a switch flips without a push.
 */
const MEERA_SWITCHES = {
  /* Phase 1 — Meera loaded as her own file (meera.js) after the ERP is ready, instead of inside the page */
  lazy: false,
};
function meeraOn(name) {
  try {
    const v = localStorage.getItem('meera.' + name);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (e) { /* storage blocked: the defaults */ }
  try {
    const u = new URLSearchParams(location.search).get('meera');
    if (u && u.split(',').map(s => s.trim()).includes(name)) return true;
  } catch (e) { /* no address: the defaults */ }
  return !!MEERA_SWITCHES[name];
}

/* WHERE MEERA LIVES (Phase 1). Switch "lazy" off — today: her files are part of this page and start with it.
 * On: they stay quiet here, and once the page has loaded and the computer is idle, meera.js (her own file, built from
 * the same files — meera/client/build.cjs) is fetched and starts her. If it cannot be fetched she is simply not there;
 * the ERP is not affected either way. */
function meeraHere() { return !meeraOn('lazy'); }
function meeraLoadFile() {
  if (meeraLoadFile.done) return;
  meeraLoadFile.done = true;
  try {
    const s = document.createElement('script');
    s.src = '/meera/meera.js';
    s.async = true;
    s.onerror = () => { try { console.warn('Meera: meera.js could not be loaded — the ERP carries on without her'); } catch (e) { /* no console */ } };
    document.head.appendChild(s);
  } catch (e) { /* no page: nothing to load */ }
}
try {
  if (meeraOn('lazy')) {
    const go = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(meeraLoadFile, { timeout: 4000 }) : setTimeout(meeraLoadFile, 1500));
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
  }
} catch (e) { /* no page (the test suites): Meera stays in the page as before */ }
