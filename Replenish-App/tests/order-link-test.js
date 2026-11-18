/* AN ORDER FROM A LINK — core/nav.js navHashOrder + orders/order-ticker.js ordOpenOrder, run on a fake page.
 *   node tests/order-link-test.js
 * Ravi, 17 Nov 2026: the report mail's PDFs should be actionable — a click on an order number opens the Order Console
 * searched to that order. What must hold: "#ord?q=<order>" names the Order Console AND the order; a plain "#ord" or any
 * other screen names no order; odd characters are refused; opening fills the console's search; sign-in reads the order
 * before showTab rewrites the address; and a broken copy of the rule makes this suite fail. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const NAV = rd(path.join(APP, 'core', 'nav.js'));
const TICKER = rd(path.join(APP, 'orders', 'order-ticker.js'));
const AUTH = rd(path.join(APP, 'core', 'auth.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

/** One top-level function's source, by name. */
function fnSrc(src, name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  if (at < 0) throw new Error('no function ' + name);
  const end = src.indexOf('\n}\n', at);
  return src.slice(at, end + 3);
}
/** The address rules, loaded on a fake page whose address is `hash`. */
function linkRules(hash, navSrc) {
  const s = navSrc || NAV;
  const ctx = { location: { hash }, URLSearchParams, TAB_NAV_IDS: ['ord', 'fab', 'rep', 'vend'] };
  vm.createContext(ctx);
  vm.runInContext(['navHashParts', 'navHashTab', 'navHashOrder', 'navHashPrinter'].map(n => fnSrc(s, n)).join('\n'), ctx);
  return ctx;
}

console.log('== the address names the screen and the order ==');
{
  const p = linkRules('#ord?q=AMZ-01092026-01');
  ok('"#ord?q=AMZ-01092026-01" opens the Order Console', p.navHashTab() === 'ord', p.navHashTab());
  ok('…searched to that order', p.navHashOrder() === 'AMZ-01092026-01', p.navHashOrder());
  ok('a Shopify number with # in it (sent as %23) is kept', linkRules('#ord?q=%237441').navHashOrder() === '#7441');
  ok('a plain "#ord" names no order', linkRules('#ord').navHashOrder() === '');
  ok('another screen names no order', linkRules('#rep?q=AMZ-1').navHashOrder() === '');
  ok('another screen still opens as before', linkRules('#fab').navHashTab() === 'fab');
  ok('odd characters are refused', linkRules('#ord?q=%3Cscript%3E').navHashOrder() === '');
  ok('a screen this app does not have is refused', linkRules('#xyz?q=AMZ-1').navHashTab() === '');
}

console.log('\n== opening the order ==');
{
  const tabs = [], fired = [];
  const box = { value: '', dispatchEvent: e => fired.push(e.type) };
  const ctx = { showTab: t => tabs.push(t), $: id => (id === 'odQ' ? box : null), setTimeout: f => f(),
    Event: function (type) { this.type = type; } };
  vm.createContext(ctx);
  vm.runInContext(fnSrc(TICKER, 'ordOpenOrder'), ctx);
  ctx.ordOpenOrder('B2B-26082026-01');
  ok('it shows the Order Console', tabs.join() === 'ord', tabs.join());
  ok('…and puts the order in its search', box.value === 'B2B-26082026-01', box.value);
  ok('…and tells the search it changed', fired.join() === 'input', fired.join());
  ok('the red strip opens orders the same way', /ordOpenOrder\(b\.dataset\.otkno\)/.test(TICKER));
  ok('sign-in reads the order before showTab rewrites the address',
     /const linkOrder = navHashOrder\(\), linkPrinter = navHashPrinter\(\);\s*if \(linkPrinter && typeof flowVpLinkPrepare === 'function'\) flowVpLinkPrepare\(linkPrinter\);\s*showTab\(navHashTab\(\) \|\| ME\.tabs\[0\]\);\s*if \(linkOrder\) ordOpenOrder\(linkOrder\);/.test(AUTH));
  ok('a link followed while the app is open opens the order', /if \(no\) \{ ordOpenOrder\(no\); return; \}/.test(NAV));
}

console.log('\n== a printer from a link (the printer delay mail) ==');
{
  const p = linkRules('#vend?printer=VND004&late=1');
  ok('"#vend?printer=VND004&late=1" opens the Vendor Portal', p.navHashTab() === 'vend', p.navHashTab());
  ok('…as that printer, late only', JSON.stringify(p.navHashPrinter()) === '{"code":"VND004","late":true}', JSON.stringify(p.navHashPrinter()));
  ok('without late=1 it shows every line', linkRules('#vend?printer=VND004').navHashPrinter().late === false);
  ok('odd characters in the printer are refused', linkRules('#vend?printer=%3Cb%3E').navHashPrinter() === null);
  ok('another screen names no printer', linkRules('#ord?printer=VND004').navHashPrinter() === null);
  const FLOW = rd(path.join(APP, 'flow', 'flow-vendor.js'));
  const ctx = { VP: { lateOnly: false, rows: [1] }, FLOW_VP_AS: null, $: () => null };
  vm.createContext(ctx);
  vm.runInContext('var FLOW_VP_AS = null;' + fnSrc(FLOW, 'flowVpLinkPrepare') + '; this.get = () => FLOW_VP_AS;', ctx);
  ctx.flowVpLinkPrepare({ code: 'VND004', late: true });
  ok('the portal is set to look as that printer', ctx.get() && ctx.get().code === 'VND004');
  ok('…with late only on and a fresh read', ctx.VP.lateOnly === true && ctx.VP.rows === null);
  ok('a link followed while the app is open opens the printer', /if \(printer && typeof flowVpLinkPrepare === 'function'\) \{ flowVpLinkPrepare\(printer\); showTab\('vend'\); return; \}/.test(NAV));
  ok('the printer picker shows the printer the link asked for', /if \(FLOW_VP_AS\) \{ sel\.value = FLOW_VP_AS\.code;/.test(FLOW));
  const loose = NAV.replace("return /^[A-Za-z0-9_-]{1,20}$/.test(code) ? { code, late: q.get('late') === '1' } : null;", "return { code, late: q.get('late') === '1' };");
  ok('teeth: a copy without the printer check lets <b> through', loose !== NAV && linkRules('#vend?printer=%3Cb%3E', loose).navHashPrinter().code === '<b>');
}

console.log('\n== teeth ==');
{
  const loose = NAV.replace(/return \/\^\[A-Za-z0-9#\]\[A-Za-z0-9#_\\-\]\{0,59\}\$\/\.test\(no\) \? no : '';/, "return no;");
  ok('teeth: the copy really is broken', loose !== NAV);
  ok('teeth: a copy without the character check lets <script> through', linkRules('#ord?q=%3Cscript%3E', loose).navHashOrder() === '<script>');
  const noSplit = NAV.replace("return at < 0 ? { tab: h, query: '' } : { tab: h.slice(0, at), query: h.slice(at + 1) };", "return { tab: h, query: '' };");
  ok('teeth: a copy that does not split at "?" loses the screen', linkRules('#ord?q=AMZ-1', noSplit).navHashTab() === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
