/* Opening a screen (src/app/core/nav.js, showTab): a new screen opens at the top of the page; the same screen drawn again
 * keeps its place, and so does an address pointing inside the page (#someId that is not a screen). The real showTab and
 * navAnchorHash, cut out of nav.js and run against a stub page.
 *   node tests/nav-test.js */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'core', 'nav.js'), 'utf8');
const from = src.indexOf('function navAnchorHash()'), to = src.indexOf('/* BOUND FROM THE TAB LIST');
const code = src.slice(from, to);
ok('showTab and navAnchorHash found in nav.js', from > 0 && to > from && /function showTab\(which\)/.test(code));

function page(hash) {
  const scrolls = [];
  const el = () => ({ classList: { add() {}, remove() {}, toggle() {} }, textContent: '' });
  const ids = new Set(['plxTable', 'ngTable']);
  const known = {
    TABS: ['st', 'ngram', 'plc', 'ppch'], TAB_NOW: '', TAB_HASH: 'off', TAB_TITLE: {}, NAV_GROUPS: [],
    $: () => el(), capId: s => s, setGroupOpen() {}, setNavOpen() {}, NARROW: () => false,
    location: { hash: hash || '' }, history: { pushState() {}, replaceState() {} },
    window: { scrollTo: (x, y) => scrolls.push([x, y]) },
    document: { getElementById: id => (ids.has(id) ? {} : null) },
  };
  // Every screen's loader (ensureSt, ensurePlc…) is a no-op here.
  const scope = new Proxy(known, {
    has: (t, k) => typeof k === 'string' && !['undefined', 'Object', 'String', 'decodeURIComponent', 'Array', 'Math', 'JSON'].includes(k),
    get: (t, k) => (k in t ? t[k] : k === Symbol.unscopables ? undefined : typeof k === 'string' && /^(ensure|load)/.test(k) ? () => {} : globalThis[k]),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  const run = new Function('scope', `with (scope) { ${code}; return { showTab, navAnchorHash }; }`)(scope);
  return { run, scrolls, known };
}

{
  const { run, scrolls, known } = page('#st');
  run.showTab('st');
  ok('opening a screen scrolls the page to the top', scrolls.length === 1 && scrolls[0].join() === '0,0' && known.TAB_NOW === 'st', JSON.stringify(scrolls));
  run.showTab('st');
  ok('the same screen drawn again keeps its place (no scroll)', scrolls.length === 1, JSON.stringify(scrolls));
  run.showTab('plc');
  ok('another screen: to the top again', scrolls.length === 2);
}
{
  const { run, scrolls } = page('#plxTable');
  ok('an address pointing inside the page is an anchor (#plxTable)', run.navAnchorHash() === true);
  run.showTab('plc');
  ok('…and then the page is not scrolled to the top', scrolls.length === 0, JSON.stringify(scrolls));
}
{
  const { run } = page('#ngram');
  ok('a screen\'s own address (#ngram) is not an anchor', run.navAnchorHash() === false);
  ok('an address naming nothing on the page is not an anchor', page('#nothing-here').run.navAnchorHash() === false);
}
{
  // Reimbursement › Overview (24 Nov 2026): its own tab, its own loader.
  const { run, known } = page('#reimb');
  let opened = 0;
  known.TABS = ['st', 'reimb'];
  known.ensureReimb = () => { opened++; };
  run.showTab('reimb');
  ok('opening Reimbursement › Overview calls its loader (ensureReimb), once', opened === 1 && known.TAB_NOW === 'reimb');
  run.showTab('st');
  ok('…and another screen does not', opened === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
