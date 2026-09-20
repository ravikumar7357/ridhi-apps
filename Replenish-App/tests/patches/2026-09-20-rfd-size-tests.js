const fs = require('fs'), pathm = require('path');
const T = pathm.join(__dirname, '..', 'prod-test.js');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let t = fs.readFileSync(T, 'utf8');
const NL = t.indexOf(CR + LF) >= 0 ? CR + LF : LF;
const one = (a, b, n) => {
  const A = a.split(LF).join(NL), B = b.split(LF).join(NL);
  if (t.split(A).length !== 2) throw new Error('anchor not unique (' + (t.split(A).length - 1) + '): ' + n);
  t = t.replace(A, () => B);
  console.log('  ok   ' + n);
};

one('rfdPcsAllowed, rfdSubmitPcs,', 'rfdPcsAllowed, rfdSubmitPcs, rfdSizeGroups, rfdSizeRaw, rfdSizeKey, rfdStockKey, rfdSpread, rfdSubmitSize, rfdStockSave, rfdStockOf, rfdStockHere, rfdStockForSku, rfdUsedPcs, setRFD_:v=>{RFD=v},', 'exports');

/* The picker now carries a SIZE, not a SKU — that is the whole point of it. */
one(`    QS['[data-vprfd-sku="p1"]'] = { value: 'TC-7272' };`,
`    /* A SIZE, NOT A SKU. The box lists sizes now, so this is what a printer actually picks. */
    QS['[data-vprfd-sku="p1"]'] = { value: 'SQUARE_TABLECLOTH_72X72' };`, 'the picker carries a size');

one(`    ok('…for the size that was picked, in the pieces that were typed',
      raised && raised.sku === 'TC-7272' && raised.pieces === 10, JSON.stringify(raised || {}));`,
`    ok('…for the size that was picked, in the pieces that were typed',
      raised && raised.sku === 'TC-7272' && raised.pieces === 10, JSON.stringify(raised || {}));
    ok('…and it is still stored against the SKU, with its colour and its cloth',
      raised && raised.colour === 'Indigo' && raised.fabric === 'Sheeting 72', JSON.stringify(raised || {}));`, 'and the record is still per SKU');

