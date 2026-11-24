-- =====================================================================================
-- Flowmerce · schema flowmerce · file 09 · changes from the Flowmerce team's schema review (schema-review.html, 24 Nov 2026)
-- Items that already existed (action, approval, audit_log, notification, scan key, write_switch key,
-- raw_webhook_event key, RLS) are not repeated; they are strengthened where the review asked for more.
-- =====================================================================================

-- ===================================================================== M1 · actions + approvals, stronger
alter table flowmerce.action_policy add column module text not null default 'system'
  check (module in ('seo','shipping','cro','ads','catalog','system'));
alter table flowmerce.action_policy add column two_person boolean not null default false;

update flowmerce.action_policy set module = case
  when action_type like 'shopify.article.%' or action_type like 'shopify.file.%' then 'seo'
  when action_type like 'shopify.product.%' or action_type like 'shopify.collection.%' or action_type like 'shopify.page.%' then 'catalog'
  when action_type like 'shopify.fulfillment.%' or action_type like 'amazon.%' or action_type like 'tracking.%' then 'shipping'
  when action_type like 'meta.%' or action_type like 'google.%' then 'ads'
  else 'system' end;
update flowmerce.action_policy set two_person = true
 where action_type in ('shopify.article.publish','shopify.article.update_live','amazon.mcf.create_order','meta.budget.set','google.budget.set');

-- per-workspace override of the default policy
create table flowmerce.approval_policy (
  workspace_id      uuid not null references flowmerce.workspace(id) on delete cascade,
  action_type       text not null references flowmerce.action_policy(action_type),
  requires_approval boolean not null default true,
  two_person        boolean not null default false,
  approver_roles    text[] not null default '{owner,admin}',
  primary key (workspace_id, action_type)
);

alter table flowmerce.action add column module text;
alter table flowmerce.action add column switch_key text;
alter table flowmerce.action add column run_after timestamptz;                      -- scheduled publish
alter table flowmerce.action add column request_hash text generated always as (md5(params::text)) stored;
alter table flowmerce.action drop constraint action_status_check;
alter table flowmerce.action add constraint action_status_check check (status in
  ('requested','approved','rejected','queued','sending','succeeded','failed','cancelled'));
alter table flowmerce.approval add column approved_hash text;

-- fill module / switch from the policy; once approved, the request can no longer change
create or replace function flowmerce.action_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select p.module, p.switch_key into new.module, new.switch_key
      from flowmerce.action_policy p where p.action_type = new.action_type;
  elsif old.status in ('approved','queued','sending','succeeded') and new.params is distinct from old.params then
    raise exception 'action % is already %; create a new action instead of editing it', old.id, old.status using errcode = '22023';
  end if;
  return new;
end $$;
create trigger action_guard before insert or update on flowmerce.action for each row execute function flowmerce.action_guard();

create or replace function flowmerce.approve_action(p_action uuid, p_decision text, p_typed text default null, p_comment text default null)
returns flowmerce.action language plpgsql security definer set search_path = '' as $$
declare
  a flowmerce.action;
  pol flowmerce.action_policy;
  ovr flowmerce.approval_policy;
  roles text[];
  two boolean;
  r text;
begin
  select * into a from flowmerce.action where id = p_action for update;
  if not found then raise exception 'action not found' using errcode = 'P0002'; end if;
  if a.status <> 'requested' then raise exception 'action is %', a.status using errcode = '22023'; end if;
  select * into pol from flowmerce.action_policy where action_type = a.action_type;
  select * into ovr from flowmerce.approval_policy where workspace_id = a.workspace_id and action_type = a.action_type;
  if pol.is_forbidden then raise exception 'this action can never run' using errcode = '42501'; end if;
  roles := coalesce(ovr.approver_roles, pol.approver_roles);
  two   := coalesce(ovr.two_person, pol.two_person);
  r := flowmerce.member_role(a.workspace_id);
  if r is null or not (r = any (roles)) then
    raise exception 'your role cannot approve %', a.action_type using errcode = '42501';
  end if;
  if two and p_decision = 'approved' and a.requested_by = auth.uid() then
    raise exception 'a second person must approve %', a.action_type using errcode = '42501';
  end if;
  if p_decision = 'approved' and pol.typed_confirm is not null and coalesce(p_typed, '') <> pol.typed_confirm then
    raise exception 'type % to confirm', pol.typed_confirm using errcode = '22023';
  end if;
  if p_decision = 'approved' and not flowmerce.write_allowed(a.workspace_id, a.store_id, pol.switch_key) then
    raise exception 'switch % is off', pol.switch_key using errcode = '42501';
  end if;
  insert into flowmerce.approval (workspace_id, action_id, approver_id, decision, typed_confirm, comment, approved_hash)
  values (a.workspace_id, a.id, auth.uid(), p_decision, p_typed, p_comment, a.request_hash);
  update flowmerce.action set status = case p_decision when 'approved' then 'approved' else 'rejected' end
   where id = a.id returning * into a;
  return a;
