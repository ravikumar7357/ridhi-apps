-- =====================================================================================
-- CORE ROOM · SPEED for the shadow tests (Ravi, 12 Nov: "why is it so slow")
-- NEEDS: core_masters.sql + core_skus.sql.  WHERE: ERP TEST.  HOW: paste the WHOLE file → Run. Safe to run again.
-- What it does: every row keeps its record's fingerprint, made ONCE when the row is written (column fp), and two new doors
-- give all fingerprints of a section in ONE answer (no pages, no sorting, no re-hashing). Nothing else changes.
-- CHECK: the last result is a list of checks — every row must say PASS.
-- =====================================================================================

-- 1 · the fingerprint, made when a row is written
create or replace function core.set_fp() returns trigger
language plpgsql as $$
begin
  new.fp := case when new.firebase is null then null else encode(sha256(convert_to(new.firebase::text, 'UTF8')), 'hex') end;
  return new;
end $$;

do $$ declare t text; begin
  perform set_config('core.loading', 'on', true);          -- filling the new column is not a change by a person: not logged, not stamped
  foreach t in array array['article_types','article_subtypes','colours','sizes','pack_sizes','departments','employment_types','accessories',
                           'print_rules','recipes','sku_code_rules','vendors','skus','custom_skus','sku_images','sku_priority'] loop
    execute format('alter table core.%I add column if not exists fp text', t);
    execute format('drop trigger if exists aa_fp on core.%I', t);
    execute format('create trigger aa_fp before insert or update on core.%I for each row execute function core.set_fp()', t);
    execute format('update core.%I set fp = null where firebase is not null and fp is distinct from encode(sha256(convert_to(firebase::text, ''UTF8'')), ''hex'')', t);
  end loop;
end $$;

-- 2 · Masters: every Firebase record's fingerprint, in one answer { path: fingerprint, …, "#copy_of": day }
create or replace function core.masters_fp() returns jsonb
language sql stable security definer set search_path = core, public as $$
  -- an ERP person, the loader, or the SQL Editor itself (session_user postgres — for the checks below)
  select case when core.me_id() is not null or auth.role() = 'service_role' or session_user = 'postgres' then (
    select coalesce(jsonb_object_agg(path, h), '{}'::jsonb) from (
                select legacy_key as path, fp as h from core.article_types    where legacy_key like 'pt\_%' and fp is not null
      union all select legacy_key, fp from core.article_subtypes where legacy_key like 'pt\_%' and fp is not null
      union all select legacy_key, fp from core.colours          where legacy_key like 'pt\_%' and fp is not null
      union all select legacy_key, fp from core.sizes            where legacy_key like 'pt\_%' and fp is not null
      union all select legacy_key, fp from core.pack_sizes       where legacy_key like 'pt\_%' and fp is not null
      union all select legacy_key, fp from core.departments      where legacy_key like 'pt\_%' and fp is not null
      union all select legacy_key, fp from core.employment_types where legacy_key like 'pt\_%' and fp is not null
      union all select legacy_key, fp from core.accessories      where legacy_key like 'pt\_%' and fp is not null
      union all select legacy_key, fp from core.print_rules      where legacy_key like 'pt\_%' and fp is not null
      union all select legacy_key, fp from core.recipes          where legacy_key like 'pt\_%' and fp is not null
      union all select legacy_key, fp from core.sku_code_rules   where legacy_key like 'pt\_%' and fp is not null
      union all select legacy_key, fp from core.vendors          where legacy_key like 'pt\_%' and fp is not null
      -- fabrics hold several Firebase records each; colour links and the records kept aside are few: made here
      union all select s.prefix || e.key, encode(sha256(convert_to(e.value::text, 'UTF8')), 'hex')
                  from core.fabrics f
                  cross join lateral jsonb_each(coalesce(f.firebase, '{}'::jsonb)) src (name, recs)
                  join (values ('fabricType', 'pt_masters/fabricType/'), ('greigeRfd', 'pt_masters/greigeRfd/'),
                               ('greigeDesk', 'pt_gdTest/mst/'), ('fabricSku', 'pt_masters/fabricSku/')) s (name, prefix) on s.name = src.name
                  cross join lateral jsonb_each(src.recs) e
      union all select 'pt_colorGroups/map/' || e.key, encode(sha256(convert_to(e.value::text, 'UTF8')), 'hex')
                  from core.colour_group_members m cross join lateral jsonb_each(coalesce(m.firebase, '{}'::jsonb)) e
      union all select x->>'path', encode(sha256(convert_to((x->'rec')::text, 'UTF8')), 'hex')
                  from core.settings st cross join lateral jsonb_array_elements(st.value) x
                 where st.key = 'masters.not_moved' and jsonb_typeof(st.value) = 'array'
      union all select '#copy_of', st.value #>> '{}' from core.settings st where st.key = 'sync.masters_backup'
    ) r) end
