/* INDIA STORE: FBA LISTS (28 Nov: the FBA team lists SKUs per lane and account; stock leaves only on Ship).
 *   node tests/fba-lists-test.js      (teeth/teeth-fba-lists.js runs it against broken copies) */
const { same, line, whole, appFile, NOW, HOUR, iso, row, sent, store, counts, check: ok } = require('./india-store-harness');

const LISTS = 'pt_fgiSettings/_fbaLists', DONE = 'pt_fgiSettings/_fbaListsDone';
const copy = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
/* the database hands records back with their fields in its own (sorted) order, and a compare-and-set minds the order */
const asRead = v => (v && typeof v === 'object' ? (Array.isArray(v) ? v.map(asRead)
  : Object.keys(v).sort().reduce((o, k) => Object.assign(o, { [k]: asRead(v[k]) }), {})) : v);

/* Stands in for the changes to fg-store-alloc.js and fg-shop-hold.js that fba-lists.js is written against:
 * the shares leave out what lists keep, an FBA-list want carries its own free share, and write() is told the releases used. */
function stubNeighbours(S) {
  const real = S.ctx.fgiFbaWrite;
  S.ctx.fgiFbaWrite = (wants, write) => { S.wants.push(copy(wants)); return real(wants, write); };
}

/** A store (20 of A; A asked: Air 3, Sea 4 for Ridhi, AWD 2 for CPC) with a database the lists really live in.
 *  o: { admin, approver, tabs, email, db (share another screen's database and ledger) } and the store's own. */
function lists(o = {}) {
  const S = store(Object.assign({ admin: false }, o));
  if (o.db) { Object.keys(S.db).forEach(k => delete S.db[k]); Object.assign(S.db, o.db.db); }
  const db = o.db ? o.db.db : S.db;
  const ledger = o.db ? o.db.ledger : new Map((o.rows || [row('O', 'OPENING', 20)]).map(r => [r._id, copy(r)]));
  const at = p => p.split('/').slice(1).reduce((v, k) => (v == null ? v : v[k]), db);
  const set = (p, v) => {
    const seg = p.split('/').slice(1), last = seg.pop(); let n = db;
    seg.forEach(k => { n = n[k] = n[k] || {}; });
    if (v === null) delete n[last]; else n[last] = copy(v);
  };
  Object.assign(S, { db, ledger, wants: [], alerts: [], patched: [] });
  S.ctx.ME = { email: o.email || 'team@test', admin: !!o.admin, fbaRepeatApprove: !!o.approver, tabs: o.tabs || ['fba'] };
  Object.assign(S.ctx, {
    spIsVendor: () => !!o.vendor, ptDtMs: () => 0,
    ptGetFresh: async p => { if (S.down && p.includes(S.down)) throw new Error('no signal'); return asRead(copy(at(p))); },
    ptGet: async p => (p === 'pt_fgiLedger' ? copy(Object.fromEntries(ledger)) : copy(ledger.get(p.split('/')[1]))),
    ptCas: async (p, expect, next) => {
      if (S.before) { const b = S.before; S.before = null; await b(); }
      if (!same(asRead(copy(at(p))), copy(expect))) return 'changed';
      set(p, next); return '';
    },
    ptPatch: async patch => {
      if (S.patchFails) throw new Error('offline');
      S.patched.push(copy(patch));
      Object.entries(patch).forEach(([k, v]) => {
        if (!k.startsWith('pt_fgiLedger/')) return set(k, v);
        if (v === null) ledger.delete(k.split('/')[1]); else ledger.set(k.split('/')[1], copy(v));
      });
      if (S.answerLost) { S.down = S.thenDown; throw new Error('answer lost'); }
    },
    lstAlertFor: async (sku, type, qty) => { S.alerts.push([sku, type, qty]); return ''; },
  });
  S.ctx.FGI.rows = [...ledger.values()].map(copy);
  S.run(line('core/helpers.js', 'const dTodayIndia') + line('core/helpers.js', 'const dAdd') + line('core/helpers.js', 'const ptDayWords')
    + line('inventory/fg-change-remove.js', 'const fgiDmy') + line('inventory/fba-dispatch.js', 'const fbaCan')
    + line('inventory/fg-other-movements.js', 'const FGI_FBA_ACCOUNTS') + 'const ptIsoDate = d => String(d || "").split("/").reverse().join("-");\n'
    + appFile('inventory/fg-fba-repeat.js') + appFile('inventory/fba-lists.js'));
  stubNeighbours(S);
  S.open = () => db._fbaLists || {};
  S.done = () => db._fbaListsDone || {};
  S.releaseLeft = id => db._shopHold.releases[id].left;
  S.make = (qty, over) => S.ctx.fblMake(Object.assign({ id: 'L1', account: 'Ridhi FBA', lane: 'sea', lines: [{ sku: 'A', qty }] }, over));
  S.pack = (n, id = 'L1') => S.ctx.fblPackSave(id, 'P1', { A: n });
  S.ship = (v, id = 'L1') => S.ctx.fblShip(id, Object.assign({ shipment: 'FBA15X', date: '2026-11-28' }, v));
  if (o.switch !== null) S.saved.fbaList = o.switch || '1';
  S.stock = () => [...ledger.values()].reduce((n, r) => n + S.ctx.fgiEffect(r), 0);
  S.movements = () => [...ledger.values()].filter(r => r.txnType === 'FBA');
  return S;
}
/** A packed Sea list of `qty` of A. */
async function packed(qty, o) {
  const S = lists(o);
  await S.make(qty);
  await S.pack(qty);
  return S;
}
const release = (left, over) => ({ R1: Object.assign({ sku: 'A', pcs: left, left, at: iso(NOW), by: 'admin' }, over) });

