/* Vendor-order lines with no article / colour / size, and what the master's look-alike SKUs say they are (read-only). */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 120000 }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [mdbRaw, vo, cus] = await Promise.all([get(DB + '/pt_masterDB.json'), get(DB + '/pt_vendorOrders.json'), get(DB + '/pt_customSkus.json')]);
  const U = s => String(s || '').trim().toUpperCase();
  const mdb = Object.values(mdbRaw || {}).filter(r => r && r.sku && !r.isCustom);
  const bySku = new Map(mdb.map(r => [U(r.sku), r]));
  const shape = s => { const m = U(s).match(/^([A-Z]+)(\d+)(.*)$/); return m ? { pre: m[1], code: m[2], rest: m[3] } : null; };
  const colourOfCode = new Map(); const artOfShape = new Map();
  const tally = (map, k, v) => { if (!k || !v) return; const t = map.get(k) || new Map(); t.set(v, (t.get(v) || 0) + 1); map.set(k, t); };
  mdb.forEach(r => { const p = shape(r.sku); if (!p) return; tally(colourOfCode, p.code, r.color); tally(artOfShape, p.pre + '#' + p.rest, JSON.stringify([r.articleType || '', r.subtype || '', r.size || ''])); });
  const top = t => t ? [...t.entries()].sort((a, b) => b[1] - a[1]) : [];
  const guess = sku => { const p = shape(sku); if (!p) return null; const c = top(colourOfCode.get(p.code)), a = top(artOfShape.get(p.pre + '#' + p.rest));
    return { colour: c[0] ? c[0][0] : '', colourVotes: c.map(x => x.join(':')).join(' '), art: a[0] ? JSON.parse(a[0][0]) : null, artVotes: a.length }; };
  const blank = [];
  Object.entries(vo || {}).forEach(([code, orders]) => Object.entries(orders || {}).forEach(([id, o]) => {
    const lines = Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {});
    lines.forEach(l => { if (!l || l.kind === 'running' || !l.sku) return; if (!String(l.color || '').trim() || !String(l.articleType || '').trim() || !String(l.size || '').trim()) blank.push({ code, id, st: o.status, sku: U(l.sku), inMaster: bySku.has(U(l.sku)), l }); });
  }));
  console.log('vendor-order lines missing article/colour/size:', blank.length, '· SKUs:', new Set(blank.map(b => b.sku)).size, '· of which in the master:', blank.filter(b => b.inMaster).length);
  const skus = [...new Set(blank.map(b => b.sku))];
  let full = 0, part = 0, none = 0; const ex = [];
  skus.forEach(s => { const g = guess(s); const ok = g && g.colour && g.art; if (ok) full++; else if (g && (g.colour || g.art)) part++; else none++; if (ex.length < 25) ex.push([s, bySku.has(s) ? 'IN MASTER' : '', g && g.colour, g && g.art && g.art.join(' / '), g && g.colourVotes].join(' | ')); });
  console.log('guessable in full', full, '· partly', part, '· not at all', none);
  ex.forEach(x => console.log('  ' + x));
  const cu = Object.values(cus || {}).filter(r => r && r.sku);
  const cuBlank = cu.filter(r => !r.color || !r.articleType || !r.size);
  console.log('\ncustom SKUs', cu.length, '· missing details', cuBlank.length, '· guessable in full', cuBlank.filter(r => { const g = guess(r.sku); return g && g.colour && g.art; }).length);
  cuBlank.slice(0, 12).forEach(r => { const g = guess(r.sku); console.log('  ', r.sku, '|', g && g.colour, '|', g && g.art && g.art.join(' / '), '|', r.name || r.shopName || ''); });
  const amb = skus.map(s => [s, guess(s)]).filter(([, g]) => g && g.colourVotes.split(' ').length > 1);
  console.log('\ncodes with more than one colour:', amb.length); amb.slice(0, 8).forEach(([s, g]) => console.log('  ', s, g.colourVotes));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
