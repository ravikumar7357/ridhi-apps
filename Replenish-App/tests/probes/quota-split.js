/* RTDB download today, split by whatever labels Monitoring gives, plus connections (read-only). */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const P = 'https://monitoring.googleapis.com/v3/projects/price-research-48ff3/';
  const md = await get(P + 'metricDescriptors?filter=' + encodeURIComponent('metric.type=starts_with("firebasedatabase.googleapis.com/")'));
  (md.metricDescriptors || []).forEach(m => console.log(m.type, (m.labels || []).map(l => l.key).join(',')));
  const s = new Date(new Date().setHours(0, 0, 0, 0)), e = new Date();
  for (const t of (process.env.M ? process.env.M.split(',') : ['network/sent_bytes_count', 'network/active_connections'])) {
    const agg = t === 'network/active_connections' ? '&aggregation.alignmentPeriod=3600s&aggregation.perSeriesAligner=ALIGN_MAX' : '&aggregation.alignmentPeriod=86400s&aggregation.perSeriesAligner=ALIGN_SUM';
    const r = await get(P + 'timeSeries?filter=' + encodeURIComponent('metric.type="firebasedatabase.googleapis.com/' + t + '"') + '&interval.startTime=' + s.toISOString() + '&interval.endTime=' + e.toISOString() + agg);
    (r.timeSeries || []).forEach(x => console.log(t, JSON.stringify(x.metric.labels || {}), x.points.map(p => { const v = Number(p.value.int64Value || p.value.doubleValue || 0); return t.indexOf('bytes') >= 0 ? (v / 1048576).toFixed(0) + 'MB' : v; }).join(' ')));
    if (r.error) console.log(t, 'ERR', r.error.message);
  }
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
