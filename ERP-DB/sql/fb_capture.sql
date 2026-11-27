-- FIREBASE CAPTURE DOOR (Ravi, 20 Nov: "Option A — do it"). Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- Firebase Cloud Functions (migration/firebase-capture) run on EVERY write to Firebase — Realtime Database and Firestore,
-- whoever writes (a screen, a script, the console) — and send the record as it now stands to this door within seconds.
-- The door puts each one into the inbox as a normal save (screen "firebase capture"); the engine (every 10 s) files it into
-- the tables exactly like any other save, and Firestore documents also land in the Firestore copy at once.
-- Server key only (the functions hold it as a Firebase secret). Nothing is ever written back to Firebase.
-- Bookkeeping lists (pt_sync, pt_syncAudit, pt_dataMeter) are ignored.

create or replace function core.fb_capture(p_changes jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int; fsd jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'fb_capture: server only'; end if;
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'fb_capture: changes must be a list'; end if;
  -- the inbox: in order, as saves the engine applies
  insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
  select coalesce((c->>'t')::timestamptz, now()), coalesce(nullif(c->>'by', ''), 'firebase'), c->>'k', trim(both '/' from c->>'p'),
         case when c->'v' = 'null'::jsonb then null else c->'v' end, 'firebase capture'
    from jsonb_array_elements(p_changes) c
   where c->>'k' in ('put', 'patch', 'delete') and coalesce(trim(both '/' from c->>'p'), '') <> ''
     and split_part(trim(both '/' from c->>'p'), '/', 1) not in ('pt_sync', 'pt_syncAudit', 'pt_dataMeter');
  get diagnostics n = row_count;
  -- Firestore documents: the live copy at once (whole document: put / delete)
  select coalesce(jsonb_agg(jsonb_build_object('k', c->>'k', 'p', substr(trim(both '/' from c->>'p'), 4), 'v', c->'v', 't', coalesce(c->>'t', now()::text))), '[]')
    into fsd
    from jsonb_array_elements(p_changes) c
   where trim(both '/' from c->>'p') like 'fs/%' and c->>'k' in ('put', 'delete')
     and array_length(string_to_array(trim(both '/' from c->>'p'), '/'), 1) = 3 and coalesce(c->>'project', 'price-research-48ff3') = 'price-research-48ff3';
  if jsonb_array_length(fsd) > 0 then perform core.fs_docs_put('price-research-48ff3', fsd); end if;
  return n;
end $$;
revoke all on function core.fb_capture(jsonb) from public, anon, authenticated;
grant execute on function core.fb_capture(jsonb) to service_role;

-- a quick look at how the capture is doing (the last hour)
create or replace view core.fb_capture_status as
select count(*) filter (where at > now() - interval '1 hour') as saves_last_hour,
       count(*) filter (where at > now() - interval '1 hour' and status = 'failed') as failed_last_hour,
       max(at) as newest
  from core.sync_inbox where screen = 'firebase capture';
revoke all on core.fb_capture_status from public, anon, authenticated;
notify pgrst, 'reload schema';

select case when to_regprocedure('core.fb_capture(jsonb)') is not null
             and not has_function_privilege('anon', 'core.fb_capture(jsonb)', 'execute')
            then 'PASS — the capture door is ready (server only)' else 'FAIL' end as result;
