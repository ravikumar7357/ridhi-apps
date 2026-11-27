-- =====================================================================================
-- SECTION 9 · LEFTOVERS — Amazon listings / alerts / fee history / Shopify imports (sales), the replenishment snapshots
-- (new schema planning), the old "in production" sheet (archive), settings docs (core.settings; API keys NEVER copied).
-- Ravi, 13 Nov: design page migration/leftovers-design.html, D1–D6 all OK.
-- NEEDS: core (access … skus, speed), orders.sql.  WHERE: ERP TEST (Mumbai).  HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: the last result is a list of checks — every row must say PASS.  Then: Data API → Exposed schemas → tick "planning".
-- DATA: loaded from Ravi's PC by migration/tools/load-leftovers.js.  Written by migration/tools/make-leftovers.js from the backup of 2026-11-12.
-- =====================================================================================

create schema if not exists planning;
revoke all on schema planning from public, anon, authenticated;
grant usage on schema planning to service_role;
alter default privileges in schema planning revoke all on tables from anon, authenticated;
alter default privileges in schema planning grant all on tables to service_role;
alter default privileges in schema planning grant all on sequences to service_role;
create schema if not exists archive;

create table if not exists sales.amazon_listings (
  id bigint generated always as identity primary key,
  "line_no" int,
  "sku" text,
  "status" text,
  "channel" text,
  "asin" text,
  "more" text,
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table sales.amazon_listings is 'From Firebase: pt_amzListings · list (one row per line)';

create table if not exists sales.listing_alerts (
  id bigint generated always as identity primary key,
  "by_email" text,  -- by
  "closed_at" timestamptz,  -- closedAt
  "closed_by" text,  -- closedBy
  "entries" numeric,  -- entries
  "first_at" timestamptz,  -- firstAt
  "last_at" timestamptz,  -- lastAt
  "last_by" text,  -- lastBy
  "last_qty" numeric,  -- lastQty
  "last_type" text,  -- lastType
  "listings_at" timestamptz,  -- listingsAt
  "sku" text,  -- sku
  "status" text,  -- status
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table sales.listing_alerts is 'From Firebase: pt_listingAlerts';

create table if not exists sales.amazon_fee_history (
  id bigint generated always as identity primary key,
  "doc_id" text,
  "asin" text,  -- asin
  "at_time" timestamptz,  -- at
  "fba" numeric,  -- fba
  "price" numeric,  -- price
  "referral" numeric,  -- referral
  "title" text,  -- title
  "sku_id" bigint references core.skus (id)
);
comment on table sales.amazon_fee_history is 'From Firebase: Firestore history';

create table if not exists sales.shopify_imports (
  id bigint generated always as identity primary key,
  "doc_id" text,
  "row_no" int,
  "at_time" date,  -- at
  "cancel_reason" text,  -- cancelReason
  "cancelled_at" text,  -- cancelledAt
  "channel" text,  -- channel
  "cur" text,  -- cur
  "email" text,  -- email
  "ff" text,  -- ff
  "fin" text,  -- fin
  "fb_id" text,  -- id
  "imported" numeric,  -- imported
  "doc_no" text,  -- no
  "note" text,  -- note
  "ship_a1" text,  -- ship.a1
  "ship_a2" text,  -- ship.a2
  "ship_city" text,  -- ship.city
  "ship_company" text,  -- ship.company
  "ship_country" text,  -- ship.country
  "ship_name" text,  -- ship.name
  "ship_phone" text,  -- ship.phone
  "ship_state" text,  -- ship.state
  "ship_zip" text,  -- ship.zip
  "shipped_at" text,  -- shippedAt
  "tags" text,  -- tags
  "total" numeric,  -- total
  "trk" jsonb,  -- trk
  "trk_co" text,  -- trkCo
  "trk_url" text,  -- trkUrl
  "sales_order_id" bigint references sales.orders (id)
);
comment on table sales.shopify_imports is 'From Firebase: Firestore shopimp · r';

create table if not exists sales.shopify_import_items (
  id bigint generated always as identity primary key,
  "shopify_import_id" bigint references sales.shopify_imports (id),
  "item_no" int,
  "grams" numeric,  -- grams
  "img" text,  -- img
  "name" text,  -- name
  "pid" text,  -- pid
  "price" numeric,  -- price
  "qty" numeric,  -- qty
  "sku" text,  -- sku
  "variant" text,  -- variant
  "vid" text,  -- vid
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table sales.shopify_import_items is 'From Firebase: Firestore shopimp · r · items';

create table if not exists planning.india_stock (
  id bigint generated always as identity primary key,
  "doc_id" text,
  "row_no" int,
  "pack" numeric,  -- pack
  "pieces" numeric,  -- pieces
  "qty" numeric,  -- qty
  "sku" text,  -- sku
  "status" text,  -- status
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table planning.india_stock is 'From Firebase: Firestore repl_india · r';

create table if not exists planning.amazon_stock (
  id bigint generated always as identity primary key,
  "brand" text,
  "doc_id" text,
  "row_no" int,
  "asin" text,  -- asin
  "color" text,  -- color
  "fulfillable" numeric,  -- fulfillable
  "image" text,  -- image
  "parent" text,  -- parent
  "size" text,  -- size
  "sku" text,  -- sku
  "status" text,  -- status
  "subcat" text,  -- subcat
  "warehouse" numeric,  -- warehouse
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table planning.amazon_stock is 'From Firebase: Firestore replshoprows · r';

create table if not exists planning.amazon_fulfillable (
  id bigint generated always as identity primary key,
  "brand" text,
  "sku" text,
  "qty" numeric,
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table planning.amazon_fulfillable is 'From Firebase: Firestore replshop · ful (one row per SKU)';

create table if not exists planning.stock_snapshot (
  id bigint generated always as identity primary key,
  "brand" text,
  "sku" text,
  "qty" numeric,
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table planning.stock_snapshot is 'From Firebase: Firestore stock · m (one row per SKU)';

create table if not exists archive.repl_in_production (
  id bigint generated always as identity primary key,
  "doc_id" text,
  "row_no" int,
  "qty" numeric,  -- qty
  "ready" date,  -- ready
  "sku" text,  -- sku
  "start" date,  -- start
  "supplier" text,  -- supplier
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table archive.repl_in_production is 'From Firebase: Firestore repl_inprod · r (no screen reads it)';

do $$ declare t text; begin
  foreach t in array array['sales.amazon_listings','sales.listing_alerts','sales.amazon_fee_history','sales.shopify_imports','sales.shopify_import_items','planning.india_stock','planning.amazon_stock','planning.amazon_fulfillable','planning.stock_snapshot','archive.repl_in_production'] loop
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
grant usage, select on all sequences in schema planning to service_role;
create index if not exists amazon_listings_sku on sales.amazon_listings (sku_id);
create index if not exists amazon_listings_custom_sku on sales.amazon_listings (custom_sku_id);
create index if not exists listing_alerts_sku on sales.listing_alerts (sku_id);
create index if not exists listing_alerts_custom_sku on sales.listing_alerts (custom_sku_id);
create index if not exists amazon_fee_history_sku on sales.amazon_fee_history (sku_id);
create index if not exists shopify_imports_sales_order on sales.shopify_imports (sales_order_id);
create index if not exists shopify_import_items_parent on sales.shopify_import_items (shopify_import_id);
create index if not exists shopify_import_items_sku on sales.shopify_import_items (sku_id);
create index if not exists shopify_import_items_custom_sku on sales.shopify_import_items (custom_sku_id);
create index if not exists india_stock_sku on planning.india_stock (sku_id);
create index if not exists india_stock_custom_sku on planning.india_stock (custom_sku_id);
create index if not exists amazon_stock_sku on planning.amazon_stock (sku_id);
create index if not exists amazon_stock_custom_sku on planning.amazon_stock (custom_sku_id);
create index if not exists amazon_fulfillable_sku on planning.amazon_fulfillable (sku_id);
create index if not exists amazon_fulfillable_custom_sku on planning.amazon_fulfillable (custom_sku_id);
create index if not exists stock_snapshot_sku on planning.stock_snapshot (sku_id);
create index if not exists stock_snapshot_custom_sku on planning.stock_snapshot (custom_sku_id);
create index if not exists repl_in_production_sku on archive.repl_in_production (sku_id);
create index if not exists repl_in_production_custom_sku on archive.repl_in_production (custom_sku_id);

-- ===================================================================== doors (server key; the fingerprint door also for the test ERP)
create or replace function core.leftovers_tables() returns text[] language sql immutable as $$ select array['sales.amazon_listings','sales.listing_alerts','sales.amazon_fee_history','sales.shopify_imports','sales.shopify_import_items','planning.india_stock','planning.amazon_stock','planning.amazon_fulfillable','planning.stock_snapshot','archive.repl_in_production'] $$;
create or replace function core.load_leftover_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare cols text; sets text; n int;
begin
  if not (p_table = any (core.leftovers_tables())) then raise exception 'load_leftover_rows: % is not a Leftovers table', p_table; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  perform set_config('core.loading', 'on', true);
  select string_agg(quote_ident(k), ', '), string_agg(format('%1$I = excluded.%1$I', k), ', ') filter (where k <> 'legacy_key')
    into cols, sets from jsonb_object_keys(p_rows -> 0) k;
  execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)
                  on conflict (legacy_key) where legacy_key is not null do update set %s', p_table, cols, cols, p_table, sets) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.load_leftover_rows(text, jsonb) from public, anon, authenticated;
grant execute on function core.load_leftover_rows(text, jsonb) to service_role;

insert into core.settings (key, value, note) values ('sync.leftovers_backup', '"2026-11-12"', 'Which Firebase backup the Leftovers copy is from')
on conflict (key) do update set value = excluded.value;

create or replace function core.leftovers_fp() returns jsonb
language sql stable security definer set search_path = core, public as $$
  select case when core.me_id() is not null or auth.role() = 'service_role' or session_user = 'postgres' then (
    select coalesce(jsonb_object_agg(x.legacy_key, x.fp), '{}'::jsonb)
           || jsonb_build_object('#copy_of', (select st.value #>> '{}' from core.settings st where st.key = 'sync.leftovers_backup'))
      from (select legacy_key, fp from sales.amazon_listings
            union all select legacy_key, fp from sales.listing_alerts
            union all select legacy_key, fp from sales.amazon_fee_history
            union all select legacy_key, fp from sales.shopify_imports
            union all select legacy_key, fp from planning.india_stock
            union all select legacy_key, fp from planning.amazon_stock
            union all select legacy_key, fp from planning.amazon_fulfillable
            union all select legacy_key, fp from planning.stock_snapshot
            union all select legacy_key, fp from archive.repl_in_production) x
     where x.legacy_key is not null and x.fp is not null) end
$$;
revoke all on function core.leftovers_fp() from public;
grant execute on function core.leftovers_fp() to anon, authenticated, service_role;

create or replace function core.leftovers_summary() returns table (item text, n bigint, of_n bigint)
language sql stable security definer set search_path = core, public as $$
  select 'sales.amazon_listings', count(*), null::bigint from sales.amazon_listings
  union all select 'sales.listing_alerts', count(*), null::bigint from sales.listing_alerts
  union all select 'sales.amazon_fee_history', count(*), null::bigint from sales.amazon_fee_history
  union all select 'sales.shopify_imports', count(*), null::bigint from sales.shopify_imports
  union all select 'sales.shopify_import_items', count(*), null::bigint from sales.shopify_import_items
  union all select 'planning.india_stock', count(*), null::bigint from planning.india_stock
  union all select 'planning.amazon_stock', count(*), null::bigint from planning.amazon_stock
  union all select 'planning.amazon_fulfillable', count(*), null::bigint from planning.amazon_fulfillable
  union all select 'planning.stock_snapshot', count(*), null::bigint from planning.stock_snapshot
  union all select 'archive.repl_in_production', count(*), null::bigint from archive.repl_in_production
  union all select 'link · amazon_listings → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from sales.amazon_listings
  union all select 'link · listing_alerts → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from sales.listing_alerts
  union all select 'link · amazon_fee_history → SKU', count(*) filter (where sku_id is not null), count(*) from sales.amazon_fee_history
  union all select 'link · shopify_import_items → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from sales.shopify_import_items
  union all select 'link · india_stock → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from planning.india_stock
  union all select 'link · amazon_stock → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from planning.amazon_stock
  union all select 'link · amazon_fulfillable → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from planning.amazon_fulfillable
  union all select 'link · stock_snapshot → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from planning.stock_snapshot
  union all select 'link · repl_in_production → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from archive.repl_in_production
  union all select 'link · shopify_imports → sales order', count(*) filter (where sales_order_id is not null), count(*) from sales.shopify_imports
  union all select 'settings with an API key in them (must be 0)', count(*), null from core.settings where key like 'config.%' and (value ? 'key' or value::text ~* '"(api)?key"\s*:')
$$;
revoke all on function core.leftovers_summary() from public, anon, authenticated;
grant execute on function core.leftovers_summary() to service_role;

create or replace function core.leftovers_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare r text; q bigint; c1 bigint; fp_ok boolean;
begin
  fp_ok := jsonb_typeof(core.leftovers_fp()) = 'object';
  create temp table if not exists _l (n int, check_name text, result text);
  truncate _l;
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.leftcheck@ridhi.test', 'T Left Check', (select id from core.roles where code = 'qc')) returning id into q;
    perform core.sign_in_as_test('t.leftcheck@ridhi.test');
    insert into planning.india_stock (doc_id, row_no) values ('test', 0) returning id into c1;
    begin delete from planning.india_stock where id = c1; r := 'FAIL: a non-admin deleted a row';
    exception when others then if sqlerrm like 'Only an admin can delete%' then r := 'PASS'; else r := 'FAIL: ' || sqlerrm; end if; end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _l values (20, 'any ERP person may add a row · only an admin deletes', r);
  perform set_config('request.jwt.claims', '', true);
  return query select x.n, x.check_name, x.result from (
    select 1 as n, 'all 10 Leftovers tables exist, each keeps the Firebase record and fingerprint' as check_name,
           case when (select count(*) from information_schema.columns where column_name = 'fp' and table_schema || '.' || table_name = any (core.leftovers_tables())) = 10 then 'PASS' else 'FAIL' end as result
    union all select 2, 'rules, stamps and the change log on all 10',
           case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
                       where t.tgname in ('zz_log', 'sku_side_rules', 'aa_fp') and s.nspname || '.' || c.relname = any (core.leftovers_tables())) = 30 then 'PASS' else 'FAIL' end
    union all select 3, 'browsers can read none of them, nor use the planning schema',
           case when not exists (select 1 from unnest(core.leftovers_tables()) t where has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select'))
                 and not has_schema_privilege('anon', 'planning', 'usage') and not has_schema_privilege('authenticated', 'planning', 'usage') then 'PASS' else 'FAIL' end
    union all select 4, 'browsers cannot use the load door; the fingerprint door gives fingerprints only',
           case when not has_function_privilege('anon', 'core.load_leftover_rows(text,jsonb)', 'execute') and fp_ok then 'PASS' else 'FAIL' end
    union all select 5, 'no test rows left behind', case when not exists (select 1 from core.people where email like '%@ridhi.test') then 'PASS' else 'FAIL' end
    union all select l.n, l.check_name, l.result from _l l
  ) x order by x.n;
end $fn$;
revoke all on function core.leftovers_checks() from public, anon, authenticated;
grant execute on function core.leftovers_checks() to service_role;

notify pgrst, 'reload schema';
select * from core.leftovers_checks();
