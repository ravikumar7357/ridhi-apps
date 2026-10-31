/* PPC · PRODUCTION FLOW, TIMED ON THE LIVE DATABASE. Read-only. node tests/probes/ppc-slow.js
 * Ravi, 23 Oct: "data load hone me bahut jyada time lag raha h" (stuck on "Reading again…"). Reads what the screen reads
 * (timed per node), loads it into the prod-test harness, and times flowRows and every bucket's draw, twice. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const PR = pathm.join(__dirname, '..');
(async () => {
  /* OFFLINE=<full backup json> [OVER=dir with <node>.json files that are fresher]: no database read (when the CLI login has lapsed) */
  const OFF = process.env.OFFLINE ? JSON.parse(fs.readFileSync(process.env.OFFLINE, 'utf8')) : null;
  const over = n => { const d = process.env.OVER; if (!d) return undefined; for (const f of [n + '.json', 'live-' + n + '.json']) { const q = pathm.join(d, f); if (fs.existsSync(q)) return JSON.parse(fs.readFileSync(q, 'utf8')); } return undefined; };
  const cfg = OFF ? null : JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = OFF ? '' : await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get0 = p => new Promise((res, rej) => { const t = Date.now(); https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { console.log('   read ' + p.padEnd(20) + (d.length / 1024).toFixed(0).padStart(6) + ' KB ' + String(Date.now() - t).padStart(6) + ' ms'); res(JSON.parse(d)); }); }).on('error', rej); });
  const get = p => OFF ? Promise.resolve((() => { const o = over(p); console.log('   file ' + p.padEnd(20) + (o !== undefined ? 'fresh' : 'backup')); return o !== undefined ? o : OFF[p]; })()) : get0(p);
  const src = fs.readFileSync(pathm.join(PR, 'prod-test.js'), 'utf8');
  const head = src.slice(0, src.indexOf('/* ---- real data ---- */')).replace(/__dirname/g, JSON.stringify(PR));
  const H = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const app = H.A, els = H.els, L = app.ptList;
  console.log('=== reads');
  const t0 = Date.now();
  const names = ['pt_masters', 'pt_masterDB', 'pt_orderBook', 'pt_pressInventory', 'pt_cuttingData', 'pt_baseData', 'pt_baseDone', 'pt_qcChecks', 'pt_fgiLedger', 'pt_vendorOrders',
    'pt_ppc', 'pt_flowDemand', 'pt_accReserve', 'pt_flowChallans', 'pt_flowTest', 'pt_flowPrintOrders', 'pt_flowFgSend', 'pt_flowRev'];
  const D = {}; (await Promise.all(names.map(get))).forEach((v, i) => { D[names[i]] = v; });
  console.log('   all reads in parallel: ' + (Date.now() - t0) + ' ms');
  const baseAll = Object.assign({}, ...Object.values(D.pt_baseDone || {}).filter(d => d && typeof d === 'object'), D.pt_baseData || {});
  app.setPTG(Object.assign(app.PTG(), { masters: D.pt_masters || {}, mdb: L(D.pt_masterDB), ob: L(D.pt_orderBook), press: L(D.pt_pressInventory), freeze: {} }));
  app.setPT(Object.assign(app.PT(), { base: L(baseAll), cut: L(D.pt_cuttingData) }));
  app.setQC(Object.assign({}, app.QC(), { checks: L(D.pt_qcChecks), issue: [], ret: [] }));
  app.setFGI(Object.assign({}, app.FGI(), { rows: L(D.pt_fgiLedger) }));
  const vrows = []; Object.keys(D.pt_vendorOrders || {}).forEach(c => Object.values(D.pt_vendorOrders[c] || {}).forEach(o => { if (o && typeof o === 'object') vrows.push(Object.assign({ vendorCode: c }, o)); }));
  app.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows: vrows });
  const F = app.FLOW();
  app.setFLOW(Object.assign(F, { ppc: D.pt_ppc || {}, dem: D.pt_flowDemand || {}, res: D.pt_accReserve || {}, ch: D.pt_flowChallans || {}, test: D.pt_flowTest || {}, po: D.pt_flowPrintOrders || {}, fg: D.pt_flowFgSend || {}, rev: D.pt_flowRev || {}, at: Date.now(), busy: null, err: '' }));
  H.ME.admin = true;
  const time = (label, f) => { const t = Date.now(); let r; try { r = f(); } catch (e) { console.log('   ' + label + ' THREW ' + e.message); return; } console.log('   ' + label.padEnd(34) + String(Date.now() - t).padStart(7) + ' ms'); return r; };
  console.log('\n=== compute');
  time('flowRows (cold)', () => app.flowRows().length);
  time('flowRows (again)', () => app.flowRows().length);
  console.log('   lines: ' + app.flowRows().length);
  const views = ['new', 'ppc', 'ppcdone', 'drfd', 'demb', 'dacc', 'cut', 'raw', 'wip', 'qcb', 'back', 'dhist:due', 'dhist:challan', 'dhist:day'];
  console.log('=== renderFlow per view (first, again) + HTML size');
  for (const v of views) {
    const [view, ang] = v.split(':'); app.setFLOW_VIEW(view); if (ang) app.setFLOW_ANGLE('dhist', ang);
    time('renderFlow ' + v, () => app.renderFlow()); time('renderFlow ' + v + ' again', () => app.renderFlow());
    console.log('      table ' + ((els.flTable && els.flTable.innerHTML) || '').length / 1024 + ' KB');
  }
  if (app.flowDueRows) time('flowDueRows', () => app.flowDueRows('', false).length);
  process.exit(0);
})();
