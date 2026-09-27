/* RTDB bytes sent per hour, last 48 h (read-only). node quota-hourly.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const e = new Date(), s = new Date(e - 48 * 3600e3);
  const r = await get('https://monitoring.googleapis.com/v3/projects/price-research-48ff3/timeSeries?filter=' + encodeURIComponent('metric.type="firebasedatabase.googleapis.com/network/sent_bytes_count"') + '&interval.startTime=' + s.toISOString() + '&interval.endTime=' + e.toISOString() + '&aggregation.alignmentPeriod=3600s&aggregation.perSeriesAligner=ALIGN_SUM&aggregation.crossSeriesReducer=REDUCE_SUM');
  const pts = ((r.timeSeries || [])[0] || {}).points || [];
  pts.slice().reverse().forEach(p => { const t = new Date(new Date(p.interval.endTime).getTime() + 5.5 * 3600e3); console.log(t.toISOString().slice(5, 16).replace('T', ' '), 'IST', (Number(p.value.int64Value) / 1048576).toFixed(0).padStart(6), 'MB'); });
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
