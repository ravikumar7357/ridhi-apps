-- ERP-DB change 008 · CLOSE THE OPEN DATABASE FUNCTIONS (plan P0.2 / E0)          written 28 Nov 2026 · run on live: ____
--
-- WHAT IT DOES
--   About 370 database functions can be run today by anyone holding the public key (it is in every ERP page). Among them:
--   rt_value / rt_rows (read any record with no rights check), load_*_rows and sy_* (write whole tables), sync_run,
--   fs_docs_put, archive_*_delete, inbox_slim, fb_pushback_switch, set_catchup_key, sign_in_as_test.
--   This change takes the right to RUN functions away from browsers (roles anon, authenticated, public) in the schemas
--   core, backend, erp, sellora and public, and gives it back ONLY to:
--     1. the functions the pages really call (found by searching every app on 28 Nov), and
--     2. every function an access rule (RLS policy, incl. storage) uses, found automatically, so no read breaks.
--   The server keys (service_role, used by Apps Script, Backend, Sellora-Backend, Firebase functions) keep everything.
--   Functions calling other functions keep working: the open ones run as their owner.
--   NOT touched: schema flowmerce (its own app with its own sign-ins; handled in a later change).
--
-- UNDO (gives every right back exactly as before; paste and run):
--   select core.e0_undo();      -- uses the copy saved in core.e0_saved_grants by this file
--
-- RUN: test project first. Then live OUTSIDE work hours, with Ravi's yes. Supabase -> SQL editor -> paste all -> Run.
-- The last lines print PASS or FAIL. After running: open the ERP, save one order, one challan, one QC check.

begin;

-- 0 · keep a copy of today's rights so the undo is exact -----------------------------------------------------------------
create table if not exists core.e0_saved_grants (
  fn       regprocedure primary key,
  anon     boolean not null,
  authd    boolean not null,
  pub      boolean not null,
  saved_at timestamptz not null default now()
);
revoke all on core.e0_saved_grants from public, anon, authenticated;

insert into core.e0_saved_grants (fn, anon, authd, pub)
select p.oid::regprocedure,
       has_function_privilege('anon', p.oid, 'execute'),
       has_function_privilege('authenticated', p.oid, 'execute'),
       coalesce((select bool_or(a.grantee = 0) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.privilege_type = 'EXECUTE'), false)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('core', 'backend', 'erp', 'sellora', 'public') and p.prokind = 'f'
on conflict (fn) do nothing;     -- a second run never overwrites the first (true) copy

create or replace function core.e0_undo() returns text language plpgsql security definer set search_path = core, public as $$
declare g record; n int := 0;
begin
  for g in select * from core.e0_saved_grants loop
    if g.pub   then execute format('grant execute on function %s to public', g.fn); end if;
    if g.anon  then execute format('grant execute on function %s to anon', g.fn); end if;
    if g.authd then execute format('grant execute on function %s to authenticated', g.fn); end if;
    n := n + 1;
  end loop;
  return 'rights given back on ' || n || ' functions';
end $$;
revoke all on function core.e0_undo() from public, anon, authenticated;

-- 1 · the functions browsers may still run ------------------------------------------------------------------------------
create temp table e0_keep (schema text, fname text) on commit drop;
insert into e0_keep values
  -- reading lists, live updates, saving (shared/erp-data/layer.js)
  ('core','rt_get'), ('core','rt_get_text'), ('core','rt_get_json'), ('core','rt_get_v'), ('core','rt_list_upto'),
  ('core','rt_changes'), ('core','rt_live_upto'), ('core','rt_live_lists'), ('core','rt_save'), ('core','rt_cas'),
  -- Firestore-style reads (build.js), safe numbers (flow-core.js), the ERP mirror (mirror.js)
  ('core','fs_get'), ('core','fs_list'), ('core','next_no'), ('core','mirror'),
  -- a person's own access and the access-shadow report (core_access.sql grants these on purpose)
  ('core','my_access'), ('core','can_see_all_access'), ('core','access_of_everyone'),
  ('core','shadow_report'), ('core','shadow_report_everyone'),
  -- "who am I" helpers: say only things about the person asking
  ('core','me_email'), ('core','me_id'), ('core','rt_reader'), ('core','rt_admin'), ('core','is_admin'), ('core','can'),
  -- the job door: Apps Script (Pricing-API, Report-Mail) with a job key; each checks the key itself
  ('core','job_check'), ('core','job_get'), ('core','job_save'), ('core','job_rt_get'), ('core','job_rt_plan'),
  ('core','job_fs_plan'), ('core','job_fs_dump'),
  -- Sellora's live page data (Pricing-App/public/live-data.js)
  ('sellora','page_data');

-- plus every function an access rule uses (tables and storage), so nothing a browser reads breaks
insert into e0_keep
select distinct n.nspname, p.proname
  from pg_policies pol
  join pg_proc p on true
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('core', 'backend', 'erp', 'sellora', 'public')
   and (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ~ ('(^|[^a-z_])' || n.nspname || '\.' || p.proname || '\(');

-- 2 · close everything else ---------------------------------------------------------------------------------------------
do $$
declare f record; closed int := 0; kept int := 0;
begin
  for f in select p.oid::regprocedure as fn, n.nspname, p.proname
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('core', 'backend', 'erp', 'sellora', 'public') and p.prokind = 'f' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.fn);
    if exists (select 1 from e0_keep k where k.schema = f.nspname and k.fname = f.proname) then
      execute format('grant execute on function %s to anon, authenticated', f.fn);
      kept := kept + 1;
    else
      closed := closed + 1;
    end if;
    execute format('grant execute on function %s to service_role', f.fn);
  end loop;
  raise notice 'E0: % functions closed to browsers, % kept open', closed, kept;
end $$;

-- new functions made later in these schemas are closed to browsers unless granted on purpose
alter default privileges in schema core, backend, erp, sellora, public revoke execute on functions from public, anon, authenticated;

commit;

-- 3 · self-check (reads only) -------------------------------------------------------------------------------------------
with f as (
  select p.proname, bool_or(has_function_privilege('anon', p.oid, 'execute')) as anon_open,
         bool_and(has_function_privilege('service_role', p.oid, 'execute')) as server_ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'core' group by p.proname)
select case
  when (select count(*) from f where proname in ('sync_run','rt_value','fs_docs_put','sign_in_as_test','load_rows') and not anon_open and server_ok) = 5
   and (select count(*) from f where proname in ('rt_save','rt_get','rt_live_lists','next_no','rt_cas','fs_get') and anon_open) = 6
  then 'PASS · ' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname in ('core','backend','erp','sellora','public') and p.prokind = 'f'
                        and has_function_privilege('anon', p.oid, 'execute')) || ' functions still open to browsers'
  else 'FAIL · tell Claude (undo: select core.e0_undo();)' end as result;
