-- EVERY PRODUCT, AND EVERYWHERE IT SHOWS (Ravi, 19 Nov). Paste into ERP data → SQL editor → Run. The last line must say PASS.
-- Read-only: adds views and functions, changes no data.
--
-- A product lives in two master tables: core.skus (normal SKUs, Firebase pt_masterDB) and core.custom_skus (custom SKUs,
-- pt_customSkus). 40 other tables point at it by sku_id / custom_sku_id (and keep the SKU code as written in "sku").
--
--   core.product_places              the 40 places a product shows: table, what it is, the ERP screen
--   core.products                    one row per product (normal + custom): what it is, picture, priority, FNSKU, Amazon
--   core.product_where('RTC632-5454') where that product shows: rows per place (linked by id, or by its code as written)
--   core.product_profile('RTC632-5454') everything in one answer (master record + every place + 3 example records each)
--   core.product_coverage()          for every place: rows, linked to a product, code written but not linked, removed
-- Deleted records (core.sync_gone) are never counted.

-- 1 · the places
create or replace view core.product_places as
select * from (values
  ('sales.order_lines',              'Sales order lines',            'Sales Orders'),
  ('sales.order_qty_changes',        'Quantity changes on orders',   'Sales Orders · history'),
  ('sales.order_removed_lines',      'Lines removed from orders',    'Sales Orders · history'),
  ('production.order_book',          'Order book (what to make)',    'Order Console'),
  ('production.vendor_order_lines',  'Vendor order lines',           'Vendor Orders'),
  ('production.vendor_rfd_requests', 'RFD requests to vendors',      'Vendor Orders · RFD'),
  ('production.vendor_sent',         'Sent to vendors',              'Vendor Portal'),
  ('production.vendor_challan_lines','Vendor challan lines',         'Vendor Portal · challans'),
  ('production.shop_floor',          'Shop production',              'Shop Production'),
  ('sales.amazon_po_lines',          'Amazon PO lines',              'Ongoing Purchase Orders'),
  ('shipping.box_items',             'Packing list box items',       'Packing List'),
  ('stock.fg_ledger',                'Finished-goods moves',         'Finished Goods · FBA Dispatch'),
  ('stock.press_stock',              'Press inventory',              'Press Inventory'),
  ('stock.accessory_reserve',        'Accessories reserved',         'Accessories'),
  ('stock.store_ledger',             'Store moves',                  'Store'),
  ('production.ppc_plans',           'PPC plan lines',               'PPC · Production flow'),
  ('production.cloth_challan_lines', 'Cloth challan lines',          'Production flow · challans'),
  ('production.fabric_ready',        'Fabric-ready demand',          'Production flow · demand'),
  ('production.print_order_lines',   'Print order lines',            'Production flow · print orders'),
  ('production.cutting',             'Cutting entries',              'Cutting Data'),
  ('production.job_work',            'Job work (open and done)',     'Job Work Register'),
  ('production.qc_checks',           'QC checks',                    'Quality Control'),
  ('production.qc_rework_out',       'Sent for alteration',          'Quality Control · alteration'),
  ('production.qc_rework_back',      'Back from alteration',         'Quality Control · alteration'),
  ('production.fg_sends',            'Sent to finished goods',       'Production flow · FG send'),
  ('production.shopify_board_press', 'Shopify board · press',        'SHP board'),
  ('production.shopify_board_status','Shopify board · status',       'SHP board'),
  ('sales.amazon_listings',          'Amazon listings',              'Listings'),
  ('sales.listing_alerts',           'Listing alerts',               'Listings · alerts'),
  ('sales.amazon_fee_history',       'Amazon fee history',           'Sellora · fees'),
  ('sales.shopify_import_items',     'Shopify import items',         'Shopify Orders · imports'),
  ('planning.india_stock',           'India stock snapshot',         'India Stock · Replenishment'),
  ('planning.amazon_stock',          'Amazon stock snapshot',        'Replenishment'),
  ('planning.amazon_fulfillable',    'Amazon fulfillable',           'Replenishment'),
  ('planning.stock_snapshot',        'Stock snapshot',               'Replenishment'),
  ('archive.repl_in_production',     'In production (old archive)',  'Archive'),
  ('sales.amazon_bsr',               'Best Seller Rank by week',     'Sellora · BSR'),
  ('sales.amazon_deals',             'Amazon deals',                 'Sellora · deals'),
  ('sales.sku_amazon_meta',          'Amazon notes per SKU',         'Sellora · Shopify Orders'),
  ('sales.b2b_images',               'B2B / custom-order images',    'Custom Orders')
) v (tbl, what, screen)
where to_regclass(v.tbl) is not null;

