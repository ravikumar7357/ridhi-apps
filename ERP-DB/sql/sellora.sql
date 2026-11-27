-- =====================================================================================
-- SECTION 11 · SELLORA / AMAZON — data typed by people → 6 tables in sales; the caches → one archive copy (one row per doc);
-- small config docs and the "done" marks inside two caches → core.settings. Ravi, 13 Nov: sellora-design.html, D1–D4 all OK.
-- NEEDS: core (access … skus), orders.sql.  WHERE: ERP TEST (Mumbai).  HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: the last result is a list of checks — every row must say PASS.  (sales and archive are already exposed.)
-- DATA: loaded from Ravi's PC by migration/tools/load-sellora.js.  Written by migration/tools/make-sellora.js from the backup of 2026-11-12.
-- =====================================================================================

create schema if not exists archive;

create table if not exists sales.shopify_order_notes (
  id bigint generated always as identity primary key,
  "shop_order_id" text,
  "at_time" timestamptz,  -- at
  "box_h" text,  -- boxH
  "box_l" text,  -- boxL
  "box_w" text,  -- boxW
  "by_email" text,  -- by
  "carrier" text,  -- carrier
  "cur" text,  -- cur
  "description" text,  -- desc
  "gst_inv" text,  -- gstInv
  "gst_inv_date" text,  -- gstInvDate
  "lines" jsonb,  -- lines
  "mcf_at" timestamptz,  -- mcfAt
  "mcf_brand" text,  -- mcfBrand
  "mcf_id" text,  -- mcfId
  "mcf_skus" jsonb,  -- mcfSkus
  "mcf_speed" text,  -- mcfSpeed
  "mcf_status" text,  -- mcfStatus
  "mcf_trk" text,  -- mcfTrk
  "mk" jsonb,  -- mk
  "ngst_inv" text,  -- ngstInv
  "ngst_inv_date" text,  -- ngstInvDate
  "note" text,  -- note
  "pieces" numeric,  -- pieces
  "s" text,  -- s
  "shop_fulfilled" numeric,  -- shopFulfilled
  "val" numeric,  -- val
  "wt" numeric,  -- wt
  "shopify_order_id" bigint references sales.shopify_orders (id)
);
comment on table sales.shopify_order_notes is 'From Firebase: Firestore audit/shoporders · m (one row per Shopify order)';

create table if not exists sales.amazon_bsr (
  id bigint generated always as identity primary key,
  "brand" text,
  "week" text,
  "asin" text,
  "cat" text,  -- cat
  "n" numeric,  -- n
  "rank" numeric,  -- rank
  "sub" numeric,  -- sub
  "sub_cat" text,  -- subCat
  "sku_id" bigint references core.skus (id)
);
comment on table sales.amazon_bsr is 'From Firebase: Firestore bsrweeks · r (one row per ASIN per week)';

create table if not exists sales.amazon_deals (
  id bigint generated always as identity primary key,
  "item_kind" text,
  "item_key" text,
  "asin" text,
  "by_email" text,  -- by
  "d" numeric,  -- d
  "end" date,  -- end
  "image" text,  -- image
  "s" date,  -- s
  "start" date,  -- start
  "t" text,  -- t
  "v" numeric,  -- v
  "sku_id" bigint references core.skus (id)
);
comment on table sales.amazon_deals is 'From Firebase: Firestore audit/deals · plan / events / imgs';

create table if not exists sales.amazon_parent_names (
  id bigint generated always as identity primary key,
  "brand" text,
  "parent_asin" text,
  "at_time" date,  -- at
  "by_email" text,  -- by
  "v" text  -- v
);
comment on table sales.amazon_parent_names is 'From Firebase: Firestore parentnames · n';

