/* ================= PHONE APP, 17 Oct 2026: the live page + today's phone layout (Home, the phone lists, every other table as cards). Added after the page's own code; nothing above is changed. ================= */
MOB_TABS[0].tab = '';
mobGo = function (k) {
  const x = MOB_TABS.find(t => t.k === k);
  if (!x) return;
  if (k === 'more') { mobMoreOpen(); return; }
  /* Home is the phone's own screen: built for whoever is signed in (mobHomeShow, below). */
  if (k === 'home') {
    /* Home over a screen is a step of its own: the phone's Back goes back to that screen. */
    const h = $('paneMobHome');
    if (MOB_HIST_ON && (!h || h.classList.contains('hide'))) history.pushState({ mobHome: 1 }, '', location.href);
    mobHomeShow();
    return;
  }
  mobBuzz(8);
  /* Scan opens the camera straight away — on the Packing List, where the list it builds is kept and printed from. */
  if (k === 'scan') {
    if (TAB_NOW !== 'pack') showTab('pack');
    if (typeof pksOpen === 'function') pksOpen();
    return;
  }
  showTab(x.tab);
  window.scrollTo(0, 0);
};
mobSync = function (which) {
  if (!mobOn()) return;
  mobBuild();
  if (!$('mobBar')) return;
  /* A screen was opened: Home steps aside. The first screen after signing in on a phone is Home, unless the address
   * named a screen (a link, a reload). */
  mobHistInit();
  if ($('paneMobHome')) $('paneMobHome').classList.add('hide');
  if (!MOB_HOME_SEEN && which) { MOB_HOME_SEEN = true; if (!MOB_HASH0) setTimeout(() => { mobHomeShow(); mobMarkHome(); }, 0); }
  mobPaneIn(document.querySelector('.main > [id^="pane"]:not(.hide)'));
  if ($('mobTitle')) $('mobTitle').textContent = ($('pageTitle') && $('pageTitle').textContent) || '';
  const here = { dash: 'home', shop: 'orders', pack: 'scan', fgi: 'stock' }[which] || 'more';
  $('mobBar').querySelectorAll('[data-mob]').forEach(b => {
    const x = MOB_TABS.find(t => t.k === b.dataset.mob);
    b.classList.toggle('hide', !mobMay(x.tab));
    b.classList.toggle('on', b.dataset.mob === here);
  });
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { mobFitSync(); mobCardTables(); mobFabSync(); mobNetSync(); mobBackArrow(); mobToolsSync(); });
  mobRecentAdd(which);
};
mobMoreOpen = function () {
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
  $('mobMoreList').innerHTML = '<div class="ml-search mob-moreq"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="mobMoreQ" type="search" placeholder="Find a screen" autocomplete="off"></div>'
    + groups
    + '<div class="mob-grp mob-foot">'
    + '<button type="button" class="mob-link" data-mob-act="guide"><span>Guide · गाइड</span></button>'
    + (install ? '<button type="button" class="mob-link" data-mob-act="install"><span>Install app</span></button>' : '')
    + '<button type="button" class="mob-link" data-mob-act="alerts"><span>Turn on alerts</span><span class="muted" style="font-size:12px">a note when something needs you</span></button>'
    + '<button type="button" class="mob-link" data-mob-act="desktop"><span>Desktop view</span><span class="muted" style="font-size:12px">the computer layout, scaled</span></button>'
    + '<button type="button" class="mob-link mob-out" data-mob-act="logout"><span>Sign out</span></button>'
    + '</div>';
  /* the screens used last, on top (taken from the list above, so only screens this account may open) */
  const list = $('mobMoreList');
  let rec = [];
  try { rec = JSON.parse(localStorage.getItem(MOB_RECENT) || '[]'); } catch (e) { rec = []; }
  const btns = rec.filter(k => k !== TAB_NOW).map(k => list.querySelector('.mob-grp [data-mob-tab="' + k + '"]')).filter(Boolean).slice(0, 4);
  if (btns.length) {
    const g = document.createElement('div');
    g.className = 'mob-grp mob-recent';
    g.innerHTML = '<div class="mob-grp-h">Recent</div>';
    btns.forEach(b => g.appendChild(b.cloneNode(true)));
    list.insertBefore(g, list.children[1]);
  }
  $('mobMoreQ').oninput = mobMoreFilter;
  $('mobMoreModal').classList.remove('hide');
};
/* ================= EVERY OTHER TABLE, AS CARDS ON A PHONE (2026-10-17) =================
 *
 * Ravi: "these tables are really hard to view on the phones and less feasible to use, see and analyze on the regular basis".
 * Shopify Orders, Finished Goods and the Packing List have cards of their own. Every other table — Order Console, Sales
 * Orders, Job Work, Replenishment, Reports and the rest — is turned into cards here, as it is drawn: one card per row,
 * the first cell as its title, every other value on a line of its own with its column's name beside it, and empty
 * values ("—") left out. Nothing is redrawn and no click changes: the same cells, buttons and ticks, only laid out
 * differently (CSS on html.mob table.mob-tcards).
 *
 * A Cards | Table switch sits above each table, for the times the rows need to be compared side by side; the choice is
 * remembered per screen on that phone (localStorage mobTbl:<screen>). */
const MOB_OWN_CARDS = ['so-cards', 'fg-cards', 'pk-cards', 'mob-keep'];
/** The screen a table belongs to — across the Greige Desk's shadow root too, whose tables are not in the page's own tree. */
const mobPaneOf = t => { const p = t.closest('[id^="pane"]'); if (p) return p; const h = t.getRootNode && t.getRootNode().host; return h ? h.closest('[id^="pane"]') : null; };
/* a table in a window (the packing list editor, a dialog) keeps its Cards / Table choice under the window's name */
const MOB_WIN_SEL = '.modal, .ptmodal, [id$="Modal"], #ptDlg';
const mobTblKey = t => { const p = mobPaneOf(t), m = !p && t.closest(MOB_WIN_SEL); return 'mobTbl:' + (p ? p.id : m && m.id ? m.id : 'page'); };
function mobTblMode(t) { try { return localStorage.getItem(mobTblKey(t)) || 'cards'; } catch (e) { return 'cards'; } }

/** The name of every column, from the header — merged header cells (rowspan / colspan) included. */
function mobColNames(t) {
  const rows = t.tHead ? [...t.tHead.rows] : [];
  if (!rows.length) return [];
  const grid = [];
  rows.forEach((tr, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    [...tr.cells].forEach(cell => {
      while (grid[r][c] !== undefined) c++;
      const txt = String(cell.textContent || '').replace(/[↑↓]/g, '').replace(/\s+/g, ' ').trim();
      for (let i = 0; i < (cell.rowSpan || 1); i++) {
        grid[r + i] = grid[r + i] || [];
        for (let j = 0; j < (cell.colSpan || 1); j++) grid[r + i][c + j] = txt;
      }
      c += cell.colSpan || 1;
    });
  });
  const last = grid[rows.length - 1] || [];
  return last.map((v, i) => v || grid.map(g => g[i]).filter(Boolean).pop() || '');
}

/** Label one table's cells and mark it as cards (or leave it a table, if that is what this screen was set to). */
function mobCardTable(t) {
  if (!t) return;
  const pane = mobPaneOf(t);
  if (MOB_OWN_CARDS.some(c => t.classList.contains(c)) || t.closest('.mob-fit') || (pane && pane.classList.contains('mob-fit'))) {
    /* a screen with cards of its own (the same table can be either, e.g. Finished Goods' views): no switch over it */
    const box = t.closest('.xlwrap, .card') || t.parentElement, sw = box && box.previousElementSibling;
    if (sw && sw.classList.contains('mob-tsw')) sw.classList.add('hide');
    t.classList.remove('mob-tcards');
    return;
  }
  mobTblSwitch(t);
  const cards = mobTblMode(t) === 'cards';
  t.classList.toggle('mob-tcards', cards);
  /* COMPACT CARDS (phone-app-compact-cards zip, 17 Oct): picture beside the title, short values as tiles three to a row. */
  t.classList.toggle('mob-tgrid', cards && !t.matches('.fm-tab, .fm-sub, #pkEdBoxes'));
  if (!cards) return;
  const names = mobColNames(t);
  [...t.tBodies, t.tFoot].filter(Boolean).forEach(tb => [...tb.rows].forEach(tr => {
    const cells = [...tr.cells];
    tr.classList.toggle('mob-tmsg', cells.length === 1);
    /* a row that only holds another table (an opened detail: a fabric's products, a lot's movements) is not a card itself */
    tr.classList.toggle('mob-tnest', cells.length === 1 && !!cells[0].querySelector('table'));
    let c = 0, title = false;
    cells.forEach(td => {
      td.setAttribute('data-th', names[c] || '');
      /* a running number (#) is not worth a line on a card */
      td.classList.toggle('mob-sn', names[c] === '#');
      c += td.colSpan || 1;
      const txt = String(td.textContent || '').trim();
      const live = td.querySelector('input,select,textarea,button,img,svg,a,canvas,[data-img]');
      td.classList.toggle('mob-empty', !live && (!txt || /^[—–-]$/.test(txt)));
      const tick = td.querySelector('input[type=checkbox]') && !txt;
      td.classList.toggle('mob-tick', !!tick);
      /* the card's title: the frozen key column if the table has one, else its first cell with something in it */
      const isTitle = !title && !tick && names[c - (td.colSpan || 1)] !== '#' && !!txt && (td.classList.contains('frz') || !cells.some(x => x.classList.contains('frz') && String(x.textContent || '').trim()));
      td.classList.toggle('mob-tt', !!isTitle);
      if (isTitle) title = true;
      const pic = !txt && !!td.querySelector('img,canvas,[data-img]');
      td.classList.toggle('mob-timg', pic);
      const ctl = td.querySelector('input,select,textarea,button');
      td.classList.toggle('mob-tshort', !isTitle && !pic && !tick && !ctl && !!txt && txt.length <= 22 && !td.classList.contains('mob-empty') && String(names[c - (td.colSpan || 1)] || '').length <= 24);
    });
  }));
}

/** The Cards | Table switch, once per table, just above its box. */
function mobTblSwitch(t) {
  const box = t.closest('.xlwrap, .card') || t.parentElement;
  if (!box || !box.parentElement) return;
  let sw = box.previousElementSibling;
  if (!(sw && sw.classList.contains('mob-tsw'))) {
    sw = document.createElement('div');
    sw.className = 'mob-tsw';
    sw.innerHTML = '<button type="button" data-mob-tmode="cards">Cards</button><button type="button" data-mob-tmode="table">Table</button>';
    box.parentElement.insertBefore(sw, box);
    sw.onclick = e => {
      const b = e.target.closest('[data-mob-tmode]');
      if (!b) return;
      try { localStorage.setItem(mobTblKey(t), b.dataset.mobTmode); } catch (err) { /* this visit only */ }
      mobFitSync();
      mobCardTables();
      mobTableStep(mobPaneOf(t), b.dataset.mobTmode);
      if (b.dataset.mobTmode === 'table') mobPinchHint();
    };
  }
  sw.classList.remove('hide');
  const mode = mobTblMode(t);
  sw.querySelectorAll('[data-mob-tmode]').forEach(b => b.classList.toggle('on', b.dataset.mobTmode === mode));
}

/* Which tables become cards: the app's own (xl, tbl), and the Master Database's fabric view (fm-tab, its opened rows fm-sub). */
const MOB_TBL_SEL = 'table.xl, table.tbl, table.fm-tab, table.fm-sub';

/* ---- THE GREIGE DESK (Ravi, 17 Oct: "inventory is not proper in greige desk", "fabric ledger don't have any card view").
 * The desk draws itself inside a shadow root (flow/greige-desk.js gdMount), where neither the page's styles nor its
 * observer reach. So the card styles are copied into that root once, its own tables (Inventory, Ledger, the lot detail
 * under a figure) are turned into cards the same way, and its Table view shrinks the desk like any other screen. ---- */
