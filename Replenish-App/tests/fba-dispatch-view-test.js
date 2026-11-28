/* FBA DISPATCH: ONE LINE PER ARTICLE (28 Nov): the article view, its filters, search, Air / Sea / AWD, the orders behind a
 * figure and the accepted-not-shipped line, all behind switch storeAlloc.
 *   node tests/fba-dispatch-view-test.js
 *   FGA_MUT_FILE=<path under src/app> FGA_MUT_SRC=<file> runs it against a broken copy (the part at the end does this). */
const { fs, path, appFile, cut, line, whole, NOW, iso, row, sent, store, counts, check: ok, same } = require('./india-store-harness');

const DISPATCH = 'inventory/fba-dispatch.js', SHIP = 'inventory/fba-ship-excel.js', VIEW = 'inventory/fba-dispatch-view.js';
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const india = daysAgo => new Date(NOW + 330 * 60000 - daysAgo * 864e5).toISOString().slice(0, 10);
const dmy = daysAgo => india(daysAgo).split('-').reverse().join('/');
/** A dispatch sent so many days ago. */
const out = (id, sku, qty, days, over) => sent(id, qty, Object.assign({ sku, date: dmy(days), createdAt: iso(NOW - days * 864e5) }, over));
const named = (...pairs) => pairs.map(([orderNo, qty]) => ({ orderNo, qty }));
const accepted = days => ({ fbaAcceptedAt: iso(NOW - days * 864e5), fbaAcceptedBy: 'team@test' });
const shipped = over => Object.assign({ fbaAcceptedAt: iso(NOW), fbaShippedAt: iso(NOW), fbaShipment: 'FBA15ABCDEF' }, over);

const MASTER = {
  A: { sku: 'A', brand: 'Ridhi', subtype: 'Quilt', color: 'Blue', size: 'King' },
  B: { sku: 'B', brand: 'CPC', subtype: 'Cover', color: 'Red', size: 'Queen' },
  'NEVER-SENT': { sku: 'NEVER-SENT', brand: 'Ridhi', subtype: 'Runner', color: 'Plum', size: 'S' },
};
const LEDGER = () => [
  out('w', 'A', 5, 2, { orders: named(['AMZ-01112026-01-AIR', 3]) }),
  out('acc', 'A', 4, 10, Object.assign({ issuedFor: 'CPC FBA', orders: named(['B2B-7', 4]) }, accepted(9))),
  out('part', 'A', 10, 40, Object.assign({ fbaReturned: 3, orders: named(['B2B-7', 6], ['ONL-9', 4]) }, accepted(39))),
  out('shp', 'A', 6, 20, shipped({ fbaListId: 'L1', fbaLane: 'awd', orders: named(['AMZ-02112026-01-SEA', 6]) })),
  out('ret', 'A', 2, 5, { fbaReturned: 2 }),
  out('old', 'B', 20, 100, accepted(99)),
  out('sheet', 'B', 7, 400, { source: 'sheet: ready goods', issuedFor: '' }),
];
const SALES = [{ _id: 'B2B-7', shipMode: 'Sea', orderDate: '2026-11-01', buyerName: 'Secret Buyer' }];

