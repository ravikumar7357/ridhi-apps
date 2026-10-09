/* THE PAGE IS BUILT FROM src/ (2026-10-01, step 1 of the module plan). Edit the files in src/, then:
 *
 *   node tests/assemble.js          joins src/ into public/index.html (the tests and build-dist.js read that file)
 *   node tests/assemble.js --check  only says whether public/index.html is what src/ makes; exit 1 if not
 *
 * src/index.html holds the page; three lines in it are replaced by files:
 *   <!--@include styles.css-->   src/styles.css      (inside <style>)
 *   <!--@include appv.js-->      src/appv.js         (inside the classic <script>)
 *   <!--@include app/-->         every src/app/*.js, in file-name order, joined as they are (one module, one scope)
 *
 * public/index.html is generated. An edit made there by hand would be lost the next time this runs, so this refuses to
 * overwrite a public/index.html that is neither what src/ makes nor what it last wrote (--force to overwrite anyway). */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
/* Either app: `--root ../Pricing-App` (or any app folder with src/ and public/) — the Replenish app by default. */
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg > 0 ? path.resolve(process.argv[rootArg + 1]) : path.join(__dirname, '..'), SRC = path.join(ROOT, 'src'), PUB = path.join(ROOT, 'public', 'index.html');
const STAMP = path.join(SRC, '.last-assembled.sha256');
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

/* The app files in join order. Since step 2 (2026-10-01) the files sit in group folders and src/app/ORDER says the
 * order; every .js file under src/app/ must be listed exactly once, so a new file cannot be left out by accident and
 * a listed file cannot be missing. Before ORDER existed: the top-level files by name. */
function walk(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(dir, path.posix.join(rel, d.name)) : (d.name.endsWith('.js') ? [path.posix.join(rel, d.name)] : []));
}
/* "@shared/x.js" in ORDER is Amazon Inventory/shared/x.js — one copy both apps join in (step 4, 2026-10-01). */
const SHARED = path.join(ROOT, '..', 'shared');
const appPath = f => (f.startsWith('@shared/') ? path.join(SHARED, f.slice(8)) : path.join(SRC, 'app', f));
function appFiles() {
  const APP = path.join(SRC, 'app'), ORDER = path.join(APP, 'ORDER');
  if (!fs.existsSync(ORDER)) return fs.readdirSync(APP).filter(f => /^\d{4}-[a-z0-9-]+\.js$/.test(f)).sort();
  const listed = fs.readFileSync(ORDER, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const there = new Set(walk(APP));
  const dup = listed.filter((f, i) => listed.indexOf(f) !== i);
  const missing = listed.filter(f => (f.startsWith('@shared/') ? !fs.existsSync(appPath(f)) : !there.has(f)));
  const unlisted = [...there].filter(f => !listed.includes(f));
  if (dup.length || missing.length || unlisted.length)
    throw new Error('src/app/ORDER does not match the files: '
      + [dup.length && 'listed twice ' + dup.join(', '), missing.length && 'listed but missing ' + missing.join(', '),
         unlisted.length && 'not listed ' + unlisted.join(', ')].filter(Boolean).join('; '));
  return listed;
}

/* SIGNPOSTS IN THE JOINED FILE (2026-10-09). The IT team opened public/index.html — 56,000 lines with nothing to
 * say where one source file ends and the next begins, or that the real source is src/ at all. Every app file now
 * starts with a comment naming it, a new group folder starts with a group heading, and the page opens with a
 * banner. Comments only: each file parses on its own and ends in a newline (checked), so a comment between two
 * files cannot change what the code does; build-dist.js strips every comment, so the deployed page is unchanged. */
const fileMark = f => `/* ${'='.repeat(30)} FILE: ${f.startsWith('@shared/') ? 'shared/' + f.slice(8) : 'src/app/' + f} ${'='.repeat(30)} */\n`;
const groupOf = f => (f.startsWith('@shared/') ? 'shared' : f.split('/')[0]);
const groupMark = g => `\n/* ${'#'.repeat(100)}\n * GROUP: ${g === 'shared' ? 'Amazon Inventory/shared/  (joined into both apps)' : 'src/app/' + g + '/'}\n * ${'#'.repeat(100)} */\n`;
function joinApp(files) {
  let last = '', out = '';
  for (const f of files) {
    const g = groupOf(f);
    if (g !== last) { out += groupMark(g); last = g; }
    out += fileMark(f) + fs.readFileSync(appPath(f), 'utf8');
  }
  return out;
}
function banner(files) {
  const groups = [...new Set(files.map(groupOf))];
  return `<!-- ${'='.repeat(96)}
     GENERATED FILE. DO NOT READ OR EDIT THE CODE HERE — it is the ${files.length} files of src/ joined into one page.
     The real, grouped source: ${path.basename(ROOT)}/src/   (map and workflow: src/README.md)
       src/index.html   page markup        src/styles.css   stylesheet        src/app/ORDER   join order
       src/app/<group>/ the code, by group: ${groups.join(', ')}
     Rebuild after editing src/:  node Replenish-App/tests/assemble.js${path.basename(ROOT) === 'Replenish-App' ? '' : ' --root ' + path.basename(ROOT)}
     Inside the script below, every source file starts with a "FILE: src/app/..." comment, every group with "GROUP:".
     ${'='.repeat(96)} -->`;   // no newline after it: build-dist strips the comment, and the page must come out unchanged
}

function assemble() {
  const shell = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const files = appFiles();
  const parts = {
    'styles.css': () => fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8'),
    'appv.js': () => fs.readFileSync(path.join(SRC, 'appv.js'), 'utf8'),
    'app/': () => joinApp(files),
  };
  let seen = 0;
  const out = shell.replace(/^<!--@include ([^>]+?)-->\r?\n/gm, (m, name) => {
    if (!parts[name]) throw new Error('unknown include: ' + name);
    seen++;
    return parts[name]();
  });
  /* styles.css and app/ always; appv.js where the app has that small classic script (Replenish does, Sellora not). */
  const want = fs.existsSync(path.join(SRC, 'appv.js')) ? 3 : 2;
  if (seen !== want) throw new Error(`src/index.html should have ${want} include lines, it has ${seen}`);
  /* The banner goes just before <title>: after a doctype if there is one, and at the very top otherwise. */
  const at = out.indexOf('<title');
  if (at < 0) throw new Error('src/index.html has no <title> to put the banner before');
  return out.slice(0, at) + banner(files) + out.slice(at);
}

if (require.main === module) {
  const out = assemble();
  const cur = fs.existsSync(PUB) ? fs.readFileSync(PUB, 'utf8') : '';
  if (process.argv.includes('--check')) {
    if (cur === out) { console.log('public/index.html is what src/ makes'); process.exit(0); }
    console.error('public/index.html is NOT what src/ makes — run node tests/assemble.js (or move a hand edit into src/)');
    process.exit(1);
  }
  const last = fs.existsSync(STAMP) ? fs.readFileSync(STAMP, 'utf8').trim() : '';
  if (cur && cur !== out && sha(cur) !== last && !process.argv.includes('--force')) {
    console.error('public/index.html was changed by hand since it was last assembled — those edits would be lost.\n'
      + 'Move them into src/ first, or run with --force to overwrite them.');
    process.exit(1);
  }
  fs.writeFileSync(PUB, out);
  fs.writeFileSync(STAMP, sha(out) + '\n');
  console.log(`public/index.html assembled from src/ (${(Buffer.byteLength(out) / 1024).toFixed(0)} KB, sha256 ${sha(out).slice(0, 16)})`);
}
module.exports = { assemble };
