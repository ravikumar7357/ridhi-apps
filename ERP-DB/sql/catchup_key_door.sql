-- (16 Nov) Lets the PC tool migration/tools/set-catchup-key.js store ERP TEST's secret key in ERP data's Vault as
-- erp_test_key — read from migration/.env.erp-test, never shown or typed. Server key only (nobody in a browser can call it).
-- Paste into ERP data → Run (after test_link_saves.sql). The last line must say PASS.
create or replace function core.set_catchup_key(p_key text) returns text language plpgsql security definer set search_path = core, public as $$
declare sid uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'set_catchup_key: server only'; end if;
  if coalesce(length(p_key), 0) < 20 then raise exception 'set_catchup_key: that is not a key'; end if;
  select id into sid from vault.secrets where name = 'erp_test_key';
  if sid is null then perform vault.create_secret(p_key, 'erp_test_key', 'ERP TEST secret key: the automatic catch-up reads the live ERP''s saves with it');
  else perform vault.update_secret(sid, p_key); end if;
  return 'stored';
end $$;
revoke all on function core.set_catchup_key(text) from public, anon, authenticated;
grant execute on function core.set_catchup_key(text) to service_role;
notify pgrst, 'reload schema';
select case when not has_function_privilege('anon', 'core.set_catchup_key(text)', 'execute')
             and not has_function_privilege('authenticated', 'core.set_catchup_key(text)', 'execute') then 'PASS' else 'FAIL' end as result;
