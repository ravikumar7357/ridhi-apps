/* Listings where Amazon's catalogue serves ANOTHER of our listings' pictures.
 * Reads the Image Manager snapshots written by Replenish-App/tests/probes/limg-snap.js. */
const fs = require('fs');
const SLOTS = ['MAIN','PT01','PT02','PT03','PT04','PT05','PT06','PT07','PT08'];
const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
const out = [['Brand','SKU','ASIN','Colour','Size','Status','Buyable','Slots differing','Amazon shows this SKU','its colour','Title'].join(',')];
for (const b of ['SP','CPC']) {
  const items = JSON.parse(fs.readFileSync(process.env.TEMP + '/imgsnap-' + b + '.json', 'utf8'));
  const own = new Map();
  items.forEach(x => SLOTS.forEach(s => { const u = (x.img||{})[s]; if (!u) return; if (!own.has(u)) own.set(u, []); own.get(u).push(x); }));
  items.filter(x => x.lvl !== 'parent').forEach(x => {
    const live = x.live||{}, img = x.img||{};
    if (!live.MAIN || !img.MAIN || live.MAIN === img.MAIN) return;
    const o = (own.get(live.MAIN)||[]).filter(k => k.sku !== x.sku);
    if (!o.length) return;
    const pick = o.find(k => x.psku && k.psku === x.psku) || o[0];
    const nd = SLOTS.filter(s => live[s] && img[s] && live[s] !== img[s]).length;
    out.push([b === 'SP' ? 'Ridhi' : 'CPC', x.sku, x.asin, x.c||'', x.z||'', x.st||'',
      /BUYABLE/.test(x.st||'') ? 'YES' : 'no', nd, pick.sku, pick.c||'', String(x.t||'').slice(0,120)].map(q).join(','));
  });
}
fs.writeFileSync('wrong-images.csv', out.join('\r\n'));
console.log('rows', out.length - 1);
