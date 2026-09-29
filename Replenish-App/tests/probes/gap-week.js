/* Where the week's gap is: karigar capacity at N pcs a day vs work they had (in hand + given) vs cutting. Read-only.
 * Usage: node gap-week.js 2026-09-20 [perDay] */
const fs = require('fs'), https = require('https'), p = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const wk = process.argv[2] || '2026-09-20', T = Number(process.argv[3] || 50);
(async () => {
  const cfg = JSON.parse(fs.readFileSync(p.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const t = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = t.access_token || t;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
  const [b, c, m] = await Promise.all([get(DB + '/pt_baseData.json'), get(DB + '/pt_cuttingData.json').catch(() => null), get(DB + '/pt_masterDB.json')]);
  const mdb = new Map(Object.values(m).filter(Boolean).map(r => [String(r.sku).toUpperCase(), r]));
  const art = r => { const x = mdb.get(String(r.sku || '').toUpperCase()); return (x && x.articleType) || r.articleType || ''; };
  const needsCut = r => { const x = mdb.get(String(r.sku || '').toUpperCase()) || {}; const st = String(x.subtype || r.articleSubtype || ''), t = (x.articleType || r.articleType || '') + ' ' + st; if (/table\s*runner/i.test(t) || /border\s*napkin/i.test(t)) return false; if (/tablecloth/i.test(t)) return /ruffle|piping|scallop/i.test(st); return true; };
  let issuedCut = 0;
  const ms = s => { const q = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/); if (q) return new Date(+q[3], +q[2] - 1, +q[1], +(q[4] || 0), +(q[5] || 0)).getTime(); const d = new Date(s); return isNaN(d) ? 0 : d.getTime(); };
  const w = wk.split('-').map(Number), from = new Date(w[0], w[1] - 1, w[2]).getTime(), to = new Date(w[0], w[1] - 1, w[2] + 7).getTime(), DAY = 864e5;
  const rows = Object.values(b).filter(r => r && !/pillow insert/i.test(art(r)) && !/pradeep/i.test(r.empName || ''));
  const made = new Map(); let issued = 0, held = 0;
  rows.forEach(r => { const im = ms(r.issueDate), rm = r.receivingDate ? ms(r.receivingDate) : 0, k = String(r.empName || '').trim();
    if (rm >= from && rm < to && +r.receivedPieces > 0) made.set(k, (made.get(k) || 0) + +r.receivedPieces);
    if (im >= from && im < to) { issued += +r.issuePieces || 0; if (needsCut(r)) issuedCut += +r.issuePieces || 0; }
    if (im && im < from && (!rm || rm >= from)) held += +r.issuePieces || 0; });
  const K = made.size, madeTot = [...made.values()].reduce((a, b) => a + b, 0);
  const days = []; for (let i = 0; i < 7; i++) days.push(from + i * DAY);
  const act = d => rows.some(r => { const x = ms(r.issueDate), y = r.receivingDate ? ms(r.receivingDate) : 0; return (x >= d && x < d + DAY) || (y >= d && y < d + DAY); });
  const work = days.filter(d => new Date(d).getDay() !== 0);
  let empty = 0; const emptyBy = {};
  [...made.keys()].forEach(k => { const rs = rows.filter(r => String(r.empName || '').trim() === k);
    work.forEach(d => { const inHand = rs.some(r => { const x = ms(r.issueDate), y = r.receivingDate ? ms(r.receivingDate) : 0; return x && x < d + DAY && (!y || y >= d); }); if (!inHand) { empty++; emptyBy[k] = (emptyBy[k] || 0) + 1; } }); });
  let cut = 0, cutIns = 0; if (c) Object.values(c).forEach(r => { if (!r) return; const x = ms(r.cutDate); if (x >= from && x < to) { if (/pillow insert/i.test(art(r))) cutIns += +r.pieces || 0; else if (needsCut(r)) cut += +r.pieces || 0; } });
  console.log({ week: wk, workDays: work.length, karigars: K, made: madeTot, possible: K * T * work.length, heldAtStart: held, issued, issuedCut, issuedReady: issued - issuedCut, cut, cutInsert: cutIns, emptyKarigarDays: empty, karigarDays: K * work.length });
  console.log('most empty days', Object.entries(emptyBy).sort((a, b) => b[1] - a[1]).slice(0, 10).map(x => x.join(':')).join(' · '));
})();
