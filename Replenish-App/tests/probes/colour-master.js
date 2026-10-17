/* The canonical colour/print list and the fabric masters, for matching Ravi's store-opening sheet. */
const fs = require('fs');
const m = JSON.parse(fs.readFileSync(process.env.TEMP + '/pt_masters.json', 'utf8'));
const list = o => (Array.isArray(o) ? o.map((v, i) => (v && typeof v === 'object' ? Object.assign({ _key: String(i) }, v) : v))
  : Object.keys(o || {}).map(k => (o[k] && typeof o[k] === 'object' ? Object.assign({ _key: k }, o[k]) : { _key: k, value: o[k] }))).filter(Boolean);

['colour', 'fabricType', 'greigeRfd'].forEach(k => {
  const rows = list(m[k]);
  console.log('== pt_masters/' + k + ' — ' + rows.length + ' rows');
  console.log(JSON.stringify(rows.slice(0, 3), null, 1).slice(0, 700));
  console.log('');
});

console.log('== all fabricSku rows');
list(m.fabricSku).forEach(r => console.log('  ' + String(r.sku || r._key).padEnd(8) + String(r.fabric || '').padEnd(12)
  + String(r.colour || '').padEnd(22) + 'code ' + String(r.code || '').padEnd(6) + (r.brand || '')));

const cols = list(m.colour).map(r => r.name || r.colour || r.value || r._key).filter(Boolean);
console.log('');
console.log('== colour master names (' + cols.length + ')');
console.log(cols.sort().join(' | '));
fs.writeFileSync(process.env.TEMP + '/colour-master.json', JSON.stringify(cols));
