/* FBA DISPATCH REDESIGN (28 Nov): FBA lists first, Accept all waiting, the More menu, coloured status badges, cards on a phone,
 * all behind switch storeAlloc.
 *   node tests/fba-dispatch-redesign-test.js
 *   FGA_MUT_FILE=<path under src/app> FGA_MUT_SRC=<file> runs it against a broken copy (the part at the end does this). */
const { fs, path, appFile, cut, line, whole, NOW, iso, row, sent, store, counts, check: ok, same } = require('./india-store-harness');

const DISPATCH = 'inventory/fba-dispatch.js', SHIP = 'inventory/fba-ship-excel.js', VIEW = 'inventory/fba-dispatch-view.js';
const LISTS = 'inventory/fba-lists.js', LISTS_VIEW = 'inventory/fba-lists-view.js', REDESIGN = 'inventory/fba-dispatch-redesign.js';
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const india = daysAgo => new Date(NOW + 330 * 60000 - daysAgo * 864e5).toISOString().slice(0, 10);
const dmy = daysAgo => india(daysAgo).split('-').reverse().join('/');
const out = (id, sku, qty, days, over) => sent(id, qty, Object.assign({ sku, date: dmy(days), createdAt: iso(NOW - days * 864e5) }, over));
const accepted = days => ({ fbaAcceptedAt: iso(NOW - days * 864e5), fbaAcceptedBy: 'team@test' });
const shipped = over => Object.assign({ fbaAcceptedAt: iso(NOW), fbaShippedAt: iso(NOW), fbaShipment: 'FBA15ABCDEF' }, over);
const MASTER = {
  A: { sku: 'A', brand: 'Ridhi', subtype: 'Quilt', color: 'Blue', size: 'King' },
  B: { sku: 'B', brand: 'CPC', subtype: 'Cover', color: 'Red', size: 'Queen' },
};
/** A made-up FBA list. */
const list = (status, over) => Object.assign({ account: 'Ridhi FBA', store: 'SP', lane: 'sea', status, by: 'team@test', at: iso(NOW),
  lines: { A: { sku: 'A', qty: 4, packed: 0 } } }, over);

/** The ledger: one of each state, so the badges and the buttons can be told apart. */
const LEDGER = () => [
  out('w', 'A', 5, 2), out('acc3', 'A', 4, 10, accepted(3)), out('acc29', 'A', 2, 40, accepted(29)), out('acc30', 'A', 3, 40, accepted(30)),
  out('old40', 'B', 20, 100, accepted(40)), out('shp', 'A', 6, 20, shipped()), out('ret', 'A', 2, 5, { fbaReturned: 2 }),
];

