-- =====================================================================================================================
-- sellora — Sellora's own schema (Ravi, 2026-11-21: "a schema named sellora and get all the Sellora data there").
-- This file is its first part: marketplace sales and ad figures ("our own backend … saves in Supabase and we fetch it").
-- Later parts (BSR, deals, listing notes now in `sales`) are added in their own files, into the same schema.
--
-- First user: Sellora's "Live vs Last Year" page (Pricing-App/public/live.html), today fed by Apps Script through a
-- published Google Sheet. The new backend (Firebase Functions, project price-research-48ff3) writes here every few
-- minutes straight from the APIs; the page reads it with ONE call, sellora.page_data(). Every day is a Pacific day
-- (Amazon.com's day) and comes from the API itself, so there is no half-finished "nightly" day any more.
--
--   Who writes   the backend only, with the service_role key (bypasses RLS). Nobody else has write grants.
--   Who reads    anon / authenticated may only EXECUTE the read functions at the bottom (security definer). The tables
--                themselves are closed. Same exposure as today's published CSV — the page has no sign-in.
--
-- To run: Supabase dashboard → SQL editor → paste this file → Run. Safe to run again (if not exists / or replace).
-- Then: Project Settings → Data API → Exposed schemas → add "sellora" (so the page can call sellora.page_data).
-- =====================================================================================================================

create schema if not exists sellora;
revoke all on schema sellora from public;
grant usage on schema sellora to anon, authenticated, service_role;
alter default privileges in schema sellora revoke all on tables from public, anon, authenticated;
alter default privileges in schema sellora revoke all on functions from public, anon, authenticated;
alter default privileges in schema sellora grant all on tables to service_role;
alter default privileges in schema sellora grant all on sequences to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Brands. SP = Ridhi, CPC = CPC. Each has its own Amazon seller account and its own Shopify store.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists sellora.brands (
  code               text primary key,                         -- 'SP' | 'CPC' — the same codes Apps Script uses
  name               text not null,
  amazon_marketplace text not null default 'ATVPDKIKX0DER',    -- Amazon.com
  shopify_first_day  date,                                     -- first Shopify sale; before it last year is a true $0
  sort               smallint not null default 0
);
comment on table sellora.brands is 'Brands the backend reads. SP = Ridhi, CPC = CPC.';
insert into sellora.brands (code, name, shopify_first_day, sort) values
  ('SP',  'Ridhi', '2025-12-28', 1),
  ('CPC', 'CPC',   null,         2)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- Sales by Pacific hour — today live, and every past day kept (about 35,000 rows a year for both brands and channels).
-- Amazon: Sales API getOrderMetrics, granularity Hour, US/Pacific. Shopify: orders by created_at, line-item price ×
-- quantity (no shipping, no tax), voided orders out — the same counting as Apps Script's shopifyDaily_.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists sellora.sales_hourly (
  brand       text        not null references sellora.brands (code),
  channel     text        not null check (channel in ('amazon', 'shopify')),
  hour_start  timestamptz not null,                                                    -- start of the Pacific hour
  day         date        generated always as ((hour_start at time zone 'America/Los_Angeles')::date) stored,
  hour        smallint    generated always as (extract(hour from hour_start at time zone 'America/Los_Angeles')::smallint) stored,
  orders      int           not null default 0,
  units       int           not null default 0,
  items       int,                                                                     -- Amazon order items (lines)
  sales       numeric(12,2) not null default 0,                                        -- USD
  fetched_at  timestamptz   not null default now(),
  primary key (brand, channel, hour_start)
);
create index if not exists sales_hourly_day on sellora.sales_hourly (day, brand, channel);
comment on table sellora.sales_hourly is 'Sales per Pacific hour per brand and channel. Written by the backend; the hour running now is rewritten each run.';

-- ---------------------------------------------------------------------------------------------------------------------
-- Sales by Pacific day. Recent days are re-read for a week (pending orders settle, late Shopify edits), so a row can
-- change until `final`. History before the backend started is back-filled once from Apps Script's nightly cache
-- (source = 'orders_workbook': cancelled orders already left out there, about 0.5% below the Sales API).
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists sellora.sales_daily (
  brand       text          not null references sellora.brands (code),
  channel     text          not null check (channel in ('amazon', 'shopify')),
  day         date          not null,                                                  -- Pacific day
  orders      int           not null default 0,
  units       int           not null default 0,
  items       int,
  sales       numeric(12,2) not null default 0,
  source      text          not null check (source in ('sales_api', 'shopify_api', 'orders_workbook', 'apps_script', 'manual')),
  final       boolean       not null default false,                                    -- read 7+ days after the day ended
  fetched_at  timestamptz   not null default now(),
  primary key (brand, channel, day)
);
create index if not exists sales_daily_day on sellora.sales_daily (day);
-- Run again over an earlier copy of this file: "create table if not exists" leaves an old table as it was, so the list of
-- sources is set here every time ('apps_script' was added on 21 Nov for the history import).
alter table sellora.sales_daily drop constraint if exists sales_daily_source_check;
alter table sellora.sales_daily add constraint sales_daily_source_check
  check (source in ('sales_api', 'shopify_api', 'orders_workbook', 'apps_script', 'manual'));
