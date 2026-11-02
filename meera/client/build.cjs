/* BUILDS meera.js — Meera as a file of her own (v2 rebuild, Phase 1, 29 Oct 2026).
 *
 *   node meera/client/build.cjs           → Replenish-App/public/meera/meera.js and meera.webp
 *   node meera/client/build.cjs --check   only says whether those files are what the sources make (exit 1 if not)
 *
 * meera.js = src/start.ts + src/understand.ts (Phase 2) + src/design.ts (Phase 3, with design.css) + src/learn.ts (Phase 4) + src/server.ts (Phase 5) + her files (the "@meera/…" lines of Replenish-App/src/app/ORDER, in that order — the very
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
  /* Phase 6: a broken answer stops the build, in plain words (meera/tests/answers-check.cjs) */
  const bad = require(path.join(ROOT, 'meera', 'tests', 'answers-check.cjs')).check();
  if (bad.length) { console.log(`meera.js NOT BUILT — her answers have ${bad.length} problem(s):`); bad.slice(0, 30).forEach(b => console.log('  • ' + b)); process.exit(1); }
  const order = fs.readFileSync(path.join(APP, 'src', 'app', 'ORDER'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s.startsWith('@meera/'));
  const art = order.find(f => /guide-art\.(js|ts)$/.test(f));   // her picture file (TypeScript since Phase 6)
  const files = order.filter(f => f !== art).map(f => path.join(__dirname, 'src', f.slice(7)));
  const css = fs.readFileSync(path.join(__dirname, 'meera.css'), 'utf8');
  /* her new look (Phase 3): design.css with meera.css inside it, for her sealed box — the page's html.mob becomes the box's
   * own .mob (design.ts mirrors it) */
  const designCss = fs.readFileSync(path.join(__dirname, 'design.css'), 'utf8').replace('/*__MEERA_CSS__*/', () => css.replace(/html.mob /g, ':host(.mob) '));
  /* Phase 6: an older file already TypeScript (x.ts) is made JavaScript first (types removed, nothing renamed) */
  const plain = f => { const s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'); return f.endsWith('.ts') ? esbuild.transformSync(s, { loader: 'ts', legalComments: 'inline' }).code : s; };
  const legacy = files.map(f => `/* ---- ${path.relative(ROOT, f).replace(/\\/g, '/')} ---- */\n` + plain(f)).join('\n');
  const ts = (name, define) => esbuild.transformSync(fs.readFileSync(path.join(__dirname, 'src', name), 'utf8'), { loader: 'ts', define, legalComments: 'none' }).code;
  /* the version: what the sources say, so the same sources always make the same file */
  const version = crypto.createHash('sha256').update(legacy + css + designCss + ['start.ts', 'understand.ts', 'design.ts', 'learn.ts', 'server.ts', 'data.ts', 'finish.ts'].map(n => fs.readFileSync(path.join(__dirname, 'src', n), 'utf8')).join('')).digest('hex').slice(0, 12);
  const whole = '(function () {\n"use strict";\n'
    + 'if (!window.ERP_MEERA || window.__MEERA_STARTED) return;   // no bridge (not the ERP), or already started\n'
    + 'window.__MEERA_STARTED = true;\n'
    + ts('start.ts', { __MEERA_CSS__: JSON.stringify(css) }) + '\n'
    + ts('understand.ts', {}) + '\n'   // Phase 2: how she reads spelling mistakes (switch "spell")
    + ts('design.ts', { __MEERA_DESIGN_CSS__: JSON.stringify(designCss) }) + '\n'   // Phase 3: her new look (switch "design")
    + ts('learn.ts', {}) + '\n'   // Phase 4: learning from staff (switch "learn")
    + ts('server.ts', {}) + '\n'   // Phase 5: searching on her router (switches "server", "serveruse")
    + ts('data.ts', {}) + '\n'   // Phase 7: answers from the ERP's own figures, read only (switch "data")
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
  /* PHASE 5: the small list for each screen, for when her router cannot be reached (switch "serveruse"): each answer's
   * first ways of asking and its one line (cut at 220 letters), no steps; the screen's walk-throughs; the general answers
   * (no screen) in _.json, the 40 with the most ways of asking */
  const G = path.join(APP, 'public', 'guide'), bank = JSON.parse(fs.readFileSync(path.join(G, 'meera-bank.json'), 'utf8')), walks = JSON.parse(fs.readFileSync(path.join(G, 'meera-walks.json'), 'utf8'));
  const cut = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, String(v).length > 220 ? String(v).slice(0, 217).replace(/<[^>]*$/, '') + '…' : v]));
  const slim = e => ({ id: e.id, tab: e.tab || '', q: { en: (e.q.en || []).slice(0, 2), hi: (e.q.hi || []).slice(0, 1), hg: (e.q.hg || []).slice(0, 2) }, a: cut(e.a), ...(e.task ? { task: e.task } : {}), ...(e.sel ? { sel: e.sel } : {}) });
  const ways = new Map(bank.map(e => [e.id, ((e.q || {}).en || []).length]));
  const backup = {};
  for (const e of bank) { if (e.p || !e.q || !e.a) continue; const t = e.tab || '_'; (backup[t] = backup[t] || []).push(slim(e)); }
  backup._ = (backup._ || []).sort((x, y) => ways.get(y.id) - ways.get(x.id)).slice(0, 40);
  const lists = {};
  for (const [t, list] of Object.entries(backup)) {
    const ws = t === '_' ? walks.filter(w => w.replaces || w.existing) : walks.filter(w => (w.steps || []).some(s => s.tab === t) || (w.from || []).some(id => list.some(e => e.id === id)));
    lists['backup/' + t + '.json'] = Buffer.from(JSON.stringify({ answers: list, walks: ws }));
  }
  /* switch "autobank": the drafts for the admin page (new screens, new jobs, parts with no help text) */
  const dr = path.join(ROOT, 'meera', 'bank', 'drafts.json');
  lists['drafts.json'] = Buffer.from(fs.existsSync(dr) ? JSON.stringify(JSON.parse(fs.readFileSync(dr, 'utf8'))) : '[]');
  return { ...lists, 'meera.js': file, [`meera.${version}.js`]: file, 'meera.version.json': Buffer.from(JSON.stringify({ v: version }) + '\n'),
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
  fs.mkdirSync(path.join(OUT, 'backup'), { recursive: true });
  for (const f of fs.readdirSync(path.join(OUT, 'backup'))) if (!names.includes('backup/' + f)) fs.unlinkSync(path.join(OUT, 'backup', f));   // a screen no longer in her answers
  for (const f of names) fs.writeFileSync(path.join(OUT, f), out[f]);
  console.log(`built meera.${out.version}.js: ${Math.round(out['meera.js'].length / 1024)} KB, meera.webp ${Math.round(out['meera.webp'].length / 1024)} KB`);
}
