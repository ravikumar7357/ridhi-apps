-- =====================================================================================
-- Flowmerce · schema flowmerce · file 03 · shipping + Amazon MCF, and the data the team types in (seo_, cro_, ai_)
-- "Shopify's delivered is not proof": tracking.delivery_confirmed is true ONLY from a carrier feed.
-- Team marks are kept apart from carrier data.
-- =====================================================================================

-- ===================================================================== carriers and maps (shared reference)
create table flowmerce.carrier (
  code              text primary key check (code ~ '^[a-z0-9_]{1,40}$'),
  name              text not null,
  track_url_template text,
  provider_code     text references flowmerce.provider(code),
  can_confirm_delivery boolean not null default true
);

insert into flowmerce.carrier (code, name, track_url_template, provider_code, can_confirm_delivery) values
 ('dhl',    'DHL Express', 'https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id={tracking}', 'dhl', true),
 ('fedex',  'FedEx',       'https://www.fedex.com/fedextrack/?trknbr={tracking}', 'fedex', true),
 ('ups',    'UPS',         'https://www.ups.com/track?tracknum={tracking}', null, true),
 ('usps',   'USPS',        'https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking}', null, true),
 ('amazon', 'Amazon Logistics', 'https://track.amazon.com/tracking/{tracking}', 'amazon_spapi', true),
 ('aramex', 'Aramex',      'https://www.aramex.com/track/results?ShipmentNumber={tracking}', null, true),
 ('unknown','Unknown carrier', null, null, false);

create table flowmerce.carrier_alias (             -- "DHL Express", "dhl" -> dhl; workspace_id null = everyone
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid references flowmerce.workspace(id) on delete cascade,
  alias             extensions.citext not null,
  carrier_code      text not null references flowmerce.carrier(code)
);
create unique index carrier_alias_one on flowmerce.carrier_alias
  (coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), alias);

insert into flowmerce.carrier_alias (alias, carrier_code) values
 ('dhl','dhl'),('dhl express','dhl'),('dhl ecommerce','dhl'),('dhl_express','dhl'),
 ('fedex','fedex'),('fed ex','fedex'),('federal express','fedex'),
 ('ups','ups'),('usps','usps'),('united states postal service','usps'),
 ('amazon','amazon'),('amazon logistics','amazon'),('amzl','amazon'),('aramex','aramex');

create table flowmerce.status_map (                -- carrier word -> our status; fix a mapping by editing a row
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid references flowmerce.workspace(id) on delete cascade,
  carrier_code      text not null references flowmerce.carrier(code),
  raw_status        extensions.citext not null,
  our_status        text not null check (our_status in ('pending','info_received','in_transit','out_for_delivery','delivered','exception','returned','expired')),
  is_delivery_proof boolean not null default false,
  note              text
);
create unique index status_map_one on flowmerce.status_map
  (coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), carrier_code, raw_status);

insert into flowmerce.status_map (carrier_code, raw_status, our_status, is_delivery_proof) values
 ('dhl','pre-transit','info_received',false),('dhl','transit','in_transit',false),('dhl','delivered','delivered',true),
 ('dhl','failure','exception',false),('dhl','unknown','pending',false),
 ('fedex','OC','info_received',false),('fedex','PU','in_transit',false),('fedex','IT','in_transit',false),
 ('fedex','AR','in_transit',false),('fedex','DP','in_transit',false),('fedex','OD','out_for_delivery',false),
 ('fedex','DL','delivered',true),('fedex','DE','exception',false),('fedex','SE','exception',false),('fedex','RS','returned',false);