comment on table sellora.sales_daily is 'Sales per Pacific day per brand and channel. Today is never here: the page takes today from sales_hourly.';

-- ---------------------------------------------------------------------------------------------------------------------
-- Ad figures by day and ad type. Amazon: Ads API daily campaign reports (Sponsored Products 7-day attribution,
-- Brands and Display 14-day — as the Ads console shows them), re-read for 7 days. Older days from uploaded console
-- reports. Meta: Marketing API insights, in the ad account's own timezone (noted in `day_tz`).
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists sellora.ads_daily (
  brand        text          not null references sellora.brands (code),
  ad_type      text          not null check (ad_type in ('sp', 'sb', 'sd', 'meta', 'total')),   -- total: Amazon's three together, history from Apps Script
  day          date          not null,
  impressions  bigint        not null default 0,
  clicks       int           not null default 0,
  spend        numeric(12,2) not null default 0,
  orders       int           not null default 0,                                        -- attributed purchases
  sales        numeric(12,2) not null default 0,                                        -- attributed sales
  day_tz       text          not null default 'America/Los_Angeles',
  source       text          not null check (source in ('ads_api', 'console_upload', 'meta_api', 'apps_script')),
  fetched_at   timestamptz   not null default now(),
  primary key (brand, ad_type, day)
);
create index if not exists ads_daily_day on sellora.ads_daily (day);
-- the same for the ad types ('total' added on 21 Nov for the history import)
alter table sellora.ads_daily drop constraint if exists ads_daily_ad_type_check;
alter table sellora.ads_daily add constraint ads_daily_ad_type_check check (ad_type in ('sp', 'sb', 'sd', 'meta', 'total'));
-- 21 Nov: spend and sales are always US dollars. An ad account that reports in another currency (Ridhi's Meta account:
-- rupees) is converted at that day's ECB rate; its own figures, currency and the rate are kept here.
alter table sellora.ads_daily add column if not exists currency     text not null default 'USD';
alter table sellora.ads_daily add column if not exists fx_rate      numeric(16,8);
alter table sellora.ads_daily add column if not exists spend_native numeric(14,2);
alter table sellora.ads_daily add column if not exists sales_native numeric(14,2);
comment on table sellora.ads_daily is 'Ad spend and attributed sales per day. sp/sb/sd = Amazon Sponsored Products/Brands/Display; meta = Facebook + Instagram.';

-- ---------------------------------------------------------------------------------------------------------------------
-- Amazon shopping events (the page's Events tab). Pacific dates, first and last day.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists sellora.events (
  id     bigint generated always as identity primary key,
  name   text not null,
  starts date not null,
  ends   date not null check (ends >= starts),
  about  text,
  unique (name, starts)
);
insert into sellora.events (name, starts, ends, about) values
  ('Big Spring Sale',                  '2025-03-25', '2025-03-31', '7 days · open to all shoppers, with Prime-exclusive deals'),
  ('Big Spring Sale',                  '2026-03-25', '2026-03-31', '7 days · open to all shoppers, with Prime-exclusive deals'),
  ('Prime Day',                        '2025-07-08', '2025-07-11', '4 days · Prime members only'),
  ('Prime Day',                        '2026-06-23', '2026-06-26', '4 days · Prime members only'),
  ('Prime Big Deal Days',              '2025-10-07', '2025-10-08', '48 hours · Prime members only, early holiday deals'),
  ('Prime Big Deal Days',              '2026-10-06', '2026-10-07', '48 hours · Prime members only, early holiday deals'),
  ('Black Friday Week & Cyber Monday', '2025-11-20', '2025-12-01', '12 days · Black Friday 28 Nov, Cyber Monday 1 Dec'),
  ('Black Friday Week & Cyber Monday', '2026-11-19', '2026-11-30', '12 days · Thanksgiving 26 Nov, Black Friday 27 Nov, Cyber Monday 30 Nov')
