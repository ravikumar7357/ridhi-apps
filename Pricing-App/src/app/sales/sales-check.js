/* ================= SALES · NUMBERS CHECK: the rule book, and the same number compared across screens (21 Nov 2026) =================
 * Screens: Numbers Check (tab 'ncheck', Sales menu → Check & alerts; it comes with the Sales Dashboard — TAB_INHERIT in core/nav.js),
 *   and ONE chip on the Dashboard (under the greeting) and on the Sales Dashboard (top bar): "🔒 Numbers checked ✓ HH:MM" (green) or
 *   "⚠ N differences" (amber). A click opens this screen.
 * Does: changes NO number anywhere. It writes the rules every sales / ads / stock number follows (NC_RULES, the same text as
 *   docs/sales-metrics.md), and compares the same number where two screens show it, with each screen's OWN functions:
 *     Dashboard Sales MTD / YTD (DASH_CALC.sales)        = Sales Dashboard (sdSum)
 *     Dashboard Ad spend, latest week (DASH_CALC.ads)    = PPC & Organic's latest-week card (renderWeeklyKpis' sums)
 *     PPC & Organic sales, last finished week            ≈ Sales Dashboard, the same seven days
 *     Overview ad spend, 13 finished weeks (TREND)       ≈ PPC & Organic, the same weeks
 *     Dashboard "Aged 181+" and storage (DASH_CALC.age)  = Inventory Age (its buckets and totals)
 *     Profit & Margin sales, its weeks (pfWeeks)         ≈ Sales Dashboard, the same days
 *   each for Ridhi, CPC and Both, and "Both = Ridhi + CPC" where a screen adds Both up on its own.
 * Reads ONLY what is loaded or cached, read-only: SD (else this browser's copy, else the nightly cache — never ensureSales' top-up),
 *   Seller Central's totals (tMatchEnsure: the matchBiz / matchAds caches), PPC & Organic's store (WEEKLY, else the Dashboard's own
 *   copy — dashLoadAds), the Ad Console's snapshot (loadTrends), Inventory Age's snapshot (loadAgeCache). NEVER wNightly, tNightly,
 *   an Amazon refresh, AI, or a write anywhere.
 * When: the screen opening, "Check again", and the Dashboard's loads landing (ncSoon, no loading of its own). window.salesCheck() runs
 *   the same checks from the console and prints them as a table.
 * Main functions: salesCheck, ncRun, ensureNcheck, ncRender, ncChipPaint, ncSoon; data NC_RULES, NC_RISKS, NC_TOL. */

