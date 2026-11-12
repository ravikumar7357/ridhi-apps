/* AN OFFLINE COPY OF THE DEPLOYED PAGE, FOR TIMING MEERA IN A REAL BROWSER (v2 rebuild, 29 Oct 2026).
 *
 *   node meera/tests/preview-make.cjs        Replenish-App/dist/ (run tests/build-dist.js first) → meera/.preview/
 *
 * The copy cannot reach anything outside this computer: a Content-Security-Policy line lets the page connect only to
 * its own server, so no sign-in, no database, no router is touched. A small hook at the end of the page's own script
 * opens the app without signing in and hands the timing helpers Meera's functions. meera/.preview/ is not committed. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'Replenish-App', 'dist'), OUT = path.join(ROOT, 'meera', '.preview');
if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('run node tests/build-dist.js in Replenish-App first');
/* emptied, not removed: Windows will not remove a folder a program is standing in */
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
fs.cpSync(DIST, OUT, { recursive: true });
let s = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
/* at the very start: the built page has no <head> tag, and "<head" also appears inside the app's own code */
s = '<meta http-equiv="Content-Security-Policy" content="connect-src \'self\'">\n' + s;
const hook = `
/* PREVIEW ONLY (meera/tests/preview-make.cjs): the app opened without signing in; nothing can leave this computer. */
window.__meera = { gaAnswer, gaBankLoad, gaWordsLoad, gaSemIndex, showTab: t => showTab(t), get bankReady() { return !!GA_BANK; }, get wordsReady() { return !!GA_W; } };
setTimeout(() => {
  try { $('loginView').style.display = 'none'; $('appView').classList.remove('hide'); document.body.classList.remove('gating'); if ($('gateWait')) $('gateWait').style.display = 'none'; } catch (e) {}
  try { ME.email = 'preview@local'; ME.admin = true; ME.tabs = []; } catch (e) {}
  try { syncNavGroups(); } catch (e) {}
  try { showTab(new URLSearchParams(location.search).get('tab') || 'shop'); } catch (e) {}
  window.__meeraOpenAt = performance.now();
}, 300);
`;
const a = s.lastIndexOf('<script type="module">');
if (a < 0) throw new Error('no module script in the page');
const b = s.indexOf('</script>', a);
s = s.slice(0, b) + hook + s.slice(b);
fs.writeFileSync(path.join(OUT, 'index.html'), s);
/* PREVIEW ONLY: a test handle into meera.js (her code runs in a closed box), so the screenshot script can open each scene —
 * this copy is never deployed */
for (const f of fs.readdirSync(path.join(OUT, 'meera')).filter(f => /^meera(\.[0-9a-f]{12})?\.js$/.test(f))) {
  const p = path.join(OUT, 'meera', f), js = fs.readFileSync(p, 'utf8'), end = js.lastIndexOf('})();');
  fs.writeFileSync(p, js.slice(0, end) + ';window.__meeraTest = c => eval(c);\n' + js.slice(end));
}
console.log('preview copy made:', path.relative(ROOT, OUT));