-- ===================================================================== parcels and tracking
create table flowmerce.shipment (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  store_id          uuid not null,
  order_id          uuid not null references flowmerce.shop_order(id) on delete cascade,
  fulfillment_id    uuid references flowmerce.fulfillment(id) on delete set null,
  seq               smallint not null default 1,
  kind              text not null default 'own' check (kind in ('own','mcf','india','3pl','manual')),
  kind_inferred     boolean not null default false,
  step              text not null default 'requested' check (step in ('requested','packed','label','shipped','transit','out','delivered','returned','cancelled')),
  carrier_code      text references flowmerce.carrier(code),
  carrier_name_raw  text,
  service           text,
  responsible       text,
  items             jsonb not null default '[]',
  erp_box_id        bigint,                          -- link to ERP shipping.boxes.id when packed in the ERP
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (order_id, seq)
);
create trigger shipment_updated before update on flowmerce.shipment for each row execute function flowmerce.set_updated_at();

create table flowmerce.tracking (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  store_id          uuid not null,
  shipment_id       uuid not null references flowmerce.shipment(id) on delete cascade,
  carrier_code      text not null default 'unknown' references flowmerce.carrier(code),
  tracking_number   text not null,
  source            text not null default 'shopify' check (source in ('shopify','dhl','fedex','aftership','track17','amazon','mcf_sheet','manual')),
  status            text not null default 'pending' check (status in ('pending','info_received','in_transit','out_for_delivery','delivered','exception','returned','expired')),
  raw_status        text,
  status_detail     text,
  delivery_confirmed boolean not null default false,
  registered_at     timestamptz not null default now(),
  picked_up_at      timestamptz,
  last_scan_at      timestamptz,
  last_scan_place   text,
  scan_count        integer not null default 0,
  eta               timestamptz,
  eta_window_start  timestamptz,
  eta_window_end    timestamptz,
  promised_by       date,
  delivered_at      timestamptz,
  signed_by         text,                            -- the only person name we keep
  proof_of_delivery_url text,
  carrier_service   text,
  weight_kg         numeric(8,3),
  pieces            smallint,
  customs_status    text,
  exception_code    text,
  exception_text    text,
  dest_city         text,
  dest_state        text,
  dest_country      char(2),
  active            boolean not null default true,
  last_checked_at   timestamptz,
  last_check_ok_at  timestamptz,
  last_check_error  text,
  check_attempts    integer not null default 0,
  next_check_at     timestamptz,
  external_ref      text,
  updated_at        timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, carrier_code, tracking_number)
);
create index tracking_due_idx  on flowmerce.tracking (next_check_at) where active;
create index tracking_shipment on flowmerce.tracking (shipment_id);
create index tracking_number_idx on flowmerce.tracking (tracking_number);
create trigger tracking_updated before update on flowmerce.tracking for each row execute function flowmerce.set_updated_at();

create table flowmerce.team_mark (
  tracking_id       uuid primary key references flowmerce.tracking(id) on delete cascade,
  workspace_id      uuid not null,
  store_id          uuid not null,
  mark              text check (mark in ('delivered','lost','failed','in_transit','checked','returned','reshipped','refunded')),
  note              text,
  marked_by         text not null,
  marked_at         timestamptz not null default now()
);

create table flowmerce.scan (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  store_id          uuid not null,
  tracking_id       uuid not null references flowmerce.tracking(id) on delete cascade,
  scanned_at        timestamptz not null,
  received_at       timestamptz not null default now(),
  status            text not null check (status in ('pending','info_received','in_transit','out_for_delivery','delivered','exception','returned','expired')),
  raw_status        text,
  message           text,
  city              text,
  state             text,
  country           text,
  source            text not null,
  mapped_rule       uuid references flowmerce.status_map(id) on delete set null
);
create unique index scan_once on flowmerce.scan        -- never stored twice; loaders use ON CONFLICT DO NOTHING
  (tracking_id, scanned_at, coalesce(raw_status, ''), coalesce(city, ''), md5(coalesce(message, '')));
create index scan_tracking on flowmerce.scan (tracking_id, scanned_at desc);

