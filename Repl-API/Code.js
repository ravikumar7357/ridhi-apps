/**
 * FBA Inventory Forecasting & Replenishment — Google Sheet edition.
 *
 * Converts raw FBA inventory + shipment data into a business "Planning View"
 * (FBA Available + Current/Next/Future Month Receiving + Total Supply) and a
 * forecast (stock-out date, Air/Sea dispatch recommendation).
 *
 * Data can be entered manually OR auto-imported from Amazon SP-API (same
 * plumbing style as the separate "Amazon Hub" project). Credentials live in
 * Script Properties — never in code:
 *     SP_CLIENT_ID, SP_CLIENT_SECRET, SP_REFRESH_TOKEN
 *     (optional) SP_REGION = na|eu|fe , SP_MARKETPLACE_ID = ATVPDKIKX0DER
 *
 * Tabs:
 *   Settings       editable knobs (transit days, cutoff day, safety stock, growth)
 *   Inventory      SKU, Title, FBA Available (Fulfillable)        ← import or manual
 *   Sales          SKU, Date, Units  (feeds forecast velocity)    ← import or manual
 *   Shipments      Ship Date, ETA, Amazon Selling Month, FBA ID, SKU, Qty, Mode, Shipment Status, Transit Days
 *   Planning View  OUTPUT (computed) — never edit by hand
 */

/* ===================== Constants ===================== */

var TAB = {
  SETTINGS: 'Settings',
  INVENTORY: 'Inventory',
  SALES: 'Sales',
  SHIPMENTS: 'Shipments',
  PLANNING: 'Planning View',
};

// Statuses that count toward future receiving (per user's condition).
// CREATED = AWD shipments that are created but not yet shipped.
var INCLUDED_STATUSES = { WORKING: 1, READY_TO_SHIP: 1, SHIPPED: 1, IN_TRANSIT: 1, CREATED: 1, CHECKED_IN: 1 };

var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Seasonal demand multipliers by 0-based month (Jul Prime Day, Nov BFCM, Dec Xmas).
var SEASONALITY = {
  0: 0.9, 1: 0.9, 2: 1.0, 3: 1.0, 4: 1.0, 5: 1.0,
  6: 1.3, 7: 1.0, 8: 1.0, 9: 1.05, 10: 1.5, 11: 1.4,
};

var HEADER_BG = '#0f172a';
var HEADER_FG = '#ffffff';
var INPUT_BG = '#fff7ed';
var OUTPUT_BG = '#ecfeff';

// Shipments tab column order (matches the user's desired format).
//  1 Ship Date · 2 ETA · 3 Amazon Selling Month · 4 FBA ID · 5 SKU ·
//  6 Qty · 7 Mode · 8 Shipment Status · 9 Transit Days
var SHIP_HEADERS = ['Ship Date', 'ETA', 'Amazon Selling Month', 'FBA ID', 'SKU',
                    'Qty', 'Mode', 'Shipment Status', 'Transit Days', 'Shipment Name'];
var DATE_FMT = 'dd/MM/yyyy';

// SP-API
var LWA_URL = 'https://api.amazon.com/auth/o2/token';
var SHIPMENTS_MONTHS = 5;       // how far back to look for inbound shipments

/* ===================== Menu ===================== */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  var brands = sheetBrands_();                 // this sheet's brand(s)
  // ORDERS DATA sheet → show ONLY the Orders pull/sync menu (this file owns the raw Orders).
  if (isOrdersDataSheet_() && brands.length) { buildOrdersDataMenu_(ui, brands[0]); return; }
  // PLANNING workbook → only the planning builds (it holds no source data of its own).
  if (isPlanningSheet_()) { buildPlanningMenu_(ui); return; }

  var mode = sheetBrand_();                      // '' = legacy DUAL, else single brand
  var isCpc = brands.some(function (b) { return b.pfx === 'CPC'; });

  var debug = ui.createMenu('🐞 Debug')
    .addItem('Find a shipment (why missing)', 'debugFindShipment')
    .addItem('Inspect one ACTIVE plan', 'debugInspectActivePlan')
    .addItem('Inspect one AWD shipment', 'debugInspectAwd')
    .addItem('Inspect one Catalog ASIN', 'debugCatalogAsin')
    .addItem('Shipment receiving (Inventory)', 'debugShipmentReceiving');

  // MAIN sheet — NO Orders items (Orders live in the separate Orders Data sheet now).
  var menu = ui.createMenu(mode ? ('📊 Amazon Report — ' + brands[0].label) : '📊 Amazon Report')
    .addItem('♻️ Refresh EVERYTHING now (auto-continues till done)', 'refreshEverything')
    .addItem('⏰ Install auto-refresh (9 AM + 5 PM daily)', 'installAutoRefresh')
    .addItem('⏱️ Install Firebase sync (every 3 hours)', 'installHourlyRefresh')
    .addItem('⏰ Remove auto-refresh', 'removeAutoRefresh')
    .addItem('⏱️ Remove Firebase sync trigger', 'removeHourlyRefresh')
    .addItem('🛑 Stop the running refresh chain', 'stopRefreshChain')
    .addItem('📈 Rebuild sales-history cache (for the Replenishment app)', 'rebuildHistCache')
    .addSeparator();
  brands.forEach(function (b) { menu.addItem('Check ' + b.label + ' credentials', b.fnCred); });
  menu.addSeparator();
  brands.forEach(function (b) { menu.addItem('Pull ' + b.label + ' Shipments', b.fnShip); });
  menu.addItem('📦 Shipment history (12 mo · month-wise)', 'buildShipmentHistory');
  menu.addItem('📋 Shipment lines (12 mo · Name/Date/FBA ID/SKU/Qty)', 'buildShipmentLines');
  menu.addSeparator();
  menu.addItem('📈 Build Daily Performance' + (mode ? '' : ' (Ridhi + CPC)'), 'buildAllDailyPerformance');
  menu.addSeparator();
  brands.forEach(function (b) { menu.addItem('Build ' + b.label + ' Catalog', b.fnCat); });
  menu.addSeparator();
  brands.forEach(function (b) { menu.addItem('Build ' + b.label + ' Inventory', b.fnInv); });
  menu.addSeparator()
    .addItem('📈 Build Demand forecast (12 mo · editable)', 'buildDemand')
    .addItem('⏳ Build Inventory Age (FBA aging)', 'buildInventoryAge');
  menu.addSeparator()
    .addItem('📅 Set up / open Events tab (exclude spike days)', 'setupEventsTab')
    .addItem('🔥 Check Firebase connection', 'checkFirebaseConnection')
    .addItem('🔥 Sync ALL to Firebase' + (mode ? '' : ' (Ridhi + CPC)'), 'syncAllToFirebase');
  menu.addSeparator()
    .addSubMenu(debug)
    .addToUi();
}

/**
 * Menu shown on the PLANNING workbook. It builds Demand + Inventory Age for BOTH brands, pulling
 * Orders from the Orders Data sheets and Catalog/Settings from the main sheets via openById.
 * Needs SP_* and CPC_* credentials in THIS script's properties (Inventory Age calls SP-API).
 */
function buildPlanningMenu_(ui) {
  ui.createMenu('🧭 Planning')
    .addItem('📈 Build Demand forecast (12 mo · editable)', 'buildDemand')
    .addItem('⏳ Build Inventory Age (FBA aging)', 'buildInventoryAge')
    .addSeparator()
    .addItem('Check Ridhi credentials', 'checkSpCredentials')
    .addItem('Check CPC credentials', 'checkCpcCredentials')
    .addToUi();
}

/** Menu shown on an "Orders Data" sheet — pull / sync / dedup / auto-sync for its one brand. */
function buildOrdersDataMenu_(ui, b) {
  ui.createMenu('📦 Orders — ' + b.label)
    .addItem('Check ' + b.label + ' credentials', b.fnCred)
    .addSeparator()
    .addItem('⬇️ Initial Orders import (2025 → now, once)', b.fnOrdInit)
    .addItem('🔄 Sync Orders (last ' + ORDERS_SYNC_DAYS + ' days)', b.fnOrdSync)
    .addItem('🧹 Remove duplicate Orders', 'ordersDedupe')
    .addSeparator()
    .addItem('⏱️ Install Orders auto-sync (every 6 h)', 'installOrdersAutoSync')
    .addItem('⏱️ Remove Orders auto-sync', 'removeOrdersAutoSync')
    .addSeparator()
    .addItem('📊 Month revenue breakdown', 'debugMonthRevenue')
    .addToUi();
}

/* ===================== Refresh Everything + auto-refresh ===================== */

// true during Refresh Everything / time-triggers → per-step UI alerts are suppressed
// (so it runs cleanly in the background without needing anyone to click OK).
var SILENT_RUN = false;

// Shared hard stop (epoch ms) for a chained run like refreshEverything. 0 = unset
// (function runs standalone with its own full budget). When set, every heavy
// importer caps its own internal deadline to this via capDeadline_ so no single
// phase can eat the whole execution and starve Inventory + Firebase.
var RUN_DEADLINE = 0;

// A proposed "Date.now() + ms" deadline, capped by RUN_DEADLINE when a chained
// run is in progress. Standalone (RUN_DEADLINE == 0) → returns the full budget.
function capDeadline_(ms) {
  var d = Date.now() + ms;
  return RUN_DEADLINE ? Math.min(d, RUN_DEADLINE) : d;
}

/* ---- Resumable "Refresh Everything" (auto-continues across the exec-time limit) ----
 * Runs the 7 steps ONE BY ONE. Each execution works within a ~24-min soft budget
 * (every importer caps itself to RUN_DEADLINE), checkpoints progress after each step
 * in Script Property REFRESH_STATE, and if there's more to do it schedules a one-time
 * continuation trigger that resumes from the exact step it left off — so it keeps
 * restarting itself until EVERY step reports COMPLETE (incl. multi-execution Orders
 * backfills). A pre-scheduled 29-min "safety" continuation covers the case where an
 * execution is hard-killed at the 30-min limit before it can stop gracefully. */

/* ---- Per-sheet BRAND mode (single-sheet-per-brand split) ----------------------------
 * ONE Code.gs serves both brands. Historically a SINGLE sheet held both (Orders + CPC
 * Orders, Inventory + CPC Inventory, …). To split the data into two lighter workbooks,
 * set Script Property SHEET_BRAND = 'SP' (Ridhi) or 'CPC' on each sheet — that sheet then
 * only builds / refreshes / SYNCS its own brand (so one sheet never clobbers the other's
 * fba_* Firestore docs). If SHEET_BRAND is UNSET the code stays in legacy DUAL mode (both
 * brands) — nothing changes until each sheet's property is set. Tab names stay as they are
 * (Ridhi uses 'Orders'/'Inventory', CPC keeps 'CPC Orders'/'CPC Inventory'). */
var BRANDS_ALL = [
  { pfx: 'SP',  key: 'ridhi', label: 'Ridhi', ordTab: 'Orders',     invTab: 'Inventory',     shipTab: 'Shipments',     dpTab: 'Daily Performance',
    fnCred: 'checkSpCredentials', fnShip: 'importShipmentsFromAmazon', fnOrdInit: 'ordersInitialRidhi', fnOrdSync: 'ordersSyncRidhi', fnCat: 'buildRidhiCatalog', fnInv: 'importRidhiInventory' },
  { pfx: 'CPC', key: 'cpc',   label: 'CPC',   ordTab: 'CPC Orders', invTab: 'CPC Inventory', shipTab: 'CPC Shipments', dpTab: 'CPC Daily Performance',
    fnCred: 'checkCpcCredentials', fnShip: 'importCpcShipments', fnOrdInit: 'ordersInitialCpc', fnOrdSync: 'ordersSyncCpc', fnCat: 'buildCpcCatalog', fnInv: 'importCpcInventory' },
];
// The two split workbooks — a sheet AUTO-DETECTS its brand from its own file id, so no
// Script Property setup is needed. (An explicit SHEET_BRAND property still overrides, e.g.
// for a test copy.)
var RIDHI_SHEET_ID = '1QPTz69Q128OWAm2ewe13jkciXOC9CUfkmVEJMA-iKKo';
var CPC_SHEET_ID   = '1UHHVMqUu3Q2vfLQRKvbOnesjvjL_YdKg2KCh-G084fg';
// The raw Orders live in SEPARATE "Orders Data" workbooks (one per brand) to keep the main
// sheets light. Same Code.gs is deployed to all four; each file AUTO-DETECTS its role + brand
// from its own id: a DATA sheet PULLS/holds Orders; a MAIN sheet READS them via openById.
var RIDHI_ORDERS_DATA_ID = '1OLIo0mYIgClBuABrfivPoLG-M1xS_rLwkQpFRAF_0kA';   // Ridhi Orders Data SPREADSHEET id
var CPC_ORDERS_DATA_ID   = '1jjDNWNF327mVQTKfmcadioB5AO5A9BP_9M1CC9t4L2o';   // CPC Orders Data SPREADSHEET id
// PLANNING workbook (production orders + Demand + Inventory Age). Holds BOTH brands, so it stays in
// dual mode; it owns no source data — Orders come from the Orders Data sheets and Catalog/Settings
// from the main sheets, all via openById (same fetch-from-another-sheet pattern as Orders).
var PLANNING_SHEET_ID = '1kKeuVH70bY3l2hLvMOpZlTPgCo1ShPcDY2Fw2l0O-Bk';

/** This sheet's brand ('SP' | 'CPC'), or '' if unknown. Explicit SHEET_BRAND wins; else the
 *  active file id decides — matches the MAIN sheet OR that brand's Orders Data sheet. */
function sheetBrand_() {
  var b = prop_('SHEET_BRAND').toUpperCase();
  if (b === 'SP' || b === 'CPC') return b;
  try {
    var id = SpreadsheetApp.getActiveSpreadsheet().getId();
    if (id === CPC_SHEET_ID   || id === CPC_ORDERS_DATA_ID)   return 'CPC';
    if (id === RIDHI_SHEET_ID || id === RIDHI_ORDERS_DATA_ID) return 'SP';
  } catch (e) {}
  return '';
}
/** True when THIS file is an "Orders Data" sheet (it pulls + holds the raw Orders itself). */
function isOrdersDataSheet_() {
  try { var id = SpreadsheetApp.getActiveSpreadsheet().getId();
    return id === RIDHI_ORDERS_DATA_ID || id === CPC_ORDERS_DATA_ID; } catch (e) { return false; }
}
/** True when THIS file is the PLANNING workbook (production orders + Demand + Inventory Age). */
function isPlanningSheet_() {
  try { return SpreadsheetApp.getActiveSpreadsheet().getId() === PLANNING_SHEET_ID; } catch (e) { return false; }
}
/** The MAIN workbook for the brand currently being processed (holds Catalog + Settings).
 *  Returns the active file when it IS that main sheet, else opens it. */
function mainSS_() {
  var wantCpc = (ACTIVE_PREFIX === 'CPC');
  try {
    var id = SpreadsheetApp.getActiveSpreadsheet().getId();
    if (id === (wantCpc ? CPC_SHEET_ID : RIDHI_SHEET_ID)) return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {}
  return SpreadsheetApp.openById(wantCpc ? CPC_SHEET_ID : RIDHI_SHEET_ID);
}
/** Where the brand's Catalog tab lives — always the main sheet. */
function catalogSS_() { return mainSS_(); }
/** Brand descriptors this sheet should operate on: the one configured brand, else BOTH. */
function sheetBrands_() { var b = sheetBrand_(); return b ? BRANDS_ALL.filter(function (x) { return x.pfx === b; }) : BRANDS_ALL; }

var REFRESH_STATE_KEY = 'REFRESH_STATE';
var REFRESH_SOFT_MS = 24 * 60 * 1000;   // stop new work by 24 min (well under the 30-min kill)

/** The ordered steps. `min` = minutes that must remain to START the step this run. */
function refreshPhases_() {
  var brands = sheetBrands_();
  var phases = [];
  // NOTE: Orders pull was removed 2026-07-07 (Orders module is being rebuilt from scratch).
  // The new Orders refresh will run on its own separate schedule.
  brands.forEach(function (b) { phases.push({ name: b.label + ' Shipments', min: 5, fn: function () { importShipmentsForAccount_(b.pfx, b.shipTab, b.label, true); } }); });
  brands.forEach(function (b) { phases.push({ name: b.label + ' Inventory', min: 4, fn: function () { buildInventoryForAccount_(b.pfx, b.invTab, b.label); } }); });
  brands.forEach(function (b) { phases.push({ name: b.label + ' Daily Performance', min: 5, fn: function () { refreshDailyPerformanceFor_(b.pfx, b.dpTab, b.ordTab, b.label); } }); });
  // Year sales-history per SKU, cached into a hidden tab. Heavy (a full Orders-log scan), so it runs
  // HERE and never inside the replenishment web app — doing it per request took ~90s and made the
  // endpoint fail. The web app just reads whatever this last left behind.
  phases.push({ name: 'Sales-history cache', min: 4, fn: function () { rebuildHistCache(); } });
  phases.push({ name: 'Firebase sync', min: 3, fn: function () {
    if (!prop_('FIREBASE_PROJECT_ID')) return;
    sheetBrands_().forEach(function (b) {
      syncInventoryToFirestore_(b.pfx, b.invTab, b.key, b.label, true);
      syncSalesAnalysis_(b.pfx, b.key, b.label);
      syncParentWoW_(b.pfx, b.key, b.label);
      syncDailyPerformance_(b.pfx, b.key, b.label);
    });
  } });
  return phases;
}

// Menu "Refresh now" — START a fresh resumable chain from step 1.
function refreshEverything() {
  PropertiesService.getScriptProperties().deleteProperty(REFRESH_STATE_KEY);
  removeContinuationTriggers_();
  refreshChain_(true);
}
// Trigger handlers (daily + one-time continuation) — RESUME from the saved step.
function refreshEverythingResume() { refreshChain_(false); }   // daily 9 AM / 5 PM
function refreshEverythingCont()   { refreshChain_(false); }   // one-time continuation

/** Core orchestrator. fresh=true starts at step 0; otherwise resumes REFRESH_STATE. */
function refreshChain_(fresh) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { Logger.log('refreshChain: another instance is running — skip.'); return; }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var props = PropertiesService.getScriptProperties();
    var PHASES = refreshPhases_();

    var state = null;
    if (!fresh) { try { state = JSON.parse(props.getProperty(REFRESH_STATE_KEY) || 'null'); } catch (e) {} }
    if (!state) state = { i: 0, runs: 0, log: [] };
    state.runs = (state.runs || 0) + 1;
    // Runaway guard: never let the self-continuation loop go on forever.
    if (state.runs > 40) { props.deleteProperty(REFRESH_STATE_KEY); removeContinuationTriggers_();
      Logger.log('refreshChain: aborting — exceeded 40 continuations.'); return; }

    var prevSilent = SILENT_RUN; SILENT_RUN = true;
    var softDeadline = Date.now() + REFRESH_SOFT_MS;
    RUN_DEADLINE = softDeadline;
    ensureSafetyContinuation_();   // hard-kill backstop (fires ~29 min out if we never stop cleanly)

    while (state.i < PHASES.length) {
      var ph = PHASES[state.i];
      // Don't START a step we can't reasonably make progress on this run → resume it next execution.
      if (Date.now() > softDeadline - ph.min * 60 * 1000) break;
      try { ss.toast('Step ' + (state.i + 1) + '/' + PHASES.length + ': ' + ph.name + '…', '♻️ Auto-Refresh', 30); } catch (e) {}
      try { ph.fn(); state.log.push('✅ ' + ph.name); }
      catch (e) { state.log.push('⚠️ ' + ph.name + ': ' + (e.message || e)); Logger.log('refreshChain ' + ph.name + ': ' + e); }
      state.i++;
      props.setProperty(REFRESH_STATE_KEY, JSON.stringify(state));   // checkpoint
    }

    RUN_DEADLINE = 0; SILENT_RUN = prevSilent;

    if (state.i >= PHASES.length) {
      props.deleteProperty(REFRESH_STATE_KEY);
      removeContinuationTriggers_();
      try { ss.toast('Auto-Refresh COMPLETE ✅ — all ' + PHASES.length + ' steps done.', '♻️ Auto-Refresh', 10); } catch (e) {}
      try { SpreadsheetApp.getUi().alert('♻️ Auto-Refresh COMPLETE', state.log.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
    } else {
      props.setProperty(REFRESH_STATE_KEY, JSON.stringify(state));
      scheduleContinuation_(90 * 1000);   // resume in ~2 min from the current step
      try { ss.toast('Paused at step ' + (state.i + 1) + '/' + PHASES.length + ' (' + PHASES[state.i].name + ') — auto-continues in ~2 min.', '♻️ Auto-Refresh', 12); } catch (e) {}
    }
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/** Menu: stop an in-progress resumable refresh (clears its checkpoint + pending
 *  continuation triggers) WITHOUT removing the daily 9 AM / 5 PM auto-refresh. */
function stopRefreshChain() {
  removeContinuationTriggers_();
  PropertiesService.getScriptProperties().deleteProperty(REFRESH_STATE_KEY);
  try { SpreadsheetApp.getUi().alert('Refresh chain stopped ✅',
    'The running refresh was stopped and its progress cleared. The daily 9 AM / 5 PM ' +
    'auto-refresh is still installed — the next run starts fresh from step 1.',
    SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}

/** Delete only the one-time continuation triggers (handler refreshEverythingCont). */
function removeContinuationTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshEverythingCont') ScriptApp.deleteTrigger(t);
  });
}
/** Replace any pending continuation with a fresh one-time trigger `ms` from now. */
function scheduleContinuation_(ms) {
  removeContinuationTriggers_();
  ScriptApp.newTrigger('refreshEverythingCont').timeBased().after(ms).create();
}
/** Backstop: if THIS execution is hard-killed at the 30-min limit before it can stop
 *  gracefully, this ~29-min continuation resumes it. Graceful stops replace it (sooner)
 *  and full completion deletes it. */
function ensureSafetyContinuation_() { scheduleContinuation_(29 * 60 * 1000); }

/** Install daily server-side triggers at ~9 AM and ~5 PM (run even when your PC is off /
 *  offline). They call the RESUMABLE chain, which self-continues until every step is done. */
function installAutoRefresh() {
  removeAutoRefresh();
  ScriptApp.newTrigger('refreshEverythingResume').timeBased().atHour(9).everyDays(1).create();
  ScriptApp.newTrigger('refreshEverythingResume').timeBased().atHour(17).everyDays(1).create();
  SpreadsheetApp.getUi().alert('Auto-refresh installed ✅',
    'Refresh runs automatically every day at ~9 AM and ~5 PM (' + Session.getScriptTimeZone() + ' time), ' +
    'on Google\'s servers — so it works even when your computer is off or offline. It runs the steps ' +
    'one by one and, if it hits the execution-time limit, it AUTO-RESTARTS itself and continues from where ' +
    'it left off until every step is complete.\n\nUse "Remove auto-refresh" to stop it.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}
function removeAutoRefresh() {
  var names = { refreshEverything: 1, refreshEverythingResume: 1, refreshEverythingCont: 1 };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getScriptProperties().deleteProperty(REFRESH_STATE_KEY);
}

/* ---- HOURLY: Orders (both) + today's sales + Firebase sync ----
 * Light, runs EVERY hour on Google's servers. Pulls fresh Orders (incremental
 * top-up), refreshes ONLY today's live Daily-Performance days from those Orders (no
 * heavy Amazon report re-pull), and pushes the sales-side docs to Firebase so the
 * dashboard's Sales / Sales-Analysis / Parent-W-o-W stay current through the day.
 * Inventory L30/L90 + the full Sales & Traffic report still rebuild at 9 AM / 5 PM. */
function hourlyRefresh() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { Logger.log('hourlyRefresh: another refresh is running — skip.'); return; }
  var prevSilent = SILENT_RUN; SILENT_RUN = true;
  RUN_DEADLINE = Date.now() + 20 * 60 * 1000;
  try {
    var brands = sheetBrands_();   // this sheet's brand(s) only (single-brand after the split)
    // NOTE: the Orders pull was removed 2026-07-07 (Orders module is being rebuilt from scratch).
    // 1) Daily Performance — LIGHT refresh: re-synthesise TODAY's live days from the Orders tab
    //    (whatever data it holds; no Amazon report call). Heavy report refresh is in the daily chain.
    brands.forEach(function (b) { try { refreshDailyPerfLive_(b.pfx, b.dpTab, b.ordTab); } catch (e) { Logger.log('hourly ' + b.label + ' DP: ' + e); } });
    // 2) Sync the sales-side docs to Firebase (all recompute from Orders / the DP tab).
    if (prop_('FIREBASE_PROJECT_ID')) {
      brands.forEach(function (b) {
        try { syncDailyPerformance_(b.pfx, b.key, b.label); } catch (e) { Logger.log('hourly DP sync ' + b.label + ': ' + e); }
        try { syncSalesAnalysis_(b.pfx, b.key, b.label); }    catch (e) { Logger.log('hourly SA sync ' + b.label + ': ' + e); }
        try { syncParentWoW_(b.pfx, b.key, b.label); }        catch (e) { Logger.log('hourly PW sync ' + b.label + ': ' + e); }
      });
    }
  } finally {
    RUN_DEADLINE = 0; SILENT_RUN = prevSilent;
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Install an hourly server-side trigger for hourlyRefresh (Daily Performance live + Firebase sync). */
// Runs every REFRESH_EVERY_HOURS hours, not hourly. Measured 2026-08-03: each run took 856-1119 s
// (15-19 MINUTES), so at hourly cadence the script sat busy ~25-30% of the time — and while it is
// saturated, big Replenishment web-app responses fail on DELIVERY (the client gets a 404 Drive page
// even though doGet itself completed). Every 3 h cuts that duty cycle to ~1/3.
var REFRESH_EVERY_HOURS = 3;
function installHourlyRefresh() {
  removeHourlyRefresh();
  ScriptApp.newTrigger('hourlyRefresh').timeBased().everyHours(REFRESH_EVERY_HOURS).create();
  SpreadsheetApp.getUi().alert('Refresh trigger installed ✅',
    'EVERY ' + REFRESH_EVERY_HOURS + ' HOURS (on Google\'s servers): refreshes today\'s live Daily ' +
    'Performance from the Orders tab and syncs Sales · Sales Analysis · Parent W-o-W to the dashboard.' +
    '\n\nIt used to run hourly, but each run takes 15-19 minutes — that kept the script busy and made ' +
    'the Replenishment app\'s "Refresh from sheet" fail on delivery.\n\nThe heavy parts (full Amazon ' +
    'Sales & Traffic report + Inventory L30/L90) still rebuild at 9 AM & 5 PM via "Install auto-refresh" ' +
    '— keep that installed too.\n\nUse "Remove hourly refresh" to stop it.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}
function removeHourlyRefresh() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'hourlyRefresh') ScriptApp.deleteTrigger(t);
  });
}

/* ===================== Structure builder ===================== */

function buildStructure() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  buildSettingsTab_(ss);
  buildInventoryTab_(ss);
  buildSalesTab_(ss);
  buildShipmentsTab_(ss);
  buildPlanningTab_(ss);

  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) { try { ss.deleteSheet(def); } catch (e) {} }

  ss.setActiveSheet(ss.getSheetByName(TAB.PLANNING));
  SpreadsheetApp.getUi().alert(
    'Structure ready ✅\n\nTabs: Settings, Inventory, Sales, Shipments, Planning View.\n\n' +
    'Next: fill data manually OR use "Import from Amazon", then "② Recompute Planning View".'
  );
}

function getOrCreate_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function header_(sh, headers) {
  sh.clear();
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontColor(HEADER_FG).setBackground(HEADER_BG).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, headers.length);
}

function buildSettingsTab_(ss) {
  var sh = getOrCreate_(ss, TAB.SETTINGS);
  var existing = readSettingsRaw_(sh);
  function keep(k, d) { return existing[k] != null ? existing[k] : d; }
  header_(sh, ['Setting', 'Value', 'Notes']);
  var rows = [
    ['Air Transit Days',  keep('Air Transit Days', 15), 'ETA = Dispatch + this (Air)'],
    ['Sea Transit Days',  keep('Sea Transit Days', 80), 'ETA = Dispatch + this (Sea)'],
    ['AWD Transit Days',  keep('AWD Transit Days', 7), 'ETA = Ship Date + this (FBA shipments with no Air/Sea in name). STAR-* AWD source uses Sea (80).'],
    ['Month Cutoff Day',  keep('Month Cutoff Day', 20), 'ETA day > cutoff → next month receiving'],
    ['Safety Stock Days', keep('Safety Stock Days', 30), 'Buffer for dispatch recommendation'],
    ['YoY Growth %',      keep('YoY Growth %', 0), 'Scales forecast demand, e.g. 20 = +20%'],
  ];
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
  sh.getRange(2, 2, rows.length, 1).setBackground(INPUT_BG).setFontWeight('bold');
  sh.setColumnWidth(1, 170); sh.setColumnWidth(3, 340);
}

// Ridhi-Inv-style: identity (from Catalog) + live FBA/AWD + sales buckets (from Orders).
var INV_HEADERS = ['SKU', 'Image', 'ASIN', 'Parent ASIN', 'Color', 'Size', 'Sub-Category',
  'FBA Available', 'Inbound', 'Reserved', 'Unsellable', 'AWD Available', 'AWD Transit', 'Total Stock',
  'Yesterday', 'Today', 'Last 7 Days', 'Last 14 Days', 'Last 30 Days', 'Last 90 Days', 'This Month', 'UpdatedAt'];

function buildInventoryTab_(ss, tabName) {
  tabName = tabName || TAB.INVENTORY;
  var sh = getOrCreate_(ss, tabName);
  header_(sh, INV_HEADERS);
  sh.setColumnWidth(1, 170); sh.setColumnWidth(2, 70);
  noteOn_(sh, 'Live FBA + AWD inventory + sales buckets. Identity from Catalog tab; ' +
    'sales from Orders tab (MCF + Cancelled excluded). Total = FBA + Inbound + Reserved + AWD.');
  return sh;
}

/** Any cell value -> epoch ms (date only). */
function toMs_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getTime();
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Date.UTC(+m[1], (+m[2]) - 1, +m[3]);
  return 0;
}

/** Read a brand's Catalog tab into { sku: {asin,parent,image,color,size,subcat} }. */
function readCatalogMap_(ss, catTab) {
  var sh = ss.getSheetByName(catTab), map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  var nc = Math.min(13, sh.getLastColumn());
  sh.getRange(2, 1, sh.getLastRow() - 1, nc).getValues().forEach(function (r) {
    var sku = String(r[0] || '').trim();
    if (sku) map[sku] = { asin: r[1] || '', parent: r[3] || '', title: r[4] || '', image: r[6] || '',
      color: r[7] || '', size: r[8] || '', subcat: r[9] || '', parentTitle: (r.length > 12 ? (r[12] || '') : '') };
  });
  return map;
}

/**
 * Unit-sales buckets per SKU from a brand's Orders tab. PT-anchored dates.
 * SKIPS orders tagged MCF (col J) and Cancelled (col H) — per user's requirement.
 */
function computeSalesBucketsFromOrders_(ss, ordTab) {
  var out = {}, sh = ordersSS_().getSheetByName(ordTab);
  if (!sh || sh.getLastRow() < 2) return out;
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, ORDERS_HEADERS.length).getValues();
  var DAY = 86400000, PT = 'America/Los_Angeles';
  var todayMs = new Date(Utilities.formatDate(new Date(), PT, 'yyyy-MM-dd') + 'T00:00:00Z').getTime();
  var yMs = todayMs - DAY, l7 = todayMs - 7 * DAY, l14 = todayMs - 14 * DAY,
      l30 = todayMs - 30 * DAY, l90 = todayMs - 90 * DAY;
  var monthStartMs = new Date(Utilities.formatDate(new Date(), PT, 'yyyy-MM') + '-01T00:00:00Z').getTime();

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var sku = String(row[3] || '').trim();
    if (!sku) continue;
    if (String(row[9] || '').toUpperCase() === 'MCF') continue;           // skip MCF orders
    if (String(row[7] || '').toLowerCase() === 'cancelled') continue;     // skip cancelled
    var units = Number(row[5]) || 0;
    if (!units) continue;
    var amt = Number(row[6]) || 0;   // col G = Revenue (amount)
    var purch = row[1], dMs;
    if (purch instanceof Date && !isNaN(purch.getTime())) {
      dMs = new Date(Utilities.formatDate(purch, PT, 'yyyy-MM-dd') + 'T00:00:00Z').getTime();
    } else {
      var d = new Date(purch);
      dMs = isNaN(d.getTime()) ? toMs_(row[2]) : new Date(Utilities.formatDate(d, PT, 'yyyy-MM-dd') + 'T00:00:00Z').getTime();
    }
    if (!dMs) continue;
    var b = out[sku] || { y: 0, t: 0, l7: 0, l14: 0, l30: 0, l90: 0, l90amt: 0, tm: 0 };
    if (dMs === todayMs) b.t += units;
    if (dMs === yMs) b.y += units;
    if (dMs >= l7) b.l7 += units;
    if (dMs >= l14) b.l14 += units;
    if (dMs >= l30) b.l30 += units;
    if (dMs >= l90) { b.l90 += units; b.l90amt += amt; }
    if (dMs >= monthStartMs) b.tm += units;
    out[sku] = b;
  }
  return out;
}

function buildSalesTab_(ss) {
  var sh = getOrCreate_(ss, TAB.SALES);
  header_(sh, ['SKU', 'Date', 'Units']);
  sh.getRange(2, 1, Math.max(1, sh.getMaxRows() - 1), 3).setBackground(INPUT_BG);
  sh.getRange(2, 2, sh.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');
  noteOn_(sh, 'Daily units sold per SKU — feeds 30/60/90-day velocity. Use "Import orders → Sales".');
}

function buildShipmentsTab_(ss, tabName) {
  tabName = tabName || TAB.SHIPMENTS;
  var sh = getOrCreate_(ss, tabName);
  header_(sh, SHIP_HEADERS);
  var maxR = Math.max(50, sh.getMaxRows());
  sh.getRange(2, 1, maxR - 1, SHIP_HEADERS.length).setBackground(INPUT_BG);
  // Auto-computed columns: ETA(2), Amazon Selling Month(3), Transit Days(9)
  sh.getRange(2, 2, maxR - 1, 2).setBackground(OUTPUT_BG);
  sh.getRange(2, 9, maxR - 1, 1).setBackground(OUTPUT_BG);
  sh.getRange(2, 1, maxR - 1, 1).setNumberFormat(DATE_FMT);  // Ship Date
  sh.getRange(2, 2, maxR - 1, 1).setNumberFormat(DATE_FMT);  // ETA
  sh.getRange(2, 3, maxR - 1, 1).setNumberFormat('@');       // Amazon Selling Month = plain text (no date auto-convert)
  sh.getRange(2, 6, maxR - 1, 1).setNumberFormat('#,##0');   // Qty (numeric, never a date)
  sh.getRange(2, 9, maxR - 1, 1).setNumberFormat('0');       // Transit Days (numeric)

  var modeRule = SpreadsheetApp.newDataValidation().requireValueInList(['Air', 'Sea', 'AWD'], true).build();
  sh.getRange(2, 7, maxR - 1, 1).setDataValidation(modeRule);   // Mode
  var statusList = ['Created', 'Working', 'Ready to Ship', 'Shipped', 'In Transit', 'Receiving', 'Delivered', 'Checked In', 'Closed'];
  var statusRule = SpreadsheetApp.newDataValidation().requireValueInList(statusList, true).build();
  sh.getRange(2, 8, maxR - 1, 1).setDataValidation(statusRule); // Shipment Status

  sh.setColumnWidth(3, 150); sh.setColumnWidth(4, 140); sh.setColumnWidth(5, 150);
  sh.setColumnWidth(10, 320);   // Shipment Name (shows the real Amazon name → mode source)
  noteOn_(sh, 'One row per shipment line. Transit Days auto-fills from Mode (Air/Sea in Settings); ' +
    'ETA = Ship Date + Days; Amazon Selling Month = month the stock becomes sellable (ETA + cutoff day). ' +
    'Import brings Working / Ready to Ship / Shipped / In Transit shipments.');
}

/** "June 2026" — the month stock becomes sellable, from ETA + cutoff day. */
function sellingMonthLabel_(eta, cutoffDay) {
  var ym = allocateReceivingMonth_(eta, cutoffDay);
  return MONTH_NAMES[ym.month] + ' ' + ym.year;
}

function buildPlanningTab_(ss) {
  var sh = getOrCreate_(ss, TAB.PLANNING);
  header_(sh, ['SKU', 'Title', 'FBA Available', 'Current Mo. Receiving',
    'Next Mo. Receiving', 'Future Receiving', 'Total Supply',
    'Daily Sales', 'Stockout Date', 'Days Cover', 'Ship Air', 'Ship Sea']);
  noteOn_(sh, 'OUTPUT — built by "② Recompute Planning View". Do not edit by hand.');
}

function noteOn_(sh, text) { sh.getRange(1, 1).setNote(text); }

/* ===================== Settings ===================== */

function readSettingsRaw_(sh) {
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < vals.length; i++) if (vals[i][0] !== '') out[String(vals[i][0])] = vals[i][1];
  return out;
}

function getSettings_() {
  // The planning workbook has no Settings tab of its own — fall back to the brand's main sheet so
  // transit days / cutoff / safety stock / growth stay defined in ONE place.
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB.SETTINGS);
  if (!sh) { try { sh = mainSS_().getSheetByName(TAB.SETTINGS); } catch (e) {} }
  var raw = readSettingsRaw_(sh);
  function n(key, def) { var v = Number(raw[key]); return isNaN(v) ? def : v; }
  return {
    airTransitDays: n('Air Transit Days', 15),
    seaTransitDays: n('Sea Transit Days', 80),
    awdTransitDays: n('AWD Transit Days', 7),
    cutoffDay: n('Month Cutoff Day', 20),
    safetyStockDays: n('Safety Stock Days', 30),
    growthPct: n('YoY Growth %', 0),
  };
}

/* ===================== Core planning logic ===================== */

function normMode_(s) {
  s = String(s || '').trim().toUpperCase();
  if (s.indexOf('AIR') === 0) return 'AIR';
  if (s.indexOf('AWD') === 0) return 'AWD';
  return 'SEA';
}
// True when the value is a recognised mode (Air / Sea / AWD).
function isKnownMode_(s) { return /\bair\b|\bsea\b|ocean|\bawd\b/i.test(String(s || '')); }
function normStatus_(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, '_'); }
function addDays_(d, days) { return new Date(d.getTime() + days * 86400000); }
function transitDays_(mode, settings) {
  if (mode === 'AIR') return settings.airTransitDays;
  if (mode === 'AWD') return settings.awdTransitDays;
  return settings.seaTransitDays;
}
function isIncludedInReceiving_(status) { return !!INCLUDED_STATUSES[status]; }

// ETA day <= cutoff → ETA's month; else next month.
function allocateReceivingMonth_(eta, cutoffDay) {
  var year = eta.getFullYear(), month = eta.getMonth();
  if (eta.getDate() > cutoffDay) { month += 1; if (month > 11) { month = 0; year += 1; } }
  return { year: year, month: month };
}
function monthKey_(ym) { return ym.year + '-' + ('0' + (ym.month + 1)).slice(-2); }
function monthDiff_(t, b) { return (t.year - b.year) * 12 + (t.month - b.month); }

/* ===================== Forecast ===================== */

