-- CALM THE BRIDGE (21 Nov). Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- What was wrong: on 21 Nov the project went read-only although the data is only 1 GB — the change log (WAL) had grown to
-- 896 MB in bursts and the disk filled faster than Supabase could enlarge it. CPU sat at 100% on the Micro server for a week.
-- Query Performance (about 7 days): rt_save 30%, rt_cache_warm 20% (every 15 s), sync_run 19% (every 10 s).
-- The heavy part is the ready-made list copies (core.rt_cache): when ONE record in a list changes, the warm-up rebuilds the
-- WHOLE list and writes it twice (value + txt), every 15 seconds while saves keep coming.
--
-- What this changes (no data is changed, only how often and how heavily the jobs run):
--   1. A list copy is rebuilt at most once every 2 minutes: a burst of saves gives one rebuild, not one per 15 seconds.
--   2. When a rebuilt list is the same as its copy, the big value and text are NOT written again — only the bookkeeping.
--   3. Timers: warm-up every 15 s → every minute; list files every 2 min → every 5 min. The sync engine stays at every 10 s
--      ON PURPOSE: on 21 Nov it is still working off a backlog (~48,000 saves waiting since the 20 Nov stall), and the 2-minute
--      gap above is what stops that backlog from setting off a whole-list rebuild every 15 seconds. Slow it to 30 s only once
--      the queue is empty (line in the LATER block at the end).
--
-- What it means for screens: a list copy can be up to about 3 minutes behind. Screens already add the newer saves on top
-- of a copy (rt_changes from the copy's "upto"), so people should see no difference — check on ERP TEST first.
--
-- It stops without changing anything if the live warm-up is not the 18 Nov version (fix_cache_dirty.sql) it was written for.
-- To undo: the old definition and timers are kept in core.calm_backup — see the UNDO block at the end.

-- 0 · Is the live warm-up the one this was written for?
do $$ begin
  if position('d.top > rc.upto' in pg_get_functiondef('core.rt_cache_warm(int)'::regprocedure)) = 0
     or position('built_at < now() - make_interval' in pg_get_functiondef('core.rt_cache_warm(int)'::regprocedure)) > 0 then
    raise exception 'STOP — the live core.rt_cache_warm is not the 18 Nov version this fix expects (or the fix is already in). Nothing was changed.';
  end if;
end $$;

-- 1 · Keep what is there now, so it can be put back
create table if not exists core.calm_backup (
  id        bigint generated always as identity primary key,
  saved_at  timestamptz not null default now(),
  what      text not null,
  def       text not null
);
revoke all on core.calm_backup from public, anon, authenticated;
insert into core.calm_backup (what, def)
  select 'function core.rt_cache_warm(int)', pg_get_functiondef('core.rt_cache_warm(int)'::regprocedure);
insert into core.calm_backup (what, def)
  select 'cron ' || jobname, schedule from cron.job where jobname in ('r1-rt-warm', 'r1-lists-publish');

-- 2 · The warm-up: the same as 18 Nov, plus the 2-minute gap and "same list → don't write it again"
create or replace function core.rt_cache_warm(p_ms int default 8000) returns jsonb language plpgsql security definer set search_path = core, public as $$
declare r record; v jsonb; t text; t0 timestamptz; s timestamptz := clock_timestamp(); n int := 0; same int := 0; u bigint; lo bigint;
begin
  -- 18 Nov: a copy is behind when a save applied to its list has a higher number than the copy's upto
  select min(upto) into lo from core.rt_cache where upto is not null;
  if lo is not null then
    update core.rt_cache rc set dirty = true
      from (select split_part(i.path, '/', 1) as reg, max(i.id) as top
              from core.sync_inbox i
             where i.id > lo and i.status = 'done'
             group by 1) d
     where rc.reg = d.reg and not rc.dirty and d.top > rc.upto;
  end if;
  -- only what a save changed (+ a copy without its ready text, + a once-a-day safety rebuild).
  -- 21 Nov: a changed list waits until its copy is 2 minutes old, so a burst of saves gives ONE rebuild.
  for r in select reg from core.rt_cache
            where (dirty and (built_at is null or built_at < now() - make_interval(secs => 120)))
               or upto is null or txt is null or built_at < now() - interval '23 hours'
            order by dirty desc, changed_at nulls last loop
    exit when clock_timestamp() - s > make_interval(secs => p_ms / 1000.0);
    if not pg_try_advisory_xact_lock(hashtext('rt_build:' || r.reg)) then continue; end if;
    t0 := clock_timestamp();
    u := core.rt_upto();
    v := core.rt_build(r.reg);
    t := coalesce(v::text, 'null');
    -- 21 Nov: the same list as the copy → only the bookkeeping; the big value and text are not written again (no WAL for them)
    update core.rt_cache as rc set built_at = t0, upto = u, dirty = coalesce(rc.changed_at >= t0, false)
     where rc.reg = r.reg and rc.txt = t;
    if found then same := same + 1;
    else
      update core.rt_cache as rc set value = v, txt = t, built_at = t0, upto = u, dirty = coalesce(rc.changed_at >= t0, false) where rc.reg = r.reg;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('built', n, 'unchanged', same, 'ms', round(extract(epoch from clock_timestamp() - s) * 1000));
end $$;
revoke all on function core.rt_cache_warm(int) from public, anon, authenticated;
grant execute on function core.rt_cache_warm(int) to service_role;

-- 3 · The timers (pg_cron's "N seconds" only goes to 59, so the warm-up becomes the every-minute cron form)
select cron.alter_job(jobid, schedule => '* * * * *')   from cron.job where jobname = 'r1-rt-warm';
select cron.alter_job(jobid, schedule => '*/5 * * * *') from cron.job where jobname = 'r1-lists-publish';

notify pgrst, 'reload schema';

select case
  when position('make_interval(secs => 120)' in pg_get_functiondef('core.rt_cache_warm(int)'::regprocedure)) > 0
   and (select schedule from cron.job where jobname = 'r1-rt-warm') = '* * * * *'
   and (select schedule from cron.job where jobname = 'r1-lists-publish') = '*/5 * * * *'
  then 'PASS — list copies rebuilt at most every 2 minutes and not rewritten when unchanged; warm-up every minute, list files every 5 min'
  else 'FAIL — look at the lines above' end as result;

-- ---------------------------------------------------------------------------------------------------------------------
-- UNDO (only if screens misbehave): run these lines on their own.
--   do $$ declare d text; begin
--     select def into d from core.calm_backup where what = 'function core.rt_cache_warm(int)' order by id desc limit 1;
--     execute d;
--   end $$;
--   select cron.alter_job(jobid, schedule => '15 seconds')  from cron.job where jobname = 'r1-rt-warm';
--   select cron.alter_job(jobid, schedule => '*/2 * * * *') from cron.job where jobname = 'r1-lists-publish';
--
-- LATER (only when the backlog is gone — this must say 0 first):
--   select count(*) from core.sync_inbox where status = 'new';
--   select cron.alter_job(jobid, schedule => '30 seconds') from cron.job where jobname = 'r1-sync-engine';
-- ---------------------------------------------------------------------------------------------------------------------