create or replace function flowmerce.apply_scan() returns trigger
language plpgsql as $$
declare is_proof boolean;
begin
  select sm.is_delivery_proof into is_proof from flowmerce.status_map sm where sm.id = new.mapped_rule;
  update flowmerce.tracking t set
    scan_count      = t.scan_count + 1,
    picked_up_at    = coalesce(t.picked_up_at, case when new.status in ('in_transit','out_for_delivery','delivered') then new.scanned_at end),
    last_scan_place = case when t.last_scan_at is null or new.scanned_at >= t.last_scan_at
                           then concat_ws(', ', new.city, new.state, new.country) else t.last_scan_place end,
    status          = case when t.last_scan_at is null or new.scanned_at >= t.last_scan_at then new.status else t.status end,
    raw_status      = case when t.last_scan_at is null or new.scanned_at >= t.last_scan_at then new.raw_status else t.raw_status end,
    last_scan_at    = greatest(coalesce(t.last_scan_at, new.scanned_at), new.scanned_at),
    delivered_at    = case when new.status = 'delivered' then coalesce(t.delivered_at, new.scanned_at) else t.delivered_at end,
    delivery_confirmed = t.delivery_confirmed
                         or (new.status = 'delivered' and new.source in ('dhl','fedex','aftership','track17','amazon')
                             and coalesce(is_proof, true)),
    active          = case when new.status in ('delivered','returned','expired') then false else t.active end
  where t.id = new.tracking_id;
  return new;
end $$;
create trigger scan_applied after insert on flowmerce.scan for each row execute function flowmerce.apply_scan();

create table flowmerce.carrier_call (
  id                bigint generated always as identity primary key,
  workspace_id      uuid not null,
  store_id          uuid,
  provider_code     text not null references flowmerce.provider(code),
  tracking_id       uuid references flowmerce.tracking(id) on delete set null,
  called_at         timestamptz not null default now(),
  http_status       integer,
  ok                boolean not null,
  duration_ms       integer,
  error             text
);
create index carrier_call_day on flowmerce.carrier_call (provider_code, called_at desc);

-- ===================================================================== problems, claims, costs
create table flowmerce.ship_exception (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  store_id          uuid not null,
  shipment_id       uuid references flowmerce.shipment(id) on delete cascade,
  tracking_id       uuid references flowmerce.tracking(id) on delete cascade,
  kind              text not null,
  severity          text not null default 'amber' check (severity in ('amber','red')),
  source            text not null default 'team',
  detected_at       timestamptz not null default now(),
  description       text,
  status            text not null default 'open' check (status in ('open','in_progress','waiting_carrier','resolved','closed')),
  owner             text,
  resolution        text,
  closed_at         timestamptz,
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);
create index ship_exception_open on flowmerce.ship_exception (store_id) where closed_at is null;

create table flowmerce.ship_claim (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  store_id          uuid not null,
  tracking_id       uuid not null references flowmerce.tracking(id) on delete cascade,
  exception_id      uuid references flowmerce.ship_exception(id) on delete set null,
  carrier_code      text not null references flowmerce.carrier(code),
  claim_ref         text,
  amount            numeric(14,2),
  currency          char(3),
  status            text not null default 'draft' check (status in ('draft','filed','approved','rejected','paid')),
  filed_at          timestamptz,
  settled_at        timestamptz,
  note              text
);

create table flowmerce.ship_rate_card (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references flowmerce.workspace(id) on delete cascade,
  carrier_code      text not null references flowmerce.carrier(code),
  service           text not null,
  dest_country      char(2) not null,
  weight_from_kg    numeric(8,3) not null,
  weight_to_kg      numeric(8,3) not null,
  price             numeric(14,2) not null,
  currency          char(3) not null,
  valid_from        date not null,
  valid_to          date
);

create table flowmerce.ship_cost (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  store_id          uuid not null,
  shipment_id       uuid not null references flowmerce.shipment(id) on delete cascade,
  kind              text not null default 'postage' check (kind in ('postage','duties','surcharge','return','mcf_fee','other')),
  amount            numeric(14,2) not null,
  currency          char(3) not null,
  amount_usd        numeric(14,2),
  is_estimate       boolean not null default true,
  invoice_ref       text,
  created_at        timestamptz not null default now()
);

