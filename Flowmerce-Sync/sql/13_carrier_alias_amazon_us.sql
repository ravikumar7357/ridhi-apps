-- Flowmerce · file 13 · carrier names seen in the first live run (24 Nov 2026): "Amazon Logistics US" was unknown.
-- Applied to the ERP project as migration flowmerce_13_carrier_alias_amazon_us.
select set_config('flowmerce.actor', 'migration:flowmerce_13', true);
insert into flowmerce.carrier_alias (alias, carrier_code) values
 ('amazon logistics us', 'amazon'), ('amazon shipping', 'amazon'), ('amazon us', 'amazon'),
 ('fedex ground', 'fedex'), ('fedex express', 'fedex'), ('dhl ecommerce us', 'dhl'), ('dhl express us', 'dhl')
on conflict do nothing;

-- re-file parcels already saved under "unknown"
update flowmerce.tracking t set carrier_code = a.carrier_code
from flowmerce.shipment s, flowmerce.carrier_alias a
where t.shipment_id = s.id and t.carrier_code = 'unknown' and t.source = 'shopify'
  and a.workspace_id is null and lower(a.alias::text) = lower(trim(s.carrier_name_raw))
  and not exists (select 1 from flowmerce.tracking x where x.store_id = t.store_id and x.carrier_code = a.carrier_code and x.tracking_number = t.tracking_number);
update flowmerce.shipment s set carrier_code = a.carrier_code
from flowmerce.carrier_alias a
where s.carrier_code = 'unknown' and a.workspace_id is null and lower(a.alias::text) = lower(trim(s.carrier_name_raw));
