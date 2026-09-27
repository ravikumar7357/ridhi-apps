/* How close the project is to the Spark plan's limits: RTDB bytes sent this month, Firestore reads today (Cloud Monitoring). */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ s: r.statusCode, j: (() => { try { return JSON.parse(d); } catch (e) { return d.slice(0, 300); } })() })); }).on('error', rej));
  const now = new Date(), start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const q = (metric, from, align) => get('https://monitoring.googleapis.com/v3/projects/price-research-48ff3/timeSeries?filter=' + encodeURIComponent('metric.type="' + metric + '"')
    + '&interval.startTime=' + from.toISOString() + '&interval.endTime=' + now.toISOString() + '&aggregation.alignmentPeriod=' + align + '&aggregation.perSeriesAligner=ALIGN_SUM&aggregation.crossSeriesReducer=REDUCE_SUM');
  const sum = r => ((r.j && r.j.timeSeries) || []).reduce((a, t) => a + (t.points || []).reduce((x, p) => x + Number((p.value || {}).int64Value || (p.value || {}).doubleValue || 0), 0), 0);
  const secs = Math.ceil((now - start) / 1000) + 's';
  const rt = await q('firebasedatabase.googleapis.com/network/sent_bytes_count', start, secs);
  console.log('RTDB sent this month:', rt.s === 200 ? (sum(rt) / 1073741824).toFixed(2) + ' GB of the 10 GB Spark allows' : 'HTTP ' + rt.s + ' ' + JSON.stringify(rt.j).slice(0, 200));
  const day = new Date(now - 24 * 3600e3);
  const fsr = await q('firestore.googleapis.com/document/read_count', day, '86400s');
  console.log('Firestore reads, last 24 h:', fsr.s === 200 ? sum(fsr) + ' of 50,000 a day' : 'HTTP ' + fsr.s + ' ' + JSON.stringify(fsr.j).slice(0, 200));
  const days = [];
  for (let i = 0; i < 7; i++) { const e = new Date(now - i * 864e5), s2 = new Date(now - (i + 1) * 864e5);
    const r = await get('https://monitoring.googleapis.com/v3/projects/price-research-48ff3/timeSeries?filter=' + encodeURIComponent('metric.type="firebasedatabase.googleapis.com/network/sent_bytes_count"') + '&interval.startTime=' + s2.toISOString() + '&interval.endTime=' + e.toISOString() + '&aggregation.alignmentPeriod=86400s&aggregation.perSeriesAligner=ALIGN_SUM&aggregation.crossSeriesReducer=REDUCE_SUM');
    days.push((sum(r) / 1048576).toFixed(0) + ' MB'); }
  console.log('RTDB sent per day, newest first:', days.join(' · '));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
