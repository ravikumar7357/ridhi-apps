/* HOW MUCH TYPING DOES GROUPING BY SIZE ACTUALLY SAVE, AND WHAT WOULD A STOCK FIGURE CLASH WITH?
 *
 * The RFD screen lists one row per SKU, so 60X60 Square Tablecloth appears once per colour. A
 * printer is asking for BLANK cloth to print - the colour is what they are about to put on it - so
 * the split is work without a reason. This measures: how many rows collapse, whether the colours of
 * one size ever want different cloth (which would make the group a lie), and how often two open
 * orders of the same vendor share a SKU - because a stock figure counted against both would be
 * counted twice.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const list = o => (Array.isArray(o) ? o.map((v, i) => (v && typeof v === 'object' ? Object.assign({ _key: String(i) }, v) : v)) : Object.keys(o || {}).map(k => (o[k] && typeof o[k] === 'object' ? Object.assign({ _key: k }, o[k]) : o[k]))).filter(Boolean);
  const U = s => String(s == null ? '' : s).trim().toUpperCase();
  const N = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
  const H = t => console.log('\n== ' + t + ' ==');

  const [voR, mdbR, mastersR] = await Promise.all(['pt_vendorOrders', 'pt_masterDB', 'pt_masters'].map(get));
  const mdb = list(mdbR); const mdbBy = {}; mdb.forEach(m => { const k = U(m.sku); if (k) mdbBy[k] = m; });
  /* printRule decides whether a size leaves here already cut; only those appear in the pieces table */
  const rules = list((mastersR || {}).printRule);
  const ruleOf = m => {
    if (!m) return 'cut';
    const r = rules.find(x => x && U(x.articleType) === U(m.articleType)
      && (!x.subtype || U(x.subtype) === U(m.subtype)) && (!x.size || U(x.size) === U(m.size)));
    return r && r.issueAs ? String(r.issueAs) : 'cut';
  };

  const orders = [];
  Object.entries(voR || {}).forEach(([vcode, byId]) => Object.entries(byId || {}).forEach(([id, o]) => {
    if (!o) return;
    const lines = Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {});
    orders.push({ vcode, id, no: o.orderNo || id, status: o.status || '', orderType: o.orderType || '',
      lines: lines.filter(Boolean) });
  }));
  console.log('vendor orders on record: ' + orders.length);

  /* ---- the pieces table, as the screen builds it ---- */
  const pieceLines = o => {
    const by = new Map();
    o.lines.forEach(l => {
      if (String(l.kind || '') === 'running' || o.orderType === 'running') return;
      const m = mdbBy[U(l.sku)];
      if (ruleOf(m) !== 'cut') return;
      if (l.cancelled) return;
      const sku = String(l.sku || '').trim(); if (!sku) return;
      const pcs = N(l.qty); if (!(pcs > 0)) return;
      const k = U(sku);
      if (!by.has(k)) by.set(k, { sku, size: String(l.size || '').trim(), colour: String(l.color || '').trim(),
        what: String(l.articleSubtype || l.articleType || '').trim(),
        fabric: String((m && m.fabric) || '').trim(), pieces: 0 });
      by.get(k).pieces += pcs;
    });
    return [...by.values()];
  };
  const gKey = x => [x.what, x.size].map(s => s.toLowerCase()).join(' | ');

  H('1. HOW MANY ROWS COLLAPSE');
  let rows = 0, groups = 0, worst = null;
  const perOrder = [];
  orders.forEach(o => {
    const pl = pieceLines(o); if (!pl.length) return;
    const g = new Set(pl.map(gKey));
    rows += pl.length; groups += g.size;
    perOrder.push({ no: o.no, rows: pl.length, groups: g.size, pcs: pl.reduce((a, x) => a + x.pieces, 0) });
    if (!worst || pl.length - g.size > worst.rows - worst.groups) worst = { no: o.no, rows: pl.length, groups: g.size };
  });
  console.log('orders with a pieces table : ' + perOrder.length);
  console.log('rows a printer sees today  : ' + rows);
  console.log('rows once grouped by size  : ' + groups + '   (' + Math.round((1 - groups / (rows || 1)) * 100) + '% fewer)');
  console.log('\nthe ten biggest orders:');
  perOrder.sort((a, b) => b.rows - a.rows).slice(0, 10).forEach(x =>
    console.log('   ' + String(x.no).padEnd(22) + String(x.rows).padStart(4) + ' rows -> ' + String(x.groups).padStart(3)
      + ' sizes   (' + x.pcs + ' pcs)'));

  H('2. IS THE GROUP A LIE? (do the colours of one size want different cloth?)');
  let gTot = 0, gSplit = 0; const splitEx = [];
  orders.forEach(o => {
    const by = new Map();
    pieceLines(o).forEach(x => { const k = gKey(x); if (!by.has(k)) by.set(k, new Set()); if (x.fabric) by.get(k).add(x.fabric.toLowerCase()); });
    by.forEach((set, k) => { gTot++; if (set.size > 1) { gSplit++; if (splitEx.length < 10) splitEx.push([o.no, k, [...set]]); } });
  });
  console.log('size groups across every order        : ' + gTot);
  console.log('…whose colours name different cloth   : ' + gSplit);
  splitEx.forEach(([no, k, v]) => console.log('   ' + no + '  ' + k + ' -> ' + v.join(' / ')));

  H('3. WOULD A STOCK FIGURE BE COUNTED TWICE? (one vendor, two open orders, same SKU)');
  const OPEN = /placed|acknowledged|in production|partially/i;
  const byVendor = {};
  orders.forEach(o => { if (!OPEN.test(o.status)) return; (byVendor[o.vcode] = byVendor[o.vcode] || []).push(o); });
  let clash = 0; const clashEx = [];
  Object.entries(byVendor).forEach(([v, os]) => {
    if (os.length < 2) return;
    const seen = new Map();
    os.forEach(o => pieceLines(o).forEach(x => {
      const k = gKey(x);
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(o.no);
    }));
    seen.forEach((set, k) => { if (set.size > 1) { clash++; if (clashEx.length < 10) clashEx.push([v, k, [...set]]); } });
  });
  console.log('vendors with more than one OPEN order : '
    + Object.values(byVendor).filter(l => l.length > 1).length + ' of ' + Object.keys(byVendor).length);
  console.log('size groups that appear on two of one vendor\u2019s open orders: ' + clash);
  clashEx.forEach(([v, k, os]) => console.log('   ' + v + '  ' + k + '  on ' + os.join(', ')));

  H('4. THE ORDER ON RAVI\u2019S SCREEN');
  const one = orders.find(o => String(o.no).indexOf('VPO-260911-BRG') >= 0);
  if (!one) { console.log('VPO-260911-BRG not found'); return; }
  const pl = pieceLines(one);
  const by = new Map();
  pl.forEach(x => { const k = gKey(x); if (!by.has(k)) by.set(k, { pcs: 0, cols: [] }); const e = by.get(k); e.pcs += x.pieces; e.cols.push(x.colour); });
  console.log(one.no + ': ' + pl.length + ' rows today -> ' + by.size + ' sizes');
  [...by].sort((a, b) => b[1].pcs - a[1].pcs).slice(0, 12).forEach(([k, e]) =>
    console.log('   ' + k.padEnd(34) + String(e.pcs).padStart(6) + ' pcs over ' + e.cols.length + ' colour(s): ' + e.cols.join(', ')));
})().catch(e => { console.error('FAILED: ' + (e.message || e)); process.exit(1); });
