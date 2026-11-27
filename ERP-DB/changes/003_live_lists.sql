-- ERP-DB change 003 · LIVE CHECK SAYS WHICH LISTS CHANGED                         written 27 Nov 2026 · run on live: ____
--
-- WHAT IT DOES
--   Adds core.rt_live_lists(p_from): the same answer as core.rt_live_upto() (the newest save applied), PLUS the names of
--   the lists that changed since p_from. The page then refreshes only those lists instead of every list it holds.
--   Today: after any save by anyone, each open page asks for changes of all its ~20 lists, one after another.
--   Nothing existing is changed; pages that do not know this function keep using rt_live_upto as before.
--
-- ANSWER  {"upto": 123456, "lists": ["pt_orderBook", "fs"]}   lists = null means "too many changes: refresh everything"
--
-- UNDO
--   drop function if exists core.rt_live_lists(bigint);
--
-- RUN: Supabase → SQL editor → paste → Run. The last line prints PASS.

create or replace function core.rt_live_lists(p_from bigint) returns jsonb
language plpgsql stable security definer set search_path = core, public as $$
declare u bigint; l jsonb;
begin
  if core.me_email() is null and auth.role() is distinct from 'service_role' then raise exception 'rt_live_lists: not an ERP sign-in'; end if;
  u := core.rt_upto();
  if p_from is null or p_from >= u then return jsonb_build_object('upto', u, 'lists', '[]'::jsonb); end if;
  if u - p_from > 5000 then return jsonb_build_object('upto', u, 'lists', null); end if;   -- long gap: refresh all, as today
  select coalesce(jsonb_agg(distinct case when path like 'fs/%' then 'fs' else split_part(path, '/', 1) end), '[]'::jsonb)
    into l
    from core.sync_inbox
   where id > p_from and id <= u;
  return jsonb_build_object('upto', u, 'lists', l);
end $$;

revoke all on function core.rt_live_lists(bigint) from public;
grant execute on function core.rt_live_lists(bigint) to authenticated, service_role;
notify pgrst, 'reload schema';

select case when has_function_privilege('authenticated', 'core.rt_live_lists(bigint)', 'execute')
            and (core.rt_live_lists(core.rt_upto() - 50) ? 'lists')
            then 'PASS · live check can name the changed lists' else 'FAIL · tell Claude' end as result;