-- 2 · every product, one row each
create or replace view core.products as
with g as (select legacy_key from core.sync_gone where tbl = 'core.skus'),
     gc as (select legacy_key from core.sync_gone where tbl = 'core.custom_skus'),
     img as (select distinct on (upper(trim(sku))) upper(trim(sku)) k, nullif(image_url, '-') image_url from core.sku_images order by upper(trim(sku)), id desc),
     pri as (select distinct on (upper(trim(sku))) upper(trim(sku)) k, priority from core.sku_priority order by upper(trim(sku)), id desc),
     fn  as (select upper(trim(sku)) k, string_agg(distinct fnsku, ', ') fnsku from core.fnsku_list where sku is not null group by 1)
select 'normal'::text as kind, s.id, s.sku, s.brand, s.article_type, s.subtype, s.color, s.size, s.fabric, s.pack_of,
       s.asin, s.parent_asin, s.listing_status, s.manufacturer, s.pack_type, s.pack_material,
       coalesce(img.image_url, s.image_url) as image_url, pri.priority, fn.fnsku, s.inventory_valuation_price,
       s.added_at, s.added_by, s.code_clash
  from core.skus s
  left join img on img.k = upper(trim(s.sku)) left join pri on pri.k = upper(trim(s.sku)) left join fn on fn.k = upper(trim(s.sku))
 where not exists (select 1 from g where g.legacy_key = s.legacy_key)
union all
select 'custom', c.id, c.sku, c.brand, c.article_type, c.subtype, c.color, c.size, c.fabric, c.pack_of,
       null, null, null, null, null, null,
       coalesce(img.image_url, c.image_url), pri.priority, fn.fnsku, c.inventory_valuation_price,
       c.added_at, c.added_by, c.code_clash
  from core.custom_skus c
  left join img on img.k = upper(trim(c.sku)) left join pri on pri.k = upper(trim(c.sku)) left join fn on fn.k = upper(trim(c.sku))
 where not exists (select 1 from gc where gc.legacy_key = c.legacy_key);

-- does this table have this column?
create or replace function core.pp_has(p_tbl text, p_col text) returns boolean language sql stable as $$
  select exists (select 1 from information_schema.columns where table_schema = split_part(p_tbl, '.', 1) and table_name = split_part(p_tbl, '.', 2) and column_name = p_col)
$$;

-- who may ask: an ERP sign-in that may read the Master Database (vendors may not)
create or replace function core.pp_allowed() returns boolean language sql stable security definer set search_path = core, public as $$
  select auth.role() = 'service_role' or (core.me_email() is not null and coalesce(core.rt_may_read('pt_masterDB'), false))
$$;

-- 3 · where one product shows
create or replace function core.product_where(p_sku text)
returns table (screen text, place text, tbl text, rows bigint, by_link bigint, by_code_only bigint)
language plpgsql stable security definer set search_path = core, public as $$
declare pl record; nid bigint; cid bigint; k text := upper(trim(p_sku)); lnk text; cod text; q text; r record;
begin
  if not core.pp_allowed() then raise exception 'product_where: not allowed'; end if;
  select id into nid from core.products where kind = 'normal' and upper(trim(sku)) = k order by id limit 1;
  select id into cid from core.products where kind = 'custom' and upper(trim(sku)) = k order by id limit 1;
  for pl in select * from core.product_places loop
    -- linked by id (normal or custom), or only the code as written
    lnk := format('(t.sku_id = %s', coalesce(nid, -1)) || case when core.pp_has(pl.tbl, 'custom_sku_id') then format(' or t.custom_sku_id = %s)', coalesce(cid, -1)) else ')' end;
    cod := case when core.pp_has(pl.tbl, 'sku') then format('upper(trim(t.sku)) = %L', k) else 'false' end;
    q := format('select count(*) n, count(*) filter (where %1$s) l, count(*) filter (where not %1$s and %2$s) c from %3$s t where (%1$s or %2$s)%4$s',
      lnk, cod, pl.tbl,
      case when core.pp_has(pl.tbl, 'legacy_key') then format(' and not exists (select 1 from core.sync_gone g where g.tbl = %L and g.legacy_key = t.legacy_key)', pl.tbl) else '' end);
    execute q into r;
    if r.n > 0 then screen := pl.screen; place := pl.what; tbl := pl.tbl; rows := r.n; by_link := r.l; by_code_only := r.c; return next; end if;
  end loop;