/** The screen over a ledger. o: { rows, lists, done, phone, ls (switch storeAlloc), tabs, patchFails (the nth save fails) }. */
function screen(o = {}) {
  const S = store(Object.assign({ rows: o.rows || LEDGER(), sales: [], lines: [] }, o));
  const dialogs = [], dlgMsgs = [], moved = [], boxes = {}, opened = [];
  const box = id => boxes[id] || (boxes[id] = (() => {
    const classes = new Set(id === 'fbaBreak' || id === 'fbrMore' || id === 'fbaAcceptAll' ? ['hide'] : []);
    return { id, value: '', textContent: '', innerHTML: '', className: '', disabled: false, open: false, checked: false,
      classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
      addEventListener: () => {}, appendChild: el => moved.push(el.id) };
  })());
  const master = MASTER;
  let saves = 0;
  Object.assign(S.ctx, {
    $: box, esc, ME: { email: 'team@test', admin: false, repl: true, tabs: o.tabs || ['fba'] }, spIsVendor: () => false,
    mdbOf: sku => master[String(sku).trim().toUpperCase()] || null, PTG: { mdb: Object.values(master) },
    ptImgCell: sku => `<td data-img="${esc(sku)}"></td>`, ptImgInner: () => '<img>', ptImgFill: () => {}, ptImgPatch: () => {}, ptEmpty: () => {},
    ptOpenDialog: cfg => dialogs.push(cfg), ptDlgMsg: t => dlgMsgs.push(t), ptDownload: () => {}, fgiOutTxt: () => 'orders',
    mobOn: () => !!o.phone, document: { addEventListener: () => {} }, ptDayWords: d => String(d).slice(0, 10),
    window: { matchMedia: () => ({ matches: false, addEventListener: () => {} }) },
    pkvOpenFbaList: async id => opened.push(id), packFbaMayPack: () => true, PACK_NO_RIGHT: 'no right',
    ptPatch: async p => { saves++; if (o.patchFails && o.patchFails.includes(saves)) throw new Error('offline'); S.patches.push(p); },
  });
  S.saved.fbaList = '1';
  S.ctx.console.error = (...a) => S.warns.push(a.join(' '));
  S.run(line('core/helpers.js', 'const dTodayIndia') + line('core/helpers.js', 'const dDiff') + line('core/helpers.js', 'function csvCell')
    + line('core/helpers.js', 'const dAdd') + line('core/helpers.js', 'const dToday')
    + line('inventory/fg-change-remove.js', 'const fgiDmy') + line('inventory/finished-goods.js', 'const fgiMaster').replace('const ', 'var ')
    + line('inventory/finished-goods.js', 'const fgiMatches')
    + whole('core/database-read.js', 'ptDtMs') + whole('vendors/orders/vendor-orders.js', 'ptFillSelect')
    + cut(appFile('production/whatsapp.js'), 'const ptIsoDate', 'function bdEdit')
    + appFile('inventory/fg-fba-repeat.js') + appFile(LISTS) + appFile(LISTS_VIEW)
    + line(DISPATCH, 'const fbaCan') + cut(appFile(DISPATCH), 'const FBA_PILL', 'function fbaState') + appFile(DISPATCH).slice(appFile(DISPATCH).indexOf('function fbaAll'))
    + cut(appFile(SHIP), 'const FBA_STALE_DAYS', '/**' + '\n' + ' * The rows of a shipment file') + appFile(VIEW) + appFile(REDESIGN));
  S.ctx.FGI.set._fbaLists = o.lists || {};
  S.ctx.FGI.set._fbaListsDone = o.done || {};
  S.ctx.fgiStockReread = async () => '';
  S.run('FGI.busy = false');
  const set = (id, value) => { box(id).value = value; };
  set('fbaStatus', o.status === undefined ? 'todo' : o.status); set('fbvView', o.view || 'dispatch'); set('fbaQ', '');
  const draw = () => { S.run('renderFba()'); return box('fbaTable').innerHTML; };
  const hidden = id => box(id).classList.contains('hide');
  const accepts = () => S.run('FGI.rows').filter(r => r.fbaAcceptedAt && !r.fbaShippedAt).length;
  return Object.assign(S, { box, set, draw, hidden, dialogs, dlgMsgs, moved, opened, accepts, saveCount: () => saves });
}
/** Many waiting dispatches. */
const waiting = (n, over) => Array.from({ length: n }, (_, i) => out('m' + i, i % 2 ? 'B' : 'A', 1 + (i % 3), 1, over));
const panelHtml = S => { S.run('fblvRender()'); return S.box('fbaLists').innerHTML; };

