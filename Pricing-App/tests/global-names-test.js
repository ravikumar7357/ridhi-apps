/* ONE SCOPE, NO CLASHES (28 Nov 2026). The whole app is ONE <script type="module"> in public/index.html: every file of src/app/ORDER
 * joined into one scope. In a module, a top-level name declared twice — const, let, class, OR function — is a SyntaxError, and the
 * browser then runs NOTHING ("Uncaught SyntaxError: Identifier 'PLX' has already been declared" — Parent Listing Review's PLX
 * against the Ads Placement page's, 096b327f, found on localhost). This test fails on any such clash before it can ship:
 *   1. the page's module script, exactly as the browser gets it, must compile as a module (node --check on it);
 *   2. every top-level name of every file (const / let / var / function / class / import), and which files declare it — a name in
 *      two places is listed with both files (only var + var is allowed: that is legal JavaScript);
 *   3. the same for any classic <script> blocks (one shared global scope);
 *   4. the checker itself: it must catch a planted clash, and the page of f2f553b5 (the PLX clash) when that commit is here.
 *   node tests/global-names-test.js          (run `node Replenish-App/tests/assemble.js --root Pricing-App --force` first)
 * acorn comes with Node (internal), so the test re-runs itself with --expose-internals. */
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
if (!process.execArgv.includes('--expose-internals')) {
  const r = cp.spawnSync(process.execPath, ['--expose-internals', __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status == null ? 1 : r.status);
}
const acorn = require('internal/deps/acorn/acorn/dist/acorn');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '\n' + String(extra).slice(0, 4000) : '')); } };
const PAGE = path.join(__dirname, '..', 'public', 'index.html');

