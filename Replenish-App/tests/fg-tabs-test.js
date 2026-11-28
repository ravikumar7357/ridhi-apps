/* FINISHED GOODS, THE NEW PAGE (28 Nov, switch fgTabs): tabs by job, the Stock tab's tiles, list and article panel.
 *   node tests/fg-tabs-test.js
 *   FGA_MUT_FILE=<path under src/app> FGA_MUT_SRC=<file> runs it against a broken copy (the part at the end does this). */
const { fs, path, appFile, same, cut, line, whole, NOW, iso, row, sent, ordLine, store, counts, check: ok } = require('./india-store-harness');

const FG = 'inventory/finished-goods.js', TABS = 'inventory/fg-tabs.js';
const escape = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const VIEW_NAMES = { pending: 'Waiting to be counted in', flow: 'From QC', alerts: 'Needs listing', corr: 'Correction requests', fbarep: 'Repeat FBA', over: 'Over order' };

/** A box of the page that remembers its classes. */
function element() {
  const classes = new Set();
  return { value: '', textContent: '', innerHTML: '', className: '', checked: false, dataset: {}, parentNode: null, classes,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
      toggle: (c, on) => { const want = on === undefined ? !classes.has(c) : !!on; if (want) classes.add(c); else classes.delete(c); } },
    querySelector: () => null, querySelectorAll: () => [] };
}
/** The India store of the harness (20 of A) with the Finished Goods screen over it, the new page on unless said.
 *  o: tabs ('1' | '0' | null), testSite, phone, edit, entry, admin, flow, lists, and the harness's own. */
function screen(o = {}) {
  const S = store(o);
  const boxes = {}, drawn = [], opened = [];
  const $ = id => boxes[id] || (boxes[id] = element());
  const words = element(); words.childNodes = [{}, { textContent: ' Filters ' }];
  const filters = element(); filters.querySelector = () => words;
  $('paneFgi').querySelector = sel => (sel === '.ftwrap' ? filters : null);
  $('fgView').value = 'stock';
  $('fgView').querySelector = sel => ({ textContent: VIEW_NAMES[/value="(\w+)"/.exec(sel)[1]] });
  const pages = ['0', '1'].map(p => Object.assign(element(), { getAttribute: () => p, setAttribute(k, v) { this[k] = v; } }));
  $('fgtSwitch').querySelectorAll = () => pages;
  Object.assign(S.ctx, { $, esc: escape, fgiMaster: undefined, spIsVendor: () => false,
    mdbOf: sku => (o.master || { A: { brand: 'Ridhi', subtype: 'Queen Quilt', color: 'Blue', size: '90x96' } })[sku],
    fgiCanEdit: () => o.edit !== false, fgiCanEntry: () => o.entry !== false, fbaCan: () => true,
    fgiStatus: () => ({ txt: 'ok' }), LST_PILL: { unknown: ['', ''] }, lstOf: () => ({ st: 'unknown' }), ptFillSelect: () => {}, FGI_PICK: { stock: new Set(), ledger: new Set() },
    ptImgCell: () => '<td></td>', ptImgInner: () => '', ptImgFill: () => {}, ptImgPatch: null, mobOn: () => !!o.phone, FLOW_ON: !!o.flow,
    fgiEntryOpen: (...a) => opened.push(['entry', ...a]), fgiSkuEditOpen: sku => opened.push(['edit', sku]), fgiSkuDeleteAsk: skus => opened.push(['delete', ...skus]),
    fgiReleaseOpen: sku => opened.push(['release', sku]), fgaCustomOpen: sku => opened.push(['custom', sku]), renderFgi: () => drawn.push($('fgView').value) });
  S.ctx.ME.fgAccOnly = !!o.accOnly;
  if (o.tabs !== null) S.saved.fgTabs = o.tabs === undefined ? '1' : o.tabs;
  S.saved.fbaList = o.lists ? '1' : '0';
  S.run(line('core/helpers.js', 'const ptDayWords') + line('core/helpers.js', 'const dTodayIndia') + line('core/helpers.js', 'const dAdd')
    + line('inventory/fg-change-remove.js', 'const fgiDmy') + 'const fgiMaster = sku => mdbOf(sku) || {};' + appFile('inventory/fba-lists.js')
    + 'const FBLV_LANE_NAMES = { air: "Air", sea: "Sea", awd: "AWD" };'
    + cut(appFile(FG), 'const FGI_NUM_COLS', 'function fgiRenderStock(') + whole(FG, 'fgiRenderStock') + whole(FG, 'fgiCard')
    + 'let FGI_KPI = "", FGI_KPI_ON = "";' + cut(appFile(FG), '/** What a movement is called', 'function fgiRenderLedger')
    + whole(FG, 'fgiTableClick') + appFile(TABS));
  const stock = () => S.ctx.fgiStock();
  const records = () => new Map([...stock()].map(([sku, b]) => [sku, Object.assign({ sku, pending: 0 }, b)]));
  const sync = () => { S.ctx.records = records(); S.run('fgtSync(records)'); };
  const off = id => (id === 'fgFilters' ? filters : $(id)).classes.has('fgt-off');
  const press = attrs => ({ target: { closest: sel => { const name = sel.slice(1, -1); return name in attrs ? { getAttribute: k => attrs[k] } : null; } } });
  return Object.assign(S, { $, box: $, drawn, opened, filters, words, pages, records, sync, off, press });
}
const html = (S, id) => S.$(id).innerHTML;
const badge = (S, id, text) => { S.$(id).textContent = text; S.$(id).classList.toggle('hide', !text); };
/** The tab on screen after the view is set and the page synced. */
const onTab = (S, view) => { if (view) S.$('fgView').value = view; S.sync(); return S.run('FGTAB.tab'); };
const attrsIn = text => [...new Set(text.match(/data-fg[a-z]+/g) || [])].sort();

