-- =====================================================================================
-- THE CORE ROOM · complete  (R-one Floor Plan, room 03)
-- WHERE: the ERP TEST project. The top bar must say ERP TEST — never the Shopify / production project.
-- HOW:   SQL Editor → New query → paste this WHOLE file → Run.  Safe to run again.
-- CHECK: the last result is a list of checks. Every row must say PASS. Send a screenshot.
-- START OVER (test only):  drop schema core cascade;   then run this file again.
--
-- Inside the core room, 4 zones · 32 tables · 2 views:
--   control  ... people · access_items · roles · role_access · person_access · (view) access_now
--                settings · locations · period_locks · approvals · notifications · change_log
--   masters  ... article_types · article_subtypes · colours · colour_groups · colour_group_members · sizes · fabrics
--                accessories · channels · departments · employment_types · pack_sizes
--   products ... skus · custom_skus · sku_aliases · recipes · print_rules · sku_code_rules · (view) sku_recipe
--   partners ... vendors · vendor_capacity · vendor_blocks
-- Every table: an id, legacy_key (the Firebase key), who / when columns filled by the database, every change logged.
-- Browsers see nothing yet. Brands come from public.stores (RBP, CPC) — made here only if the project does not have it.
-- =====================================================================================

-- ===================================================================== 0 · the room and its helpers
create schema if not exists core;
comment on schema core is 'Shared by every app: people, rights, masters, SKUs, vendors.';
revoke all on schema core from anon, authenticated;
grant usage on schema core to service_role;
alter default privileges in schema core revoke all on tables from anon, authenticated;
alter default privileges in schema core revoke all on functions from anon, authenticated;
alter default privileges in schema core grant all on tables to service_role;
alter default privileges in schema core grant all on sequences to service_role;

-- Brands. On the Shopify project this table already exists (nothing changes). On a new test project it is made here,
-- exactly as Shopify's own step 01 makes it.
create table if not exists public.stores (
  id              text primary key check (id ~ '^[A-Z]{2,5}$'),
  name            text not null,
  shopify_domain  text not null unique,
  currency        text not null default 'USD',
  timezone        text not null default 'America/Los_Angeles',
  active          boolean not null default true
);
alter table public.stores enable row level security;
insert into public.stores (id, name, shopify_domain) values
  ('RBP', 'Ridhi Block Print', 'ridhiblockprint.myshopify.com'),
  ('CPC', 'Cotton Print Club', 'liquidationfashion.myshopify.com')
on conflict (id) do nothing;

-- Load switch: a bulk load runs  select set_config('core.loading', 'on', true);
-- → Firebase dates and "who" are kept as they were, and the change log is not flooded.
create or replace function core.loading() returns boolean
language sql stable as $$ select coalesce(current_setting('core.loading', true), '') = 'on' $$;

-- Who is signed in: the same Google sign-in as the ERP and the Shopify hub.
create or replace function core.me_email() returns text
language sql stable as $$
  select case when auth.jwt()->>'iss' = 'https://securetoken.google.com/price-research-48ff3'
               and auth.jwt()->>'aud' = 'price-research-48ff3'
              then nullif(lower(trim(auth.jwt()->>'email')), '') end
$$;

-- ===================================================================== 1 · CONTROL
create table if not exists core.people (
  id          bigint generated always as identity primary key,
  email       text not null unique check (email = lower(trim(email)) and email like '%_@_%'),
  name        text not null check (length(trim(name)) > 0),
  kind        text not null default 'staff' check (kind in ('staff','vendor','legacy')),  -- legacy = a name in old data, never signs in
  vendor_id   bigint,                                   -- → vendors (link added in zone 4)
  role_id     bigint,                                   -- → roles
  phone       text,
  brands      text[] not null default '{RBP,CPC}' check (brands <@ array['RBP','CPC']::text[]),   -- which brands they work on
  active      boolean not null default true
);
comment on table core.people is 'Everyone who signs in, one row per email. Access = their role + their own extras / removals. Shopify hub people link here by email.';

create or replace function core.me_id() returns bigint
language sql stable security definer set search_path = core, public as $$
  select id from core.people where email = core.me_email() and active limit 1
$$;

create table if not exists core.change_log (
  id        bigint generated always as identity primary key,
  room      text        not null,
  tbl       text        not null,
  row_id    bigint,
  action    text        not null check (action in ('insert','update','delete')),
  old       jsonb,                                     -- update: only the changed fields
  new       jsonb,
  by_id     bigint,
  by_email  text,
  at        timestamptz not null default now(),
  reason    text                                       -- a screen sets: select set_config('core.reason', '…', true);
);
create index if not exists change_log_row on core.change_log (room, tbl, row_id, at desc);
create index if not exists change_log_at  on core.change_log (at desc);
alter table core.change_log enable row level security;
comment on table core.change_log is 'Every change in every room, written by the database itself.';

-- ---------- ACCESS: the boxes → roles → people ----------
-- access_items: every box that can be ticked: a Sellora screen, an ERP screen, or an extra right. Nothing else can be granted.
create table if not exists core.access_items (
  key         text primary key check (key ~ '^(sellora|erp|right):[a-zA-Z0-9]+$'),   -- sellora:sales · erp:fgi · right:soApprove
  app         text not null check (app in ('sellora','erp','right')),
  code        text not null,                               -- the key the apps use today (sales, fgi, soApprove)
  name        text not null,                               -- what people see
  menu_group  text not null,                               -- Sales · Production flow · Can also …
  sort        int  not null default 0,
  active      boolean not null default true,               -- a removed screen is switched off, not deleted
  check (key = app || ':' || code)
);
comment on table core.access_items is 'Every box that can be granted: Sellora screens, ERP screens, extra rights. Roles and people can only use these.';

