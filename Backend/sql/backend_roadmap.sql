-- R-one backend roadmap: the progress shown on Sellora's /roadmap.html. Run once in the SQL editor of ERP data,
-- after backend_core.sql. Safe to run again (nothing is overwritten; the seed only fills an empty table).
--
--   backend.roadmap           one row per module (plus '_meta' for the "next up" list). RLS on, no policies:
--                             pages never touch the table, only the two functions below.
--   sellora.roadmap_get()     anyone signed in to Sellora reads the roadmap; says whether they may edit
--   sellora.roadmap_save()    ADMINS only: status, done, week, note on a module; the "next up" list on _meta.
--                             Records who changed it and when.
--
-- Who is signed in comes from core.me_email() (the Firebase sign-in, as for every ERP and Sellora save);
-- who is an admin from core.is_admin(). Claude updates rows with the backend's server key (Backend/tools/roadmap.ts).

create table if not exists backend.roadmap (
  id          text        primary key,
  ord         integer     not null default 0,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
alter table backend.roadmap enable row level security;
grant all on backend.roadmap to service_role;

create or replace function sellora.roadmap_get() returns jsonb
language plpgsql stable security definer set search_path = backend, core, public as $$
declare
  me text := core.me_email();
begin
  if me is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in to Sellora to see the roadmap.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'canEdit', coalesce(core.is_admin(), false),
    'rows', coalesce((
      select jsonb_agg(r.data || jsonb_build_object('id', r.id, 'ord', r.ord, 'updatedAt', r.updated_at) order by r.ord)
      from backend.roadmap r), '[]'::jsonb));
end $$;