/* ---------- THE RULE BOOK: one entry per number. Keep docs/sales-metrics.md in step (tests/sales-metrics-test.js checks it). ---------- */
// Fields: name · line (one plain sentence) · screens · source · formula · day (cut-off) · incl (what is in / out) · brand · round · fresh.
const NC_RULES = [
  { name: 'Sales', line: 'Money customers ordered for, on the US portal day — before refunds, without tax or shipping.',
    screens: 'Sales Dashboard (every card), Dashboard (Sales MTD / YTD, 90-day line)',
    source: 'Nightly cache "daily" (Orders workbooks + Shopify), kept in this browser (sd.daily.v1); the live top-up (daily:recent) overwrites the last 3 days, then the month + 7 days (at most 40). Ridhi / CPC days that Seller Central has published are replaced by its Business Report "Ordered Product Sales" (matchBiz cache).',
    formula: 'sdSum(from, to)[0] = Σ day[0] for from ≤ day ≤ to (inclusive), rounded to the cent after adding.',
    day: 'US Pacific (PT) — the "US portal day", the same as Seller Central. Shopify days are the store\'s own date (created_at), not PT.',
    incl: 'Amazon.com only (other marketplaces dropped, a blank channel kept). Pending counted. Cancelled dropped. MCF dropped. Refunds NOT taken off (ordered sales). Shopify: every order except "voided" (a refunded order still counts), price × quantity, before discounts, no shipping or tax.',
    brand: 'Sales Dashboard toggle: Ridhi (SP) · CPC · Shopify · All (= all three). Dashboard "Both" = Ridhi + CPC — no Shopify.',
    round: 'Cents inside; shown as whole dollars (sdMoney).',
    fresh: 'Nightly; today from the live top-up (re-read when the tab opens, at most every 10 min). Seller Central publishes a day 1–2 days late, so the newest days stay on the workbooks.' },
  { name: 'Units (Quantity)', line: 'Units ordered on the US portal day.',
    screens: 'Sales Dashboard (period table "Quantity", Custom Range)',
    source: 'As Sales: day[1]; Business Report "Units Ordered" where published.', formula: 'Σ day[1] over the range.',
    day: 'PT (Shopify: store date).', incl: 'As Sales.', brand: 'As Sales.', round: 'Whole units (sdNum).', fresh: 'As Sales.' },
  { name: 'Orders (Order items)', line: 'How many orders came in — counted two ways, see the note.',
    screens: 'Sales Dashboard ("Order items" row, Custom Range), Overview ("Order items" row; its KPI card says "Orders")',
    source: 'day[2]: Business Report "Total Order Items" for days Seller Central has published; the workbooks\' count of DISTINCT order ids for the newest days; Shopify counts orders.',
    formula: 'Σ day[2] over the range. Workbook: a new order id = one more (the lines of one order sit together).',
    day: 'PT.', incl: 'As Sales.', brand: 'As Sales.', round: 'Whole numbers.',
    fresh: 'As Sales — so the newest 1–2 days count orders while older days count order items (mixed in one row).' },
  { name: 'Avg $ / item', line: 'Sales ÷ units in the Custom Range.', screens: 'Sales Dashboard (Custom Range)',
    source: 'sdRange over the two dates.', formula: 'sales ÷ units (sum[0] / sum[1]) — per UNIT, though the label says item.',
    day: 'PT.', incl: 'As Sales.', brand: 'The channel on view.', round: '2 decimals ("$12.34"); "—" with no units.', fresh: 'As Sales.' },
  { name: 'Today', line: 'Today so far, on the US portal day — a part day.', screens: 'Sales Dashboard',
    source: 'As Sales.', formula: 'sdSum(today, today); today = sdToday() (PT).', day: 'PT — in India the morning still shows the US day before.',
    incl: 'As Sales.', brand: 'As Sales.', round: 'Whole $.', fresh: 'Live top-up.' },
  { name: 'Yesterday', line: 'The last complete US portal day.', screens: 'Sales Dashboard', source: 'As Sales.',
    formula: 'sdSum(yesterday, yesterday).', day: 'PT.', incl: 'As Sales.', brand: 'As Sales.', round: 'Whole $.', fresh: 'Live top-up.' },
  { name: 'Last 7 days', line: 'The 7 complete days ending yesterday, against the same 7 dates last year.', screens: 'Sales Dashboard',
    source: 'As Sales.', formula: 'sdSum(yesterday − 6, yesterday); %Δ vs sdSum of the same dates a year earlier.', day: 'PT.',
    incl: 'As Sales.', brand: 'As Sales.', round: 'Whole $; %Δ 1 decimal.', fresh: 'As Sales.' },
  { name: 'WTD (week to date)', line: 'Not shown as such. The nearest is PPC & Organic\'s running week (Sunday → Saturday, "n of 7 days").',
    screens: 'PPC & Organic, Product Performance (running week column)', source: 'PPC & Organic store (WEEKLY).',
    formula: 'Σ of the week\'s cells so far; never compared until the week finishes (wWeekDone).', day: 'Weeks start Sunday; "finished" is judged in PT.',
    incl: 'As PPC weekly sales.', brand: 'As PPC weekly sales.', round: 'Whole $.', fresh: 'Nightly.' },
  { name: 'MTD', line: 'This month so far INCLUDING today; the %Δ compares complete days only, both years.',
    screens: 'Sales Dashboard, Dashboard (Sales MTD card, ticker)', source: 'As Sales.',
    formula: 'Value = sdSum(month start, today). %Δ = sdSum(month start, yesterday) vs the same dates last year.',
    day: 'PT.', incl: 'As Sales.', brand: 'As Sales (Dashboard Both = Ridhi + CPC).', round: 'Whole $; %Δ 1 decimal.', fresh: 'As Sales.' },
  { name: 'YTD', line: 'This year so far including today; %Δ on complete days, both years.', screens: 'Sales Dashboard, Dashboard (Sales YTD card)',
    source: 'As Sales.', formula: 'Value = sdSum(1 Jan, today). %Δ = sdSum(1 Jan, yesterday) vs the same dates last year.',
    day: 'PT.', incl: 'As Sales.', brand: 'As Sales (Dashboard Both = Ridhi + CPC).', round: 'Whole $; %Δ 1 decimal.', fresh: 'As Sales.' },
  { name: 'LY and %Δ', line: 'Last year = the same calendar dates a year earlier; %Δ = (now − LY) ÷ LY.',
    screens: 'Sales Dashboard (cards, period table, monthly table), Dashboard (MTD / YTD cards)',
    source: 'As Sales (the nightly history holds last year).', formula: 'sdLastYear(date) = year − 1, same month-day. sdDelta / dashDelta: (now − was) ÷ was × 100, ▲ / ▼.',
    day: 'PT. 29 Feb has no last-year day.', incl: 'As Sales.', brand: 'As Sales.', round: '1 decimal; "—" when last year is 0 (never "+100%").',
    fresh: 'As Sales. NOTE the period table compares MTD / YTD INCLUDING today with last year up to yesterday; the cards use complete days on both sides.' },
  { name: 'Expected — month', line: 'Where the month lands if the last 7 complete days keep up.', screens: 'Sales Dashboard',
    source: 'As Sales.', formula: 'MTD to yesterday + (Last 7 days ÷ 7) × (days in month − complete days so far). On the 1st: (Last 7 days ÷ 7) × days in month. Compared with the whole of last month, and with the same number of days of last month.',
    day: 'PT.', incl: 'As Sales.', brand: 'As Sales.', round: 'Whole $; %Δ 1 decimal.', fresh: 'As Sales.' },
  { name: 'Monthly TY vs LY', line: 'Each month this year beside the same month last year.', screens: 'Sales Dashboard (table + chart)',
    source: 'As Sales.', formula: 'sdSum(YYYY-MM-01, last day) for each year; a month neither year has is left out.', day: 'PT.',
    incl: 'As Sales.', brand: 'As Sales.', round: 'Whole $; %Δ 1 decimal.', fresh: 'As Sales.' },
  { name: 'PPC weekly sales', line: 'Sales per ASIN per Sunday→Saturday week, added from the Orders workbooks.',
    screens: 'PPC & Organic, Product Performance (rows), Profit & Margin, Parent Listing Review, Dashboard (PPC · weekly bars)',
    source: 'Cache "weekly" (Orders workbook, per ASIN) merged into Firestore audit/weekly + weeklyrows/* (WEEKLY).',
    formula: 'Σ revenue (col G) of the week\'s rows per ASIN; a parent adds its children.', day: 'Weeks keyed by the Sunday; rows dated by the PT purchase date.',
    incl: 'Amazon.com only, MCF and Cancelled out, refunds not taken off. No Shopify. Workbook figures — never Seller Central\'s.',
    brand: 'By the workbook the ASIN came from (book 0 = Ridhi, 1 = CPC). "All" keeps every row, also a row with no brand.',
    round: 'Cents when added (wAddCell); whole $ on screen.', fresh: 'Nightly; folded in when PPC & Organic / Product Performance / Parent Listing Review open.' },
  { name: 'Ad spend', line: 'What the ads cost — Sponsored Products only on most screens; all ad types on Overview.',
    screens: 'PPC & Organic, Product Performance, Dashboard (Ad spend · latest week), Overview, Placement, Search Term Analysis, Profit & Margin',
    source: 'PPC & Organic / Product Performance / Profit & Margin / Dashboard: cache adsAsin (Sponsored Products, per ASIN per week) in WEEKLY. Product Performance "All" row: matchAds (SP). Overview: matchAds SP + SB + SD where it holds the day, else SP. Placement: nightly placement cache (SP, 30 days) or settled 7-day pack. Search Term Analysis: target rows (SP, settled 7-day or 30-day pack).',
    formula: 'Σ cost over the cells / days in view. Dashboard: Σ spend of the newest week in WEEKLY (often still running).',
    day: 'Report days are PT; weeks Sunday → Saturday.', incl: 'Sponsored Products (+ Brands, Display on Overview where matchAds holds the day).',
    brand: 'Each brand is its own ads profile; Both = the two added.', round: 'Whole $ (Placement / Search terms: whole or 2 decimals).',
    fresh: 'Ads land 1–2 days after the day; nightly.' },
  { name: 'Ad sales', line: 'Sales Amazon credits to an ad click.',
    screens: 'PPC & Organic, Product Performance, Overview, Placement, Search Term Analysis',
    source: 'Weekly per ASIN: SP 30-day attributed sales (adsAsin). Product Performance All row: matchAds SP 7-day. Overview: matchAds SP 7-day + SB + SD where held, else SP 30-day. Placement table: 30-day; Placement cards / Search terms: 7-day settled where available.',
    formula: 'Σ attributed sales over the cells / days.', day: 'PT report days.', incl: 'Attribution window differs by screen (7 vs 30 days).',
    brand: 'Per ads profile.', round: 'Whole $.', fresh: 'A 30-day window keeps growing for 30 days after the click.' },
  { name: 'Organic sales', line: 'Sales not credited to an ad.', screens: 'PPC & Organic, Product Performance, Overview',
    source: 'From Sales and Ad sales of the same cell / period.', formula: 'max(0, sales − ad sales). Product Performance: over the days the ad report covers only.',
    day: 'As its inputs.', incl: 'As its inputs.', brand: 'As its inputs.', round: 'Whole $.', fresh: 'As Ad sales.' },
  { name: 'TACoS', line: 'Ad spend ÷ TOTAL sales.', screens: 'PPC & Organic, Product Performance, Overview, Profit & Margin, Dashboard (Ad spend card, ticker), Search Term Analysis (Campaign × Product)',
    source: 'Ad spend and Sales of that screen.', formula: 'spend ÷ sales × 100 — five variants: PPC & Organic (SP ÷ workbook sales), Product Performance rows (ad-covered days only), PP All row (matchAds SP ÷ Seller Central), Overview (all ad types ÷ Seller Central), PP chart (no overlay).',
    day: 'As its inputs.', incl: 'As its inputs.', brand: 'As its inputs.',
    round: 'Dashboard / PPC & Organic card: whole % (Math.round); grids 1 decimal under 10 %, else whole; Overview 1 decimal.', fresh: 'As Ad spend.' },
  { name: 'ACoS', line: 'Ad spend ÷ AD sales.', screens: 'PPC & Organic, Product Performance, Overview, Placement, Search Term Analysis',
    source: 'Ad spend and Ad sales of that screen.', formula: 'spend ÷ ad sales × 100; "—" with no ad sales.', day: 'As its inputs.',
    incl: 'Window differs: 30-day (PPC & Organic, Placement table, Campaign × Product), 7-day (PP All row, Placement cards, Search terms), all types (Overview).',
    brand: 'Per ads profile.', round: 'PPC & Organic card whole %; Overview / Placement 1 decimal; Campaign × Product whole %.', fresh: 'As Ad sales.' },
  { name: 'ROAS', line: 'Ad sales ÷ ad spend.', screens: 'Overview, Product Performance, Search Term Analysis (text)', source: 'As ACoS.',
    formula: 'ad sales ÷ spend (Search terms also 100 ÷ ACoS).', day: 'As its inputs.', incl: 'As ACoS.', brand: 'Per ads profile.', round: '2 decimals.', fresh: 'As Ad sales.' },
  { name: 'Organic share', line: 'The part of sales not credited to ads.', screens: 'PPC & Organic (card + Ad % / Organic % grid), Product Performance, Overview',
    source: 'Sales and Ad sales.', formula: 'PPC & Organic card: (sales − ad sales) ÷ sales × 100, NOT floored. Grid: 100 − ad %, floored at 0. Overview / PP: max(0, sales − ad sales) ÷ sales.',
    day: 'As its inputs.', incl: 'As its inputs.', brand: 'As its inputs.', round: 'Whole % (card); 1 decimal (Overview).', fresh: 'As Ad sales.' },
  { name: 'Sessions', line: 'Visits to the product pages.', screens: 'PPC & Organic, Product Performance, Overview (Sessions box), Parent Listing Review',
    source: 'Per ASIN per week: Amazon traffic report (cache "sessions"). Overview box and PP All row: Seller Central "Sessions – Total" (matchBiz), else the weekly cache.',
    formula: 'Σ sessions. A parent adds its children (one visit to two sizes counts twice).', day: 'Weeks Sunday → Saturday; PT.',
    incl: 'Amazon only.', brand: 'Per brand.', round: 'Whole numbers.', fresh: 'Weekly traffic report; can be missing for the running week.' },
  { name: 'CVR', line: 'Two different numbers carry this name — units ÷ sessions, or ad orders ÷ clicks.',
    screens: 'PPC & Organic (CVR = units ÷ sessions), Product Performance ("Unit session %" = units ÷ sessions; "SP conv. rate" = ad orders ÷ clicks), Overview / Placement / Search Term Analysis (CVR = orders ÷ clicks)',
    source: 'As the inputs.', formula: 'units ÷ sessions × 100, or (ad) orders ÷ clicks × 100.', day: 'As its inputs.', incl: 'As its inputs.',
    brand: 'As its inputs.', round: '1 decimal.', fresh: 'As its inputs.' },
  { name: 'CTR', line: 'Clicks ÷ impressions.', screens: 'Overview, Product Performance (by campaign type)', source: 'Ad report impressions and clicks.',
    formula: 'clicks ÷ impressions × 100.', day: 'PT report days.', incl: 'Overview: all ad types where matchAds holds the day.', brand: 'Per ads profile.',
    round: '1 decimal (Overview card: 2).', fresh: 'As Ad spend.' },
  { name: 'CPC', line: 'Cost per click.', screens: 'Overview, Product Performance, Placement, Search Term Analysis', source: 'Ad spend and clicks.',
    formula: 'spend ÷ clicks; "—" with no clicks.', day: 'As its inputs.', incl: 'As Ad spend.', brand: 'Per ads profile.', round: '2 decimals.', fresh: 'As Ad spend.' },
  { name: 'Fees (est.)', line: 'An ESTIMATE: referral 15 % + FBA 11 % of sales — not Amazon\'s real fees.', screens: 'Profit & Margin',
    source: 'The fee model PF_MODEL in Firestore audit/costs (editable: ref 15, fba 11, returns 10, overhead 10, salary 10).',
    formula: 'sales × ref % + sales × fba %.', day: 'Profit & Margin\'s weeks.', incl: 'Gross ordered sales; no refunds.', brand: 'Ridhi / CPC / All (no ads-brand limit).',
    round: 'Whole $ (the sum rounded).', fresh: 'As PPC weekly sales.' },
  { name: 'COGS', line: 'Unit cost × units sold.', screens: 'Profit & Margin', source: 'Unit costs typed per ASIN (audit/costs) × WEEKLY units.',
    formula: 'unit cost × units; a parent adds child by child (only children with a cost).', day: 'Profit & Margin\'s weeks.', incl: 'Rows with a cost only.',
    brand: 'As Profit & Margin.', round: 'Whole $.', fresh: 'Costs: when typed; units nightly.' },
  { name: 'Profit', line: 'Sales less estimated fees, ads, COGS, returns, overhead and salary.', screens: 'Profit & Margin',
    source: 'pfMoney(cell, unit cost).', formula: 'sales − referral − FBA − ad spend − COGS − returns (10 % of COGS) − overhead (10 % of sales) − salary (10 % of sales).',
    day: 'Profit & Margin\'s weeks (the newest is the running week).', incl: 'Costed rows; gross ordered sales; returns only as the modelled %.',
    brand: 'As Profit & Margin.', round: 'Whole $; per unit 2 decimals.', fresh: 'As PPC weekly sales.' },
  { name: 'Margin', line: 'Profit ÷ sales.', screens: 'Profit & Margin', source: 'pfMoney.', formula: 'profit ÷ sales × 100; the card: Σ profit ÷ Σ sales of costed rows.',
    day: 'As Profit.', incl: 'As Profit.', brand: 'As Profit.', round: '1 decimal.', fresh: 'As Profit.' },
  { name: 'ROI', line: 'Profit ÷ COGS.', screens: 'Profit & Margin', source: 'pfMoney.', formula: 'profit ÷ COGS × 100.', day: 'As Profit.',
    incl: 'As Profit.', brand: 'As Profit.', round: 'Whole %.', fresh: 'As Profit.' },
  { name: 'Aged units (181+)', line: 'Units in FBA that are 181 days old or more.', screens: 'Inventory Age, Dashboard (Aged 181+ tile, ticker)',
    source: 'Firestore age/SP, age/CPC — Amazon\'s FBA inventory planning report, saved on "Refresh both brands" (at most 1,500 rows each).',
    formula: 'Keep the coarsest age buckets that do not overlap (totalCols); add every bucket STARTING at 181 days or later.', day: 'The snapshot\'s time.',
    incl: 'FBA only; the snapshot\'s rows.', brand: 'Ridhi / CPC / Both (the two added).', round: 'Whole units.', fresh: 'Only as new as the last Refresh (amber after 7 days).' },
  { name: 'Storage $', line: 'Amazon\'s estimated monthly storage fee for the stock in the snapshot.', screens: 'Inventory Age, Dashboard (Aged 181+ tile)',
    source: 'age/{brand}: the report\'s first storage fee / cost / charge column (long-term storage left out).', formula: 'Σ storage over the rows.',
    day: 'The snapshot\'s time.', incl: 'As Aged units.', brand: 'As Aged units.', round: '2 decimals.', fresh: 'As Aged units.' },
  { name: 'Sales Analysis units / amount / share', line: 'Units and money per SKU per month, and each one\'s share of the month\'s units.',
    screens: 'Sales Analysis', source: 'Firestore salesanalysis/{brand} + sarows/*, rebuilt by its button from the Orders workbook (no Amazon call).',
    formula: 'qty = Σ units, amt = Σ revenue per SKU-month (each rounded); share = units ÷ all units that month; rank = this month + last month.',
    day: 'PT months.', incl: 'Amazon.com only, MCF and Cancelled out, refunds not taken off. Workbook figures — never Seller Central\'s.',
    brand: 'One brand at a time.', round: 'Whole numbers; share 1 decimal.', fresh: 'When last rebuilt.' },
  { name: 'Parent Listing Review figures', line: 'Last week, the 6-week average, run rate and cover per parent.', screens: 'Parent Listing Review',
    source: 'WEEKLY (sales, units, spend, sessions), Listing Health stock, launch dates.',
    formula: 'Avg = Σ of the last 6 finished weeks ÷ 6 (Prime Day week left out; INCLUDES last week). Run rate = last week × 52. "DOS" = stock ÷ last week\'s units ÷ (52 ÷ 12) — MONTHS of cover.',
    day: 'Finished weeks (PT).', incl: 'As PPC weekly sales.', brand: 'Ridhi / CPC / Both within the ads brands.', round: 'Whole $; % whole; DOS 1 decimal.', fresh: 'Nightly.' },
];