end $$;

-- The backend sends an action only when this is true: approved (or no approval needed), switch on,
-- not scheduled for later, and the request is exactly what was approved.
create or replace function flowmerce.action_ready(p_action uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (case when coalesce(o.requires_approval, p.requires_approval)
                 then a.status = 'approved' and exists (
                        select 1 from flowmerce.approval ap
                        where ap.action_id = a.id and ap.decision = 'approved' and ap.approved_hash = a.request_hash)
                 else a.status in ('requested','approved') end)
           and not p.is_forbidden
           and flowmerce.write_allowed(a.workspace_id, a.store_id, p.switch_key)
           and (a.run_after is null or a.run_after <= now())
    from flowmerce.action a
    join flowmerce.action_policy p on p.action_type = a.action_type
    left join flowmerce.approval_policy o on o.workspace_id = a.workspace_id and o.action_type = a.action_type
    where a.id = p_action), false);
$$;

-- ===================================================================== M2 · audit log, richer actor
alter table flowmerce.audit_log add column actor_type text check (actor_type in ('user','job','system','api'));
alter table flowmerce.audit_log add column actor_label text;
alter table flowmerce.audit_log add column ip inet;
alter table flowmerce.audit_log add column note text;
update flowmerce.audit_log set actor_type = 'system', actor_label = actor where actor_type is null;
alter table flowmerce.audit_log alter column actor_type set not null;

create or replace function flowmerce.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  label text := nullif(current_setting('flowmerce.actor', true), '');
  ch_old jsonb; ch_new jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(e.key, o -> e.key), jsonb_object_agg(e.key, e.value)
      into ch_old, ch_new
      from jsonb_each(n) e where (o -> e.key) is distinct from e.value;
    if ch_new is null then return new; end if;
    o := ch_old; n := ch_new;
  end if;
  insert into flowmerce.audit_log (workspace_id, store_id, actor, actor_type, actor_label, verb, table_name, row_id, old_values, new_values)
  values (case when r ? 'workspace_id' then (r ->> 'workspace_id')::uuid end,
          case when r ? 'store_id' then (r ->> 'store_id')::uuid end,
          flowmerce.current_actor(),
          case when auth.uid() is not null then 'user'
               when label like 'job:%' then 'job'
               when label like 'api:%' then 'api'
               else 'system' end,
          label, lower(tg_op), tg_table_name,
          coalesce(r ->> 'id', r ->> 'store_id', r ->> 'order_id', r ->> 'tracking_id', r ->> 'action_type'),
          o, n);
  return coalesce(new, old);
end $$;
-- append-only for everyone except the backend
revoke insert, update, delete on flowmerce.audit_log from authenticated;

-- ===================================================================== M3 · scans: carrier event id + raw copy
alter table flowmerce.scan add column external_id text;
alter table flowmerce.scan add column raw jsonb;
create unique index scan_ext_once on flowmerce.scan (tracking_id, external_id) where external_id is not null;
drop index flowmerce.scan_tracking;
create index scan_newest on flowmerce.scan (tracking_id, scanned_at desc, received_at desc);

-- ===================================================================== S1 · status map knows whose word it is
insert into flowmerce.carrier (code, name, track_url_template, provider_code, can_confirm_delivery)
values ('_any', 'Any carrier', null, null, false);
alter table flowmerce.status_map add column source text not null default 'carrier'
  check (source in ('shopify','carrier','aggregator','amazon','mcf_sheet','manual'));
