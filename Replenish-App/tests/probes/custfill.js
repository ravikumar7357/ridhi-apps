/* Fill "New SKU" on the custom-order sheet from the master and the house rule (letters + colour code + size part). Read-only
 * against the database; writes a filled CSV next to the input. node custfill.js <in.csv> <out.csv> */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const [inp, outp] = process.argv.slice(2);
const parseCsv = t => { const rows = []; let r = [], f = '', q = false; for (let i = 0; i < t.length; i++) { const ch = t[i];
  if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
  else if (ch === '"') q = true; else if (ch === ',') { r.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(f); rows.push(r); r = []; f = ''; } else f += ch; }
  if (f || r.length) { r.push(f); rows.push(r); } return rows; };
const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 120000 }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const mdbRaw = await get(DB + '/pt_masterDB.json');
  const skc = Object.values((await get(DB + '/pt_masters/skuCode.json')) || {}).filter(r => r && r.base);
  const U = s => String(s == null ? '' : s).trim().toUpperCase(), N = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  const CUST = /-CUST-/i;
  const mdb = Object.values(mdbRaw).filter(r => r && r.sku && !CUST.test(r.sku));
  const bySku = new Map(mdb.map(r => [U(r.sku), r]));
  const parts = s => { const m = U(s).match(/^([A-Z]+)(\d+)(.*)$/); return m ? { pre: m[1], code: m[2], rest: m[3] } : null; };
  /* the same words, however they were typed */
  const SUB = s => N(s).replace(/rectangle tablecloth/, 'rectangular tablecloth');
  const SZ = s => N(s).replace(/\s*x\s*/g, 'x').replace(/"/g, '').replace(/inches?|in\b/g, '').trim();
  const colours = [...new Set(mdb.map(r => N(r.color)).filter(Boolean))];
  const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const colourOf = c => { const n = N(c); if (colours.includes(n)) return { col: n, fixed: false };
    let best = null, bd = 9; colours.forEach(x => { const d = lev(n, x); if (d < bd) { bd = d; best = x; } });
    return bd <= 2 && n.length > 5 ? { col: best, fixed: true } : { col: n, fixed: false }; };
  const exactKey = (a, s, c, z) => [N(a), SUB(s), N(c), SZ(z)].join('|');
  const exact = new Map(); mdb.forEach(r => { const k = exactKey(r.articleType, r.subtype, r.color, r.size); exact.set(k, (exact.get(k) || []).concat([U(r.sku)])); });
  /* colour → (letters, colour code); article+subtype+size → (letters, size part) */
  const colCodes = new Map(), shapes = new Map(), shapeEg = new Map();
  const add = (map, k, v) => { let t = map.get(k); if (!t) map.set(k, t = new Map()); t.set(v, (t.get(v) || 0) + 1); };
  const fam = p => (/^CPC/.test(p) ? 'cpc' : /^R/.test(p) ? 'r' : '');
  mdb.forEach(r => { const p = parts(r.sku); if (!p || !fam(p.pre)) return; add(colCodes, N(r.color), fam(p.pre) + '|' + p.code);
    const k = [N(r.articleType), SUB(r.subtype), SZ(r.size)].join('|'); add(shapes, k, p.pre + '|' + p.rest); if (!shapeEg.has(k + '|' + p.pre + '|' + p.rest)) shapeEg.set(k + '|' + p.pre + '|' + p.rest, U(r.sku)); });
  /* THE HOUSE RULE (Master → SKU codes): base code per article + subtype + size, the colour code put into it. */
  const skcFull = (base, code) => { const b = U(base), c = U(code); if (!b || !c) return ''; if (b.indexOf('--') >= 0) return b.replace('--', '-' + c + '-'); if (b.endsWith('-')) return b + c; const i = b.indexOf('-'); return i < 0 ? b + c : b.slice(0, i) + c + b.slice(i); };
  const official = new Map(); skc.forEach(r => { const k = [N(r.article), SUB(r.subtype), SZ(r.size)].join('|'); official.set(k, (official.get(k) || []).concat([U(r.base)])); });
  /* A colour's code: of the numbers in its own SKUs, the one that rebuilds most of them through the base table (skcCodeOf). */
  const codeOf = (col, family) => { const t = colCodes.get(col); if (!t) return '';
    const mine = new Set(mdb.filter(r => N(r.color) === col).map(r => U(r.sku)));
    let best = '', bn = -1; t.forEach((n, fc) => { const [f, code] = fc.split('|'); if (f !== family) return;
      const k = [...official.values()].flat().reduce((a, b) => a + (mine.has(skcFull(b, code)) ? 1 : 0), 0) * 1000 + n; if (k > bn) { bn = k; best = code; } }); return best; };
  const rows = parseCsv(fs.readFileSync(inp, 'utf8').replace(/^\uFEFF/, '')).filter(r => r.length > 1);
  const h = rows[0].map(N), ix = n => h.indexOf(n);
  const C = { sku: ix('custom sku'), a: ix('article'), s: ix('subtype'), c: ix('colour'), z: ix('size'), b: ix('brand'), n: ix('new sku') };
  const out = [rows[0].concat(['How it was found'])];
  const stat = { exact: 0, builtExists: 0, builtNew: 0, blank: 0, colourFixed: 0 };
  rows.slice(1).forEach(r => {
    const a = r[C.a], s = r[C.s], z = r[C.z], brand = N(r[C.b]);
    const cc = colourOf(r[C.c]); if (cc.fixed) stat.colourFixed++;
    let sku = '', how = '';
    const ex = exact.get([N(a), SUB(s), cc.col, SZ(z)].join('|')) || [];
    if (ex.length === 1) { sku = ex[0]; how = 'in the master: same article, subtype, colour and size'; stat.exact++; }
    else if (ex.length > 1) { how = 'several master SKUs have exactly this: ' + ex.slice(0, 4).join(', ') + ' — pick one'; stat.blank++; }
    else {
      const family = brand === 'cpc' ? 'cpc' : 'r';
      const key = [N(a), SUB(s), SZ(z)].join('|');
      const code = codeOf(cc.col, family);
      const bases = family === 'r' ? (official.get(key) || []) : [];
      const base = bases.length === 1 ? bases[0] : '';
      let cand = '', src = '';
      if (!colCodes.get(cc.col)) how = 'no master SKU has the colour "' + r[C.c] + '" — its colour code is unknown';
      else if (!code) how = 'the colour "' + r[C.c] + '" has no ' + (family === 'cpc' ? 'CPC' : 'Ridhi') + ' colour code in the master';
      else if (bases.length > 1) how = 'the SKU codes table has ' + bases.length + ' base codes for this (' + bases.map(b => skcFull(b, code)).join(' or ') + ') — pick the pack';
      else if (base) { cand = skcFull(base, code); src = 'base code ' + base + ' (SKU codes table) + colour code ' + code; }
      else {
        let bestShape = null; (shapes.get(key) || new Map()).forEach((n, pr) => { const [pre] = pr.split('|'); if (fam(pre) !== family) return; if (!bestShape || n > bestShape.n) bestShape = { pr, n }; });
        if (!bestShape) how = 'no ' + (family === 'cpc' ? 'CPC' : 'Ridhi') + ' SKU in the master is a ' + s + ' in ' + z + ' — the size part of the code is unknown';
        else { const [pre, rest] = bestShape.pr.split('|'); cand = pre + code + rest; src = 'shaped like ' + shapeEg.get(key + '|' + bestShape.pr) + ' + colour code ' + code; }
      }
      if (cand) {
        const owner = bySku.get(cand);
        if (owner && N(owner.color) !== cc.col) { how = cand + ' is already ' + owner.color + ' in the master — colour code ' + code + ' clashes'; }
        else if (owner) { sku = cand; how = 'built by the rule (' + src + ') and it is in the master'; stat.builtExists++; }
        else { sku = cand; how = 'NEW code by the rule (' + src + ') — not in the master yet'; stat.builtNew++; }
      }
      if (!sku) stat.blank++;
    }
    if (cc.fixed && sku) how += ' · colour read as "' + cc.col + '"';
    const row = r.slice(); while (row.length < rows[0].length) row.push('');
    if (!String(row[C.n] || '').trim()) row[C.n] = sku;
    out.push(row.concat([how]));
  });
  fs.writeFileSync(outp, '\uFEFF' + out.map(r => r.map(cell).join(',')).join('\r\n'));
  console.log(JSON.stringify(stat));
  out.slice(1, 16).forEach(r => console.log('  ', r[0], '|', r[2], '|', r[3], '|', r[4], '→', r[C.n], '|', r[r.length - 1]));
})().catch(e => { console.error('FAILED', e.stack || e); process.exit(1); });