/* ---------- THE SAME NUMBER WORKED OUT IN MORE THAN ONE PLACE ---------- */
const NC_RISKS = [
  'Sales MTD / YTD: Sales Dashboard (sdSum) and Dashboard (DASH_CALC.sales, through sdSum with the channel swapped) — checked below.',
  'Sales: Sales Dashboard uses Seller Central\'s totals where published; PPC & Organic, Profit & Margin, Parent Listing Review and Sales Analysis add up the Orders workbooks — checked below (PPC week, Profit & Margin).',
  '"Both" / "All": Dashboard Both = Ridhi + CPC; Sales Dashboard All = Ridhi + CPC + Shopify; PPC & Organic All = every row, also one with no brand.',
  'Ad spend: PPC & Organic / Dashboard (SP per ASIN), Product Performance All row (matchAds SP), Overview (SP + SB + SD), Placement and Search terms (SP, 30-day or settled 7-day) — checked below (Dashboard, Overview).',
  'TACoS: five definitions (see the rule) and three colour bands (≤10/20, 15/30, >20).',
  'ACoS: the same formula with 7-day, 30-day or all-type inputs — Placement shows both windows on one screen.',
  'CVR: units ÷ sessions (PPC & Organic, PP "Unit session %") vs orders ÷ clicks (Overview, Placement, Search terms, PP "SP conv. rate").',
  'Sessions: per-ASIN traffic report added up vs Seller Central\'s total.',
  'Orders: Business Report order items vs distinct workbook orders, in one row (Sales Dashboard, Overview).',
  'Organic share: floored at 0 in grids, not on the PPC & Organic card.',
  'Aged 181+ and storage: Inventory Age (renderAge / renderAgeKpis) and the Dashboard tile (DASH_CALC.age) — checked below.',
  'Fee model: Profit & Margin (audit/costs: returns 10 % of COGS) and Settings / New Product (returns 3 % of price) are separate copies.',
  'Parent roll-up: Profit & Margin (pfRows), PPC & Organic (wRows) and Parent Listing Review (plRows) each group children on their own.',
  'Weeks: PT everywhere except wWeeksList (browser date), which sets PPC & Organic\'s and Profit & Margin\'s week list.',
];

/* ---------- TOLERANCES, per check (also shown on the screen) ---------- */
const NC_TOL = {
  exact: 'exact, to the cent',
  week: '±2 % — Seller Central\'s totals vs the Orders workbook',
  sp: 'within 1 % — the same Sponsored Products spend on both screens',
  organic: '±5 % — Overview: Seller Central sales less all-type ad sales (7-day); PPC & Organic: workbook sales less SP ad sales (30-day)',
  shown: 'shown only — no other screen has it',
  defn: 'definition differs — needs a manager decision (not a bug)',
};

