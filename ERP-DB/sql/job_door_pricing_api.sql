-- THE JOB DOOR (23 Nov, Ravi: "pricing api to supabase and then it copy to firebase" — "yes build it today").
-- Pricing-API's own Firestore lists are written to ERP data FIRST; the way back (pushBack, every minute) copies them to
-- Firebase, so Firebase stays a full backup.
--
-- Safety:
--   * NOT the server key. Each job has its own key; only its sha256 is stored here. The key is made inside Apps Script
--     (sbjMakeKey) and never leaves it.
--   * A job may write ONLY its own collections (write_colls) and read only read_colls. Never config/* (API keys).
--   * A save goes through the same inbox as an ERP save (screen 'job · <name>'), so the save engine, the history and the way
--     back treat it exactly like one.
-- Re-running this file is safe.

create table if not exists core.job_keys (
  job text primary key,
  key_hash text not null,                 -- sha256 hex of the key; the key itself is never stored
  write_colls text[] not null,
  read_colls text[] not null default '{}',
  on_ boolean not null default true,
  created_at timestamptz not null default now(),
  last_used timestamptz
);
alter table core.job_keys enable row level security;
revoke all on core.job_keys from public, anon, authenticated;

-- the job, if its key is right (else an error that says nothing about which part was wrong)
create or replace function core.job_check(p_job text, p_key text) returns core.job_keys
language plpgsql security definer set search_path = core, public as $$
declare j core.job_keys;
begin
  select * into j from core.job_keys where job = p_job and on_;
  if j.job is null or coalesce(length(p_key), 0) < 32
     or encode(extensions.digest(convert_to(p_key, 'utf8'), 'sha256'), 'hex') <> j.key_hash then
    raise exception 'job door: not allowed';
  end if;
  return j;
end $$;
revoke all on function core.job_check(text, text) from public, anon, authenticated;

-- READ: documents by path ('coll/doc') → { path: value | null }. At most 100 at once.
create or replace function core.job_get(p_job text, p_key text, p_paths text[]) returns jsonb
language plpgsql security definer set search_path = core, public as $$
declare j core.job_keys; p text; s text[]; out jsonb := '{}';
begin
  j := core.job_check(p_job, p_key);
  if coalesce(array_length(p_paths, 1), 0) > 100 then raise exception 'job door: at most 100 documents at once'; end if;
  foreach p in array coalesce(p_paths, '{}') loop
    s := string_to_array(trim(both '/' from p), '/');
    if array_length(s, 1) <> 2 then raise exception 'job door: % is not coll/doc', p; end if;
    if not (s[1] = any(j.write_colls) or s[1] = any(j.read_colls)) or s[1] = 'config' then raise exception 'job door: % may not read %', p_job, s[1]; end if;
    out := out || jsonb_build_object(p, core.fs_value(s[1], s[2]));
  end loop;
  return out;
end $$;

-- WRITE: [{ k: put|patch|delete|create, p: 'coll/doc[/field…]', v, x? }]
--   put     the whole document            patch  fields merged in (x:true = only if the document exists)
--   delete  the document (or one field)   create the document only if it is not there (answered in "exists")
-- Waits until the saves are filed (like the ERP's rt_save); a refused one raises.
create or replace function core.job_save(p_job text, p_key text, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = core, public as $$
declare j core.job_keys; c jsonb; p text; s text[]; k text; v_from bigint; n int := 0; bad text;
        created text[] := '{}'; existed text[] := '{}'; missing text[] := '{}'; scr text;
begin
  j := core.job_check(p_job, p_key);
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'job door: changes must be a list'; end if;
  if jsonb_array_length(p_changes) > 500 then raise exception 'job door: at most 500 changes at once'; end if;
  if octet_length(p_changes::text) > 8000000 then raise exception 'job door: at most 8 MB at once'; end if;
  scr := 'job · ' || p_job;
  v_from := (select coalesce(max(id), 0) from core.sync_inbox);
  for c in select * from jsonb_array_elements(p_changes) loop
    p := trim(both '/' from coalesce(c->>'p', '')); s := string_to_array(p, '/'); k := c->>'k';
    if coalesce(array_length(s, 1), 0) < 2 then raise exception 'job door: % is not coll/doc', p; end if;
    if not (s[1] = any(j.write_colls)) or s[1] = 'config' then raise exception 'job door: % may not write %', p_job, s[1]; end if;
    if k not in ('put', 'patch', 'delete', 'create') then raise exception 'job door: unknown change %', k; end if;
    if k = 'create' or (k = 'patch' and (c->>'x')::boolean is true) then
      perform pg_advisory_xact_lock(hashtext('job door ' || s[1] || '/' || s[2]));
      if core.fs_value(s[1], s[2]) is not null
         or exists (select 1 from core.sync_inbox i where i.status = 'new' and i.path = 'fs/' || s[1] || '/' || s[2] and i.kind <> 'delete') then
        if k = 'create' then existed := existed || p; continue; end if;
      elsif k = 'patch' then missing := missing || p; continue;
      end if;
      if k = 'create' then created := created || p; k := 'put'; end if;
    end if;
    insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
    values (now(), 'job:' || p_job, k, 'fs/' || p, case when k = 'delete' or c->'v' = 'null'::jsonb then null else c->'v' end, scr);
    n := n + 1;
  end loop;
  update core.job_keys set last_used = now() where job = p_job;
  if n > 0 then
    for i in 1..15 loop
      perform core.sync_now();
      if exists (select 1 from core.sync_inbox where id > v_from and status = 'new' and email = 'job:' || p_job and path like 'fs/%') then perform core.fs_direct_apply(500); end if;
      exit when not exists (select 1 from core.sync_inbox where id > v_from and status = 'new' and email = 'job:' || p_job);
      perform pg_sleep(0.2);
    end loop;
    select string_agg(x.path || ': ' || coalesce(left(x.error, 160), 'refused'), ' | ') into bad
      from (select path, error from core.sync_inbox where id > v_from and status = 'failed' and email = 'job:' || p_job order by id limit 3) x;
    if bad is not null then raise exception 'job door: not saved — %', bad; end if;
  end if;
  return jsonb_build_object('n', n, 'created', to_jsonb(created), 'exists', to_jsonb(existed), 'missing', to_jsonb(missing));
end $$;

revoke all on function core.job_get(text, text, text[]), core.job_save(text, text, jsonb) from public;
grant execute on function core.job_get(text, text, text[]), core.job_save(text, text, jsonb) to anon, authenticated, service_role;

-- REGISTER A JOB'S KEY: run in the SQL editor with the hash Apps Script printed (sbjMakeKey). The hash is not secret.
create or replace function core.job_key_register(p_job text, p_key_hash text) returns text
language plpgsql security definer set search_path = core, public as $$
begin
  if p_key_hash !~ '^[0-9a-f]{64}$' then raise exception 'that is not a sha256 hash (64 characters 0-9 a-f)'; end if;
  update core.job_keys set key_hash = p_key_hash, on_ = true where job = p_job;
  if not found then raise exception 'unknown job %', p_job; end if;
  return 'key registered for ' || p_job;
end $$;
revoke all on function core.job_key_register(text, text) from public, anon, authenticated;

-- Pricing-API: its own Firestore lists in price-research-48ff3 (InvSync's fabricrush-inventory stays on Firestore for now)
insert into core.job_keys (job, key_hash, write_colls, read_colls, on_)
values ('pricing-api', repeat('0', 64),
        array['repl', 'replrows', 'replslim', 'replslimrows', 'replshop', 'replshoprows', 'shopify_cache', 'shopify_cache_days', 'creatorOrders'],
        array['perms'], false)
on conflict (job) do update set write_colls = excluded.write_colls, read_colls = excluded.read_colls;

notify pgrst, 'reload schema';

-- self-test: a wrong key is refused, the door is shut until a key is registered
do $$
begin
  begin perform core.job_get('pricing-api', repeat('x', 40), array['repl/SP']); raise exception 'FAIL: wrong key was let in';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
select 'PASS — job door ready; register the key from Apps Script (sbjMakeKey) to open it' as result;
