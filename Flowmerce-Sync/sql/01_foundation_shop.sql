-- =====================================================================================
-- Flowmerce · ONE schema: flowmerce · file 01 · foundation, connections, sync log, raw copies, Shopify
-- Built from data-requirements.html (24 Nov 2026) + Flowmerce/db/schema.sql.
-- Run files 01 → 06 in order. Every object lives in schema "flowmerce", so it can sit next to the
-- ERP schemas (core, sales, production, stock …) without touching them.
--
-- Name prefixes inside the schema
--   (none)   workspace, store, member, setting, write_switch, provider, connection, sync_*, raw_*
--   shop_ / product / variant / collection / order_* / fulfillment* / refund* / blog*   Shopify
--   sq_      ShopifyQL analytics      gsc_ / ga4_   Google        ads_   Meta + Google Ads
--   ship_ / tracking / scan / carrier* / mcf_ / fba_   shipping   seo_ cro_ ai_   team work
--   action* / approval / notification / audit_log       API writes + audit
--
-- Rules: workspace_id + store_id on every business row (composite FK to a real store of that workspace);
-- outside ids as text, unique per store; timestamptz; money numeric(14,2) + currency code;
-- no customer names / emails / phones / street addresses / order notes; no secrets (Vault names only).
-- =====================================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create schema if not exists flowmerce;

create or replace function flowmerce.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ===================================================================== workspaces, stores, people
create table flowmerce.workspace (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            extensions.citext not null unique,
  plan            text not null default 'trial' check (plan in ('trial','starter','growth','scale','internal')),
  status          text not null default 'active' check (status in ('active','suspended','cancelled')),
  ai_daily_budget_usd numeric(10,2),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table flowmerce.store (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references flowmerce.workspace(id) on delete cascade,
  code            text not null check (code ~ '^[A-Z0-9_]{2,12}$'),   -- RBP, CPC
  name            text not null,
  platform        text not null default 'shopify' check (platform in ('shopify')),
  shop_domain     text unique,
  primary_domain  text,
  currency        char(3) not null default 'USD',
  timezone        text not null default 'America/New_York',
  ops_timezone    text not null default 'Asia/Kolkata',
  erp_brand       text,                                     -- ERP core.skus.brand ('Ridhi','CPC')
  erp_brand_code  text,                                     -- ERP planning.* / sellora.* brand ('SP','CPC')
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, code),
  unique (workspace_id, id)
);