(async () => {
  console.log('== switch off: as it was ==');
  {
    const S = screen({ ls: '0', phone: true, lists: { L1: list('open') } });
    const html = S.draw();
    ok('no button moved, no new button shown', S.moved.length === 0 && S.hidden('fbaAcceptAll') && S.hidden('fbrMore') && S.hidden('fbaBreak'));
    ok('the badges are the old ones, and even on a phone it is the table', html.includes('<span class="pill pill-out">returned</span>') === false
      && !/fbr-/.test(html) && html.includes('<th class="frz">Sent</th>') && S.box('fbaTable').className === '');
    ok('no FBA lists panel at all (the lists need the switch too)', panelHtml(S) === '' && S.hidden('fbaLists'));
  }

  console.log('== lists first ==');
  {
    const lists = {
      L1: list('open', { lane: 'air', at: iso(NOW - 1000), lines: { A: { sku: 'A', qty: 4, packed: 0 }, B: { sku: 'B', qty: 6, packed: 0 } } }),
      L2: list('packed', { lane: 'awd', account: 'CPC FBA', lines: { A: { sku: 'A', qty: 5, packed: 5 } } }),
    };
    const done = {
      D1: list('shipped', { shipment: 'FBA9RECENT', shipDate: '27/11/2026', shippedBy: 'sam@test', shippedAt: iso(NOW - 2 * 864e5), lines: { A: { sku: 'A', qty: 4, packed: 4, shipped: 4 } } }),
      D2: list('shipped', { shipment: 'FBA9OLDONE', shippedAt: iso(NOW - 40 * 864e5), lines: { A: { sku: 'A', qty: 1, packed: 1, shipped: 1 } } }),
    };
    const S = screen({ lists, done }), html = panelHtml(S);
    const cards = html.split('<div class="fbr-list">').slice(1);
    ok('the waiting lists are cards, newest first', cards.length === 2 && cards[0].includes('CPC FBA') && cards[1].includes('Ridhi FBA'), String(cards.length));
    ok('lane, account, SKUs, pieces, who and when', cards[1].includes('>Air<') && cards[1].includes('<b>10</b><small>pieces</small>') && cards[1].includes('<b>2</b><small>SKU(s)</small>')
      && cards[1].includes('A ×4, B ×6') && cards[1].includes('Made by team') && cards[0].includes('>AWD<'));
    ok('how much is packed', cards[1].includes('Not packed yet') && cards[0].includes('Packed · 5 of 5'));
    ok('open list: Scan to pack is the main button, then Cancel', /<button type="button" data-fbl="pack"[^>]*>Scan to pack<\/button>/.test(cards[1])
      && !cards[1].includes('data-fbl="ship"') && cards[1].includes('data-fbl="cancel"'));
    ok('packed list: Ship is the main button, Scan to pack stays quiet', /<button type="button" data-fbl="ship"[^>]*>Ship<\/button>/.test(cards[0])
      && /class="ghost" data-fbl="pack"[^>]*>Scan to pack/.test(cards[0]));
    ok('shipped lists are folded, counted for 30 days only', html.includes('Shipped in the past 30 days (1)') && !html.includes('FBA9RECENT') && !html.includes('Undo ship'));
    S.box('fbaLists').addEventListener = () => {};
    S.run('fbrListsClick({ target: { closest: s => (s === "[data-fbr-fold]" ? {} : null) } })');
    const open = S.box('fbaLists').innerHTML;
    ok('opened: shipment, who, Undo ship; the old one stays out', open.includes('FBA9RECENT') && open.includes('Shipped 27/11/2026 by sam') && open.includes('data-fbl="undo"') && !open.includes('FBA9OLDONE'));
    S.run('fbrListsClick({ target: { closest: s => (s === "[data-fbr-fold]" ? {} : null) } })');
    ok('folded again by a second press', !S.box('fbaLists').innerHTML.includes('FBA9RECENT'));
    S.box('fbaLists').onclick({ target: { closest: () => ({ getAttribute: n => (n === 'data-fbl' ? 'pack' : 'L1') }) } });
    await Promise.resolve();
    ok('Scan to pack opens the pack flow of that list', S.opened.join() === 'L1');
    const T = screen({ lists, tabs: ['fgi'] });
    ok('without the FBA tab there are no buttons', !/data-fbl=/.test(panelHtml(T)));
    ok('nothing waiting says so', panelHtml(screen()).includes('No list is waiting'));
  }

  console.log('== status badges ==');
  {
    const S = screen({ status: '' }), html = S.draw();
    const badge = id => { const tr = html.split('<tr>').find(r => r.includes(`data-fba-pick="${id}"`) || r.includes(`data-fba-undo="${id}"`)); return (/<span class="pill ([^"]*)"[^>]*>([^<]*)<\/span>/.exec(tr) || []).slice(1).join('|'); };
    ok('waiting is amber', badge('w') === 'pill-low|waiting', badge('w'));
    ok('accepted is blue', badge('acc3') === 'fbr-acc|accepted', badge('acc3'));
    ok('accepted 29 days ago is not old yet', badge('acc29') === 'fbr-acc|accepted', badge('acc29'));
    ok('accepted 30 days ago is old, and red', badge('acc30') === 'pill-out|old' && badge('old40') === 'pill-out|old', badge('acc30'));
    ok('shipped is green', badge('shp') === 'pill-ok|shipped', badge('shp'));
    const ret = html.split('<tr>').find(r => r.includes('>returned<'));
    ok('returned is grey', ret && ret.includes('pill fbr-grey">returned'));
    ok('old says why', html.includes('title="Accepted 40 days ago and still not shipped"'));
  }

  console.log('== the top: one main button, the rest under More ==');
  {
    const S = screen({ rows: waiting(250) });
    S.draw();
    ok('the secondary buttons moved under More once', S.moved.join() === 'fbaPackBtn,fbaAccept,fbaShip,fbaShipXl,fbaShipFile,fbaReturn,fbaExport');
    S.draw();
    ok('and not again', S.moved.length === 7);
    ok('the main button counts what is waiting', !S.hidden('fbaAcceptAll') && S.box('fbaAcceptAll').textContent === 'Accept all 250 waiting' && !S.hidden('fbrMore') && !S.hidden('fbaBreak'));
    S.run('FBA_PICK.add("m1"); FBA_PICK.add("m2")'); S.draw();
    ok('More says how many are ticked', S.box('fbrMoreLabel').textContent === 'More · 2 ticked' && S.box('fbaShip').textContent === 'Ship 2');
    S.set('fbaStatus', 'shipped'); S.draw();
    ok('nothing waiting in the list: no main button', S.hidden('fbaAcceptAll'));
    const T = screen({ rows: waiting(3), tabs: ['fgi'] }); T.draw();
    ok('a person without the FBA tab has no main button', T.hidden('fbaAcceptAll'));
    const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    ok('on the page, hidden until the switch', ['fbaBreak', 'fbaAcceptAll', 'fbrMore'].every(id => new RegExp(`id="${id}"[^>]*class="[^"]*hide`).test(page))
      && page.includes('id="fbrMoreBody"'));
    ok('the file is joined into the page, after the lists', fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'ORDER'), 'utf8').includes(LISTS_VIEW + '\n' + REDESIGN));
  }

  console.log('== accept all ==');
  {
    const S = screen({ rows: waiting(700).concat([out('acc', 'A', 3, 5, accepted(2)), out('shp', 'A', 1, 5, shipped())]) });
    S.draw();
    ok('every waiting dispatch is counted, more than the 600 drawn', S.box('fbaAcceptAll').textContent === 'Accept all 700 waiting' && S.run('FBA.shown.length') === 701);
    S.set('fbvBrand', 'CPC'); S.set('fbvAccount', ''); S.draw();
    ok('the filters are followed', S.box('fbaAcceptAll').textContent === 'Accept all 350 waiting', S.box('fbaAcceptAll').textContent);
    S.set('fbvBrand', ''); S.set('fbaQ', 'zzz'); S.draw();
    ok('a search that finds nothing leaves no button', S.hidden('fbaAcceptAll'));
    S.set('fbaQ', ''); S.draw();
    S.box('fbaAcceptAll').onclick = null; S.run('fbrAcceptAllAsk()');
    const d = S.dialogs[0], pieces = S.run('FBA.shown').filter(x => x.s.st === 'waiting').reduce((t, x) => t + x.s.open, 0);
    ok('asks first, with the count and the pieces', d && d.subtitle === `700 dispatch(es) · ${pieces} piece(s)` && d.saveLabel === 'Accept 700' && S.patches.length === 0, d && d.subtitle);
    const first = d.onSave(), second = await d.onSave();
    ok('a second press while it runs is refused', /already running/.test(second));
    ok('the main button is off while it runs', S.box('fbaAcceptAll').disabled === true);
    ok('it finishes with an empty answer so the box closes', (await first) === '');
    ok('all 700 accepted, in batches of 100', S.accepts() === 701 && S.patches.length === 7, S.accepts() + ' / ' + S.patches.length);
    ok('progress was shown', S.dlgMsgs.includes('Accepting… 100 of 700 done') && S.dlgMsgs.includes('Accepting… 700 of 700 done'));
    ok('and the screen says what was saved', S.box('fbaMsg').textContent.startsWith('700 dispatch(es) accepted · ') && S.box('fbaMsg').className === 'muted');
    ok('each accept names who and when, once', S.patches.every(p => Object.keys(p).every(k => /\/fbaAccepted(At|By)$/.test(k))) && S.patches.reduce((t, p) => t + Object.keys(p).length, 0) === 1400);
    ok('nothing is waiting any more, the button is gone', S.hidden('fbaAcceptAll'));
  }
  {
    const S = screen({ rows: waiting(250), patchFails: [2] });
    S.draw(); S.run('fbrAcceptAllAsk()');
    const d = S.dialogs[0], said = await d.onSave();
    ok('a failed batch stops, and says how many were saved', said.startsWith('Accepted 100 of 250 dispatch(es) before it stopped: offline.') && /press Accept again/.test(said), said);
    ok('only the first batch was written', S.patches.length === 1 && S.accepts() === 100);
    ok('the screen shows the 150 still waiting', S.box('fbaAcceptAll').textContent === 'Accept all 150 waiting' && S.box('fbaAcceptAll').disabled === false);
    const again = await d.onSave();
    ok('pressing the same box again carries on with the rest only', again === '' && S.accepts() === 250 && S.patches.length === 3, S.patches.length + '');
    ok('the retry counts only the 150 left, and says nothing was skipped', S.dlgMsgs.includes('Accepting… 150 of 150 done') && S.box('fbaMsg').textContent.startsWith('150 dispatch(es) accepted') && !/left alone/.test(S.box('fbaMsg').textContent), S.box('fbaMsg').textContent);
    ok('nobody is accepted twice', new Set(S.patches.flatMap(p => Object.keys(p))).size === 500);
  }
  {
    const rows = waiting(5), S = screen({ rows });
    S.draw();
    const real = S.ctx.ptGet;
    S.ctx.ptGet = async p => (p.endsWith('/m3') ? Object.assign({}, rows[3], shipped()) : real(p));
    S.run('fbrAcceptAllAsk()');
    ok('one somebody else shipped meanwhile is left alone, and said', (await S.dialogs[0].onSave()) === '' && S.accepts() === 4
      && /4 dispatch\(es\) accepted/.test(S.box('fbaMsg').textContent) && /left alone: 1 already shipped/.test(S.box('fbaMsg').textContent), S.box('fbaMsg').textContent);
    const T = screen({ rows: waiting(2), tabs: ['fgi'] });
    ok('only the FBA team may', /Only the FBA team/.test(await T.run('fbrAcceptRun(FGI.rows)')) && T.patches.length === 0);
    const U = screen({ rows: waiting(0) }); U.draw(); U.run('fbrAcceptAllAsk()');
    ok('nothing to accept says so, no box', U.dialogs.length === 0 && /No waiting dispatch/.test(U.box('fbaMsg').textContent));
  }
  {
    const S = screen({ rows: waiting(3) });
    S.draw(); S.run('FBA_PICK.add("m0")');
    await S.run('fbaAccept(["m0"])');
    ok('Accept ticked still works the same way', S.accepts() === 1 && S.patches.length === 1 && S.run('FBA_PICK.size') === 0 && /^1 dispatch\(es\) accepted · 1 piece\(s\)/.test(S.box('fbaMsg').textContent));
  }

  console.log('== phone cards ==');
  {
    const S = screen({ phone: true, status: '' }), html = S.draw();
    ok('cards, not the wide table', S.box('fbaTable').className === 'fbr-cards' && !html.includes('<th class="frz">') && (html.match(/class="fbr-dc"/g) || []).length === 7);
    ok('each card keeps its buttons and its tick', html.includes('data-fba-ok="w"') && html.includes('data-fba-ship="acc3"') && html.includes('data-fba-ret="old40"')
      && html.includes('data-fba-pick="w"') && !html.includes('data-fba-pick="shp"') && html.includes('data-fba-undo="shp"'));
    ok('status, pieces, and what it is', html.includes('pill pill-low">waiting') && html.includes('pill pill-out" title') && html.includes('<small>pieces</small>') && html.includes('Quilt · Blue · King'));
    ok('tick all stays', html.includes('<thead>') && html.includes('data-fba-all'));
    ok('a note above, as on a computer', /^7 dispatch\(es\), newest first/.test(S.box('fbaMsg').textContent));
    const W = screen({ phone: false, status: '' }); W.draw();
    ok('a wide window keeps the table', W.box('fbaTable').className === 'xl' && !/fbr-dc/.test(W.box('fbaTable').innerHTML));
    const V = screen({ phone: true, view: 'article', status: '' }); let v = V.draw();
    ok('by article: a card per article, closed', (v.match(/data-fbv-open=/g) || []).length === 2 && !v.includes('data-fba-ok'));
    V.run('FBV.open.add("A")'); v = V.draw();
    ok('opened, its dispatches follow as cards', v.includes('data-fba-ok="w"') && /<tr class="fbr-sub">/.test(v));
    ok('a phone card for an article keeps the orders figure', v.includes('data-fbv-fig="waiting"'));
  }

  const { pass, fail } = counts();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (!fail && !process.env.FGA_MUT_FILE) teeth();
  process.exit(process.exitCode || (fail ? 1 : 0));
})().catch(e => { console.log('suite stopped: ' + (e.stack || e)); process.exit(1); });

