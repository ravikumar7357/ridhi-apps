/* ================= FINISHED GOODS: THE NEW PAGE, TABS BY JOB =================
 * Approved redesign (28 Nov), stage 1: Finished Goods is laid out by job: Stock, Receive, Issue, Send to FBA, To do and
 * History. Stock is new: four tiles for the whole store, the India Store list with one Article cell, and a panel for the
 * article pressed. The other tabs show the lists and buttons of the old page that serve their job, so nothing is lost
 * while they are redesigned. This file only decides what is shown: every figure, right, hold, limit and save is the
 * screen's own (finished-goods.js, fg-store-alloc.js and the rest). A control is only ever hidden here (class fgt-off),
 * never shown against the old page's own rules. An account that only accepts from QC keeps its one list.
 *
 * WHEN SOMETHING GOES WRONG:
 *   loud, to the user — saves are made by the old page's own forms, which say why a save was refused.
 *   quiet, with a console line — the switch (storage blocked: the default; the choice of page cannot be kept).
 *
 * BEHIND SWITCH fgTabs, which needs storeAlloc on. On by itself on the test website only, OFF everywhere else.
 * localStorage fgTabs = '1' turns it on for one computer, '0' off. The test website shows an "Old page / New page"
 * choice that sets it. The way back is that same '0'. */
const FGT_MOVES = 10;   // the article panel shows this many of the latest movements

/** The tabs. views: the old page's views (the fgView choices) a tab holds. controls: the ids of the old page's controls it
 *  keeps. kpi: the movements it narrows to (FGI_KPI_ROWS). entry: the kind of stock entry its entry button opens on. */
const FGT_TABS = [
  { key: 'stock', label: 'Stock', views: ['stock'], controls: ['fgQ', 'fgBrand', 'fgFilters', 'fgaView', 'fgExport', 'fgRefresh'] },
  { key: 'receive', label: 'Receive', views: ['flow', 'pending'], controls: ['fgQ', 'fgEntry', 'fgScan', 'fgOpening', 'fgExport', 'fgRefresh'] },
  { key: 'issue', label: 'Issue', views: ['ledger'], kpi: 'out', entry: 'ISSUE',
    controls: ['fgQ', 'fgFilters', 'fgD1', 'fgD2', 'fgEntry', 'fgScan', 'fgPack', 'fgEditPicked', 'fgDelPicked', 'fgExport', 'fgRefresh'] },
  { key: 'send', label: 'Send to FBA', views: ['stock'], entry: 'FBA',
    controls: ['fgQ', 'fgBrand', 'fgFilters', 'fgaView', 'fgFbaList', 'fgEntry', 'fgScan', 'fgPack', 'fgEditPicked', 'fgDelPicked', 'fgExport', 'fgRefresh'] },
  { key: 'todo', label: 'To do', views: ['alerts', 'corr', 'fbarep', 'over'], controls: ['fgQ', 'fgLstRefresh', 'fgExport', 'fgRefresh'] },
  { key: 'history', label: 'History', views: ['ledger'],
    controls: ['fgQ', 'fgFilters', 'fgD1', 'fgD2', 'fgKpis', 'fgEditPicked', 'fgDelPicked', 'fgExport', 'fgRefresh'] },
];
/** Every control a tab may keep or leave out. fgFilters stands for the Filters button (core/filter-by.js). */
const FGT_CONTROLS = ['fgView', 'fgPendBadge', 'fgAlerts', 'fgKpis', ...new Set(FGT_TABS.flatMap(t => t.controls))];
/** The old page's count badge of each view that has work waiting. */
const FGT_BADGES = { flow: 'flFgBadge', pending: 'fgPendBadge', alerts: 'fgiLstBadge', corr: 'fgiCorrBadge', fbarep: 'fapBadge', over: 'fgiOverBadge' };

/** The tab on screen, the SKU whose panel is open, and where the brand box sits on the old page. */
let FGTAB = { tab: 'stock', open: '', brandHome: null };

