/* THE PAGE THAT IS DEPLOYED, built from the page that is edited (Ravi, 2026-09-26: the page had grown to 3.07 MB,
 * 2.4 MB a week earlier, and every open parses all of it).
 *
 *   node tests/build-dist.js          → dist/  (firebase.json deploys dist, not public)
 *
 * public/index.html stays the ONE source: the tests read it, the guide is built from it, every edit lands there.
 * This copies public/ to dist/ and rewrites index.html with the comments out — a real JavaScript parser (esbuild) does
 * the script, so a "/*" inside a string or a regex is never mistaken for one; the stylesheet is minified the same
 * way; HTML comments go from the markup. Nothing is renamed and no syntax is changed, so a console error still names
 * the function it happened in and the code around it still reads. */
const fs = require('fs'), path = require('path');
const esbuild = require('esbuild');
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public'), DIST = path.join(ROOT, 'dist');

const src = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const stripMarkup = s => s.replace(/<!--[\s\S]*?-->/g, '');
/* A script's own text must not be able to close the tag it sits in. */
const safe = js => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

let out = '', last = 0, scripts = 0, styles = 0;
const re = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)|(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g;
for (const m of src.matchAll(re)) {
  out += stripMarkup(src.slice(last, m.index));
  if (m[1] !== undefined) {
    const open = m[1], body = m[2];
    if (/\bsrc\s*=/.test(open) || !body.trim() || /type\s*=\s*"(?!module|text\/javascript)/.test(open)) out += open + body + m[3];
    else {
      const r = esbuild.transformSync(body, { loader: 'js', legalComments: 'none', charset: 'utf8', target: 'es2022' });
      if (r.warnings.length) r.warnings.forEach(w => console.warn('esbuild:', w.text));
      out += open + '\n' + safe(r.code) + m[3];
      scripts++;
    }
  } else {
    const r = esbuild.transformSync(m[5], { loader: 'css', minify: true, charset: 'utf8' });
    out += m[4] + r.code + m[6];
    styles++;
  }
  last = m.index + m[0].length;
}
out += stripMarkup(src.slice(last));

/* Everything else in public/ as it is; then the page. */
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(PUB, DIST, { recursive: true, filter: p => !path.basename(p).startsWith('.') && p !== path.join(PUB, 'index.html') });
fs.writeFileSync(path.join(DIST, 'index.html'), out);

/* Proof it still parses: the module script, through node. */
const mod = out.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!mod) throw new Error('the module script is not in the built page');
const chk = path.join(require('os').tmpdir(), 'replenish-dist-check.mjs');
fs.writeFileSync(chk, mod[1]);
const res = require('child_process').spawnSync(process.execPath, ['--check', chk], { encoding: 'utf8' });
if (res.status !== 0) { console.error(res.stderr); throw new Error('the built script does not parse'); }

const mb = n => (n / 1048576).toFixed(2) + ' MB';
console.log(`built dist/index.html: ${mb(src.length)} → ${mb(out.length)} (${scripts} script(s), ${styles} stylesheet(s))`);
