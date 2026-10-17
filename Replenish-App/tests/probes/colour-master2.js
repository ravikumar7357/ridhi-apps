const fs = require('fs');
const m = JSON.parse(fs.readFileSync(process.env.TEMP + '/pt_masters.json', 'utf8'));
const list = o => (Array.isArray(o) ? o.map((v, i) => (v && typeof v === 'object' ? Object.assign({ _key: String(i) }, v) : v))
  : Object.keys(o || {}).map(k => (o[k] && typeof o[k] === 'object' ? Object.assign({ _key: k }, o[k]) : { _key: k, value: o[k] }))).filter(Boolean);

const cols = list(m.colour).map(r => ({ code: r.code, desc: r.desc, active: r.active !== false }));
console.log('colour master:', cols.length, '| active:', cols.filter(c => c.active).length);
fs.writeFileSync(process.env.TEMP + '/colour-master.json', JSON.stringify(cols));
console.log(cols.map(c => c.desc).sort().join(' | '));

console.log('\n== fabricType codes');
list(m.fabricType).forEach(r => console.log('  ' + String(r.code).padEnd(22) + String(r.desc || '').padEnd(22) + 'width ' + (r.widthIn || '?')));

console.log('\n== pt_masters/skuCode — shape');
const sk = list(m.skuCode);
console.log('rows:', sk.length);
console.log(JSON.stringify(sk.slice(0, 5), null, 1).slice(0, 900));

console.log('\n== greigeRfd rows');
list(m.greigeRfd).forEach(r => console.log('  ' + JSON.stringify(r).slice(0, 190)));
