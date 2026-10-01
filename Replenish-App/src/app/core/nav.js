/* ---------- the sidebar: collapsible groups + a hamburger ---------- */
const NAV_GROUPS = [...document.querySelectorAll('.navgrp')].map(head => ({
  key: head.dataset.grp,
  head,
  sec: $('sec' + head.dataset.grp.charAt(0).toUpperCase() + head.dataset.grp.slice(1)),
  tabs: (head.dataset.tabs || '').split(',').filter(Boolean),
}));
function setGroupOpen(g, open) {
  g.head.classList.toggle('open', open);
  g.head.setAttribute('aria-expanded', String(open));
  g.sec.classList.toggle('open', open);
  /* The mega menu hangs from the bar, not from its heading: the bar can wrap to two rows. */
  if (open && g.sec.classList.contains('navmega') && g.head.getBoundingClientRect)
    g.sec.style.top = Math.round(g.head.getBoundingClientRect().bottom + 7) + 'px';
}
/* A MENU IS NOT A SHAPE TO REMEMBER. A sidebar's open group was worth keeping between visits; a
 * dropdown that opened by itself on load would be a panel over the work nobody asked for. */
function saveGroups() { /* nothing to remember: menus open on a click and close on the next one */ }
/* ONE GROUP OPEN AT A TIME (Ravi, 2026-09-22: "grid bahut lamba h — kam se kam show ho"). Opening a
 * heading folds the others; the group of the screen you are on opens by itself. */
NAV_GROUPS.forEach(g => g.head.onclick = () => {
  const opening = !g.head.classList.contains('open');
  NAV_GROUPS.forEach(x => setGroupOpen(x, x === g ? opening : false));
  saveGroups();
});
/**
 * Say which menu the screen you are on belongs to — and close every menu.
 *
 * On a sidebar this opened the group so its items stayed visible. A menu bar is the other way
 * round: the panel is in front of the work, so it goes as soon as a screen is picked, and the
 * heading is marked instead.
 */
/**
 * The row under the menu, kept only while something is actually in it.
 *
 * A flex row with nothing visible inside is still a margin, and on thirty screens that was thirty
 * empty gaps. Whoever puts something up there — a screen's own line, its own button — gets the row
 * back by having put something in it.
 */
function topbarSync() {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  const alive = [...bar.children].some(el => el.id !== 'pageTitle' && el.id !== 'hambBtn'
    && !el.classList.contains('hide') && (el.textContent.trim() || el.querySelector('button:not(.hide)')));
  bar.classList.toggle('hide', !alive);
}

/** The screen named in the address ("#fab"), or '' — only a screen this app has. */
function navHashTab() {
  const h = String((typeof location !== 'undefined' && location.hash) || '').replace(/^#\/?/, '').trim();
  return /^[a-z]+$/.test(h) && (typeof TAB_NAV_IDS === 'undefined' || TAB_NAV_IDS.indexOf(h) >= 0 || h === 'shopprod') ? h : '';
}
/* Every screen key with a menu link — the same list showTab keys its table on. */
const TAB_NAV_IDS = ["repl","article","target","follow","top","india","shopify","prod","pack","att","pmdb","mst","pbase","pcut","ppress","qc","ord","so","vord","vreq","rfd","vend","vlog","cx","palloc","fgi","fba","fab","acc","rep","pa","ka","hr","shop","adj"];

/* A Ctrl/Cmd/Shift click opens the link in a new tab or window; it must not ALSO switch this one. The
 * item's own click handler is on the link, so it is stopped here, on the way down. */
document.querySelector('.side') && document.querySelector('.side').addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a.nav');
  if (a && (e.ctrlKey || e.metaKey || e.shiftKey || e.button > 0)) e.stopPropagation();
}, true);
/* The address changed by hand, or by Back: follow it, once. */
window.addEventListener('hashchange', () => {
  const t = navHashTab();
  if (t && t !== TAB_NOW && ME && ME.tabs && ME.tabs.length) showTab(t);
});

