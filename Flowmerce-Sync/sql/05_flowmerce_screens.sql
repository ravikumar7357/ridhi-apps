-- =====================================================================================
-- Flowmerce · schema flowmerce · file 05 · what the Flowmerce screens read (views + RPCs)
--
-- The Shipping module works with NO code change: same view names, columns and RPCs it uses today.
--   .env:  SUPABASE_URL=<project>  SUPABASE_SERVICE_ROLE_KEY=<key>  SHIPPING_SCHEMA=flowmerce
--   Supabase -> Project Settings -> API -> Exposed schemas: add "flowmerce"
-- "store" = store code (RBP / CPC), "carrier_id" = carrier code, as today.
-- Views are security_invoker: a signed-in person only sees what RLS allows.
-- =====================================================================================

create or replace function flowmerce.default_workspace() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('flowmerce.workspace_id', true), '')::uuid,
    (select case when count(*) = 1 then min(id::text)::uuid end from flowmerce.workspace where status = 'active'));
$$;

create or replace function flowmerce.setting_int(p_workspace uuid, p_key text, p_field text, p_default integer) returns integer
language sql stable as $$
  select coalesce((select (s.value ->> p_field)::int from flowmerce.setting s
                    where s.workspace_id = p_workspace and s.store_id is null and s.key = p_key), p_default);
$$;

-- ===================================================================== Shipping module (drop-in names)
create or replace view flowmerce.carriers with (security_invoker = true) as
select c.code as id, c.name, c.track_url_template as track_url, c.can_confirm_delivery
from flowmerce.carrier c;

create or replace view flowmerce.shipment_list with (security_invoker = true) as
with base as (
  select
    t.id as tracking_id, st.code as store, t.workspace_id, t.store_id,
    o.id as order_id, o.name as order_name, o.src_created_at as placed_at,
    sh.id as shipment_id, sh.seq, sh.kind, sh.kind_inferred, sh.step,
    t.carrier_code as carrier_id, c.name as carrier_name, t.tracking_number,
    replace(c.track_url_template, '{tracking}', t.tracking_number) as track_url,
    t.status, t.raw_status, t.status_detail, t.source, t.delivery_confirmed,
    t.registered_at as shipped_at, t.last_scan_at, t.last_scan_place, t.delivered_at, t.eta,
    t.last_checked_at, t.last_check_ok_at, t.last_check_error, t.active,
    tm.mark as team_mark, tm.marked_by as team_mark_by, tm.marked_at as team_mark_at, tm.note as team_note,
    floor(extract(epoch from (coalesce(t.delivered_at, now()) - t.registered_at)) / 86400)::int as days_since_dispatch,
    case when t.last_scan_at is not null then floor(extract(epoch from (now() - t.last_scan_at)) / 3600)::int end as hours_since_scan,
    (select count(*)::int from flowmerce.ship_exception e where e.tracking_id = t.id and e.closed_at is null) as open_exceptions,
    flowmerce.setting_int(t.workspace_id, 'age_bands', 'yellow', 4)     as band_y,
    flowmerce.setting_int(t.workspace_id, 'age_bands', 'orange', 6)     as band_o,
    flowmerce.setting_int(t.workspace_id, 'age_bands', 'red', 9)        as band_r,
    flowmerce.setting_int(t.workspace_id, 'step_limits', 'no_scan_h', 72) as no_scan_h
  from flowmerce.tracking t
  join flowmerce.shipment sh on sh.id = t.shipment_id
  join flowmerce.shop_order o on o.id = sh.order_id
  join flowmerce.store st on st.id = t.store_id
  left join flowmerce.carrier c on c.code = t.carrier_code
  left join flowmerce.team_mark tm on tm.tracking_id = t.id
)
select b.tracking_id, b.store, b.workspace_id, b.store_id, b.order_id, b.order_name, b.placed_at,
       b.shipment_id, b.seq, b.kind, b.kind_inferred, b.step, b.carrier_id, b.carrier_name, b.tracking_number,
       b.track_url, b.status, b.raw_status, b.status_detail, b.source, b.delivery_confirmed, b.shipped_at,
       b.last_scan_at, b.last_scan_place, b.delivered_at, b.eta, b.last_checked_at, b.last_check_ok_at,
       b.last_check_error, b.active, b.team_mark, b.team_mark_by, b.team_mark_at, b.team_note,
       b.days_since_dispatch, b.hours_since_scan, b.open_exceptions,
       case
         when b.status = 'delivered' then 'delivered'
         when b.status in ('returned','expired') then 'closed'
         when b.days_since_dispatch >= b.band_r then 'red'
         when b.days_since_dispatch >= b.band_o then 'orange'
         when b.days_since_dispatch >= b.band_y then 'yellow'
         else 'green'
       end as age_band,
       (b.active and b.last_scan_at is not null and b.hours_since_scan >= b.no_scan_h) as no_movement,
       (b.status = 'pending' and b.active) as unverified
