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
