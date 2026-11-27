-- TEST LINK SAVES + AUTOMATIC CATCH-UP (16 Nov). Paste into ERP data → Run. The last line must say PASS.
--
-- 1 · core.rt_save — the door the TEST LINK saves through. A save on the test link goes to ERP data only (never Firebase):
--     into the inbox, applied at once (sync_now). Who: an ERP sign-in (an R-one person, or a Firebase rights document that
--     is not a vendor — the same people who may read). Access rights (pt_perms, pt_vendorByEmail, the Firestore perms) only
--     by an admin; Firestore config (API keys) never. Every test save is marked "test link · <screen>" in the inbox.
--     Tester data is wiped on switch day: ERP data is reloaded fresh from Firebase then (Ravi, 16 Nov).
-- 2 · rt_cas (compare-and-set: challan / print-order numbers) for the same people, through rt_save.
-- 3 · core.catchup_pull — every minute, the live ERP's new saves (ERP TEST's inbox) are pulled into ERP data, so the test
--     link stays fresh without anybody running the catch-up. Needs the Vault secret erp_test_key (ERP TEST's secret key).

-- 1 · who is an admin (as the Firebase rules say it: Ravi, or pt_perms/<email key>/admin = true)
create or replace function core.rt_admin() returns boolean language plpgsql stable security definer set search_path = core, public as $$
declare em text := lower(core.me_email());
begin
  if auth.role() = 'service_role' then return true; end if;
  if em is null then return false; end if;
  if em = 'ravi@thefabricrush.com' then return true; end if;
  return coalesce(core.rt_value('pt_perms/' || regexp_replace(em, '\.', ',') || '/admin') = 'true'::jsonb, false);   -- first dot only, as Firebase's key
end $$;
revoke all on function core.rt_admin() from public;
grant execute on function core.rt_admin() to anon, authenticated, service_role;

create or replace function core.rt_save(p_changes jsonb, p_screen text default null) returns int
language plpgsql security definer set search_path = core, public as $$
declare n int; bad text;
begin
  if not core.rt_reader() then raise exception 'rt_save: not an ERP sign-in'; end if;
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'rt_save: changes must be a list'; end if;
  if jsonb_array_length(p_changes) > 2000 then raise exception 'rt_save: at most 2,000 changes at once'; end if;
  if octet_length(p_changes::text) > 8000000 then raise exception 'rt_save: at most 8 MB at once'; end if;
  select c->>'p' into bad from jsonb_array_elements(p_changes) c where trim(both '/' from c->>'p') ~ '^fs/config(/|$)' limit 1;
  if bad is not null then raise exception 'rt_save: settings with API keys are not saved here (%)', bad; end if;
  if not core.rt_admin() then
    select c->>'p' into bad from jsonb_array_elements(p_changes) c
     where trim(both '/' from c->>'p') ~ '^(pt_perms|pt_vendorByEmail|fs/perms)(/|$)' limit 1;
    if bad is not null then raise exception 'rt_save: only an admin can change access rights (%)', bad; end if;
  end if;
  insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
  select case when c->>'t' ~ '^\d{4}-\d{2}-\d{2}' then (c->>'t')::timestamptz end,
         coalesce(core.me_email(), 'server'),
         c->>'k', trim(both '/' from c->>'p'), case when c->'v' = 'null'::jsonb then null else c->'v' end,
         left('test link · ' || coalesce(p_screen, ''), 80)
    from jsonb_array_elements(p_changes) c
   where c->>'k' in ('put', 'patch', 'delete') and coalesce(trim(both '/' from c->>'p'), '') <> '';
  get diagnostics n = row_count;
  if n > 0 then perform core.sync_now(); end if;          -- applied now: the screen's next read has it
  return n;
end $$;
revoke all on function core.rt_save(jsonb, text) from public;
grant execute on function core.rt_save(jsonb, text) to anon, authenticated, service_role;

-- 2 · compare-and-set for the same people
create or replace function core.rt_cas(p_path text, p_expect jsonb, p_next jsonb) returns text
language plpgsql security definer set search_path = core, public as $$
declare cur jsonb;
begin
  if not core.rt_reader() then raise exception 'rt_cas: not an ERP sign-in'; end if;
  perform pg_advisory_xact_lock(hashtext('rt_cas:' || p_path));
  perform core.sync_now();                                           -- everything already sent is applied first
  cur := core.rt_value(p_path);
  if coalesce(cur, 'null'::jsonb) is distinct from coalesce(p_expect, 'null'::jsonb) then return 'changed'; end if;
  perform core.rt_save(jsonb_build_array(jsonb_build_object('k', 'put', 'p', trim(both '/' from p_path), 'v', p_next,
    't', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))), 'compare-and-set');
  return '';
