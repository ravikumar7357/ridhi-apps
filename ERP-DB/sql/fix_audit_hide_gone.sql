-- FIX (21 Nov 2026): the audit log read (pt_audit/<month>) still showed 87 entries that were deleted in Firebase.
-- Supabase keeps deleted rows on purpose and lists them in core.sync_gone (tbl 'history.audit_entries'); the read in
-- core.rt_build did not skip them, so the full check found the same 87 differences on every run.
-- This changes ONLY the two pt_audit lines of core.rt_build: entries on the gone list are left out of the answer.
-- No data is deleted. The old definition is kept in core.fix_backup (UNDO at the bottom). The last line must say PASS.

create table if not exists core.fix_backup (id bigint generated always as identity primary key, at timestamptz default now(), what text, def text);
revoke all on core.fix_backup from public, anon, authenticated;
insert into core.fix_backup (what, def) select 'function core.rt_build(text) before fix_audit_hide_gone', pg_get_functiondef('core.rt_build(text)'::regprocedure);

do $fix$
declare d text := pg_get_functiondef('core.rt_build(text)'::regprocedure); d2 text;
  one_old text := $o$select firebase into v from history.audit_entries where legacy_key = array_to_string(segs[1:3], '/');$o$;
  one_new text := $o$select firebase into v from history.audit_entries ae where ae.legacy_key = array_to_string(segs[1:3], '/') and not exists (select 1 from core.sync_gone g where g.tbl = 'history.audit_entries' and g.legacy_key = ae.legacy_key);$o$;
  mon_old text := $o$from history.audit_entries where left(legacy_key, length(segs[2]) + 10) = 'pt_audit/' || segs[2] || '/'; return v;$o$;
  mon_new text := $o$from history.audit_entries ae where left(ae.legacy_key, length(segs[2]) + 10) = 'pt_audit/' || segs[2] || '/' and not exists (select 1 from core.sync_gone g where g.tbl = 'history.audit_entries' and g.legacy_key = ae.legacy_key); return v;$o$;
begin
  if position(one_old in d) = 0 or position(mon_old in d) = 0 then raise exception 'fix_audit_hide_gone: core.rt_build is not the expected version — nothing changed'; end if;
  d2 := replace(replace(d, one_old, one_new), mon_old, mon_new);
  -- the month read names its columns without the alias: legacy_key / firebase stay unambiguous (one table)
  execute d2;
end $fix$;

notify pgrst, 'reload schema';

select case when position('core.sync_gone g where g.tbl = ''history.audit_entries''' in pg_get_functiondef('core.rt_build(text)'::regprocedure)) > 0
            then 'PASS — deleted audit entries are no longer shown' else 'FAIL' end as result;

-- UNDO (only if the audit screen misbehaves):
--   do $$ declare d text; begin
--     select def into d from core.fix_backup where what = 'function core.rt_build(text) before fix_audit_hide_gone' order by id desc limit 1;
--     execute d;
--   end $$;