create table flowmerce.member (
  workspace_id    uuid not null references flowmerce.workspace(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  display_name    text not null,
  role            text not null default 'viewer' check (role in ('owner','admin','manager','editor','viewer')),
  can_see_costs   boolean not null default false,
  all_stores      boolean not null default true,
  sections        text[] not null default '{home,shipping,seo,cro,ads}',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table flowmerce.member_store (
  workspace_id    uuid not null,
  user_id         uuid not null,
  store_id        uuid not null,
  primary key (workspace_id, user_id, store_id),
  foreign key (workspace_id, user_id)  references flowmerce.member (workspace_id, user_id) on delete cascade,
  foreign key (workspace_id, store_id) references flowmerce.store  (workspace_id, id)      on delete cascade
);

create table flowmerce.team (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references flowmerce.workspace(id) on delete cascade,
  name            text not null,
  unique (workspace_id, name)
);

create table flowmerce.team_member (
  team_id         uuid not null references flowmerce.team(id) on delete cascade,
  workspace_id    uuid not null,
  user_id         uuid not null,
  primary key (team_id, user_id),
  foreign key (workspace_id, user_id) references flowmerce.member (workspace_id, user_id) on delete cascade
);

create table flowmerce.setting (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references flowmerce.workspace(id) on delete cascade,
  store_id        uuid,                                    -- null = whole workspace
  key             text not null,
  value           jsonb not null,
  updated_by      uuid,
  updated_at      timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);
create unique index setting_one_per_key on flowmerce.setting
  (workspace_id, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create table flowmerce.write_switch (
  workspace_id    uuid not null references flowmerce.workspace(id) on delete cascade,
  store_id        uuid,
  switch_key      text not null check (switch_key in (
                    'shopify_article_publish','shopify_file_upload','shopify_seo_update','shopify_page_create',
                    'shopify_writes','amazon_writes','ads_writes','tracking_register','notify_send')),
  is_on           boolean not null default false,
  changed_by      uuid,
  changed_at      timestamptz not null default now(),
  note            text,
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);
create unique index write_switch_one on flowmerce.write_switch
  (workspace_id, coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid), switch_key);

-- ===================================================================== access helpers (RLS)
create or replace function flowmerce.is_member(p_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from flowmerce.member m
                 where m.workspace_id = p_workspace and m.user_id = auth.uid() and m.is_active);
$$;

create or replace function flowmerce.member_role(p_workspace uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from flowmerce.member m
  where m.workspace_id = p_workspace and m.user_id = auth.uid() and m.is_active;
$$;

create or replace function flowmerce.can_see_store(p_workspace uuid, p_store uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from flowmerce.member m
    where m.workspace_id = p_workspace and m.user_id = auth.uid() and m.is_active
      and (m.all_stores or p_store is null or exists (
            select 1 from flowmerce.member_store ms
            where ms.workspace_id = m.workspace_id and ms.user_id = m.user_id and ms.store_id = p_store)));
$$;

create or replace function flowmerce.can_edit(p_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(flowmerce.member_role(p_workspace) in ('owner','admin','manager','editor'), false);
$$;

create or replace function flowmerce.is_admin(p_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(flowmerce.member_role(p_workspace) in ('owner','admin'), false);
$$;

create or replace function flowmerce.can_see_costs(p_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.can_see_costs or m.role in ('owner','admin') from flowmerce.member m
                    where m.workspace_id = p_workspace and m.user_id = auth.uid() and m.is_active), false);
$$;

-- Who is acting: the signed-in user, or the name a job sets with set_config('flowmerce.actor', 'job:…', true)
create or replace function flowmerce.current_actor() returns text
language sql stable as $$
  select coalesce(auth.uid()::text, nullif(current_setting('flowmerce.actor', true), ''), current_user::text);
$$;

create or replace function flowmerce.write_allowed(p_workspace uuid, p_store uuid, p_switch text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select w.is_on from flowmerce.write_switch w
    where w.workspace_id = p_workspace and w.switch_key = p_switch
      and (w.store_id = p_store or w.store_id is null)
    order by (w.store_id is null)
    limit 1), false);
$$;

create trigger workspace_updated before update on flowmerce.workspace for each row execute function flowmerce.set_updated_at();
create trigger store_updated     before update on flowmerce.store     for each row execute function flowmerce.set_updated_at();
create trigger member_updated    before update on flowmerce.member    for each row execute function flowmerce.set_updated_at();

-- ===================================================================== connections, sync jobs, sync log
create table flowmerce.provider (
  code            text primary key,
  category        text not null check (category in ('commerce','ads','analytics','seo','shipping','reviews','ai','messaging','storage')),
  display_name    text not null,
  daily_call_limit integer
);

insert into flowmerce.provider (code, category, display_name, daily_call_limit) values
 ('shopify','commerce','Shopify Admin GraphQL API',null), ('shopifyql','analytics','ShopifyQL (Shopify analytics)',null),
 ('gsc','analytics','Google Search Console API',null),    ('ga4','analytics','Google Analytics 4 Data API',null),
 ('meta_ads','ads','Meta Marketing API',null),            ('google_ads','ads','Google Ads API',null),
 ('dhl','shipping','DHL Shipment Tracking API',250),      ('fedex','shipping','FedEx Track API',null),
 ('aftership','shipping','AfterShip Tracking API',null),  ('track17','shipping','17TRACK API',null),
 ('amazon_spapi','shipping','Amazon Selling Partner API (MCF, FBA)',null), ('mcf_sheet','shipping','Amazon MCF Google Sheet',null),
 ('erp','commerce','Ridhi ERP (same Supabase project)',null),
 ('anthropic','ai','Claude API',null), ('image_ai','ai','Image generation API',null),
 ('slack','messaging','Slack',null), ('email','messaging','Email',null), ('whatsapp','messaging','WhatsApp Business Cloud API',null);

create table flowmerce.connection (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  store_id         uuid not null,
  provider_code    text not null references flowmerce.provider(code),
  account_ref      text not null,
  display_name     text not null,
  auth_type        text not null check (auth_type in ('oauth2','api_key','system_user_token','lwa','service_account','client_credentials','none')),
  secret_name      text,                          -- name of the secret in Supabase Vault, NEVER the secret
  scopes           text[] not null default '{}',
  can_write        boolean not null default false,
  status           text not null default 'active' check (status in ('active','paused','error','revoked')),
  last_success_at  timestamptz,
  last_error       text,
  token_expires_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, provider_code, account_ref)
);
create trigger connection_updated before update on flowmerce.connection for each row execute function flowmerce.set_updated_at();

create table flowmerce.sync_job (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  connection_id   uuid not null references flowmerce.connection(id) on delete cascade,
  stream          text not null,                  -- 'shopify.orders', 'shopifyql.sessions_daily', 'meta.insights.ad.daily'
  mode            text not null default 'incremental' check (mode in ('incremental','backfill','snapshot','webhook_catchup')),
  schedule_cron   text,
  repull_days     integer not null default 0,     -- ads 7, GSC 10, GA4 7, ShopifyQL 3
  history_days    integer,                        -- null = all time
  cursor          jsonb not null default '{}',
  is_enabled      boolean not null default true,
  locked_by       text,
  locked_until    timestamptz,
  last_run_at     timestamptz,
  last_ok_at      timestamptz,
  next_run_at     timestamptz,
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (connection_id, stream, mode)
);

create table flowmerce.sync_run (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references flowmerce.workspace(id) on delete cascade,
  store_id         uuid,                           -- null = a run for the whole workspace
  sync_job_id      uuid references flowmerce.sync_job(id) on delete cascade,
  source           text not null,
  stream           text not null,
  triggered_by     text not null default 'schedule',
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'running' check (status in ('running','ok','partial','failed','skipped')),
  rows_read        integer not null default 0,
  rows_written     integer not null default 0,
  api_calls        integer not null default 0,
  window_from      timestamptz,
  window_to        timestamptz,
  cursor_after     jsonb,
  error            text,
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);
create index sync_run_job_time   on flowmerce.sync_run (sync_job_id, started_at desc);
create index sync_run_store_time on flowmerce.sync_run (store_id, source, stream, started_at desc);

create or replace function flowmerce.try_lock(p_job uuid, p_owner text, p_minutes integer default 30)
returns boolean language plpgsql as $$
declare n integer;
begin
  update flowmerce.sync_job
     set locked_by = p_owner, locked_until = now() + make_interval(mins => p_minutes), last_run_at = now()
   where id = p_job and is_enabled and (locked_until is null or locked_until < now());
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function flowmerce.release_lock(p_job uuid, p_owner text, p_cursor jsonb default null, p_ok boolean default true)
returns void language sql as $$
  update flowmerce.sync_job
     set locked_by = null, locked_until = null, cursor = coalesce(p_cursor, cursor),
         last_ok_at = case when p_ok then now() else last_ok_at end
   where id = p_job and locked_by = p_owner;
$$;

create table flowmerce.webhook_subscription (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  connection_id   uuid not null references flowmerce.connection(id) on delete cascade,
  topic           text not null,
  external_id     text,
  endpoint_url    text not null,
  status          text not null default 'active' check (status in ('active','failing','disabled')),
  last_received_at timestamptz,
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (connection_id, topic)
);

-- ===================================================================== raw copies (kept 13 months)
create table flowmerce.raw_api_payload (
  id             bigint generated always as identity,
  received_at    timestamptz not null default now(),
  workspace_id   uuid not null,
  store_id       uuid not null,
  provider_code  text not null,
  stream         text not null,
  external_id    text,
  sync_run_id    uuid,
  payload_hash   text not null,
  payload        jsonb not null,
  processed_at   timestamptz,
  primary key (id, received_at)
) partition by range (received_at);
create table flowmerce.raw_api_payload_default partition of flowmerce.raw_api_payload default;
create index raw_api_payload_lookup on flowmerce.raw_api_payload (store_id, stream, external_id, received_at desc);
create index raw_api_payload_hash   on flowmerce.raw_api_payload (payload_hash);

create table flowmerce.raw_webhook_event (
  id               bigint generated always as identity primary key,
  workspace_id     uuid,
  store_id         uuid,
  provider_code    text not null,
  topic            text not null,
  shop_domain      text,
  idempotency_key  text not null,
  signature_valid  boolean not null,
  headers          jsonb not null default '{}',
  payload          jsonb not null,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  attempts         integer not null default 0,
  error            text,
  unique (provider_code, idempotency_key)
);
create index raw_webhook_unprocessed on flowmerce.raw_webhook_event (received_at) where processed_at is null;

create or replace function flowmerce.purge_raw(p_months integer default 13) returns integer
language plpgsql as $$
declare n1 integer; n2 integer;
begin
  delete from flowmerce.raw_api_payload where received_at < now() - make_interval(months => p_months);
  get diagnostics n1 = row_count;
  delete from flowmerce.raw_webhook_event where received_at < now() - make_interval(months => p_months) and processed_at is not null;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

-- ===================================================================== Shopify: shop + catalog
create table flowmerce.shop_info (
  store_id        uuid primary key,
  workspace_id    uuid not null,
  external_id     text not null,
  name            text not null,
  myshopify_domain text not null,
  primary_domain  text,
  timezone        text,
  currency        char(3),
  plan_name       text,
  synced_at       timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.product (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  external_id     text not null,                  -- gid://shopify/Product/…
  handle          text not null,
  title           text not null,
  product_type    text,
  vendor          text,
  tags            text[] not null default '{}',
  status          text not null check (status in ('active','draft','archived','unlisted')),
  online_store_url text,
  featured_image_url text,
  seo_title       text,
  seo_description text,
  src_created_at  timestamptz,
  src_updated_at  timestamptz,
  removed_at      timestamptz,
  synced_at       timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, external_id)
);
create index product_handle on flowmerce.product (store_id, handle);

create table flowmerce.variant (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null,
  store_id           uuid not null,
  product_id         uuid not null references flowmerce.product(id) on delete cascade,
  external_id        text not null,
  inventory_item_id  text,
  sku                text,                        -- joins to ERP core.skus.sku
  barcode            text,
  title              text not null,
  price              numeric(14,2),
  compare_at_price   numeric(14,2),
  cost               numeric(14,2),               -- hidden unless can_see_costs
  currency           char(3),
  weight_grams       integer,
  removed_at         timestamptz,
  synced_at          timestamptz not null default now(),
  unique (store_id, external_id)
);
create index variant_sku on flowmerce.variant (store_id, sku);

create table flowmerce.catalog_change (
  id              bigint generated always as identity primary key,
  workspace_id    uuid not null,
  store_id        uuid not null,
  entity_type     text not null check (entity_type in ('product','variant','collection')),
  entity_id       uuid not null,
  field           text not null,
  old_value       text,
  new_value       text,
  changed_at      timestamptz not null default now(),
  source          text not null default 'sync' check (source in ('sync','webhook','flowmerce'))
);
create index catalog_change_entity on flowmerce.catalog_change (entity_type, entity_id, changed_at desc);

create table flowmerce.product_image (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  product_id      uuid not null references flowmerce.product(id) on delete cascade,
  external_id     text not null,
  url             text not null,
  alt_text        text,
  position        integer,
  unique (store_id, external_id)
);

create table flowmerce.collection (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  external_id     text not null,
  handle          text not null,
  title           text not null,
  kind            text check (kind in ('smart','custom')),
  seo_title       text,
  seo_description text,
  removed_at      timestamptz,
  synced_at       timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, external_id)
);

create table flowmerce.product_collection (
  product_id      uuid not null references flowmerce.product(id) on delete cascade,
  collection_id   uuid not null references flowmerce.collection(id) on delete cascade,
  workspace_id    uuid not null,
  store_id        uuid not null,
  primary key (product_id, collection_id)
);

create table flowmerce.location (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  store_id        uuid not null,
  external_id     text not null,
  name            text not null,
  kind            text not null default 'shopify_location' check (kind in ('shopify_location','amazon_fba','production_unit','3pl','other')),
  country         char(2),
  is_active       boolean not null default true,
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, external_id)
);

