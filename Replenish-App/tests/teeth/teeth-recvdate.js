/* Break the receiving-date rule on purpose; the tests must notice. */
const fs = require('fs');
const { execSync } = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const TEST = require('path').join(__dirname, '..', 'prod-test.js');
const good = fs.readFileSync(P);

const breaks = [
  ['receiving again re-stamps the date, as it used to',
    'next.receivingDate = row.receivingDate || ptNow(); }\n  return { row: next };',
    'next.receivingDate = ptNow(); }\n  return { row: next };'],
  ['the Order Console receive overwrites the date it finds',
    '    if (res.row.frozen && !row.receivingDate) res.row.receivingDate = ptStampDate(d);',
    '    if (res.row.frozen) res.row.receivingDate = ptStampDate(d);'],
  ['anybody may move the date from the dialog',
    "  if (admin) {\n    if ($('bdmIssueDate').value) next.issueDate = ptStampFrom(r.issueDate, $('bdmIssueDate').value);",
    "  if (true) {\n    if ($('bdmIssueDate').value) next.issueDate = ptStampFrom(r.issueDate, $('bdmIssueDate').value);"],
  ['the date is hidden from everybody who cannot change it',
    "  $('bdmDatesRead').classList.toggle('hide', admin);",
    "  $('bdmDatesRead').classList.toggle('hide', true);"],
];

let allBit = true;
for (const [what, from, to] of breaks) {
  let s = good.toString('utf8').replace(/\r\n/g, '\n');
  if (s.split(from).length !== 2) { console.log('SKIP (anchor) ' + what); allBit = false; continue; }
  fs.writeFileSync(P, s.replace(from, () => to).replace(/\n/g, '\r\n'));
  let out = '';
  try { out = execSync('node "' + TEST + '"', { encoding: 'utf8', maxBuffer: 1 << 28 }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? Number(m[2]) > 1 : false;
  if (!bit) allBit = false;
  console.log((bit ? 'BIT  ' : 'MISS ') + what + '  (' + (m ? m[0] : 'no summary') + ')');
  out.split('\n').filter(l => /FAIL/.test(l) && !/Ready Goods/.test(l)).slice(0, 3).forEach(l => console.log('      ' + l.trim()));
}
fs.writeFileSync(P, good);
console.log(allBit ? '\nall bit — the file is back as it was' : '\nSOMETHING DID NOT BITE');
