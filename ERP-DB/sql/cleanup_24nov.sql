-- CLEANUP 24 Nov 2026 (Ravi: "clean any messy not important data"), applied by Claude.
--
-- 1. BIG AUTOMATIC COPIES keep their content 3 days in the save log (core.sync_inbox). Who / when / what stay; the bulky
--    value becomes { _slimmed, bytes, on }. Only rows filed (done), already copied back to Firebase, from automatic sources
--    (job · …, firebase capture, pricing api double write, nightly checker, job capture) and over 50 KB. Saves by people keep
--    30 days. Daily at 5:15 AM IST (r1-inbox-slim). First run 24 Nov: 861 rows, 375 MB of raw content.
create or replace function core.inbox_slim(p_days int default 3, p_min_bytes int default 50000, p_max int default 3000) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int; up bigint;
begin
  if p_days < 3 then raise exception 'keep at least 3 days'; end if;
  select case when on_ or test_prefix is not null then upto end into up from core.fb_pushback_state where id = 1;
  with c as (
    select id from core.sync_inbox
     where status = 'done' and at < now() - make_interval(days => p_days)
       and (screen like 'job · %' or screen in ('firebase capture', 'pricing api double write', 'nightly checker', 'job capture'))
       and value is not null and not (value ? '_slimmed')
       and octet_length(value::text) > p_min_bytes
       and (up is null or id <= up)
     order by id limit p_max)
  update core.sync_inbox i set value = jsonb_build_object('_slimmed', true, 'bytes', octet_length(i.value::text), 'on', now()::date)
    from c where i.id = c.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.inbox_slim(int, int, int) from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'r1-inbox-slim';
select cron.schedule('r1-inbox-slim', '45 23 * * *', 'select core.inbox_slim(3)');

-- 2. JUNK REMOVED (24 Nov, one-off, already done — kept here as the record):
--    27 save-log rows: 23 stuck since 20–21 Nov (rename test pt_tmpRenameTest + 3 old audit captures) and test rows
--    (pt_r1waytest, pt_recvRejects/zz_capture_test). 2 deleted test documents: audit/zz_indextest, settings/r1test.
--    KEPT on purpose: the archive schema (4 tables, all still used by the save engine) and the deleted-document marker of
--    creatorOrders/CGE-09N8IBYQN1 (a real order deleted by it@ridhihome.com on 24 Nov 11:55 — to be confirmed).
--
-- 2b. (25 Nov) THE ARCHIVE WAS COPYING WHAT IT REMOVED INTO core.change_log: the log_change trigger sits on
--     history.audit_changes / audit_entries too, so every archived audit row came back as a 'delete' row with its full old
--     value — 94,664 rows, 84 MB, exactly the 30,064 entries of 1–25 Oct already in the verified archive files. Fixed:
--     core.archive_audit_delete and core.archive_inbox_delete now run with core.loading = on (log_change skips), and the
--     94,664 duplicate rows were deleted. Timer history (cron.job_run_details) kept 1 day instead of 3 (r1-cron-log-trim).
--     VACUUM FULL of core.change_log (108 MB → 6 MB) and cron.job_run_details (24 MB → 2 MB). Database 1,119 → 996 MB.
do $$
declare f text; d text;
begin
  foreach f in array array['core.archive_audit_delete(date,bigint[],text,bigint,integer)', 'core.archive_inbox_delete(date,bigint[],text,bigint,integer)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('core.loading' in d) > 0 then continue; end if;
    execute replace(d, E'raise exception ''server only''; end if;',
      E'raise exception ''server only''; end if;\n  perform set_config(''core.loading'', ''on'', true);   -- 25 Nov: rows moved to the archive files are not copied again into core.change_log');
  end loop;
end $$;
select cron.alter_job((select jobid from cron.job where jobname = 'r1-cron-log-trim'), command := 'delete from cron.job_run_details where end_time < now() - interval ''1 day''');
--
-- 2c. (25 Nov, Ravi: "yes keep 14 days save log") the save log keeps 14 days in the table, the audit history 30:
--     core.archive_days(p_kind, p_keep_days default null → 14 for sync_inbox, 30 for audit), archive_inbox_day /
--     archive_inbox_delete default 14 with a 14-day floor (audit keeps its 30-day floor). The nightly archive (archiveNightly,
--     4:15 AM) passes no number, so it uses these defaults. The save log starts 14 Nov, so the first day leaves on 29 Nov.
--
-- 3. ADVISORS (24 Nov): security — every function the linter flags as callable without sign-in was probed with only the
--    public key: all refuse or answer nothing (empty / false / null). Performance — 314 foreign keys without an index (INFO;
--    add only where a slow query shows it), a few unused indexes (change_log, shadow_log, products, sync_inbox), fb_pushed has
--    no primary key. ~180 helper functions without a fixed search_path (WARN, low risk; fix in one careful batch later).
