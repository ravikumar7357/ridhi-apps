/* ONE-TIME: cut public/index.html into src/ (Ravi, 2026-10-01: "start 1 process" — step 1 of the module plan,
 * https://claude.ai/artifact/QhwqZHFWWDCeMspHrsNHvd). Nothing is reordered or changed: the pieces joined back by
 * tests/assemble.js give the same bytes. Refuses to run if src/ already exists.
 *
 *   node tests/src-split.js
 *
 *   src/index.html        the page with three include lines where the stylesheet and the two scripts were
 *   src/styles.css        what was inside <style>
 *   src/appv.js           the small classic script (app version check)
 *   src/app/NNN-name.js   the module script, cut at its own section headings, in page order
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public', 'index.html'), SRC = path.join(ROOT, 'src');
if (fs.existsSync(SRC)) throw new Error('src/ already exists — this split is done once');
const s = fs.readFileSync(PUB, 'utf8');
const NL = '\r\n';
const at = (needle, from = 0) => { const i = s.indexOf(needle, from); if (i < 0) throw new Error('not found: ' + needle); return i; };

/* The three blocks, by the exact text around them. Each include line replaces the block's inside. */
const styleOpen = at('<style>' + NL) + ('<style>' + NL).length, styleClose = at(NL + '</style>' + NL, styleOpen) + NL.length;
const appvOpen = at('<script>' + NL, styleClose) + ('<script>' + NL).length, appvClose = at('</script>' + NL, appvOpen);
const modTag = '<script type="module">' + NL;
const modOpen = at(modTag, appvClose) + modTag.length, modClose = s.lastIndexOf('</script>');
if (s.indexOf('<script', modOpen) >= 0) throw new Error('a script after the module — the split expects none');

const css = s.slice(styleOpen, styleClose), appv = s.slice(appvOpen, appvClose), mod = s.slice(modOpen, modClose);
const shell = s.slice(0, styleOpen) + '<!--@include styles.css-->' + NL + s.slice(styleClose, appvOpen)
  + '<!--@include appv.js-->' + NL + s.slice(appvClose, modOpen) + '<!--@include app/-->' + NL + s.slice(modClose);

/* The module, cut where a section heading starts a line. Short sections ride with the one before, so a file is
 * at least MIN lines; the cut is always at the start of a line, so joining the files gives the text back. */
const MIN = 350;
const heads = [];
const re = /^(?:\/\* ?={3,} *(.+?) *(?:={3,}|\*\/|$)|\/\* ?={3,}(.*)$)/gm;
for (const m of mod.matchAll(re)) heads.push({ i: m.index, title: (m[1] || m[2] || '').trim() });
const lineOf = i => mod.slice(0, i).split('\n').length;
const cuts = [{ i: 0, title: 'firebase setup' }];
for (const h of heads) {
  if (h.i === 0) continue;
  if (lineOf(h.i) - lineOf(cuts[cuts.length - 1].i) >= MIN) cuts.push(h);
}
const slug = t => (String(t).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'part');
fs.mkdirSync(path.join(SRC, 'app'), { recursive: true });
const names = [];
cuts.forEach((c, k) => {
  const end = k + 1 < cuts.length ? cuts[k + 1].i : mod.length;
  const name = String((k + 1) * 10).padStart(4, '0') + '-' + slug(c.title) + '.js';
  fs.writeFileSync(path.join(SRC, 'app', name), mod.slice(c.i, end));
  names.push(name + '  (' + (lineOf(end) - lineOf(c.i)) + ' lines)');
});
fs.writeFileSync(path.join(SRC, 'index.html'), shell);
fs.writeFileSync(path.join(SRC, 'styles.css'), css);
fs.writeFileSync(path.join(SRC, 'appv.js'), appv);
console.log(names.length + ' module files:\n  ' + names.join('\n  '));