let MOB_GD = null;
function mobGdSync() {
  const host = $('paneGdesk'), sr = host && host.shadowRoot;
  if (!sr || !mobOn()) return;
  if (!sr.getElementById('mobGdStyle')) {
    let css = '';
    [...document.styleSheets].forEach(sh => {
      let rules = [];
      try { rules = [...sh.cssRules]; } catch (e) { return; }
      rules.forEach(r => { const t = r.cssText || ''; if (/mob-(tcards|tsw|tnest|tmsg|sn|tt|tick|empty)/.test(t)) css += t.replace(/html\.mob\s+/g, '') + '\n'; });
    });
    css += ':host(.mob-fit) .gdroot{width:var(--mobw,1100px)!important;max-width:none!important;zoom:var(--mobz,.32)}\n'
      + '.ff-grid:has(> table.mob-tcards){overflow:visible!important}\n'
      + '.invdrop:has(table.mob-tcards){overflow:visible!important;max-width:none!important}\n';
    const st = document.createElement('style');
    st.id = 'mobGdStyle';
    st.textContent = css;
    sr.appendChild(st);
  }
  if (!MOB_GD || MOB_GD.root !== sr) {
    MOB_GD = { root: sr, q: false };
    new MutationObserver(muts => {
      if (MOB_GD.q || !muts.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && (/^(TR|TBODY|TABLE)$/.test(n.tagName) || (n.querySelector && n.querySelector('tr')))))) return;
      MOB_GD.q = true;
      requestAnimationFrame(() => { MOB_GD.q = false; mobGdCards(); });
    }).observe(sr, { childList: true, subtree: true });
  }
  mobGdCards();
}
function mobGdCards() {
  const sr = $('paneGdesk') && $('paneGdesk').shadowRoot;
  if (sr) sr.querySelectorAll('table.xl, table.ct').forEach(t => { try { mobCardTable(t); } catch (e) { /* that table stays a table */ } });
}

let MOB_TBL_Q = false;
function mobCardTables() {
  MOB_TBL_Q = false;
  if (!mobOn()) return;
  /* the screens' tables, and the tables inside windows (Ravi's phone, 17 Oct: the packing list's boxes and weights ran off
   the side of the window) */
  document.querySelectorAll(MOB_TBL_SEL.split(',').map(x => x.trim()).flatMap(x => ['.main ' + x].concat(MOB_WIN_SEL.split(',').map(w => w.trim() + ' ' + x))).join(', ')).forEach(t => { try { mobCardTable(t); } catch (e) { /* that table stays a table */ } });
  mobGdSync();
  mobFmFilters();
  mobToolsSync();
  mobFitSync();
}
/* Tables are drawn and redrawn by their screens at any time: label them once the drawing is done, at most once a frame. */
(() => {
  if (!mobOn() || typeof MutationObserver === 'undefined' || typeof document.querySelector !== 'function') return;
  const main = document.querySelector('.main');
  if (!main) return;
  new MutationObserver(muts => {
    if (MOB_TBL_Q) return;
    if (!muts.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && (n.tagName === 'TR' || n.tagName === 'TBODY' || n.tagName === 'TABLE' || (n.querySelector && n.querySelector('tr')))) || (m.target && m.target.tagName === 'TABLE'))) return;
    MOB_TBL_Q = true;
    requestAnimationFrame(() => { mobCardTables(); mobLists(); });
  }).observe(document.body, { childList: true, subtree: true });
})();

/* ================= THE PHONE LISTS (2026-10-17) =================
 *
 * Ravi: "I genuinely want the best layout for mobile users … meaningful … connected to my actual site design", then
 * "solve every problem". The screens used most on a phone get the layout phone apps use — neither cards nor tables:
 *   - HOME     what needs you now, then the figures, for whoever is signed in: an admin sees the management dashboard's
 *              figures (dashFacts), everybody else their own screens with what is waiting in them.
 *   - LISTS    Order Console (one line per order: its step, who has it, days — ordSheetRows), Job Work (one line per
 *              entry, Receive one tap — PT._pbaseRows) and Replenishment (the decision only: cover days and Air / Sea —
 *              R_ROWS_CACHE.view). Chips to narrow, a search box, 50 lines at a time with "Show more".
 *   - DETAIL   a tap opens the screen's own window (ordJourney, jwView) or, for Replenishment, a sheet of its figures.
 * Every line is drawn from the data the screen itself drew its table from, and every button calls the screen's own
 * function (jwRecvOpen, jwView, ordJourney, the "+ New Job Work" toggle), so nothing is counted or saved differently.
 * The computer layout of the screen is still there behind it: "Full screen" at the foot of each list shows it. */
var MOB_HOME_SEEN = false;
var MOB_HASH0 = (typeof location !== 'undefined' && location.hash) || '';
const MOBL = { ord: { step: '', src: '', q: '', cap: 50 }, pbase: { q: '', cap: 50 }, repl: { f: 'need', q: '', cap: 50 } };
const MOB_LIST_PANES = { ord: 'paneOrd', pbase: 'panePbase', repl: 'paneRepl' };
const mobFullKey = k => 'mobFull:' + k;
function mobFull(k) { try { return localStorage.getItem(mobFullKey(k)) === '1'; } catch (e) { return false; } }
const mobNum = v => (typeof nf === 'function' ? nf(v) : String(v));
const mobInit = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';

/** The list's own box at the top of its screen; the screen's computer layout behind it is hidden, not removed. */
function mobListBox(k) {
  const pane = $(MOB_LIST_PANES[k]);
  if (!pane) return null;
  let box = $('mobL-' + k);
  if (!box) {
    box = document.createElement('div');
    box.id = 'mobL-' + k;
    box.className = 'mob-list';
    pane.insertBefore(box, pane.firstChild);
    box.addEventListener('click', e => mobListClick(k, e));
    box.addEventListener('input', e => {
      const q = e.target.closest('[data-ml-q]');
      if (!q) return;
      MOBL[k].q = q.value;
      MOBL[k].cap = 50;
      clearTimeout(box._qt);
      box._qt = setTimeout(() => mobListDraw(k, true), 200);
    });
  }
  const full = mobFull(k);
  pane.classList.toggle('mob-listed', !full);
  box.classList.toggle('mob-list-off', full);
  return box;
}

/** Draw every list whose screen is on show. Called after any table of the page is drawn, and after a chip or search. */
function mobLists() {
  if (!mobOn()) return;
  Object.keys(MOB_LIST_PANES).forEach(k => {
    const pane = $(MOB_LIST_PANES[k]);
    if (pane && !pane.classList.contains('hide')) { try { mobListDraw(k); } catch (e) { /* the screen's own layout stays */ } }
  });
}
function mobListDraw(k, keepSearch) {
  if (k === 'repl' && typeof ME !== 'undefined' && ME.replShopView) return;   // the Shopify view of Replenishment keeps its own
  const box = mobListBox(k);
  if (!box) return;
  if (mobFull(k)) {
    box.innerHTML = `<button type="button" class="ml-fullback" data-ml-full="0">Back to the phone list</button>`;
    return;
  }
  const html = k === 'ord' ? mobOrdHtml() : k === 'pbase' ? mobJwHtml() : mobReplHtml();
  /* The search box keeps its focus and caret while the list under it is redrawn. */
  const q = box.querySelector('[data-ml-q]'), had = q && document.activeElement === q, pos = had ? q.selectionStart : 0;
  box.innerHTML = html + `<button type="button" class="ml-full" data-ml-full="1">Full screen (computer layout)</button>`;
  if (had || keepSearch) { const n = box.querySelector('[data-ml-q]'); if (n && had) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* not a text box */ } } }
}
const mobChip = (on, attr, label, n) => `<button type="button" class="ml-chip${on ? ' on' : ''}" ${attr}>${mobEsc(label)}${n == null ? '' : ` <b>${mobNum(n)}</b>`}</button>`;
const mobSearch = (k, ph) => `<div class="ml-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input data-ml-q type="search" value="${mobEsc(MOBL[k].q)}" placeholder="${mobEsc(ph)}" autocomplete="off"></div>`;
const mobMore = (k, shown, total) => total > shown
  ? `<button type="button" class="ml-more" data-ml-more="${k}">Show ${mobNum(Math.min(50, total - shown))} more · ${mobNum(shown)} of ${mobNum(total)}</button>` : '';
const mobEmpty = t => `<div class="ml-empty">${mobEsc(t)}</div>`;

/* ---- Order Console: one line per order ---- */
function mobOrdHtml() {
  let all;
  try { all = ordSheetRows(); } catch (e) { return mobEmpty('Reading the order book…'); }
  const S = MOBL.ord, q = S.q.trim().toLowerCase();
  const steps = ORD_SHEET_STEPS.filter(s => s[0] !== 'done').concat([ORD_SHEET_LATE]);
  const bySrc = all.filter(o => !S.src || ordSrcOf(o.orderNo) === S.src);
  const count = k => bySrc.filter(o => (k === 'late' ? o.late : k === '' ? o.step !== 'done' : o.step === k)).length;
  let rows = bySrc.filter(o => (S.step === 'late' ? o.late : S.step === 'done' ? o.step === 'done' : S.step ? o.step === S.step : o.step !== 'done'));
  if (q) rows = rows.filter(o => [o.orderNo, o.ref, o.who, o.sku].join(' ').toLowerCase().includes(q));
  rows = ordNewest(rows).sort((a, b) => (b.late - a.late));
  const srcs = [['', 'All'], ['SHP', 'Shopify'], ['AMZ', 'Amazon'], ['B2B', 'B2B']];
  const head = mobSearch('ord', 'Search order, SKU or karigar')
    + `<div class="ml-chips">${srcs.map(([v, l]) => mobChip(S.src === v, `data-ml-src="${v}"`, l)).join('')}</div>`
    + `<div class="ml-chips">${mobChip(S.step === '', 'data-ml-step=""', 'In the factory', count(''))}${steps.map(s => mobChip(S.step === s[0], `data-ml-step="${s[0]}"`, s[1].replace(/ — .*/, ''), count(s[0]))).join('')}${mobChip(S.step === 'done', 'data-ml-step="done"', 'Done')}</div>`
    + `<div class="ml-sum">${mobNum(rows.length)} order(s) · ${mobNum(rows.reduce((a, o) => a + o.pcs, 0))} pcs</div>`;
  const pill = st => { const x = ORD_SHEET_STEPS.find(y => y[0] === st) || ORD_SHEET_STEPS[0]; return `<span class="ml-pill" style="background:${x[3]};color:${x[2]}">${mobEsc(x[1])}</span>`; };
  const body = rows.slice(0, S.cap).map(o => `<button type="button" class="ml-row" data-ml-ord="${mobEsc(o.orderNo)}">`
    + `<span class="ml-dot" style="background:${o.late ? '#B91C1C' : (ORD_SHEET_STEPS.find(y => y[0] === o.step) || [0, 0, '#98A1AE'])[2]}"></span>`
    + `<span class="ml-m"><b>${mobEsc(o.ref || o.orderNo)} <span class="ml-soft">· ${mobEsc(ordPlatOf(o.orderNo, o.sku))}</span></b>`
    + `<small>${mobEsc([o.who, o.done].filter(Boolean).join(' · '))}</small></span>`
    + `<span class="ml-r">${o.late ? '<span class="ml-pill" style="background:#FDE8E7;color:#B91C1C">Late</span>' : pill(o.step)}`
    + `<small>${mobNum(o.pcs)} pcs${o.days == null ? '' : ' · ' + mobNum(o.days) + ' d'}</small></span></button>`).join('');
  return head + `<div class="ml-group">${body || mobEmpty(all.length ? 'No order here.' : 'No orders on the book yet.')}</div>` + mobMore('ord', Math.min(S.cap, rows.length), rows.length);
}

