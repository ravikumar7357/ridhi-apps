/* ================= THE PHONE LAYOUT (2026-10-16) =================
 *
 * Ravi: "I want to make the same kind of execution way I am having with the erp website I want it be a app with perfect
 * working and executable and responsive and something that is for mobile users". So a phone gets a phone screen: the
 * same app, the same sign-in, the same data and the same buttons, laid out for a thumb.
 *
 * WHAT CHANGES ON A PHONE (only while <html> carries .mob — set in index.html's head, phones only):
 *   - the menu bar across the top goes; a bar of five tabs sits at the bottom instead:
 *       Home (the dashboard) · Orders (Shopify Orders) · Scan (Scan to pack) · Stock (Finished Goods) · More
 *     A tab this account cannot open is not drawn — the same rule the menu uses (syncNavGroups).
 *   - More opens every other screen this account has, under the same group names as the menu, with the same counts.
 *     Guide, Install app, Sign out and Desktop view are at its foot.
 *   - a header across the top carries the screen's name.
 *   - Shopify Orders draws each order as a card instead of a 19-column row (soCards, shopify/shopify-orders.js).
 *
 * WHAT DOES NOT CHANGE: a computer, a tablet, a wide window — <html> never gets .mob there. Every screen still opens
 * through showTab, so access, Back, and the address all behave exactly as on a computer.
 *
 * DESKTOP VIEW: under More. It writes localStorage mobView = 'off' and reloads, and the phone draws the old scaled
 * desktop layout again; "Phone view" at the end of that menu bar undoes it. */

/** True while the phone layout is on. A declaration, not a const: renderShop asks before this file has run. */
function mobOn() {
  try { return document.documentElement.classList.contains('mob'); } catch (e) { return false; }   // no page (the tests): never
}

/** The same test the head of the page makes, so "Phone view" is only offered on a phone. */
function mobIsPhone() {
  try { return Math.min(screen.width, screen.height) <= 600 && window.matchMedia('(pointer:coarse)').matches; } catch (e) { return false; }
}

const MOB_SVG = p => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const MOB_TABS = [
  { k: 'home', t: 'Home', tab: 'dash', ic: MOB_SVG('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>') },
  { k: 'orders', t: 'Orders', tab: 'shop', ic: MOB_SVG('<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>') },
  { k: 'scan', t: 'Scan', tab: 'pack', ic: MOB_SVG('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9v6M11 9v6M14 9v6M17 9v6"/>') },
  { k: 'stock', t: 'Stock', tab: 'fgi', ic: MOB_SVG('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>') },
  { k: 'more', t: 'More', tab: '', ic: MOB_SVG('<path d="M4 6h16M4 12h16M4 18h16"/>') },
];

/** May this account open that screen? The menu's own rule (syncNavGroups), plus the screens it lets in by another name. */
function mobMay(t) {
  if (!t) return true;
  if (typeof ME === 'undefined' || !ME || !ME.tabs || !ME.tabs.length) return true;
  if (ME.tabs.includes(t)) return true;
  if (t === 'ord' && ME.tabs.includes('shopprod')) return true;
  return false;
}

const mobEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/** Put the header, the tab bar and the More sheet on the page, once. */
function mobBuild() {
  if (!mobOn() || $('mobBar')) return;
  const app = $('appView'), main = document.querySelector('.main');
  if (!app || !main) return;
  const head = document.createElement('div');
  head.id = 'mobHead';
  head.innerHTML = '<span class="mob-brand">Ridhi</span><b id="mobTitle"></b>';
  main.insertBefore(head, main.firstChild);

  const bar = document.createElement('nav');
  bar.id = 'mobBar';
  bar.setAttribute('aria-label', 'Main');
  bar.innerHTML = MOB_TABS.map(x => `<button type="button" class="mob-tab" data-mob="${x.k}">${x.ic}<span>${x.t}</span></button>`).join('');
  app.appendChild(bar);
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-mob]');
    if (b) mobGo(b.dataset.mob);
  });

  /* Named …Modal with a …Close button, so the phone's Back closes it like any other window (nav.js, NAV_POPS). */
  const sheet = document.createElement('div');
  sheet.id = 'mobMoreModal';
  sheet.className = 'mob-sheet hide';
  sheet.innerHTML = '<div class="mob-sheet-in" role="dialog" aria-label="More screens">'
    + '<div class="mob-sheet-h"><b>All screens</b><button type="button" id="mobMoreClose" class="mob-x" aria-label="Close">✕</button></div>'
    + '<div id="mobMoreList"></div></div>';
  document.body.appendChild(sheet);
  sheet.addEventListener('click', e => {
    if (e.target === sheet) { mobMoreShut(); return; }
    const a = e.target.closest('[data-mob-tab]');
    if (a) { mobMoreShut(); showTab(a.dataset.mobTab); window.scrollTo(0, 0); return; }
    const act = e.target.closest('[data-mob-act]');
    if (act) mobAct(act.dataset.mobAct);
  });
  $('mobMoreClose').onclick = mobMoreShut;
}

