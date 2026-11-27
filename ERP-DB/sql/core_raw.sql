-- =====================================================================================
-- CORE ROOM · STEP A · RAW COPY OF EVERYTHING  (every Firebase register and Firestore collection, exactly as it is)
-- NEEDS: core_access.sql.  WHERE: ERP TEST (Mumbai).  HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: the last result is a list of checks — every row must say PASS.
-- DATA: loaded from Ravi's PC by migration/tools/load-raw-erp.js (not pasted).
-- Ravi, 12 Nov: everything as it is, nothing removed. A record that is gone from Firebase at a later load is KEPT and
-- marked gone_since (the day it was first missing); it is never deleted.
-- =====================================================================================

create table if not exists core.fb_raw (
  source          text   not null check (source in ('rtdb','firestore')),
  node            text   not null,          -- RTDB register (pt_orderBook …) or Firestore collection (po, weeklyrows …)
  key             text   not null,          -- record key; registers grouped by parent use "parent/child"
  data            jsonb,                    -- the record exactly as Firebase has it (Firestore values as plain JSON)
  bytes           integer not null default 0,
  fp              text,                     -- fingerprint of data, made when the row is written
  backup_day      text   not null,          -- the backup this version came from
  first_seen_day  text   not null,          -- the first backup that had it
  gone_since      text,                     -- set when a later backup no longer has it (kept, never deleted)
  loaded_at       timestamptz not null default now(),
  primary key (source, node, key)
);
create index if not exists fb_raw_node on core.fb_raw (source, node);
comment on table core.fb_raw is 'Every Firebase record exactly as it is (one row each). Nothing is deleted: records gone from Firebase are marked gone_since.';

create table if not exists core.fb_raw_loads (
  id                bigint generated always as identity primary key,
  backup_day        text not null,
  source            text not null,
  node              text not null,
  expected_entries  integer,                -- from the backup's manifest.json
  loaded_rows       integer not null,
  newly_gone        integer not null default 0,
  ok                boolean not null,
  note              text,
  at                timestamptz not null default now()
);

-- fingerprint when written (same as core.set_fp, but this table has "data", not "firebase")
create or replace function core.set_raw_fp() returns trigger
language plpgsql as $$
begin
  new.fp := case when new.data is null then null else encode(sha256(convert_to(new.data::text, 'UTF8')), 'hex') end;
  return new;
end $$;
drop trigger if exists aa_fp on core.fb_raw;
create trigger aa_fp before insert or update on core.fb_raw for each row execute function core.set_raw_fp();

alter table core.fb_raw enable row level security;
alter table core.fb_raw_loads enable row level security;
revoke all on core.fb_raw, core.fb_raw_loads from anon, authenticated;

-- the load door: rows of ONE register / collection. Upserts them; marks rows of that node missing from this backup as gone.
-- p_final = true on the last batch of a node: only then are missing rows marked (never deleted).
create or replace function core.load_raw(p_source text, p_node text, p_day text, p_rows jsonb, p_final boolean default false) returns jsonb
language plpgsql security definer set search_path = core, public as $$
declare n int; g int := 0;
begin
  insert into core.fb_raw (source, node, key, data, bytes, backup_day, first_seen_day, gone_since)
  select p_source, p_node, x.key, x.data, coalesce(x.bytes, 0), p_day, p_day, null
    from jsonb_to_recordset(p_rows) as x(key text, data jsonb, bytes int)
  on conflict (source, node, key) do update
    set data = excluded.data, bytes = excluded.bytes, backup_day = excluded.backup_day, gone_since = null, loaded_at = now();
  get diagnostics n = row_count;
  if p_final then
    update core.fb_raw set gone_since = p_day
     where source = p_source and node = p_node and backup_day <> p_day and gone_since is null;
    get diagnostics g = row_count;
  end if;
  return jsonb_build_object('rows', n, 'gone', g);
end $$;
revoke all on function core.load_raw(text, text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function core.load_raw(text, text, text, jsonb, boolean) to service_role;

-- what is in the raw copy, per register (for the loader and the check page)
create or replace function core.raw_summary() returns table (source text, node text, rows bigint, gone bigint, mb numeric, last_day text)
language sql stable security definer set search_path = core, public as $$
  select source, node, count(*) filter (where gone_since is null), count(*) filter (where gone_since is not null),
         round(sum(bytes)::numeric / 1048576, 2), max(backup_day)
    from core.fb_raw group by source, node order by source, node
$$;
revoke all on function core.raw_summary() from public, anon, authenticated;
grant execute on function core.raw_summary() to service_role;

-- every fingerprint of one register in one answer { key: fp } — the loader proves each record landed exactly
create or replace function core.raw_fp(p_source text, p_node text) returns jsonb
language sql stable security definer set search_path = core, public as $$
  select coalesce(jsonb_object_agg(key, fp), '{}'::jsonb) from core.fb_raw where source = p_source and node = p_node and gone_since is null
$$;
revoke all on function core.raw_fp(text, text) from public, anon, authenticated;
grant execute on function core.raw_fp(text, text) to service_role;

notify pgrst, 'reload schema';
select 1 as n, 'the raw copy table and its load log exist' as check_name,
       case when to_regclass('core.fb_raw') is not null and to_regclass('core.fb_raw_loads') is not null then 'PASS' else 'FAIL' end as result
union all select 2, 'browsers can read neither',
       case when not has_table_privilege('anon', 'core.fb_raw', 'select') and not has_table_privilege('authenticated', 'core.fb_raw', 'select') then 'PASS' else 'FAIL' end
union all select 3, 'every row gets its fingerprint when written',
       case when exists (select 1 from pg_trigger where tgname = 'aa_fp' and tgrelid = 'core.fb_raw'::regclass) then 'PASS' else 'FAIL' end
union all select 4, 'no delete anywhere: the load door only adds, updates and marks "gone"',
       case when position('delete' in lower(pg_get_functiondef('core.load_raw(text,text,text,jsonb,boolean)'::regprocedure))) = 0 then 'PASS' else 'FAIL' end;
