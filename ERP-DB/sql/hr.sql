-- =====================================================================================
-- SECTION 7 · HR / PEOPLE & PAY — schema hr (workers, attendance, extra hours, piece rates, team sizes, headcounts)
--            + 4 login / vendor lists in core + the old RTDB copy of access rights in archive.
-- Ravi, 12 Nov: design page migration/hr-design.html — D1 … D8 all OK.
-- NEEDS: core (access, control, masters, skus, speed), orders.sql (archive), sync.sql.  WHERE: ERP TEST (Mumbai).
-- HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: the last result is a list of checks — every row must say PASS.  Then: Data API → Exposed schemas → tick "hr".
-- DATA: loaded from Ravi's PC by migration/tools/load-hr.js (next step), built by make-hr.js from the newest backup.
--
-- Rules kept here:  nothing is removed · every Firebase field its own column · every row keeps its Firebase record (firebase)
--                   and its fingerprint (fp) · links are added beside the text, never instead of it.
-- D2: pt_empList and pt_rateList are plain lists (no IDs, rewritten whole on every save). So their legacy_key is NOT the place
--     number (that moves when a line above is deleted) but a lasting key: type|name|department (workers) and
--     article|subtype|size|for (rates). The place number is kept in line_no, and the fingerprint door answers by place.
-- D5: browsers can read none of these tables (as every section). The two helpers below are what any later read door uses:
--     people (names, phones) → admin · Finance & HR screen · "Add, change, remove employees"
--     pay (rates, extra hours, team sizes, headcounts, locks, advances) → admin · Finance & HR screen
--     (the same split the ERP makes today: the employee-list right alone does not show pay).
-- =====================================================================================

create schema if not exists hr;
revoke all on schema hr from public, anon, authenticated;
grant usage on schema hr to service_role;
alter default privileges in schema hr revoke all on tables from anon, authenticated;
alter default privileges in schema hr grant all on tables to service_role;
alter default privileges in schema hr grant all on sequences to service_role;
create schema if not exists archive;