function navOpenFor(tab) {
  const g = NAV_GROUPS.find(x => x.tabs.includes(tab));
  NAV_GROUPS.forEach(x => {
    setGroupOpen(x, false);
    x.head.classList.toggle('here', !!g && x === g);
  });
}
/* A menu closes when something is picked from it, when the page is clicked, and on Escape. */
NAV_GROUPS.forEach(g => g.sec.addEventListener('click', e => {
  if (e.target.closest('.nav')) NAV_GROUPS.forEach(x => setGroupOpen(x, false));
}));
document.addEventListener('click', e => {
  if (e.target.closest('.navgrp') || e.target.closest('.navsec')) return;
  NAV_GROUPS.forEach(x => setGroupOpen(x, false));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') NAV_GROUPS.forEach(x => setGroupOpen(x, false));
});
NAV_GROUPS.forEach(g => setGroupOpen(g, false));
/** Drop a heading whose whole section this account cannot reach. */
function syncNavGroups() {
  const may = t => !ME.tabs || !ME.tabs.length || ME.tabs.includes(t);
  NAV_GROUPS.forEach(g => {
    const dead = !g.tabs.some(may);
    g.head.classList.toggle('hide', dead);
    g.sec.classList.toggle('hide', dead);
  });
}

/* The hamburger hides the sidebar outright on a wide screen and slides it over the page on a narrow
 * one — same button, and the CSS decides which. Only the wide-screen choice is worth remembering. */
const NARROW = () => window.matchMedia('(max-width:900px)').matches;
function setNavOpen(open, remember) {
  $('appView').classList.toggle('navshut', !open);
  $('hambBtn').setAttribute('aria-expanded', String(open));
  if (remember !== false && !NARROW()) {
    try { localStorage.setItem('replNavShut', open ? '0' : '1'); } catch (e) {}
  }
}
$('hambBtn').onclick = () => setNavOpen($('appView').classList.contains('navshut'));
$('navClose').onclick = () => setNavOpen(false);
$('navScrim').onclick = () => setNavOpen(false);
(() => {
  /* ALWAYS OPEN (Ravi, 2026-09-25). The menu is the bar across the top and nothing on screen can bring it
   * back once shut, so it is never shut: not by a "closed" remembered from the old sidebar — which is what
   * hid it on a store account's phone — and not by a narrow screen. The stale memory is cleared. */
  try { localStorage.removeItem('replNavShut'); } catch (e) {}
  setNavOpen(true, false);
})();

/**
 * The only section a vendor can actually use.
 *
 * Everything else reads a node the rules refuse them — History reads every printer's orders, Base
 * Data and the rest read the factory's registers — so granting one produces a screen that can only
 * say "permission denied". Their own work, their own orders and their own delivery history are all
 * in the portal, on its three tabs.
 */
const VENDOR_TABS = ['vend'];

/**
 * Take the sections a vendor cannot use off their screen, and move them somewhere that works.
 *
 * Called once the database has confirmed this sign-in really is a printer. It changes what is on
 * screen, never what is stored.
 */
function vendorOnlyTabs() {
  const keep = (ME.tabs || []).filter(t => VENDOR_TABS.indexOf(t) >= 0);
  ME.tabs = keep.length ? keep : VENDOR_TABS.slice();
  Object.entries(NAV_MAP).forEach(([t, id]) => {
    const el = $(id);
    if (el) el.style.display = ME.tabs.indexOf(t) >= 0 ? '' : 'none';
  });
  /* If they are already reading a refusal on one of those screens, move them off it. */
  if (TAB_NOW && ME.tabs.indexOf(TAB_NOW) < 0) showTab(ME.tabs[0]);
  syncNavGroups();
}