create table flowmerce.inventory_level (
  variant_id      uuid not null references flowmerce.variant(id) on delete cascade,
  location_id     uuid not null references flowmerce.location(id) on delete cascade,
  workspace_id    uuid not null,
  store_id        uuid not null,
  available       integer not null default 0,
  on_hand         integer,
  committed       integer,
  incoming        integer,
  as_of           timestamptz not null default now(),
  primary key (variant_id, location_id)
);

-- ===================================================================== Shopify: orders
create table flowmerce.shop_order (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  store_id            uuid not null,
  external_id         text not null,              -- gid://shopify/Order/…  (ERP: sales.shopify_orders.shop_order_id)
  name                text not null,              -- #1234
  order_number        bigint,
  src_created_at      timestamptz not null,
  src_updated_at      timestamptz,
  processed_at        timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  is_test             boolean not null default false,
  financial_status    text,
  fulfillment_status  text,
  tags                text[] not null default '{}',
  source_name         text,
  channel             text,
  landing_site        text,
  referring_site      text,
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  utm_content         text,
  utm_term            text,
  discount_codes      text[] not null default '{}',
  shipping_method     text,
  ship_city           text,
  ship_province       text,
  ship_country        char(2),
  customer_email_sha256 text,
  is_returning_customer boolean,
  currency            char(3) not null,
  subtotal            numeric(14,2) not null default 0,
  discounts           numeric(14,2) not null default 0,
  shipping            numeric(14,2) not null default 0,
  tax                 numeric(14,2) not null default 0,
  total               numeric(14,2) not null default 0,
  total_refunded      numeric(14,2) not null default 0,
  net                 numeric(14,2) generated always as (total - total_refunded) stored,
  presentment_currency char(3),
  p_subtotal          numeric(14,2),
  p_discounts         numeric(14,2),
  p_shipping          numeric(14,2),
  p_tax               numeric(14,2),
  p_total             numeric(14,2),
  p_total_refunded    numeric(14,2),
  synced_at           timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, external_id)
);
create index shop_order_created on flowmerce.shop_order (store_id, src_created_at desc);
create index shop_order_updated on flowmerce.shop_order (store_id, src_updated_at desc);
create index shop_order_utm     on flowmerce.shop_order (store_id, utm_campaign, utm_content);
create index shop_order_name    on flowmerce.shop_order (store_id, name);

