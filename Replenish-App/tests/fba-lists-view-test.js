/* INDIA STORE: FBA LISTS ON SCREEN (28 Nov): ticking and listing on Finished Goods, the "FBA lists" panel on FBA Dispatch.
 *   node tests/fba-lists-view-test.js
 *   FGA_MUT_FILE=<path under src/app> FGA_MUT_SRC=<file> runs it against a broken copy (the part at the end does this). */
const { fs, path, appFile, line, whole, NOW, iso, row, sent, store, counts, check: ok } = require('./india-store-harness');

/** A screen: 20 of A (Air share 3, Sea 4 for Ridhi). The list rules are replaced by recorders. */
function screen(o = {}) {
  const S = store(Object.assign({ admin: false }, o));
  const calls = [], dialogs = [];
  S.made = 0;
  S.ctx.ME = { email: o.email || 'team@test', admin: !!o.admin, tabs: o.tabs || ['fba', 'fgi'] };
  Object.assign(S.ctx, {
    spIsVendor: () => false, ptDtMs: () => 0, FGI_PICK: { stock: new Set(o.picked || []), ledger: new Set() },
    ptOpenDialog: cfg => dialogs.push(cfg), renderFba: () => calls.push(['renderFba']), renderFgi: () => calls.push(['renderFgi']),
    pkvOpenFbaList: async id => calls.push(['pack', id]),
    fgiNewId: p => p + '-' + (++S.made), lstOf: () => ({ st: 'unknown' }), LST_PILL: {}, ptImgInner: () => '', esc: s => String(s).replace(/</g, '&lt;').replace(/"/g, '&quot;'),
  });
  S.run(line('core/helpers.js', 'const dTodayIndia') + line('core/helpers.js', 'const dAdd') + line('core/helpers.js', 'const ptDayWords')
    + line('inventory/fg-change-remove.js', 'const fgiDmy') + line('inventory/fba-dispatch.js', 'const fbaCan')
    + whole('inventory/finished-goods.js', 'fgiCard') + 'const ptIsoDate = d => String(d || "").split("/").reverse().join("-");\n'
    + appFile('inventory/fg-fba-repeat.js') + appFile('inventory/fba-lists.js') + appFile('inventory/fba-lists-view.js'));
  S.saved.fbaList = o.switch || '1';
  Object.assign(S.ctx, {
    fgiStockReread: async () => o.stockDown || '',
    fblReadOne: async id => ({ open: S.ctx.FGI.set._fbaLists[id] || null, done: (S.ctx.FGI.set._fbaListsDone || {})[id] || null }),
  });
  ['fblMake', 'fblShip', 'fblCancel', 'fblUndoShip'].forEach(name => {
    S.ctx[name] = async (...a) => { calls.push([name, ...JSON.parse(JSON.stringify(a))]); return o.says || ''; };
  });
  S.ctx.FGI.set._fbaLists = o.lists || {};
  S.ctx.FGI.set._fbaListsDone = o.done || {};
  S.db._fbaLists = o.lists || {};
  Object.assign(S, { calls, dialogs });
  S.shown = id => { let hidden; S.box(id).classList.toggle = (c, on) => { hidden = on; }; return () => hidden === false; };
  return S;
}
const list = (status, over) => Object.assign({ account: 'Ridhi FBA', store: 'SP', lane: 'sea', status, by: 'team@test', at: iso(NOW),
  lines: { A: { sku: 'A', qty: 4, packed: 3 } } }, over);
const shippedList = (over) => list('shipped', Object.assign({ shipment: 'FBA9', shipDate: '28/11/2026', shippedAt: iso(NOW), shippedBy: 'team@test',
  lines: { A: { sku: 'A', qty: 4, packed: 3, shipped: 3 } } }, over));
const panel = o => { const S = screen(o); const pack = S.shown('fbaPackBtn'); S.ctx.fblvRender(); return { S, html: S.box('fbaLists').innerHTML, pack: pack() }; };
const actions = html => (html.match(/data-fbl="\w+"/g) || []).map(m => m.slice(10, -1)).join(',');

(async () => {
  console.log('== Finished Goods ==');
  {
    const S = screen({ picked: ['A'] }), seen = S.shown('fgFbaList');
    S.box('fgView').value = 'stock'; S.ctx.fblvPickCount();
    ok('button shown with the ticks counted', seen() && S.box('fgFbaList').disabled === false && /\(1\)/.test(S.box('fgFbaList').textContent));
    S.box('fgView').value = 'ledger'; S.ctx.fblvPickCount();
    ok('not on the movements view', !seen());
    for (const [name, o] of [['switch off', { switch: '0' }], ['without the FBA tab', { tabs: ['fgi'] }]]) {
      const T = screen(Object.assign({ picked: ['A'] }, o)), t = T.shown('fgFbaList');
      T.box('fgView').value = 'stock'; T.ctx.fblvPickCount(); await T.ctx.fblvMakeOpen();
      ok(name + ': no button, no form', !t() && T.dialogs.length === 0);
    }
    const card = S.run('fgiCard({ sku: "A", current: 1, pending: 0, alloc: {} }, false, true)');
    ok('a phone card ticks for the FBA team without Edit or Delete', /data-fgpick/.test(card) && !/data-fgskued|data-fgskudel/.test(card));
    ok('a phone card without the right has no tick', !/data-fgpick/.test(S.run('fgiCard({ sku: "A", current: 1, pending: 0, alloc: {} }, false)')));
  }
  console.log('== the form ==');
  {
    const S = screen({ picked: ['A'] });
    await S.ctx.fblvMakeOpen();
    const d = S.dialogs[0];
    ok('account and lane asked, every box labelled', /<label>FBA account<select/.test(d.html) && /<label>Lane<select/.test(d.html) && /<label[^>]*><b>A<\/b>[\s\S]*<input id="fblvQty0"/.test(d.html));
    ok('pieces default to the lane share, which is the most', S.box('fblvQty0').value === '3' && S.box('fblvQty0').max === '3', S.box('fblvQty0').value);
    ok('the most is what the list rules accept', S.run('fblCapWhy({ sku: "A", qty: 3, store: "SP", lane: "air" }, fgaBook())') === ''
      && S.run('fblCapWhy({ sku: "A", qty: 4, store: "SP", lane: "air" }, fgaBook())') !== '');
    S.box('fblvLane').value = 'sea'; S.box('fblvLane').onchange();
    ok('another lane, another most', S.box('fblvQty0').value === '4');
    await d.onSave(); await d.onSave();
    const made = S.calls.filter(c => c[0] === 'fblMake');
    ok('one id per form', made.length === 2 && /^FBL/.test(made[0][1].id) && made[0][1].id === made[1][1].id);
    ok('what was picked is sent', made[0][1].lane === 'sea' && made[0][1].account === 'Ridhi FBA' && made[0][1].lines[0].qty === '4');
    ok('ticks cleared after saving', S.ctx.FGI_PICK.stock.size === 0);
    S.box('fblvQty0').value = '0';
    ok('all zero: refused, nothing sent', /at least one/.test(await d.onSave()) && S.calls.filter(c => c[0] === 'fblMake').length === 2);
  }
  {
    const lists = { X: list('open', { lane: 'air', lines: { A: { sku: 'A', qty: 18, packed: 0 } } }) };
    const S = screen({ picked: ['A'], lists, releases: { R: { sku: 'A', pcs: 9, left: 9, at: iso(NOW) } } });
    ok('never more than the stock no other list has', S.run('fblvCap("A", "Ridhi FBA", "sea", fgaBook())') === 2);
    const R = screen({ releases: { R: { sku: 'A', pcs: 5, left: 5, at: iso(NOW) } } });
    ok('an open release adds to the share', R.run('fblvCap("A", "Ridhi FBA", "air", fgaBook())') === 8);
  }
  {
    const rows = [row('O', 'OPENING', 20), sent('F', 1, { createdAt: iso(NOW) })];
    const S = screen({ picked: ['A'], rows });
    await S.ctx.fblvMakeOpen();
    ok('a repeat is noticed', /past 7 days/.test(S.dialogs[0].html) && /approver or an admin/.test(S.dialogs[0].html));
    const A = screen({ picked: ['A'] }); await A.ctx.fblvMakeOpen();
    ok('no notice without a repeat', !/past 7 days/.test(A.dialogs[0].html));
    const D = screen({ picked: ['A'], stockDown: 'no signal' }); await D.ctx.fblvMakeOpen();
    ok('stock unreadable: said, no form', D.dialogs.length === 0 && D.box('fgMsg').textContent === 'no signal');
    const R = screen({ picked: ['A'], says: 'Nothing was saved — short.' }); await R.ctx.fblvMakeOpen();
    ok('a refusal stays on the form and keeps the ticks', /short/.test(await R.dialogs[0].onSave()) && R.ctx.FGI_PICK.stock.size === 1);
  }
  console.log('== the panel ==');
  {
    const off = panel({ switch: '0', lists: { L: list('packed') } });
    ok('switch off: nothing', off.html === '' && !off.pack);
    const B = screen({ lists: { L: list("open") } }); B.ctx.FGI.busy = true; B.ctx.fblvRender();
    ok("still reading: no panel yet", B.box("fbaLists").innerHTML === "");
    const open = panel({ lists: { L: list('open') } });
    ok('open: pack and cancel', actions(open.html) === 'pack,cancel' && open.pack, actions(open.html));
    ok('packed: pack, ship, cancel', actions(panel({ lists: { L: list('packed') } }).html) === 'pack,ship,cancel');
    ok("somebody else's list cannot be cancelled", actions(panel({ email: 'bee@test', lists: { L: list('open') } }).html) === 'pack');
    ok('an admin can', actions(panel({ admin: true, email: 'boss@test', lists: { L: list('open') } }).html) === 'pack,cancel');
    ok('being shipped now: no buttons', actions(panel({ lists: { L: list('shipping', { claimAt: iso(Date.now()) }) } }).html) === '');
    ok('an unfinished shipment can be done again', /ship/.test(actions(panel({ lists: { L: list('shipping', { claimAt: iso(Date.now() - 6 * 60000) }) } }).html)));
    ok('recently shipped: undo', actions(panel({ done: { L: shippedList() } }).html) === 'undo');
    ok('old or cancelled ones are left out', actions(panel({ done: { L: shippedList({ shippedAt: iso(NOW - 31 * 864e5) }), C: list('cancelled') } }).html) === '');
    const T = panel({ tabs: ['fgi'], lists: { L: list('packed') }, done: { D: shippedList() } });
    ok('without the FBA tab: no buttons', actions(T.html) === '' && !T.pack);
    const X = panel({ lists: { L: list('open', { lines: { A: { sku: '<img src=x>', qty: 1, packed: 0 } } }) } });
    ok('text is escaped', !/<img/.test(X.html) && /&lt;img/.test(X.html));
  }
  console.log('== pack ==');
  {
    const S = screen({ lists: { L: list('open') } });
    await S.ctx.fblvPackPress();
    ok('one list: straight into it', JSON.stringify(S.calls) === '[["pack","L"]]');
    const T = screen({ lists: { L: list('open'), M: list('open') } });
    await T.ctx.fblvPackPress();
    ok('several: asked which', T.calls.length === 0 && /Press Pack/.test(T.box('fbaMsg').textContent));
    S.ctx.pkvOpenFbaList = async () => { throw new Error('no camera'); };
    await S.ctx.fblvPack('L');
    ok('a failure is said', /no camera/.test(S.box('fbaMsg').textContent) && S.box('fbaMsg').className === 'err');
  }
  console.log('== ship, cancel, undo ==');
  {
    const S = screen({ lists: { L: list('packed') } });
    await S.ctx.fblvShipOpen('L');
    const d = S.dialogs[0];
    ok('pieces default to packed, never above', /max="3" step="1" value="3"/.test(d.html) && /freed/.test(d.note));
    S.box('fblvShipment').value = 'FBA1'; S.box('fblvDate').value = '2026-11-28';
    ok('a blank box is refused', /0 if none/.test(await d.onSave()) && S.calls.length === 0);
    S.box('fblvShipQty0').value = '2';
    ok('shipment, date and pieces are sent', await d.onSave() === '' && JSON.stringify(S.calls[0]) === '["fblShip","L",{"shipment":"FBA1","date":"2026-11-28","qtyBySku":{"A":2}}]', JSON.stringify(S.calls[0]));
    const O = screen({ lists: { L: list('open') } }); await O.ctx.fblvShipOpen('L');
    ok('an unpacked list has no ship form', O.dialogs.length === 0);
    const W = screen({ says: 'Shipped. 2 released piece(s) were NOT given back.' });
    ok('shipped with a warning: form closes, warning shown', W.ctx.fblvAfter(await W.ctx.fblShip(), 'Shipped.', 'ok') === '' && /NOT given back/.test(W.box('fbaMsg').textContent));
    ok('a refusal stays on the form', W.ctx.fblvAfter('Not shipped — short.', 'Shipped.', 'ok') === 'Not shipped — short.');
    const C = screen({ lists: { L: list('open') } }); await C.run('fblvCancelAsk("L")');
    ok('cancel asks first', C.calls.length === 0 && C.dialogs.length === 1);
    await C.dialogs[0].onSave();
    ok('then cancels', C.calls[0][0] === 'fblCancel' && C.calls[0][1] === 'L');
    const U = screen({ done: { L: shippedList() } }); await U.run('fblvUndoAsk("L")');
    ok('undo asks first', U.calls.length === 0 && U.dialogs.length === 1);
    await U.dialogs[0].onSave();
    ok('then undoes', U.calls[0][0] === 'fblUndoShip' && U.calls[0][1] === 'L');
  }
  console.log('== a row a list shipped ==');
  {
    const rows = [sent('F', 3, { fbaListId: 'L', fbaShippedAt: iso(NOW), fbaShipment: 'FBA9' })];
    const undo = async sw => {
      const S = screen({ switch: sw, rows, done: { L: shippedList() } });
      Object.assign(S.ctx, { fgaReread: async () => '', fbaFresh: async () => [{ id: 'F', row: rows[0] }] });
      S.run(whole('inventory/fba-ship-excel.js', 'fbaUndo'));
      return { S, said: await S.ctx.fbaUndo('F') };
    };
    for (const sw of ['1', '0']) {
      const got = await undo(sw);
      ok(`switch ${sw}: goes to the list's Undo ship, nothing written`, got.said === '' && got.S.dialogs.length === 1
        && got.S.dialogs[0].title === 'Undo ship' && got.S.writes.length === 0, got.said);
    }
  }
  console.log('== wiring ==');
  {
    const has = (f, text) => appFile(f).includes(text);
    ok('scanners hidden when lists are on', has('inventory/finished-goods.js', "const scanners = fgiCanEntry() && !(typeof fblOn === 'function' && fblOn());")
      && has('inventory/finished-goods.js', "$('fgPack').classList.toggle('hide', !scanners)") && has('inventory/finished-goods.js', "$('fgScan').classList.toggle('hide', !scanners)"));
    ok('the stock list ticks for the FBA team', has('inventory/finished-goods.js', "const canTick = canEd || (typeof fblOn === 'function' && fblOn() && fbaCan());")
      && has('inventory/finished-goods.js', "(canTick ? `<td><input type=\"checkbox\" data-fgpick"));
    ok('every shipped row has Undo ship, list rows too', has('inventory/fba-dispatch.js', "s.st === 'shipped' ? btn('data-fba-undo', id, 'Undo ship')"));
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    ok('the buttons and panel are on the page', ['fgFbaList', 'fbaPackBtn', 'fbaLists', 'fgScan', 'fgPack'].every(id => html.includes(`id="${id}"`)));
  }

  const { pass, fail } = counts();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (!fail && !process.env.FGA_MUT_FILE) teeth();
  process.exit(process.exitCode || (fail ? 1 : 0));
})().catch(e => { console.log('suite stopped: ' + (e.stack || e)); process.exit(1); });

/** Each broken copy of the screen code must make this suite fail. */
function teeth() {
  const { spawnSync } = require('child_process'), os = require('os');
  const view = 'inventory/fba-lists-view.js';
  const broken = [
    [view, 'const fblvMayList = () => fblOn() && fbaCan();', 'const fblvMayList = () => true;'],
    [view, 'Math.min(unlisted, allowed)', 'allowed'],
    [view, '+ fgiReleased(sku);', ';'],
    [view, 'onSave: () => fblvMakeSave(id, skus),', "onSave: () => fblvMakeSave(fgiNewId('FBL'), skus),"],
    [view, ".filter(l => l.qty !== '' && Number(l.qty) !== 0)", ''],
    [view, "if (typed === '') return", "if (typed === 'x') return"],
    [view, 'if (said && !said.startsWith(doneStart)) return said;', 'if (said) return said;'],
    [view, '<b style="font-family:ui-monospace,monospace">${esc(l.sku)}</b>', '<b>${l.sku}</b>'],
    [view, 'if (!fbaCan()) return \'\';', ''],
    ['inventory/fba-dispatch.js', "s.st === 'shipped' ? btn(", "s.st === 'shipped' && !r.fbaListId ? btn("],
    ['inventory/fba-ship-excel.js', 'await fblvUndoAsk(row.fbaListId);', ''],
  ];
  const tmp = path.join(os.tmpdir(), `fblv-broken-${process.pid}.js`);
  let missed = 0;
  for (const [file, from, to] of broken) {
    const src = appFile(file);
    if (!src.includes(from)) { console.log('  FAIL teeth: not found: ' + from); missed++; continue; }
    fs.writeFileSync(tmp, src.replace(from, () => to));
    const run = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { FGA_MUT_FILE: file, FGA_MUT_SRC: tmp }) });
    if (run.status === 0) { console.log('  FAIL teeth: survived: ' + from); missed++; }
  }
  fs.rmSync(tmp, { force: true });
  console.log(`teeth: ${broken.length - missed} of ${broken.length} broken copies caught`);
  if (missed) process.exitCode = 1;
}