/** A tab was pressed. */
function mobGo(k) {
  const x = MOB_TABS.find(t => t.k === k);
  if (!x) return;
  if (k === 'more') { mobMoreOpen(); return; }
  /* Scan opens the camera straight away — on the Packing List, where the list it builds is kept and printed from. */
  if (k === 'scan') {
    if (TAB_NOW !== 'pack') showTab('pack');
    if (typeof pksOpen === 'function') pksOpen();
    return;
  }
  showTab(x.tab);
  window.scrollTo(0, 0);
}

/** Light the tab for this screen, carry its name in the header, and hide the tabs this account cannot open. */
function mobSync(which) {
  if (!mobOn()) return;
  mobBuild();
  if (!$('mobBar')) return;
  if ($('mobTitle')) $('mobTitle').textContent = ($('pageTitle') && $('pageTitle').textContent) || '';
  const here = { dash: 'home', shop: 'orders', pack: 'scan', fgi: 'stock' }[which] || 'more';
  $('mobBar').querySelectorAll('[data-mob]').forEach(b => {
    const x = MOB_TABS.find(t => t.k === b.dataset.mob);
    b.classList.toggle('hide', !mobMay(x.tab));
    b.classList.toggle('on', b.dataset.mob === here);
  });
}

/** Every screen this account has, under the menu's own group names, drawn from the menu itself so the two never differ. */
function mobMoreOpen() {
  const may = a => {
    const k = String(a.getAttribute('href') || '').replace(/^#/, '');
    if (!k || a.classList.contains('hide') || a.style.display === 'none') return false;
    return mobMay(k) || k === 'flow' || k === 'gdesk';     // these two show their link only to whoever may open them
  };
  const groups = [...document.querySelectorAll('.side .navwrap')].map(w => {
    const head = w.querySelector('.navgrp');
    if (!head || head.classList.contains('hide')) return '';
    const links = [...w.querySelectorAll('a.nav')].filter(may);
    if (!links.length) return '';
    const name = String(head.textContent || '').replace(/[▸▾]/g, '').trim();
    return `<div class="mob-grp"><div class="mob-grp-h">${mobEsc(name)}</div>` + links.map(a => {
      const k = a.getAttribute('href').replace(/^#/, '');
      const t = a.querySelector('.nav-t') ? a.querySelector('.nav-t').textContent : [...a.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
      const bd = [...a.querySelectorAll('.navbadge')].filter(b => !b.classList.contains('hide') && String(b.textContent || '').trim())
        .map(b => `<span class="mob-bd"${b.style.background ? ` style="background:${mobEsc(b.style.background)}"` : ''}>${mobEsc(b.textContent.trim())}</span>`).join('');
      return `<button type="button" class="mob-link${k === TAB_NOW ? ' on' : ''}" data-mob-tab="${mobEsc(k)}"><span>${mobEsc(String(t).trim())}</span>${bd}</button>`;
    }).join('') + '</div>';
  }).join('');
  const install = $('installBtn') && !$('installBtn').classList.contains('hide');
  $('mobMoreList').innerHTML = groups
    + '<div class="mob-grp mob-foot">'
    + '<button type="button" class="mob-link" data-mob-act="guide"><span>Guide · गाइड</span></button>'
    + (install ? '<button type="button" class="mob-link" data-mob-act="install"><span>Install app</span></button>' : '')
    + '<button type="button" class="mob-link" data-mob-act="desktop"><span>Desktop view</span><span class="muted" style="font-size:12px">the computer layout, scaled</span></button>'
    + '<button type="button" class="mob-link mob-out" data-mob-act="logout"><span>Sign out</span></button>'
    + '</div>';
  $('mobMoreModal').classList.remove('hide');
}
function mobMoreShut() { if ($('mobMoreModal')) $('mobMoreModal').classList.add('hide'); }

/** The buttons at the foot of More: each presses the menu's own button, so it does exactly what that does. */
function mobAct(a) {
  mobMoreShut();
  if (a === 'guide' && $('guideBtn')) $('guideBtn').click();
  if (a === 'install' && $('installBtn')) $('installBtn').click();
  if (a === 'logout' && $('logoutBtn')) $('logoutBtn').click();
  if (a === 'desktop') { try { localStorage.setItem('mobView', 'off'); } catch (e) { /* nowhere to remember it */ } location.reload(); }
}

/* On a phone that chose Desktop view: the way back, at the end of the menu bar. */
(() => {
  if (mobOn() || !mobIsPhone() || typeof document.querySelector !== 'function') return;
  const foot = document.querySelector('.sidefoot');
  if (!foot || $('mobBack')) return;
  const b = document.createElement('button');
  b.id = 'mobBack'; b.className = 'nav'; b.type = 'button'; b.textContent = 'Phone view';
  b.title = 'Lay this app out for a phone again';
  b.onclick = () => { try { localStorage.removeItem('mobView'); } catch (e) { /* the default is the phone layout */ } location.reload(); };
  foot.insertBefore(b, foot.firstChild);
})();

mobBuild();
