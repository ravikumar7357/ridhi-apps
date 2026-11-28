-- READ ONLY · which access rules use core.rt_value (that is why 008 kept it open)
select schemaname, tablename, policyname, roles::text, cmd, qual, with_check
  from pg_policies
 where coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ 'rt_value\(';
