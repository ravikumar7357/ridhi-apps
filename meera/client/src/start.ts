/* MEERA AS HER OWN FILE — what meera.js does BEFORE her files (v2 rebuild, Phase 1, 29 Oct 2026).
 *
 * meera.js is built by meera/client/build.cjs: this file, then her files (meera/client/src/legacy, the same ones the
 * page joins while the "lazy" switch is off), then finish.ts — all in one closed box, so nothing of hers can clash with
 * the ERP's own names. She talks to the ERP only through its bridge, window.ERP_MEERA (core/meera-bridge.js).
 *
 * Here she gets the few things the page used to lend her — the bridge, $ and esc, the switches — her picture as a file
 * of its own (meera.webp, kept by the browser, not 80 KB inside every page), her look, and a safety net: an error from
 * her file hides her button and stops her; the ERP carries on. */

/// <reference path="../../shared/bridge.d.ts" />
/* the bridge the ERP gives her: its contract is meera/shared/bridge.d.ts */
declare const __MEERA_CSS__: string;

const ERP_MEERA: ErpMeera = (window as any).ERP_MEERA;
/** a box on the page by its id — the same as the page's own $ */
const $ = (id: string): any => document.getElementById(id);
/** text made safe to put inside HTML — the same as the page's own esc */
const esc = (s: unknown): string =>
  String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' } as Record<string, string>)[c]);
/** her switches, as the ERP holds them */
const meeraOn = (name: string): boolean => { try { return !!ERP_MEERA.switchOn(name); } catch (e) { return false; } };
/** in her own file she always starts (inside the page she starts only while "lazy" is off) */
const meeraHere = (): boolean => true;

/* where this file was fetched from: her picture sits beside it */
const MEERA_BASE: string = ((document.currentScript as HTMLScriptElement | null)?.src || '/meera/meera.js').replace(/[^/]*$/, '');
const GUIDE_IMG: string = MEERA_BASE + 'meera.webp';

/* the safety net: anything thrown from this file hides her and stops her; the ERP is never touched */
let MEERA_STOPPED = false;
function meeraStop(why: unknown): void {
  if (MEERA_STOPPED) return;
  MEERA_STOPPED = true;
  for (const id of ['gdLaunch', 'gdMenu', 'gdNudge', 'gdRoot', 'gdAsk', 'gdRing', 'gdResume', 'gdCtl']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  try { console.warn('Meera stopped after an error — the ERP carries on:', why); } catch (e) { /* no console */ }
}
const fromMeera = (where: unknown): boolean => String(where || '').indexOf('/meera/meera.js') >= 0;
window.addEventListener('error', e => { if (fromMeera(e.filename) || fromMeera(e.error && e.error.stack)) meeraStop(e.message); });
window.addEventListener('unhandledrejection', e => { if (fromMeera(e.reason && e.reason.stack)) meeraStop(e.reason); });

/* her look, once */
if (!document.getElementById('meera-css')) {
  const st = document.createElement('style');
  st.id = 'meera-css';
  st.textContent = __MEERA_CSS__;
  document.head.appendChild(st);
}