/* ---- Job Work: one line per entry, Receive one tap ---- */
function mobJwHtml() {
  if (PT.busy && PT.busy.base) return mobEmpty('Reading the production database…');
  const S = MOBL.pbase, all = PT._pbaseRows || [], q = S.q.trim().toLowerCase();
  const rows = q ? all.filter(r => [r.empName, r.sku, r.orderNo, r.articleSubtype, r.color, r.size, r.remarks].join(' ').toLowerCase().includes(q)) : all;
  const kpi = [['open', 'Open'], ['pending', 'Has pending'], ['done', 'Completed'], ['', 'All']];
  const head = `<button type="button" class="ml-primary" data-ml-new>${$('bwBox') && !$('bwBox').classList.contains('hide') ? 'Close the form' : '+ New Job Work'}</button>`
    + mobSearch('pbase', 'Search karigar, SKU, order')
    + `<div class="ml-chips">${kpi.map(([v, l]) => mobChip(PT_BD_KPI === v, `data-ml-kpi="${v}"`, l)).join('')}</div>`
    + `<div class="ml-sum">${mobNum(rows.length)} entr${rows.length === 1 ? 'y' : 'ies'} · ${mobNum(rows.reduce((a, r) => a + ptNum(r.pendingPieces), 0))} pcs pending</div>`;
  const body = rows.slice(0, S.cap).map(r => {
    const iss = ptNum(r.issuePieces), got = ptNum(r.receivedPieces), rej = ptNum(r.rejectionPieces), pend = ptNum(r.pendingPieces);
    const d = String(r.issueDate || '').split(/,\s*/)[0];
    const right = r.frozen ? '<span class="ml-pill ml-ok">Completed</span>'
      : `<span class="ml-act" data-ml-recv="${mobEsc(r.id)}" role="button">Receive</span>`;
    return `<div class="ml-row" data-ml-jw="${mobEsc(r.id)}" role="button" tabindex="0"><span class="ml-av">${mobEsc(mobInit(r.empName))}</span>`
      + `<span class="ml-m"><b>${mobEsc(r.empName || '')}</b><small>${mobEsc([r.sku, r.articleSubtype || r.articleType, [r.color, r.size].filter(Boolean).join(' • ')].filter(Boolean).join(' · '))}</small>`
      
      + `<small class="ml-wrap">${mobEsc(d)}${r.orderNo ? ' · ' + mobEsc(r.orderNo) : ''} · issued ${mobNum(iss)} · back ${mobNum(got)}${pend > 0 && !r.frozen ? ` · <em class="ml-warn">${mobNum(pend)} pending</em>` : ''}${rej ? ` · <em class="ml-bad">${mobNum(rej)} rejected</em>` : ''}</small></span>`
      + `<span class="ml-r">${right}</span></div>`;
  }).join('');
  return head + `<div class="ml-group">${body || mobEmpty((PT.base || []).length ? 'Nothing here.' : 'No issue / receive entries yet.')}</div>` + mobMore('pbase', Math.min(S.cap, rows.length), rows.length);
}

/* ---- Replenishment: the decision only ---- */
const MOB_REPL_F = [['need', 'Needs sending'], ['air', 'Air'], ['sea', 'Sea'], ['out', 'Out of stock'], ['top', 'Top sellers'], ['', 'All']];
function mobReplOk(r, f) {
  return f === 'need' ? !r.stopped && (r._req.air > 0 || r._req.sea > 0 || r._req.awd > 0)
    : f === 'air' ? r._req.air > 0 : f === 'sea' ? r._req.sea > 0 : f === 'out' ? r._state === 'out' : f === 'top' ? !!r._top : true;
}
function mobReplHtml() {
  const all = R_ALL_ROWS || [];
  if (!all.length) return mobEmpty('Reading the replenishment plan…');
  const S = MOBL.repl, q = S.q.trim().toLowerCase();
  let rows = all.filter(r => mobReplOk(r, S.f));
  if (q) rows = rows.filter(r => [r.sku, r.asin, r.color, r.size, r.subcat].join(' ').toLowerCase().includes(q));
  /* most urgent first: empty and selling, then the shortest cover; stopped ones last */
  const cov = r => (r._state === 'out' ? -1 : r.coverDos == null ? 1e9 : Number(r.coverDos));
  rows = rows.slice().sort((a, b) => (a.stopped - b.stopped) || (cov(a) - cov(b)) || ((Number(b.last90) || 0) - (Number(a.last90) || 0)));
  const head = mobSearch('repl', 'Search SKU, colour, size')
    + `<div class="ml-chips">${MOB_REPL_F.map(([v, l]) => mobChip(S.f === v, `data-ml-rf="${v}"`, l, all.filter(r => mobReplOk(r, v)).length)).join('')}</div>`
    + `<div class="ml-sum">${mobNum(rows.length)} SKU(s) · most urgent first · the full plan is on the computer</div>`;
  const body = rows.slice(0, S.cap).map(r => {
    const st = r._state, c = st === 'out' ? 'Out' : r.coverDos == null ? '—' : mobNum(r.coverDos) + ' d';
    const tone = st === 'out' ? 'ml-bad' : st === 'low' ? 'ml-warn' : 'ml-okt';
    const send = r.stopped ? '<span class="ml-pill ml-mute">Stopped</span>'
      : [r._req.air > 0 ? `<span class="ml-pill ml-air">Air ${mobNum(r._req.air)}</span>` : '', r._req.sea > 0 ? `<span class="ml-pill ml-sea">Sea ${mobNum(r._req.sea)}</span>` : '',
        r._req.awd > 0 ? `<span class="ml-pill ml-mute">AWD ${mobNum(r._req.awd)}</span>` : ''].join('') || '<span class="ml-soft">enough</span>';
    return `<button type="button" class="ml-row" data-ml-repl="${mobEsc(r.brand + '|' + r.sku)}">`
      + (r.image ? `<img class="ml-img" src="${mobEsc(typeof thumbUrl === 'function' ? thumbUrl(r.image) : r.image)}" alt="" loading="lazy">` : '<span class="ml-img"></span>')
      + `<span class="ml-m"><b>${mobEsc(r.sku)}${r._top ? ' <span class="ml-soft">★</span>' : ''}</b><small>${mobEsc([r.subcat, r.color, r.size].filter(Boolean).join(' · '))}</small>`
      + `<span class="ml-sends">${send}</span></span>`
      + `<span class="ml-r"><b class="${tone}">${c}</b><small>cover</small></span></button>`;
  }).join('');
  return head + `<div class="ml-group">${body || mobEmpty('No SKU here.')}</div>` + mobMore('repl', Math.min(S.cap, rows.length), rows.length);
}
/** One SKU's figures, as a sheet: what is there, what is selling, what to send. */
function mobReplDetail(key) {
  const [b, sku] = String(key).split('|'), r = (R_ALL_ROWS || []).find(x => x.brand === b && x.sku === sku);
  if (!r) return;
  const kv = (l, v) => `<div class="ml-kv"><span>${mobEsc(l)}</span><b>${v == null || v === '' ? '—' : v}</b></div>`;
  const n = v => (v ? mobNum(v) : '—');
  mobSheet(r.sku, [r.subcat, r.color, r.size, r.brand].filter(Boolean).join(' · '),
    (r.image ? `<img class="ml-big" src="${mobEsc(r.image)}" alt="">` : '')
    + `<div class="ml-figs"><div><small>Cover</small><b>${r._state === 'out' ? 'Out' : r.coverDos == null ? '—' : mobNum(r.coverDos) + ' d'}</b></div><div><small>Avg / day</small><b>${Number(r.avgSale) ? Number(r.avgSale).toFixed(1) : '—'}</b></div><div><small>Last 30 d</small><b>${n(r.last30)}</b></div></div>`
    + `<div class="ml-sec">Send</div>` + kv('Decision', mobEsc(r.stopped ? 'Stopped' : (r.decision || '—')))
    + kv('Air', n(r._req.air)) + kv('Sea', n(r._req.sea)) + kv('AWD', n(r._req.awd))
    + `<div class="ml-sec">Stock</div>` + kv('Total stock', n(r.totalStock)) + kv('Fulfillable', n(r.fulfillable)) + kv('AWD available', n(r.awdAvail))
    + kv('India stock', n(Number((INDIA_STOCK || {})[String(r.sku).toUpperCase()]) || 0))
    + `<div class="ml-sec">Sales</div>` + kv('Last 90 days', n(r.last90)) + kv('Category', mobEsc(r.category || '')) + kv('Status', mobEsc(r.status || '')));
}

/* ---- the sheet a list line opens (Replenishment; the other screens open their own windows) ---- */
function mobSheet(title, sub, html, same) {
  let s = $('mobDetailModal');
  if (!s) {
    s = document.createElement('div');
    s.id = 'mobDetailModal';
    s.className = 'mob-sheet hide';
    document.body.appendChild(s);
    s.addEventListener('click', e => {
      if (e.target === s || e.target.closest('#mobDetailClose')) {
        /* closed by hand (not by the phone's Back): the sheets under it close with it */
        if (e.isTrusted) { MOB_SHEET_STACK = []; MOB_STEPS = MOB_STEPS.filter(x => x.id !== 'sheet'); }
        s.classList.add('hide');
        return;
      }
      const sk = e.target.closest('[data-mob-sku]');
      if (sk) return mobSkuSheet(sk.dataset.mobSku);
      const sz = e.target.closest('[data-mob-size]');
      if (sz) return mobSizeDraw(sz.dataset.mobSize, true);
      const fg = e.target.closest('[data-sku-fgi]');
      if (fg) { const v = fg.dataset.skuFgi; s.classList.add('hide'); showTab('fgi'); setTimeout(() => { if ($('fgView')) { $('fgView').value = 'ledger'; $('fgQ').value = v; renderFgi(); } }, 150); return; }
      const md = e.target.closest('[data-sku-mdb]');
      if (md) { const v = md.dataset.skuMdb; s.classList.add('hide'); if (TAB_NOW !== 'pmdb') showTab('pmdb'); setTimeout(() => { try { fmToTable(v); } catch (err) { /* the Master Database is open */ } }, 150); }
    });
  }
  /* A sheet opened from a sheet (a size → one of its SKUs) is a step: Back shows the one before. `same` redraws in place. */
  if (!same && MOB_HIST_ON && !s.classList.contains('hide') && s.innerHTML) {
    MOB_SHEET_STACK.push(s.innerHTML);
    mobStep('sheet', () => { const h = MOB_SHEET_STACK.pop(); if (h != null) { s.innerHTML = h; s.classList.remove('hide'); } });
  } else if (!same) MOB_SHEET_STACK = [];
  s.innerHTML = `<div class="mob-sheet-in" role="dialog" aria-label="${mobEsc(title)}"><div class="mob-sheet-h"><span><b>${mobEsc(title)}</b><small class="ml-shsub">${mobEsc(sub)}</small></span>`
    + `<button type="button" id="mobDetailClose" class="mob-x" aria-label="Close">✕</button></div>${html}</div>`;
  s.classList.remove('hide');
}