function dailyRunRate_(salesArr, asOf) {
  if (!salesArr || !salesArr.length) return 0;
  var windows = [{ d: 30, w: 0.5 }, { d: 60, w: 0.3 }, { d: 90, w: 0.2 }];
  var blended = 0, totW = 0;
  for (var i = 0; i < windows.length; i++) {
    var start = addDays_(asOf, -windows[i].d), units = 0;
    for (var j = 0; j < salesArr.length; j++) {
      var s = salesArr[j];
      if (s.date > start && s.date <= asOf) units += s.units;
    }
    blended += (units / windows[i].d) * windows[i].w;
    totW += windows[i].w;
  }
  return totW ? blended / totW : 0;
}
function daysInMonth_(y, m) { return new Date(y, m + 1, 0).getDate(); }

function forecastSku_(fba, byMonth, velocity, settings, asOf, baseMonth) {
  var growth = 1 + settings.growthPct / 100, horizon = 6, opening = fba, stockoutDate = null;
  for (var i = 0; i < horizon; i++) {
    var y = baseMonth.year + Math.floor((baseMonth.month + i) / 12);
    var m = (baseMonth.month + i) % 12;
    var key = y + '-' + ('0' + (m + 1)).slice(-2);
    var dim = daysInMonth_(y, m);
    var effDays = (i === 0) ? Math.max(1, dim - asOf.getDate() + 1) : dim;
    var demand = Math.round(velocity * effDays * growth * (SEASONALITY[m] || 1));
    var receiving = byMonth[key] || 0;
    var supply = opening + receiving;
    var closing = supply - demand;
    if (closing < 0 && !stockoutDate) {
      var perDay = demand / effDays || 1;
      var daysUntil = Math.max(0, Math.floor(supply / perDay));
      var monthStart = (i === 0) ? asOf : new Date(y, m, 1);
      stockoutDate = addDays_(monthStart, daysUntil);   // Date object
    }
    opening = Math.max(0, closing);
  }
  var pipeline = fba;
  Object.keys(byMonth).forEach(function (k) { pipeline += byMonth[k]; });
  var coverDays = settings.seaTransitDays + settings.safetyStockDays;
  var demandToCover = Math.round(velocity * growth * coverDays);
  var deficit = Math.max(0, demandToCover - pipeline);
  var demandBeforeSea = Math.round(velocity * growth * settings.seaTransitDays);
  var air = Math.max(0, Math.min(deficit, demandBeforeSea - pipeline));
  var sea = Math.max(0, deficit - air);
  var daysCover = velocity > 0 ? Math.round(fba / velocity) : 999;
  return { stockoutDate: stockoutDate, air: air, sea: sea, daysCover: daysCover };
}

/* ===================== Main recompute ===================== */

function recompute() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = getSettings_();
  var asOf = new Date();
  var baseMonth = { year: asOf.getFullYear(), month: asOf.getMonth() };

  // Inventory: sku -> {title, fba}
  var inv = {};
  var invSh = ss.getSheetByName(TAB.INVENTORY);
  if (invSh && invSh.getLastRow() > 1) {
    var iv = invSh.getRange(2, 1, invSh.getLastRow() - 1, 3).getValues();
    for (var i = 0; i < iv.length; i++) {
      var sku = String(iv[i][0]).trim();
      if (sku) inv[sku] = { title: iv[i][1] || '', fba: Number(iv[i][2]) || 0 };
    }
  }

  // Sales: sku -> [{date, units}]
  var sales = {};
  var salesSh = ss.getSheetByName(TAB.SALES);
  if (salesSh && salesSh.getLastRow() > 1) {
    var sv = salesSh.getRange(2, 1, salesSh.getLastRow() - 1, 3).getValues();
    for (var k = 0; k < sv.length; k++) {
      var ssku = String(sv[k][0]).trim(), sdate = sv[k][1];
      if (!ssku || !(sdate instanceof Date)) continue;
      (sales[ssku] = sales[ssku] || []).push({ date: sdate, units: Number(sv[k][2]) || 0 });
    }
  }

  // Shipments: compute Days + ETA + Selling Month, allocate, bucket.
  // Columns: 0 ShipDate · 1 ETA · 2 SellingMonth · 3 FBA ID · 4 SKU ·
  //          5 Qty · 6 Mode · 7 Status · 8 TransitDays
  var recv = {};
  var shSh = ss.getSheetByName(TAB.SHIPMENTS);
  var writeback = []; // {row, days, eta, month}
  if (shSh && shSh.getLastRow() > 1) {
    var sd = shSh.getRange(2, 1, shSh.getLastRow() - 1, SHIP_HEADERS.length).getValues();
    for (var r = 0; r < sd.length; r++) {
      var row = sd[r];
      var sku2 = String(row[4]).trim();
      if (!sku2) continue;
      var dispatch = row[0];
      var etaCell = row[1];
      var qty = Number(row[5]) || 0;
      var rawMode = row[6];
      var known = isKnownMode_(rawMode);
      var mode = normMode_(rawMode);
      var status = normStatus_(row[7]);
      var days = Number(row[8]);
      var haveDays = !isNaN(days) && days > 0;
      if (!haveDays && known) { days = transitDays_(mode, settings); haveDays = true; }

      var eta = (etaCell instanceof Date) ? etaCell
              : (dispatch instanceof Date && haveDays ? addDays_(dispatch, days) : null);
      var month = eta ? sellingMonthLabel_(eta, settings.cutoffDay) : '';

      var needDays = haveDays && (isNaN(Number(row[8])) || Number(row[8]) <= 0);
      var needEta = !(etaCell instanceof Date) && eta;
      var needMonth = month && String(row[2]) !== month;
      if (needDays || needEta || needMonth) {
        writeback.push({ row: r + 2, days: needDays ? days : null,
          eta: needEta ? eta : null, month: needMonth ? month : null });
      }

      if (!eta || !qty) continue;
      if (!isIncludedInReceiving_(status)) continue;
      var bucket = (recv[sku2] = recv[sku2] || { current: 0, next: 0, future: 0, byMonth: {} });
      var ym = allocateReceivingMonth_(eta, settings.cutoffDay);
      var key = monthKey_(ym);
      bucket.byMonth[key] = (bucket.byMonth[key] || 0) + qty;
      var diff = monthDiff_(ym, baseMonth);
      if (diff <= 0) bucket.current += qty;
      else if (diff === 1) bucket.next += qty;
      else bucket.future += qty;
    }
  }
  for (var w = 0; w < writeback.length; w++) {
    if (writeback[w].eta != null) shSh.getRange(writeback[w].row, 2).setValue(writeback[w].eta);
    if (writeback[w].month != null) shSh.getRange(writeback[w].row, 3).setValue(writeback[w].month);
    if (writeback[w].days != null) shSh.getRange(writeback[w].row, 9).setValue(writeback[w].days);
  }

  // Union of SKUs
  var skuSet = {};
  Object.keys(inv).forEach(function (s) { skuSet[s] = 1; });
  Object.keys(recv).forEach(function (s) { skuSet[s] = 1; });
  Object.keys(sales).forEach(function (s) { skuSet[s] = 1; });
  var skus = Object.keys(skuSet).sort();

  var out = [];
  for (var x = 0; x < skus.length; x++) {
    var sk = skus[x];
    var fba = inv[sk] ? inv[sk].fba : 0;
    var title = inv[sk] ? inv[sk].title : '';
    var b = recv[sk] || { current: 0, next: 0, future: 0, byMonth: {} };
    var total = fba + b.current + b.next + b.future;
    var velocity = dailyRunRate_(sales[sk], asOf);
    var fc = forecastSku_(fba, b.byMonth, velocity, settings, asOf, baseMonth);
    out.push([
      sk, title, fba, b.current, b.next, b.future, total,
      round1_(velocity), fc.stockoutDate || '',
      fc.daysCover >= 999 ? '∞' : fc.daysCover,
      fc.air > 0 ? fc.air : '', fc.sea > 0 ? fc.sea : '',
    ]);
  }

  var psh = getOrCreate_(ss, TAB.PLANNING);
  buildPlanningTab_(ss);
  if (out.length) {
    psh.getRange(2, 1, out.length, out[0].length).setValues(out);
    psh.getRange(2, 9, out.length, 1).setNumberFormat(DATE_FMT);
    formatStockout_(psh, out.length);
    psh.autoResizeColumns(1, 12);
  }
  ss.toast('Planning View rebuilt — ' + out.length + ' SKUs.', 'FBA Planner', 5);
}

function formatStockout_(sh, n) {
  var rng = sh.getRange(2, 9, n, 1);
  var soon = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($I2<>"",$I2<=TODAY()+30)')
    .setBackground('#fee2e2').setFontColor('#b91c1c').setRanges([rng]).build();
  var later = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($I2<>"",$I2>TODAY()+30)')
    .setBackground('#fef3c7').setFontColor('#b45309').setRanges([rng]).build();
  sh.setConditionalFormatRules([soon, later]);
}
function round1_(n) { return Math.round(n * 10) / 10; }

/* ===================== ETA helper ===================== */

function recomputeEtas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = getSettings_();
  var sh = ss.getSheetByName(TAB.SHIPMENTS);
  if (!sh || sh.getLastRow() < 2) return;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, SHIP_HEADERS.length).getValues();
  var changed = 0;
  for (var i = 0; i < v.length; i++) {
    if (!String(v[i][4]).trim() || !(v[i][0] instanceof Date)) continue; // need SKU + Ship Date
    if (v[i][1] instanceof Date) continue;        // ETA already set (e.g. Amazon's real date) — keep it
    var known = isKnownMode_(v[i][6]);
    var days = Number(v[i][8]);
    var haveDays = !isNaN(days) && days > 0;
    if (!haveDays && known) { days = transitDays_(normMode_(v[i][6]), settings); haveDays = true; sh.getRange(i + 2, 9).setValue(days); }
    if (!haveDays) continue;                       // unknown mode + no days → can't compute, skip
    var eta = addDays_(v[i][0], days);
    sh.getRange(i + 2, 2).setValue(eta);                                  // ETA
    sh.getRange(i + 2, 3).setValue(sellingMonthLabel_(eta, settings.cutoffDay)); // Selling Month
    changed++;
  }
  ss.toast('Filled Days / ETA / Selling Month for ' + changed + ' shipment(s).', 'FBA Planner', 4);
}

/* ===================== SP-API plumbing ===================== */

// Which brand's credentials are active for the current run. Set by the import
// functions. 'SP' = Ridhi (default), 'CPC' = the second brand.
// Script Properties expected:
//   Ridhi: SP_CLIENT_ID / SP_CLIENT_SECRET / SP_REFRESH_TOKEN
//   CPC:   CPC_CLIENT_ID / CPC_CLIENT_SECRET / CPC_REFRESH_TOKEN
//   (optional per brand) <PFX>_MARKETPLACE_ID , <PFX>_REGION
var ACTIVE_PREFIX = 'SP';

function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  return v ? String(v).trim() : '';
}
function marketplaceId_() {
  return prop_(ACTIVE_PREFIX + '_MARKETPLACE_ID') || prop_('SP_MARKETPLACE_ID') || 'ATVPDKIKX0DER';
}
function spHost_() {
  var r = (prop_(ACTIVE_PREFIX + '_REGION') || prop_('SP_REGION') || 'na').toLowerCase();
  if (r === 'eu') return 'https://sellingpartnerapi-eu.amazon.com';
  if (r === 'fe') return 'https://sellingpartnerapi-fe.amazon.com';
  return 'https://sellingpartnerapi-na.amazon.com';
}
function checkCredentials_(pfx, label) {
  var miss = [pfx + '_CLIENT_ID', pfx + '_CLIENT_SECRET', pfx + '_REFRESH_TOKEN'].filter(function (k) { return !prop_(k); });
  var ui = SpreadsheetApp.getUi();
  if (miss.length) {
    ui.alert('Missing ' + label + ' credentials',
      'Open  Extensions → Apps Script → (gear) Project Settings → Script Properties,\n' +
      'and add:\n\n' + miss.join('\n') + '\n\n(' + label + "'s Amazon SP-API app values.)", ui.ButtonSet.OK);
  } else {
    ui.alert(label + ' credentials OK', 'All three ' + label + ' SP-API credentials are set.', ui.ButtonSet.OK);
  }
}
function checkSpCredentials() { checkCredentials_('SP', 'Ridhi'); }
function checkCpcCredentials() { checkCredentials_('CPC', 'CPC'); }

function getToken_() {
  var pfx = ACTIVE_PREFIX;
  var cacheKey = 'sp_token_' + pfx;
  var cache = CacheService.getScriptCache(), cached = cache.get(cacheKey);
  if (cached) return cached;
  var id = prop_(pfx + '_CLIENT_ID'), secret = prop_(pfx + '_CLIENT_SECRET'), refresh = prop_(pfx + '_REFRESH_TOKEN');
  if (!id || !secret || !refresh) throw new Error(pfx + ' credentials missing in Script Properties.');
  var resp = UrlFetchApp.fetch(LWA_URL, {
    method: 'post',
    payload: { grant_type: 'refresh_token', refresh_token: refresh, client_id: id, client_secret: secret },
    muteHttpExceptions: true,
  });
  var body = JSON.parse(resp.getContentText() || '{}');
  if (resp.getResponseCode() !== 200 || !body.access_token) throw new Error('LWA token failed: ' + resp.getContentText());
  cache.put(cacheKey, body.access_token, 3000);
  return body.access_token;
}
function sp_(path, method, payload) {
  var opt = {
    method: method || 'get', muteHttpExceptions: true,
    headers: { 'x-amz-access-token': getToken_() }, contentType: 'application/json',
  };
  if (payload) opt.payload = JSON.stringify(payload);
  var resp = UrlFetchApp.fetch(spHost_() + path, opt);
  var text = resp.getContentText();
  if (resp.getResponseCode() >= 300) throw new Error('SP-API ' + resp.getResponseCode() + ' on ' + path + ' :: ' + text);
  return text ? JSON.parse(text) : {};
}
function num_(v) { var f = parseFloat(v); return isNaN(f) ? 0 : f; }

// GET with automatic retry on HTTP 429 / quota — keeps long shipment pulls
// stable across hundreds of inbound-plan calls.
function spGet_(path) {
  for (var a = 0; a < 4; a++) {
    try { return sp_(path, 'get'); }
    catch (e) {
      var m = String(e.message || '').toLowerCase();
      if (m.indexOf('429') < 0 && m.indexOf('quota') < 0) throw e;
      Utilities.sleep(1500 * (a + 1));
    }
  }
  return sp_(path, 'get');
}

/* ===================== Import: FBA inventory (Ridhi) ===================== */

/** Column number -> A1 letter (1->A, 27->AA). */
function colA1_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }

/** Receiving columns derived from the months actually present in the Shipments
 *  tab (recv). Guarantees the columns line up with the data. */
function recvMonthColumns_(recv) {
  var ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var set = {};
  Object.keys(recv).forEach(function (sku) { Object.keys(recv[sku]).forEach(function (k) { set[k] = 1; }); });
  var keys = Object.keys(set).sort();    // "YYYY-MM" sorts chronologically
  var labels = keys.map(function (k) { var p = k.split('-'); return ABBR[parseInt(p[1], 10) - 1] + " '" + p[0].slice(2) + ' Rec.'; });
  return { keys: keys, labels: labels };
}

/** "August 2026" / Date -> "2026-08". Handles strings AND Date cells (Sheets
 *  sometimes auto-converts the month string into a date). */
function sellingMonthKey_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // Read the month in the SPREADSHEET's timezone (what the cell actually shows),
    // NOT via getMonth() which uses the script timezone (America/New_York). When
    // Sheets auto-converts "August 2026" to a date, getMonth() in a behind-UTC
    // script TZ shifts the 1st-of-month back a day → previous month (Aug→Jul).
    var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(v, tz, 'yyyy-MM');
  }
  var parts = String(v || '').trim().split(/\s+/);
  if (parts.length < 2) return '';
  var name = parts[0].toLowerCase(), yr = parseInt(parts[1], 10), mi = -1;
  for (var i = 0; i < MONTH_NAMES.length; i++) {
    if (MONTH_NAMES[i].toLowerCase().indexOf(name) === 0 || name.indexOf(MONTH_NAMES[i].toLowerCase().slice(0, 3)) === 0) { mi = i; break; }
  }
  if (mi < 0 || isNaN(yr)) return '';
  return yr + '-' + ('0' + (mi + 1)).slice(-2);
}

/**
 * From a brand's Shipments tab: { sku: { "2026-08": qty } } keyed by YYYY-MM.
 * The "Amazon Selling Month" column (col C) is the source of truth — it is what
 * the user maintains and what the monthly Rec. columns are auto-built from. We
 * only fall back to recomputing the month from the ETA (col B) when col C is
 * blank or unparseable.
 */
function readShipmentReceiving_(ss, shipTab, cutoffDay) {
  var out = {}, sh = ss.getSheetByName(shipTab);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, SHIP_HEADERS.length).getValues().forEach(function (r) {
    var sku = String(r[4] || '').trim();              // col E = SKU
    var qty = Number(r[5]) || 0;                      // col F = Qty
    if (!sku || !qty) return;
    var shipNm = String(r[9] || ''), fbaId = String(r[3] || '');   // col J = Shipment Name, col D = FBA ID
    if (/^\s*STAR-/i.test(shipNm) || /^\s*STAR-/i.test(fbaId)) return;  // STAR-* = my warehouse → AWD inbound (already shown in "AWD Transit"); FBA-bound shipments (incl AWD→FBA, e.g. "FBA STA/ASDN") STAY in the monthly Rec.
    var key = sellingMonthKey_(r[2]);                 // col C = Amazon Selling Month (authoritative)
    if (!key) {                                       // blank/unparseable → recompute from ETA
      var eta = r[1];                                 // col B = ETA (Date)
      if (eta instanceof Date && !isNaN(eta.getTime())) {
        var ym = allocateReceivingMonth_(eta, cutoffDay);
        key = ym.year + '-' + ('0' + (ym.month + 1)).slice(-2);
      }
    }
    if (!key) return;
    (out[sku] = out[sku] || {})[key] = (out[sku][key] || 0) + qty;
  });
  return out;
}

/**
 * AWD-transit arrivals per SKU WITH THEIR REAL DATES, from the Shipments tab's STAR-* rows
 * (my warehouse → AWD). Amazon's AWD API returns only a total in-transit qty and NO dates, so a flat
 * "arrives in 80 days" is wrong for a shipment that left 50 days ago — that one lands in ~30.
 * Returns { sku: [{day, qty}] }, day = whole days from today to that shipment's ETA (0 if the ETA has
 * already passed but the units are still in transit), sorted soonest-first.
 */
function readAwdTransitArrivals_(ss, shipTab, seaDays) {
  var out = {}, sh = ss.getSheetByName(shipTab);
  if (!sh || sh.getLastRow() < 2) return out;
  var todayMs = Date.now(), DAY = 86400000;
  sh.getRange(2, 1, sh.getLastRow() - 1, SHIP_HEADERS.length).getValues().forEach(function (r) {
    var sku = String(r[4] || '').trim();                       // col E = SKU
    var qty = Number(r[5]) || 0;                               // col F = Qty
    if (!sku || !qty) return;
    var shipNm = String(r[9] || ''), fbaId = String(r[3] || '');
    if (!/^\s*STAR-/i.test(shipNm) && !/^\s*STAR-/i.test(fbaId)) return;   // STAR-* only = AWD-bound
    var eta = r[1];                                            // col B = ETA
    if (!(eta instanceof Date) || isNaN(eta.getTime())) {      // no ETA → Ship Date + sea transit
      var sd = r[0];
      if (!(sd instanceof Date) || isNaN(sd.getTime())) return;
      eta = new Date(sd.getTime() + seaDays * DAY);
    }
    var day = Math.max(0, Math.round((eta.getTime() - todayMs) / DAY));    // overdue → arriving now
    (out[sku] = out[sku] || []).push({ day: day, qty: qty });
  });
  Object.keys(out).forEach(function (s) { out[s].sort(function (a, b) { return a.day - b.day; }); });
  return out;
}

/** Live AWD inventory per SKU. Empty {} if the AWD role isn't authorized. */
function getAwdInventory_() {
  var out = {}, token = null, guard = 0;
  do {
    var path = '/awd/2024-05-09/inventory?details=SHOW&maxResults=200';
    if (token) path += '&nextToken=' + encodeURIComponent(token);
    var res;
    try { res = spGet_(path); } catch (e) { return out; }
    (res.inventory || []).forEach(function (it) {
      if (it.sku) out[it.sku] = { avail: it.totalOnhandQuantity || 0, transit: it.totalInboundQuantity || 0 };
    });
    token = res.nextToken || null;
    if (token) Utilities.sleep(600);
  } while (token && ++guard < 200);
  return out;
}

// Menu entry points — one per brand.
function importRidhiInventory() { buildInventoryForAccount_('SP', TAB.INVENTORY, 'Ridhi'); }
function importCpcInventory() { buildInventoryForAccount_('CPC', 'CPC Inventory', 'CPC'); }

/**
 * Build a Ridhi-Inv-style tab for one brand: identity (from the brand's Catalog
 * tab) + live FBA/AWD inventory + sales buckets (from the brand's Orders tab,
 * excluding MCF + Cancelled).
 */
function buildInventoryForAccount_(pfx, tabName, label) {
  ACTIVE_PREFIX = pfx;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var catTab = (pfx === 'CPC') ? 'CPC Catalog' : 'Catalog';
  var ordTab = (pfx === 'CPC') ? 'CPC Orders' : 'Orders';

  var shipTab = (pfx === 'CPC') ? 'CPC Shipments' : 'Shipments';

  ss.toast('Pulling ' + label + ' FBA inventory…', 'Amazon Report', 20);
  var rows = {}, token = null, page = 0, deadline = capDeadline_(8 * 60 * 1000);
  do {
    var path = '/fba/inventory/v1/summaries?details=true&granularityType=Marketplace' +
      '&granularityId=' + marketplaceId_() + '&marketplaceIds=' + marketplaceId_();
    if (token) path += '&nextToken=' + encodeURIComponent(token);
    var res;
    try { res = spGet_(path); } catch (e) { res = {}; }
    var items = (res.payload && res.payload.inventorySummaries) || [];
    items.forEach(function (it) {
      var sku = it.sellerSku; if (!sku) return;
      var d = it.inventoryDetails || {};
      var rsv = d.reservedQuantity || {}, unf = d.unfulfillableQuantity || {}, rsh = d.researchingQuantity || {};
      rows[sku] = {
        asin: it.asin || '', total: it.totalQuantity || 0,
        fba: d.fulfillableQuantity || 0,
        unsell: unf.totalUnfulfillableQuantity || 0,
        reserved: rsv.totalReservedQuantity || 0,
        resOrders: rsv.pendingCustomerOrderQuantity || 0,
        inWork: d.inboundWorkingQuantity || 0,
        inShip: d.inboundShippedQuantity || 0,
        inRecv: d.inboundReceivingQuantity || 0,
        researching: rsh.totalResearchingQuantity || 0
      };
    });
    token = (res.pagination && res.pagination.nextToken) || null;
    if (token) Utilities.sleep(1000);
    page++;
  } while (token && Date.now() < deadline && page < 400);

  ss.toast('Pulling ' + label + ' AWD inventory…', 'Amazon Report', 15);
  var awd = getAwdInventory_();
  var catalog = readCatalogMap_(ss, catTab);
  var sales = computeSalesBucketsFromOrders_(ss, ordTab);
  var cutoffDay = getSettings_().cutoffDay;
  var recv = readShipmentReceiving_(ss, shipTab, cutoffDay);   // monthly receiving (computed from ETA)

  var now = new Date();
  // Receiving columns = the months actually present in the Shipments tab.
  var mr = recvMonthColumns_(recv);
  if (!mr.keys.length) {
    ss.toast('No receiving months found in "' + shipTab + '" — is it built & does it have Amazon Selling Month?', 'Amazon Report', 10);
  }
  var HEAD = ['SKU', 'Image', 'ASIN', 'Parent ASIN', 'Color', 'Size', 'Sub-Category',
    'Total Stock', 'warehouse', 'fulfillable', 'Unsellable', 'reserved']
    .concat(mr.labels)
    .concat(['inbound_working', 'inbound_shipped', 'inbound_receiving', 'reserved_orders', 'AWD Available', 'AWD Transit'])
    .concat(['Yesterday', 'Today', 'Last 7 Days', 'Last 14 Days', 'Last 30 Days', 'Last 90 Days', 'Last 90 Days $', 'This Month', 'UpdatedAt',
             'Air DoS', 'Air Qty', 'Air ← India', 'Sea DoS', 'Sea Qty', 'Sea ← India']);

  // ---- Air Plan / Sea Plan (6 columns) — computed by a forward PROJECTION (see computePlan_) ----
  // Immediate stock (warehouse + inbound_receiving + this-month Rec + AWD Available) is the runway.
  // Future Rec months arrive at their month-start; AWD Transit arrives on its OWN STAR-* shipment ETA
  // (real days left, not a flat 80). AIR is planned ONLY if the stock would still run out within 90
  // days DESPITE those timed arrivals; else it goes by Sea.
  var settings = getSettings_();
  var awdArrivalDays = settings.seaTransitDays || 80;           // fallback only: AWD Transit with no STAR-* row
  var awdArr = readAwdTransitArrivals_(ss, shipTab, awdArrivalDays);   // SKU → [{day, qty}] real per-shipment ETAs
  var indiaMap = readIndiaStock_(ss, 'India Stock');            // SKU → India stock qty (col A = SKU, col G = qty)
  var planTz = ss.getSpreadsheetTimeZone();
  var curYM = Utilities.formatDate(new Date(), planTz, 'yyyy-MM');
  var todayMs = Date.now();
  function daysToMonthStart_(ym) { var p = ym.split('-'); return Math.round((Date.UTC(Number(p[0]), Number(p[1]) - 1, 1) - todayMs) / 86400000); }

  var ZERO = { asin: '', total: 0, fba: 0, unsell: 0, reserved: 0, resOrders: 0, inWork: 0, inShip: 0, inRecv: 0, researching: 0 };
  var skuSet = {};
  Object.keys(rows).forEach(function (s) { skuSet[s] = 1; });
  Object.keys(catalog).forEach(function (s) { skuSet[s] = 1; });
  Object.keys(recv).forEach(function (s) { skuSet[s] = 1; });   // include incoming-only SKUs

  // Default order: Last-30-days sales, largest first. Drop Amazon's auto-generated
  // "amzn.*" removal/liquidation SKUs — not real sellable listings.
  var skuList = Object.keys(skuSet).filter(function (s) {
    return String(s).toLowerCase().indexOf('amzn') !== 0;
  }).sort(function (a, b) {
    return (sales[b] ? sales[b].l30 : 0) - (sales[a] ? sales[a].l30 : 0);
  });

  var out = skuList.map(function (sku, i) {
    var r = rows[sku] || ZERO;
    var a = awd[sku] || { avail: 0, transit: 0 };
    var c = catalog[sku] || {};
    var sb = sales[sku] || { y: 0, t: 0, l7: 0, l14: 0, l30: 0, l90: 0, l90amt: 0, tm: 0 };
    var rc = recv[sku] || {};
    // Net warehouse = FC-resident sellable, after removing Unsellable + reserved-for-orders.
    var warehouse = r.fba + r.reserved + r.researching - r.resOrders;
    var monthVals = mr.keys.map(function (k) { return rc[k] || 0; });
    var img = c.image ? '=IMAGE("' + String(c.image).replace(/"/g, '') + '")' : '';
    // Air/Sea plan (projection). Arrivals = future Rec months (@ month-start) + AWD Transit/STAR-* (@ sea days).
    var arrivals = [];
    Object.keys(rc).forEach(function (ym) { if (ym > curYM && rc[ym]) arrivals.push({ day: daysToMonthStart_(ym), qty: rc[ym] }); });
    // AWD Transit → use each STAR-* shipment's REAL remaining days (its ETA − today), NOT a flat 80:
    // a shipment that left 50 days ago lands in ~30. The AWD API total (a.transit) stays authoritative
    // for HOW MANY units are still in transit — the Shipments tab only supplies the TIMING — so units
    // are filled soonest-ETA first and any remainder with no STAR-* row falls back to the flat estimate.
    if (a.transit > 0) {
      var left = a.transit;
      (awdArr[sku] || []).forEach(function (s) {
        if (left <= 0) return;
        var q = Math.min(s.qty, left);
        arrivals.push({ day: s.day, qty: q });
        left -= q;
      });
      if (left > 0) arrivals.push({ day: awdArrivalDays, qty: left });
    }
    // "immediate" = stock that is sellable now or within days: net warehouse + units ALREADY AT the FC
    // being checked in (inbound_receiving) + this month's Rec. + AWD Available. inbound_receiving is safe
    // to add — RECEIVING shipments are never written to the Shipments tab (see SHIP_KEEP), so they cannot
    // double-count the Rec. columns. (inbound_working / inbound_shipped stay OUT — those are still in
    // transit and reach the plan as future Rec. arrivals from the Shipments tab.)
    var plan = computePlan_({
      ads: (sb.l90 === sb.l30) ? (sb.l30 / 30) : (sb.l90 / 90),
      immediate: warehouse + r.inRecv + (rc[curYM] || 0) + a.avail,
      pipe: r.total + a.avail + a.transit,
      india: indiaMap[sku] || 0, subcat: c.subcat || '', arrivals: arrivals
    });
    return [sku, img, r.asin || c.asin || '', c.parent || '', c.color || '', c.size || '', c.subcat || '',
      r.total, warehouse, r.fba, r.unsell, r.reserved]
      .concat(monthVals)
      .concat([r.inWork, r.inShip, r.inRecv, r.resOrders, a.avail, a.transit])
      .concat([sb.y, sb.t, sb.l7, sb.l14, sb.l30, sb.l90, sb.l90amt, sb.tm, now])
      .concat(plan);                                          // Air DoS, Air Qty, Air ← India, Sea DoS, Sea Qty, Sea ← India
  });

  // Write: row 1 = headers, row 2 = TOTALS (auto SUM), row 3+ = data.
  var sh = getOrCreate_(ss, tabName);
  sh.clear();
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD])
    .setBackground('#dbe9f7').setFontColor('#1e3a5f').setFontWeight('bold');   // pastel blue header
  var totalsRow = HEAD.map(function (h, idx) {
    if (idx === 0) return 'TOTAL';
    if (idx <= 6 || h === 'UpdatedAt' || h === 'Air DoS' || h === 'Sea DoS') return '';   // identity/UpdatedAt/DoS: no sum (Qty + ←India columns DO total)
    var col = colA1_(idx + 1);
    return '=SUBTOTAL(109,' + col + '3:' + col + ')';  // 109 = SUM that respects the filter
  });
  sh.getRange(2, 1, 1, HEAD.length).setValues([totalsRow])
    .setFontWeight('bold').setBackground('#eaf2fb').setFontColor('#1e3a5f');   // soft pastel totals
  sh.setFrozenRows(2);

  if (out.length) {
    sh.getRange(3, 1, out.length, HEAD.length).setValues(out);
    // Force numeric format on all number columns (8..last, incl. the Air/Sea plan columns); some
    // inherited a date format. (UpdatedAt is re-formatted to a date just below.)
    sh.getRange(2, 8, out.length + 1, HEAD.length - 7).setNumberFormat('#,##0');
    var amtCol = HEAD.indexOf('Last 90 Days $') + 1;     // currency format for the 90-day revenue column
    if (amtCol > 0) sh.getRange(2, amtCol, out.length + 1, 1).setNumberFormat('$#,##0');
    sh.getRange(3, HEAD.indexOf('UpdatedAt') + 1, out.length, 1).setNumberFormat('dd/MM/yyyy HH:mm');  // UpdatedAt (not last col now — Air/Sea Plan follow)
    try { sh.setRowHeights(3, out.length, 48); } catch (e) {}
    // Auto-filter (header = totals row 2) + default sort by Last 30 Days desc (data is pre-sorted).
    var existing = sh.getFilter();
    if (existing) existing.remove();
    sh.getRange(2, 1, out.length + 1, HEAD.length).createFilter();
    // Colour the fulfillable column by how long the stock will last (see helper below).
    applyFulfillableCF_(sh, HEAD, out.length);
    // Borders + centred cells across the WHOLE table (header rows 1-2 + all data) — reapplied
    // on every rebuild so the manual formatting is never lost when the tab is cleared/rebuilt.
    var full = sh.getRange(1, 1, out.length + 2, HEAD.length);
    full.setBorder(true, true, true, true, true, true, '#c8d4e3', SpreadsheetApp.BorderStyle.SOLID);
    full.setHorizontalAlignment('center').setVerticalAlignment('middle');
  } else {
    sh.setConditionalFormatRules([]);
  }
  sh.setColumnWidth(1, 160); sh.setColumnWidth(2, 70);
  ['Air DoS', 'Air Qty', 'Air ← India', 'Sea DoS', 'Sea Qty', 'Sea ← India'].forEach(function (h) {
    var ci = HEAD.indexOf(h); if (ci >= 0) sh.setColumnWidth(ci + 1, 96);
  });
  noteOn_(sh, 'Identity from "' + catTab + '"; FBA/AWD live; monthly Rec. from "' + shipTab +
    '" by Amazon Selling Month; sales from "' + ordTab + '" (MCF + Cancelled excluded). Row 2 = totals.');

  if (!SILENT_RUN) SpreadsheetApp.getUi().alert(label + ' Inventory built ✅\n\n' + out.length + ' SKUs in "' + tabName + '".\n' +
    'Monthly Rec. from "' + shipTab + '"; sales from "' + ordTab + '" (MCF + Cancelled excluded).');
}

/** Read the India Stock tab into { SKU: qty }. SKU in col A, stock qty in col G (7). */
function readIndiaStock_(ss, tab) {
  var sh = ss.getSheetByName(tab), map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().forEach(function (r) {
    var sku = String(r[0] || '').trim(); if (sku) map[sku] = Number(r[6]) || 0;   // col A = SKU, col G = Stock
  });
  return map;
}

/**
 * India Stock tab → { SKU: listingStatus } from the manually-maintained status column
 * (Listed / Discontinue / Need Listing / Use In Mix). SKU in col A. The status column is located by
 * HEADER (remark / status / listing) and, failing that, by which column's values best match that
 * known vocabulary — so it works whatever the user named the column. Empty map if none is found.
 */
function readIndiaStatus_(ss, tab) {
  var out = {}, sh = ss.getSheetByName(tab);
  if (!sh || sh.getLastRow() < 2) return out;
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var body = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  // These status words are distinctive, so find the column whose VALUES best match them — this is far
  // more reliable than the header name (a "Listing …" or "Status …" column could sit before "Remark").
  var VOC = /^\s*(listed|discontinu\w*|need\s*listing|use\s*in\s*mix|not\s*listed)\s*$/i;
  var stCol = -1, bestN = 0;
  for (var c = 1; c < lastCol; c++) {                     // skip col A (SKU)
    var cnt = 0;
    for (var r = 0; r < body.length; r++) if (VOC.test(String(body[r][c] || ''))) cnt++;
    if (cnt > bestN) { bestN = cnt; stCol = c; }
  }
  // Fallback: values didn't reveal it (blank/other statuses) → match a header called Remark/Status/Listing.
  if (stCol < 0 || bestN < 2) {
    var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var c2 = 0; c2 < lastCol; c2++) { if (/remark|status|listing/i.test(String(hdr[c2] || ''))) { stCol = c2; break; } }
  }
  if (stCol < 0) return out;
  // Key by UPPER-cased trimmed SKU so the join tolerates case differences between the two tabs.
  body.forEach(function (r) { var sku = String(r[0] || '').trim().toUpperCase(); if (sku) out[sku] = String(r[stCol] || '').trim(); });
  return out;
}

/**
 * Air/Sea replenishment plan for ONE SKU → [Air DoS, Air Qty, Air ← India, Sea DoS, Sea Qty, Sea ← India].
 *   ADS = run rate (units/day). immediate = in-hand runway stock. pipe = full pipeline (for Sea DoS).
 *   AIR Qty = forward-projection SHORTFALL: deplete immediate at ADS/day, ADD each timed arrival
 *     (future Rec months at month-start, AWD Transit/STAR-* at ~sea days), and air only fills the gap
 *     the incoming inventory does NOT cover through day 90. So arrivals AFTER the current runway are
 *     auto-credited (qty + timing) — enough incoming stock ⇒ air auto-reduces or drops to 0.
 *   Sea Qty = DoS≤90 → 90×ADS ; DoS>90 → (90+80+10−DoS)×ADS.
 *   ← India = India stock AIR-FIRST, then SEA gets the LEFTOVER (India − Air←India); each ≥ MIN_SHIP (5) or 0.
 *   Air-excluded sub-categories (lampshade/quilt/chair pad/seat cushion/insert) never go by air.
 */
function computePlan_(o) {
  var TARGET = 90, SEA_TRANSIT = 80, SAFETY = 10, MIN_SHIP = 5;
  var ads = o.ads || 0, imm = o.immediate || 0, pipe = o.pipe || 0, india = o.india || 0;
  var airDoS = ads > 0 ? Math.round(imm / ads) : '';
  var seaDoS = ads > 0 ? Math.round(pipe / ads) : '';

  // Air Qty = a forward-projection SHORTFALL. Deplete immediate stock at ADS/day and ADD each timed
  // arrival (future Rec. months at month-start, AWD Transit/STAR-* at ~sea days) on its own day. Track
  // the LOWEST the on-hand ever goes through day 90 — air = just enough to keep it from going negative,
  // i.e. only the gap the incoming inventory does NOT cover (crediting BOTH the qty and the TIMING of
  // arrivals). So if enough stock arrives after the current runway, air auto-reduces (or drops to 0).
  var airQty = 0;
  if (ads > 0) {
    var evts = (o.arrivals || []).filter(function (x) { return x.day > 0 && x.day <= TARGET; })
                                 .sort(function (x, y) { return x.day - y.day; });
    var onHand = imm, day = 0, minOnHand = imm;
    for (var k = 0; k < evts.length; k++) {
      onHand -= ads * (evts[k].day - day);                 // deplete up to this arrival
      if (onHand < minOnHand) minOnHand = onHand;
      onHand += evts[k].qty;                                // incoming inventory lands
      day = evts[k].day;
    }
    onHand -= ads * (TARGET - day);                         // deplete on to day 90
    if (onHand < minOnHand) minOnHand = onHand;
    if (minOnHand < 0) airQty = Math.round(-minOnHand);     // shortfall the arrivals don't cover
  }

  // Sea Qty (unchanged business logic).
  var seaQty = 0;
  if (ads > 0) {
    var dos = pipe / ads;
    seaQty = dos <= TARGET ? Math.max(0, Math.round(TARGET * ads))
                           : Math.max(0, Math.round((TARGET + SEA_TRANSIT + SAFETY - dos) * ads));
  }

  // India allocation — AIR FIRST, then SEA gets whatever India stock is LEFT (air takes its share,
  // the balance ships by sea). Min-ship 5 each; air-excluded categories skip air (all India → sea).
  var excluded = /lamp ?shade|quilt|chair ?pad|seat ?cushion|insert/i.test(String(o.subcat || ''));
  var airInd = (airQty > 0 && !excluded) ? Math.min(airQty, india) : 0;
  if (airInd < MIN_SHIP) airInd = 0;
  var seaInd = Math.min(seaQty, Math.max(0, india - airInd));   // leftover India after air → sea
  if (seaInd < MIN_SHIP) seaInd = 0;

  return [airDoS, airQty, airInd, seaDoS, seaQty, seaInd];
}

