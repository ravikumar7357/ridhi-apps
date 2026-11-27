-- FIX: THE TEST LINK'S FAST FILES (17 Nov). Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- What was wrong: the storage rule let a person read erp-lists/manifest.json only when core.rt_reader() was true — and for
-- Firebase sign-ins (Ravi too) it is false. Without the manifest the test link cannot find the ready list files, so EVERY
-- page downloaded every list from the database instead (60 lists, 30–60 s each, all at once — the QA review's "40–71 s").
-- The list files themselves were fine (each by its own read rule).
--
-- Now: the manifest is readable by any ERP sign-in (an email in the token). It holds only list names and save numbers —
-- no data. Each list file keeps its own read rule (core.rt_may_read), exactly as before.

drop policy if exists "erp lists: ERP readers" on storage.objects;
create policy "erp lists: ERP readers" on storage.objects for select to anon, authenticated
  using (bucket_id = 'erp-lists' and (case when name = 'manifest.json' then core.me_email() is not null
                                           else core.rt_may_read(regexp_replace(name, '\.json$', '')) end));

select case when exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                          and policyname = 'erp lists: ERP readers' and qual like '%me_email%')
            then 'PASS — the test link can find its fast files again'
            else 'FAIL — the rule was not changed' end as result;
