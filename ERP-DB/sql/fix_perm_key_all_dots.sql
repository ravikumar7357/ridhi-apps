-- URGENT FIX (23 Nov): people with a dot before the @ (firstname.lastname@…) cannot save or read on ERP data.
-- Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- Firebase's rules turn an email into its key with .replace('.', ','), which replaces EVERY dot
-- (zyod.shalendra@gmail.com → zyod,shalendra@gmail,com). ERP data's copy of the rules replaced only the FIRST dot
-- (→ zyod,shalendra@gmail.com), so for 15 of 58 staff their rights record (pt_perms) was not found and every save
-- or rights-checked read was refused ("permission denied … the same rule as Firebase") since the switch on 22 Nov.
-- This adds the 'g' (every match) flag in the two rule functions. Nothing else changes.

do $do$ declare f text; d text; d0 text; n int := 0;
begin
  foreach f in array array['core.rt_can_save(text, text, jsonb)', 'core.rt_can_read(text, text)'] loop
    d := pg_get_functiondef(f::regprocedure); d0 := d;
    d := replace(d, $$k := regexp_replace(eml, '\.', ',');$$, $$k := regexp_replace(eml, '\.', ',', 'g');$$);
    d := replace(d, $$vk := regexp_replace(em, '\.', ',');$$, $$vk := regexp_replace(em, '\.', ',', 'g');$$);
    if d = d0 then raise exception '% is not the text this fix expects — nothing changed', f; end if;
    execute d; n := n + 1;
  end loop;
end $do$;

notify pgrst, 'reload schema';
select case when core.rt_can_save('zyod.shalendra@gmail.com', 'pt_qcChecks/qc_fixcheck', '{"x":1}'::jsonb)
             and core.rt_can_save('gayatri.rawat@ridhiblockprint.com', 'pt_salesOrders/B2B-FIXCHECK', '{"x":1}'::jsonb)
            then 'PASS — staff with a dot in their name can save again' else 'FAIL — tell Claude' end as result;
