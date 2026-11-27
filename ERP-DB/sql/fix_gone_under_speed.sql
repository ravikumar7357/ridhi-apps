-- FIX (21 Nov 2026): the sync engine is stuck since 20 Nov 11:36 IST — 74,759 inbox rows waiting, 265 failed runs a day.
--
-- WHY: core.sy_gone_under() finds a record's child rows with  left(legacy_key, n) = prefix , which no index can answer.
--      For every deleted audit record it scans all of history.audit_changes (30k rows, 91 MB). A batch with hundreds of
--      audit deletes passes the 2-minute statement limit ("canceling statement due to statement timeout … insert into
--      core.sync_gone … history.audit_changes"), the whole batch rolls back, and the next run hits the same batch again.
--
-- FIX: an index that can answer a prefix search, and the same search written as LIKE 'prefix%' so it uses it.
--      left(...) = prefix is kept as the exact test, so the result is the same rows as before — only faster.
--      Nothing is deleted or changed in the data. Paste into the SQL editor → Run. The last line must say PASS.

create index if not exists history_audit_changes_legacy_prefix
  on history.audit_changes (legacy_key text_pattern_ops) where legacy_key is not null;

create or replace function core.sy_gone_under(p_table text, p_prefix text, p_keep text[]) returns void
language plpgsql security definer set search_path = core, public as $$
begin
  execute format('insert into core.sync_gone (tbl, legacy_key) select %L, legacy_key from %s '
              || 'where legacy_key like %L and left(legacy_key, %s) = %L and not (legacy_key = any($1)) on conflict do nothing',
                 p_table, p_table,
                 replace(replace(replace(p_prefix, '\', '\\'), '%', '\%'), '_', '\_') || '%',
                 length(p_prefix), p_prefix)
    using coalesce(p_keep, '{}');
end $$;

select case when to_regclass('history.history_audit_changes_legacy_prefix') is not null
             and position('like' in pg_get_functiondef('core.sy_gone_under(text,text,text[])'::regprocedure)) > 0
            then 'PASS — prefix search indexed' else 'FAIL' end as result;
