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
const ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src'), PUB = path.join(ROOT, 'public', 'index.html');
const STAMP = path.join(SRC, '.last-assembled.sha256');
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

function assemble() {
  const shell = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const parts = {
    'styles.css': () => fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8'),
    'appv.js': () => fs.readFileSync(path.join(SRC, 'appv.js'), 'utf8'),
    'app/': () => fs.readdirSync(path.join(SRC, 'app')).filter(f => /^\d{4}-[a-z0-9-]+\.js$/.test(f)).sort()
      .map(f => fs.readFileSync(path.join(SRC, 'app', f), 'utf8')).join(''),
  };
  let seen = 0;
  const out = shell.replace(/^<!--@include ([^>]+?)-->\r?\n/gm, (m, name) => {
    if (!parts[name]) throw new Error('unknown include: ' + name);
    seen++;
    return parts[name]();
  });
  if (seen !== 3) throw new Error(`src/index.html should have 3 include lines, it has ${seen}`);
  return out;
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
