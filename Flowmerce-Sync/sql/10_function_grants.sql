-- =====================================================================================
-- Flowmerce · schema flowmerce · file 10 · who may call which function (after Supabase security advisor, 24 Nov 2026)
-- =====================================================================================

-- trigger-only functions: nobody calls them directly
revoke execute on function flowmerce.audit_row(), flowmerce.sync_runs_insert(), flowmerce.action_guard(),
                           flowmerce.apply_scan(), flowmerce.set_updated_at() from public, anon, authenticated;
-- access helpers: signed-in users (used by RLS) and the backend only
revoke execute on function flowmerce.is_member(uuid), flowmerce.member_role(uuid), flowmerce.can_see_store(uuid, uuid),
                           flowmerce.can_edit(uuid), flowmerce.is_admin(uuid), flowmerce.can_see_costs(uuid),
                           flowmerce.write_allowed(uuid, uuid, text), flowmerce.action_ready(uuid),
                           flowmerce.approve_action(uuid, text, text, text) from public, anon;
grant execute on function flowmerce.is_member(uuid), flowmerce.member_role(uuid), flowmerce.can_see_store(uuid, uuid),
                          flowmerce.can_edit(uuid), flowmerce.is_admin(uuid), flowmerce.can_see_costs(uuid),
                          flowmerce.write_allowed(uuid, uuid, text), flowmerce.action_ready(uuid),
                          flowmerce.approve_action(uuid, text, text, text) to authenticated, service_role;
-- backend-only jobs
revoke execute on function flowmerce.try_lock(uuid, text, integer), flowmerce.release_lock(uuid, text, jsonb, boolean),
                           flowmerce.purge_raw(integer, integer) from public, anon, authenticated;
grant execute on function flowmerce.try_lock(uuid, text, integer), flowmerce.release_lock(uuid, text, jsonb, boolean),
                          flowmerce.purge_raw(integer, integer) to service_role;
comment on view flowmerce.variant_cost is 'Owner view on purpose: returns rows only to service_role or members with can_see_costs.';
comment on view flowmerce.ai_daily_spend is 'Owner view on purpose: returns rows only to service_role or members with can_see_costs.';