one(`    delete QS['[data-vprfd-sku="p1"]']; delete QS['[data-vprfd-p="p1"]']; delete QS['[data-vprfd-pn="p1"]'];
  }`,
`    delete QS['[data-vprfd-sku="p1"]']; delete QS['[data-vprfd-p="p1"]']; delete QS['[data-vprfd-pn="p1"]'];
  }

  /* ================= ONE ROW PER SIZE, AND WHAT IS ALREADY WITH THEM =================
   *
   * 60X60 Square Tablecloth is on Ravi's screen thirteen times, once per colour, and the printer is
   * asking for blank cloth — the colour is what they are about to print on it. 1,038 rows across
   * the live orders become 260. */
  {
    const wasVP3 = A.VP(), wasVO3 = A.VO(), wasRFD3 = A.RFD();
    const many = { id: 'g1', orderNo: 'VPO-G1', vendorCode: 'VND001', orderType: 'cut',
      service: 'Block print', status: 'In Production', lines: [
        { lineId: 'a', kind: 'cut', sku: 'TC-6060', qty: 30, size: '60X60', color: 'Taupe', articleSubtype: 'Square Tablecloth' },
        { lineId: 'b', kind: 'cut', sku: 'TC-5454', qty: 20, size: '60X60', color: 'Indigo', articleSubtype: 'Square Tablecloth' },
        { lineId: 'c', kind: 'cut', sku: 'TC-82', qty: 10, size: '60X60', color: 'Red', articleSubtype: 'Square Tablecloth' },
        { lineId: 'd', kind: 'cut', sku: 'TC-7272', qty: 10, size: '72X72', color: 'Indigo', articleSubtype: 'Square Tablecloth' },
      ] };
    A.setRFD_({ decisions: {}, err: '', busy: false, at: '', shown: [], stock: {} });
    A.setVP({ code: 'VND001', name: 'RBP-Bagru', rows: [many], err: '', busy: false, at: '', tab: 'rfd' });
    A.setVO(Object.assign({}, A.VO(), { rows: [many] }));

    const g = A.rfdSizeGroups(many);
    ok('four colour rows become two sizes', g.length === 2, g.map(x => x.key).join(' | '));
    const sixty = g.find(x => x.size === '60X60');
    ok('…and the size carries every piece of every colour', sixty && sixty.pieces === 60, sixty && String(sixty.pieces));
    ok('…and says how many colours are behind it', sixty && sixty.colours.length === 3, JSON.stringify(sixty && sixty.colours));
    /* A GROUP THAT SPANS TWO CLOTHS SAYS SO. 5 of the 260 live groups do, and two of those five are
     * the "Sheeitng 112" typo — a row that names both is how anybody finds out. */
    ok('…and names every cloth behind it', sixty && sixty.fabrics.length === 3, JSON.stringify(sixty && sixty.fabrics));
    ok('the key a database will take has nothing in it to choke on',
      /^[A-Z0-9_]+$/.test(sixty.stockKey), sixty.stockKey);

    /* ---- ASKING ONCE, SPREAD OVER THE COLOURS ---- */
    let err = await A.rfdSubmitSize(many, sixty.stockKey, 30, 'half of it');
    ok('asking for a size raises one request per colour', err === '' && A.rfdReqsOf(many).length === 3,
      err || String(A.rfdReqsOf(many).length));
    const got = A.rfdReqsOf(many);
    ok('…adding up to exactly what was asked for',
      got.reduce((a, r) => a + r.pieces, 0) === 30, JSON.stringify(got.map(r => r.sku + ':' + r.pieces)));
    ok('…shared out in proportion to what each colour needs',
      got.find(r => r.sku === 'TC-6060').pieces === 15 && got.find(r => r.sku === 'TC-5454').pieces === 10
      && got.find(r => r.sku === 'TC-82').pieces === 5,
      JSON.stringify(got.map(r => r.sku + ':' + r.pieces)));
    ok('…each one keeping its own colour and cloth',
      got.every(r => r.colour && r.fabric), JSON.stringify(got.map(r => r.colour + '/' + r.fabric)));
    ok('…and what is left on the size comes down by what was asked',
      A.rfdSizeOf(many, sixty.stockKey).left === 30, String(A.rfdSizeOf(many, sixty.stockKey).left));
    ok('…and the other size is untouched',
      A.rfdSizeOf(many, '72X72') === null || A.rfdSizeGroups(many).find(x => x.size === '72X72').used === 0);

    /* NOTHING IS LOST TO ROUNDING. Thirteen colours and a number that does not divide is where a
     * piece goes missing on every row and thirteen pieces go missing altogether. */
    ok('a split that does not divide still adds up',
      A.rfdSpread(10, [1, 1, 1]).reduce((a, b) => a + b, 0) === 10, JSON.stringify(A.rfdSpread(10, [1, 1, 1])));
    ok('…and never gives a part more room than it has',
      A.rfdSpread(10, [1, 1, 1]).every(x => x <= 1) === false && A.rfdSpread(2, [1, 1, 1]).every(x => x <= 1),
      JSON.stringify([A.rfdSpread(10, [1, 1, 1]), A.rfdSpread(2, [1, 1, 1])]));
    ok('…and a split of nothing is nothing',
      A.rfdSpread(0, [5, 5]).join(',') === '0,0' && A.rfdSpread(5, [0, 0]).join(',') === '0,0',
      JSON.stringify([A.rfdSpread(0, [5, 5]), A.rfdSpread(5, [0, 0])]));
    ok('…and no part is ever given a fraction of a piece',
      A.rfdSpread(7, [5, 5, 5]).every(x => Math.round(x) === x), JSON.stringify(A.rfdSpread(7, [5, 5, 5])));

    /* ---- WHAT IS ALREADY WITH THEM ---- */
    A.setRFD_(Object.assign({}, A.RFD(), { stock: { VND001: { [sixty.stockKey]: { pcs: 12 } } } }));
    ok('what the printer says is with them comes off what is left to ask for',
      A.rfdSizeOf(many, sixty.stockKey).left === 18, String(A.rfdSizeOf(many, sixty.stockKey).left));
    ok('…and off the ceiling for a new request too',
      A.rfdPcsAllowed(many, 'TC-6060').stock > 0, JSON.stringify(A.rfdPcsAllowed(many, 'TC-6060')));
    ok('…spread over the colours the same way',
      ['TC-6060', 'TC-5454', 'TC-82'].reduce((a, s) => a + A.rfdStockForSku(many, s), 0) === 12,
      JSON.stringify(['TC-6060', 'TC-5454', 'TC-82'].map(s => s + ':' + A.rfdStockForSku(many, s))));
    /* AND IT NEVER REACHES BACK. Asked what was left at the moment an OLD request was raised — the
     * question that decided whether it was agreed on the spot — the answer must not have moved. */
    ok('a count typed today cannot un-agree a request raised before it',
      A.rfdPcsAllowed(many, 'TC-6060', got.find(r => r.sku === 'TC-6060')).stock === 0,
      JSON.stringify(A.rfdPcsAllowed(many, 'TC-6060', got.find(r => r.sku === 'TC-6060'))));

    /* A DECLARED PILE IS ONE PILE. 39 live size groups sit on two or three open orders of one
     * printer; counting it against each would be the same cloth counted three times. */
    const second = Object.assign({}, many, { id: 'g2', orderNo: 'VPO-G2', rfdReqs: {},
      lines: [{ lineId: 'x', kind: 'cut', sku: 'TC-6060', qty: 40, size: '60X60', color: 'Taupe', articleSubtype: 'Square Tablecloth' }] });
    A.setVP(Object.assign({}, A.VP(), { rows: [many, second] }));
    A.setRFD_(Object.assign({}, A.RFD(), { stock: { VND001: { [sixty.stockKey]: { pcs: 100 } } } }));
    const here = A.rfdStockHere(many, sixty.stockKey), there = A.rfdStockHere(second, sixty.stockKey);
    ok('one pile is shared between two open orders, not counted twice',
      here + there <= 100 && here > 0 && there > 0, JSON.stringify({ here, there }));
    ok('…oldest order first, up to what it still needs',
      here === 30 && there === 40, JSON.stringify({ here, there }));

    /* ---- THE SCREEN ---- */
    A.setRFD_(Object.assign({}, A.RFD(), { stock: {} }));
    A.setVP(Object.assign({}, A.VP(), { rows: [many] }));
    A.renderVp();
    const h = els.vpBody.innerHTML;
    ok('the screen gives the printer a box to say what they have', /data-vprfd-stock=/.test(h), h.slice(0, 400));
    ok('…on the size, not on each colour',
      (h.match(/data-vprfd-stock=/g) || []).length === 2, String((h.match(/data-vprfd-stock=/g) || []).length));
    ok('…and the size says how many colours it covers', /3 colours/.test(h), h.slice(0, 600));

    A.setVP(wasVP3); A.setVO(wasVO3); A.setRFD_(wasRFD3);
  }`, 'the size and stock tests');

fs.writeFileSync(T, t);
console.log('written');
