/* Joins the catalog writers' work into the bank (26 Oct):
 *   - their new workflow answers → wf-<group>.js area files (one wrong one dropped: the Vendor Portal is view only);
 *   - the Vendor Portal's retired entry parts → "not shown now" (FLOW_ON is on everywhere: every order is view only);
 *   - every part line → parts.js (tools/parts-to-bank.js).
 *   node tools/join-catalog.js <catalog folder> */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const CAT = process.argv[2], BANK = path.join(__dirname, '..');
const DROP = new Set(['wf-masters-vp-send']);   // describes Acknowledge / Record what I am sending — retired on 15 Oct

for (const g of ['orders', 'shopify', 'production', 'flow', 'inventory', 'planning', 'masters']) {
  const list = require(path.join(CAT, `done-${g}-workflows.js`)).filter(e => !DROP.has(e.id));
  fs.writeFileSync(path.join(BANK, `wf-${g}.js`), 'module.exports = ' + JSON.stringify(list, null, 1) + ';\n');
  console.log(`wf-${g}.js: ${list.length}`);
}

/* the Vendor Portal parts that only work when a printer may enter things (the old way, before 15 Oct) */
const parts = require(path.join(CAT, 'parts.json'));
const f = path.join(CAT, 'done-masters-parts.json'), lines = JSON.parse(fs.readFileSync(f, 'utf8'));
const RETIRED = /acknowledge|start production|record what i am sending|i am sending|delivery date|rfd fabric i need|ask for (now|the whole)|still to ask for|raise requirement|already have for this order|sends every row where you typed/i;
const NOW = {
  en: 'Not shown now: since 15 Oct the Vendor Portal is view only for every order — the office records what was given and what came back (RFD challans in PPC · Production flow).',
  hi: 'अब नहीं दिखता: 15 अक्टूबर से Vendor Portal हर ऑर्डर के लिए सिर्फ़ देखने के लिए है — क्या दिया और क्या आया, यह ऑफ़िस दर्ज करता है (PPC · Production flow में RFD challan)।',
  hg: 'Ab nahi dikhta: 15 Oct se Vendor Portal har order ke liye sirf dekhne ke liye hai — kya diya aur kya aaya, ye office darj karta hai (PPC · Production flow mein RFD challan).',
};
let n = 0;
for (const x of lines) {
  const p = parts[+x.key.slice(1)];
  if (p && p.tab === 'vend' && RETIRED.test(p.label) && !x.skip) { Object.assign(x, NOW); n++; }
}
fs.writeFileSync(f, JSON.stringify(lines, null, 1));
console.log('Vendor Portal parts marked "not shown now":', n);
console.log(execFileSync(process.execPath, [path.join(__dirname, 'parts-to-bank.js'), CAT], { encoding: 'utf8' }).trim());
