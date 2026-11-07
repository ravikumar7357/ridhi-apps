/* ORDER STRIP, PLAIN LINE (Stage 0 of docs/data-reduction/ALERT-LIST-PLAN.md) — orders/order-ticker.js run on a fake page.
 *   node tests/order-ticker-test.js            (TK_SRC=<file> to test another copy of order-ticker.js; the last part does)
 * What must hold: the switch order (0 beats the flag, 1 is on, else the flag; never in harnesses); with the switch on a
 * page without the registers never downloads them and shows the plain line, which opens the Order Console; a page that
 * has the registers shows today's strip either way; with the switch off the page downloads the registers once, as today;
 * vendors see nothing; the sign-in flags read saves the switch; and a broken switch makes this suite fail. */
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), { spawnSync } = require('child_process');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const SRC = rd(process.env.TK_SRC || path.join(APP, 'orders', 'order-ticker.js'));
const AUTH = rd(path.join(APP, 'core', 'auth.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

function page(o) {
  o = o || {};
  const LS = new Map(Object.entries(o.ls || {}));
  const localStorage = { getItem: k => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => LS.set(k, String(v)), removeItem: k => { LS.delete(k); } };
  const cls = new Set(['hide']);
  const box = { innerHTML: '', classList: { add: c => cls.add(c), remove: c => cls.delete(c) } };
  const loads = [], tabs = [];
  let onClick = null;
  const PTG = { ob: o.registers ? [{}] : null };
  const ctx = {
    localStorage, AUDIT: { on: !o.harness }, PTG,
    ME: o.vendor ? { email: 'v@x', tabs: ['vportal'] } : { email: 'a@b', admin: false, tabs: ['ord'] },
    NAV_IS_VENDOR: !!o.vendor,
    $: id => (id === 'ordTicker' ? box : null),
    ptLoadGates: (force, light) => { loads.push([force, light]); return new Promise(() => {}); },
    /* the gates (core/gates.js) are not loaded here: the strip only asks whether the order book is in, and for it to be read */
    PTG_ALL: [], ptHas: () => !!PTG.ob, ptNeed: (set, o) => { loads.push([!!(o && o.force), !!(o && o.light)]); return new Promise(() => {}); },
    ordLines: () => [{ open: true, orderNo: 'AMZ-1', sku: 'S1', qty: 4, pressed: 1, fromStock: 0, mtoDue: '2026-11-01', itemName: 'Quilt', color: 'Red' }],
    dToday: () => '2026-11-06', nf: n => String(n), esc: s => String(s),
    showTab: t => tabs.push(t),
    document: { addEventListener: (k, f) => { if (k === 'click') onClick = f; } },
    setTimeout: () => 0, setInterval: () => 0, Event: function () {},
  };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\n;this.__t = { otkTick, otkRender, otkPlainOn, otkSaveFlag, OTK };', ctx);
  return {
    t: ctx.__t, box, cls, loads, tabs, LS, PTG,
    click: attr => onClick && onClick({ target: { closest: sel => (sel === '[' + attr + ']' ? { dataset: { otkno: 'AMZ-1' } } : null) } }),
  };
}

console.log('Switch order');
ok('off by default', page().t.otkPlainOn() === false);
ok('flag on → on', page({ ls: { tpFlagLast: '1' } }).t.otkPlainOn() === true);
ok("device '1' → on without the flag", page({ ls: { tickerPlain: '1' } }).t.otkPlainOn() === true);
ok("device '0' beats the flag", page({ ls: { tickerPlain: '0', tpFlagLast: '1' } }).t.otkPlainOn() === false);
ok('never in a harness', page({ harness: true, ls: { tickerPlain: '1' } }).t.otkPlainOn() === false);
{ const p = page(); p.t.otkSaveFlag(true); const a = p.LS.get('tpFlagLast'); p.t.otkSaveFlag(false);
  ok('the flag answer is kept for the next page, and cleared', a === '1' && !p.LS.has('tpFlagLast')); }

console.log('Switch ON, page without the registers');
{ const p = page({ ls: { tickerPlain: '1' } }); p.t.otkTick(); p.t.otkTick();
  ok('never downloads the registers', p.loads.length === 0, JSON.stringify(p.loads));
  ok('shows the plain line', p.box.innerHTML.includes('data-otkplain') && p.box.innerHTML.includes('open the Order Console') && !p.cls.has('hide'));
  ok('no running strip', !p.box.innerHTML.includes('otk-run'));
  p.click('data-otkplain');
  ok('a click opens the Order Console', p.tabs.length === 1 && p.tabs[0] === 'ord');
  p.PTG.ob = [{}]; p.t.otkTick();
  ok('once a screen loads the registers, today\'s strip comes back', p.box.innerHTML.includes('otk-run') && p.box.innerHTML.includes('LATE 5 days'));
  ok('...still without a download of its own', p.loads.length === 0); }

console.log('Switch ON or OFF, page that has the registers');
for (const ls of [{}, { tickerPlain: '1' }]) {
  const p = page({ ls, registers: true }); p.t.otkTick();
  ok(`today's strip (${ls.tickerPlain ? 'on' : 'off'})`, p.box.innerHTML.includes('otk-run') && p.box.innerHTML.includes('AMZ-1') && !p.cls.has('hide'));
  ok(`no extra download (${ls.tickerPlain ? 'on' : 'off'})`, p.loads.length === 0);
}

console.log('Switch OFF, page without the registers (today)');
{ const p = page(); p.t.otkTick(); p.t.otkTick();
  ok('downloads the registers once, the light way', p.loads.length === 1 && p.loads[0][0] === false && p.loads[0][1] === true, JSON.stringify(p.loads));
  ok('stays hidden until they arrive', p.cls.has('hide') && !p.box.innerHTML.includes('data-otkplain')); }
{ const p = page({ ls: { tickerPlain: '0', tpFlagLast: '1' } }); p.t.otkTick();
  ok("device '0' keeps today's download even with the flag on", p.loads.length === 1); }

console.log('Vendors');
{ const p = page({ vendor: true, ls: { tickerPlain: '1' } }); p.t.otkTick();
  ok('a vendor sees nothing and downloads nothing', p.cls.has('hide') && p.loads.length === 0 && !p.box.innerHTML); }

console.log('Sign-in flags read');
{ const i = AUTH.indexOf("getDoc(doc(db, 'config', 'flags'))"), blk = i < 0 ? '' : AUTH.slice(i, AUTH.indexOf('dmStart', i));
  ok('saves tickerPlain from the same single read', /otkSaveFlag\(!!d && \(d\.tickerPlain === true/.test(blk));
  ok('a failed read turns it off', /\.catch\([^\n]*otkSaveFlag\(false\)/.test(blk));
  ok('only one flags read at sign-in', (AUTH.match(/doc\(db, 'config', 'flags'\)/g) || []).length === 1); }

/* Teeth: broken copies of order-ticker.js must make this suite fail. */
if (!process.env.TK_SRC) {
  console.log('Teeth');
  const real = rd(path.join(APP, 'orders', 'order-ticker.js'));
  const BROKEN = [
    ['download not stopped', real.replace('!OTK.asked && !otkPlainOn() &&', '!OTK.asked &&')],
    ["'0' no longer beats the flag", real.replace("if (s === '0') return false;", '')],
    ['plain line never shown', real.replace("if (OTK.sig !== OTK_PLAIN) { OTK.sig = OTK_PLAIN; box.innerHTML = OTK_PLAIN; }", '')],
    ['plain line does not open the console', real.replace("closest('[data-otkplain]')) { showTab('ord'); return; }", "closest('[data-otkplain]')) { return; }")],
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otk-'));
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