/**
 * Colour-code the "fulfillable" column by STOCK COVER = fulfillable ÷ monthly run-rate
 * (the "Last 30 Days" units column), for BOTH brands (this is the shared Inventory builder):
 *   • 🔴 red    — 0 in stock (out of stock now)
 *   • 🟠 amber  — > 0 but ≤ 1 month of cover (about to run out)
 *   • 🟡 yellow — 1 – 2 months of cover
 *   • 🟢 green  — more than 2 months of cover (or has stock but no recent sales)
 * Also highlights, on their own cells:
 *   • violet on Air/Sea DoS  — stock exists ONLY in AWD (warehouse = 0, AWD Available > 0)
 *   • 🟡 yellow on AWD Available — an AWD → FBA transfer is due: AWD has stock while the FBA side
 *     (warehouse + inbound_receiving) has under 30 days of cover left
 * Column letters are resolved by HEADER NAME because the monthly "Rec." columns are dynamic
 * and shift everything after them. Applied to data rows only (row 3+); the totals row is left
 * plain. Replaces this tab's conditional-format rules so rebuilds never accumulate duplicates.
 */
function applyFulfillableCF_(sh, HEAD, nRows) {
  var fi = HEAD.indexOf('fulfillable'), li = HEAD.indexOf('Last 30 Days');
  if (fi < 0 || nRows < 1) return;
  var F = '$' + colA1_(fi + 1), L = (li >= 0 ? '$' + colA1_(li + 1) : null), A = '$A';
  var rng = sh.getRange(3, fi + 1, nRows, 1);        // fulfillable cells, data rows only
  function rule(formula, bg, fg) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(formula).setBackground(bg).setFontColor(fg).setRanges([rng]).build();
  }
  var rules = [];
  rules.push(rule('=AND(' + A + '3<>"",' + F + '3=0)', '#fecaca', '#991b1b'));   // RED: out of stock
  if (L) {
    rules.push(rule('=AND(' + A + '3<>"",' + F + '3>0,' + L + '3>0,' + F + '3<=' + L + '3)', '#fed7aa', '#9a3412'));         // AMBER: ≤ 1 month
    rules.push(rule('=AND(' + A + '3<>"",' + L + '3>0,' + F + '3>' + L + '3,' + F + '3<=2*' + L + '3)', '#fef08a', '#854d0e')); // YELLOW: 1–2 months
    rules.push(rule('=AND(' + A + '3<>"",' + F + '3>0,OR(' + L + '3=0,' + F + '3>2*' + L + '3))', '#bbf7d0', '#166534'));      // GREEN: > 2 months / no sales
  } else {
    rules.push(rule('=AND(' + A + '3<>"",' + F + '3>0)', '#bbf7d0', '#166534'));
  }
  // AWD-only highlight on the Air Plan / Sea Plan cells: stock exists ONLY in AWD (warehouse = 0,
  // AWD Available > 0) → needs a replenishment transfer into Amazon. Violet tint.
  var wi = HEAD.indexOf('warehouse'), ai = HEAD.indexOf('AWD Available');
  if (wi >= 0 && ai >= 0) {
    var W = '$' + colA1_(wi + 1), AW = '$' + colA1_(ai + 1);
    ['Air DoS', 'Sea DoS'].forEach(function (h) {
      var pi = HEAD.indexOf(h);
      if (pi < 0) return;
      var prng = sh.getRange(3, pi + 1, nRows, 1);
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND(' + A + '3<>"",' + W + '3=0,' + AW + '3>0)')
        .setBackground('#ede9fe').setFontColor('#6d28d9').setRanges([prng]).build());
    });
  }
  // 🟡 AWD → FBA TRANSFER NEEDED: units are sitting in AWD while the FBA side (warehouse +
  // inbound_receiving) has under 30 days of cover left → highlight the AWD Available qty to pull in.
  // 30 days of cover = 30 × ADS, and ADS = L90/90 (or L30/30 on a new launch where L90 == L30), so the
  // threshold simplifies to IF(L90=L30, L30, L90/3) — which also avoids dividing by a zero ADS.
  var ri = HEAD.indexOf('inbound_receiving'), l9i = HEAD.indexOf('Last 90 Days');
  if (ai >= 0 && wi >= 0 && ri >= 0 && li >= 0 && l9i >= 0) {
    var W2 = '$' + colA1_(wi + 1), R = '$' + colA1_(ri + 1), AW2 = '$' + colA1_(ai + 1),
        L30 = '$' + colA1_(li + 1), L90 = '$' + colA1_(l9i + 1);
    var cover30 = 'IF(' + L90 + '3=' + L30 + '3,' + L30 + '3,' + L90 + '3/3)';   // = 30 × ADS
    var arng = sh.getRange(3, ai + 1, nRows, 1);        // AWD Available cells, data rows only
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(' + A + '3<>"",' + AW2 + '3>0,' + cover30 + '>0,(' +
        W2 + '3+' + R + '3)<' + cover30 + ')')
      .setBackground('#fef08a').setFontColor('#854d0e').setRanges([arng]).build());
  }
  sh.setConditionalFormatRules(rules);
}

/* ===================== Import: shipments (Shipped / In-Transit only) ===================== */

function parseShipDate_(name) {
  var m = String(name || '').match(/\((\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\)/);
  if (!m) return '';
  return new Date(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0));
}
function modeFromName_(name) {
  var n = String(name || '').toLowerCase();
  if (n.indexOf('ocean') !== -1 || /\bsea\b/.test(n)) return 'Sea';
  if (/\bair\b/.test(n)) return 'Air';
  return 'AWD';   // name has neither Air nor Sea → AWD (7 days)
}
function getInboundShipments_(afterISO, beforeISO, statusList) {
  var out = [], nextToken = null, guard = 0, seen = {};
  do {
    var path;
    if (nextToken) {
      path = '/fba/inbound/v0/shipments?MarketplaceId=' + marketplaceId_() +
        '&QueryType=NEXT_TOKEN&NextToken=' + encodeURIComponent(nextToken);
    } else {
      path = '/fba/inbound/v0/shipments?MarketplaceId=' + marketplaceId_() +
        '&QueryType=DATE_RANGE&ShipmentStatusList=' + statusList +
        '&LastUpdatedAfter=' + encodeURIComponent(afterISO) +
        '&LastUpdatedBefore=' + encodeURIComponent(beforeISO);
    }
    var res = sp_(path, 'get'), p = res.payload || {};
    (p.ShipmentData || []).forEach(function (s) { out.push(s); });
    var nt = p.NextToken || null;
    nextToken = (nt && !seen[nt]) ? nt : null;
    if (nextToken) seen[nextToken] = true;
    Utilities.sleep(600);
  } while (nextToken && ++guard < 200);
  return out;
}
function getShipmentItems_(shipmentId) {
  var out = [], nextToken = null, guard = 0, seen = {};
  do {
    var path;
    if (nextToken) {
      path = '/fba/inbound/v0/shipmentItems?MarketplaceId=' + marketplaceId_() +
        '&QueryType=NEXT_TOKEN&NextToken=' + encodeURIComponent(nextToken);
    } else {
      path = '/fba/inbound/v0/shipments/' + encodeURIComponent(shipmentId) +
        '/items?MarketplaceId=' + marketplaceId_();
    }
    var res = sp_(path, 'get'), p = res.payload || {};
    (p.ItemData || []).forEach(function (it) { out.push(it); });
    var nt = p.NextToken || null;
    nextToken = (nt && !seen[nt]) ? nt : null;
    if (nextToken) seen[nextToken] = true;
    Utilities.sleep(300);
  } while (nextToken && ++guard < 50);
  return out;
}

/**
 * Pull FBA inbound shipments that are SHIPPED or IN_TRANSIT only, and write
 * them to the Shipments tab. Air/Sea read from the shipment name; Transit Days
 * filled from Settings per mode; ETA = Dispatch (created) + Days.
 */
/* --- New Fulfillment Inbound API (2024-03-20): the "Send to Amazon" flow ---
 * Working / Ready-to-ship shipments live here as ACTIVE "inbound plans" and are
 * NOT returned by the classic v0 getShipments API. We list ACTIVE plans and
 * their items to surface that planned-but-not-yet-shipped inventory. */

function getInboundPlans_(status) {
  var out = [], token = null, guard = 0;
  do {
    var path = '/inbound/fba/2024-03-20/inboundPlans?pageSize=30';
    if (status) path += '&status=' + status;
    if (token) path += '&paginationToken=' + encodeURIComponent(token);
    var res = sp_(path, 'get');
    (res.inboundPlans || []).forEach(function (p) { out.push(p); });
    token = (res.pagination && res.pagination.nextToken) || null;
    if (token) Utilities.sleep(500);
  } while (token && ++guard < 200);
  return out;
}

/**
 * DEBUG: find the first ACTIVE inbound plan that has a CONFIRMED shipment and
 * dump the raw JSON (plan → placementOptions → shipment → items) into a
 * "_Debug" sheet, so we can read Amazon's exact field names and build the
 * accurate Working/Ready-to-ship pull. Scans up to 80 plans to find a real one.
 */
function debugInspectActivePlan() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var plans = getInboundPlans_('ACTIVE');
  if (!plans.length) { SpreadsheetApp.getUi().alert('No ACTIVE inbound plans found.'); return; }

  var base = '/inbound/fba/2024-03-20/inboundPlans/';
  var found = null, scanned = 0;
  for (var i = 0; i < plans.length && i < 80; i++) {
    scanned++;
    var pid = plans[i].inboundPlanId;
    var opts;
    try { opts = sp_(base + encodeURIComponent(pid) + '/placementOptions?pageSize=10', 'get'); }
    catch (e) { continue; }
    var ids = [];
    (opts.placementOptions || []).forEach(function (o) {
      (o.shipmentIds || []).forEach(function (id) { ids.push(id); });
    });
    if (ids.length) { found = { plan: plans[i], opts: opts, shipmentId: ids[0] }; break; }
    Utilities.sleep(300);
  }

  // Build a readable, one-line-per-row field summary (easy to screenshot).
  var rows = [];
  function add(s) { rows.push([s]); }
  function keysOf(o) { return o && typeof o === 'object' ? Object.keys(o).join(', ') : '(' + typeof o + ')'; }

  add('SCANNED ' + scanned + ' of ' + plans.length + ' ACTIVE plans');
  add('PLAN SUMMARY keys: ' + keysOf(plans[0]));
  add('  plan.status = ' + plans[0].status + ' | createdAt = ' + plans[0].createdAt);

  if (!found) {
    add('No plan with shipmentIds in first ' + scanned + ' plans (all unconfirmed drafts?).');
  } else {
    var pid2 = found.plan.inboundPlanId;
    var opt0 = (found.opts.placementOptions || [])[0] || {};
    add('--- PLACEMENT OPTION ---');
    add('placementOption keys: ' + keysOf(opt0));
    add('  status values seen: ' + (found.opts.placementOptions || []).map(function (o) { return o.status; }).join(', '));
    add('  shipmentIds field present: ' + (opt0.shipmentIds ? 'YES (' + opt0.shipmentIds.length + ')' : 'NO'));

    try {
      var shp = sp_(base + encodeURIComponent(pid2) + '/shipments/' + encodeURIComponent(found.shipmentId), 'get');
      add('--- SHIPMENT (getShipment) ---');
      add('shipment keys: ' + keysOf(shp));
      add('  shipment.status = ' + shp.status);
      add('  shipment.name = ' + shp.name);
      add('  shipmentConfirmationId = ' + shp.shipmentConfirmationId);
    } catch (e) { add('getShipment ERROR: ' + e.message); }

    try {
      var items = sp_(base + encodeURIComponent(pid2) + '/shipments/' + encodeURIComponent(found.shipmentId) + '/items?pageSize=5', 'get');
      var it0 = (items.items || [])[0] || {};
      add('--- SHIPMENT ITEMS (listShipmentItems) ---');
      add('items array key present: ' + (items.items ? 'YES (' + items.items.length + ')' : 'NO'));
      add('item keys: ' + keysOf(it0));
      add('  sample: msku=' + it0.msku + ' quantity=' + it0.quantity);
    } catch (e) { add('listShipmentItems ERROR: ' + e.message); }

    add('');
    add('=== FULL RAW JSON BELOW ===');
    add('PLAN: ' + JSON.stringify(found.plan));
    add('PLACEMENT: ' + JSON.stringify(found.opts));
  }

  var dbg = ss.getSheetByName('_Debug') || ss.insertSheet('_Debug');
  dbg.clear();
  dbg.getRange(1, 1, rows.length, 1).setValues(rows);
  dbg.setColumnWidth(1, 760);
  ss.setActiveSheet(dbg);
  SpreadsheetApp.getUi().alert('Field summary written to the "_Debug" sheet (rows 1 onward). ' +
    'Screenshot the top ~15 rows and send it — I will lock the fields and build the accurate pull.');
}

/**
 * DEBUG: locate a specific FBA shipment and report exactly why it is/ isn't picked
 * up by the import — its classic-v0 status, plus (in the new "Send to Amazon" flow)
 * the inbound plan status, placement-option status, and shipment status. Dumps to
 * "_Debug". Run this when a shipment (e.g. a Ready-to-ship one) is missing.
 */
