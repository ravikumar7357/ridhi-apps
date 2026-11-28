# Sellora — sales, ads and stock numbers: the rule book

Written 21 Nov 2026 (Sales card #1, "Numbers Check"); the Forecast rules added 25 Nov 2026 (Sales card #5). **This file documents the code as it is — no formula was changed.**
The same rules show on the Numbers Check screen (Sales → Check & alerts), drawn from `NC_RULES` in
`src/app/sales/sales-check.js`; `tests/sales-metrics-test.js` fails when a rule is missing here. The golden values that lock
each formula are in that test.

**Words used below.** *PT* = US Pacific time, the "US portal day" Seller Central uses. *Workbook* = the Orders workbooks
(one per brand) the backend reads. *Seller Central totals* = Amazon's Business Report day totals (matchBiz cache) and ad
totals (matchAds cache). *Ridhi* = brand key SP. *Both* / *All*: see each rule — they do not mean the same everywhere.

## The rules (44 numbers)

### Sales

Money customers ordered for, on the US portal day — before refunds, without tax or shipping.

- **Screens:** Sales Dashboard (every card), Dashboard (Sales MTD / YTD, 90-day line)
- **Data source:** Nightly cache "daily" (Orders workbooks + Shopify), kept in this browser (sd.daily.v1); the live top-up (daily:recent) overwrites the last 3 days, then the month + 7 days (at most 40). Ridhi / CPC days that Seller Central has published are replaced by its Business Report "Ordered Product Sales" (matchBiz cache).
- **Formula:** sdSum(from, to)[0] = Σ day[0] for from ≤ day ≤ to (inclusive), rounded to the cent after adding.
- **Day cut-off:** US Pacific (PT) — the "US portal day", the same as Seller Central. Shopify days are the store's own date (created_at), not PT.
- **Included / excluded:** Amazon.com only (other marketplaces dropped, a blank channel kept). Pending counted. Cancelled dropped. MCF dropped. Refunds NOT taken off (ordered sales). Shopify: every order except "voided" (a refunded order still counts), price × quantity, before discounts, no shipping or tax.
- **Brands:** Sales Dashboard toggle: Ridhi (SP) · CPC · Shopify · All (= all three). Dashboard "Both" = Ridhi + CPC — no Shopify.
- **Rounding:** Cents inside; shown as whole dollars (sdMoney).
- **How fresh:** Nightly; today from the live top-up (re-read when the tab opens, at most every 10 min). Seller Central publishes a day 1–2 days late, so the newest days stay on the workbooks.

### Units (Quantity)

Units ordered on the US portal day.

- **Screens:** Sales Dashboard (period table "Quantity", Custom Range)
- **Data source:** As Sales: day[1]; Business Report "Units Ordered" where published.
- **Formula:** Σ day[1] over the range.
- **Day cut-off:** PT (Shopify: store date).
- **Included / excluded:** As Sales.
- **Brands:** As Sales.
- **Rounding:** Whole units (sdNum).
- **How fresh:** As Sales.

### Orders (Order items)

How many orders came in — counted two ways, see the note.

- **Screens:** Sales Dashboard ("Order items" row, Custom Range), Overview ("Order items" row; its KPI card says "Orders")
- **Data source:** day[2]: Business Report "Total Order Items" for days Seller Central has published; the workbooks' count of DISTINCT order ids for the newest days; Shopify counts orders.
- **Formula:** Σ day[2] over the range. Workbook: a new order id = one more (the lines of one order sit together).
- **Day cut-off:** PT.
- **Included / excluded:** As Sales.
- **Brands:** As Sales.
- **Rounding:** Whole numbers.
- **How fresh:** As Sales — so the newest 1–2 days count orders while older days count order items (mixed in one row).

### Avg $ / item

Sales ÷ units in the Custom Range.

- **Screens:** Sales Dashboard (Custom Range)
- **Data source:** sdRange over the two dates.
- **Formula:** sales ÷ units (sum[0] / sum[1]) — per UNIT, though the label says item.
- **Day cut-off:** PT.
- **Included / excluded:** As Sales.
- **Brands:** The channel on view.
- **Rounding:** 2 decimals ("$12.34"); "—" with no units.
- **How fresh:** As Sales.

### Today

Today so far, on the US portal day — a part day.

- **Screens:** Sales Dashboard
- **Data source:** As Sales.
- **Formula:** sdSum(today, today); today = sdToday() (PT).
- **Day cut-off:** PT — in India the morning still shows the US day before.
- **Included / excluded:** As Sales.
- **Brands:** As Sales.
- **Rounding:** Whole $.
- **How fresh:** Live top-up.

### Yesterday

The last complete US portal day.

- **Screens:** Sales Dashboard
- **Data source:** As Sales.
- **Formula:** sdSum(yesterday, yesterday).
- **Day cut-off:** PT.
- **Included / excluded:** As Sales.
- **Brands:** As Sales.
- **Rounding:** Whole $.
- **How fresh:** Live top-up.

### Last 7 days

The 7 complete days ending yesterday, against the same 7 dates last year.

- **Screens:** Sales Dashboard
- **Data source:** As Sales.
- **Formula:** sdSum(yesterday − 6, yesterday); %Δ vs sdSum of the same dates a year earlier.
- **Day cut-off:** PT.
- **Included / excluded:** As Sales.
- **Brands:** As Sales.
- **Rounding:** Whole $; %Δ 1 decimal.
- **How fresh:** As Sales.

### WTD (week to date)

Not shown as such. The nearest is PPC & Organic's running week (Sunday → Saturday, "n of 7 days").

- **Screens:** PPC & Organic, Product Performance (running week column)
- **Data source:** PPC & Organic store (WEEKLY).
- **Formula:** Σ of the week's cells so far; never compared until the week finishes (wWeekDone).
- **Day cut-off:** Weeks start Sunday; "finished" is judged in PT.
- **Included / excluded:** As PPC weekly sales.
- **Brands:** As PPC weekly sales.
- **Rounding:** Whole $.
- **How fresh:** Nightly.

### MTD

This month so far INCLUDING today; the %Δ compares complete days only, both years.

- **Screens:** Sales Dashboard, Dashboard (Sales MTD card, ticker)
- **Data source:** As Sales.
- **Formula:** Value = sdSum(month start, today). %Δ = sdSum(month start, yesterday) vs the same dates last year.
- **Day cut-off:** PT.
- **Included / excluded:** As Sales.
- **Brands:** As Sales (Dashboard Both = Ridhi + CPC).
- **Rounding:** Whole $; %Δ 1 decimal.
- **How fresh:** As Sales.

### YTD

This year so far including today; %Δ on complete days, both years.

- **Screens:** Sales Dashboard, Dashboard (Sales YTD card)
- **Data source:** As Sales.
- **Formula:** Value = sdSum(1 Jan, today). %Δ = sdSum(1 Jan, yesterday) vs the same dates last year.
- **Day cut-off:** PT.
- **Included / excluded:** As Sales.
- **Brands:** As Sales (Dashboard Both = Ridhi + CPC).
- **Rounding:** Whole $; %Δ 1 decimal.
- **How fresh:** As Sales.

### LY and %Δ

Last year = the same calendar dates a year earlier; %Δ = (now − LY) ÷ LY.

- **Screens:** Sales Dashboard (cards, period table, monthly table), Dashboard (MTD / YTD cards)
- **Data source:** As Sales (the nightly history holds last year).
- **Formula:** sdLastYear(date) = year − 1, same month-day. sdDelta / dashDelta: (now − was) ÷ was × 100, ▲ / ▼.
- **Day cut-off:** PT. 29 Feb has no last-year day.
- **Included / excluded:** As Sales.
- **Brands:** As Sales.
- **Rounding:** 1 decimal; "—" when last year is 0 (never "+100%").
- **How fresh:** As Sales. NOTE the period table compares MTD / YTD INCLUDING today with last year up to yesterday; the cards use complete days on both sides.

### Expected — month

Where the month lands if the last 7 complete days keep up.

- **Screens:** Sales Dashboard
- **Data source:** As Sales.
- **Formula:** MTD to yesterday + (Last 7 days ÷ 7) × (days in month − complete days so far). On the 1st: (Last 7 days ÷ 7) × days in month. Compared with the whole of last month, and with the same number of days of last month.
- **Day cut-off:** PT.
- **Included / excluded:** As Sales.
- **Brands:** As Sales.
- **Rounding:** Whole $; %Δ 1 decimal.
- **How fresh:** As Sales.

### Monthly TY vs LY

Each month this year beside the same month last year.

- **Screens:** Sales Dashboard (table + chart)
- **Data source:** As Sales.
- **Formula:** sdSum(YYYY-MM-01, last day) for each year; a month neither year has is left out.
- **Day cut-off:** PT.
- **Included / excluded:** As Sales.
- **Brands:** As Sales.
- **Rounding:** Whole $; %Δ 1 decimal.
- **How fresh:** As Sales.

### PPC weekly sales

Sales per ASIN per Sunday→Saturday week, added from the Orders workbooks.

- **Screens:** PPC & Organic, Product Performance (rows), Profit & Margin, Parent Listing Review, Dashboard (PPC · weekly bars)
- **Data source:** Cache "weekly" (Orders workbook, per ASIN) merged into Firestore audit/weekly + weeklyrows/* (WEEKLY).
- **Formula:** Σ revenue (col G) of the week's rows per ASIN; a parent adds its children.
- **Day cut-off:** Weeks keyed by the Sunday; rows dated by the PT purchase date.
- **Included / excluded:** Amazon.com only, MCF and Cancelled out, refunds not taken off. No Shopify. Workbook figures — never Seller Central's.
- **Brands:** By the workbook the ASIN came from (book 0 = Ridhi, 1 = CPC). "All" keeps every row, also a row with no brand.
- **Rounding:** Cents when added (wAddCell); whole $ on screen.
- **How fresh:** Nightly; folded in when PPC & Organic / Product Performance / Parent Listing Review open.

### Ad spend

What the ads cost — Sponsored Products only on most screens; all ad types on Overview.

- **Screens:** PPC & Organic, Product Performance, Dashboard (Ad spend · latest week), Overview, Placement, Search Term Analysis, Profit & Margin
- **Data source:** PPC & Organic / Product Performance / Profit & Margin / Dashboard: cache adsAsin (Sponsored Products, per ASIN per week) in WEEKLY. Product Performance "All" row: matchAds (SP). Overview: matchAds SP + SB + SD where it holds the day, else SP. Placement: nightly placement cache (SP, 30 days) or settled 7-day pack. Search Term Analysis: target rows (SP, settled 7-day or 30-day pack).
- **Formula:** Σ cost over the cells / days in view. Dashboard: Σ spend of the newest week in WEEKLY (often still running).
- **Day cut-off:** Report days are PT; weeks Sunday → Saturday.
- **Included / excluded:** Sponsored Products (+ Brands, Display on Overview where matchAds holds the day).
- **Brands:** Each brand is its own ads profile; Both = the two added.
- **Rounding:** Whole $ (Placement / Search terms: whole or 2 decimals).
- **How fresh:** Ads land 1–2 days after the day; nightly.

### Ad sales

Sales Amazon credits to an ad click.

- **Screens:** PPC & Organic, Product Performance, Overview, Placement, Search Term Analysis
- **Data source:** Weekly per ASIN: SP 30-day attributed sales (adsAsin). Product Performance All row: matchAds SP 7-day. Overview: matchAds SP 7-day + SB + SD where held, else SP 30-day. Placement table: 30-day; Placement cards / Search terms: 7-day settled where available.
- **Formula:** Σ attributed sales over the cells / days.
- **Day cut-off:** PT report days.
- **Included / excluded:** Attribution window differs by screen (7 vs 30 days).
- **Brands:** Per ads profile.
- **Rounding:** Whole $.
- **How fresh:** A 30-day window keeps growing for 30 days after the click.

### Organic sales

Sales not credited to an ad.

- **Screens:** PPC & Organic, Product Performance, Overview
- **Data source:** From Sales and Ad sales of the same cell / period.
- **Formula:** max(0, sales − ad sales). Product Performance: over the days the ad report covers only.
- **Day cut-off:** As its inputs.
- **Included / excluded:** As its inputs.
- **Brands:** As its inputs.
- **Rounding:** Whole $.
- **How fresh:** As Ad sales.

### TACoS

Ad spend ÷ TOTAL sales.

- **Screens:** PPC & Organic, Product Performance, Overview, Profit & Margin, Dashboard (Ad spend card, ticker), Search Term Analysis (Campaign × Product)
- **Data source:** Ad spend and Sales of that screen.
- **Formula:** spend ÷ sales × 100 — five variants: PPC & Organic (SP ÷ workbook sales), Product Performance rows (ad-covered days only), PP All row (matchAds SP ÷ Seller Central), Overview (all ad types ÷ Seller Central), PP chart (no overlay).
- **Day cut-off:** As its inputs.
- **Included / excluded:** As its inputs.
- **Brands:** As its inputs.
- **Rounding:** Dashboard / PPC & Organic card: whole % (Math.round); grids 1 decimal under 10 %, else whole; Overview 1 decimal.
- **How fresh:** As Ad spend.

### ACoS

Ad spend ÷ AD sales.

- **Screens:** PPC & Organic, Product Performance, Overview, Placement, Search Term Analysis
- **Data source:** Ad spend and Ad sales of that screen.
- **Formula:** spend ÷ ad sales × 100; "—" with no ad sales.
- **Day cut-off:** As its inputs.
- **Included / excluded:** Window differs: 30-day (PPC & Organic, Placement table, Campaign × Product), 7-day (PP All row, Placement cards, Search terms), all types (Overview).
- **Brands:** Per ads profile.
- **Rounding:** PPC & Organic card whole %; Overview / Placement 1 decimal; Campaign × Product whole %.
- **How fresh:** As Ad sales.

### ROAS

Ad sales ÷ ad spend.

- **Screens:** Overview, Product Performance, Search Term Analysis (text)
- **Data source:** As ACoS.
- **Formula:** ad sales ÷ spend (Search terms also 100 ÷ ACoS).
- **Day cut-off:** As its inputs.
- **Included / excluded:** As ACoS.
- **Brands:** Per ads profile.
- **Rounding:** 2 decimals.
- **How fresh:** As Ad sales.

### Organic share

The part of sales not credited to ads.

- **Screens:** PPC & Organic (card + Ad % / Organic % grid), Product Performance, Overview
- **Data source:** Sales and Ad sales.
- **Formula:** PPC & Organic card: (sales − ad sales) ÷ sales × 100, NOT floored. Grid: 100 − ad %, floored at 0. Overview / PP: max(0, sales − ad sales) ÷ sales.
- **Day cut-off:** As its inputs.
- **Included / excluded:** As its inputs.
- **Brands:** As its inputs.
- **Rounding:** Whole % (card); 1 decimal (Overview).
- **How fresh:** As Ad sales.

### Sessions

Visits to the product pages.

- **Screens:** PPC & Organic, Product Performance, Overview (Sessions box), Parent Listing Review
- **Data source:** Per ASIN per week: Amazon traffic report (cache "sessions"). Overview box and PP All row: Seller Central "Sessions – Total" (matchBiz), else the weekly cache.
- **Formula:** Σ sessions. A parent adds its children (one visit to two sizes counts twice).
- **Day cut-off:** Weeks Sunday → Saturday; PT.
- **Included / excluded:** Amazon only.
- **Brands:** Per brand.
- **Rounding:** Whole numbers.
- **How fresh:** Weekly traffic report; can be missing for the running week.

### CVR

Two different numbers carry this name — units ÷ sessions, or ad orders ÷ clicks.

- **Screens:** PPC & Organic (CVR = units ÷ sessions), Product Performance ("Unit session %" = units ÷ sessions; "SP conv. rate" = ad orders ÷ clicks), Overview / Placement / Search Term Analysis (CVR = orders ÷ clicks)
- **Data source:** As the inputs.
- **Formula:** units ÷ sessions × 100, or (ad) orders ÷ clicks × 100.
- **Day cut-off:** As its inputs.
- **Included / excluded:** As its inputs.
- **Brands:** As its inputs.
- **Rounding:** 1 decimal.
- **How fresh:** As its inputs.

### CTR

Clicks ÷ impressions.

- **Screens:** Overview, Product Performance (by campaign type)
- **Data source:** Ad report impressions and clicks.
- **Formula:** clicks ÷ impressions × 100.
- **Day cut-off:** PT report days.
- **Included / excluded:** Overview: all ad types where matchAds holds the day.
- **Brands:** Per ads profile.
- **Rounding:** 1 decimal (Overview card: 2).
- **How fresh:** As Ad spend.

### CPC

Cost per click.

- **Screens:** Overview, Product Performance, Placement, Search Term Analysis
- **Data source:** Ad spend and clicks.
- **Formula:** spend ÷ clicks; "—" with no clicks.
- **Day cut-off:** As its inputs.
- **Included / excluded:** As Ad spend.
- **Brands:** Per ads profile.
- **Rounding:** 2 decimals.
- **How fresh:** As Ad spend.

### Fees (est.)

An ESTIMATE: referral 15 % + FBA 11 % of sales — not Amazon's real fees.

- **Screens:** Profit & Margin
- **Data source:** The fee model PF_MODEL in Firestore audit/costs (editable: ref 15, fba 11, returns 10, overhead 10, salary 10).
- **Formula:** sales × ref % + sales × fba %.
- **Day cut-off:** Profit & Margin's weeks.
- **Included / excluded:** Gross ordered sales; no refunds.
- **Brands:** Ridhi / CPC / All (no ads-brand limit).
- **Rounding:** Whole $ (the sum rounded).
- **How fresh:** As PPC weekly sales.

### COGS

Unit cost × units sold.

- **Screens:** Profit & Margin
- **Data source:** Unit costs typed per ASIN (audit/costs) × WEEKLY units.
- **Formula:** unit cost × units; a parent adds child by child (only children with a cost).
- **Day cut-off:** Profit & Margin's weeks.
- **Included / excluded:** Rows with a cost only.
- **Brands:** As Profit & Margin.
- **Rounding:** Whole $.
- **How fresh:** Costs: when typed; units nightly.

### Profit

Sales less estimated fees, ads, COGS, returns, overhead and salary.

- **Screens:** Profit & Margin
- **Data source:** pfMoney(cell, unit cost).
- **Formula:** sales − referral − FBA − ad spend − COGS − returns (10 % of COGS) − overhead (10 % of sales) − salary (10 % of sales).
- **Day cut-off:** Profit & Margin's weeks (the newest is the running week).
- **Included / excluded:** Costed rows; gross ordered sales; returns only as the modelled %.
- **Brands:** As Profit & Margin.
- **Rounding:** Whole $; per unit 2 decimals.
- **How fresh:** As PPC weekly sales.

### Margin

Profit ÷ sales.

- **Screens:** Profit & Margin
- **Data source:** pfMoney.
- **Formula:** profit ÷ sales × 100; the card: Σ profit ÷ Σ sales of costed rows.
- **Day cut-off:** As Profit.
- **Included / excluded:** As Profit.
- **Brands:** As Profit.
- **Rounding:** 1 decimal.
- **How fresh:** As Profit.

### ROI

Profit ÷ COGS.

- **Screens:** Profit & Margin
- **Data source:** pfMoney.
- **Formula:** profit ÷ COGS × 100.
- **Day cut-off:** As Profit.
- **Included / excluded:** As Profit.
- **Brands:** As Profit.
- **Rounding:** Whole %.
- **How fresh:** As Profit.

### Aged units (181+)

Units in FBA that are 181 days old or more.

- **Screens:** Inventory Age, Dashboard (Aged 181+ tile, ticker)
- **Data source:** Firestore age/SP, age/CPC — Amazon's FBA inventory planning report, saved on "Refresh both brands" (at most 1,500 rows each).
- **Formula:** Keep the coarsest age buckets that do not overlap (totalCols); add every bucket STARTING at 181 days or later.
- **Day cut-off:** The snapshot's time.
- **Included / excluded:** FBA only; the snapshot's rows.
- **Brands:** Ridhi / CPC / Both (the two added).
- **Rounding:** Whole units.
- **How fresh:** Only as new as the last Refresh (amber after 7 days).

### Storage $

Amazon's estimated monthly storage fee for the stock in the snapshot.

- **Screens:** Inventory Age, Dashboard (Aged 181+ tile)
- **Data source:** age/{brand}: the report's first storage fee / cost / charge column (long-term storage left out).
- **Formula:** Σ storage over the rows.
- **Day cut-off:** The snapshot's time.
- **Included / excluded:** As Aged units.
- **Brands:** As Aged units.
- **Rounding:** 2 decimals.
- **How fresh:** As Aged units.

### Sales Analysis units / amount / share

Units and money per SKU per month, and each one's share of the month's units.

- **Screens:** Sales Analysis
- **Data source:** Firestore salesanalysis/{brand} + sarows/*, rebuilt by its button from the Orders workbook (no Amazon call).
- **Formula:** qty = Σ units, amt = Σ revenue per SKU-month (each rounded); share = units ÷ all units that month; rank = this month + last month.
- **Day cut-off:** PT months.
- **Included / excluded:** Amazon.com only, MCF and Cancelled out, refunds not taken off. Workbook figures — never Seller Central's.
- **Brands:** One brand at a time.
- **Rounding:** Whole numbers; share 1 decimal.
- **How fresh:** When last rebuilt.

### Parent Listing Review figures

Last week, the 6-week average, run rate and cover per parent.

- **Screens:** Parent Listing Review
- **Data source:** WEEKLY (sales, units, spend, sessions), Listing Health stock, launch dates.
- **Formula:** Avg = Σ of the last 6 finished weeks ÷ 6 (Prime Day week left out; INCLUDES last week). Run rate = last week × 52. "DOS" = stock ÷ last week's units ÷ (52 ÷ 12) — MONTHS of cover.
- **Day cut-off:** Finished weeks (PT).
- **Included / excluded:** As PPC weekly sales.
- **Brands:** Ridhi / CPC / Both within the ads brands.
- **Rounding:** Whole $; % whole; DOS 1 decimal.
- **How fresh:** Nightly.

### Forecast — weeks used

Units per product per finished week, the history every forecast starts from.

- **Screens:** Forecast (table, drawer chart, CSV, forecastCheck)
- **Data source:** The nightly per-product days (dailyAsin, 45 days) for the weeks they hold whole; PPC & Organic's weekly store (nightly "weekly" cache, u) for the 26 weeks before. The same units Numbers Check checks.
- **Formula:** Week = Σ day units Sun–Sat. Stock-out / suppressed time skipped: in daily weeks a zero run ≥ max(3, 3.9 ÷ units a day) days (or the last zero days when stock is 0 now) is taken out and the week = units ÷ live days × 7 (3+ live days, else skipped); an older week under 25 % of the product's usual week (usual ≥ 3) is skipped; a week the brand has no figure for at all is missing. Family = Σ children, a child out all week counted at its usual rate.
- **Day cut-off:** US Pacific, finished Sunday–Saturday weeks; the last one ends on or before the last finished day.
- **Included / excluded:** Amazon units (Ridhi, CPC). Shopify not in. Weeks before the first sale are not history.
- **Brands:** Ridhi · CPC · Both (each family in its own brand).
- **Rounding:** Units 1 decimal inside; shown whole.
- **How fresh:** Nightly (Amazon data 1–2 days late).

### Forecast — base

A product's usual week now.

- **Screens:** Forecast (drawer "Usually sells ~N/week", CSV "Usual units/week")
- **Data source:** Forecast — weeks used.
- **Formula:** Weighted average of the last 8 weeks (skipped ones left out; up to 12 weeks back to find 4), weights 8, 7 … 1 (last week 8); a week above 2 × the median of those weeks counts as 2 ×.
- **Day cut-off:** Finished weeks (PT).
- **Included / excluded:** Skipped weeks out.
- **Brands:** Per family and per child.
- **Rounding:** 1 decimal.
- **How fresh:** Nightly.

### Forecast — season

How the coming weeks usually differ from the last 8, from last year.

- **Screens:** Forecast (drawer story, chart "last year's pattern", forecastCheck)
- **Data source:** The brand's own daily history (Sales Dashboard, 800 days, day[1] units). Sellora keeps no per-product last year (the weekly cache is 26 weeks).
- **Formula:** LY week = Σ brand units 364 days back, averaged with the weeks either side. Factor = LY of the target week ÷ LY of the 8 base weeks (same weights), capped 0.5×–2×; only when last year's base weeks sold ≥ 50 units a week; used for a product only when its blind test with it is no worse than without (≤ 1.15 × + 2 points).
- **Day cut-off:** Weeks 364 days back (same weekdays).
- **Included / excluded:** Amazon brand totals.
- **Brands:** Each family takes its own brand's last year.
- **Rounding:** 2 decimals.
- **How fresh:** Nightly.

### Forecast — trend

A small, fading lean up or down.

- **Screens:** Forecast (drawer, forecastCheck)
- **Data source:** Forecast — base weeks, season taken out.
- **Formula:** g = ½ × ((newest half ÷ older half)^(1 ÷ weeks apart) − 1), capped ± 4 %/week; week h ahead × (1 + Σ g × 0.8^i, i = 1…h) — never more than ± 16 %.
- **Day cut-off:** Finished weeks.
- **Included / excluded:** As base.
- **Brands:** Per family and child.
- **Rounding:** 1 decimal %.
- **How fresh:** Nightly.

### Forecast — range and confidence

LOW–HIGH around the most likely, and how much to trust it.

- **Screens:** Forecast (range bars, tiles, pills, headline, "Accuracy last 8 weeks")
- **Data source:** The product's own blind test: the model from 8 weeks ago (fewer with a short history, at least 4), on data up to then only, against the weeks it did not see.
- **Formula:** Likely = Σ daily rate (week forecast ÷ 7) over the next 7 / 30 / 90 days from today. Error 7 d = Σ|actual − forecast| ÷ Σ actual (weekly); 30 d = mean of the 4-week blocks' |Σ actual − Σ forecast| ÷ Σ actual; 90 d = max(30 d, all 8 weeks) × 1.25; each at least 10 % and 1.28 ÷ √likely. LOW–HIGH = likely × (1 ∓ error). Confidence from the 30-day error: High ≤ 20 %, Medium ≤ 40 %, Low above. Gate: ≥ 8 weeks since the first sale and ≥ 3 units a week, else "Not enough history". A child with too few sales of its own: its family's error, Low. Headline = Σ families' likely, range from the brand total's own blind test (at least ± 5 %). Accuracy = families' 30-day test error weighted by their likely.
- **Day cut-off:** From today (PT).
- **Included / excluded:** Families with a forecast (headline: active ones).
- **Brands:** Ridhi · CPC · Both.
- **Rounding:** Whole units; % whole.
- **How fresh:** Nightly.

### Days of cover and runs out

How long the stock lasts, worst case first.

- **Screens:** Forecast (Cover, Runs out, Act first cards, drawer "Stock lasts A–B days")
- **Data source:** FBA units now (stock/{brand}, as Sales Alerts reads it) — else the Inventory Age snapshot; missing = "No stock data", never guessed. On the way: the same stock data's inbound (stock/{brand}.in, working + shipped + receiving per SKU); not carried = "Inbound: unknown" (today's documents carry none).
- **Formula:** Supply = available + on the way (available only when inbound is unknown; a SKU at 0 stays out until it arrives). From the stock's date, day by day: cumulative likely ≥ supply → likely cover; cumulative likely × (1 + error at that horizon) ≥ supply → HIGH-demand cover (the smaller). Days counted from today; beyond about half a year = "180+". Runs out = today + cover. A family = its TOTAL: its sizes with stock data (stock + on the way) against their forecast; a size missing from the stock data is "No stock data" (never 0) and left out on both sides.
- **Day cut-off:** PT days.
- **Included / excluded:** FBA available units (inbound not counted).
- **Brands:** Per child; family = its first to run out.
- **Rounding:** Whole days; dates "9 Dec".
- **How fresh:** Stock as of its own date.

### Reorder status

⛔ Out of stock · 🔴 Reorder now · 🟡 Reorder soon · 🟢 OK · Not selling · No stock data · ⚪ Not enough history.

- **Screens:** Forecast (chips, table, cards, drawer)
- **Data source:** Days of cover, the lead time (⚙ Settings: Ridhi / CPC, 60 days unless changed; "soon" window 30 — history/forecast, shared).
- **Formula:** ⛔ stock 0 and sold in the last 8 weeks (losing ~this week's forecast) — with units on the way "Out of stock — N on the way", amber, still first; Not selling: stock > 0 and ≤ 2 units in 8 weeks; ⚪ under the gate; No stock data; 🔴 HIGH-demand cover < lead time; 🟡 < lead time + soon; 🟢 otherwise. Hidden (inactive): stock 0 and no sale in 8 weeks. A family's status comes from its total; its sizes show as badges (⛔ N of M sizes out of stock · 🔴 N sizes need reorder · N sizes: no stock data).
- **Day cut-off:** Today (PT).
- **Included / excluded:** Active children (stock > 0 or sold in 8 weeks); "Stock > 0 only" shows only stocked ones.
- **Brands:** Each brand its own lead time.
- **Rounding:** A status, not a number.
- **How fresh:** As its inputs.

### Task verdict ("did it work?")

Whether a sales task (Action Tracker) changed the product's sales.

- **Screens:** Action Tracker (cards, drawer, CSV, the bell, taskCheck)
- **Data source:** The Forecast's weeks per family (PPC & Organic's weekly store + the nightly per-product days, out-of-stock / suppressed weeks skipped — the Sales Alerts families); the nightly per-product days after Done; Sales Alerts' own result; the Forecast status (reorder tasks).
- **Formula:** Baseline = average units/week of the 4 finished weeks before the week the task was made (skipped weeks left out; at least 2 needed; kept on the task when made). After = units over the 7 / 14 days after the done day ÷ days × 7 (older: whole weeks after it). Change = after ÷ baseline − 1. From day 7: "Early check: +X%". From day 14 (or day 7 when the task's maker chose a 7-day review window): ✅ Worked ≥ +15 % (or Sales Alerts no longer flags it and it is not below −15 %), ➖ No change −15 % … +15 %, ❌ Didn't work below −15 %. A reorder task from the Forecast: ✅ as soon as the family is no longer ⛔ / 🔴. The final verdict is kept on the task.
- **Day cut-off:** US Pacific days, Sunday–Saturday weeks (as Numbers Check); created / done / updated times shown in IST.
- **Included / excluded:** Amazon units (Ridhi, CPC); Shopify not in. Data missing (Amazon 1–2 days late) → "Not enough data yet".
- **Brands:** The task's own brand.
- **Rounding:** Units/week whole; % whole.
- **How fresh:** Nightly.

### Return rate

How many of what sold came back, per family and per SKU, per week.

- **Screens:** Sales Alerts (↩ Return spikes: cards, rows, chart, returnsCheck)
- **Data source:** Amazon's FBA Customer Returns report — the nightly cache "returns" once Pricing-API/Returns.gs runs, else the reports uploaded on Sales Alerts (history/returns_<brand>_<n>; a re-upload replaces rows with the same order, SKU, licence plate, date, quantity and reason). Units sold: the Forecast's weeks (PPC & Organic's weekly store + the nightly per-product days, the Sales Alerts families).
- **Formula:** Rate(week) = units returned that week ÷ units sold a week, averaged over that week and the week before ((sold this week + sold last week) ÷ 2) — returns come after the sale. A SKU's return is counted on its ASIN (the report's, else the SKU's in Sellora). Only weeks the returns data covers whole.
- **Day cut-off:** The return date on the US Pacific day (a timestamp is turned into PT); Sunday–Saturday weeks.
- **Included / excluded:** Amazon FBA customer returns (every disposition). Shopify not in.
- **Brands:** Ridhi · CPC · All (each family its own brand).
- **Rounding:** Whole % (one decimal under 1 %).
- **How fresh:** As the last upload / the nightly cache ("returns data up to <date>").

### Return spike

A family whose returns jumped in the last week the data covers.

- **Screens:** Sales Alerts (↩ Return spikes chip, cards, rows; the Action Tracker's return tasks)
- **Data source:** Return rate.
- **Formula:** Baseline = the 8 weeks before, pooled (Σ returned ÷ Σ sold a week), at least 4 covered weeks. Spike = rate ≥ 2 × baseline AND ≥ baseline + 3 points AND ≥ 5 units returned. 🔴 Critical when ≥ 3 × baseline or ≥ 15 %; else 🟡 Watch. "Returns 3% → 11% in 15–21 Nov (9 units) · top reason: Not as described (6)". No returns data: a note, never a number.
- **Day cut-off:** US Pacific weeks.
- **Included / excluded:** As Return rate.
- **Brands:** As Return rate.
- **Rounding:** Whole %; points whole.
- **How fresh:** As Return rate.

### BSR Audit — orders and revenue

Units ordered and ordered sales of a family in a period, beside its rank.

- **Screens:** BSR Audit (story line, Revenue / Orders cards, decision cards, table, panel chart and sizes, CSV)
- **Data source:** The same rows as Sales Alerts and the Forecast: the nightly per-product days (dailyAsin, [units, sales] per ASIN per day, 45 days); before them PPC & Organic's weekly store (WEEKLY u / rev, Sunday weeks, 26 weeks).
- **Formula:** Σ over the family's ASINs (Listing Health's parent) of the days in the period. A week wholly before the per-day data = its weekly total; the part of a week before it = the week's total − its days in the per-day data; a part that cannot be split is pro rata and shown "≈". Orders = units ordered (per product the data counts units). Avg price = revenue ÷ orders.
- **Day cut-off:** US Pacific days; the last day = the last finished day the per-day data holds (never today). This week vs last = Sunday → last day vs the same days a week before; Last 2 / 4 weeks = the finished Sunday–Saturday weeks vs the same number before; This month vs last month = the 1st → last day vs the same days of last month.
- **Included / excluded:** Amazon (Ridhi, CPC); Shopify not in. As the per-day cache: Amazon.com, cancelled and MCF out.
- **Brands:** Ridhi · CPC · Both (each family in its own brand).
- **Rounding:** Whole $ and units on screen; cents in the CSV; % whole (cards: 1 decimal under 10 %).
- **How fresh:** Nightly (Amazon data 1–2 days late).

### BSR Audit — rank change

A family's rank now against before, as Amazon writes it ("#3,100 in Tablecloths").

- **Screens:** BSR Audit (Ranking better / worse cards, decision cards, table, panel, CSV)
- **Data source:** The BSR snapshots (bsrweeks): the best child per parent, the 7-day average when 3+ daily snapshots exist (bsrWeekEntries).
- **Formula:** The sub-category rank (main when there is none), the newest stored week against the stored week 1 / 2 / 4 weeks before it (month: the newest week of last month). LOWER = BETTER: ▲ green "▲ 2,100 (▲40%) · from #5,200" when the number fell, ▼ red when it rose, grey when within the noise band (a move needs 10 % AND 50 places sub / 500 main; low sellers above 300,000 main / 20,000 sub are noise). Category changed → amber "category changed", no swing.
- **Day cut-off:** ISO weeks (Monday start); the sales week used for the facts = the Sunday before the Monday.
- **Included / excluded:** Children with no rank left out; a parent with no rank in a week has none.
- **Brands:** Each brand on its own newest week.
- **Rounding:** Whole places; % whole.
- **How fresh:** Daily snapshot (one browser of a BSR user) + weekly snapshot.

### BSR Audit — verdict

One word per family for the period: is it growing, does it need action?

- **Screens:** BSR Audit (pills, chips, Needs action card, Act now / Winning, CSV)
- **Data source:** BSR Audit — rank change and BSR Audit — orders and revenue.
- **Formula:** Fewer than 10 orders in BOTH periods → Too few orders to judge; category changed → Category changed; revenue moves at ±10 %. Rank better: revenue up → 🟢 Growing, else 🟡 Check price / conversion. Rank worse: revenue down → 🔴 Needs action, else ⚪ Category busier (OK). Rank held: up → Growing, down → Check, flat → Steady. No rank in a week → No rank to compare. Act now = the 3 Needs action with the most revenue lost (before − now); Winning = the 3 Growing with the most gained. The why and the action = the existing decision's strongest fact (bsrFacts): out of stock → Restock, price up / deal ended → Check price, Buy Box lost → Check Buy Box, ad spend fell → Restore ads, suppressed / our change / content gaps → Fix listing.
- **Day cut-off:** As its two inputs.
- **Included / excluded:** Families with a rank or a sale.
- **Brands:** Ridhi · CPC · Both.
- **Rounding:** A word, not a number (its inputs as above).
- **How fresh:** As its two inputs.

## Worked out in more than one place

Each of these is a place two screens can disagree. The ones marked "checked below" are compared by Numbers Check.

- Days of cover: Parent Listing Review "DOS" (MONTHS, stock ÷ last week × 52 ÷ 12) and Forecast "Cover" (DAYS, stock used up by the forecast at its HIGH end) — two definitions, both shown as they are.
- Sales MTD / YTD: Sales Dashboard (sdSum) and Dashboard (DASH_CALC.sales, through sdSum with the channel swapped) — checked below.
- Sales: Sales Dashboard uses Seller Central's totals where published; PPC & Organic, Profit & Margin, Parent Listing Review and Sales Analysis add up the Orders workbooks — checked below (PPC week, Profit & Margin).
- "Both" / "All": Dashboard Both = Ridhi + CPC; Sales Dashboard All = Ridhi + CPC + Shopify; PPC & Organic All = every row, also one with no brand.
- Ad spend: PPC & Organic / Dashboard (SP per ASIN), Product Performance All row (matchAds SP), Overview (SP + SB + SD), Placement and Search terms (SP, 30-day or settled 7-day) — checked below (Dashboard, Overview).
- TACoS: five definitions (see the rule) and three colour bands (≤10/20, 15/30, >20).
- ACoS: the same formula with 7-day, 30-day or all-type inputs — Placement shows both windows on one screen.
- CVR: units ÷ sessions (PPC & Organic, PP "Unit session %") vs orders ÷ clicks (Overview, Placement, Search terms, PP "SP conv. rate").
- Sessions: per-ASIN traffic report added up vs Seller Central's total.
- Orders: Business Report order items vs distinct workbook orders, in one row (Sales Dashboard, Overview).
- Organic share: floored at 0 in grids, not on the PPC & Organic card.
- Aged 181+ and storage: Inventory Age (renderAge / renderAgeKpis) and the Dashboard tile (DASH_CALC.age) — checked below.
- Fee model: Profit & Margin (audit/costs: returns 10 % of COGS) and Settings / New Product (returns 3 % of price) are separate copies.
- Parent roll-up: Profit & Margin (pfRows), PPC & Organic (wRows) and Parent Listing Review (plRows) each group children on their own.
- Weeks: PT everywhere except wWeeksList (browser date), which sets PPC & Organic's and Profit & Margin's week list.

## The checks Numbers Check runs (per brand: Ridhi, CPC, Both)

| Check | Value A | Value B | Allowed | Differs on purpose because |
|---|---|---|---|---|
| Dashboard Sales MTD / YTD = Sales Dashboard | Dashboard (DASH_CALC.sales) | Sales Dashboard (sdSum) | exact, to the cent | Both: the Dashboard's Both is Ridhi + CPC, the Sales Dashboard's All adds Shopify — explained only when the gap is exactly the Shopify figure |
| Dashboard Ad spend (latest week) = PPC & Organic | Dashboard (DASH_CALC.ads) | PPC & Organic's latest-week card sums | exact, to the cent (and the same TACoS) | — |
| PPC & Organic Ad spend: Both = Ridhi + CPC | every row | Ridhi rows + CPC rows | exact, to the cent | rows with no brand count in Both only |
| PPC weekly sales vs Sales Dashboard (last finished week) | WEEKLY rev | sdSum, same 7 days (Ridhi + CPC for Both) | ±2 % — Seller Central's totals vs the Orders workbook | workbook per ASIN vs Seller Central's totals |
| Sponsored Products ad spend: Overview = PPC & Organic | Overview SP (matchAds sp, else the nightly ads cache) | WEEKLY spend (SP), incl. its Unassigned rows — a brand takes those Listing Health puts under it, Both takes all | within 1 % — the same Sponsored Products spend on both screens | — (see Why they differ) |
| Sponsored Brands / Sponsored Display ad spend | Overview (matchAds sb / sd) | — | shown only — no other screen has it | PPC & Organic has Sponsored Products only |
| Total ad spend, all types | Overview SP + SB + SD | — | shown only — no other screen has it | — |
| Organic sales: Overview vs PPC & Organic | Overview: Seller Central sales − all ad types 7-day ad sales | PPC & Organic: workbook sales − SP 30-day ad sales (+ a third figure: workbook sales − all-type 7-day ad sales) | definition differs — needs a manager decision (not a bug) | marked "definition differs — needs manager decision", never ⚠ |
| Overview: Both = Ridhi + CPC; PPC & Organic: Both = Ridhi + CPC (same weeks) | each screen's Both | its Ridhi + CPC | exact, to the cent | PPC & Organic's Both also counts rows with no brand |
| Dashboard Aged 181+ units and storage $ = Inventory Age | DASH_CALC.age | Inventory Age's buckets (no search) | exact, to the cent | — |
| Profit & Margin sales vs Sales Dashboard (finished weeks) | WEEKLY rev over the FINISHED weeks of pfWeeks() | sdSum over the same days | ±2 % — Seller Central's totals vs the Orders workbook | workbook vs Seller Central (see Why they differ) — the running week and today left out, and the weeks named |

**Why they differ** (on the page, and window.salesCheckDiag()): Sponsored Products week by week — Overview, Amazon's per-ASIN report as
cached (adsAsin), PPC & Organic brand rows, its Unassigned rows, and the ASINs both brands' reports hold; Profit & Margin week by week —
P&M, the Sales Dashboard's own workbook days, the Sales Dashboard as shown; and the days where Seller Central and the workbook differ most.

The Overview rows use only the FINISHED weeks both screens hold for every brand in view (the newest 13), and say which. The
Overview's figures are rebuilt read-only from what the Overview lays over its saved snapshot when it opens: the nightly daily and ads
caches, then Amazon's matchBiz / matchAds totals (the only source that splits the ad types). Nothing is saved.

**Missing is not zero.** A side with no data (a brand not loaded, a week whose figures have not arrived) shows "— not loaded" with
the reason, in grey — never $0 and never "differs" — on every check. Not-loaded and shown-only rows are not counted in the chip.

Each row shows both values, the difference in $ and %, ✓ / ⚠, the reason, and when each side's data is from. A check whose
data is not loaded, or which the account may not see, says so and is not counted. Numbers Check reads only what the screens
already hold or their read-only loaders give (the nightly caches, Firestore snapshots) — never ensureSales' live top-up, wNightly,
tNightly, an Amazon refresh, AI or any write. `window.salesCheck()` runs the same checks in the browser console.

## Looks wrong or inconsistent — reported, NOT fixed (21 Nov 2026)

Each one is locked as it is today by `tests/sales-metrics-test.js` (where it can be), so a fix will show up as a changed golden value.

1. **Sales Dashboard period table %Δ ≠ the card %Δ.** The table compares MTD / YTD *including today* with last year *up to
   yesterday*; the cards compare complete days on both sides. Fixture (1 Nov, 10:00 PT): YTD card ▲36.1 % (1,020.55 vs 750),
   table ▲42.7 % (1,070.55 vs 750) — same screen, same number, two answers. (`renderSales`, the `row()` helper.)
2. **"Order items" mixes two counts.** Days Seller Central has published carry *Total Order Items*; the newest 1–2 days (and
   every Shopify day) carry the workbook's count of *distinct orders*. A 2-line order is 2 on an old day and 1 on a new day.
   Same on the Overview, whose KPI card calls the row "Orders".
3. **Shopify refunded / cancelled orders count as sales.** `shopifyDaily_` (Pricing-API, Shopify.gs) drops only
   `financial_status = voided`, while its comment says cancelled and refunded-to-zero orders should not count. Fixture: a $15
   refunded order is in the day's $35. (Backend — not touched.)
4. **Shopify's day is the store's own date, not PT.** An order at 00:30 store time on 1 Nov counts on 1 Nov although it was
   still 31 Oct on the US portal day.
5. **Avg $ / item divides by units**, not by order items (the label says item; the code comment says this is on purpose).
   Fixture: $350.55 ÷ 7 units = $50.08; ÷ 6 order items would be $58.43.
6. **PPC & Organic latest-week card shows TACoS 0 % and Organic share 100 % for a running week with no ad report yet** — missing
   spend / ad sales are added as 0, against the file's own rule that unknown ≠ zero. The Dashboard's Ad spend card reads the same
   week (it says "n/7 days"). Fixture: running week $50 sales, no ads → "TACoS 0%", "100% Organic share".
7. **Organic share on that card is not floored at 0** (the grid and the Overview floor it); it can go negative when ad sales
   exceed sales.
8. **PPC & Organic grid Total/Avg for % metrics is the plain average of the weekly ratios** (TACoS, ACoS, CVR, split), while the
   range report and the Overview divide the sums. Weeks of $1,000 at 10 % and $100 at 50 % average to 30 %; the sums give 13.6 %.
9. **"Both" means three different things.** Dashboard Both = Ridhi + CPC; Sales Dashboard All = Ridhi + CPC + Shopify; PPC &
   Organic / Profit & Margin All = every row, including rows with no brand (fixture: Both $55 ad spend vs Ridhi 30 + CPC 20).
10. **TACoS has five definitions and three colour bands** (see its rule) — e.g. the PPC & Organic card uses Sponsored Products ÷
    workbook sales, the Overview uses all ad types ÷ Seller Central sales, so the same week need not show the same TACoS. Bands:
    PPC & Organic good ≤ 10 / warn ≤ 20; Product Performance green ≤ 15 / red ≥ 30; Dashboard and Overview red > 20.
11. **CVR is two different numbers under one name** — units ÷ sessions (PPC & Organic) vs ad orders ÷ clicks (Overview,
    Placement, Search terms). Fixture: 10 units / 200 sessions = 5 %; 30 ad orders / 400 clicks = 7.5 %.
12. **Profit & Margin overstates a partly-costed parent's profit.** The parent keeps ALL its children's sales and ad spend but
    only the costed children's units. Fixture: K1 (cost $5, 10 units, $200) + K2 (no cost, 10 units, $200) → parent profit $161;
    the costed half alone is $53. (`pfRows`, the `cell` line.)
13. **Profit & Margin's "Last week" is the running week, and "Last 52 weeks" covers 26** — the week list is `WEEKLY.weeks`
    (26 Sunday keys including the running week).
14. **Week lists use the browser's date, not PT.** `wWeeksList` (PPC & Organic, Profit & Margin) uses the local (Indian) date, so
    on Sunday morning in India the newest column is a week that has not started in the US.
15. **Sales Dashboard Custom Range is empty on the 1st, mornings in India.** `sdDefaults` takes the month start from the local date
    and "to" from the PT date: on 1 Dec 09:00 IST it fills 2026-12-01 → 2026-11-30.
16. **Parent Listing Review's 6-week average includes last week** and divides sales by 6 always but sessions by the weeks that have
    them. Five weeks at $1,000 and last week $400: average $900, "−55.6 %" (without last week: $1,000, −60 %).
17. **Inventory Age keeps 1,500 rows per brand when it saves** (`saveAgeCache`); straight after "Refresh both brands" the screen
    can count more SKUs than after a reload, and the Dashboard tile always counts the saved 1,500.
18. **Inventory Age "% of available" and "Healthy %" use different bases** (aged ÷ available vs fresh ÷ units in buckets), so
    they need not add to 100 % and the first can pass 100 %.
19. **Placement shows ACoS / CPC / CVR on two windows on one screen** — the cards use settled 7-day data, the table nightly
    30-day data. Search Term Analysis can likewise mix a 7-day target pack with a 30-day term pack; the gap lands in "Report
    difference".
20. **Sales Analysis says its totals "cannot disagree" with the Sales Dashboard** — no longer true since the Sales Dashboard
    uses Seller Central's totals for published days.
21. **Parent Listing Review "DOS" is months of cover** (deliberate, and the tooltip says so) — but elsewhere "DOS / days of
    cover" means days; easy to misread.
22. **(22 Nov) An ASIN in both brands' ad reports keeps ONE cell in PPC & Organic.** `wNightly` writes each brand's per-ASIN ad
    figures with `c.spend = …` (not `+=`) into the same row, so the brand merged second overwrites the first one's spend for that
    week, and the row keeps the brand it was first given. Numbers Check's "Why they differ" lists these ASINs per week.
23. **(22 Nov) The backend skips advertised-product report rows with no ASIN** (Pricing-API AdsApi.gs: `if (!a) continue;`), so
    Amazon's per-ASIN report as cached can be below the campaign totals the Overview reads.
24. **(22 Nov) PPC & Organic rows with no brand** (saved before every write set one — nothing creates them now) are in "All" and
    in neither Ridhi nor CPC. They are now listed and tagged "Unassigned" on the screen (no number changes); Numbers Check counts
    them, crediting a brand only where Listing Health knows the ASIN.
