-- =====================================================================================
-- CORE ROOM · SECTION 2 · CONTROL  (approvals inbox · settings · month locks)
-- NEEDS: core_access.sql (section 1).  WHERE: ERP TEST.  HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: the last result is a list of checks — every row must say PASS.
-- Then run core_control_data.sql (the 603 requests and the settings from the Firebase backup).
-- Locations and notifications come with Phase 2 (stock, job work) — Ravi, 10 Nov.
-- =====================================================================================

-- ===================================================================== 1 · approvals: ONE inbox for every request
create table if not exists core.approvals (
  id               bigint generated always as identity primary key,
  no               text unique,                                      -- request number where there is one (VR-…)
  kind             text not null check (kind in ('jw_correction','fgi_correction','fgi_over_order','order_delete','so_qty_change',
                                                 'vendor_order_request','rate','rfd_decision','stock_adjust','other')),
  ref_room         text,                                             -- the record it is about: erp / core …
  ref_table        text,                                             --   job_work, stock_moves, production_demand …
  ref_legacy_key   text,                                             --   its Firebase key (linked to the new row when that section moves)
  ref_id           bigint,                                           --   its id in the new database (filled in Phase 2)
  order_no         text,
  sku_code         text,
  snapshot         jsonb,                                            -- the record as it was when asked
  change           jsonb,                                            -- what was asked to change
  reason           text,                                             -- why it was asked
  status           text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  old_status       text,                                             -- the status word in Firebase (deleted, closed, Approved …), kept as it was
  asked_by         bigint references core.people (id),
  asked_email      text,                                             -- who asked, as Firebase wrote it (kept even if not a person here)
  asked_at         timestamptz not null default now(),
  answered_by      bigint references core.people (id),
  answered_email   text,
  answered_at      timestamptz,
  answer_note      text,
  withdrawn_by     bigint references core.people (id),
  withdrawn_email  text,
  withdrawn_at     timestamptz,
  result_legacy_key text,                                            -- what the approval made (e.g. the vendor order)
  result_no        text,
  legacy_self_approved boolean not null default false,               -- old system only: answered by the asker (Ravi, 10 Nov: kept as marked history)
  check (legacy_self_approved or answered_by is null or asked_by is null or answered_by <> asked_by),   -- nobody approves their own request
  check (status not in ('approved','rejected') or answered_at is not null),
  check (status <> 'withdrawn' or withdrawn_at is not null),
  check (status <> 'pending' or (answered_at is null and withdrawn_at is null))
);
create index if not exists approvals_open on core.approvals (kind, asked_at) where status = 'pending';
create index if not exists approvals_ref  on core.approvals (ref_table, ref_legacy_key);
create index if not exists approvals_asked on core.approvals (asked_by, asked_at desc);
comment on table core.approvals is 'One inbox for every request: asked by one person, answered by another. Old self-approved requests are kept as marked history.';

-- "approved by the asker" may only come from the old system (the loader), never from a screen
create or replace function core.guard_legacy_self() returns trigger
language plpgsql as $$
begin
  if new.legacy_self_approved and not core.loading()
     and (tg_op = 'INSERT' or not old.legacy_self_approved) then
    raise exception 'Nobody can approve their own request.';
  end if;
  return new;
end $$;
drop trigger if exists approvals_guard_self on core.approvals;
create trigger approvals_guard_self before insert or update on core.approvals for each row execute function core.guard_legacy_self();

-- ===================================================================== 2 · settings: one row per setting
create table if not exists core.settings (
  key    text primary key check (key ~ '^[a-z][a-z0-9_.]*$' and key !~ '(key|secret|token|password)'),
  value  jsonb not null,
  note   text
);
comment on table core.settings is 'ERP settings, one row each (company details, number prefixes, pack weights …). Never API keys.';

-- ===================================================================== 3 · month locks: closed months, checked by the database
create table if not exists core.period_locks (
  area   text not null check (area in ('cutting','press','extra_hours','payout','job_work','qc','stock')),
  month  date not null check (month = date_trunc('month', month)::date),
  note   text,
  primary key (area, month)
);
create or replace function core.is_locked(p_area text, p_day date) returns boolean
language sql stable as $$
  select exists (select 1 from core.period_locks where area = p_area and month = date_trunc('month', p_day)::date)
$$;
comment on table core.period_locks is 'Closed months per area. Screens that write dated entries ask core.is_locked(); the database refuses changes in a closed month.';