/** A tap on a list: a chip, a line, its button, Show more, Full screen. */
function mobListClick(k, e) {
  const t = e.target, S = MOBL[k];
  const full = t.closest('[data-ml-full]');
  if (full) {
    try { localStorage.setItem(mobFullKey(k), full.dataset.mlFull); } catch (err) { /* this visit only */ }
    if (full.dataset.mlFull === '0') { try { localStorage.removeItem(mobFullKey(k)); } catch (err) { /* nothing kept */ } }
    mobListDraw(k); mobFitSync(); window.scrollTo(0, 0);
    /* Full screen is a step: the phone's Back brings the phone list back */
    if (full.dataset.mlFull === '1') mobStep('full:' + k, () => { try { localStorage.removeItem(mobFullKey(k)); } catch (err) { /* nothing kept */ } mobListDraw(k); mobFitSync(); });
    else mobStepDrop('full:' + k);
    return;
  }
  if (t.closest('[data-ml-more]')) { S.cap += 50; return mobListDraw(k); }
  const src = t.closest('[data-ml-src]'); if (src) { S.src = src.dataset.mlSrc; S.cap = 50; return mobListDraw(k); }
  const st = t.closest('[data-ml-step]'); if (st) { S.step = st.dataset.mlStep; S.cap = 50; return mobListDraw(k); }
  const rf = t.closest('[data-ml-rf]'); if (rf) { S.f = rf.dataset.mlRf; S.cap = 50; return mobListDraw(k); }
  const kp = t.closest('[data-ml-kpi]');
  if (kp) { PT_BD_KPI = kp.dataset.mlKpi; PT_BD_KPI_DEFAULT = false; S.cap = 50; return renderPbase(); }
  if (t.closest('[data-ml-new]')) {
    if ($('bwToggle')) $('bwToggle').click();
    setTimeout(() => { mobListDraw('pbase'); const b = $('bwBox'); if (b && !b.classList.contains('hide')) b.scrollIntoView({ block: 'start' }); }, 50);
    return;
  }
  const rc = t.closest('[data-ml-recv]'); if (rc) { e.stopPropagation(); return jwRecvOpen(rc.dataset.mlRecv); }
  const jw = t.closest('[data-ml-jw]'); if (jw) return jwView(jw.dataset.mlJw);
  const od = t.closest('[data-ml-ord]'); if (od) return ordJourney(od.dataset.mlOrd);
  const rp = t.closest('[data-ml-repl]'); if (rp) return mobReplDetail(rp.dataset.mlRepl);
}

/* ================= HOME: what needs you, for whoever is signed in ================= */
function mobHomePane() {
  let p = $('paneMobHome');
  if (!p) {
    p = document.createElement('div');
    p.id = 'paneMobHome';
    p.className = 'hide';
    const main = document.querySelector('.main');
    main.appendChild(p);
    p.addEventListener('click', e => {
      const act = e.target.closest('[data-home-act]');
      if (act) return mobHomeAct(act.dataset.homeAct);
      const hit = e.target.closest('[data-sr]');
      if (hit) return mobSearchOpen(hit.dataset.sr);
      if (e.target.closest('[data-sr-scan]')) return mobHomeAct('track');
      const g = e.target.closest('[data-home-go]');
      if (g) { showTab(g.dataset.homeGo); window.scrollTo(0, 0); }
      if (e.target.closest('[data-home-refresh]')) { if (typeof DASH !== 'undefined') DASH.at = ''; mobHomeShow(true); }
    });
    p.addEventListener('input', e => {
      const q = e.target.closest('[data-sr-q]');
      if (!q) return;
      MOB_SR.q = q.value;
      /* a search is a step: the phone's Back clears it and shows Home again */
      if (MOB_SR.q.trim() && !mobStepHas('search')) mobStep('search', () => { MOB_SR.q = ''; const box = document.querySelector('[data-sr-q]'); if (box) box.value = ''; mobSearchDraw(); });
      else if (!MOB_SR.q.trim()) mobStepDrop('search');
      clearTimeout(MOB_SR.t);
      MOB_SR.t = setTimeout(mobSearchDraw, 150);
    });
    p.addEventListener('focusin', e => { if (e.target.closest('[data-sr-q]')) mobSearchLoad(); });
  }
  return p;
}
async function mobHomeShow(fresh) {
  if (!mobOn()) return;
  const p = mobHomePane();
  document.querySelectorAll('.main [id^="pane"]').forEach(x => { if (x !== p) x.classList.add('hide'); });
  if (p.classList.contains('hide')) mobPaneIn(p);
  p.classList.remove('hide');
  if ($('mobTitle')) $('mobTitle').textContent = 'Home';
  mobBackArrow();
  mobFitSync();
  mobFabSync();
  if ($('mobBar')) $('mobBar').querySelectorAll('[data-mob]').forEach(b => b.classList.toggle('on', b.dataset.mob === 'home'));
  window.scrollTo(0, 0);
  mobHomeDraw();
  /* An admin's figures read every register; they are read once, then kept until Refresh (or a pull down on Home). */
  if (typeof ME !== 'undefined' && ME.admin && typeof ensureDash === 'function' && (fresh || !DASH.at)) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;      // offline: the last figures stay
    try { await ensureDash(); } catch (e) { /* the figures that came in are drawn */ }
    if (!p.classList.contains('hide')) mobHomeDraw();
  }
}

/* ---- what can be done straight from Home ---- */
const MOB_ACTS = [
  ['scan', 'Scan', 'pack', '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9v6M11 9v6M14 9v6M17 9v6"/>'],
  ['track', 'Which order?', 'pack', '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'],
  ['newjw', 'New job work', 'pbase', '<path d="M12 5v14M5 12h14"/>'],
  ['receive', 'Receive', 'pbase', '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M5 20h14"/>'],
  ['stock', 'Stock entry', 'fgi', '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'],
  ['sales', 'New sales order', 'so', '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>'],
];
function mobHomeAct(k) {
  const go = tab => { showTab(tab); window.scrollTo(0, 0); };
  if (k === 'scan') { go('pack'); if (typeof pksOpen === 'function') pksOpen(); return; }
  if (k === 'track') { go('pack'); if (typeof pksStart === 'function') pksStart('track'); else if (typeof pksOpen === 'function') pksOpen(); return; }
  if (k === 'newjw') { go('pbase'); setTimeout(() => { const b = $('bwBox'); if (b && b.classList.contains('hide') && $('bwToggle')) $('bwToggle').click(); setTimeout(() => mobListDraw('pbase'), 60); }, 120); return; }
  if (k === 'receive') { PT_BD_KPI = 'pending'; PT_BD_KPI_DEFAULT = false; go('pbase'); return; }
  if (k === 'stock') { go('fgi'); setTimeout(() => { if ($('fgEntry') && !$('fgEntry').classList.contains('hide')) $('fgEntry').click(); }, 150); return; }
  if (k === 'sales') { go('so'); setTimeout(() => { if ($('sxNew')) $('sxNew').click(); }, 150); return; }
  if (k === 'late') { MOBL.ord.step = 'late'; MOBL.ord.cap = 50; go('ord'); return; }
  if (k === 'fgpend') { go('fgi'); setTimeout(() => { if ($('fgView')) { $('fgView').value = 'pending'; renderFgi(); } }, 150); return; }
  if (k === 'fbawait') { go('fba'); return; }
}

/* ---- ONE SEARCH FOR EVERYTHING (2026-10-17) ----
 * Ravi: "one search for everything". From Home: any order, Shopify order, SKU, karigar, vendor or packing list this
 * account can open, found by any part of its number, name, SKU, colour or size, and opened in one tap — the order's
 * journey, the Shopify order, the SKU's stock and who wants it, the karigar's entries, the vendor's orders, the list.
 * It searches what the app has read; the first time the box is used it also reads the master, the packing lists and the
 * FNSKU list, so a scanned label finds its SKU. The camera button is Track order scan. */
const MOB_SR = { q: '', t: 0, loading: false, hits: {} };
async function mobSearchLoad() {
  if (MOB_SR.loading) return;
  MOB_SR.loading = true;
  const tries = [];
  if (typeof ptLoadGates === 'function' && !(PTG.mdb && PTG.mdb.length)) tries.push(ptLoadGates());
  if (typeof loadPk === 'function' && typeof PK_LOADED !== 'undefined' && !PK_LOADED) tries.push(loadPk());
  if (typeof fnLoad === 'function') tries.push(fnLoad());
  await Promise.all(tries.map(x => Promise.resolve(x).catch(() => null)));
  if (MOB_SR.q) mobSearchDraw();
}
function mobSearchAll(q) {
  const Q = q.trim().toUpperCase(), hit = s => String(s || '').toUpperCase().includes(Q), out = [];
  if (Q.length < 2) return out;
  const add = (group, items) => { if (items.length) out.push([group, items.slice(0, 6), items.length]); };
  /* a scanned FNSKU label: its SKU */
  const fn = typeof FN !== 'undefined' && FN.map ? FN.map.get(Q) : '';
  const skuQ = fn ? String(fn).toUpperCase() : '';
  const skuHit = s => hit(s) || (skuQ && String(s || '').toUpperCase() === skuQ);
  try {
    if (mobMay('ord') || mobMay('shopprod')) {
      const by = new Map();
      ordLines().forEach(l => { if ((hit(l.orderNo) || hit(l.shopOrderNo) || skuHit(l.sku)) && !by.has(l.orderNo)) by.set(l.orderNo, l); });
      add('Orders', [...by.values()].map(l => ({ id: 'ord|' + l.orderNo, t: l.shopOrderNo || l.orderNo, s: [l.shopOrderNo ? l.orderNo : '', l.src, l.orderDate].filter(Boolean).join(' · ') })));
    }
  } catch (e) { /* the order book is not read yet */ }
  try {
    if (mobMay('shop') && typeof SHOP !== 'undefined' && SHOP.orders) {
      add('Shopify orders', SHOP.orders.filter(o => hit(o.no) || hit(o.ship && o.ship.name) || (o.items || []).some(i => skuHit(i.sku)))
        .map(o => ({ id: 'shop|' + o.id, t: o.no, s: [o.ship && o.ship.name, o.at].filter(Boolean).join(' · ') })));
    }
  } catch (e) { /* not read */ }
  try {
    add('SKUs', (PTG.mdb || []).filter(r => r && (skuHit(r.sku) || hit(r.articleSubtype) || (Q.length > 2 && (hit(r.color) || hit(r.size)))))
      .map(r => ({ id: 'sku|' + r.sku, t: r.sku, s: [r.articleSubtype || r.articleType, r.color, r.size].filter(Boolean).join(' · '), img: r.sku })));
  } catch (e) { /* the master is not read yet */ }
  try {
    if (mobMay('pbase') && PT.base) {
      const names = new Map();
      PT.base.forEach(r => { const n = String(r.empName || '').trim(); if (n && hit(n)) { const x = names.get(n) || { open: 0, n: 0 }; x.n++; if (!r.frozen) x.open++; names.set(n, x); } });
      add('Karigars', [...names.entries()].map(([n, x]) => ({ id: 'kar|' + n, t: n, s: mobNum(x.open) + ' open of ' + mobNum(x.n) + ' entries' })));
    }
  } catch (e) { /* not read */ }
  try {
    if (mobMay('vord') && typeof VO !== 'undefined' && VO.rows) {
      const vs = new Map();
      VO.rows.forEach(o => { const name = typeof voName === 'function' ? voName(o.vendorCode) : o.vendorCode; if (o && (hit(name) || hit(o.vendorCode) || hit(o.poNo || o.id))) vs.set(name, (vs.get(name) || 0) + 1); });
      add('Vendors', [...vs.entries()].map(([n, c]) => ({ id: 'ven|' + n, t: n, s: mobNum(c) + ' vendor order(s)' })));
    }
  } catch (e) { /* not read */ }
  try {
    if (mobMay('pack') && typeof PK !== 'undefined') {
      add('Packing lists', PK.filter(p => hit(p.title) || hit(p.invoice) || hit(p.account) || (p.boxes || []).some(b => (b.items || []).some(i => skuHit(i.sku))))
        .map(p => ({ id: 'pk|' + p.id, t: p.title || '(untitled)', s: [p.date, p.account, p.status === 'done' ? 'completed' : 'open'].filter(Boolean).join(' · ') })));
    }
  } catch (e) { /* not read */ }
  return out;
}
function mobSearchDraw() {
  const res = $('mobSR'), body = $('mobHomeBody');
  if (!res) return;
  const q = MOB_SR.q.trim();
  if (body) body.classList.toggle('hide', !!q);
  if (!q) { res.innerHTML = ''; return; }
  const groups = mobSearchAll(q);
  res.innerHTML = groups.length ? groups.map(([g, items, n]) => `<div class="ml-sec">${mobEsc(g)}${n > items.length ? ` · ${mobNum(n)} found, the first ${items.length} shown` : ''}</div><div class="ml-group">`
    + items.map(x => `<button type="button" class="ml-row" data-sr="${mobEsc(x.id)}">${x.img ? `<span class="ml-img" data-img="${mobEsc(x.img)}" data-imgpx="44">${typeof ptImgInner === 'function' ? ptImgInner(x.img, 44) : ''}</span>` : ''}`
      + `<span class="ml-m"><b>${mobEsc(x.t)}</b><small>${mobEsc(x.s)}</small></span><span class="ml-chev">›</span></button>`).join('') + '</div>').join('')
    : mobEmpty(q.length < 2 ? 'Type at least two letters.' : MOB_SR.loading && !(PTG.mdb && PTG.mdb.length) ? 'Reading…' : 'Nothing found for “' + q + '”.');
}
function mobSearchOpen(id) {
  const i = id.indexOf('|'), k = id.slice(0, i), v = id.slice(i + 1);
  if (k === 'ord') return ordJourney(v);
  if (k === 'shop') { showTab('shop'); setTimeout(() => { try { openShopOrder(v); } catch (e) { /* the list is open */ } }, 150); return; }
  if (k === 'pk') { showTab('pack'); setTimeout(() => { try { pkOpen(v); } catch (e) { /* the list is open */ } }, 150); return; }
  if (k === 'kar') { MOBL.pbase.q = v; PT_BD_KPI = ''; PT_BD_KPI_DEFAULT = false; showTab('pbase'); return; }
  if (k === 'ven') { showTab('vord'); setTimeout(() => { const q = $('voQ'); if (q) { q.value = v; q.dispatchEvent(new Event('input', { bubbles: true })); } }, 150); return; }
  if (k === 'sku') return mobSkuSheet(v);
}
/** One SKU: its picture, the India store, and every open order or plan that wants it. */
function mobSkuSheet(sku) {
  const m = (typeof mdbOf === 'function' && mdbOf(sku)) || {};
  const img = typeof ptImgOf === 'function' ? ptImgOf(String(sku).toUpperCase()) : '';
  let store = null, rows = [];
  try { store = fgiOf(sku).current; } catch (e) { /* not read */ }
  try { rows = typeof pksWhoWants === 'function' ? pksWhoWants(sku) : []; } catch (e) { rows = []; }
  const left = rows.reduce((a, x) => a + x.left, 0);
  mobSheet(sku, [m.articleSubtype || m.articleType, m.color, m.size].filter(Boolean).join(' · '),
    (img ? `<img class="ml-big" src="${mobEsc(img)}" alt="">` : '')
    + `<div class="ml-figs"><div><small>India store</small><b>${store == null ? '—' : mobNum(store)}</b></div><div><small>Orders want</small><b>${mobNum(left)}</b></div><div><small>Short</small><b class="${store != null && left > store ? 'ml-bad' : ''}">${store == null ? '—' : mobNum(Math.max(0, left - store))}</b></div></div>`
    + (rows.length ? `<div class="ml-sec">Who wants it</div>` + rows.map(x => `<div class="ml-kv"><span>${mobEsc(x.no)} · ${mobEsc(x.what)}</span><b>${x.left ? mobNum(x.left) + ' left' : 'done'} <small class="ml-soft">of ${mobNum(x.qty)}</small></b></div>`).join('') : '<div class="ml-empty">No open order wants it.</div>')
    + (mobMay('fgi') ? `<button type="button" class="ml-primary" style="margin-top:12px" data-sku-fgi="${mobEsc(sku)}">Every movement in Finished Goods</button>` : '')
    + (typeof fmToTable === 'function' && mobMay('pmdb') ? `<button type="button" class="ml-more" style="margin-top:8px" data-sku-mdb="${mobEsc(sku)}">Open in the Master database</button>` : ''));
}

