/* WHAT PACK & VERIFY / SCAN TO PACK WOULD SHOW FOR A REAL ORDER, from the live database, with the deployed code.
 * Read-only. The production block comes through the prod-test harness (as live-console.js does); the shared packing
 * rules (src/app/replenishment/pack-core.js) are evaluated on top of it with the block's own lookups.
 *   node tests/probes/pack-lines.js [ORDER-NO ...]      (no order: the three orders holding most pieces for FBA) */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const want = process.argv.slice(2).map(s => String(s).toUpperCase());
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const src = fs.readFileSync(pathm.join(__dirname, '..', 'prod-test.js'), 'utf8');
  const cutAt = src.indexOf('/* ---- real data ---- */'); if (cutAt < 0) throw new Error('harness marker moved');
  const head = src.slice(0, cutAt).replace(/__dirname/g, JSON.stringify(pathm.join(__dirname, '..')));
  const H = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const [ob, base, cut, press, qc, mdb, fg, vo, fn, img] = await Promise.all(['pt_orderBook', 'pt_baseData', 'pt_cuttingData', 'pt_pressInventory', 'pt_qcChecks', 'pt_masterDB', 'pt_fgiLedger', 'pt_vendorOrders', 'pt_fnskuMap', 'pt_skuImages'].map(get));
  const app = H.A, L = app.ptList;
  app.setPTG(Object.assign(app.PTG(), { ob: L(ob), mdb: L(mdb), press: L(press) }));
  app.setPT(Object.assign(app.PT(), { base: L(base), cut: L(cut) }));
  app.setQC(Object.assign({}, app.QC(), { checks: L(qc), issue: [], ret: [] }));
  app.setFGI(Object.assign({}, app.FGI(), { rows: L(fg) }));
  const rows = []; Object.keys(vo || {}).forEach(c => Object.values(vo[c] || {}).forEach(o => { if (o) rows.push(Object.assign({ vendorCode: c }, o)); }));
  app.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows });
  app.setORD({ req: {}, busy: false, at: '', rows: [] });

  /* the shared packing rules, with the block's own lookups */
  const up = s => String(s == null ? '' : s).trim().toUpperCase();
  const mdbIx = new Map(L(mdb).filter(r => r && r.sku).map(r => [up(r.sku), r]));
  const core = fs.readFileSync(pathm.join(__dirname, '..', '..', 'src', 'app', 'replenishment', 'pack-core.js'), 'utf8');
  const ctx = { obUC: up, fgiOf: app.fgiOf, ordLines: app.ordLines, fgiOutOrders: app.fgiOutOrders, fgiOrderKnown: app.fgiOrderKnown, FGI: app.FGI(), fgiLoad: async () => {}, mdbOf: s => mdbIx.get(up(s)) || null, PK_WT: {}, ME: { email: 'probe' } };
  const P = new Function(...Object.keys(ctx), core + '\n;return { PACK_CORE, packScanNew, packOrderLines };')(...Object.values(ctx));
  const fnMap = new Map(String((fn || {}).list || '').split('\n').map(l => l.split('\t')).filter(a => a[0] && a[1]).map(a => [up(a[0]), up(a[1])]));
  const fnBySku = new Map(); fnMap.forEach((sku, code) => { if (!fnBySku.has(sku)) fnBySku.set(sku, code); });
  const imgOf = sku => { const r = (img || {})[up(sku)] || (img || {})[String(sku)]; return r ? (typeof r === 'string' ? r : (r.url || r.image || r.src || JSON.stringify(r).slice(0, 40))) : ''; };

  /* which orders: asked for, else the three with most pieces in the India Store for an FBA dispatch */
  let orders = want;
  if (!orders.length) {
    const tot = new Map();
    const seen = new Set();
    app.ordLines().forEach(l => { if (seen.has(l.sku)) return; seen.add(l.sku); app.fgiOutOrders(l.sku, 'FBA').forEach(c => tot.set(c.orderNo, (tot.get(c.orderNo) || 0) + c.store)); });
    orders = [...tot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
    console.log('orders holding most pieces for FBA in the India Store: ' + [...tot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0] + ' (' + e[1] + ')').join(', ') + '\n');
  }
  for (const no of orders) {
    const lines = P.packOrderLines(P.packScanNew([no], [], '', ''));
    const ls = P.PACK_CORE.lines(lines, {});
    console.log(`=== ${no} — ${app.fgiOrderKnown(no) ? 'in the Order Console' : 'NOT in the Order Console'} — ${lines.length} SKU line(s) the board would show ===`);
    let packable = 0, noImg = 0, noFn = 0, noMaster = 0;
    [...ls.entries()].forEach(([sku, l]) => {
      const m = mdbIx.get(sku), x = l[0];
      const art = m ? `${m.subcat || m.articleType || '?'} · ${m.color || '?'} · ${m.size || '?'}` : 'NOT IN MASTER';
      const code = fnBySku.get(sku), pic = imgOf(sku);
      if (x.left > 0) packable += x.left; if (!pic) noImg++; if (!code) noFn++; if (!m) noMaster++;
      console.log('  ' + sku.padEnd(18) + art.padEnd(44) + ' ordered ' + String(x.qty).padStart(4) + '  in store ' + String(x.store).padStart(4) + '  can pack ' + String(x.left).padStart(4)
        + '   FNSKU ' + (code || 'NONE').padEnd(11) + ' picture ' + (pic ? 'yes' : 'NO'));
    });
    console.log(`  → pieces this order can pack now: ${packable}; SKUs without a picture: ${noImg}; without an FNSKU label code: ${noFn}; not in master: ${noMaster}\n`);
    /* what one scan would do */
    const first = [...ls.entries()].find(([, l]) => l[0].left > 0);
    if (first) {
      const code = fnBySku.get(first[0]) || first[0];
      const packed = {}; const r = P.PACK_CORE.apply({ sku: first[0], how: fnBySku.get(first[0]) ? 'fnsku' : 'sku' }, lines, packed, 1);
      console.log(`  scanning label ${code} → ${r.kind}: ${r.sku} +1 for ${r.orderNo}, ${r.left} left on the order`);
      const other = [...mdbIx.keys()].find(s => !ls.has(s) && fnBySku.get(s));
      if (other) { const w = P.PACK_CORE.apply({ sku: other, how: 'fnsku' }, lines, packed, 1); console.log(`  scanning label ${fnBySku.get(other)} (${other}, not on this order) → ${w.kind.toUpperCase()}\n`); }
    }
  }
  console.log(`FNSKU map: ${fnMap.size} codes; master: ${mdbIx.size} SKUs; pictures node: ${Object.keys(img || {}).length} SKUs; ledger: ${L(fg).length} rows`);
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
