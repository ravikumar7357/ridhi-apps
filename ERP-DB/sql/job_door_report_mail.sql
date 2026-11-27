-- THE JOB DOOR, PART 2 (23 Nov): Realtime-Database lists too, for Report-Mail. Builds on job_door_pricing_api.sql.
-- Report-Mail READS ERP lists (orders, printers, rejects …) and WRITES one thing: the mailedAt stamp on pt_recvRejects.
-- Re-running this file is safe.

alter table core.job_keys add column if not exists write_lists text[] not null default '{}';
alter table core.job_keys add column if not exists read_lists text[] not null default '{}';

-- READ whole lists (or a path inside one): { path: value } as JSON, from the same cache the ERP reads. At most 20 at once.
create or replace function core.job_rt_get(p_job text, p_key text, p_paths text[]) returns json
language plpgsql security definer set search_path = core, public as $$
declare j core.job_keys; p text; l text; parts text[] := '{}'; t text;
begin
  j := core.job_check(p_job, p_key);
  if coalesce(array_length(p_paths, 1), 0) > 20 then raise exception 'job door: at most 20 lists at once'; end if;
  foreach p in array coalesce(p_paths, '{}') loop
    p := trim(both '/' from p); l := split_part(p, '/', 1);
    if not (l = any(j.read_lists) or l = any(j.write_lists)) then raise exception 'job door: % may not read %', p_job, l; end if;
    if position('/' in p) = 0 then
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

-- WRITE: job_save now also takes Realtime-Database changes, marked db:'rt' (path = list/…, e.g. pt_recvRejects/<id>/mailedAt)
create or replace function core.job_save(p_job text, p_key text, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = core, public as $$
declare j core.job_keys; c jsonb; p text; s text[]; k text; v_from bigint; n int := 0; bad text; rt boolean;
        created text[] := '{}'; existed text[] := '{}'; missing text[] := '{}'; scr text;
begin
  j := core.job_check(p_job, p_key);
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'job door: changes must be a list'; end if;
  if jsonb_array_length(p_changes) > 500 then raise exception 'job door: at most 500 changes at once'; end if;
  if octet_length(p_changes::text) > 8000000 then raise exception 'job door: at most 8 MB at once'; end if;
  scr := 'job · ' || p_job;
  v_from := (select coalesce(max(id), 0) from core.sync_inbox);
  for c in select * from jsonb_array_elements(p_changes) loop
    p := trim(both '/' from coalesce(c->>'p', '')); s := string_to_array(p, '/'); k := c->>'k'; rt := coalesce(c->>'db', '') = 'rt';
    if coalesce(array_length(s, 1), 0) < 2 then raise exception 'job door: % is too short', p; end if;
    if rt then
      if not (s[1] = any(j.write_lists)) then raise exception 'job door: % may not write %', p_job, s[1]; end if;
      if k not in ('put', 'delete') then raise exception 'job door: a list change is put or delete'; end if;
      insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
      values (now(), 'job:' || p_job, k, p, case when k = 'delete' or c->'v' = 'null'::jsonb then null else c->'v' end, scr);
      n := n + 1; continue;
    end if;
    if not (s[1] = any(j.write_colls)) or s[1] = 'config' then raise exception 'job door: % may not write %', p_job, s[1]; end if;
    if k not in ('put', 'patch', 'delete', 'create') then raise exception 'job door: unknown change %', k; end if;
    if k = 'create' or (k = 'patch' and (c->>'x')::boolean is true) then
      perform pg_advisory_xact_lock(hashtext('job door ' || s[1] || '/' || s[2]));
      if core.fs_value(s[1], s[2]) is not null
         or exists (select 1 from core.sync_inbox i where i.status = 'new' and i.path = 'fs/' || s[1] || '/' || s[2] and i.kind <> 'delete') then
        if k = 'create' then existed := existed || p; continue; end if;
      elsif k = 'patch' then missing := missing || p; continue;
      end if;
      if k = 'create' then created := created || p; k := 'put'; end if;
    end if;
    insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
    values (now(), 'job:' || p_job, k, 'fs/' || p, case when k = 'delete' or c->'v' = 'null'::jsonb then null else c->'v' end, scr);
    n := n + 1;
  end loop;
  update core.job_keys set last_used = now() where job = p_job;
  if n > 0 then
    for i in 1..15 loop
      perform core.sync_now();
      if exists (select 1 from core.sync_inbox where id > v_from and status = 'new' and email = 'job:' || p_job and path like 'fs/%') then perform core.fs_direct_apply(500); end if;
      exit when not exists (select 1 from core.sync_inbox where id > v_from and status = 'new' and email = 'job:' || p_job);
      perform pg_sleep(0.2);
    end loop;
    select string_agg(x.path || ': ' || coalesce(left(x.error, 160), 'refused'), ' | ') into bad
      from (select path, error from core.sync_inbox where id > v_from and status = 'failed' and email = 'job:' || p_job order by id limit 3) x;
    if bad is not null then raise exception 'job door: not saved — %', bad; end if;
  end if;
  return jsonb_build_object('n', n, 'created', to_jsonb(created), 'exists', to_jsonb(existed), 'missing', to_jsonb(missing));
end $$;
revoke all on function core.job_save(text, text, jsonb) from public;
grant execute on function core.job_save(text, text, jsonb) to anon, authenticated, service_role;

-- Report-Mail: writes only the reject stamp; reads the lists its three mails use (Main.gs RM_NODES + printer alert + rejects)
insert into core.job_keys (job, key_hash, write_colls, read_colls, write_lists, read_lists, on_)
values ('report-mail', repeat('0', 64), '{}', array['audit'], array['pt_recvRejects'],
        array['pt_orderBook', 'pt_shopProd', 'pt_cuttingData', 'pt_baseData', 'pt_pressInventory', 'pt_fgiLedger', 'pt_salesOrders',
              'pt_orderAlerts', 'pt_vendorOrders', 'pt_masters', 'pt_vendorMap'], false)
on conflict (job) do update set write_colls = excluded.write_colls, read_colls = excluded.read_colls,
  write_lists = excluded.write_lists, read_lists = excluded.read_lists;

notify pgrst, 'reload schema';
select 'PASS — job door takes lists too; report-mail is shut until its key is registered' as result;
