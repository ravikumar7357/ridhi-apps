-- READ ONLY · part 3: everything after core.sy_hr_vendor, packed as one row per schema so the editor does not cut it at 100
select n.nspname as schema,
       count(*)  as how_many,
       string_agg(p.proname || case when p.prosecdef then '*' else '' end, ', ' order by p.proname) as functions_star_means_runs_as_owner
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname not in ('pg_catalog','information_schema','extensions','graphql','graphql_public','pgbouncer',
                         'realtime','storage','vault','auth','supabase_functions','net','cron','pgsodium','pgsodium_masks')
   and p.prokind = 'f'
   and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
   and (n.nspname, p.proname) > ('core', 'sy_hr_vendor')
 group by 1
 order by 1;
