-- =====================================================================================
-- Flowmerce · schema flowmerce · file 06 · first workspace: Ridhi (RBP + CPC). Safe to run again.
-- Check currency / timezone against each Shopify admin. In the ERP, Sellora calls Ridhi "SP".
-- =====================================================================================

insert into flowmerce.workspace (name, slug, plan) values ('Ridhi', 'ridhi', 'internal')
on conflict (slug) do nothing;

insert into flowmerce.store (workspace_id, code, name, shop_domain, primary_domain, currency, timezone, erp_brand, erp_brand_code)
select w.id, s.code, s.name, s.shop_domain, s.primary_domain, 'USD', 'America/New_York', s.erp_brand, s.erp_brand_code
from flowmerce.workspace w, (values
  ('RBP', 'Ridhi Block Print', 'guz0he-21.myshopify.com',          'ridhiblockprint.com', 'Ridhi', 'SP'),
  ('CPC', 'Cotton Print Club', 'liquidationfashion.myshopify.com', 'cottonprintclub.com', 'CPC',   'CPC')
) as s(code, name, shop_domain, primary_domain, erp_brand, erp_brand_code)
where w.slug = 'ridhi'
on conflict (workspace_id, code) do nothing;

insert into flowmerce.setting (workspace_id, store_id, key, value)
select w.id, null, k.key, k.value
from flowmerce.workspace w, (values
  ('age_bands',   '{"yellow":4,"orange":6,"red":9}'::jsonb),
  ('step_limits', '{"no_scan_h":72}'::jsonb)
) as k(key, value)
where w.slug = 'ridhi'
on conflict do nothing;

insert into flowmerce.write_switch (workspace_id, store_id, switch_key, is_on, note)
select w.id, null, k, false, 'default off'
from flowmerce.workspace w,
     unnest(array['shopify_article_publish','shopify_file_upload','shopify_seo_update','shopify_page_create',
                  'shopify_writes','amazon_writes','ads_writes','tracking_register','notify_send']) as k
where w.slug = 'ridhi'
on conflict do nothing;

-- Make someone owner after they have signed in once (Supabase Auth):
--   insert into flowmerce.member (workspace_id, user_id, display_name, role, can_see_costs)
--   select w.id, u.id, 'Owner', 'owner', true
--   from flowmerce.workspace w, auth.users u where w.slug = 'ridhi' and u.email = '<their email>';
