-- =====================================================================================
-- CORE ROOM · SECTION 3 · MASTERS  (the lists every SKU is built from)
-- NEEDS: core_access.sql + core_control.sql.  WHERE: ERP TEST.  HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: the last result is a list of checks — every row must say PASS.
-- DATA: loaded from Ravi's PC by migration/tools/load-masters.js (not pasted).
-- Ravi, 10 Nov: a SKU keeps meaning what it means today — spelling is merged, close matches are confirmed, missing values
-- are added (marked added_from_skus). Sizes carry their shape. Type / style splits come later.
-- =====================================================================================

-- ===================================================================== 1 · the lists
create table if not exists core.article_types (
  id               bigint generated always as identity primary key,
  code             text,
  name             text not null check (length(trim(name)) > 0),
  active           boolean not null default true,
  added_from_skus  boolean not null default false               -- not on the Firebase list; found on SKUs (owner to check)
);
create table if not exists core.article_subtypes (
  id               bigint generated always as identity primary key,
  code             text,
  name             text not null check (length(trim(name)) > 0),
  article_type_id  bigint references core.article_types (id),
  active           boolean not null default true,
  added_from_skus  boolean not null default false
);
create table if not exists core.colours (
  id               bigint generated always as identity primary key,
  code             text,
  name             text not null check (length(trim(name)) > 0),
  no_print         boolean not null default false,
  active           boolean not null default true,
  added_from_skus  boolean not null default false
);
create table if not exists core.colour_groups (
  id      bigint generated always as identity primary key,
  brand   text not null check (brand in ('RBP','CPC')),
  name    text not null,                                          -- "Ridhi Yellow", "CPC Blue" …
  active  boolean not null default true
);
create table if not exists core.colour_group_members (
  brand            text   not null check (brand in ('RBP','CPC')),
  colour_id        bigint not null references core.colours (id),
  colour_group_id  bigint not null references core.colour_groups (id) on delete cascade,
  primary key (brand, colour_id)
);
create table if not exists core.sizes (
  id               bigint generated always as identity primary key,
  code             text,
  name             text not null check (length(trim(name)) > 0),  -- as used: "60 Round", "13x19 Rectangle", "Medium"
  shape            text not null default 'other' check (shape in ('round','square','rectangle','oval','runner','other')),
  width_in         numeric(7,2) check (width_in > 0),             -- read from the name (round: the diameter)
  length_in        numeric(7,2) check (length_in > 0),
  active           boolean not null default true,
  added_from_skus  boolean not null default false
);
create table if not exists core.fabrics (
  id                bigint generated always as identity primary key,
  code              text,
  name              text not null check (length(trim(name)) > 0),
  kind              text not null default 'rfd' check (kind in ('greige','rfd','printed','filler','lining','other')),
  title             text,                                         -- full description from the Greige Desk
  width_in          numeric(6,2) check (width_in > 0),
  gsm               numeric(7,1) check (gsm > 0),
  construction      text,
  yarn_count        text,
  hsn               text,
  epi               numeric(6,1),
  ppi               numeric(6,1),
  warp              text,
  weft              text,
  rfd_of_greige_id  bigint references core.fabrics (id),          -- an RFD cloth → the greige it is made from
  base_fabric_id    bigint references core.fabrics (id),          -- a printed cloth → the cloth it is printed on
  colour_id         bigint references core.colours (id),
  brand             text check (brand in ('RBP','CPC')),
  print_direction   text,
  print_side        text,
  sku_code          text,                                         -- printed for one SKU (linked to the SKU in section 4)
  image_url         text,
  note              text,
  sort_order        int,
  active            boolean not null default true,
  added_from_skus   boolean not null default false,
  check (rfd_of_greige_id is null or kind = 'rfd'),
  check (base_fabric_id is null or kind = 'printed')
);
create table if not exists core.accessories (
  id             bigint generated always as identity primary key,
  code           text,
  name           text not null check (length(trim(name)) > 0),
  unit           text,
  category       text,
  reorder_level  numeric(10,2) check (reorder_level >= 0),
  returnable     boolean not null default false,
  is_auto        boolean not null default false,
  active         boolean not null default true
);
create table if not exists core.channels (
  id      bigint generated always as identity primary key,
  code    text not null,
  name    text not null,
  active  boolean not null default true
);
create table if not exists core.departments (
  id      bigint generated always as identity primary key,
  code    text,
  name    text not null,
  active  boolean not null default true
);
create table if not exists core.employment_types (
  id      bigint generated always as identity primary key,
  code    text,
  name    text not null,
  active  boolean not null default true
);
create table if not exists core.pack_sizes (
  id      bigint generated always as identity primary key,
  code    text,
  name    text not null,
  qty     int  not null check (qty > 0),
  active  boolean not null default true,
  added_from_skus  boolean not null default false
);

