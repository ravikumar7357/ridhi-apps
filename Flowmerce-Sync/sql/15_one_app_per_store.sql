-- Flowmerce · file 15 · one Flowmerce Shopify app per store (24 Nov 2026: the two stores are in different organisations).
-- The connection names each store's own app secret (names only — never the values).
-- Applied to the ERP project as migration flowmerce_15_one_app_per_store.
select set_config('flowmerce.actor', 'migration:flowmerce_15', true);
update flowmerce.connection c
   set secret_name = 'FLOWMERCE_' || s.code || '_CLIENT_SECRET',
       display_name = s.name || ' Shopify (Flowmerce app for ' || s.code || ')'
  from flowmerce.store s
 where s.id = c.store_id and c.provider_code = 'shopify' and s.code in ('RBP','CPC');
