/* BUILDS meera.js — Meera as a file of her own (v2 rebuild, Phase 1, 29 Oct 2026).
 *
 *   node meera/client/build.cjs           → Replenish-App/public/meera/meera.js and meera.webp
 *   node meera/client/build.cjs --check   only says whether those files are what the sources make (exit 1 if not)
 *
 * meera.js = src/start.ts + src/understand.ts (Phase 2) + her files (the "@meera/…" lines of Replenish-App/src/app/ORDER, in that order — the very
 * files the page joins while the "lazy" switch is off; her picture file excepted) + src/finish.ts, in one closed box,
 * with her look (meera.css) inside. TypeScript is turned into JavaScript by the repo's own esbuild (no type check
 * here: npm is blocked on the office PC; the type check runs on GitHub). Nothing is renamed, so an error still names
 * the function it happened in. The page loads it only with the "lazy" switch on (core/meera-bridge.js). */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'Replenish-App');
const esbuild = require(path.join(APP, 'node_modules', 'esbuild'));
const OUT = path.join(APP, 'public', 'meera');

function build() {
  const order = fs.readFileSync(path.join(APP, 'src', 'app', 'ORDER'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s.startsWith('@meera/'));
  const art = order.find(f => /guide-art\.js$/.test(f));
  const files = order.filter(f => f !== art).map(f => path.join(__dirname, 'src', f.slice(7)));
  const css = fs.readFileSync(path.join(__dirname, 'meera.css'), 'utf8');
  const legacy = files.map(f => `/* ---- ${path.relative(ROOT, f).replace(/\\/g, '/')} ---- */\n` + fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).join('\n');
  const ts = (name, define) => esbuild.transformSync(fs.readFileSync(path.join(__dirname, 'src', name), 'utf8'), { loader: 'ts', define, legalComments: 'none' }).code;
  /* the version: what the sources say, so the same sources always make the same file */
  const version = crypto.createHash('sha256').update(legacy + css + ['start.ts', 'understand.ts', 'finish.ts'].map(n => fs.readFileSync(path.join(__dirname, 'src', n), 'utf8')).join('')).digest('hex').slice(0, 12);
  const whole = '(function () {\n"use strict";\n'
    + 'if (!window.ERP_MEERA || window.__MEERA_STARTED) return;   // no bridge (not the ERP), or already started\n'
    + 'window.__MEERA_STARTED = true;\n'
    + ts('start.ts', { __MEERA_CSS__: JSON.stringify(css) }) + '\n'
    + ts('understand.ts', {}) + '\n'   // Phase 2: how she reads spelling mistakes (switch "spell")
    + legacy + '\n'
    + ts('finish.ts', { __MEERA_VERSION__: JSON.stringify(version) })
    + '})();\n';
  /* comments and spaces out (as build-dist does for the page); names untouched */
  const js = esbuild.transformSync(whole, { loader: 'js', minifyWhitespace: true, legalComments: 'none' }).code;
  const head = `/* meera.js ${version} — Meera, the ERP's assistant. Built by meera/client/build.cjs from meera/client/src; do not edit. */\n`;
  /* her picture, once, as a file of its own */
  const artSrc = fs.readFileSync(path.join(__dirname, 'src', art.slice(7)), 'utf8');
  const m = artSrc.match(/data:image\/webp;base64,([A-Za-z0-9+/=]+)/);
  if (!m) throw new Error('her picture was not found in ' + art);
  const file = Buffer.from(head + js, 'utf8');
  /* VERSIONED (29 Oct, measured on live: the site never answers "unchanged" for meera.js, so "check every time" meant
   * "download 64 KB every time"). meera.<version>.js may be kept by the browser for good; the tiny meera.version.json
   * (checked every load, ~50 bytes) says which one is current — so a new Meera still needs no ERP change. meera.js
   * stays as the fallback when the version file cannot be read. */
  return { 'meera.js': file, [`meera.${version}.js`]: file, 'meera.version.json': Buffer.from(JSON.stringify({ v: version }) + '\n'),
    'meera.webp': Buffer.from(m[1], 'base64'), version };
}

const out = build();
const names = Object.keys(out).filter(k => k !== 'version');
if (process.argv.includes('--check')) {
  const stale = names.filter(f => !fs.existsSync(path.join(OUT, f)) || !fs.readFileSync(path.join(OUT, f)).equals(out[f]));
  if (stale.length) { console.log('Replenish-App/public/meera/' + stale.join(', ') + ' is NOT what meera/client makes — run node meera/client/build.cjs'); process.exit(1); }
  console.log('meera.js is what meera/client makes (' + out.version + ')');
} else {
  fs.mkdirSync(OUT, { recursive: true });
  /* older versioned files go: only the current one is published */
  for (const f of fs.readdirSync(OUT)) if (/^meera\.[0-9a-f]{12}\.js$/.test(f) && !names.includes(f)) fs.unlinkSync(path.join(OUT, f));
  for (const f of names) fs.writeFileSync(path.join(OUT, f), out[f]);
  console.log(`built meera.${out.version}.js: ${Math.round(out['meera.js'].length / 1024)} KB, meera.webp ${Math.round(out['meera.webp'].length / 1024)} KB`);
}
