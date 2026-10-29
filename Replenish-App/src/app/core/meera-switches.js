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
