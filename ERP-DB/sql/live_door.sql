-- LIVE COPIES ON THE TEST LINK (16 Nov). The live ERP keeps each list it has open fresh in the background (Firebase's live
-- connection), so reopening a screen shows the newest data at once. The test link does the same against ERP data: every few
-- seconds it asks this one tiny number — the newest save ERP data has applied — and only when it moved does it fetch the
-- changes of the lists it holds. Paste into ERP data → Run. The last line must say PASS.
create or replace function core.rt_live_upto() returns bigint language plpgsql stable security definer set search_path = core, public as $$
begin
  if core.me_email() is null and auth.role() is distinct from 'service_role' then raise exception 'rt_live_upto: not an ERP sign-in'; end if;
  return core.rt_upto();
end $$;
revoke all on function core.rt_live_upto() from public;
grant execute on function core.rt_live_upto() to anon, authenticated, service_role;
notify pgrst, 'reload schema';
select case when has_function_privilege('authenticated', 'core.rt_live_upto()', 'execute') then 'PASS' else 'FAIL' end as result;
