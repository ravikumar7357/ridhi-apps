-- SELLORA'S SAVES SHOW AT ONCE (20 Nov, tester run). Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- Found while testing: a Sellora save (a Firestore document of a collection the engine does not build rows for — settings,
-- history, listing rules …) was filed by core.fs_direct_apply, which runs once a MINUTE. So the save answered after ~3.2 s (it
-- waited for the engine, which never handles these) and the document was not there to read for up to a minute.
-- Now the save files those documents itself, at once (the minute job stays as a safety net).

do $do$ declare d text; d0 text;
begin
  d := pg_get_functiondef('core.rt_save(jsonb, text)'::regprocedure); d0 := d;
  if position('pg_sleep(0.2)' in d) = 0 then raise exception 'paste fix_save_refused.sql and fix_save_refused_2.sql first'; end if;
  if position('fs_direct_apply' in d) > 0 then raise notice 'already files Firestore saves at once'; return; end if;
  d := replace(d, '      perform core.sync_now();
      exit when',
'      perform core.sync_now();
      if exists (select 1 from core.sync_inbox where id > v_from and status = ''new'' and path like ''fs/%'') then perform core.fs_direct_apply(500); end if;
      exit when');
  if d = d0 then raise exception 'rt_save is not the text this fix expects — nothing changed'; end if;
  execute d;
end $do$;

notify pgrst, 'reload schema';
select case when position('fs_direct_apply' in pg_get_functiondef('core.rt_save(jsonb, text)'::regprocedure)) > 0
            then 'PASS — Sellora''s saves are filed at once' else 'FAIL' end as result;