/* ---- the switch ---- */
function fgtOn() {
  if (!fgaOn()) return false;
  try { const v = localStorage.getItem('fgTabs'); if (v === '1') return true; if (v === '0') return false; }
  catch (e) { console.warn('Finished Goods tabs: this browser blocks saved settings, so the switch uses its default.'); }
  return typeof window !== 'undefined' && !!window.__TEST_ERP;
}
const fgtShown = () => fgtOn() && !ME.fgAccOnly;
const fgtStockTab = () => fgtShown() && FGTAB.tab === 'stock';
const fgtTab = () => FGT_TABS.find(t => t.key === FGTAB.tab);
const fgtEntryType = () => (fgtShown() && fgtTab().entry) || 'RECEIVE';

/* ---- drawing, on every redraw of the screen ---- */
/** Bring the new page's parts in line with the view on screen; with the switch off, take them all away. Called by
 *  renderFgi. stock: fgiStock(), when the ledger is read — without it the tiles and the panel are not drawn. */
function fgtSync(stock) {
  const on = fgtShown();
  if (on) FGTAB.tab = fgtTabFor($('fgView').value).key;
  $('paneFgi').classList.toggle('fgt-on', on);
  fgtDrawSwitch();
  fgtShowControls(on);
  fgtPlaceBrand(on);
  fgtDrawBar();
  const records = on && stock && FGTAB.tab === 'stock' ? fgaWithDispatched(stock) : null;
  fgtDrawTiles(records);
  fgtDrawPanel(records);
}

/** The tab a view belongs to: the one on screen when it holds the view, else the view's own (Every movement: History). */
function fgtTabFor(view) {
  const holds = t => t.views.includes(view);
  const now = fgtTab();
  if (holds(now) && (!now.kpi || now.kpi === FGI_KPI)) return now;
  return FGT_TABS.find(t => !t.kpi && holds(t)) || FGT_TABS[0];
}

function fgtDrawSwitch() {
  const box = $('fgtSwitch'); if (!box) return;
  const offered = typeof window !== 'undefined' && !!window.__TEST_ERP && fgaOn() && !ME.fgAccOnly;
  box.classList.toggle('hide', !offered);
  const page = fgtOn() ? '1' : '0';
  box.querySelectorAll('[data-fgtpage]').forEach(b => {
    const picked = b.getAttribute('data-fgtpage') === page;
    b.classList.toggle('on', picked);
    b.setAttribute('aria-pressed', String(picked));
  });
}

/** Does this tab keep this control? With FBA lists on, pieces go to FBA by a list, so Send to FBA has no stock entry. */
function fgtKeeps(tab, id) {
  if (id === 'fgEntry' && tab.key === 'send' && fblOn()) return false;
  return tab.controls.includes(id);
}
const fgtFiltersButton = () => ($('paneFgi').querySelector ? $('paneFgi').querySelector('.ftwrap') : null);
function fgtShowControls(on) {
  const tab = fgtTab();
  FGT_CONTROLS.forEach(id => {
    const el = id === 'fgFilters' ? fgtFiltersButton() : $(id);
    if (el) el.classList.toggle('fgt-off', on && !fgtKeeps(tab, id));
  });
  fgtNameFilters(on);
}
/** On the new page the brand box stands by itself, so the Filters button holds the rest and says "More filters". */
function fgtNameFilters(on) {
  const button = fgtFiltersButton(), word = button && button.querySelector('.ftbtn').childNodes[1];
  if (word) word.textContent = on ? ' More filters ' : ' Filters ';
}
/** Move the brand box out beside the search on the new page, and back among the filters on the old one. */
function fgtPlaceBrand(on) {
  const brand = $('fgBrand'), parent = brand && brand.parentNode;
  if (on && parent && parent.classList && parent.classList.contains('ftlab')) {
    FGTAB.brandHome = parent;
    const filters = fgtFiltersButton();
    filters.parentNode.insertBefore(brand, filters);
    parent.classList.add('fgt-off');
  } else if (!on && FGTAB.brandHome) {
    FGTAB.brandHome.appendChild(brand);
    FGTAB.brandHome.classList.remove('fgt-off');
    FGTAB.brandHome = null;
  }
}