-- roles: Ravi's role chart (v2, 2 Nov), exactly as the Access page shows it: department → group → role
create table if not exists core.roles (
  id           bigint generated always as identity primary key,
  code         text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),     -- owneradmin, cutting, qc …
  name         text not null,                                             -- "Cutting master"
  department   text not null check (department in ('Corporate','Production','Shipping','Other')),
  team         text not null,                                             -- the page's "group": Management · Shop floor · Store …
  is_admin     boolean not null default false,                            -- every box, and may change access
  limit_note   text,                                                      -- page: "Limit"   e.g. "Own orders only"
  cannot_note  text,                                                      -- page: "Cannot"  e.g. "See pay or rates"
  built_in     boolean not null default false,                            -- from the role chart: cannot be deleted
  sort         int not null default 0,                                    -- order on the page
  active       boolean not null default true
);
create unique index if not exists roles_name_unique on core.roles (lower(name));   -- the page refuses two roles with one name
comment on table core.roles is 'Job roles. A person gets one role and exactly its boxes; changing a role changes it for everyone in it.';

-- role_access: the boxes in each role
create table if not exists core.role_access (
  role_id   bigint not null references core.roles (id) on delete cascade,
  item_key  text   not null references core.access_items (key),
  primary key (role_id, item_key)
);
create index if not exists role_access_item on core.role_access (item_key);

-- person_access: the page's "Special cases" — a person with NO role keeps their own list of boxes
create table if not exists core.person_access (
  person_id  bigint not null references core.people (id) on delete cascade,
  item_key   text   not null references core.access_items (key),
  primary key (person_id, item_key)
);
comment on table core.person_access is 'Own boxes of a Special case (a person with no role). A person in a role gets exactly the role''s boxes.';

create table if not exists core.settings (
  key    text primary key check (key ~ '^[a-z][a-z0-9_.]*$'),          -- company · po_prefix · pack_weights
  value  jsonb not null,
  note   text
);
comment on table core.settings is 'ERP settings, one row each. API keys never go here.';

create table if not exists core.locations (
  id           bigint generated always as identity primary key,
  code         text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]*$'),   -- STORE · CUT · PRESS · FBA-RBP
  name         text not null,
  kind         text not null check (kind in ('store','fg_store','cutting','stitching','press','qc','printer','processor','mill',
                                             'karigar','contractor','fba','transit','customer','scrap','other')),
  brand        text references public.stores (id),
  vendor_id    bigint,                                  -- → vendors (zone 4)
  employee_id  bigint,                                  -- → erp.employees (added with the erp room)
  active       boolean not null default true
);

create table if not exists core.period_locks (
  area   text not null check (area in ('cutting','press','extra_hours','payout','job_work','qc','stock')),
  month  date not null check (month = date_trunc('month', month)::date),   -- always the 1st
  note   text,
  primary key (area, month)
);
create or replace function core.is_locked(p_area text, p_day date) returns boolean
language sql stable as $$
  select exists (select 1 from core.period_locks where area = p_area and month = date_trunc('month', p_day)::date)
$$;

create table if not exists core.approvals (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('jw_correction','fgi_correction','fgi_over_order','order_delete','so_qty_change',
                                             'vendor_order_request','rate','rfd_over_need','stock_adjust','other')),
  ref_room     text,
  ref_table    text,
  ref_id       bigint,
  snapshot     jsonb,                                  -- the record when asked
  change       jsonb,                                  -- what is asked to change
  reason       text,
  status       text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  asked_by     bigint references core.people (id),
  asked_at     timestamptz not null default now(),
  answered_by  bigint references core.people (id),
  answered_at  timestamptz,
  answer_note  text,
  check (answered_by is null or asked_by is null or answered_by <> asked_by),          -- nobody approves their own request
  check (status = 'withdrawn' or (status in ('approved','rejected')) = (answered_at is not null))
);
create index if not exists approvals_open on core.approvals (kind, asked_at) where status = 'pending';
create index if not exists approvals_ref  on core.approvals (ref_room, ref_table, ref_id);

create table if not exists core.notifications (
  id         bigint generated always as identity primary key,
  ref_room   text not null,
  ref_table  text not null,
  ref_id     bigint,
  channel    text not null check (channel in ('whatsapp','email','app')),
  kind       text not null,                            -- issue · receive …
  sent_at    timestamptz not null,
  sent_by    bigint references core.people (id),
  note       text
);
create index if not exists notifications_ref on core.notifications (ref_room, ref_table, ref_id);

