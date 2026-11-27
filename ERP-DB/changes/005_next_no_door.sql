-- ERP-DB change 005 · ERP PAGES CAN ASK THE SERVER FOR THE NEXT NUMBER              written 27 Nov 2026 · run on live: ____
--
-- WHAT IT DOES
--   Adds core.next_no(kind, period, floor): the door ERP pages use to reach erp.next_no (change 002). Pages can only call
--   functions in the "core" schema, and they call as "anon" with the person's Firebase sign-in, which is checked here.
--   Used first by challans (RFD-/TRFD-) and embroidery challans (EMB-/TEMB-). If this door is missing or refuses, the
--   page keeps numbering exactly as today, so running this file late changes nothing.
--
-- EXAMPLE  select core.next_no('RFD', '202611', 12);   -- 13, or the next free number above what was handed out before
--
-- UNDO
--   drop function if exists core.next_no(text, text, int);
--
-- NEEDS: change 002. RUN: Supabase → SQL editor → paste → Run. The last line prints PASS.

create or replace function core.next_no(p_kind text, p_period text default '', p_floor int default 0) returns int
language plpgsql volatile security definer set search_path = core, erp, public as $$
begin
  if core.me_email() is null and auth.role() is distinct from 'service_role' then raise exception 'next_no: not an ERP sign-in'; end if;
  if p_kind !~ '^[A-Z]{2,8}$' then raise exception 'next_no: unknown kind %', p_kind; end if;
  if coalesce(p_period, '') !~ '^(\d{6})?$' then raise exception 'next_no: period must be YYYYMM'; end if;
  return erp.next_no(p_kind, coalesce(p_period, ''), greatest(coalesce(p_floor, 0), 0));
end $$;

revoke all on function core.next_no(text, text, int) from public;
grant execute on function core.next_no(text, text, int) to anon, authenticated, service_role;
notify pgrst, 'reload schema';

-- (the check does not call it: the SQL editor has no ERP sign-in, so it would refuse)
select case when has_function_privilege('anon', 'core.next_no(text, text, int)', 'execute')
            then 'PASS · ERP pages can ask for the next number' else 'FAIL · tell Claude' end as result;
