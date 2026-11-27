-- =====================================================================================
-- CORE ROOM · SECTION 1 · ACCESS  (who may open / do what)
-- GENERATED from core_access.template.sql by migration/tools/make-access-sql.js — edit the template, not this file.
-- WHERE: the ERP TEST project (top bar must say ERP TEST). Runs on its own: nothing else needs to be run first.
-- HOW:   SQL Editor → New query → paste this WHOLE file → Run. Safe to run again (it brings roles back to the chart).
-- CHECK: the last result is a list of checks. Every row must say PASS. Send a screenshot.
-- START OVER (test only):  drop schema core cascade;
--
-- Makes (matches Sellora's Access page, role chart v2, 2 Nov 2026):
--   core.access_items ... every box: @@N_SELLORA@@ Sellora screens · @@N_ERP@@ ERP screens · @@N_RIGHT@@ extra rights
--   core.roles .......... @@N_ROLES@@ roles: department → group (team) → role, with Limit / Cannot notes
--   core.role_access .... @@N_ROLE_BOXES@@ role × box rows
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

@@BOXES@@

@@ROLES@@

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
  select 1 as n, 'boxes: @@N_SELLORA@@ Sellora + @@N_ERP@@ ERP + @@N_RIGHT@@ rights' as check_name,
         case when (select count(*) from core.access_items where active and app = 'sellora') = @@N_SELLORA@@
               and (select count(*) from core.access_items where active and app = 'erp') = @@N_ERP@@
               and (select count(*) from core.access_items where active and app = 'right') = @@N_RIGHT@@ then 'PASS'
              else 'FAIL: ' || (select string_agg(app || ' ' || n, ', ') from (select app, count(*) n from core.access_items where active group by app) x) end as result
  union all select 2, 'roles: @@N_ROLES@@ from the chart, in 4 departments',
         case when (select count(*) from core.roles where built_in) = @@N_ROLES@@ and (select count(distinct department) from core.roles) = 4 then 'PASS'
              else 'FAIL: ' || (select count(*) from core.roles where built_in) end
  union all select 3, 'role boxes: @@N_ROLE_BOXES@@ rows, each role as in the chart',
         case when (select count(*) from core.role_access ra join core.roles ro on ro.id = ra.role_id where ro.built_in) = @@N_ROLE_BOXES@@ then 'PASS'
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