(async () => {
  console.log('== the switch ==');
  {
    const on = o => lists(Object.assign({ switch: null }, o)).run('fblOn()');
    const withLs = (v, testSite) => lists({ testSite, switch: v }).run('fblOn()');
    ok('off by default away from the test website', on({}) === false);
    ok('on by default on the test website', on({ testSite: true }) === true);
    ok("'1' turns it on, '0' off", withLs('1') === true && withLs('0', true) === false);
    ok('needs the store shares', on({ testSite: true, ls: '0' }) === false);
    const off = lists({ switch: null });
    ok('off: nothing is made', /switched off/.test(await off.make(2)) && Object.keys(off.open()).length === 0);
  }

  console.log('== what the lists keep ==');
  {
    const S = lists();
    const l = (status, store, lane, qty) => ({ status, store, lane, lines: { A: { sku: 'A', qty } } });
    const got = S.ctx.fblAllotted({ a: l('open', 'SP', 'air', 1), b: l('packed', 'SP', 'sea', 2), c: l('shipping', 'CPC', 'awd', 3),
      d: l('shipped', 'SP', 'air', 50), e: l('cancelled', 'SP', 'air', 50) });
    ok('open, packed and shipping lists, by store and lane', same(copy(got), { A: { total: 6, SP: [1, 2, 0], CPC: [0, 0, 3] } }), JSON.stringify(got));
  }

  console.log('== making ==');
  {
    const S = lists();
    const said = await S.make(4);
    const l = S.open().L1;
    ok('a list is saved with its account, store, lane and lines', said === '' && l.store === 'SP' && l.lane === 'sea' && l.status === 'open' && l.by === 'team@test'
      && same(l.lines, { A: { sku: 'A', qty: 4, packed: 0 } }), said);
    ok('no ledger row, no stock leaves', S.movements().length === 0 && S.stock() === 20);
    ok('the releases are asked with the lane share', same(S.wants[0], [{ sku: 'A', qty: 4, current: 20, list: true, share: 4 }]), JSON.stringify(S.wants));
    ok('the same form again saves nothing new', await S.make(4) === '' && S.wants.length === 1 && Object.keys(S.open()).length === 1);
    ok('the same form with another quantity is not silently taken as saved', /different list/.test(await S.make(3)) && S.open().L1.lines.A.qty === 4);
    ok('a second list gets only what is left of the share', /free for this FBA list/.test(await S.make(1, { id: 'L2' })));
  }
  {
    const S = lists();
    ok('over the lane share is refused', /has 4 piece\(s\) free for this FBA list, not 5/.test(await S.make(5)) && Object.keys(S.open()).length === 0);
    ok('another lane has its own share', await S.make(3, { lane: 'air' }) === '');
    ok('another store has its own share', await S.make(2, { id: 'L2', lane: 'awd', account: 'CPC FBA' }) === '' && S.open().L2.store === 'CPC');
    const both = lists({ need: { SP: [3, 4, 0], CPC: [0, 2, 2] } });
    ok('another store asking is not this list share', /free for this FBA list/.test(await both.make(5)));
    const R = lists({ releases: release(3) });
    ok('an admin release passes', await R.make(6) === '' && same(R.open().L1.released, { R1: 2 }) && R.releaseLeft('R1') === 1);
    const R2 = lists({ releases: release(3) });
    ok('but no further than share plus release', /free for this FBA list/.test(await R2.make(8)) && R2.releaseLeft('R1') === 3);
    const T = lists({ rows: [row('O', 'OPENING', 20)], releases: release(50) });
    T.db._fbaLists = { X: { status: 'open', store: 'CPC', lane: 'awd', lines: { A: { sku: 'A', qty: 18 } } } };
    ok('never more than the stock other lists have not kept', /has 2 piece/.test(await T.make(3)));
    const old = lists({ age: 30 });
    ok('old figures: refused before any release is looked at', /over 24 hours old/.test(await old.make(1)) && !old.wants.length);
    const bad = lists();
    ok('a part piece is refused', /whole number/.test(await bad.make(1.5)));
    ok('a lane and an account are needed', /lane/.test(await bad.make(1, { lane: 'road' })) && /account/.test(await bad.make(1, { account: 'x' })));
    ok('an empty list is refused', /at least one/.test(await bad.make(1, { lines: [] })));
    const no = lists({ tabs: [] });
    ok('without the FBA Dispatch tab: refused', /FBA team/.test(await no.make(1)));
    const down = lists(); down.down = '_fbaLists';
    const said = await down.make(1);
    ok('lists unreadable: said, nothing saved', /Nothing was saved.*no signal/i.test(said) && !down.db._fbaLists);
  }

  console.log('== two people making at once ==');
  {
    const A = lists(), B = lists({ db: A, email: 'bee@test' });
    A.before = () => B.make(3, { id: 'LB' });
    const said = await A.make(1, { id: 'LA' });
    ok('the second retries and both are saved', said === '' && Object.keys(A.open()).sort().join() === 'LA,LB' && A.wants.length === 2, said);
    const C = lists(), D = lists({ db: C });
    C.before = () => D.make(3, { id: 'LD' });
    const refused = await C.make(2, { id: 'LC' });
    ok('the retry is judged on the new figures', /free for this FBA list/.test(refused) && !C.open().LC, refused);
    const E = lists({ releases: release(3) }), F = lists({ db: E });
    E.before = () => F.make(1, { id: 'LF', lane: 'air' });
    await E.make(6, { id: 'LE' });
    ok('the releases of the beaten try are given back before the retry', E.releaseLeft('R1') === 1);
  }

  console.log('== sent to FBA in the past 7 days ==');
  {
    const rows = [row('O', 'OPENING', 21), sent('OLD', 1, { createdAt: iso(NOW - 48 * HOUR), fbaShippedAt: iso(NOW - 48 * HOUR) })];
    const S = lists({ rows });
    ok('anyone else is refused', /past 7 days/.test(await S.make(1)) && !S.db._fbaLists);
    for (const o of [{ approver: true }, { admin: true }]) {
      const H = lists(Object.assign({ rows }, o));
      ok('approver or admin makes it, on record', await H.make(1) === '' && H.open().L1.lines.A.repeatBy === 'team@test');
      await H.pack(1); await H.ship();
      ok('and the movement carries the approval', H.ledger.get('FBA-L1-1').fbaRepeatBy === 'team@test');
    }
  }

  console.log('== packing ==');
  {
    const S = lists();
    await S.make(4);
    ok('more than the list: refused', /no more than/.test(await S.pack(5)) && S.open().L1.status === 'open');
    ok('a SKU not on the list: refused', /not on this FBA list/.test(await S.ctx.fblPackSave('L1', 'P1', { B: 1 })));
    ok('a part piece: refused', /whole pieces/.test(await S.pack(1.5)));
    ok('packed is saved, no stock moves', await S.pack(3) === '' && S.open().L1.status === 'packed' && S.open().L1.lines.A.packed === 3
      && S.open().L1.packId === 'P1' && S.stock() === 20);
    await S.pack(0);
    ok('nothing packed: open again', S.open().L1.status === 'open');
    S.before = () => { S.db._fbaLists.L1 = Object.assign({}, S.db._fbaLists.L1, { status: 'cancelled' }); };
    ok('somebody else got there first: said', /somebody else/.test(await S.pack(2)) && S.open().L1.status === 'cancelled');
  }

  console.log('== shipping ==');
  {
    const U = lists(); await U.make(4);
    ok('not packed: refused', /Pack this/.test(await U.ship()) && U.movements().length === 0);
    const S = await packed(4);
    ok('more than packed: refused', /ship no more/.test(await S.ship({ qtyBySku: { A: 5 } })) && S.movements().length === 0);
    ok('no shipment id: refused', /shipment id/.test(await S.ship({ shipment: ' ' })));
    ok('nothing going: refused', /Nothing to ship/.test(await S.ship({ qtyBySku: { A: 0 } })) && S.open().L1.status === 'packed');
    const said = await S.ship();
    const r = S.ledger.get('FBA-L1-1');
    ok('one movement, accepted and shipped', said === '' && S.movements().length === 1 && r.qty === 4 && r.txnType === 'FBA' && r.issuedFor === 'Ridhi FBA'
      && r.fbaAcceptedAt && r.fbaAcceptedBy === 'team@test' && r.fbaShippedAt && r.fbaShippedBy === 'team@test' && r.fbaShipment === 'FBA15X'
      && r.fbaShipDate === '28/11/2026' && r.fbaListId === 'L1' && r.fbaLane === 'sea' && r.source === 'fba list', said + JSON.stringify(r));
    ok('it is not read as sheet history', S.run(`fbaState(${JSON.stringify(r)}).st`) === 'shipped');
    ok('the movements and the finished list in one save', S.patched.length === 1 && Object.keys(S.patched[0]).length === 3 && !S.open().L1 && S.done().L1.status === 'shipped');
    ok('the listing alert is raised', same(S.alerts, [['A', 'FBA', 4]]));
    ok('a second tap writes nothing', await S.ship() === '' && S.patched.length === 1 && S.stock() === 16);
    ok('another shipment id is not taken as done', /no longer/.test(await S.ship({ shipment: 'OTHER' })));
    const D = await packed(4);
    const both = await Promise.all([D.ship(), D.ship()]);
    ok('double tap: one set of movements', D.movements().length === 1 && D.patched.length === 1 && both.filter(x => x === '').length === 1, JSON.stringify(both));
    const F = await packed(4, { approver: true });
    await F.ship({ qtyBySku: { a: 1 } });
    ok('shipping fewer frees the rest', F.stock() === 19 && F.done().L1.lines.A.shipped === 1 && same(copy(F.ctx.fblAllotted(F.open())), {})
      && await F.make(2, { id: 'L2', lane: 'air' }) === '');
    const G = lists({ releases: release(3) });
    await G.make(7); await G.pack(7); await G.ship({ qtyBySku: { A: 5 } });
    ok('unused release pieces go back', G.releaseLeft('R1') === 2 && same(G.done().L1.released, { R1: 1 }));
    const K = await packed(4);
    K.db._fbaLists.X = { status: 'open', store: 'CPC', lane: 'awd', lines: { A: { sku: 'A', qty: 17 } } };
    ok('stock kept by other lists is not shipped', /has 3 piece/.test(await K.ship()) && K.movements().length === 0 && K.open().L1.status === 'packed' && !K.open().L1.claimAt);
    const P = await packed(4); P.patchFails = true;
    ok('a failed save is said and the list is packed again', /Not shipped: offline/.test(await P.ship()) && P.open().L1.status === 'packed');
    const C = await packed(4);
    Object.assign(C.db._fbaLists.L1, { status: 'shipping', claimBy: 'bee@test', claimAt: iso(Date.now() - 30000) });
    ok('somebody shipping just now: wait', /bee is working/.test(await C.ship()) && C.movements().length === 0);
    C.db._fbaLists.L1.claimAt = iso(Date.now() - 4 * 60000);
    ok('a claim is held for 5 minutes', /in 5 minutes/.test(await C.ship()) && C.movements().length === 0);
    C.db._fbaLists.L1.claimAt = iso(Date.now() - 6 * 60000);
    ok('a claim over 5 minutes old can be redone', await C.ship() === '' && C.movements().length === 1);
  }

  console.log('== a slow computer cannot write over the one that took over ==');
  /* runs `then` once, in the middle of S's next shipment: after its claim, before its save */
  const midShip = (S, then) => {
    const real = S.ctx.fgiStockReread;
    let reads = 0;
    S.ctx.fgiStockReread = async () => { if (++reads === 1) await then(); return real(); };
  };
  {
    const A = lists({ releases: release(3) });
    await A.make(7); await A.pack(7);
    const B = lists({ db: A, email: 'bee@test' });
    let theirs;
    midShip(A, async () => {
      A.db._fbaLists.L1.claimAt = iso(Date.now() - 6 * 60000);
      theirs = await B.ship({ qtyBySku: { A: 5 } });
    });
    const said = await A.ship({ qtyBySku: { A: 5 } });
    ok('taken over and shipped: the first save is refused', theirs === '' && /Not shipped.*taken the list over/.test(said) && A.patched.length === 0, said);
    ok('one set of movements, releases given back once', A.movements().length === 1 && B.patched.length === 1 && A.releaseLeft('R1') === 2
      && !A.open().L1 && A.done().L1.shippedBy === 'bee@test' && A.alerts.length === 0, A.releaseLeft('R1'));
    const C = await packed(4);
    midShip(C, async () => Object.assign(C.db._fbaLists.L1, { claimBy: 'bee@test', claimAt: iso(Date.now() + 1000) }));
    ok('taken over, not yet saved: refused, their claim stays', /taken the list over/.test(await C.ship()) && C.patched.length === 0
      && C.open().L1.status === 'shipping' && C.open().L1.claimBy === 'bee@test');
    const S = await packed(4);
    midShip(S, async () => S.run('Date.now = (real => () => real() + 3 * 60000)(Date.now)'));
    ok('over 2 minutes after the claim: not sent, packed again', /took too long/.test(await S.ship()) && S.patched.length === 0
      && S.open().L1.status === 'packed' && !S.open().L1.claimAt);
  }

  console.log('== saved, but the answer was lost ==');
  {
    const S = lists({ releases: release(3) });
    await S.make(7); await S.pack(7);
    S.answerLost = true;
    const said = await S.ship({ qtyBySku: { A: 5 } });
    ok('counts as shipped, releases back and alert raised', said === '' && S.done().L1.status === 'shipped' && S.releaseLeft('R1') === 2
      && same(S.alerts, [['A', 'FBA', 5]]) && S.warns.some(w => /answer was lost/.test(w)), said);
    ok('and the screen holds the movement', S.ctx.FGI.rows.some(r => r._id === 'FBA-L1-1'));
    const U = await packed(4); U.answerLost = true; U.thenDown = '_fbaListsDone';
    ok('cannot be looked up: not called failed', /may or may not be saved.*Refresh/.test(await U.ship()) && U.alerts.length === 0);
    const A = await packed(4);
    A.ctx.lstAlertFor = async () => { throw new Error('no listing sheet'); };
    ok('a failed listing alert is not a failed shipment', await A.ship() === '' && A.done().L1.status === 'shipped'
      && A.warns.some(w => /listing alert/.test(w)));
  }

  console.log('== cancelling ==');
  {
    const S = lists({ releases: release(3) });
    await S.make(6);
    const other = lists({ db: S, email: 'bee@test' });
    ok('somebody else cannot cancel', /Only the person/.test(await other.ctx.fblCancel('L1')) && S.open().L1.status === 'open');
    ok('the maker can: pieces free, release back', await S.ctx.fblCancel('L1') === '' && !S.open().L1 && S.done().L1.status === 'cancelled' && S.releaseLeft('R1') === 3);
    ok('twice: nothing new', await S.ctx.fblCancel('L1') === '' && S.releaseLeft('R1') === 3);
    const A = lists(); await A.make(2);
    ok('an admin can', await lists({ db: A, admin: true, email: 'boss@test' }).ctx.fblCancel('L1') === '' && !A.open().L1);
    const H = await packed(2); await H.ship();
    ok('a shipped list cannot be cancelled', /no longer open/.test(await H.ctx.fblCancel('L1')) && H.done().L1.status === 'shipped');
  }

  console.log('== undoing a shipment ==');
  {
    const S = await packed(4); await S.ship({ qtyBySku: { A: 3 } });
    const said = await S.ctx.fblUndoShip('L1');
    const l = S.open().L1;
    ok('movements deleted, list packed again with what was shipped', said === '' && S.movements().length === 0 && S.stock() === 20 && l.status === 'packed'
      && same(asRead(l.lines), { A: { packed: 3, qty: 3, sku: 'A' } }) && !l.shipment && !l.claimAt && !S.done().L1, said + JSON.stringify(l));
    ok('in one save', S.patched.length === 2);
    ok('twice: nothing new', await S.ctx.fblUndoShip('L1') === '' && S.patched.length === 2);
    for (const [name, spoil] of [['a return row', T => T.ledger.set('BACK', row('BACK', 'FBA_RETURN', 1, { linkedFbaId: 'FBA-L1-1' }))],
      ['a returned count', T => { T.ledger.get('FBA-L1-1').fbaReturned = 1; }]]) {
      const T = await packed(4); await T.ship(); spoil(T);
      ok('refused after ' + name, /returned from FBA/.test(await T.ctx.fblUndoShip('L1')) && T.movements().length === 1 && T.done().L1.status === 'shipped');
    }
    const W = await packed(4); await W.ship();
    const cas = W.ctx.ptCas;
    W.ctx.ptCas = async (...a) => {
      const answer = await cas(...a);
      Object.assign(W.db._fbaListsDone.L1, { claimBy: 'bee@test', claimAt: iso(Date.now() + 1000) });
      return answer;
    };
    ok('an undo taken over by another computer saves nothing', /not undone.*taken the list over/.test(await W.ctx.fblUndoShip('L1'))
      && W.patched.length === 1 && W.movements().length === 1 && W.done().L1.status === 'shipped');
    const O = await packed(4); await O.ship(); O.saved.fbaList = '0';
    ok('switch off: the shipment can still be undone', await O.ctx.fblUndoShip('L1') === '' && O.movements().length === 0 && O.open().L1.status === 'packed');
    const N = await packed(4); await N.ship();
    ok('without the tab: refused', /FBA team/.test(await lists({ db: N, tabs: [] }).ctx.fblUndoShip('L1')) && N.movements().length === 1);
  }

  console.log('== deleting on Finished Goods ==');
  for (const sw of ['1', '0']) {
    const S = await packed(4); await S.ship(); S.saved.fbaList = sw;
    S.ctx.PTG.press = [];
    S.run(line('inventory/fg-change-remove.js', 'const fgiIsMarker') + line('inventory/fg-change-remove.js', 'const FGI_ON_FBA_LIST')
      + line('inventory/fg-change-remove.js', 'const fgiOnFbaList') + whole('inventory/fg-change-remove.js', 'fgiDeletePlan'));
    const plan = ids => S.ctx.fgiDeletePlan(ids);
    const one = plan(['FBA-L1-1']);
    ok(`switch ${sw}: a list movement is not deleted`, one.gone.length === 0 && Object.keys(one.updates).length === 0
      && /shipped on an FBA list — undo the shipment on FBA Dispatch/.test(one.refused[0].why));
    const all = plan(['O', 'FBA-L1-1']);
    ok(`switch ${sw}: nor among many`, same(copy(all.gone), ['O']) && all.refused.length === 1);
    S.ctx.FGI.rows.push(row('BACK', 'FBA_RETURN', 1, { linkedFbaId: 'FBA-L1-1' }));
    const both = plan(['FBA-L1-1', 'BACK']);
    ok(`switch ${sw}: nor its return along with it`, both.gone.length === 0 && both.refused.length === 2);
  }

  const { pass, fail } = counts();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('suite stopped: ' + (e.stack || e)); process.exit(1); });