-- ===================================================================== team work on orders
create table flowmerce.order_event (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  store_id          uuid not null,
  order_id          uuid not null references flowmerce.shop_order(id) on delete cascade,
  shipment_id       uuid references flowmerce.shipment(id) on delete set null,
  at                timestamptz not null default now(),
  type              text not null check (type in ('note','mark','alert','status','system')),
  by                text not null,
  title             text not null,
  data              jsonb not null default '{}',
  alert_kind        text,
  severity          text check (severity in ('info','amber','red')),
  owner_team        text,
  assigned_to       text,
  due_at            timestamptz,
  seen_at           timestamptz,
  closed_at         timestamptz
);
create index order_event_order on flowmerce.order_event (order_id, at desc);

create table flowmerce.order_review (
  order_id          uuid primary key references flowmerce.shop_order(id) on delete cascade,
  workspace_id      uuid not null,
  store_id          uuid not null,
  reviewed          boolean not null default false,
  flagged           boolean not null default false,
  outcome           text,
  updated_by        text,
  updated_at        timestamptz not null default now()
);

-- ===================================================================== Amazon MCF
create table flowmerce.mcf_sheet_row (             -- today: daily copy of the team's Google Sheet
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  store_id          uuid not null,
  brand             text,
  order_number      text not null,
  mcf_id            text,
  order_status      text,
  received_at       timestamptz,
  speed             text,
  parcel            text,
  carrier           text,
  tracking          text,
  shipped_at        timestamptz,
  arrives_by        date,
  current_status    text,
  last_scan         text,
  last_scan_where   text,
  delivered_at      timestamptz,
  checked           text,
  flag              text,
  imported_at       timestamptz not null default now(),
  sync_run_id       uuid,
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);
create unique index mcf_sheet_row_once on flowmerce.mcf_sheet_row (store_id, order_number, coalesce(parcel, ''));

create table flowmerce.mcf_order (                 -- later: Amazon SP-API directly
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  store_id          uuid not null,
  order_id          uuid references flowmerce.shop_order(id) on delete set null,
  seller_fulfillment_order_id text not null,
  amazon_order_id   text,
  marketplace_id    text,
  status            text not null,
  shipping_speed    text check (shipping_speed in ('Standard','Expedited','Priority','ScheduledDelivery')),
  received_at       timestamptz,
  status_updated_at timestamptz,
  source            text not null default 'spapi' check (source in ('spapi','mcf_sheet','erp')),
  synced_at         timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, seller_fulfillment_order_id)
);

create table flowmerce.mcf_package (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  store_id          uuid not null,
  mcf_order_id      uuid not null references flowmerce.mcf_order(id) on delete cascade,
  shipment_id       uuid references flowmerce.shipment(id) on delete set null,
  amazon_shipment_id text,
  package_number    integer not null,
  carrier_code      text,
  tracking_number   text,
  estimated_arrival_at timestamptz,
  shipped_at        timestamptz,
  status            text,
  unique (mcf_order_id, package_number)
);

create table flowmerce.mcf_item (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  store_id          uuid not null,
  mcf_order_id      uuid not null references flowmerce.mcf_order(id) on delete cascade,
  seller_sku        text not null,
  variant_id        uuid references flowmerce.variant(id) on delete set null,
  quantity          integer not null,
  cancelled_quantity integer not null default 0,
  unfulfillable_quantity integer not null default 0
);

create table flowmerce.fba_stock (
  workspace_id      uuid not null,
  store_id          uuid not null,
  seller_sku        text not null,
  variant_id        uuid references flowmerce.variant(id) on delete set null,
  fnsku             text,
  asin              text,
  fulfillable       integer not null default 0,
  inbound           integer not null default 0,
  reserved          integer not null default 0,
  unfulfillable     integer not null default 0,
  as_of             timestamptz not null default now(),
  primary key (store_id, seller_sku)
);