let NC = { at: 0, res: null, busy: null, soonT: 0, err: '', ov: { ads: null, daily: null, asin: null, adsAt: '', dailyAt: '', asinAt: '' }, diag: { sp: [], pm: [], days: [] } };
const NC_VIEWS = [['SP', 'Ridhi'], ['CPC', 'CPC'], ['ALL', 'Both']];
const NC_BRAND = { SP: 'Ridhi', CPC: 'CPC', SHOP: 'Shopify' };
const ncEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const ncMoney = v => (v == null || !isFinite(v) ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const ncNum = v => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'));
const ncR2 = v => Math.round(v * 100) / 100;
const ncMay = t => typeof TAB_OK === 'function' && !!TAB_OK(t);
const ncAdsOk = () => ncMay('ppcn') || ncMay('weekly');
const ncAdBs = () => (typeof adBrands === 'function' ? adBrands() : ['SP', 'CPC']);
const ncHm = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const ncChans = view => (view === 'ALL' ? ['SP', 'CPC'] : [view]);
const ncDays = w => Array.from({ length: 7 }, (_, i) => sdShift(w, i));

// Two numbers compared: the difference in $ and %, and the verdict. 'exact' = within half a cent (units: exact); 'week' = within
// 2 % ('info': differs on purpose, explained); 'sp' = within 1 %; 'organic' = within 5 % explained; 'onpurpose' = explained.
function ncCompare(a, b, kind, unit) {
  const diff = ncR2(a - b);
  const pct = b ? (a - b) / Math.abs(b) * 100 : (a ? 100 : 0);
  let status;
  if (Math.abs(diff) < (unit === 'n' ? 0.5 : 0.005)) status = 'ok';
  else if (kind === 'week') status = Math.abs(pct) <= 2 ? 'info' : 'warn';
  else if (kind === 'sp') status = Math.abs(pct) <= 1 ? 'ok' : 'warn';
  else if (kind === 'organic') status = Math.abs(pct) <= 5 ? 'info' : 'warn';
  else if (kind === 'onpurpose') status = 'info';
  else if (kind === 'defn') status = 'defn';
  else status = 'warn';
  return { diff, pct, status };
}
/* MISSING IS NOT ZERO (22 Nov 2026). A side with no data — a brand not loaded, a week whose figures have not arrived — is shown
 * as "— not loaded" with the reason, never as $0 and never as "differs". Every check passes its sides through here. */
function ncRow(id, name, view, a, b, kind, why, unit) {
  const tol = NC_TOL[kind === 'onpurpose' ? 'exact' : kind] || NC_TOL.exact;
  if (a.v == null || b.v == null) return ncSkip(id, name, view, (why && why.missing) || 'Not loaded yet.', { a, b, tol });
  const c = ncCompare(a.v, b.v, kind, unit);
  return { id, name, view, a, b, unit: unit || '$', kind, tol,
    diff: c.diff, pct: c.pct, status: c.status, why: c.status === 'ok' ? (why && why.ok) || '' : (why && why.off) || '' };
}
// A check that could not run: not loaded, or not in this account's access. Its sides keep their labels; their values are null.
const ncSkip = (id, name, view, why, more) => Object.assign({ id, name, view, a: null, b: null, status: 'skip', why, diff: null, pct: null, tol: '' }, more || {});
// A figure only one screen has: shown, not compared, not counted.
const ncNote = (id, name, view, a, why) => (a.v == null ? ncSkip(id, name, view, why.missing || 'Not loaded yet.', { tol: NC_TOL.shown })
  : { id, name, view, a, b: null, unit: '$', kind: 'shown', tol: NC_TOL.shown, diff: null, pct: null, status: 'note', why: why.note || '' });

/* ---------- the sums, each through the screen's OWN function ---------- */
// The Sales Dashboard's sdSum for some channels (SD_CH swapped and put back at once, as the Dashboard does).
function ncSd(chans, from, to) {
  const keep = SD_CH;
  try { return ncR2(chans.reduce((t, ch) => { SD_CH = ch; return t + sdSum(from, to)[0]; }, 0)); } finally { SD_CH = keep; }
}
// Does the Sales Dashboard hold this channel at all (its own days, or Seller Central's)?
const ncSdHas = ch => !!(SD && SD.d && SD.d[ch] && Object.keys(SD.d[ch]).length)
  || (ch !== 'SHOP' && typeof tMatchBizDays === 'function' && Object.keys(tMatchBizDays(ch)).length > 0);
const ncSdMissing = chans => chans.filter(ch => !ncSdHas(ch)).map(ch => NC_BRAND[ch] || ch);
const ncSdAt = () => 'nightly ' + (SD.at || '—') + (SD_LIVE ? ' · today ' + SD_LIVE : '')
  + (typeof T_MATCH !== 'undefined' && T_MATCH.biz ? ' · Seller Central ' + (T_MATCH.biz.at || '?') : '');
// PPC & Organic's store: the screen's own WEEKLY when it is loaded, else the Dashboard's copy of the same documents.
const ncW = () => (WEEKLY.weeks.length && Object.keys(WEEKLY.rows).length ? WEEKLY : (typeof DASH !== 'undefined' && DASH.weekly) || null);
const ncWeeks = W => (W.weeks.length ? W.weeks : wWeeksList(26));
// The rows PPC & Organic adds up for a brand pick: 'ALL' keeps every row (wRows), a brand keeps its own.
const ncWRows = (W, view) => Object.values(W.rows).filter(r => view === 'ALL' || (r.brand || '') === view);
const ncWSum = (rows, weeks, f) => ncR2(rows.reduce((s, r) => s + weeks.reduce((t, w) => t + (((r.weeks || {})[w] || {})[f] || 0), 0), 0));
// Does PPC & Organic hold field f for brand b in week w (any of its rows)? A week nobody reported is missing, not $0.
const ncWHas = (W, b, w, f) => !!W && Object.values(W.rows).some(r => r.brand === b && r.weeks && r.weeks[w] && r.weeks[w][f] != null);
const ncWMissing = (W, chans, weeks, f) => chans.filter(b => !weeks.every(w => ncWHas(W, b, w, f))).map(b => NC_BRAND[b]);
const ncWAt = W => (W.at ? 'sales ' + W.at : 'sales not pulled yet') + (W.adAt ? ' · ads ' + W.adAt : '');
const ncWeekEnd = w => sdShift(w, 6);

/* ---------- the Overview's figures, rebuilt read-only ----------
 * The Overview draws its saved snapshot (audit/trends) with the nightly caches laid over it when it opens — tNightly: the daily cache
 * (sales), the ads cache (Sponsored Products), then Amazon's own totals (matchBiz sales, matchAds ads), the last one winning — and
 * then SAVES the result, which Numbers Check never does. So the same sources are read here, in the same order, into a copy:
 * NC.ov.daily / NC.ov.ads (cache reads), T_MATCH (tMatchEnsure), TREND (loadTrends, sales only). matchAds holds the split by ad
 * type; the ads cache is Sponsored Products only. Per brand and day: sales, sp / sb / sd spend, ad sales, and where the ad figures
 * came from ('' = no ad figure from any source: that day is MISSING). The saved snapshot's ad figures are not used: once Amazon's
 * totals have been laid over them they no longer say which type they were. */
function ncOvDays(b) {
  const out = {};
  const cell = d => out[d] || (out[d] = { sales: null, sp: null, sb: null, sd: null, adSales: null, ad: '' });
  const today = sdToday();
  const st = (typeof TREND !== 'undefined' && TREND.d && TREND.d[b]) || {};
  Object.entries(st).forEach(([d, v]) => { if (v && v[T_I.sales] != null) cell(d).sales = Number(v[T_I.sales]) || 0; });
  Object.entries(((NC.ov.daily || {})[b]) || {}).forEach(([d, v]) => { if (d < today) cell(d).sales = Number(v[0]) || 0; });
  Object.entries(((NC.ov.ads || {})[b]) || {}).forEach(([d, v]) => {
    const c = cell(d);
    c.sp = ncR2(Number(v[2]) || 0); c.sb = 0; c.sd = 0; c.adSales = ncR2(Number(v[4]) || 0); c.ad = 'ads';
  });
  if (typeof T_MATCH !== 'undefined' && T_MATCH.biz && typeof tMatchBizDays === 'function') {
    Object.entries(tMatchBizDays(b)).forEach(([d, v]) => { cell(d).sales = ncR2(Number(v[0]) || 0); });
  }
  const ma = (typeof T_MATCH !== 'undefined' && T_MATCH.ads && T_MATCH.ads.d && T_MATCH.ads.d[b]) || {};
  Object.entries(ma).forEach(([d, k]) => {
    if (!k || !k.sp) return;                       // as the Overview: without Sponsored Products the day is not known
    const c = cell(d), cost = a => (a ? Number(a[2]) || 0 : 0), sales = a => (a ? Number(a[3]) || 0 : 0);
    c.sp = ncR2(cost(k.sp)); c.sb = ncR2(cost(k.sb)); c.sd = ncR2(cost(k.sd));
    c.adSales = ncR2(sales(k.sp) + sales(k.sb) + sales(k.sd)); c.ad = 'matchAds';
  });
  return out;
}

/* ---------- THE CHECKS ---------- */
// Every check, from what is in memory now. Never loads, never writes.
function ncRun() {
  const out = [];
  NC.diag = { sp: [], pm: [], days: [] };          // "Why they differ" — worked out again with every run
  const salesOk = ncMay('sales') && SD && SD.at;
  const today = sdToday();
  const monthStart = today.slice(0, 8) + '01', yearStart = today.slice(0, 4) + '-01-01';

  // --- 1–2. Dashboard Sales MTD / YTD = Sales Dashboard ---
  let dashSales = null;
  try { dashSales = salesOk ? DASH_CALC.sales() : null; } catch (e) { dashSales = null; }
  [['mtd', 'Sales MTD', monthStart], ['ytd', 'Sales YTD', yearStart]].forEach(([k, label, from]) => {
    NC_VIEWS.forEach(([view, vName]) => {
      const id = 'sales-' + k;
      const name = `Dashboard ${label} = Sales Dashboard`;
      if (!ncMay('sales')) return out.push(ncSkip(id, name, vName, 'Sales Dashboard is not in your access.'));
      if (!salesOk || !dashSales || !dashSales[view]) return out.push(ncSkip(id, name, vName, 'Sales not loaded yet.'));
      const miss = ncSdMissing(ncChans(view));
      if (miss.length) return out.push(ncSkip(id, name, vName, `${miss.join(' and ')} sales not loaded — no days for ${miss.length > 1 ? 'them' : 'it'} on the Sales Dashboard.`));
      const a = { label: 'Dashboard', v: ncR2(dashSales[view][k]), at: dashSales[view].when };
      if (view !== 'ALL') {
        const b = { label: 'Sales Dashboard · ' + vName, v: ncSd([view], from, today), at: ncSdAt() };
        return out.push(ncRow(id, name, vName, a, b, 'exact', { off: 'The two screens add the same days differently — this should never happen.' }));
      }
      const hasShop = ncSdHas('SHOP');
      const all = ncSd(['SP', 'CPC', 'SHOP'], from, today), shop = hasShop ? ncSd(['SHOP'], from, today) : 0;
      const b = { label: 'Sales Dashboard · All', v: all, at: ncSdAt() + (hasShop ? '' : ' · Shopify not loaded') };
      const r = ncRow(id, name, vName, a, b, shop ? 'onpurpose' : 'exact');
      // Explained only when the gap IS the Shopify figure, to the cent.
      if (shop && Math.abs(ncR2(a.v + shop - all)) >= 0.005) r.status = 'warn';
      r.why = r.status === 'ok' ? (hasShop ? '' : 'Shopify not loaded, so "All" is Ridhi + CPC here.') : r.status === 'info'
        ? `On purpose: Dashboard "Both" = Ridhi + CPC (Amazon only); Sales Dashboard "All" also counts Shopify (${ncMoney(shop)}).`
        : 'Dashboard Both ≠ Sales Dashboard Ridhi + CPC.';
      out.push(r);
    });
  });

  // --- 3. Dashboard Ad spend (latest week) = PPC & Organic's latest-week card; Both = Ridhi + CPC ---
  const W = ncW();
  const adBs = ncAdBs();
  let dashAds = null;
  try { dashAds = ncAdsOk() && W ? DASH_CALC.ads() : null; } catch (e) { dashAds = null; }
  const wLast = W ? ncWeeks(W)[ncWeeks(W).length - 1] : '';
  NC_VIEWS.forEach(([view, vName]) => {
    const id = 'ads-week', name = 'Dashboard Ad spend (latest week) = PPC & Organic';
    if (!ncAdsOk()) return out.push(ncSkip(id, name, vName, 'Advertising is not in your access.'));
    if (ncChans(view).some(b => !adBs.includes(b))) return out.push(ncSkip(id, name, vName, 'That brand\'s ads are not in your access.'));
    if (!W || !Object.keys(W.rows).length || !dashAds || !dashAds[view] || dashAds[view].empty) return out.push(ncSkip(id, name, vName, 'PPC & Organic not loaded yet.'));
    const miss = ncWMissing(W, ncChans(view), [wLast], 'spend');
    if (miss.length) return out.push(ncSkip(id, name, vName, `${miss.join(' and ')}: no ad figures for ${wLabel(wLast)} yet${wWeekDone(wLast) ? '' : ` (week still running, ${wDaysIn(wLast)} of 7 days; ads land 1–2 days late)`} — not $0.`));
    const rows = ncWRows(W, view);
    const spend = ncWSum(rows, [wLast], 'spend'), rev = ncWSum(rows, [wLast], 'rev');
    const tacosB = rev ? Math.round(spend / rev * 100) : null;
    const d = dashAds[view];
    const a = { label: 'Dashboard', v: ncR2(d.last.spend), at: d.when };
    const b = { label: 'PPC & Organic · ' + wLabel(wLast), v: spend, at: ncWAt(W) };
    const r = ncRow(id, name, vName, a, b, 'exact', { off: 'The Dashboard and PPC & Organic add the latest week differently.' });
    if (r.status === 'ok' && d.tacos !== tacosB) { r.status = 'warn'; r.why = `TACoS differs: Dashboard ${d.tacos}% vs PPC & Organic ${tacosB}%.`; }
    r.sub = `TACoS ${d.tacos == null ? '—' : d.tacos + '%'} on both` + (wWeekDone(wLast) ? '' : ` · week still running (${wDaysIn(wLast)} of 7 days; ads land 1–2 days late)`);
    out.push(r);
  });
  if (ncAdsOk() && W && Object.keys(W.rows).length && adBs.length === 2) {
    const name = 'PPC & Organic Ad spend (latest week): Both = Ridhi + CPC';
    const miss = ncWMissing(W, ['SP', 'CPC'], [wLast], 'spend');
    if (miss.length) out.push(ncSkip('ads-both', name, 'Both', `${miss.join(' and ')}: no ad figures for ${wLabel(wLast)} yet — not $0.`));
    else {
      const n = Object.values(W.rows).filter(r => r.brand !== 'SP' && r.brand !== 'CPC').length;
      out.push(ncRow('ads-both', name, 'Both',
        { label: 'Both (every row)', v: ncWSum(ncWRows(W, 'ALL'), [wLast], 'spend'), at: ncWAt(W) },
        { label: 'Ridhi + CPC', v: ncR2(ncWSum(ncWRows(W, 'SP'), [wLast], 'spend') + ncWSum(ncWRows(W, 'CPC'), [wLast], 'spend')), at: ncWAt(W) }, 'exact',
        { off: `"All" also counts ${n} row${n === 1 ? '' : 's'} with no brand — those show in Both but in neither brand.` }));
    }
  }

  // --- 4. PPC & Organic weekly sales ≈ Sales Dashboard, the last FINISHED week ---
  NC_VIEWS.forEach(([view, vName]) => {
    const id = 'ppc-sales', name = 'PPC weekly sales vs Sales Dashboard (last finished week)';
    if (!ncAdsOk() || !ncMay('sales')) return out.push(ncSkip(id, name, vName, 'Needs both Advertising and the Sales Dashboard in your access.'));
    if (ncChans(view).some(b => !adBs.includes(b))) return out.push(ncSkip(id, name, vName, 'That brand\'s ads are not in your access.'));
    if (!W || !Object.keys(W.rows).length || !salesOk) return out.push(ncSkip(id, name, vName, 'PPC & Organic or Sales not loaded yet.'));
    const done = ncWeeks(W).filter(wWeekDone);
    const wk = done[done.length - 1];
    if (!wk) return out.push(ncSkip(id, name, vName, 'No finished week stored yet.'));
    const miss = [...ncWMissing(W, ncChans(view), [wk], 'rev').map(x => x + ' (PPC & Organic)'), ...ncSdMissing(ncChans(view)).map(x => x + ' (Sales Dashboard)')];
    if (miss.length) return out.push(ncSkip(id, name, vName, `${miss.join(', ')}: no sales for ${wLabel(wk)} — not loaded, not $0.`));
    const a = { label: 'PPC & Organic · ' + wLabel(wk), v: ncWSum(ncWRows(W, view), [wk], 'rev'), at: ncWAt(W) };
    const b = { label: 'Sales Dashboard · ' + (view === 'ALL' ? 'Ridhi + CPC' : vName), v: ncSd(ncChans(view), wk, ncWeekEnd(wk)), at: ncSdAt() };
    out.push(ncRow(id, name, vName, a, b, 'week', {
      off: 'PPC & Organic adds the Orders workbook per ASIN; the Sales Dashboard uses Seller Central\'s own totals where published (Amazon only on both; Shopify left out).' }));
  });

  // --- 5. Overview vs PPC & Organic, by ad type, over the finished weeks BOTH screens hold ---
  const ov = ncOvChecks(W, adBs);
  NC_OV.forEach(([id]) => ov.filter(r => r.id === id).forEach(r => out.push(r)));

  // --- 6. Inventory Age tile = Inventory Age screen (aged 181+ units, storage $) ---
  let dashAge = null;
  try { dashAge = ncMay('age') && AGE_LOADED ? DASH_CALC.age() : null; } catch (e) { dashAge = null; }
  const ageRows = { units: [], storage: [] };
  NC_VIEWS.forEach(([view, vName]) => {
    const name1 = 'Dashboard Aged 181+ units = Inventory Age', name2 = 'Dashboard storage $ = Inventory Age';
    const skip = why => { ageRows.units.push(ncSkip('age-units', name1, vName, why)); ageRows.storage.push(ncSkip('age-storage', name2, vName, why)); };
    if (!ncMay('age')) return skip('Inventory Age is not in your access.');
    if (!AGE_LOADED || !dashAge || !dashAge[view] || dashAge[view].empty) return skip('Inventory Age not loaded yet (or no snapshot).');
    const miss = ncChans(view).filter(b => !AGE[b]).map(b => NC_BRAND[b]);
    if (miss.length) return skip(`${miss.join(' and ')}: no Inventory Age snapshot loaded — not 0 units.`);
    const bs = ncChans(view);
    // Inventory Age's own way (renderAge, no search): its non-overlapping buckets, those starting at AGED_FROM, every row of the brands.
    const cols = totalCols([...new Set(bs.flatMap(b => AGE[b].cols))]);
    const aged = cols.filter(c => { const r = ageRange(c); return r && r[0] >= AGED_FROM; });
    let units = 0, storage = 0;
    bs.forEach(b => AGE[b].rows.forEach(r => { units += aged.reduce((s, c) => s + ((r.age || {})[c] || 0), 0); storage += r.storage || 0; }));
    const at = bs.map(b => AGE[b].at).filter(Boolean).map(d => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })).join(' · ');
    ageRows.units.push(ncRow('age-units', name1, vName, { label: 'Dashboard', v: dashAge[view].units, at: dashAge[view].when },
      { label: 'Inventory Age', v: units, at: 'snapshot ' + at }, 'exact', { off: 'The tile and the screen add the buckets differently.' }, 'n'));
    ageRows.storage.push(ncRow('age-storage', name2, vName, { label: 'Dashboard', v: ncR2(dashAge[view].storage), at: dashAge[view].when },
      { label: 'Inventory Age', v: ncR2(storage), at: 'snapshot ' + at }, 'exact', { off: 'The tile and the screen add storage differently.' }));
  });
  out.push(...ageRows.units, ...ageRows.storage);

  // --- 7. Profit & Margin sales ≈ Sales Dashboard, its FINISHED weeks only (22 Nov 2026: the running week and today left out, like
  // every other check), and why they differ, week by week and day by day (NC.diag.pm / NC.diag.days) ---
  let pmSpan = null;
  NC_VIEWS.forEach(([view, vName]) => {
    const id = 'pm-sales', name = 'Profit & Margin sales vs Sales Dashboard (finished weeks)';
    if (!ncMay('profit') || !ncMay('sales')) return out.push(ncSkip(id, name, vName, 'Profit & Margin is not in your access.'));
    if (!W || !Object.keys(W.rows).length || !salesOk) return out.push(ncSkip(id, name, vName, 'PPC weekly store or Sales not loaded yet.'));
    // Profit & Margin's own weeks (pfWeeks reads its picker; 4 weeks when the screen has not drawn), over the same rows it adds —
    // then only the finished ones.
    const picked = (W === WEEKLY && $('pfWeeks') ? pfWeeks() : ncWeeks(W).slice(-(Number($('pfWeeks') && $('pfWeeks').value) || 4)));
    const weeks = picked.filter(wWeekDone);
    if (!weeks.length) return out.push(ncSkip(id, name, vName, `No finished week in Profit & Margin's pick (${picked.length} week${picked.length === 1 ? '' : 's'}, all still running).`));
    const miss = [...ncWMissing(W, ncChans(view), weeks, 'rev').map(x => x + ' (weekly store)'), ...ncSdMissing(ncChans(view)).map(x => x + ' (Sales Dashboard)')];
    if (miss.length) return out.push(ncSkip(id, name, vName, `${miss.join(', ')}: sales not loaded for these weeks — not $0.`));
    const from = weeks[0], to = ncWeekEnd(weeks[weeks.length - 1]);
    const a = { label: `Profit & Margin · ${weeks.length} finished wk`, v: ncWSum(ncWRows(W, view), weeks, 'rev'), at: ncWAt(W) };
    const b = { label: 'Sales Dashboard · ' + (view === 'ALL' ? 'Ridhi + CPC' : vName) + ` · ${sdShort(from)}–${sdShort(to)}`, v: ncSd(ncChans(view), from, to), at: ncSdAt() };
    const r = ncRow(id, name, vName, a, b, 'week', {
      off: 'Profit & Margin adds the Orders workbook per ASIN; the Sales Dashboard uses Seller Central\'s totals where published — see "Why they differ" below, week by week.' });
    const left = picked.filter(w => !wWeekDone(w));
    r.sub = `${wLabel(weeks[0])} → ${wLabel(weeks[weeks.length - 1])} · ${weeks.length} finished wk` + (left.length ? ` (running week ${left.map(wLabel).join(', ')} and today left out)` : '');
    out.push(r);
    pmSpan = pmSpan && pmSpan.weeks.length >= weeks.length ? pmSpan : { weeks };
    // week by week: Profit & Margin · the Sales Dashboard's own workbook days · the Sales Dashboard as shown (Seller Central where published)
    weeks.forEach(w => {
      const chans = ncChans(view), end = ncWeekEnd(w);
      NC.diag.pm.push({ view: vName, w, label: wLabel(w), pm: ncWSum(ncWRows(W, view), [w], 'rev'), wb: ncSdRaw(chans, w, end), sd: ncSd(chans, w, end) });
    });
  });
  // day by day, both brands: where Seller Central's total and the Orders workbook differ most (the gap's own days)
  if (pmSpan) {
    const from = pmSpan.weeks[0], to = ncWeekEnd(pmSpan.weeks[pmSpan.weeks.length - 1]);
    ['SP', 'CPC'].forEach(b => {
      if (!ncSdHas(b)) return;
      const sc = typeof tMatchBizDays === 'function' ? tMatchBizDays(b) : {}, own = (SD.d && SD.d[b]) || {};
      for (let d = from; d <= to; d = sdShift(d, 1)) {
        const wb = own[d] ? Number(own[d][0]) || 0 : null, s = sc[d] ? Number(sc[d][0]) || 0 : null;
        if (wb == null && s == null) continue;
        NC.diag.days.push({ brand: NC_BRAND[b], day: d, wb, sc: s, diff: wb != null && s != null ? ncR2(s - wb) : null,
          units: own[d] && sc[d] ? [Number(own[d][1]) || 0, Number(sc[d][1]) || 0] : null });
      }
    });
    NC.diag.days.sort((x, y) => Math.abs(y.diff || 0) - Math.abs(x.diff || 0));
  }
  return out;
}
// The Sales Dashboard's OWN workbook days (SD.d — before Seller Central's totals are laid over them) for some channels.
function ncSdRaw(chans, from, to) {
  return ncR2(chans.reduce((t, ch) => t + Object.entries((SD.d && SD.d[ch]) || {})
    .reduce((u, [d, v]) => u + (d >= from && d <= to ? Number(v[0]) || 0 : 0), 0), 0));
}

