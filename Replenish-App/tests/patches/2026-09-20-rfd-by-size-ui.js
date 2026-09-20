/* THE SCREEN: one row per size, a box for what is already with you, and the pile read in.
 * The second half of 2026-09-20-rfd-by-size.js — see that file for why.
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

/* ---- 1. the rows ---- */
one(`  const rowsP = pcsLines.map(x => {
    const cap = rfdPcsAllowed(o, x.sku);
    const got = rfdSentPcsFor(o, x.sku);
    const shortOf = rfdRound(Math.max(0, cap.need - got));
    return \`<tr><td style="text-align:left">\${esc(x.size || x.sku)}\`
      + \`<div class="muted" style="font-size:10.5px">\${esc([x.what, x.colour].filter(Boolean).join(' · '))}</div>\`
      + (cap.used ? \`<div style="font-size:10.5px;color:#7f6000">\${nf(cap.used)} pcs asked for</div>\` : '')
      + '</td>'
      + \`<td class="num">\${nf(cap.need)} pcs</td>\`
      + \`<td class="num" style="font-weight:700;color:\${got >= cap.need ? '#166534' : (got ? '#7f6000' : 'var(--muted)')}">\`
      + \`\${got ? nf(got) + ' pcs' : '&mdash;'}</td>\`
      /* ONE COLUMN, THREE ANSWERS. There is something left to ask for, or it has all been asked
       * for and is on its way, or it is on the floor. Three separate columns said the same thing in
       * a row of dashes. */
      + \`<td class="num"\${cap.left > 0 ? ' style="color:var(--bad);font-weight:700"' : ''}>\`
      + \`\${cap.left > 0 ? nf(cap.left) + ' pcs to ask for'
        : (shortOf > 0 ? '<span style="color:#7f6000">' + nf(shortOf) + ' pcs on the way</span>'
        : '<span style="color:#166534">all here</span>')}</td></tr>\`;
  }).join('');`,
`  /* ONE ROW PER SIZE. Thirteen colours of a 60X60 tablecloth are thirteen sums to answer one
   * question, and the answer is the same cloth — the colour is printed on afterwards. */
  const sizes = rfdSizeGroups(o);
  const rowsP = sizes.map(g => {
    const got = g.sent;
    const shortOf = rfdRound(Math.max(0, g.pieces - got - g.stock));
    const elsewhere = rfdRound(Math.max(0, g.pool - g.stock));
    const said = rfdStockRow(rfdVendorOf(o), g.stockKey);
    return \`<tr><td style="text-align:left">\${esc(g.size || g.key)}\`
      + \`<div class="muted" style="font-size:10.5px">\${esc(g.what)}\${g.colours.length
        ? ' · <span title="' + esc(g.colours.join(', ')) + '">' + nf(g.colours.length) + ' colour'
          + (g.colours.length > 1 ? 's' : '') + '</span>' : ''}\${
        g.fabrics.length ? ' · ' + esc(g.fabrics.join(' / ')) : ''}</div>\`
      + (g.used ? \`<div style="font-size:10.5px;color:#7f6000">\${nf(g.used)} pcs asked for</div>\` : '')
      + '</td>'
      + \`<td class="num">\${nf(g.pieces)} pcs</td>\`
      /* WITH YOU IS A BOX NOW. What was sent against this order is said under it, because it is a
       * fact and the box is a claim, and the two should not be added up by eye. */
      + '<td class="num">'
      + \`<input data-vprfd-stock="\${esc(o.id)}|\${esc(g.stockKey)}" type="number" min="0" step="1"\`
      + \` value="\${g.pool || ''}" placeholder="0" style="width:88px;text-align:right"\`
      + \` title="How many of these you already have. Yours to keep up to date — it comes off what is left to ask for, on this order and the next one.">\`
      + (got ? \`<div style="font-size:10.5px;color:#166534">\${nf(got)} pcs sent to you</div>\` : '')
      + (elsewhere ? \`<div style="font-size:10.5px;color:#7f6000" title="This order can only use what it still needs. The rest of your pile is counted on your other open orders.">\${nf(elsewhere)} counted elsewhere</div>\` : '')
      + (said && said.at ? \`<div class="muted" style="font-size:10px">you said, \${esc(ptIsoDate(said.at) || '')}</div>\` : '')
      + '</td>'
      /* ONE COLUMN, THREE ANSWERS. There is something left to ask for, or it has all been asked
       * for and is on its way, or it is on the floor. Three separate columns said the same thing in
       * a row of dashes. */
      + \`<td class="num"\${g.left > 0 ? ' style="color:var(--bad);font-weight:700"' : ''}>\`
      + \`\${g.left > 0 ? nf(g.left) + ' pcs to ask for'
        : (shortOf > 0 ? '<span style="color:#7f6000">' + nf(shortOf) + ' pcs on the way</span>'
        : '<span style="color:#166534">all here</span>')}</td></tr>\`;
  }).join('');`, 'the rows are sizes');

/* ---- 2. the heading says what the box is for ---- */
one(`    <th class="num" title="Already sent to you against this order.">With you</th>`,
`    <th class="num" title="What you already have. Type it in — it comes off what is left to ask for, here and on your later orders. Sent against this order is shown underneath.">With you</th>`, 'the heading');

/* ---- 3. asking for one SIZE, not one colour ---- */
one(`  const pcsOpts = pcsLines.map(x => \`<option value="\${esc(x.sku)}">\`
    + \`\${esc(x.size || x.sku)}\${x.colour ? ' · ' + esc(x.colour) : ''}</option>\`).join('');`,
`  const pcsOpts = sizes.map(g => \`<option value="\${esc(g.stockKey)}">\`
    + \`\${esc(g.size || g.key)} · \${esc(g.what)}\${g.left > 0 ? ' — ' + nf(g.left) + ' left' : ''}</option>\`).join('');`, 'the picker lists sizes');

one(`        <summary class="muted" style="font-size:12px;cursor:pointer">Ask for one size or one fabric only</summary>`,
`        <summary class="muted" style="font-size:12px;cursor:pointer">Ask for one size or one fabric only</summary>
        <div class="muted" style="font-size:11.5px;margin-top:6px">A size is asked for once. It is shared out over that size's colours for you, in proportion to what each still needs.</div>`, 'and says it shares the colours out');

one(`    const err = await rfdSubmitPcs(o, (g('sku') || {}).value, (g('p') || {}).value, (g('pn') || {}).value);`,
`    const err = await rfdSubmitSize(o, (g('sku') || {}).value, (g('p') || {}).value, (g('pn') || {}).value);`, 'and asks by size');

/* ---- 4. the box saves ---- */
one(`  const del = e.target.closest('[data-vprfd-del]');
  if (del) {`,
`  const stock = e.target.closest('[data-vprfd-stock]');
  if (stock && e.type === 'change') {
    const [oid, key] = stock.getAttribute('data-vprfd-stock').split('|');
    const o = (VP.rows || []).find(x => x && x.id === oid); if (!o) return;
    const err = await rfdStockSave(o, key, String(stock.value).trim());
    $('vpMsg').className = err ? 'err' : 'muted';
    $('vpMsg').textContent = err || 'Saved what you have. It comes off what is left to ask for.';
    if (!err) renderVp();
    return;
  }
  const del = e.target.closest('[data-vprfd-del]');
  if (del) {`, 'the box saves');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
