-- ERP-DB check 007 · SELF-TEST: DOES THE RULE CHECKER REALLY WRITE NOTES?           written 28 Nov 2026 · safe to run any time
--
-- WHAT IT DOES
--   Inside one transaction: adds a fake save that breaks a rule (a write to the admin-only register pt_kaTargets by a
--   made-up person), reads the note the checker wrote, then UNDOES EVERYTHING by stopping with an error on purpose.
--   Nothing stays: not the fake save, not the note. The ERP never sees it (it is never committed).
--
-- WHAT YOU SEE: an ERROR — that is expected. Its text says either
--   "SELF-TEST PASS · the checker wrote: admin_only · …"   ← the checker works
--   "SELF-TEST FAIL · …"                                    ← tell Claude
--
-- RUN: Supabase → SQL editor → New query → paste → Run (on its own, not together with another file).

do $$
declare n int; d text;
begin
  insert into core.sync_inbox (saved_at, email, kind, path, value, screen, status)
  values (now(), 'selftest@checker.invalid', 'put', 'pt_kaTargets/__erp_selftest', '{"x": 1}'::jsonb, 'erp self-test', 'done');
  select count(*), min(rule || ' · ' || coalesce(detail, '')) into n, d
    from erp.rule_notes where path = 'pt_kaTargets/__erp_selftest';
  if n > 0 then
    raise exception 'SELF-TEST PASS · the checker wrote: % (all of it is now undone)', d;
  else
    raise exception 'SELF-TEST FAIL · no note was written (all of it is now undone)';
  end if;
end $$;