-- ===================================================================== SEO (team work)
create table flowmerce.seo_brand_settings (
  store_id uuid primary key, workspace_id uuid not null,
  settings jsonb not null default '{}', updated_by uuid, updated_at timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.seo_automation_state (
  store_id uuid primary key, workspace_id uuid not null,
  paused boolean not null default false, paused_by uuid, paused_at timestamptz, reason text not null default '',
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

create table flowmerce.seo_keyword (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  keyword text not null, keyword_norm text not null, search_volume integer, keyword_difficulty integer,
  intent text check (intent in ('informational','commercial','transactional','navigational','mixed')),
  source_tool text not null default 'manual', source_date date, notes text not null default '',
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, keyword_norm)
);

create table flowmerce.seo_topic (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  title text not null, primary_keyword text not null, keyword_norm text not null,
  secondary_keywords text[] not null default '{}', intent text not null default 'informational',
  search_volume integer, keyword_difficulty integer, volume_source text,
  rationale text not null default '', notes text not null default '', validation_note text not null default '',
  target_product_ids uuid[] not null default '{}',
  status text not null default 'proposed' check (status in ('proposed','approved','drafting','drafted','published','rejected','parked')),
  source text not null default 'manual' check (source in ('manual','ai','import')),
  owner_id uuid, must_publish_by date, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, keyword_norm)
);

create table flowmerce.seo_article (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  topic_id uuid references flowmerce.seo_topic(id) on delete set null,
  blog_article_id uuid references flowmerce.blog_article(id) on delete set null,   -- the stored Shopify copy
  title text not null, handle text not null, primary_keyword text not null default '',
  meta_title text not null default '', meta_description text not null default '',
  summary_html text not null default '', body_html text not null default '', tags text[] not null default '{}',
  author text not null default '', image_url text not null default '', image_alt text not null default '',
  status text not null default 'draft' check (status in ('draft','in_review','changes_requested','approved','scheduled','published','archived')),
  assignee_id uuid, version integer not null default 1, content_hash text not null default '',
  approved_hash text, approved_by uuid, approved_at timestamptz,
  shopify_article_external_id text, live_hash text, live_url text, publish_at timestamptz, published_at timestamptz,
  origin text not null default 'app' check (origin in ('app','shopify','import')), last_error text,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, handle)
);
create index seo_article_status on flowmerce.seo_article (store_id, status);

create table flowmerce.seo_article_revision (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  article_id uuid not null references flowmerce.seo_article(id) on delete cascade,
  version integer not null, data jsonb not null, content_hash text not null,
  user_id uuid, note text not null default '', created_at timestamptz not null default now(),
  unique (article_id, version)
);

create table flowmerce.seo_review_note (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  article_id uuid not null references flowmerce.seo_article(id) on delete cascade,
  user_id uuid, kind text not null check (kind in ('comment','approve','request_changes','reject')),
  note text not null default '', version integer, created_at timestamptz not null default now()
);

create table flowmerce.seo_schedule_slot (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  slot_at timestamptz not null, article_id uuid references flowmerce.seo_article(id) on delete set null, note text,
  unique (store_id, slot_at)
);

create table flowmerce.seo_workflow_run (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  stage text not null, status text not null check (status in ('running','ok','failed','cancelled')),
  trigger_kind text not null default 'manual', message text not null default '', error text,
  details jsonb not null default '{}', user_id uuid,
  retry_of uuid references flowmerce.seo_workflow_run(id) on delete set null,
  started_at timestamptz not null default now(), finished_at timestamptz
);

-- ===================================================================== CRO (team work)
create table flowmerce.cro_alarm_rule (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  code text not null, description text not null, metric text not null,
  comparison text not null check (comparison in ('below','above','drop_pct','rise_pct')),
  threshold numeric(14,4) not null, window_days integer not null default 7,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  is_active boolean not null default true, created_by uuid, created_at timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, code)
);

