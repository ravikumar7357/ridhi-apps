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
