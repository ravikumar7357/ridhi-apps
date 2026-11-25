/* TEETH for tests/cutting-desk-test.js: break the Cutting Desk code on purpose and the suite must fail every time.
 *   node tests/teeth/teeth-cutting-desk.js */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const FILE = path.join(__dirname, '..', '..', 'src', 'app', 'flow', 'flow-cutting-desk.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const breaks = {
  'the desk is on for everybody': s => s.replace('return CDK_DEFAULT || testLink || branchLink;', 'return true;'),
  'a branch test link does not show the desk': s => s.replace('return CDK_DEFAULT || testLink || branchLink;', 'return CDK_DEFAULT || testLink;'),
  'turning it off on one computer is ignored': s => s.replace("if (v === '0') return false; }", '}'),
  'left to cut forgets what is cut': s => s.replace("const cdkLeft = x => Math.max(0, (+x.r.qty || 0) - cdkCut(x));", 'const cdkLeft = x => Math.max(0, +x.r.qty || 0);'),
  'left to cut goes below nought': s => s.replace("const cdkLeft = x => Math.max(0, (+x.r.qty || 0) - cdkCut(x));", 'const cdkLeft = x => (+x.r.qty || 0) - cdkCut(x);'),
  'a part-cut line counts as not started': s => s.replace("const cdkStage = x => (cdkCut(x) > 0 ? 'part' : 'none');", "const cdkStage = x => 'none';"),
  'the quick filter keeps every line': s => s.replace('const cdkFilter = (rows, pick) => (pick ? rows.filter(x => cdkStage(x) === pick) : rows);', 'const cdkFilter = (rows, pick) => rows;'),
  'a page past the end shows nothing': s => s.replace('at = Math.min(Math.max(0, page | 0), pages - 1);', 'at = Math.max(0, page | 0);'),
  'the SKU is put into the page as code': s => s.replace('<b style="font-family:ui-monospace,monospace">${esc(x.r.sku)}</b>', '<b style="font-family:ui-monospace,monospace">${x.r.sku}</b>'),
  'the fabric is left off the item': s => s.replace("[cdkArticle(x), x.r.size].filter(Boolean).join(' · '), cdkFabric(x)]", "[cdkArticle(x), x.r.size].filter(Boolean).join(' · ')]"),
  'a quick filter stays on its old page': s => s.replace('CDK.pick = pick.dataset.cdkpick; CDK.page = 0;', 'CDK.pick = pick.dataset.cdkpick;'),
  'an account without the right gets the card': s => s.replace("if (!flowMay('pcut')) {", 'if (false) {'),
  'the entry is saved against no order': s => s.replace('cwOrd: r.orderNo,', "cwOrd: '',"),
  'a blank cloth box saves no metres': s => s.replace("(per ? String(Math.round(per * pcs * 100) / 100) : '')", "''"),
  'cloth typed by hand is worked out again': s => s.replace("typed !== '' ? typed : ", ''),
  'the waste is dropped': s => s.replace("cwWaste: String(v.waste == null ? '' : v.waste).trim(),", "cwWaste: '',"),
  'any fabric passes as the line\'s own': s => s.replace('CUT_OWN_OK = own;', 'CUT_OWN_OK = fabric;'),
  'the fabric allowance is left on after a save': s => s.replace("    CUT_OWN_OK = '';\n    $('cwSku').value = before", "    $('cwSku').value = before"),
  'a half-typed form is not put back': s => s.replace("    before.forEach(([id, was]) => { $(id).value = was; });\n", ''),
  'the refusal is left on the form': s => s.replace("if (err) cutFormMsg(''); else flowEmbedRefresh();", 'if (!err) flowEmbedRefresh();'),
  'the plan\'s own spelling of the fabric is saved': s => s.replace('return inMaster || name;', 'return name;'),
  'a refusal closes the card as if saved': s => s.replace("  return err;\n}\n", "  return '';\n}\n"),
  'the list is not read again after a save': s => s.replace("if (err) cutFormMsg(''); else flowEmbedRefresh();", "if (err) cutFormMsg('');"),
  'Cut by can be typed over': s => s.replace("{ key: 'cutBy', label: 'Cut by', value: cdkCutBy(), readonly: true }", "{ key: 'cutBy', label: 'Cut by', value: cdkCutBy() }"),
  'Cut by shows the whole email': s => s.replace('const cdkCutBy = () => whoShort(ME.email);', 'const cdkCutBy = () => ME.email;'),
  'Cut by is left off the card': s => s.replace("      { key: 'cutBy', label: 'Cut by', value: cdkCutBy(), readonly: true },\n", ''),
  'the page does not open on To cut': s => s.replace("if (!FLOW_EMB.pcut) { FLOW_EMB.pcut = 'cut'; flowEmbedRender('pcut'); }", ''),
  'the page is sent back to To cut every time it opens': s => s.replace('  CDK.opened = true;\n', ''),
  'the page opens on To cut with the desk off': s => s.replace("if (CDK.opened || !cdkSwitchOn() || !flowEmbedViews('pcut').includes('cut')) return;", "if (CDK.opened || !flowEmbedViews('pcut').includes('cut')) return;"),
  'somebody without the right is sent to To cut': s => s.replace("if (CDK.opened || !cdkSwitchOn() || !flowEmbedViews('pcut').includes('cut')) return;", 'if (CDK.opened || !cdkSwitchOn()) return;'),
  'no pieces reaches the form': s => s.replace("if (!(pcs > 0)) return 'Type how many pieces were cut.';", ''),
  'earlier entries of other orders are listed': s => s.replace('obUC(c.orderNo) === obUC(r.orderNo) && ', ''),
};
let bad = 0;
for (const [name, f] of Object.entries(breaks)) {
  const t = f(src);
  if (t === src) { console.log('  COULD NOT BREAK IT (anchor missing): ' + name); bad++; continue; }
  const tmp = path.join(require('os').tmpdir(), 'teeth-cutting-desk.js');
  fs.writeFileSync(tmp, t);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'cutting-desk-test.js')], { env: Object.assign({}, process.env, { CDK_SRC: tmp }), encoding: 'utf8' });
  const caught = r.status !== 0;
  console.log((caught ? '  BITES  ' : '  MISSED ') + name + (caught ? '' : ' — the suite still passed'));
  if (!caught) bad++;
}
console.log(bad ? `\n${bad} break(s) not caught` : '\nevery break was caught');
process.exit(bad ? 1 : 0);
