-- =====================================================================================
-- CORE ROOM · SECTION 1 · ACCESS  (who may open / do what)
-- GENERATED from core_access.template.sql by migration/tools/make-access-sql.js — edit the template, not this file.
-- WHERE: the ERP TEST project (top bar must say ERP TEST). Runs on its own: nothing else needs to be run first.
-- HOW:   SQL Editor → New query → paste this WHOLE file → Run. Safe to run again (it brings roles back to the chart).
-- CHECK: the last result is a list of checks. Every row must say PASS. Send a screenshot.
-- START OVER (test only):  drop schema core cascade;
--
-- Makes (matches Sellora's Access page, role chart v2, 2 Nov 2026):
--   core.access_items ... every box: 24 Sellora screens · 49 ERP screens · 19 extra rights
--   core.roles .......... 33 roles: department → group (team) → role, with Limit / Cannot notes
--   core.role_access .... 341 role × box rows
--   core.people ......... everyone who signs in; role_id = their role, empty = Special case
--   core.person_access .. the own boxes of a Special case
--   core.access_now ..... (view) what each person can open / do now
--   core.can(box) ....... "may I?" for the screens (used when screens move to Supabase)
--   core.change_log ..... every change, written by the database
-- People are NOT in this file (emails are personal data): they are loaded from the Firebase backup in the next step.
-- =====================================================================================

-- ===================================================================== 0 · the room + helpers
create schema if not exists core;
comment on schema core is 'Shared by every app: people, access, masters, SKUs, vendors.';
revoke all on schema core from anon, authenticated;
grant usage on schema core to service_role;
alter default privileges in schema core revoke all on tables from anon, authenticated;
alter default privileges in schema core revoke all on functions from anon, authenticated;
alter default privileges in schema core grant all on tables to service_role;
alter default privileges in schema core grant all on sequences to service_role;

create or replace function core.loading() returns boolean
language sql stable as $$ select coalesce(current_setting('core.loading', true), '') = 'on' $$;

create or replace function core.me_email() returns text
language sql stable as $$
  select case when auth.jwt()->>'iss' = 'https://securetoken.google.com/price-research-48ff3'
               and auth.jwt()->>'aud' = 'price-research-48ff3'
              then nullif(lower(trim(auth.jwt()->>'email')), '') end
$$;

create table if not exists core.change_log (
  id        bigint generated always as identity primary key,
  room      text        not null,
  tbl       text        not null,
  row_id    bigint,
  action    text        not null check (action in ('insert','update','delete')),
  old       jsonb,
  new       jsonb,
  by_id     bigint,
  by_email  text,
  at        timestamptz not null default now(),
  reason    text
);
create index if not exists change_log_row on core.change_log (room, tbl, row_id, at desc);
create index if not exists change_log_at  on core.change_log (at desc);
alter table core.change_log enable row level security;
comment on table core.change_log is 'Every change in every room, written by the database itself.';

-- ===================================================================== 1 · the tables
create table if not exists core.access_items (
  key         text primary key check (key ~ '^(sellora|erp|right):[a-zA-Z0-9]+$'),
  app         text not null check (app in ('sellora','erp','right')),
  code        text not null,                     -- the key the apps use today: tabs / replTabs / flag name
  name        text not null,                     -- as the Access page shows it
  menu_group  text not null,
  sort        int  not null default 0,
  active      boolean not null default true,
  check (key = app || ':' || code)
);
comment on table core.access_items is 'Every box that can be granted: Sellora screens (perms.tabs), ERP screens (perms.replTabs), extra rights (perms flags).';

create table if not exists core.roles (
  id           bigint generated always as identity primary key,
  code         text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  name         text not null,
  department   text not null check (department in ('Corporate','Production','Shipping','Other')),
  team         text not null,                                   -- the Access page's "group"
  is_admin     boolean not null default false,
  limit_note   text,
  cannot_note  text,
  built_in     boolean not null default false,
  sort         int not null default 0,
  active       boolean not null default true
);
create unique index if not exists roles_name_unique on core.roles (lower(name));
comment on table core.roles is 'Job roles from the role chart. A person in a role gets exactly its boxes.';

create table if not exists core.role_access (
  role_id   bigint not null references core.roles (id) on delete cascade,
  item_key  text   not null references core.access_items (key),
  primary key (role_id, item_key)
);
create index if not exists role_access_item on core.role_access (item_key);

create table if not exists core.people (
  id          bigint generated always as identity primary key,
  email       text not null unique check (email = lower(trim(email)) and email like '%_@_%'),
  name        text not null check (length(trim(name)) > 0),
  kind        text not null default 'staff' check (kind in ('staff','vendor','legacy')),
  vendor_id   bigint,                                           -- → core.vendors (added with the partners section)
  role_id     bigint references core.roles (id),               -- empty = Special case
  phone       text,
  brands      text[] not null default '{RBP,CPC}' check (brands <@ array['RBP','CPC']::text[]),
  active      boolean not null default true
);
comment on table core.people is 'Everyone who signs in. role_id = their role; empty = Special case with own boxes.';

create table if not exists core.person_access (
  person_id  bigint not null references core.people (id) on delete cascade,
  item_key   text   not null references core.access_items (key),
  primary key (person_id, item_key)
);
comment on table core.person_access is 'Own boxes of a Special case (a person with no role).';

-- legacy_key + who / when on every table
do $$ declare t text; begin
  foreach t in array array['access_items','roles','role_access','people','person_access'] loop
    execute format('alter table core.%I add column if not exists legacy_key text', t);
    execute format('create unique index if not exists %I on core.%I (legacy_key) where legacy_key is not null', t || '_legacy', t);
    execute format('alter table core.%I add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table core.%I add column if not exists created_by bigint references core.people (id)', t);
    execute format('alter table core.%I add column if not exists updated_at timestamptz', t);
    execute format('alter table core.%I add column if not exists updated_by bigint references core.people (id)', t);
  end loop;
end $$;

-- ===================================================================== 2 · stamp + log + rules on
create or replace function core.me_id() returns bigint
language sql stable security definer set search_path = core, public as $$
  select id from core.people where email = core.me_email() and active limit 1
$$;

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

create or replace function core.watch(t regclass) returns void
language plpgsql as $$
begin
  execute format('alter table %s enable row level security', t);
  execute format('drop trigger if exists zz_stamp on %s', t);
  execute format('create trigger zz_stamp before insert or update on %s for each row execute function core.stamp()', t);
  execute format('drop trigger if exists zz_log on %s', t);
  execute format('create trigger zz_log after insert or update or delete on %s for each row execute function core.log_change()', t);
end $$;

select core.watch(('core.' || t)::regclass) from unnest(array['access_items','roles','role_access','people','person_access']) t;

-- ===================================================================== 3 · what each person can do
drop view if exists core.access_now;
create view core.access_now as
with p as (
  select pe.id as person_id, pe.email, pe.name, r.code as role_code, coalesce(r.is_admin, false) as is_admin, pe.brands, pe.role_id
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
comment on view core.access_now is 'What each person can open / do now: admin = everything, role = its boxes, Special case = own boxes.';

create or replace function core.can(p_item text, p_brand text default null) returns boolean
language sql stable security definer set search_path = core, public as $$
  select exists (select 1 from core.access_now a
                  where a.person_id = core.me_id() and a.item_key = p_item
                    and (p_brand is null or p_brand = any (a.brands)))
$$;

-- Access rules from the Access page, kept by the database:
--   nobody takes away their own admin role, nobody switches themselves off.
create or replace function core.guard_self() returns trigger
language plpgsql as $$
begin
  if core.loading() or core.me_id() is null or new.id <> core.me_id() then return new; end if;
  if not new.active then raise exception 'You cannot switch off your own access.'; end if;
  if (select is_admin from core.roles where id = old.role_id) and not coalesce((select is_admin from core.roles where id = new.role_id), false) then
    raise exception 'You cannot take away your own admin rights.';
  end if;
  return new;
end $$;
drop trigger if exists people_guard_self on core.people;
create trigger people_guard_self before update on core.people for each row execute function core.guard_self();

-- A role from the chart cannot be deleted; a role made later only when nobody is in it (the foreign key refuses that already).
create or replace function core.guard_role_delete() returns trigger
language plpgsql as $$
begin
  if old.built_in and not core.loading() then raise exception 'Role "%" is from the role chart and cannot be deleted. Switch it off instead.', old.name; end if;
  return old;
end $$;
drop trigger if exists roles_guard_delete on core.roles;
create trigger roles_guard_delete before delete on core.roles for each row execute function core.guard_role_delete();

revoke all on function core.watch(regclass), core.log_change(), core.stamp() from public, anon, authenticated;
revoke all on function core.me_id(), core.can(text, text) from public;
grant execute on function core.me_id(), core.me_email(), core.can(text, text), core.loading() to authenticated, service_role;

-- ===================================================================== 3b · the two doors the TEST ERP may use (shadow test)
-- A signed-in ERP person (Firebase login, verified by Supabase) may call exactly two functions — nothing else in the room:
--   core.my_access()      → ONLY their own boxes
--   core.shadow_report()  → writes "did Supabase agree with Firebase, and how fast" into core.shadow_log
-- Every table stays closed to browsers (no table rights at all); the room's door opens only for these two functions.
create table if not exists core.shadow_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  email        text not null,
  section      text not null,                        -- access (later: masters, orders …)
  matched      boolean,
  firebase_ms  int,
  supabase_ms  int,
  missing      text[],                               -- in Firebase, not in Supabase
  extra        text[],                               -- in Supabase, not in Firebase
  build        text                                  -- which test ERP build
);
create index if not exists shadow_log_at on core.shadow_log (at desc);
alter table core.shadow_log enable row level security;
comment on table core.shadow_log is 'Shadow test results from the TEST ERP: Supabase answer vs Firebase answer, and both times.';

create or replace function core.my_access()
returns table (item_key text, via text, role_code text, is_admin boolean)
language sql stable security definer set search_path = core, public as $$
  select a.item_key, a.via, a.role_code, (a.via = 'admin')
    from core.access_now a
   where core.me_email() is not null and a.email = core.me_email()
$$;

create or replace function core.shadow_report(p_section text, p_matched boolean, p_firebase_ms int, p_supabase_ms int,
                                              p_missing text[] default '{}', p_extra text[] default '{}', p_build text default null)
returns void
language plpgsql security definer set search_path = core, public as $$
begin
  if core.me_email() is null then raise exception 'sign in to the ERP first'; end if;
  insert into core.shadow_log (email, section, matched, firebase_ms, supabase_ms, missing, extra, build)
  values (core.me_email(), left(coalesce(p_section, '?'), 40), p_matched, p_firebase_ms, p_supabase_ms,
          (p_missing)[1:60], (p_extra)[1:60], left(p_build, 40));
end $$;

-- "Check everyone" (test ERP): an admin or an Access viewer compares EVERY person at once — Firebase (live) vs Supabase.
-- Same people who may read everybody's access in Firebase (firestore.rules: isAdmin() || isAccessViewer()).
alter table core.shadow_log add column if not exists checked_by text;   -- who ran "Check everyone" (empty = the person signed in themselves)

create or replace function core.can_see_all_access() returns boolean
language sql stable security definer set search_path = core, public as $$
  select core.me_email() is not null and exists (
    select 1 from core.access_now a where a.email = core.me_email() and (a.via = 'admin' or a.item_key = 'right:accessView'))
$$;

create or replace function core.access_of_everyone()
returns table (email text, name text, role_code text, item_key text, via text)
language plpgsql stable security definer set search_path = core, public as $$
begin
  if not core.can_see_all_access() then raise exception 'Only an admin or an Access viewer may check everyone.'; end if;
  return query select a.email, a.name, a.role_code, a.item_key, a.via from core.access_now a;
end $$;

-- results of one "Check everyone" run: [{email, matched, missing[], extra[]}, …]
create or replace function core.shadow_report_everyone(p_results jsonb, p_firebase_ms int, p_supabase_ms int, p_build text default null)
returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  if not core.can_see_all_access() then raise exception 'Only an admin or an Access viewer may check everyone.'; end if;
  insert into core.shadow_log (email, section, matched, firebase_ms, supabase_ms, missing, extra, build, checked_by)
  select lower(left(x->>'email', 200)), 'access · check everyone', (x->>'matched')::boolean, p_firebase_ms, p_supabase_ms,
         (select array_agg(v) from jsonb_array_elements_text(coalesce(x->'missing', '[]')) v)[1:60],
         (select array_agg(v) from jsonb_array_elements_text(coalesce(x->'extra', '[]')) v)[1:60],
         left(p_build, 40), core.me_email()
    from jsonb_array_elements(p_results) x
   limit 500;
  get diagnostics n = row_count;
  return n;
end $$;

grant usage on schema core to anon, authenticated;
revoke all on all tables in schema core from anon, authenticated;
revoke all on function core.can_see_all_access(), core.access_of_everyone(), core.shadow_report_everyone(jsonb, int, int, text) from public;
grant execute on function core.can_see_all_access(), core.access_of_everyone(), core.shadow_report_everyone(jsonb, int, int, text) to anon, authenticated, service_role;
revoke all on function core.my_access(), core.shadow_report(text, boolean, int, int, text[], text[], text) from public;
grant execute on function core.my_access(), core.shadow_report(text, boolean, int, int, text[], text[], text) to anon, authenticated, service_role;

-- ===================================================================== 4 · the boxes and the role chart (generated)
select set_config('core.loading', 'on', false);   -- design data: not logged as a person's change

insert into core.access_items (key, app, code, name, menu_group, sort) values
 ('sellora:new', 'sellora', 'new', 'New Product', 'Research', 100),
 ('sellora:pr', 'sellora', 'pr', 'Product Research', 'Research', 101),
 ('sellora:sales', 'sellora', 'sales', 'Sales Dashboard', 'Sales', 110),
 ('sellora:profit', 'sellora', 'profit', 'Profit & Margin', 'Sales', 111),
 ('sellora:sa', 'sellora', 'sa', 'Sales Analysis', 'Sales', 112),
 ('sellora:plaudit', 'sellora', 'plaudit', 'Parent Listing Review', 'Sales', 113),
 ('sellora:shop', 'sellora', 'shop', 'Shopify Orders', 'Sales', 114),
 ('sellora:adj', 'sellora', 'adj', 'Adjustments', 'Sales', 115),
 ('sellora:opt', 'sellora', 'opt', 'Listing Optimiser', 'Listing', 120),
 ('sellora:img', 'sellora', 'img', 'Image Manager', 'Listing', 121),
 ('sellora:lerr', 'sellora', 'lerr', 'Listing Errors', 'Listing', 122),
 ('sellora:basket', 'sellora', 'basket', 'Bought Together', 'Listing', 123),
 ('sellora:health', 'sellora', 'health', 'Listing Health', 'Listing', 124),
 ('sellora:lrules', 'sellora', 'lrules', 'Listing Rules', 'Listing', 125),
 ('sellora:audit', 'sellora', 'audit', 'Listing Audit', 'Listing', 126),
 ('sellora:bsr', 'sellora', 'bsr', 'BSR Audit', 'Listing', 127),
 ('sellora:trends', 'sellora', 'trends', 'Ad Console', 'Advertising', 130),
 ('sellora:weekly', 'sellora', 'weekly', 'PPC & Organic', 'Advertising', 131),
 ('sellora:st', 'sellora', 'st', 'Search Terms', 'Advertising', 132),
 ('sellora:plc', 'sellora', 'plc', 'Placement', 'Advertising', 133),
 ('sellora:deals', 'sellora', 'deals', 'Deal Calendar', 'Advertising', 134),
 ('sellora:age', 'sellora', 'age', 'Inventory Age', 'Inventory & social', 140),
 ('sellora:tiktok', 'sellora', 'tiktok', 'TikTok Toolkit', 'Inventory & social', 141),
 ('sellora:carousel', 'sellora', 'carousel', 'Carousel Builder', 'Inventory & social', 142),
 ('erp:shop', 'erp', 'shop', 'Shopify Orders', 'Shopify', 200),
 ('erp:adj', 'erp', 'adj', 'Adjustments', 'Shopify', 201),
 ('erp:shopify', 'erp', 'shopify', 'Shopify Stock', 'Shopify', 202),
 ('erp:shopprod', 'erp', 'shopprod', 'Order Console — Shopify only', 'Shopify', 203),
 ('erp:shopret', 'erp', 'shopret', 'Shopify returns team', 'Shopify', 204),
 ('erp:repl', 'erp', 'repl', 'Replenishment', 'Replenishment & planning', 210),
 ('erp:article', 'erp', 'article', 'Article Review', 'Replenishment & planning', 211),
 ('erp:target', 'erp', 'target', 'Revenue Target', 'Replenishment & planning', 212),
 ('erp:top', 'erp', 'top', 'Top ASIN Status', 'Replenishment & planning', 213),
 ('erp:pack', 'erp', 'pack', 'Packing List', 'Replenishment & planning', 214),
 ('erp:so', 'erp', 'so', 'Sales Orders', 'Orders', 220),
 ('erp:ord', 'erp', 'ord', 'Order Console — every order', 'Orders', 221),
 ('erp:shpacc', 'erp', 'shpacc', 'Order Console — Shipping to accept', 'Orders', 222),
 ('erp:flppc', 'erp', 'flppc', 'PPC and PPC completed', 'Production flow', 230),
 ('erp:fldem', 'erp', 'fldem', 'Demand: RFD fabric out', 'Production flow', 231),
 ('erp:flacc', 'erp', 'flacc', 'Demand: accessories', 'Production flow', 232),
 ('erp:flchl', 'erp', 'flchl', 'Printed fabric in · history', 'Production flow', 233),
 ('erp:flcut', 'erp', 'flcut', 'To cut', 'Production flow', 234),
 ('erp:flraw', 'erp', 'flraw', 'Raw cutting in store', 'Production flow', 235),
 ('erp:flwip', 'erp', 'flwip', 'WIP with karigars', 'Production flow', 236),
 ('erp:pcut', 'erp', 'pcut', 'Cutting Data', 'Making', 240),
 ('erp:pbase', 'erp', 'pbase', 'Job Work Register', 'Making', 241),
 ('erp:ppress', 'erp', 'ppress', 'Press Inventory', 'Making', 242),
 ('erp:qc', 'erp', 'qc', 'Quality Control — checks', 'Making', 243),
 ('erp:qcalt', 'erp', 'qcalt', 'QC — issue for alteration', 'Making', 244),
 ('erp:qcret', 'erp', 'qcret', 'QC — receive back', 'Making', 245),
 ('erp:fgi', 'erp', 'fgi', 'Finished Goods', 'Finished & dispatch', 250),
 ('erp:fgacc', 'erp', 'fgacc', 'Finished Goods — From QC, to accept', 'Finished & dispatch', 251),
 ('erp:fba', 'erp', 'fba', 'FBA Dispatch', 'Finished & dispatch', 252),
 ('erp:fab', 'erp', 'fab', 'Fabric Inventory', 'Materials', 260),
 ('erp:acc', 'erp', 'acc', 'Accessories', 'Materials', 261),
 ('erp:gdesk', 'erp', 'gdesk', 'Greige Desk — open', 'Materials', 262),
 ('erp:gdled', 'erp', 'gdled', 'Greige Desk — fabric ledger', 'Materials', 263),
 ('erp:gdledit', 'erp', 'gdledit', 'Greige Desk — correct ledger', 'Materials', 264),
 ('erp:gdappr', 'erp', 'gdappr', 'Greige Desk — approve shrinkage >5%', 'Materials', 265),
 ('erp:pmdb', 'erp', 'pmdb', 'Master Database', 'Setup', 270),
 ('erp:mst', 'erp', 'mst', 'Masters', 'Setup', 271),
 ('erp:vreq', 'erp', 'vreq', 'Vendor Order Requests', 'Vendors & printers', 280),
 ('erp:vord', 'erp', 'vord', 'Vendor Orders', 'Vendors & printers', 281),
 ('erp:rfd', 'erp', 'rfd', 'RFD Requirements', 'Vendors & printers', 282),
 ('erp:vend', 'erp', 'vend', 'Vendor Portal', 'Vendors & printers', 283),
 ('erp:vlog', 'erp', 'vlog', 'History', 'Vendors & printers', 284),
 ('erp:palloc', 'erp', 'palloc', 'Printer Allocation', 'Vendors & printers', 285),
 ('erp:vpview', 'erp', 'vpview', 'Printer''s portal (view only)', 'Vendors & printers', 286),
 ('erp:att', 'erp', 'att', 'Attendance', 'People & pay', 300),
 ('erp:hr', 'erp', 'hr', 'Finance & HR', 'People & pay', 301),
 ('erp:rep', 'erp', 'rep', 'Reports', 'Reports', 310),
 ('erp:pa', 'erp', 'pa', 'Production Analysis', 'Reports', 311),
 ('erp:ka', 'erp', 'ka', 'Karigar Analysis', 'Reports', 312),
 ('right:approve', 'right', 'approve', 'Sellora approvals', 'Can also', 400),
 ('right:replProj', 'right', 'replProj', 'Change monthly projections', 'Can also', 401),
 ('right:soApprove', 'right', 'soApprove', 'Approve sales orders', 'Can also', 402),
 ('right:vreqApprove', 'right', 'vreqApprove', 'Approve vendor order requests', 'Can also', 403),
 ('right:rateApprove', 'right', 'rateApprove', 'Approve vendor rates', 'Can also', 404),
 ('right:rfdApprove', 'right', 'rfdApprove', 'Approve extra RFD cloth', 'Can also', 405),
 ('right:rfdSend', 'right', 'rfdSend', 'Mark RFD fabric sent', 'Can also', 406),
 ('right:vlogAccept', 'right', 'vlogAccept', 'Accept printer deliveries', 'Can also', 407),
 ('right:shopAssign', 'right', 'shopAssign', 'Give Shopify lines to printers', 'Can also', 408),
 ('right:b2bAssign', 'right', 'b2bAssign', 'Give B2B lines to printers', 'Can also', 409),
 ('right:prodEdit', 'right', 'prodEdit', 'Correct production entries', 'Can also', 410),
 ('right:attendMark', 'right', 'attendMark', 'Mark attendance', 'Can also', 411),
 ('right:empEdit', 'right', 'empEdit', 'Add, change, remove employees', 'Can also', 412),
 ('right:fgiEntry', 'right', 'fgiEntry', 'Add finished-goods entries', 'Can also', 413),
 ('right:fgiEdit', 'right', 'fgiEdit', 'Edit and delete finished goods', 'Can also', 414),
 ('right:accEntry', 'right', 'accEntry', 'Add accessory movements', 'Can also', 415),
 ('right:accEdit', 'right', 'accEdit', 'Edit the accessories record', 'Can also', 416),
 ('right:mdbEdit', 'right', 'mdbEdit', 'Change the Master Database', 'Can also', 417),
 ('right:accessView', 'right', 'accessView', 'See the Access page (view only)', 'Can also', 418)
on conflict (key) do update set name = excluded.name, menu_group = excluded.menu_group, sort = excluded.sort, active = true;
-- a box no longer on the Access page is switched off, never deleted
update core.access_items set active = false where key not in ('sellora:new', 'sellora:pr', 'sellora:sales', 'sellora:profit', 'sellora:sa', 'sellora:plaudit', 'sellora:shop', 'sellora:adj', 'sellora:opt', 'sellora:img', 'sellora:lerr', 'sellora:basket', 'sellora:health', 'sellora:lrules', 'sellora:audit', 'sellora:bsr', 'sellora:trends', 'sellora:weekly', 'sellora:st', 'sellora:plc', 'sellora:deals', 'sellora:age', 'sellora:tiktok', 'sellora:carousel', 'erp:shop', 'erp:adj', 'erp:shopify', 'erp:shopprod', 'erp:shopret', 'erp:repl', 'erp:article', 'erp:target', 'erp:top', 'erp:pack', 'erp:so', 'erp:ord', 'erp:shpacc', 'erp:flppc', 'erp:fldem', 'erp:flacc', 'erp:flchl', 'erp:flcut', 'erp:flraw', 'erp:flwip', 'erp:pcut', 'erp:pbase', 'erp:ppress', 'erp:qc', 'erp:qcalt', 'erp:qcret', 'erp:fgi', 'erp:fgacc', 'erp:fba', 'erp:fab', 'erp:acc', 'erp:gdesk', 'erp:gdled', 'erp:gdledit', 'erp:gdappr', 'erp:pmdb', 'erp:mst', 'erp:vreq', 'erp:vord', 'erp:rfd', 'erp:vend', 'erp:vlog', 'erp:palloc', 'erp:vpview', 'erp:att', 'erp:hr', 'erp:rep', 'erp:pa', 'erp:ka', 'right:approve', 'right:replProj', 'right:soApprove', 'right:vreqApprove', 'right:rateApprove', 'right:rfdApprove', 'right:rfdSend', 'right:vlogAccept', 'right:shopAssign', 'right:b2bAssign', 'right:prodEdit', 'right:attendMark', 'right:empEdit', 'right:fgiEntry', 'right:fgiEdit', 'right:accEntry', 'right:accEdit', 'right:mdbEdit', 'right:accessView');

-- the 33 roles of the chart (re-running brings them back to the chart)
insert into core.roles (code, name, department, team, is_admin, limit_note, cannot_note, built_in, sort) values
 ('owneradmin', 'Owner / Director (Admin)', 'Corporate', 'Management', true, 'Full Admin: pay, rates and granting access', null, true, 10),
 ('itall', 'IT — every screen, not Admin', 'Corporate', 'IT & master data', false, null, 'Grant access', true, 20),
 ('accessviewer', 'Access viewer (view only)', 'Corporate', 'IT & master data', false, 'Sees everybody’s access; cannot change any of it', 'Give, change or remove access', true, 30),
 ('accounts', 'Accounts', 'Corporate', 'HR & accounts', false, null, null, true, 40),
 ('amzops', 'Amazon & operations manager', 'Corporate', 'Amazon', false, null, null, true, 50),
 ('amzexec', 'Amazon executive', 'Corporate', 'Amazon', false, null, null, true, 60),
 ('adslist', 'Ads & listing executive (Ridhi only)', 'Corporate', 'Amazon', false, 'One brand: Ridhi (SP)', null, true, 70),
 ('amzintern', 'Amazon intern (replenishment)', 'Corporate', 'Amazon', false, null, null, true, 80),
 ('amzstock', 'Amazon stock & finished goods', 'Corporate', 'Amazon', false, null, null, true, 90),
 ('listing', 'Listing executive', 'Corporate', 'Amazon', false, null, null, true, 100),
 ('lhealth', 'Listing health checker', 'Corporate', 'Amazon', false, null, null, true, 110),
 ('shpplan', 'Shopify production planner', 'Corporate', 'Shopify / website', false, null, null, true, 120),
 ('shpexec', 'Shopify executive', 'Corporate', 'Shopify / website', false, null, null, true, 130),
 ('shpsellora', 'Shopify orders (Sellora only)', 'Corporate', 'Shopify / website', false, null, null, true, 140),
 ('returns', 'Returns executive', 'Corporate', 'Shopify / website', false, null, 'See the orders table or production', true, 150),
 ('sodesk', 'Sales order desk', 'Corporate', 'Sales / B2B', false, null, null, true, 160),
 ('sofg', 'Sales order desk + finished goods', 'Corporate', 'Sales / B2B', false, null, null, true, 170),
 ('ppchead', 'Production planner (PPC head)', 'Production', 'Planning (PPC)', false, null, null, true, 180),
 ('shpprod', 'Shopify production in-charge', 'Production', 'Planning (PPC)', false, null, null, true, 190),
 ('prodmgr', 'Production manager', 'Production', 'Shop floor', false, null, null, true, 200),
 ('floor', 'Floor supervisor', 'Production', 'Shop floor', false, null, 'See pay or rates', true, 210),
 ('followup', 'Order follow-up', 'Production', 'Shop floor', false, null, null, true, 220),
 ('cutting', 'Cutting master', 'Production', 'Shop floor', false, null, null, true, 230),
 ('qc', 'QC checker', 'Production', 'Shop floor', false, null, null, true, 240),
 ('rfdstore', 'RFD fabric store', 'Production', 'Store', false, null, null, true, 250),
 ('greige', 'Greige store', 'Production', 'Store', false, null, null, true, 260),
 ('pfin', 'Printed fabric receiving', 'Production', 'Store', false, null, null, true, 270),
 ('vreqmst', 'Vendor request raiser + master', 'Production', 'Vendors & printers', false, null, null, true, 280),
 ('vreq', 'Vendor request raiser', 'Production', 'Vendors & printers', false, null, null, true, 290),
 ('shipping', 'Shipping team', 'Shipping', 'Shipping', false, null, null, true, 300),
 ('fgstore', 'Finished goods store', 'Shipping', 'Finished goods & FBA', false, null, null, true, 310),
 ('vendor', 'Printer / vendor', 'Other', 'Outside partners', false, 'Own orders only', null, true, 320),
 ('vendacc', 'Printer who also accepts deliveries', 'Other', 'Outside partners', false, null, null, true, 330)
on conflict (code) do update set name = excluded.name, department = excluded.department, team = excluded.team, is_admin = excluded.is_admin,
  limit_note = excluded.limit_note, cannot_note = excluded.cannot_note, built_in = true, sort = excluded.sort, active = true;

-- their boxes
delete from core.role_access where role_id in (select id from core.roles where built_in);
insert into core.role_access (role_id, item_key)
select r.id, v.item_key from (values
 ('itall', 'sellora:age'),
 ('itall', 'sellora:audit'),
 ('itall', 'sellora:basket'),
 ('itall', 'sellora:bsr'),
 ('itall', 'sellora:carousel'),
 ('itall', 'sellora:deals'),
 ('itall', 'sellora:health'),
 ('itall', 'sellora:img'),
 ('itall', 'sellora:lerr'),
 ('itall', 'sellora:lrules'),
 ('itall', 'sellora:new'),
 ('itall', 'sellora:opt'),
 ('itall', 'sellora:plaudit'),
 ('itall', 'sellora:plc'),
 ('itall', 'sellora:pr'),
 ('itall', 'sellora:profit'),
 ('itall', 'sellora:sa'),
 ('itall', 'sellora:sales'),
 ('itall', 'sellora:st'),
 ('itall', 'sellora:tiktok'),
 ('itall', 'sellora:trends'),
 ('itall', 'sellora:weekly'),
 ('itall', 'erp:acc'),
 ('itall', 'erp:adj'),
 ('itall', 'erp:article'),
 ('itall', 'erp:att'),
 ('itall', 'erp:fab'),
 ('itall', 'erp:fba'),
 ('itall', 'erp:fgi'),
 ('itall', 'erp:flacc'),
 ('itall', 'erp:flchl'),
 ('itall', 'erp:flcut'),
 ('itall', 'erp:fldem'),
 ('itall', 'erp:flppc'),
 ('itall', 'erp:flraw'),
 ('itall', 'erp:flwip'),
 ('itall', 'erp:gdappr'),
 ('itall', 'erp:gdesk'),
 ('itall', 'erp:gdled'),
 ('itall', 'erp:gdledit'),
 ('itall', 'erp:hr'),
 ('itall', 'erp:ka'),
 ('itall', 'erp:mst'),
 ('itall', 'erp:ord'),
 ('itall', 'erp:pa'),
 ('itall', 'erp:pack'),
 ('itall', 'erp:palloc'),
 ('itall', 'erp:pbase'),
 ('itall', 'erp:pcut'),
 ('itall', 'erp:pmdb'),
 ('itall', 'erp:ppress'),
 ('itall', 'erp:qc'),
 ('itall', 'erp:qcalt'),
 ('itall', 'erp:qcret'),
 ('itall', 'erp:rep'),
 ('itall', 'erp:repl'),
 ('itall', 'erp:rfd'),
 ('itall', 'erp:shop'),
 ('itall', 'erp:shopify'),
 ('itall', 'erp:shopprod'),
 ('itall', 'erp:so'),
 ('itall', 'erp:target'),
 ('itall', 'erp:top'),
 ('itall', 'erp:vend'),
 ('itall', 'erp:vlog'),
 ('itall', 'erp:vord'),
 ('itall', 'erp:vreq'),
 ('accessviewer', 'right:accessView'),
 ('accounts', 'sellora:adj'),
 ('accounts', 'sellora:age'),
 ('accounts', 'sellora:profit'),
 ('accounts', 'sellora:sales'),
 ('accounts', 'sellora:shop'),
 ('accounts', 'sellora:trends'),
 ('accounts', 'erp:acc'),
 ('accounts', 'erp:adj'),
 ('accounts', 'erp:article'),
 ('accounts', 'erp:fab'),
 ('accounts', 'erp:fba'),
 ('accounts', 'erp:fgi'),
 ('accounts', 'erp:gdappr'),
 ('accounts', 'erp:gdesk'),
 ('accounts', 'erp:gdled'),
 ('accounts', 'erp:gdledit'),
 ('accounts', 'erp:mst'),
 ('accounts', 'erp:ord'),
 ('accounts', 'erp:pack'),
 ('accounts', 'erp:palloc'),
 ('accounts', 'erp:pbase'),
 ('accounts', 'erp:pcut'),
 ('accounts', 'erp:pmdb'),
 ('accounts', 'erp:ppress'),
 ('accounts', 'erp:qc'),
 ('accounts', 'erp:qcalt'),
 ('accounts', 'erp:qcret'),
 ('accounts', 'erp:repl'),
 ('accounts', 'erp:rfd'),
 ('accounts', 'erp:shop'),
 ('accounts', 'erp:shopify'),
 ('accounts', 'erp:shopprod'),
 ('accounts', 'erp:shopret'),
 ('accounts', 'erp:so'),
 ('accounts', 'erp:target'),
 ('accounts', 'erp:top'),
 ('accounts', 'erp:vend'),
 ('accounts', 'erp:vlog'),
 ('accounts', 'erp:vord'),
 ('accounts', 'erp:vreq'),
 ('accounts', 'right:replProj'),
 ('accounts', 'right:soApprove'),
 ('amzops', 'sellora:adj'),
 ('amzops', 'sellora:age'),
 ('amzops', 'sellora:audit'),
 ('amzops', 'sellora:bsr'),
 ('amzops', 'sellora:deals'),
 ('amzops', 'sellora:health'),
 ('amzops', 'sellora:plaudit'),
 ('amzops', 'sellora:pr'),
 ('amzops', 'sellora:sales'),
 ('amzops', 'sellora:shop'),
 ('amzops', 'erp:adj'),
 ('amzops', 'erp:fab'),
 ('amzops', 'erp:fba'),
 ('amzops', 'erp:fgi'),
 ('amzops', 'erp:ord'),
 ('amzops', 'erp:pmdb'),
 ('amzops', 'erp:repl'),
 ('amzops', 'erp:shop'),
 ('amzops', 'erp:shopify'),
 ('amzops', 'erp:shopprod'),
 ('amzops', 'erp:so'),
 ('amzops', 'erp:vord'),
 ('amzops', 'erp:vreq'),
 ('amzops', 'right:soApprove'),
 ('amzops', 'right:mdbEdit'),
 ('amzexec', 'sellora:age'),
 ('amzexec', 'sellora:audit'),
 ('amzexec', 'sellora:bsr'),
 ('amzexec', 'sellora:deals'),
 ('amzexec', 'sellora:health'),
 ('amzexec', 'sellora:img'),
 ('amzexec', 'sellora:lerr'),
 ('amzexec', 'erp:article'),
 ('amzexec', 'erp:fgi'),
 ('amzexec', 'erp:ord'),
 ('amzexec', 'erp:repl'),
 ('amzexec', 'erp:top'),
 ('adslist', 'sellora:age'),
 ('adslist', 'sellora:audit'),
 ('adslist', 'sellora:basket'),
 ('adslist', 'sellora:bsr'),
 ('adslist', 'sellora:deals'),
 ('adslist', 'sellora:health'),
 ('adslist', 'sellora:img'),
 ('adslist', 'sellora:lerr'),
 ('adslist', 'sellora:lrules'),
 ('adslist', 'sellora:opt'),
 ('adslist', 'sellora:plc'),
 ('adslist', 'sellora:st'),
 ('adslist', 'sellora:trends'),
 ('adslist', 'sellora:weekly'),
 ('adslist', 'erp:fgi'),
 ('adslist', 'erp:repl'),
 ('amzintern', 'erp:article'),
 ('amzintern', 'erp:repl'),
 ('amzintern', 'erp:shopify'),
 ('amzintern', 'erp:target'),
 ('amzintern', 'erp:top'),
 ('amzstock', 'sellora:age'),
 ('amzstock', 'erp:fba'),
 ('amzstock', 'erp:fgi'),
 ('amzstock', 'erp:pack'),
 ('amzstock', 'erp:pmdb'),
 ('amzstock', 'erp:repl'),
 ('amzstock', 'right:fgiEntry'),
 ('amzstock', 'right:fgiEdit'),
 ('amzstock', 'right:mdbEdit'),
 ('listing', 'sellora:audit'),
 ('listing', 'sellora:basket'),
 ('listing', 'sellora:bsr'),
 ('listing', 'sellora:health'),
 ('listing', 'sellora:img'),
 ('listing', 'sellora:lerr'),
 ('listing', 'sellora:lrules'),
 ('listing', 'sellora:opt'),
 ('lhealth', 'sellora:health'),
 ('lhealth', 'sellora:lrules'),
 ('shpplan', 'sellora:adj'),
 ('shpplan', 'sellora:shop'),
 ('shpplan', 'erp:adj'),
 ('shpplan', 'erp:flppc'),
 ('shpplan', 'erp:ord'),
 ('shpplan', 'erp:pmdb'),
 ('shpplan', 'erp:ppress'),
 ('shpplan', 'erp:shop'),
 ('shpplan', 'erp:shopify'),
 ('shpplan', 'erp:shopprod'),
 ('shpplan', 'erp:shopret'),
 ('shpplan', 'erp:so'),
 ('shpplan', 'erp:vlog'),
 ('shpplan', 'erp:vreq'),
 ('shpplan', 'right:shopAssign'),
 ('shpplan', 'right:b2bAssign'),
 ('shpplan', 'right:prodEdit'),
 ('shpexec', 'erp:adj'),
 ('shpexec', 'erp:mst'),
 ('shpexec', 'erp:ord'),
 ('shpexec', 'erp:pmdb'),
 ('shpexec', 'erp:shop'),
 ('shpexec', 'erp:shopprod'),
 ('shpexec', 'erp:vreq'),
 ('shpexec', 'right:shopAssign'),
 ('shpsellora', 'sellora:adj'),
 ('shpsellora', 'sellora:shop'),
 ('returns', 'erp:shop'),
 ('returns', 'erp:shopret'),
 ('sodesk', 'erp:pmdb'),
 ('sodesk', 'erp:so'),
 ('sofg', 'erp:fgi'),
 ('sofg', 'erp:pmdb'),
 ('sofg', 'erp:so'),
 ('ppchead', 'erp:fab'),
 ('ppchead', 'erp:flacc'),
 ('ppchead', 'erp:flchl'),
 ('ppchead', 'erp:flcut'),
 ('ppchead', 'erp:fldem'),
 ('ppchead', 'erp:flppc'),
 ('ppchead', 'erp:flraw'),
 ('ppchead', 'erp:flwip'),
 ('ppchead', 'erp:ord'),
 ('ppchead', 'erp:palloc'),
 ('ppchead', 'erp:pbase'),
 ('ppchead', 'erp:pcut'),
 ('ppchead', 'erp:qc'),
 ('ppchead', 'erp:qcalt'),
 ('ppchead', 'erp:qcret'),
 ('ppchead', 'erp:rep'),
 ('ppchead', 'erp:rfd'),
 ('ppchead', 'erp:so'),
 ('ppchead', 'erp:vend'),
 ('ppchead', 'erp:vlog'),
 ('ppchead', 'erp:vord'),
 ('ppchead', 'right:soApprove'),
 ('ppchead', 'right:vreqApprove'),
 ('ppchead', 'right:vlogAccept'),
 ('ppchead', 'right:b2bAssign'),
 ('ppchead', 'right:prodEdit'),
 ('shpprod', 'erp:flcut'),
 ('shpprod', 'erp:flraw'),
 ('shpprod', 'erp:flwip'),
 ('shpprod', 'erp:ord'),
 ('shpprod', 'erp:shop'),
 ('shpprod', 'erp:shopprod'),
 ('shpprod', 'right:shopAssign'),
 ('shpprod', 'right:b2bAssign'),
 ('shpprod', 'right:prodEdit'),
 ('prodmgr', 'erp:acc'),
 ('prodmgr', 'erp:att'),
 ('prodmgr', 'erp:fab'),
 ('prodmgr', 'erp:fgi'),
 ('prodmgr', 'erp:flacc'),
 ('prodmgr', 'erp:flchl'),
 ('prodmgr', 'erp:flcut'),
 ('prodmgr', 'erp:fldem'),
 ('prodmgr', 'erp:flppc'),
 ('prodmgr', 'erp:flraw'),
 ('prodmgr', 'erp:flwip'),
 ('prodmgr', 'erp:hr'),
 ('prodmgr', 'erp:mst'),
 ('prodmgr', 'erp:ord'),
 ('prodmgr', 'erp:pbase'),
 ('prodmgr', 'erp:pcut'),
 ('prodmgr', 'erp:pmdb'),
 ('prodmgr', 'erp:vlog'),
 ('prodmgr', 'erp:vord'),
 ('prodmgr', 'erp:vreq'),
 ('prodmgr', 'right:vlogAccept'),
 ('prodmgr', 'right:shopAssign'),
 ('prodmgr', 'right:b2bAssign'),
 ('prodmgr', 'right:prodEdit'),
 ('prodmgr', 'right:attendMark'),
 ('prodmgr', 'right:accEntry'),
 ('prodmgr', 'right:accEdit'),
 ('floor', 'erp:acc'),
 ('floor', 'erp:flcut'),
 ('floor', 'erp:flraw'),
 ('floor', 'erp:flwip'),
 ('floor', 'erp:ord'),
 ('floor', 'erp:pbase'),
 ('floor', 'erp:pcut'),
 ('floor', 'erp:vlog'),
 ('floor', 'right:vlogAccept'),
 ('floor', 'right:prodEdit'),
 ('floor', 'right:accEntry'),
 ('floor', 'right:accEdit'),
 ('followup', 'erp:ord'),
 ('followup', 'right:prodEdit'),
 ('cutting', 'erp:shopprod'),
 ('cutting', 'erp:ord'),
 ('cutting', 'erp:flcut'),
 ('cutting', 'erp:pcut'),
 ('qc', 'erp:qc'),
 ('qc', 'erp:qcalt'),
 ('qc', 'erp:qcret'),
 ('qc', 'right:prodEdit'),
 ('rfdstore', 'erp:fab'),
 ('rfdstore', 'erp:flchl'),
 ('rfdstore', 'erp:fldem'),
 ('rfdstore', 'erp:rfd'),
 ('rfdstore', 'right:rfdSend'),
 ('rfdstore', 'right:prodEdit'),
 ('greige', 'erp:fab'),
 ('greige', 'erp:flchl'),
 ('greige', 'erp:fldem'),
 ('greige', 'erp:gdesk'),
 ('greige', 'erp:gdled'),
 ('greige', 'erp:gdledit'),
 ('greige', 'right:fgiEntry'),
 ('pfin', 'erp:flchl'),
 ('pfin', 'erp:vlog'),
 ('pfin', 'erp:vord'),
 ('pfin', 'right:vlogAccept'),
 ('vreqmst', 'erp:pmdb'),
 ('vreqmst', 'erp:vreq'),
 ('vreq', 'erp:vreq'),
 ('shipping', 'sellora:adj'),
 ('shipping', 'sellora:shop'),
 ('shipping', 'erp:adj'),
 ('shipping', 'erp:fgi'),
 ('shipping', 'erp:shop'),
 ('shipping', 'erp:shopify'),
 ('shipping', 'erp:shopprod'),
 ('shipping', 'erp:shpacc'),
 ('fgstore', 'erp:fba'),
 ('fgstore', 'erp:fgacc'),
 ('fgstore', 'erp:fgi'),
 ('fgstore', 'right:fgiEntry'),
 ('vendor', 'erp:vend'),
 ('vendacc', 'erp:vend'),
 ('vendacc', 'erp:vlog'),
 ('vendacc', 'right:vlogAccept')
) v (code, item_key) join core.roles r on r.code = v.code;

select set_config('core.loading', 'off', false);

-- ===================================================================== 5 · the checks, as one function
-- core.access_checks() runs every structure check and every live test (everything a test writes is undone)
-- and returns one row per check. The SQL Editor runs it at the end of this file; the check page calls it too.
create or replace function core.access_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare a bigint; b bigint; t1 bigint; got int; r text; r_all text;
begin
  -- "check everyone" without a signed-in admin / Access viewer must be refused
  r_all := 'FAIL: it answered';
  begin
    perform * from core.access_of_everyone();
  exception when others then if sqlerrm like 'Only an admin%' then r_all := 'PASS'; else r_all := 'FAIL: ' || sqlerrm; end if;
  end;
  create temp table if not exists _t (n int, check_name text, result text);
  truncate _t;
  -- A. every role: a test person in it gets exactly the role's boxes (admin: every box)
  r := 'PASS';
  begin
    for t1 in select id from core.roles loop
      insert into core.people (email, name, role_id) values ('test.role' || t1 || '@ridhi.test', 'Test', t1) returning id into a;
      select count(*) into got from core.access_now where person_id = a;
      if got <> (select case when ro.is_admin then (select count(*) from core.access_items where active)
                             else (select count(*) from core.role_access ra join core.access_items i on i.key = ra.item_key and i.active where ra.role_id = ro.id) end
                   from core.roles ro where ro.id = t1) then
        r := 'FAIL: role ' || (select code from core.roles where id = t1) || ' gives ' || got || ' boxes';
      end if;
    end loop;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (20, 'every role gives a person exactly its boxes (admin: all)', r);

  -- B. a Special case gets exactly their own boxes
  r := 'FAIL';
  begin
    insert into core.people (email, name) values ('test.s@ridhi.test', 'Test S') returning id into b;
    insert into core.person_access (person_id, item_key) values (b, 'erp:fgi'), (b, 'sellora:sales');
    select count(*) into got from core.access_now where person_id = b and via = 'own';
    r := case when got = 2 and (select count(*) from core.access_now where person_id = b) = 2 then 'PASS' else 'FAIL: ' || got end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (21, 'a Special case gets exactly their own boxes', r);

  -- C. a box that is not on the list cannot be given
  r := 'FAIL: it was accepted';
  begin
    insert into core.role_access (role_id, item_key) select id, 'right:bdFill' from core.roles limit 1;
    raise exception 'undo';
  exception when foreign_key_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (22, 'a box that is not on the list is refused (e.g. bdFill)', r);

  -- D. a chart role cannot be deleted
  r := 'FAIL: it was deleted';
  begin
    delete from core.roles where code = 'qc';
    raise exception 'undo';
  exception when others then if sqlerrm like '%cannot be deleted%' then r := 'PASS'; elsif sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (23, 'a role from the chart cannot be deleted', r);

  -- E. two roles with the same name (any letters) are refused
  r := 'FAIL: it was accepted';
  begin
    insert into core.roles (code, name, department, team) values ('test_dup', 'qc CHECKER', 'Production', 'Shop floor');
    raise exception 'undo';
  exception when unique_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (24, 'two roles with the same name are refused', r);

  -- F. a person cannot be in a role that does not exist; emails in small letters only
  r := 'FAIL: it was accepted';
  begin
    insert into core.people (email, name, role_id) values ('test.x@ridhi.test', 'Test X', -1);
    raise exception 'undo';
  exception when foreign_key_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (25, 'a person in a role that does not exist is refused', r);
  r := 'FAIL: it was accepted';
  begin
    insert into core.people (email, name) values ('Test.C@Ridhi.test', 'Test C');
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (26, 'capital letters in an email are refused', r);

  -- G. changing a role changes it for everyone in it, and the database logs the change
  r := 'FAIL';
  begin
    select id into t1 from core.roles where code = 'qc';
    insert into core.people (email, name, role_id) values ('test.q1@ridhi.test', 'Q1', t1), ('test.q2@ridhi.test', 'Q2', t1);
    insert into core.role_access (role_id, item_key) values (t1, 'erp:fgi');
    select count(*) into got from core.access_now where email in ('test.q1@ridhi.test', 'test.q2@ridhi.test') and item_key = 'erp:fgi';
    r := case when got = 2 and exists (select 1 from core.change_log where tbl = 'role_access' and action = 'insert' and at >= now() - interval '1 minute')
              then 'PASS' else 'FAIL: ' || got || ' of 2 got the new box' end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (27, 'a role change reaches everyone in it, and is logged', r);

  -- structure checks + the live tests, one list
  return query
  select x.n, x.check_name, x.result from (
  select 1 as n, 'boxes: 24 Sellora + 49 ERP + 19 rights' as check_name,
         case when (select count(*) from core.access_items where active and app = 'sellora') = 24
               and (select count(*) from core.access_items where active and app = 'erp') = 49
               and (select count(*) from core.access_items where active and app = 'right') = 19 then 'PASS'
              else 'FAIL: ' || (select string_agg(app || ' ' || n, ', ') from (select app, count(*) n from core.access_items where active group by app) x) end as result
  union all select 2, 'roles: 33 from the chart, in 4 departments',
         case when (select count(*) from core.roles where built_in) = 33 and (select count(distinct department) from core.roles) = 4 then 'PASS'
              else 'FAIL: ' || (select count(*) from core.roles where built_in) end
  union all select 3, 'role boxes: 341 rows, each role as in the chart',
         case when (select count(*) from core.role_access ra join core.roles ro on ro.id = ra.role_id where ro.built_in) = 341 then 'PASS'
              else 'FAIL: ' || (select count(*) from core.role_access) end
  union all select 4, 'exactly 1 admin role (Owner / Director)',
         case when (select count(*) from core.roles where is_admin) = 1 and exists (select 1 from core.roles where is_admin and code = 'owneradmin') then 'PASS' else 'FAIL' end
  union all select 5, 'no junk boxes (old screens, bd* flags, hidden tabs)',
         case when not exists (select 1 from core.access_items where active and code in ('ptapp','follow','india','prod','cx','link','kw','ba') or code like 'bd%') then 'PASS' else 'FAIL' end
  union all select 6, 'browsers can read no table in the core room (only their own boxes, through my_access)',
         case when not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                                where s.nspname = 'core' and c.relkind in ('r','v')
                                  and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select')
                                    or has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'insert')))
               and has_function_privilege('authenticated', 'core.my_access()', 'execute') then 'PASS' else 'FAIL' end
  union all select 9, 'my_access gives nobody anything when not signed in',
         case when (select count(*) from core.my_access()) = 0 then 'PASS' else 'FAIL' end
  union all select 10, '"check everyone" is refused unless signed in as an admin or Access viewer', r_all
  union all select 7, 'read rules on, who / when stamped and every change logged on all 5 tables',
         case when (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'core'
                     and c.relname in ('access_items','roles','role_access','people','person_access') and c.relrowsecurity) = 5
               and (select count(distinct tgrelid) from pg_trigger where tgname = 'zz_log' and tgrelid in
                     ('core.access_items'::regclass,'core.roles'::regclass,'core.role_access'::regclass,'core.people'::regclass,'core.person_access'::regclass)) = 5 then 'PASS' else 'FAIL' end
  union all select 8, 'no test rows left behind',
         case when not exists (select 1 from core.people where email like '%@ridhi.test') and not exists (select 1 from core.roles where code like 'test_%') then 'PASS' else 'FAIL' end
  union all select t.n, t.check_name, t.result from _t t
  ) x order by x.n;
end $fn$;
revoke all on function core.access_checks() from public, anon, authenticated;
grant execute on function core.access_checks() to service_role;

-- tell the Data API about the new tables / functions now (so the check page sees them at once)
notify pgrst, 'reload schema';

-- ===================================================================== 6 · run the checks: every row must say PASS
select * from core.access_checks();

-- To see the chart after the run (on its own):
--   select r.department, r.team, r.name, count(ra.item_key) as boxes
--     from core.roles r left join core.role_access ra on ra.role_id = r.id group by 1,2,3, r.sort order by r.sort;
