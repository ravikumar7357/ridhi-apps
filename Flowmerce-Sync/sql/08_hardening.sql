-- =====================================================================================
-- Flowmerce · schema flowmerce · file 08 · hardening after Supabase security advisor (24 Nov 2026)
-- Applied to the ERP project as migrations flowmerce_04 (partition RLS) and flowmerce_08.
-- =====================================================================================

alter table flowmerce.raw_api_payload_default enable row level security;
comment on table flowmerce.raw_api_payload_default is 'Partition of raw_api_payload. RLS on with no policies on purpose: only service_role reads raw copies.';

alter function flowmerce.set_updated_at() set search_path = '';
alter function flowmerce.current_actor() set search_path = '';
alter function flowmerce.try_lock(uuid, text, integer) set search_path = '';
alter function flowmerce.release_lock(uuid, text, jsonb, boolean) set search_path = '';
alter function flowmerce.purge_raw(integer) set search_path = '';
alter function flowmerce.apply_scan() set search_path = '';
alter function flowmerce.ai_budget_left_today(uuid) set search_path = '';
alter function flowmerce.default_workspace() set search_path = '';
alter function flowmerce.setting_int(uuid, text, text, integer) set search_path = '';