const OLD_CONTROLS = ['fgBrand', 'fgFilters', 'fgaView', 'fgQ', 'fgD1', 'fgD2', 'fgEditPicked', 'fgDelPicked', 'fgScan', 'fgPack', 'fgFbaList',
  'fgEntry', 'fgOpening', 'fgExport', 'fgRefresh', 'fgLstRefresh', 'fgKpis'];

console.log('== the switch ==');
{
  const on = o => screen(o).run('fgtOn()');
  ok('live: off by default', on({ tabs: null }) === false);
  ok('test website: on by itself', on({ tabs: null, testSite: true }) === true);
  ok("'0' wins on the test website", on({ tabs: '0', testSite: true }) === false);
  ok("'1' turns it on for one live computer", on({ tabs: '1' }) === true);
  ok('needs stock sharing (storeAlloc)', on({ tabs: '1', ls: '0', testSite: true }) === false);
  const B = screen({ testSite: true }); B.ctx.fgaOn = () => true; B.ctx.localStorage = { getItem: () => { throw new Error('blocked'); } };
  ok('storage blocked: the default, and the console says why', B.run('fgtOn()') === true && B.warns.some(w => /blocks saved settings/.test(w)));
  ok('an account that only accepts from QC keeps the old page', screen({ accOnly: true }).run('fgtShown()') === false);
}
console.log('== switch off ==');
{
  const S = screen({ tabs: '0' });
  S.sync();
  ok('no control is hidden', OLD_CONTROLS.concat('fgView', 'fgAlerts', 'fgPendBadge').every(id => !S.off(id)));
  ok('no tabs, tiles or panel', ['fgtBar', 'fgtViews', 'fgtTiles', 'fgtPanel'].every(id => S.$(id).classes.has('hide') && !html(S, id)));
  ok('live shows no page choice', S.$('fgtSwitch').classes.has('hide') && !S.$('paneFgi').classes.has('fgt-on'));
  ok('the Filters button keeps its name', S.words.childNodes[1].textContent === ' Filters ');
  ok('the stock entry opens on Receive', S.run('fgtEntryType()') === 'RECEIVE');
  S.run('fgiRenderStock(fgiStock())');
  ok('the old list, with its ticks and row buttons', ['data-fgpick', 'data-fgentry', 'data-fgskued', 'data-fgskudel', 'data-fgmoves'].every(a => html(S, 'fgTable').includes(a))
    && !html(S, 'fgTable').includes('data-fgtopen') && /<th>Brand<\/th>|>Brand<\/th>/.test(html(S, 'fgTable')));
}
console.log('== the page choice on the test website ==');
{
  const S = screen({ tabs: '0', testSite: true });
  S.sync();
  ok('offered while the old page shows, Old marked', !S.$('fgtSwitch').classes.has('hide') && S.pages[0].classes.has('on') && !S.pages[1].classes.has('on'));
  S.$('fgtSwitch').onclick(S.press({ 'data-fgtpage': '1' }));
  ok('New page is kept on this computer and drawn', S.saved.fgTabs === '1' && S.drawn.length === 1);
  S.run('FGI_KPI = "out"'); S.$('fgtSwitch').onclick(S.press({ 'data-fgtpage': '0' }));
  ok('back to the old page, with no movement filter left behind', S.saved.fgTabs === '0' && S.run('FGI_KPI') === '');
  const A = screen({ testSite: true, ls: '0' }); A.sync();
  ok('not offered without stock sharing', A.$('fgtSwitch').classes.has('hide'));
}
console.log('== tabs ==');
{
  const S = screen();
  ok('six tabs, Stock first', onTab(S) === 'stock' && same((html(S, 'fgtBar').match(/data-fgttab="\w+"/g) || []).map(m => m.slice(13, -1)),
    ['stock', 'receive', 'issue', 'send', 'todo', 'history']));
  ok('Every movement from Stock is History', onTab(S, 'ledger') === 'history');
  ok('a waiting list is Receive', onTab(S, 'pending') === 'receive');
  ok('a review is To do', onTab(S, 'corr') === 'todo');
  ok('the store list is Stock', onTab(S, 'stock') === 'stock');
  S.run('fgtOpenTab("send")');
  ok('Send to FBA keeps the store list as its own', onTab(S) === 'send' && S.$('fgView').value === 'stock');
  ok('movements from there are History', onTab(S, 'ledger') === 'history');
  S.run('fgtOpenTab("issue")');
  ok('Issue shows what went out', S.run('FGI_KPI') === 'out' && S.$('fgView').value === 'ledger' && onTab(S) === 'issue');
  S.run('FGI_KPI = ""');
  ok('a jump to all movements leaves Issue for History', onTab(S) === 'history');
  S.run('fgtOpenTab("history")');
  ok('History shows everything', S.run('FGI_KPI') === '');
  const views = [...fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8').split('id="fgView"')[1].split('</select>')[0].matchAll(/value="(\w+)"/g)].map(m => m[1]).concat('flow');
  const held = S.run('FGT_TABS.flatMap(t => t.views)');
  ok('every old view has a tab', views.length > 6 && views.every(v => held.includes(v)), views.join());
}
console.log('== what each tab keeps ==');
{
  const kept = (key, o) => { const S = screen(o); S.run(`fgtOpenTab("${key}")`); S.sync(); return OLD_CONTROLS.filter(id => !S.off(id)).sort(); };
  const is = (key, ids, o) => ok(key + (o ? ' (lists on)' : '') + ': ' + ids, same(kept(key, o), ids.split(' ').sort()), kept(key, o).join(' '));
  is('stock', 'fgBrand fgFilters fgaView fgQ fgExport fgRefresh');
  is('receive', 'fgQ fgEntry fgScan fgOpening fgExport fgRefresh');
  is('issue', 'fgFilters fgQ fgD1 fgD2 fgEditPicked fgDelPicked fgScan fgPack fgEntry fgExport fgRefresh');
  is('send', 'fgBrand fgFilters fgaView fgQ fgFbaList fgEditPicked fgDelPicked fgScan fgPack fgEntry fgExport fgRefresh');
  is('send', 'fgBrand fgFilters fgaView fgQ fgFbaList fgEditPicked fgDelPicked fgScan fgPack fgExport fgRefresh', { lists: true });
  is('todo', 'fgQ fgLstRefresh fgExport fgRefresh');
  is('history', 'fgFilters fgQ fgD1 fgD2 fgKpis fgEditPicked fgDelPicked fgExport fgRefresh');
  const all = new Set(['stock', 'receive', 'issue', 'send', 'todo', 'history'].flatMap(k => kept(k)));
  ok('no old control is lost', OLD_CONTROLS.every(id => all.has(id)), OLD_CONTROLS.filter(id => !all.has(id)).join());
  const S = screen(); S.sync();
  ok('the old view picker, badges and count are put away', ['fgView', 'fgAlerts', 'fgPendBadge'].every(id => S.off(id)));
  ok('the Filters button says More filters', S.words.childNodes[1].textContent === ' More filters ');
  const type = key => { const T = screen(); T.run(`fgtOpenTab("${key}")`); T.$('x'); return T.run('fgtEntryType()'); };
  ok('the entry opens on the tab\'s kind', same(['stock', 'receive', 'issue', 'send'].map(type), ['RECEIVE', 'RECEIVE', 'ISSUE', 'FBA']));
}
console.log('== counts and the list choice ==');
{
  const S = screen({ flow: true });
  badge(S, 'fgPendBadge', '2'); badge(S, 'flFgBadge', '1,200'); badge(S, 'fgiCorrBadge', '1'); badge(S, 'fgiOverBadge', '3');
  S.$('fgiLstBadge').textContent = '9'; S.$('fgiLstBadge').classList.add('hide');
  S.sync();
  const tabText = key => html(S, 'fgtBar').split(`data-fgttab="${key}">`)[1].split('</button>')[0];
  ok('Receive adds its two lists', tabText('receive') === 'Receive <b class="fgt-count">1202</b>', tabText('receive'));
  ok('To do adds the shown badges only', tabText('todo') === 'To do <b class="fgt-count">4</b>', tabText('todo'));
  ok('no count on the other tabs, no choice on Stock', tabText('stock') === 'Stock' && S.$('fgtViews').classes.has('hide'));
  badge(S, 'flFgBadge', '…'); S.sync();
  ok('"…" while one is still counted', /…/.test(tabText('receive')));
  S.run('fgtOpenTab("todo")'); S.sync();
  ok('To do opens on its first list with work', S.$('fgView').value === 'corr');
  ok('its lists are offered, repeat requests only with their switch', same((html(S, 'fgtViews').match(/data-fgtview="\w+"/g) || []).map(m => m.slice(14, -1)), ['alerts', 'corr', 'over'])
    && /Over order <b class="fgt-count">3/.test(html(S, 'fgtViews')));
  S.$('fgtViews').onclick(S.press({ 'data-fgtview': 'over' }));
  ok('a list is opened from the choice', S.drawn[S.drawn.length - 1] === 'over');
  const N = screen(); N.run('fgtOpenTab("receive")');
  ok('without the production flow Receive opens on the transfers', N.$('fgView').value === 'pending');
}
console.log('== Stock: tiles ==');
{
  const tiles = o => { const S = screen(o); S.sync(); return [...html(S, 'fgtTiles').matchAll(/<div class="v">([^<]*)<\/div><div class="l">([^<]*)/g)].map(m => m[2] + ' ' + m[1]); };
  ok('the store in four figures', same(tiles(), ['Pieces in store 20', 'Articles in stock 1', 'FBA packed 0', 'Free (excess) 5']), tiles().join());
  const rows = [row('O', 'OPENING', 20), sent('F', 3), row('B', 'OPENING', 2, { sku: 'B' }), sent('G', 2, { sku: 'B' })];
  const got = tiles({ rows });
  ok('a SKU with only packed pieces adds to packed, not to articles', got[0] === 'Pieces in store 17' && got[1] === 'Articles in stock 1' && got[2] === 'FBA packed 5', got.join());
  const S = screen(); S.run('fgtOpenTab("history")'); S.sync();
  ok('tiles on Stock only', S.$('fgtTiles').classes.has('hide') && !html(S, 'fgtTiles'));
  const B = screen(); B.run('fgtSync()');
  ok('no tiles while the ledger is unread', B.$('fgtTiles').classes.has('hide'));
}
console.log('== Stock: the list ==');
{
  const list = o => { const S = screen(o); S.sync(); S.ctx.records = S.records(); S.run('fgiRenderStock(records)'); return html(S, 'fgTable'); };
  const t = list();
  const heads = [...t.split('</thead>')[0].matchAll(/<th(?: [^>]*)?>(.*?)<\/th>/g)].map(m => m[1]);
  ok('one Article column, the same figures, no tick or action column', same(heads, ['SKU', 'Image', 'Article', 'FBA Packed', 'In Stock', 'Photoshoot', 'Custom', 'FBA Air', 'FBA Sea', 'FBA AWD', 'Excess']), heads.join());
  const figs = [...t.matchAll(/<td class="num"[^>]*>(.*?)<\/td>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
  ok('the figures of the old list', same(figs, ['—', '20', '—', '6', '3', '4', '2', '5']), figs.join());
  ok('name over brand, colour and size', /Queen Quilt<span class="muted">Ridhi · Blue · 90x96<\/span>/.test(t));
  ok('no buttons on the row but the article and the orders', same(attrsIn(t), ['data-fgacustom', 'data-fgtopen']), attrsIn(t).join());
  const sales = [{ _id: 'AMZ-1', orderTypeKey: 'newdev', lines: [{ sku: 'A', qty: 2 }] }];
  ok('the New development box stays', /data-fgand="A"/.test(list({ sales, lines: [{ orderNo: 'AMZ-1', sku: 'A', qty: 2, orderDate: '2026-11-01' }] })));
  const bad = list({ master: { A: { subtype: '<img src=x>', color: '<b>' } } });
  ok('master text is escaped', !/<img src=x>|<b>/.test(bad) && /&lt;img/.test(bad));
  const card = list({ phone: true });
  ok('phone: a card that opens the article, with no tick or buttons', same(attrsIn(card), ['data-fgacustom', 'data-fgtopen']) && /fg-mc-sku" data-fgtopen="A"/.test(card) && !/fg-mc-acts/.test(card), attrsIn(card).join());
}
console.log('== Stock: the article panel ==');
{
  const moves = Array.from({ length: 12 }, (_, i) => row('M' + i, 'ISSUE', 1, { createdAt: iso(NOW - (20 - i) * 60000), orderNo: 'N' + i }));
  const open = o => { const S = screen(o); S.sync(); S.$('fgTable'); S.run('fgtOpenArticle("A")'); S.sync(); return { S, p: html(S, 'fgtPanel') }; };
  const full = open({ rows: [row('O', 'OPENING', 40), ...moves] });
  ok('opens for the article pressed', !full.S.$('fgtPanel').classes.has('hide') && full.S.drawn.length === 1);
  const order = (full.p.match(/>N\d+</g) || []).map(s => s.slice(1, -1));
  ok('the last 10 movements, newest first', order.length === 10 && order[0] === 'N11' && order[9] === 'N2', order.join());
  ok('pieces out carry a minus', /<td class="num">−1<\/td>/.test(full.p));
  ok('the orders stock is counted against', /<b>B2B-1<\/b>[\s\S]*?4 from stock of 4 pending/.test(full.p));
  ok('an editor with entry rights', same(attrsIn(full.p).filter(a => !/fgand|fgacustom/.test(a)),
    ['data-fgentry', 'data-fgmoves', 'data-fgrel', 'data-fgskudel', 'data-fgskued', 'data-fgtadd', 'data-fgtclose']), attrsIn(full.p).join());
  const none = open({ edit: false, entry: false, admin: false }).p;
  ok('without rights: no entry, edit, delete or release', !/data-fg(entry|tadd|skued|skudel|rel)\b/.test(none) && /data-fgmoves/.test(none), attrsIn(none).join());
  const entry = open({ edit: false, admin: false }).p;
  ok('entry rights only: add and issue', /data-fgtadd/.test(entry) && /data-fgentry/.test(entry) && !/data-fg(skued|skudel|rel)\b/.test(entry));
  ok('release is an admin\'s', !/data-fgrel/.test(open({ admin: false }).p));
  const T = open({}); T.S.ctx.FGI.set.A = { remark: 'Listed', reorder: 10 }; T.S.sync();
  ok('tag and re-order level', /Listed · re-order level 10/.test(html(T.S, 'fgtPanel')));
  const X = open({ rows: [row('O', 'RECEIVE', 9, { orderNo: '<i>x</i>' })], lines: [ordLine('<u>1</u>', 2)] });
  ok('order numbers are escaped', !/<i>x|<u>1/i.test(X.p) && /&lt;i&gt;x/.test(X.p));
  const sales = [{ _id: 'AMZ-1', orderTypeKey: 'newdev', lines: [{ sku: 'A', qty: 2 }] }];
  ok('New development orders waiting', /AMZ-1<\/b> <span class="pill pill-low">New dev<\/span>[\s\S]*?2 pending for Air/.test(open({ sales, lines: [{ orderNo: 'AMZ-1', sku: 'A', qty: 2, orderDate: '2026-11-01' }] }).p));
  const S = full.S;
  S.$('fgtPanel').onclick(S.press({ 'data-fgtadd': 'A' }));
  S.$('fgtPanel').onclick(S.press({ 'data-fgentry': 'A' }));
  S.$('fgtPanel').onclick(S.press({ 'data-fgskued': 'A' }));
  S.$('fgtPanel').onclick(S.press({ 'data-fgskudel': 'A' }));
  S.$('fgtPanel').onclick(S.press({ 'data-fgrel': 'A' }));
  ok('its buttons open the screen\'s own forms', same(S.opened, [['entry', 'RECEIVE', 'A'], ['entry', 'ISSUE', 'A'], ['edit', 'A'], ['delete', 'A'], ['release', 'A']]), JSON.stringify(S.opened));
  S.$('fgtPanel').onclick(S.press({ 'data-fgmoves': 'A' }));
  ok('Every movement goes to History', S.$('fgView').value === 'ledger' && S.$('fgQ').value === 'A' && onTab(S) === 'history' && S.$('fgtPanel').classes.has('hide'));
  const C = open({}); C.S.$('fgtPanel').onclick(C.S.press({ 'data-fgtclose': '' })); C.S.sync();
  ok('close', C.S.$('fgtPanel').classes.has('hide') && !html(C.S, 'fgtPanel'));
  const G = open({}); G.S.ctx.FGI.rows = []; G.S.sync();
  ok('a SKU with no movement left closes it', G.S.$('fgtPanel').classes.has('hide'));
  const O = open({}); O.S.run('fgtOpenTab("receive")'); O.S.run('fgtOpenTab("stock")'); O.S.sync();
  ok('changing tab closes it', O.S.$('fgtPanel').classes.has('hide'));
}
console.log('== wiring ==');
{
  const has = (f, text) => appFile(f).includes(text);
  ok('the screen syncs the new page on every redraw', has(FG, "if ((FGI.busy || FGI.err) && typeof fgtSync === 'function') fgtSync();") && has(FG, "if (typeof fgtSync === 'function') fgtSync(stock);"));
  ok('the entry button follows the tab', has(FG, "fgiEntryOpen(typeof fgtEntryType === 'function' ? fgtEntryType() : 'RECEIVE', '')"));
  ok('the phone\'s Every movement clears the Issue filter', has('core/mobile.js', "$('fgQ').value = v; FGI_KPI = ''; renderFgi();"));
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  ok('the new boxes are on the page, hidden', ['fgtSwitch', 'fgtBar', 'fgtViews', 'fgtTiles', 'fgtPanel'].every(id => new RegExp(`id="${id}" class="[^"]*\\bhide"`).test(page)));
}

const { pass, fail } = counts();
console.log(`\n${pass} passed, ${fail} failed`);
if (!fail && !process.env.FGA_MUT_FILE) teeth();
process.exit(process.exitCode || (fail ? 1 : 0));

/** Each broken copy of the new page must make this suite fail. */
function teeth() {
  const { spawnSync } = require('child_process'), os = require('os');
  const broken = [
    [TABS, 'if (!fgaOn()) return false;', ''],
    [TABS, "if (v === '0') return false;", ''],
    [TABS, "return typeof window !== 'undefined' && !!window.__TEST_ERP;\n}", 'return true;\n}'],
    [TABS, 'const fgtShown = () => fgtOn() && !ME.fgAccOnly;', 'const fgtShown = () => fgtOn();'],
    [TABS, "el.classList.toggle('fgt-off', on && !fgtKeeps(tab, id));", "el.classList.toggle('fgt-off', !fgtKeeps(tab, id));"],
    [TABS, "if (id === 'fgEntry' && tab.key === 'send' && fblOn()) return false;", ''],
    [TABS, "if (holds(now) && (!now.kpi || now.kpi === FGI_KPI)) return now;", 'if (holds(now)) return now;'],
    [TABS, 'return FGT_TABS.find(t => !t.kpi && holds(t)) || FGT_TABS[0];', 'return FGT_TABS.find(holds) || FGT_TABS[0];'],
    [TABS, "'fgScan', 'fgOpening', 'fgExport'", "'fgScan', 'fgExport'"],
    [TABS, "const offered = typeof window !== 'undefined' && !!window.__TEST_ERP && ", 'const offered = '],
    [TABS, "  FGI_KPI = '';\n  renderFgi();\n}", '  renderFgi();\n}'],
    [TABS, "el && !el.classList.contains('hide') ? String", 'el ? String'],
    [TABS, "if (texts.includes('…')) return '…';", ''],
    [TABS, "t.replace(/,/g, '')", 't'],
    [TABS, "(v !== 'fbarep' || (typeof fapOn === 'function' && fapOn()))", 'true'],
    [TABS, 'views.find(v => fgtBadgeText(FGT_BADGES[v])) || views[0]', 'views[0]'],
    [TABS, 'rows.filter(r => r.current > 0).length', 'rows.length'],
    [TABS, "const records = on && stock && FGTAB.tab === 'stock' ?", 'const records = on && stock ?'],
    [TABS, '+ fgaCells(r) +', "+ fgaCells(r) + '<td><button data-fgentry></button></td>' +"],
    [TABS, 'esc([r.brand, r.color, r.size].filter(Boolean)', '([r.brand, r.color, r.size].filter(Boolean)'],
    [TABS, "{ attr: 'data-fgtopen', title: 'Open this article' }", "{ attr: 'data-fgmoves', title: 'Open this article' }"],
    [TABS, '.slice(0, FGT_MOVES);', ';'],
    [TABS, ".sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))", ''],
    [TABS, '<b>${esc(no)}</b>', '<b>${no}</b>'],
    [TABS, "return (fgiCanEntry() ? ", 'return (true ? '],
    [TABS, "+ (fgiCanEdit() ? button('data-fgskudel'", "+ (true ? button('data-fgskudel'"],
    [TABS, '(fgiCanEdit() ? `<button type="button" class="ghost" data-fgskued', '(true ? `<button type="button" class="ghost" data-fgskued'],
    [TABS, 'holds && fgiMayRelease(row.sku, row.alloc)', 'holds'],
    [TABS, "return fgiEntryOpen('RECEIVE', add", "return fgiEntryOpen('ISSUE', add"],
    [TABS, "{ tab: key, open: '' }", '{ tab: key }'],
    [TABS, "word.textContent = on ? ' More filters ' : ' Filters ';", "word.textContent = ' More filters ';"],
    [FG, "if (typeof fgtStockTab === 'function' && fgtStockTab()) fgtDrawList(rows, sought);\n  else ", ''],
  ];
  const tmp = path.join(os.tmpdir(), `fgt-broken-${process.pid}.js`);
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
