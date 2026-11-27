-- THE WAY BACK — TEST MODE (20 Nov, Ravi: "test it"). Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- To prove the way back (ERP data → Firebase) works before switch day WITHOUT copying anybody's test-link saves into the live
-- Firebase: a test mode that copies ONLY saves under one private test path (pt_r1waytest/… and fs/r1waytest/…), nothing else.
--   start:  select core.fb_pushback_test('pt_r1waytest');     end:  select core.fb_pushback_test(null);
-- While the real switch is off and no test is running, nothing is copied (as before).

alter table core.fb_pushback_state add column if not exists test_prefix text;

create or replace function core.fb_pushback_test(p_prefix text) returns text
language plpgsql security definer set search_path = core, public as $$
begin
  if auth.role() is distinct from 'service_role' and current_user not in ('postgres', 'supabase_admin') then raise exception 'fb_pushback_test: server only'; end if;
  if p_prefix is not null and p_prefix !~ '^pt_r1[a-z]*test$' then raise exception 'fb_pushback_test: only a pt_r1…test path'; end if;
  if (select on_ from core.fb_pushback_state where id = 1) then raise exception 'fb_pushback_test: the real way back is ON — no test'; end if;
  update core.fb_pushback_state set test_prefix = p_prefix,
         upto = case when p_prefix is null then null else (select coalesce(max(id), 0) from core.sync_inbox) end where id = 1;
  return case when p_prefix is null then 'test ended — way back OFF' else 'TEST: only ' || p_prefix || '/… and fs/' || substr(p_prefix, 4) || '/… are copied to Firebase' end;
end $$;
revoke all on function core.fb_pushback_test(text) from public, anon, authenticated;
grant execute on function core.fb_pushback_test(text) to service_role;

create or replace function core.fb_pushback_take(p_max int default 300) returns jsonb
language plpgsql security definer set search_path = core, public as $$
declare st core.fb_pushback_state; rows jsonb; last_id bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'fb_pushback_take: server only'; end if;
  select * into st from core.fb_pushback_state where id = 1;
  if not st.on_ and st.test_prefix is null then return jsonb_build_object('on', false, 'rows', '[]'::jsonb); end if;
  select coalesce(min(id) - 1, (select max(id) from core.sync_inbox)) into last_id
    from core.sync_inbox where id > st.upto and status = 'new';
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'k', i.kind, 'p', i.path, 'v', i.value) order by i.id), '[]'::jsonb)
    into rows
    from (select id, kind, path, value from core.sync_inbox
           where id > st.upto and id <= last_id and status in ('done', 'failed') and not core.fb_from_firebase(screen)
             and split_part(path, '/', 1) not in ('pt_sync', 'pt_syncAudit', 'pt_dataMeter')
             and not (path like 'fs/config/%')
             and (st.on_ or split_part(path, '/', 1) = st.test_prefix or path like 'fs/' || substr(st.test_prefix, 4) || '/%')
           order by id limit p_max) i;
  return jsonb_build_object('on', true, 'test', st.test_prefix, 'upto', st.upto, 'through',
    case when jsonb_array_length(rows) >= p_max then (rows -> -1 ->> 'id')::bigint else last_id end, 'rows', rows);
end $$;
revoke all on function core.fb_pushback_take(int) from public, anon, authenticated;
grant execute on function core.fb_pushback_take(int) to service_role;

-- the test's own saves: written straight into the inbox by the test tool (server key), as a screen's save would be
create or replace function core.fb_pushback_test_save(p_changes jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int; st core.fb_pushback_state;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'server only'; end if;
  select * into st from core.fb_pushback_state where id = 1;
  if st.test_prefix is null then raise exception 'start the test first'; end if;
  if exists (select 1 from jsonb_array_elements(p_changes) c where split_part(c->>'p', '/', 1) <> st.test_prefix and c->>'p' not like 'fs/' || substr(st.test_prefix, 4) || '/%')
    then raise exception 'only the test path'; end if;
  insert into core.sync_inbox (saved_at, email, kind, path, value, screen, status)
  select now(), 'way back test', c->>'k', c->>'p', case when c->'v' = 'null'::jsonb then null else c->'v' end, 'way back test', 'done'
    from jsonb_array_elements(p_changes) c;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.fb_pushback_test_save(jsonb) from public, anon, authenticated;
grant execute on function core.fb_pushback_test_save(jsonb) to service_role;

-- the echo marks, registered BEFORE the way back writes (Firebase's capture can answer within a second of the write)
create or replace function core.fb_pushback_expect(p_written jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'server only'; end if;
  insert into core.fb_pushed (path, h)
  select trim(both '/' from w->>'p'), md5(coalesce(w->'v', 'null'::jsonb)::text) from jsonb_array_elements(coalesce(p_written, '[]')) w;
  get diagnostics n = row_count;
  delete from core.fb_pushed where at < now() - interval '15 minutes';
  return n;
end $$;
revoke all on function core.fb_pushback_expect(jsonb) from public, anon, authenticated;
grant execute on function core.fb_pushback_expect(jsonb) to service_role;

notify pgrst, 'reload schema';
select case when to_regprocedure('core.fb_pushback_test(text)') is not null
             and to_regprocedure('core.fb_pushback_expect(jsonb)') is not null
             and position('test_prefix' in pg_get_functiondef('core.fb_pushback_take(int)'::regprocedure)) > 0
             and (select not on_ and test_prefix is null from core.fb_pushback_state)
            then 'PASS — the way back can be tested on pt_r1waytest only (real way back still OFF)' else 'FAIL' end as result;
