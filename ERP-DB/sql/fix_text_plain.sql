-- FIX (16 Nov): ERP data's API answers "plain text" only for a function whose result type is named "text/plain" (its media-type
-- rule) — rt_get_text was refused (406). Paste into ERP data → Run. The last line must say PASS.
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.typname = 'text/plain' and n.nspname = 'core') then
    create domain core."text/plain" as text;
  end if;
end $$;
drop function if exists core.rt_get_text(text);
create function core.rt_get_text(p_path text) returns core."text/plain" language plpgsql volatile security definer set search_path = core, public as $$
declare v_reg text := split_part(trim(both '/' from coalesce(p_path, '')), '/', 1); t text;
begin
  if not core.rt_reader() then raise exception 'rt_get: not an ERP sign-in'; end if;
  if position('/' in trim(both '/' from coalesce(p_path, ''))) > 0 or v_reg in ('pt_audit', 'pt_trash') then return coalesce(core.rt_value(p_path)::text, 'null'); end if;
  select rc.txt into t from core.rt_cache rc where rc.reg = v_reg and rc.txt is not null and rc.built_at > now() - interval '24 hours';
  if t is null then perform core.rt_value(p_path); select rc.txt into t from core.rt_cache rc where rc.reg = v_reg; end if;
  return coalesce(t, 'null');
end $$;
revoke all on function core.rt_get_text(text) from public;
grant execute on function core.rt_get_text(text) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
select 'PASS' as result;