end $$;
revoke all on function core.rt_cas(text, jsonb, jsonb) from public;
grant execute on function core.rt_cas(text, jsonb, jsonb) to anon, authenticated, service_role;

-- 3 · the automatic catch-up from ERP TEST (where the live ERP's mirror sends), one page of up to 500 saves a minute
insert into core.settings (key, value, note) values
  ('catchup.test_last_id', '116149', 'automatic catch-up: ERP TEST inbox id copied up to (main-load.js replay was at 116149 on 16 Nov)'),
  ('catchup.pend_id', 'null', 'automatic catch-up: the pg_net request on its way'),
  ('catchup.last_run', 'null', 'automatic catch-up: last result')
on conflict (key) do nothing;

create or replace function core.catchup_pull() returns jsonb language plpgsql security definer set search_path = core, public as $$
declare k text; last bigint; pend bigint; s int; body text; rows jsonb; n int := 0; mx bigint; res jsonb;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'erp_test_key';
  if k is null then res := jsonb_build_object('error', 'vault secret erp_test_key is missing');
    update core.settings set value = res where key = 'catchup.last_run'; return res; end if;
  select (value #>> '{}')::bigint into last from core.settings where key = 'catchup.test_last_id';
  select nullif(value #>> '{}', '')::bigint into pend from core.settings where key = 'catchup.pend_id';
  -- a) the page asked last time
  if pend is not null then
    select status_code, content into s, body from net._http_response where id = pend;
    if found then
      if s = 200 then
        rows := body::jsonb;
        insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
        select coalesce((r->>'saved_at')::timestamptz, (r->>'at')::timestamptz), 'server', r->>'kind', r->>'path',
               case when r->'value' = 'null'::jsonb then null else r->'value' end, 'replay from test'
          from jsonb_array_elements(rows) r
         where r->>'kind' in ('put', 'patch', 'delete') and coalesce(r->>'path', '') <> ''
         order by (r->>'id')::bigint;
        get diagnostics n = row_count;
        select max((r->>'id')::bigint) into mx from jsonb_array_elements(rows) r;
        if mx is not null then last := mx; update core.settings set value = to_jsonb(last) where key = 'catchup.test_last_id'; end if;
      end if;
      pend := null;
    elsif not exists (select 1 from net.http_request_queue where id = pend) then
      pend := null;                                      -- lost (no answer kept): asked again
    end if;
  end if;
  -- b) the next page
  if pend is null then
    pend := net.http_get(
      url := 'https://eaklutqgopejtnxacamd.supabase.co/rest/v1/sync_inbox?select=id,kind,path,value,saved_at,at&id=gt.' || last
          || '&email=neq.server&or=(screen.is.null,screen.not.in.(%22engine%20proof%22,%22instant%20check%22,%22mirror%20unit%20test%22))&order=id&limit=500',
      headers := jsonb_build_object('apikey', k, 'Authorization', 'Bearer ' || k, 'Accept-Profile', 'core'),
      timeout_milliseconds := 30000);
  end if;
  update core.settings set value = to_jsonb(pend) where key = 'catchup.pend_id';
  res := jsonb_build_object('copied', n, 'upto', last, 'at', now());
  update core.settings set value = res where key = 'catchup.last_run';
  return res;
end $$;
revoke all on function core.catchup_pull() from public, anon, authenticated;
grant execute on function core.catchup_pull() to service_role;
select cron.schedule('r1-catchup-from-test', '* * * * *', 'select core.catchup_pull()');   -- every minute

-- tidy: a record the first save check (16 Nov 11:28) left behind through the old compare-and-set
insert into core.sync_inbox (email, kind, path, value, screen) values
  ('server', 'delete', 'pt_flowTest/linkcheckmwiur4s3', null, 'test link check cleanup'),
  ('server', 'delete', 'pt_flowTest/linkcheckmwiusnui', null, 'test link check cleanup');

notify pgrst, 'reload schema';
select case when has_function_privilege('authenticated', 'core.rt_save(jsonb, text)', 'execute')
             and not has_function_privilege('anon', 'core.catchup_pull()', 'execute')
             and exists (select 1 from cron.job where jobname = 'r1-catchup-from-test' and active)
            then case when exists (select 1 from vault.decrypted_secrets where name = 'erp_test_key') then 'PASS'
                      else 'PASS (now add the Vault secret erp_test_key — the catch-up waits for it)' end
            else 'FAIL' end as result;
