-- KEEP 30 DAYS IN THE TABLES, THE REST IN ARCHIVE FILES (23 Nov, Ravi: "just 30 days to table and other in archive").
-- Applied by Claude with the user's OK. Re-running is safe.
--
-- Every night a Firebase function (archiveNightly, 4:15 AM India time) takes ONE DAY at a time that is older than 30 days:
--   1. reads that day's rows through the doors below (server key only),
--   2. writes them as one compressed file to the PRIVATE storage bucket erp-archive (sync_inbox/YYYY-MM-DD.json.gz,
--      audit/YYYY-MM-DD.json.gz),
--   3. downloads the file again and checks the row count,
--   4. only then removes exactly those rows from the table (the delete door re-checks every rule).
-- What is NEVER archived: a save that is not filed yet (new), a refused one (failed), or one the way back has not copied to
-- Firebase yet. Firebase keeps the full audit as well (the way back never deletes there).
-- Nothing reads these old rows: the save engine reads only new saves, the way back only the last minute; the ERP's history
-- screen shows the last 30 days from the table.

insert into storage.buckets (id, name, public) values ('erp-archive', 'erp-archive', false) on conflict (id) do nothing;

create table if not exists core.archive_log (
  id bigserial primary key, at timestamptz not null default now(), kind text not null, day date not null,
  rows int not null, bytes bigint, path text not null, note text
);
alter table core.archive_log enable row level security;
revoke all on core.archive_log from anon, authenticated;

-- which days are waiting (oldest first)
create or replace function core.archive_days(p_kind text, p_keep_days int default 30, p_max int default 15) returns jsonb
language plpgsql security definer set search_path = core, public as $$
declare r jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'server only'; end if;
  if p_keep_days < 30 then raise exception 'keep at least 30 days'; end if;
  if p_kind = 'sync_inbox' then
    select coalesce(jsonb_agg(d order by d), '[]') into r from (
      select distinct (at at time zone 'Asia/Kolkata')::date d from core.sync_inbox
       where (at at time zone 'Asia/Kolkata')::date < ((now() - make_interval(days => p_keep_days)) at time zone 'Asia/Kolkata')::date   -- whole days only
       order by 1 limit p_max) x;
  elsif p_kind = 'audit' then
    select coalesce(jsonb_agg(d order by d), '[]') into r from (
      select distinct (at_time at time zone 'Asia/Kolkata')::date d from history.audit_entries
       where (at_time at time zone 'Asia/Kolkata')::date < ((now() - make_interval(days => p_keep_days)) at time zone 'Asia/Kolkata')::date   -- whole days only
       order by 1 limit p_max) x;
  else raise exception 'unknown kind %', p_kind; end if;
  return r;
end $$;

-- the rule for a save-log row that may leave the table
create or replace function core.archive_inbox_ok(i core.sync_inbox, p_keep_days int) returns boolean language sql stable as $$
  select (i.at at time zone 'Asia/Kolkata')::date < ((now() - make_interval(days => p_keep_days)) at time zone 'Asia/Kolkata')::date   -- whole days only
     and i.status = 'done'
     and i.id <= coalesce((select case when on_ or test_prefix is not null then upto else null end from core.fb_pushback_state where id = 1), i.id)
$$;

create or replace function core.archive_inbox_day(p_day date, p_keep_days int default 30) returns jsonb
language plpgsql security definer set search_path = core, public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'server only'; end if;
  if p_keep_days < 30 then raise exception 'keep at least 30 days'; end if;
  return coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from core.sync_inbox i
     where (i.at at time zone 'Asia/Kolkata')::date = p_day and core.archive_inbox_ok(i, p_keep_days)), '[]');
end $$;

create or replace function core.archive_inbox_delete(p_day date, p_ids bigint[], p_path text, p_bytes bigint, p_keep_days int default 30) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'server only'; end if;
  if p_keep_days < 30 then raise exception 'keep at least 30 days'; end if;
  delete from core.sync_inbox i where i.id = any(p_ids) and (i.at at time zone 'Asia/Kolkata')::date = p_day and core.archive_inbox_ok(i, p_keep_days);
  get diagnostics n = row_count;
  insert into core.archive_log (kind, day, rows, bytes, path) values ('sync_inbox', p_day, n, p_bytes, p_path);
  return n;
end $$;

create or replace function core.archive_audit_day(p_day date, p_keep_days int default 30) returns jsonb
language plpgsql security definer set search_path = core, public as $$
declare ids bigint[];
begin
  if auth.role() is distinct from 'service_role' then raise exception 'server only'; end if;
  if p_keep_days < 30 then raise exception 'keep at least 30 days'; end if;
  if p_day >= ((now() - make_interval(days => p_keep_days)) at time zone 'Asia/Kolkata')::date then raise exception 'only whole days older than % days', p_keep_days; end if;
  select array_agg(id) into ids from history.audit_entries
   where (at_time at time zone 'Asia/Kolkata')::date = p_day;
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from history.audit_entries e where e.id = any(ids)), '[]'),
    'changes', coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from history.audit_changes c where c.audit_entry_id = any(ids)), '[]'));
end $$;

create or replace function core.archive_audit_delete(p_day date, p_entry_ids bigint[], p_path text, p_bytes bigint, p_keep_days int default 30) returns int
language plpgsql security definer set search_path = core, public as $$
declare ids bigint[]; n int;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'server only'; end if;
  if p_keep_days < 30 then raise exception 'keep at least 30 days'; end if;
  if p_day >= ((now() - make_interval(days => p_keep_days)) at time zone 'Asia/Kolkata')::date then raise exception 'only whole days older than % days', p_keep_days; end if;
  select array_agg(id) into ids from history.audit_entries
   where id = any(p_entry_ids) and (at_time at time zone 'Asia/Kolkata')::date = p_day;
  delete from history.audit_changes where audit_entry_id = any(ids);
  delete from history.audit_entries where id = any(ids);
  get diagnostics n = row_count;
  insert into core.archive_log (kind, day, rows, bytes, path) values ('audit', p_day, n, p_bytes, p_path);
  return n;
end $$;

revoke all on function core.archive_days(text, int, int), core.archive_inbox_day(date, int), core.archive_inbox_delete(date, bigint[], text, bigint, int),
  core.archive_audit_day(date, int), core.archive_audit_delete(date, bigint[], text, bigint, int) from public, anon, authenticated;
grant execute on function core.archive_days(text, int, int), core.archive_inbox_day(date, int), core.archive_inbox_delete(date, bigint[], text, bigint, int),
  core.archive_audit_day(date, int), core.archive_audit_delete(date, bigint[], text, bigint, int) to service_role;

create or replace view core.archive_status as
select kind, count(*) days, sum(rows) rows, pg_size_pretty(sum(bytes)) file_size, min(day) first_day, max(day) last_day, max(at) last_run
  from core.archive_log group by kind;
revoke all on core.archive_status from public, anon, authenticated;
notify pgrst, 'reload schema';