create table flowmerce.cro_alert (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  rule_id uuid references flowmerce.cro_alarm_rule(id) on delete set null,
  title text not null, details jsonb not null default '{}', dedupe_key text not null,
  severity text not null check (severity in ('info','warning','critical')),
  status text not null default 'open' check (status in ('open','acknowledged','snoozed','resolved')),
  opened_at timestamptz not null default now(), resolved_at timestamptz, resolved_by uuid
);
create unique index cro_alert_one_open on flowmerce.cro_alert (store_id, dedupe_key) where status in ('open','acknowledged','snoozed');

create table flowmerce.cro_change_log (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  changed_at timestamptz not null default now(), area text not null, page_path text,
  description text not null, created_by uuid
);

create table flowmerce.cro_recommendation (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  code text not null, title text not null, rationale text, evidence jsonb not null default '[]', page_path text,
  status text not null default 'new' check (status in ('new','accepted','in_progress','done','dismissed')),
  status_by uuid, status_at timestamptz, created_at timestamptz not null default now()
);

create table flowmerce.cro_experiment (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  recommendation_id uuid references flowmerce.cro_recommendation(id) on delete set null,
  page_path text, hypothesis text not null, change_spec jsonb not null default '{}',
  method text not null default 'before_after' check (method in ('before_after','split_url','ab_tool')),
  primary_metric text not null check (primary_metric in ('atc_rate','checkout_rate','conversion_rate','revenue_per_session','bounce_rate')),
  min_sessions integer,
  status text not null default 'proposed' check (status in ('proposed','approved','running','concluded','cancelled')),
  started_at timestamptz, ended_at timestamptz, result jsonb,
  decision text check (decision in ('ship','revert','inconclusive')),
  created_by uuid, created_at timestamptz not null default now()
);

create table flowmerce.cro_goal (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  metric text not null, target_value numeric(14,4) not null, period_start date not null, period_end date,
  note text, created_by uuid, created_at timestamptz not null default now()
);

create table flowmerce.cro_saved_advice (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, store_id uuid not null,
  ai_job_id uuid, question text, advice_md text not null, data_as_of timestamptz,
  saved_by uuid, saved_at timestamptz not null default now()
);

-- ===================================================================== AI usage
create table flowmerce.ai_job (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references flowmerce.workspace(id) on delete cascade,
  store_id uuid,
  job_type text not null, ref_type text, ref_id uuid,
  input jsonb not null default '{}', output jsonb,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled','pending_setup')),
  execution_mode text not null default 'anthropic_api' check (execution_mode in ('anthropic_api','external_worker')),
  model text, prompt_version text, input_tokens integer, output_tokens integer, cost_usd numeric(10,4),
  attempts integer not null default 0, lease_until timestamptz, error text, requested_by uuid,
  created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz
);
create index ai_job_queue on flowmerce.ai_job (status, created_at) where status in ('queued','running');
create index ai_job_day   on flowmerce.ai_job (workspace_id, created_at);

create table flowmerce.ai_job_event (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  job_id uuid not null references flowmerce.ai_job(id) on delete cascade,
  at timestamptz not null default now(), kind text not null, message text, data jsonb not null default '{}'
);

create table flowmerce.ai_image_generation (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references flowmerce.workspace(id) on delete cascade,
  store_id uuid, job_id uuid references flowmerce.ai_job(id) on delete set null,
  provider text not null, model text, prompt text not null, reference_images text[] not null default '{}',
  result_url text, cost_usd numeric(10,4), created_by uuid, created_at timestamptz not null default now()
);

create or replace function flowmerce.ai_budget_left_today(p_workspace uuid) returns numeric
language sql stable as $$
  select w.ai_daily_budget_usd
         - coalesce((select sum(coalesce(cost_usd,0)) from flowmerce.ai_job
                      where workspace_id = p_workspace and created_at >= date_trunc('day', now())), 0)
         - coalesce((select sum(coalesce(cost_usd,0)) from flowmerce.ai_image_generation
                      where workspace_id = p_workspace and created_at >= date_trunc('day', now())), 0)
  from flowmerce.workspace w where w.id = p_workspace;
$$;