function debugFindShipment() {
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt('Find shipment', 'FBA shipment ID (e.g. FBA19FP7KMHM):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var target = String(r1.getResponseText() || '').trim();
  if (!target) return;
  var r2 = ui.prompt('Brand', 'Which account?  Type  SP  for Ridhi  or  CPC :', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  ACTIVE_PREFIX = (String(r2.getResponseText() || '').trim().toUpperCase() === 'CPC') ? 'CPC' : 'SP';

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rows = []; function add(s) { rows.push([s]); }
  add('Searching ' + target + '  (brand ' + ACTIVE_PREFIX + ')');

  // 1) Classic v0 direct lookup (fast).
  try {
    var v0 = sp_('/fba/inbound/v0/shipments?MarketplaceId=' + marketplaceId_() +
      '&QueryType=SHIPMENT&ShipmentIdList=' + encodeURIComponent(target), 'get');
    var sd = (v0.payload && v0.payload.ShipmentData) || [];
    add('--- CLASSIC v0 ---');
    add('  matches: ' + sd.length + (sd.length ? '  → status=' + sd[0].ShipmentStatus + ' | name=' + sd[0].ShipmentName : ''));
    add('  (classic import KEEPS only SHIPPED / IN_TRANSIT / CHECKED_IN)');
  } catch (e) { add('v0 lookup error: ' + e.message); }

  // 2) New "Send to Amazon" flow: scan inbound plans for this confirmationId.
  add('--- NEW FLOW (inbound plans) ---');
  var base = '/inbound/fba/2024-03-20/inboundPlans/';
  var plans = []; try { plans = getInboundPlans_(); } catch (e) { add('listInboundPlans error: ' + e.message); }
  var active = 0; plans.forEach(function (p) { if (String(p.status || '').toUpperCase() === 'ACTIVE') active++; });
  add('  total plans (all statuses): ' + plans.length + ' | ACTIVE: ' + active);
  var t0 = Date.now(), found = false, scanned = 0;
  for (var i = 0; i < plans.length && !found; i++) {
    if (Date.now() - t0 > 5 * 60 * 1000) { add('  (stopped after 5 min, scanned ' + scanned + ')'); break; }
    scanned++;
    var pid = plans[i].inboundPlanId, opts;
    try { opts = spGet_(base + encodeURIComponent(pid) + '/placementOptions?pageSize=20'); } catch (e) { continue; }
    var pos = opts.placementOptions || [];
    for (var j = 0; j < pos.length && !found; j++) {
      var ids = pos[j].shipmentIds || [];
      for (var k = 0; k < ids.length && !found; k++) {
        var shp; try { shp = spGet_(base + encodeURIComponent(pid) + '/shipments/' + encodeURIComponent(ids[k])); } catch (e) { continue; }
        if (String(shp.shipmentConfirmationId || '') === target) {
          found = true;
          add('  FOUND in plan ' + pid);
          add('    plan.status            = ' + plans[i].status + '   (import scans only ACTIVE)');
          add('    placementOption.status = ' + pos[j].status + '   (import keeps only ACCEPTED)');
          add('    shipment.status        = ' + shp.status + '   (import keeps WORKING / READY_TO_SHIP)');
          add('    shipment.name          = ' + shp.name);
        }
      }
    }
  }
  if (!found) add('  NOT found in ' + scanned + ' plans scanned.');

  var dbg = ss.getSheetByName('_Debug') || ss.insertSheet('_Debug');
  dbg.clear(); dbg.getRange(1, 1, rows.length, 1).setValues(rows); dbg.setColumnWidth(1, 860);
  ss.setActiveSheet(dbg);
  ui.alert('Done — see the "_Debug" sheet and screenshot it.');
}

function getInboundPlanItems_(planId) {
  var out = [], token = null, guard = 0;
  do {
    var path = '/inbound/fba/2024-03-20/inboundPlans/' + encodeURIComponent(planId) + '/items?pageSize=30';
    if (token) path += '&paginationToken=' + encodeURIComponent(token);
    var res = sp_(path, 'get');
    (res.items || []).forEach(function (it) { out.push(it); });
    token = (res.pagination && res.pagination.nextToken) || null;
    if (token) Utilities.sleep(300);
  } while (token && ++guard < 100);
  return out;
}

// Statuses we KEEP from the classic v0 API. WORKING is included because confirmed
// "Send to Amazon" shipments (incl. Ready-to-ship ones) show up here as WORKING with
// a real FBA ID — this is the reliable, fast way to catch them (the new-flow plan
// drill can miss them if the plan isn't ACTIVE or the time budget runs out). The new
// flow is then de-duplicated by FBA ID against what we capture here.
var SHIP_KEEP = { WORKING: 'Working', READY_TO_SHIP: 'Ready to Ship', SHIPPED: 'Shipped', IN_TRANSIT: 'In Transit', CHECKED_IN: 'Checked In' };

/* --- AWD (Amazon Warehousing & Distribution) inbound shipments (STAR-*) ---
 * A separate system from FBA inbound. These always travel by Sea for this
 * seller, so they use the Sea transit time. We keep CREATED + SHIPPED. */

function getAwdShipments_() {
  var out = [], token = null, guard = 0;
  do {
    var path = '/awd/2024-05-09/inboundShipments?maxResults=200&sortBy=UPDATED_AT&sortOrder=DESCENDING';
    if (token) path += '&nextToken=' + encodeURIComponent(token);
    var res = spGet_(path);
    (res.shipments || []).forEach(function (s) { out.push(s); });
    token = res.nextToken || null;
    if (token) Utilities.sleep(400);
  } while (token && ++guard < 100);
  return out;
}

function getAwdShipment_(id) {
  // skuQuantities=SHOW is required — default HIDE returns no line items.
  return spGet_('/awd/2024-05-09/inboundShipments/' + encodeURIComponent(id) + '?skuQuantities=SHOW');
}

/* ===================== Demand forecast (12 months, auto + manual override) ===================== */

/** Menu: build the 12-month demand forecast for this sheet's brand(s). */
function buildDemand() { sheetBrands_().forEach(function (b) { buildDemandForAccount_(b.pfx, b.label); }); }

/**
 * 12-month demand grid per SKU: ADS × days-in-month × seasonality × (1 + YoY growth).
 *
 * AUTO + MANUAL OVERRIDE: every rebuild also mirrors the pure auto numbers into a hidden
 * "_… Auto" tab. Next rebuild compares the visible cell to that mirror — if they differ, the
 * user typed over it, so the typed value is KEPT (and tinted) instead of being overwritten.
 * That gives a single editable grid without a separate overrides tab.
 */
function buildDemandForAccount_(pfx, label) {
  ACTIVE_PREFIX = pfx;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabName = (pfx === 'CPC') ? 'CPC Demand' : 'Demand';
  var autoTab = '_' + tabName + ' Auto';
  var catTab = (pfx === 'CPC') ? 'CPC Catalog' : 'Catalog';
  var ordTab = (pfx === 'CPC') ? 'CPC Orders' : 'Orders';
  ss.toast('Building ' + label + ' demand forecast…', 'Amazon Report', 20);

  // Catalog comes from the brand's MAIN sheet and Orders from its Orders Data sheet — so this works
  // unchanged whether it runs on a main sheet or on the planning workbook.
  var settings = getSettings_();
  var catalog = readCatalogMap_(catalogSS_(), catTab);
  var sales = computeSalesBucketsFromOrders_(ss, ordTab);

  // Next 12 months, starting with the current one.
  var now = new Date(), months = [];
  for (var i = 0; i < 12; i++) { var d = new Date(now.getFullYear(), now.getMonth() + i, 1); months.push({ y: d.getFullYear(), m: d.getMonth() }); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var labels = months.map(function (x) { return MON[x.m] + " '" + String(x.y).slice(2); });

  var skuSet = {};
  Object.keys(catalog).forEach(function (s) { skuSet[s] = 1; });
  Object.keys(sales).forEach(function (s) { skuSet[s] = 1; });
  var skus = Object.keys(skuSet).filter(function (s) { return String(s).toLowerCase().indexOf('amzn') !== 0; })
    .sort(function (a, b) { return (sales[b] ? sales[b].l30 : 0) - (sales[a] ? sales[a].l30 : 0); });

  var growth = 1 + settings.growthPct / 100;
  var autoGrid = skus.map(function (sku) {
    var sb = sales[sku] || { l30: 0, l90: 0 };
    var ads = (sb.l90 === sb.l30) ? (sb.l30 / 30) : (sb.l90 / 90);      // new launch → use the fresher 30-day rate
    return months.map(function (x) {
      return Math.round(ads * daysInMonth_(x.y, x.m) * growth * (SEASONALITY[x.m] || 1));
    });
  });

  // What is on the sheet now, and what we auto-wrote last time (both keyed by SKU + month label).
  var prevShown = demandGridBySku_(ss, tabName), prevAuto = demandGridBySku_(ss, autoTab);
  var ID = ['SKU', 'Image', 'ASIN', 'Parent ASIN', 'Color', 'Size', 'Sub-Category'];
  var HEAD = ID.concat(labels).concat(['Total']);

  var out = [], overrides = [];
  skus.forEach(function (sku, r) {
    var c = catalog[sku] || {};
    var img = c.image ? '=IMAGE("' + String(c.image).replace(/"/g, '') + '")' : '';
    var vals = [], total = 0;
    labels.forEach(function (lab, k) {
      var auto = autoGrid[r][k];
      var shown = prevShown[sku] ? prevShown[sku][lab] : undefined;
      var lastAuto = prevAuto[sku] ? prevAuto[sku][lab] : undefined;
      // Typed over? (a value that isn't what we auto-wrote last time) → keep it.
      var isOverride = shown != null && shown !== '' && lastAuto != null && Number(shown) !== Number(lastAuto);
      var v = isOverride ? Number(shown) : auto;
      if (isOverride) overrides.push([r + 3, ID.length + k + 1]);
      vals.push(v); total += v;
    });
    out.push([sku, img, c.asin || '', c.parent || '', c.color || '', c.size || '', c.subcat || ''].concat(vals).concat([total]));
  });

  var sh = getOrCreate_(ss, tabName); sh.clear();
  sh.setConditionalFormatRules([]);
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold');
  var totalsRow = HEAD.map(function (h, i) {
    if (i === 0) return 'TOTAL';
    if (i < ID.length) return '';
    var col = colA1_(i + 1);
    return '=SUBTOTAL(109,' + col + '3:' + col + ')';
  });
  sh.getRange(2, 1, 1, HEAD.length).setValues([totalsRow]).setFontWeight('bold').setBackground('#eaf2fb');
  sh.setFrozenRows(2); sh.setFrozenColumns(1);
  if (out.length) {
    sh.getRange(3, 1, out.length, HEAD.length).setValues(out);
    sh.getRange(2, ID.length + 1, out.length + 1, labels.length + 1).setNumberFormat('#,##0');
    try { sh.setRowHeights(3, out.length, 48); } catch (e) {}
    overrides.forEach(function (rc) { sh.getRange(rc[0], rc[1]).setBackground('#fef08a'); });   // tint manual edits
  }
  sh.setColumnWidth(1, 170); sh.setColumnWidth(2, 70);
  noteOn_(sh, 'Auto forecast = ADS × days in month × seasonality × (1 + YoY growth %). Type over any month cell to ' +
    'override it — overrides are KEPT on rebuild and tinted yellow. Clear a cell to go back to auto.');

  // Mirror the pure auto numbers so the next rebuild can tell auto from override.
  var mirror = getOrCreate_(ss, autoTab); mirror.clear();
  mirror.getRange(1, 1, 1, 1 + labels.length).setValues([['SKU'].concat(labels)]);
  if (skus.length) mirror.getRange(2, 1, skus.length, 1 + labels.length)
    .setValues(skus.map(function (s, r) { return [s].concat(autoGrid[r]); }));
  try { mirror.hideSheet(); } catch (e) {}

  ss.setActiveSheet(sh);
  if (!SILENT_RUN) SpreadsheetApp.getUi().alert(label + ' Demand ✅',
    out.length + ' SKUs × 12 months in "' + tabName + '".' +
    (overrides.length ? '\n\n' + overrides.length + ' manual override(s) preserved (tinted yellow).' : '') +
    '\n\nSeasonality + YoY growth come from the Settings tab.', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Read a demand-style grid (SKU in col A, month labels across) → { sku: { 'Jul \'26': value } }. */
function demandGridBySku_(ss, tabName) {
  var out = {}, sh = ss.getSheetByName(tabName);
  if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 2) return out;
  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  // Header row: the visible tab has headers on row 1 and totals on row 2; the mirror has no totals row.
  var head = vals[0].map(function (h) { return String(h); });
  for (var r = 1; r < vals.length; r++) {
    var sku = String(vals[r][0] || '').trim();
    if (!sku || sku === 'TOTAL') continue;
    var row = {};
    for (var c = 1; c < head.length; c++) if (head[c]) row[head[c]] = vals[r][c];
    out[sku] = row;
  }
  return out;
}

/* ===================== FBA inventory age ===================== */

/** Menu: pull Amazon's aged-inventory buckets for this sheet's brand(s). */
function buildInventoryAge() { sheetBrands_().forEach(function (b) { buildInventoryAgeForAccount_(b.pfx, b.label); }); }

/**
 * FBA inventory aging from Amazon's Inventory Planning report. The age-bucket COLUMN NAMES are read
 * from the report itself (Amazon has changed them over the years), so whatever buckets Amazon ships
 * today are what gets written — no hard-coded 0-90/91-180/… list to go stale.
 */
function buildInventoryAgeForAccount_(pfx, label) {
  ACTIVE_PREFIX = pfx;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabName = (pfx === 'CPC') ? 'CPC Inventory Age' : 'Inventory Age';
  ss.toast('Pulling ' + label + ' inventory age report…', 'Amazon Report', 30);

  var rows;
  try { rows = parseTsv_(runFlatReport_('GET_FBA_INVENTORY_PLANNING_DATA')); }
  catch (e) {
    if (!SILENT_RUN) SpreadsheetApp.getUi().alert('Inventory age failed', String(e.message || e).slice(0, 400), SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  if (!rows.length) {
    if (!SILENT_RUN) SpreadsheetApp.getUi().alert('Inventory age', 'Amazon returned no rows.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  var headers = Object.keys(rows[0]);
  var ageCols = headers.filter(function (h) { return /inv[-_ ]?age|inventory[-_ ]?age/i.test(h); });
  var extraCols = headers.filter(function (h) { return /excess|storage[-_ ]?(cost|fee)|aged/i.test(h) && ageCols.indexOf(h) < 0; });

  // Parent ASIN isn't in the report — look it up per SKU from the brand's Catalog tab (main sheet).
  var catTab = (pfx === 'CPC') ? 'CPC Catalog' : 'Catalog';
  var catalog = {};
  try { catalog = readCatalogMap_(catalogSS_(), catTab); } catch (e) {}

  function pretty(h) { return h.replace(/[-_]/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); }); }
  var HEAD = ['SKU', 'ASIN', 'Parent ASIN', 'Product', 'Available']
    .concat(ageCols.map(pretty)).concat(extraCols.map(pretty));

  var out = rows.map(function (r) {
    var sku = pick_(r, ['sku', 'msku', 'seller-sku']);
    var c = catalog[String(sku).trim()] || {};
    var base = [sku, pick_(r, ['asin']) || c.asin || '', c.parent || '',
      String(pick_(r, ['product-name', 'item-name'])).slice(0, 80),
      num_(pick_(r, ['available', 'afn-fulfillable-quantity', 'sellable-quantity']))];
    return base.concat(ageCols.map(function (h) { return num_(r[h]); }))
               .concat(extraCols.map(function (h) { return num_(r[h]); }));
  }).filter(function (r) { return r[0]; });

  // Heaviest ageing first — the rows that cost money sit at the top. Age columns start after the
  // 5 identity/stock columns (SKU · ASIN · Parent ASIN · Product · Available).
  var firstAge = 5, lastAge = 4 + ageCols.length;
  out.sort(function (a, b) {
    var av = 0, bv = 0;
    for (var i = firstAge; i <= lastAge; i++) { av += Number(a[i]) || 0; bv += Number(b[i]) || 0; }
    return bv - av;
  });

  var sh = getOrCreate_(ss, tabName); sh.clear();
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold');
  var totalsRow = HEAD.map(function (h, i) {
    if (i === 0) return 'TOTAL';
    if (i <= 3) return '';                                   // SKU · ASIN · Parent ASIN · Product
    var col = colA1_(i + 1);
    return '=SUBTOTAL(109,' + col + '3:' + col + ')';
  });
  sh.getRange(2, 1, 1, HEAD.length).setValues([totalsRow]).setFontWeight('bold').setBackground('#eaf2fb');
  sh.setFrozenRows(2);
  if (out.length) {
    sh.getRange(3, 1, out.length, HEAD.length).setValues(out);
    sh.getRange(2, 5, out.length + 1, HEAD.length - 4).setNumberFormat('#,##0');   // Available onward
    try { sh.getRange(2, 1, out.length + 1, HEAD.length).createFilter(); } catch (e) {}
  }
  sh.setColumnWidth(1, 170); sh.setColumnWidth(4, 300);
  noteOn_(sh, 'Amazon Inventory Planning report — age buckets exactly as Amazon reports them today. ' +
    'Sorted by total aged units (worst first). Row 2 = totals.');
  ss.setActiveSheet(sh);

  if (!SILENT_RUN) SpreadsheetApp.getUi().alert(label + ' Inventory age ✅',
    out.length + ' SKUs in "' + tabName + '".\n\nAge buckets found: ' + (ageCols.length ? ageCols.join(', ') : '(none — check the report)'),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ===================== Shipment history (12 months, month-wise) ===================== */

/** Bulk: EVERY inbound item (ShipmentId · SellerSKU · QuantityShipped) updated in [afterISO, beforeISO].
 *  One paginated sweep — avoids a per-shipment items call for every shipment in the year. */
function shipItemsRawByDate_(afterISO, beforeISO) {
  var out = [], nextToken = null, guard = 0;
  do {
    var path = nextToken
      ? '/fba/inbound/v0/shipmentItems?MarketplaceId=' + marketplaceId_() + '&QueryType=NEXT_TOKEN&NextToken=' + encodeURIComponent(nextToken)
      : '/fba/inbound/v0/shipmentItems?MarketplaceId=' + marketplaceId_() + '&QueryType=DATE_RANGE' +
        '&LastUpdatedAfter=' + encodeURIComponent(afterISO) + '&LastUpdatedBefore=' + encodeURIComponent(beforeISO);
    var res = sp_(path, 'get'), p = res.payload || {};
    (p.ItemData || []).forEach(function (it) { out.push(it); });
    nextToken = p.NextToken || null;
    if (nextToken) Utilities.sleep(300);
  } while (nextToken && ++guard < 300);
  return out;
}

/** Same sweep, aggregated: total QuantityShipped per ShipmentId. */
function shipItemsQtyByDate_(afterISO, beforeISO) {
  var qty = {};
  shipItemsRawByDate_(afterISO, beforeISO).forEach(function (it) {
    var id = String(it.ShipmentId || ''); if (!id) return;
    qty[id] = (qty[id] || 0) + num_(it.QuantityShipped);
  });
  return qty;
}

/** SKU-level lines of an AWD shipment detail → [{sku, qty}] in EACHES.
 *  Cases×units-per-case when the container breakdown is present, else the sku quantities. */
function awdLines_(det) {
  var byContainer = {}, out = [];
  (det.shipmentContainerQuantities || []).forEach(function (cq) {
    var count = cq.count || 0;
    var products = (cq.distributionPackage && cq.distributionPackage.contents && cq.distributionPackage.contents.products) || [];
    products.forEach(function (p) { if (p.sku) byContainer[p.sku] = (byContainer[p.sku] || 0) + count * (p.quantity || 0); });
  });
  var keys = Object.keys(byContainer);
  if (keys.length) {
    keys.forEach(function (sku) { if (byContainer[sku] > 0) out.push({ sku: sku, qty: byContainer[sku] }); });
    return out;
  }
  (det.shipmentSkuQuantities || []).forEach(function (q) {
    var sku = q.sku || q.msku || '';
    var qty = (q.quantity && q.quantity.quantity) || (q.expectedQuantity && q.expectedQuantity.quantity) || 0;
    if (sku && qty > 0) out.push({ sku: sku, qty: qty });
  });
  return out;
}

/** Total EACHES in an AWD shipment detail. */
function awdUnits_(det) {
  var t = 0; awdLines_(det).forEach(function (l) { t += l.qty; }); return t;
}

/** Menu: build the last-12-months, month-wise shipment summary for this sheet's brand(s). */
function buildShipmentHistory() {
  sheetBrands_().forEach(function (b) { buildShipmentHistoryForAccount_(b.pfx, b.label); });
}

/** Menu: line-level (per-SKU) shipment export for the last 12 months. */
function buildShipmentLines() {
  sheetBrands_().forEach(function (b) { buildShipmentLinesForAccount_(b.pfx, b.label); });
}

/**
 * Every shipment LINE of the last 12 months (FBA + AWD):
 *     Shipment Name · Date · FBA ID · SKU · Qty
 * FBA quantities come from ONE bulk shipmentItems sweep (SKU-level), joined to the shipment list for
 * the name + date — so no per-shipment API call is needed. Same date rule as the monthly summary:
 * FBA = date parsed from the shipment name, AWD = real createdAt.
 */
function buildShipmentLinesForAccount_(pfx, label) {
  ACTIVE_PREFIX = pfx;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabName = (pfx === 'CPC') ? 'CPC Shipment Lines' : 'Shipment Lines';
  ss.toast('Building ' + label + ' shipment lines (12 months)…', 'Amazon Report', 30);
  var deadline = capDeadline_(25 * 60 * 1000);

  var now = new Date();
  var afterISO = new Date(now.getTime() - 400 * 86400000).toISOString();
  var beforeISO = now.toISOString();
  var cutoffMs = Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1);

  // FBA shipment metadata: id → { name, date }
  var meta = {}, undated = {};
  var STATUSES = 'WORKING,READY_TO_SHIP,SHIPPED,RECEIVING,IN_TRANSIT,DELIVERED,CHECKED_IN,CLOSED';
  try {
    getInboundShipments_(afterISO, beforeISO, STATUSES).forEach(function (s) {
      var id = String(s.ShipmentId || ''); if (!id) return;
      meta[id] = { name: s.ShipmentName || '', date: parseShipDate_(s.ShipmentName || '') };
    });
  } catch (e) {}

  var rows = [];
  try {
    shipItemsRawByDate_(afterISO, beforeISO).forEach(function (it) {
      var id = String(it.ShipmentId || ''), m = meta[id];
      if (!m) return;                                            // not in our status/date window
      var d = m.date;
      if (!(d instanceof Date) || isNaN(d.getTime())) { undated[id] = 1; return; }
      if (d.getTime() < cutoffMs) return;
      var q = num_(it.QuantityShipped);
      if (!it.SellerSKU || q <= 0) return;
      rows.push([m.name, d, id, it.SellerSKU, q]);
    });
  } catch (e) {}

  // AWD lines — real createdAt, SKU-level from the shipment detail.
  try {
    getAwdShipments_().forEach(function (a) {
      if (Date.now() > deadline) return;
      var created = a.createdAt ? new Date(a.createdAt) : null;
      if (!(created instanceof Date) || isNaN(created.getTime()) || created.getTime() < cutoffMs) return;
      var det; try { det = getAwdShipment_(a.shipmentId); } catch (e) { det = a; }
      awdLines_(det).forEach(function (l) {
        rows.push([a.shipmentName || a.shipmentId || '', created, a.shipmentId || '', l.sku, l.qty]);
      });
    });
  } catch (e) {}

  rows.sort(function (x, y) { return (y[1] - x[1]) || String(x[2]).localeCompare(String(y[2])); });  // newest first

  var HEAD = ['FBA Shipment Name', 'Date', 'FBA ID', 'SKU', 'Qty'];
  var sh = getOrCreate_(ss, tabName); sh.clear();
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (rows.length) {
    for (var r0 = 0; r0 < rows.length; r0 += 5000) {                 // chunked write for big exports
      var ch = rows.slice(r0, r0 + 5000);
      sh.getRange(2 + r0, 1, ch.length, HEAD.length).setValues(ch);
    }
    sh.getRange(2, 2, rows.length, 1).setNumberFormat(DATE_FMT);
    sh.getRange(2, 5, rows.length, 1).setNumberFormat('#,##0');
    var tr = rows.length + 2;
    sh.getRange(tr, 4).setValue('TOTAL');
    sh.getRange(tr, 5).setFormula('=SUM(E2:E' + (rows.length + 1) + ')');
    sh.getRange(tr, 1, 1, HEAD.length).setFontWeight('bold').setBackground('#eaf2fb');
  }
  sh.setColumnWidth(1, 320); sh.setColumnWidth(3, 150); sh.setColumnWidth(4, 170);
  try { sh.getRange(1, 1, rows.length + 1, HEAD.length).createFilter(); } catch (e) {}
  ss.setActiveSheet(sh);
  var nUndated = Object.keys(undated).length;
  noteOn_(sh, 'Every shipment line, last 12 months. FBA date = shipment-name date (Amazon v0 has no creation timestamp); AWD date = real createdAt. Cancelled/deleted excluded.' +
    (nUndated ? ' ' + nUndated + ' FBA shipment(s) had no date in their name and were skipped.' : ''));

  if (!SILENT_RUN) SpreadsheetApp.getUi().alert(label + ' Shipment lines ✅',
    rows.length + ' line(s) written to "' + tabName + '".' +
    (nUndated ? '\n\n⚠️ ' + nUndated + ' FBA shipment(s) had no parseable date in their name — skipped.' : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Last 12 months of shipments (FBA + AWD), grouped by CREATION month → # distinct shipments + total qty.
 * FBA month = the date in the shipment name (Amazon's v0 API exposes no creation timestamp); AWD month =
 * the real createdAt. Cancelled / deleted shipments are excluded. Writes a "Shipment History" tab.
 */
function buildShipmentHistoryForAccount_(pfx, label) {
  ACTIVE_PREFIX = pfx;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabName = (pfx === 'CPC') ? 'CPC Shipment History' : 'Shipment History';
  ss.toast('Building ' + label + ' shipment history (12 months)…', 'Amazon Report', 30);
  var deadline = capDeadline_(25 * 60 * 1000);

  var now = new Date();
  var afterISO = new Date(now.getTime() - 400 * 86400000).toISOString();                 // ~13 months back
  var beforeISO = now.toISOString();
  var cutoffMs = Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1);                // start of the month 12 mo ago

  var months = {};
  function bucket(k) { return months[k] || (months[k] = { fbaShip: {}, fbaQty: 0, awdShip: {}, awdQty: 0 }); }
  function ymOf(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }

  // FBA — one bulk items sweep for quantities, then walk the shipments for names/dates.
  var qtyByShip = {}; try { qtyByShip = shipItemsQtyByDate_(afterISO, beforeISO); } catch (e) {}
  var undated = 0;
  var STATUSES = 'WORKING,READY_TO_SHIP,SHIPPED,RECEIVING,IN_TRANSIT,DELIVERED,CHECKED_IN,CLOSED';
  var shipments = [];
  try { shipments = getInboundShipments_(afterISO, beforeISO, STATUSES); } catch (e) {}
  shipments.forEach(function (s) {
    if (Date.now() > deadline) return;
    var d = parseShipDate_(s.ShipmentName || '');
    if (!(d instanceof Date) || isNaN(d.getTime())) { undated++; return; }
    if (d.getTime() < cutoffMs) return;                                                   // older than 12 months
    var id = String(s.ShipmentId || ''), b = bucket(ymOf(d));
    var q = qtyByShip[id];
    if (q == null) { q = 0; try { getShipmentItems_(id).forEach(function (it) { q += num_(it.QuantityShipped); }); } catch (e) {} }
    b.fbaShip[id] = 1; b.fbaQty += q || 0;
  });

  // AWD — real createdAt is the creation date.
  try {
    getAwdShipments_().forEach(function (a) {
      if (Date.now() > deadline) return;
      var created = a.createdAt ? new Date(a.createdAt) : null;
      if (!(created instanceof Date) || isNaN(created.getTime()) || created.getTime() < cutoffMs) return;
      var b = bucket(ymOf(created)), det;
      try { det = getAwdShipment_(a.shipmentId); } catch (e) { det = a; }
      b.awdShip[a.shipmentId] = 1; b.awdQty += awdUnits_(det);
    });
  } catch (e) {}

  // Write the summary.
  var keys = Object.keys(months).sort();
  var rows = keys.map(function (k) {
    var b = months[k], fs = Object.keys(b.fbaShip).length, aw = Object.keys(b.awdShip).length;
    return [k, fs, b.fbaQty, aw, b.awdQty, fs + aw, b.fbaQty + b.awdQty];
  });
  var HEAD = ['Month', 'FBA Shipments', 'FBA Qty', 'AWD Shipments', 'AWD Qty', 'Total Shipments', 'Total Qty'];
  var sh = getOrCreate_(ss, tabName); sh.clear();
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, HEAD.length).setValues(rows);
    [3, 5, 7].forEach(function (c) { sh.getRange(2, c, rows.length, 1).setNumberFormat('#,##0'); });
    var tr = rows.length + 2;
    sh.getRange(tr, 1).setValue('TOTAL');
    [2, 3, 4, 5, 6, 7].forEach(function (c) { sh.getRange(tr, c).setFormula('=SUM(' + colA1_(c) + '2:' + colA1_(c) + (rows.length + 1) + ')'); });
    sh.getRange(tr, 1, 1, HEAD.length).setFontWeight('bold').setBackground('#eaf2fb');
  }
  sh.autoResizeColumns(1, HEAD.length);
  ss.setActiveSheet(sh);
  noteOn_(sh, 'Last 12 months by CREATION month. FBA date = shipment-name date (Amazon v0 has no creation timestamp); AWD date = real createdAt. Cancelled/deleted excluded.' +
    (undated ? ' ' + undated + ' FBA shipment(s) had no date in their name and were skipped.' : ''));

  if (!SILENT_RUN) SpreadsheetApp.getUi().alert(label + ' Shipment history ✅',
    rows.length + ' month(s) written to "' + tabName + '".' +
    (undated ? '\n\n⚠️ ' + undated + ' FBA shipment(s) had no parseable date in their name — skipped (Amazon\'s FBA API has no creation-date field, so the name\'s date is used).' : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** DEBUG: dump a real AWD shipment's detail JSON so we can verify the item fields. */
function debugInspectAwd() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rows = [];
  function add(s) { rows.push([s]); }
  function keysOf(o) { return o && typeof o === 'object' ? Object.keys(o).join(', ') : '(' + typeof o + ')'; }

  var list = [];
  try { list = getAwdShipments_(); } catch (e) { add('list ERROR: ' + e.message); }
  add('AWD list count: ' + list.length);
  if (list.length) add('statuses: ' + list.slice(0, 12).map(function (s) { return s.shipmentStatus; }).join(', '));

  var pick = null;
  for (var i = 0; i < list.length; i++) {
    var st = String(list[i].shipmentStatus || '').toUpperCase();
    if (st === 'CREATED' || st === 'SHIPPED') { pick = list[i]; break; }
  }
  if (pick) {
    add('--- getInboundShipment ' + pick.shipmentId + ' (' + pick.shipmentStatus + ') ---');
    try {
      var det = getAwdShipment_(pick.shipmentId);
      add('detail keys: ' + keysOf(det));
      var items = det.shipmentSkuQuantities || [];
      add('shipmentSkuQuantities: ' + (det.shipmentSkuQuantities ? items.length + ' items' : 'MISSING'));
      add('item[0] keys: ' + keysOf(items[0] || {}));
      add('FULL JSON:');
      add(JSON.stringify(det, null, 2));
    } catch (e) { add('getInboundShipment ERROR: ' + e.message); }
  } else {
    add('No CREATED/SHIPPED AWD shipment found.');
  }

  var dbg = ss.getSheetByName('_Debug') || ss.insertSheet('_Debug');
  dbg.clear();
  dbg.getRange(1, 1, rows.length, 1).setValues(rows);
  dbg.setColumnWidth(1, 760);
  ss.setActiveSheet(dbg);
  SpreadsheetApp.getUi().alert('AWD detail written to "_Debug" sheet — screenshot it if needed.');
}

// Menu entry points — one per brand.
function importShipmentsFromAmazon() { importShipmentsForAccount_('SP', TAB.SHIPMENTS, 'Ridhi'); }
function importCpcShipments() { importShipmentsForAccount_('CPC', 'CPC Shipments', 'CPC'); }

function importShipmentsForAccount_(pfx, tabName, label, fast) {
  ACTIVE_PREFIX = pfx;                       // all sp_ calls below use this brand's credentials
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = getSettings_();
  ss.toast('Fetching ' + label + ' inbound shipments (last ' + SHIPMENTS_MONTHS + ' months)…', 'Amazon Report', 20);

  // Request the FULL status list (same as Amazon Hub) so nothing is missed,
  // then keep only the statuses the user wants. This is why Working showed up
  // empty before — a SHIPPED-only request excluded Working shipments.
  var ALL_STATUSES = 'WORKING,READY_TO_SHIP,SHIPPED,RECEIVING,IN_TRANSIT,DELIVERED,CHECKED_IN,CANCELLED,DELETED,CLOSED,ERROR';
  var afterISO = new Date(Date.now() - SHIPMENTS_MONTHS * 30 * 86400000).toISOString();
  var beforeISO = new Date().toISOString();
  var t0 = Date.now(), shipDeadline = capDeadline_(25 * 60 * 1000);
  var out = [], kept = 0, classicTotal = 0, classicErr = '';
  var statusCounts = {}, seenFba = {};      // FBA IDs captured via classic v0 → de-dupe the new flow

  // --- Classic v0 API: SHIPPED / IN_TRANSIT (wrapped so a failure here does not
  //     block the new-flow pull below). ---
  try {
    var shipments = getInboundShipments_(afterISO, beforeISO, ALL_STATUSES);
    classicTotal = shipments.length;
    shipments.forEach(function (sh) {
      var st = String(sh.ShipmentStatus || '?').toUpperCase();
      statusCounts[st] = (statusCounts[st] || 0) + 1;
    });
    for (var s = 0; s < shipments.length; s++) {
      if (Date.now() > shipDeadline) break;
      var sh = shipments[s];
      var status = String(sh.ShipmentStatus || '').toUpperCase();
      if (!SHIP_KEEP[status]) continue;          // keep Working / Shipped / In Transit / Checked In
      kept++;
      var statusLabel = SHIP_KEEP[status];
      seenFba[String(sh.ShipmentId || '')] = 1; // remember it so the new flow won't add it again

      var name = sh.ShipmentName || '';
      var mode = modeFromName_(name);                     // 'Air' / 'Sea' / 'AWD'
      var days = transitDays_(normMode_(mode), settings); // 15 / 80 / 7
      var shipDate = parseShipDate_(name);
      var eta = (shipDate instanceof Date) ? addDays_(shipDate, days) : '';
      var month = (eta instanceof Date) ? sellingMonthLabel_(eta, settings.cutoffDay) : '';

      ss.toast('Shipment ' + (s + 1) + ' / ' + shipments.length + '  ' + (sh.ShipmentId || ''), 'Amazon Report', 10);
      var items = [];
      try { items = getShipmentItems_(sh.ShipmentId); } catch (e) { items = []; }
      items.forEach(function (it) {
        var qty = num_(it.QuantityShipped);
        if (!it.SellerSKU || qty <= 0) return;
        // Ship Date · ETA · Selling Month · FBA ID · SKU · Qty · Mode · Status · Transit Days · Name
        out.push([shipDate, eta, month, sh.ShipmentId || '', it.SellerSKU, qty, mode, statusLabel, days, name]);
      });
    }
  } catch (e) { classicErr = String(e.message || e); }

  // --- New "Send to Amazon" flow: drill ACTIVE plans → ACCEPTED placement →
  //     real shipments, keeping only WORKING / READY_TO_SHIP (skip drafts). ---
  var planCount = 0, draftSkipped = 0, realShipments = 0, planLines = 0, planErr = '';
  if (!fast) try {   // classic v0 already captures confirmed shipments; skip the slow 500+-plan drill in fast/auto mode
    var plans = getInboundPlans_('ACTIVE');
    planCount = plans.length;
    var base = '/inbound/fba/2024-03-20/inboundPlans/';

    for (var pi = 0; pi < plans.length; pi++) {
      if (Date.now() > shipDeadline) break;
      var planId = plans[pi].inboundPlanId;
      if (pi % 10 === 0) {
        ss.toast('Scanning plan ' + (pi + 1) + ' / ' + plans.length +
          '  (real shipments so far: ' + realShipments + ')', 'Amazon Report', 10);
      }

      // 1) Placement options — only ACCEPTED ones have real (confirmed) shipments.
      var opts;
      try { opts = spGet_(base + encodeURIComponent(planId) + '/placementOptions?pageSize=20'); }
      catch (e) { Utilities.sleep(250); continue; }
      var shipIds = [];
      (opts.placementOptions || []).forEach(function (o) {
        if (String(o.status || '').toUpperCase() === 'ACCEPTED') {
          (o.shipmentIds || []).forEach(function (id) { shipIds.push(id); });
        }
      });
      if (!shipIds.length) { draftSkipped++; Utilities.sleep(200); continue; }

      // 2) Each confirmed shipment — keep only WORKING / READY_TO_SHIP.
      for (var si = 0; si < shipIds.length; si++) {
        var shp;
        try { shp = spGet_(base + encodeURIComponent(planId) + '/shipments/' + encodeURIComponent(shipIds[si])); }
        catch (e) { continue; }
        var st = String(shp.status || '').toUpperCase();
        var label = (st === 'READY_TO_SHIP') ? 'Ready to Ship' : (st === 'WORKING') ? 'Working' : null;
        if (!label) continue;   // SHIPPED / CLOSED etc. arrive via the classic API
        var fbaId = shp.shipmentConfirmationId || shipIds[si];
        if (seenFba[String(fbaId)]) continue;   // already captured via classic v0 — skip duplicate
        seenFba[String(fbaId)] = 1;
        realShipments++;

        var nm = shp.name || '';
        var mode = modeFromName_(nm);                       // 'Air' / 'Sea' / 'AWD'
        var days = transitDays_(normMode_(mode), settings); // 15 / 80 / 7
        var shipDate = parseShipDate_(nm);
        // ETA = Ship Date + transit days for the mode named in the shipment.
        var eta = (shipDate instanceof Date) ? addDays_(shipDate, days) : '';
        var month = (eta instanceof Date) ? sellingMonthLabel_(eta, settings.cutoffDay) : '';

        // 3) Shipment items (paginated).
        var items = [], token = null, g = 0;
        do {
          var ipath = base + encodeURIComponent(planId) + '/shipments/' + encodeURIComponent(shipIds[si]) +
            '/items?pageSize=100' + (token ? '&paginationToken=' + encodeURIComponent(token) : '');
          var ir; try { ir = spGet_(ipath); } catch (e) { ir = {}; }
          (ir.items || []).forEach(function (it) { items.push(it); });
          token = (ir.pagination && ir.pagination.nextToken) || null;
        } while (token && ++g < 50);

        items.forEach(function (it) {
          var q = num_(it.quantity);
          if (!it.msku || q <= 0) return;
          out.push([shipDate, eta, month, fbaId, it.msku, q, mode, label, days, nm]);
          planLines++;
        });
        Utilities.sleep(150);
      }
      Utilities.sleep(150);
    }
  } catch (e) {
    planErr = String(e.message || e);
  }

  // --- AWD inbound shipments (STAR-*): keep CREATED / SHIPPED, always Sea logic ---
  var awdKept = 0, awdLines = 0, awdErr = '';
  var AWD_KEEP = { CREATED: 'Created', SHIPPED: 'Shipped' };
  try {
    var awdList = getAwdShipments_();
    for (var ai = 0; ai < awdList.length; ai++) {
      if (Date.now() > shipDeadline) break;
      var asum = awdList[ai];
      var ast = String(asum.shipmentStatus || '').toUpperCase();
      if (!AWD_KEEP[ast]) continue;
      awdKept++;

      var det;
      try { det = getAwdShipment_(asum.shipmentId); } catch (e) { det = asum; }
      var aShipDate = det.createdAt ? new Date(det.createdAt)
        : (asum.createdAt ? new Date(asum.createdAt) : '');
      if (aShipDate instanceof Date && isNaN(aShipDate.getTime())) aShipDate = '';
      var aDays = settings.seaTransitDays;                       // AWD travels by Sea (80)
      var aEta = (aShipDate instanceof Date) ? addDays_(aShipDate, aDays) : '';
      var aMonth = (aEta instanceof Date) ? sellingMonthLabel_(aEta, settings.cutoffDay) : '';

      // Quantity must be in EACHES. shipmentSkuQuantities.expectedQuantity is
      // often in CASES — the real unit count is in shipmentContainerQuantities
      // (count of cases × units per case from each package's products[]).
      var unitsBySku = {};
      (det.shipmentContainerQuantities || []).forEach(function (cq) {
        var count = cq.count || 0;
        var products = (cq.distributionPackage && cq.distributionPackage.contents &&
          cq.distributionPackage.contents.products) || [];
        products.forEach(function (p) {
          if (p.sku) unitsBySku[p.sku] = (unitsBySku[p.sku] || 0) + count * (p.quantity || 0);
        });
      });

      var skuList = det.shipmentSkuQuantities || [];
      if (skuList.length) {
        skuList.forEach(function (q) {
          var sku = q.sku;
          // prefer eaches from containers; fall back to expectedQuantity if absent
          var qty = unitsBySku[sku];
          if (!qty) qty = (q.expectedQuantity && q.expectedQuantity.quantity) || 0;
          if (!sku || qty <= 0) return;
          out.push([aShipDate, aEta, aMonth, asum.shipmentId, sku, qty, 'AWD', AWD_KEEP[ast], aDays, asum.shipmentId]);
          awdLines++;
        });
      } else {
        Object.keys(unitsBySku).forEach(function (sku) {
          if (unitsBySku[sku] <= 0) return;
          out.push([aShipDate, aEta, aMonth, asum.shipmentId, sku, unitsBySku[sku], 'AWD', AWD_KEEP[ast], aDays, asum.shipmentId]);
          awdLines++;
        });
      }
      Utilities.sleep(200);
    }
  } catch (e) { awdErr = String(e.message || e); }

  buildShipmentsTab_(ss, tabName);
  var dest = ss.getSheetByName(tabName);
  if (out.length) {
    dest.getRange(2, 1, out.length, SHIP_HEADERS.length).setValues(out);
    dest.getRange(2, 1, out.length, 1).setNumberFormat(DATE_FMT);
    dest.getRange(2, 2, out.length, 1).setNumberFormat(DATE_FMT);
  }

  // Diagnostic summary: classic v0 statuses + new inbound-plan (Working) counts.
  var lines = Object.keys(statusCounts).sort().map(function (k) {
    return '   ' + k + ': ' + statusCounts[k] + (SHIP_KEEP[k] ? '  ✓ kept' : '  (skipped)');
  });
  if (!SILENT_RUN) SpreadsheetApp.getUi().alert(
    label + ' shipments pulled ✅  (tab: ' + tabName + ')\n\n' +
    'CLASSIC API (Shipped / In Transit):\n' +
    '   total from Amazon: ' + classicTotal + ' , kept: ' + kept + '\n' +
    (lines.join('\n') || '   (none)') +
    (classicErr ? ('\n   ⚠️ classic API error: ' + classicErr) : '') + '\n\n' +
    'NEW "Send to Amazon" flow (Working / Ready to ship):\n' +
    '   ACTIVE plans scanned: ' + planCount + '\n' +
    '   drafts skipped (no confirmed shipment): ' + draftSkipped + '\n' +
    '   REAL shipments kept: ' + realShipments + '  →  ' + planLines + ' SKU lines' +
    (planErr ? ('\n   ⚠️ inbound-plans API error: ' + planErr) : '') + '\n\n' +
    'AWD shipments (Created / Shipped, Sea logic):\n' +
    '   kept: ' + awdKept + '  →  ' + awdLines + ' SKU lines' +
    (awdErr ? ('\n   ⚠️ AWD API error: ' + awdErr) : '') + '\n\n' +
    'TOTAL rows written to Shipments tab: ' + out.length
  );
}

/* ===================== Orders tab schema (shared with downstream consumers) =====================
 * The Orders IMPORT module (Amazon pull + maintenance + Order Summary + coverage debug) was
 * REMOVED 2026-07-07 for a from-scratch rebuild (old data kept coming in wrong). These constants
 * are intentionally KEPT because the downstream READERS depend on the Orders tab's column layout:
 * Inventory (L30/L90/ADS via computeSalesBucketsFromOrders_), Daily Performance
 * (appendLiveDaysFromOrders_), Sales Analysis (computeMonthlySales_) and Parent W-o-W
 * (syncParentWoW_). The NEW Orders module must write the Orders / CPC Orders tab using EXACTLY
 * these columns so those consumers keep working automatically once the tab is rebuilt. */
var ORDERS_START_DATE = '2025-01-01';
var ORDERS_REFRESH_DAYS = 30;               // used by Daily Performance's rolling window (NOT the Orders module)
var ORDERS_HEADERS = ['Order ID', 'Purchase Date/Time', 'Date', 'SKU', 'ASIN', 'Units',
                      'Revenue', 'Order Status', 'Sales Channel', 'MCF'];

/** Spreadsheet that holds this sheet's RAW Orders data. If Script Property ORDERS_DATA_ID is set,
 *  the heavy Orders tab lives in a SEPARATE workbook (opened via openById — its rows never load into
 *  the main sheet, keeping it light); the Orders module writes there and every consumer reads there.
 *  If unset, falls back to the active spreadsheet (Orders in the same file — backward-compatible). */
function ordersSS_() {
  try {
    var id = SpreadsheetApp.getActiveSpreadsheet().getId();
    if (id === RIDHI_ORDERS_DATA_ID || id === CPC_ORDERS_DATA_ID) return SpreadsheetApp.getActiveSpreadsheet();  // a DATA sheet stores Orders in itself
    if (id === RIDHI_SHEET_ID) return SpreadsheetApp.openById(RIDHI_ORDERS_DATA_ID);   // Ridhi MAIN → its Orders Data sheet
    if (id === CPC_SHEET_ID)   return SpreadsheetApp.openById(CPC_ORDERS_DATA_ID);      // CPC MAIN → its Orders Data sheet
    // PLANNING sheet serves both brands, so the brand being processed decides (ACTIVE_PREFIX is set
    // by whichever build function is running).
    if (id === PLANNING_SHEET_ID) return SpreadsheetApp.openById(ACTIVE_PREFIX === 'CPC' ? CPC_ORDERS_DATA_ID : RIDHI_ORDERS_DATA_ID);
  } catch (e) { Logger.log('ordersSS_: ' + e); }
  var prop = prop_('ORDERS_DATA_ID');                                                   // manual override still honoured
  if (prop) { try { return SpreadsheetApp.openById(prop); } catch (e) {} }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/* ===================== Orders module v2 (rebuilt 2026-07-07) =====================
 * Two operations, both writing the Orders / CPC Orders tab in the ORDERS_HEADERS columns:
 *   1) INITIAL import — full history from ORDERS_START_DATE (2025-01-01) → today, run ONCE.
 *      Resumable across the ~30-min execution limit; once done, that history is FROZEN.
 *   2) ROLLING sync   — the normal update. Re-pulls ONLY the last ORDERS_SYNC_DAYS days (by
 *      purchase date, PT) and BLOCK-REPLACES those rows → recent status / shipment / refund /
 *      cancellation changes are picked up, no duplicate rows are created, and everything older
 *      than the window is never touched (frozen). The window boundary auto-advances each day.
 * Auto-sync runs the ROLLING sync for this sheet's brand EVERY 6 HOURS in the background.
 * TIMEZONE UNCHANGED: order-date boundaries use America/Los_Angeles (PT), exactly as before;
 * the script timezone (Asia/Kolkata) still sets the trigger clock. */

var ORDERS_SYNC_DAYS = 20;                 // rolling window: normal sync re-pulls only the last N days
var ORDERS_PT = 'America/Los_Angeles';     // order-date boundary timezone (unchanged)

/** Amazon All-Orders report (by purchase date, PT-anchored). Returns the TSV text, or '' for
 *  an empty / not-yet-started window (start ≥ end) so callers never hit a 400. */
function ordersReport_(startStr, endStr) {
  function laISO(d, hms) {
    var off = Utilities.formatDate(new Date(d + 'T12:00:00Z'), ORDERS_PT, 'Z');   // e.g. "-0700"
    return d + 'T' + hms + off.slice(0, 3) + ':' + off.slice(3);
  }
  var startISO = new Date(laISO(startStr, '00:00:00')).toISOString();
  var end = new Date(laISO(endStr, '23:59:59'));
  if (end > new Date()) end = new Date();
  if (new Date(startISO).getTime() >= end.getTime()) return '';
  var reportId = sp_('/reports/2021-06-30/reports', 'post', {
    reportType: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL',
    marketplaceIds: [marketplaceId_()], dataStartTime: startISO, dataEndTime: end.toISOString(),
  }).reportId;
  var docId = null, deadline = Date.now() + 7 * 60 * 1000;
  while (Date.now() < deadline) {
    Utilities.sleep(15000);
    var r = sp_('/reports/2021-06-30/reports/' + reportId, 'get');
    if (r.processingStatus === 'DONE') { docId = r.reportDocumentId; break; }
    if (r.processingStatus === 'FATAL' || r.processingStatus === 'CANCELLED') throw new Error('Orders report ' + r.processingStatus);
  }
  if (!docId) throw new Error('Orders report timed out — run again.');
  var doc = sp_('/reports/2021-06-30/documents/' + docId, 'get');
  var blob = UrlFetchApp.fetch(doc.url, { muteHttpExceptions: true }).getBlob();
  if (doc.compressionAlgorithm === 'GZIP') blob = Utilities.ungzip(blob.setContentType('application/x-gzip'));
  return blob.getDataAsString('UTF-8');
}

/** Parse the report TSV → Orders rows (10 cols; MCF tagged; Date col = PT purchase date). */
function ordersParse_(tsv) {
  var lines = String(tsv || '').split(/\r?\n/);
  if (lines.length < 2) return [];
  var H = {}; lines[0].split('\t').forEach(function (h, i) { H[h.trim().toLowerCase()] = i; });
  var iOrder = H['amazon-order-id'], iPurch = H['purchase-date'], iSku = H['sku'],
      iAsin = H['asin'], iQty = H['quantity'], iPrice = H['item-price'],
      iStatus = H['order-status'], iChan = H['sales-channel'];
  var out = [];
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    var c = lines[i].split('\t');
    var purch = c[iPurch] || '', chan = c[iChan] || '';
    var pd = new Date(purch);
    var dateStr = isNaN(pd.getTime()) ? String(purch).slice(0, 10) : Utilities.formatDate(pd, ORDERS_PT, 'yyyy-MM-dd');
    out.push([c[iOrder] || '', purch, dateStr, c[iSku] || '', c[iAsin] || '',
      num_(c[iQty]), num_(c[iPrice]), c[iStatus] || '', chan,
      /non-amazon/i.test(chan) ? 'MCF' : 'Amazon']);
  }
  return out;
}

/** Write the Orders header row on a fresh/empty tab (clears the tab first). */
function ordersHeaderRow_(sh) {
  sh.clear();
  sh.getRange(1, 1, 1, ORDERS_HEADERS.length).setValues([ORDERS_HEADERS])
    .setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold');
  sh.setFrozenRows(1);
}

/** Append rows in 5k chunks + (re)apply Units / Revenue number formats. */
function ordersAppend_(sh, rows) {
  if (!rows.length) return;
  var writeRow = sh.getLastRow() + 1;
  for (var r0 = 0; r0 < rows.length; r0 += 5000) {
    var ch = rows.slice(r0, r0 + 5000);
    sh.getRange(writeRow, 1, ch.length, ORDERS_HEADERS.length).setValues(ch);
    writeRow += ch.length;
  }
  sh.getRange('F2:F').setNumberFormat('#,##0');
  sh.getRange('G2:G').setNumberFormat('$#,##0.00');
}

/* ---- 1) INITIAL historical import — full history from 2025, resumable, run ONCE ---- */
function ordersInitialImport_(pfx, tabName, label) {
  ACTIVE_PREFIX = pfx;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) { if (!SILENT_RUN) { try { SpreadsheetApp.getUi().alert('Another Orders job is running — wait a moment, then run it again.'); } catch (e) {} } return; }
  try {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var sh = ordersSS_().getSheetByName(tabName) || ordersSS_().insertSheet(tabName);
  var DAY = 86400000;
  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var todayMs = new Date(todayStr + 'T00:00:00Z').getTime();
  var curKey = 'ORDERS_INIT_NEXT_' + pfx;
  var cursor = props.getProperty(curKey);
  if (!cursor) { ordersHeaderRow_(sh); cursor = ORDERS_START_DATE; }   // fresh start → wipe + header

  var runDeadline = capDeadline_(22 * 60 * 1000);
  var added = 0;
  while (new Date(cursor + 'T00:00:00Z').getTime() < todayMs && Date.now() < runDeadline) {
    var cStart = cursor;
    var cEndMs = Math.min(new Date(cursor + 'T00:00:00Z').getTime() + 29 * DAY, todayMs);
    var cEnd = Utilities.formatDate(new Date(cEndMs), 'UTC', 'yyyy-MM-dd');
    ss.toast('Initial import ' + label + '  ' + cStart + ' → ' + cEnd + '…', 'Orders', 30);
    var rows;
    try { rows = ordersParse_(ordersReport_(cStart, cEnd)); }
    catch (e) {
      if (!SILENT_RUN) SpreadsheetApp.getUi().alert('Initial import stopped at ' + cStart + ':\n' + (e.message || e) +
        '\n\nRun "Initial ' + label + ' Orders import" again to resume from here.');
      return;
    }
    ordersAppend_(sh, rows);
    added += rows.length;
    cursor = Utilities.formatDate(new Date(cEndMs + DAY), 'UTC', 'yyyy-MM-dd');
    props.setProperty(curKey, cursor);
  }

  if (new Date(cursor + 'T00:00:00Z').getTime() >= todayMs) {
    props.deleteProperty(curKey);
    ordersDedupe_(sh);                                   // safety net: no duplicate (Order ID + SKU) rows
    if (!SILENT_RUN) SpreadsheetApp.getUi().alert(label + ' Orders — initial import COMPLETE ✅\n\n' +
      Math.max(sh.getLastRow() - 1, 0) + ' order lines (2025 → today). History is now frozen — from now use ' +
      '"Sync ' + label + ' Orders (last ' + ORDERS_SYNC_DAYS + ' days)" or the 6-hour auto-sync.');
  } else if (!SILENT_RUN) {
    SpreadsheetApp.getUi().alert(label + ' Orders — imported through ' + cursor + '  (' + added + ' lines this run).\n\n' +
      'Run "Initial ' + label + ' Orders import" again to continue (it resumes automatically).');
  }
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

/* ---- 2) ROLLING sync — re-pull ONLY the last ORDERS_SYNC_DAYS days, block-replace ---- */
function ordersRollingSync_(pfx, tabName, label) {
  ACTIVE_PREFIX = pfx;
  // Do NOT run while the INITIAL backfill for this brand is still going — a chunk about to be
  // imported would overlap this window and create dupes. Resume rolling once the backfill completes.
  if (PropertiesService.getScriptProperties().getProperty('ORDERS_INIT_NEXT_' + pfx)) {
    return { ok: false, skipped: true, label: label, reason: 'initial import in progress' };
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ordersSS_().getSheetByName(tabName) || ordersSS_().insertSheet(tabName);
  var DAY = 86400000;
  var todayStr = Utilities.formatDate(new Date(), ORDERS_PT, 'yyyy-MM-dd');
  var todayMs = new Date(todayStr + 'T00:00:00Z').getTime();
  var startMs = todayMs - (ORDERS_SYNC_DAYS - 1) * DAY;          // inclusive window start (last N days incl today)
  var startStr = Utilities.formatDate(new Date(startMs), 'UTC', 'yyyy-MM-dd');

  if (sh.getLastRow() < 1 || !String(sh.getRange(1, 1).getValue()).trim()) ordersHeaderRow_(sh);

  // (a) Pull the window FIRST. If Amazon errors / times out, this THROWS before anything is deleted,
  //     so the existing window data is never lost (avoids a delete-then-fail data hole).
  var rows = ordersParse_(ordersReport_(startStr, todayStr));

  // (b) Delete the existing window rows (col C Date ≥ startMs) → block replace (frozen history untouched).
  if (sh.getLastRow() > 1) {
    var n = sh.getLastRow() - 1;
    var dc = sh.getRange(2, 3, n, 1).getValues();                // col C = Date
    var del = [];
    for (var i = 0; i < dc.length; i++) { if (toMs_(dc[i][0]) >= startMs) del.push(i + 2); }
    del.sort(function (a, b) { return b - a; });                 // delete bottom-up (contiguous blocks)
    var p = 0;
    while (p < del.length) {
      var e = del[p], s = e;
      while (p + 1 < del.length && del[p + 1] === s - 1) { s = del[p + 1]; p++; }
      sh.deleteRows(s, e - s + 1);
      p++;
    }
  }

  // (c) Append the fresh window, then self-heal duplicates across the WHOLE tab (keeps the freshest
  //     copy). Guards against a delete-miss AND cleans older dups the 20-day window never touches —
  //     so duplicates can never accumulate.
  ordersAppend_(sh, rows);
  var dup = ordersDedupe_(sh);
  return { ok: true, label: label, added: rows.length, from: startStr, deduped: dup };
}

/**
 * Remove duplicate (Order ID + SKU) rows from an Orders tab, keeping the LAST (freshest) copy of
 * each. Rewrites the data block in one pass (fast). Rows with no Order ID are left untouched.
 */
function ordersDedupe_(sh) {
  if (!sh || sh.getLastRow() < 3) return 0;
  var n = sh.getLastRow() - 1;
  var vals = sh.getRange(2, 1, n, ORDERS_HEADERS.length).getValues();
  var lastIdx = {};
  for (var i = 0; i < n; i++) { var oid = String(vals[i][0] || ''); if (oid) lastIdx[oid + '|' + String(vals[i][3] || '')] = i; }
  var keep = [];
  for (var j = 0; j < n; j++) {
    var oid2 = String(vals[j][0] || '');
    if (!oid2 || lastIdx[oid2 + '|' + String(vals[j][3] || '')] === j) keep.push(vals[j]);
  }
  var removed = n - keep.length;
  if (removed > 0) {
    sh.getRange(2, 1, n, ORDERS_HEADERS.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, ORDERS_HEADERS.length).setValues(keep);
    sh.getRange('F2:F').setNumberFormat('#,##0');
    sh.getRange('G2:G').setNumberFormat('$#,##0.00');
  }
  return removed;
}

/** Menu: remove duplicate Orders now (this sheet's brand). Keeps the freshest copy of each line. */
function ordersDedupe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var msg = sheetBrands_().map(function (b) {
    var sh = ordersSS_().getSheetByName(b.ordTab);
    return b.label + ': ' + (sh ? (ordersDedupe_(sh) + ' duplicate row(s) removed') : 'no Orders tab');
  });
  if (!SILENT_RUN) { try { SpreadsheetApp.getUi().alert('🧹 Orders de-duplicated ✅',
    msg.join('\n') + '\n\nKept the freshest copy of each Order ID + SKU. Rebuild Inventory + re-sync so ' +
    'the dashboard picks up the corrected totals.', SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {} }
}

/* ---- Menu entry points (per brand) ---- */
function ordersInitialRidhi() { ordersInitialImport_('SP', 'Orders', 'Ridhi'); }
function ordersInitialCpc()   { ordersInitialImport_('CPC', 'CPC Orders', 'CPC'); }
function ordersSyncRidhi()    { ordersSyncManual_('SP', 'Orders', 'Ridhi'); }
function ordersSyncCpc()      { ordersSyncManual_('CPC', 'CPC Orders', 'CPC'); }
/** Manual rolling sync entry — LOCKED so it can never run alongside the 6-hour auto-sync / initial import. */
function ordersSyncManual_(pfx, tab, label) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) { try { SpreadsheetApp.getUi().alert('Another Orders job is running — wait a moment, then try again.'); } catch (e) {} return; }
  try { ordersSyncAlert_(ordersRollingSync_(pfx, tab, label)); }
  finally { try { lock.releaseLock(); } catch (e) {} }
}
function ordersSyncAlert_(r) {
  if (SILENT_RUN || !r) return;
  try {
    if (r.skipped) { SpreadsheetApp.getUi().alert('Sync skipped', 'The initial import is still running — let it finish (COMPLETE ✅), then sync.', SpreadsheetApp.getUi().ButtonSet.OK); return; }
    SpreadsheetApp.getUi().alert(r.label + ' Orders synced ✅',
      'Last ' + ORDERS_SYNC_DAYS + ' days refreshed (' + r.added + ' lines from ' + r.from + ')' +
      (r.deduped ? ', ' + r.deduped + ' duplicate row(s) cleaned' : '') +
      '. Recent status / refund / cancel changes are updated; everything older stays frozen.',
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}
}

/* ---- Auto-sync every 6 hours (rolling window, background, this sheet's brand) ---- */
function ordersAutoSync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { Logger.log('ordersAutoSync: another run is active — skip.'); return; }
  var prev = SILENT_RUN; SILENT_RUN = true;
  RUN_DEADLINE = Date.now() + 20 * 60 * 1000;
  try {
    sheetBrands_().forEach(function (b) {
      try { ordersRollingSync_(b.pfx, b.ordTab, b.label); } catch (e) { Logger.log('ordersAutoSync ' + b.label + ': ' + e); }
    });
  } finally { RUN_DEADLINE = 0; SILENT_RUN = prev; try { lock.releaseLock(); } catch (e) {} }
}
function installOrdersAutoSync() {
  removeOrdersAutoSync();
  ScriptApp.newTrigger('ordersAutoSync').timeBased().everyHours(6).create();
  SpreadsheetApp.getUi().alert('Orders auto-sync installed ✅',
    'EVERY 6 HOURS (on Google\'s servers): re-pulls ONLY the last ' + ORDERS_SYNC_DAYS + ' days of orders for ' +
    'this sheet\'s brand and block-replaces them — recent status / refund / cancel changes are picked up, ' +
    'no duplicate rows, and everything older stays frozen. Runs in the background even when your PC is off.\n\n' +
    'Run "Initial Orders import" ONCE first if the Orders tab is empty.', SpreadsheetApp.getUi().ButtonSet.OK);
}
function removeOrdersAutoSync() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'ordersAutoSync') ScriptApp.deleteTrigger(t); });
}

/* ===================== Catalog (product details) ===================== */

var CATALOG_NEW_DAYS = 90;   // listing <= this many days old → "New", else "Old"
var CATALOG_HEADERS = ['SKU', 'ASIN', 'FNSKU', 'ParentASIN', 'Title', 'Brand', 'ImageURL',
                       'Color', 'Size', 'Sub Category', 'UpdatedAt', 'Listing Type', 'Parent Title'];

/** Request a snapshot flat-file report (no date range); return the TSV text. */
function runFlatReport_(reportType) {
  var reportId = sp_('/reports/2021-06-30/reports', 'post', {
    reportType: reportType, marketplaceIds: [marketplaceId_()],
  }).reportId;
  var docId = null, deadline = Date.now() + 7 * 60 * 1000;
  while (Date.now() < deadline) {
    Utilities.sleep(15000);
    var r = sp_('/reports/2021-06-30/reports/' + reportId, 'get');
    if (r.processingStatus === 'DONE') { docId = r.reportDocumentId; break; }
    if (r.processingStatus === 'FATAL' || r.processingStatus === 'CANCELLED')
      throw new Error('Report ' + reportType + ' ended as ' + r.processingStatus);
  }
  if (!docId) throw new Error('Report ' + reportType + ' timed out.');
  var doc = sp_('/reports/2021-06-30/documents/' + docId, 'get');
  var blob = UrlFetchApp.fetch(doc.url, { muteHttpExceptions: true }).getBlob();
  if (doc.compressionAlgorithm === 'GZIP') blob = Utilities.ungzip(blob.setContentType('application/x-gzip'));
  return blob.getDataAsString('UTF-8');
}

/** Parse TSV text into objects keyed by lowercased header. */
function parseTsv_(text) {
  var lines = String(text || '').split(/\r?\n/);
  if (lines.length < 2) return [];
  var headers = lines[0].split('\t').map(function (h) { return h.trim().toLowerCase(); });
  var out = [];
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    var c = lines[i].split('\t'), o = {};
    for (var j = 0; j < headers.length; j++) o[headers[j]] = c[j];
    out.push(o);
  }
  return out;
}

/** First non-empty value among candidate keys of an object. */
function pick_(o, names) {
  for (var i = 0; i < names.length; i++) {
    if (o[names[i]] !== undefined && o[names[i]] !== '') return o[names[i]];
  }
  return '';
}

/** First non-empty value among candidate attribute keys (handles {value} form). */
function pickAttr_(attrs, names) {
  if (!attrs) return '';
  for (var i = 0; i < names.length; i++) {
    var v = attrs[names[i]];
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      for (var j = 0; j < v.length; j++) {
        var item = v[j];
        if (typeof item === 'string' && item) return item;
        if (item && (item.value || item.value === 0)) {
          var s = String(item.value).trim();
          if (s) return s;
        }
      }
    } else if (typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  return '';
}

function parseColorFromTitle_(title) {
  if (!title) return '';
  var t = String(title);
  var phrases = ['Pigeon Blue', 'Goldenrod Yellow', 'Light Steel Blue', 'Steel Blue',
    'Dark Salmon Pink', 'Salmon Pink', 'Asparagus Green', 'Sage Green', 'Fern Green',
    'Basil Green', 'Mint Green', 'Spruce Blue', 'Garnet Red', 'Prune Red', 'Columbia Blue',
    'Coral Pink', 'Army Green', 'Ruddy Pink', 'Flamingo Pink', 'Peanut Brown', 'Mughal Buta', 'Boho'];
  for (var i = 0; i < phrases.length; i++) {
    var re = new RegExp('\\b' + phrases[i].replace(/[\-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i');
    if (re.test(t)) return phrases[i];
  }
  var single = ['Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Pink', 'Orange', 'Purple',
    'Brown', 'Gray', 'Grey', 'Beige', 'Cream', 'Ivory', 'Gold', 'Silver', 'Maroon', 'Navy', 'Teal', 'Mint', 'Sage', 'Taupe'];
  for (var j = 0; j < single.length; j++) {
    if (new RegExp('\\b' + single[j] + '\\b', 'i').test(t)) return single[j];
  }
  return '';
}

function parseSizeFromTitle_(title) {
  if (!title) return '';
  var t = String(title);
  var dim = t.match(/\d{1,3}\s*["”]?\s*[xX×]\s*\d{1,3}\s*["”]?(?:\s*[a-zA-Z]+)?/);
  if (dim) return dim[0].replace(/\s+/g, ' ').trim();
  var pack = t.match(/(Pack|Set)\s+of\s+\d+/i);
  if (pack) return pack[0];
  var round = t.match(/\d{1,3}\s*["”]?\s*(?:Inch|inch|in\.?)?\s*Round/i);
  if (round) return round[0].trim();
  return '';
}

/** Catalog Items API — title/brand/color/size/image/parent/category per ASIN. */
function fetchCatalogData_(asins) {
  var seen = {}, unique = [], map = {};
  asins.forEach(function (a) { if (a && !seen[a]) { seen[a] = 1; unique.push(a); } });

  var CAT_URL = function (ids) {
    return '/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
      '&identifiersType=ASIN&includedData=summaries,images,relationships,productTypes,attributes' +
      '&identifiers=' + ids;
  };

  function applyItem(it) {
    var sum = (it.summaries || [])[0] || {};
    var attrs = it.attributes || {};
    var img = '';
    var ig = it.images || [];
    if (ig.length) {
      var imgs = ig[0].images || [];
      for (var k = 0; k < imgs.length; k++) { if (imgs[k].variant === 'MAIN') { img = imgs[k].link; break; } }
      if (!img && imgs.length) img = imgs[0].link;
    }
    if (!img) img = pickAttr_(attrs, ['main_image_url', 'main_product_image_locator']);
    var parent = '';
    var rg = it.relationships || [];
    for (var g = 0; g < rg.length && !parent; g++) {
      var rels = rg[g].relationships || [];
      for (var r = 0; r < rels.length && !parent; r++) {
        var pa = rels[r].parentAsins || [];
        if (pa.length) parent = pa[0];
      }
    }
    var cat = '';
    if (sum.browseClassification && sum.browseClassification.displayName) cat = sum.browseClassification.displayName;
    else if ((it.productTypes || []).length) cat = it.productTypes[0].productType || '';
    var title = sum.itemName || pickAttr_(attrs, ['item_name', 'title']);
    var brand = sum.brand || pickAttr_(attrs, ['brand', 'brand_name', 'manufacturer', 'vendor']);
    var color = sum.color || pickAttr_(attrs, ['color', 'color_name', 'color_map', 'item_color',
      'color_specification', 'style_name', 'pattern_name', 'pattern']);
    var size = sum.size || pickAttr_(attrs, ['size', 'size_name', 'size_map', 'item_size',
      'size_specification', 'item_dimensions', 'product_dimensions', 'item_length_description']);
    if (!cat) cat = pickAttr_(attrs, ['item_type_name', 'item_type_keyword', 'product_subcategory', 'category']);
    if (!color && title) color = parseColorFromTitle_(title);
    if (!size && title) size = parseSizeFromTitle_(title);
    if (it.asin) map[it.asin] = { title: title || '', brand: brand || '', color: color || '',
      size: size || '', image: img, parent: parent, category: cat };
  }

  for (var i = 0; i < unique.length; i += 8) {
    var batch = unique.slice(i, i + 8);
    var res = null;
    try { res = spGet_(CAT_URL(batch.join(','))); } catch (e) { res = null; }
    var got = {};
    if (res && res.items) res.items.forEach(function (it) { applyItem(it); if (it.asin) got[it.asin] = 1; });
    // KEY FIX: Amazon's multi-ASIN response sometimes SILENTLY omits some ASINs
    // (200 OK, fewer items than asked). Re-fetch any ASIN we didn't get back —
    // individually it returns full data (brand/image/parent).
    batch.forEach(function (a) {
      if (got[a]) return;
      try { var one = spGet_(CAT_URL(a)); (one.items || []).forEach(applyItem); } catch (e) {}
      Utilities.sleep(300);
    });
    Utilities.sleep(400);
  }

  // Pass 2: back-fill child ASINs from each parent (variation families).
  var parents = {};
  Object.keys(map).forEach(function (a) { if (map[a].parent) parents[map[a].parent] = 1; });
  var plist = Object.keys(parents);
  for (var p = 0; p < plist.length; p += 20) {
    var pbatch = plist.slice(p, p + 20);
    var pres = null;
    for (var pa = 0; pa < 4 && !pres; pa++) {
      try {
        pres = sp_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
          '&identifiersType=ASIN&includedData=relationships&identifiers=' + pbatch.join(','), 'get');
      } catch (e) { pres = null; Utilities.sleep(2000 * (pa + 1)); }
    }
    if (pres) (pres.items || []).forEach(function (it) {
      (it.relationships || []).forEach(function (g) {
        (g.relationships || []).forEach(function (rel) {
          (rel.childAsins || []).forEach(function (ca) {
            if (!map[ca]) map[ca] = { title: '', brand: '', color: '', size: '', image: '', parent: '', category: '' };
            if (!map[ca].parent) map[ca].parent = it.asin;
          });
        });
      });
    });
    Utilities.sleep(700);
  }

  // Pass 3: any listing ASIN that came back empty (omitted from a 200 batch
  // response, or returned with no image/brand/parent) — re-fetch on its own.
  var listingAsins = {};
  asins.forEach(function (a) { if (a) listingAsins[a] = 1; });
  var gaps = Object.keys(listingAsins).filter(function (a) {
    var m = map[a];
    return !m || !m.image || !m.parent;   // missing image OR parent → re-check
  });
  for (var y = 0; y < gaps.length; y++) {
    if (y % 25 === 0) SpreadsheetApp.getActiveSpreadsheet()
      .toast('Catalog: filling gaps ' + (y + 1) + '/' + gaps.length + '…', 'Amazon Report', 10);
    try { var gr = spGet_(CAT_URL(gaps[y])); (gr.items || []).forEach(applyItem); } catch (e) {}
    Utilities.sleep(400);
  }

  return map;
}

/** DEBUG: show what the Inventory build reads from the Shipments tab for receiving. */
function debugShipmentReceiving() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shipTab = 'Shipments', sh = ss.getSheetByName(shipTab);
  var rows = [];
  function add(s) { rows.push([s]); }
  if (!sh) { add('Shipments tab NOT FOUND'); }
  else {
    add('Shipments lastRow=' + sh.getLastRow() + ' lastCol=' + sh.getLastColumn() + ' (SHIP_HEADERS=' + SHIP_HEADERS.length + ')');
    var n = Math.min(4, sh.getLastRow() - 1);
    if (n > 0) {
      sh.getRange(2, 1, n, sh.getLastColumn()).getValues().forEach(function (r, i) {
        add('row' + (i + 2) + ': SKU(E)="' + r[4] + '"  SellingMonth(C)="' + r[2] + '" -> key="' + sellingMonthKey_(r[2]) + '"  Qty(F)=' + r[5]);
      });
    }
    var recv = readShipmentReceiving_(ss, shipTab, getSettings_().cutoffDay);
    var skus = Object.keys(recv);
    add('recv SKU count = ' + skus.length);
    if (skus.length) add('sample recv["' + skus[0] + '"] = ' + JSON.stringify(recv[skus[0]]));
    add('month columns = ' + JSON.stringify(recvMonthColumns_(recv).keys));
  }
  var dbg = ss.getSheetByName('_Debug') || ss.insertSheet('_Debug');
  dbg.clear(); dbg.getRange(1, 1, rows.length, 1).setValues(rows); dbg.setColumnWidth(1, 820);
  ss.setActiveSheet(dbg);
  SpreadsheetApp.getUi().alert('Shipment-receiving debug written to "_Debug" — screenshot it.');
}

/** DEBUG: dump the raw Catalog Items API response for one ASIN into _Debug. */
function debugCatalogAsin() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Catalog API debug', 'Enter an ASIN to inspect (e.g. B0GP6ST23X):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var asin = String(resp.getResponseText() || '').trim();
  if (!asin) { ui.alert('No ASIN provided.'); return; }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rows = [];
  function add(s) { rows.push([s]); }
  try {
    var res = sp_('/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() +
      '&identifiersType=ASIN&includedData=summaries,images,relationships,productTypes,attributes&identifiers=' + asin, 'get');
    var items = res.items || [];
    add('ASIN: ' + asin + '  | items returned: ' + items.length);
    if (items.length) {
      var it = items[0];
      var sum = (it.summaries || [])[0] || {};
      add('summaries[0] keys: ' + Object.keys(sum).join(', '));
      add('  itemName=' + (sum.itemName || '(empty)') + ' | brand=' + (sum.brand || '(empty)') +
        ' | color=' + (sum.color || '(empty)') + ' | size=' + (sum.size || '(empty)'));
      add('images present: ' + ((it.images || []).length ? 'YES' : 'NO'));
      add('relationships present: ' + ((it.relationships || []).length ? 'YES' : 'NO'));
      add('attributes keys: ' + Object.keys(it.attributes || {}).join(', '));
    }
    add('FULL JSON:');
    add(JSON.stringify(res, null, 2));
  } catch (e) { add('ERROR: ' + (e.message || e)); }
  var dbg = ss.getSheetByName('_Debug') || ss.insertSheet('_Debug');
  dbg.clear();
  dbg.getRange(1, 1, rows.length, 1).setValues(rows);
  dbg.setColumnWidth(1, 760);
  ss.setActiveSheet(dbg);
  ui.alert('Raw Catalog response for ' + asin + ' written to "_Debug" — screenshot it.');
}

// Menu entry points — one per brand.
function buildRidhiCatalog() { buildCatalogForAccount_('SP', 'Catalog', 'Ridhi'); }
function buildCpcCatalog() { buildCatalogForAccount_('CPC', 'CPC Catalog', 'CPC'); }

/**
 * Build the Catalog tab — one row per listing. Listing Type = "New" if the
 * listing went live within CATALOG_NEW_DAYS (90) days, else "Old". Manual edits
 * to Title/Brand/Image/Color/Size/Sub-Category/ParentASIN are preserved.
 */
function buildCatalogForAccount_(pfx, tabName, label) {
  ACTIVE_PREFIX = pfx;
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ss.toast('Building ' + label + ' Catalog — pulling Merchant Listings…', 'Amazon Report', 30);
  var listings = parseTsv_(runFlatReport_('GET_MERCHANT_LISTINGS_ALL_DATA'));

  ss.toast('Pulling FBA inventory for FNSKU…', 'Amazon Report', 30);
  var fnskuMap = {};
  try {
    parseTsv_(runFlatReport_('GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA')).forEach(function (r) {
      var s = pick_(r, ['sku', 'seller-sku']);
      if (s) fnskuMap[s] = pick_(r, ['fnsku']);
    });
  } catch (e) {
    var oldCat = ss.getSheetByName(tabName);
    if (oldCat && oldCat.getLastRow() > 1) {
      oldCat.getRange(2, 1, oldCat.getLastRow() - 1, 3).getValues().forEach(function (r) {
        if (r[0] && r[2]) fnskuMap[r[0]] = r[2];
      });
    }
    ss.toast('FBA inventory report unavailable — existing FNSKUs kept.', 'Amazon Report', 8);
  }

  ss.toast('Fetching catalog details (title, brand, color, size, image)…', 'Amazon Report', 30);
  var asins = listings.map(function (r) { return pick_(r, ['asin1', 'asin']); });
  var cat = fetchCatalogData_(asins);

  // Preserve manual-entered values from the existing Catalog tab (incl. Parent Title col 13).
  var kept = {};
  var prevCat = ss.getSheetByName(tabName);
  if (prevCat && prevCat.getLastRow() > 1) {
    var pnc = Math.min(13, prevCat.getLastColumn());
    prevCat.getRange(2, 1, prevCat.getLastRow() - 1, pnc).getValues().forEach(function (r) {
      var sku = String(r[0] || '').trim();
      if (!sku) return;
      kept[sku] = { parent: String(r[3] || '').trim(), title: String(r[4] || '').trim(),
        brand: String(r[5] || '').trim(), image: String(r[6] || '').trim(),
        color: String(r[7] || '').trim(), size: String(r[8] || '').trim(), subcat: String(r[9] || '').trim(),
        parentTitle: (r.length > 12 ? String(r[12] || '').trim() : '') };
    });
  }
  function preserve(apiVal, manualVal) {
    var m = String(manualVal == null ? '' : manualVal).trim();
    return m ? m : String(apiVal == null ? '' : apiVal).trim();
  }

  // Auto-fetch the PARENT ASINs' own titles (for any new parent with no manual Parent
  // Title yet). Collect every parent ASIN (from API + kept), fetch those not already
  // in `cat`, merge — so cat[parentAsin].title gives a sensible default parent title.
  var parentSet = {};
  listings.forEach(function (r) {
    var a = pick_(r, ['asin1', 'asin']);
    var pa = String((cat[a] || {}).parent || (kept[pick_(r, ['seller-sku', 'sku'])] || {}).parent || '').trim();
    if (pa && !cat[pa]) parentSet[pa] = 1;
  });
  var parentList = Object.keys(parentSet);
  if (parentList.length) {
    try {
      var pcat = fetchCatalogData_(parentList);
      Object.keys(pcat).forEach(function (k) { if (!cat[k]) cat[k] = pcat[k]; });
    } catch (e) { Logger.log('parent-title fetch: ' + e); }
  }

  var now = new Date(), DAY = 86400000;
  var rows = listings.map(function (r) {
    var sku = pick_(r, ['seller-sku', 'sku']);
    var asin = pick_(r, ['asin1', 'asin']);
    var info = cat[asin] || {}, k = kept[sku] || {};
    var openRaw = String(pick_(r, ['open-date']) || '');
    var listingType = '';
    var m = openRaw.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      var days = (now.getTime() - Date.UTC(+m[1], (+m[2]) - 1, +m[3])) / DAY;
      listingType = days <= CATALOG_NEW_DAYS ? 'New' : 'Old';
    }
    var parentAsin = preserve(info.parent, k.parent);
    var parentTitle = preserve((cat[parentAsin] || {}).title, k.parentTitle);   // auto default, manual wins
    return [sku, asin, fnskuMap[sku] || '',
      parentAsin,
      preserve(info.title || pick_(r, ['item-name']), k.title),
      preserve(info.brand, k.brand),
      preserve(info.image, k.image),
      preserve(info.color, k.color),
      preserve(info.size, k.size),
      preserve(info.category, k.subcat),
      now, listingType, parentTitle];
  }).filter(function (row) { return row[0]; });

  rows.sort(function (a, b) { return String(a[0]) < String(b[0]) ? -1 : 1; });

  var sh = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  sh.clear();
  sh.getRange(1, 1, 1, CATALOG_HEADERS.length).setValues([CATALOG_HEADERS])
    .setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setColumnWidth(5, 320);
  if (rows.length) {
    for (var r0 = 0; r0 < rows.length; r0 += 5000) {
      var ch = rows.slice(r0, r0 + 5000);
      sh.getRange(r0 + 2, 1, ch.length, CATALOG_HEADERS.length).setValues(ch);
    }
    sh.getRange(2, 11, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  }
  SpreadsheetApp.getUi().alert(label + ' Catalog built ✅\n\n' + rows.length + ' products in "' + tabName + '".');
}

/* ===================== Sale History (monthly Qty + Amount) ===================== */

/** Descending month list "YYYY-MM" from current month back to fromYM (inclusive). */
function monthRangeDesc_(fromYM, toDate) {
  var months = [];
  var y = toDate.getFullYear(), m = toDate.getMonth();
  var fy = parseInt(fromYM.split('-')[0], 10), fm = parseInt(fromYM.split('-')[1], 10) - 1;
  while (y > fy || (y === fy && m >= fm)) {
    months.push(y + '-' + ('0' + (m + 1)).slice(-2));
    m--; if (m < 0) { m = 11; y--; }
  }
  return months;
}

/** Order row -> "YYYY-MM" from the Date (col C) or Purchase date (col B). */
function orderMonthKey_(row) {
  var cands = [row[2], row[1]];
  for (var i = 0; i < cands.length; i++) {
    var v = cands[i];
    if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, 'UTC', 'yyyy-MM');
    var m = String(v || '').match(/(\d{4})-(\d{2})/);
    if (m) return m[1] + '-' + m[2];
  }
  return '';
}

/** From a brand's Orders tab: { sku: { "2025-06": {qty, amt} } }. MCF + Cancelled excluded. */
function computeMonthlySales_(ss, ordTab) {
  var out = {}, sh = ordersSS_().getSheetByName(ordTab);
  if (!sh || sh.getLastRow() < 2) return out;
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, ORDERS_HEADERS.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var sku = String(row[3] || '').trim(); if (!sku) continue;
    if (String(row[9] || '').toUpperCase() === 'MCF') continue;
    if (String(row[7] || '').toLowerCase() === 'cancelled') continue;
    var mk = orderMonthKey_(row); if (!mk) continue;
    var m = (out[sku] = out[sku] || {});
    var b = (m[mk] = m[mk] || { qty: 0, amt: 0 });
    b.qty += Number(row[5]) || 0;
    b.amt += Number(row[6]) || 0;
  }
  return out;
}

/**
 * DEBUG: break a month's Orders revenue down by status / MCF / duplicates / clean, to find
 * exactly where an over- or under-count comes from. Dumps to "_Debug". "CLEAN" = Amazon channel,
 * not cancelled — this is what should match Amazon's "Ordered Product Sales" for the month.
 */
function debugMonthRevenue() {
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt('Month revenue breakdown', 'Brand —  SP  (Ridhi)  /  CPC :', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var pfx = (String(r1.getResponseText() || '').trim().toUpperCase() === 'CPC') ? 'CPC' : 'SP';
  var r2 = ui.prompt('Month revenue breakdown', 'Month as YYYY-MM (e.g. 2026-06):', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var ym = String(r2.getResponseText() || '').trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) { ui.alert('Use the format YYYY-MM, e.g. 2026-06.'); return; }
  var tab = (pfx === 'CPC') ? 'CPC Orders' : 'Orders';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ordersSS_().getSheetByName(tab);
  if (!sh || sh.getLastRow() < 2) { ui.alert('"' + tab + '" is empty.'); return; }
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, ORDERS_HEADERS.length).getValues();
  function money(n) { return '$' + (Math.round(n * 100) / 100).toLocaleString(); }
  var rows = []; function add(s) { rows.push([s]); }
  var byStatus = {}, mcfRev = 0, mcfRows = 0, amzRev = 0, amzRows = 0, totRev = 0, totRows = 0;
  var seen = {}, dupRows = 0, dupRev = 0, cleanRev = 0, cleanRows = 0, orders = {};
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (orderMonthKey_(r) !== ym) continue;
    var rev = Number(r[6]) || 0;
    var status = String(r[7] || '').trim() || '(blank)';
    var mcf = String(r[9] || '').toUpperCase() === 'MCF';
    var oid = String(r[0] || ''), sku = String(r[3] || '');
    totRev += rev; totRows++;
    var st = byStatus[status] || (byStatus[status] = { rows: 0, rev: 0 }); st.rows++; st.rev += rev;
    if (mcf) { mcfRev += rev; mcfRows++; } else { amzRev += rev; amzRows++; }
    if (oid) { var key = oid + '|' + sku; if (seen[key]) { dupRows++; dupRev += rev; } else seen[key] = 1; }
    orders[oid] = 1;
    if (!mcf && status.toLowerCase() !== 'cancelled') { cleanRev += rev; cleanRows++; }
  }
  add('▸ ' + tab + '   —   month ' + ym);
  add('TOTAL rows: ' + totRows + '     TOTAL revenue (ALL rows): ' + money(totRev));
  add('distinct Order IDs: ' + Object.keys(orders).length);
  add('');
  add('— revenue by Order Status —');
  Object.keys(byStatus).sort().forEach(function (s) { add('    ' + s + '  :  ' + byStatus[s].rows + ' rows  ·  ' + money(byStatus[s].rev)); });
  add('');
  add('MCF (non-Amazon channel) : ' + mcfRows + ' rows  ·  ' + money(mcfRev));
  add('Amazon channel           : ' + amzRows + ' rows  ·  ' + money(amzRev));
  add('DUPLICATE (Order ID+SKU) rows : ' + dupRows + '  ·  extra ' + money(dupRev));
  add('');
  add('★ CLEAN sale (Amazon channel, NOT cancelled) : ' + cleanRows + ' rows  ·  ' + money(cleanRev));
  add('   ↳ this is what should match Amazon\'s "Ordered Product Sales" for ' + ym + '.');
  var dbg = ss.getSheetByName('_Debug') || ss.insertSheet('_Debug');
  dbg.clear(); dbg.getRange(1, 1, rows.length, 1).setValues(rows); dbg.setColumnWidth(1, 600);
  ss.setActiveSheet(dbg);
  ui.alert('Breakdown written to "_Debug" — screenshot it and send me.');
}

/* ===================== Sales Analysis (merged: SKU / Article / Color) =====================
 * One tab per brand replaces the old Sale History + Article Study + Color Study.
 * A "View" dropdown (cell B1) re-pivots the same monthly-sales engine between:
 *   • SKU      — one row per SKU; yellow block = monthly Qty (units).
 *   • Article  — grouped by Sub-Category; yellow block = monthly % share of total.
 *   • Color    — grouped by Color; yellow block = monthly % share of total.
 * Blue block is always monthly Amount ($). Row 1 = control, row 2 = headers,
 * row 3 = TOTAL (SUBTOTAL), row 4+ = data. A trend heatmap fills each row's peak
 * months (deeper = stronger vs its own average). Source: Orders (MCF + Cancelled
 * excluded) + Catalog. */

var SALES_VIEWS = ['Color', 'Article', 'SKU'];          // dropdown options
var SALES_ANALYSIS_TABS = { 'Sales Analysis': 'SP', 'CPC Sales Analysis': 'CPC' };

// Menu entry points — one merged tab per brand.
function buildRidhiSalesAnalysis() { buildSalesAnalysis_('SP', 'Sales Analysis', 'Ridhi'); }
function buildCpcSalesAnalysis() { buildSalesAnalysis_('CPC', 'CPC Sales Analysis', 'CPC'); }

/** Map any dropdown text to a canonical view, or '' if unrecognised. */
function normalizeView_(v) {
  var s = String(v || '').trim().toLowerCase();
  if (s.indexOf('sku') === 0) return 'SKU';
  if (s.indexOf('article') === 0 || s.indexOf('sub') === 0) return 'Article';
  if (s.indexOf('color') === 0 || s.indexOf('colour') === 0) return 'Color';
  return '';
}

/** Current view from the tab's dropdown cell (B1). */
function readAnalysisView_(sh) {
  try { return normalizeView_(sh.getRange(1, 2).getValue()); } catch (e) { return ''; }
}

/**
 * Simple trigger: when the "View" dropdown (B1) of a Sales Analysis tab changes,
 * re-pivot that tab for the chosen view. Only reads existing sheets — no SP-API —
 * so it runs fine within the simple-trigger sandbox. setValue() from the rebuild
 * does NOT re-fire onEdit (only user edits do).
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet(), name = sh.getName();
    var pfx = SALES_ANALYSIS_TABS[name];
    if (!pfx) return;                                       // not a Sales Analysis tab
    if (e.range.getRow() !== 1 || e.range.getColumn() !== 2) return;   // only the View dropdown
    var view = normalizeView_(e.value);
    if (!view) return;
    buildSalesAnalysis_(pfx, name, pfx === 'CPC' ? 'CPC' : 'Ridhi', view);
  } catch (err) {
    try { SpreadsheetApp.getActiveSpreadsheet().toast('View switch failed: ' + err.message, 'Amazon Report', 8); } catch (e2) {}
  }
}

/** SKU view rows: identity (5 cols) + monthly Qty (units) + monthly Amount. */
function buildSkuView_(sales, catalog, months) {
  var skuSet = {};
  Object.keys(sales).forEach(function (s) { skuSet[s] = 1; });
  Object.keys(catalog).forEach(function (s) { skuSet[s] = 1; });
  function totalQty(sku) { var t = 0, m = sales[sku] || {}; Object.keys(m).forEach(function (k) { t += m[k].qty; }); return t; }
  var skuList = Object.keys(skuSet).sort(function (a, b) { return totalQty(b) - totalQty(a); });
  var rows = skuList.map(function (sku) {
    var c = catalog[sku] || {}, m = sales[sku] || {};
    var qtyVals = months.map(function (k) { return m[k] ? m[k].qty : 0; });
    var amtVals = months.map(function (k) { return m[k] ? Math.round(m[k].amt) : 0; });
    return [sku, c.asin || '', c.subcat || '', c.color || '', c.size || ''].concat(qtyVals).concat(amtVals);
  });
  return {
    idCols: 5,
    head: ['SKU', 'ASIN', 'Sub-Category', 'Color Name', 'Size'].concat(months).concat(months),
    rows: rows, yellowIsPct: false
  };
}

/** Grouped view rows (Article = subcat, Color = color): dim + SKUs + monthly % share + Amount. */
function buildGroupView_(sales, catalog, months, dim, dimLabel) {
  var agg = {};
  Object.keys(sales).forEach(function (sku) {
    var c = catalog[sku] || {};
    var key = String(c[dim] || '').trim() || '(unknown)';
    var a = (agg[key] = agg[key] || { qty: {}, amt: {}, skus: {} });
    a.skus[sku] = 1;
    var m = sales[sku];
    Object.keys(m).forEach(function (mk) {
      a.qty[mk] = (a.qty[mk] || 0) + m[mk].qty;
      a.amt[mk] = (a.amt[mk] || 0) + m[mk].amt;
    });
  });
  var monthTotalQty = {};
  Object.keys(agg).forEach(function (k) {
    Object.keys(agg[k].qty).forEach(function (mk) { monthTotalQty[mk] = (monthTotalQty[mk] || 0) + agg[k].qty[mk]; });
  });
  var last12 = months.slice(0, 12);
  function sum12(k) { var t = 0, q = agg[k].qty; last12.forEach(function (mk) { t += q[mk] || 0; }); return t; }
  var keys = Object.keys(agg).sort(function (a, b) { return sum12(b) - sum12(a); });
  var rows = keys.map(function (k) {
    var a = agg[k];
    var pctVals = months.map(function (mk) { var t = monthTotalQty[mk] || 0; return t ? (a.qty[mk] || 0) / t : 0; });
    var amtVals = months.map(function (mk) { return Math.round(a.amt[mk] || 0); });
    return [k, Object.keys(a.skus).length].concat(pctVals).concat(amtVals);
  });
  return {
    idCols: 2,
    head: [dimLabel, 'SKUs'].concat(months).concat(months),
    rows: rows, yellowIsPct: true
  };
}

/** Write the row-1 control strip with the View dropdown (cell B1). */
function writeAnalysisControl_(sh, width, view, label) {
  sh.getRange(1, 1).setValue('View ▶').setFontWeight('bold');
  var cell = sh.getRange(1, 2);
  cell.setValue(view)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(SALES_VIEWS, true).build())
    .setBackground(INPUT_BG).setFontWeight('bold')
    .setNote('Change this dropdown to switch the whole tab between SKU / Article / Color views.');
  sh.getRange(1, 3).setValue('← ' + label + ' · pick SKU / Article (Sub-Category) / Color · Yellow = Qty or % share, Blue = Amount ($). Red/orange/yellow cells = seasonal trend peaks.')
    .setFontColor('#64748b');
  sh.getRange(1, 1, 1, Math.max(width, 3)).setBackground('#f1f5f9');
  sh.getRange(1, 2).setBackground(INPUT_BG);   // keep the dropdown cell distinct
}

/**
 * Build/refresh the merged Sales Analysis tab for one brand and view.
 * viewOverride set ⇒ called from onEdit (dropdown switch): no UI alert, just toast.
 */
function buildSalesAnalysis_(pfx, tabName, label, viewOverride) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var catTab = (pfx === 'CPC') ? 'CPC Catalog' : 'Catalog';
  var ordTab = (pfx === 'CPC') ? 'CPC Orders' : 'Orders';
  var fromDropdown = !!viewOverride;

  var sh = getOrCreate_(ss, tabName);
  var view = viewOverride || readAnalysisView_(sh) || 'Color';   // explicit → existing dropdown → default

  ss.toast('Building ' + label + ' Sales Analysis (' + view + ' view)…', 'Amazon Report', 15);
  var catalog = readCatalogMap_(ss, catTab);
  var sales = computeMonthlySales_(ss, ordTab);
  if (!Object.keys(sales).length) {
    var msg = 'No order data in "' + ordTab + '". Pull Orders first.';
    if (fromDropdown) ss.toast(msg, 'Amazon Report', 8); else SpreadsheetApp.getUi().alert(msg);
    return;
  }
  var months = monthRangeDesc_(ORDERS_START_DATE.slice(0, 7), new Date());

  var built = (view === 'SKU')
    ? buildSkuView_(sales, catalog, months)
    : buildGroupView_(sales, catalog, months, (view === 'Article') ? 'subcat' : 'color',
                      (view === 'Article') ? 'Sub-Category' : 'Color');
  var idCols = built.idCols, head = built.head, rows = built.rows, width = head.length;

  var existing = sh.getFilter(); if (existing) existing.remove();
  sh.clear();

  // Row 1: control. Row 2: headers. Row 3: TOTAL. Row 4+: data.
  writeAnalysisControl_(sh, width, view, label);
  sh.getRange(2, 1, 1, width).setValues([head]).setFontWeight('bold');
  sh.getRange(2, 1, 1, idCols).setBackground(HEADER_BG).setFontColor(HEADER_FG);
  sh.getRange(2, idCols + 1, 1, months.length).setBackground('#fff2cc');                  // Qty / % = yellow
  sh.getRange(2, idCols + 1 + months.length, 1, months.length).setBackground('#cfe2f3');  // Amount = blue

  var totalsRow = head.map(function (h, idx) {
    if (idx === 0) return 'TOTAL';
    if (idx < idCols) return '';
    var col = colA1_(idx + 1);
    return '=SUBTOTAL(109,' + col + '4:' + col + ')';
  });
  sh.getRange(3, 1, 1, width).setValues([totalsRow]).setFontWeight('bold')
    .setBackground('#1e293b').setFontColor('#ffffff');
  sh.setFrozenRows(3);
  sh.setFrozenColumns(1);

  if (rows.length) {
    sh.getRange(4, 1, rows.length, width).setValues(rows);
    var yFmt = built.yellowIsPct ? '0.0%' : '#,##0';
    sh.getRange(3, idCols + 1, rows.length + 1, months.length).setNumberFormat(yFmt);                  // Qty / % share
    sh.getRange(3, idCols + 1 + months.length, rows.length + 1, months.length).setNumberFormat('$#,##0'); // Amount
    sh.getRange(3, 1, rows.length + 1, width).createFilter();   // filter header = totals row 3
    applyTrendHeatmap_(sh, 4, idCols + 1, months.length, rows.length, built.yellowIsPct ? 0.03 : 5);
  }
  sh.setColumnWidth(1, view === 'SKU' ? 150 : 200);
  if (view === 'SKU') sh.setColumnWidth(3, 200);

  if (fromDropdown) {
    ss.toast(label + ' Sales Analysis → ' + view + ' view ✅', 'Amazon Report', 4);
  } else {
    SpreadsheetApp.getUi().alert(label + ' Sales Analysis built ✅  (' + view + ' view)\n\n' +
      rows.length + ' rows × ' + months.length + ' months.\n' +
      'Yellow = ' + (built.yellowIsPct ? 'Qty % share' : 'Qty (units)') + ', Blue = Amount ($).\n' +
      '🎨 Red/orange/yellow cells = each row\'s seasonal trend peaks.\n\n' +
      'Switch the "View" dropdown (cell B1) to flip between SKU / Article / Color — the tab rebuilds itself.');
  }
}

/**
 * Heat-highlight a tab's monthly yellow block so seasonal trends pop. For each
 * data row we compute its OWN average monthly value, then fill months that run
 * above that average — deeper colour = stronger peak. Surfaces "this row trends
 * in this month" rather than just "this row is big" (a flat row stays unfilled).
 * Works for both % share and raw-unit blocks (minPeak adapts: 0.03 for shares,
 * a small unit count for raw Qty). Non-destructive: only sets backgrounds on the
 * yellow block; clears old fills each run. Returns the count of cells filled.
 *
 *   light yellow #ffe599 → mild peak (≥1.3× the row average)
 *   orange       #f6b26b → strong peak (≥1.8×)
 *   red          #e06666 → dominant (≥2.5×, or the row's single best month)
 */
function applyTrendHeatmap_(sh, firstRow, firstQtyCol, months, n, minPeak) {
  if (n < 1 || months < 1) return 0;
  var rng = sh.getRange(firstRow, firstQtyCol, n, months);
  var vals = rng.getValues();
  var DEEP = '#e06666', MID = '#f6b26b', LITE = '#ffe599';
  var bg = [], flagged = 0;
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i], sum = 0, mx = 0;
    for (var j = 0; j < row.length; j++) { var x = Number(row[j]) || 0; sum += x; if (x > mx) mx = x; }
    var mean = sum / months;                          // row's own typical month (incl. zero months)
    var rowActive = mx >= minPeak && mean > 0;
    var bgRow = [];
    for (var k = 0; k < row.length; k++) {
      var v = Number(row[k]) || 0, color = null;
      if (rowActive && v >= minPeak) {
        var ratio = v / mean;
        if (ratio >= 2.5 || (v === mx && ratio >= 1.6)) color = DEEP;
        else if (ratio >= 1.8) color = MID;
        else if (ratio >= 1.3) color = LITE;
      }
      if (color) flagged++;
      bgRow.push(color);                              // null = clear any previous fill
    }
    bg.push(bgRow);
  }
  rng.setBackgrounds(bg);
  return flagged;
}

/* ===================== Air / Sea / AWD Shipment Decider ===================== */

var DOS_AIR = 90;     // < 3 months  -> replenish (Air/AWD)
var DOS_SEA = 165;    // 3 - 5.5 months -> Sea
var DOS_HEALTHY = 195;// 5.5 - 6.5 months -> healthy; above -> overstock

/** Read the Inventory tab by header name into per-SKU components. */
function readInventoryForDecider_(ss, invTab) {
  var sh = ss.getSheetByName(invTab);
  if (!sh || sh.getLastRow() < 3) return null;
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = {}; head.forEach(function (h, i) { idx[String(h).trim()] = i; });
  var recCols = [];
  head.forEach(function (h, i) { if (/Rec\.\s*$/.test(String(h))) recCols.push(i); });
  var data = sh.getRange(3, 1, sh.getLastRow() - 2, lastCol).getValues();   // skip header + totals row
  var map = {};
  data.forEach(function (r) {
    var sku = String(r[idx['SKU']] || '').trim(); if (!sku) return;
    function num(name) { var i = idx[name]; return i == null ? 0 : (Number(r[i]) || 0); }
    var recVals = recCols.map(function (i) { return Number(r[i]) || 0; });
    map[sku] = {
      asin: r[idx['ASIN']] || '',
      fba: num('fulfillable'), warehouse: num('warehouse'),
      inWork: num('inbound_working'), inShip: num('inbound_shipped'), inRecv: num('inbound_receiving'),
      awdAvail: num('AWD Available'), awdTransit: num('AWD Transit'),
      l90: num('Last 90 Days'),
      upcomingMonth: recVals.length ? recVals[0] : 0,
      upcomingAll: recVals.reduce(function (a, b) { return a + b; }, 0)
    };
  });
  return map;
}

function buildRidhiDecider() { buildDeciderForAccount_('SP', 'Shipment Decider', 'Ridhi'); }
function buildCpcDecider() { buildDeciderForAccount_('CPC', 'CPC Shipment Decider', 'CPC'); }

/**
 * Air / Sea / AWD decider per SKU. True ADS = last-90 / 90, but if the SKU looks
 * OOS-suppressed it is reconstructed from in-stock months in the last 12 months.
 */
function buildDeciderForAccount_(pfx, tabName, label) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var invTab = (pfx === 'CPC') ? 'CPC Inventory' : 'Inventory';
  var catTab = (pfx === 'CPC') ? 'CPC Catalog' : 'Catalog';
  var ordTab = (pfx === 'CPC') ? 'CPC Orders' : 'Orders';
  ss.toast('Building ' + label + ' Shipment Decider…', 'Amazon Report', 15);

  var inv = readInventoryForDecider_(ss, invTab);
  if (!inv) { SpreadsheetApp.getUi().alert('Build "' + invTab + '" first (menu 7/8).'); return; }
  var catalog = readCatalogMap_(ss, catTab);
  var monthly = computeMonthlySales_(ss, ordTab);
  var last12 = monthRangeDesc_(ORDERS_START_DATE.slice(0, 7), new Date()).slice(0, 12);

  var HEAD = ['ASIN', 'SKU', 'Product Name', 'Last 90-Day Sales', 'OOS Detected', 'Calc Method',
    'True ADS', 'Warehouse', 'Inbound Receiving', 'Upcoming Month', 'FBA Inventory', 'AWD Inventory',
    'Working Inventory', 'DOS (days)', 'Required Action'];

  var out = [];
  Object.keys(inv).forEach(function (sku) {
    var v = inv[sku], c = catalog[sku] || {}, m = monthly[sku] || {};
    var l90ads = v.l90 / 90;
    var activeMonths = 0, activeUnits = 0;
    last12.forEach(function (mk) { var q = m[mk] ? m[mk].qty : 0; if (q > 0) { activeMonths++; activeUnits += q; } });
    var reconAds = activeMonths > 0 ? activeUnits / (activeMonths * 30.4) : 0;
    var oos = (l90ads > 0 || reconAds > 0) && (reconAds > l90ads * 1.25 || (v.fba === 0 && reconAds > 0));
    var trueAds = oos ? Math.max(l90ads, reconAds) : l90ads;
    var method = oos ? '365-Day Reconstructed' : 'Last 90-Day Average';

    var nearTerm = v.fba + v.inRecv + v.upcomingMonth;
    var workingInv = nearTerm + v.awdAvail;
    var totalInv = v.fba + v.inWork + v.inShip + v.inRecv + v.upcomingAll;
    var dosWorking = trueAds > 0 ? workingInv / trueAds : 99999;
    var dosTotal = trueAds > 0 ? (totalInv + v.awdAvail + v.awdTransit) / trueAds : 99999;

    var action;
    if (trueAds <= 0) action = 'Monitor Inventory';
    else if (dosWorking < DOS_AIR) {
      var req90 = trueAds * DOS_AIR;
      action = (nearTerm + v.awdAvail < req90) ? 'Create Air Shipment' : 'Transfer Inventory from AWD';
    } else if (dosTotal < DOS_SEA) action = 'Create Sea Shipment';
    else if (dosTotal <= DOS_HEALTHY) action = 'Healthy';
    else action = 'Overstock – No Shipment Required';

    out.push([v.asin || c.asin || '', sku, c.title || '', Math.round(v.l90), oos ? 'Yes' : 'No', method,
      round1_(trueAds), v.warehouse, v.inRecv, v.upcomingMonth, v.fba, v.awdAvail,
      Math.round(workingInv), (dosTotal >= 99999 ? '' : Math.round(dosTotal)), action]);
  });

  // Sort by urgency, then DOS ascending (most urgent first).
  var ORD = { 'Create Air Shipment': 0, 'Transfer Inventory from AWD': 1, 'Create Sea Shipment': 2, 'Monitor Inventory': 3, 'Healthy': 4, 'Overstock – No Shipment Required': 5 };
  out.sort(function (a, b) {
    if (ORD[a[14]] !== ORD[b[14]]) return ORD[a[14]] - ORD[b[14]];
    return (Number(a[13]) || 0) - (Number(b[13]) || 0);
  });

  var sh = getOrCreate_(ss, tabName);
  var existing = sh.getFilter(); if (existing) existing.remove();
  sh.clear();
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold');
  sh.setFrozenRows(1); sh.setFrozenColumns(2);
  if (out.length) {
    sh.getRange(2, 1, out.length, HEAD.length).setValues(out);
    sh.getRange(2, 7, out.length, 1).setNumberFormat('0.0');     // True ADS
    sh.getRange(2, 1, out.length + 1, HEAD.length).createFilter();
    deciderColors_(sh, out.length, HEAD.length);
  }
  sh.setColumnWidth(2, 150); sh.setColumnWidth(3, 240); sh.setColumnWidth(15, 230);
  SpreadsheetApp.getUi().alert(label + ' Shipment Decider built ✅\n\n' + out.length + ' SKUs evaluated.\n' +
    'Sorted by urgency (Air → Transfer → Sea → Healthy → Overstock).');
}

/** Colour the Required Action column by recommendation. */
function deciderColors_(sh, n, cols) {
  var rng = sh.getRange(2, cols, n, 1);  // Required Action column
  var rule = function (txt, bg, fg) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(txt).setBackground(bg).setFontColor(fg || '#000000').setRanges([rng]).build();
  };
  sh.setConditionalFormatRules([
    rule('Create Air Shipment', '#fde0e0', '#b91c1c'),
    rule('Transfer Inventory from AWD', '#fff3cd', '#92600a'),
    rule('Create Sea Shipment', '#d6e4ff', '#1e40af'),
    rule('Healthy', '#d9f2e0', '#166534'),
    rule('Overstock – No Shipment Required', '#e5e7eb', '#374151'),
    rule('Monitor Inventory', '#f1f5f9', '#475569')
  ]);
}