-- ===================================================================== 3b · the rules, kept by the database (Ravi, 10 Nov: "make control full proof")
-- They apply to a SIGNED-IN person (a screen). The loader (core.loading) carries old history as it was; the database owner /
-- server key (no sign-in) is trusted back-office work.
create or replace function core.is_admin() returns boolean
language sql stable security definer set search_path = core, public as $$
  select core.me_email() is not null
     and exists (select 1 from core.access_now a where a.email = core.me_email() and a.via = 'admin')
$$;

-- which right answers which kind of request (the same rights the ERP's screens check today)
create or replace function core.answer_right(p_kind text) returns text
language sql immutable as $$
  select case p_kind
    when 'jw_correction'        then 'right:prodEdit'
    when 'fgi_correction'       then 'right:fgiEdit'
    when 'fgi_over_order'       then 'right:fgiEdit'
    when 'stock_adjust'         then 'right:fgiEdit'
    when 'order_delete'         then 'right:soApprove'
    when 'so_qty_change'        then 'right:soApprove'
    when 'vendor_order_request' then 'right:vreqApprove'
    when 'rate'                 then 'right:rateApprove'
    when 'rfd_decision'         then 'right:rfdApprove'
    else null end                                    -- 'other': admins only
$$;

create or replace function core.approvals_rules() returns trigger
language plpgsql as $$
declare me bigint := core.me_id();
begin
  if core.loading() or core.me_email() is null then return new; end if;     -- old history / back office
  if me is null then raise exception 'You are not in the people list, so you cannot raise or answer requests.'; end if;

  if tg_op = 'INSERT' then
    -- the asker is whoever is signed in; a new request always starts waiting
    new.asked_by := me; new.asked_email := core.me_email(); new.asked_at := now();
    if new.status <> 'pending' or new.answered_by is not null or new.answered_at is not null or new.withdrawn_at is not null then
      raise exception 'A new request starts as waiting, with no answer.';
    end if;
    return new;
  end if;

  -- what was asked never changes
  if (new.kind, new.snapshot, new.change, new.reason, new.ref_table, new.ref_legacy_key, new.asked_by, new.asked_at, new.asked_email)
     is distinct from (old.kind, old.snapshot, old.change, old.reason, old.ref_table, old.ref_legacy_key, old.asked_by, old.asked_at, old.asked_email) then
    raise exception 'What was asked cannot be changed. Withdraw it and ask again.';
  end if;

  if new.status is distinct from old.status
     or (new.answered_by, new.answered_at, new.answer_note, new.withdrawn_at) is distinct from (old.answered_by, old.answered_at, old.answer_note, old.withdrawn_at) then
    -- an answer is final
    if old.status <> 'pending' then raise exception 'This request was already %. An answer is final.', old.status; end if;
    if new.status in ('approved','rejected') then
      if not (core.is_admin() or (core.answer_right(new.kind) is not null and core.can(core.answer_right(new.kind)))) then
        raise exception 'You do not have the right to answer this kind of request (%).', coalesce(core.answer_right(new.kind), 'admins only');
      end if;
      new.answered_by := me; new.answered_email := core.me_email(); new.answered_at := now();
    elsif new.status = 'withdrawn' then
      if me is distinct from old.asked_by and not core.is_admin() then raise exception 'Only the person who asked can withdraw it.'; end if;
      new.withdrawn_by := me; new.withdrawn_email := core.me_email(); new.withdrawn_at := now();
    else
      raise exception 'A request cannot go back to waiting.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists approvals_rules on core.approvals;
create trigger approvals_rules before insert or update on core.approvals for each row execute function core.approvals_rules();

-- a request is never deleted by a screen: it is withdrawn or answered
create or replace function core.no_delete_signed_in() returns trigger
language plpgsql as $$
begin
  if not core.loading() and core.me_email() is not null and not core.is_admin() then
    raise exception 'Requests are never deleted — withdraw it instead.';
  end if;
  return old;
end $$;
drop trigger if exists approvals_no_delete on core.approvals;
create trigger approvals_no_delete before delete on core.approvals for each row execute function core.no_delete_signed_in();

-- month locks and settings: admins only (closing, reopening and changing are all logged by the change log)
create or replace function core.admins_only() returns trigger
language plpgsql as $$
begin
  if not core.loading() and core.me_email() is not null and not core.is_admin() then
    raise exception 'Only an admin can change %.', case tg_table_name when 'period_locks' then 'closed months' else tg_table_name end;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists period_locks_admins on core.period_locks;
create trigger period_locks_admins before insert or update or delete on core.period_locks for each row execute function core.admins_only();
drop trigger if exists settings_admins on core.settings;
create trigger settings_admins before insert or update or delete on core.settings for each row execute function core.admins_only();

-- ===================================================================== 4 · the same columns + stamp + log as every table
do $$ declare t text; begin
  foreach t in array array['approvals','settings','period_locks'] loop
    execute format('alter table core.%I add column if not exists legacy_key text', t);
    execute format('create unique index if not exists %I on core.%I (legacy_key) where legacy_key is not null', t || '_legacy', t);
    execute format('alter table core.%I add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table core.%I add column if not exists created_by bigint references core.people (id)', t);
    execute format('alter table core.%I add column if not exists updated_at timestamptz', t);
    execute format('alter table core.%I add column if not exists updated_by bigint references core.people (id)', t);
  end loop;
end $$;
select core.watch(('core.' || t)::regclass) from unnest(array['approvals','settings','period_locks']) t;
revoke all on core.approvals, core.settings, core.period_locks from anon, authenticated;
grant execute on function core.is_locked(text, date) to authenticated, service_role;
revoke all on function core.is_admin(), core.approvals_rules(), core.admins_only(), core.no_delete_signed_in() from public, anon;
grant execute on function core.is_admin(), core.answer_right(text) to authenticated, service_role;

-- ===================================================================== 4b · the load doors (only the server key — the loader on Ravi's PC)
-- Data is no longer pasted into the SQL Editor (too large): migration/tools/load-control.js sends it in batches to these.
-- They mark the load as old history (core.loading), so dates and people are kept and nothing is logged as a new change.
create or replace function core.load_approvals(p jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  perform set_config('core.loading', 'on', true);
  insert into core.approvals (legacy_key, no, kind, ref_room, ref_table, ref_legacy_key, order_no, sku_code, snapshot, change, reason, status, old_status,
                              asked_email, asked_at, answered_email, answered_at, answer_note, withdrawn_email, withdrawn_at, result_legacy_key, result_no,
                              legacy_self_approved, created_at)
  select x.legacy_key, x.no, x.kind, x.ref_room, x.ref_table, x.ref_legacy_key, x.order_no, x.sku_code, x.snapshot, x.change, x.reason, x.status, x.old_status,
         x.asked_email, x.asked_at, x.answered_email, x.answered_at, x.answer_note, x.withdrawn_email, x.withdrawn_at, x.result_legacy_key, x.result_no,
         coalesce(x.legacy_self_approved, false), coalesce(x.asked_at, now())
    from jsonb_to_recordset(p) as x(legacy_key text, no text, kind text, ref_room text, ref_table text, ref_legacy_key text, order_no text, sku_code text,
         snapshot jsonb, change jsonb, reason text, status text, old_status text, asked_email text, asked_at timestamptz, answered_email text,
         answered_at timestamptz, answer_note text, withdrawn_email text, withdrawn_at timestamptz, result_legacy_key text, result_no text, legacy_self_approved boolean)
  on conflict (legacy_key) where legacy_key is not null do update set
    no = excluded.no, kind = excluded.kind, ref_room = excluded.ref_room, ref_table = excluded.ref_table, ref_legacy_key = excluded.ref_legacy_key,
    order_no = excluded.order_no, sku_code = excluded.sku_code, snapshot = excluded.snapshot, change = excluded.change, reason = excluded.reason,
    status = excluded.status, old_status = excluded.old_status, asked_email = excluded.asked_email, asked_at = excluded.asked_at,
    answered_email = excluded.answered_email, answered_at = excluded.answered_at, answer_note = excluded.answer_note,
    withdrawn_email = excluded.withdrawn_email, withdrawn_at = excluded.withdrawn_at, result_legacy_key = excluded.result_legacy_key,
    result_no = excluded.result_no, legacy_self_approved = excluded.legacy_self_approved, created_at = excluded.created_at;
  get diagnostics n = row_count;
  -- people by email (the email is kept either way)
  update core.approvals a set asked_by = p2.id from core.people p2 where a.legacy_key is not null and p2.email = a.asked_email and a.asked_by is distinct from p2.id;
  update core.approvals a set answered_by = p2.id from core.people p2 where a.legacy_key is not null and p2.email = a.answered_email and a.answered_by is distinct from p2.id;
  update core.approvals a set withdrawn_by = p2.id from core.people p2 where a.legacy_key is not null and p2.email = a.withdrawn_email and a.withdrawn_by is distinct from p2.id;
  return n;
end $$;

create or replace function core.load_settings(p jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  perform set_config('core.loading', 'on', true);
  insert into core.settings (key, value, note, legacy_key)
  select x.key, x.value, x.note, x.legacy_key from jsonb_to_recordset(p) as x(key text, value jsonb, note text, legacy_key text)
  on conflict (key) do update set value = excluded.value, note = excluded.note, legacy_key = excluded.legacy_key;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.load_approvals(jsonb), core.load_settings(jsonb) from public, anon, authenticated;
grant execute on function core.load_approvals(jsonb), core.load_settings(jsonb) to service_role;

-- ===================================================================== 4c · the shadow test door (test ERP)
-- For any signed-in person: how many requests of each kind are waiting, whether THEY may answer that kind, and which
-- backup day the copy is from. Counts only — never the requests themselves.
create or replace function core.waiting_counts()
returns table (kind text, waiting int, may_answer boolean, copy_of text)
language sql stable security definer set search_path = core, public as $$
  select k.kind,
         (select count(*)::int from core.approvals a where a.kind = k.kind and a.status = 'pending'),
         core.is_admin() or (core.answer_right(k.kind) is not null and core.can(core.answer_right(k.kind))),
         (select value #>> '{}' from core.settings where key = 'sync.control_backup')
    from unnest(array['jw_correction','fgi_correction','order_delete','vendor_order_request','rfd_decision','rate']) as k(kind)
   where core.me_email() is not null
$$;
revoke all on function core.waiting_counts() from public;
grant execute on function core.waiting_counts() to anon, authenticated, service_role;

-- ===================================================================== 5 · checks (live tests undo themselves)
-- Test sign-in for the checks only: sets a sign-in for the CURRENT transaction, and only for a @ridhi.test address.
create or replace function core.sign_in_as_test(p_email text) returns void
language plpgsql as $$
begin
  if p_email not like '%@ridhi.test' then raise exception 'test sign-in is only for @ridhi.test addresses'; end if;
  perform set_config('request.jwt.claims', json_build_object('iss', 'https://securetoken.google.com/price-research-48ff3',
                     'aud', 'price-research-48ff3', 'email', p_email)::text, true);
end $$;
revoke all on function core.sign_in_as_test(text) from public, anon, authenticated;
create or replace function core.control_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare a bigint; b bigint; r text; q bigint; pp bigint; ad bigint; rid bigint;
begin
  create temp table if not exists _c (n int, check_name text, result text);
  truncate _c;

  -- A. nobody approves their own NEW request
  r := 'FAIL: it was accepted';
  begin
    insert into core.people (email, name) values ('test.a@ridhi.test', 'Test A') returning id into a;
    insert into core.approvals (kind, status, asked_by, answered_by, answered_at) values ('other', 'approved', a, a, now());
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _c values (20, 'nobody can approve their own new request', r);

  -- B. a screen cannot mark a request "approved by the asker (old system)"
  r := 'FAIL: it was accepted';
  begin
    insert into core.approvals (kind, status, answered_at, legacy_self_approved) values ('other', 'approved', now(), true);
    raise exception 'undo';
  exception when others then if sqlerrm like 'Nobody can approve%' then r := 'PASS'; elsif sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _c values (21, 'only the old system may carry a self-approved request', r);

  -- C. another person can approve, and the database logs it
  r := 'FAIL';
  begin
    insert into core.people (email, name) values ('test.a@ridhi.test', 'Test A') returning id into a;
    insert into core.people (email, name) values ('test.b@ridhi.test', 'Test B') returning id into b;
    insert into core.approvals (kind, asked_by) values ('other', a);
    update core.approvals set status = 'approved', answered_by = b, answered_at = now() where asked_by = a;
    r := case when exists (select 1 from core.change_log where tbl = 'approvals' and action = 'update' and at >= now() - interval '1 minute') then 'PASS' else 'FAIL: not logged' end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _c values (22, 'another person can approve, and it is logged', r);

  -- D. an approved request must say when; a pending one cannot have an answer
  r := 'FAIL: it was accepted';
  begin
    insert into core.approvals (kind, status) values ('other', 'approved');
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _c values (23, 'an answer needs a time', r);

  -- E. settings never hold keys
  r := 'FAIL: it was accepted';
  begin
    insert into core.settings (key, value) values ('shopify_api_key', '"x"');
    raise exception 'undo';
  exception when check_violation then r := 'PASS';
            when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _c values (24, 'a setting named like a key / secret is refused', r);

  -- F. month locks: always the 1st, and is_locked answers
  r := 'FAIL';
  begin
    insert into core.period_locks (area, month) values ('cutting', '2026-10-01');
    r := case when core.is_locked('cutting', '2026-10-17') and not core.is_locked('cutting', '2026-11-02') then 'PASS' else 'FAIL: is_locked wrong' end;
    begin insert into core.period_locks (area, month) values ('press', '2026-10-15'); r := 'FAIL: 15th accepted';
    exception when check_violation then null; end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _c values (25, 'a closed month is found; a lock must be on the 1st', r);

  -- ---------- the rules for signed-in people: tested by signing in as a QC checker, a PPC head and an admin ----------
  -- (core.sign_in_as_test sets a test sign-in for this transaction only; every block is undone)

  -- G. a QC checker raises a vendor-order request: the database writes who asked, and it starts waiting
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.qc@ridhi.test', 'T QC', (select id from core.roles where code = 'qc')) returning id into q;
    perform core.sign_in_as_test('t.qc@ridhi.test');
    insert into core.approvals (kind, reason) values ('vendor_order_request', 'test') returning id into rid;
    r := case when (select asked_by from core.approvals where id = rid) = q and (select status from core.approvals where id = rid) = 'pending' then 'PASS' else 'FAIL: asker not recorded' end;
    begin insert into core.approvals (kind, status, answered_at) values ('other', 'approved', now()); r := 'FAIL: a new request came in already approved';
    exception when others then if sqlerrm not like 'A new request starts%' then r := 'FAIL: ' || sqlerrm; end if; end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _c values (30, 'the database records who asked; a new request always starts waiting', r);

  -- H. only someone with the right answers; an answer is final; what was asked cannot change
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.qc@ridhi.test', 'T QC', (select id from core.roles where code = 'qc')) returning id into q;
    insert into core.people (email, name, role_id) values ('t.ppc@ridhi.test', 'T PPC', (select id from core.roles where code = 'ppchead')) returning id into pp;
    insert into core.people (email, name, role_id) values ('t.qc2@ridhi.test', 'T QC2', (select id from core.roles where code = 'qc')) returning id into b;
    perform core.sign_in_as_test('t.qc@ridhi.test');
    insert into core.approvals (kind, reason) values ('vendor_order_request', 'test') returning id into rid;
    -- the asker changes what was asked → refused
    begin update core.approvals set reason = 'changed' where id = rid; r := 'FAIL: the question was changed';
    exception when others then if sqlerrm not like 'What was asked cannot be changed%' then r := 'FAIL: ' || sqlerrm; else r := 'ok'; end if; end;
    -- another QC checker (no right to approve vendor orders) → refused
    if r = 'ok' then
      perform core.sign_in_as_test('t.qc2@ridhi.test');
      begin update core.approvals set status = 'approved' where id = rid; r := 'FAIL: approved without the right';
      exception when others then if sqlerrm not like 'You do not have the right%' then r := 'FAIL: ' || sqlerrm; end if; end;
    end if;
    -- the PPC head (has "approve vendor order requests") → approved, and the database writes who and when
    if r = 'ok' then
      perform core.sign_in_as_test('t.ppc@ridhi.test');
      update core.approvals set status = 'approved' where id = rid;
      if (select answered_by from core.approvals where id = rid) is distinct from pp then r := 'FAIL: answerer not recorded'; end if;
      -- and cannot flip it afterwards
      begin update core.approvals set status = 'rejected' where id = rid; r := 'FAIL: an answer was changed';
      exception when others then if sqlerrm not like 'This request was already%' then r := 'FAIL: ' || sqlerrm; end if; end;
    end if;
    if r = 'ok' then r := 'PASS'; end if;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _c values (31, 'only someone with the right answers · an answer is final · the question cannot change', r);

  -- I. only the asker withdraws; a signed-in person cannot delete a request
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.qc@ridhi.test', 'T QC', (select id from core.roles where code = 'qc')) returning id into q;
    insert into core.people (email, name, role_id) values ('t.ppc@ridhi.test', 'T PPC', (select id from core.roles where code = 'ppchead')) returning id into pp;
    perform core.sign_in_as_test('t.qc@ridhi.test');
    insert into core.approvals (kind, reason) values ('vendor_order_request', 'test') returning id into rid;
    perform core.sign_in_as_test('t.ppc@ridhi.test');
    begin update core.approvals set status = 'withdrawn' where id = rid; r := 'FAIL: someone else withdrew it';
    exception when others then if sqlerrm not like 'Only the person who asked%' then r := 'FAIL: ' || sqlerrm; else r := 'ok'; end if; end;
    if r = 'ok' then
      begin delete from core.approvals where id = rid; r := 'FAIL: a request was deleted';
      exception when others then if sqlerrm not like 'Requests are never deleted%' then r := 'FAIL: ' || sqlerrm; end if; end;
    end if;
    if r = 'ok' then
      perform core.sign_in_as_test('t.qc@ridhi.test');
      update core.approvals set status = 'withdrawn' where id = rid;
      r := case when (select withdrawn_by from core.approvals where id = rid) = q then 'PASS' else 'FAIL: withdrawer not recorded' end;
    end if;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _c values (32, 'only the asker can withdraw; requests are never deleted', r);

  -- J. closed months and settings: admins only, and logged
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.qc@ridhi.test', 'T QC', (select id from core.roles where code = 'qc')) returning id into q;
    insert into core.people (email, name, role_id) values ('t.adm@ridhi.test', 'T Admin', (select id from core.roles where code = 'owneradmin')) returning id into ad;
    perform core.sign_in_as_test('t.qc@ridhi.test');
    begin insert into core.period_locks (area, month) values ('cutting', '2026-10-01'); r := 'FAIL: a non-admin closed a month';
    exception when others then if sqlerrm not like 'Only an admin%' then r := 'FAIL: ' || sqlerrm; else r := 'ok'; end if; end;
    if r = 'ok' then
      begin insert into core.settings (key, value) values ('test.setting', '1'); r := 'FAIL: a non-admin changed a setting';
      exception when others then if sqlerrm not like 'Only an admin%' then r := 'FAIL: ' || sqlerrm; end if; end;
    end if;
    if r = 'ok' then
      perform core.sign_in_as_test('t.adm@ridhi.test');
      insert into core.period_locks (area, month) values ('cutting', '2026-10-01');
      delete from core.period_locks where area = 'cutting' and month = '2026-10-01';   -- reopen
      r := case when (select count(*) from core.change_log where tbl = 'period_locks' and at >= now() - interval '1 minute') >= 2 then 'PASS' else 'FAIL: close / reopen not logged' end;
    end if;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _c values (33, 'only an admin closes / reopens a month or changes a setting — and it is logged', r);
  perform set_config('request.jwt.claims', '', true);

  return query
  select x.n, x.check_name, x.result from (
    select 1 as n, 'the 3 control tables exist' as check_name,
           case when to_regclass('core.approvals') is not null and to_regclass('core.settings') is not null and to_regclass('core.period_locks') is not null then 'PASS' else 'FAIL' end as result
    union all select 2, 'read rules on, who / when stamped, every change logged',
           case when (select count(*) from pg_trigger where tgname = 'zz_log' and tgrelid in ('core.approvals'::regclass, 'core.settings'::regclass, 'core.period_locks'::regclass)) = 3
                 and (select bool_and(relrowsecurity) from pg_class where oid in ('core.approvals'::regclass, 'core.settings'::regclass, 'core.period_locks'::regclass)) then 'PASS' else 'FAIL' end
    union all select 3, 'browsers can read none of them',
           case when not exists (select 1 from unnest(array['core.approvals','core.settings','core.period_locks']) t
                                  where has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select')) then 'PASS' else 'FAIL' end
    union all select 4, 'no test rows left behind',
           case when not exists (select 1 from core.people where email like '%@ridhi.test') and not exists (select 1 from core.approvals where kind = 'other' and legacy_key is null) then 'PASS' else 'FAIL' end
    union all select c.n, c.check_name, c.result from _c c
  ) x order by x.n;
end $fn$;
revoke all on function core.control_checks() from public, anon, authenticated;
grant execute on function core.control_checks() to service_role;

notify pgrst, 'reload schema';
select * from core.control_checks();
