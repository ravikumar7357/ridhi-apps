/* Phase 6: every place that reads her older files learns to read them as TypeScript too (x.ts in place of x.js, the
 * types removed by the repo's own esbuild). Run once. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
function edit(rel, pairs) {
  const f = path.join(ROOT, rel);
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${rel}: found ${n}× — ${a.slice(0, 70)}`);
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(f, s);
}
/* meera.js: her older files, TypeScript made JavaScript one by one before they are joined */
edit('meera/client/build.cjs', [
  ["  const legacy = files.map(f => `/* ---- ${path.relative(ROOT, f).replace(/\\\\/g, '/')} ---- */\\n` + fs.readFileSync(f, 'utf8').replace(/\\r\\n/g, '\\n')).join('\\n');",
   "  /* Phase 6: an older file already TypeScript (x.ts) is made JavaScript first (types removed, nothing renamed) */\n"
 + "  const plain = f => { const s = fs.readFileSync(f, 'utf8').replace(/\\r\\n/g, '\\n'); return f.endsWith('.ts') ? esbuild.transformSync(s, { loader: 'ts', legalComments: 'inline' }).code : s; };\n"
 + "  const legacy = files.map(f => `/* ---- ${path.relative(ROOT, f).replace(/\\\\/g, '/')} ---- */\\n` + plain(f)).join('\\n');"],
]);
/* the test bench: inside-the-page mode joins the same files */
edit('meera/tests/harness.cjs', [
  ["    const code = fs.readFileSync(f, 'utf8');\n",
   "    let code = fs.readFileSync(f, 'utf8');\n"
 + "    if (f.endsWith('.ts')) code = require(path.join(app, 'node_modules', 'esbuild')).transformSync(code.replace(/\\r\\n/g, '\\n'), { loader: 'ts', legalComments: 'inline' }).code;   // Phase 6: her TypeScript files\n"],
]);
/* the gate's list of boxes she points at, and the router's search maker: x.ts when it is there */
edit('meera/tests/ci-gate.cjs', [
  ["  for (const f of ['guide-tours.js', 'guide-ask.js']) {\n    const src = fs.readFileSync(path.join(ROOT, 'meera/client/src/legacy', f), 'utf8');",
   "  for (const f of ['guide-tours', 'guide-ask']) {\n    const base = path.join(ROOT, 'meera/client/src/legacy', f), src = fs.readFileSync(fs.existsSync(base + '.ts') ? base + '.ts' : base + '.js', 'utf8');"],
]);
edit('meera/router/build-search.cjs', [
  ["const FILES = ['understand.ts', 'legacy/guide-tours.js', 'legacy/guide-ask.js'];",
   "/* her older files are .js until each becomes .ts (Phase 6): whichever is there */\n"
 + "const pick = f => (fs.existsSync(path.join(SRC, f + '.ts')) ? f + '.ts' : f + '.js');\n"
 + "const FILES = ['understand.ts', pick('legacy/guide-tours'), pick('legacy/guide-ask')];"],
  ["  const [und, tours, ask] = sources();\n  const undJs = esbuild.transformSync(und, { loader: 'ts', legalComments: 'none' }).code;",
   "  const js = (src, f) => (f.endsWith('.ts') ? esbuild.transformSync(src, { loader: 'ts', legalComments: 'inline' }).code : src);\n"
 + "  const [und, tours, ask] = sources().map((s, i) => js(s, FILES[i]));\n  const undJs = und;"],
]);
edit('meera/router/test/same-cleaning.test.mjs', [
  ["const src = readFileSync(path.join(HERE, '..', '..', 'client', 'src', 'legacy', 'guide-ai.js'), 'utf8');",
   "/* guide-ai.ts once it is TypeScript (Phase 6) — gaClean itself is kept free of type marks, so it runs as it is */\n"
 + "const AI = path.join(HERE, '..', '..', 'client', 'src', 'legacy', 'guide-ai');\n"
 + "const src = readFileSync(existsSync(AI + '.ts') ? AI + '.ts' : AI + '.js', 'utf8');"],
  ["import { readFileSync } from 'node:fs';", "import { readFileSync, existsSync } from 'node:fs';"],
]);
/* the router redeploys when her search code changes — as .ts too */
edit('.github/workflows/meera-router.yml', [
  ["            'meera/client/src/understand.ts', 'meera/client/src/legacy/guide-ask.js', 'meera/client/src/legacy/guide-tours.js',",
   "            'meera/client/src/understand.ts', 'meera/client/src/legacy/guide-ask.*', 'meera/client/src/legacy/guide-tours.*',"],
  ["    paths: ['meera/router/**', 'meera/client/src/legacy/guide-ai.js', '.github/workflows/meera-router.yml',",
   "    paths: ['meera/router/**', 'meera/client/src/legacy/guide-ai.*', '.github/workflows/meera-router.yml',"],
]);
console.log('ok');
