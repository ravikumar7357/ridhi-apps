-- FIX (2026-11-16): rt_build — the same as in sync_engine.sql now. Paste into ERP data → Run.

create or replace function core.rt_build(p_path text) returns jsonb language plpgsql stable security definer set search_path = core, public as $$
declare segs text[] := string_to_array(trim(both '/' from coalesce(p_path, '')), '/'); reg text; l record; v jsonb; nseg int;
begin
  nseg := coalesce(array_length(segs, 1), 0);
  if nseg = 0 then raise exception 'rt_get: a whole-database read is not offered'; end if;
  reg := segs[1];
  -- the history: pt_audit/<month>/<id> · pt_trash/<id>
  if reg = 'pt_audit' then
    if nseg >= 3 then select firebase into v from history.audit_entries where legacy_key = array_to_string(segs[1:3], '/'); return v #> segs[4:]; end if;
    if nseg = 2 then select jsonb_object_agg(split_part(legacy_key, '/', 3), firebase) into v from history.audit_entries where left(legacy_key, length(segs[2]) + 10) = 'pt_audit/' || segs[2] || '/'; return v; end if;
    raise exception 'rt_get: pt_audit is read one month at a time';
  elsif reg = 'pt_trash' then
    if nseg >= 2 then select firebase into v from history.recycle_bin where legacy_key = 'pt_trash/' || segs[2]; return v #> segs[3:]; end if;
    select jsonb_object_agg(split_part(legacy_key, '/', 2), firebase) into v from history.recycle_bin where left(legacy_key, 9) = 'pt_trash/'; return v;
  end if;
  -- completed job work's two helper lists (_ver = one version per day, _auto) are kept as settings, not rows (16 Nov: the door
  -- answered "nothing", so the test link loaded NO completed job work)
  if reg = 'pt_baseDone' and nseg >= 2 and left(segs[2], 1) = '_' then
    select value into v from core.settings where key = 'production.job_work' || segs[2];
    return v #> segs[3:];
  end if;
  select * into l from core.sy_list(reg);
  if l.reg is null then return null; end if;                       -- a list Supabase does not keep (bookkeeping): nothing
  if l.tbl = 'core.sync_raw' then                                   -- the working copy: whole records by key
    select value into v from core.sync_raw where sync_raw.reg = segs[1] and k = '' and value is not null;   -- a list that is one value
    if v is not null then return v #> segs[2:]; end if;
    if nseg >= 2 then select value into v from core.sync_raw where sync_raw.reg = segs[1] and k = segs[2]; return v #> segs[3:]; end if;
    select jsonb_object_agg(k, value) into v from core.sync_raw where sync_raw.reg = segs[1] and value is not null;
    return core.rt_arr(v);
  elsif l.tbl = 'core.settings' then                                -- the FNSKU map: kept whole as a setting
    select value into v from core.settings where legacy_key = reg; return v #> segs[2:];
  end if;
  if nseg >= l.depth then return core.rt_row(l.tbl, array_to_string(segs[1:l.depth], '/')) #> segs[l.depth + 1:]; end if;
  if l.depth = 3 and nseg = 2 then return core.rt_rows(l.tbl, array_to_string(segs[1:2], '/'), 1); end if;
  v := core.rt_rows(l.tbl, reg, l.depth - 1);
  if reg = 'pt_baseDone' then                                         -- the whole list: its two helper lists too
    v := coalesce(v, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      '_ver', (select value from core.settings where key = 'production.job_work_ver'),
      '_auto', (select value from core.settings where key = 'production.job_work_auto')));
  end if;
  return v;
end $$;
select core.rt_cache_clear() as ready_built_lists_emptied;
notify pgrst, 'reload schema';
select 'PASS' as result;
