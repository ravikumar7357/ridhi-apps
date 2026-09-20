/* WHAT THE HISTORY ACTUALLY SAYS A PRINTER CAN DO IN A MONTH. Read-only.
 *
 * Capacity is typed today (6,000 / 280 / 7,000) and the allocation hands every group to whoever
 * scores highest, which is why all three printers came back at 100% on CPC Green. Ravi wants the
 * capacity worked out from what they have really delivered, with him entering only the table count.
 * This asks whether the delivery log can carry that: how many months each printer has, how steady
 * they are, and whether a printer on the list can even be tied to a vendor in the log.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const N = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
  const H = t => console.log('\n== ' + t + ' ==');
  /* Deliveries carry day-first dates; the order book carries ISO. Both shapes, one reader. */
  const ym = v => {
    const s = String(v == null ? '' : v).trim();
    let m = s.match(/^(\d{4})-(\d{2})/); if (m) return m[1] + '-' + m[2];
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    return m ? m[3] + '-' + String(m[2]).padStart(2, '0') : '';
  };

  const [voR, prR, mastersR] = await Promise.all(['pt_vendorOrders', 'pt_printers', 'pt_masters'].map(get));
  const printers = Object.entries(prR || {}).map(([key, v]) => Object.assign({ key }, v));
  const vendors = Object.entries((mastersR || {}).vendor || {}).map(([k, v]) => Object.assign({ _key: k }, v));

  H('1. THE PRINTER LIST AS IT STANDS');
  console.log('printers on the allocation list: ' + printers.length);
  printers.forEach(p => console.log('   ' + String(p.name || p.key).padEnd(28)
    + 'tables ' + String(N(p.tables)).padStart(4) + '   typed capacity ' + String(N(p.pcsMonth)).padStart(7)
    + (p.active === false ? '   (not taking work)' : '')
    + '   groups: ' + (Array.isArray(p.groups) ? p.groups.join(' / ') : '(none stored)')));

  H('2. CAN A PRINTER BE TIED TO A VENDOR IN THE LOG?');
  const byCode = {};
  vendors.forEach(v => { if (v.code) byCode[String(v.code).toUpperCase()] = String(v.name || v.code); });
  console.log('vendors on the master: ' + vendors.length);
  const norm = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  printers.forEach(p => {
    const hit = Object.entries(byCode).find(([, nm]) => norm(nm) === norm(p.name));
    console.log('   ' + String(p.name || p.key).padEnd(28)
      + (p.vendorCode ? 'linked: ' + p.vendorCode : (hit ? 'matches ' + hit[0] + ' by name' : 'NO MATCH — would need linking')));
  });

  H('3. WHAT THEY HAVE ACTUALLY DELIVERED, MONTH BY MONTH');
  /* Every accepted delivery on every vendor order, by the vendor it came from. */
  const per = {};   // code -> { 'YYYY-MM': pieces }
  let dels = 0, dated = 0;
  Object.entries(voR || {}).forEach(([code, orders]) => Object.values(orders || {}).forEach(o => {
    if (!o) return;
    const lines = Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {});
    lines.forEach(l => {
      if (!l) return;
      (Array.isArray(l.deliveries) ? l.deliveries : Object.values(l.deliveries || {})).forEach(d => {
        if (!d) return;
        dels++;
        const q = N(d.qty);
        if (!(q > 0)) return;
        const k = ym(d.at || d.date || d.on);
        if (!k) return;
        dated++;
        per[code] = per[code] || {};
        per[code][k] = (per[code][k] || 0) + q;
      });
    });
  }));
  console.log('deliveries on record: ' + dels + '   of which dated and positive: ' + dated);
  Object.entries(per).sort().forEach(([code, months]) => {
    const ks = Object.keys(months).sort();
    const vals = ks.map(k => months[k]);
    const tot = vals.reduce((a, b) => a + b, 0);
    const avg = Math.round(tot / (ks.length || 1));
    const best = Math.max(...vals);
    console.log('   ' + code.padEnd(10) + String(ks.length).padStart(2) + ' month(s)  '
      + 'total ' + String(tot).padStart(7) + '  average/month ' + String(avg).padStart(6)
      + '  best month ' + String(best).padStart(6) + '   ' + ks.map(k => k.slice(2) + ':' + months[k]).join(' '));
  });

  H('4. SO WHAT WOULD A CAPACITY LOOK LIKE?');
  console.log('A capacity worked out from history needs enough months to be a figure rather than a guess.');
  const enough = Object.entries(per).filter(([, m]) => Object.keys(m).length >= 2).length;
  console.log('vendors with 2+ months on record : ' + enough + ' of ' + Object.keys(per).length);
  console.log('vendors with only 1 month        : ' + Object.entries(per).filter(([, m]) => Object.keys(m).length === 1).length);
  console.log('\nAnd pieces per table per month, where both are known:');
  printers.forEach(p => {
    const code = p.vendorCode || (Object.entries(byCode).find(([, nm]) => norm(nm) === norm(p.name)) || [])[0];
    const months = code ? per[code] : null;
    if (!months || !N(p.tables)) { console.log('   ' + String(p.name || p.key).padEnd(28) + 'cannot be worked out'); return; }
    const ks = Object.keys(months);
    const avg = ks.reduce((a, k) => a + months[k], 0) / ks.length;
    console.log('   ' + String(p.name || p.key).padEnd(28) + Math.round(avg) + ' a month over ' + ks.length
      + ' month(s) on ' + N(p.tables) + ' table(s) = ' + Math.round(avg / N(p.tables)) + ' per table');
  });
})().catch(e => { console.error('FAILED: ' + (e.message || e)); process.exit(1); });