/* ---- the tab bar and its counts ---- */
/** The count an old page badge shows: '' when it shows none. */
const fgtBadgeText = id => { const el = $(id); return el && !el.classList.contains('hide') ? String(el.textContent).trim() : ''; };
/** What a tab has waiting: its views' badges added up; "…" while one is still being counted; '' for nothing. */
function fgtCount(tab) {
  const texts = tab.views.map(v => fgtBadgeText(FGT_BADGES[v])).filter(Boolean);
  if (texts.includes('…')) return '…';
  const n = texts.reduce((sum, t) => sum + Number(t.replace(/,/g, '')), 0);
  return n ? nf(n) : '';
}
/** The views of a tab this screen offers now: "From QC" with the production flow only, repeat requests with their switch. */
const fgtViewsOf = tab => tab.views.filter(v => (v !== 'flow' || (typeof FLOW_ON !== 'undefined' && FLOW_ON))
  && (v !== 'fbarep' || (typeof fapOn === 'function' && fapOn())));
const fgtViewName = view => $('fgView').querySelector(`option[value="${view}"]`).textContent;
const fgtCountTag = count => (count ? ` <b class="fgt-count">${esc(count)}</b>` : '');

/** The tabs, and under them the choice of list for a tab that holds more than one. */
function fgtDrawBar() {
  const bar = $('fgtBar'), choice = $('fgtViews'); if (!bar || !choice) return;
  const on = fgtShown();
  bar.classList.toggle('hide', !on);
  bar.innerHTML = on ? FGT_TABS.map(t => `<button type="button" role="tab" aria-selected="${t.key === FGTAB.tab}" class="fgt-tab${t.key === FGTAB.tab ? ' on' : ''}" data-fgttab="${t.key}">`
    + `${t.label}${['receive', 'todo'].includes(t.key) ? fgtCountTag(fgtCount(t)) : ''}</button>`).join('') : '';
  const views = on ? fgtViewsOf(fgtTab()) : [];
  choice.classList.toggle('hide', views.length < 2);
  choice.innerHTML = views.length < 2 ? '' : views.map(v => `<button type="button" class="ghost${v === $('fgView').value ? ' on' : ''}" aria-pressed="${v === $('fgView').value}" data-fgtview="${v}">`
    + `${esc(fgtViewName(v))}${fgtCountTag(fgtBadgeText(FGT_BADGES[v]))}</button>`).join('');
}

/* ---- moving between tabs ---- */
function fgtShowView(view) {
  $('fgView').value = view;
  FGI_KPI = fgtTab().kpi || '';
  FGI_KPI_ON = '';
  renderFgi();
  if (typeof fapViewOpened === 'function') fapViewOpened();
}
/** Open a tab, on its first list with something waiting. */
function fgtOpenTab(key) {
  FGTAB = Object.assign({}, FGTAB, { tab: key, open: '' });
  const views = fgtViewsOf(fgtTab());
  fgtShowView(views.find(v => fgtBadgeText(FGT_BADGES[v])) || views[0]);
}
/** The test website's "Old page / New page" choice, kept on this computer. page: '1' new, '0' old. */
function fgtPickPage(page) {
  try { localStorage.setItem('fgTabs', page); }
  catch (e) { console.warn('Finished Goods tabs: this browser blocks saved settings, so the page cannot be changed here.'); }
  FGI_KPI = '';
  renderFgi();
}

/* ---- the Stock tab: tiles ---- */
/** The whole store in four figures, whatever the search and filters show, adding up the same columns as the list. */
function fgtTotals(records) {
  const rows = fgaListRows([...records.values()].filter(fgaListed));
  const sum = f => rows.reduce((n, r) => n + f(r), 0);
  return [['Pieces in store', sum(r => Math.max(0, r.current))], ['Articles in stock', rows.filter(r => r.current > 0).length],
    ['FBA packed', sum(r => r.dispatched)], ['Free (excess)', sum(r => r.alloc.excess)]];
}
/** records: fgaWithDispatched() on the Stock tab, else null. */
function fgtDrawTiles(records) {
  const box = $('fgtTiles'); if (!box) return;
  box.classList.toggle('hide', !records);
  box.innerHTML = records ? fgtTotals(records).map(([label, n]) => `<div><div class="v">${nf(n)}</div><div class="l">${label}</div></div>`).join('') : '';
}

