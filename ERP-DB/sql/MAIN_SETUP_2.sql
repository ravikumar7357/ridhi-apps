-- R-one MAIN · SETUP 2 of 4 — Orders, Stock, live-mirror tables, HR, Production, Leftovers, History, Sellora, live copy of Firestore
-- Paste the WHOLE file into the SQL Editor of the MAIN project → Run. Safe to run again. The last result lists the checks: all must say PASS.


-- ############################################################ orders.sql
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


-- ############################################################ orders_doors.sql
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


-- ############################################################ stock.sql
-- =====================================================================================
-- SECTION 6 · STOCK — schema stock (every ledger its own table + one combined view stock.moves)
-- NEEDS: core (access … skus, speed), orders.sql.  WHERE: ERP TEST (Mumbai).  HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: the last result is a list of checks — every row must say PASS.  Then: Data API → Exposed schemas → tick "stock".
-- DATA: loaded from Ravi's PC by migration/tools/load-stock.js.  Written by migration/tools/make-stock.js from the backup of 2026-11-12.
-- =====================================================================================

create schema if not exists stock;
revoke all on schema stock from public, anon, authenticated;
grant usage on schema stock to service_role;
alter default privileges in schema stock revoke all on tables from anon, authenticated;
alter default privileges in schema stock grant all on tables to service_role;
alter default privileges in schema stock grant all on sequences to service_role;

create table if not exists stock.fg_ledger (
  id bigint generated always as identity primary key,
  "entry_id" text,  -- _id
  "created_at_fb" timestamptz,  -- createdAt
  "created_by_fb" text,  -- createdBy
  "date" date,  -- date
  "ext_order_from" text,  -- extOrderFrom
  "ext_order_qty" numeric,  -- extOrderQty
  "fba_accepted_at" timestamptz,  -- fbaAcceptedAt
  "fba_accepted_by" text,  -- fbaAcceptedBy
  "fba_note" text,  -- fbaNote
  "fba_returned" numeric,  -- fbaReturned
  "fba_returned_at" timestamptz,  -- fbaReturnedAt
  "fba_returned_by" text,  -- fbaReturnedBy
  "fba_ship_date" date,  -- fbaShipDate
  "fba_shipment" text,  -- fbaShipment
  "fba_shipped_at" timestamptz,  -- fbaShippedAt
  "fba_shipped_by" text,  -- fbaShippedBy
  "handover_to" text,  -- handoverTo
  "issued_for" text,  -- issuedFor
  "linked_fba_id" text,  -- linkedFbaId
  "order_no" text,  -- orderNo
  "order_source" text,  -- orderSource
  "orders" jsonb,  -- orders
  "over_ordered" numeric,  -- overOrdered
  "over_qty" numeric,  -- overQty
  "over_reason" text,  -- overReason
  "over_reviewed_at" timestamptz,  -- overReviewedAt
  "over_reviewed_by" text,  -- overReviewedBy
  "over_status" text,  -- overStatus
  "qty" numeric,  -- qty
  "reason" text,  -- reason
  "received_from" text,  -- receivedFrom
  "remarks" text,  -- remarks
  "sku" text,  -- sku
  "txn_type" text,  -- txnType
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "sales_order_id" bigint references sales.orders (id)
);
comment on table stock.fg_ledger is 'From Firebase: pt_fgiLedger';

create table if not exists stock.fg_ledger_edits (
  id bigint generated always as identity primary key,
  "fg_ledger_id" bigint references stock.fg_ledger (id),
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "requested_by" text,  -- requestedBy
  "was" jsonb  -- was
);
comment on table stock.fg_ledger_edits is 'From Firebase: pt_fgiLedger · edits';

create table if not exists stock.fabric_ledger (
  id bigint generated always as identity primary key,
  "entry_id" text,  -- _id
  "auto" boolean,  -- auto
  "colour" text,  -- colour
  "counterparty" text,  -- counterparty
  "counterparty_name" text,  -- counterpartyName
  "created_at_fb" timestamptz,  -- createdAt
  "created_by_fb" text,  -- createdBy
  "date" date,  -- date
  "fabric_type" text,  -- fabricType
  "form" text,  -- form
  "fb_id" text,  -- id
  "lot" text,  -- lot
  "order_no" text,  -- orderNo
  "qty" numeric,  -- qty
  "rate" text,  -- rate
  "remarks" text,  -- remarks
  "src_entry_id" text,  -- srcEntryId
  "state" text,  -- state
  "status" text,  -- status
  "txn_type" text,  -- txnType
  "vendor_challan" text,  -- vendorChallan
  "fabric_id" bigint references core.fabrics (id),
  "sales_order_id" bigint references sales.orders (id)
);
comment on table stock.fabric_ledger is 'From Firebase: pt_fabInvLedger';

create table if not exists stock.accessory_ledger (
  id bigint generated always as identity primary key,
  "entry_id" text,  -- _id
  "auto" boolean,  -- auto
  "backfilled" boolean,  -- backfilled
  "created_at_fb" timestamptz,  -- createdAt
  "created_by_fb" text,  -- createdBy
  "date" date,  -- date
  "issued_to" text,  -- issuedTo
  "item_code" text,  -- itemCode
  "qty" numeric,  -- qty
  "ref" text,  -- ref
  "remarks" text,  -- remarks
  "src_entry_id" text,  -- srcEntryId
  "txn_type" text,  -- txnType
  "accessory_id" bigint references core.accessories (id)
);
comment on table stock.accessory_ledger is 'From Firebase: pt_accLedger';

create table if not exists stock.press_stock (
  id bigint generated always as identity primary key,
  "added_at" timestamptz,  -- addedAt
  "added_by" text,  -- addedBy
  "article_subtype" text,  -- articleSubtype
  "article_type" text,  -- articleType
  "color" text,  -- color
  "entry_date" timestamptz,  -- entryDate
  "extra_pcs" numeric,  -- extraPcs
  "extra_reason" text,  -- extraReason
  "fb_id" text,  -- id
  "last_edited_at" timestamptz,  -- lastEditedAt
  "last_edited_by" text,  -- lastEditedBy
  "order_no" text,  -- orderNo
  "pieces" numeric,  -- pieces
  "remarks" text,  -- remarks
  "size" text,  -- size
  "sku" text,  -- sku
  "surplus" boolean,  -- surplus
  "transferred_qty" numeric,  -- transferredQty
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "sales_order_id" bigint references sales.orders (id)
);
comment on table stock.press_stock is 'From Firebase: pt_pressInventory';

create table if not exists stock.accessory_reserve (
  id bigint generated always as identity primary key,
  "at_time" timestamptz,  -- at
  "auto" boolean,  -- auto
  "by_email" text,  -- by
  "items" jsonb,  -- items
  "order_no" text,  -- orderNo
  "sku" text,  -- sku
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "sales_order_id" bigint references sales.orders (id)
);
comment on table stock.accessory_reserve is 'From Firebase: pt_accReserve';