/**
 * Is this sign-in a vendor? Hides the Vendor Portal until it is known to be one.
 *
 * EXCEPT WHEN SOMEBODY DELIBERATELY GRANTED IT. Being allowed to open the portal and being a vendor
 * are two different things: the first is ticked in Sellora, the second is a row written by "Set up"
 * on the Printers screen. An account with the first and not the second used to lose the tab without
 * a word and get bounced to whatever screen came first — which is how a printer ended up looking at
 * the Replenishment planning board. The portal's own message explains this properly; hiding the tab
 * is what stopped anyone reading it.
 */
async function hideVendTabUnlessVendor() {
  const el = $('tabVend');
  if (!el) return;
  // A cellphone-and-PIN sign-in is a vendor by construction — no read needed.
  if (vpOnPin()) { if (!ME.admin) vendorOnlyTabs(); return; }
  el.style.display = 'none';
  try {
    const own = await ptGet('pt_vendorByEmail/' + vpEmailKey(ME.email));
    const isVendor = !!(own && own.code);
    const rule = vendTabRule(isVendor);
    if (rule !== 'no') el.style.display = '';     // 'ask' lets them in, so the pane can explain itself
    else if (VEND_WAS_ON) showTab(ME.tabs[0]);
    /* AND NOTHING ELSE. A staff screen granted to a printer cannot read what it needs, so it can
     * only ever show them a permission error with their name on it. */
    if (isVendor && !ME.admin) vendorOnlyTabs();
  } catch (e) {
    /* Could not tell. Left hidden: a portal that cannot say whose orders it is showing is worse
     * than a missing tab. */
  }
  syncNavGroups();
}
/* Whether the portal was the tab on screen when the check finished — if it was, and this account is
 * not a vendor, it has to be moved off it rather than left looking at an error. */
let VEND_WAS_ON = false;

/** Uncover the app. Safe to call more than once, and called on every way out of the gating. */
function ungate() { try { document.body.classList.remove('gating'); } catch (e) { /* nothing to do */ } }

$('verifyOut').onclick = () => signOut(auth);
$('verifySend').onclick = async () => {
  const u = auth.currentUser; if (!u) return;
  const msg = $('verifyMsg');
  $('verifySend').disabled = true; msg.className = 'muted'; msg.textContent = 'Sending…';
  try {
    await sendEmailVerification(u);
    msg.textContent = 'Sent to ' + u.email + '. Open the link, then press "I have confirmed it". '
      + 'Look in the spam folder too — it arrives from Firebase, not from us.';
  } catch (e) {
    /* Firebase refuses a flood of these, and "nothing happened" would read as a broken button. */
    msg.className = 'err';
    msg.textContent = /too-many-requests/.test(e.code || '')
      ? 'One has already gone out. Wait a minute, then look again — including in the spam folder.'
      : 'Could not send it: ' + (e.message || e);
  }
  $('verifySend').disabled = false;
};
$('verifyAgain').onclick = async () => {
  const u = auth.currentUser; if (!u) return;
  const msg = $('verifyMsg');
  $('verifyAgain').disabled = true; msg.className = 'muted'; msg.textContent = 'Checking…';
  try {
    /* The flag is on the token this page is holding, and confirming happens in a different tab. A
     * reload is the only thing that brings the new answer back. */
    await u.reload();
    if (auth.currentUser && auth.currentUser.emailVerified) { location.reload(); return; }
    msg.className = 'err';
    msg.textContent = 'Not confirmed yet. Open the link in the email first — then press this again.';
  } catch (e) { msg.className = 'err'; msg.textContent = 'Could not check: ' + (e.message || e); }
  $('verifyAgain').disabled = false;
};