/* ---------- 5. Overview vs PPC & Organic, split by ad type ----------
 * Like with like: Sponsored Products against Sponsored Products (the only type PPC & Organic has) — the same spend on both, so
 * within 1 %. Sponsored Brands and Display are the Overview's alone: shown, not compared. Organic sales are compared with the
 * documented gap. The window is the finished weeks BOTH screens hold for every brand in view (the newest 13), and the rows say
 * which. Then each screen's Both against its Ridhi + CPC. */
// ASIN → brand from Listing Health's rows, when it is loaded (never loaded from here); {} otherwise.
function ncHealthBrands() {
  const m = {};
  if (typeof HEALTH === 'undefined' || !HEALTH) return m;
  ['SP', 'CPC'].forEach(b => ((HEALTH[b] && HEALTH[b].rows) || []).forEach(r => {
    const a = String(r.asin || '').trim().toUpperCase();
    if (a && !m[a]) m[a] = b;
  }));
  return m;
}
// PPC & Organic's rows with no brand that belong to a view: for a brand, those Listing Health puts under it; for Both, all of them.
function ncUnassigned(W, view, hb) {
  const rows = Object.entries(W.rows).filter(([a, r]) => !r.brand && (view === 'ALL' || hb[a.toUpperCase()] === view)).map(([, r]) => r);
  return { n: rows.length, rows };
}
// A view's rows INCLUDING its unassigned ones (ncUnassigned): a brand's own rows + those; Both = every row.
const ncWRowsU = (W, view, hb) => (view === 'ALL' ? Object.values(W.rows) : ncWRows(W, view).concat(ncUnassigned(W, view, hb).rows));

