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

one('rfdSizeGroups, rfdSizeRaw, rfdSizeOf,', 'rfdSizeGroups, rfdSizeRaw, rfdSizeOf, rfdFabKey, rfdKeyUnit, rfdRoomFor, rfdUsedM,', 'exports');

one(`    A.setVP(wasVP3); A.setVO(wasVO3); A.setRFD_(wasRFD3);
  }`,
`    /* ================= AND THE SAME BOX ON THE RUNNING CLOTH =================
     *
     * There is no colour to collapse on the metres table — one row per fabric already — so all it was
     * missing is the half that lets a printer say what is on their floor. */
    {
      const run = { id: 'r1', orderNo: 'VPO-R1', vendorCode: 'VND001', orderType: 'running',
        service: 'Block print', status: 'In Production', lines: [
          { lineId: 'm1', kind: 'running', fabricType: 'Cambric', meters: 600, color: 'Indigo' },
          { lineId: 'm2', kind: 'running', fabricType: 'Sheeting 82', meters: 300, color: 'Red' },
        ] };
      A.setRFD_({ decisions: {}, err: '', busy: false, at: '', shown: [], stock: {} });
      A.setVP({ code: 'VND001', name: 'RBP-Bagru', rows: [run], err: '', busy: false, at: '', tab: 'rfd' });
      A.setVO(Object.assign({}, A.VO(), { rows: [run] }));

      /* ---- THE TWO KEY SPACES ARE APART. A cloth and a size must never land on one row. ---- */
      ok('a cloth and a size are kept in separate key spaces',
         A.rfdFabKey('Cambric').indexOf('M__') === 0
         && A.rfdStockKey({ what: 'Square Tablecloth', size: '60X60' }).indexOf('P__') === 0,
         A.rfdFabKey('Cambric') + ' / ' + A.rfdStockKey({ what: 'Square Tablecloth', size: '60X60' }));
      ok('…and the unit is readable off the key',
         A.rfdKeyUnit(A.rfdFabKey('Cambric')) === 'm'
         && A.rfdKeyUnit(A.rfdStockKey({ what: 'x', size: 'y' })) === 'pcs');
      ok('…and a cloth named like a size does not collide with it',
         A.rfdFabKey('Square Tablecloth 60X60') !== A.rfdStockKey({ what: 'Square Tablecloth', size: '60X60' }),
         A.rfdFabKey('Square Tablecloth 60X60'));

      const cam = A.rfdFabKey('Cambric');
      ok('the order needs every metre of it to start with',
         A.rfdAllowed(run, 'Cambric').left === 600, String(A.rfdAllowed(run, 'Cambric').left));

      /* ---- WHAT IS ALREADY WITH THEM ---- */
      A.setRFD_(Object.assign({}, A.RFD(), { stock: { VND001: { [cam]: { pcs: 250, unit: 'm' } } } }));
      ok('metres the printer says are with them come off what is left to ask for',
         A.rfdAllowed(run, 'Cambric').left === 350, String(A.rfdAllowed(run, 'Cambric').left));
      ok('…and the other cloth is untouched',
         A.rfdAllowed(run, 'Sheeting 82').left === 300, String(A.rfdAllowed(run, 'Sheeting 82').left));
      /* METRES ARE NOT WHOLE NUMBERS. Half a tablecloth is not a thing; half a metre of cloth is. */
      A.setRFD_(Object.assign({}, A.RFD(), { stock: { VND001: { [cam]: { pcs: 250.5, unit: 'm' } } } }));
      ok('…and a half metre is not rounded away',
         A.rfdStockOf('VND001', cam) === 250.5, String(A.rfdStockOf('VND001', cam)));
      ok('…while a half piece still is not a thing',
         /whole number/.test(await A.rfdStockSave(run, A.rfdStockKey({ what: 'a', size: 'b' }), '3.5')),
         await A.rfdStockSave(run, A.rfdStockKey({ what: 'a', size: 'b' }), '3.5'));

      /* ---- AND IT NEVER REWRITES HISTORY ---- */
      A.setRFD_(Object.assign({}, A.RFD(), { stock: {} }));
      const eM = await A.rfdSubmit(run, 'Cambric', 100, '');
      ok('asking for metres of one cloth still works', eM === '' && A.rfdReqsOf(run).length === 1,
         eM || String(A.rfdReqsOf(run).length));
      const raisedM = A.rfdReqsOf(run)[0];
      A.setRFD_(Object.assign({}, A.RFD(), { stock: { VND001: { [cam]: { pcs: 250, unit: 'm' } } } }));
      ok('a count typed today cannot un-agree a metre request raised before it',
         A.rfdAllowed(run, 'Cambric', raisedM).stock === 0,
         JSON.stringify(A.rfdAllowed(run, 'Cambric', raisedM)));

      /* ---- ONE PILE, SHARED ---- */
      const run2 = { id: 'r2', orderNo: 'VPO-R2', vendorCode: 'VND001', orderType: 'running',
        service: 'Block print', status: 'Placed', rfdReqs: {},
        lines: [{ lineId: 'm3', kind: 'running', fabricType: 'Cambric', meters: 400, color: 'Red' }] };
      A.setVP(Object.assign({}, A.VP(), { rows: [run, run2] }));
      A.setRFD_(Object.assign({}, A.RFD(), { stock: { VND001: { [cam]: { pcs: 600, unit: 'm' } } } }));
      const h1 = A.rfdStockHere(run, cam), h2 = A.rfdStockHere(run2, cam);
      ok('one pile of cloth is shared between two open orders, oldest first',
         h1 === 500 && h2 === 100, JSON.stringify({ h1, h2 }));
      ok('…and never adds up to more than the pile', h1 + h2 === 600, String(h1 + h2));

      /* ---- THE SCREEN ---- */
      A.setRFD_(Object.assign({}, A.RFD(), { stock: {} }));
      A.setVP(Object.assign({}, A.VP(), { rows: [run] }));
      A.renderVp();
      const hr = els.vpBody.innerHTML;
      ok('the running table gives the printer a box too',
         (hr.match(/data-vprfd-stock=/g) || []).length === 2,
         String((hr.match(/data-vprfd-stock=/g) || []).length));
      ok('…and it takes a fraction of a metre', /data-vprfd-stock[^>]*step="0\\.1"/.test(hr), hr.slice(0, 600));
    }

    A.setVP(wasVP3); A.setVO(wasVO3); A.setRFD_(wasRFD3);
  }`, 'the running-cloth tests');

fs.writeFileSync(T, t);
console.log('written');
