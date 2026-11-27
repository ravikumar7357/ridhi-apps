-- JOB DOOR PART 3 (24 Nov 2026, applied by Claude): the nightly Backup-Script ("ERP nightly backup" Apps Script) reads
-- the lists from ERP data instead of downloading the whole Firebase Realtime Database (~₹2,200 a month).
-- Job 'backup': read_lists '*' (every list), READ ONLY. Key registered 24 Nov 12:14 IST (hash only). Apps Script side:
-- migration/apps-script/backup-script/SupaBackup.gs + one line at the start of backupRtdb_ in Code.gs; switch SB_JOB_ON
-- (sbbSwitchOn / sbbSwitchOff). Self-test 24 Nov: 83 lists + audit months 2026-10, 2026-11; orderBook 8770 = 8770,
-- masterDB 7802 = 7802. First real run: the 3:15 AM trigger of 25 Nov (a manual backupNow at 12:15 hung before its first
-- step and was terminated; the 24 Nov backup folder was left untouched).

create or replace function core.job_rt_get(p_job text, p_key text, p_paths text[]) returns json
language plpgsql security definer set search_path = core, public as $$
declare j core.job_keys; p text; l text; parts text[] := '{}'; t text;
begin
  j := core.job_check(p_job, p_key);
  if coalesce(array_length(p_paths, 1), 0) > 20 then raise exception 'job door: at most 20 lists at once'; end if;
  foreach p in array coalesce(p_paths, '{}') loop
    p := trim(both '/' from p); l := split_part(p, '/', 1);
    if l = '' or not (l = any(j.read_lists) or l = any(j.write_lists) or '*' = any(j.read_lists)) then raise exception 'job door: % may not read %', p_job, l; end if;
    if position('/' in p) = 0 and l not in ('pt_audit', 'pt_trash') then
      select rc.txt into t from core.rt_cache rc where rc.reg = l and rc.txt is not null and rc.built_at > now() - interval '24 hours';
      if t is null then t := coalesce(core.rt_value(p)::text, 'null'); end if;
    else t := coalesce(core.rt_value(p)::text, 'null'); end if;
    parts := parts || (to_json(p)::text || ':' || t);
  end loop;
  update core.job_keys set last_used = now() where job = p_job;
  return ('{' || array_to_string(parts, ',') || '}')::json;
end $$;
revoke all on function core.job_rt_get(text, text, text[]) from public;
grant execute on function core.job_rt_get(text, text, text[]) to anon, authenticated, service_role;

create or replace function core.job_rt_plan(p_job text, p_key text) returns json
language plpgsql security definer set search_path = core, public as $$
declare j core.job_keys;
begin
  j := core.job_check(p_job, p_key);
  if not ('*' = any(j.read_lists)) then raise exception 'job door: % may not list everything', p_job; end if;
  return json_build_object(
    'lists', (select coalesce(json_agg(reg order by reg), '[]') from core.rt_cache where reg like 'pt\_%' and reg not in ('pt_audit','pt_trash')),
    'paged', json_build_object(
      'pt_audit', (select coalesce(json_agg(m order by m), '[]') from (select distinct to_char(at_time at time zone 'UTC', 'YYYY-MM') m from history.audit_entries) x),
      'pt_trash', '[]'::json));
end $$;
revoke all on function core.job_rt_plan(text, text) from public;
grant execute on function core.job_rt_plan(text, text) to anon, authenticated, service_role;

insert into core.job_keys (job, key_hash, write_colls, read_colls, write_lists, read_lists, on_)
values ('backup', repeat('0', 64), '{}', '{}', '{}', array['*'], false)
on conflict (job) do update set read_lists = excluded.read_lists, write_lists = '{}', write_colls = '{}';
notify pgrst, 'reload schema';
