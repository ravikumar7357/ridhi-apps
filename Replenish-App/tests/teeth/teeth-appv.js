const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  ['a different build shows the bar', "      if (APPV.isStale(APPV.base, now) && !APPV.stale) { APPV.stale = true; APPV.show(); }", "      if (false) { APPV.stale = true; APPV.show(); }"],
  ['the first answer is the baseline, not a new build', "      if (!APPV.base) { APPV.base = now; return; }   // the first answer is the build this tab was loaded with", "      if (!APPV.base) { APPV.base = 'x'; }"],
  ['a reading that could not be taken says nothing', "  APPV.isStale = function (base, now) { return !!base && !!now && base !== now; };", "  APPV.isStale = function (base, now) { return base !== now; };"],
  ['it never reloads by itself', "      if (APPV.isStale(APPV.base, now) && !APPV.stale) { APPV.stale = true; APPV.show(); }", "      if (APPV.isStale(APPV.base, now) && !APPV.stale) { APPV.stale = true; APPV.show(); location.reload(); }"],
  ['it asks every five minutes', '  setInterval(APPV.tick, 5 * 60 * 1000);', '  setInterval(APPV.tick, 5 * 60 * 60 * 1000);'],
  ['coming back to the tab asks at once, going away does not', "  document.addEventListener('visibilitychange', function () { if (!document.hidden) APPV.tick(); });", "  document.addEventListener('visibilitychange', function () { APPV.tick(); });"],
  ['the button reloads', "    var btn = document.getElementById('appvReload'); if (btn) btn.onclick = function () { location.reload(); };", "    var btn = document.getElementById('appvReload');"],
  ['the script stays out of the module', '<script>' + NL + '/* ==== APP VERSION', '<script type="module">' + NL + '/* ==== APP VERSION'],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['appv-test.js'], { cwd: pathm.join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 0 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'crashed: ' + out.slice(-120)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
