-- =====================================================================================
-- Flowmerce · schema flowmerce · file 12 · Shopify orders job: one call saves a page of orders
--
-- The backend (Flowmerce-Sync) reads a page of orders from Shopify, turns each into the JSON shape below, and calls
--   flowmerce.ingest_shopify_orders(store_code, orders, sync_run_id)
-- ONCE per page. Everything for that page is saved in one transaction:
--   shop_order · order_line · fulfillment · fulfillment_line · fulfillment_event · shipment · tracking · raw_api_payload
-- Re-sending the same page is safe (every row has its Shopify id as the key).
-- Shopify's "delivered" is stored but NEVER marks delivery_confirmed; carrier data always wins over Shopify data.
--
-- Order JSON (keys = our column names; the backend maps Shopify's GraphQL answer):
--   { external_id, name, order_number, src_created_at, src_updated_at, processed_at, cancelled_at, cancel_reason, is_test,
--     financial_status, fulfillment_status, tags[], source_name, channel, landing_site, referring_site,
--     utm_source, utm_medium, utm_campaign, utm_content, utm_term, discount_codes[], shipping_method,
--     ship_city, ship_province, ship_country, customer_email_sha256, is_returning_customer,
--     currency, subtotal, discounts, shipping, tax, total, total_refunded,
--     presentment_currency, p_subtotal, p_discounts, p_shipping, p_tax, p_total, p_total_refunded,
--     is_reship, reship_of_order_name, note_done, raw,
--     lines: [{ external_id, product_external_id, variant_external_id, sku, title, variant_title, product_type, tags[],
--               quantity, unit_price, discount, fulfilled_quantity, currency }],
--     fulfillments: [{ external_id, status, display_status, service, carrier_name_raw, tracking_numbers[], tracking_urls[],
--               src_created_at, in_transit_at, estimated_delivery_at, delivered_at, src_updated_at,
--               lines: [{ line_external_id, quantity }],
--               events: [{ external_id, status, happened_at, message, city, province, country }] }] }
-- =====================================================================================

create or replace function flowmerce.ingest_shopify_orders(p_store text, p_orders jsonb, p_run uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ws uuid; st uuid;
  o jsonb; f jsonb; l jsonb; e jsonb;
  v_order uuid; fid uuid; shid uuid; lid uuid;
  v_carrier text; v_status text; v_step text; v_kind text; v_seq smallint;
  i int; num text; h text; last_h text;
  n_orders int := 0; n_lines int := 0; n_ful int := 0; n_track int := 0; n_raw int := 0;
begin
  select s.workspace_id, s.id into ws, st from flowmerce.store s where s.code = p_store and s.is_active;
  if st is null then raise exception 'unknown store %', p_store using errcode = '22023'; end if;
  perform set_config('flowmerce.actor', 'job:shopify.orders', true);

  for o in select * from jsonb_array_elements(coalesce(p_orders, '[]'::jsonb)) loop
    -- ---------------------------------------------------------------- order
    insert into flowmerce.shop_order as so (
      workspace_id, store_id, external_id, name, order_number, src_created_at, src_updated_at, processed_at,
      cancelled_at, cancel_reason, is_test, financial_status, fulfillment_status, tags, source_name, channel,
      landing_site, referring_site, utm_source, utm_medium, utm_campaign, utm_content, utm_term, discount_codes,
      shipping_method, ship_city, ship_province, ship_country, customer_email_sha256, is_returning_customer,
      currency, subtotal, discounts, shipping, tax, total, total_refunded,
      presentment_currency, p_subtotal, p_discounts, p_shipping, p_tax, p_total, p_total_refunded,
      is_reship, reship_of_order_name, note_done, synced_at)
    values (
      ws, st, o->>'external_id', o->>'name', (o->>'order_number')::bigint,
      (o->>'src_created_at')::timestamptz, (o->>'src_updated_at')::timestamptz, (o->>'processed_at')::timestamptz,
      (o->>'cancelled_at')::timestamptz, o->>'cancel_reason', coalesce((o->>'is_test')::boolean, false),
      o->>'financial_status', o->>'fulfillment_status',
      coalesce(array(select jsonb_array_elements_text(o->'tags')), '{}'), o->>'source_name', o->>'channel',
      o->>'landing_site', o->>'referring_site', o->>'utm_source', o->>'utm_medium', o->>'utm_campaign', o->>'utm_content', o->>'utm_term',
      coalesce(array(select jsonb_array_elements_text(o->'discount_codes')), '{}'),
      o->>'shipping_method', o->>'ship_city', o->>'ship_province', nullif(left(o->>'ship_country', 2), ''),
      o->>'customer_email_sha256', (o->>'is_returning_customer')::boolean,
      coalesce(o->>'currency', 'USD'),
      coalesce((o->>'subtotal')::numeric, 0), coalesce((o->>'discounts')::numeric, 0), coalesce((o->>'shipping')::numeric, 0),
      coalesce((o->>'tax')::numeric, 0), coalesce((o->>'total')::numeric, 0), coalesce((o->>'total_refunded')::numeric, 0),
      o->>'presentment_currency', (o->>'p_subtotal')::numeric, (o->>'p_discounts')::numeric, (o->>'p_shipping')::numeric,
      (o->>'p_tax')::numeric, (o->>'p_total')::numeric, (o->>'p_total_refunded')::numeric,
      coalesce((o->>'is_reship')::boolean, false), o->>'reship_of_order_name', coalesce((o->>'note_done')::boolean, false), now())
    on conflict (store_id, external_id) do update set
      name = excluded.name, order_number = excluded.order_number, src_created_at = excluded.src_created_at,
      src_updated_at = excluded.src_updated_at, processed_at = excluded.processed_at, cancelled_at = excluded.cancelled_at,
      cancel_reason = excluded.cancel_reason, is_test = excluded.is_test, financial_status = excluded.financial_status,
      fulfillment_status = excluded.fulfillment_status, tags = excluded.tags, source_name = excluded.source_name,
      channel = excluded.channel, landing_site = coalesce(excluded.landing_site, so.landing_site),
      referring_site = coalesce(excluded.referring_site, so.referring_site),
      utm_source = coalesce(excluded.utm_source, so.utm_source), utm_medium = coalesce(excluded.utm_medium, so.utm_medium),
      utm_campaign = coalesce(excluded.utm_campaign, so.utm_campaign), utm_content = coalesce(excluded.utm_content, so.utm_content),
      utm_term = coalesce(excluded.utm_term, so.utm_term), discount_codes = excluded.discount_codes,
      shipping_method = excluded.shipping_method, ship_city = excluded.ship_city, ship_province = excluded.ship_province,
      ship_country = excluded.ship_country,
      customer_email_sha256 = coalesce(excluded.customer_email_sha256, so.customer_email_sha256),
      is_returning_customer = coalesce(excluded.is_returning_customer, so.is_returning_customer),
      currency = excluded.currency, subtotal = excluded.subtotal, discounts = excluded.discounts, shipping = excluded.shipping,
      tax = excluded.tax, total = excluded.total, total_refunded = excluded.total_refunded,
      presentment_currency = excluded.presentment_currency, p_subtotal = excluded.p_subtotal, p_discounts = excluded.p_discounts,
      p_shipping = excluded.p_shipping, p_tax = excluded.p_tax, p_total = excluded.p_total, p_total_refunded = excluded.p_total_refunded,
      is_reship = excluded.is_reship, reship_of_order_name = excluded.reship_of_order_name, note_done = excluded.note_done,
      synced_at = now()
    where so.src_updated_at is null or excluded.src_updated_at is null or excluded.src_updated_at >= so.src_updated_at  -- newest wins
    returning so.id into v_order;

    if v_order is null then          -- an older copy arrived after a newer one: keep what we have, skip the rest
      continue;
    end if;
    n_orders := n_orders + 1;

    -- raw copy, only when the answer changed
    h := md5(coalesce(o->'raw', o)::text);
    select r.payload_hash into last_h from flowmerce.raw_api_payload r
     where r.store_id = st and r.stream = 'shopify.orders' and r.external_id = o->>'external_id'
     order by r.received_at desc limit 1;
    if last_h is distinct from h then
      insert into flowmerce.raw_api_payload (workspace_id, store_id, provider_code, stream, external_id, sync_run_id, payload_hash, payload, processed_at)
      values (ws, st, 'shopify', 'shopify.orders', o->>'external_id', p_run, h, coalesce(o->'raw', o), now());
      n_raw := n_raw + 1;
    end if;

    -- ---------------------------------------------------------------- lines
    for l in select * from jsonb_array_elements(coalesce(o->'lines', '[]'::jsonb)) loop
      insert into flowmerce.order_line as ol (
        workspace_id, store_id, order_id, external_id, product_external_id, variant_external_id, product_id, variant_id,
        sku, title, variant_title, product_type, tags, quantity, unit_price, discount, fulfilled_quantity, currency)
      values (
        ws, st, v_order, l->>'external_id', l->>'product_external_id', l->>'variant_external_id',
        (select p.id from flowmerce.product p where p.store_id = st and p.external_id = l->>'product_external_id'),
        (select v.id from flowmerce.variant v where v.store_id = st and v.external_id = l->>'variant_external_id'),
        nullif(l->>'sku', ''), coalesce(l->>'title', 'Item'), l->>'variant_title', l->>'product_type',
        coalesce(array(select jsonb_array_elements_text(l->'tags')), '{}'),
        coalesce((l->>'quantity')::int, 0), coalesce((l->>'unit_price')::numeric, 0), coalesce((l->>'discount')::numeric, 0),
        coalesce((l->>'fulfilled_quantity')::int, 0), coalesce(l->>'currency', o->>'currency', 'USD'))
      on conflict (store_id, external_id) do update set
        order_id = excluded.order_id, product_external_id = excluded.product_external_id, variant_external_id = excluded.variant_external_id,
        product_id = coalesce(excluded.product_id, ol.product_id), variant_id = coalesce(excluded.variant_id, ol.variant_id),
        sku = excluded.sku, title = excluded.title, variant_title = excluded.variant_title, product_type = excluded.product_type,
        tags = excluded.tags, quantity = excluded.quantity, unit_price = excluded.unit_price, discount = excluded.discount,
        fulfilled_quantity = excluded.fulfilled_quantity, currency = excluded.currency;
      n_lines := n_lines + 1;
    end loop;

    -- ---------------------------------------------------------------- fulfillments → shipment + tracking
    for f in select * from jsonb_array_elements(coalesce(o->'fulfillments', '[]'::jsonb)) loop
      insert into flowmerce.fulfillment as fu (
        workspace_id, store_id, order_id, external_id, status, display_status, service, carrier_name_raw,
        tracking_numbers, tracking_urls, src_created_at, in_transit_at, estimated_delivery_at, delivered_at, src_updated_at, synced_at)
      values (
        ws, st, v_order, f->>'external_id', lower(f->>'status'), f->>'display_status', f->>'service', f->>'carrier_name_raw',
        coalesce(array(select jsonb_array_elements_text(f->'tracking_numbers')), '{}'),
        coalesce(array(select jsonb_array_elements_text(f->'tracking_urls')), '{}'),
        (f->>'src_created_at')::timestamptz, (f->>'in_transit_at')::timestamptz, (f->>'estimated_delivery_at')::timestamptz,
        (f->>'delivered_at')::timestamptz, (f->>'src_updated_at')::timestamptz, now())
      on conflict (store_id, external_id) do update set
        order_id = excluded.order_id, status = excluded.status, display_status = excluded.display_status, service = excluded.service,
        carrier_name_raw = excluded.carrier_name_raw, tracking_numbers = excluded.tracking_numbers, tracking_urls = excluded.tracking_urls,
        src_created_at = excluded.src_created_at, in_transit_at = excluded.in_transit_at,
        estimated_delivery_at = excluded.estimated_delivery_at, delivered_at = excluded.delivered_at,
        src_updated_at = excluded.src_updated_at, synced_at = now()
      returning fu.id into fid;
      n_ful := n_ful + 1;

      for l in select * from jsonb_array_elements(coalesce(f->'lines', '[]'::jsonb)) loop
        select ol.id into lid from flowmerce.order_line ol where ol.store_id = st and ol.external_id = l->>'line_external_id';
        if lid is not null then
          insert into flowmerce.fulfillment_line (fulfillment_id, order_line_id, workspace_id, store_id, quantity)
          values (fid, lid, ws, st, coalesce((l->>'quantity')::int, 0))
          on conflict (fulfillment_id, order_line_id) do update set quantity = excluded.quantity;
        end if;
      end loop;

      for e in select * from jsonb_array_elements(coalesce(f->'events', '[]'::jsonb)) loop
        insert into flowmerce.fulfillment_event (workspace_id, store_id, fulfillment_id, external_id, status, happened_at, message, city, province, country)
        values (ws, st, fid, e->>'external_id', coalesce(e->>'status', 'unknown'), (e->>'happened_at')::timestamptz,
                e->>'message', e->>'city', e->>'province', e->>'country')
        on conflict (store_id, external_id) do nothing;
      end loop;

      -- carrier from the free-typed name (carrier_alias), Amazon service → MCF parcel
      v_carrier := null;
      select ca.carrier_code into v_carrier from flowmerce.carrier_alias ca
       where (ca.workspace_id = ws or ca.workspace_id is null)
         and lower(ca.alias::text) = lower(trim(coalesce(f->>'carrier_name_raw', '')))
       order by (ca.workspace_id is null) limit 1;
      v_carrier := coalesce(v_carrier, 'unknown');
      v_kind := case when coalesce(f->>'service', '') ilike '%amazon%' then 'mcf' else 'own' end;
      v_step := case
        when lower(coalesce(f->>'status', '')) in ('cancelled','error','failure') then 'cancelled'
        when upper(coalesce(f->>'display_status', '')) = 'DELIVERED' then 'delivered'
        when upper(coalesce(f->>'display_status', '')) = 'OUT_FOR_DELIVERY' then 'out'
        when upper(coalesce(f->>'display_status', '')) in ('IN_TRANSIT','CARRIER_PICKED_UP','PICKED_UP','ATTEMPTED_DELIVERY','DELAYED') then 'transit'
        else 'shipped' end;

      shid := null;
      select sh.id into shid from flowmerce.shipment sh where sh.fulfillment_id = fid;
      if shid is null then
        select coalesce(max(sh.seq), 0) + 1 into v_seq from flowmerce.shipment sh where sh.order_id = v_order;
        insert into flowmerce.shipment (workspace_id, store_id, order_id, fulfillment_id, seq, kind, kind_inferred, step,
                                        carrier_code, carrier_name_raw, service)
        values (ws, st, v_order, fid, v_seq, v_kind, v_kind = 'mcf', v_step, v_carrier, f->>'carrier_name_raw', f->>'service')
        returning id into shid;
      else
        update flowmerce.shipment sh set step = v_step, carrier_code = v_carrier,
               carrier_name_raw = f->>'carrier_name_raw', service = f->>'service'
         where sh.id = shid and (sh.step is distinct from v_step or sh.carrier_code is distinct from v_carrier
                                 or sh.carrier_name_raw is distinct from f->>'carrier_name_raw');
      end if;

      -- status word from Shopify (source 'shopify', any carrier); never proof of delivery
      v_status := null;
      select sm.our_status into v_status from flowmerce.status_map sm
       where sm.source = 'shopify' and sm.carrier_code = '_any'
         and upper(sm.raw_status::text) = upper(coalesce(f->>'display_status', ''))
         and (sm.workspace_id = ws or sm.workspace_id is null)
       order by (sm.workspace_id is null) limit 1;
      v_status := coalesce(v_status, case when v_step = 'cancelled' then 'expired' else 'in_transit' end);

      i := 0;
      for num in select jsonb_array_elements_text(coalesce(f->'tracking_numbers', '[]'::jsonb)) loop
        i := i + 1;
        num := upper(regexp_replace(num, '\s', '', 'g'));
        continue when num = '';
        insert into flowmerce.tracking as t (
          workspace_id, store_id, shipment_id, carrier_code, tracking_number, source, status, raw_status,
          registered_at, eta, delivered_at, active)
        values (
          ws, st, shid, v_carrier, num, 'shopify', v_status, f->>'display_status',
          coalesce((f->>'src_created_at')::timestamptz, now()), (f->>'estimated_delivery_at')::timestamptz,
          case when v_status = 'delivered' then coalesce((f->>'delivered_at')::timestamptz, (f->>'src_updated_at')::timestamptz, now()) end,
          v_step <> 'cancelled')
        on conflict (store_id, carrier_code, tracking_number) do update set
          -- carrier / tracking-service data wins; Shopify only fills what is still Shopify's
          status       = case when t.source = 'shopify' then excluded.status       else t.status end,
          raw_status   = case when t.source = 'shopify' then excluded.raw_status   else t.raw_status end,
          delivered_at = case when t.source = 'shopify' then excluded.delivered_at else t.delivered_at end,
          eta          = coalesce(t.eta, excluded.eta),
          active       = case when t.source = 'shopify' then excluded.active and t.active else t.active end;
        n_track := n_track + 1;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('orders', n_orders, 'lines', n_lines, 'fulfillments', n_ful, 'tracking', n_track, 'raw', n_raw,
                            'skipped_older', jsonb_array_length(coalesce(p_orders, '[]'::jsonb)) - n_orders);
end $$;

revoke execute on function flowmerce.ingest_shopify_orders(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function flowmerce.ingest_shopify_orders(text, jsonb, uuid) to service_role;

-- Start / finish a run in one call each (lock + log), so the backend needs no table logic of its own.
create or replace function flowmerce.job_start(p_store text, p_stream text, p_mode text, p_owner text, p_trigger text default 'schedule')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j flowmerce.sync_job; run uuid;
begin
  select sj.* into j from flowmerce.sync_job sj join flowmerce.store s on s.id = sj.store_id
   where s.code = p_store and sj.stream = p_stream and sj.mode = p_mode;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no such job'); end if;
  if not j.is_enabled then return jsonb_build_object('ok', false, 'reason', 'job is switched off'); end if;
  if not flowmerce.try_lock(j.id, p_owner, 30) then return jsonb_build_object('ok', false, 'reason', 'another run holds the lock'); end if;
  insert into flowmerce.sync_run (workspace_id, store_id, sync_job_id, source, stream, triggered_by)
  values (j.workspace_id, j.store_id, j.id, split_part(p_stream, '.', 1), p_stream, p_trigger) returning id into run;
  return jsonb_build_object('ok', true, 'job_id', j.id, 'run_id', run, 'cursor', j.cursor, 'repull_days', j.repull_days);
end $$;

create or replace function flowmerce.job_finish(p_job uuid, p_run uuid, p_owner text, p_status text, p_cursor jsonb,
                                                p_rows_read int, p_rows_written int, p_api_calls int, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update flowmerce.sync_run set finished_at = now(), status = p_status, rows_read = coalesce(p_rows_read, 0),
         rows_written = coalesce(p_rows_written, 0), api_calls = coalesce(p_api_calls, 0), cursor_after = p_cursor,
         error = left(p_error, 2000)
   where id = p_run;
  perform flowmerce.release_lock(p_job, p_owner, case when p_status in ('ok','partial') then p_cursor end, p_status = 'ok');
end $$;

revoke execute on function flowmerce.job_start(text, text, text, text, text),
                           flowmerce.job_finish(uuid, uuid, text, text, jsonb, int, int, int, text) from public, anon, authenticated;
grant execute on function flowmerce.job_start(text, text, text, text, text),
                          flowmerce.job_finish(uuid, uuid, text, text, jsonb, int, int, int, text) to service_role;

-- Webhook messages: keep each once, then the backend marks it done (or failed, to be retried by the catch-up run)
create or replace function flowmerce.webhook_keep(p_store text, p_topic text, p_webhook_id text, p_shop_domain text,
                                                  p_headers jsonb, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s flowmerce.store; new_id bigint;
begin
  select * into s from flowmerce.store where code = p_store;
  insert into flowmerce.raw_webhook_event (workspace_id, store_id, provider_code, topic, shop_domain, idempotency_key,
                                           signature_valid, headers, payload)
  values (s.workspace_id, s.id, 'shopify', p_topic, p_shop_domain, p_webhook_id, true, coalesce(p_headers, '{}'), p_payload)
  on conflict (provider_code, idempotency_key) do nothing
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'duplicate', new_id is null);
end $$;

create or replace function flowmerce.webhook_done(p_id bigint, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update flowmerce.raw_webhook_event
     set processed_at = case when p_error is null then now() else processed_at end,
         attempts = attempts + 1, error = left(p_error, 1000)
   where id = p_id;
$$;

revoke execute on function flowmerce.webhook_keep(text, text, text, text, jsonb, jsonb), flowmerce.webhook_done(bigint, text)
  from public, anon, authenticated;
grant execute on function flowmerce.webhook_keep(text, text, text, text, jsonb, jsonb), flowmerce.webhook_done(bigint, text)
  to service_role;

-- ===================================================================== connections + jobs for RBP and CPC
insert into flowmerce.connection (workspace_id, store_id, provider_code, account_ref, display_name, auth_type, secret_name, scopes)
select s.workspace_id, s.id, 'shopify', s.shop_domain, s.name || ' Shopify', 'api_key',
       case s.code when 'RBP' then 'SHOPIFY_TOKEN' else 'CPC_SHOPIFY_TOKEN' end,      -- same Firebase secrets Sellora uses
       '{read_orders}'
from flowmerce.store s where s.code in ('RBP','CPC')
on conflict (store_id, provider_code, account_ref) do nothing;

insert into flowmerce.sync_job (workspace_id, store_id, connection_id, stream, mode, schedule_cron, repull_days, history_days, is_enabled, cursor)
select c.workspace_id, c.store_id, c.id, 'shopify.orders', m.mode, m.cron, m.repull, null, m.enabled, '{}'::jsonb
from flowmerce.connection c
cross join (values ('incremental', '*/15 * * * *', 0, true),
                   ('backfill',    '*/5 * * * *',  0, false)) as m(mode, cron, repull, enabled)   -- backfill OFF until job 1 is checked
where c.provider_code = 'shopify'
on conflict (connection_id, stream, mode) do nothing;