/* ---------- tabs ---------- */
/** Every section, and the sidebar button that opens it. One map, used wherever buttons are shown. */
const NAV_MAP = { repl: 'tabRepl', article: 'tabArticle', target: 'tabTarget', follow: 'tabFollow',
  top: 'tabTop', india: 'tabIndia', shopify: 'tabShopify', prod: 'tabProd', pack: 'tabPack',
  pmdb: 'tabPmdb', mst: 'tabMst', pbase: 'tabPbase', pcut: 'tabPcut', ppress: 'tabPpress', qc: 'tabQc',
  ord: 'tabOrd', so: 'tabSo', vord: 'tabVord', vreq: 'tabVreq', rfd: 'tabRfd', vend: 'tabVend', vlog: 'tabVlog', cx: 'tabCx',
  palloc: 'tabPalloc', fgi: 'tabFgi', fba: 'tabFba', fab: 'tabFab', acc: 'tabAcc', rep: 'tabRep', pa: 'tabPa', ka: 'tabKa', att: 'tabAtt', hr: 'tabHr',
  shop: 'tabShop', adj: 'tabAdj' };

/** What is on screen right now — so a check that finishes late knows whether to move anybody. */
let TAB_NOW = '';

/**
 * The big tables, and the tab each one belongs to — emptied when that tab is left.
 *
 * EVERY TAB IN HERE MUST REDRAW WHEN IT IS OPENED. showTab calls an ensure* or a render* for each of
 * them on the way in; a prod-test rule checks that, because a tab added here without one would open
 * to a blank table and look broken. The Replenishment screen is deliberately absent: it draws once,
 * at sign-in, and has nothing to draw it again.
 */
const TAB_TABLES = {
  ord: ['odTable'], pbase: ['pbTable'], pcut: ['pcTable'], ppress: ['ppTable'], qc: ['qcTable'],
  fgi: ['fgTable'], fba: ['fbaTable'], vlog: ['vlTable'], so: ['soTable'], pmdb: ['pmTable'],
  acc: ['acTable'], vord: ['voTable'], fab: ['fbTable'], palloc: ['palTable'], mst: ['mstTable'],
};
/** Give the page back the megabyte the screen you just left was holding. */
function tabShed(prev) {
  (TAB_TABLES[prev] || []).forEach(id => { const el = $(id); if (el && el.innerHTML) el.innerHTML = ''; });
}

/** Holds the Shopify view of the order book, but not the order book itself. */
const SHOP_ONLY = () => !!(ME.tabs && ME.tabs.includes('shopprod') && !ME.tabs.includes('ord') && !ME.admin);