/** The screen over that ledger: by article, everything sent, no dates. */
function screen(o = {}) {
  const S = store(Object.assign({ rows: o.rows || LEDGER(), sales: o.sales || SALES, lines: [{ orderNo: 'ONL-9', sku: 'A', qty: 4, orderDate: '05/11/2026' }] }, o));
  const dialogs = [], files = [], boxes = {};
  const box = id => boxes[id] || (boxes[id] = (() => {
    const classes = new Set(), listeners = {};
    return { id, value: '', textContent: '', innerHTML: '', className: '', disabled: false, listeners,
      classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
      addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); } };
  })());
  const master = o.master || MASTER;
  Object.assign(S.ctx, {
    $: box, esc, ME: { email: 'team@test', admin: false, tabs: o.tabs || ['fba'] }, spIsVendor: () => false,
    mdbOf: sku => master[String(sku).trim().toUpperCase()] || null, PTG: { mdb: Object.values(master) },
    ptImgCell: sku => `<td data-img="${esc(sku)}"></td>`, ptImgFill: () => {}, ptImgPatch: () => {}, ptEmpty: () => {},
    ptOpenDialog: cfg => dialogs.push(cfg), ptDownload: (name, lines) => files.push({ name, lines }), fgiOutTxt: () => 'orders',
  });
  S.run(line('core/helpers.js', 'const dTodayIndia') + line('core/helpers.js', 'const dDiff') + line('core/helpers.js', 'function csvCell')
    + line('inventory/fg-change-remove.js', 'const fgiDmy') + line('inventory/finished-goods.js', 'const fgiMaster').replace('const ', 'var ')
    + line('inventory/finished-goods.js', 'const fgiMatches') + line('inventory/fba-lists-view.js', 'const FBLV_LANE_NAMES')
    + whole('core/database-read.js', 'ptDtMs') + whole('vendors/orders/vendor-orders.js', 'ptFillSelect')
    + cut(appFile('production/whatsapp.js'), 'const ptIsoDate', 'function bdEdit')
    + line(DISPATCH, 'const fbaCan') + cut(appFile(DISPATCH), 'const FBA_PILL', 'function fbaState') + cut(appFile(DISPATCH), 'function fbaAll', '/** The dispatches, read again')
    + cut(appFile(SHIP), 'const FBA_STALE_DAYS', '/**\n * The rows of a shipment file') + appFile(VIEW)
    + cut(appFile(SHIP), "$('fbaTable').addEventListener", "$('fbaAccept').onclick") + appFile(SHIP).slice(appFile(SHIP).indexOf("$('fbaExport').onclick")));
  const set = (id, value) => { box(id).value = value; };
  set('fbaStatus', o.status === undefined ? '' : o.status);
  set('fbvView', o.view || 'article');
  const draw = () => { S.run('renderFba()'); return box('fbaTable').innerHTML; };
  /** Press the thing on the screen carrying these attributes. */
  const press = (id, attrs, checked) => {
    const el = { checked, getAttribute: n => (n in attrs ? attrs[n] : null) };
    const target = { closest: sel => (sel.slice(1, -1) in attrs ? el : null) };
    box(id).listeners.click.forEach(fn => fn({ target }));
  };
  const copy = code => JSON.parse(JSON.stringify(S.run(code)));
  return Object.assign(S, { box, set, draw, press, dialogs, files, copy });
}
const text = h => h.replace(/<[^>]+>/g, '|').split('|').filter(Boolean);
/** The article lines of the table (opened dispatches left out): [{ sku, cells }]. */
const articleLines = html => (html.split('<tbody>')[1] || '').split('<tfoot>')[0].replace(/<table class="xl fbv-sub">[\s\S]*?<\/table>/g, '')
  .split('<tr>').filter(r => r.includes('data-fbv-open='))
  .map(r => ({ sku: /data-fbv-open="([^"]*)"/.exec(r)[1], cells: r.split('<td').slice(1).map(c => c.slice(c.indexOf('>') + 1).replace(/<[^>]+>/g, '')) }));
const figures = (html, sku) => articleLines(html).find(l => l.sku === sku).cells.slice(7);
const totals = html => text(html.split('<tfoot>')[1] || '').filter(t => /^[\d,]+$/.test(t)).map(Number);
const tiles = html => (html.match(/<div class="v"[^>]*>([^<]*)<\/div>/g) || []).map(m => m.replace(/<[^>]+>/g, ''));
const orderRows = dialog => dialog.html.split('<tbody>')[1].split('<tr>').slice(1).map(r => text(r));
const picks = S => [...S.run('FBA_PICK')].sort().join();

(async () => {
  console.log('== switch off: as it was ==');
  {
    const S = screen({ ls: '0' });
    S.set('fbvBrand', 'CPC'); S.set('fbvAccount', 'CPC');
    const html = S.draw();
    ok('every dispatch listed, no new filter applied', S.run('FBA.shown.length') === 7);
    ok('no new column, button or article line', !/data-fbv|Air \/ Sea \/ AWD|<tfoot>/.test(html) && /<th class="num">Pieces<\/th><th>FBA account<\/th>/.test(html));
    ok('new controls hidden', ['fbvView', 'fbvBrand', 'fbvAccount', 'fbvAges'].every(id => S.box(id).classList.contains('hide')));
    ok('the message is the old one', /^7 dispatch\(es\), newest first · 49 piece\(s\) not returned · 1 older dispatch/.test(S.box('fbaMsg').textContent), S.box('fbaMsg').textContent);
    S.set('fbaQ', 'zzz-9'); const none = S.draw();
    ok('a search says "Nothing here" as before', none.includes('colspan="13"') && none.includes('Nothing here.') && !/does not exist/.test(S.box('fbaMsg').textContent));
    S.set('fbaQ', ''); S.draw(); S.box('fbaExport').onclick();
    ok('export as before', S.files[0].name === 'fba-dispatch' && S.files[0].lines[0].endsWith('Shipped by,Id'));
  }

  console.log('== one line per article ==');
  {
    const S = screen();
    const html = S.draw();
    const lines = articleLines(html);
    ok('shown by default, one line each', lines.map(l => l.sku).join() === 'B,A', lines.map(l => l.sku).join());
    ok('image, brand, item, colour, size', same(lines[1].cells.slice(3, 7), ['Ridhi', 'Quilt', 'Blue', 'King']) && html.includes('data-img="A"'));
    ok('waiting, accepted, shipped, returned, sheet', same(figures(html, 'A').slice(0, 5), ['5', '11', '6', '5', '—']), figures(html, 'A').join());
    ok('the sheet history has its own column', same(figures(html, 'B').slice(0, 5), ['—', '20', '—', '—', '7']) && html.includes('From the sheet'));
    ok('totals', same(totals(html), [5, 31, 6, 5, 7]), totals(html).join());
    const t = tiles(S.box('fbaKpis').innerHTML).filter((v, i, all) => i !== 2 || all.length === 4);
    ok('totals agree with the tiles', same(t.map(Number), [5, 31, 6, 5]), t.join());
    S.set('fbvView', 'dispatch'); S.draw();
    ok('totals match the per-dispatch view', S.box('fbaMsg').textContent.includes('49 piece(s) not returned') && 5 + 31 + 6 + 7 === 49);
    S.set('fbvView', 'article'); S.set('fbaStatus', 'todo');
    const todo = S.draw();
    ok('the status filter is followed', same(figures(todo, 'A').slice(0, 4), ['5', '11', '—', '3']) && !todo.includes('From the sheet'), figures(todo, 'A').join());
    S.set('fbaStatus', ''); S.set('fbaD1', india(12)); S.set('fbaD2', india(8));
    ok('the dates are followed', same(totals(S.draw()), [0, 4, 0, 0]));
  }
  {
    const rows = [out('x', 'ZED', 9, 1), out('y', 'MID', 2, 1, accepted(1)), out('z', 'MID', 3, 1), out('done', 'ABC', 50, 1, shipped())];
    ok('most pieces to do first', articleLines(screen({ rows }).draw()).map(l => l.sku).join() === 'ZED,MID,ABC');
    const many = Array.from({ length: 601 }, (_, i) => out('m' + i, 'S' + String(i).padStart(4, '0'), 1, 1));
    const S = screen({ rows: many.concat(out('extra', 'S0000', 1, 1)) }), html = S.draw();
    ok('600 articles shown, and said', articleLines(html).length === 600 && /601 article\(s\).*showing the first 600 articles/.test(S.box('fbaMsg').textContent) && totals(html)[0] === 602);
    S.press('fbaTable', { 'data-fba-all': '' }, true);
    ok('tick all covers every dispatch of the articles shown, and no other', S.run('FBA_PICK.size') === 601 && !S.run('FBA_PICK.has("m600")'));
    S.box('fbaExport').onclick();
    ok('export covers every article', S.files[0].lines.length === 602);
  }

  console.log('== opening a line ==');
  {
    const S = screen();
    ok('closed at first', !S.draw().includes('fbv-sub'));
    S.press('fbaTable', { 'data-fbv-open': 'A' });
    const html = S.box('fbaTable').innerHTML;
    ok('its dispatches with the row actions', ['data-fba-ok="w"', 'data-fba-ship="acc"', 'data-fba-ret="part"', 'data-fba-undo="acc"', 'data-fba-undo="shp"'].every(a => html.includes(a)) && !html.includes('data-fba-ok="old"'));
    ok('and today\'s columns', ['Sent by', 'Status', 'Accepted', 'Shipped', 'Returned', 'FBA account', 'Air / Sea / AWD'].every(h => html.split('fbv-sub')[1].includes('>' + h + '</th>')));
    ok('each can be ticked', ['w', 'acc', 'part'].every(id => html.includes(`data-fba-pick="${id}"`)) && !html.includes('data-fba-pick="shp"'));
    S.press('fbaTable', { 'data-fba-pick': 'acc' }, true);
    ok('one tick counts and the line says how many', picks(S) === 'acc' && S.box('fbaAccept').textContent === 'Accept 1' && S.box('fbaTable').innerHTML.includes('1 of 3'));
    S.press('fbaTable', { 'data-fbv-pick': 'A' }, true);
    ok('the article tick takes its open dispatches only', picks(S) === 'acc,part,w', picks(S));
    S.press('fbaTable', { 'data-fbv-pick': 'A' }, false);
    ok('and takes them off', picks(S) === '');
    S.press('fbaTable', { 'data-fba-all': '' }, true);
    ok('tick all', picks(S) === 'acc,old,part,w', picks(S));
    S.press('fbaTable', { 'data-fbv-open': 'A' });
    ok('closed again, ticks kept', !S.box('fbaTable').innerHTML.includes('fbv-sub') && S.run('FBA_PICK.size') === 4);
    const viewer = screen({ tabs: [] });
    viewer.draw(); viewer.press('fbaTable', { 'data-fbv-open': 'A' });
    ok('without the right: no ticks and no buttons', !/data-fba-pick|data-fbv-pick|data-fba-all|data-fba-ok|data-fba-ship/.test(viewer.box('fbaTable').innerHTML));
  }

  console.log('== brand and account ==');
  {
    const S = screen();
    S.draw();
    ok('brands offered', /value="CPC">CPC<.*value="Ridhi">Ridhi</.test(S.box('fbvBrand').innerHTML));
    S.set('fbvBrand', 'CPC');
    ok('brand filter', articleLines(S.draw()).map(l => l.sku).join() === 'B');
    S.set('fbvBrand', ''); S.set('fbvAccount', 'CPC');
    ok('account filter, from the dispatch\'s account', same(totals(S.draw()), [0, 4, 0, 0]));
    S.set('fbvAccount', 'SP');
    ok('the other account', same(totals(S.draw()), [5, 27, 6, 5]), totals(S.draw()).join());
    S.set('fbvAccount', 'none');
    ok('dispatches naming neither', same(totals(S.draw()), [0, 0, 0, 0, 7]));
    S.set('fbvView', 'dispatch'); S.set('fbvAccount', 'CPC'); S.draw();
    ok('every dispatch is filtered too', S.run('FBA.shown.length') === 1);
  }

  console.log('== search ==');
  {
    const S = screen();
    const said = (q, status) => { S.set('fbaQ', q); S.set('fbaStatus', status || ''); const html = S.draw(); return { html, msg: S.box('fbaMsg').textContent }; };
    ok('a SKU never sent', said('never-sent').msg.startsWith('SKU NEVER-SENT is not in FBA Dispatch.'));
    ok('a SKU nobody has', said('GHOST-1').msg.startsWith('SKU GHOST-1 does not exist.') && said('GHOST-1').html.includes('SKU GHOST-1 does not exist.'));
    ok('hidden by the filters', said('b', 'shipped').msg.startsWith('SKU B is in FBA Dispatch but hidden by the filters.'));
    ok('found: nothing to say', said('a').msg.startsWith('1 article(s)') || said('a').msg.startsWith('2 article(s)'), said('a').msg);
    ok('words matching hidden dispatches', said('cover', 'waiting').msg.startsWith('Matching dispatches are in FBA Dispatch but hidden'));
    ok('words matching products never sent', said('plum').msg.startsWith('Matching products are not in FBA Dispatch.'));
    ok('words matching nothing', said('green sofa').msg.startsWith('Nothing in the Master Database matches "green sofa".'));
    ok('a shipment id is not called a SKU', said('FBA15ZZZZZZ').msg.startsWith('No dispatch carries the shipment id FBA15ZZZZZZ.'));
    const bad = said('<img src=x>');
    ok('typed text is escaped', !bad.html.includes('<img src=x') && bad.html.includes('&lt;img src=x&gt;'));
    const U = screen({ master: {} }); U.set('fbaQ', 'GHOST-1'); U.draw();
    ok('master not read: no "does not exist"', /could not be checked — the Master Database was not read/.test(U.box('fbaMsg').textContent));
  }

  console.log('== Air / Sea / AWD ==');
  {
    const S = screen();
    const lanes = id => S.run(`fbvLanesOf(FGI.rows.find(r => r._id === "${id}"), fbvSalesByNo()).join()`);
    ok('the number ending, with pieces naming no order unknown', lanes('w') === 'Air,—', lanes('w'));
    ok('the sales order\'s mode', lanes('acc') === 'Sea', lanes('acc'));
    ok('an order with no mode is unknown, not Air', lanes('part') === 'Sea,—', lanes('part'));
    ok('the list\'s lane comes first', lanes('shp') === 'AWD', lanes('shp'));
    ok('no order: unknown', lanes('old') === '—');
    ok('the article line shows each once', figures(S.draw(), 'A')[5] === 'Air, Sea, AWD, —', figures(S.draw(), 'A')[5]);
    S.set('fbvView', 'dispatch');
    ok('every dispatch has the column', /<th class="num">Pieces<\/th><th>Air \/ Sea \/ AWD<\/th>/.test(S.draw()) && S.box('fbaTable').innerHTML.includes('<td>Air, —</td>'));
    S.run('FGA_SALES = { rows: [], err: "permission denied" }'); S.draw();
    ok('sales orders unread is said', /sales orders could not be read/.test(S.box('fbaMsg').textContent) && lanes('acc') === '—');
  }

  console.log('== the orders behind a figure ==');
  {
    const S = screen();
    S.draw();
    const open = (figure, sku) => { S.press('fbaTable', { 'data-fbv-fig': figure, 'data-fbv-sku': sku }); return S.dialogs[S.dialogs.length - 1]; };
    const acc = open('accepted', 'A');
    ok('order, channel, date, pieces; no order said; oldest first', same(orderRows(acc), [['B2B-7', 'B2B', '01/11/2026', '10'], ['ONL-9', 'Online', '05/11/2026', '1']]), JSON.stringify(orderRows(acc)));
    ok('a return counts off the last order named', same(orderRows(open('returned', 'A')).map(r => [r[0], r[3]]), [['ONL-9', '3'], ['No order named', '2']]), JSON.stringify(orderRows(open('returned', 'A'))));
    ok('pieces naming no order are shown', same(orderRows(open('waiting', 'A')).map(r => [r[0], r[3]]), [['AMZ-01112026-01-AIR', '3'], ['No order named', '2']]));
    const sum = d => orderRows(d).reduce((n, r) => n + Number(r[3]), 0);
    ok('rows add up to every figure', same(['waiting', 'accepted', 'shipped', 'returned'].map(f => sum(open(f, 'A'))), [5, 11, 6, 5]) && sum(open('sheet', 'B')) === 7);
    ok('no customer details, nothing to save', !/Secret Buyer/.test(acc.html + acc.note + acc.subtitle) && !acc.onSave);
    S.set('fbvAccount', 'CPC'); S.draw();
    ok('only the dispatches the screen shows', same(orderRows(open('accepted', 'A')).map(r => r[3]), ['4']));
    ok('the box says how many dispatches hold those pieces', S.dialogs[S.dialogs.length - 1].note.startsWith('4 piece(s) in 1 dispatch'));
    S.set('fbvAccount', ''); S.draw();
    ok('a dispatch with none of the figure is not counted', open('waiting', 'A').note.startsWith('5 piece(s) in 1 dispatch'));
    S.set('fbvAccount', 'CPC'); S.draw();
    S.set('fbvAccount', ''); S.set('fbvView', 'dispatch'); S.draw();
    S.press('fbaTable', { 'data-fbv-fig': 'sent', 'data-fbv-id': 'part' });
    ok('one dispatch\'s pieces', sum(S.dialogs[S.dialogs.length - 1]) === 10);
    ok('its figures are pressable', /data-fbv-fig="sent" data-fbv-id="part"/.test(S.box('fbaTable').innerHTML) && /data-fbv-fig="returned" data-fbv-id="part"/.test(S.box('fbaTable').innerHTML));
    ok('nothing was written', S.writes.length === 0);
  }

  console.log('== accepted, not shipped ==');
  {
    const at = days => screen().run(`fbvAgeOf({ date: "${dmy(days)}" })`);
    ok('age bands and their edges', [0, 7, 8, 30, 31, 90, 91].map(at).join() === '0-7,0-7,8-30,8-30,31-90,31-90,over90', [0, 7, 8, 30, 31, 90, 91].map(at).join());
    ok('no date at all is said', screen().run('fbvAgeOf({})') === 'unknown');
    const S = screen({ status: 'todo' });
    S.draw();
    const chips = () => Object.fromEntries([...S.box('fbvAges').innerHTML.matchAll(/data-fbv-(?:age|acct)="([^"]+)"[^>]*>[^<]*<b>(\d+)<\/b>/g)].map(m => [m[1], Number(m[2])]));
    ok('pieces by age and account', same(chips(), { '0-7': 0, '8-30': 4, '31-90': 7, over90: 20, SP: 27, CPC: 4 }), JSON.stringify(chips()));
    S.press('fbvAges', { 'data-fbv-age': '31-90' });
    ok('a press lists those pieces', S.box('fbaStatus').value === 'accepted' && same(totals(S.box('fbaTable').innerHTML), [0, 7, 0, 3]));
    ok('account counts follow the picked age', chips().SP === 7 && chips().CPC === 0 && chips()['8-30'] === 4);
    S.press('fbvAges', { 'data-fbv-age': '31-90' });
    ok('a second press takes it off', S.run('FBA.shown.length') === 3);
    S.press('fbvAges', { 'data-fbv-acct': 'CPC' });
    ok('an account press', S.box('fbvAccount').value === 'CPC' && same(totals(S.box('fbaTable').innerHTML), [0, 4, 0, 0]));
    S.press('fbvAges', { 'data-fbv-acct': 'CPC' });
    ok('and off', S.box('fbvAccount').value === '' && S.run('FBA.shown.length') === 3);
    S.press('fbvAges', { 'data-fbv-age': 'over90' });
    S.set('fbaStatus', ''); S.draw();
    ok('the age does not narrow another status', S.run('FBA.shown.length') === 7);
    S.press('fbvAges', { 'data-fbv-acct': 'SP' });
    ok('an account press from another status drops the old age, so it lists what it said', same(totals(S.box('fbaTable').innerHTML), [0, 27, 0, 3]), totals(S.box('fbaTable').innerHTML).join());
    ok('read only', S.writes.length === 0);
  }

  console.log('== export ==');
  {
    const S = screen();
    S.draw(); S.box('fbaExport').onclick();
    const f = S.files[0];
    ok('by article', f.name === 'fba-dispatch-by-article' && f.lines[0] === 'SKU,Brand,Item,Colour,Size,Waiting,"Accepted, not shipped",Shipped,Returned,From the sheet,Air / Sea / AWD', f.lines[0]);
    ok('with the figures', f.lines[2] === 'A,Ridhi,Quilt,Blue,King,5,11,6,5,0,"Air, Sea, AWD, —"', f.lines[2]);
    S.set('fbvView', 'dispatch'); S.draw(); S.box('fbaExport').onclick();
    ok('every dispatch, with the lane', S.files[1].name === 'fba-dispatch' && S.files[1].lines.length === 8 && S.files[1].lines[0].endsWith('Id,Air / Sea / AWD') && S.files[1].lines.some(l => l.endsWith('w,"Air, —"')));
  }

  console.log('== wiring ==');
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    ok('controls on the page, hidden until the switch', ['fbvView', 'fbvBrand', 'fbvAccount', 'fbvAges'].every(id => new RegExp(`id="${id}" class="hide"`).test(html)));
    const order = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'ORDER'), 'utf8');
    ok('the file is joined into the page', order.includes(VIEW));
  }

  const { pass, fail } = counts();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (!fail && !process.env.FGA_MUT_FILE) teeth();
  process.exit(process.exitCode || (fail ? 1 : 0));
})().catch(e => { console.log('suite stopped: ' + (e.stack || e)); process.exit(1); });

