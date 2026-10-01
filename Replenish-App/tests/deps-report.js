/* WHAT EACH GROUP NEEDS FROM THE OTHERS (2026-10-01, step 5 of the module plan: "load a tab's code when it opens").
 * Read-only. Before a group can be loaded later, as its own module, we have to know:
 *   - which top-level names it uses that another group declares (those must be imported, or moved to core),
 *   - which other groups use ITS names (those callers must wait for it to load),
 *   - which shared `let` variables it ASSIGNS although another group declares them (an ES module cannot assign an
 *     imported variable — every one of these is a blocker),
 *   - how many statements run the moment the page loads (button wiring etc.), which would then run later.
 *
 *   node tests/deps-report.js [../Pricing-App]      → prints a table; writes src/deps.json
 *
 * Names are found with patterns on code whose comments and strings were removed by esbuild, so the counts are close
 * but not exact (a name inside a template literal's ${…} is seen; a name built from a string is not). */
const fs = require('fs'), path = require('path');
const esbuild = require('esbuild');
const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src'), APP = path.join(SRC, 'app'), SHARED = path.join(ROOT, '..', 'shared');
const order = fs.readFileSync(path.join(APP, 'ORDER'), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const fileOf = f => (f.startsWith('@shared/') ? path.join(SHARED, f.slice(8)) : path.join(APP, f));
const groupOf = f => (f.startsWith('@shared/') ? 'shared' : (f.split('/').length > 2 ? f.split('/').slice(0, 2).join('/') : f.split('/')[0]));

/* Strip comments and string contents but keep template ${…}: esbuild removes comments; strings are blanked here. */
function clean(js) {
  let out = '';
  try { out = esbuild.transformSync(js, { loader: 'js', minifyWhitespace: false, legalComments: 'none', target: 'esnext' }).code; }
  catch (e) { out = js; }
  return out.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''").replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, m => m.replace(/(^`|`$)|[^$`{}]+(?![^{]*\})/g, ''));
}
const DECL = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?(const|let|var)\s+([\s\S]*?)(?:;|$)/gm;
const files = order.map(f => ({ f, g: groupOf(f), raw: fs.readFileSync(fileOf(f), 'utf8') }));
const declBy = new Map(), letNames = new Set();
for (const x of files) {
  x.code = clean(x.raw);
  x.decls = new Set();
  /* top level = a line that starts at column 0 */
  for (const m of x.code.matchAll(DECL)) {
    if (m[1] || m[2]) { x.decls.add(m[1] || m[2]); continue; }
    const kind = m[3], body = m[4];
    /* `const a = …, b = …` and `let { a, b } = …`: names at nesting depth 0 before each "=" */
    let depth = 0, tok = '', names = [];
    for (const ch of body) {
      if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--;
      if (depth === 0 && ch === ',') { names.push(tok); tok = ''; } else tok += ch;
    }
    names.push(tok);
    names.forEach(t => { const n = (t.split('=')[0].match(/[A-Za-z_$][\w$]*/) || [])[0]; if (n) { x.decls.add(n); if (kind !== 'const') letNames.add(n); } });
  }
  x.decls.forEach(n => { if (!declBy.has(n)) declBy.set(n, x.g); });
}
const groups = [...new Set(files.map(x => x.g))];
const G = Object.fromEntries(groups.map(g => [g, { bytes: 0, files: 0, decls: 0, uses: {}, usedBy: {}, assignsForeign: new Set(), loadStmts: 0 }]));
for (const x of files) {
  const s = G[x.g];
  s.bytes += Buffer.byteLength(x.raw); s.files++; s.decls += x.decls.size;
  const ids = new Set(x.code.match(/(?<![\w$.])[A-Za-z_$][\w$]*/g) || []);
  for (const id of ids) {
    const owner = declBy.get(id);
    if (!owner || owner === x.g) continue;
    s.uses[owner] = (s.uses[owner] || new Set()).add(id);
    G[owner].usedBy[x.g] = (G[owner].usedBy[x.g] || new Set()).add(id);
  }
  /* a shared let assigned here: NAME = / NAME += … (not ==, not a property) */
  for (const m of x.code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:[+\-*/|&]?=)(?!=)/g)) {
    const n = m[1];
    if (letNames.has(n) && declBy.get(n) !== x.g && !x.decls.has(n)) s.assignsForeign.add(n);
  }
  /* statements that run at load: a top-level line that is not a declaration, a closing brace or a comment */
  s.loadStmts += (x.code.match(/^(?!(?:export\s+)?(?:async\s+)?function|(?:export\s+)?(?:const|let|var|class)\b|import\b|[}\])]|\s|$)\S.*$/gm) || []).length;
}
const rows = groups.map(g => {
  const s = G[g];
  const nonCore = Object.entries(s.uses).filter(([o]) => o !== 'core');
  return { group: g, KB: Math.round(s.bytes / 1024), files: s.files, names: s.decls,
    'uses core': (s.uses.core || new Set()).size,
    'uses other groups': nonCore.reduce((a, [, v]) => a + v.size, 0) + ' (' + nonCore.map(([o, v]) => o + ' ' + v.size).join(', ') + ')',
    'used by others': Object.entries(s.usedBy).reduce((a, [, v]) => a + v.size, 0),
    'assigns shared lets': s.assignsForeign.size, 'runs at load': s.loadStmts };
});
rows.sort((a, b) => a['used by others'] - b['used by others']);
console.table(rows);
const out = Object.fromEntries(groups.map(g => [g, {
  uses: Object.fromEntries(Object.entries(G[g].uses).map(([o, v]) => [o, [...v].sort()])),
  usedBy: Object.fromEntries(Object.entries(G[g].usedBy).map(([o, v]) => [o, [...v].sort()])),
  assignsForeign: [...G[g].assignsForeign].sort() }]));
fs.writeFileSync(path.join(SRC, 'deps.json'), JSON.stringify(out, null, 1));
console.log('details: ' + path.relative(process.cwd(), path.join(SRC, 'deps.json')));
