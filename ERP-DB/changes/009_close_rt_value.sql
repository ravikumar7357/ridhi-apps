-- ERP-DB change 009 · CLOSE core.rt_value TO BROWSERS (finishes 008)                written 28 Nov 2026 · run on live: ____
--
-- WHY: 008 kept core.rt_value open because two storage rules (bucket "board-reports") used it to ask "is this person
-- staff?". But rt_value reads ANY record with no rights check. This gives those rules a small function that answers
-- only that one question, only about the person asking, then closes rt_value.
--
-- The two rules keep exactly the same meaning: signed in, and either the superuser or has an entry in pt_perms.
--
-- UNDO:
--   grant execute on function core.rt_value(text) to anon, authenticated;
--   (the old rules: re-create them with core.rt_value(...) in place of core.me_is_staff())
--
-- RUN: Supabase -> SQL editor -> paste all -> Run. The last line prints PASS or FAIL.

begin;

create or replace function core.me_is_staff() returns boolean
language sql stable security definer set search_path = core, public as $$
  select core.me_email() is not null
     and (core.me_email() = 'ravi@thefabricrush.com'
          or core.rt_value('pt_perms/' || regexp_replace(core.me_email(), '\.', ',', 'g')) is not null)
$$;
revoke all on function core.me_is_staff() from public;
grant execute on function core.me_is_staff() to anon, authenticated, service_role;

drop policy if exists "board reports: staff add" on storage.objects;
create policy "board reports: staff add" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'board-reports' and core.me_is_staff());

drop policy if exists "board reports: staff sign" on storage.objects;
create policy "board reports: staff sign" on storage.objects for select to anon, authenticated
  using (bucket_id = 'board-reports' and core.me_is_staff());

revoke execute on function core.rt_value(text) from public, anon, authenticated;
grant execute on function core.rt_value(text) to service_role;

commit;

select case
  when not has_function_privilege('anon', 'core.rt_value(text)', 'execute')
   and has_function_privilege('service_role', 'core.rt_value(text)', 'execute')
   and has_function_privilege('anon', 'core.me_is_staff()', 'execute')
   and (select count(*) from pg_policies where policyname like 'board reports: staff %') = 2
   and not exists (select 1 from pg_policies where coalesce(qual,'') || coalesce(with_check,'') ~ 'rt_value\(')
  then 'PASS · rt_value closed to browsers; board reports use me_is_staff'
  else 'FAIL · tell Claude' end as result;
