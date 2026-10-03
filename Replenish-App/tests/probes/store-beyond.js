/* Why pieces were issued beyond what the printers delivered, across every printer SKU (3 Oct 2026). Walks each SKU's events
 * oldest first: printer delivery IN, karigar issue OUT; an issue with nothing left on the shelf is "beyond" and is put down to
 * the first matching reason. node store-beyond.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const ms = s => { s = String(s || ''); const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:,\s*(\d{2}):(\d{2}))?/); if (m) return Date.UTC(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)); const t = Date.parse(s); return isNaN(t) ? 0 : t; };
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [vo, open, done, cut] = await Promise.all([get('pt_vendorOrders'), get('pt_baseData'), get('pt_baseDone'), get('pt_cuttingData')]);
  const base = Object.values(open || {}).filter(Boolean);
  Object.entries(done || {}).forEach(([day, m]) => { if (day[0] !== '_') Object.values(m || {}).forEach(r => r && base.push(r)); });
  const ev = {};
  const push = (sku, e) => (ev[sku] = ev[sku] || []).push(e);
  Object.entries(vo || {}).forEach(([code, orders]) => Object.values(orders || {}).forEach(o => { if (!o) return;
    (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {})).forEach(l => { if (!l || !l.sku) return;
      (Array.isArray(l.deliveries) ? l.deliveries : Object.values(l.deliveries || {})).forEach(d => { if (!d) return;
        const q = +(d.ok ? d.ok.qty : d.qty) || 0; if (q > 0 && (l.unit || 'pcs') !== 'm') push(String(l.sku).toUpperCase(), { t: ms((d.ok && d.ok.at) || d.at || d.date), k: 'in', q }); }); }); }));
  const printerSkus = new Set(Object.keys(ev));
  const cutBy = {};
  Object.values(cut || {}).forEach(c => { if (!c || !c.sku) return; const s = String(c.sku).toUpperCase(); if (!printerSkus.has(s)) return;
    const q = +(c.pieces || c.cutPieces || c.qty) || 0; (cutBy[s] = cutBy[s] || []).push({ t: ms(c.addedAt || c.cutDate), q, order: c.orderNo || '' }); });
  base.forEach(r => { const s = String(r.sku || '').toUpperCase(); if (!printerSkus.has(s)) return;
    push(s, { t: ms(r.addedAt || r.issueDate), k: 'out', q: +r.issuePieces || 0, r }); });
  // duplicates: same SKU, karigar, qty, order, within 10 min, one of them never received anything
  const reasons = { beforeFirst: 0, cutInHouse: 0, duplicate: 0, other: 0 }, perSku = [];
  let beyondTot = 0, LATE = 0;
  Object.entries(ev).forEach(([sku, list]) => {
    list.sort((a, b) => a.t - b.t);
    const firstIn = (list.find(e => e.k === 'in') || {}).t || Infinity;
    const outs = list.filter(e => e.k === 'out');
    const dup = new Set();
    outs.forEach((a, i) => outs.slice(i + 1).forEach(b => {
      if (a.r.empName === b.r.empName && a.q === b.q && (a.r.orderNo || '') === (b.r.orderNo || '') && Math.abs(a.t - b.t) < 600000) {
        const loser = (+b.r.receivedPieces || 0) === 0 ? b : (+a.r.receivedPieces || 0) === 0 ? a : null; if (loser) dup.add(loser); }
    }));
    let shelf = 0, cutLeft = (cutBy[sku] || []).reduce((s, c) => s + c.q, 0), mine = { sku, delivered: 0, issued: 0, beyond: 0, r: { beforeFirst: 0, cutInHouse: 0, duplicate: 0, other: 0 } };
    const GRACE = +(process.env.GRACE || 0) * 86400000, owed = [];
    list.forEach(e => {
      if (e.k === 'in') {
        let q = e.q; mine.delivered += e.q;
        // a delivery entered late pays back what was issued from it in the GRACE days before it was entered
        for (const o of owed) { if (!q) break; if (o.left > 0 && e.t - o.t <= GRACE) { const p = Math.min(q, o.left); o.left -= p; q -= p; mine.late = (mine.late || 0) + p; mine.beyond -= p; mine.r[o.why] -= p; } }
        shelf += q; return; }
      mine.issued += e.q;
      const take = Math.min(shelf, e.q); shelf -= take; let rest = e.q - take;
      if (!rest) return;
      mine.beyond += rest;
      const put = (k, n) => { n = Math.min(n, rest); if (n > 0) { mine.r[k] += n; rest -= n; if (GRACE) owed.push({ t: e.t, left: n, why: k }); } };
      if (dup.has(e)) put('duplicate', rest);
      if (rest && cutLeft > 0) { const n = Math.min(cutLeft, rest); put('cutInHouse', n); cutLeft -= n; }
      if (rest && e.t < firstIn) put('beforeFirst', rest);
      put('other', rest);
    });
    beyondTot += mine.beyond; LATE += mine.late || 0; Object.keys(reasons).forEach(k => reasons[k] += mine.r[k]);
    if (mine.beyond) perSku.push(mine);
  });
  console.log('GRACE days', process.env.GRACE || 0, '| paid back by late delivery entries', LATE, '|', 'printer SKUs', printerSkus.size, '| SKUs with beyond', perSku.length, '| beyond pcs', beyondTot);
  console.log('reasons (pcs):', JSON.stringify(reasons));
  perSku.sort((a, b) => b.r.other - a.r.other).slice(0, 15).forEach(m => console.log('  other', m.sku, 'delivered', m.delivered, 'issued', m.issued, JSON.stringify(m.r)));
  fs.writeFileSync(pathm.join(__dirname, 'store-beyond.json'), JSON.stringify(perSku));
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
