-- OPEN CHOSEN TABLES, READ-ONLY, TO THE PUBLISHABLE KEY (Ravi, 19 Nov: "URL + publishable key only, just the tables I give").
-- Paste into ERP data → SQL editor → Run. The last line must say PASS.
--
-- What it does: for every table in the list below, anyone holding the PUBLISHABLE key may READ it (never write, never delete)
-- through https://xkpktnsdmpkwaingvdbd.supabase.co/rest/v1/<table>  (header Accept-Profile: core).
-- Deleted records (core.sync_gone) stay hidden. Every other table stays closed exactly as before.
-- NOTE: the publishable key is also inside the test link page, so treat every table in this list as readable by anyone
-- who has the key. Never add customer, staff, rights or custom-SKU tables.
--
-- TO CHANGE WHICH TABLES: edit the list (schema.table), run again. TO CLOSE EVERYTHING AGAIN: run the block at the bottom.

do $$
declare
  t text; sch text; tb text; has_lk boolean;
  open_list text[] := array[
    'core.skus',             -- every normal product (Master DB)
    'core.sku_images',       -- picture per SKU
    'core.sku_priority',     -- P1 / P2 / P3
    'core.fnsku_list',       -- Amazon FNSKU ↔ SKU
    'core.article_types',
    'core.article_subtypes',
    'core.colours',
    'core.sizes',
    'core.fabrics',
    'core.pack_sizes',
    'core.recipes',          -- fabric used per piece
    'core.sku_code_rules'    -- how SKU codes are built
  ];
begin
  foreach t in array open_list loop
    if t in ('core.custom_skus', 'core.people', 'core.person_access', 'core.fs_docs', 'core.sync_raw', 'core.sync_inbox', 'core.settings') then
      raise exception 'open_tables_readonly: % must never be opened to the publishable key', t;
    end if;
    if to_regclass(t) is null then raise notice 'skipped (no such table): %', t; continue; end if;
    sch := split_part(t, '.', 1); tb := split_part(t, '.', 2);
    execute format('grant usage on schema %I to anon', sch);
    execute format('grant select on %s to anon', t);
    execute format('alter table %s enable row level security', t);
    has_lk := exists (select 1 from information_schema.columns where table_schema = sch and table_name = tb and column_name = 'legacy_key');
    execute format('drop policy if exists "open read (publishable key)" on %s', t);
    execute format('create policy "open read (publishable key)" on %s for select to anon using (%s)', t,
      case when has_lk then format('not exists (select 1 from core.sync_gone g where g.tbl = %L and g.legacy_key = %I.legacy_key)', t, tb) else 'true' end);
  end loop;
  -- the policies above look up deleted records: the key may read only that lookup (table + key), for the opened tables only
  execute 'grant select (tbl, legacy_key) on core.sync_gone to anon';
  execute 'alter table core.sync_gone enable row level security';
  execute 'drop policy if exists "open read (publishable key)" on core.sync_gone';
  execute format('create policy "open read (publishable key)" on core.sync_gone for select to anon using (tbl = any (%L::text[]))', open_list);
end $$;
notify pgrst, 'reload schema';

select string_agg(c.relnamespace::regnamespace || '.' || c.relname, ', ' order by c.relname) as tables_open_to_the_key,
       case when has_table_privilege('anon', 'core.skus', 'select')
             and not has_table_privilege('anon', 'core.skus', 'insert')
             and not has_table_privilege('anon', 'core.custom_skus', 'select')
            then 'PASS — the listed tables can be read with the publishable key; nothing can be written; custom SKUs stay closed'
            else 'FAIL' end as result
  from pg_policy p join pg_class c on c.oid = p.polrelid
 where p.polname = 'open read (publishable key)' and c.relname <> 'sync_gone';

/* ---------- TO CLOSE AGAIN (run only this block) ----------
do $$ declare r record; begin
  for r in select c.relnamespace::regnamespace::text || '.' || c.relname t from pg_policy p join pg_class c on c.oid = p.polrelid where p.polname = 'open read (publishable key)' loop
    execute format('drop policy "open read (publishable key)" on %s', r.t);
    execute format('revoke select on %s from anon', r.t);
  end loop;
end $$;
revoke select (tbl, legacy_key) on core.sync_gone from anon;
notify pgrst, 'reload schema';
------------------------------------------------------------ */
