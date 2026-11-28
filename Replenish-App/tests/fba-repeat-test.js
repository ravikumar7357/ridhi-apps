/* REPEAT FBA DISPATCH NEEDS APPROVAL (27 Nov: a SKU sent to FBA in the past 7 days waits for the shipping head).
 *   node tests/fba-repeat-test.js      (teeth/teeth-fba-repeat.js runs it against broken copies) */
const { same, whole, line, appFile, NOW, HOUR, row, sent, store, WAYS, editStore, scanHead, counts, check: ok } = require('./india-store-harness');

const DAY = 24 * HOUR, iso = ms => new Date(ms).toISOString();
const indiaDay = daysAgo => new Date(NOW + 330 * 60000 - daysAgo * DAY).toISOString().slice(0, 10);
/* 20 of A came in, 1 went to FBA two days ago (amy): 19 in stock, FBA may take 8 */
const amy = over => sent('R', 1, Object.assign({ createdAt: iso(NOW - 2 * DAY), createdBy: 'amy@test' }, over));
const rows = (...more) => [row('O', 'OPENING', 20), amy()].concat(more);

/** The repeat rule on top of a store. o: { approver, cancel, vendor } and the store's own. */
function withRepeat(S, o) {
  const boxes = [];
  Object.assign(S.ctx, { spIsVendor: () => !!o.vendor, ptDtMs: () => 0 });
  S.ctx.ME = { email: o.approver ? 'head@test' : 'store@test', admin: o.approver === 'admin', fbaRepeatApprove: o.approver === true };
  S.run(line('core/helpers.js', 'const dTodayIndia') + line('core/helpers.js', 'const dAdd') + line('core/helpers.js', 'const ptDayWords')
    + line('inventory/fg-change-remove.js', 'const fgiDmy') + 'const ptIsoDate = d => String(d || "").split("/").reverse().join("-");\n' + appFile('inventory/fg-fba-repeat.js'));
  S.ctx.fapAsk = async text => { boxes.push(text); return !o.cancel; };
  S.boxes = boxes;
  S.requests = () => Object.entries(S.db._fbaRepeat || {});
  S.ledger = () => S.patches.flatMap(p => Object.entries(p).filter(([k, v]) => k.startsWith('pt_fgiLedger/') && v).map(([, v]) => v));
  return S;
}
const repeatStore = o => withRepeat(store(Object.assign({ rows: rows(), admin: false }, o)), o || {});