alter table flowmerce.status_map add constraint status_map_shopify_not_proof
  check (not (source in ('shopify','mcf_sheet','manual') and is_delivery_proof));
drop index flowmerce.status_map_one;
create unique index status_map_one on flowmerce.status_map
  (coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), source, carrier_code, raw_status);
insert into flowmerce.status_map (carrier_code, source, raw_status, our_status, is_delivery_proof) values
 ('_any','shopify','LABEL_PRINTED','info_received',false), ('_any','shopify','LABEL_PURCHASED','info_received',false),
 ('_any','shopify','CONFIRMED','info_received',false),     ('_any','shopify','READY_FOR_PICKUP','info_received',false),
 ('_any','shopify','CARRIER_PICKED_UP','in_transit',false),('_any','shopify','PICKED_UP','in_transit',false),
 ('_any','shopify','IN_TRANSIT','in_transit',false),       ('_any','shopify','OUT_FOR_DELIVERY','out_for_delivery',false),
 ('_any','shopify','ATTEMPTED_DELIVERY','exception',false),('_any','shopify','DELAYED','exception',false),
 ('_any','shopify','FAILURE','exception',false),           ('_any','shopify','DELIVERED','delivered',false);

-- ===================================================================== S2 · sessions per product (ShopifyQL)
create table flowmerce.sq_product_sessions_daily (
  workspace_id uuid not null, store_id uuid not null, day date not null,
  product_external_id text not null,
  product_id uuid references flowmerce.product(id) on delete set null,
  device text not null default 'all',
  sessions integer not null default 0, sessions_with_cart integer not null default 0,
  sessions_reached_checkout integer not null default 0, sessions_completed_checkout integer not null default 0,
  is_final boolean not null default false, pulled_at timestamptz not null default now(),
  primary key (store_id, day, product_external_id, device),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade
);

-- ===================================================================== S3 · team heads for escalation
alter table flowmerce.team add column code text;
alter table flowmerce.team add column head_user_id uuid;
alter table flowmerce.team add constraint team_code_unique unique (workspace_id, code);
alter table flowmerce.team add constraint team_head_is_member
  foreign key (workspace_id, head_user_id) references flowmerce.member (workspace_id, user_id) on delete set null (head_user_id);
alter table flowmerce.member add column title text;
-- order_event.owner_team holds team.code; working hours / escalation live in setting keys 'working_hours', 'escalation'

-- ===================================================================== S4 · files (uploads + AI images)
create table flowmerce.media_file (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  store_id         uuid not null,
  origin           text not null check (origin in ('upload','ai_generated','shopify_sync')),
  ai_job_id        uuid references flowmerce.ai_job(id) on delete set null,
  image_generation_id uuid references flowmerce.ai_image_generation(id) on delete set null,
  action_id        uuid references flowmerce.action(id) on delete set null,     -- the fileCreate action
  shopify_file_id  text,
  url              text,
  alt_text         text,
  width integer, height integer, bytes integer, mime_type text,
  sha256           text,
  used_by_type     text,
  used_by_id       uuid,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (store_id, sha256)
);
create index media_file_used_by on flowmerce.media_file (used_by_type, used_by_id);

-- ===================================================================== S5 · ads targets: all measures the sheets use
alter table flowmerce.ads_target drop constraint ads_target_metric_check;
alter table flowmerce.ads_target add constraint ads_target_metric_check check (metric in
  ('roas','cpa','ctr','cpm','cpc','frequency','daily_spend_cap','hook_rate','hold_rate','cost_per_atc','cost_per_checkout'));
alter table flowmerce.ads_target add column warn_value numeric(14,4);
alter table flowmerce.ads_target add column platform text check (platform in ('meta','google'));
alter table flowmerce.ads_target add column note text;

-- ===================================================================== S6 · reship / done facts (never the note text)
alter table flowmerce.shop_order add column is_reship boolean not null default false;
alter table flowmerce.shop_order add column reship_of_order_name text;
alter table flowmerce.shop_order add column note_done boolean not null default false;

