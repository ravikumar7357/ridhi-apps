-- A REFUSED SAVE IS NO LONGER SILENT (20 Nov, Ravi: "yes fix this"). Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- What was wrong: core.rt_save put a save in the inbox, ran the engine, and answered "saved" — even when the engine then
-- refused it (for example a record with no status: "cannot place …: status <NULL>"). The screen said saved; the data was not.
-- Now: right after the engine run, rt_save looks at ITS OWN saves. If the engine refused any, the whole save is undone and
-- the screen gets an error that names the record and the reason ("rt_save: not saved — pt_x/123: cannot place …"), so the
-- person knows and can try again. Nothing else changes: saves the engine took, or has not reached yet, answer as before.
-- Only rt_save's own text is changed (and rt_cas, which saves through it, gets the same answer).

do $do$ declare d text; d0 text;
begin
  d := pg_get_functiondef('core.rt_save(jsonb, text)'::regprocedure); d0 := d;
  if position('v_from' in d) > 0 then raise notice 'rt_save already checks refused saves'; return; end if;
  -- 1. remember where the inbox stood before this save
  d := replace(d, 'declare n int; bad text;', 'declare n int; bad text; v_from bigint;');
  d := regexp_replace(d, '(\n\s*)(insert into core\.sync_inbox \(saved_at, email, kind, path, value, screen\))',
                      '\1v_from := (select coalesce(max(id), 0) from core.sync_inbox);\1\2');
  -- 2. after the engine run: any of these saves refused → undo the save and say why
  d := replace(d, 'if n > 0 then perform core.sync_now(); end if;',
    'if n > 0 then
    perform core.sync_now();
    select string_agg(x.path || '': '' || coalesce(left(x.error, 160), ''refused''), '' | '') into bad
      from (select path, error from core.sync_inbox
             where id > v_from and status = ''failed'' and email = coalesce(em, ''server'') order by id limit 3) x;
    if bad is not null then raise exception ''rt_save: not saved — %'', bad; end if;
  end if;');
  if d = d0 or position('v_from := ' in d) = 0 or position('rt_save: not saved' in d) = 0 then
    raise exception 'rt_save is not the text this fix expects — nothing changed';
  end if;
  execute d;
end $do$;

notify pgrst, 'reload schema';
select case when position('rt_save: not saved' in pg_get_functiondef('core.rt_save(jsonb, text)'::regprocedure)) > 0
             and position('v_from := ' in pg_get_functiondef('core.rt_save(jsonb, text)'::regprocedure)) > 0
            then 'PASS — a save the engine refuses now comes back as an error on the screen' else 'FAIL' end as result;
