-- READ ONLY · why did 008's self-check say FAIL? One row per checked function.
select p.proname as function,
       pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid, 'execute')         as browser_can_run,
       has_function_privilege('service_role', p.oid, 'execute') as server_can_run,
       case when p.proname in ('sync_run','rt_value','fs_docs_put','sign_in_as_test','load_rows') then 'should be CLOSED' else 'should be OPEN' end as expected
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'core'
   and p.proname in ('sync_run','rt_value','fs_docs_put','sign_in_as_test','load_rows','rt_save','rt_get','rt_live_lists','next_no','rt_cas','fs_get')
union all
select 'saved copy rows', (select count(*)::text from core.e0_saved_grants), null, null, 'should be more than 0'
 order by 1;
