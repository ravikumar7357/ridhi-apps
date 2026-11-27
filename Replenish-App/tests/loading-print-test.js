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
  screens: ['follow-ups', 'in-production', 'india-stock', 'revenue-target', 'top-asin', 'shopify-stock']
    .map(f => rd('src/app/replenishment/' + f + '.js')).join('\n'),
  art: rd('public/loading-print.svg'),
};

const cut = (src, name) => {
  let i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' not found');
  if (src.slice(i - 6, i) === 'async ') i -= 6;
  return src.slice(i, src.indexOf('\n}', i) + 2);
};

async function suite(S, loud) {
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

  /* ---- a screen's own message line (26 Nov: Shopify Stock showed plain "Loading…") ---- */
  const line = { innerHTML: '' };
  const lineCode = cut(S.dbr, 'ptLoadingArt') + '\n' + cut(S.dbr, 'ptLoadingLine') + '\nreturn { ptLoadingLine };';
  new Function('$', 'PT_LOADING_ART', lineCode)(() => line, artPath).ptLoadingLine('shMsg');
  ok('a screen\'s loading line shows the block printing with "Loading…"', line.innerHTML.includes('loading-print.svg') && line.innerHTML.includes('Loading…'));
  ok('Shopify Stock uses it', /ptLoadingLine\('shMsg'\)/.test(S.screens));
  ok('the five report screens load through ptLoadingWhile', (S.screens.match(/ptLoadingWhile\('(fuMsg|pdMsg|inMsg|tgMsg|topMsg)'/g) || []).length === 5);
  ok('…and none of them is left on plain "Loading…" words', !/(textContent = |shMsg\()'Loading…'/.test(S.screens));

  /* ---- a failed read must not leave the picture moving for good (review, 26 Nov) ---- */
  const whileCode = ['ptLoadingArt', 'ptLoadingLine', 'ptLoadingWhile'].map(n => cut(S.dbr, n)).join('\n') + '\nreturn { ptLoadingWhile };';
  const lines = {};
  const $line = id => (lines[id] = lines[id] || { innerHTML: '', set textContent(t) { this.innerHTML = t; } });
  const warns = [];
  const { ptLoadingWhile } = new Function('$', 'PT_LOADING_ART', 'console', whileCode)($line, artPath, { warn: (...a) => warns.push(a) });
  let during = '';
  const good = await ptLoadingWhile('pdMsg', async () => { during = lines.pdMsg.innerHTML; });
  ok('while a screen reads, its line shows the block printing', during.includes('loading-print.svg'));
  ok('a good read clears the line and lets the screen draw', good === true && lines.pdMsg.innerHTML === '');
  const bad = await ptLoadingWhile('tgMsg', async () => { throw new Error('read refused'); });
  ok('a failed read stops the picture and says what to do', bad === false && !lines.tgMsg.innerHTML.includes('<img') && /Could not read the data \(read refused\)\. Check the internet, then open this tab again\./.test(lines.tgMsg.innerHTML));
  ok('…the screen is not drawn from half its data', S.screens.includes('if (read) renderProd();') && (S.screens.match(/if \(!read\) return;/g) || []).length === 2);
  ok('…and the cause goes to the console', warns.length === 1 && String(warns[0][0]).includes('tgMsg'));

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

(async () => {
if ((await suite(ORIGINAL, true)).length) process.exit(1);
/* TEETH: each part undone must be caught. */
const breaks = [
  ['a failed read leaves the picture moving', 'dbr', "    $(msgId).textContent = 'Could not read the data (' + ((e && e.message) || e) + '). Check the internet, then open this tab again.';\n", ''],
  ['a failed read draws the screen anyway', 'dbr', '    return false;\n  }', '    return true;\n  }'],
  ['In Production draws from half its data', 'screens', 'if (read) renderProd();', 'renderProd();'],
  ['Shopify Stock goes back to plain words', 'screens', "ptLoadingLine('shMsg');", "shMsg('Loading…');"],
  ['a loading line shows no picture', 'dbr', "$(msgId).innerHTML = ptLoadingArt('Loading…');", "$(msgId).textContent = 'Loading…';"],
  ['tables never show the picture', 'dbr', "words.endsWith('…') ? ptLoadingArt(words) : words", 'words'],
  ['every message shows the picture', 'dbr', "words.endsWith('…') ? ptLoadingArt(words) : words", 'ptLoadingArt(words)'],
  ['the picture loses its words', 'dbr', '<span>${words}</span>', ''],
  ['the refresh cover is plain words again', 'page', '<div id="gateWait"><div class="ptLoading"><img src="/loading-print.svg" alt="" width="132" height="134"><span>Checking your access…</span></div></div>', '<div id="gateWait">Checking your access…</div>'],
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
  try { caught = (await suite(S, false)).length > 0; } catch (e) { caught = true; }
  console.log((caught ? '  BITES  ' : '  MISSED ') + name);
  if (!caught) missed++;
}
console.log(missed ? `\n${missed} break(s) not caught` : '\nevery break was caught');
process.exit(missed ? 1 : 0);
})();
