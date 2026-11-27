-- FIRESTORE LIVE COPY (Ravi, 14 Nov: "move everything which powered firebase … have the problem fixed").
-- Every Firestore document of BOTH Firebase projects — price-research-48ff3 (ERP + Sellora) and fabricrush-inventory (the
-- Inventory app) — kept here exactly as Firestore holds it, NEWEST version only (one row per document), kept up to date by
-- the Apps Script reader (migration/apps-script-reader). Nothing is ever deleted: a document Firestore no longer has gets
-- gone_at (and is cleared again if it comes back).
-- WHY: the nightly backup misses collections (repl, health, audit/costs, settings, dealrows, fba_*, shopify_cache …) and
-- the Inventory app's project is not backed up here at all. With this table every one of them is in Supabase, live, so
-- their sections can be designed and loaded from here (not from a backup), and nothing is lost when Firebase goes.
-- Only the newest version is kept (not a log): the Inventory app rewrites big chunks every 3 hours, a log would fill the
-- database. Who changed what stays in the inbox for the lists the engine builds.
create table if not exists core.fs_docs (
  project      text not null,                       -- price-research-48ff3 · fabricrush-inventory
  path         text not null,                       -- <collection>/<document id>
  coll         text not null,
  doc_id       text not null,
  value        jsonb,                               -- the document as plain JSON (as the backup is read by the loaders)
  update_time  timestamptz,                         -- Firestore's own update time of this version
  bytes        int,
  seen_at      timestamptz not null default now(),  -- when the reader last sent this version
  first_seen   timestamptz not null default now(),
  gone_at      timestamptz,                         -- Firestore no longer has it (the row stays)
  fp           text,
  primary key (project, path)
);
create index if not exists fs_docs_coll on core.fs_docs (project, coll);
comment on table core.fs_docs is 'Live copy of every Firestore document of both Firebase projects (newest version only), kept by the Apps Script reader. Rows are never deleted.';
alter table core.fs_docs enable row level security;            -- no browser reads or writes it (no policies)
revoke all on core.fs_docs from anon, authenticated;

-- the reader's door: newest versions in, vanished documents marked. Server key only.
create or replace function core.fs_docs_put(p_project text, p_docs jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int := 0; m int;
begin
  if p_project not in ('price-research-48ff3', 'fabricrush-inventory') then raise exception 'fs_docs_put: unknown project %', p_project; end if;
  if jsonb_typeof(p_docs) <> 'array' then raise exception 'fs_docs_put: docs must be a list'; end if;
  insert into core.fs_docs as d (project, path, coll, doc_id, value, update_time, bytes, fp)
  select p_project, x ->> 'p', split_part(x ->> 'p', '/', 1), substr(x ->> 'p', length(split_part(x ->> 'p', '/', 1)) + 2), x -> 'v',
         (x ->> 't')::timestamptz, octet_length((x -> 'v')::text), encode(sha256(convert_to((x -> 'v')::text, 'utf8')), 'hex')
    from jsonb_array_elements(p_docs) x where coalesce(x ->> 'k', 'put') = 'put' and coalesce(x ->> 'p', '') like '%/%'
  on conflict (project, path) do update set value = excluded.value, update_time = excluded.update_time, bytes = excluded.bytes,
     fp = excluded.fp, seen_at = now(), gone_at = null;
  get diagnostics n = row_count;
  update core.fs_docs d set gone_at = coalesce(d.gone_at, now())
    from jsonb_array_elements(p_docs) x where x ->> 'k' = 'delete' and d.project = p_project and d.path = x ->> 'p';
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke all on function core.fs_docs_put(text, jsonb) from public, anon, authenticated;
grant execute on function core.fs_docs_put(text, jsonb) to service_role;

-- what the copy holds, per project and collection (to watch it, and to design the sections still to come)
create or replace function core.fs_docs_summary() returns table (project text, coll text, docs bigint, gone bigint, mb numeric, newest timestamptz, last_seen timestamptz)
language sql stable security definer set search_path = core, public as $$
  select project, coll, count(*) filter (where gone_at is null), count(*) filter (where gone_at is not null),
         round(sum(bytes) / 1e6, 2), max(update_time), max(seen_at)
    from core.fs_docs group by 1, 2 order by 1, 2
$$;
revoke all on function core.fs_docs_summary() from public, anon, authenticated;
grant execute on function core.fs_docs_summary() to service_role;

notify pgrst, 'reload schema';
select 1 as n, 'the copy table exists, browsers cannot read it' as check_name,
       case when to_regclass('core.fs_docs') is not null and not has_table_privilege('anon', 'core.fs_docs', 'select')
             and not has_table_privilege('authenticated', 'core.fs_docs', 'select') then 'PASS' else 'FAIL' end as result
union all select 2, 'only the server key can put documents in',
       case when not has_function_privilege('anon', 'core.fs_docs_put(text,jsonb)', 'execute')
             and not has_function_privilege('authenticated', 'core.fs_docs_put(text,jsonb)', 'execute') then 'PASS' else 'FAIL' end
union all select 3, 'how big the whole database is now (MB) — the free plan holds 500: ' || round(pg_database_size(current_database()) / 1e6)::text,
       case when pg_database_size(current_database()) < 400e6 then 'PASS' else 'FAIL' end;
