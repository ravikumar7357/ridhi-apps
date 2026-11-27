-- =====================================================================================
-- FILE 010 · CORE · CONTROL  (room 03, zone "control")
-- NEEDS: 000_rooms.sql.  WHERE: erp-test first.  HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: every row of the last result must say PASS.
--
-- Makes:
--   core.people ........ everyone who signs in (staff, vendor logins). One row per email.
--   core.roles ......... the 33 access roles (from Sellora's config)            · core.role_rights
--   core.rights ........ what each person may open / do (from perms), per brand
--   core.settings ...... one row per setting (company details, prefixes, pack weights …)
--   core.locations ..... every place stock can be (store, cutting, printer, FBA …)
--   core.period_locks .. closed months per area, checked by the database
--   core.approvals ..... ONE inbox for every request (7 flows today), no self-approval
--   core.notifications . WhatsApp / mail "sent" stamps
--   core.me_id() · core.has_right() · core.is_locked()
-- Links to vendors / employees are added by the files that make those tables (030, 040).
-- =====================================================================================

-- ----------------------------------------------------------------- people
create table if not exists core.people (
  id          bigint generated always as identity primary key,
  legacy_key  text unique,                                        -- Firebase key (perms doc id / email)
  email       text not null unique check (email = lower(trim(email)) and email like '%_@_%'),
  name        text not null check (length(trim(name)) > 0),
  kind        text not null default 'staff' check (kind in ('staff','vendor','legacy')),  -- legacy = a name found in old data, never signs in
  vendor_id   bigint,                                             -- link added in 030 (vendors)
  role_id     bigint,                                             -- link added below (roles)
  phone       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  bigint references core.people (id),
  updated_at  timestamptz,
  updated_by  bigint references core.people (id),
  check (kind <> 'vendor' or vendor_id is not null or legacy_key is not null)   -- a vendor login belongs to a vendor (old rows checked at load)
);
comment on table core.people is 'Everyone who signs in. Shopify hub people link here by email. Access is decided by core.rights (ERP rights only).';

-- ----------------------------------------------------------------- roles + their rights
create table if not exists core.roles (
  id          bigint generated always as identity primary key,
  code        text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),   -- owneradmin, cutting, qc …
  name        text not null,
  note        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  bigint references core.people (id),
  updated_at  timestamptz,
  updated_by  bigint references core.people (id)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'people_role_fk') then
    alter table core.people add constraint people_role_fk foreign key (role_id) references core.roles (id);
  end if;
end $$;

create table if not exists core.role_rights (
  role_id     bigint not null references core.roles (id) on delete cascade,
  "right"     text   not null check ("right" ~ '^[a-z][a-zA-Z0-9:_-]*$'),   -- tab:fgi · soApprove · repl:top …
  created_at  timestamptz not null default now(),
  created_by  bigint references core.people (id),
  updated_at  timestamptz,
  updated_by  bigint references core.people (id),
  primary key (role_id, "right")
);

-- ----------------------------------------------------------------- rights per person
create table if not exists core.rights (
  id          bigint generated always as identity primary key,
  person_id   bigint not null references core.people (id) on delete cascade,
  "right"     text   not null check ("right" ~ '^[a-z][a-zA-Z0-9:_-]*$'),   -- admin · tab:fgi · fgiEntry · repl:top
  brand       text references public.stores (id),                         -- null = all brands
  created_at  timestamptz not null default now(),
  created_by  bigint references core.people (id),
  updated_at  timestamptz,
  updated_by  bigint references core.people (id),
  unique nulls not distinct (person_id, "right", brand)
);
create index if not exists rights_person on core.rights (person_id);

-- ----------------------------------------------------------------- settings
create table if not exists core.settings (
  key         text primary key check (key ~ '^[a-z][a-z0-9_.]*$'),          -- company · po_prefix · pack_weights …
  value       jsonb not null,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  bigint references core.people (id),
  updated_at  timestamptz,
  updated_by  bigint references core.people (id)
);
comment on table core.settings is 'ERP settings, one row each. API keys never go here (secrets store).';