/* ---- HOME ---- */
const MOB_HOME_CACHE = 'mobHomeCache';
function mobHomeDraw() {
  const p = mobHomePane();
  const who = String((typeof ME !== 'undefined' && (ME.name || ME.email)) || '').split('@')[0];
  const hr = new Date().getHours(), hi = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const row = (tab, label, sub, num, tone, act) => mobMay(tab) ? `<button type="button" class="ml-row" ${act ? `data-home-act="${act}"` : `data-home-go="${tab}"`}><span class="ml-m"><b>${mobEsc(label)}</b>${sub ? `<small>${mobEsc(sub)}</small>` : ''}</span>`
    + `<span class="ml-r">${num == null ? '' : `<b class="${tone || ''}">${num}</b>`}</span><span class="ml-chev">›</span></button>` : '';
  const sec = (name, rows) => rows.replace(/\s/g, '') ? `<div class="ml-sec">${mobEsc(name)}</div><div class="ml-group">${rows}</div>` : '';
  /* keep what is being typed while Home redraws under it */
  const qEl = p.querySelector('[data-sr-q]'), typing = qEl && document.activeElement === qEl;
  let head = `<div class="ml-hello"><b>${mobEsc(hi)}${who ? ', ' + mobEsc(who) : ''}</b><small>${mobEsc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }))}</small></div>`
    + `<div class="ml-search ml-bigsearch"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`
    + `<input data-sr-q type="search" value="${mobEsc(MOB_SR.q)}" placeholder="Search order, SKU, karigar, vendor…" autocomplete="off">`
    + (mobMay('pack') ? `<button type="button" class="ml-scanbtn" data-sr-scan aria-label="Scan a label">${MOB_SVG('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9v6M11 9v6M14 9v6M17 9v6"/>')}</button>` : '') + '</div>'
    + '<div id="mobSR"></div>';
  /* the things this person does most, one tap each */
  const acts = MOB_ACTS.filter(([k, , tab]) => mobMay(tab) && (k !== 'stock' || !$('fgEntry') || !$('fgEntry').classList.contains('hide')));
  let body = acts.length ? `<div class="ml-acts">${acts.map(([k, l, , ic]) => `<button type="button" class="ml-actbtn" data-home-act="${k}">${MOB_SVG(ic)}<span>${mobEsc(l)}</span></button>`).join('')}</div>` : '';
  let need = '';
  /* what is waiting, from whatever this phone has read: late orders, pieces out with karigars, transfers to count in */
  let lateN = null;
  try { if (mobMay('ord') && typeof ordSheetRows === 'function' && typeof ORD !== 'undefined' && ORD.rows) lateN = ordSheetRows().filter(o => o.late).length; } catch (e) { lateN = null; }
  const pend = PT.base ? PT.base.filter(x => !x.frozen && ptNum(x.pendingPieces) > 0).length : null;
  if (typeof ME !== 'undefined' && ME.admin && typeof dashFacts === 'function') {
    let F = null;
    /* NEW FIGURES ARE KEPT ON THE PHONE, so Home opens with the last ones at once — and still shows them offline */
    if (DASH.at) { try { F = dashFacts(); localStorage.setItem(MOB_HOME_CACHE, JSON.stringify({ at: DASH.at, F })); } catch (e) { /* drawn, not kept */ } }
    let cachedAt = '';
    if (!F) { try { const c = JSON.parse(localStorage.getItem(MOB_HOME_CACHE) || 'null'); if (c) { F = c.F; cachedAt = c.at; } } catch (e) { F = null; } }
    F = F || {};
    const o = F.orders, s = F.sales, w = F.week, pr = F.printers, r = F.rfd, a = F.approvals, g = F.fg, ac = F.acc, pe = F.people;
    need = [
      lateN ? row('ord', 'Orders late in the factory', 'no work entered for 5+ days', mobNum(lateN), 'ml-bad', 'late') : '',
      pr && pr.late ? row('vord', 'Late lines at the printers', 'oldest ' + mobNum(pr.lateDays) + ' day(s) over', mobNum(pr.late), 'ml-bad') : '',
      a && (a.vreq + a.qty) ? row('vreq', 'Approvals waiting', [a.vreq ? mobNum(a.vreq) + ' vendor request(s)' : '', a.qty ? mobNum(a.qty) + ' quantity change(s)' : ''].filter(Boolean).join(' · '), mobNum(a.vreq + a.qty), 'ml-warn') : '',
      s && s.waiting ? row('so', 'Sales orders awaiting approval', mobNum(s.n) + ' on record', mobNum(s.waiting), 'ml-warn') : '',
      r && r.pending ? row('rfd', 'RFD asks waiting for approval', 'beyond what the order covers', mobNum(r.pending), 'ml-bad') : '',
      g && g.fbaWaiting ? row('fba', 'Waiting for the FBA team', mobNum(g.fbaWaitingN) + ' issue(s)', mobNum(g.fbaWaiting), 'ml-warn', 'fbawait') : '',
      g && g.pending ? row('fgi', 'Transfers to count in', 'sent from press, not yet stock', mobNum(g.pending), 'ml-warn', 'fgpend') : '',
      ac && ac.low && ac.low.length ? row('acc', 'Accessories below reorder level', ac.low.slice(0, 3).join(', '), mobNum(ac.low.length), 'ml-bad') : '',
    ].join('');
    body += need ? sec('Needs you', need) : (DASH.busy && !cachedAt ? mobEmpty('Reading the registers…') : `<div class="ml-allgood">Nothing is waiting on you.</div>`);
    body += sec('Orders on the book', (o ? row('ord', 'Open orders', mobNum(o.lines) + ' line(s)', mobNum(o.open)) + row('ord', 'Pieces still to make', Object.entries(o.bySrc || {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => k + ' ' + mobNum(v)).join(' · '), mobNum(o.toMake)) : ''));
    body += sec('The factory this week', (w ? row('pa', 'Received from karigars', (w.target ? Math.round(w.received / w.target * 100) + '% of the ' + mobNum(w.target) + ' target · ' : '') + 'last week ' + mobNum(w.last), mobNum(w.received))
      + row('pbase', 'Issued to karigars', w.rejected ? mobNum(w.rejected) + ' rejected' : 'nothing rejected', mobNum(w.issued)) + row('pcut', 'Cut', 'pieces cut this week', mobNum(w.cut)) : ''));
    body += sec('Stock', (g ? row('fgi', 'Finished pieces in the store', mobNum(g.skus) + ' SKU(s)', mobNum(g.pcs)) + row('fba', 'Accepted, not yet shipped', mobNum(g.fbaAcceptedN) + ' issue(s)', mobNum(g.fbaAccepted)) : ''));
    body += sec('People', (pe ? row('att', 'Present today', 'of ' + mobNum(pe.roster) + ' on the roster', mobNum(pe.present), 'ml-okt') + (pe.absent ? row('att', 'Marked absent', '', mobNum(pe.absent), 'ml-bad') : '') : ''));
    body += `<button type="button" class="ml-full" data-home-refresh>${cachedAt ? 'Last read ' + mobEsc(cachedAt) + ' · refresh' : 'Refresh the figures' + (DASH.at ? ' · read ' + mobEsc(DASH.at) : '')}</button>`;
    /* only figures that were really read are compared — a register not read yet must not look like a jump later */
    if (DASH.at) mobAlertCheck(Object.assign(lateN == null ? {} : { late: lateN }, pr ? { printers: pr.late } : {}, a ? { approvals: a.vreq + a.qty } : {}, s ? { sales: s.waiting } : {}, r ? { rfd: r.pending } : {}, g ? { fba: g.fbaWaitingN, fgpend: g.pending } : {}));
  } else {
    const shopOpen = typeof SHOP !== 'undefined' && SHOP.orders ? SHOP.orders.filter(x => x.ff !== 'fulfilled' && !x.cancelledAt).length : null;
    const fgPend = typeof FGI !== 'undefined' && FGI.rows && typeof fgiPending === 'function' ? fgiPending().length : null;
    need = [
      lateN ? row('ord', 'Orders late in the factory', 'no work entered for 5+ days', mobNum(lateN), 'ml-bad', 'late') : '',
      pend ? row('pbase', 'Pieces still out with karigars', 'entries waiting to be received', mobNum(pend), 'ml-warn', 'receive') : '',
      fgPend ? row('fgi', 'Transfers to count in', 'sent from press, not yet stock', mobNum(fgPend), 'ml-warn', 'fgpend') : '',
    ].join('');
    body += need ? sec('Needs you', need) : '';
    body += sec('Your work', [
      row('shop', 'Shopify Orders', 'not yet shipped', shopOpen == null ? null : mobNum(shopOpen)),
      row('pbase', 'Job Work Register', 'issue and receive', null),
      row('pack', 'Packing List', 'scan to pack, labels, FBA file', null),
      row('fgi', 'Finished Goods', 'the India store', null),
      row('ord', 'Order Console', 'every order, the step it is at', null),
      row('repl', 'Replenishment', 'what to send, Air or Sea', null),
      row('att', 'Attendance', 'today', null),
    ].join('')) + `<div class="ml-sum" style="text-align:center">Every other screen you can open is under More.</div>`;
    mobAlertCheck(Object.assign(lateN == null ? {} : { late: lateN }, pend == null ? {} : { receive: pend }, fgPend == null ? {} : { fgpend: fgPend }));
  }
  p.innerHTML = `<div class="mob-list">${head}<div id="mobHomeBody">${body}</div></div>`;
  if (MOB_SR.q) mobSearchDraw();
  if (typing) { const n = p.querySelector('[data-sr-q]'); if (n) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) { /* not a text box */ } } }
}

