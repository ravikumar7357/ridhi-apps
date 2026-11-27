-- FIX: STALE READY-MADE LISTS (18 Nov). Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- What was wrong: ERP data keeps a ready-made copy of each list (core.rt_cache) for fast reading, rebuilt when a save
-- changes the list ("dirty"). The engine applies a batch of saves in ONE transaction and stamps changed_at with the time
-- that transaction STARTED. When a list was rebuilt while a long batch was still running, the rebuild could not see the
-- batch yet, and afterwards changed_at looked OLDER than the rebuild — so the list was never marked dirty again. It stayed
-- stale until the 23-hour safety rebuild. Seen 18 Nov after the checker's 8,940 fixes: masterDB's copy stopped at save
-- #35076 (the deleted SKUs and the last 100 changes missing from the copy, though the TABLES are right), sales orders at #36524.
--
-- Now: every warm-up run first compares each copy's "up to which save" number (upto) with the newest save actually applied
-- to that list; a copy that is behind is marked dirty and rebuilt. Time stamps no longer decide. Every copy is also marked
-- dirty once now, so all stale copies are rebuilt in the next minutes (one by one, as before).

create or replace function core.rt_cache_warm(p_ms int default 8000) returns jsonb language plpgsql security definer set search_path = core, public as $$
declare r record; v jsonb; t0 timestamptz; s timestamptz := clock_timestamp(); n int := 0; u bigint; lo bigint;
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

-- every copy rebuilt once now (the warm-up does them one by one in the next minutes)
update core.rt_cache set dirty = true;

select case when position('d.top > rc.upto' in pg_get_functiondef('core.rt_cache_warm(int)'::regprocedure)) > 0
            then 'PASS — stale list copies are found by save number now; all copies are being rebuilt'
            else 'FAIL' end as result;