from base b;

create or replace view flowmerce.tracking_scans with (security_invoker = true) as
select s.id, s.tracking_id, st.code as store, s.scanned_at, s.received_at, s.status, s.raw_status, s.message,
       concat_ws(', ', s.city, s.state) as city, s.country, s.source, s.mapped_rule::text as mapped_rule
from flowmerce.scan s join flowmerce.store st on st.id = s.store_id;

create or replace view flowmerce.events with (security_invoker = true) as
select e.id, e.order_id, e.shipment_id, st.code as store, e.at, e.type, e.by, e.title, e.data,
       e.alert_kind, e.severity, e.owner_team, e.assigned_to, e.due_at, e.seen_at, e.closed_at
from flowmerce.order_event e join flowmerce.store st on st.id = e.store_id;

create or replace view flowmerce.shipping_exceptions with (security_invoker = true) as
select e.id, st.code as store, e.shipment_id, e.tracking_id, e.kind, e.severity, e.source, e.detected_at,
       e.description, e.status, e.owner, e.resolution, e.closed_at
from flowmerce.ship_exception e join flowmerce.store st on st.id = e.store_id;

create or replace view flowmerce.shipment_diagnostics with (security_invoker = true) as
with latest_scan as (
  select distinct on (s.tracking_id) s.tracking_id, s.status
  from flowmerce.scan s
  order by s.tracking_id, s.scanned_at desc, s.received_at desc, s.id desc
),
t as (
  select t.*, st.code as store, flowmerce.setting_int(t.workspace_id, 'step_limits', 'no_scan_h', 72) as no_scan_h
  from flowmerce.tracking t join flowmerce.store st on st.id = t.store_id
),
sh as (
  select sh.*, st.code as store from flowmerce.shipment sh join flowmerce.store st on st.id = sh.store_id
)
select t.store, t.shipment_id, t.id as tracking_id, t.tracking_number, 'no_scans'::text as problem, 'amber'::text as severity,
       'Tracking number registered ' || to_char(t.registered_at, 'YYYY-MM-DD') || ' but no scan received' as detail
from t where t.active and t.scan_count = 0 and t.registered_at < now() - make_interval(hours => t.no_scan_h)
union all
select t.store, t.shipment_id, t.id, t.tracking_number, 'no_movement', 'red',
       'Last scan ' || to_char(t.last_scan_at, 'YYYY-MM-DD HH24:MI') || ' UTC'
from t where t.active and t.status not in ('delivered','returned','expired')
  and t.last_scan_at < now() - make_interval(hours => t.no_scan_h)
union all
select sh.store, sh.id, null, null, 'missing_carrier', 'amber', coalesce('Carrier text: ' || sh.carrier_name_raw, 'No carrier at all')
from sh where sh.step in ('shipped','transit','out') and (sh.carrier_code is null or sh.carrier_code = 'unknown')
union all
select t.store, t.shipment_id, t.id, t.tracking_number, 'delivery_unconfirmed', 'amber',
       'Status delivered from source ' || t.source || ' (not carrier-confirmed)'
from t where t.status = 'delivered' and not t.delivery_confirmed and t.delivered_at > now() - interval '30 days'
union all
select t.store, t.shipment_id, t.id, t.tracking_number, 'status_mismatch', 'red',
       'Stored ' || t.status || ' but newest scan says ' || ls.status
from t join latest_scan ls on ls.tracking_id = t.id where ls.status <> t.status
union all
select t.store, t.shipment_id, t.id, t.tracking_number, 'sync_failing', 'amber',
       t.check_attempts || ' failed checks; last error: ' || coalesce(t.last_check_error, '?')
from t where t.active and t.check_attempts >= 3
union all
select min(t.store), null, null, t.tracking_number, 'duplicate_tracking', 'red',
       count(distinct t.shipment_id) || ' shipments share this number'
from t group by t.workspace_id, t.tracking_number having count(distinct t.shipment_id) > 1
union all
select sh.store, sh.id, null, null, 'shipped_without_tracking', 'red', 'Step ' || sh.step || ' with no tracking number'
from sh where sh.step in ('shipped','transit','out')
  and not exists (select 1 from flowmerce.tracking x where x.shipment_id = sh.id)