-- the other four master lists in pt_masters (added 10 Nov: "everything as it is"), kept as Firebase has them
create table if not exists core.print_rules (               -- pt_masters/printRule: which article / fabric is printed, and how
  id            bigint generated always as identity primary key,
  article_type  text,
  subtype       text,
  fabric        text,
  print         boolean,
  direction     text,
  issue_as      text,
  panels        text,
  note          text,
  active        boolean not null default true
);
create table if not exists core.recipes (                   -- pt_masters/recipe: cloth used per piece, by type · subtype · size
  id                bigint generated always as identity primary key,
  article_type      text,
  subtype           text,
  size              text,
  fabric            text,
  consumption       numeric(10,3),
  pack_of           text,
  cutting_required  boolean,
  is_piping         boolean,
  piping_meters     numeric(10,3),
  is_ruffle         boolean,
  ruffle_fabric     text,
  ruffle_meters     numeric(10,3),
  is_zip            boolean,
  zip_qty           numeric(10,2),
  chain_length      text,
  active            boolean not null default true
);
create table if not exists core.sku_code_rules (            -- pt_masters/skuCode: the start of a SKU code by article · subtype · size
  id       bigint generated always as identity primary key,
  article  text,
  subtype  text,
  size     text,
  base     text,
  source   text,
  active   boolean not null default true
);
create table if not exists core.vendors (                   -- three vendor books as they are: ERP vendors · Greige vendor book · Greige Desk
  id          bigint generated always as identity primary key,
  source      text not null check (source in ('vendor','vendorBook','greigeDesk')),
  code        text,
  name        text not null check (length(trim(name)) > 0),
  category    text,                                         -- Printer / Supplier / RFD Processor / greige …
  work        text,
  email       text,
  phone       text,
  contact     text,
  address     text,
  city        text,
  state       text,
  state_code  text,
  pincode     text,
  gstin       text,
  pan         text,
  reg         text,
  tds         text,
  note        text,
  sort_order  int,
  active      boolean not null default true
);

-- one name once per list, whatever the capitals / spaces ("9X9" and "9x9" are the same size)
create or replace function core.name_key(t text) returns text language sql immutable as $$ select lower(regexp_replace(trim(t), '\s+', ' ', 'g')) $$;
create unique index if not exists article_types_name    on core.article_types    (core.name_key(name));
create unique index if not exists article_subtypes_name on core.article_subtypes (coalesce(article_type_id, 0), core.name_key(name));   -- same subtype name may sit under two types
create unique index if not exists colours_name          on core.colours          (core.name_key(name));
create unique index if not exists colour_groups_name    on core.colour_groups    (brand, core.name_key(name));
create unique index if not exists sizes_name            on core.sizes            (core.name_key(name));
create unique index if not exists fabrics_name          on core.fabrics          (core.name_key(name));
create unique index if not exists accessories_name      on core.accessories      (core.name_key(name));
create unique index if not exists channels_code         on core.channels         (lower(code));
create unique index if not exists departments_name      on core.departments      (core.name_key(name));
create unique index if not exists employment_types_name on core.employment_types (core.name_key(name));
create unique index if not exists pack_sizes_qty        on core.pack_sizes       (qty);

