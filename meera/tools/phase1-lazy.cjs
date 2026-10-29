/* Phase 1, step 3: the four lines that START Meera run only where she lives — inside the page while the "lazy" switch
 * is off (today), or from meera.js when it is on. The bridge gets meeraHere() and the loader for meera.js. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const LEG = path.join(ROOT, 'meera', 'client', 'src', 'legacy');
function edit(f, pairs) {
  let s = fs.readFileSync(f, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${path.basename(f)}: found ${n} times: ${a.slice(0, 80)}`);
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
  console.log('  ' + path.relative(ROOT, f));
}
const HERE = '/* she starts here only where she lives: in the page (switch "lazy" off) or in meera.js (on) — meeraHere(), bridge */';
edit(path.join(LEG, 'guide.js'), [
  ["ERP_MEERA.on('screen', tab => guideScreen(tab));\n", `${HERE}\nif (meeraHere()) ERP_MEERA.on('screen', tab => guideScreen(tab));\n`],
  ["\nguideBuild();", `\nif (meeraHere()) guideBuild();   // ${'she starts where she lives (meeraHere, bridge)'}`],
]);
edit(path.join(LEG, 'guide-walks.js'), [
  ["\ngaNudgeWatch();\n", '\nif (meeraHere()) gaNudgeWatch();   // she starts where she lives (meeraHere, bridge)\n'],
  ["\ngaLater(() => gaPreload(0), 4000);", '\nif (meeraHere()) gaLater(() => gaPreload(0), 4000);   // she starts where she lives (meeraHere, bridge)'],
]);

/* the bridge: meeraHere(), the switches handed to meera.js, and the loader */
edit(path.join(ROOT, 'Replenish-App', 'src', 'app', 'core', 'meera-bridge.js'), [
  ["  on: (event, fn) => { (MEERA_EVENTS[event] = MEERA_EVENTS[event] || []).push(fn); },\n};",
   "  on: (event, fn) => { (MEERA_EVENTS[event] = MEERA_EVENTS[event] || []).push(fn); },\n"
   + "  switchOn: name => meeraSafe(() => meeraOn(name), false),   // her switches, for meera.js\n};"],
  ["  return !!MEERA_SWITCHES[name];\n}",
   `  return !!MEERA_SWITCHES[name];
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
} catch (e) { /* no page (the test suites): Meera stays in the page as before */ }`],
]);
