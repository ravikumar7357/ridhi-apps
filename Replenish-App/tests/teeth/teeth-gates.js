const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);
const breaks = [
  ['recording an accessory movement asks for the grant',
   'const accCanEntry = () => !spIsVendor() && !!(ME.admin || ME.accEdit || ME.accEntry);',
   'const accCanEntry = () => true;'],
  ['…and editing asks for the stronger one',
   'const accCanEdit = () => !spIsVendor() && !!(ME.admin || ME.accEdit);',
   'const accCanEdit = () => accCanEntry();'],
  ['…and the editing grant carries recording with it',
   'ME.admin || ME.accEdit || ME.accEntry',
   'ME.admin || ME.accEntry'],
  ['a vendor is kept out of the store',
   'const accCanEntry = () => !spIsVendor() &&',
   'const accCanEntry = () => !false &&'],
  ['the bulk upload asks before it writes',
   '  if (!accCanEdit()) throw new Error(ACC_NO_EDIT);',
   '  if (false) throw new Error(ACC_NO_EDIT);'],
  ['accepting a delivery asks for its own grant',
   'const vlCanAccept = () => vlogCanAccept();',
   "const vlCanAccept = () => !!(ME.admin || (ME.tabs || []).indexOf('vlog') >= 0);"],
  ['…and the accept write asks it',
   '  if (!vlCanAccept()) return VLOG_NO_ACCEPT;' + NL + '  if (!rows.length) return \'\';',
   "  if (false) return VLOG_NO_ACCEPT;" + NL + "  if (!rows.length) return '';"],
  ['approving a sales order asks for the grant',
   '  if (!soCanApprove()) return SO_NO_APPROVE;' + NL + "  const o = (SOX.rows || []).find(x => x._id === id); if (!o) return 'That order is gone.';"
     + NL + "  const mode = $('sor_mode').value;",
   "  const o = (SOX.rows || []).find(x => x._id === id); if (!o) return 'That order is gone.';"
     + NL + "  const mode = $('sor_mode').value;"],
  ['…and so does sending one back',
   '  if (!soCanApprove()) return SO_NO_APPROVE;' + NL + "  const o = (SOX.rows || []).find(x => x._id === id); if (!o) return 'That order is gone.';"
     + NL + "  const remarks = String($('sor_remarks').value || '').trim();",
   "  const o = (SOX.rows || []).find(x => x._id === id); if (!o) return 'That order is gone.';"
     + NL + "  const remarks = String($('sor_remarks').value || '').trim();"],
  ['Change SKU asks for the master-database grant',
   '  if (!mdbCanEdit()) return MDB_NO_EDIT;',
   '  if (false) return MDB_NO_EDIT;'],
  ['editing a QC check asks the production grant',
   "  if (!ptCanEdit()) { $('qcMsg').className = 'err'; $('qcMsg').textContent = PT_NO_EDIT; return; }" + NL
     + "  const r = (QC.checks || []).find(x => x.id === id); if (!r) return;",
   '  const r = (QC.checks || []).find(x => x.id === id); if (!r) return;'],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing: ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false;
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-180)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
