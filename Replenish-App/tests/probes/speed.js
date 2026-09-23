/* WHERE THE WAITING ACTUALLY GOES — read-only, and timed.
 *
 *   node speed.js
 *
 * Ravi, 2026-09-23: "replenish tab ko google sheet se data ready krne me bahut time lag rha h · ab
 * india stock isi app me h to read krne me itna time kyo lag rha h".
 *
 * Every one of these is a call the app itself makes when a tab is opened. Timed here so the answer
 * is a number rather than an opinion: the Apps Script that reads a workbook, the Firestore snapshot
 * that is already built, and the row chunks under it.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const PROJ = 'price-research-48ff3';
const get = (u, h) => new Promise((res, rej) => https.get(u, { headers: h || {} }, r => {
  if (r.statusCode >= 300 && r.headers.location) return res(get(r.headers.location, h));
  let n = 0; const d = [];
  r.on('data', c => { n += c.length; d.push(c); });
  r.on('end', () => res({ status: r.statusCode, bytes: n, text: Buffer.concat(d).toString('utf8') }));
}).on('error', rej));
const ms = t => (Date.now() - t) + ' ms';
const kb = n => (n / 1024).toFixed(0) + ' KB';

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const FS = 'https://firestore.googleapis.com/v1/projects/' + PROJ + '/databases/(default)/documents/';
  const H = { Authorization: 'Bearer ' + at };

  const cfgDoc = JSON.parse((await get(FS + 'config/api', H)).text).fields || {};
  const replDoc = JSON.parse((await get(FS + 'config/replapi', H)).text).fields || {};
  const pr = { url: (cfgDoc.url || {}).stringValue || '', key: (cfgDoc.key || {}).stringValue || '' };
  const rp = { url: (replDoc.url || {}).stringValue || '', key: (replDoc.key || {}).stringValue || '' };

  const ask = async (label, base, params) => {
    const u = new URL(base.url);
    u.searchParams.set('key', base.key);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    const t = Date.now();
    try {
      const r = await get(u.toString());
      let note = '';
      try {
        const d = JSON.parse(r.text);
        note = d.ok === false ? 'REFUSED: ' + (d.error || '') : Object.keys(d).slice(0, 6).join(', ');
        if (d.d) note += ' · ' + Object.keys(d.d).length + ' SKU(s)';
        if (d.rows) note += ' · ' + d.rows.length + ' row(s)';
      } catch (e) { note = 'not JSON (' + r.status + ')'; }
      console.log('  ' + label.padEnd(34), ms(t).padStart(9), kb(r.bytes).padStart(9), ' ', note);
    } catch (e) { console.log('  ' + label.padEnd(34), ms(t).padStart(9), '      —   FAILED: ' + e.message); }
  };

  console.log('THE APPS SCRIPT CALLS — these read a Google workbook line by line, which is why they are slow');
  await ask('India stock (india=stock)', pr, { india: 'stock' });
  await ask('Amazon stock (stock=all)', pr, { stock: 'all' });

  console.log('\nTHE REPLENISHMENT SNAPSHOT — already built, read straight out of Firestore');
  for (const brand of ['SP', 'CPC']) {
    let t = Date.now();
    const meta = await get(FS + 'repl/' + brand, H);
    let n = 0;
    try { const f = JSON.parse(meta.text).fields || {}; n = Number((f.chunks || {}).integerValue || 0); } catch (e) {}
    console.log('  meta repl/' + brand.padEnd(26), ms(t).padStart(9), kb(meta.bytes).padStart(9), ' ' + n + ' chunk(s)');
    if (n) {
      t = Date.now();
      let bytes = 0;
      for (let i = 0; i < n; i++) {
        const c = await get(FS + 'repl/' + brand + '_' + i, H);
        bytes += c.bytes;
      }
      console.log('  its ' + n + ' chunks, one after another'.padEnd(30), ms(t).padStart(9), kb(bytes).padStart(9));
    }
  }

  console.log('\nTHE SAME CHUNKS ASKED FOR AT ONCE (what the app could do instead)');
  for (const brand of ['SP', 'CPC']) {
    const meta = await get(FS + 'repl/' + brand, H);
    let n = 0;
    try { const f = JSON.parse(meta.text).fields || {}; n = Number((f.chunks || {}).integerValue || 0); } catch (e) {}
    if (!n) continue;
    const t = Date.now();
    const all = await Promise.all(Array.from({ length: n }, (_, i) => get(FS + 'repl/' + brand + '_' + i, H)));
    console.log('  ' + brand + ': ' + n + ' chunks together'.padEnd(30), ms(t).padStart(9), kb(all.reduce((a, r) => a + r.bytes, 0)).padStart(9));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