create table if not exists sales.sku_amazon_meta (
  id bigint generated always as identity primary key,
  "sku" text,
  "amz" text,  -- amz
  "gst" numeric,  -- gst
  "hs" text,  -- hs
  "loc" text,  -- loc
  "pack" numeric,  -- pack
  "rate" numeric,  -- rate
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table sales.sku_amazon_meta is 'From Firebase: Firestore audit/skumeta · m';

create table if not exists sales.b2b_images (
  id bigint generated always as identity primary key,
  "doc_id" text,
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "image_data" text,  -- d
  "order_ref" text,  -- order
  "sku" text,  -- sku
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table sales.b2b_images is 'From Firebase: Firestore b2bimg';

create table if not exists archive.sellora_cache_docs (
  id bigint generated always as identity primary key,
  "collection" text,
  "doc_id" text,
  "updated_in_firestore" timestamptz,
  "bytes" int,
  "rows_inside" int
);
comment on table archive.sellora_cache_docs is 'From Firebase: Firestore caches (weeklyrows, sarows, imgrows, age, salesanalysis, imgsnap, listingrules catalogs, audit ppc30 / sales30 / trends / weekly / skuloc) — one row per doc, whole';

do $$ declare t text; begin
  foreach t in array array['sales.shopify_order_notes','sales.amazon_bsr','sales.amazon_deals','sales.amazon_parent_names','sales.sku_amazon_meta','sales.b2b_images','archive.sellora_cache_docs'] loop
    execute format('alter table %s add column if not exists legacy_key text', t);
    execute format('create unique index if not exists %I on %s (legacy_key) where legacy_key is not null', replace(t, '.', '_') || '_legacy', t);
    execute format('alter table %s add column if not exists firebase jsonb', t);
    execute format('alter table %s add column if not exists fp text', t);
    execute format('alter table %s add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table %s add column if not exists created_by bigint references core.people (id)', t);
    execute format('alter table %s add column if not exists updated_at timestamptz', t);
    execute format('alter table %s add column if not exists updated_by bigint references core.people (id)', t);
    execute format('drop trigger if exists aa_fp on %s', t);
    execute format('create trigger aa_fp before insert or update on %s for each row execute function core.set_fp()', t);
    execute format('drop trigger if exists sku_side_rules on %s', t);
    execute format('create trigger sku_side_rules before insert or update or delete on %s for each row execute function core.sku_side_rules()', t);
    perform core.watch(t::regclass);
    execute format('revoke all on %s from anon, authenticated', t);
    execute format('grant all on %s to service_role', t);
  end loop;
end $$;
create index if not exists shopify_order_notes_shopify_order on sales.shopify_order_notes (shopify_order_id);
create index if not exists amazon_bsr_sku on sales.amazon_bsr (sku_id);
create index if not exists amazon_deals_sku on sales.amazon_deals (sku_id);
create index if not exists sku_amazon_meta_sku on sales.sku_amazon_meta (sku_id);
create index if not exists sku_amazon_meta_custom_sku on sales.sku_amazon_meta (custom_sku_id);
create index if not exists b2b_images_sku on sales.b2b_images (sku_id);
create index if not exists b2b_images_custom_sku on sales.b2b_images (custom_sku_id);

-- ===================================================================== doors (server key; the fingerprint door also for the test ERP)
create or replace function core.sellora_tables() returns text[] language sql immutable as $$ select array['sales.shopify_order_notes','sales.amazon_bsr','sales.amazon_deals','sales.amazon_parent_names','sales.sku_amazon_meta','sales.b2b_images','archive.sellora_cache_docs'] $$;
create or replace function core.load_sellora_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare cols text; sets text; n int;
begin
  if not (p_table = any (core.sellora_tables())) then raise exception 'load_sellora_rows: % is not a Sellora table', p_table; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  perform set_config('core.loading', 'on', true);
  select string_agg(quote_ident(k), ', '), string_agg(format('%1$I = excluded.%1$I', k), ', ') filter (where k <> 'legacy_key')
    into cols, sets from jsonb_object_keys(p_rows -> 0) k;
  execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)
                  on conflict (legacy_key) where legacy_key is not null do update set %s', p_table, cols, cols, p_table, sets) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.load_sellora_rows(text, jsonb) from public, anon, authenticated;
grant execute on function core.load_sellora_rows(text, jsonb) to service_role;

insert into core.settings (key, value, note) values ('sync.sellora_backup', '"2026-11-12"', 'Which Firebase backup the Sellora copy is from')
on conflict (key) do update set value = excluded.value;

create or replace function core.sellora_fp() returns jsonb
language sql stable security definer set search_path = core, public as $$
  select case when core.me_id() is not null or auth.role() = 'service_role' or session_user = 'postgres' then (
    select coalesce(jsonb_object_agg(x.legacy_key, x.fp), '{}'::jsonb)
           || jsonb_build_object('#copy_of', (select st.value #>> '{}' from core.settings st where st.key = 'sync.sellora_backup'))
      from (select legacy_key, fp from sales.shopify_order_notes
            union all select legacy_key, fp from sales.amazon_bsr
            union all select legacy_key, fp from sales.amazon_deals
            union all select legacy_key, fp from sales.amazon_parent_names
            union all select legacy_key, fp from sales.sku_amazon_meta
            union all select legacy_key, fp from sales.b2b_images
            union all select legacy_key, fp from archive.sellora_cache_docs) x
     where x.legacy_key is not null and x.fp is not null) end
$$;
revoke all on function core.sellora_fp() from public;
grant execute on function core.sellora_fp() to anon, authenticated, service_role;

create or replace function core.sellora_summary() returns table (item text, n bigint, of_n bigint)
language sql stable security definer set search_path = core, public as $$
  select 'sales.shopify_order_notes', count(*), null::bigint from sales.shopify_order_notes
  union all select 'sales.amazon_bsr', count(*), null::bigint from sales.amazon_bsr
  union all select 'sales.amazon_deals', count(*), null::bigint from sales.amazon_deals
  union all select 'sales.amazon_parent_names', count(*), null::bigint from sales.amazon_parent_names
  union all select 'sales.sku_amazon_meta', count(*), null::bigint from sales.sku_amazon_meta
  union all select 'sales.b2b_images', count(*), null::bigint from sales.b2b_images
  union all select 'archive.sellora_cache_docs', count(*), null::bigint from archive.sellora_cache_docs
  union all select 'link · shopify_order_notes → Shopify order', count(*) filter (where shopify_order_id is not null), count(*) from sales.shopify_order_notes
  union all select 'link · amazon_bsr → SKU (by ASIN)', count(*) filter (where sku_id is not null), count(*) from sales.amazon_bsr
  union all select 'link · amazon_deals → SKU (by ASIN)', count(*) filter (where sku_id is not null), count(*) from sales.amazon_deals
  union all select 'link · sku_amazon_meta → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from sales.sku_amazon_meta
  union all select 'link · b2b_images → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from sales.b2b_images
  union all select 'cache docs kept whole (MB)', round(sum(bytes) / 1e6)::bigint, null from archive.sellora_cache_docs
$$;
revoke all on function core.sellora_summary() from public, anon, authenticated;
grant execute on function core.sellora_summary() to service_role;

create or replace function core.sellora_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare r text; q bigint; c1 bigint; fp_ok boolean;
begin
  fp_ok := jsonb_typeof(core.sellora_fp()) = 'object';
  create temp table if not exists _sl (n int, check_name text, result text);
  truncate _sl;
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.sellcheck@ridhi.test', 'T Sell Check', (select id from core.roles where code = 'qc')) returning id into q;
    perform core.sign_in_as_test('t.sellcheck@ridhi.test');
    insert into sales.amazon_parent_names (brand, parent_asin) values ('TEST', 'TEST') returning id into c1;
    begin delete from sales.amazon_parent_names where id = c1; r := 'FAIL: a non-admin deleted a row';
    exception when others then if sqlerrm like 'Only an admin can delete%' then r := 'PASS'; else r := 'FAIL: ' || sqlerrm; end if; end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _sl values (20, 'any ERP person may add a row · only an admin deletes', r);
  perform set_config('request.jwt.claims', '', true);
  return query select x.n, x.check_name, x.result from (
    select 1 as n, 'all 7 Sellora tables exist, each keeps the Firebase record and fingerprint' as check_name,
           case when (select count(*) from information_schema.columns where column_name = 'fp' and table_schema || '.' || table_name = any (core.sellora_tables())) = 7 then 'PASS' else 'FAIL' end as result
    union all select 2, 'rules, stamps and the change log on all 7',
           case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
                       where t.tgname in ('zz_log', 'sku_side_rules', 'aa_fp') and s.nspname || '.' || c.relname = any (core.sellora_tables())) = 21 then 'PASS' else 'FAIL' end
    union all select 3, 'browsers can read none of them',
           case when not exists (select 1 from unnest(core.sellora_tables()) t where has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select')) then 'PASS' else 'FAIL' end
    union all select 4, 'browsers cannot use the load door; the fingerprint door gives fingerprints only',
           case when not has_function_privilege('anon', 'core.load_sellora_rows(text,jsonb)', 'execute') and fp_ok then 'PASS' else 'FAIL' end
    union all select 5, 'no test rows left behind', case when not exists (select 1 from core.people where email like '%@ridhi.test') then 'PASS' else 'FAIL' end
    union all select s.n, s.check_name, s.result from _sl s
  ) x order by x.n;
end $fn$;
revoke all on function core.sellora_checks() from public, anon, authenticated;
grant execute on function core.sellora_checks() to service_role;

notify pgrst, 'reload schema';
select * from core.sellora_checks();
