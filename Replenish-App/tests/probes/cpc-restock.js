/* The four CPC lines Ravi is extending: what is already selling and has run out.
 * Same columns as the launch sheet, so both can be worked from one format.
 * Read-only. node cpc-restock.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
const OUT = 'C:/AMAZON/Amazon Inventory/Pricing-App/tests/image-audit/cpc-restock.csv';

const LINES = {
  CPCFP: { label: 'Embroidery placemat', article: 'Placemat', size: '15x15', pcs: 4 },
  CPCN: { label: 'Plain napkin', article: 'Napkin', size: '18x18 ( Pack of 4 )', pcs: 4 },
  CPCNE: { label: 'Embroidery napkin', article: 'Embroidery Napkins', size: '18x18"(Pack of 4)', pcs: 4 },
  CPCRP: { label: 'Reversible placemat', article: 'Placemat', size: '14\'\' x 20" (Set of 4)', pcs: 4 },
};

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []);
  const at = tok.access_token || tok;
  const req = u => new Promise((res, rej) => {
    https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 300000 }, x => {
      let d = ''; x.on('data', c => d += c);
      x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } });
    }).on('error', rej);
  });
  const dec = v => v == null ? null
    : 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue)
    : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue
    : 'timestampValue' in v ? v.timestampValue : 'nullValue' in v ? null
    : 'arrayValue' in v ? (v.arrayValue.values || []).map(dec)
    : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, w]) => [k, dec(w)])) : null;

  const head = await req(FS + 'health/CPC');
  const stockAt = dec(head.fields.at);
  let rows = [];
  for (let i = 0; i < (dec(head.fields.chunks) || 0); i++) {
    const c = await req(FS + 'healthrows/CPC_' + i);
    if (c.fields) rows = rows.concat(dec(c.fields.r) || []);
  }
  const qty = new Map(rows.map(r => [r.s, r.q]));

  const cat = JSON.parse(fs.readFileSync(process.env.TEMP + '/cpc-catalog.json', 'utf8'));
  const sales = JSON.parse(fs.readFileSync(process.env.TEMP + '/cpc-sales.json', 'utf8'));
  const base = new Date(); base.setDate(1);
  const last3 = [];
  for (let i = 1; i <= 3; i++) { const d = new Date(base); d.setMonth(d.getMonth() - i); last3.push(d.toISOString().slice(0, 7)); }
  const rateOf = sku => { let u = 0; Object.entries(sales[sku] || {}).forEach(([k, v]) => { if (last3.includes(k)) u += v[0]; }); return u / 3; };

  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const out = [['Line', 'SKU', 'Article', 'Colour / print', 'Size', 'Qty suggested (sets)', 'Pieces',
    'Stock now', 'Selling per month', 'Months of cover', 'Priority'].join(',')];
  const all = [];

  Object.entries(LINES).forEach(([pre, L]) => {
    const re = new RegExp('^' + pre + '[0-9]');
    Object.keys(cat).filter(s => re.test(s)).forEach(sku => {
      const stock = qty.has(sku) ? qty.get(sku) : null;
      const rate = rateOf(sku);
      if (rate <= 0) return;                       // not selling: a restock would just be stock
      const cover = stock == null ? 0 : stock / rate;
      if (cover >= 2) return;                      // two months is enough to make at leisure
      /* Bring it to three months of cover, in 25s. Nothing smaller than 50 sets is worth a run. */
      const need = Math.max(50, Math.round((rate * 3 - (stock || 0)) / 25) * 25);
      all.push({ L, sku, colour: cat[sku].color || '', stock: stock == null ? 'n/a' : stock, rate, cover, need });
    });
  });
  all.sort((a, b) => b.rate - a.rate);
  all.forEach(r => out.push([r.L.label, r.sku, r.L.article, r.colour, r.L.size, r.need, r.need * r.L.pcs,
    r.stock, r.rate.toFixed(1), r.cover.toFixed(1), r.cover === 0 ? 'OUT OF STOCK' : 'under 2 months'].map(q).join(',')));
  fs.writeFileSync(OUT, out.join('\r\n'));

  const lost = all.reduce((s, r) => s + r.rate, 0);
  console.log('stock snapshot', stockAt);
  console.log('SKUs selling with under 2 months of cover:', all.length);
  console.log('their combined rate:', lost.toFixed(0), 'sets a month');
  console.log('sets to make to put all of them on 3 months:', all.reduce((s, r) => s + r.need, 0),
    '(' + all.reduce((s, r) => s + r.need * r.L.pcs, 0) + ' pieces)');
  console.log('');
  console.log('   SKU          Line                 Print               stock   /mo   cover   make');
  all.slice(0, 18).forEach(r => console.log('   ' + r.sku.padEnd(13) + r.L.label.padEnd(21) + r.colour.padEnd(20)
    + String(r.stock).padStart(5) + String(r.rate.toFixed(1)).padStart(7) + String(r.cover.toFixed(1)).padStart(7) + String(r.need).padStart(7)));
})().catch(e => { console.error(e.message); process.exit(1); });
