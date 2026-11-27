-- FIX (14 Nov): core.rt_get_v — a name inside it clashed ("missing FROM-clause entry"). Same as in sync_engine.sql now.
-- Paste into ERP data → Run. The last line must say PASS.
create or replace function core.rt_get_v(p_path text) returns jsonb language plpgsql volatile security definer set search_path = core, public as $$
declare v jsonb; u bigint; c record; v_reg text := split_part(trim(both '/' from coalesce(p_path, '')), '/', 1);
begin
  if not core.rt_reader() then raise exception 'rt_get: not an ERP sign-in'; end if;
  u := core.rt_upto();
  v := core.rt_value(p_path);
  select * into c from core.rt_cache rc where rc.reg = v_reg and position('/' in trim(both '/' from p_path)) = 0;
  if found and c.upto is not null then u := least(u, c.upto); end if;          -- a ready-built copy: complete up to when it was built
  return jsonb_build_object('v', v, 'upto', u);
end $$;
revoke all on function core.rt_get_v(text) from public;
grant execute on function core.rt_get_v(text) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
select case when position('v_reg' in pg_get_functiondef('core.rt_get_v(text)'::regprocedure)) > 0 then 'PASS' else 'FAIL' end as result;
