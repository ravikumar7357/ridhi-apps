-- =====================================================================================
-- SECTION 5 · ORDERS  (one order system for every channel) — in their own schemas: sales · production · shipping · archive
-- core stays the shared foundation (people, access, approvals, masters, SKUs); these tables link to it.
-- NEEDS: core_access.sql, core_control.sql, core_masters.sql, core_skus.sql, core_speed.sql.  WHERE: ERP TEST (Mumbai).
-- HOW: paste the WHOLE file → Run. Safe to run again. CHECK: the last result is a list of checks — every row must say PASS.
-- DATA: loaded from Ravi's PC by migration/tools/load-orders.js.  Written by migration/tools/make-orders.js from the backup of 2026-11-12.
-- Every Firebase field has its own column (its Firebase name is beside it); every row keeps its Firebase record (firebase) and
-- fingerprint (fp). Lines point at their order; SKUs, vendors, channels and Control requests are linked, never copied.
-- =====================================================================================

-- ===================================================================== the 4 schemas (rooms): locked to browsers, open to the server key
create schema if not exists sales;
revoke all on schema sales from public, anon, authenticated;
grant usage on schema sales to service_role;
alter default privileges in schema sales revoke all on tables from anon, authenticated;
alter default privileges in schema sales grant all on tables to service_role;
alter default privileges in schema sales grant all on sequences to service_role;
create schema if not exists production;
revoke all on schema production from public, anon, authenticated;
grant usage on schema production to service_role;
alter default privileges in schema production revoke all on tables from anon, authenticated;
alter default privileges in schema production grant all on tables to service_role;
alter default privileges in schema production grant all on sequences to service_role;
create schema if not exists shipping;
revoke all on schema shipping from public, anon, authenticated;
grant usage on schema shipping to service_role;
alter default privileges in schema shipping revoke all on tables from anon, authenticated;
alter default privileges in schema shipping grant all on tables to service_role;
alter default privileges in schema shipping grant all on sequences to service_role;
create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;
grant usage on schema archive to service_role;
alter default privileges in schema archive revoke all on tables from anon, authenticated;
alter default privileges in schema archive grant all on tables to service_role;
alter default privileges in schema archive grant all on sequences to service_role;

create table if not exists sales.channels (
  id bigint generated always as identity primary key,
  "code" text not null,
  "name" text not null,
  "kind" text,
  "brand" text,
  "aliases" text[]
);
comment on table sales.channels is 'From Firebase: fixed';

create table if not exists sales.orders (
  id bigint generated always as identity primary key,
  "order_no" text,  -- _id
  "fb_key" text,  -- _key
  "approved_at" timestamptz,  -- approvedAt
  "approved_by" text,  -- approvedBy
  "auto_from" text,  -- autoFrom
  "buyer_email" text,  -- buyerEmail
  "buyer_name" text,  -- buyerName
  "channel" text,  -- channel
  "created_at_fb" timestamptz,  -- createdAt
  "created_by_fb" text,  -- createdBy
  "delivery_date" date,  -- deliveryDate
  "delivery_mode" text,  -- deliveryMode
  "legacy_order_id" text,  -- legacyOrderId
  "order_date" date,  -- orderDate
  "order_type_key" text,  -- orderTypeKey
  "renumbered_from" text,  -- renumberedFrom
  "reviewed_at" timestamptz,  -- reviewedAt
  "reviewed_by" text,  -- reviewedBy
  "sa_remarks" text,  -- saRemarks
  "sale_month" text,  -- saleMonth
  "ship_mode" text,  -- shipMode
  "shop_order_id" text,  -- shopOrderId
  "src" text,  -- src
  "status" text,  -- status
  "submitted_at" timestamptz,  -- submittedAt
  "updated_at_fb" timestamptz,  -- updatedAt
  "channel_id" bigint references sales.channels (id)
);
comment on table sales.orders is 'From Firebase: pt_salesOrders';