-- ===================================================================== 2 · MASTERS
create table if not exists core.article_types (
  id      bigint generated always as identity primary key,
  code    text not null unique,
  name    text not null,
  active  boolean not null default true
);
create table if not exists core.article_subtypes (
  id               bigint generated always as identity primary key,
  code             text not null unique,
  name             text not null,
  article_type_id  bigint references core.article_types (id),
  active           boolean not null default true
);
create table if not exists core.colours (
  id        bigint generated always as identity primary key,
  code      text not null unique,
  name      text not null,
  no_print  boolean not null default false,
  active    boolean not null default true
);
create table if not exists core.colour_groups (
  id     bigint generated always as identity primary key,
  brand  text not null references public.stores (id),
  code   text not null,
  name   text not null,
  unique (brand, code)
);
create table if not exists core.colour_group_members (            -- which group a colour is in, per brand
  brand            text   not null references public.stores (id),
  colour_id        bigint not null references core.colours (id),
  colour_group_id  bigint not null references core.colour_groups (id) on delete cascade,
  primary key (brand, colour_id)
);
create table if not exists core.sizes (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  name       text not null,                                       -- 60 Round · 13x19 Rectangle
  shape      text check (shape in ('round','square','rectangle','oval','runner','other')),
  width_cm   numeric(7,2) check (width_cm > 0),
  length_cm  numeric(7,2) check (length_cm > 0),
  active     boolean not null default true
);
create table if not exists core.fabrics (
  id                bigint generated always as identity primary key,
  code              text not null unique,
  name              text not null,
  kind              text not null check (kind in ('greige','rfd','printed','filler','lining','other')),
  width_in          numeric(6,2) check (width_in > 0),
  gsm               numeric(7,1) check (gsm > 0),
  rfd_of_greige_id  bigint references core.fabrics (id),         -- RFD row → the greige it is made from
  base_fabric_id    bigint references core.fabrics (id),         -- printed fabric → the cloth it is printed on
  sku_id            bigint,                                      -- printed fabric made for a SKU (→ skus, below)
  colour_id         bigint references core.colours (id),
  brand             text references public.stores (id),
  print_direction   text,
  print_side        text,
  construction      text,
  yarn_count        text,
  hsn               text,
  epi               numeric(6,1),
  ppi               numeric(6,1),
  warp              text,
  weft              text,
  image_url         text,
  note              text,
  sort_order        int,
  active            boolean not null default true,
  check (rfd_of_greige_id is null or kind = 'rfd'),
  check (base_fabric_id   is null or kind = 'printed')
);
create table if not exists core.accessories (
  id             bigint generated always as identity primary key,
  code           text not null unique,
  name           text not null,
  unit           text not null,                                  -- pcs · m · kg …
  category       text,
  reorder_level  numeric(10,2) check (reorder_level >= 0),
  returnable     boolean not null default false,
  is_auto        boolean not null default false,
  active         boolean not null default true
);
create table if not exists core.channels (
  id      bigint generated always as identity primary key,
  code    text not null unique,                                  -- AMZ · SHP · B2B · ETSY
  name    text not null,
  active  boolean not null default true
);
create table if not exists core.departments (
  id      bigint generated always as identity primary key,
  code    text not null unique,
  name    text not null,
  active  boolean not null default true
);
create table if not exists core.employment_types (
  id      bigint generated always as identity primary key,
  code    text not null unique,                                  -- karigar · staff · contractor
  name    text not null,
  active  boolean not null default true
);
create table if not exists core.pack_sizes (
  id      bigint generated always as identity primary key,
  code    text not null unique,
  name    text not null,
  qty     int  not null check (qty > 0),
  active  boolean not null default true
);

-- ===================================================================== 3 · PRODUCTS
create table if not exists core.skus (
  id                      bigint generated always as identity primary key,
  code                    text not null check (code = trim(code) and code <> ''),
  brand                   text references public.stores (id),
  article_type_id         bigint references core.article_types (id),
  subtype_id              bigint references core.article_subtypes (id),
  colour_id               bigint references core.colours (id),
  size_id                 bigint references core.sizes (id),
  pack_of                 int not null default 1 check (pack_of > 0),
  fabric_id               bigint references core.fabrics (id),
  ruffle_fabric_id        bigint references core.fabrics (id),
  piping_fabric_id        bigint references core.fabrics (id),
  filler_fabric_required  boolean not null default false,
  cutting_required        boolean not null default true,
  is_ruffle               boolean not null default false,
  is_piping               boolean not null default false,
  is_zip                  boolean not null default false,
  fabric_metres           numeric(8,2) check (fabric_metres >= 0),   -- per-SKU override of the recipe
  ruffle_metres           numeric(8,2) check (ruffle_metres >= 0),
  piping_metres           numeric(8,2) check (piping_metres >= 0),
  chain_length            int check (chain_length >= 0),
  zip_qty                 int check (zip_qty >= 0),
  asin                    text,
  parent_asin             text,
  fnsku                   text,
  listing_status          text,
  manufacturer_vendor_id  bigint,                                    -- → vendors (zone 4)
  pack_material_id        bigint references core.accessories (id),
  pack_type               text,
  custom_order_ref        text,
  image_url               text,
  priority                text,
  source                  text,                                      -- manual · import · custom …
  active                  boolean not null default true,
  deleted_at              timestamptz,
  deleted_by              bigint references core.people (id),
  deleted_reason          text
);
create unique index if not exists skus_code_unique on core.skus (lower(code));        -- RBP-TC-01 and rbp-tc-01 are the same SKU
create index if not exists skus_asin on core.skus (asin) where asin is not null;
create index if not exists skus_parts on core.skus (article_type_id, subtype_id, size_id);

create table if not exists core.custom_skus (
  id                    bigint generated always as identity primary key,
  code                  text not null check (code = trim(code) and code <> ''),
  brand                 text references public.stores (id),
  article_type_id       bigint references core.article_types (id),
  subtype_id            bigint references core.article_subtypes (id),
  colour_id             bigint references core.colours (id),
  size_id               bigint references core.sizes (id),
  pack_of               int check (pack_of > 0),
  fabric_id             bigint references core.fabrics (id),
  fabric_metres         numeric(8,2) check (fabric_metres >= 0),
  chain_length          int check (chain_length >= 0),
  cutting_required      boolean not null default true,
  filler_fabric_required boolean not null default false,
  is_ruffle             boolean not null default false,
  is_zip                boolean not null default false,
  from_b2b              boolean not null default false,
  from_online           boolean not null default false,
  from_shopify          boolean not null default false,
  from_vendor_order     boolean not null default false,
  shop_name             text,
  b2b_order             text,
  custom_order_ref      text,
  customization         text,
  label                 text,
  material              text,
  lookalike_of_sku_id   bigint references core.skus (id),
  merged_into_sku_id    bigint references core.skus (id),          -- set when it is merged into the normal SKU list
  image_url             text,
  note                  text,
  active                boolean not null default true,
  deleted_at            timestamptz,
  deleted_by            bigint references core.people (id),
  deleted_reason        text
);
create unique index if not exists custom_skus_code_unique on core.custom_skus (lower(code));

