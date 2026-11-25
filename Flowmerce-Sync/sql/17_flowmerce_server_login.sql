-- 17 · A database login for the Flowmerce server (Render) that opens ONLY the flowmerce schema.
-- STATUS: switched OFF straight after (17b, bottom of this file). The server uses each person's own token instead.
--
-- Why: Flowmerce lives inside the ERP project, so the service role key would open the whole ERP (HR, pay, production,
-- stock, sales). The Flowmerce server gets this login instead: no usage on any ERP schema, so it cannot even list them.
--
-- How their server uses it (per request, inside one transaction):
--     1. check the password with Supabase Auth (publishable key)  →  the person's auth user id
--     2. begin;
--        select set_config('flowmerce.as_user', '<that user id>', true);   -- "this click is Priya's"
--        ... normal SQL on flowmerce.* ...
--        commit;
--   flowmerce.me() then answers Priya's id, so every rule (member, role, stores, costs, two-person approval) and the
--   audit log work exactly as for a signed-in browser user. Without as_user the server sees nothing.
--   flowmerce.as_user is honoured ONLY for this login (session_user), so a browser user cannot pretend to be someone else.
--
-- Password: NOT set here. The owner runs, in the Supabase SQL editor:
--     alter role flowmerce_server with password '<long random password>';
-- and puts it in Render only.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'flowmerce_server') then
    create role flowmerce_server login noinherit nocreatedb nocreaterole noreplication connection limit 10;
  end if;
end $$;
alter role flowmerce_server set statement_timeout = '30s';
alter role flowmerce_server set idle_in_transaction_session_timeout = '60s';
alter role flowmerce_server set search_path = flowmerce, extensions;

-- who is asking: a signed-in browser user (auth.uid()), or the person the Flowmerce server says it acts for
create or replace function flowmerce.me()
returns uuid
language sql
stable
set search_path to ''
as $$
  select coalesce(
    auth.uid(),
    case when session_user = 'flowmerce_server'
         then nullif(current_setting('flowmerce.as_user', true), '')::uuid end);
$$;

-- every flowmerce function that asked auth.uid() now asks flowmerce.me() (same answer for browser users)
do $$
declare r record;
begin
  for r in
    select p.oid, pg_get_functiondef(p.oid) def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'flowmerce' and p.proname <> 'me' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%auth.uid()%'
  loop
    execute replace(r.def, 'auth.uid()', 'flowmerce.me()');
  end loop;
end $$;

-- the two rules that compared with auth.uid() directly
alter policy request_action on flowmerce.action
  with check (flowmerce.can_see_store(workspace_id, store_id) and flowmerce.can_edit(workspace_id)
              and status = 'requested' and requested_by = flowmerce.me());
alter policy cancel_own_action on flowmerce.action
  using (requested_by = flowmerce.me() and status = 'requested');

-- the same rules apply to the server login as to signed-in users
do $$
declare r record;
begin
  for r in
    select p.polname, c.relname
      from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'flowmerce' and p.polroles @> array['authenticated'::regrole::oid]
  loop
    execute format('alter policy %I on flowmerce.%I to authenticated, flowmerce_server', r.polname, r.relname);
  end loop;
end $$;

-- the same grants as signed-in users, inside flowmerce only
grant usage on schema flowmerce to flowmerce_server;
grant usage on schema extensions to flowmerce_server;
do $$
declare r record;
begin
  for r in
    select table_name, string_agg(privilege_type, ', ') privs
      from information_schema.role_table_grants
     where table_schema = 'flowmerce' and grantee = 'authenticated'
     group by table_name
  loop
    execute format('grant %s on flowmerce.%I to flowmerce_server', r.privs, r.table_name);
  end loop;
  for r in
    select p.oid::regprocedure sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'flowmerce' and has_function_privilege('authenticated', p.oid, 'execute')
  loop
    execute format('grant execute on function %s to flowmerce_server', r.sig);
  end loop;
end $$;
grant usage on all sequences in schema flowmerce to flowmerce_server;
grant execute on function flowmerce.me() to authenticated, flowmerce_server;

-- the sync backend's own functions stay for the backend (service key) only
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'flowmerce'
       and p.proname = any (array['job_start','job_finish','ingest_shopify_orders','webhook_keep','webhook_done',
                                  'webhook_subscription_save','store_app_uninstalled','store_app_ok','trim_old_data','purge_raw'])
  loop
    execute format('grant execute on function %s to service_role', r.sig);
    execute format('revoke execute on function %s from public, flowmerce_server', r.sig);
  end loop;
end $$;

-- 17b (applied right after, 25 Nov 2026): login switched OFF.
-- Test showed a direct database login can still read two Supabase-owned system tables granted to everyone
-- (net._http_response = answers of the ERP's own web calls, extensions.pg_stat_statements = ERP query texts);
-- only supabase_admin can lock those. So the Flowmerce server does NOT log in to the database. It calls the
-- Supabase REST API with the publishable key + the person's own Supabase Auth token (from signInWithPassword):
-- RLS sees that person, ERP schemas are not reachable through the API, and no extra secret exists.
-- flowmerce.me() and the policy changes above stay (they work for both paths).
alter role flowmerce_server nologin;
comment on role flowmerce_server is 'Flowmerce server login, OFF (nologin): a direct database login can read Supabase-owned public system tables (net._http_response, pg_stat_statements) that only supabase_admin can lock. Flowmerce server uses the REST API with each person''s own Supabase Auth token instead.';
