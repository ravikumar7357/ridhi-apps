/* INDIA STORE: WHO EACH PIECE IS FOR (27 Nov: Photoshoot, Custom, FBA Air, FBA Sea, FBA AWD, then Excess).
 *   node tests/store-alloc-test.js      (FGA_MUT_FILE=<path under src/app> FGA_MUT_SRC=<file> tests a broken copy —
 *   teeth/teeth-store-alloc.js does)
 * Loads src/app/inventory/fg-store-alloc.js with fg-shop-hold.js and every way out of the store, with a made-up database. */
const { same, cut, line, whole, appFile, NOW, HOUR, iso, row, sent, ordLine, store, split, issueWhy, forOrder, KINDS, WAYS, editStore, movement, counts, check: ok } = require('./india-store-harness');

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
    ok('switch on: the Custom figure opens its orders, in the table and the card', html.includes('data-fgacustom="A"') && phone.includes('data-fgacustom="A"'));
    ok('switch off: nothing opens them', !off.includes('data-fgacustom') && !table({ ls: '0' }, true).html.includes('data-fgacustom'));
  }

  console.log('== the orders behind a Custom figure ==');
  {
    const book = (orderNo, qty, orderDate, over) => ordLine(orderNo, qty, Object.assign({ orderDate }, over));
    /* B2B-1 asks 4 (1 issued), ONL-2 asks 3 (newest), SHP-7 is a hand-raised order; the website: Ridhi SHP-5 (2 of 3 left), CPC #9 */
    const lines = [book('ONL-2', 3, '2026-11-20'), book('B2B-1', 4, '05/11/2026'), book('AMZ-3', 9, '2026-11-01'),
      book('SHP-5', 3, '2026-11-02', { shopOrderId: '5' }), book('B2B-9', 5, '2026-11-01', { sku: 'B' }), book('B2B-8', 2, '2026-11-01', { handedAt: 'x' })];
    const rows = n => [row('O', 'OPENING', n), row('I', 'ISSUE', 1, { orders: [{ orderNo: 'B2B-1', qty: 1 }] })];
    const web = { SP: { at: NOW, skus: { A: 2 }, orders: { A: [{ no: 'SHP-5', pcs: 2, of: 3, on: '2026-11-02' }] } },
      CPC: { at: NOW, skus: { A: 1 }, orders: { A: [{ no: '#9', pcs: 1, on: '2026-11-10' }] } } };
    const behind = (stock, hold, o) => {
      const S = store(Object.assign({ lines, rows: rows(stock + 1) }, o));
      S.run(line('inventory/fg-change-remove.js', 'const fgiDmy'));
      S.ctx.FGI.set._shopHold = hold || web;
      return { S, list: JSON.parse(S.run('JSON.stringify(fgaCustomOrders("a", fgiOf("A").current))')) };
    };
    const brief = list => list.map(o => [o.no, o.channel, o.on, o.ordered, o.pending, o.counted]);
    const plenty = behind(20);
    ok('every order in Custom, oldest first, with its channel, date, ordered and pending', same(brief(plenty.list), [
      ['SHP-5', 'Shopify Ridhi', '2026-11-02', 3, 2, 2], ['B2B-1', 'B2B', '2026-11-05', 4, 3, 3],
      ['#9', 'Shopify CPC', '2026-11-10', 1, 1, 1], ['ONL-2', 'Online', '2026-11-20', 3, 3, 3]]), JSON.stringify(plenty.list));
    const short = behind(4);
    ok('short stock is counted oldest first', same(short.list.map(o => o.counted), [2, 2, 0, 0]), JSON.stringify(short.list));
    for (const n of [0, 1, 4, 9, 20]) {
      const T = behind(n);
      ok(`stock ${n}: the rows add up to the Custom figure`, T.list.reduce((s, o) => s + o.counted, 0) === T.S.shares().custom, JSON.stringify(T.list));
    }
    ok('below nought: nothing counted, the orders still listed', same(behind(-2).list.map(o => o.counted), [0, 0, 0, 0]));
    ok('a prefix with no channel of its own is Other', behind(9, web, { lines: [book('XYZ-1', 1, '2026-11-01')] }).list[0].channel === 'Other');
    ok('an order with no date comes last', behind(20, web, { lines: [book('B2B-6', 1, '')] }).list.slice(-1)[0].no === 'B2B-6');
    const old = behind(20, { SP: { at: NOW, skus: { A: 2 } }, CPC: web.CPC }).list;
    const unnamed = old.find(o => /^Website orders/.test(o.no));
    ok('a figure without its orders is one line, after the dated ones', old.slice(-1)[0] === unnamed
      && unnamed.no === 'Website orders (details after Shopify Orders is opened again)' && unnamed.pending === 2 && unnamed.counted === 2
      && unnamed.channel === 'Shopify Ridhi' && unnamed.ordered === null, JSON.stringify(old));
    const wrong = behind(20, { SP: { at: NOW, skus: { A: 5 }, orders: web.SP.orders }, CPC: { at: NOW, skus: {} } }).list;
    ok('orders that do not add up to the figure are not shown for it', wrong.filter(o => o.channel === 'Shopify Ridhi').length === 1
      && wrong.some(o => /^Website orders/.test(o.no) && o.pending === 5), JSON.stringify(wrong));

    const opened = (stock, hold, over) => {
      const { S } = behind(stock, hold, over);
      let box = null;
      Object.assign(S.ctx, { ptOpenDialog: cfg => { box = cfg; }, fgiMaster: () => ({ subtype: 'Quilt', color: 'Blue', size: 'King' }),
        esc: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') });
      S.run('fgaCustomOpen("a")');
      return { S, box };
    };
    const { box, S } = opened(4);
    ok('the box names the article once', box.subtitle === 'A · Quilt · Blue · King', box.subtitle);
    ok('it says what is counted and what is not covered', /^4 piece\(s\) in stock .*oldest.* 5 pending piece\(s\) are not covered/.test(box.note), box.note);
    const cells = tr => [...tr.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m => m[1]);
    const trs = box.html.split('<tbody>')[1].split('</tr>').map(cells).filter(c => c.length);
    ok('a row: ordered, issued, pending, from stock, not covered', same(trs[1], ['B2B-1', 'B2B', '05/11/2026', '4', '1', '3', '2', '1']), JSON.stringify(trs));
    ok('it is a box to read: nothing to save', !box.onSave && box.wide === true);
    ok('opening it writes nothing', S.writes.length === 0);
    const bad = opened(20, { SP: { at: NOW, skus: { A: 1 }, orders: { A: [{ no: '<img src=x>', pcs: 1 }] } }, CPC: web.CPC }).box;
    ok('an order number is shown as text', !bad.html.includes('<img') && bad.html.includes('&lt;img src=x&gt;'));
    const unnamedRow = opened(20, { SP: { at: NOW, skus: { A: 2 } }, CPC: web.CPC }).box.html;
    ok('the line without details shows no ordered or issued figure', /\(details after[^<]*<\/td>(<td[^>]*>[^<]*<\/td>){2}<td class="num">—<\/td><td class="num">—<\/td><td class="num">2</.test(unnamedRow), unnamedRow);

    const click = appFile('inventory/finished-goods.js');
    ok('a press on the figure opens the box', click.includes("closest('[data-fgacustom]'); if (cu) return fgaCustomOpen(cu.getAttribute('data-fgacustom'));"));
    const row0 = (custom, fn) => store().run(`${fn}({ sku: "A", current: 5, alloc: { photo: 0, custom: ${custom}, air: 3, sea: 0, awd: 0, excess: 1 } })`);
    for (const fn of ['fgaCells', 'fgaCardFigs']) {
      const some = row0(6, fn), none = row0(0, fn);
      ok(`${fn}: a Custom figure above 0 opens its orders, and only it`, some.split('data-fgacustom="A"').length === 2 && /data-fgacustom[^>]*>(Custom <b>)?6/.test(some), some);
      ok(`${fn}: a Custom figure of 0 does not`, !none.includes('data-fgacustom') && !none.includes('<button'), none);
    }
  }

  console.log('== the list holds only what is in stock ==');
  {
    const bal = (sku, current, pending) => ({ sku, current, opening: 0, received: 0, issued: 0, fba: 0, pending: pending || 0 });
    /* AB-1 has stock, AB-10 none (but 4 on the way from press), AB-2 is below nought, OLD-1 has history only, no master row */
    const STOCK = [bal('AB-1', 5), bal('AB-10', 0, 4), bal('AB-2', -1), bal('OLD-1', 0)];
    const MASTER = [{ sku: 'AB-1', brand: 'Ridhi', color: 'Blue' }, { sku: 'AB-10', color: 'Green' }, { sku: 'AB-2', color: 'Red' },
      { sku: 'NEW-9', color: 'Mustard' }];
    const list = (o = {}) => {
      const S = store(o);
      const master = o.master || MASTER;
      Object.assign(S.ctx, { fgiStatus: () => ({ txt: 'ok' }), lstOf: () => ({ st: 'unknown' }), LST_PILL: { unknown: ['', ''] }, ptFillSelect: () => {},
        FGI_PICK: { stock: new Set() }, ptImgCell: () => '<td></td>', ptImgInner: () => '', ptImgFill: () => {}, ptImgPatch: null, mobOn: () => !!o.phone,
        PTG: { mdb: master }, mdbOf: sku => master.find(m => m.sku === String(sku).trim().toUpperCase()),
        esc: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') });
      S.run('const fgiMaster = sku => mdbOf(sku) || {};' + cut(appFile('inventory/finished-goods.js'), 'const FGI_NUM_COLS', 'function fgiRenderStock(')
        + whole('inventory/finished-goods.js', 'fgiRenderStock') + whole('inventory/finished-goods.js', 'fgiCard'));
      S.box('fgQ').value = o.q || '';
      S.box('fgZero').checked = !!o.zero;
      S.box('fgBrand').value = o.brand || '';
      S.ctx.stock = new Map(STOCK.map(b => [b.sku, b]));
      S.run('fgiRenderStock(stock)');
      return { S, skus: [...S.ctx.FGI.shown].map(r => r.sku), msg: S.box('fgMsg').textContent, html: S.box('fgTable').innerHTML };
    };
    const all = list();
    ok('only SKUs with stock now, a count below nought included; nothing from the master is added', same(all.skus, ['AB-1', 'AB-2']), all.skus.join());
    ok('the count line speaks of what is in stock', /^2 SKU\(s\) in stock now/.test(all.msg) && !/on record/.test(all.msg) && /NEGATIVE/.test(all.msg), all.msg);
    const card = list({ phone: true }).html;
    ok('the table and the card list the same', [all.html, card].every(h => h.includes('AB-2') && !h.includes('AB-10') && !h.includes('OLD-1')));
    ok('the export follows the list', same([...all.S.run('FGI.shown.map(fgaExportRow)')].map(r => r[0]), ['AB-1', 'AB-2']));
    const off = list({ ls: '0' });
    ok('switch off: every SKU on record, as before', off.skus.length === 4 && /4 SKU\(s\) on record/.test(off.msg), off.msg);
    ok('switch off: the tick still keeps pieces from press', same(list({ ls: '0', zero: true }).skus, ['AB-1', 'AB-10', 'AB-2']));
    ok('switch off: a search says nothing new', !/India Store but|does not exist|not in the India Store/.test(list({ ls: '0', q: 'zzz' }).msg));
    ok('the screen hides the tick with the switch on', appFile('inventory/finished-goods.js')
      .includes("$('fgZeroWrap').classList.toggle('hide', view !== 'stock' || (typeof fgaOn === 'function' && fgaOn()));"));

    console.log('== searching it ==');
    const said = (q, o) => { const first = list(Object.assign({ q }, o)).msg.split(' · ')[0]; return /^\d+ SKU/.test(first) ? '' : first; };
    const is = (name, q, want, o) => { const got = said(q, o); ok(name, got === want, JSON.stringify(got)); };
    is('a SKU with stock: nothing to say', 'ab-1', '');
    is('in the master, no stock: not in the India Store', ' new-9 ', 'SKU NEW-9 is not in the India Store.');
    is('history only, no stock: not in the India Store', 'old-1', 'SKU OLD-1 is not in the India Store.');
    is('only pieces on the way from press: not in the India Store', 'AB-10', 'SKU AB-10 is not in the India Store.');
    is('nowhere: does not exist', 'zz-7', 'SKU ZZ-7 does not exist.');
    is('with stock but filtered out: hidden by the filters', 'ab-2', 'SKU AB-2 is in the India Store but hidden by the filters.', { brand: 'Ridhi' });
    is('a part of a code that lists rows: as before', 'ab', '');
    is('a word that lists rows: as before', 'blue', '');
    is('a word matching only products without stock', 'mustard', 'Matching products are not in the India Store.');
    is('a word matching only history', 'old', 'Matching products are not in the India Store.');
    is('a word whose stock is filtered out', 'red', 'Matching products are in the India Store but hidden by the filters.', { brand: 'Ridhi' });
    is('a whole code filtered out is said', 'ab-1', 'SKU AB-1 is in the India Store but hidden by the filters.', { brand: 'Other' });
    const none = { master: [] };
    is('no Master Database: never "does not exist"', 'zz-7', '"zz-7" could not be checked — the Master Database was not read. Press Refresh to try again.', none);
    is('no Master Database: history still answers', 'old-1', 'SKU OLD-1 is not in the India Store.', none);
    const typed = list({ q: '<img src=x>', phone: true });
    ok('typed text is shown as text', !/<img src=x/i.test(typed.html) && /&lt;IMG SRC=X&gt; does not exist/.test(typed.html), typed.html);
    ok('no search and nothing listed keeps the old words', list({ phone: true, brand: 'Other' }).html.includes('No SKU matches these filters.'));
    const E = store({ rows: [] });
    Object.assign(E.ctx, { FGI_KINDS: KINDS, fgiRecvOrderCheck: () => ({}) });
    E.ctx.FGI.shown = [];
    E.run(whole('inventory/fg-other-movements.js', 'fgiEntrySave'));
    Object.entries({ fgmType: 'RECEIVE', fgmSku: 'A', fgmQty: '3', fgmWho: 'x' }).forEach(([k, v]) => { E.box(k).value = v; });
    const saved = await E.ctx.fgiEntrySave();
    ok('+ Stock entry still receives a SKU the list does not hold', saved === '' && E.writes.length === 1, saved);
  }

  console.log('== the view list ==');
  {
    const hidden = o => { const S = store(o); S.run(whole('inventory/fg-store-alloc.js', 'fgaTrimViews') + 'fgaTrimViews()'); return S.box('fgPendOpt').hidden; };
    ok('switch on: "Waiting to be counted in" is not offered', hidden({}) === true);
    ok('switch off: it is offered as before', hidden({ ls: '0' }) === false);
    ok('the screen asks for it, and the choice carries the name it hides', appFile('inventory/finished-goods.js').includes('fgaTrimViews();')
      && require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'index.html'), 'utf8').includes('value="pending" id="fgPendOpt"'));
  }

  const { pass, fail } = counts();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL the suite stopped - ' + e.stack); process.exit(1); });