/** Each broken copy of the screen code must make this suite fail. */
function teeth() {
  const { spawnSync } = require('child_process'), os = require('os');
  const broken = [
    [VIEW, "const fbvOn = () => typeof fgaOn === 'function' && fgaOn();", 'const fbvOn = () => true;'],
    [VIEW, "$('fbvView').value !== 'dispatch'", "$('fbvView').value === 'dispatch'"],
    [VIEW, '.sort((a, b) => todo(b) - todo(a) || ', '.sort((a, b) => '],
    [VIEW, "if (figure === 'returned') return s.st === 'sheet' ? 0 : s.returned;", "if (figure === 'returned') return s.st === 'returned' ? s.returned : 0;"],
    [VIEW, 'return s.st === figure ? s.open : 0;', 'return s.st === figure ? s.qty : 0;'],
    [VIEW, 'fbvArticles(rows).slice(0, FBA_LIST_LIMIT).flatMap(fbvInside)', 'fbvArticles(rows).flatMap(fbvInside)'],
    [VIEW, 'fbvInside(article).filter(fbaActionable).forEach', 'fbvInside(article).forEach'],
    [VIEW, "(!brand || fbvBrandOf(r.sku) === brand) && ", ''],
    [VIEW, "(!account || fbvAccountOf(r) === account) && ", ''],
    [VIEW, "if (FBLV_LANE_NAMES[r.fbaLane]) return [FBLV_LANE_NAMES[r.fbaLane]];", ''],
    [VIEW, '|| FBV_NO_LANE;', "|| 'Air';"],
    [VIEW, 'sales.get(orderNo) || { _id: orderNo }', '{ _id: orderNo }'],
    [VIEW, "return parts.concat({ no: '', pcs: left }).filter", 'return parts.filter'],
    [VIEW, "let skip = figure === 'returned' ? x.s.open : 0,", 'let skip = 0,'],
    [VIEW, '.filter(x => fbvPiecesOf(x, figure) > 0);\n  if', ';\n  if'],
    [VIEW, "return `SKU ${code} is in FBA Dispatch but hidden by the filters.`;", "return '';"],
    [VIEW, 'if (!master.length) return', 'if (false) return'],
    [VIEW, "{ key: '0-7', label: '0–7 days', upTo: 7 }", "{ key: '0-7', label: '0–7 days', upTo: 8 }"],
    [VIEW, "($('fbaStatus').value === 'accepted' ? FBV.age : '')", 'FBV.age'],
    [VIEW, "if (!accepted) FBV.age = '';", ''],
    [VIEW, "FBV.age = accepted && FBV.age === key ? '' : key;", 'FBV.age = key;'],
    [VIEW, "fbaRows({ status: 'accepted', age: '' })", "fbaRows({ status: 'accepted' })"],
    [SHIP, 'if (on && fbvByArticle()) return fbvExport(rows);', ''],
    [DISPATCH, '.filter(x => !more || fbvKeeps(x.r, over))', ''],
    [DISPATCH, "if (view.on) cols.splice", 'if (true) cols.splice'],
    [DISPATCH, "const drawn = on && fbvByArticle() ?", 'const drawn = false ?'],
    [DISPATCH, "${sought ? esc(sought) :", '${sought ? sought :'],
    [DISPATCH, 'held.filter(fbaActionable)', 'held'],
    [SHIP, "...(on ? [FBV_LANE_HEAD] : [])", ''],
    [SHIP, 'fbaTickable(FBA.shown || [])', '(FBA.shown || []).slice(0, 600).filter(fbaActionable)'],
  ];
  const tmp = path.join(os.tmpdir(), `fbv-broken-${process.pid}.js`);
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
