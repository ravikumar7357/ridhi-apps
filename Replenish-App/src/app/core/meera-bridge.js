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
};
try { window.ERP_MEERA = ERP_MEERA; } catch (e) { /* no window: the page itself still has it */ }
