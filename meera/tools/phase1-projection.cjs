/* Phase 1 report: the page as it will be once Meera's old in-page code is taken out (after a week of the "lazy" switch
 * proving itself) — built ONLY to measure, in a scratch folder outside the repository; nothing here is committed.
 *   node meera/tools/phase1-projection.cjs <scratch folder>   → <scratch>/serve/ (offline: connections only to itself) */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'), APP = path.join(ROOT, 'Replenish-App');
const T = path.resolve(process.argv[2] || path.join(ROOT, '..', 'meera-v2-projection'));
fs.rmSync(T, { recursive: true, force: true });
const TA = path.join(T, 'Replenish-App');
for (const d of ['src', 'public']) fs.cpSync(path.join(APP, d), path.join(TA, d), { recursive: true });
fs.mkdirSync(path.join(TA, 'tests'), { recursive: true });
for (const f of ['assemble.js', 'build-dist.js']) fs.copyFileSync(path.join(APP, 'tests', f), path.join(TA, 'tests', f));
fs.cpSync(path.join(ROOT, 'shared'), path.join(T, 'shared'), { recursive: true });
fs.symlinkSync(path.join(APP, 'node_modules'), path.join(TA, 'node_modules'), 'junction');
/* Meera's in-page files out; the bridge stays and, with ?meera=lazy, fetches meera.js */
const order = path.join(TA, 'src', 'app', 'ORDER');
const s = fs.readFileSync(order, 'utf8'), nl = s.includes('\r\n') ? '\r\n' : '\n';
fs.writeFileSync(order, s.split(/\r?\n/).filter(l => !l.trim().startsWith('@meera/')).join(nl));
const css = path.join(TA, 'src', 'styles.css');   // her look is in meera.js already
execFileSync(process.execPath, [path.join(TA, 'tests', 'assemble.js'), '--force'], { cwd: TA, stdio: 'pipe' });
execFileSync(process.execPath, [path.join(TA, 'tests', 'build-dist.js')], { cwd: TA, stdio: 'pipe' });
/* the offline copy: connections only to itself; the app opened without signing in */
const SERVE = path.join(T, 'serve');
fs.cpSync(path.join(TA, 'dist'), SERVE, { recursive: true });
let page = fs.readFileSync(path.join(SERVE, 'index.html'), 'utf8');
page = '<meta http-equiv="Content-Security-Policy" content="connect-src \'self\'">\n' + page;
const hook = `
setTimeout(() => {
  try { $('loginView').style.display = 'none'; $('appView').classList.remove('hide'); document.body.classList.remove('gating'); if ($('gateWait')) $('gateWait').style.display = 'none'; } catch (e) {}
  try { ME.email = 'preview@local'; ME.admin = true; ME.tabs = []; } catch (e) {}
  try { syncNavGroups(); } catch (e) {}
  try { showTab(new URLSearchParams(location.search).get('tab') || 'shop'); } catch (e) {}
  window.__erpShow = t => showTab(t);
}, 300);
`;
const a = page.lastIndexOf('<script type="module">'), b = page.indexOf('</script>', a);
page = page.slice(0, b) + hook + page.slice(b);
fs.writeFileSync(path.join(SERVE, 'index.html'), page);
const kb = f => Math.round(fs.statSync(f).size / 1024);
console.log(`projection: page ${kb(path.join(SERVE, 'index.html'))} KB (today's deployed page ${kb(path.join(APP, 'dist', 'index.html'))} KB) → ${SERVE}`);
