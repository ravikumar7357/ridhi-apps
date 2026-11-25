-- 16 · Nightly trim: keep every order forever, cut the heavy detail nobody needs later.
--
--   1. Parcels delivered more than 30 days ago: delete the in-between IN_TRANSIT scans.
--      Kept: every other step (label, confirmed, out for delivery, delivered, failed, delayed, ...)
--      and the FIRST and LAST in-transit scan of each parcel (pickup time and last movement).
--   2. Raw Shopify answers (raw_api_payload): deleted after 30 days.
--   3. Webhook messages (raw_webhook_event): deleted after 14 days, only once processed (failed ones stay).
--
-- Gentle on the ERP database (see the 21 Nov WAL incident): each call deletes at most p_batch rows per table,
-- with short lock / statement timeouts. pg_cron calls it every 5 minutes from 21:00 to 21:55 UTC
-- (02:30–03:25 IST), clear of r1-cron-log-trim (22:30 UTC). 12 calls a night × 10,000 scans.
--
-- Safe to repeat. If Shopify later changes an old order, the sync may add its scans back; the next night trims them again.
-- Shopify still has everything, so any order can be copied again.

create or replace function flowmerce.trim_old_data(
  p_batch integer default 10000,
  p_scan_days integer default 30,
  p_raw_days integer default 30,
  p_webhook_days integer default 14)
returns jsonb
language plpgsql
set search_path to ''
set lock_timeout to '5s'
set statement_timeout to '120s'
as $$
declare n_scan integer; n_raw integer; n_hook integer;
begin
  with ranked as (
    select e.id,
           row_number() over (partition by e.fulfillment_id order by e.happened_at, e.id)      as first_n,
           row_number() over (partition by e.fulfillment_id order by e.happened_at desc, e.id desc) as last_n
      from flowmerce.fulfillment_event e
      join flowmerce.fulfillment f on f.id = e.fulfillment_id
     where f.delivered_at < now() - make_interval(days => p_scan_days)
       and upper(e.status) = 'IN_TRANSIT'
  ), doomed as (
    select id from ranked where first_n > 1 and last_n > 1 limit p_batch
  )
  delete from flowmerce.fulfillment_event e using doomed d where e.id = d.id;
  get diagnostics n_scan = row_count;

  with doomed as (
    select id, received_at from flowmerce.raw_api_payload
     where received_at < now() - make_interval(days => p_raw_days) limit p_batch
  )
  delete from flowmerce.raw_api_payload r using doomed d where r.id = d.id and r.received_at = d.received_at;
  get diagnostics n_raw = row_count;

  with doomed as (
    select id from flowmerce.raw_webhook_event
     where received_at < now() - make_interval(days => p_webhook_days) and processed_at is not null limit p_batch
  )
  delete from flowmerce.raw_webhook_event w using doomed d where w.id = d.id;
  get diagnostics n_hook = row_count;

  return jsonb_build_object('scans', n_scan, 'raw', n_raw, 'webhooks', n_hook, 'at', now());
end $$;

revoke all on function flowmerce.trim_old_data(integer, integer, integer, integer) from public, anon, authenticated;

select cron.schedule('flowmerce-trim-old-data', '*/5 21 * * *', $$select flowmerce.trim_old_data()$$);
