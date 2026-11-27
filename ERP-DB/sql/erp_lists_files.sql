-- LISTS AS FILES (Ravi, 16 Nov: "do C and B"). ERP data keeps each whole list also as a FILE in its own file storage (Supabase
-- Storage, private bucket erp-lists). A browser's FIRST load downloads the files from file storage — the database does no work
-- for it — then asks the database only for what changed since (rt_changes), as before.
--   · a list's file is written again when the list changed, at most every 30 minutes (the changes since come from rt_changes)
--   · manifest.json says, per list, the save number its file is complete up to — a file is listed there only AFTER its upload
--     was confirmed, so a browser never gets a file older than the manifest says
--   · only ERP readers may download (the same rule as the read door, core.rt_reader(), checked on every download)
--   · B: core.rt_get_text — a list straight from the database as plain text (no JSON checking step)
-- NEEDS FIRST (Ravi, once): Database → Extensions → pg_net ON; and in the SQL Editor (type the key yourself, never in a chat):
--     select vault.create_secret('<ERP data secret key, sb_secret_…>', 'erp_lists_key');
-- The key stays in Supabase's encrypted Vault; only core.rt_publish (server only) reads it, to upload the files.
-- Paste into ERP data → Run. The last result must say PASS.

-- 1 · the private bucket and who may read it
insert into storage.buckets (id, name, public) values ('erp-lists', 'erp-lists', false) on conflict (id) do nothing;
drop policy if exists "erp lists: ERP readers" on storage.objects;
create policy "erp lists: ERP readers" on storage.objects for select to anon, authenticated
  using (bucket_id = 'erp-lists' and core.rt_reader());

-- 2 · what was published (confirmed) and what is on its way
alter table core.rt_cache add column if not exists pub_at timestamptz;
alter table core.rt_cache add column if not exists pub_upto bigint;
alter table core.rt_cache add column if not exists pend_id bigint;
alter table core.rt_cache add column if not exists pend_upto bigint;

-- 3 · the publisher (pg_cron, every 2 minutes): confirms finished uploads, writes the manifest, sends the next files
create or replace function core.rt_publish(p_max int default 6) returns jsonb language plpgsql security definer set search_path = core, public as $$
declare k text; base text := 'https://xkpktnsdmpkwaingvdbd.supabase.co/storage/v1/object/erp-lists/'; r record; s int; ok int := 0; sent int := 0; man jsonb; hd jsonb;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'erp_lists_key';
  if k is null then return jsonb_build_object('error', 'vault secret erp_lists_key is missing'); end if;
  hd := jsonb_build_object('Authorization', 'Bearer ' || k, 'apikey', k, 'Content-Type', 'application/json', 'x-upsert', 'true', 'cache-control', 'no-cache');
  -- a) uploads that finished: 200 → published (listed in the manifest); anything else → tried again later
  for r in select reg, pend_id, pend_upto from core.rt_cache where pend_id is not null loop
    select status_code into s from net._http_response where id = r.pend_id;
    if found then
      if s between 200 and 299 then update core.rt_cache set pub_at = now(), pub_upto = r.pend_upto, pend_id = null where reg = r.reg; ok := ok + 1;
      else update core.rt_cache set pend_id = null where reg = r.reg; end if;
    elsif exists (select 1 from core.rt_cache where reg = r.reg and pub_at is not null and pub_at < now() - interval '1 hour') then
      update core.rt_cache set pend_id = null where reg = r.reg;      -- no answer for an hour: sent again
    end if;
  end loop;
  -- b) the manifest: only confirmed files
  if ok > 0 then
    select jsonb_object_agg(reg, jsonb_build_object('upto', pub_upto, 'at', pub_at)) into man from core.rt_cache where pub_at is not null and pub_upto is not null;
    perform net.http_post(url := base || 'manifest.json', body := coalesce(man, '{}'::jsonb), headers := hd, timeout_milliseconds := 30000);
  end if;
  -- c) the next files: never published, or changed and published more than 30 minutes ago
  for r in select reg, value, upto from core.rt_cache
            where pend_id is null and value is not null and upto is not null
              and (pub_at is null or (coalesce(pub_upto, 0) < upto and pub_at < now() - interval '30 minutes'))
            order by pub_at nulls first limit greatest(1, p_max) loop
    update core.rt_cache set pend_id = net.http_post(url := base || r.reg || '.json', body := r.value, headers := hd, timeout_milliseconds := 60000), pend_upto = r.upto
     where reg = r.reg;
    sent := sent + 1;
  end loop;
  return jsonb_build_object('confirmed', ok, 'sent', sent);
end $$;
revoke all on function core.rt_publish(int) from public, anon, authenticated;
grant execute on function core.rt_publish(int) to service_role;
select cron.schedule('r1-lists-publish', '*/2 * * * *', 'select core.rt_publish(15)');   -- every 2 minutes (cron format)

-- 4 · B: a whole list from the database as plain text (asked with "Accept: text/plain": handed over as it is)
create or replace function core.rt_get_text(p_path text) returns text language plpgsql volatile security definer set search_path = core, public as $$
declare v_reg text := split_part(trim(both '/' from coalesce(p_path, '')), '/', 1); t text;
begin
  if not core.rt_reader() then raise exception 'rt_get: not an ERP sign-in'; end if;
  if position('/' in trim(both '/' from coalesce(p_path, ''))) > 0 or v_reg in ('pt_audit', 'pt_trash') then return coalesce(core.rt_value(p_path)::text, 'null'); end if;
  select rc.txt into t from core.rt_cache rc where rc.reg = v_reg and rc.txt is not null and rc.built_at > now() - interval '24 hours';
  if t is null then perform core.rt_value(p_path); select rc.txt into t from core.rt_cache rc where rc.reg = v_reg; end if;
  return coalesce(t, 'null');
end $$;
revoke all on function core.rt_get_text(text) from public;
grant execute on function core.rt_get_text(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
select case when exists (select 1 from storage.buckets where id = 'erp-lists' and not public)
             and exists (select 1 from pg_policies where tablename = 'objects' and policyname = 'erp lists: ERP readers')
             and exists (select 1 from cron.job where jobname = 'r1-lists-publish' and active)
             and exists (select 1 from vault.decrypted_secrets where name = 'erp_lists_key')
             and not has_function_privilege('anon', 'core.rt_publish(int)', 'execute') then 'PASS'
            else 'FAIL — check: pg_net on? vault secret erp_lists_key added?' end as result;
