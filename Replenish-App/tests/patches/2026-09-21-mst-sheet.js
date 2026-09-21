/* Masters by spreadsheet: buttons, visibility, and the code. See 2026-09-21-mst-sheet-code.js. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};
const code = fs.readFileSync(__dirname + '/2026-09-21-mst-sheet-code.js', 'utf8').split(CR + LF).join(LF);

one(`          <button id="mstExport" class="ghost">Export</button>`,
`          <button id="mstTpl" class="ghost hide" title="The list as it stands, as a sheet to fill in Excel.">Excel template</button>
          <button id="mstImp" class="ghost hide" title="Read a filled sheet back. You see what it would change before anything is written.">Excel import</button>
          <input id="mstFile" type="file" accept=".xlsx,.csv,text/csv" style="display:none">
          <button id="mstExport" class="ghost">Export</button>`, 'buttons');

one(`  if (!$('mstPick').value) $('mstPick').value = cur;
  /* The ruffle rules are a different shape of list, and draw themselves. */`,
`  if (!$('mstPick').value) $('mstPick').value = cur;
  /* The sheet is for code-and-name lists, and changes them, so it is for an admin. */
  ['mstTpl', 'mstImp'].forEach(id => { const el = $(id); if (el) el.classList.toggle('hide', !ME.admin || MST_SHEET_OFF.indexOf(cur) >= 0); });
  /* The ruffle rules are a different shape of list, and draw themselves. */`, 'visibility');

one(`$('mstExport').onclick = () => {`, code + `
$('mstExport').onclick = () => {`, 'the code');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