create table if not exists core.sku_aliases (                    -- old names and merges, so old records still find their SKU
  id             bigint generated always as identity primary key,
  sku_id         bigint references core.skus (id),
  custom_sku_id  bigint references core.custom_skus (id),
  old_code       text not null,
  kind           text not null check (kind in ('renamed','merged','amazon','shopify','typo')),
  check ((sku_id is null) <> (custom_sku_id is null))              -- points to exactly one
);
create unique index if not exists sku_aliases_code on core.sku_aliases (lower(old_code));

create table if not exists core.recipes (                        -- what one piece needs
  id                bigint generated always as identity primary key,
  article_type_id   bigint not null references core.article_types (id),
  subtype_id        bigint references core.article_subtypes (id),   -- empty = any subtype
  size_id           bigint references core.sizes (id),              -- empty = any size
  pack_of           int check (pack_of > 0),                        -- empty = any pack
  fabric_id         bigint references core.fabrics (id),
  ruffle_fabric_id  bigint references core.fabrics (id),
  fabric_metres     numeric(8,2) check (fabric_metres >= 0),
  ruffle_metres     numeric(8,2) check (ruffle_metres >= 0),
  piping_metres     numeric(8,2) check (piping_metres >= 0),
  filler_qty        numeric(8,2) check (filler_qty >= 0),
  zips              int check (zips >= 0),
  chain_length      int check (chain_length >= 0),
  cutting_required  boolean,
  is_piping         boolean,
  is_ruffle         boolean,
  is_zip            boolean,
  unique nulls not distinct (article_type_id, subtype_id, size_id, pack_of)
);

create table if not exists core.print_rules (
  id               bigint generated always as identity primary key,
  article_type_id  bigint references core.article_types (id),
  subtype_id       bigint references core.article_subtypes (id),
  fabric_id        bigint references core.fabrics (id),
  print            text,
  print_direction  text,
  issue_as         text,
  panels           int check (panels > 0),
  note             text
);

create table if not exists core.sku_code_rules (
  id               bigint generated always as identity primary key,
  article_type_id  bigint references core.article_types (id),
  subtype_id       bigint references core.article_subtypes (id),
  size_id          bigint references core.sizes (id),
  base_code        text not null,
  source           text,
  unique nulls not distinct (article_type_id, subtype_id, size_id)
);

-- The recipe that applies to each SKU: the most specific match wins (subtype, then size, then pack).
create or replace view core.sku_recipe as
select s.id as sku_id, s.code, r.id as recipe_id,
       coalesce(s.fabric_metres, r.fabric_metres) as fabric_metres,
       coalesce(s.ruffle_metres, r.ruffle_metres) as ruffle_metres,
       coalesce(s.piping_metres, r.piping_metres) as piping_metres,
       coalesce(s.zip_qty, r.zips)                as zips,
       coalesce(s.chain_length, r.chain_length)   as chain_length,
       r.filler_qty,
       (s.fabric_metres is not null)              as fabric_from_sku
from core.skus s
left join lateral (
  select r.* from core.recipes r
   where r.article_type_id = s.article_type_id
     and (r.subtype_id is null or r.subtype_id = s.subtype_id)
     and (r.size_id    is null or r.size_id    = s.size_id)
     and (r.pack_of    is null or r.pack_of    = s.pack_of)
   order by (r.subtype_id is not null) desc, (r.size_id is not null) desc, (r.pack_of is not null) desc
   limit 1
) r on true;

-- ===================================================================== 4 · PARTNERS
create table if not exists core.vendors (
  id                bigint generated always as identity primary key,
  code              text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]*$'),   -- VND001
  name              text not null,
  roles             text[] not null default '{}' check (roles <@ array['mill','processor','printer','embroiderer','stitcher',
                                                                'contractor','supplier','courier','other']::text[]),
  services          text,
  contact_person    text,
  phone             text,
  email             text check (email is null or email = lower(trim(email))),
  gstin             text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  gst_registration  text,
  pan               text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  tds_pct           numeric(5,2) check (tds_pct between 0 and 100),
  address           text,
  city              text,
  state             text,
  state_code        text,
  pincode           text check (pincode is null or pincode ~ '^[0-9]{6}$'),
  note              text,
  sort_order        int,
  active            boolean not null default true
);
create unique index if not exists vendors_gstin on core.vendors (gstin) where gstin is not null;

create table if not exists core.vendor_capacity (
  vendor_id    bigint primary key references core.vendors (id) on delete cascade,
  tables       int check (tables >= 0),
  pcs_month    int check (pcs_month >= 0),
  blocks_need  int check (blocks_need >= 0),
  blocks_have  int check (blocks_have >= 0),
  active       boolean not null default true
);
create table if not exists core.vendor_blocks (
  id         bigint generated always as identity primary key,
  vendor_id  bigint not null references core.vendors (id) on delete cascade,
  block      text not null,                                     -- block / design key
  need       int check (need >= 0),
  have       int check (have >= 0),
  status     text,
  unique (vendor_id, block)
);

-- links that need vendors / skus to exist first
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'people_role_fk')       then alter table core.people    add constraint people_role_fk       foreign key (role_id) references core.roles (id); end if;
  if not exists (select 1 from pg_constraint where conname = 'people_vendor_fk')     then alter table core.people    add constraint people_vendor_fk     foreign key (vendor_id) references core.vendors (id); end if;
  if not exists (select 1 from pg_constraint where conname = 'locations_vendor_fk')  then alter table core.locations add constraint locations_vendor_fk  foreign key (vendor_id) references core.vendors (id); end if;
  if not exists (select 1 from pg_constraint where conname = 'skus_manufacturer_fk') then alter table core.skus      add constraint skus_manufacturer_fk foreign key (manufacturer_vendor_id) references core.vendors (id); end if;
  if not exists (select 1 from pg_constraint where conname = 'fabrics_sku_fk')       then alter table core.fabrics   add constraint fabrics_sku_fk       foreign key (sku_id) references core.skus (id); end if;