-- ----------------------------------------------------------------- locations
create table if not exists core.locations (
  id          bigint generated always as identity primary key,
  code        text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]*$'),   -- STORE · CUT · PRESS · FBA-RBP · VND001 …
  name        text not null,
  kind        text not null check (kind in ('store','fg_store','cutting','stitching','press','qc','printer','processor','mill',
                                            'karigar','contractor','fba','transit','customer','scrap','other')),
  brand       text references public.stores (id),
  vendor_id   bigint,                                             -- link added in 030
  employee_id bigint,                                             -- link added in 040
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  bigint references core.people (id),
  updated_at  timestamptz,
  updated_by  bigint references core.people (id)
);

-- ----------------------------------------------------------------- closed months
create table if not exists core.period_locks (
  area        text not null check (area in ('cutting','press','extra_hours','payout','job_work','qc','stock')),
  month       date not null check (month = date_trunc('month', month)::date),   -- always the 1st
  note        text,
  created_at  timestamptz not null default now(),                -- = locked at
  created_by  bigint references core.people (id),                -- = locked by
  updated_at  timestamptz,
  updated_by  bigint references core.people (id),
  primary key (area, month)
);
create or replace function core.is_locked(p_area text, p_day date) returns boolean
language sql stable as $$
  select exists (select 1 from core.period_locks where area = p_area and month = date_trunc('month', p_day)::date)
$$;

-- ----------------------------------------------------------------- approvals: one inbox
create table if not exists core.approvals (
  id           bigint generated always as identity primary key,
  legacy_key   text unique,                                      -- e.g. "pt_jwCorrReqs/-Oabc"
  kind         text not null check (kind in ('jw_correction','fgi_correction','fgi_over_order','order_delete','so_qty_change',
                                             'vendor_order_request','rate','rfd_over_need','stock_adjust','other')),
  ref_room     text,                                             -- erp / core …
  ref_table    text,                                             -- job_work, sales_orders …
  ref_id       bigint,
  snapshot     jsonb,                                            -- the record as it was when asked
  change       jsonb,                                            -- what is asked to change
  reason       text,
  status       text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  asked_by     bigint references core.people (id),
  asked_at     timestamptz not null default now(),
  answered_by  bigint references core.people (id),
  answered_at  timestamptz,
  answer_note  text,
  created_at   timestamptz not null default now(),
  created_by   bigint references core.people (id),
  updated_at   timestamptz,
  updated_by   bigint references core.people (id),
  check (answered_by is null or asked_by is null or answered_by <> asked_by),             -- nobody approves their own request
  check ((status in ('approved','rejected')) = (answered_at is not null) or status = 'withdrawn')
);
create index if not exists approvals_open on core.approvals (kind, asked_at) where status = 'pending';
create index if not exists approvals_ref  on core.approvals (ref_room, ref_table, ref_id);

-- ----------------------------------------------------------------- notifications (WhatsApp sent stamps)
create table if not exists core.notifications (
  id          bigint generated always as identity primary key,
  legacy_key  text unique,
  ref_room    text not null,
  ref_table   text not null,
  ref_id      bigint,
  channel     text not null check (channel in ('whatsapp','email','app')),
  kind        text not null,                                     -- issue · receive …
  sent_at     timestamptz not null,
  sent_by     bigint references core.people (id),
  note        text,
  created_at  timestamptz not null default now(),
  created_by  bigint references core.people (id),
  updated_at  timestamptz,
  updated_by  bigint references core.people (id)
);
create index if not exists notifications_ref on core.notifications (ref_room, ref_table, ref_id);

-- ----------------------------------------------------------------- who am I, may I
create or replace function core.me_id() returns bigint
language sql stable security definer set search_path = core, public as $$
  select id from core.people where email = core.me_email() and active limit 1
$$;

create or replace function core.has_right(p_right text, p_brand text default null) returns boolean
language sql stable security definer set search_path = core, public as $$
  select exists (
    select 1 from core.rights r
     where r.person_id = core.me_id() and r."right" in (p_right, 'admin')
       and (r.brand is null or p_brand is null or r.brand = p_brand)
    union all
    select 1 from core.people p join core.role_rights rr on rr.role_id = p.role_id
     where p.id = core.me_id() and rr."right" in (p_right, 'admin')
  )
