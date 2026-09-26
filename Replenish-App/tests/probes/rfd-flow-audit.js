/* THE RFD FLOW ON LIVE DATA, through the deployed code: which open vendor orders the store can work from, and where
 * the sums stop. Read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const src = fs.readFileSync(pathm.join(__dirname, '..', 'prod-test.js'), 'utf8');
  const cutAt = src.indexOf('/* ---- real data ---- */');
  const head = src.slice(0, cutAt).replace(/__dirname/g, JSON.stringify(pathm.join(__dirname, '..')));
  const H = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const app = H.A, L = app.ptList;
  const [vo, dec, stock, masters, mdb] = await Promise.all(['pt_vendorOrders', 'pt_rfdDecisions', 'pt_rfdStock', 'pt_masters', 'pt_masterDB'].map(get));
  app.setPTG(Object.assign(app.PTG(), { masters: masters || {}, mdb: L(mdb) }));
  const rows = []; Object.keys(vo || {}).forEach(c => Object.values(vo[c] || {}).forEach(o => { if (o) rows.push(Object.assign({ vendorCode: c }, o)); }));
  app.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows });
  app.setRFD({ decisions: dec || {}, stock: stock || {}, err: '', busy: false, at: '', shown: [], loaded: true });
  H.ME.admin = true;
  const open = rows.filter(o => !o.cancelled && ['Received', 'Cancelled', 'Draft'].indexOf(o.status || 'Placed') < 0);
  console.log('vendor orders', rows.length, '· open', open.length, '· with createdAt', open.filter(o => o.createdAt).length, '· tracked (from ' + app.RFD_TRACK_FROM + ')', open.filter(app.rfdTracked).length);
  const byV = {}; open.forEach(o => { const k = o.vendorCode; byV[k] = byV[k] || { n: 0, lines: 0, unknown: 0, noRule: 0, need0: 0 };
    byV[k].n++; byV[k].lines += app.voLines(o).length; byV[k].unknown += app.rfdOrderNeed(o).unknown.length;
    byV[k].noRule += app.rfdPieceLines(o).filter(x => !x.ruled).length;
    if (!app.rfdOrderLedger(o).some(x => x.need > 0)) byV[k].need0++; });
  console.log('\nper printer — open orders · lines · lines whose cloth cannot be worked out · piece lines with no printing rule · orders with NOTHING to send');
  Object.entries(byV).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => console.log('  ' + k.padEnd(8), String(v.n).padStart(3), String(v.lines).padStart(5), String(v.unknown).padStart(5), String(v.noRule).padStart(5), String(v.need0).padStart(5)));
  const why = {}; open.forEach(o => app.rfdOrderNeed(o).unknown.forEach(u => { const k = u.replace(/ for .*$/, '').replace(/SKU \S+ is/, 'SKU is'); why[k] = (why[k] || 0) + 1; }));
  console.log('\nwhy cloth cannot be worked out:'); Object.entries(why).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('  ' + String(n).padStart(4), k));
  const noRule = new Set(); open.forEach(o => app.rfdPieceLines(o).filter(x => !x.ruled).forEach(x => noRule.add(x.what || '?')));
  console.log('\npiece subtypes with no printing rule:', [...noRule].join(', ') || 'none');
  console.log('\ntracked orders (the new flow):');
  open.filter(app.rfdTracked).forEach(o => { const led = app.rfdOrderLedger(o);
    console.log('  ' + (o.orderNo || o.id).padEnd(18), o.vendorCode.padEnd(8), String(o.createdAt || o.orderDate).slice(0, 10), o.orderType, '·', led.map(x => x.what + ' ' + x.need + ' ' + x.unit + ' (to send ' + x.toSend + ')').join(' · ') || 'NOTHING TO SEND', app.rfdOrderNeed(o).unknown.length ? '· ' + app.rfdOrderNeed(o).unknown.length + ' line(s) unknown' : ''); });
  const store = {}; Object.keys(byV).forEach(c => { const s = app.rfdStoreOf(c); if (s.length) store[c] = s.map(x => x.what + ' ' + x.inHand + ' ' + x.unit).join(', '); });
  console.log('\nstore by printer (tracked orders only):', Object.keys(store).length ? JSON.stringify(store, null, 1) : 'nothing yet');
  const stale = open.filter(o => !o.createdAt && !app.ptDtMs(o.orderDate || '')).length; console.log('\nopen orders with NO date at all (can never be tracked):', stale);
  const asks = app.rfdRows(); console.log('requirements raised in all:', asks.length, '· pending', asks.filter(r => r.stage === 'pending').length, '· approved not sent', asks.filter(r => r.stage === 'approved').length, '· sent', asks.filter(r => r.stage === 'sent').length);
  const oldest = asks.filter(r => r.stage === 'pending').sort((a, b) => String(a.raisedAt).localeCompare(String(b.raisedAt)))[0]; if (oldest) console.log('oldest pending ask:', oldest.raisedAt.slice(0, 10), oldest.vendorCode, oldest.orderNo, app.rfdQtyTxt(oldest), oldest.unitTxt);
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
