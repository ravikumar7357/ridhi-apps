-- THE CHECKER, BIG LISTS IN PIECES (17 Nov). Paste into ERP data → SQL editor → Run. The last line must say PASS.
-- The first dry run stopped on the big lists (masterDB, orderBook, salesOrders, fgiLedger … 3–7 MB each): too big for one
-- request. Now the checker script sends a big list in pieces of records (checker_part: what to add or change in that piece)
-- and then once the list of all its record keys (checker_finish: what Firebase no longer has, the safety rules, the log row).
-- Same rules as checker_list: server only, p_apply = false only reports, a read that would wipe more than half is refused.

-- one piece: only the records in it are compared (no removals here)
create or replace function core.checker_part(p_reg text, p_value jsonb, p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path = core, public as $$
declare cur jsonb; sub jsonb; d int; ch jsonb[]; puts int;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'checker_part: server only'; end if;
  if p_reg !~ '^pt_[A-Za-z0-9_]+$' or p_reg in ('pt_sync', 'pt_syncAudit', 'pt_dataMeter', 'pt_audit', 'pt_trash') then
    raise exception 'checker_part: % is not checked', p_reg; end if;
  if jsonb_typeof(p_value) is distinct from 'object' then raise exception 'checker_part: a piece must be records'; end if;
  select l.depth into d from core.sy_list(p_reg) l limit 1; d := coalesce(d, 2);
  -- ERP data's copy of the SAME records only, so nothing outside this piece is touched. 19 Nov: read record by record
  -- (one lookup by key each), never the whole list — loading a 4–6 MB list for every 300 KB piece ran past the statement
  -- time limit, so Vendor Orders, QC, Order Book, Finished Goods, Cutting and Master DB were never applied.
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into sub
    from (select k, core.rt_value(p_reg || '/' || k) v from jsonb_object_keys(p_value) k) z
   where v is not null and v <> 'null'::jsonb;
  select coalesce(array_agg(c), '{}') into ch from core.checker_walk(p_reg, p_value, sub, 1, d) c;
  ch := array(select c from unnest(ch) c where c->>'k' = 'put');      -- a piece never removes
  puts := coalesce(array_length(ch, 1), 0);
  if p_apply and puts > 0 then
    insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
    select now(), 'server', 'put', c->>'p', c->'v', 'nightly checker' from unnest(ch) c;
  end if;
  return jsonb_build_object('puts', puts, 'sample', (select coalesce(jsonb_agg(c->>'p'), '[]') from (select c from unnest(ch) c limit 3) s));
end $$;

-- the end of a big list: every record key Firebase has → what ERP data must remove; the safety rules; the log row
create or replace function core.checker_finish(p_reg text, p_keys jsonb, p_puts int, p_sample jsonb, p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path = core, public as $$
declare cur jsonb; erpn int; fbn int; gone text[]; dels int; note text := '';
begin
  if auth.role() is distinct from 'service_role' then raise exception 'checker_finish: server only'; end if;
  if p_reg !~ '^pt_[A-Za-z0-9_]+$' or p_reg in ('pt_sync', 'pt_syncAudit', 'pt_dataMeter', 'pt_audit', 'pt_trash') then
    raise exception 'checker_finish: % is not checked', p_reg; end if;
  cur := core.rt_value(p_reg);
  fbn := coalesce(jsonb_array_length(p_keys), 0);
  erpn := case when jsonb_typeof(cur) = 'object' then (select count(*) from jsonb_object_keys(cur)) else 0 end;
  select coalesce(array_agg(k), '{}') into gone from jsonb_object_keys(case when jsonb_typeof(cur) = 'object' then cur else '{}'::jsonb end) k
   where not (p_keys ? k);
  dels := coalesce(array_length(gone, 1), 0);
  if fbn = 0 and erpn > 5 then note := 'refused: Firebase sent nothing, ERP data has ' || erpn;
  elsif erpn > 10 and dels > erpn / 2 then note := 'refused: would remove ' || dels || ' of ' || erpn || ' records';
  end if;
  if p_apply and note = '' and dels > 0 then
    insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
    select now(), 'server', 'delete', p_reg || '/' || k, null, 'nightly checker' from unnest(gone) k;
  end if;
  insert into core.checker_log (reg, applied, fb_n, erp_n, puts, deletes, sample, note)
  values (p_reg, p_apply and note = '', fbn, erpn, p_puts, dels,
          coalesce(p_sample, '[]'::jsonb) || (select coalesce(jsonb_agg('delete ' || p_reg || '/' || k), '[]') from (select k from unnest(gone) k limit 3) s),
          nullif(note, ''));
  return jsonb_build_object('reg', p_reg, 'firebase', fbn, 'erp_data', erpn, 'puts', p_puts, 'deletes', dels,
                            'applied', p_apply and note = '', 'note', nullif(note, ''));
end $$;

revoke all on function core.checker_part(text, jsonb, boolean) from public, anon, authenticated;
revoke all on function core.checker_finish(text, jsonb, int, jsonb, boolean) from public, anon, authenticated;
grant execute on function core.checker_part(text, jsonb, boolean) to service_role;
grant execute on function core.checker_finish(text, jsonb, int, jsonb, boolean) to service_role;

select case when to_regprocedure('core.checker_part(text,jsonb,boolean)') is not null
             and to_regprocedure('core.checker_finish(text,jsonb,integer,jsonb,boolean)') is not null
            then 'PASS — the checker can do big lists in pieces'
            else 'FAIL' end as result;
