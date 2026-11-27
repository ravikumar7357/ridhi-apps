-- THE FIRESTORE COPIER'S DOOR (16 Nov, Ravi: "copier tab B"). The test link's copier page (…/copier/) reads Firestore with the
-- signed-in admin's own sign-in — the documents the Apps Scripts write (repl*, shopify_cache*, Sellora's) — and hands them
-- here, exactly as the Apps Script reader would: into ERP data's live copy (fs_docs), and the ones the engine builds rows from
-- (replshop, replshoprows) through the inbox too. Admins only. API keys never: in config/* every field named like a key /
-- secret / token / password is dropped here as well (the page drops them first). Paste into ERP data → Run. Last line: PASS.
create or replace function core.fs_copy_put(p_docs jsonb) returns int language plpgsql security definer set search_path = core, public as $$
declare n int; docs jsonb;
begin
  if not core.rt_admin() then raise exception 'fs_copy_put: admins only'; end if;
  if jsonb_typeof(p_docs) <> 'array' then raise exception 'fs_copy_put: docs must be a list'; end if;
  if jsonb_array_length(p_docs) > 500 or octet_length(p_docs::text) > 8000000 then raise exception 'fs_copy_put: at most 500 documents / 8 MB at once'; end if;
  select coalesce(jsonb_agg(case when split_part(x->>'p', '/', 1) = 'config' and jsonb_typeof(x->'v') = 'object'
           then jsonb_set(x, '{v}', (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(x->'v') e(k, v) where k !~* '(key|secret|token|pass)'))
           else x end), '[]'::jsonb)
    into docs from jsonb_array_elements(p_docs) x where coalesce(x->>'p', '') ~ '^[A-Za-z_]+/[^/]+$';
  n := core.fs_docs_put('price-research-48ff3', docs);
  insert into core.sync_inbox (saved_at, email, kind, path, value, screen)
  select case when x->>'t' ~ '^\d{4}-' then (x->>'t')::timestamptz end, coalesce(core.me_email(), 'server'), coalesce(x->>'k', 'put'), 'fs/' || (x->>'p'),
         case when x->'v' = 'null'::jsonb then null else x->'v' end, 'firestore copier'
    from jsonb_array_elements(docs) x where split_part(x->>'p', '/', 1) in ('replshop', 'replshoprows');
  return n;
end $$;
revoke all on function core.fs_copy_put(jsonb) from public;
grant execute on function core.fs_copy_put(jsonb) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
select case when has_function_privilege('authenticated', 'core.fs_copy_put(jsonb)', 'execute') then 'PASS' else 'FAIL' end as result;
