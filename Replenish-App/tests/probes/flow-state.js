/* PRODUCTION FLOW — what is saved, and who wrote it. Read-only.
 *   node tests/probes/flow-state.js [orderNo filter]
 * Prints every plan, fabric-ready, reservation, challan and test order, and the change-history (pt_audit) lines that
 * touched them today — to answer "how did this line move?" from the data, not from a guess. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const H = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app/';
const want = String(process.argv[2] || '').toUpperCase();
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const t = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = t.access_token || t;
  const get = p => new Promise((res, rej) => https.get(H + p, { headers: { Authorization: 'Bearer ' + at } }, x => {
    let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const pick = o => Object.entries(o || {}).filter(([k]) => !want || k.toUpperCase().includes(want));
  const [ppc, dem, res, ch, test] = await Promise.all(['pt_ppc', 'pt_flowDemand', 'pt_accReserve', 'pt_flowChallans', 'pt_flowTest'].map(n => get(n + '.json')));
  console.log('== test orders'); pick(test).forEach(([k, v]) => console.log(' ', k, JSON.stringify(Object.fromEntries(Object.entries(v.lines || {}).map(([s, l]) => [s, l])))));
  console.log('== plans'); pick(ppc).forEach(([k, v]) => console.log(' ', k, 'route', v.route || '-', 'printer', v.printer && v.printer.name, 'fabric', v.fabric && v.fabric.name, v.fabric && v.fabric.metres, 'by', v.by, v.at));
  console.log('== fabric ready'); pick(dem).forEach(([k, v]) => console.log(' ', k, JSON.stringify(v.fabricReady)));
  console.log('== reservations'); pick(res).forEach(([k, v]) => console.log(' ', k, JSON.stringify(v.items), v.by, v.at));
  console.log('== challans'); Object.entries(ch || {}).filter(([, c]) => !want || String(c.orderNo).toUpperCase().includes(want))
    .forEach(([k, c]) => console.log(' ', k, c.orderNo, '→', c.vendor && c.vendor.name, (c.lines || []).map(l => l.sku + ' ' + l.metres + 'm').join(', '),
      c.cancelled ? 'CANCELLED ' + c.cancelled.why : '', c.closed ? 'CLOSED ' + c.closed.why : '', 'receipts', Object.keys(c.receipts || {}).length, 'by', c.by, c.at));
  const audit = Object.values((await get('pt_audit/2026-10.json')) || {})
    .filter(l => l && (l.paths || []).some(p => /^(pt_ppc|pt_flowDemand|pt_accReserve|pt_flowChallans|pt_flowTest)\//.test(p) && (!want || p.toUpperCase().includes(want))))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  console.log('== change history (' + audit.length + ')');
  audit.forEach(l => console.log(' ', l.at, l.by, l.tab || '', (l.paths || []).filter(p => /^pt_(ppc|flowDemand|accReserve|flowChallans|flowTest)\//.test(p)).join(' | ').slice(0, 300)));
})().catch(e => { console.error(e.message); process.exit(1); });
