/* WHAT'S NEW, MY WORK AND SEARCH IN MEERA'S CIRCLE; SEARCH FINDS EVERY PART (Ravi, 14 Nov: "put these notification and
 * search feature inside meera's circle", "it does not know all the features and buttons of the site … even if I am
 * searching for fabric leader in the greige desk it is able to find it with recent search of last 3").
 *   node tests/meera-circle-search-test.js
 * The real functions are cut out of src/app/core/friendly.js and run against stubs. What must hold: the top bar has no
 * bell / My work / Search buttons any more; Meera's menu starts with What's new, My work today and Search; her circle
 * carries the count of new items only (99+ at most, hidden at 0); a misspelt word still finds a screen or a part
 * ("fabric leader" → Fabric ledger, "packing lst" → Packing List); parts only on screens the person can open; long box
 * hints are not parts; the last three picks come first, newest on top, no repeats, kept per person; a part that is not
 * showing says so instead of doing nothing. */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const SRC = rd(path.join(__dirname, '..', 'src', 'app', 'core', 'friendly.js'));
const CSS = rd(path.join(__dirname, '..', 'src', 'styles.css'));
/** A whole top-level function or const, by counting its braces. */
function cut(head) {
  const i = SRC.indexOf(head); if (i < 0) throw new Error(head + ' not found');
  let d = 0, j = SRC.indexOf('{', i), seen = false;
  if (head.startsWith('const ') && SRC.indexOf('\n', i) < (j < 0 ? Infinity : j)) return SRC.slice(i, SRC.indexOf('\n', i)) + '\n';
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') { d++; seen = true; } else if (SRC[j] === '}') { d--; if (seen && !d) break; }
  }
  const end = SRC.indexOf('\n', j); return SRC.slice(i, end < 0 ? SRC.length : end) + '\n';
}
const PARTS = ['const FR_KIND =', 'const frWordsOf =', 'function frLev(', 'function frWordHit(', 'function frScore(', 'function frPartsLoad(',
  'function frPartHits(', 'function frGoPart(', 'const frRecentKey =', 'function frRecent(', 'function frRecentAdd(', 'function frItems(',
  'const FR_MNUM =', 'function frMenuItems(', 'function frMeeraBadge('].map(cut).join('\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

function load(o = {}) {
  const store = o.store || {}, toasts = [], shown = [];
  const ctx = {
    FR: o.FR || {}, ME: { email: o.email || 'a@x' }, TAB_NOW: 'repl',
    $: id => (id === 'frPal' ? { classList: { contains: () => true } } : null),
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(o.bank || []) }),
    frPalDraw: () => {}, frHomeShow: () => {}, guideStart: undefined, frSearchBox: () => null,
    frScreens: () => o.screens || [], showTab: t => shown.push(t), frPartEl: o.partEl || (() => null),
    setTimeout: f => f(), frToast: m => toasts.push(m),
    frNew: c => c, frCards: () => o.fresh || [], frAlertCan: () => false, frAlertOn: () => false,
    frGd: id => (id === 'gdLaunch' ? o.launch : null), document: { createElement: () => ({ dataset: {}, style: {} }) },
  };
  const names = Object.keys(ctx);
  const f = new Function(...names, PARTS + '\nreturn { frWordHit, frScore, frPartsLoad, frPartHits, frGoPart, frRecent, frRecentAdd, frItems, frMenuItems, frMeeraBadge };');
  return Object.assign(f(...names.map(k => ctx[k])), { ctx, store, toasts, shown });
}
const SCREENS = [{ tab: 'pack', name: 'Packing List', grp: 'Replenishment & planning' }, { tab: 'fabinv', name: 'Fabric Inventory', grp: 'Store' },
  { tab: 'repl', name: 'Replenishment', grp: 'Replenishment & planning' }];
