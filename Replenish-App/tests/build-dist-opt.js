/* A LIGHTER BUILD, for trying out locally — never deployed by itself (Ravi, 2026-10-01: "optimize the project code but
 * dont deploy it ... make the code lightweight as much as possible ... dont change anything if you are not sure").
 *
 *   node tests/build-dist-opt.js      → dist-opt/   (firebase.json still deploys dist/, built by build-dist.js)
 *
 * public/index.html is not touched. What this does on top of build-dist.js:
 *   - the module script is fully minified by esbuild (whitespace, syntax, and local names) and tree-shaken, so a
 *     top-level function nothing calls is left out;
 *   - a source map is written beside the page (index.module.js.map), so a console error can still be traced back
 *     to the real function name in DevTools — browsers only fetch it when DevTools is open;
 *   - the small classic script and the stylesheet are minified;
 *   - the markup between tags loses its indentation and blank lines (never inside <pre> or <textarea>);
 *   - PNG images are kept as they are (no lossless optimiser is installed here; see the report).
 * The app needs no eval, new Function or with, and reads no function's own name, so renaming local names is safe. */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const esbuild = require('esbuild');
/* Either app: no argument builds the Replenish app; `node tests/build-dist-opt.js ../Pricing-App` builds Sellora. */
const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public'), OUT = path.join(ROOT, 'dist-opt');

const src = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const safe = js => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
/* Markup: comments out; each line's leading indentation and empty lines out, except inside <pre>/<textarea>. */
function tidyMarkup(s) {
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  const keep = [];
  s = s.replace(/<(pre|textarea)\b[\s\S]*?<\/\1>/gi, m => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; });
  s = s.split('\n').map(l => l.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')).filter(l => l !== '').join('\n');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
}

let out = '', last = 0, map = null;
const re = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)|(<style\b[^>]*>)([\s\S]*?)(<\/style>)/g;
for (const m of src.matchAll(re)) {
  out += tidyMarkup(src.slice(last, m.index));
  if (m[1] !== undefined) {
    const open = m[1], body = m[2];
    if (/\bsrc\s*=/.test(open) || !body.trim() || /type\s*=\s*"(?!module|text\/javascript)/.test(open)) out += open + body + m[3];
    else if (/type\s*=\s*"module"/.test(open)) {
      const r = esbuild.transformSync(body, { loader: 'js', legalComments: 'none', charset: 'utf8', target: 'es2022',
        format: 'esm', minify: true, treeShaking: true, sourcemap: 'external', sourcefile: 'index.html (module script)' });
      r.warnings.forEach(w => console.warn('esbuild:', w.text));
      map = r.map;
      out += open + safe(r.code) + '\n//# sourceMappingURL=index.module.js.map\n' + m[3];
    } else {
      /* The classic script runs in the page's global scope: its own names stay (minifyIdentifiers off). */
      const r = esbuild.transformSync(body, { loader: 'js', legalComments: 'none', charset: 'utf8', target: 'es2022',
        minifyWhitespace: true, minifySyntax: true });
      out += open + safe(r.code) + m[3];
    }
  } else {
    out += m[4] + esbuild.transformSync(m[5], { loader: 'css', minify: true, charset: 'utf8' }).code + m[6];
  }
  last = m.index + m[0].length;
}
out += tidyMarkup(src.slice(last));

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(PUB, OUT, { recursive: true, filter: p => !path.basename(p).startsWith('.') && p !== path.join(PUB, 'index.html') });
fs.writeFileSync(path.join(OUT, 'index.html'), out);
if (map) fs.writeFileSync(path.join(OUT, 'index.module.js.map'), map);

/* Proof it still parses. */
const mod = out.match(/<script type="module">([\s\S]*?)<\/script>/);
const chk = path.join(require('os').tmpdir(), 'replenish-distopt-check.mjs');
fs.writeFileSync(chk, mod[1]);
const res = require('child_process').spawnSync(process.execPath, ['--check', chk], { encoding: 'utf8' });
if (res.status !== 0) { console.error(res.stderr); throw new Error('the optimised script does not parse'); }

const kb = n => (n / 1024).toFixed(0) + ' KB';
const sizes = s => `${kb(Buffer.byteLength(s))} raw · ${kb(zlib.gzipSync(s, { level: 9 }).length)} gzip · ${kb(zlib.brotliCompressSync(s).length)} brotli`;
console.log('public/index.html  ' + sizes(src));
const cur = path.join(ROOT, 'dist', 'index.html');
if (fs.existsSync(cur)) console.log('dist/index.html    ' + sizes(fs.readFileSync(cur, 'utf8')));
console.log('dist-opt/index.html ' + sizes(out));
