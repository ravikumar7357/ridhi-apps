/* ORDER STRIP FROM THE ALERT LIST (Stage 2 of docs/data-reduction/ALERT-LIST-PLAN.md) — orders/order-ticker.js on a fake page.
 *   node tests/alert-list-ticker-test.js            (TK_SRC=<file> to test another copy of order-ticker.js; the teeth do)
 * What must hold: the switch alertList (0 beats the flag, 1 is on, else the flag; never in harnesses or for vendors); with it
 * on and a good list the strip is the same strip as the registers make (same items, same order, same click), plus one small
 * "checked at" item, and the page downloads no registers; when the list is missing / refused / without a version / never
 * checked the strip does what it does with the switch off (loads the registers, draws from them) and NEVER shows the still
 * line; with the switch off nothing here runs; this page's own write shows at once; the sign-in flags read saves the switch. */
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), { spawnSync } = require('child_process');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const SRC = rd(process.env.TK_SRC || path.join(APP, 'orders', 'order-ticker.js'));
const AUTH = rd(path.join(APP, 'core', 'auth.js'));
const RULE = rd(path.join(APP, 'orders', 'order-alerts.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const later = () => new Promise(r => setImmediate(r));

/* Today is 6 Nov 2026 on the fake page. Four open lines (one late, one due today, one not due, one with no date) and a closed one. */
const LINES = [
  { open: true, orderNo: 'AMZ-1', sku: 'S1', qty: 4, pressed: 1, fromStock: 0, mtoDue: '2026-11-01', itemName: 'Quilt', color: 'Red' },
  { open: true, orderNo: 'SHP-2', sku: 'S2', qty: 2, pressed: 0, fromStock: 0, mtoDue: '2026-11-06', itemName: 'Pillow', color: 'Blue' },
  { open: true, orderNo: 'B2B-3', sku: 'S3', qty: 9, pressed: 2, fromStock: 1, mtoDue: '2026-12-01', itemName: 'Throw', color: 'Grey' },
  { open: true, orderNo: 'ONL-4', sku: 'S4', qty: 1, pressed: 0, fromStock: 0, mtoDue: '', itemName: 'Mat', color: 'Tan' },
  { open: false, orderNo: 'AMZ-9', sku: 'S9', qty: 3, pressed: 3, fromStock: 0, mtoDue: '2026-10-01', itemName: 'Done', color: 'Red' },
];

function page(o) {
  o = o || {};
  const LS = new Map(Object.entries(o.ls || {}));
  const localStorage = { getItem: k => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => LS.set(k, String(v)), removeItem: k => { LS.delete(k); } };
  const cls = new Set(['hide']);
  let html = '', sets = 0;
  const box = { get innerHTML() { return html; }, set innerHTML(v) { html = v; sets++; }, get sets() { return sets; }, classList: { add: c => cls.add(c), remove: c => cls.delete(c) },
    /* only the 'checked at' text can be reached here, as in the page: changing it changes the text in place */
    querySelectorAll: () => { const out = [], re = /<span class="otk-it otk-sum otk-stamp"><b>(.*?)<\/b>/g; let m; while ((m = re.exec(html))) { const old = m[1]; out.push({ set textContent(v) { html = html.split('<b>' + old + '</b>').join('<b>' + v + '</b>'); } }); } return out; } };
  const loads = [], gets = [], warns = [], tabs = [];
  let onClick = null;
  const PTG = { ob: o.registers ? [{}] : null };
  const ctx = {
    localStorage, AUDIT: { on: !o.harness }, PTG,
    ME: o.vendor ? { email: 'v@x', tabs: ['vportal'] } : { email: 'a@b', admin: false, tabs: ['ord'] },
    NAV_IS_VENDOR: !!o.vendor,
    $: id => (id === 'ordTicker' ? box : null),
    ptLoadGates: (force, light) => { loads.push(['gates', force, light]); return new Promise(() => {}); },
    PTG_ALL: [], ptHas: () => !!PTG.ob, ptNeed: (set, op) => { loads.push(['need', !!(op && op.force), !!(op && op.light)]); return new Promise(() => {}); },
    ptGet: async node => { gets.push(node); if (o.list === 'refused') throw new Error('The production database refused the read (permission denied).'); return o.list === undefined ? null : JSON.parse(JSON.stringify(o.list)); },
    ordLines: () => LINES,
    dToday: () => '2026-11-06', nf: n => String(n), esc: s => String(s),
    showTab: t => tabs.push(t),
    document: { addEventListener: (k, f) => { if (k === 'click') onClick = f; } },
    console: { warn: m => warns.push(String(m)), log() {} },
    setTimeout: () => 0, setInterval: () => 0, Event: function () {},
  };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\n' + RULE + '\n;this.__t = { otkTick, otkRender, otkListOn, otkListSaveFlag, otkOwnWrite, OTK, oalEntry, oalKey, OAL_V };', ctx);
  return {
    t: ctx.__t, box, cls, loads, gets, warns, tabs, LS, PTG,
    click: () => onClick && onClick({ target: { closest: sel => (sel === '[data-otkno]' ? { dataset: { otkno: 'AMZ-1' } } : null) } }),
  };
}
/* The list as Stage 1 writes it, from the same lines. */
function listFor(lines, extra) {
  const p = page(), l = {};
  lines.map(x => p.t.oalEntry(x, null)).filter(Boolean).forEach(e => { l[p.t.oalKey(e.no, e.sku)] = Object.assign({}, e, { at: 1 }); });
  return Object.assign({ v: p.t.OAL_V, at: new Date().setHours(14, 5, 0, 0), l }, extra || {});
}
/* The items of the strip's first copy, one text per item. */
const itemsOf = html => { const m = html.match(/<div class="otk-set">(.*?)<\/div>/s); return m ? m[1].split('<span class="otk-dot" aria-hidden="true"></span>').filter(Boolean) : []; };
const CHECKED = /checked at/;

/* The strip from the registers, switch off, as today. */
const todayP = page({ registers: true }); todayP.t.otkTick();
const todayItems = itemsOf(todayP.box.innerHTML);

console.log('Switch order');
ok('off by default', page().t.otkListOn() === false);
ok('flag on → on', page({ ls: { alListFlagLast: '1' } }).t.otkListOn() === true);
ok("device '1' → on without the flag", page({ ls: { alertList: '1' } }).t.otkListOn() === true);
ok("device '0' beats the flag", page({ ls: { alertList: '0', alListFlagLast: '1' } }).t.otkListOn() === false);
ok('never in a harness', page({ harness: true, ls: { alertList: '1' } }).t.otkListOn() === false);
ok('never for a vendor', page({ vendor: true, ls: { alertList: '1' } }).t.otkListOn() === false);
{ const p = page(); p.t.otkListSaveFlag(true); const a = p.LS.get('alListFlagLast'); p.t.otkListSaveFlag(false);
  ok('the flag answer is kept for the next page, and cleared', a === '1' && !p.LS.has('alListFlagLast')); }

console.log('Switch ON, good list, page without the registers');
(async () => {
  {
    const p = page({ ls: { alertList: '1' }, list: listFor(LINES) }); p.t.otkTick();
    ok('nothing is drawn before the list answers', p.box.innerHTML === '' && p.cls.has('hide'));
    await later(); await later();
    const items = itemsOf(p.box.innerHTML);
    ok('the strip runs and is shown', p.box.innerHTML.includes('otk-run') && !p.cls.has('hide'));
    ok('reads the list node, once', p.gets.length === 1 && p.gets[0] === 'pt_orderAlerts', JSON.stringify(p.gets));
    ok('never loads the registers', p.loads.length === 0, JSON.stringify(p.loads));
    ok('never shows the still line', !p.box.innerHTML.includes('data-otkplain') && !p.box.innerHTML.includes('open the Order Console'));
    const checked = items.filter(x => CHECKED.test(x)), rest = items.filter(x => !CHECKED.test(x));
    ok('one small "checked at 14:05" item', checked.length === 1 && /checked at 14:05/.test(checked[0]) && /otk-sum/.test(checked[0]), checked.join('|'));
    ok('every other item equals the registers\' strip, same order', rest.length > 0 && JSON.stringify(rest) === JSON.stringify(todayItems), JSON.stringify(rest) + ' vs ' + JSON.stringify(todayItems));
    ok('the late and due-today orders are in it', rest.some(x => x.includes('AMZ-1') && x.includes('LATE 5 days')) && rest.some(x => x.includes('SHP-2') && x.includes('DUE TODAY')));
    ok('the closed order is not', !p.box.innerHTML.includes('AMZ-9'));
    p.click();
    ok('a click on an order opens the Order Console', p.tabs.length === 1 && p.tabs[0] === 'ord');
    p.t.otkTick(); await later();
    ok('the next minute reads the list again, still no registers', p.gets.length === 2 && p.loads.length === 0);
  }

  console.log('Switch ON, page that already has the registers');
  {
    const p = page({ ls: { alertList: '1' }, list: listFor(LINES), registers: true }); p.t.otkTick(); await later(); await later();
    const items = itemsOf(p.box.innerHTML).filter(x => !CHECKED.test(x));
    ok('uses the list here too (same late count everywhere)', /checked at/.test(p.box.innerHTML) && JSON.stringify(items) === JSON.stringify(todayItems) && p.loads.length === 0);
  }

  console.log('A new check time does not restart the strip');
  {
    const L = listFor(LINES), p = page({ ls: { alertList: '1' }, list: L }); p.t.otkTick(); await later(); await later();
    const sig = p.t.OTK.sig, sets = p.box.sets, before = p.box.innerHTML;
    L.at = new Date().setHours(15, 20, 0, 0); p.t.otkTick(); await later(); await later();
    const after = p.box.innerHTML;
    ok('same order items: signature and strip are not redrawn', p.t.OTK.sig === sig && p.box.sets === sets);
    ok('only the checked-at text changes, in both copies', /checked at 14:05/.test(before) && !/14:05/.test(after) && (after.match(/checked at 15:20/g) || []).length === 2 && after.replace(/15:20/g, '14:05') === before);
    L.l['AMZ-1__S1'].qty = 5; L.at = new Date().setHours(15, 30, 0, 0); p.t.otkTick(); await later(); await later();
    ok('a changed order does redraw', p.box.sets === sets + 1 && p.t.OTK.sig !== sig);
  }

  console.log('This page\'s own write shows at once');
  {
    const p = page({ ls: { alertList: '1' }, list: listFor(LINES) }); p.t.otkTick(); await later(); await later();
    const e = p.t.oalEntry(LINES[0], null);
    p.t.otkOwnWrite({ 'pt_orderAlerts/l/AMZ-1__S1': null, 'pt_orderAlerts/l/ZZZ-7__S7': Object.assign({}, e, { no: 'ZZZ-7', sku: 'S7', id: 'ZZZ-7__S7' }) });
    ok('a closed line leaves the strip and a new one joins it, with no read', !p.box.innerHTML.includes('AMZ-1') && p.box.innerHTML.includes('ZZZ-7') && p.gets.length === 1);
  }

  console.log('Switch ON, the list cannot be used → today\'s strip');
  const bad = [
    ['missing', undefined, /not there/],
    ['refused (rule not deployed)', 'refused', /cannot be read/],
    ['empty with no version', { l: {} }, /no version/],
    ['never checked', Object.assign(listFor(LINES), { at: undefined }), /never been checked/],
    ['another rule version', Object.assign(listFor(LINES), { v: 99 }), /rule version/],
  ];
  for (const [name0, list, why] of bad) for (const extra of [{}, { tickerPlain: '1' }]) {
    const name = name0 + (extra.tickerPlain ? ' (tickerPlain also on)' : '');
    const p = page({ ls: Object.assign({ alertList: '1' }, extra), list }); p.t.otkTick(); await later(); await later(); p.t.otkTick(); await later(); await later();
    ok(name + ': loads the registers once, the light way, as the switch-off strip does', p.loads.length === 1 && p.loads[0][0] === 'need' && p.loads[0][1] === false && p.loads[0][2] === true, JSON.stringify(p.loads));
    ok(name + ': hidden until they arrive, never the still line', p.cls.has('hide') && !p.box.innerHTML.includes('data-otkplain'));
    ok(name + ': the reason is logged once', p.warns.length === 1 && why.test(p.warns[0]), JSON.stringify(p.warns));
    p.PTG.ob = [{}]; p.t.otkTick(); await later();
    const items = itemsOf(p.box.innerHTML);
    ok(name + ': once the registers arrive it draws today\'s strip exactly', JSON.stringify(items) === JSON.stringify(todayItems) && !CHECKED.test(p.box.innerHTML) && !p.box.innerHTML.includes('data-otkplain'));
  }
  {
    const p = page({ ls: { alertList: '1' }, list: undefined, registers: true }); p.t.otkTick(); await later(); await later();
    ok('list missing on a page that has the registers: draws from them, no download, no still line', JSON.stringify(itemsOf(p.box.innerHTML)) === JSON.stringify(todayItems) && p.loads.length === 0 && !p.box.innerHTML.includes('data-otkplain'));
  }
  {
    const p = page({ ls: { alertList: '1' }, list: listFor(LINES, { l: undefined }) }); p.t.otkTick(); await later(); await later();
    ok('a checked list with no open lines is a valid empty list (no registers)', p.loads.length === 0 && /Pending: 0 lines/.test(p.box.innerHTML) && /checked at/.test(p.box.innerHTML));
  }

  console.log('Switch OFF (today)');
  {
    const p = page({ list: listFor(LINES) }); p.t.otkTick(); p.t.otkTick(); await later();
    ok('does not touch the list', p.gets.length === 0);
    ok('downloads the registers once, the light way', p.loads.length === 1 && p.loads[0][1] === false && p.loads[0][2] === true, JSON.stringify(p.loads));
    ok('hidden until they arrive', p.cls.has('hide') && !p.box.innerHTML.includes('checked at'));
    p.PTG.ob = [{}]; p.t.otkTick();
    ok('then draws today\'s strip, no "checked at"', JSON.stringify(itemsOf(p.box.innerHTML)) === JSON.stringify(todayItems) && !CHECKED.test(p.box.innerHTML));
  }
  {
    const p = page({ ls: { alertList: '0', alListFlagLast: '1' }, list: listFor(LINES) }); p.t.otkTick(); await later();
    ok("device '0' keeps today's download and never reads the list", p.gets.length === 0 && p.loads.length === 1);
  }
  {
    const p = page({ vendor: true, ls: { alertList: '1' }, list: listFor(LINES) }); p.t.otkTick(); await later();
    ok('a vendor sees nothing, reads nothing', p.cls.has('hide') && p.gets.length === 0 && p.loads.length === 0 && !p.box.innerHTML);
  }

  console.log('Sign-in flags read');
  {
    const i = AUTH.indexOf("getDoc(doc(db, 'config', 'flags'))"), blk = i < 0 ? '' : AUTH.slice(i, AUTH.indexOf('dmStart', i));
    ok('saves alertList from the same single read', /otkListSaveFlag\(!!d && \(d\.alertList === true/.test(blk));
    ok('a failed read turns it off', /\.catch\([^\n]*otkListSaveFlag\(false\)/.test(blk));
    ok('only one flags read at sign-in', (AUTH.match(/doc\(db, 'config', 'flags'\)/g) || []).length === 1);
  }

  /* Teeth: broken copies of order-ticker.js must make this suite fail. */
  if (!process.env.TK_SRC) {
    console.log('Teeth');
    const real = rd(path.join(APP, 'orders', 'order-ticker.js'));
    const BROKEN = [
      ['the list path loads the registers', real.replace("if (L.state !== 'ready') otkAskRegisters();", 'otkAskRegisters();')],
      ['a failed list shows the still line', real.replace("if (!ptHas(PTG_ALL)) { box.classList.add('hide'); return; }\n  } else", "if (!ptHas(PTG_ALL)) { box.innerHTML = OTK_PLAIN; box.classList.remove('hide'); return; }\n  } else")],
      ['an item missing from the list-built strip', real.replace('map.set(k, l[k]); });', 'map.set(k, l[k]); });\n  if (map.size > 1) map.delete([...map.keys()][0]);')],
      ['the still line is tried before the list switch', real.replace("  if (otkListOn()) {\n    /* The list switch", "  if (!ptHas(PTG_ALL) && otkPlainOn()) { box.innerHTML = OTK_PLAIN; box.classList.remove('hide'); return; }\n  if (otkListOn()) {\n    /* The list switch")],
      ['the checked-at time restarts the strip', real.replace("const sig = items.filter(x => x.kind !== 'stamp').map", 'const sig = items.map')],
      ['a failed list does not fall back', real.replace("if (L.state !== 'ready') otkAskRegisters();", '')],
      ['the switch off still reads the list', real.replace('if (otkListOn() && otkAllowed()) { otkListTick(); return; }', 'if (otkAllowed()) { otkListTick(); return; }')],
      ["'0' no longer beats the flag", real.replace("if (s === '0') return false;\n    if (typeof AUDIT === 'undefined' || !AUDIT.on) return false;\n    if (typeof spIsVendor", "if (typeof AUDIT === 'undefined' || !AUDIT.on) return false;\n    if (typeof spIsVendor")],
      ['"checked at" left out', real.replace("items.push({ kind: 'stamp', txt: 'checked at '", "items.push({ kind: 'skip', txt: 'checked at '")],
      ['own write not shown at once', real.replace("otkDraw(box, otkListItems()); box.classList.remove('hide'); } }", '} }')],
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-'));
    BROKEN.forEach(([name, src], k) => {
      if (src === real) { ok('teeth: ' + name + ' (mutation applied)', false, 'the text to break was not found'); return; }
      const f = path.join(dir, 'b' + k + '.js'); fs.writeFileSync(f, src);
      const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TK_SRC: f }), encoding: 'utf8' });
      ok('teeth: ' + name, r.status !== 0);
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