union all
select st.code, e.shipment_id, e.tracking_id, null, 'open_exception', e.severity,
       e.kind || ' since ' || to_char(e.detected_at, 'YYYY-MM-DD')
from flowmerce.ship_exception e join flowmerce.store st on st.id = e.store_id where e.closed_at is null
union all
select sh.store, sh.id, null, null, 'kind_unconfirmed', 'amber', 'Imported; kind ' || sh.kind || ' inferred from carrier name'
from sh where sh.kind_inferred;

create or replace view flowmerce.diagnostics_list with (security_invoker = true) as
select d.*, o.id as order_id, o.name as order_name, sh.seq, sh.carrier_code as carrier_id
from flowmerce.shipment_diagnostics d
left join flowmerce.shipment sh on sh.id = d.shipment_id
left join flowmerce.shop_order o on o.id = sh.order_id;

create or replace view flowmerce.diagnostics_summary with (security_invoker = true) as
select store, problem, severity, count(*)::int as n
from flowmerce.shipment_diagnostics group by store, problem, severity;

create or replace view flowmerce.carrier_performance with (security_invoker = true) as
select t.carrier_code as carrier_id, t.carrier_service as service_id, t.dest_country,
       date_trunc('month', coalesce(t.picked_up_at, t.registered_at))::date as month,
       count(*) as shipments,
       count(*) filter (where t.status = 'delivered') as delivered,
       count(*) filter (where t.status = 'delivered' and t.delivery_confirmed) as delivered_confirmed,
       round(avg(extract(epoch from (t.delivered_at - coalesce(t.picked_up_at, t.registered_at))) / 86400)::numeric, 1) as avg_transit_days,
       round(100.0 * count(*) filter (where t.delivered_at::date <= t.promised_by)
             / nullif(count(*) filter (where t.status = 'delivered' and t.promised_by is not null), 0), 1) as on_time_pct,
       count(x.tracking_id) as with_problem
from flowmerce.tracking t
left join (select tracking_id from flowmerce.ship_exception where tracking_id is not null group by tracking_id) x on x.tracking_id = t.id
group by t.carrier_code, t.carrier_service, t.dest_country, date_trunc('month', coalesce(t.picked_up_at, t.registered_at));

create or replace view flowmerce.shipping_summary with (security_invoker = true) as
select st.code as store,
  count(*) filter (where t.active)                                              as open_tracking,
  count(*) filter (where t.status = 'in_transit')                               as in_transit,
  count(*) filter (where t.status = 'out_for_delivery')                         as out_for_delivery,
  count(*) filter (where t.status = 'delivered' and t.delivered_at > now() - interval '30 days') as delivered_30d,
  count(*) filter (where t.status = 'delivered' and t.delivery_confirmed and t.delivered_at > now() - interval '30 days') as delivered_confirmed_30d,
  count(*) filter (where t.status = 'exception')                                as exceptions,
  count(*) filter (where t.status = 'pending' and t.active)                     as unverified,
  max(t.last_check_ok_at)                                                        as last_check_ok_at
from flowmerce.tracking t join flowmerce.store st on st.id = t.store_id
group by st.code;

create or replace view flowmerce.feed_freshness with (security_invoker = true) as
select r.source, r.stream as kind, st.code as store, r.workspace_id,
       max(r.started_at)                                   as last_attempt_at,
       max(r.finished_at) filter (where r.status = 'ok')   as last_ok_at,
       (array_agg(r.status order by r.started_at desc))[1] as last_status,
       (array_agg(r.error  order by r.started_at desc))[1] as last_error,
       count(*) filter (where r.status = 'failed' and r.started_at > now() - interval '24 hours') as failures_24h
from flowmerce.sync_run r left join flowmerce.store st on st.id = r.store_id
group by r.source, r.stream, st.code, r.workspace_id;

create or replace view flowmerce.sync_runs with (security_invoker = true) as
select r.id, r.workspace_id, st.code as store, r.source, r.stream as kind, r.status, r.error, r.triggered_by,
       r.started_at, r.finished_at, r.rows_read, r.rows_written
from flowmerce.sync_run r left join flowmerce.store st on st.id = r.store_id;