const NC_OV = [
  ['ovw-sp', 'Sponsored Products ad spend: Overview = PPC & Organic'],
  ['ovw-sb', 'Sponsored Brands ad spend (Overview only)'],
  ['ovw-sd', 'Sponsored Display ad spend (Overview only)'],
  ['ovw-total', 'Total ad spend, all types (Overview)'],
  ['ovw-organic', 'Organic sales: Overview vs PPC & Organic'],
  ['ovw-both', 'Overview: Both = Ridhi + CPC (all types)'],
  ['ppc-both13', 'PPC & Organic: Both = Ridhi + CPC (same weeks)'],
];
function ncOvChecks(W, adBs) {
  const out = [];
  const name = id => (NC_OV.find(x => x[0] === id) || [id, id])[1];
  const skipAll = (vName, why, ids) => (ids || NC_OV.slice(0, 5).map(x => x[0])).forEach(id => out.push(ncSkip(id, name(id), vName, why)));
  if (!ncMay('trends') || !ncAdsOk()) { NC_VIEWS.forEach(([, vName]) => skipAll(vName, 'Overview or PPC & Organic is not in your access.')); return out; }
  const OV = {};
  adBs.forEach(b => { OV[b] = ncOvDays(b); });
  const hb = ncHealthBrands();
  const adDays = b => Object.keys(OV[b] || {}).filter(d => OV[b][d].ad).sort();
  const ovHas = (b, w) => !!OV[b] && ncDays(w).every(d => OV[b][d] && OV[b][d].ad);
  const ovSalesHas = (b, w) => !!OV[b] && ncDays(w).every(d => OV[b][d] && OV[b][d].sales != null);
  const ovSum = (bs, weeks, f) => ncR2(bs.reduce((s, b) => s + weeks.reduce((t, w) => t + ncDays(w).reduce((u, d) => u + (((OV[b] || {})[d] || {})[f] || 0), 0), 0), 0));
  const ppTo = b => (W ? ncWeeks(W).filter(w => ncWHas(W, b, w, 'spend')).pop() : '');
  const span = weeks => `${wLabel(weeks[0])} → ${wLabel(weeks[weeks.length - 1])} · ${weeks.length} finished wk both screens hold`;
  const ovAt = bs => bs.map(b => { const d = adDays(b); return `${NC_BRAND[b]} ads ${d.length ? sdShort(d[0]) + '→' + sdShort(d[d.length - 1]) : 'not loaded'}`; }).join(' · ')
    + (typeof T_MATCH !== 'undefined' && T_MATCH.ads && T_MATCH.ads.at ? ` · matchAds ${T_MATCH.ads.at}` : '');
  const ppAt = bs => bs.map(b => `${NC_BRAND[b]} to ${ppTo(b) ? wLabel(ppTo(b)) : '—'}`).join(' · ') + (W ? ' · ' + ncWAt(W) : '');
  const wins = {};
  NC_VIEWS.forEach(([view, vName]) => {
    const bs = ncChans(view);
    if (bs.some(b => !adBs.includes(b))) return skipAll(vName, 'That brand\'s ads are not in your access.');
    // what is missing, brand by brand — said, never added up as $0
    const why = [];
    bs.forEach(b => {
      if (!adDays(b).length) why.push(`${NC_BRAND[b]}: Overview ad figures not loaded`);
      if (!W || !ncWeeks(W).some(w => ncWHas(W, b, w, 'spend'))) why.push(`${NC_BRAND[b]}: PPC & Organic ad figures not loaded`);
    });
    if (why.length) return skipAll(vName, why.join(' · ') + ' — not $0.');
    const weeks = ncWeeks(W).filter(w => wWeekDone(w) && bs.every(b => ovHas(b, w) && ncWHas(W, b, w, 'spend'))).slice(-13);
    if (!weeks.length) return skipAll(vName, `No finished week both screens hold (${ovAt(bs)}; PPC & Organic ${ppAt(bs)}).`);
    wins[view] = weeks;
    const sub = span(weeks);
    /* UNASSIGNED INCLUDED (22 Nov 2026). PPC & Organic's rows with no brand are in its "All" but in neither brand. Here a brand also
     * takes the unassigned rows whose ASIN Listing Health puts under it; Both takes every row. Said on the row. */
    const pRows = ncWRowsU(W, view, hb);
    const brandOnly = ncWRows(W, view).filter(r => view !== 'ALL' || r.brand === 'SP' || r.brand === 'CPC');
    const unas = ncUnassigned(W, view, hb);
    const unasTxt = !unas.n ? '' : view === 'ALL'
      ? ` · incl. ${unas.n} unassigned ASIN${unas.n === 1 ? '' : 's'} (${ncMoney(ncWSum(unas.rows, weeks, 'spend'))})`
      : ` · incl. ${unas.n} unassigned ASIN${unas.n === 1 ? '' : 's'} Listing Health puts under ${vName} (${ncMoney(ncWSum(unas.rows, weeks, 'spend'))})`;
    const A = (label, v) => ({ label: `Overview · ${label}`, v, at: ovAt(bs) });
    const B = (label, v) => ({ label: `PPC & Organic · ${label}`, v, at: ppAt(bs) });
    const sp = ncRow('ovw-sp', name('ovw-sp'), vName, A('Sponsored Products', ovSum(bs, weeks, 'sp')), B('Sponsored Products' + unasTxt, ncWSum(pRows, weeks, 'spend')), 'sp',
      { off: 'The same Sponsored Products spend should match: the Overview reads Amazon\'s campaign totals (matchAds, else the nightly ads cache), PPC & Organic the advertised-product report per ASIN — see "Why they differ" below, week by week.' });
    sp.sub = sub;
    out.push(sp);
    // week by week: Overview SP · Amazon's per-ASIN report as the nightly cached it (adsAsin) · PPC & Organic's brand rows · its unassigned rows
    weeks.forEach(w => {
      const cache = NC.ov.asin ? ncR2(bs.reduce((s, b) => s + Object.values(NC.ov.asin[b] || {}).reduce((t, byWk) => t + (byWk[w] ? Number(byWk[w][2]) || 0 : 0), 0), 0)) : null;
      // ASINs that both brands' reports hold for this week: PPC & Organic keeps ONE cell per ASIN, so the later brand's figures overwrite the earlier's
      const both = NC.ov.asin ? Object.keys(NC.ov.asin.SP || {}).filter(a => (NC.ov.asin.SP[a] || {})[w] && (NC.ov.asin.CPC || {})[a] && NC.ov.asin.CPC[a][w]) : [];
      const sharedSp = ncR2(both.reduce((s, a) => s + bs.reduce((t, b) => t + (Number(((NC.ov.asin[b] || {})[a] || {})[w] && NC.ov.asin[b][a][w][2]) || 0), 0), 0));
      NC.diag.sp.push({ view: vName, w, label: wLabel(w), ov: ovSum(bs, [w], 'sp'), cache, ppc: ncWSum(brandOnly, [w], 'spend'),
        unas: ncWSum(unas.rows, [w], 'spend'), shared: both.length, sharedSp });
    });
    const sb = ncNote('ovw-sb', name('ovw-sb'), vName, A('Sponsored Brands', ovSum(bs, weeks, 'sb')), { note: 'Only the Overview has Sponsored Brands (Amazon\'s matchAds). Days before matchAds count none.' });
    const sd = ncNote('ovw-sd', name('ovw-sd'), vName, A('Sponsored Display', ovSum(bs, weeks, 'sd')), { note: 'Only the Overview has Sponsored Display (Amazon\'s matchAds). Days before matchAds count none.' });
    const tot = ncNote('ovw-total', name('ovw-total'), vName, A('SP + SB + SD', ncR2(ovSum(bs, weeks, 'sp') + ovSum(bs, weeks, 'sb') + ovSum(bs, weeks, 'sd'))),
      { note: `What the Overview's Ad Spend row adds up for these weeks. PPC & Organic has Sponsored Products only (${ncMoney(ncWSum(pRows, weeks, 'spend'))}).` });
    [sb, sd, tot].forEach(r => { r.sub = sub; out.push(r); });
    // organic: total sales less ad sales, over the same weeks, each screen its own way (the sums floored at 0, as both do)
    const ovS = bs.every(b => weeks.every(w => ovSalesHas(b, w)));
    const ppS = bs.every(b => weeks.every(w => ncWHas(W, b, w, 'rev') && ncWHas(W, b, w, 'adSales')));
    /* DEFINITION DIFFERS (22 Nov 2026) — not a bug, a choice for a manager. Both definitions are shown, and a third figure: PPC &
     * Organic's own workbook sales less the Overview's ad sales (all types, 7-day), which splits the gap into the part that is the
     * SALES source and the part that is the AD-SALES definition. Neither screen changes. */
    const X = ovS ? Math.max(0, ncR2(ovSum(bs, weeks, 'sales') - ovSum(bs, weeks, 'adSales'))) : null;
    const Y = ppS ? Math.max(0, ncR2(ncWSum(pRows, weeks, 'rev') - ncWSum(pRows, weeks, 'adSales'))) : null;
    const Z = ovS && ppS ? Math.max(0, ncR2(ncWSum(pRows, weeks, 'rev') - ovSum(bs, weeks, 'adSales'))) : null;
    const org = ncRow('ovw-organic', name('ovw-organic'), vName,
      A('Seller Central sales − all ad types\' 7-day ad sales', X),
      B('workbook sales − Sponsored Products\' 30-day ad sales', Y), 'defn',
      { missing: `${!ovS ? 'Overview sales' : 'PPC & Organic sales or ad sales'} not loaded for every one of these weeks — not $0.`,
        ok: 'The two definitions give the same figure for these weeks.',
        off: `Definition differs — needs a manager decision. Overview: Seller Central sales less every ad type's 7-day ad sales. PPC & Organic: Orders-workbook sales less Sponsored Products' 30-day ad sales.`
          + (Z != null ? ` Of the ${ncMoney(ncR2(X - Y))} gap, ${ncMoney(ncR2(X - Z))} is the sales source (Seller Central vs workbook) and ${ncMoney(ncR2(Z - Y))} the ad-sales definition.` : '') });
    if (Z != null) org.extra = { label: 'PPC & Organic on the Overview definition (its workbook sales − all ad types\' 7-day ad sales)', v: Z };
    org.sub = sub;
    out.push(org);
  });
  // each screen's Both = its Ridhi + CPC, over the Both window
  if (adBs.length === 2) {
    const weeks = wins.ALL;
    if (!weeks) ['ovw-both', 'ppc-both13'].forEach(id => out.push(ncSkip(id, name(id), 'Both', (out.find(r => r.view === 'Both' && r.status === 'skip') || {}).why || 'Not loaded yet.')));
    else {
      const sub = span(weeks);
      const all = f => ncR2(['sp', 'sb', 'sd'].reduce((s, k) => s + ovSum(['SP', 'CPC'], weeks, k), 0));
      const one = b => ncR2(['sp', 'sb', 'sd'].reduce((s, k) => s + ovSum([b], weeks, k), 0));
      const r1 = ncRow('ovw-both', name('ovw-both'), 'Both', { label: 'Overview · Both', v: all(), at: ovAt(['SP', 'CPC']) },
        { label: 'Overview · Ridhi + CPC', v: ncR2(one('SP') + one('CPC')), at: ovAt(['SP', 'CPC']) }, 'exact', { off: 'The Overview\'s Both is not its two brands added.' });
      const n = Object.values(W.rows).filter(r => r.brand !== 'SP' && r.brand !== 'CPC').length;
      const r2 = ncRow('ppc-both13', name('ppc-both13'), 'Both', { label: 'PPC & Organic · Both (every row)', v: ncWSum(ncWRows(W, 'ALL'), weeks, 'spend'), at: ppAt(['SP', 'CPC']) },
        { label: 'PPC & Organic · Ridhi + CPC', v: ncR2(ncWSum(ncWRows(W, 'SP'), weeks, 'spend') + ncWSum(ncWRows(W, 'CPC'), weeks, 'spend')), at: ppAt(['SP', 'CPC']) }, 'exact',
        { off: `"All" also counts ${n} row${n === 1 ? '' : 's'} with no brand — those show in Both but in neither brand.` });
      [r1, r2].forEach(r => { r.sub = sub; out.push(r); });
    }
  }
  return out;
}