-- ===================================================================== minor
-- N2
alter table flowmerce.ads_daily add column all_conversions numeric(14,2);
alter table flowmerce.ads_daily add column all_conversions_value numeric(14,2);
alter table flowmerce.ads_daily add column outbound_clicks bigint;
alter table flowmerce.ads_daily add column attribution_setting text;
-- N3
alter table flowmerce.ads_breakdown_daily add column link_clicks bigint;
alter table flowmerce.ads_breakdown_daily add column add_to_cart numeric(14,2);
alter table flowmerce.ads_breakdown_daily add column initiate_checkout numeric(14,2);
-- N4
alter table flowmerce.sq_discount_sales_daily add column is_final boolean not null default false;
alter table flowmerce.sq_customer_type_daily  add column is_final boolean not null default false;
alter table flowmerce.sq_payments_daily       add column is_final boolean not null default false;
alter table flowmerce.sq_web_vitals_daily     add column is_final boolean not null default false;
alter table flowmerce.sq_site_search_daily    add column is_final boolean not null default false;
-- N5
alter table flowmerce.ads_creative add column ad_account_id uuid references flowmerce.ads_account(id) on delete cascade;
alter table flowmerce.ads_creative add column name text;
alter table flowmerce.ads_creative add column video_id text;
alter table flowmerce.ads_creative add column url_tags text;
-- N6
alter table flowmerce.ads_conversion_action add column status text;
alter table flowmerce.ads_conversion_action add column is_primary boolean;
alter table flowmerce.ads_conversion_action add column synced_at timestamptz not null default now();
-- N7: CRO free-shipping amount = setting key 'cro.free_shipping_threshold' per store, value {"amount": 75, "currency": "USD"}
comment on table flowmerce.setting is 'Keys in use: age_bands, step_limits, working_hours, escalation, cro.free_shipping_threshold (per store: {"amount":…, "currency":…}).';
-- N8
alter table flowmerce.carrier_call add column sync_run_id uuid references flowmerce.sync_run(id) on delete set null;
alter table flowmerce.carrier_call add column numbers_asked integer not null default 1;
-- N9: notification exists; add the user it is for
alter table flowmerce.notification add column recipient_user_id uuid;

-- ===================================================================== "to confirm" items that needed a change
create unique index cro_recommendation_code on flowmerce.cro_recommendation (store_id, code);
drop index flowmerce.mcf_sheet_row_once;
create unique index mcf_sheet_row_once on flowmerce.mcf_sheet_row (store_id, coalesce(mcf_id, order_number), coalesce(parcel, ''));
alter table flowmerce.tracking add constraint tracking_delivered_has_time check (status <> 'delivered' or delivered_at is not null);

-- updated_at triggers on every table that has the column
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
           where n.nspname = 'flowmerce' and c.relkind = 'r'
             and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname like '%updated')
  loop
    execute format('create trigger %s_updated before update on flowmerce.%I for each row execute function flowmerce.set_updated_at()', t, t);
  end loop;
end $$;

-- retention: raw copies 13 months, carrier call log 90 days, scans kept
create or replace function flowmerce.purge_raw(p_months integer default 13, p_call_days integer default 90) returns integer
language plpgsql set search_path = '' as $$
declare n1 integer; n2 integer; n3 integer;
begin
  delete from flowmerce.raw_api_payload where received_at < now() - make_interval(months => p_months);
  get diagnostics n1 = row_count;
  delete from flowmerce.raw_webhook_event where received_at < now() - make_interval(months => p_months) and processed_at is not null;
  get diagnostics n2 = row_count;
  delete from flowmerce.carrier_call where called_at < now() - make_interval(days => p_call_days);
  get diagnostics n3 = row_count;
  return n1 + n2 + n3;
end $$;
drop function flowmerce.purge_raw(integer);

-- ===================================================================== costs only for people allowed to see them
drop policy read_own on flowmerce.ship_cost;
drop policy write_team on flowmerce.ship_cost;
create policy read_own on flowmerce.ship_cost for select to authenticated
  using (flowmerce.can_see_store(workspace_id, store_id) and flowmerce.can_see_costs(workspace_id));
create policy write_team on flowmerce.ship_cost for all to authenticated
  using (flowmerce.can_see_store(workspace_id, store_id) and flowmerce.can_edit(workspace_id) and flowmerce.can_see_costs(workspace_id))
  with check (flowmerce.can_see_store(workspace_id, store_id) and flowmerce.can_edit(workspace_id) and flowmerce.can_see_costs(workspace_id));

