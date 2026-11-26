-- R-one backend: its own small schema in ERP data (Supabase). Run once in the SQL editor, then add "backend" under
-- Project Settings → Data API → Exposed schemas. Tiny tables (one row per job run); safe on the current compute.
-- Only the backend's secret key writes here: RLS is on with no policies, so the browser's keys can't read or write it.

create schema if not exists backend;

create table if not exists backend.job_runs (
  id            bigserial primary key,
  job           text        not null,            -- 'ads-daily', 'route:ping', …
  started_at    timestamptz not null,
  finished_at   timestamptz not null,
  ok            boolean     not null,
  rows_written  integer     not null default 0,
  error         text,
  details       jsonb
);
create index if not exists job_runs_job_started on backend.job_runs (job, started_at desc);
alter table backend.job_runs enable row level security;

-- the morning check: the last run of every job
create or replace view backend.last_runs as
  select distinct on (job) job, started_at, finished_at, ok, rows_written, error
  from backend.job_runs order by job, started_at desc;

-- keep 60 days of runs
create or replace function backend.prune_runs(p_keep_days int default 60) returns int
language sql security definer set search_path = backend as $$
  with gone as (delete from backend.job_runs where started_at < now() - make_interval(days => p_keep_days) returning 1)
  select count(*)::int from gone;
$$;

revoke all on schema backend from anon, authenticated;
grant usage on schema backend to service_role;
grant all on all tables in schema backend to service_role;
grant all on all sequences in schema backend to service_role;
grant execute on function backend.prune_runs(int) to service_role;
