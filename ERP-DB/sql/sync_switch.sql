-- LIVE MIRROR · the OFF switch (12 Nov 2026). Paste once; then, without any ERP deploy:
--   stop the mirror:   insert into core.settings (key, value, note) values ('sync.mirror_off', 'true', 'Live mirror stopped by hand') on conflict (key) do update set value = 'true';
--   start it again:   update core.settings set value = 'false' where key = 'sync.mirror_off';
-- While it is off, the ERP's saves are answered "taken" and not kept (the ERP is never held up); the nightly check against
-- the backup brings over anything saved while it was off.
-- 14 Nov: DO NOT PASTE AGAIN — sql/sync_engine.sql now holds core.mirror (the same door + the instant run). Pasting this
-- file again would only take the instant run away (nothing breaks; saves then wait for the 10-second timer).
create or replace function core.mirror(p_changes jsonb, p_screen text default null) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  if core.me_id() is null and auth.role() is distinct from 'service_role' then raise exception 'mirror: not an ERP sign-in'; end if;
  if exists (select 1 from core.settings where key = 'sync.mirror_off' and value = 'true'::jsonb) then return 0; end if;   -- switched off by hand
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'mirror: changes must be a list'; end if;
  if jsonb_array_length(p_changes) > 2000 then raise exception 'mirror: at most 2,000 changes at once'; end if;
  if octet_length(p_changes::text) > 8000000 then raise exception 'mirror: at most 8 MB at once'; end if;
  insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
  select case when c->>'t' ~ '^\d{4}-\d{2}-\d{2}' then (c->>'t')::timestamptz end,
         coalesce(core.me_email(), 'server'),
         c->>'k', c->>'p', case when c->'v' = 'null'::jsonb then null else c->'v' end, left(p_screen, 80)
    from jsonb_array_elements(p_changes) c
   where c->>'k' in ('put', 'patch', 'delete') and coalesce(c->>'p', '') <> '';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.mirror(jsonb, text) from public;
grant execute on function core.mirror(jsonb, text) to anon, authenticated, service_role;
insert into core.settings (key, value, note) values ('sync.mirror_off', 'false', 'true = the live mirror takes nothing (see sql/sync_switch.sql)') on conflict (key) do nothing;

-- what the live mirror received today, per section and screen (to watch it after going live)
create or replace function core.sync_today()
returns table (section text, status text, saves bigint, first_at timestamptz, last_at timestamptz, people bigint)
language sql stable security definer set search_path = core, public as $$
  select coalesce(section, '(not moved yet)'), status, count(*), min(at), max(at), count(distinct email)
    from core.sync_inbox where at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
   group by 1, 2 order by 1, 2
$$;
revoke all on function core.sync_today() from public, anon, authenticated;
grant execute on function core.sync_today() to service_role;

select 1 as n, 'the switch exists and is ON (mirror running)' as check_name,
       case when exists (select 1 from core.settings where key = 'sync.mirror_off' and value = 'false'::jsonb) then 'PASS' else 'FAIL' end as result
union all select 2, 'the door still needs a real ERP sign-in',
       case when position('me_id' in pg_get_functiondef('core.mirror(jsonb,text)'::regprocedure)) > 0
             and position('sync.mirror_off' in pg_get_functiondef('core.mirror(jsonb,text)'::regprocedure)) > 0 then 'PASS' else 'FAIL' end;
