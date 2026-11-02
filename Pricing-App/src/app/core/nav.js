/* ================= CORE · NAV: the tab list, the sidebar menu and switching screens =================
 * Screens: the sidebar (tab buttons in collapsible groups, the hamburger button, the guide button) and
 * the page title; every screen is opened through showTab.
 * Does: names every tab (TABS, TAB_TITLE, HIDDEN_TABS, TAB_INHERIT); reads the menu groups off the markup
 * (NAV_GROUPS) and opens and closes them; shows and hides the sidebar (setNavOpen); and switches screens
 * (showTab), which also calls each screen's ensure… loader so a screen loads when first opened.
 * Main functions: capId, setGroupOpen, syncNavGroups, setNavOpen, showTab. */

/* ---------- tabs ---------- */
// Every tab by key. Button id = 'tab' + capId(key), pane id = 'pane' + capId(key). The order matters only
// for which tab opens first: the first one the account is allowed.
const TABS = ['link', 'new', 'pr', 'sales', 'profit', 'sa', 'plaudit', 'shop', 'adj', 'kw', 'ba', 'age', 'health',
  'lrules', 'audit', 'bsr', 'weekly', 'ppcn', 'trends', 'st', 'plc', 'deals', 'tiktok', 'carousel', 'opt', 'img',
  'lerr', 'basket'];
// 'health' → 'Health': a tab key as it appears inside element ids.
const capId = t => t[0].toUpperCase() + t.slice(1);
// The title shown at the top of the page for each tab.
const TAB_TITLE = { link: 'By Amazon Link', new: 'New Product', pr: 'Product Research', kw: 'Keywords', ba: 'Analytics',
  age: 'Inventory Age', health: 'Listing Health', lrules: 'Listing Rules', audit: 'Listing Audit', bsr: 'BSR Audit',
  weekly: 'PPC & Organic', ppcn: 'PPC & Organic · New',
  trends: 'Ad Console', st: 'Search Terms', plc: 'Placement', deals: 'Deal Calendar', sales: 'Sales Dashboard',
  profit: 'Profit & Margin', sa: 'Sales Analysis', plaudit: 'Parent Listing Review', shop: 'Shopify Orders',
  adj: 'Adjustments', tiktok: 'TikTok Toolkit', carousel: 'Carousel Builder', opt: 'Listing Optimiser',
  img: 'Image Manager', lerr: 'Listing Errors', basket: 'Bought Together' };

// Tabs hidden from the sidebar. Everything (panes, JS, backend) stays wired up — take a name out of
// this list and that tab is back, no other change needed.
const HIDDEN_TABS = ['link', 'kw', 'ba'];
HIDDEN_TABS.forEach(t => $('tab' + capId(t)).classList.add('hide'));

// Tabs nobody is granted on their own: they come with another tab. PPC & Organic · New reads exactly
// the documents PPC & Organic reads, and the Firestore rules gate those on `weekly` — so granting the
// new tab by itself would only ever open an empty screen. Kept out of the Access form for that reason.
const TAB_INHERIT = { ppcn: 'weekly' };

/* ---------- sidebar: collapsible groups + the 3-line menu button ---------- */
// Read straight off the markup, so adding a group is an HTML edit and nothing here changes.
// (That note is about NAV_GROUPS below.) The guide button opens the guide in a new tab, at the screen on view.
$('guideBtn').onclick = () => window.open('/guide/' + (TAB_NOW ? '#' + TAB_NOW : ''), '_blank');

// The menu groups: one entry per .navgrp heading button in the sidebar, with its section of tab buttons.
const NAV_GROUPS = [...document.querySelectorAll('.navgrp')].map(heading => ({
  key: heading.dataset.grp,                          // 'research', 'sales', 'listing', …
  head: heading,                                     // the heading button
  sec: $('sec' + capId(heading.dataset.grp)),        // the section under it, holding the tab buttons
  tabs: heading.dataset.tabs.split(',') }));         // the tab keys inside the group

// Open or close one menu group (the heading and its section together).
function setGroupOpen(g, open) {
  g.head.classList.toggle('open', open);
  g.head.setAttribute('aria-expanded', String(open));
  g.sec.classList.toggle('open', open);
}
// Empty on purpose: the open groups were once remembered across visits and are not any more. Nothing calls it.
function saveGroups() { /* a menu is not a shape to remember */ }
/* ONE MENU OPEN AT A TIME, and it closes as soon as something is picked, the page is clicked, or
 * Escape is pressed. A panel hangs over the work, so it does not linger. */
// Click a heading: open its group (closing the others), or close it when it was the open one.
NAV_GROUPS.forEach(g => g.head.onclick = e => {
  e.stopPropagation();
  const opening = !g.head.classList.contains('open');
  NAV_GROUPS.forEach(grp => setGroupOpen(grp, grp === g ? opening : false));
});
// Picking a tab inside a group closes every group.
NAV_GROUPS.forEach(g => g.sec.addEventListener('click', e => {
  if (e.target.closest('.nav')) NAV_GROUPS.forEach(grp => setGroupOpen(grp, false));
}));
// So does a click anywhere else on the page …
document.addEventListener('click', e => {
  if (e.target.closest('.navgrp') || e.target.closest('.navsec')) return;
  NAV_GROUPS.forEach(grp => setGroupOpen(grp, false));
});
// … and the Escape key.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') NAV_GROUPS.forEach(grp => setGroupOpen(grp, false));
});
/* NOTHING IS RESTORED ON LOAD. A sidebar's open groups were worth remembering; a dropdown that
 * opened by itself would be a panel over the work nobody asked for. */
