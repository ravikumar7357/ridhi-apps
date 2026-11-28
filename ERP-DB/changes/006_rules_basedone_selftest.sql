-- ERP-DB change 006 · COMPLETED JOB WORK IN THE RULES                               written 28 Nov 2026 · run on live: ____
--
-- WHAT IT DOES
--   Adds pt_baseDone (completed job work, kept as pt_baseDone/<day>/<id>) to erp.rules with the same month lock as open
--   job work (receivingDate). Until now edits to finished entries were not checked at all. Shadow mode: notes only.
--   Run 007 (the self-test) AFTER this one, as its own query.
--
-- UNDO
--   delete from erp.rules where register = 'pt_baseDone';
--
-- RUN: Supabase → SQL editor → paste → Run. The last line prints PASS.

insert into erp.rules (register, key_depth, month_field, note)
values ('pt_baseDone', 3, 'receivingDate', 'completed job work, pt_baseDone/<day>/<id>; same month lock as pt_baseData')
on conflict (register) do nothing;

select case when exists (select 1 from erp.rules where register = 'pt_baseDone')
            then 'PASS · completed job work is now checked (notes only)' else 'FAIL · tell Claude' end as result;