create table if not exists stock.store_ledger (
  id bigint generated always as identity primary key,
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "colour" text,  -- colour
  "date" date,  -- date
  "fabric" text,  -- fabric
  "fb_id" text,  -- id
  "kind" text,  -- kind
  "qty" numeric,  -- qty
  "remark" text,  -- remark
  "sku" text,  -- sku
  "unit" text,  -- unit
  "fabric_id" bigint references core.fabrics (id),
  "colour_id" bigint references core.colours (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table stock.store_ledger is 'From Firebase: pt_storeLedger';

create table if not exists stock.rfd_stock (
  id bigint generated always as identity primary key,
  "group_key" text,
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "order_id" text,  -- orderId
  "pcs" numeric,  -- pcs
  "size" text,  -- size
  "unit" text,  -- unit
  "what" text,  -- what
  "vendor_order_id" bigint references production.vendor_orders (id)
);
comment on table stock.rfd_stock is 'From Firebase: pt_rfdStock';

create table if not exists stock.issue_recipients (
  id bigint generated always as identity primary key,
  "active" boolean,  -- active
  "category" text,  -- category
  "created_at_fb" timestamptz,  -- createdAt
  "name" text,  -- name
  "remarks" text  -- remarks
);
comment on table stock.issue_recipients is 'From Firebase: pt_issueRecipients';

do $$ declare t text; begin
  foreach t in array array['stock.fg_ledger','stock.fg_ledger_edits','stock.fabric_ledger','stock.accessory_ledger','stock.press_stock','stock.accessory_reserve','stock.store_ledger','stock.rfd_stock','stock.issue_recipients'] loop
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
grant usage, select on all sequences in schema stock to service_role;
create index if not exists fg_ledger_sku on stock.fg_ledger (sku_id);
create index if not exists press_stock_sku on stock.press_stock (sku_id);
create index if not exists accessory_reserve_sku on stock.accessory_reserve (sku_id);
create index if not exists accessory_ledger_item on stock.accessory_ledger (accessory_id);
create index if not exists fabric_ledger_fabric on stock.fabric_ledger (fabric_id);
create index if not exists fg_ledger_edits_parent on stock.fg_ledger_edits (fg_ledger_id);

create or replace view stock.moves as
  select 'finished goods'::text as ledger, f.id as row_id, f."date" as day, f."created_at_fb" as at_time,
         f."sku" as item, f.sku_id, f.custom_sku_id, null::bigint as fabric_id, null::bigint as accessory_id,
         case when f."txn_type" in ('RECEIVE','OPENING','FBA_RETURN') then f."qty"
              when f."txn_type" in ('FBA','ISSUE') then -f."qty" end as qty_change,
         'pcs'::text as unit, f."txn_type" as txn_type, f."order_no" as order_no, f."created_by_fb" as by_email
    from stock.fg_ledger f
  union all
  select 'fabric', b.id, b."date", b."created_at_fb", b."fabric_type", null, null, b.fabric_id, null,
         case when b."txn_type" in ('OPENING_RFD','RECEIVE_GREIGE','PURCHASE_RFD') then b."qty"
              when b."txn_type" = 'ISSUE_TO_STITCHERS' then -b."qty" end,
         'm', b."txn_type", b."order_no", b."created_by_fb"
    from stock.fabric_ledger b
  union all
  select 'accessories', a.id, a."date", a."created_at_fb", a."item_code", null, null, null, a.accessory_id,
         case when a."txn_type" in ('IN','OPENING') then a."qty"
              when a."txn_type" = 'OUT' then -a."qty"
              else a."qty" end,
         null, a."txn_type", null, a."created_by_fb"
    from stock.accessory_ledger a
  union all
  select 'store', s.id, s."date", s."at_time", coalesce(nullif(s."sku", ''), concat_ws(' · ', s."fabric", s."colour")),
         s.sku_id, s.custom_sku_id, s.fabric_id, null,
         case when s."kind" = 'OPENING' then s."qty" end,
         s."unit", s."kind", null, s."by_email"
    from stock.store_ledger s;
revoke all on stock.moves from anon, authenticated;
grant select on stock.moves to service_role;
comment on view stock.moves is 'Every stock movement from every ledger in one list: + in / − out. Nothing copied: it reads the ledgers.';

-- ===================================================================== doors (server key; the fingerprint door also for the test ERP)
create or replace function core.load_stock_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare cols text; sets text; n int;
begin
  if p_table not in ('stock.fg_ledger','stock.fg_ledger_edits','stock.fabric_ledger','stock.accessory_ledger','stock.press_stock','stock.accessory_reserve','stock.store_ledger','stock.rfd_stock','stock.issue_recipients') then raise exception 'load_stock_rows: % is not a Stock table', p_table; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  perform set_config('core.loading', 'on', true);
  select string_agg(quote_ident(k), ', '), string_agg(format('%1$I = excluded.%1$I', k), ', ') filter (where k <> 'legacy_key')
    into cols, sets from jsonb_object_keys(p_rows -> 0) k;
  execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)
                  on conflict (legacy_key) where legacy_key is not null do update set %s', p_table, cols, cols, p_table, sets) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.load_stock_rows(text, jsonb) from public, anon, authenticated;
grant execute on function core.load_stock_rows(text, jsonb) to service_role;

insert into core.settings (key, value, note) values ('sync.stock_backup', '"2026-11-12"', 'Which Firebase backup the Stock copy is from')
on conflict (key) do update set value = excluded.value;

create or replace function core.stock_fp() returns jsonb
language sql stable security definer set search_path = core, public as $$
  select case when core.me_id() is not null or auth.role() = 'service_role' or session_user = 'postgres' then (
    select coalesce(jsonb_object_agg(x.legacy_key, x.fp), '{}'::jsonb)
           || jsonb_build_object('#copy_of', (select st.value #>> '{}' from core.settings st where st.key = 'sync.stock_backup'))
      from (select legacy_key, fp from stock.fg_ledger union all select legacy_key, fp from stock.fabric_ledger union all select legacy_key, fp from stock.accessory_ledger union all select legacy_key, fp from stock.press_stock union all select legacy_key, fp from stock.accessory_reserve union all select legacy_key, fp from stock.store_ledger union all select legacy_key, fp from stock.rfd_stock union all select legacy_key, fp from stock.issue_recipients) x
     where x.legacy_key is not null and x.fp is not null) end
$$;
revoke all on function core.stock_fp() from public;
grant execute on function core.stock_fp() to anon, authenticated, service_role;

create or replace function core.stock_summary() returns table (item text, n bigint, of_n bigint)
language sql stable security definer set search_path = core, public as $$
  select 'stock.fg_ledger', count(*), null::bigint from stock.fg_ledger
  union all select 'stock.fg_ledger_edits', count(*), null::bigint from stock.fg_ledger_edits
  union all select 'stock.fabric_ledger', count(*), null::bigint from stock.fabric_ledger
  union all select 'stock.accessory_ledger', count(*), null::bigint from stock.accessory_ledger
  union all select 'stock.press_stock', count(*), null::bigint from stock.press_stock
  union all select 'stock.accessory_reserve', count(*), null::bigint from stock.accessory_reserve
  union all select 'stock.store_ledger', count(*), null::bigint from stock.store_ledger
  union all select 'stock.rfd_stock', count(*), null::bigint from stock.rfd_stock
  union all select 'stock.issue_recipients', count(*), null::bigint from stock.issue_recipients
  union all select 'stock.moves (combined view)', count(*), null from stock.moves
  union all select 'link · finished goods → SKU', count(*) filter (where sku_id is not null or custom_sku_id is not null), count(*) from stock.fg_ledger
  union all select 'link · press → SKU', count(*) filter (where sku_id is not null or custom_sku_id is not null), count(*) from stock.press_stock
  union all select 'link · accessory ledger → accessory', count(*) filter (where accessory_id is not null), count(*) from stock.accessory_ledger
  union all select 'link · fabric ledger → fabric', count(*) filter (where fabric_id is not null), count(*) from stock.fabric_ledger
  union all select 'link · finished goods → sales order', count(*) filter (where sales_order_id is not null), count(*) filter (where coalesce(trim("order_no"), '') <> '') from stock.fg_ledger
  union all select 'link · RFD stock → vendor order', count(*) filter (where vendor_order_id is not null), count(*) from stock.rfd_stock
  union all select 'moves with no + / − (type not in the sign list)', count(*) filter (where qty_change is null), count(*) from stock.moves
$$;
revoke all on function core.stock_summary() from public, anon, authenticated;
grant execute on function core.stock_summary() to service_role;

create or replace function core.stock_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare r text; q bigint; c1 bigint;
begin
  create temp table if not exists _s (n int, check_name text, result text);
  truncate _s;
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.stockcheck@ridhi.test', 'T Stock Check', (select id from core.roles where code = 'qc')) returning id into q;
    perform core.sign_in_as_test('t.stockcheck@ridhi.test');
    insert into stock.store_ledger ("kind", "qty") values ('OPENING', 1) returning id into c1;
    begin delete from stock.store_ledger where id = c1; r := 'FAIL: a non-admin deleted a stock line';
    exception when others then if sqlerrm like 'Only an admin can delete%' then r := 'PASS'; else r := 'FAIL: ' || sqlerrm; end if; end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _s values (20, 'any ERP person may add a stock line · only an admin deletes', r);
  perform set_config('request.jwt.claims', '', true);
  return query select x.n, x.check_name, x.result from (
    select 1 as n, 'the stock schema and its 9 tables exist, each keeps the Firebase record and fingerprint' as check_name,
           case when (select count(*) from information_schema.columns where column_name = 'fp' and table_schema || '.' || table_name in ('stock.fg_ledger','stock.fg_ledger_edits','stock.fabric_ledger','stock.accessory_ledger','stock.press_stock','stock.accessory_reserve','stock.store_ledger','stock.rfd_stock','stock.issue_recipients')) = 9 then 'PASS' else 'FAIL' end as result
    union all select 2, 'rules, stamps and the change log on all 9',
           case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace where t.tgname = 'zz_log' and s.nspname || '.' || c.relname in ('stock.fg_ledger','stock.fg_ledger_edits','stock.fabric_ledger','stock.accessory_ledger','stock.press_stock','stock.accessory_reserve','stock.store_ledger','stock.rfd_stock','stock.issue_recipients')) = 9
                 and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace where t.tgname = 'sku_side_rules' and s.nspname || '.' || c.relname in ('stock.fg_ledger','stock.fg_ledger_edits','stock.fabric_ledger','stock.accessory_ledger','stock.press_stock','stock.accessory_reserve','stock.store_ledger','stock.rfd_stock','stock.issue_recipients')) = 9 then 'PASS' else 'FAIL' end
    union all select 3, 'browsers can read none of them, nor the combined view, nor use the schema',
           case when not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'stock'
                                  and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select')))
                 and not has_schema_privilege('anon', 'stock', 'usage') and not has_schema_privilege('authenticated', 'stock', 'usage') then 'PASS' else 'FAIL' end
    union all select 4, 'the combined view stock.moves answers', case when to_regclass('stock.moves') is not null then 'PASS' else 'FAIL' end
    union all select 5, 'no test rows left behind', case when not exists (select 1 from core.people where email like '%@ridhi.test') then 'PASS' else 'FAIL' end
    union all select s.n, s.check_name, s.result from _s s
  ) x order by x.n;
end $fn$;
revoke all on function core.stock_checks() from public, anon, authenticated;
grant execute on function core.stock_checks() to service_role;

notify pgrst, 'reload schema';
select * from core.stock_checks();


-- ############################################################ sync.sql
-- =====================================================================================================================
-- LIVE MIRROR · step 1 (12 Nov 2026) — every save the ERP makes in Firebase is also sent here, as it is.
--
--   ERP Save → Firebase (as today) → core.mirror(changes)  → core.sync_inbox   (this file)
--                                     the processor reads the inbox → the same loaders' rules → the section tables
--
-- The ERP never waits for this and is never stopped by it. Nothing is ever deleted: a record deleted in Firebase stays in
-- its table and is listed in core.sync_gone with the time it went. Paste the whole file into the SQL Editor of ERP TEST.
-- Safe to paste again.
-- =====================================================================================================================

-- 1 · the inbox: one row per changed path, exactly as the ERP sent it
create table if not exists core.sync_inbox (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),          -- when Supabase got it
  saved_at  timestamptz,                                 -- when the ERP saved it in Firebase (the browser's clock)
  email     text,                                        -- who saved it: from the sign-in, never from the browser's word
  kind      text not null check (kind in ('put', 'patch', 'delete')),
  path      text not null,                               -- the Firebase path, e.g. pt_orderBook/123/status · Firestore: fs/po/<doc>
  value     jsonb,                                       -- what was written there (null = removed)
  screen    text,                                        -- which ERP screen saved it
  status    text not null default 'new' check (status in ('new', 'applied', 'done', 'not_moved_yet', 'failed')),
  section   text,                                        -- control · masters · skus · orders · stock (set by the processor)
  error     text,
  done_at   timestamptz
);
create index if not exists sync_inbox_new on core.sync_inbox (id) where status in ('new', 'applied');
create index if not exists sync_inbox_path on core.sync_inbox (path, id desc);
alter table core.sync_inbox enable row level security;      -- no table rights for browsers: only the doors below
comment on table core.sync_inbox is 'Every change the ERP saved in Firebase, sent here as it was — the live mirror''s inbox. Never emptied.';

-- 2 · records deleted in Firebase: the row stays in its table, this says since when it is gone
create table if not exists core.sync_gone (
  tbl         text not null,                             -- schema.table
  legacy_key  text not null,
  gone_since  timestamptz not null default now(),
  primary key (tbl, legacy_key)
);
alter table core.sync_gone enable row level security;
comment on table core.sync_gone is 'Rows whose Firebase record was deleted. The row itself is kept; nothing is removed.';

-- 3 · THE DOOR THE ERP CALLS after every save.  p_changes = [{ "k": "put|patch|delete", "p": "<path>", "v": <value>, "t": "<saved at>" }, …]
--     Only a signed-in ERP person (Firebase sign-in checked by Supabase), or the server key. Answers how many were taken.
create or replace function core.mirror(p_changes jsonb, p_screen text default null) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  if core.me_id() is null and auth.role() is distinct from 'service_role' then raise exception 'mirror: not an ERP sign-in'; end if;
  if exists (select 1 from core.settings where key = 'sync.mirror_off' and value = 'true'::jsonb) then return 0; end if;   -- the OFF switch (sync_switch.sql)
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'mirror: changes must be a list'; end if;
  if jsonb_array_length(p_changes) > 2000 then raise exception 'mirror: at most 2,000 changes at once'; end if;
  if octet_length(p_changes::text) > 8000000 then raise exception 'mirror: at most 8 MB at once'; end if;
  insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
  select case when c->>'t' ~ '^\d{4}-\d{2}-\d{2}' then (c->>'t')::timestamptz end,
         coalesce(core.me_email(), 'server'),
         c->>'k', c->>'p', case when c->'v' = 'null'::jsonb then null else c->'v' end, left(p_screen, 80)
    from jsonb_array_elements(p_changes) c
   where c->>'k' in ('put', 'patch', 'delete') and coalesce(c->>'p', '') <> '';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.mirror(jsonb, text) from public;
grant execute on function core.mirror(jsonb, text) to anon, authenticated, service_role;   -- anon = a Firebase sign-in; refused without a real ERP person

-- 4 · the processor's doors (server key only)
-- take the oldest new changes
create or replace function core.sync_take(p_n int default 500)
returns table (id bigint, kind text, path text, value jsonb, saved_at timestamptz, at timestamptz)
language sql security definer set search_path = core, public as $$
  select i.id, i.kind, i.path, i.value, i.saved_at, i.at from core.sync_inbox i
   where i.status = 'new' order by i.id limit greatest(1, least(p_n, 5000))
$$;
-- after the change is in the processor's copy: applied (waiting for its section to load) or not moved yet / failed
create or replace function core.sync_mark(p_ids bigint[], p_status text, p_section text default null, p_error text default null) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  if p_status not in ('applied', 'not_moved_yet', 'failed') then raise exception 'sync_mark: % is not a status', p_status; end if;
  update core.sync_inbox set status = p_status, section = coalesce(p_section, section), error = p_error,
         done_at = case when p_status = 'applied' then null else now() end
   where id = any(p_ids);
  get diagnostics n = row_count; return n;
end $$;
-- a section loaded: every applied change of it is done · or it failed: the reason is noted, the changes wait for the retry
create or replace function core.sync_section(p_section text, p_ok boolean, p_error text default null, p_upto bigint default null) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  if p_ok then
    update core.sync_inbox set status = 'done', error = null, done_at = now()
     where section = p_section and status = 'applied' and (p_upto is null or id <= p_upto);
  else
    update core.sync_inbox set error = left(p_error, 2000) where section = p_section and status = 'applied' and (p_upto is null or id <= p_upto);
  end if;
  get diagnostics n = row_count; return n;
end $$;
-- every row of one section table: legacy_key → fingerprint — one answer, no paging. A table without a saved fp column
-- (fabrics, colour groups …) gets it made here from its firebase record; a table with neither answers null.
create or replace function core.sync_fps(p_table text) returns jsonb
language plpgsql stable security definer set search_path = core, public as $$
declare s text; t text; has_fp boolean; has_fb boolean; r jsonb;
begin
  s := split_part(p_table, '.', 1); t := split_part(p_table, '.', 2);
  if s not in ('core', 'sales', 'production', 'shipping', 'archive', 'stock', 'hr', 'planning', 'history') or t = '' then raise exception 'sync_fps: % is not a section table', p_table; end if;
  if not exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'legacy_key') then
    raise exception 'sync_fps: % has no legacy_key', p_table; end if;
  has_fp := exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'fp');
  has_fb := exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'firebase');
  execute format('select coalesce(jsonb_object_agg(legacy_key, %s), ''{}''::jsonb) from %I.%I where legacy_key is not null',
                 case when has_fp then 'fp'
                      when has_fb then 'case when firebase is null then null else encode(sha256(convert_to(firebase::text, ''UTF8'')), ''hex'') end'
                      else 'null::text' end, s, t) into r;
  return r;
end $$;
-- p_gone = ALL keys of this table that Firebase no longer has: new ones are listed (since now), ones back in Firebase leave the list.
-- Only the list changes — the data rows are never touched.
create or replace function core.sync_gone_set(p_table text, p_gone text[]) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int := 0; m int;
begin
  insert into core.sync_gone (tbl, legacy_key) select p_table, k from unnest(coalesce(p_gone, '{}')) k on conflict do nothing;
  get diagnostics n = row_count;
  delete from core.sync_gone where tbl = p_table and not (legacy_key = any(coalesce(p_gone, '{}')));   -- a list entry only, never a data row
  get diagnostics m = row_count;
  return n + m;
end $$;
-- how the mirror is doing (counts only)
create or replace function core.sync_status()
returns table (status text, section text, n bigint, oldest timestamptz, newest timestamptz)
language sql stable security definer set search_path = core, public as $$
  select status, coalesce(section, '—'), count(*), min(at), max(at) from core.sync_inbox group by 1, 2
  union all select 'gone (kept, marked)', tbl, count(*), min(gone_since), max(gone_since) from core.sync_gone group by 2
  order by 1, 2
$$;
revoke all on function core.sync_take(int), core.sync_mark(bigint[], text, text, text), core.sync_section(text, boolean, text, bigint),
                       core.sync_fps(text), core.sync_gone_set(text, text[]), core.sync_status() from public, anon, authenticated;
grant execute on function core.sync_take(int), core.sync_mark(bigint[], text, text, text), core.sync_section(text, boolean, text, bigint),
                          core.sync_fps(text), core.sync_gone_set(text, text[]), core.sync_status() to service_role;

-- 5 · checks
notify pgrst, 'reload schema';
select 1 as n, 'inbox and gone list exist, closed to browsers' as check_name,
       case when to_regclass('core.sync_inbox') is not null and to_regclass('core.sync_gone') is not null
             and not has_table_privilege('anon', 'core.sync_inbox', 'select') and not has_table_privilege('anon', 'core.sync_inbox', 'insert')
             and not has_table_privilege('authenticated', 'core.sync_inbox', 'select') then 'PASS' else 'FAIL' end as result
union all select 2, 'the ERP door needs a real ERP sign-in (or the server key)',
       case when has_function_privilege('anon', 'core.mirror(jsonb,text)', 'execute')
             and position('me_id' in pg_get_functiondef('core.mirror(jsonb,text)'::regprocedure)) > 0 then 'PASS' else 'FAIL' end