// The verdict of a run: how many match, differ on purpose (explained), differ, could not be checked (not loaded / no access), or are
// shown only (one screen has the figure).
function ncCounts(res) {
  const c = { ok: 0, info: 0, warn: 0, skip: 0, note: 0, defn: 0 };
  (res || []).forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
  return c;
}

/* ---------- loading: only what a screen would read, read-only ---------- */
async function ncLoad() {
  const jobs = [];
  if (ncMay('sales')) jobs.push((async () => {
    if (typeof SD_BUSY !== 'undefined' && SD_BUSY) { try { await SD_BUSY; } catch (e) { /* the saved copy stays */ } }
    if (!SD.at && !sdLoadLocal()) {
      const reply = await baCall({ cache: 'daily' });                 // the nightly history, a cache read
      if (!SD.at && reply && reply.data && reply.data.at) SD = { at: reply.data.at, d: reply.data.d || {} };
    }
    await tMatchEnsure();                                             // Seller Central's totals: two cache reads
  })().catch(() => {}));
  if (ncAdsOk() || ncMay('profit')) jobs.push((async () => { if (!ncW()) await dashLoadAds(); })().catch(() => {}));
  // the Overview: its saved snapshot, and the caches it lays over it when it opens (ncOvDays) — each a read, kept in NC.ov, never saved
  if (ncMay('trends')) jobs.push((async () => {
    const got = await Promise.all([
      !TREND.at && !Object.keys(TREND.d.SP || {}).length && !Object.keys(TREND.d.CPC || {}).length ? loadTrends() : null,
      baCall({ cache: 'ads' }).catch(() => null),
      baCall({ cache: 'daily' }).catch(() => null),
      tMatchEnsure().catch(() => null),
      baCall({ cache: 'adsAsin' }).catch(() => null),        // Amazon's per-ASIN ad report as the nightly cached it ("Why they differ")
    ]);
    const [, ads, daily, , asin] = got;
    if (asin && asin.data && asin.data.d) { NC.ov.asin = asin.data.d; NC.ov.asinAt = asin.data.at || ''; }
    if (ads && ads.data && ads.data.d) { NC.ov.ads = ads.data.d; NC.ov.adsAt = ads.data.at || ''; }
    if (daily && daily.data && daily.data.d) { NC.ov.daily = daily.data.d; NC.ov.dailyAt = daily.data.at || ''; }
  })().catch(() => {}));
  if (ncMay('age')) jobs.push((async () => { if (!AGE_LOADED) await loadAgeCache(); })().catch(() => {}));
  await Promise.all(jobs);
}

// Run every check: load what is missing (unless noLoad), compare, keep the result, repaint the chip and this screen.
// window.salesCheck() — the same from the console; returns the rows and prints them as a table.
async function salesCheck(opts) {
  opts = opts || {};
  if (NC.busy) return NC.busy;
  const run = (async () => {
    await 0;                                       // NC.busy is set before any of this runs
    try {
      if (!opts.noLoad) await ncLoad();
      NC.res = ncRun();
      NC.at = Date.now();
      NC.err = '';
    } catch (e) {
      NC.err = String((e && e.message) || e || '');
    } finally {
      if (NC.busy === run) NC.busy = null;
    }
    ncChipPaint();
    if (ncShown()) ncRender();
    if (!opts.quiet && typeof console !== 'undefined' && console.table && NC.res) {
      console.table(NC.res.map(r => ({ check: r.name, brand: r.view, A: r.a ? r.a.label + ' ' + r.a.v : '', B: r.b ? r.b.label + ' ' + r.b.v : '',
        diff: r.diff, pct: r.pct == null ? '' : r.pct.toFixed(2) + '%', result: r.status, why: r.why })));
      [['Sponsored Products, week by week', NC.diag.sp], ['Profit & Margin vs Sales Dashboard, week by week', NC.diag.pm], ['Seller Central vs workbook, by day', (NC.diag.days || []).slice(0, 12)]]
        .forEach(([t, rows]) => { if (rows && rows.length) { console.log(t); console.table(rows); } });
    }
    return NC.res;
  })();
  NC.busy = run;
  return run;
}
try { window.salesCheck = salesCheck; } catch (e) { /* no window (tests) */ }

// The Dashboard's loads landing: check again on what is now in memory (no loading of its own), once things settle.
function ncSoon() {
  clearTimeout(NC.soonT);
  NC.soonT = setTimeout(() => { salesCheck({ noLoad: true, quiet: true }); }, 700);
}

/* ---------- the chip: Dashboard (under the greeting) and Sales Dashboard (top bar) ---------- */
function ncChipPaint() {
  ['ncChipDash', 'ncChipSd'].forEach(id => {
    const el = $(id);
    if (!el) return;
    const c = ncCounts(NC.res);
    const ran = NC.res && (c.ok + c.info + c.warn) > 0;
    if (!ncMay('ncheck') || !ran) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('is-warn', c.warn > 0);
    el.textContent = c.warn ? `⚠ ${c.warn} difference${c.warn === 1 ? '' : 's'}` : `🔒 Numbers checked ✓ ${ncHm(NC.at)}`;
    el.title = c.warn
      ? `${c.warn} number${c.warn === 1 ? '' : 's'} differ between screens — open Numbers Check`
      : `Every number compared matched (${c.ok} exact, ${c.info} differ on purpose) — open Numbers Check`;
  });
}

/* ---------- WHY THEY DIFFER: the gaps taken apart, week by week (22 Nov 2026) ----------
 * Sponsored Products: Overview (Amazon's campaign totals) − Amazon's per-ASIN report as the nightly cached it (adsAsin) = what the
 *   per-ASIN report does not carry (the backend skips a report row with no ASIN); that report − PPC & Organic (brand rows +
 *   unassigned) = what was lost merging it into PPC & Organic (an ASIN both brands' reports hold keeps ONE cell — the later brand's
 *   figures overwrite the earlier's). Profit & Margin: its weekly sales − the Sales Dashboard's own workbook days = what the weekly
 *   per-ASIN cache adds differently; the workbook days − the Sales Dashboard as shown = Seller Central's totals laid over them, and
 *   the days where that is biggest. Nothing here is judged; it is the arithmetic, for whoever looks into it. */
