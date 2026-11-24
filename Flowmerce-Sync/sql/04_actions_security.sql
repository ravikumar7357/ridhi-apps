-- =====================================================================================
-- Flowmerce · schema flowmerce · file 04 · actions (API writes), approvals, notifications, audit, grants + RLS
-- Every outside change: requested -> approved (where needed) -> sent -> result saved from the API's answer.
-- =====================================================================================

create table flowmerce.action_policy (
  action_type       text primary key,
  switch_key        text not null,
  requires_approval boolean not null default true,
  approver_roles    text[] not null default '{owner,admin}',
  typed_confirm     text,
  max_change_pct    numeric(6,2),
  is_forbidden      boolean not null default false
);

insert into flowmerce.action_policy (action_type, switch_key, requires_approval, approver_roles, typed_confirm, max_change_pct, is_forbidden) values
 ('shopify.article.create',         'shopify_article_publish', false, '{owner,admin,manager,editor}', null, null, false),
 ('shopify.article.publish',        'shopify_article_publish', true,  '{owner,admin}', 'PUBLISH', null, false),
 ('shopify.article.update_live',    'shopify_article_publish', true,  '{owner,admin}', 'PUBLISH', null, false),
 ('shopify.file.upload',            'shopify_file_upload',     false, '{owner,admin,manager,editor}', null, null, false),
 ('shopify.product.update_seo',     'shopify_seo_update',      true,  '{owner,admin,manager}', null, null, false),
 ('shopify.collection.update_seo',  'shopify_seo_update',      true,  '{owner,admin,manager}', null, null, false),
 ('shopify.page.create',            'shopify_page_create',     true,  '{owner,admin}', null, null, false),
 ('shopify.fulfillment.create',     'shopify_writes',          true,  '{owner,admin,manager}', null, null, false),
 ('shopify.fulfillment.update_tracking','shopify_writes',      true,  '{owner,admin,manager}', null, null, false),
 ('amazon.mcf.create_order',        'amazon_writes',           true,  '{owner,admin,manager}', null, null, false),
 ('meta.status.set',                'ads_writes',              true,  '{owner,admin,manager}', null, null, false),
 ('meta.budget.set',                'ads_writes',              true,  '{owner,admin}', null, 20, false),
 ('google.status.set',              'ads_writes',              true,  '{owner,admin,manager}', null, null, false),
 ('google.budget.set',              'ads_writes',              true,  '{owner,admin}', null, 20, false),
 ('tracking.register',              'tracking_register',       false, '{owner,admin,manager,editor}', null, null, false),
 ('notify.send',                    'notify_send',             false, '{owner,admin,manager,editor}', null, null, false),
 ('any.delete',                     'shopify_writes',          true,  '{}', null, null, true);

create table flowmerce.action (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  store_id          uuid not null,
  action_type       text not null references flowmerce.action_policy(action_type),
  connection_id     uuid references flowmerce.connection(id) on delete set null,
  target_type       text not null,
  target_id         uuid,
  target_external_id text,
  params            jsonb not null default '{}',
  idempotency_key   text not null,
  status            text not null default 'requested' check (status in ('requested','approved','rejected','sending','succeeded','failed','cancelled')),
  before_state      jsonb,
  response          jsonb,
  after_state       jsonb,
  error             text,
  attempts          integer not null default 0,
  requested_by      uuid,
  requested_at      timestamptz not null default now(),
  sent_at           timestamptz,
  finished_at       timestamptz,
  rollback_of       uuid references flowmerce.action(id),
  foreign key (workspace_id, store_id) references flowmerce.store (workspace_id, id) on delete cascade,
  unique (workspace_id, idempotency_key)
);
create index action_status on flowmerce.action (status, requested_at);

alter table flowmerce.ads_change add constraint ads_change_action_fk
  foreign key (action_id) references flowmerce.action(id) on delete set null;

create table flowmerce.approval (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  action_id         uuid not null references flowmerce.action(id) on delete cascade,
  approver_id       uuid not null,
  decision          text not null check (decision in ('approved','rejected','changes_requested')),
  typed_confirm     text,
  comment           text,
  decided_at        timestamptz not null default now()
);

create or replace function flowmerce.approve_action(p_action uuid, p_decision text, p_typed text default null, p_comment text default null)
returns flowmerce.action language plpgsql security definer set search_path = '' as $$
declare
  a flowmerce.action;
  pol flowmerce.action_policy;
  r text;