create table flowmerce.order_line (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  store_id            uuid not null,
  order_id            uuid not null references flowmerce.shop_order(id) on delete cascade,
  external_id         text not null,
  product_external_id text,
  variant_external_id text,
  product_id          uuid references flowmerce.product(id) on delete set null,
  variant_id          uuid references flowmerce.variant(id) on delete set null,
  sku                 text,
  title               text not null,
  variant_title       text,
  product_type        text,
  tags                text[] not null default '{}',
  quantity            integer not null,
  unit_price          numeric(14,2) not null,
  discount            numeric(14,2) not null default 0,
  fulfilled_quantity  integer not null default 0,
  currency            char(3) not null,
  unique (store_id, external_id)
);
create index order_line_order   on flowmerce.order_line (order_id);
create index order_line_variant on flowmerce.order_line (variant_id);
create index order_line_sku     on flowmerce.order_line (store_id, sku);

create table flowmerce.fulfillment (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  store_id            uuid not null,
  order_id            uuid not null references flowmerce.shop_order(id) on delete cascade,
  external_id         text not null,
  status              text,
  display_status      text,
  service             text,
  carrier_name_raw    text,
  tracking_numbers    text[] not null default '{}',
  tracking_urls       text[] not null default '{}',
  src_created_at      timestamptz,
  in_transit_at       timestamptz,
  estimated_delivery_at timestamptz,
  delivered_at        timestamptz,                -- Shopify's word, NOT proof
  src_updated_at      timestamptz,
  synced_at           timestamptz not null default now(),
  unique (store_id, external_id)
);
create index fulfillment_order on flowmerce.fulfillment (order_id);