async function entry(S, qty, type = 'FBA', sku = 'A') {
  S.ctx.FGI_KINDS = { ISSUE: { dir: -1 }, FBA: { dir: -1 }, RECEIVE: { dir: 1 } };
  S.run(whole('inventory/fg-other-movements.js', 'fgiOutCheck') + whole('inventory/fg-other-movements.js', 'fgiEntrySave'));
  Object.entries({ fgmType: type, fgmSku: sku, fgmQty: String(qty), fgmWho: 'x', fgmFbaAcct: 'Ridhi FBA', fgmReason: 'Raju' }).forEach(([k, v]) => { S.box(k).value = v; });
  S.ctx.FGI.repeatStem = S.ctx.FGI.repeatStem || 'FORM-1';
  return S.ctx.fgiEntrySave();
}
/* A second SKU, B: 10 in stock, never sent, FBA asks 5. */
function addB(S) {
  S.db._fbaNeed.SP.skus.B = [5, 0, 0];
  S.ctx.PTG.mdb.push({ sku: 'B' });
}
const withB = () => rows(row('OB', 'OPENING', 10, { sku: 'B' }));
function scanner(o, scanned, auto) {
  let n = 0;
  const S = repeatStore(Object.assign({ rows: withB() }, o));
  addB(S);
  Object.assign(S.ctx, { fgiNewId: p => p + '-' + (n++), FGS: { type: 'FBA', unknown: new Map(), rows: new Map(Object.entries(scanned).map(([sku, qty]) => [sku, { sku, qty }])) },
    fgiScanAuto: () => !!auto, fgiScanHead: () => scanHead('FBA'), fgiScanRender() {} });
  S.run(whole('inventory/fg-scanning.js', 'fgiScanFlush') + whole('inventory/fg-scanning.js', 'fgiScanSave'));
  return S;
}
async function packer(o, items) {
  const S = repeatStore(Object.assign({ rows: withB() }, o));
  addB(S);
  let n = 0;
  Object.assign(S.ctx, { fgiOutOrders: () => [], fgiNewId: p => p + '-' + (n++) });
  S.run(whole('inventory/fg-other-movements.js', 'fgiOutCheck') + appFile('replenishment/pack-core.js'));
  S.ctx.list = { id: 'P1', date: '2026-11-27', account: 'Ridhi FBA', boxes: [{ n: 1, items: Object.entries(items).map(([sku, qty]) => ({ sku, qty })) }] };
  S.finish = () => S.run('packLedgerWrite(list, "Raju")');
  return S;
}
/** A store where 'store@test' has asked for 3 more of A, then the approver's own screen on the same database. */
async function asked(o) {
  const S = repeatStore({});
  await entry(S, 3);
  const [id] = S.requests()[0];
  const H = repeatStore(Object.assign({ approver: true, requests: JSON.parse(JSON.stringify(S.db._fbaRepeat)) }, o));
  return { H, id, request: () => H.db._fbaRepeat[id] };
}

