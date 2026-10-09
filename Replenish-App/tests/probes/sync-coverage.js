/* DELTA SYNC — does the change register (pt_sync) really catch every save? Read-only.
 *   node sync-coverage.js [since ISO, default: phase 1 went live 2026-10-09T17:10Z]
 * Every history line (pt_audit) since then that touched a gate register must have a pt_sync line for that row at or
 * after the history line's time. A miss means a save the delta read would not see: a tab still running the code from
 * before phase 1 (it shows a "newer version — Reload" bar), or a writer outside core/history.js. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const H = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app/';
const NODES = ['pt_orderBook', 'pt_masterDB', 'pt_cuttingData', 'pt_pressInventory', 'pt_shopProd', 'pt_masters', 'pt_cuttingFreezes', 'pt_qcChecks'];
const since = Date.parse(process.argv[2] || '2026-10-09T17:10:00Z');
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const t = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = t.access_token || t;
  const get = p => new Promise((res, rej) => https.get(H + p, { headers: { Authorization: 'Bearer ' + at } }, x => {
    let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const sync = (await get('pt_sync.json')) || {};
  const months = new Set(); for (let d = new Date(since); d <= new Date(); d.setMonth(d.getMonth() + 1)) months.add(d.toISOString().slice(0, 7));
  let lines = [];
  for (const ym of months) lines = lines.concat(Object.values((await get('pt_audit/' + ym + '.json')) || {}));
  lines = lines.filter(l => l && Date.parse(l.at) >= since);
  let want = 0, got = 0; const miss = [], byWho = {};
  for (const l of lines) for (const p of (l.paths || [])) {
    const seg = String(p).split('/').filter(Boolean);
    if (!NODES.includes(seg[0]) || seg.length < 2) continue;
    want++;
    const ts = ((sync[seg[0]] || {})[seg[1]]) || 0;
    if (ts >= Date.parse(l.at) - 5000) got++;
    else { miss.push(`${l.at} ${l.by} ${l.tab} ${seg[0]}/${seg[1]}`); byWho[l.by] = (byWho[l.by] || 0) + 1; }
  }
  const entries = NODES.reduce((s, n) => s + Object.keys(sync[n] || {}).length, 0);
  console.log(`since ${new Date(since).toISOString()}: ${lines.length} history lines, ${want} gate-row writes, ${got} noted in pt_sync, ${miss.length} missed`);
  console.log(`pt_sync holds ${entries} row line(s)` + (sync._reset ? `, resets: ${Object.keys(sync._reset).join(', ')}` : ''));
  if (miss.length) { console.log('missed, by who:', JSON.stringify(byWho)); miss.slice(0, 20).forEach(m => console.log('  ' + m)); }
})().catch(e => { console.error(e.message); process.exit(1); });
