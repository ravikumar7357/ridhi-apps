/* Phase 1, step 2: Meera moves out of the ERP's folders into meera/ — her code to meera/client/src/legacy/, her look
 * to meera/client/meera.css — and the page build (tests/assemble.js) fetches them from there ("@meera/…" in ORDER),
 * so there is ONE copy of her, used by the page today and by meera.js later. The switches join the bridge, the only
 * Meera file left inside the ERP. Run once; git mv keeps each file's history. */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'), APP = path.join(ROOT, 'Replenish-App');
const CORE = path.join(APP, 'src', 'app', 'core'), LEG = path.join(ROOT, 'meera', 'client', 'src', 'legacy');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const crlf = s => s.replace(/\r?\n/g, '\r\n');

/* 1. her files */
fs.mkdirSync(LEG, { recursive: true });
const files = fs.readdirSync(CORE).filter(f => /^guide.*\.js$/.test(f));
for (const f of files) git('mv', path.join(CORE, f), path.join(LEG, f));
console.log('moved', files.length, 'files to meera/client/src/legacy/');

/* 2. ORDER: core/guide-x.js → @meera/legacy/guide-x.js; the switches line goes (they join the bridge) */
{
  const f = path.join(APP, 'src', 'app', 'ORDER');
  let s = fs.readFileSync(f, 'utf8'); const nl = s.includes('\r\n') ? '\r\n' : '\n';
  s = s.split(/\r?\n/).filter(l => l.trim() !== 'core/meera-switches.js').map(l => (/^core\/guide.*\.js$/.test(l.trim()) ? '@meera/legacy/' + l.trim().slice(5) : l)).join(nl);
  fs.writeFileSync(f, s);
}

/* 3. the switches join the bridge (the one Meera file inside the ERP) */
{
  const sw = fs.readFileSync(path.join(CORE, 'meera-switches.js'), 'utf8');
  const b = path.join(CORE, 'meera-bridge.js');
  fs.writeFileSync(b, crlf(fs.readFileSync(b, 'utf8').replace(/\s*$/, '') + '\n\n' + sw.replace(/\s*$/, '') + '\n'));
  git('rm', '-q', path.join(CORE, 'meera-switches.js'));
}

/* 4. her look: from "THE GUIDE CHARACTER" to the end of src/styles.css → meera/client/meera.css */
{
  const f = path.join(APP, 'src', 'styles.css');
  const s = fs.readFileSync(f, 'utf8');
  const at = s.indexOf('/* ================= THE GUIDE CHARACTER (guide.js, 2026-10-21)');
  if (at < 0) throw new Error('Meera\'s styles not found');
  fs.writeFileSync(f, s.slice(0, at));
  fs.writeFileSync(path.join(ROOT, 'meera', 'client', 'meera.css'), s.slice(at));
  console.log('styles: kept', s.slice(0, at).length, 'chars; Meera\'s', s.slice(at).length, 'chars → meera/client/meera.css');
}