const BANK = [
  { id: 'a', tab: 'fabinv', p: ['Fabric ledger', 'tab'] },
  { id: 'b', tab: 'pack', p: ['Save packing list', 'button', '', '', '', '#pkSave'] },
  { id: 'c', tab: 'repl', p: ['Export', 'button'] },
  { id: 'd', tab: 'secret', p: ['Fabric ledger', 'tab'] },                       // a screen this person cannot open
  { id: 'e', tab: 'fabinv', p: ["Mill's lot no, or leave blank on a delivery today", 'box'] },
  { id: 'f', tab: 'fabinv', p: ['Fabric ledger', 'tab'] },                       // same name twice on one screen
];
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  /* ---- the top bar is clear; the three live in Meera's circle ---- */
  ok('top bar: no bell, My work or Search buttons built', !/frCtl|frWorkBtn|frFindBtn|\$\('frBell'\)/.test(SRC));
  ok('…and their looks are gone from the styles', !/#frCtl|#frWorkBtn|#frFindBtn|#frBell/.test(CSS));
  ok('a pick in Search or Meera\'s menu stops My work today jumping in on top after sign-in (the top bar did this before)',
    /function frPalGo\(i\) \{[^\n]*FR\.touched = true/.test(SRC) && /menu\.classList\.add\('hide'\); FR\.touched = true;/.test(SRC) && /if \(!FR\.touched\) frHomeShow\(\);/.test(SRC));
  ok('Meera\'s menu is filled each time it opens', /frMeeraMenu\(\);/.test(SRC) && /new MutationObserver\(put\)\.observe\(menu/.test(SRC));
  const M = load({ fresh: [1, 2, 3], FR: { total: 1500 } }), menu = M.frMenuItems();
  const order = [...menu.matchAll(/data-frm="(\w+)"/g)].map(m => m[1]).join(',');
  ok('menu: What\'s new, My work today, Search — in that order', order === 'new,work,find', order);
  ok('…What\'s new shows the new count (3), My work its total (999+)', /What’s new.*>3<\/i>/.test(menu) && />999\+<\/i>/.test(menu));
  ok('…Search shows Ctrl K', /Ctrl K/.test(menu));
  const launch = { children: [], querySelector() { return this.children[0] || null; }, appendChild(c) { this.children.push(c); } };
  const B = load({ launch }); B.frMeeraBadge(250);
  ok('her circle: new count capped at 99+', launch.children[0].textContent === '99+');
  B.frMeeraBadge(0); ok('…hidden when nothing is new', launch.children[0].style.display === 'none' && launch.children.length === 1);

  /* ---- spelling a little wrong still finds it ---- */
  ok('"leader" fits "ledger" (two letters off a long word)', M.frWordHit('leader', ['fabric', 'ledger']) === 1);
  ok('"lst" fits "list" (a letter off)', M.frWordHit('lst', ['list']) === 1);
  ok('…but two letters are too short to guess at ("ls" is not "list" misspelt)', M.frWordHit('ls', ['lis']) === 0 && M.frWordHit('xy', ['xz']) === 0);
  ok('"pack" fits the start of "packing"', M.frWordHit('pack', ['packing', 'list']) === 2);
  ok('a word that fits nowhere fails the whole search', M.frScore(['fabric', 'zzzz'], ['fabric', 'ledger'], []).s === 0);

  /* ---- parts from Meera's list ---- */
  const S = load({ bank: BANK, screens: SCREENS }); S.frPartsLoad(); await tick(); await tick();
  ok('long box hints are not parts', !S.ctx.FR.parts.some(p => p.id === 'e'), S.ctx.FR.parts.map(p => p.id).join());
  const hits = S.frPartHits(['fabric', 'leader'], SCREENS);
  ok('"fabric leader" finds Fabric ledger on Fabric Inventory', hits.length === 1 && hits[0].label === 'Fabric ledger' && hits[0].screen === 'Fabric Inventory', JSON.stringify(hits.map(h => h.id)));
  ok('…not on a screen this person cannot open, and only once', !hits.some(h => h.tab === 'secret'));
  ok('a part needs a typed word in its own name ("packing" alone is not Export)', !S.frPartHits(['packing'], SCREENS).some(h => h.id === 'c'));
  const items = S.frItems('packing lst');
  ok('"packing lst": the Packing List screen first', items[0] && items[0].label === 'Packing List' && items[0].sec === 'Screens', items[0] && items[0].label);
  ok('…and its Save packing list button under Buttons and parts', items.some(i => i.sec === 'Buttons and parts' && i.label === 'Save packing list' && /Button · Packing List/.test(i.sm)));

  /* ---- the last three picks ---- */
  const R = load({ screens: SCREENS });
  ['Dashboard', 'Packing List', 'Replenishment', 'Fabric Inventory', 'Replenishment'].forEach(n => R.frRecentAdd({ label: n, sm: '', rec: { t: 'screen', tab: n } }));
  const rec = R.frRecent().map(r => r.label).join(',');
  ok('last three, newest first, a repeat moves to the top', rec === 'Replenishment,Fabric Inventory,Packing List', rec);
  const empty = R.frItems('');
  ok('…shown first when the box is empty', empty.slice(0, 3).every(i => i.sec === 'Recent') && empty[3].sec !== 'Recent');
  ok('…not shown once something is typed', !R.frItems('pack').some(i => i.sec === 'Recent'));
  ok('…kept for each person apart', load({ store: R.store, email: 'b@x', screens: SCREENS }).frRecent().length === 0);

  /* ---- pointing at the picked part ---- */
  const el = { classList: { add() { el.on = true; }, remove() {} }, scrollIntoView() { el.seen = true; } };
  const G = load({ partEl: () => el }); G.frGoPart({ tab: 'repl', label: 'Export' });
  ok('picked part: its screen opens once and the part is ringed', G.shown.join() === 'repl' && el.on && el.seen);
  const H = load({ screens: SCREENS }); H.frGoPart({ tab: 'pack', label: 'Save packing list' });
  ok('a part not showing yet says so (was: nothing happened)', H.toasts.length === 1 && /Save packing list.*Packing List/.test(H.toasts[0]), H.toasts[0]);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