end $$;

-- 4 · everything about one product, in one answer
create or replace function core.product_profile(p_sku text) returns jsonb
language plpgsql stable security definer set search_path = core, public as $$
declare k text := upper(trim(p_sku)); prod jsonb; places jsonb := '[]'::jsonb; w record; ex jsonb;
begin
  if not core.pp_allowed() then raise exception 'product_profile: not allowed'; end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.kind), '[]'::jsonb) into prod from core.products p where upper(trim(p.sku)) = k;
  for w in select * from core.product_where(p_sku) loop
    ex := null;
    if core.pp_has(w.tbl, 'firebase') and core.pp_has(w.tbl, 'sku') then
      execute format('select coalesce(jsonb_agg(x.firebase), ''[]'') from (select firebase from %s t where upper(trim(t.sku)) = %L order by t.id desc limit 3) x', w.tbl, k) into ex;
    end if;
    places := places || jsonb_build_object('screen', w.screen, 'place', w.place, 'table', w.tbl, 'rows', w.rows,
                                           'linked', w.by_link, 'code_only', w.by_code_only, 'examples', coalesce(ex, '[]'::jsonb));
  end loop;
  return jsonb_build_object('sku', p_sku, 'product', prod, 'shows_in', jsonb_array_length(places), 'places', places);
end $$;

-- 5 · for every place: how well it is linked to products
create or replace function core.product_coverage()
returns table (screen text, place text, tbl text, rows bigint, linked_normal bigint, linked_custom bigint, code_not_linked bigint, no_code bigint)
language plpgsql stable security definer set search_path = core, public as $$
declare pl record; r record; gone text;
begin
  if not core.pp_allowed() then raise exception 'product_coverage: not allowed'; end if;
  for pl in select * from core.product_places loop
    gone := case when core.pp_has(pl.tbl, 'legacy_key') then format(' where not exists (select 1 from core.sync_gone g where g.tbl = %L and g.legacy_key = t.legacy_key)', pl.tbl) else '' end;
    execute format('select count(*) n, count(*) filter (where t.sku_id is not null) a, %s b, %s c, %s d from %s t%s',
      case when core.pp_has(pl.tbl, 'custom_sku_id') then 'count(*) filter (where t.custom_sku_id is not null)' else '0' end,
      case when core.pp_has(pl.tbl, 'sku') then 'count(*) filter (where t.sku_id is null' || case when core.pp_has(pl.tbl, 'custom_sku_id') then ' and t.custom_sku_id is null' else '' end || ' and coalesce(trim(t.sku), '''') <> '''')' else '0' end,
      case when core.pp_has(pl.tbl, 'sku') then 'count(*) filter (where t.sku_id is null' || case when core.pp_has(pl.tbl, 'custom_sku_id') then ' and t.custom_sku_id is null' else '' end || ' and coalesce(trim(t.sku), '''') = '''')' else 'count(*) filter (where t.sku_id is null)' end,
      pl.tbl, gone) into r;
    screen := pl.screen; place := pl.what; tbl := pl.tbl; rows := r.n; linked_normal := r.a; linked_custom := r.b; code_not_linked := r.c; no_code := r.d;
    return next;
  end loop;
end $$;

revoke all on core.products, core.product_places from public, anon;
grant select on core.product_places to authenticated, service_role;
grant select on core.products to service_role;
revoke all on function core.product_where(text), core.product_profile(text), core.product_coverage(), core.pp_allowed(), core.pp_has(text, text) from public, anon;
grant execute on function core.product_where(text), core.product_profile(text), core.product_coverage() to authenticated, service_role;
grant execute on function core.pp_allowed(), core.pp_has(text, text) to authenticated, service_role;
notify pgrst, 'reload schema';

select (select count(*) from core.product_places) as places_found,
       (select count(*) from core.products where kind = 'normal') as normal_products,
       (select count(*) from core.products where kind = 'custom') as custom_products,
       case when (select count(*) from core.product_places) >= 35 and exists (select 1 from core.products)
            then 'PASS — every product and everywhere it shows can be read now' else 'FAIL' end as result;
