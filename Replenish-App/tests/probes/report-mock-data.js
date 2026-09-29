/* Real figures for the production-report design mock-ups (29 Sep). Read-only. Writes JSON to stdout. */
const fs = require('fs'), https = require('https'), p = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(p.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const t = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = t.access_token || t;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
  const [b, c, m] = await Promise.all([get(DB + '/pt_baseData.json'), get(DB + '/pt_cuttingData.json'), get(DB + '/pt_masterDB.json')]);
  const mdb = new Map(Object.values(m).filter(Boolean).map(r => [String(r.sku).toUpperCase(), r]));
  const M = r => mdb.get(String(r.sku || '').toUpperCase()) || {};
  const art = r => M(r).articleType || r.articleType || '(unknown)';
  const ms = s => { const q = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/); if (q) return new Date(+q[3], +q[2] - 1, +q[1], +(q[4] || 0), +(q[5] || 0)).getTime(); return 0; };
  const needsCut = r => { const x = M(r); const st = String(x.subtype || ''), tt = (x.articleType || '') + ' ' + st; if (/table\s*runner/i.test(tt) || /border\s*napkin/i.test(tt)) return false; if (/tablecloth/i.test(tt)) return /ruffle|piping|scallop/i.test(st); return true; };
  const DAY = 864e5, wk = d => new Date(2026, 8, d).getTime();
  const weeks = [30 - 28, 6, 13, 20].map((d, i) => i === 0 ? new Date(2026, 7, 30).getTime() : wk(d));
  const out = { weeks: [], articles: {}, daily: [] };
  const base = Object.values(b).filter(Boolean), cuts = Object.values(c).filter(Boolean);
  weeks.forEach(from => {
    const to = from + 7 * DAY; let made = 0, pradeep = 0, insert = 0, issued = 0, cut = 0; const kar = new Set(), arts = {};
    base.forEach(r => { const rm = r.receivingDate ? ms(r.receivingDate) : 0, im = ms(r.issueDate), g = +r.receivedPieces || 0;
      if (rm >= from && rm < to && g > 0) { if (/pillow insert/i.test(art(r))) insert += g; else if (/pradeep/i.test(r.empName || '')) pradeep += g; else { made += g; kar.add(String(r.empName).trim()); } if (!/pillow insert/i.test(art(r))) arts[art(r)] = (arts[art(r)] || 0) + g; }
      if (im >= from && im < to && !/pillow insert/i.test(art(r)) && !/pradeep/i.test(r.empName || '')) issued += +r.issuePieces || 0; });
    cuts.forEach(r => { const x = ms(r.cutDate); if (x >= from && x < to && !/pillow insert/i.test(art(r)) && needsCut(r)) cut += +r.pieces || 0; });
    out.weeks.push({ from: new Date(from).toDateString(), made, pradeep, insert, karigars: kar.size, issued, cut, total: made + pradeep });
    out.articles[new Date(from).toDateString()] = arts;
  });
  const from = wk(20);
  for (let i = 1; i < 7; i++) { const d = from + i * DAY; let cut = 0, iss = 0, rec = 0;
    base.forEach(r => { if (/pillow insert/i.test(art(r)) || /pradeep/i.test(r.empName || '')) return; const im = ms(r.issueDate), rm = r.receivingDate ? ms(r.receivingDate) : 0; if (im >= d && im < d + DAY) iss += +r.issuePieces || 0; if (rm >= d && rm < d + DAY) rec += +r.receivedPieces || 0; });
    cuts.forEach(r => { const x = ms(r.cutDate); if (x >= d && x < d + DAY && !/pillow insert/i.test(art(r)) && needsCut(r)) cut += +r.pieces || 0; });
    out.daily.push({ day: new Date(d).toDateString().slice(0, 10), cut, issued: iss, made: rec }); }
  console.log(JSON.stringify(out));
})();
