/* TEETH for tests/cutting-data-look-test.js: break the Cutting Data look on purpose and the suite must fail every time.
 *   node tests/teeth/teeth-cutting-data-look.js */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const FILE = path.join(__dirname, '..', '..', 'src', 'app', 'vendors', 'printing', 'cutting-data-look.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const breaks = {
  'the look is on for everybody': s => s.replace("try { return typeof cdkSwitchOn === 'function' && cdkSwitchOn(); }", 'try { return true; }'),
  'a switch that cannot be read breaks the page': s => s.replace("  catch (e) { console.warn('Cutting Data: the Cutting Desk switch could not be read, so the old list is shown.', e); return false; }", '  finally { }'),
  'pieces are not added up': s => s.replace('    t.pieces += ptNum(r.pieces);\n', ''),
  'still to issue goes below nought': s => s.replace('t.left = (t.left || 0) + Math.max(0, u.net - u.used);', 't.left = (t.left || 0) + (u.net - u.used) * 2;'),
  'unknown issue figures show as nought': s => s.replace('issued: null, left: null,', 'issued: 0, left: 0,'),
  'waste of unmeasured entries is counted': s => s.replace("if (ptNum(r.fabricUsed) > 0) { t.measured++; t.used += ptNum(r.fabricUsed); t.waste += ptNum(r.fabricWaste); }", 't.waste += ptNum(r.fabricWaste); if (ptNum(r.fabricUsed) > 0) { t.measured++; t.used += ptNum(r.fabricUsed); }'),
  'the waste share is of pieces, not cloth': s => s.replace('t.pct = t.used > 0 ? (t.waste / t.used) * 100 : 0;', 't.pct = t.pieces > 0 ? (t.waste / t.pieces) * 100 : 0;'),
  'the use buttons count nothing': s => s.replace('rows.forEach(r => { const k = kindOf(r); if (k) n[k]++; });', ''),
  'counts are shown before the register is read': s => s.replace('  if (!kindOf) return null;\n', "  if (!kindOf) kindOf = () => '';\n"),
  'a page past the end shows nothing': s => s.replace('at = Math.min(Math.max(0, page | 0), pages - 1);', 'at = Math.max(0, page | 0);'),
  'a page holds 300': s => s.replace('const PCD_PAGE = 50;', 'const PCD_PAGE = 300;'),
  'the SKU is put into the page as code': s => s.replace('<b style="font-family:ui-monospace,monospace">${esc(r.sku)}</b>', '<b style="font-family:ui-monospace,monospace">${r.sku}</b>'),
  'the remarks are put into the page as code': s => s.replace('<div style="font-size:12px;font-style:italic">${esc(r.remarks)}</div>', '<div style="font-size:12px;font-style:italic">${r.remarks}</div>'),
  'the colour is left off the item': s => s.replace('[r.articleSubtype || r.articleType, r.color, r.size]', '[r.articleSubtype || r.articleType, r.size]'),
  'the fabric is left off the item': s => s.replace(".join(' · '), r.fabricWidth].filter(Boolean);", ".join(' · ')].filter(Boolean);"),
  'an unmeasured entry shows as nought': s => s.replace("if (!(used > 0) && !(waste > 0)) return '<span class=\"muted\">not measured</span>';", ''),
  'high waste is not in red': s => s.replace("${share > 0.1 ? ';color:var(--bad)' : ''}", ''),
  'the waste width is dropped': s => s.replace("wide > 0 ? nf(wide) + '\"' : '', ", ''),
  'Edit is offered to everybody': s => s.replace('<td>${mayEdit ? `<button', '<td>${true ? `<button'),
  'Edit names no entry': s => s.replace('data-cut-edit="${esc(r.id)}"', 'data-cut-edit=""'),
  'the time is shown with the date': s => s.replace("esc(String(r.cutDate || '').split(',')[0])", "esc(String(r.cutDate || ''))"),
  'a changed filter stays on its old page': s => s.replace('if (picked !== PCD.picked) { PCD.picked = picked; PCD.page = 0; }', 'PCD.picked = picked;'),
  'the same filters go back to page one': s => s.replace('if (picked !== PCD.picked) { PCD.picked = picked; PCD.page = 0; }', 'PCD.page = 0;'),
  'a pick-list of the Filters button is hidden': s => s.replace("  $('pcUse').style.display = 'none';", "  $('pcUse').style.display = 'none'; $('pcArt').style.display = 'none';"),
  'the old Used-or-not list is left in view': s => s.replace("  $('pcUse').style.display = 'none';", ''),
  'the page bar shows under the Cutting Desk': s => s.replace("  $('pcdPager').classList.toggle('fl-embhide', $('pcTable').parentElement.classList.contains('fl-embhide'));\n", ''),
  'a use button does not set the pick': s => s.replace("$('pcUse').value = b.dataset.pcduse; renderPcut();", 'renderPcut();'),
  'Next does not move': s => s.replace('PCD.page += +b.dataset.pcdpage; renderPcut();', 'renderPcut();'),
  'the count line counts the page, not the list': s => s.replace("`${nf(rows.length)} of ${nf(total)} cut entr", "`${nf(pg.rows.length)} of ${nf(total)} cut entr"),
};
let bad = 0;
for (const [name, f] of Object.entries(breaks)) {
  const t = f(src);
  if (t === src) { console.log('  COULD NOT BREAK IT (anchor missing): ' + name); bad++; continue; }
  const tmp = path.join(require('os').tmpdir(), 'teeth-cutting-data-look.js');
  fs.writeFileSync(tmp, t);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'cutting-data-look-test.js')], { env: Object.assign({}, process.env, { PCD_SRC: tmp }), encoding: 'utf8' });
  const caught = r.status !== 0;
  console.log((caught ? '  BITES  ' : '  MISSED ') + name + (caught ? '' : ' — the suite still passed'));
  if (!caught) bad++;
}
console.log(bad ? `\n${bad} break(s) not caught` : '\nevery break was caught');
process.exit(bad ? 1 : 0);