/* (Article / Color Study + Sale History are now merged into the "Sales Analysis"
 * tab — see buildSalesAnalysis_ above. The old per-dimension builders were removed.) */

/* ===================== Import all ===================== */

function importAllFromAmazon() {
  importRidhiInventory();
  importShipmentsFromAmazon();
  recompute();
  SpreadsheetApp.getActiveSpreadsheet().toast('All imports done + Planning View rebuilt.', 'FBA Planner', 8);
}

/* ===================== Sample data ===================== */

function loadSampleData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var today = new Date();
  ss.getSheetByName(TAB.INVENTORY).getRange(2, 1, 3, 3).setValues([
    ['FR-TSHIRT-BLK-M', 'Fabric Rush Tee — Black M', 420],
    ['FR-TSHIRT-WHT-L', 'Fabric Rush Tee — White L', 60],
    ['FR-HOODIE-NVY-XL', 'Fabric Rush Hoodie — Navy XL', 15],
  ]);
  // Ship Date · ETA · Selling Month · FBA ID · SKU · Qty · Mode · Status · Transit Days
  ss.getSheetByName(TAB.SHIPMENTS).getRange(2, 1, 3, SHIP_HEADERS.length).setValues([
    [addDays_(today, -5), '', '', 'FBA1998MNVY0', 'FR-TSHIRT-WHT-L', 300, 'Air', 'In Transit', ''],
    [addDays_(today, -10), '', '', 'FBA1A2B3C4D5', 'FR-HOODIE-NVY-XL', 600, 'Sea', 'Shipped', ''],
    [addDays_(today, -2), '', '', 'FBA1X9Y8Z7W6', 'FR-TSHIRT-BLK-M', 800, 'Sea', 'Working', ''],
  ]);
  var salesSh = ss.getSheetByName(TAB.SALES);
  var rows = [], rates = { 'FR-TSHIRT-BLK-M': 14, 'FR-TSHIRT-WHT-L': 22, 'FR-HOODIE-NVY-XL': 9 };
  Object.keys(rates).forEach(function (sku) {
    for (var d = 90; d >= 1; d--) rows.push([sku, addDays_(today, -d), Math.max(0, rates[sku] + ((d * 7) % 5) - 2)]);
  });
  salesSh.getRange(2, 1, rows.length, 3).setValues(rows);
  recomputeEtas();
  recompute();
  ss.toast('Sample data loaded + Planning View built.', 'FBA Planner', 5);
}

