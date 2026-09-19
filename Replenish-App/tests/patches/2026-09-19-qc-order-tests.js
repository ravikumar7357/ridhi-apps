const fs = require('fs'), pathm = require('path');
const T = pathm.join(__dirname, '..', 'prod-test.js');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let t = fs.readFileSync(T, 'utf8');
const one = (a, b, n) => {
  const crlf = x => x.split(LF).join(CR + LF);
  let A = crlf(a), B = crlf(b);
  if (t.split(A).length !== 2) { A = a; B = b; }
  if (t.split(A).length !== 2) throw new Error('anchor not unique (' + (t.split(A).length - 1) + '): ' + n);
  t = t.replace(A, () => B);
  console.log('  ok   ' + n);
};

one('voStampOrders, ordBookCsv,', 'voStampOrders, ordBookCsv, qcOrdersFor, ordQcOf,', 'exports');

one(`  /* ---- the export carries what the screen shows ---- */`,
`  /* ================= QC NAMES ITS ORDER, AND THE CONSOLE CAN SHOW QC AT ALL =================
   *
   * The check form's Order box was optional, and in 245 live checks nobody filled it once — so the Order
   * Console, which looks QC up by order + SKU, showed a dash on every line it has ever drawn. */
  {
    const keepQC = Object.assign({}, A.QC()), keepNet = NET.on, keepStore = NET.store;
    vo([]); book();
    A.setPT(Object.assign(A.PT(), { cut: [], base: [
      { id: 'q1', orderNo: 'O-1', sku: 'S-A', issuePieces: 25, receivedPieces: 20 },
      { id: 'q2', orderNo: 'O-2', sku: 'S-A', issuePieces: 5, receivedPieces: 5 },
      { id: 'q3', orderNo: 'O-3', sku: 'S-B', issuePieces: 10, receivedPieces: 10 }] }));
    const checks = list => A.setQC(Object.assign({}, A.QC(), { checks: list, issue: [], ret: [] }));
    const qc = (no, sku) => A.ordQcOf(no, sku) || { checked: 0, ok: 0, rej: 0, alt: 0, worked: 0, none: true };

    /* ---- history: checks that named no order ---- */
    checks([{ id: 'c1', sku: 'S-A', checked: 22, ok: 20, rejected: 2, forAlteration: 0 }]);
    ok('a check that named no order is shared between the orders of its SKU',
       qc('O-1', 'S-A').checked === 20 && qc('O-2', 'S-A').checked === 2, qc('O-1', 'S-A').checked + ' / ' + qc('O-2', 'S-A').checked);
    ok('…once: the shares add up to what was checked, never more', qc('O-1', 'S-A').checked + qc('O-2', 'S-A').checked === 22);
    ok('…never beyond what an order received — nothing is inspected that did not come back', qc('O-1', 'S-A').checked <= 20);
    ok('…the older order first', qc('O-1', 'S-A').checked > qc('O-2', 'S-A').checked);
    ok('…with passed and rejected going with the pieces', qc('O-1', 'S-A').ok === 18 && qc('O-1', 'S-A').rej === 2, JSON.stringify(qc('O-1', 'S-A')));
    ok('…and marked as worked out, because nobody wrote it down', qc('O-1', 'S-A').worked === 20);
    /* A CHECK THAT NAMED ITS ORDER IS THAT ORDER'S, and comes off the room before anything is shared in. */
    checks([{ id: 'c2', sku: 'S-B', orderNo: 'O-3', checked: 4, ok: 4 }, { id: 'c3', sku: 'S-B', checked: 100, ok: 100 }]);
    ok('a check that named its order is that order\\'s', qc('O-3', 'S-B').checked >= 4);
    ok('…and unnamed checks only fill what is left of what the order received',
       qc('O-3', 'S-B').checked === 10 && qc('O-3', 'S-B').worked === 6, JSON.stringify(qc('O-3', 'S-B')));
    checks([{ id: 'c4', sku: 'S-C', checked: 9, ok: 9 }]);
    ok('an order that received nothing is given no QC, whatever was checked', !!qc('O-4', 'S-C').none);
    checks([{ id: 'c1', sku: 'S-A', checked: 22, ok: 20, rejected: 2, forAlteration: 0 }]);
    ['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus', 'odQ'].forEach(i => { els[i].value = ''; });
    A.renderOrd();
    ok('the console\\'s QC column is no longer a dash', />18</.test(els.odTable.innerHTML), (els.odTable.innerHTML.match(/shared out by SKU/g) || []).length + ' notes');
    ok('…and says these were shared out, not recorded', /named no order/.test(els.odTable.innerHTML));

    /* ---- from now on: the form asks ---- */
    ok('the form offers the orders a SKU is on, the one with pieces back first',
       A.qcOrdersFor('S-A').map(o => o.orderNo).join(',') === 'O-1,O-2' && A.qcOrdersFor('S-A')[0].received === 20, JSON.stringify(A.qcOrdersFor('S-A')));
    checks([]); NET.on = true; NET.store = {};
    const fill = (sku, ord, n) => { els.qcwSrc.value = ''; els.qcwSku.value = sku; els.qcwSku.dataset = els.qcwSku.dataset || {}; els.qcwSku.dataset.typed = '1';
      els.qcwBy.value = 'Anita'; els.qcwOrd.value = ord; els.qcwChecked.value = String(n); els.qcwAlt.value = ''; els.qcwRej.value = ''; els.qcwRemarks.value = ''; };
    const save = async () => { const at = NET.calls.length; try { await els.qcwSave.onclick(); } catch (e) { return { threw: e.message || String(e), puts: [] }; }
      return { msg: els.qcwMsg.textContent, puts: NET.calls.slice(at).filter(c => c.method === 'PUT' && /pt_qcChecks/.test(c.url)) }; };
    fill('S-A', '', 3);
    let r = await save();
    ok('a check on a SKU that is on orders is refused without one', r.puts.length === 0 && /pick which one/.test(r.msg || ''), JSON.stringify(r));
    fill('S-A', 'O-3', 3);
    r = await save();
    ok('…and with an order that SKU is not on', r.puts.length === 0 && /has no line for/.test(r.msg || ''), JSON.stringify(r));
    fill('S-A', 'o-2', 3);
    r = await save();
    ok('…and saved with the order it names, however it was typed', r.puts.length === 1 && r.puts[0].body.orderNo === 'O-2', JSON.stringify(r.puts[0] && r.puts[0].body));
    ok('…so the console shows it against that order by name', qc('O-2', 'S-A').checked === 3 && qc('O-2', 'S-A').worked === 0, JSON.stringify(qc('O-2', 'S-A')));
    /* ONE ORDER, ONE ANSWER — the box fills itself in. */
    els.qcwSku.value = 'S-B'; els.qcwSku.dataset.typed = '1'; els.qcwOrd.value = '';
    try { A.renderQcCheckForm(); } catch (e) { /* fails below */ }
    ok('a SKU on exactly one order fills the box in by itself', els.qcwOrd.value === 'O-3', els.qcwOrd.value);
    ok('…and the box says it is required', /\\*/.test(els.qcwOrd.placeholder || ''), els.qcwOrd.placeholder);
    NET.on = keepNet; NET.store = keepStore; A.setQC(keepQC);
  }

  /* ---- the export carries what the screen shows ---- */`, 'the QC tests');

fs.writeFileSync(T, t);
console.log('written');