end $$;

-- ===================================================================== 5 · the same columns on every table
-- legacy_key (Firebase key, unique) + who / when. Added in one loop so no table is forgotten.
do $$ declare t text; begin
  foreach t in array array['people','access_items','roles','role_access','person_access','settings','locations','period_locks','approvals','notifications',
    'article_types','article_subtypes','colours','colour_groups','colour_group_members','sizes','fabrics','accessories','channels',
    'departments','employment_types','pack_sizes','skus','custom_skus','sku_aliases','recipes','print_rules','sku_code_rules',
    'vendors','vendor_capacity','vendor_blocks'] loop
    execute format('alter table core.%I add column if not exists legacy_key text', t);
    execute format('create unique index if not exists %I on core.%I (legacy_key) where legacy_key is not null', t || '_legacy', t);
    execute format('alter table core.%I add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table core.%I add column if not exists created_by bigint references core.people (id)', t);
    execute format('alter table core.%I add column if not exists updated_at timestamptz', t);
    execute format('alter table core.%I add column if not exists updated_by bigint references core.people (id)', t);
  end loop;
end $$;

-- ===================================================================== 6 · stamp + log on every table
create or replace function core.stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    if new.created_by is null and not core.loading() then new.created_by := core.me_id(); end if;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if not core.loading() then
      new.updated_at := now();
      new.updated_by := core.me_id();
    end if;
  end if;
  return new;
end $$;

create or replace function core.log_change() returns trigger
language plpgsql security definer set search_path = core, public as $$
declare o jsonb; n jsonb; d_old jsonb := '{}'; d_new jsonb := '{}'; k text; rid bigint;
begin
  if core.loading() then return coalesce(new, old); end if;
  o := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  rid := case when coalesce(n, o)->>'id' ~ '^\d+$' then (coalesce(n, o)->>'id')::bigint end;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at','updated_by') and (o->k) is distinct from (n->k) then
        d_old := d_old || jsonb_build_object(k, o->k);
        d_new := d_new || jsonb_build_object(k, n->k);
      end if;
    end loop;
    if d_new = '{}' then return new; end if;
    o := d_old; n := d_new;
  end if;
  insert into core.change_log (room, tbl, row_id, action, old, new, by_id, by_email, reason)
  values (tg_table_schema, tg_table_name, rid, lower(tg_op), o, n, core.me_id(), core.me_email(), current_setting('core.reason', true));
  return coalesce(new, old);
end $$;

-- watch(table): read rules on + stamp + log. Every room uses it for its tables.
create or replace function core.watch(t regclass) returns void
language plpgsql as $$
begin
  execute format('alter table %s enable row level security', t);
  execute format('drop trigger if exists zz_stamp on %s', t);
  execute format('create trigger zz_stamp before insert or update on %s for each row execute function core.stamp()', t);
  execute format('drop trigger if exists zz_log on %s', t);
  execute format('create trigger zz_log after insert or update or delete on %s for each row execute function core.log_change()', t);
end $$;

select core.watch(('core.' || t)::regclass) from unnest(array['people','access_items','roles','role_access','person_access','settings','locations','period_locks',
  'approvals','notifications','article_types','article_subtypes','colours','colour_groups','colour_group_members','sizes','fabrics',
  'accessories','channels','departments','employment_types','pack_sizes','skus','custom_skus','sku_aliases','recipes','print_rules',
  'sku_code_rules','vendors','vendor_capacity','vendor_blocks']) t;

-- ---------- what each person can do, worked out (nothing typed here) ----------
-- admin role → every active box · in a role → exactly the role's boxes · no role (Special case) → their own boxes.
drop view if exists core.access_now;
create view core.access_now as
with p as (
  select pe.id as person_id, pe.email, pe.name, r.code as role_code, coalesce(r.is_admin, false) as is_admin,
         pe.brands, pe.role_id
    from core.people pe left join core.roles r on r.id = pe.role_id and r.active
   where pe.active
)
select p.person_id, p.email, p.name, coalesce(p.role_code, 'special') as role_code, p.brands,
       i.key as item_key, i.app, i.code, i.name as item_name,
       case when p.is_admin then 'admin' when p.role_id is not null then 'role' else 'own' end as via
  from p
  join core.access_items i on i.active
 where p.is_admin
    or (p.role_id is not null and exists (select 1 from core.role_access ra where ra.role_id = p.role_id and ra.item_key = i.key))
    or (p.role_id is null     and exists (select 1 from core.person_access pa where pa.person_id = p.person_id and pa.item_key = i.key));
comment on view core.access_now is 'What each person can open / do right now: admin = everything, role = its boxes, Special case = own boxes.';

-- may I?  core.can('erp:fgi')  ·  core.can('right:soApprove', 'RBP')
create or replace function core.can(p_item text, p_brand text default null) returns boolean
language sql stable security definer set search_path = core, public as $$
  select exists (select 1 from core.access_now a
                  where a.person_id = core.me_id() and a.item_key = p_item
                    and (p_brand is null or p_brand = any (a.brands)))
$$;
revoke all on function core.watch(regclass), core.log_change(), core.stamp() from public, anon, authenticated;
revoke all on function core.me_id(), core.can(text, text) from public;
grant execute on function core.me_id(), core.me_email(), core.can(text, text), core.is_locked(text, date), core.loading()
  to authenticated, service_role;