function showTab(which) {
  // 'shopprod' is not a pane of its own — it is the Order Console, opened at its Shopify views.
  if (which === 'shopprod') which = 'ord';
  if (ME.tabs && ME.tabs.length && !ME.tabs.includes(which)
      && !(which === 'ord' && ME.tabs.includes('shopprod'))) which = ME.tabs[0];
  const panes = { dash: 'paneDash', repl: 'paneRepl', article: 'paneArticle', target: 'paneTarget', follow: 'paneFollow', top: 'paneTop', india: 'paneIndia', shopify: 'paneShopify', prod: 'paneProd', pack: 'panePack', att: 'paneAtt', pmdb: 'panePmdb', mst: 'paneMst', pbase: 'panePbase', pcut: 'panePcut', ppress: 'panePpress', qc: 'paneQc', ord: 'paneOrd', so: 'paneSo', vord: 'paneVord', vreq: 'paneVreq', rfd: 'paneRfd', vend: 'paneVend', vlog: 'paneVlog', cx: 'paneCx', palloc: 'panePalloc', fgi: 'paneFgi', fba: 'paneFba', fab: 'paneFab', acc: 'paneAcc', rep: 'paneRep', pa: 'panePa', ka: 'paneKa', hr: 'paneHr', shop: 'paneShop', adj: 'paneAdj' };
  const navs = { dash: 'tabDash', repl: 'tabRepl', article: 'tabArticle', target: 'tabTarget', follow: 'tabFollow', top: 'tabTop', india: 'tabIndia', shopify: 'tabShopify', prod: 'tabProd', pack: 'tabPack', att: 'tabAtt', pmdb: 'tabPmdb', mst: 'tabMst', pbase: 'tabPbase', pcut: 'tabPcut', ppress: 'tabPpress', qc: 'tabQc', ord: 'tabOrd', so: 'tabSo', vord: 'tabVord', vreq: 'tabVreq', rfd: 'tabRfd', vend: 'tabVend', vlog: 'tabVlog', cx: 'tabCx', palloc: 'tabPalloc', fgi: 'tabFgi', fba: 'tabFba', fab: 'tabFab', acc: 'tabAcc', rep: 'tabRep', pa: 'tabPa', ka: 'tabKa', hr: 'tabHr', shop: 'tabShop', adj: 'tabAdj' };
  /* Before anything is shown: hand back what the screen being left was holding. */
  if (TAB_NOW && TAB_NOW !== which) tabShed(TAB_NOW);
  Object.entries(panes).forEach(([k, id]) => $(id).classList.toggle('hide', which !== k));
  Object.entries(navs).forEach(([k, id]) => $(id).classList.toggle('on', which === k));
  if (SHOP_ONLY() && which === 'ord') { $('pageTitle').textContent = 'Shopify Orders'; }
  const TITLES = { dash: 'Dashboard', repl: 'Replenishment', article: 'Article Review', target: 'Revenue Target', follow: 'Ongoing Purchase Order', top: 'Top ASIN Status', india: 'India Stock', shopify: 'Shopify Stock', prod: 'In Production', pack: 'Packing List', plan: 'Action Plan',
    att: 'Attendance', pmdb: 'Master Database', mst: 'Masters', pbase: 'Job Work Register', pcut: 'Cutting Data', ppress: 'Press Inventory', qc: 'Quality Control', ord: 'Order Console', so: 'Sales Orders', vord: 'Vendor Orders', vreq: 'Vendor Order Requests', rfd: 'RFD Requirements', vend: 'Vendor Portal', vlog: 'History — what printers have sent', cx: 'Customer Orders', palloc: 'Printer Allocation', fgi: 'Finished Goods', fba: 'FBA Dispatch', fab: 'Fabric Inventory', acc: 'Accessories', rep: 'Reports', pa: 'Production Analysis', ka: 'Karigar Analysis', hr: 'Finance & HR', shop: 'Shopify Orders', adj: 'Adjustments' };
  $('pageTitle').textContent = TITLES[which] || 'Replenishment';
  /* The line under a title, and the button that starts work, for the screens that have them. */
  const SUBS = { pbase: 'Track job work issued to karigars and manage receipts' };
  if ($('topSub')) { $('topSub').textContent = SUBS[which] || ''; $('topSub').classList.toggle('hide', !SUBS[which]); }
  if ($('bwToggle')) $('bwToggle').classList.toggle('hide', which !== 'pbase');
  VEND_WAS_ON = (which === 'vend');
  TAB_NOW = which;
  /* THE ADDRESS SAYS THE SCREEN, so a link to it — a new tab, a reload — opens here again. Replaced,
   * not pushed: Back is not a list of every tab visited. */
  try { if (location.hash !== '#' + which) history.replaceState(null, '', '#' + which); } catch (e) { /* only the address */ }
  navOpenFor(which);
  /* Nothing left up there on most screens — so there is no row. The ones that put their own line or
   * their own button there keep it. */
  topbarSync();
  /* The screen's name where a name belongs when it is not on the page: the browser tab. */
  try { document.title = ($('pageTitle').textContent || '') + ($('pageTitle').textContent ? ' · ' : '') + 'Ridhi Home & Living'; } catch (e) { /* nothing depends on it */ }
  /* There is no drawer to close any more: the menu is the bar across the top, on every width. */
  if (which === 'dash') ensureDash();
  /* THE REPLENISHMENT SCREENS READ THEIR OWN SNAPSHOT (2026-09-26). Sign-in used to read the full copy and draw the
   * table for them; since it reads only the slim one, a screen that did not ask for its data opened blank — Ravi:
   * "abhi bhi data blank hi show ho rha h". Each one asks here, and draws when it lands. */
  if (which === 'repl') ensureRepl();
  if (which === 'article') ensureReplData().then(renderArticle, renderArticle);
  if (which === 'target') ensureTarget();
  if (which === 'follow') ensureFollow();
  if (which === 'top') ensureReplData().then(ensureTop, ensureTop);
  if (which === 'india') ensureIndia();
  if (which === 'shopify') ensureReplData().then(ensureShopify, ensureShopify);
  if (which === 'prod') ensureProd();
  if (which === 'pack') ensurePack();
  if (which === 'att') ensureAtt();
  if (which === 'pmdb') ensurePmdb();
  if (which === 'mst') ensureMst();
  if (which === 'pbase') ptOpenFresh('pbase', ensurePbase);
  if (which === 'pcut') ptOpenFresh('pcut', ensurePcut);
  if (which === 'ppress') ptOpenFresh('ppress', ensurePpress);
  if (which === 'qc') ensureQc();
  if (which === 'ord') ptOpenFresh('ord', ensureOrd);
  if (which === 'so') ensureSox();
  if (which === 'vord') ensureVo();
  if (which === 'vreq') ensureVrq();
  if (which === 'rfd') ensureRfd();
  if (which === 'vend') ensureVp();
  if (which === 'vlog') ensureVlog();
  if (which === 'cx') ensureCx();
  if (which === 'palloc') ensurePal();
  /* The register is re-read every time the tab is opened — Refresh used to do this, and two people
   * entering stock on the same afternoon have to be able to see each other's work. */
  if (which === 'fgi') { FGI.rows = null; ensureFgi(); }
  if (which === 'fba') { FGI.rows = null; ensureFba(); }
  if (which === 'rep') ensureRep();
  if (which === 'pa' || which === 'ka') ensurePa();
  if (which === 'fab') ensureFab();
  if (which === 'acc') ensureAcc();
  if (which === 'hr') ensureHr();
  if (which === 'shop') ensureShop();
  if (which === 'adj') ensureAdj();
}
$('tabDash').onclick = () => showTab('dash');
$('tabRepl').onclick = () => showTab('repl');
$('tabArticle').onclick = () => showTab('article');
$('tabTarget').onclick = () => showTab('target');
$('tabFollow').onclick = () => showTab('follow');
$('tabTop').onclick = () => showTab('top');
$('tabIndia').onclick = () => showTab('india');
$('tabShopify').onclick = () => showTab('shopify');
$('tabProd').onclick = () => showTab('prod');
$('tabPack').onclick = () => showTab('pack');
$('tabAtt').onclick = () => showTab('att');
$('tabPmdb').onclick = () => showTab('pmdb');
$('tabMst').onclick = () => showTab('mst');
$('tabPbase').onclick = () => showTab('pbase');
$('tabPcut').onclick = () => showTab('pcut');
$('tabPpress').onclick = () => showTab('ppress');
$('tabQc').onclick = () => showTab('qc');
$('tabOrd').onclick = () => showTab('ord');
$('tabSo').onclick = () => showTab('so');
$('tabVord').onclick = () => showTab('vord');
$('tabVreq').onclick = () => showTab('vreq');
$('tabRfd').onclick = () => showTab('rfd');
$('tabVend').onclick = () => showTab('vend');
$('tabVlog').onclick = () => showTab('vlog');
$('tabCx').onclick = () => showTab('cx');
$('tabPalloc').onclick = () => showTab('palloc');
$('tabFgi').onclick = () => showTab('fgi');
$('tabFba').onclick = () => showTab('fba');
$('tabRep').onclick = () => showTab('rep');
$('tabPa').onclick = () => showTab('pa');
$('tabKa').onclick = () => showTab('ka');
$('tabFab').onclick = () => showTab('fab');
$('tabAcc').onclick = () => showTab('acc');
$('tabHr').onclick = () => showTab('hr');
$('tabShop').onclick = () => showTab('shop');
$('tabAdj').onclick = () => showTab('adj');

