-- =====================================================================================
-- SECTION 10 · HISTORY — schema history: the ERP's change log (pt_audit) and recycle bin (pt_trash), as they are.
-- Ravi, 13 Nov: design page migration/history-design.html, D1–D5 all OK.
--   history.audit_entries  one row per save (pt_audit/<month>/<id>) — the Firebase record whole in `firebase`
--   history.audit_changes  one row per record that save changed: its path, and the value written (= `firebase`)
--   history.recycle_bin    one row per deleted record (pt_trash/<id>)
-- The history of any moved row = audit_changes where path = that row's legacy_key.
-- NEEDS: core (access, control).  WHERE: ERP TEST (Mumbai).  HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: the last result is a list of checks — every row must say PASS.  Then: Data API → Exposed schemas → tick "history".
-- DATA: loaded from Ravi's PC by migration/tools/load-history.js (rows built by make-history.js).
-- =====================================================================================

create schema if not exists history;
revoke all on schema history from public, anon, authenticated;
grant usage on schema history to service_role;
alter default privileges in schema history revoke all on tables from anon, authenticated;
alter default privileges in schema history grant all on tables to service_role;
alter default privileges in schema history grant all on sequences to service_role;

create table if not exists history.audit_entries (
  id          bigint generated always as identity primary key,
  month       text,          -- the month key in Firebase (2026-10)
  entry_id    text,          -- the entry key
  at_time     timestamptz,   -- at
  by_email    text,          -- by (as written)
  tab         text,          -- tab: the ERP screen
  kind        text,          -- kind: put / patch / delete
  n           numeric,       -- n: how many paths
  note        text,          -- note
  paths       jsonb,         -- paths, as written (the values are in history.audit_changes)
  person_id   bigint references core.people (id),
  mark        text           -- D3: "paths and values not the same length" …
);
comment on table history.audit_entries is 'From Firebase: pt_audit — one row per ERP save. The whole Firebase record (with its values) is in column firebase.';

create table if not exists history.audit_changes (
  id              bigint generated always as identity primary key,
  audit_entry_id  bigint references history.audit_entries (id),
  place           int,       -- place in paths / vals
  path            text,      -- the Firebase path that was written (= legacy_key of the moved row)
  list            text,      -- its list (e.g. pt_baseDone)
  mark            text       -- D3: "value too big — the ERP kept its size only" · "no value at this place"
);
comment on table history.audit_changes is 'From Firebase: pt_audit · paths + vals — one row per record a save changed; the value written is in column firebase.';

create table if not exists history.recycle_bin (
  id           bigint generated always as identity primary key,
  trash_id     text,         -- the bin key
  at_time      timestamptz,  -- at
  by_email     text,         -- by
  tab          text,         -- tab
  why          text,         -- why: patch / delete
  path         text,         -- path of the deleted record
  list         text,         -- its list
  value        jsonb,        -- value: the deleted record as it was
  restored_at  timestamptz,  -- restoredAt
  restored_by  text,         -- restoredBy
  person_id    bigint references core.people (id)
);
comment on table history.recycle_bin is 'From Firebase: pt_trash — every record deleted in the ERP, as it was just before.';

do $$ declare t text; begin
  foreach t in array array['history.audit_entries', 'history.audit_changes', 'history.recycle_bin'] loop
    execute format('alter table %s add column if not exists legacy_key text', t);
    execute format('create unique index if not exists %I on %s (legacy_key) where legacy_key is not null', replace(t, '.', '_') || '_legacy', t);
    execute format('alter table %s add column if not exists firebase jsonb', t);
    execute format('alter table %s add column if not exists fp text', t);
    execute format('alter table %s add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table %s add column if not exists created_by bigint references core.people (id)', t);
    execute format('alter table %s add column if not exists updated_at timestamptz', t);
    execute format('alter table %s add column if not exists updated_by bigint references core.people (id)', t);
    execute format('drop trigger if exists aa_fp on %s', t);
    execute format('create trigger aa_fp before insert or update on %s for each row execute function core.set_fp()', t);
    execute format('drop trigger if exists sku_side_rules on %s', t);
    execute format('create trigger sku_side_rules before insert or update or delete on %s for each row execute function core.sku_side_rules()', t);
    perform core.watch(t::regclass);
    execute format('revoke all on %s from anon, authenticated', t);
    execute format('grant all on %s to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema history to service_role;
create index if not exists audit_entries_at on history.audit_entries (at_time);
create index if not exists audit_entries_by on history.audit_entries (by_email);
create index if not exists audit_changes_entry on history.audit_changes (audit_entry_id);
create index if not exists audit_changes_path on history.audit_changes (path);
create index if not exists audit_changes_list on history.audit_changes (list);
create index if not exists recycle_bin_path on history.recycle_bin (path);

-- ===================================================================== doors (server key; the fingerprint door also for the test ERP)
create or replace function core.history_tables() returns text[] language sql immutable as $$ select array['history.audit_entries', 'history.audit_changes', 'history.recycle_bin'] $$;
create or replace function core.load_history_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare cols text; sets text; n int;
begin
  if not (p_table = any (core.history_tables())) then raise exception 'load_history_rows: % is not a History table', p_table; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  perform set_config('core.loading', 'on', true);
  select string_agg(quote_ident(k), ', '), string_agg(format('%1$I = excluded.%1$I', k), ', ') filter (where k <> 'legacy_key')
    into cols, sets from jsonb_object_keys(p_rows -> 0) k;
  execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)
                  on conflict (legacy_key) where legacy_key is not null do update set %s', p_table, cols, cols, p_table, sets) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.load_history_rows(text, jsonb) from public, anon, authenticated;
