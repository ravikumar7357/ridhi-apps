-- A REFUSED SAVE IS NO LONGER SILENT — part 2 (20 Nov). Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- Part 1 checked the save's own records right after the engine run. Test at 12:38: when the every-10-seconds engine run was
-- busy at that very moment, the save's own run did nothing, the save answered "saved", and the engine refused the record a
-- second later. Now the save waits for the engine (tries again every 0.2 s, at most 3 s) until its own records are handled,
-- and only then answers — saved, or "not saved — <record>: <reason>".

do $do$ declare d text; d0 text;
begin
  d := pg_get_functiondef('core.rt_save(jsonb, text)'::regprocedure); d0 := d;
  if position('rt_save: not saved' in d) = 0 then raise exception 'paste fix_save_refused.sql first'; end if;
  if position('pg_sleep(0.2)' in d) > 0 then raise notice 'already waits for the engine'; return; end if;
  d := replace(d, 'if n > 0 then
    perform core.sync_now();',
'if n > 0 then
    for i in 1..15 loop
      perform core.sync_now();
      exit when not exists (select 1 from core.sync_inbox where id > v_from and status = ''new'' and email = coalesce(em, ''server''));
      perform pg_sleep(0.2);
    end loop;');
  if d = d0 then raise exception 'rt_save is not the text this fix expects — nothing changed'; end if;
  execute d;
end $do$;

notify pgrst, 'reload schema';
select case when position('pg_sleep(0.2)' in pg_get_functiondef('core.rt_save(jsonb, text)'::regprocedure)) > 0
             and position('rt_save: not saved' in pg_get_functiondef('core.rt_save(jsonb, text)'::regprocedure)) > 0
            then 'PASS — a save now waits for the engine (at most 3 s) and says if it was refused' else 'FAIL' end as result;