create or replace function flowmerce.sync_runs_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ws uuid := coalesce(new.workspace_id, flowmerce.default_workspace());
begin
  if ws is null then raise exception 'workspace unknown: set flowmerce.workspace_id' using errcode = '22023'; end if;
  insert into flowmerce.sync_run (workspace_id, store_id, source, stream, status, error, triggered_by, started_at, finished_at)
  values (ws, (select s.id from flowmerce.store s where s.workspace_id = ws and s.code = new.store),
          coalesce(new.source, 'unknown'), coalesce(new.kind, 'unknown'),
          case when new.status in ('running','ok','partial','failed','skipped') then new.status else 'failed' end,
          left(new.error, 1000), coalesce(left(new.triggered_by, 120), 'app'),
          coalesce(new.started_at, now()), coalesce(new.finished_at, now()))
  returning id into new.id;
  return new;
end $$;
create trigger sync_runs_insert instead of insert on flowmerce.sync_runs for each row execute function flowmerce.sync_runs_insert();

-- "Refresh now": asks every shipping sync job to run at once and records the request
create or replace function flowmerce.refresh_from_tracker() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ws uuid := flowmerce.default_workspace(); n integer;
begin
  if ws is null then raise exception 'workspace unknown: set flowmerce.workspace_id' using errcode = '22023'; end if;
  update flowmerce.sync_job j set next_run_at = now()
   where j.workspace_id = ws and j.is_enabled
     and (j.stream like 'shopify.orders%' or j.stream like 'shopify.fulfillment%' or j.stream like 'tracking.%' or j.stream like 'mcf.%');
  get diagnostics n = row_count;
  insert into flowmerce.sync_run (workspace_id, source, stream, status, triggered_by, finished_at, rows_written)
  values (ws, 'flowmerce', 'refresh_request', 'ok', 'app', now(), n);
  return jsonb_build_object('mode', 'sync_jobs', 'jobs_queued', n, 'requested_at', now());
end $$;