create table flowmerce.fulfillment_line (
  fulfillment_id      uuid not null references flowmerce.fulfillment(id) on delete cascade,
  order_line_id       uuid not null references flowmerce.order_line(id) on delete cascade,
  workspace_id        uuid not null,
  store_id            uuid not null,
  quantity            integer not null,
  primary key (fulfillment_id, order_line_id)
);

create table flowmerce.fulfillment_event (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  store_id            uuid not null,
  fulfillment_id      uuid not null references flowmerce.fulfillment(id) on delete cascade,
  external_id         text not null,
  status              text not null,
  happened_at         timestamptz not null,
  message             text,
  city                text,
  province            text,
  country             text,
  unique (store_id, external_id)
);
create index fulfillment_event_f on flowmerce.fulfillment_event (fulfillment_id, happened_at desc);

create table flowmerce.refund (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  store_id            uuid not null,
  order_id            uuid not null references flowmerce.shop_order(id) on delete cascade,
  external_id         text not null,
  src_created_at      timestamptz not null,
  amount              numeric(14,2) not null default 0,
  currency            char(3) not null,
  reason              text,
  unique (store_id, external_id)
);

create table flowmerce.refund_line (
  refund_id           uuid not null references flowmerce.refund(id) on delete cascade,
  order_line_id       uuid not null references flowmerce.order_line(id) on delete cascade,
  workspace_id        uuid not null,
  store_id            uuid not null,
  quantity            integer not null,
  subtotal            numeric(14,2) not null default 0,
  restock_type        text,
  primary key (refund_id, order_line_id)
);