-- ===================================================================== 1 · hr tables
create table if not exists hr.workers (                       -- pt_empList: [type, name, department, phone]
  id                  bigint generated always as identity primary key,   -- D2: the lasting worker id
  line_no             int,                                    -- place in the Firebase list (0 = first), as it is today
  worker_key          text not null,                          -- type|name|department, small letters (+ #2 for an exact repeat)
  emp_type            text,                                   -- [0] Company Role / Company Contractor / External Contractor
  name                text,                                   -- [1] as written
  department          text,                                   -- [2] as written
  phone               text,                                   -- [3] as written
  department_id       bigint references core.departments (id),
  employment_type_id  bigint references core.employment_types (id),
  mark                text                                    -- D3: "same name in 2 departments" · "exact repeat" · "placeholder name"
);
comment on table hr.workers is 'From Firebase: pt_empList — one row per line, nothing merged. id = the lasting worker id.';

create table if not exists hr.attendance (                    -- pt_attend/<day__NAME>
  id              bigint generated always as identity primary key,
  fb_key          text,         -- _key
  fb_id           text,         -- id
  day             date,         -- day
  emp_name        text,         -- empName
  emp_type        text,         -- empType
  dept            text,         -- dept
  status          text,         -- status (P / A)
  in_at           text,         -- inAt (as written)
  out_at          text,         -- outAt (as written)
  remarks         text,         -- remarks
  marked_at       timestamptz,  -- markedAt
  marked_by       text,         -- markedBy
  updated_at_fb   timestamptz,  -- updatedAt
  updated_by_fb   text,         -- updatedBy
  worker_id       bigint references hr.workers (id),          -- D4
  mark            text
);
comment on table hr.attendance is 'From Firebase: pt_attend';

create table if not exists hr.extra_hours (                   -- pt_extraHours/<eh_…>
  id                   bigint generated always as identity primary key,
  fb_id                text,         -- id
  day                  date,         -- date
  emp_name             text,         -- empName
  department           text,         -- department
  from_time            text,         -- fromTime (as written, HH:MM)
  to_time              text,         -- toTime
  hours                numeric,      -- hours
  status               text,         -- status
  remarks              text,         -- remarks
  entered_at           timestamptz,  -- enteredAt
  entered_by           text,         -- enteredBy
  entered_by_name      text,         -- enteredByName
  authorized_at        timestamptz,  -- authorizedAt
  authorized_by        text,         -- authorizedBy
  authorized_by_name   text,         -- authorizedByName
  edited_at            timestamptz,  -- editedAt
  edited_by            text,         -- editedBy
  worker_id            bigint references hr.workers (id),
  mark                 text
);
comment on table hr.extra_hours is 'From Firebase: pt_extraHours';

create table if not exists hr.piece_rates (                   -- pt_rateList: [article type, subtype, size, applicable for, rate, commission]
  id                bigint generated always as identity primary key,
  line_no           int,
  rate_key          text not null,                            -- article|subtype|size|for, small letters
  article_type      text,         -- [0]
  subtype           text,         -- [1]
  size              text,         -- [2]
  applicable_for    text,         -- [3]
  rate              numeric,      -- [4]
  commission        numeric,      -- [5] when it is a number
  commission_text   text,         -- [5] as written ("NA" …)  — D6
  article_type_id   bigint references core.article_types (id),
  subtype_id        bigint references core.article_subtypes (id),
  size_id           bigint references core.sizes (id),
  mark              text                                       -- D6: "type looks wrong"
);
comment on table hr.piece_rates is 'From Firebase: pt_rateList — pay per piece.';

create table if not exists hr.team_sizes (                    -- pt_teamSize/<key>/sizes/<n>  — D7 one row per change
  id          bigint generated always as identity primary key,
  team_key    text,         -- the Firebase key (contractor name, small letters)
  name        text,         -- name
  change_no   int,          -- place in sizes
  from_day    date,         -- sizes[].from
  headcount   numeric,      -- sizes[].n
  at_time     timestamptz,  -- sizes[].at
  by_email    text,         -- sizes[].by
  worker_id   bigint references hr.workers (id)
);
comment on table hr.team_sizes is 'From Firebase: pt_teamSize — how many people a contractor has, from which day.';

create table if not exists hr.contractor_heads (              -- pt_contractorHeads/<week>/<contractor key>  (+ _settings/target)
  id              bigint generated always as identity primary key,
  week            text,         -- the week key (a day) or _settings
  contractor_key  text,         -- the Firebase key
  heads           numeric,      -- when it is a number
  value           jsonb,        -- as written
  worker_id       bigint references hr.workers (id)
);
comment on table hr.contractor_heads is 'From Firebase: pt_contractorHeads — weekly headcount per contractor, and the weekly target.';

-- D8: the ERP reads these, Firebase has nothing there yet — ready for the first save
create table if not exists hr.extra_hours_locks (id bigint generated always as identity primary key, fb_key text, value jsonb);
comment on table hr.extra_hours_locks is 'From Firebase: pt_ehFreezes (month locks for extra hours) — empty today.';
create table if not exists hr.payout_locks (id bigint generated always as identity primary key, fb_key text, value jsonb);
comment on table hr.payout_locks is 'From Firebase: pt_payoutFreezes (a paid fortnight must not move) — empty today.';
create table if not exists hr.advances (id bigint generated always as identity primary key, fb_key text, value jsonb);
comment on table hr.advances is 'From Firebase: pt_advances — empty today.';

-- ===================================================================== 2 · the login / vendor lists (core) and the old rights copy (archive)
create table if not exists core.login_directory (             -- pt_loginDir/<phone>
  id              bigint generated always as identity primary key,
  phone           text,         -- the key
  email           text,         -- email
  name            text,         -- name
  updated_at_fb   timestamptz,  -- updatedAt
  person_id       bigint references core.people (id)
);
comment on table core.login_directory is 'From Firebase: pt_loginDir — phone number → sign-in email.';

create table if not exists core.vendor_logins (               -- pt_vendorByEmail/<email with , for .>
  id          bigint generated always as identity primary key,
  email_key   text,         -- the key as written in Firebase
  email       text,         -- the key as an email (small letters)
  code        text,         -- code
  name        text,         -- name
  phone       text,         -- phone
  vendor_id   bigint references core.vendors (id),
  person_id   bigint references core.people (id)
);
comment on table core.vendor_logins is 'From Firebase: pt_vendorByEmail — vendor sign-in email → vendor code.';

create table if not exists core.vendor_map (                  -- pt_vendorMap/<VND…>
  id          bigint generated always as identity primary key,
  code        text,         -- the key
  email       text,         -- email
  name        text,         -- name
  phone       text,         -- phone
  vendor_id   bigint references core.vendors (id),
  person_id   bigint references core.people (id)
);
comment on table core.vendor_map is 'From Firebase: pt_vendorMap — vendor code → main email.';

create table if not exists core.printers (                    -- pt_printers/<PRN-…>
  id          bigint generated always as identity primary key,
  fb_id       text,         -- the key
  name        text,         -- name
  active      boolean,      -- active
  tables      numeric,      -- tables
  pcs_month   numeric,      -- pcsMonth
  note        text,         -- note
  at_time     timestamptz,  -- at
  by_email    text,         -- by
  vendor_id   bigint references core.vendors (id)
);
comment on table core.printers is 'From Firebase: pt_printers — printer capacity.';

create table if not exists archive.perms_copy (               -- pt_perms/<email with , for .>  (Access runs from Firestore perms)
  id          bigint generated always as identity primary key,
  email_key   text,         -- the key as written
  email       text,         -- the key as an email
  admin       boolean,      -- admin
  tabs        jsonb,        -- t
  rights      jsonb,        -- r
  at_time     timestamptz,  -- at
  by_text     text,         -- by
  person_id   bigint references core.people (id)
);
comment on table archive.perms_copy is 'From Firebase: pt_perms — the old RTDB copy of access rights. Kept for checking only.';

-- ===================================================================== 3 · the same columns, rules and log on all 15
create or replace function core.hr_tables() returns text[] language sql immutable as $$
  select array['hr.workers','hr.attendance','hr.extra_hours','hr.piece_rates','hr.team_sizes','hr.contractor_heads',
               'hr.extra_hours_locks','hr.payout_locks','hr.advances',
               'core.login_directory','core.vendor_logins','core.vendor_map','core.printers','archive.perms_copy']
$$;

-- who may change: any signed-in ERP person adds / changes (as today); deleting a worker = admin or "Add, change, remove
-- employees" (as the ERP); deleting anything else = admin. The loader and the server key are trusted.
create or replace function core.hr_rules() returns trigger
language plpgsql as $$
begin
  if core.loading() or core.me_email() is null then return coalesce(new, old); end if;
  if core.me_id() is null then raise exception 'Only ERP people can change %.', tg_table_name; end if;
  if tg_op = 'DELETE' then
    if tg_table_schema = 'hr' and tg_table_name = 'workers' then
      if not (core.is_admin() or core.can('right:empEdit')) then raise exception 'Only an admin or someone who may remove employees can delete a worker.'; end if;
    elsif not core.is_admin() then raise exception 'Only an admin can delete from %.', tg_table_name; end if;
  end if;
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array core.hr_tables() loop
    execute format('alter table %s add column if not exists legacy_key text', t);
    execute format('create unique index if not exists %I on %s (legacy_key) where legacy_key is not null', replace(t, '.', '_') || '_legacy', t);
    execute format('alter table %s add column if not exists firebase jsonb', t);
    execute format('alter table %s add column if not exists fp text', t);
    execute format('alter table %s add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table %s add column if not exists created_by bigint references core.people (id)', t);
    execute format('alter table %s add column if not exists updated_at timestamptz', t);
    execute format('alter table %s add column if not exists updated_by bigint references core.people (id)', t);
    execute format('drop trigger if exists aa_fp on %s', t);
    execute format('create trigger aa_fp before insert or update on %s for each row execute function core.set_fp()', t);
    execute format('drop trigger if exists hr_rules on %s', t);
    execute format('create trigger hr_rules before insert or update or delete on %s for each row execute function core.hr_rules()', t);
    perform core.watch(t::regclass);
    execute format('revoke all on %s from anon, authenticated', t);
    execute format('grant all on %s to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema hr to service_role;
create unique index if not exists workers_worker_key on hr.workers (worker_key);
create unique index if not exists piece_rates_rate_key on hr.piece_rates (rate_key);
create index if not exists attendance_worker on hr.attendance (worker_id, day);
create index if not exists extra_hours_worker on hr.extra_hours (worker_id, day);
create index if not exists team_sizes_worker on hr.team_sizes (worker_id, from_day);

-- ===================================================================== 4 · D5: who may see people / pay (for every later read door)
create or replace function core.hr_can_see_people() returns boolean
language sql stable security definer set search_path = core, public as $$
  select core.is_admin() or core.can('erp:hr') or core.can('right:empEdit')
$$;
create or replace function core.hr_can_see_pay() returns boolean
language sql stable security definer set search_path = core, public as $$
  select core.is_admin() or core.can('erp:hr')
$$;
revoke all on function core.hr_can_see_people(), core.hr_can_see_pay() from public, anon;
grant execute on function core.hr_can_see_people(), core.hr_can_see_pay() to authenticated, service_role;

-- ===================================================================== 5 · doors (server key; the fingerprint door also for the test ERP)
create or replace function core.load_hr_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare cols text; sets text; n int;
begin
  if not (p_table = any (core.hr_tables())) then raise exception 'load_hr_rows: % is not an HR table', p_table; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  perform set_config('core.loading', 'on', true);
  select string_agg(quote_ident(k), ', '), string_agg(format('%1$I = excluded.%1$I', k), ', ') filter (where k <> 'legacy_key')
    into cols, sets from jsonb_object_keys(p_rows -> 0) k;
  execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)
                  on conflict (legacy_key) where legacy_key is not null do update set %s', p_table, cols, cols, p_table, sets) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.load_hr_rows(text, jsonb) from public, anon, authenticated;
grant execute on function core.load_hr_rows(text, jsonb) to service_role;

insert into core.settings (key, value, note) values ('sync.hr_backup', '"2026-11-12"', 'Which Firebase backup the HR copy is from')
on conflict (key) do update set value = excluded.value;

-- every Firebase record's fingerprint by its Firebase path: { path: fp, …, "#copy_of": day }. Fingerprints only, never data.
-- The two plain lists answer by place (pt_empList/<line_no>), exactly the paths the ERP sees.
create or replace function core.hr_fp() returns jsonb
language sql stable security definer set search_path = core, public as $$
  select case when core.me_id() is not null or auth.role() = 'service_role' or session_user = 'postgres' then (
    select coalesce(jsonb_object_agg(x.k, x.fp), '{}'::jsonb)
           || jsonb_build_object('#copy_of', (select st.value #>> '{}' from core.settings st where st.key = 'sync.hr_backup'))
      from (select 'pt_empList/' || line_no as k, fp from hr.workers where line_no is not null
            union all select 'pt_rateList/' || line_no, fp from hr.piece_rates where line_no is not null
            union all select legacy_key, fp from hr.attendance
            union all select legacy_key, fp from hr.extra_hours
            union all select legacy_key, fp from hr.team_sizes
            union all select legacy_key, fp from hr.contractor_heads
            union all select legacy_key, fp from hr.extra_hours_locks
            union all select legacy_key, fp from hr.payout_locks
            union all select legacy_key, fp from hr.advances
            union all select legacy_key, fp from core.login_directory
            union all select legacy_key, fp from core.vendor_logins
            union all select legacy_key, fp from core.vendor_map
            union all select legacy_key, fp from core.printers
            union all select legacy_key, fp from archive.perms_copy) x
     where x.k is not null and x.fp is not null) end
$$;
revoke all on function core.hr_fp() from public;
grant execute on function core.hr_fp() to anon, authenticated, service_role;

create or replace function core.hr_summary() returns table (item text, n bigint, of_n bigint)
language sql stable security definer set search_path = core, public as $$
  select 'hr.workers', count(*), null::bigint from hr.workers
  union all select 'hr.attendance', count(*), null from hr.attendance
  union all select 'hr.extra_hours', count(*), null from hr.extra_hours
  union all select 'hr.piece_rates', count(*), null from hr.piece_rates
  union all select 'hr.team_sizes', count(*), null from hr.team_sizes
  union all select 'hr.contractor_heads', count(*), null from hr.contractor_heads
  union all select 'hr.extra_hours_locks · payout_locks · advances', (select count(*) from hr.extra_hours_locks) + (select count(*) from hr.payout_locks) + (select count(*) from hr.advances), null
  union all select 'core.login_directory', count(*), null from core.login_directory
  union all select 'core.vendor_logins', count(*), null from core.vendor_logins
  union all select 'core.vendor_map', count(*), null from core.vendor_map
  union all select 'core.printers', count(*), null from core.printers
  union all select 'archive.perms_copy', count(*), null from archive.perms_copy
  union all select 'link · worker → department', count(*) filter (where department_id is not null), count(*) from hr.workers
  union all select 'link · worker → employment type', count(*) filter (where employment_type_id is not null), count(*) from hr.workers
  union all select 'link · attendance → worker', count(*) filter (where worker_id is not null), count(*) from hr.attendance
  union all select 'link · extra hours → worker', count(*) filter (where worker_id is not null), count(*) from hr.extra_hours
  union all select 'link · team size → worker', count(*) filter (where worker_id is not null), count(*) from hr.team_sizes
  union all select 'link · rate → article type', count(*) filter (where article_type_id is not null), count(*) from hr.piece_rates
  union all select 'link · rate → subtype', count(*) filter (where subtype_id is not null), count(*) from hr.piece_rates
  union all select 'link · rate → size', count(*) filter (where size_id is not null), count(*) from hr.piece_rates
  union all select 'link · vendor login → vendor', count(*) filter (where vendor_id is not null), count(*) from core.vendor_logins
  union all select 'link · vendor map → vendor', count(*) filter (where vendor_id is not null), count(*) from core.vendor_map
  union all select 'link · printer → vendor', count(*) filter (where vendor_id is not null), count(*) from core.printers
  union all select 'link · login directory → person', count(*) filter (where person_id is not null), count(*) from core.login_directory
  union all select 'marked rows (workers · attendance · rates)', (select count(*) from hr.workers where mark is not null) + (select count(*) from hr.attendance where mark is not null) + (select count(*) from hr.piece_rates where mark is not null), null
$$;
revoke all on function core.hr_summary() from public, anon, authenticated;
grant execute on function core.hr_summary() to service_role;

-- the mirror's fingerprint list now also knows the hr area (same as sync.sql)
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
revoke all on function core.sync_fps(text) from public, anon, authenticated;
grant execute on function core.sync_fps(text) to service_role;

-- ===================================================================== 6 · checks
create or replace function core.hr_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare r text; q bigint; w bigint; fp_ok boolean;
begin
  fp_ok := jsonb_typeof(core.hr_fp()) = 'object';            -- asked first: the sign-in test below clears who is calling
  create temp table if not exists _h (n int, check_name text, result text);
  truncate _h;
  -- a person without the employee right may add a worker but not delete one; may not delete a rate either
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.hrcheck@ridhi.test', 'T HR Check', (select id from core.roles where code = 'qc')) returning id into q;
    perform core.sign_in_as_test('t.hrcheck@ridhi.test');
    insert into hr.workers (worker_key, name) values ('test|t hr check|test', 'T HR Check') returning id into w;
    begin delete from hr.workers where id = w; r := 'FAIL: a person without the right deleted a worker';
    exception when others then if sqlerrm like 'Only an admin or someone who may remove employees%' then r := 'PASS'; else r := 'FAIL: ' || sqlerrm; end if; end;
    if r = 'PASS' and core.hr_can_see_pay() then r := 'FAIL: a QC person can see pay'; end if;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _h values (20, 'any ERP person may add a worker · only admin / employee right deletes · pay stays hidden', r);
  perform set_config('request.jwt.claims', '', true);
  return query select x.n, x.check_name, x.result from (
    select 1 as n, 'the hr schema and all 14 tables exist, each keeps the Firebase record and fingerprint' as check_name,
           case when (select count(*) from information_schema.columns where column_name = 'fp' and table_schema || '.' || table_name = any (core.hr_tables())) = 14
                 and (select count(*) from information_schema.columns where column_name = 'firebase' and table_schema || '.' || table_name = any (core.hr_tables())) = 14 then 'PASS' else 'FAIL' end as result
    union all select 2, 'rules, stamps and the change log on all 14',
           case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
                       where t.tgname in ('zz_log', 'hr_rules', 'aa_fp') and s.nspname || '.' || c.relname = any (core.hr_tables())) = 42 then 'PASS' else 'FAIL' end
    union all select 3, 'browsers can read none of them, nor use the hr schema',
           case when not exists (select 1 from unnest(core.hr_tables()) t
                                  where has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select'))
                 and not has_schema_privilege('anon', 'hr', 'usage') and not has_schema_privilege('authenticated', 'hr', 'usage') then 'PASS' else 'FAIL' end
    union all select 4, 'browsers cannot use the load door; the fingerprint door gives fingerprints only',
           case when not has_function_privilege('anon', 'core.load_hr_rows(text,jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'core.load_hr_rows(text,jsonb)', 'execute')
                 and fp_ok then 'PASS' else 'FAIL' end
    union all select 5, 'the mirror knows the hr area', case when jsonb_typeof(core.sync_fps('hr.workers')) = 'object' then 'PASS' else 'FAIL' end
    union all select 6, 'no test rows left behind', case when not exists (select 1 from core.people where email like '%@ridhi.test') then 'PASS' else 'FAIL' end
    union all select h.n, h.check_name, h.result from _h h
  ) x order by x.n;
end $fn$;
revoke all on function core.hr_checks() from public, anon, authenticated;
grant execute on function core.hr_checks() to service_role;

notify pgrst, 'reload schema';
select * from core.hr_checks();