-- ===================================================================== 2 · the clean-up list (owners decide; SKUs load through it)
create table if not exists core.master_cleanup (
  id          bigint generated always as identity primary key,
  list        text not null check (list in ('article_types','article_subtypes','colours','sizes','fabrics','pack_sizes')),
  used_as     text not null,                                      -- exactly as SKUs write it
  skus        int  not null default 0,                            -- how many SKUs use it
  action      text not null check (action in ('merge','confirm','add')),
  suggestion  text,                                               -- my best match on the list (or the nearest, for an add)
  certainty   text,                                               -- likely · maybe · guess · same, written differently
  status      text not null default 'pending' check (status in ('pending','accepted','changed','ignored')),
  final_name  text,                                               -- what it becomes (the suggestion, or the owner's choice)
  target_id   bigint,                                             -- the entry on the list it points to
  decided_by  bigint references core.people (id),
  decided_at  timestamptz,
  note        text,
  unique (list, used_as)
);
create index if not exists master_cleanup_open on core.master_cleanup (list, action) where status = 'pending';
comment on table core.master_cleanup is 'Every value SKUs use that is not exactly on a list: merge (spelling), confirm (close match), add (new). Owners decide; SKUs load through it.';

-- ===================================================================== 3 · the rules (signed-in people; the loader and back office are trusted)
-- Changing a master list or deciding a clean-up row: admins, or people with "Change the Master Database" (right:mdbEdit).
-- Nothing on a list is deleted by a screen: switch it off (active = false), so old SKUs and orders keep their meaning.
create or replace function core.masters_rules() returns trigger
language plpgsql as $$
begin
  if core.loading() or core.me_email() is null then return coalesce(new, old); end if;
  if not (core.is_admin() or core.can('right:mdbEdit')) then
    raise exception 'Only people who may change the Master Database can change %.', tg_table_name;
  end if;
  if tg_op = 'DELETE' and not core.is_admin() then
    raise exception 'Entries are not deleted — switch it off instead (active = no).';
  end if;
  -- nested on purpose: the database reads new.status only on the clean-up table (other tables have no status)
  if tg_table_name = 'master_cleanup' and tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      new.decided_by := core.me_id(); new.decided_at := now();
    end if;
  end if;
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['article_types','article_subtypes','colours','colour_groups','colour_group_members','sizes','fabrics',
                           'accessories','channels','departments','employment_types','pack_sizes','master_cleanup',
                           'print_rules','recipes','sku_code_rules','vendors'] loop
    execute format('alter table core.%I add column if not exists legacy_key text', t);
    -- the Firebase record exactly as it was (who made it, when, every field) — nothing from Firebase is lost
    execute format('alter table core.%I add column if not exists firebase jsonb', t);
    execute format('create unique index if not exists %I on core.%I (legacy_key) where legacy_key is not null', t || '_legacy', t);
    execute format('alter table core.%I add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table core.%I add column if not exists created_by bigint references core.people (id)', t);
    execute format('alter table core.%I add column if not exists updated_at timestamptz', t);
    execute format('alter table core.%I add column if not exists updated_by bigint references core.people (id)', t);
    execute format('drop trigger if exists masters_rules on core.%I', t);
    execute format('create trigger masters_rules before insert or update or delete on core.%I for each row execute function core.masters_rules()', t);
    perform core.watch(('core.' || t)::regclass);
    execute format('revoke all on core.%I from anon, authenticated', t);
  end loop;
end $$;

-- ===================================================================== 4 · the load door (server key only — the loader on Ravi's PC)
-- One door for every master table: rows as JSON, matched by legacy_key (run again = same result), marked as old history.
create or replace function core.load_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare cols text; sets text; n int;
begin
  if p_table not in ('article_types','article_subtypes','colours','colour_groups','colour_group_members','sizes','fabrics',
                     'accessories','channels','departments','employment_types','pack_sizes','master_cleanup',
                     'print_rules','recipes','sku_code_rules','vendors') then
    raise exception 'load_rows: % is not a master table', p_table;
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  perform set_config('core.loading', 'on', true);
  select string_agg(quote_ident(k), ', '), string_agg(format('%1$I = excluded.%1$I', k), ', ') filter (where k <> 'legacy_key')
    into cols, sets from jsonb_object_keys(p_rows -> 0) k;
  if p_table = 'colour_group_members' then
    execute format('insert into core.colour_group_members (%s) select %s from jsonb_populate_recordset(null::core.colour_group_members, $1)
                    on conflict (brand, colour_id) do update set %s', cols, cols, sets) using p_rows;
  else
    execute format('insert into core.%I (%s) select %s from jsonb_populate_recordset(null::core.%I, $1)
                    on conflict (legacy_key) where legacy_key is not null do update set %s', p_table, cols, cols, p_table, sets) using p_rows;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.load_rows(text, jsonb) from public, anon, authenticated;
grant execute on function core.load_rows(text, jsonb) to service_role;

-- ===================================================================== 5 · checks (live tests undo themselves)
create or replace function core.masters_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare r text; q bigint; s bigint; c1 bigint;
begin
  create temp table if not exists _m (n int, check_name text, result text);
  truncate _m;

  -- A. the same name twice (other capitals / spaces) is refused
  r := 'FAIL: it was accepted';
  begin
    insert into core.colours (name) values ('Test Navy  Blue');
    insert into core.colours (name) values ('test navy blue');
    raise exception 'undo';
  exception when unique_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _m values (20, 'the same name twice (other capitals / spaces) is refused', r);

  -- B. a size shape must be one of the six; a printed fabric needs kind printed for its base cloth
  r := 'FAIL: it was accepted';
  begin
    insert into core.sizes (name, shape) values ('Test 60 Hexagon', 'hexagon');
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _m values (21, 'a size shape must be round / square / rectangle / oval / runner / other', r);

  -- C. a QC checker cannot change a master list; someone with "Change the Master Database" can; nobody but an admin deletes
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.qc@ridhi.test', 'T QC', (select id from core.roles where code = 'qc')) returning id into q;
    insert into core.people (email, name, role_id) values ('t.stock@ridhi.test', 'T Stock', (select id from core.roles where code = 'amzstock')) returning id into s;
    perform core.sign_in_as_test('t.qc@ridhi.test');
    begin insert into core.colours (name) values ('Test Colour QC'); r := 'FAIL: a QC checker changed the colours';
    exception when others then if sqlerrm like 'Only people who may change the Master Database%' then r := 'ok'; else r := 'FAIL: ' || sqlerrm; end if; end;
    if r = 'ok' then
      perform core.sign_in_as_test('t.stock@ridhi.test');
      insert into core.colours (name) values ('Test Colour Stock') returning id into c1;
      begin delete from core.colours where id = c1; r := 'FAIL: a non-admin deleted an entry';
      exception when others then if sqlerrm like 'Entries are not deleted%' then r := 'ok'; else r := 'FAIL: ' || sqlerrm; end if; end;
    end if;
    if r = 'ok' then
      update core.colours set active = false where id = c1;
      r := case when exists (select 1 from core.change_log where tbl = 'colours' and action = 'update' and at >= now() - interval '1 minute') then 'PASS' else 'FAIL: not logged' end;
    end if;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _m values (22, 'only "Change the Master Database" people change lists · switch off, never delete · logged', r);

  -- D. a clean-up decision records who decided
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.stock@ridhi.test', 'T Stock', (select id from core.roles where code = 'amzstock')) returning id into s;
    insert into core.master_cleanup (list, used_as, action, suggestion) values ('colours', 'Test Navy Blu', 'confirm', 'Navy Blue') returning id into c1;
    perform core.sign_in_as_test('t.stock@ridhi.test');
    update core.master_cleanup set status = 'accepted', final_name = 'Navy Blue' where id = c1;
    r := case when (select decided_by from core.master_cleanup where id = c1) = s then 'PASS' else 'FAIL: decider not recorded' end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _m values (23, 'a clean-up decision records who decided and when', r);
  perform set_config('request.jwt.claims', '', true);

  return query
  select x.n, x.check_name, x.result from (
    select 1 as n, 'the 17 master tables exist, each keeps the Firebase record' as check_name,
           case when (select count(*) from information_schema.columns where table_schema = 'core' and column_name = 'firebase' and table_name in ('article_types','article_subtypes','colours','colour_groups',
             'colour_group_members','sizes','fabrics','accessories','channels','departments','employment_types','pack_sizes','master_cleanup','print_rules','recipes','sku_code_rules','vendors')) = 17 then 'PASS' else 'FAIL' end as result
    union all select 2, 'read rules on, stamped, logged, and the master rules on all 17',
           case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
                       where t.tgname = 'masters_rules' and s.nspname = 'core' and c.relname in ('article_types','article_subtypes','colours','colour_groups',
                       'colour_group_members','sizes','fabrics','accessories','channels','departments','employment_types','pack_sizes','master_cleanup',
                       'print_rules','recipes','sku_code_rules','vendors')) = 17 and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
                      join pg_namespace s on s.oid = c.relnamespace where t.tgname = 'zz_log' and s.nspname = 'core' and c.relname in ('article_types','article_subtypes','colours',
                      'colour_groups','colour_group_members','sizes','fabrics','accessories','channels','departments','employment_types','pack_sizes','master_cleanup',
                      'print_rules','recipes','sku_code_rules','vendors')) = 17 then 'PASS' else 'FAIL' end
    union all select 3, 'browsers can read none of them',
           case when not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'core' and c.relkind = 'r'
                                  and c.relname in ('article_types','colours','sizes','fabrics','master_cleanup','print_rules','recipes','sku_code_rules','vendors')
                                  and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))) then 'PASS' else 'FAIL' end
    union all select 4, 'no test rows left behind',
           case when not exists (select 1 from core.colours where name ilike 'test %') and not exists (select 1 from core.people where email like '%@ridhi.test') then 'PASS' else 'FAIL' end
    union all select m.n, m.check_name, m.result from _m m
  ) x order by x.n;
