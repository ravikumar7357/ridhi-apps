/* EVERY SCRIPT ON THE PAGE STILL READS AS CODE (21 Nov). A label with a bare apostrophe ('approve the store's close
 * request') once broke the whole factory ERP on the test link and UAT: the page's main script stopped at it, so nothing
 * ran and Sign in did nothing. The other checks compare files with each other and never ask whether the page's code can
 * be read at all; this one does. Each script inside public/index.html is checked by node itself (no browser, no data).
 *   node tests/page-scripts-parse-test.js
 *   PAGE=<a broken copy of the page> node tests/page-scripts-parse-test.js   (the teeth check) */
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const PAGE = process.env.PAGE ? path.resolve(process.env.PAGE) : path.join(__dirname, '..', 'public', 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

const html = fs.readFileSync(PAGE, 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-scripts-'));
const scripts = [];
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m;
while ((m = re.exec(html))) {
  if (/\bsrc=/.test(m[1]) || !m[2].trim()) continue;                 // a file loaded from elsewhere, or an empty tag
  if (/type="(?!module)[^"]*"/.test(m[1])) continue;                  // data (JSON, templates), not code
  scripts.push({ module: /type="module"/.test(m[1]), code: m[2], line: html.slice(0, m.index).split('\n').length });
}

console.log('== the factory ERP page: ' + scripts.length + ' scripts ==');
ok('the page has its main (module) script', scripts.some(s => s.module));
scripts.forEach((s, i) => {
  const f = path.join(dir, 'script' + i + (s.module ? '.mjs' : '.js'));
  fs.writeFileSync(f, s.code);
  let err = '';
  try { cp.execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { err = String(e.stderr || e.message).split('\n').filter(Boolean).slice(1, 4).join(' | ').slice(0, 300); }
  ok((s.module ? 'main script' : 'script') + ' from page line ' + s.line + ' reads as code', !err, err);
});
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