on conflict (name, starts) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- The backend's own bookkeeping — so it can be tested and watched.
--   job_state   what a job carries between runs (an Ads report it asked for, Shopify's last order time, …)
--   fetch_runs  one row per run: when, how long, how many rows, the error if any. The page shows "data to …" from it.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists sellora.job_state (
  job         text primary key,                         -- e.g. 'amazon_sales:SP', 'ads_report:CPC:sb', 'shopify:SP'
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
create table if not exists sellora.fetch_runs (
  id            bigint generated always as identity primary key,
  job           text not null,
  brand         text references sellora.brands (code),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  ok            boolean,
  rows_written  int,
  error         text,
  details       jsonb
);
create index if not exists fetch_runs_job on sellora.fetch_runs (job, started_at desc);
comment on table sellora.fetch_runs is 'One row per backend run. Keep about 30 days (sellora.prune_runs).';

-- Closed tables: RLS on with no policies, and no grants to anon/authenticated. service_role bypasses RLS.
alter table sellora.brands       enable row level security;
alter table sellora.sales_hourly enable row level security;
alter table sellora.sales_daily  enable row level security;
alter table sellora.ads_daily    enable row level security;
alter table sellora.events       enable row level security;
alter table sellora.job_state    enable row level security;
alter table sellora.fetch_runs   enable row level security;
revoke all on all tables in schema sellora from public, anon, authenticated;
grant all on all tables in schema sellora to service_role;
grant all on all sequences in schema sellora to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- One day per brand with everything on it — for reports and SQL checks (service_role / dashboard).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace view sellora.day_totals with (security_invoker = true) as
select s.brand, s.day,
       sum(s.sales)  filter (where s.channel = 'amazon')  as amazon_sales,
       sum(s.orders) filter (where s.channel = 'amazon')  as amazon_orders,
       sum(s.units)  filter (where s.channel = 'amazon')  as amazon_units,
       sum(s.sales)  filter (where s.channel = 'shopify') as shopify_sales,
       sum(s.orders) filter (where s.channel = 'shopify') as shopify_orders,
       sum(s.units)  filter (where s.channel = 'shopify') as shopify_units,
       coalesce((select sum(a.spend) from sellora.ads_daily a where a.brand = s.brand and a.day = s.day and a.ad_type in ('sp','sb','sd')),
                (select sum(a.spend) from sellora.ads_daily a where a.brand = s.brand and a.day = s.day and a.ad_type = 'total')) as amazon_ad_spend,
       (select sum(a.spend) from sellora.ads_daily a where a.brand = s.brand and a.day = s.day and a.ad_type = 'meta')            as meta_spend
from sellora.sales_daily s
group by s.brand, s.day;
revoke all on sellora.day_totals from public, anon, authenticated;
grant select on sellora.day_totals to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- THE PAGE'S ONE CALL:  POST /rest/v1/rpc/page_data  (header Content-Profile: sellora)  body {"p_day": null}
--   → { ok, asOf, day, ly, lw, m4,
--       hours:  { SP|CPC: { amazon|shopify: { now|ly|lw|m4: [[hour, orders, units, sales], …] } } },
--       daily:  { SP|CPC: { amazon|shopify: { 'YYYY-MM-DD': [sales, units, orders] } } }      -- finished days only
--       ads:    { SP|CPC: { sp|sb|sd|meta|total: { 'YYYY-MM-DD': [impressions, clicks, spend, orders, sales] } } },
--               (total = Apps Script history, all three Amazon types together, only on days without sp/sb/sd rows)
--       events: [ { name, starts, ends, about } ],
--       runs:   { "job:BRAND": { at, ok, error, rows } } }                    -- latest run per step and brand, last 2 days
-- p_day: the Pacific day on view (default today). ly = 364 days back (same weekday), lw = 7, m4 = 28.
-- daily / ads cover p_days back (default 800 — enough for last financial year's quarters).
-- The daily arrays keep the [sales, units, orders] order the page already uses for DATA.hist.d.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function sellora.page_data(p_day date default null, p_days int default 800)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with k as (
  select d as day, d - 364 as ly, d - 7 as lw, d - 28 as m4, d - least(greatest(coalesce(p_days, 800), 1), 1200) as since
  from (select coalesce(p_day, (now() at time zone 'America/Los_Angeles')::date) as d) x
),
hrs as (
  select h.brand, h.channel,
         case h.day when k.day then 'now' when k.ly then 'ly' when k.lw then 'lw' else 'm4' end as which,
         jsonb_agg(jsonb_build_array(h.hour, h.orders, h.units, h.sales) order by h.hour_start) as r
  from sellora.sales_hourly h cross join k
  where h.day in (k.day, k.ly, k.lw, k.m4)
  group by 1, 2, 3
),
hours as (
  select coalesce(jsonb_object_agg(brand, ch), '{}'::jsonb) as j from (
    select brand, jsonb_object_agg(channel, w) as ch from (
      select brand, channel, jsonb_object_agg(which, r) as w from hrs group by brand, channel
    ) a group by brand
  ) b
),
daily as (
  select coalesce(jsonb_object_agg(brand, ch), '{}'::jsonb) as j from (
    select brand, jsonb_object_agg(channel, dd) as ch from (
      select s.brand, s.channel, jsonb_object_agg(s.day::text, jsonb_build_array(s.sales, s.units, s.orders)) as dd
      from sellora.sales_daily s cross join k
      where s.day >= k.since and s.day < k.day
      group by s.brand, s.channel
    ) a group by brand
  ) b
),
ads as (
  select coalesce(jsonb_object_agg(brand, t), '{}'::jsonb) as j from (
    select brand, jsonb_object_agg(ad_type, dd) as t from (
      select a.brand, a.ad_type,
             jsonb_object_agg(a.day::text, jsonb_build_array(a.impressions, a.clicks, a.spend, a.orders, a.sales)) as dd
      from sellora.ads_daily a cross join k
      where a.day >= k.since and a.day <= k.day
        -- a 'total' row (Apps Script history) only counts for a day the backend has no per-type Amazon rows for
        and not (a.ad_type = 'total' and exists (select 1 from sellora.ads_daily b
                                                 where b.brand = a.brand and b.day = a.day and b.ad_type in ('sp', 'sb', 'sd')))
      group by a.brand, a.ad_type
    ) x group by brand
  ) y
),
ev as (
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'starts', starts, 'ends', ends, 'about', about) order by starts), '[]'::jsonb) as j
  from sellora.events
),
runs as (    -- the latest run of each step, per brand ("amazon_ads:CPC"), so one brand cannot hide the other's failure
  select coalesce(jsonb_object_agg(job || coalesce(':' || brand, ''), jsonb_build_object('at', finished_at, 'ok', ok, 'error', error, 'rows', rows_written)), '{}'::jsonb) as j
  from (select distinct on (job, brand) job, brand, finished_at, ok, error, rows_written from sellora.fetch_runs
         where started_at > now() - interval '2 days' order by job, brand, started_at desc) r
)
select jsonb_build_object(
  'ok',     true,
  'asOf',   (select max(h.fetched_at) from sellora.sales_hourly h, k where h.day = k.day),
  'day',    k.day, 'ly', k.ly, 'lw', k.lw, 'm4', k.m4,
  'hours',  (select j from hours),
  'daily',  (select j from daily),
  'ads',    (select j from ads),
  'events', (select j from ev),
  'runs',   (select j from runs)
)
from k;
$$;
revoke all on function sellora.page_data(date, int) from public;
grant execute on function sellora.page_data(date, int) to anon, authenticated, service_role;
comment on function sellora.page_data(date, int) is 'Everything Live vs Last Year needs, in one call. Read-only.';

