/* THE BLOCK-PRINTING LOADING PICTURE (Ravi, 26 Nov 2026: "whenever the data is loading when refreshed").
 * A table still reading shows the picture with its words; a finished or empty table keeps plain words; the browser
 * refresh cover and the Refresh-button cover both carry the picture; the picture file is there and runs no script.
 * The functions are cut out of src/, so the test checks the real code, not a copy of it.
 *   node tests/loading-print-test.js
 * Teeth: each part undone in a copy of the code must make the suite fail. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const ORIGINAL = {
  dbr: rd('src/app/core/database-read.js'), page: rd('src/index.html'), css: rd('src/styles.css'),
  art: rd('public/loading-print.svg'),
};

const cut = (src, name) => {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' not found');
  return src.slice(i, src.indexOf('\n}', i) + 2);
};

function suite(S, loud) {
  const fails = [];
  let pass = 0;
  const ok = (name, cond) => { if (cond) { pass++; if (loud) console.log('  PASS ' + name); } else { fails.push(name); if (loud) console.log('  FAIL ' + name); } };

  /* ---- a table's message ---- */
  const cells = {};
  const $ = id => (cells[id] = cells[id] || { innerHTML: '' });
  const artPath = (S.dbr.match(/const PT_LOADING_ART = '([^']+)'/) || [])[1];
  const code = cut(S.dbr, 'ptLoadingArt') + '\n' + cut(S.dbr, 'ptEmpty') + '\nreturn { ptEmpty };';
  const { ptEmpty } = new Function('$', 'PT_LOADING_ART', code)($, artPath);
  ptEmpty('t1', 'Loading…');
  ok('a table that is still loading shows the block printing', cells.t1.innerHTML.includes('<img src="/loading-print.svg"'));
  ok('…with its words beside it, so it still says what is happening', cells.t1.innerHTML.includes('Loading…'));
  ptEmpty('t2', 'Reading the stock…');
  ok('any "…" message counts as still reading', cells.t2.innerHTML.includes('loading-print.svg'));
  ptEmpty('t3', 'Nothing to show.');
  ok('an empty table keeps plain words, no picture', !cells.t3.innerHTML.includes('<img') && cells.t3.innerHTML.includes('Nothing to show.'));

  /* ---- the two covers ---- */
  const gate = (S.page.match(/<div id="gateWait">[\s\S]*?Checking your access…/) || [''])[0];
  ok('a browser refresh shows the block printing while access is checked', gate.includes('src="/loading-print.svg"'));
  ok('the Refresh cover carries the picture too', /<div id="ptBusyCover"[^>]*>[\s\S]*?src="\/loading-print\.svg"[\s\S]*?Refreshing…/.test(S.page));
  ok('the Refresh cover shows only while busy', /#ptBusyCover\{[^}]*display:none/.test(S.css) && /body\.ptBusy #ptBusyCover\{display:flex\}/.test(S.css));
  ok('the cover takes no clicks', /#ptBusyCover\{[^}]*pointer-events:none/.test(S.css));

  /* ---- the picture file ---- */
  ok('the picture is there and is an SVG', S.art.startsWith('<svg') && S.art.trim().endsWith('</svg>'));
  ok('the picture runs no script', !/<script/i.test(S.art));
  ok('the picture moves by itself, over and over', /animation: stamp var\(--run\) ease-in-out infinite/.test(S.art));

  if (loud) console.log(`\n${pass} passed, ${fails.length} failed`);
  return fails;
}

if (suite(ORIGINAL, true).length) process.exit(1);
/* TEETH: each part undone must be caught. */
const breaks = [
  ['tables never show the picture', 'dbr', "words.endsWith('…') ? ptLoadingArt(words) : words", 'words'],
  ['every message shows the picture', 'dbr', "words.endsWith('…') ? ptLoadingArt(words) : words", 'ptLoadingArt(words)'],
  ['the picture loses its words', 'dbr', '<span>${words}</span>', ''],
  ['the refresh cover is plain words again', 'page', '<div id="gateWait"><div class="ptLoading"><img src="/loading-print.svg" alt="" width="154" height="157"><span>Checking your access…</span></div></div>', '<div id="gateWait">Checking your access…</div>'],
  ['the Refresh cover is always on', 'css', '#ptBusyCover{position:fixed;inset:0;display:none;', '#ptBusyCover{position:fixed;inset:0;display:flex;'],
  ['the cover swallows clicks', 'css', 'z-index:70;pointer-events:none}', 'z-index:70}'],
  ['the picture stops after one round', 'art', 'animation: stamp var(--run) ease-in-out infinite', 'animation: stamp var(--run) ease-in-out forwards'],
  ['a script sneaks into the picture', 'art', '</svg>', '<script>alert(1)</script></svg>'],
];
let missed = 0;
for (const [name, file, from, to] of breaks) {
  if (!ORIGINAL[file].includes(from)) { console.log('  COULD NOT BREAK IT (anchor missing): ' + name); missed++; continue; }
  const S = Object.assign({}, ORIGINAL, { [file]: ORIGINAL[file].replace(from, to) });
  let caught;
  try { caught = suite(S, false).length > 0; } catch (e) { caught = true; }
  console.log((caught ? '  BITES  ' : '  MISSED ') + name);
  if (!caught) missed++;
}
console.log(missed ? `\n${missed} break(s) not caught` : '\nevery break was caught');
process.exit(missed ? 1 : 0);