drop policy read_own on flowmerce.ship_rate_card;
drop policy write_team on flowmerce.ship_rate_card;
create policy read_own on flowmerce.ship_rate_card for select to authenticated
  using (flowmerce.is_member(workspace_id) and flowmerce.can_see_costs(workspace_id));
create policy write_team on flowmerce.ship_rate_card for all to authenticated
  using (flowmerce.can_edit(workspace_id) and flowmerce.can_see_costs(workspace_id))
  with check (flowmerce.can_edit(workspace_id) and flowmerce.can_see_costs(workspace_id));

revoke select on flowmerce.ai_job from authenticated;
grant select (id, workspace_id, store_id, job_type, ref_type, ref_id, input, output, status, execution_mode, model,
              prompt_version, input_tokens, output_tokens, attempts, lease_until, error, requested_by,
              created_at, started_at, finished_at) on flowmerce.ai_job to authenticated;
revoke select on flowmerce.ai_image_generation from authenticated;
grant select (id, workspace_id, store_id, job_id, provider, model, prompt, reference_images, result_url, created_by, created_at)
  on flowmerce.ai_image_generation to authenticated;

drop view flowmerce.ai_daily_spend;
create view flowmerce.ai_daily_spend as          -- owner view: checks the rights itself
select x.workspace_id, x.day, sum(x.cost_usd) as cost_usd, sum(x.jobs) as jobs, sum(x.images) as images
from (
  select j.workspace_id, (j.created_at at time zone 'UTC')::date as day, coalesce(j.cost_usd, 0) as cost_usd, 1 as jobs, 0 as images
  from flowmerce.ai_job j
  union all
  select g.workspace_id, (g.created_at at time zone 'UTC')::date, coalesce(g.cost_usd, 0), 0, 1
  from flowmerce.ai_image_generation g
) x
where auth.role() = 'service_role' or (flowmerce.is_member(x.workspace_id) and flowmerce.can_see_costs(x.workspace_id))
group by x.workspace_id, x.day;
revoke all on flowmerce.ai_daily_spend from anon;
grant select on flowmerce.ai_daily_spend to authenticated, service_role;

-- ===================================================================== RLS + grants + audit for the new tables
alter table flowmerce.approval_policy enable row level security;
alter table flowmerce.sq_product_sessions_daily enable row level security;
alter table flowmerce.media_file enable row level security;

grant select, insert, update, delete on flowmerce.approval_policy, flowmerce.media_file to authenticated;
grant select on flowmerce.sq_product_sessions_daily to authenticated;
grant all on flowmerce.approval_policy, flowmerce.media_file, flowmerce.sq_product_sessions_daily to service_role;

create policy read_own on flowmerce.approval_policy for select to authenticated using (flowmerce.is_member(workspace_id));
create policy write_admin on flowmerce.approval_policy for all to authenticated
  using (flowmerce.is_admin(workspace_id)) with check (flowmerce.is_admin(workspace_id));
create policy read_own on flowmerce.sq_product_sessions_daily for select to authenticated
  using (flowmerce.can_see_store(workspace_id, store_id));
create policy read_own on flowmerce.media_file for select to authenticated
  using (flowmerce.can_see_store(workspace_id, store_id));
create policy write_team on flowmerce.media_file for all to authenticated
  using (flowmerce.can_see_store(workspace_id, store_id) and flowmerce.can_edit(workspace_id))
  with check (flowmerce.can_see_store(workspace_id, store_id) and flowmerce.can_edit(workspace_id));

create trigger audit_approval_policy after insert or update or delete on flowmerce.approval_policy
  for each row execute function flowmerce.audit_row();
create trigger audit_media_file after insert or update or delete on flowmerce.media_file
  for each row execute function flowmerce.audit_row();
create trigger audit_action_policy after insert or update or delete on flowmerce.action_policy
  for each row execute function flowmerce.audit_row();

grant execute on function flowmerce.action_ready(uuid) to authenticated, service_role;
revoke execute on function flowmerce.action_ready(uuid) from anon, public;
