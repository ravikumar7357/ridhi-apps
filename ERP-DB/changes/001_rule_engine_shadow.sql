-- ERP-DB change 001 · RULE ENGINE (SHADOW MODE)                                    written 27 Nov 2026 · run on live: ____
--
-- WHAT IT DOES
--   Adds schema "erp" with a rules table and a checker that looks at every ERP save as it lands in core.sync_inbox.
--   In SHADOW mode it only WRITES A NOTE in erp.rule_notes when a save breaks a rule. It never refuses or changes a save:
--   every check runs inside its own error guard, so a fault in the checker cannot stop a save.
--   Nothing existing is edited: core.rt_save, the sync engine and the screens are untouched. One trigger is added on
--   core.sync_inbox.
--
-- RULES IN THIS FIRST VERSION (owner's answers, 27 Nov)
--   month lock    a month closes after the 5th of the next month (IST); after that only admins may change its rows
--   admin only    whole register (payout freezes, KA targets) or a field value (extra hours status = authorized)
--   required      fields a new or edited record must have
--   ranges        number limits (extra hours 0–16)
--   add-only      history registers (audit, recycle bin): no edits, no deletes
--   no new rows   press entry (off on the screen since 5 Oct)
--   vendor fields vendors may change only status, vSent, rfdReqs on their own orders
--
-- HOW TO READ THE NOTES
--   select * from erp.rule_notes_by_day;              -- counts per day, register and rule
--   select * from erp.rule_notes order by id desc limit 50;
--
-- SWITCH
--   update erp.config set value = 'off'    where key = 'mode';   -- stop checking
--   update erp.config set value = 'shadow' where key = 'mode';   -- notes only (default)
--   ('on' = refuse bad saves comes in a later change, after the notes are clean.)
--
-- UNDO (removes everything this file added; no ERP data is touched)
--   drop trigger if exists erp_check_save on core.sync_inbox;
--   drop schema if exists erp cascade;
--
-- RUN: Supabase → SQL editor → paste this whole file → Run. The last line prints PASS.

begin;

create schema if not exists erp;
revoke all on schema erp from public, anon, authenticated;

-- 1 · settings ---------------------------------------------------------------------------------------------------------
create table if not exists erp.config (
  key   text primary key,
  value text not null,
  note  text
);
insert into erp.config (key, value, note) values
  ('mode',            'shadow',                'off | shadow (notes only)'),
  ('month_close_day', '5',                     'a month closes after this day of the next month (IST)'),
  ('superuser',       'ravi@thefabricrush.com', 'always admin, same as the Firebase rules')
on conflict (key) do nothing;

-- 2 · the rules, one row per register ----------------------------------------------------------------------------------
create table if not exists erp.rules (
  register      text primary key,                 -- first path segment, e.g. pt_extraHours
  key_depth     int  not null default 2,          -- path segments that make one record (pt_x/<id> = 2, pt_x/<code>/<id> = 3)
  month_field   text,                             -- field whose date decides the month (null = not month-based)
  required      text[] not null default '{}',     -- fields a saved record must have
  ranges        jsonb  not null default '{}',     -- {"hours": {"min": 0, "max": 16}}
  admin_write   boolean not null default false,   -- only admins may write this register
  admin_values  jsonb  not null default '{}',     -- {"status": ["authorized"]}: only admins may set these values
  add_only      boolean not null default false,   -- no edits or deletes of existing records
  no_new        boolean not null default false,   -- no new records
  vendor_fields text[],                           -- top-level fields a vendor may change (null = no vendor rule)
  note          text,
  updated_at    timestamptz not null default now()
);

insert into erp.rules (register, key_depth, month_field, required, ranges, admin_write, admin_values, add_only, no_new, vendor_fields, note) values
  ('pt_extraHours',    2, 'date',          '{date,empName,department,hours,status}', '{"hours":{"min":0,"max":16}}', false, '{"status":["authorized"]}', false, false, null, 'Q1-Q3'),
  ('pt_payoutFreezes', 2, null,            '{}', '{}', true,  '{}', false, false, null, 'admin only'),
  ('pt_kaTargets',     2, null,            '{}', '{}', true,  '{}', false, false, null, 'admin only'),
  ('pt_audit',         3, null,            '{}', '{}', false, '{}', true,  false, null, 'Q11 add-only'),
  ('pt_trash',         2, null,            '{}', '{}', false, '{}', true,  false, null, 'Q11 add-only'),
  ('pt_pressInventory',2, 'entryDate',     '{}', '{}', false, '{}', false, true,  null, 'Q15 press entry off since 5 Oct'),
  ('pt_vendorOrders',  3, null,            '{}', '{}', false, '{}', false, false, '{status,vSent,rfdReqs}', 'Q10'),
  ('pt_baseData',      2, 'receivingDate', '{}', '{}', false, '{}', false, false, null, 'Q5 job work by receiving date'),
  ('pt_cuttingData',   2, 'date',          '{}', '{}', false, '{}', false, false, null, 'cutting month'),
  ('pt_qcChecks',      2, 'date',          '{}', '{}', false, '{}', false, false, null, null),
  ('pt_qcIssuance',    2, 'date',          '{}', '{}', false, '{}', false, false, null, null),
  ('pt_qcReturns',     2, 'date',          '{}', '{}', false, '{}', false, false, null, null),
  ('pt_attend',        2, 'day',           '{}', '{}', false, '{}', false, false, null, null),
  ('pt_fgiLedger',     2, 'date',          '{}', '{}', false, '{}', false, false, null, 'Q6 DD/MM/YYYY'),
  ('pt_accLedger',     2, 'date',          '{}', '{}', false, '{}', false, false, null, null),
  ('pt_storeLedger',   2, 'date',          '{}', '{}', false, '{}', false, false, null, null),
  ('pt_fabInvLedger',  2, 'date',          '{}', '{}', false, '{}', false, false, null, null),
  ('pt_flowChallans',  2, 'date',          '{}', '{}', false, '{}', false, false, null, null),
  ('pt_salesOrders',   2, 'orderDate',     '{}', '{}', false, '{}', false, false, null, null),
  ('pt_greigePOs',     2, 'date',          '{}', '{}', false, '{}', false, false, null, null),
  ('pt_vendorChallans',3, 'date',          '{}', '{}', false, '{}', false, false, null, null)
on conflict (register) do nothing;

-- 3 · the notes --------------------------------------------------------------------------------------------------------
create table if not exists erp.rule_notes (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  inbox_id  bigint,
  email     text,
  screen    text,
  kind      text,
  path      text,
  register  text,
  rule      text not null,        -- month_lock | admin_only | admin_value | required | range | add_only | no_new | vendor_field | checker_error
  detail    text
);
create index if not exists rule_notes_at on erp.rule_notes (at);

create or replace view erp.rule_notes_by_day as
  select (at at time zone 'Asia/Kolkata')::date as day, register, rule, count(*) as notes, count(distinct email) as people,
         min(detail) as example
    from erp.rule_notes group by 1, 2, 3 order by 1 desc, 4 desc;

-- 4 · helpers ----------------------------------------------------------------------------------------------------------
-- 'YYYY-MM' from an ISO date, a DD/MM/YYYY date, or epoch milliseconds; null when it cannot tell
create or replace function erp.month_of(v jsonb) returns text language plpgsql immutable as $$
declare t text; m text[];
begin
  if v is null or v = 'null'::jsonb then return null; end if;
  if jsonb_typeof(v) = 'number' then
    return to_char(to_timestamp((v::text)::numeric / 1000) at time zone 'Asia/Kolkata', 'YYYY-MM');
  end if;
  t := trim(both '"' from v::text);
  m := regexp_match(t, '^(\d{4})-(\d{2})');          if m is not null then return m[1] || '-' || m[2]; end if;
  m := regexp_match(t, '^(\d{1,2})/(\d{1,2})/(\d{4})'); if m is not null then return m[3] || '-' || lpad(m[2], 2, '0'); end if;
  if t ~ '^\d{12,13}$' then return to_char(to_timestamp(t::numeric / 1000) at time zone 'Asia/Kolkata', 'YYYY-MM'); end if;
  return null;
end $$;

-- is month 'YYYY-MM' closed today? (closed after the close day of the next month, IST)
create or replace function erp.month_closed(p_month text) returns boolean language sql stable as $$
  select p_month is not null and p_month ~ '^\d{4}-\d{2}$'
     and (now() at time zone 'Asia/Kolkata')::date
         > (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date
           + (coalesce((select value from erp.config where key = 'month_close_day'), '5')::int - 1)
$$;

-- is this email an admin in the ERP's own rights (same test as the Firebase rules)?
create or replace function erp.is_admin(p_email text) returns boolean language plpgsql stable security definer set search_path = core, public as $$
declare k text; perm jsonb;
begin
  if p_email is null then return false; end if;
  if lower(p_email) = (select value from erp.config where key = 'superuser') then return true; end if;
  k := regexp_replace(lower(p_email), '\.', ',', 'g');
  perm := core.rt_value('pt_perms/' || k);
  return coalesce((perm #> '{admin}') = 'true'::jsonb, false);
end $$;

create or replace function erp.is_vendor(p_email text) returns boolean language plpgsql stable security definer set search_path = core, public as $$
begin
  if p_email is null then return false; end if;
  return core.rt_value('pt_vendorByEmail/' || regexp_replace(p_email, '\.', ',', 'g')) is not null;
end $$;

-- 5 · the checker ------------------------------------------------------------------------------------------------------
create or replace function erp.check_save() returns trigger language plpgsql security definer set search_path = erp, core, public as $$
declare
  r erp.rules; s text[]; n int; rec_path text; old_rec jsonb; new_rec jsonb; adm boolean; f text; lim jsonb; x numeric;
  m_old text; m_new text; k text;
begin
  if coalesce((select value from erp.config where key = 'mode'), 'off') = 'off' then return null; end if;
  if new.screen in ('nightly checker', 'firebase capture', 'way back test', 'compare-and-set') or new.screen like 'job · %' then return null; end if;

  begin
    s := string_to_array(trim(both '/' from coalesce(new.path, '')), '/');
    n := coalesce(array_length(s, 1), 0);
    if n = 0 then return null; end if;
    select * into r from erp.rules where register = s[1];
    if not found then return null; end if;

    if n < r.key_depth then
      -- a write above one record (whole list or a branch): note it for the history and vendor rules only
      if r.add_only and new.kind <> 'put' then
        insert into erp.rule_notes (inbox_id, email, screen, kind, path, register, rule, detail)
        values (new.id, new.email, new.screen, new.kind, new.path, s[1], 'add_only', 'write above one record of a history list');
      end if;
      return null;
    end if;

    rec_path := array_to_string(s[1:r.key_depth], '/');
    old_rec  := core.rt_value(rec_path);
    -- the value that ends up at the written path: put = replace, patch = merge into what is there, delete = gone
    lim := case
      when new.kind = 'delete' then null
      when new.kind = 'patch' and jsonb_typeof(new.value) = 'object'
        then coalesce(case when n = r.key_depth then old_rec else old_rec #> s[r.key_depth + 1:n] end, '{}'::jsonb) || new.value
      else new.value end;
    if n = r.key_depth then new_rec := lim;
    else new_rec := core.rtr_with(old_rec, s[r.key_depth + 1:n], lim);
    end if;
    lim := null;

    adm := null;   -- looked up only when a rule needs it

    -- add-only history
    if r.add_only and old_rec is not null and new_rec is distinct from old_rec then
      insert into erp.rule_notes (inbox_id, email, screen, kind, path, register, rule, detail)
      values (new.id, new.email, new.screen, new.kind, new.path, s[1], 'add_only',
              case when new_rec is null then 'deleted a history record' else 'changed a history record' end);
    end if;

    -- no new rows
    if r.no_new and old_rec is null and new_rec is not null then
      insert into erp.rule_notes (inbox_id, email, screen, kind, path, register, rule, detail)
      values (new.id, new.email, new.screen, new.kind, new.path, s[1], 'no_new', 'new record in a register that takes no new rows');
    end if;

    -- admin-only register
    if r.admin_write then
      adm := erp.is_admin(new.email);
      if not adm then
        insert into erp.rule_notes (inbox_id, email, screen, kind, path, register, rule, detail)
        values (new.id, new.email, new.screen, new.kind, new.path, s[1], 'admin_only', 'non-admin wrote an admin-only register');
      end if;
    end if;

    -- admin-only values (e.g. status = authorized)
    if new_rec is not null and r.admin_values <> '{}'::jsonb then
      for f, lim in select * from jsonb_each(r.admin_values) loop
        if (new_rec -> f) is distinct from (old_rec -> f) and (lim ? (new_rec ->> f)) then
          if adm is null then adm := erp.is_admin(new.email); end if;
          if not adm then
            insert into erp.rule_notes (inbox_id, email, screen, kind, path, register, rule, detail)
            values (new.id, new.email, new.screen, new.kind, new.path, s[1], 'admin_value', 'non-admin set ' || f || ' = ' || (new_rec ->> f));
          end if;
        end if;
      end loop;
    end if;

    -- required fields
    if new_rec is not null and jsonb_typeof(new_rec) = 'object' and cardinality(r.required) > 0 then
      select string_agg(q, ', ') into k from unnest(r.required) q where coalesce(new_rec ->> q, '') = '';
      if k is not null then
        insert into erp.rule_notes (inbox_id, email, screen, kind, path, register, rule, detail)
        values (new.id, new.email, new.screen, new.kind, new.path, s[1], 'required', 'missing: ' || k);
      end if;
    end if;

    -- ranges
    if new_rec is not null and jsonb_typeof(new_rec) = 'object' and r.ranges <> '{}'::jsonb then
      for f, lim in select * from jsonb_each(r.ranges) loop
        if (new_rec ->> f) ~ '^-?\d+(\.\d+)?$' then
          x := (new_rec ->> f)::numeric;
          if (lim ? 'min' and x < (lim ->> 'min')::numeric) or (lim ? 'max' and x > (lim ->> 'max')::numeric) then
            insert into erp.rule_notes (inbox_id, email, screen, kind, path, register, rule, detail)
            values (new.id, new.email, new.screen, new.kind, new.path, s[1], 'range', f || ' = ' || x || ' outside ' || lim::text);
          end if;
        end if;
      end loop;
    end if;

    -- month lock: the old month (editing or deleting) and the new month (adding or moving into)
    if r.month_field is not null then
      m_old := case when old_rec is not null and jsonb_typeof(old_rec) = 'object' then erp.month_of(old_rec -> r.month_field) end;
      m_new := case when new_rec is not null and jsonb_typeof(new_rec) = 'object' then erp.month_of(new_rec -> r.month_field) end;
      if (old_rec is distinct from new_rec) and (erp.month_closed(m_old) or erp.month_closed(m_new)) then
        if adm is null then adm := erp.is_admin(new.email); end if;
        insert into erp.rule_notes (inbox_id, email, screen, kind, path, register, rule, detail)
        values (new.id, new.email, new.screen, new.kind, new.path, s[1], case when adm then 'month_lock_admin' else 'month_lock' end,
                'closed month ' || coalesce(case when erp.month_closed(m_old) then m_old end, m_new)
                || case when adm then ' (admin: allowed with a reason)' else '' end);
      end if;
    end if;

    -- vendor fields
    if r.vendor_fields is not null and erp.is_vendor(new.email) then
      select string_agg(key, ', ') into k
        from (select key from jsonb_each(coalesce(new_rec, '{}'::jsonb))
              union select key from jsonb_each(coalesce(old_rec, '{}'::jsonb))) keys
       where (coalesce(new_rec, '{}'::jsonb) -> key) is distinct from (coalesce(old_rec, '{}'::jsonb) -> key)
         and not (key = any (r.vendor_fields));
      if k is not null then
        insert into erp.rule_notes (inbox_id, email, screen, kind, path, register, rule, detail)
        values (new.id, new.email, new.screen, new.kind, new.path, s[1], 'vendor_field', 'vendor changed: ' || k);
      end if;
    end if;

  exception when others then
    begin
      insert into erp.rule_notes (inbox_id, email, screen, kind, path, register, rule, detail)
      values (new.id, new.email, new.screen, new.kind, new.path, s[1], 'checker_error', left(sqlerrm, 300));
    exception when others then null;   -- never stop a save
    end;
  end;
  return null;
end $$;

drop trigger if exists erp_check_save on core.sync_inbox;
create trigger erp_check_save after insert on core.sync_inbox
  for each row execute function erp.check_save();

-- only the server may read or change the rules and notes
revoke all on all tables in schema erp from public, anon, authenticated;
revoke all on all functions in schema erp from public, anon, authenticated;

commit;

-- 6 · self-check (reads only) ------------------------------------------------------------------------------------------
select case
  when (select count(*) from erp.rules) >= 21
   and erp.month_of('"2026-10-14"') = '2026-10' and erp.month_of('"14/10/2026, 10:30"') = '2026-10'
   and erp.month_of('1792000000000') is not null
   and erp.month_closed('2020-01') and not erp.month_closed(to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM'))
   and exists (select 1 from pg_trigger where tgname = 'erp_check_save')
  then 'PASS · rule engine added in shadow mode' else 'FAIL · tell Claude' end as result;
