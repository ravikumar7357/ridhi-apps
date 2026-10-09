/* SHOPIFY SKU AUDIT, second pass — read-only.
 *
 * The first pass matched on letters+digits and on edit distance. Edit distance alone proposed
 * RTC626-60120 → RTC-627-60120: a different COLOUR, one digit away. A wrong code confidently offered
 * is worse than none, so this pass reads a SKU the way the codes are actually built:
 *
 *      RTC 626 - 60120      prefix · colour code · size
 *
 * and a suggestion is only made when the prefix AND the colour code are the same. Then:
 *   respell   the same colour and the same size exist officially, spelled differently → the correct SKU
 *   newsize   that colour exists officially, this size does not → a SKU to add to the master
 *   packsize  <base>-<n> where the base is official → a pack size the master does not carry
 *   newcolour the prefix exists but this colour code does not
 *   unknown   nothing official shares even the prefix
 *   nosku     the variant carries no code at all
 *
 * The size in the SKU is also checked against the size in the Shopify variant title where there is
 * one, so "60120" on a variant called 120" x 60" is read as agreeing.
 *
 * Reads Shopify through Pricing-API ?shopify=skus (cached in tests/sku-audit/shopify-raw.json — pass
 * "fresh" to re-pull), the master from pt_masterDB and Amazon from pt_amzListings. Writes nothing
 * anywhere but the audit files.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const FS_ = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
const OUT = pathm.join(__dirname, '..', 'sku-audit');
const FRESH = process.argv.includes('fresh');

const U = s => String(s == null ? '' : s).trim().toUpperCase();
const N = s => U(s).replace(/[^A-Z0-9]/g, '');
const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const write = (name, head, rows) => {
  fs.writeFileSync(pathm.join(OUT, name), '\uFEFF' + [head].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n'));
  return rows.length;
};

/** A code taken apart: prefix letters, the colour digits, and whatever follows. */
function parts(sku) {
  /* On the RAW code, separators and all: normalising first read RTC626-5270 as colour "6265270". */
  const s = U(sku);
  const m = s.match(/^([A-Z]+)[-_ ]?(\d+)(.*)$/);
  if (!m) return { prefix: s, colour: '', tail: '', ok: false };
  return { prefix: m[1], colour: m[2], tail: m[3], ok: true };
}
/** The sizes a string mentions, as a set of "AxB" with the smaller number first: 70" x 52" → 52X70. */
function sizesIn(text) {
  const out = new Set();
  const t = String(text || '').replace(/[”″]/g, '"');
  const re = /(\d{1,3})\s*(?:in|inch|inches|cm|")?\s*[xX×]\s*(\d{1,3})/g;
  let m;
  while ((m = re.exec(t))) { const a = +m[1], b = +m[2]; out.add(Math.min(a, b) + 'X' + Math.max(a, b)); }
  return out;
}
/** The size hidden in a code's tail: 60120 → 60X120, 5272 → 52X72, 2020 → 20X20. */
function sizeOfTail(tail) {
  const t = String(tail || '').replace(/^[^0-9]*/, '');
  const out = new Set();
  if (!/^\d+$/.test(t)) return out;
  if (t.length === 4) { const a = +t.slice(0, 2), b = +t.slice(2); out.add(Math.min(a, b) + 'X' + Math.max(a, b)); }
  if (t.length === 5) {
    [[2, 3], [3, 2]].forEach(([i]) => { const a = +t.slice(0, i), b = +t.slice(i); if (a && b) out.add(Math.min(a, b) + 'X' + Math.max(a, b)); });
  }
  if (t.length === 6) { const a = +t.slice(0, 3), b = +t.slice(3); out.add(Math.min(a, b) + 'X' + Math.max(a, b)); }
  return out;
}
const sizeOfMaster = m => sizesIn(String((m && m.size) || '').replace(/[^0-9xX×]/g, ' '));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tk = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []);
  const at = tk.access_token || tk;
  const getJson = (u, hdr, hops) => new Promise((res, rej) => https.get(u, { headers: hdr || {}, timeout: 120000 }, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
      if ((hops || 0) > 5) return rej(new Error('too many redirects'));
      r.resume(); return getJson(r.headers.location, hdr, (hops || 0) + 1).then(res, rej);
    }
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('HTTP ' + r.statusCode + ': ' + d.slice(0, 90).replace(/\s+/g, ' '))); } });
  }).on('timeout', function () { this.destroy(new Error('timeout')); }).on('error', rej));
  const fsVal = v => v == null ? null : ('stringValue' in v ? v.stringValue : null);

  /* ---- Shopify ---- */
  const cache = pathm.join(OUT, 'shopify-raw.json');
  let shopRows;
  if (!FRESH && fs.existsSync(cache)) { shopRows = JSON.parse(fs.readFileSync(cache, 'utf8')); console.log('Shopify: from cache ' + pathm.basename(cache)); }
  else {
    const apiDoc = await getJson(FS_ + 'config/api', { Authorization: 'Bearer ' + at });
    const api = { url: fsVal((apiDoc.fields || {}).url), key: fsVal((apiDoc.fields || {}).key) };
    shopRows = { SP: [], CPC: [] };
    for (const shop of ['SP', 'CPC']) {
      let page = '', guard = 0;
      do {
        const u = new URL(api.url);
        u.searchParams.set('key', api.key); u.searchParams.set('shopify', 'skus'); u.searchParams.set('shop', shop);
        if (page) u.searchParams.set('page', page);
        let d = null;
        for (let a = 0; a < 6 && !d; a++) { try { const g = await getJson(u.toString()); if (g && g.ok) d = g; } catch (e) { await new Promise(r => setTimeout(r, 3000)); } }
        if (!d) throw new Error(shop + ': Google lost the answer six times running');
        shopRows[shop] = shopRows[shop].concat(d.rows); page = d.next || '';
      } while (page && ++guard < 40);
    }
    fs.writeFileSync(cache, JSON.stringify(shopRows));
    console.log('Shopify: pulled fresh');
  }

  /* ---- the official lists ---- */
  const arr = o => !o ? [] : (Array.isArray(o) ? o.filter(Boolean) : Object.values(o).filter(Boolean));
  const [mdbRaw, amz, custRaw] = await Promise.all(['pt_masterDB', 'pt_amzListings', 'pt_customSkus']
    .map(n => getJson(DB + '/' + n + '.json?access_token=' + at)));
  const mdb = arr(mdbRaw), cust = new Set(arr(custRaw).map(r => U(r.sku)));
  const master = new Map(mdb.map(r => [U(r.sku), r]));
  const amzMap = new Map();
  String((amz && amz.list) || '').split('\n').filter(Boolean).forEach(l => {
    const [s, st] = l.split('\t'); const u = U(s); if (!u) return;
    const e = amzMap.get(u) || { st: new Set() }; e.st.add(st); amzMap.set(u, e);
  });
  const official = new Map();
  master.forEach((v, k) => official.set(k, ['master']));
  amzMap.forEach((v, k) => official.set(k, (official.get(k) || []).concat('amazon')));

  const byNorm = new Map();                 // letters+digits → official spellings
  const byFamily = new Map();               // prefix|colour → [{sku, size(Set), master}]
  const prefixes = new Set();
  official.forEach((where, sku) => {
    (byNorm.get(N(sku)) || byNorm.set(N(sku), []).get(N(sku))).push(sku);
    const p = parts(sku); prefixes.add(p.prefix);
    if (!p.ok) return;
    const key = p.prefix + '|' + p.colour;
    const m = master.get(sku);
    (byFamily.get(key) || byFamily.set(key, []).get(key)).push({ sku, size: m ? sizeOfMaster(m) : sizeOfTail(p.tail), tail: p.tail, master: !!m, what: m ? [m.articleType, m.subtype, m.color, m.size].filter(Boolean).join(' · ') : '' });
  });
  const what = sku => { const m = master.get(sku); return m ? [m.articleType, m.subtype, m.color, m.size].filter(Boolean).join(' · ') : ''; };
  const colourName = key => { const f = (byFamily.get(key) || []).find(x => x.master); return f ? (master.get(f.sku) || {}).color || '' : ''; };

  /* ---- classify ---- */
  const cls = { ok: 0, nosku: [], respell: [], newsize: [], packsize: [], newcolour: [], unknown: [], dup: [] };
  const per = { SP: { v: 0, p: new Set() }, CPC: { v: 0, p: new Set() } };
  const seen = new Map();
  const adminBase = shop => 'https://admin.shopify.com/store/' + (shop === 'SP' ? 'ridhiblockprint' : 'liquidationfashion') + '/products/';
  for (const shop of ['SP', 'CPC']) {
    for (const r of shopRows[shop]) {
      const [pid, prod, status, handle, type, vid, vtitle, sku0, stock] = r;
      const sku = U(sku0), variant = vtitle === 'Default Title' ? '' : vtitle;
      per[shop].v++; per[shop].p.add(pid);
      if (!sku) { cls.nosku.push([shop, prod, variant, status, stock, adminBase(shop) + pid]); continue; }
      const key = shop + '|' + sku;
      if (seen.has(key)) cls.dup.push([shop, sku, prod + (variant ? ' / ' + variant : ''), seen.get(key), status]);
      else seen.set(key, prod + (variant ? ' / ' + variant : ''));
      if (official.has(sku)) { cls.ok++; continue; }

      /* PACK SIZES FIRST. A napkin's "-8" is "set of 8", not a misspelling: RCNE119-8 must never be
       * offered as RCNE119, nor RCNB9-4 as RCNB9-8. The variant title is what says it is a pack, and
       * the pack number is compared as a NUMBER, because the master writes 8 as both "8" and "08". */
      const packTitle = (variant + ' ' + prod).match(/(?:set|pack)\s*of\s*(\d+)/i);
      const tailNum = sku.match(/^(.*?)-0*(\d{1,3})$/);
      if (packTitle && tailNum && Number(tailNum[2]) === Number(packTitle[1])) {
        const pbase = U(tailNum[1]), pn = Number(packTitle[1]);
        /* The same base and the same pack, written differently — RCNE07-8 against the master's RCNE07-08. */
        const twin = [...official.keys()].filter(o => { const t = o.match(/^(.*?)-0*(\d{1,3})$/); return t && U(t[1]) === pbase && Number(t[2]) === pn; });
        if (twin.length) {
          const pick = twin.find(s2 => master.has(s2)) || twin[0];
          if (pick !== sku) { cls.respell.push([shop, sku, pick, (official.get(pick) || []).join('+'), what(pick), prod, variant, status, stock]); continue; }
        }
        if (official.has(pbase)) { cls.packsize.push([shop, sku, pbase, String(pn), what(pbase), prod, variant, status, stock]); continue; }
        const pfam = byFamily.get(parts(pbase).prefix + '|' + parts(pbase).colour) || [];
        if (pfam.length) { cls.packsize.push([shop, sku, pfam.filter(f => f.master).map(f => f.sku).slice(0, 3).join(' / ') || pbase, String(pn), what(pbase), prod, variant, status, stock]); continue; }
        cls.newcolour.push([shop, sku, parts(pbase).prefix, parts(pbase).colour, prod, variant, status, stock, cust.has(sku) ? 'on the Custom SKUs list' : '']);
        continue;
      }
      const same = byNorm.get(N(sku)) || [];
      if (same.length) {
        const pick = same.find(s => master.has(s)) || same[0];
        cls.respell.push([shop, sku, pick, (official.get(pick) || []).join('+'), what(pick), prod, variant, status, stock]);
        continue;
      }
      const p = parts(sku);
      const fam = byFamily.get(p.prefix + '|' + p.colour) || [];
      const want = new Set([...sizeOfTail(p.tail), ...sizesIn(variant), ...sizesIn(prod)]);
      if (fam.length) {
        /* Same colour: is one of its official SKUs this very size, written differently? */
        const hit = fam.filter(f => [...f.size].some(s => want.has(s)));
        if (hit.length) {
          const pick = (hit.find(f => f.master) || hit[0]);
          cls.respell.push([shop, sku, pick.sku, (official.get(pick.sku) || []).join('+'), pick.what || what(pick.sku), prod, variant, status, stock]);
          continue;
        }
        const packM = sku.match(/^(.*?)-(\d{1,3})$/);
        if (packM && official.has(U(packM[1]))) {
          cls.packsize.push([shop, sku, U(packM[1]), packM[2], what(U(packM[1])), prod, variant, status, stock]);
          continue;
        }
        const shown = sizesIn(variant).size ? [...sizesIn(variant)] : [...sizeOfTail(p.tail)];
        cls.newsize.push([shop, sku, colourName(p.prefix + '|' + p.colour), shown.join(' / ') || '(no size read)',
          fam.filter(f => f.master).slice(0, 4).map(f => f.sku).join(' / '), prod, variant, status, stock]);
        continue;
      }
      const packM = sku.match(/^(.*?)-(\d{1,3})$/);
      if (packM && official.has(U(packM[1]))) {
        cls.packsize.push([shop, sku, U(packM[1]), packM[2], what(U(packM[1])), prod, variant, status, stock]);
        continue;
      }
      if (prefixes.has(p.prefix) && p.colour) {
        cls.newcolour.push([shop, sku, p.prefix, p.colour, prod, variant, status, stock, cust.has(sku) ? 'on the Custom SKUs list' : '']);
        continue;
      }
      cls.unknown.push([shop, sku, prod, variant, status, stock, cust.has(sku) ? 'on the Custom SKUs list' : '']);
    }
  }

  /* ---- Amazon against the master ---- */
  const clash = [];
  amzMap.forEach((v, a) => {
    if (master.has(a)) return;
    (byNorm.get(N(a)) || []).filter(s => master.has(s)).forEach(m => clash.push([a, [...v.st].join('/'), m, what(m)]));
  });

  const n = {};
  /* A codeless variant whose SIBLINGS on the same product are coded can be named with confidence:
   * the siblings share a base and differ by pack size, and this variant's title says which pack it is.
   * It is offered as a suggestion, never as a fact — nothing here writes to Shopify. */
  const byProduct = new Map();
  ['SP', 'CPC'].forEach(shop => shopRows[shop].forEach(r => {
    const k = shop + '|' + r[0];
    (byProduct.get(k) || byProduct.set(k, []).get(k)).push(r);
  }));
  cls.nosku = cls.nosku.map(row => {
    const [shop, prod, variant] = row;
    const sibs = [...byProduct.values()].find(list => list[0] && String(list[0][1]) === String(prod));
    let guess = '';
    const packOf = t => { const m = String(t || '').match(/(?:set|pack)\s*of\s*(\d+)/i); return m ? Number(m[1]) : null; };
    /* The variant title without its pack phrase: "Square - 15 in / Pack of 8" → "SQUARE - 15 IN".
     * A product sold as square AND rectangle has two code bases, and only the matching shape may
     * lend its base. */
    const shapeOf = t => U(String(t || '').replace(/(?:set|pack)\s*of\s*\d+/ig, '').replace(/[\/|,]+\s*$/, '').trim());
    if (sibs) {
      const coded = sibs.filter(x => U(x[7]));
      const mine = packOf(variant), myShape = shapeOf(variant);
      const bases = new Set(coded.filter(x => shapeOf(x[6]) === myShape)
        .map(x => { const m = U(x[7]).match(/^(.*?)-0*(\d{1,3})$/); return m && packOf(x[6]) === Number(m[2]) ? m[1] : null; }).filter(Boolean));
      if (mine && bases.size === 1) guess = [...bases][0] + '-' + mine;
      else if (!mine && coded.length === 1 && sibs.length === 1) guess = U(coded[0][7]);
    }
    const others = sibs ? [...new Set(sibs.map(x => U(x[7])).filter(Boolean))].slice(0, 4).join(' / ') : '';
    return row.slice(0, 5).concat([guess, guess ? 'pattern of the other variants on this product' : (others ? '' : 'no variant of this product has a code'), others, row[5]]);
  });
  /* A product sold in two shapes (15" square AND 13x19 rectangle) gives the same pack number twice,
   * and the shape is not in the code — so a suggestion that would land on two variants is dropped
   * rather than guessed between. */
  {
    const count = new Map();
    cls.nosku.forEach(r => { if (r[5]) count.set(r[0] + '|' + r[5], (count.get(r[0] + '|' + r[5]) || 0) + 1); });
    cls.nosku.forEach(r => { if (r[5] && (count.get(r[0] + '|' + r[5]) > 1 || official.has(U(r[5])) === false && seen.has(r[0] + '|' + U(r[5])))) { r[6] = 'more than one variant would take this code — decide by hand'; r[5] = ''; } });
  }
  n.nosku = write('1-no-sku.csv', ['Shop', 'Product', 'Variant', 'Status', 'Stock', 'Suggested SKU', 'Why', 'Other SKUs on this product', 'Admin link'], cls.nosku);
  n.respell = write('2-wrong-spelling.csv', ['Shop', 'Shopify SKU', 'Correct SKU', 'Official in', 'What it is', 'Product', 'Variant', 'Status', 'Stock'], cls.respell);
  n.newsize = write('3-size-missing-from-master.csv', ['Shop', 'Shopify SKU', 'Colour', 'Size on Shopify', 'Official SKUs of that colour', 'Product', 'Variant', 'Status', 'Stock'], cls.newsize);
  n.packsize = write('4-pack-size-not-in-master.csv', ['Shop', 'Shopify SKU', 'Base SKU (official)', 'Pack size', 'What the base is', 'Product', 'Variant', 'Status', 'Stock'], cls.packsize);
  n.newcolour = write('5-colour-code-not-in-master.csv', ['Shop', 'Shopify SKU', 'Prefix', 'Colour code', 'Product', 'Variant', 'Status', 'Stock', 'Note'], cls.newcolour);
  n.unknown = write('6-unknown-code.csv', ['Shop', 'Shopify SKU', 'Product', 'Variant', 'Status', 'Stock', 'Note'], cls.unknown);
  n.dup = write('7-duplicate-sku.csv', ['Shop', 'SKU', 'Also on this product', 'First seen on', 'Status'], cls.dup);
  n.clash = write('8-amazon-vs-master.csv', ['Amazon SKU', 'Amazon status', 'Master SKU', 'What it is'], clash);
  fs.writeFileSync(pathm.join(OUT, 'audit.json'), JSON.stringify({ at: new Date().toISOString(),
    master: master.size, amazon: amzMap.size, custom: cust.size,
    shopify: { SP: { variants: per.SP.v, products: per.SP.p.size }, CPC: { variants: per.CPC.v, products: per.CPC.p.size } },
    counts: Object.assign({ ok: cls.ok }, n) }, null, 1));

  console.log('master ' + master.size + ' · Amazon ' + amzMap.size);
  console.log('variants ' + (per.SP.v + per.CPC.v) + ' over ' + (per.SP.p.size + per.CPC.p.size) + ' products'
    + '  (Ridhi ' + per.SP.v + '/' + per.SP.p.size + ', CPC ' + per.CPC.v + '/' + per.CPC.p.size + ')');
  console.log('  SKU is official            ' + cls.ok);
  console.log('  no SKU at all              ' + n.nosku);
  console.log('  wrong spelling (fixable)   ' + n.respell);
  console.log('  size missing from master   ' + n.newsize);
  console.log('  pack size not in master    ' + n.packsize);
  console.log('  colour code not in master  ' + n.newcolour);
  console.log('  unknown code               ' + n.unknown);
  console.log('  duplicate SKU in a store   ' + n.dup);
  console.log('  Amazon vs master clash     ' + n.clash);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