create or replace function flowmerce.set_team_mark(p_tracking_id uuid, p_mark text, p_note text, p_by text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t flowmerce.tracking; o_id uuid;
begin
  select * into t from flowmerce.tracking where id = p_tracking_id;
  if not found then raise exception 'Unknown shipment.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not (flowmerce.can_see_store(t.workspace_id, t.store_id) and flowmerce.can_edit(t.workspace_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform set_config('flowmerce.actor', coalesce(p_by, 'app'), true);

  insert into flowmerce.team_mark (tracking_id, workspace_id, store_id, mark, note, marked_by, marked_at)
  values (t.id, t.workspace_id, t.store_id, p_mark, left(p_note, 1000), left(coalesce(p_by, 'app'), 120), now())
  on conflict (tracking_id) do update
    set mark = coalesce(excluded.mark, flowmerce.team_mark.mark),
        note = coalesce(excluded.note, flowmerce.team_mark.note),
        marked_by = excluded.marked_by, marked_at = now();

  select sh.order_id into o_id from flowmerce.shipment sh where sh.id = t.shipment_id;
  insert into flowmerce.order_event (workspace_id, store_id, order_id, shipment_id, type, by, title, data)
  values (t.workspace_id, t.store_id, o_id, t.shipment_id, 'mark', left(coalesce(p_by, 'app'), 120),
          'Team mark: ' || coalesce(p_mark, 'note'),
          jsonb_build_object('tracking_id', t.id, 'tracking_number', t.tracking_number, 'mark', p_mark, 'note', p_note));

  return (select to_jsonb(x) from (
            select tm.tracking_id, tm.mark as team_mark, tm.note as team_note, tm.marked_by as team_mark_by, tm.marked_at as team_mark_at
            from flowmerce.team_mark tm where tm.tracking_id = t.id) x);
end $$;

-- ===================================================================== other read models
create or replace view flowmerce.tracking_due with (security_invoker = true) as
select t.* from flowmerce.tracking t
where t.active and t.registered_at > now() - interval '60 days'
  and coalesce(t.next_check_at, t.last_checked_at + interval '6 hours', now()) <= now();

create or replace view flowmerce.carrier_calls_today with (security_invoker = true) as
select c.workspace_id, c.provider_code, count(*) as calls, p.daily_call_limit, p.daily_call_limit - count(*) as calls_left
from flowmerce.carrier_call c join flowmerce.provider p on p.code = c.provider_code
where c.called_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
group by c.workspace_id, c.provider_code, p.daily_call_limit;

create or replace view flowmerce.ai_daily_spend with (security_invoker = true) as
select j.workspace_id, (j.created_at at time zone 'UTC')::date as day, sum(coalesce(j.cost_usd, 0)) as jobs_usd, count(*) as jobs
from flowmerce.ai_job j group by j.workspace_id, (j.created_at at time zone 'UTC')::date;

create or replace view flowmerce.store_overview with (security_invoker = true) as
select st.workspace_id, st.id as store_id, st.code as store, st.name, st.currency, st.timezone,
  (select max(o.src_created_at) from flowmerce.shop_order o where o.store_id = st.id) as newest_order_at,
  (select max(r.finished_at) from flowmerce.sync_run r where r.store_id = st.id and r.status = 'ok' and r.source = 'shopify')   as shopify_ok_at,
  (select max(r.finished_at) from flowmerce.sync_run r where r.store_id = st.id and r.status = 'ok' and r.source = 'shopifyql') as analytics_ok_at,
  (select max(r.finished_at) from flowmerce.sync_run r where r.store_id = st.id and r.status = 'ok' and r.source in ('meta_ads','google_ads')) as ads_ok_at,
  (select max(r.finished_at) from flowmerce.sync_run r where r.store_id = st.id and r.status = 'ok' and r.source in ('gsc','ga4')) as google_ok_at
from flowmerce.store st;

create or replace view flowmerce.ads_vs_store_daily with (security_invoker = true) as
with p as (
  select m.store_id, m.day, m.platform, m.currency, sum(m.spend) as spend,
         sum(m.purchases) as platform_purchases, sum(m.purchase_value) as platform_value
  from flowmerce.ads_daily m where m.level = 'account'
  group by m.store_id, m.day, m.platform, m.currency
),
s as (
  select o.store_id, (o.src_created_at at time zone st.timezone)::date as day, a.platform,
         count(*) as store_orders, sum(o.net) as store_net_sales, min(o.currency) as store_currency
  from flowmerce.order_attribution a
  join flowmerce.shop_order o on o.id = a.order_id
  join flowmerce.store st on st.id = o.store_id
  where a.platform is not null and o.cancelled_at is null and not o.is_test
  group by o.store_id, (o.src_created_at at time zone st.timezone)::date, a.platform
)
select coalesce(p.store_id, s.store_id) as store_id, coalesce(p.day, s.day) as day, coalesce(p.platform, s.platform) as platform,
       p.currency as ad_currency, p.spend, p.platform_purchases, p.platform_value,
       s.store_currency, s.store_orders, s.store_net_sales
from p full join s on s.store_id = p.store_id and s.day = p.day and s.platform = p.platform;

create or replace view flowmerce.ads_on_low_stock with (security_invoker = true) as
with stock as (
  select v.product_id, sum(il.available) as available_units
  from flowmerce.variant v left join flowmerce.inventory_level il on il.variant_id = v.id
  where v.removed_at is null group by v.product_id
)
select a.store_id, a.id as ad_id, a.platform, a.name as ad_name, a.status as ad_status,
       pr.id as product_id, pr.title as product_title, coalesce(s.available_units, 0) as available_units
from flowmerce.ads_ad a
cross join lateral unnest(a.promoted_product_ids) as pp(product_id)
join flowmerce.product pr on pr.id = pp.product_id
left join stock s on s.product_id = pr.id
where upper(a.status) in ('ACTIVE','ENABLED') and coalesce(s.available_units, 0) <= 5;

-- Product cost: owner view (not security_invoker) that checks the right itself
create or replace view flowmerce.variant_cost as
select v.workspace_id, v.store_id, v.id as variant_id, v.sku, v.cost, v.currency
from flowmerce.variant v
where auth.role() = 'service_role'
   or (flowmerce.can_see_costs(v.workspace_id) and flowmerce.can_see_store(v.workspace_id, v.store_id));

-- ===================================================================== grants for views + RPCs
do $$
declare v text;
begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'flowmerce' and c.relkind = 'v' and c.relname not like 'erp\_%' loop
    execute format('grant select on flowmerce.%I to authenticated, service_role', v);
    execute format('revoke all on flowmerce.%I from anon', v);
  end loop;
end $$;
grant insert on flowmerce.sync_runs to service_role;
grant execute on function flowmerce.refresh_from_tracker(), flowmerce.set_team_mark(uuid, text, text, text),
                          flowmerce.default_workspace(), flowmerce.setting_int(uuid, text, text, integer) to authenticated, service_role;
revoke execute on function flowmerce.refresh_from_tracker(), flowmerce.set_team_mark(uuid, text, text, text) from anon, public;
