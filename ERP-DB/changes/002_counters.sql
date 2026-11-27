-- ERP-DB change 002 · SERVER COUNTERS                                              written 27 Nov 2026 · run on live: ____
--
-- WHAT IT DOES
--   Adds erp.next_no(kind, period, floor): hands out the next business number, one at a time, even when two people save
--   at the same moment. Formats stay as they are (the screen still builds "RFD-202611-013"; only the 13 comes from here).
--   "floor" is the highest number the screen can see today, so counters start from today's numbers with no seeding and
--   never go backwards.
--   Nothing uses it yet: the screens switch to it one by one in later changes (flow-challan.js, flow-printorder.js,
--   flow-emb.js, raise-sales-order.js, masters, fabric codes, FBA box). Until then this file changes nothing.
--
-- KINDS (one counter per kind and period; period = 'YYYYMM', 'DDMMYYYY-<channel>', or '' for running numbers)
--   challan_rfd, challan_trfd, challan_emb, print_order, sales_order, vendor_po, vendor_request, delivery_challan,
--   greige_po, masters_row, fabric_code, fba_box   (any new kind works without a change)
--
-- TRY IT (safe: a test kind)
--   select erp.next_no('test', '202611', 0);   -- 1
--   select erp.next_no('test', '202611', 0);   -- 2
--   select erp.next_no('test', '202611', 40);  -- 41 (floor wins)
--   delete from erp.counters where kind = 'test';
--
-- UNDO
--   drop function if exists erp.next_no(text, text, int);
--   drop table if exists erp.counters;
--
-- NEEDS: change 001 (schema erp). RUN: Supabase → SQL editor → paste → Run. The last line prints PASS.

begin;

create schema if not exists erp;

create table if not exists erp.counters (
  kind       text not null,
  period     text not null default '',
  last_no    int  not null default 0 check (last_no >= 0),
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (kind, period)
);

create or replace function erp.next_no(p_kind text, p_period text default '', p_floor int default 0) returns int
language plpgsql volatile security definer set search_path = erp, core, public as $$
declare v int;
begin
  if coalesce(trim(p_kind), '') = '' then raise exception 'next_no: kind is empty'; end if;
  if core.me_email() is null and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'next_no: not signed in';
  end if;
  insert into erp.counters as c (kind, period, last_no, updated_by)
  values (p_kind, coalesce(p_period, ''), greatest(coalesce(p_floor, 0), 0) + 1, core.me_email())
  on conflict (kind, period) do update
     set last_no = greatest(c.last_no, coalesce(p_floor, 0)) + 1, updated_at = now(), updated_by = core.me_email()
  returning last_no into v;
  return v;
end $$;

revoke all on erp.counters from public, anon, authenticated;
revoke all on function erp.next_no(text, text, int) from public, anon;
grant usage on schema erp to authenticated;
grant execute on function erp.next_no(text, text, int) to authenticated;

commit;

-- self-check: uses a throw-away kind and removes it
select case when erp.next_no('selfcheck', 'x', 0) = 1 and erp.next_no('selfcheck', 'x', 0) = 2 and erp.next_no('selfcheck', 'x', 9) = 10
            then 'PASS · counters added (nothing uses them yet)' else 'FAIL · tell Claude' end as result;
delete from erp.counters where kind = 'selfcheck';
