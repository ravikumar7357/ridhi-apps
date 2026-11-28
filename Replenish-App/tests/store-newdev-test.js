/* INDIA STORE: NEW DEVELOPMENT PIECES FOR FBA (28 Nov: never Custom; kept for FBA by the order's shipping mode; the larger of
 * New development and Replenishment, never both; to FBA only when Amazon lists the article).
 *   node tests/store-newdev-test.js     (FGA_MUT_FILE / FGA_MUT_SRC test a broken copy — teeth/teeth-store-newdev.js does)
 * Runs src/app/inventory/fg-store-newdev.js with the store's own files and every way out of the store, on made-up data. */
const { same, cut, line, whole, appFile, NOW, HOUR, iso, row, sent, ordLine, store, split, issueWhy, forOrder, WAYS, editStore, movement, counts, check: ok } = require('./india-store-harness');

const text = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAY = '2026-11-01';
const SEA = 'AMZ-01112026-01-SEA', AIR = 'AMZ-01112026-02-AIR';
const salesOrder = (no, over) => Object.assign({ _id: no, orderTypeKey: 'newdev', buyerName: 'Made Up Buyer', lines: [{ sku: 'A', qty: 1 }] }, over);
const bookLine = (no, qty, over) => ordLine(no, qty, Object.assign({ orderDate: DAY }, over));
/* A store of 20 with New development lines. o.orders: [[number, pieces, sales order extras, book line extras]]; no website
 * orders and no Replenishment need unless said. */
function newDev(o) {
  o = o || {};
  const orders = o.orders || [[SEA, 12]];
  return Object.assign({ web: 0, need: {}, lines: orders.map(([no, qty, , on]) => bookLine(no, qty, on)),
    sales: orders.map(([no, , so]) => salesOrder(no, so)) }, o);
}
const make = o => store(newDev(o));
const stockOf = (n, rows) => [row('O', 'OPENING', n)].concat(rows || []);
const lanes = S => { const s = S.shares(); return [s.air, s.sea, s.awd]; };
const pendingOf = S => JSON.parse(S.run('JSON.stringify([...fgaBook().newDev.values()].flat().map(o => [o.no, o.pending]))'));
const refusal = (S, qty) => S.run(`fgiHoldRefusal([{ sku: "A", qty: ${qty}, current: fgiOf("A").current }])`);