create table flowmerce.order_return (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  store_id            uuid not null,
  order_id            uuid not null references flowmerce.shop_order(id) on delete cascade,
  external_id         text not null,
  status              text not null,
  reason              text,
  return_tracking_number text,
  return_carrier      text,
  src_created_at      timestamptz,
  closed_at           timestamptz,
  unique (store_id, external_id)
);

-- ===================================================================== Shopify: blog
create table flowmerce.blog (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  store_id            uuid not null,
  external_id         text not null,
  handle              text not null,
  title               text not null,
  synced_at           timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, external_id)
);

create table flowmerce.blog_article (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  store_id            uuid not null,
  blog_id             uuid not null references flowmerce.blog(id) on delete cascade,
  external_id         text not null,
  handle              text not null,
  title               text not null,
  body_html           text,
  summary_html        text,
  tags                text[] not null default '{}',
  author              text,
  is_published        boolean not null default false,
  published_at        timestamptz,
  image_url           text,
  image_alt           text,
  seo_title           text,
  seo_description     text,
  src_created_at      timestamptz,
  src_updated_at      timestamptz,
  removed_at          timestamptz,
  synced_at           timestamptz not null default now(),
  unique (store_id, external_id)
);
create index blog_article_blog on flowmerce.blog_article (blog_id, published_at desc);
