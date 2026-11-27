-- THE NIGHTLY CHECKER (Ravi, 17 Nov: "keep my tables — make the data match"). Paste into ERP data → SQL editor → Run.
-- The last line must say PASS.
--
-- WHY: some saves never reach ERP data — bulk updates and a few screens don't pass them on (e.g. packType on 4,871 SKUs,
-- the 15 Nov extra-hours approvals, some Shopify sales orders). Your tables are right; the saves are missing.
--
-- HOW: a separate Apps Script (R-one checker) reads each Firebase list every night and hands it to core.checker_list.
-- This compares it with what ERP data has, record by record, and every difference goes into the INBOX as a normal save
-- (screen "nightly checker") — your engine then writes it into your proper tables, exactly like any other save.
-- Nothing is written to Firebase. Only the server key may call it (the Apps Script), never a browser.
--
-- SAFE: p_apply = false only REPORTS (what would change). A list that came back empty from Firebase, or that would lose more
-- than half of its records, is refused (a bad read must never wipe ERP data). Every run is written to core.checker_log.

create table if not exists core.checker_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  reg      text not null,
  applied  boolean not null,
  fb_n     int,             -- records Firebase has
  erp_n    int,             -- records ERP data had
  puts     int,             -- records added or changed
  deletes  int,             -- records Firebase no longer has
  sample   jsonb,           -- a few of the paths, to look at
  note     text
);
alter table core.checker_log enable row level security;   -- no browser access
  
-- the walk: down to the depth a record sits at (core.sy_list), one change per record that differs
create or replace function core.checker_walk(p_path text, a jsonb, b jsonb, lvl int, depth int) returns setof jsonb
language plpgsql immutable as $$
declare k text;
begin
  if a is not distinct from b then return; end if;
  if lvl >= depth or jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(b) is distinct from 'object' then
    if a is null or a = 'null'::jsonb then return next jsonb_build_object('k', 'delete', 'p', p_path, 'v', null);
    else return next jsonb_build_object('k', 'put', 'p', p_path, 'v', a); end if;
    return;
  end if;
  for k in select x from jsonb_object_keys(a) x union select y from jsonb_object_keys(b) y loop
    if not (a ? k) then return next jsonb_build_object('k', 'delete', 'p', p_path || '/' || k, 'v', null);
    elsif not (b ? k) then return next jsonb_build_object('k', 'put', 'p', p_path || '/' || k, 'v', a -> k);
    else return query select * from core.checker_walk(p_path || '/' || k, a -> k, b -> k, lvl + 1, depth);
    end if;
  end loop;
end $$;

create or replace function core.checker_list(p_reg text, p_value jsonb, p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path = core, public as $$
declare cur jsonb; d int; ch jsonb[]; puts int; dels int; fbn int; erpn int; note text := '';
begin
  if auth.role() is distinct from 'service_role' then raise exception 'checker_list: server only'; end if;
  if p_reg !~ '^pt_[A-Za-z0-9_]+$' or p_reg in ('pt_sync', 'pt_syncAudit', 'pt_dataMeter', 'pt_audit', 'pt_trash') then
    raise exception 'checker_list: % is not checked', p_reg; end if;
  select l.depth into d from core.sy_list(p_reg) l limit 1;
  d := coalesce(d, 2);
  cur := core.rt_value(p_reg);
  fbn := case when jsonb_typeof(p_value) = 'object' then (select count(*) from jsonb_object_keys(p_value)) else 0 end;
  erpn := case when jsonb_typeof(cur) = 'object' then (select count(*) from jsonb_object_keys(cur)) else 0 end;
  select coalesce(array_agg(c), '{}') into ch
    from core.checker_walk(p_reg, p_value, case when jsonb_typeof(p_value) = 'object' and jsonb_typeof(cur) is distinct from 'object' then '{}'::jsonb else cur end, 1, d) c;
  puts := (select count(*) from unnest(ch) c where c->>'k' = 'put');
  dels := (select count(*) from unnest(ch) c where c->>'k' = 'delete');
  -- a bad read must never wipe ERP data
  if (p_value is null or p_value = 'null'::jsonb or fbn = 0) and erpn > 5 then note := 'refused: Firebase sent nothing, ERP data has ' || erpn;
  elsif erpn > 10 and dels > erpn / 2 then note := 'refused: would remove ' || dels || ' of ' || erpn || ' records';
  end if;
  if p_apply and note = '' and coalesce(array_length(ch, 1), 0) > 0 then
    insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
    select now(), 'server', c->>'k', c->>'p', case when c->'v' = 'null'::jsonb then null else c->'v' end, 'nightly checker'
      from unnest(ch) c;                                   -- the engine (every 10 s) puts them into the tables
  end if;
  insert into core.checker_log (reg, applied, fb_n, erp_n, puts, deletes, sample, note)
  values (p_reg, p_apply and note = '', fbn, erpn, puts, dels,
          (select coalesce(jsonb_agg(c->>'k' || ' ' || (c->>'p')), '[]') from (select c from unnest(ch) c limit 6) s), nullif(note, ''));
  return jsonb_build_object('reg', p_reg, 'firebase', fbn, 'erp_data', erpn, 'puts', puts, 'deletes', dels,
                            'applied', p_apply and note = '', 'note', nullif(note, ''));
end $$;
revoke all on function core.checker_list(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function core.checker_list(text, jsonb, boolean) to service_role;
revoke all on function core.checker_walk(text, jsonb, jsonb, int, int) from public, anon, authenticated;

-- what the last night found, per list (the Apps Script's checkerReport and you in the SQL editor)
create or replace view core.checker_last as
  select distinct on (reg) reg, at, applied, fb_n, erp_n, puts, deletes, note, sample
    from core.checker_log order by reg, id desc;
revoke all on core.checker_last from public, anon, authenticated;

-- self-test: a tiny made-up list never touches real data (p_apply = false would not either; this checks the walk)
do $$
declare r int;
begin
  select count(*) into r from core.checker_walk('pt_x', '{"a":{"q":1},"b":{"q":2},"c":{"q":3}}', '{"a":{"q":1},"b":{"q":9},"d":{"q":4}}', 1, 2);
  if r <> 3 then raise exception 'checker self-test: expected 3 changes (b changed, c added, d removed), got %', r; end if;
end $$;

select case when to_regprocedure('core.checker_list(text,jsonb,boolean)') is not null
             and to_regclass('core.checker_log') is not null
            then 'PASS — the checker door is ready (server only)'
            else 'FAIL' end as result;
