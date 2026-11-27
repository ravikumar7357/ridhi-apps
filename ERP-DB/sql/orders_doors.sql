-- =====================================================================================
-- SECTION 5 · ORDERS · two read-only doors (for the check page and the test ERP's shadow test)
-- NEEDS: orders.sql.  WHERE: ERP TEST (Mumbai).  HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: the last result lists the 23 tables with their rows and the link coverage.
-- =====================================================================================

-- which backup the Orders copy is from (shown on the test ERP line)
insert into core.settings (key, value, note) values ('sync.orders_backup', '"2026-11-12"', 'Which Firebase backup the Orders copy is from')
on conflict (key) do update set value = excluded.value, note = excluded.note;

-- 1 · every order's fingerprint in one answer { Firebase path: fingerprint }, for the 5 Firebase registers the test ERP reads
--     (sales orders, order book, vendor orders, Shopify floor, vendor challans). Each fingerprint covers the whole record, lines included.
--     Only fingerprints leave the database. An ERP person, the loader, or the SQL Editor only.
create or replace function core.orders_fp() returns jsonb
language sql stable security definer set search_path = core, public as $$
  select case when core.me_id() is not null or auth.role() = 'service_role' or session_user = 'postgres' then (
    select coalesce(jsonb_object_agg(x.legacy_key, x.fp), '{}'::jsonb)
           || jsonb_build_object('#copy_of', (select st.value #>> '{}' from core.settings st where st.key = 'sync.orders_backup'))
      from (select legacy_key, fp from sales.orders
            union all select legacy_key, fp from production.order_book
            union all select legacy_key, fp from production.vendor_orders
            union all select legacy_key, fp from production.shop_floor
            union all select legacy_key, fp from production.vendor_challans) x
     where x.legacy_key is not null and x.fp is not null) end
$$;
revoke all on function core.orders_fp() from public;
grant execute on function core.orders_fp() to anon, authenticated, service_role;   -- anon = a Firebase sign-in; nothing without a real ERP person

-- 2 · rows per table and how well each link connects, in one answer (check page)
create or replace function core.orders_summary() returns table (item text, n bigint, of_n bigint)
language sql stable security definer set search_path = core, public as $$
            select 'sales.channels', count(*), null::bigint from sales.channels
  union all select 'sales.orders', count(*), null from sales.orders
  union all select 'sales.order_lines', count(*), null from sales.order_lines
  union all select 'sales.order_qty_changes', count(*), null from sales.order_qty_changes
  union all select 'sales.order_removed_lines', count(*), null from sales.order_removed_lines
  union all select 'sales.shopify_orders', count(*), null from sales.shopify_orders
  union all select 'sales.amazon_pos', count(*), null from sales.amazon_pos
  union all select 'sales.amazon_po_lines', count(*), null from sales.amazon_po_lines
  union all select 'sales.amazon_po_followups', count(*), null from sales.amazon_po_followups
  union all select 'production.order_book', count(*), null from production.order_book
  union all select 'production.order_book_done_log', count(*), null from production.order_book_done_log
  union all select 'production.vendor_orders', count(*), null from production.vendor_orders
  union all select 'production.vendor_order_lines', count(*), null from production.vendor_order_lines
  union all select 'production.vendor_rfd_requests', count(*), null from production.vendor_rfd_requests
  union all select 'production.vendor_sent', count(*), null from production.vendor_sent
  union all select 'production.vendor_challans', count(*), null from production.vendor_challans
  union all select 'production.vendor_challan_lines', count(*), null from production.vendor_challan_lines
  union all select 'production.shop_floor', count(*), null from production.shop_floor
  union all select 'production.shop_hand_log', count(*), null from production.shop_hand_log
  union all select 'shipping.packing_lists', count(*), null from shipping.packing_lists
  union all select 'shipping.boxes', count(*), null from shipping.boxes
  union all select 'shipping.box_items', count(*), null from shipping.box_items
  union all select 'archive.old_production_orders', count(*), null from archive.old_production_orders
  -- links: rows that found what they point at / rows that should
  union all select 'link · sales orders → channel', count(*) filter (where channel_id is not null), count(*) from sales.orders
  union all select 'link · Shopify orders → sales order', count(*) filter (where sales_order_id is not null), count(*) from sales.shopify_orders
  union all select 'link · sales lines → SKU', count(*) filter (where sku_id is not null or custom_sku_id is not null), count(*) filter (where coalesce(trim(sku), '') <> '') from sales.order_lines
  union all select 'link · order book → SKU', count(*) filter (where sku_id is not null or custom_sku_id is not null), count(*) filter (where coalesce(trim(sku), '') <> '') from production.order_book
  union all select 'link · order book → sales order', count(*) filter (where sales_order_id is not null), count(*) filter (where src <> 'LEG') from production.order_book
  union all select 'link · vendor orders → vendor', count(*) filter (where vendor_id is not null), count(*) from production.vendor_orders
  union all select 'link · vendor orders → Control request', count(*) filter (where approval_id is not null), count(*) filter (where request_id is not null) from production.vendor_orders
  union all select 'link · vendor lines → SKU (rest: printed fabric, as Firebase)', count(*) filter (where sku_id is not null or custom_sku_id is not null), count(*) filter (where coalesce(trim(sku), '') <> '') from production.vendor_order_lines
  union all select 'link · box items → SKU', count(*) filter (where sku_id is not null or custom_sku_id is not null), count(*) filter (where coalesce(trim(sku), '') <> '') from shipping.box_items
$$;
revoke all on function core.orders_summary() from public, anon, authenticated;
grant execute on function core.orders_summary() to service_role;

notify pgrst, 'reload schema';
select * from core.orders_summary();