-- Housekeeping for the backend: drop run rows older than 30 days. Called by the backend once a day.
create or replace function sellora.prune_runs(p_keep_days int default 30)
returns int
language sql
security definer
set search_path = ''
as $$
  with d as (delete from sellora.fetch_runs where started_at < now() - make_interval(days => greatest(p_keep_days, 1)) returning 1)
  select count(*)::int from d;
$$;
revoke all on function sellora.prune_runs(int) from public, anon, authenticated;
grant execute on function sellora.prune_runs(int) to service_role;

notify pgrst, 'reload schema';

-- The last line must say PASS.
select case
  when (select count(*) from information_schema.tables where table_schema = 'sellora'
         and table_name in ('brands', 'sales_hourly', 'sales_daily', 'ads_daily', 'events', 'job_state', 'fetch_runs')) = 7
   and position('apps_script' in pg_get_constraintdef((select oid from pg_constraint where conname = 'sales_daily_source_check'))) > 0
   and position('total' in pg_get_constraintdef((select oid from pg_constraint where conname = 'ads_daily_ad_type_check'))) > 0
   and exists (select 1 from information_schema.columns where table_schema = 'sellora' and table_name = 'ads_daily' and column_name = 'fx_rate')
   and (sellora.page_data(null, 1) ->> 'ok') = 'true'
  then 'PASS — schema sellora ready (7 tables, page_data answers). Now add "sellora" to Data API → Exposed schemas.'
  else 'FAIL — look at the lines above' end as result;
