-- =====================================================================================
-- Flowmerce · schema flowmerce · file 07 · OPTIONAL links to the Ridhi ERP
-- Run ONLY if schema flowmerce is installed in the same Supabase project as the ERP.
-- Read-only views: they never write to ERP tables, and ERP tables are not changed.
-- They are plain views (no materialised copies, no triggers, no jobs) so they add no load until queried.
--
-- ERP facts used (checked 24 Nov 2026):
--   core.skus (sku, brand 'Ridhi'/'CPC', asin, parent_asin)            ← variant.sku
--   sales.shopify_orders.shop_order_id = numeric Shopify order id       ← shop_order.external_id 'gid://shopify/Order/<id>'
--   sales.shopify_order_notes: mcf_id / mcf_status / mcf_speed / mcf_trk / carrier per Shopify order
--   planning.amazon_stock: Amazon fulfillable stock per sku
-- These views read ERP tables as their owner, so they are for the backend (service_role) only.
-- =====================================================================================

create or replace view flowmerce.erp_sku_link as
select v.workspace_id, v.store_id, v.id as variant_id, v.sku,
       k.id as erp_sku_id, k.article_type, k.subtype, k.color, k.size, k.fabric,
       k.asin, k.parent_asin, k.listing_status
from flowmerce.variant v
join flowmerce.store st on st.id = v.store_id
left join core.skus k on k.sku = v.sku and k.brand = st.erp_brand;

create or replace view flowmerce.erp_order_link as
select o.workspace_id, o.store_id, o.id as order_id, o.name as order_name,
       so.id as erp_shopify_order_id, so.order_no as erp_order_no, so.sales_order_id as erp_sales_order_id,
       so.rows_on_order_book, so.shop_says
from flowmerce.shop_order o
left join sales.shopify_orders so on so.shop_order_id = split_part(o.external_id, '/', 5);

create or replace view flowmerce.erp_mcf_notes as
select o.workspace_id, o.store_id, o.id as order_id, o.name as order_name,
       n.mcf_id, n.mcf_status, n.mcf_speed, n.mcf_trk, n.mcf_at, nullif(n.carrier, '') as carrier, n.pieces, n.wt
from flowmerce.shop_order o
join sales.shopify_order_notes n on n.shop_order_id = split_part(o.external_id, '/', 5);

create or replace view flowmerce.erp_amazon_stock as
select st.workspace_id, st.id as store_id, a.sku, a.asin, a.fulfillable, a.warehouse, a.status, a.updated_at
from planning.amazon_stock a
join flowmerce.store st on st.erp_brand_code = a.brand;

-- Sellora's daily numbers (already stored in the ERP) next to each Flowmerce store
create or replace view flowmerce.erp_sellora_sales_daily as
select st.workspace_id, st.id as store_id, s.channel, s.day, s.orders, s.units, s.sales, s.final, s.fetched_at
from sellora.sales_daily s
join flowmerce.store st on st.erp_brand_code = s.brand;

revoke all on flowmerce.erp_sellora_sales_daily from anon, authenticated;
grant select on flowmerce.erp_sellora_sales_daily to service_role;

revoke all on flowmerce.erp_sku_link, flowmerce.erp_order_link, flowmerce.erp_mcf_notes, flowmerce.erp_amazon_stock
  from anon, authenticated;
grant select on flowmerce.erp_sku_link, flowmerce.erp_order_link, flowmerce.erp_mcf_notes, flowmerce.erp_amazon_stock
  to service_role;