/* ================= MORE ACTIONABLE (2026-10-17) =================
 *   - a floating + on each screen for the one thing it is mostly opened to do (New job work, Stock entry, Scan, …),
 *   - pull down at the top of a screen to read it again,
 *   - swipe a Job Work line left to Receive, and the phone buzzes on each of these. */
const MOB_FAB = {
  /* [label, what it does, when it shows, the screen's own button it stands in for (hidden while the + shows: one button, not two)] */
  paneFgi: ['Stock entry', () => { if ($('fgEntry')) $('fgEntry').click(); }, () => $('fgEntry') && !$('fgEntry').classList.contains('hide'), 'fgEntry'],
  panePack: ['Scan', () => { if (typeof pksOpen === 'function') pksOpen(); }, null, 'pkScanBtn'],
  paneSo: ['New sales order', () => { if ($('sxNew')) $('sxNew').click(); }, () => $('sxNew') && !$('sxNew').classList.contains('hide'), 'sxNew'],
  paneVord: ['New vendor order', () => { if ($('voNew')) $('voNew').click(); }, () => $('voNew') && !$('voNew').classList.contains('hide'), 'voNew'],
};
const mobBuzz = ms => { try { if (navigator.vibrate) navigator.vibrate(ms || 25); } catch (e) { /* no buzz on this phone */ } };
function mobFabSync() {
  if (!mobOn()) return;
  let fab = $('mobFab');
  if (!fab) {
    fab = document.createElement('button');
    fab.id = 'mobFab';
    fab.type = 'button';
    document.body.appendChild(fab);
    fab.addEventListener('click', () => { const x = MOB_FAB[fab.dataset.pane]; if (x) { mobBuzz(); x[1](); } });
  }
  const cur = [...document.querySelectorAll('.main [id^="pane"]')].find(x => !x.classList.contains('hide'));
  const x = cur && MOB_FAB[cur.id];
  const show = !!(x && (!x[2] || x[2]()) && !(cur.classList.contains('mob-fit')));
  fab.classList.toggle('hide', !show);
  Object.keys(MOB_FAB).forEach(k => { const b = MOB_FAB[k][3] && $(MOB_FAB[k][3]); if (b) b.classList.toggle('mob-fabbed', show && cur.id === k); });
  if (show) { fab.dataset.pane = cur.id; fab.innerHTML = `${MOB_SVG('<path d="M12 5v14M5 12h14"/>')}<span>${mobEsc(x[0])}</span>`; }
}
/* pull down to refresh: the screen's own Refresh where it has one, else it is drawn again */
const MOB_REFRESH = { paneShop: 'soGo', panePbase: 'pbGo', paneOrd: 'odGo', paneAtt: 'attGo', paneDash: 'dashGo' };
let MOB_PULL = null;
function mobRefreshNow() {
  const cur = [...document.querySelectorAll('.main [id^="pane"]')].find(x => !x.classList.contains('hide'));
  if (!cur) return;
  mobBuzz(20);
  if (cur.id === 'paneMobHome') return mobHomeShow(true);
  const b = MOB_REFRESH[cur.id] && $(MOB_REFRESH[cur.id]);
  if (b && !b.disabled) b.click(); else if (typeof TAB_NOW !== 'undefined' && TAB_NOW) showTab(TAB_NOW);
}
if (typeof document.addEventListener === 'function') {
  document.addEventListener('touchstart', e => {
    if (!mobOn() || e.touches.length !== 1 || window.scrollY > 0 || document.querySelector('.pks, .mob-sheet:not(.hide), .modal:not(.hide), .ptmodal:not(.hide)')) { MOB_PULL = null; return; }
    if (!e.target.closest || !e.target.closest('.main') || e.target.closest('.mob-fit')) { MOB_PULL = null; return; }
    MOB_PULL = { y0: e.touches[0].clientY, x0: e.touches[0].clientX, d: 0 };
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!MOB_PULL || e.touches.length !== 1) return;
    const d = e.touches[0].clientY - MOB_PULL.y0;
    if (Math.abs(e.touches[0].clientX - MOB_PULL.x0) > Math.abs(d) || d <= 0 || window.scrollY > 0) { MOB_PULL.d = 0; mobPullShow(0); return; }
    MOB_PULL.d = d;
    mobPullShow(d);
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (MOB_PULL && MOB_PULL.d > 90) mobRefreshNow();
    MOB_PULL = null;
    mobPullShow(0);
  });
}
function mobPullShow(d) {
  let el = $('mobPull');
  if (!el) { el = document.createElement('div'); el.id = 'mobPull'; el.textContent = 'Release to refresh'; document.body.appendChild(el); }
  el.classList.toggle('on', d > 20);
  el.textContent = d > 90 ? 'Release to refresh' : 'Pull down to refresh';
  el.style.transform = `translate(-50%, ${Math.min(60, d / 2)}px)`;
}
/* swipe a Job Work line left: Receive */
let MOB_SWIPE = null;
if (typeof document.addEventListener === 'function') {
  document.addEventListener('touchstart', e => {
    const row = e.target.closest && e.target.closest('.ml-row[data-ml-jw]');
    MOB_SWIPE = row && row.querySelector('[data-ml-recv]') && e.touches.length === 1 ? { row, x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0 } : null;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!MOB_SWIPE) return;
    const dx = e.touches[0].clientX - MOB_SWIPE.x0, dy = e.touches[0].clientY - MOB_SWIPE.y0;
    if (Math.abs(dy) > Math.abs(dx)) { MOB_SWIPE.row.style.transform = ''; MOB_SWIPE = null; return; }
    MOB_SWIPE.dx = Math.min(0, dx);
    MOB_SWIPE.row.style.transform = `translateX(${Math.max(-110, MOB_SWIPE.dx)}px)`;
    MOB_SWIPE.row.classList.toggle('ml-swiping', MOB_SWIPE.dx < -70);
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!MOB_SWIPE) return;
    const S = MOB_SWIPE; MOB_SWIPE = null;
    S.row.style.transform = '';
    S.row.classList.remove('ml-swiping');
    if (S.dx < -70) { mobBuzz(); const b = S.row.querySelector('[data-ml-recv]'); if (b) jwRecvOpen(b.dataset.mlRecv); }
  });
}

/* ================= OFFLINE AND ALERTS (2026-10-17) =================
 *   - OFFLINE: a line under the header says so, and what is on screen is what this phone last read; Home keeps its last
 *     figures (mobHomeCache). Scans are already kept on the phone until the network is back (Scan to pack).
 *     Back online, the screen on show is read again.
 *   - ALERTS: when something that needs you goes UP since the phone last looked — more late orders, more approvals,
 *     more FBA boxes waiting — a note slides in, Home's tab carries a red count, and, if this phone allowed
 *     notifications (More → Turn on alerts), the phone shows one too while the app is open or in the background.
 *     A notification with the app fully closed needs a server to send it, which is a separate step. */
function mobNetSync() {
  if (!mobOn()) return;
  let el = $('mobNet');
  if (!el) { el = document.createElement('div'); el.id = 'mobNet'; const h = $('mobHead'); if (h) h.appendChild(el); }
  const off = typeof navigator !== 'undefined' && navigator.onLine === false;
  el.classList.toggle('hide', !off);
  el.textContent = off ? 'Offline · showing what this phone last read' : '';
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('offline', mobNetSync);
  window.addEventListener('online', () => { mobNetSync(); if (mobOn()) mobRefreshNow(); });
}
const MOB_ALERT_KEY = 'mobAlertSeen';
const MOB_ALERT_WORDS = { late: 'order(s) now late', printers: 'late line(s) at the printers', approvals: 'approval(s) waiting', sales: 'sales order(s) to approve',
  rfd: 'RFD ask(s) waiting', fba: 'FBA issue(s) waiting to be accepted', fgpend: 'transfer(s) to count in', receive: 'job work entr(ies) with pieces out' };
function mobAlertCheck(now) {
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(MOB_ALERT_KEY) || '{}'); } catch (e) { seen = {}; }
  const up = Object.keys(now).filter(k => k in seen && now[k] > seen[k]);
  const total = Object.values(now).reduce((a, n) => a + (n || 0), 0);
  /* the red count on Home's tab: everything waiting */
  const home = $('mobBar') && $('mobBar').querySelector('[data-mob="home"]');
  if (home) { let b = home.querySelector('.mob-badge'); if (!b) { b = document.createElement('i'); b.className = 'mob-badge'; home.appendChild(b); } b.textContent = total > 99 ? '99+' : String(total); b.classList.toggle('hide', !total); }
  if (up.length) {
    const msg = up.map(k => `${mobNum(now[k] - (seen[k] || 0))} more ${MOB_ALERT_WORDS[k] || k}`).join(' · ');
    mobToast(msg);
    mobBuzz([40, 60, 40]);
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible')
        new Notification('Ridhi — needs you', { body: msg, icon: '/icon-192.png', tag: 'ridhi-needs' });
    } catch (e) { /* the note on screen is enough */ }
  }
  try { localStorage.setItem(MOB_ALERT_KEY, JSON.stringify(Object.assign(seen, now))); } catch (e) { /* next time */ }
}
function mobToast(t) {
  const el = document.createElement('div');
  el.className = 'mob-toast';
  el.textContent = t;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
async function mobAlertsOn() {
  if (typeof Notification === 'undefined') return mobToast('This phone\'s browser cannot show notifications.');
  const r = await Notification.requestPermission();
  mobToast(r === 'granted' ? 'Alerts are on for this phone.' : 'Alerts stay off — the phone was not allowed to show them.');
}
/* coming back to the app after a while: read what needs you again (at most every 15 minutes, to spare the database) */
let MOB_LAST_BACK = Date.now();
if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', () => {
  if (!mobOn() || document.visibilityState !== 'visible') return;
  if (Date.now() - MOB_LAST_BACK < 15 * 60e3) return;
  MOB_LAST_BACK = Date.now();
  const home = $('paneMobHome');
  if (home && !home.classList.contains('hide')) mobHomeShow(true);
});

/* ================= TABLE VIEW: THE SCREEN SHRUNK TO FIT, AND ZOOMABLE (2026-10-17) =================
 *
 * Ravi, from his phone: "can we minimise the tables view like if we in excel and other viewers have and then we can zoom
 * whenever we want", then: "I want the card version but when I click on table view I want that zoom feature and remove the
 * fit button". So Cards stay what a phone shows first. Table — the switch above a table, or "Table view" at the bottom of a
 * screen that has no switch — draws the screen exactly as on a computer (MOB_FIT_W wide), shrunk to the phone's width the
 * way a spreadsheet app opens a sheet; − and + enlarge it (pinch works too), it scrolls sideways once bigger than the
 * screen, and Cards brings the cards back. The choice (localStorage mobTbl:<pane>) and the zoom (mobZoom:<pane>) are
 * remembered per screen on that phone. A phone list's "Full screen" opens the same view. */