(async () => {
  console.log('== never Custom, kept for FBA ==');
  {
    ok('an Amazon order: pending pieces in its FBA column, with no Replenishment need', same(make().shares(), split(0, 0, 0, 12, 0, 8)), JSON.stringify(make().shares()));
    ok('FBA may take up to the pending pieces', make().free() === 12);
    ok('any other channel: not Custom either', same(make({ orders: [['B2B-1', 4]] }).shares(), split(0, 0, 4, 0, 0, 16)));
    ok('website pieces stay Custom, ahead of New development', same(make({ web: 11 }).shares(), split(0, 11, 0, 9, 0, 0)));
    ok('a regular order stays Custom', same(make({ orders: [['B2B-1', 4, { orderTypeKey: 'regular' }]] }).shares(), split(0, 4, 0, 0, 0, 16)));
    ok('the line\'s own type wins: a New development line', same(make({ orders: [['B2B-1', 4, { orderTypeKey: 'regular', lines: [{ sku: 'a', qty: 4, orderTypeKey: 'newdev' }] }]] }).shares(), split(0, 0, 4, 0, 0, 16)));
    ok('…and a regular line on a New development order', same(make({ orders: [['B2B-1', 4, { lines: [{ sku: 'A', qty: 4, orderTypeKey: 'regular' }] }]] }).shares(), split(0, 4, 0, 0, 0, 16)));
    ok('closed and handed-over lines ask nothing', make({ orders: [[SEA, 4, {}, { shopDoneAt: 'x' }], [AIR, 3, {}, { handedAt: 'x' }]] }).free() === 0);
    const off = make({ ls: '0' });
    await off.ctx.fgiStockReread(); await off.run('fgaSalesRead()');
    ok('switch off: the sales orders are not read', !off.reads.includes('pt_salesOrders'), off.reads.join());
  }

  console.log('== which FBA column ==');
  {
    const at = (no, so) => lanes(make({ orders: [[no, 5, so]] }));
    ok('-SEA: Sea', same(at(SEA), [0, 5, 0]));
    ok('-AIR: Air', same(at(AIR), [5, 0, 0]));
    ok('the order\'s own shipping mode when the number says none', same(at('AMZ-1', { shipMode: 'SEA' }), [0, 5, 0]));
    ok('…AWD too', same(at('AMZ-1', { shipMode: 'AWD' }), [0, 0, 5]));
    ok('the number wins over the field', same(at(SEA, { shipMode: 'AIR' }), [0, 5, 0]));
    ok('no mode: Air', same(at('AMZ-1'), [5, 0, 0]));
    ok('an unknown mode: Air', same(at('AMZ-1', { shipMode: 'ROAD' }), [5, 0, 0]));
    ok('short stock is given Air first', same(lanes(make({ orders: [[SEA, 5], [AIR, 5]], rows: stockOf(7) })), [5, 2, 0]));
  }

  console.log('== the larger of New development and Replenishment, never both (Replenishment: Air 3, Sea 4, AWD 2) ==');
  {
    const need = { SP: [3, 4, 0], CPC: [0, 0, 2] };
    const both = (no, qty) => make({ need, orders: [[no, qty]] });
    ok('less New development: the total is Replenishment\'s', same(lanes(both(SEA, 4)), [3, 4, 2]) && both(SEA, 4).free() === 9);
    ok('its own column first, the rest of Replenishment from Air on', same(lanes(both(AIR, 5)), [5, 4, 0]), lanes(both(AIR, 5)).join());
    ok('a column bigger than Replenishment\'s takes from the later ones', same(lanes(both(SEA, 7)), [2, 7, 0]), lanes(both(SEA, 7)).join());
    ok('more New development: the total is its own', same(lanes(both(SEA, 12)), [0, 12, 0]) && both(SEA, 12).free() === 12);
    ok('one store viewed: still never both', same(both(AIR, 5).shares(20, ['SP']), split(0, 0, 5, 2, 0, 13)), JSON.stringify(both(AIR, 5).shares(20, ['SP'])));
  }

  console.log('== pending pieces: each dispatch once ==');
  {
    const after = (rows, o) => pendingOf(make(Object.assign({ rows: stockOf(40, rows) }, o)));
    const named = (qty, no) => ({ orders: [{ orderNo: no || SEA, qty }] });
    const later = { createdAt: iso(Date.parse('2026-11-05T06:00:00Z')) }, earlier = { createdAt: iso(Date.parse('2026-10-20T06:00:00Z')) };
    ok('an issue naming the order', same(after([row('i', 'ISSUE', 3, named(3))]), [[SEA, 9]]));
    ok('a dispatch naming the order', same(after([sent('a', 3, Object.assign(named(3), later))]), [[SEA, 9]]));
    ok('…even once shipped', same(after([sent('a', 3, Object.assign({ fbaShippedAt: iso(NOW - 900 * HOUR) }, named(3), later))]), [[SEA, 9]]));
    ok('returned pieces are pending again', same(after([sent('a', 5, Object.assign({ fbaReturned: 2 }, named(5), later))]), [[SEA, 9]]));
    ok('a dispatch naming no order, on or after the order date', same(after([sent('a', 3, later)]), [[SEA, 9]]));
    ok('…on the order date itself', same(after([sent('a', 3, { createdAt: DAY + 'T06:00:00Z' })]), [[SEA, 9]]));
    ok('…before it: not this order\'s', same(after([sent('a', 3, earlier)]), [[SEA, 12]]));
    ok('a dispatch naming another order is that order\'s', same(after([sent('a', 3, Object.assign(named(3, 'AMZ-9'), later))]), [[SEA, 12]]));
    ok('part named, part not: 5 pieces, once', same(after([sent('a', 5, Object.assign(named(3), later))]), [[SEA, 7]]));
    ok('another SKU\'s dispatch changes nothing', same(after([sent('a', 3, Object.assign({ sku: 'B' }, later))]), [[SEA, 12]]));
    const two = { orders: [[AIR, 5, {}, { orderDate: '2026-11-03' }], [SEA, 5]] };
    ok('pieces naming no order go to the oldest order first, each once', same(after([sent('a', 7, later)], two), [[AIR, 3]]), JSON.stringify(after([sent('a', 7, later)], two)));
    ok('an order sent in full is gone', same(after([sent('a', 12, later)]), []));

    const need = { SP: [10, 0, 0] };
    const ten = rows => make({ need, orders: [[AIR, 10]], rows: stockOf(40, rows) }).free();
    ok('New development 10 and Replenishment 10: FBA 10, not 20', ten([]) === 10);
    ok('send 4: 6 left on both sides', ten([sent('a', 4, { createdAt: iso(NOW) })]) === 6);
    ok('send 10 naming no order: nothing left', ten([sent('a', 10, { createdAt: iso(NOW) })]) === 0);
    ok('send 10 naming the order: nothing left', ten([sent('a', 10, Object.assign({ createdAt: iso(NOW) }, named(10, AIR)))]) === 0);
  }

  console.log('== only what Amazon lists ==');
  {
    const need = { SP: [3, 0, 0] };
    ok('listed but inactive counts as listed', make({ listing: 'inactive' }).free() === 12);
    for (const [st, words] of [['not', /not listed on Amazon.*listing team.*then try again/], ['unknown', /could not be checked.*press Refresh/], ['unread', /could not be checked.*press Refresh/]]) {
      const S = make({ listing: st });
      ok(`${st}: nothing may go for New development`, S.free() === 0 && words.test(refusal(S, 1)), refusal(S, 1));
      ok(`${st}: the pieces stay in their column, not Excess`, same(S.shares(), split(0, 0, 0, 12, 0, 8)));
      const R = make({ listing: st, need });
      ok(`${st}: Replenishment's own part goes as before`, R.free() === 3 && refusal(R, 3) === '' && refusal(R, 4) !== '', String(R.free()));
      ok(`${st}: a release still lets pieces go`, make({ listing: st, releases: { r: { sku: 'A', pcs: 2, left: 2, at: 't' } } }).free() === 2);
      ok(`${st}: an article with no New development order is untouched`, store({ listing: st }).free() === 9 && !/New development article|listing of/.test(refusal(store({ listing: st }), 10)));
    }
    ok('listed: a refusal says nothing about the listing', !/not listed|could not be checked/.test(refusal(make(), 13)) && /free for FBA/.test(refusal(make(), 13)));
  }

  console.log('== every way to FBA ==');
  for (const [name, way] of Object.entries(WAYS)) {
    if (!way.types.includes('FBA')) continue;
    const a = await way.go(newDev(), 12, 'FBA');
    ok(`${name}: the pending pieces may leave`, a.said === '' && a.S.writes.length === 1, a.said);
    ok(`${name}: the sales orders and listings are read before saving`, a.S.reads.includes('pt_salesOrders') && a.S.reads.includes('listings'), a.S.reads.join());
    const b = await way.go(newDev(), 13, 'FBA');
    ok(`${name}: one more may not`, b.said !== '' && b.S.writes.length === 0, b.said);
    const c = await way.go(newDev({ listing: 'not' }), 1, 'FBA');
    ok(`${name}: not listed, refused with what to do`, /not listed on Amazon/.test(c.said) && c.S.writes.length === 0, c.said);
    const d = await way.go(newDev({ salesDown: true }), 1, 'FBA');
    ok(`${name}: sales orders unreadable, nothing goes for New development`, /sales orders could not be read.*ask an admin/.test(d.said) && d.S.writes.length === 0, d.said);
  }
  {
    const edit = async qty => { const S = editStore(newDev({ rows: stockOf(25, [movement('FBA', 5, { createdAt: iso(NOW) })]) })); return { S, said: await S.ctx.fgiEditApply('F', { qty }) }; };
    ok('an edit sends more: up to what is still pending', (await edit(12)).said === '' && (await edit(13)).said !== '');
    const S = make();
    S.run('FGA_SALES = { rows: [], err: "" }');
    await S.ctx.fgiStockReread();
    ok('a save takes the sales orders as they are now', S.free() === 12);
    const T = make();
    T.run('FGA_SALES = { rows: [], err: "" }');
    const spent = await T.run('fgiReleaseSpend([{ sku: "A", qty: 12, current: 20 }])');
    ok('so does the last check before an FBA write', spent.err === '', spent.err);
  }

  console.log('== issues ==');
  {
    const S = make({ orders: [['B2B-1', 12]] });
    ok('an issue for a New development order takes Excess only', issueWhy(S, 8, forOrder('B2B-1', 8)) === '' && issueWhy(S, 9, forOrder('B2B-1', 9)) !== '');
  }

  console.log('== sales orders unreadable ==');
  {
    const S = make({ salesDown: true, orders: [['B2B-1', 4], [SEA, 5]], sales: undefined });
    await S.ctx.fgiHoldReread();
    ok('as before: no order is New development', same(S.shares(), split(0, 4, 0, 0, 0, 16)), JSON.stringify(S.shares()));
    ok('the console says why', S.warns.some(w => /sales orders could not be read.*permission denied/.test(w)));
  }

  console.log('== on the stock list ==');
  const screen = o => {
    const S = make(o);
    Object.assign(S.ctx, { fgiMaster: () => ({ subtype: 'Quilt', color: 'Blue', size: 'King' }), fgiStatus: () => ({ txt: 'ok' }), LST_PILL: { listed: ['', ''], not: ['', 'Not listed'], unknown: ['', ''], inactive: ['', ''] },
      ptFillSelect: () => {}, FGI_PICK: { stock: new Set() }, ptImgCell: () => '<td></td>', ptImgInner: () => '', ptImgFill: () => {}, ptImgPatch: null, mobOn: () => !!(o && o.phone), esc: text,
      ptOpenDialog: cfg => { S.dialog = cfg; }, lstCanRefresh: () => false });
    S.run(line('inventory/fg-change-remove.js', 'const fgiDmy') + cut(appFile('inventory/finished-goods.js'), 'const FGI_NUM_COLS', 'function fgiRenderStock(')
      + whole('inventory/finished-goods.js', 'fgiRenderStock') + whole('inventory/finished-goods.js', 'fgiCard') + whole('inventory/amazon-listing-status.js', 'lstRenderAlerts'));
    S.draw = () => { S.run('fgiRenderStock(new Map([["A", { sku: "A", current: 20, opening: 20, received: 0, issued: 0, fba: 0, pending: 0 }]]))'); return S.box('fgTable').innerHTML; };
    return S;
  };
  {
    const o = { need: { SP: [20, 0, 0] } };   // Air holds Replenishment pieces only
    const table = screen(o).draw(), card = screen(Object.assign({ phone: true }, o)).draw();
    for (const [where, html] of [['table', table], ['card', card]]) {
      ok(`${where}: the figure with New development pieces opens its orders`, html.includes('data-fgand="A" data-fgalane="sea"'), html);
      ok(`${where}: a figure without any does not`, !html.includes('data-fgalane="air"') && !html.includes('data-fgalane="awd"'));
    }
    ok('nothing in stock for it: nothing to press', !screen({ web: 20 }).draw().includes('data-fgand'));
    ok('switch off: nothing to press', !screen({ ls: '0' }).draw().includes('data-fgand'));
    const down = screen({ salesDown: true, sales: undefined });
    await down.run('fgaSalesRead()');
    down.draw();
    ok('unread sales orders are said above the list', /sales orders could not be read/.test(down.box('fgMsg').textContent) && down.box('fgMsg').className === 'err');
    ok('a press on the figure opens the box', appFile('inventory/finished-goods.js')
      .includes("closest('[data-fgand]'); if (nd) return fgaNewDevOpen(nd.getAttribute('data-fgand'), nd.getAttribute('data-fgalane'));"));
    ok('opening the screen reads the sales orders', /await Promise\.all\(\[lstLoad\(\)[^\]]*fgaSalesRead\(\)/.test(appFile('inventory/finished-goods.js')));
  }

  console.log('== the box ==');
  {
    const S = screen({ orders: [[SEA, 12], [AIR, 3]], rows: stockOf(40, [row('i', 'ISSUE', 2, { orders: [{ orderNo: SEA, qty: 2 }] })]) });
    S.run('fgaNewDevOpen("a", "sea")');
    const box = S.dialog, cells = [...box.html.split('<tbody>')[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
    ok('it lists that column\'s orders: order, channel, date, ordered, issued, pending', same(cells, [SEA + ' New dev', 'Amazon', '01/11/2026', '12', '2', '10']), cells.join('|'));
    ok('it names the column and the article', box.title === 'New development orders in FBA Sea' && box.subtitle === 'A · Quilt · Blue · King' && /^10 pending/.test(box.note), box.note);
    ok('no buyer is named', !/Made Up Buyer/.test(box.html + box.note + box.subtitle));
    ok('it is a box to read: nothing saved', !box.onSave && box.wide === true && S.writes.length === 0);
    const bad = screen({ orders: [['<img src=x>', 2]] });
    bad.run('fgaNewDevOpen("A", "air")');
    ok('an order number is shown as text', !bad.dialog.html.includes('<img') && bad.dialog.html.includes('&lt;IMG SRC=X&gt;'), bad.dialog.html);
    const un = screen({ listing: 'not' });
    un.run('fgaNewDevOpen("A", "sea")');
    ok('not listed: the box says what to do', /not listed on Amazon/.test(un.dialog.note), un.dialog.note);
  }

  console.log('== Needs listing on Amazon ==');
  {
    const alerts = o => {
      const S = screen(Object.assign({ listing: 'not' }, o));
      S.ctx.LST.alerts = { A: { sku: 'A', status: 'open' }, B: { sku: 'B', status: 'open' } };
      S.run('lstRenderAlerts()');
      return { S, rows: S.box('fgTable').innerHTML.split('<tr>').slice(2) };
    };
    const { rows } = alerts({ orders: [[SEA, 12], [AIR, 3]] });
    const a = rows.find(r => r.includes('>A</td>')) || '', b = rows.find(r => r.includes('>B</td>')) || '';
    ok('the row is tagged with each sales order and its pending pieces', a.split('New dev</span>').length === 3 && a.includes(SEA + ' · 12 pending') && a.includes(AIR + ' · 3 pending'), a);
    ok('a SKU with no New development order is not', b !== '' && !b.includes('New dev'), b);
    ok('switch off: no tag', !alerts({ ls: '0' }).S.box('fgTable').innerHTML.includes('New dev'));
    const down = screen({ salesDown: true, sales: undefined, listing: 'not' });
    await down.run('fgaSalesRead()');
    down.ctx.LST.alerts = {};
    down.run('lstRenderAlerts()');
    ok('unread sales orders are said there too', /sales orders could not be read/.test(down.box('fgMsg').textContent));
  }

  const { pass, fail } = counts();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL the suite stopped - ' + e.stack); process.exit(1); });
