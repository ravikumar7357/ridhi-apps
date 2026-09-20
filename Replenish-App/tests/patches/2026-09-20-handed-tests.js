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

one('voStampOrders, ordBookCsv, qcOrdersFor, ordQcOf, ordFgAt, ordShareBySku, fbaState,',
  'voStampOrders, ordBookCsv, qcOrdersFor, ordQcOf, ordFgAt, ordShareBySku, fbaState, ORD_KPI_FIELDS, spHandover, setORD_KPI:v=>{ORD_KPI=v},', 'exports');

one(`    A.setPTG(Object.assign(A.PTG(), { shopProd: wasSP })); A.setVO(wasVO2);
    els.odView.value = 'book';
  }`,
`    /* ================= HANDED OVER IS THE END, AND THE HOLE STAYS VISIBLE =================
     *
     * 37 live lines were made and sent in September before anybody entered them, and the console asked
     * the floor to make pieces that were already with a customer. */
    {
      /* A line with NOTHING in the registers, taken by shipping. */
      A.setPT(Object.assign(A.PT(), { base: [], cut: [] }));
      A.setPTG(Object.assign(A.PTG(), { press: [],
        shopProd: { 'SHP-9100__SH-A': { orderNo: 'SHP-9100', sku: 'SH-A', handedAt: '2026-09-12T05:00:00Z', handedBy: 'ship@x' } } }));
      A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
      const r = A.ordLines().find(x => x.orderNo === 'SHP-9100');
      ok('a line the shipping team has taken has no work outstanding on it',
         r.pendingMake === 0 && r.pendingCut === 0 && r.madeToPress === 0, JSON.stringify([r.pendingCut, r.pendingMake, r.madeToPress]));
      ok('…and what the registers never recorded is carried, not swept away', r.unrecorded === 4, String(r.unrecorded));
      ok('…and the line still knows what was ordered and what came back', r.qty === 4 && r.received === 0);
      /* A LINE THAT WAS PROPERLY ENTERED CARRIES NOTHING — this is about holes, not about handovers. */
      A.setPT(Object.assign(A.PT(), { base: [{ id: 'hb', orderNo: 'SHP-9100', sku: 'SH-A', issuePieces: 4, receivedPieces: 4 }] }));
      A.setPTG(Object.assign(A.PTG(), { press: [{ id: 'hp', orderNo: 'SHP-9100', sku: 'SH-A', pieces: 4 }] }));
      A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
      ok('a line that was entered properly has no hole to report',
         A.ordLines().find(x => x.orderNo === 'SHP-9100').unrecorded === 0);
      /* AND A LINE NOBODY HAS HANDED OVER KEEPS ITS OUTSTANDING WORK. The zeroing is the handover's,
       * and nothing else's — otherwise it would be a way to make work disappear. */
      A.setPT(Object.assign(A.PT(), { base: [], cut: [] }));
      A.setPTG(Object.assign(A.PTG(), { press: [], shopProd: {} }));
      A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
      const un = A.ordLines().find(x => x.orderNo === 'SHP-9100');
      ok('a line nobody has handed over keeps every piece of its outstanding work',
         un.pendingMake === 4 && un.unrecorded === 0, JSON.stringify([un.pendingMake, un.unrecorded]));

      /* ---- NO SHORTCUT IS OPENED ---- the only thing that sets handedAt refuses a line with nothing made. */
      {
        const wasEdit = ME.prodEdit, wasAdmin2 = ME.admin; ME.admin = true; ME.prodEdit = true;
        const keepNet = NET.on; NET.on = true;
        let said = ''; try { said = String(await A.spHandover('SHP-9100', 'SH-A', true) || ''); } catch (e) { said = 'threw: ' + (e.message || e); }
        ok('a line with nothing received cannot be handed over at all', /Nothing has been received/.test(said), said);
        A.setPT(Object.assign(A.PT(), { base: [{ id: 'hb2', orderNo: 'SHP-9100', sku: 'SH-A', issuePieces: 4, receivedPieces: 4 }] }));
        A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
        try { said = String(await A.spHandover('SHP-9100', 'SH-A', true) || ''); } catch (e) { said = 'threw: ' + (e.message || e); }
        ok('…nor one whose pieces have not been pressed', /have not been pressed/.test(said), said);
        ok('…so nothing on this screen can declare a line done without the entries',
           !A.ordLines().find(x => x.orderNo === 'SHP-9100').handedAt);
        NET.on = keepNet; ME.prodEdit = wasEdit; ME.admin = wasAdmin2;
      }

      /* ---- the screen ---- */
      A.setPT(Object.assign(A.PT(), { base: [], cut: [] }));
      A.setPTG(Object.assign(A.PTG(), { press: [],
        shopProd: { 'SHP-9100__SH-A': { orderNo: 'SHP-9100', sku: 'SH-A', handedAt: '2026-09-12T05:00:00Z', handedBy: 'ship@x' } } }));
      A.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
      els.odView.value = 'shoporder';
      ['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus', 'odQ'].forEach(i => { els[i].value = ''; });
      A.renderOrd();
      const h = els.odTable.innerHTML;
      ok('the row says the pieces were sent and never recorded', /4 never recorded/.test(h), h.slice(0, 500));
      ok('…and no longer asks anybody to make them', !/4 to make/.test(h), (h.match(/\\d+ to make/g) || []).join(','));
      ok('the panel counts the hole in a tile of its own', /Sent, never recorded/.test(els.odKpis.innerHTML), els.odKpis.innerHTML.slice(0, 300));
      ok('…and it is one of the tiles you can click to see only those lines',
         !!A.ORD_KPI_FIELDS().unrecorded || !!A.ORD_KPI_FIELDS.unrecorded, Object.keys(A.ORD_KPI_FIELDS.unrecorded ? A.ORD_KPI_FIELDS : {}).join(','));
      /* And the order book, which shows the same lines, says it too. */
      els.odView.value = 'book'; A.renderOrd();
      ok('the order book says it as well', /never recorded/.test(els.odTable.innerHTML));
      /* And the journey. */
      A.ptOpenDialog({ title: 'cleared', html: '', note: '' });
      try { A.ordJourney('SHP-9100'); } catch (e) { /* fails below */ }
      ok('the journey says it where the line is waiting',
         /Handed over · 4 never recorded/.test((A.PTD_() || {}).html || ''), String((A.PTD_() || {}).html).slice(0, 600));
    }

    A.setPTG(Object.assign(A.PTG(), { shopProd: wasSP })); A.setVO(wasVO2);
    els.odView.value = 'book';
  }`, 'the handed-over tests');

fs.writeFileSync(T, t);
console.log('written');