/** Each broken copy of the code must make this suite fail. */
function teeth() {
  const { spawnSync } = require('child_process'), os = require('os');
  const broken = [
    [REDESIGN, "(FBA.shown || []).filter(x => x.s.st === 'waiting')", "(FBA.shown || []).slice(0, 600).filter(x => x.s.st === 'waiting')"],
    [REDESIGN, "(FBA.shown || []).filter(x => x.s.st === 'waiting')", '(FBA.shown || []).filter(fbaActionable)'],
    [REDESIGN, 'const FBR_ACCEPT_BATCH = 100;', 'const FBR_ACCEPT_BATCH = 1000;'],
    [REDESIGN, "if (FBR.accepting) return 'Accepting is already running", "if (false) return 'Accepting is already running"],
    [REDESIGN, "rows.filter(r => fbaState(r).st === 'waiting');", 'rows;'],
    [REDESIGN, 'stopped = fbrStoppedText(total.saved, waiting.length, e);', "stopped = 'failed';"],
    [REDESIGN, 'FBR.accepting = false;\n  renderFba();', 'renderFba();'],
    [REDESIGN, "$('fbaAcceptAll').disabled = FBR.accepting;", ''],
    [REDESIGN, "$('fbaAcceptAll').classList.toggle('hide', !(view.can && waiting.length));", "$('fbaAcceptAll').classList.toggle('hide', !view.can);"],
    [REDESIGN, "FBR_MOVED.forEach(id => $('fbrMoreBody').appendChild($(id))); FBR.under = true;", 'FBR.under = true;'],
    [REDESIGN, 'if (!FBR.under) {', 'if (true) {'],
    [REDESIGN, "FBA_PICK.size ? `More", "false ? `More"],
    [REDESIGN, 'FBR.shippedOpen = !FBR.shippedOpen;', 'FBR.shippedOpen = true;'],
    [REDESIGN, "(ship ? fblvButton('pack', id, 'Scan to pack') : fbrMain('pack', id, 'Scan to pack'))", "fbrMain('pack', id, 'Scan to pack')"],
    [REDESIGN, "(ship ? fbrMain('ship', id, 'Ship') : '')", "(ship ? fblvButton('ship', id, 'Ship') : '')"],
    [REDESIGN, 'const FBR_PHONE_QUERY', 'const FBR_PHONE_QUERY_UNUSED'],
    [REDESIGN, "typeof mobOn === 'function' && mobOn()", 'false'],
    [REDESIGN, "data-fba-pick=\"${esc(id)}\"${FBA_PICK.has(id)", "data-fba-pickx=\"${esc(id)}\"${FBA_PICK.has(id)"],
    [REDESIGN, "(view.can ? `<div class=\"fbr-acts\">${fbaRowActions(r, s, id)}</div>` : '')", "''"],
    [REDESIGN, "open ? card + fbvInside(article).map(x => fbrDispatchCard(x, view, true)).join('') : card", 'card'],
    [REDESIGN, 'Packed · ${nf(packed)} of ${nf(qty)}', 'Packed'],
    [REDESIGN, "if (list.status === 'packed') return", "if (false) return"],
    [DISPATCH, 'const FBA_OLD_DAYS = 30;', 'const FBA_OLD_DAYS = 31;'],
    [DISPATCH, "s.st === 'accepted' && days >= FBA_OLD_DAYS ? 'old' : s.st", 's.st'],
    [DISPATCH, "accepted: ['fbr-acc', 'accepted']", "accepted: ['', 'accepted']"],
    [DISPATCH, "returned: ['fbr-grey', 'returned']", "returned: ['pill-out', 'returned']"],
    [DISPATCH, "const pill = view.on ? fbaStatusPill(r, s)", 'const pill = false ? fbaStatusPill(r, s)'],
    [DISPATCH, "const phone = view.on && typeof fbrNarrow", 'const phone = typeof fbrNarrow'],
    [DISPATCH, "if (view.on) $('fbaTable').className = phone ? 'fbr-cards' : 'xl';", ''],
    [DISPATCH, "if (on && typeof fbrToolbar === 'function') fbrToolbar(view);", ''],
    [DISPATCH, '  ids.forEach(id => FBA_PICK.delete(id));\n  return { done, skipped };', '  return { done, skipped };'],
    [LISTS_VIEW, "typeof fbvOn === 'function' && fbvOn()) return fbrListsPanel(waiting);", "typeof fbvOn === 'function' && false) return fbrListsPanel(waiting);"],
  ];
  const tmp = path.join(os.tmpdir(), `fbr-broken-${process.pid}.js`);
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