function ncDiagHtml() {
  const d = NC.diag || {};
  const m = v => (v == null ? '<span class="nc-na">—</span>' : ncMoney(v));
  const pct = (a, b) => (a == null || !b ? '' : ` <span class="nc-sub" style="display:inline">(${(a / b * 100 > 0 ? '+' : '') + (a / b * 100).toFixed(2)}%)</span>`);
  const tbl = (head, rows) => `<div class="nc-scroll"><table class="nc-tbl"><thead><tr>${head.map((h, i) => `<th${i > 1 ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  let html = '';
  if ((d.sp || []).length) {
    html += '<h3>Sponsored Products: Overview vs PPC & Organic, week by week</h3><p class="muted">Overview − Amazon\'s per-ASIN report = spend the per-ASIN report does not carry (its rows with no ASIN are skipped). Per-ASIN report − PPC & Organic = spend lost merging it in (an ASIN in both brands\' reports keeps one cell).</p>'
      + tbl(['Brand', 'Week', 'Overview SP', 'Amazon per-ASIN report', 'PPC & Organic (brand rows)', '+ unassigned', 'Gap after unassigned', 'Overview − per-ASIN report', 'Per-ASIN report − PPC', 'ASINs in both brands\' reports'],
        d.sp.map(x => {
          const p = ncR2(x.ppc + x.unas), gap = ncR2(x.ov - p);
          return `<tr><td>${ncEsc(x.view)}</td><td>${ncEsc(x.label)}</td><td class="num">${m(x.ov)}</td><td class="num">${m(x.cache)}</td><td class="num">${m(x.ppc)}</td>`
            + `<td class="num">${m(x.unas)}</td><td class="num">${m(gap)}${pct(gap, p)}</td><td class="num">${x.cache == null ? m(null) : m(ncR2(x.ov - x.cache))}</td>`
            + `<td class="num">${x.cache == null ? m(null) : m(ncR2(x.cache - p))}</td><td class="num">${x.shared ? `${x.shared} · ${ncMoney(x.sharedSp)}` : '0'}</td></tr>`;
        }).join(''));
  }
  if ((d.pm || []).length) {
    html += '<h3>Profit & Margin vs Sales Dashboard, week by week</h3><p class="muted">Profit & Margin adds the weekly per-ASIN cache; the Sales Dashboard\'s own workbook days are the same Orders workbooks added per day; the Sales Dashboard as shown lays Seller Central\'s totals over them.</p>'
      + tbl(['Brand', 'Week', 'Profit & Margin', 'Sales Dashboard workbook days', 'Sales Dashboard as shown', 'P&M − workbook days', 'Workbook − Seller Central', 'P&M − shown'],
        d.pm.map(x => `<tr><td>${ncEsc(x.view)}</td><td>${ncEsc(x.label)}</td><td class="num">${m(x.pm)}</td><td class="num">${m(x.wb)}</td><td class="num">${m(x.sd)}</td>`
          + `<td class="num">${m(ncR2(x.pm - x.wb))}${pct(ncR2(x.pm - x.wb), x.wb)}</td><td class="num">${m(ncR2(x.wb - x.sd))}${pct(ncR2(x.wb - x.sd), x.sd)}</td>`
          + `<td class="num">${m(ncR2(x.pm - x.sd))}${pct(ncR2(x.pm - x.sd), x.sd)}</td></tr>`).join(''));
  }
  const days = (d.days || []).filter(x => x.diff != null && Math.abs(x.diff) >= 0.01).slice(0, 12);
  if (days.length) {
    html += '<h3>Days where Seller Central and the Orders workbook differ most</h3><p class="muted">Seller Central counts what was ORDERED that US day. The workbook leaves out Cancelled, MCF and other marketplaces, and gets the newest orders after the nightly run — open the day in Seller Central and the Orders workbook to see which orders.</p>'
      + tbl(['Brand', 'Day', 'Orders workbook', 'Seller Central', 'Seller Central − workbook', 'Units (workbook / Seller Central)'],
        days.map(x => `<tr><td>${ncEsc(x.brand)}</td><td>${ncEsc(x.day)}</td><td class="num">${m(x.wb)}</td><td class="num">${m(x.sc)}</td><td class="num">${m(x.diff)}${pct(x.diff, x.wb)}</td>`
          + `<td class="num">${x.units ? x.units.join(' / ') : '—'}</td></tr>`).join(''));
  }
  return html ? `<section class="nc-sec nc-diag"><h2>Why they differ</h2><p class="muted">The arithmetic behind the gaps above, from the same loaded data. window.salesCheckDiag() returns it.</p>${html}</section>` : '';
}
try { window.salesCheckDiag = () => NC.diag; } catch (e) { /* no window (tests) */ }

/* ---------- the screen ---------- */
const ncShown = () => !!$('paneNcheck') && !$('paneNcheck').classList.contains('hide');
async function ensureNcheck() {
  ncRender();
  await salesCheck({ quiet: true });
}
// Draw the screen: summary cards, the checks table, the rule book.
function ncRender() {
  const root = $('ncPane');
  if (!root) return;
  const c = ncCounts(NC.res);
  const busy = !!NC.busy;
  const kpi = (cls, label, val, sub) => `<div class="nc-kpi ${cls}"><div class="lbl">${label}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const pct = v => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%');
  const val = (r, side) => (r.unit === 'n' ? ncNum(side.v) : ncMoney(side.v));
  const mark = r => (r.status === 'ok' ? '<span class="nc-mark is-ok">✓ match</span>'
    : r.status === 'info' ? '<span class="nc-mark is-ok">✓ explained</span>'
      : r.status === 'warn' ? '<span class="nc-mark is-warn">⚠ differs</span>'
        : r.status === 'note' ? '<span class="nc-mark is-note">shown only</span>'
        : r.status === 'defn' ? '<span class="nc-mark is-defn">definition differs — needs manager decision</span>'
          : '<span class="nc-mark is-skip">' + (/access/.test(r.why || '') ? 'no access' : 'not loaded') + '</span>');
  // a side with no data: never $0 — "— not loaded" (or "— not in your access"), grey
  const none = r => `<span class="nc-na">— ${/access/.test(r.why || '') ? 'not in your access' : 'not loaded'}</span>`;
  const side = (r, sd) => (!sd ? none(r) : `${sd.v == null ? none(r) : val(r, sd)}<span class="nc-sub">${ncEsc(sd.label)}</span>${sd.at ? `<span class="nc-sub">${ncEsc(sd.at)}</span>` : ''}`);
  // one heading row per check (its name and the allowed gap), then a row per brand
  let rows = '', lastId = '';
  (NC.res || []).forEach(r => {
    if (r.id !== lastId) {
      const tol = (NC.res.find(x => x.id === r.id && x.tol) || {}).tol;
      rows += `<tr class="nc-grp"><td colspan="7"><span class="nc-name">${ncEsc(r.name)}</span>${tol ? `<span class="nc-tol">allowed: ${ncEsc(tol)}</span>` : ''}</td></tr>`;
      lastId = r.id;
    }
    rows += r.status === 'skip'
      ? `<tr class="is-skip"><td>${ncEsc(r.view)}</td><td class="num">${side(r, r.a)}</td><td class="num">${side(r, r.b)}</td><td class="num">—</td><td class="num">—</td><td>${mark(r)}</td><td class="nc-why">${ncEsc(r.why)}</td></tr>`
      : r.status === 'note'
      ? `<tr class="is-note"><td>${ncEsc(r.view)}${r.sub ? `<span class="nc-sub">${ncEsc(r.sub)}</span>` : ''}</td><td class="num">${side(r, r.a)}</td><td class="num"><span class="nc-na">— Overview only</span></td><td class="num">—</td><td class="num">—</td><td>${mark(r)}</td><td class="nc-why">${ncEsc(r.why)}</td></tr>`
      : `<tr class="is-${r.status === 'warn' ? 'warn' : r.status === 'defn' ? 'defn' : 'ok'}"><td>${ncEsc(r.view)}${r.sub ? `<span class="nc-sub">${ncEsc(r.sub)}</span>` : ''}</td>`
        + `<td class="num">${val(r, r.a)}<span class="nc-sub">${ncEsc(r.a.label)}</span><span class="nc-sub">${ncEsc(r.a.at || '')}</span></td>`
        + `<td class="num">${val(r, r.b)}<span class="nc-sub">${ncEsc(r.b.label)}</span><span class="nc-sub">${ncEsc(r.b.at || '')}</span>`
        + (r.extra ? `<span class="nc-sub"><b>${val(r, r.extra)}</b> ${ncEsc(r.extra.label)}</span>` : '') + '</td>'
        + `<td class="num">${r.unit === 'n' ? ncNum(r.diff) : ncMoney(r.diff)}</td><td class="num">${pct(r.pct)}</td>`
        + `<td>${mark(r)}</td><td class="nc-why">${ncEsc(r.why || (r.status !== 'ok' ? '' : Math.abs(r.diff) < (r.unit === 'n' ? 0.5 : 0.005) ? 'Same number on both screens.' : 'Within the allowed gap (' + r.tol.split(' — ')[0] + ').'))}</td></tr>`;
  });
  const rule = x => `<details><summary><b>${ncEsc(x.name)}</b><span>${ncEsc(x.line)}</span></summary><dl>`
    + [['Screens', x.screens], ['Data source', x.source], ['Formula', x.formula], ['Day cut-off', x.day], ['Included / excluded', x.incl],
      ['Brands', x.brand], ['Rounding', x.round], ['How fresh', x.fresh]].map(([k, v]) => `<dt>${k}</dt><dd>${ncEsc(v)}</dd>`).join('') + '</dl></details>';
  root.innerHTML = `<div class="nc-wrap">
    <div class="nc-head"><p>The same number, compared where two screens show it — each side worked out by its own screen's code, from data already loaded or cached. Nothing is refreshed from Amazon and nothing is written.</p>
      <button type="button" id="ncAgain" class="ghost sa-btn-sm"${busy ? ' disabled' : ''}>${busy ? 'Checking…' : 'Check again'}</button></div>
    ${NC.err ? `<div class="err">${ncEsc(NC.err)}</div>` : ''}
    <div class="nc-kpis">
      ${kpi('is-ok', '✓ Matching', NC.res ? ncNum(c.ok) : '—', 'exactly the same')}
      ${kpi('is-ok', '✓ Explained', NC.res ? ncNum(c.info) : '—', 'differ on purpose, within the allowed gap')}
      ${kpi(c.warn ? 'is-warn' : '', '⚠ Differing', NC.res ? ncNum(c.warn) : '—', 'outside the allowed gap')}
      ${kpi('', 'Last checked', NC.at ? ncHm(NC.at) : busy ? '…' : '—', NC.at ? new Date(NC.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' · this browser' + (c.skip ? ` · ${c.skip} not loaded / no access` : '') + (c.note ? ` · ${c.note} shown only` : '') + (c.defn ? ` · ${c.defn} definition differs` : '') : 'checking…')}
    </div>
    <section class="nc-sec"><h2>Checks</h2><p class="muted">Ridhi, CPC and Both. "Explained" means the gap is the documented reason on the right and within the allowed gap.</p>
      <div class="nc-scroll"><table class="nc-tbl"><thead><tr><th>Brand</th><th class="num">Value A</th><th class="num">Value B</th><th class="num">Difference</th><th class="num">%</th><th>Result</th><th>Why</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="muted">${busy ? 'Checking…' : 'Not checked yet.'}</td></tr>`}</tbody></table></div></section>
    ${ncDiagHtml()}
    <section class="nc-sec"><h2>Rule book</h2><p class="muted">${NC_RULES.length} numbers — one line each; open one for its source, formula, day cut-off, what is in and out, brands, rounding and freshness. The same text is in docs/sales-metrics.md.</p>
      <div class="nc-rules">${NC_RULES.map(rule).join('')}</div>
      <h2 style="margin-top:16px">Worked out in more than one place</h2><ul class="nc-risk">${NC_RISKS.map(t => `<li>${ncEsc(t)}</li>`).join('')}</ul></section>
  </div>`;
}

// The buttons: "Check again" on the screen, and either chip → this screen.
document.addEventListener('click', e => {
  const t = e.target && e.target.closest ? e.target : null;
  if (!t) return;
  if (t.closest('#ncAgain')) { salesCheck({ quiet: true }); ncRender(); return; }
  if (t.closest('#ncChipDash') || t.closest('#ncChipSd')) { if (ncMay('ncheck')) showTab('ncheck'); }
});
