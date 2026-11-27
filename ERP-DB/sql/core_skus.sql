-- =====================================================================================
-- CORE ROOM · SECTION 4 · SKUs  (normal SKUs, custom SKUs, and the 3 lists that hang on a SKU code)
-- NEEDS: core_access.sql + core_control.sql + core_masters.sql.  WHERE: ERP TEST.  HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: the last result is a list of checks — every row must say PASS.
-- DATA: loaded from Ravi's PC by migration/tools/load-skus.js (not pasted).
-- Ravi, 10 Nov: TWO tables (custom SKUs never go into the Master Database). Nothing removed, merged or moved: every Firebase
-- field is its own column, every row stays in its own table, clashing codes are only marked. Brand exactly as written.
-- Only change: "yes"/"no" typed as text becomes real yes/no (the typed text stays in the original record, column firebase).
-- Text, type, colour… keep the text as written, plus a link to the Masters entry where one matches.
-- =====================================================================================

-- ===================================================================== 1 · normal SKUs (pt_masterDB — the Master Database)
create table if not exists core.skus (
  id                        bigint generated always as identity primary key,
  sku                       text not null,
  brand                     text,
  is_custom                 boolean,
  article_type              text,
  subtype                   text,
  color                     text,
  size                      text,
  fabric                    text,
  pack_of                   text,                -- as written ("1", "2" …)
  cutting_required          boolean,
  consumption               numeric(12,4),
  is_ruffle                 boolean,
  ruffle_meters             numeric(12,4),
  ruffle_fabric             text,
  is_zip                    boolean,
  zip_qty                   numeric(12,4),
  is_piping                 boolean,
  piping_meters             numeric(12,4),
  piping_fabric             text,
  chain_length              numeric(12,4),
  filler_fabric_required    boolean,
  manufacturer              text,
  pack_material             text,
  pack_type                 text,
  asin                      text,
  parent_asin               text,
  listing_status            text,
  image_url                 text,
  custom_order              text,
  source                    text,
  added_from                text,
  added_at                  timestamptz,
  added_by                  text,
  updated_at_fb             timestamptz,         -- Firebase "updatedAt" (updated_at is the database's own stamp)
  updated_by_fb             text,                -- Firebase "updatedBy", as written ("email · PPC")
  inventory_valuation_price numeric(14,2),
  -- links to Masters, where the text matches an entry (the text above stays as written)
  article_type_id           bigint references core.article_types (id),
  subtype_id                bigint references core.article_subtypes (id),
  colour_id                 bigint references core.colours (id),
  size_id                   bigint references core.sizes (id),
  fabric_id                 bigint references core.fabrics (id),
  -- marked, not fixed: "twice in this table", "also a custom SKU"
  code_clash                text
);
comment on table core.skus is 'Normal SKUs = Firebase pt_masterDB, one row per Firebase entry, every field its own column; original record in firebase.';

-- ===================================================================== 2 · custom SKUs (pt_customSkus — their own table)
create table if not exists core.custom_skus (
  id                        bigint generated always as identity primary key,
  sku                       text not null,
  brand                     text,                -- often a customer / order name — as written
  is_custom                 boolean,
  article_type              text,
  subtype                   text,
  color                     text,
  size                      text,
  fabric                    text,
  pack_of                   text,
  cutting_required          boolean,
  consumption               numeric(12,4),
  is_ruffle                 boolean,
  ruffle_fabric             text,
  is_zip                    boolean,
  chain_length              numeric(12,4),
  filler_fabric_required    boolean,
  image_url                 text,
  shop_name                 text,
  label                     text,
  material                  text,
  customization             text,
  note                      text,
  lookalike_from            text,
  from_shopify              boolean,
  from_b2b                  boolean,
  b2b_order                 text,
  from_online               boolean,
  online_order              text,
  from_vendor_order         boolean,
  inventory_valuation_price numeric(14,2),
  fb_id                     text,                -- Firebase "id" (csk_…)
  added_at                  timestamptz,
  added_by                  text,
  created_at_fb             timestamptz,         -- Firebase "createdAt"
  created_by_fb             text,
  updated_at_fb             timestamptz,
  updated_by_fb             text,
  article_type_id           bigint references core.article_types (id),
  subtype_id                bigint references core.article_subtypes (id),
  colour_id                 bigint references core.colours (id),
  size_id                   bigint references core.sizes (id),
  fabric_id                 bigint references core.fabrics (id),
  code_clash                text
);
comment on table core.custom_skus is 'Custom SKUs = Firebase pt_customSkus, their own table (never in the Master Database); original record in firebase.';

-- ===================================================================== 3 · the 3 lists that hang on a SKU code (as Firebase has them)
create table if not exists core.sku_images (          -- pt_skuImages: code → picture link ("-" = none), incl. codes that are no SKU
  id         bigint generated always as identity primary key,
  sku        text not null,
  image_url  text
);
create table if not exists core.sku_priority (        -- pt_skuPriority: code → P1 / P2 / P3
  id         bigint generated always as identity primary key,
  sku        text not null,
  priority   text
);
create table if not exists core.fnsku_list (          -- pt_fnskuMap.list: one line each, "FNSKU <tab> SKU" (the list's at / by / src in settings)
  id         bigint generated always as identity primary key,
  line_no    int  not null,
  fnsku      text,
  sku        text
);

-- ===================================================================== 4 · legacy key, original record, who / when, read rules, log
do $$ declare t text; begin
  foreach t in array array['skus','custom_skus','sku_images','sku_priority','fnsku_list'] loop
    execute format('alter table core.%I add column if not exists legacy_key text', t);
    execute format('create unique index if not exists %I on core.%I (legacy_key) where legacy_key is not null', t || '_legacy', t);
    execute format('alter table core.%I add column if not exists firebase jsonb', t);
    execute format('alter table core.%I add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table core.%I add column if not exists created_by bigint references core.people (id)', t);
    execute format('alter table core.%I add column if not exists updated_at timestamptz', t);
    execute format('alter table core.%I add column if not exists updated_by bigint references core.people (id)', t);
    execute format('create index if not exists %I on core.%I (upper(sku))', t || '_sku', t);
    perform core.watch(('core.' || t)::regclass);
    execute format('revoke all on core.%I from anon, authenticated', t);
  end loop;
end $$;

-- ===================================================================== 5 · the rules (signed-in people; the loader is trusted)
-- Normal SKUs = the Master Database: admins or "Change the Master Database" (same rule as Masters).
drop trigger if exists masters_rules on core.skus;
create trigger masters_rules before insert or update or delete on core.skus for each row execute function core.masters_rules();
-- Custom SKUs and the 3 lists: many people add them in the ERP today, so any signed-in ERP person may add / change; only admins delete.
create or replace function core.sku_side_rules() returns trigger
language plpgsql as $$
begin
  if core.loading() or core.me_email() is null then return coalesce(new, old); end if;
  if core.me_id() is null then raise exception 'Only ERP people can change %.', tg_table_name; end if;
  if tg_op = 'DELETE' and not core.is_admin() then raise exception 'Only an admin can delete from %.', tg_table_name; end if;
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['custom_skus','sku_images','sku_priority','fnsku_list'] loop
    execute format('drop trigger if exists sku_side_rules on core.%I', t);
    execute format('create trigger sku_side_rules before insert or update or delete on core.%I for each row execute function core.sku_side_rules()', t);
  end loop;
end $$;

-- ===================================================================== 6 · one look at everything (nothing copied): each SKU with its picture-list entry, priority, FNSKU
create or replace view core.skus_with_extras as
  select 'normal'::text as kind, s.id, s.sku, s.brand, s.article_type, s.subtype, s.color, s.size, s.fabric, s.image_url, s.code_clash,
         i.image_url as list_image_url, p.priority, f.fnsku
    from core.skus s
    left join core.sku_images   i on upper(i.sku) = upper(s.sku)
    left join core.sku_priority p on upper(p.sku) = upper(s.sku)
    left join core.fnsku_list   f on upper(f.sku) = upper(s.sku)
  union all
  select 'custom', c.id, c.sku, c.brand, c.article_type, c.subtype, c.color, c.size, c.fabric, c.image_url, c.code_clash,
         i.image_url, p.priority, f.fnsku
    from core.custom_skus c
    left join core.sku_images   i on upper(i.sku) = upper(c.sku)
    left join core.sku_priority p on upper(p.sku) = upper(c.sku)
    left join core.fnsku_list   f on upper(f.sku) = upper(c.sku);
revoke all on core.skus_with_extras from anon, authenticated;
comment on view core.skus_with_extras is 'Read-only look: every SKU (normal + custom) beside its picture-list entry, priority and FNSKU. The 3 lists stay complete in their own tables.';

-- ===================================================================== 7 · the load door (server key only — the loader on Ravi's PC)
create or replace function core.load_sku_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare cols text; sets text; n int;
begin
  if p_table not in ('skus','custom_skus','sku_images','sku_priority','fnsku_list') then raise exception 'load_sku_rows: % is not a SKU table', p_table; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  perform set_config('core.loading', 'on', true);
  select string_agg(quote_ident(k), ', '), string_agg(format('%1$I = excluded.%1$I', k), ', ') filter (where k <> 'legacy_key')
    into cols, sets from jsonb_object_keys(p_rows -> 0) k;
  execute format('insert into core.%I (%s) select %s from jsonb_populate_recordset(null::core.%I, $1)
                  on conflict (legacy_key) where legacy_key is not null do update set %s', p_table, cols, cols, p_table, sets) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.load_sku_rows(text, jsonb) from public, anon, authenticated;
grant execute on function core.load_sku_rows(text, jsonb) to service_role;
-- (no delete door on purpose — Ravi: nothing is removed from this database)

-- ===================================================================== 8 · the shadow door (test ERP: live Firebase vs this copy, fingerprints only)
-- Every Firebase record of the section by its path: pt_masterDB/<key>, pt_customSkus/<key>, pt_skuImages/<code>, pt_skuPriority/<code>,
-- pt_fnskuMap/<at|by|list|n|src>. Read in pages of 1,000 (?order=path&offset=&limit=).
create or replace function core.skus_records() returns table (path text, h text)
language sql stable security definer set search_path = core, public as $$
  with r (path, rec) as (
              select legacy_key, firebase from core.skus         where legacy_key is not null and firebase is not null
    union all select legacy_key, firebase from core.custom_skus  where legacy_key is not null and firebase is not null
    union all select legacy_key, firebase from core.sku_images   where legacy_key is not null and firebase is not null
    union all select legacy_key, firebase from core.sku_priority where legacy_key is not null and firebase is not null
    union all select 'pt_fnskuMap/' || e.key, e.value from core.settings st cross join lateral jsonb_each(st.value) e
               where st.key = 'skus.fnsku_map' and jsonb_typeof(st.value) = 'object'
  )
  select r.path, encode(sha256(convert_to(r.rec::text, 'UTF8')), 'hex') from r
   where core.me_id() is not null or auth.role() = 'service_role'
  union all
  select '#copy_of', st.value #>> '{}' from core.settings st where st.key = 'sync.skus_backup' and (core.me_id() is not null or auth.role() = 'service_role')
$$;
revoke all on function core.skus_records() from public;
grant execute on function core.skus_records() to anon, authenticated, service_role;   -- anon = a Firebase sign-in; gives nothing without a real ERP person

-- ===================================================================== 9 · checks (live tests undo themselves)
create or replace function core.skus_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare r text; q bigint; s bigint; c1 bigint;
begin
  create temp table if not exists _k (n int, check_name text, result text);
  truncate _k;

  -- A. a QC checker cannot change a normal SKU; "Change the Master Database" can; nobody but an admin deletes; logged
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.qc@ridhi.test', 'T QC', (select id from core.roles where code = 'qc')) returning id into q;
    insert into core.people (email, name, role_id) values ('t.stock@ridhi.test', 'T Stock', (select id from core.roles where code = 'amzstock')) returning id into s;
    perform core.sign_in_as_test('t.qc@ridhi.test');
    begin insert into core.skus (sku) values ('TEST-SKU-QC'); r := 'FAIL: a QC checker added a normal SKU';
    exception when others then if sqlerrm like 'Only people who may change the Master Database%' then r := 'ok'; else r := 'FAIL: ' || sqlerrm; end if; end;
    if r = 'ok' then
      perform core.sign_in_as_test('t.stock@ridhi.test');
      insert into core.skus (sku, is_ruffle) values ('TEST-SKU-STOCK', true) returning id into c1;
      begin delete from core.skus where id = c1; r := 'FAIL: a non-admin deleted a SKU';
      exception when others then if sqlerrm like 'Entries are not deleted%' then r := 'ok'; else r := 'FAIL: ' || sqlerrm; end if; end;
    end if;
    if r = 'ok' then
      update core.skus set brand = 'Test' where id = c1;
      r := case when exists (select 1 from core.change_log where tbl = 'skus' and action = 'update' and at >= now() - interval '1 minute') then 'PASS' else 'FAIL: not logged' end;
    end if;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _k values (20, 'normal SKUs: only "Change the Master Database" people change them · nobody but an admin deletes · logged', r);

  -- B. custom SKUs: any ERP person may add one; only an admin deletes
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.qc@ridhi.test', 'T QC', (select id from core.roles where code = 'qc')) returning id into q;
    perform core.sign_in_as_test('t.qc@ridhi.test');
    insert into core.custom_skus (sku) values ('TEST-CUST-QC') returning id into c1;
    begin delete from core.custom_skus where id = c1; r := 'FAIL: a non-admin deleted a custom SKU';
    exception when others then if sqlerrm like 'Only an admin can delete%' then r := 'PASS'; else r := 'FAIL: ' || sqlerrm; end if; end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _k values (21, 'custom SKUs: any ERP person may add one · only an admin deletes', r);
  perform set_config('request.jwt.claims', '', true);

  return query
  select x.n, x.check_name, x.result from (
    select 1 as n, 'the 5 SKU tables exist, each keeps the Firebase record' as check_name,
           case when (select count(*) from information_schema.columns where table_schema = 'core' and column_name = 'firebase'
                       and table_name in ('skus','custom_skus','sku_images','sku_priority','fnsku_list')) = 5 then 'PASS' else 'FAIL' end as result
    union all select 2, 'two tables: normal SKUs and custom SKUs, every Firebase field its own column (36 + 37)',
           case when (select count(*) from information_schema.columns where table_schema = 'core' and table_name = 'skus' and column_name in
                      ('sku','brand','is_custom','article_type','subtype','color','size','fabric','pack_of','cutting_required','consumption','is_ruffle','ruffle_meters',
                       'ruffle_fabric','is_zip','zip_qty','is_piping','piping_meters','piping_fabric','chain_length','filler_fabric_required','manufacturer','pack_material',
                       'pack_type','asin','parent_asin','listing_status','image_url','custom_order','source','added_from','added_at','added_by','updated_at_fb','updated_by_fb',
                       'inventory_valuation_price')) = 36
                 and (select count(*) from information_schema.columns where table_schema = 'core' and table_name = 'custom_skus' and column_name in
                      ('sku','brand','is_custom','article_type','subtype','color','size','fabric','pack_of','cutting_required','consumption','is_ruffle','ruffle_fabric','is_zip',
                       'chain_length','filler_fabric_required','image_url','shop_name','label','material','customization','note','lookalike_from','from_shopify','from_b2b',
                       'b2b_order','from_online','online_order','from_vendor_order','inventory_valuation_price','fb_id','added_at','added_by','created_at_fb','created_by_fb',
                       'updated_at_fb','updated_by_fb')) = 37 then 'PASS' else 'FAIL' end
    union all select 3, 'yes/no fields are real yes/no',
           case when not exists (select 1 from information_schema.columns where table_schema = 'core' and table_name in ('skus','custom_skus')
                                  and column_name in ('is_custom','cutting_required','is_ruffle','is_zip','is_piping','filler_fabric_required','from_shopify','from_b2b','from_online','from_vendor_order')
                                  and data_type <> 'boolean') then 'PASS' else 'FAIL' end
    union all select 4, 'read rules on, stamped, logged, and the rules on all 5',
           case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace ns on ns.oid = c.relnamespace
                       where ns.nspname = 'core' and c.relname in ('skus','custom_skus','sku_images','sku_priority','fnsku_list') and t.tgname in ('masters_rules','sku_side_rules')) = 5
                 and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace ns on ns.oid = c.relnamespace
                       where ns.nspname = 'core' and c.relname in ('skus','custom_skus','sku_images','sku_priority','fnsku_list') and t.tgname = 'zz_log') = 5 then 'PASS' else 'FAIL' end
    union all select 5, 'browsers can read none of them (nor the combined look)',
           case when not exists (select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'core'
                                  and c.relname in ('skus','custom_skus','sku_images','sku_priority','fnsku_list','skus_with_extras')
                                  and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))) then 'PASS' else 'FAIL' end
    union all select 6, 'no test rows left behind',
           case when not exists (select 1 from core.skus where sku like 'TEST-SKU-%') and not exists (select 1 from core.custom_skus where sku like 'TEST-CUST-%')
                 and not exists (select 1 from core.people where email like '%@ridhi.test') then 'PASS' else 'FAIL' end
    union all select k.n, k.check_name, k.result from _k k
  ) x order by x.n;
end $fn$;
revoke all on function core.skus_checks() from public, anon, authenticated;
grant execute on function core.skus_checks() to service_role;

notify pgrst, 'reload schema';
select * from core.skus_checks();
