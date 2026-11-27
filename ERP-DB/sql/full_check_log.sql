-- THE FULL NIGHTLY CHECK'S LOG (20 Nov, Ravi: "do all of that"). Paste into ERP data → SQL editor → Run. Last line: PASS.
--
-- A Firebase function (migration/firebase-capture → fullCheck) now compares EVERYTHING every night at 2:45 AM India time, with
-- full access on both sides: every Firestore collection (the nightly checker never covered Firestore — Sellora's listing,
-- PPC and history data were days old on 20 Nov) and every Realtime Database list, the 5 big ones too (the Apps Script
-- checker kept running out of time on them). Whatever differs is copied from Firebase into ERP data through the capture door.
-- One row per run per database here; core.full_check_last shows the newest.

create table if not exists core.full_check_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  db text not null,                -- 'firestore' | 'rtdb'
  how text,                        -- 'nightly' | 'now (<email>)'
  lists int, records bigint, differ int, copied int, deleted int,
  secs numeric, detail jsonb, error text
);
alter table core.full_check_log enable row level security;
revoke all on core.full_check_log from anon, authenticated;

create or replace function core.full_check_note(p jsonb) returns bigint
language plpgsql security definer set search_path = core, public as $$
declare i bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'full_check_note: server only'; end if;
  insert into core.full_check_log (db, how, lists, records, differ, copied, deleted, secs, detail, error)
  values (p->>'db', p->>'how', (p->>'lists')::int, (p->>'records')::bigint, (p->>'differ')::int, (p->>'copied')::int,
          (p->>'deleted')::int, (p->>'secs')::numeric, p->'detail', p->>'error')
  returning id into i;
  return i;
end $$;
revoke all on function core.full_check_note(jsonb) from public, anon, authenticated;
grant execute on function core.full_check_note(jsonb) to service_role;

create or replace view core.full_check_last as
select distinct on (db) db, at, how, lists, records, differ, copied, deleted, secs, error, detail
  from core.full_check_log order by db, at desc;
revoke all on core.full_check_last from public, anon, authenticated;

-- the Firestore copier's and the checks' saves came FROM Firebase: never copied back by the way back
create or replace function core.fb_from_firebase(p_screen text) returns boolean language sql immutable as $$
  select coalesce(p_screen, '') in ('firebase capture', 'replay from test', 'pricing api double write', 'firestore copier', 'nightly checker')
      or coalesce(p_screen, '') like '%catch-up from Firebase%'
$$;

notify pgrst, 'reload schema';
select case when to_regclass('core.full_check_log') is not null
             and not has_function_privilege('anon', 'core.full_check_note(jsonb)', 'execute')
             and core.fb_from_firebase('firestore copier')
            then 'PASS — the full check can log its runs' else 'FAIL' end as result;
