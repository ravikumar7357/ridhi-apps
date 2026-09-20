/* THE SAME BOX ON THE RUNNING CLOTH. "DO FOR RUNNING FABRIC AS WELL".
 *
 * The metres table already had one row per fabric — there is no colour to collapse there — so all it
 * was missing is the half that lets a printer say what is already on their floor. 10 orders carry
 * running lines, 18 fabric rows across them, over six cloths.
 *
 * TWO KEY SPACES, KEPT APART. A size is stored as P__SQUARE_TABLECLOTH_60X60 and a cloth as
 * M__CAMBRIC, so a fabric called the same thing as a size can never land on the same row — and the
 * unit is readable in the key itself, which matters because one is whole pieces and the other is
 * metres to two places. pt_rfdStock is empty today, so both prefixes go in now rather than one being
 * bolted on beside the other later.
 *
 * Everything else is the piece table's: the pile is allocated oldest order first so one declaration
 * is not counted against three open orders, and it comes off the ceiling only for a NEW request, so
 * a figure typed today cannot un-agree one raised last week.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. the metres already asked for, on their own, so the room can be worked out without a loop ---- */
one(`function rfdAllowed(o, fabric, before) {
  const need = rfdOrderNeed(o).byFab.get(String(fabric || '').trim()) || 0;
  const cut = before && typeof before === 'object' ? rfdSeq(before) : null;
  const exceptId = before && typeof before === 'string' ? before : (before && before.id) || '';
  const used = rfdReqsOf(o).reduce((a, r) => {`,
`/**
 * The metres of one cloth already asked for on this order.
 *
 * Lifted out of rfdAllowed for the same reason rfdUsedPcs was: "what is left" now depends on what
 * the printer says is with them, which is worked out from what each order still needs — and asking
 * rfdAllowed for that would be a circle with no bottom.
 */
function rfdUsedM(o, fabric, before) {
  const cut = before && typeof before === 'object' ? rfdSeq(before) : null;
  const exceptId = before && typeof before === 'string' ? before : (before && before.id) || '';
  return rfdReqsOf(o).reduce((a, r) => {`, 'the metres used come out on their own');

one(`    const d = rfdDecisionOf(r.id);
    if (d && d.stage === 'rejected') return a;
    return a + (parseFloat(r.metres) || 0);
  }, 0);
  return { need: rfdRound(need), used: rfdRound(used), left: rfdRound(Math.max(0, need - used)) };
}`,
`    const d = rfdDecisionOf(r.id);
    if (d && d.stage === 'rejected') return a;
    return a + (parseFloat(r.metres) || 0);
  }, 0);
}

function rfdAllowed(o, fabric, before) {
  const need = rfdOrderNeed(o).byFab.get(String(fabric || '').trim()) || 0;
  const used = rfdUsedM(o, fabric, before);
  /* WHAT THE PRINTER SAYS IS ALREADY WITH THEM, on a NEW request only — see rfdPcsAllowed. */
  const stock = before ? 0 : rfdStockHere(o, rfdFabKey(fabric));
  return { need: rfdRound(need), used: rfdRound(used), stock: rfdRound(stock),
    left: rfdRound(Math.max(0, need - used - stock)) };
}`, 'and the ceiling counts the pile');

/* ---- 2. two key spaces, and a room lookup that knows both ---- */
one(`const rfdStockKey = x => rfdSizeKey(x).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'X';`,
`const rfdKeySafe = v => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'X';
/* P__ for a size in pieces, M__ for a cloth in metres. Apart, so a fabric named like a size cannot
 * land on the same row, and so the unit is readable in the key. */
const rfdStockKey = x => 'P__' + rfdKeySafe(rfdSizeKey(x));
const rfdFabKey = f => 'M__' + rfdKeySafe(f);
const rfdKeyUnit = k => (String(k || '').indexOf('M__') === 0 ? 'm' : 'pcs');`, 'two key spaces');

