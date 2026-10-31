/* Phase 1, step 2 (after the move): the test bench, the never-break checks and the app-deps tool find Meera in
 * meera/client/src/ ("@meera/…" in ORDER) and the bridge in core/meera-bridge.js. */
const fs = require('fs'), path = require('path');
const M = path.join(__dirname, '..');
function edit(rel, pairs) {
  const f = path.join(M, rel);
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of pairs) { if (s.split(a).length !== 2) throw new Error(rel + ': not once: ' + a.slice(0, 70)); s = s.replace(a, () => b); }
  fs.writeFileSync(f, s);
  console.log('  ' + rel);
}
edit('tests/harness.cjs', [
  ["  return order.filter(f => /^core\\/(guide|meera)/.test(f)).map(f => path.join(app, 'src/app', f));",
   "  /* the bridge (inside the ERP) and Meera's own files (meera/client/src, \"@meera/…\" since Phase 1) */\n"
   + "  return order.filter(f => /^core\\/(guide|meera)|^@meera\\//.test(f))\n"
   + "    .map(f => (f.startsWith('@meera/') ? path.join(app, '..', 'meera', 'client', 'src', f.slice(7)) : path.join(app, 'src/app', f)));"],
]);
edit('tests/never-break.cjs', [
  ["  const src = [path.join(APP, 'src/index.html'), ...walk(path.join(APP, 'src/app')).filter(f => f.endsWith('.js'))].map(f => fs.readFileSync(f, 'utf8')).join('\\n');",
   "  const src = [path.join(APP, 'src/index.html'), ...walk(path.join(APP, 'src/app')).filter(f => f.endsWith('.js')),\n"
   + "    ...walk(path.join(ROOT, 'meera/client/src')).filter(f => /\\.(js|ts)$/.test(f))].map(f => fs.readFileSync(f, 'utf8')).join('\\n');"],
]);
edit('tools/app-deps.cjs', [
  ["const isMeera = f => /^core\\/(guide|meera)/.test(f);",
   "const isMeera = f => /^core\\/(guide|meera)|^@meera\\//.test(f);"],
  ["  const p = f.startsWith('@shared/') ? path.join(ROOT, 'shared', f.slice(8)) : path.join(APP, f);",
   "  const p = f.startsWith('@shared/') ? path.join(ROOT, 'shared', f.slice(8)) : f.startsWith('@meera/') ? path.join(ROOT, 'meera', 'client', 'src', f.slice(7)) : path.join(APP, f);"],
]);
/* the size line: her code now lives in meera/client/src */
edit('tests/measure.cjs', [
  ["  const order = fs.readFileSync(path.join(app, 'src/app/ORDER'), 'utf8').split(/\\r?\\n/).map(s => s.trim()).filter(s => /^core\\/guide/.test(s));\n  const code = order.map(f => fs.readFileSync(path.join(app, 'src/app', f)));",
   "  const order = fs.readFileSync(path.join(app, 'src/app/ORDER'), 'utf8').split(/\\r?\\n/).map(s => s.trim()).filter(s => /^core\\/(guide|meera)|^@meera\\//.test(s));\n"
   + "  const where = f => (f.startsWith('@meera/') ? path.join(ROOT, 'meera', 'client', 'src', f.slice(7)) : path.join(app, 'src/app', f));\n"
   + "  const code = order.map(f => fs.readFileSync(where(f)));"],
  ["  const art = path.join(app, 'src/app/core/guide-art.js');",
   "  const art = [path.join(ROOT, 'meera/client/src/legacy/guide-art.js'), path.join(app, 'src/app/core/guide-art.js')].find(f => fs.existsSync(f));"],
  ["  if (fs.existsSync(art)) out['picture (guide-art.js)'] = one(art);",
   "  if (art) out['picture (guide-art.js)'] = one(art);"],
]);