const MOB_OWN_LAYOUT = ['paneShop', 'paneFgi', 'panePack', 'paneMobHome'];
const MOB_FIT_W = 1100;
const MOB_LIST_KEY_OF = { paneOrd: 'ord', panePbase: 'pbase', paneRepl: 'repl' };
function mobZoomOf(id) { try { return parseFloat(localStorage.getItem('mobZoom:' + id)) || 0; } catch (e) { return 0; } }   // 0 = the phone's width
function mobFitScale() { const m = document.querySelector('.main'); return Math.max(0.2, Math.min(1, ((m ? m.clientWidth : 375) - 20) / MOB_FIT_W)); }
function mobPaneMode(id) { try { return localStorage.getItem('mobTbl:' + id) || 'cards'; } catch (e) { return 'cards'; } }
/* CARDS FIRST (Ravi, 17 Oct: "make cards as primary"). Table choices left on a phone by the first test days are cleared
 * once, so every screen opens as cards again; a Table picked from now on is remembered as before. */
(() => {
  try {
    if (localStorage.getItem('mobCardsFirst') === '1') return;
    Object.keys(localStorage).filter(k => /^mob(Tbl|Zoom):/.test(k)).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('mobCardsFirst', '1');
  } catch (e) { /* no storage: cards anyway */ }
})();
/** 'table' (shrunk, zoomable), 'cards', or '' for a screen with a phone layout of its own (no bar at all). */
function mobPaneView(p) {
  if (!p || MOB_OWN_LAYOUT.includes(p.id)) return '';
  const k = MOB_LIST_KEY_OF[p.id];
  if (k) return mobFull(k) || (k === 'repl' && typeof ME !== 'undefined' && ME.replShopView) ? 'table' : '';
  return mobPaneMode(p.id) === 'table' ? 'table' : 'cards';
}
/** Draw the screen on show in its view, and the bar for it: − + Cards in Table view, "Table view" in Cards. */
function mobFitSync() {
  if (!mobOn()) return;
  let cur = null, curView = '';
  document.querySelectorAll('.main [id^="pane"]').forEach(p => {
    const v = mobPaneView(p);
    p.classList.toggle('mob-fit', v === 'table');
    if (v === 'table') {
      const z = mobZoomOf(p.id) || mobFitScale();
      p.style.setProperty('--mobz', String(Math.round(z * 1000) / 1000));
      p.style.setProperty('--mobw', MOB_FIT_W + 'px');
    }
    if (v && !p.classList.contains('hide')) { cur = p; curView = v; }
  });
  let bar = $('mobZoomBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'mobZoomBar';
    bar.innerHTML = '<button type="button" data-mz-view="cards" class="mz-v">Cards</button><button type="button" data-mz-view="table" class="mz-v">Table view</button>';
    document.body.appendChild(bar);
    bar.addEventListener('click', e => {
      const p = [...document.querySelectorAll('.main [id^="pane"]')].find(x => !x.classList.contains('hide') && mobPaneView(x));
      const sw = e.target.closest('[data-mz-view]');
      if (!p || !sw) return;
      try { localStorage.setItem('mobTbl:' + p.id, sw.dataset.mzView); } catch (err) { /* this visit only */ }
      mobFitSync(); mobCardTables(); window.scrollTo(0, 0);
      mobTableStep(p, sw.dataset.mzView);
      if (sw.dataset.mzView === 'table') mobPinchHint();
    });
  }
  /* In Cards, the switch above a table already offers Table: the bar is only for a screen that has no such switch. A phone
   * list's Full screen goes back with its own button ("Back to the phone list"), so it has no bar either. */
  const hasSw = !!(cur && curView === 'cards' && (cur.querySelector('.mob-tsw:not(.hide)') || (cur.shadowRoot && cur.shadowRoot.querySelector('.mob-tsw:not(.hide)'))));
  bar.classList.toggle('hide', !cur || hasSw || !!MOB_LIST_KEY_OF[cur.id]);
  bar.classList.toggle('mz-table', curView === 'table');
  mobFabSync();
}

/* ---- ZOOM WITH TWO FINGERS (Ravi: "not the −/+ version, I can zoom in and out with my fingers") ----
 * In Table view the table itself pinches: the header and the tab bar stay as they are, the point between the fingers stays
 * under the fingers, it never shrinks below the phone's width, and the size is kept for that screen. A double tap
 * goes from the whole sheet to a readable size and back, as spreadsheet apps do. */
