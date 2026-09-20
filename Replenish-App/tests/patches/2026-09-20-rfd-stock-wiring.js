/* The box is a number you type, so it saves on CHANGE, not on a click — and the pile has to be read
 * before either screen can count it. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. the box is typed into, so it listens for a change, not a click ---- */
one(`  const stock = e.target.closest('[data-vprfd-stock]');
  if (stock && e.type === 'change') {
    const [oid, key] = stock.getAttribute('data-vprfd-stock').split('|');
    const o = (VP.rows || []).find(x => x && x.id === oid); if (!o) return;
    const err = await rfdStockSave(o, key, String(stock.value).trim());
    $('vpMsg').className = err ? 'err' : 'muted';
    $('vpMsg').textContent = err || 'Saved what you have. It comes off what is left to ask for.';
    if (!err) renderVp();
    return;
  }
  const del = e.target.closest('[data-vprfd-del]');`,
`  const del = e.target.closest('[data-vprfd-del]');`, 'off the click listener');

one(`$('vpBody').addEventListener('click', async e => {`,
`/* WHAT IS ALREADY WITH YOU, saved the moment the printer tabs out of the box. A button beside every
 * size would be another thing to forget to press, and forgetting this one means the factory keeps
 * sending cloth they already have. */
$('vpBody').addEventListener('change', async e => {
  const stock = e.target.closest('[data-vprfd-stock]');
  if (!stock) return;
  const [oid, key] = stock.getAttribute('data-vprfd-stock').split('|');
  const o = (VP.rows || []).find(x => x && x.id === oid); if (!o) return;
  const err = await rfdStockSave(o, key, String(stock.value).trim());
  $('vpMsg').className = err ? 'err' : 'muted';
  $('vpMsg').textContent = err || 'Saved. It comes off what is left to ask for, here and on your other orders.';
  if (!err) renderVp();
});

$('vpBody').addEventListener('click', async e => {`, 'onto a change listener');

/* ---- 2. the printer's own pile, read with their own orders ---- */
one(`      // Only this vendor's branch is ever asked for. Reading the node would hand over every vendor.
      VP.rows = code ? ptList(await ptGet('pt_vendorOrders/' + code)) : [];`,
`      // Only this vendor's branch is ever asked for. Reading the node would hand over every vendor.
      VP.rows = code ? ptList(await ptGet('pt_vendorOrders/' + code)) : [];
      /* WHAT THIS PRINTER HAS SAID IS ON THEIR FLOOR. Their branch and nobody else's, for the same
       * reason. A failed read leaves the boxes empty and the requirement at its full size, which is
       * the safe way round — it asks for cloth that may not be needed rather than skipping cloth
       * that is. */
      if (code) {
        try { RFD.stock = Object.assign({}, RFD.stock || {}, { [obUC(code)]: (await ptGet('pt_rfdStock/' + code)) || {} }); }
        catch (e) { RFD.stock = RFD.stock || {}; }
      }`, 'the portal reads its own pile');

one(`    try { RFD.decisions = (await ptGet('pt_rfdDecisions')) || {}; RFD.err = ''; }
    catch (e) { RFD.err = e.message || String(e); RFD.decisions = RFD.decisions || {}; }`,
`    try { RFD.decisions = (await ptGet('pt_rfdDecisions')) || {}; RFD.err = ''; }
    catch (e) { RFD.err = e.message || String(e); RFD.decisions = RFD.decisions || {}; }
    /* AND WHAT EVERY PRINTER SAYS IS ON THEIR FLOOR. The office has to see it: it is a claim, it
     * comes off what gets sent, and it is stamped with who said it and when. */
    try { RFD.stock = (await ptGet('pt_rfdStock')) || {}; }
    catch (e) { RFD.stock = RFD.stock || {}; }`, 'the office reads them all');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
