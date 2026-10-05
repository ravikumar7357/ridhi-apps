/* Shopify's own word on every SHP line in the order book (read-only): open lines Shopify has already closed, and lines
 * closed by a DONE/READY note that Shopify still has to ship. Both stores, from the oldest SHP order.
 *   node probes/shp-truth.js <console.json from pending-vs-console.js> <out.json> */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (u, auth) => new Promise((res, rej) => https.get(u, { headers: auth === false ? {} : { Authorization: 'Bearer ' + at }, timeout: 300000 }, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return req(r.headers.location, false).then(res, rej);
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 160))); } }); }).on('error', rej));
  const api = await req(FS + 'config/api'); const url = api.fields.url.stringValue, key = api.fields.key.stringValue;
  const lines = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const day = d => d.toISOString().slice(0, 10);
  const first = lines.map(l => String(l.orderDate || '').slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()[0] || '2026-07-01';
  const U = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
  const orders = new Map(); const more = [];
  for (const shop of ['', 'CPC']) {
    let s = new Date(first + 'T00:00:00Z'); s.setUTCDate(s.getUTCDate() - 3);
    const end = new Date(Date.now() + 864e5);
    while (s < end) {
      const e = new Date(s); e.setUTCDate(e.getUTCDate() + 7);
      const q = url + '?key=' + encodeURIComponent(key) + '&shopify=orders' + (shop ? '&shop=' + shop : '') + '&start=' + day(s) + '&end=' + day(e) + '&open=0';
      const r = await req(q, false);
      if (!r.ok) throw new Error((shop || 'Ridhi') + ' ' + day(s) + ': ' + r.error);
      if (r.more) more.push((shop || 'Ridhi') + ' ' + day(s));
      (r.orders || []).forEach(o => orders.set((shop || 'R') + '|' + U(o.no), o));
      s = e;
    }
  }
  const live = i => { const q = Number(i.qty) || 0; let v = Math.max(0, q - (Number(i.rq) || 0)); if (i.cq != null) v = Math.min(v, Math.max(0, Number(i.cq) || 0));
    const shipped = /^(ful|partial)/i.test(String(i.ffl || '')); if (i.fq === 0 && !shipped) v = 0; return v; };
  const out = lines.map(l => {
    const store = /^CPC/.test(l.sku) ? 'CPC' : 'R';
    const o = orders.get(store + '|' + U(l.shop)) || orders.get((store === 'CPC' ? 'R' : 'CPC') + '|' + U(l.shop));
    let truth = 'not found';
    let it = null;
    if (o) {
      it = (o.items || []).find(i => U(i.sku) === U(l.sku));
      if (o.cancelledAt) truth = 'cancelled';
      else if (it && /^ful/i.test(String(it.ffl || ''))) truth = 'fulfilled';
      else if (it && (Number(it.qty) || 0) > 0 && live(it) === 0) truth = 'refunded';
      else if (/^ful/i.test(String(o.ff || ''))) truth = 'fulfilled';
      else if (!it) truth = 'sku not on order';
      else truth = 'to ship';
    }
    return Object.assign({}, l, { truth, ff: o ? o.ff || '' : '', note: o ? String(o.note || '').slice(0, 80) : '', tags: o ? String(o.tags || '').slice(0, 80) : '',
      liveQty: it ? live(it) : null, shopStore: o ? (orders.get('R|' + U(l.shop)) === o ? 'Ridhi' : 'CPC') : '' });
  });
  fs.writeFileSync(process.argv[3], JSON.stringify(out));
  const c = {}; out.forEach(x => { const k = (x.open ? 'open' : x.handedAt ? 'handed' : x.shopDoneAt ? 'done:' + x.shopDoneWhy : 'made') + ' → ' + x.truth; c[k] = (c[k] || 0) + 1; });
  console.log('orders fetched', orders.size, more.length ? '· TRUNCATED windows: ' + more.join(', ') : '');
  Object.entries(c).sort().forEach(([k, v]) => console.log('  ' + k.padEnd(40) + v));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