/* ===================== Firebase / Firestore (shared with Amazon Hub) =====================
 * Connects THIS sheet to the SAME Firebase project as Amazon Hub (e.g. fabricrush-amz)
 * via a service account — the exact auth pattern Amazon Hub already uses. Amazon Hub's
 * data is NEVER touched: everything this sheet writes lives under "fba_*" collections only.
 *
 * Reuses the SAME 3 Script Properties as Amazon Hub — just copy them across into THIS
 * project (Apps Script editor → Project Settings → Script Properties):
 *   FIREBASE_PROJECT_ID    e.g. fabricrush-amz
 *   FIREBASE_CLIENT_EMAIL  the service account email
 *   FIREBASE_PRIVATE_KEY   the full private_key string from the SA JSON
 *
 * Writing with a service account bypasses Firestore security rules, so Amazon Hub's
 * firestore.rules does not need any change.
 */

/** Build a signed JWT, exchange it for a Firestore access token (cached ~58 min). */
function getFirestoreToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('firestore_token');
  if (cached) return cached;

  var clientEmail = prop_('FIREBASE_CLIENT_EMAIL');
  var privateKey  = prop_('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey) {
    throw new Error('Firebase credentials missing — set FIREBASE_CLIENT_EMAIL and ' +
      'FIREBASE_PRIVATE_KEY in Script Properties (copy them from the Amazon Hub Apps Script).');
  }

  var now = Math.floor(Date.now() / 1000);
  var header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/=+$/, '');
  var claim  = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).replace(/=+$/, '');

  var signatureBytes = Utilities.computeRsaSha256Signature(header + '.' + claim, privateKey);
  var signature = Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/, '');
  var jwt = header + '.' + claim + '.' + signature;

  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt },
    muteHttpExceptions: true
  });
  var body = JSON.parse(resp.getContentText());
  if (!body.access_token) throw new Error('Firebase token request failed: ' + resp.getContentText());
  cache.put('firestore_token', body.access_token, 3500);
  return body.access_token;
}

/** Convert a JS value into Firestore's typed-value JSON shape. */
function toFs_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean')        return { booleanValue: v };
  if (typeof v === 'number')         return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')         return { stringValue: v };
  if (Array.isArray(v))              return { arrayValue: { values: v.map(toFs_) } };
  if (typeof v === 'object') {
    var fields = {};
    Object.keys(v).forEach(function (k) { fields[k] = toFs_(v[k]); });
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(v) };
}

/** Write a JS object as a Firestore document (creates or overwrites). path e.g. "fba_inventory/ridhi". */
function fsWriteDoc_(projectId, token, path, obj) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
            '/databases/(default)/documents/' + path;
  var fields = {};
  Object.keys(obj).forEach(function (k) { fields[k] = toFs_(obj[k]); });
  var payload = JSON.stringify({ fields: fields });

  function doWrite(tok) {
    return UrlFetchApp.fetch(url, {
      method: 'patch',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + tok },
      payload: payload,
      muteHttpExceptions: true
    });
  }

  var resp = doWrite(token);
  if (resp.getResponseCode() === 401) {                  // cached token expired → refresh once
    try { CacheService.getScriptCache().remove('firestore_token'); } catch (e) {}
    resp = doWrite(getFirestoreToken_());
  }
  if (resp.getResponseCode() >= 300) {
    throw new Error('Firestore write failed at ' + path + ': ' + resp.getContentText().slice(0, 300));
  }
}

/**
 * Menu: prove THIS sheet can reach Amazon Hub's Firebase. Writes one harmless test
 * doc to "fba_sheet/_connection_test" (a brand-new collection) — Amazon Hub's docs
 * are never read or written. If this succeeds, the connection is ready for real syncs.
 */
function checkFirebaseConnection() {
  var ui = SpreadsheetApp.getUi();
  var miss = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
    .filter(function (k) { return !prop_(k); });
  if (miss.length) {
    ui.alert('Firebase not configured yet',
      'Add these Script Properties to THIS project (copy the same values from the\n' +
      'Amazon Hub Apps Script — Project Settings → Script Properties):\n\n' + miss.join('\n') +
      '\n\nThey point at the same service account, so no new Firebase setup is needed.', ui.ButtonSet.OK);
    return;
  }
  var projectId = prop_('FIREBASE_PROJECT_ID');
  try {
    var token = getFirestoreToken_();
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    fsWriteDoc_(projectId, token, 'fba_sheet/_connection_test',
      { ok: true, source: 'FBA-Sheet', updatedAt: stamp });
    ui.alert('Firebase connected ✅',
      'Project: ' + projectId + '\n' +
      'Wrote test doc:  fba_sheet/_connection_test\n\n' +
      'Amazon Hub data is untouched — this sheet only uses "fba_*" collections.\n' +
      'Connection is ready. Tell me which tabs to sync and I will wire it up.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Firebase connection failed', String(e.message || e), ui.ButtonSet.OK);
  }
}

/** One button: sync Inventory + Sales Analysis for BOTH brands → Firebase, one summary. */
/**
 * Parent Week-on-Week UNITS + SALES for the dashboard — sourced from the FBA
 * Orders tab (the reliable sales source) instead of Amazon Hub's Sales-by-Child-ASIN.
 * Builds a 180-day DAILY per-parent series (parent ASIN via Catalog) → `fba_parentwow/<brand>`.
 * The dashboard merges this (units/sales) with Amazon Hub's `dashboards/parentwow` (ad
 * spend/ad sales) by date. MCF + Cancelled excluded (same as every other sales metric).
 * Shape matches the dashboard's CSV series: { dates, parents:[{parent,title,sales,units}], totals }.
 */
/* ===================== Daily Performance (Amazon Sales & Traffic report, both brands) =====================
 * PORTED from Amazon Hub, unchanged logic: data comes DIRECT from Amazon's
 * GET_SALES_AND_TRAFFIC_REPORT (NOT aggregated from Orders). Same 16 columns
 * (incl. Sessions / Buy Box). The report finalises with a 24-72 hr lag, so the
 * most-recent missing days are synthesised from the brand's Orders tab (Units +
 * Ordered Sales only) — exactly as Amazon Hub does. Multi-brand via ACTIVE_PREFIX. */

var DP_START_DATE = '2025-01-01';

// Menu entry points — one per brand + both.
function buildRidhiDailyPerformance() { refreshDailyPerformanceFor_('SP', 'Daily Performance', 'Orders', 'Ridhi'); }
function buildCpcDailyPerformance()   { refreshDailyPerformanceFor_('CPC', 'CPC Daily Performance', 'CPC Orders', 'CPC'); }
function buildAllDailyPerformance() {
  var lines = sheetBrands_().map(function (b) {
    var r = refreshDailyPerformanceFor_(b.pfx, b.dpTab, b.ordTab, b.label);
    return b.label + ': ' + ((r && r.days) || 0) + ' days' + (r && r.live ? ' (+' + r.live + ' live)' : '');
  });
  if (!SILENT_RUN) { try { SpreadsheetApp.getUi().alert('Daily Performance built ✅',
    lines.join('\n') +
    '\n\nData is straight from Amazon\'s Sales & Traffic report. Re-sync to push to the dashboard Sales tab.',
    SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {} }
}

function refreshDailyPerformanceFor_(pfx, tabName, ordTab, label) {
  ACTIVE_PREFIX = pfx;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var DAY = 86400000, PT = 'America/Los_Angeles';
    var endStr = Utilities.formatDate(new Date(), PT, 'yyyy-MM-dd');       // Amazon PT "today"
    var dpSh = ss.getSheetByName(tabName);

    // First build (no tab / malformed) → FULL from DP_START_DATE, then live days.
    if (!dpSh || dpSh.getLastRow() < 3) {
      ss.toast('Building ' + label + ' Daily Performance (full)…', 'Daily Performance', 15);
      var nFull = writeDailyPerf_(ss, runSalesTrafficReport_(DP_START_DATE, endStr), tabName);
      var lFull = appendLiveDaysFromOrders_(ss, tabName, ordTab);
      return { ok: true, label: label, days: nFull, live: lFull };
    }

    // ROLLING: refresh ONLY the last ORDERS_REFRESH_DAYS from the report; older rows stay
    // FROZEN (finalised Amazon data never changes). Boundary auto-advances each day.
    ss.toast('Refreshing ' + label + ' Daily Performance (last ' + ORDERS_REFRESH_DAYS + ' days)…', 'Daily Performance', 15);
    var startStr = Utilities.formatDate(new Date(Date.now() - ORDERS_REFRESH_DAYS * DAY), PT, 'yyyy-MM-dd');

    // 1) Delete existing DATA rows (2..totalRow-1) dated >= startStr — report + old live rows.
    var totalRow = -1;
    for (var r = dpSh.getLastRow(); r >= 2; r--) { if (String(dpSh.getRange(r, 1).getValue()).indexOf('TOTAL') === 0) { totalRow = r; break; } }
    if (totalRow < 3) { var nR = writeDailyPerf_(ss, runSalesTrafficReport_(DP_START_DATE, endStr), tabName); appendLiveDaysFromOrders_(ss, tabName, ordTab); return { ok: true, label: label, days: nR }; }
    var nData = totalRow - 2;
    if (nData > 0) {
      var dcol = dpSh.getRange(2, 1, nData, 1).getValues();
      var del = [];
      for (var i = 0; i < dcol.length; i++) { var v = dcol[i][0]; if (v instanceof Date && Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd') >= startStr) del.push(i + 2); }
      del.sort(function (a, b) { return b - a; });
      var dp = 0;
      while (dp < del.length) { var de = del[dp], dsr = de; while (dp + 1 < del.length && del[dp + 1] === dsr - 1) { dsr = del[dp + 1]; dp++; } dpSh.deleteRows(dsr, de - dsr + 1); dp++; }
    }

    // 2) Pull the report for [startStr, today] and INSERT its rows before the (shifted) TOTAL.
    var rows = dpRowsFromReport_(runSalesTrafficReport_(startStr, endStr));
    totalRow = -1;
    for (var r2 = dpSh.getLastRow(); r2 >= 2; r2--) { if (String(dpSh.getRange(r2, 1).getValue()).indexOf('TOTAL') === 0) { totalRow = r2; break; } }
    if (rows.length && totalRow >= 2) {
      dpSh.insertRowsBefore(totalRow, rows.length);
      dpSh.getRange(totalRow, 1, rows.length, 16).setValues(rows);
      dpApplyFormats_(dpSh);
      for (var k = 0; k < rows.length; k++) { var rr = totalRow + k; dpSh.getRange(rr, 9).setFormula('=IF(D' + rr + '=0,0,H' + rr + '/D' + rr + ')'); }
      PropertiesService.getScriptProperties().setProperty('DP_REPORT_MAX_' + pfx, Utilities.formatDate(rows[rows.length - 1][0], 'UTC', 'yyyy-MM-dd'));
    }

    // 3) Live recent days from Orders (report lags 24-72h) + re-point the TOTAL row.
    var live = appendLiveDaysFromOrders_(ss, tabName, ordTab);
    dpFixTotalRow_(dpSh);
    return { ok: true, label: label, days: rows.length, live: live };
  } finally { ACTIVE_PREFIX = 'SP'; }
}

// Amazon's Sales & Traffic business report (PT day boundaries — matches Seller Central).
function runSalesTrafficReport_(startStr, endStr, asinGranularity) {
  var PT = 'America/Los_Angeles';
  var offStart = Utilities.formatDate(new Date(startStr + 'T12:00:00Z'), PT, 'XXX');
  var offEnd   = Utilities.formatDate(new Date(endStr   + 'T12:00:00Z'), PT, 'XXX');
  var startISO = new Date(startStr + 'T00:00:00' + offStart).toISOString();
  var end = new Date(endStr + 'T23:59:59' + offEnd);
  var now = new Date(); if (end > now) end = now;

  var reportId = null, lastErr = null;
  for (var att = 0; att < 4 && !reportId; att++) {
    try {
      reportId = sp_('/reports/2021-06-30/reports', 'post', {
        reportType: 'GET_SALES_AND_TRAFFIC_REPORT',
        marketplaceIds: [marketplaceId_()],
        dataStartTime: startISO, dataEndTime: end.toISOString(),
        reportOptions: { dateGranularity: 'DAY', asinGranularity: asinGranularity || 'PARENT' }
      }).reportId;
    } catch (e) {
      lastErr = e; var msg = String(e.message || '');
      if (msg.indexOf('429') < 0 && msg.toLowerCase().indexOf('quotaexceeded') < 0) throw e;
      Utilities.sleep(90 * 1000);
    }
  }
  if (!reportId) throw lastErr || new Error('Sales & Traffic report: out of retries');

  var docId = null, deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    Utilities.sleep(15000);
    var r = sp_('/reports/2021-06-30/reports/' + reportId, 'get');
    if (r.processingStatus === 'DONE') { docId = r.reportDocumentId; break; }
    if (r.processingStatus === 'FATAL' || r.processingStatus === 'CANCELLED') throw new Error('Amazon ended the report as ' + r.processingStatus);
  }
  if (!docId) throw new Error('Report timed out — run the refresh again.');
  var doc = sp_('/reports/2021-06-30/documents/' + docId, 'get');
  var blob = UrlFetchApp.fetch(doc.url, { muteHttpExceptions: true }).getBlob();
  if (doc.compressionAlgorithm === 'GZIP') blob = Utilities.ungzip(blob.setContentType('application/x-gzip'));
  return JSON.parse(blob.getDataAsString('UTF-8'));
}

function dpNum_(v) { if (v === '' || v === null || v === undefined) return ''; var f = parseFloat(v); return isNaN(f) ? '' : f; }
function dpPct_(v) { return (v === null || v === undefined || v === '') ? '' : Number(v) / 100; }

// Parse the Sales & Traffic report JSON into the 16-column Daily Performance rows (date asc).
function dpRowsFromReport_(data) {
  var rows = (data.salesAndTrafficByDate || []).map(function (e) {
    var s = e.salesByDate || {}, t = e.trafficByDate || {};
    var ops = s.orderedProductSales || {}, opsB = s.orderedProductSalesB2B || {};
    var asp = s.averageSellingPrice || {};
    return [
      new Date(e.date + 'T00:00:00Z'),
      dpNum_(ops.amount), dpNum_(opsB.amount),
      dpNum_(s.unitsOrdered), dpNum_(s.unitsOrderedB2B), dpNum_(s.totalOrderItems),
      dpNum_(s.unitsShipped), dpNum_(s.unitsRefunded), '',
      dpNum_(asp.amount), dpNum_(s.averageUnitsPerOrderItem),
      dpNum_(t.sessions), dpNum_(t.browserSessions), dpNum_(t.mobileAppSessions),
      dpNum_(t.pageViews), dpPct_(t.buyBoxPercentage)
    ];
  });
  rows.sort(function (a, b) { return a[0] - b[0]; });
  return rows;
}

// Currency/number formats + the Date column format for a Daily Performance tab.
function dpApplyFormats_(sh) {
  sh.getRange('A2:A').setNumberFormat('yyyy-mm-dd');
  sh.getRange('B2:C').setNumberFormat('$#,##0.00');
  sh.getRange('I2:I').setNumberFormat('0.0%');
  sh.getRange('J2:J').setNumberFormat('$#,##0.00');
  sh.getRange('K2:K').setNumberFormat('0.00');
  sh.getRange('P2:P').setNumberFormat('0.00%');
  ['D','E','F','G','H','L','M','N','O'].forEach(function (c) { sh.getRange(c + '2:' + c).setNumberFormat('#,##0'); });
}

// Find the TOTAL/AVG row and re-point its SUM/AVG formulas at the current data range.
function dpFixTotalRow_(sh) {
  var totalRow = -1;
  for (var r = sh.getLastRow(); r >= 2; r--) { if (String(sh.getRange(r, 1).getValue()).indexOf('TOTAL') === 0) { totalRow = r; break; } }
  if (totalRow < 3) return;
  var last = totalRow - 1;
  [2,3,4,5,6,7,8,12,13,14,15].forEach(function (c) { var L = colA1_(c); sh.getRange(totalRow, c).setFormula('=SUM(' + L + '2:' + L + last + ')'); });
  [10,11,16].forEach(function (c) { var L = colA1_(c); sh.getRange(totalRow, c).setFormula('=IFERROR(AVERAGE(' + L + '2:' + L + last + '),0)'); });
  sh.getRange(totalRow, 9).setFormula('=IF(D' + totalRow + '=0,0,H' + totalRow + '/D' + totalRow + ')');
}

function writeDailyPerf_(ss, data, tabName) {
  var rows = dpRowsFromReport_(data);

  var headers = ['Date', 'Ordered Sales', 'B2B Sales', 'Units Ordered', 'B2B Units', 'Order Items',
    'Units Shipped', 'Units Refunded', 'Refund Rate', 'Avg Selling Price', 'Avg Units / Order Item',
    'Sessions', 'Browser Sessions', 'Mobile App Sessions', 'Page Views', 'Buy Box %'];
  var sh = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  sh.clear();
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#0f172a').setFontColor('#ffffff').setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');
  sh.setRowHeight(1, 32); sh.setFrozenRows(1);

  if (rows.length) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
    for (var i = 0; i < rows.length; i++) { var rr = i + 2; sh.getRange(rr, 9).setFormula('=IF(D' + rr + '=0,0,H' + rr + '/D' + rr + ')'); }
    var tot = rows.length + 2;
    sh.getRange(tot, 1).setValue('TOTAL / AVG');
    [2,3,4,5,6,7,8,12,13,14,15].forEach(function (c) { var L = colA1_(c); sh.getRange(tot, c).setFormula('=SUM(' + L + '2:' + L + (tot - 1) + ')'); });
    [10,11,16].forEach(function (c) { var L = colA1_(c); sh.getRange(tot, c).setFormula('=IFERROR(AVERAGE(' + L + '2:' + L + (tot - 1) + '),0)'); });
    sh.getRange(tot, 9).setFormula('=IF(D' + tot + '=0,0,H' + tot + '/D' + tot + ')');
    sh.getRange(tot, 1, 1, headers.length).setBackground('#0f172a').setFontColor('#ffffff').setFontWeight('bold');
  }
  sh.getRange('A2:A').setNumberFormat('yyyy-mm-dd');
  sh.getRange('B2:C').setNumberFormat('$#,##0.00');
  sh.getRange('I2:I').setNumberFormat('0.0%');
  sh.getRange('J2:J').setNumberFormat('$#,##0.00');
  sh.getRange('K2:K').setNumberFormat('0.00');
  sh.getRange('P2:P').setNumberFormat('0.00%');
  ['D','E','F','G','H','L','M','N','O'].forEach(function (c) { sh.getRange(c + '2:' + c).setNumberFormat('#,##0'); });
  // Remember the last FINALISED report date so the hourly live-refresh knows which
  // trailing rows are the (replaceable) Orders-synthesised live days.
  if (rows.length) PropertiesService.getScriptProperties().setProperty('DP_REPORT_MAX_' + ACTIVE_PREFIX,
    Utilities.formatDate(rows[rows.length - 1][0], 'UTC', 'yyyy-MM-dd'));
  return rows.length;
}

/**
 * LIGHT hourly refresh of a Daily Performance tab: WITHOUT re-pulling Amazon's report,
 * drop the previously-appended live days (dates after the last finalised report day)
 * and re-synthesise them from the Orders tab. Idempotent — safe to run every hour.
 * Needs one full report build first (sets DP_REPORT_MAX_<pfx>).
 */
function refreshDailyPerfLive_(pfx, tabName, ordTab) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var maxStr = prop_('DP_REPORT_MAX_' + pfx);
  var dpSh = ss.getSheetByName(tabName);
  if (!dpSh || !maxStr || dpSh.getLastRow() < 2) return 0;
  var totalRow = -1;
  for (var r = dpSh.getLastRow(); r >= 2; r--) { if (String(dpSh.getRange(r, 1).getValue()).indexOf('TOTAL') === 0) { totalRow = r; break; } }
  if (totalRow < 3) return 0;
  var lastData = totalRow - 1, n = lastData - 1;
  if (n > 0) {
    var dcol = dpSh.getRange(2, 1, n, 1).getValues();
    var cut = -1;
    for (var i = 0; i < dcol.length; i++) {
      var v = dcol[i][0];
      if (v instanceof Date && Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd') > maxStr) { cut = i + 2; break; }
    }
    if (cut > 0) dpSh.deleteRows(cut, lastData - cut + 1);   // remove old live rows
  }
  return appendLiveDaysFromOrders_(ss, tabName, ordTab);      // re-append fresh live days
}

// Synthesise the missing recent days (Amazon's report lags 24-72h) from the brand's
// Orders tab — Units Ordered + Ordered Sales only (no live traffic exists). Yellow rows.
function appendLiveDaysFromOrders_(ss, tabName, ordTab) {
  var dpSh = ss.getSheetByName(tabName), orSh = ordersSS_().getSheetByName(ordTab);
  if (!dpSh || !orSh || orSh.getLastRow() < 2) return 0;
  var lastRow = dpSh.getLastRow(), totalRow = -1;
  for (var r = lastRow; r >= 2; r--) { if (String(dpSh.getRange(r, 1).getValue()).indexOf('TOTAL') === 0) { totalRow = r; break; } }
  if (totalRow < 2) return 0;
  var lastDateVal = dpSh.getRange(totalRow - 1, 1).getValue();
  if (!(lastDateVal instanceof Date)) return 0;
  var lastDateStr = Utilities.formatDate(lastDateVal, 'UTC', 'yyyy-MM-dd');

  var PT = 'America/Los_Angeles', DAY = 86400000;
  var todayPtStr = Utilities.formatDate(new Date(), PT, 'yyyy-MM-dd');
  if (lastDateStr >= todayPtStr) return 0;
  var missing = [], curMs = new Date(lastDateStr + 'T00:00:00Z').getTime() + DAY, todayMs = new Date(todayPtStr + 'T00:00:00Z').getTime();
  while (curMs <= todayMs) { missing.push(Utilities.formatDate(new Date(curMs), 'UTC', 'yyyy-MM-dd')); curMs += DAY; }
  if (!missing.length) return 0;

  var ordersData = orSh.getRange(2, 1, orSh.getLastRow() - 1, ORDERS_HEADERS.length).getValues();
  var agg = {};
  for (var i = 0; i < ordersData.length; i++) {
    var row = ordersData[i];
    if (String(row[9] || '').toUpperCase() === 'MCF') continue;
    if (String(row[7] || '').toLowerCase() === 'cancelled') continue;
    var units = Number(row[5]) || 0, revenue = Number(row[6]) || 0;
    if (!units) continue;
    var purch = row[1], ptDate = null;
    if (purch instanceof Date && !isNaN(purch.getTime())) ptDate = Utilities.formatDate(purch, PT, 'yyyy-MM-dd');
    else if (typeof purch === 'string' && purch) { var d = new Date(purch); if (!isNaN(d.getTime())) ptDate = Utilities.formatDate(d, PT, 'yyyy-MM-dd'); }
    if (!ptDate) { var m = String(row[2] || '').match(/(\d{4}-\d{2}-\d{2})/); if (m) ptDate = m[1]; }   // fallback col C
    if (!ptDate) continue;
    if (!agg[ptDate]) agg[ptDate] = { units: 0, sales: 0 };
    agg[ptDate].units += units; agg[ptDate].sales += revenue;
  }

  var headersCount = 16;
  var liveRows = missing.map(function (dayStr) {
    var a = agg[dayStr] || { units: 0, sales: 0 };
    var r = new Array(headersCount).fill('');
    r[0] = new Date(dayStr + 'T00:00:00Z'); r[1] = a.sales; r[3] = a.units;
    return r;
  });
  dpSh.insertRowsBefore(totalRow, liveRows.length);
  dpSh.getRange(totalRow, 1, liveRows.length, headersCount).setValues(liveRows).setBackground('#fff4c2').setFontStyle('italic');
  dpSh.getRange(totalRow, 1, liveRows.length, 1).setNumberFormat('yyyy-mm-dd');
  dpSh.getRange(totalRow, 2, liveRows.length, 1).setNumberFormat('$#,##0.00');
  dpSh.getRange(totalRow, 4, liveRows.length, 1).setNumberFormat('#,##0');
  var newTotalRow = totalRow + liveRows.length;
  [2,3,4,5,6,7,8,12,13,14,15].forEach(function (c) { var L = colA1_(c); dpSh.getRange(newTotalRow, c).setFormula('=SUM(' + L + '2:' + L + (newTotalRow - 1) + ')'); });
  [10,11,16].forEach(function (c) { var L = colA1_(c); dpSh.getRange(newTotalRow, c).setFormula('=IFERROR(AVERAGE(' + L + '2:' + L + (newTotalRow - 1) + '),0)'); });
  dpSh.getRange(newTotalRow, 9).setFormula('=IF(D' + newTotalRow + '=0,0,H' + newTotalRow + '/D' + newTotalRow + ')');
  return liveRows.length;
}

/** Push a brand's Daily Performance TAB (the Amazon-report table) to Firestore
 *  `fba_daily/<brand>` for the dashboard Sales tab. Reads the built tab (A=Date,
 *  B=Ordered Sales, D=Units Ordered, F=Order Items), skipping the TOTAL row. */
function syncDailyPerformance_(pfx, brandKey, label) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var projectId = prop_('FIREBASE_PROJECT_ID');
  if (!projectId) return { ok: false, label: label, error: 'Firebase not configured' };
  var tabName = (pfx === 'CPC') ? 'CPC Daily Performance' : 'Daily Performance';
  var sh = ss.getSheetByName(tabName);
  if (!sh || sh.getLastRow() < 2) return { ok: false, label: label, skipped: true, error: 'build "' + tabName + '" first' };
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();       // A..F
  var dates = [], sales = [], units = [], items = [];
  data.forEach(function (r) {
    if (!(r[0] instanceof Date)) return;                                   // skip TOTAL / blanks
    dates.push(Utilities.formatDate(r[0], 'UTC', 'yyyy-MM-dd'));
    sales.push(Math.round((Number(r[1]) || 0) * 100) / 100);
    units.push(Number(r[3]) || 0);
    items.push(Number(r[5]) || 0);
  });
  var series = { dates: dates.join(','), sales: sales.join(','), units: units.join(','), items: items.join(',') };
  var tz = ss.getSpreadsheetTimeZone();
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  var token = getFirestoreToken_();
  fsWriteDoc_(projectId, token, 'fba_daily/' + brandKey, { brand: label, series: series, updatedAt: stamp });
  return { ok: true, label: label, days: dates.length };
}

function syncParentWoW_(pfx, brandKey, label) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var projectId = prop_('FIREBASE_PROJECT_ID');
  if (!projectId) return { ok: false, label: label, error: 'Firebase not configured' };
  var catTab = (pfx === 'CPC') ? 'CPC Catalog' : 'Catalog';
  var ordTab = (pfx === 'CPC') ? 'CPC Orders' : 'Orders';
  var sh = ordersSS_().getSheetByName(ordTab);
  if (!sh || sh.getLastRow() < 2) return { ok: false, label: label, skipped: true, error: 'no orders in "' + ordTab + '"' };
  var catalog = readCatalogMap_(ss, catTab);

  var DAYS = 180, DAY = 86400000, PT = 'America/Los_Angeles';
  var todayStr = Utilities.formatDate(new Date(), PT, 'yyyy-MM-dd');
  var todayMs = new Date(todayStr + 'T00:00:00Z').getTime();
  var startMs = todayMs - (DAYS - 1) * DAY;
  var dates = [], idxByDate = {};
  for (var i = 0; i < DAYS; i++) {
    var ds = Utilities.formatDate(new Date(startMs + i * DAY), 'UTC', 'yyyy-MM-dd');
    dates.push(ds); idxByDate[ds] = i;
  }

  var data = sh.getRange(2, 1, sh.getLastRow() - 1, ORDERS_HEADERS.length).getValues();
  var agg = {};                                   // parent -> { title, sales[], units[] }
  var totSales = new Array(DAYS).fill(0), totUnits = new Array(DAYS).fill(0);
  data.forEach(function (row) {
    var sku = String(row[3] || '').trim(); if (!sku) return;
    if (String(row[9] || '').toUpperCase() === 'MCF') return;          // skip MCF
    if (String(row[7] || '').toLowerCase() === 'cancelled') return;    // skip cancelled
    var units = Number(row[5]) || 0, amt = Number(row[6]) || 0;
    if (!units && !amt) return;
    var v = row[2], ds = '';                                           // col C = Date (PT-anchored)
    if (v instanceof Date && !isNaN(v.getTime())) ds = Utilities.formatDate(v, PT, 'yyyy-MM-dd');
    else { var m = String(v || '').match(/(\d{4}-\d{2}-\d{2})/); if (m) ds = m[1]; }
    var di = idxByDate[ds]; if (di == null) return;                    // outside the 180-day window
    var c = catalog[sku] || {};
    var parent = String(c.parent || c.asin || '').trim() || '(unknown)';
    var ptitle = String(c.parentTitle || c.title || '').trim();   // manual Parent Title (Catalog col 13) first
    var a = agg[parent] || (agg[parent] = { title: ptitle, sales: new Array(DAYS).fill(0), units: new Array(DAYS).fill(0) });
    if (!a.title && ptitle) a.title = ptitle;
    a.sales[di] += amt; a.units[di] += units;
    totSales[di] += amt; totUnits[di] += units;
  });

  function csv(arr) { return arr.map(function (x) { return Math.round(x); }).join(','); }
  var parents = Object.keys(agg).map(function (p) {
    var a = agg[p];
    return { parent: p, title: a.title, sales: csv(a.sales), units: csv(a.units) };
  });
  var series = { dates: dates.join(','), parents: parents,
    totals: { sales: csv(totSales), units: csv(totUnits) } };

  var tz = ss.getSpreadsheetTimeZone();
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  var token = getFirestoreToken_();
  fsWriteDoc_(projectId, token, 'fba_parentwow/' + brandKey, { brand: label, series: series, updatedAt: stamp });
  return { ok: true, label: label, parents: parents.length };
}

function syncAllToFirebase() {
  var ui = SpreadsheetApp.getUi();
  if (!prop_('FIREBASE_PROJECT_ID')) {
    ui.alert('Firebase not configured', 'Run "🔥 Check Firebase connection" first.', ui.ButtonSet.OK);
    return;
  }
  function tryRun(fn) { try { return fn(); } catch (e) { return { ok: false, error: String(e.message || e) }; } }
  var brands = sheetBrands_();
  var lines = ['— Inventory —'];
  brands.forEach(function (b) {
    var r = tryRun(function () { return syncInventoryToFirestore_(b.pfx, b.invTab, b.key, b.label, true); });
    lines.push((r && r.ok) ? ('✅ ' + b.label + ': ' + r.skus + ' SKUs') : ('⚠️ ' + b.label + ': ' + ((r && r.error) || 'failed')));
  });
  lines.push('', '— Sales Analysis —');
  brands.forEach(function (b) {
    var r = tryRun(function () { return syncSalesAnalysis_(b.pfx, b.key, b.label); });
    lines.push((r && r.ok) ? ('✅ ' + b.label + ': ' + r.skus + ' SKUs · ' + r.colors + ' colors · ' + r.articles + ' articles')
      : ('⚠️ ' + b.label + ': ' + ((r && r.error) || 'failed')));
  });
  lines.push('', '— Parent W-o-W (units + sales) —');
  brands.forEach(function (b) {
    var r = tryRun(function () { return syncParentWoW_(b.pfx, b.key, b.label); });
    lines.push((r && r.ok) ? ('✅ ' + b.label + ': ' + r.parents + ' parents')
      : ('⚠️ ' + b.label + ': ' + ((r && r.error) || 'failed')));
  });
  lines.push('', '— Daily Performance (Sales tab) —');
  brands.forEach(function (b) {
    var r = tryRun(function () { return syncDailyPerformance_(b.pfx, b.key, b.label); });
    lines.push((r && r.ok) ? ('✅ ' + b.label + ': ' + r.days + ' days')
      : ('⚠️ ' + b.label + ': ' + ((r && r.error) || 'failed')));
  });
  ui.alert('🔥 Synced everything to Firebase',
    lines.join('\n') + '\n\nProject: ' + prop_('FIREBASE_PROJECT_ID') + '. Amazon Hub data untouched.', ui.ButtonSet.OK);
}

// Menu entry point — one action syncs BOTH brands.
function syncAllInventoryToFirebase() {
  var ui = SpreadsheetApp.getUi();
  if (!prop_('FIREBASE_PROJECT_ID')) {
    ui.alert('Firebase not configured', 'Run "🔥 Check Firebase connection" first and set the ' +
      'FIREBASE_* Script Properties.', ui.ButtonSet.OK);
    return;
  }
  function runOne(pfx, tab, key, label) {
    try { return syncInventoryToFirestore_(pfx, tab, key, label, true); }
    catch (e) { return { ok: false, label: label, error: String(e.message || e) }; }
  }
  var results = sheetBrands_().map(function (b) { return runOne(b.pfx, b.invTab, b.key, b.label); });
  var lines = results.map(function (r) {
    if (r && r.ok) return '✅ ' + r.label + ': ' + r.skus + ' SKUs → fba_inventory/' + r.brandKey +
      ' (' + r.pages + ' page' + (r.pages > 1 ? 's' : '') + ')';
    return '⚠️ ' + (r ? r.label : '?') + ': ' + ((r && r.error) || 'failed') +
      ((r && r.skipped) ? ' (build it first / no data)' : '');
  });
  ui.alert('Inventory → Firebase  (Ridhi + CPC)',
    lines.join('\n\n') + '\n\nProject: ' + prop_('FIREBASE_PROJECT_ID') +
    '. Amazon Hub data untouched (only fba_* collections used).', ui.ButtonSet.OK);
}

// Single-brand entry points (kept for ad-hoc use; menu uses the combined action above).
function syncRidhiInventoryToFirebase() { syncInventoryToFirestore_('SP', TAB.INVENTORY, 'ridhi', 'Ridhi'); }
function syncCpcInventoryToFirebase() { syncInventoryToFirestore_('CPC', 'CPC Inventory', 'cpc', 'CPC'); }

/* ===================== Events tab (sale-spike days excluded from averages) ===================== */

var EVENTS_TAB = 'Events';