one(`function rfdStockHere(o, stockKey) {
  const code = rfdVendorOf(o);
  let pool = rfdStockOf(code, stockKey);
  if (!(pool > 0) || !o) return 0;
  let mine = 0;
  rfdStockOrders(code).forEach(x => {
    if (pool <= 0) return;
    const g = rfdSizeRaw(x).find(y => y.stockKey === stockKey);
    if (!g) return;
    const take = Math.min(pool, Math.max(0, g.pieces - g.used));
    pool -= take;
    if (x.id === o.id) mine = take;
  });
  return rfdRound(mine);
}`,
`/** What one order still needs of a size or of a cloth — the share of a pile it can take. */
function rfdRoomFor(o, stockKey) {
  const g = rfdSizeRaw(o).find(y => y.stockKey === stockKey);
  if (g) return Math.max(0, g.pieces - g.used);
  const f = rfdFabrics(o).find(x => rfdFabKey(x.fabric) === stockKey);
  if (!f) return 0;
  return Math.max(0, f.metres - rfdUsedM(o, f.fabric));
}

function rfdStockHere(o, stockKey) {
  const code = rfdVendorOf(o);
  let pool = rfdStockOf(code, stockKey);
  if (!(pool > 0) || !o) return 0;
  let mine = 0;
  rfdStockOrders(code).forEach(x => {
    if (pool <= 0) return;
    const take = Math.min(pool, rfdRoomFor(x, stockKey));
    pool -= take;
    if (x.id === o.id) mine = take;
  });
  return rfdRound(mine);
}`, 'the room lookup knows both');

/* ---- 3. metres are not whole numbers ---- */
one(`const rfdStockOf = (code, stockKey) => {
  const r = ((RFD.stock || {})[obUC(code)] || {})[stockKey];
  const n = r ? parseFloat(r.pcs) : 0;
  return isFinite(n) && n > 0 ? Math.round(n) : 0;
};`,
`const rfdStockOf = (code, stockKey) => {
  const r = ((RFD.stock || {})[obUC(code)] || {})[stockKey];
  const n = r ? parseFloat(r.pcs) : 0;
  if (!(isFinite(n) && n > 0)) return 0;
  /* Half a tablecloth is not a thing; half a metre of cloth is. */
  return rfdKeyUnit(stockKey) === 'm' ? rfdRound(n) : Math.round(n);
};`, 'metres keep their fraction');

one(`async function rfdStockSave(o, stockKey, pcs) {
  const code = rfdVendorOf(o);
  if (!code) return 'This sign-in is not linked to a printer.';
  const g = rfdSizeOf(o, stockKey);
  const n = parseFloat(pcs);
  if (pcs !== '' && (!isFinite(n) || n < 0)) return 'How many pieces do you have? A number, or leave it empty.';
  if (isFinite(n) && Math.round(n) !== n) return 'Pieces have to be a whole number.';
  const path = 'pt_rfdStock/' + code + '/' + stockKey;
  try {
    if (pcs === '' || !isFinite(n) || n === 0) await ptDelete(path);
    else await ptPut(path, { pcs: Math.round(n), what: (g && g.what) || '', size: (g && g.size) || '',
      by: ME.email, at: new Date().toISOString() });
  } catch (e) { return 'Not saved: ' + (e.message || e); }
  const all = Object.assign({}, RFD.stock || {});
  const mine = Object.assign({}, all[code] || {});
  if (pcs === '' || !isFinite(n) || n === 0) delete mine[stockKey];
  else mine[stockKey] = { pcs: Math.round(n), what: (g && g.what) || '', size: (g && g.size) || '',
    by: ME.email, at: new Date().toISOString() };
  all[code] = mine;
  RFD.stock = all;
  return '';
}`,
`async function rfdStockSave(o, stockKey, pcs) {
  const code = rfdVendorOf(o);
  if (!code) return 'This sign-in is not linked to a printer.';
  const unit = rfdKeyUnit(stockKey);
  const g = unit === 'm' ? null : rfdSizeOf(o, stockKey);
  const f = unit === 'm' ? rfdFabrics(o).find(x => rfdFabKey(x.fabric) === stockKey) : null;
  const n = parseFloat(pcs);
  if (pcs !== '' && (!isFinite(n) || n < 0))
    return unit === 'm' ? 'How many metres do you have? A number, or leave it empty.'
      : 'How many pieces do you have? A number, or leave it empty.';
  /* Half a tablecloth is not a thing anybody can print. Half a metre of cloth is. */
  if (unit === 'pcs' && isFinite(n) && Math.round(n) !== n) return 'Pieces have to be a whole number.';
  const val = isFinite(n) ? (unit === 'm' ? rfdRound(n) : Math.round(n)) : 0;
  const row = { pcs: val, unit, what: (g && g.what) || (f ? f.fabric : ''),
    size: (g && g.size) || '', by: ME.email, at: new Date().toISOString() };
  const path = 'pt_rfdStock/' + code + '/' + stockKey;
  const gone = pcs === '' || !isFinite(n) || val === 0;
  try {
    if (gone) await ptDelete(path);
    else await ptPut(path, row);
  } catch (e) { return 'Not saved: ' + (e.message || e); }
  const all = Object.assign({}, RFD.stock || {});
  const mine = Object.assign({}, all[code] || {});
  if (gone) delete mine[stockKey]; else mine[stockKey] = row;
  all[code] = mine;
  RFD.stock = all;
  return '';
}`, 'the box takes metres too');

