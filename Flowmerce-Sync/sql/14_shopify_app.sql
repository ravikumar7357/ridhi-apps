-- =====================================================================================
-- Flowmerce · file 14 · the Flowmerce Shopify app (Dev Dashboard app, owner decision 24 Nov 2026)
--   · the backend logs in as the app (client ID + secret → a store token each day, never stored in a table)
--   · it registers its own webhooks in each store and records them here
--   · app/uninstalled marks the store's connection revoked; privacy webhooks are kept and answered
-- Applied to the ERP project as migration flowmerce_14_shopify_app.
-- =====================================================================================

-- The connection now points at the app's secrets (names only — never the values).
update flowmerce.connection c
   set auth_type = 'client_credentials', secret_name = 'FLOWMERCE_APP_CLIENT_SECRET',
       scopes = '{read_orders,read_all_orders,read_fulfillments,read_merchant_managed_fulfillment_orders,read_third_party_fulfillment_orders,read_assigned_fulfillment_orders,read_returns,read_products,read_inventory,read_locations,read_content,write_content,read_online_store_pages,read_files,write_files,read_reports,read_discounts,read_shipping}'
 where c.provider_code = 'shopify';

-- One row per webhook the app has in a store (what Shopify answered).
create or replace function flowmerce.webhook_subscription_save(p_store text, p_topic text, p_external_id text, p_url text, p_status text default 'active')
returns void language plpgsql security definer set search_path = '' as $$
declare c flowmerce.connection;
begin
  select cn.* into c from flowmerce.connection cn join flowmerce.store s on s.id = cn.store_id
   where s.code = p_store and cn.provider_code = 'shopify' limit 1;
  if not found then raise exception 'no shopify connection for %', p_store using errcode = 'P0002'; end if;
  insert into flowmerce.webhook_subscription (workspace_id, store_id, connection_id, topic, external_id, endpoint_url, status)
  values (c.workspace_id, c.store_id, c.id, p_topic, p_external_id, p_url, p_status)
  on conflict (connection_id, topic) do update
    set external_id = excluded.external_id, endpoint_url = excluded.endpoint_url, status = excluded.status;
end $$;

-- app/uninstalled: stop using the store until it is installed again.
create or replace function flowmerce.store_app_uninstalled(p_store text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('flowmerce.actor', 'api:shopify.app_uninstalled', true);
  update flowmerce.connection c set status = 'revoked', last_error = 'app uninstalled in Shopify ' || now()::text
    from flowmerce.store s where s.id = c.store_id and s.code = p_store and c.provider_code = 'shopify';
  update flowmerce.webhook_subscription w set status = 'disabled'
    from flowmerce.store s where s.id = w.store_id and s.code = p_store;
end $$;

-- Called after a successful app login: the store is connected again.
create or replace function flowmerce.store_app_ok(p_store text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update flowmerce.connection c set status = 'active', last_success_at = now(), last_error = null
    from flowmerce.store s where s.id = c.store_id and s.code = p_store and c.provider_code = 'shopify'
     and (c.status <> 'active' or c.last_success_at is null or c.last_success_at < now() - interval '1 hour');
end $$;

revoke execute on function flowmerce.webhook_subscription_save(text, text, text, text, text),
                           flowmerce.store_app_uninstalled(text), flowmerce.store_app_ok(text) from public, anon, authenticated;
grant execute on function flowmerce.webhook_subscription_save(text, text, text, text, text),
                          flowmerce.store_app_uninstalled(text), flowmerce.store_app_ok(text) to service_role;
