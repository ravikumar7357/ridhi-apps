-- =====================================================================================================================
-- LIVE MIRROR · step 1 (12 Nov 2026) — every save the ERP makes in Firebase is also sent here, as it is.
--
--   ERP Save → Firebase (as today) → core.mirror(changes)  → core.sync_inbox   (this file)
--                                     the processor reads the inbox → the same loaders' rules → the section tables
--
-- The ERP never waits for this and is never stopped by it. Nothing is ever deleted: a record deleted in Firebase stays in
-- its table and is listed in core.sync_gone with the time it went. Paste the whole file into the SQL Editor of ERP TEST.
-- Safe to paste again.
-- =====================================================================================================================

-- 1 · the inbox: one row per changed path, exactly as the ERP sent it
create table if not exists core.sync_inbox (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),          -- when Supabase got it
  saved_at  timestamptz,                                 -- when the ERP saved it in Firebase (the browser's clock)
  email     text,                                        -- who saved it: from the sign-in, never from the browser's word
  kind      text not null check (kind in ('put', 'patch', 'delete')),
  path      text not null,                               -- the Firebase path, e.g. pt_orderBook/123/status · Firestore: fs/po/<doc>
  value     jsonb,                                       -- what was written there (null = removed)
  screen    text,                                        -- which ERP screen saved it
  status    text not null default 'new' check (status in ('new', 'applied', 'done', 'not_moved_yet', 'failed')),
  section   text,                                        -- control · masters · skus · orders · stock (set by the processor)
  error     text,
  done_at   timestamptz
);
create index if not exists sync_inbox_new on core.sync_inbox (id) where status in ('new', 'applied');
create index if not exists sync_inbox_path on core.sync_inbox (path, id desc);
alter table core.sync_inbox enable row level security;      -- no table rights for browsers: only the doors below
comment on table core.sync_inbox is 'Every change the ERP saved in Firebase, sent here as it was — the live mirror''s inbox. Never emptied.';

-- 2 · records deleted in Firebase: the row stays in its table, this says since when it is gone
create table if not exists core.sync_gone (
  tbl         text not null,                             -- schema.table
  legacy_key  text not null,
  gone_since  timestamptz not null default now(),
  primary key (tbl, legacy_key)
);
alter table core.sync_gone enable row level security;
comment on table core.sync_gone is 'Rows whose Firebase record was deleted. The row itself is kept; nothing is removed.';

-- 3 · THE DOOR THE ERP CALLS after every save.  p_changes = [{ "k": "put|patch|delete", "p": "<path>", "v": <value>, "t": "<saved at>" }, …]
--     Only a signed-in ERP person (Firebase sign-in checked by Supabase), or the server key. Answers how many were taken.
create or replace function core.mirror(p_changes jsonb, p_screen text default null) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  if core.me_id() is null and auth.role() is distinct from 'service_role' then raise exception 'mirror: not an ERP sign-in'; end if;
  if exists (select 1 from core.settings where key = 'sync.mirror_off' and value = 'true'::jsonb) then return 0; end if;   -- the OFF switch (sync_switch.sql)
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
grant execute on function core.mirror(jsonb, text) to anon, authenticated, service_role;   -- anon = a Firebase sign-in; refused without a real ERP person

-- 4 · the processor's doors (server key only)
-- take the oldest new changes
create or replace function core.sync_take(p_n int default 500)
returns table (id bigint, kind text, path text, value jsonb, saved_at timestamptz, at timestamptz)
language sql security definer set search_path = core, public as $$
  select i.id, i.kind, i.path, i.value, i.saved_at, i.at from core.sync_inbox i
   where i.status = 'new' order by i.id limit greatest(1, least(p_n, 5000))
$$;
-- after the change is in the processor's copy: applied (waiting for its section to load) or not moved yet / failed
create or replace function core.sync_mark(p_ids bigint[], p_status text, p_section text default null, p_error text default null) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  if p_status not in ('applied', 'not_moved_yet', 'failed') then raise exception 'sync_mark: % is not a status', p_status; end if;
  update core.sync_inbox set status = p_status, section = coalesce(p_section, section), error = p_error,
         done_at = case when p_status = 'applied' then null else now() end
   where id = any(p_ids);
  get diagnostics n = row_count; return n;
end $$;
-- a section loaded: every applied change of it is done · or it failed: the reason is noted, the changes wait for the retry
create or replace function core.sync_section(p_section text, p_ok boolean, p_error text default null, p_upto bigint default null) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  if p_ok then
    update core.sync_inbox set status = 'done', error = null, done_at = now()
     where section = p_section and status = 'applied' and (p_upto is null or id <= p_upto);
  else
    update core.sync_inbox set error = left(p_error, 2000) where section = p_section and status = 'applied' and (p_upto is null or id <= p_upto);
  end if;
  get diagnostics n = row_count; return n;
