-- =====================================================================================
-- Flowmerce · schema flowmerce · file 02 · ShopifyQL (sq_), Search Console (gsc_), GA4 (ga4_), Meta + Google Ads (ads_)
-- Daily rows in the store's own day (ads: the ad account's own day). Split columns use 'all', never null.
-- source: 'api' rows are replaced by re-syncs; 'excel' / 'manual' rows are never touched by a sync.
-- =====================================================================================

-- ===================================================================== ShopifyQL (humans only, 16 months)
create table flowmerce.sq_sessions_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null,
  device text not null default 'all', channel text not null default 'all',
  country text not null default 'all', region text not null default 'all',
  sessions integer not null default 0, sessions_with_cart integer not null default 0,
  sessions_reached_checkout integer not null default 0, sessions_completed_checkout integer not null default 0,
  bounce_rate numeric(7,4), is_final boolean not null default false, pulled_at timestamptz not null default now(),
  primary key (store_id, day, device, channel, country, region),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.sq_sessions_hourly (
  workspace_id uuid not null, store_id uuid not null, hour_start timestamptz not null,
  sessions integer not null default 0, sessions_completed_checkout integer not null default 0,
  pulled_at timestamptz not null default now(),
  primary key (store_id, hour_start),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.sq_landing_page_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null,
  page_path text not null, page_type text not null default 'all', channel text not null default 'all', device text not null default 'all',
  sessions integer not null default 0, bounce_rate numeric(7,4), add_to_cart_rate numeric(7,4), conversion_rate numeric(7,4),
  orders integer not null default 0, sales numeric(14,2) not null default 0, currency char(3),
  is_final boolean not null default false, pulled_at timestamptz not null default now(),
  primary key (store_id, day, page_path, page_type, channel, device),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.sq_sales_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null, referrer_source text not null default 'all',
  orders integer not null default 0, gross_sales numeric(14,2) not null default 0, discounts numeric(14,2) not null default 0,
  returns numeric(14,2) not null default 0, net_sales numeric(14,2) not null default 0, shipping numeric(14,2) not null default 0,
  taxes numeric(14,2) not null default 0, total_sales numeric(14,2) not null default 0, currency char(3),
  is_final boolean not null default false, pulled_at timestamptz not null default now(),
  primary key (store_id, day, referrer_source),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.sq_product_sales_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null, product_external_id text not null,
  product_id uuid references flowmerce.product(id) on delete set null,
  gross_sales numeric(14,2) not null default 0, discounts numeric(14,2) not null default 0, returns numeric(14,2) not null default 0,
  net_sales numeric(14,2) not null default 0, items_sold integer not null default 0, orders integer not null default 0, currency char(3),
  is_final boolean not null default false, pulled_at timestamptz not null default now(),
  primary key (store_id, day, product_external_id),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.sq_discount_sales_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null, discount_code text not null,
  orders integer not null default 0, gross_sales numeric(14,2) not null default 0, discount_amount numeric(14,2) not null default 0,
  net_sales numeric(14,2) not null default 0, average_order_value numeric(14,2), currency char(3),
  pulled_at timestamptz not null default now(),
  primary key (store_id, day, discount_code),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.sq_customer_type_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null,
  customer_type text not null check (customer_type in ('new','returning')),
  orders integer not null default 0, net_sales numeric(14,2) not null default 0, average_order_value numeric(14,2), currency char(3),
  pulled_at timestamptz not null default now(),
  primary key (store_id, day, customer_type),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.sq_payments_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null, payment_method text not null,
  attempts integer not null default 0, successful integer not null default 0, failed integer not null default 0,
  pulled_at timestamptz not null default now(),
  primary key (store_id, day, payment_method),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.sq_web_vitals_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null,
  device text not null default 'all', page_type text not null default 'all', page_path text not null default 'all',
  page_loads integer not null default 0, lcp_p75_ms integer, inp_p75_ms integer, cls_p75 numeric(6,3),
  lcp_good integer, lcp_okay integer, lcp_poor integer, inp_good integer, inp_okay integer, inp_poor integer,
  cls_good integer, cls_okay integer, cls_poor integer, pulled_at timestamptz not null default now(),
  primary key (store_id, day, device, page_type, page_path),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.sq_site_search_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null, search_term text not null,
  sessions_with_search integer not null default 0, searches integer not null default 0,
  zero_result_searches integer not null default 0, searches_with_clicks integer not null default 0,
  pulled_at timestamptz not null default now(),
  primary key (store_id, day, search_term),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

-- ===================================================================== Search Console (whole site, 16 months)
create table flowmerce.gsc_page_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null, page_url text not null, page_type text,
  clicks integer not null default 0, impressions integer not null default 0, ctr numeric(7,4), position numeric(7,2),
  source text not null default 'api' check (source in ('api','excel','manual')), pulled_at timestamptz not null default now(),
  primary key (store_id, day, page_url, source),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.gsc_page_query_period (
  workspace_id uuid not null, store_id uuid not null, period_start date not null, period_end date not null,
  page_url text not null, query text not null,
  clicks integer not null default 0, impressions integer not null default 0, ctr numeric(7,4), position numeric(7,2),
  source text not null default 'api' check (source in ('api','excel','manual')), pulled_at timestamptz not null default now(),
  primary key (store_id, period_end, page_url, query, source),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

-- ===================================================================== GA4
create table flowmerce.ga4_landing_page_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null, landing_page text not null,
  sessions integer not null default 0, engaged_sessions integer not null default 0, engagement_rate numeric(7,4),
  engagement_seconds numeric(14,2), key_events numeric(14,2),
  source text not null default 'api' check (source in ('api','excel','manual')), pulled_at timestamptz not null default now(),
  primary key (store_id, day, landing_page, source),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.ga4_product_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null, item_id text not null,
  product_id uuid references flowmerce.product(id) on delete set null,
  item_views integer not null default 0, add_to_carts integer not null default 0,
  source text not null default 'api' check (source in ('api','excel','manual')), pulled_at timestamptz not null default now(),
  primary key (store_id, day, item_id, source),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

-- ===================================================================== Meta + Google Ads (read-only v1)
create table flowmerce.ads_account (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  connection_id   uuid references flowmerce.connection(id) on delete set null,
  platform        text not null check (platform in ('meta','google')),
  external_id     text not null,
  name            text not null,
  currency        char(3) not null,
  timezone        text not null,
  status          text not null,
  synced_at       timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (platform, external_id)
);

create table flowmerce.ads_campaign (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  ad_account_id   uuid not null references flowmerce.ads_account(id) on delete cascade,
  platform        text not null check (platform in ('meta','google')),
  external_id     text not null,
  name            text not null,
  objective       text,
  status          text not null,
  delivery_status text,
  daily_budget    numeric(14,2),
  lifetime_budget numeric(14,2),
  budget_level    text check (budget_level in ('cbo','abo')),
  bid_strategy    text,
  start_at        timestamptz,
  end_at          timestamptz,
  campaign_key    text,                            -- normalised utm_campaign, joins to shop_order
  src_updated_at  timestamptz,
  synced_at       timestamptz not null default now(),
  unique (platform, external_id)
);
create index ads_campaign_key on flowmerce.ads_campaign (store_id, campaign_key);

create table flowmerce.ads_group (                 -- Meta ad set / Google ad group / asset group
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  campaign_id     uuid not null references flowmerce.ads_campaign(id) on delete cascade,
  platform        text not null check (platform in ('meta','google')),
  kind            text not null check (kind in ('ad_set','ad_group','asset_group')),
  external_id     text not null,
  name            text not null,
  status          text not null,
  daily_budget    numeric(14,2),
  lifetime_budget numeric(14,2),
  optimization_goal text,
  learning_stage  text,
  targeting       jsonb not null default '{}',
  synced_at       timestamptz not null default now(),
  unique (platform, external_id)
);

create table flowmerce.ads_creative (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  platform        text not null check (platform in ('meta','google')),
  external_id     text not null,
  format          text,
  primary_text    text,
  headline        text,
  description     text,
  call_to_action  text,
  link_url        text,
  image_url       text,
  thumbnail_url   text,
  video_seconds   numeric(8,2),
  synced_at       timestamptz not null default now(),
  unique (platform, external_id)
);

create table flowmerce.ads_ad (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  ad_group_id     uuid not null references flowmerce.ads_group(id) on delete cascade,
  creative_id     uuid references flowmerce.ads_creative(id) on delete set null,
  platform        text not null check (platform in ('meta','google')),
  external_id     text not null,
  name            text not null,
  status          text not null,
  delivery_status text,
  url_tags        text,
  promoted_product_ids uuid[] not null default '{}',
  src_created_at  timestamptz,
  synced_at       timestamptz not null default now(),
  unique (platform, external_id)
);

create table flowmerce.ads_keyword (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  ad_group_id     uuid not null references flowmerce.ads_group(id) on delete cascade,
  external_id     text not null,
  keyword         text not null,
  match_type      text not null check (match_type in ('exact','phrase','broad')),
  is_negative     boolean not null default false,
  status          text not null,
  quality_score   smallint,
  unique (ad_group_id, external_id)
);

create table flowmerce.ads_conversion_action (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  ad_account_id   uuid not null references flowmerce.ads_account(id) on delete cascade,
  external_id     text not null,
  name            text not null,
  category        text,
  counts_as_purchase boolean not null default false,  -- only these are counted as purchases
  unique (ad_account_id, external_id)
);

create table flowmerce.ads_daily (
  workspace_id      uuid not null,
  store_id          uuid not null,
  day               date not null,
  level             text not null check (level in ('account','campaign','ad_group','ad')),
  entity_id         uuid not null,
  platform          text not null check (platform in ('meta','google')),
  currency          char(3) not null,
  spend             numeric(14,2) not null default 0,
  impressions       bigint not null default 0,
  reach             bigint,
  frequency         numeric(8,3),
  clicks            bigint not null default 0,
  link_clicks       bigint,
  landing_page_views bigint,
  add_to_cart       numeric(14,2),                 -- Meta omni_add_to_cart
  initiate_checkout numeric(14,2),                 -- Meta omni_initiated_checkout
  add_payment_info  numeric(14,2),
  purchases         numeric(14,2),                 -- Meta omni_purchase; Google: counts_as_purchase only
  purchase_value    numeric(14,2),
  video_3s_views    bigint,
  thruplays         bigint,
  video_p25 bigint, video_p50 bigint, video_p75 bigint, video_p100 bigint,
  search_impression_share numeric(7,4),
  actions           jsonb not null default '{}',
  pulled_at         timestamptz not null default now(),
  primary key (day, level, entity_id)
);
create index ads_daily_store on flowmerce.ads_daily (store_id, day);

create table flowmerce.ads_breakdown_daily (
  workspace_id      uuid not null,
  store_id          uuid not null,
  day               date not null,
  level             text not null check (level in ('account','campaign','ad_group','ad')),
  entity_id         uuid not null,
  dimension         text not null check (dimension in ('age','gender','age_gender','placement','platform','device','country','region','hour')),
  dim_value         text not null,
  spend             numeric(14,2) not null default 0,
  impressions       bigint not null default 0,
  clicks            bigint not null default 0,
  purchases         numeric(14,2),
  purchase_value    numeric(14,2),
  pulled_at         timestamptz not null default now(),
  primary key (day, level, entity_id, dimension, dim_value)
);

create table flowmerce.ads_search_term_daily (
  workspace_id      uuid not null,
  store_id          uuid not null,
  day               date not null,
  ad_group_id       uuid not null references flowmerce.ads_group(id) on delete cascade,
  search_term       text not null,
  match_type        text,
  impressions       bigint not null default 0,
  clicks            bigint not null default 0,
  cost              numeric(14,2) not null default 0,
  purchases         numeric(14,2),
  purchase_value    numeric(14,2),
  pulled_at         timestamptz not null default now(),
  primary key (day, ad_group_id, search_term)
);

create table flowmerce.ads_change (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  ad_account_id   uuid not null references flowmerce.ads_account(id) on delete cascade,
  external_id     text,
  entity_level    text not null check (entity_level in ('account','campaign','ad_group','ad','keyword','other')),
  entity_external_id text,
  changed_at      timestamptz not null,
  changed_by      text,
  change_type     text,
  field           text,
  old_value       text,
  new_value       text,
  action_id       uuid,                            -- flowmerce.action, when Flowmerce made the change
  unique (ad_account_id, external_id)
);

create table flowmerce.ads_target (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  scope_type      text not null check (scope_type in ('store','platform','account','campaign')),
  scope_ref       text,
  metric          text not null check (metric in ('roas','cpa','ctr','cpm','frequency','daily_spend_cap')),
  target_value    numeric(14,4) not null,
  breakeven_value numeric(14,4),
  is_official     boolean not null default false,
  valid_from      date not null default current_date,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.fx_rate (
  workspace_id    uuid not null references flowmerce.workspace(id) on delete cascade,
  from_currency   char(3) not null,
  to_currency     char(3) not null,
  valid_from      date not null,
  rate            numeric(14,6) not null check (rate > 0),
  note            text,
  created_by      uuid,
  primary key (workspace_id, from_currency, to_currency, valid_from)
);

create table flowmerce.order_attribution (
  order_id        uuid primary key references flowmerce.shop_order(id) on delete cascade,
  workspace_id    uuid not null,
  store_id        uuid not null,
  platform        text check (platform in ('meta','google')),
  campaign_id     uuid references flowmerce.ads_campaign(id) on delete set null,
  ad_group_id     uuid references flowmerce.ads_group(id) on delete set null,
  ad_id           uuid references flowmerce.ads_ad(id) on delete set null,
  method          text not null check (method in ('utm','landing_site','click_id','unmatched')),
  matched_at      timestamptz not null default now()
);
create index order_attribution_campaign on flowmerce.order_attribution (campaign_id);