/** Create the Events tab (date ranges to exclude from sales averages) if missing. */
function ensureEventsTab_(ss) {
  var sh = ss.getSheetByName(EVENTS_TAB);
  if (sh) return sh;
  sh = ss.insertSheet(EVENTS_TAB);
  sh.getRange(1, 1, 1, 3).setValues([['Event', 'Start Date', 'End Date']])
    .setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight('bold');
  sh.getRange(2, 1, 3, 3).setValues([
    ['Prime Day 2025', '2025-07-08', '2025-07-11'],
    ['Big Deal Days 2025', '2025-10-07', '2025-10-08'],
    ['Black Friday / Cyber Monday 2025', '2025-11-28', '2025-12-01']
  ]);
  sh.getRange(2, 2, 100, 2).setNumberFormat('yyyy-mm-dd');
  sh.setFrozenRows(1); sh.setColumnWidth(1, 260);
  noteOn_(sh, 'Sales on these date ranges are EXCLUDED from the 30/90-day averages and the monthly projections ' +
    '(Prime Day, Big Deal Days, BFCM, etc.). One row per event; both dates inclusive. Re-run Sync after editing.');
  return sh;
}
function setupEventsTab() {
  ensureEventsTab_(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getActiveSpreadsheet().toast('Events tab ready — add/edit event date ranges, then re-sync.', 'Amazon Report', 8);
}

/** Read Events tab into [{s,e}] inclusive day-ms ranges (spreadsheet TZ). */
function readEventRanges_(ss) {
  var sh = ss.getSheetByName(EVENTS_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  var tz = ss.getSpreadsheetTimeZone(), out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
    var s = parseDayMs_(r[1], tz);
    if (s) out.push({ s: s, e: parseDayMs_(r[2], tz) || s });
  });
  return out;
}
/** Any date/string -> UTC-midnight ms of that calendar day (in tz for Date cells). */
function parseDayMs_(v, tz) {
  if (v instanceof Date && !isNaN(v.getTime())) return new Date(Utilities.formatDate(v, tz, 'yyyy-MM-dd') + 'T00:00:00Z').getTime();
  var m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : 0;
}
function inEvent_(dayMs, ranges) {
  for (var i = 0; i < ranges.length; i++) if (dayMs >= ranges[i].s && dayMs <= ranges[i].e) return true;
  return false;
}

/**
 * One pass over a brand's Orders tab → per-SKU event-EXCLUDED sales:
 *   { bySku: { sku: { l30u, l90u, mqty:{YYYY-MM:qty} } }, evDays30, evDays90 }
 * MCF + Cancelled + event-day rows are dropped. evDays30/90 = event days inside the
 * last 30/90 days (used to shrink the average's denominator).
 */
function computeReplenSales_(ss, ordTab, ranges) {
  var out = {}, res = { bySku: out, evDays30: 0, evDays90: 0 };
  var sh = ordersSS_().getSheetByName(ordTab);
  if (!sh || sh.getLastRow() < 2) return res;
  var PT = 'America/Los_Angeles', DAY = 86400000;
  var todayMs = new Date(Utilities.formatDate(new Date(), PT, 'yyyy-MM-dd') + 'T00:00:00Z').getTime();
  // The 30 / 90 most-recent NON-EVENT days: skip the event days (from the Events tab)
  // and walk further back, so L30 = 30 real selling days and L90 = 90 real selling
  // days — no event-day distortion, and a full window of data each time.
  var l30Set = {}, l90Set = {}, n30 = 0, n90 = 0;
  for (var d = 0; (n30 < 30 || n90 < 90) && d < 400; d++) {
    var dm = todayMs - d * DAY;
    if (inEvent_(dm, ranges)) continue;
    if (n90 < 90) { l90Set[dm] = 1; n90++; }
    if (n30 < 30) { l30Set[dm] = 1; n30++; }
  }

  var data = sh.getRange(2, 1, sh.getLastRow() - 1, ORDERS_HEADERS.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var sku = String(row[3] || '').trim(); if (!sku) continue;
    if (String(row[9] || '').toUpperCase() === 'MCF') continue;
    if (String(row[7] || '').toLowerCase() === 'cancelled') continue;
    var units = Number(row[5]) || 0; if (!units) continue;
    var purch = row[1], dms;
    if (purch instanceof Date && !isNaN(purch.getTime())) {
      dms = new Date(Utilities.formatDate(purch, PT, 'yyyy-MM-dd') + 'T00:00:00Z').getTime();
    } else { var dd = new Date(purch); dms = isNaN(dd.getTime()) ? toMs_(row[2]) : new Date(Utilities.formatDate(dd, PT, 'yyyy-MM-dd') + 'T00:00:00Z').getTime(); }
    if (!dms || inEvent_(dms, ranges)) continue;                   // drop event-day sales everywhere
    var b = out[sku] || (out[sku] = { l30u: 0, l90u: 0, mqty: {} });
    if (l90Set[dms]) b.l90u += units;                              // within the 90 non-event days
    if (l30Set[dms]) b.l30u += units;                              // within the 30 most-recent non-event days
    var ym = Utilities.formatDate(new Date(dms), 'UTC', 'yyyy-MM');
    b.mqty[ym] = (b.mqty[ym] || 0) + units;
  }
  return res;
}

/**
 * Build the dashboard's replenishment fields on each row (keyed by Inventory header
 * names). Event days are excluded from every average. Adds: ads, basis, total,
 * l30excl, l90excl, and months[] = per-month {label,onHand,proj,excess} from the
 * current month through December (roll-forward). Returns {recLabels, monthLabels}.
 *   ADS   = event-excluded L90/non-event-days; uses L30 run-rate on a recent spike
 *           (OOS-recovery / new launch) and a 12-month reconstruction if OOS.
 *   Color growth (per month) = how the SKU's COLOR performs that calendar month vs
 *           its own 12-month average — only the above-average part, as a % uplift.
 *   On hand (first month) = warehouse + inbound_receiving + that-month Rec + AWD;
 *           later months   = max(0, prev Excess) + that-month Rec.
 *   Projection = ADS × 40 × (1 + colorGrowth[month]).
 *   Excess     = On hand − Projection (negative ⇒ shortage, send by Air now).
 */
function enrichReplenishment_(ss, ordTab, rows, headers) {
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date();
  var curY = Number(Utilities.formatDate(now, tz, 'yyyy'));
  var curM = Number(Utilities.formatDate(now, tz, 'MM'));          // 1-12
  var MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var ABBR = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

  // Rec columns present → map YYYYMM → header key.
  var recByYM = {}, recCols = [];
  headers.forEach(function (h) {
    var m = String(h).match(/([A-Za-z]{3}).*?(\d{2})\s*Rec/);
    if (m && ABBR[m[1].toLowerCase()]) {
      var ym = (2000 + Number(m[2])) * 100 + ABBR[m[1].toLowerCase()];
      recByYM[ym] = h; recCols.push({ key: h, ym: ym });
    }
  });
  recCols.sort(function (a, b) { return a.ym - b.ym; });
  var curYM = curY * 100 + curM;
  var fut = recCols.filter(function (c) { return c.ym >= curYM; });
  var rec3 = (fut.length ? fut : recCols);   // ALL upcoming Rec months (was .slice(0,3)) → dashboard shows every upcoming receiving column
  var recLabels = rec3.map(function (c) { return c.key; });

  // Projection months: current month … December (same year). Includes the current
  // month so the running month's on-hand vs projected demand is visible too.
  var months = [];
  for (var mm = curM; mm <= 12; mm++) {
    var ym = curY * 100 + mm;
    months.push({ ym: ym, cm: mm, key: recByYM[ym] || null, label: MON[mm] + " '" + String(curY).slice(2) });
  }

  // Event-excluded sales.
  var ranges = readEventRanges_(ss);
  var sres = computeReplenSales_(ss, ordTab, ranges);
  var sales = sres.bySku;
  var den90 = Math.max(1, 90 - sres.evDays90), den30 = Math.max(1, 30 - sres.evDays30);

  // Calendar-month sales profiles by COLOR and by ARTICLE (Sub-Category),
  // event-excluded — used for per-month seasonal adjustment of the projection.
  var skuColor = {}, skuArt = {};
  rows.forEach(function (o) {
    var sku = String(o['SKU'] || '').trim();
    skuColor[sku] = String(o['Color'] || '').trim() || '(none)';
    skuArt[sku]   = String(o['Sub-Category'] || '').trim() || '(none)';
  });
  // colorCal/artCal = calendar-month profile (year-merged) for seasonality;
  // colorYM/artYM = year-specific YYYY-MM series for the YoY growth trend.
  var colorCal = {}, artCal = {}, colorYM = {}, artYM = {};
  Object.keys(sales).forEach(function (sku) {
    var col = skuColor[sku], art = skuArt[sku], mq = sales[sku].mqty;
    Object.keys(mq).forEach(function (k) {
      var cm = Number(k.split('-')[1]), q = mq[k];
      var cc = (colorCal[col] = colorCal[col] || {}); cc[cm] = (cc[cm] || 0) + q;
      var ac = (artCal[art] = artCal[art] || {});     ac[cm] = (ac[cm] || 0) + q;
      var cy = (colorYM[col] = colorYM[col] || {});   cy[k] = (cy[k] || 0) + q;
      var ay = (artYM[art] = artYM[art] || {});       ay[k] = (ay[k] || 0) + q;
    });
  });
  function clamp_(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  // GENTLE seasonal deviation of a month vs the group's OWN 12-month average
  // (signed, modest −30%…+50%). Keeps the L90-based ADS×40 base intact — it only
  // nudges peak months up / dip months down a little, never craters the base.
  function seasonDev(profMap, key, cm) {
    var prof = profMap[key]; if (!prof) return 0;
    var tot = 0; Object.keys(prof).forEach(function (k) { tot += prof[k]; });
    var overall = tot / 12; if (overall <= 0) return 0;
    return clamp_((prof[cm] || 0) / overall - 1, -0.3, 0.5);
  }

  // YoY GROWTH trend: last 3 months vs the SAME 3 months a year earlier (so it
  // measures real growth, not seasonality). Returns clamped fraction; 0 if no prior-
  // year data (new color/article — can't tell, so no boost).
  var recent3 = [], yoY3 = [];
  for (var g = 0; g < 3; g++) {
    var yy = curY, mn = curM - g; if (mn < 1) { mn += 12; yy--; }
    recent3.push(yy + '-' + ('0' + mn).slice(-2));
    yoY3.push((yy - 1) + '-' + ('0' + mn).slice(-2));
  }
  function growthOf(ymMap, key) {
    var prof = ymMap[key]; if (!prof) return 0;
    var rec = 0, pri = 0;
    recent3.forEach(function (m) { rec += prof[m] || 0; });
    yoY3.forEach(function (m) { pri += prof[m] || 0; });
    if (pri <= 0) return 0;
    return clamp_(rec / pri - 1, -0.3, 0.8);            // −30% … +80%
  }

  var last12 = [], y = curY, mo = curM;
  for (var k = 0; k < 12; k++) { last12.push(y + '-' + ('0' + mo).slice(-2)); mo--; if (mo < 1) { mo = 12; y--; } }

  rows.forEach(function (o) {
    var sku = String(o['SKU'] || '').trim(), col = skuColor[sku], art = skuArt[sku];
    var num = function (key) { var v = Number(o[key]); return isNaN(v) ? 0 : v; };
    var warehouse = num('warehouse'), fulfillable = num('fulfillable'), inbRecv = num('inbound_receiving'), awd = num('AWD Available');
    var s = sales[sku] || { l30u: 0, l90u: 0, mqty: {} };

    var adsL90 = s.l90u / den90;                          // event-excluded, 90 non-event days
    var adsL30 = s.l30u / den30;                          // event-excluded, 30 most-recent non-event days
    var aMonths = 0, aUnits = 0;
    last12.forEach(function (ym2) { var q = s.mqty[ym2] || 0; if (q > 0) { aMonths++; aUnits += q; } });
    var reconAds = aMonths > 0 ? aUnits / (aMonths * 30.4) : 0;
    var oosHist = (adsL90 > 0 || reconAds > 0) && (reconAds > adsL90 * 1.25 || (fulfillable === 0 && reconAds > 0));
    // Recent surge: the 30-day rate well above the 90-day rate → ride it.
    var recentSpike = (s.l90u > 0) && (s.l30u / s.l90u >= 0.6) && (adsL30 > adsL90 * 1.25);
    // Pick the highest applicable rate; label Basis by what actually drove it.
    var ads = adsL90, basis = 'L90 avg';
    if (oosHist && reconAds > ads) { ads = reconAds; basis = 'OOS recon'; }
    if (recentSpike && adsL30 > ads) { ads = adsL30; basis = 'L30 spike'; }

    // Base = ADS × 40 days (event-excluded run-rate, with a buffer over a 30-day month).
    // Trend = avg YoY growth of the color + article (uplift, base never cratered) + a
    // gentle monthly seasonal nudge. Proj = base × (1 + growth + season), bounded.
    var growthAvg = (growthOf(colorYM, col) + growthOf(artYM, art)) / 2;

    // Monthly roll-forward (Jul → Dec): each month's leftover carries to the next.
    var monthsOut = [], carry = 0;
    months.forEach(function (M, i) {
      var rec = M.key ? num(M.key) : 0;
      var onHand = (i === 0) ? (warehouse + inbRecv + rec + awd) : (Math.max(0, carry) + rec);
      var sea = (seasonDev(colorCal, col, M.cm) + seasonDev(artCal, art, M.cm)) / 2;
      var proj = Math.round(ads * 40 * (1 + clamp_(growthAvg + sea, -0.4, 1.2)));
      var excess = Math.round(onHand - proj);
      carry = excess;
      monthsOut.push({ label: M.label, onHand: Math.round(onHand), proj: proj, excess: excess });
    });

    o['ads'] = Math.round(ads * 10) / 10;
    o['basis'] = basis;
    o['growth'] = Math.round(growthAvg * 1000) / 10;               // YoY growth uplift, as a %
    o['l30excl'] = Math.round(s.l30u);                             // event-excluded, shown as L30
    o['l90excl'] = Math.round(s.l90u);
    o['total'] = warehouse + rec3.reduce(function (a, c) { return a + num(c.key); }, 0) + inbRecv + awd;
    o['months'] = monthsOut;
  });

  return { recLabels: recLabels, monthLabels: months.map(function (M) { return M.label; }) };
}

/**
 * Push a brand's Inventory tab to Firestore under "fba_inventory/<brand>" (+ paged
 * "_p1/_p2…" docs to stay under Firestore's 1 MiB/doc limit). Each row becomes a map
 * keyed by the tab's header names; the Image column's URL is recovered from its
 * =IMAGE("…") formula. Reads the Inventory tab only — Amazon Hub is never touched.
 * silent=true ⇒ no UI alert; returns a result object {ok,label,skus,pages,brandKey} or
 * {ok:false,label,error,skipped} (used by the combined Ridhi+CPC sync).
 */
function syncInventoryToFirestore_(pfx, invTab, brandKey, label, silent) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var projectId = prop_('FIREBASE_PROJECT_ID');
  if (!projectId) {
    if (silent) return { ok: false, label: label, error: 'Firebase not configured' };
    ui.alert('Firebase not configured', 'Run "🔥 Check Firebase connection" first and set the ' +
      'FIREBASE_* Script Properties.', ui.ButtonSet.OK);
    return;
  }
  var sh = ss.getSheetByName(invTab);
  if (!sh || sh.getLastRow() < 3) {
    if (silent) return { ok: false, label: label, skipped: true, error: '"' + invTab + '" not built' };
    ui.alert('Build "' + invTab + '" first (menu 7/8).');
    return;
  }

  var lastCol = sh.getLastColumn();
  // Header may sit entirely in row 1 (Ridhi layout) or be split across rows 1-2
  // (some CPC builds keep identity headers in row 2). Build a MERGED header: per
  // column take the first non-empty, NON-numeric label from row 1 then row 2 (so a
  // totals number like 61,109 is never mistaken for a header). Data starts row 3.
  var hdr2 = sh.getRange(1, 1, 2, lastCol).getValues();
  function isHeaderText_(x) { var s = String(x == null ? '' : x).trim(); return !!s && isNaN(Number(s)); }
  var headers = [];
  for (var c = 0; c < lastCol; c++) {
    headers.push(isHeaderText_(hdr2[0][c]) ? String(hdr2[0][c]).trim()
              : isHeaderText_(hdr2[1][c]) ? String(hdr2[1][c]).trim()
              : ('col' + (c + 1)));
  }
  // Find the SKU column by NAME (never assume it is column A — that broke CPC).
  var skuCol = 0;
  for (var sc = 0; sc < headers.length; sc++) { if (/^sku$/i.test(headers[sc])) { skuCol = sc; break; } }

  var nRows = sh.getLastRow() - 2;                              // data = row 3 onward
  var values = sh.getRange(3, 1, nRows, lastCol).getValues();
  var formulas = sh.getRange(3, 1, nRows, lastCol).getFormulas();

  var imgCol = -1;
  for (var h = 0; h < headers.length; h++) { if (/image/i.test(headers[h])) { imgCol = h; break; } }
  var tz = Session.getScriptTimeZone();

  var rows = values.map(function (r, ri) {
    var obj = {};
    for (var cc = 0; cc < headers.length; cc++) {
      var key = headers[cc];
      var v = r[cc];
      if (cc === imgCol) {                                      // recover URL from =IMAGE("url")
        var m = String(formulas[ri][cc] || '').match(/=IMAGE\("([^"]+)"\)/i);
        v = m ? m[1] : (typeof v === 'string' ? v : '');
      } else if (v instanceof Date) {
        v = Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
      }
      obj[key] = v;
    }
    return obj;
  }).filter(function (o) {                                      // keep real SKU rows, drop totals + amzn.* SKUs
    var sku = String(o[headers[skuCol]] || '').trim();
    return sku && sku.toUpperCase() !== 'TOTAL' && sku.toLowerCase().indexOf('amzn') !== 0;
  });

  if (!rows.length) {                                           // don't clobber good data with an empty push
    var emsg = 'no SKU rows found in "' + invTab + '" (check the tab — rebuild via menu 7/8)';
    if (silent) return { ok: false, label: label, skipped: true, error: emsg };
    ui.alert('No SKU rows found in "' + invTab + '".\nRebuild it (menu 7/8) and retry.');
    return;
  }

  // Add replenishment + monthly-forecast fields (event-excluded) onto each row.
  var ordTab = (pfx === 'CPC') ? 'CPC Orders' : 'Orders';
  ensureEventsTab_(ss);                                          // seed the Events tab if missing
  var enrich = enrichReplenishment_(ss, ordTab, rows, headers);
  var recLabels = enrich.recLabels, monthLabels = enrich.monthLabels;

  var token = getFirestoreToken_();
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  var PAGE = 300;
  var pages = Math.max(1, Math.ceil(rows.length / PAGE));
  for (var p = 0; p < pages; p++) {
    fsWriteDoc_(projectId, token, 'fba_inventory/' + brandKey + '_p' + (p + 1),
      { brand: label, page: p + 1, pages: pages, headers: headers, recLabels: recLabels, monthLabels: monthLabels,
        rows: rows.slice(p * PAGE, (p + 1) * PAGE), updatedAt: stamp });
  }
  // Index doc (no rows) so the dashboard knows how many pages to read.
  fsWriteDoc_(projectId, token, 'fba_inventory/' + brandKey,
    { brand: label, count: rows.length, pages: pages, headers: headers, recLabels: recLabels, monthLabels: monthLabels, updatedAt: stamp });

  if (silent) return { ok: true, label: label, skus: rows.length, pages: pages, brandKey: brandKey };
  ui.alert(label + ' Inventory → Firebase ✅\n\n' + rows.length + ' SKUs written to:\n' +
    '  fba_inventory/' + brandKey + '  (index)\n' +
    '  fba_inventory/' + brandKey + '_p1 … _p' + pages + '\n\n' +
    'Project: ' + projectId + '. Amazon Hub data untouched (only fba_* collections used).');
  return { ok: true, label: label, skus: rows.length, pages: pages, brandKey: brandKey };
}

/* ===================== Sync: Sales Analysis (SKU / Color / Article) → Firebase ===================== */

// Menu entry — both brands, one summary.
function syncSalesAnalysisAll() {
  var ui = SpreadsheetApp.getUi();
  if (!prop_('FIREBASE_PROJECT_ID')) {
    ui.alert('Firebase not configured', 'Run "🔥 Check Firebase connection" first.', ui.ButtonSet.OK); return;
  }
  function runOne(pfx, key, label) {
    try { return syncSalesAnalysis_(pfx, key, label); }
    catch (e) { return { ok: false, label: label, error: String(e.message || e) }; }
  }
  var results = [runOne('SP', 'ridhi', 'Ridhi'), runOne('CPC', 'cpc', 'CPC')];
  var lines = results.map(function (r) {
    return (r && r.ok) ? ('✅ ' + r.label + ': ' + r.skus + ' SKUs · ' + r.colors + ' colors · ' + r.articles + ' articles')
      : ('⚠️ ' + (r ? r.label : '?') + ': ' + ((r && r.error) || 'failed'));
  });
  ui.alert('Sales Analysis → Firebase  (Ridhi + CPC)',
    lines.join('\n\n') + '\n\nProject: ' + prop_('FIREBASE_PROJECT_ID') + '. Amazon Hub data untouched.', ui.ButtonSet.OK);
}

/**
 * Push a brand's monthly Sales Analysis (per SKU, per Color, per Article) to
 * Firestore under fba_sales/<brand> so the dashboard can show Sale History +
 * Color/Article studies. Each row's m[] = per-month {qty, amt, pct} (pct = share of
 * that month's grand total). Months descending (current → 2025-01). MCF + Cancelled
 * excluded (via computeMonthlySales_). Reads Orders + Catalog only.
 */
function syncSalesAnalysis_(pfx, brandKey, label) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var projectId = prop_('FIREBASE_PROJECT_ID');
  if (!projectId) return { ok: false, label: label, error: 'Firebase not configured' };
  var catTab = (pfx === 'CPC') ? 'CPC Catalog' : 'Catalog';
  var ordTab = (pfx === 'CPC') ? 'CPC Orders' : 'Orders';
  ss.toast('Building ' + label + ' Sales Analysis for Firebase…', 'Amazon Report', 15);

  var catalog = readCatalogMap_(ss, catTab);
  var sales = computeMonthlySales_(ss, ordTab);                  // sku -> {YYYY-MM:{qty,amt}}
  if (!Object.keys(sales).length) return { ok: false, label: label, skipped: true, error: 'no orders in "' + ordTab + '"' };
  Object.keys(sales).forEach(function (s) { if (String(s).toLowerCase().indexOf('amzn') === 0) delete sales[s]; });  // drop amzn.* SKUs

  var months = monthRangeDesc_(ORDERS_START_DATE.slice(0, 7), new Date());   // descending
  var grand = {}; months.forEach(function (m) { grand[m] = 0; });
  Object.keys(sales).forEach(function (sku) { var mm = sales[sku]; months.forEach(function (m) { if (mm[m]) grand[m] += mm[m].qty; }); });

  function rowMonths(get) {
    return months.map(function (m) { var qa = get(m) || { qty: 0, amt: 0 }; var t = grand[m] || 0; return { qty: Math.round(qa.qty), amt: Math.round(qa.amt), pct: t ? qa.qty / t : 0 }; });
  }
  function totQ(ms) { var t = 0; ms.forEach(function (x) { t += x.qty; }); return t; }
  // Ranking key = REVENUE ($) of the LAST 2 MONTHS. months[] is descending so [0]=current month,
  // [1]=previous month → this window auto-advances every month (rolling, never frozen).
  function last2Rev(ms) { return (ms[0] ? ms[0].amt : 0) + (ms[1] ? ms[1].amt : 0); }

  // SKU rows.
  var skuSet = {};
  Object.keys(sales).forEach(function (s) { skuSet[s] = 1; });
  Object.keys(catalog).forEach(function (s) { skuSet[s] = 1; });
  var skuRows = Object.keys(skuSet).filter(function (s) { return String(s).toLowerCase().indexOf('amzn') !== 0; }).map(function (sku) {
    var c = catalog[sku] || {}, mm = sales[sku] || {};
    var ms = rowMonths(function (m) { return mm[m]; });
    return { name: sku, asin: c.asin || '', subcat: c.subcat || '', color: c.color || '', size: c.size || '', m: ms, _r2: last2Rev(ms) };
  }).sort(function (a, b) { return b._r2 - a._r2; });   // rank by last-2-months revenue

  // Color / Article aggregates.
  function aggBy(dimOf) {
    var agg = {};
    Object.keys(sales).forEach(function (sku) {
      var c = catalog[sku] || {}, key = String(dimOf(c) || '').trim() || '(unknown)';
      var a = (agg[key] = agg[key] || { skus: {}, mm: {} }); a.skus[sku] = 1;
      var mm = sales[sku]; Object.keys(mm).forEach(function (m) { var b = (a.mm[m] = a.mm[m] || { qty: 0, amt: 0 }); b.qty += mm[m].qty; b.amt += mm[m].amt; });
    });
    return Object.keys(agg).map(function (key) {
      var a = agg[key], ms = rowMonths(function (m) { return a.mm[m]; });
      return { name: key, skus: Object.keys(a.skus).length, m: ms, _r2: last2Rev(ms) };
    }).sort(function (x, y) { return y._r2 - x._r2; });   // rank by last-2-months revenue
  }
  var colorRows = aggBy(function (c) { return c.color; });
  var artRows = aggBy(function (c) { return c.subcat; });
  [skuRows, colorRows, artRows].forEach(function (rs) { rs.forEach(function (r) { delete r._r2; }); });

  var tz = ss.getSpreadsheetTimeZone();
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  var MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var monthLabels = months.map(function (m) { var p = m.split('-'); return MON[Number(p[1])] + " '" + p[0].slice(2); });

  var token = getFirestoreToken_();
  var PAGE = 250, skuPages = Math.max(1, Math.ceil(skuRows.length / PAGE));
  for (var p = 0; p < skuPages; p++) {
    fsWriteDoc_(projectId, token, 'fba_sales/' + brandKey + '_sku_p' + (p + 1), { rows: skuRows.slice(p * PAGE, (p + 1) * PAGE), updatedAt: stamp });
  }
  fsWriteDoc_(projectId, token, 'fba_sales/' + brandKey + '_color', { rows: colorRows, updatedAt: stamp });
  fsWriteDoc_(projectId, token, 'fba_sales/' + brandKey + '_article', { rows: artRows, updatedAt: stamp });
  fsWriteDoc_(projectId, token, 'fba_sales/' + brandKey,
    { brand: label, months: months, monthLabels: monthLabels, skuPages: skuPages,
      skus: skuRows.length, colors: colorRows.length, articles: artRows.length, updatedAt: stamp });

  return { ok: true, label: label, skus: skuRows.length, colors: colorRows.length, articles: artRows.length };
}

/* ============================================================================
 * REPLENISHMENT WEB APP endpoint (for the FBA Replenishment app)
 *
 * A tiny, read-only web app served by THIS bound script. The app hits it with a
 * refresh and gets the current Inventory tab live — including the Air/Sea plan,
 * because those columns already live in the tab. No Firebase, no fabricrush,
 * no separate backend: the app reads the sheet the moment you press refresh.
 *
 * Setup (once):
 *   1) clasp push (as usual)
 *   2) run setupReplKey once from the editor → copy the logged key
 *   3) Deploy → New deployment → Web app → Execute as ME · Access ANYONE → copy /exec URL
 *   4) In the app's Firestore config/replapi put { url: <exec URL>, key: <the key> }
 *
 * It reads BOTH brands via openById, so ONE deployment (on the Ridhi main script)
 * serves both. "Live" = the tab's current contents (as fresh as the last build);
 * it does NOT re-pull Amazon synchronously (that would be slow and hang-prone).
 * ==========================================================================*/

/* ===================== PRIME DAY — HOURLY SALES + TEAMS (Ravi, 2026-10-06) =====================
 * "last year ke prime day and abhi jo prime day chal rha h … comparison chart (hourly and day wise) and live hourly teams me
 * message bhejna h". Amazon's Sales API (getOrderMetrics) answers per hour for any window — this year live, last year from
 * history — for each brand with its own credentials. Nothing is stored; every call asks Amazon.
 *   ?repl=metrics&brand=SP|CPC&start=<ISO>&end=<ISO>&gran=Hour|Day   → { ok, rows:[{t, orders, units, items, sales}] }
 *   ?repl=primeSetup&hook=<Teams Workflows webhook URL>              → stores the hook, installs the hourly trigger
 *   ?repl=primeTest                                                  → posts one message now
 *   ?repl=primeStop                                                  → removes the hourly trigger
 * The hourly post runs only on the event days in PRIME_DAYS; after the sale it does nothing until it is stopped. */
var PRIME_DAYS = { '2026-10-06': { ly: '2025-10-07', label: 'Day 1' }, '2026-10-07': { ly: '2025-10-08', label: 'Day 2' } };
var PRIME_TZ = 'America/Los_Angeles';

function orderMetrics_(brand, startIso, endIso, gran) {
  ACTIVE_PREFIX = replBrandKey_(brand);
  var path = '/sales/v1/orderMetrics?marketplaceIds=' + marketplaceId_()
    + '&interval=' + encodeURIComponent(startIso + '--' + endIso)
    + '&granularity=' + encodeURIComponent(gran || 'Hour')
    + '&granularityTimeZone=' + encodeURIComponent('US/Pacific');
  var res = spGet_(path);
  return (res.payload || []).map(function (x) {
    return { t: String(x.interval || '').split('--')[0], orders: x.orderCount || 0, units: x.unitCount || 0,
      items: x.orderItemCount || 0, sales: x.totalSales ? Number(x.totalSales.amount) || 0 : 0 };
  });
}

/** "2026-10-06" at hh:00 Pacific, as an ISO string with the right offset for that day. */
function primeIso_(day, hh) {
  var off = Utilities.formatDate(new Date(day + 'T12:00:00Z'), PRIME_TZ, 'Z');
  return day + 'T' + (hh < 10 ? '0' : '') + hh + ':00:00' + off.slice(0, 3) + ':' + off.slice(3);
}

/** One brand: this year's day so far by hour, and last year's matching day by hour. */
function primeBrand_(brand, day, ly, hourNow) {
  var d0 = new Date(primeIso_(day, 0)).getTime(), l0 = new Date(primeIso_(ly, 0)).getTime();
  var now = orderMetrics_(brand, primeIso_(day, 0), new Date(Math.min(Date.now(), d0 + 864e5)).toISOString(), 'Hour');
  var last = orderMetrics_(brand, primeIso_(ly, 0), new Date(l0 + 864e5).toISOString(), 'Hour');
  var sum = function (rows, upto) { var o = { orders: 0, units: 0, sales: 0 }; rows.forEach(function (r, i) { if (upto == null || i <= upto) { o.orders += r.orders; o.units += r.units; o.sales += r.sales; } }); return o; };
  return { now: now, last: last, todayTot: sum(now, hourNow), lySame: sum(last, hourNow), lyDay: sum(last), lastHour: now[hourNow] || null, lyHour: last[hourNow] || null };
}

function primeMoney_(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
function primePct_(a, b) { if (!b) return '—'; var p = Math.round((a / b - 1) * 100); return (p >= 0 ? '+' : '') + p + '%'; }

function primeMessage_(force) {
  var nowD = new Date();
  var day = Utilities.formatDate(nowD, PRIME_TZ, 'yyyy-MM-dd');
  var ev = PRIME_DAYS[day];
  if (!ev && !force) return null;
  if (!ev) { var k = Object.keys(PRIME_DAYS)[0]; ev = PRIME_DAYS[k]; day = k; }
  /* The hour that just finished — a message at 10:05 reports through 9:59. */
  var hourNow = Math.max(0, Number(Utilities.formatDate(nowD, PRIME_TZ, 'H')) - 1);
  var facts = [], tot = { t: 0, ly: 0, lyDay: 0, o: 0, lyo: 0 };
  ['SP', 'CPC'].forEach(function (b) {
    try {
      var r = primeBrand_(b, day, ev.ly, hourNow), name = b === 'CPC' ? 'CPC' : 'Ridhi';
      tot.t += r.todayTot.sales; tot.ly += r.lySame.sales; tot.lyDay += r.lyDay.sales; tot.o += r.todayTot.orders; tot.lyo += r.lySame.orders;
      facts.push({ title: name + ' — so far', value: primeMoney_(r.todayTot.sales) + ' · ' + r.todayTot.orders + ' orders  (' + primePct_(r.todayTot.sales, r.lySame.sales) + ' vs last year same time)' });
      if (r.lastHour) facts.push({ title: name + ' — ' + hourNow + ':00 hour', value: primeMoney_(r.lastHour.sales) + ' · ' + r.lastHour.orders + ' orders  (last year ' + primeMoney_(r.lyHour ? r.lyHour.sales : 0) + ')' });
    } catch (e) { facts.push({ title: (b === 'CPC' ? 'CPC' : 'Ridhi'), value: 'could not read: ' + String(e.message || e).slice(0, 120) }); }
  });
  var head = 'Prime Big Deal Days ' + ev.label + ' — through ' + ((hourNow % 12) || 12) + ':59 ' + (hourNow < 12 ? 'AM' : 'PM') + ' PT';
  var card = {
    type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.4',
    body: [
      { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: head, wrap: true },
      { type: 'TextBlock', text: 'Both brands: **' + primeMoney_(tot.t) + '** · ' + tot.o + ' orders — ' + primePct_(tot.t, tot.ly)
        + ' vs ' + ev.ly + ' at the same hour (' + primeMoney_(tot.ly) + '). Last year\'s whole ' + ev.label + ': ' + primeMoney_(tot.lyDay) + '.', wrap: true },
      { type: 'FactSet', facts: facts },
      { type: 'TextBlock', isSubtle: true, size: 'Small', wrap: true, text: 'Amazon.com, Pacific time, from Amazon\'s Sales API. Sent every hour by the Replenishment backend.' },
    ],
  };
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }] };
}

/** The hourly trigger's job. */
function primeHourlyPost() {
  var hook = prop_('TEAMS_WEBHOOK');
  if (!hook) return;
  var msg = primeMessage_(false);
  if (!msg) return;
  UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', payload: JSON.stringify(msg), muteHttpExceptions: true });
}

function primeStop_() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { var f = t.getHandlerFunction(); if (f === 'primeHourlyPost' || f === 'primeHourly') { ScriptApp.deleteTrigger(t); n++; } });
  return n;
}
function primeSetup_(hook) {
  if (hook) {
    if (!/^https:\/\/[^\s]+$/.test(hook)) return { ok: false, error: 'That does not look like a webhook URL.' };
    PropertiesService.getScriptProperties().setProperty('TEAMS_WEBHOOK', hook);
  }
  if (!prop_('TEAMS_WEBHOOK')) return { ok: false, error: 'No Teams webhook stored yet — pass hook=<URL>.' };
  primeStop_();
  /* One hourly job does both: the dashboard's data and the Teams message. */
  ScriptApp.newTrigger('primeHourly').timeBased().everyMinutes(15).create();
  return { ok: true, trigger: 'primeHourly every 15 minutes (dashboard data; Teams hourly)', days: Object.keys(PRIME_DAYS) };
}
function primeTest_() {
  var hook = prop_('TEAMS_WEBHOOK');
  var msg = primeMessage_(true);
  if (!hook) return { ok: true, posted: false, message: msg };
  var r = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', payload: JSON.stringify(msg), muteHttpExceptions: true });
  return { ok: r.getResponseCode() < 300, status: r.getResponseCode(), body: r.getContentText().slice(0, 300), message: msg };
}

/* ---- THE DASHBOARD'S DATA, IN THE CLOUD (Ravi, 2026-10-06: "mera system abhi band ho jayega … hourly update hota rhe") ----
 * Every hour this trigger asks Amazon for both brands (today by hour, last year's two sale days, an ordinary week, day totals)
 * and writes the whole set as JSON into one Google Sheet. The Prime Day dashboard reads that sheet through the viewer's Google
 * Drive connector, so nothing depends on anybody's computer being on. The same run posts to Teams when a webhook is stored. */
function primeBuildData_() {
  var nowIso = new Date().toISOString();
  var day = Utilities.formatDate(new Date(), PRIME_TZ, 'yyyy-MM-dd');
  var brands = {};
  ['SP', 'CPC'].forEach(function (b) {
    var x = {};
    try { x.now = orderMetrics_(b, primeIso_(day, 0), nowIso, 'Hour'); } catch (e) { x.now = []; x.err = String(e.message || e).slice(0, 200); }
    var cache = CacheService.getScriptCache(), ck = 'prime_static_v1_' + b, hit = cache.get(ck);
    var st = hit ? JSON.parse(hit) : null;
    if (!st) {
      st = {
        ly: orderMetrics_(b, '2025-10-07T00:00:00-07:00', '2025-10-09T00:00:00-07:00', 'Hour'),
        base: orderMetrics_(b, '2026-09-29T00:00:00-07:00', '2026-10-04T00:00:00-07:00', 'Hour'),
        d25: orderMetrics_(b, '2025-09-30T00:00:00-07:00', '2025-10-13T00:00:00-07:00', 'Day'),
      };
      try { cache.put(ck, JSON.stringify(st), 6 * 3600); } catch (e) { /* over 100 KB: just asked again next hour */ }
    }
    x.ly = st.ly; x.base = st.base; x.d25 = st.d25;
    try { x.d26 = orderMetrics_(b, '2026-09-29T00:00:00-07:00', nowIso, 'Day'); } catch (e) { x.d26 = []; }
    brands[b] = x;
  });
  return { asOf: nowIso, brands: brands };
}
function primeSheet_() {
  var id = prop_('PRIME_SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* made again below */ } }
  var ss = SpreadsheetApp.create('Prime Day live data (dashboard)');
  PropertiesService.getScriptProperties().setProperty('PRIME_SHEET_ID', ss.getId());
  return ss;
}
/** The JSON goes in column A, 40,000 characters a cell (a cell holds 50,000). Row 1 says when. */
function primeWrite_(data) {
  var ss = primeSheet_(), sh = ss.getSheets()[0];
  var s = JSON.stringify(data), parts = [];
  for (var i = 0; i < s.length; i += 40000) parts.push([s.slice(i, i + 40000)]);
  sh.clear();
  sh.getRange(1, 1).setValue('asOf ' + data.asOf + ' · parts ' + parts.length);
  if (parts.length) sh.getRange(2, 1, parts.length, 1).setValues(parts);
  SpreadsheetApp.flush();
  return { id: ss.getId(), parts: parts.length, chars: s.length };
}
/** The hourly trigger: the dashboard's data, then the Teams message. Stops itself once the sale is two days gone. */
function primeHourly() {
  var day = Utilities.formatDate(new Date(), PRIME_TZ, 'yyyy-MM-dd');
  if (day > '2026-10-09') { primeStop_(); return; }
  try { primeWrite_(primeBuildData_()); } catch (e) { console.error('prime data: ' + (e.message || e)); }
  /* Data every 15 minutes (Ravi, 6 Oct); Teams once an hour — the first run in each Pacific hour posts. */
  var hk = Utilities.formatDate(new Date(), PRIME_TZ, 'yyyy-MM-dd HH');
  if (prop_('PRIME_TEAMS_HOUR') !== hk) {
    try { primeHourlyPost(); PropertiesService.getScriptProperties().setProperty('PRIME_TEAMS_HOUR', hk); } catch (e) { console.error('prime teams: ' + (e.message || e)); }
  }
}
function primeLiveSetup_() {
  primeStop_();
  ScriptApp.newTrigger('primeHourly').timeBased().everyMinutes(15).create();
  var w = primeWrite_(primeBuildData_());
  return { ok: true, sheet: w.id, parts: w.parts, chars: w.chars, trigger: 'primeHourly every 15 minutes', teams: !!prop_('TEAMS_WEBHOOK') };
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    var key = prop_('REPL_API_KEY');
    if (!key) return replJson_({ ok: false, error: 'REPL_API_KEY is not set. Run setupReplKey once.' });
    if (String(p.key || '').trim() !== key) return replJson_({ ok: false, error: 'Unauthorized.' });
    if (p.ping) return replJson_({ ok: true, pong: true });
    if (p.repl === 'one') {   // single-SKU probe with projection internals (debugging "why this number")
      var d1 = replReadInv_(p.brand, p.sku);
      var row = (d1.rows || []).filter(function (x) { return String(x.sku).toUpperCase() === String(p.sku || '').toUpperCase(); })[0];
      return replJson_({ ok: true, row: row || null });
    }
    if (p.repl === 'histbuild') return replJson_(replHistBuild_(p.brand));
    if (p.repl === 'meta') return replJson_(replPagedMeta_(p.brand, p.fresh));
    if (p.repl === 'page') return replPagedRead_(p.brand, p.token, p.kind, p.from, p.to);
    if (p.repl === 'list') return replJson_(replReadInv_(p.brand));
    if (p.repl === 'metrics') return replJson_({ ok: true, rows: orderMetrics_(p.brand, p.start, p.end, p.gran) });
    if (p.repl === 'primeSetup') return replJson_(primeSetup_(p.hook));
    if (p.repl === 'primeTest') return replJson_(primeTest_());
    if (p.repl === 'primeStop') return replJson_({ ok: true, removed: primeStop_() });
    if (p.repl === 'primeLiveSetup') return replJson_(primeLiveSetup_());
    return replJson_({ ok: false, error: 'Unknown request.' });
  } catch (err) {
    return replJson_({ ok: false, error: String(err && err.message || err).slice(0, 300) });
  }
}

function replJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---- THE INVENTORY READ, IN SMALL PIECES ----
 *
 * `repl=list` answers with the whole brand in one response: a minute of work and several MB of JSON.
 * Google hands a web app's answer back through a one-time link, and on 2026-09-15 that link was lost
 * on EVERY CPC read (39–70 s, Drive's "Page not found" instead of the data) — and asking again only
 * started another minute-long read on top of the first.
 *
 * So the read is split in two:
 *   repl=meta  builds the brand ONCE and parks the result in the script cache, in pieces under 100 KB.
 *              If Google loses this answer the work is not lost: the next `meta` finds it finished.
 *              While a build is running, `meta` says so instead of starting another one.
 *   repl=page  hands back a few pieces at a time — a second or two, a few hundred KB — so a lost one
 *              is simply asked for again.
 * `repl=list` stays exactly as it was, for anything still calling it.
 */
var REPL_PIECE_CHARS = 90000;          // the script cache refuses a value over 100 KB
var REPL_CACHE_SECS = 6 * 3600;        // the longest the cache keeps anything
var REPL_BUILD_MAX_MS = 6 * 60 * 1000; // a web-app run cannot last longer than this

function replBrandKey_(brand) { return String(brand || '').toUpperCase() === 'CPC' ? 'CPC' : 'SP'; }

/** Split a list of JSON strings into cache pieces, each a JSON array under the size limit. */
function replPieces_(items) {
  var out = [], buf = [], len = 2;
  items.forEach(function (s) {
    if (buf.length && len + s.length + 1 > REPL_PIECE_CHARS) { out.push('[' + buf.join(',') + ']'); buf = []; len = 2; }
    buf.push(s); len += s.length + 1;
  });
  if (buf.length || !out.length) out.push('[' + buf.join(',') + ']');
  return out;
}
/** A long string cut into pieces under the size limit. */
function replSlices_(text) {
  var out = [];
  for (var i = 0; i < text.length; i += REPL_PIECE_CHARS) out.push(text.slice(i, i + REPL_PIECE_CHARS));
  return out.length ? out : [''];
}

/**
 * The brand's read, built if it has to be.
 *   fresh=1  somebody pressed Refresh: anything read before now (less two minutes) is too old
 *   fresh=0  a follow-up: take what the last Refresh asked for, if it has finished
 */
function replPagedMeta_(brand, fresh) {
  var b = replBrandKey_(brand);
  var cache = CacheService.getScriptCache();
  var metaKey = 'replm_' + b, bldKey = 'replb_' + b, wantKey = 'replw_' + b;
  var now = Date.now();
  var want;
  if (String(fresh) === '1') { want = now; cache.put(wantKey, String(want), REPL_CACHE_SECS); }
  else want = Number(cache.get(wantKey) || 0);

  var m = null;
  try { m = JSON.parse(cache.get(metaKey) || 'null'); } catch (e) { m = null; }
  if (m && m.ok && Number(m.startedAt) >= want - 2 * 60 * 1000) return m;

  /* ONE BUILD AT A TIME. The user lock is not the one hourlyRefresh holds for minutes on end. */
  var lock = LockService.getUserLock(), locked = false;
  try { locked = lock.tryLock(5000); } catch (e) {}
  try {
    var running = Number(cache.get(bldKey) || 0);
    if (running && now - running < REPL_BUILD_MAX_MS) return { ok: true, building: true, runningFor: Math.round((now - running) / 1000) };
    cache.put(bldKey, String(now), Math.ceil(REPL_BUILD_MAX_MS / 1000));
  } finally { if (locked) lock.releaseLock(); }

  try {
    var startedAt = Date.now();
    var d = replReadInv_(b);
    if (!d || !d.ok) return d || { ok: false, error: 'The inventory read returned nothing.' };
    var token = startedAt + 'r' + Math.floor(Math.random() * 1e6);   // never the same as a read before it
    var rowPieces = replPieces_((d.rows || []).map(function (r) { return JSON.stringify(r); }));
    var extra = {};
    Object.keys(d).forEach(function (k) { if (k !== 'rows') extra[k] = d[k]; });
    var extraPieces = replSlices_(JSON.stringify(extra));

    var puts = {};
    rowPieces.forEach(function (s, i) { puts['replr_' + b + '_' + token + '_' + i] = s; });
    extraPieces.forEach(function (s, i) { puts['replx_' + b + '_' + token + '_' + i] = s; });
    var names = Object.keys(puts);
    for (var i = 0; i < names.length; i += 40) {
      var part = {};
      names.slice(i, i + 40).forEach(function (k) { part[k] = puts[k]; });
      cache.putAll(part, REPL_CACHE_SECS);
    }
    /* The cache can drop things without saying so. Check every piece is really there before telling
     * anybody it is ready — otherwise the app would fetch a brand with holes in it. */
    var back = cache.getAll(names);
    var missing = names.filter(function (k) { return back[k] == null; }).length;
    if (missing) return { ok: false, cacheFull: true,
      error: 'The script cache would not hold the ' + b + ' read (' + missing + ' of ' + names.length + ' pieces missing).' };

    var meta = { ok: true, brand: b, token: token, startedAt: startedAt, builtAt: Date.now(),
      rowPieces: rowPieces.length, extraPieces: extraPieces.length, n: (d.rows || []).length };
    cache.put(metaKey, JSON.stringify(meta), REPL_CACHE_SECS);
    return meta;
  } finally {
    cache.remove(bldKey);
  }
}

/**
 * Rebuild one brand's year sales history now, from the web app.
 *
 * The daily chain is meant to do this, and on 2026-09-15 the cache it leaves behind was 42 days old
 * (built 4 Aug) — so every SKU's "last sale" looked six weeks old and the year rate stopped at August.
 * This is the same build the menu item runs, one brand per call so each stays well inside a web-app
 * run. It reports the newest sale it found, which says whether the ORDERS LOG itself is current.
 */
function replHistBuild_(brand) {
  var b = replBrandKey_(brand), t0 = Date.now();
  var m = buildHistCache_(b);
  var newest = 0;
  Object.keys(m).forEach(function (k) { if (m[k].lastMs > newest) newest = m[k].lastMs; });
  return { ok: !HIST_DIAG.err, error: HIST_DIAG.err || undefined, brand: b, skus: Object.keys(m).length,
    secs: Math.round((Date.now() - t0) / 1000), rows: HIST_DIAG.scanned, tab: HIST_DIAG.tab,
    newestSale: newest ? new Date(newest).toISOString() : '' };
}

/** Pieces `from` to `to` (not including `to`) of one finished read. kind 'r' = rows, 'x' = the rest. */
function replPagedRead_(brand, token, kind, from, to) {
  var b = replBrandKey_(brand);
  var k = kind === 'x' ? 'replx_' : 'replr_';
  var a = Math.max(0, parseInt(from, 10) || 0), z = Math.max(a + 1, parseInt(to, 10) || a + 1);
  var names = [];
  for (var i = a; i < z; i++) names.push(k + b + '_' + String(token || '') + '_' + i);
  var got = CacheService.getScriptCache().getAll(names);
  var parts = names.map(function (n) { return got[n]; });
  if (parts.some(function (p) { return p == null; })) {
    return replJson_({ ok: false, expired: true, error: 'That read is no longer in the cache. Refresh again.' });
  }
  if (kind === 'x') return replJson_({ ok: true, text: parts.join('') });
  /* Rows are passed through as the text they were stored as — no parsing and re-writing a few
   * hundred KB just to wrap it. */
  var body = parts.map(function (p) { return p.slice(1, -1); }).filter(function (p) { return p.length; }).join(',');
  return ContentService.createTextOutput('{"ok":true,"rows":[' + body + ']}').setMimeType(ContentService.MimeType.JSON);
}

// Sub-categories that are listed on Amazon but NOT stocked in India — the app suppresses their forecast
// (treated like an India "Discontinue" status). Anchored to the whole cell so "Women"/"Dresses" match
// exactly, not as substrings of some other sub-category. Add more alternatives here as needed.
var REPL_STOP_SUBCATS = /^\s*(women|dress(es)?)\s*$/i;

/** A monthly "Rec." column label ("Aug '26 Rec.") → "YYYY-MM", or null if it doesn't parse. */
function replRecYM_(label) {
  var m = String(label).match(/([A-Za-z]{3})\s*'?(\d{2})/);
  if (!m) return null;
  var ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var mi = ABBR.indexOf(m[1].toLowerCase());
  if (mi < 0) return null;
  return (2000 + parseInt(m[2], 10)) + '-' + (mi + 1 < 10 ? '0' : '') + (mi + 1);
}

/** Whole days from today to the 1st of a "YYYY-MM" month (negative if already past). */
function replDaysToMonth_(ym, nowMs) {
  var p = ym.split('-');
  return Math.round((Date.UTC(Number(p[0]), Number(p[1]) - 1, 1) - nowMs) / 86400000);
}

/**
 * Forward-projection shortfall (same maths as computePlan_'s air loop, generalised to any horizon):
 * deplete `immediate` at `ads`/day, add each timed arrival on its own day, and return how many units
 * are needed NOW to keep the on-hand from ever going negative through day `target`. 0 if incoming
 * inventory already covers it. This is what nets "stock already on the way" out of every lane.
 */
function replProjShort_(immediate, ads, arrivals, target) {
  if (!(ads > 0)) return 0;
  var evts = (arrivals || []).filter(function (x) { return x.day > 0 && x.day <= target; })
                             .sort(function (a, b) { return a.day - b.day; });
  var onHand = immediate, day = 0, minOnHand = immediate;
  for (var k = 0; k < evts.length; k++) {
    onHand -= ads * (evts[k].day - day);
    if (onHand < minOnHand) minOnHand = onHand;
    onHand += evts[k].qty;
    day = evts[k].day;
  }
  onHand -= ads * (target - day);
  if (onHand < minOnHand) minOnHand = onHand;
  return minOnHand < 0 ? Math.round(-minOnHand) : 0;
}

/** Read one brand's Inventory tab live and return replenishment rows.
 *  debugSku (optional): stash the projection internals on that one row's `_dbg` for the ?repl=one probe. */
function replReadInv_(brand, debugSku) {
  var isCpc = (brand === 'CPC');
  var dbgSku = debugSku ? String(debugSku).trim().toUpperCase() : '';
  var id = isCpc ? CPC_SHEET_ID : RIDHI_SHEET_ID;
  var tabName = isCpc ? 'CPC Inventory' : TAB.INVENTORY;   // 'Inventory' for Ridhi
  var ss, sh;
  try { ss = SpreadsheetApp.openById(id); sh = ss.getSheetByName(tabName); }
  catch (e2) { return { ok: false, error: 'Cannot open ' + tabName + ': ' + (e2.message || e2) }; }
  if (!sh) return { ok: false, error: 'Tab "' + tabName + '" not found.' };

  // India listing status per SKU (Listed / Discontinue / Need Listing / Use In Mix). Discontinue and
  // Use In Mix = the SKU is stopped, so no future inventory should be projected for it.
  var statusMap = {};
  try {
    statusMap = readIndiaStatus_(ss, 'India Stock');
    if (isCpc && !Object.keys(statusMap).length) statusMap = readIndiaStatus_(ss, 'CPC India Stock');
  } catch (eS) {}

  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 3) return { ok: true, brand: brand, rows: [], count: 0 };

  // Row 1 = headers (fall back to row 2 for split-header CPC builds), row 2 = totals (skip), row 3+ = data.
  var hdr2 = sh.getRange(1, 1, 2, lastCol).getValues();
  function isHdr_(x) { var s = String(x == null ? '' : x).trim(); return !!s && isNaN(Number(s)); }
  var headers = [];
  for (var c = 0; c < lastCol; c++) {
    headers.push(isHdr_(hdr2[0][c]) ? String(hdr2[0][c]).trim() : isHdr_(hdr2[1][c]) ? String(hdr2[1][c]).trim() : ('col' + (c + 1)));
  }
  var idx = {};
  headers.forEach(function (h, i) { if (h) idx[h.toLowerCase()] = i; });

  var vals = sh.getRange(3, 1, lastRow - 2, lastCol).getValues();
  var forms = sh.getRange(3, 1, lastRow - 2, lastCol).getFormulas();
  var imgCol = idx['image'];

  function get(row, names) {
    for (var i = 0; i < names.length; i++) { var k = names[i].toLowerCase(); if (idx[k] !== undefined) return row[idx[k]]; }
    return '';
  }
  function n(v) { var f = parseFloat(String(v).replace(/[, ]/g, '')); return isNaN(f) ? 0 : f; }

  // Monthly "… Rec." columns are dynamic (Jul '26 Rec., Aug '26 Rec. …) — read them by pattern so
  // the app mirrors whatever the sheet currently has, no month is ever hard-coded.
  var recCols = headers.filter(function (h) { return /rec\.?\s*$/i.test(String(h).trim()) && !/^rec/i.test(String(h).trim()); });

  var out = [];
  vals.forEach(function (row, r) {
    var sku = String(get(row, ['sku'])).trim();
    if (!sku || sku.toUpperCase() === 'TOTAL' || sku.toLowerCase().indexOf('amzn') === 0) return;
    var img = '';
    if (imgCol !== undefined) { var m = String(forms[r][imgCol] || '').match(/"([^"]+)"/); img = m ? m[1] : ''; }
    var rec = {};
    recCols.forEach(function (h) { rec[h] = n(row[idx[h.toLowerCase()]]); });
    var status = statusMap[sku.toUpperCase()] || '';
    var subcatV = String(get(row, ['sub-category', 'sub category'])).trim();
    // Two sub-categories are listed on Amazon but NOT stocked in India → treat as discontinued (no
    // forecast), same as the India "Discontinue / Use In Mix" statuses. Edit REPL_STOP_SUBCATS to add more.
    var stopStatus = /discontinu|use ?in ?mix/i.test(status);
    var stopSub = REPL_STOP_SUBCATS.test(subcatV);
    var stopReason = stopStatus ? ('India status "' + status + '"')
                   : stopSub ? ('"' + subcatV + '" is listed on Amazon but not stocked in India')
                   : '';
    out.push({
      sku: sku, image: img,
      status: status || (stopSub ? 'Discontinued' : ''), stopped: stopStatus || stopSub, stopReason: stopReason,
      asin: String(get(row, ['asin'])).trim(), parent: String(get(row, ['parent asin'])).trim(),
      color: String(get(row, ['color'])).trim(), size: String(get(row, ['size'])).trim(),
      subcat: subcatV,
      totalStock: n(get(row, ['total stock'])), warehouse: n(get(row, ['warehouse'])),
      fulfillable: n(get(row, ['fulfillable'])),
      unsellable: n(get(row, ['unsellable'])), resOrders: n(get(row, ['reserved_orders', 'reserved orders'])),
      inbReceiving: n(get(row, ['inbound_receiving', 'inbound receiving', 'inb-recv', 'inb recv'])),
      awdAvail: n(get(row, ['awd available'])), awdTransit: n(get(row, ['awd transit'])),
      rec: rec,
      last30: n(get(row, ['last 30 days'])), last90: n(get(row, ['last 90 days'])),
      l90amt: n(get(row, ['last 90 days $'])),
      airDos: n(get(row, ['air dos'])), airQty: n(get(row, ['air qty'])), airIndia: n(get(row, ['air ← india', 'air india'])),
      seaDos: n(get(row, ['sea dos'])), seaQty: n(get(row, ['sea qty'])), seaIndia: n(get(row, ['sea ← india', 'sea india'])),
    });
  });
  // ABC/D category by MONTHLY REVENUE = the HIGHER of the last-30-days revenue and the 90-day monthly
  // average (not a flat L90$÷3), so a recent surge isn't diluted. The sheet stores only "Last 90 Days $",
  // so the 30-day revenue is L30 units × the average selling price (L90$ ÷ L90 units).
  //   monthlyAmt = max( L30 × (L90$/L90) ,  L90$ / 3 )
  //   A  ≥ 3000 · B 1500–3000 · C < 1500 (still sold in 90d) · D no sale in L30 AND L90 (365d avg)
  // The category also decides which average feeds Avg/day (A/B → max(L30/30,L90/90); C → L90/90).
  var hist = replHistAds_(isCpc ? 'CPC' : 'SP');
  var nowMs = Date.now();
  /* HOW CURRENT IS THE HISTORY? Its newest sale, across every SKU, is where the orders log ends. If
   * that is more than three days back, a SKU's "last sale" in it is not its real last sale — the log
   * simply stops — so the days-since-last-sale figure is not used (see the out-of-stock rule). */
  var histEnd = 0;
  Object.keys(hist).forEach(function (k) { if (hist[k] && hist[k].lastMs > histEnd) histEnd = hist[k].lastMs; });
  var histCurrent = histEnd > 0 && (nowMs - histEnd) <= 3 * 86400000;
  if (HIST_DIAG) { HIST_DIAG.histEnd = histEnd ? new Date(histEnd).toISOString() : ''; HIST_DIAG.histCurrent = histCurrent; }
  var repTz = ss.getSpreadsheetTimeZone();
  var curYM = Utilities.formatDate(new Date(), repTz, 'yyyy-MM');
  // Real per-shipment AWD-transit ETAs (STAR-* rows in the Shipments tab) so the air projection credits
  // that inbound stock on its ACTUAL arrival day, not a flat 80 — the same source computePlan_ uses.
  var AWD_FALLBACK_DAYS = 80;
  var awdArr = {};
  try { awdArr = readAwdTransitArrivals_(ss, isCpc ? 'CPC Shipments' : 'Shipments', AWD_FALLBACK_DAYS); } catch (eA) {}
  out.forEach(function (o) {
    var ads30 = (o.last30 || 0) / 30, ads90 = (o.last90 || 0) / 90;
    // Monthly revenue = higher of the last-30-days revenue and the 90-day monthly average. L30 has no $
    // column, so estimate it as L30 units × avg selling price (L90$ / L90 units).
    var price = (o.last90 || 0) > 0 ? (o.l90amt || 0) / o.last90 : 0;
    var amt30 = (o.last30 || 0) * price;                  // estimated last-30-days revenue
    var amt90 = (o.l90amt || 0) / 3;                      // 90-day monthly-average revenue
    var monthlyAmt = Math.max(amt30, amt90);
    var cat, a;
    var H = hist[o.sku] || { flat: 0, recon: 0, months: 0 };
    o.avgHist = false; o.oosLong = false;
    // No sale at all in 90 days → fall back to the yearly history, reconstructed from the months the
    // SKU actually sold in (a SKU that sold in 3 of 12 months averages over those 3, not over 365 days).
    if (ads30 <= 0 && ads90 <= 0) { cat = 'D'; a = Math.max(H.recon, H.flat); o.avgHist = true; }
    else if (monthlyAmt >= 3000) { cat = 'A'; a = Math.max(ads30, ads90); }
    else if (monthlyAmt >= 1500) { cat = 'B'; a = Math.max(ads30, ads90); }
    else { cat = 'C'; a = ads90; }
    // ---- OUT-OF-STOCK correction: rate the SKU by when it COULD sell ----
    // L30/L90 divide by calendar days. A SKU that ran out had nothing to sell for the rest of the window,
    // so those averages measure the STOCKOUT, not demand — and the reorder ladder then plans to the wrong
    // number, which is how a good seller stays dead.
    //
    // Ravi, 2026-09-15: "SKUs that were out of stock for a long time — look at their velocity over the
    // whole year, or whatever period they sold in, and decide from that."
    //
    //   LONG out of stock  = out of stock now AND nothing sold in the last 30 days.
    //       rate = last 365 days' units ÷ (months it actually sold in × 30.4)      (H.recon)
    //       It REPLACES the category figure: the 30/90-day numbers are the stockout talking.
    //       A SKU with no year history keeps the category figure — there is nothing to rebuild from.
    //
    //   RECENTLY out of stock = out of stock now, but it sold within the last 30 days.
    //       inStockDays = 90 − days since the last sale (always 60 or more here, so a real sample)
    //       rate = max(category figure, last90 ÷ inStockDays)
    //
    // The old 7-day floor let a SKU out for 83 days be rated on 7 days of sales, which is what produced
    // the huge reorders on thin evidence. The 30-day split removes that case entirely: anything out that
    // long is rated on its year instead.
    var oosNow = !(o.totalStock > 0) && !(o.awdAvail > 0);
    o.inStockDays = null; o.oosYear = false;
    if (oosNow) {
      var daysSince = histCurrent && H.lastMs ? Math.floor((nowMs - H.lastMs) / 86400000) : null;
      var longOut = ads30 <= 0 && (daysSince === null || daysSince >= 30);
      if (longOut) {
        if (H.months > 0 && H.recon > 0) {
          a = H.recon; o.avgHist = true; o.oosLong = true; o.oosYear = true;
          o.yrUnits = Math.round((H.flat || 0) * 365); o.yrMonths = H.months;
          if (daysSince !== null) o.oosDays = daysSince;
        }
      } else if (daysSince !== null && daysSince < 30 && (o.last90 || 0) > 0) {
        var inDays = 90 - daysSince;
        var vel = o.last90 / inDays;
        if (vel > a) { a = vel; o.avgHist = true; o.oosLong = true; o.inStockDays = inDays; o.oosDays = daysSince; }
      }
    }
    o.category = cat;
    o.monthlyAmt = Math.round(monthlyAmt);
    o.avgSale = Math.round(a * 100) / 100;

    // ---- Reorder plan: 90-day KEEP-LEVEL ladder, incoming netted by forward projection ----
    // COVER (which BAND) = NET-SELLABLE pipeline DoS:
    //   (Total Stock + AWD Available + AWD Transit − Unsellable − reserved_orders) ÷ ADS.
    //   < 90   → Air (fill to the 90-day keep-level) + Sea (add 1 month → 120)   · air-excluded ⇒ all Sea → 120
    //   90–120 → Sea  (top up to 120)
    //   120–150→ AWD  (top up to 150)
    //   ≥ 150  → OK   (enough cover)
    // QTY is NOT (target − cover)×ADS flat — it is a forward projection that credits incoming stock
    // (this month's Rec. into "immediate", future Rec. months at their month-start, AWD Transit at ~sea
    // days) so nothing already on the way is re-ordered. s90/s120/s150 = units needed NOW to keep the
    // on-hand from going negative through day 90 / 120 / 150. Each lane = the extra step of that ladder,
    // capped at one month (30×ADS); the Send pill reflects what actually ships (0 ⇒ incoming covers it).
    var pipe = (o.totalStock || 0) + (o.awdAvail || 0) + (o.awdTransit || 0) - (o.unsellable || 0) - (o.resOrders || 0);
    var run = o.avgSale || 0;
    var dos = run > 0 ? pipe / run : null;
    var excluded = /lamp ?shade|quilt|chair ?pad|seat ?cushion|insert/i.test(String(o.subcat || ''));

    // immediate = sellable now/soon (net warehouse + inbound_receiving + THIS month's Rec. + AWD Available);
    // arrivals = future Rec. months (@ month-start) + AWD Transit (@ ~sea days). Mirrors computePlan_.
    var imm = (o.warehouse || 0) + (o.inbReceiving || 0) + (o.awdAvail || 0);
    var arr = [];
    var recThisMonth = 0, futureRec = [];    // for the human-readable Remark narrative
    Object.keys(o.rec || {}).forEach(function (label) {
      var q = o.rec[label]; if (!q) return;
      var ym = replRecYM_(label); if (!ym) return;
      if (ym === curYM) { imm += q; recThisMonth += q; }            // this month's Rec → immediate
      else if (ym > curYM) {                                        // future → timed arrival
        var day = replDaysToMonth_(ym, nowMs);
        arr.push({ day: day, qty: q });
        if (day <= 150) futureRec.push({ l: String(label).replace(/\s*rec\.?\s*$/i, '').trim(), q: q, d: day });
      }
    });
    // AWD Transit → each STAR-* shipment on its REAL remaining-days ETA (soonest first); any units with
    // no shipment row fall back to the flat sea-days estimate. Mirrors computePlan_ exactly.
    var tLeft = o.awdTransit || 0, awdSoonDay = null;
    if (tLeft > 0) {
      (awdArr[o.sku] || []).forEach(function (s) {
        if (tLeft <= 0) return;
        var q = Math.min(s.qty, tLeft);
        arr.push({ day: s.day, qty: q });
        if (awdSoonDay === null) awdSoonDay = s.day;
        tLeft -= q;
      });
      if (tLeft > 0) { arr.push({ day: AWD_FALLBACK_DAYS, qty: tLeft }); if (awdSoonDay === null) awdSoonDay = AWD_FALLBACK_DAYS; }
    }

    var month = Math.round(30 * run);
    var s90 = replProjShort_(imm, run, arr, 90);
    var s120 = replProjShort_(imm, run, arr, 120);
    var s150 = replProjShort_(imm, run, arr, 150);
    var airReq = 0, seaReq = 0, awdReq = 0;
    if (dos !== null && dos < 150) {
      if (dos < 90) {
        if (excluded) { seaReq = s120; }                            // can't fly → all by sea to 120
        else { airReq = s90; seaReq = Math.min(Math.max(0, s120 - s90), month); }  // air→90, sea +1mo→120
      } else if (dos < 120) { seaReq = Math.min(s120, month); }     // sea top-up → 120
      else { awdReq = Math.min(s150, month); }                      // AWD top-up → 150
    }
    // Send pill = what actually ships (a lane is 0 when incoming already covers that step).
    var decision = airReq > 0 && seaReq > 0 ? 'Air+Sea' : airReq > 0 ? 'Air' : seaReq > 0 ? 'Sea' : awdReq > 0 ? 'AWD' : 'OK';

    // AWD → FBA transfer flag: the FBA side alone (warehouse + inbound_receiving) covers < 30 days but
    // AWD Available has units — so the near-term gap should be filled by an AWD→FBA transfer (units are
    // already in the US), not only by shipping from India. (AWD Available is already credited in the
    // air projection's "immediate"; this flag just surfaces the physical transfer to actually do.)
    var fbaSide = (o.warehouse || 0) + (o.inbReceiving || 0);
    o.awdTransfer = (o.awdAvail || 0) > 0 && run > 0 && fbaSide < 30 * run;

    o.coverDos = dos === null ? null : Math.round(dos);
    o.airExcluded = excluded;
    o.decision = decision;
    o.airReq = airReq; o.seaReq = seaReq; o.awdReq = awdReq;
    // Compact incoming summary for the human-readable Remark (narrative is built in the frontend).
    o.inflow = { m: recThisMonth, awd: o.awdTransit || 0, awdDay: awdSoonDay, fut: futureRec };
    if (dbgSku && String(o.sku).toUpperCase() === dbgSku) {
      o._dbg = { ads: run, pipe: pipe, coverDos: o.coverDos, immediate: imm, arrivals: arr,
        s90: s90, s120: s120, s150: s150, month: month, excluded: excluded,
        warehouse: o.warehouse, inbReceiving: o.inbReceiving, awdAvail: o.awdAvail, awdTransit: o.awdTransit,
        thisMonthRec: imm - (o.warehouse || 0) - (o.inbReceiving || 0) - (o.awdAvail || 0), rec: o.rec };
    }
  });

  // EVERY SKU that exists as a listing, from the Catalog tab — NOT just the ones the FBA inventory
  // report returned. buildInventoryForAccount_ starts from /fba/inventory/v1/summaries, which drops a
  // SKU that currently has no inventory record, so "missing from the snapshot" does NOT mean "not on
  // Amazon". The apps use this list to tell a genuinely unknown SKU from a listed-but-out-of-stock one.
  var catalogSkus = [];
  try {
    var catSh = ss.getSheetByName(isCpc ? 'CPC Catalog' : 'Catalog');
    if (catSh && catSh.getLastRow() >= 2) {
      var cv = catSh.getRange(2, 1, catSh.getLastRow() - 1, 1).getValues();   // col A = SKU
      var seenCat = {};
      for (var ci = 0; ci < cv.length; ci++) {
        var cs = String(cv[ci][0] || '').trim().toUpperCase();
        if (cs && !seenCat[cs]) { seenCat[cs] = 1; catalogSkus.push(cs); }
      }
    }
  } catch (eCat) { /* no catalog → the apps fall back to the snapshot alone */ }

  return { ok: true, brand: brand, rows: out, count: out.length, headers: headers, recCols: recCols,
    catalogSkus: catalogSkus,
    statusN: out.filter(function (o) { return o.status; }).length,
    stoppedN: out.filter(function (o) { return o.stopped; }).length,
    histDiag: HIST_DIAG };   // why the year-history lookup did / didn't work — see replHistAds_
}

/**
 * WHOLE-YEAR demand history per SKU from the last 365 days of the Orders tab (MCF + Cancelled excluded).
 * Returns { sku: { flat, recon, months } }:
 *   flat  = total units ÷ 365                      — the plain yearly daily average
 *   recon = total units ÷ (activeMonths × 30.4)    — the RECONSTRUCTED rate: only the months the SKU
 *           actually sold in, so months it spent OUT OF STOCK don't drag the average down. This is the
 *           same reconstruction the Shipment Decider's "True ADS / 365-Day Reconstructed" uses.
 *   months = how many distinct months had a sale (0 ⇒ no history at all)
 * Used for SKUs with no sale in the last 90 days, and to correct long-OOS SKUs whose recent averages
 * understate real demand (see replReadInv_).
 */
var HIST_DIAG = null;   // last replHistAds_ run: why it produced what it did (surfaced in the response)
var HIST_CACHE_MS = 20 * 3600 * 1000;   // rebuild at most once a day

/** Cached history, kept in a hidden tab of THIS spreadsheet. Null when absent.
 *  allowStale: the web app takes whatever is there — a day-old history beats none at all; the daily
 *  chain is what keeps it fresh. Only the builder cares about the age. */
function replHistCacheRead_(pfx, allowStale) {
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('_hist_' + pfx);
    if (!sh || sh.getLastRow() < 2) return null;
    var at = Number(sh.getRange(1, 2).getValue()) || 0;
    if (!at) return null;
    if (!allowStale && (Date.now() - at) > HIST_CACHE_MS) return null;
    HIST_DIAG.ageH = Math.round((Date.now() - at) / 3600000);
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues(), out = {};
    for (var i = 0; i < v.length; i++) {
      var s = String(v[i][0] || '').trim(); if (!s) continue;
      out[s] = { flat: Number(v[i][1]) || 0, recon: Number(v[i][2]) || 0,
                 months: Number(v[i][3]) || 0, lastMs: Number(v[i][4]) || 0 };
    }
    HIST_DIAG.cached = true;
    HIST_DIAG.builtAt = new Date(at).toISOString();
    HIST_DIAG.skus = Object.keys(out).length;
    return out;
  } catch (e) { return null; }
}
function replHistCacheWrite_(pfx, map) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(), name = '_hist_' + pfx;
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); sh.hideSheet(); }
    sh.clear();
    sh.getRange(1, 1, 1, 2).setValues([['built(ms)', Date.now()]]);
    var keys = Object.keys(map);
    if (keys.length) {
      sh.getRange(2, 1, keys.length, 5).setValues(keys.map(function (s) {
        var h = map[s]; return [s, h.flat, h.recon, h.months, h.lastMs];
      }));
    }
  } catch (e) { /* the cache is an optimisation — never fail the pull for it */ }
}

function replHistAds_(pfx) {
  var save = ACTIVE_PREFIX; ACTIVE_PREFIX = pfx;
  var out = {};
  HIST_DIAG = { tab: '', ss: '', lastRow: 0, scanned: 0, kept: 0, skus: 0, err: '', cached: false };
  // ⚠️ The web app NEVER scans the Orders log. Doing so added ~80s to every pull (CPC 9s → 92s) and
  // then blew the request open entirely — the endpoint answered with an HTML error page, which the
  // frontend can only report as "Unexpected token '<'". The scan lives in buildHistCache_(), which
  // runs in the daily refresh chain / from the menu; here we only READ what it left behind.
  var hit = replHistCacheRead_(pfx, true);
  ACTIVE_PREFIX = save;
  if (hit) return hit;
  HIST_DIAG.err = 'no history cache for ' + pfx + ' — run “Rebuild sales-history cache” from the Amazon Report menu (it is also part of the daily refresh).';
  return out;
}

/** Build (or refresh) the cached year-history for a brand. Heavy — never call this from doGet. */
function buildHistCache_(pfx) {
  var save = ACTIVE_PREFIX; ACTIVE_PREFIX = pfx;
  var out = {};
  HIST_DIAG = { tab: '', ss: '', lastRow: 0, scanned: 0, kept: 0, skus: 0, err: '', cached: false };
  try {
    // ⚠️ Do NOT use ordersSS_() here. It resolves the workbook from the ACTIVE spreadsheet's id, and
    // this web app is bound to the RIDHI sheet — so for brand CPC it handed back Ridhi's Orders
    // workbook (which has no "CPC Orders" tab), and CPC's year history came back EMPTY every time.
    // Open the brand's own Orders-Data workbook by id instead, and accept either tab name.
    // openById can fail transiently (Drive hiccup) or permanently (no access). Either way this is an
    // OPTIONAL enrichment — it must degrade to "no history" and never take the whole endpoint down,
    // because a thrown error here makes Apps Script answer the web app with an HTML page instead of
    // JSON, which the frontend can only report as "Unexpected token '<'".
    var ss = null;
    try { ss = SpreadsheetApp.openById(pfx === 'CPC' ? CPC_ORDERS_DATA_ID : RIDHI_ORDERS_DATA_ID); }
    catch (eOpen) { HIST_DIAG.err = 'could not open the ' + pfx + ' Orders workbook: ' + (eOpen && eOpen.message ? eOpen.message : eOpen); }
    if (!ss) { ACTIVE_PREFIX = save; return out; }
    HIST_DIAG.ss = ss.getName();
    var sh = ss.getSheetByName(pfx === 'CPC' ? 'CPC Orders' : 'Orders') || ss.getSheetByName('Orders');
    HIST_DIAG.tab = sh ? sh.getName() : '';
    if (!sh) HIST_DIAG.err = 'no Orders tab in "' + HIST_DIAG.ss + '" — tabs: ' + ss.getSheets().map(function (x) { return x.getName(); }).join(' | ');
    if (sh) HIST_DIAG.lastRow = sh.getLastRow();
    if (sh && sh.getLastRow() >= 2) {
      var lastRow = sh.getLastRow();
      var yearAgo = Date.now() - 365 * 86400000;
      var tz = Session.getScriptTimeZone();
      var total = {}, byMonth = {}, lastMs = {};
      // One big read beats chunking here — splitting it into 20k blocks measured SLOWER (142s vs 92s),
      // because most of this log already falls inside the 365-day window so nothing gets skipped and
      // you just pay the per-call overhead N times.
      var data = sh.getRange(2, 1, lastRow - 1, ORDERS_HEADERS.length).getValues();
      for (var i = 0; i < data.length; i++) {
        var row = data[i];
        var sku = String(row[3] || '').trim();
        if (!sku) continue;
        if (String(row[9] || '').toUpperCase() === 'MCF') continue;
        if (String(row[7] || '').toLowerCase() === 'cancelled') continue;
        var units = Number(row[5]) || 0;
        if (!units) continue;
        var dMs;
        var purch = row[1];
        if (purch instanceof Date && !isNaN(purch.getTime())) dMs = purch.getTime();
        else { var d = new Date(purch); dMs = isNaN(d.getTime()) ? 0 : d.getTime(); }
        if (!dMs || dMs < yearAgo) continue;                 // only the last 365 days
        total[sku] = (total[sku] || 0) + units;
        if (!lastMs[sku] || dMs > lastMs[sku]) lastMs[sku] = dMs;   // most recent day it actually sold
        var mk = Utilities.formatDate(new Date(dMs), tz, 'yyyy-MM');
        if (!byMonth[sku]) byMonth[sku] = {};
        byMonth[sku][mk] = (byMonth[sku][mk] || 0) + units;
      }
      HIST_DIAG.scanned = data.length;
      HIST_DIAG.lastRow = lastRow;
      Object.keys(total).forEach(function (s) {
        var months = byMonth[s] ? Object.keys(byMonth[s]).length : 0;
        out[s] = { flat: total[s] / 365, recon: months > 0 ? total[s] / (months * 30.4) : 0,
                   months: months, lastMs: lastMs[s] || 0 };
      });
      HIST_DIAG.skus = Object.keys(out).length;
      HIST_DIAG.sample = Object.keys(out).slice(0, 3);
      replHistCacheWrite_(pfx, out);      // the web app reads this instead of the log
    }
  } catch (e) { HIST_DIAG.err = String(e && e.message ? e.message : e); }
  ACTIVE_PREFIX = save;
  return out;
}

/** Menu / daily-chain entry point: rebuild the sales-history cache.
 *  ⚠️ ALWAYS builds BOTH brands, not just this sheet's own. The replenishment web app is bound to the
 *  RIDHI sheet, and replHistCacheRead_ reads from getActiveSpreadsheet() — so the app looks for BOTH
 *  _hist_SP and _hist_CPC inside the RIDHI workbook. Building only the sheet's own brand would leave
 *  CPC without a cache forever. buildHistCache_ opens each brand's Orders workbook by id, so a single
 *  run from the Ridhi sheet produces both. RUN THIS ON THE SHEET THE WEB APP IS BOUND TO (Ridhi). */
function rebuildHistCache() {
  var msg = [], here = '';
  try { here = SpreadsheetApp.getActiveSpreadsheet().getName(); } catch (e) {}
  ['SP', 'CPC'].forEach(function (pfx) {
    var t0 = Date.now();
    var m = buildHistCache_(pfx);
    msg.push(pfx + ': ' + Object.keys(m).length + ' SKUs in ' + Math.round((Date.now() - t0) / 1000) + 's'
      + (HIST_DIAG && HIST_DIAG.err ? ' — ' + HIST_DIAG.err : ''));
  });
  var note = 'Written into "' + here + '".\nThe Replenishment web app reads these from the RIDHI workbook,'
    + '\nso run this there if this is not it.';
  Logger.log('rebuildHistCache — ' + msg.join(' · ') + ' — ' + here);
  if (!SILENT_RUN) { try { SpreadsheetApp.getUi().alert('Sales-history cache rebuilt\n\n' + msg.join('\n') + '\n\n' + note); } catch (e) {} }
}

/** One-time: generate the shared key for the replenishment web app. Run from the editor. */
function setupReplKey() {
  var props = PropertiesService.getScriptProperties();
  var k = props.getProperty('REPL_API_KEY');
  if (!k) { k = Utilities.getUuid().replace(/-/g, ''); props.setProperty('REPL_API_KEY', k); }
  Logger.log('REPL_API_KEY = ' + k);
  Logger.log('Put in Firestore config/replapi as { url: <web app /exec URL>, key: "' + k + '" }');
}