union all select 3, 'browsers cannot use the processor doors',
       case when not has_function_privilege('anon', 'core.sync_take(int)', 'execute') and not has_function_privilege('authenticated', 'core.sync_fps(text)', 'execute')
             and not has_function_privilege('anon', 'core.sync_gone_set(text,text[])', 'execute') then 'PASS' else 'FAIL' end
union all select 4, 'the fingerprint list answers for a section table',
       case when jsonb_typeof(core.sync_fps('production.order_book')) = 'object' then 'PASS' else 'FAIL' end
union all select 5, 'nothing can be deleted from the inbox by the doors',
       case when position('delete from core.sync_inbox' in pg_get_functiondef('core.sync_section(text,boolean,text,bigint)'::regprocedure)) = 0
             and position('delete from core.sync_inbox' in pg_get_functiondef('core.sync_mark(bigint[],text,text,text)'::regprocedure)) = 0 then 'PASS' else 'FAIL' end;


-- ############################################################ sync_switch.sql
-- LIVE MIRROR · the OFF switch (12 Nov 2026). Paste once; then, without any ERP deploy:
--   stop the mirror:   insert into core.settings (key, value, note) values ('sync.mirror_off', 'true', 'Live mirror stopped by hand') on conflict (key) do update set value = 'true';
--   start it again:   update core.settings set value = 'false' where key = 'sync.mirror_off';
-- While it is off, the ERP's saves are answered "taken" and not kept (the ERP is never held up); the nightly check against
-- the backup brings over anything saved while it was off.
-- 14 Nov: DO NOT PASTE AGAIN — sql/sync_engine.sql now holds core.mirror (the same door + the instant run). Pasting this
-- file again would only take the instant run away (nothing breaks; saves then wait for the 10-second timer).
create or replace function core.mirror(p_changes jsonb, p_screen text default null) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int;
begin
  if core.me_id() is null and auth.role() is distinct from 'service_role' then raise exception 'mirror: not an ERP sign-in'; end if;
  if exists (select 1 from core.settings where key = 'sync.mirror_off' and value = 'true'::jsonb) then return 0; end if;   -- switched off by hand
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'mirror: changes must be a list'; end if;
  if jsonb_array_length(p_changes) > 2000 then raise exception 'mirror: at most 2,000 changes at once'; end if;
  if octet_length(p_changes::text) > 8000000 then raise exception 'mirror: at most 8 MB at once'; end if;
  insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
  select case when c->>'t' ~ '^\d{4}-\d{2}-\d{2}' then (c->>'t')::timestamptz end,
         coalesce(core.me_email(), 'server'),
         c->>'k', c->>'p', case when c->'v' = 'null'::jsonb then null else c->'v' end, left(p_screen, 80)
    from jsonb_array_elements(p_changes) c
   where c->>'k' in ('put', 'patch', 'delete') and coalesce(c->>'p', '') <> '';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.mirror(jsonb, text) from public;
grant execute on function core.mirror(jsonb, text) to anon, authenticated, service_role;
insert into core.settings (key, value, note) values ('sync.mirror_off', 'false', 'true = the live mirror takes nothing (see sql/sync_switch.sql)') on conflict (key) do nothing;

-- what the live mirror received today, per section and screen (to watch it after going live)
create or replace function core.sync_today()
returns table (section text, status text, saves bigint, first_at timestamptz, last_at timestamptz, people bigint)
language sql stable security definer set search_path = core, public as $$
  select coalesce(section, '(not moved yet)'), status, count(*), min(at), max(at), count(distinct email)
    from core.sync_inbox where at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
   group by 1, 2 order by 1, 2
$$;
revoke all on function core.sync_today() from public, anon, authenticated;
grant execute on function core.sync_today() to service_role;

select 1 as n, 'the switch exists and is ON (mirror running)' as check_name,
       case when exists (select 1 from core.settings where key = 'sync.mirror_off' and value = 'false'::jsonb) then 'PASS' else 'FAIL' end as result
union all select 2, 'the door still needs a real ERP sign-in',
       case when position('me_id' in pg_get_functiondef('core.mirror(jsonb,text)'::regprocedure)) > 0
             and position('sync.mirror_off' in pg_get_functiondef('core.mirror(jsonb,text)'::regprocedure)) > 0 then 'PASS' else 'FAIL' end;


-- ############################################################ hr.sql
-- =====================================================================================
-- SECTION 7 · HR / PEOPLE & PAY — schema hr (workers, attendance, extra hours, piece rates, team sizes, headcounts)
--            + 4 login / vendor lists in core + the old RTDB copy of access rights in archive.
-- Ravi, 12 Nov: design page migration/hr-design.html — D1 … D8 all OK.
-- NEEDS: core (access, control, masters, skus, speed), orders.sql (archive), sync.sql.  WHERE: ERP TEST (Mumbai).
-- HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: the last result is a list of checks — every row must say PASS.  Then: Data API → Exposed schemas → tick "hr".
-- DATA: loaded from Ravi's PC by migration/tools/load-hr.js (next step), built by make-hr.js from the newest backup.
--
-- Rules kept here:  nothing is removed · every Firebase field its own column · every row keeps its Firebase record (firebase)
--                   and its fingerprint (fp) · links are added beside the text, never instead of it.
-- D2: pt_empList and pt_rateList are plain lists (no IDs, rewritten whole on every save). So their legacy_key is NOT the place
--     number (that moves when a line above is deleted) but a lasting key: type|name|department (workers) and
--     article|subtype|size|for (rates). The place number is kept in line_no, and the fingerprint door answers by place.
-- D5: browsers can read none of these tables (as every section). The two helpers below are what any later read door uses:
--     people (names, phones) → admin · Finance & HR screen · "Add, change, remove employees"
--     pay (rates, extra hours, team sizes, headcounts, locks, advances) → admin · Finance & HR screen
--     (the same split the ERP makes today: the employee-list right alone does not show pay).
-- =====================================================================================

create schema if not exists hr;
revoke all on schema hr from public, anon, authenticated;
grant usage on schema hr to service_role;
alter default privileges in schema hr revoke all on tables from anon, authenticated;
alter default privileges in schema hr grant all on tables to service_role;
alter default privileges in schema hr grant all on sequences to service_role;
create schema if not exists archive;