/** The inline scripts of a page: { modules: [code], classic: [code] } (scripts with a src are not inline code). */
function scriptsOf(html) {
  const out = { modules: [], classic: [] };
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    (/type\s*=\s*["']?module/.test(m[1]) ? out.modules : out.classic).push(m[2]);
  }
  return out;
}
/** The code cut into its source files, by the assembler's markers ("FILE: src/app/…"); text before the first marker is "(page)". */
function filesOf(code) {
  const re = /\/\* =+ FILE: (\S+) =+ \*\//g;
  const cuts = [];
  let m;
  while ((m = re.exec(code))) cuts.push({ name: m[1], at: m.index });
  const parts = [];
  if (!cuts.length || cuts[0].at > 0) parts.push({ name: '(page)', code: code.slice(0, cuts.length ? cuts[0].at : code.length), line: 1 });
  cuts.forEach((c, i) => parts.push({ name: c.name, code: code.slice(c.at, i + 1 < cuts.length ? cuts[i + 1].at : code.length), line: code.slice(0, c.at).split('\n').length }));
  return parts;
}
/** The names a binding pattern declares. */
function patNames(p, out) {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach(q => patNames(q.type === 'RestElement' ? q.argument : q.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach(e => patNames(e, out));
  else if (p.type === 'RestElement') patNames(p.argument, out);
  else if (p.type === 'AssignmentPattern') patNames(p.left, out);
  return out;
}
/** Top-level declarations of one piece of code: [{ name, kind, line }]. A piece that does not parse alone → { err }. */
function topNames(code, sourceType) {
  let ast;
  try { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType, locations: true, allowHashBang: true }); } catch (e) { return { err: e.message }; }
  const out = [];
  const add = (name, kind, node) => out.push({ name, kind, line: node.loc.start.line });
  ast.body.forEach(n => {
    const d = (n.type === 'ExportNamedDeclaration' || n.type === 'ExportDefaultDeclaration') && n.declaration ? n.declaration : n;
    if (d.type === 'VariableDeclaration') d.declarations.forEach(v => patNames(v.id, []).forEach(x => add(x, d.kind, v)));
    else if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) add(d.id.name, d.type === 'ClassDeclaration' ? 'class' : 'function', d);
    else if (d.type === 'ImportDeclaration') d.specifiers.forEach(s => add(s.local.name, 'import', s));
  });
  return { names: out };
}
/** Every clash in one scope (the files of one script): [{ name, where: ['file:line kind', …] }]; var + var only is allowed. */
function clashesOf(code, sourceType) {
  const by = new Map(), unparsed = [];
  filesOf(code).forEach(f => {
    const r = topNames(f.code, sourceType);
    if (r.err) { unparsed.push(`${f.name}: ${r.err}`); return; }
    r.names.forEach(x => { if (!by.has(x.name)) by.set(x.name, []); by.get(x.name).push({ file: f.name, line: f.name === '(page)' ? x.line : x.line - 1, kind: x.kind }); });   // the file's own line (its marker is line 0)
  });
  const clashes = [];
  by.forEach((list, name) => { if (list.length > 1 && !list.every(x => x.kind === 'var')) clashes.push({ name, where: list.map(x => `${x.file}:${x.line} ${x.kind}`) }); });
  return { clashes, unparsed };
}
/** The browser's own verdict on a module: does it compile? (node --check on it as an .mjs) → '' or the error. */
function moduleError(code) {
  const tmp = path.join(os.tmpdir(), `sellora-one-scope-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, code);
  try {
    const r = cp.spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    return r.status === 0 ? '' : (r.stderr || r.stdout || 'failed').split('\n').filter(l => /Error|declared|\^/.test(l)).slice(0, 4).join('\n') || 'failed';
  } finally { try { fs.unlinkSync(tmp); } catch (e) { /* gone */ } }
}
const show = cs => cs.map(c => `    ${c.name}: ${c.where.join('  ·  ')}`).join('\n');

console.log('== 1. the page\'s module script compiles, as the browser compiles it ==');
const html = fs.readFileSync(PAGE, 'utf8');
const S = scriptsOf(html);
ok(`public/index.html has its app module (${S.modules.length} module script${S.modules.length === 1 ? '' : 's'}, ${(S.modules.join('').length / 1e6).toFixed(1)} MB)`, S.modules.length >= 1 && S.modules[0].length > 1e6);
S.modules.forEach((code, i) => {
  const err = moduleError(code);
  ok(`module script ${i + 1} compiles (node --check as a module) — no "has already been declared"`, !err, err);
});

console.log('== 2. no top-level name is declared in two places (every file of the module) ==');
S.modules.forEach((code, i) => {
  const r = clashesOf(code, 'module');
  ok(`module script ${i + 1}: every file parses on its own (${filesOf(code).length} files)`, !r.unparsed.length, r.unparsed.join('\n'));
  ok(`module script ${i + 1}: no name declared twice${r.clashes.length ? ` — ${r.clashes.length} clash(es):` : ''}`, !r.clashes.length, show(r.clashes));
});

console.log('== 3. the classic <script> blocks share one global scope: no clash there either ==');
const classic = S.classic.join('\n;\n');
if (!classic.trim()) ok('(no classic inline script on the page)', true);
else {
  const r = clashesOf(classic, 'script');
  ok('classic scripts: no name declared twice', !r.clashes.length && !r.unparsed.length, show(r.clashes) + r.unparsed.join('\n'));
}

console.log('== 4. the checker catches a clash ==');
{
  const planted = '/* ===== FILE: src/app/ads/a.js ===== */\nconst PLX = {};\nfunction plxModel() {}\n/* ===== FILE: src/app/sales/b.js ===== */\nconst PLX = 1;\nfunction plxModel() {}\nvar v = 1;\n/* ===== FILE: src/app/sales/c.js ===== */\nvar v = 2;\nlet { a, b: [c] } = {};\n/* ===== FILE: src/app/sales/d.js ===== */\nclass c {}\n';
  const r = clashesOf(planted, 'module');
  const names = r.clashes.map(c => c.name).sort().join();
  ok('a planted const, function and destructured-let/class clash are all found (var + var is allowed)', names === 'PLX,c,plxModel', names + '\n' + show(r.clashes));
  ok('…named with both files and lines: "PLX: src/app/ads/a.js:1 const · src/app/sales/b.js:1 const"', show(r.clashes).includes('PLX: src/app/ads/a.js:1 const  ·  src/app/sales/b.js:1 const'), show(r.clashes));
  ok('…and the module compile check fails on it too', /already been declared/.test(moduleError(planted)), moduleError(planted));
  let bad = '';
  try { bad = cp.execSync('git show f2f553b5:Pricing-App/public/index.html', { cwd: path.join(__dirname, '..', '..'), maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); } catch (e) { bad = ''; }
  if (!bad) ok('(the page of f2f553b5 is not in this checkout — skipped)', true);
  else {
    const code = scriptsOf(bad).modules[0];
    const r2 = clashesOf(code, 'module');
    ok('the page of f2f553b5 (the localhost failure) is caught: PLX, plxModel, plxRowOf in ads/placement-decide.js and sales/plr-insights.js',
      ['PLX', 'plxModel', 'plxRowOf'].every(n => r2.clashes.some(c => c.name === n && c.where.some(w => w.includes('placement-decide.js')) && c.where.some(w => w.includes('plr-insights.js'))))
      && /PLX.*already been declared|already been declared/.test(moduleError(code)), show(r2.clashes));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
