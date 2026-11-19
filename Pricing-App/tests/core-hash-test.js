/* Core: a refresh stays on the same page (core/auth.js, core/access.js, core/nav.js) — in a stub browser with an address bar, a
 * history (Back / Forward) and Firebase's sign-in answer.
 *   node tests/core-hash-test.js
 * Loading screen until the first answer · #img after a refresh opens Image Manager · a tab this account may not see → the first one ·
 * signed out → the sign-in screen, then the same page · Back / Forward · the load-time showTab never overwrites the address. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const CORE = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'core', f), 'utf8');

// One page load: `hash` is what the address bar holds; `tabs` the account's perms (null = no perms document).
function boot(hash, tabs) {
  const els = {};
  const cl = init => { const s = new Set(init || []); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
    toggle: (c, on) => ((on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c)) }; };
  const $ = id => els[id] || (els[id] = { id, classList: cl(id === 'loginView' || id === 'appView' ? ['hide'] : []), dataset: {}, style: {}, textContent: '', value: '', disabled: false,
    setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], options: [] });
  // the address bar and the history
  const entries = [hash || ''];
  let at = 0;
  const location = { get hash() { return entries[at]; }, set hash(h) { entries.splice(at + 1); entries.push(h); at++; fire(); } };
  const history = { pushState: (s, t, url) => { entries.splice(at + 1); entries.push(url); at++; }, replaceState: (s, t, url) => { entries[at] = url; } };
  const listeners = {};
  const fire = () => (listeners.hashchange || []).forEach(fn => fn());
  const window = { addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); }, matchMedia: () => ({ matches: false, addEventListener() {} }), open() {}, scrollTo() {} };
  const opened = [];
  let authCb = null;
  const stub = {
    $, document: { querySelectorAll: () => [], addEventListener() {}, createElement: () => ({}) }, window, location, history, localStorage: { getItem: () => null, setItem() {} },
    onAuthStateChanged: (a, cb) => { authCb = cb; }, auth: {}, db: {}, doc: (d, c, id) => ({ path: c + '/' + id }),
    getDoc: async ref => (ref.path.startsWith('perms/') && tabs ? { exists: () => true, data: () => ({ tabs }) } : { exists: () => false, data: () => ({}) }),
    signInWithEmailAndPassword() {}, signOut() {}, sendEmailVerification() {}, showMsg() {}, loadSettings: async () => {}, API: {}, API_ERR: '',
    matchMedia: () => ({ matches: false, addEventListener() {} }), innerWidth: 1400,
    // Listing History's own menu rule, read from the real file (listing/listing-history.js)
    LH_LISTING_TABS: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', 'listing-history.js'), 'utf8').match(/const LH_LISTING_TABS = (\[[^\]]*\])/)[1].replace(/'/g, '"')),
  };
  ['loadNiches', 'ensureAge', 'ensureHealth', 'ensureLrules', 'ensureAudit', 'ensureBsr', 'ensureWeekly', 'ensurePpcn', 'ensureTrends', 'ensureSt', 'ensurePlc',
    'ensureDeals', 'ensureSales', 'ensureProfit', 'ensureSa', 'ensurePlaudit', 'ensureOpt', 'ensureImg', 'ensureLerr', 'ensureBasket', 'ensureTiktok', 'ensureCarousel']
    .forEach(n => { stub[n] = () => opened.push(n); });
  const src = CORE('auth.js') + '\n' + CORE('access.js') + '\n' + CORE('nav.js')
    + '\n;return { showTab, tabNow: () => TAB_NOW, mode: () => TAB_HASH, ME: () => ME };';
  let api;
  try { api = new Function(...Object.keys(stub), src)(...Object.values(stub)); } catch (e) { console.log('LOAD ERROR', e.stack.split('\n').slice(0, 4).join('\n')); process.exit(1); }
  const on = id => !$(id).classList.contains('hide');
  const back = () => { at--; fire(); };
  const forward = () => { at++; fire(); };
  return Object.assign(api, { $, on, signIn: user => authCb(user), hash: () => location.hash, entries, back, forward, opened, typeHash: h => { location.hash = h; } });
}
const user = { email: 'vansh@example.com', emailVerified: true, providerData: [{ providerId: 'password' }] };
const LISTING = ['new', 'health', 'img', 'lerr', 'lrules'];

(async () => {
  console.log('== loading screen: no sign-in flash on a refresh ==');
  {
    const B = boot('#img', LISTING);
    ok('page load: "Loading Sellora…" shows, the sign-in screen does NOT (until Firebase answers)', B.on('bootView') && !B.on('loginView') && !B.on('appView'));
    ok('…the load-time showTab did not touch the address (#img kept)', B.hash() === '#img');
    await B.signIn(user);
    ok('first answer = signed in → the app, no loading line, no sign-in screen', !B.on('bootView') && !B.on('loginView') && B.on('appView'));
  }
  {
    const B = boot('', LISTING);
    await B.signIn(null);
    ok('first answer = nobody signed in → the sign-in screen', !B.on('bootView') && B.on('loginView') && !B.on('appView'));
  }

  console.log('== refresh stays on the same page ==');
  {
    const B = boot('#img', LISTING);
    await B.signIn(user);
    ok('refresh on #img → Image Manager (not the first tab)', B.tabNow() === 'img' && B.on('paneImg') && !B.on('paneNew') && B.opened.includes('ensureImg'));
    ok('…the address still says #img, and no extra history step was added on load', B.hash() === '#img' && B.entries.length === 1);
  }
  {
    const B = boot('#sales', LISTING);
    await B.signIn(user);
    ok('#sales, which this account may not see → the first allowed tab (New Product), and the address follows (#new)', B.tabNow() === 'new' && B.hash() === '#new' && B.entries.length === 1);
  }
  {
    const B = boot('#weekly', ['weekly', 'new']);
    await B.signIn(user);
    ok('a hidden tab (#weekly, off the menu) is not opened from the address → the first allowed tab', B.tabNow() === 'new');
  }
  {
    const B = boot('#lhist', ['health']);
    await B.signIn(user);
    ok('a tab that comes with another (#lhist with Listing Health) opens from the address', B.tabNow() === 'lhist');
  }
  {
    const B = boot('', LISTING);
    await B.signIn(user);
    ok('no #tab → the first allowed tab, as before', B.tabNow() === 'new' && B.hash() === '#new');
  }

  {
    const B = boot('#lhist', ['img']);
    await B.signIn(user);
    ok('Image Manager only: refresh on #lhist stays on Listing History (its menu rule: any of img, lerr, health, lrules, opt)', B.tabNow() === 'lhist' && B.hash() === '#lhist');
  }
  for (const tab of ['lerr', 'lrules', 'opt']) {
    const B = boot('#lhist', [tab, 'new']);
    await B.signIn(user);
    ok('…' + tab + ' only (+ New Product): #lhist stays on Listing History', B.tabNow() === 'lhist');
  }
  {
    const B = boot('#lhist', ['new', 'sales']);
    await B.signIn(user);
    ok('no Listing access: #lhist → the first allowed tab', B.tabNow() === 'new' && B.hash() === '#new');
  }
  {
    const B = boot('#sales', ['img']);
    await B.signIn(user);
    ok('…only #lhist got the extra rule: #sales for an img-only user → Image Manager (its first tab)', B.tabNow() === 'img');
  }

  console.log('== signed out → sign in → the same page; a deep link ==');
  {
    const B = boot('#img', LISTING);
    await B.signIn(null);
    ok('deep link .../sellora/#img while signed out: the sign-in screen, the address keeps #img', B.on('loginView') && B.hash() === '#img');
    await B.signIn(user);
    ok('…after signing in: Image Manager', B.tabNow() === 'img' && B.hash() === '#img');
    await B.signIn(null);
    ok('signing out keeps the page in the address', B.hash() === '#img' && B.on('loginView'));
    await B.signIn(user);
    ok('…signing in again: the same page', B.tabNow() === 'img');
  }

  console.log('== Back / Forward ==');
  {
    const B = boot('#new', LISTING);
    await B.signIn(user);
    B.showTab('health');
    B.showTab('img');
    ok('each screen opened is one history step (#new → #health → #img)', B.entries.join(' ') === '#new #health #img' && B.hash() === '#img');
    B.back();
    ok('Back → Listing Health', B.tabNow() === 'health' && B.on('paneHealth') && B.entries.length === 3);
    B.back();
    ok('Back → New Product', B.tabNow() === 'new');
    B.forward();
    ok('Forward → Listing Health', B.tabNow() === 'health');
    B.typeHash('#sales');
    ok('a typed #tab this account may not see is ignored', B.tabNow() === 'health');
    B.typeHash('#img');
    ok('a typed #img opens Image Manager', B.tabNow() === 'img');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