(async () => {
  console.log('== sent in the past 7 days (India dates) ==');
  {
    const recent = over => repeatStore({ rows: [row('O', 'OPENING', 20), amy(over)] }).run('fapRecent("a").length');
    const at = (daysAgo, hhmm) => ({ createdAt: new Date(indiaDay(daysAgo) + 'T' + hhmm + ':00+05:30').toISOString() });
    ok('7 India days ago still counts, from its first minute', recent(at(7, '00:01')) === 1);
    ok('8 India days ago does not, to its last minute', recent(at(8, '23:59')) === 0);
    ok('all returned: not sent', recent({ fbaReturned: 1 }) === 0);
    ok('history from the sheet: not counted', recent({ source: 'sheet: x' }) === 0);
    ok('another SKU, or an issue: not counted', recent({ sku: 'B' }) === 0 && recent({ txnType: 'ISSUE' }) === 0);
    ok('shipped ones count', recent({ fbaShippedAt: 'x' }) === 1);
  }

  console.log('== the entry form ==');
  {
    const S = repeatStore({});
    const said = await entry(S, 3);
    ok('a repeat asks: date, pieces, who sent it', S.boxes.length === 1 && S.boxes[0].includes('1 pcs on ' + indiaDay(2).split('-').reverse().join('-') + ' by amy'), S.boxes[0]);
    const [id, q] = S.requests()[0] || [];
    ok('Continue saves a waiting request with who is doing the FBA', said === '' && q.status === 'waiting' && q.askedBy === 'store@test' && q.qty === 3 && q.row.handoverTo === 'Raju' && q.row._id === id, said);
    ok('nothing leaves the store', S.ledger().length === 0);
    ok('the screen says so', /wait for the FBA repeat approver/.test(S.box('fgMsg').textContent));
    await entry(S, 3);
    ok('pressed twice: one request', S.requests().length === 1);
    ok('the same form with another quantity is not silently taken as saved', /already asked/.test(await entry(S, 4)) && S.requests()[0][1].qty === 3);
    const C = repeatStore({ cancel: true });
    ok('Cancel saves nothing', /Cancel/.test(await entry(C, 3)) && C.writes.length === 0 && C.requests().length === 0);
    const F = repeatStore({ rows: [row('O', 'OPENING', 20)] });
    ok('not sent lately: goes straight away', await entry(F, 3) === '' && F.boxes.length === 0 && F.ledger().length === 1);
    const off = repeatStore({ ls: '0' });
    ok('switch off: as before', await entry(off, 3) === '' && off.boxes.length === 0 && off.ledger().length === 1 && off.requests().length === 0);
    const I = repeatStore({});
    ok('an issue is never asked about', await entry(I, 1, 'ISSUE') === '' && I.boxes.length === 0);
    const L = repeatStore({});
    ok('limits are checked when asking', /free for FBA/.test(await entry(L, 9)) && L.requests().length === 0 && L.boxes.length === 0);
    const down = repeatStore({ unread: '_fbaRepeat' });
    ok('requests unreadable: nothing saved', /could not be read/.test(await entry(down, 3)) && down.writes.length === 0);
    for (const approver of [true, 'admin']) {
      const H = repeatStore({ approver });
      const done = await entry(H, 3);
      const [hid, h] = H.requests()[0] || [];
      ok(`${approver === true ? 'the approver' : 'an admin'} sending: Continue is the approval, recorded with the movement in one save`,
        done === '' && H.boxes.length === 1 && /your approval/.test(H.boxes[0]) && h.status === 'approved' && h.decidedBy === 'head@test'
        && H.ledger()[0].fbaRepeatId === hid && H.patches.length === 1 && Object.keys(H.patches[0]).length === 2, done);
    }
    const HC = repeatStore({ approver: true, cancel: true });
    await entry(HC, 3);
    ok('the approver\'s Cancel saves nothing too', HC.writes.length === 0);
  }

  console.log('== FG Scanning, FBA out ==');
  {
    const A = scanner({}, { A: 2 }, true);
    const said = await A.ctx.fgiScanFlush('A');
    ok('a repeat SKU is not entered as scanned', /Save all/.test(said) && A.writes.length === 0 && A.boxes.length === 0, said);
    const B = scanner({}, { B: 2 }, true);
    ok('another SKU goes in as scanned', await B.ctx.fgiScanFlush('B') === '' && B.ledger().length === 1);
    B.ctx.FGS.rows.get('B').qty = 3;
    ok('…and more scans add to this batch\'s own entry', await B.ctx.fgiScanFlush('B') === '');
    for (const auto of [true, false]) {
      const name = auto ? 'Save all (entered as scanned)' : 'Save all';
      const S = scanner({}, { A: 2, B: 4 }, auto);
      const done = await S.ctx.fgiScanSave();
      ok(name + ': only the repeat waits, the other goes', done === '' && S.boxes.length === 1 && S.requests().length === 1 && S.requests()[0][1].qty === 2
        && same(S.ledger().map(r => r.sku), ['B']), done + JSON.stringify(S.ledger()));
      ok(name + ': the message says what waits', /wait for the FBA repeat approver/.test(S.box('fgMsg').textContent));
      const C = scanner({ cancel: true }, { A: 2, B: 4 }, auto);
      ok(name + ': Cancel saves nothing', /Cancel/.test(await C.ctx.fgiScanSave()) && C.writes.length === 0);
      const H = scanner({ approver: true }, { A: 2 }, auto);
      ok(name + ': the approver\'s goes at once, on record', await H.ctx.fgiScanSave() === '' && H.ledger().length === 1 && H.requests()[0][1].status === 'approved');
      const only = scanner({}, { A: 2 }, auto);
      ok(name + ': a list of repeats only closes', await only.ctx.fgiScanSave() === '' && only.ledger().length === 0 && only.ctx.FGS.rows.size === 0
        && /wait for the FBA repeat approver/.test(only.box('fgMsg').textContent));
      const many = scanner({}, { A: 9 }, auto);
      ok(name + ': limits are checked when asking', /free for FBA/.test(await many.ctx.fgiScanSave()) && many.boxes.length === 0 && many.requests().length === 0);
    }
  }

  console.log('== Scan to pack and Pack & verify (the shared Finish) ==');
  {
    const S = await packer({}, { A: 2, B: 4 });
    const res = await S.finish();
    const [id, q] = S.requests()[0] || [];
    ok('a repeat SKU makes the whole list wait: requests saved, no movement', S.ledger().length === 0 && q.sku === 'A' && q.row.packId === 'P1' && id === 'FBAR-P1-A', res.err);
    ok('and says what to do', /A\) wait for the FBA repeat approver.*The list is not finished — finish it again once approved, or take those boxes out\./.test(res.err), res.err);
    ok('the list is not marked sent', !(S.ctx.list.scan.ledgerIds || []).length && !S.ctx.list.scan.done);
    ok('the box said the whole list waits', /whole packing list waits/.test(S.boxes[0]));
    const again = await S.finish();
    ok('finished again while waiting: still nothing, and not asked twice', /not finished/.test(again.err) && S.ledger().length === 0 && S.boxes.length === 1 && S.requests().length === 1);
    const C = await packer({ cancel: true }, { A: 2, B: 4 });
    ok('Cancel saves nothing, the list stays open', /Cancel/.test((await C.finish()).err) && C.writes.length === 0 && !(C.ctx.list.scan.ledgerIds || []).length);
    const H = await packer({ approver: true }, { A: 2, B: 4 });
    const done = await H.finish();
    ok('the approver\'s whole list goes', !done.err && H.ledger().length === 2 && H.requests().length === 1, done.err);
    ok('Finish again writes nothing', (await H.finish()).already === true && H.ledger().length === 2);

    /* the list after a decision: the same screen, the request and ledger as the database now holds them */
    const after = async (status, items, o) => {
      const P = await packer({}, { A: 2, B: 4 });
      await P.finish();
      const moved = row('FBAR-P1-A', 'FBA', 2, { issuedFor: 'Ridhi FBA', createdAt: iso(NOW), packId: 'P1' });
      const ledger = withB().concat(status === 'approved' && !(o || {}).deleted ? [moved] : [], (o || {}).more || []);
      Object.assign(P.db._fbaRepeat['FBAR-P1-A'], { status, decidedBy: 'head@test', decidedAt: iso(NOW), reason: 'Amazon is full' }, o);
      P.ctx.ptGet = async () => ledger;
      P.ctx.list.boxes[0].items = Object.entries(items).map(([sku, qty]) => ({ sku, qty }));
      return { P, res: await P.finish() };
    };
    const yes = await after('approved', { A: 2, B: 4 });
    ok('approved: counts as written, only the rest is written', !yes.res.err && same(yes.P.ledger().map(r => r.sku), ['B']), yes.res.err);
    ok('…and its id is on the finished list', yes.P.ctx.list.scan.ledgerIds.includes('FBAR-P1-A') && yes.P.ctx.list.scan.ledgerIds.length === 2 && yes.P.ctx.list.scan.done);
    const alone = await after('approved', { A: 2 });
    ok('an approved-only list finishes with nothing more written', !alone.res.err && alone.P.ledger().length === 0 && same([...alone.P.ctx.list.scan.ledgerIds], ['FBAR-P1-A']), alone.res.err);
    const short = await after('approved', { A: 2, B: 4 }, { more: [row('I', 'ISSUE', 16)] });
    ok('approved pieces are not asked of the stock again', !short.res.err);
    const more = await after('approved', { A: 3, B: 4 });
    ok('approved, but the boxes now hold another number: stopped', /2 pcs were approved/.test(more.res.err) && more.P.ledger().length === 0, more.res.err);
    const out = await after('approved', { B: 4 });
    ok('an approved box taken out: stopped, as the pieces have left', /Put those boxes back/.test(out.res.err) && out.P.ledger().length === 0, out.res.err);
    const del = await after('approved', { A: 2, B: 4 }, { deleted: true });
    ok('approved but the movement deleted: not taken as written', /since been deleted/.test(del.res.err) && del.P.ledger().length === 0, del.res.err);
    const cleared = await after('approved', { B: 4 }, { deleted: true });
    ok('…and with its box out the list finishes', !cleared.res.err && cleared.P.ledger().length === 1, cleared.res.err);
    const no = await after('rejected', { A: 2, B: 4 });
    ok('rejected: stopped with the reason', /rejected for FBA by head: Amazon is full/.test(no.res.err) && no.P.ledger().length === 0 && !no.P.ctx.list.scan.done, no.res.err);
    const noOut = await after('rejected', { B: 4 });
    ok('a rejected box taken out: the rest goes, the rejection stands', !noOut.res.err && same(noOut.P.ledger().map(r => r.sku), ['B']) && noOut.P.db._fbaRepeat['FBAR-P1-A'].status === 'rejected', noOut.res.err);
    const wOut = await after('waiting', { B: 4 });
    const wq = wOut.P.db._fbaRepeat['FBAR-P1-A'];
    ok('a waiting box taken out: its request is withdrawn, the rest goes', !wOut.res.err && wq.status === 'withdrawn' && wOut.P.ledger().length === 1, wOut.res.err);
    ok('…and cannot be approved afterwards', await (async () => { wOut.P.ctx.ME = { email: 'head@test', admin: true }; return /Already withdrawn/.test(await wOut.P.ctx.fapApprove('FBAR-P1-A')); })());
    const wMore = await after('waiting', { A: 3, B: 4 });
    ok('a waiting SKU with another number: stopped', /already asked for with 2 pcs/.test(wMore.res.err) && wMore.P.ledger().length === 0, wMore.res.err);
    const busy = await after('approving', { B: 4 });
    ok('taken out while it is being approved: wait', /approving it just now/.test(busy.res.err) && busy.P.ledger().length === 0, busy.res.err);
    const back = await packer({ requests: { 'FBAR-P1-A': Object.assign({}, wq) } }, { A: 2 });
    ok('a withdrawn SKU put back is asked about afresh', /not finished/.test((await back.finish()).err) && back.boxes.length === 1 && back.db._fbaRepeat['FBAR-P1-A'].status === 'waiting');
    const old = await packer({ requests: { 'FBAR-P1-A': Object.assign({}, wq, { status: 'waiting' }) }, rows: [row('O', 'OPENING', 20)] }, { A: 2 });
    ok('a waiting request holds the list even after the 7 days', /not finished/.test((await old.finish()).err) && old.ledger().length === 0);
  }

  {
    const M = scanner({}, {}, false);
    M.ctx.mixed = [row('n1', 'FBA', 2), row('n2', 'FBA', 4, { sku: 'B' })];
    const gate = await M.run('fapGate(mixed, "S")');
    ok('beside a waiting row, the gate hands back the rows that need no approval', same([...gate.send].map(r => r.sku), ['B']) && gate.held.length === 1, gate.stop);
    const R = repeatStore({});
    R.ctx.ptCas = (cas => async (path, expect, next) => { R.db._fbaRepeat = { 'FBAR-FORM-1-A': { sku: 'A', qty: 9, status: 'waiting' } }; return cas(path, expect, next); })(R.ctx.ptCas);
    ok('another request saved under the same id in that instant is not taken as this one', /already asked/.test(await entry(R, 3)) && R.db._fbaRepeat['FBAR-FORM-1-A'].qty === 9);
  }

  console.log('== approving ==');
  {
    const { H, id, request } = await asked();
    request().row.createdAt = iso(NOW - 3 * DAY);
    ok('asking left no movement; approving writes it', await H.ctx.fapApprove(id) === '' && H.ledger().length === 1);
    const r = H.ledger()[0];
    ok('under the request\'s id, today, still in the requester\'s name, with the approval', r._id === id && r.createdBy === 'store@test' && r.fbaRepeatBy === 'head@test'
      && r.date === indiaDay(0).split('-').reverse().join('/') && Date.now() - Date.parse(r.createdAt) < 60000);
    ok('the request reads approved', request().status === 'approved' && request().decidedBy === 'head@test');
    ok('approved once', /Already approved/.test(await H.ctx.fapApprove(id)) && H.ledger().length === 1);
    ok('and cannot then be rejected', /Already approved/.test(await H.ctx.fapReject(id, 'x')) && request().status === 'approved');

    const n = await asked({ approver: false });
    ok('only an approver or admin approves', /Only the FBA repeat approver/.test(await n.H.ctx.fapApprove(n.id)) && n.H.writes.length === 0);
    const v = await asked({ vendor: true });
    ok('never a vendor', /Only/.test(await v.H.ctx.fapApprove(v.id)));
    const limit = await asked({ need: { SP: [2, 0, 0] } });
    ok('FBA limits are checked again', /free for FBA/.test(await limit.H.ctx.fapApprove(limit.id)) && limit.H.writes.length === 0 && limit.request().status === 'waiting');
    const gone = await asked({ rows: rows(row('I', 'ISSUE', 17)) });
    ok('stock is checked again', /2 piece\(s\) in the India Store/.test(await gone.H.ctx.fapApprove(gone.id)) && gone.H.writes.length === 0);
    const moved = await asked({ rows: rows(), fresh: rows(row('I', 'ISSUE', 17)) });
    ok('…on the ledger as it is now', /India Store/.test(await moved.H.ctx.fapApprove(moved.id)));

    const release = { r: { sku: 'A', pcs: 5, left: 5, reason: 'x', at: 't' } };
    const asking = repeatStore({ releases: JSON.parse(JSON.stringify(release)) });
    await entry(asking, 10);
    ok('asking uses no release', asking.requests().length === 1 && asking.db._shopHold.releases.r.left === 5);
    const rel = repeatStore({ approver: true, requests: asking.db._fbaRepeat, releases: JSON.parse(JSON.stringify(release)) });
    const relId = asking.requests()[0][0];
    ok('approval uses it', await rel.ctx.fapApprove(relId) === '' && rel.db._shopHold.releases.r.left === 3);
    const fail = repeatStore({ approver: true, requests: JSON.parse(JSON.stringify(Object.assign({}, asking.db._fbaRepeat))), releases: JSON.parse(JSON.stringify(release)), writeFails: true });
    fail.db._fbaRepeat[relId].status = 'waiting';
    ok('a failed save: back to waiting, the release given back', /Not saved/.test(await fail.ctx.fapApprove(relId)) && fail.db._fbaRepeat[relId].status === 'waiting' && fail.db._shopHold.releases.r.left === 5);

    const race = await asked();
    race.H.ctx.ptCas = (cas => async (...a) => { race.H.db._fbaRepeat[race.id].status = 'rejected'; return cas(...a); })(race.H.ctx.ptCas);
    ok('decided by somebody else in that instant: nothing written', /Somebody else/.test(await race.H.ctx.fapApprove(race.id)) && race.H.ledger().length === 0);
    const busy = await asked();
    Object.assign(busy.request(), { status: 'approving', decidedBy: 'b@test', decidedAt: iso(Date.now() - 1000) });
    ok('another approval under way: wait', /approving it just now/.test(await busy.H.ctx.fapApprove(busy.id)) && busy.H.ledger().length === 0);
    Object.assign(busy.request(), { decidedAt: iso(Date.now() - 3 * 60000) });
    ok('one that never finished can be done again', await busy.H.ctx.fapApprove(busy.id) === '' && busy.H.ledger().length === 1);
  }

  console.log('== rejecting ==');
  {
    const { H, id, request } = await asked();
    ok('a reason is needed', /Say why/.test(await H.ctx.fapReject(id, '  ')) && request().status === 'waiting');
    ok('rejected with the reason', await H.ctx.fapReject(id, 'Amazon is full') === '' && request().status === 'rejected' && request().reason === 'Amazon is full');
    ok('once, and no approval after', /Already rejected/.test(await H.ctx.fapReject(id, 'y')) && /Already rejected/.test(await H.ctx.fapApprove(id)) && H.ledger().length === 0 && request().reason === 'Amazon is full');
    const n = await asked({ approver: false });
    ok('only an approver rejects', /Only/.test(await n.H.ctx.fapReject(n.id, 'x')) && n.request().status === 'waiting');
  }

  console.log('== edits that send more ==');
  {
    const edit = async (o, was, input) => {
      const S = editStore(Object.assign({}, o, { rows: [row('O', 'OPENING', 25), was].concat(o.more || []) }));
      withRepeat(S, o);
      return { S, said: await S.ctx.fgiEditApply('F', input) };
    };
    const own = over => sent('F', 2, Object.assign({ createdAt: iso(NOW - DAY), date: '26/11/2026' }, over));
    const a = await edit({}, own(), { qty: 3, who: 'Ridhi FBA' });
    ok('more pieces on a recent dispatch: refused, with what to do', /new FBA entry/.test(a.said) && a.S.writes.length === 0, a.said);
    ok('the approver may', (await edit({ approver: true }, own(), { qty: 3 })).said === '');
    ok('fewer pieces, or a note, are free', (await edit({}, own(), { qty: 1 })).said === '' && (await edit({}, own(), { remarks: 'n' })).said === '');
    const old = own({ createdAt: iso(NOW - 20 * DAY) });
    ok('an old dispatch of a SKU not sent lately may grow', (await edit({}, old, { qty: 3 })).said === '');
    const issue = row('F', 'ISSUE', 2, { issuedFor: 'x', date: '26/11/2026' });
    ok('an issue turned into FBA: refused when the SKU went lately', /past 7 days/.test((await edit({ more: [amy()] }, issue, { txnType: 'FBA', who: 'Ridhi FBA' })).said));
    ok('…and allowed when it did not', (await edit({}, issue, { txnType: 'FBA', who: 'Ridhi FBA' })).said === '');
    ok('switch off: as before', (await edit({ ls: '0' }, own(), { qty: 3 })).said === '');
  }

  console.log('== the list and the badge ==');
  {
    const q = (status, by, over) => Object.assign({ sku: 'A', qty: 2, status, askedBy: by, askedAt: iso(NOW), recent: [], row: { issuedFor: 'Ridhi FBA' } }, over);
    const requests = { w: q('waiting', 'store@test'), x: q('rejected', 'store@test', { reason: '<b>full</b>', decidedAt: iso(NOW), decidedBy: 'head@test' }),
      y: q('rejected', 'store@test', { reason: 'old', decidedAt: iso(NOW - 9 * DAY) }), z: q('waiting', 'amy@test'), d: q('approved', 'amy@test') };
    const view = async o => {
      const S = repeatStore(Object.assign({ requests }, o));
      S.ctx.esc = v => String(v).replace(/</g, '&lt;');
      await S.ctx.fapReread(); S.run('fapRender(); fapDrawBadge()');
      return { html: S.box('fgTable').innerHTML, badge: S.box('fapBadge').textContent };
    };
    const mine = await view({}), head = await view({ approver: true });
    ok('the requester sees why it was rejected, as text', mine.html.includes('&lt;b>full') && !mine.html.includes('<b>full'));
    ok('only an approver has Approve and Reject, on open ones', !mine.html.includes('data-fapok') && head.html.includes('data-fapok="w"') && head.html.includes('data-fapno="z"') && !head.html.includes('data-fapok="d"') && !head.html.includes('data-fapok="x"'));
    ok('the badge: to decide for the approver; own waiting and fresh rejections for the requester', head.badge === '2' && mine.badge === '2', head.badge + ' ' + mine.badge);
  }

  console.log('== the view, switch off ==');
  {
    const offer = o => {
      const S = repeatStore(o);
      S.box('fgView').value = 'fbarep'; S.run('fapOfferView()');
      return { view: S.box('fgView').value, off: S.box('fapOpt').disabled, hidden: S.box('fapOpt').hidden };
    };
    ok('switch off: the option is disabled and a picked view goes back to the store', same(offer({ ls: '0' }), { view: 'stock', off: true, hidden: true }));
    ok('switch on: offered, and the view stays', same(offer({}), { view: 'fbarep', off: false, hidden: false }));
    const routed = ls => {
      const S = repeatStore({ ls });
      const seen = [], stop = name => () => { seen.push(name); };
      Object.assign(S.ctx, { FGI_KPI: '', FGI_KPI_ON: '', fgiPending: () => [], fgiPickCount() {}, fgiCanEdit: () => false, lstCanRefresh: () => false, LST: {},
        fgiRenderStock: stop('stock'), fgiRenderLedger: stop('ledger'), fapRender: stop('requests'), fapOfferView() {}, fapDrawBadge() {} });
      S.box('fgView').value = 'fbarep';
      S.run(whole('inventory/finished-goods.js', 'renderFgi') + 'renderFgi()');
      return seen.join();
    };
    ok('the list is routed to only with the switch on', routed('1') === 'requests' && routed('0') === 'stock', routed('1') + ' ' + routed('0'));
  }

  console.log('== the Continue / Cancel box ==');
  {
    const S = repeatStore({});
    S.run(whole('inventory/fg-fba-repeat.js', 'fapAsk'));
    const press = async which => {
      let box, removed = false; const text = {};
      S.ctx.document = { createElement: () => (box = { style: {}, setAttribute() {}, querySelector: () => text, remove() { removed = true; } }), body: { appendChild() {} } };
      const answer = S.ctx.fapAsk('<i>hello');
      box.onclick({ target: { closest: () => ({ dataset: { fap: which } }) } });
      return { yes: await answer, removed, text: text.textContent, html: box.innerHTML };
    };
    const yes = await press('1'), no = await press('0');
    ok('Continue answers yes, Cancel no, and the box goes', yes.yes === true && no.yes === false && yes.removed && no.removed);
    ok('both buttons are there; the words are set as text', yes.html.includes('>Continue<') && yes.html.includes('>Cancel<') && yes.text === '<i>hello' && !yes.html.includes('hello'));
  }

  console.log('== with FBA lists on ==');
  {
    const lists = S => { S.run(appFile('inventory/fba-lists.js')); S.saved.fbaList = '1'; return S; };
    const { H, id, request } = await asked();
    lists(H);
    const said = await H.ctx.fapApprove(id);
    ok('approving is refused with where to go', /FBA now goes by FBA lists/.test(said), said);
    ok('…the request waits again and nothing leaves', request().status === 'waiting' && H.ledger().length === 0);
    const F = lists(repeatStore({ rows: [row('O', 'OPENING', 20)] }));
    ok('the entry form cannot send to FBA', /FBA lists/.test(await entry(F, 3)) && F.ledger().length === 0);
    const A = lists(repeatStore({ approver: true }));
    ok('nor can an approver\'s own repeat', /FBA lists/.test(await entry(A, 3)) && A.ledger().length === 0 && A.requests().length === 0);
    const I = lists(repeatStore({}));
    ok('an issue still goes', await entry(I, 1, 'ISSUE') === '' && I.ledger().length === 1);
    const S = lists(scanner({}, { B: 2 }, false));
    ok('FG Scanning cannot send to FBA', /FBA lists/.test(await S.ctx.fgiScanSave()) && S.ledger().length === 0);
    const P = lists(await packer({}, { B: 2 }));
    ok('nor can a packing list', /FBA lists/.test((await P.finish()).err || '') && P.ledger().length === 0);
  }

  const { pass, fail } = counts();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL the suite stopped - ' + e.stack); process.exit(1); });