grant execute on function core.load_history_rows(text, jsonb) to service_role;

insert into core.settings (key, value, note) values ('sync.history_backup', '"2026-11-12"', 'Which Firebase backup the History copy is from')
on conflict (key) do update set value = excluded.value;

-- fingerprints of the log entries and the bin, one answer { path: fp } — fingerprints only, never data
create or replace function core.history_fp() returns jsonb
language sql stable security definer set search_path = core, public as $$
  select case when core.me_id() is not null or auth.role() = 'service_role' or session_user = 'postgres' then (
    select coalesce(jsonb_object_agg(x.legacy_key, x.fp), '{}'::jsonb)
           || jsonb_build_object('#copy_of', (select st.value #>> '{}' from core.settings st where st.key = 'sync.history_backup'))
      from (select legacy_key, fp from history.audit_entries union all select legacy_key, fp from history.recycle_bin) x
     where x.legacy_key is not null and x.fp is not null) end
$$;
revoke all on function core.history_fp() from public;
grant execute on function core.history_fp() to anon, authenticated, service_role;

-- the history of one record: every save that wrote it, newest first (for later read doors and the check page)
create or replace function core.history_of(p_path text) returns table (at_time timestamptz, by_email text, tab text, kind text, path text, value jsonb)
language sql stable security definer set search_path = core, public as $$
  select e.at_time, e.by_email, e.tab, e.kind, c.path, c.firebase
    from history.audit_changes c join history.audit_entries e on e.id = c.audit_entry_id
   where c.path = p_path or c.path like p_path || '/%' or p_path like c.path || '/%'
   order by e.at_time desc
$$;
revoke all on function core.history_of(text) from public, anon, authenticated;
grant execute on function core.history_of(text) to service_role;

create or replace function core.history_summary() returns table (item text, n bigint, of_n bigint)
language sql stable security definer set search_path = core, public as $$
  select 'history.audit_entries', count(*), null::bigint from history.audit_entries
  union all select 'history.audit_changes', count(*), null from history.audit_changes
  union all select 'history.recycle_bin', count(*), null from history.recycle_bin
  union all select 'link · log entry → person', count(*) filter (where person_id is not null), count(*) from history.audit_entries
  union all select 'link · change → its log entry', count(*) filter (where audit_entry_id is not null), count(*) from history.audit_changes
  union all select 'link · bin → person', count(*) filter (where person_id is not null), count(*) from history.recycle_bin
  union all select 'marked entries · marked changes', (select count(*) from history.audit_entries where mark is not null) + (select count(*) from history.audit_changes where mark is not null), null
$$;
revoke all on function core.history_summary() from public, anon, authenticated;
grant execute on function core.history_summary() to service_role;

create or replace function core.history_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare r text; q bigint; c1 bigint; fp_ok boolean;
begin
  fp_ok := jsonb_typeof(core.history_fp()) = 'object';
  create temp table if not exists _h2 (n int, check_name text, result text);
  truncate _h2;
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.histcheck@ridhi.test', 'T Hist Check', (select id from core.roles where code = 'qc')) returning id into q;
    perform core.sign_in_as_test('t.histcheck@ridhi.test');
    insert into history.recycle_bin (trash_id, why) values ('test', 'delete') returning id into c1;
    begin delete from history.recycle_bin where id = c1; r := 'FAIL: a non-admin deleted history';
    exception when others then if sqlerrm like 'Only an admin can delete%' then r := 'PASS'; else r := 'FAIL: ' || sqlerrm; end if; end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _h2 values (20, 'only an admin can delete history', r);
  perform set_config('request.jwt.claims', '', true);
  return query select x.n, x.check_name, x.result from (
    select 1 as n, 'the history schema and its 3 tables exist, each keeps the Firebase record and fingerprint' as check_name,
           case when (select count(*) from information_schema.columns where column_name = 'fp' and table_schema || '.' || table_name = any (core.history_tables())) = 3 then 'PASS' else 'FAIL' end as result
    union all select 2, 'rules, stamps and the change log on all 3',
           case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
                       where t.tgname in ('zz_log', 'sku_side_rules', 'aa_fp') and s.nspname || '.' || c.relname = any (core.history_tables())) = 9 then 'PASS' else 'FAIL' end
    union all select 3, 'browsers can read none of them, nor use the history schema',
           case when not exists (select 1 from unnest(core.history_tables()) t where has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select'))
                 and not has_schema_privilege('anon', 'history', 'usage') and not has_schema_privilege('authenticated', 'history', 'usage') then 'PASS' else 'FAIL' end
    union all select 4, 'browsers cannot use the load door or the history-of-a-record door',
           case when not has_function_privilege('anon', 'core.load_history_rows(text,jsonb)', 'execute') and not has_function_privilege('authenticated', 'core.history_of(text)', 'execute') and fp_ok then 'PASS' else 'FAIL' end
    union all select 5, 'no test rows left behind', case when not exists (select 1 from core.people where email like '%@ridhi.test') then 'PASS' else 'FAIL' end
    union all select h.n, h.check_name, h.result from _h2 h
  ) x order by x.n;
end $fn$;
revoke all on function core.history_checks() from public, anon, authenticated;
grant execute on function core.history_checks() to service_role;

notify pgrst, 'reload schema';
select * from core.history_checks();
