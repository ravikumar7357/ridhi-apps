-- LIVE MIRROR · the fingerprint list now also knows the planning and history areas (13 Nov: the 13-Nov reload of Leftovers
-- stopped on "planning.india_stock is not a section table"). Same function as in sync.sql / hr.sql. Safe to paste again.
create or replace function core.sync_fps(p_table text) returns jsonb
language plpgsql stable security definer set search_path = core, public as $$
declare s text; t text; has_fp boolean; has_fb boolean; r jsonb;
begin
  s := split_part(p_table, '.', 1); t := split_part(p_table, '.', 2);
  if s not in ('core', 'sales', 'production', 'shipping', 'archive', 'stock', 'hr', 'planning', 'history') or t = '' then raise exception 'sync_fps: % is not a section table', p_table; end if;
  if not exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'legacy_key') then
    raise exception 'sync_fps: % has no legacy_key', p_table; end if;
  has_fp := exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'fp');
  has_fb := exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'firebase');
  execute format('select coalesce(jsonb_object_agg(legacy_key, %s), ''{}''::jsonb) from %I.%I where legacy_key is not null',
                 case when has_fp then 'fp'
                      when has_fb then 'case when firebase is null then null else encode(sha256(convert_to(firebase::text, ''UTF8'')), ''hex'') end'
                      else 'null::text' end, s, t) into r;
  return r;
end $$;
revoke all on function core.sync_fps(text) from public, anon, authenticated;
grant execute on function core.sync_fps(text) to service_role;
notify pgrst, 'reload schema';
select case when jsonb_typeof(core.sync_fps('planning.india_stock')) = 'object' then 'PASS' else 'FAIL' end as planning_area_known;
