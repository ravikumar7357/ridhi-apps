-- =====================================================================================
-- FILE 000 · THE ROOMS  (R-one Floor Plan, rooms 01–08)
-- WHERE: the test project "erp-test" first. The top bar must say erp-test.
-- BEFORE: on a NEW test project run shopify-os/supabase/steps/01_stores.sql once (it makes the brands RBP / CPC).
-- HOW:   SQL Editor → New query → paste this WHOLE file → Run. Safe to run again.
-- CHECK: the last result is a list of checks: every row must say PASS.
--
-- Makes:
--   7 rooms ............ core · erp · sellora · raw · staging · reports · archive   (Shopify stays in public)
--   locks .............. browsers get nothing in any room until a screen moves and gets its own rule
--   core.change_log .... every insert / update / delete, written by the database itself
--   archive.change_log_archive ... the old Firebase change log (last month)
--   staging.load_issues  every Firebase row that could not be loaded, and why
--   staging.map_values . clean-up lists: typed text → the right row ("Navy Blu" → NAVY-BLUE)
--   helpers ............ core.loading() · core.me_email() · core.me_id() · core.stamp() · core.log_change() · core.watch()
-- Touches nothing in public (Shopify).
-- =====================================================================================

-- ----------------------------------------------------------------- the rooms
create schema if not exists core;     comment on schema core    is 'Shared by every app: people, rights, masters, SKUs, vendors.';
create schema if not exists erp;      comment on schema erp     is 'The factory: orders, production, stock, purchasing, hr, costing.';
create schema if not exists sellora;  comment on schema sellora is 'Amazon: order lines, listings, planning.';
create schema if not exists raw;      comment on schema raw     is 'Data exactly as it arrived (Firebase, sheets). Never edited.';
create schema if not exists staging;  comment on schema staging is 'Cleaning desk: clean-up lists and load problems.';
create schema if not exists reports;  comment on schema reports is 'Ready answers for screens, calculated by the database.';
create schema if not exists archive;  comment on schema archive is 'Old history kept out of the way.';

-- ----------------------------------------------------------------- locks: browsers see nothing (yet)
do $$ declare s text; begin
  foreach s in array array['core','erp','sellora','raw','staging','reports','archive'] loop
    execute format('revoke all on schema %I from anon, authenticated', s);
    execute format('grant usage on schema %I to service_role', s);
    execute format('alter default privileges in schema %I revoke all on tables from anon, authenticated', s);
    execute format('alter default privileges in schema %I revoke all on functions from anon, authenticated', s);
    execute format('alter default privileges in schema %I grant all on tables to service_role', s);
    execute format('alter default privileges in schema %I grant all on sequences to service_role', s);
  end loop;
end $$;

-- ----------------------------------------------------------------- load switch
-- A bulk load runs:  select set_config('core.loading', 'on', true);
-- → Firebase dates and "who" are kept as they were, and the change log is not flooded.
create or replace function core.loading() returns boolean
language sql stable as $$ select coalesce(current_setting('core.loading', true), '') = 'on' $$;

-- ----------------------------------------------------------------- who is signed in
-- The same Google sign-in as the ERP and the Shopify hub (Firebase project price-research-48ff3).
create or replace function core.me_email() returns text
language sql stable as $$
  select case when auth.jwt()->>'iss' = 'https://securetoken.google.com/price-research-48ff3'
               and auth.jwt()->>'aud' = 'price-research-48ff3'
              then nullif(lower(trim(auth.jwt()->>'email')), '') end
$$;
-- core.me_id() is defined properly in 010 (it needs core.people). Placeholder until then:
do $$ begin
  if to_regprocedure('core.me_id()') is null then
    execute 'create function core.me_id() returns bigint language sql stable as $f$ select null::bigint $f$';
  end if;
end $$;

-- ----------------------------------------------------------------- change log (written by the database)
create table if not exists core.change_log (
  id        bigint generated always as identity primary key,
  room      text        not null,                    -- core / erp / sellora …
  tbl       text        not null,                    -- skus, cutting …
  row_id    bigint,                                  -- the row's id (null for tables keyed by text)
  action    text        not null check (action in ('insert','update','delete')),
  old       jsonb,                                   -- update: only the changed fields, old values
  new       jsonb,                                   -- update: only the changed fields, new values
  by_id     bigint,                                  -- core.people.id; null = system or loader
  by_email  text,
  at        timestamptz not null default now(),
  reason    text                                     -- a screen sets it: select set_config('core.reason', '…', true);
);
create index if not exists change_log_row on core.change_log (room, tbl, row_id, at desc);
create index if not exists change_log_at  on core.change_log (at desc);
alter table core.change_log enable row level security;
comment on table core.change_log is 'Every change in every room, written by the database. Nobody can edit or delete it from a screen.';

