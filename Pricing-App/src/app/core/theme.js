/* ================= CORE · THEME: the light / dark switch =================
 * Screens: every screen — the sun / moon button in the top bar (themeBtn).
 * Does: sets data-theme="light" or "dark" on <html> when somebody picks one, remembers the choice in this
 * browser (localStorage selloraTheme), and keeps the button's aria-pressed (dark = pressed) and title in
 * step; the icon follows aria-pressed in styles.css. With no choice saved nothing is set, and the page
 * follows the computer (styles.css reads prefers-color-scheme).
 * Touches nothing else — not the menu, not a screen, not any app state — and everything sits inside the
 * one function below, so it adds no name to the app's shared scope. */
(() => {
  try {
    const KEY = 'selloraTheme';
    const root = document.documentElement;
    const btn = document.getElementById('themeBtn');
    const osDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    // The saved choice: 'light' or 'dark'. Anything else counts as no choice.
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
    // The theme on screen right now: the choice, or else the computer's.
    const now = () => root.getAttribute('data-theme') || (osDark && osDark.matches ? 'dark' : 'light');
    // Keep the button saying what it shows and what a press does.
    const sync = () => {
      if (!btn) return;
      const dark = now() === 'dark';
      btn.setAttribute('aria-pressed', String(dark));
      btn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    };
    // A press flips the theme on screen and remembers it.
    if (btn) btn.addEventListener('click', () => {
      const next = now() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      sync();
    });
    // With no choice made, the button follows the computer when the computer switches.
    if (osDark) {
      if (osDark.addEventListener) osDark.addEventListener('change', sync);
      else if (osDark.addListener) osDark.addListener(sync);
    }
    sync();
  } catch (e) { /* a convenience only: if anything here fails, the page simply follows the computer */ }
})();
