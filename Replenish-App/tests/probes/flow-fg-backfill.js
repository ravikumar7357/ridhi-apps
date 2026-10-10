/* One-off (10 Oct): the TEST accept of 19 × RPCRU327-2020 (TEST-AMZ-10102026-01, hand-over log fgs_mv2ozey4b1w) was made
 * before a test accept wrote its India-store row. Writes that RECEIVE row (test: true, "[TEST]") and puts its id on the
 * log, so the store shows it and "delete test" removes it.   node tests/probes/flow-fg-backfill.js [--write] */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const H = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app/';
const LOG = 'fgs_mv2ozey4b1w';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const t = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = t.access_token || t;
  const req = (m, p, body) => new Promise((res, rej) => { const r = https.request(H + p, { method: m, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } }, x => {
    let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  const log = await req('GET', 'pt_flowFgSend/' + LOG + '.json');
  if (!log || log.status !== 'accepted') throw new Error('log not found / not accepted');
  if (log.fgId) { console.log('already has its row:', log.fgId); return; }
  const id = 'RCP-' + Date.parse(log.at).toString(36).toUpperCase() + '-0BF';
  const d = new Date(Date.parse(log.at) + 5.5 * 3600e3), p2 = n => String(n).padStart(2, '0');
  const row = { _id: id, txnType: 'RECEIVE', sku: log.sku, qty: log.pcs, date: `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, reason: '',
    orderNo: log.orderNo, orderSource: 'console', receivedFrom: 'QC (Production flow)', remarks: '[TEST] Accepted from QC', createdAt: log.at, createdBy: log.by, test: true };
  const patch = { ['pt_fgiLedger/' + id]: row, ['pt_flowFgSend/' + LOG + '/fgId']: id };
  console.log(JSON.stringify(patch, null, 1));
  if (process.argv.includes('--write')) { console.log(await req('PATCH', '.json', patch)); console.log('written'); } else console.log('dry run — add --write');
})().catch(e => { console.error(e.message); process.exit(1); });
