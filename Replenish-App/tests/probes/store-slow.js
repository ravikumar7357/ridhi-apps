/* STORE STOCK BALANCE, TIMED ON THE LIVE DATABASE. Read-only.
 *
 *   node store-slow.js
 *
 * Ravi, 2026-09-24: "humne jab se store stock balance ko joda ye bahut hang ho rha h … meri team bahut
 * pareshan ho rhi h." On screen: "1,616 item(s) · no opening stock yet · Could not read the store book
 * (Failed to fetch)", -43,122 pieces.
 *
 * Answers four questions with numbers:
 *   1. how big pt_storeLedger is, and whether it reads at all
 *   2. how long one draw of the store costs, and how many rows and pictures it produces
 *   3. how many times the picture lookup would redraw the whole store before it runs out of SKUs
 *   4. what the same screen costs when movements are counted only from the opening stock
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const PR = pathm.join(__dirname, '..');

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const raw = p => new Promise((res, rej) => { const t = Date.now(); https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let n = 0; const d = []; r.on('data', c => { n += c.length; d.push(c); }); r.on('end', () => {
      const text = Buffer.concat(d).toString('utf8'); let j = null; try { j = JSON.parse(text); } catch (e) { /* shown below */ }
      res({ status: r.statusCode, bytes: n, ms: Date.now() - t, j, text: text.slice(0, 160) }); }); }).on('error', e => res({ err: e.message })); });

  console.log('=== 1. the store book itself');
  for (const p of ['pt_storeLedger', 'pt_storeChecks']) {
    const r = await raw(p);
    const n = r.j && typeof r.j === 'object' ? Object.keys(r.j).length : 0;
    console.log('   ' + p.padEnd(16) + (r.err ? 'FAILED ' + r.err : 'HTTP ' + r.status + ' · ' + n + ' rows · '
      + (r.bytes / 1024).toFixed(1) + ' KB · ' + r.ms + ' ms' + (r.status !== 200 ? ' · ' + r.text : '')));
  }

  const src = fs.readFileSync(pathm.join(PR, 'prod-test.js'), 'utf8');
  const cutAt = src.indexOf('/* ---- real data ---- */');
  const head = src.slice(0, cutAt).replace(/__dirname/g, JSON.stringify(PR));
  const H = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const app = H.A, els = H.els, L = app.ptList;
  const get = async p => (await raw(p)).j;
  const [masters, mdb, ob, press, cut, base, vo, fab, st, stc] = await Promise.all(
    ['pt_masters', 'pt_masterDB', 'pt_orderBook', 'pt_pressInventory', 'pt_cuttingData', 'pt_baseData',
     'pt_vendorOrders', 'pt_fabInvLedger', 'pt_storeLedger', 'pt_storeChecks'].map(get));
  app.setPTG(Object.assign(app.PTG(), { masters: masters || {}, mdb: L(mdb), ob: L(ob), press: L(press), freeze: {} }));
  app.setPT(Object.assign(app.PT(), { base: L(base), cut: L(cut) }));
  const vrows = []; Object.keys(vo || {}).forEach(c => Object.values(vo[c] || {}).forEach(o => { if (o) vrows.push(Object.assign({ vendorCode: c }, o)); }));
  app.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows: vrows });
  app.setFAB({ rows: L(fab), err: '', busy: false, at: '', shown: [] });
  app.setSTORE({ rows: L(st), checks: stc || {}, err: '', busy: false, at: '' });

  console.log('\n=== 2. one draw of Store Stock Balance, as deployed');
  let t = Date.now(); const moves = app.stMoves(); const tm = Date.now() - t;
  t = Date.now(); const bal = app.stBalances(moves); const tb = Date.now() - t;
  const bySrc = {}; moves.forEach(m => { bySrc[m.src] = (bySrc[m.src] || 0) + 1; });
  console.log('   stMoves ........ ' + tm + ' ms · ' + moves.length + ' movements · ' + JSON.stringify(bySrc));
  console.log('   stBalances ..... ' + tb + ' ms · ' + bal.length + ' items');
  els.fbView.value = 'store';
  t = Date.now(); app.renderFab(); const tr = Date.now() - t;
  t = Date.now(); app.renderFab(); const tr2 = Date.now() - t;
  const html = els.fbTable.innerHTML;
  console.log('   renderFab ...... ' + tr + ' ms, again ' + tr2 + ' ms · ' + (html.match(/<tr>/g) || []).length + ' rows · '
    + (html.length / 1024).toFixed(0) + ' KB of HTML · ' + (html.match(/data-img=/g) || []).length + ' picture cells');
  const pcsSkus = bal.filter(b => b.unit === 'pcs').length;
  const neg = bal.filter(b => b.qty < 0).length;
  console.log('   ' + neg + ' of ' + bal.length + ' items are BELOW ZERO · pieces total '
    + Math.round(bal.filter(b => b.unit === 'pcs').reduce((a, b) => a + b.qty, 0)));

  console.log('\n=== 3. the picture lookup that redraws the whole store when it lands');
  const passes = Math.ceil(pcsSkus / 120);
  console.log('   ' + pcsSkus + ' SKUs with pictures to find, 120 a pass -> up to ' + passes
    + ' full redraws of this screen, each after 3 Apps Script calls — ' + passes + ' x ' + tr + ' ms of drawing alone');

  console.log('\n=== 4. the same screen counted only from an opening stock');
  const opening = L(st).filter(r => r && r.kind === 'OPENING').length;
  console.log('   opening rows in pt_storeLedger: ' + opening + (opening ? '' : '  (none — so nothing before it should count)'));
  const firstEntry = L(st).map(r => String((r && r.at) || '')).filter(Boolean).sort()[0] || '(no entries)';
  console.log('   first store entry of any kind: ' + firstEntry);
  const dayOf = m => String(m.at || '').slice(0, 10);
  const since = d => moves.filter(m => dayOf(m) >= d);
  ['2026-09-22', '2026-09-23', '2026-09-24'].forEach(d => {
    const mv = since(d); const b = app.stBalances(mv);
    console.log('   from ' + d + ': ' + mv.length + ' movements · ' + b.length + ' items · ' + b.filter(x => x.qty < 0).length + ' below zero');
  });
})().catch(e => { console.error(e.message); process.exit(1); });