$$;
revoke all on function core.me_id() from public;
revoke all on function core.has_right(text, text) from public;
grant execute on function core.me_id(), core.has_right(text, text), core.is_locked(text, date) to authenticated, service_role;

-- ----------------------------------------------------------------- rules on + stamp + log for every table
select core.watch(t) from unnest(array['core.people','core.roles','core.role_rights','core.rights','core.settings',
  'core.locations','core.period_locks','core.approvals','core.notifications']::regclass[]) t;

-- ----------------------------------------------------------------- live tests (everything is rolled back)
create temp table if not exists _t (n int, check_name text, result text) on commit preserve rows;
truncate _t;
-- Each test runs inside its own block and ends with a deliberate error, so everything it wrote is undone.
-- The result is kept in a variable and written AFTER the block (writes inside the block would be undone too).
do $$
declare a bigint; b bigint; logged int; r text;
begin
  -- 1. nobody approves their own request
  r := 'FAIL: it was accepted';
  begin
    insert into core.people (email, name) values ('test.a@ridhi.test', 'Test A') returning id into a;
    insert into core.approvals (kind, status, asked_by, answered_by, answered_at) values ('other', 'approved', a, a, now());
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (20, 'self-approval is refused', r);

  -- 2. another person may approve, and the database logs it
  r := 'FAIL';
  begin
    insert into core.people (email, name) values ('test.a@ridhi.test', 'Test A') returning id into a;
    insert into core.people (email, name) values ('test.b@ridhi.test', 'Test B') returning id into b;
    insert into core.approvals (kind, asked_by) values ('other', a);
    update core.approvals set status = 'approved', answered_by = b, answered_at = now() where asked_by = a;
    select count(*) into logged from core.change_log where room = 'core' and tbl = 'approvals' and at >= now() - interval '1 minute';
    r := case when logged >= 2 then 'PASS' else 'FAIL: change log has ' || logged || ' rows' end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (21, 'another person can approve, and the database logs it', r);

  -- 3. emails are kept in small letters
  r := 'FAIL: it was accepted';
  begin
    insert into core.people (email, name) values ('Test.C@Ridhi.test', 'Test C');
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (22, 'capital letters in an email are refused', r);

  -- 4. a month lock is always the 1st of the month
  r := 'FAIL: it was accepted';
  begin
    insert into core.period_locks (area, month) values ('cutting', '2026-10-15');
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _t values (23, 'a month lock must be the 1st', r);
end $$;

-- ----------------------------------------------------------------- checks: every row must say PASS
select n, check_name, result from (
  select 1 as n, '9 control tables exist' as check_name,
         case when (select count(*) from pg_tables where schemaname = 'core' and tablename in
           ('people','roles','role_rights','rights','settings','locations','period_locks','approvals','notifications')) = 9 then 'PASS' else 'FAIL' end as result
  union all select 2, 'read rules on for all of them',
         case when (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'core'
           and c.relname in ('people','roles','role_rights','rights','settings','locations','period_locks','approvals','notifications')) then 'PASS' else 'FAIL' end
  union all select 3, 'every table stamps who / when and logs changes',
         case when (select count(distinct tgrelid) from pg_trigger where tgname = 'zz_log' and tgrelid in
           ('core.people'::regclass,'core.roles'::regclass,'core.role_rights'::regclass,'core.rights'::regclass,'core.settings'::regclass,
            'core.locations'::regclass,'core.period_locks'::regclass,'core.approvals'::regclass,'core.notifications'::regclass)) = 9
            and (select count(*) from pg_trigger where tgname = 'zz_stamp' and tgrelid::regclass::text like 'core.%') >= 9 then 'PASS' else 'FAIL' end
  union all select 4, 'brands point to the Shopify stores list',
         case when exists (select 1 from pg_constraint where conrelid = 'core.rights'::regclass and confrelid = 'public.stores'::regclass) then 'PASS' else 'FAIL' end
  union all select 5, 'no test rows left behind',
         case when not exists (select 1 from core.people where email like '%@ridhi.test') then 'PASS' else 'FAIL' end
  union all select n, check_name, result from _t
) x order by n;
