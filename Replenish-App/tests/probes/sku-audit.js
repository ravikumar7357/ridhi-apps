/* SHOPIFY SKU AUDIT (read-only).
 *
 * Ravi, 2026-09-28: "shopify me SKU check karke batao konse SKU galat dale hue hain, ya product hai
 * but SKU nahi hai — Amazon aur masterdata ke SKU final hain — aur jaise Amazon me RTC-621-6060 hai
 * but Shopify par RTC621-6060, usko bhi correction ke saath batao."
 *
 * Reads, and writes nothing anywhere:
 *   Shopify   — Pricing-API ?shopify=skus&shop=SP|CPC (every product + variant, blank SKUs included)
 *   master    — RTDB pt_masterDB
 *   Amazon    — RTDB pt_amzListings (the full merchant listings report)
 *   custom    — RTDB pt_customSkus (codes the Shopify sync added on its own; NOT authority)
 *
 * Each Shopify variant lands in exactly one class:
 *   ok        the SKU is in the master or on Amazon, spelled the same way
 *   nosku     no SKU at all on the variant
 *   respell   the same code exists officially, written differently (RTC621-6060 → RTC-621-6060)
 *   packbase  SKU is <base>-<n> and the BASE is official, but this pack size is not
 *   nearmiss  one character out from an official SKU (edit distance 1 on the letters+digits)
 *   unknown   nothing official resembles it
 * Duplicates (one SKU on two variants of a store) are listed separately — a variant can be both.
 *
 * Output: tests/sku-audit/*.csv + audit.json, and a summary on the console.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const FS_ = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
const OUT = pathm.join(__dirname, '..', 'sku-audit');

const U = s => String(s == null ? '' : s).trim().toUpperCase();
const N = s => U(s).replace(/[^A-Z0-9]/g, '');
const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const write = (name, head, rows) => {
  fs.writeFileSync(pathm.join(OUT, name), '\uFEFF' + [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n'));
  return rows.length;
};
/** Edit distance, but it stops as soon as it passes `max` — the whole catalogue is walked per SKU. */
function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tk = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []);
  const at = tk.access_token || tk;
  /* Apps Script answers a web-app call with a 302 to googleusercontent — node does not follow it on its own. */
  const getJson = (u, hdr, hops) => new Promise((res, rej) => https.get(u, { headers: hdr || {}, timeout: 120000 }, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
      if ((hops || 0) > 5) return rej(new Error('too many redirects'));
      r.resume(); return getJson(r.headers.location, hdr, (hops || 0) + 1).then(res, rej);
    }
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('HTTP ' + r.statusCode + ' not json: ' + d.slice(0, 100).replace(/\s+/g, ' '))); } });
  }).on('timeout', function () { this.destroy(new Error('timeout')); }).on('error', rej));
  const fsVal = v => v == null ? null : ('stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : null);

  /* The backend address and key stay in memory — they are never written out or printed. */
  const apiDoc = await getJson(FS_ + 'config/api', { Authorization: 'Bearer ' + at });
  const api = { url: fsVal((apiDoc.fields || {}).url), key: fsVal((apiDoc.fields || {}).key) };
  if (!api.url) throw new Error('config/api has no url');

  /* ---- Shopify, both stores ---- */
  const shopRows = { SP: [], CPC: [] };
  for (const shop of ['SP', 'CPC']) {
    let page = '', guard = 0;
    do {
      const u = new URL(api.url);
      u.searchParams.set('key', api.key); u.searchParams.set('shopify', 'skus'); u.searchParams.set('shop', shop);
      if (page) u.searchParams.set('page', page);
      let d = null;
      for (let a = 0; a < 6 && !d; a++) {
        try { const got = await getJson(u.toString()); if (got && got.ok) d = got; } catch (e) { await new Promise(r => setTimeout(r, 3000)); }
      }
      if (!d) throw new Error(shop + ': Google lost the answer six times running');
      shopRows[shop] = shopRows[shop].concat(d.rows);
      page = d.next || '';
      process.stdout.write(`${shop} ${shopRows[shop].length} variants\r`);
    } while (page && ++guard < 40);
  }
  console.log('Shopify: SP ' + shopRows.SP.length + ' variants, CPC ' + shopRows.CPC.length + '        ');

  /* ---- the official lists ---- */
  const arr = o => !o ? [] : (Array.isArray(o) ? o.filter(Boolean) : Object.values(o).filter(Boolean));
  const [mdbRaw, amz, custRaw] = await Promise.all(['pt_masterDB', 'pt_amzListings', 'pt_customSkus']
    .map(n => getJson(DB + '/' + n + '.json?access_token=' + at)));   // an OAuth token goes in access_token; auth= is for an ID token or the DB secret
  const mdb = arr(mdbRaw), cust = new Set(arr(custRaw).map(r => U(r.sku)));
  const master = new Map(mdb.map(r => [U(r.sku), r]));
  const amzMap = new Map();
  String((amz && amz.list) || '').split('\n').filter(Boolean).forEach(l => {
    const [s, st] = l.split('\t'); const u = U(s); if (!u) return;
    const e = amzMap.get(u) || { st: new Set() }; e.st.add(st); amzMap.set(u, e);
  });
  const official = new Map();                       // SKU -> where it is official
  master.forEach((v, k) => official.set(k, ['master']));
  amzMap.forEach((v, k) => official.set(k, (official.get(k) || []).concat('amazon')));
  const byNorm = new Map();                         // letters+digits -> official spellings
  official.forEach((where, sku) => { const n = N(sku); (byNorm.get(n) || byNorm.set(n, []).get(n)).push(sku); });
  const officialNorms = [...byNorm.keys()];
  const what = sku => { const m = master.get(sku); return m ? [m.articleType, m.subtype, m.color, m.size].filter(Boolean).join(' · ') : ''; };

  /* ---- Amazon against the master: the two "final" lists disagreeing with each other ---- */
  const clash = [];
  amzMap.forEach((v, a) => {
    if (master.has(a)) return;
    (byNorm.get(N(a)) || []).filter(s => master.has(s)).forEach(m => clash.push([a, [...v.st].join('/'), m, what(m)]));
  });

  /* ---- every Shopify variant ---- */
  const cls = { ok: 0, nosku: [], respell: [], packbase: [], nearmiss: [], unknown: [], dup: [] };
  const per = { SP: { v: 0, p: new Set() }, CPC: { v: 0, p: new Set() } };
  const seen = new Map();
  for (const shop of ['SP', 'CPC']) {
    for (const r of shopRows[shop]) {
      const [pid, prod, status, handle, type, vid, vtitle, sku0, stock] = r;
      const sku = U(sku0);
      per[shop].v++; per[shop].p.add(pid);
      const base = [shop, prod, vtitle === 'Default Title' ? '' : vtitle, status, stock, 'https://admin.shopify.com/store/' + (shop === 'SP' ? 'ridhiblockprint' : 'liquidationfashion') + '/products/' + pid];
      if (!sku) { cls.nosku.push(base); continue; }
      const key = shop + '|' + sku;
      if (seen.has(key)) cls.dup.push([shop, sku, prod + (vtitle && vtitle !== 'Default Title' ? ' / ' + vtitle : ''), seen.get(key), status]);
      else seen.set(key, prod + (vtitle && vtitle !== 'Default Title' ? ' / ' + vtitle : ''));
      if (official.has(sku)) { cls.ok++; continue; }
      const same = byNorm.get(N(sku)) || [];
      if (same.length) {
        const pick = same.find(s => master.has(s)) || same[0];
        cls.respell.push([shop, sku, pick, (official.get(pick) || []).join('+'), what(pick), prod, vtitle === 'Default Title' ? '' : vtitle, status]);
        continue;
      }
      const m = sku.match(/^(.*?)-(\d{1,3})$/);
      if (m && (official.has(U(m[1])) || (byNorm.get(N(m[1])) || []).length)) {
        const off = official.has(U(m[1])) ? U(m[1]) : (byNorm.get(N(m[1])) || [])[0];
        cls.packbase.push([shop, sku, off, m[2], what(off), prod, vtitle === 'Default Title' ? '' : vtitle, status]);
        continue;
      }
      const n = N(sku);
      const near = officialNorms.filter(o => within(o, n, 1)).flatMap(o => byNorm.get(o)).slice(0, 3);
      if (near.length) { cls.nearmiss.push([shop, sku, near.join(' / '), what(near[0]), prod, vtitle === 'Default Title' ? '' : vtitle, status]); continue; }
      cls.unknown.push([shop, sku, cust.has(sku) ? 'on the Custom SKUs list' : '', prod, vtitle === 'Default Title' ? '' : vtitle, status, stock]);
    }
  }

  /* ---- files ---- */
  const n1 = write('1-no-sku.csv', ['Shop', 'Product', 'Variant', 'Status', 'Stock', 'Admin link'], cls.nosku);
  const n2 = write('2-wrong-spelling.csv', ['Shop', 'Shopify SKU', 'Correct SKU', 'Official in', 'What it is', 'Product', 'Variant', 'Status'], cls.respell);
  const n3 = write('3-pack-size-not-in-master.csv', ['Shop', 'Shopify SKU', 'Base SKU (official)', 'Pack size', 'What the base is', 'Product', 'Variant', 'Status'], cls.packbase);
  const n4 = write('4-near-miss.csv', ['Shop', 'Shopify SKU', 'Closest official SKU(s)', 'What it is', 'Product', 'Variant', 'Status'], cls.nearmiss);
  const n5 = write('5-unknown.csv', ['Shop', 'Shopify SKU', 'Note', 'Product', 'Variant', 'Status', 'Stock'], cls.unknown);
  const n6 = write('6-duplicate-sku.csv', ['Shop', 'SKU', 'Also on this product', 'First seen on', 'Status'], cls.dup);
  const n7 = write('7-amazon-vs-master.csv', ['Amazon SKU', 'Amazon status', 'Master SKU', 'What it is'], clash);
  fs.writeFileSync(pathm.join(OUT, 'audit.json'), JSON.stringify({
    at: new Date().toISOString(), master: master.size, amazon: amzMap.size, custom: cust.size,
    shopify: { SP: { variants: per.SP.v, products: per.SP.p.size }, CPC: { variants: per.CPC.v, products: per.CPC.p.size } },
    counts: { ok: cls.ok, nosku: n1, respell: n2, packbase: n3, nearmiss: n4, unknown: n5, duplicate: n6, amazonVsMaster: n7 },
  }, null, 1));

  console.log('master ' + master.size + ' · Amazon ' + amzMap.size + ' · custom list ' + cust.size);
  console.log('variants ' + (per.SP.v + per.CPC.v) + ' over ' + (per.SP.p.size + per.CPC.p.size) + ' products');
  console.log('  ok (SKU is official)      ' + cls.ok);
  console.log('  no SKU at all             ' + n1);
  console.log('  wrong spelling            ' + n2);
  console.log('  pack size not in master   ' + n3);
  console.log('  one character out         ' + n4);
  console.log('  unknown code              ' + n5);
  console.log('  duplicate SKU in a store  ' + n6);
  console.log('  Amazon vs master clashes  ' + n7);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
