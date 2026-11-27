/* INDIA STORE: WHO EACH PIECE IS FOR (27 Nov: Photoshoot, Custom, FBA Air, FBA Sea, FBA AWD, then Excess).
 *   node tests/store-alloc-test.js      (FGA_MUT_FILE=<path under src/app> FGA_MUT_SRC=<file> tests a broken copy —
 *   teeth/teeth-store-alloc.js does)
 * Loads src/app/inventory/fg-store-alloc.js with fg-shop-hold.js and every way out of the store, with a made-up database. */
const { same, cut, whole, appFile, NOW, HOUR, iso, row, sent, ordLine, store, split, issueWhy, forOrder, WAYS, editStore, movement, counts, check: ok } = require('./india-store-harness');

(async () => {
  console.log('== the switch ==');
  {
    const on = o => store(o).run('fgaOn()');
    ok('off by default away from the test website', on({ ls: null }) === false);
    ok('on by itself on the test website', on({ ls: null, hold: null, testSite: true }) === true);
    ok('turned off on the test website', on({ ls: '0', testSite: true }) === false);
    ok('turned on for one computer', on({}) === true);
    ok('needs the website hold on', on({ hold: '0' }) === false);
  }
  {
    const S = store({ ls: '0' });
    ok('switch off: FBA takes all but the website pieces, as before', S.free() === 18);
    ok('switch off: no issue is refused', issueWhy(S, 20) === '');
    S.ctx.FGI.set._fbaNeed = undefined;
    ok('switch off: no FBA need is needed', S.run('fgiHoldRefusal([{ sku: "A", qty: 18, current: 20 }])') === '');
    ok('switch off: a save does not read the order book', await S.ctx.fgiStockReread() === '' && S.reads.length === 0);
    await S.ctx.fgiHoldReread();
    await S.run('fgaNeedNote()'); await S.run('fgaSignInCheck()');
    ok('switch off: nothing is noted or asked', S.writes.length === 0 && S.asked.length === 0 && S.ctx.FGI.set._fbaNeed === undefined);
  }

  console.log('== sharing the stock ==');
  {
    ok('Custom, Air, Sea, AWD, then Excess', same(store().shares(), split(0, 6, 3, 4, 2, 5)), JSON.stringify(store().shares()));
    ok('short stock is given out in that order', same(store().shares(11), split(0, 6, 3, 2, 0, 0)));
    ok('very short stock goes to Custom', same(store().shares(5), split(0, 5, 0, 0, 0, 0)));
    ok('below nought: all nought', same(store().shares(-3), split(0, 0, 0, 0, 0, 0)));
    ok('more receipts follow the same order', same(store().shares(14), split(0, 6, 3, 4, 1, 0)));
    ok('the view picker narrows FBA only', same(store().shares(20, ['SP']), split(0, 6, 3, 4, 0, 7)) && same(store().shares(20, ['CPC']), split(0, 6, 0, 0, 2, 12)));
    ok('both stores\' need adds up', store({ need: { SP: [1, 0, 0], CPC: [2, 0, 0] } }).shares().air === 3);
    ok('Amazon packs become pieces (recorded pack)', same(store({ pack: '2', need: { SP: [3, 1, 0] } }).shares(), split(0, 6, 6, 2, 0, 6)));
    ok('…and by the app\'s pack rule when none is recorded', store({ rulePack: 4, need: { SP: [1, 0, 0] } }).shares().air === 4);
  }

  console.log('== who counts as Custom ==');
  {
    const custom = (lines, rows, web) => store({ lines, rows: [row('O', 'OPENING', 50)].concat(rows || []), web: web || 0 }).shares(50).custom;
    ok('open orders add up', custom([ordLine('B2B-1', 4), ordLine('ONL-2', 3)]) === 7);
    ok('Amazon orders do not count', custom([ordLine('AMZ-1', 4)]) === 0);
    ok('a Shopify order\'s own line is left to the website figure: not counted twice', custom([ordLine('SHP-1', 4, { shopOrderId: '9' })], [], 4) === 4);
    ok('closed and handed-over lines do not count', custom([ordLine('B2B-1', 4, { shopDoneAt: 'x' }), ordLine('SHP-2', 3, { handedAt: 'x' })]) === 0);
    ok('issued to the order (named on the row\'s list) is taken off', custom([ordLine('B2B-1', 4)], [row('I', 'ISSUE', 1, { orders: [{ orderNo: 'B2B-1', qty: 1 }] })]) === 3);
    ok('completed from stock is taken off', custom([ordLine('B2B-1', 4)], [row('I', 'ISSUE', 3, { stockForOrder: 'B2B-1' })]) === 1);
    ok('an issue for another order is not', custom([ordLine('B2B-1', 4)], [row('I', 'ISSUE', 3, { stockForOrder: 'B2B-2' })]) === 4);
  }

  console.log('== dispatches already on the way ==');
  {
    const lanes = rows => { const s = store({ web: 0, lines: [], rows: [row('O', 'OPENING', 100)].concat(rows) }).shares(100); return [s.air, s.sea, s.awd]; };
    ok('waiting and accepted come off Air first, then Sea, then AWD', same(lanes([sent('a', 2), sent('b', 3, { fbaAcceptedAt: 'x' })]), [0, 2, 2]));
    ok('…however old', same(lanes([sent('a', 8, { createdAt: iso(NOW - 900 * HOUR) })]), [0, 0, 1]));
    ok('shipped before the Amazon figures were read: Amazon has it', same(lanes([sent('a', 8, { fbaShippedAt: 'x' })]), [3, 4, 2]));
    ok('no readable shipping time: made after the figures counts', same(lanes([sent('a', 2, { fbaShippedAt: '', createdAt: iso(NOW), fbaAcceptedAt: 'x' })]), [1, 4, 2]));
    ok('made before them but shipped after: still taken off', same(lanes([sent('a', 2, { createdAt: iso(NOW - 900 * HOUR), fbaShippedAt: iso(NOW) })]), [1, 4, 2]));
    ok('made and shipped after them: once', same(lanes([sent('a', 2, { createdAt: iso(NOW), fbaShippedAt: iso(NOW) })]), [1, 4, 2]));
    ok('not shipped and new: once, not twice', same(lanes([sent('a', 2, { createdAt: iso(NOW) })]), [1, 4, 2]));
    ok('returned pieces are not on the way', same(lanes([sent('a', 5, { fbaReturned: 4 }), sent('b', 2, { fbaReturned: 2 })]), [2, 4, 2]));
    ok('history from the sheet is not on the way', same(lanes([sent('a', 8, { source: 'sheet: x' })]), [3, 4, 2]));
    const S = store({ web: 0, lines: [], rows: [row('O', 'OPENING', 100), sent('a', 2, { issuedFor: 'CPC FBA' })] });
    ok('a view takes off that account\'s dispatches only', S.shares(100, ['SP']).air === 3 && S.shares(100, ['CPC']).awd === 0);
  }

  console.log('== how old the figures are ==');
  {
    ok('24 hours old is still good', store({ age: 23.9 }).run('fgaNeedWhy()') === '');
    ok('over 24 hours is old', /over 24 hours old.*Replenishment/.test(store({ age: 25 }).run('fgaNeedWhy()')));
    ok('one store missing is missing', store().run('fgaNeedState({ SP: { snapAt: Date.now() } }).state') === 'missing');
    ok('the older store decides', store().run('fgaNeedState({ SP: { snapAt: Date.now() }, CPC: { snapAt: 5 } }).state') === 'stale');
  }

  console.log('== what an issue may take (stock 20: Custom 6, FBA 9, Excess 5) ==');
  {
    const S = store();
    ok('not for an order: Excess only', issueWhy(S, 5) === '' && /5 piece\(s\) free/.test(issueWhy(S, 6)));
    ok('for an order: its pending pieces and Excess', issueWhy(S, 9, forOrder('B2B-1', 9)) === '' && issueWhy(S, 10, forOrder('B2B-1', 10)) !== '');
    ok('never more of Custom than the order is waiting for', issueWhy(store({ lines: [ordLine('B2B-1', 1), ordLine('B2B-2', 9)] }), 5, forOrder('B2B-1', 5)) !== '');
    ok('only the pieces named for the order count', issueWhy(S, 8, forOrder('B2B-1', 2)) !== '' && issueWhy(S, 7, forOrder('B2B-1', 2)) === '');
    ok('an Amazon order takes Excess only', issueWhy(store({ lines: [ordLine('AMZ-1', 9)] }), 10, forOrder('AMZ-1', 10)) !== '');
    ok('a Shopify order takes its pending within the website figure', issueWhy(store({ lines: [ordLine('SHP-1', 2, { shopOrderId: '9' })] }), 11, forOrder('SHP-1', 11)) === ''
      && issueWhy(store({ lines: [ordLine('SHP-1', 2, { shopOrderId: '9' })] }), 12, forOrder('SHP-1', 12)) !== '');
    ok('two rows of one SKU are judged together', S.run('fgaIssueRefusal([{ sku: "A", qty: 3 }, { sku: "a", qty: 3 }])') !== '');
    ok('two rows on one order cannot each use its pending', S.run('fgaIssueRefusal([{ sku: "A", qty: 4, orders: [{ orderNo: "B2B-1", qty: 4 }] }, { sku: "A", qty: 6, orders: [{ orderNo: "B2B-1", qty: 6 }] }])') !== '');
    for (const [name, o] of [['old', { age: 25 }], ['missing', { noNeed: true }], ['website figure old', { holdAt: NOW - 7 * HOUR }]]) {
      const T = store(o);
      ok(`figures ${name}: an issue not for an order is refused with what to do`, /then (try|press)|try again/.test(issueWhy(T, 1)), issueWhy(T, 1));
      ok(`figures ${name}: an order may still take its own pieces, and no Excess`, issueWhy(T, 4, forOrder('B2B-1', 4)) === '' && issueWhy(T, 5, forOrder('B2B-1', 5)) !== '');
    }
  }

  console.log('== what FBA may take ==');
  {
    const S = store();
    ok('Air + Sea + AWD only', S.free() === 9);
    ok('never Excess or Custom', /9 piece\(s\) free for FBA, not 10/.test(S.run('fgiHoldRefusal([{ sku: "A", qty: 10, current: 20 }])')));
    ok('old need: refused', /24 hours/.test(store({ age: 25 }).run('fgiHoldRefusal([{ sku: "A", qty: 1, current: 20 }])')));
    const rel = { r: { sku: 'A', pcs: 3, left: 3, reason: 'x', at: 't' } };
    const R = store({ releases: rel });
    ok('a release allows that many more', R.free() === 12);
    ok('never beyond the stock', store({ releases: { r: Object.assign({}, rel.r, { left: 99 }) } }).free() === 20);
    ok('only the pieces beyond the FBA share use it up', same(Object.assign({}, R.run('fgiReleasePlan(fgiHoldNode(), [{ sku: "A", qty: 11, current: 20 }], {}).used')), { r: 2 }));
    ok('within the share it is not touched', same(Object.assign({}, R.run('fgiReleasePlan(fgiHoldNode(), [{ sku: "A", qty: 9, current: 20 }], {}).used')), {}));
    ok('an admin may release when something is kept from FBA', R.run('fgiMayRelease("A", { photo: 0, custom: 0, excess: 1 })') === true && R.run('fgiMayRelease("A", { photo: 0, custom: 0, excess: 0 })') === false);
    const lines = S.run('fgiHoldCap([{ sku: "A", qty: 8, store: 20 }, { sku: "A", qty: 8, store: 20 }]).map(l => l.store)');
    ok('packing lines share what FBA may take', same([...lines], [9, 1]), JSON.stringify(lines));
    ok('the scanner says why', /free for FBA/.test(S.run('fgiHoldScanWhy("A", { o: 9 })')));
  }

  console.log('== every way out of the store ==');
  for (const [name, way] of Object.entries(WAYS)) {
    for (const t of way.types) {
      const o = t === 'ISSUE' && way.order ? { alloc: forOrder(way.order, 99) } : {};
      const limit = t === 'FBA' ? 9 : (o.alloc ? 9 : 5);
      const a = await way.go(o, limit, t);
      ok(`${name} ${t}: ${limit} may leave`, a.said === '' && a.S.writes.length === 1, a.said);
      const b = await way.go(o, limit + 1, t);
      ok(`${name} ${t}: ${limit + 1} may not`, b.said !== '' && b.S.writes.length === 0, b.said);
      const c = await way.go(Object.assign({ ls: '0' }, o), 18, t);
      ok(`${name} ${t}: switch off, as before`, c.said === '' && c.S.writes.length === 1, c.said);
      ok(`${name} ${t}: the order book is read again before saving`, a.S.reads.includes('ob') && a.S.reads.includes('shopProd') && a.S.reads.includes('pt_fgiLedger'), a.S.reads.join());
    }
    const down = await way.go({ bookDown: true }, 1, way.types[0]);
    ok(`${name}: the order book unreadable, nothing saved`, /could not be read/.test(down.said) && down.S.writes.length === 0, down.said);
  }
  {
    /* another PC sent 5 to FBA since this screen read the ledger */
    const rows = [row('O', 'OPENING', 20)];
    const a = await WAYS['entry form'].go({ rows, fresh: rows.concat(sent('x', 5)) }, 5, 'FBA');
    ok('a stale screen is judged on the ledger as it is now', /4 piece\(s\) free/.test(a.said) && a.S.writes.length === 0, a.said);
    const b = await WAYS['entry form'].go({ unread: '_fbaNeed' }, 1, 'FBA');
    ok('the need unreadable at save: nothing saved', /could not be checked/.test(b.said) && b.S.writes.length === 0, b.said);
  }

  console.log('== edits and returns ==');
  {
    const edit = async (type, qty, input, o) => {
      const S = editStore(Object.assign({ rows: [row('O', 'OPENING', 20 + qty), movement(type, qty)] }, o));
      return { S, said: await S.ctx.fgiEditApply('F', input) };
    };
    ok('more pieces on an issue: the extra comes from Excess', (await edit('ISSUE', 1, { qty: 5 })).said === '' && (await edit('ISSUE', 1, { qty: 7 })).said !== '');
    ok('fewer pieces need no figure', (await edit('ISSUE', 5, { qty: 2 }, { noNeed: true })).said === '');
    const order = { rows: [row('O', 'OPENING', 21), movement('ISSUE', 1, { stockForOrder: 'B2B-1' })] };
    ok('more pieces on an order\'s issue may take its pending ones', (await edit('ISSUE', 1, { qty: 10 }, order)).said === '' && (await edit('ISSUE', 1, { qty: 11 }, order)).said !== '');
    ok('FBA turned into an issue is judged as a new issue, its dispatch no longer on the way', (await edit('FBA', 5, { txnType: 'ISSUE' }, { web: 6 })).said === '' && (await edit('FBA', 5, { txnType: 'ISSUE' }, { web: 11 })).said !== '');
    ok('more pieces on a dispatch: only what FBA still asks for', (await edit('FBA', 5, { qty: 9 })).said === '' && (await edit('FBA', 5, { qty: 10 })).said !== '');
    ok('an issue turned into FBA is judged whole, as if never issued', (await edit('ISSUE', 9, { txnType: 'FBA' })).said === '' && (await edit('ISSUE', 10, { txnType: 'FBA' })).said !== '');

    const returned = [row('O', 'OPENING', 20), sent('F', 5, { fbaReturned: 5, fbaShippedAt: 'x', fbaShipment: 'S1', createdAt: iso(NOW - 900 * HOUR) }), row('R', 'FBA_RETURN', 5, { linkedFbaId: 'F', fbaShipBack: 'S1' })];
    const back = async (how, o) => {
      const S = store(Object.assign({ rows: returned.map(r => Object.assign({}, r)) }, o));
      if (how === 'delete') {
        Object.assign(S.ctx, { FGI_PICK: { ledger: new Set() } });
        S.run(whole('inventory/fg-change-remove.js', 'fgiDeleteRun'));
        S.ctx.plan = { gone: ['R'], rows: [returned[2]], refused: [], skus: [], updates: { x: null }, pressBack: new Map(), fbaBack: new Map() };
        return { S, said: await S.run('fgiDeleteRun(plan)') };
      }
      Object.assign(S.ctx, { fbaCan: () => true, fbaFresh: async () => [{ id: 'F', row: S.ctx.FGI.rows[1] }], renderFba() {}, FBA_PILL: {} });
      S.ctx.fbaState = () => ({ st: 'shipped', open: 0 });
      S.run(whole('inventory/fba-ship-excel.js', 'fbaUndo'));
      return { S, said: await S.ctx.fbaUndo('F') };
    };
    for (const how of ['delete', 'undo']) {
      const a = await back(how, {});
      ok(how + ' of a return: within the FBA share, on a fresh order book', a.said === '' && a.S.writes.length === 1 && a.S.reads.includes('ob'), a.said + a.S.reads);
      const b = await back(how, { need: { SP: [4, 0, 0] } });
      ok(how + ' of a return: beyond it, refused', /free for FBA/.test(b.said) && b.S.writes.length === 0, b.said);
    }
  }

  {
    const named = movement('ISSUE', 3, { stockForOrder: 'B2B-1' });
    const toFba = async web => { const S = editStore({ web, rows: [row('O', 'OPENING', 23), Object.assign({}, named)] }); return { S, said: await S.ctx.fgiEditApply('F', { txnType: 'FBA', who: 'Ridhi FBA' }) }; };
    const a = await toFba(18), b = await toFba(15);
    ok('an issue to an order turned into FBA: the order is waiting for those pieces again', /free for FBA/.test(a.said) && a.S.writes.length === 0, a.said);
    ok('…and goes when FBA still has its share', b.said === '' && b.S.writes.length === 1, b.said);
    ok('an edit reads the order book again first', b.S.reads.includes('ob'));
    const S = store();
    S.db._fbaNeed.SP.skus.A = [9, 0, 0];
    await S.ctx.fgiStockReread();
    ok('a stock-out save takes the FBA need as it is now', S.shares().air === 9);
  }

  console.log('== noting the need ==');
  {
    const snap = (at, rows) => ({ at: new Date(at), rows, mode: 'full' });
    const planner = o => {
      const S = store(Object.assign({ noNeed: true }, o));
      Object.assign(S.ctx, { loadProd: async () => {}, replMasterLoad: async () => {}, replMaster: () => [1], replMasterSync() {}, STATUS_OVR: { STOP: 'Discontinue' }, REPL_STOP_RE: /discontinu/i, isDisc: () => false,
        isHiddenSku: s => s === 'HID',
        REPL: { SP: snap((o && o.snapAt) || NOW, [{ sku: 'a', airReq: 3, seaReq: 0, awdReq: 2 }, { sku: 'STOP', airReq: 9 }, { sku: 'HID', airReq: 9 }, { sku: 'NONE' }, { sku: 'HAND', airReq: 9, stopped: true }]),
          CPC: Object.assign(snap(NOW, [{ sku: 'A', seaReq: 1 }]), (o && o.cpc) || {}) } });
      return S;
    };
    const S = planner();
    await S.run('fgaNeedNote()');
    ok('each store notes its need in packs; stopped, hidden and empty SKUs are left out', same(S.db._fbaNeed.SP.skus, { A: [3, 0, 2] }) && same(S.db._fbaNeed.CPC.skus, { A: [0, 1, 0] }), JSON.stringify(S.db._fbaNeed));
    ok('with the time Amazon was read and who noted it', S.db._fbaNeed.SP.snapAt === NOW && S.db._fbaNeed.SP.by === 'store@test');
    await S.run('fgaNeedNote()');
    ok('unchanged: not written again', S.writes.length === 2);
    const should = (noted, snapAt, n) => S.run(`fgaShouldNote(${JSON.stringify(noted)}, { snapAt: ${snapAt}, skus: { A: [${n}] } })`);
    ok('newer figures replace; same figures only when changed; older never', should({ snapAt: 5, skus: { A: [1] } }, 6, 1) && should({ snapAt: 5, skus: { A: [1] } }, 5, 2)
      && !should({ snapAt: 5, skus: { A: [1] } }, 5, 1) && !should({ snapAt: 5, skus: {} }, 4, 2));
    const raced = planner({ before: set => set('pt_fgiSettings/_fbaNeed/SP', { snapAt: NOW + 5, skus: {} }) });
    await raced.run('fgaNeedNote()');
    ok('a newer note saved in between stays', raced.db._fbaNeed.SP.snapAt === NOW + 5);
    const no = planner({ planner: false }); await no.run('fgaNeedNote()');
    ok('only planners and admins note it', no.writes.length === 0);
    const slim = planner({ cpc: { mode: 'slim' } }); await slim.run('fgaNeedNote()');
    ok('the slim copy is never noted', !slim.db._fbaNeed.CPC);
    const refused = planner({ refused: true }); await refused.run('fgaNeedNote()');
    ok('a refused note is said in the console, without throwing', refused.warns.some(w => /not noted/.test(w)));
    const old = planner({ snapAt: NOW - 25 * HOUR }); await old.run('fgaNeedNote()'); await old.run('fgaNeedNote()');
    ok('old figures ask for a fresh round, once in the hour', old.asked.length === 1 && old.asked[0].inv === 'run' && old.asked[0].job === 'refresh');
    ok('fresh figures ask nothing', S.asked.length === 0);
  }
  {
    const asks = async (o, before) => { const S = store(Object.assign({ age: 25 }, o)); if (before !== undefined) S.saved.fbaNeedAskedAt = String(before); await S.run('fgaSignInCheck()'); await new Promise(r => setImmediate(r)); return S; };
    ok('sign-in: a planner asks when the figures are old', (await asks({})).asked.length === 1);
    ok('asked under an hour ago on this PC: not again', (await asks({}, NOW - HOUR / 2)).asked.length === 0);
    ok('asked over an hour ago: again', (await asks({}, NOW - 2 * HOUR)).asked.length === 1);
    ok('a missing need asks nothing', (await asks({ noNeed: true })).asked.length === 0);
    ok('store staff never ask', (await asks({ planner: false })).asked.length === 0);
    ok('the test website never asks', (await asks({ testSite: true })).asked.length === 0);
    ok('a failed ask never throws, and the console says why', (await asks({ askFails: true })).warns.some(w => /backend down/.test(w)));
  }

  console.log('== Finished Goods stock list ==');
  {
    const table = (o, phone) => {
      const S = store(o);
      Object.assign(S.ctx, { fgiMaster: () => ({}), fgiStatus: () => ({ txt: 'ok' }), lstOf: () => ({ st: 'unknown' }), LST_PILL: { unknown: ['', ''] }, ptFillSelect: () => {},
        FGI_PICK: { stock: new Set() }, ptImgCell: () => '<td></td>', ptImgInner: () => '', ptImgFill: () => {}, ptImgPatch: null, mobOn: () => !!phone });
      S.run(cut(appFile('inventory/finished-goods.js'), 'const FGI_NUM_COLS', 'function fgiRenderStock(') + whole('inventory/finished-goods.js', 'fgiRenderStock') + whole('inventory/finished-goods.js', 'fgiCard'));
      S.run('fgiRenderStock(new Map([["A", { sku: "A", current: 20, opening: 20, received: 0, issued: 0, fba: 0, pending: 0 }]]))');
      return { S, html: S.box('fgTable').innerHTML };
    };
    const { S, html } = table({});
    const heads = [...html.split('</thead>')[0].matchAll(/<th[^>]*>(.*?)<\/th>/g)].map(m => m[1]).slice(1);
    ok('the columns after the article', same(heads, ['SKU', 'Image', 'Brand', 'Item', 'Colour', 'Size', 'In Stock', 'Photoshoot', 'Custom', 'FBA Air', 'FBA Sea', 'FBA AWD', 'Excess', '']), heads.join());
    const figs = [...html.matchAll(/<td class="num"[^>]*>(.*?)<\/td>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
    ok('the seven figures', same(figs, ['20', '—', '6', '3', '4', '2', '5']), figs.join());
    ok('the buttons stay', ['data-fgrel', 'data-fgentry', 'data-fgskued', 'data-fgskudel'].every(b => html.includes(b)));
    ok('the export follows them', same([...S.run('fgaExportRow(FGI.shown[0])')].slice(6), [20, 0, 6, 3, 4, 2, 5]) && S.run('fgaExportHead()').length === 13);
    S.box('fgaView').value = 'CPC'; S.run('fgiRenderStock(new Map([["A", { sku: "A", current: 20, pending: 0 }]]))');
    ok('the view picker changes the FBA columns', S.ctx.FGI.shown[0].alloc.air === 0 && S.ctx.FGI.shown[0].alloc.awd === 2);
    ok('old figures are said above the list', /cannot be relied on.*24 hours/.test(table({ age: 25 }).S.box('fgMsg').textContent));
    const phone = table({}, true).html;
    ok('the phone card shows the same figures', /In Stock|in stock/i.test(phone) && ['Photoshoot <b>0', 'Custom <b>6', 'FBA Air <b>3', 'FBA Sea <b>4', 'FBA AWD <b>2', 'Excess <b>5'].every(x => phone.includes(x)) && !phone.includes('Out <b>'));
    const off = table({ ls: '0' }).html;
    ok('switch off: the old columns', off.includes('Shopify held') && off.includes('>Value<') && !off.includes('Excess'));
  }

  const { pass, fail } = counts();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL the suite stopped - ' + e.stack); process.exit(1); });