$$;

-- 3 · SKUs: the same, in one answer
create or replace function core.skus_fp() returns jsonb
language sql stable security definer set search_path = core, public as $$
  select case when core.me_id() is not null or auth.role() = 'service_role' or session_user = 'postgres' then (
    select coalesce(jsonb_object_agg(path, h), '{}'::jsonb) from (
                select legacy_key as path, fp as h from core.skus where legacy_key is not null and fp is not null
      union all select legacy_key, fp from core.custom_skus  where legacy_key is not null and fp is not null
      union all select legacy_key, fp from core.sku_images   where legacy_key is not null and fp is not null
      union all select legacy_key, fp from core.sku_priority where legacy_key is not null and fp is not null
      union all select 'pt_fnskuMap/' || e.key, encode(sha256(convert_to(e.value::text, 'UTF8')), 'hex')
                  from core.settings st cross join lateral jsonb_each(st.value) e where st.key = 'skus.fnsku_map' and jsonb_typeof(st.value) = 'object'
      union all select '#copy_of', st.value #>> '{}' from core.settings st where st.key = 'sync.skus_backup'
    ) r) end
$$;
revoke all on function core.masters_fp(), core.skus_fp(), core.set_fp() from public;
grant execute on function core.masters_fp(), core.skus_fp() to anon, authenticated, service_role;   -- anon = a Firebase sign-in; nothing without a real ERP person

-- 4 · checks
notify pgrst, 'reload schema';
select 1 as n, 'every Firebase row has its fingerprint saved (16 tables)' as check_name,
       case when not exists (select 1 from core.skus where firebase is not null and fp is null) and not exists (select 1 from core.custom_skus where firebase is not null and fp is null)
             and not exists (select 1 from core.colours where firebase is not null and fp is null) and not exists (select 1 from core.sku_images where firebase is not null and fp is null)
            then 'PASS' else 'FAIL' end as result
union all select 2, 'the saved fingerprint = a fresh one (checked on every SKU)',
       case when not exists (select 1 from core.skus where fp is distinct from encode(sha256(convert_to(firebase::text, 'UTF8')), 'hex') and firebase is not null) then 'PASS' else 'FAIL' end
union all select 3, 'Masters: one answer with every record (1,013 + copy day)',
       case when (select count(*) from jsonb_object_keys(core.masters_fp())) = 1014 then 'PASS'
            else 'FAIL: ' || (select count(*) from jsonb_object_keys(core.masters_fp())) end
union all select 4, 'SKUs: one answer with every record (18,676 + copy day)',
       case when (select count(*) from jsonb_object_keys(core.skus_fp())) = 18677 then 'PASS'
            else 'FAIL: ' || (select count(*) from jsonb_object_keys(core.skus_fp())) end
union all select 5, 'browsers get nothing without a real ERP sign-in',
       case when has_function_privilege('anon', 'core.skus_fp()', 'execute') and position('me_id' in pg_get_functiondef('core.skus_fp()'::regprocedure)) > 0 then 'PASS' else 'FAIL' end;