begin
  select * into a from flowmerce.action where id = p_action for update;
  if not found then raise exception 'action not found' using errcode = 'P0002'; end if;
  if a.status <> 'requested' then raise exception 'action is %', a.status using errcode = '22023'; end if;
  select * into pol from flowmerce.action_policy where action_type = a.action_type;
  if pol.is_forbidden then raise exception 'this action can never run' using errcode = '42501'; end if;
  r := flowmerce.member_role(a.workspace_id);
  if r is null or not (r = any (pol.approver_roles)) then
    raise exception 'your role cannot approve %', a.action_type using errcode = '42501';
  end if;
  if p_decision = 'approved' and pol.typed_confirm is not null and coalesce(p_typed, '') <> pol.typed_confirm then
    raise exception 'type % to confirm', pol.typed_confirm using errcode = '22023';
  end if;
  if p_decision = 'approved' and not flowmerce.write_allowed(a.workspace_id, a.store_id, pol.switch_key) then
    raise exception 'switch % is off', pol.switch_key using errcode = '42501';
  end if;
  insert into flowmerce.approval (workspace_id, action_id, approver_id, decision, typed_confirm, comment)
  values (a.workspace_id, a.id, auth.uid(), p_decision, p_typed, p_comment);
  update flowmerce.action set status = case p_decision when 'approved' then 'approved' else 'rejected' end
   where id = a.id returning * into a;
  return a;
end $$;

create table flowmerce.notification (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references flowmerce.workspace(id) on delete cascade,
  store_id          uuid,
  channel           text not null check (channel in ('in_app','email','slack','whatsapp')),
  recipient         text not null,
  subject           text,
  body              text not null,
  ref_type          text,
  ref_id            uuid,
  status            text not null default 'queued' check (status in ('queued','sent','failed','read')),
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  error             text
);

-- ===================================================================== audit: who, when, old, new
create table flowmerce.audit_log (
  id                bigint generated always as identity primary key,
  workspace_id      uuid,
  store_id          uuid,
  at                timestamptz not null default now(),
  actor             text not null,
  verb              text not null check (verb in ('insert','update','delete')),
  table_name        text not null,
  row_id            text,
  old_values        jsonb,
  new_values        jsonb
);
create index audit_row on flowmerce.audit_log (table_name, row_id, at desc);
create index audit_ws  on flowmerce.audit_log (workspace_id, at desc);

create or replace function flowmerce.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  ch_old jsonb; ch_new jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(e.key, o -> e.key), jsonb_object_agg(e.key, e.value)
      into ch_old, ch_new
      from jsonb_each(n) e where (o -> e.key) is distinct from e.value;
    if ch_new is null then return new; end if;
    o := ch_old; n := ch_new;
  end if;
  insert into flowmerce.audit_log (workspace_id, store_id, actor, verb, table_name, row_id, old_values, new_values)
  values (case when r ? 'workspace_id' then (r ->> 'workspace_id')::uuid end,
          case when r ? 'store_id' then (r ->> 'store_id')::uuid end,
          flowmerce.current_actor(), lower(tg_op), tg_table_name,
          coalesce(r ->> 'id', r ->> 'store_id', r ->> 'order_id', r ->> 'tracking_id'),
          o, n);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'workspace','store','member','member_store','setting','write_switch','connection','sync_job',
    'team_mark','ship_exception','ship_claim','order_review','order_event','ship_cost','carrier_alias','status_map','ship_rate_card',
    'seo_brand_settings','seo_automation_state','seo_keyword','seo_topic','seo_article','seo_review_note','seo_schedule_slot',
    'cro_alarm_rule','cro_alert','cro_change_log','cro_recommendation','cro_experiment','cro_goal','cro_saved_advice',
    'ads_target','fx_rate','ads_conversion_action','action','approval'
  ] loop
    execute format('create trigger audit_%s after insert or update or delete on flowmerce.%I for each row execute function flowmerce.audit_row()', t, t);
  end loop;
end $$;

-- ===================================================================== grants + row-level security
-- service_role (Flowmerce backend, sync jobs): everything, bypasses RLS.
-- authenticated (signed-in person): reads own workspace / allowed stores; writes only team tables.
-- anon: nothing.
do $$
declare
  r record;
  has_store boolean;
  ws_nullable boolean;
  read_expr text;
  scope_expr text;
  team_writable text[] := array[
    'seo_brand_settings','seo_automation_state','seo_keyword','seo_topic','seo_article','seo_article_revision',
    'seo_review_note','seo_schedule_slot',
    'cro_alarm_rule','cro_alert','cro_change_log','cro_recommendation','cro_experiment','cro_goal','cro_saved_advice',
    'team_mark','ship_exception','ship_claim','order_review','order_event','ship_cost','ship_rate_card',
    'ads_target','fx_rate','ads_conversion_action','action','notification','ai_job','ai_image_generation'];
  admin_writable text[] := array['setting','write_switch','member','member_store','team','team_member','carrier_alias','status_map'];
  admin_read text[] := array['connection','sync_job','webhook_subscription','raw_api_payload','raw_webhook_event','audit_log'];