-- ===================================================================== 1 · hr tables
create table if not exists hr.workers (                       -- pt_empList: [type, name, department, phone]
  id                  bigint generated always as identity primary key,   -- D2: the lasting worker id
  line_no             int,                                    -- place in the Firebase list (0 = first), as it is today
  worker_key          text not null,                          -- type|name|department, small letters (+ #2 for an exact repeat)
  emp_type            text,                                   -- [0] Company Role / Company Contractor / External Contractor
  name                text,                                   -- [1] as written
  department          text,                                   -- [2] as written
  phone               text,                                   -- [3] as written
  department_id       bigint references core.departments (id),
  employment_type_id  bigint references core.employment_types (id),
  mark                text                                    -- D3: "same name in 2 departments" · "exact repeat" · "placeholder name"
);
comment on table hr.workers is 'From Firebase: pt_empList — one row per line, nothing merged. id = the lasting worker id.';

create table if not exists hr.attendance (                    -- pt_attend/<day__NAME>
  id              bigint generated always as identity primary key,
  fb_key          text,         -- _key
  fb_id           text,         -- id
  day             date,         -- day
  emp_name        text,         -- empName
  emp_type        text,         -- empType
  dept            text,         -- dept
  status          text,         -- status (P / A)
  in_at           text,         -- inAt (as written)
  out_at          text,         -- outAt (as written)
  remarks         text,         -- remarks
  marked_at       timestamptz,  -- markedAt
  marked_by       text,         -- markedBy
  updated_at_fb   timestamptz,  -- updatedAt
  updated_by_fb   text,         -- updatedBy
  worker_id       bigint references hr.workers (id),          -- D4
  mark            text
);
comment on table hr.attendance is 'From Firebase: pt_attend';

create table if not exists hr.extra_hours (                   -- pt_extraHours/<eh_…>
  id                   bigint generated always as identity primary key,
  fb_id                text,         -- id
  day                  date,         -- date
  emp_name             text,         -- empName
  department           text,         -- department
  from_time            text,         -- fromTime (as written, HH:MM)
  to_time              text,         -- toTime
  hours                numeric,      -- hours
  status               text,         -- status
  remarks              text,         -- remarks
  entered_at           timestamptz,  -- enteredAt
  entered_by           text,         -- enteredBy
  entered_by_name      text,         -- enteredByName
  authorized_at        timestamptz,  -- authorizedAt
  authorized_by        text,         -- authorizedBy
  authorized_by_name   text,         -- authorizedByName
  edited_at            timestamptz,  -- editedAt
  edited_by            text,         -- editedBy
  worker_id            bigint references hr.workers (id),
  mark                 text
);
comment on table hr.extra_hours is 'From Firebase: pt_extraHours';

create table if not exists hr.piece_rates (                   -- pt_rateList: [article type, subtype, size, applicable for, rate, commission]
  id                bigint generated always as identity primary key,
  line_no           int,
  rate_key          text not null,                            -- article|subtype|size|for, small letters
  article_type      text,         -- [0]
  subtype           text,         -- [1]
  size              text,         -- [2]
  applicable_for    text,         -- [3]
  rate              numeric,      -- [4]
  commission        numeric,      -- [5] when it is a number
  commission_text   text,         -- [5] as written ("NA" …)  — D6
  article_type_id   bigint references core.article_types (id),
  subtype_id        bigint references core.article_subtypes (id),
  size_id           bigint references core.sizes (id),
  mark              text                                       -- D6: "type looks wrong"
);
comment on table hr.piece_rates is 'From Firebase: pt_rateList — pay per piece.';

create table if not exists hr.team_sizes (                    -- pt_teamSize/<key>/sizes/<n>  — D7 one row per change
  id          bigint generated always as identity primary key,
  team_key    text,         -- the Firebase key (contractor name, small letters)
  name        text,         -- name
  change_no   int,          -- place in sizes
  from_day    date,         -- sizes[].from
  headcount   numeric,      -- sizes[].n
  at_time     timestamptz,  -- sizes[].at
  by_email    text,         -- sizes[].by
  worker_id   bigint references hr.workers (id)
);
comment on table hr.team_sizes is 'From Firebase: pt_teamSize — how many people a contractor has, from which day.';

create table if not exists hr.contractor_heads (              -- pt_contractorHeads/<week>/<contractor key>  (+ _settings/target)
  id              bigint generated always as identity primary key,
  week            text,         -- the week key (a day) or _settings
  contractor_key  text,         -- the Firebase key
  heads           numeric,      -- when it is a number
  value           jsonb,        -- as written
  worker_id       bigint references hr.workers (id)
);
comment on table hr.contractor_heads is 'From Firebase: pt_contractorHeads — weekly headcount per contractor, and the weekly target.';

-- D8: the ERP reads these, Firebase has nothing there yet — ready for the first save
create table if not exists hr.extra_hours_locks (id bigint generated always as identity primary key, fb_key text, value jsonb);
comment on table hr.extra_hours_locks is 'From Firebase: pt_ehFreezes (month locks for extra hours) — empty today.';
create table if not exists hr.payout_locks (id bigint generated always as identity primary key, fb_key text, value jsonb);
comment on table hr.payout_locks is 'From Firebase: pt_payoutFreezes (a paid fortnight must not move) — empty today.';
create table if not exists hr.advances (id bigint generated always as identity primary key, fb_key text, value jsonb);
comment on table hr.advances is 'From Firebase: pt_advances — empty today.';

-- ===================================================================== 2 · the login / vendor lists (core) and the old rights copy (archive)
create table if not exists core.login_directory (             -- pt_loginDir/<phone>
  id              bigint generated always as identity primary key,
  phone           text,         -- the key
  email           text,         -- email
  name            text,         -- name
  updated_at_fb   timestamptz,  -- updatedAt
  person_id       bigint references core.people (id)
);
comment on table core.login_directory is 'From Firebase: pt_loginDir — phone number → sign-in email.';

create table if not exists core.vendor_logins (               -- pt_vendorByEmail/<email with , for .>
  id          bigint generated always as identity primary key,
  email_key   text,         -- the key as written in Firebase
  email       text,         -- the key as an email (small letters)
  code        text,         -- code
  name        text,         -- name
  phone       text,         -- phone
  vendor_id   bigint references core.vendors (id),
  person_id   bigint references core.people (id)
);
comment on table core.vendor_logins is 'From Firebase: pt_vendorByEmail — vendor sign-in email → vendor code.';

create table if not exists core.vendor_map (                  -- pt_vendorMap/<VND…>
  id          bigint generated always as identity primary key,
  code        text,         -- the key
  email       text,         -- email
  name        text,         -- name
  phone       text,         -- phone
  vendor_id   bigint references core.vendors (id),
  person_id   bigint references core.people (id)
);
comment on table core.vendor_map is 'From Firebase: pt_vendorMap — vendor code → main email.';

create table if not exists core.printers (                    -- pt_printers/<PRN-…>
  id          bigint generated always as identity primary key,
  fb_id       text,         -- the key
  name        text,         -- name
  active      boolean,      -- active
  tables      numeric,      -- tables
  pcs_month   numeric,      -- pcsMonth
  note        text,         -- note
  at_time     timestamptz,  -- at
  by_email    text,         -- by
  vendor_id   bigint references core.vendors (id)
);
comment on table core.printers is 'From Firebase: pt_printers — printer capacity.';

create table if not exists archive.perms_copy (               -- pt_perms/<email with , for .>  (Access runs from Firestore perms)
  id          bigint generated always as identity primary key,
  email_key   text,         -- the key as written
  email       text,         -- the key as an email
  admin       boolean,      -- admin
  tabs        jsonb,        -- t
  rights      jsonb,        -- r
  at_time     timestamptz,  -- at
  by_text     text,         -- by
  person_id   bigint references core.people (id)
);
comment on table archive.perms_copy is 'From Firebase: pt_perms — the old RTDB copy of access rights. Kept for checking only.';

-- ===================================================================== 3 · the same columns, rules and log on all 15
create or replace function core.hr_tables() returns text[] language sql immutable as $$
  select array['hr.workers','hr.attendance','hr.extra_hours','hr.piece_rates','hr.team_sizes','hr.contractor_heads',
               'hr.extra_hours_locks','hr.payout_locks','hr.advances',
               'core.login_directory','core.vendor_logins','core.vendor_map','core.printers','archive.perms_copy']
$$;

-- who may change: any signed-in ERP person adds / changes (as today); deleting a worker = admin or "Add, change, remove
-- employees" (as the ERP); deleting anything else = admin. The loader and the server key are trusted.
create or replace function core.hr_rules() returns trigger
language plpgsql as $$
begin
  if core.loading() or core.me_email() is null then return coalesce(new, old); end if;
  if core.me_id() is null then raise exception 'Only ERP people can change %.', tg_table_name; end if;
  if tg_op = 'DELETE' then
    if tg_table_schema = 'hr' and tg_table_name = 'workers' then
      if not (core.is_admin() or core.can('right:empEdit')) then raise exception 'Only an admin or someone who may remove employees can delete a worker.'; end if;
    elsif not core.is_admin() then raise exception 'Only an admin can delete from %.', tg_table_name; end if;
  end if;
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array core.hr_tables() loop
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
    execute format('drop trigger if exists hr_rules on %s', t);
    execute format('create trigger hr_rules before insert or update or delete on %s for each row execute function core.hr_rules()', t);
    perform core.watch(t::regclass);
    execute format('revoke all on %s from anon, authenticated', t);
    execute format('grant all on %s to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema hr to service_role;
create unique index if not exists workers_worker_key on hr.workers (worker_key);
create unique index if not exists piece_rates_rate_key on hr.piece_rates (rate_key);
create index if not exists attendance_worker on hr.attendance (worker_id, day);
create index if not exists extra_hours_worker on hr.extra_hours (worker_id, day);
create index if not exists team_sizes_worker on hr.team_sizes (worker_id, from_day);

-- ===================================================================== 4 · D5: who may see people / pay (for every later read door)
create or replace function core.hr_can_see_people() returns boolean
language sql stable security definer set search_path = core, public as $$
  select core.is_admin() or core.can('erp:hr') or core.can('right:empEdit')
$$;
create or replace function core.hr_can_see_pay() returns boolean
language sql stable security definer set search_path = core, public as $$
  select core.is_admin() or core.can('erp:hr')
$$;
revoke all on function core.hr_can_see_people(), core.hr_can_see_pay() from public, anon;
grant execute on function core.hr_can_see_people(), core.hr_can_see_pay() to authenticated, service_role;

-- ===================================================================== 5 · doors (server key; the fingerprint door also for the test ERP)
create or replace function core.load_hr_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare cols text; sets text; n int;
begin
  if not (p_table = any (core.hr_tables())) then raise exception 'load_hr_rows: % is not an HR table', p_table; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  perform set_config('core.loading', 'on', true);
  select string_agg(quote_ident(k), ', '), string_agg(format('%1$I = excluded.%1$I', k), ', ') filter (where k <> 'legacy_key')
    into cols, sets from jsonb_object_keys(p_rows -> 0) k;
  execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)
                  on conflict (legacy_key) where legacy_key is not null do update set %s', p_table, cols, cols, p_table, sets) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.load_hr_rows(text, jsonb) from public, anon, authenticated;
grant execute on function core.load_hr_rows(text, jsonb) to service_role;

insert into core.settings (key, value, note) values ('sync.hr_backup', '"2026-11-12"', 'Which Firebase backup the HR copy is from')
on conflict (key) do update set value = excluded.value;

-- every Firebase record's fingerprint by its Firebase path: { path: fp, …, "#copy_of": day }. Fingerprints only, never data.
-- The two plain lists answer by place (pt_empList/<line_no>), exactly the paths the ERP sees.
create or replace function core.hr_fp() returns jsonb
language sql stable security definer set search_path = core, public as $$
  select case when core.me_id() is not null or auth.role() = 'service_role' or session_user = 'postgres' then (
    select coalesce(jsonb_object_agg(x.k, x.fp), '{}'::jsonb)
           || jsonb_build_object('#copy_of', (select st.value #>> '{}' from core.settings st where st.key = 'sync.hr_backup'))
      from (select 'pt_empList/' || line_no as k, fp from hr.workers where line_no is not null
            union all select 'pt_rateList/' || line_no, fp from hr.piece_rates where line_no is not null
            union all select legacy_key, fp from hr.attendance
            union all select legacy_key, fp from hr.extra_hours
            union all select legacy_key, fp from hr.team_sizes
            union all select legacy_key, fp from hr.contractor_heads
            union all select legacy_key, fp from hr.extra_hours_locks
            union all select legacy_key, fp from hr.payout_locks
            union all select legacy_key, fp from hr.advances
            union all select legacy_key, fp from core.login_directory
            union all select legacy_key, fp from core.vendor_logins
            union all select legacy_key, fp from core.vendor_map
            union all select legacy_key, fp from core.printers
            union all select legacy_key, fp from archive.perms_copy) x
     where x.k is not null and x.fp is not null) end
$$;
revoke all on function core.hr_fp() from public;
grant execute on function core.hr_fp() to anon, authenticated, service_role;

create or replace function core.hr_summary() returns table (item text, n bigint, of_n bigint)
language sql stable security definer set search_path = core, public as $$
  select 'hr.workers', count(*), null::bigint from hr.workers
  union all select 'hr.attendance', count(*), null from hr.attendance
  union all select 'hr.extra_hours', count(*), null from hr.extra_hours
  union all select 'hr.piece_rates', count(*), null from hr.piece_rates
  union all select 'hr.team_sizes', count(*), null from hr.team_sizes
  union all select 'hr.contractor_heads', count(*), null from hr.contractor_heads
  union all select 'hr.extra_hours_locks · payout_locks · advances', (select count(*) from hr.extra_hours_locks) + (select count(*) from hr.payout_locks) + (select count(*) from hr.advances), null
  union all select 'core.login_directory', count(*), null from core.login_directory
  union all select 'core.vendor_logins', count(*), null from core.vendor_logins
  union all select 'core.vendor_map', count(*), null from core.vendor_map
  union all select 'core.printers', count(*), null from core.printers
  union all select 'archive.perms_copy', count(*), null from archive.perms_copy
  union all select 'link · worker → department', count(*) filter (where department_id is not null), count(*) from hr.workers
  union all select 'link · worker → employment type', count(*) filter (where employment_type_id is not null), count(*) from hr.workers
  union all select 'link · attendance → worker', count(*) filter (where worker_id is not null), count(*) from hr.attendance
  union all select 'link · extra hours → worker', count(*) filter (where worker_id is not null), count(*) from hr.extra_hours
  union all select 'link · team size → worker', count(*) filter (where worker_id is not null), count(*) from hr.team_sizes
  union all select 'link · rate → article type', count(*) filter (where article_type_id is not null), count(*) from hr.piece_rates
  union all select 'link · rate → subtype', count(*) filter (where subtype_id is not null), count(*) from hr.piece_rates
  union all select 'link · rate → size', count(*) filter (where size_id is not null), count(*) from hr.piece_rates
  union all select 'link · vendor login → vendor', count(*) filter (where vendor_id is not null), count(*) from core.vendor_logins
  union all select 'link · vendor map → vendor', count(*) filter (where vendor_id is not null), count(*) from core.vendor_map
  union all select 'link · printer → vendor', count(*) filter (where vendor_id is not null), count(*) from core.printers
  union all select 'link · login directory → person', count(*) filter (where person_id is not null), count(*) from core.login_directory
  union all select 'marked rows (workers · attendance · rates)', (select count(*) from hr.workers where mark is not null) + (select count(*) from hr.attendance where mark is not null) + (select count(*) from hr.piece_rates where mark is not null), null
$$;
revoke all on function core.hr_summary() from public, anon, authenticated;
grant execute on function core.hr_summary() to service_role;

-- the mirror's fingerprint list now also knows the hr area (same as sync.sql)
create or replace function core.sync_fps(p_table text) returns jsonb
language plpgsql stable security definer set search_path = core, public as $$
declare s text; t text; has_fp boolean; has_fb boolean; r jsonb;
begin
  s := split_part(p_table, '.', 1); t := split_part(p_table, '.', 2);
  if s not in ('core', 'sales', 'production', 'shipping', 'archive', 'stock', 'hr', 'planning', 'history') or t = '' then raise exception 'sync_fps: % is not a section table', p_table; end if;
  if not exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'legacy_key') then
    raise exception 'sync_fps: % has no legacy_key', p_table; end if;
  has_fp := exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'fp');
  has_fb := exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'firebase');
  execute format('select coalesce(jsonb_object_agg(legacy_key, %s), ''{}''::jsonb) from %I.%I where legacy_key is not null',
                 case when has_fp then 'fp'
                      when has_fb then 'case when firebase is null then null else encode(sha256(convert_to(firebase::text, ''UTF8'')), ''hex'') end'
                      else 'null::text' end, s, t) into r;
  return r;
end $$;
revoke all on function core.sync_fps(text) from public, anon, authenticated;
grant execute on function core.sync_fps(text) to service_role;