/* ---- the Stock tab: the list ---- */
const fgtItemName = r => esc(r.subtype || r.articleType) || '<span class="muted">not in the master DB</span>';
const fgtItemWhat = r => esc([r.brand, r.color, r.size].filter(Boolean).join(' · '));

/** The India Store list of the Stock tab: the same rows and figures, one Article cell, no buttons on the row. */
function fgtDrawList(rows, sought) {
  const head = fgiStockHead(['SKU', 'Image', 'Article', 'FBA Packed', 'In Stock', ...FGA_SHARES.map(s => s[1])]);
  fgiDrawRows(rows, { head, row: fgtRow, card: fgtCard, sought });
}
function fgtRow(r) {
  const open = `data-fgtopen="${esc(r.sku)}" title="Open this article"`;
  return `<tr${r.sku === FGTAB.open ? ' class="fgt-sel"' : ''}>`
    + `<td class="frz" style="text-align:left"><button type="button" class="ghost fgt-sku" ${open}>${esc(r.sku)}</button></td>`
    + ptImgCell(r.sku)
    + `<td style="text-align:left"><button type="button" class="fgt-art" ${open}>${fgtItemName(r)}<span class="muted">${fgtItemWhat(r)}</span></button></td>`
    + fgaCells(r) + '</tr>';
}
const fgtCard = r => '<tr><td class="fg-mc">' + fgiCardTop(r, '<span></span>', { attr: 'data-fgtopen', title: 'Open this article' }) + '</td></tr>';