/* ---- 4. the row ---- */
one(`  const rowsF = fabLines.map(x => {
    const cap = rfdAllowed(o, x.fabric);
    const got = rfdSentFor(o, x.fabric);
    const shortOf = rfdRound(Math.max(0, cap.need - got));
    return \`<tr><td style="text-align:left">\${esc(x.fabric)}\`
      + (cap.used ? \`<div style="font-size:10.5px;color:#7f6000">\${nf(cap.used)} m asked for</div>\` : '')
      + '</td>'
      + \`<td class="num">\${nf(cap.need)} m</td>\`
      + \`<td class="num" style="font-weight:700;color:\${got >= cap.need ? '#166534' : (got ? '#7f6000' : 'var(--muted)')}">\`
      + \`\${got ? nf(got) + ' m' : '&mdash;'}</td>\`
      + \`<td class="num"\${cap.left > 0 ? ' style="color:var(--bad);font-weight:700"' : ''}>\`
      + \`\${cap.left > 0 ? nf(cap.left) + ' m to ask for'
        : (shortOf > 0 ? '<span style="color:#7f6000">' + nf(shortOf) + ' m on the way</span>'
        : '<span style="color:#166534">all here</span>')}</td></tr>\`;
  }).join('');`,
`  const rowsF = fabLines.map(x => {
    const cap = rfdAllowed(o, x.fabric);
    const key = rfdFabKey(x.fabric);
    const got = rfdSentFor(o, x.fabric);
    const shortOf = rfdRound(Math.max(0, cap.need - got - cap.stock));
    const pool = rfdStockOf(rfdVendorOf(o), key);
    const elsewhere = rfdRound(Math.max(0, pool - cap.stock));
    const said = rfdStockRow(rfdVendorOf(o), key);
    return \`<tr><td style="text-align:left">\${esc(x.fabric)}\`
      + (cap.used ? \`<div style="font-size:10.5px;color:#7f6000">\${nf(cap.used)} m asked for</div>\` : '')
      + '</td>'
      + \`<td class="num">\${nf(cap.need)} m</td>\`
      /* THE SAME BOX AS THE SIZES HAVE. What was sent against this order is a fact and is said under
       * it; the box is the printer's own count and they keep it up to date. */
      + '<td class="num">'
      + \`<input data-vprfd-stock="\${esc(o.id)}|\${esc(key)}" type="number" min="0" step="0.1"\`
      + \` value="\${pool || ''}" placeholder="0" style="width:88px;text-align:right"\`
      + \` title="How many metres of this you already have. Yours to keep up to date — it comes off what is left to ask for, on this order and the next one.">\`
      + (got ? \`<div style="font-size:10.5px;color:#166534">\${nf(got)} m sent to you</div>\` : '')
      + (elsewhere ? \`<div style="font-size:10.5px;color:#7f6000" title="This order can only use what it still needs. The rest of your cloth is counted on your other open orders.">\${nf(elsewhere)} m counted elsewhere</div>\` : '')
      + (said && said.at ? \`<div class="muted" style="font-size:10px">you said, \${esc(ptIsoDate(said.at) || '')}</div>\` : '')
      + '</td>'
      + \`<td class="num"\${cap.left > 0 ? ' style="color:var(--bad);font-weight:700"' : ''}>\`
      + \`\${cap.left > 0 ? nf(cap.left) + ' m to ask for'
        : (shortOf > 0 ? '<span style="color:#7f6000">' + nf(shortOf) + ' m on the way</span>'
        : '<span style="color:#166534">all here</span>')}</td></tr>\`;
  }).join('');`, 'the running row gets the box');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
