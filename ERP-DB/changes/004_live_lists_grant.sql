-- ERP-DB change 004 · LET ERP PAGES CALL rt_live_lists                             written 27 Nov 2026 · run on live: ____
--
-- WHY
--   ERP pages call ERP data with the publishable key and the person's Firebase sign-in, which arrives as the role "anon"
--   (the sign-in itself is checked inside each function with core.me_email()). Change 003 granted rt_live_lists only to
--   "authenticated", so pages got "permission denied" (found on the test link, 27 Nov). rt_live_upto is granted the same
--   way as this: anon + authenticated, with the sign-in check inside.
--
-- UNDO
--   revoke execute on function core.rt_live_lists(bigint) from anon;
--
-- RUN: Supabase → SQL editor → paste → Run. The last line prints PASS.

grant execute on function core.rt_live_lists(bigint) to anon;
notify pgrst, 'reload schema';

select case when has_function_privilege('anon', 'core.rt_live_lists(bigint)', 'execute')
            then 'PASS · ERP pages may ask which lists changed' else 'FAIL · tell Claude' end as result;