end $$;
-- every row of one section table: legacy_key → fingerprint — one answer, no paging. A table without a saved fp column
-- (fabrics, colour groups …) gets it made here from its firebase record; a table with neither answers null.
create or replace function core.sync_fps(p_table text) returns jsonb
language plpgsql stable security definer set search_path = core, public as $$
declare s text; t text; has_fp boolean; has_fb boolean; r jsonb;
begin
  s := split_part(p_table, '.', 1); t := split_part(p_table, '.', 2);
  if s not in ('core', 'sales', 'production', 'shipping', 'archive', 'stock', 'hr', 'planning', 'history') or t = '' then raise exception 'sync_fps: % is not a section table', p_table; end if;
  if not exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'legacy_key') then
    raise exception 'sync_fps: % has no legacy_key', p_table; end if;
  has_fp := exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'fp');
  has_fb := exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'firebase');
  execute format('select coalesce(jsonb_object_agg(legacy_key, %s), ''{}''::jsonb) from %I.%I where legacy_key is not null',
                 case when has_fp then 'fp'
                      when has_fb then 'case when firebase is null then null else encode(sha256(convert_to(firebase::text, ''UTF8'')), ''hex'') end'
                      else 'null::text' end, s, t) into r;
  return r;
end $$;
-- p_gone = ALL keys of this table that Firebase no longer has: new ones are listed (since now), ones back in Firebase leave the list.
-- Only the list changes — the data rows are never touched.
create or replace function core.sync_gone_set(p_table text, p_gone text[]) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int := 0; m int;
begin
  insert into core.sync_gone (tbl, legacy_key) select p_table, k from unnest(coalesce(p_gone, '{}')) k on conflict do nothing;
  get diagnostics n = row_count;
  delete from core.sync_gone where tbl = p_table and not (legacy_key = any(coalesce(p_gone, '{}')));   -- a list entry only, never a data row
  get diagnostics m = row_count;
  return n + m;
end $$;
-- how the mirror is doing (counts only)
create or replace function core.sync_status()
returns table (status text, section text, n bigint, oldest timestamptz, newest timestamptz)
language sql stable security definer set search_path = core, public as $$
  select status, coalesce(section, '—'), count(*), min(at), max(at) from core.sync_inbox group by 1, 2
  union all select 'gone (kept, marked)', tbl, count(*), min(gone_since), max(gone_since) from core.sync_gone group by 2
  order by 1, 2
$$;
revoke all on function core.sync_take(int), core.sync_mark(bigint[], text, text, text), core.sync_section(text, boolean, text, bigint),
                       core.sync_fps(text), core.sync_gone_set(text, text[]), core.sync_status() from public, anon, authenticated;
grant execute on function core.sync_take(int), core.sync_mark(bigint[], text, text, text), core.sync_section(text, boolean, text, bigint),
                          core.sync_fps(text), core.sync_gone_set(text, text[]), core.sync_status() to service_role;

-- 5 · checks
notify pgrst, 'reload schema';
select 1 as n, 'inbox and gone list exist, closed to browsers' as check_name,
       case when to_regclass('core.sync_inbox') is not null and to_regclass('core.sync_gone') is not null
             and not has_table_privilege('anon', 'core.sync_inbox', 'select') and not has_table_privilege('anon', 'core.sync_inbox', 'insert')
             and not has_table_privilege('authenticated', 'core.sync_inbox', 'select') then 'PASS' else 'FAIL' end as result
union all select 2, 'the ERP door needs a real ERP sign-in (or the server key)',
       case when has_function_privilege('anon', 'core.mirror(jsonb,text)', 'execute')
             and position('me_id' in pg_get_functiondef('core.mirror(jsonb,text)'::regprocedure)) > 0 then 'PASS' else 'FAIL' end
union all select 3, 'browsers cannot use the processor doors',
       case when not has_function_privilege('anon', 'core.sync_take(int)', 'execute') and not has_function_privilege('authenticated', 'core.sync_fps(text)', 'execute')
             and not has_function_privilege('anon', 'core.sync_gone_set(text,text[])', 'execute') then 'PASS' else 'FAIL' end
union all select 4, 'the fingerprint list answers for a section table',
       case when jsonb_typeof(core.sync_fps('production.order_book')) = 'object' then 'PASS' else 'FAIL' end
union all select 5, 'nothing can be deleted from the inbox by the doors',
       case when position('delete from core.sync_inbox' in pg_get_functiondef('core.sync_section(text,boolean,text,bigint)'::regprocedure)) = 0
             and position('delete from core.sync_inbox' in pg_get_functiondef('core.sync_mark(bigint[],text,text,text)'::regprocedure)) = 0 then 'PASS' else 'FAIL' end;