-- ===================================================================== 6 · checks
create or replace function core.hr_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare r text; q bigint; w bigint; fp_ok boolean;
begin
  fp_ok := jsonb_typeof(core.hr_fp()) = 'object';            -- asked first: the sign-in test below clears who is calling
  create temp table if not exists _h (n int, check_name text, result text);
  truncate _h;
  -- a person without the employee right may add a worker but not delete one; may not delete a rate either
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.hrcheck@ridhi.test', 'T HR Check', (select id from core.roles where code = 'qc')) returning id into q;
    perform core.sign_in_as_test('t.hrcheck@ridhi.test');
    insert into hr.workers (worker_key, name) values ('test|t hr check|test', 'T HR Check') returning id into w;
    begin delete from hr.workers where id = w; r := 'FAIL: a person without the right deleted a worker';
    exception when others then if sqlerrm like 'Only an admin or someone who may remove employees%' then r := 'PASS'; else r := 'FAIL: ' || sqlerrm; end if; end;
    if r = 'PASS' and core.hr_can_see_pay() then r := 'FAIL: a QC person can see pay'; end if;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _h values (20, 'any ERP person may add a worker · only admin / employee right deletes · pay stays hidden', r);
  perform set_config('request.jwt.claims', '', true);
  return query select x.n, x.check_name, x.result from (
    select 1 as n, 'the hr schema and all 14 tables exist, each keeps the Firebase record and fingerprint' as check_name,
           case when (select count(*) from information_schema.columns where column_name = 'fp' and table_schema || '.' || table_name = any (core.hr_tables())) = 14
                 and (select count(*) from information_schema.columns where column_name = 'firebase' and table_schema || '.' || table_name = any (core.hr_tables())) = 14 then 'PASS' else 'FAIL' end as result
    union all select 2, 'rules, stamps and the change log on all 14',
           case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
                       where t.tgname in ('zz_log', 'hr_rules', 'aa_fp') and s.nspname || '.' || c.relname = any (core.hr_tables())) = 42 then 'PASS' else 'FAIL' end
    union all select 3, 'browsers can read none of them, nor use the hr schema',
           case when not exists (select 1 from unnest(core.hr_tables()) t
                                  where has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select'))
                 and not has_schema_privilege('anon', 'hr', 'usage') and not has_schema_privilege('authenticated', 'hr', 'usage') then 'PASS' else 'FAIL' end
    union all select 4, 'browsers cannot use the load door; the fingerprint door gives fingerprints only',
           case when not has_function_privilege('anon', 'core.load_hr_rows(text,jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'core.load_hr_rows(text,jsonb)', 'execute')
                 and fp_ok then 'PASS' else 'FAIL' end
    union all select 5, 'the mirror knows the hr area', case when jsonb_typeof(core.sync_fps('hr.workers')) = 'object' then 'PASS' else 'FAIL' end
    union all select 6, 'no test rows left behind', case when not exists (select 1 from core.people where email like '%@ridhi.test') then 'PASS' else 'FAIL' end
    union all select h.n, h.check_name, h.result from _h h
  ) x order by x.n;
end $fn$;
revoke all on function core.hr_checks() from public, anon, authenticated;
grant execute on function core.hr_checks() to service_role;

notify pgrst, 'reload schema';
select * from core.hr_checks();


-- ############################################################ production_jobs.sql
-- =====================================================================================
-- SECTION 8 · PRODUCTION / JOB WORK — 22 new tables in schema production (beside order book, vendor orders, shop floor)
-- Ravi, 13 Nov: design page migration/production-design.html, D1–D8 all OK.
-- NEEDS: core (access … skus, speed), orders.sql, stock.sql, hr.sql.  WHERE: ERP TEST (Mumbai).  HOW: paste the WHOLE file → Run.
-- Safe to run again.  CHECK: the last result is a list of checks — every row must say PASS.
-- DATA: loaded from Ravi's PC by migration/tools/load-production.js.  Written by migration/tools/make-production.js from the backup of 2026-11-12.
-- =====================================================================================

create table if not exists production.ppc_plans (
  id bigint generated always as identity primary key,
  "line_key" text,
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "dates_cut" date,  -- dates.cut
  "dates_qc" date,  -- dates.qc
  "dates_ready" date,  -- dates.ready
  "edited_at" date,  -- edited.at
  "edited_by" text,  -- edited.by
  "edited_why" text,  -- edited.why
  "emb_code" text,  -- emb.code
  "emb_name" text,  -- emb.name
  "fabric_from_printed" numeric,  -- fabric.fromPrinted
  "fabric_how" text,  -- fabric.how
  "fabric_metres" numeric,  -- fabric.metres
  "fabric_name" text,  -- fabric.name
  "fabric_no_rfd" boolean,  -- fabric.noRfd
  "fabric_per_pc" numeric,  -- fabric.perPc
  "fabric_printed_unit" text,  -- fabric.printedUnit
  "first_at" timestamptz,  -- firstAt
  "moved_at" timestamptz,  -- movedAt
  "moved_from" text,  -- movedFrom
  "note" text,  -- note
  "order_no" text,  -- orderNo
  "out_vendor" text,  -- outVendor
  "print_as" text,  -- print.as
  "print_dir" text,  -- print.dir
  "print_need" boolean,  -- print.need
  "printer_code" text,  -- printer.code
  "printer_name" text,  -- printer.name
  "printer_why" text,  -- printer.why
  "qty" numeric,  -- qty
  "route" text,  -- route
  "ruffle_printer_code" text,  -- rufflePrinter.code
  "ruffle_printer_name" text,  -- rufflePrinter.name
  "sku" text,  -- sku
  "order_book_id" bigint references production.order_book (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "fabric_id" bigint references core.fabrics (id),
  "printer_vendor_id" bigint references core.vendors (id),
  "ruffle_vendor_id" bigint references core.vendors (id),
  "out_vendor_id" bigint references core.vendors (id)
);
comment on table production.ppc_plans is 'From Firebase: pt_ppc';

create table if not exists production.ppc_plan_items (
  id bigint generated always as identity primary key,
  "ppc_plan_id" bigint references production.ppc_plans (id),
  "item_kind" text,
  "item_no" int,
  "code" text,  -- code
  "from_printed" numeric,  -- fromPrinted
  "qty" numeric,  -- qty
  "unit" text,  -- unit
  "what" text,  -- what
  "accessory_id" bigint references core.accessories (id)
);
comment on table production.ppc_plan_items is 'From Firebase: pt_ppc · extra / acc';

create table if not exists production.print_blocks (
  id bigint generated always as identity primary key,
  "block_key" text,
  "info_cur" numeric,  -- info.cur
  "info_printer" text,  -- info.printer
  "info_status" text,  -- info.status
  "map" numeric,  -- map
  "vendor_id" bigint references core.vendors (id)
);
comment on table production.print_blocks is 'From Firebase: pt_blockNeed (info + map, one row per brand|colour)';

create table if not exists production.cloth_challans (
  id bigint generated always as identity primary key,
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "cancelled_at" timestamptz,  -- cancelled.at
  "cancelled_by" text,  -- cancelled.by
  "cancelled_why" text,  -- cancelled.why
  "closed_at" timestamptz,  -- closed.at
  "closed_by" text,  -- closed.by
  "closed_short" boolean,  -- closed.short
  "closed_why" text,  -- closed.why
  "date" date,  -- date
  "deduct" boolean,  -- deduct
  "edit_note" text,  -- editNote
  "edited_at" timestamptz,  -- editedAt
  "edited_by" text,  -- editedBy
  "doc_no" text,  -- no
  "no_challan" boolean,  -- noChallan
  "note" text,  -- note
  "order_no" text,  -- orderNo
  "orders" jsonb,  -- orders
  "record_only" boolean,  -- recordOnly
  "vendor_code" text,  -- vendor.code
  "vendor_name" text,  -- vendor.name
  "vendor_id" bigint references core.vendors (id),
  "sales_order_id" bigint references sales.orders (id)
);
comment on table production.cloth_challans is 'From Firebase: pt_flowChallans';

create table if not exists production.cloth_challan_lines (
  id bigint generated always as identity primary key,
  "cloth_challan_id" bigint references production.cloth_challans (id),
  "line_no" int,
  "fabric" text,  -- fabric
  "item" text,  -- item
  "key" text,  -- key
  "metres" numeric,  -- metres
  "order_no" text,  -- orderNo
  "pcs" numeric,  -- pcs
  "print_code" text,  -- print.code
  "print_kind" text,  -- print.kind
  "print_label" text,  -- print.label
  "print_mode" text,  -- print.mode
  "print_need_dir" boolean,  -- print.needDir
  "print_sides" jsonb,  -- print.sides
  "print_unit" text,  -- print.unit
  "sku" text,  -- sku
  "order_book_id" bigint references production.order_book (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "fabric_id" bigint references core.fabrics (id)
);
comment on table production.cloth_challan_lines is 'From Firebase: pt_flowChallans · lines';

create table if not exists production.cloth_challan_line_extras (
  id bigint generated always as identity primary key,
  "cloth_challan_line_id" bigint references production.cloth_challan_lines (id),
  "extra_no" int,
  "code" text,  -- code
  "from_printed" numeric,  -- fromPrinted
  "kind" text,  -- kind
  "label" text,  -- label
  "metres" numeric,  -- metres
  "mode" text,  -- mode
  "total" numeric,  -- total
  "unit" text,  -- unit
  "what" text  -- what
);
comment on table production.cloth_challan_line_extras is 'From Firebase: pt_flowChallans · lines · extras';

create table if not exists production.cloth_challan_receipts (
  id bigint generated always as identity primary key,
  "cloth_challan_id" bigint references production.cloth_challans (id),
  "receipt_key" text,
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "date" date,  -- date
  "note" text,  -- note
  "via" text  -- via
);
comment on table production.cloth_challan_receipts is 'From Firebase: pt_flowChallans · receipts';

create table if not exists production.cloth_challan_receipt_items (
  id bigint generated always as identity primary key,
  "cloth_challan_receipt_id" bigint references production.cloth_challan_receipts (id),
  "item_key" text,
  "qty" numeric,  -- qty
  "order_book_id" bigint references production.order_book (id)
);
comment on table production.cloth_challan_receipt_items is 'From Firebase: pt_flowChallans · receipts · items';

create table if not exists production.cloth_challan_moves (
  id bigint generated always as identity primary key,
  "cloth_challan_id" bigint references production.cloth_challans (id),
  "move_key" text,
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "fabric" text,  -- fabric
  "from_code" text,  -- from.code
  "from_name" text,  -- from.name
  "metres" numeric,  -- metres
  "order_no" text,  -- orderNo
  "settles" jsonb,  -- settles
  "sku" text,  -- sku
  "to_code" text,  -- to.code
  "to_name" text,  -- to.name
  "unit" text,  -- unit
  "why" text  -- why
);
comment on table production.cloth_challan_moves is 'From Firebase: pt_flowChallans · moved';

create table if not exists production.fabric_ready (
  id bigint generated always as identity primary key,
  "line_key" text,
  "fabric_ready_at" timestamptz,  -- fabricReady.at
  "fabric_ready_by" text,  -- fabricReady.by
  "fabric_ready_challan" text,  -- fabricReady.challan
  "fabric_ready_metres" numeric,  -- fabricReady.metres
  "fabric_ready_note" text,  -- fabricReady.note
  "fabric_ready_vendor" text,  -- fabricReady.vendor
  "fabric_ready_what" text,  -- fabricReady.what
  "order_book_id" bigint references production.order_book (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "cloth_challan_id" bigint references production.cloth_challans (id),
  "vendor_id" bigint references core.vendors (id),
  "fabric_id" bigint references core.fabrics (id)
);
comment on table production.fabric_ready is 'From Firebase: pt_flowDemand';

create table if not exists production.print_orders (
  id bigint generated always as identity primary key,
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "cancelled_at" timestamptz,  -- cancelled.at
  "cancelled_by" text,  -- cancelled.by
  "cancelled_why" text,  -- cancelled.why
  "date" date,  -- date
  "doc_no" text,  -- no
  "order_no" text,  -- orderNo
  "printer_code" text,  -- printer.code
  "printer_name" text,  -- printer.name
  "test" boolean,  -- test
  "vo_cut_code" text,  -- vo.cut.code
  "vo_cut_id" text,  -- vo.cut.id
  "vo_cut_order_no" text,  -- vo.cut.orderNo
  "vo_running_code" text,  -- vo.running.code
  "vo_running_id" text,  -- vo.running.id
  "vo_running_order_no" text,  -- vo.running.orderNo
  "vo_prog_cut_at" timestamptz,  -- voProg.cut.at
  "vo_prog_cut_sig" text,  -- voProg.cut.sig
  "vo_prog_running_at" timestamptz,  -- voProg.running.at
  "vo_prog_running_sig" text,  -- voProg.running.sig
  "vendor_id" bigint references core.vendors (id),
  "vendor_order_id" bigint references production.vendor_orders (id),
  "running_vendor_order_id" bigint references production.vendor_orders (id),
  "sales_order_id" bigint references sales.orders (id)
);
comment on table production.print_orders is 'From Firebase: pt_flowPrintOrders';

create table if not exists production.print_order_lines (
  id bigint generated always as identity primary key,
  "print_order_id" bigint references production.print_orders (id),
  "item_key" text,
  "item" text,  -- item
  "metres" numeric,  -- metres
  "pcs" numeric,  -- pcs
  "print_code" text,  -- print.code
  "print_kind" text,  -- print.kind
  "print_label" text,  -- print.label
  "print_mode" text,  -- print.mode
  "print_need_dir" boolean,  -- print.needDir
  "print_sides" jsonb,  -- print.sides
  "print_unit" text,  -- print.unit
  "rem" numeric,  -- rem
  "ruffle" boolean,  -- ruffle
  "sku" text,  -- sku
  "unit" text,  -- unit
  "order_book_id" bigint references production.order_book (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table production.print_order_lines is 'From Firebase: pt_flowPrintOrders · items';

create table if not exists production.print_order_line_extras (
  id bigint generated always as identity primary key,
  "print_order_line_id" bigint references production.print_order_lines (id),
  "extra_no" int,
  "code" text,  -- code
  "from_printed" numeric,  -- fromPrinted
  "kind" text,  -- kind
  "label" text,  -- label
  "metres" numeric,  -- metres
  "mode" text,  -- mode
  "total" numeric,  -- total
  "unit" text,  -- unit
  "what" text  -- what
);
comment on table production.print_order_line_extras is 'From Firebase: pt_flowPrintOrders · items · extras';

create table if not exists production.cutting (
  id bigint generated always as identity primary key,
  "added_at" timestamptz,  -- addedAt
  "added_by" text,  -- addedBy
  "article_subtype" text,  -- articleSubtype
  "article_type" text,  -- articleType
  "color" text,  -- color
  "cut_date" timestamptz,  -- cutDate
  "edited_at" timestamptz,  -- editedAt
  "edited_by" text,  -- editedBy
  "extra_pcs" numeric,  -- extraPcs
  "extra_reason" text,  -- extraReason
  "fabric_used" numeric,  -- fabricUsed
  "fabric_waste" numeric,  -- fabricWaste
  "fabric_width" text,  -- fabricWidth
  "fb_id" text,  -- id
  "last_edited_at" timestamptz,  -- lastEditedAt
  "last_edited_by" text,  -- lastEditedBy
  "legacy_was" text,  -- legacyWas
  "order_no" text,  -- orderNo
  "pieces" numeric,  -- pieces
  "remarks" text,  -- remarks
  "size" text,  -- size
  "sku" text,  -- sku
  "order_book_id" bigint references production.order_book (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "fabric_id" bigint references core.fabrics (id)
);
comment on table production.cutting is 'From Firebase: pt_cuttingData';

create table if not exists production.job_work (
  id bigint generated always as identity primary key,
  "place" text,
  "day_group" text,
  "added_at" timestamptz,  -- addedAt
  "added_by" text,  -- addedBy
  "article_subtype" text,  -- articleSubtype
  "article_type" text,  -- articleType
  "color" text,  -- color
  "corrected_by" text,  -- correctedBy
  "correction_id" text,  -- correctionId
  "cust_channel" text,  -- custChannel
  "cust_order" text,  -- custOrder
  "details_filled_at" timestamptz,  -- detailsFilledAt
  "details_filled_from" text,  -- detailsFilledFrom
  "edited_at" timestamptz,  -- editedAt
  "edited_by" text,  -- editedBy
  "emp_name" text,  -- empName
  "emp_type" text,  -- empType
  "extra_pcs" numeric,  -- extraPcs
  "extra_reason" text,  -- extraReason
  "frozen" boolean,  -- frozen
  "fb_id" text,  -- id
  "is_custom" boolean,  -- isCustom
  "issue_date" timestamptz,  -- issueDate
  "issue_pieces" numeric,  -- issuePieces
  "last_edited_at" timestamptz,  -- lastEditedAt
  "last_edited_by" text,  -- lastEditedBy
  "order_no" text,  -- orderNo
  "pending_pieces" numeric,  -- pendingPieces
  "received_pieces" numeric,  -- receivedPieces
  "receiving_date" timestamptz,  -- receivingDate
  "rejection_pieces" numeric,  -- rejectionPieces
  "remarks" text,  -- remarks
  "ruffle_fabric_used" text,  -- ruffleFabricUsed
  "shop_order_no" text,  -- shopOrderNo
  "size" text,  -- size
  "sku" text,  -- sku
  "src" text,  -- src
  "wa_issue_sent_at" timestamptz,  -- waIssueSentAt
  "wa_issue_sent_by" text,  -- waIssueSentBy
  "wa_recv_sent_at" timestamptz,  -- waRecvSentAt
  "wa_recv_sent_by" text,  -- waRecvSentBy
  "zips_issued" numeric,  -- zipsIssued
  "worker_id" bigint references hr.workers (id),
  "order_book_id" bigint references production.order_book (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "link_note" text
);
comment on table production.job_work is 'From Firebase: pt_baseData (open) + pt_baseDone (completed)';

create table if not exists production.job_work_receipts (
  id bigint generated always as identity primary key,
  "job_work_id" bigint references production.job_work (id),
  "receipt_no" int,
  "at_time" timestamptz,  -- at
  "from_place" text,  -- from
  "qty" numeric,  -- qty
  "via" text  -- via
);
comment on table production.job_work_receipts is 'From Firebase: pt_baseData / pt_baseDone · receipts';

create table if not exists production.qc_checks (
  id bigint generated always as identity primary key,
  "added_at" timestamptz,  -- addedAt
  "added_by" text,  -- addedBy
  "article_type" text,  -- articleType
  "base_id" text,  -- baseId
  "brand" text,  -- brand
  "checked" numeric,  -- checked
  "checked_by" text,  -- checkedBy
  "color" text,  -- color
  "date" timestamptz,  -- date
  "dept" text,  -- dept
  "edited_at" timestamptz,  -- editedAt
  "edited_by" text,  -- editedBy
  "fg_reject" numeric,  -- fgReject
  "for_alteration" numeric,  -- forAlteration
  "from_place" text,  -- from
  "fb_id" text,  -- id
  "karigar" text,  -- karigar
  "ok" numeric,  -- ok
  "order_no" text,  -- orderNo
  "ref_id" text,  -- refId
  "rejected" numeric,  -- rejected
  "remarks" text,  -- remarks
  "size" text,  -- size
  "sku" text,  -- sku
  "spotting" numeric,  -- spotting
  "subtype" text,  -- subtype
  "job_work_id" bigint references production.job_work (id),
  "karigar_worker_id" bigint references hr.workers (id),
  "checked_by_worker_id" bigint references hr.workers (id),
  "order_book_id" bigint references production.order_book (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "link_note" text
);
comment on table production.qc_checks is 'From Firebase: pt_qcChecks';

create table if not exists production.qc_rework_out (
  id bigint generated always as identity primary key,
  "added_at" timestamptz,  -- addedAt
  "added_by" text,  -- addedBy
  "article_type" text,  -- articleType
  "brand" text,  -- brand
  "color" text,  -- color
  "date" timestamptz,  -- date
  "edited_at" timestamptz,  -- editedAt
  "edited_by" text,  -- editedBy
  "employee" text,  -- employee
  "employment_type" text,  -- employmentType
  "fb_id" text,  -- id
  "pieces" numeric,  -- pieces
  "remarks" text,  -- remarks
  "size" text,  -- size
  "sku" text,  -- sku
  "subtype" text,  -- subtype
  "worker_id" bigint references hr.workers (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "link_note" text
);
comment on table production.qc_rework_out is 'From Firebase: pt_qcIssuance';

create table if not exists production.qc_rework_back (
  id bigint generated always as identity primary key,
  "added_at" timestamptz,  -- addedAt
  "added_by" text,  -- addedBy
  "article_type" text,  -- articleType
  "brand" text,  -- brand
  "color" text,  -- color
  "date" timestamptz,  -- date
  "employee" text,  -- employee
  "employment_type" text,  -- employmentType
  "fb_id" text,  -- id
  "issuance_id" text,  -- issuanceId
  "received" numeric,  -- received
  "received_by" text,  -- receivedBy
  "remarks" text,  -- remarks
  "reworked_ok" numeric,  -- reworkedOk
  "size" text,  -- size
  "sku" text,  -- sku
  "still_rejected" numeric,  -- stillRejected
  "subtype" text,  -- subtype
  "qc_rework_out_id" bigint references production.qc_rework_out (id),
  "worker_id" bigint references hr.workers (id),
  "received_by_worker_id" bigint references hr.workers (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "link_note" text
);
comment on table production.qc_rework_back is 'From Firebase: pt_qcReturns';

create table if not exists production.fg_sends (
  id bigint generated always as identity primary key,
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "fg_id" text,  -- fgId
  "note" text,  -- note
  "order_no" text,  -- orderNo
  "pcs" numeric,  -- pcs
  "sku" text,  -- sku
  "status" text,  -- status
  "why" text,  -- why
  "fg_ledger_id" bigint references stock.fg_ledger (id),
  "order_book_id" bigint references production.order_book (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table production.fg_sends is 'From Firebase: pt_flowFgSend';

create table if not exists production.shopify_board_press (
  id bigint generated always as identity primary key,
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "date" date,  -- date
  "fb_id" text,  -- id
  "order_no" text,  -- orderNo
  "pieces" numeric,  -- pieces
  "pressman" text,  -- pressman
  "sku" text,  -- sku
  "worker_id" bigint references hr.workers (id),
  "sales_order_id" bigint references sales.orders (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id),
  "link_note" text
);
comment on table production.shopify_board_press is 'From Firebase: pt_shpBoardPress';

create table if not exists production.shopify_board_status (
  id bigint generated always as identity primary key,
  "line_key" text,
  "at_time" timestamptz,  -- at
  "by_email" text,  -- by
  "fill_code" text,  -- fill.code
  "fill_name" text,  -- fill.name
  "order_no" text,  -- orderNo
  "sku" text,  -- sku
  "status" text,  -- status
  "sales_order_id" bigint references sales.orders (id),
  "sku_id" bigint references core.skus (id),
  "custom_sku_id" bigint references core.custom_skus (id)
);
comment on table production.shopify_board_status is 'From Firebase: pt_shpBoardTest';

do $$ declare t text; begin
  foreach t in array array['production.ppc_plans','production.ppc_plan_items','production.print_blocks','production.cloth_challans','production.cloth_challan_lines','production.cloth_challan_line_extras','production.cloth_challan_receipts','production.cloth_challan_receipt_items','production.cloth_challan_moves','production.fabric_ready','production.print_orders','production.print_order_lines','production.print_order_line_extras','production.cutting','production.job_work','production.job_work_receipts','production.qc_checks','production.qc_rework_out','production.qc_rework_back','production.fg_sends','production.shopify_board_press','production.shopify_board_status'] loop
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
grant usage, select on all sequences in schema production to service_role;
create index if not exists ppc_plans_order_book on production.ppc_plans (order_book_id);
create index if not exists ppc_plans_sku on production.ppc_plans (sku_id);
create index if not exists ppc_plans_custom_sku on production.ppc_plans (custom_sku_id);
create index if not exists ppc_plans_fabric on production.ppc_plans (fabric_id);
create index if not exists ppc_plans_printer_vendor on production.ppc_plans (printer_vendor_id);
create index if not exists ppc_plans_ruffle_vendor on production.ppc_plans (ruffle_vendor_id);
create index if not exists ppc_plans_out_vendor on production.ppc_plans (out_vendor_id);
create index if not exists ppc_plan_items_parent on production.ppc_plan_items (ppc_plan_id);
create index if not exists ppc_plan_items_accessory on production.ppc_plan_items (accessory_id);
create index if not exists print_blocks_vendor on production.print_blocks (vendor_id);
create index if not exists cloth_challans_vendor on production.cloth_challans (vendor_id);
create index if not exists cloth_challans_sales_order on production.cloth_challans (sales_order_id);
create index if not exists cloth_challan_lines_parent on production.cloth_challan_lines (cloth_challan_id);
create index if not exists cloth_challan_lines_order_book on production.cloth_challan_lines (order_book_id);
create index if not exists cloth_challan_lines_sku on production.cloth_challan_lines (sku_id);
create index if not exists cloth_challan_lines_custom_sku on production.cloth_challan_lines (custom_sku_id);
create index if not exists cloth_challan_lines_fabric on production.cloth_challan_lines (fabric_id);
create index if not exists cloth_challan_line_extras_parent on production.cloth_challan_line_extras (cloth_challan_line_id);
create index if not exists cloth_challan_receipts_parent on production.cloth_challan_receipts (cloth_challan_id);
create index if not exists cloth_challan_receipt_items_parent on production.cloth_challan_receipt_items (cloth_challan_receipt_id);
create index if not exists cloth_challan_receipt_items_order_book on production.cloth_challan_receipt_items (order_book_id);
create index if not exists cloth_challan_moves_parent on production.cloth_challan_moves (cloth_challan_id);
create index if not exists fabric_ready_order_book on production.fabric_ready (order_book_id);
create index if not exists fabric_ready_sku on production.fabric_ready (sku_id);
create index if not exists fabric_ready_custom_sku on production.fabric_ready (custom_sku_id);
create index if not exists fabric_ready_cloth_challan on production.fabric_ready (cloth_challan_id);
create index if not exists fabric_ready_vendor on production.fabric_ready (vendor_id);
create index if not exists fabric_ready_fabric on production.fabric_ready (fabric_id);
create index if not exists print_orders_vendor on production.print_orders (vendor_id);
create index if not exists print_orders_vendor_order on production.print_orders (vendor_order_id);
create index if not exists print_orders_running_vendor_order on production.print_orders (running_vendor_order_id);
create index if not exists print_orders_sales_order on production.print_orders (sales_order_id);
create index if not exists print_order_lines_parent on production.print_order_lines (print_order_id);
create index if not exists print_order_lines_order_book on production.print_order_lines (order_book_id);
create index if not exists print_order_lines_sku on production.print_order_lines (sku_id);
create index if not exists print_order_lines_custom_sku on production.print_order_lines (custom_sku_id);
create index if not exists print_order_line_extras_parent on production.print_order_line_extras (print_order_line_id);
create index if not exists cutting_order_book on production.cutting (order_book_id);
create index if not exists cutting_sku on production.cutting (sku_id);
create index if not exists cutting_custom_sku on production.cutting (custom_sku_id);
create index if not exists cutting_fabric on production.cutting (fabric_id);
create index if not exists job_work_worker on production.job_work (worker_id);
create index if not exists job_work_order_book on production.job_work (order_book_id);
create index if not exists job_work_sku on production.job_work (sku_id);
create index if not exists job_work_custom_sku on production.job_work (custom_sku_id);
create index if not exists job_work_receipts_parent on production.job_work_receipts (job_work_id);
create index if not exists qc_checks_job_work on production.qc_checks (job_work_id);
create index if not exists qc_checks_karigar_worker on production.qc_checks (karigar_worker_id);
create index if not exists qc_checks_checked_by_worker on production.qc_checks (checked_by_worker_id);
create index if not exists qc_checks_order_book on production.qc_checks (order_book_id);
create index if not exists qc_checks_sku on production.qc_checks (sku_id);
create index if not exists qc_checks_custom_sku on production.qc_checks (custom_sku_id);
create index if not exists qc_rework_out_worker on production.qc_rework_out (worker_id);
create index if not exists qc_rework_out_sku on production.qc_rework_out (sku_id);
create index if not exists qc_rework_out_custom_sku on production.qc_rework_out (custom_sku_id);
create index if not exists qc_rework_back_qc_rework_out on production.qc_rework_back (qc_rework_out_id);
create index if not exists qc_rework_back_worker on production.qc_rework_back (worker_id);
create index if not exists qc_rework_back_received_by_worker on production.qc_rework_back (received_by_worker_id);
create index if not exists qc_rework_back_sku on production.qc_rework_back (sku_id);
create index if not exists qc_rework_back_custom_sku on production.qc_rework_back (custom_sku_id);
create index if not exists fg_sends_fg_ledger on production.fg_sends (fg_ledger_id);
create index if not exists fg_sends_order_book on production.fg_sends (order_book_id);
create index if not exists fg_sends_sku on production.fg_sends (sku_id);
create index if not exists fg_sends_custom_sku on production.fg_sends (custom_sku_id);
create index if not exists shopify_board_press_worker on production.shopify_board_press (worker_id);
create index if not exists shopify_board_press_sales_order on production.shopify_board_press (sales_order_id);
create index if not exists shopify_board_press_sku on production.shopify_board_press (sku_id);
create index if not exists shopify_board_press_custom_sku on production.shopify_board_press (custom_sku_id);
create index if not exists shopify_board_status_sales_order on production.shopify_board_status (sales_order_id);
create index if not exists shopify_board_status_sku on production.shopify_board_status (sku_id);
create index if not exists shopify_board_status_custom_sku on production.shopify_board_status (custom_sku_id);

-- ===================================================================== doors (server key; the fingerprint door also for the test ERP)
create or replace function core.production_tables() returns text[] language sql immutable as $$ select array['production.ppc_plans','production.ppc_plan_items','production.print_blocks','production.cloth_challans','production.cloth_challan_lines','production.cloth_challan_line_extras','production.cloth_challan_receipts','production.cloth_challan_receipt_items','production.cloth_challan_moves','production.fabric_ready','production.print_orders','production.print_order_lines','production.print_order_line_extras','production.cutting','production.job_work','production.job_work_receipts','production.qc_checks','production.qc_rework_out','production.qc_rework_back','production.fg_sends','production.shopify_board_press','production.shopify_board_status'] $$;
create or replace function core.load_production_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare cols text; sets text; n int;
begin
  if not (p_table = any (core.production_tables())) then raise exception 'load_production_rows: % is not a Production table', p_table; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  perform set_config('core.loading', 'on', true);
  select string_agg(quote_ident(k), ', '), string_agg(format('%1$I = excluded.%1$I', k), ', ') filter (where k <> 'legacy_key')
    into cols, sets from jsonb_object_keys(p_rows -> 0) k;
  execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)
                  on conflict (legacy_key) where legacy_key is not null do update set %s', p_table, cols, cols, p_table, sets) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.load_production_rows(text, jsonb) from public, anon, authenticated;
grant execute on function core.load_production_rows(text, jsonb) to service_role;

insert into core.settings (key, value, note) values ('sync.production_backup', '"2026-11-12"', 'Which Firebase backup the Production copy is from')
on conflict (key) do update set value = excluded.value;

-- every top Firebase record of the section: { path: fingerprint, … } — fingerprints only, never data
create or replace function core.production_fp() returns jsonb
language sql stable security definer set search_path = core, public as $$
  select case when core.me_id() is not null or auth.role() = 'service_role' or session_user = 'postgres' then (
    select coalesce(jsonb_object_agg(x.legacy_key, x.fp), '{}'::jsonb)
           || jsonb_build_object('#copy_of', (select st.value #>> '{}' from core.settings st where st.key = 'sync.production_backup'))
      from (select legacy_key, fp from production.ppc_plans
            union all select legacy_key, fp from production.print_blocks
            union all select legacy_key, fp from production.cloth_challans
            union all select legacy_key, fp from production.fabric_ready
            union all select legacy_key, fp from production.print_orders
            union all select legacy_key, fp from production.cutting
            union all select legacy_key, fp from production.job_work
            union all select legacy_key, fp from production.qc_checks
            union all select legacy_key, fp from production.qc_rework_out
            union all select legacy_key, fp from production.qc_rework_back
            union all select legacy_key, fp from production.fg_sends
            union all select legacy_key, fp from production.shopify_board_press
            union all select legacy_key, fp from production.shopify_board_status) x
     where x.legacy_key is not null and x.fp is not null) end
$$;
revoke all on function core.production_fp() from public;
grant execute on function core.production_fp() to anon, authenticated, service_role;

create or replace function core.production_summary() returns table (item text, n bigint, of_n bigint)
language sql stable security definer set search_path = core, public as $$
  select 'production.ppc_plans', count(*), null::bigint from production.ppc_plans
  union all select 'production.ppc_plan_items', count(*), null::bigint from production.ppc_plan_items
  union all select 'production.print_blocks', count(*), null::bigint from production.print_blocks
  union all select 'production.cloth_challans', count(*), null::bigint from production.cloth_challans
  union all select 'production.cloth_challan_lines', count(*), null::bigint from production.cloth_challan_lines
  union all select 'production.cloth_challan_line_extras', count(*), null::bigint from production.cloth_challan_line_extras
  union all select 'production.cloth_challan_receipts', count(*), null::bigint from production.cloth_challan_receipts
  union all select 'production.cloth_challan_receipt_items', count(*), null::bigint from production.cloth_challan_receipt_items
  union all select 'production.cloth_challan_moves', count(*), null::bigint from production.cloth_challan_moves
  union all select 'production.fabric_ready', count(*), null::bigint from production.fabric_ready
  union all select 'production.print_orders', count(*), null::bigint from production.print_orders
  union all select 'production.print_order_lines', count(*), null::bigint from production.print_order_lines
  union all select 'production.print_order_line_extras', count(*), null::bigint from production.print_order_line_extras
  union all select 'production.cutting', count(*), null::bigint from production.cutting
  union all select 'production.job_work', count(*), null::bigint from production.job_work
  union all select 'production.job_work_receipts', count(*), null::bigint from production.job_work_receipts
  union all select 'production.qc_checks', count(*), null::bigint from production.qc_checks
  union all select 'production.qc_rework_out', count(*), null::bigint from production.qc_rework_out
  union all select 'production.qc_rework_back', count(*), null::bigint from production.qc_rework_back
  union all select 'production.fg_sends', count(*), null::bigint from production.fg_sends
  union all select 'production.shopify_board_press', count(*), null::bigint from production.shopify_board_press
  union all select 'production.shopify_board_status', count(*), null::bigint from production.shopify_board_status
  union all select 'link · ppc_plans → order line', count(*) filter (where order_book_id is not null), count(*) from production.ppc_plans
  union all select 'link · ppc_plans → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from production.ppc_plans
  union all select 'link · ppc_plans → fabric', count(*) filter (where fabric_id is not null), count(*) filter (where coalesce(trim("fabric_name"), '') <> '') from production.ppc_plans
  union all select 'link · ppc_plans → printer', count(*) filter (where printer_vendor_id is not null), count(*) filter (where coalesce(trim("printer_code"), '') <> '') from production.ppc_plans
  union all select 'link · fabric_ready → order line', count(*) filter (where order_book_id is not null), count(*) from production.fabric_ready
  union all select 'link · fabric_ready → challan', count(*) filter (where cloth_challan_id is not null), count(*) from production.fabric_ready
  union all select 'link · cloth_challan_lines → order line', count(*) filter (where order_book_id is not null), count(*) from production.cloth_challan_lines
  union all select 'link · cloth_challan_lines → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from production.cloth_challan_lines
  union all select 'link · print_orders → vendor order', count(*) filter (where vendor_order_id is not null), count(*) filter (where "vo_cut_id" is not null) from production.print_orders
  union all select 'link · print_order_lines → order line', count(*) filter (where order_book_id is not null), count(*) from production.print_order_lines
  union all select 'link · cutting → order line', count(*) filter (where order_book_id is not null), count(*) from production.cutting
  union all select 'link · cutting → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from production.cutting
  union all select 'link · cutting → fabric', count(*) filter (where fabric_id is not null), count(*) filter (where coalesce(trim("fabric_width"), '') <> '') from production.cutting
  union all select 'link · job_work → worker', count(*) filter (where worker_id is not null), count(*) from production.job_work
  union all select 'link · job_work → order line', count(*) filter (where order_book_id is not null), count(*) from production.job_work
  union all select 'link · job_work → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from production.job_work
  union all select 'link · qc_checks → job work', count(*) filter (where job_work_id is not null), count(*) filter (where "base_id" is not null) from production.qc_checks
  union all select 'link · qc_checks → worker (karigar)', count(*) filter (where karigar_worker_id is not null), count(*) filter (where coalesce(trim("karigar"), '') <> '') from production.qc_checks
  union all select 'link · qc_checks → worker (checked by)', count(*) filter (where checked_by_worker_id is not null), count(*) from production.qc_checks
  union all select 'link · qc_checks → SKU', count(*) filter (where coalesce(sku_id, custom_sku_id) is not null), count(*) from production.qc_checks
  union all select 'link · qc_rework_out → worker', count(*) filter (where worker_id is not null), count(*) from production.qc_rework_out
  union all select 'link · qc_rework_back → rework out', count(*) filter (where qc_rework_out_id is not null), count(*) from production.qc_rework_back
  union all select 'link · fg_sends → FG stock line', count(*) filter (where fg_ledger_id is not null), count(*) from production.fg_sends
  union all select 'link · fg_sends → order line', count(*) filter (where order_book_id is not null), count(*) from production.fg_sends
  union all select 'link · shopify_board_press → worker', count(*) filter (where worker_id is not null), count(*) from production.shopify_board_press
  union all select 'link · shopify_board_status → Shopify order', count(*) filter (where sales_order_id is not null), count(*) from production.shopify_board_status
  union all select 'marked rows (a name not linked to a worker)', (select count(*) from production.job_work where link_note is not null) + (select count(*) from production.qc_checks where link_note is not null)
                 + (select count(*) from production.qc_rework_out where link_note is not null) + (select count(*) from production.qc_rework_back where link_note is not null)
                 + (select count(*) from production.shopify_board_press where link_note is not null), null
$$;
revoke all on function core.production_summary() from public, anon, authenticated;
grant execute on function core.production_summary() to service_role;

create or replace function core.production_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare r text; q bigint; c1 bigint; fp_ok boolean;
begin
  fp_ok := jsonb_typeof(core.production_fp()) = 'object';      -- asked first: the sign-in test below clears who is calling
  create temp table if not exists _p (n int, check_name text, result text);
  truncate _p;
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.prodcheck@ridhi.test', 'T Prod Check', (select id from core.roles where code = 'qc')) returning id into q;
    perform core.sign_in_as_test('t.prodcheck@ridhi.test');
    insert into production.cutting ("sku", "pieces") values ('TEST-SKU', 1) returning id into c1;
    begin delete from production.cutting where id = c1; r := 'FAIL: a non-admin deleted a cutting entry';
    exception when others then if sqlerrm like 'Only an admin can delete%' then r := 'PASS'; else r := 'FAIL: ' || sqlerrm; end if; end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _p values (20, 'any ERP person may add a production entry · only an admin deletes', r);
  perform set_config('request.jwt.claims', '', true);
  return query select x.n, x.check_name, x.result from (
    select 1 as n, 'all 22 Production tables exist, each keeps the Firebase record and fingerprint' as check_name,
           case when (select count(*) from information_schema.columns where column_name = 'fp' and table_schema || '.' || table_name = any (core.production_tables())) = 22
                 and (select count(*) from information_schema.columns where column_name = 'firebase' and table_schema || '.' || table_name = any (core.production_tables())) = 22 then 'PASS' else 'FAIL' end as result
    union all select 2, 'rules, stamps and the change log on all 22',
           case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
                       where t.tgname in ('zz_log', 'sku_side_rules', 'aa_fp') and s.nspname || '.' || c.relname = any (core.production_tables())) = 66 then 'PASS' else 'FAIL' end
    union all select 3, 'browsers can read none of them',
           case when not exists (select 1 from unnest(core.production_tables()) t where has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select')) then 'PASS' else 'FAIL' end
    union all select 4, 'browsers cannot use the load door; the fingerprint door gives fingerprints only',
           case when not has_function_privilege('anon', 'core.load_production_rows(text,jsonb)', 'execute')
                 and not has_function_privilege('authenticated', 'core.load_production_rows(text,jsonb)', 'execute') and fp_ok then 'PASS' else 'FAIL' end
    union all select 5, 'no test rows left behind', case when not exists (select 1 from core.people where email like '%@ridhi.test') then 'PASS' else 'FAIL' end
    union all select p.n, p.check_name, p.result from _p p
  ) x order by x.n;
end $fn$;
revoke all on function core.production_checks() from public, anon, authenticated;
grant execute on function core.production_checks() to service_role;

notify pgrst, 'reload schema';
select * from core.production_checks();


-- ############################################################ leftovers.sql
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


-- ############################################################ history.sql
-- =====================================================================================
-- SECTION 10 · HISTORY — schema history: the ERP's change log (pt_audit) and recycle bin (pt_trash), as they are.
-- Ravi, 13 Nov: design page migration/history-design.html, D1–D5 all OK.
--   history.audit_entries  one row per save (pt_audit/<month>/<id>) — the Firebase record whole in `firebase`
--   history.audit_changes  one row per record that save changed: its path, and the value written (= `firebase`)
--   history.recycle_bin    one row per deleted record (pt_trash/<id>)
-- The history of any moved row = audit_changes where path = that row's legacy_key.
-- NEEDS: core (access, control).  WHERE: ERP TEST (Mumbai).  HOW: paste the WHOLE file → Run. Safe to run again.
-- CHECK: the last result is a list of checks — every row must say PASS.  Then: Data API → Exposed schemas → tick "history".
-- DATA: loaded from Ravi's PC by migration/tools/load-history.js (rows built by make-history.js).
-- =====================================================================================

create schema if not exists history;
revoke all on schema history from public, anon, authenticated;
grant usage on schema history to service_role;
alter default privileges in schema history revoke all on tables from anon, authenticated;
alter default privileges in schema history grant all on tables to service_role;
alter default privileges in schema history grant all on sequences to service_role;

create table if not exists history.audit_entries (
  id          bigint generated always as identity primary key,
  month       text,          -- the month key in Firebase (2026-10)
  entry_id    text,          -- the entry key
  at_time     timestamptz,   -- at
  by_email    text,          -- by (as written)
  tab         text,          -- tab: the ERP screen
  kind        text,          -- kind: put / patch / delete
  n           numeric,       -- n: how many paths
  note        text,          -- note
  paths       jsonb,         -- paths, as written (the values are in history.audit_changes)
  person_id   bigint references core.people (id),
  mark        text           -- D3: "paths and values not the same length" …
);
comment on table history.audit_entries is 'From Firebase: pt_audit — one row per ERP save. The whole Firebase record (with its values) is in column firebase.';

create table if not exists history.audit_changes (
  id              bigint generated always as identity primary key,
  audit_entry_id  bigint references history.audit_entries (id),
  place           int,       -- place in paths / vals
  path            text,      -- the Firebase path that was written (= legacy_key of the moved row)
  list            text,      -- its list (e.g. pt_baseDone)
  mark            text       -- D3: "value too big — the ERP kept its size only" · "no value at this place"
);
comment on table history.audit_changes is 'From Firebase: pt_audit · paths + vals — one row per record a save changed; the value written is in column firebase.';

create table if not exists history.recycle_bin (
  id           bigint generated always as identity primary key,
  trash_id     text,         -- the bin key
  at_time      timestamptz,  -- at
  by_email     text,         -- by
  tab          text,         -- tab
  why          text,         -- why: patch / delete
  path         text,         -- path of the deleted record
  list         text,         -- its list
  value        jsonb,        -- value: the deleted record as it was
  restored_at  timestamptz,  -- restoredAt
  restored_by  text,         -- restoredBy
  person_id    bigint references core.people (id)
);
comment on table history.recycle_bin is 'From Firebase: pt_trash — every record deleted in the ERP, as it was just before.';

do $$ declare t text; begin
  foreach t in array array['history.audit_entries', 'history.audit_changes', 'history.recycle_bin'] loop
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
grant usage, select on all sequences in schema history to service_role;
create index if not exists audit_entries_at on history.audit_entries (at_time);
create index if not exists audit_entries_by on history.audit_entries (by_email);
create index if not exists audit_changes_entry on history.audit_changes (audit_entry_id);
create index if not exists audit_changes_path on history.audit_changes (path);
create index if not exists audit_changes_list on history.audit_changes (list);
create index if not exists recycle_bin_path on history.recycle_bin (path);

-- ===================================================================== doors (server key; the fingerprint door also for the test ERP)
create or replace function core.history_tables() returns text[] language sql immutable as $$ select array['history.audit_entries', 'history.audit_changes', 'history.recycle_bin'] $$;
create or replace function core.load_history_rows(p_table text, p_rows jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare cols text; sets text; n int;
begin
  if not (p_table = any (core.history_tables())) then raise exception 'load_history_rows: % is not a History table', p_table; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return 0; end if;
  perform set_config('core.loading', 'on', true);
  select string_agg(quote_ident(k), ', '), string_agg(format('%1$I = excluded.%1$I', k), ', ') filter (where k <> 'legacy_key')
    into cols, sets from jsonb_object_keys(p_rows -> 0) k;
  execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)
                  on conflict (legacy_key) where legacy_key is not null do update set %s', p_table, cols, cols, p_table, sets) using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function core.load_history_rows(text, jsonb) from public, anon, authenticated;
grant execute on function core.load_history_rows(text, jsonb) to service_role;

insert into core.settings (key, value, note) values ('sync.history_backup', '"2026-11-12"', 'Which Firebase backup the History copy is from')
on conflict (key) do update set value = excluded.value;

-- fingerprints of the log entries and the bin, one answer { path: fp } — fingerprints only, never data
create or replace function core.history_fp() returns jsonb
language sql stable security definer set search_path = core, public as $$
  select case when core.me_id() is not null or auth.role() = 'service_role' or session_user = 'postgres' then (
    select coalesce(jsonb_object_agg(x.legacy_key, x.fp), '{}'::jsonb)
           || jsonb_build_object('#copy_of', (select st.value #>> '{}' from core.settings st where st.key = 'sync.history_backup'))
      from (select legacy_key, fp from history.audit_entries union all select legacy_key, fp from history.recycle_bin) x
     where x.legacy_key is not null and x.fp is not null) end
$$;
revoke all on function core.history_fp() from public;
grant execute on function core.history_fp() to anon, authenticated, service_role;

-- the history of one record: every save that wrote it, newest first (for later read doors and the check page)
create or replace function core.history_of(p_path text) returns table (at_time timestamptz, by_email text, tab text, kind text, path text, value jsonb)
language sql stable security definer set search_path = core, public as $$
  select e.at_time, e.by_email, e.tab, e.kind, c.path, c.firebase
    from history.audit_changes c join history.audit_entries e on e.id = c.audit_entry_id
   where c.path = p_path or c.path like p_path || '/%' or p_path like c.path || '/%'
   order by e.at_time desc
$$;
revoke all on function core.history_of(text) from public, anon, authenticated;
grant execute on function core.history_of(text) to service_role;

create or replace function core.history_summary() returns table (item text, n bigint, of_n bigint)
language sql stable security definer set search_path = core, public as $$
  select 'history.audit_entries', count(*), null::bigint from history.audit_entries
  union all select 'history.audit_changes', count(*), null from history.audit_changes
  union all select 'history.recycle_bin', count(*), null from history.recycle_bin
  union all select 'link · log entry → person', count(*) filter (where person_id is not null), count(*) from history.audit_entries
  union all select 'link · change → its log entry', count(*) filter (where audit_entry_id is not null), count(*) from history.audit_changes
  union all select 'link · bin → person', count(*) filter (where person_id is not null), count(*) from history.recycle_bin
  union all select 'marked entries · marked changes', (select count(*) from history.audit_entries where mark is not null) + (select count(*) from history.audit_changes where mark is not null), null
$$;
revoke all on function core.history_summary() from public, anon, authenticated;
grant execute on function core.history_summary() to service_role;

create or replace function core.history_checks() returns table (n int, check_name text, result text)
language plpgsql security definer set search_path = core, public as $fn$
#variable_conflict use_column
declare r text; q bigint; c1 bigint; fp_ok boolean;
begin
  fp_ok := jsonb_typeof(core.history_fp()) = 'object';
  create temp table if not exists _h2 (n int, check_name text, result text);
  truncate _h2;
  r := 'FAIL';
  begin
    insert into core.people (email, name, role_id) values ('t.histcheck@ridhi.test', 'T Hist Check', (select id from core.roles where code = 'qc')) returning id into q;
    perform core.sign_in_as_test('t.histcheck@ridhi.test');
    insert into history.recycle_bin (trash_id, why) values ('test', 'delete') returning id into c1;
    begin delete from history.recycle_bin where id = c1; r := 'FAIL: a non-admin deleted history';
    exception when others then if sqlerrm like 'Only an admin can delete%' then r := 'PASS'; else r := 'FAIL: ' || sqlerrm; end if; end;
    raise exception 'undo';
  exception when others then if sqlerrm <> 'undo' then r := 'FAIL: ' || sqlerrm; end if;
  end;
  insert into _h2 values (20, 'only an admin can delete history', r);
  perform set_config('request.jwt.claims', '', true);
  return query select x.n, x.check_name, x.result from (
    select 1 as n, 'the history schema and its 3 tables exist, each keeps the Firebase record and fingerprint' as check_name,
           case when (select count(*) from information_schema.columns where column_name = 'fp' and table_schema || '.' || table_name = any (core.history_tables())) = 3 then 'PASS' else 'FAIL' end as result
    union all select 2, 'rules, stamps and the change log on all 3',
           case when (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
                       where t.tgname in ('zz_log', 'sku_side_rules', 'aa_fp') and s.nspname || '.' || c.relname = any (core.history_tables())) = 9 then 'PASS' else 'FAIL' end
    union all select 3, 'browsers can read none of them, nor use the history schema',
           case when not exists (select 1 from unnest(core.history_tables()) t where has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select'))
                 and not has_schema_privilege('anon', 'history', 'usage') and not has_schema_privilege('authenticated', 'history', 'usage') then 'PASS' else 'FAIL' end
    union all select 4, 'browsers cannot use the load door or the history-of-a-record door',
           case when not has_function_privilege('anon', 'core.load_history_rows(text,jsonb)', 'execute') and not has_function_privilege('authenticated', 'core.history_of(text)', 'execute') and fp_ok then 'PASS' else 'FAIL' end
    union all select 5, 'no test rows left behind', case when not exists (select 1 from core.people where email like '%@ridhi.test') then 'PASS' else 'FAIL' end
    union all select h.n, h.check_name, h.result from _h2 h
  ) x order by x.n;
end $fn$;
revoke all on function core.history_checks() from public, anon, authenticated;
grant execute on function core.history_checks() to service_role;

notify pgrst, 'reload schema';
select * from core.history_checks();


-- ############################################################ sellora.sql
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


-- ############################################################ sync_fps_areas.sql
-- LIVE MIRROR · the fingerprint list now also knows the planning and history areas (13 Nov: the 13-Nov reload of Leftovers
-- stopped on "planning.india_stock is not a section table"). Same function as in sync.sql / hr.sql. Safe to paste again.
create or replace function core.sync_fps(p_table text) returns jsonb
language plpgsql stable security definer set search_path = core, public as $$
declare s text; t text; has_fp boolean; has_fb boolean; r jsonb;
begin
  s := split_part(p_table, '.', 1); t := split_part(p_table, '.', 2);
  if s not in ('core', 'sales', 'production', 'shipping', 'archive', 'stock', 'hr', 'planning', 'history') or t = '' then raise exception 'sync_fps: % is not a section table', p_table; end if;
  if not exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'legacy_key') then
    raise exception 'sync_fps: % has no legacy_key', p_table; end if;
  has_fp := exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'fp');
  has_fb := exists (select 1 from information_schema.columns where table_schema = s and table_name = t and column_name = 'firebase');
  execute format('select coalesce(jsonb_object_agg(legacy_key, %s), ''{}''::jsonb) from %I.%I where legacy_key is not null',
                 case when has_fp then 'fp'
                      when has_fb then 'case when firebase is null then null else encode(sha256(convert_to(firebase::text, ''UTF8'')), ''hex'') end'
                      else 'null::text' end, s, t) into r;
  return r;
end $$;
revoke all on function core.sync_fps(text) from public, anon, authenticated;
grant execute on function core.sync_fps(text) to service_role;
notify pgrst, 'reload schema';
select case when jsonb_typeof(core.sync_fps('planning.india_stock')) = 'object' then 'PASS' else 'FAIL' end as planning_area_known;


-- ############################################################ fs_docs.sql
-- FIRESTORE LIVE COPY (Ravi, 14 Nov: "move everything which powered firebase … have the problem fixed").
-- Every Firestore document of BOTH Firebase projects — price-research-48ff3 (ERP + Sellora) and fabricrush-inventory (the
-- Inventory app) — kept here exactly as Firestore holds it, NEWEST version only (one row per document), kept up to date by
-- the Apps Script reader (migration/apps-script-reader). Nothing is ever deleted: a document Firestore no longer has gets
-- gone_at (and is cleared again if it comes back).
-- WHY: the nightly backup misses collections (repl, health, audit/costs, settings, dealrows, fba_*, shopify_cache …) and
-- the Inventory app's project is not backed up here at all. With this table every one of them is in Supabase, live, so
-- their sections can be designed and loaded from here (not from a backup), and nothing is lost when Firebase goes.
-- Only the newest version is kept (not a log): the Inventory app rewrites big chunks every 3 hours, a log would fill the
-- database. Who changed what stays in the inbox for the lists the engine builds.
create table if not exists core.fs_docs (
  project      text not null,                       -- price-research-48ff3 · fabricrush-inventory
  path         text not null,                       -- <collection>/<document id>
  coll         text not null,
  doc_id       text not null,
  value        jsonb,                               -- the document as plain JSON (as the backup is read by the loaders)
  update_time  timestamptz,                         -- Firestore's own update time of this version
  bytes        int,
  seen_at      timestamptz not null default now(),  -- when the reader last sent this version
  first_seen   timestamptz not null default now(),
  gone_at      timestamptz,                         -- Firestore no longer has it (the row stays)
  fp           text,
  primary key (project, path)
);
create index if not exists fs_docs_coll on core.fs_docs (project, coll);
comment on table core.fs_docs is 'Live copy of every Firestore document of both Firebase projects (newest version only), kept by the Apps Script reader. Rows are never deleted.';
alter table core.fs_docs enable row level security;            -- no browser reads or writes it (no policies)
revoke all on core.fs_docs from anon, authenticated;

-- the reader's door: newest versions in, vanished documents marked. Server key only.
create or replace function core.fs_docs_put(p_project text, p_docs jsonb) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int := 0; m int;
begin
  if p_project not in ('price-research-48ff3', 'fabricrush-inventory') then raise exception 'fs_docs_put: unknown project %', p_project; end if;
  if jsonb_typeof(p_docs) <> 'array' then raise exception 'fs_docs_put: docs must be a list'; end if;
  insert into core.fs_docs as d (project, path, coll, doc_id, value, update_time, bytes, fp)
  select p_project, x ->> 'p', split_part(x ->> 'p', '/', 1), substr(x ->> 'p', length(split_part(x ->> 'p', '/', 1)) + 2), x -> 'v',
         (x ->> 't')::timestamptz, octet_length((x -> 'v')::text), encode(sha256(convert_to((x -> 'v')::text, 'utf8')), 'hex')
    from jsonb_array_elements(p_docs) x where coalesce(x ->> 'k', 'put') = 'put' and coalesce(x ->> 'p', '') like '%/%'
  on conflict (project, path) do update set value = excluded.value, update_time = excluded.update_time, bytes = excluded.bytes,
     fp = excluded.fp, seen_at = now(), gone_at = null;
  get diagnostics n = row_count;
  update core.fs_docs d set gone_at = coalesce(d.gone_at, now())
    from jsonb_array_elements(p_docs) x where x ->> 'k' = 'delete' and d.project = p_project and d.path = x ->> 'p';
  get diagnostics m = row_count;
  return n + m;
end $$;
revoke all on function core.fs_docs_put(text, jsonb) from public, anon, authenticated;
grant execute on function core.fs_docs_put(text, jsonb) to service_role;

-- what the copy holds, per project and collection (to watch it, and to design the sections still to come)
create or replace function core.fs_docs_summary() returns table (project text, coll text, docs bigint, gone bigint, mb numeric, newest timestamptz, last_seen timestamptz)
language sql stable security definer set search_path = core, public as $$
  select project, coll, count(*) filter (where gone_at is null), count(*) filter (where gone_at is not null),
         round(sum(bytes) / 1e6, 2), max(update_time), max(seen_at)
    from core.fs_docs group by 1, 2 order by 1, 2
$$;
revoke all on function core.fs_docs_summary() from public, anon, authenticated;
grant execute on function core.fs_docs_summary() to service_role;

notify pgrst, 'reload schema';
select 1 as n, 'the copy table exists, browsers cannot read it' as check_name,
       case when to_regclass('core.fs_docs') is not null and not has_table_privilege('anon', 'core.fs_docs', 'select')
             and not has_table_privilege('authenticated', 'core.fs_docs', 'select') then 'PASS' else 'FAIL' end as result
union all select 2, 'only the server key can put documents in',
       case when not has_function_privilege('anon', 'core.fs_docs_put(text,jsonb)', 'execute')
             and not has_function_privilege('authenticated', 'core.fs_docs_put(text,jsonb)', 'execute') then 'PASS' else 'FAIL' end
union all select 3, 'how big the whole database is now (MB) — the free plan holds 500: ' || round(pg_database_size(current_database()) / 1e6)::text,
       case when pg_database_size(current_database()) < 400e6 then 'PASS' else 'FAIL' end;


-- the "loading" switch OFF before the checks (a file above set it for this whole paste)
select set_config('core.loading', 'off', true), set_config('core.loading', 'off', false);


-- ############################################################ every check of these sections (all must say PASS)
select 'Orders' as section, n, check_name, result from core.orders_checks()
union all select 'Stock', n, check_name, result from core.stock_checks()
union all select 'HR', n, check_name, result from core.hr_checks()
union all select 'Production', n, check_name, result from core.production_checks()
union all select 'Leftovers', n, check_name, result from core.leftovers_checks()
union all select 'History', n, check_name, result from core.history_checks()
union all select 'Sellora', n, check_name, result from core.sellora_checks()
union all select 'Live copy', 1, 'the copy table exists, browsers cannot read it', case when to_regclass('core.fs_docs') is not null and not has_table_privilege('anon', 'core.fs_docs', 'select') then 'PASS' else 'FAIL' end
order by 1, 2;