-- ---------- the boxes (from Sellora's Access page, 2 Nov 2026; old screens left out) ----------
-- Dropped on purpose (Ravi, 7 Nov): old screens ptapp, follow, india, prod · unused flags bdCut, bdFill, bdIssue, bdPress, bdQc, bdRecv
-- · Firebase-only flags repl (whole-ERP switch) and prod (old production app) · hidden Sellora tabs link, kw, ba · the RTDB mirror pt_perms.
select set_config('core.loading', 'on', false);      -- the list itself is design, not a change by a person: not logged
insert into core.access_items (key, app, code, name, menu_group, sort) values
 ('sellora:new','sellora','new','New Product','Research',101), ('sellora:pr','sellora','pr','Product Research','Research',102),
 ('sellora:sales','sellora','sales','Sales Dashboard','Sales',111), ('sellora:profit','sellora','profit','Profit & Margin','Sales',112),
 ('sellora:sa','sellora','sa','Sales Analysis','Sales',113), ('sellora:plaudit','sellora','plaudit','Parent Listing Review','Sales',114),
 ('sellora:shop','sellora','shop','Shopify Orders','Sales',115), ('sellora:adj','sellora','adj','Adjustments','Sales',116),
 ('sellora:opt','sellora','opt','Listing Optimiser','Listing',121), ('sellora:img','sellora','img','Image Manager','Listing',122),
 ('sellora:lerr','sellora','lerr','Listing Errors','Listing',123), ('sellora:basket','sellora','basket','Bought Together','Listing',124),
 ('sellora:health','sellora','health','Listing Health','Listing',125), ('sellora:lrules','sellora','lrules','Listing Rules','Listing',126),
 ('sellora:audit','sellora','audit','Listing Audit','Listing',127), ('sellora:bsr','sellora','bsr','BSR Audit','Listing',128),
 ('sellora:trends','sellora','trends','Ad Console','Advertising',131), ('sellora:weekly','sellora','weekly','PPC & Organic','Advertising',132),
 ('sellora:st','sellora','st','Search Terms','Advertising',133), ('sellora:plc','sellora','plc','Placement','Advertising',134),
 ('sellora:deals','sellora','deals','Deal Calendar','Advertising',135), ('sellora:age','sellora','age','Inventory Age','Inventory & social',141),
 ('sellora:tiktok','sellora','tiktok','TikTok Toolkit','Inventory & social',142), ('sellora:carousel','sellora','carousel','Carousel Builder','Inventory & social',143),
 ('erp:shop','erp','shop','Shopify Orders','Shopify',201), ('erp:adj','erp','adj','Adjustments','Shopify',202),
 ('erp:shopify','erp','shopify','Shopify Stock','Shopify',203), ('erp:shopprod','erp','shopprod','Order Console — Shopify only','Shopify',204),
 ('erp:shopret','erp','shopret','Shopify returns team','Shopify',205),
 ('erp:repl','erp','repl','Replenishment','Replenishment & planning',211), ('erp:article','erp','article','Article Review','Replenishment & planning',212),
 ('erp:target','erp','target','Revenue Target','Replenishment & planning',213), ('erp:top','erp','top','Top ASIN Status','Replenishment & planning',214),
 ('erp:pack','erp','pack','Packing List','Replenishment & planning',215),
 ('erp:so','erp','so','Sales Orders','Orders',221), ('erp:ord','erp','ord','Order Console — every order','Orders',222),
 ('erp:shpacc','erp','shpacc','Order Console — Shipping to accept','Orders',223), ('erp:cx','erp','cx','Customer orders','Orders',224),
 ('erp:flppc','erp','flppc','PPC and PPC completed','Production flow',231), ('erp:fldem','erp','fldem','Demand: RFD fabric out','Production flow',232),
 ('erp:flacc','erp','flacc','Demand: accessories','Production flow',233), ('erp:flchl','erp','flchl','Printed fabric in · history','Production flow',234),
 ('erp:flcut','erp','flcut','To cut','Production flow',235), ('erp:flraw','erp','flraw','Raw cutting in store','Production flow',236),
 ('erp:flwip','erp','flwip','WIP with karigars','Production flow',237),
 ('erp:pcut','erp','pcut','Cutting Data','Making',241), ('erp:pbase','erp','pbase','Job Work Register','Making',242),
 ('erp:ppress','erp','ppress','Press Inventory','Making',243), ('erp:qc','erp','qc','Quality Control — checks','Making',244),
 ('erp:qcalt','erp','qcalt','QC — issue for alteration','Making',245), ('erp:qcret','erp','qcret','QC — receive back','Making',246),
 ('erp:fgi','erp','fgi','Finished Goods','Finished & dispatch',251), ('erp:fgacc','erp','fgacc','Finished Goods — From QC, to accept','Finished & dispatch',252),
 ('erp:fba','erp','fba','FBA Dispatch','Finished & dispatch',253),
 ('erp:fab','erp','fab','Fabric Inventory','Materials',261), ('erp:acc','erp','acc','Accessories','Materials',262),
 ('erp:gdesk','erp','gdesk','Greige Desk — open','Materials',263), ('erp:gdled','erp','gdled','Greige Desk — fabric ledger','Materials',264),
 ('erp:gdledit','erp','gdledit','Greige Desk — correct ledger','Materials',265), ('erp:gdappr','erp','gdappr','Greige Desk — approve shrinkage >5%','Materials',266),
 ('erp:pmdb','erp','pmdb','Master Database','Setup',271), ('erp:mst','erp','mst','Masters','Setup',272),
 ('erp:vreq','erp','vreq','Vendor Order Requests','Vendors & printers',281), ('erp:vord','erp','vord','Vendor Orders','Vendors & printers',282),
 ('erp:rfd','erp','rfd','RFD Requirements','Vendors & printers',283), ('erp:vend','erp','vend','Vendor Portal','Vendors & printers',284),
 ('erp:vlog','erp','vlog','History','Vendors & printers',285), ('erp:palloc','erp','palloc','Printer Allocation','Vendors & printers',286),
 ('erp:vpview','erp','vpview','Printer''s portal (view only)','Vendors & printers',287),
 ('erp:att','erp','att','Attendance','People & pay',291), ('erp:hr','erp','hr','Finance & HR','People & pay',292),
 ('erp:rep','erp','rep','Reports','Reports',295), ('erp:pa','erp','pa','Production Analysis','Reports',296), ('erp:ka','erp','ka','Karigar Analysis','Reports',297),
 ('right:approve','right','approve','Sellora approvals','Can also',301), ('right:replProj','right','replProj','Change monthly projections','Can also',302),
 ('right:soApprove','right','soApprove','Approve sales orders','Can also',303), ('right:vreqApprove','right','vreqApprove','Approve vendor order requests','Can also',304),
 ('right:rateApprove','right','rateApprove','Approve vendor rates','Can also',305), ('right:rfdApprove','right','rfdApprove','Approve extra RFD cloth','Can also',306),
 ('right:rfdSend','right','rfdSend','Mark RFD fabric sent','Can also',307), ('right:vlogAccept','right','vlogAccept','Accept printer deliveries','Can also',308),
 ('right:shopAssign','right','shopAssign','Give Shopify lines to printers','Can also',309), ('right:b2bAssign','right','b2bAssign','Give B2B lines to printers','Can also',310),
 ('right:prodEdit','right','prodEdit','Correct production entries','Can also',311), ('right:attendMark','right','attendMark','Mark attendance','Can also',312),
 ('right:empEdit','right','empEdit','Add, change, remove employees','Can also',313), ('right:fgiEntry','right','fgiEntry','Add finished-goods entries','Can also',314),
 ('right:fgiEdit','right','fgiEdit','Edit and delete finished goods','Can also',315), ('right:accEntry','right','accEntry','Add accessory movements','Can also',316),
 ('right:accEdit','right','accEdit','Edit the accessories record','Can also',317), ('right:mdbEdit','right','mdbEdit','Change the Master Database','Can also',318),
 ('right:accessView','right','accessView','See the Access page (view only)','Can also',319)
on conflict (key) do update set name = excluded.name, menu_group = excluded.menu_group, sort = excluded.sort;
select set_config('core.loading', 'off', false);

-- ===================================================================== 7 · live tests (everything they write is undone)
create temp table if not exists _t (n int, check_name text, result text);
truncate _t;
do $$
declare a bigint; b bigint; t1 bigint; t2 bigint; s1 bigint; got int; r text;
begin
  -- A. nobody approves their own request
  r := 'FAIL: it was accepted';
  begin
    insert into core.people (email, name) values ('test.a@ridhi.test', 'Test A') returning id into a;
    insert into core.approvals (kind, status, asked_by, answered_by, answered_at) values ('other', 'approved', a, a, now());
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (20, 'nobody can approve their own request', r);

  -- B. another person may approve, and the database logs it
  r := 'FAIL';
  begin
    insert into core.people (email, name) values ('test.a@ridhi.test', 'Test A') returning id into a;
    insert into core.people (email, name) values ('test.b@ridhi.test', 'Test B') returning id into b;
    insert into core.approvals (kind, asked_by) values ('other', a);
    update core.approvals set status = 'approved', answered_by = b, answered_at = now() where asked_by = a;
    select count(*) into got from core.change_log where tbl = 'approvals' and at >= now() - interval '1 minute';
    r := case when got >= 2 then 'PASS' else 'FAIL: change log has ' || got || ' rows' end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (21, 'another person can approve, and the database logs it', r);

  -- C. the same SKU twice (even in other letters) is refused
  r := 'FAIL: it was accepted';
  begin
    insert into core.skus (code, brand) values ('TEST-SKU-01', 'RBP');
    insert into core.skus (code, brand) values ('test-sku-01', 'RBP');
    raise exception 'undo';
  exception when unique_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (22, 'the same SKU code twice is refused', r);

  -- D. a SKU cannot point to a colour that does not exist
  r := 'FAIL: it was accepted';
  begin
    insert into core.skus (code, brand, colour_id) values ('TEST-SKU-02', 'RBP', -1);
    raise exception 'undo';
  exception when foreign_key_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (23, 'a SKU with an unknown colour is refused', r);

  -- E. a brand that is not RBP / CPC is refused
  r := 'FAIL: it was accepted';
  begin
    insert into core.skus (code, brand) values ('TEST-SKU-03', 'XYZ');
    raise exception 'undo';
  exception when foreign_key_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (24, 'an unknown brand is refused', r);

  -- F. each SKU gets the most specific recipe, and its own metres win
  r := 'FAIL';
  begin
    insert into core.article_types (code, name) values ('TEST-TC', 'Test tablecloth') returning id into t1;
    insert into core.sizes (code, name) values ('TEST-60R', 'Test 60 Round') returning id into s1;
    insert into core.recipes (article_type_id, fabric_metres) values (t1, 2.00);              -- any size
    insert into core.recipes (article_type_id, size_id, fabric_metres) values (t1, s1, 3.50); -- 60 Round
    insert into core.skus (code, brand, article_type_id, size_id) values ('TEST-SKU-04', 'RBP', t1, s1);
    insert into core.skus (code, brand, article_type_id, fabric_metres) values ('TEST-SKU-05', 'RBP', t1, 1.25);
    select count(*) into got from core.sku_recipe
     where (code = 'TEST-SKU-04' and fabric_metres = 3.50) or (code = 'TEST-SKU-05' and fabric_metres = 1.25 and fabric_from_sku);
    r := case when got = 2 then 'PASS' else 'FAIL: ' || got || ' of 2 right' end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (25, 'each SKU gets the right recipe (most specific wins, own metres win)', r);

  -- G. vendor checks: wrong GSTIN and an unknown role are refused
  r := 'FAIL: it was accepted';
  begin
    insert into core.vendors (code, name, gstin) values ('TEST-V1', 'Test vendor', '12345');
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (26, 'a wrong GSTIN is refused', r);
  r := 'FAIL: it was accepted';
  begin
    insert into core.vendors (code, name, roles) values ('TEST-V2', 'Test vendor', array['wizard']);
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (27, 'an unknown vendor role is refused', r);

  -- H. emails are kept in small letters; month locks are the 1st
  r := 'FAIL: it was accepted';
  begin
    insert into core.people (email, name) values ('Test.C@Ridhi.test', 'Test C');
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (28, 'capital letters in an email are refused', r);
  r := 'FAIL: it was accepted';
  begin
    insert into core.period_locks (area, month) values ('cutting', '2026-10-15');
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (29, 'a month lock must be the 1st of the month', r);

  -- I. a person in a role gets exactly the role's boxes; a Special case gets exactly their own boxes
  r := 'FAIL';
  begin
    insert into core.roles (code, name, department, team) values ('test_qc', 'Test QC', 'Production', 'Shop floor') returning id into t1;
    insert into core.role_access (role_id, item_key) values (t1, 'erp:qc'), (t1, 'erp:qcalt'), (t1, 'right:prodEdit');
    insert into core.people (email, name, role_id) values ('test.r@ridhi.test', 'Test R', t1) returning id into a;
    insert into core.people (email, name) values ('test.s@ridhi.test', 'Test S') returning id into b;           -- no role = Special case
    insert into core.person_access (person_id, item_key) values (b, 'erp:fgi'), (b, 'sellora:sales');
    select count(*) into got from core.access_now where person_id = a;
    if got = 3 and (select count(*) from core.access_now where person_id = b and via = 'own') = 2 then r := 'PASS';
    else r := 'FAIL: role person has ' || got || ' of 3, special person has ' || (select count(*) from core.access_now where person_id = b) || ' of 2'; end if;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (30, 'role = exactly its boxes · Special case = exactly own boxes', r);

  -- J. a box that is not on the list cannot be given (stops typos like "bdFill")
  r := 'FAIL: it was accepted';
  begin
    insert into core.roles (code, name, department, team) values ('test_x', 'Test X', 'Other', 'Test') returning id into t1;
    insert into core.role_access (role_id, item_key) values (t1, 'right:bdFill');
    raise exception 'undo';
  exception when foreign_key_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (31, 'a box that is not on the list is refused', r);

  -- K. an admin role gets every box
  r := 'FAIL';
  begin
    insert into core.roles (code, name, department, team, is_admin) values ('test_admin', 'Test admin', 'Corporate', 'Management', true) returning id into t1;
    insert into core.people (email, name, role_id) values ('test.adm@ridhi.test', 'Test Admin', t1) returning id into a;
    select count(*) into got from core.access_now where person_id = a;
    r := case when got = (select count(*) from core.access_items where active) then 'PASS' else 'FAIL: ' || got || ' boxes' end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (32, 'an admin role gets every box', r);
end $$;

-- ===================================================================== 8 · checks: every row must say PASS
with core_tables as (
  select c.oid, c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'core' and c.relkind = 'r'
)
select n, check_name, result from (
  select 1 as n, 'the core room has 32 tables' as check_name,
         case when (select count(*) from core_tables) = 32 then 'PASS' else 'FAIL: ' || (select count(*) from core_tables) || ' tables' end as result
  union all select 2, 'browsers cannot enter the core room',
         case when not has_schema_privilege('anon', 'core', 'usage') and not has_schema_privilege('authenticated', 'core', 'usage') then 'PASS' else 'FAIL' end
  union all select 3, 'read rules on for every table',
         case when (select bool_and(relrowsecurity) from pg_class where oid in (select oid from core_tables)) then 'PASS' else 'FAIL' end
  union all select 4, 'every table (except the log) stamps who / when and logs changes',
         case when (select count(distinct tgrelid) from pg_trigger where tgname in ('zz_stamp') and tgrelid in (select oid from core_tables)) = 31
               and (select count(distinct tgrelid) from pg_trigger where tgname in ('zz_log') and tgrelid in (select oid from core_tables)) = 31 then 'PASS' else 'FAIL' end
  union all select 5, 'every table has legacy_key + who / when columns',
         case when (select count(*) from information_schema.columns where table_schema = 'core' and table_name in (select relname from core_tables) and column_name = 'legacy_key') = 31
               and (select count(*) from information_schema.columns where table_schema = 'core' and table_name in (select relname from core_tables) and column_name = 'updated_by') = 31 then 'PASS' else 'FAIL' end
  union all select 6, 'the views exist (recipe per SKU, access per person)', case when to_regclass('core.sku_recipe') is not null and to_regclass('core.access_now') is not null then 'PASS' else 'FAIL' end
  union all select 9, 'the box list: 24 Sellora screens, 50 ERP screens, 19 rights',
         case when (select count(*) filter (where app = 'sellora') from core.access_items) = 24 and (select count(*) filter (where app = 'erp') from core.access_items) = 50
               and (select count(*) filter (where app = 'right') from core.access_items) = 19 then 'PASS'
              else 'FAIL: ' || (select string_agg(app || ' ' || n, ', ') from (select app, count(*) n from core.access_items group by app) x) end
  union all select 10, 'the old screens and bd* flags are not on the list',
         case when not exists (select 1 from core.access_items where code in ('ptapp','follow','india','prod') or code like 'bd%') then 'PASS' else 'FAIL' end
  union all select 7, 'brands RBP and CPC are there', case when (select count(*) from public.stores where id in ('RBP','CPC')) = 2 then 'PASS' else 'FAIL' end
  union all select 8, 'no test rows left behind',
         case when not exists (select 1 from core.people where email like '%@ridhi.test')
               and not exists (select 1 from core.skus where code ilike 'TEST-SKU%')
               and not exists (select 1 from core.vendors where code like 'TEST-%') then 'PASS' else 'FAIL' end
  union all select n, check_name, result from _t
) x order by n;
