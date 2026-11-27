-- READ-ONLY: what ERP data is doing right now, how big its ready-built lists are, and the background timers. Paste → Run → send.
select 'busy now' as what, count(*) filter (where state = 'active')::text as value from pg_stat_activity where datname = current_database()
union all select 'waiting for a lock', count(*) filter (where wait_event_type = 'Lock')::text from pg_stat_activity where datname = current_database()
union all select 'connections', count(*)::text from pg_stat_activity where datname = current_database()
union all select 'ready-built lists', count(*)::text from core.rt_cache
union all select 'ready-built lists with ready text', count(*) filter (where txt is not null)::text from core.rt_cache
union all select 'ready-built lists marked changed', count(*) filter (where dirty)::text from core.rt_cache
union all select 'ready text total MB', round(sum(octet_length(txt)) / 1e6, 1)::text from core.rt_cache
union all select 'database size MB', round(pg_database_size(current_database()) / 1e6)::text
union all select 'timer ' || jobname, schedule || ' · ' || case when active then 'on' else 'off' end from cron.job
union all select 'timer runs last 10 min (avg ms)', coalesce(round(avg(extract(epoch from end_time - start_time) * 1000))::text, '—')
  from cron.job_run_details where start_time > now() - interval '10 minutes'
union all select 'timer runs that failed last hour', count(*)::text from cron.job_run_details where start_time > now() - interval '1 hour' and status <> 'succeeded';
