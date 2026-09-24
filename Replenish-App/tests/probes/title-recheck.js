/* THE ROWS ALREADY OPENED FROM A TITLE, JUDGED AGAIN BY THE RULE AS IT STANDS NOW. Read-only.
 *
 *   node title-recheck.js [days]
 *
 * Ravi, 2026-09-24: a line reading "Ruffle Tablecloth" had opened against a plain Square Tablecloth.
 * The rule has been fixed; these are the rows it already wrote. For each one this says whether the
 * same line would be matched the same way today, to something ELSE, or to nothing at all — and
 * whether any work has been booked against it, because a row the floor has started is not a row to
 * delete quietly.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const APP = pathm.join(__dirname, '..', '..', 'public', 'index.html');
const PROJ = 'price-research-48ff3';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const get = (u, h) => new Promise((res, rej) => https.get(u, { headers: h || {} }, r => {
  if (r.statusCode >= 300 && r.headers.location) return res(get(r.headers.location, h));
  let d = ''; r.on('data', c => d += c);
  r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(r.statusCode + ' ' + d.slice(0, 200))); } });
}).on('error', rej));
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const up = v => String(v == null ? '' : v).trim().toUpperCase();

function matcher() {
  const src = fs.readFileSync(APP, 'utf8');
  const a = src.indexOf('const shpWords = v =>');
  const b = src.indexOf('function shpNeeds(', a);
  if (a < 0 || b < 0) throw new Error('the matcher is not where it was');
  return new Function('PTG', src.slice(a, b) + '\n;return { shpSkuFromTitle };');
}

(async () => {
  const back = Number(process.argv[2] || 45);
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const H = { Authorization: 'Bearer ' + at };
  const api = (await get('https://firestore.googleapis.com/v1/projects/' + PROJ + '/databases/(default)/documents/config/api', H)).fields || {};

  const [mdbRaw, obRaw, baseRaw, cutRaw, pressRaw] = await Promise.all([
    get(DB + '/pt_masterDB.json', H), get(DB + '/pt_orderBook.json', H),
    get(DB + '/pt_baseData.json', H), get(DB + '/pt_cuttingData.json', H), get(DB + '/pt_pressInventory.json', H),
  ]);
  const M = matcher()({ mdb: Object.values(mdbRaw || {}).filter(Boolean) });

  /* Work booked against an order and SKU — the sync's own reason for keeping a row. */
  const worked = new Set();
  const add = rows => Object.values(rows || {}).forEach(r => {
    if (!r) return;
    const q = Number(r.issuePieces || r.pieces || 0) || 0;
    if (q > 0 && r.orderNo && r.sku) worked.add(up(r.orderNo) + '|' + up(r.sku));
  });
  add(baseRaw); add(cutRaw); add(pressRaw);

  const rows = Object.entries(obRaw || {}).map(([k, v]) => Object.assign({ _key: k }, v))
    .filter(r => r && r.titleMatch);
  console.log('rows opened from a title:', rows.length);

  /* The live lines, so each row can be judged against the words it came from. */
  const lines = new Map();                       // "SHP-6020|SKU?" is not enough: key by order number
  for (const shop of ['', 'CPC']) {
    const u = new URL(api.url.stringValue);
    u.searchParams.set('key', api.key.stringValue);
    u.searchParams.set('shopify', 'orders');
    if (shop) u.searchParams.set('shop', shop);
    u.searchParams.set('start', day(-back)); u.searchParams.set('end', day(0)); u.searchParams.set('open', '0');
    let d;
    try { d = await get(u.toString()); } catch (e) { console.log((shop || 'Ridhi') + ' failed:', e.message); continue; }
    (d.orders || []).forEach(o => (o.items || []).forEach(i => {
      if (String(i.sku || '').trim()) return;
      const no = 'SHP-' + String(o.no || '').replace(/^#/, '');
      (lines.get(no) || lines.set(no, []).get(no)).push(i);
    }));
  }
  console.log('orders in the last', back, 'days carrying a codeless line:', lines.size);

  const same = [], moved = [], gone = [], unseen = [];
  rows.forEach(r => {
    const its = lines.get(up(r.orderNo)) || null;
    if (!its) { unseen.push(r); return; }
    /* Which of the order's codeless lines this row came from: the one that still resolves to it,
     * else the one whose title mentions the row's own article. */
    let best = null;
    its.forEach(i => {
      const m = M.shpSkuFromTitle(i.name, i.variant);
      if (m && up(m.sku) === up(r.sku)) best = { i, m };
    });
    if (best) { same.push(r); return; }
    const guesses = its.map(i => ({ i, m: M.shpSkuFromTitle(i.name, i.variant) }));
    const now = guesses.find(g => g.m);
    if (now) moved.push({ r, from: r.sku, to: now.m.sku, title: now.i.name + ' · ' + (now.i.variant || '') });
    else gone.push({ r, title: (its[0] && its[0].name) || '', variant: (its[0] && its[0].variant) || '' });
  });

  console.log('\nSTILL THE SAME:', same.length);
  console.log('WOULD NOW MATCH SOMETHING ELSE:', moved.length);
  moved.forEach(x => console.log('  ', x.r.orderNo, x.from, '→', x.to, '·', x.title,
    worked.has(up(x.r.orderNo) + '|' + up(x.from)) ? '· WORK BOOKED' : ''));
  console.log('\nWOULD NOW MATCH NOTHING (the SKU has to exist first):', gone.length);
  gone.forEach(x => console.log('  ', x.r.orderNo, x.r.sku, '·', x.title, x.variant,
    worked.has(up(x.r.orderNo) + '|' + up(x.r.sku)) ? '· WORK BOOKED' : ''));
  console.log('\nnot in the window, so not judged:', unseen.length);
})().catch(e => { console.error(e.message); process.exit(1); });
