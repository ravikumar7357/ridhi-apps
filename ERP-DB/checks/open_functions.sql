-- READ ONLY · which database functions can a browser (the public key) run today?
-- Run: Supabase -> SQL editor -> paste -> Run -> download the result as CSV and send it to Claude.
select n.nspname                                   as schema,
       p.proname                                   as function,
       pg_get_function_identity_arguments(p.oid)   as args,
       p.prosecdef                                 as runs_as_owner,
       has_function_privilege('anon', p.oid, 'execute')          as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as signed_in_can_run
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname not in ('pg_catalog', 'information_schema', 'extensions', 'graphql', 'graphql_public', 'pgbouncer',
                         'realtime', 'storage', 'vault', 'auth', 'supabase_functions', 'net', 'cron', 'pgsodium', 'pgsodium_masks')
   and p.prokind = 'f'
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
 order by 1, 2;