/* ---- the Stock tab: the article panel ---- */
/** One SKU as the stock list shows it. */
function fgtRowOf(record) {
  const m = fgiMaster(record.sku);
  return fgaListRows([Object.assign({ brand: String(m.brand || '').trim(), articleType: m.articleType || '', subtype: m.subtype || '',
    color: m.color || '', size: m.size || '' }, record)])[0];
}
/** The orders stock is counted against (the Custom figure's box), then the New development orders waiting. */
function fgtOrdersHtml(sku) {
  const line = (no, tag, text) => `<div><b>${esc(no)}</b>${tag} <span class="muted">${esc(text)}</span></div>`;
  const custom = fgaCustomOrders(sku, fgiOf(sku).current)
    .map(o => line(o.no, '', `${o.channel} · ${nf(o.counted)} from stock of ${nf(o.pending)} pending`));
  const newDev = (fgaBook().newDev.get(shpHoldKey(sku)) || [])
    .map(o => line(o.no, ' ' + FGA_NEW_DEV_TAG, `${o.channel} · ${nf(o.pending)} pending for ${FBLV_LANE_NAMES[o.lane]}`));
  return custom.concat(newDev).join('') || '<div class="muted">No open order is waiting for this article.</div>';
}
function fgtMoveRow(r) {
  const change = fgiEffect(r);
  const pieces = change ? (change > 0 ? '+' : '−') + nf(Math.abs(change)) : `<span class="muted">${nf(fgiNum(r.qty))}</span>`;
  return `<tr><td>${esc(ptDayWords(fapDayOf(r)))}</td><td>${esc(fgiMoveWord(r))}${r.orderNo ? ` <span class="muted">${esc(r.orderNo)}</span>` : ''}</td>`
    + `<td class="num">${pieces}</td></tr>`;
}
function fgtMovesHtml(sku) {
  const rows = (FGI.rows || []).filter(r => r && obUC(r.sku) === sku)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, FGT_MOVES);
  return rows.length ? `<table class="xl fgt-moves"><tbody>${rows.map(fgtMoveRow).join('')}</tbody></table>`
    : '<div class="muted">No movement on record.</div>';
}
/** The panel's buttons, by the same rights as the old page's row buttons. */
function fgtActionsHtml(row) {
  const button = (attr, label, extra = '') => `<button type="button" class="ghost" ${attr}="${esc(row.sku)}"${extra}>${label}</button>`;
  const holds = typeof shpHoldOn === 'function' && shpHoldOn();
  return (fgiCanEntry() ? button('data-fgtadd', 'Add stock') + button('data-fgentry', 'Issue stock') : '')
    + button('data-fgmoves', 'Every movement')
    + (holds && fgiMayRelease(row.sku, row.alloc) ? button('data-fgrel', 'Release held pieces') : '')
    + (fgiCanEdit() ? button('data-fgskudel', 'Delete', ' style="color:var(--bad)"') : '');
}
function fgtTagHtml(sku) {
  const set = (FGI.set || {})[sku] || {};
  const text = `${set.remark || 'No tag'} · re-order level ${set.reorder ? nf(set.reorder) : 'not set'}`;
  return `<div class="fgt-tag"><span>${esc(text)}</span>`
    + (fgiCanEdit() ? `<button type="button" class="ghost" data-fgskued="${esc(sku)}" title="Correct the count, re-order level and tag">Edit</button>` : '') + '</div>';
}
function fgtPanelHtml(row) {
  return `<div class="fgt-p-head"><b>${esc(row.sku)}</b><button type="button" class="ghost" data-fgtclose aria-label="Close the article">✕</button></div>`
    + `<div class="fgt-p-art"><div data-img="${esc(row.sku)}" data-imgpx="64">${ptImgInner(row.sku, 64)}</div>`
    + `<div><div>${fgtItemName(row)}</div><div class="muted">${fgtItemWhat(row)}</div></div></div>`
    + `<div class="fgt-p-figs"><span>In Stock <b>${nf(Math.max(0, row.current))}</b></span>${fgaCardFigs(row)}</div>`
    + `<h4>Orders counted against it</h4>${fgtOrdersHtml(row.sku)}`
    + `<h4>Recent movements</h4>${fgtMovesHtml(row.sku)}`
    + `<h4>Tag and re-order level</h4>${fgtTagHtml(row.sku)}`
    + `<div class="fgt-p-acts">${fgtActionsHtml(row)}</div>`;
}
/** Draw the open article, or put the panel away: off the Stock tab, or its SKU has no movement left. */
function fgtDrawPanel(records) {
  const panel = $('fgtPanel'); if (!panel) return;
  const record = records && records.get(FGTAB.open);
  panel.classList.toggle('hide', !record);
  panel.innerHTML = record ? fgtPanelHtml(fgtRowOf(record)) : '';
}
function fgtOpenArticle(sku) {
  FGTAB = Object.assign({}, FGTAB, { open: sku });
  renderFgi();
}

/* ---- wiring ---- */
/** A press inside the panel: close it, add stock for its SKU, or any button the list itself answers. */
function fgtPanelClick(e) {
  if (e.target.closest('[data-fgtclose]')) return fgtOpenArticle('');
  const add = e.target.closest('[data-fgtadd]');
  if (add) return fgiEntryOpen('RECEIVE', add.getAttribute('data-fgtadd'));
  return fgiTableClick(e);
}
/** A press on one of the new page's own buttons, told by its data- name. */
function fgtPress(attr, run) {
  return e => { const b = e.target.closest(`[${attr}]`); if (b) run(b.getAttribute(attr)); };
}
if ($('fgtSwitch')) $('fgtSwitch').onclick = fgtPress('data-fgtpage', fgtPickPage);
if ($('fgtBar')) $('fgtBar').onclick = fgtPress('data-fgttab', fgtOpenTab);
if ($('fgtViews')) $('fgtViews').onclick = fgtPress('data-fgtview', fgtShowView);
if ($('fgtPanel')) $('fgtPanel').onclick = fgtPanelClick;
if ($('fgTable') && $('fgTable').addEventListener) $('fgTable').addEventListener('click', fgtPress('data-fgtopen', fgtOpenArticle));
/* Some badges are counted after the screen is drawn (From QC, for one): the tab counts follow them. */
if (typeof MutationObserver === 'function' && $('fgAlerts') && $('fgAlerts').nodeType) {
  new MutationObserver(() => { if (fgtShown()) fgtDrawBar(); })
    .observe($('fgAlerts'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
}
