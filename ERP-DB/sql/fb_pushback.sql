-- THE WAY BACK (Ravi, 20 Nov: "make a way back also"). Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- After the switch the ERP and Sellora save to ERP data (Supabase) only. This copies every one of those saves BACK to Firebase
-- (a Firebase function, migration/firebase-capture → pushBack, every minute), so:
--   • the Apps Script jobs, which read Firebase, keep seeing today's data;
--   • going back to Firebase (shared/erp-data/mode.json → "firebase") loses nothing.
--
-- OFF UNTIL SWITCH DAY. While it is off nothing is copied — so the test link's saves (made in ERP data) never reach the live
-- Firebase. On switch day:  select core.fb_pushback_switch(true);   It starts from the newest save at that moment.
--
-- What is copied: saves made in ERP data by people (the ERP, Sellora, the test links after the switch). NOT copied — they came
-- FROM Firebase already: "firebase capture", the catch-up ("replay from test", "… catch-up from Firebase"), and the Pricing
-- API's double write.
-- ECHO: Firebase's capture sees the copied record and sends it back here; that echo is recognised (same record, same value,
-- within 15 minutes) and dropped, so a newer save made in the meantime is never overwritten by an old echo.

create table if not exists core.fb_pushback_state (
  id int primary key default 1 check (id = 1),
  on_ boolean not null default false,
  upto bigint,                       -- the last inbox id copied (or skipped)
  switched_at timestamptz,
  last_run timestamptz, last_n int, last_error text, copied bigint not null default 0
);
insert into core.fb_pushback_state (id) values (1) on conflict do nothing;
alter table core.fb_pushback_state enable row level security;
revoke all on core.fb_pushback_state from anon, authenticated;

create table if not exists core.fb_pushed (
  path text not null, h text not null, at timestamptz not null default now()
);
create index if not exists fb_pushed_path on core.fb_pushed (path, h);
alter table core.fb_pushed enable row level security;
revoke all on core.fb_pushed from anon, authenticated;

-- which inbox rows came FROM Firebase (never copied back)
create or replace function core.fb_from_firebase(p_screen text) returns boolean language sql immutable as $$
  select coalesce(p_screen, '') in ('firebase capture', 'replay from test', 'pricing api double write')
      or coalesce(p_screen, '') like '%catch-up from Firebase%'
$$;

-- the switch (server key or the SQL editor)
create or replace function core.fb_pushback_switch(p_on boolean) returns text
language plpgsql security definer set search_path = core, public as $$
begin
  if auth.role() is distinct from 'service_role' and current_user not in ('postgres', 'supabase_admin') then raise exception 'fb_pushback_switch: server only'; end if;
  if p_on then
    update core.fb_pushback_state set on_ = true, switched_at = now(),
           upto = coalesce(upto, (select coalesce(max(id), 0) from core.sync_inbox)) where id = 1;
  else
    update core.fb_pushback_state set on_ = false where id = 1;
  end if;
  return (select case when on_ then 'ON — copying saves after inbox #' || upto || ' back to Firebase' else 'OFF — nothing is copied back' end from core.fb_pushback_state);
end $$;

-- the function asks: the next saves to copy (in order), only applied ones, only when on
create or replace function core.fb_pushback_take(p_max int default 300) returns jsonb
language plpgsql security definer set search_path = core, public as $$
declare st core.fb_pushback_state; rows jsonb; last_id bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'fb_pushback_take: server only'; end if;
  select * into st from core.fb_pushback_state where id = 1;
  if not st.on_ then return jsonb_build_object('on', false, 'rows', '[]'::jsonb); end if;
  -- stop at the first save the engine has not finished yet (new): order is kept, nothing is skipped
  select coalesce(min(id) - 1, (select max(id) from core.sync_inbox)) into last_id
    from core.sync_inbox where id > st.upto and status = 'new';
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'k', i.kind, 'p', i.path, 'v', i.value) order by i.id), '[]'::jsonb)
    into rows
    from (select id, kind, path, value from core.sync_inbox
           where id > st.upto and id <= last_id and status in ('done', 'failed') and not core.fb_from_firebase(screen)
             and split_part(path, '/', 1) not in ('pt_sync', 'pt_syncAudit', 'pt_dataMeter')
             and not (path like 'fs/config/%')
           order by id limit p_max) i;
  return jsonb_build_object('on', true, 'upto', st.upto, 'through',
    case when jsonb_array_length(rows) >= p_max then (rows -> -1 ->> 'id')::bigint else last_id end, 'rows', rows);
