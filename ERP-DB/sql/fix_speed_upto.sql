-- FIX (16 Nov): every list read made ERP data read through the whole inbox (~10,000 saves) to find "up to which save is this
-- copy complete" — ten lists at once queued every request for a minute. Same as in sync_engine.sql now. Paste into ERP data → Run.
create index if not exists sync_inbox_waiting on core.sync_inbox (id) where status = 'new';
create or replace function core.rt_list_upto(p_reg text) returns bigint language plpgsql stable security definer set search_path = core, public as $$
declare u bigint := core.rt_upto(); c bigint;
begin
  if not core.rt_reader() then raise exception 'rt_list_upto: not an ERP sign-in'; end if;
  select upto into c from core.rt_cache where reg = p_reg;
  return case when c is null then u else least(u, c) end;
end $$;
revoke all on function core.rt_list_upto(text) from public;
grant execute on function core.rt_list_upto(text) to anon, authenticated, service_role;
analyze core.sync_inbox;
notify pgrst, 'reload schema';
-- how long the question takes now (should be a few milliseconds)
select 'PASS' as result, (select count(*) from core.sync_inbox where status = 'new') as saves_waiting,
       (extract(milliseconds from clock_timestamp() - now()))::int as ms_so_far, core.rt_upto() as upto_now;