-- ----------------------------------------------------------------- old Firebase change log
create table if not exists archive.change_log_archive (
  id          bigint generated always as identity primary key,
  legacy_key  text not null unique,                  -- "2026-10/-Oabc…" (month / Firebase push id)
  at          timestamptz not null,
  by_email    text,
  kind        text,
  screen      text,                                  -- Firebase "tab"
  n           int,
  paths       jsonb,
  vals        jsonb
);
create index if not exists change_log_archive_at on archive.change_log_archive (at desc);
alter table archive.change_log_archive enable row level security;
comment on table archive.change_log_archive is 'Old Firebase change log (pt_audit). Last month here; all of it stays in raw and the Drive backups.';

-- ----------------------------------------------------------------- load problems + clean-up lists
create table if not exists staging.load_issues (
  id          bigint generated always as identity primary key,
  part        text not null,                         -- core / masters / orders …
  register    text not null,                         -- pt_masterDB …
  legacy_key  text,
  field       text,
  problem     text not null,                         -- unknown colour · duplicate SKU · bad date …
  value       text,
  detail      jsonb,
  load_run    text,
  at          timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  note        text
);
create index if not exists load_issues_open on staging.load_issues (part, register) where resolved_at is null;
alter table staging.load_issues enable row level security;
comment on table staging.load_issues is 'Rows that could not be loaded, and why. Rule: source rows = loaded + issues + listed skips.';

create table if not exists staging.map_values (
  list        text not null,                         -- colour · size · fabric · sku · employee · vendor · person …
  raw         text not null,                         -- exactly as typed in Firebase (trimmed)
  target_code text,                                  -- the right row's code (owners write codes, not ids)
  target_id   bigint,                                -- filled by the loader from target_code
  action      text not null default 'map' check (action in ('map','new','ignore')),
  note        text,
  decided_by  text,
  decided_at  timestamptz not null default now(),
  primary key (list, raw)
);
alter table staging.map_values enable row level security;
comment on table staging.map_values is 'Clean-up lists the owners fill. After each change the load is run again.';

-- ----------------------------------------------------------------- stamp: who / when on every row
-- Every table has created_at, created_by, updated_at, updated_by.
-- Screens never type them. The loader may (Firebase dates and people are kept).
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

-- ----------------------------------------------------------------- log: one change_log row per change
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

-- ----------------------------------------------------------------- watch(table): rules on + stamp + log
-- Every later file calls  select core.watch('core.people');  for each of its tables.
create or replace function core.watch(t regclass) returns void
language plpgsql as $$
declare s text; n text;
begin
  select ns.nspname, c.relname into s, n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where c.oid = t;
  execute format('alter table %s enable row level security', t);
  execute format('drop trigger if exists zz_stamp on %s', t);
  if (select count(*) from information_schema.columns where table_schema = s and table_name = n
        and column_name in ('created_at','created_by','updated_at','updated_by')) = 4 then
    execute format('create trigger zz_stamp before insert or update on %s for each row execute function core.stamp()', t);
  end if;
  execute format('drop trigger if exists zz_log on %s', t);
  execute format('create trigger zz_log after insert or update or delete on %s for each row execute function core.log_change()', t);
end $$;

revoke all on function core.watch(regclass) from public, anon, authenticated;
revoke all on function core.log_change()    from public, anon, authenticated;

-- ----------------------------------------------------------------- checks: every row must say PASS
select n, check_name, result from (values
  (1, '7 rooms exist',
      case when (select count(*) from pg_namespace where nspname in ('core','erp','sellora','raw','staging','reports','archive')) = 7 then 'PASS' else 'FAIL' end),
  (2, 'browsers cannot enter any room',
      case when not exists (select 1 from unnest(array['core','erp','sellora','raw','staging','reports','archive']) s
                            where has_schema_privilege('anon', s, 'usage') or has_schema_privilege('authenticated', s, 'usage')) then 'PASS' else 'FAIL' end),
  (3, 'change log, archive, load problems, clean-up lists exist',
      case when to_regclass('core.change_log') is not null and to_regclass('archive.change_log_archive') is not null
            and to_regclass('staging.load_issues') is not null and to_regclass('staging.map_values') is not null then 'PASS' else 'FAIL' end),
  (4, 'read rules on for those 4 tables',
      case when (select bool_and(relrowsecurity) from pg_class where oid in ('core.change_log'::regclass, 'archive.change_log_archive'::regclass,
                 'staging.load_issues'::regclass, 'staging.map_values'::regclass)) then 'PASS' else 'FAIL' end),
  (5, 'helpers exist',
      case when to_regprocedure('core.loading()') is not null and to_regprocedure('core.me_email()') is not null and to_regprocedure('core.me_id()') is not null
            and to_regprocedure('core.stamp()') is not null and to_regprocedure('core.log_change()') is not null and to_regprocedure('core.watch(regclass)') is not null then 'PASS' else 'FAIL' end),
  (6, 'brands list is there (RBP, CPC in public.stores)',
      case when to_regclass('public.stores') is not null and (select count(*) from public.stores where id in ('RBP','CPC')) = 2 then 'PASS' else 'FAIL — run steps/01_stores.sql first' end),
  (7, 'nothing of the ERP was put in public (Shopify)',
      case when not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                            where s.nspname = 'public' and c.relname in ('change_log','load_issues','map_values','change_log_archive')) then 'PASS' else 'FAIL' end)
) as c(n, check_name, result) order by n;