end $$;

-- the function reports: copied up to here; these records now stand in Firebase like this (for the echo check)
create or replace function core.fb_pushback_done(p_through bigint, p_written jsonb, p_n int, p_error text default null) returns void
language plpgsql security definer set search_path = core, public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'fb_pushback_done: server only'; end if;
  insert into core.fb_pushed (path, h)
  select trim(both '/' from w->>'p'), md5(coalesce(w->'v', 'null'::jsonb)::text) from jsonb_array_elements(coalesce(p_written, '[]')) w;
  delete from core.fb_pushed where at < now() - interval '15 minutes';
  update core.fb_pushback_state set upto = greatest(coalesce(upto, 0), coalesce(p_through, upto)), last_run = now(), last_n = p_n,
         last_error = p_error, copied = copied + coalesce(p_n, 0) where id = 1;
end $$;

revoke all on function core.fb_pushback_switch(boolean), core.fb_pushback_take(int), core.fb_pushback_done(bigint, jsonb, int, text) from public, anon, authenticated;
grant execute on function core.fb_pushback_switch(boolean), core.fb_pushback_take(int), core.fb_pushback_done(bigint, jsonb, int, text) to service_role;

-- THE CAPTURE DOOR, with the echo check: a record that is exactly what the way back just wrote is dropped (once)
create or replace function core.fb_capture(p_changes jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int; fsd jsonb; ch jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'fb_capture: server only'; end if;
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'fb_capture: changes must be a list'; end if;
  -- echoes of the way back: dropped (each one only once)
  with c as (select x, trim(both '/' from x->>'p') p, md5(coalesce(x->'v', 'null'::jsonb)::text) h from jsonb_array_elements(p_changes) x),
       hit as (delete from core.fb_pushed f using c where f.path = c.p and f.h = c.h returning c.p, c.h)
  select coalesce(jsonb_agg(c.x), '[]'::jsonb) into ch from c where not exists (select 1 from hit where hit.p = c.p and hit.h = c.h);
  insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
  select coalesce((c->>'t')::timestamptz, now()), coalesce(nullif(c->>'by', ''), 'firebase'), c->>'k', trim(both '/' from c->>'p'),
         case when c->'v' = 'null'::jsonb then null else c->'v' end, 'firebase capture'
    from jsonb_array_elements(ch) c
   where c->>'k' in ('put', 'patch', 'delete') and coalesce(trim(both '/' from c->>'p'), '') <> ''
     and split_part(trim(both '/' from c->>'p'), '/', 1) not in ('pt_sync', 'pt_syncAudit', 'pt_dataMeter');
  get diagnostics n = row_count;
  select coalesce(jsonb_agg(jsonb_build_object('k', c->>'k', 'p', substr(trim(both '/' from c->>'p'), 4), 'v', c->'v', 't', coalesce(c->>'t', now()::text))), '[]')
    into fsd
    from jsonb_array_elements(ch) c
   where trim(both '/' from c->>'p') like 'fs/%' and c->>'k' in ('put', 'delete')
     and array_length(string_to_array(trim(both '/' from c->>'p'), '/'), 1) = 3 and coalesce(c->>'project', 'price-research-48ff3') = 'price-research-48ff3';
  if jsonb_array_length(fsd) > 0 then perform core.fs_docs_put('price-research-48ff3', fsd); end if;
  return n;
end $$;
revoke all on function core.fb_capture(jsonb) from public, anon, authenticated;
grant execute on function core.fb_capture(jsonb) to service_role;

create or replace view core.fb_pushback_status as
select s.on_ as on, s.switched_at, s.upto, s.last_run, s.last_n, s.last_error, s.copied,
       (select count(*) from core.sync_inbox i where i.id > coalesce(s.upto, 0) and not core.fb_from_firebase(i.screen)) as waiting
  from core.fb_pushback_state s;
revoke all on core.fb_pushback_status from public, anon, authenticated;
notify pgrst, 'reload schema';

select case when to_regprocedure('core.fb_pushback_take(int)') is not null
             and not has_function_privilege('anon', 'core.fb_pushback_take(int)', 'execute')
             and not has_function_privilege('authenticated', 'core.fb_pushback_switch(boolean)', 'execute')
             and (select not on_ from core.fb_pushback_state)
            then 'PASS — the way back is ready and OFF (switch day: select core.fb_pushback_switch(true);)' else 'FAIL' end as result;