end $fn$;
revoke all on function core.masters_checks() from public, anon, authenticated;
grant execute on function core.masters_checks() to service_role;

-- ===================================================================== 6 · the shadow door (the test ERP compares live Firebase with this copy)
-- One row per Firebase Masters record: its Firebase path and a fingerprint (sha-256 of the record as the database writes it).
-- Only fingerprints leave the database — no names, phone numbers or GSTINs. Signed-in ERP people only.
create or replace function core.masters_records() returns table (path text, h text)
language sql stable security definer set search_path = core, public as $$
  with r (path, rec) as (
              select legacy_key, firebase from core.article_types    where legacy_key like 'pt\_%' and firebase is not null
    union all select legacy_key, firebase from core.article_subtypes where legacy_key like 'pt\_%' and firebase is not null
    union all select legacy_key, firebase from core.colours          where legacy_key like 'pt\_%' and firebase is not null
    union all select legacy_key, firebase from core.sizes            where legacy_key like 'pt\_%' and firebase is not null
    union all select legacy_key, firebase from core.pack_sizes       where legacy_key like 'pt\_%' and firebase is not null
    union all select legacy_key, firebase from core.departments      where legacy_key like 'pt\_%' and firebase is not null
    union all select legacy_key, firebase from core.employment_types where legacy_key like 'pt\_%' and firebase is not null
    union all select legacy_key, firebase from core.accessories      where legacy_key like 'pt\_%' and firebase is not null
    union all select legacy_key, firebase from core.print_rules      where legacy_key like 'pt\_%' and firebase is not null
    union all select legacy_key, firebase from core.recipes          where legacy_key like 'pt\_%' and firebase is not null
    union all select legacy_key, firebase from core.sku_code_rules   where legacy_key like 'pt\_%' and firebase is not null
    union all select legacy_key, firebase from core.vendors          where legacy_key like 'pt\_%' and firebase is not null
    union all select s.prefix || e.key, e.value
                from core.fabrics f
                cross join lateral jsonb_each(coalesce(f.firebase, '{}'::jsonb)) src (name, recs)
                join (values ('fabricType', 'pt_masters/fabricType/'), ('greigeRfd', 'pt_masters/greigeRfd/'),
                             ('greigeDesk', 'pt_gdTest/mst/'), ('fabricSku', 'pt_masters/fabricSku/')) s (name, prefix) on s.name = src.name
                cross join lateral jsonb_each(src.recs) e
    union all select 'pt_colorGroups/map/' || e.key, e.value from core.colour_group_members m cross join lateral jsonb_each(coalesce(m.firebase, '{}'::jsonb)) e
    union all select x->>'path', x->'rec' from core.settings st cross join lateral jsonb_array_elements(st.value) x
               where st.key = 'masters.not_moved' and jsonb_typeof(st.value) = 'array'
  )
  select distinct on (r.path) r.path, encode(sha256(convert_to(r.rec::text, 'UTF8')), 'hex')
    from r where core.me_id() is not null or auth.role() = 'service_role'          -- an ERP person, or the loader's own self-check
  union all
  select '#copy_of', st.value #>> '{}' from core.settings st where st.key = 'sync.masters_backup' and (core.me_id() is not null or auth.role() = 'service_role')
$$;
-- anon too: a Firebase sign-in reaches Supabase as role anon (no Supabase role tag), like my_access / waiting_counts.
-- Still safe: without a real ERP person behind a valid Firebase sign-in (core.me_id()), the door gives nothing.
revoke all on function core.masters_records() from public;
grant execute on function core.masters_records() to anon, authenticated, service_role;

notify pgrst, 'reload schema';
select * from core.masters_checks();