const MOB_ZMAX = 1.6;
let MOB_PINCH = null, MOB_TAP = 0;
const mobDist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
function mobZoomTo(p, z, cx, cy) {
  const fit = mobFitScale(), now = parseFloat(p.style.getPropertyValue('--mobz')) || fit;
  z = Math.max(fit, Math.min(MOB_ZMAX, z));
  const r = z / now, box = p.getBoundingClientRect(), x = cx - box.left, y = cy;
  const left = p.scrollLeft, top = window.scrollY;
  p.style.setProperty('--mobz', String(Math.round(z * 1000) / 1000));
  /* keep the point under the fingers where it was */
  p.scrollLeft = Math.max(0, (left + x) * r - x);
  window.scrollTo(window.scrollX, Math.max(0, (top + y) * r - y));
  return z;
}
function mobZoomKeep(p, z) {
  const fit = mobFitScale();
  try { if (z > fit * 1.02) localStorage.setItem('mobZoom:' + p.id, String(z)); else localStorage.removeItem('mobZoom:' + p.id); } catch (e) { /* this visit only */ }
}
function mobPinchHint() {
  try { if (localStorage.getItem('mobPinchHint')) return; localStorage.setItem('mobPinchHint', '1'); } catch (e) { return; }
  const h = document.createElement('div');
  h.className = 'mob-hint';
  h.textContent = 'Pinch with two fingers to zoom · double-tap to enlarge';
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 3500);
}
if (typeof document.addEventListener === 'function') {
  document.addEventListener('touchstart', e => {
    const p = e.target.closest && e.target.closest('.main > .mob-fit');
    if (!p || !mobOn()) return;
    if (e.touches.length === 2) {
      MOB_PINCH = { p, d0: mobDist(e.touches), z0: parseFloat(p.style.getPropertyValue('--mobz')) || mobFitScale(), z: 0, raf: 0 };
      e.preventDefault();
      return;
    }
    /* double tap, on anything that is not a button, a box or a link */
    if (e.touches.length === 1 && !e.target.closest('button,a,input,select,textarea,label,[role=button]')) {
      const now = Date.now();
      if (now - MOB_TAP < 300) {
        e.preventDefault();
        const fit = mobFitScale(), cur = parseFloat(p.style.getPropertyValue('--mobz')) || fit;
        const z = mobZoomTo(p, cur > fit * 1.3 ? fit : Math.min(MOB_ZMAX, fit * 2.4), e.touches[0].clientX, e.touches[0].clientY);
        mobZoomKeep(p, z);
        MOB_TAP = 0;
      } else MOB_TAP = now;
    }
  }, { passive: false });
  document.addEventListener('touchmove', e => {
    if (!MOB_PINCH || e.touches.length !== 2) return;
    e.preventDefault();
    const P = MOB_PINCH, t = e.touches, cx = (t[0].clientX + t[1].clientX) / 2, cy = (t[0].clientY + t[1].clientY) / 2;
    const want = P.z0 * mobDist(t) / P.d0;
    if (P.raf) return;
    P.raf = requestAnimationFrame(() => { P.raf = 0; P.z = mobZoomTo(P.p, want, cx, cy); });
  }, { passive: false });
  const end = e => {
    if (!MOB_PINCH || (e.touches && e.touches.length >= 2)) return;
    if (MOB_PINCH.z) mobZoomKeep(MOB_PINCH.p, MOB_PINCH.z);
    MOB_PINCH = null;
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('resize', () => { if (mobOn()) mobFitSync(); });


/* ================= THE PHONE'S BACK: one step at a time (Ravi, 17 Oct: "when I click back on my phone it was supposed to
 * go back to the previous step, but it is taking me back to the previous page") =================
 * Windows already close on Back (nav.js, NAV_POPS). On top of that, every step taken inside a screen is a line in the
 * phone's history: Home over a screen, a search on Home, Table view, Full screen, an opened fabric, a sheet opened from a
 * sheet. Back undoes the last of them; only then does it go to the screen before. At the very first screen Back shows
 * Home, and on Home it asks for a second press before it leaves the app. On a computer none of this is switched on. */
var MOB_STEPS = [], MOB_SHEET_STACK = [], MOB_HIST_ON = false, MOB_POP_SKIP = 0, MOB_EXIT_AT = 0;
function mobHistInit() {
  if (MOB_HIST_ON || !mobOn() || typeof history === 'undefined' || typeof history.pushState !== 'function' || typeof window.addEventListener !== 'function') return;
  MOB_HIST_ON = true;
  const push = history.pushState.bind(history), rep = history.replaceState.bind(history);
  /* every line of history carries how many steps were open when it was written; Back undoes the steps above that */
  history.pushState = (s, t, u) => push(Object.assign({}, s || {}, { mobStep: MOB_STEPS.length }), t, u);
  history.replaceState = (s, t, u) => { const was = history.state || {}; return rep(Object.assign({ mobStep: was.mobStep || 0, mobHome: was.mobHome, mobRoot: was.mobRoot, appPop: was.appPop }, s || {}), t, u); };
  try {
    rep(Object.assign({}, history.state || {}, { mobRoot: 1, mobStep: 0 }), '', location.href);
    history.pushState({}, '', location.href);
  } catch (e) { /* no history on this page: Back works as the browser's */ }
  window.addEventListener('popstate', mobOnPop);
}
/** The line of history the app is on now shows Home (the first screen after signing in). */
function mobMarkHome() { if (MOB_HIST_ON) try { history.replaceState({ mobHome: 1 }, '', location.href); } catch (e) { /* kept as it was */ } }
function mobStepHas(id) { return MOB_STEPS.some(x => x.id === id); }
/** A step was taken on this screen; `undo` puts the screen back as it was. */
function mobStep(id, undo) {
  if (!MOB_HIST_ON) return;
  MOB_STEPS.push({ id, undo });
  const s = history.state || {};
  try { history.pushState({ mobHome: s.mobHome, appPop: s.appPop }, '', location.href); } catch (e) { MOB_STEPS.pop(); }
  mobBackArrow();
}
/** The step was undone on the screen itself (Cards pressed, the search emptied): its line of history goes too. */
function mobStepDrop(id) {
  if (!MOB_HIST_ON || !mobStepHas(id)) return;
  const top = MOB_STEPS[MOB_STEPS.length - 1];
  if (top.id !== id) { MOB_STEPS = MOB_STEPS.filter(x => x.id !== id); mobBackArrow(); return; }
  MOB_STEPS.pop();
  MOB_POP_SKIP++;
  try { history.back(); } catch (e) { MOB_POP_SKIP--; }
  mobBackArrow();
}
function mobOnPop(e) {
  if (MOB_POP_SKIP > 0) { MOB_POP_SKIP--; return; }
  if (!mobOn()) return;
  const s = (e && e.state) || {};
  const cur = s.mobStep || 0;
  /* a line left over from a screen that was since closed: nothing to undo there, go one further */
  if (cur > MOB_STEPS.length && !s.appPop && !s.mobHome && !s.mobRoot) { try { history.back(); } catch (err) { /* stays */ } return; }
  while (MOB_STEPS.length > cur) {
    const st = MOB_STEPS.pop();
    try { st.undo(); } catch (err) { /* the screen was redrawn meanwhile */ }
  }
  if (typeof navPopSoon === 'function') navPopSoon();
  /* after the screen the address names is back (nav.js, hashchange): Home on or off as that line of history had it */
  setTimeout(() => mobPopSettle(s), 60);
}
const mobOnHome = () => { const h = $('paneMobHome'); return !!h && !h.classList.contains('hide'); };
function mobPopSettle(s) {
  if (s.mobRoot && !MOB_STEPS.length) {
    if (!mobOnHome()) { mobHomeShow(); history.pushState({ mobHome: 1 }, '', location.href); return; }
    if (Date.now() - MOB_EXIT_AT < 2500) { try { history.back(); } catch (e) { /* stays */ } return; }
    MOB_EXIT_AT = Date.now();
    mobToast('Press Back again to leave the app');
    history.pushState({ mobHome: 1 }, '', location.href);
    return;
  }
  if (s.mobHome && !mobOnHome()) mobHomeShow();
  else if (!s.mobHome && mobOnHome() && typeof TAB_NOW !== 'undefined' && TAB_NOW) mobQuietTab(TAB_NOW);
  mobBackArrow();
}
/** Show a screen without writing a new line of history (the phone's Back is already on the right line). */
function mobQuietTab(t) {
  try { NAV_FROM_HISTORY = true; } catch (e) { /* no nav.js here */ }
  try { showTab(t); } finally { try { NAV_FROM_HISTORY = false; } catch (e) { /* no nav.js here */ } }
}
/** The header's ←: shown whenever Back has somewhere to go inside the app. */
function mobBackArrow() {
  let b = $('mobBack');
  if (!b && $('mobHead')) {
    b = document.createElement('button');
    b.type = 'button'; b.id = 'mobBack'; b.className = 'mob-back hide'; b.setAttribute('aria-label', 'Back');
    b.innerHTML = MOB_SVG('<path d="m15 18-6-6 6-6"/>');
    b.onclick = mobBackTap;
    $('mobHead').insertBefore(b, $('mobHead').firstChild);
  }
  if (!b) return;
  const show = !!(MOB_STEPS.length || !mobOnHome() || (typeof navTopPop === 'function' && navTopPop()));
  b.classList.toggle('hide', !show);
  if ($('mobHead')) $('mobHead').classList.toggle('mob-hasback', show);
}
function mobBackTap() {
  mobBuzz(8);
  if (MOB_HIST_ON) { try { history.back(); return; } catch (e) { /* below */ } }
  mobHomeShow();
}
/** Table view (and back to Cards) on one screen is a step. */
function mobTableStep(p, mode) {
  if (!p) return;
  const id = 'table:' + p.id;
  if (mode === 'table' && !mobStepHas(id)) mobStep(id, () => { try { localStorage.setItem('mobTbl:' + p.id, 'cards'); } catch (e) { /* this visit only */ } mobFitSync(); mobCardTables(); });
  else if (mode !== 'table') mobStepDrop(id);
}
/* Opening another screen starts afresh: the steps of the screen being left are forgotten (its Table view stays chosen).
 * Their lines of history are passed over by Back (mobOnPop). */
if (typeof showTab === 'function') {
  const mobShowTab0 = showTab;
  showTab = function () {
    let fromHist = false;
    try { fromHist = !!NAV_FROM_HISTORY; } catch (e) { /* no nav.js here */ }
    const wasHome = MOB_HIST_ON && !fromHist && mobOnHome() && history.state && history.state.mobHome;
    if (MOB_HIST_ON && !fromHist && MOB_STEPS.length) {
      MOB_STEPS = []; MOB_SHEET_STACK = [];
      if (MOB_SR.q) { MOB_SR.q = ''; const box = document.querySelector('[data-sr-q]'); if (box) box.value = ''; }
    }
    const r = mobShowTab0.apply(this, arguments);
    /* from Home to the screen that was under it: the address did not change, so a line is written here */
    if (wasHome && history.state && history.state.mobHome) try { history.pushState({}, '', location.href); } catch (e) { /* stays */ }
    return r;
  };
}

/* ---- FEELS LIKE AN APP: a screen slides in, a press answers ---- */
function mobPaneIn(p) {
  if (!p || !mobOn() || !p.classList) return;
  p.classList.remove('mob-in');
  void p.offsetWidth;            // start the slide again
  p.classList.add('mob-in');
}

/* ================= MASTER DATABASE on a phone: an opened fabric is a step, and a size opens its SKUs =================
 * (Ravi, 17 Oct: "the sizes were workable on the site, in mobile it's not working"). A size chip under a product opens
 * a sheet with every SKU of that product in that size: picture, colour, India store stock. A SKU opens its own sheet
 * (stock, who wants it, Finished Goods, Master database). The other sizes of the product are chips at the top. */
var MOB_SIZE = null;
if (typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  if (!mobOn() || !e.target || !e.target.closest) return;
  const sp = e.target.closest('.fm-sizes span');
  if (sp) { mobBuzz(8); return mobSizeSheet(sp); }
  const o = e.target.closest('[data-fmopen]');
  if (o && typeof FM !== 'undefined' && FM.open) {
    const k = o.dataset.fmopen, id = 'fm:' + k;
    if (FM.open.has(k) && !mobStepHas(id)) mobStep(id, () => { if (FM.open.has(k)) { FM.open.delete(k); fmRender(); } });
    else if (!FM.open.has(k)) mobStepDrop(id);
  }
});
function mobSizeSheet(sp) {
  const row = sp.closest('tr'), det = row && row.closest('tr.fm-det'), main = det && det.previousElementSibling;
  const tog = main && main.querySelector('[data-fmopen]');
  if (!row || !tog || typeof fmProducts !== 'function') return;
  const cell = i => { const t = String((row.cells[i] && row.cells[i].textContent) || '').trim(); return t === '—' ? '' : t; };
  MOB_SIZE = { fab: tog.dataset.fmopen, art: cell(0), sub: cell(1), sizes: [...row.querySelectorAll('.fm-sizes span')].map(x => x.textContent.trim()) };
  mobSizeDraw(sp.textContent.trim(), false);
}
function mobSizeDraw(size, same) {
  const c = MOB_SIZE;
  if (!c) return;
  let ps = [];
  try { ps = fmProducts().filter(p => p.fab === c.fab && p.art === c.art && p.sub === c.sub && p.size === size); } catch (e) { ps = []; }
  ps.sort((a, b) => String(a.col).localeCompare(String(b.col)) || a.sku.localeCompare(b.sku));
  const stock = sku => { try { const v = fgiOf(sku).current; return v == null ? null : v; } catch (e) { return null; } };
  const chips = c.sizes.length > 1 ? `<div class="ml-chips mob-szchips">${c.sizes.map(z => `<button type="button" class="ml-chip${z === size ? ' on' : ''}" data-mob-size="${mobEsc(z)}">${mobEsc(z)}</button>`).join('')}</div>` : '';
  const rows = ps.map(p => {
    const n = stock(p.sku);
    return `<button type="button" class="ml-row" data-mob-sku="${mobEsc(p.sku)}"><span class="ml-img" data-img="${mobEsc(p.sku)}" data-imgpx="44">${typeof ptImgInner === 'function' ? ptImgInner(p.sku, 44) : ''}</span>`
      + `<span class="ml-m"><b>${mobEsc(p.sku)}</b><small>${mobEsc([p.col, p.proc].filter(Boolean).join(' · ') || '—')}</small></span>`
      + `<span class="ml-r">${n == null ? '' : `<b class="${n > 0 ? '' : 'ml-bad'}">${mobNum(n)}</b><small>in store</small>`}</span><span class="ml-chev">›</span></button>`;
  }).join('');
  mobSheet([c.art, c.sub].filter(Boolean).join(' · ') || 'Product', 'Size ' + size + ' · ' + mobNum(ps.length) + ' SKU' + (ps.length === 1 ? '' : 's'),
    chips + (rows ? `<div class="ml-group">${rows}</div>` : mobEmpty('No SKU of this product in size ' + size + '.')), same);
}

/* The Master Database's nine filters fill a phone's screen before the first fabric: on a phone they fold behind one
 * "Filters" button that says how many are on. Each filter works exactly as before. */
var MOB_FMF_OPEN = false;
function mobFmFilters() {
  document.querySelectorAll('.main .fm-fbar').forEach(bar => {
    let b = bar.previousElementSibling;
    if (!(b && b.classList.contains('mob-fmf'))) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'mob-fmf';
      bar.parentElement.insertBefore(b, bar);
      b.onclick = () => { MOB_FMF_OPEN = !MOB_FMF_OPEN; mobBuzz(8); mobFmFilters(); };
    }
    const on = [...bar.querySelectorAll('select')].filter(x => x.value).length;
    b.innerHTML = MOB_SVG('<path d="M3 5h18l-7 8v6l-4-2v-4z"/>') + `<span>Filters${on ? ` · <b>${on} on</b>` : ''}</span><span class="ml-chev">${MOB_FMF_OPEN ? '▴' : '▾'}</span>`;
    b.classList.toggle('on', !!on);
    bar.classList.toggle('mob-fmf-shut', !MOB_FMF_OPEN);
  });
}

/* ================= CONTENT FIRST on Orders and Stock (17 Oct review: on a phone the first order and the first SKU sat
 * under the tab bar, below a whole screen of controls) =================
 * The search, the main buttons and the figures stay in view; the rest (dates, More, stock note on Orders; brand, filters,
 * in-stock only, opening stock, export on Stock) folds behind one "More tools" button. Every control works as before. */
var MOB_TOOLS_OPEN = {};
const MOB_TOOLS = { paneShop: '#paneShop .so-find', paneFgi: '#paneFgi .card > .toolbar' };
function mobToolsSync() {
  if (!mobOn()) return;
  Object.keys(MOB_TOOLS).forEach(id => {
    const pane = $(id), bar = pane && pane.querySelector(MOB_TOOLS[id]);
    if (!bar) return;
    let b = bar.querySelector('.mob-toolsbtn');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'ghost mob-toolsbtn';
      bar.appendChild(b);
      b.onclick = () => { MOB_TOOLS_OPEN[id] = !MOB_TOOLS_OPEN[id]; mobBuzz(8); mobToolsSync(); };
    }
    const open = !!MOB_TOOLS_OPEN[id];
    pane.classList.add('mob-tools');
    pane.classList.toggle('mob-tools-open', open);
    b.textContent = open ? 'Tools ▴' : 'Tools ▾';
  });
}

/* ---- the More menu: a search over every screen, and the screens used last on top ---- */
const MOB_RECENT = 'mobRecent';
function mobRecentAdd(t) {
  if (!t) return;
  try {
    const r = JSON.parse(localStorage.getItem(MOB_RECENT) || '[]').filter(x => x !== t);
    r.unshift(t);
    localStorage.setItem(MOB_RECENT, JSON.stringify(r.slice(0, 6)));
  } catch (e) { /* no storage: no recent list */ }
}
function mobMoreFilter() {
  const q = String(($('mobMoreQ') && $('mobMoreQ').value) || '').trim().toLowerCase();
  const list = $('mobMoreList');
  if (!list) return;
  list.querySelectorAll('.mob-grp:not(.mob-foot)').forEach(g => {
    let n = 0;
    g.querySelectorAll('.mob-link').forEach(a => { const hit = !q || a.textContent.toLowerCase().includes(q); a.classList.toggle('hide', !hit); if (hit) n++; });
    g.classList.toggle('hide', !n || (!!q && g.classList.contains('mob-recent')));
  });
  const foot = list.querySelector('.mob-foot');
  if (foot) foot.classList.toggle('hide', !!q);
  let none = list.querySelector('.mob-none');
  if (!none) { none = document.createElement('div'); none.className = 'ml-empty mob-none'; list.appendChild(none); }
  none.textContent = 'No screen called “' + q + '”.';
  none.classList.toggle('hide', !q || !!list.querySelector('.mob-grp:not(.mob-foot):not(.mob-recent):not(.hide)'));
}