NAV_GROUPS.forEach(g => setGroupOpen(g, false));

// Drop a heading and its section once nothing inside them can be reached. Called with no argument
// for the HIDDEN_TABS pass, and again from applyPerms once the account's tabs are known.
function syncNavGroups(allowed) {
  NAV_GROUPS.forEach(g => {
    const dead = !g.tabs.some(t => !HIDDEN_TABS.includes(t) && (!allowed || allowed(t)));
    g.head.classList.toggle('hide', dead);
    g.sec.classList.toggle('hide', dead);
  });
}
syncNavGroups(null);

// The hamburger hides the sidebar outright on a wide screen and slides it over the page on a narrow
// one — same button, and the CSS decides which. Only the wide-screen choice is worth remembering.
// Is this the narrow (phone) layout, where the sidebar slides over the page?
const NARROW = () => window.matchMedia('(max-width:860px)').matches;
// Show or hide the sidebar. On a wide screen the choice is remembered (localStorage navShut) unless remember is false.
function setNavOpen(open, remember) {
  $('appView').classList.toggle('navshut', !open);
  $('hambBtn').setAttribute('aria-expanded', String(open));
  if (remember !== false && !NARROW()) {
    try { localStorage.setItem('navShut', open ? '0' : '1'); } catch (e) {}
  }
}
// The hamburger toggles the sidebar; the close button and the scrim (the shade over the page on a phone) close it.
$('hambBtn').onclick = () => setNavOpen($('appView').classList.contains('navshut'));
$('navClose').onclick = () => setNavOpen(false);
$('navScrim').onclick = () => setNavOpen(false);
// On load: closed on a phone; on a wide screen, as it was left (open unless navShut was saved as '1').
(() => {
  let shut = null;
  try { shut = localStorage.getItem('navShut'); } catch (e) {}
  setNavOpen(NARROW() ? false : shut !== '1', false);
})();

/* ---------- switching screens ---------- */
const FIRST_TAB = TABS.find(t => !HIDDEN_TABS.includes(t)) || 'new';
showTab(FIRST_TAB);                       // open on the first tab that's actually visible

// Settings is a PANE of its own, not a card wedged above the content — so nothing ever shifts or
// overlaps when it opens.
/* var, not let: showTab runs while the page is still being set up, before a let would exist. */
var TAB_NOW = '';
// Open one tab: mark its button, show its pane and hide every other pane and panel, set the page title,
// mark the menu group it sits in, and call its ensure… loader (each screen's own file) so it fills itself.
function showTab(which) {
  TAB_NOW = which;
  // --- buttons and panes ---
  TABS.forEach(t => {
    $('tab' + capId(t)).classList.toggle('on', which === t);
    $('pane' + capId(t)).classList.toggle('hide', which !== t);
  });
  $('settingsCard').classList.add('hide');
  $('accessCard').classList.add('hide');
  $('noAccess').classList.add('hide');
  $('toggleSettings').classList.remove('on');
  $('pageTitle').textContent = TAB_TITLE[which] || '';
  // --- the menu ---
  // Never leave the open tab sitting inside a collapsed group, and on a phone get the drawer out of
  // the way now that a choice has been made.
  /* The menu that holds this screen is MARKED, not opened: opening it would drop a panel over the
   * screen somebody has just asked for. */
  const grp = NAV_GROUPS.find(g => g.tabs.includes(which));
  NAV_GROUPS.forEach(g => {
    setGroupOpen(g, false);
    g.head.classList.toggle('here', g === grp);
  });
  if (NARROW()) setNavOpen(false, false);
  // --- the screen's own loader: each ensure… lives in that screen's file and loads it on the first visit ---
  if (which === 'kw') loadNiches();       // lazy-load the niche list the first time
  if (which === 'age') ensureAge();       // show the cached snapshot without hitting Amazon
  if (which === 'health') ensureHealth();
  if (which === 'lrules') ensureLrules();
  if (which === 'audit') ensureAudit();
  if (which === 'bsr') ensureBsr();
  if (which === 'weekly') ensureWeekly();
  if (which === 'ppcn') ensurePpcn();
  if (which === 'trends') ensureTrends();
  if (which === 'st') ensureSt();
  if (which === 'plc') ensurePlc();
  if (which === 'deals') ensureDeals();
  if (which === 'sales') ensureSales();
  if (which === 'profit') ensureProfit();
  if (which === 'sa') ensureSa();
  if (which === 'plaudit') ensurePlaudit();
  if (which === 'opt') ensureOpt();
  if (which === 'img') ensureImg();
  if (which === 'lerr') ensureLerr();
  if (which === 'basket') ensureBasket();
  if (which === 'tiktok') ensureTiktok();
  if (which === 'carousel') ensureCarousel();
}
/* BOUND FROM THE TAB LIST, not one line per tab.
 *
 * These were fifteen hand-written lines, and adding a tab meant remembering to add a sixteenth. The
 * Adjustments tab shipped without one: the button was there, styled and permitted, and did nothing
 * at all — which reads as a broken app rather than a missing line. Driving it off TABS makes a new
 * tab clickable by existing. */
TABS.forEach(t => { $('tab' + capId(t)).onclick = () => showTab(t); });

