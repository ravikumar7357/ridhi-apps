-- FIX (2026-11-16): rt_value, rt_cache_warm, rt_get_json — the same as in sync_engine.sql now. Paste into ERP data → Run.

alter table core.rt_cache add column if not exists txt text;
alter table core.rt_cache alter column txt set storage external;

create or replace function core.rt_value(p_path text) returns jsonb language plpgsql volatile security definer set search_path = core, public as $$
declare segs text[] := string_to_array(trim(both '/' from coalesce(p_path, '')), '/'); c record; v jsonb; t0 timestamptz; u bigint;
begin
  if coalesce(array_length(segs, 1), 0) = 1 and segs[1] not in ('pt_audit', 'pt_trash') then
    select * into c from core.rt_cache where reg = segs[1];
    if found and c.txt is not null and c.built_at > now() - interval '24 hours' then return c.value; end if;
    perform pg_advisory_xact_lock(hashtext('rt_build:' || segs[1]));        -- the others wait for this one build
    select * into c from core.rt_cache where reg = segs[1];
    if found and c.txt is not null and c.built_at > now() - interval '24 hours' then return c.value; end if;
    t0 := clock_timestamp();
    u := core.rt_upto();
    v := core.rt_build(p_path);
    insert into core.rt_cache as rc (reg, value, txt, built_at, dirty, upto) values (segs[1], v, coalesce(v::text, 'null'), t0, false, u)
    on conflict (reg) do update set value = excluded.value, txt = excluded.txt, built_at = t0, upto = excluded.upto, dirty = coalesce(rc.changed_at >= t0, false);
    return v;
  end if;
  return core.rt_build(p_path);
end $$;

create or replace function core.rt_cache_warm(p_ms int default 8000) returns jsonb language plpgsql security definer set search_path = core, public as $$
declare r record; v jsonb; t0 timestamptz; s timestamptz := clock_timestamp(); n int := 0; u bigint;
begin
  -- only what a save changed (+ a copy without its ready text, + a once-a-day safety rebuild) — 16 Nov: rebuilding every list every
  -- 50 minutes kept the small server busy for nothing
  for r in select reg from core.rt_cache where dirty or upto is null or txt is null or built_at < now() - interval '23 hours' order by dirty desc, changed_at nulls last loop
    exit when clock_timestamp() - s > make_interval(secs => p_ms / 1000.0);
    if not pg_try_advisory_xact_lock(hashtext('rt_build:' || r.reg)) then continue; end if;
    t0 := clock_timestamp();
    u := core.rt_upto();
    v := core.rt_build(r.reg);
    update core.rt_cache as rc set value = v, txt = coalesce(v::text, 'null'), built_at = t0, upto = u, dirty = coalesce(rc.changed_at >= t0, false) where rc.reg = r.reg;
    n := n + 1;
  end loop;
  return jsonb_build_object('built', n, 'ms', round(extract(epoch from clock_timestamp() - s) * 1000));
end $$;

create or replace function core.rt_get_json(p_path text) returns json language plpgsql volatile security definer set search_path = core, public as $$
declare v_reg text := split_part(trim(both '/' from coalesce(p_path, '')), '/', 1); t text;
begin
  if not core.rt_reader() then raise exception 'rt_get: not an ERP sign-in'; end if;
  if position('/' in trim(both '/' from coalesce(p_path, ''))) > 0 or v_reg in ('pt_audit', 'pt_trash') then return core.rt_value(p_path)::json; end if;
  select rc.txt into t from core.rt_cache rc where rc.reg = v_reg and rc.txt is not null and rc.built_at > now() - interval '24 hours';
  if t is null then perform core.rt_value(p_path); select rc.txt into t from core.rt_cache rc where rc.reg = v_reg; end if;
  return coalesce(t, 'null')::json;
end $$;
revoke all on function core.rt_get_json(text) from public;
grant execute on function core.rt_get_json(text) to anon, authenticated, service_role;
revoke all on function core.rt_cache_warm(int) from public, anon, authenticated;
grant execute on function core.rt_cache_warm(int) to service_role;
notify pgrst, 'reload schema';
select 'PASS' as result;