create or replace function sellora.roadmap_save(p_id text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = backend, core, public as $$
declare
  me      text := core.me_email();
  cur     jsonb;
  allowed text[];
  k       text;
  clean   jsonb := '{}'::jsonb;
begin
  if me is null then return jsonb_build_object('ok', false, 'message', 'Sign in again.'); end if;
  if not coalesce(core.is_admin(), false) then
    return jsonb_build_object('ok', false, 'message', 'Only admins can change the roadmap.');
  end if;

  select data into cur from backend.roadmap where id = p_id for update;
  if cur is null then return jsonb_build_object('ok', false, 'message', 'No such roadmap item.'); end if;

  allowed := case when p_id = '_meta' then array['next'] else array['status', 'done', 'week', 'note'] end;
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if k = any(allowed) then clean := clean || jsonb_build_object(k, p_patch -> k); end if;
  end loop;
  if clean = '{}'::jsonb then return jsonb_build_object('ok', false, 'message', 'Nothing to change.'); end if;

  if clean ? 'status' and coalesce(clean ->> 'status', '') not in ('done', 'active', 'next', 'later') then
    return jsonb_build_object('ok', false, 'message', 'Status must be done, active, next or later.');
  end if;
  if clean ? 'done' then
    if jsonb_typeof(clean -> 'done') <> 'number'
       or (clean ->> 'done')::numeric < 0
       or (clean ->> 'done')::numeric > coalesce((cur ->> 'total')::numeric, 0) then
      return jsonb_build_object('ok', false, 'message', 'Done must be a number between 0 and the total.');
    end if;
  end if;
  if clean ? 'week' and (jsonb_typeof(clean -> 'week') <> 'string' or length(clean ->> 'week') > 60) then
    return jsonb_build_object('ok', false, 'message', 'Week must be short text.');
  end if;
  if clean ? 'note' and (jsonb_typeof(clean -> 'note') <> 'string' or length(clean ->> 'note') > 400) then
    return jsonb_build_object('ok', false, 'message', 'Note must be text, at most 400 characters.');
  end if;
  if clean ? 'next' and (jsonb_typeof(clean -> 'next') <> 'array' or jsonb_array_length(clean -> 'next') > 20) then
    return jsonb_build_object('ok', false, 'message', 'The next-up list must be a list of at most 20 items.');
  end if;

  update backend.roadmap set data = cur || clean, updated_at = now(), updated_by = me where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Same pattern as the ERP's own functions: callable with the page's publishable key; the sign-in and admin checks
-- inside are what protect it.
grant execute on function sellora.roadmap_get() to anon, authenticated, service_role;
grant execute on function sellora.roadmap_save(text, jsonb) to anon, authenticated, service_role;

-- The starting rows (26 Nov 2026). Only inserted when missing; later changes come from the page or Backend/tools/roadmap.ts.
insert into backend.roadmap (id, ord, data, updated_by) values
  ('_meta', 0, '{"next":[
      {"text":"Check that last night''s backup (03:20) read from Supabase","done":false},
      {"text":"Run the 3 parity checks","done":false},
      {"text":"Server: exact cost first, then buy DigitalOcean App Platform","done":false},
      {"text":"Put the backend on the server and stop the copy on this PC","done":false},
      {"text":"Pause clasp push on the office PC","done":false},
      {"text":"List every Apps Script route and timer with how often it is used","done":false}]}', 'seed'),
  ('m0', 1, '{"code":"M0","name":"Foundation and front door","files":"Code.gs, SpApi.gs → router, Amazon gateway, switches, job log, queue, server","unit":"lines","total":485,"done":485,"status":"done","week":"Done · 26 Nov","note":"95 tests pass. Running on this PC; heartbeat logged in Supabase."}', 'seed'),
  ('live-sales', 2, '{"code":"—","name":"Live sales","files":"SalesLive.gs","unit":"lines","total":764,"done":764,"status":"done","week":"Done · 21 Nov","note":"Replaced by Sellora''s backend. Its Apps Script timer is switched off later."}', 'seed'),
  ('setup-gs', 3, '{"code":"—","name":"Old setup script","files":"Setup.gs","unit":"lines","total":40,"done":40,"status":"done","week":"Not needed","note":"Deleted with Apps Script at switch-off."}', 'seed'),
  ('m1', 4, '{"code":"M1","name":"Setup","files":"Supabase tables, secrets, server, budget alert","unit":"steps","total":7,"done":4,"status":"active","week":"This week","showStat":true,"note":"Done: SQL files, backend schema, API_KEY secret, running on this PC. Left: server, budget alert, pause clasp push."}', 'seed'),
  ('m2a', 5, '{"code":"M2a","name":"Orders, shipments, stock","files":"InvSync.gs, ReplSnap.gs","unit":"lines","total":1208,"done":0,"status":"next","week":"Week of 3 Dec","note":"First real piece: run beside Apps Script, compare 3–5 days, switch."}', 'seed'),
  ('m4', 6, '{"code":"M4","name":"ERP save rules","files":"core.rt_save in Supabase: month lock + change log","unit":"steps","total":6,"done":1,"status":"active","week":"From 10 Dec","showStat":true,"note":"Done: every ERP save listed (~375). Next: extra hours, then pay, stock ledgers, big registers, masters."}', 'seed'),
  ('m2b', 7, '{"code":"M2b","name":"Ads and PPC","files":"AdsApi.gs, WeeklyPpc.gs","unit":"lines","total":1036,"done":0,"status":"later","week":"Week of 10 Dec","note":"Ads profiles and PPC week keys already rebuilt. Live ads reports get one owner."}', 'seed'),
  ('m2c', 8, '{"code":"M2c","name":"Nightly caches and sales","files":"Nightly.gs, SalesAnalysis.gs","unit":"lines","total":1129,"done":0,"status":"later","week":"Week of 17 Dec"}', 'seed'),
  ('m3', 9, '{"code":"M3","name":"Shopify","files":"Shopify.gs, ShopifyCache.gs, ShopifySkuSales.gs","unit":"lines","total":874,"done":0,"status":"later","week":"Week of 17 Dec","note":"Builds on the webhooks Flowmerce-Sync already registers."}', 'seed'),
  ('m2d', 10, '{"code":"M2d","name":"Research, search terms, listing health and the rest","files":"Research, SearchTerms, OrderAudits, ListingHealth, BrandAnalytics, MarketBasket, ListingFix, SkuPictures, InventoryAge, FriBooks, Lookups","unit":"lines","total":3052,"done":0,"status":"later","week":"24 Dec – 7 Jan","note":"Brand Analytics periods already rebuilt."}', 'seed'),
  ('m6', 11, '{"code":"M6","name":"Amazon writes","files":"Mcf.gs, ListingImages.gs","unit":"lines","total":816,"done":0,"status":"later","week":"January"}', 'seed'),
  ('m7', 12, '{"code":"M7","name":"Mail and notices","files":"MailPo.gs, Notifications.gs","unit":"lines","total":175,"done":0,"status":"later","week":"January"}', 'seed'),
  ('m8', 13, '{"code":"M8","name":"AI and creators","files":"ListingOptimiser.gs, CreatorOrders.gs","unit":"lines","total":1601,"done":0,"status":"later","week":"January"}', 'seed'),
  ('m9-10', 14, '{"code":"M9–M10","name":"Inventory app and housekeeping","files":"Backup, report mails, checker, FabriCrush Inventory app","unit":"scripts","total":4,"done":0,"status":"later","week":"End of January","note":"The nightly backup already reads from Supabase."}', 'seed'),
  ('m11', 15, '{"code":"M11","name":"Switch-off","files":"Apps Script deleted, pushBack off, bridge functions removed, Firebase database retired","unit":"steps","total":5,"done":0,"status":"later","week":"End of January"}', 'seed')
on conflict (id) do nothing;

-- Check (should list 16 rows, then answer false: the SQL editor is not a signed-in admin):
select id, ord, data ->> 'status' as status from backend.roadmap order by ord;
select core.is_admin() as sql_editor_is_admin;