begin
  grant usage on schema flowmerce to authenticated, service_role;
  grant all on all tables in schema flowmerce to service_role;
  grant all on all sequences in schema flowmerce to service_role;
  grant execute on all functions in schema flowmerce to service_role;
  revoke all on all tables in schema flowmerce from anon;

  for r in
    select c.relname as tbl, c.oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'flowmerce' and c.relkind in ('r','p') and not c.relispartition
  loop
    execute format('alter table flowmerce.%I enable row level security', r.tbl);

    select exists (select 1 from pg_attribute where attrelid = r.oid and attname = 'store_id' and not attisdropped) into has_store;
    select (select not attnotnull from pg_attribute where attrelid = r.oid and attname = 'workspace_id' and not attisdropped) into ws_nullable;

    if ws_nullable is null then                         -- no workspace_id column
      read_expr := case r.tbl when 'workspace' then 'flowmerce.is_member(id)' else 'true' end;   -- provider, carrier, action_policy
      scope_expr := null;
    else
      scope_expr := case when has_store then 'flowmerce.can_see_store(workspace_id, store_id)' else 'flowmerce.is_member(workspace_id)' end;
      read_expr := scope_expr;
      if ws_nullable then read_expr := '(workspace_id is null or ' || read_expr || ')'; end if;
      if r.tbl = any (admin_read) then read_expr := 'flowmerce.is_admin(workspace_id)'; end if;
      if r.tbl = 'store' then read_expr := 'flowmerce.can_see_store(workspace_id, id)'; end if;
    end if;

    execute format('grant select on flowmerce.%I to authenticated', r.tbl);
    execute format('create policy read_own on flowmerce.%I for select to authenticated using (%s)', r.tbl, read_expr);

    if r.tbl = any (team_writable) then
      execute format('grant insert, update, delete on flowmerce.%I to authenticated', r.tbl);
      execute format('create policy write_team on flowmerce.%I for all to authenticated using (%s and flowmerce.can_edit(workspace_id)) with check (%s and flowmerce.can_edit(workspace_id))',
                     r.tbl, scope_expr, scope_expr);
    elsif r.tbl = any (admin_writable) then
      execute format('grant insert, update, delete on flowmerce.%I to authenticated', r.tbl);
      execute format('create policy write_admin on flowmerce.%I for all to authenticated using (flowmerce.is_admin(workspace_id)) with check (flowmerce.is_admin(workspace_id))', r.tbl);
    end if;
  end loop;
end $$;

-- Actions: people only request; approval goes through flowmerce.approve_action()
drop policy write_team on flowmerce.action;
create policy request_action on flowmerce.action for insert to authenticated
  with check (flowmerce.can_see_store(workspace_id, store_id) and flowmerce.can_edit(workspace_id)
              and status = 'requested' and requested_by = auth.uid());
create policy cancel_own_action on flowmerce.action for update to authenticated
  using (requested_by = auth.uid() and status = 'requested')
  with check (status in ('requested','cancelled'));
revoke delete on flowmerce.action from authenticated;

-- AI jobs: people queue jobs, never edit cost / tokens
drop policy write_team on flowmerce.ai_job;
create policy queue_job on flowmerce.ai_job for insert to authenticated
  with check (flowmerce.is_member(workspace_id) and flowmerce.can_edit(workspace_id) and status = 'queued');
revoke update, delete on flowmerce.ai_job from authenticated;

-- Product cost only through flowmerce.variant_cost (file 05)
revoke select on flowmerce.variant from authenticated;
grant select (id, workspace_id, store_id, product_id, external_id, inventory_item_id, sku, barcode, title,
              price, compare_at_price, currency, weight_grams, removed_at, synced_at) on flowmerce.variant to authenticated;

grant execute on function flowmerce.is_member(uuid), flowmerce.member_role(uuid), flowmerce.can_see_store(uuid, uuid),
                          flowmerce.can_edit(uuid), flowmerce.is_admin(uuid), flowmerce.can_see_costs(uuid),
                          flowmerce.approve_action(uuid, text, text, text) to authenticated;
revoke execute on function flowmerce.approve_action(uuid, text, text, text) from anon, public;