create table if not exists sales.order_lines (
  id bigint generated always as identity primary key,
  "order_id" bigint references sales.orders (id),
  "line_no" int,
  "adj_id" text,  -- adjId
  "brand" text,  -- brand
  "color" text,  -- color
  "customization" text,  -- customization
  "delivery_date" date,  -- deliveryDate
  "extra" jsonb,  -- extra
  "img" text,  -- img
  "item_name" text,  -- itemName
  "label" text,  -- label
  "material" text,  -- material
  "order_type_key" text,  -- orderTypeKey
  "previous_qty" numeric,  -- previousQty
  "priority" text,  -- priority
  "qty" numeric,  -- qty
  "qty_adjusted_at" timestamptz,  -- qtyAdjustedAt
  "qty_adjusted_by" text,  -- qtyAdjustedBy
  "size" text,  -- size
  "sku" text,  -- sku
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table sales.order_lines is 'From Firebase: pt_salesOrders · lines';

create table if not exists sales.order_qty_changes (
  id bigint generated always as identity primary key,
  "order_id" bigint references sales.orders (id),
  "applied_from" numeric,  -- appliedFrom
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "count" numeric,  -- count
  "decided_at" timestamptz,  -- decidedAt
  "decided_by" text,  -- decidedBy
  "from_qty" numeric,  -- from
  "fb_id" text,  -- id
  "lines" jsonb,  -- lines
  "net_delta" numeric,  -- netDelta
  "sku" text,  -- sku
  "skus" jsonb,  -- skus
  "stage" text,  -- stage
  "to_qty" numeric,  -- to
  "via" text,  -- via
  "why" text,  -- why
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table sales.order_qty_changes is 'From Firebase: pt_salesOrders · qtyAdjustments';

create table if not exists sales.order_removed_lines (
  id bigint generated always as identity primary key,
  "order_id" bigint references sales.orders (id),
  "source" text,
  "asked_by" text,  -- askedBy
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "count" numeric,  -- count
  "lines" jsonb,  -- lines
  "qty" numeric,  -- qty
  "req_id" text,  -- reqId
  "sku" text,  -- sku
  "skus" jsonb,  -- skus
  "why" text,  -- why
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "approval_id" bigint references core.approvals (id)
);
comment on table sales.order_removed_lines is 'From Firebase: pt_salesOrders · removedLines / lineRemovals';

create table if not exists sales.shopify_orders (
  id bigint generated always as identity primary key,
  "shop_order_id" text not null,
  "shop_order_no" text,
  "order_no" text,
  "rows_on_order_book" int,
  "shop_says" text,
  "shop_says_at" timestamptz,
  "shop_done_why" text,
  "sales_order_id" bigint references sales.orders (id),
  "channel_id" bigint references sales.channels (id)
);
comment on table sales.shopify_orders is 'From Firebase: built from the order book';

create table if not exists production.order_book (
  id bigint generated always as identity primary key,
  "adj_id" text,  -- adjId
  "article_subtype" text,  -- articleSubtype
  "article_type" text,  -- articleType
  "brand" text,  -- brand
  "color" text,  -- color
  "customization" text,  -- customization
  "forced" boolean,  -- forced
  "forced_why" text,  -- forcedWhy
  "fb_id" text,  -- id
  "item_name" text,  -- itemName
  "label" text,  -- label
  "material" text,  -- material
  "needs_sku" boolean,  -- needsSku
  "opened_at" timestamptz,  -- openedAt
  "opened_by" text,  -- openedBy
  "opened_from" text,  -- openedFrom
  "opened_past_note" text,  -- openedPastNote
  "order_date" date,  -- orderDate
  "order_no" text,  -- orderNo
  "pcs" numeric,  -- pcs
  "ppc_back" jsonb,  -- ppcBack
  "qty" numeric,  -- qty
  "remarks" text,  -- remarks
  "reopened_at" timestamptz,  -- reopenedAt
  "reopened_by" text,  -- reopenedBy
  "reopened_why" text,  -- reopenedWhy
  "sale_month" text,  -- saleMonth
  "shop_done_at" timestamptz,  -- shopDoneAt
  "shop_done_by" text,  -- shopDoneBy
  "shop_done_handed" numeric,  -- shopDoneHanded
  "shop_done_note" text,  -- shopDoneNote
  "shop_done_why" text,  -- shopDoneWhy
  "shop_img" text,  -- shopImg
  "shop_order_id" text,  -- shopOrderId
  "shop_order_no" text,  -- shopOrderNo
  "shop_qty" numeric,  -- shopQty
  "shop_says" text,  -- shopSays
  "shop_says_at" timestamptz,  -- shopSaysAt
  "size" text,  -- size
  "sku" text,  -- sku
  "src" text,  -- src
  "title_match" boolean,  -- titleMatch
  "uploaded_at" timestamptz,  -- uploadedAt
  "uploaded_by" text,  -- uploadedBy
  "sales_order_id" bigint references sales.orders (id),
  "shopify_order_id" bigint references sales.shopify_orders (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table production.order_book is 'From Firebase: pt_orderBook';

create table if not exists production.order_book_done_log (
  id bigint generated always as identity primary key,
  "order_book_id" bigint references production.order_book (id),
  "act" text,  -- act
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "handed" numeric,  -- handed
  "note" text,  -- note
  "why" text  -- why
);
comment on table production.order_book_done_log is 'From Firebase: pt_orderBook · shopDoneLog';

create table if not exists production.vendor_orders (
  id bigint generated always as identity primary key,
  "vendor_key" text,
  "fb_key" text,  -- _key
  "approved_at" timestamptz,  -- approvedAt
  "approved_by" text,  -- approvedBy
  "cancel_note" text,  -- cancelNote
  "changed_note" text,  -- changedNote
  "channel" text,  -- channel
  "created_at_fb" timestamptz,  -- createdAt
  "created_by_fb" text,  -- createdBy
  "demand_source" text,  -- demandSource
  "dispatch_date" date,  -- dispatchDate
  "filler" text,  -- filler
  "flow_print_order" text,  -- flowPrintOrder
  "flow_prog" jsonb,  -- flowProg
  "fb_id" text,  -- id
  "last_dispatch_date" date,  -- lastDispatchDate
  "notes" text,  -- notes
  "order_date" date,  -- orderDate
  "order_no" text,  -- orderNo
  "order_type" text,  -- orderType
  "request_id" text,  -- requestId
  "request_no" text,  -- requestNo
  "service" text,  -- service
  "staff_updated_at" timestamptz,  -- staffUpdatedAt
  "staff_updated_by" text,  -- staffUpdatedBy
  "status" text,  -- status
  "vendor_code" text,  -- vendorCode
  "vendor_name" text,  -- vendorName
  "vendor_updated_at" timestamptz,  -- vendorUpdatedAt
  "vendor_id" bigint references core.vendors (id),
  "channel_id" bigint references sales.channels (id),
  "approval_id" bigint references core.approvals (id)
);
comment on table production.vendor_orders is 'From Firebase: pt_vendorOrders';

create table if not exists production.vendor_order_lines (
  id bigint generated always as identity primary key,
  "vendor_order_id" bigint references production.vendor_orders (id),
  "line_no" int,
  "article_subtype" text,  -- articleSubtype
  "article_type" text,  -- articleType
  "brand" text,  -- brand
  "cancelled" boolean,  -- cancelled
  "cancelled_at" timestamptz,  -- cancelledAt
  "cancelled_by" text,  -- cancelledBy
  "color" text,  -- color
  "custom_new" boolean,  -- customNew
  "deliveries" jsonb,  -- deliveries
  "delivery_date" date,  -- deliveryDate
  "dispatched_qty" numeric,  -- dispatchedQty
  "fabric_type" text,  -- fabricType
  "flow_key" text,  -- flowKey
  "flow_part" text,  -- flowPart
  "for_orders" jsonb,  -- forOrders
  "img" text,  -- img
  "item_name" text,  -- itemName
  "kind" text,  -- kind
  "line_id" text,  -- lineId
  "lookalike_from" text,  -- lookalikeFrom
  "meters" numeric,  -- meters
  "notes" text,  -- notes
  "pic_sku" text,  -- picSku
  "print_direction" text,  -- printDirection
  "priority" text,  -- priority
  "qty" numeric,  -- qty
  "shop_key" text,  -- shopKey
  "shop_order_no" text,  -- shopOrderNo
  "shop_ref" text,  -- shopRef
  "size" text,  -- size
  "sku" text,  -- sku
  "vendor_date" date,  -- vendorDate
  "vendor_date_at" timestamptz,  -- vendorDateAt
  "vendor_date_first" date,  -- vendorDateFirst
  "vendor_date_log" jsonb,  -- vendorDateLog
  "vendor_qty" numeric,  -- vendorQty
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table production.vendor_order_lines is 'From Firebase: pt_vendorOrders · lines';

create table if not exists production.vendor_rfd_requests (
  id bigint generated always as identity primary key,
  "vendor_order_id" bigint references production.vendor_orders (id),
  "colour" text,  -- colour
  "fabric" text,  -- fabric
  "fb_id" text,  -- id
  "metres" numeric,  -- metres
  "note" text,  -- note
  "office" boolean,  -- office
  "order_id" text,  -- orderId
  "order_no" text,  -- orderNo
  "pieces" numeric,  -- pieces
  "raised_at" timestamptz,  -- raisedAt
  "raised_by" text,  -- raisedBy
  "shown" jsonb,  -- shown
  "size" text,  -- size
  "sku" text,  -- sku
  "unit" text,  -- unit
  "vendor_code" text,  -- vendorCode
  "vendor_name" text,  -- vendorName
  "what" text,  -- what
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table production.vendor_rfd_requests is 'From Firebase: pt_vendorOrders · rfdReqs';

create table if not exists production.vendor_sent (
  id bigint generated always as identity primary key,
  "vendor_order_id" bigint references production.vendor_orders (id),
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "challan" text,  -- challan
  "color" text,  -- color
  "fabric_type" text,  -- fabricType
  "line_id" text,  -- lineId
  "print_direction" text,  -- printDirection
  "qty" numeric,  -- qty
  "removed" jsonb,  -- removed
  "sku" text,  -- sku
  "unit" text,  -- unit
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table production.vendor_sent is 'From Firebase: pt_vendorOrders · vSent';

create table if not exists production.vendor_challans (
  id bigint generated always as identity primary key,
  "vendor_key" text,
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "code" text,  -- code
  "date" date,  -- date
  "name" text,  -- name
  "doc_no" text,  -- no
  "vendor_id" bigint references core.vendors (id)
);
comment on table production.vendor_challans is 'From Firebase: pt_vendorChallans';

create table if not exists production.vendor_challan_lines (
  id bigint generated always as identity primary key,
  "vendor_challan_id" bigint references production.vendor_challans (id),
  "line_no" int,
  "article" text,  -- article
  "color" text,  -- color
  "line_id" text,  -- lineId
  "nio" boolean,  -- nio
  "order_no" text,  -- orderNo
  "qty" numeric,  -- qty
  "size" text,  -- size
  "sku" text,  -- sku
  "typed" boolean,  -- typed
  "unit" text,  -- unit
  "vo_id" text,  -- voId
  "vo_no" text,  -- voNo
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "vendor_order_id" bigint references production.vendor_orders (id)
);
comment on table production.vendor_challan_lines is 'From Firebase: pt_vendorChallans · lines';

create table if not exists production.shop_floor (
  id bigint generated always as identity primary key,
  "assigned_at" timestamptz,  -- assignedAt
  "assigned_by" text,  -- assignedBy
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "cut" numeric,  -- cut
  "handed_at" timestamptz,  -- handedAt
  "handed_by" text,  -- handedBy
  "handed_note" text,  -- handedNote
  "handed_qty" numeric,  -- handedQty
  "issued" numeric,  -- issued
  "order_no" text,  -- orderNo
  "pressed" numeric,  -- pressed
  "printed" numeric,  -- printed
  "printed_at" timestamptz,  -- printedAt
  "printed_by" text,  -- printedBy
  "printer" text,  -- printer
  "quilt_at" timestamptz,  -- quiltAt
  "quilt_by" text,  -- quiltBy
  "received" numeric,  -- received
  "remarks" text,  -- remarks
  "sku" text,  -- sku
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "vendor_id" bigint references core.vendors (id)
);
comment on table production.shop_floor is 'From Firebase: pt_shopProd';

create table if not exists production.shop_hand_log (
  id bigint generated always as identity primary key,
  "shop_floor_id" bigint references production.shop_floor (id),
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "qty" numeric  -- qty
);
comment on table production.shop_hand_log is 'From Firebase: pt_shopProd · handLog';

create table if not exists sales.amazon_pos (
  id bigint generated always as identity primary key,
  "at_time" timestamptz,  -- at
  "brand" text,  -- brand
  "by_email" text,  -- by
  "eta" date,  -- eta
  "mode" text,  -- mode
  "order_date" date,  -- orderDate
  "priority" text,  -- priority
  "status" text,  -- status
  "supplier" text,  -- supplier
  "channel_id" bigint references sales.channels (id)
);
comment on table sales.amazon_pos is 'From Firebase: po (Firestore)';

create table if not exists sales.amazon_po_lines (
  id bigint generated always as identity primary key,
  "amazon_po_id" bigint references sales.amazon_pos (id),
  "line_no" int,
  "air_qty" numeric,  -- airQty
  "color" text,  -- color
  "qty" numeric,  -- qty
  "sea_qty" numeric,  -- seaQty
  "size" text,  -- size
  "sku" text,  -- sku
  "subcat" text,  -- subcat
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table sales.amazon_po_lines is 'From Firebase: po · lines';

create table if not exists sales.amazon_po_followups (
  id bigint generated always as identity primary key,
  "amazon_po_id" bigint references sales.amazon_pos (id),
  "by_email" text,  -- by
  "date" date,  -- date
  "note" text  -- note
);
comment on table sales.amazon_po_followups is 'From Firebase: po · followups';

create table if not exists shipping.packing_lists (
  id bigint generated always as identity primary key,
  "account" text,  -- account
  "by_email" text,  -- by
  "created_at_fb" date,  -- createdAt
  "date" date,  -- date
  "fb_id" text,  -- id
  "invoice" text,  -- invoice
  "pkg_wt" numeric,  -- pkgWt
  "scan" jsonb,  -- scan
  "source" text,  -- source
  "src" text,  -- src
  "status" text,  -- status
  "title" text,  -- title
  "updated_at_fb" timestamptz,  -- updatedAt
  "updated_by_fb" text,  -- updatedBy
  "vol_div" numeric  -- volDiv
);
comment on table shipping.packing_lists is 'From Firebase: packlist (Firestore)';

create table if not exists shipping.boxes (
  id bigint generated always as identity primary key,
  "packing_list_id" bigint references shipping.packing_lists (id),
  "box_index" int,
  "height_cm" numeric,  -- H
  "length_cm" numeric,  -- L
  "width_cm" numeric,  -- W
  "gross_wt_override" numeric,  -- grossWtOverride
  "box_no" numeric  -- n
);
comment on table shipping.boxes is 'From Firebase: packlist · boxes';

create table if not exists shipping.box_items (
  id bigint generated always as identity primary key,
  "box_id" bigint references shipping.boxes (id),
  "line_no" int,
  "description" text,  -- desc
  "material" text,  -- material
  "per_pcs_wt" numeric,  -- perPcsWt
  "qty" numeric,  -- qty
  "size" text,  -- size
  "sku" text,  -- sku
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table shipping.box_items is 'From Firebase: packlist · boxes · items';

create table if not exists archive.old_production_orders (
  id bigint generated always as identity primary key,
  "doc" text,
  "doc_index" int,
  "at_time" date,  -- at
  "cancelled" boolean,  -- cancelled
  "channel_code" text,  -- ch
  "fb_id" text,  -- id
  "items" jsonb,  -- items
  "doc_no" text,  -- no
  "route" text,  -- route
  "state" text  -- st
);
comment on table archive.old_production_orders is 'From Firebase: prodorders (Firestore)';

-- ===================================================================== legacy key, original record, fingerprint, who / when, rules, log
do $$ declare t text; begin
  foreach t in array array['sales.channels','sales.orders','sales.order_lines','sales.order_qty_changes','sales.order_removed_lines','sales.shopify_orders','production.order_book','production.order_book_done_log','production.vendor_orders','production.vendor_order_lines','production.vendor_rfd_requests','production.vendor_sent','production.vendor_challans','production.vendor_challan_lines','production.shop_floor','production.shop_hand_log','sales.amazon_pos','sales.amazon_po_lines','sales.amazon_po_followups','shipping.packing_lists','shipping.boxes','shipping.box_items','archive.old_production_orders'] loop
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
    -- any ERP person may add or change orders (as today); only an admin deletes
    execute format('drop trigger if exists sku_side_rules on %s', t);
    execute format('create trigger sku_side_rules before insert or update or delete on %s for each row execute function core.sku_side_rules()', t);
    perform core.watch(t::regclass);
    execute format('revoke all on %s from anon, authenticated', t);
    execute format('grant all on %s to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema sales to service_role;
grant usage, select on all sequences in schema production to service_role;
grant usage, select on all sequences in schema shipping to service_role;
grant usage, select on all sequences in schema archive to service_role;
create unique index if not exists channels_code on sales.channels (code);
create unique index if not exists shopify_orders_id on sales.shopify_orders (shop_order_id);
create index if not exists order_lines_sku on sales.order_lines (sku_id);
create index if not exists order_book_sku on production.order_book (sku_id);
create index if not exists vendor_order_lines_sku on production.vendor_order_lines (sku_id);
create index if not exists shop_floor_sku on production.shop_floor (sku_id);
create index if not exists amazon_po_lines_sku on sales.amazon_po_lines (sku_id);
create index if not exists box_items_sku on shipping.box_items (sku_id);
create index if not exists order_lines_parent on sales.order_lines (order_id);
create index if not exists order_qty_changes_parent on sales.order_qty_changes (order_id);
create index if not exists order_removed_lines_parent on sales.order_removed_lines (order_id);
create index if not exists order_book_done_log_parent on production.order_book_done_log (order_book_id);
create index if not exists vendor_order_lines_parent on production.vendor_order_lines (vendor_order_id);
create index if not exists vendor_rfd_requests_parent on production.vendor_rfd_requests (vendor_order_id);
create index if not exists vendor_sent_parent on production.vendor_sent (vendor_order_id);
create index if not exists vendor_challan_lines_parent on production.vendor_challan_lines (vendor_challan_id);
create index if not exists shop_hand_log_parent on production.shop_hand_log (shop_floor_id);
create index if not exists amazon_po_lines_parent on sales.amazon_po_lines (amazon_po_id);
create index if not exists amazon_po_followups_parent on sales.amazon_po_followups (amazon_po_id);
create index if not exists boxes_parent on shipping.boxes (packing_list_id);
create index if not exists box_items_parent on shipping.box_items (box_id);

-- ===================================================================== the load door (server key only)
create or replace function core.load_order_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare cols text; sets text; n int;
begin
  -- p_table is schema.table, e.g. sales.orders
  if p_table not in ('sales.channels','sales.orders','sales.order_lines','sales.order_qty_changes','sales.order_removed_lines','sales.shopify_orders','production.order_book','production.order_book_done_log','production.vendor_orders','production.vendor_order_lines','production.vendor_rfd_requests','production.vendor_sent','production.vendor_challans','production.vendor_challan_lines','production.shop_floor','production.shop_hand_log','sales.amazon_pos','sales.amazon_po_lines','sales.amazon_po_followups','shipping.packing_lists','shipping.boxes','shipping.box_items','archive.old_production_orders') then raise exception 'load_order_rows: % is not an Orders table', p_table; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  perform set_config('core.loading', 'on', true);
  select string_agg(quote_ident(k), ', '), string_agg(format('%1$I = excluded.%1$I', k), ', ') filter (where k <> 'legacy_key')
    into cols, sets from jsonb_object_keys(p_rows -> 0) k;
  execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)
                  on conflict (legacy_key) where legacy_key is not null do update set %s', p_table, cols, cols, p_table, sets) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.load_order_rows(text, jsonb) from public, anon, authenticated;
grant execute on function core.load_order_rows(text, jsonb) to service_role;

-- ===================================================================== checks
create or replace function core.orders_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare r text; q bigint; c1 bigint;
begin
  create temp table if not exists _o (n int, check_name text, result text);
  truncate _o;
  -- any ERP person may add an order; only an admin deletes it
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.qc@ridhi.test', 'T QC', (select id from core.roles where code = 'qc')) returning id into q;
    perform core.sign_in_as_test('t.qc@ridhi.test');
    insert into sales.orders (order_no) values ('TEST-ORDER-1') returning id into c1;
    begin delete from sales.orders where id = c1; r := 'FAIL: a non-admin deleted an order';
    exception when others then if sqlerrm like 'Only an admin can delete%' then r := 'PASS'; else r := 'FAIL: ' || sqlerrm; end if; end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _o values (20, 'any ERP person may add an order · only an admin deletes', r);
  perform set_config('request.jwt.claims', '', true);
  return query select x.n, x.check_name, x.result from (
    select 1 as n, 'the 4 schemas and 23 Orders tables exist, each keeps the Firebase record and fingerprint' as check_name,
           case when (select count(*) from information_schema.schemata where schema_name in ('sales','production','shipping','archive')) = 4
                 and (select count(*) from information_schema.columns where column_name = 'fp' and table_schema || '.' || table_name in ('sales.channels','sales.orders','sales.order_lines','sales.order_qty_changes','sales.order_removed_lines','sales.shopify_orders','production.order_book','production.order_book_done_log','production.vendor_orders','production.vendor_order_lines','production.vendor_rfd_requests','production.vendor_sent','production.vendor_challans','production.vendor_challan_lines','production.shop_floor','production.shop_hand_log','sales.amazon_pos','sales.amazon_po_lines','sales.amazon_po_followups','shipping.packing_lists','shipping.boxes','shipping.box_items','archive.old_production_orders')) = 23 then 'PASS' else 'FAIL' end as result
    union all select 2, 'rules, stamps and the change log on all 23',
           case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
                       where t.tgname = 'sku_side_rules' and s.nspname || '.' || c.relname in ('sales.channels','sales.orders','sales.order_lines','sales.order_qty_changes','sales.order_removed_lines','sales.shopify_orders','production.order_book','production.order_book_done_log','production.vendor_orders','production.vendor_order_lines','production.vendor_rfd_requests','production.vendor_sent','production.vendor_challans','production.vendor_challan_lines','production.shop_floor','production.shop_hand_log','sales.amazon_pos','sales.amazon_po_lines','sales.amazon_po_followups','shipping.packing_lists','shipping.boxes','shipping.box_items','archive.old_production_orders')) = 23
                 and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
                       where t.tgname = 'zz_log' and s.nspname || '.' || c.relname in ('sales.channels','sales.orders','sales.order_lines','sales.order_qty_changes','sales.order_removed_lines','sales.shopify_orders','production.order_book','production.order_book_done_log','production.vendor_orders','production.vendor_order_lines','production.vendor_rfd_requests','production.vendor_sent','production.vendor_challans','production.vendor_challan_lines','production.shop_floor','production.shop_hand_log','sales.amazon_pos','sales.amazon_po_lines','sales.amazon_po_followups','shipping.packing_lists','shipping.boxes','shipping.box_items','archive.old_production_orders')) = 23 then 'PASS' else 'FAIL' end
    union all select 3, 'browsers can read none of them (nor use the 4 schemas)',
           case when not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname || '.' || c.relname in ('sales.channels','sales.orders','sales.order_lines','sales.order_qty_changes','sales.order_removed_lines','sales.shopify_orders','production.order_book','production.order_book_done_log','production.vendor_orders','production.vendor_order_lines','production.vendor_rfd_requests','production.vendor_sent','production.vendor_challans','production.vendor_challan_lines','production.shop_floor','production.shop_hand_log','sales.amazon_pos','sales.amazon_po_lines','sales.amazon_po_followups','shipping.packing_lists','shipping.boxes','shipping.box_items','archive.old_production_orders')
                                  and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select')))
                 and not exists (select 1 from unnest(array['sales','production','shipping','archive']) s where has_schema_privilege('anon', s, 'usage') or has_schema_privilege('authenticated', s, 'usage')) then 'PASS' else 'FAIL' end
    union all select 4, 'lines point at their order; SKUs, vendors, channels and requests are links (no copies)',
           case when (select count(*) from information_schema.table_constraints where constraint_type = 'FOREIGN KEY' and table_schema || '.' || table_name in ('sales.channels','sales.orders','sales.order_lines','sales.order_qty_changes','sales.order_removed_lines','sales.shopify_orders','production.order_book','production.order_book_done_log','production.vendor_orders','production.vendor_order_lines','production.vendor_rfd_requests','production.vendor_sent','production.vendor_challans','production.vendor_challan_lines','production.shop_floor','production.shop_hand_log','sales.amazon_pos','sales.amazon_po_lines','sales.amazon_po_followups','shipping.packing_lists','shipping.boxes','shipping.box_items','archive.old_production_orders')) >= 40 then 'PASS' else 'FAIL' end
    union all select 5, 'no test rows left behind',
           case when not exists (select 1 from sales.orders where order_no like 'TEST-%') and not exists (select 1 from core.people where email like '%@ridhi.test') then 'PASS' else 'FAIL' end
    union all select o.n, o.check_name, o.result from _o o
  ) x order by x.n;
end $fn$;
revoke all on function core.orders_checks() from public, anon, authenticated;
grant execute on function core.orders_checks() to service_role;

notify pgrst, 'reload schema';
select * from core.orders_checks();
